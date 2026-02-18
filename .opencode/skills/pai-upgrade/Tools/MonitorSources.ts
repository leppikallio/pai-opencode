#!/usr/bin/env bun

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { loadSkillConfig } from '../../PAI/Tools/LoadSkillConfig';
import { buildLearningContext, type LearningContext } from './BuildLearningContext';
import {
  getDefaultRecommendationHistoryPath,
  rankRecommendations,
  type RecommendationCandidate,
  type RecommendationPriority
} from './RankRecommendations';

type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
type SourceCategory = 'blog' | 'github' | 'changelog' | 'docs' | 'community';
type UpdateType = 'blog' | 'commit' | 'release' | 'changelog' | 'docs' | 'community';
type OutputFormat = 'json' | 'markdown';
type StateChannel = 'content' | 'commits' | 'releases';

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
  source_id: string;
  source: string;
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
}

interface MonitorOptions {
  days: number;
  force: boolean;
  provider: string;
  dryRun: boolean;
  format: OutputFormat;
  persistHistory: boolean;
  historyPath?: string;
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

interface RunResult {
  generatedAt: string;
  options: MonitorOptions;
  updates: Update[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    provider: string;
    sourcesChecked: number;
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
const SKILL_DIR = resolve(join(import.meta.dir, '..'));
const STATE_DIR = join(SKILL_DIR, 'State');
const STATE_FILE = join(STATE_DIR, 'last-check.json');
const SOURCES_V2_FILE = 'sources.v2.json';
const SOURCES_V1_FILE = 'sources.json';
const LOG_DIR = join(SKILL_DIR, 'Logs');
const LOG_FILE = join(LOG_DIR, 'run-history.jsonl');

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

function loadSourcesConfig(): Source[] {
  const rawV2 = loadSkillConfig<Partial<SourcesV2>>(SKILL_DIR, SOURCES_V2_FILE);
  if (isObject(rawV2) && Array.isArray(rawV2.sources)) {
    const v2Sources = rawV2.sources
      .map((source) => normalizeSource(source))
      .filter((source): source is Source => source !== null);

    if (v2Sources.length > 0) {
      return v2Sources;
    }
  }

  const rawV1 = loadSkillConfig<Partial<SourcesV1>>(SKILL_DIR, SOURCES_V1_FILE);
  return migrateV1Sources(rawV1);
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
        provider: DEFAULT_PROVIDER,
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

function defaultState(days: number): MonitorState {
  return {
    schema_version: 2,
    last_check_timestamp: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    sources: {}
  };
}

function loadState(days: number, sources: Source[]): MonitorState {
  if (!existsSync(STATE_FILE)) {
    return defaultState(days);
  }

  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as unknown;
    if (isStateV2(raw)) {
      return raw;
    }

    return migrateLegacyState(raw, days, sources);
  } catch (error) {
    console.warn('⚠️ Failed to load state, starting fresh:', error);
    return defaultState(days);
  }
}

function isStateV2(raw: unknown): raw is MonitorState {
  return (
    isObject(raw) &&
    raw.schema_version === 2 &&
    isObject(raw.sources)
  );
}

function migrateLegacyState(raw: unknown, days: number, sources: Source[]): MonitorState {
  const migrated = defaultState(days);
  if (!isObject(raw)) return migrated;

  if (typeof raw.last_check_timestamp === 'string' || raw.last_check_timestamp === null) {
    migrated.last_check_timestamp = raw.last_check_timestamp;
  }

  const legacySources = isObject(raw.sources) ? raw.sources : {};

  for (const source of sources) {
    if (source.category === 'github') {
      copyLegacyState(source, 'commits', legacySources, migrated.sources);
      copyLegacyState(source, 'releases', legacySources, migrated.sources);
      continue;
    }

    if (source.category === 'community') {
      continue;
    }

    copyLegacyState(source, 'content', legacySources, migrated.sources);
  }

  return migrated;
}

function copyLegacyState(
  source: Source,
  channel: StateChannel,
  legacyMap: Record<string, unknown>,
  target: Record<string, SourceState>
): void {
  const candidates = legacyStateKeyCandidates(source, channel);
  const stableKey = stableStateKey(source.id, channel);

  for (const candidate of candidates) {
    const entry = legacyMap[candidate];
    if (!isObject(entry)) continue;

    target[stableKey] = {
      last_checked: typeof entry.last_checked === 'string' ? entry.last_checked : new Date().toISOString(),
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

function saveState(state: MonitorState): void {
  try {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.error('❌ Failed to save state:', error);
  }
}

function logRun(result: RunResult): void {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    appendFileSync(
      LOG_FILE,
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

function getStateRecord(state: MonitorState, sourceId: string, channel: StateChannel): SourceState | undefined {
  return state.sources[stableStateKey(sourceId, channel)];
}

function setStateRecord(state: MonitorState, sourceId: string, channel: StateChannel, patch: Partial<SourceState>): void {
  const key = stableStateKey(sourceId, channel);
  const previous = state.sources[key] || { last_checked: new Date().toISOString() };
  state.sources[key] = {
    ...previous,
    ...patch,
    last_checked: patch.last_checked || new Date().toISOString()
  };
}

async function fetchBlogLike(source: Source, state: MonitorState, options: MonitorOptions): Promise<Update[]> {
  if (!source.url) return [];

  try {
    const response = await fetch(source.url);
    if (!response.ok) {
      console.warn(`⚠️ Failed to fetch ${source.name}: ${response.status}`);
      return [];
    }

    const content = await response.text();
    const contentHash = hash(content.substring(0, 5000));
    const stateRecord = getStateRecord(state, source.id, 'content');
    const unchanged = !options.force && stateRecord?.last_hash === contentHash;

    setStateRecord(state, source.id, 'content', {
      last_checked: new Date().toISOString(),
      last_hash: contentHash,
      last_title: stateRecord?.last_title
    });

    if (unchanged) {
      return [];
    }

    const titleMatch = content.match(/<h1[^>]*>(.*?)<\/h1>/i) || content.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Latest update';

    setStateRecord(state, source.id, 'content', {
      last_checked: new Date().toISOString(),
      last_hash: contentHash,
      last_title: title
    });

    const type: UpdateType = source.category === 'docs'
      ? 'docs'
      : source.category === 'changelog'
        ? 'changelog'
        : 'blog';

    return [{
      source_id: source.id,
      source: source.name,
      provider: source.provider,
      category: source.category,
      type,
      title: `${source.name}: ${title}`,
      url: source.url,
      date: new Date().toISOString().split('T')[0],
      hash: contentHash,
      priority: source.priority,
      summary: `${source.category} content changed`
    }];
  } catch (error) {
    console.warn(`⚠️ Error fetching ${source.name}:`, error);
    return [];
  }
}

async function fetchGitHub(source: Source, state: MonitorState, options: MonitorOptions): Promise<Update[]> {
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
      const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000).toISOString();
      const commitUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/commits?since=${since}&per_page=10`;
      const response = await fetch(commitUrl, { headers });

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
          const date = commit.commit?.author?.date?.split('T')[0] || new Date().toISOString().split('T')[0];

          updates.push({
            source_id: source.id,
            source: source.name,
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
            last_checked: new Date().toISOString(),
            last_sha: newestSha,
            last_title: commits[0]?.commit?.message?.split('\n')[0]
          });
        } else {
          setStateRecord(state, source.id, 'commits', {
            last_checked: new Date().toISOString()
          });
        }
      }
    }

    if (source.check_releases) {
      const releaseUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/releases?per_page=5`;
      const response = await fetch(releaseUrl, { headers });

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
            provider: source.provider,
            category: 'github',
            type: 'release',
            title: `${tag}: ${release.name || 'New release'}`,
            url: release.html_url || '',
            date: release.published_at?.split('T')[0] || new Date().toISOString().split('T')[0],
            version: tag,
            priority: source.priority,
            summary: release.body ? `${release.body.substring(0, 200)}...` : 'See release notes'
          });
        }

        const newestTag = releases[0]?.tag_name;
        if (newestTag) {
          setStateRecord(state, source.id, 'releases', {
            last_checked: new Date().toISOString(),
            last_version: newestTag,
            last_title: `${newestTag}: ${releases[0]?.name || 'New release'}`
          });
        } else {
          setStateRecord(state, source.id, 'releases', {
            last_checked: new Date().toISOString()
          });
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

function buildRecommendationCandidates(updates: Update[]): RecommendationCandidate[] {
  return updates.map((update, index) => {
    const stableHint = update.sha || update.version || update.hash || `${update.date}-${index}`;
    const id = `${update.source_id}:${update.type}:${hash(`${stableHint}:${update.title}`).slice(0, 12)}`;

    const tags = [
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
      category: update.category
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

function applyLearningRanking(updates: Update[], options: MonitorOptions): {
  updates: Update[];
  learning_context: RunResult['learning_context'];
  ranking: RunResult['summary']['ranking'];
} {
  const learningContext = buildLearningContext({
    lookbackDays: Math.max(options.days, 7)
  });

  const learning_context = buildLearningContextSummary(learningContext);
  const historyPath = resolve(options.historyPath || getDefaultRecommendationHistoryPath());
  const candidates = buildRecommendationCandidates(updates);
  const shouldPersistHistory = options.persistHistory && !options.dryRun && candidates.length > 0;

  const ranked = rankRecommendations(candidates, learningContext, {
    persistHistory: shouldPersistHistory,
    historyPath
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

async function runMonitor(options: MonitorOptions): Promise<RunResult> {
  const allSources = loadSourcesConfig();
  const provider = options.provider.toLowerCase();
  const selectedSources = provider === 'all'
    ? allSources
    : allSources.filter((source) => source.provider.toLowerCase() === provider);

  if (selectedSources.length === 0) {
    const available = [...new Set(allSources.map((source) => source.provider.toLowerCase()))].sort();
    throw new Error(`No sources found for provider '${options.provider}'. Available: ${available.join(', ') || '(none)'}`);
  }

  const state = loadState(options.days, selectedSources);
  const nextState: MonitorState = {
    schema_version: 2,
    last_check_timestamp: new Date().toISOString(),
    sources: { ...state.sources }
  };

  const tasks = selectedSources.map(async (source) => {
    if (source.category === 'github') {
      return fetchGitHub(source, nextState, options);
    }

    if (source.category === 'community') {
      return [] as Update[];
    }

    return fetchBlogLike(source, nextState, options);
  });

  const updateArrays = await Promise.all(tasks);
  const baseUpdates = updateArrays.flat().map((update) => ({
    ...update,
    recommendation: generateRecommendation(update),
    priority: assessRelevance(update)
  }));

  const ranked = applyLearningRanking(baseUpdates, options);
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

  const result: RunResult = {
    generatedAt: new Date().toISOString(),
    options,
    updates,
    summary: {
      total: updates.length,
      critical,
      high,
      medium,
      low,
      provider: options.provider,
      sourcesChecked: selectedSources.length,
      ranking: ranked.ranking
    },
    learning_context: ranked.learning_context,
    dryRun: options.dryRun
  };

  if (!options.dryRun) {
    saveState(nextState);
    logRun(result);
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
  lines.push(`- Sources checked: ${result.summary.sourcesChecked}`);
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
  bun ${programName} --days 14 --provider anthropic
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
