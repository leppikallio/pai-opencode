import * as path from "node:path";

import { fixture_bundle_capture } from "../../../tools/deep_research.ts";
import { resolveDeepResearchFlagsV1 } from "../../../tools/deep_research/lifecycle_lib";
import { emitJson } from "../cli/json-mode";
import { readJsonObject } from "../lib/io-json";
import { requireAbsolutePath } from "../lib/paths";
import {
  printContract,
  summarizeManifest,
} from "../lib/run-handle";
import { nowIso } from "../lib/time";
import {
  callTool,
  type ToolWithExecute,
} from "../runtime/tool-envelope";

export type CaptureFixturesCliArgs = {
  manifest: string;
  outputDir?: string;
  bundleId?: string;
  reason: string;
  json?: boolean;
};

function ensureOptionCEnabledForCli(): void {
  const flags = resolveDeepResearchFlagsV1();
  if (!flags.optionCEnabled) {
    throw new Error("Deep research Option C is disabled in current configuration");
  }
}

function timestampTokenFromIso(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\..*Z$/, "Z").replace("T", "T");
}

export async function runCaptureFixtures(args: CaptureFixturesCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const manifest = await readJsonObject(args.manifest);
  const summary = await summarizeManifest(manifest);
  const runId = summary.runId;
  const createdAt = nowIso();

  const outputDir = args.outputDir
    ? requireAbsolutePath(args.outputDir, "--output-dir")
    : path.join(summary.runRoot, "fixtures");
  const defaultBundleId = `${runId}_bundle_${timestampTokenFromIso(createdAt)}`;
  const bundleId = String(args.bundleId ?? defaultBundleId).trim();
  if (!bundleId) throw new Error("--bundle-id must be non-empty");

  const capture = await callTool("fixture_bundle_capture", fixture_bundle_capture as unknown as ToolWithExecute, {
    manifest_path: args.manifest,
    output_dir: outputDir,
    bundle_id: bundleId,
    reason: args.reason,
  });

  if (args.json) {
    emitJson({
      ok: true,
      command: "capture-fixtures",
      run_id: runId,
      run_root: summary.runRoot,
      manifest_path: args.manifest,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      bundle_id: String(capture.bundle_id ?? bundleId),
      bundle_root: String(capture.bundle_root ?? ""),
      replay_command: "deep_research_fixture_replay --bundle_root <bundle_root>",
    });
    return;
  }

  printContract({
    runId,
    runRoot: summary.runRoot,
    manifestPath: args.manifest,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("capture_fixtures.ok: true");
  console.log(`capture_fixtures.bundle_id: ${String(capture.bundle_id ?? bundleId)}`);
  console.log(`capture_fixtures.bundle_root: ${String(capture.bundle_root ?? "")}`);
  console.log("capture_fixtures.replay: deep_research_fixture_replay --bundle_root <bundle_root>");
}
