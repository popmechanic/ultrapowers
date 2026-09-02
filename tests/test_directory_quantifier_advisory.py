"""A Proof leg that quantifies over a directory it does not write (#536).

run-49's Task 6 wrote the leg "no `fleet/tests/test_*.mjs` contains more than
ten `driveOne(` call sites" while `test_drive_lifecycle.mjs` held 16 at BASE,
untouched by that task. The proof gate cannot catch it — its diet is the Claim
and the Proof text alone, with no tree. The compiler has a tree, so the notice
belongs here: `--check` draws one `ADVISORY grammar: Proof leg ` line for a
universal or negation quantifier over a path prefix that no path in the task's
own `Create:`, `Modify:` or `Test:` bullets covers.

It is an advisory and never a refusal — a universal the author has genuinely
checked against BASE is a good leg, and the line is the prompt to check it.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
sys.path.insert(0, str(ROOT / "tests"))
from test_compile_plan_claims import (  # noqa: E402
    LEGACY_PLAN, _run, _sign, _write,
)

PREFIX = "ADVISORY grammar: Proof leg "

HEADER = ("# Plan: Quantifier\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

# One claims-v1 task whose Files name `pkg/a.py` and `tests/test_a.py` and
# nothing else; every case below is the same task with leg (a) swapped out.
TASK = ("### Task 1: Sample\n"
        "\n"
        "**Type:** implementation\n"
        "\n"
        "**Files:**\n"
        "- Modify: `pkg/a.py`\n"
        "- Test: `tests/test_a.py`\n"
        "\n"
        "**Claim:** An operator can square a small number. (quoted from #536)\n"
        "Machine: M1. `foo(3)` returns `9`.\n"
        "\n"
        "**Authorized-by:** #536\n"
        "\n"
        "**Interfaces:**\n"
        "- Produces: `foo(n: int) -> int`\n"
        "- Consumes: nothing\n"
        "\n"
        "**Context:** `pkg/a.py` holds the arithmetic helpers and has no\n"
        "square yet.\n"
        "\n"
        "**Proof:**\n"
        "- Test: `tests/test_a.py`\n"
        "- Legs: (a) %s [M1].\n"
        "\n"
        "**Stale-if:** path-exists: `pkg/a.py`\n")


def _plan(leg):
    return HEADER + TASK % leg


def _leg_lines(tmp_path, leg, name="plan.md"):
    """The `ADVISORY grammar: Proof leg ` lines `--check` draws for a one-task
    plan whose leg (a) reads `leg`. The plan is signed, so `--check` accepts
    it: this channel is an advisory and leaves the verdict alone."""
    plan = _sign(_write(tmp_path, _plan(leg), name))
    p = _run(plan, "--check")
    assert p.returncode == 0, p.stdout + p.stderr
    return [l for l in p.stdout.splitlines() if l.startswith(PREFIX)]


# ---------------------------------------------------------------------------
# M1 — the six forms
# ---------------------------------------------------------------------------

def test_no_file_under_an_unwritten_directory_draws_one_line(tmp_path):
    assert _leg_lines(tmp_path, "no file under `fleet/` calls `foo(`") == [
        "ADVISORY grammar: Proof leg quantifies over a path prefix outside "
        "the task's Files — task 1, leg (a): `fleet/`; \"no file under "
        "`fleet/` calls `foo(` [M1].\"; a universal over `fleet/` is checked "
        "against BASE, not against this task's diff"]


def test_each_of_the_six_forms_draws_exactly_one_line(tmp_path):
    forms = [
        ("no file in `docs/` calls `foo(`", "`docs/`"),
        ("every file under `docs/` calls `foo(`", "`docs/`"),
        ("every file in `docs/` calls `foo(`", "`docs/`"),
        ("each file under `docs/` calls `foo(`", "`docs/`"),
        ("no `fleet/tests/test_*.mjs` holds more than ten call sites",
         "`fleet/tests/`"),
    ]
    for i, (leg, prefix) in enumerate(forms):
        lines = _leg_lines(tmp_path, leg, name="plan-%d.md" % i)
        assert len(lines) == 1, (leg, lines)
        assert prefix in lines[0], (leg, lines[0])
        assert "task 1, leg (a)" in lines[0], (leg, lines[0])


# ---------------------------------------------------------------------------
# M2 — a prefix the task's own Files cover is silent
# ---------------------------------------------------------------------------

def test_a_prefix_covered_by_the_tasks_own_files_draws_nothing(tmp_path):
    assert _leg_lines(tmp_path, "no file under `pkg/` calls `foo(`") == []


def test_a_prefix_covered_by_a_test_bullet_draws_nothing(tmp_path):
    assert _leg_lines(tmp_path, "no file under `tests/` calls `foo(`") == []


# ---------------------------------------------------------------------------
# M3 — no quantifier, and no claims overlay
# ---------------------------------------------------------------------------

def test_a_leg_with_no_quantifier_draws_nothing(tmp_path):
    assert _leg_lines(tmp_path, "`foo(3)` returns `9`") == []


def test_a_legacy_plan_draws_nothing(tmp_path):
    plan = _write(tmp_path, LEGACY_PLAN, "legacy.md")
    p = _run(plan, "--check")
    assert p.returncode == 0, p.stdout + p.stderr
    assert [l for l in p.stdout.splitlines() if l.startswith(PREFIX)] == []


# ---------------------------------------------------------------------------
# M4 — the frozen fixtures draw no new line
# ---------------------------------------------------------------------------
# What is frozen here is the PLAN-DERIVED half of `--check --renders` stdout:
# the verdict line and the `ADVISORY grammar:` lines, which are a function of
# the plan text alone. Every other render reads the TREE, so a literal over one
# goes red when any unrelated file is added (#563): `blast-radius` bullets list
# every tracked code file mentioning a Produces symbol, and past its 8-entry cap
# it appends a `  … +N more` line whose N is a file count; `referent` resolves
# path tokens against `git ls-files` and `git grep`. The claims fixture's Task 1
# Produces symbol sits at exactly that cap at BASE — one sibling-added mention
# of it emits the overflow line — so `_plan_derived` filters positively, by what
# the plan alone determines, rather than by the line shapes it knows about today.
# For the same reason nothing here spells a fixture Produces symbol: doing so
# would enter this file into another exam's blast-radius bullets.

SELF = "tests/test_directory_quantifier_advisory.py"

BASE_CLAIMS_CHECK_RENDERS = (
    "PLAN OK\n"
    "\n"
    "ADVISORY grammar: Context is 24 words — task 1\n"
    "ADVISORY grammar: Machine line carries no numbered clauses — task 1; "
    "write it `M1. … M2. …` so every Proof leg can cite the clause it "
    "establishes (`[M1]`)\n"
    "ADVISORY grammar: Context is 27 words — task 2\n"
    "ADVISORY grammar: Machine line carries no numbered clauses — task 2; "
    "write it `M1. … M2. …` so every Proof leg can cite the clause it "
    "establishes (`[M1]`)\n"
    "ADVISORY grammar: Context is 26 words — task 3\n"
    "ADVISORY grammar: Machine line carries no numbered clauses — task 3; "
    "write it `M1. … M2. …` so every Proof leg can cite the clause it "
    "establishes (`[M1]`)")

BASE_WIDE_CHECK_RENDERS = "PLAN OK"


def _plan_derived(stdout):
    """`stdout` with every tree-derived line dropped: an `ADVISORY ` line that
    is not `ADVISORY grammar:`, and every indented continuation under one."""
    return "\n".join(l for l in stdout.splitlines()
                     if not l.startswith(("ADVISORY ", "  "))
                     or l.startswith("ADVISORY grammar:"))


def _check_renders(fixture):
    p = subprocess.run(
        [sys.executable, str(COMPILER), str(ROOT / fixture),
         "--check", "--renders", "--exclude", SELF],
        capture_output=True, text=True, cwd=str(ROOT))
    assert p.returncode == 0, p.stdout + p.stderr
    return p.stdout


def test_claims_fixture_renders_are_unchanged():
    stdout = _check_renders("evals/fixtures/claims/plan.md")
    assert _plan_derived(stdout) == BASE_CLAIMS_CHECK_RENDERS
    assert [l for l in stdout.splitlines() if l.startswith(PREFIX)] == []


def test_wide_fixture_renders_are_unchanged():
    stdout = _check_renders("evals/fixtures/wide/plan.md")
    assert _plan_derived(stdout) == BASE_WIDE_CHECK_RENDERS
    assert [l for l in stdout.splitlines() if l.startswith(PREFIX)] == []


# Every `*.md` under `evals/fixtures/` at BASE, with the `--check` exit code
# and first stdout line it drew there. The directory is frozen (#544), so the
# set is the set: a fixture appearing or vanishing fails the coverage check
# below as loudly as a changed verdict does.
BASE_FIXTURE_CHECK = {
    "evals/fixtures/bun-greenfield/plan.md": (0, "PLAN OK"),
    "evals/fixtures/chained/plan.md": (0, "PLAN OK"),
    "evals/fixtures/claims/plan.md": (0, "PLAN OK"),
    "evals/fixtures/contend-big/plan.md": (0, "PLAN OK"),
    "evals/fixtures/contend-big/project/README.md":
        (2, "no '### Task N:' headings found."),
    "evals/fixtures/contend/plan.md": (0, "PLAN OK"),
    "evals/fixtures/contend-prod/plan.md": (0, "PLAN OK"),
    "evals/fixtures/contend-prod/project/README.md":
        (2, "no '### Task N:' headings found."),
    "evals/fixtures/contend-wide/plan.md": (0, "PLAN OK"),
    "evals/fixtures/degrade/plan.md": (0, "PLAN OK"),
    "evals/fixtures/flawed/grammar/annotated-files.md":
        (2, "Task 1: Files line has a trailing annotation."),
    "evals/fixtures/flawed/grammar/double-catch-all.md":
        (2, "Task 1: unknown Files label 'catch-all' for `pin sweep one` — "
            "use Modify"),
    "evals/fixtures/flawed/grammar/glob.md":
        (2, "Task 1: glob `src/**/*.py` — enumerate the concrete paths"),
    "evals/fixtures/flawed/grammar/unknown-label.md":
        (2, "Task 1: unknown Files label 'Delete' for `old/b.py` — use Modify"),
    "evals/fixtures/flawed/plan.md": (0, "PLAN OK"),
    "evals/fixtures/flawed-routing/plan.md": (0, "PLAN OK"),
    "evals/fixtures/mixed/plan.md": (0, "PLAN OK"),
    "evals/fixtures/webapp/plan.md": (0, "PLAN OK"),
    "evals/fixtures/webapp/project/README.md":
        (2, "no '### Task N:' headings found."),
    "evals/fixtures/wide/plan.md": (0, "PLAN OK"),
}


def test_every_fixture_plan_keeps_its_base_check_verdict():
    found = sorted(str(p.relative_to(ROOT))
                   for p in (ROOT / "evals/fixtures").rglob("*.md"))
    assert found == sorted(BASE_FIXTURE_CHECK)
    for path, (rc, first) in sorted(BASE_FIXTURE_CHECK.items()):
        p = subprocess.run(
            [sys.executable, str(COMPILER), str(ROOT / path), "--check"],
            capture_output=True, text=True, cwd=str(ROOT))
        assert (p.returncode, p.stdout.splitlines()[0]) == (rc, first), path
