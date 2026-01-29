import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface RedirectResolutionOptions {
  /** Cache entries older than this are re-resolved. Default: 7 days. */
  ttlMs?: number;
  /** Per-attempt timeout. Default: 8000ms. */
  timeoutMs?: number;
  /** Maximum resolution attempts per URL. Default: 7. */
  maxAttempts?: number;
  /** Initial delay for exponential backoff. Default: 500ms. */
  initialDelayMs?: number;
  /** Maximum backoff delay cap. Default: 20000ms. */
  maxDelayMs?: number;
  /** Maximum concurrent resolutions. Default: 3. */
  concurrency?: number;
  /** Enable debug logging to stderr. */
  debug?: boolean;
}

export interface RedirectCacheEntry {
  resolvedUrl?: string;
  resolvedAt?: string;
  lastTriedAt: string;
  attempts: number;
  lastStatus?: number;
  lastError?: string;
}

export interface RedirectCache {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  entries: Record<string, RedirectCacheEntry>;
}

export interface ResolveResult {
  redirectUrl: string;
  ok: boolean;
  resolvedUrl?: string;
  fromCache?: boolean;
  status?: number;
  error?: string;
  /** Number of network attempts performed (0 when served from cache). */
  attempts: number;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_ATTEMPTS = 7;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 20000;
const DEFAULT_CONCURRENCY = 3;

const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'spm',
]);

function nowIso(): string {
  return new Date().toISOString();
}

function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function isRetryableErrorMessage(message: string): boolean {
  return (
    /timeout/i.test(message) ||
    /timed out/i.test(message) ||
    /network/i.test(message) ||
    /ECONNRESET/i.test(message) ||
    /ECONNREFUSED/i.test(message) ||
    /ETIMEDOUT/i.test(message) ||
    /ENOTFOUND/i.test(message) ||
    /socket hang up/i.test(message)
  );
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function calculateBackoffDelayMs(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  retryAfterMs?: number,
): number {
  const exp = Math.min(maxDelayMs, Math.round(initialDelayMs * 2 ** attempt));
  const cap = retryAfterMs ? Math.max(exp, retryAfterMs) : exp;

  // Full jitter with optional floor (Retry-After).
  const floor = retryAfterMs ? Math.min(retryAfterMs, cap) : 0;
  const jitterRange = cap - floor;
  const jitter = jitterRange > 0 ? Math.random() * jitterRange : 0;
  return Math.max(0, Math.round(floor + jitter));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripTrackingParams(urlString: string): string {
  try {
    const url = new URL(urlString);

    for (const key of Array.from(url.searchParams.keys())) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith('utm_') || TRACKING_QUERY_PARAMS.has(normalized)) {
        url.searchParams.delete(key);
      }
    }

    // Remove empty query.
    if (Array.from(url.searchParams.keys()).length === 0) {
      url.search = '';
    }

    return url.toString();
  } catch {
    return urlString;
  }
}

function unwrapKnownRedirectors(urlString: string): string {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();

    // Google redirector.
    if ((host === 'google.com' || host === 'www.google.com') && url.pathname === '/url') {
      const q = url.searchParams.get('q') || url.searchParams.get('url');
      if (q) return q;
    }

    return urlString;
  } catch {
    return urlString;
  }
}

export function canonicalizeResolvedUrl(urlString: string): string {
  // Unwrap once, then strip tracking params.
  const unwrapped = unwrapKnownRedirectors(urlString);
  return stripTrackingParams(unwrapped);
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, path);
}

export async function loadRedirectCache(cachePath: string): Promise<RedirectCache> {
  try {
    const st = await stat(cachePath);
    if (!st.isFile()) throw new Error('cachePath is not a file');
    const raw = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as RedirectCache;
    if (!parsed || parsed.schemaVersion !== 1 || !parsed.entries) {
      throw new Error('invalid cache schema');
    }
    return parsed;
  } catch {
    return {
      schemaVersion: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      entries: {},
    };
  }
}

export async function saveRedirectCache(cachePath: string, cache: RedirectCache): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
  cache.updatedAt = nowIso();
  await writeFileAtomic(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

async function resolveOnce(
  redirectUrl: string,
  timeoutMs: number,
): Promise<{ ok: true; resolvedUrl: string; status: number } | { ok: false; status?: number; error: string; retryAfterMs?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const tryFetch = async (method: 'HEAD' | 'GET') => {
    const res = await fetch(redirectUrl, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Minimal UA helps some redirectors.
        'User-Agent': 'research-shell/redirect-resolver',
        Accept: '*/*',
      },
    });
    return res;
  };

  try {
    let res = await tryFetch('HEAD');

    // Some redirectors disallow HEAD.
    if (res.status === 405 || res.status === 403) {
      res = await tryFetch('GET');
    }

    // Abort body consumption; we only need final URL.
    try {
      await res.body?.cancel();
    } catch {
      // ignore
    }

    const retryAfterMs = parseRetryAfterMs(res.headers);

    if (!res.ok && isRetryableStatus(res.status)) {
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}`,
        retryAfterMs,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}`,
        retryAfterMs,
      };
    }

    return { ok: true, resolvedUrl: res.url, status: res.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = isRetryableErrorMessage(message);
    return {
      ok: false,
      error: retryable ? message : `Non-retryable: ${message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveRedirectWithBackoff(
  redirectUrl: string,
  options: RedirectResolutionOptions = {},
): Promise<ResolveResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await resolveOnce(redirectUrl, timeoutMs);
    if (res.ok) {
      const canon = canonicalizeResolvedUrl(res.resolvedUrl);
      try {
        const u = new URL(canon);
        if (u.hostname.toLowerCase() === 'vertexaisearch.cloud.google.com') {
          return {
            redirectUrl,
            ok: false,
            status: res.status,
            error: 'Resolved to redirect host',
            attempts: attempt + 1,
          };
        }
      } catch {
        // If URL parsing fails, still return the canonical string.
      }

      return {
        redirectUrl,
        ok: true,
        resolvedUrl: canon,
        status: res.status,
        attempts: attempt + 1,
      };
    }

    const status = res.status;
    const error = res.error;

    const retryable =
      isRetryableStatus(status) ||
      (status === undefined && isRetryableErrorMessage(error));

    if (options.debug) {
      console.error(
        `[redirect] attempt ${attempt + 1}/${maxAttempts} failed: ${redirectUrl} (${status ?? 'no-status'}) ${error}`,
      );
    }

    if (!retryable) {
      return { redirectUrl, ok: false, status, error, attempts: attempt + 1 };
    }

    if (attempt === maxAttempts - 1) {
      break;
    }

    const delay = calculateBackoffDelayMs(
      attempt,
      initialDelayMs,
      maxDelayMs,
      res.retryAfterMs,
    );
    await sleep(delay);
  }

  return {
    redirectUrl,
    ok: false,
    error: `Failed to resolve after ${maxAttempts} attempts`,
    attempts: maxAttempts,
  };
}

function isFresh(entry: RedirectCacheEntry, ttlMs: number): boolean {
  if (!entry.resolvedUrl || !entry.resolvedAt) return false;
  const t = Date.parse(entry.resolvedAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= ttlMs;
}

async function asyncPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;

  const run = async (): Promise<void> => {
    while (true) {
      const idx = i;
      i += 1;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]);
    }
  };

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

export async function resolveRedirectsWithCache(
  redirectUrls: string[],
  cachePath: string,
  options: RedirectResolutionOptions = {},
): Promise<{ results: ResolveResult[]; cacheHits: number; cacheSaveError?: string }>
{
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  const cache = await loadRedirectCache(cachePath);
  const unique = Array.from(new Set(redirectUrls.filter((u) => u && u.trim().length > 0)));

  let cacheHits = 0;
  const toResolve: string[] = [];

  for (const url of unique) {
    const entry = cache.entries[url];
    if (entry && isFresh(entry, ttlMs)) {
      cacheHits += 1;
    } else {
      toResolve.push(url);
    }
  }

  const resolved = await asyncPool(toResolve, concurrency, async (url) => {
    const result = await resolveRedirectWithBackoff(url, options);
    const entry: RedirectCacheEntry = cache.entries[url] ?? {
      lastTriedAt: nowIso(),
      attempts: 0,
    };

    entry.lastTriedAt = nowIso();
    entry.attempts += 1;
    entry.lastStatus = result.status;
    entry.lastError = result.ok ? undefined : result.error;

    if (result.ok && result.resolvedUrl) {
      entry.resolvedUrl = result.resolvedUrl;
      entry.resolvedAt = nowIso();
    }

    cache.entries[url] = entry;
    return result;
  });

  // Build final results aligned with unique URLs.
  const byUrl = new Map<string, ResolveResult>();
  for (const url of unique) {
    const entry = cache.entries[url];
    if (entry && isFresh(entry, ttlMs) && entry.resolvedUrl) {
      byUrl.set(url, {
        redirectUrl: url,
        ok: true,
        resolvedUrl: entry.resolvedUrl,
        fromCache: true,
        attempts: 0,
      });
    }
  }

  for (const r of resolved) byUrl.set(r.redirectUrl, r);

  let cacheSaveError: string | undefined;
  try {
    await saveRedirectCache(cachePath, cache);
  } catch (error) {
    cacheSaveError = error instanceof Error ? error.message : String(error);
  }

  return {
    results: unique.map(
      (u) =>
        byUrl.get(u) ?? {
          redirectUrl: u,
          ok: false,
          error: 'Unknown',
          attempts: 0,
        },
    ),
    cacheHits,
    cacheSaveError,
  };
}
