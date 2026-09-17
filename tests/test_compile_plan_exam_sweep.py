"""One Run, one exam: the compiler refuses a sweeping Proof `Run:` (#212h).

An exam proves one claim. A `Run:` line that hands a test runner two exam files
at once — or the whole `tests/state-exams/` directory — makes one task's proof
re-run another's, which is regression, and regression is the fold's. So the
grammar refuses that line, and the three documents that teach the rule say it.

The five Machine clauses, restated, and where each is graded here:

  * M1 `_exam_sweep_run_violation(command, task_id)` is a module-level function
    of `compile_plan.py`, beside `_backtick_command_violation`. It returns
    `None` unless the command carries, as whole tokens over the alphabet
    `[\\w./-]` that `command_names_path` uses, either two or more DISTINCT paths
    beginning `tests/state-exams/` or the bare directory token
    `tests/state-exams` (with or without a trailing `/`). When it does, it
    returns

        grammar: Run: one Run, one exam — task <id>: <command cut to 80 characters> names <k> paths under tests/state-exams/

    with `<k>` the distinct count, and `1` for the bare directory. Graded by
    legs (a) exact string, two and three paths; (b) the bare directory, both
    spellings; (c) the five commands it must NOT fire on; (d) the 80-character
    cut.
  * M2 `parse_task` appends that string to the task's grammar violations for
    every Proof `Run:` line it draws, beside the backtick refusal, so
    `--check` on a plan carrying such a line exits non-zero with the string on
    stderr, and `--check` on a plan whose every `Run:` names at most one
    `tests/state-exams/` path prints `PLAN OK`. Graded by legs (e) and (f),
    which compile a real two-task claims-v1 plan as a subprocess.
  * M3 `skills/ultrawrite/references/greenfield-stack.md` §State exams carries
    the paragraph and the exact blocking Global Constraint in a fenced block,
    and that Check command really does exit 0 on a clean tree and 1 naming the
    offender on a dirty one. Graded by legs (g) — the Proof's first two `Run:`
    lines, byte for byte — and (h), which builds both trees.
  * M4 `fleet/roles/examiner.md` carries the sentence above `## The issue`.
    Graded by leg (i), the Proof's third `Run:` line.
  * M5 `skills/ultrawrite/references/authoring-gotchas.md` carries one new row
    naming `one Run, one exam` under a rows heading reading
    `## The fourteen rows`, and the rows between that heading and
    `## Three older lessons` number exactly fourteen. Graded by leg (j), the
    Proof's fourth and fifth `Run:` lines.

The Proof's sixth `Run:` line, `wc -w fleet/roles/examiner.md`, is a reading
the task reports and never gates, so no leg cites it and none is written here.

The shape is `tests/test_compile_plan_edges.py`: the direct legs import
`compile_plan` from `skills/ultrapowers/scripts` and call the function; the
`--check` legs write a real claims-v1 plan to `tmp_path` with its gate-verdict
record signed by the gate's own extractor, run the compiler as a subprocess,
and read the exit code and the two output channels.
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import compile_plan  # noqa: E402

sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))
from extract_gate_input import gate_input, verdicts_path  # noqa: E402


def violation(command, task_id):
    """The function under test, reached through the module so a BASE tree
    fails here with `module 'compile_plan' has no attribute
    '_exam_sweep_run_violation'` — the absent implementation, not a bad
    import."""
    return compile_plan._exam_sweep_run_violation(command, task_id)


def expected(command, task_id, k):
    """The string M1 pins, verbatim: one `grammar:` line, the command cut to
    its first 80 characters, the distinct count."""
    return ("grammar: Run: one Run, one exam — task %s: %s names %s paths "
            "under tests/state-exams/" % (task_id, command[:80], k))


# The two fixed halves leg (a) spells out, kept apart so the leg's own
# "begins ... and ends ..." reading is graded as the leg words it.
BEGINS_TASK_2 = "grammar: Run: one Run, one exam — task 2: "
ENDS_N = "names %s paths under tests/state-exams/"


# =========================================================================== #
# M1 — the function itself                                                    #
# =========================================================================== #

def test_the_function_is_module_level_beside_the_backtick_refusal():
    """[M1]: `_exam_sweep_run_violation` is a module-level function of
    `compile_plan.py`, beside `_backtick_command_violation`."""
    assert callable(getattr(compile_plan, "_exam_sweep_run_violation", None)), (
        "compile_plan.py has no module-level _exam_sweep_run_violation")
    assert callable(compile_plan._backtick_command_violation), (
        "the sibling refusal this one is written beside is gone")


# ── (a) two or more distinct exam paths ────────────────────────────────────
# "(a) `_exam_sweep_run_violation(\"bun test tests/state-exams/a.test.ts
# tests/state-exams/b.test.ts\", \"2\")` returns a string that begins
# `grammar: Run: one Run, one exam — task 2: ` and ends
# `names 2 paths under tests/state-exams/`, and the same with three distinct
# paths ends `names 3 paths under tests/state-exams/` [M1]"

TWO_PATHS = ("bun test tests/state-exams/a.test.ts "
             "tests/state-exams/b.test.ts")
THREE_PATHS = ("bun test tests/state-exams/a.ts tests/state-exams/b.ts "
               "tests/state-exams/c.ts")


def test_a_two_distinct_exam_paths_are_refused():
    """(a)/[M1]: two exams in one `Run:` — refused, counted 2."""
    got = violation(TWO_PATHS, "2")
    assert got is not None, "two distinct exam paths drew no refusal"
    assert got.startswith(BEGINS_TASK_2), got
    assert got.endswith(ENDS_N % 2), got
    # M1 pins the whole line, not only its two ends.
    assert got == expected(TWO_PATHS, "2", 2), got


def test_a_three_distinct_exam_paths_are_counted_three():
    """(a)/[M1]: the count is the distinct path count, not a fixed word."""
    got = violation(THREE_PATHS, "2")
    assert got is not None, "three distinct exam paths drew no refusal"
    assert got.startswith(BEGINS_TASK_2), got
    assert got.endswith(ENDS_N % 3), got
    assert got == expected(THREE_PATHS, "2", 3), got


def test_a_the_task_id_is_the_one_passed_in():
    """(a)/[M1]: `<id>` is the caller's task id, so a different task's line
    names that task."""
    got = violation(TWO_PATHS, "7")
    assert got == expected(TWO_PATHS, "7", 2), got


# ── (b) the bare directory, either spelling ────────────────────────────────
# "(b) for each of `bun test tests/state-exams` and `bun test
# tests/state-exams/` it returns a string ending `names 1 paths under
# tests/state-exams/` [M1]"

BARE_DIR_COMMANDS = ["bun test tests/state-exams", "bun test tests/state-exams/"]


def test_b_the_bare_directory_is_refused_and_counted_one():
    """(b)/[M1]: a sweep of the whole directory is one token, counted 1 —
    with or without the trailing slash."""
    for command in BARE_DIR_COMMANDS:
        got = violation(command, "2")
        assert got is not None, "%r drew no refusal" % command
        assert got.endswith(ENDS_N % 1), (command, got)
        assert got == expected(command, "2", 1), (command, got)


# ── (c) the commands the rule must not fire on ─────────────────────────────
# "(c) for each of `bun test tests/state-exams/a.test.ts`, `bun test
# tests/state-exams/a.test.ts tests/state-exams/a.test.ts` (one path twice),
# `bun run lint:state`, `bun test tests/state-examsx/a.test.ts
# tests/state-examsx/b.test.ts` and `test -f tests/state-exams/a.test.ts.bak`
# it returns `None` [M1]"

CLEAN_COMMANDS = [
    # One exam, one prover — the shape the rule exists to leave alone.
    "bun test tests/state-exams/a.test.ts",
    # The same path twice is one path named twice, not two paths.
    "bun test tests/state-exams/a.test.ts tests/state-exams/a.test.ts",
    # Names no exam path at all.
    "bun run lint:state",
    # Inspection, not a sweep (run-26, 2026-09-17): a grep over many exam
    # paths runs no exam, and neither does a diff fence that mentions the
    # directory.
    "! grep -lE 'spawn|exec' tests/state-exams/a.test.ts tests/state-exams/b.test.ts tests/state-exams/c.test.ts",
    "! git diff --name-status $ULTRA_BASE | grep -vE '^M[[:space:]]+tests/state-exams/[a-z0-9-]+\\.test\\.ts$'",
    "ls tests/state-exams",
    # `tests/state-examsx/` is a different directory: the token boundary is
    # the path alphabet, so `tests/state-exams` does not match inside it.
    ("bun test tests/state-examsx/a.test.ts "
     "tests/state-examsx/b.test.ts"),
    # `a.test.ts.bak` is a different single path from `a.test.ts`.
    "test -f tests/state-exams/a.test.ts.bak",
]


def test_c_the_five_clean_commands_draw_no_refusal():
    """(c)/[M1]: the refusal is deliberately narrow — each of these returns
    `None`."""
    for command in CLEAN_COMMANDS:
        assert violation(command, "2") is None, (
            "%r was refused and should not be" % command)


# ── (d) the 80-character cut ───────────────────────────────────────────────
# "(d) a command longer than 80 characters is cut to its first 80 in the
# returned string [M1]"

LONG_COMMAND = ("bun test tests/state-exams/a.test.ts "
                "tests/state-exams/b.test.ts tests/state-exams/c.test.ts")


def test_d_a_long_command_is_cut_to_its_first_eighty_characters():
    """(d)/[M1]: long enough to name which bullet, short enough to keep the
    refusal one line."""
    assert len(LONG_COMMAND) > 80, "the fixture command is not long enough"
    got = violation(LONG_COMMAND, "2")
    assert got is not None, "the long command drew no refusal"
    assert got == expected(LONG_COMMAND, "2", 3), got
    # The cut is at 80 exactly: the 80-character prefix is present, the
    # 81-character one is not, and the count still reads the whole command.
    assert LONG_COMMAND[:80] in got, got
    assert LONG_COMMAND[:81] not in got, got
    assert got.endswith(ENDS_N % 3), got


# =========================================================================== #
# M2 — the compiler refuses the plan                                          #
# =========================================================================== #
# A real two-task claims-v1 plan, parameterized on the one thing these legs    #
# vary: task 2's Proof `Run:` line, and the Global Constraints block. Every    #
# other line is the fixed grammar the compiler requires.                       #

HEAD = """# Sweep probe

**Grammar:** claims-v1

**Acceptance:** waived — exam fixture; this plan is compiled, never executed

**Claim:** An operator gets one prover per claim. (elicited)
"""

TASK_1 = """
### Task 1: The view

**Type:** implementation

**Files:**
- Modify: `src/view.ts`
- Test: `tests/test_view.py`

**Claim:** An operator opening the view sees a row. (derived)
Machine: M1. The view renders one row.

**Authorized-by:** #212h

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The view is a standalone module with no registry to update.

**Proof:**
- Test: `tests/test_view.py`
- The suite asserts the view renders one row. [M1]

**Stale-if:**
- path-exists: `src/view.ts`
"""

TASK_2 = """
### Task 2: The filter

**Type:** implementation

**Files:**
- Modify: `src/filter.ts`
- Test: `tests/test_filter.py`

**Claim:** An operator setting the filter sees fewer rows. (derived)
Machine: M1. The filter drops the rows that do not match.

**Authorized-by:** #212h

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The filter is a one-function module with no registry to update.

**Proof:**
- Test: `tests/test_filter.py`
{run2}- The suite asserts the filter drops the rows that do not match. [M1]

**Stale-if:**
- path-exists: `src/filter.ts`
"""

RUN_SWEEPING = ("- Run: bun test tests/state-exams/a.test.ts "
                "tests/state-exams/b.test.ts\n")
RUN_SINGLE = "- Run: bun test tests/state-exams/a.test.ts\n"

CONSTRAINTS_SWEEPING_CHECK = """
## Global Constraints

- Check: bun test tests/state-exams/a.test.ts tests/state-exams/b.test.ts
- The exams stay offline.
"""


def make_plan(run2="", constraints=""):
    return HEAD + constraints + TASK_1 + TASK_2.format(run2=run2)


def _write_plan(tmp_path, name, text):
    """The plan plus the gate-verdict artifact claims-v1 compiles against
    (spec §4.5), hashed by the gate's own extractor so a fixture edit re-signs
    itself rather than going stale against a hand-copied digest."""
    plan = tmp_path / name
    plan.write_text(text)
    entries = {tid: gate_input(plan, tid) for tid in ("1", "2")}
    verdicts_path(plan).write_text(json.dumps(
        {"tasks": {tid: {"hash": e["hash"], "verdict": "pass",
                         "reason": "fixture"}
                   for tid, e in entries.items()},
         "tally": {"dispatched": len(entries), "rejected": 0}}))
    return plan


def check(tmp_path, name, text):
    plan = _write_plan(tmp_path, name, text)
    return subprocess.run([sys.executable, str(COMPILER), str(plan), "--check"],
                          capture_output=True, text=True)


# ── (e) a sweeping Run: is refused at --check ──────────────────────────────
# "(e) `--check` on a plan whose task 2 carries `- Run: bun test
# tests/state-exams/a.test.ts tests/state-exams/b.test.ts` exits non-zero and
# its stderr contains `one Run, one exam` and `task 2` [M2]"

def test_e_check_refuses_a_plan_whose_run_sweeps_two_exams(tmp_path):
    """(e)/[M2]: the refusal reaches the error channel, as M2 and the task's
    Context both state ("exits non-zero with the string on stderr" / "read the
    exit code and stderr"), and it names the offending task."""
    p = check(tmp_path, "e1.md", make_plan(run2=RUN_SWEEPING))
    both = p.stdout + p.stderr
    assert p.returncode != 0, both
    assert "PLAN OK" not in both, both
    assert "one Run, one exam" in p.stderr, (
        "stderr carried no `one Run, one exam` refusal.\n"
        "stdout:\n%s\nstderr:\n%s" % (p.stdout, p.stderr))
    assert "task 2" in p.stderr, (
        "the refusal on stderr does not name task 2.\n"
        "stderr:\n%s" % p.stderr)
    # One line, naming both — the shape a task violation already prints.
    named = [line for line in p.stderr.splitlines()
             if "one Run, one exam" in line and "task 2" in line]
    assert named, p.stderr


# ── (f) one exam per Run:, and Check: lines are not read by this rule ───────
# "(f) `--check` on the same plan with that line replaced by `- Run: bun test
# tests/state-exams/a.test.ts` exits 0 with `PLAN OK` on stdout, and a plan
# whose `Check:` line reads `- Check: bun test tests/state-exams/a.test.ts
# tests/state-exams/b.test.ts` is not refused by this rule (no `one Run, one
# exam` on stderr) [M2]"

def test_f_check_passes_the_same_plan_naming_one_exam(tmp_path):
    """(f)/[M2]: the refusal is that `Run:` line and nothing else about the
    plan — name one exam and the same plan prints `PLAN OK`."""
    p = check(tmp_path, "f1.md", make_plan(run2=RUN_SINGLE))
    assert p.returncode == 0, p.stdout + p.stderr
    assert p.stdout.strip() == "PLAN OK", p.stdout + p.stderr


def test_f_a_sweeping_check_line_is_not_read_by_this_rule(tmp_path):
    """(f)/[M2]: `Check:` lines are not read by this rule at all — whatever
    else the plan-level check rules say about it, no `one Run, one exam`."""
    p = check(tmp_path, "f2.md",
              make_plan(constraints=CONSTRAINTS_SWEEPING_CHECK))
    assert "one Run, one exam" not in p.stderr, p.stderr
    assert "one Run, one exam" not in p.stdout, p.stdout


# =========================================================================== #
# M3/M4/M5 — the documents say the rule                                       #
# =========================================================================== #
# The Proof's gated `Run:` lines, byte for byte. The sixth, `wc -w            #
# fleet/roles/examiner.md`, is a reading and gates nothing, so it is not here. #

RUN_GREENFIELD_PARAGRAPH = (
    r"sed -n '/^## State exams/,/^## Styling/p' "
    r"skills/ultrawrite/references/greenfield-stack.md | tr '\n' ' ' | "
    r"grep -q 'never spawns a test runner.*one claim, one prover'")

RUN_GREENFIELD_CHECK = (
    r"sed -n '/^## State exams/,/^## Styling/p' "
    r"skills/ultrawrite/references/greenfield-stack.md | tr '\n' ' ' | "
    r'''grep -q "Check: ! grep -rlE 'bun test|bun run|Bun\\\\.spawn|spawnSync|execSync' tests/state-exams"''')

RUN_EXAMINER = (
    r"sed -n '1,/^## The issue/p' fleet/roles/examiner.md | tr '\n' ' ' | "
    r"grep -q 'never runs another exam.*linter.*typecheck.*fold'")

RUN_GOTCHAS_ROW = (
    r"sed -n '/^## The fourteen rows/,/^## Three older/p' "
    r"skills/ultrawrite/references/authoring-gotchas.md | tr '\n' ' ' | "
    r"grep -q 'one Run, one exam'")

RUN_GOTCHAS_COUNT = (
    r'''test "$(sed -n '/^## The fourteen rows/,/^## Three older/p' '''
    r'''skills/ultrawrite/references/authoring-gotchas.md | grep -c '^- \*\*')" = 14''')


def _shell(cmd, cwd=None):
    return subprocess.run(["bash", "-c", cmd], cwd=str(cwd or ROOT),
                          capture_output=True, text=True)


# ── (g) the two greenfield Run: lines ──────────────────────────────────────
# "(g) the two greenfield `Run:` lines below exit 0 [M3]"

def test_g_greenfield_state_exams_says_an_exam_never_spawns_a_runner():
    """(g)/[M3]: §State exams of the authoring reference carries the
    paragraph — `never spawns a test runner` and `one claim, one prover`, in
    that order."""
    p = _shell(RUN_GREENFIELD_PARAGRAPH)
    assert p.returncode == 0, (
        "the State exams section of skills/ultrawrite/references/"
        "greenfield-stack.md does not say an exam never spawns a test runner, "
        "one claim, one prover\nstderr:\n%s" % p.stderr)


def test_g_greenfield_state_exams_carries_the_exact_check_line():
    """(g)/[M3]: and the exact blocking Global Constraint, in a fenced
    block."""
    p = _shell(RUN_GREENFIELD_CHECK)
    assert p.returncode == 0, (
        "the State exams section of skills/ultrawrite/references/"
        "greenfield-stack.md does not carry the exact Check line\n"
        "stderr:\n%s" % p.stderr)


# ── (h) the Check command really does what M3 says ─────────────────────────
# "(h) the exact command `! grep -rlE 'bun test|bun run|Bun\\.spawn|spawnSync|
# execSync' tests/state-exams`, run by `bash -lc` in a `tmp_path` tree holding
# `tests/state-exams/a.test.ts` with the content `import x from \"y\"`, exits
# `0` with empty stdout; and for each of the five literals `bun test`,
# `bun run`, `Bun.spawn(`, `spawnSync(` and `execSync(`, the same command in a
# tree where `tests/state-exams/b.test.ts` carries that literal exits `1` and
# its stdout contains `tests/state-exams/b.test.ts` [M3]"

CHECK_COMMAND = (
    r"! grep -rlE 'bun test|bun run|Bun\.spawn|spawnSync|execSync' "
    r"tests/state-exams")

CLEAN_EXAM = 'import x from "y"'

FIVE_LITERALS = ["bun test", "bun run", "Bun.spawn(", "spawnSync(",
                 "execSync("]


def _exam_tree(tmp_path, extra=None):
    """A tree with one clean exam, and optionally one offender."""
    exams = tmp_path / "tests" / "state-exams"
    exams.mkdir(parents=True, exist_ok=True)
    (exams / "a.test.ts").write_text(CLEAN_EXAM + "\n")
    if extra is not None:
        (exams / "b.test.ts").write_text(extra + "\n")
    return tmp_path


def _login_shell(cmd, cwd):
    return subprocess.run(["bash", "-lc", cmd], cwd=str(cwd),
                          capture_output=True, text=True)


def test_h_the_check_passes_a_clean_tree(tmp_path):
    """(h)/[M3]: no exam spawns a runner — exit 0, nothing printed."""
    p = _login_shell(CHECK_COMMAND, _exam_tree(tmp_path))
    assert p.returncode == 0, (p.returncode, p.stdout, p.stderr)
    assert p.stdout == "", p.stdout


def test_h_the_check_fails_naming_the_offender_for_each_literal(tmp_path):
    """(h)/[M3]: each of the five literals is an offender, and the Check
    prints the offending exam's path."""
    for i, literal in enumerate(FIVE_LITERALS):
        tree = _exam_tree(tmp_path / ("t%d" % i),
                          'const r = %s"x");' % literal)
        p = _login_shell(CHECK_COMMAND, tree)
        assert p.returncode == 1, (literal, p.returncode, p.stdout, p.stderr)
        assert "tests/state-exams/b.test.ts" in p.stdout, (literal, p.stdout)


# ── (i) the examiner role says it ──────────────────────────────────────────
# "(i) the examiner `Run:` line below exits 0 [M4]"

def test_i_the_examiner_role_says_an_exam_never_runs_another_exam():
    """(i)/[M4]: above `## The issue`, in one sentence, with its operative
    words in order — `never runs another exam`, `linter`, `typecheck`,
    `fold`."""
    p = _shell(RUN_EXAMINER)
    assert p.returncode == 0, (
        "fleet/roles/examiner.md does not say, above `## The issue`, that an "
        "exam never runs another exam, a linter or a typecheck — regression "
        "is the fold's\nstderr:\n%s" % p.stderr)


# ── (j) the gotchas row, and the row count ─────────────────────────────────
# "(j) the two gotchas `Run:` lines below exit 0 [M5]"

def test_j_the_gotchas_rows_carry_one_run_one_exam():
    """(j)/[M5]: one new row naming `one Run, one exam`, under a rows heading
    that now reads `## The fourteen rows`."""
    p = _shell(RUN_GOTCHAS_ROW)
    assert p.returncode == 0, (
        "skills/ultrawrite/references/authoring-gotchas.md has no "
        "`one Run, one exam` row under `## The fourteen rows`\n"
        "stderr:\n%s" % p.stderr)


def test_j_the_gotchas_rows_number_exactly_fourteen():
    """(j)/[M5]: the rows between `## The fourteen rows` and `## Three older
    lessons` number exactly fourteen — the heading counts what is under it."""
    p = _shell(RUN_GOTCHAS_COUNT)
    assert p.returncode == 0, (
        "the rows between `## The fourteen rows` and `## Three older lessons` "
        "in skills/ultrawrite/references/authoring-gotchas.md do not number "
        "fourteen\nstderr:\n%s" % p.stderr)
