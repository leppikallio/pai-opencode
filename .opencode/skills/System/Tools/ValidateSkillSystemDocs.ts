#!/usr/bin/env bun
/**
 * ValidateSkillSystemDocs
 *
 * Lightweight, runtime-safe validator for the SkillSystem split docs.
 *
 * Checks:
 *  1) SkillSystem.md routing table includes each section doc in SkillSystem/*.md
 *  2) Each section doc contains backlink header fields + canary comment
 *  3) Section docs must not instruct SkillSearch as a required step
 *     (we treat `SkillSearch(` as a violation; mentions in AntiPatterns are allowed).
 *  4) Any SKILL.md under skills root must not contain `SkillSearch(`.
 *
 * This tool is intentionally separate from ScanBrokenRefs.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

type Format = "text" | "json";

type Finding = {
  severity: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  details?: Record<string, unknown>;
};

type Report = {
  ok: boolean;
  errors: Finding[];
  warnings: Finding[];
  meta: {
    indexPath: string;
    sectionsDir: string;
    skillsRoot: string;
    sectionDocs: string[];
    skillDocsChecked: number;
    routingTableDocs: string[];
    routingTableCanaries: Record<string, string>;
  };
};

const DEFAULT_INDEX_PATH =
  "/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md";
const DEFAULT_SECTIONS_DIR =
  "/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem";

function usageText(): string {
  return `ValidateSkillSystemDocs

Usage:
  bun ValidateSkillSystemDocs.ts [--index <path>] [--sections-dir <dir>] [--skills-root <dir>] [--format text|json]

Defaults:
  --index        ${DEFAULT_INDEX_PATH}
  --sections-dir ${DEFAULT_SECTIONS_DIR}
  --skills-root  inferred from --index (../..)

Exit codes:
  0  All checks passed
  1  One or more failures detected
  2  Tool error (bad args, IO, parse failure)
`;
}

function parseArgs(argv: string[]) {
  const out: {
    indexPath: string;
    sectionsDir: string;
    skillsRoot?: string;
    format: Format;
    help: boolean;
  } = {
    indexPath: DEFAULT_INDEX_PATH,
    sectionsDir: DEFAULT_SECTIONS_DIR,
    format: "text",
    help: false,
  };

  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (!a) break;

    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }

    if (a === "--index") {
      const v = args.shift();
      if (!v) throw new Error("--index requires a value");
      out.indexPath = v;
      continue;
    }

    if (a === "--sections-dir" || a === "--sectionsDir") {
      const v = args.shift();
      if (!v) throw new Error("--sections-dir requires a value");
      out.sectionsDir = v;
      continue;
    }

    if (a === "--skills-root" || a === "--skillsRoot") {
      const v = args.shift();
      if (!v) throw new Error("--skills-root requires a value");
      out.skillsRoot = v;
      continue;
    }

    if (a === "--format") {
      const v = args.shift();
      if (!v) throw new Error("--format requires a value");
      if (v !== "json" && v !== "text") {
        throw new Error(`--format must be json|text (got ${v})`);
      }
      out.format = v;
      continue;
    }

    throw new Error(`Unknown arg: ${a}`);
  }

  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listSectionDocs(sectionsDir: string): Promise<string[]> {
  const entries = await fs.readdir(sectionsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(sectionsDir, e.name))
    .sort((a, b) => a.localeCompare(b));
}

async function listSkillDocs(skillsRoot: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name === "SKILL.md") {
        out.push(full);
      }
    }
  }

  await walk(skillsRoot);
  return out.sort((a, b) => a.localeCompare(b));
}

function inferSkillsRootFromIndex(indexPath: string): string {
  // /.../skills/PAI/SYSTEM/SkillSystem.md -> /.../skills
  return path.resolve(path.dirname(indexPath), "..", "..");
}

/**
 * Parse the routing table in SkillSystem.md.
 *
 * Expected table schema:
 * | Category | Read this section doc (NOT auto-loaded) | Canary / citation requirement |
 * | ... | `/abs/path/SkillSystem/Foo.md` | Cite `<!-- SKILLSYSTEM:FOO:v1 -->` ... |
 */
function parseRoutingTable(indexMd: string): {
  docToCanary: Record<string, string>;
  docs: string[];
} {
  const lines = indexMd.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes("## Read-gated routing table"));
  if (start === -1) {
    throw new Error("Could not find routing table section header");
  }

  // Find first table header row after the section heading.
  let i = start;
  while (i < lines.length && !lines[i].trim().startsWith("|")) i++;
  if (i >= lines.length) {
    throw new Error("Could not find routing table rows");
  }

  const docToCanary: Record<string, string> = {};

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) break; // end of table
    if (/^\|\s*-+\s*\|/.test(line)) continue; // divider rows

    const cols = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cols.length < 3) continue;

    const docCol = cols[1];
    const canaryCol = cols[2];

    const docMatch = docCol.match(/`([^`]+)`/);
    const canaryMatch = canaryCol.match(/`(<!--\s*SKILLSYSTEM:[^`]+?-->)`/);

    if (!docMatch) continue;
    const docPath = docMatch[1];

    if (canaryMatch) {
      docToCanary[docPath] = canaryMatch[1];
    } else {
      docToCanary[docPath] = docToCanary[docPath] ?? "";
    }
  }

  const docs = Object.keys(docToCanary).sort((a, b) => a.localeCompare(b));
  return { docToCanary, docs };
}

function extractBacklinkFields(sectionMd: string): {
  upRuntime?: string;
  sourceRepo?: string;
  scope?: string;
} {
  const lines = sectionMd.split(/\r?\n/).slice(0, 20);
  const up = lines
    .map((l) => l.match(/^>\s*Up \(runtime\):\s*`([^`]+)`\s*$/))
    .find(Boolean)?.[1];
  const src = lines
    .map((l) => l.match(/^>\s*Source \(repo\):\s*`([^`]+)`\s*$/))
    .find(Boolean)?.[1];
  const scope = lines
    .map((l) => l.match(/^>\s*Scope:\s*(.+)$/))
    .find(Boolean)?.[1]?.trim();

  return { upRuntime: up, sourceRepo: src, scope };
}

function findSkillSystemCanaries(md: string): string[] {
  const re = /<!--\s*SKILLSYSTEM:([A-Z]+):v(\d+)\s*-->/g;
  const out: string[] = [];
  for (;;) {
    const m = re.exec(md);
    if (!m) break;
    out.push(m[0]);
  }
  return out;
}

function renderTextReport(report: Report): string {
  const lines: string[] = [];
  lines.push(`ValidateSkillSystemDocs: ${report.ok ? "OK" : "FAIL"}`);
  lines.push(`Index: ${report.meta.indexPath}`);
  lines.push(`Sections dir: ${report.meta.sectionsDir}`);
  lines.push(`Skills root: ${report.meta.skillsRoot}`);
  lines.push(
    `Section docs: ${report.meta.sectionDocs.length} | Routing entries: ${report.meta.routingTableDocs.length}`
  );
  lines.push(`SKILL.md files checked: ${report.meta.skillDocsChecked}`);

  if (report.errors.length) {
    lines.push("");
    lines.push(`Errors (${report.errors.length}):`);
    for (const e of report.errors) {
      lines.push(`- [${e.code}]${e.file ? ` ${e.file}` : ""}: ${e.message}`);
    }
  }

  if (report.warnings.length) {
    lines.push("");
    lines.push(`Warnings (${report.warnings.length}):`);
    for (const w of report.warnings) {
      lines.push(`- [${w.code}]${w.file ? ` ${w.file}` : ""}: ${w.message}`);
    }
  }

  return lines.join("\n") + "\n";
}

async function validate(opts: {
  indexPath: string;
  sectionsDir: string;
  skillsRoot?: string;
}): Promise<Report> {
  const findings: Finding[] = [];
  const skillsRoot = opts.skillsRoot ?? inferSkillsRootFromIndex(opts.indexPath);

  if (!(await fileExists(opts.indexPath))) {
    throw new Error(`Index file not found: ${opts.indexPath}`);
  }
  if (!(await fileExists(opts.sectionsDir))) {
    throw new Error(`Sections dir not found: ${opts.sectionsDir}`);
  }
  if (!(await fileExists(skillsRoot))) {
    throw new Error(`Skills root not found: ${skillsRoot}`);
  }

  const [indexMd, sectionDocs, skillDocs] = await Promise.all([
    fs.readFile(opts.indexPath, "utf8"),
    listSectionDocs(opts.sectionsDir),
    listSkillDocs(skillsRoot),
  ]);

  const { docToCanary, docs: routingDocs } = parseRoutingTable(indexMd);

  // (1) Router includes entry for each section doc.
  for (const doc of sectionDocs) {
    if (!(doc in docToCanary)) {
      findings.push({
        severity: "error",
        code: "ROUTER_MISSING_ENTRY",
        file: opts.indexPath,
        message: `Routing table missing entry for section doc: ${doc}`,
        details: { sectionDoc: doc },
      });
    }
  }

  // (4) Global prohibition in SKILL.md docs.
  for (const doc of skillDocs) {
    const md = await fs.readFile(doc, "utf8");
    if (/\bSkillSearch\(/.test(md)) {
      findings.push({
        severity: "error",
        code: "SKILL_DOC_INSTRUCTS_SKILLSEARCH",
        file: doc,
        message:
          "SKILL.md contains 'SkillSearch(' (disallowed; use skill_find/skill_use tool patterns)",
      });
    }
  }

  // Routing table should not reference missing files, and should define canaries.
  for (const doc of routingDocs) {
    if (!sectionDocs.includes(doc)) {
      findings.push({
        severity: "error",
        code: "ROUTER_REFERENCES_MISSING_FILE",
        file: opts.indexPath,
        message: `Routing table references missing file: ${doc}`,
        details: { referencedDoc: doc },
      });
    }
    const canary = docToCanary[doc];
    if (!canary) {
      findings.push({
        severity: "error",
        code: "ROUTER_MISSING_CANARY",
        file: opts.indexPath,
        message: `Routing table missing canary for: ${doc}`,
        details: { referencedDoc: doc },
      });
    }
  }

  // (2) Section doc backlink header + canary.
  for (const doc of sectionDocs) {
    const md = await fs.readFile(doc, "utf8");

    const backlink = extractBacklinkFields(md);
    if (!backlink.upRuntime) {
      findings.push({
        severity: "error",
        code: "SECTION_MISSING_UP_BACKLINK",
        file: doc,
        message: "Missing backlink header field: > Up (runtime): `...`",
      });
    } else if (backlink.upRuntime !== opts.indexPath) {
      findings.push({
        severity: "error",
        code: "SECTION_UP_BACKLINK_MISMATCH",
        file: doc,
        message: `Up (runtime) backlink must match index path: ${opts.indexPath}`,
        details: { found: backlink.upRuntime, expected: opts.indexPath },
      });
    }

    if (!backlink.sourceRepo) {
      findings.push({
        severity: "error",
        code: "SECTION_MISSING_SOURCE_BACKLINK",
        file: doc,
        message: "Missing backlink header field: > Source (repo): `...`",
      });
    } else if (!backlink.sourceRepo.includes("/Projects/pai-opencode/.opencode/")) {
      findings.push({
        severity: "warning",
        code: "SECTION_SOURCE_BACKLINK_SUSPICIOUS",
        file: doc,
        message:
          "Source (repo) backlink does not look like a base repo .opencode path",
        details: { found: backlink.sourceRepo },
      });
    }

    if (!backlink.scope) {
      findings.push({
        severity: "error",
        code: "SECTION_MISSING_SCOPE",
        file: doc,
        message: "Missing backlink header field: > Scope: ...",
      });
    }

    const expectedCanary = docToCanary[doc] ?? "";
    if (!expectedCanary) {
      findings.push({
        severity: "error",
        code: "SECTION_EXPECTED_CANARY_UNKNOWN",
        file: doc,
        message:
          "Cannot determine expected canary (missing routing table entry or canary)",
        details: { sectionDoc: doc },
      });
    } else {
      const canaries = findSkillSystemCanaries(md);
      if (!canaries.length) {
        findings.push({
          severity: "error",
          code: "SECTION_MISSING_CANARY",
          file: doc,
          message: `Missing canary comment: ${expectedCanary}`,
          details: { expected: expectedCanary },
        });
      } else {
        if (!canaries.includes(expectedCanary)) {
          findings.push({
            severity: "error",
            code: "SECTION_CANARY_MISMATCH",
            file: doc,
            message: `Canary comment does not match routing table (${expectedCanary})`,
            details: { expected: expectedCanary, found: canaries },
          });
        }
        if (canaries.length !== 1) {
          findings.push({
            severity: "warning",
            code: "SECTION_MULTIPLE_CANARIES",
            file: doc,
            message: `Expected exactly 1 canary comment; found ${canaries.length}`,
            details: { found: canaries },
          });
        }
      }
    }

    // (3) Disallow SkillSearch usage patterns.
    // Allow mentions in prose (e.g., AntiPatterns), but disallow function-like usage.
    if (/\bSkillSearch\(/.test(md)) {
      findings.push({
        severity: "error",
        code: "SECTION_INSTRUCTS_SKILLSEARCH",
        file: doc,
        message:
          "Section doc contains 'SkillSearch(' (disallowed; must use Read/glob patterns)",
      });
    }
  }

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    meta: {
      indexPath: opts.indexPath,
      sectionsDir: opts.sectionsDir,
      skillsRoot,
      sectionDocs,
      skillDocsChecked: skillDocs.length,
      routingTableDocs: routingDocs,
      routingTableCanaries: docToCanary,
    },
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(usageText());
    return;
  }

  const report = await validate({
    indexPath: opts.indexPath,
    sectionsDir: opts.sectionsDir,
    skillsRoot: opts.skillsRoot,
  });

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderTextReport(report));
  }

  process.exitCode = report.ok ? 0 : 1;
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ValidateSkillSystemDocs tool error: ${msg}\n`);
  process.exitCode = 2;
});
