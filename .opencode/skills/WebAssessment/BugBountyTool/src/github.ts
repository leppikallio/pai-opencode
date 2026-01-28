// GitHub API client for bug bounty tracking

import { CONFIG } from './config.js';
import type { GitHubCommit, Program } from './types.js';

export class GitHubClient {
  private baseUrl = CONFIG.api.base;
  private repoPath = `repos/${CONFIG.repo.owner}/${CONFIG.repo.name}`;

  /**
   * TIER 1: Fast check - Get commits for a specific file
   * This is lightweight and tells us if there are ANY changes
   */
  async getCommitsSince(filePath: string, since: string): Promise<GitHubCommit[]> {
    const url = `${this.baseUrl}/${this.repoPath}/commits?path=${filePath}&since=${since}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to fetch commits:', error);
      return [];
    }
  }

  /**
   * Get the latest commit for a file
   */
  async getLatestCommit(filePath: string): Promise<GitHubCommit | null> {
    const url = `${this.baseUrl}/${this.repoPath}/commits?path=${filePath}&per_page=1`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        return null;
      }

      const commits = await response.json();
      return commits[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * TIER 2: Detailed analysis - Get the diff between two commits
   * This shows us EXACTLY what changed without downloading full files
   */
  async getCompareDiff(baseCommit: string, headCommit: string): Promise<string> {
    const url = `${this.baseUrl}/${this.repoPath}/compare/${baseCommit}...${headCommit}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = await response.json();
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error('Failed to fetch diff:', error);
      return '';
    }
  }

  /**
   * Fetch a specific file from the repository
   * Used for initial bootstrap or when we need full data
   */
  async fetchFile(filePath: string, commit?: string): Promise<string> {
    const branch = commit || 'main';
    const url = `${CONFIG.api.raw_base}/${CONFIG.repo.owner}/${CONFIG.repo.name}/${branch}/${filePath}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      console.error('Failed to fetch file:', error);
      return '';
    }
  }

  /**
   * Parse program data from JSON
   */
  parsePrograms(jsonData: string, platform: Program['platform']): Program[] {
    try {
      const data = JSON.parse(jsonData);

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map(item => this.normalizeProgram(item, platform));
    } catch (error) {
      console.error('Failed to parse programs:', error);
      return [];
    }
  }

  /**
   * Normalize program data from different platforms
   */
  private normalizeProgram(data: unknown, platform: Program['platform']): Program {
    const record = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
    return {
      name: typeof record.name === 'string' ? record.name : 'Unknown',
      platform,
      handle: (typeof record.handle === 'string' && record.handle)
        || (typeof record.id === 'string' && record.id)
        || 'unknown',
      url: typeof record.url === 'string' ? record.url : '',
      website: typeof record.website === 'string' ? record.website : undefined,
      offers_bounties: Boolean(record.offers_bounties ?? record.bounty),
      offers_swag: Boolean(record.offers_swag ?? record.swag),
      submission_state: typeof record.submission_state === 'string' ? record.submission_state : 'unknown',
      key_scopes: this.extractScopes(record),
      discovered_at: new Date().toISOString(),
      max_severity: this.extractMaxSeverity(record),
      managed_program: typeof record.managed_program === 'boolean' ? record.managed_program : undefined,
    };
  }

  /**
   * Extract scope domains from program data
   */
  private extractScopes(data: Record<string, unknown>): string[] {
    if (Array.isArray(data.domains)) {
      return data.domains.filter((d): d is string => typeof d === 'string');
    }

    const targets = data.targets;
    const inScope = (targets && typeof targets === 'object' && 'in_scope' in targets)
      ? (targets as { in_scope?: unknown }).in_scope
      : undefined;
    if (Array.isArray(inScope)) {
      return inScope
        .map((t) => (t && typeof t === 'object' && 'asset_identifier' in t)
          ? (t as { asset_identifier?: string }).asset_identifier
          : undefined)
        .filter((v): v is string => Boolean(v))
        .slice(0, 10);
    }

    return [];
  }

  /**
   * Extract maximum severity from program data
   */
  private extractMaxSeverity(data: Record<string, unknown>): string | undefined {
    const targets = data.targets;
    const inScope = (targets && typeof targets === 'object' && 'in_scope' in targets)
      ? (targets as { in_scope?: unknown }).in_scope
      : undefined;
    if (Array.isArray(inScope)) {
      const severities = inScope
        .map((t) => (t && typeof t === 'object' && 'max_severity' in t)
          ? (t as { max_severity?: string }).max_severity
          : undefined)
        .filter((v): v is string => Boolean(v));

      if (severities.includes('critical')) return 'critical';
      if (severities.includes('high')) return 'high';
      if (severities.includes('medium')) return 'medium';
      if (severities.includes('low')) return 'low';
    }

    return undefined;
  }
}
