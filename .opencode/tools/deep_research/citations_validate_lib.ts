import * as fs from "node:fs";

import {
  isNonEmptyString,
  isPlainObject,
  readJson,
  sha256DigestForJson,
  type CitationStatus,
  type OfflineFixtureEntry,
  type OfflineFixtureLookup,
  type UrlMapItemV1,
} from "./citations_lib";

export function validateUrlMapV1(
  value: unknown,
  expectedRunId: string,
):
  | { ok: true; items: UrlMapItemV1[] }
  | { ok: false; message: string; details: Record<string, unknown> } {
  if (!isPlainObject(value)) return { ok: false, message: "url-map must be object", details: {} };
  if (value.schema_version !== "url_map.v1") {
    return { ok: false, message: "url-map schema_version must be url_map.v1", details: { schema_version: value.schema_version ?? null } };
  }
  if (String(value.run_id ?? "") !== expectedRunId) {
    return {
      ok: false,
      message: "url-map run_id mismatch",
      details: { expected_run_id: expectedRunId, got: String(value.run_id ?? "") },
    };
  }

  const itemsRaw = (value as Record<string, unknown>).items;
  if (!Array.isArray(itemsRaw)) return { ok: false, message: "url-map items must be array", details: {} };

  const items: UrlMapItemV1[] = [];
  for (let i = 0; i < itemsRaw.length; i += 1) {
    const raw = itemsRaw[i];
    if (!isPlainObject(raw)) return { ok: false, message: "url-map item must be object", details: { index: i } };
    const urlOriginal = String(raw.url_original ?? "").trim();
    const normalizedUrl = String(raw.normalized_url ?? "").trim();
    const cid = String(raw.cid ?? "").trim();
    if (!urlOriginal || !normalizedUrl || !cid) {
      return {
        ok: false,
        message: "url-map item missing required fields",
        details: { index: i, url_original: urlOriginal, normalized_url: normalizedUrl, cid },
      };
    }
    items.push({ url_original: urlOriginal, normalized_url: normalizedUrl, cid });
  }
  return { ok: true, items };
}

export function isCitationStatus(value: unknown): value is CitationStatus {
  return value === "valid" || value === "paywalled" || value === "blocked" || value === "mismatch" || value === "invalid";
}

export function appendNote(current: string, next: string): string {
  const base = current.trim();
  const tail = next.trim();
  if (!base) return tail;
  if (!tail) return base;
  return `${base}; ${tail}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function emptyOfflineFixtureLookup(): OfflineFixtureLookup {
  return {
    byNormalized: new Map(),
    byOriginal: new Map(),
    byCid: new Map(),
    fixtureDigest: sha256DigestForJson({ schema: "citations_validate.offline_fixtures.v1", items: [] }),
  };
}

export function buildOfflineFixtureLookup(
  value: unknown,
):
  | { ok: true; lookup: OfflineFixtureLookup }
  | { ok: false; message: string; details: Record<string, unknown> } {
  let itemsRaw: unknown[] = [];
  if (Array.isArray(value)) {
    itemsRaw = value;
  } else if (isPlainObject(value) && Array.isArray((value as Record<string, unknown>).items)) {
    itemsRaw = ((value as Record<string, unknown>).items as unknown[]);
  } else if (isPlainObject(value)) {
    itemsRaw = Object.entries(value).map(([normalized, entry]) => {
      if (isPlainObject(entry)) return { normalized_url: normalized, ...entry };
      return { normalized_url: normalized, status: String(entry ?? "") };
    });
  } else {
    return { ok: false, message: "offline fixtures must be array/object", details: {} };
  }

  const byNormalized = new Map<string, OfflineFixtureEntry>();
  const byOriginal = new Map<string, OfflineFixtureEntry>();
  const byCid = new Map<string, OfflineFixtureEntry>();
  const normalizedForDigest: OfflineFixtureEntry[] = [];

  for (let i = 0; i < itemsRaw.length; i += 1) {
    const raw = itemsRaw[i];
    if (!isPlainObject(raw)) {
      return { ok: false, message: "offline fixture entry must be object", details: { index: i } };
    }
    const item: OfflineFixtureEntry = {
      normalized_url: isNonEmptyString(raw.normalized_url) ? raw.normalized_url.trim() : undefined,
      url_original: isNonEmptyString(raw.url_original) ? raw.url_original.trim() : undefined,
      cid: isNonEmptyString(raw.cid) ? raw.cid.trim() : undefined,
      status: isNonEmptyString(raw.status) ? raw.status.trim() : undefined,
      url: isNonEmptyString(raw.url) ? raw.url.trim() : undefined,
      http_status: isFiniteNumber(raw.http_status) ? Math.trunc(raw.http_status) : undefined,
      title: isNonEmptyString(raw.title) ? raw.title.trim() : undefined,
      publisher: isNonEmptyString(raw.publisher) ? raw.publisher.trim() : undefined,
      evidence_snippet: isNonEmptyString(raw.evidence_snippet) ? raw.evidence_snippet.trim() : undefined,
      notes: isNonEmptyString(raw.notes) ? raw.notes.trim() : undefined,
    };

    if (item.normalized_url) byNormalized.set(item.normalized_url, item);
    if (item.url_original) byOriginal.set(item.url_original, item);
    if (item.cid) byCid.set(item.cid, item);
    normalizedForDigest.push(item);
  }

  return {
    ok: true,
    lookup: {
      byNormalized,
      byOriginal,
      byCid,
      fixtureDigest: sha256DigestForJson({
        schema: "citations_validate.offline_fixtures.v1",
        items: normalizedForDigest,
      }),
    },
  };
}

export function findFixtureForUrlMapItem(lookup: OfflineFixtureLookup, item: UrlMapItemV1): OfflineFixtureEntry | null {
  return lookup.byNormalized.get(item.normalized_url)
    ?? lookup.byOriginal.get(item.url_original)
    ?? lookup.byCid.get(item.cid)
    ?? null;
}

const SENSITIVE_QUERY_KEYS = ["token", "key", "api_key", "access_token", "auth", "session", "password"];

export function redactSensitiveUrl(input: string): { value: string; hadUserinfo: boolean } {
  try {
    const parsed = new URL(input);
    const hadUserinfo = Boolean(parsed.username || parsed.password);
    parsed.username = "";
    parsed.password = "";

    const keys = Array.from(new Set([...parsed.searchParams.keys()]));
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (SENSITIVE_QUERY_KEYS.some((needle) => lower.includes(needle))) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    return { value: parsed.toString(), hadUserinfo };
  } catch {
    return { value: input, hadUserinfo: false };
  }
}

function isPrivateOrLocalHost(hostnameInput: string): boolean {
  const hostname = hostnameInput.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (hostname === "localhost" || hostname === "::1") return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const parts = ipv4.slice(1).map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
  if (hostname.startsWith("fe8") || hostname.startsWith("fe9") || hostname.startsWith("fea") || hostname.startsWith("feb")) return true;
  return false;
}

export function classifyOnlineStub(urlValue: string): { status: CitationStatus; notes: string; url: string } {
  const redacted = redactSensitiveUrl(urlValue);
  try {
    const parsed = new URL(redacted.value);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return { status: "invalid", notes: "online stub: disallowed protocol", url: redacted.value };
    }
    if (isPrivateOrLocalHost(parsed.hostname)) {
      return { status: "invalid", notes: "online stub: private/local target blocked by SSRF policy", url: redacted.value };
    }
    if (redacted.hadUserinfo) {
      return { status: "invalid", notes: "online stub: userinfo stripped and marked invalid", url: redacted.value };
    }
    return {
      status: "blocked",
      notes: "online stub: ladder placeholder [direct_fetch -> bright_data -> apify]",
      url: redacted.value,
    };
  } catch {
    return { status: "invalid", notes: "online stub: malformed URL", url: redacted.value };
  }
}

export async function readJsonlObjects(filePath: string): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      throw new SyntaxError(`invalid JSONL at line ${i + 1}: ${String(e)}`);
    }
    if (!isPlainObject(parsed)) {
      throw new SyntaxError(`invalid JSONL object at line ${i + 1}`);
    }
    out.push(parsed);
  }
  return out;
}

export async function readFoundByLookup(foundByPath: string): Promise<Map<string, Array<Record<string, unknown>>>> {
  const out = new Map<string, Array<Record<string, unknown>>>();
  let raw: unknown;
  try {
    raw = await readJson(foundByPath);
  } catch {
    return out;
  }

  if (!isPlainObject(raw) || !Array.isArray((raw as Record<string, unknown>).items)) return out;
  for (const item of (raw as Record<string, unknown>).items as unknown[]) {
    if (!isPlainObject(item)) continue;
    const urlOriginal = String(item.url_original ?? "").trim();
    if (!urlOriginal) continue;

    const waveRaw = String(item.wave ?? "").trim();
    const wave = waveRaw === "wave-2" ? 2 : 1;
    const perspectiveId = String(item.perspective_id ?? "").trim();
    const entry: Record<string, unknown> = {
      wave,
      perspective_id: perspectiveId || "unknown",
      agent_type: "unknown",
      artifact_path: perspectiveId ? `${waveRaw || `wave-${wave}`}/${perspectiveId}.md` : `${waveRaw || `wave-${wave}`}/unknown.md`,
    };
    const list = out.get(urlOriginal) ?? [];
    list.push(entry);
    out.set(urlOriginal, list);
  }

  for (const [key, value] of out.entries()) {
    value.sort((a, b) => {
      const byWave = Number(a.wave ?? 0) - Number(b.wave ?? 0);
      if (byWave !== 0) return byWave;
      const byPerspective = String(a.perspective_id ?? "").localeCompare(String(b.perspective_id ?? ""));
      if (byPerspective !== 0) return byPerspective;
      return String(a.artifact_path ?? "").localeCompare(String(b.artifact_path ?? ""));
    });
    out.set(key, value);
  }

  return out;
}
