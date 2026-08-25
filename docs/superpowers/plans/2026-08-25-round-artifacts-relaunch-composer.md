# Per-Round Artifacts + One Relaunch Composer Implementation Plan (#222)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every relaunch round's gate report and `heads/` sidecars survive mechanically (`report-<n>.json`, `heads-<n>/`) and give Salvage the same deterministic composer Redirect already has (`salvage_args.py`), so the #149 residual-manifest union has a real input and no relaunch is ever hand-composed.

**Architecture:** The non-frozen variant of #222, as narrowed at docket triage and re-affirmed by the operator at the sweep: `ultra_gate.py` keeps writing `run-<stamp>/report.json` and `gate_check.py` is untouched. The two relaunch composers own round bookkeeping instead: after a successful emit, `redirect_args.py` (refactored into importable functions) and the new `salvage_args.py` snapshot `report.json → report-<n>.json` and rename `heads/ → heads-<n>/` — never `rmtree` — which preserves the #131 reason (a stale higher `wave-<n>` slot can no longer win the critic's detach rule) while deleting nothing. Both composers chain task bodies through one `relaunch-launch.json`. `residual_manifest.py` gains `--run-dir` to derive over `report-<n>.json` + `report.json` in round order. SKILL.md Step 5 loses its hand-composition prose and its "delete heads/" rule.

**Tech Stack:** Python 3 stdlib, pytest. No harness JS, no prompt re-bake (no `waves.js` touch — the harness never learns its round number; the composer keys rounds by counting the artifacts already on disk).

**Spec:** GitHub issue #222 plus its docket entry `docs/superpowers/docket.md` (`### #222`, the **Notes** field carries the scope cut and the brainstorm holes). Pre-seeded brainstorm decisions recorded here: (1) rounds are keyed by a composer-side counter `<n>` = 1 + the highest existing `report-<k>.json`/`heads-<k>/` number — not by wfRunId, which the harness does not know and `wf-runs.json` stores sorted, not in launch order; (2) one chain file `relaunch-launch.json` replaces `redirect-launch.json` so a redirect after a salvage (or vice versa) never resurrects pristine bodies; (3) budget-deferred `unfinished` entries are NOT salvaged (SKILL.md's contract is failed + dep-/cascade-blocked) — they are listed on stderr; (4) `residual_manifest.py` grows one flag rather than a new script.

**Acceptance:** suite — non-frozen scripts + tests + skill prose; the committed pytest suite (extended by every task below) is the verification, no held-out exam.

## Global Constraints

- The verification periphery is FROZEN: never touch `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `run_acceptance.sh`, `collect_seal.py`, `seal_hash.py`. This plan's scope cut is explicit: `ultra_gate.py` keeps writing `report.json`; all round bookkeeping lives in the composers.
- `skills/ultrapowers/harnesses/waves.js` is not edited by this plan (no re-bake, no `.mjs` sim change).
- No Anthropic API calls or SDK anywhere; no new dependencies; Python 3 stdlib only.
- Tests must be concurrency-safe: derive every path from pytest's `tmp_path`, no shared on-disk fixtures, no ports.
- The full gate is `python3 -m pytest` (pytest.ini scopes to `tests/`); every task leaves it green.
- Rotation is a rename/copy, never a delete: no task may call `shutil.rmtree` on `heads/` or unlink `report.json`.

---

### Task 1: redirect_args.py — importable composer functions + round rotation

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/redirect_args.py`
- Test: `tests/test_redirect_args.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces (module `redirect_args`, importable by a sibling script in the same directory):
  - `CHAIN_LAUNCH = "relaunch-launch.json"`
  - `die(msg: str) -> NoReturn` (prints `<prog>: msg` to stderr, exits 1; `prog` is the module-level `PROG` string, default `"redirect_args"`)
  - `load_json(path: str, what: str) -> object`
  - `next_round(run_dir: str) -> int` — 1 + the highest `<n>` among `report-<n>.json` and `heads-<n>` names in `run_dir`; 1 when none.
  - `rotate_round_artifacts(run_dir: str) -> dict` — `{"round": n, "report": <path|None>, "heads": <path|None>}`; copies `report.json → report-<n>.json` (`shutil.copy2`) and renames `heads/ → heads-<n>/` (`os.rename`); each half is a no-op returning `None` when its source is absent.
  - `load_context(receipt_path: str, out_dir: str|None, branch_flag: str|None) -> dict` with keys `receipt_dir`, `run_dir`, `args`, `launch`, `tasks` (id → task dict, references into `launch`), `entries` (id → wave entry dict, references into `args["waves"]`), `branch`.
  - `emit_relaunch(ctx: dict, selected: set, args_name: str) -> str` — writes `ctx["run_dir"]/relaunch-launch.json` and `ctx["run_dir"]/<args_name>` (resume args narrowed to `selected`, `resume: True`, `integrationBranch`, `wavesPath`), THEN calls `rotate_round_artifacts(ctx["receipt_dir"])` and prints one stderr line naming what rotated; returns the args path.

The behavior of the existing CLI is unchanged except for two things: the chain file is named `relaunch-launch.json` (was `redirect-launch.json`), and after a successful emit `heads/` is **rotated** to `heads-<n>/` and `report.json` snapshotted to `report-<n>.json` instead of `heads/` being deleted. Rotation still happens only after a successful emit — a validation death leaves the run dir untouched (existing pin `test_heads_untouched_on_validation_failure`).

- [ ] **Step 1: Rewrite the heads tests as rotation tests and add the round-numbering tests**

In `tests/test_redirect_args.py`, replace `test_heads_cleared_after_successful_emit` and `test_heads_beside_receipt_cleared_even_with_out_dir` with the following, keep `test_heads_untouched_on_validation_failure` and `test_no_heads_dir_is_a_noop` as they are, and append the three new tests. Also add a `make_report(run)` helper next to `make_heads`:

```python
def make_report(run, marker="round-one"):
    (run / "report.json").write_text(json.dumps(
        {"integrationBranch": "ultra/int-1", "waves": [["1", "2"]],
         "tasks": [{"task": "1", "status": "done"}], "tests": {"passed": True},
         "unfinished": [], "completenessFindings": [marker]}))


def test_heads_rotated_after_successful_emit(tmp_path):
    # #222 (supersedes the #131 rmtree): a stale wave-4 slot from the prior
    # launch must not survive into the relaunch's heads/, but nothing is
    # deleted — the prior round's slots move to heads-1/.
    run = make_run(tmp_path)
    heads = make_heads(run)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    assert not heads.exists()
    assert (run / "heads-1" / "wave-4").read_text() == "b" * 40 + "\n"
    assert (run / "heads-1" / "task-1").is_file()
    assert (run / "redirect-args.json").is_file()  # emit happened first
    assert "round 1" in r.stderr


def test_report_snapshotted_to_round_file_after_successful_emit(tmp_path):
    run = make_run(tmp_path)
    make_report(run)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    snap = json.loads((run / "report-1.json").read_text())
    assert snap["completenessFindings"] == ["round-one"]
    # the live report.json is a COPY source, never removed — the next gate
    # overwrites it; the snapshot is the durable record
    assert (run / "report.json").is_file()


def test_rotation_beside_receipt_even_with_out_dir(tmp_path):
    # the rotation target is pinned to dirname(receipt), never --out-dir
    run = make_run(tmp_path)
    make_heads(run)
    make_report(run)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    r = run_helper(run, [{"task": "1", "instruction": "fix"}],
                   "--out-dir", str(elsewhere))
    assert r.returncode == 0, r.stderr
    assert not (run / "heads").exists()
    assert (run / "heads-1").is_dir() and (run / "report-1.json").is_file()
    assert not (elsewhere / "heads-1").exists()
    assert (elsewhere / "redirect-args.json").is_file()


def test_round_counter_increments_across_rounds(tmp_path):
    run = make_run(tmp_path)
    make_heads(run)
    make_report(run, "round-one")
    r1 = run_helper(run, [{"task": "1", "instruction": "one"}])
    assert r1.returncode == 0, r1.stderr
    # the next gate rewrites report.json and the next merge rewrites heads/
    make_heads(run)
    make_report(run, "round-two")
    r2 = run_helper(run, [{"task": "2", "instruction": "two"}])
    assert r2.returncode == 0, r2.stderr
    assert json.loads((run / "report-1.json").read_text())["completenessFindings"] == ["round-one"]
    assert json.loads((run / "report-2.json").read_text())["completenessFindings"] == ["round-two"]
    assert (run / "heads-1").is_dir() and (run / "heads-2").is_dir()
    assert not (run / "heads").exists()


def test_round_counter_continues_from_existing_artifacts(tmp_path):
    # an orchestrator that already has report-3.json / heads-3 on disk (e.g.
    # a salvage round) gets round 4 — never a clobbered earlier snapshot
    run = make_run(tmp_path)
    (run / "report-3.json").write_text("{}")
    make_heads(run)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    assert (run / "heads-4").is_dir() and not (run / "heads").exists()
    assert (run / "report-3.json").read_text() == "{}"


def test_heads_only_rotation_when_report_absent(tmp_path):
    run = make_run(tmp_path)
    make_heads(run)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    assert (run / "heads-1").is_dir()
    assert not (run / "report-1.json").exists()


def test_chain_file_is_relaunch_launch_json(tmp_path):
    # #222: one chain file shared with salvage_args.py
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert Path(out_args["wavesPath"]).name == "relaunch-launch.json"
    assert not (run / "redirect-launch.json").exists()
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `python3 -m pytest tests/test_redirect_args.py -v`
Expected: the seven new/rewritten tests FAIL (heads deleted instead of rotated, no `report-1.json`, chain file still `redirect-launch.json`); every pre-existing test still PASSES.

- [ ] **Step 3: Refactor `redirect_args.py` into importable functions and add rotation**

Replace the file's body (keep the shebang and expand the docstring to mention #222) with:

```python
import argparse
import json
import os
import re
import shutil
import sys

PROG = "redirect_args"
CHAIN_LAUNCH = "relaunch-launch.json"
_ROUND_RE = re.compile(r"^(?:report|heads)-(\d+)(?:\.json)?$")


def die(msg):
    print(PROG + ": " + msg, file=sys.stderr)
    sys.exit(1)


def load_json(path, what):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, TypeError) as e:
        die("unreadable %s %r (%s)" % (what, path, e))


def next_round(run_dir):
    """1 + the highest round number already on disk (report-<n>.json or
    heads-<n>); 1 when the run dir holds no round artifacts yet."""
    highest = 0
    names = os.listdir(run_dir) if os.path.isdir(run_dir) else []
    for name in names:
        m = _ROUND_RE.match(name)
        if m:
            highest = max(highest, int(m.group(1)))
    return highest + 1


def rotate_round_artifacts(run_dir):
    """#222: key the prior round's artifacts by round number instead of
    deleting them. report.json is COPIED to report-<n>.json (the next gate
    overwrites the live file); heads/ is RENAMED to heads-<n>/ so the
    relaunch's merge writes a fresh heads/ and a stale higher wave-<n> slot
    can no longer win the critic's detach rule (the #131 reason, kept).
    Nothing is ever deleted."""
    n = next_round(run_dir)
    out = {"round": n, "report": None, "heads": None}
    report = os.path.join(run_dir, "report.json")
    if os.path.isfile(report):
        dst = os.path.join(run_dir, "report-%d.json" % n)
        shutil.copy2(report, dst)
        out["report"] = dst
    heads = os.path.join(run_dir, "heads")
    if os.path.isdir(heads):
        dst = os.path.join(run_dir, "heads-%d" % n)
        os.rename(heads, dst)
        out["heads"] = dst
    return out


def load_context(receipt_path, out_dir=None, branch_flag=None):
    """Everything a relaunch composer needs, loaded once. The args (and
    their FULL waves) always come from the original argsFile — emitted waves
    are a per-round subset. Launch BODIES chain through the prior round's
    relaunch-launch.json when one exists: re-deriving bodies from the
    pristine launch would silently discard that round's amendments."""
    receipt = load_json(receipt_path, "receipt")
    receipt_dir = os.path.dirname(os.path.abspath(receipt_path))
    run_dir = out_dir or receipt_dir
    args_path = receipt.get("argsFile")
    if not (isinstance(args_path, str) and os.path.isfile(args_path)):
        die("receipt has no readable argsFile: %r" % args_path)
    args = load_json(args_path, "argsFile")
    prior_launch = os.path.join(run_dir, CHAIN_LAUNCH)
    launch_path = (prior_launch if os.path.isfile(prior_launch)
                   else args.get("wavesPath"))
    if not (isinstance(launch_path, str) and os.path.isfile(launch_path)):
        die("args has no readable wavesPath: %r" % launch_path)
    launch = load_json(launch_path, "launch file")
    branch = branch_flag or (args.get("integrationBranch") or None)
    if not branch:
        # "next to the receipt" (per the error below) — never --out-dir
        gr_path = os.path.join(receipt_dir, "gate-receipt.json")
        if os.path.isfile(gr_path):
            gr = load_json(gr_path, "gate receipt") or {}
            # #153: real receipts (ultra_gate.py) store the branch under
            # "branch"; hand-built/legacy fixtures use "integrationBranch".
            branch = gr.get("integrationBranch") or gr.get("branch")
    if not branch:
        die("no integration branch: pass --integration-branch or provide "
            "gate-receipt.json next to the receipt")
    raw_tasks = launch.get("tasks")
    # compile_plan.py --emit-launch emits tasks as a LIST of {id,...} objects;
    # accept the dict-keyed shape too (unit fixtures, hand-built files). The
    # id-keyed view holds references, so amendments land in the original
    # structure and the emitted copy preserves the input shape.
    if isinstance(raw_tasks, dict):
        tasks = {str(k): v for k, v in raw_tasks.items()}
    elif isinstance(raw_tasks, list):
        tasks = {str(t.get("id")): t for t in raw_tasks if isinstance(t, dict)}
    else:
        die("launch file has no tasks list/object")
    entries = {e.get("id"): e for wave in (args.get("waves") or []) for e in wave}
    return {"receipt_dir": receipt_dir, "run_dir": run_dir, "args": args,
            "launch": launch, "tasks": tasks, "entries": entries,
            "branch": branch}


def emit_relaunch(ctx, selected, args_name):
    """Write the chained launch + the narrowed resume args, then rotate the
    prior round's artifacts. Rotation runs LAST, only after a successful
    emit, so a validation death never touches a healthy run's sidecars."""
    launch_path = os.path.join(ctx["run_dir"], CHAIN_LAUNCH)
    with open(launch_path, "w") as f:
        json.dump(ctx["launch"], f, indent=2)
    args = ctx["args"]
    out = dict(args)
    # The honest cost contract: only the selected tasks relaunch (the engine
    # resumes on the same integration branch; merged prior work is already
    # there). Empty waves are dropped; edges narrow to the selected set.
    out["waves"] = [w for w in ([e for e in wave if e.get("id") in selected]
                                for wave in (args.get("waves") or [])) if w]
    out["edges"] = [e for e in (args.get("edges") or [])
                    if len(e) == 2 and e[0] in selected and e[1] in selected]
    out.update({"resume": True, "integrationBranch": ctx["branch"],
                "wavesPath": launch_path})
    args_path = os.path.join(ctx["run_dir"], args_name)
    with open(args_path, "w") as f:
        json.dump(out, f, indent=2)
    rotated = rotate_round_artifacts(ctx["receipt_dir"])
    moved = [p for p in (rotated["report"], rotated["heads"]) if p]
    if moved:
        print("%s: rotated round %d artifacts: %s"
              % (PROG, rotated["round"], ", ".join(os.path.basename(p) for p in moved)),
              file=sys.stderr)
    return args_path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--receipt", required=True)
    ap.add_argument("--findings", required=True)
    ap.add_argument("--integration-branch", default=None)
    ap.add_argument("--out-dir", default=None,
                    help="defaults to the receipt's directory")
    a = ap.parse_args()

    ctx = load_context(a.receipt, a.out_dir, a.integration_branch)
    findings = load_json(a.findings, "findings")
    if not (isinstance(findings, list) and findings):
        die("findings must be a non-empty JSON list of amend entries")
    tasks, entries = ctx["tasks"], ctx["entries"]
    amended = set()
    for i, f in enumerate(findings):
        tid = str(f.get("task") or "")
        if tid not in tasks or tid not in entries:
            die("finding %d names unknown task %r" % (i, tid))
        amended.add(tid)
        instruction = (f.get("instruction") or "").strip()
        if not instruction:
            die("finding %d (task %s) has no instruction" % (i, tid))
        tasks[tid]["body"] = tasks[tid].get("body", "") + "\n\nREDIRECT: " + instruction + "\n"
        if f.get("files"):
            tasks[tid]["files"] = list(f["files"])
            entries[tid]["files"] = list(f["files"])
        if f.get("tier"):
            entries[tid]["tier"] = f["tier"]
    print(emit_relaunch(ctx, amended, "redirect-args.json"))


if __name__ == "__main__":
    main()
```

(The `files`/`tier` amend semantics are byte-for-byte the shipped ones — #223 changes them in its own plan; do not pre-empt it here.)

- [ ] **Step 4: Run the whole test file and confirm green**

Run: `python3 -m pytest tests/test_redirect_args.py -v`
Expected: all PASS, including the untouched pins (`test_heads_untouched_on_validation_failure`, `test_no_heads_dir_is_a_noop`, `test_second_round_chains_on_first_rounds_output`).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/redirect_args.py tests/test_redirect_args.py
git commit -m "feat(engine): redirect_args rotates round artifacts (report-<n>.json, heads-<n>/) instead of deleting heads/ (#222)"
```

---

### Task 2: salvage_args.py — the deterministic Salvage composer

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Create: `skills/ultrapowers/scripts/salvage_args.py`
- Create: `tests/test_salvage_args.py`

**Interfaces:**
- Consumes (from Task 1, module `redirect_args`): `die`, `load_json`, `load_context(receipt_path, out_dir, branch_flag) -> ctx`, `emit_relaunch(ctx, selected, args_name) -> args_path`, `CHAIN_LAUNCH`.
- Produces: CLI `salvage_args.py --receipt <receipt.json> --report <report.json|saved-result.json> [--integration-branch B] [--out-dir D]`; prints the emitted `salvage-args.json` path on stdout; exit 1 with a `salvage_args:`-prefixed stderr line on every refusal. Module functions `load_report(path) -> dict`, `salvage_set(report) -> (failed: list[dict], blocked: list[tuple[str, str]], skipped: list[str])`, `prior_attempt(task: dict, findings: list[str]) -> str`.

Salvage set (SKILL.md Step 5's contract, now mechanical): every `tasks[]` entry with `status == "failed"`, plus every `unfinished` string matching `^(\S+): (blocked — |cascade-blocked by )` (dep-/cascade-blocked). Budget-deferred strings (`: deferred (`) are **not** salvaged — they are listed on stderr so the orchestrator sees them. Selected ids are relaunched in Step-2 order (the original `args.waves` order) with edges narrowed to the set — `emit_relaunch` does that. Each failed task's body gets a **PRIOR ATTEMPT** block from its `tasks[]` record (kept branch + HEAD sha, review verdict, blocking notes, every completeness finding naming `task <id>`), plus the instruction to pull correct prior work in with `git checkout <sha> -- <path>` rather than reimplement. A blocked/unfinished task (never attempted) gets a one-line PRIOR ATTEMPT note quoting its `unfinished` string.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_salvage_args.py`:

```python
# tests/test_salvage_args.py
import json, subprocess, sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts"
SALVAGE = SCRIPTS / "salvage_args.py"
REDIRECT = SCRIPTS / "redirect_args.py"
SHA_B = "b" * 40


def make_run(tmp_path):
    run = tmp_path / "run-20260825-1"
    run.mkdir()
    launch = {"tasks": [{"id": "1", "body": "### Task 1\n\nfirst", "files": ["a.py"]},
                        {"id": "2", "body": "### Task 2\n\nsecond", "files": ["b.py"]},
                        {"id": "3", "body": "### Task 3\n\nthird", "files": ["c.py"]}],
              "waves": [["1", "2"], ["3"]]}
    launch_p = run / "launch.json"
    launch_p.write_text(json.dumps(launch))
    args = {"planPath": "docs/p.md", "pluginRoot": "/pr", "runDir": str(run),
            "wavesPath": str(launch_p), "integrationBranch": "ultra/int-1",
            "edges": [["1", "3"], ["2", "3"]],
            "waves": [[{"id": "1", "files": ["a.py"], "tier": None, "review": "lean"},
                       {"id": "2", "files": ["b.py"], "tier": None, "review": "lean"}],
                      [{"id": "3", "files": ["c.py"], "tier": None, "review": "lean"}]]}
    args_p = run / "args.json"
    args_p.write_text(json.dumps(args))
    (run / "receipt.json").write_text(json.dumps({"argsFile": str(args_p), "runDir": str(run)}))
    return run


def report_obj(**over):
    result = {"integrationBranch": "ultra/int-1", "waves": [["1", "2"], ["3"]],
              "tasks": [{"task": "1", "status": "done", "branch": "wt-1", "headSha": "a" * 40},
                        {"task": "2", "status": "failed", "branch": "wt-2", "headSha": SHA_B,
                         "reviewVerdict": "fix-loop-exhausted",
                         "notes": "blocking: guard still missing"}],
              "tests": {"passed": True},
              "unfinished": ["3: blocked — depends on a failed task",
                             "9: deferred (budget exhausted)"],
              "completenessFindings": ["Task 2 left the guard untested",
                                       "task 3 never ran", "unrelated finding"]}
    result.update(over)
    return result


def write_report(run, obj, name="report.json"):
    p = run / name
    p.write_text(json.dumps(obj))
    return p


def run_salvage(run, report_path, *extra):
    return subprocess.run([sys.executable, str(SALVAGE), "--receipt", str(run / "receipt.json"),
                           "--report", str(report_path), *extra],
                          capture_output=True, text=True)


def test_salvage_set_is_failed_plus_blocked_in_step2_order(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj())
    r = run_salvage(run, rp)
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert [[e["id"] for e in w] for w in out_args["waves"]] == [["2"], ["3"]]
    assert out_args["edges"] == [["2", "3"]]           # narrowed to the salvage set
    assert out_args["resume"] is True
    assert out_args["integrationBranch"] == "ultra/int-1"
    assert out_args["pluginRoot"] == "/pr" and out_args["runDir"]  # receipt spread carried
    assert Path(r.stdout.strip()).name == "salvage-args.json"
    assert "9: deferred (budget exhausted)" in r.stderr   # listed, not salvaged


def test_prior_attempt_block_carries_branch_sha_notes_findings(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj())
    r = run_salvage(run, rp)
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    launch = json.loads(Path(out_args["wavesPath"]).read_text())
    by_id = {t["id"]: t for t in launch["tasks"]}
    body2 = by_id["2"]["body"]
    assert body2.startswith("### Task 2\n\nsecond")
    assert "PRIOR ATTEMPT" in body2
    assert "wt-2" in body2 and SHA_B in body2
    assert "git checkout " + SHA_B + " -- <path>" in body2
    assert "fix-loop-exhausted" in body2
    assert "blocking: guard still missing" in body2
    assert "Task 2 left the guard untested" in body2
    assert "task 3 never ran" not in body2 and "unrelated finding" not in body2
    body3 = by_id["3"]["body"]
    assert "PRIOR ATTEMPT" in body3 and "not attempted" in body3
    assert "3: blocked — depends on a failed task" in body3
    assert "task 3 never ran" in body3
    assert by_id["1"]["body"] == "### Task 1\n\nfirst"    # untouched sibling
    assert "PRIOR ATTEMPT" not in (run / "launch.json").read_text()  # original untouched


def test_envelope_shaped_result_is_accepted(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, {"summary": "envelope", "result": report_obj()}, "saved-result.json")
    r = run_salvage(run, rp)
    assert r.returncode == 0, r.stderr


def test_nothing_to_salvage_exits_1(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj(
        tasks=[{"task": "1", "status": "done"}, {"task": "2", "status": "done"}],
        unfinished=["9: deferred (budget exhausted)"]))
    r = run_salvage(run, rp)
    assert r.returncode == 1 and "nothing to salvage" in r.stderr


def test_failed_task_unknown_to_launch_exits_1(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj(tasks=[{"task": "7", "status": "failed"}]))
    r = run_salvage(run, rp)
    assert r.returncode == 1 and "7" in r.stderr


def test_not_a_report_exits_1(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, {"grantedAt": "x", "instruction": "y", "ackList": []})
    r = run_salvage(run, rp)
    assert r.returncode == 1 and "not a report" in r.stderr


def test_rotates_round_artifacts_after_emit(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj())
    heads = run / "heads"; heads.mkdir()
    (heads / "wave-2").write_text("c" * 40 + "\n")
    r = run_salvage(run, rp)
    assert r.returncode == 0, r.stderr
    assert not heads.exists() and (run / "heads-1" / "wave-2").is_file()
    assert json.loads((run / "report-1.json").read_text())["tasks"][1]["status"] == "failed"
    assert (run / "report.json").is_file()


def test_validation_failure_leaves_artifacts_untouched(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj(tasks=[{"task": "7", "status": "failed"}]))
    heads = run / "heads"; heads.mkdir()
    r = run_salvage(run, rp)
    assert r.returncode == 1
    assert heads.exists() and not (run / "report-1.json").exists()


def test_salvage_chains_on_a_prior_redirect_round(tmp_path):
    # one chain file (relaunch-launch.json): a redirect's amendment survives
    # into a later salvage instead of being resurrected from the pristine launch
    run = make_run(tmp_path)
    findings = run / "findings.json"
    findings.write_text(json.dumps([{"task": "1", "instruction": "round1 fix"}]))
    (run / "gate-receipt.json").write_text(json.dumps({"branch": "ultra/int-1"}))
    r1 = subprocess.run([sys.executable, str(REDIRECT), "--receipt", str(run / "receipt.json"),
                         "--findings", str(findings)], capture_output=True, text=True)
    assert r1.returncode == 0, r1.stderr
    rp = write_report(run, report_obj())
    r2 = run_salvage(run, rp)
    assert r2.returncode == 0, r2.stderr
    out_args = json.loads(Path(r2.stdout.strip()).read_text())
    launch = json.loads(Path(out_args["wavesPath"]).read_text())
    by_id = {t["id"]: t for t in launch["tasks"]}
    assert "REDIRECT: round1 fix" in by_id["1"]["body"]
    assert "PRIOR ATTEMPT" in by_id["2"]["body"]
    assert (run / "heads-1").exists() is False        # no heads/ existed to rotate
    # the redirect had nothing to rotate (no report.json, no heads/), so it left
    # no round artifact — the counter is by artifacts present, and the salvage's
    # snapshot is round 1
    assert (run / "report-1.json").is_file()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_salvage_args.py -v`
Expected: every test FAILS (`salvage_args.py` does not exist).

- [ ] **Step 3: Implement `skills/ultrapowers/scripts/salvage_args.py`**

```python
#!/usr/bin/env python3
"""Author salvage relaunch args deterministically (#222).

Sibling of redirect_args.py: reads the run receipt's argsFile, the chained
launch bodies, and the finalized gate report; derives the salvage set
mechanically (every failed task plus every dep-/cascade-blocked unfinished
task, in Step-2 order, edges narrowed); appends a PRIOR ATTEMPT block to
each selected task's body (kept branch + HEAD sha, review verdict,
blocking notes, completeness findings naming the task, and the instruction
to pull correct prior work in with git checkout <sha> -- <path> rather than
reimplement); emits salvage-args.json with resume: true; then rotates the
prior round's artifacts. Never launches anything; never mutates originals.
Budget-deferred unfinished entries are listed on stderr, not salvaged.
"""
import argparse
import re
import sys

import redirect_args as ra

ra.PROG = "salvage_args"
BLOCKED_RE = re.compile(r"^(\S+): (?:blocked — |cascade-blocked by )")


def load_report(path):
    data = ra.load_json(path, "report")
    if isinstance(data, dict) and isinstance(data.get("result"), dict) \
            and "tasks" in data["result"]:
        return data["result"]
    if isinstance(data, dict) and "tasks" in data:
        return data
    ra.die("not a report: %r has no tasks[] (top-level or under result.*)" % path)


def salvage_set(report):
    failed = [t for t in (report.get("tasks") or [])
              if isinstance(t, dict) and t.get("status") == "failed"]
    blocked, skipped = [], []
    for s in (report.get("unfinished") or []):
        m = BLOCKED_RE.match(str(s))
        if m:
            blocked.append((m.group(1), str(s)))
        else:
            skipped.append(str(s))
    return failed, blocked, skipped


def findings_naming(report, tid):
    pat = re.compile(r"\btask\s+" + re.escape(tid) + r"\b", re.IGNORECASE)
    return [str(f) for f in (report.get("completenessFindings") or [])
            if pat.search(str(f))]


def prior_attempt(task, findings):
    lines = ["PRIOR ATTEMPT: a prior round of this task failed — amend the kept work, "
             "do not reimplement from scratch."]
    branch, sha = str(task.get("branch") or ""), str(task.get("headSha") or "")
    if branch or sha:
        lines.append("- Kept branch: %s at %s. Pull correct prior work in with "
                     "git checkout %s -- <path> (one path at a time, re-verify each) "
                     "rather than rewriting it." % (branch or "?", sha or "?", sha or branch))
    if task.get("reviewVerdict"):
        lines.append("- Prior review verdict: " + str(task["reviewVerdict"]))
    if task.get("notes"):
        lines.append("- Blocking notes: " + str(task["notes"]))
    for f in findings:
        lines.append("- Completeness finding: " + f)
    return "\n\n" + "\n".join(lines) + "\n"


def not_attempted(unfinished_line, findings):
    lines = ["PRIOR ATTEMPT: not attempted in the prior round — " + unfinished_line]
    for f in findings:
        lines.append("- Completeness finding: " + f)
    return "\n\n" + "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--receipt", required=True)
    ap.add_argument("--report", required=True,
                    help="finalized report.json or the saved Workflow result envelope")
    ap.add_argument("--integration-branch", default=None)
    ap.add_argument("--out-dir", default=None,
                    help="defaults to the receipt's directory")
    a = ap.parse_args()

    ctx = ra.load_context(a.receipt, a.out_dir, a.integration_branch)
    report = load_report(a.report)
    failed, blocked, skipped = salvage_set(report)
    if not failed and not blocked:
        ra.die("nothing to salvage: no failed tasks and no blocked unfinished entries")
    tasks, entries = ctx["tasks"], ctx["entries"]
    selected = set()
    for t in failed:
        tid = str(t.get("task") or "")
        if tid not in tasks or tid not in entries:
            ra.die("failed task %r is unknown to the launch/args" % tid)
        selected.add(tid)
        tasks[tid]["body"] = tasks[tid].get("body", "") + prior_attempt(
            t, findings_naming(report, tid))
    for tid, line in blocked:
        if tid not in tasks or tid not in entries:
            ra.die("blocked unfinished task %r is unknown to the launch/args" % tid)
        if tid in selected:
            continue
        selected.add(tid)
        tasks[tid]["body"] = tasks[tid].get("body", "") + not_attempted(
            line, findings_naming(report, tid))
    if skipped:
        print("salvage_args: %d unfinished entr%s not salvaged (not failed/blocked — "
              "relaunch by redirect or a fresh launch): %s"
              % (len(skipped), "y" if len(skipped) == 1 else "ies", "; ".join(skipped)),
              file=sys.stderr)
    print(ra.emit_relaunch(ctx, selected, "salvage-args.json"))


if __name__ == "__main__":
    main()
```

`import redirect_args as ra` resolves because a script's own directory is `sys.path[0]` — both files live in `skills/ultrapowers/scripts/`.

- [ ] **Step 4: Run the tests and confirm green**

Run: `python3 -m pytest tests/test_salvage_args.py tests/test_redirect_args.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/salvage_args.py tests/test_salvage_args.py
git commit -m "feat(engine): salvage_args.py — deterministic Salvage relaunch composer (#222)"
```

---

### Task 3: residual_manifest.py --run-dir derives over every round's report

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/residual_manifest.py`
- Test: `tests/test_residual_manifest.py`

**Interfaces:**
- Consumes: nothing from sibling tasks (the `report-<n>.json` naming is a fixed convention shared with Task 1: `report-<n>.json` where `<n>` is a positive integer).
- Produces: CLI flag `--run-dir <runDir>` (derive mode; mutually exclusive with positional reports and `--check`), expanding to `report-<n>.json` files sorted by `<n>` ascending followed by `report.json` when present; dies (exit 1, `residual_manifest:` prefix) when the directory holds none. Module function `round_reports(run_dir: str) -> list[str]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_residual_manifest.py` (reuse its `report`, `write`, `run`, `manifest_rows` helpers and the `CF` constant):

```python
def test_run_dir_unions_round_reports_in_round_order_then_live(tmp_path):
    run_dir = tmp_path / "run-x"; run_dir.mkdir()
    write(run_dir, "report-2.json", report(completenessFindings=["second"]))
    write(run_dir, "report-10.json", report(completenessFindings=["tenth"]))
    write(run_dir, "report-1.json", report(completenessFindings=["first"]))
    write(run_dir, "report.json", report(completenessFindings=["live"]))
    r = run("--run-dir", run_dir)
    assert r.returncode == 0, r.stderr
    texts = [l.split("] ", 1)[1].split(" — disposition:")[0]
             for l in manifest_rows(r.stdout) if "[completenessFindings]" in l]
    assert texts == ["first", "second", "tenth", "live"]
    head = r.stdout.splitlines()[2]
    assert head.startswith("<!-- derived from: ")
    assert head.index("report-1.json") < head.index("report-2.json") < head.index("report-10.json") < head.index("report.json")


def test_run_dir_with_only_live_report(tmp_path):
    run_dir = tmp_path / "run-x"; run_dir.mkdir()
    write(run_dir, "report.json", report())
    r = run("--run-dir", run_dir)
    assert r.returncode == 0, r.stderr
    assert rid("completenessFindings", CF) in r.stdout


def test_run_dir_without_any_report_exits_1(tmp_path):
    run_dir = tmp_path / "run-x"; run_dir.mkdir()
    (run_dir / "report-final.json").write_text("{}")   # not a round file
    r = run("--run-dir", run_dir)
    assert r.returncode == 1 and "no report" in r.stderr


def test_run_dir_is_exclusive_with_positional_reports_and_check(tmp_path):
    run_dir = tmp_path / "run-x"; run_dir.mkdir()
    rp = write(run_dir, "report.json", report())
    r = run("--run-dir", run_dir, rp)
    assert r.returncode == 1 and "--run-dir" in r.stderr
    r = run("--run-dir", run_dir, "--check", tmp_path / "m.md")
    assert r.returncode == 1 and "--run-dir" in r.stderr
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_residual_manifest.py -v -k run_dir`
Expected: all four FAIL (argparse rejects `--run-dir`).

- [ ] **Step 3: Implement `--run-dir`**

In `skills/ultrapowers/scripts/residual_manifest.py`: add `import os` and, after `DISPOSITION`:

```python
ROUND_REPORT = re.compile(r"^report-(\d+)\.json$")


def round_reports(run_dir):
    """Every round's snapshot (report-<n>.json, ascending n) followed by the
    live report.json when present — the union input #222 makes mechanical."""
    try:
        names = os.listdir(run_dir)
    except OSError as e:
        die("unreadable run dir %r (%s)" % (run_dir, e))
    rounds = []
    for name in names:
        m = ROUND_REPORT.match(name)
        if m:
            rounds.append((int(m.group(1)), name))
    paths = [os.path.join(run_dir, name) for _, name in sorted(rounds)]
    live = os.path.join(run_dir, "report.json")
    if os.path.isfile(live):
        paths.append(live)
    if not paths:
        die("no report-<n>.json or report.json under %r" % run_dir)
    return paths
```

In `main()`, add the argument and the exclusivity/derive branches:

```python
    ap.add_argument("--run-dir", default=None, metavar="RUN_DIR",
                    help="derive over <RUN_DIR>/report-<n>.json (round order) "
                         "then <RUN_DIR>/report.json")
```

```python
    if a.run_dir:
        if a.reports or a.check:
            die("--run-dir takes no positional reports and no --check")
        a.reports = round_reports(a.run_dir)
```

placed before the existing `if a.check:` branch. Update the module docstring's Modes block with the third form: `derive: residual_manifest.py --run-dir <runDir> [--gate-acks ...]`.

- [ ] **Step 4: Run the tests and confirm green**

Run: `python3 -m pytest tests/test_residual_manifest.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/residual_manifest.py tests/test_residual_manifest.py
git commit -m "feat(engine): residual_manifest --run-dir unions every round's report-<n>.json (#222)"
```

---

### Task 4: SKILL.md Step 5 + finishing-notes — composers own relaunch, nothing is deleted

**Type:** implementation
**Depends-on:** 1, 2, 3

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/finishing-notes.md`

**Interfaces:**
- Consumes: the CLIs from Tasks 1–3 by name — `redirect_args.py` (rotation), `salvage_args.py --receipt --report`, `residual_manifest.py --run-dir`.
- Produces: nothing code-level.

Shrink budget (acceptance criterion): `wc -w skills/ultrapowers/SKILL.md` ≤ **2900** after the edit (it is 2920 today — the Salvage bullet loses its hand-composition instructions and the "delete heads/" rule).

- [ ] **Step 1: Rewrite the Salvage bullet in `skills/ultrapowers/SKILL.md` Step 5**

Replace the whole `- **Salvage** — …Return here.` bullet with exactly:

```markdown
- **Salvage** — offer whenever the report has `failed` tasks or dep-blocked
  `unfinished` entries. Run `python3 <pluginRoot>/skills/ultrapowers/scripts/salvage_args.py
  --receipt <runDir>/receipt.json --report <saved-result.json>`. It derives the
  salvage waves mechanically — every `failed` task plus every dep-/cascade-blocked
  `unfinished` task, in Step-2 order with their edges (budget-deferred entries are
  listed on stderr, not salvaged) — appends a **PRIOR ATTEMPT** block to each
  selected task's body from `tasks[]` (kept branch + HEAD sha, review verdict,
  blocking notes, completeness findings naming it, and the instruction to pull
  correct prior work in with `git checkout <sha> -- <path>` rather than
  reimplement), and composes the relaunch args by spreading the receipt's
  argsFile (`resume: true`, same `integrationBranch`). A hand-composed salvage is
  unsanctioned. Present the salvage waves, relaunch `ultrapowers-run` with the
  emitted args file, and record the new launch's printed Run ID
  (`record_wf_run.py <stamp> <wf_runId>`, as in Step 4). Return here.
```

- [ ] **Step 2: Amend the Redirect bullet and add the shared rotation sentence**

In the Redirect bullet, leave the `findings.json` grammar sentence exactly as it is today (its `narrow files` clause belongs to #223). After the sentence ending `…a relaunch reconstructing args from the report is refused by the harness.` insert a new bullet directly after the Redirect bullet (before **Terminal teardown**):

```markdown
- **Round artifacts** — both composers rotate the prior round's artifacts as
  their last step, after a successful emit: `report.json` is snapshotted to
  `report-<n>.json` and `heads/` renamed to `heads-<n>/`, so every round's gate
  report and sidecars survive and the relaunch's merge writes a fresh `heads/`
  (a stale higher `wave-<n>` slot can no longer win the critic's detach rule).
  Nothing is deleted; never clear `heads/` or `report.json` by hand.
```

- [ ] **Step 3: Point the union derivations at `--run-dir`**

In SKILL.md, change the **Resume gates derive the union** paragraph's parenthetical to `(`residual_manifest.py --run-dir <runDir>` — every round's `report-<n>.json` plus the live `report.json`)`, and in the Approve bullet change `derive `<runDir>/residual-manifest.md` from every round's gate report` to `derive `<runDir>/residual-manifest.md` (`residual_manifest.py --run-dir <runDir>`)`.

In `skills/ultrapowers/references/finishing-notes.md` §Residual manifest, replace the derive command block:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/residual_manifest.py \
  --run-dir <runDir> [--gate-acks <runDir>/standing-approval.json] \
  > <runDir>/residual-manifest.md
```

and reword the sentence above it to: "Derive it from **all** of this run's gate reports — the composers snapshot each round's `report.json` to `report-<n>.json`, so `--run-dir` unions every round plus the live report; the union is computed, never remembered:".

- [ ] **Step 4: Verify the budget and the prose pins**

Run: `wc -w skills/ultrapowers/SKILL.md` — Expected: ≤ 2900.
Run: `grep -n "delete\s*\`<runDir>/heads/\`\|narrow \`files\` to the fix" skills/ultrapowers/SKILL.md` — Expected: the `delete <runDir>/heads/` line is gone; the `narrow files` clause is still present (untouched for #223).
Run: `python3 -m pytest tests/ -q -k "skill or recommendation or ultraplan"` — Expected: PASS (the Step-5 wording has no test pin; the rubric/marker pins must stay green).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/finishing-notes.md
git commit -m "docs(skill): Step 5 — salvage_args composer, round-artifact rotation, --run-dir union; delete the heads/ deletion rule (#222)"
```

---

### Task 5: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: all green.

---

## Operator smoke

- do: `python3 skills/ultrapowers/scripts/salvage_args.py --receipt /nonexistent/receipt.json --report /nonexistent/report.json; echo exit=$?`
  see: one `salvage_args: unreadable receipt …` line on stderr, `exit=1`, no traceback.
- do: `python3 skills/ultrapowers/scripts/residual_manifest.py --run-dir /tmp; echo exit=$?`
  see: `residual_manifest: no report-<n>.json or report.json under '/tmp'` and `exit=1`.
- do: open `skills/ultrapowers/SKILL.md` Step 5 and search for "delete".
  see: no instruction to delete `heads/`; the Salvage bullet names `salvage_args.py`; a **Round artifacts** bullet sits between Redirect and Terminal teardown.
