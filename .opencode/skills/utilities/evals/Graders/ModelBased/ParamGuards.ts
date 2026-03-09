import type {
  LLMRubricParams,
  NaturalLanguageAssertParams,
  PairwiseComparisonParams,
} from '../../Types/index.ts';

type RawParams = Record<string, unknown> | undefined;
type RubricScale = NonNullable<LLMRubricParams['scale']>;

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRubricScale(value: unknown): value is RubricScale {
  return value === '1-5' || value === '1-10' || value === 'pass-fail';
}

export function parseLLMRubricParams(raw: RawParams): LLMRubricParams | null {
  const params = toRecord(raw);
  if (!params || typeof params.rubric !== 'string') {
    return null;
  }

  const parsed: LLMRubricParams = {
    rubric: params.rubric,
  };

  if (params.assertions !== undefined) {
    if (!isStringArray(params.assertions)) {
      return null;
    }
    parsed.assertions = params.assertions;
  }

  if (typeof params.judge_model === 'string') {
    parsed.judge_model = params.judge_model;
  }

  if (typeof params.reasoning_first === 'boolean') {
    parsed.reasoning_first = params.reasoning_first;
  }

  if (params.scale !== undefined) {
    if (!isRubricScale(params.scale)) {
      return null;
    }
    parsed.scale = params.scale;
  }

  return parsed;
}

export function parseNaturalLanguageAssertParams(raw: RawParams): NaturalLanguageAssertParams | null {
  const params = toRecord(raw);
  if (!params || !isStringArray(params.assertions)) {
    return null;
  }

  const parsed: NaturalLanguageAssertParams = {
    assertions: params.assertions,
  };

  if (typeof params.judge_model === 'string') {
    parsed.judge_model = params.judge_model;
  }

  if (typeof params.require_all === 'boolean') {
    parsed.require_all = params.require_all;
  }

  return parsed;
}

export function parsePairwiseComparisonParams(raw: RawParams): PairwiseComparisonParams | null {
  const params = toRecord(raw);
  if (!params || typeof params.reference !== 'string') {
    return null;
  }

  const parsed: PairwiseComparisonParams = {
    reference: params.reference,
  };

  if (typeof params.judge_model === 'string') {
    parsed.judge_model = params.judge_model;
  }

  if (typeof params.position_swap === 'boolean') {
    parsed.position_swap = params.position_swap;
  }

  if (params.criteria !== undefined) {
    if (!isStringArray(params.criteria)) {
      return null;
    }
    parsed.criteria = params.criteria;
  }

  return parsed;
}
