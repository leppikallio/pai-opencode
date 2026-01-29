import { join } from 'node:path';

import {
  resolveRedirectsWithCache,
  type RedirectResolutionOptions,
} from './RedirectResolver.js';

export type GroundingStatus = 'ok' | 'missing' | 'partial' | 'offset_mismatch';

export interface ResolvedReference {
  refNum: number;
  chunkIndex: number;
  redirectUrl: string;
  resolvedUrl: string;
  title?: string;
  domain?: string;
}

export interface DroppedReference {
  chunkIndex: number;
  redirectUrl: string;
  title?: string;
  domain?: string;
  lastStatus?: number;
  lastError?: string;
}

export interface RedirectResolutionSummary {
  attemptsTotal: number;
  resolvedCount: number;
  droppedCount: number;
  usedCacheCount: number;
  durationMs: number;
}

export interface GeminiRenderedResult {
  content: string;
  groundingStatus: GroundingStatus;
  warning?: string;
  webSearchQueries?: string[];
  citationStyle?: 'ieee';
  resolvedReferences?: ResolvedReference[];
  droppedReferences?: DroppedReference[];
  redirectResolution?: RedirectResolutionSummary;
}

type GroundingChunkWeb = {
  uri: string;
  title?: string;
  domain?: string;
};

type GroundingSupportSegment = {
  startIndex?: number;
  endIndex?: number;
  text?: string;
  partIndex?: number;
};

type GroundingSupport = {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
};

type GroundingMetadata = {
  webSearchQueries?: string[];
  groundingChunks?: Array<{ web?: GroundingChunkWeb }>;
  groundingSupports?: GroundingSupport[];
};

type Candidate = {
  content?: { parts?: Array<{ text?: string }> };
  groundingMetadata?: GroundingMetadata;
};

function extractCandidateFromRaw(raw: unknown): Candidate | undefined {
  const r = raw as
    | {
        response?: { candidates?: Candidate[] };
        candidates?: Candidate[];
      }
    | undefined;

  const c1 = r?.response?.candidates?.[0];
  if (c1) return c1;
  const c2 = r?.candidates?.[0];
  return c2;
}

function normalizeChunkIndices(indices: unknown): number[] {
  if (!Array.isArray(indices)) return [];
  return indices
    .map((x) => (typeof x === 'number' ? x : Number.NaN))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

function normalizeSupportSegment(seg: unknown): GroundingSupportSegment | undefined {
  if (!seg || typeof seg !== 'object') return undefined;
  const s = seg as Record<string, unknown>;
  const startIndex = typeof s.startIndex === 'number' ? s.startIndex : undefined;
  const endIndex = typeof s.endIndex === 'number' ? s.endIndex : undefined;
  const text = typeof s.text === 'string' ? s.text : undefined;
  const partIndex = typeof s.partIndex === 'number' ? s.partIndex : undefined;
  return { startIndex, endIndex, text, partIndex };
}

function normalizeGroundingMetadata(meta: unknown): GroundingMetadata {
  const m = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};

  const webSearchQueries = Array.isArray(m.webSearchQueries)
    ? (m.webSearchQueries as unknown[]).filter((x: unknown) => typeof x === 'string')
    : undefined;

  const groundingChunks = Array.isArray(m.groundingChunks)
    ? (m.groundingChunks as unknown[]).flatMap((chunk) => {
        if (!chunk || typeof chunk !== 'object') return [];
        const chunkObj = chunk as Record<string, unknown>;
        const web = chunkObj.web;
        if (!web || typeof web !== 'object') return [];
        const webObj = web as Record<string, unknown>;
        if (typeof webObj.uri !== 'string') return [];
        return [
          {
            web: {
              uri: webObj.uri,
              title:
                typeof webObj.title === 'string' ? webObj.title : undefined,
              domain:
                typeof webObj.domain === 'string' ? webObj.domain : undefined,
            },
          },
        ];
      })
    : undefined;

  const groundingSupports = Array.isArray(m.groundingSupports)
    ? (m.groundingSupports as unknown[]).flatMap((support) => {
        if (!support || typeof support !== 'object') return [];
        const supportObj = support as Record<string, unknown>;
        const segment = normalizeSupportSegment(supportObj.segment);
        if (!segment) return [];
        const groundingChunkIndices = normalizeChunkIndices(
          supportObj.groundingChunkIndices,
        );
        return [{ segment, groundingChunkIndices }];
      })
    : undefined;

  return { webSearchQueries, groundingChunks, groundingSupports };
}

function groupInsertionsByPart(
  supports: Array<{ partIndex: number; endIndex: number; refNums: number[] }>,
  partBuffers: Buffer[],
): Map<number, Map<number, number[]>> {
  const byPart = new Map<number, Map<number, number[]>>();

  for (const s of supports) {
    const buf = partBuffers[s.partIndex];
    if (!buf) continue;

    let pos = s.endIndex;
    if (pos > 0 && pos <= buf.length) {
      const prev = buf[pos - 1];
      // If the segment ends with ASCII punctuation, insert citation before it.
      if (
        prev === 0x2e || // .
        prev === 0x2c || // ,
        prev === 0x3b || // ;
        prev === 0x3a || // :
        prev === 0x29 || // )
        prev === 0x5d // ]
      ) {
        pos -= 1;
      }
    }

    const partMap = byPart.get(s.partIndex) ?? new Map<number, number[]>();
    const existing = partMap.get(pos) ?? [];
    const merged = Array.from(new Set([...existing, ...s.refNums])).sort(
      (a, b) => a - b,
    );
    partMap.set(pos, merged);
    byPart.set(s.partIndex, partMap);
  }

  return byPart;
}

function applyInsertionsToBuffer(buf: Buffer, insertions: Map<number, number[]>): Buffer {
  const entries = Array.from(insertions.entries()).sort((a, b) => b[0] - a[0]);
  let out = buf;

  for (const [pos, refNums] of entries) {
    if (pos < 0 || pos > out.length) continue;
    const marker = ` [${refNums.join('], [')}]`;
    const markerBuf = Buffer.from(marker, 'utf8');
    out = Buffer.concat([out.subarray(0, pos), markerBuf, out.subarray(pos)]);
  }

  return out;
}

function stripTrailingSources(text: string): string {
  // Defensive: remove trailing "---\n**Sources:**" blocks if present.
  const marker = '\n---\n**Sources:**\n';
  const idx = text.lastIndexOf(marker);
  if (idx === -1) return text;
  return text.slice(0, idx).trimEnd();
}

function renderReferences(refs: ResolvedReference[]): string {
  const ordered = [...refs].sort((a, b) => a.refNum - b.refNum);
  if (ordered.length === 0) return '';
  return ordered.map((r) => `[${r.refNum}] ${r.resolvedUrl}`).join('\n');
}

function sanitizeNoVertexLinks(text: string): string {
  // Never emit the redirect host in tool output.
  return text.replace(
    /https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^\s)\]}>"']+/g,
    '[REDACTED_GROUNDING_REDIRECT_URL]',
  );
}

export async function renderGeminiWithGrounding(
  raw: unknown,
  sessionDirReal: string,
  options: RedirectResolutionOptions = {},
): Promise<GeminiRenderedResult> {
  const candidate = extractCandidateFromRaw(raw);
  const rawParts = candidate?.content?.parts ?? [];
  const partTexts = rawParts.map((p) => (typeof p.text === 'string' ? p.text : ''));
  const hasAnyText = partTexts.some((t) => t.length > 0);
  const baseText = partTexts.length > 0 ? partTexts.join('\n') : '';
  const meta = normalizeGroundingMetadata(candidate?.groundingMetadata);
  const webSearchQueries = meta.webSearchQueries;

  const chunks = meta.groundingChunks ?? [];
  const supports = meta.groundingSupports ?? [];

  const hasChunks = chunks.length > 0;
  const hasSupports = supports.length > 0;

  if (!candidate || partTexts.length === 0 || !hasAnyText) {
    return {
      content: baseText,
      groundingStatus: 'missing',
      warning: 'WARNING: Missing Gemini candidate content; no grounding applied.',
      webSearchQueries,
    };
  }

  if (!hasChunks || !hasSupports) {
    const status: GroundingStatus = hasChunks || hasSupports ? 'partial' : 'missing';
    const warning =
      status === 'missing'
        ? 'WARNING: Grounding metadata missing; emitting answer without citations.'
        : 'WARNING: Grounding metadata partial; emitting answer without citations.';

    const cleaned = sanitizeNoVertexLinks(stripTrailingSources(partTexts.join('\n')));
    return {
      content: cleaned,
      groundingStatus: status,
      warning,
      webSearchQueries,
    };
  }

  const redirectUrlsByChunkIndex = new Map<number, { redirectUrl: string; title?: string; domain?: string }>();
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const web = chunk.web;
    if (!web?.uri) continue;
    redirectUrlsByChunkIndex.set(chunkIndex, {
      redirectUrl: web.uri,
      title: web.title,
      domain: web.domain,
    });
  }

  const redirectUrls = Array.from(redirectUrlsByChunkIndex.values()).map((x) => x.redirectUrl);
  const cachePath = join(sessionDirReal, 'research-shell', 'cache', 'redirects.json');

  const t0 = Date.now();
  const { results, cacheHits, cacheSaveError } = await resolveRedirectsWithCache(redirectUrls, cachePath, {
    ttlMs: options.ttlMs,
    timeoutMs: options.timeoutMs,
    maxAttempts: options.maxAttempts,
    initialDelayMs: options.initialDelayMs,
    maxDelayMs: options.maxDelayMs,
    concurrency: options.concurrency,
    debug: options.debug,
  });
  const resolverMs = Date.now() - t0;

  const resolvedByRedirect = new Map<string, { ok: boolean; resolvedUrl?: string; status?: number; error?: string; fromCache?: boolean }>();
  for (const r of results) resolvedByRedirect.set(r.redirectUrl, r);

  const resolvedChunkIndexSet = new Set<number>();
  const droppedReferences: DroppedReference[] = [];

  for (const [chunkIndex, info] of redirectUrlsByChunkIndex.entries()) {
    const rr = resolvedByRedirect.get(info.redirectUrl);
    if (rr?.ok && rr.resolvedUrl) {
      resolvedChunkIndexSet.add(chunkIndex);
    } else {
      droppedReferences.push({
        chunkIndex,
        redirectUrl: info.redirectUrl,
        title: info.title,
        domain: info.domain,
        lastStatus: rr?.status,
        lastError: rr?.error,
      });
    }
  }

  // Filter supports to resolved chunk indices.
  const filteredSupports: Array<{ partIndex: number; startIndex: number; endIndex: number; segmentText?: string; chunkIndices: number[] }> = [];
  for (const s of supports) {
    const seg = s.segment;
    if (!seg) continue;
    const partIndex = seg.partIndex ?? 0;
    const startIndex = seg.startIndex;
    const endIndex = seg.endIndex;
    if (typeof startIndex !== 'number' || typeof endIndex !== 'number') continue;
    const indices = (s.groundingChunkIndices ?? []).filter((i) => resolvedChunkIndexSet.has(i));
    if (indices.length === 0) continue;
    filteredSupports.push({
      partIndex,
      startIndex,
      endIndex,
      segmentText: seg.text,
      chunkIndices: indices,
    });
  }

  if (filteredSupports.length === 0) {
    const warning =
      'WARNING: No resolvable grounding sources; emitting answer without citations.';
    const cleaned = sanitizeNoVertexLinks(stripTrailingSources(partTexts.join('\n')));
    return {
      content: cleaned,
      groundingStatus: 'partial',
      warning,
      webSearchQueries,
      citationStyle: 'ieee',
      resolvedReferences: [],
      droppedReferences,
      redirectResolution: {
        attemptsTotal: results.reduce((acc, r) => acc + r.attempts, 0),
        resolvedCount: results.filter((r) => r.ok && r.resolvedUrl).length,
        droppedCount: droppedReferences.length,
        usedCacheCount: cacheHits,
        durationMs: resolverMs,
      },
    };
  }

  // Assign reference numbers by first appearance across filtered supports.
  const chunkIndexToRefNum = new Map<number, number>();
  let nextRef = 1;
  for (const s of filteredSupports) {
    for (const idx of s.chunkIndices) {
      if (!chunkIndexToRefNum.has(idx)) {
        chunkIndexToRefNum.set(idx, nextRef);
        nextRef += 1;
      }
    }
  }

  const partBuffers = partTexts.map((t) => Buffer.from(t, 'utf8'));

  // Prepare insertions.
  const insertionSupports: Array<{ partIndex: number; endIndex: number; refNums: number[]; startIndex: number; segmentText?: string }> = [];
  let offsetMismatch = false;

  for (const s of filteredSupports) {
    const buf = partBuffers[s.partIndex];
    if (!buf) continue;
    if (s.startIndex < 0 || s.endIndex > buf.length || s.endIndex < s.startIndex) {
      offsetMismatch = true;
      continue;
    }

    if (s.segmentText) {
      const sliceText = buf.subarray(s.startIndex, s.endIndex).toString('utf8');
      if (sliceText !== s.segmentText) {
        offsetMismatch = true;
        continue;
      }
    }

    const refNums = s.chunkIndices
      .map((ci) => chunkIndexToRefNum.get(ci))
      .filter((n): n is number => typeof n === 'number')
      .sort((a, b) => a - b);

    if (refNums.length === 0) continue;
    insertionSupports.push({
      partIndex: s.partIndex,
      endIndex: s.endIndex,
      refNums,
      startIndex: s.startIndex,
      segmentText: s.segmentText,
    });
  }

  if (insertionSupports.length === 0) {
    const warning =
      offsetMismatch
        ? 'WARNING: Grounding offsets mismatched; emitting answer without citations.'
        : 'WARNING: No usable grounding supports; emitting answer without citations.';
    const cleaned = sanitizeNoVertexLinks(stripTrailingSources(partTexts.join('\n')));

    return {
      content: cleaned,
      groundingStatus: offsetMismatch ? 'offset_mismatch' : 'partial',
      warning,
      webSearchQueries,
      citationStyle: 'ieee',
      resolvedReferences: [],
      droppedReferences,
      redirectResolution: {
        attemptsTotal: results.reduce((acc, r) => acc + r.attempts, 0),
        resolvedCount: results.filter((r) => r.ok && r.resolvedUrl).length,
        droppedCount: droppedReferences.length,
        usedCacheCount: cacheHits,
        durationMs: resolverMs,
      },
    };
  }

  const insertionsByPart = groupInsertionsByPart(
    insertionSupports.map((s) => ({ partIndex: s.partIndex, endIndex: s.endIndex, refNums: s.refNums })),
    partBuffers,
  );

  const outParts: string[] = [];
  for (let i = 0; i < partBuffers.length; i++) {
    const inserts = insertionsByPart.get(i);
    const buf = inserts ? applyInsertionsToBuffer(partBuffers[i], inserts) : partBuffers[i];
    outParts.push(buf.toString('utf8'));
  }

  const textWithCitations = stripTrailingSources(outParts.join('\n'));

  const resolvedReferences: ResolvedReference[] = [];
  for (const [chunkIndex, refNum] of chunkIndexToRefNum.entries()) {
    const info = redirectUrlsByChunkIndex.get(chunkIndex);
    if (!info) continue;
    const rr = resolvedByRedirect.get(info.redirectUrl);
    if (!rr?.ok || !rr.resolvedUrl) continue;
    resolvedReferences.push({
      refNum,
      chunkIndex,
      redirectUrl: info.redirectUrl,
      resolvedUrl: rr.resolvedUrl,
      title: info.title,
      domain: info.domain,
    });
  }

  resolvedReferences.sort((a, b) => a.refNum - b.refNum);

  const referencesBlock = renderReferences(resolvedReferences);
  const finalBody = referencesBlock.length > 0
    ? `${textWithCitations}\n\n## References\n\n${referencesBlock}`
    : textWithCitations;

  const groundingStatus: GroundingStatus = offsetMismatch ? 'offset_mismatch' : 'ok';
  let warning =
    groundingStatus === 'offset_mismatch'
      ? 'WARNING: Grounding offsets mismatched for some segments; citations may be incomplete.'
      : undefined;

  if (cacheSaveError) {
    const cacheWarn = `WARNING: Redirect cache save failed: ${cacheSaveError}`;
    warning = warning ? `${warning} ${cacheWarn}` : cacheWarn;
  }

  return {
    content: sanitizeNoVertexLinks(finalBody),
    groundingStatus,
    warning,
    webSearchQueries,
    citationStyle: 'ieee',
    resolvedReferences,
    droppedReferences,
    redirectResolution: {
      attemptsTotal: results.reduce((acc, r) => acc + r.attempts, 0),
      resolvedCount: results.filter((r) => r.ok && r.resolvedUrl).length,
      droppedCount: droppedReferences.length,
      usedCacheCount: cacheHits,
      durationMs: resolverMs,
    },
  };
}
