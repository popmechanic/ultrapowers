import copy
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/plan_check.py"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import plan_check  # noqa: E402
import plan_parse  # noqa: E402

sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))
from extract_gate_input import gate_input, verdicts_path  # noqa: E402

SOURCE = COMPILER.read_text()


FACT = "GREEN-AT-BASE fact: "

PROVER_LINE = (FACT + "task %s: Run: %s — exits 0 at BASE; "
               "this line cannot falsify its clause")
GUARD_LINE = (FACT + "task %s: Run: %s — exits 0 at BASE; "
              "a guard, no leg cites it")
TIMEOUT_LINE = FACT + "task %s: Run: %s — not run (timeout after %s s)"
READING_LINE = FACT + "%s s over %s lines run, %s not run (timeout)"
READING_RE = re.compile(
    r"^GREEN-AT-BASE fact: ([0-9]+\.[0-9]) s over (\d+) lines run, "
    r"(\d+) not run \(timeout\)$")

UNKNOWN_CLAUSE_LINE = ("grammar: Run: cites an unknown clause — task %s: %s "
                       "cites %s; the Machine line numbers %s")
NO_CITING_LEG = "Machine clause %s has no citing Proof leg"


HEAD = """# Green probe

**Grammar:** claims-v1

**Acceptance:** waived — exam fixture; this plan is compiled, never executed

**Claim:** An operator gets a reading of which proofs already pass at BASE. (elicited)
"""

TASK = """
### Task 1: The prover

**Type:** implementation

**Files:**
- Modify: `src/prover.ts`

**Claim:** An operator running the prover sees it pass. (derived)
Machine: {machine}

**Authorized-by:** #1098

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The prover is a standalone module with no registry to update.

**Proof:**
{runs}{legs}

**Stale-if:**
- {stale}
"""

ONE_CLAUSE = "M1. The prover exits 0."
TWO_CLAUSES = "M1. The prover exits 0. M2. The prover prints nothing."

LEG_M1 = "- (a) The suite asserts the prover exits 0. [M1]"
LEGS_M1_M2 = ("- (a) The suite asserts the prover exits 0. [M1]\n"
              "- (b) The suite asserts the prover prints nothing. [M2]")
LEGS_M1_AND_M9 = ("- (a) The suite asserts the prover exits 0. [M1]\n"
                  "- (b) The suite asserts the ninth thing. [M9]")

AT_BASE = "at-base.txt"
STALE_ADVISORY = "sha-matches: `%s`" % AT_BASE


def make_plan(check=None, machine=ONE_CLAUSE, runs="", legs=LEG_M1,
              stale=STALE_ADVISORY):
    if check is not None:
        constraints = "\n## Global Constraints\n\n- Check: %s\n" % check
        return FREEZE_HEAD + constraints + FREEZE_TASK
    return HEAD + TASK.format(machine=machine, runs=runs, legs=legs,
                              stale=stale)


def run_bullets(*commands):
    return "".join("- Run: %s\n" % c for c in commands)


def _git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args],
                       capture_output=True, text=True)
    assert p.returncode == 0, " ".join(args) + "\n" + p.stdout + p.stderr
    return p.stdout


def base_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", ".")
    _git(repo, "config", "user.email", "exam@example.invalid")
    _git(repo, "config", "user.name", "exam")
    (repo / AT_BASE).write_text("at base\n")
    _git(repo, "add", AT_BASE)
    _git(repo, "commit", "-qm", "at base")
    head = _git(repo, "rev-parse", "HEAD").strip()
    assert re.fullmatch(r"[0-9a-f]{40}", head), head
    return repo, head


def write_plan(dirpath, name, text, rec=None):
    plan = pathlib.Path(dirpath) / name
    plan.write_text(text)
    entry = gate_input(plan, "1")
    full = ({"tally": {"dispatched": 1, "rejected": 0}} if rec is None
            else dict(rec))
    full["tasks"] = {"1": {"hash": entry["hash"], "verdict": "pass",
                           "reason": "fixture"}}
    verdicts_path(plan).write_text(json.dumps(full))
    return plan


def compile_at(repo, name, text, *flags, env=None):
    plan = write_plan(repo, name, text)
    return subprocess.run([sys.executable, str(COMPILER), str(plan), *flags],
                          capture_output=True, text=True,
                          env=None if env is None else dict(os.environ, **env))


def check_at(repo, name, text, *flags, env=None):
    return compile_at(repo, name, text, *flags, env=env)


def check_at_unsigned(repo, name, text, *flags):
    plan = write_plan(repo, name, text)
    verdicts_path(plan).unlink()
    return subprocess.run([sys.executable, str(COMPILER), str(plan),
                           "--check", *flags],
                          capture_output=True, text=True)


def tasks_of(text):
    return plan_parse.parse_plan_full(text)[1]


def base_tree_for(plan):
    repo = plan.parent
    head = _git(repo, "rev-parse", "HEAD").strip()
    return plan_check.BaseTree.from_flag(head, plan), head


def green_lines(repo, name, text, **kw):
    plan = write_plan(repo, name, text)
    base_tree, _head = base_tree_for(plan)
    return plan_check.green_at_base_lines(tasks_of(text), base_tree, **kw)


def fact_lines(stdout, prefix=FACT):
    return [line for line in stdout.splitlines() if line.startswith(prefix)]


def command_facts(lines):
    return [line for line in lines if line.startswith(FACT) and "Run:" in line]


RUNS_A = run_bullets("true [M1]", "false [M1, M2]", "true")
PLAN_A = make_plan(machine=TWO_CLAUSES, runs=RUNS_A, legs=LEGS_M1_M2)


PLAN_B_UNKNOWN = make_plan(machine=TWO_CLAUSES,
                           runs=run_bullets("true [M9]"),
                           legs=LEGS_M1_M2)
PLAN_B_TAG_IS_NO_LEG = make_plan(machine=TWO_CLAUSES,
                                 runs=run_bullets("true [M2]"),
                                 legs=LEG_M1)


def witness_command(repo, head):
    return ('test -f %s && test "$ULTRA_BASE" = %s && '
            'test "$(git rev-parse HEAD)" = %s && test "$PWD" != "%s" && '
            'touch wrote-here.txt' % (AT_BASE, head, head, repo))


def worktree_paths(repo):
    out = _git(repo, "worktree", "list", "--porcelain")
    return [line.split(" ", 1)[1] for line in out.splitlines()
            if line.startswith("worktree ")]


def test_c_the_run_line_runs_at_base_in_a_worktree_that_is_then_gone(tmp_path):
    repo, head = base_repo(tmp_path)
    command = witness_command(repo, head)
    tmpdir = tmp_path / "tmproot"
    tmpdir.mkdir()
    machine_root = pathlib.Path(tempfile.gettempdir())
    before = sorted(machine_root.glob("ultra-green-*"))
    p = check_at(repo, "c.md",
                 make_plan(runs=run_bullets("%s [M1]" % command)),
                 "--base", head, env={"TMPDIR": str(tmpdir)})
    out = p.stdout + p.stderr
    expected = PROVER_LINE % ("1", command)
    assert expected in p.stdout.splitlines(), (
        "stdout carried no prover line for the witness command.\n"
        "expected: %s\nstdout:\n%s\nstderr:\n%s"
        % (expected, p.stdout, p.stderr))
    assert p.returncode == 0, out
    paths = worktree_paths(repo)
    assert len(paths) == 1, paths
    assert pathlib.Path(paths[0]).resolve() == repo.resolve(), (paths, repo)
    assert sorted(tmpdir.glob("ultra-green-*")) == [], sorted(
        tmpdir.glob("ultra-green-*"))
    if os.environ.get("PYTEST_XDIST_WORKER") is None:
        assert sorted(machine_root.glob("ultra-green-*")) == before, (
            "an ultra-green- directory survived under %s" % machine_root)
    assert not (repo / "wrote-here.txt").exists(), (
        "the command's file landed in the repository's own working tree")


RUNS_D = run_bullets("true [M1]", "true", "false")
PLAN_D = make_plan(runs=RUNS_D)
EXPECTED_D = [PROVER_LINE % ("1", "true"), GUARD_LINE % ("1", "true")]


def test_d_the_function_prints_the_prover_and_the_guard_and_nothing_else(
        tmp_path):
    repo, _head = base_repo(tmp_path)
    lines = green_lines(repo, "d1.md", PLAN_D)
    assert command_facts(lines) == EXPECTED_D, lines
    assert not [line for line in lines if "Run: false" in line], lines


def test_d_check_at_base_prints_the_same_two_lines(tmp_path):
    repo, head = base_repo(tmp_path)
    p = check_at(repo, "d2.md", PLAN_D, "--base", head)
    assert p.returncode == 0, p.stdout + p.stderr
    assert command_facts(p.stdout.splitlines()) == EXPECTED_D, p.stdout
    assert not [line for line in fact_lines(p.stdout)
                if "Run: false" in line], p.stdout


SLEEPER = "sleep 30.%03d" % (os.getpid() % 1000)
PLAN_E = make_plan(runs=run_bullets(SLEEPER))


def sleeper_pids():
    p = subprocess.run(["ps", "-eo", "pid=,args="],
                       capture_output=True, text=True)
    pids = set()
    for line in p.stdout.splitlines():
        pid, _, args = line.strip().partition(" ")
        if args.strip() == SLEEPER:
            pids.add(pid)
    return pids


def test_e_a_command_past_the_limit_is_killed_and_reported(tmp_path):
    assert shutil.which("ps"), "the exam needs a real `ps` to see the sleeper"
    repo, _head = base_repo(tmp_path)
    before = sleeper_pids()
    started = time.monotonic()
    lines = green_lines(repo, "e.md", PLAN_E, timeout_s=1)
    elapsed = time.monotonic() - started
    assert command_facts(lines) == [TIMEOUT_LINE % ("1", SLEEPER, 1)], lines
    assert elapsed < 4, elapsed
    leftover = sleeper_pids() - before
    for _ in range(20):
        if not leftover:
            break
        time.sleep(0.1)
        leftover = sleeper_pids() - before
    assert not leftover, (
        "a `sleep 30` this call started outlived it: %s" % sorted(leftover))


PLAN_F_NO_RUNS = make_plan()


def assert_reading(line, ran, timed_out):
    m = READING_RE.match(line)
    assert m, "not M6's reading line: %r" % line
    assert (m.group(2), m.group(3)) == (str(ran), str(timed_out)), line
    return m.group(1)


def test_f_the_timeout_calls_reading_counts_it_as_not_run(tmp_path):
    repo, _head = base_repo(tmp_path)
    lines = green_lines(repo, "f1.md", PLAN_E, timeout_s=1)
    assert lines, "green_at_base_lines returned nothing"
    assert_reading(lines[-1], 0, 1)


def test_f_the_three_command_calls_reading_counts_every_one(tmp_path):
    repo, _head = base_repo(tmp_path)
    lines = green_lines(repo, "f2.md", PLAN_D)
    assert lines, "green_at_base_lines returned nothing"
    assert_reading(lines[-1], 3, 0)


def test_f_a_plan_with_no_run_line_still_gets_the_reading(tmp_path):
    repo, _head = base_repo(tmp_path)
    lines = green_lines(repo, "f3.md", PLAN_F_NO_RUNS)
    assert lines == [READING_LINE % ("0.0", 0, 0)], lines


def test_g_the_verdict_still_comes_first_and_the_exit_is_still_zero(tmp_path):
    repo, head = base_repo(tmp_path)
    p = check_at(repo, "g1.md", PLAN_D, "--base", head)
    assert p.returncode == 0, p.stdout + p.stderr
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], p.stdout


def test_g_the_lines_sit_between_the_stale_facts_and_the_authoring_fact(
        tmp_path):
    repo, head = base_repo(tmp_path)
    p = check_at(repo, "g2.md", PLAN_D, "--base", head)
    assert p.returncode == 0, p.stdout + p.stderr
    lines = p.stdout.splitlines()
    green = [i for i, line in enumerate(lines) if line.startswith(FACT)]
    assert green, p.stdout
    above = [i for i, line in enumerate(lines)
             if line.startswith("BASE fact:") or line.startswith("STALE fact:")]
    assert above, (
        "the fixture printed no BASE/STALE fact line to order against:\n%s"
        % p.stdout)
    below = [i for i, line in enumerate(lines)
             if line.startswith("AUTHORING fact:")]
    assert below, p.stdout
    assert max(above) < min(green), p.stdout
    assert max(green) < min(below), p.stdout


TOUCH_LEGS = LEGS_M1_AND_M9


def touch_plan(marker, legs=LEG_M1, machine=ONE_CLAUSE):
    return make_plan(machine=machine,
                     runs=run_bullets("touch %s" % marker), legs=legs)


def test_g_check_at_base_runs_the_run_line(tmp_path):
    repo, head = base_repo(tmp_path)
    marker = tmp_path / "ran"
    p = check_at(repo, "g3.md", touch_plan(marker), "--base", head)
    assert p.returncode == 0, p.stdout + p.stderr
    assert marker.exists(), (
        "`--check --base` ran no command.\nstdout:\n%s\nstderr:\n%s"
        % (p.stdout, p.stderr))
    assert (GUARD_LINE % ("1", "touch %s" % marker)) in p.stdout.splitlines(), (
        p.stdout)


def test_g_a_bare_check_runs_nothing_and_says_nothing(tmp_path):
    repo, _head = base_repo(tmp_path)
    marker = tmp_path / "ran"
    p = check_at(repo, "g4.md", touch_plan(marker))
    assert p.returncode == 0, p.stdout + p.stderr
    assert not marker.exists(), "a bare --check ran the Run: line"
    assert fact_lines(p.stdout) == [], p.stdout
    assert FACT not in p.stdout + p.stderr, p.stdout + p.stderr


def test_g_a_refused_check_at_base_runs_nothing_and_says_nothing(tmp_path):
    repo, head = base_repo(tmp_path)
    marker = tmp_path / "ran"
    p = check_at_unsigned(repo, "g6.md", touch_plan(marker), "--base", head)
    out = p.stdout + p.stderr
    assert p.returncode == 2, out
    assert "PLAN OK" not in out, out
    assert not marker.exists(), "a refused --check --base ran the Run: line"
    assert FACT not in out, out


def test_h_the_default_timeout_is_a_module_constant_of_thirty():
    assert re.search(r"^GREEN_AT_BASE_TIMEOUT_S = 30$", SOURCE, re.M), (
        "plan_check.py carries no `GREEN_AT_BASE_TIMEOUT_S = 30` line")
    assert getattr(plan_check, "GREEN_AT_BASE_TIMEOUT_S", None) == 30, (
        getattr(plan_check, "GREEN_AT_BASE_TIMEOUT_S", None))


FREEZE_HEAD = """# Freeze probe

**Grammar:** claims-v1

**Acceptance:** waived — exam fixture; this plan is compiled, never executed

**Claim:** An operator's run-wide freeze never covers a task's own Files. (elicited)
"""

FREEZE_TASK = """
### Task 1: The frozen file

**Type:** implementation

**Files:**
- Modify: `src/prover.ts`
- Create: `fleet/tests/test_x.mjs`

**Claim:** An operator's patch lands without the run-wide freeze going red. (derived)
Machine: M1. The freeze check does not cover the task's own paths.

**Authorized-by:** #1202

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The prover is a standalone module with no registry to update.

**Proof:**
- (a) The suite asserts the prover compiles. [M1]

**Stale-if:**
- sha-matches: `at-base.txt`
"""

CMD_M1 = "git diff --quiet $ULTRA_BASE -- fleet/"
CMD_M2 = "git diff --quiet $ULTRA_BASE -- fleet/launch.mjs fleet/te"
CMD_M3 = "git diff --quiet $ULTRA_BASE -- docs src/prover.ts"


def run_plan_check(tmp_path, name, text):
    plan = write_plan(tmp_path, name, text)
    return subprocess.run([sys.executable, str(COMPILER), str(plan)],
                          capture_output=True, text=True)


def freeze_lines(stdout):
    return [line for line in stdout.splitlines() if "freezes" in line]


def test_a_a_directory_pathspec_covering_the_test_path_is_refused(tmp_path):
    p = run_plan_check(tmp_path, "a.md", make_plan(CMD_M1))
    out = p.stdout + p.stderr
    assert p.returncode == 2, out
    assert "PLAN OK" not in p.stdout, p.stdout
    lines = freeze_lines(p.stdout)
    assert len(lines) == 1, (
        "expected exactly one line carrying 'freezes':\n%s" % p.stdout)
    line = lines[0]
    for token in (CMD_M1, "fleet/", "task 1", "fleet/tests/test_x.mjs"):
        assert token in line, "%r missing from freeze line: %r" % (token, line)


def test_b_a_string_prefix_pathspec_is_not_a_directory_prefix(tmp_path):
    p = run_plan_check(tmp_path, "b.md", make_plan(CMD_M2))
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], p.stdout
    assert freeze_lines(p.stdout) == [], p.stdout


def test_c_a_pathspec_equal_to_the_modify_path_is_refused(tmp_path):
    p = run_plan_check(tmp_path, "c.md", make_plan(CMD_M3))
    out = p.stdout + p.stderr
    assert p.returncode == 2, out
    lines = freeze_lines(p.stdout)
    assert lines, "expected at least one 'freezes' line:\n%s" % p.stdout
    assert any(all(tok in line for tok in ("freezes", "src/prover.ts", "task 1"))
               for line in lines), lines


def fake_task(id_, modifies=(), creates=(), deletes=(),
             type_="implementation"):
    return {"id": id_, "type": type_, "creates": list(creates),
            "modifies": list(modifies), "deletes": list(deletes)}


def fake_check(cmd):
    return {"cmd": cmd, "minor": False}


TASK1 = fake_task("1", modifies=["src/prover.ts"],
                  creates=["fleet/tests/test_x.mjs"])


def test_d_freeze_violations_answers_m1_m2_m3_from_plain_dicts_alone():
    m1 = plan_check.freeze_violations([fake_check(CMD_M1)], [TASK1])
    assert len(m1) == 1, m1
    for token in (CMD_M1, "fleet/", "task 1", "fleet/tests/test_x.mjs"):
        assert token in m1[0], "%r missing from: %r" % (token, m1[0])

    assert plan_check.freeze_violations([fake_check(CMD_M2)], [TASK1]) == [], (
        plan_check.freeze_violations([fake_check(CMD_M2)], [TASK1]))

    m3 = plan_check.freeze_violations([fake_check(CMD_M3)], [TASK1])
    assert m3, "expected a violation for a pathspec equal to the task's path"
    assert any(all(tok in line for tok in
                   ("freezes", "src/prover.ts", "task 1")) for line in m3), m3


PLAN = """# Authoring record probe

**Grammar:** claims-v1

**Acceptance:** waived — exam fixture; this plan is compiled, never executed

**Claim:** An operator compiling this plan is told what the sitting cost. (elicited)

### Task 1: The sim

**Type:** implementation

**Files:**
- Modify: `fleet/tests/sim_probe.mjs`

**Claim:** An operator running the sim sees it pass. (derived)
Machine: M1. The sim prints `PASSED`.

**Authorized-by:** #988

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The sim is a standalone script with no registry to update.

**Proof:**
- The suite asserts the sim prints `PASSED`. [M1]

**Stale-if:**
- path-exists: `fleet/tests/sim_probe.mjs`
"""

AUTHORING = {
    "minutes": 118,
    "routing": {"branch": "risk", "lane": "ultrapowers"},
    "questions": [{"question": "Claim and summary", "options": ["A", "B"],
                   "recommended": "A", "picked": "A"}],
}
TALLY = {"dispatched": 4, "rejected": 1}

EXAMPLE_LINE = ("AUTHORING fact: 118 min to PLAN OK, "
                "4 gate dispatches, 1 rejected, routing risk->ultrapowers, "
                "1 questions, 1/1 recommended picked, 0 explain rounds")
NONE_LINE = "AUTHORING fact: none recorded"

FACT_PREFIX = "AUTHORING fact:"


def record(authoring=..., tally=TALLY):
    rec = {}
    if tally is not None:
        rec["tally"] = copy.deepcopy(tally)
    if authoring is ...:
        authoring = AUTHORING
    if authoring is not None:
        rec["authoring"] = copy.deepcopy(authoring)
    return rec


def run_compiler(plan, *flags):
    return subprocess.run([sys.executable, str(COMPILER), str(plan), *flags],
                          capture_output=True, text=True)


def check(dirpath, name, rec, *flags):
    return run_compiler(write_plan(dirpath, name, PLAN, rec), *flags)


def carrying_lines(stdout):
    return [line for line in stdout.splitlines() if FACT_PREFIX in line]


def assert_one_fact_after_the_verdict(p, expected):
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], out
    lines = p.stdout.splitlines()
    assert fact_lines(p.stdout, FACT_PREFIX) == [expected], out
    assert lines.index(expected) > lines.index("PLAN OK"), out


def test_a_the_example_record_prints_the_example_line(tmp_path):
    repo, head = base_repo(tmp_path)
    p = check(repo, "a.md", record(), "--base", head)
    assert_one_fact_after_the_verdict(p, EXAMPLE_LINE)


REJECTED_ABSENT_LINE = ("AUTHORING fact: 118 min to PLAN OK, "
                        "4 gate dispatches, - rejected, "
                        "routing risk->ultrapowers, "
                        "1 questions, 1/1 recommended picked, "
                        "0 explain rounds")

TWO_QUESTIONS = [
    {"question": "Claim and summary", "options": ["A", "B"],
     "recommended": None, "picked": "B", "explain_rounds": 2},
    {"question": "Routing", "options": ["A", "B"],
     "recommended": "A", "picked": "A"},
]
TWO_QUESTIONS_LINE = ("AUTHORING fact: 118 min to PLAN OK, "
                      "4 gate dispatches, 1 rejected, "
                      "routing risk->ultrapowers, "
                      "2 questions, 1/1 recommended picked, "
                      "2 explain rounds")


def test_b_a_tally_without_rejected_prints_a_dash(tmp_path):
    repo, head = base_repo(tmp_path)
    p = check(repo, "b1.md", record(tally={"dispatched": 4}), "--base", head)
    assert_one_fact_after_the_verdict(p, REJECTED_ABSENT_LINE)


def test_b_two_questions_count_only_the_recommended_ones(tmp_path):
    repo, head = base_repo(tmp_path)
    authoring = copy.deepcopy(AUTHORING)
    authoring["questions"] = TWO_QUESTIONS
    p = check(repo, "b2.md", record(authoring=authoring), "--base", head)
    assert_one_fact_after_the_verdict(p, TWO_QUESTIONS_LINE)


def test_b_a_multi_select_question_is_one_row(tmp_path):
    repo, head = base_repo(tmp_path)
    authoring = copy.deepcopy(AUTHORING)
    authoring["questions"] = [{"question": "which features", "options":
                               ["rename", "sort", "tags", "none"],
                               "recommended": "sort",
                               "picked": ["rename", "sort"]}]
    p = check(repo, "b3.md", record(authoring=authoring), "--base", head)
    assert_one_fact_after_the_verdict(
        p, EXAMPLE_LINE)


def test_c_a_record_with_no_authoring_key_says_none_recorded(tmp_path):
    repo, head = base_repo(tmp_path)
    p = check(repo, "c.md", record(authoring=None), "--base", head)
    assert_one_fact_after_the_verdict(p, NONE_LINE)


@pytest.mark.parametrize("label,authoring", [
    ("with the authoring key", AUTHORING),
    ("without the authoring key", None),
])
def test_d_a_bare_check_prints_no_fact_line(tmp_path, label, authoring):
    p = check(tmp_path, "d.md", record(authoring=authoring))
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert carrying_lines(p.stdout) == [], out
    assert carrying_lines(p.stderr) == [], out
    assert p.stdout.strip() == "PLAN OK", out


def _odd():
    a = copy.deepcopy(AUTHORING)
    a["minutes"] = "12"
    del a["routing"]
    a["questions"] = [{"question": "q", "options": ["only"], "picked": "C"}, "not a row"]
    return a


def test_e_a_malformed_record_reads_dashes_and_is_not_refused(tmp_path):
    repo, head = base_repo(tmp_path)
    p = check(repo, "e.md", record(authoring=_odd()), "--base", head)
    assert_one_fact_after_the_verdict(
        p, "AUTHORING fact: - min to PLAN OK, 4 gate dispatches, "
           "1 rejected, routing -->-, 1 questions, 0/0 recommended picked, "
           "0 explain rounds")


SLIPS_GOOD = ROOT / "tests/fixtures/plan_check_slips/good.md"
SIX_SLOTS_LINE = ("grammar: task 1: the body must carry Claim, Authorized-by, "
                  "Interfaces, Context, Proof and Stale-if, each once, "
                  "non-empty, in that order")


def slipped(tmp_path, pattern, repl):
    text = re.sub(pattern, repl, SLIPS_GOOD.read_text(), flags=re.M)
    assert text != SLIPS_GOOD.read_text(), pattern
    p = run_compiler(write_plan(tmp_path, "p.md", text))
    return p.returncode, p.stdout.splitlines()


def test_slips_the_clean_fixture_checks_out():
    p = run_compiler(SLIPS_GOOD)
    assert p.returncode == 0, p.stdout
    assert p.stdout.splitlines()[0] == "PLAN OK", p.stdout


def test_slips_a_missing_slot_is_refused(tmp_path):
    code, lines = slipped(tmp_path, r"^\*\*Authorized-by:\*\*.*\n", "")
    assert code == 2 and SIX_SLOTS_LINE in lines, lines


def test_slips_an_empty_or_misordered_slot_is_refused(tmp_path):
    code, lines = slipped(tmp_path, r"^(\*\*Authorized-by:\*\*).*$", r"\1")
    assert code == 2 and SIX_SLOTS_LINE in lines, lines
    code, lines = slipped(tmp_path, r"^(\*\*Interfaces:\*\*.*\n\n)(\*\*Context:\*\*.*\n)",
                          r"\2\n\1")
    assert code == 2 and SIX_SLOTS_LINE in lines, lines


def test_slips_a_fence_outside_proof_is_refused(tmp_path):
    code, lines = slipped(tmp_path, r"^(\*\*Context:\*\*.*)$", "\\1\n~~~\nx\n~~~")
    assert code == 2, lines
    assert "grammar: task 1: a code fence outside the Proof slot" in lines, lines
    code, lines = slipped(tmp_path, r"^(\*\*Tech Stack:\*\*.*)$", "\\1\n~~~\nx\n~~~")
    assert code == 2, lines
    assert "grammar: header: a code fence above the first task" in lines, lines
    code, lines = slipped(tmp_path, r"\Z", "\n## Notes\n\n~~~\nx\n~~~\n")
    assert code == 2, lines
    assert "grammar: a code fence outside every task" in lines, lines


def test_slips_a_stories_plan_is_untouched():
    p = run_compiler(ROOT / "evals/fixtures/stories/todo/.ultrapowers/plan.md")
    assert p.stdout.splitlines() == ["PLAN OK"], p.stdout


def test_shared_a_file_two_tasks_list_is_named_once():
    p = run_compiler(ROOT / "tests/fixtures/plan_check_shared/plan.md")
    shared = [l for l in p.stdout.splitlines() if l.startswith("SHARED fact:")]
    assert shared == ["SHARED fact: a.txt is in tasks 1 and 2; name what it "
                      "must keep in a Run: probe"], p.stdout


def test_shared_three_tasks_join_with_commas_and_and(tmp_path):
    text = (ROOT / "tests/fixtures/plan_check_shared/plan.md").read_text()
    plan = tmp_path / "plan.md"
    plan.write_text(text.replace("- Modify: `b.txt`", "- Modify: `a.txt`"))
    p = run_compiler(plan)
    shared = [l for l in p.stdout.splitlines() if l.startswith("SHARED fact:")]
    assert shared == ["SHARED fact: a.txt is in tasks 1, 2 and 3; name what "
                      "it must keep in a Run: probe"], p.stdout
