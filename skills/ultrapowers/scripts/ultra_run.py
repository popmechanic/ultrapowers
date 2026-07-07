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
    "waves[][].tier on the args-file wave entries (slots pre-emitted as null; "
    "the engine reads knobs ONLY from these inline entries — never a top-level "
    "launch key, never tierOverrides, which remaps tier names to models)",
    "testCmd — run-wide and/or per-task, only when detection would guess wrong",
    "bootstrapCmd — per-worktree dependency install for fresh worktrees; "
    "validate with --validate-knobs before launch",
    "nothing for review depth — it is plan-authored (**Review:** marker), "
    "pre-filled on the args wave entries",
]

VALID_TIERS = {None, "cheap", "standard", "mostCapable", "most-capable"}
VALID_REVIEWS = {"lean", "adversarial"}


def sh(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def validate_knobs(args_path, root):
    """Pre-launch knob validation, fail-closed (#89): every wave entry's
    tier/review must be a value the engine accepts, and a bootstrapCmd must
    be a clean no-op on the session checkout — a bad knob otherwise fails
    inside every worktree simultaneously. Exit 0 = safe."""
    try:
        knobs = json.loads(Path(args_path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(json.dumps({"ok": False, "stage": "knob-validate",
                          "detail": "unreadable args file: %s" % e}))
        return 1
    for wave in knobs.get("waves") or []:
        for t in wave:
            tid = t.get("id", "?")
            if t.get("tier") not in VALID_TIERS:
                print(json.dumps({"ok": False, "stage": "knob-validate",
                                  "detail": "task %s: tier %r is not "
                                            "null|cheap|standard|mostCapable"
                                            % (tid, t.get("tier"))}))
                return 1
            if t.get("review") not in VALID_REVIEWS:
                print(json.dumps({"ok": False, "stage": "knob-validate",
                                  "detail": "task %s: review %r is not "
                                            "lean|adversarial"
                                            % (tid, t.get("review"))}))
                return 1
    cmd = knobs.get("bootstrapCmd")
    if not (isinstance(cmd, str) and cmd.strip()):
        print(json.dumps({"ok": True, "stage": "knob-validate",
                          "detail": "no bootstrapCmd — nothing to validate"}))
        return 0
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


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", type=Path, nargs="?")
    ap.add_argument("--stamp", default=None)
    ap.add_argument("--repo", type=Path, default=Path.cwd())
    ap.add_argument("--validate-knobs", type=Path, default=None,
                    metavar="ARGSFILE", dest="validate_knobs",
                    help="pre-launch knob validation only; skips the launch pipeline")
    a = ap.parse_args(argv)

    if a.validate_knobs is not None:
        r = sh(["git", "rev-parse", "--show-toplevel"], cwd=a.repo)
        if r.returncode != 0:
            print(json.dumps({"ok": False, "stage": "knob-validate",
                              "detail": r.stderr or "not inside a git repository"}))
            return 1
        return validate_knobs(a.validate_knobs, Path(r.stdout.strip()))

    if a.plan is None:
        ap.error("plan is required unless --validate-knobs is given")

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
