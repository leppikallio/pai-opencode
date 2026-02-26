import type { Plugin } from "@opencode-ai/plugin";

import { createHistoryCapture } from "./handlers/history-capture";

type HistoryCapture = ReturnType<typeof createHistoryCapture>;
type HistoryCaptureClient = NonNullable<Parameters<typeof createHistoryCapture>[0]>["client"];
type ToolBeforeInput = Parameters<HistoryCapture["handleToolBefore"]>[0];
type ToolBeforeArgs = Parameters<HistoryCapture["handleToolBefore"]>[1];
type ToolAfterInput = Parameters<HistoryCapture["handleToolAfter"]>[0];
type ToolAfterOutput = Parameters<HistoryCapture["handleToolAfter"]>[1];

const PaiHistoryPlugin: Plugin = async (ctx) => {
  const serverUrl = process.env.OPENCODE_SERVER_URL || "http://localhost:4096";
  const directory = process.env.OPENCODE_DIRECTORY;

  const capture = createHistoryCapture({
    serverUrl,
    directory,
    // Prefer in-process client (no network) when available.
    // NOTE: createHistoryCapture only uses a small subset of the client surface.
    client: ctx.client as unknown as HistoryCaptureClient,
  });

  return {
    event: capture.handleEvent,
    "tool.execute.before": async (input, args) => {
      await capture.handleToolBefore(
        input as unknown as ToolBeforeInput,
        ((args as unknown) || {}) as ToolBeforeArgs,
      );
    },
    "tool.execute.after": async (input, output) => {
      await capture.handleToolAfter(
        input as unknown as ToolAfterInput,
        ((output as unknown) || {}) as ToolAfterOutput,
      );
    },
  };
};

export default PaiHistoryPlugin;
