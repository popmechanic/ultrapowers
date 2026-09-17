#!/usr/bin/env python3
"""Deterministic pre-launch driver for /ultrapowers (run on the sandbox by fleet/run-main.mjs).

One invocation runs every deterministic pre-launch stage in order, fail-closed:
fleet-run (the sandbox env contract), git-repo check, worktree-capability
probe, plan compile, test-command derivation, bootstrap-command derivation
(the lockfile-implied install, run-66), add-command derivation (the same
ladder's add verbs, stamped only when the plan declares packages), dirty
baseline, and baseBranch from the launched checkout.

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
import shlex
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


def derive_fold_test_cmd(rule):
    """The SCOPED runner a wave fold uses, derived from the same rule
    `detect_test_cmd` returned. A wave fold judges the wave, so it runs the
    wave's own exams: `(template, pattern)` where the template carries exactly
    one `{paths}` token the engine substitutes and the pattern is a JavaScript
    `RegExp` source the engine matches against repo-relative paths. The pattern
    is what keeps the argv honest — the pytest one keeps `.mjs` sims and
    fixtures out of a pytest argv, the Bun one keeps seeds and source out of
    `bun test`.

    Only the two runners that take a file list derive one. The typecheck half
    of a Bun target's `bun run test` is deliberately NOT here: the engine runs
    this command and nothing else at the fold, so a target that wants its
    typecheck at every fold writes `- Check: bunx tsc --noEmit` in its Global
    Constraints. Every other rule — and no rule at all — folds as at BASE, so
    `(None, None)` leaves both keys off the args file entirely."""
    if rule in ("pytest-ini", "pyproject-pytest"):
        return "python3 -m pytest {paths}", r"(^|/)test_[^/]+\.py$"
    if rule in ("package-json-bun", "bun-lockfile"):
        return "bun test {paths}", r"\.test\.tsx?$"
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


def derive_regenerate_cmd(root):
    """The command that rebuilds this target's lockfile from its manifests,
    or (None, reason). File presence only, same rungs and same precedence as
    `derive_bootstrap_cmd` — the regenerator is that ladder's unfrozen twin.

    Every JS rung of the bootstrap is FROZEN (`--frozen-lockfile`, `npm ci`):
    a worktree installs what the lockfile already says and never rewrites it,
    which is what makes the bootstrap a clean no-op under `validate_knobs`.
    So when several tasks in one run add packages, no bootstrap re-run can
    reconcile their manifests — a second, deliberately unfrozen command has
    to, from the merged manifests, at the fold (#1050). That is this.

    A bare `package.json` derives nothing: there is no lockfile to rebuild
    (its bootstrap's `--no-package-lock` says as much), and the rule still
    names the manifest. `requirements.txt` derives nothing either, and no
    rule with it — pip has no lockfile to regenerate. Returns (command, rule)
    on the same shape the bootstrap ladder returns."""
    root = Path(root)
    if (root / "package.json").is_file():
        if (root / "pnpm-lock.yaml").is_file():
            return "pnpm install --no-frozen-lockfile", "pnpm-lockfile"
        if (root / "bun.lock").is_file() or (root / "bun.lockb").is_file():
            return "bun install", "bun-lockfile"
        if (root / "package-lock.json").is_file():
            return "npm install --package-lock-only", "npm-lockfile"
        return None, "package-json"
    if (root / "uv.lock").is_file():
        return "uv lock", "uv-lock"
    pyproject = root / "pyproject.toml"
    if pyproject.is_file() and "[tool.uv" in pyproject.read_text(errors="ignore"):
        return "uv lock", "pyproject-uv"
    return None, None


def derive_add_cmds(root):
    """The commands that add a package to this target's manifest — runtime and
    development — or (None, reason). File presence only, never runs anything,
    on the bootstrap ladder's own rungs and precedence (pnpm before bun before
    npm; `uv.lock` before `pyproject.toml`).

    A plan that declares `**Dependencies:**` needs the manager's ADD verb, not
    its install verb: the install rung is frozen by construction and can only
    reproduce a lockfile, never extend it. So this is a third reading of the
    same ladder, returning a PAIR — `(add, add_dev)` — because the engine
    chooses between them per group, and both are stamped together.

    The rungs that derive no add command still name why: a bare `package.json`
    could be added to, but the tree names no runner to do it with, and
    `requirements.txt` has no add verb at all (pip writes nothing back). Both
    return `(None, rule)`; no manifest at all returns `(None, None)`. There is
    no PEP 668 probe here — the requirements rung derives nothing either way,
    so nothing is left to run."""
    root = Path(root)
    if (root / "package.json").is_file():
        if (root / "pnpm-lock.yaml").is_file():
            return ("pnpm add", "pnpm add -D"), "pnpm-lockfile"
        if (root / "bun.lock").is_file() or (root / "bun.lockb").is_file():
            return ("bun add", "bun add -d"), "bun-lockfile"
        if (root / "package-lock.json").is_file():
            return ("npm install --save", "npm install --save-dev"), "npm-lockfile"
        return None, "package-json"
    if (root / "uv.lock").is_file():
        return ("uv add", "uv add --dev"), "uv-lock"
    pyproject = root / "pyproject.toml"
    if pyproject.is_file() and "[tool.uv" in pyproject.read_text(errors="ignore"):
        return ("uv add", "uv add --dev"), "pyproject-uv"
    if (root / "requirements.txt").is_file():
        return None, "requirements-txt"
    return None, None


def add_command_stage(args_file, receipt, stage, root):
    """Record the `add-command` stage and, when the plan declares packages,
    stamp `addCmd`/`addDevCmd` into the args file and the receipt. Returns
    False only in the refusal below — the driver bails on that.

    The decision is the compiled args file's `dependencies` key and nothing
    else: the compiler writes it iff the plan header carried a
    `**Dependencies:**` line, so a plan with no line leaves this stage a
    no-op that writes not one byte — the args file and the receipt come out
    of it exactly as they went in. That is what keeps an undeclared plan
    byte-for-byte what it was before this stage existed.

    When a group does name a spec, a tree that derives no add command is a
    launch that cannot do what the plan says, so the stage fails closed and
    names the rung it got as far as — better here, for pennies, than in a
    clone mid-wave.

    There is no `--add-cmd` knob: an operator who overrides the bootstrap
    still gets the derived add command, because the add command is about the
    manifest, not about the install."""
    args_file = Path(args_file)
    args_obj = json.loads(args_file.read_text())
    deps = args_obj.get("dependencies") or {}
    specs = list(deps.get("runtime") or []) + list(deps.get("dev") or [])
    if not specs:
        return stage("add-command", True,
                     success="no dependencies declared — nothing to add")

    pair, rule = derive_add_cmds(root)
    if not pair:
        stage("add-command", False,
              failure="%d declared package(s) but no add command derives from "
                      "this tree: %s" % (len(specs),
                                         rule or "no lockfile or manifest"))
        return False

    add_cmd, add_dev_cmd = pair
    src = "detected:" + rule
    args_obj["addCmd"] = add_cmd
    args_obj["addDevCmd"] = add_dev_cmd
    args_file.write_text(json.dumps(args_obj, indent=2))
    receipt["addCmd"] = add_cmd
    receipt["addDevCmd"] = add_dev_cmd
    receipt["addCmdSource"] = src
    return stage("add-command", True,
                 success="%s / %s (%s)" % (add_cmd, add_dev_cmd, src))


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
    "nothing for addCmd/addDevCmd — the package-add commands are driver-"
    "derived from the same lockfile/manifest beside the bootstrap and stamped "
    "in the args file and receipt (only when the plan declares packages); "
    "there is no knob for them",
    "nothing for regenerateCmd — the lockfile regenerator is derived from the "
    "same lockfile/manifest beside the bootstrap (and only when the bootstrap "
    "itself was derived) and stamped in the args file and receipt; there is "
    "no knob for it",
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

def compile_argv(plan, run_dir):
    """Build the compile_plan.py argv (everything after the script path)
    for a launch. Pure — no I/O — so this seam is testable without a real
    repo or a real compile_plan.py subprocess.

    There are no ordering knobs: the compiler reads the plan and only the
    plan — the filesystem eligibility pre-filter (and with it `--repo-root`)
    retired alongside the ordering-guess tiers, and same-path overlap is
    always folded."""
    return [str(plan),
            "--emit-launch", str(run_dir / "launch.json"),
            "--emit-args", str(run_dir / "args.json"),
            "--run-dir", str(run_dir.resolve())]


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
    # The greenfield stack's exam runner (#642 taught the compiler the shape;
    # this table is its second consumer — run-2 on ultrapowers-walk, 2026-09-04,
    # died at preflight with `"runner": null` for every `bun test` command).
    ("bun test", "bun test", ["bun", "--version"]),
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
    """(runner, probe argv) for a per-task command, or (None, None) for an
    empty one.

    A command the table knows answers its own runner label and `--version`
    probe. Anything else is a plan-declared exam command (#644) — `npx vitest
    run …`, `go test …` — whose runner is its first whitespace-delimited word,
    probed for resolution on PATH rather than for a version, because the table
    does not know which flag that tool prints one under. Fail-closed either
    way: a word that does not resolve is red, never an unknown."""
    for prefix, runner, probe in TASK_RUNNERS:
        if cmd.startswith(prefix):
            return runner, probe
    words = cmd.split()
    if not words:
        return None, None
    return words[0], ["/bin/sh", "-c", "command -v " + shlex.quote(words[0])]


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


# A shell control operator, redirection or substitution anywhere in a command
# means its first word is not necessarily what runs the suite.
SHELL_OPERATORS = (";", "&", "|", "\n", "`", "$(", "(", ">", "<")


def run_wide_runner_verdict(cmd, cwd):
    """The one `{cmd, runner, ok}` verdict for the run-wide `testCmd` under
    `--no-baseline` (#770), or `None` when the command carries no runner this
    probe can read.

    A `TASK_RUNNERS` row matches a PREFIX, so its label is the command's own
    opening words and holds however the rest of the line is spelled. The
    fallback reading — "the runner is the first word" — only holds for a
    simple command: in `cd sub && npm test` the first word is `cd`, and a
    `command -v cd` verdict says nothing about the suite that would have run.
    Such a command therefore carries no verdict and no `testCmdRunner` key
    (M1): the flag's contract is that the command is not executed, and this
    probe cannot read a shell pipeline. Everything the table knows, and every
    simple command, is probed exactly as `probe_task_test_cmds` probes a
    per-task command."""
    known = any(cmd.startswith(prefix) for prefix, _r, _p in TASK_RUNNERS)
    if not known and any(op in cmd for op in SHELL_OPERATORS):
        return None
    return probe_task_test_cmds([cmd], cwd)[0]


def validate_knobs(args_path, root, no_baseline=False):
    """Pre-launch knob validation, fail-closed (#89): every wave entry's
    tier/review must be a value the engine accepts, and a bootstrapCmd must
    be a clean no-op when rehearsed in a throwaway worktree (#99) — never on
    the session checkout, so a wrong draft cannot mutate the operator's tree.
    The worktree bounds repo-tree mutations only: shared global package
    caches (pip/npm/uv), outside-the-repo venvs, and network effects escape
    it. In the same worktree, every per-task `testCmd`'s runner is probed
    with `--version` (#234), so a task whose tests need a tool the sandbox
    lacks fails here rather than mid-wave. Exit 0 = safe.

    `no_baseline` (#770) drops the one expensive thing this verb does: the
    run-wide `testCmd` is no longer executed as a red-BASE baseline (#712 made
    the engine's own baseline lazy, so reading BASE here is redundant), it is
    validated by the same runner probe the per-task commands get (#234) and
    reported under `testCmdRunner` — unless its runner is unreadable, which
    is a command carrying shell operators the table does not know (see
    `run_wide_runner_verdict`). Every other verdict is unchanged, and exit 3
    — the baseline's code — becomes unreachable."""
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
        test_runner_red = False
        if has_test and not bootstrap_red and no_baseline:
            # One command, so one object — deliberately NOT merged into
            # perTaskTestCmds, whose item count existing tests pin exactly.
            # `None` = a command whose runner this probe cannot read (see
            # run_wide_runner_verdict): no key, and the line stays free of a
            # command line the flag exists to leave unexecuted.
            verdict = run_wide_runner_verdict(test_cmd, probe_wt)
            if verdict is not None:
                result["testCmdRunner"] = verdict
                if not verdict["ok"]:
                    result["ok"] = False
                    test_runner_red = True
        elif has_test and not bootstrap_red:
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
    if bootstrap_red or per_task_red or test_runner_red:
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
    ap.add_argument("--no-baseline", action="store_true", dest="no_baseline",
                    help="with --validate-knobs: validate the run-wide testCmd "
                         "by its runner's probe instead of running it as a "
                         "baseline (never exits 3); ignored otherwise")
    ap.add_argument("--test-cmd", default=None,
                    help="run-wide suite command; wins over detection")
    ap.add_argument("--bootstrap-cmd", default=None,
                    help="per-worktree dependency install; wins over the "
                         "lockfile-derived default, '' disables it; stamped "
                         "into the receipt so the engine provisions its "
                         "clones")
    a = ap.parse_args(argv)

    if a.validate_knobs is not None:
        r = sh(["git", "rev-parse", "--show-toplevel"], cwd=a.repo)
        if r.returncode != 0:
            print(json.dumps({"ok": False, "stage": "knob-validate",
                              "detail": r.stderr or "not inside a git repository"}))
            return 1
        return validate_knobs(a.validate_knobs, Path(r.stdout.strip()),
                              no_baseline=a.no_baseline)

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
                 failure="ULTRAPOWERS_FLEET_RUN is unset"
                         " — `/ultrapowers` runs only inside a fleet sandbox"
                         " — the launcher sets it on the VM"):
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
           + compile_argv(a.plan, run_dir),
           cwd=root)
    compile_obj, summary = None, ""
    if r.returncode == 0:
        compile_obj = json.loads(r.stdout)
        waves = compile_obj.get("waves") or []
        summary = "%d task(s) in %d wave(s)" % (
            sum(len(w) for w in waves), len(waves))
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
        # A knob is the operator's whole answer: the run-wide suite is theirs,
        # and so is the fold's. Deriving a scoped runner from a command nobody
        # detected would fold against a template the operator never wrote.
        fold_cmd, fold_pattern = None, None
    else:
        test_cmd, rule = detect_test_cmd(root)
        test_src = ("detected:" + rule) if test_cmd else None
        # Read here and not below: `rule` is rebound by the bootstrap branch.
        fold_cmd, fold_pattern = derive_fold_test_cmd(rule) if test_cmd \
            else (None, None)
    if not stage("test-command", bool(test_cmd),
                 success=("%s (%s)" % (test_cmd, test_src)) if test_cmd else "",
                 failure="no test command detected — pass --test-cmd <run-wide "
                         "suite command>; the gate refuses to run without one"):
        return bail()
    # The bootstrap knob: explicit wins, '' disables, unset derives from the
    # target's lockfile/manifest (run-66). The stage is informational — no
    # bootstrap is a valid outcome — but its detail names what was derived
    # and why, so a receipt can answer "why did the clones never install?".
    regen_cmd, regen_src = None, None
    if a.bootstrap_cmd is not None:
        knob = a.bootstrap_cmd.strip()
        bootstrap_cmd, boot_src = (knob, "knob") if knob else (None, "disabled")
        boot_note = "none — --bootstrap-cmd '' disables derivation"
    else:
        bootstrap_cmd, rule = derive_bootstrap_cmd(root)
        boot_src = ("detected:" + rule) if bootstrap_cmd else None
        # The lockfile regenerator rides the same branch (#1050): only a
        # derived install derives one. An operator who overrides the install
        # — or disables it — owns its lockfile, and there is no
        # --regenerate-cmd knob to say otherwise.
        regen_cmd, regen_rule = derive_regenerate_cmd(root)
        regen_src = ("detected:" + regen_rule) if regen_cmd else None
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
    if regen_cmd:
        args_obj["regenerateCmd"] = regen_cmd
    # The wave fold's own suite (cut 2 of 2026-09-17): the target's runner over
    # the files the wave touched or named as its exams. Both keys or neither —
    # an args file with a template and no pattern would fold everything the
    # engine could not filter. Absent, not `null`, so a target that derives
    # none writes exactly the args file BASE writes.
    if fold_cmd and fold_pattern:
        args_obj["foldTestCmd"] = fold_cmd
        args_obj["foldTestPattern"] = fold_pattern
    args_file.write_text(json.dumps(args_obj, indent=2))

    # The add command rides the compiled args file, not the knobs: it is
    # stamped iff the plan declared packages, and refuses the launch when it
    # declared some the target's tree can add none of.
    if not add_command_stage(args_file, receipt, stage, root):
        return bail()

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
    if regen_cmd:
        receipt["regenerateCmd"] = regen_cmd
        receipt["regenerateCmdSource"] = regen_src
    if fold_cmd and fold_pattern:
        receipt["foldTestCmd"] = fold_cmd
    (run_dir / "receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
