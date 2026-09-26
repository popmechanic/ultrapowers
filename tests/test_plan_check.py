"""The plan-check exams: every test that drives
`skills/ultrapowers/scripts/plan_check.py`, in one file, each shared helper
defined once. Three sections, in order: GREEN-AT-BASE, the run-wide freeze,
and the authoring record.

=== GREEN-AT-BASE ===

GREEN-AT-BASE: the compiler rehearses every Proof `Run:` at BASE (#1098).

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
tests/test_plan_check.py`, which is THIS file: an exam never
runs an exam, least of all itself, so the driver runs that line and nothing
here does.

The shape is `tests/test_compile_plan_edges.py` and
`tests/test_compile_plan_exam_sweep.py`: the direct legs import `compile_plan`
from `skills/ultrapowers/scripts` and call the function; the `--check` legs
write a real claims-v1 plan inside a one-commit git repository under
`tmp_path`, sign its gate-verdict record with the gate's own extractor, run the
compiler as a subprocess, and read the exit code and the two output channels.

=== The run-wide freeze ===

`plan_check.py` refuses a run-wide `Check:` freeze that covers a task's own
Files (#1202).

Machine, restated, and where each clause is graded here:

  * M1 — a signed one-task plan whose `## Global Constraints` carries
    `- Check: git diff --quiet $ULTRA_BASE -- fleet/`, with task 1 naming
    `fleet/tests/test_x.mjs` as its `Create:` path and `src/prover.ts` as its
    `Modify:` path, exits 2 under a bare `plan_check.py <plan>` (no `--base`),
    prints no `PLAN OK`, and prints exactly one line carrying `freezes` — that
    line also carries the check's whole command, the pathspec `fleet/`,
    `task 1` and the path `fleet/tests/test_x.mjs`. Graded by leg (a),
    subprocess, and again directly against `freeze_violations` in leg (d).
  * M2 — the same plan with the check
    `git diff --quiet $ULTRA_BASE -- fleet/launch.mjs fleet/te` prints
    `PLAN OK`, exits 0, and carries no `freezes` line — `fleet/te` is a
    string prefix of the task's path, not a directory prefix, so it covers
    nothing. Graded by leg (b), and again directly in leg (d).
  * M3 — the same plan with the check
    `git diff --quiet $ULTRA_BASE -- docs src/prover.ts` exits 2 and prints a
    line carrying `freezes`, `src/prover.ts` and `task 1` — a pathspec equal
    to a task's path covers it. Graded by leg (c), and again directly in leg
    (d).
  * M4 — `freeze_violations(checks, tasks)` is a module-level function of
    `plan_check.py` that answers from the `checks`/`tasks` values alone, and
    the gotchas row and `SKILL.md`'s `## Global Constraints discipline`
    section each name the `plan_check.py` refusal. Graded by leg (d): the
    function's definition line and its answering M1/M2/M3 correctly when
    called directly on plain dicts (no `tmp_path`, no git, no subprocess —
    demonstrating it needs none), plus the two doc greps. `main` summing its
    answer into `violations` is what legs (a)-(c) already exercise end to
    end; that the function itself spawns nothing is a diff-reading claim (the
    Context's own words), not one this file can observe from outside.

The shape is the GREEN-AT-BASE section's: a claims-v1 plan is built
directly (no repository — this task runs `plan_check.py` with no `--base`,
so none is needed) and signed with the gate's own extractor, then run as a
subprocess so stdout and the exit code are read as the compiler actually
prints them.

=== The authoring record ===

The authoring record: one AUTHORING fact line, and a refusal when it is
malformed (#988 desired state 1).

The record sits at the top level of `<plan-stem>.gate-verdicts.json` beside
`tasks` and `tally`, and it is the one literal every task of this plan shares:

    {"authoring": {"minutes": 118, "probes": 12,
                   "routing": {"branch": "risk", "lane": "ultrapowers"},
                   "questions": [{"question": "Claim and summary",
                                  "options": ["A", "B"],
                                  "recommended": "A", "picked": "A"}]}}

Three clauses, one exam:

  * M1 — under `--check --base <sha>`, a well-formed record prints, after the
    verdict line, exactly one `AUTHORING fact:` line carrying the sitting's
    minutes, hub probes, the `tally`'s dispatches and rejections (`-` for an
    absent key), the routing branch and lane, and the question counts; the
    compile still exits 0 with `PLAN OK`.
  * M2 — a record with no `authoring` key prints `AUTHORING fact: none
    recorded` under the same flags, and a bare `--check` of either record
    prints no `AUTHORING fact:` line at all.
  * M3 — a malformed `authoring` object is refused at `--check`: exit 2, no
    `PLAN OK`, one `grammar: authoring record unreadable —` line naming the
    offending field.

Every plan below is a real claims-v1 plan written to a temp directory and
compiled by a subprocess, its gate verdicts hashed by the gate's own extractor,
so nothing here reaches into the compiler's internals. The `--base` legs put
that plan inside a one-commit git repository, because a 40-hex `--base` is
resolved in the plan's own toplevel.
"""
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
GOTCHAS = ROOT / "skills/ultrawrite/references/authoring-gotchas.md"
SKILL = ROOT / "skills/ultrawrite/SKILL.md"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import plan_check  # noqa: E402
import plan_parse  # noqa: E402

sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))
from extract_gate_input import gate_input, verdicts_path  # noqa: E402

SOURCE = COMPILER.read_text()


# ########################################################################### #
# GREEN-AT-BASE                                                               #
# ########################################################################### #


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


def make_plan(check=None, machine=ONE_CLAUSE, runs="", legs=LEG_M1,
              stale=STALE_ADVISORY):
    """The one-task claims-v1 plan. With `check`, the freeze section's plan:
    `FREEZE_HEAD`, a `## Global Constraints` whose one `- Check:` bullet is
    `check`, then `FREEZE_TASK`. Without it, the GREEN-AT-BASE plan
    parameterized on its Machine clauses, `Run:` lines, prose legs and
    Stale-if entry."""
    if check is not None:
        constraints = "\n## Global Constraints\n\n- Check: %s\n" % check
        return FREEZE_HEAD + constraints + FREEZE_TASK
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


def write_plan(dirpath, name, text, rec=None):
    """The plan plus the gate-verdict artifact claims-v1 compiles against
    (spec §4.5), hashed by the gate's own extractor so a fixture edit re-signs
    itself rather than going stale against a hand-copied digest. `rec` is the
    record's every key but `tasks` (the authoring section passes its own);
    omitted, it is a one-dispatch, zero-rejection `tally`."""
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


def fact_lines(stdout, prefix=FACT):
    """Every line beginning `prefix` — by default `GREEN-AT-BASE fact:`; the
    authoring section passes `AUTHORING fact:` — in the order printed."""
    return [line for line in stdout.splitlines() if line.startswith(prefix)]


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
# tests/test_plan_check.py`, is this file: an exam never runs
# an exam, and it cannot run itself, so the driver runs that line.


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


# ########################################################################### #
# The run-wide freeze                                                         #
# ########################################################################### #

# --------------------------------------------------------------------------- #
# The plan: one signed claims-v1 task, `## Global Constraints` varying only   #
# in its one `- Check:` bullet — the three commands M1, M2 and M3 each name.  #
# --------------------------------------------------------------------------- #

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

# The three commands the Machine clauses name, verbatim.
CMD_M1 = "git diff --quiet $ULTRA_BASE -- fleet/"
CMD_M2 = "git diff --quiet $ULTRA_BASE -- fleet/launch.mjs fleet/te"
CMD_M3 = "git diff --quiet $ULTRA_BASE -- docs src/prover.ts"


def compile_plan(tmp_path, name, text):
    """`plan_check.py <plan>` — no `--base`: the Context says this refusal
    needs no repository, and none is set up here."""
    plan = write_plan(tmp_path, name, text)
    return subprocess.run([sys.executable, str(COMPILER), str(plan)],
                          capture_output=True, text=True)


def freeze_lines(stdout):
    """Every stdout line carrying the word `freezes`."""
    return [line for line in stdout.splitlines() if "freezes" in line]


# =========================================================================== #
# (a)/[M1] — the freeze is refused, one line, naming everything M1 names      #
# =========================================================================== #

def test_a_a_directory_pathspec_covering_the_test_path_is_refused(tmp_path):
    """[M1]: exit 2, no `PLAN OK`, exactly one `freezes` line, carrying the
    check's whole command, the pathspec `fleet/`, `task 1` and the covered
    path `fleet/tests/test_x.mjs`."""
    p = compile_plan(tmp_path, "a.md", make_plan(CMD_M1))
    out = p.stdout + p.stderr
    assert p.returncode == 2, out
    assert "PLAN OK" not in p.stdout, p.stdout
    lines = freeze_lines(p.stdout)
    assert len(lines) == 1, (
        "expected exactly one line carrying 'freezes':\n%s" % p.stdout)
    line = lines[0]
    for token in (CMD_M1, "fleet/", "task 1", "fleet/tests/test_x.mjs"):
        assert token in line, "%r missing from freeze line: %r" % (token, line)


# =========================================================================== #
# (b)/[M2] — a string prefix that is not a directory prefix covers nothing    #
# =========================================================================== #

def test_b_a_string_prefix_pathspec_is_not_a_directory_prefix(tmp_path):
    """[M2]: `fleet/te` is a string prefix of `fleet/tests/test_x.mjs`, not a
    directory prefix — `PLAN OK`, exit 0, no `freezes` line at all."""
    p = compile_plan(tmp_path, "b.md", make_plan(CMD_M2))
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], p.stdout
    assert freeze_lines(p.stdout) == [], p.stdout


# =========================================================================== #
# (c)/[M3] — a pathspec equal to a task's path covers it                      #
# =========================================================================== #

def test_c_a_pathspec_equal_to_the_modify_path_is_refused(tmp_path):
    """[M3]: `src/prover.ts` named exactly among the freeze's pathspecs
    refuses the plan; at least one stdout line carries `freezes`,
    `src/prover.ts` and `task 1` together (`command_violations`' own "names"
    line may also fire here — that line says a different thing and is not
    asserted against)."""
    p = compile_plan(tmp_path, "c.md", make_plan(CMD_M3))
    out = p.stdout + p.stderr
    assert p.returncode == 2, out
    lines = freeze_lines(p.stdout)
    assert lines, "expected at least one 'freezes' line:\n%s" % p.stdout
    assert any(all(tok in line for tok in ("freezes", "src/prover.ts", "task 1"))
               for line in lines), lines


# =========================================================================== #
# (d)/[M4] — the module-level function, answering from strings alone, and    #
# the two doc greps                                                          #
# =========================================================================== #


def fake_task(id_, modifies=(), creates=(), deletes=(),
             type_="implementation"):
    return {"id": id_, "type": type_, "creates": list(creates),
            "modifies": list(modifies), "deletes": list(deletes)}


def fake_check(cmd):
    return {"cmd": cmd, "minor": False}


TASK1 = fake_task("1", modifies=["src/prover.ts"],
                  creates=["fleet/tests/test_x.mjs"])


def test_d_freeze_violations_is_defined_at_module_level():
    """[M4]: `def freeze_violations(checks, tasks)` at module level, the
    Proof's own signature, and reachable as `plan_check.freeze_violations`."""
    assert re.search(r"^def freeze_violations\(checks, tasks\)\s*:", SOURCE,
                     re.M), (
        "plan_check.py carries no `def freeze_violations(checks, tasks):` "
        "definition")
    assert callable(getattr(plan_check, "freeze_violations", None)), (
        "plan_check has no module-level freeze_violations")


def test_d_freeze_violations_answers_m1_m2_m3_from_plain_dicts_alone():
    """[M4]: called directly on plain `checks`/`tasks` dicts — no `tmp_path`,
    no git, no subprocess anywhere in this test — `freeze_violations`
    reproduces the M1, M2 and M3 verdicts on its own, which is what "reads
    only the strings the parser printed" means in practice."""
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


def sed_range(text, start_pat, end_pat):
    """`sed -n '/start_pat/,/end_pat/p'`: from the first line matching
    `start_pat` (inclusive) through the next line matching `end_pat`
    (inclusive)."""
    start_re = re.compile(start_pat)
    end_re = re.compile(end_pat)
    out = []
    in_range = False
    for line in text.splitlines():
        if not in_range and start_re.search(line):
            in_range = True
        if in_range:
            out.append(line)
            if end_re.search(line):
                break
    return "\n".join(out)


def test_d_the_gotchas_row_names_the_plan_check_refusal():
    """[M4]: the Proof's second `Run:` line, as a python equivalent of
    `sed -n '/that freezes a path must not cover/,/^## Three older lessons/p'
    ... | tr '\\n' ' ' | grep -q 'plan_check.py.*refuses'`."""
    text = GOTCHAS.read_text()
    segment = sed_range(text, r"that freezes a path must not cover",
                        r"^## Three older lessons")
    assert segment, "authoring-gotchas.md carries no such row"
    joined = " ".join(segment.split("\n"))
    assert re.search(r"plan_check\.py.*refuses", joined), (
        "gotchas row does not name the plan_check.py refusal:\n%s" % segment)


def test_d_the_skill_global_constraints_section_names_the_freeze_refusal():
    """[M4]: the Proof's third `Run:` line, as a python equivalent of
    `sed -n '/^## Global Constraints discipline/,/^## Execution handoff/p'
    ... | tr '\\n' ' ' | grep -q 'freezes.*plan_check.py'`."""
    text = SKILL.read_text()
    segment = sed_range(text, r"^## Global Constraints discipline",
                        r"^## Execution handoff")
    assert segment, "SKILL.md carries no ## Global Constraints discipline section"
    joined = " ".join(segment.split("\n"))
    assert re.search(r"freezes.*plan_check\.py", joined), (
        "Global Constraints discipline section does not name the freeze "
        "refusal:\n%s" % segment)


# ########################################################################### #
# The authoring record                                                        #
# ########################################################################### #

# --------------------------------------------------------------------------- #
# The plan. One claims-v1 task carrying the fixed grammar the compiler         #
# requires — the header, the six body slots, a numbered Machine clause, a      #
# cited leg, a provenance tag, a predicate Stale-if whose path is absent from  #
# the temp repository, so no plan below is refused for anything but its        #
# record.                                                                      #
# --------------------------------------------------------------------------- #

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

# The Context's example record, verbatim, and the `tally` it is read beside.
AUTHORING = {
    "minutes": 118,
    "probes": 12,
    "routing": {"branch": "risk", "lane": "ultrapowers"},
    "questions": [{"question": "Claim and summary", "options": ["A", "B"],
                   "recommended": "A", "picked": "A"}],
}
TALLY = {"dispatched": 4, "rejected": 1}

# M1's line for that pair, exactly as the Context writes it.
EXAMPLE_LINE = ("AUTHORING fact: 118 min to PLAN OK, 12 hub probes, "
                "4 gate dispatches, 1 rejected, routing risk->ultrapowers, "
                "1 questions, 1/1 recommended picked, 0 explain rounds")
# M2's line for a record with no `authoring` key.
NONE_LINE = "AUTHORING fact: none recorded"
# M3's refusal prefix.
UNREADABLE = "grammar: authoring record unreadable — "

FACT_PREFIX = "AUTHORING fact:"


def record(authoring=..., tally=TALLY):
    """The gate-verdict record minus its `tasks` key (which is hashed per
    plan). `authoring` omitted entirely when passed as None."""
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
    """Every line mentioning the fact prefix anywhere, so leg (d)'s "zero
    lines containing `AUTHORING fact:`" is read as written."""
    return [line for line in stdout.splitlines() if FACT_PREFIX in line]


def assert_one_fact_after_the_verdict(p, expected):
    """[M1]/[M2]: exit 0, `PLAN OK` as the first stdout line, and exactly one
    `AUTHORING fact:` line — equal to `expected` in full, and printed after
    the verdict line."""
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], out
    lines = p.stdout.splitlines()
    assert fact_lines(p.stdout, FACT_PREFIX) == [expected], out
    assert lines.index(expected) > lines.index("PLAN OK"), out


# ── (a) M1: the well-formed record prints the Context's example line ────────
# "a claims-v1 plan whose `<stem>.gate-verdicts.json` carries a well-formed
# top-level `authoring` object prints, after the verdict line, exactly one line
# of the form `AUTHORING fact: <minutes> min to PLAN OK, <probes> hub probes,
# <dispatched> gate dispatches, <rejected> rejected, routing <branch>-><lane>,
# <n> questions, <p>/<q> recommended picked, <e> explain rounds` ... and the
# compile still exits 0 with `PLAN OK`."

def test_a_the_example_record_prints_the_example_line(tmp_path):
    """(a)/[M1]: the Context's example `authoring` object beside a `tally` of
    dispatched 4 / rejected 1, compiled `--check --base <head>` inside a
    one-commit repository — exit 0, `PLAN OK` first, and exactly one
    `AUTHORING fact:` line, the Context's example line verbatim."""
    repo, head = base_repo(tmp_path)
    p = check(repo, "a.md", record(), "--base", head)
    assert_one_fact_after_the_verdict(p, EXAMPLE_LINE)


# ── (b) M1: the tally's absent key, and the question counts ─────────────────
# "`<dispatched>` and `<rejected>` read from the record's `tally` (`-` when the
# key is absent), `<n>` the length of `questions`, `<q>` the count of questions
# whose `recommended` is not null and `<p>` the count of those whose `picked`
# equals `recommended`."

REJECTED_ABSENT_LINE = ("AUTHORING fact: 118 min to PLAN OK, 12 hub probes, "
                        "4 gate dispatches, - rejected, "
                        "routing risk->ultrapowers, "
                        "1 questions, 1/1 recommended picked, "
                        "0 explain rounds")

# One question carrying no recommended option, one whose pick is the
# recommendation: two questions, one of them recommended, that one picked.
TWO_QUESTIONS = [
    {"question": "Claim and summary", "options": ["A", "B"],
     "recommended": None, "picked": "B", "explain_rounds": 2},
    {"question": "Routing", "options": ["A", "B"],
     "recommended": "A", "picked": "A"},
]
TWO_QUESTIONS_LINE = ("AUTHORING fact: 118 min to PLAN OK, 12 hub probes, "
                      "4 gate dispatches, 1 rejected, "
                      "routing risk->ultrapowers, "
                      "2 questions, 1/1 recommended picked, "
                      "2 explain rounds")


def test_b_a_tally_without_rejected_prints_a_dash(tmp_path):
    """(b)/[M1]: the same record with `tally` lacking `rejected` — the line is
    the example line with `- rejected` in place of `1 rejected`."""
    repo, head = base_repo(tmp_path)
    p = check(repo, "b1.md", record(tally={"dispatched": 4}), "--base", head)
    assert_one_fact_after_the_verdict(p, REJECTED_ABSENT_LINE)


def test_b_two_questions_count_only_the_recommended_ones(tmp_path):
    """(b)/[M1]: two questions, one with `recommended` null and one picked
    equal to its recommendation — `2 questions, 1/1 recommended picked`."""
    repo, head = base_repo(tmp_path)
    authoring = copy.deepcopy(AUTHORING)
    authoring["questions"] = TWO_QUESTIONS
    p = check(repo, "b2.md", record(authoring=authoring), "--base", head)
    assert_one_fact_after_the_verdict(p, TWO_QUESTIONS_LINE)


def test_b_a_multi_select_question_is_one_row(tmp_path):
    """#1189: `picked` may be a list for a multi-select question — one row, one
    question, counted as recommended-picked when the recommendation is among
    the picks; a pick outside `options` is still refused."""
    repo, head = base_repo(tmp_path)
    authoring = copy.deepcopy(AUTHORING)
    authoring["questions"] = [{"question": "which features", "options":
                               ["rename", "sort", "tags", "none"],
                               "recommended": "sort",
                               "picked": ["rename", "sort"]}]
    p = check(repo, "b3.md", record(authoring=authoring), "--base", head)
    assert_one_fact_after_the_verdict(
        p, EXAMPLE_LINE)  # 1 questions, 1/1 recommended picked
    authoring["questions"][0]["picked"] = ["rename", "nope"]
    p = check(repo, "b4.md", record(authoring=authoring))
    assert p.returncode == 2 and "questions[0].picked" in p.stdout


# ── (c) M2: no record, one `none recorded` line ─────────────────────────────
# "The same `--check --base <sha>` compile of a record with no `authoring` key
# exits 0 with `PLAN OK` and prints exactly one line `AUTHORING fact: none
# recorded` after the verdict."

def test_c_a_record_with_no_authoring_key_says_none_recorded(tmp_path):
    """(c)/[M2]: the same plan, the same tally, no `authoring` key — exit 0,
    `PLAN OK`, and exactly one `AUTHORING fact: none recorded` line."""
    repo, head = base_repo(tmp_path)
    p = check(repo, "c.md", record(authoring=None), "--base", head)
    assert_one_fact_after_the_verdict(p, NONE_LINE)


# ── (d) M2: a bare `--check` prints no fact line at all ─────────────────────
# "a bare `--check` of either record prints no line beginning `AUTHORING
# fact:` at all."

@pytest.mark.parametrize("label,authoring", [
    ("with the authoring key", AUTHORING),
    ("without the authoring key", None),
])
def test_d_a_bare_check_prints_no_fact_line(tmp_path, label, authoring):
    """(d)/[M2]: with no `--base` there is no tree to cost a sitting against —
    zero lines containing `AUTHORING fact:`, either way. And the bare verdict
    is the unchanged one the global constraint pins: stdout is `PLAN OK` and
    nothing else."""
    p = check(tmp_path, "d.md", record(authoring=authoring))
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert carrying_lines(p.stdout) == [], out
    assert carrying_lines(p.stderr) == [], out
    assert p.stdout.strip() == "PLAN OK", out


# ── (e) M3: a malformed record is refused, naming the field ─────────────────
# "A record whose `authoring` object is malformed is refused at `--check` —
# exit 2, no `PLAN OK` — with one violation line beginning `grammar: authoring
# record unreadable —` that names the offending field, for each of: `minutes`
# not a non-negative integer; `probes` not a non-negative integer;
# `routing.branch` outside `risk`, `width`, `inline`, `subagent`;
# `routing.lane` outside `ultrapowers`, `subagent`, `inline`; a question whose
# `options` has fewer than 2 entries; a question whose `picked` is not one of
# its `options`; a question whose `recommended` is neither null nor one of its
# `options`."


def _with(**fields):
    """The example record with top-level fields replaced."""
    a = copy.deepcopy(AUTHORING)
    a.update(fields)
    return a


def _routing(**fields):
    a = copy.deepcopy(AUTHORING)
    a["routing"].update(fields)
    return a


def _question(**fields):
    a = copy.deepcopy(AUTHORING)
    a["questions"][0].update(fields)
    return a


# Each row carries exactly one defect, so the one line the clause promises is
# the line about that row's field and nothing else.
MALFORMED = [
    ("minutes -1", _with(minutes=-1), "minutes"),
    ('minutes "12"', _with(minutes="12"), "minutes"),
    ("probes -1", _with(probes=-1), "probes"),
    ('branch "speed"', _routing(branch="speed"), "branch"),
    ('lane "fleet"', _routing(lane="fleet"), "lane"),
    ('options ["only"]', _question(options=["only"], recommended="only",
                                   picked="only"), "options"),
    ('picked "C"', _question(picked="C"), "picked"),
    ('recommended "C"', _question(recommended="C"), "recommended"),
    ("explain_rounds -1", _question(explain_rounds=-1),
     "questions[0].explain_rounds"),
]


@pytest.mark.parametrize("row,authoring,field", MALFORMED,
                         ids=[r[0] for r in MALFORMED])
def test_e_a_malformed_record_is_refused_naming_the_field(tmp_path, row,
                                                          authoring, field):
    """(e)/[M3]: each malformed row, at a bare `--check` — exit 2, no
    `PLAN OK`, and exactly one line beginning `grammar: authoring record
    unreadable —`, naming the field the row broke."""
    p = check(tmp_path, "e.md", record(authoring=authoring))
    out = p.stdout + p.stderr
    assert p.returncode == 2, (row, out)
    assert "PLAN OK" not in out, (row, out)
    named = [line for line in out.splitlines()
             if line.startswith(UNREADABLE)]
    assert len(named) == 1, (row, out)
    assert field in named[0], (row, named[0])


def test_e_the_same_record_made_well_formed_is_not_refused(tmp_path):
    """(e)/[M3]: the refusal is the malformation and nothing else about the
    record — the example record, unbroken, still prints `PLAN OK` at a bare
    `--check` and earns no `unreadable` line."""
    p = check(tmp_path, "e-ok.md", record())
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert p.stdout.strip() == "PLAN OK", out
    assert UNREADABLE not in out, out


# ── extractor-and-authoring-refusals task 2 (#1029): a refused record prints
# its violation on the fact line, never `none recorded` ──────────────────────

REFUSED_PREFIX = "AUTHORING fact: refused — "


def _no_routing():
    a = copy.deepcopy(AUTHORING)
    del a["routing"]
    return a


def _no_picked():
    a = copy.deepcopy(AUTHORING)
    del a["questions"][0]["picked"]
    return a


def _rule_of(grammar_line, name):
    """The `<key>: <rule>` text after the backticked file name on a
    `grammar: authoring record unreadable —` line."""
    head = UNREADABLE + "`" + name + "`: "
    assert grammar_line.startswith(head), grammar_line
    return grammar_line[len(head):]


ONE_DEFECT = [
    ("minutes null", _with(minutes=None), "minutes:"),
    ("routing absent", _no_routing(), "routing:"),
    ("picked absent", _no_picked(), "questions[0].picked:"),
]


@pytest.mark.parametrize("row,authoring,key", ONE_DEFECT,
                         ids=[r[0] for r in ONE_DEFECT])
def test_f_m1_a_refused_record_prints_its_violation_on_the_fact_line(
        tmp_path, row, authoring, key):
    """(a) [M1] and (d) [M3]: under `--check --base <head>`, exactly one
    `AUTHORING fact: refused — ` line, equal to the `<key>: <rule>` of the one
    `grammar:` line, beginning with the row's key; no `none recorded`; still
    exit 2, no `PLAN OK`; and a bare `--check` prints no fact line at all."""
    repo, head = base_repo(tmp_path)
    p = check(repo, "f.md", record(authoring=authoring), "--base", head)
    out = p.stdout + p.stderr
    assert p.returncode == 2, (row, out)
    assert "PLAN OK" not in out, (row, out)
    grammar = [l for l in out.splitlines() if l.startswith(UNREADABLE)]
    assert len(grammar) == 1, (row, out)
    refused = [l for l in p.stdout.splitlines() if l.startswith(REFUSED_PREFIX)]
    assert len(refused) == 1, (row, out)
    rule = refused[0][len(REFUSED_PREFIX):]
    assert rule == _rule_of(grammar[0], "f.gate-verdicts.json"), (row, out)
    assert rule.startswith(key), (row, rule)
    assert NONE_LINE not in p.stdout.splitlines(), (row, out)
    bare = check(repo, "f-bare.md", record(authoring=authoring))
    assert carrying_lines(bare.stdout + bare.stderr) == [], bare.stdout + bare.stderr


def test_f_m1_two_defects_print_two_refused_lines(tmp_path):
    """(b) [M1]: `minutes` null and `routing` absent — exactly two
    `refused` lines, one per key, and no `none recorded`."""
    repo, head = base_repo(tmp_path)
    a = _with(minutes=None)
    del a["routing"]
    p = check(repo, "f2.md", record(authoring=a), "--base", head)
    refused = [l[len(REFUSED_PREFIX):] for l in p.stdout.splitlines()
               if l.startswith(REFUSED_PREFIX)]
    assert len(refused) == 2, p.stdout + p.stderr
    assert sorted(r.split(":")[0] for r in refused) == ["minutes", "routing"], refused
    assert NONE_LINE not in p.stdout.splitlines(), p.stdout


def test_f_m4_the_runbook_names_the_refused_shape():
    """(e) [M4]: the RUNBOOK's Per run section names the refused line beside
    the cost and none-recorded lines, in the launcher's order."""
    text = (pathlib.Path(__file__).resolve().parents[1] / "fleet" / "RUNBOOK.md").read_text()
    start = text.index("## Per run")
    end = text.index("## States")
    flat = " ".join(text[start:end].splitlines())
    assert re.search(r"AUTHORING fact: refused.*key.*rule", flat)
    assert re.search(r"BASE fact:.*STALE fact:.*AUTHORING fact:.*launch line", flat)
