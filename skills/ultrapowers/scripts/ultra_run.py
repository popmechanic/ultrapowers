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
still owns.
"""
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
