import type { PermissionInput, ToolInput } from "../adapters/types";

export type PathRules = {
  zeroAccess: string[];
  readOnly: string[];
  confirmWrite: string[];
  noDelete: string[];
};

export type RawProjectRules<TRawRule> = {
  id: string;
  cwd: string[];
  dangerous: TRawRule[];
  warning: TRawRule[];
  allowed: TRawRule[];
  alert: TRawRule[];
  pathRules: PathRules;
};

export type CompiledProjectRules<TCompiledRule> = {
  id: string;
  cwd: string[];
  dangerous: TCompiledRule[];
  warning: TCompiledRule[];
  allowed: TCompiledRule[];
  alert: TCompiledRule[];
  pathRules: PathRules;
};

type ProjectRuleLike<TRule> = {
  dangerous: TRule[];
  warning: TRule[];
  allowed: TRule[];
  alert: TRule[];
  pathRules: PathRules;
};

export function getRuntimeCwdFromInput(input: PermissionInput | ToolInput): string {
  const fromInput = (input as ToolInput & { cwd?: unknown }).cwd;
  if (typeof fromInput === "string" && fromInput.trim()) return fromInput;

  const fromArgs = input.args && typeof input.args.cwd === "string" ? input.args.cwd : undefined;
  if (typeof fromArgs === "string" && fromArgs.trim()) return fromArgs;

  return process.cwd();
}

export function projectHasRules<TRule>(project: ProjectRuleLike<TRule>): boolean {
  const ppr = project.pathRules;
  return (
    project.dangerous.length > 0 ||
    project.warning.length > 0 ||
    project.allowed.length > 0 ||
    project.alert.length > 0 ||
    ppr.zeroAccess.length > 0 ||
    ppr.readOnly.length > 0 ||
    ppr.confirmWrite.length > 0 ||
    ppr.noDelete.length > 0
  );
}

export function compileProjectRules<TRawRule, TCompiledRule>(
  projects: Array<RawProjectRules<TRawRule>>,
  compileRules: (raw: TRawRule[]) => TCompiledRule[]
): Array<CompiledProjectRules<TCompiledRule>> {
  return projects
    .map((project) => ({
      id: project.id,
      cwd: project.cwd,
      dangerous: compileRules(project.dangerous),
      warning: compileRules(project.warning),
      allowed: compileRules(project.allowed),
      alert: compileRules(project.alert ?? []),
      pathRules: project.pathRules ?? { zeroAccess: [], readOnly: [], confirmWrite: [], noDelete: [] },
    }))
    .filter((project) => project.cwd.length > 0 && projectHasRules(project));
}

type EffectiveConfigShape<TCompiledRule> = {
  dangerous: TCompiledRule[];
  warning: TCompiledRule[];
  allowed: TCompiledRule[];
  alert: TCompiledRule[];
  pathRules: PathRules;
  projects: Array<CompiledProjectRules<TCompiledRule>>;
};

export function resolveEffectiveProjectConfig<
  TCompiledRule,
  TConfig extends EffectiveConfigShape<TCompiledRule>,
>(
  baseConfig: TConfig,
  cwd: string,
  matchesPathPattern: (filePath: string, pattern: string) => boolean
): TConfig {
  const matchedProjects = baseConfig.projects.filter(
    (project) => project.cwd.length > 0 && project.cwd.some((selector) => matchesPathPattern(cwd, selector))
  );

  if (matchedProjects.length === 0) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    dangerous: [...matchedProjects.flatMap((project) => project.dangerous), ...baseConfig.dangerous],
    warning: [...matchedProjects.flatMap((project) => project.warning), ...baseConfig.warning],
    allowed: [...matchedProjects.flatMap((project) => project.allowed), ...baseConfig.allowed],
    alert: [...matchedProjects.flatMap((project) => project.alert), ...baseConfig.alert],
    pathRules: {
      zeroAccess: [
        ...matchedProjects.flatMap((project) => project.pathRules.zeroAccess),
        ...baseConfig.pathRules.zeroAccess,
      ],
      readOnly: [...matchedProjects.flatMap((project) => project.pathRules.readOnly), ...baseConfig.pathRules.readOnly],
      confirmWrite: [
        ...matchedProjects.flatMap((project) => project.pathRules.confirmWrite),
        ...baseConfig.pathRules.confirmWrite,
      ],
      noDelete: [...matchedProjects.flatMap((project) => project.pathRules.noDelete), ...baseConfig.pathRules.noDelete],
    },
  };
}
