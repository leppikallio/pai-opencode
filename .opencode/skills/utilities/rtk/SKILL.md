---
name: rtk
description: RTK first-class awareness and SessionStart rewrite hookup for PAI/OpenCode.
---

# RTK in PAI/OpenCode

RTK is treated as a first-class RTK capability in this runtime, with a narrow scope:

- awareness for operators and agents
- SessionStart reminder hookup
- no duplicate runtime rewrite path

Actual Bash rewriting remains in the canonical `pai-cc-hooks` runtime path and is gated by the cached RTK capability (`supportsRewrite: true`).

## RTK meta commands

Use these directly when you need RTK visibility or diagnostics:

```bash
rtk gain
rtk gain --history
rtk discover
rtk proxy <cmd>
```

## SessionStart awareness behavior

- `RtkAwareness.hook.ts` emits awareness text only when cached RTK capability supports rewrite.
- Missing cache, malformed cache, or `supportsRewrite: false` all no-op cleanly.
- The awareness hook does not run `rtk rewrite` and does not implement rewrite behavior.
