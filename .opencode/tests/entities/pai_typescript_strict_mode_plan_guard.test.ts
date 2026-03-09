import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const opencodeRoot = path.join(repoRoot, ".opencode");

type PackageJson = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type TsConfigJson = {
  compilerOptions?: Record<string, unknown>;
  include?: unknown;
};

function readJson<T>(filePath: string): T {
  const content = readFileSync(filePath, "utf8");
  return JSON.parse(content) as T;
}

describe("TypeScript strict mode plan guard", () => {
  test("root package pins deterministic local typecheck toolchain", () => {
    const packagePath = path.join(repoRoot, "package.json");
    expect(existsSync(packagePath)).toBe(true);

    const pkg = readJson<PackageJson>(packagePath);
    const typecheckScript = pkg.scripts?.typecheck ?? "";

    expect(typecheckScript).toContain("tsc --project .opencode/tsconfig.json");
    expect(typecheckScript).toContain("--project .opencode/tsconfig.json");
    expect(typecheckScript).toContain("--pretty false");
    expect(typecheckScript).toContain("--noEmit");
    expect(typecheckScript).not.toContain("bun x");

    expect(pkg.devDependencies?.typescript).toBe("5.9.3");
    expect(pkg.devDependencies?.["@types/node"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies?.["@types/bun"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test(".opencode tsconfig keeps strict semantics enabled", () => {
    const tsconfigPath = path.join(opencodeRoot, "tsconfig.json");
    expect(existsSync(tsconfigPath)).toBe(true);

    const config = readJson<TsConfigJson>(tsconfigPath);
    const compilerOptions = config.compilerOptions ?? {};

    const requiredStrictFlags = [
      "strict",
      "noImplicitAny",
      "strictNullChecks",
      "strictFunctionTypes",
      "strictBindCallApply",
      "strictPropertyInitialization",
      "noImplicitThis",
      "useUnknownInCatchVariables",
      "alwaysStrict",
    ] as const;

    for (const flag of requiredStrictFlags) {
      expect(compilerOptions[flag]).toBe(true);
    }

    const strictFamilyFlags = [
      "strict",
      "noImplicitAny",
      "strictNullChecks",
      "strictFunctionTypes",
      "strictBindCallApply",
      "strictPropertyInitialization",
      "noImplicitThis",
      "useUnknownInCatchVariables",
      "alwaysStrict",
    ] as const;

    for (const flag of strictFamilyFlags) {
      expect(compilerOptions[flag]).not.toBe(false);
    }

    const include = Array.isArray(config.include) ? config.include : [];
    expect(include).toEqual(expect.arrayContaining([
      "**/*.ts",
      "**/*.tsx",
      "**/*.mts",
      "**/*.cts",
    ]));
  });

  test("precommit enforces repo typecheck for staged TypeScript by default", () => {
    const precommitPath = path.join(repoRoot, "Tools", "Precommit.ts");
    expect(existsSync(precommitPath)).toBe(true);

    const source = readFileSync(precommitPath, "utf8");
    expect(source).toContain("args: [\"run\", \"typecheck\"]");
    expect(source).toMatch(/if \(tsFiles\.length > 0\)[\s\S]*args: \["run", "typecheck"\]/);

    // Ensure staged TS detection covers modern TypeScript extensions.
    expect(source).toContain("lower.endsWith(\".mts\")");
    expect(source).toContain("lower.endsWith(\".cts\")");

    // Final posture: typecheck failure blocks commit by default.
    expect(source).toMatch(/if \(code !== 0\) \{[\s\S]*Precommit requires repo typecheck to pass for staged TypeScript changes\.[\s\S]*failed = true;/);
    expect(source).not.toContain("PAI_PRECOMMIT_TYPECHECK_ENFORCE");
    expect(source).not.toContain("Landing sequence: keep the gate advisory while repo-wide typecheck remains red.");
  });
});
