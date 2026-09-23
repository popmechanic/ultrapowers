"""GREEN-AT-BASE: the compiler rehearses every Proof `Run:` at BASE (#1098).

A `Run:` line that already passes at BASE proves nothing about the task —
whatever the implementer writes, that line was green before they started. So
`plan_check.py --base <sha>` cuts a detached worktree at BASE,
runs every Proof `Run:` there, and prints one `GREEN-AT-BASE fact:` line per
command that exits 0, plus one reading line saying what the rehearsal cost.
This release the lines are a fact and never a refusal: the verdict stays
`PLAN OK` and the exit stays 0.

The seven Machine clauses, restated, and where each is graded here:

  * M1 — a Proof `Run:` bullet whose value ends in a citation tag (`[M2]`,
    `[M1, M3]`) is a PROVER: `parse_task` records the command WITHOUT the tag
    in `proof_runs` and the tag's clause ids, sorted, in a parallel
    `proof_run_cites` list; an untagged `Run:` is a GUARD, recorded there as
    `[]`. Graded by leg (a), which calls `parse_task` directly and compares
    both lists by equality.
  * M2 — a tag naming a clause the Machine line does not number is refused at
    `--check` with

        grammar: Run: cites an unknown clause — task <id>: <command cut to 80 characters> cites <Mn>; the Machine line numbers <span>

    and a tag never counts as a citing leg: a clause cited only by a `Run:`
    tag still draws `Machine clause <Mn> has no citing Proof leg`. Graded by
    leg (b), both halves, as whole-line strings off a real `--check`.
  * M3 — `green_at_base_lines(tasks, base_tree, timeout_s=GREEN_AT_BASE_TIMEOUT_S)`
    cuts ONE detached worktree of the plan's repository at BASE's commit under
    a fresh temporary directory, runs every task's `Run:` commands there in
    Proof order through `bash -lc` with `ULTRA_BASE` set to the 40-hex commit
    and the worktree as working directory, and removes the worktree afterwards
    whatever the commands did. Graded by leg (c) — the command itself asserts
    where it ran, and the exam asserts what is left behind — and by leg (h)'s
    first two `Run:` lines.
  * M4 — the three outcome lines, verbatim: a prover that exits 0, a guard
    that exits 0, and nothing at all for a command that exits non-zero. Graded
    by leg (d), by equality, from the function and from the `--check --base`
    stdout alike.
  * M5 — a command still running at `timeout_s` seconds (`GREEN_AT_BASE_TIMEOUT_S
    = 30` by default) is killed with its whole process group, yields the
    `not run (timeout after <timeout_s> s)` line, and the call returns within
    3 seconds of the limit. Graded by leg (e), which passes `timeout_s=1` so
    the suite never waits 30 seconds, and by leg (h)'s first `Run:` line.
  * M6 — the last line the function returns is the reading,
    `GREEN-AT-BASE fact: <S> s over <R> lines run, <T> not run (timeout)`,
    returned even for a plan with no `Run:` line at all. Graded by leg (f),
    all three shapes.
  * M7 — `--check --base <base>` whose verdict is `PLAN OK` prints every line
    of M4–M6 after the `BASE fact:`/`STALE fact:` lines and before the
    `AUTHORING fact:` line, still prints `PLAN OK` first and still exits 0; a
    bare `--check`, a plain compile with or without `--base`, and a
    `--check --base` whose verdict is a refusal run no command and print no
    `GREEN-AT-BASE fact:` line. Graded by leg (g), whose witness is a `Run:`
    line that touches a file outside the worktree.

Leg (h) is the Proof's three `Run:` lines. Its first two — the constant at 30
and the function's signature — are graded here as source reads, byte for byte
with the greps the Proof spells. Its third is `python3 -m pytest -q
tests/test_plan_check_rehearsal.py`, which is THIS file: an exam never
runs an exam, least of all itself, so the driver runs that line and nothing
here does.

The shape is `tests/test_compile_plan_edges.py` and
`tests/test_compile_plan_exam_sweep.py`: the direct legs import `compile_plan`
from `skills/ultrapowers/scripts` and call the function; the `--check` legs
write a real claims-v1 plan inside a one-commit git repository under
`tmp_path`, sign its gate-verdict record with the gate's own extractor, run the
compiler as a subprocess, and read the exit code and the two output channels.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/plan_check.py"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import plan_check  # noqa: E402
import plan_parse  # noqa: E402

sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))
from extract_gate_input import gate_input, verdicts_path  # noqa: E402


# --------------------------------------------------------------------------- #
# The lines M4, M5 and M6 pin, as format strings. Every assertion below builds  #
# its expectation from these, so a line is compared whole and not by fragment.  #
# --------------------------------------------------------------------------- #

FACT = "GREEN-AT-BASE fact: "

PROVER_LINE = (FACT + "task %s: Run: %s — exits 0 at BASE; "
               "this line cannot falsify its clause")
GUARD_LINE = (FACT + "task %s: Run: %s — exits 0 at BASE; "
              "a guard, no leg cites it")
TIMEOUT_LINE = FACT + "task %s: Run: %s — not run (timeout after %s s)"
READING_LINE = FACT + "%s s over %s lines run, %s not run (timeout)"
# M6's `<S>`, as leg (f) words it: one or more digits, a point, one digit.
READING_RE = re.compile(
    r"^GREEN-AT-BASE fact: ([0-9]+\.[0-9]) s over (\d+) lines run, "
    r"(\d+) not run \(timeout\)$")

# M2's refusal, with the span `clause_citation_violations` already prints.
UNKNOWN_CLAUSE_LINE = ("grammar: Run: cites an unknown clause — task %s: %s "
                       "cites %s; the Machine line numbers %s")
NO_CITING_LEG = "Machine clause %s has no citing Proof leg"


# --------------------------------------------------------------------------- #
# The plan. One task, id 1, parameterized on the three things these legs vary:  #
# the Machine clauses, the Proof `Run:` lines, and the prose legs. Everything   #
# else is the fixed claims-v1 grammar the compiler requires.                    #
# --------------------------------------------------------------------------- #

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
# A prose leg citing a ninth clause the Machine line does not number: the
# refusal leg (g)'s last witness needs, drawn by the leg grammar that already
# exists at BASE.
LEGS_M1_AND_M9 = ("- (a) The suite asserts the prover exits 0. [M1]\n"
                  "- (b) The suite asserts the ninth thing. [M9]")

# The file the one-commit repository holds, and an entry the Stale-if machine
# cannot decide — `sha-matches:` with no `@` pins no id — so every
# `--check --base` fixture below prints one `STALE fact:` advisory. That
# advisory is what leg (g)'s ordering is measured against.
AT_BASE = "at-base.txt"
STALE_ADVISORY = "sha-matches: `%s`" % AT_BASE


def make_plan(machine=ONE_CLAUSE, runs="", legs=LEG_M1,
              stale=STALE_ADVISORY):
    return HEAD + TASK.format(machine=machine, runs=runs, legs=legs,
                              stale=stale)


def run_bullets(*commands):
    """The Proof `Run:` bullets for `commands`, in Proof order."""
    return "".join("- Run: %s\n" % c for c in commands)


# --------------------------------------------------------------------------- #
# The repository, the plan on disk, and the two ways the compiler is invoked.   #
# --------------------------------------------------------------------------- #

def _git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args],
                       capture_output=True, text=True)
    assert p.returncode == 0, " ".join(args) + "\n" + p.stdout + p.stderr
    return p.stdout


def base_repo(tmp_path):
    """A one-commit git repository whose commit holds `at-base.txt` and
    nothing else, returned as (repo path, HEAD sha). The plan is written
    inside it, so a 40-hex `--base` names a commit of the plan's own
    repository — which is the repository M3's worktree is cut from."""
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


def write_plan(dirpath, name, text):
    """The plan plus the gate-verdict artifact claims-v1 compiles against
    (spec §4.5), hashed by the gate's own extractor so a fixture edit re-signs
    itself rather than going stale against a hand-copied digest."""
    plan = pathlib.Path(dirpath) / name
    plan.write_text(text)
    entry = gate_input(plan, "1")
    verdicts_path(plan).write_text(json.dumps(
        {"tasks": {"1": {"hash": entry["hash"], "verdict": "pass",
                         "reason": "fixture"}},
         "tally": {"dispatched": 1, "rejected": 0}}))
    return plan


def compile_at(repo, name, text, *flags, env=None):
    plan = write_plan(repo, name, text)
    return subprocess.run([sys.executable, str(COMPILER), str(plan), *flags],
                          capture_output=True, text=True,
                          env=None if env is None else dict(os.environ, **env))


def check_at(repo, name, text, *flags, env=None):
    return compile_at(repo, name, text, *flags, env=env)


def check_at_unsigned(repo, name, text, *flags):
    """`check_at`, but with the gate-verdict record removed right after the
    plan is signed and written — a refusal for a reason that has nothing to
    do with the plan's own commands, which `gate_verdict_violations` already
    refuses with `grammar: gate verdicts missing …`. Used by leg (g)'s
    refused-plan-runs-nothing scenario."""
    plan = write_plan(repo, name, text)
    verdicts_path(plan).unlink()
    return subprocess.run([sys.executable, str(COMPILER), str(plan),
                           "--check", *flags],
                          capture_output=True, text=True)


def tasks_of(text):
    """The task dicts `main()` hands `green_at_base_lines`, built the way the
    `--check` branch builds them."""
    return plan_parse.parse_plan_full(text)[1]


def base_tree_for(plan):
    """The `BaseTree` a 40-hex `--base` names for this plan — the same reader
    the `--check` branch builds from the flag."""
    repo = plan.parent
    head = _git(repo, "rev-parse", "HEAD").strip()
    return plan_check.BaseTree.from_flag(head, plan), head


def green_lines(repo, name, text, **kw):
    """`green_at_base_lines` on a real plan, reached through the module so a
    BASE tree fails here with `module 'plan_check' has no attribute
    'green_at_base_lines'` — the absent implementation, not a bad import."""
    plan = write_plan(repo, name, text)
    base_tree, _head = base_tree_for(plan)
    return plan_check.green_at_base_lines(tasks_of(text), base_tree, **kw)


def fact_lines(stdout):
    """Every `GREEN-AT-BASE fact:` line, in the order printed."""
    return [line for line in stdout.splitlines() if line.startswith(FACT)]


def command_facts(lines):
    """The per-command lines of M4/M5 — every fact line but M6's reading, which
    names no `Run:`."""
    return [line for line in lines if line.startswith(FACT) and "Run:" in line]


# =========================================================================== #
# (a)/[M1] — the tag is parsed off the command and recorded beside it          #
# =========================================================================== #
# "(a) `parse_task` on a task whose Proof carries `- Run: true [M1]`,
# `- Run: false [M1, M2]` and `- Run: true` records `proof_runs` as exactly
# `[\"true\", \"false\", \"true\"]` — no bracket in any command — and
# `proof_run_cites` as exactly `[[\"M1\"], [\"M1\", \"M2\"], []]` [M1]"

RUNS_A = run_bullets("true [M1]", "false [M1, M2]", "true")
PLAN_A = make_plan(machine=TWO_CLAUSES, runs=RUNS_A, legs=LEGS_M1_M2)


# =========================================================================== #
# (b)/[M2] — an unknown clause is refused, and a tag cites nothing             #
# =========================================================================== #
# "(b) `--check` on a plan whose Machine line numbers M1 and M2 and whose Proof
# carries `- Run: true` tagged with the ninth clause, M9 in the bracket shape,
# exits 2 with the line `grammar: Run: cites an unknown clause — task 1: true
# cites M9; the Machine line numbers M1–M2` on stdout, and `--check` on a plan
# whose leg (a) cites `[M1]` alone while `- Run: true [M2]` is the only
# citation of M2 exits 2 carrying `Machine clause M2 has no citing Proof leg`
# — the tag satisfied nothing [M2]"

PLAN_B_UNKNOWN = make_plan(machine=TWO_CLAUSES,
                           runs=run_bullets("true [M9]"),
                           legs=LEGS_M1_M2)
PLAN_B_TAG_IS_NO_LEG = make_plan(machine=TWO_CLAUSES,
                                 runs=run_bullets("true [M2]"),
                                 legs=LEG_M1)


# =========================================================================== #
# (c)/[M3] — one detached worktree at BASE, and nothing left of it             #
# =========================================================================== #
# "(c) in a one-commit repository whose commit holds `at-base.txt`, a plan
# whose `Run:` is `test -f at-base.txt && test \"$ULTRA_BASE\" = <head> && test
# \"$(git rev-parse HEAD)\" = <head> && test \"$PWD\" != <repo> && touch
# wrote-here.txt` yields that command's prover line under `--check --base
# <head>`, and afterwards `git -C <repo> worktree list --porcelain` names
# exactly one worktree (the repository itself), no directory named
# `ultra-green-` survives under the temp root, and `<repo>/wrote-here.txt` does
# not exist — the command ran at BASE, elsewhere than the checkout, and its
# worktree was removed with what it wrote [M3]"

def witness_command(repo, head):
    """The leg's command, with `<head>` and `<repo>` substituted."""
    return ('test -f %s && test "$ULTRA_BASE" = %s && '
            'test "$(git rev-parse HEAD)" = %s && test "$PWD" != "%s" && '
            'touch wrote-here.txt' % (AT_BASE, head, head, repo))


def worktree_paths(repo):
    """Every worktree `git` knows of for `repo`, by path."""
    out = _git(repo, "worktree", "list", "--porcelain")
    return [line.split(" ", 1)[1] for line in out.splitlines()
            if line.startswith("worktree ")]


def test_c_the_run_line_runs_at_base_in_a_worktree_that_is_then_gone(tmp_path):
    """(c)/[M3]: the command's own tests say where it ran — BASE's file
    present, `ULTRA_BASE` and the worktree HEAD both the 40-hex commit, the
    working directory not the repository — and the exam says what is left of
    the worktree afterwards: nothing."""
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
    # "git -C <repo> worktree list --porcelain names exactly one worktree"
    paths = worktree_paths(repo)
    assert len(paths) == 1, paths
    assert pathlib.Path(paths[0]).resolve() == repo.resolve(), (paths, repo)
    # "no directory named ultra-green- survives under the temp root" — the
    # root the compile was handed, and the machine's own.
    assert sorted(tmpdir.glob("ultra-green-*")) == [], sorted(
        tmpdir.glob("ultra-green-*"))
    # The machine's own temp root is shared with every other pytest worker, and
    # a sibling's live worktree appears here between `before` and now — so this
    # half is read only when this process is the whole suite (#1120). The
    # handed root above is the assertion that holds either way, and it is the
    # one that catches a leak the compile is responsible for.
    if os.environ.get("PYTEST_XDIST_WORKER") is None:
        assert sorted(machine_root.glob("ultra-green-*")) == before, (
            "an ultra-green- directory survived under %s" % machine_root)
    # "<repo>/wrote-here.txt does not exist" — --force took the worktree away
    # with what the command wrote into it.
    assert not (repo / "wrote-here.txt").exists(), (
        "the command's file landed in the repository's own working tree")


# =========================================================================== #
# (d)/[M4] — prover line, guard line, and nothing for a red command            #
# =========================================================================== #
# "(d) one plan carrying `- Run: true [M1]`, `- Run: true` and `- Run: false`
# yields, from `green_at_base_lines` and from the `--check --base` stdout
# alike, exactly `GREEN-AT-BASE fact: task 1: Run: true — exits 0 at BASE; this
# line cannot falsify its clause` and `GREEN-AT-BASE fact: task 1: Run: true —
# exits 0 at BASE; a guard, no leg cites it` in that order and no line naming
# `false` [M4]"

RUNS_D = run_bullets("true [M1]", "true", "false")
PLAN_D = make_plan(runs=RUNS_D)
EXPECTED_D = [PROVER_LINE % ("1", "true"), GUARD_LINE % ("1", "true")]


def test_d_the_function_prints_the_prover_and_the_guard_and_nothing_else(
        tmp_path):
    """(d)/[M4]: the two lines, in that order, by equality — and no line
    naming the command that exited non-zero."""
    repo, _head = base_repo(tmp_path)
    lines = green_lines(repo, "d1.md", PLAN_D)
    assert command_facts(lines) == EXPECTED_D, lines
    assert not [line for line in lines if "Run: false" in line], lines


def test_d_check_at_base_prints_the_same_two_lines(tmp_path):
    """(d)/[M4]: "from the `--check --base` stdout alike" — the same two
    lines, in the same order, on the compiler's own stdout."""
    repo, head = base_repo(tmp_path)
    p = check_at(repo, "d2.md", PLAN_D, "--base", head)
    assert p.returncode == 0, p.stdout + p.stderr
    assert command_facts(p.stdout.splitlines()) == EXPECTED_D, p.stdout
    assert not [line for line in fact_lines(p.stdout)
                if "Run: false" in line], p.stdout


# =========================================================================== #
# (e)/[M5] — the timeout line, the bound, and the killed process group         #
# =========================================================================== #
# "(e) `green_at_base_lines` with `timeout_s=1` on a task whose `Run:` is
# `sleep 30` returns `GREEN-AT-BASE fact: task 1: Run: sleep 30 — not run
# (timeout after 1 s)`, the call returns in under 4 seconds by
# `time.monotonic()`, and afterwards no `sleep 30` process the call started is
# alive [M5]"

# The sleeper carries a fraction no other worker is using, so `ps` can tell
# THIS test's `sleep` from the one a sibling pytest worker is running at the
# same moment (#1120): a bare `sleep 30` is indistinguishable across workers,
# and the before/after diff then counts a sibling's sleeper as a leftover.
# `sleep` takes a fractional argument on macOS and on GNU coreutils alike, and
# any value over the 1-second limit exercises the same kill path.
SLEEPER = "sleep 30.%03d" % (os.getpid() % 1000)
PLAN_E = make_plan(runs=run_bullets(SLEEPER))


def sleeper_pids():
    """Every live process whose command line is exactly this test's sleeper."""
    p = subprocess.run(["ps", "-eo", "pid=,args="],
                       capture_output=True, text=True)
    pids = set()
    for line in p.stdout.splitlines():
        pid, _, args = line.strip().partition(" ")
        if args.strip() == SLEEPER:
            pids.add(pid)
    return pids


def test_e_a_command_past_the_limit_is_killed_and_reported(tmp_path):
    """(e)/[M5]: the exact line, the 3-second bound over a 1-second limit, and
    no `sleep 30` this call started left alive — `killpg`, not `kill`."""
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


# =========================================================================== #
# (f)/[M6] — the reading line, in all three shapes                             #
# =========================================================================== #
# "(f) the same call's last line is `GREEN-AT-BASE fact: <S> s over 0 lines
# run, 1 not run (timeout)` with `<S>` matching `[0-9]+\\.[0-9]`, the leg (d)
# call's last line is `GREEN-AT-BASE fact: <S> s over 3 lines run, 0 not run
# (timeout)`, and a task with no `Run:` line returns exactly one line,
# `GREEN-AT-BASE fact: 0.0 s over 0 lines run, 0 not run (timeout)` [M6]"

PLAN_F_NO_RUNS = make_plan()


def assert_reading(line, ran, timed_out):
    m = READING_RE.match(line)
    assert m, "not M6's reading line: %r" % line
    assert (m.group(2), m.group(3)) == (str(ran), str(timed_out)), line
    return m.group(1)


def test_f_the_timeout_calls_reading_counts_it_as_not_run(tmp_path):
    """(f)/[M6]: leg (e)'s call — 0 lines run, 1 not run, `<S>` to one
    decimal."""
    repo, _head = base_repo(tmp_path)
    lines = green_lines(repo, "f1.md", PLAN_E, timeout_s=1)
    assert lines, "green_at_base_lines returned nothing"
    assert_reading(lines[-1], 0, 1)


def test_f_the_three_command_calls_reading_counts_every_one(tmp_path):
    """(f)/[M6]: leg (d)'s call — three commands reached an exit inside the
    limit, whatever that exit was, and none was killed."""
    repo, _head = base_repo(tmp_path)
    lines = green_lines(repo, "f2.md", PLAN_D)
    assert lines, "green_at_base_lines returned nothing"
    assert_reading(lines[-1], 3, 0)


def test_f_a_plan_with_no_run_line_still_gets_the_reading(tmp_path):
    """(f)/[M6]: exactly one line, the zero reading, verbatim."""
    repo, _head = base_repo(tmp_path)
    lines = green_lines(repo, "f3.md", PLAN_F_NO_RUNS)
    assert lines == [READING_LINE % ("0.0", 0, 0)], lines


# =========================================================================== #
# (g)/[M7] — where the lines sit, and when nothing runs at all                 #
# =========================================================================== #
# "(g) under `--check --base <head>` on the leg (d) plan stdout begins `PLAN
# OK`, the exit is 0, every `GREEN-AT-BASE fact:` line sits after the last
# `BASE fact:`/`STALE fact:` line and before the `AUTHORING fact:` line, and
# with `- Run: touch <tmp>/ran` in the Proof the file `<tmp>/ran` exists after
# `--check --base <head>` but not after a bare `--check`, not after a plain
# compile with `--base <head>`, and not after `--check --base <head>` on a plan
# the grammar refuses (a leg citing a ninth clause the Machine line does not
# number), none of which prints a `GREEN-AT-BASE fact:` line [M7]"

def test_g_the_verdict_still_comes_first_and_the_exit_is_still_zero(tmp_path):
    """(g)/[M7]: a fact is not a refusal — `PLAN OK` is still the first line
    of stdout and the exit is still 0, with the rehearsal's lines below it."""
    repo, head = base_repo(tmp_path)
    p = check_at(repo, "g1.md", PLAN_D, "--base", head)
    assert p.returncode == 0, p.stdout + p.stderr
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], p.stdout


def test_g_the_lines_sit_between_the_stale_facts_and_the_authoring_fact(
        tmp_path):
    """(g)/[M7]: after the last `BASE fact:`/`STALE fact:` line and before the
    `AUTHORING fact:` line. The fixture's undecidable `sha-matches:` entry
    guarantees there is a `STALE fact:` line to sit after."""
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
    """(g)/[M7]: the witness — `--check --base <head>` really does run the
    command, so the file it touches outside the worktree is there afterwards,
    and the guard line is printed."""
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
    """(g)/[M7]: running a plan's commands is what `--base` asks for, never
    what a grammar check does."""
    repo, _head = base_repo(tmp_path)
    marker = tmp_path / "ran"
    p = check_at(repo, "g4.md", touch_plan(marker))
    assert p.returncode == 0, p.stdout + p.stderr
    assert not marker.exists(), "a bare --check ran the Run: line"
    assert fact_lines(p.stdout) == [], p.stdout
    assert FACT not in p.stdout + p.stderr, p.stdout + p.stderr


def test_g_a_refused_check_at_base_runs_nothing_and_says_nothing(tmp_path):
    """(g)/[M7]: a verdict that is a refusal rehearses nothing — the plan the
    engine will not run is not a plan worth timing."""
    repo, head = base_repo(tmp_path)
    marker = tmp_path / "ran"
    p = check_at_unsigned(repo, "g6.md", touch_plan(marker), "--base", head)
    out = p.stdout + p.stderr
    assert p.returncode == 2, out
    assert "PLAN OK" not in out, out
    assert not marker.exists(), "a refused --check --base ran the Run: line"
    assert FACT not in out, out


# =========================================================================== #
# (h)/[M3, M5] — the Proof's own `Run:` lines                                  #
# =========================================================================== #
# "(h) the first and second `Run:` lines find the constant at 30 and the
# function's signature, and the third reports the exam passing [M3, M5]"
#
# The first two are source reads, written with the grep patterns the Proof
# spells. The third, `python3 -m pytest -q
# tests/test_plan_check_rehearsal.py`, is this file: an exam never runs
# an exam, and it cannot run itself, so the driver runs that line.

SOURCE = COMPILER.read_text()


def test_h_the_default_timeout_is_a_module_constant_of_thirty():
    """(h)/[M5]: the Proof's first `Run:` line — `^GREEN_AT_BASE_TIMEOUT_S =
    30$` — so a leg can name the default without paying 30 seconds for it."""
    assert re.search(r"^GREEN_AT_BASE_TIMEOUT_S = 30$", SOURCE, re.M), (
        "plan_check.py carries no `GREEN_AT_BASE_TIMEOUT_S = 30` line")
    assert getattr(plan_check, "GREEN_AT_BASE_TIMEOUT_S", None) == 30, (
        getattr(plan_check, "GREEN_AT_BASE_TIMEOUT_S", None))


def test_h_the_function_has_the_signature_the_interface_names():
    """(h)/[M3]: the Proof's second `Run:` line — the signature the task
    PRODUCES, spelled as the plan spells it."""
    assert re.search(
        r"^def green_at_base_lines\(tasks, base_tree, "
        r"timeout_s=GREEN_AT_BASE_TIMEOUT_S\)", SOURCE, re.M), (
        "plan_check.py carries no `green_at_base_lines(tasks, base_tree, "
        "timeout_s=GREEN_AT_BASE_TIMEOUT_S)` definition")
    assert callable(getattr(plan_check, "green_at_base_lines", None)), (
        "plan_check has no module-level green_at_base_lines")
