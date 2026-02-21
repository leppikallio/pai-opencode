# Deep Research CLI JSON contract (current baseline)

Captured on 2026-02-21 from `/tmp/pai-dr-phase1a` with:

- `PAI_DR_CLI_ENABLED=1`
- `PAI_DR_CLI_NO_WEB=1`

Absolute local paths are redacted to placeholders while preserving key shape and nullability.

## `init --json`

```json
{
  "ok": true,
  "command": "init",
  "run_id": "<RUN_ID>",
  "run_root": "<RUN_ROOT>",
  "manifest_path": "<RUN_ROOT>/manifest.json",
  "gates_path": "<RUN_ROOT>/gates.json",
  "stage_current": "wave1",
  "status": "running",
  "run_config_path": "<RUN_ROOT>/run-config.json",
  "perspectives_path": "<RUN_ROOT>/perspectives.json",
  "wave1_plan_path": "<RUN_ROOT>/wave-1/wave1-plan.json",
  "notes": []
}
```

## `tick --json` (`ok=true`)

```json
{
  "ok": true,
  "command": "tick",
  "driver": "task",
  "tick": {
    "ok": true,
    "from": "wave1",
    "to": "pivot",
    "wave_outputs_count": 1
  },
  "run_id": "<RUN_ID>",
  "run_root": "<RUN_ROOT>",
  "manifest_path": "<RUN_ROOT>/manifest.json",
  "gates_path": "<RUN_ROOT>/gates.json",
  "stage_current": "pivot",
  "status": "running",
  "halt": null
}
```

## `tick --json` (`ok=false` with halt)

```json
{
  "ok": false,
  "command": "tick",
  "driver": "task",
  "tick": {
    "ok": false,
    "error": {
      "code": "RUN_AGENT_REQUIRED",
      "message": "Wave 1 requires external agent results via agent-result",
      "details": {
        "stage": "wave1",
        "missing_count": 1,
        "missing_perspectives": [
          {
            "perspective_id": "p1",
            "prompt_path": "<RUN_ROOT>/operator/prompts/wave1/p1.md",
            "output_path": "<RUN_ROOT>/wave-1/p1.md",
            "meta_path": "<RUN_ROOT>/wave-1/p1.meta.json",
            "prompt_digest": "sha256:83af5025edead82a04a69152a035eff52e7944fbff89cfe053ae9a26c0c144de"
          }
        ]
      }
    }
  },
  "run_id": "<RUN_ID>",
  "run_root": "<RUN_ROOT>",
  "manifest_path": "<RUN_ROOT>/manifest.json",
  "gates_path": "<RUN_ROOT>/gates.json",
  "stage_current": "wave1",
  "status": "running",
  "halt": {
    "tick_index": 1,
    "tick_path": "<RUN_ROOT>/operator/halt/tick-0001.json",
    "latest_path": "<RUN_ROOT>/operator/halt/latest.json",
    "next_commands": [
      "bun \"pai-tools/deep-research-cli.ts\" inspect --manifest \"<RUN_ROOT>/manifest.json\"",
      "bun \"pai-tools/deep-research-cli.ts\" agent-result --manifest \"<RUN_ROOT>/manifest.json\" --stage wave1 --perspective \"p1\" --input \"<RUN_ROOT>/operator/outputs/wave1/p1.md\" --agent-run-id \"<AGENT_RUN_ID>\" --reason \"operator: task driver ingest wave1/p1\"",
      "bun \"pai-tools/deep-research-cli.ts\" tick --manifest \"<RUN_ROOT>/manifest.json\" --driver task --reason \"resume wave1 after agent-result ingestion\""
    ],
    "blockers_summary": {
      "missing_artifacts": [
        {
          "name": "wave-review.json",
          "path": "<RUN_ROOT>/wave-review.json"
        }
      ],
      "blocked_gates": []
    }
  }
}
```

## `status --json`

```json
{
  "ok": true,
  "command": "status",
  "run_id": "<RUN_ID>",
  "run_root": "<RUN_ROOT>",
  "manifest_path": "<RUN_ROOT>/manifest.json",
  "gates_path": "<RUN_ROOT>/gates.json",
  "stage_current": "pivot",
  "status": "running",
  "gate_statuses_summary": {
    "A": {
      "status": "pass",
      "checked_at": "2026-02-21T18:13:52.545Z"
    },
    "B": {
      "status": "pass",
      "checked_at": "2026-02-21T18:13:52.554Z"
    },
    "C": {
      "status": "not_run",
      "checked_at": null
    },
    "D": {
      "status": "not_run",
      "checked_at": null
    },
    "E": {
      "status": "not_run",
      "checked_at": null
    },
    "F": {
      "status": "not_run",
      "checked_at": null
    }
  }
}
```

## `inspect --json`

```json
{
  "ok": true,
  "command": "inspect",
  "run_id": "<RUN_ID>",
  "run_root": "<RUN_ROOT>",
  "manifest_path": "<RUN_ROOT>/manifest.json",
  "gates_path": "<RUN_ROOT>/gates.json",
  "stage_current": "pivot",
  "status": "running",
  "gate_statuses_summary": {
    "A": {
      "status": "pass",
      "checked_at": "2026-02-21T18:13:52.545Z"
    },
    "B": {
      "status": "pass",
      "checked_at": "2026-02-21T18:13:52.554Z"
    },
    "C": {
      "status": "not_run",
      "checked_at": null
    },
    "D": {
      "status": "not_run",
      "checked_at": null
    },
    "E": {
      "status": "not_run",
      "checked_at": null
    },
    "F": {
      "status": "not_run",
      "checked_at": null
    }
  },
  "blockers_summary": {
    "missing_artifacts": [],
    "blocked_gates": []
  }
}
```

## `triage --json`

```json
{
  "ok": true,
  "command": "triage",
  "run_id": "<RUN_ID>",
  "run_root": "<RUN_ROOT>",
  "manifest_path": "<RUN_ROOT>/manifest.json",
  "gates_path": "<RUN_ROOT>/gates.json",
  "stage_current": "pivot",
  "status": "running",
  "gate_statuses_summary": {
    "A": {
      "status": "pass",
      "checked_at": "2026-02-21T18:13:52.545Z"
    },
    "B": {
      "status": "pass",
      "checked_at": "2026-02-21T18:13:52.554Z"
    },
    "C": {
      "status": "not_run",
      "checked_at": null
    },
    "D": {
      "status": "not_run",
      "checked_at": null
    },
    "E": {
      "status": "not_run",
      "checked_at": null
    },
    "F": {
      "status": "not_run",
      "checked_at": null
    }
  },
  "blockers_summary": {
    "missing_artifacts": [],
    "blocked_gates": []
  }
}
```
