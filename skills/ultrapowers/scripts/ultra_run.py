#!/usr/bin/env python3
"""Deterministic pre-launch driver for /ultrapowers (run on the sandbox by fleet/run-main.mjs).

One invocation runs every deterministic pre-launch stage in order, fail-closed:
fleet-run (the sandbox env contract), git-repo check, worktree-capability
probe, plan compile, test-command derivation, bootstrap-command derivation
(the lockfile-implied install, run-66), dirty baseline, and baseBranch from
the launched checkout.

The receipt (stdout + .claude/ultrapowers/run-<stamp>/receipt.json) is the
contract: the engine (fleet/run-main.mjs) reads it instead of re-deriving the
choreography. Exit 0 iff every stage passed; otherwise the last receipt stage
names what failed. The driver never dispatches an agent; `llmDerives` names
what is left to judgment.
"""
from __future__ import annotations

import argparse
import datetime
import functools
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


@functools.lru_cache(maxsize=1)
def _xdist_available():
    """#426: probe the `python3` on PATH — the interpreter testCmd will invoke,
    which need not be sys.executable — for pytest-xdist. Runs from a neutral
    cwd so a target repo vendoring a top-level `xdist/` dir cannot fake the
    import. `ULTRAPOWERS_XDIST=0` opts out. Fail closed: any probe error
    means serial pytest, never a broken `-n auto`."""
    if os.environ.get("ULTRAPOWERS_XDIST") == "0":
        return False
    try:
        return subprocess.run(["python3", "-c", "import xdist"],
                              capture_output=True, timeout=30,
                              cwd=tempfile.gettempdir()).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _pytest_cmd():
    return "python3 -m pytest -n auto" if _xdist_available() else "python3 -m pytest"


def detect_test_cmd(root):
    """Deterministic test-command detection ladder (#96). File presence only,
    no LLM, never runs the suite (the pytest rules probe for pytest-xdist —
    #426 — but the probe is an import check, not a test run). Returns
    (command, rule) or (None, None)."""
    root = Path(root)
    if (root / "pytest.ini").is_file():
        return _pytest_cmd(), "pytest-ini"
    pyproject = root / "pyproject.toml"
    if pyproject.is_file() and "[tool.pytest" in pyproject.read_text(errors="ignore"):
        return _pytest_cmd(), "pyproject-pytest"
    pkg = root / "package.json"
    if pkg.is_file():
        try:
            scripts = json.loads(pkg.read_text()).get("scripts") or {}
        except (json.JSONDecodeError, AttributeError):
            scripts = {}
        bun_lock = (root / "bun.lock").is_file() or (root / "bun.lockb").is_file()
        if "test" in scripts:
            if (root / "pnpm-lock.yaml").is_file():
                return "pnpm test", "package-json-pnpm"
            # `bun run test` runs the package's own script, like the npm and
            # pnpm rungs; the literal `bun test` dropped a `bunx tsc --noEmit
            # &&` prefix on the smoke repo (#600, runs 67/69/70/71).
            if bun_lock:
                return "bun run test", "package-json-bun"
            return "npm test", "package-json-npm"
        if bun_lock:
            return "bun test", "bun-lockfile"
    mk = root / "Makefile"
    if mk.is_file() and re.search(r"^test\s*:", mk.read_text(errors="ignore"), re.M):
        return "make test", "makefile-test"
    if (root / "go.mod").is_file():
        return "go test ./...", "go-mod"
    if (root / "Cargo.toml").is_file():
        return "cargo test", "cargo-toml"
    return None, None


def _pip_externally_managed():
    """PEP 668: whether the `python3` on PATH (the one a derived `python3 -m
    pip` would run) refuses installs outside a venv. Probed from a neutral cwd
    like `_xdist_available`. Fail closed: a probe that cannot answer counts as
    managed, so a derived pip install is never the thing that reddens
    preflight on a distro Python."""
    probe = ("import os, sys, sysconfig; print(int(sys.prefix == sys.base_prefix "
             "and os.path.exists(os.path.join(sysconfig.get_path('stdlib'), "
             "'EXTERNALLY-MANAGED'))))")
    try:
        r = subprocess.run(["python3", "-c", probe], capture_output=True,
                           text=True, timeout=30, cwd=tempfile.gettempdir())
    except (OSError, subprocess.TimeoutExpired):
        return True
    return r.returncode != 0 or r.stdout.strip() != "0"


def derive_bootstrap_cmd(root):
    """The per-worktree dependency install the target's lockfile/manifest
    implies, or (None, reason). File presence only, never runs anything (the
    requirements rung asks the PATH python3 whether PEP 668 applies — an
    import-free probe, not an install).

    run-66 (2026-09-03) failed `knob-validate` before wave 1: the smoke repo's
    suite is RED at BASE until `bun install` runs, and nothing derived the
    bootstrap the driver already knew how to rehearse and provision. This is
    the DEFAULT for `bootstrapCmd` — an explicit `--bootstrap-cmd` wins, and
    `--bootstrap-cmd ''` disables derivation.

    The JS rungs mirror detect_test_cmd's precedence (pnpm before bun) so a
    tree carrying both lockfiles installs with the runner its suite runs
    under. A lockfile-less package.json installs with `--no-package-lock`:
    validate_knobs reads any tree mutation as a red bootstrap, and a freshly
    written package-lock.json is exactly that. Returns (command, rule); a
    (None, rule) names why a present manifest derived nothing, (None, None)
    means no manifest at all."""
    root = Path(root)
    if (root / "package.json").is_file():
        if (root / "pnpm-lock.yaml").is_file():
            return "pnpm install --frozen-lockfile", "pnpm-lockfile"
        if (root / "bun.lock").is_file() or (root / "bun.lockb").is_file():
            return "bun install --frozen-lockfile", "bun-lockfile"
        if (root / "package-lock.json").is_file():
            return "npm ci", "npm-lockfile"
        return "npm install --no-package-lock", "package-json"
    if (root / "uv.lock").is_file():
        return "uv sync", "uv-lock"
    pyproject = root / "pyproject.toml"
    if pyproject.is_file() and "[tool.uv" in pyproject.read_text(errors="ignore"):
        return "uv sync", "pyproject-uv"
    if (root / "requirements.txt").is_file():
        if _pip_externally_managed():
            return None, "requirements-txt-externally-managed"
        return "python3 -m pip install -r requirements.txt", "requirements-txt"
    return None, None


LLM_DERIVES = [
    "waves[][].tier on the args-file wave entries (slots pre-emitted as null; "
    "the engine reads knobs ONLY from these inline entries — never a "
    "top-level launch key)",
    "nothing for waves[][].testCmd — the per-task command is compiler-derived "
    "from the task's Proof `Test:` paths and pre-filled on the wave entries "
    "(run-wide testCmd is driver-derived — knob or detection — and already "
    "stamped in the args file and receipt)",
    "nothing for bootstrapCmd — driver-derived from the target's lockfile/"
    "manifest (or the --bootstrap-cmd knob) and stamped in the args file and "
    "receipt, so validation, the engine and the gate share one value",
    "nothing for review depth — it is plan-authored (**Review:** marker), "
    "pre-filled on the args wave entries",
]

# "cheap" stays accepted: pre-#286 launch/args files carry it; waves.js
# coerces it to standard with a visible judgment call.
VALID_TIERS = {None, "cheap", "standard", "mostCapable", "most-capable"}
# `peer` is the documented review-depth value (#556); `adversarial` is its
# pre-#556 spelling, still accepted here because a pre-#556 args file carries
# it. The compiler normalizes the marker to `peer` before it reaches an args
# entry, so a fresh compile only ever emits `lean` or `peer`.
VALID_REVIEWS = {"lean", "adversarial", "peer"}

OVERLAP_CHOICES = ("serialize", "fold")


def compile_argv(plan, run_dir, overlap=None):
    """Build the compile_plan.py argv (everything after the script path)
    for a launch. Pure — no I/O — so this seam is testable without a real
    repo or a real compile_plan.py subprocess.

    `--overlap <mode>` is added only when the caller passed one explicitly;
    absent, the compiler's own OVERLAP_DEFAULT governs. Nothing else is
    stamped: the compiler reads the plan and only the plan — the filesystem
    eligibility pre-filter (and with it `--repo-root`) retired alongside the
    ordering-guess tiers."""
    argv = [str(plan),
            "--emit-launch", str(run_dir / "launch.json"),
            "--emit-args", str(run_dir / "args.json"),
            "--run-dir", str(run_dir.resolve())]
    if overlap is not None:
        argv += ["--overlap", overlap]
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


# #234: the runners a per-task `testCmd` may name, and the `--version` probe
# that parse-checks each. A dry run is impossible — a task's `Test:` files are
# created by the task and do not exist at BASE — so "is the runner there and
# does it start" is the whole check. First matching prefix wins, so the
# more specific one is listed first.
TASK_RUNNERS = (
    ("python3 -m pytest", "python3 -m pytest", ["python3", "-m", "pytest", "--version"]),
    ("node ", "node", ["node", "--version"]),
)


def task_test_cmds(knobs):
    """The distinct per-task `testCmd` strings on `waves[][]`, in
    first-appearance order. A task with no derivable command carries `null`
    (or no key at all); those slots are skipped, so an args file that names
    none leaves every BASE output shape untouched."""
    seen = []
    for wave in knobs.get("waves") or []:
        for t in wave:
            cmd = t.get("testCmd")
            if isinstance(cmd, str) and cmd.strip() and cmd not in seen:
                seen.append(cmd)
    return seen


def runner_for(cmd):
    """(runner, probe argv) for a per-task command, or (None, None) when it
    matches no known runner — which is itself a red verdict, not a skip."""
    for prefix, runner, probe in TASK_RUNNERS:
        if cmd.startswith(prefix):
            return runner, probe
    return None, None


def probe_task_test_cmds(cmds, cwd):
    """One `{cmd, runner, ok}` per distinct command; each distinct RUNNER is
    probed once, in `cwd` (the throwaway worktree), and its verdict is shared
    by every command naming it. Fail closed: a runner that will not launch is
    red, never an unknown."""
    verdicts = {}
    items = []
    for cmd in cmds:
        runner, probe = runner_for(cmd)
        if runner is None:
            items.append({"cmd": cmd, "runner": None, "ok": False})
            continue
        if runner not in verdicts:
            try:
                verdicts[runner] = subprocess.run(
                    probe, cwd=cwd, capture_output=True, text=True,
                    timeout=120).returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                verdicts[runner] = False
        items.append({"cmd": cmd, "runner": runner, "ok": verdicts[runner]})
    return items


def validate_knobs(args_path, root):
    """Pre-launch knob validation, fail-closed (#89): every wave entry's
    tier/review must be a value the engine accepts, and a bootstrapCmd must
    be a clean no-op when rehearsed in a throwaway worktree (#99) — never on
    the session checkout, so a wrong draft cannot mutate the operator's tree.
    The worktree bounds repo-tree mutations only: shared global package
    caches (pip/npm/uv), outside-the-repo venvs, and network effects escape
    it. In the same worktree, every per-task `testCmd`'s runner is probed
    with `--version` (#234), so a task whose tests need a tool the sandbox
    lacks fails here rather than mid-wave. Exit 0 = safe."""
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
                                                "lean|peer (alias adversarial)"
                                                % (tid, t.get("review"))}))
                    return 1
    except TypeError as e:
        print(json.dumps({"ok": False, "stage": "knob-validate",
                          "detail": "malformed waves shape: %s" % e}))
        return 1
    cmd = knobs.get("bootstrapCmd")
    test_cmd = knobs.get("testCmd")
    task_cmds = task_test_cmds(knobs)
    has_bootstrap = isinstance(cmd, str) and bool(cmd.strip())
    has_test = isinstance(test_cmd, str) and bool(test_cmd.strip())
    if not has_bootstrap and not has_test and not task_cmds:
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
    # SIGTERM's default disposition ends the process WITHOUT unwinding, so the
    # `finally` below never ran when a tool timeout killed a mid-suite probe
    # and wt-knob-<pid> stayed registered (#251). Turn it into an exception:
    # `subprocess.run` kills its child on the way out, `finally` removes the
    # worktree. SIGKILL cannot be caught — the sandbox is disposable
    # (Phase 0 row 2).
    def _on_term(signum, _frame):
        raise SystemExit(128 + signum)
    prev_term = signal.signal(signal.SIGTERM, _on_term)
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
        per_task_red = False
        if task_cmds:
            # Additive by construction: the key appears only when a wave entry
            # actually carries a command, so an args file with none keeps every
            # BASE output shape byte-identical.
            result["perTaskTestCmds"] = probe_task_test_cmds(task_cmds, probe_wt)
            per_task_red = not all(i["ok"] for i in result["perTaskTestCmds"])
            if per_task_red:
                result["ok"] = False
    finally:
        signal.signal(signal.SIGTERM, prev_term)
        rm = sh(["git", "worktree", "remove", "--force", str(probe_wt)],
                cwd=root)
        if rm.returncode != 0:
            result.setdefault("output", "")
            result["output"] += ("\n[probe worktree removal failed: %s]"
                                 % rm.stderr.strip())
    print(json.dumps(result))
    if bootstrap_red or per_task_red:
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
                    help="per-worktree dependency install; wins over the "
                         "lockfile-derived default, '' disables it; stamped "
                         "into the receipt so the gate provisions its "
                         "acceptance worktree")
    ap.add_argument("--overlap", choices=OVERLAP_CHOICES, default=None,
                    help="scheduling knob forwarded to compile_plan.py's "
                         "--overlap; omit to use the compiler's own default "
                         "(fold)")
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

    # One Driver Phase 0 (#371): every /ultrapowers run is a fleet run. The
    # shim sets ULTRAPOWERS_FLEET_RUN=<runId> in the engine process's env; an
    # unset or blank value means a laptop session is trying to run the engine
    # locally — refuse before any cost. Replaces the #129 launch-checkout
    # guard (row 9), which protected a long-lived laptop checkout.
    fleet_run = os.environ.get("ULTRAPOWERS_FLEET_RUN", "").strip()
    if not stage("fleet-run", bool(fleet_run),
                 success="fleet run " + fleet_run,
                 failure="ULTRAPOWERS_FLEET_RUN is unset — `/ultrapowers` runs "
                         "only inside a fleet sandbox — launch `drive-one` on "
                         "the orchestrator"):
        return bail()

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

    # (The external-plugin compatibility stage lived here until #390 — this
    # plugin owns its authoring skill now, so there is no outside contract
    # left to check and no resolver to run.)

    # The state dir self-ignores (content `*`) so every run dir is structurally
    # invisible to git in any repo — gate_check's clean-tree check depends on
    # it. Nothing is pruned: one sandbox per run, rm'd (Phase 0 rows 2, 11).
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / ".gitignore").write_text("*\n")

    run_dir.mkdir(parents=True, exist_ok=True)
    launch, args_file = run_dir / "launch.json", run_dir / "args.json"
    r = sh([sys.executable, str(HERE / "compile_plan.py")]
           + compile_argv(a.plan, run_dir, a.overlap),
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
    # The bootstrap knob: explicit wins, '' disables, unset derives from the
    # target's lockfile/manifest (run-66). The stage is informational — no
    # bootstrap is a valid outcome — but its detail names what was derived
    # and why, so a receipt can answer "why did the clones never install?".
    if a.bootstrap_cmd is not None:
        knob = a.bootstrap_cmd.strip()
        bootstrap_cmd, boot_src = (knob, "knob") if knob else (None, "disabled")
        boot_note = "none — --bootstrap-cmd '' disables derivation"
    else:
        bootstrap_cmd, rule = derive_bootstrap_cmd(root)
        boot_src = ("detected:" + rule) if bootstrap_cmd else None
        if rule == "requirements-txt-externally-managed":
            boot_note = ("none — requirements.txt present but the PATH python3 "
                         "is externally managed (PEP 668)")
        else:
            boot_note = "none — no lockfile or manifest derives one"
    stage("bootstrap-command", True,
          success=("%s (%s)" % (bootstrap_cmd, boot_src)) if bootstrap_cmd
                  else boot_note)
    args_obj = json.loads(args_file.read_text())
    args_obj["testCmd"] = test_cmd
    if bootstrap_cmd:
        args_obj["bootstrapCmd"] = bootstrap_cmd
    args_file.write_text(json.dumps(args_obj, indent=2))

    r = write_dirty_baseline(root)
    dirt_lines = len([l for l in (root / ".claude/ultrapowers/DIRTY_SNAPSHOT")
                      .read_text().splitlines() if l.strip()])
    if not stage("dirty-baseline", r.returncode == 0,
                 success="dirty baseline recorded: %d pre-existing line(s)"
                         % dirt_lines,
                 failure=r.stderr):
        return bail()

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

    receipt.update({"ok": True, "baseBranch": base,
                    "launchFile": str(launch), "argsFile": str(args_file),
                    "workflowName": "ultrapowers-run",
                    "llmDerives": LLM_DERIVES,
                    "testCmd": test_cmd, "testCmdSource": test_src})
    if bootstrap_cmd:
        receipt["bootstrapCmd"] = bootstrap_cmd
        receipt["bootstrapCmdSource"] = boot_src
    (run_dir / "receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
