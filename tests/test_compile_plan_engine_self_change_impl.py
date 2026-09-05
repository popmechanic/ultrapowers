"""A task that changes the engine or a role is told its own run cannot see it.

The engine a run executes is the `engine=` sha in the VM's assignment, cloned
to `/home/exedev/engines/<sha>` before the run starts — so a patch to
`fleet/run-engine.mjs`, `fleet/run-worker.mjs`, `fleet/run-waves.mjs` or
anything under `fleet/roles/` lands in the integration branch, never in the
running process. The `engine-self-change` species says so under `--renders`,
before a reader is dispatched (#461).

  M1 / leg (a) — under `--check --renders`, for each claims-v1 task whose
    `Create:`/`Modify:` entries name an engine path, one line per such entry in
    sorted path order, shaped through `_species_line`.
  M2 / leg (b) — silent for an engine path named only under `Test:`, for a
    `fleet/` write that is no engine path, for a legacy-grammar task, and for a
    claims-v1 task whose Machine line numbers no clause.
  M3 / leg (c) — nothing prints without `--renders`; the frozen `--check`
    channel stays byte-identical to BASE; the five-species fixture still prints
    exactly its five lines.

This is the implementer's own exam; the graded exam lives at
`tests/test_compile_plan_engine_self_change.py`.
"""
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import compile_plan  # noqa: E402
import test_compile_plan_proof_runs as proof_runs  # noqa: E402
import test_compile_plan_proof_species as proof_species  # noqa: E402

SPECIES = "engine-self-change"
PREFIX = "ADVISORY proof-species: "

# The verbatim line M1 pins, quoted from the task's own words.
DETAIL = ("%s shapes the workers, and the run that builds it runs the engine "
          "it started with — the behaviour is first observed by the next run; "
          "prove it with a sim, never a live-run claim")


def _expected(task_id, path):
    return "%s%s — task %s: %s" % (PREFIX, SPECIES, task_id, DETAIL % path)


HEADER = ("# Plan: The engine-self-change species\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

MACHINE = "M1. The probe writes `out/report.json`."
LEGS = "- Legs: (a) the report file is written [M1]."


def _task(task_id, files, machine=MACHINE, proof=None):
    """One claims-v1 task carrying all six slots; `files` is the Files block's
    bullet lines, which is what this species reads."""
    proof = proof or [LEGS]
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "%s"
            "\n"
            "**Claim:** An operator sees the species named before any reader "
            "is dispatched. (quoted from #461)\n"
            "Machine: %s\n"
            "\n"
            "**Authorized-by:** #461\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** The repo has no engine-self-change render yet, so "
            "no plan is read this way.\n"
            "\n"
            "**Proof:**\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #461\n"
            % (task_id, task_id, "".join(l + "\n" for l in files), machine,
               task_id, "".join(l + "\n" for l in proof)))


def _plan(*tasks):
    return HEADER + "\n".join(tasks)


def _one(files, machine=MACHINE, proof=None):
    return _plan(_task("1", files, machine, proof))


def _sign(plan):
    return proof_species._sign(plan)


@pytest.fixture
def repo(tmp_path):
    r = tmp_path / "repo"
    r.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=r, check=True)
    (r / "README.md").write_text("# base\n")
    subprocess.run(["git", "add", "-A"], cwd=r, check=True)
    subprocess.run(["git", "-c", "user.email=exam@example.invalid",
                    "-c", "user.name=exam", "commit", "-qm", "base"],
                   cwd=r, check=True)
    return r


def _check(plan, *extra):
    return subprocess.run(
        [sys.executable, str(COMPILER), "--check", str(plan)] + list(extra),
        capture_output=True, text=True, cwd=str(ROOT))


def _rendered(tmp_path, repo, text, name="plan.md"):
    p = tmp_path / name
    p.write_text(text)
    _sign(p)
    r = _check(p, "--renders", "--base", str(repo))
    assert (r.returncode, r.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "fixture plan %s must compile clean before its species are read; "
        "got rc=%d\n%s%s" % (name, r.returncode, r.stdout, r.stderr))
    return r.stdout


def _lines(tmp_path, repo, text, name="plan.md"):
    return [l for l in _rendered(tmp_path, repo, text, name).splitlines()
            if l.startswith(PREFIX + SPECIES + " ")]


# --------------------------------------------------------------------------- #
# (a) [M1] every engine path draws its line                                    #
# --------------------------------------------------------------------------- #
ENGINE_PATHS = ("fleet/run-engine.mjs", "fleet/run-worker.mjs",
                "fleet/run-waves.mjs", "fleet/roles/implementer.md")


@pytest.mark.parametrize("path", ENGINE_PATHS)
def test_a_modified_engine_path_draws_exactly_its_line(tmp_path, repo, path):
    lines = _lines(tmp_path, repo, _one(["- Modify: `%s`" % path]))
    assert lines == [_expected("1", path)], (
        "leg (a) [M1]: `Modify: %s` draws exactly one line, detail included."
        % path)


def test_a_created_role_file_draws_the_same_line(tmp_path, repo):
    lines = _lines(tmp_path, repo,
                   _one(["- Create: `fleet/roles/newrole.md`"]))
    assert lines == [_expected("1", "fleet/roles/newrole.md")], (
        "leg (a) [M1]: the `fleet/roles/` prefix matches a Create: entry too.")


def test_two_engine_paths_draw_two_lines_in_sorted_path_order(tmp_path, repo):
    lines = _lines(tmp_path, repo,
                   _one(["- Modify: `fleet/run-worker.mjs`",
                         "- Modify: `fleet/run-engine.mjs`"]))
    assert lines == [_expected("1", "fleet/run-engine.mjs"),
                     _expected("1", "fleet/run-worker.mjs")], (
        "leg (a) [M1]: one line per entry, sorted path order — "
        "`fleet/run-engine.mjs` first.")


# --------------------------------------------------------------------------- #
# (b) [M2] the silences                                                        #
# --------------------------------------------------------------------------- #
def test_an_engine_path_read_only_under_test_draws_nothing(tmp_path, repo):
    assert _lines(tmp_path, repo,
                  _one(["- Modify: `app/x.py`",
                        "- Test: `fleet/run-engine.mjs`"])) == [], (
        "leg (b) [M2]: the species reads writes, never `Test:` paths.")


@pytest.mark.parametrize("path", ["fleet/launch.mjs",
                                  "fleet/tests/test_run_engine.mjs"])
def test_a_non_engine_fleet_write_draws_nothing(tmp_path, repo, path):
    assert _lines(tmp_path, repo, _one(["- Modify: `%s`" % path])) == [], (
        "leg (b) [M2]: `%s` is under `fleet/` but is no engine path." % path)


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
    "- Modify: `fleet/run-engine.mjs`\n"
    "- Test: `tests/test_legacy.py`\n"
    "\n"
    "- [ ] **Step 1:** patch the engine.\n")


def test_a_legacy_grammar_task_draws_nothing(tmp_path, repo):
    p = tmp_path / "legacy.md"
    p.write_text(LEGACY_PLAN)
    r = _check(p, "--renders", "--base", str(repo))
    assert r.returncode == 0, r.stdout + r.stderr
    assert [l for l in r.stdout.splitlines()
            if l.startswith(PREFIX + SPECIES + " ")] == [], (
        "leg (b) [M2]: a legacy-grammar task has no `machine_clauses`, so the "
        "render skips it. Got:\n" + r.stdout)


def test_a_claims_task_whose_machine_numbers_no_clause_draws_nothing(
        tmp_path, repo):
    assert _lines(tmp_path, repo,
                  _one(["- Modify: `fleet/run-engine.mjs`"],
                       machine="The probe writes `out/report.json`.",
                       proof=["- The probe writes the report."])) == [], (
        "leg (b) [M2]: an unnumbered Machine line leaves `machine_clauses` "
        "empty, which is the render's own guard.")


# --------------------------------------------------------------------------- #
# (c) [M3] the frozen channels                                                 #
# --------------------------------------------------------------------------- #
def test_check_alone_prints_no_line_and_still_says_plan_ok(tmp_path, repo):
    p = tmp_path / "plan.md"
    p.write_text(_one(["- Modify: `fleet/run-engine.mjs`"]))
    _sign(p)
    bare = _check(p)
    assert bare.returncode == 0, bare.stdout + bare.stderr
    assert bare.stdout.splitlines()[0] == "PLAN OK"
    assert SPECIES not in bare.stdout, (
        "leg (c) [M3]: the line rides behind `--renders`. Got:\n" + bare.stdout)


def test_every_run_less_fixture_plan_still_checks_byte_identically_to_base(
        tmp_path_factory):
    """leg (c) [M3]: `tests/test_compile_plan_proof_runs.py`'s frozen-sha
    comparison, imported and re-run from here."""
    base_compiler = proof_species._fixture_fn(
        proof_runs.base_compiler)(tmp_path_factory)
    proof_runs.test_every_run_less_fixture_plan_checks_byte_identically_to_base(
        base_compiler)


def test_the_five_species_fixture_still_prints_exactly_its_five_lines(
        tmp_path, repo):
    """leg (c) [M3]: the five-species plan writes `app/probe_<id>.py`, so this
    species is silent on it."""
    p = tmp_path / "five.md"
    p.write_text(proof_species.FIVE_SPECIES_PLAN)
    _sign(p)
    r = _check(p, "--renders", "--base", str(repo))
    assert r.returncode == 0, r.stdout + r.stderr
    lines = [l for l in r.stdout.splitlines() if l.startswith(PREFIX)]
    assert len(lines) == 5, (
        "leg (c) [M3]: the five-species fixture still prints exactly five "
        "lines. Got:\n" + "\n".join(lines))
    assert [l for l in lines if SPECIES in l] == []
