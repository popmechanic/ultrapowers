# run_lock.sh post-restore branch guard (#68) — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `run_lock.sh restore` fail loud when it lands on the wrong branch, instead of silently gating the wrong tree at the pre-merge checkout-snapshot anchor (#29/#32).

**Architecture:** `restore` reads `CHECKOUT_SNAPSHOT` (`branch<TAB>sha`) and `git checkout`s the recorded branch (or the sha if the branch is empty). The observed 2026-06-25 bug had a multi-run session's second `restore` land on `ultra/shakedown-…` instead of the recorded `main` — a silent wrong-tree, undetected. The root-cause-agnostic hardening: **after the checkout, assert the checkout actually landed where recorded** — `git branch --show-current` equals the recorded branch (or, for the sha-fallback path, `git rev-parse HEAD` equals the recorded sha). On mismatch, print a loud warning to stderr and `exit 1` so the orchestrator surfaces it rather than gating the wrong tree. Restore stays branch-first (callers expect to be back *on* `main` as a branch, not detached), so this adds detection without changing restore semantics; a legitimately-advanced branch is still a correct restore (we assert the branch identity, not the moving sha).

**Tech Stack:** Bash (`run_lock.sh`), Python/pytest (`tests/test_run_lock.py`, which already drives the bash script in temp repos).

## Global Constraints

- **No behavior change to `acquire`/`check`/`release`/`snapshot`** — only `restore` gains the post-checkout guard.
- **Branch-first restore is preserved** — the guard asserts identity, it does not switch to detached-by-sha.
- **No version bump, no direct Anthropic API calls, worktree-pure** (the executor owns branching).

---

### Task 1: Post-restore branch-identity guard

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/run_lock.sh`
- Test: `tests/test_run_lock.py`

**Interfaces:**
- Consumes: `CHECKOUT_SNAPSHOT` (`branch<TAB>sha`, written by `snapshot`); the existing `restore` case (run_lock.sh:54).
- Produces: `restore` asserts, after `git checkout`, that the resulting checkout matches the recorded ref — current branch == recorded `$b` (branch path) or `HEAD` sha == recorded `$h` (sha-fallback path); mismatch ⇒ loud stderr warning + `exit 1`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_run_lock.py`, add:
  - `test_restore_detects_wrong_branch`: snapshot on `main`; create+checkout a decoy branch `ultra/x`; corrupt the scenario by simulating the bug — e.g. checkout `ultra/x`, then run `restore` in a state where the recorded branch resolves correctly (the guard must confirm the *post-restore* branch is `main`). Assert that when the post-checkout branch would not equal the recorded branch, `restore` exits non-zero with a warning on stderr. (Construct the mismatch by pointing the snapshot's branch field at a branch name that no longer resolves to the same identity, or by asserting the positive: after a normal `restore` the guard confirms `main` and exits 0.)
  - `test_restore_multi_run_per_session`: in one temp repo, run two full `snapshot → (checkout a different branch) → restore` cycles; assert each restore lands back on the recorded branch and exits 0 — the path multi-run/self-host/Salvage exercise but single-run does not.
  - `test_restore_still_lands_on_main`: the existing happy path — snapshot on `main`, `checkout -b _tmp`, `restore` → current branch is `main`, exit 0 (regression guard for the preserved branch-first semantics).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_run_lock.py -q`
Expected: FAIL — no post-restore guard exists yet.

- [ ] **Step 3: Add the guard to `restore`**

In `skills/ultrapowers/scripts/run_lock.sh`, in the `restore)` case after the `git checkout` lines, add:

```bash
if [ -n "$b" ]; then
  cur="$(git -C "$ROOT" branch --show-current)"
  if [ "$cur" != "$b" ]; then
    echo "run_lock.sh restore: expected to land on branch '$b' but HEAD is '${cur:-<detached>}' — refusing to gate the wrong tree (#68)." >&2
    exit 1
  fi
else
  cur="$(git -C "$ROOT" rev-parse HEAD)"
  if [ "$cur" != "$h" ]; then
    echo "run_lock.sh restore: expected detached HEAD at '$h' but HEAD is '$cur' — refusing to gate the wrong tree (#68)." >&2
    exit 1
  fi
fi
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_run_lock.py -q`
Expected: PASS (new guard tests + all pre-existing run_lock tests).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/run_lock.sh tests/test_run_lock.py
git commit -m "fix(run_lock): assert restore landed on the recorded branch, fail loud on mismatch (#68)"
```

---

### Task 2: Full-suite gate

**Type:** gate

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS — all green, including the new `test_run_lock.py` guard tests.

---

## Acceptance

**Acceptance:** suite — bash + pytest change fully exercised by the committed suite (`tests/test_run_lock.py` drives `run_lock.sh` in temp repos), plus adversarial diff review; no held-out exam.
