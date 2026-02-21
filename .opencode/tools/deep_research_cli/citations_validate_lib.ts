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

const DEFAULT_DIRECT_FETCH_TIMEOUT_MS = 5000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

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

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type OnlineStepName = "direct_fetch" | "bright_data" | "apify";

type OnlineAttempt = {
  step: OnlineStepName;
  outcome: "success" | "failed" | "skipped";
  detail: string;
};

type LadderSuccess = {
  status: CitationStatus;
  notes: string;
  url: string;
  http_status?: number;
  title?: string;
  publisher?: string;
  evidence_snippet?: string;
};

type LadderStepResult =
  | { ok: true; detail: string; data: LadderSuccess }
  | { ok: false; detail: string };

export type OnlineLadderOptions = {
  dryRun?: boolean;
  fixture?: OfflineFixtureEntry | null;
  fetchImpl?: FetchLike;
  directFetchTimeoutMs?: number;
  maxRedirects?: number;
  maxBodyBytes?: number;
  brightDataEndpoint?: string;
  apifyEndpoint?: string;
};

export type OnlineCitationResult = {
  status: CitationStatus;
  notes: string;
  url: string;
  http_status?: number;
  title?: string;
  publisher?: string;
  evidence_snippet?: string;
};

type CitationMode = "offline" | "online" | "dry_run";

export type CitationConfigSource =
  | "manifest.query.sensitivity"
  | "manifest.query.constraints.deep_research_flags"
  | "run-config.effective.citations"
  | "unset"
  | "arg.online_dry_run";

export type ResolvedCitationsConfig = {
  mode: CitationMode;
  modeSource: CitationConfigSource;
  onlineDryRun: boolean;
  onlineDryRunSource: CitationConfigSource;
  brightDataEndpoint: string;
  apifyEndpoint: string;
  endpointSources: {
    brightData: CitationConfigSource;
    apify: CitationConfigSource;
  };
};

function asObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? (value as Record<string, unknown>) : {};
}

function asNonEmptyString(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function modeFromSensitivity(sensitivityRaw: string): CitationMode {
  const sensitivity = sensitivityRaw.trim();
  if (sensitivity === "no_web") return "offline";
  if (sensitivity === "restricted") return "dry_run";
  return "online";
}

function readModeFromRunConfig(runConfig: Record<string, unknown> | null): CitationMode | null {
  if (!runConfig) return null;
  const effective = asObject(runConfig.effective);
  const citations = asObject(effective.citations);
  const mode = asNonEmptyString(citations.mode);
  if (!mode) return null;
  if (mode === "offline" || mode === "online" || mode === "dry_run") return mode;
  return null;
}

function readEndpointFromRunConfig(
  runConfig: Record<string, unknown> | null,
  key: "brightdata" | "apify",
): string | null {
  if (!runConfig) return null;
  const effective = asObject(runConfig.effective);
  const citations = asObject(effective.citations);
  const endpoints = asObject(citations.endpoints);
  return asNonEmptyString(endpoints[key]);
}

function readEndpointFromManifestFlags(
  manifest: Record<string, unknown>,
  key: "PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT" | "PAI_DR_CITATIONS_APIFY_ENDPOINT",
): string | null {
  const query = asObject(manifest.query);
  const constraints = asObject(query.constraints);
  const flags = asObject(constraints.deep_research_flags);
  return asNonEmptyString(flags[key]);
}

export function resolveCitationsConfig(args: {
  manifest: Record<string, unknown>;
  runConfig: Record<string, unknown> | null;
  onlineDryRunArg?: boolean;
}): ResolvedCitationsConfig {
  const query = asObject(args.manifest.query);
  const sensitivity = asNonEmptyString(query.sensitivity);

  const modeFromManifest = sensitivity ? modeFromSensitivity(sensitivity) : null;
  const modeFromRunConfig = readModeFromRunConfig(args.runConfig);
  const mode = modeFromManifest ?? modeFromRunConfig ?? "online";
  const modeSource: CitationConfigSource = modeFromManifest
    ? "manifest.query.sensitivity"
    : modeFromRunConfig
      ? "run-config.effective.citations"
      : "unset";

  const manifestBrightData = readEndpointFromManifestFlags(args.manifest, "PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT");
  const runConfigBrightData = readEndpointFromRunConfig(args.runConfig, "brightdata");
  const brightDataEndpoint = manifestBrightData ?? runConfigBrightData ?? "";
  const brightDataSource: CitationConfigSource = manifestBrightData
    ? "manifest.query.constraints.deep_research_flags"
    : runConfigBrightData
      ? "run-config.effective.citations"
      : "unset";

  const manifestApify = readEndpointFromManifestFlags(args.manifest, "PAI_DR_CITATIONS_APIFY_ENDPOINT");
  const runConfigApify = readEndpointFromRunConfig(args.runConfig, "apify");
  const apifyEndpoint = manifestApify ?? runConfigApify ?? "";
  const apifySource: CitationConfigSource = manifestApify
    ? "manifest.query.constraints.deep_research_flags"
    : runConfigApify
      ? "run-config.effective.citations"
      : "unset";

  const onlineDryRun = mode === "offline"
    ? false
    : args.onlineDryRunArg ?? (mode === "dry_run");
  const onlineDryRunSource: CitationConfigSource = mode === "offline"
    ? "manifest.query.sensitivity"
    : args.onlineDryRunArg === undefined
      ? "run-config.effective.citations"
      : "arg.online_dry_run";

  return {
    mode,
    modeSource,
    onlineDryRun,
    onlineDryRunSource,
    brightDataEndpoint,
    apifyEndpoint,
    endpointSources: {
      brightData: brightDataSource,
      apify: apifySource,
    },
  };
}

function classifyReachabilityStatus(httpStatus: number): CitationStatus | null {
  if (httpStatus >= 200 && httpStatus < 300) return "valid";
  if (httpStatus === 401 || httpStatus === 402 || httpStatus === 403 || httpStatus === 451) return "paywalled";
  if (httpStatus === 404 || httpStatus === 410) return "invalid";
  return null;
}

function extractHtmlTitle(raw: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
  if (!m) return undefined;
  const text = m[1].replace(/\s+/g, " ").trim();
  return text || undefined;
}

function firstSnippet(raw: string, maxChars = 240): string | undefined {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function parseEndpointJson(value: unknown, fallbackUrl: string): LadderSuccess | null {
  if (!isPlainObject(value)) return null;

  const statusRaw = String(value.status ?? "").trim();
  if (!isCitationStatus(statusRaw)) return null;

  const out: LadderSuccess = {
    status: statusRaw,
    notes: isNonEmptyString(value.notes) ? value.notes.trim() : `online ladder endpoint status=${statusRaw}`,
    url: isNonEmptyString(value.url) ? value.url.trim() : fallbackUrl,
  };

  if (typeof value.http_status === "number" && Number.isFinite(value.http_status)) out.http_status = Math.trunc(value.http_status);
  if (isNonEmptyString(value.title)) out.title = value.title.trim();
  if (isNonEmptyString(value.publisher)) out.publisher = value.publisher.trim();
  if (isNonEmptyString(value.evidence_snippet)) out.evidence_snippet = value.evidence_snippet.trim();
  return out;
}

async function fetchWithSsrfCheckedRedirects(args: {
  fetchImpl: FetchLike;
  url: string;
  timeoutMs: number;
  maxRedirects: number;
}): Promise<Response> {
  let currentUrl = args.url;

  for (let hop = 0; hop <= args.maxRedirects; hop += 1) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), args.timeoutMs);
    try {
      const response = await args.fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        if (hop === args.maxRedirects) {
          throw new Error(`redirect limit exceeded (${args.maxRedirects})`);
        }

        const location = response.headers.get("location");
        if (!location) {
          throw new Error("redirect missing location header");
        }

        const nextUrl = new URL(location, currentUrl).toString();
        const preflight = classifyOnlineUrlPreflight(nextUrl);
        if (!preflight.ok) {
          throw new Error(`redirect blocked by SSRF policy: ${preflight.result.notes}`);
        }
        currentUrl = preflight.url;
        continue;
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("redirect processing failed");
}

async function readResponseTextWithinCap(response: Response, maxBodyBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new Error(`response body too large (${contentLength} bytes > ${maxBodyBytes})`);
  }

  const text = await response.text();
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBodyBytes) {
    throw new Error(`response body exceeded cap (${bytes} bytes > ${maxBodyBytes})`);
  }
  return text;
}

async function runDirectFetchStep(args: {
  url: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRedirects: number;
  maxBodyBytes: number;
}): Promise<LadderStepResult> {
  try {
    const response = await fetchWithSsrfCheckedRedirects({
      fetchImpl: args.fetchImpl,
      url: args.url,
      timeoutMs: args.timeoutMs,
      maxRedirects: args.maxRedirects,
    });

    const classifiedStatus = classifyReachabilityStatus(response.status);
    if (!classifiedStatus) {
      return { ok: false, detail: `http ${response.status}` };
    }

    if (classifiedStatus === "valid") {
      const body = await readResponseTextWithinCap(response, args.maxBodyBytes);
      return {
        ok: true,
        detail: `http ${response.status}`,
        data: {
          status: "valid",
          notes: "online ladder: direct_fetch",
          url: args.url,
          http_status: response.status,
          title: extractHtmlTitle(body),
          evidence_snippet: firstSnippet(body),
        },
      };
    }

    return {
      ok: true,
      detail: `http ${response.status}`,
      data: {
        status: classifiedStatus,
        notes: "online ladder: direct_fetch",
        url: args.url,
        http_status: response.status,
      },
    };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

async function runEndpointStep(args: {
  step: "bright_data" | "apify";
  endpoint: string;
  url: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<LadderStepResult> {
  if (!args.endpoint) return { ok: false, detail: "endpoint not configured" };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), args.timeoutMs);
  try {
    const response = await args.fetchImpl(args.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: args.url, ladder_step: args.step }),
      signal: ctrl.signal,
    });

    if (!response.ok) {
      return { ok: false, detail: `endpoint http ${response.status}` };
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (e) {
      return { ok: false, detail: `invalid endpoint json: ${String(e)}` };
    }

    const payload = parseEndpointJson(parsed, args.url);
    if (!payload) return { ok: false, detail: "endpoint response missing citation status" };
    if (payload.status === "blocked") return { ok: false, detail: "endpoint returned blocked" };

    payload.notes = `${payload.notes}; online ladder: ${args.step}`;
    return { ok: true, detail: "endpoint success", data: payload };
  } catch (e) {
    return { ok: false, detail: String(e) };
  } finally {
    clearTimeout(timeout);
  }
}

function classifyOnlineUrlPreflight(urlValue: string):
  | { ok: true; url: string }
  | { ok: false; result: OnlineCitationResult } {
  const redacted = redactSensitiveUrl(urlValue);
  try {
    const parsed = new URL(redacted.value);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return {
        ok: false,
        result: {
          status: "invalid",
          notes: "online ladder: disallowed protocol",
          url: redacted.value,
        },
      };
    }
    if (isPrivateOrLocalHost(parsed.hostname)) {
      return {
        ok: false,
        result: {
          status: "invalid",
          notes: "online ladder: private/local target blocked by SSRF policy",
          url: redacted.value,
        },
      };
    }
    if (redacted.hadUserinfo) {
      return {
        ok: false,
        result: {
          status: "invalid",
          notes: "online ladder: userinfo stripped and marked invalid",
          url: redacted.value,
        },
      };
    }
    return { ok: true, url: redacted.value };
  } catch {
    return {
      ok: false,
      result: {
        status: "invalid",
        notes: "online ladder: malformed URL",
        url: redacted.value,
      },
    };
  }
}

function fixtureToOnlineResult(url: string, fixture: OfflineFixtureEntry): OnlineCitationResult {
  const status = isCitationStatus(fixture.status) ? fixture.status : "invalid";
  const baseNotes = fixture.notes?.trim() || `online fixture status=${status}`;
  const notes = baseNotes.includes("online ladder:")
    ? baseNotes
    : `${baseNotes}; online ladder: fixture`;

  const out: OnlineCitationResult = {
    status,
    notes,
    url: fixture.url?.trim() || url,
  };
  if (typeof fixture.http_status === "number" && Number.isFinite(fixture.http_status)) out.http_status = Math.trunc(fixture.http_status);
  if (isNonEmptyString(fixture.title)) out.title = fixture.title.trim();
  if (isNonEmptyString(fixture.publisher)) out.publisher = fixture.publisher.trim();
  if (isNonEmptyString(fixture.evidence_snippet)) out.evidence_snippet = fixture.evidence_snippet.trim();
  return out;
}

function formatLadderAttempts(attempts: OnlineAttempt[]): string {
  return attempts.map((attempt) => `${attempt.step}=${attempt.outcome}(${attempt.detail})`).join("; ");
}

export async function classifyOnlineWithLadder(urlValue: string, options: OnlineLadderOptions = {}): Promise<OnlineCitationResult> {
  const preflight = classifyOnlineUrlPreflight(urlValue);
  if (!preflight.ok) return preflight.result;

  if (options.fixture) return fixtureToOnlineResult(preflight.url, options.fixture);

  const dryRun = options.dryRun === true;
  const attempts: OnlineAttempt[] = [];
  const fetchImpl = options.fetchImpl ?? fetch;

  if (dryRun) {
    attempts.push({ step: "direct_fetch", outcome: "skipped", detail: "dry-run" });
    attempts.push({ step: "bright_data", outcome: "skipped", detail: "dry-run" });
    attempts.push({ step: "apify", outcome: "skipped", detail: "dry-run" });
    return {
      status: "blocked",
      notes: `online ladder blocked: ${formatLadderAttempts(attempts)}`,
      url: preflight.url,
    };
  }

  const direct = await runDirectFetchStep({
    url: preflight.url,
    fetchImpl,
    timeoutMs: options.directFetchTimeoutMs ?? DEFAULT_DIRECT_FETCH_TIMEOUT_MS,
    maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
  });
  if (direct.ok) return direct.data;
  attempts.push({ step: "direct_fetch", outcome: "failed", detail: direct.detail });

  const bright = await runEndpointStep({
    step: "bright_data",
    endpoint: (options.brightDataEndpoint ?? "").trim(),
    url: preflight.url,
    fetchImpl,
    timeoutMs: options.directFetchTimeoutMs ?? DEFAULT_DIRECT_FETCH_TIMEOUT_MS,
  });
  if (bright.ok) return bright.data;
  attempts.push({ step: "bright_data", outcome: "failed", detail: bright.detail });

  const apify = await runEndpointStep({
    step: "apify",
    endpoint: (options.apifyEndpoint ?? "").trim(),
    url: preflight.url,
    fetchImpl,
    timeoutMs: options.directFetchTimeoutMs ?? DEFAULT_DIRECT_FETCH_TIMEOUT_MS,
  });
  if (apify.ok) return apify.data;
  attempts.push({ step: "apify", outcome: "failed", detail: apify.detail });

  return {
    status: "blocked",
    notes: `online ladder blocked: ${formatLadderAttempts(attempts)}`,
    url: preflight.url,
  };
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
    if (isNonEmptyString(item.source_line)) {
      entry.source_line = item.source_line.trim();
    }
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
