# spec-tool-deep-research-telemetry-append-v1 (P06-02 helper)

## Tool name
`deep_research_telemetry_append`

## Purpose
Append one event to a run’s telemetry JSONL stream (`logs/telemetry.jsonl`) in a way that is:
- **deterministic** (stable serialization),
- **offline-first**,
- consistent with `spec-run-telemetry-schema-v1.md`.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `run_root` | string | ✅ | absolute run root (contains `manifest.json`) |
| `event` | object | ✅ | event payload (WITHOUT `seq`; tool assigns `seq`) |
| `telemetry_relpath` | string | ❌ | default: `logs/telemetry.jsonl` |
| `create_if_missing` | boolean | ❌ | default: `true` |
| `assert_run_id` | string | ❌ | if provided, MUST match `event.run_id` |

### `event` constraints
`event` MUST conform to `spec-run-telemetry-schema-v1.md`:
- MUST include: `schema_version`, `run_id`, `ts`, `event_type`
- MUST include all required fields for its `event_type`
- MUST NOT include: `seq` (assigned by this tool)

## Side effects
Appends exactly one JSON line to:
- `<run_root>/<telemetry_relpath>`

The tool MUST create parent directories when `create_if_missing=true`.

## Outputs (return value)
Return JSON object:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | |
| `path` | string | ✅ | absolute path written |
| `seq` | number | ✅ | seq assigned to the appended event |
| `bytes_appended` | number | ✅ | |

## Error contract (mandatory)
On success:
```json
{ "ok": true, "path": "/abs/run/logs/telemetry.jsonl", "seq": 12, "bytes_appended": 187 }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "SCHEMA_INVALID", "message": "...", "details": {} } }
```

## Determinism rules
1. `seq` assignment:
   - If the file exists and has valid events, set `seq = last.seq + 1`.
   - If missing/empty, set `seq = 1`.
2. Serialization:
   - JSON object keys MUST be written in **lexicographic (byte) order**.
   - Output uses LF newline and MUST end with `\n`.
3. No implicit timestamps:
   - Tool MUST NOT generate `ts`; caller supplies it (tests use fixed values).

## Example output (JSON)
```json
{ "ok": true, "path": "/abs/run/logs/telemetry.jsonl", "seq": 3, "bytes_appended": 168 }
```

## Failure modes
| Code | When |
|---|---|
| `INVALID_ARGS` | missing run_root/event |
| `SCHEMA_INVALID` | event violates `spec-run-telemetry-schema-v1.md` |
| `PATH_NOT_WRITABLE` | cannot create/append telemetry file |
| `SEQ_READ_FAILED` | cannot determine last seq (corrupt JSONL) |

## References
- `spec-run-telemetry-schema-v1.md`
- `deep-research-option-c-phase-06-executable-backlog.md` (P06-02)
