import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

import {
  createSecurityAuditLogger,
  type AppendSecurityAuditLog,
  type SecurityAuditEntry,
} from '../../plugins/security/audit-log.js';
import { matchesPathPattern } from '../../plugins/security/path-policy.js';
import { redactSensitiveText } from '../../plugins/security/redaction.js';

export type ResearchProvider = 'perplexity' | 'gemini' | 'grok' | 'unknown';

export type ResearchRequestClassification = {
  category: 'research_query';
  provider: ResearchProvider;
};

export type ResearchShellSecurityEvent = SecurityAuditEntry & {
  v: '0.1';
  ts: string;
  sessionId: string;
  tool: string;
  sourceEventId: string;
  action: 'allow' | 'block';
  category: 'path_access';
  requestCategory: 'research_query';
  provider: ResearchProvider;
  targetPreview: string;
  ruleId: string;
  reason: string;
};

export type ValidateSessionDirInput = {
  toolName: string;
  sessionDirRaw: string;
  sourceCallId?: string;
  sessionId?: string;
  query?: string;
};

export type ResearchShellSecurityAdapter = {
  validateSessionDirOrThrow(input: ValidateSessionDirInput): Promise<string>;
  classifyRequest(toolName: string): ResearchRequestClassification;
};

export type CreateResearchShellSecurityAdapterOptions = {
  appendAuditLog?: AppendSecurityAuditLog;
  allowedSessionDirPrefixes?: string[];
};

const DEFAULT_ALLOWED_SESSION_DIR_PREFIXES = [
  join(homedir(), '.config', 'opencode', 'scratchpad', 'sessions'),
  join(homedir(), '.config', 'opencode', 'MEMORY', 'WORK'),
];

const RESEARCH_TOOL_TO_PROVIDER: Record<string, Exclude<ResearchProvider, 'unknown'>> = {
  perplexity_search: 'perplexity',
  gemini_search: 'gemini',
  grok_search: 'grok',
};

export function parseAllowedSessionDirPrefixes(raw = process.env.RESEARCH_SHELL_ALLOWED_SESSION_DIR_PREFIXES): string[] {
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_ALLOWED_SESSION_DIR_PREFIXES;
  }

  const prefixes = raw
    .split(delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return prefixes.length > 0 ? prefixes : DEFAULT_ALLOWED_SESSION_DIR_PREFIXES;
}

export function classifyResearchShellRequest(toolName: string): ResearchRequestClassification {
  return {
    category: 'research_query',
    provider: RESEARCH_TOOL_TO_PROVIDER[toolName] ?? 'unknown',
  };
}

function deriveSessionId(sessionDirRaw: string): string {
  const parts = sessionDirRaw.split(/[\\/]+/).filter((part) => part.length > 0);
  for (const part of parts) {
    if (/^ses_[A-Za-z0-9]+$/.test(part)) {
      return part;
    }
  }

  return 'research-shell';
}

function buildSourceEventId(toolName: string, sessionId: string, sourceCallId?: string): string {
  return `${toolName}:${sessionId}:${sourceCallId ?? ''}`;
}

function buildTargetPreview(query: string | undefined, sessionDir: string): string {
  const previewParts = [
    `query=${query && query.trim().length > 0 ? query : '[empty]'}`,
    `session_dir=${sessionDir}`,
  ];
  return redactSensitiveText(previewParts.join(' '));
}

function buildAuditBase(input: ValidateSessionDirInput): {
  ts: string;
  sessionId: string;
  sourceEventId: string;
  classification: ResearchRequestClassification;
} {
  const sessionId = input.sessionId ?? deriveSessionId(input.sessionDirRaw);
  const classification = classifyResearchShellRequest(input.toolName);

  return {
    ts: new Date().toISOString(),
    sessionId,
    sourceEventId: buildSourceEventId(input.toolName, sessionId, input.sourceCallId),
    classification,
  };
}

function makeEvent(args: {
  input: ValidateSessionDirInput;
  action: 'allow' | 'block';
  ruleId: string;
  reason: string;
  sessionDirForPreview: string;
}): ResearchShellSecurityEvent {
  const base = buildAuditBase(args.input);

  return {
    v: '0.1',
    ts: base.ts,
    sessionId: base.sessionId,
    tool: args.input.toolName,
    sourceEventId: base.sourceEventId,
    action: args.action,
    category: 'path_access',
    requestCategory: base.classification.category,
    provider: base.classification.provider,
    targetPreview: buildTargetPreview(args.input.query, args.sessionDirForPreview),
    ruleId: args.ruleId,
    reason: args.reason,
  };
}

export function createResearchShellSecurityAdapter(
  options?: CreateResearchShellSecurityAdapterOptions,
): ResearchShellSecurityAdapter {
  const appendAuditLog = options?.appendAuditLog ?? createSecurityAuditLogger();
  const allowedSessionDirPrefixes =
    options?.allowedSessionDirPrefixes ?? parseAllowedSessionDirPrefixes();

  async function emit(event: ResearchShellSecurityEvent): Promise<void> {
    await appendAuditLog(event);
  }

  async function validateSessionDirOrThrow(input: ValidateSessionDirInput): Promise<string> {
    const sessionDirRaw = input.sessionDirRaw;

    if (!sessionDirRaw || sessionDirRaw.trim().length === 0) {
      const reason = 'session_dir cannot be empty';
      await emit(
        makeEvent({
          input,
          action: 'block',
          ruleId: 'research_shell.session_dir.empty',
          reason,
          sessionDirForPreview: '[empty]',
        }),
      );
      throw new Error(reason);
    }

    if (!isAbsolute(sessionDirRaw)) {
      const reason = `session_dir must be an absolute path, got: "${sessionDirRaw}"`;
      await emit(
        makeEvent({
          input,
          action: 'block',
          ruleId: 'research_shell.session_dir.absolute',
          reason,
          sessionDirForPreview: sessionDirRaw,
        }),
      );
      throw new Error(reason);
    }

    const sessionDirReal = await realpath(sessionDirRaw);
    const sessionDirStat = await stat(sessionDirReal);
    if (!sessionDirStat.isDirectory()) {
      const reason = `session_dir must be a directory, got: "${sessionDirReal}"`;
      await emit(
        makeEvent({
          input,
          action: 'block',
          ruleId: 'research_shell.session_dir.directory',
          reason,
          sessionDirForPreview: sessionDirReal,
        }),
      );
      throw new Error(reason);
    }

    const allowedPrefixReals = await Promise.all(
      allowedSessionDirPrefixes.map(async (prefix) => {
        try {
          return await realpath(prefix);
        } catch {
          return resolve(prefix);
        }
      }),
    );

    const isAllowed = allowedPrefixReals.some((prefix) => matchesPathPattern(sessionDirReal, prefix));
    if (!isAllowed) {
      const reason =
        `session_dir is not allowed: "${sessionDirReal}". ` +
        `Allowed prefixes: ${allowedSessionDirPrefixes.join(', ')}`;
      await emit(
        makeEvent({
          input,
          action: 'block',
          ruleId: 'research_shell.session_dir.allowlist',
          reason,
          sessionDirForPreview: sessionDirReal,
        }),
      );
      throw new Error(reason);
    }

    await emit(
      makeEvent({
        input,
        action: 'allow',
        ruleId: 'research_shell.session_dir.allow',
        reason: 'session_dir allowed by prefix policy',
        sessionDirForPreview: sessionDirReal,
      }),
    );

    return sessionDirReal;
  }

  return {
    validateSessionDirOrThrow,
    classifyRequest: classifyResearchShellRequest,
  };
}
