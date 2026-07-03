# Deterministic Driver Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the orchestrator's prose choreography (SKILL.md Steps 1–4b and Step 5 mechanics) into two deterministic entry points — `ultra_run.py` (pre-launch) and `ultra_gate.py` (gate) — leaving the LLM only judgment calls.

**Architecture:** Both drivers orchestrate the existing scripts (`compile_plan.py`, `run_lock.sh`, `gate_check.py`, `run_acceptance.sh`, `sweep_worktrees.sh`) via subprocess and emit one JSON receipt with an authoritative exit code. They replace choreography, not pieces. The stamp becomes the lock id for the whole run; snapshots record the dirty set so the gate blocks only on new dirt; the launch file pre-emits per-task tier slots so the LLM never guesses the args schema.

**Tech Stack:** Python 3 stdlib + bash; pytest is the gate (`python3 -m pytest`).

**Acceptance:** suite — this is ultrapowers' own engine/script/skill work; the committed pytest suite (with the new tests in Tasks 1–5), drift pins, and per-task review are the verification. No held-out exam.

## Global Constraints

- No `anthropic` SDK and no `ANTHROPIC_API_KEY` in any script (CLAUDE.md: a distributed plugin must need no API key).
- Do not modify `skills/ultrapowers/harnesses/waves.js` — baked prompts are pinned by `tests/test_no_prompt_drift.py` and engine behavior is out of scope for this plan.
- No release ritual in this plan: `plugin.json` and `marketplace.json` stay untouched.
- New scripts follow the existing `skills/ultrapowers/scripts/` conventions: argparse CLI, fail-closed non-zero exits, JSON receipt on stdout, Python 3 stdlib only.
- After the SKILL.md re-layer, the standing-concepts ratchet must not rise: `standingConcepts` ≤ 62 and `skillWords` < 1997 against `skills/ultralearn/complexity-baseline.json` (regenerate the baseline downward as part of Task 6).

---

### Task 1: Pre-emit per-task tier slots in the launch file

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan.py`

**Interfaces:**
- Consumes: nothing
- Produces: every task object in the `--emit-launch` file carries a `"tier"` key, `null` until the orchestrator fills it (`waves.js` treats a null tier exactly like an absent one: `task.tier || 'standard'`)

**Parallelization rationale:** independent single-file compiler change; fixes the launch-args schema-guessing ledger class (three runs, 0.0.29–0.0.30) on its own merits.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_compile_plan.py`:

```python
def test_emit_launch_pre_emits_tier_slots(tmp_path):
    """Per-task tier slots are pre-emitted as null so the orchestrator fills
    slots instead of guessing the launch-args schema (2026-07-03 distill:
    identical two-bounce launch rejection in three runs)."""
    plan = tmp_path / "plan.md"
    plan.write_text(
        "# P\n\n**Acceptance:** waived — test fixture\n\n"
        "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n\n"
        "### Task 2: B\n\n**Type:** implementation\n**Depends-on:** 1\n\n"
        "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1: do**\n"
    )
    launch = tmp_path / "launch.json"
    args = tmp_path / "args.json"
    sh([sys.executable, str(COMPILER), str(plan),
        "--emit-launch", str(launch), "--emit-args", str(args)])
    payload = json.loads(launch.read_text())
    assert payload["tasks"], "no tasks emitted"
    for t in payload["tasks"]:
        assert "tier" in t and t["tier"] is None
```

Match the file's existing helpers: it already defines `sh`, `sys`, `json`, and the `COMPILER` path constant for `compile_plan.py` — reuse those names.

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_compile_plan.py::test_emit_launch_pre_emits_tier_slots -v`
Expected: FAIL with `AssertionError` on `"tier" in t`

- [ ] **Step 3: Add the slot to the launch payload**

In `skills/ultrapowers/scripts/compile_plan.py`, in the `launch_payload` construction (the `"tasks":` list comprehension inside `if emit_launch is not None:`), add the slot:

```python
        launch_payload = {
            "tasks": [{"id": tid, "title": by_id[tid]["title"],
                       "body": by_id[tid]["body"], "files": _files_for(by_id[tid]),
                       "depends_on": by_id[tid]["depends_on"],
                       "interfaces": by_id[tid]["interfaces"],
                       # Pre-emitted slot: the orchestrator fills per-task tiers
                       # HERE (never as a top-level launch key, never via
                       # tierOverrides, which remaps tier names to models).
                       "tier": None}
                      for wave in waves for tid in wave],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_compile_plan.py -v`
Expected: all PASS (the new test plus every existing compile test)

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "feat(compiler): pre-emit per-task tier slots in the launch file"
```

---

### Task 2: Snapshot records the dirty set

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/run_lock.sh`
- Test: `tests/test_run_lock_snapshot.py`

**Interfaces:**
- Consumes: nothing
- Produces: the `snapshot` verb additionally writes `.claude/ultrapowers/DIRTY_SNAPSHOT` — the verbatim `git status --porcelain` output at snapshot time (empty file when clean); `restore` is unchanged

**Parallelization rationale:** independent single-file change to the lock actor; the recorded dirty set is what lets the gate distinguish pre-existing operator dirt from a worktree-discipline violation (four-run ledger class incl. 0.0.30).

- [ ] **Step 1: Write the failing test**

Create `tests/test_run_lock_snapshot.py`:

```python
"""run_lock.sh snapshot: records the porcelain dirty set alongside the
branch/sha snapshot, so the gate can block on NEW dirt only."""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCK = ROOT / "skills/ultrapowers/scripts/run_lock.sh"


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / ".gitignore").write_text(".claude/\n")
    (repo / "f.txt").write_text("base\n")
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def test_snapshot_records_empty_dirty_set_when_clean(tmp_path):
    repo = make_repo(tmp_path)
    sh(["bash", str(LOCK), "snapshot"], cwd=repo)
    dirty = repo / ".claude/ultrapowers/DIRTY_SNAPSHOT"
    assert dirty.is_file()
    assert dirty.read_text().strip() == ""


def test_snapshot_records_preexisting_dirt(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "f.txt").write_text("modified\n")          # tracked, modified
    (repo / "notes.md").write_text("operator file\n")  # untracked
    sh(["bash", str(LOCK), "snapshot"], cwd=repo)
    recorded = (repo / ".claude/ultrapowers/DIRTY_SNAPSHOT").read_text()
    assert " M f.txt" in recorded
    assert "?? notes.md" in recorded


def test_restore_still_works_after_snapshot(tmp_path):
    repo = make_repo(tmp_path)
    sh(["bash", str(LOCK), "snapshot"], cwd=repo)
    sh(["git", "checkout", "-qb", "other"], cwd=repo)
    sh(["bash", str(LOCK), "restore"], cwd=repo)
    cur = sh(["git", "branch", "--show-current"], cwd=repo).stdout.strip()
    assert cur == "main"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_run_lock_snapshot.py -v`
Expected: the two snapshot tests FAIL (`DIRTY_SNAPSHOT` does not exist); the restore test PASSES

- [ ] **Step 3: Record the dirty set in the snapshot verb**

In `skills/ultrapowers/scripts/run_lock.sh`, add the dirty-snapshot path next to the existing `SNAP` definition:

```bash
LOCK="$DIR/RUN_LOCK"
SNAP="$DIR/CHECKOUT_SNAPSHOT"
DIRTY="$DIR/DIRTY_SNAPSHOT"
```

and extend the `snapshot)` case:

```bash
  snapshot)
    branch="$(git -C "$ROOT" branch --show-current)"
    sha="$(git -C "$ROOT" rev-parse HEAD)"
    printf '%s\t%s' "$branch" "$sha" > "$SNAP"
    git -C "$ROOT" status --porcelain > "$DIRTY"
    ;;
```

Also update the header comment's `snapshot` line to read:

```bash
#   snapshot       — record current branch + HEAD sha to CHECKOUT_SNAPSHOT,
#                    and the porcelain dirty set to DIRTY_SNAPSHOT (the gate
#                    blocks only on dirt that appears AFTER this)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_run_lock_snapshot.py tests/test_gate_check.py -v`
Expected: all PASS (gate_check tests confirm no regression from the extra file)

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/run_lock.sh tests/test_run_lock_snapshot.py
git commit -m "feat(lock): snapshot records the porcelain dirty set (DIRTY_SNAPSHOT)"
```

---

### Task 3: Gate blocks on new dirt only; verdict echoes its context

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultrapowers/scripts/gate_check.py`
- Test: `tests/test_gate_check.py`

**Interfaces:**
- Consumes: `DIRTY_SNAPSHOT` (verbatim porcelain lines, written by the snapshot verb of Task 2; absent on runs launched before it)
- Produces: verdict JSON gains top-level `"repo"` and `"lock"` keys (resolved paths); the `clean-tree` check blocks only on porcelain lines NOT present in `DIRTY_SNAPSHOT`, falling back to the strict all-dirt-blocks behavior when no snapshot exists

**Parallelization rationale:** none — serial behind Task 2's recorded-dirty-set contract.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_gate_check.py` (reuse its existing `sh`, `make_repo`, `good_report` helpers and its established invocation pattern for running `GATE`):

```python
def test_preexisting_dirt_passes_with_note(tmp_path):
    """Dirt recorded in DIRTY_SNAPSHOT predates the run — the gate must not
    block on it or accuse a role (2026-07-03 distill: stash-dance class)."""
    repo, head = make_repo(tmp_path)
    (repo / "operator-notes.md").write_text("deliberately uncommitted\n")
    sh(["bash", str(SCRIPTS / "run_lock.sh"), "snapshot"], cwd=repo)
    report = tmp_path / "report.json"
    report.write_text(json.dumps(good_report(head)))
    r = sh([sys.executable, str(GATE), "--run-id", "wf_test",
            "--branch", "ultra/int", "--report", str(report),
            "--repo", str(repo)], check=False)
    out = json.loads(r.stdout)
    clean = [c for c in out["checks"] if c["name"] == "clean-tree"][0]
    assert clean["ok"] is True
    assert "pre-existing" in clean["detail"]
    assert r.returncode in (0, 2)


def test_new_dirt_still_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    sh(["bash", str(SCRIPTS / "run_lock.sh"), "snapshot"], cwd=repo)
    (repo / "smuggled.py").write_text("appeared after snapshot\n")
    report = tmp_path / "report.json"
    report.write_text(json.dumps(good_report(head)))
    r = sh([sys.executable, str(GATE), "--run-id", "wf_test",
            "--branch", "ultra/int", "--report", str(report),
            "--repo", str(repo)], check=False)
    out = json.loads(r.stdout)
    clean = [c for c in out["checks"] if c["name"] == "clean-tree"][0]
    assert clean["ok"] is False
    assert "smuggled.py" in clean["detail"]
    assert r.returncode == 1


def test_no_snapshot_falls_back_strict(tmp_path):
    """Runs launched before Task 2 have no DIRTY_SNAPSHOT: every dirt line
    blocks, exactly the old behavior (fail-closed)."""
    repo, head = make_repo(tmp_path)
    (repo / "any.txt").write_text("dirt\n")
    report = tmp_path / "report.json"
    report.write_text(json.dumps(good_report(head)))
    r = sh([sys.executable, str(GATE), "--run-id", "wf_test",
            "--branch", "ultra/int", "--report", str(report),
            "--repo", str(repo)], check=False)
    out = json.loads(r.stdout)
    clean = [c for c in out["checks"] if c["name"] == "clean-tree"][0]
    assert clean["ok"] is False
    assert r.returncode == 1


def test_verdict_echoes_repo_and_lock_context(tmp_path):
    """A wrong-cwd invocation must be self-diagnosing (2026-07-03 distill:
    mislocated gate_check produced a spurious BLOCKED)."""
    repo, head = make_repo(tmp_path)
    report = tmp_path / "report.json"
    report.write_text(json.dumps(good_report(head)))
    r = sh([sys.executable, str(GATE), "--run-id", "wf_test",
            "--branch", "ultra/int", "--report", str(report),
            "--repo", str(repo)], check=False)
    out = json.loads(r.stdout)
    assert out["repo"] == str(repo.resolve())
    assert out["lock"].endswith(".claude/ultrapowers/RUN_LOCK")
```

Note: `make_repo` acquires the lock and leaves the checkout clean, so tests that need pre-existing dirt create it BEFORE calling `snapshot`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_gate_check.py -v -k "preexisting or new_dirt or falls_back or echoes"`
Expected: `test_preexisting_dirt_passes_with_note` and `test_verdict_echoes_repo_and_lock_context` FAIL; the other two PASS against current behavior (keep them — they pin the fallback and the block)

- [ ] **Step 3: Implement new-dirt-only + context echo**

In `skills/ultrapowers/scripts/gate_check.py`:

Replace `emit` with a context-carrying version:

```python
def emit(checks, acks, context=None):
    blocked = any(not c["ok"] for c in checks)
    verdict = "BLOCKED" if blocked else ("NEEDS_ACK" if acks else "PASS")
    out = {"verdict": verdict, "checks": checks, "acks": acks}
    out.update(context or {})
    print(json.dumps(out, indent=2))
    return 1 if blocked else (2 if acks else 0)
```

In `main`, right after parsing args, build the context and thread it into **both** `emit` call sites (the early report-parse bail and the final return):

```python
    context = {"repo": str(a.repo.resolve()),
               "lock": str((a.repo / ".claude/ultrapowers/RUN_LOCK").resolve())}
```

Replace the clean-tree block with:

```python
    r = sh(["git", "status", "--porcelain"], cwd=a.repo)
    lines = {l for l in r.stdout.splitlines() if l.strip()}
    snap = a.repo / ".claude/ultrapowers/DIRTY_SNAPSHOT"
    baseline = ({l for l in snap.read_text().splitlines() if l.strip()}
                if snap.is_file() else set())
    new_dirt = sorted(lines - baseline)
    preexisting = sorted(lines & baseline)
    ok = r.returncode == 0 and not new_dirt
    if not ok:
        detail = ("dirt appeared after the pre-launch snapshot — a role wrote "
                  "outside the worktree discipline (#32); that work is "
                  "unreviewed by construction:\n" + "\n".join(new_dirt))
    elif preexisting:
        detail = ("pre-existing dirt carried through from before launch, not "
                  "gate-relevant: " +
                  ", ".join(p.split(None, 1)[-1] for p in preexisting))
    else:
        detail = ""
    check("clean-tree", ok, detail)
```

Also update the module docstring's fail-closed paragraph with one sentence: "The clean-tree check compares against the dirty set recorded at snapshot time (`DIRTY_SNAPSHOT`); with no snapshot it treats all dirt as new."

- [ ] **Step 4: Run the full gate test file**

Run: `python3 -m pytest tests/test_gate_check.py -v`
Expected: all PASS (existing tests used a clean tree with no DIRTY_SNAPSHOT, so their behavior is unchanged)

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/gate_check.py tests/test_gate_check.py
git commit -m "feat(gate): clean-tree blocks on new dirt only; verdict echoes repo/lock context"
```

---

### Task 4: `ultra_run.py` — the pre-launch driver

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Create: `skills/ultrapowers/scripts/ultra_run.py`
- Test: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: the launch file's pre-emitted per-task tier slots (Task 1); the lock actor's verbs, including the dirty-set-recording snapshot (Task 2)
- Produces: `ultra_run.py <plan> [--stamp S] [--repo P]` — runs every deterministic pre-launch stage fail-closed and writes `.claude/ultrapowers/run-<stamp>/receipt.json` with shape `{ok, stamp, lockId, stages[], compile, launchFile, argsFile, baseBranch, workflowName, probe: {name, args, assert}, llmDerives[]}`; exit 0 iff all stages passed

**Parallelization rationale:** disjoint new file beside Task 3's gate work — the pre-launch and gate halves of the driver share no files and only the Task-1/2 contracts.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_ultra_run.py`:

```python
"""ultra_run.py: the deterministic pre-launch driver (SKILL.md Steps 1-4b).
Every stage is exercised against a throwaway git repo; the receipt and exit
code are the contract the orchestrator consumes."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
RUN = SCRIPTS / "ultra_run.py"

PLAN = (
    "# P\n\n**Acceptance:** waived — test fixture\n\n"
    "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
    "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n\n"
    "### Task 2: B\n\n**Type:** implementation\n**Depends-on:** 1\n\n"
    "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1: do**\n"
)


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / ".gitignore").write_text(".claude/\n")
    (repo / "plan.md").write_text(PLAN)
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def run_driver(repo, *extra):
    return sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1", *extra],
              cwd=repo, check=False)


def test_happy_path_receipt(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is True
    assert receipt["lockId"] == "t1"          # the stamp IS the lock id
    assert all(s["ok"] for s in receipt["stages"])
    stage_names = [s["stage"] for s in receipt["stages"]]
    for expected in ("git-repo", "worktree-probe", "engine-skew",
                     "superpowers-compat", "compile", "install",
                     "lock", "snapshot"):
        assert expected in stage_names
    run_dir = repo / ".claude/ultrapowers/run-t1"
    assert (run_dir / "receipt.json").is_file()
    assert (run_dir / "launch.json").is_file()
    assert (run_dir / "args.json").is_file()
    # Task-1 contract: tier slots pre-emitted, named in llmDerives
    launch = json.loads((run_dir / "launch.json").read_text())
    assert all(t["tier"] is None for t in launch["tasks"])
    assert any("tier" in d for d in receipt["llmDerives"])
    # lock + snapshot actually happened, with the dirty set recorded
    assert (repo / ".claude/ultrapowers/RUN_LOCK").read_text() == "t1"
    assert (repo / ".claude/ultrapowers/DIRTY_SNAPSHOT").is_file()
    # probe contract pre-computed for the orchestrator
    assert receipt["probe"]["assert"] == {"echoWaves": 1, "echoFirstId": "probe-1"}
    assert receipt["workflowName"] == "ultrapowers-run"


def test_not_a_git_repo_fails_first_stage(tmp_path):
    bare = tmp_path / "not-a-repo"
    bare.mkdir()
    (bare / "plan.md").write_text(PLAN)
    r = sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1"],
           cwd=bare, check=False)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    assert receipt["stages"][-1]["stage"] == "git-repo"


def test_held_lock_fails_lock_stage(tmp_path):
    repo = make_repo(tmp_path)
    sh(["bash", str(SCRIPTS / "run_lock.sh"), "acquire", "other-run"], cwd=repo)
    r = run_driver(repo)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["stages"][-1]["stage"] == "lock"
    assert receipt["stages"][-1]["ok"] is False


def test_uncompilable_plan_fails_compile_stage(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "plan.md").write_text("# not a plan\n\nno tasks here\n")
    r = run_driver(repo)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["stages"][-1]["stage"] == "compile"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_run.py -v`
Expected: all FAIL (`ultra_run.py` does not exist)

- [ ] **Step 3: Implement the driver**

Create `skills/ultrapowers/scripts/ultra_run.py`:

```python
#!/usr/bin/env python3
"""Deterministic pre-launch driver for /ultrapowers (SKILL.md Steps 1-4b).

One invocation runs every deterministic pre-launch stage in order, fail-closed:
git-repo check, worktree-capability probe, self-host engine skew, superpowers
compatibility, plan compile, committed-workflow install, run lock + checkout
snapshot, and deterministic knob derivation (baseBranch, probe payload).

The receipt (stdout + .claude/ultrapowers/run-<stamp>/receipt.json) is the
contract: the orchestrator reads it instead of re-deriving the choreography
from prose. The stamp is the lock id for the whole run; wf_<runId> is used
only for worktree sweeps. Exit 0 iff every stage passed; otherwise the last
receipt stage names what failed. The driver never launches the workflow —
only the orchestrator can call tools; `llmDerives` names exactly what it
still owns."""
from __future__ import annotations

import argparse
import datetime
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESSES = HERE.parent / "harnesses"
PLUGIN_ROOT = HERE.parents[2]

PROBE = {"name": "ultrapowers-probe",
         "args": {"ping": "pong",
                  "waves": [{"id": "probe-1", "title": "probe", "body": "b"}]},
         "assert": {"echoWaves": 1, "echoFirstId": "probe-1"}}

LLM_DERIVES = [
    "tasks[].tier in the launch file (slots pre-emitted as null; never a "
    "top-level launch key, never tierOverrides, which remaps tier names to models)",
    "testCmd — run-wide and/or per-task, only when detection would guess wrong",
    "bootstrapCmd — per-worktree dependency install for fresh worktrees",
    "review-depth overrides (task.review) only as deliberate exceptions",
]


def sh(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", type=Path)
    ap.add_argument("--stamp", default=None)
    ap.add_argument("--repo", type=Path, default=Path.cwd())
    a = ap.parse_args(argv)
    stamp = a.stamp or datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

    stages = []
    receipt = {"ok": False, "stamp": stamp, "stages": stages}

    def stage(name, ok, detail=""):
        stages.append({"stage": name, "ok": bool(ok),
                       "detail": str(detail).strip()[-2000:]})
        return bool(ok)

    def bail():
        print(json.dumps(receipt, indent=2))
        return 1

    r = sh(["git", "rev-parse", "--show-toplevel"], cwd=a.repo)
    if not stage("git-repo", r.returncode == 0,
                 r.stderr or "not inside a git repository"):
        return bail()
    root = Path(r.stdout.strip())
    state_dir = root / ".claude/ultrapowers"
    run_dir = state_dir / ("run-" + stamp)

    # Worktree capability: the one thing every task needs. A session that
    # cannot cut worktrees fails HERE for pennies, not after a full launch.
    probe_wt = state_dir / ("wt-probe-" + stamp)
    r = sh(["git", "worktree", "add", "--detach", str(probe_wt), "HEAD"], cwd=root)
    wt_ok = r.returncode == 0
    if wt_ok:
        sh(["git", "worktree", "remove", "--force", str(probe_wt)], cwd=root)
    if not stage("worktree-probe", wt_ok, r.stderr):
        return bail()

    # Self-host skew: only meaningful when the target repo IS the plugin repo.
    if root.resolve() == PLUGIN_ROOT.resolve():
        r = sh(["bash", str(HERE / "check_engine_skew.sh"),
                str(PLUGIN_ROOT), str(root)])
        out = (r.stdout + r.stderr).strip()
        if "SKEW" in out:
            (root / ".claude/workflows").mkdir(parents=True, exist_ok=True)
            shutil.copy2(HARNESSES / "waves.js",
                         root / ".claude/workflows/waves.js")
            stage("engine-skew", True,
                  "SKEW — repo waves.js copied into .claude/workflows")
        elif not stage("engine-skew", r.returncode == 0, out or "IN_SYNC"):
            return bail()
    else:
        stage("engine-skew", True, "skipped — not self-hosting")

    # Superpowers compatibility: non-zero means a contract token is missing —
    # the orchestrator surfaces the human gate; the driver just fails closed.
    r = sh([sys.executable, str(HERE / "check_superpowers_compat.py")], cwd=root)
    if not stage("superpowers-compat", r.returncode == 0, r.stdout + r.stderr):
        return bail()

    run_dir.mkdir(parents=True, exist_ok=True)
    launch, args_file = run_dir / "launch.json", run_dir / "args.json"
    r = sh([sys.executable, str(HERE / "compile_plan.py"), str(a.plan),
            "--emit-launch", str(launch), "--emit-args", str(args_file)],
           cwd=root)
    if not stage("compile", r.returncode == 0, r.stderr or r.stdout):
        return bail()
    receipt["compile"] = json.loads(r.stdout)

    wf_dir = root / ".claude/workflows"
    wf_dir.mkdir(parents=True, exist_ok=True)
    installed = []
    for manifest in sorted(HARNESSES.glob("*.harness.json")):
        fname = json.loads(manifest.read_text())["file"]
        shutil.copy2(HARNESSES / fname, wf_dir / fname)
        installed.append(fname)
    if not stage("install", bool(installed),
                 "installed: " + ", ".join(installed)):
        return bail()

    r = sh(["bash", str(HERE / "run_lock.sh"), "acquire", stamp], cwd=root)
    if not stage("lock", r.returncode == 0, r.stderr):
        return bail()
    r = sh(["bash", str(HERE / "run_lock.sh"), "snapshot"], cwd=root)
    if not stage("snapshot", r.returncode == 0, r.stderr):
        return bail()

    r = sh(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
           cwd=root)
    if r.returncode == 0 and r.stdout.strip():
        base = r.stdout.strip().split("/", 1)[-1]
    else:  # no remote HEAD (fresh/local repo): the current branch is the base
        base = sh(["git", "branch", "--show-current"], cwd=root).stdout.strip()
    stage("base-branch", bool(base), base or "no branch resolvable")
    if not base:
        return bail()

    receipt.update({"ok": True, "lockId": stamp, "baseBranch": base,
                    "launchFile": str(launch), "argsFile": str(args_file),
                    "workflowName": "ultrapowers-run", "probe": PROBE,
                    "llmDerives": LLM_DERIVES})
    (run_dir / "receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_ultra_run.py -v`
Expected: all PASS. (In the throwaway repos: engine-skew reports "skipped — not self-hosting"; check_superpowers_compat exits 0 with a skip notice when superpowers is not resolvable — both by design.)

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_run.py tests/test_ultra_run.py
git commit -m "feat(driver): ultra_run.py — deterministic pre-launch stages with one receipt"
```

---

### Task 5: `ultra_gate.py` — the gate driver

**Type:** implementation
**Depends-on:** 2, 3, 4

**Files:**
- Create: `skills/ultrapowers/scripts/ultra_gate.py`
- Test: `tests/test_ultra_gate.py`

**Interfaces:**
- Consumes: `run_lock.sh` verbs incl. `restore` (Task 2); `gate_check.py` verdict JSON + exit codes 0/1/2 (Task 3); `run-<stamp>/receipt.json` — `compile.acceptance` `{mode, sealId?, sha256?, reason?}` and `baseBranch` (Task 4)
- Produces: `ultra_gate.py --stamp S --result <path>` — restore → envelope unwrap → save report → gate checks → acceptance administration; writes `run-<stamp>/gate-receipt.json` `{verdict, gateCheck, gateCheckExit, acceptance, reportPath, branch}` and exits 0 PASS / 2 NEEDS_ACK / 1 BLOCKED (acceptance failure forces 1). Verbs `--approve [--wf-run <id>]` (checkout integration branch, sweep, release lock) and `--teardown` (release lock, keep worktrees, print the sweep command)

**Parallelization rationale:** none — serial tail; it consumes all three prior contracts.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_ultra_gate.py`:

```python
"""ultra_gate.py: the deterministic gate driver (SKILL.md Step 5 mechanics).
Runs against a throwaway git repo with a stubbed run_acceptance.sh so
acceptance DISPATCH is tested without a real sealed vault. gate_check.py,
run_lock.sh, and the envelope unwrap are exercised for real."""
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def make_repo(tmp_path, acceptance_mode="waived"):
    """Throwaway repo + a scripts dir where run_acceptance.sh is a stub that
    records its argv and exits 0. Returns (repo, scripts_dir, head)."""
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / ".gitignore").write_text(".claude/\n")
    (repo / "f.txt").write_text("base\n")
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    sh(["git", "checkout", "-qb", "ultra/int"], cwd=repo)
    (repo / "f.txt").write_text("work\n")
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "work"], cwd=repo)
    head = sh(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip()
    sh(["git", "checkout", "-q", "main"], cwd=repo)

    scripts = tmp_path / "scripts"
    scripts.mkdir()
    for f in ("ultra_gate.py", "gate_check.py", "run_lock.sh",
              "sweep_worktrees.sh"):
        shutil.copy2(SCRIPTS / f, scripts / f)
    (scripts / "run_acceptance.sh").write_text(
        "#!/usr/bin/env bash\necho \"STUB $@\"\nexit 0\n")
    (scripts / "run_acceptance.sh").chmod(0o755)

    # the pre-launch state ultra_run would have left behind
    sh(["bash", str(scripts / "run_lock.sh"), "acquire", "t1"], cwd=repo)
    sh(["bash", str(scripts / "run_lock.sh"), "snapshot"], cwd=repo)
    run_dir = repo / ".claude/ultrapowers/run-t1"
    run_dir.mkdir(parents=True)
    acceptance = {"waived": {"mode": "waived", "reason": "test"},
                  "sealed": {"mode": "sealed", "sealId": "abc123",
                             "sha256": "d" * 64},
                  "suite": {"mode": "suite", "reason": "test"}}[acceptance_mode]
    (run_dir / "receipt.json").write_text(json.dumps(
        {"ok": True, "stamp": "t1", "baseBranch": "main",
         "compile": {"acceptance": acceptance}}))
    return repo, scripts, head


def good_report(head):
    return {"integrationBranch": "ultra/int", "waves": [["1"]],
            "tasks": [{"task": "1", "status": "done"}],
            "tests": {"command": "true", "passed": True},
            "unfinished": [], "gitVerified": True,
            "waveMerges": [{"wave": 1, "status": "MERGED", "headSha": head}],
            "coverage": {"tasks_merged": 1, "tasks_planned": 1, "complete": True}}


def run_gate(repo, scripts, result_path):
    return sh([sys.executable, str(scripts / "ultra_gate.py"),
               "--stamp", "t1", "--result", str(result_path)],
              cwd=repo, check=False)


def test_envelope_unwrap_and_pass(tmp_path):
    """Gate fields live under result.* in the Workflow envelope — the driver
    unwraps; the orchestrator never probes the top level again."""
    repo, scripts, head = make_repo(tmp_path)
    envelope = {"summary": "done", "agentCount": 3, "logs": [],
                "result": good_report(head)}
    result = tmp_path / "result.json"
    result.write_text(json.dumps(envelope))
    r = run_gate(repo, scripts, result)
    out = json.loads(r.stdout)
    assert r.returncode == 0, r.stdout + r.stderr
    assert out["verdict"] == "PASS"
    assert out["branch"] == "ultra/int"
    saved = repo / ".claude/ultrapowers/run-t1/report.json"
    assert json.loads(saved.read_text())["integrationBranch"] == "ultra/int"
    assert out["acceptance"]["disposition"] == "waived"


def test_bare_report_also_accepted(tmp_path):
    repo, scripts, head = make_repo(tmp_path)
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    assert r.returncode == 0
    assert json.loads(r.stdout)["verdict"] == "PASS"


def test_sealed_acceptance_dispatch(tmp_path):
    """Sealed disposition invokes run_acceptance.sh with sealId, branch, hash."""
    repo, scripts, head = make_repo(tmp_path, acceptance_mode="sealed")
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    out = json.loads(r.stdout)
    assert out["acceptance"]["disposition"] == "sealed"
    assert "abc123 ultra/int " + "d" * 64 in out["acceptance"]["output"]
    assert r.returncode == 0


def test_suite_acceptance_dispatch(tmp_path):
    """Suite disposition invokes the suite-gate with the report's test command
    and the receipt's baseBranch."""
    repo, scripts, head = make_repo(tmp_path, acceptance_mode="suite")
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    out = json.loads(r.stdout)
    assert out["acceptance"]["disposition"] == "suite"
    assert "--suite-gate" in out["acceptance"]["output"]
    assert "--base main" in out["acceptance"]["output"]


def test_failed_acceptance_forces_blocked(tmp_path):
    repo, scripts, head = make_repo(tmp_path, acceptance_mode="sealed")
    (scripts / "run_acceptance.sh").write_text(
        "#!/usr/bin/env bash\necho RED\nexit 1\n")
    (scripts / "run_acceptance.sh").chmod(0o755)
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    assert r.returncode == 1
    assert json.loads(r.stdout)["verdict"] == "BLOCKED"


def test_gate_check_blocked_propagates(tmp_path):
    repo, scripts, head = make_repo(tmp_path)
    report = good_report(head)
    report["gitVerified"] = False        # trips the git-verified check
    result = tmp_path / "result.json"
    result.write_text(json.dumps(report))
    r = run_gate(repo, scripts, result)
    assert r.returncode == 1
    assert json.loads(r.stdout)["verdict"] == "BLOCKED"


def test_unrecognizable_result_is_blocked(tmp_path):
    repo, scripts, _ = make_repo(tmp_path)
    result = tmp_path / "result.json"
    result.write_text(json.dumps({"nonsense": True}))
    r = run_gate(repo, scripts, result)
    assert r.returncode == 1
    assert json.loads(r.stdout)["verdict"] == "BLOCKED"


def test_teardown_releases_lock_keeps_worktrees(tmp_path):
    repo, scripts, _ = make_repo(tmp_path)
    r = sh([sys.executable, str(scripts / "ultra_gate.py"),
            "--stamp", "t1", "--teardown"], cwd=repo, check=False)
    assert r.returncode == 0
    out = json.loads(r.stdout)
    assert out["lockReleased"] is True
    assert "sweep" in out
    assert not (repo / ".claude/ultrapowers/RUN_LOCK").exists()


def test_approve_checks_out_branch_and_releases(tmp_path):
    repo, scripts, _ = make_repo(tmp_path)
    r = sh([sys.executable, str(scripts / "ultra_gate.py"),
            "--stamp", "t1", "--approve", "--branch", "ultra/int"],
           cwd=repo, check=False)
    assert r.returncode == 0, r.stdout + r.stderr
    cur = sh(["git", "branch", "--show-current"], cwd=repo).stdout.strip()
    assert cur == "ultra/int"
    assert not (repo / ".claude/ultrapowers/RUN_LOCK").exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_gate.py -v`
Expected: all FAIL (`ultra_gate.py` does not exist)

- [ ] **Step 3: Implement the driver**

Create `skills/ultrapowers/scripts/ultra_gate.py`:

```python
#!/usr/bin/env python3
"""Deterministic gate driver for /ultrapowers (SKILL.md Step 5 mechanics).

Gate mode (--result): restore the pre-launch checkout, unwrap the Workflow
tool envelope (gate fields live under result.* — report-format.md), save the
report verbatim, run gate_check.py, then administer acceptance per the
disposition recorded in the ultra_run receipt. Exit 0 PASS / 2 NEEDS_ACK /
1 BLOCKED; a failed acceptance always forces 1. The driver never decides —
the orchestrator renders the receipt and owns Approve/Salvage/Redirect.

--approve: checkout the integration branch, sweep worktrees (when --wf-run
is given), release the lock. --teardown: release the lock on any terminal
non-relaunch exit, keeping worktrees as triage evidence."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def sh(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def unwrap(payload):
    """Accept the Workflow envelope ({... result: {report}}) or a bare report."""
    if isinstance(payload, dict):
        inner = payload.get("result")
        if isinstance(inner, dict) and "integrationBranch" in inner:
            return inner
        if "integrationBranch" in payload:
            return payload
    return None


def blocked(receipt, detail):
    receipt.update({"verdict": "BLOCKED", "detail": detail})
    print(json.dumps(receipt, indent=2))
    return 1


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--stamp", required=True)
    ap.add_argument("--result", type=Path, default=None)
    ap.add_argument("--repo", type=Path, default=Path.cwd())
    ap.add_argument("--branch", default=None,
                    help="integration branch override (approve mode, or when "
                         "the report field is absent)")
    ap.add_argument("--approve", action="store_true")
    ap.add_argument("--teardown", action="store_true")
    ap.add_argument("--wf-run", default=None,
                    help="wf_<runId> transcript stem for the worktree sweep")
    a = ap.parse_args(argv)

    r = sh(["git", "rev-parse", "--show-toplevel"], cwd=a.repo)
    if r.returncode != 0:
        return blocked({"stamp": a.stamp}, "not inside a git repository")
    root = Path(r.stdout.strip())
    run_dir = root / ".claude/ultrapowers" / ("run-" + a.stamp)
    lock = ["bash", str(HERE / "run_lock.sh")]

    if a.teardown:
        r = sh(lock + ["release", a.stamp], cwd=root)
        out = {"mode": "teardown", "stamp": a.stamp,
               "lockReleased": r.returncode == 0,
               "sweep": "bash " + str(HERE / "sweep_worktrees.sh") +
                        " --run <wf-runId>  # worktrees kept as triage evidence"}
        print(json.dumps(out, indent=2))
        return 0 if r.returncode == 0 else 1

    if a.approve:
        branch = a.branch
        report_file = run_dir / "report.json"
        if not branch and report_file.is_file():
            branch = json.loads(report_file.read_text()).get("integrationBranch")
        if not branch:
            return blocked({"mode": "approve", "stamp": a.stamp},
                           "no integration branch (--branch or saved report)")
        r = sh(["git", "checkout", branch], cwd=root)
        if r.returncode != 0:
            return blocked({"mode": "approve", "stamp": a.stamp}, r.stderr)
        swept = None
        if a.wf_run:
            swept = sh(["bash", str(HERE / "sweep_worktrees.sh"),
                        "--run", a.wf_run], cwd=root).stdout.strip()
        rel = sh(lock + ["release", a.stamp], cwd=root)
        out = {"mode": "approve", "stamp": a.stamp, "branch": branch,
               "swept": swept, "lockReleased": rel.returncode == 0}
        print(json.dumps(out, indent=2))
        return 0 if rel.returncode == 0 else 1

    # ── gate mode ─────────────────────────────────────────────────────────
    receipt = {"mode": "gate", "stamp": a.stamp}
    if a.result is None:
        return blocked(receipt, "--result <workflow result JSON> is required")

    r = sh(lock + ["restore"], cwd=root)
    if r.returncode != 0:
        return blocked(receipt, "checkout restore failed: " + r.stderr)

    try:
        payload = json.loads(a.result.read_text())
    except Exception as e:
        return blocked(receipt, "result unreadable: " + str(e))
    report = unwrap(payload)
    if report is None:
        return blocked(receipt, "result carries no report (neither top-level "
                                "nor under result.*) — do not Approve")
    run_dir.mkdir(parents=True, exist_ok=True)
    report_path = run_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2))
    branch = a.branch or report.get("integrationBranch")
    receipt.update({"reportPath": str(report_path), "branch": branch})

    r = sh([sys.executable, str(HERE / "gate_check.py"),
            "--run-id", a.stamp, "--branch", str(branch),
            "--report", str(report_path), "--repo", str(root)], cwd=root)
    try:
        gate = json.loads(r.stdout)
    except Exception:
        gate = {"verdict": "BLOCKED", "checks": [], "acks": [],
                "detail": "gate_check emitted no JSON: " + r.stderr}
    receipt.update({"gateCheck": gate, "gateCheckExit": r.returncode})

    # Acceptance, per the disposition ultra_run recorded at compile time.
    run_receipt = {}
    receipt_file = run_dir / "receipt.json"
    if receipt_file.is_file():
        run_receipt = json.loads(receipt_file.read_text())
    acc = (run_receipt.get("compile") or {}).get("acceptance") or {}
    mode = acc.get("mode")
    if mode == "sealed":
        r = sh(["bash", str(HERE / "run_acceptance.sh"),
                str(acc.get("sealId")), str(branch), str(acc.get("sha256"))],
               cwd=root)
        acceptance = {"disposition": "sealed", "exit": r.returncode,
                      "output": (r.stdout + r.stderr)[-4000:]}
        acc_pass = r.returncode == 0
    elif mode == "waived":
        acceptance = {"disposition": "waived", "exit": None,
                      "reason": acc.get("reason", "")}
        acc_pass = True
    else:  # 'suite' and unmarked both bind acceptance to the committed suite
        test_cmd = (report.get("tests") or {}).get("command") or ""
        r = sh(["bash", str(HERE / "run_acceptance.sh"), "--suite-gate",
                "--branch", str(branch), "--run", test_cmd,
                "--base", run_receipt.get("baseBranch", "main")], cwd=root)
        acceptance = {"disposition": "suite", "exit": r.returncode,
                      "output": (r.stdout + r.stderr)[-4000:]}
        acc_pass = r.returncode == 0
    receipt["acceptance"] = acceptance

    gate_exit = receipt["gateCheckExit"]
    if gate_exit == 1 or gate.get("verdict") == "BLOCKED" or not acc_pass:
        receipt["verdict"] = "BLOCKED"
        code = 1
    elif gate_exit == 2:
        receipt["verdict"] = "NEEDS_ACK"
        code = 2
    else:
        receipt["verdict"] = "PASS"
        code = 0
    (run_dir / "gate-receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt, indent=2))
    return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # any unexpected fault fails closed
        print(json.dumps({"verdict": "BLOCKED",
                          "detail": "internal: " + str(e)}))
        sys.exit(1)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_ultra_gate.py tests/test_gate_check.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_gate.py tests/test_ultra_gate.py
git commit -m "feat(driver): ultra_gate.py — envelope unwrap, gate checks, acceptance, approve/teardown"
```

---

### Task 6: Re-layer SKILL.md onto the drivers

**Type:** implementation
**Depends-on:** 4, 5

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultralearn/complexity-baseline.json`
- Test: `tests/test_path_variables.py` (and any other SKILL.md-pinning test that the full suite shows red — reconcile each pin to the new prose while preserving its pinned semantics; known SKILL.md-grepping tests include `tests/test_compat_skill_wiring.py`, `tests/test_report_runbook.py`, `tests/test_salvage_gate.py`, `tests/test_literal_trace_selfreview.py`, `tests/test_cross_phase_review.py`, `tests/test_finishing_notes.py`, `tests/test_check_superpowers_compat.py`, `tests/test_merge_ledger.py`, `tests/test_gate_check.py`)

**Interfaces:**
- Consumes: `ultra_run.py` receipt contract (Task 4), `ultra_gate.py` receipt + verbs (Task 5)
- Produces: the operator manual routed through the two drivers; `skillWords` < 1997 and `standingConcepts` ≤ 62 in the regenerated baseline

**Parallelization rationale:** none — serial tail; it documents the two drivers.

- [ ] **Step 1: Rewrite Steps 1–5 around the drivers**

Replace the bodies of Step 1, Step 2's mechanics, Step 4's sub-steps 4a/4a½/4b, and Step 5's sub-steps 1–4 so the deterministic mechanics live in one driver call each. The Workflow-tool preflight (a ToolSearch action) and all judgment guidance stay prose. Target shape (adapt wording to the file's voice; keep every `*Rationale:*` pointer that still applies):

**Step 1 — Preflight, compile & lock (deterministic):**

````markdown
**Workflow-tool preflight.** The Workflow tool is absent on some surfaces (e.g.
the web). Check for it (ToolSearch `select:Workflow`). If unavailable, go to
Step 6 — do not analyze dependencies.

**Run the pre-launch driver:**

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_run.py <plan> --stamp <stamp>
```

One call runs every deterministic stage fail-closed — git-repo check,
worktree-capability probe, self-host engine skew, superpowers compatibility,
compile (`--emit-launch`/`--emit-args`), committed-workflow install, run lock +
checkout snapshot, baseBranch derivation — and writes the receipt to
`.claude/ultrapowers/run-<stamp>/receipt.json`. **Exit 0** → read the receipt and
continue. **Non-zero** → the last stage names the failure: `superpowers-compat` →
STOP and surface the human gate quoting the missing tokens; `lock` → another run
holds this repo, serialize; `worktree-probe`/`git-repo` → fix the environment
(a repo that cannot cut worktrees cannot run waves); `compile` → fix the plan.
The stamp is the lock id for the whole run; `wf_<runId>` is only for sweeps.
````

**Step 2 — Judge and fill (LLM-owned):** keep the classification prose (markers, heuristic entries, dispositions) and the knob-derivation guidance, but the knobs now land in named slots: per-task `tier` is filled **in the receipt's `launchFile`** (slots pre-emitted as `null`); `testCmd`/`bootstrapCmd`/review overrides ride the launch args. The receipt's `llmDerives` list is the checklist.

**Step 4 — Launch:** delete 4a and 4b (the driver installed workflows, acquired the lock, and snapshotted). Keep 4a½'s probe as prose but source its payload and assertions from `receipt.probe` (launch `receipt.probe.name` with `receipt.probe.args`, assert `receipt.probe.assert`; the not-found/mismatch branching text stays). Keep 4c (launch `receipt.workflowName` with the `argsFile` skeleton plus derived knobs) and the viewer offer.

**Step 5 — Pre-merge gate:** replace sub-steps 1–4 with:

````markdown
**Run the gate driver** on the Workflow tool's raw result JSON (saved verbatim
to a file — the driver unwraps the envelope itself; gate fields live under
`result.*`):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_gate.py \
  --stamp <stamp> --result <saved-result.json>
```

It restores the pre-launch checkout, saves the report, runs `gate_check.py`
(clean-tree blocks only on dirt NEW since the snapshot; pre-existing operator
files pass with a note), and administers acceptance per the compiled
disposition — sealed exam, suite gate, or verbatim waiver. Exit code is the
authority: **0 (PASS)** → render and offer Approve; **2 (NEEDS_ACK)** → present
the acks for explicit operator acknowledgement first; **1 (BLOCKED)** → present
the failing checks, do NOT Approve.
````

and rewrite the Approve/teardown mechanics to the verbs: Approve → `ultra_gate.py --approve --stamp <stamp> --wf-run <wf_runId>` then the holistic-review/finishing handoff prose (unchanged); every terminal non-relaunch exit → `ultra_gate.py --teardown --stamp <stamp>` (replaces the bare release command; worktrees stay as triage evidence). Salvage/Redirect prose is unchanged.

- [ ] **Step 2: Validate the skill and reconcile pins**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: `skill ok`

Run: `python3 -m pytest -q`
Expected: some SKILL.md-pinning tests fail on moved phrases. For each failure, update the pin to the new prose **preserving what it pins** (e.g. a pin asserting the compat human-gate wording now matches the Step-1 failure-branch text; a pin asserting the sweep/release commands now matches the `--approve`/`--teardown` verbs). Do not delete a pin; re-point it.

- [ ] **Step 3: Regenerate the complexity baseline and assert the ratchet went down**

```bash
python3 skills/ultralearn/scripts/complexity_metric.py > skills/ultralearn/complexity-baseline.json
python3 -m pytest tests/test_complexity_ratchet.py tests/test_complexity_metric.py -q
python3 - <<'EOF'
import json
b = json.load(open("skills/ultralearn/complexity-baseline.json"))
assert b["skillWords"] < 1997, f"SKILL.md grew: {b['skillWords']} words"
assert b["standingConcepts"] <= 62, f"concepts rose: {b['standingConcepts']}"
print("ratchet DOWN:", b["skillWords"], "words,", b["standingConcepts"], "concepts")
EOF
```

Expected: both assertions pass — the re-layer must shrink the manual, not grow it.

- [ ] **Step 4: Full suite**

Run: `python3 -m pytest -q`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultralearn/complexity-baseline.json tests/
git commit -m "refactor(skill): SKILL.md re-layered onto ultra_run/ultra_gate drivers; ratchet down"
```

---

### Task 7: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6

**Files:**
- none

- [ ] **Step 1: Run the full gate**

Run: `python3 -m pytest -q && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn`
Expected: suite green (≥ 489 + the new tests), `skill ok` × 3
