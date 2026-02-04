VerifyMemoryWiring

Checks that OpenCode PAI is writing session artifacts to MEMORY.

Usage:

- Verify a specific session:
  - `PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/VerifyMemoryWiring.ts ses_...`

- Verify the latest session:
  - `PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/VerifyMemoryWiring.ts --latest`

Output:

- Required: RAW jsonl + WORK dir + THREAD.md + ISC.json + META.yaml
- Optional: SECURITY jsonl, LEARNING dir

Exit codes:

- `0` success
- `1` usage error
- `2` missing artifacts
