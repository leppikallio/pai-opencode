🤖

# Evidence conventions (read this first)

- **Repo root (source of truth):** `/Users/zuul/Projects/pai-opencode`
- **Runtime install (mirrors for operator):** `/Users/zuul/.config/opencode`
- **Citation format:** `path:lineStart-lineEnd` (or a single line). I include **snippets** for the highest-risk seams below.
- **Note on legacy repo-relative citations:** In the body I sometimes cite `/.opencode/...` shorthand; treat that as:
  - `/Users/zuul/Projects/pai-opencode/.opencode/...`

# Selected proof snippets for high-risk seams

## 1) Run-lock heartbeat refresh failures are swallowed (silent lock-loss risk)

Evidence (repo): `/Users/zuul/Projects/pai-opencode/.opencode/tools/deep_research_cli/run_lock.ts:371-399`

```ts
371: export function startRunLockHeartbeat(args: {
372: 	handle: RunLockHandle;
373: 	interval_ms?: number;
374: 	lease_seconds?: number;
375: }): { stop: () => void } {
376: 	const intervalMsRaw =
377: 		typeof args.interval_ms === "number" && Number.isFinite(args.interval_ms)
378: 			? Math.trunc(args.interval_ms)
379: 			: 30_000;
380: 	const intervalMs = Math.max(250, intervalMsRaw);
381: 
382: 	let stopped = false;
383: 	const timer = setInterval(() => {
384: 		if (stopped) return;
385: 		void refreshRunLock({
386: 			handle: args.handle,
387: 			lease_seconds: args.lease_seconds,
388: 		}).then(() => undefined, () => undefined);
389: 	}, intervalMs);
390: 	// Avoid keeping the process alive just for the heartbeat.
391: 	(timer as unknown as { unref?: () => void }).unref?.();
392: 
393: 	return {
394: 		stop: () => {
395: 			stopped = true;
396: 			clearInterval(timer);
397: 		},
398: 	};
399: }
```

## 2) Stage timeout constants mismatch (schema vs lifecycle)

Evidence (repo):
- `/Users/zuul/Projects/pai-opencode/.opencode/tools/deep_research_cli/lifecycle_lib.ts:319-331`
- `/Users/zuul/Projects/pai-opencode/.opencode/tools/deep_research_cli/schema_v1.ts:15-28`

```ts
// lifecycle_lib.ts
319: export const MANIFEST_STAGE: string[] = ["init", "perspectives", "wave1", "pivot", "wave2", "citations", "summaries", "synthesis", "review", "finalize"];
320: export const STAGE_TIMEOUT_SECONDS_V1: Record<string, number> = {
321:   init: 120,
322:   perspectives: 86400,
323:   wave1: 600,
324:   pivot: 120,
325:   wave2: 600,
326:   citations: 600,
327:   summaries: 600,
328:   synthesis: 600,
329:   review: 300,
330:   finalize: 120,
331: };

// schema_v1.ts
15: export const MANIFEST_STAGE: string[] = ["init", "perspectives", "wave1", "pivot", "wave2", "citations", "summaries", "synthesis", "review", "finalize"];
17: export const STAGE_TIMEOUT_SECONDS_V1: Record<string, number> = {
18:   init: 120,
19:   perspectives: 120,
20:   wave1: 600,
21:   pivot: 120,
22:   wave2: 600,
23:   citations: 600,
24:   summaries: 600,
25:   synthesis: 600,
26:   review: 300,
27:   finalize: 120,
28: };
```

## 3) Gate F exists but is not enforced for finalize (false sense of “rollout safety”)

Evidence (repo):
- Gate F is created: `/Users/zuul/Projects/pai-opencode/.opencode/tools/deep_research_cli/run_init.ts:294-307`
- Finalize only blocks on Gate E; Gate F only appears in the digest input: `/Users/zuul/Projects/pai-opencode/.opencode/tools/deep_research_cli/stage_advance.ts:497-515`

```ts
// run_init.ts
294:       const gates = {
295:         schema_version: "gates.v1",
296:         run_id: runId,
297:         revision: 1,
298:         updated_at: ts,
299:         inputs_digest: "sha256:0",
300:         gates: {
301:           A: { id: "A", name: "Planning completeness", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
302:           B: { id: "B", name: "Wave output contract compliance", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
303:           C: { id: "C", name: "Citation validation integrity", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
304:           D: { id: "D", name: "Summary pack boundedness", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
305:           E: { id: "E", name: "Synthesis quality", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
306:           F: { id: "F", name: "Rollout safety", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
307:         },
308:       };

// stage_advance.ts
497:       if (from === "review" && to === "finalize") {
498:         block ??= blockIfFailed(evalGatePass("E"), "GATE_BLOCKED", "Gate E not pass", { gate: "E" });
499:       }
...
508:         gates_status: {
509:           A: (isPlainObject(gates.A) ? (gates.A as Record<string, unknown>).status : null) ?? null,
510:           B: (isPlainObject(gates.B) ? (gates.B as Record<string, unknown>).status : null) ?? null,
511:           C: (isPlainObject(gates.C) ? (gates.C as Record<string, unknown>).status : null) ?? null,
512:           D: (isPlainObject(gates.D) ? (gates.D as Record<string, unknown>).status : null) ?? null,
513:           E: (isPlainObject(gates.E) ? (gates.E as Record<string, unknown>).status : null) ?? null,
514:           F: (isPlainObject(gates.F) ? (gates.F as Record<string, unknown>).status : null) ?? null,
515:         },
```

## 4) `--json` mode stdout contract is explicit and enforced

Evidence (repo): `/Users/zuul/Projects/pai-opencode/.opencode/pai-tools/deep-research-cli/cli/json-mode.ts:9-22`

```ts
9: export function configureStdoutForJsonMode(enabled: boolean): void {
10:   if (!enabled) return;
11: 
12:   // Hard contract: in --json mode, reserve stdout for exactly one JSON object.
13:   // Any incidental console.log output is redirected to stderr.
14:   console.log = (...args: unknown[]): void => {
15:     console.error(...args);
16:   };
17: }
18: 
19: export function emitJson(payload: unknown): void {
20:   // LLM/operator contract: JSON mode prints exactly one parseable object.
21:   process.stdout.write(`${JSON.stringify(payload)}\n`);
22: }
```

## 5) Telemetry append is O(n) reads-per-event (long-run degradation)

Evidence (repo): `/Users/zuul/Projects/pai-opencode/.opencode/tools/deep_research_cli/telemetry_append.ts:53-83`

```ts
53:       const existingEvents = await readJsonlObjects(telemetryPath).catch((readErr) => {
54:         if (errorCode(readErr) === "ENOENT") return [] as Array<Record<string, unknown>>;
55:         throw readErr;
56:       });
57: 
58:       let maxSeq = 0;
59:       let previousSeq = 0;
60:       for (let i = 0; i < existingEvents.length; i += 1) {
61:         const event = existingEvents[i] as Record<string, unknown>;
62:         const existingSeq = event.seq;
63:         if (!isInteger(existingSeq) || existingSeq <= 0) {
64:           return err("SCHEMA_VALIDATION_FAILED", "existing telemetry seq must be positive integer", {
65:             telemetry_path: telemetryPath,
66:             index: i,
67:             seq: event.seq ?? null,
68:           });
69:         }
70:         if (existingSeq <= previousSeq) {
71:           return err("SCHEMA_VALIDATION_FAILED", "telemetry stream must be strictly increasing by seq", {
72:             telemetry_path: telemetryPath,
73:             index: i,
74:             previous_seq: previousSeq,
75:             seq: existingSeq,
76:           });
77:         }
78:         previousSeq = existingSeq;
79:         if (existingSeq > maxSeq) maxSeq = existingSeq;
80:       }
81: 
82:       const nextSeq = maxSeq + 1;
83:       const event = { ...args.event };
```

## 6) CLI emits runtime-style invocation in next commands (ergonomic mismatch with repo docs)

Evidence (repo): `/Users/zuul/Projects/pai-opencode/.opencode/pai-tools/deep-research-cli/handlers/tick.ts:71-73`

```ts
71: function nextStepCliInvocation(): string {
72:   return `bun "pai-tools/${["deep-research-cli", "ts"].join(".")}"`;
73: }
```

## 7) Run-handle selection contract is explicit (safe and LLM-friendly)

Evidence (repo): `/Users/zuul/Projects/pai-opencode/.opencode/pai-tools/deep-research-cli/utils/run-handle.ts:104-116`

```ts
104: export async function resolveRunHandle(args: RunHandleCliArgs): Promise<RunHandleResolution> {
105:   const manifestArg = normalizeOptional(args.manifest);
106:   const runRootArg = normalizeOptional(args.runRoot);
107:   const runIdArg = normalizeOptional(args.runId);
108:   const runsRootArg = normalizeOptional(args.runsRoot);
109: 
110:   const selectors = [manifestArg, runRootArg, runIdArg].filter((value) => typeof value === "string").length;
111:   if (selectors === 0) {
112:     throw new Error("one of --manifest, --run-root, or --run-id is required");
113:   }
114:   if (selectors > 1) {
115:     throw new Error("provide only one of --manifest, --run-root, or --run-id");
116:   }
```

## 8) Tick dispatch is explicitly stage-based; perspectives is intentionally blocked

Evidence (repo): `/Users/zuul/Projects/pai-opencode/.opencode/pai-tools/deep-research-cli/handlers/tick-internals.ts:48-89`

```ts
48:   const stage = args.stageHint ?? (await summarizeManifest(await readJsonObject(args.manifestPath))).stageCurrent;
49:   if (stage === "perspectives") {
50:     return {
51:       ok: false,
52:       error: {
53:         code: "INVALID_STATE",
54:         message: "stage perspectives requires explicit drafting flow before tick",
55:         details: {
56:           stage,
57:           required_action: "stage-advance --requested-next wave1 after perspectives are finalized",
58:         },
59:       },
60:     } as TickResult;
61:   }
62:   if (stage === "init" || stage === "wave1") {
63:     if (!args.liveDriver) throw new Error("internal: live driver missing");
64:     return await orchestrator_tick_live({
65:       manifest_path: args.manifestPath,
66:       gates_path: args.gatesPath,
67:       reason: args.reason,
68:       drivers: { runAgent: args.liveDriver },
69:       tool_context: makeToolContext(),
70:     });
71:   }
72: 
73:   if (stage === "pivot" || stage === "wave2" || stage === "citations") {
74:     return await orchestrator_tick_post_pivot({
75:       manifest_path: args.manifestPath,
76:       gates_path: args.gatesPath,
77:       reason: args.reason,
78:       driver: args.driver,
79:       tool_context: makeToolContext(),
80:     });
81:   }
82: 
83:   return await orchestrator_tick_post_summaries({
84:     manifest_path: args.manifestPath,
85:     gates_path: args.gatesPath,
86:     reason: args.reason,
87:     driver: args.driver,
88:     tool_context: makeToolContext(),
89:   });
```

## 9) M2/M3 smoke canaries exist (artifact-first end-to-end stage progression)

Evidence (repo):
- M2 wave1→pivot canary: `/Users/zuul/Projects/pai-opencode/.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts:41-124`
- M3 finalize canary: `/Users/zuul/Projects/pai-opencode/.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts:45-167`

```ts
// deep_research_live_wave1_smoke.test.ts
41: describe("deep_research canary (M2 wave1 -> pivot)", () => {
42:   test("self-seeding canary reaches pivot with Gate B pass", async () => {
...
92:           const tick = await orchestrator_tick_live({
93:             manifest_path: manifestPath,
94:             gates_path: gatesPath,
95:             reason: `smoke:M2:tick-${i}`,
96:             drivers,
97:             tool_context: makeToolContext(),
98:           });
99:           expect(tick.ok).toBe(true);
100:           if (!tick.ok) break;
101:           if (tick.to === "pivot") {
102:             reachedPivot = true;
103:             break;
104:           }
105:         }
...
119:         const gatesDoc = JSON.parse(await fs.readFile(path.join(runRoot, "gates.json"), "utf8")) as JsonObject;
120:         expect(gateStatusFromGatesDoc(gatesDoc, "B")).toBe("pass");
121:       });
122:     });
123:   });
124: });

// deep_research_live_finalize_smoke.test.ts
45: describe("deep_research canary (M3 finalize)", () => {
46:   test("self-seeding canary reaches finalize with Gate E pass", async () => {
...
119:           if (stage === "pivot" || stage === "citations") {
120:             const tick = await orchestrator_tick_post_pivot({
121:               manifest_path: manifestPath,
122:               gates_path: gatesPath,
123:               reason: `smoke:M3:tick-${i}`,
124:               tool_context: makeToolContext(),
125:             });
126:             expect(tick.ok).toBe(true);
127:             if (!tick.ok) break;
128:             continue;
129:           }
...
159:         const gateEStatusDoc = JSON.parse(await fs.readFile(path.join(runRoot, "reports", "gate-e-status.json"), "utf8")) as JsonObject;
160:         expect(gateStatusFromReport(gateEStatusDoc)).toBe("pass");
161: 
162:         const gatesDoc = JSON.parse(await fs.readFile(path.join(runRoot, "gates.json"), "utf8")) as JsonObject;
163:         expect(gateStatusFromGatesDoc(gatesDoc, "E")).toBe("pass");
164:       });
165:     });
166:   });
167: });
```

## 10) Citations reproducibility canary exists (online fixtures -> replay identical citations)

Evidence (repo): `/Users/zuul/Projects/pai-opencode/.opencode/tests/smoke/deep_research_citations_repro_canary.test.ts:13-127`

```ts
13: describe("deep_research canary (M4 citations reproducibility)", () => {
...
74:         try {
75:           const firstCitationsPath = path.join(citationsDir, "citations.first.jsonl");
76:           const firstRaw = (await (citations_validate as any).execute(
77:             {
78:               manifest_path: manifestPath,
79:               citations_path: firstCitationsPath,
80:               online_fixtures_path: fixturePath("citations", "phase04", "validate", "online-ladder-fixtures.json"),
81:               reason: "smoke:M4 first-pass fixture capture (fixture-seeded)",
82:             },
83:             makeToolContext(),
84:           )) as string;
...
103:           const replayCitationsPath = path.join(citationsDir, "citations.replay.jsonl");
104:           const replayRaw = (await (citations_validate as any).execute(
105:             {
106:               manifest_path: manifestPath,
107:               citations_path: replayCitationsPath,
108:               online_fixtures_path: capturePath,
109:               reason: "smoke:M4 replay from online fixtures",
110:             },
111:             makeToolContext(),
112:           )) as string;
...
117:           expect(String((replay as any).mode)).toBe("online");
118:           const replayCitations = await fs.readFile(replayCitationsPath, "utf8");
119:           expect(replayCitations).toBe(firstCitations);
120:           expect(fetchCalls).toBe(0);
121:         } finally {
122:           (globalThis as any).fetch = originalFetch;
123:         }
```

## 11) Skill docs are mirrored into runtime; repo docs use repo-path invocation

Evidence:
- Repo skill: `/Users/zuul/Projects/pai-opencode/.opencode/skills/deep-research/SKILL.md:14-16`
- Runtime skill: `/Users/zuul/.config/opencode/skills/deep-research/SKILL.md:14-16`

```md
14: - Skill workflows in `Workflows/` (canonical operator guidance)
15: - CLI: `bun ".opencode/pai-tools/deep-research-cli.ts" <command> [...flags]`
16: - Run artifacts (manifest, gates, stage artifacts) are the source of truth; do not rely on ambient env vars.
```

## 12) Runtime CLI entrypoint exists (the “installed” interface)

Evidence (runtime): `/Users/zuul/.config/opencode/pai-tools/deep-research-cli.ts:1-23`

```ts
1: #!/usr/bin/env bun
2: 
3: import type { Type } from "cmd-ts";
4: import {
5:   runSafely,
6:   subcommands,
7: } from "cmd-ts";
8: 
9: import { createAgentResultCmd } from "./deep-research-cli/cmd/agent-result";
10: import { createCancelCmd } from "./deep-research-cli/cmd/cancel";
11: import { createCaptureFixturesCmd } from "./deep-research-cli/cmd/capture-fixtures";
12: import { createInitCmd } from "./deep-research-cli/cmd/init";
13: import { createInspectCmd } from "./deep-research-cli/cmd/inspect";
14: import { createPauseCmd } from "./deep-research-cli/cmd/pause";
15: import { createPerspectivesDraftCmd } from "./deep-research-cli/cmd/perspectives-draft";
16: import { createResumeCmd } from "./deep-research-cli/cmd/resume";
17: import { createRerunCmd } from "./deep-research-cli/cmd/rerun";
18: import { createRunCmd } from "./deep-research-cli/cmd/run";
19: import { createStageAdvanceCmd } from "./deep-research-cli/cmd/stage-advance";
20: import { createStatusCmd } from "./deep-research-cli/cmd/status";
21: import { createTickCmd } from "./deep-research-cli/cmd/tick";
22: import { createTriageCmd } from "./deep-research-cli/cmd/triage";
23: import {
```

# Executive summary

- **Deep Research Option C is a real artifact-first pipeline now**, not just a spec: `run_init` creates a run root with `manifest.v1`, `gates.v1`, `operator/scope.json`, and canonical stage/gate scaffolding. Evidence: `/.opencode/tools/deep_research_cli/run_init.ts:215-317`.
- **Pipeline stages are explicitly modeled as a state machine** via `manifest.stage.current` (`init → perspectives → wave1 → pivot → wave2 → citations → summaries → synthesis → review → finalize`). Evidence: `/.opencode/tools/deep_research_cli/lifecycle_lib.ts:319-331`.
- **Wave 1 is end-to-end implemented** with a pluggable “runAgent” seam, deterministic ingest, validation, review/retry, and stage advancement to `pivot`. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_live.ts:4-28`, `787-828`, `1116-1163`, `1361-1390`.
- **Post-pivot is implemented end-to-end**: pivot decision → optional Wave 2 plan+task prompts → citations extraction/normalization/validation → Gate C compute → advance to `summaries`. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:1508-1675`, `889-1070`, `1678-1862`.
- **Summaries/synthesis/review/finalize are implemented as an orchestrator**, but (today) the “real research” path is mostly *operator-driven task seams* and/or deterministic generate-mode scaffolding (not LLM-native). Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts:607-803`, `823-963`, `965-1119`; `/.opencode/tools/deep_research_cli/review_factory_run.ts:118-180`; `/.opencode/skills/deep-research/Workflows/SynthesisAndReviewQualityLoop.md:5-20`.
- **CLI ergonomics are already strongly LLM-friendly** (safe run-handle selectors, `--json` mode stdout contract, typed halt artifacts with next commands). Evidence: `/.opencode/pai-tools/deep-research-cli/utils/run-handle.ts:110-162`, `/.opencode/pai-tools/deep-research-cli/cli/json-mode.ts:12-22`, `/.opencode/pai-tools/deep-research-cli/triage/halt-artifacts.ts:160-224`.
- **Biggest “true M2/M3” gap is autonomy, not plumbing**: the tool layer supports a pluggable agent runner (`drivers.runAgent`), but the operator CLI’s `live`/`task` drivers are prompt-out + halt (external agent results ingested via `agent-result`). Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/tick.ts:268-339`, `341-382`.
- **Resumability exists (pause/resume/cancel + locks + optimistic revisions)**, but long-running runs (1h+) will fail today due to tight timeouts, O(n) telemetry bookkeeping, and “heartbeat failure is ignored” behavior. Evidence: `/.opencode/tools/deep_research_cli/watchdog_check.ts:94-113`, `/.opencode/tools/deep_research_cli/lifecycle_lib.ts:320-331`, `/.opencode/tools/deep_research_cli/run_lock.ts:383-389`, `/.opencode/tools/deep_research_cli/telemetry_append.ts:53-80`.
- **One critical completeness gap**: Gate F exists in `gates.v1` but has no evaluator and is not enforced on finalize, so “rollout safety” is currently a stub. Evidence: `/.opencode/tools/deep_research_cli/run_init.ts:300-307`, `/.opencode/tools/deep_research_cli/stage_advance.ts:508-515` (included in digest only), `497-499` (finalize only checks Gate E).

# Current architecture map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Operator / LLM                                                             │
│  - reads skill docs + workflows (deep-research)                             │
│  - drives CLI with --json                                                   │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ deep-research-cli (cmd-ts)                                                  │
│  - commands: init, tick, run, agent-result, stage-advance, pause/resume...  │
│    Evidence: /.opencode/pai-tools/deep-research-cli.ts:114-131              │
│  - safe run-handle selection (exactly one of manifest|run-root|run-id)       │
│    Evidence: /.opencode/pai-tools/deep-research-cli/utils/run-handle.ts:110-│
│              162                                                            │
│  - JSON mode reserves stdout for one object                                 │
│    Evidence: /.opencode/pai-tools/deep-research-cli/cli/json-mode.ts:12-22  │
│  - typed halts emitted to operator/halt/latest.json with next_commands[]     │
│    Evidence: /.opencode/pai-tools/deep-research-cli/triage/halt-artifacts.ts│
│              :160-224                                                       │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │ tool calls (string JSON envelopes)
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ deep_research_cli tool layer (.opencode/tools/deep_research_cli/*)           │
│                                                                             │
│  Lifecycle core:                                                            │
│   - run_init -> manifest.json + gates.json + scope.json + run dirs           │
│     Evidence: run_init.ts:191-317                                            │
│   - manifest_write / gates_write (atomic, optimistic)                        │
│     Evidence: manifest_write.ts:42-63; gates_write.ts:33-37,71               │
│   - stage_advance (preconditions + digest + history)                         │
│     Evidence: stage_advance.ts:501-550                                       │
│   - run_lock (lease + stale detection + heartbeat)                           │
│     Evidence: run_lock.ts:133-143,187-217,371-399                            │
│   - watchdog_check (timeouts, pause semantics)                               │
│     Evidence: watchdog_check.ts:94-113                                       │
│                                                                             │
│  Orchestrators (tick-by-stage):                                              │
│   - orchestrator_tick_live: init/wave1                                       │
│     Evidence: orchestrator_tick_live.ts:787-828,1116-1163,1361-1390          │
│   - orchestrator_tick_post_pivot: pivot/wave2/citations                      │
│     Evidence: orchestrator_tick_post_pivot.ts:1508-1675,1678-1862            │
│   - orchestrator_tick_post_summaries: summaries/synthesis/review             │
│     Evidence: orchestrator_tick_post_summaries.ts:607-803,823-963,965-1119   │
│                                                                             │
│  Gates: A, B, C, D, E (F stubbed)                                            │
│   - A in wave1, B derived from wave review, C from citations, D from summary │
│     pack, E from synthesis+reports+review decision                           │
│     Evidence: orchestrator_tick_live.ts:862-899; post_pivot.ts:1764-1839;    │
│              post_summaries.ts:734-803,1015-1075; stage_advance.ts:497-499   │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Run root (immutable-ish source of truth)                                     │
│  manifest.json, gates.json, pivot.json, wave-1/, wave-2/, citations/,        │
│  summaries/, synthesis/, review/, reports/, logs/                            │
│  + operator/prompts/* + operator/outputs/* + operator/halt/*                 │
└─────────────────────────────────────────────────────────────────────────────┘

Driver modes (operator-facing):
- fixture: fully offline (uses fixtures + deterministic generate paths)
- task: prompt-out + HALT → external agent → agent-result ingest → resume tick
- live: today, still prompt-out/manual by default in CLI (no automatic agent spawn)
  Evidence: tick handler chooses drivers at handlers/tick.ts:268-339.
```

# What’s solid vs what’s missing

## What’s solid

### 1) Artifact-first lifecycle (clear boundaries, low hidden state)

- `run_init` writes *all critical state* into the run root: `manifest.json`, `gates.json`, `operator/scope.json`, plus stage directories. Evidence: `/.opencode/tools/deep_research_cli/run_init.ts:191-195`, `215-317`.
- The manifest includes explicit constraints and the resolved flag surface (`deep_research_cli_flags`) to support “no env vars” operation. Evidence: `/.opencode/tools/deep_research_cli/run_init.ts:238-260`.

### 2) Deterministic stage transitions with preconditions + auditability

- `stage_advance` is the single transition gate: it enforces preconditions (gates/artifacts/limits), writes history, and resets stage timers. Evidence: `/.opencode/tools/deep_research_cli/stage_advance.ts:497-550`.
- Transitions are provenance-stamped with an `inputs_digest` that includes gate statuses and evaluated checks (even when blocked). Evidence: `/.opencode/tools/deep_research_cli/stage_advance.ts:501-528`.

### 3) Pluggable “agent runner seam” + deterministic ingestion

- Wave 1 orchestrator calls `drivers.runAgent(...)`, then ingests the returned markdown via `wave_output_ingest`, validates it, and records retry directives when needed. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_live.ts:1116-1163`, `1185-1194`, `1330-1358`.
- Ingest is staged + rollback-ish (staged temp files, backups). Evidence: `/.opencode/tools/deep_research_cli/wave_output_ingest.ts:343-399`.
- Wave output sidecars record prompt digest + agent_run_id + timestamps + model (when available) for reproducibility. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_live.ts:425-483`.

### 4) Task-driver seams are a first-class operator contract

- CLI tick supports `--driver task`, and produces typed halts with missing perspective prompts/paths and `next_commands`. Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/tick.ts:288-339`, `341-382`, `436-448`.
- Perspectives drafting is explicitly designed as prompt-out + halt, with promotion + plan regeneration after ingest. Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/perspectives-draft.ts:619-663`, `553-570`.

### 5) Citations validation is bounded and security-aware

- Online validation uses an SSRF policy (blocks private/local targets, userinfo, non-http). Evidence: `/.opencode/tools/deep_research_cli/citations_validate_lib.ts:562-609`.
- Online ladder is bounded by redirect/body caps and timeouts; endpoints are explicit. Evidence: `/.opencode/tools/deep_research_cli/citations_validate_lib.ts:150-152`, `408-465`, `519-559`, `656-690`.

## What’s missing / still scaffolded

### Pipeline completeness (implemented vs spec’d) — stage-by-stage

> The goal here is blunt: which stages are “implemented plumbing” vs “implemented scaffolding” vs “only spec’d”.

#### Stage: `init`

- Implemented: `run_init` creates run root + manifest/gates/scope; directories. Evidence: `/.opencode/tools/deep_research_cli/run_init.ts:191-195`, `215-317`.
- CLI surface: `deep-research-cli init`. Evidence: `/.opencode/pai-tools/deep-research-cli.ts:114-131`, `/.opencode/pai-tools/deep-research-cli/cmd/init.ts:31-56`.
- Remaining gaps: none for basic init; but note `stableRunId()` is time+random (not deterministic). Evidence: `/.opencode/tools/deep_research_cli/lifecycle_lib.ts:239-243`.

#### Stage: `perspectives`

- Implemented: Yes, but **task-driver only**.
  - Tool: `perspectives_write` (atomic). Evidence: `/.opencode/tools/deep_research_cli/perspectives_write.ts:14-49`.
  - CLI: `perspectives-draft --driver task` which writes prompt(s), halts, and after ingest promotes `perspectives.json`, regenerates `wave1-plan.json`, and stage-advances to `wave1`. Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/perspectives-draft.ts:71-98`, `553-570`, `619-663`.
- Tick behavior: `tick` refuses to run in `perspectives` stage (forces explicit drafting flow). Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/tick-internals.ts:49-61`.
- Remaining gaps: no autonomous “LLM drafts perspectives inside CLI”; the loop is externalized by design.

#### Stage: `wave1`

- Implemented: Yes.
  - Orchestrator: `orchestrator_tick_live` (init→wave1, wave1 plan, Gate A, runAgent→ingest→validate→review, Gate B, advance to pivot). Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_live.ts:787-899`, `1116-1194`, `1361-1390`.
  - Gate scaffolding: gates A-F created in `run_init`. Evidence: `/.opencode/tools/deep_research_cli/run_init.ts:300-307`.
- Drivers:
  - Tool layer expects a *real* `drivers.runAgent`. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_live.ts:1116-1124`.
  - Operator CLI `--driver task` halts and asks for external agent outputs for wave1 (so the CLI itself does not call an LLM). Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/tick.ts:288-318`.
- Remaining gaps for “true M2”: default `init` writes a trivial single perspective unless `perspectives-draft` is used. Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/init.ts:50-75`.

#### Stage: `pivot`

- Implemented: Yes.
  - If `pivot.json` missing, orchestrator builds it via `pivot_decide` using wave1 outputs+validation reports, then stage-advances to wave2 or citations. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:1508-1619`.
- Remaining gaps: pivot decision logic is deterministic; there is no LLM “gap synthesis” step yet (could be added, bounded).

#### Stage: `wave2`

- Implemented: Yes, but **task-driver/manual semantics dominate**.
  - Derives and writes `wave2-plan.json` + `wave2-perspectives.json`. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:941-1009`.
  - In `driver=task`, writes prompts under `operator/prompts/wave2/` and returns `RUN_AGENT_REQUIRED` if outputs missing. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:1025-1070`.
  - If outputs exist with matching prompt digests, validates them and proceeds. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:1042-1109`.
- Remaining gaps for “true M3”: no autonomous runAgent seam for wave2 in CLI today; wave2 prompt_contract tool_budget is set to zeros in derived wave2 perspectives. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:996-1004`.

#### Stage: `citations`

- Implemented: Yes.
  - Extract URLs → normalize URL map → validate citations → Gate C → persist gates → stage-advance to summaries. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:1678-1862`.
  - Offline mode requires explicit offline fixtures (orchestrator writes deterministic fixtures and passes them). Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:1720-1729`; tool requirement: `/.opencode/tools/deep_research_cli/citations_validate.ts:227-232`.
  - Online mode uses endpoints/fixtures; if endpoints are missing, ladder steps can “endpoint not configured”. Evidence: `/.opencode/tools/deep_research_cli/citations_validate_lib.ts:526`.
- Remaining gaps for “true M3”: endpoint configuration is still ambient (settings + run-config); needs a crisp operator/LLM-visible contract for “online is enabled”. Evidence: `/.opencode/tools/deep_research_cli/lifecycle_lib.ts:144-154`, `195-202`; `/.opencode/pai-tools/deep-research-cli/handlers/init.ts:113-177`.

#### Stage: `summaries`

- Implemented: Yes.
  - In `driver=task`, orchestrator writes per-perspective prompts and requires external summaries; returns `RUN_AGENT_REQUIRED` until outputs+sidecars exist. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts:611-694`.
  - Builds `summary-pack.json` (fixture mode once summaries exist; otherwise generate mode is deterministic scaffolding) and computes Gate D. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts:696-803`; `/.opencode/tools/deep_research_cli/summary_pack_build.ts:49-55`, `170-246`.
- Remaining gaps: generate mode is not LLM-backed; it’s a deterministic heuristic summary. Evidence: `/.opencode/tools/deep_research_cli/summary_pack_build.ts:184-246`.

#### Stage: `synthesis`

- Implemented: Yes.
  - In `driver=task`, requires external synthesis output `synthesis/final-synthesis.md`, enforced via prompt-digest sidecar, else returns `RUN_AGENT_REQUIRED`. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts:823-866`.
  - Otherwise uses `synthesis_write` generate/fixture (generate is deterministic scaffolding). Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts:902-963`; `/.opencode/tools/deep_research_cli/synthesis_write.ts:119-206`.

#### Stage: `review`

- Implemented: Yes, but **review generation is deterministic, not LLM-backed**.
  - `review_factory_run` fixture mode replays a bundle; generate mode performs deterministic checks (headings/citations/unknown cids/numeric claims) and returns PASS/CHANGES_REQUIRED. Evidence: `/.opencode/tools/deep_research_cli/review_factory_run.ts:96-180`.
  - Gate E reports + evaluate + revision control bounds the loop, stage advances to finalize only when review PASS and Gate E pass. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts:1001-1079`, `1088-1119`; `/.opencode/tools/deep_research_cli/revision_control.ts:85-99`; `/.opencode/tools/deep_research_cli/stage_advance.ts:497-499`.

#### Stage: `finalize`

- Implemented: Yes (terminal state).
  - Stage advance sets `status=completed` when transitioning to finalize. Evidence: `/.opencode/tools/deep_research_cli/stage_advance.ts:542-550`.
- Missing: Gate F (“Rollout safety”) is not evaluated nor enforced. Evidence: `/.opencode/tools/deep_research_cli/run_init.ts:305-306` (Gate F exists), `/.opencode/tools/deep_research_cli/stage_advance.ts:508-515` (only included in digest), and no `gate_f_*` tool exists (no matching files under `/.opencode/tools/deep_research_cli/`).

### Remaining gaps for “true M2 / true M3”

#### “True M2” (Wave1 → Pivot with real agents)

- **Autonomy gap:** CLI does not spawn agents; it halts for external agent-result ingestion in `--driver task`. Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/tick.ts:288-339`.
- **Perspective richness gap:** default init-generated perspectives are minimal; serious runs require the perspectives-draft seam. Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/init.ts:50-75`; `/.opencode/skills/deep-research/SKILL.md:18-31`.

#### “True M3” (end-to-end live finalize with online citations + real agents)

- **Wave2 is operator-driven:** wave2 prompt-out + missing-output enforcement exists, but “live wave2” is not autonomous and derived wave2 tool budgets are zero (no tool use). Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:996-1004`, `1025-1070`.
- **Summaries/synthesis task seams exist, but generate modes are scaffolds** (deterministic heuristics, not quality research). Evidence: `/.opencode/tools/deep_research_cli/summary_pack_build.ts:184-246`; `/.opencode/tools/deep_research_cli/synthesis_write.ts:121-206`.
- **Review generate mode is a deterministic lint-like check**, not a deep qualitative reviewer. Evidence: `/.opencode/tools/deep_research_cli/review_factory_run.ts:118-180`.
- **Online citations are bounded but depend on endpoint configuration**, and the ladder timeouts/backoff are currently too strict for real web variability (5s timeout). Evidence: `/.opencode/tools/deep_research_cli/citations_validate_lib.ts:150-152`, `519-559`.

# Determinism & dynamic seams

## Determinism: where you’re already strong

1) **State is explicit and schema-validated**
- Manifest + gates validation is strict and centralized (reject invalid examples early). Evidence: `/.opencode/tools/deep_research_cli/schema_v1.ts:51-133`, `135-180`.

2) **Atomic + optimistic writes for the state spine**
- Atomic JSON writes: `atomicWriteJson` writes to temp then renames. Evidence: `/.opencode/tools/deep_research_cli/lifecycle_lib.ts:245-251`.
- Optimistic locking: manifest/gates writes detect revision mismatches. Evidence: `/.opencode/tools/deep_research_cli/manifest_write.ts:42-46`; `/.opencode/tools/deep_research_cli/gates_write.ts:33-37`.

3) **Deterministic stage gating**
- Transitions are computed via evaluated checks, then applied via `stage_advance`, which stamps a deterministic `inputs_digest` and appends history. Evidence: `/.opencode/tools/deep_research_cli/stage_advance.ts:501-550`.

4) **Prompt digests bound agent output reuse**
- Wave1 output sidecars preserve prompt digests and allow “skip rerun if digest matches”. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_live.ts:425-501`, `1092-1109`.
- Wave2/summaries/synthesis task seams follow the same prompt-digest sidecar pattern. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:1019-1053`; `/.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts:668-686`, `842-866`.

5) **Citations are bounded and reproducible when fixtures are used**
- Offline fixtures are required in offline mode, and the orchestrator generates deterministic offline fixtures. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:1720-1729`; `/.opencode/tools/deep_research_cli/citations_validate.ts:227-232`.

## Non-deterministic seams (and why they matter)

1) **Agent output seam (core variability)**
- Wave1 is explicitly dependent on `drivers.runAgent` results. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_live.ts:1116-1124`.
- Task seams turn this into an operator-visible, resumable workflow (good), but without automation this remains the biggest friction for “push-button research”. Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/tick.ts:288-339`.

2) **Online network seam (citations ladder)**
- Real online citations will vary by reachability, redirects, transient blocks, and endpoint behavior, even with SSRF policy and caps. Evidence: `/.opencode/tools/deep_research_cli/citations_validate_lib.ts:408-465`, `656-690`.

3) **Time + randomness seam**
- `stableRunId()` includes `Math.random()`, and wave ingest uses `Date.now()`/random tags for temp transaction filenames. Evidence: `/.opencode/tools/deep_research_cli/lifecycle_lib.ts:239-243`; `/.opencode/tools/deep_research_cli/wave_output_ingest.ts:260-345`.
- This is mostly benign (path uniqueness), but it complicates deterministic replay if it leaks into semantic state.

4) **Config drift seam**
- Stage timeout constants diverge between `lifecycle_lib.ts` and `schema_v1.ts` (notably `perspectives`: 86400 vs 120). Evidence: `/.opencode/tools/deep_research_cli/lifecycle_lib.ts:320-331` vs `/.opencode/tools/deep_research_cli/schema_v1.ts:17-28`.

## How to bound the seams while staying self-adjusting

### Bounding upgrades (determinism-first)

1) **Canonicalize digests (don’t hash raw JSON.stringify)**
- Today, multiple digests depend on `JSON.stringify(...)` which is key-order sensitive.
  - Stage decision digest: `/.opencode/tools/deep_research_cli/stage_advance.ts:501-519`.
  - Manifest audit patch digest: `/.opencode/tools/deep_research_cli/manifest_write.ts:71-73`.
  - Perspectives audit digest: `/.opencode/tools/deep_research_cli/perspectives_write.ts:44`.
- Recommendation: hash canonical JSON (sorted keys) and explicitly include schema tags; keep digests idempotent.

2) **Make lock-heartbeat loss a typed failure, not a silent best-effort**
- Heartbeat ignores refresh failures (`then(() => undefined, () => undefined)`), so a long-running tick can proceed without an owned lock. Evidence: `/.opencode/tools/deep_research_cli/run_lock.ts:383-389`.
- Recommendation: promote repeated refresh failures to `manifest.status=failed` with a typed halt artifact (bounded retry).

3) **Unify timeout constants to a single source of truth**
- Fix the mismatch between lifecycle and schema constants (or make the lifecycle one authoritative and schema import it). Evidence: `lifecycle_lib.ts:320-331` vs `schema_v1.ts:17-28`.

4) **Enforce tool budgets at validation time**
- Perspectives include `prompt_contract.tool_budget`, but `wave_output_validate` does not enforce it. Evidence: `/.opencode/tools/deep_research_cli/schema_v1.ts:218-220` vs `/.opencode/tools/deep_research_cli/wave_output_validate.ts:62-67`.

### Self-adjusting upgrades (LLM utilization, but bounded)

1) **Perspective drafting is already the right seam — push it harder**
- You already have: prompt-out, normalized draft ingestion, human-review halt, deterministic promotion + plan regeneration. Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/perspectives-draft.ts:619-663`, `553-570`.
- Next step: allow perspectives-draft output to propose *multiple candidate sets* + a score, then pick deterministically under caps.

2) **Wave2 gap selection can be made smarter without losing determinism**
- Today wave2 is driven by `pivot.json` + maxWave2Agents cap. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:941-949`, `929-939`.
- Add an LLM seam that proposes additional gaps, but persist as structured JSON with deterministic sorting and cap enforcement.

3) **Upgrade summaries/synthesis from deterministic heuristics to LLM-backed paths, but keep the same artifacts**
- Current generate mode is intentionally conservative scaffolding. Evidence: `/.opencode/skills/deep-research/Workflows/SynthesisAndReviewQualityLoop.md:5-20`.
- Add a new mode (e.g., `mode=task` already exists at orchestrator level) that uses agents to create summaries and synthesis, while preserving:
  - prompt-out artifacts,
  - prompt digests + sidecars,
  - Gate D/E checks,
  - revision_control caps.

4) **Online citations ladder escalation can be policy-driven**
- Ladder exists: direct fetch → bright data → apify. Evidence: `/.opencode/tools/deep_research_cli/citations_validate_lib.ts:656-690`.
- Add bounded policies (retry budgets, per-domain caps, backoff schedule) persisted in run-config.

# Operator CLI recommendation (exact spec)

## Reality check: do we have a single CLI, and can it run without env vars?

- **Single CLI exists**: `deep-research-cli` is the canonical entrypoint with a cohesive subcommand set. Evidence: `/.opencode/pai-tools/deep-research-cli.ts:114-131`.
- **No env vars by design** for Option C flags; settings.json is the only ambient config source for CLI enablement and defaults. Evidence: `/.opencode/tools/deep_research_cli/lifecycle_lib.ts:144-154`, `212-214`.
- **But:** “no env vars” still means **ambient settings.json dependency**, especially for citations endpoints. Evidence: `/.opencode/tools/deep_research_cli/lifecycle_lib.ts:195-202`; endpoint missing failure mode: `/.opencode/tools/deep_research_cli/citations_validate_lib.ts:526`.

## Exact CLI spec recommendation (v1.1)

### A) Canonical invocation string (reduce LLM/operator footguns)

**Pick ONE and make everything else an alias.** Today, docs use repo-path invocation while the CLI emits runtime-path commands.

- Docs canonical (repo): `bun ".opencode/pai-tools/deep-research-cli.ts" ...` Evidence: `/.opencode/skills/deep-research/SKILL.md:14-17`.
- CLI-emitted next commands (runtime): `bun "pai-tools/deep-research-cli.ts" ...` Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/tick.ts:71-73` and `/.opencode/pai-tools/deep-research-cli/handlers/run.ts:50-52`.

**Recommendation:** make the CLI print the correct invocation string for *its environment* and include it in every JSON response as `contract.cli_invocation`.

### B) JSON-first envelope (same shape for every command)

`--json` is already supported and stdout-safe. Evidence: `/.opencode/pai-tools/deep-research-cli/cli/json-mode.ts:12-22`.

**Recommendation:** unify to one envelope shape:

```json
{
  "schema_version": "dr.cli.v1",
  "ok": true,
  "command": "tick",
  "contract": {
    "run_id": "...",
    "run_root": "...",
    "manifest_path": "...",
    "gates_path": "...",
    "stage_current": "...",
    "status": "...",
    "gate_statuses_summary": {"A": {"status": "pass", "checked_at": "..."}}
  },
  "result": {"from": "wave1", "to": "pivot"},
  "halt": null,
  "error": null
}
```

Key rule: when a halt occurs, include `halt.next_commands[]` **inline** (not only in `operator/halt/latest.json`).

### C) Keep the run-handle selector contract; it’s good

- Exactly one of `--manifest | --run-root | --run-id + --runs-root` is required. Evidence: `/.opencode/pai-tools/deep-research-cli/utils/run-handle.ts:110-132`.

### D) Standardize driver semantics

- `tick --driver fixture|live|task` exists. Evidence: `/.opencode/pai-tools/deep-research-cli/cmd/tick.ts:12-40`.
- `run` supports `--until <stage>` and `--max-ticks`. Evidence: `/.opencode/pai-tools/deep-research-cli/cmd/run.ts:13-24`, `57-73`.

**Recommendation:**
- Treat `task` as the canonical “LLM drives the pipeline” mode.
- Treat `live` as “operator-input/manual” unless/until it is wired to an agent-spawn driver.

### E) Minimal LLM driver loop (operator automation contract)

The pipeline already supports this; formalize it as a workflow.

1) `init "<query>" --mode standard --sensitivity normal --json`
2) Loop:
   - `tick --manifest "<manifest_abs>" --gates "<gates_abs>" --driver task --reason "loop" --json`
   - If `ok:true`, continue.
   - If `ok:false` and `error.code == RUN_AGENT_REQUIRED`:
     - Read `halt.latest_path` (or better: use inline `halt.next_commands[]`),
     - Run agents externally and write outputs to the provided `output_path`s,
     - Ingest via `agent-result --stage <wave1|wave2|summaries|synthesis|perspectives>`,
     - Re-run `tick`.

Evidence that tick builds `next_commands` overrides for wave2/summaries/synthesis: `/.opencode/pai-tools/deep-research-cli/handlers/tick.ts:341-382`.

# Resumability/long-run requirements

## What works today

1) **Pause/resume/cancel are durable and write checkpoints**
- Pause patches `manifest.status=paused` and writes a checkpoint with next-step guidance. Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/pause.ts:55-74`.
- Resume patches `status=running` and resets `stage.started_at` (watchdog semantics). Evidence: `/.opencode/pai-tools/deep-research-cli/handlers/resume.ts:51-56`.

2) **Watchdog respects pause state**
- If `status == paused`, watchdog returns `paused: true` and does not fail. Evidence: `/.opencode/tools/deep_research_cli/watchdog_check.ts:102-113`.

3) **Ticks record progress heartbeats**
- Post-pivot uses `markProgress()` to update `stage.last_progress_at` via manifest_write. Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:1462-1504`.

4) **Run locks prevent concurrent orchestrators**
- Acquire uses an exclusive create (`flag: "wx"`) and stale detection by lease. Evidence: `/.opencode/tools/deep_research_cli/run_lock.ts:207-217`, `133-143`.

## What’s missing for safe pause/resume + crash recovery

1) **Heartbeat failures are ignored (silent lock-loss risk)**
- Evidence: `/.opencode/tools/deep_research_cli/run_lock.ts:383-389`.
- Requirement: treat repeated heartbeat failures as a typed halt + manifest failure (or force reacquire).

2) **Invalid lock files block progress (no stale recovery on parse failure)**
- If the lock file exists but can’t be normalized, `acquireRunLock` returns `LOCK_HELD`. Evidence: `/.opencode/tools/deep_research_cli/run_lock.ts:254-260`.
- Requirement: atomic lock writes + tolerant stale recovery for invalid locks.

3) **Not all artifacts are written atomically**
- Manifest/gates are atomic; many operator prompt/out files are direct `writeFile` (partial-write risk on crash). Evidence: `/.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts:677-679`, `850-852`.
- Requirement: atomic write helpers for operator artifacts and sidecars (same discipline as manifest/gates).

4) **Watchdog timeout produces markdown-only checkpoint**
- Evidence: `/.opencode/tools/deep_research_cli/watchdog_check.ts:136-154`.
- Requirement: also emit a typed JSON halt artifact (`halt.timeout.v1.json`) with next commands.

## What breaks today for long-running runs (1h+)

1) **Stage timeouts are too short (except perspectives)**
- Evidence: `/.opencode/tools/deep_research_cli/lifecycle_lib.ts:320-331` (wave1/wave2/citations/summaries/synthesis=600s; review=300s).

2) **Telemetry bookkeeping is O(n) per append**
- `telemetry_append` reads the entire telemetry stream to compute next seq. Evidence: `/.opencode/tools/deep_research_cli/telemetry_append.ts:53-80`.
- `run_metrics_write` also reads and validates the entire telemetry log. Evidence: `/.opencode/tools/deep_research_cli/run_metrics_write.ts:56-83`.

3) **Online ladder timeouts are fixed at 5 seconds**
- Evidence: `/.opencode/tools/deep_research_cli/citations_validate_lib.ts:150-152`.

### Long-run requirements (concrete)

- Make stage timeouts and lock lease/heartbeat **configurable per run** (persist in run-config; read deterministically).
- Change telemetry seq generation to avoid O(n) scans (e.g., store `telemetry.seq` in manifest or a separate small index file).
- Add backoff + budgets to citations ladder; persist budgets in run-config.
- Add “in-progress tick marker” and crash recovery checks using tick ledger (`logs/ticks.jsonl`). Evidence that tick ledger exists: `/.opencode/tools/deep_research_cli/tick_ledger_append.ts:164-176`.

# Skill recommendations (names + workflows)

## Canonical skill surface

- Keep `deep-research` as the only operator skill, with workflows as the operator interface. Evidence: `/.opencode/skills/deep-research/SKILL.md:6-17`.
- Existing workflows list is good and covers the core operator needs. Evidence: `/.opencode/skills/deep-research/SKILL.md:139-151`.

## Workflow improvements for LLM driving

1) **Add a workflow: `Workflows/LLMDriverLoop.md`**
- Purpose: one canonical “tick/task → halt → agent-result → tick” loop with `--json` and the run-handle selector rules.
- Ground it in: task-driver halt contract and next_commands. Evidence: `/.opencode/pai-tools/deep-research-cli/triage/halt-artifacts.ts:160-224`; tick task next-commands: `/.opencode/pai-tools/deep-research-cli/handlers/tick.ts:341-382`.

2) **Add a workflow: `Workflows/RunM2Canary.md` and `Workflows/RunM3Canary.md`**
- Tie directly to smoke tests as executable evidence, and explain what the canary does *not* prove (no real web/agents by default). Evidence: `/.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts:41-124`; `/.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts:45-167`.

3) **Update existing workflows to include “repo vs runtime invocation” rules**
- The docs currently use repo path; the CLI emits runtime path commands. Evidence: `SKILL.md:14-17` vs `handlers/tick.ts:71-73`.

4) **Make “SynthesisAndReviewQualityLoop” explicit about current scaffolding**
- It already says generate-mode is required baseline and LLM-backed is future. Keep that, but add a prominent warning that generate is *not* quality research. Evidence: `/.opencode/skills/deep-research/Workflows/SynthesisAndReviewQualityLoop.md:5-20`.

# Risk register

> Top 10 footguns with pragmatic mitigations (no OpenCode changes required).

1) **Gate F is a stub (rollout safety unimplemented)**
- Evidence: gate exists at `run_init.ts:305-306`; finalize checks only Gate E at `stage_advance.ts:497-499`.
- Mitigation: implement Gate F evaluator + enforce it before finalize, or remove Gate F to avoid false confidence.

2) **Stage timeout constants diverge between modules**
- Evidence: `lifecycle_lib.ts:322` (perspectives 86400) vs `schema_v1.ts:19` (perspectives 120).
- Mitigation: single source of truth; add a startup self-check asserting equality.

3) **Run lock heartbeat ignores refresh failures**
- Evidence: `run_lock.ts:383-389`.
- Mitigation: fail-fast after N failures with typed halt + manifest failure.

4) **Invalid lock file blocks progress (no stale recovery)**
- Evidence: `acquireRunLock` returns `LOCK_HELD` if `existingLock` is null. `run_lock.ts:254-260`.
- Mitigation: write lock atomically; treat parse-invalid lock as stale and remove.

5) **CLI “no env vars” still relies on ambient settings.json for endpoints**
- Evidence: `lifecycle_lib.ts:144-154`, `195-202`; endpoint missing: `citations_validate_lib.ts:526`.
- Mitigation: add explicit CLI flags for citation endpoints that override settings and are written to run-config.

6) **Repo Tools wrappers still reference old tool namespace (`deep_research`)**
- Evidence: `Tools/deep-research-cli-stage-advance.ts:5`; `Tools/deep-research-cli-fixture-run.ts:15`; but `.opencode/tools` only contains `deep_research_cli.ts` + `deep_research_cli/` (directory listing).
- Mitigation: delete/update wrappers; keep only the repo shim `Tools/deep-research-cli.ts` (which is correct). Evidence: `Tools/deep-research-cli.ts:1-7`.

7) **Digest computation is not canonical (JSON.stringify key order)**
- Evidence: `stage_advance.ts:518`; `manifest_write.ts:72`; `perspectives_write.ts:44`.
- Mitigation: canonicalize JSON before hashing.

8) **Wave output validation does not enforce tool budgets**
- Evidence: tool_budget required in perspectives schema (`schema_v1.ts:218-220`) but unused in validator (`wave_output_validate.ts:62-67`).
- Mitigation: require a machine-readable tool-usage sidecar and enforce budgets in validators/gates.

9) **Generate-mode summaries/synthesis/review can “pass” gates while being low-value**
- Evidence: generate heuristics: `summary_pack_build.ts:184-246`; `synthesis_write.ts:121-206`; `review_factory_run.ts:118-180`.
- Mitigation: in “real research” rubric, require task/LLM-backed artifacts (or a separate “scaffold mode” label) so users don’t mistake scaffolds for research.

10) **Telemetry append is O(n) per event; long runs degrade**
- Evidence: reads entire telemetry to compute seq: `telemetry_append.ts:53-80`.
- Mitigation: maintain a compact `telemetry-index.json` or store last seq in manifest metrics.

# Readiness rubric

## Pass/fail checklist for “ready for real research runs”

### A) Tool wiring + CLI contracts

- [ ] `deep-research-cli` is reachable in both repo and runtime contexts.
  - Evidence: entrypoint exists at `/.opencode/pai-tools/deep-research-cli.ts` and runtime `~/.../pai-tools/deep-research-cli.ts`.
- [ ] `--json` mode returns exactly one parseable JSON object on stdout.
  - Evidence: `cli/json-mode.ts:12-22`.
- [ ] Run-handle selectors are stable and documented: exactly one of `--manifest|--run-root|--run-id`.
  - Evidence: `run-handle.ts:110-116`.

### B) Stage progression (operator-driven task seams)

- [ ] Perspectives drafting seam works end-to-end: prompt-out → agent-result → promote → stage=wave1.
  - Evidence: `handlers/perspectives-draft.ts:619-663`, `553-570`.
- [ ] Wave1 task seam works: tick emits missing list + paths, then resumes after agent-result ingest.
  - Evidence: `handlers/tick.ts:288-339`.
- [ ] Wave2 task seam works similarly (RUN_AGENT_REQUIRED + missing_perspectives), and resumes after outputs exist.
  - Evidence: `orchestrator_tick_post_pivot.ts:1055-1069`.
- [ ] Summaries + synthesis task seams work similarly.
  - Evidence: summaries: `orchestrator_tick_post_summaries.ts:688-694`; synthesis: `823-866`.

### C) Citations (offline + online reproducibility)

- [ ] Offline mode requires offline fixtures and produces citations.jsonl without network.
  - Evidence: `citations_validate.ts:227-232`.
- [ ] Online mode has a declared and validated endpoint config (or deterministic online fixtures), and ladder timeouts are acceptable.
  - Evidence: endpoint missing failure: `citations_validate_lib.ts:526`; timeouts: `150-152`.

### D) Resumability

- [ ] Pause/resume writes checkpoints and restores watchdog semantics.
  - Evidence: pause `handlers/pause.ts:55-74`; resume `handlers/resume.ts:51-56`; watchdog pause handling `watchdog_check.ts:102-113`.
- [ ] Run locks are robust under crash/restart (stale locks can be cleared; heartbeat failures are surfaced).
  - Current FAIL: heartbeat failures are ignored. Evidence: `run_lock.ts:383-389`.

### E) “Real research” quality gate

- [ ] Runs intended as real research MUST NOT rely on generate-mode summaries/synthesis/review.
  - Evidence that generate is scaffolding: `SynthesisAndReviewQualityLoop.md:5-20`; generate heuristics: `summary_pack_build.ts:184-246`, `synthesis_write.ts:121-206`, `review_factory_run.ts:118-180`.
- [ ] Gate F exists and is enforced (or removed).
  - Current FAIL: Gate F not enforced. Evidence: `stage_advance.ts:497-499`, `508-515`.

# Concrete next steps

## P0 (blocks “real runs” or makes iteration painful)

1) **Fix Gate F reality**: either implement and enforce it, or remove it from gates.v1 and docs.
2) **Unify timeout constants** (`lifecycle_lib` vs `schema_v1`) and make timeouts configurable per run.
3) **Make lock heartbeat loss visible and fatal** (typed halt + manifest failure).
4) **Standardize JSON envelopes + include `halt.next_commands[]` inline** to remove the “open halt file” step.
5) **Eliminate stale repo Tools wrappers** referencing `deep_research` (or clearly mark them deprecated).

## P1 (makes M2/M3 truly autonomous and higher quality)

6) **Add an optional Task-spawn driver** (CLI “live” mode) that actually runs agents and then calls `agent-result` itself, preserving the same artifacts and digests.
7) **Introduce LLM-backed summaries/synthesis/review modes** behind the existing task seams, keeping revision_control caps.
8) **Enforce tool budgets** (tool usage sidecar + validator/gate checks).

## P2 (long-run hardening)

9) **Fix telemetry O(n) append** by storing last seq separately.
10) **Citations ladder backoff + budgets** persisted in run-config; raise or tune default timeouts safely.

🗣️ Marvin: I mapped the deep-research pipeline end-to-end, highlighted M2/M3 gaps, and specified pragmatic CLI, determinism, and resumability upgrades.

(End of file - total 548 lines)
