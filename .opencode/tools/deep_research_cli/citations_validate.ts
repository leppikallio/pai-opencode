import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import {
  appendAuditJsonl,
  atomicWriteJson,
  atomicWriteText,
  err,
  errorCode,
  getManifestArtifacts,
  getStringProp,
  isPlainObject,
  isNonEmptyString,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
  type CitationStatus,
  type OfflineFixtureLookup,
  validateManifestV1,
} from "./citations_lib";

import {
  appendNote,
  buildOfflineFixtureLookup,
  classifyOnlineWithLadder,
  emptyOfflineFixtureLookup,
  findFixtureForUrlMapItem,
  isCitationStatus,
  readFoundByLookup,
  redactSensitiveUrl,
  resolveCitationsConfig,
  validateUrlMapV1,
} from "./citations_validate_lib";

function toTimestampToken(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(iso);
  if (!m) return iso.replace(/[^A-Za-z0-9]/g, "") || `${Date.now()}`;
  const ms = (m[7] ?? "").slice(0, 3).padEnd(3, "0");
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}${ms}Z`;
}

function blockedUrlAction(notes: string): string {
  const lower = notes.toLowerCase();
  if (lower.includes("private/local target blocked")) {
    return "Replace with publicly reachable source URL outside private/local networks.";
  }
  if (lower.includes("dry-run")) {
    return "Run with online_dry_run=false or provide online fixtures replay input.";
  }
  if (lower.includes("endpoint not configured")) {
    return "Configure Bright Data/Apify endpoint or provide deterministic online fixture.";
  }
  if (lower.includes("disallowed protocol")) {
    return "Use http/https source URL for citation validation.";
  }
  return "Investigate URL manually and add deterministic online fixture if needed.";
}

function nonEmptyString(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  return value.trim();
}

function formatBlockedUrlsQueueMarkdown(args: {
  generatedAt: string;
  items: Array<Record<string, unknown>>;
}): string {
  const items = [...args.items].sort((a, b) => {
    const byNormalized = String(a.normalized_url ?? "").localeCompare(String(b.normalized_url ?? ""));
    if (byNormalized !== 0) return byNormalized;
    return String(a.url ?? "").localeCompare(String(b.url ?? ""));
  });

  const lines: string[] = [
    "# Blocked URLs Queue",
    `generated_at: ${args.generatedAt}`,
    `blocked_count: ${items.length}`,
    "",
  ];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const url = nonEmptyString(item.url) ?? nonEmptyString(item.normalized_url) ?? "unknown";
    const normalizedUrl = nonEmptyString(item.normalized_url);
    const reason = nonEmptyString(item.notes) ?? "blocked";
    const action = nonEmptyString(item.action)
      ?? "Investigate URL manually and add deterministic online fixture if needed.";

    lines.push(`## ${i + 1}. ${url}`);
    if (normalizedUrl) lines.push(`- normalized_url: ${normalizedUrl}`);
    lines.push(`- reason: ${reason}`);
    lines.push(`- recommended_action: ${action}`);

    const foundByRaw = Array.isArray(item.found_by) ? item.found_by : [];
    const foundBy = foundByRaw
      .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
      .sort((a, b) => {
        const byFile = String(a.artifact_path ?? "").localeCompare(String(b.artifact_path ?? ""));
        if (byFile !== 0) return byFile;
        const byPerspective = String(a.perspective_id ?? "").localeCompare(String(b.perspective_id ?? ""));
        if (byPerspective !== 0) return byPerspective;
        return String(a.source_line ?? "").localeCompare(String(b.source_line ?? ""));
      });

    if (foundBy.length > 0) {
      lines.push("- found_by:");
      for (const entry of foundBy) {
        const file = nonEmptyString(entry.artifact_path);
        const line = nonEmptyString(entry.source_line);
        const perspective = nonEmptyString(entry.perspective_id);
        const wave = typeof entry.wave === "number" && Number.isFinite(entry.wave)
          ? String(Math.trunc(entry.wave))
          : nonEmptyString(entry.wave);

        if (file) {
          lines.push(`  - file: ${file}`);
          if (line) lines.push(`    line: ${line}`);
          if (perspective) lines.push(`    perspective: ${perspective}`);
          if (wave) lines.push(`    wave: ${wave}`);
          continue;
        }

        if (line || perspective || wave) {
          const parts = [
            line ? `line: ${line}` : null,
            perspective ? `perspective: ${perspective}` : null,
            wave ? `wave: ${wave}` : null,
          ].filter((part): part is string => part !== null);
          if (parts.length > 0) lines.push(`  - ${parts.join(", ")}`);
        }
      }
    }

    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export const citations_validate = tool({
  description: "Validate normalized URLs into citations.jsonl records",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    url_map_path: tool.schema.string().optional().describe("Absolute path to url-map.json"),
    citations_path: tool.schema.string().optional().describe("Absolute output path for citations.jsonl"),
    offline_fixtures_path: tool.schema.string().optional().describe("Absolute JSON fixtures path for offline mode"),
    online_fixtures_path: tool.schema.string().optional().describe("Absolute JSON fixtures path for deterministic online ladder mode"),
    online_dry_run: tool.schema.boolean().optional().describe("Disable network and run ladder in deterministic dry-run mode"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    url_map_path?: string;
    citations_path?: string;
    offline_fixtures_path?: string;
    online_fixtures_path?: string;
    online_dry_run?: boolean;
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

      const runConfigPath = path.join(runRoot, "run-config.json");
      let runConfig: Record<string, unknown> | null = null;
      try {
        const runConfigRaw = await readJson(runConfigPath);
        if (isPlainObject(runConfigRaw)) {
          runConfig = runConfigRaw as Record<string, unknown>;
        }
      } catch (e) {
        if (errorCode(e) !== "ENOENT") {
          if (e instanceof SyntaxError) {
            return err("INVALID_JSON", "run-config unreadable", { run_config_path: runConfigPath });
          }
          throw e;
        }
      }

      const resolvedConfig = resolveCitationsConfig({
        manifest,
        runConfig,
        onlineDryRunArg: args.online_dry_run,
      });
      const mode = resolvedConfig.mode;
      const validationMode: "offline" | "online" = mode === "offline" ? "offline" : "online";
      const onlineDryRun = resolvedConfig.onlineDryRun;
      const brightDataEndpoint = resolvedConfig.brightDataEndpoint;
      const apifyEndpoint = resolvedConfig.apifyEndpoint;

      const urlMapPath = (args.url_map_path ?? "").trim() || path.join(runRoot, "citations", "url-map.json");
      const citationsPath = (args.citations_path ?? "").trim() || path.join(runRoot, "citations", "citations.jsonl");
      const offlineFixturesPath = (args.offline_fixtures_path ?? "").trim();
      const onlineFixturesPath = (args.online_fixtures_path ?? "").trim();

      if (!path.isAbsolute(urlMapPath)) return err("INVALID_ARGS", "url_map_path must be absolute", { url_map_path: args.url_map_path ?? null });
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });
      if (offlineFixturesPath && !path.isAbsolute(offlineFixturesPath)) {
        return err("INVALID_ARGS", "offline_fixtures_path must be absolute", { offline_fixtures_path: args.offline_fixtures_path });
      }
      if (onlineFixturesPath && !path.isAbsolute(onlineFixturesPath)) {
        return err("INVALID_ARGS", "online_fixtures_path must be absolute", { online_fixtures_path: args.online_fixtures_path });
      }
      if (validationMode === "offline" && !offlineFixturesPath) {
        return err("INVALID_ARGS", "offline_fixtures_path required in OFFLINE mode", {
          mode,
          mode_source: resolvedConfig.modeSource,
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
      if (validationMode === "offline") {
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

      let onlineFixtureLookup: OfflineFixtureLookup = emptyOfflineFixtureLookup();
      if (validationMode === "online" && onlineFixturesPath) {
        let onlineFixtureRaw: unknown;
        try {
          onlineFixtureRaw = await readJson(onlineFixturesPath);
        } catch (e) {
          if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "online_fixtures_path missing", { online_fixtures_path: onlineFixturesPath });
          if (e instanceof SyntaxError) return err("INVALID_JSON", "online fixtures unreadable JSON", { online_fixtures_path: onlineFixturesPath });
          throw e;
        }

        const onlineFixtureResult = buildOfflineFixtureLookup(onlineFixtureRaw);
        if ("lookup" in onlineFixtureResult) {
          onlineFixtureLookup = onlineFixtureResult.lookup;
        } else {
          return err("SCHEMA_VALIDATION_FAILED", onlineFixtureResult.message, onlineFixtureResult.details);
        }
      }

      const foundByPath = path.join(runRoot, "citations", "found-by.json");
      const foundByLookup = await readFoundByLookup(foundByPath);

      const records: Array<Record<string, unknown>> = [];
      const onlineFixtureItems: Array<Record<string, unknown>> = [];
      const blockedUrlsItems: Array<Record<string, unknown>> = [];
      for (const item of urlMapItems) {
        const fixture = validationMode === "offline" ? findFixtureForUrlMapItem(fixtureLookup, item) : null;

        let status: CitationStatus;
        let notes: string;
        let urlValue = fixture?.url?.trim() || item.normalized_url;
        let httpStatus: number | undefined;
        let title: string | undefined;
        let publisher: string | undefined;
        let evidenceSnippet: string | undefined;

        if (validationMode === "offline") {
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
          const onlineFixture = onlineFixturesPath ? findFixtureForUrlMapItem(onlineFixtureLookup, item) : null;
          const onlineResult = await classifyOnlineWithLadder(item.normalized_url, {
            dryRun: onlineDryRun,
            fixture: onlineFixture,
            brightDataEndpoint,
            apifyEndpoint,
          });

          status = onlineResult.status;
          notes = onlineResult.notes;
          urlValue = onlineResult.url;
          httpStatus = onlineResult.http_status;
          title = onlineResult.title;
          publisher = onlineResult.publisher;
          evidenceSnippet = onlineResult.evidence_snippet;
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

        if (validationMode === "online") {
          const fixtureEntry: Record<string, unknown> = {
            normalized_url: item.normalized_url,
            url_original: redactedOriginal.value,
            cid: item.cid,
            status,
            url: redactedUrl.value,
            notes,
          };
          if (httpStatus !== undefined) fixtureEntry.http_status = httpStatus;
          if (title) fixtureEntry.title = title;
          if (publisher) fixtureEntry.publisher = publisher;
          if (evidenceSnippet) fixtureEntry.evidence_snippet = evidenceSnippet;
          onlineFixtureItems.push(fixtureEntry);

          if (status === "blocked") {
            blockedUrlsItems.push({
              normalized_url: item.normalized_url,
              cid: item.cid,
              status,
              url: redactedUrl.value,
              notes,
              action: blockedUrlAction(notes),
              found_by: foundBy,
            });
          }
        }
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

      let onlineFixturesOutputPath: string | null = null;
      let onlineFixturesLatestPath: string | null = null;
      let blockedUrlsPath: string | null = null;
      let blockedUrlsQueuePath: string | null = null;

      if (validationMode === "online") {
        const generatedAt = nowIso();
        const tsToken = toTimestampToken(generatedAt);
        const onlineFixturesOutputPathAbs = path.join(runRoot, "citations", `online-fixtures.${tsToken}.json`);
        const onlineFixturesLatestPathAbs = path.join(runRoot, "citations", "online-fixtures.latest.json");
        const blockedUrlsPathAbs = path.join(runRoot, "citations", "blocked-urls.json");
        const blockedUrlsQueuePathAbs = path.join(runRoot, "citations", "blocked-urls.queue.md");
        onlineFixturesOutputPath = onlineFixturesOutputPathAbs;
        onlineFixturesLatestPath = onlineFixturesLatestPathAbs;
        blockedUrlsPath = blockedUrlsPathAbs;
        blockedUrlsQueuePath = blockedUrlsQueuePathAbs;

        onlineFixtureItems.sort((a, b) => {
          const byNormalized = String(a.normalized_url ?? "").localeCompare(String(b.normalized_url ?? ""));
          if (byNormalized !== 0) return byNormalized;
          return String(a.url_original ?? "").localeCompare(String(b.url_original ?? ""));
        });
        blockedUrlsItems.sort((a, b) => String(a.normalized_url ?? "").localeCompare(String(b.normalized_url ?? "")));

        try {
          await atomicWriteJson(onlineFixturesOutputPathAbs, {
            schema_version: "online_fixtures.v1",
            run_id: runId,
            generated_at: generatedAt,
            source_online_fixtures_path: onlineFixturesPath || null,
            online_dry_run: onlineDryRun,
            effective_config: {
              mode,
              mode_source: resolvedConfig.modeSource,
              online_dry_run: onlineDryRun,
              online_dry_run_source: resolvedConfig.onlineDryRunSource,
              endpoints: {
                bright_data: brightDataEndpoint || null,
                apify: apifyEndpoint || null,
              },
              endpoint_sources: {
                bright_data: resolvedConfig.endpointSources.brightData,
                apify: resolvedConfig.endpointSources.apify,
              },
              run_config_path: runConfig ? runConfigPath : null,
            },
            items: onlineFixtureItems,
          });
          await atomicWriteJson(onlineFixturesLatestPathAbs, {
            schema_version: "online_fixtures.latest.v1",
            run_id: runId,
            updated_at: generatedAt,
            ts: tsToken,
            path: onlineFixturesOutputPathAbs,
          });
          await atomicWriteJson(blockedUrlsPathAbs, {
            schema_version: "blocked_urls.v1",
            run_id: runId,
            generated_at: generatedAt,
            items: blockedUrlsItems,
          });
          if (blockedUrlsItems.length > 0) {
            await atomicWriteText(
              blockedUrlsQueuePathAbs,
              formatBlockedUrlsQueueMarkdown({ generatedAt, items: blockedUrlsItems }),
            );
          } else {
            blockedUrlsQueuePath = null;
          }
        } catch (e) {
          return err("WRITE_FAILED", "cannot persist online citation artifacts", {
            online_fixtures_path: onlineFixturesOutputPath,
            blocked_urls_path: blockedUrlsPath,
            blocked_urls_queue_path: blockedUrlsQueuePath,
            message: String(e),
          });
        }
      }

      const inputsDigest = sha256DigestForJson({
        schema: "citations_validate.inputs.v1",
        run_id: runId,
        mode,
        mode_source: resolvedConfig.modeSource,
        endpoint_sources: resolvedConfig.endpointSources,
        bright_data_endpoint: brightDataEndpoint || null,
        apify_endpoint: apifyEndpoint || null,
        url_map: urlMapItems,
        fixture_digest: validationMode === "offline" ? fixtureLookup.fixtureDigest : null,
        online_fixture_digest: validationMode === "online" ? onlineFixtureLookup.fixtureDigest : null,
        online_dry_run: validationMode === "online" ? onlineDryRun : null,
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
            online_fixtures_path: onlineFixturesOutputPath,
            online_fixtures_latest_path: onlineFixturesLatestPath,
            blocked_urls_path: blockedUrlsPath,
            blocked_urls_queue_path: blockedUrlsQueuePath,
            blocked_urls: validationMode === "online" ? blockedUrlsItems.length : 0,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        run_id: runId,
        citations_path: citationsPath,
        mode,
        mode_source: resolvedConfig.modeSource,
        online_dry_run: validationMode === "online" ? onlineDryRun : null,
        online_dry_run_source: validationMode === "online" ? resolvedConfig.onlineDryRunSource : null,
        effective_endpoints: {
          bright_data: brightDataEndpoint || null,
          apify: apifyEndpoint || null,
        },
        endpoint_sources: {
          bright_data: resolvedConfig.endpointSources.brightData,
          apify: resolvedConfig.endpointSources.apify,
        },
        validated: records.length,
        inputs_digest: inputsDigest,
        online_fixtures_path: onlineFixturesOutputPath,
        online_fixtures_latest_path: onlineFixturesLatestPath,
        online_fixtures_count: validationMode === "online" ? onlineFixtureItems.length : 0,
        blocked_urls_path: blockedUrlsPath,
        blocked_urls_queue_path: blockedUrlsQueuePath,
        blocked_urls_count: validationMode === "online" ? blockedUrlsItems.length : 0,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      return err("WRITE_FAILED", "citations_validate failed", { message: String(e) });
    }
  },
});
