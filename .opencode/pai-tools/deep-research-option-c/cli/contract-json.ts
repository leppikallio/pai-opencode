import { emitJson } from "./json-mode";
import {
  contractJson,
  type ManifestSummary,
} from "../lib/run-handle";

export function emitContractCommandJson(args: {
  command: "status" | "inspect" | "triage";
  summary: ManifestSummary;
  manifestPath: string;
  gatesPath?: string;
  gateStatusesSummary: Record<string, { status: string; checked_at: string | null }>;
  extra?: Record<string, unknown>;
}): void {
  emitJson({
    ok: true,
    command: args.command,
    ...contractJson({
      summary: args.summary,
      manifestPath: args.manifestPath,
      gatesPath: args.gatesPath,
      gateStatusesSummary: args.gateStatusesSummary,
    }),
    ...(args.extra ?? {}),
  });
}
