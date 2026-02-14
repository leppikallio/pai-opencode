# Deep Research Option C — Entity Tests

These tests validate **functional entity behavior** (tools/commands/orchestrator steps) by asserting:

- tool return JSON contracts (`ok`, `error.code`, etc.)
- artifact outputs on disk (`manifest.json`, `gates.json`, `logs/audit.jsonl`, skeleton dirs)

They are intentionally **fixture/tempdir** based and should run in seconds.

Run:

```bash
cd .opencode
PAI_DR_OPTION_C_ENABLED=1 bun test tests
```
