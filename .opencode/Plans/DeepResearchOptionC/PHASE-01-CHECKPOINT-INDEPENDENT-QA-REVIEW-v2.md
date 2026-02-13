# Phase 01 Checkpoint — QA Review (Closure Behaviors)

Date: 2026-02-13

## Environment
- Workdir: `/Users/zuul/Projects/pai-opencode-graphviz/.opencode`
- Tool under test: `./tools/deep_research.ts`

## What was verified
1) `manifest_write` rejects immutable-field patches (e.g. `revision`).
2) `manifest_write` revision bump is derived from the persisted revision.
3) Validation failures include an actionable `error.details.path`.
4) `manifest_write` and `gates_write` append audit events to `logs/audit.jsonl`.

## Command executed (repro)
```bash
PAI_DR_OPTION_C_ENABLED=1 bun -e 'import { run_init, manifest_write, gates_write } from "./tools/deep_research.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const base = "/tmp/pai-dr-phase01-close";
const ctx = {
  sessionID: "ses_phase01_close",
  messageID: "msg_phase01_close",
  agent: "build",
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: new AbortController().signal,
  metadata() {},
  ask: async () => {},
};

const initRaw = await run_init.execute({ query: "Phase 01 close QA", mode: "standard", sensitivity: "normal", root_override: base }, ctx);
console.log("== run_init ==\\n" + initRaw);
const init = JSON.parse(initRaw);
if (!init.ok) process.exit(1);

const manifestPath = init.manifest_path;
const gatesPath = init.gates_path;

console.log("== manifest_write ok ==\\n" + await manifest_write.execute({ manifest_path: manifestPath, expected_revision: 1, reason: "qa: set running", patch: { status: "running" } }, ctx));
console.log("== manifest_write immutable ==\\n" + await manifest_write.execute({ manifest_path: manifestPath, reason: "qa: try set revision", patch: { revision: 999 } }, ctx));
console.log("== manifest_write bad stage ==\\n" + await manifest_write.execute({ manifest_path: manifestPath, reason: "qa: bad stage", patch: { stage: { current: "WAVE_ONE" } } }, ctx));

const ts = new Date().toISOString();
console.log("== gates_write ok ==\\n" + await gates_write.execute({
  gates_path: gatesPath,
  expected_revision: 1,
  inputs_digest: "sha256:close",
  reason: "qa: set gate A pass",
  update: {
    A: { status: "pass", checked_at: ts, metrics: { schemas_defined: 1 }, artifacts: ["PHASE-01"], warnings: [], notes: "ok" },
  },
}, ctx));

const auditPath = path.join(path.dirname(manifestPath), "logs", "audit.jsonl");
const audit = fs.readFileSync(auditPath, "utf8").trim().split("\\n");
console.log("== audit lines ==\\n" + audit.length);
console.log(audit.slice(-2).join("\\n"));
'
```

## Output excerpts (actual)

### run_init
```json
{
  "ok": true,
  "run_id": "dr_20260213204735_x0l5of",
  "root": "/tmp/pai-dr-phase01-close/dr_20260213204735_x0l5of",
  "created": true,
  "manifest_path": "/tmp/pai-dr-phase01-close/dr_20260213204735_x0l5of/manifest.json",
  "gates_path": "/tmp/pai-dr-phase01-close/dr_20260213204735_x0l5of/gates.json"
}
```

### manifest_write ok (audit written)
```json
{
  "ok": true,
  "new_revision": 2,
  "updated_at": "2026-02-13T20:47:35.542Z",
  "audit_written": true,
  "audit_path": "/tmp/pai-dr-phase01-close/dr_20260213204735_x0l5of/logs/audit.jsonl"
}
```

### manifest_write immutable rejection
```json
{
  "ok": false,
  "error": {
    "code": "IMMUTABLE_FIELD",
    "message": "patch attempts to modify immutable manifest fields",
    "details": {
      "paths": [
        "$.revision"
      ]
    }
  }
}
```

### manifest_write actionable validation error (details.path)
```json
{
  "ok": false,
  "error": {
    "code": "SCHEMA_VALIDATION_FAILED",
    "message": "manifest.stage.current invalid",
    "details": {
      "path": "$.stage.current"
    }
  }
}
```

### gates_write ok (audit written)
```json
{
  "ok": true,
  "new_revision": 2,
  "updated_at": "2026-02-13T20:47:35.545Z",
  "audit_written": true,
  "audit_path": "/tmp/pai-dr-phase01-close/dr_20260213204735_x0l5of/logs/audit.jsonl"
}
```

## audit.jsonl tail (actual)
```jsonl
{"ts":"2026-02-13T20:47:35.542Z","kind":"manifest_write","run_id":"dr_20260213204735_x0l5of","prev_revision":1,"new_revision":2,"reason":"qa: set running","patch_digest":"sha256:409443a6ee5aa296dccd6c0d193e214568daa0053b66155fba8adca995b7823d"}
{"ts":"2026-02-13T20:47:35.546Z","kind":"gates_write","run_id":"dr_20260213204735_x0l5of","prev_revision":1,"new_revision":2,"reason":"qa: set gate A pass","inputs_digest":"sha256:close"}
```

## Verdict
PASS — Phase 01 closure behaviors verified with runnable command and on-disk audit log evidence.
