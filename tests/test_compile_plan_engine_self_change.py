"""A task that changes the engine is told its own run cannot see it.

A new `proof-species` line, `engine-self-change`, reads a claims-v1 task's
Files block rather than its clauses: a task whose `Create:` or `Modify:`
entries name `fleet/run-engine.mjs`, `fleet/run-worker.mjs`,
`fleet/run-waves.mjs` or any path under `fleet/roles/` shapes the workers,
and the run that builds it executes the engine it was assigned — so the
behaviour lands in the integration branch, never in the running process. This
exam pins the three Machine clauses leg by leg:

  M1 / leg (a) — under `--check --renders`, for each such `Create:`/`Modify:`
    entry, in sorted path order, one line
    `ADVISORY proof-species: engine-self-change — task <id>: <path> shapes the
    workers, and the run that builds it runs the engine it started with — the
    behaviour is first observed by the next run; prove it with a sim, never a
    live-run claim`.
  M2 / leg (b) — silence for an engine path named only under `Test:`, for a
    write under `fleet/` that is no engine path (`fleet/launch.mjs`,
    `fleet/tests/test_run_engine.mjs`), for a legacy-grammar task that
    modifies `fleet/run-engine.mjs`, and for a claims-v1 task whose Machine
    line numbers no clause.
  M3 / leg (c) — without `--renders` nothing is printed, so the engine plan's
    `--check` alone still exits 0 with `PLAN OK`; every Run-less fixture
    plan's `--check` output stays byte-identical to the frozen-sha compiler
    (`tests/test_compile_plan_proof_runs.py`'s assertion, re-run from here);
    and the five-species fixture of
    `tests/test_compile_plan_proof_species.py` still prints exactly its five
    lines, none of them an `engine-self-change` line.

Every fixture plan below is a signed claims-v1 plan (spec §4.5: the compiler
refuses to compile one without its gate-verdict record) except the legacy
fixture, and `_rendered` asserts the fixture's own health — exit 0, `PLAN OK`
— before any species line is read off it, so a broken fixture never reads as
a missing species.
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
# leg (c) [M3]: the byte-identity assertion is that file's, re-run from here;
# the five-species fixture plan is that file's, read for engine lines here.
import test_compile_plan_proof_runs as proof_runs  # noqa: E402
import test_compile_plan_proof_species as proof_species  # noqa: E402

SPECIES_PREFIX = "ADVISORY proof-species: "
ENGINE_PREFIX = SPECIES_PREFIX + "engine-self-change — "

# M1's verbatim line, the detail quoted from the task's own words.
ENGINE_DETAIL = ("%s shapes the workers, and the run that builds it runs the "
                 "engine it started with — the behaviour is first observed by "
                 "the next run; prove it with a sim, never a live-run claim")

# The four engine paths leg (a) names: three files and the `fleet/roles/`
# prefix, witnessed by an existing role file.
ENGINE_PATHS = ("fleet/run-engine.mjs", "fleet/run-worker.mjs",
                "fleet/run-waves.mjs", "fleet/roles/implementer.md")

# leg (b)'s silent writes: under `fleet/`, but no engine path.
QUIET_FLEET_PATHS = ("fleet/launch.mjs", "fleet/tests/test_run_engine.mjs")


def _engine_line(task_id, path):
    return "%stask %s: %s" % (ENGINE_PREFIX, task_id, ENGINE_DETAIL % path)


HEADER = ("# Plan: The engine a run executes is the one it started with\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

MACHINE = "M1. The worker is spawned with its role text."
LEGS = ["- Test: `tests/test_engine_probe.py`",
        "- Legs: (a) the worker carries its role text [M1]."]


def _task(task_id, machine, proof, files=None):
    """One claims-v1 task carrying all six slots; `files` is the Files-block
    bullet lines, `machine` the Machine restatement and `proof` the Proof-slot
    bullet lines."""
    files = files or ["- Create: `app/probe_%s.py`" % task_id]
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "%s"
            "\n"
            "**Claim:** An operator is told when a task's behaviour cannot be "
            "observed by its own run. (quoted from #461)\n"
            "Machine: %s\n"
            "\n"
            "**Authorized-by:** #461\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** The repo has no species render of its own yet, so "
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


@pytest.fixture
def repo(tmp_path):
    """The git checkout `--base` names: the render family is driven by
    `render_advisories`, which skips every render outside one."""
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


def _engine(stdout):
    return [l for l in stdout.splitlines() if l.startswith(ENGINE_PREFIX)]


def _species(stdout):
    return [l for l in stdout.splitlines() if l.startswith(SPECIES_PREFIX)]


def _rendered(tmp_path, repo, text, name="plan.md", sign=True):
    """`--check --renders` on a fixture plan: its stdout, with the fixture's
    own health asserted first so a broken fixture never reads as a missing
    species line."""
    plan = _write(tmp_path, text, name)
    if sign:
        _sign(plan)
    p = _check(plan, "--renders", "--base", str(repo))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "fixture plan %s must compile clean before its species are read; "
        "got rc=%d\n%s%s" % (name, p.returncode, p.stdout, p.stderr))
    return p.stdout


def _lines(tmp_path, repo, text, name="plan.md", sign=True):
    return _engine(_rendered(tmp_path, repo, text, name, sign))


# --------------------------------------------------------------------------- #
# The fixture plans                                                            #
# --------------------------------------------------------------------------- #
def _one_write_plan(entry):
    """A one-task claims-v1 plan whose Files block is exactly `entry`."""
    return _plan(_task("1", MACHINE, LEGS, files=[entry]))


# Two engine writes in one task: declared worker-first, so only sorted path
# order puts `fleet/run-engine.mjs` first.
TWO_ENGINE_PLAN = _plan(_task(
    "1", MACHINE, LEGS,
    files=["- Modify: `fleet/run-worker.mjs`",
           "- Modify: `fleet/run-engine.mjs`"]))

# The engine write rides on task 2, so the line must carry that task's id.
SECOND_TASK_PLAN = _plan(
    _task("1", MACHINE, LEGS),
    _task("2", MACHINE, LEGS, files=["- Modify: `fleet/run-waves.mjs`"]))

# (b) the engine path is named only under `Test:` — a read, not a write.
TEST_ONLY_PLAN = _plan(_task(
    "1", MACHINE, LEGS,
    files=["- Modify: `app/x.py`", "- Test: `fleet/run-engine.mjs`"]))

# (b) a claims-v1 task whose Machine line numbers no clause: `machine_clauses`
# is empty, which is the render's guard — it is read exactly as legacy is.
UNNUMBERED_PLAN = _plan(_task(
    "1",
    "The worker is spawned with its role text and the engine reads the wave.",
    ["- Test: `tests/test_engine_probe.py`",
     "- The worker carries its role text."],
    files=["- Modify: `fleet/run-engine.mjs`"]))

# (b) a legacy-grammar plan — no `**Grammar:**` line, a `Depends-on` marker and
# a checkbox step — whose one task modifies the engine.
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
    "- [ ] **Step 1:** teach the engine to spawn workers and run "
    "`python3 -m pytest -q tests/test_legacy.py`.\n")


# --------------------------------------------------------------------------- #
# (a) [M1] one line per engine write, verbatim, in sorted path order           #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("path", ENGINE_PATHS)
def test_a_modified_engine_path_draws_exactly_one_verbatim_line(
        tmp_path, repo, path):
    lines = _lines(tmp_path, repo, _one_write_plan("- Modify: `%s`" % path))
    assert lines == [_engine_line("1", path)], (
        "leg (a) [M1]: a task whose one `Modify:` entry is `%s` draws exactly "
        "one line, equal to:\n%s\nGot:\n%s"
        % (path, _engine_line("1", path), "\n".join(lines) or "(nothing)"))


def test_a_created_role_file_draws_the_same_line(tmp_path, repo):
    path = "fleet/roles/newrole.md"
    lines = _lines(tmp_path, repo, _one_write_plan("- Create: `%s`" % path))
    assert lines == [_engine_line("1", path)], (
        "leg (a) [M1]: `Create:` counts as `Modify:` does, and any path "
        "beginning `fleet/roles/` is an engine path — even one that does not "
        "exist at BASE. Expected:\n%s\nGot:\n%s"
        % (_engine_line("1", path), "\n".join(lines) or "(nothing)"))


def test_two_engine_writes_draw_two_lines_in_sorted_path_order(tmp_path, repo):
    lines = _lines(tmp_path, repo, TWO_ENGINE_PLAN)
    assert lines == [_engine_line("1", "fleet/run-engine.mjs"),
                     _engine_line("1", "fleet/run-worker.mjs")], (
        "leg (a) [M1]: a task modifying `fleet/run-worker.mjs` and "
        "`fleet/run-engine.mjs` draws exactly two lines, one per entry, the "
        "`fleet/run-engine.mjs` line first — sorted path order, not the "
        "order the Files block declares them. Got:\n"
        + ("\n".join(lines) or "(nothing)"))


def test_the_line_names_the_task_that_carries_the_write(tmp_path, repo):
    lines = _lines(tmp_path, repo, SECOND_TASK_PLAN)
    assert lines == [_engine_line("2", "fleet/run-waves.mjs")], (
        "leg (a) [M1]: the render walks every claims-v1 task and the line "
        "names the task the write belongs to — here task 2, while task 1 "
        "writes `app/probe_1.py` and draws nothing. Got:\n"
        + ("\n".join(lines) or "(nothing)"))


# --------------------------------------------------------------------------- #
# (b) [M2] the silences: a read, a non-engine fleet write, legacy, unnumbered  #
# --------------------------------------------------------------------------- #
def test_an_engine_path_named_only_under_test_draws_nothing(tmp_path, repo):
    assert _lines(tmp_path, repo, TEST_ONLY_PLAN) == [], (
        "leg (b) [M2]: the species reads a task's `Create:`/`Modify:` "
        "entries; `Test: fleet/run-engine.mjs` beside `Modify: app/x.py` is "
        "a read of the engine, not a change to it")


@pytest.mark.parametrize("path", QUIET_FLEET_PATHS)
def test_a_non_engine_fleet_write_draws_nothing(tmp_path, repo, path):
    assert _lines(tmp_path, repo, _one_write_plan("- Modify: `%s`" % path)) == [], (
        "leg (b) [M2]: the engine paths are the three files and the "
        "`fleet/roles/` prefix — `%s` is under `fleet/` and is none of them"
        % path)


def test_a_legacy_grammar_plan_modifying_the_engine_draws_nothing(
        tmp_path, repo):
    assert _lines(tmp_path, repo, LEGACY_PLAN, sign=False) == [], (
        "leg (b) [M2]: the species is a claims-v1 property; a legacy task "
        "carries no numbered clauses, so a legacy plan draws nothing even "
        "when its Files block modifies `fleet/run-engine.mjs`")


def test_a_claims_task_with_no_numbered_clause_draws_nothing(tmp_path, repo):
    assert _lines(tmp_path, repo, UNNUMBERED_PLAN) == [], (
        "leg (b) [M2]: an empty `machine_clauses` is the legacy guard — a "
        "task whose Machine line numbers no clause is silent, its "
        "`Modify: fleet/run-engine.mjs` included")


# --------------------------------------------------------------------------- #
# (c) [M3] the frozen `--check` channel and the existing species pins          #
# --------------------------------------------------------------------------- #
def test_without_renders_the_engine_plan_prints_nothing_and_exits_zero(
        tmp_path):
    plan = _sign(_write(tmp_path,
                        _one_write_plan("- Modify: `fleet/run-engine.mjs`")))
    bare = _check(plan)
    assert bare.returncode == 0, bare.stdout + bare.stderr
    assert bare.stdout.splitlines()[:1] == ["PLAN OK"], (
        "leg (c) [M3]: `--check` alone exits and prints as it did at BASE — "
        "`PLAN OK` first, exit 0. Got:\n" + bare.stdout + bare.stderr)
    assert "engine-self-change" not in bare.stdout, (
        "leg (c) [M3]: the line rides behind `--renders`; `--check` alone "
        "prints no `engine-self-change` line. Got:\n" + bare.stdout)


def _fixture_fn(fixture):
    """The plain function inside a pytest fixture object, so the assertion of
    `tests/test_compile_plan_proof_runs.py` can be re-run from here."""
    fn = getattr(fixture, "__wrapped__", None)
    if fn is None and hasattr(fixture, "_get_wrapped_function"):
        fn = fixture._get_wrapped_function()
    assert fn is not None, "cannot unwrap %r" % (fixture,)
    return fn


def test_every_run_less_fixture_plan_still_checks_byte_identically_to_base(
        tmp_path_factory):
    """leg (c) [M3]: the new line rides behind `--renders`, so the frozen
    `--check` channel is untouched — the assertion is
    `tests/test_compile_plan_proof_runs.py`'s frozen-sha comparison, imported
    and called."""
    base_compiler = _fixture_fn(proof_runs.base_compiler)(tmp_path_factory)
    proof_runs.test_every_run_less_fixture_plan_checks_byte_identically_to_base(
        base_compiler)


def test_the_five_species_fixture_still_prints_exactly_its_five_lines(
        tmp_path, repo):
    """leg (c) [M3]: the five-species plan's tasks write `app/probe_<id>.py`,
    so the new species is silent on it and its five lines are untouched."""
    out = _rendered(tmp_path, repo, proof_species.FIVE_SPECIES_PLAN)
    assert _engine(out) == [], (
        "leg (c) [M3]: no task of the five-species fixture writes an engine "
        "path, so it draws no `engine-self-change` line. Got:\n"
        + "\n".join(_engine(out)))
    assert len(_species(out)) == 5, (
        "leg (c) [M3]: the five-species fixture still prints exactly its "
        "five `ADVISORY proof-species:` lines. Got:\n"
        + "\n".join(_species(out)))


def test_the_existing_species_exam_still_passes():
    """leg (c) [M3]: `tests/test_compile_plan_proof_species.py` passes — the
    line shape, the print order and the registration it pins are unchanged."""
    p = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
         "tests/test_compile_plan_proof_species.py"],
        capture_output=True, text=True, cwd=str(ROOT))
    assert p.returncode == 0, (
        "leg (c) [M3]: the existing species exam must still pass:\n"
        + p.stdout[-4000:] + p.stderr[-2000:])
