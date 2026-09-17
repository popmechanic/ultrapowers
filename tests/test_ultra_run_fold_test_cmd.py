"""The launcher half of "a wave fold runs the wave's exams; publish runs
everything": `ultra_run.derive_fold_test_cmd(rule)` and the two args-file keys
`main` stamps from it.

The Machine clauses this file answers, restated:

  M1 — `derive_fold_test_cmd(rule)`, a module-level function of `ultra_run.py`
       beside `detect_test_cmd`, returns
         ("python3 -m pytest {paths}", "(^|/)test_[^/]+\\.py$")
       for the rules `pytest-ini` and `pyproject-pytest`,
         ("bun test {paths}", "\\.test\\.tsx?$")
       for the rules `package-json-bun` and `bun-lockfile`, and `(None, None)`
       for every other rule and for `None`.
  M2 — `main` stamps `foldTestCmd` and `foldTestPattern` into the args file
       beside `testCmd` — and `foldTestCmd` into the receipt — exactly when the
       test command was DETECTED (its source begins `detected:`) and
       `derive_fold_test_cmd` of that rule is not `(None, None)`. A `--test-cmd`
       knob, and a detected rule that derives none, leave both keys ABSENT from
       the args file and the receipt — absent, not `null`.

The Proof legs answered here:

  (a) [M1] `pytest-ini` and `pyproject-pytest` → the pytest pair, exactly
  (b) [M1] `package-json-bun` and `bun-lockfile` → the Bun pair, exactly
  (c) [M1] `package-json-pnpm`, `package-json-npm`, `makefile-test`, `go-mod`,
           `cargo-toml` and `None` → `(None, None)`
  (d) [M2] the driver against a repo carrying `pytest.ini` and no `--test-cmd`:
           exit 0, both keys in the args file with those exact values, and
           `foldTestCmd` in the receipt on stdout
  (e) [M2] the same repo with `--test-cmd 'python3 -m pytest'`: exit 0 and
           neither key in the args file or the receipt
  (f) [M2] a repo carrying a `Makefile` with a `test:` target and no
           `pytest.ini`: exit 0 and neither key present

WHY THIS IS RED AT BASE. At BASE `ultra_run.py` has no `derive_fold_test_cmd`
at all and `main` stamps `testCmd`, `bootstrapCmd` and `regenerateCmd` and
nothing else, so leg (a)'s first assertion — the falsifier — reports the
function missing, and legs (d)'s reads of the args file find no `foldTestCmd`.

WHY THE TABLE LEGS REACH THE FUNCTION THROUGH `getattr`. A module-level
`from ultra_run import derive_fold_test_cmd` against BASE is a COLLECTION
error: nothing in this file runs and the red reads like a broken test file
rather than like an absent implementation. `derived()` below asks the module
for the name at call time, so BASE's red is an assertion that names M1 and the
function it wanted — and legs (d)–(f) still run and report their own reds. The
`Produces:` contract (a module-level function OF `ultra_run.py`) is its own
leg, `test_derive_fold_test_cmd_is_a_module_level_function`.

Offline: every table leg is a pure call; the driver legs spawn the real
`ultra_run.py` against a throwaway git repo, exactly as
`tests/test_ultra_run_bootstrap_cmd.py` does.
"""
import json
import os
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
RUN = SCRIPTS / "ultra_run.py"
sys.path.insert(0, str(SCRIPTS))
import ultra_run  # noqa: E402

FLEET_ENV = dict(os.environ, ULTRAPOWERS_FLEET_RUN="run-test")

# The exact two pairs M1 names, written once so every leg below grades the
# same literals. The pattern strings are JavaScript `RegExp` sources: what the
# engine hands `new RegExp(...)`, not a Python pattern.
PYTEST_PAIR = ("python3 -m pytest {paths}", r"(^|/)test_[^/]+\.py$")
BUN_PAIR = ("bun test {paths}", r"\.test\.tsx?$")

# A one-task claims-v1 plan — the only grammar the compiler speaks. Nothing
# here is about the plan: it is the smallest body the compile stage accepts.
PLAN = (
    "# P\n\n**Grammar:** claims-v1\n\n"
    "**Acceptance:** waived — test fixture\n\n"
    "**Claim:** An operator gets an `a` module. (elicited)\n\n"
    "### Task 1: A\n\n**Type:** implementation\n\n"
    "**Files:**\n- Create: `a.py`\n- Test: `tests/test_a.py`\n\n"
    "**Claim:** An operator importing `a` gets its one entry point. (derived)\n"
    "Machine: M1. `a.run()` returns `\"a\"`.\n\n"
    "**Authorized-by:** #1\n\n"
    "**Interfaces:**\n- Consumes: nothing\n- Produces: `run() -> str`\n\n"
    "**Context:** `a.py` is a new one-function module with no registry to update.\n\n"
    "**Proof:**\n- Test: `tests/test_a.py`\n"
    "- The suite asserts `a.run() == \"a\"`. [M1]\n\n"
    "**Stale-if:**\n- path-exists: `a.py`\n"
)

sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))
from extract_gate_input import gate_input, verdicts_path  # noqa: E402


def derived(rule):
    """`ultra_run.derive_fold_test_cmd(rule)`, asked of the module at call
    time so an absent function reads as the clause it is missing from."""
    fn = getattr(ultra_run, "derive_fold_test_cmd", None)
    assert callable(fn), (
        "[M1] `ultra_run.py` has no module-level `derive_fold_test_cmd(rule)` — "
        "the function this task Produces, beside `detect_test_cmd`"
    )
    return fn(rule)


def write_plan(directory, name="plan.md"):
    """Land PLAN and the gate-verdict artifact a claims-v1 plan compiles
    against (spec §4.5), hashed by the gate's own extractor."""
    plan = directory / name
    plan.write_text(PLAN)
    verdicts_path(plan).write_text(json.dumps(
        {"tasks": {"1": {"hash": gate_input(plan, "1")["hash"],
                         "verdict": "pass", "reason": "fixture"}},
         "tally": {"dispatched": 1, "rejected": 0}}))
    return plan


def sh(cmd, cwd=None, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def make_repo(tmp_path, files):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / ".gitignore").write_text(".claude/\nnode_modules/\n")
    write_plan(repo)
    for name, text in files.items():
        (repo / name).write_text(text)
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def run_driver(repo, *extra, env=None):
    return sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1", *extra],
              cwd=repo, env=env or FLEET_ENV)


def args_of(repo):
    return json.loads((repo / ".claude/ultrapowers/run-t1/args.json").read_text())


# ── the Produces contract itself ────────────────────────────────────────────

def test_derive_fold_test_cmd_is_a_module_level_function():
    """[M1] `derive_fold_test_cmd(rule) -> tuple[str | None, str | None]` is a
    module-level function of `ultra_run.py`, beside `detect_test_cmd` — the
    symbol this task Produces and the engine half's shared literal."""
    fn = getattr(ultra_run, "derive_fold_test_cmd", None)
    assert callable(fn), (
        "[M1] no module-level `derive_fold_test_cmd` in "
        "skills/ultrapowers/scripts/ultra_run.py"
    )
    assert callable(getattr(ultra_run, "detect_test_cmd", None)), (
        "sim precondition — `detect_test_cmd`, the ladder whose rule names "
        "`derive_fold_test_cmd` reads, is still a module-level function"
    )


# ── leg (a) [M1]: the two pytest rules ──────────────────────────────────────

@pytest.mark.parametrize("rule", ["pytest-ini", "pyproject-pytest"])
def test_leg_a_pytest_rules_derive_the_scoped_pytest_pair(rule):
    """(a) [M1] for each of `pytest-ini` and `pyproject-pytest`,
    `derive_fold_test_cmd` returns EXACTLY the pytest template and its
    pattern — full equality on the 2-tuple, not containment."""
    assert derived(rule) == PYTEST_PAIR, (
        "(a) [M1] rule %r must derive %r; got %r" % (rule, PYTEST_PAIR, derived(rule))
    )


def test_leg_a_pytest_pattern_is_the_shared_literal():
    """(a) [M1] the pattern, character for character: the shared literal every
    reader of this plan holds — it keeps `.mjs` sims and fixtures out of a
    pytest argv, so the leading `(^|/)` and the `[^/]+` are load-bearing."""
    template, pattern = derived("pytest-ini")
    assert template == "python3 -m pytest {paths}", template
    assert pattern == "(^|/)test_[^/]+\\.py$", pattern


# ── leg (b) [M1]: the two Bun rules ─────────────────────────────────────────

@pytest.mark.parametrize("rule", ["package-json-bun", "bun-lockfile"])
def test_leg_b_bun_rules_derive_the_scoped_bun_pair(rule):
    """(b) [M1] for each of `package-json-bun` and `bun-lockfile` it returns
    EXACTLY the Bun template and its pattern. `package-json-bun` detects
    `bun run test` as the run-wide suite (#600) and still derives the literal
    `bun test {paths}` here: the typecheck half of `bun run test` is out of
    the scoped command by design."""
    assert derived(rule) == BUN_PAIR, (
        "(b) [M1] rule %r must derive %r; got %r" % (rule, BUN_PAIR, derived(rule))
    )


def test_leg_b_bun_pattern_is_the_shared_literal():
    """(b) [M1] the Bun pattern, character for character — it keeps seeds and
    source out of `bun test`."""
    template, pattern = derived("bun-lockfile")
    assert template == "bun test {paths}", template
    assert pattern == "\\.test\\.tsx?$", pattern


# ── leg (c) [M1]: every other rule, and `None` ──────────────────────────────

@pytest.mark.parametrize("rule", ["package-json-pnpm", "package-json-npm",
                                  "makefile-test", "go-mod", "cargo-toml", None])
def test_leg_c_every_other_rule_derives_nothing(rule):
    """(c) [M1] `(None, None)` for every other rule of the ladder and for
    `None` — the target the launcher cannot derive a scoped runner for folds
    exactly as it does today."""
    assert derived(rule) == (None, None), (
        "(c) [M1] rule %r must derive (None, None); got %r" % (rule, derived(rule))
    )


def test_leg_c_covers_every_rule_detect_test_cmd_can_return():
    """(c) [M1] 'every other rule' is closed over the ladder: each rule name
    `detect_test_cmd` can return is in one of the three tables above, so a
    rung added without a derivation decision cannot slip past this exam."""
    ladder = {"pytest-ini", "pyproject-pytest", "package-json-pnpm",
              "package-json-bun", "package-json-npm", "bun-lockfile",
              "makefile-test", "go-mod", "cargo-toml"}
    for rule in ladder:
        expected = (PYTEST_PAIR if rule in ("pytest-ini", "pyproject-pytest")
                    else BUN_PAIR if rule in ("package-json-bun", "bun-lockfile")
                    else (None, None))
        assert derived(rule) == expected, (
            "(c) [M1] rule %r of the detection ladder: expected %r, got %r"
            % (rule, expected, derived(rule)))


# ── leg (d) [M2]: a detected pytest target stamps both keys ─────────────────

def test_leg_d_detected_pytest_target_stamps_both_keys(tmp_path):
    """(d) [M2] a repo carrying `pytest.ini` and no `--test-cmd`: exit 0, the
    args file carries `foldTestCmd` and `foldTestPattern` with exactly the
    values M1 derives, and the receipt on stdout carries `foldTestCmd` equal
    to the same string."""
    repo = make_repo(tmp_path, {"pytest.ini": "[pytest]\n"})
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["testCmdSource"] == "detected:pytest-ini", (
        "(d) sim precondition — the run-wide command was DETECTED off "
        "`pytest.ini`, which is the condition M2 stamps on: %r"
        % receipt.get("testCmdSource"))

    args = args_of(repo)
    assert args.get("foldTestCmd") == "python3 -m pytest {paths}", (
        "(d) [M2] the args file carries `foldTestCmd` beside `testCmd`: %r"
        % args.get("foldTestCmd"))
    assert args.get("foldTestPattern") == "(^|/)test_[^/]+\\.py$", (
        "(d) [M2] and `foldTestPattern` beside it: %r" % args.get("foldTestPattern"))
    assert args["testCmd"] == receipt["testCmd"], (
        "(d) sim precondition — the run-wide `testCmd` is stamped as at BASE, "
        "unchanged by the fold keys: %r vs %r"
        % (args.get("testCmd"), receipt.get("testCmd")))
    assert receipt.get("foldTestCmd") == "python3 -m pytest {paths}", (
        "(d) [M2] and the receipt on stdout carries `foldTestCmd` equal to the "
        "same string: %r" % receipt.get("foldTestCmd"))


# ── leg (e) [M2]: the knob leaves both keys absent ──────────────────────────

def test_leg_e_test_cmd_knob_leaves_both_keys_absent(tmp_path):
    """(e) [M2] the same repo with `--test-cmd 'python3 -m pytest'`: exit 0 and
    neither the args file nor the receipt has a `foldTestCmd` or
    `foldTestPattern` key. An operator who spelled the suite owns it; a knob
    is not a detected rule, whatever it looks like."""
    repo = make_repo(tmp_path, {"pytest.ini": "[pytest]\n"})
    r = run_driver(repo, "--test-cmd", "python3 -m pytest")
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["testCmdSource"] == "knob", (
        "(e) sim precondition — the command came from the knob: %r"
        % receipt.get("testCmdSource"))

    args = args_of(repo)
    for key in ("foldTestCmd", "foldTestPattern"):
        assert key not in args, (
            "(e) [M2] `%s` is ABSENT from the args file — not `null` — when the "
            "test command came from the knob: %r" % (key, args))
        assert key not in receipt, (
            "(e) [M2] and absent from the receipt: %r" % (sorted(receipt),))


# ── leg (f) [M2]: a detected rule that derives none stamps neither ──────────

def test_leg_f_detected_rule_that_derives_none_stamps_neither(tmp_path):
    """(f) [M2] a repo carrying a `Makefile` with a `test:` target and no
    `pytest.ini`: exit 0 and neither key is present. The command was detected,
    but `derive_fold_test_cmd('makefile-test')` is `(None, None)` — so the
    args file for this target is byte-for-byte what BASE writes."""
    repo = make_repo(tmp_path, {"Makefile": "test:\n\ttrue\n"})
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["testCmdSource"] == "detected:makefile-test", (
        "(f) sim precondition — the `makefile-test` rung detected the suite: %r"
        % receipt.get("testCmdSource"))
    assert receipt["testCmd"] == "make test", receipt.get("testCmd")

    args = args_of(repo)
    for key in ("foldTestCmd", "foldTestPattern"):
        assert key not in args, (
            "(f) [M2] `%s` is ABSENT from the args file for a detected rule "
            "that derives no scoped runner: %r" % (key, args))
        assert key not in receipt, (
            "(f) [M2] and absent from the receipt: %r" % (sorted(receipt),))
