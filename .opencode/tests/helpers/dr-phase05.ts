import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init, summary_pack_build } from "../../tools/deep_research.ts";
import { fixturePath, makeToolContext, parseToolJson } from "./dr-harness";

export const phase05FixturePath = (...parts: string[]): string => fixturePath("summaries", "phase05", ...parts);

export async function initPhase05Run(base: string, runId: string): Promise<{ root: string; manifestPath: string; gatesPath: string }> {
  const initRaw = (await run_init.execute(
    {
      query: "Phase 05 entity fixtures",
      mode: "standard",
      sensitivity: "no_web",
      run_id: runId,
      root_override: base,
    },
    makeToolContext(),
  )) as string;

  const init = parseToolJson(initRaw);
  if (!init.ok) throw new Error(`run_init failed: ${initRaw}`);

  return {
    root: String(init.root),
    manifestPath: String(init.manifest_path),
    gatesPath: String(init.gates_path),
  };
}

export async function seedPhase05Artifacts(args: { runId: string; root: string }): Promise<{ perspectivesPath: string; citationsPath: string }> {
  const perspectivesTemplateRaw = await fs.readFile(phase05FixturePath("perspectives.json"), "utf8");
  const perspectives = JSON.parse(perspectivesTemplateRaw);
  perspectives.run_id = args.runId;

  const perspectivesPath = path.join(args.root, "perspectives.json");
  await fs.writeFile(perspectivesPath, `${JSON.stringify(perspectives, null, 2)}\n`, "utf8");

  const citationsPath = path.join(args.root, "citations", "citations.jsonl");
  await fs.copyFile(phase05FixturePath("citations.jsonl"), citationsPath);

  return { perspectivesPath, citationsPath };
}

export async function buildPhase05SummaryPack(args: {
  manifestPath: string;
  perspectivesPath: string;
  citationsPath: string;
  summariesFixtureDir?: string;
}): Promise<{ raw: string; json: Record<string, unknown> }> {
  const raw = (await summary_pack_build.execute(
    {
      manifest_path: args.manifestPath,
      perspectives_path: args.perspectivesPath,
      citations_path: args.citationsPath,
      mode: "fixture",
      fixture_summaries_dir: args.summariesFixtureDir ?? phase05FixturePath("summaries-pass"),
      reason: "test: summary-pack",
    },
    makeToolContext(),
  )) as string;

  const json = parseToolJson(raw);
  return { raw, json };
}
