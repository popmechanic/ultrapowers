# BaseBranch From Launched Checkout (#100) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pre-launch driver derives `baseBranch` from the branch the operator launched from, falling back to the repo default only on detached HEAD with a loud receipt note.

**Architecture:** Invert the priority of the two existing probes in the driver's base-branch stage: `git branch --show-current` wins; `symbolic-ref refs/remotes/origin/HEAD` is the detached-HEAD fallback (today it is backwards — the repo default wins and the launched checkout is the fallback). The fallback stamps a `detached HEAD → fell back to repo default '<name>'` note into the stage detail; detached with no remote HEAD stays fail-closed. One sentence in the engine skill doc tells operators where the value comes from.

**Tech Stack:** Python 3, pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-27-basebranch-launched-checkout.md`

**Acceptance:** suite — the committed pytest suite is the verification; deterministic driver code, not the frozen verification periphery. No seal requested.

## Global Constraints

- **No receipt schema change:** stage entries keep exactly the keys `stage`, `ok`, `detail`; `receipt["baseBranch"]` stays a plain branch name (the fallback note lives only in the stage detail).
- **Fail-closed shape unchanged:** no resolvable branch → the `base-branch` stage is red with detail `no branch resolvable` and the driver exits non-zero via `bail()`.
- **Behavior on `main`-launched repos is unchanged** — both derivations agree there; the existing happy-path tests must keep passing untouched.
- **No changes outside** `skills/ultrapowers/scripts/ultra_run.py`, `tests/test_ultra_run.py`, and `skills/ultrapowers/SKILL.md`.
- **No Anthropic SDK / `ANTHROPIC_API_KEY`** in any shipped or dev script (CLAUDE.md).
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: Launched-checkout derivation + loud detached-HEAD fallback

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `receipt["baseBranch"]` = the branch checked out at preflight (repo default only on detached HEAD); `base-branch` stage success detail = the branch name, or `detached HEAD → fell back to repo default '<name>'` on the fallback path; failure detail = `no branch resolvable`.

This plan is intentionally narrow: one derivation site plus its doc line — no latent parallelism.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ultra_run.py`, reusing its existing helpers (`make_repo`, `run_driver`, `sh`). The synthetic `refs/remotes/origin/HEAD` gives the fixture repo a "repo default branch" without a real remote:

```python
# --- #100: baseBranch derives from the launched checkout ---

def give_remote_head(repo, default="main"):
    # Synthesize the repo-default pointer a clone would have, no real remote.
    sh(["git", "update-ref", "refs/remotes/origin/" + default, "HEAD"], cwd=repo)
    sh(["git", "symbolic-ref", "refs/remotes/origin/HEAD",
        "refs/remotes/origin/" + default], cwd=repo)


def base_stage(receipt):
    return next(s for s in receipt["stages"] if s["stage"] == "base-branch")


def test_feature_branch_launch_wins_over_repo_default(tmp_path):
    repo = make_repo(tmp_path)
    give_remote_head(repo)
    sh(["git", "checkout", "-q", "-b", "feature"], cwd=repo)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["baseBranch"] == "feature"
    s = base_stage(receipt)
    assert s["ok"] is True
    assert s["detail"] == "feature"          # no fallback note on the happy path


def test_detached_head_falls_back_to_repo_default_loudly(tmp_path):
    repo = make_repo(tmp_path)
    give_remote_head(repo)
    sh(["git", "checkout", "-q", "--detach"], cwd=repo)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["baseBranch"] == "main"
    s = base_stage(receipt)
    assert s["ok"] is True
    assert s["detail"] == "detached HEAD → fell back to repo default 'main'"


def test_detached_head_without_remote_head_fails_closed(tmp_path):
    repo = make_repo(tmp_path)                 # no remote refs at all
    sh(["git", "checkout", "-q", "--detach"], cwd=repo)
    r = run_driver(repo)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    s = base_stage(receipt)
    assert s["ok"] is False
    assert s["detail"] == "no branch resolvable"
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_run.py -k "feature_branch_launch or detached_head" -v`

Expected: `test_feature_branch_launch_wins_over_repo_default` FAILS (receipt says `main`, the repo default, not `feature`); `test_detached_head_falls_back_to_repo_default_loudly` FAILS on the detail assertion (today the fallback direction is inverted, so no note exists); `test_detached_head_without_remote_head_fails_closed` may already pass (both probes come up empty today) — that is fine, it pins the fail-closed shape against regression.

- [ ] **Step 3: Invert the derivation in the driver**

In `skills/ultrapowers/scripts/ultra_run.py`, replace the base-branch block (currently right after the `snapshot` stage):

```python
    r = sh(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
           cwd=root)
    if r.returncode == 0 and r.stdout.strip():
        base = r.stdout.strip().split("/", 1)[-1]
    else:  # no remote HEAD (fresh/local repo): the current branch is the base
        base = sh(["git", "branch", "--show-current"], cwd=root).stdout.strip()
    stage("base-branch", bool(base), base or "no branch resolvable")
    if not base:
        return bail()
```

with the launched-checkout derivation:

```python
    # The base is the branch the operator launched from — by construction it
    # contains the plan and the session's context (#100). Repo default only
    # on detached HEAD, loudly; neither resolvable stays fail-closed.
    base = sh(["git", "branch", "--show-current"], cwd=root).stdout.strip()
    base_note = ""
    if not base:
        r = sh(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
               cwd=root)
        if r.returncode == 0 and r.stdout.strip():
            base = r.stdout.strip().split("/", 1)[-1]
            base_note = "detached HEAD → fell back to repo default '%s'" % base
    stage("base-branch", bool(base), base_note or base or "no branch resolvable")
    if not base:
        return bail()
```

Also update the module docstring's stage list phrase `deterministic knob derivation (baseBranch, probe payload)` to `deterministic knob derivation (baseBranch from the launched checkout, probe payload)`.

- [ ] **Step 4: Update the engine skill doc's knob line**

In `skills/ultrapowers/SKILL.md` (Step 2's `llmDerives` knob list), replace:

```markdown
- **`baseBranch`** — derived in `receipt.baseBranch`; pass through.
```

with:

```markdown
- **`baseBranch`** — derived in `receipt.baseBranch` from the launched
  checkout (the branch the session is on at preflight; repo default only on
  detached HEAD, noted in the `base-branch` stage detail); pass through.
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `python3 -m pytest tests/test_ultra_run.py -v`

Expected: ALL PASS — the three new tests and every pre-existing test (the fixture launches from `main` with no remote, where the new derivation returns the same value the old one did).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_run.py skills/ultrapowers/SKILL.md tests/test_ultra_run.py
git commit -m "fix: derive baseBranch from the launched checkout, not the repo default (#100)"
```

---

### Task 2: Suite gate

**Type:** gate
**Depends-on:** 1

- [ ] **Step 1: Run the full committed suite**

Run: `python3 -m pytest`
Expected: all tests pass, no skips introduced by this plan.
