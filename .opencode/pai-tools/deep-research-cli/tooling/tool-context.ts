import { resolveRuntimeRootFromMainScript } from "../../resolveRuntimeRootFromMainScript";

const TOOL_CONTEXT_RUNTIME_ROOT = resolveRuntimeRootFromMainScript(import.meta.url);

export function makeToolContext() {
  return {
    sessionID: "ses_option_c_cli",
    messageID: "msg_option_c_cli",
    agent: "deep-research-cli",
    directory: TOOL_CONTEXT_RUNTIME_ROOT,
    worktree: TOOL_CONTEXT_RUNTIME_ROOT,
    abort: new AbortController().signal,
    metadata(..._args: unknown[]) {},
    ask: async (..._args: unknown[]) => {},
  };
}
