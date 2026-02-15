import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import {
  appendAuditJsonl,
  atomicWriteText,
  err,
  errorCode,
  getManifestArtifacts,
  getStringProp,
  isNonEmptyString,
  nowIso,
  ok,
  parseBool,
  readJson,
  sha256DigestForJson,
  type CitationStatus,
  type OfflineFixtureLookup,
  validateManifestV1,
} from "./citations_lib";

import {
  appendNote,
  buildOfflineFixtureLookup,
  classifyOnlineStub,
  emptyOfflineFixtureLookup,
  findFixtureForUrlMapItem,
  isCitationStatus,
  readFoundByLookup,
  redactSensitiveUrl,
  validateUrlMapV1,
} from "./citations_validate_lib";

export const citations_validate = tool({
  description: "Validate normalized URLs into citations.jsonl records",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    url_map_path: tool.schema.string().optional().describe("Absolute path to url-map.json"),
    citations_path: tool.schema.string().optional().describe("Absolute output path for citations.jsonl"),
    offline_fixtures_path: tool.schema.string().optional().describe("Absolute JSON fixtures path for offline mode"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    url_map_path?: string;
    citations_path?: string;
    offline_fixtures_path?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const noWebRaw = process.env.PAI_DR_NO_WEB;
      const noWebParsed = noWebRaw === undefined ? false : parseBool(noWebRaw);
      if (noWebRaw !== undefined && noWebParsed === null) {
        return err("INVALID_ARGS", "PAI_DR_NO_WEB must be boolean-like (0/1/true/false)", {
          PAI_DR_NO_WEB: noWebRaw,
        });
      }
      const mode: "offline" | "online" = noWebParsed === true ? "offline" : "online";

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path missing", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest unreadable", { manifest_path: manifestPath });
        throw e;
      }
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));
      const checkedAt = isNonEmptyString(manifest.updated_at) ? String(manifest.updated_at) : nowIso();

      const urlMapPath = (args.url_map_path ?? "").trim() || path.join(runRoot, "citations", "url-map.json");
      const citationsPath = (args.citations_path ?? "").trim() || path.join(runRoot, "citations", "citations.jsonl");
      const offlineFixturesPath = (args.offline_fixtures_path ?? "").trim();

      if (!path.isAbsolute(urlMapPath)) return err("INVALID_ARGS", "url_map_path must be absolute", { url_map_path: args.url_map_path ?? null });
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });
      if (offlineFixturesPath && !path.isAbsolute(offlineFixturesPath)) {
        return err("INVALID_ARGS", "offline_fixtures_path must be absolute", { offline_fixtures_path: args.offline_fixtures_path });
      }
      if (mode === "offline" && !offlineFixturesPath) {
        return err("INVALID_ARGS", "offline_fixtures_path required in OFFLINE mode", {
          mode,
          PAI_DR_NO_WEB: noWebRaw ?? null,
        });
      }

      let urlMapRaw: unknown;
      try {
        urlMapRaw = await readJson(urlMapPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing", { url_map_path: urlMapPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "url-map unreadable JSON", { url_map_path: urlMapPath });
        throw e;
      }

      const urlMapValidation = validateUrlMapV1(urlMapRaw, runId);
      if (!("items" in urlMapValidation)) {
        return err("SCHEMA_VALIDATION_FAILED", urlMapValidation.message, urlMapValidation.details);
      }

      const urlMapItemsSorted = [...urlMapValidation.items].sort((a, b) => {
        const byNormalized = a.normalized_url.localeCompare(b.normalized_url);
        if (byNormalized !== 0) return byNormalized;
        return a.url_original.localeCompare(b.url_original);
      });

      const urlMapItemsByNormalized = new Map<string, (typeof urlMapItemsSorted)[number]>();
      const normalizedToOriginals = new Map<string, string[]>();
      for (const item of urlMapItemsSorted) {
        if (!urlMapItemsByNormalized.has(item.normalized_url)) {
          urlMapItemsByNormalized.set(item.normalized_url, item);
        }
        const originals = normalizedToOriginals.get(item.normalized_url) ?? [];
        originals.push(item.url_original);
        normalizedToOriginals.set(item.normalized_url, originals);
      }
      const urlMapItems = Array.from(urlMapItemsByNormalized.values()).sort((a, b) => a.normalized_url.localeCompare(b.normalized_url));

      let fixtureLookup: OfflineFixtureLookup = emptyOfflineFixtureLookup();
      if (mode === "offline") {
        let fixtureRaw: unknown;
        try {
          fixtureRaw = await readJson(offlineFixturesPath);
        } catch (e) {
          if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "offline_fixtures_path missing", { offline_fixtures_path: offlineFixturesPath });
          if (e instanceof SyntaxError) return err("INVALID_JSON", "offline fixtures unreadable JSON", { offline_fixtures_path: offlineFixturesPath });
          throw e;
        }

        const fixtureResult = buildOfflineFixtureLookup(fixtureRaw);
        if ("lookup" in fixtureResult) {
          fixtureLookup = fixtureResult.lookup;
        } else {
          return err("SCHEMA_VALIDATION_FAILED", fixtureResult.message, fixtureResult.details);
        }
      }

      const foundByPath = path.join(runRoot, "citations", "found-by.json");
      const foundByLookup = await readFoundByLookup(foundByPath);

      const records: Array<Record<string, unknown>> = [];
      for (const item of urlMapItems) {
        const fixture = mode === "offline" ? findFixtureForUrlMapItem(fixtureLookup, item) : null;

        let status: CitationStatus;
        let notes: string;
        let urlValue = fixture?.url?.trim() || item.normalized_url;
        let httpStatus: number | undefined;
        let title: string | undefined;
        let publisher: string | undefined;
        let evidenceSnippet: string | undefined;

        if (mode === "offline") {
          if (!fixture) {
            status = "invalid";
            notes = "offline fixture not found for normalized_url";
          } else {
            status = isCitationStatus(fixture.status) ? fixture.status : "invalid";
            notes = fixture.notes?.trim() || (status === "valid" ? "ok" : `offline fixture status=${status}`);
            if (typeof fixture.http_status === "number" && Number.isFinite(fixture.http_status)) {
              httpStatus = Math.trunc(fixture.http_status);
            }
            if (isNonEmptyString(fixture.title)) title = fixture.title;
            if (isNonEmptyString(fixture.publisher)) publisher = fixture.publisher;
            if (isNonEmptyString(fixture.evidence_snippet)) evidenceSnippet = fixture.evidence_snippet;
          }
        } else {
          const onlineStub = classifyOnlineStub(item.normalized_url);
          status = onlineStub.status;
          notes = onlineStub.notes;
          urlValue = onlineStub.url;
          // Placeholder ladder contract (no network in this implementation):
          // 1) direct fetch, 2) bright-data progressive scrape, 3) apify/rag-web-browser.
        }

        const redactedOriginal = redactSensitiveUrl(item.url_original);
        const redactedUrl = redactSensitiveUrl(urlValue);
        if (redactedOriginal.hadUserinfo || redactedUrl.hadUserinfo) {
          status = "invalid";
          notes = appendNote(notes, "userinfo stripped; marked invalid per redaction policy");
        }

        const originalsForNormalized = normalizedToOriginals.get(item.normalized_url) ?? [item.url_original];
        const foundBy = originalsForNormalized
          .flatMap((urlOriginal) => foundByLookup.get(urlOriginal) ?? []);
        const record: Record<string, unknown> = {
          schema_version: "citation.v1",
          normalized_url: item.normalized_url,
          cid: item.cid,
          url: redactedUrl.value,
          url_original: redactedOriginal.value,
          status,
          checked_at: checkedAt,
          found_by: foundBy,
          notes,
        };
        if (httpStatus !== undefined) record.http_status = httpStatus;
        if (title) record.title = title;
        if (publisher) record.publisher = publisher;
        if (evidenceSnippet) record.evidence_snippet = evidenceSnippet;
        records.push(record);
      }

      records.sort((a, b) => {
        const an = String(a.normalized_url ?? "");
        const bn = String(b.normalized_url ?? "");
        const byNormalized = an.localeCompare(bn);
        if (byNormalized !== 0) return byNormalized;
        return String(a.url_original ?? "").localeCompare(String(b.url_original ?? ""));
      });

      const jsonl = records.map((record) => JSON.stringify(record)).join("\n");
      const payload = jsonl.length > 0 ? `${jsonl}\n` : "";

      try {
        await atomicWriteText(citationsPath, payload);
      } catch (e) {
        return err("WRITE_FAILED", "cannot write citations.jsonl", {
          citations_path: citationsPath,
          message: String(e),
        });
      }

      const inputsDigest = sha256DigestForJson({
        schema: "citations_validate.inputs.v1",
        run_id: runId,
        mode,
        url_map: urlMapItems,
        fixture_digest: mode === "offline" ? fixtureLookup.fixtureDigest : null,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "citations_validate",
            run_id: runId,
            reason,
            mode,
            citations_path: citationsPath,
            validated: records.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        run_id: runId,
        citations_path: citationsPath,
        mode,
        validated: records.length,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      return err("WRITE_FAILED", "citations_validate failed", { message: String(e) });
    }
  },
});
