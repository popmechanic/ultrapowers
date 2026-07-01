# Relocate ultrapowers scratch out of `.git/` (#67) — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the review-packet scratch out of `.git/` — the protected path superpowers fled in v6.0.3 — while preserving the property that makes `.git/…/ultra` work today: a single shared location every worktree (isolated implementer, non-isolated reviewer on main) resolves identically.

**Architecture:** `review-package` writes packets to `$(git rev-parse --git-common-dir)/ultra` precisely because `--git-common-dir` resolves to the same shared location from every worktree. A naive move to a worktree-relative dir (`.superpowers/` off the CWD) would break that — the implementer's worktree and the reviewer's main checkout would get *different* dirs. The fix keeps the shared anchor but escapes `.git/`: resolve `--git-common-dir` to an absolute path, take its **parent** (the main repo root — the same for every linked worktree), and write to `<main-root>/.superpowers/ultra`. `.superpowers/` is already gitignored (upstream's convention) so no `git status` noise, and it is outside the protected `.git/`. `review-package` still echoes the packet path as its last stdout line, so the reviewer reads the echoed path regardless of location — the baked implementer/reviewer prose only needs its "shared common git dir" description updated.

**Tech Stack:** Bash (`review-package`), Markdown (`references/reviewer-prompts.md` — baked source), JavaScript (`harnesses/waves.js` — re-baked), Python/pytest (`tests/test_review_package.py`, `tests/test_no_prompt_drift.py`).

## Suite-gate note

The bash relocation (`review-package`) and the baked-prose drift are both pytest-verified
(`test_review_package.py`, `test_no_prompt_drift.py`). The only part the pytest suite-gate does
not execute is the live reviewer agent reading the echoed path — but that logic is unchanged
(the packet path is still echoed). This entry is nonetheless held at the docket end gate for
operator review (waves.js touch; 2026-07-01 shakedown JS-gate finding).

## Global Constraints

- **Preserve cross-worktree sharing** — the scratch dir must resolve identically from every worktree; derive it from `--git-common-dir`'s resolved parent, never from the CWD/worktree root.
- **Prompts are baked** — edit `references/reviewer-prompts.md`, re-bake `waves.js` per `references/workflow-template.md`, keep `tests/test_no_prompt_drift.py` green.
- **Escape `.git/`** — the packet path must not be under any `.git` directory.
- **No version bump, no direct Anthropic API calls, worktree-pure.**

---

### Task 1: Relocate the packet scratch to `<main-root>/.superpowers/ultra`

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/review-package`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/test_review_package.py`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: `review-package`'s `dir=$(git rev-parse --git-common-dir)/ultra` (line ~31); the baked "shared common git dir" prose in `reviewer-prompts.md` (lines 54, 125) mirrored in `waves.js` (lines ~313, ~336).
- Produces: packets written under `<resolved-common-dir-parent>/.superpowers/ultra`, outside `.git/`, shared across worktrees; updated packet-location prose in both baked mirrors; updated tests asserting the new location and that no packet path is under `.git/`.

- [ ] **Step 1: Update the failing tests**

In `tests/test_review_package.py`, change `test_review_package_writes_to_common_git_dir_and_echoes_path`: assert `out_path` resolves under `<parent-of-common-dir>/.superpowers/ultra` (not `<common-dir>/ultra`), and add an assertion that no component of `out_path` is `.git` (`".git" not in out_path.resolve().parts`). Add a `test_packet_dir_shared_across_worktrees`: create a linked worktree (`git worktree add`), run `review-package` from both the main checkout and the worktree, and assert both echo packet paths under the *same* `.superpowers/ultra` directory.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_review_package.py -q`
Expected: FAIL — packets still land under `.git/…/ultra`.

- [ ] **Step 3: Relocate + update baked prose + re-bake**

In `skills/ultrapowers/scripts/review-package`, replace the `dir=` line with a resolved-parent computation, e.g.:

```bash
common="$(git rev-parse --git-common-dir)"
common="$(cd "$common" && pwd)"        # absolutize (handles the bare ".git" case)
dir="$(dirname "$common")/.superpowers/ultra"
```

so the packet path becomes `<main-root>/.superpowers/ultra/review-<base7>..<head7>.diff` (still echoed as the last stdout line). Update the header comment (lines ~8-11) to describe the new shared location and why it escapes `.git/`.

In `skills/ultrapowers/references/reviewer-prompts.md`, change "the shared common git dir" → "the shared scratch dir under `.superpowers/` (outside `.git/`)" in both the implementer step (line 54) and the reviewer step (line 125). Re-bake `waves.js` per `references/workflow-template.md` so lines ~313/~336 match, keeping `tests/test_no_prompt_drift.py` green.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_review_package.py tests/test_no_prompt_drift.py -q`
Expected: PASS — packets under `.superpowers/ultra`, shared across worktrees, no `.git/` component; drift pins green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/review-package skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js tests/test_review_package.py tests/test_no_prompt_drift.py
git commit -m "fix(engine): relocate review-packet scratch out of .git/ to shared .superpowers/ultra (#67)"
```

---

### Task 2: Full-suite gate

**Type:** gate

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS — all green, including the relocated `test_review_package.py` and the re-baked drift pins.

---

## Acceptance

**Acceptance:** suite — bash + baked-prose change, verified by the committed suite (`test_review_package.py` for the relocation + cross-worktree sharing, `test_no_prompt_drift.py` for the re-baked prose) plus adversarial diff review; no held-out exam. Held at the docket end gate for operator review (see the Suite-gate note).
