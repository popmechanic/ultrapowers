# Gate Mechanization and SKILL.md Re-layer Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — ultrapowers engine/skill/script development; the committed suite, drift pins, and per-task review are the verification.

**Goal:** Move gate authority from prose to exit codes, fix two verified compiler bugs, retire the false-confidence test tail, and shrink the operator skill to a lean core.

**Architecture:** Composable scripts in the existing exit-code-authority family: two targeted compiler fixes plus a `--emit-args` launch assembler in the compiler; a new `gate_check.py` performing the mechanical Step-5 checks; three robustness fixes to the acceptance runner; sim-first test cleanup; and a final single-writer rewrite of the operator SKILL.md around the new scripts, with maintainer rationale relocated to a reference.

**Tech Stack:** Python 3 (stdlib only), bash, Node 22 (`.mjs` sims), pytest.

**Spec:** `docs/superpowers/specs/2026-07-02-gate-mechanization-and-skill-relayer-design.md`

## Global Constraints

- Every new gate surface fails closed and emits a JSON receipt; exit codes are the authority, never model-relayed values where a git command can check ground truth.
- No `anthropic` SDK and no `ANTHROPIC_API_KEY` in any shipped or dev script.
- `python3 -m pytest` remains the single suite command; the suite is green after every task's own diff.
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` prints `skill ok` after every task that touches the skill.
- The rewritten `skills/ultrapowers/SKILL.md` must be under 500 lines and at most 2,000 words (`wc -l` / `wc -w`).
- Shell must run on both macOS (dev) and ubuntu-latest (CI): no GNU-only flags.

---

### Task 1: Compiler correctness — uppercase-extension paths and the heading net

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan.py`

- [ ] **Step 1: Write four failing tests** (append to `tests/test_compile_plan.py`; use the file's existing `compile_plan` / `compile_plan_raw` helpers):

```python
def test_uppercase_extension_paths_serialize_same_file_writers(tmp_path):
    """Fable review HIGH finding: `Config.YAML` (uppercase ext, no slash) was
    dropped from write-sets, so two tasks modifying it waved in parallel."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: Upper\n\n**Acceptance:** waived — inline\n\n"
        "### Task A: writer one\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `Config.YAML`\n- Modify: `a_only.py`\n\n"
        "- [ ] **Step 1:** edit config\n\n"
        "### Task B: writer two\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `Config.YAML`\n- Modify: `b_only.py`\n\n"
        "- [ ] **Step 1:** edit config again\n")
    out = compile_plan(plan)
    a = next(t for t in out["tasks"] if t["id"] == "A")
    b = next(t for t in out["tasks"] if t["id"] == "B")
    assert "Config.YAML" in a["writes"] and "Config.YAML" in b["writes"]
    assert any(e["from"] == "A" and e["to"] == "B" and e["why"] == "write-after-write"
               for e in out["dag_edges"])
    assert out["waves"] == [["A"], ["B"]]


def test_mixed_case_attr_ref_still_dropped_from_files(tmp_path):
    """`schema.User` in a Files entry is an identifier, not a path — it must
    stay dropped (surfaced as a near-miss), or it fabricates overlap edges."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: Attr\n\n**Acceptance:** waived — inline\n\n"
        "### Task A: uses attr ref\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `schema.User`\n- Modify: `real.py`\n\n"
        "- [ ] **Step 1:** work\n")
    out = compile_plan(plan)
    a = next(t for t in out["tasks"] if t["id"] == "A")
    assert a["writes"] == ["real.py"]
    assert any("schema.User" in c["note"] for c in out["marker_conflicts"])


def test_prose_section_heading_with_task_word_and_colon_compiles(tmp_path):
    """Fable review MEDIUM finding: `## Task tracking: overview` refused the
    whole plan with a misleading three-hashes hint."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: Sections\n\n**Acceptance:** waived — inline\n\n"
        "### Task A: real work\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `a.py`\n\n- [ ] **Step 1:** work\n\n"
        "## Task tracking: overview\n\nprose about tracking\n\n"
        "## Task list: what remains\n\nmore prose\n")
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["A"]


def test_wrong_level_task_id_heading_still_refuses(tmp_path):
    """The heading net must keep catching genuinely mis-leveled task headings —
    `## Task 2:` folds its content into the previous task silently."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: Bad level\n\n**Acceptance:** waived — inline\n\n"
        "### Task 1: real work\n\n**Files:**\n- Modify: `a.py`\n\n"
        "- [ ] **Step 1:** work\n\n"
        "## Task 2: mis-leveled\n\n**Files:**\n- Modify: `b.py`\n\n"
        "- [ ] **Step 1:** more work\n")
    p = compile_plan_raw(plan)
    assert p.returncode != 0
    assert "not recognized" in p.stderr
```

- [ ] **Step 2: Run them to confirm the failures**

Run: `python3 -m pytest tests/test_compile_plan.py -q -k "uppercase_extension or mixed_case_attr or prose_section_heading or wrong_level_task_id"`
Expected: FAIL on `test_uppercase_extension_paths_serialize_same_file_writers` (writes missing `Config.YAML`) and `test_prose_section_heading_with_task_word_and_colon_compiles` (compiler exits 1); the other two may already pass (they pin behavior that must survive the fix).

- [ ] **Step 3: Fix `_is_pathlike`** in `skills/ultrapowers/scripts/compile_plan.py`. Replace the `EXT_RE` definition and its use:

```python
# Real extensions are 1-8 alphanumerics, matched case-insensitively — but ONLY
# when the extension is all-lowercase (`config.yaml`) or all-uppercase
# (`Config.YAML`, `x.SQL`). A mixed-case tail (`schema.User`, `Foo.Bar`) is a
# dotted attribute reference, not a file. Erring toward "path" is the safe
# direction: a false write-set entry costs parallelism (an extra edge); a
# DROPPED write-set entry lets two tasks modify one file in the same wave.
EXT_RE = re.compile(r"\.([A-Za-z0-9]{1,8})$")
```

and inside `_is_pathlike`, replace the line `if EXT_RE.search(t): return True` with:

```python
    m = EXT_RE.search(t)
    if m:
        ext = m.group(1)
        if ext == ext.lower() or ext == ext.upper():
            return True                   # real extension (any case), not Mixed.Case
```

- [ ] **Step 4: Fix the heading net** in `main()`. Replace the `near_head` definition with:

```python
    # (b)'s token must LOOK like a task id — contain a digit, or be <= 3 chars
    # (`2`, `A3`, `C4b`, `IV`) — so prose section headings whose second word is
    # an English word (`## Task tracking: overview`, `## Task list: …`) compile
    # as section boundaries instead of refusing the plan. Residual ambiguity:
    # a <=3-char word (`## Task ids:`) still flags; retitle such sections.
    near_head = re.compile(
        r"^(#{3,4}\s*task\b|#{1,6}\s*task\s+(?:[^\s:]*\d[^\s:]*|[^\s:]{1,3})\s*:)",
        re.I)
```

- [ ] **Step 5: Run the four tests to verify they pass**

Run: `python3 -m pytest tests/test_compile_plan.py -q -k "uppercase_extension or mixed_case_attr or prose_section_heading or wrong_level_task_id"`
Expected: 4 passed

- [ ] **Step 6: Run the full compiler test file and the whole suite**

Run: `python3 -m pytest tests/test_compile_plan.py -q && python3 -m pytest -q`
Expected: all green (the existing `test_section_titles_with_task_word_stay_legal` and every fixture/plan compile test must still pass)

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "fix(compiler): uppercase-extension paths join write-sets; heading net stops refusing prose Task-word sections"
```

---

### Task 2: gate_check.py — the mechanical Step-5 checks with exit-code authority

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/scripts/gate_check.py`
- Test: `tests/test_gate_check.py`

**Interfaces:**
- Consumes: the run-lock actor's `check <id>` subcommand (exit 0 iff RUN_LOCK holds the id)
- Produces: `gate_check.py --run-id <id> --branch <branch> --report <path> [--repo DIR]` printing one JSON verdict `{"verdict": "PASS"|"NEEDS_ACK"|"BLOCKED", "checks": [{name, ok, detail}], "acks": [{type, detail}]}`; exit 0 = PASS, 2 = NEEDS_ACK, 1 = BLOCKED

- [ ] **Step 1: Write the failing tests** — create `tests/test_gate_check.py`:

```python
"""gate_check.py: the deterministic pre-merge gate checks (SKILL.md Step 5).
Every check is exercised against a throwaway git repo; git is ground truth,
so a corrupted report can only yield BLOCKED, never a false PASS."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
GATE = SCRIPTS / "gate_check.py"


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    # .claude/ holds RUN_LOCK (untracked); ignore it or the clean-tree check
    # sees the lock file itself as dirt — mirrors the real repo's .gitignore.
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
    sh(["bash", str(SCRIPTS / "run_lock.sh"), "acquire", "wf_test"], cwd=repo)
    return repo, head


def good_report(head):
    return {
        "waveMerges": [{"wave": 1, "status": "MERGED", "headSha": head, "branches": ["A"]}],
        "gitVerified": True,
        "ancestryMisses": [],
        "missingDeliverables": [],
        "coverage": {"tasks_merged": 1, "tasks_planned": 1, "complete": True},
        "deferredVerification": [],
    }


def run_gate(repo, report, run_id="wf_test", branch="ultra/int"):
    # The report lives OUTSIDE the repo — an untracked report.json inside it
    # would (correctly) trip the clean-tree check this suite is testing.
    rp = repo.parent / "report.json"
    rp.write_text(json.dumps(report) if isinstance(report, dict) else report)
    p = subprocess.run(
        [sys.executable, str(GATE), "--run-id", run_id, "--branch", branch,
         "--report", str(rp), "--repo", str(repo)],
        capture_output=True, text=True)
    return p, json.loads(p.stdout)


def check_named(out, name):
    return next(c for c in out["checks"] if c["name"] == name)


def test_all_green_is_pass_exit_0(tmp_path):
    repo, head = make_repo(tmp_path)
    p, out = run_gate(repo, good_report(head))
    assert p.returncode == 0 and out["verdict"] == "PASS", p.stdout
    assert all(c["ok"] for c in out["checks"]) and out["acks"] == []


def test_lock_mismatch_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    p, out = run_gate(repo, good_report(head), run_id="wf_other")
    assert p.returncode == 1 and out["verdict"] == "BLOCKED"
    assert not check_named(out, "lock")["ok"]


def test_dirty_tree_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    (repo / "stray.txt").write_text("leak\n")
    p, out = run_gate(repo, good_report(head))
    assert p.returncode == 1 and not check_named(out, "clean-tree")["ok"]
    assert "stray.txt" in check_named(out, "clean-tree")["detail"]


def test_empty_wave_merges_blocks_with_named_guard(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["waveMerges"] = []
    p, out = run_gate(repo, r)
    assert p.returncode == 1
    assert "merge-sha guard unavailable" in check_named(out, "wave-merges")["detail"]


def test_head_mismatch_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["waveMerges"][-1]["headSha"] = "0" * 40
    p, out = run_gate(repo, r)
    assert p.returncode == 1 and not check_named(out, "head-match")["ok"]


def test_unverified_critic_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["gitVerified"] = False
    p, out = run_gate(repo, r)
    assert p.returncode == 1 and not check_named(out, "git-verified")["ok"]


def test_ancestry_miss_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["ancestryMisses"] = [{"task": "A", "headSha": "dead"}]
    p, out = run_gate(repo, r)
    assert p.returncode == 1 and not check_named(out, "ancestry")["ok"]


def test_missing_deliverables_block(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["missingDeliverables"] = [{"task": "B", "files": ["b.py"]}]
    p, out = run_gate(repo, r)
    assert p.returncode == 1 and not check_named(out, "deliverables")["ok"]


def test_incomplete_coverage_needs_ack_exit_2(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["coverage"] = {"tasks_merged": 1, "tasks_planned": 2, "complete": False}
    p, out = run_gate(repo, r)
    assert p.returncode == 2 and out["verdict"] == "NEEDS_ACK"
    assert any(a["type"] == "coverage" for a in out["acks"])


def test_deferred_runtime_needs_ack(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["deferredVerification"] = [
        {"deliverable": "worker deploy", "reason": "runtime", "why": "no deploy target"}]
    p, out = run_gate(repo, r)
    assert p.returncode == 2
    assert any(a["type"] == "deferred:runtime" for a in out["acks"])


def test_malformed_report_blocks(tmp_path):
    repo, _ = make_repo(tmp_path)
    p, out = run_gate(repo, "{not json")
    assert p.returncode == 1 and out["verdict"] == "BLOCKED"
    assert not check_named(out, "report-parse")["ok"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_gate_check.py -q`
Expected: FAIL/ERROR — `gate_check.py` does not exist yet

- [ ] **Step 3: Create `skills/ultrapowers/scripts/gate_check.py`:**

```python
#!/usr/bin/env python3
"""Deterministic pre-merge gate checks for /ultrapowers (SKILL.md Step 5).

The orchestrator saves the workflow's report JSON verbatim to disk and runs
this script; the verdict JSON on stdout and the exit code are the gate.
Exit 0 = PASS, 2 = NEEDS_ACK (operator must acknowledge the listed items
before Approve), 1 = BLOCKED (do not Approve).

Fail-closed by construction: git is the ground truth the report is checked
AGAINST, so a corrupted or hand-edited report can only produce BLOCKED,
never a false PASS. This script does not administer acceptance (that is
run_acceptance.sh, per disposition) and does not release locks or sweep
worktrees (explicit orchestrator actions on this verdict).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def sh(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def emit(checks, acks):
    blocked = any(not c["ok"] for c in checks)
    verdict = "BLOCKED" if blocked else ("NEEDS_ACK" if acks else "PASS")
    print(json.dumps({"verdict": verdict, "checks": checks, "acks": acks}, indent=2))
    return 1 if blocked else (2 if acks else 0)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--branch", required=True)
    ap.add_argument("--report", required=True, type=Path)
    ap.add_argument("--repo", type=Path, default=Path.cwd())
    a = ap.parse_args(argv)

    checks, acks = [], []

    def check(name, ok, detail=""):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})
        return bool(ok)

    try:
        report = json.loads(a.report.read_text())
        if not isinstance(report, dict):
            raise ValueError("report is not a JSON object")
    except Exception as e:  # unreadable, unparseable, wrong shape — all BLOCKED
        check("report-parse", False, "report unreadable or malformed: " + str(e))
        return emit(checks, acks)
    check("report-parse", True)

    r = sh(["bash", str(HERE / "run_lock.sh"), "check", a.run_id], cwd=a.repo)
    check("lock", r.returncode == 0,
          "" if r.returncode == 0 else
          "RUN_LOCK does not hold " + a.run_id +
          " — a concurrent run may have replaced it; do not Approve")

    r = sh(["git", "status", "--porcelain"], cwd=a.repo)
    dirty = r.stdout.strip()
    ok = r.returncode == 0 and not dirty
    check("clean-tree", ok,
          "" if ok else
          "session checkout is dirty — a role wrote outside the worktree "
          "discipline (#32); that work is unreviewed by construction:\n" + dirty)

    wm = report.get("waveMerges")
    shape_ok = (isinstance(wm, list) and wm and isinstance(wm[-1], dict)
                and wm[-1].get("headSha"))
    check("wave-merges", shape_ok,
          "" if shape_ok else
          "merge-sha guard unavailable — result lacks waveMerges[last].headSha "
          "(budget-exhausted or SKIPPED-only run); inspect and redirect/re-run")

    if shape_ok:
        expected = wm[-1]["headSha"]
        r = sh(["git", "rev-parse", "--verify", a.branch], cwd=a.repo)
        actual = r.stdout.strip()
        ok = r.returncode == 0 and actual == expected
        check("head-match", ok,
              "" if ok else
              "integration branch " + a.branch + " is at " +
              (actual or "<unresolvable>") + " but the report recorded " +
              str(expected) + " — the tree on disk is not the one the run "
              "produced (checkout drift, #29)")
    else:
        check("head-match", False, "skipped — no recorded merge headSha to compare")

    check("git-verified", report.get("gitVerified") is True,
          "" if report.get("gitVerified") is True else
          "gitVerified is not true — the completeness critic could not confirm "
          "it reviewed the recorded merge HEAD; the review is unverified")

    misses = report.get("ancestryMisses") or []
    check("ancestry", not misses,
          "" if not misses else
          "tasks reported merged but absent from the integration ancestry "
          "(silent drop, #70): " + json.dumps(misses))

    missing = report.get("missingDeliverables") or []
    check("deliverables", not missing,
          "" if not missing else
          "failed/blocked tasks left declared deliverables unproduced: " +
          json.dumps(missing))

    cov = report.get("coverage") or {}
    if cov.get("complete") is False:
        acks.append({"type": "coverage",
                     "detail": "green suite but " + str(cov.get("tasks_merged")) +
                               "/" + str(cov.get("tasks_planned")) +
                               " tasks merged — a passing suite over an "
                               "incomplete merge is a false-green"})
    for d in (report.get("deferredVerification") or []):
        d = d or {}
        acks.append({"type": "deferred:" + str(d.get("reason", "unknown")),
                     "detail": str(d.get("deliverable", "?")) + " — " +
                               str(d.get("why", "")) +
                               (" [structural false-green: sandbox could not "
                                "execute it against the target]"
                                if d.get("reason") in ("runtime", "external")
                                else "")})
    return emit(checks, acks)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # any unexpected fault fails closed
        print(json.dumps({"verdict": "BLOCKED",
                          "checks": [{"name": "internal", "ok": False,
                                      "detail": str(e)}],
                          "acks": []}))
        sys.exit(1)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_gate_check.py -q`
Expected: 11 passed

- [ ] **Step 5: Run the whole suite**

Run: `python3 -m pytest -q`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/gate_check.py tests/test_gate_check.py
git commit -m "feat(gate): gate_check.py — mechanical Step-5 checks with exit-code authority"
```

---

### Task 3: run_acceptance.sh robustness — temp leak, output truncation, disarmed-guard warning

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Test: `tests/test_run_acceptance.py`

- [ ] **Step 1: Write three failing tests** (append to `tests/test_run_acceptance.py`; reuse its `sh` and `make_repo` helpers):

```python
def test_suite_gate_without_base_warns_disarmed(tmp_path):
    repo = make_repo(tmp_path, feature_built=True)
    p = sh(["bash", str(RUN), "--suite-gate", "--branch", "main",
            "--run", "echo ok", "--repo", str(repo)], check=False)
    assert p.returncode == 0
    assert "harness-JS sim guard disarmed" in p.stderr


def test_suite_gate_with_base_does_not_warn(tmp_path):
    repo = make_repo(tmp_path, feature_built=True)
    p = sh(["bash", str(RUN), "--suite-gate", "--branch", "main",
            "--base", "main", "--run", "echo ok", "--repo", str(repo)],
           check=False)
    assert p.returncode == 0
    assert "disarmed" not in p.stderr


def test_exam_worktree_temp_parent_is_cleaned(tmp_path, monkeypatch):
    repo = make_repo(tmp_path, feature_built=True)
    tdir = tmp_path / "tmpdir"
    tdir.mkdir()
    monkeypatch.setenv("TMPDIR", str(tdir))
    p = sh(["bash", str(RUN), "--suite-gate", "--branch", "main",
            "--run", "echo ok", "--repo", str(repo)], check=False)
    assert p.returncode == 0
    assert list(tdir.iterdir()) == [], "mktemp parent dir leaked"


def test_huge_exam_output_still_emits_json_receipt(tmp_path):
    repo = make_repo(tmp_path, feature_built=True)
    big = "python3 -c \"print('x' * 400000)\""
    p = sh(["bash", str(RUN), "--suite-gate", "--branch", "main",
            "--run", big, "--repo", str(repo)], check=False)
    assert p.returncode == 0
    obj = json.loads(p.stdout)
    assert obj["passed"] is True
    assert len(obj["output"]) <= 8000
```

- [ ] **Step 2: Run to verify the new failures**

Run: `python3 -m pytest tests/test_run_acceptance.py -q -k "disarmed or temp_parent or huge_exam"`
Expected: `test_suite_gate_without_base_warns_disarmed`, `test_exam_worktree_temp_parent_is_cleaned`, and `test_huge_exam_output_still_emits_json_receipt` FAIL (no warning; leaked dir; env-var overflow kills the heredoc so stdout is not JSON). `test_suite_gate_with_base_does_not_warn` passes already.

- [ ] **Step 3: Apply the three fixes to `skills/ultrapowers/scripts/run_acceptance.sh`:**

3a — in the `--suite-gate` argument block, immediately after the line `: "${BRANCH:?--suite-gate requires --branch}"`, add:

```bash
  if [ -z "$SG_BASE" ]; then
    echo "run_acceptance: warning — --suite-gate without --base: harness-JS sim guard disarmed (a branch that changed harnesses/*.js rides a Python-only green; pass --base <ref> to arm it)" >&2
  fi
```

3b — replace the `cleanup()` function with one that also removes the mktemp parent:

```bash
cleanup() {
  if [ -n "$EXAM_WT" ]; then
    git -C "$REPO" worktree remove --force "$EXAM_WT" >/dev/null 2>&1 || true
    rm -rf "$(dirname "$EXAM_WT")" 2>/dev/null || true
  fi
}
```

3c — in `emit()`, truncate before the value enters the environment (a multi-MB
log can exceed ARG_MAX and kill the heredoc, losing the JSON receipt). Replace
the function's first line so it reads:

```bash
emit() { # status passed exit_code output [redKind] → prints JSON, never fails
  OUTPUT_TAIL="$(printf '%s' "$4" | tail -c 8000)"
  STATUS="$1" PASSED="$2" CODE="$3" OUTPUT="$OUTPUT_TAIL" REDKIND="${5:-}" SEAL="$SEAL_ID" python3 - <<'EOF'
```

(the Python body keeps its `[-8000:]` slice — harmless second truncation).

- [ ] **Step 4: Run the new tests, the full acceptance file, then the suite**

Run: `python3 -m pytest tests/test_run_acceptance.py -q && python3 -m pytest -q`
Expected: all green

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/run_acceptance.sh tests/test_run_acceptance.py
git commit -m "fix(acceptance): clean mktemp parent, truncate output pre-env, warn on disarmed suite-gate JS guard"
```

---

### Task 4: compile_plan.py --emit-args — complete launch-args assembly

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan.py`

**Interfaces:**
- Produces: `compile_plan.py <plan> --emit-launch <p1> --emit-args <p2>` writing to `<p2>` the JSON object `{waves, wavesPath, edges, dependencyEdges, acceptance, waveLabels, globalConstraints, planPath}` where `edges` is `[[from, to], ...]` pairs and `wavesPath` is the absolute `<p1>`; the orchestrator adds only per-task `tier`/`review`/`testCmd` and run knobs (`stamp`, `integrationBranch`, `baseBranch`, `testCmd`, `bootstrapCmd`)

- [ ] **Step 1: Write the failing tests** (append to `tests/test_compile_plan.py`):

```python
def test_emit_args_writes_complete_launch_skeleton(tmp_path):
    launch = tmp_path / "waves.json"
    argsf = tmp_path / "args.json"
    p = compile_plan_raw_with(ROOT / "tests/fixtures/marked-plan.md",
                              ["--emit-launch", str(launch),
                               "--emit-args", str(argsf)])
    assert p.returncode == 0, p.stderr
    out = json.loads(p.stdout)
    skel = json.loads(argsf.read_text())
    assert skel["waves"] == out["launch_waves"]
    assert skel["wavesPath"] == str(launch.resolve())
    assert skel["edges"] == [[e["from"], e["to"]] for e in out["dag_edges"]]
    assert skel["dependencyEdges"] == [
        f"{e['from']} -> {e['to']} ({e['why']})" for e in out["dag_edges"]]
    assert skel["acceptance"] == out["acceptance"]
    assert skel["waveLabels"] == out["waveLabels"]
    assert skel["globalConstraints"] == out["globalConstraints"]
    assert pathlib.Path(skel["planPath"]).is_absolute()
    assert out["args_file"] == str(argsf)


def test_emit_args_requires_emit_launch(tmp_path):
    argsf = tmp_path / "args.json"
    p = compile_plan_raw_with(ROOT / "tests/fixtures/marked-plan.md",
                              ["--emit-args", str(argsf)])
    assert p.returncode != 0
    assert "--emit-args requires --emit-launch" in (p.stderr + p.stdout)
    assert not argsf.exists()
```

Also add this small helper next to `compile_plan_raw` (it forwards extra CLI
flags; `_with_waiver` keeps fixtures without an Acceptance line compiling):

```python
def compile_plan_raw_with(path, extra):
    effective, tmp = _with_waiver(path)
    try:
        return subprocess.run(
            [sys.executable, str(COMPILER), str(effective)] + list(extra),
            capture_output=True, text=True)
    finally:
        if tmp:
            pathlib.Path(tmp).unlink(missing_ok=True)
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_compile_plan.py -q -k emit_args`
Expected: FAIL — unknown argument `--emit-args`

- [ ] **Step 3: Implement.** In `main()` of `skills/ultrapowers/scripts/compile_plan.py`:

3a — add the flag next to `--emit-launch`:

```python
    ap.add_argument("--emit-args", type=Path, default=None, dest="emit_args",
                    metavar="PATH",
                    help="also write the complete Workflow launch-args skeleton "
                         "(waves/wavesPath/edges/acceptance/waveLabels/"
                         "globalConstraints/planPath) to PATH; the orchestrator "
                         "adds only per-task tier/review/testCmd and run knobs. "
                         "Requires --emit-launch.")
```

3b — right after `emit_launch = args.emit_launch`, add:

```python
    emit_args = args.emit_args
    if emit_args is not None and emit_launch is None:
        sys.exit("error: --emit-args requires --emit-launch (task bodies must "
                 "ride via the launch file, so wavesPath is always populated)")
```

3c — after the existing `if emit_launch is not None:` block, add:

```python
    if emit_args is not None:
        # The complete launch-args skeleton: everything deterministic rides
        # from here so the orchestrator never hand-assembles edges/acceptance
        # (forgetting args.edges silently disabled dependency blocking).
        args_payload = {
            "waves": launch_waves,
            "wavesPath": str(emit_launch.resolve()),
            "edges": [[e["from"], e["to"]] for e in edges],
            "dependencyEdges": [f"{e['from']} -> {e['to']} ({e['why']})"
                                for e in edges],
            "acceptance": acceptance,
            "waveLabels": wave_labels,
            "globalConstraints": global_constraints,
            "planPath": str(args.plan.resolve()),
        }
        emit_args.parent.mkdir(parents=True, exist_ok=True)
        emit_args.write_text(json.dumps(args_payload, indent=2))
        result["args_file"] = str(emit_args)
```

3d — update the stale comment above `derive_wave_label` (the block that says the
engine's JS copy is a "canonical mirror … kept in sync"): replace that sentence
with "The engine's JS fallback is deliberately minimal (single-task title or
'Wave N'); this function is the only rich label source, delivered via
--emit-args/waveLabels."

- [ ] **Step 4: Run the tests to verify they pass, then the full suite**

Run: `python3 -m pytest tests/test_compile_plan.py -q -k emit_args && python3 -m pytest -q`
Expected: all green

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "feat(compiler): --emit-args writes the complete launch-args skeleton"
```

---

### Task 5: waves.js — shrink the wave-label fallback to title-or-Wave-N

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `tests/sim_workflow.mjs`

- [ ] **Step 1: Rewrite the sim's derived-label scenario first (red).** In `tests/sim_workflow.mjs`, replace the body of `scenarioDerivedWaveLabels` (keep the function name and its call site) with:

```js
// ── Scenario 7c: ENGINE fallback labels (no orchestrator waveLabels) ──────────
// Label-less launches are hand-authored (Salvage/Redirect) waves; compiled
// launches always carry ARGS.waveLabels from compile_plan.py, the only rich
// label source. The engine fallback is deliberately minimal: a single-task
// wave is named by its own title, a multi-task wave is 'Wave N'.
async function scenarioDerivedWaveLabels() {
  const phases = []
  const waves = [
    [{ id: '1', title: 'Data layer + scaffold', body: 'b', tier: 'cheap' }],
    [{ id: '2', title: 'Contacts module', body: 'b', tier: 'cheap' },
     { id: '3', title: 'Deals module', body: 'b', tier: 'cheap' },
     { id: '4', title: 'Activities module', body: 'b', tier: 'cheap' },
     { id: '5', title: 'Auth module', body: 'b', tier: 'cheap' }],
    [{ id: '6', title: 'Integration server', body: 'b', tier: 'cheap' }],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 's', edges: [] }
  await runWorkflow({ agent: makeAgent(), args, phase: (t) => phases.push(t),
    budget: { total: null, spent: () => 0, remaining: () => Infinity } })
  assert(phases.includes('Data layer + scaffold'), 'fallback: single-task wave → its title (got ' + JSON.stringify(phases) + ')')
  assert(phases.includes('Wave 2'), 'fallback: label-less multi-task wave → Wave N (got ' + JSON.stringify(phases) + ')')
  assert(phases.includes('Integration server'), 'fallback: wave 3 → its title')
  assert(!phases.includes('4 Modules'), 'fallback: shared-noun derivation removed from the engine')
  console.log('scenario derived-wave-labels: OK')
}
```

- [ ] **Step 2: Run the sim to confirm it fails**

Run: `node tests/sim_workflow.mjs`
Expected: exit 1 with `SIM ASSERT FAILED: fallback: label-less multi-task wave → Wave N` (the engine still derives `4 Modules`)

- [ ] **Step 3: Shrink the engine.** In `skills/ultrapowers/harnesses/waves.js`, delete the block from `const TITLE_STOP = new Set(...)` through the end of the current `deriveWaveLabel` function (the `titleWords`, `sharedTitleNoun`, `commonFileDir`, and `deriveWaveLabel` definitions), and replace it with:

```js
// W1: a wave is named by (1) an orchestrator-supplied ARGS.waveLabels entry —
// compile_plan.py emits these (--emit-args / waveLabels) and SKILL.md threads
// them through — else (2) a single-task wave's own title, else (3) 'Wave N'.
// The rich shared-noun / common-directory derivation lives ONLY in
// compile_plan.py now; the engine no longer mirrors it in a second language
// (label-less launches are hand-authored Salvage/Redirect waves, where a
// plain 'Wave N' is acceptable).
const deriveWaveLabel = (wave) => {
  const tasks = (Array.isArray(wave) ? wave : []).filter(Boolean)
  if (tasks.length !== 1) return ''
  const s = String(tasks[0].title || ('Task ' + tasks[0].id)).trim()
  return s.length > 56 ? s.slice(0, 55) + '…' : s
}
```

Keep the existing `const waveLabel = (w) => ...` function unchanged (it already
falls back through `deriveWaveLabel(WAVES[w]) || ('Wave ' + (w + 1))`).

- [ ] **Step 4: Run the sims and the full suite**

Run: `node tests/sim_workflow.mjs && node tests/wave_ancestry_sim.mjs && python3 -m pytest -q`
Expected: `ALL SCENARIOS PASSED` from both sims; suite green (the wave-roadmap pin files still pass — `const waveLabel = (w) =>`, `ARGS.waveLabels`, and `phase(waveLabel(w))` all survive)

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "refactor(engine): wave-label fallback is title-or-Wave-N; compile_plan.py is the only rich label source"
```

---

### Task 6: Test-ballast retirement, ancestry-sim wiring, and sim coverage for isolation and the reviewer floor

**Type:** implementation
**Depends-on:** 5

**Files:**
- Create: `tests/test_wave_ancestry.py`
- Modify: `tests/sim_workflow.mjs`
- Modify: `tests/test_complexity_ratchet.py`
- Modify: `tests/test_test_import_guidance.py`
- Modify: `tests/test_review_floor.py`
- Modify: `tests/test_review_dispatch_lean.py`
- Modify: `tests/test_escalation_classifier.py`
- Modify: `tests/test_wave_roadmap.py`
- Modify: `tests/test_wave_roadmap_preview.py`

(The last six `Modify:` entries are deletions — listed so overlap inference sees them.)

- [ ] **Step 1: Add the two new sim blocks.** In `tests/sim_workflow.mjs`, immediately after the line `console.log('scenario reviewer-floor: OK')`, insert:

```js
// ── Reviewer floor is override-proof: tierOverrides never weaken the gate ────
{
  const models = {}
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    if (label === 'setup') return { branch: 'ultra/int', headSha: 'sha-setup', baselinePassed: true }
    if (label.startsWith('impl:')) return { status: 'done', branch: 'worktree-' + label.slice(5), headSha: 'sha-' + label }
    if (label.startsWith('review:')) { models[label.split(':')[1]] = opts.model; return { verdict: 'PASS', issues: [] } }
    if (label.startsWith('merge')) return { status: 'MERGED', headSha: 'sha-merge' }
    if (label === 'integration') { models.integration = opts.model; return { command: 't', testsPassed: true, output: 'ok', findings: [], onIntegrationHead: true } }
    return { status: 'done', branch: 'w', headSha: 'sha' }
  }
  const args = {
    waves: [[
      { id: 'a', title: 'trivial', body: 'b', tier: 'cheap', review: 'lean' },
      { id: 'b', title: 'risky', body: 'b', tier: 'cheap', review: 'adversarial' },
      { id: 'c', title: 'mid', body: 'b', tier: 'standard', review: 'lean' },
    ]],
    integrationBranch: 'ultra/int', stamp: 's', baseBranch: 'main', edges: [],
    tierOverrides: { cheap: 'sonnet', mostCapable: 'haiku' },
  }
  await runWorkflow({ agent, args, budget: { total: null, spent: () => 0, remaining: () => Infinity } })
  eq(models.a, 'sonnet', 'override-proof: lean+cheap floor stays DEFAULT_TIER sonnet')
  eq(models.b, 'opus', 'override-proof: tierOverrides.mostCapable cannot downgrade the adversarial reviewer')
  eq(models.c, 'opus', 'override-proof: standard-tier lean review stays opus')
  eq(models.integration, 'opus', 'override-proof: completeness critic pinned to opus')
}
console.log('scenario reviewer-floor-override-proof: OK')

// ── Role isolation + prompt hygiene: writers get worktrees, readers do not ───
// (Replaces the deleted source-pin test_review_dispatch_lean.py behaviorally:
// A2 = reviewer non-isolated; A1 = reviewer prompt carries no bootstrap/test line.)
{
  const iso = {}, prompts = {}
  let firstReview = true
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    iso[label] = opts.isolation
    prompts[label] = prompt
    if (label === 'setup') return { branch: 'ultra/int', headSha: 'int0', baselinePassed: true }
    if (label.startsWith('impl:') || label.startsWith('fix:'))
      return { status: 'DONE', summary: 's', branch: 'wt-A', headSha: 'sha-' + label }
    if (label.startsWith('review:')) {
      if (firstReview) {
        firstReview = false
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'x' }] }
      }
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm1' }
    if (label === 'integration') return { command: 't', testsPassed: true, output: 'ok', findings: [], onIntegrationHead: true }
    throw new Error('unexpected label ' + label)
  }
  const args = {
    waves: [[{ id: 'A', title: 't', body: 'b', tier: 'cheap' }]],
    integrationBranch: 'ultra/int', stamp: 's', edges: [],
    testCmd: 'make test', bootstrapCmd: 'make deps',
  }
  await runWorkflow({ agent, args, budget: { total: null, spent: () => 0, remaining: () => Infinity } })
  eq(iso['impl:A'], 'worktree', 'implementer is worktree-isolated')
  eq(iso['fix:A:1'], 'worktree', 'fix round is worktree-isolated')
  assert(iso['review:A:1'] === undefined, 'reviewer dispatch carries no isolation (A2)')
  assert(iso['merge:wave1'] === undefined, 'merge agent is non-isolated')
  assert(iso['integration'] === undefined, 'completeness critic is non-isolated')
  assert(prompts['impl:A'].includes('WORKTREE SETUP'), 'implementer receives the bootstrap line')
  assert(prompts['impl:A'].includes('TEST COMMAND'), 'implementer receives the test command')
  assert(!prompts['review:A:1'].includes('WORKTREE SETUP'), 'reviewer prompt has no bootstrap line (A1)')
  assert(!prompts['review:A:1'].includes('TEST COMMAND'), 'reviewer prompt has no test command (A1)')
}
console.log('scenario role-isolation: OK')
```

- [ ] **Step 2: Run the sim to prove the new scenarios execute and pass**

Run: `node tests/sim_workflow.mjs`
Expected: output includes `scenario reviewer-floor-override-proof: OK` and `scenario role-isolation: OK`, ends with `ALL SCENARIOS PASSED`

- [ ] **Step 3: Wire the ancestry sim into the default suite.** Create `tests/test_wave_ancestry.py`:

```python
"""Run the integration-ancestry simulation (tests/wave_ancestry_sim.mjs).

Loads the real waves.js and asserts the #70 ancestry contract (a recorded
headSha missing from the integration ancestry forces the run BLOCKED).
Previously this sim ran only via the suite-gate on harness-JS diffs; wiring
it here puts it in the default `pytest` and CI. Requires node; skips without."""
import pathlib, shutil, subprocess
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SIM = ROOT / "tests/wave_ancestry_sim.mjs"


def test_wave_ancestry_simulation():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    p = subprocess.run([node, str(SIM)], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "ALL SCENARIOS PASSED" in p.stdout, p.stdout + p.stderr
```

Run: `python3 -m pytest tests/test_wave_ancestry.py -q` — expected: 1 passed.

- [ ] **Step 4: Make the ratchet test assert the ratchet.** Replace the whole of `tests/test_complexity_ratchet.py` with:

```python
"""complexity_metric: the baseline stays shape-current AND verdict() actually
detects regressions. The repo-level ratchet remains advisory (G2) — what must
be TESTED is the mechanism, not a hard gate on today's numbers."""
import sys, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultralearn/scripts"))
import complexity_metric as cm

BASELINE = ROOT / "skills/ultralearn/complexity-baseline.json"


def test_baseline_is_shape_current():
    base = json.loads(BASELINE.read_text())
    for k in ("parensPerLine", "longestRuleChars", "distinctIssueRefs", "engineLoc"):
        assert k in base
    root = Path(cm.__file__).resolve().parents[3]
    raw = cm.compute_metrics([str(root / p) for p in cm.GATE_SURFACES])
    live = {str(Path(k).relative_to(root)) for k in raw["parensPerLine"]}
    assert set(base["parensPerLine"]) == live  # same surfaces


def test_verdict_is_quiet_at_baseline_and_flags_regressions():
    base = {"parensPerLine": {"a.md": 0.5}, "longestRuleChars": 100,
            "distinctIssueRefs": 3, "engineLoc": 1000}
    assert cm.verdict(base, base) == []
    worse = {"parensPerLine": {"a.md": 0.7}, "longestRuleChars": 150,
             "distinctIssueRefs": 3, "engineLoc": 1200}
    lines = cm.verdict(worse, base)
    assert any(l.startswith("parensPerLine[a.md] rose") for l in lines)
    assert "longestRuleChars rose 100 -> 150" in lines
    assert "engineLoc rose 1000 -> 1200" in lines
    assert not any("distinctIssueRefs" in l for l in lines)  # unchanged → silent


def test_verdict_ignores_improvements():
    base = {"parensPerLine": {"a.md": 0.5}, "longestRuleChars": 100,
            "distinctIssueRefs": 3, "engineLoc": 1000}
    better = {"parensPerLine": {"a.md": 0.3}, "longestRuleChars": 80,
              "distinctIssueRefs": 2, "engineLoc": 900}
    assert cm.verdict(better, base) == []
```

Run: `python3 -m pytest tests/test_complexity_ratchet.py -q` — expected: 3 passed.

- [ ] **Step 5: Delete the ballast.** Each behavior is covered behaviorally: the escalation ladder, reviewer floor, roadmap pre-registration, wave labels, and role isolation all run inside `tests/sim_workflow.mjs` (scenarios `escalation-classifier`, `reviewer-floor`, `reviewer-floor-override-proof`, `wave-roadmap-preview`, `wave-labels`, `derived-wave-labels`, `role-isolation`), which `tests/test_workflow_sim.py` gates in pytest/CI.

```bash
git rm tests/test_test_import_guidance.py \
       tests/test_review_floor.py \
       tests/test_review_dispatch_lean.py \
       tests/test_escalation_classifier.py \
       tests/test_wave_roadmap.py \
       tests/test_wave_roadmap_preview.py
```

- [ ] **Step 6: Run the whole suite and both sims**

Run: `python3 -m pytest -q && node tests/sim_workflow.mjs && node tests/wave_ancestry_sim.mjs`
Expected: suite green; both sims print `ALL SCENARIOS PASSED`

- [ ] **Step 7: Commit**

```bash
git add -A tests/
git commit -m "test: retire false-confidence ballast; wire ancestry sim into default suite; add override-proof + role-isolation sim scenarios; ratchet test asserts the mechanism"
```

---

### Task 7: SKILL.md re-layer — lean operator core, rationale to references/

**Type:** implementation
**Depends-on:** 2, 3, 4

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Create: `skills/ultrapowers/references/design-rationale.md`
- Modify: `tests/test_orchestrator_markers.py`
- Modify: `tests/test_salvage_gate.py`
- Modify: `tests/test_viewer_offer_touchpoints.py`
- Modify: `tests/test_compat_skill_wiring.py`
- Modify: `tests/test_terminal_teardown.py`
- Modify: `tests/test_review_trigger_prose.py`
- Modify: `tests/test_finishing_notes.py`
- Modify: `tests/test_cross_phase_review.py`
- Modify: `tests/test_report_runbook.py`

**Interfaces:**
- Consumes: the Step-5 gate script CLI `gate_check.py --run-id <id> --branch <branch> --report <path>` with exit codes 0/2/1 (from Task 2); the `--suite-gate` runner semantics incl. the `--base` guard warning (from Task 3); the `--emit-args` launch-skeleton contract (from Task 4)

- [ ] **Step 1: Create `skills/ultrapowers/references/design-rationale.md`** by MOVING (not rewriting) the maintainer rationale out of the current SKILL.md, organized under one heading per step it explains. Move at minimum these blocks, verbatim: the saved-workflow registry-snapshot backstory (Step 4a — why the SessionStart hook is the load-bearing install and mid-session copies register next session); the `ultracode`/determinism-guard essay and the read/write-boundary rationale (Step 4); the args-probe payload-drop history (Step 4a½, `[fb8635c59d4fea1c]`); the #29/#32 checkout-drift and critic-wrong-tree essays (Step 5); the #36 relay-corruption history (why sealed exams are administered at the gate); the self-host skew rationale (Step 1); the mixed-B-2 eval war story and any other bracketed-hash incident citations. Head the file with: "Maintainer rationale for the ultrapowers operator procedure. The operator SKILL.md states WHAT to run; this file records WHY each guard exists. Load it when changing the engine, the gate, or the scripts — not during routine runs."

- [ ] **Step 2: Rewrite `skills/ultrapowers/SKILL.md`** as the lean operator core. Hard limits: `wc -l` < 500, `wc -w` ≤ 2000. Keep the existing frontmatter verbatim (name/description/argument-hint/allowed-tools). Structure and mandatory content:

  - **Step 1 — Preflight & plan check** (keep, tightened): Workflow-tool preflight; self-host skew check via `check_engine_skew.sh`; superpowers compatibility via `check_superpowers_compat.py` with the graded exits (proceed / advisory line / STOP quoting missing contract tokens for the human); plan-shape check. Must retain the phrases: `Tested with superpowers 6.0.3` (regex-pinned as `Tested with superpowers \d+\.\d+\.\d+`), "contract token", "advisory", "human".
  - **Step 2 — Compile** (rewritten around Task 4): run `compile_plan.py <plan> --emit-launch <abs> --emit-args <abs2>`; adopt the JSON verbatim ("Classify first" per `references/plan-markers.md`; judgment only on `"heuristic": true` entries); derive ONLY `tier` per task, run-wide/per-task `testCmd`, `bootstrapCmd`, `baseBranch` (review depth stays engine-derived; `task.review` is a deliberate override only). No hand-assembly of waves or edges — the skeleton from `--emit-args` is the launch payload, with the derived knobs merged in.
  - **Step 3 — Render the wave plan (transparency, no pause)**: waves, edges, mode/degrade, derived knobs, dispositions with the two `marker_conflicts` buckets rendered separately, the `0 markers — all dispositions inferred` flag ("all dispositions inferred" must appear), the acceptance disposition + the sealed-exam vouching rubric (keep the three-question rubric, compressed). Must retain: "do not ask for approval"; must NOT contain a heading "Get Approval".
  - **Step 4 — Launch**: 4a install-by-manifest loop (keep the exact bash block); 4a½ probe (`ultrapowers-probe`, assert `echoWaves`/`echoFirstId` round-trip; the three failure branches compressed to one line each — keep the headings `**4a½` and `**4b`, and in the not-found branch keep "not found", "session start", "SessionStart hook", the new-session cure); 4b lock + snapshot (`run_lock.sh acquire` / `run_lock.sh snapshot`); 4c launch saved workflow by `meta.name` `ultrapowers-run` with the merged args object; the one-line viewer offer (keep one `serve_viewer.py … --transcripts … --watch …` command line and the `serve_viewer.py --stop` teardown line).
  - **Step 5 — Pre-merge gate (human gate)**, rewritten around Tasks 2+3:
    1. `run_lock.sh restore` (never a bare `git checkout <baseBranch>` — keep that phrase in the warning sentence).
    2. Save the workflow's report JSON verbatim to `.claude/ultrapowers/report-<stamp>.json`.
    3. Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/gate_check.py --run-id <runId> --branch <integrationBranch> --report <path>`. Exit 1 (BLOCKED) → present the failing checks, do NOT Approve; exit 2 (NEEDS_ACK) → present the itemized acks for explicit operator acknowledgement before Approve; exit 0 → continue.
    4. Administer acceptance deterministically, per disposition: `sealed` → `run_acceptance.sh <sealId> <integrationBranch> <sha256>`; `suite` AND unmarked (`null`) → `run_acceptance.sh --suite-gate --branch <integrationBranch> --run <derived testCmd> --base <baseBranch>`; `waived` → record the waiver verbatim. Exit code is the authority; the report's `tests.passed` is triage context. (Keep the literal "tests.passed" in that sentence.)
    5. Render the report per `references/report-format.md` + the post-merge runbook; keep the **Approve** (only on gate_check exit 0 or acknowledged exit 2, AND acceptance exit 0 — then `git checkout <integrationBranch>`, `sweep_worktrees.sh --run <runId>`, `run_lock.sh release <runId>`, holistic cross-phase review before the final PR when work spanned phases, then `superpowers:finishing-a-development-branch` with `references/finishing-notes.md`'s two checks), **Salvage** (mechanical rebuild of failed + dep-blocked waves with `PRIOR ATTEMPT` notes carrying the kept branch coordinates from `tasks[]` and `unfinished`, relaunch `resume: true`), **Redirect** (corrective bodies, relaunch `resume: true`, same branch), and **Terminal teardown** (release `run_lock.sh release` on every non-relaunch exit; keep worktrees as triage evidence, pointing at `sweep_worktrees.sh --run`) options.
  - **Step 6 — Fallback** (keep, tightened): subagent-driven-development on Workflow-absence/drift; hand it implementation+gate tasks only; runbook carried.
  - **Autonomy posture** (3 sentences) and a **Resources** list including `references/design-rationale.md`.

  Every step keeps a one-line pointer to `references/design-rationale.md` where its rationale moved (e.g. "Why: see design-rationale.md § Step 5").

- [ ] **Step 3: Preserve or deliberately update every pinned literal.** The pin inventory and its disposition (all pins not listed here must keep passing unchanged):

  | Pin file | Disposition |
  |---|---|
  | `test_orchestrator_markers.py` | All asserts keep passing via the mandatory content above (phrases: `references/plan-markers.md`, "Classify first", "post-merge runbook", "dispositions", "do not ask for approval", `## Step 5` + "Approve", `` `meta.name` ``, "not found", `**4a½`/`**4b` headings, "session"/"session start", "SessionStart hook", "restore the session checkout", `Tested with superpowers \d+\.\d+\.\d+`, `scripts/compile_plan.py`, `ultrapowers-probe`, "edges", "tests.passed", `git checkout <integrationBranch>`, "all dispositions inferred", `git checkout <baseBranch>`). No test edits expected; if a phrase must move, keep it verbatim in the new location. |
  | `test_report_runbook.py` | `test_skill_has_skew_preflight_probe_roundtrip_and_schema_degrade`: replace the `"merge-sha guard unavailable" in skill` assert with `assert "merge-sha guard unavailable" in (ROOT / "skills/ultrapowers/scripts/gate_check.py").read_text()` — the guard moved from prose to the script (Task 2 emits that literal). Keep the other asserts (`check_engine_skew.sh`, `echoWaves`, `run_lock.sh acquire/snapshot/restore`, `sweep_worktrees.sh --run`) satisfied by the rewrite. |
  | `test_cross_phase_review.py` | Fix the vacuous assert: `assert "pr" in blob` → `assert "final pr" in blob` (the rewrite keeps the phrase "before the final PR"). |
  | `test_salvage_gate.py`, `test_terminal_teardown.py`, `test_viewer_offer_touchpoints.py`, `test_compat_skill_wiring.py`, `test_review_trigger_prose.py`, `test_finishing_notes.py` | Keep passing unchanged via the mandatory content above ("**Salvage**", "PRIOR ATTEMPT", `resume: true` ×2, "kept branch", "unfinished"; `run_lock.sh release` ×2, "Terminal teardown", `sweep_worktrees.sh --run`; the `serve_viewer.py` lines; `check_superpowers_compat.py` + graded words; "risk surface", "data-layer", "auth", "migrations"; `finishing-notes.md`). |

- [ ] **Step 4: Verify sizes, skill validity, and the full suite**

Run:
```bash
wc -l skills/ultrapowers/SKILL.md   # expected: < 500
wc -w skills/ultrapowers/SKILL.md   # expected: <= 2000
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers   # expected: skill ok
python3 -m pytest -q                # expected: all green
```

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/design-rationale.md tests/
git commit -m "refactor(skill): SKILL.md re-layered to lean operator core; gate mechanized via gate_check + deterministic suite administration; rationale moved to design-rationale.md"
```

---

### Task 8: Untrack the ultralearn ledger

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `.gitignore`
- Modify: `docs/superpowers/observations/ledger.jsonl`
- Modify: `docs/superpowers/observations/ledger.md`

(The two ledger entries are `git rm --cached` deletions from tracking; the working copies stay on disk.)

- [ ] **Step 1: Append to `.gitignore`:**

```
# ultralearn committed-digest output — regenerable from the local run cache
# (merge_ledger.py / regenerate_digest); ~600KB and growing, so untracked.
docs/superpowers/observations/ledger.jsonl
docs/superpowers/observations/ledger.md
```

- [ ] **Step 2: Untrack without deleting the working copies**

```bash
git rm --cached docs/superpowers/observations/ledger.jsonl docs/superpowers/observations/ledger.md
```

- [ ] **Step 3: Verify**

Run: `git ls-files docs/superpowers/observations/ | grep -c ledger || true`
Expected: `0` — and both files still exist on disk (`ls docs/superpowers/observations/`). Run `python3 -m pytest -q` — green (no test reads the tracked ledger).

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore(ultralearn): untrack the regenerable ledger digest (stays local)"
```

---

### Task 9: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7, 8

**Files:**
- None

- [ ] **Step 1:** Run `python3 -m pytest -q` — expected: all green, zero failures.
- [ ] **Step 2:** Run `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and the same for `skills/ultraplan` — expected: `skill ok` twice.
- [ ] **Step 3:** Run `node tests/sim_workflow.mjs && node tests/wave_ancestry_sim.mjs` — expected: `ALL SCENARIOS PASSED` from both.

---

### Task 10: Restore the local ledger working copies after merge

**Type:** manual
**Depends-on:** 8

**Files:**
- None

- [ ] **Step 1:** After the integration branch merges to `main` and the session checkout updates across the untracking commit, git may remove the two (now-ignored) ledger files from the working tree. The operator verifies `docs/superpowers/observations/ledger.jsonl` and `ledger.md` still exist; if not, regenerate them from the local cache by re-running the ultralearn merge step (`merge_ledger.py` + `regenerate_digest` per `skills/ultralearn/SKILL.md`), or restore from the pre-merge commit: `git show <pre-merge-sha>:docs/superpowers/observations/ledger.jsonl > docs/superpowers/observations/ledger.jsonl` (same for `ledger.md`).
