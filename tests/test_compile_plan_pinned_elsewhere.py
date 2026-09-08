"""A clause that replaces a pinned literal is told which test pins it.

A new `proof-species` render, `pinned-elsewhere`, reads each claims-v1 task's
Machine clauses for backticked literals and greps the `--base` checkout for the
TEST files that already assert them. A literal an existing test pins, in a file
no task in the plan declares, is a sibling-owned strict-equality pin the
implementer will break blind — so it is named before a reader is dispatched.
This exam pins the three Machine clauses leg by leg:

  M1 / leg (a) — under `--check --renders --base <checkout>`, for each
    claims-v1 task and each backticked span of six or more characters in its
    Machine clauses, a tracked TEST file under the checkout containing that
    span as a SUBSTRING, and named in no task's Files block, is named on that
    task's line:

      `ADVISORY proof-species: pinned-elsewhere — task <id>: <span> is
      asserted in <path>, which is in no task's Files`

    A test file is one whose path is under `tests/` or `fleet/tests/`, or whose
    basename starts `test_` or contains `.test.` — so one literal pinned in
    `tests/test_probe.py`, `fleet/tests/test_probe.mjs`, `src/foo.test.ts` and
    `lib/test_x.py` names all four, sorted by path. (#756 Task 2 folded the
    per-file lines into ONE line per task and added the extension rule; the
    `#756 Task 2` section at the foot of this file carries that contract clause
    by clause, and the rows this file used to make of the four-file and
    nine-file checkouts are rewritten there.)
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

The second half of this exam is #671's follow-on — the spans that pin nothing
are skipped, and the per-task loop is pinned by a three-task plan. Its five
Machine clauses are restated above the section that carries them.

Every fixture plan below is a signed claims-v1 plan (spec §4.5: the compiler
refuses to compile one without its gate-verdict record), and `_rendered`
asserts the fixture's own health — exit 0, `PLAN OK` — before reading the
species lines off it, so a broken fixture never reads as a missing species.
Each `repo` is a checkout this file commits itself, so the literals it greps
for are exactly the ones written here.
"""
import inspect
import json
import re
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
# six-or-more bar, so a test file asserting it draws nothing.
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
# (a) [M1] the line and its verbatim shape (the four-file checkout's row now   #
# lives in the `#756 Task 2` section below, as leg (e)'s one-line form)         #
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


def test_the_single_file_helper_agrees_with_the_verbatim_single_line():
    """The helper the single-file expectations are built from is the same
    string leg (a) spells out in full."""
    assert pin_line("1", LITERAL, PROBE_PY) == EXPECTED_ONE


def test_a_backticked_span_under_six_characters_draws_nothing(tmp_path):
    """[M1]: the span floor is six characters — a tracked test file
    asserting a two-character span is not a pin this species reports."""
    base = _repo(tmp_path, "repo_short",
                 {PROBE_PY: _probe_source(SHORT_SPAN)})
    assert _lines(tmp_path, base, PLAN_SHORT_SPAN, "plan_short.md") == [], (
        "[M1]: `%s` is %d characters, below the six-or-more bar, so the "
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
# — and, unchanged, #671's leg (g) [M5]: these three tests and the byte-        #
#   identity assertion below are exactly what that leg says still passes.      #
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
    """leg (c) [M3], and #671's leg (g) [M5]: the species rides behind
    `--renders`, so the frozen `--check` channel is untouched — the assertion
    is `tests/test_compile_plan_proof_runs.py`'s leg (e), imported and
    called."""
    base_compiler = _fixture_fn(proof_runs.base_compiler)(tmp_path_factory)
    proof_runs.test_every_run_less_fixture_plan_checks_byte_identically_to_base(
        base_compiler)


# =========================================================================== #
# Task 2 of #671's wave — "Pinned-elsewhere skips the spans that pin nothing" #
#                                                                             #
# A span shorter than six characters, a span ending in `/`, and a span more   #
# than eight tracked test files contain pin nothing: they are grep noise, not #
# one sibling's strict-equality pin. The literal shape the species was built  #
# for (`runner: None`, one test file) is kept, and the per-task loop is       #
# pinned by a plan whose three tasks all carry that span.                     #
#                                                                             #
#   M1 / leg (a) — the literal shape is kept, and the loop is per task: a     #
#     three-task plan each of whose tasks carries `runner: None` draws three  #
#     lines, one per task, in task order.                                     #
#   M2 / leg (b) — the span floor is six: a five-character span draws         #
#     nothing, a six-character one in the same clause position and the same   #
#     file draws one line.                                                    #
#   M3 / leg (c) — a span ending in `/` is a directory prefix and draws       #
#     nothing whatever its length; the same span without its trailing `/`     #
#     draws one line.                                                         #
#   M4 / legs (d), (e), (f) — a span in MORE THAN EIGHT tracked test files is #
#     vocabulary: nine files draw nothing, nine of which one is declared draw #
#     nothing (the count is taken BEFORE the `declared` filter), and eight    #
#     draw eight lines, one per file in path order. RETIRED by #756 Task 2    #
#     (the operator's 2026-09-07 decision: no file-count threshold decides    #
#     for the reader) — the nine-file, nine-with-one-declared and eight-file  #
#     checkouts are still exercised, rewritten under the `#756 Task 2`        #
#     section at the foot of this file.                                       #
#   M5 / leg (g) — the frozen channel: the three tests directly above, plus   #
#     the five-species fixture the Proof's `Run:` bullet runs.                #
# =========================================================================== #

# leg (a) [M1]: the same clause in three tasks. Each task's Files names its
# own path, so `tests/test_probe.py` is still declared by none of them.
TASK_2_SAME_SPAN = _task("2", ["- Create: `app/y.py`"], MACHINE_1, LEGS_1)
TASK_3_SAME_SPAN = _task("3", ["- Create: `app/z.py`"], MACHINE_1, LEGS_1)
PLAN_THREE_TASKS = _plan(TASK_1, TASK_2_SAME_SPAN, TASK_3_SAME_SPAN)

# legs (b), (c): one-task plans differing only in the backticked span, run
# against a checkout whose one tracked test file contains it.
SPAN_FIVE = "abcde"          # five characters — below the floor
SPAN_SIX = "abcdef"          # six characters — the first span the floor keeps
SPAN_DIR = "fleet/tests/"    # twelve characters, ending in `/` — a directory
SPAN_NO_SLASH = "fleet/tests"  # the same span, eleven characters, no slash


def _span_plan(span):
    """The one-task fixture plan whose Machine clause carries `span` in the
    clause position `MACHINE_1` carries `runner: None` in."""
    return _plan(_task("1", ["- Modify: `app/x.py`"],
                       "M1. The probe header reports `%s`." % span, LEGS_1))


# legs (d), (e), (f) [M4]: the same literal in N tracked test files under
# `tests/`, sorted by path already (single digits).
def _probe_paths(n):
    return ["tests/test_p%d.py" % i for i in range(1, n + 1)]


def _many_repo(tmp_path, n):
    return _repo(tmp_path, "repo_%d" % n,
                 {p: _probe_source(LITERAL) for p in _probe_paths(n)})


# leg (e) [M4]: the nine-file checkout with the FIRST of those files added as
# task 2's `Test:` entry — the `TASK_2_OWNING` shape, one more Files bullet.
PLAN_TASK_2_OWNS_P1 = _plan(
    TASK_1,
    _task("2", ["- Create: `app/y.py`", "- Test: `tests/test_p1.py`"],
          MACHINE_2, LEGS_2))


# --------------------------------------------------------------------------- #
# (a) [M1] the literal shape is kept, and the loop is per task                 #
# --------------------------------------------------------------------------- #
def test_a_the_literal_shape_the_species_was_built_for_is_kept(
        tmp_path, repo):
    """leg (a) [M1]: `runner: None` is twelve characters, has no trailing
    slash, and is in ONE tracked test file — none of the three new skips
    touches it, so the verbatim line stands exactly as it did."""
    lines = _lines(tmp_path, repo, PLAN)
    assert lines == [EXPECTED_ONE], (
        "leg (a) [M1]: the one shape the species was built for — task 1's "
        "clause carrying `%s`, tracked `%s` asserting it, no task's Files "
        "naming that file — is still exactly one line:\n%s\ngot:\n%s"
        % (LITERAL, PROBE_PY, EXPECTED_ONE, "\n".join(lines)))


def test_a_three_tasks_carrying_the_same_span_draw_three_lines_in_task_order(
        tmp_path, repo):
    """leg (a) [M1]: the loop in `_render_proof_species` is per task — three
    tasks carrying the same clause span against the same checkout draw the
    task-1, task-2 and task-3 lines, in that order (#671's loop question)."""
    lines = _lines(tmp_path, repo, PLAN_THREE_TASKS, "plan_three.md")
    expected = [pin_line(i, LITERAL, PROBE_PY) for i in ("1", "2", "3")]
    assert lines == expected, (
        "leg (a) [M1]: tasks 1, 2 and 3 each carry `%s` in a Machine clause "
        "and `%s` pins it for all three, so three lines print in task order. "
        "Got:\n%s\nwanted:\n%s"
        % (LITERAL, PROBE_PY, "\n".join(lines), "\n".join(expected)))


# --------------------------------------------------------------------------- #
# (b) [M2] the span floor is six characters                                    #
# --------------------------------------------------------------------------- #
def test_b_a_five_character_span_draws_nothing(tmp_path):
    """leg (b) [M2]: below six characters a span is grep noise, so the tracked
    test file containing it draws no pinned-elsewhere line."""
    base = _repo(tmp_path, "repo_five", {PROBE_PY: _probe_source(SPAN_FIVE)})
    lines = _lines(tmp_path, base, _span_plan(SPAN_FIVE), "plan_five.md")
    assert lines == [], (
        "leg (b) [M2]: `%s` is %d characters, below the six-character floor, "
        "so tracked `%s` containing it draws nothing. Got:\n%s"
        % (SPAN_FIVE, len(SPAN_FIVE), PROBE_PY, "\n".join(lines)))


def test_b_a_six_character_span_in_the_same_position_draws_one_line(tmp_path):
    """leg (b) [M2]: the same clause position and the same file, one character
    longer — six is the first length the floor keeps, so the line prints."""
    base = _repo(tmp_path, "repo_six", {PROBE_PY: _probe_source(SPAN_SIX)})
    lines = _lines(tmp_path, base, _span_plan(SPAN_SIX), "plan_six.md")
    expected = [pin_line("1", SPAN_SIX, PROBE_PY)]
    assert lines == expected, (
        "leg (b) [M2]: `%s` is %d characters — at the floor, not below it — "
        "so tracked `%s` containing it draws exactly one line:\n%s\ngot:\n%s"
        % (SPAN_SIX, len(SPAN_SIX), PROBE_PY, expected[0], "\n".join(lines)))


# --------------------------------------------------------------------------- #
# (c) [M3] a span ending in `/` is a directory and draws nothing               #
# --------------------------------------------------------------------------- #
@pytest.fixture
def repo_dir_span(tmp_path):
    """One tracked test file containing `fleet/tests/` — and so containing
    `fleet/tests` too, which is what makes the pair below a controlled
    experiment: only the trailing slash of the SPAN differs."""
    return _repo(tmp_path, "repo_dir", {PROBE_PY: _probe_source(SPAN_DIR)})


def test_c_a_span_ending_in_a_slash_draws_nothing_however_long(
        tmp_path, repo_dir_span):
    """leg (c) [M3]: `fleet/tests/` is twelve characters — well over the floor
    — but it is a directory prefix an import line contains and no test pins."""
    lines = _lines(tmp_path, repo_dir_span, _span_plan(SPAN_DIR),
                   "plan_dir.md")
    assert lines == [], (
        "leg (c) [M3]: `%s` is %d characters and ends in `/`, so tracked `%s` "
        "containing it draws nothing — length does not rescue a directory. "
        "Got:\n%s" % (SPAN_DIR, len(SPAN_DIR), PROBE_PY, "\n".join(lines)))


# #756 Task 2: #671's control row for the pair above — `fleet/tests`, the same
# span minus its trailing slash, drawing one line — is SUBSUMED by that task's
# M2, which skips any span holding a `/` and not only one ending in it. The
# controlled pair that survives is #671's own length pair (`abcde` / `abcdef`,
# `test_b` above), and the slash-only rule is pinned below.
def test_c_the_same_span_without_its_trailing_slash_is_a_path_too(
        tmp_path, repo_dir_span):
    """leg (c) [M3] as #756 Task 2's M2 re-scopes it: `fleet/tests` ends in no
    slash but still HOLDS one, so it is a path and draws nothing — the skip is
    the slash wherever in the span it sits."""
    lines = _lines(tmp_path, repo_dir_span, _span_plan(SPAN_NO_SLASH),
                   "plan_noslash.md")
    assert lines == [], (
        "leg (b) [M2] (#756 Task 2): `%s` holds a `/`, so it is a path — the "
        "trailing-slash rule the row above pins is the narrower case of it. "
        "Got:\n%s" % (SPAN_NO_SLASH, "\n".join(lines)))


# --------------------------------------------------------------------------- #
# (d) (e) (f) [M4] — the file-count threshold this block pinned is retired by  #
# #756 Task 2. Its three checkouts are rewritten under `#756 Task 2` below,    #
# as legs (f) of that task: nine files, nine with one declared, and eight.     #
# --------------------------------------------------------------------------- #


# =========================================================================== #
# #756 Task 2 — "pinned-elsewhere renders one line per task naming each       #
# Machine literal a code test outside every Files block asserts"              #
#                                                                             #
# The operator's 2026-09-07 decision on #756: no hard caps. The vocabulary    #
# threshold (`PINNED_EVERYWHERE = 8`) goes, the per-(task, span, path) lines  #
# fold into ONE line per task, three kinds of candidate the compiler already  #
# knows are skipped, and a pinning file must carry a code extension. #671's   #
# six-character floor and its trailing-slash skip stand unchanged.            #
#                                                                             #
#   M1 / leg (a) — a candidate span is what BASE's `_clause_spans` collects   #
#     from the task's MACHINE clauses, and no longer floor is added:          #
#     `runner: None` is twelve characters and still draws its line, while the #
#     same literal unbackticked in the clause, or backticked only in the      #
#     Claim sentence, the Context and a Proof leg, draws nothing.             #
#   M2 / legs (b), (c), (d) — three kinds of candidate are skipped even when  #
#     a tracked undeclared test file asserts them: a path (the span holds a   #
#     `/`, or is a bare file name), a placeholder (a `<` and a later `>`),    #
#     and a state word (one of `fleet/CONTRACT.md`'s six, surrounding quotes  #
#     stripped, case-insensitively). In each row the same file and the same   #
#     clause position carrying `runner: None` draws one line, so the silence  #
#     is the skip and nothing else.                                           #
#   M3 / legs (e), (f) — a pinning file is a test file by BASE's four shapes  #
#     WITH one of the eight code extensions, that no task's Files names; and  #
#     no count of pinning files silences a span.                              #
#   M4 / legs (g), (h), (i) — the line: `ADVISORY proof-species:              #
#     pinned-elsewhere — task <id>: <detail>`, the candidates in CLAUSE order #
#     joined by `; `, each `<span> is asserted in <path1>, <path2>` with the  #
#     paths sorted, closed by `, which is in no task's Files` when the line   #
#     names exactly one distinct file and `, none of which is in any task's   #
#     Files` otherwise.                                                       #
#   M5 / legs (j)–(r) — the six tracked 2026-09-07 fixture plans rendered     #
#     against this checkout: at most one line per task of the plan, at least  #
#     one line across the six, every line parsing as M4's grammar with every  #
#     named span passing M2 and every named file passing M3, and bare         #
#     `--check` silent and clean.                                             #
# =========================================================================== #

# The Produces contract, spelled as the task spells it.
PRODUCES_PARAMS = ["task_id", "clauses", "base", "declared", "exclude"]

# The second span legs (g), (h) and (i) need: twelve characters like
# `runner: None`, no slash, no bracket, no state word — and, unlike it, in no
# tracked file of this repository, so a task carrying only it pins nothing.
SPAN_WAVE = "wave: fold"
PROBE_PY_TWO = "tests/test_probe_two.py"

# M2's three kinds, one span each per leg, all six-or-more characters so the
# floor is not what silences them.
SPAN_SLASH = "ultra/evidence-run-32"           # leg (b): a path
SPAN_BARE_FILE = "status-page.json"            # leg (b): a bare file name
SPAN_SLASH_PLACEHOLDER = "ultra/integration-run-<N>"   # leg (c)
SPAN_BRACKET_ONLY = "run <N> parked"           # leg (c): bracket, no slash
STATE_WORDS = ("booting", "running", "publishing", "done", "parked", "failed")
SPAN_NON_STATE = "publishings!"                # leg (d): twelve, not a state

# M3's extension rule: `.md` under `tests/` is a test file by BASE's four
# shapes and is NOT a pinning file; the two code files are.
PROBE_MD = "tests/fixtures/plans/probe.md"
PROBE_MJS = "fleet/tests/test_probe.mjs"
CODE_EXTS_M3 = (".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".sh")

CLOSER_ONE = ", which is in no task's Files"
CLOSER_MANY = ", none of which is in any task's Files"
LINE_HEAD = re.compile(
    "^ADVISORY proof-species: pinned-elsewhere — task ([^:]+): ")
BARE_FILE_NAME = re.compile(r"^[\w.\-]+\.[A-Za-z]{1,4}$")


def species_line(task_id, pairs):
    """M4's line. `pairs` is [(span, [path, ...]), ...] in CLAUSE order, each
    path list in path order; the closer is chosen by the number of DISTINCT
    files the whole line names."""
    named = {p for _, paths in pairs for p in paths}
    detail = "; ".join("%s is asserted in %s" % (span, ", ".join(paths))
                       for span, paths in pairs)
    return ("ADVISORY proof-species: pinned-elsewhere — task %s: %s%s"
            % (task_id, detail,
               CLOSER_ONE if len(named) == 1 else CLOSER_MANY))


def _probe_source_both(first, second):
    """A probe file asserting two literals — the two-candidate row of M4."""
    return ("def test_header():\n    assert header() == '%s'\n"
            "\n\ndef test_wave():\n    assert wave() == '%s'\n"
            % (first, second))


def _task_prose(task_id, files, machine, legs, claim, context):
    """`_task` with the Claim sentence and the Context under the caller's
    control — leg (a) needs a task whose backticked literal lives everywhere
    EXCEPT its Machine clause."""
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "%s"
            "\n"
            "**Claim:** %s\n"
            "Machine: %s\n"
            "\n"
            "**Authorized-by:** #756\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** %s\n"
            "\n"
            "**Proof:**\n"
            "- Run: python3 scripts/probe_%s.py --header\n"
            "- Legs: %s\n"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #756\n"
            % (task_id, task_id, "".join(l + "\n" for l in files), claim,
               machine, task_id, context, task_id, legs))


def _one_span_lines(tmp_path, span, name):
    """The lines a one-task plan carrying `span` in `MACHINE_1`'s clause
    position draws against a checkout whose one tracked file — `PROBE_PY`, the
    same file and the same position the `repo` fixture gives `runner: None`,
    and named in no task's Files — asserts it."""
    base = _repo(tmp_path, "repo_" + name, {PROBE_PY: _probe_source(span)})
    return _lines(tmp_path, base, _span_plan(span), "plan_%s.md" % name)


def test_the_line_builder_agrees_with_the_verbatim_single_file_line():
    """The builder every expectation below is written with is the same string
    leg (a) spells out in full."""
    assert species_line("1", [(LITERAL, [PROBE_PY])]) == EXPECTED_ONE


def test_the_produces_signature_is_the_one_the_task_names():
    """Produces: `_species_pinned_elsewhere(task_id, clauses, base, declared,
    exclude) -> list[str]` — the entry point keeps its name and its five
    parameters, in that order."""
    fn = getattr(compile_plan, "_species_pinned_elsewhere", None)
    assert fn is not None, (
        "Produces: the compiler must still expose "
        "`_species_pinned_elsewhere(%s)`" % ", ".join(PRODUCES_PARAMS))
    assert list(inspect.signature(fn).parameters) == PRODUCES_PARAMS, (
        "Produces: `_species_pinned_elsewhere(%s)` — got (%s)"
        % (", ".join(PRODUCES_PARAMS),
           ", ".join(inspect.signature(fn).parameters)))


# --------------------------------------------------------------------------- #
# (a) [M1] the candidate span is a MACHINE-clause span, and no longer floor    #
# --------------------------------------------------------------------------- #
def test_756_a_the_twelve_character_literal_still_draws_its_exact_line(
        tmp_path, repo):
    """leg (a) [M1]: `runner: None` is twelve characters and one undeclared
    tracked probe file asserts it — BASE's exact line, no longer floor
    added."""
    lines = _lines(tmp_path, repo, PLAN, "plan_756_a.md")
    assert lines == [EXPECTED_ONE], (
        "leg (a) [M1]: `%s` is %d characters, asserted by tracked undeclared "
        "`%s`, so exactly BASE's line prints — a floor above six would "
        "silence it:\n%s\ngot:\n%s"
        % (LITERAL, len(LITERAL), PROBE_PY, EXPECTED_ONE, "\n".join(lines)))


MACHINE_UNBACKTICKED = "M1. The probe header reports runner: None."
PLAN_UNBACKTICKED = _plan(_task("1", ["- Modify: `app/x.py`"],
                                MACHINE_UNBACKTICKED, LEGS_1))


def test_756_a_the_same_literal_unbackticked_in_the_clause_draws_nothing(
        tmp_path, repo):
    """leg (a) [M1]: a candidate span is a BACKTICKED span — the same twelve
    characters written plain in the Machine clause is not one."""
    lines = _lines(tmp_path, repo, PLAN_UNBACKTICKED, "plan_756_a_plain.md")
    assert lines == [], (
        "leg (a) [M1]: the clause reads `%s` with no backticks around `%s`, "
        "so there is no candidate span and nothing prints, even though "
        "tracked `%s` asserts the literal. Got:\n%s"
        % (MACHINE_UNBACKTICKED, LITERAL, PROBE_PY, "\n".join(lines)))


PLAN_PROSE_ONLY = _plan(_task_prose(
    "1", ["- Modify: `app/x.py`"],
    "M1. The probe header reports the marker the Claim above names.",
    "(a) the header carries `%s` [M1]." % LITERAL,
    "An operator is told which test already pins `%s`. (quoted from #756)"
    % LITERAL,
    "The marker at issue is `%s`, which the repo asserts in one probe file "
    "today." % LITERAL))


def test_756_a_a_literal_backticked_only_outside_the_machine_clause_is_silent(
        tmp_path, repo):
    """leg (a) [M1]: the operator sentence, the Context and a Proof leg all
    carry `runner: None` backticked; the Machine clause carries no backticked
    span at all. A render that reads any literal anywhere in the task fails
    here."""
    lines = _lines(tmp_path, repo, PLAN_PROSE_ONLY, "plan_756_a_prose.md")
    assert lines == [], (
        "leg (a) [M1]: `%s` is backticked in the Claim sentence, in the "
        "Context and in a leg of the Proof, and in NO Machine clause — the "
        "species reads Machine clauses, so nothing prints. Got:\n%s"
        % (LITERAL, "\n".join(lines)))


# --------------------------------------------------------------------------- #
# (b) [M2] a path — a slash, or a bare file name — is skipped                  #
# --------------------------------------------------------------------------- #
def test_756_b_a_slash_bearing_span_draws_nothing(tmp_path):
    lines = _one_span_lines(tmp_path, SPAN_SLASH, "756_b_slash")
    assert lines == [], (
        "leg (b) [M2]: `%s` holds a `/`, so it is a path and no line prints "
        "even though tracked undeclared `%s` asserts it. Got:\n%s"
        % (SPAN_SLASH, PROBE_PY, "\n".join(lines)))


def test_756_b_a_bare_file_name_span_draws_nothing(tmp_path):
    lines = _one_span_lines(tmp_path, SPAN_BARE_FILE, "756_b_bare")
    assert lines == [], (
        "leg (b) [M2]: `%s` is a run of word, dot and hyphen characters "
        "ending in a dot and one to four letters — a bare file name, so a "
        "path — and draws nothing though tracked undeclared `%s` asserts it. "
        "Got:\n%s" % (SPAN_BARE_FILE, PROBE_PY, "\n".join(lines)))


def test_756_b_the_literal_in_the_same_file_and_position_draws_one_line(
        tmp_path, repo):
    """leg (b) [M2]: the control for both silences above — the same probe
    file, the same clause position, a span that is no path."""
    lines = _lines(tmp_path, repo, PLAN, "plan_756_b_control.md")
    assert lines == [EXPECTED_ONE], (
        "leg (b) [M2]: `%s` in `%s`'s clause position, asserted by the same "
        "`%s`, draws one line — so the two silences above are the path skip "
        "and not the fixture:\n%s\ngot:\n%s"
        % (LITERAL, MACHINE_1, PROBE_PY, EXPECTED_ONE, "\n".join(lines)))


# --------------------------------------------------------------------------- #
# (c) [M2] a placeholder — a `<` and a later `>` — is skipped                  #
# --------------------------------------------------------------------------- #
def test_756_c_a_slash_and_placeholder_span_draws_nothing(tmp_path):
    lines = _one_span_lines(tmp_path, SPAN_SLASH_PLACEHOLDER, "756_c_both")
    assert lines == [], (
        "leg (c) [M2]: `%s` holds both a `/` and a `<`…`>` placeholder, so it "
        "draws nothing though tracked undeclared `%s` asserts it. Got:\n%s"
        % (SPAN_SLASH_PLACEHOLDER, PROBE_PY, "\n".join(lines)))


def test_756_c_a_bracket_only_span_draws_nothing(tmp_path):
    lines = _one_span_lines(tmp_path, SPAN_BRACKET_ONLY, "756_c_bracket")
    assert lines == [], (
        "leg (c) [M2]: `%s` holds no `/` at all — a `<` and a later `>` is "
        "enough to make it a placeholder — so it draws nothing though tracked "
        "undeclared `%s` asserts it. Got:\n%s"
        % (SPAN_BRACKET_ONLY, PROBE_PY, "\n".join(lines)))


def test_756_c_the_literal_in_the_same_file_and_position_draws_one_line(
        tmp_path, repo):
    """leg (c) [M2]: the control for both placeholder silences."""
    lines = _lines(tmp_path, repo, PLAN, "plan_756_c_control.md")
    assert lines == [EXPECTED_ONE], (
        "leg (c) [M2]: the same file and position with `%s` — no bracket — "
        "draws one line:\n%s\ngot:\n%s"
        % (LITERAL, EXPECTED_ONE, "\n".join(lines)))


# --------------------------------------------------------------------------- #
# (d) [M2] a state word, bare or quoted, is skipped                            #
# --------------------------------------------------------------------------- #
def test_756_d_each_state_word_bare_or_quoted_draws_nothing(tmp_path):
    """leg (d) [M2]: the six words of `fleet/CONTRACT.md`'s `state` enum, each
    bare and each wrapped in single and in double quotes, asserted by a
    tracked undeclared probe file — every one of them silent."""
    drawn = []
    for i, word in enumerate(STATE_WORDS):
        for j, span in enumerate((word, "'%s'" % word, '"%s"' % word)):
            lines = _one_span_lines(tmp_path, span, "756_d_%d_%d" % (i, j))
            if lines:
                drawn.append("%s -> %s" % (span, lines))
    assert drawn == [], (
        "leg (d) [M2]: a span that is one of %s once its surrounding single "
        "or double quotes are stripped, case-insensitively, is a state word "
        "the compiler already knows and draws nothing. These drew:\n%s"
        % (", ".join(STATE_WORDS), "\n".join(drawn)))


def test_756_d_a_non_state_twelve_character_word_draws_one_line(tmp_path):
    """leg (d) [M2]: the control — twelve characters, the same clause
    position, the same probe file, outside the six words. The silence above is
    the vocabulary, not the length."""
    lines = _one_span_lines(tmp_path, SPAN_NON_STATE, "756_d_control")
    expected = [pin_line("1", SPAN_NON_STATE, PROBE_PY)]
    assert lines == expected, (
        "leg (d) [M2]: `%s` is %d characters and is none of the six state "
        "words, so tracked undeclared `%s` asserting it draws one line:\n%s\n"
        "got:\n%s" % (SPAN_NON_STATE, len(SPAN_NON_STATE), PROBE_PY,
                      expected[0], "\n".join(lines)))


# --------------------------------------------------------------------------- #
# (e) [M3] a pinning file carries one of the eight code extensions             #
# --------------------------------------------------------------------------- #
def test_756_e_a_markdown_probe_under_tests_is_no_pinning_file(tmp_path):
    """leg (e) [M3]: `tests/fixtures/plans/probe.md` is a test file by BASE's
    path rule — it is under `tests/` — but `.md` is none of the eight code
    extensions, so it pins nothing. (This is what keeps the tracked fixture
    plans from pinning one another's literals.)"""
    base = _repo(tmp_path, "repo_756_e_md", {PROBE_MD: _probe_source(LITERAL)})
    lines = _lines(tmp_path, base, PLAN, "plan_756_e_md.md")
    assert lines == [], (
        "leg (e) [M3]: `%s` is the only file asserting `%s`; its extension is "
        "not one of %s, so it is no pinning file and nothing prints. Got:\n%s"
        % (PROBE_MD, LITERAL, ", ".join(CODE_EXTS_M3), "\n".join(lines)))


def test_756_e_a_py_under_tests_and_an_mjs_under_fleet_tests_are_named(
        tmp_path):
    """leg (e) [M3]: the two code files are pinning files, and the one line
    names both, in path order."""
    base = _repo(tmp_path, "repo_756_e_code",
                 {PROBE_MJS: _probe_source(LITERAL),
                  PROBE_PY: _probe_source(LITERAL)})
    lines = _lines(tmp_path, base, PLAN, "plan_756_e_code.md")
    expected = [species_line("1", [(LITERAL, [PROBE_MJS, PROBE_PY])])]
    assert lines == expected, (
        "leg (e) [M3]: `%s` (a `.mjs` under `fleet/tests/`) and `%s` (a `.py` "
        "under `tests/`) both assert `%s` and neither is in any task's Files, "
        "so one line names both in path order:\n%s\ngot:\n%s"
        % (PROBE_MJS, PROBE_PY, LITERAL, expected[0], "\n".join(lines)))


def test_756_e_the_four_test_file_shapes_are_one_line_naming_four(
        tmp_path, repo_four):
    """leg (e) [M3]: BASE's `test_one_line_per_pinning_file_sorted_by_path`,
    re-scoped to the one-line shape. All four of BASE's test-file shapes —
    under `tests/`, under `fleet/tests/`, a `test_` basename outside a tests
    directory (`lib/test_x.py`), a `.test.` infix basename (`src/foo.test.ts`)
    — carry one of the eight code extensions, so all four are pinning files
    and the task's ONE line names all four in path order."""
    lines = _lines(tmp_path, repo_four, PLAN, "plan_756_e_four.md")
    expected = [species_line("1", [(LITERAL, list(PIN_PATHS))])]
    assert lines == expected, (
        "leg (e) [M3]: `%s` is asserted in all four test-file shapes (%s) and "
        "none of them is declared, so ONE line names the four in path order — "
        "not four lines, and not a subset:\n%s\ngot:\n%s"
        % (LITERAL, ", ".join(PIN_PATHS), expected[0], "\n".join(lines)))


# --------------------------------------------------------------------------- #
# (f) [M3] no count of pinning files silences a span                           #
# --------------------------------------------------------------------------- #
def test_756_f_nine_undeclared_pinning_files_are_all_nine_named(tmp_path):
    """leg (f) [M3]: nine tracked undeclared test files — the count BASE
    silenced — are all nine named on one line, in path order. A render that
    silences a span above any file count fails here."""
    base = _many_repo(tmp_path, 9)
    lines = _lines(tmp_path, base, PLAN, "plan_756_f_nine.md")
    expected = [species_line("1", [(LITERAL, _probe_paths(9))])]
    assert lines == expected, (
        "leg (f) [M3]: nine tracked test files (%s) assert `%s` and none is "
        "declared, so one line names all nine in path order — no file-count "
        "threshold decides for the reader:\n%s\ngot:\n%s"
        % (", ".join(_probe_paths(9)), LITERAL, expected[0],
           "\n".join(lines)))


def test_756_f_with_one_of_the_nine_declared_the_other_eight_are_named(
        tmp_path):
    """leg (f) [M3]: the same nine files with `tests/test_p1.py` declared as
    task 2's `Test:` entry — the line names the other eight and not it."""
    base = _many_repo(tmp_path, 9)
    lines = _lines(tmp_path, base, PLAN_TASK_2_OWNS_P1,
                   "plan_756_f_nine_owned.md")
    expected = [species_line("1", [(LITERAL, _probe_paths(9)[1:])])]
    assert lines == expected, (
        "leg (f) [M3]: `tests/test_p1.py` is task 2's `- Test:` entry, so it "
        "folds at merge time and is not named; the other eight are:\n%s\n"
        "got:\n%s" % (expected[0], "\n".join(lines)))
    assert "tests/test_p1.py" not in lines[0], (
        "leg (f) [M3]: the declared file must not appear on the line:\n"
        + lines[0])


def test_756_f_eight_undeclared_pinning_files_are_one_line_naming_eight(
        tmp_path):
    """leg (f) [M3]: eight files — BASE's threshold value — are one line
    naming eight, not eight lines."""
    base = _many_repo(tmp_path, 8)
    lines = _lines(tmp_path, base, PLAN, "plan_756_f_eight.md")
    expected = [species_line("1", [(LITERAL, _probe_paths(8))])]
    assert lines == expected, (
        "leg (f) [M3]: eight tracked undeclared test files assert `%s`, so "
        "ONE line names all eight in path order:\n%s\ngot:\n%s"
        % (LITERAL, expected[0], "\n".join(lines)))


def test_756_f_a_single_pinning_file_in_some_tasks_files_draws_nothing(
        tmp_path, repo):
    """leg (f) [M3]: the one pinning file is task 2's `- Test:` entry, so the
    span has no pinning file left and the task draws no line."""
    lines = _lines(tmp_path, repo, PLAN_TASK_2_OWNS_PROBE,
                   "plan_756_f_owned.md")
    assert lines == [], (
        "leg (f) [M3]: `%s` is named in task 2's Files, so it is no pinning "
        "file and task 1 draws nothing. Got:\n%s"
        % (PROBE_PY, "\n".join(lines)))


# --------------------------------------------------------------------------- #
# (g) (h) (i) [M4] one line per task, clause order, and the two closers        #
# --------------------------------------------------------------------------- #
MACHINE_TWO_SPANS = ("M1. The probe header reports `%s`, and the wave marker "
                     "is `%s`." % (LITERAL, SPAN_WAVE))
PLAN_TWO_SPANS = _plan(_task("1", ["- Modify: `app/x.py`"],
                             MACHINE_TWO_SPANS, LEGS_1))

# leg (g), verbatim from the task's own words: two candidates, one file.
EXPECTED_TWO_SPANS_ONE_FILE = (
    "ADVISORY proof-species: pinned-elsewhere — task 1: "
    "runner: None is asserted in tests/test_probe.py; "
    "wave: fold is asserted in tests/test_probe.py, "
    "which is in no task's Files")

# leg (h), verbatim: two candidates, one file each.
EXPECTED_TWO_SPANS_TWO_FILES = (
    "ADVISORY proof-species: pinned-elsewhere — task 1: "
    "runner: None is asserted in tests/test_probe.py; "
    "wave: fold is asserted in tests/test_probe_two.py, "
    "none of which is in any task's Files")


def test_756_g_two_candidates_in_one_file_are_one_line_in_clause_order(
        tmp_path):
    """leg (g) [M4]: one probe file asserts both spans and task 1's clause
    carries them in that order — exactly one line, the two candidates joined
    by `; ` in CLAUSE order, closed by the one-file closer. A render that
    prints per span, or orders by span, fails here."""
    base = _repo(tmp_path, "repo_756_g",
                 {PROBE_PY: _probe_source_both(LITERAL, SPAN_WAVE)})
    lines = _lines(tmp_path, base, PLAN_TWO_SPANS, "plan_756_g.md")
    assert lines == [EXPECTED_TWO_SPANS_ONE_FILE], (
        "leg (g) [M4]: task 1's clause carries `%s` then `%s`, both asserted "
        "by `%s` alone, so exactly one line prints:\n%s\ngot:\n%s"
        % (LITERAL, SPAN_WAVE, PROBE_PY, EXPECTED_TWO_SPANS_ONE_FILE,
           "\n".join(lines)))
    assert lines == [species_line(
        "1", [(LITERAL, [PROBE_PY]), (SPAN_WAVE, [PROBE_PY])])]


def test_756_h_two_candidates_in_two_files_take_the_plural_closer(tmp_path):
    """leg (h) [M4]: one file per span — the line names two distinct files, so
    it closes `, none of which is in any task's Files`."""
    base = _repo(tmp_path, "repo_756_h",
                 {PROBE_PY: _probe_source(LITERAL),
                  PROBE_PY_TWO: _probe_source(SPAN_WAVE)})
    lines = _lines(tmp_path, base, PLAN_TWO_SPANS, "plan_756_h.md")
    assert lines == [EXPECTED_TWO_SPANS_TWO_FILES], (
        "leg (h) [M4]: `%s` asserts `%s` and `%s` asserts `%s`, so one line "
        "names two distinct files and takes the plural closer:\n%s\ngot:\n%s"
        % (PROBE_PY, LITERAL, PROBE_PY_TWO, SPAN_WAVE,
           EXPECTED_TWO_SPANS_TWO_FILES, "\n".join(lines)))
    assert lines == [species_line(
        "1", [(LITERAL, [PROBE_PY]), (SPAN_WAVE, [PROBE_PY_TWO])])]


def test_756_i_a_task_whose_candidates_pin_nothing_draws_no_line(
        tmp_path, repo):
    """leg (i) [M4]: task 1 carries only `wave: fold`, which no tracked file
    of the `repo` fixture holds — no candidate has a pinning file, so the task
    draws no line at all rather than an empty one."""
    lines = _lines(tmp_path, repo, _span_plan(SPAN_WAVE), "plan_756_i.md")
    assert lines == [], (
        "leg (i) [M4]: `%s` is in no tracked file of the checkout, so task 1 "
        "has no candidate with a pinning file and draws nothing. Got:\n%s"
        % (SPAN_WAVE, "\n".join(lines)))


def test_756_i_three_tasks_carrying_the_same_span_draw_three_lines(
        tmp_path, repo):
    """leg (i) [M4]: one line PER TASK — three tasks carrying the same span
    against the same checkout are three lines, in task order."""
    lines = _lines(tmp_path, repo, PLAN_THREE_TASKS, "plan_756_i_three.md")
    expected = [species_line(i, [(LITERAL, [PROBE_PY])])
                for i in ("1", "2", "3")]
    assert lines == expected, (
        "leg (i) [M4]: tasks 1, 2 and 3 each carry `%s` and `%s` pins it for "
        "all three, so three lines print in task order. Got:\n%s\nwanted:\n%s"
        % (LITERAL, PROBE_PY, "\n".join(lines), "\n".join(expected)))
    assert expected[0] == EXPECTED_ONE


# --------------------------------------------------------------------------- #
# (j)–(r) [M5] the six tracked 2026-09-07 fixture plans                        #
# --------------------------------------------------------------------------- #
FIXTURE_DIR = ROOT / "tests/fixtures/plans/2026-09-07"
FIXTURES = (
    ("acceptance-log", "2026-09-07-acceptance-log-on-the-record.md"),
    ("boot-pipelines", "2026-09-07-boot-pipelines-survive-sigpipe.md"),
    ("evidence-page", "2026-09-07-evidence-page-per-phase.md"),
    ("publish-decisions", "2026-09-07-publish-decisions-as-events.md"),
    ("retire-closed", "2026-09-07-retire-closed-unmerged-branches.md"),
    ("retire-skips", "2026-09-07-retire-skips-live-runs.md"),
)
FILES_BULLET = re.compile(r"^- (?:Create|Modify|Test):\s*`([^`]+)`", re.M)

# This exam file is itself a tracked, undeclared `.py` test file under
# `tests/`, so a fixture-plan literal spelled whole here would join that
# literal's own file list. The two the legs name are spelled apart.
SPAN_TEST_CMD = "test" + "Cmd"
SPAN_COMMIT_STATES = "commitStates" + "(ctx)"
BOOT_EDGES = "fleet/tests/test_sandbox_boot_edges.mjs"
BOOT_DECLARED = "fleet/tests/test_sandbox_boot.mjs"


def _pinned_anywhere(stdout):
    """M5 counts lines CONTAINING `pinned-elsewhere`, not only lines opening
    with the species prefix."""
    return [l for l in stdout.splitlines() if "pinned-elsewhere" in l]


@pytest.fixture(scope="session")
def tracked_paths():
    p = subprocess.run(["git", "-C", str(ROOT), "ls-files"],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return set(p.stdout.splitlines())


@pytest.fixture(scope="session")
def corpus(tmp_path_factory):
    """Each of the six tracked 2026-09-07 fixture plans, copied beside a
    gate-verdict record so it compiles, run twice: `--check --renders --base
    <repo root>` (so the tree the species greps is this checkout) and bare
    `--check`. The copies are made because signing writes an artifact beside
    the plan, and this task edits none of the six."""
    d = tmp_path_factory.mktemp("plans_2026_09_07")
    runs = {}
    for key, name in FIXTURES:
        src = FIXTURE_DIR / name
        assert src.exists(), (
            "[M5]: the fixture plan %s is Stale-if path-absent" % src)
        text = src.read_text()
        plan = d / name
        plan.write_text(text)
        _sign(plan)
        rendered = _check(plan, "--renders", "--base", str(ROOT))
        assert (rendered.returncode,
                rendered.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
            "[M5]: fixture plan %s must compile clean before its species "
            "lines are read; got rc=%d\n%s%s"
            % (name, rendered.returncode, rendered.stdout, rendered.stderr))
        runs[key] = {
            "name": name,
            "rendered": rendered,
            "bare": _check(plan),
            "task_ids": [t["id"] for t in compile_plan.split_tasks(text)],
            "declared": set(FILES_BULLET.findall(text)),
        }
    return runs


def _segments(line):
    """M4's grammar, read off a printed line: the closer, then the `; `
    separated segments, each `<span> is asserted in <path>, <path>`. Raises
    ValueError when the line does not parse that way."""
    head = LINE_HEAD.match(line)
    if head is None:
        raise ValueError("line does not open with M4's head: " + line)
    detail = line[head.end():]
    for closer in (CLOSER_MANY, CLOSER_ONE):
        if detail.endswith(closer):
            detail = detail[:-len(closer)]
            break
    else:
        raise ValueError("line closes with neither %r nor %r: %s"
                         % (CLOSER_ONE, CLOSER_MANY, line))
    segments = []
    for segment in detail.split("; "):
        span, sep, rest = segment.partition(" is asserted in ")
        if not sep:
            raise ValueError("segment %r is not `<span> is asserted in "
                             "<files>`: %s" % (segment, line))
        segments.append((span, rest.split(", ")))
    return segments, closer


def _line_for_task(lines, task_id):
    for line in lines:
        head = LINE_HEAD.match(line)
        if head is not None and head.group(1) == task_id:
            return line
    return None


def _per_task_bound(corpus, key, leg):
    """[M5]: at most one line containing `pinned-elsewhere` per task of the
    plan — and every such line is one of that plan's tasks'."""
    run = corpus[key]
    lines = _pinned_anywhere(run["rendered"].stdout)
    ids = [LINE_HEAD.match(l).group(1) for l in lines if LINE_HEAD.match(l)]
    assert len(ids) == len(lines), (
        "leg (%s) [M5]: every line containing `pinned-elsewhere` in %s's "
        "render is a `%s — task <id>: ` line. Got:\n%s"
        % (leg, run["name"], PINNED_PREFIX, "\n".join(lines)))
    assert len(lines) <= len(run["task_ids"]), (
        "leg (%s) [M5]: %s has %d task(s), so at most %d line(s) containing "
        "`pinned-elsewhere` may print — a render keeping a per-file or a "
        "file-count line prints more. Got %d:\n%s"
        % (leg, run["name"], len(run["task_ids"]), len(run["task_ids"]),
           len(lines), "\n".join(lines)))
    assert len(set(ids)) == len(ids), (
        "leg (%s) [M5]: at most ONE line per task — task ids %s repeat in "
        "%s's render:\n%s" % (leg, ids, run["name"], "\n".join(lines)))
    assert set(ids) <= set(run["task_ids"]), (
        "leg (%s) [M5]: %s's tasks are %s; the render named %s"
        % (leg, run["name"], run["task_ids"], sorted(set(ids))))
    return lines


def test_756_j_acceptance_log_holds_the_bound_and_names_the_command_literal(
        corpus):
    """leg (j) [M5]: the acceptance-log plan — the per-task bound, and its
    task 1 line names the literal BASE's eight-file line silenced. A render
    keeping a file-count line fails here."""
    lines = _per_task_bound(corpus, "acceptance-log", "j")
    line = _line_for_task(lines, "1")
    assert line is not None, (
        "leg (j) [M5]: the acceptance-log plan's task 1 draws a line naming "
        "`%s`. Got:\n%s" % (SPAN_TEST_CMD, "\n".join(lines)))
    spans = [span for span, _ in _segments(line)[0]]
    assert SPAN_TEST_CMD in spans, (
        "leg (j) [M5]: `%s` is in more tracked test files than BASE's "
        "eight-file line allowed and in none of that plan's Files, so task "
        "1's line names it. Its spans were %s\nline: %s"
        % (SPAN_TEST_CMD, spans, line))


def test_756_k_boot_pipelines_holds_the_per_task_bound(corpus):
    """leg (k) [M5]."""
    _per_task_bound(corpus, "boot-pipelines", "k")


def test_756_l_evidence_page_holds_the_bound_and_applies_declared_filter(
        corpus):
    """leg (l) [M5]: the evidence-page plan — the per-task bound, and its task
    1 line's `commitStates` segment names the undeclared boot-edges test and
    NOT `fleet/tests/test_sandbox_boot.mjs`, which that plan's Files declares.
    A render skipping the declared filter fails here."""
    lines = _per_task_bound(corpus, "evidence-page", "l")
    line = _line_for_task(lines, "1")
    assert line is not None, (
        "leg (l) [M5]: the evidence-page plan's task 1 draws a line naming "
        "`%s`. Got:\n%s" % (SPAN_COMMIT_STATES, "\n".join(lines)))
    named = dict(_segments(line)[0]).get(SPAN_COMMIT_STATES)
    assert named is not None, (
        "leg (l) [M5]: task 1's line carries a `%s is asserted in …` segment. "
        "Got:\n%s" % (SPAN_COMMIT_STATES, line))
    assert BOOT_EDGES in named, (
        "leg (l) [M5]: `%s` asserts `%s` and no task of that plan declares "
        "it, so the segment names it. Got: %s"
        % (BOOT_EDGES, SPAN_COMMIT_STATES, named))
    assert BOOT_DECLARED not in named, (
        "leg (l) [M5]: `%s` is that plan's own `Test:` entry — a pin that "
        "folds at merge time — so the segment must not name it. Got: %s"
        % (BOOT_DECLARED, named))


def test_756_m_publish_decisions_holds_the_per_task_bound(corpus):
    """leg (m) [M5]."""
    _per_task_bound(corpus, "publish-decisions", "m")


def test_756_n_retire_closed_holds_the_per_task_bound(corpus):
    """leg (n) [M5]."""
    _per_task_bound(corpus, "retire-closed", "n")


def test_756_o_retire_skips_holds_the_per_task_bound(corpus):
    """leg (o) [M5]."""
    _per_task_bound(corpus, "retire-skips", "o")


def test_756_p_the_six_runs_together_print_at_least_one_line(corpus):
    """leg (p) [M5]: a species that went silent fails here."""
    counted = {run["name"]: len(_pinned_anywhere(run["rendered"].stdout))
               for run in corpus.values()}
    assert sum(counted.values()) >= 1, (
        "leg (p) [M5]: across the six 2026-09-07 fixture plans at least one "
        "line containing `pinned-elsewhere` prints under `--check --renders "
        "--base <repo root>`. Counted: %s" % counted)


def test_756_q_every_line_of_the_six_runs_names_a_real_span_and_real_files(
        corpus, tracked_paths):
    """leg (q) [M5]: the structural row. Every line of the six runs parses as
    M4's grammar, every named span passes M2's three skips, and every named
    file is a tracked code test file of this checkout that contains the span
    and that no Files block of that plan names."""
    problems = []
    for key, run in corpus.items():
        for line in _pinned_anywhere(run["rendered"].stdout):
            where = "%s: %s" % (run["name"], line)
            try:
                segments, closer = _segments(line)
            except ValueError as exc:
                problems.append("%s — %s" % (run["name"], exc))
                continue
            named = set()
            for span, paths in segments:
                if "/" in span:
                    problems.append("%s\n  span %r holds a `/` — a path [M2]"
                                    % (where, span))
                if BARE_FILE_NAME.match(span):
                    problems.append("%s\n  span %r is a bare file name [M2]"
                                    % (where, span))
                opened = span.find("<")
                if opened != -1 and span.find(">", opened + 1) != -1:
                    problems.append("%s\n  span %r is a placeholder [M2]"
                                    % (where, span))
                if span.strip("'\"").lower() in STATE_WORDS:
                    problems.append("%s\n  span %r is a state word [M2]"
                                    % (where, span))
                for path in paths:
                    named.add(path)
                    if path not in tracked_paths:
                        problems.append("%s\n  %s is not tracked [M5]"
                                        % (where, path))
                        continue
                    if not path.endswith(CODE_EXTS_M3):
                        problems.append(
                            "%s\n  %s carries none of the eight code "
                            "extensions [M3]" % (where, path))
                    if path in run["declared"]:
                        problems.append(
                            "%s\n  %s is declared by that plan's Files [M3]"
                            % (where, path))
                    if span.encode() not in (ROOT / path).read_bytes():
                        problems.append("%s\n  %s does not contain %r [M1]"
                                        % (where, path, span))
            want = CLOSER_ONE if len(named) == 1 else CLOSER_MANY
            if closer != want:
                problems.append(
                    "%s\n  names %d distinct file(s), so it closes %r, not "
                    "%r [M4]" % (where, len(named), want, closer))
    assert not problems, (
        "leg (q) [M5]: every line of the six runs must parse as M4's grammar "
        "with every span past M2 and every file past M3. %d problem(s):\n%s"
        % (len(problems), "\n".join(problems)))


def test_756_r_bare_check_on_each_of_the_six_is_clean_and_silent(corpus):
    """leg (r) [M5]: the new render prints only under `--renders` — bare
    `--check` on each of the six exits 0 with no `pinned-elsewhere` line."""
    problems = []
    for key, run in corpus.items():
        bare = run["bare"]
        if bare.returncode != 0:
            problems.append("%s: rc=%d\n%s%s"
                            % (run["name"], bare.returncode, bare.stdout,
                               bare.stderr))
        hits = _pinned_anywhere(bare.stdout)
        if hits:
            problems.append("%s printed:\n%s" % (run["name"], "\n".join(hits)))
    assert not problems, (
        "leg (r) [M5]: bare `--check` on each of the six 2026-09-07 fixture "
        "plans exits 0 and prints no line containing `pinned-elsewhere`:\n"
        + "\n".join(problems))
