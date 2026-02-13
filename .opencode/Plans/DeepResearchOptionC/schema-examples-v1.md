# schema-examples-v1 (P00-A05)

## Purpose
Provides valid/invalid examples for schema validation and harness testing.

---

## manifest.v1

### Valid (minimal)
```json
{
  "schema_version": "manifest.v1",
  "run_id": "dr_20260213_001",
  "created_at": "2026-02-13T12:00:00Z",
  "updated_at": "2026-02-13T12:00:00Z",
  "revision": 1,
  "query": { "text": "Research X", "constraints": {}, "sensitivity": "normal" },
  "mode": "standard",
  "status": "created",
  "stage": { "current": "init", "started_at": "2026-02-13T12:00:00Z", "history": [] },
  "limits": {
    "max_wave1_agents": 6,
    "max_wave2_agents": 6,
    "max_summary_kb": 5,
    "max_total_summary_kb": 60,
    "max_review_iterations": 4
  },
  "agents": { "policy": "existing-runtime-only" },
  "artifacts": {
    "root": "/abs/path/scratch/research-runs/dr_20260213_001",
    "paths": {
      "wave1_dir": "wave-1",
      "wave2_dir": "wave-2",
      "citations_dir": "citations",
      "summaries_dir": "summaries",
      "synthesis_dir": "synthesis",
      "logs_dir": "logs",
      "gates_file": "gates.json",
      "perspectives_file": "perspectives.json",
      "citations_file": "citations/citations.jsonl",
      "summary_pack_file": "summaries/summary-pack.json",
      "pivot_file": "pivot.json"
    }
  },
  "metrics": {},
  "failures": []
}
```

### Invalid example (bad status)
```json
{
  "schema_version": "manifest.v1",
  "run_id": "dr_x",
  "created_at": "2026-02-13T12:00:00Z",
  "updated_at": "2026-02-13T12:00:00Z",
  "revision": 1,
  "query": { "text": "X" },
  "mode": "standard",
  "status": "DONE",
  "stage": { "current": "init", "started_at": "2026-02-13T12:00:00Z", "history": [] },
  "limits": { "max_wave1_agents": 6, "max_wave2_agents": 6, "max_summary_kb": 5, "max_total_summary_kb": 60, "max_review_iterations": 4 },
  "agents": {},
  "artifacts": { "root": "/x", "paths": {} },
  "metrics": {},
  "failures": []
}
```

### Invalid example (bad stage id)
```json
{
  "schema_version": "manifest.v1",
  "run_id": "dr_x",
  "created_at": "2026-02-13T12:00:00Z",
  "updated_at": "2026-02-13T12:00:00Z",
  "revision": 1,
  "query": { "text": "X" },
  "mode": "standard",
  "status": "created",
  "stage": { "current": "WAVE_ONE", "started_at": "2026-02-13T12:00:00Z", "history": [] },
  "limits": { "max_wave1_agents": 6, "max_wave2_agents": 6, "max_summary_kb": 5, "max_total_summary_kb": 60, "max_review_iterations": 4 },
  "agents": {},
  "artifacts": { "root": "/x", "paths": {} },
  "metrics": {},
  "failures": []
}
```

---

## gates.v1

### Valid (minimal)
```json
{
  "schema_version": "gates.v1",
  "run_id": "dr_20260213_001",
  "revision": 1,
  "updated_at": "2026-02-13T12:30:00Z",
  "inputs_digest": "sha256:...",
  "gates": {
    "A": {
      "id": "A",
      "name": "Planning completeness",
      "class": "hard",
      "status": "pass",
      "checked_at": "2026-02-13T12:30:00Z",
      "metrics": { "schemas_defined": 5 },
      "artifacts": ["spec-manifest-schema-v1.md"],
      "warnings": [],
      "notes": "ok"
    },
    "B": { "id": "B", "name": "Wave output contract compliance", "class": "hard", "status": "not_run", "checked_at": null, "metrics": {}, "artifacts": [], "warnings": [], "notes": "" },
    "C": { "id": "C", "name": "Citation validation integrity", "class": "hard", "status": "not_run", "checked_at": null, "metrics": {}, "artifacts": [], "warnings": [], "notes": "" },
    "D": { "id": "D", "name": "Summary pack boundedness", "class": "hard", "status": "not_run", "checked_at": null, "metrics": {}, "artifacts": [], "warnings": [], "notes": "" },
    "E": { "id": "E", "name": "Synthesis quality", "class": "hard", "status": "not_run", "checked_at": null, "metrics": {}, "artifacts": [], "warnings": [], "notes": "" },
    "F": { "id": "F", "name": "Rollout safety", "class": "hard", "status": "not_run", "checked_at": null, "metrics": {}, "artifacts": [], "warnings": [], "notes": "" }
  }
}
```

### Invalid (hard gate with warn)
```json
{
  "schema_version": "gates.v1",
  "run_id": "dr_x",
  "revision": 1,
  "updated_at": "2026-02-13T12:30:00Z",
  "inputs_digest": "sha256:...",
  "gates": {
    "A": { "id": "A", "name": "Planning", "class": "hard", "status": "warn", "checked_at": "2026-02-13T12:30:00Z", "metrics": {}, "artifacts": [], "warnings": [], "notes": "" }
  }
}
```

### Invalid (missing inputs_digest)
```json
{
  "schema_version": "gates.v1",
  "run_id": "dr_x",
  "revision": 1,
  "updated_at": "2026-02-13T12:30:00Z",
  "gates": {
    "A": { "id": "A", "name": "Planning", "class": "hard", "status": "pass", "checked_at": "2026-02-13T12:30:00Z", "metrics": {}, "artifacts": [], "warnings": [], "notes": "" }
  }
}
```

---

## citation.v1

### Valid (minimal)
```json
{"schema_version":"citation.v1","normalized_url":"https://example.com/doc","cid":"cid_<sha256>","url":"https://example.com/doc","url_original":"https://example.com/doc?utm_source=x","status":"valid","checked_at":"2026-02-13T12:35:00Z","http_status":200,"found_by":[{"wave":1,"perspective_id":"p1","agent_type":"ClaudeResearcher","artifact_path":"wave-1/p1.md"}],"notes":"ok"}
```

### Invalid (missing provenance)
```json
{"schema_version":"citation.v1","normalized_url":"https://x","cid":"cid_1","url":"https://x","url_original":"https://x","status":"valid","checked_at":"2026-02-13T12:35:00Z","found_by":[],"notes":""}
```

### Invalid (missing normalized_url)
```json
{"schema_version":"citation.v1","cid":"cid_1","url":"https://x","url_original":"https://x","status":"valid","checked_at":"2026-02-13T12:35:00Z","found_by":[{"wave":1,"perspective_id":"p1","agent_type":"ClaudeResearcher","artifact_path":"wave-1/p1.md"}],"notes":""}
```

---

## Evidence
This file contains:
- valid minimal examples for manifest/gates/citation
- multiple invalid examples for manifest/gates/citation
