#!/usr/bin/env python3
"""Deterministic pre-launch driver for /ultrapowers (SKILL.md Steps 1-4b).

One invocation runs every deterministic pre-launch stage in order, fail-closed:
git-repo check, worktree-capability probe, self-host engine skew, superpowers
compatibility, plan compile, committed-workflow install, run lock + dirty
baseline, and deterministic knob derivation (baseBranch from the launched
checkout, probe payload).

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
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESSES = HERE.parent / "harnesses"
PLUGIN_ROOT = HERE.parents[2]

RUN_DIR_RE = re.compile(r"^run-\d{8}-\d{6}$")
KEEP_RUNS = 10


def _run_dirs(state_dir):
    """All state_dir entries matching the strict run-<stamp> pattern, sorted
    oldest-first (the stamp format sorts lexicographically = chronologically)."""
    if not state_dir.is_dir():
        return []
    return sorted(d for d in state_dir.iterdir()
                  if d.is_dir() and RUN_DIR_RE.match(d.name))


def _doomed(state_dir, keep):
    runs = _run_dirs(state_dir)
    return runs[:-keep] if keep else runs


def prune_run_dirs(state_dir, keep=KEEP_RUNS):
    """Keep the newest `keep` run dirs; delete older ones. Matches ONLY
    strict run-<stamp> names — everything else under the state dir
    (scratch/, pending seal dirs, operator files) is not ours to touch.
    Stamp format sorts lexicographically = chronologically. Returns only the
    names actually removed — a failed rmtree (ignore_errors=True swallows
    the exception) must not be reported as pruned."""
    doomed = _doomed(state_dir, keep)
    for d in doomed:
        shutil.rmtree(d, ignore_errors=True)
    return [d.name for d in doomed if not d.exists()]

def detect_test_cmd(root):
    """Deterministic test-command detection ladder (#96). File presence only,
    no LLM, no execution. Returns (command, rule) or (None, None)."""
    root = Path(root)
    if (root / "pytest.ini").is_file():
        return "python3 -m pytest", "pytest-ini"
    pyproject = root / "pyproject.toml"
    if pyproject.is_file() and "[tool.pytest" in pyproject.read_text(errors="ignore"):
        return "python3 -m pytest", "pyproject-pytest"
    pkg = root / "package.json"
    if pkg.is_file():
        try:
            scripts = json.loads(pkg.read_text()).get("scripts") or {}
        except (json.JSONDecodeError, AttributeError):
            scripts = {}
        if "test" in scripts:
            if (root / "pnpm-lock.yaml").is_file():
                return "pnpm test", "package-json-pnpm"
            if (root / "bun.lock").is_file() or (root / "bun.lockb").is_file():
                return "bun test", "package-json-bun"
            return "npm test", "package-json-npm"
    mk = root / "Makefile"
    if mk.is_file() and re.search(r"^test\s*:", mk.read_text(errors="ignore"), re.M):
        return "make test", "makefile-test"
    if (root / "go.mod").is_file():
        return "go test ./...", "go-mod"
    if (root / "Cargo.toml").is_file():
        return "cargo test", "cargo-toml"
    return None, None


PROBE = {"name": "ultrapowers-probe",
         "args": {"ping": "pong",
                  "waves": [{"id": "probe-1", "title": "probe", "body": "b"}]},
         "assert": {"echoWaves": 1, "echoFirstId": "probe-1"}}

LLM_DERIVES = [
    "waves[][].tier on the args-file wave entries (slots pre-emitted as null; "
    "the engine reads knobs ONLY from these inline entries — never a "
    "top-level launch key)",
    "waves[][].testCmd per task, only for polyglot plans where one task's stack "
    "differs from the run-wide command (run-wide testCmd is driver-derived — "
    "knob or detection — and already stamped in the args file and receipt)",
    "nothing for bootstrapCmd — pass --bootstrap-cmd to the preflight driver "
    "instead, so the receipt and the gate share the validated value",
    "nothing for review depth — it is plan-authored (**Review:** marker), "
    "pre-filled on the args wave entries",
]

VALID_TIERS = {None, "cheap", "standard", "mostCapable", "most-capable"}
VALID_REVIEWS = {"lean", "adversarial"}

OVERLAP_CHOICES = ("serialize", "fold")


def compile_argv(plan, run_dir, root, overlap=None):
    """Build the compile_plan.py argv (everything after the script path)
    for a launch. Pure — no I/O — so this seam is testable without a real
    repo or a real compile_plan.py subprocess.

    `--repo-root <root>` is ALWAYS stamped from the driver's own repo root
    (the compiler's eligibility pre-filter is inert without it — never off
    by omission). `--overlap <mode>` is added only when the caller passed
    one explicitly; absent, the compiler's own OVERLAP_DEFAULT governs."""
    argv = [str(plan),
            "--emit-launch", str(run_dir / "launch.json"),
            "--emit-args", str(run_dir / "args.json"),
            "--run-dir", str(run_dir.resolve())]
    if overlap is not None:
        argv += ["--overlap", overlap]
    argv += ["--repo-root", str(root)]
    return argv


def sh(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def write_dirty_baseline(root):
    """Record the launch-time dirty set to `.claude/ultrapowers/DIRTY_SNAPSHOT`
    — `git status --porcelain` redirected to the file, nothing else.

    This is gate_check.py's new-vs-pre-existing partition key: dirt listed here
    predates the run and is the operator's, so the gate notes it instead of
    accusing a role. #104 retired the snapshot/restore family that used to
    write it, so the driver writes it directly; the checkout-position half
    (CHECKOUT_SNAPSHOT) died with the family. Returns the CompletedProcess so
    the caller can stage on its exit code (fail-closed: a git that could not
    report status leaves an empty baseline, i.e. strict)."""
    dest = Path(root) / ".claude/ultrapowers/DIRTY_SNAPSHOT"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w") as fh:
        return subprocess.run(["git", "status", "--porcelain"], cwd=root,
                              stdout=fh, stderr=subprocess.PIPE, text=True)


def validate_knobs(args_path, root):
    """Pre-launch knob validation, fail-closed (#89): every wave entry's
    tier/review must be a value the engine accepts, and a bootstrapCmd must
    be a clean no-op when rehearsed in a throwaway worktree (#99) — never on
    the session checkout, so a wrong draft cannot mutate the operator's tree.
    The worktree bounds repo-tree mutations only: shared global package
    caches (pip/npm/uv), outside-the-repo venvs, and network effects escape
    it. Exit 0 = safe."""
    try:
        knobs = json.loads(Path(args_path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(json.dumps({"ok": False, "stage": "knob-validate",
                          "detail": "unreadable args file: %s" % e}))
        return 1
    if not isinstance(knobs, dict):
        print(json.dumps({"ok": False, "stage": "knob-validate",
                          "detail": "args file is not a JSON object: %r" % knobs}))
        return 1
    try:
        for wi, wave in enumerate(knobs.get("waves") or []):
            if not isinstance(wave, list):
                print(json.dumps({"ok": False, "stage": "knob-validate",
                                  "detail": "waves[%d] is not a list" % wi}))
                return 1
            for t in wave:
                if not isinstance(t, dict):
                    print(json.dumps({"ok": False, "stage": "knob-validate",
                                      "detail": "waves[%d] entry %r is not an object"
                                                % (wi, t)}))
                    return 1
                tid = t.get("id", "?")
                if t.get("tier") not in VALID_TIERS:
                    print(json.dumps({"ok": False, "stage": "knob-validate",
                                      "detail": "task %s: tier %r is not "
                                                "null|cheap|standard|mostCapable "
                                                "(alias most-capable)"
                                                % (tid, t.get("tier"))}))
                    return 1
                if t.get("review") not in VALID_REVIEWS:
                    print(json.dumps({"ok": False, "stage": "knob-validate",
                                      "detail": "task %s: review %r is not "
                                                "lean|adversarial"
                                                % (tid, t.get("review"))}))
                    return 1
    except TypeError as e:
        print(json.dumps({"ok": False, "stage": "knob-validate",
                          "detail": "malformed waves shape: %s" % e}))
        return 1
    cmd = knobs.get("bootstrapCmd")
    test_cmd = knobs.get("testCmd")
    has_bootstrap = isinstance(cmd, str) and bool(cmd.strip())
    has_test = isinstance(test_cmd, str) and bool(test_cmd.strip())
    if not has_bootstrap and not has_test:
        print(json.dumps({"ok": True, "stage": "knob-validate",
                          "detail": "no bootstrapCmd — nothing to validate"}))
        return 0
    probe_wt = root / ".claude/ultrapowers" / ("wt-knob-%d" % os.getpid())
    r = sh(["git", "worktree", "add", "--detach", str(probe_wt), "HEAD"],
           cwd=root)
    if r.returncode != 0:
        print(json.dumps({"ok": False, "stage": "knob-validate",
                          "detail": "cannot cut probe worktree: %s"
                                    % (r.stderr or r.stdout).strip()}))
        return 1
    try:
        result = {"ok": True, "stage": "knob-validate"}
        bootstrap_red = False
        if has_bootstrap:
            proc = subprocess.run(cmd, shell=True, cwd=probe_wt,
                                  capture_output=True, text=True)
            # Porcelain captured BEFORE the baseline: a fresh detached
            # worktree starts clean, so any status output IS the bootstrap's
            # own mutation — treeClean stays a bootstrap-only verdict.
            dirt = sh(["git", "status", "--porcelain"], cwd=probe_wt).stdout
            result.update({"exit": proc.returncode, "treeClean": not dirt,
                           "output": (proc.stdout + proc.stderr)[-2000:]})
            if proc.returncode != 0 or dirt:
                # Bootstrap red short-circuits the baseline, but the print
                # happens AFTER finally so a worktree-removal failure note is
                # never lost (single-exit funnel).
                result["ok"] = False
                bootstrap_red = True
        baseline_red = False
        if has_test and not bootstrap_red:
            try:
                bl = subprocess.run(test_cmd, shell=True, cwd=probe_wt,
                                    capture_output=True, text=True,
                                    timeout=1800)
                result["baseline"] = {"ok": bl.returncode == 0,
                                      "exit": bl.returncode,
                                      "output": (bl.stdout + bl.stderr)[-2000:]}
            except subprocess.TimeoutExpired:
                result["baseline"] = {"ok": False, "exit": -1,
                                      "output": "[baseline timed out after 1800s]"}
            baseline_red = not result["baseline"]["ok"]
    finally:
        rm = sh(["git", "worktree", "remove", "--force", str(probe_wt)],
                cwd=root)
        if rm.returncode != 0:
            result.setdefault("output", "")
            result["output"] += ("\n[probe worktree removal failed: %s]"
                                 % rm.stderr.strip())
    print(json.dumps(result))
    if bootstrap_red:
        return 1
    return 3 if baseline_red else 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", type=Path, nargs="?")
    ap.add_argument("--stamp", default=None)
    ap.add_argument("--repo", type=Path, default=Path.cwd())
    ap.add_argument("--validate-knobs", type=Path, default=None,
                    metavar="ARGSFILE", dest="validate_knobs",
                    help="pre-launch knob validation only; skips the launch pipeline")
    ap.add_argument("--test-cmd", default=None,
                    help="run-wide suite command; wins over detection")
    ap.add_argument("--bootstrap-cmd", default=None,
                    help="per-worktree dependency install; stamped into the "
                         "receipt so the gate provisions its acceptance worktree")
    ap.add_argument("--overlap", choices=OVERLAP_CHOICES, default=None,
                    help="scheduling knob forwarded to compile_plan.py's "
                         "--overlap; omit to use the compiler's own default "
                         "(serialize)")
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

    def stage(name, ok, success="", failure=""):
        stages.append({"stage": name, "ok": bool(ok),
                       "detail": str(success if ok else failure).strip()[-2000:]})
        return bool(ok)

    def bail():
        print(json.dumps(receipt, indent=2))
        return 1

    r = sh(["git", "rev-parse", "--show-toplevel"], cwd=a.repo)
    if not stage("git-repo", r.returncode == 0,
                 success=r.stdout.strip(),
                 failure=r.stderr or "not inside a git repository"):
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
    if not stage("worktree-probe", wt_ok,
                 success="worktree capability verified (probe cut and removed)",
                 failure=r.stderr):
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
                  success="SKEW — repo waves.js copied into .claude/workflows")
        elif not stage("engine-skew", r.returncode == 0,
                       success=out or "IN_SYNC",
                       failure=out or "skew check failed"):
            return bail()
    else:
        stage("engine-skew", True, success="skipped — not self-hosting")

    # Superpowers compatibility: non-zero means a contract token is missing —
    # the orchestrator surfaces the human gate; the driver just fails closed.
    r = sh([sys.executable, str(HERE / "check_superpowers_compat.py")], cwd=root)
    if not stage("superpowers-compat", r.returncode == 0,
                 success="contract verified against the enabled superpowers",
                 failure=r.stdout + r.stderr):
        return bail()

    # Scratch hygiene: the state dir self-ignores (content `*`) so every run
    # dir is structurally invisible to git in any repo, and old run records
    # are pruned keep-newest-10 — a live run's stamp is always the newest, so
    # the keep-10 window always retains it regardless of lock state. Exhaust
    # (<runDir>/review) is deleted earlier, at the SKILL.md gate step; this
    # prune is the crash backstop that gives cleanup a trigger even when a
    # run died before its gate.
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / ".gitignore").write_text("*\n")
    doomed_names = [d.name for d in _doomed(state_dir, KEEP_RUNS)]
    pruned = prune_run_dirs(state_dir)
    if not doomed_names:
        detail = "nothing to prune"
    else:
        detail = "pruned %d old run dir(s)" % len(pruned)
        failed = [n for n in doomed_names if n not in pruned]
        if failed:
            detail += "; %d removal failed: %s" % (len(failed), ", ".join(failed))
    stage("scratch-hygiene", True, success=detail)

    run_dir.mkdir(parents=True, exist_ok=True)
    launch, args_file = run_dir / "launch.json", run_dir / "args.json"
    r = sh([sys.executable, str(HERE / "compile_plan.py")]
           + compile_argv(a.plan, run_dir, root, a.overlap),
           cwd=root)
    compile_obj, summary = None, ""
    if r.returncode == 0:
        compile_obj = json.loads(r.stdout)
        waves = compile_obj.get("waves") or []
        mode = (compile_obj.get("acceptance") or {}).get("mode") or "unmarked"
        summary = "%d task(s) in %d wave(s); acceptance: %s" % (
            sum(len(w) for w in waves), len(waves), mode)
    if not stage("compile", r.returncode == 0,
                 success=summary, failure=r.stderr or r.stdout):
        return bail()
    receipt["compile"] = compile_obj

    # An explicitly-passed knob is judged on its stripped value: a whitespace
    # command would be stamped verbatim and eval to a false green at the gate,
    # and an empty one would silently fall through to detection (#105). Both
    # are knob-drops the operator never sees, so both fail the stage loudly.
    if a.test_cmd is not None:
        knob = a.test_cmd.strip()
        if not knob:
            stage("test-command", False,
                  failure="--test-cmd was passed but is empty/whitespace — "
                          "refusing the silent knob-drop; pass a real command "
                          "or omit the flag for detection")
            return bail()
        test_cmd, test_src = knob, "knob"
    else:
        test_cmd, rule = detect_test_cmd(root)
        test_src = ("detected:" + rule) if test_cmd else None
    if not stage("test-command", bool(test_cmd),
                 success=("%s (%s)" % (test_cmd, test_src)) if test_cmd else "",
                 failure="no test command detected — pass --test-cmd <run-wide "
                         "suite command>; the gate refuses to run without one"):
        return bail()
    args_obj = json.loads(args_file.read_text())
    args_obj["testCmd"] = test_cmd
    if a.bootstrap_cmd:
        args_obj["bootstrapCmd"] = a.bootstrap_cmd
    args_file.write_text(json.dumps(args_obj, indent=2))

    wf_dir = root / ".claude/workflows"
    wf_dir.mkdir(parents=True, exist_ok=True)
    installed = []
    for manifest in sorted(HARNESSES.glob("*.harness.json")):
        fname = json.loads(manifest.read_text())["file"]
        shutil.copy2(HARNESSES / fname, wf_dir / fname)
        installed.append(fname)
    if not stage("install", bool(installed),
                 success="installed: " + ", ".join(installed),
                 failure="no harness manifests found under " + str(HARNESSES)):
        return bail()

    r = sh(["bash", str(HERE / "run_lock.sh"), "acquire", stamp], cwd=root)
    if not stage("lock", r.returncode == 0,
                 success="lock acquired: " + stamp,
                 failure=r.stderr or r.stdout):
        return bail()
    r = write_dirty_baseline(root)
    dirt_lines = len([l for l in (root / ".claude/ultrapowers/DIRTY_SNAPSHOT")
                      .read_text().splitlines() if l.strip()])
    if not stage("dirty-baseline", r.returncode == 0,
                 success="dirty baseline recorded: %d pre-existing line(s)"
                         % dirt_lines,
                 failure=r.stderr):
        return bail()

    # Janitor advisory (requirement 3, vibes.diy 2026-07-31): surface leftover
    # engine worktrees/branches from CONCLUDED runs at the next launch, so
    # "kept for inspection" cannot silently become kept-forever. The lock is
    # already held, so this run is exempt by construction. Advisory only —
    # a janitor report must never block a launch.
    r = sh(["bash", str(HERE / "sweep_worktrees.sh"), "--audit"], cwd=root)
    audit_out = (r.stdout or r.stderr or "").strip()
    stage("worktree-audit", True, success=audit_out or "audit produced no output")

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
    stage("base-branch", bool(base),
          success=base_note or base, failure="no branch resolvable")
    if not base:
        return bail()

    receipt.update({"ok": True, "lockId": stamp, "baseBranch": base,
                    "launchFile": str(launch), "argsFile": str(args_file),
                    "workflowName": "ultrapowers-run", "probe": PROBE,
                    "llmDerives": LLM_DERIVES,
                    "testCmd": test_cmd, "testCmdSource": test_src})
    if a.bootstrap_cmd:
        receipt["bootstrapCmd"] = a.bootstrap_cmd
    (run_dir / "receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
