# Micro-Redirect Lane Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redirect relaunch args become deterministic (`redirect_args.py`: receipt + findings → validated resume args, amend-only) and the SKILL's Redirect bullet + the gate's fix-before-merge affordance point at that lane — per spec `docs/superpowers/specs/2026-08-06-micro-redirect-lane-design.md` (issue #115; part 3 deleted per the spec's trim-reviewed argument).

**Architecture:** The helper reads the run receipt's `argsFile`, follows its `wavesPath` to the launch file, applies amend entries (body `REDIRECT:` append in a launch-file copy; files/tier in an args copy), and emits `redirect-args.json` with `resume: true` + the explicit `integrationBranch` waves.js requires (waves.js:200-202). Originals are never mutated — untouched tasks stay byte-identical so the journal cache replays them.

**Tech Stack:** Python 3 (stdlib only), pytest.

**Acceptance:** suite — the committed suite is the verification.

## Global Constraints

- Only `skills/ultrapowers/scripts/redirect_args.py` (new), `tests/test_redirect_args.py` (new), `skills/ultrapowers/SKILL.md`, and `skills/ultrapowers/references/report-format.md` change. No gate/lock/sweep scripts, no waves.js, no frozen-periphery files.
- The helper never launches anything and never mutates the original args/launch files — it emits new files into the run dir.
- SKILL.md stays within the complexity-ratchet budget: the rewritten Redirect bullet replaces the existing hand-surgery incantation; the ratchet test in the suite must stay green.
- No new dependencies, no Anthropic SDK, no API keys.
- Suite gate: `python3 -m pytest` green after every task.

---

### Task 1: `redirect_args.py` + tests

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `skills/ultrapowers/scripts/redirect_args.py`
- Test: `tests/test_redirect_args.py`

**Interfaces:**
- Consumes: the receipt/args/launch file shapes emitted by `ultra_run.py` + `compile_plan.py --emit-args/--emit-launch` (receipt: `argsFile`; args: `waves` entries `{id, files, tier, review, …}`, `wavesPath`, `pluginRoot`, `runDir`; launch: `tasks: {id: {body, files, …}}`).
- Produces: CLI `python3 skills/ultrapowers/scripts/redirect_args.py --receipt <runDir>/receipt.json --findings <findings.json> [--integration-branch <branch>] [--out-dir <dir>]` → prints the emitted `redirect-args.json` path on success (exit 0); exit 1 with a named error otherwise.

Tier: standard.

findings.json contract (amend-only, spec §2): a non-empty JSON list of `{"task": "<id>", "instruction": "<text>", "files": [...]?, "tier": "<tier>"?}`. The integration branch comes from `--integration-branch`, else from `<runDir>/gate-receipt.json`'s `integrationBranch`; neither → exit 1.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_redirect_args.py
import json, subprocess, sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts/redirect_args.py"


def make_run(tmp_path):
    run = tmp_path / "run-20260806-1"
    run.mkdir()
    launch = {"tasks": {"1": {"id": "1", "body": "### Task 1\n\ndo the thing", "files": ["a.py"]},
                        "2": {"id": "2", "body": "### Task 2\n\nother thing", "files": ["b.py"]}},
              "waves": [["1", "2"]]}
    launch_p = run / "launch.json"
    launch_p.write_text(json.dumps(launch))
    args = {"planPath": "docs/p.md", "pluginRoot": "/pr", "runDir": str(run),
            "wavesPath": str(launch_p),
            "waves": [[{"id": "1", "files": ["a.py"], "tier": None, "review": "lean"},
                       {"id": "2", "files": ["b.py"], "tier": None, "review": "lean"}]]}
    args_p = run / "args.json"
    args_p.write_text(json.dumps(args))
    (run / "receipt.json").write_text(json.dumps({"argsFile": str(args_p), "runDir": str(run)}))
    (run / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "BLOCKED", "integrationBranch": "ultra/int-1"}))
    return run


def run_helper(run, findings, *extra):
    f = run / "findings.json"
    f.write_text(json.dumps(findings))
    return subprocess.run([sys.executable, str(SCRIPT), "--receipt", str(run / "receipt.json"),
                           "--findings", str(f), *extra], capture_output=True, text=True)


def test_amend_appends_redirect_narrows_files_sets_tier_keeps_siblings(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "fix the guard",
                          "files": ["a.py", "c.py"], "tier": "standard"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["resume"] is True
    assert out_args["integrationBranch"] == "ultra/int-1"      # from gate-receipt.json
    assert out_args["pluginRoot"] == "/pr" and out_args["runDir"]  # receipt spread carried
    new_launch = json.loads(Path(out_args["wavesPath"]).read_text())
    assert "REDIRECT: fix the guard" in new_launch["tasks"]["1"]["body"]
    assert new_launch["tasks"]["1"]["files"] == ["a.py", "c.py"]
    assert new_launch["tasks"]["2"] == json.loads((run / "launch.json").read_text())["tasks"]["2"]
    entry1 = out_args["waves"][0][0]
    assert entry1["tier"] == "standard" and entry1["files"] == ["a.py", "c.py"]
    # originals untouched
    assert "REDIRECT" not in (run / "launch.json").read_text()
    assert "resume" not in json.loads((run / "args.json").read_text())


def test_unknown_task_id_exits_1(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "9", "instruction": "x"}])
    assert r.returncode == 1 and "9" in r.stderr


def test_missing_instruction_exits_1(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1"}])
    assert r.returncode == 1 and "instruction" in r.stderr


def test_missing_argsfile_exits_1(tmp_path):
    run = make_run(tmp_path)
    (run / "receipt.json").write_text(json.dumps({"argsFile": str(run / "gone.json")}))
    r = run_helper(run, [{"task": "1", "instruction": "x"}])
    assert r.returncode == 1 and "argsFile" in r.stderr


def test_no_branch_source_exits_1(tmp_path):
    run = make_run(tmp_path)
    (run / "gate-receipt.json").unlink()
    r = run_helper(run, [{"task": "1", "instruction": "x"}])
    assert r.returncode == 1 and "integration" in r.stderr.lower()


def test_explicit_branch_flag_overrides(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "x"}],
                   "--integration-branch", "ultra/other")
    assert r.returncode == 0, r.stderr
    assert json.loads(Path(r.stdout.strip()).read_text())["integrationBranch"] == "ultra/other"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_redirect_args.py -v`
Expected: FAIL/ERROR everywhere (script absent).

- [ ] **Step 3: Implement**

```python
#!/usr/bin/env python3
"""Author redirect relaunch args deterministically (#115).

Reads the run receipt's argsFile and its launch file (wavesPath), applies
amend-only findings (body REDIRECT append, file-scope narrow, tier
right-size) to COPIES, and emits redirect-args.json with resume: true and the
explicit integrationBranch the resume path requires. The orchestrator authors
findings.json from the gate report; this helper validates and applies that
judgment — it never launches anything and never mutates the originals.
"""
import argparse
import json
import os
import sys


def die(msg):
    print("redirect_args: " + msg, file=sys.stderr)
    sys.exit(1)


def load_json(path, what):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, TypeError) as e:
        die("unreadable %s %r (%s)" % (what, path, e))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--receipt", required=True)
    ap.add_argument("--findings", required=True)
    ap.add_argument("--integration-branch", default=None)
    ap.add_argument("--out-dir", default=None,
                    help="defaults to the receipt's directory")
    a = ap.parse_args()

    receipt = load_json(a.receipt, "receipt")
    args_path = receipt.get("argsFile")
    if not (isinstance(args_path, str) and os.path.isfile(args_path)):
        die("receipt has no readable argsFile: %r" % args_path)
    args = load_json(args_path, "argsFile")
    launch_path = args.get("wavesPath")
    if not (isinstance(launch_path, str) and os.path.isfile(launch_path)):
        die("args has no readable wavesPath: %r" % launch_path)
    launch = load_json(launch_path, "launch file")

    run_dir = a.out_dir or os.path.dirname(os.path.abspath(a.receipt))
    branch = a.integration_branch
    if not branch:
        gr_path = os.path.join(run_dir, "gate-receipt.json")
        if os.path.isfile(gr_path):
            branch = (load_json(gr_path, "gate receipt") or {}).get("integrationBranch")
    if not branch:
        die("no integration branch: pass --integration-branch or provide "
            "gate-receipt.json next to the receipt")

    findings = load_json(a.findings, "findings")
    if not (isinstance(findings, list) and findings):
        die("findings must be a non-empty JSON list of amend entries")

    tasks = launch.get("tasks") or {}
    entries = {e.get("id"): e for wave in (args.get("waves") or []) for e in wave}
    for i, f in enumerate(findings):
        tid = str(f.get("task") or "")
        if tid not in tasks or tid not in entries:
            die("finding %d names unknown task %r" % (i, tid))
        instruction = (f.get("instruction") or "").strip()
        if not instruction:
            die("finding %d (task %s) has no instruction" % (i, tid))
        tasks[tid]["body"] = tasks[tid].get("body", "") + "\n\nREDIRECT: " + instruction + "\n"
        if f.get("files"):
            tasks[tid]["files"] = list(f["files"])
            entries[tid]["files"] = list(f["files"])
        if f.get("tier"):
            entries[tid]["tier"] = f["tier"]

    new_launch_path = os.path.join(run_dir, "redirect-launch.json")
    with open(new_launch_path, "w") as f:
        json.dump(launch, f, indent=2)
    out = dict(args)
    out.update({"resume": True, "integrationBranch": branch,
                "wavesPath": new_launch_path})
    new_args_path = os.path.join(run_dir, "redirect-args.json")
    with open(new_args_path, "w") as f:
        json.dump(out, f, indent=2)
    print(new_args_path)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_redirect_args.py -v`
Expected: 6 passed.

- [ ] **Step 5: Full suite**

Run: `python3 -m pytest`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/redirect_args.py tests/test_redirect_args.py
git commit -m "feat(#115): redirect_args.py — deterministic amend-only relaunch args from receipt + findings"
```

---

### Task 2: Redirect bullet rewrite + fix-before-merge retarget

**Type:** implementation
**Depends-on:** 1
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`

**Interfaces:**
- Consumes: the Task 1 CLI (`redirect_args.py --receipt … --findings …` → prints the emitted args path).
- Produces: nothing consumed by other tasks.

Tier: cheap.

- [ ] **Step 1: Rewrite the Redirect bullet in SKILL.md Step 5**

Replace the existing Redirect bullet (currently: "append corrective instructions to only the affected task bodies and relaunch `ultrapowers-run` with `resume: true`, the same `integrationBranch`, and args spread from the receipt's argsFile …") with:

> - **Redirect (micro-redirect)** — author `findings.json` from the gate report (one amend entry per affected task: `{"task", "instruction", "files"?, "tier"?}` — narrow `files` to the fix, right-size `tier` down when the fix is mechanical), then run `python3 <pluginRoot>/skills/ultrapowers/scripts/redirect_args.py --receipt <runDir>/receipt.json --findings <findings.json>` and relaunch `ultrapowers-run` with the emitted args file. Untouched tasks replay from journal cache, so a one-task fix costs one task; the fix still flows through its implementer, reviewer, wave merge, and a fresh gate. Inline commits on the integration branch are unsanctioned — route every post-gate edit through this lane. Return here.

The replaced incantation pays for the addition: the SKILL.md complexity-ratchet test must stay green (trim adjacent Step-5 prose in the same edit only if it is not).

- [ ] **Step 2: Retarget the fix-before-merge affordance in report-format.md**

Locate the gate-presentation text offering a fix-first/fix-before-merge option (the three-option gate presentation). Amend it so the fix-first option names the micro-redirect lane (`redirect_args.py` + resume relaunch) as its mechanism — not an edit on the integration branch. If the affordance's wording lives only in SKILL.md Step 5 (already rewritten in Step 1), record that in the commit message and make no report-format change beyond verifying none is needed.

- [ ] **Step 3: Run the suite (ratchet + pins included)**

Run: `python3 -m pytest`
Expected: green — in particular the SKILL.md ratchet test and any prose pins over the Redirect text (update any pin that quotes the old incantation in the same commit).

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md
git commit -m "docs(#115): Redirect bullet is the micro-redirect; fix-before-merge points at the lane; inline commits unsanctioned"
```
