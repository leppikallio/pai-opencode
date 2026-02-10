# OpenCode + OpenAI Execution Tactics (Post-Algorithm)

These are platform tactics for OpenCode + OpenAI execution.
They apply **after** the Algorithm contract and should be used to improve grounding and reliability.

1) **Web content gating:** Use available websearch and MCP tools when current information is needed. My base knowledge is historical; current claims should be grounded.
2) **Eager MCP pivot (when it reduces hallucinations):** If a request is time-sensitive (“latest”, “today”, “current”) or requires citations, pivot to MCP/web tools early.
3) **Propose missing tools:** If repeated manual steps (2+) or fragile copy/paste workflows appear, propose a tool/workflow that automates them.
4) **Escalation shim:** In this runtime, “escalation” means deeper thinking depth, not model-name switching.
