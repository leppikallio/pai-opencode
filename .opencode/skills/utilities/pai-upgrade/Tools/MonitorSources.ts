#!/usr/bin/env bun

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { loadSkillConfig } from '../../../PAI/Tools/LoadSkillConfig';
import { buildLearningContext, type LearningContext, type LearningContextOptions } from './BuildLearningContext';
import {
  rankRecommendations,
  type RecommendationCandidate,
  type RecommendationPriority
} from './RankRecommendations';
import { homedir } from 'node:os';

type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
type SourceCategory = 'blog' | 'github' | 'changelog' | 'docs' | 'community';
type UpdateType = 'blog' | 'commit' | 'release' | 'changelog' | 'docs' | 'community' | 'youtube';
type OutputFormat = 'json' | 'markdown';
type StateChannel = 'content' | 'commits' | 'releases';
type TranscriptStatus = 'not_attempted' | 'extracted' | 'empty' | 'pending_retry' | 'unavailable' | 'failed' | 'retry_exhausted';
type TranscriptErrorClassification = 'timeout' | 'non_zero_exit' | 'unknown';

interface TranscriptMetadata {
  source: 'youtube';
  path: string;
  status: TranscriptStatus;
  retries: number;
  attempted: boolean;
  extracted: boolean;
  dry_run: boolean;
  excerpt?: string;
  error?: string;
  error_classification?: TranscriptErrorClassification;
  char_count?: number;
  line_count?: number;
}

interface Source {
  id: string;
  provider: string;
  category: SourceCategory;
  name: string;
  priority: Priority;
  type?: string;
  url?: string;
  owner?: string;
  repo?: string;
  check_commits?: boolean;
  check_releases?: boolean;
  check_issues?: boolean;
  note?: string;
}

interface LegacySource {
  name: string;
  url?: string;
  owner?: string;
  repo?: string;
  priority: Priority;
  type?: string;
  check_commits?: boolean;
  check_releases?: boolean;
  check_issues?: boolean;
  note?: string;
}

interface SourcesV1 {
  blogs?: LegacySource[];
  github_repos?: LegacySource[];
  changelogs?: LegacySource[];
  documentation?: LegacySource[];
  community?: LegacySource[];
}

interface SourcesV2 {
  schema_version: 2;
  sources: Source[];
}

interface SourceState {
  last_checked: string;
  last_hash?: string;
  last_title?: string;
  last_sha?: string;
  last_version?: string;
}

interface MonitorState {
  schema_version: 2;
  last_check_timestamp: string | null;
  sources: Record<string, SourceState>;
}

interface Update {
  canonical_id?: string;
  source_id: string;
  source: string;
  origin: 'external' | 'internal';
  provider: string;
  category: SourceCategory;
  type: UpdateType;
  title: string;
  url: string;
  date: string;
  summary?: string;
  hash?: string;
  sha?: string;
  version?: string;
  priority: Priority;
  initial_priority?: Priority;
  recommendation?: string;
  ranking_id?: string;
  base_priority?: RecommendationPriority;
  adjusted_priority?: RecommendationPriority;
  base_score?: number;
  adjusted_score?: number;
  score_delta?: number;
  ranking_matched_patterns?: string[];
  ranking_reasons?: string[];
  ranking_rationale?: string;
  transcript_path?: string;
  transcript_excerpt?: string;
  transcript_status?: TranscriptStatus;
  transcript_char_count?: number;
  transcript_line_count?: number;
  transcript?: TranscriptMetadata;
}

export interface MonitorOptions {
  days: number;
  force: boolean;
  provider: string;
  dryRun: boolean;
  format: OutputFormat;
  persistHistory: boolean;
  historyPath?: string;
  runtime?: MonitorRuntimeSeams;
}

export interface MonitorLearningContextSeams {
  memoryRoot?: string;
  learningRoot?: string;
  ratingsPath?: string;
  failuresRoot?: string;
  reflectionsPath?: string;
}

export interface MonitorRuntimeSeams {
  fetch?: typeof fetch;
  now?: () => Date;
  stateFilePath?: string;
  runHistoryPath?: string;
  recommendationHistoryPath?: string;
  sourcesV2ConfigPath?: string;
  sourcesV1ConfigPath?: string;
  youtubeChannelsConfigPath?: string;
  youtubeStateFilePath?: string;
  youtubeTranscriptDir?: string;
  getTranscript?: (videoId: string, videoUrl: string) => Promise<string | null | undefined>;
  learningContext?: MonitorLearningContextSeams;
}

export interface UpgradeReportDiscovery {
  id: string;
  source_id: string;
  source_name: string;
  provider: string;
  category: SourceCategory;
  update_type: UpdateType;
  title: string;
  url: string;
  date: string;
  priority: Priority;
  summary?: string;
  transcript_path?: string;
  transcript_excerpt?: string;
  transcript_status?: TranscriptStatus;
  transcript_char_count?: number;
  transcript_line_count?: number;
  transcript?: TranscriptMetadata;
}

export interface UpgradeReportRecommendation {
  id: string;
  discovery_ids: string[];
  implementation_target_ids: string[];
  priority: RecommendationPriority;
  rationale: string;
}

export interface UpgradeImplementationTarget {
  id: string;
  label: string;
  area: 'tooling' | 'workflow' | 'integration' | 'docs';
  source_ids: string[];
}

export interface UpgradeMonitorReport {
  discoveries: UpgradeReportDiscovery[];
  recommendations: UpgradeReportRecommendation[];
  implementation_targets: UpgradeImplementationTarget[];
}

interface ParseResult {
  ok: boolean;
  options?: MonitorOptions;
  showHelp?: boolean;
  error?: string;
}

interface CliContext {
  defaultProvider?: string;
  programName?: string;
  helpTitle?: string;
}

type GitCommit = {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: {
      date?: string;
      name?: string;
    };
  };
};

type GitRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
};

interface YouTubeChannelConfig {
  id: string;
  provider: string;
  name: string;
  priority: Priority;
  feedUrl: string;
}

interface LoadedYouTubeChannelsConfig {
  channels: YouTubeChannelConfig[];
  valid: boolean;
}

interface YouTubeFeedEntry {
  videoId: string;
  title: string;
  url: string;
  publishedAt: string;
  updatedAt: string;
}

interface YouTubeTranscriptState {
  status: TranscriptStatus;
  retries: number;
  path: string;
  updated_at: string;
  excerpt?: string;
  char_count?: number;
  line_count?: number;
  error?: string;
  error_classification?: TranscriptErrorClassification;
}

interface YouTubeChannelState {
  last_checked: string;
  last_video_id?: string;
  last_video_published_at?: string;
  seen_videos: string[];
  transcripts: Record<string, YouTubeTranscriptState>;
}

interface YouTubeState {
  schema_version: 2;
  last_check_timestamp: string | null;
  channels: Record<string, YouTubeChannelState>;
}

export interface RunResult {
  generatedAt: string;
  options: MonitorOptions;
  updates: Update[];
  report: UpgradeMonitorReport;
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    provider: string;
    sourcesChecked: number;
    catalogSourcesChecked: number;
    youtubeChannelsChecked: number;
    sourcesCheckedNote: string;
    ranking: {
      enabled: boolean;
      persisted: boolean;
      historyPath: string;
      candidates: number;
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
  };
  learning_context: {
    generated_at: string;
    lookback_days: number;
    trend_direction: LearningContext['trend']['direction'];
    average_rating: number;
    total_ratings: number;
    low_rating_count: number;
    high_rating_count: number;
    top_failure_patterns: string[];
    top_rating_patterns: string[];
  };
  dryRun: boolean;
}

const DEFAULT_DAYS = 30;
const DEFAULT_PROVIDER = 'anthropic';
const LEGACY_V1_PROVIDER = 'anthropic';
const SKILL_DIR = resolve(join(import.meta.dir, '..'));
const PAI_UPGRADE_MEMORY_ROOT = (): string => resolve(process.env.HOME || homedir(), '.config', 'opencode', 'MEMORY', 'STATE', 'pai-upgrade');
const PAI_UPGRADE_CONFIG_DIR = (): string => join(PAI_UPGRADE_MEMORY_ROOT(), 'config');
const PAI_UPGRADE_STATE_DIR = (): string => join(PAI_UPGRADE_MEMORY_ROOT(), 'state');
const DEFAULT_STATE_FILE = (): string => join(PAI_UPGRADE_STATE_DIR(), 'last-check.json');
const SOURCES_V2_FILE = 'sources.v2.json';
const SOURCES_V1_FILE = 'sources.json';
const YOUTUBE_CHANNELS_FILE = 'youtube-channels.json';
const DEFAULT_LOG_FILE = (): string => join(PAI_UPGRADE_STATE_DIR(), 'run-history.jsonl');
const DEFAULT_RECOMMENDATION_HISTORY_FILE = (): string => join(PAI_UPGRADE_STATE_DIR(), 'recommendation-history.jsonl');
const DEFAULT_YOUTUBE_STATE_FILE = (): string => join(PAI_UPGRADE_STATE_DIR(), 'youtube-videos.json');
const YOUTUBE_TRANSCRIPT_RELATIVE_DIR = join('state', 'transcripts', 'youtube');
const DEFAULT_YOUTUBE_TRANSCRIPT_DIR = (): string => join(PAI_UPGRADE_STATE_DIR(), 'transcripts', 'youtube');
const YOUTUBE_SEEN_VIDEOS_RETENTION = 100;
const YOUTUBE_TRANSCRIPT_MAX_RETRIES = 2;
const YOUTUBE_TRANSCRIPT_EXCERPT_LIMIT = 240;
const YOUTUBE_TRANSCRIPT_ERROR_LIMIT = 240;

interface MonitorRuntimeContext {
  fetch: typeof fetch;
  now: () => Date;
  nowIso: () => string;
  nowMs: () => number;
  getTranscript?: (videoId: string, videoUrl: string) => Promise<string | null | undefined>;
  paths: {
    stateDir: string;
    stateFile: string;
    logDir: string;
    logFile: string;
    recommendationHistoryPath: string;
    sourcesV2ConfigPath: string;
    sourcesV1ConfigPath: string;
    youtubeChannelsConfigPath: string;
    youtubeStateFilePath: string;
    youtubeTranscriptDir: string;
  };
  learningContext: MonitorLearningContextSeams;
}

function resolveConfigLocation(configPath: string): { dir: string; file: string } {
  const resolved = resolve(configPath);
  return {
    dir: dirname(resolved),
    file: basename(resolved)
  };
}

function createRuntimeContext(options: MonitorOptions): MonitorRuntimeContext {
  const runtime = options.runtime || {};
  const now = runtime.now || (() => new Date());
  const stateFile = resolve(runtime.stateFilePath || DEFAULT_STATE_FILE());
  const runHistoryPath = resolve(runtime.runHistoryPath || DEFAULT_LOG_FILE());
  const recommendationHistoryPath = resolve(
    runtime.recommendationHistoryPath || options.historyPath || DEFAULT_RECOMMENDATION_HISTORY_FILE()
  );
  const hasCustomSourcesV2ConfigPath = typeof runtime.sourcesV2ConfigPath === 'string' && runtime.sourcesV2ConfigPath.trim().length > 0;
  const sourcesV2ConfigPath = resolve(runtime.sourcesV2ConfigPath || join(PAI_UPGRADE_CONFIG_DIR(), SOURCES_V2_FILE));
  const sourcesV1ConfigPath = resolve(runtime.sourcesV1ConfigPath || join(PAI_UPGRADE_CONFIG_DIR(), SOURCES_V1_FILE));
  const youtubeChannelsConfigPath = resolve(runtime.youtubeChannelsConfigPath || join(PAI_UPGRADE_CONFIG_DIR(), YOUTUBE_CHANNELS_FILE));
  const configRoot = dirname(sourcesV2ConfigPath);
  const inferredYoutubeStateFilePath = join(configRoot, 'runtime', 'State', 'youtube-videos.json');
  const inferredYoutubeTranscriptDir = join(configRoot, 'runtime', 'State', 'transcripts', 'youtube');
  const youtubeStateFilePath = resolve(
      runtime.youtubeStateFilePath
      || (hasCustomSourcesV2ConfigPath ? inferredYoutubeStateFilePath : DEFAULT_YOUTUBE_STATE_FILE())
  );
  const youtubeTranscriptDir = resolve(
      runtime.youtubeTranscriptDir
      || (hasCustomSourcesV2ConfigPath ? inferredYoutubeTranscriptDir : DEFAULT_YOUTUBE_TRANSCRIPT_DIR())
  );

  return {
    fetch: runtime.fetch || fetch,
    now,
    nowIso: () => now().toISOString(),
    nowMs: () => now().getTime(),
    getTranscript: runtime.getTranscript,
    paths: {
      stateDir: dirname(stateFile),
      stateFile,
      logDir: dirname(runHistoryPath),
      logFile: runHistoryPath,
      recommendationHistoryPath,
      sourcesV2ConfigPath,
      sourcesV1ConfigPath,
      youtubeChannelsConfigPath,
      youtubeStateFilePath,
      youtubeTranscriptDir
    },
    learningContext: runtime.learningContext || {}
  };
}

function isoDate(nowIso: string): string {
  return nowIso.split('T')[0];
}

function hash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function stableStateKey(sourceId: string, channel: StateChannel): string {
  return `${sourceId}::${channel}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertPriority(value: unknown): Priority {
  if (value === 'HIGH' || value === 'MEDIUM' || value === 'LOW') {
    return value;
  }
  return 'MEDIUM';
}

interface LoadedSourcesConfig {
  sources: Source[];
  sourceCatalog: 'v2' | 'v1';
}

function loadSourcesConfig(runtime: MonitorRuntimeContext): LoadedSourcesConfig {
  try {
    const v2Config = resolveConfigLocation(runtime.paths.sourcesV2ConfigPath);
    const rawV2 = loadSkillConfig<Partial<SourcesV2>>(v2Config.dir, v2Config.file);
    if (isObject(rawV2) && Array.isArray(rawV2.sources)) {
      const v2Sources = rawV2.sources
        .map((source) => normalizeSource(source))
        .filter((source): source is Source => source !== null);

      if (v2Sources.length > 0) {
        return {
          sources: v2Sources,
          sourceCatalog: 'v2'
        };
      }
    }
  } catch (error) {
    console.warn('⚠️ Failed to load sources.v2.json, falling back to sources.json:', error);
  }

  const v1Config = resolveConfigLocation(runtime.paths.sourcesV1ConfigPath);
  const rawV1 = loadSkillConfig<Partial<SourcesV1>>(v1Config.dir, v1Config.file);
  return {
    sources: migrateV1Sources(rawV1),
    sourceCatalog: 'v1'
  };
}

function normalizeSource(raw: unknown): Source | null {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const category = typeof raw.category === 'string' ? raw.category.trim() : '';
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : DEFAULT_PROVIDER;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';

  if (!id || !name) return null;
  if (!['blog', 'github', 'changelog', 'docs', 'community'].includes(category)) return null;

  return {
    id,
    category: category as SourceCategory,
    provider,
    name,
    priority: assertPriority(raw.priority),
    type: typeof raw.type === 'string' ? raw.type : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    owner: typeof raw.owner === 'string' ? raw.owner : undefined,
    repo: typeof raw.repo === 'string' ? raw.repo : undefined,
    check_commits: !!raw.check_commits,
    check_releases: !!raw.check_releases,
    check_issues: !!raw.check_issues,
    note: typeof raw.note === 'string' ? raw.note : undefined
  };
}

function migrateV1Sources(raw: Partial<SourcesV1>): Source[] {
  const usedIds = new Set<string>();
  const out: Source[] = [];

  const append = (category: SourceCategory, list: LegacySource[] | undefined) => {
    for (const item of list || []) {
      const id = makeStableSourceId(category, item, usedIds);
      out.push({
        id,
        provider: LEGACY_V1_PROVIDER,
        category,
        name: item.name,
        priority: assertPriority(item.priority),
        type: item.type,
        url: item.url,
        owner: item.owner,
        repo: item.repo,
        check_commits: item.check_commits,
        check_releases: item.check_releases,
        check_issues: item.check_issues,
        note: item.note
      });
    }
  };

  append('blog', raw.blogs);
  append('github', raw.github_repos);
  append('changelog', raw.changelogs);
  append('docs', raw.documentation);
  append('community', raw.community);

  return out;
}

function makeStableSourceId(category: SourceCategory, source: LegacySource, usedIds: Set<string>): string {
  const base = source.owner && source.repo
    ? `${category}-${slugify(source.owner)}-${slugify(source.repo)}`
    : `${category}-${slugify(source.name)}`;

  let candidate = base;
  let counter = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function defaultState(days: number, runtime: MonitorRuntimeContext): MonitorState {
  return {
    schema_version: 2,
    last_check_timestamp: new Date(runtime.nowMs() - days * 24 * 60 * 60 * 1000).toISOString(),
    sources: {}
  };
}

function loadState(days: number, sources: Source[], runtime: MonitorRuntimeContext): MonitorState {
  if (!existsSync(runtime.paths.stateFile)) {
    return defaultState(days, runtime);
  }

  try {
    const raw = JSON.parse(readFileSync(runtime.paths.stateFile, 'utf-8')) as unknown;
    if (isStateV2(raw)) {
      return raw;
    }

    return migrateLegacyState(raw, days, sources, runtime);
  } catch (error) {
    console.warn('⚠️ Failed to load state, starting fresh:', error);
    return defaultState(days, runtime);
  }
}

function isStateV2(raw: unknown): raw is MonitorState {
  return (
    isObject(raw) &&
    raw.schema_version === 2 &&
    isObject(raw.sources)
  );
}

function migrateLegacyState(raw: unknown, days: number, sources: Source[], runtime: MonitorRuntimeContext): MonitorState {
  const migrated = defaultState(days, runtime);
  if (!isObject(raw)) return migrated;

  if (typeof raw.last_check_timestamp === 'string' || raw.last_check_timestamp === null) {
    migrated.last_check_timestamp = raw.last_check_timestamp;
  }

  const legacySources = isObject(raw.sources) ? raw.sources : {};

  for (const source of sources) {
    if (source.category === 'github') {
      copyLegacyState(source, 'commits', legacySources, migrated.sources, runtime.nowIso());
      copyLegacyState(source, 'releases', legacySources, migrated.sources, runtime.nowIso());
      continue;
    }

    if (source.category === 'community') {
      continue;
    }

    copyLegacyState(source, 'content', legacySources, migrated.sources, runtime.nowIso());
  }

  return migrated;
}

function copyLegacyState(
  source: Source,
  channel: StateChannel,
  legacyMap: Record<string, unknown>,
  target: Record<string, SourceState>,
  nowIso: string
): void {
  const candidates = legacyStateKeyCandidates(source, channel);
  const stableKey = stableStateKey(source.id, channel);

  for (const candidate of candidates) {
    const entry = legacyMap[candidate];
    if (!isObject(entry)) continue;

    target[stableKey] = {
      last_checked: typeof entry.last_checked === 'string' ? entry.last_checked : nowIso,
      last_hash: typeof entry.last_hash === 'string' ? entry.last_hash : undefined,
      last_title: typeof entry.last_title === 'string' ? entry.last_title : undefined,
      last_sha: typeof entry.last_sha === 'string' ? entry.last_sha : undefined,
      last_version: typeof entry.last_version === 'string' ? entry.last_version : undefined
    };
    return;
  }
}

function legacyStateKeyCandidates(source: Source, channel: StateChannel): string[] {
  const nameSlug = slugify(source.name).replace(/-/g, '_');

  if (source.category === 'github') {
    const repoSlug = slugify(source.repo || '').replace(/-/g, '_');
    if (channel === 'commits') {
      return [
        `github_${repoSlug}_commits`,
        `github_${nameSlug}_commits`
      ];
    }
    return [
      `github_${repoSlug}_releases`,
      `github_${nameSlug}_releases`
    ];
  }

  if (source.category === 'blog') {
    return [`blog_${nameSlug}`];
  }
  if (source.category === 'changelog') {
    return [`changelog_${nameSlug}`];
  }
  if (source.category === 'docs') {
    return [`docs_${nameSlug}`];
  }

  return [];
}

function saveState(state: MonitorState, runtime: MonitorRuntimeContext): void {
  try {
    if (!existsSync(runtime.paths.stateDir)) {
      mkdirSync(runtime.paths.stateDir, { recursive: true });
    }
    writeFileSync(runtime.paths.stateFile, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.error('❌ Failed to save state:', error);
  }
}

function logRun(result: RunResult, runtime: MonitorRuntimeContext): void {
  try {
    if (!existsSync(runtime.paths.logDir)) {
      mkdirSync(runtime.paths.logDir, { recursive: true });
    }

    appendFileSync(
      runtime.paths.logFile,
      `${JSON.stringify({
        timestamp: result.generatedAt,
        days_checked: result.options.days,
        forced: result.options.force,
        provider: result.options.provider,
        dry_run: result.options.dryRun,
        updates_found: result.summary.total,
        critical_priority: result.summary.critical,
        high_priority: result.summary.high,
        medium_priority: result.summary.medium,
        low_priority: result.summary.low,
        sources_checked: result.summary.sourcesChecked,
        ranking_persisted: result.summary.ranking.persisted,
        ranking_candidates: result.summary.ranking.candidates
      })}\n`,
      'utf-8'
    );
  } catch (error) {
    console.warn('⚠️ Failed to write run history:', error);
  }
}

function isYouTubeFeedUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    if (hostname !== 'youtube.com' && hostname !== 'www.youtube.com') {
      return false;
    }

    return pathname === '/feeds/videos.xml';
  } catch {
    return false;
  }
}

function deriveChannelId(channelId: string, feedUrl: string): string {
  if (channelId) {
    return channelId;
  }

  try {
    const parsed = new URL(feedUrl);
    const fromQuery = parsed.searchParams.get('channel_id')?.trim();
    if (fromQuery) {
      return fromQuery;
    }
  } catch {
    // feedUrl validity is validated before deriving fallback id.
  }

  return `feed-${hash(feedUrl).slice(0, 12)}`;
}

function normalizeYouTubeChannel(raw: unknown, index: number): { channel?: YouTubeChannelConfig; error?: string } {
  if (!isObject(raw)) {
    return {
      error: `channels[${index}] must be an object`
    };
  }

  const channelId = typeof raw.channel_id === 'string'
    ? raw.channel_id.trim()
    : '';
  const feedUrlRaw = typeof raw.feed_url === 'string' ? raw.feed_url.trim() : '';

  if (!channelId && !feedUrlRaw) {
    return {
      error: `channels[${index}] requires at least one of channel_id or feed_url`
    };
  }

  if (feedUrlRaw && !isYouTubeFeedUrl(feedUrlRaw)) {
    return {
      error: `channels[${index}] has invalid feed_url: ${feedUrlRaw}`
    };
  }

  const id = deriveChannelId(channelId, feedUrlRaw);
  const feedUrl = feedUrlRaw || `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;

  const provider = typeof raw.provider === 'string' && raw.provider.trim()
    ? raw.provider.trim()
    : DEFAULT_PROVIDER;

  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim()
    : id;

  return {
    channel: {
      id,
      provider,
      name,
      priority: assertPriority(raw.priority),
      feedUrl
    }
  };
}

function loadYouTubeChannelsConfig(runtime: MonitorRuntimeContext): LoadedYouTubeChannelsConfig {
  const configLocation = resolveConfigLocation(runtime.paths.youtubeChannelsConfigPath);
  const configLabel = runtime.paths.youtubeChannelsConfigPath;

  let raw: unknown;

  try {
    raw = loadSkillConfig<{ schema_version?: number; channels?: unknown[] }>(
      configLocation.dir,
      configLocation.file
    );
  } catch (error) {
    console.warn(`⚠️ Failed to load ${configLabel}; Skipping YouTube discovery for this run.`, error);
    return {
      channels: [],
      valid: false
    };
  }

  if (!isObject(raw)) {
    console.warn(`⚠️ Invalid ${configLabel}; expected JSON object. Skipping YouTube discovery for this run.`);
    return {
      channels: [],
      valid: false
    };
  }

  if (raw.channels === undefined) {
    return {
      channels: [],
      valid: true
    };
  }

  if (!Array.isArray(raw.channels)) {
    console.warn(`⚠️ Invalid ${configLabel}; channels must be an array. Skipping YouTube discovery for this run.`);
    return {
      channels: [],
      valid: false
    };
  }

  const channels: YouTubeChannelConfig[] = [];
  const errors: string[] = [];
  for (const [index, entry] of raw.channels.entries()) {
    const normalized = normalizeYouTubeChannel(entry, index);
    if (normalized.error) {
      errors.push(normalized.error);
      continue;
    }
    if (normalized.channel) {
      channels.push(normalized.channel);
    }
  }

  if (errors.length > 0) {
    console.warn(`⚠️ Invalid ${configLabel}; ${errors.join('; ')}. Skipping YouTube discovery for this run.`);
    return {
      channels: [],
      valid: false
    };
  }

  return {
    channels,
    valid: true
  };
}

function parseYouTubeEntry(entryXml: string): YouTubeFeedEntry | null {
  const videoIdMatch = entryXml.match(/<yt:videoId>\s*([^<]+)\s*<\/yt:videoId>/i)
    || entryXml.match(/<id>\s*yt:video:([^<]+)\s*<\/id>/i);
  const titleMatch = entryXml.match(/<title>\s*([\s\S]*?)\s*<\/title>/i);
  const linkMatch = entryXml.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  const publishedMatch = entryXml.match(/<published>\s*([^<]+)\s*<\/published>/i);
  const updatedMatch = entryXml.match(/<updated>\s*([^<]+)\s*<\/updated>/i);

  const videoId = videoIdMatch?.[1]?.trim();
  const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim();
  const url = linkMatch?.[1]?.trim() || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');
  const publishedAt = publishedMatch?.[1]?.trim() || updatedMatch?.[1]?.trim() || '';
  const updatedAt = updatedMatch?.[1]?.trim() || publishedMatch?.[1]?.trim() || '';

  if (!videoId || !title || !url || !publishedAt || !updatedAt) {
    return null;
  }

  return {
    videoId,
    title,
    url,
    publishedAt,
    updatedAt
  };
}

function parseYouTubeAtomFeed(xml: string): YouTubeFeedEntry[] {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return entries
    .map((entryXml) => parseYouTubeEntry(entryXml))
    .filter((entry): entry is YouTubeFeedEntry => entry !== null)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeTranscriptExcerpt(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, YOUTUBE_TRANSCRIPT_EXCERPT_LIMIT);
}

function truncateTranscriptValue(value: string, limit: number): string {
  return value.slice(0, limit);
}

function classifyTranscriptError(message: string): TranscriptErrorClassification {
  const normalized = message.toLowerCase();
  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'timeout';
  }

  if (
    normalized.includes('non-zero')
    || normalized.includes('non zero')
    || /exit(?:ed)?\s+with\s+code\s+\d+/.test(normalized)
    || /code\s+\d+/.test(normalized)
  ) {
    return 'non_zero_exit';
  }

  return 'unknown';
}

function parseTranscriptXml(raw: string): string | null {
  const matches = [...raw.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)];
  if (matches.length === 0) {
    return null;
  }

  const lines = matches
    .map((match) => decodeHtmlEntities(match[1] || '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  return lines.join('\n');
}

function parseTranscriptJson3(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as {
      events?: Array<{ segs?: Array<{ utf8?: string }> }>;
    };

    const lines = (parsed.events || [])
      .flatMap((event) => event.segs || [])
      .map((segment) => (segment.utf8 || '').replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return null;
    }

    return lines.join('\n');
  } catch {
    return null;
  }
}

async function extractTranscriptWithInternalHelper(videoId: string, runtime: MonitorRuntimeContext): Promise<string | null> {
  const transcriptUrl = `https://www.youtube.com/api/timedtext?lang=en&fmt=json3&v=${encodeURIComponent(videoId)}`;
  const response = await runtime.fetch(transcriptUrl);
  if (!response.ok) {
    return null;
  }

  const body = await response.text();
  return parseTranscriptJson3(body) || parseTranscriptXml(body);
}

async function getTranscriptForVideo(
  videoId: string,
  videoUrl: string,
  runtime: MonitorRuntimeContext
): Promise<string | null | undefined> {
  if (runtime.getTranscript) {
    return runtime.getTranscript(videoId, videoUrl);
  }

  return extractTranscriptWithInternalHelper(videoId, runtime);
}

function normalizeSeenVideos(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= YOUTUBE_SEEN_VIDEOS_RETENTION) {
      break;
    }
  }

  return out;
}

function upsertSeenVideo(seenVideos: string[], videoId: string): string[] {
  const deduped = [videoId, ...seenVideos.filter((value) => value !== videoId)];
  return deduped.slice(0, YOUTUBE_SEEN_VIDEOS_RETENTION);
}

function normalizeTranscriptState(
  value: unknown,
  nowIso: string,
  fallbackPath: string
): YouTubeTranscriptState | null {
  if (!isObject(value)) {
    return null;
  }

  const retries = typeof value.retries === 'number' && Number.isFinite(value.retries)
    ? Math.max(0, Math.floor(value.retries))
    : 0;

  const statusRaw = typeof value.status === 'string' ? value.status : 'pending_retry';
  let status: TranscriptStatus;
  if (
    statusRaw === 'not_attempted'
    || statusRaw === 'extracted'
    || statusRaw === 'empty'
    || statusRaw === 'pending_retry'
    || statusRaw === 'unavailable'
  ) {
    status = statusRaw;
  } else if (statusRaw === 'retry_exhausted') {
    status = 'unavailable';
  } else if (statusRaw === 'failed') {
    status = retries >= YOUTUBE_TRANSCRIPT_MAX_RETRIES ? 'unavailable' : 'pending_retry';
  } else {
    status = 'pending_retry';
  }

  const errorClassificationRaw = typeof value.error_classification === 'string' ? value.error_classification : undefined;
  const errorClassification: TranscriptErrorClassification | undefined = (
    errorClassificationRaw === 'timeout'
    || errorClassificationRaw === 'non_zero_exit'
    || errorClassificationRaw === 'unknown'
  )
    ? errorClassificationRaw
    : undefined;

  return {
    status,
    retries,
    path: typeof value.path === 'string' ? value.path : fallbackPath,
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : nowIso,
    excerpt: typeof value.excerpt === 'string' ? value.excerpt : undefined,
    char_count: typeof value.char_count === 'number' ? value.char_count : undefined,
    line_count: typeof value.line_count === 'number' ? value.line_count : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
    error_classification: errorClassification
  };
}

function normalizeYouTubeChannelState(value: unknown, nowIso: string): YouTubeChannelState {
  if (!isObject(value)) {
    return {
      last_checked: nowIso,
      seen_videos: [],
      transcripts: {}
    };
  }

  const transcriptsRaw = isObject(value.transcripts)
    ? value.transcripts
    : {};

  const transcripts: Record<string, YouTubeTranscriptState> = {};
  for (const [videoId, transcriptValue] of Object.entries(transcriptsRaw)) {
    const normalized = normalizeTranscriptState(transcriptValue, nowIso, youtubeTranscriptRelativePath(videoId));
    if (normalized) {
      transcripts[videoId] = normalized;
    }
  }

  const seenLegacy = normalizeSeenVideos(value.seen_video_ids);
  const seenCurrent = normalizeSeenVideos(value.seen_videos);

  return {
    last_checked: typeof value.last_checked === 'string' ? value.last_checked : nowIso,
    last_video_id: typeof value.last_video_id === 'string' ? value.last_video_id : undefined,
    last_video_published_at: typeof value.last_video_published_at === 'string' ? value.last_video_published_at : undefined,
    seen_videos: seenCurrent.length > 0 ? seenCurrent : seenLegacy,
    transcripts
  };
}

function defaultYouTubeState(runtime: MonitorRuntimeContext): YouTubeState {
  return {
    schema_version: 2,
    last_check_timestamp: runtime.nowIso(),
    channels: {}
  };
}

function loadYouTubeState(runtime: MonitorRuntimeContext): YouTubeState {
  if (!existsSync(runtime.paths.youtubeStateFilePath)) {
    return defaultYouTubeState(runtime);
  }

  try {
    const raw = JSON.parse(readFileSync(runtime.paths.youtubeStateFilePath, 'utf-8')) as unknown;
    if (isObject(raw) && isObject(raw.channels)) {
      const schemaVersion = raw.schema_version;
      if (schemaVersion !== 1 && schemaVersion !== 2) {
        return defaultYouTubeState(runtime);
      }

      const channels: Record<string, YouTubeChannelState> = {};
      for (const [channelId, value] of Object.entries(raw.channels)) {
        channels[channelId] = normalizeYouTubeChannelState(value, runtime.nowIso());
      }

      return {
        schema_version: 2,
        last_check_timestamp: (typeof raw.last_check_timestamp === 'string' || raw.last_check_timestamp === null)
          ? raw.last_check_timestamp
          : runtime.nowIso(),
        channels
      };
    }
  } catch (error) {
    console.warn('⚠️ Failed to load youtube state, starting fresh:', error);
  }

  return defaultYouTubeState(runtime);
}

function saveYouTubeState(state: YouTubeState, runtime: MonitorRuntimeContext): void {
  try {
    const stateDir = dirname(runtime.paths.youtubeStateFilePath);
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }

    writeFileSync(runtime.paths.youtubeStateFilePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.warn('⚠️ Failed to save youtube state:', error);
  }
}

function youtubeTranscriptRelativePath(videoId: string): string {
  return `state/transcripts/youtube/${videoId}.txt`;
}

interface YouTubeUpdatesResult {
  updates: Update[];
  channelsChecked: number;
}

async function fetchYouTubeUpdates(options: MonitorOptions, runtime: MonitorRuntimeContext): Promise<YouTubeUpdatesResult> {
  const loadedChannels = loadYouTubeChannelsConfig(runtime);
  if (!loadedChannels.valid) {
    return {
      updates: [],
      channelsChecked: 0
    };
  }

  const channels = loadedChannels.channels;

  if (channels.length === 0) {
    return {
      updates: [],
      channelsChecked: 0
    };
  }

  const currentState = loadYouTubeState(runtime);
  const nextState: YouTubeState = {
    schema_version: 2,
    last_check_timestamp: runtime.nowIso(),
    channels: { ...currentState.channels }
  };

  const updates: Update[] = [];
  const cutoffMs = runtime.nowMs() - options.days * 24 * 60 * 60 * 1000;

  for (const channel of channels) {
    const channelKey = channel.id;
    const previous = nextState.channels[channelKey] || {
      last_checked: runtime.nowIso(),
      seen_videos: [],
      transcripts: {}
    };
    let seenVideos = normalizeSeenVideos(previous.seen_videos);
    const seen = new Set(seenVideos);
    const transcripts: Record<string, YouTubeTranscriptState> = { ...(previous.transcripts || {}) };

    try {
      const response = await runtime.fetch(channel.feedUrl);
      if (!response.ok) {
        console.warn(`⚠️ Failed to fetch YouTube channel ${channel.name}: ${response.status}`);
        nextState.channels[channelKey] = {
          ...previous,
          last_checked: runtime.nowIso(),
          seen_videos: seenVideos,
          transcripts
        };
        continue;
      }

      const feed = await response.text();
      const entries = parseYouTubeAtomFeed(feed);

      for (const entry of entries) {
        const publishedMs = new Date(entry.publishedAt).getTime();
        if (Number.isFinite(publishedMs) && publishedMs < cutoffMs) {
          continue;
        }

        const transcriptPath = youtubeTranscriptRelativePath(entry.videoId);
        const existingTranscriptState = transcripts[entry.videoId];
        const wasSeen = seen.has(entry.videoId);

        if (!options.force && wasSeen) {
          continue;
        }

        if (options.force && wasSeen && existingTranscriptState?.status === 'unavailable') {
          continue;
        }

        const transcript: TranscriptMetadata = {
          source: 'youtube',
          path: transcriptPath,
          status: 'not_attempted',
          retries: existingTranscriptState?.retries || 0,
          attempted: false,
          extracted: false,
          dry_run: options.dryRun,
          error_classification: existingTranscriptState?.error_classification
        };

        if (!options.dryRun) {
          const retries = existingTranscriptState?.retries || 0;
          const canRetry = retries < YOUTUBE_TRANSCRIPT_MAX_RETRIES;
          const alreadyExtracted = existingTranscriptState?.status === 'extracted';

          if (alreadyExtracted) {
            transcript.status = 'extracted';
            transcript.extracted = true;
            transcript.excerpt = existingTranscriptState?.excerpt;
            transcript.char_count = existingTranscriptState?.char_count;
            transcript.line_count = existingTranscriptState?.line_count;
            transcript.error_classification = existingTranscriptState?.error_classification;
          } else if (!canRetry) {
            const nowIso = runtime.nowIso();
            transcript.status = 'unavailable';
            transcript.excerpt = existingTranscriptState?.excerpt;
            transcript.error = existingTranscriptState?.error;
            transcript.error_classification = existingTranscriptState?.error_classification;
            transcripts[entry.videoId] = {
              status: 'unavailable',
              retries,
              path: transcriptPath,
              updated_at: nowIso,
              excerpt: existingTranscriptState?.excerpt,
              error: existingTranscriptState?.error,
              error_classification: existingTranscriptState?.error_classification
            };
          } else {
            const nowIso = runtime.nowIso();
            transcript.attempted = true;
            transcript.retries = retries + 1;

            try {
              const transcriptText = await getTranscriptForVideo(entry.videoId, entry.url, runtime);
              if (transcriptText?.trim()) {
                if (!existsSync(runtime.paths.youtubeTranscriptDir)) {
                  mkdirSync(runtime.paths.youtubeTranscriptDir, { recursive: true });
                }
                writeFileSync(join(runtime.paths.youtubeTranscriptDir, `${entry.videoId}.txt`), transcriptText, 'utf-8');
                const excerpt = normalizeTranscriptExcerpt(transcriptText);
                const charCount = transcriptText.length;
                const lineCount = transcriptText.split(/\r?\n/).length;

                transcript.status = 'extracted';
                transcript.extracted = true;
                transcript.excerpt = excerpt;
                transcript.char_count = charCount;
                transcript.line_count = lineCount;

                transcripts[entry.videoId] = {
                  status: 'extracted',
                  retries: transcript.retries,
                  path: transcriptPath,
                  updated_at: nowIso,
                  excerpt,
                  char_count: charCount,
                  line_count: lineCount
                };
              } else {
                transcript.status = 'empty';
                transcripts[entry.videoId] = {
                  status: 'empty',
                  retries: transcript.retries,
                  path: transcriptPath,
                  updated_at: nowIso,
                  excerpt: existingTranscriptState?.excerpt
                };
              }
            } catch (error) {
              const rawErrorMessage = error instanceof Error ? error.message : String(error);
              const errorClassification = classifyTranscriptError(rawErrorMessage);
              const errorMessage = truncateTranscriptValue(rawErrorMessage, YOUTUBE_TRANSCRIPT_ERROR_LIMIT);
              const hasRetriesRemaining = transcript.retries < YOUTUBE_TRANSCRIPT_MAX_RETRIES;

              transcript.status = hasRetriesRemaining ? 'pending_retry' : 'unavailable';
              transcript.error = errorMessage;
              transcript.error_classification = errorClassification;
              transcripts[entry.videoId] = {
                status: transcript.status,
                retries: transcript.retries,
                path: transcriptPath,
                updated_at: nowIso,
                error: errorMessage,
                excerpt: existingTranscriptState?.excerpt,
                error_classification: errorClassification
              };
            }
          }
        } else {
          transcript.status = 'not_attempted';
        }

        if (!options.dryRun && !transcripts[entry.videoId] && existingTranscriptState) {
          transcripts[entry.videoId] = existingTranscriptState;
        }

        updates.push({
          canonical_id: `youtube:${entry.videoId}`,
          source_id: `youtube-${channel.id}`,
          source: channel.name,
          origin: 'external',
          provider: 'ecosystem',
          category: 'community',
          type: 'youtube',
          title: entry.title,
          url: entry.url,
          date: isoDate(entry.publishedAt),
          priority: channel.priority,
          summary: 'New YouTube upload detected',
          transcript_path: transcript.path,
          transcript_excerpt: transcript.excerpt,
          transcript_status: transcript.status,
          transcript_char_count: transcript.char_count,
          transcript_line_count: transcript.line_count,
          transcript
        });

        seenVideos = upsertSeenVideo(seenVideos, entry.videoId);
        seen.add(entry.videoId);
      }

      nextState.channels[channelKey] = {
        last_checked: runtime.nowIso(),
        last_video_id: entries[0]?.videoId || previous.last_video_id,
        last_video_published_at: entries[0]?.publishedAt || previous.last_video_published_at,
        seen_videos: seenVideos,
        transcripts
      };
    } catch (error) {
      console.warn(`⚠️ Error fetching YouTube source ${channel.name}:`, error);
      nextState.channels[channelKey] = {
        ...previous,
        last_checked: runtime.nowIso(),
        seen_videos: seenVideos,
        transcripts
      };
    }
  }

  if (!options.dryRun) {
    saveYouTubeState(nextState, runtime);
  }

  return {
    updates,
    channelsChecked: channels.length
  };
}

function buildSourcesCheckedNote(catalogSourcesChecked: number, youtubeChannelsChecked: number): string {
  if (youtubeChannelsChecked > 0) {
    return `sourcesChecked includes ${catalogSourcesChecked} catalog sources plus ${youtubeChannelsChecked} auxiliary YouTube channels checked; mixed-provider output is expected because YouTube discoveries use provider 'ecosystem'.`;
  }

  return `sourcesChecked includes ${catalogSourcesChecked} catalog sources and 0 auxiliary YouTube channels checked.`;
}

function getStateRecord(state: MonitorState, sourceId: string, channel: StateChannel): SourceState | undefined {
  return state.sources[stableStateKey(sourceId, channel)];
}

function setStateRecord(state: MonitorState, sourceId: string, channel: StateChannel, patch: Partial<SourceState>, runtime: MonitorRuntimeContext): void {
  const key = stableStateKey(sourceId, channel);
  const previous = state.sources[key] || { last_checked: runtime.nowIso() };
  state.sources[key] = {
    ...previous,
    ...patch,
    last_checked: patch.last_checked || runtime.nowIso()
  };
}

async function fetchBlogLike(source: Source, state: MonitorState, options: MonitorOptions, runtime: MonitorRuntimeContext): Promise<Update[]> {
  if (!source.url) return [];

  try {
    const response = await runtime.fetch(source.url);
    if (!response.ok) {
      console.warn(`⚠️ Failed to fetch ${source.name}: ${response.status}`);
      return [];
    }

    const content = await response.text();
    const contentHash = hash(content.substring(0, 5000));
    const stateRecord = getStateRecord(state, source.id, 'content');
    const unchanged = !options.force && stateRecord?.last_hash === contentHash;

    setStateRecord(state, source.id, 'content', {
      last_checked: runtime.nowIso(),
      last_hash: contentHash,
      last_title: stateRecord?.last_title
    }, runtime);

    if (unchanged) {
      return [];
    }

    const titleMatch = content.match(/<h1[^>]*>(.*?)<\/h1>/i) || content.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Latest update';

    setStateRecord(state, source.id, 'content', {
      last_checked: runtime.nowIso(),
      last_hash: contentHash,
      last_title: title
    }, runtime);

    const type: UpdateType = source.category === 'docs'
      ? 'docs'
      : source.category === 'changelog'
        ? 'changelog'
        : 'blog';

    return [{
      source_id: source.id,
      source: source.name,
      origin: 'external',
      provider: source.provider,
      category: source.category,
      type,
      title: `${source.name}: ${title}`,
      url: source.url,
      date: isoDate(runtime.nowIso()),
      hash: contentHash,
      priority: source.priority,
      summary: `${source.category} content changed`
    }];
  } catch (error) {
    console.warn(`⚠️ Error fetching ${source.name}:`, error);
    return [];
  }
}

async function fetchGitHub(source: Source, state: MonitorState, options: MonitorOptions, runtime: MonitorRuntimeContext): Promise<Update[]> {
  const updates: Update[] = [];
  if (!source.owner || !source.repo) return updates;

  const token = process.env.GITHUB_TOKEN || '';
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'PAI-Upgrade-Monitor'
  };
  if (token) headers.Authorization = `token ${token}`;

  try {
    if (source.check_commits) {
      const since = new Date(runtime.nowMs() - options.days * 24 * 60 * 60 * 1000).toISOString();
      const commitUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/commits?since=${since}&per_page=10`;
      const response = await runtime.fetch(commitUrl, { headers });

      if (response.ok) {
        const commits = await response.json() as GitCommit[];
        const stateRecord = getStateRecord(state, source.id, 'commits');
        const lastSha = stateRecord?.last_sha;

        for (const commit of commits) {
          const sha = commit.sha || '';
          if (!sha) continue;
          if (!options.force && lastSha && sha === lastSha) break;

          const message = commit.commit?.message || 'Commit';
          const title = message.split('\n')[0];
          const authorName = commit.commit?.author?.name || 'Unknown';
          const date = commit.commit?.author?.date?.split('T')[0] || isoDate(runtime.nowIso());

          updates.push({
            source_id: source.id,
            source: source.name,
            origin: 'external',
            provider: source.provider,
            category: 'github',
            type: 'commit',
            title,
            url: commit.html_url || '',
            date,
            sha,
            priority: source.priority,
            summary: `Commit by ${authorName}`
          });
        }

        const newestSha = commits[0]?.sha;
        if (newestSha) {
          setStateRecord(state, source.id, 'commits', {
            last_checked: runtime.nowIso(),
            last_sha: newestSha,
            last_title: commits[0]?.commit?.message?.split('\n')[0]
          }, runtime);
        } else {
          setStateRecord(state, source.id, 'commits', {
            last_checked: runtime.nowIso()
          }, runtime);
        }
      }
    }

    if (source.check_releases) {
      const releaseUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/releases?per_page=5`;
      const response = await runtime.fetch(releaseUrl, { headers });

      if (response.ok) {
        const releases = await response.json() as GitRelease[];
        const stateRecord = getStateRecord(state, source.id, 'releases');
        const lastVersion = stateRecord?.last_version;

        for (const release of releases) {
          const tag = release.tag_name || '';
          if (!tag) continue;
          if (!options.force && lastVersion && tag === lastVersion) break;

          updates.push({
            source_id: source.id,
            source: source.name,
            origin: 'external',
            provider: source.provider,
            category: 'github',
            type: 'release',
            title: `${tag}: ${release.name || 'New release'}`,
            url: release.html_url || '',
            date: release.published_at?.split('T')[0] || isoDate(runtime.nowIso()),
            version: tag,
            priority: source.priority,
            summary: release.body ? `${release.body.substring(0, 200)}...` : 'See release notes'
          });
        }

        const newestTag = releases[0]?.tag_name;
        if (newestTag) {
          setStateRecord(state, source.id, 'releases', {
            last_checked: runtime.nowIso(),
            last_version: newestTag,
            last_title: `${newestTag}: ${releases[0]?.name || 'New release'}`
          }, runtime);
        } else {
          setStateRecord(state, source.id, 'releases', {
            last_checked: runtime.nowIso()
          }, runtime);
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️ Error fetching GitHub source ${source.name}:`, error);
  }

  return updates;
}

function generateRecommendation(update: Update): string {
  const titleLower = update.title.toLowerCase();
  const sourceLower = update.source.toLowerCase();

  if (titleLower.includes('skill') || sourceLower.includes('skill')) {
    return 'PAI impact: HIGH — Review skill changes and update local skill patterns if needed.';
  }

  if (titleLower.includes('mcp') || sourceLower.includes('mcp')) {
    return 'PAI impact: HIGH — Validate MCP integrations and review protocol-level updates.';
  }

  if (sourceLower.includes('claude-code') && update.type === 'release') {
    return 'PAI impact: HIGH — Review release notes and verify core workflow compatibility.';
  }

  if (update.type === 'docs') {
    return 'PAI impact: MEDIUM — Scan docs for new capabilities worth adopting.';
  }

  return 'PAI impact: LOW-MEDIUM — Track and review if it affects active work.';
}

function assessRelevance(update: Update): Priority {
  const text = `${update.source} ${update.title}`.toLowerCase();
  const highTerms = ['skill', 'mcp', 'agent', 'hook', 'claude code', 'breaking'];
  const lowTerms = ['typo', 'readme', 'minor'];

  if (highTerms.some((term) => text.includes(term))) {
    return 'HIGH';
  }

  if (lowTerms.some((term) => text.includes(term))) {
    return 'LOW';
  }

  return update.priority;
}

function toRecommendationPriority(priority: Priority): RecommendationPriority {
  if (priority === 'HIGH') return 'high';
  if (priority === 'LOW') return 'low';
  return 'medium';
}

function toLegacyPriority(priority: RecommendationPriority): Priority {
  if (priority === 'critical' || priority === 'high') return 'HIGH';
  if (priority === 'low') return 'LOW';
  return 'MEDIUM';
}

function recommendationPriorityForReport(update: Update): RecommendationPriority {
  if (update.adjusted_priority) return update.adjusted_priority;
  return toRecommendationPriority(update.priority);
}

function implementationTargetArea(update: Update): UpgradeImplementationTarget['area'] {
  if (update.category === 'github') return 'integration';
  if (update.category === 'docs') return 'docs';
  if (update.category === 'changelog') return 'workflow';
  return 'tooling';
}

function implementationTargetLabel(area: UpgradeImplementationTarget['area']): string {
  if (area === 'integration') return 'Provider integration compatibility updates';
  if (area === 'docs') return 'Documentation alignment for PAI Upgrade Intelligence';
  if (area === 'workflow') return 'Upgrade workflow and release-note handling';
  return 'Runtime monitoring and operational tooling';
}

function canonicalUpdateIdentity(update: Update): string | null {
  const canonical = typeof update.canonical_id === 'string' ? update.canonical_id.trim() : '';
  return canonical.length > 0 ? canonical : null;
}

function stableDiscoveryIdentity(update: Update): string {
  const canonical = canonicalUpdateIdentity(update);
  if (canonical) {
    return canonical;
  }

  const stableHint = update.sha || update.version || update.hash || update.url || `${update.date}:${update.title}`;
  return `discovery:${update.source_id}:${update.type}:${hash(stableHint).slice(0, 12)}`;
}

function buildUpgradeMonitorReport(updates: Update[]): UpgradeMonitorReport {
  const discoveries: UpgradeReportDiscovery[] = updates.map((update) => ({
    id: stableDiscoveryIdentity(update),
    source_id: update.source_id,
    source_name: update.source,
    provider: update.provider,
    category: update.category,
    update_type: update.type,
    title: update.title,
    url: update.url,
    date: update.date,
    priority: update.priority,
    summary: update.summary,
    transcript_path: update.transcript_path,
    transcript_excerpt: update.transcript_excerpt,
    transcript_status: update.transcript_status,
    transcript_char_count: update.transcript_char_count,
    transcript_line_count: update.transcript_line_count,
    transcript: update.transcript
  }));

  const targetById = new Map<string, UpgradeImplementationTarget>();
  const recommendations: UpgradeReportRecommendation[] = discoveries.map((discovery, index) => {
    const update = updates[index];
    const area = implementationTargetArea(update);
    const targetId = `target-${area}-${slugify(update.source_id)}`;

    const existing = targetById.get(targetId);
    if (existing) {
      if (!existing.source_ids.includes(update.source_id)) {
        existing.source_ids.push(update.source_id);
      }
    } else {
      targetById.set(targetId, {
        id: targetId,
        label: implementationTargetLabel(area),
        area,
        source_ids: [update.source_id]
      });
    }

    return {
      id: `recommendation:${discovery.id}`,
      discovery_ids: [discovery.id],
      implementation_target_ids: [targetId],
      priority: recommendationPriorityForReport(update),
      rationale: update.recommendation || 'Review this discovery for PAI Upgrade Intelligence impact.'
    };
  });

  return {
    discoveries,
    recommendations,
    implementation_targets: [...targetById.values()]
  };
}

function buildRecommendationCandidates(updates: Update[]): RecommendationCandidate[] {
  return updates.map((update) => {
    const canonical = canonicalUpdateIdentity(update);
    const stableHint = update.sha || update.version || update.hash || update.url || update.date;
    const id = canonical
      ? `ranking:${canonical}`
      : `${update.source_id}:${update.type}:${hash(`${stableHint}:${update.title}`).slice(0, 12)}`;

    const tags = [
      update.origin,
      update.provider,
      update.category,
      update.type,
      update.priority.toLowerCase()
    ];

    return {
      id,
      title: update.title,
      summary: `${update.summary || ''} ${update.recommendation || ''}`.trim(),
      priority: toRecommendationPriority(update.priority),
      tags,
      category: update.category,
      source_id: update.source_id,
      source_name: update.source,
      update_type: update.type,
    };
  });
}

function buildLearningContextSummary(context: LearningContext): RunResult['learning_context'] {
  return {
    generated_at: context.generated_at,
    lookback_days: context.lookback_days,
    trend_direction: context.trend.direction,
    average_rating: context.stats.average_rating,
    total_ratings: context.stats.total_ratings,
    low_rating_count: context.stats.low_rating_count,
    high_rating_count: context.stats.high_rating_count,
    top_failure_patterns: context.patterns.failures.slice(0, 3).map((entry) => entry.label),
    top_rating_patterns: context.patterns.rating.slice(0, 3).map((entry) => entry.label)
  };
}

interface InternalReflectionRecord {
  timestamp: string;
  task_description?: string;
  implied_sentiment?: number;
  criteria_failed?: number;
  reflection_q1?: string;
  reflection_q2?: string;
  reflection_q3?: string;
}

function parseInternalReflectionRecord(line: string): InternalReflectionRecord | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (typeof parsed.timestamp !== 'string') {
      return null;
    }

    return {
      timestamp: parsed.timestamp,
      task_description: typeof parsed.task_description === 'string' ? parsed.task_description : undefined,
      implied_sentiment: typeof parsed.implied_sentiment === 'number' ? parsed.implied_sentiment : undefined,
      criteria_failed: typeof parsed.criteria_failed === 'number' ? parsed.criteria_failed : undefined,
      reflection_q1: typeof parsed.reflection_q1 === 'string' ? parsed.reflection_q1 : undefined,
      reflection_q2: typeof parsed.reflection_q2 === 'string' ? parsed.reflection_q2 : undefined,
      reflection_q3: typeof parsed.reflection_q3 === 'string' ? parsed.reflection_q3 : undefined
    };
  } catch {
    return null;
  }
}

function internalReflectionPriority(record: InternalReflectionRecord): Priority {
  const failedCriteria = record.criteria_failed || 0;
  const sentiment = typeof record.implied_sentiment === 'number' ? record.implied_sentiment : 7;

  if (failedCriteria > 0 || sentiment <= 4) return 'HIGH';
  if (sentiment <= 7) return 'MEDIUM';
  return 'LOW';
}

function resolveInternalReflectionsPath(runtime: MonitorRuntimeContext): string | null {
  if (runtime.learningContext.reflectionsPath) {
    return resolve(runtime.learningContext.reflectionsPath);
  }

  if (runtime.learningContext.learningRoot) {
    return resolve(join(runtime.learningContext.learningRoot, 'REFLECTIONS', 'algorithm-reflections.jsonl'));
  }

  if (runtime.learningContext.memoryRoot) {
    return resolve(join(runtime.learningContext.memoryRoot, 'LEARNING', 'REFLECTIONS', 'algorithm-reflections.jsonl'));
  }

  if (runtime.learningContext.ratingsPath) {
    const learningRootFromRatings = dirname(dirname(resolve(runtime.learningContext.ratingsPath)));
    return resolve(join(learningRootFromRatings, 'REFLECTIONS', 'algorithm-reflections.jsonl'));
  }

  return null;
}

function buildInternalSynthesisUpdates(options: MonitorOptions, runtime: MonitorRuntimeContext): Update[] {
  const reflectionsPath = resolveInternalReflectionsPath(runtime);
  if (!reflectionsPath || !existsSync(reflectionsPath)) {
    return [];
  }

  const cutoffMs = runtime.nowMs() - options.days * 24 * 60 * 60 * 1000;
  const lines = readFileSync(reflectionsPath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const records = lines
    .map((line) => parseInternalReflectionRecord(line))
    .filter((record): record is InternalReflectionRecord => record !== null)
    .filter((record) => new Date(record.timestamp).getTime() >= cutoffMs)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  return records.map((record, index) => {
    const sourceText = `${record.reflection_q1 || ''} ${record.reflection_q2 || ''} ${record.reflection_q3 || ''}`.trim();
    const titleSeed = record.task_description || record.reflection_q2 || record.reflection_q1 || 'reflection signal';
    const sourceId = `internal-reflection-${hash(`${record.timestamp}:${titleSeed}`).slice(0, 10)}`;
    const summaryParts = [record.reflection_q1, record.reflection_q2, record.reflection_q3]
      .filter((value): value is string => !!value);

    return {
      source_id: sourceId,
      source: `Internal Reflections (${index + 1})`,
      origin: 'internal',
      provider: 'internal',
      category: 'community',
      type: 'community',
      title: `Internal reflection theme: ${titleSeed}`,
      url: `internal://reflections/${sourceId}`,
      date: isoDate(record.timestamp),
      summary: summaryParts.join(' ').trim() || sourceText || 'Internal reflection signal available.',
      priority: internalReflectionPriority(record),
      recommendation: 'PAI impact: HIGH — Address internal reflection signals before external upgrades.'
    };
  });
}

function applyLearningRanking(updates: Update[], options: MonitorOptions, runtime: MonitorRuntimeContext): {
  updates: Update[];
  learning_context: RunResult['learning_context'];
  ranking: RunResult['summary']['ranking'];
} {
  const learningContext = buildLearningContext({
    lookbackDays: Math.max(options.days, 7),
    memoryRoot: runtime.learningContext.memoryRoot,
    learningRoot: runtime.learningContext.learningRoot,
    ratingsPath: runtime.learningContext.ratingsPath,
    failuresRoot: runtime.learningContext.failuresRoot,
    now: runtime.now
  } satisfies LearningContextOptions);

  const learning_context = buildLearningContextSummary(learningContext);
  const historyPath = runtime.paths.recommendationHistoryPath;
  const candidates = buildRecommendationCandidates(updates);
  const shouldPersistHistory = options.persistHistory && !options.dryRun && candidates.length > 0;

  const ranked = rankRecommendations(candidates, learningContext, {
    persistHistory: shouldPersistHistory,
    historyPath,
    timestamp: runtime.nowIso()
  });

  const rankedById = new Map(ranked.map((entry) => [entry.id, entry]));

  const rankedUpdates = updates.map((update, index) => {
    const candidate = candidates[index];
    const ranking = rankedById.get(candidate.id);
    if (!ranking) {
      return update;
    }

    const adjustedPriority = ranking.adjusted_priority;
    const priorityBand = toLegacyPriority(adjustedPriority);

    return {
      ...update,
      initial_priority: update.priority,
      priority: priorityBand,
      ranking_id: ranking.id,
      base_priority: ranking.base_priority,
      adjusted_priority: ranking.adjusted_priority,
      base_score: ranking.base_score,
      adjusted_score: ranking.adjusted_score,
      score_delta: ranking.score_delta,
      ranking_matched_patterns: ranking.matched_patterns,
      ranking_reasons: ranking.reasons,
      ranking_rationale: ranking.reasons[0] || 'No strong learning signal match; kept near baseline priority'
    };
  });

  const ranking = {
    enabled: true,
    persisted: shouldPersistHistory,
    historyPath,
    candidates: ranked.length,
    critical: rankedUpdates.filter((entry) => entry.adjusted_priority === 'critical').length,
    high: rankedUpdates.filter((entry) => entry.adjusted_priority === 'high').length,
    medium: rankedUpdates.filter((entry) => entry.adjusted_priority === 'medium').length,
    low: rankedUpdates.filter((entry) => entry.adjusted_priority === 'low').length
  };

  return {
    updates: rankedUpdates,
    learning_context,
    ranking
  };
}

export async function runMonitor(options: MonitorOptions): Promise<RunResult> {
  const runtime = createRuntimeContext(options);
  const loadedSources = loadSourcesConfig(runtime);
  const allSources = loadedSources.sources;
  const provider = options.provider.toLowerCase();
  const selectedSources = provider === 'all'
    ? allSources
    : allSources.filter((source) => source.provider.toLowerCase() === provider);

  if (selectedSources.length === 0) {
    if (loadedSources.sourceCatalog === 'v1') {
      throw new Error(
        `Legacy fallback sources.json only supports providers 'anthropic' and 'all'. Received '${options.provider}'.`
      );
    }
    const available = [...new Set(allSources.map((source) => source.provider.toLowerCase()))].sort();
    throw new Error(`No sources found for provider '${options.provider}'. Available: ${available.join(', ') || '(none)'}`);
  }

  const state = loadState(options.days, selectedSources, runtime);
  const nextState: MonitorState = {
    schema_version: 2,
    last_check_timestamp: runtime.nowIso(),
    sources: { ...state.sources }
  };

  const tasks = selectedSources.map(async (source) => {
    if (source.category === 'github') {
      return fetchGitHub(source, nextState, options, runtime);
    }

    if (source.category === 'community') {
      return [] as Update[];
    }

    return fetchBlogLike(source, nextState, options, runtime);
  });

  const updateArrays = await Promise.all(tasks);
  const youtubeResult = await fetchYouTubeUpdates(options, runtime);
  const youtubeUpdates = youtubeResult.updates;
  const internalSynthesis = buildInternalSynthesisUpdates(options, runtime);
  const baseUpdates = [...updateArrays.flat(), ...youtubeUpdates, ...internalSynthesis].map((update) => ({
    ...update,
    recommendation: update.recommendation || generateRecommendation(update),
    priority: assessRelevance(update)
  }));

  const ranked = applyLearningRanking(baseUpdates, options, runtime);
  const updates = ranked.updates;

  const priorityOrder: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  updates.sort((a, b) => {
    const scoreA = a.adjusted_score ?? Number.NEGATIVE_INFINITY;
    const scoreB = b.adjusted_score ?? Number.NEGATIVE_INFINITY;
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (byPriority !== 0) return byPriority;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const critical = updates.filter((update) => update.adjusted_priority === 'critical').length;
  const high = updates.filter((update) => update.priority === 'HIGH').length;
  const medium = updates.filter((update) => update.priority === 'MEDIUM').length;
  const low = updates.filter((update) => update.priority === 'LOW').length;
  const catalogSourcesChecked = selectedSources.length;
  const youtubeChannelsChecked = youtubeResult.channelsChecked;
  const sourcesChecked = catalogSourcesChecked + youtubeChannelsChecked;
  const sourcesCheckedNote = buildSourcesCheckedNote(catalogSourcesChecked, youtubeChannelsChecked);

  const result: RunResult = {
    generatedAt: runtime.nowIso(),
    options,
    updates,
    report: buildUpgradeMonitorReport(updates),
    summary: {
      total: updates.length,
      critical,
      high,
      medium,
      low,
      provider: options.provider,
      sourcesChecked,
      catalogSourcesChecked,
      youtubeChannelsChecked,
      sourcesCheckedNote,
      ranking: ranked.ranking
    },
    learning_context: ranked.learning_context,
    dryRun: options.dryRun
  };

  if (!options.dryRun) {
    saveState(nextState, runtime);
    logRun(result, runtime);
  }

  return result;
}

function renderMarkdown(result: RunResult): string {
  const lines: string[] = [];
  lines.push('# Upgrade Source Monitoring Report');
  lines.push('');
  lines.push(`- Generated: ${result.generatedAt.split('T')[0]}`);
  lines.push(`- Provider: ${result.summary.provider}`);
  lines.push(`- Days checked: ${result.options.days}`);
  lines.push(`- Force mode: ${result.options.force ? 'yes' : 'no'}`);
  lines.push(`- Dry run: ${result.options.dryRun ? 'yes' : 'no'}`);
  lines.push(`- Sources checked: ${result.summary.sourcesChecked} (catalog ${result.summary.catalogSourcesChecked} + YouTube channels ${result.summary.youtubeChannelsChecked})`);
  lines.push(`- Source-selection note: ${result.summary.sourcesCheckedNote}`);
  lines.push(`- Learning context: trend ${result.learning_context.trend_direction}, average rating ${result.learning_context.average_rating} (${result.learning_context.total_ratings} ratings)`);
  lines.push(`- Learning patterns: ${result.learning_context.top_failure_patterns.join(', ') || 'none'}`);
  lines.push(`- Ranking ledger: ${result.summary.ranking.persisted ? `persisted (${result.summary.ranking.historyPath})` : 'not persisted'}`);
  lines.push(`- Updates found: ${result.summary.total} (CRITICAL ${result.summary.critical}, HIGH ${result.summary.high}, MEDIUM ${result.summary.medium}, LOW ${result.summary.low})`);
  lines.push('');

  if (result.updates.length === 0) {
    lines.push('No new updates detected.');
    return lines.join('\n');
  }

  const sections: Priority[] = ['HIGH', 'MEDIUM', 'LOW'];
  for (const priority of sections) {
    const bucket = result.updates.filter((update) => update.priority === priority);
    if (bucket.length === 0) continue;

    lines.push(`## ${priority} Priority (${bucket.length})`);
    lines.push('');

    for (const update of bucket) {
      lines.push(`### ${update.title}`);
      lines.push(`- Source: ${update.source} (${update.source_id})`);
      lines.push(`- Origin: ${update.origin}`);
      lines.push(`- Type: ${update.type}`);
      lines.push(`- Date: ${update.date}`);
      lines.push(`- URL: ${update.url}`);
      if (update.summary) lines.push(`- Summary: ${update.summary}`);
      if (update.recommendation) lines.push(`- Recommendation: ${update.recommendation}`);
      if (update.base_priority && update.adjusted_priority) {
        lines.push(`- Ranking: ${update.base_priority.toUpperCase()} (${update.base_score?.toFixed(3) || 'n/a'}) → ${update.adjusted_priority.toUpperCase()} (${update.adjusted_score?.toFixed(3) || 'n/a'}, Δ ${update.score_delta?.toFixed(3) || '0.000'})`);
      }
      if (update.ranking_rationale) lines.push(`- Ranking rationale: ${update.ranking_rationale}`);
      if ((update.ranking_matched_patterns || []).length > 0) {
        lines.push(`- Matched learning patterns: ${(update.ranking_matched_patterns || []).join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderJson(result: RunResult): string {
  return JSON.stringify(result, null, 2);
}

function printHelp(programName = 'MonitorSources.ts', title = 'Monitor upgrade sources'): void {
  console.log(`
${title}

Usage:
  bun ${programName} [--days <n>] [--provider <id>] [--force] [--dry-run] [--format <json|markdown>] [--history-path <path>] [--no-persist-history]
  bun ${programName} <days> [--force]    # legacy positional days

Options:
  --days <n>         Number of days to scan (default: ${DEFAULT_DAYS})
  --provider <id>    Source provider (default: ${DEFAULT_PROVIDER}, use 'all' for all providers)
  --force            Ignore state and report current items
  --dry-run          Do not persist state updates
  --history-path     Override recommendation history ledger path
  --persist-history  Persist ranking decisions (default: true when not dry-run)
  --no-persist-history  Disable recommendation history persistence
  --format <fmt>     Output format: json | markdown (default: markdown)
  --help, -h         Show this help

Examples:
  bun ${programName}
  bun ${programName} --days 14 --provider all
  bun ${programName} 7 --force
  bun ${programName} --history-path ./State/recommendation-history.jsonl
  bun ${programName} --format json --dry-run
`);
}

function parseArgs(args: string[], defaultProvider: string): ParseResult {
  const options: MonitorOptions = {
    days: DEFAULT_DAYS,
    force: false,
    provider: defaultProvider,
    dryRun: false,
    format: 'markdown',
    persistHistory: true
  };

  let positionalDaysConsumed = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      return { ok: true, showHelp: true, options };
    }

    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--persist-history') {
      options.persistHistory = true;
      continue;
    }

    if (arg === '--no-persist-history') {
      options.persistHistory = false;
      continue;
    }

    if (arg === '--days') {
      const value = args[i + 1];
      const parsed = Number.parseInt(value || '', 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, error: '--days requires a positive integer' };
      }
      options.days = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--days=')) {
      const parsed = Number.parseInt(arg.slice('--days='.length), 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, error: '--days requires a positive integer' };
      }
      options.days = parsed;
      continue;
    }

    if (arg === '--provider') {
      const value = args[i + 1];
      if (!value) {
        return { ok: false, error: '--provider requires a value' };
      }
      options.provider = value.toLowerCase();
      i += 1;
      continue;
    }

    if (arg.startsWith('--provider=')) {
      const value = arg.slice('--provider='.length);
      if (!value) {
        return { ok: false, error: '--provider requires a value' };
      }
      options.provider = value.toLowerCase();
      continue;
    }

    if (arg === '--format') {
      const value = args[i + 1];
      if (value !== 'json' && value !== 'markdown') {
        return { ok: false, error: '--format must be json|markdown' };
      }
      options.format = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length);
      if (value !== 'json' && value !== 'markdown') {
        return { ok: false, error: '--format must be json|markdown' };
      }
      options.format = value;
      continue;
    }

    if (arg === '--history-path') {
      const value = args[i + 1];
      if (!value) {
        return { ok: false, error: '--history-path requires a value' };
      }
      options.historyPath = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--history-path=')) {
      const value = arg.slice('--history-path='.length);
      if (!value) {
        return { ok: false, error: '--history-path requires a value' };
      }
      options.historyPath = value;
      continue;
    }

    if (!arg.startsWith('--') && !positionalDaysConsumed) {
      const parsed = Number.parseInt(arg, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, error: `Unexpected argument '${arg}'` };
      }
      options.days = parsed;
      positionalDaysConsumed = true;
      continue;
    }

    return { ok: false, error: `Unknown argument '${arg}'` };
  }

  if (options.dryRun && options.persistHistory) {
    options.persistHistory = false;
  }

  return { ok: true, options };
}

export async function runMonitorCli(rawArgs: string[], context: CliContext = {}): Promise<number> {
  const programName = context.programName || 'MonitorSources.ts';
  const helpTitle = context.helpTitle || 'Monitor upgrade sources';
  const defaultProvider = context.defaultProvider || DEFAULT_PROVIDER;

  const parsed = parseArgs(rawArgs, defaultProvider);
  if (!parsed.ok) {
    console.error(`❌ ${parsed.error}`);
    printHelp(programName, helpTitle);
    return 1;
  }

  if (parsed.showHelp || !parsed.options) {
    printHelp(programName, helpTitle);
    return 0;
  }

  const result = await runMonitor(parsed.options);
  if (parsed.options.format === 'json') {
    console.log(renderJson(result));
  } else {
    console.log(renderMarkdown(result));
  }

  return 0;
}

if (import.meta.main) {
  runMonitorCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  }).catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
