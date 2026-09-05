"""A clause that replaces a pinned literal is told which test pins it.

A new `proof-species` render, `pinned-elsewhere`, reads each claims-v1 task's
Machine clauses for backticked literals and greps the `--base` checkout for the
TEST files that already assert them. A literal an existing test pins, in a file
no task in the plan declares, is a sibling-owned strict-equality pin the
implementer will break blind — so it is named before a reader is dispatched.
This exam pins the three Machine clauses leg by leg:

  M1 / leg (a) — under `--check --renders --base <checkout>`, for each
    claims-v1 task and each backticked span of three or more characters in its
    Machine clauses, a tracked TEST file under the checkout containing that
    span as a SUBSTRING, and named in no task's Files block, draws exactly one
    line per (task, span, path):

      `ADVISORY proof-species: pinned-elsewhere — task <id>: <span> is
      asserted in <path>, which is in no task's Files`

    A test file is one whose path is under `tests/` or `fleet/tests/`, or whose
    basename starts `test_` or contains `.test.` — so one literal pinned in
    `tests/test_probe.py`, `fleet/tests/test_probe.mjs`, `src/foo.test.ts` and
    `lib/test_x.py` yields four lines, one per pinning file, sorted by path.
  M2 / leg (b) — it is silent when the pinning file IS named in some task's
    Files block, when the literal appears only in a non-test file (`app/x.py`,
    `src/helpers.py`), and when the plan is not claims-v1 (a legacy-grammar
    plan carries no `claims`, so it draws nothing even when its step holds the
    same backticked literal).
  M3 / leg (c) — the render rides behind `--renders`: `--check` alone prints no
    `pinned-elsewhere` line and still exits 0 with `PLAN OK`, `--check
    --renders` with no `--base` checkout prints none, and every Run-less
    fixture plan's `--check` output stays byte-identical to the compiler at the
    frozen sha — `tests/test_compile_plan_proof_runs.py`'s leg (e) assertion,
    imported and re-run from here.

Every fixture plan below is a signed claims-v1 plan (spec §4.5: the compiler
refuses to compile one without its gate-verdict record), and `_rendered`
asserts the fixture's own health — exit 0, `PLAN OK` — before reading the
species lines off it, so a broken fixture never reads as a missing species.
Each `repo` is a checkout this file commits itself, so the literals it greps
for are exactly the ones written here.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import compile_plan  # noqa: E402
# leg (c) [M3]: the byte-identity assertion is that file's, re-run from here.
import test_compile_plan_proof_runs as proof_runs  # noqa: E402

SPECIES_PREFIX = "ADVISORY proof-species: "
PINNED_PREFIX = SPECIES_PREFIX + "pinned-elsewhere"

# The literal task 1's Machine clause carries, backticked, and the test file
# that already asserts it. `runner: None` is not one word — the species greps
# for a fixed-string SUBSTRING, not a whole word.
LITERAL = "runner: None"
PROBE_PY = "tests/test_probe.py"

# Leg (a)'s line, verbatim from the task's own words. Note the span rides
# WITHOUT its backticks and the separator is an em dash, as `_species_line`'s
# `ADVISORY proof-species: %s — task %s%s: %s` shape has it.
EXPECTED_ONE = ("ADVISORY proof-species: pinned-elsewhere — task 1: "
                "runner: None is asserted in tests/test_probe.py, "
                "which is in no task's Files")

# The four test-file shapes M1 names: under `tests/`, under `fleet/tests/`,
# basename starting `test_`, basename containing `.test.`. Sorted by path,
# which is the order leg (a) pins.
PIN_PATHS = ("fleet/tests/test_probe.mjs", "lib/test_x.py",
             "src/foo.test.ts", PROBE_PY)


def pin_line(task_id, span, path):
    return ("ADVISORY proof-species: pinned-elsewhere — task %s: %s is "
            "asserted in %s, which is in no task's Files"
            % (task_id, span, path))


# --------------------------------------------------------------------------- #
# The fixture plans                                                            #
# --------------------------------------------------------------------------- #
HEADER = ("# Plan: A clause that replaces a pinned literal\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")


def _task(task_id, files, machine, legs):
    """One claims-v1 task carrying all six slots. `files` is the Files-block
    bullet lines, `machine` the Machine restatement, `legs` the Legs bullet."""
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "%s"
            "\n"
            "**Claim:** An operator is told which test already pins the "
            "literal. (quoted from #656)\n"
            "Machine: %s\n"
            "\n"
            "**Authorized-by:** #656\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** The repo has no pinning render of its own yet, so no "
            "plan is read this way.\n"
            "\n"
            "**Proof:**\n"
            "- Run: python3 scripts/probe_%s.py --header\n"
            "- Legs: %s\n"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #656\n"
            % (task_id, task_id, "".join(l + "\n" for l in files), machine,
               task_id, task_id, legs))


def _plan(*tasks):
    return HEADER + "\n".join(tasks)


# Task 1's Files name ONLY `app/x.py` — the pinning test file is declared by no
# task, which is what M1's last condition turns on. Task 2 is an unrelated
# task whose clause carries a literal the checkout pins nowhere, so every line
# below names task 1.
MACHINE_1 = "M1. The probe header reports `%s`." % LITERAL
MACHINE_2 = "M1. The probe writes `out/summary.json`."
LEGS_1 = "(a) the header carries the literal [M1]."
LEGS_2 = "(a) the summary file is written [M1]."

TASK_1 = _task("1", ["- Modify: `app/x.py`"], MACHINE_1, LEGS_1)
# Leg (b)'s repair: the SAME plan with the pinning file added to task 2's
# Files block — `- Test:` in a Files block is the task's `reads`, and "named in
# no task's Files" is the union of every task's `writes` and `reads`.
TASK_2 = _task("2", ["- Create: `app/y.py`"], MACHINE_2, LEGS_2)
TASK_2_OWNING = _task("2", ["- Create: `app/y.py`", "- Test: `%s`" % PROBE_PY],
                      MACHINE_2, LEGS_2)

PLAN = _plan(TASK_1, TASK_2)
PLAN_TASK_2_OWNS_PROBE = _plan(TASK_1, TASK_2_OWNING)

# M1's length floor: a backticked span of TWO characters is below the
# three-or-more bar, so a test file asserting it draws nothing.
SHORT_SPAN = "ok"
PLAN_SHORT_SPAN = _plan(_task("1", ["- Modify: `app/x.py`"],
                              "M1. The probe header reports `%s`." % SHORT_SPAN,
                              LEGS_1))

# A legacy-grammar plan (no `**Grammar:**` line) whose one step carries the
# same backticked literal: the species reads a task's `claims`, which a legacy
# task has none of.
LEGACY_PLAN = (
    "# Plan: Legacy\n"
    "\n"
    "**Acceptance:** waived — inline test plan\n"
    "\n"
    "### Task 1: Legacy sample\n"
    "\n"
    "**Type:** implementation\n"
    "**Depends-on:** none\n"
    "\n"
    "**Files:**\n"
    "- Create: `app/legacy.py`\n"
    "- Test: `tests/test_legacy.py`\n"
    "\n"
    "- [ ] **Step 1:** the probe header reports `%s`.\n" % LITERAL)


# --------------------------------------------------------------------------- #
# The checkouts `--base` names                                                 #
# --------------------------------------------------------------------------- #
def _probe_source(literal):
    return "def test_header():\n    assert header() == '%s'\n" % literal


def _repo(tmp_path, name, files):
    """A git checkout committing exactly `files` (plus a literal-free README)
    — the render family is driven by `render_advisories`, which skips every
    render outside a checkout, and greps only TRACKED files."""
    r = tmp_path / name
    r.mkdir(parents=True)
    subprocess.run(["git", "init", "-q"], cwd=r, check=True)
    (r / "README.md").write_text("# base\n")
    for rel, body in files.items():
        f = r / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body)
    subprocess.run(["git", "add", "-A"], cwd=r, check=True)
    subprocess.run(["git", "-c", "user.email=exam@example.invalid",
                    "-c", "user.name=exam", "commit", "-qm", "base"],
                   cwd=r, check=True)
    return r


@pytest.fixture
def repo(tmp_path):
    """One tracked test file asserting the literal, named in no task's Files."""
    return _repo(tmp_path, "repo", {PROBE_PY: _probe_source(LITERAL)})


@pytest.fixture
def repo_four(tmp_path):
    """The same literal in all four test-file shapes M1 names."""
    return _repo(tmp_path, "repo_four",
                 {p: _probe_source(LITERAL) for p in PIN_PATHS})


# --------------------------------------------------------------------------- #
# Running the compiler                                                         #
# --------------------------------------------------------------------------- #
def _write(tmp_path, text, name="plan.md"):
    p = tmp_path / name
    p.write_text(text)
    return p


def _sign(plan):
    """Stamp an all-pass gate-verdict record beside a claims-v1 plan — the
    compiler refuses to compile one without (spec §4.5)."""
    record = {"tasks": {}, "tally": {"dispatched": 0, "rejected": 0}}
    for t in compile_plan.split_tasks(plan.read_text()):
        claims = compile_plan.parse_claims_body(t["body"], t["id"])
        record["tasks"][t["id"]] = {
            "hash": compile_plan.gate_input_hash(claims["claim"],
                                                 claims["proof"]),
            "verdict": "pass", "reason": "layer match"}
        record["tally"]["dispatched"] += 1
    compile_plan.verdicts_path(plan).write_text(
        json.dumps(record, indent=2) + "\n")
    return plan


def _check(plan, *extra):
    return subprocess.run(
        [sys.executable, str(COMPILER), "--check", str(plan)] + list(extra),
        capture_output=True, text=True, cwd=str(ROOT))


def _pinned(stdout):
    return [l for l in stdout.splitlines() if l.startswith(PINNED_PREFIX)]


def _species(stdout):
    return [l for l in stdout.splitlines() if l.startswith(SPECIES_PREFIX)]


def _rendered(tmp_path, base, text, name="plan.md"):
    """`--check --renders --base` on a signed fixture plan: its stdout, with
    the fixture's own health asserted first so a broken fixture never reads as
    a missing species line."""
    plan = _write(tmp_path, text, name)
    if "**Grammar:** claims-v1" in text:
        _sign(plan)
    p = _check(plan, "--renders", "--base", str(base))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "fixture plan %s must compile clean before its species are read; "
        "got rc=%d\n%s%s" % (name, p.returncode, p.stdout, p.stderr))
    return p.stdout


def _lines(tmp_path, base, text, name="plan.md"):
    return _pinned(_rendered(tmp_path, base, text, name))


# --------------------------------------------------------------------------- #
# (a) [M1] the line, its verbatim shape, and one line per pinning file         #
# --------------------------------------------------------------------------- #
def test_a_literal_pinned_by_an_undeclared_test_file_prints_exactly_one_line(
        tmp_path, repo):
    lines = _lines(tmp_path, repo, PLAN)
    assert lines == [EXPECTED_ONE], (
        "leg (a) [M1]: task 1's clause carries `%s`, tracked `%s` asserts it, "
        "and no task's Files names that file — exactly one line, equal to:\n"
        "%s\ngot:\n%s" % (LITERAL, PROBE_PY, EXPECTED_ONE, "\n".join(lines)))


def test_the_pinned_elsewhere_line_is_the_only_species_line_the_plan_draws(
        tmp_path, repo):
    """The fixture carries no other species, so leg (a)'s "exactly one line"
    is the whole `proof-species:` channel, not just its own prefix."""
    out = _rendered(tmp_path, repo, PLAN)
    assert _species(out) == [EXPECTED_ONE], (
        "leg (a) [M1]: this plan's only species hit is `pinned-elsewhere` in "
        "task 1. Got:\n" + "\n".join(_species(out)))


def test_one_line_per_pinning_file_sorted_by_path(tmp_path, repo_four):
    lines = _lines(tmp_path, repo_four, PLAN)
    expected = [pin_line("1", LITERAL, p) for p in PIN_PATHS]
    assert lines == expected, (
        "leg (a) [M1]: one line per (task, span, path) — the same literal in "
        "`tests/`, `fleet/tests/`, a `.test.` basename and a `test_` basename "
        "is four lines, sorted by path. Got:\n%s\nwanted:\n%s"
        % ("\n".join(lines), "\n".join(expected)))


def test_the_four_line_shape_agrees_with_the_verbatim_single_line():
    """The helper leg (a)'s four-line expectation is built from is the same
    string the leg spells out in full."""
    assert pin_line("1", LITERAL, PROBE_PY) == EXPECTED_ONE


def test_a_backticked_span_under_three_characters_draws_nothing(tmp_path):
    """[M1]: the span floor is three characters — a tracked test file
    asserting a two-character span is not a pin this species reports."""
    base = _repo(tmp_path, "repo_short",
                 {PROBE_PY: _probe_source(SHORT_SPAN)})
    assert _lines(tmp_path, base, PLAN_SHORT_SPAN, "plan_short.md") == [], (
        "[M1]: `%s` is %d characters, below the three-or-more bar, so the "
        "test file asserting it draws no line"
        % (SHORT_SPAN, len(SHORT_SPAN)))


# --------------------------------------------------------------------------- #
# (b) [M2] the three silences                                                  #
# --------------------------------------------------------------------------- #
def test_silent_when_the_pinning_file_is_named_in_some_tasks_files(
        tmp_path, repo):
    assert _lines(tmp_path, repo, PLAN_TASK_2_OWNS_PROBE, "plan_owned.md") == [], (
        "leg (b) [M2]: `%s` is task 2's `- Test:` Files entry, so it is named "
        "in some task's Files — a sibling that will fold, not a blind break. "
        "The same plan without that entry draws a line, so this silence is "
        "the ownership test and nothing else." % PROBE_PY)


def test_silent_when_the_literal_appears_only_in_a_non_test_file(tmp_path):
    base = _repo(tmp_path, "repo_app", {"app/x.py": _probe_source(LITERAL)})
    assert _lines(tmp_path, base, PLAN, "plan_app.md") == [], (
        "leg (b) [M2]: the literal lives only in `app/x.py` — not a test "
        "file, and task 1's own Files path besides — so nothing is printed")


def test_silent_when_the_pinning_file_is_neither_tests_dir_nor_test_shaped(
        tmp_path):
    base = _repo(tmp_path, "repo_helpers",
                 {"src/helpers.py": _probe_source(LITERAL)})
    assert _lines(tmp_path, base, PLAN, "plan_helpers.md") == [], (
        "leg (b) [M2]: `src/helpers.py` is neither under a tests directory "
        "nor test-shaped in its basename, so it is not a file this species "
        "reports")


def test_silent_on_a_legacy_grammar_plan(tmp_path, repo):
    plan = _write(tmp_path, LEGACY_PLAN, "plan_legacy.md")
    p = _check(plan, "--renders", "--base", str(repo))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        p.stdout + p.stderr)
    assert _pinned(p.stdout) == [], (
        "leg (b) [M2]: the species is a claims-v1 property; a legacy task "
        "carries no `claims`, so a legacy plan draws nothing even when its "
        "step holds the same backticked `%s` the checkout pins" % LITERAL)


# --------------------------------------------------------------------------- #
# (c) [M3] the frozen `--check` channel                                        #
# --------------------------------------------------------------------------- #
def test_check_alone_prints_no_pinned_elsewhere_line(tmp_path, repo):
    """[M3]: without `--renders`, nothing is printed and the exit code and
    verdict are what they were."""
    plan = _sign(_write(tmp_path, PLAN))
    bare = _check(plan)
    assert bare.returncode == 0, bare.stdout + bare.stderr
    assert bare.stdout.splitlines()[:1] == ["PLAN OK"], bare.stdout
    assert "pinned-elsewhere" not in bare.stdout, (
        "leg (c) [M3]: the species rides behind `--renders`; `--check` alone "
        "prints no `pinned-elsewhere` line. Got:\n" + bare.stdout)


def test_renders_without_a_base_checkout_prints_no_pinned_elsewhere_line(
        tmp_path):
    """[M3]: `--check --renders` with no `--base` — the plan sits outside any
    checkout, so `render_advisories` skips every render rather than guessing a
    tree to grep."""
    plan = _sign(_write(tmp_path, PLAN))
    p = _check(plan, "--renders")
    assert p.returncode == 0, p.stdout + p.stderr
    assert _pinned(p.stdout) == [], (
        "leg (c) [M3]: with no `--base` checkout there is no tree to grep, so "
        "no `pinned-elsewhere` line is printed. Got:\n" + p.stdout)


def _fixture_fn(fixture):
    """The plain function inside a pytest fixture object, so leg (e) of
    `tests/test_compile_plan_proof_runs.py` can be re-run from here."""
    fn = getattr(fixture, "__wrapped__", None)
    if fn is None and hasattr(fixture, "_get_wrapped_function"):
        fn = fixture._get_wrapped_function()
    assert fn is not None, "cannot unwrap %r" % (fixture,)
    return fn


def test_every_run_less_fixture_plan_still_checks_byte_identically_to_base(
        tmp_path_factory):
    """leg (c) [M3]: the new species rides behind `--renders`, so the frozen
    `--check` channel is untouched — the assertion is
    `tests/test_compile_plan_proof_runs.py`'s leg (e), imported and called."""
    base_compiler = _fixture_fn(proof_runs.base_compiler)(tmp_path_factory)
    proof_runs.test_every_run_less_fixture_plan_checks_byte_identically_to_base(
        base_compiler)
