# Blog_Publish-Post Pipeline

**Purpose:** Publish a blog post with verification gates.
**Domain:** Blog
**Version:** 1.0

---

## Pipeline Overview

| Step | Action | Purpose | On Fail |
|------|--------|---------|---------|
| 1 | Validate-Frontmatter | Ensure required metadata exists | abort |
| 2 | Validate-Images | Ensure referenced images exist | abort |
| 3 | Proofread | Fix obvious clarity and typos | prompt |
| 4 | Deploy | Publish the site | abort |
| 5 | Visual-Verify | Confirm live page renders correctly | prompt |

---

## Steps

### Step 1: Validate-Frontmatter

**Action:** `~/.config/opencode/ACTIONS/Validate-Frontmatter/ACTION.md`

**Verification:**
| # | Criterion | Oracle | Check | On Fail |
|---|----------|--------|-------|---------|
| 1 | Frontmatter contains required keys | file | Parse frontmatter, ensure required keys | abort |

---

### Step 2: Validate-Images

**Action:** `~/.config/opencode/ACTIONS/Validate-Images/ACTION.md`

**Verification:**
| # | Criterion | Oracle | Check | On Fail |
|---|----------|--------|-------|---------|
| 1 | All referenced images exist on disk | file | Resolve each image path, test -f | abort |

---

### Step 3: Proofread

**Action:** `~/.config/opencode/ACTIONS/Proofread/ACTION.md`

**Verification:**
| # | Criterion | Oracle | Check | On Fail |
|---|----------|--------|-------|---------|
| 1 | No obvious typos after proofreading | manual | Human skim or lint if available | prompt |

---

### Step 4: Deploy

**Action:** `~/.config/opencode/ACTIONS/Deploy/ACTION.md`

**Verification:**
| # | Criterion | Oracle | Check | On Fail |
|---|----------|--------|-------|---------|
| 1 | Deploy command exits with success | command | Exit code 0 | abort |

---

### Step 5: Visual-Verify

**Action:** `~/.config/opencode/ACTIONS/Visual-Verify/ACTION.md`

**Verification:**
| # | Criterion | Oracle | Check | On Fail |
|---|----------|--------|-------|---------|
| 1 | Live page screenshot matches expectations | visual | Browser screenshot, verify content | prompt |

---

## Pipeline Verification

**Goal:** Published post is live, correct, and verified.

| # | Criterion | Oracle | Check |
|---|----------|--------|-------|
| 1 | Post reachable and renders on production | http/visual | curl 200 + Browser screenshot |
