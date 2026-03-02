const COMMAND_REWRITE = /\/nw:([a-z0-9-]+)/gi;

const LITERAL_REWRITES: Array<[string, string]> = [
  ["~/.claude/agents/nw/nw-", "~/.config/opencode/agents/nw-"],
  ["$HOME/.claude/agents/nw/nw-", "$HOME/.config/opencode/agents/nw-"],
  ["~/.claude/skills/nw/", "~/.config/opencode/skills/nwave/nWave/skills/"],
  ["$HOME/.claude/skills/nw/", "$HOME/.config/opencode/skills/nwave/nWave/skills/"],
  ["~/.claude/nWave/skills/", "~/.config/opencode/skills/nwave/nWave/skills/"],
  ["$HOME/.claude/nWave/skills/", "$HOME/.config/opencode/skills/nwave/nWave/skills/"],
  ["~/.claude/nWave/data/", "~/.config/opencode/skills/nwave/nWave/data/"],
  ["$HOME/.claude/nWave/data/", "$HOME/.config/opencode/skills/nwave/nWave/data/"],
  ["~/.claude/nWave/templates/", "~/.config/opencode/skills/nwave/nWave/templates/"],
  ["$HOME/.claude/nWave/templates/", "$HOME/.config/opencode/skills/nwave/nWave/templates/"],
  ["~/.claude/commands/nw/", "~/.config/opencode/commands/nw/"],
  ["$HOME/.claude/commands/nw/", "$HOME/.config/opencode/commands/nw/"],
  ["PYTHONPATH=~/.claude/lib/python", "PYTHONPATH={DES_PYTHONPATH}"],
  ["PYTHONPATH=$HOME/.claude/lib/python", "PYTHONPATH={DES_PYTHONPATH}"],
  ["~/.claude/scripts/", "{NWAVE_REPO_ROOT}/scripts/"],
  ["$HOME/.claude/scripts/", "{NWAVE_REPO_ROOT}/scripts/"],
  ["CLAUDE.md", "AGENTS.md"],
  ["AskUserQuestion", "use the question tool"],
  ["~/.claude/", "~/.config/opencode/"],
  ["$HOME/.claude/", "$HOME/.config/opencode/"],
];

const WORD_REWRITES: Array<[RegExp, string]> = [
  [/\bClaude Code\b/g, "OpenCode"],
  [/\bClaude\b/g, "OpenCode"],
  [/\bAnthropic\b/g, "OpenAI"],
];

const PYTHONPATH_PYTHON_REWRITE = /\bPYTHONPATH=\{DES_PYTHONPATH\}\s+python3?\b/g;
const DES_CLI_MODULE_REWRITE = /\bpython3?\s+-m\s+des\.cli\./g;
const NWAVE_SCRIPTS_PYTHON_REWRITE = /\bpython3?\s+(\{NWAVE_REPO_ROOT\}\/scripts\/)/g;

const NWAVE_MIRROR_DATA_REWRITE = /(^|[^\w/.-])nWave\/data\//g;
const NWAVE_MIRROR_TEMPLATES_REWRITE = /(^|[^\w/.-])nWave\/templates\//g;

const PROJECT_DOCS_REWRITE = /(^|[^\w/.-])docs\//g;
const PROJECT_CONFIG_REWRITE = /(^|[^\w/.-])config\//g;

export function rewriteText(input: string): string {
  let out = input.replace(COMMAND_REWRITE, "/nw/$1");

  for (const [from, to] of LITERAL_REWRITES) {
    out = replaceLiteral(out, from, to);
  }

  // nWave's Python utilities (DES + scripts) should run under the nWave repo's
  // Poetry environment in development mode, while still using PYTHONPATH for
  // src/ layout. Keep this targeted so we don't rewrite user-project Python.
  out = out
    .split("\n")
    .map((line) => {
      let next = line;

      // Upgrade nWave internal Python that already uses our DES PYTHONPATH.
      next = next.replace(
        PYTHONPATH_PYTHON_REWRITE,
        "PYTHONPATH={DES_PYTHONPATH} poetry -C {NWAVE_REPO_ROOT} run python"
      );

      // Upgrade invocations of nWave scripts that we rewrote under NWAVE_REPO_ROOT.
      next = next.replace(
        NWAVE_SCRIPTS_PYTHON_REWRITE,
        "poetry -C {NWAVE_REPO_ROOT} run python $1"
      );

      // Upgrade plain des.cli mentions that don't include PYTHONPATH.
      if (!next.includes("PYTHONPATH=")) {
        next = next.replace(
          DES_CLI_MODULE_REWRITE,
          "PYTHONPATH={DES_PYTHONPATH} poetry -C {NWAVE_REPO_ROOT} run python -m des.cli."
        );
      }

      return next;
    })
    .join("\n");

  out = out
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("Co-Authored-By:"))
    .join("\n");

  for (const [pattern, replacement] of WORD_REWRITES) {
    out = out.replace(pattern, replacement);
  }

  // nWave mirror-internal references should point at installed runtime paths.
  out = out.replace(NWAVE_MIRROR_DATA_REWRITE, "$1skills/nwave/nWave/data/");
  out = out.replace(NWAVE_MIRROR_TEMPLATES_REWRITE, "$1skills/nwave/nWave/templates/");

  // Project-local paths in nWave content should not be integrity-checked.
  // Wrapping with a placeholder prefix makes ScanBrokenRefs ignore them.
  out = out.replace(PROJECT_DOCS_REWRITE, "$1{PROJECT_ROOT}/docs/");
  out = out.replace(PROJECT_CONFIG_REWRITE, "$1{PROJECT_ROOT}/config/");

  return out;
}

function replaceLiteral(input: string, from: string, to: string): string {
  return input.split(from).join(to);
}
