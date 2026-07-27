# Validate-Knobs Worktree Probe (#99) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--validate-knobs` rehearses a candidate `bootstrapCmd` inside a disposable git worktree — never the session checkout — so a wrong draft is structurally unable to mutate the operator's tree or environment.

**Architecture:** Relocate the bootstrapCmd probe in `validate_knobs()`: cut `wt-knob-<pid>` under the driver's state dir with `git worktree add --detach … HEAD` (the preflight capability probe's exact pattern), run the command there, and judge no-op-ness by the worktree's own resulting tree state (fresh detached worktrees start clean, so `git status --porcelain` output IS the command's mutation). Remove the worktree in a `finally`; creation failure fails closed. The verdict JSON keeps its exact keys.

**Tech Stack:** Python 3, pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-27-validate-knobs-worktree-probe.md`

**Acceptance:** suite — the committed pytest suite is the verification; deterministic driver code, not the frozen verification periphery. No seal requested.

## Global Constraints

- **The session checkout is never the probe's working directory** — the candidate command must only ever execute inside the throwaway worktree.
- **Verdict JSON schema unchanged:** the bootstrap verdict keeps exactly the keys `ok`, `stage`, `exit`, `treeClean`, `output`; the creation-failure verdict uses `ok`/`stage`/`detail` like the other fail-closed knob verdicts. Exit 0 = safe, non-zero = blocked, unchanged.
- **The boundary caveat is stated, not implied:** docstring and SKILL.md name what the worktree does NOT contain — shared global package caches (pip/npm/uv), outside-the-repo venvs on PATH, network effects.
- **No changes outside** `skills/ultrapowers/scripts/ultra_run.py`, `tests/test_ultra_run.py`, and `skills/ultrapowers/SKILL.md`.
- **No Anthropic SDK / `ANTHROPIC_API_KEY`** in any shipped or dev script (CLAUDE.md).
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: Relocate the bootstrapCmd probe into a throwaway worktree

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `validate_knobs(args_path, root)` bootstrap branch — probe worktree at `.claude/ultrapowers/wt-knob-<pid>`; green verdict iff command exit 0 AND probe worktree status is empty; creation failure → `{"ok": false, "stage": "knob-validate", "detail": "cannot cut probe worktree: …"}` exit 1; worktree always removed afterwards.

This plan is intentionally narrow: one function's probe relocation — no latent parallelism.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ultra_run.py`, reusing its existing helpers (`make_repo`, `run_validate_knobs`, `sh`):

```python
# --- #99: bootstrapCmd probed in a throwaway worktree, never the checkout ---

def test_destructive_bootstrap_cannot_touch_the_session_checkout(tmp_path):
    # The headline regression: under the old design this command deleted the
    # session repo's file; now the mutation is confined to the probe worktree.
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "rm plan.md"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0
    verdict = json.loads(r.stdout)
    assert verdict["ok"] is False
    assert verdict["treeClean"] is False
    assert (repo / "plan.md").is_file()          # the session checkout is intact
    assert sh(["git", "status", "--porcelain"], cwd=repo).stdout == ""


def test_noop_bootstrap_leaves_no_probe_worktree_behind(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "true"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert not list((repo / ".claude/ultrapowers").glob("wt-knob-*"))
    worktrees = sh(["git", "worktree", "list"], cwd=repo).stdout.strip()
    assert len(worktrees.splitlines()) == 1      # only the main checkout


def test_unborn_head_fails_probe_worktree_creation_closed(tmp_path):
    # A repo with no commits cannot cut a worktree from HEAD: fail closed,
    # never fall back to running the command on the session checkout.
    repo = tmp_path / "empty"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "touch dirt.txt"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0
    verdict = json.loads(r.stdout)
    assert verdict["ok"] is False
    assert "probe worktree" in verdict["detail"]
    assert not (repo / "dirt.txt").exists()      # the command never ran here
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_run.py -k "destructive_bootstrap or no_probe_worktree or unborn_head" -v`

Expected: `test_destructive_bootstrap_cannot_touch_the_session_checkout` FAILS (`plan.md` was deleted from the session repo — the incident this plan fixes); `test_unborn_head_fails_probe_worktree_creation_closed` FAILS (`dirt.txt` exists — the command ran on the session checkout). `test_noop_bootstrap_leaves_no_probe_worktree_behind` may already pass (no worktree is cut today) — it pins the cleanup contract against regression.

- [ ] **Step 3: Relocate the probe in the driver**

In `skills/ultrapowers/scripts/ultra_run.py`:

Add `import os` to the import block (alphabetical, after `import json`).

Update the `validate_knobs` docstring's bootstrap clause from "a bootstrapCmd must be a clean no-op on the session checkout" to:

```python
    """Pre-launch knob validation, fail-closed (#89): every wave entry's
    tier/review must be a value the engine accepts, and a bootstrapCmd must
    be a clean no-op when rehearsed in a throwaway worktree (#99) — never on
    the session checkout, so a wrong draft cannot mutate the operator's tree.
    The worktree bounds repo-tree mutations only: shared global package
    caches (pip/npm/uv), outside-the-repo venvs, and network effects escape
    it. Exit 0 = safe."""
```

Replace the bootstrap execution block:

```python
    before = sh(["git", "status", "--porcelain"], cwd=root).stdout
    proc = subprocess.run(cmd, shell=True, cwd=root,
                          capture_output=True, text=True)
    after = sh(["git", "status", "--porcelain"], cwd=root).stdout
    ok = proc.returncode == 0 and before == after
    print(json.dumps({"ok": ok, "stage": "knob-validate",
                      "exit": proc.returncode,
                      "treeClean": before == after,
                      "output": (proc.stdout + proc.stderr)[-2000:]}))
    return 0 if ok else 1
```

with the worktree rehearsal:

```python
    probe_wt = root / ".claude/ultrapowers" / ("wt-knob-%d" % os.getpid())
    r = sh(["git", "worktree", "add", "--detach", str(probe_wt), "HEAD"],
           cwd=root)
    if r.returncode != 0:
        print(json.dumps({"ok": False, "stage": "knob-validate",
                          "detail": "cannot cut probe worktree: %s"
                                    % (r.stderr or r.stdout).strip()}))
        return 1
    try:
        proc = subprocess.run(cmd, shell=True, cwd=probe_wt,
                              capture_output=True, text=True)
        # A fresh detached worktree starts clean: any status output IS the
        # command's own mutation.
        dirt = sh(["git", "status", "--porcelain"], cwd=probe_wt).stdout
    finally:
        rm = sh(["git", "worktree", "remove", "--force", str(probe_wt)],
                cwd=root)
    ok = proc.returncode == 0 and not dirt
    output = (proc.stdout + proc.stderr)[-2000:]
    if rm.returncode != 0:
        output += "\n[probe worktree removal failed: %s]" % rm.stderr.strip()
    print(json.dumps({"ok": ok, "stage": "knob-validate",
                      "exit": proc.returncode, "treeClean": not dirt,
                      "output": output}))
    return 0 if ok else 1
```

- [ ] **Step 4: Update the engine skill doc's sentence**

In `skills/ultrapowers/SKILL.md` (Step 2, just after the knob list), replace:

```markdown
Before launch, `ultra_run.py --validate-knobs <argsFile>` verifies any
`bootstrapCmd` no-ops cleanly on the session checkout and each wave entry's
`tier`/`review` value is one the engine accepts.
```

with:

```markdown
Before launch, `ultra_run.py --validate-knobs <argsFile>` verifies any
`bootstrapCmd` no-ops cleanly in a throwaway worktree (never the session
checkout; global package caches are outside the boundary) and each wave
entry's `tier`/`review` value is one the engine accepts.
```

- [ ] **Step 5: Run the driver test file to verify everything passes**

Run: `python3 -m pytest tests/test_ultra_run.py -v`

Expected: ALL PASS — the three new tests plus every pre-existing `--validate-knobs` case (`true` is a no-op in the worktree too; `false` still fails on exit code; `touch dirt.txt` now dirties the probe worktree instead of the checkout and still fails).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_run.py skills/ultrapowers/SKILL.md tests/test_ultra_run.py
git commit -m "fix: rehearse bootstrapCmd in a throwaway worktree, never the session checkout (#99)"
```

---

### Task 2: Suite gate

**Type:** gate
**Depends-on:** 1

- [ ] **Step 1: Run the full committed suite**

Run: `python3 -m pytest`
Expected: all tests pass, no skips introduced by this plan.
