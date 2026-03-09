import type {
  BinaryTestsParams,
  RegexMatchParams,
  StateCheckParams,
  StaticAnalysisParams,
  StringMatchParams,
} from '../../Types/index.ts';

type RawParams = Record<string, unknown> | undefined;
type MatchMode = 'all' | 'any';

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isMatchMode(value: unknown): value is MatchMode {
  return value === 'all' || value === 'any';
}

export function parseStringMatchParams(raw: RawParams): StringMatchParams | null {
  const params = toRecord(raw);
  if (!params) return null;
  if (!isStringArray(params.patterns) || !isMatchMode(params.mode)) {
    return null;
  }

  const parsed: StringMatchParams = {
    patterns: params.patterns,
    mode: params.mode,
  };

  if (typeof params.case_sensitive === 'boolean') {
    parsed.case_sensitive = params.case_sensitive;
  }

  return parsed;
}

export function parseRegexMatchParams(raw: RawParams): RegexMatchParams | null {
  const params = toRecord(raw);
  if (!params) return null;
  if (!isStringArray(params.patterns) || !isMatchMode(params.mode)) {
    return null;
  }

  const parsed: RegexMatchParams = {
    patterns: params.patterns,
    mode: params.mode,
  };

  if (typeof params.flags === 'string') {
    parsed.flags = params.flags;
  }

  return parsed;
}

export function parseBinaryTestsParams(raw: RawParams): BinaryTestsParams | null {
  const params = toRecord(raw);
  if (!params) return null;
  if (!isStringArray(params.test_files)) {
    return null;
  }

  const parsed: BinaryTestsParams = {
    test_files: params.test_files,
  };

  if (typeof params.test_command === 'string') {
    parsed.test_command = params.test_command;
  }

  if (typeof params.timeout_ms === 'number' && Number.isFinite(params.timeout_ms)) {
    parsed.timeout_ms = params.timeout_ms;
  }

  return parsed;
}

export function parseStaticAnalysisParams(raw: RawParams): StaticAnalysisParams | null {
  const params = toRecord(raw);
  if (!params) return null;
  if (!isStringArray(params.commands)) {
    return null;
  }

  const parsed: StaticAnalysisParams = {
    commands: params.commands,
  };

  if (typeof params.fail_on_warning === 'boolean') {
    parsed.fail_on_warning = params.fail_on_warning;
  }

  return parsed;
}

export function parseStateCheckParams(raw: RawParams): StateCheckParams | null {
  const params = toRecord(raw);
  if (!params) return null;

  const expect = toRecord(params.expect);
  if (!expect) {
    return null;
  }

  const parsed: StateCheckParams = { expect };

  if (params.check_files !== undefined) {
    if (!Array.isArray(params.check_files)) {
      return null;
    }

    const checkFiles: NonNullable<StateCheckParams['check_files']> = [];
    for (const entry of params.check_files) {
      const record = toRecord(entry);
      if (!record || typeof record.path !== 'string') {
        return null;
      }

      const fileCheck: NonNullable<StateCheckParams['check_files']>[number] = {
        path: record.path,
      };

      if (record.contains !== undefined) {
        if (!isStringArray(record.contains)) {
          return null;
        }
        fileCheck.contains = record.contains;
      }

      if (record.not_contains !== undefined) {
        if (!isStringArray(record.not_contains)) {
          return null;
        }
        fileCheck.not_contains = record.not_contains;
      }

      checkFiles.push(fileCheck);
    }

    parsed.check_files = checkFiles;
  }

  if (params.check_env !== undefined) {
    const checkEnvRecord = toRecord(params.check_env);
    if (!checkEnvRecord) {
      return null;
    }

    const checkEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(checkEnvRecord)) {
      if (typeof value !== 'string') {
        return null;
      }
      checkEnv[key] = value;
    }

    parsed.check_env = checkEnv;
  }

  return parsed;
}
