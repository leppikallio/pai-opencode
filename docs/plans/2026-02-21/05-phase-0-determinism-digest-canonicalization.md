# Deep Research Option C — Phase 0C (Determinism: digest canonicalization) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Remove JSON key-order sensitivity from digests so deterministic runs are actually reproducible.

**Architecture:** Prefer `sha256DigestForJson(...)` (canonical JSON) everywhere a digest is persisted (`inputs_digest`, `patch_digest`, etc.). Keep the digest schema strings stable.

**Tech Stack:** Bun + TypeScript; tool layer `/.opencode/tools/deep_research_cli/**`; bun:test regression tests.

---

## Phase outputs (deliverables)

- `manifest_write` audit `patch_digest` is stable regardless of patch object key insertion order.
- `perspectives_write` audit `value_digest` is stable regardless of object key insertion order.
- `stage_advance` uses canonical JSON for `inputs_digest`.

## Task 0C.1: Create Phase 0C worktree

```bash
git worktree add /tmp/pai-dr-phase0c -b dr-phase0c-digest-canonical
```

## Task 0C.2: Regression test — manifest_write patch_digest is canonical (should FAIL initially)

**Files:**
- Create: `.opencode/tests/regression/deep_research_manifest_write_patch_digest_regression.test.ts`
- Modify later: `.opencode/tools/deep_research_cli/manifest_write.ts`

**Step 1: Write failing test**

Test idea:
- Create a temp run root.
- Call `manifest_write.execute(...)` twice with semantically identical patches but different key order.
- Read `logs/audit.jsonl` and assert the two `patch_digest` values match.

**Step 2: Run test (expect FAIL)**

```bash
bun test .opencode/tests/regression/deep_research_manifest_write_patch_digest_regression.test.ts
```

Expected: FAIL (today digest uses `JSON.stringify(args.patch)`).

## Task 0C.3: Canonicalize manifest_write patch_digest (make test PASS)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/manifest_write.ts:72`

Change:

```ts
patch_digest: `sha256:${sha256HexLowerUtf8(JSON.stringify(args.patch))}`,
```

to:

```ts
patch_digest: sha256DigestForJson(args.patch),
```

(`sha256DigestForJson` already canonicalizes keys. If it is not available in this file, import from `./wave_tools_shared` or `./lifecycle_lib` depending on where you standardize it.)

**Step 2: Re-run regression test + commit**

```bash
bun test .opencode/tests/regression/deep_research_manifest_write_patch_digest_regression.test.ts
git add .opencode/tools/deep_research_cli/manifest_write.ts .opencode/tests/regression/deep_research_manifest_write_patch_digest_regression.test.ts
git commit -m "fix(dr): canonicalize manifest_write patch_digest"
```

## Task 0C.4: Regression test — perspectives_write value_digest is canonical (should FAIL initially)

**Files:**
- Create: `.opencode/tests/regression/deep_research_perspectives_write_value_digest_regression.test.ts`
- Modify later: `.opencode/tools/deep_research_cli/perspectives_write.ts`

**Step 1: Write failing test**

Create two perspectives payloads with identical logical content but different key insertion order and assert `value_digest` is identical.

**Step 2: Run test (expect FAIL)**

```bash
bun test .opencode/tests/regression/deep_research_perspectives_write_value_digest_regression.test.ts
```

## Task 0C.5: Canonicalize perspectives_write value_digest (make test PASS)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/perspectives_write.ts:44`

Change:

```ts
value_digest: `sha256:${sha256HexLowerUtf8(JSON.stringify(args.value))}`,
```

to:

```ts
value_digest: sha256DigestForJson(args.value),
```

**Step 2: Re-run regression test + commit**

```bash
bun test .opencode/tests/regression/deep_research_perspectives_write_value_digest_regression.test.ts
git add .opencode/tools/deep_research_cli/perspectives_write.ts .opencode/tests/regression/deep_research_perspectives_write_value_digest_regression.test.ts
git commit -m "fix(dr): canonicalize perspectives_write value_digest"
```

## Task 0C.6: Canonicalize stage_advance inputs_digest

**Files:**
- Modify: `.opencode/tools/deep_research_cli/stage_advance.ts` (currently hashes `JSON.stringify(digestInput)`)

**Step 1: Replace JSON.stringify hashing**

Change:

```ts
const inputs_digest = `sha256:${sha256HexLowerUtf8(JSON.stringify(digestInput))}`;
```

to:

```ts
const inputs_digest = sha256DigestForJson(digestInput);
```

**Step 2: Add a small regression test**

If needed, add a regression test that ensures `inputs_digest` is deterministic across runs when `evaluated` ordering is stable (this is mostly a guard against accidental inclusion of non-deterministic fields).

**Step 3: Commit**

```bash
git add .opencode/tools/deep_research_cli/stage_advance.ts
git commit -m "fix(dr): canonicalize stage_advance inputs_digest"
```

## Phase 0C Gate (must PASS before Phase 1A)

**Gate execution (required):**

- Architect agent must review the phase diff and report **PASS/FAIL** against the Architect checklist.
- QATester agent must run the QA checklist commands and report **PASS/FAIL** with the raw test output.

### Architect Gate — PASS checklist

- [ ] No persisted digest depends on object key insertion order.
- [ ] Digest schema strings remain stable (no accidental breaking changes).

### QA Gate — PASS checklist

```bash
bun test .opencode/tests/regression/deep_research_manifest_write_patch_digest_regression.test.ts
bun test .opencode/tests/regression/deep_research_perspectives_write_value_digest_regression.test.ts

# sanity: existing suite still passes
bun test .opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts
```

Expected: all PASS.
