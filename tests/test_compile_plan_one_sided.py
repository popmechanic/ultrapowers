"""A one-sided threshold and a one-legged either/or print as `ADVISORY
proof-species:` lines.

Two more species join the `proof-species` render (#616): a clause whose numeric
bound is probed on one side only, and a clause naming two backticked
alternatives whose legs name only one of them. Both are named before a reader is
dispatched, both ride behind `--renders`, and neither refuses. This exam pins the
task's four Machine clauses leg by leg:

  M1 / legs (a), (c) — under `--check --renders`, a Machine clause stating a
    numeric bound — a number preceded by a lower-bounded shape (`over`, `more
    than`, `older than`, `at least`, `>=`, `>`) or an upper-bounded shape
    (`under`, `less than`, `younger than`, `at most`, `no more than`, `within`,
    `<=`, `<`, `≤`) — whose citing legs together carry at least one number other
    than the bound itself but none on the far side of it (below a lower bound,
    above an upper bound) prints one line
    `ADVISORY proof-species: threshold-one-sided — task <id>: clause M<k> bounds
    at <bound>; its legs probe one side only`, the bound's unit riding into
    `<bound>` verbatim.
  M2 / leg (b) — a Machine clause naming two backticked spans joined by ` or `
    whose citing legs together name only one of the two prints one line
    `ADVISORY proof-species: disjunct-without-leg — task <id>: clause M<k> names
    `<a>` or `<b>`; the legs name only `<present>``.
  M3 / legs (a), (c) — both are silent on their repaired twins: a bound whose
    legs carry a number on each side, an either/or whose legs carry both spans.
    `threshold-one-sided` is also silent when the citing legs carry no number
    other than the bound itself — a leg restating `90 s` probes nothing, and
    that shape belongs to `default-unpinned` or `duration-without-clock`.
  M4 / leg (d) — without `--renders` nothing is printed, so every Run-less
    fixture plan's `--check` output stays byte-identical to the frozen-sha
    compiler (`tests/test_compile_plan_proof_runs.py`'s frozen-sha comparison,
    imported and re-run from here), and the five-species fixture of
    `tests/test_compile_plan_proof_species.py` still prints exactly its five
    lines — that whole exam still passes.

Every fixture plan below is a signed claims-v1 plan (spec §4.5: the compiler
refuses to compile one without its gate-verdict record), and `_rendered` asserts
the fixture's own health — exit 0, `PLAN OK` — before reading the species lines
off it, so a broken fixture never reads as a missing species.
"""
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
# leg (d) [M4]: the byte-identity assertion is that file's, re-run from here;
# the five-species fixture is that file's, re-read from here.
import test_compile_plan_proof_runs as proof_runs  # noqa: E402
import test_compile_plan_proof_species as proof_species  # noqa: E402

HEADER = ("# Plan: A one-sided threshold and a one-legged either/or\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

SPECIES_PREFIX = "ADVISORY proof-species: "
THRESHOLD = "threshold-one-sided"
DISJUNCT = "disjunct-without-leg"

# M1's and M2's line shape, quoted from the task's own words. `<bound>` carries
# the unit verbatim (`6 h`, `200 bytes`); a `<a>`/`<b>`/`<present>` span rides
# backticked.
ONE_SIDED_TAIL = "; its legs probe one side only"
THRESHOLD_6H = (SPECIES_PREFIX + THRESHOLD
                + " — task 1: clause M1 bounds at 6 h" + ONE_SIDED_TAIL)
THRESHOLD_200_BYTES = (SPECIES_PREFIX + THRESHOLD
                       + " — task 1: clause M1 bounds at 200 bytes"
                       + ONE_SIDED_TAIL)
DISJUNCT_LINE = (SPECIES_PREFIX + DISJUNCT + " — task 1: clause M1 names "
                 "`github` or `gh-`; the legs name only `github`")

SPECIES_LINE_RE = re.compile(
    r"^ADVISORY proof-species: (?P<species>[a-z][a-z0-9-]*) — "
    r"task (?P<task>[^,:]+)(?:, leg (?P<leg>[^:]+))?: (?P<detail>.+)$")


# --------------------------------------------------------------------------- #
# Plan scaffolding — the `tests/test_compile_plan_proof_species.py` idiom       #
# --------------------------------------------------------------------------- #
def _task(task_id, machine, proof, files=None):
    """One claims-v1 task carrying all six slots; `machine` is the Machine
    restatement and `proof` the Proof-slot bullet lines."""
    files = files or ["- Create: `app/probe_%s.py`" % task_id]
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "%s"
            "\n"
            "**Claim:** An operator sees a one-sided bound named before any "
            "reader is dispatched. (quoted from #616)\n"
            "Machine: %s\n"
            "\n"
            "**Authorized-by:** #616\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** The repo has no one-sided render of its own yet, so "
            "no plan is read this way.\n"
            "\n"
            "**Proof:**\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #616\n"
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
    compile_plan.verdicts_path(plan).write_text(json.dumps(record, indent=2) + "\n")
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


def _species(stdout):
    return [l for l in stdout.splitlines() if l.startswith(SPECIES_PREFIX)]


def _rendered(tmp_path, repo, text, name="plan.md"):
    """`--check --renders` on a signed fixture plan: its stdout, with the
    fixture's own health asserted first so a broken fixture never reads as a
    missing species line."""
    plan = _sign(_write(tmp_path, text, name))
    p = _check(plan, "--renders", "--base", str(repo))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "fixture plan %s must compile clean before its species are read; "
        "got rc=%d\n%s%s" % (name, p.returncode, p.stdout, p.stderr))
    return p.stdout


def _lines(tmp_path, repo, text, name="plan.md"):
    return _species(_rendered(tmp_path, repo, text, name))


def _ours(lines):
    """Only this task's two species — a sibling species firing on a fixture is
    not this exam's business."""
    return [l for l in lines
            if l.startswith(SPECIES_PREFIX + THRESHOLD)
            or l.startswith(SPECIES_PREFIX + DISJUNCT)]


def _parsed(lines):
    """(species, task id, leg label) per line, with the line shape enforced."""
    out = []
    for line in lines:
        m = SPECIES_LINE_RE.match(line)
        assert m, ("[M1] [M2]: every line is shaped `ADVISORY proof-species: "
                   "<species> — task <id>: <detail>` — got:\n" + line)
        out.append((m.group("species"), m.group("task"), m.group("leg")))
    return out


# --------------------------------------------------------------------------- #
# The fixture plans                                                            #
# --------------------------------------------------------------------------- #
TEST_1 = "- Test: `tests/test_probe_one.py`"
TEST_2 = "- Test: `tests/test_probe_two.py`"

# leg (a): a lower-bounded clause whose only citing leg probes ABOVE the bound.
VM_MACHINE = "M1. A VM older than 6 h is stale."
VM_ONE_SIDED = [TEST_1, "- Legs: (a) a VM at 7 h is read as stale [M1]."]
# leg (c): its repaired twin — a leg on each side of 6 h.
VM_BRACKETED = [TEST_2, "- Legs: (a) a VM at 5 h is read as fresh [M1]; "
                        "(b) a VM at 7 h is read as stale [M1]."]
# leg (c): the same bound with no number at all in its legs.
VM_NUMBERLESS = [TEST_1, "- Legs: (a) a stale VM is reaped [M1]."]

# leg (a): an upper-bounded clause whose two citing legs both probe BELOW it.
BYTES_MACHINE = "M1. The comment is at most 200 bytes."
BYTES_ONE_SIDED = [TEST_1, "- Legs: (a) a 150 bytes comment is accepted [M1]; "
                           "(b) a 199 bytes comment is accepted [M1]."]
# leg (c): its repaired twin — 199 below the bound, 201 above it.
BYTES_BRACKETED = [TEST_2, "- Legs: (a) a 199 bytes comment is accepted [M1]; "
                           "(b) a 201 bytes comment is refused [M1]."]

# leg (a) [M3]: the bound restated and no other number — `default-unpinned`'s
# shape or `duration-without-clock`'s, never this one's.
RESTATED_MACHINE = "M1. The probe waits ≤ 90 s."
RESTATED_LEGS = [TEST_1, "- Legs: (a) elapsed under 90 s [M1]."]

# leg (b): two backticked spans joined by ` or `, the legs naming only the first.
DISJUNCT_MACHINE = "M1. The type is `github` or the name starts `gh-`."
DISJUNCT_ONE_LEG = [TEST_1, "- Legs: (a) a `github` type is accepted [M1]."]
# leg (c): its repaired twin — a leg for each span.
DISJUNCT_BOTH_LEGS = [TEST_2, "- Legs: (a) a `github` type is accepted [M1]; "
                              "(b) a name starting `gh-` is accepted [M1]."]

# leg (a): the shape sweep. Each clause reads `the count is <shape> 6 h`; the
# lower-bounded shapes are probed at 7 h (above), the upper-bounded ones at 5 h
# (below), so every one of them is one-sided.
LOWER_SHAPES = ("over", "more than", "older than", "at least", ">=", ">")
UPPER_SHAPES = ("under", "less than", "younger than", "at most", "no more than",
                "within", "<=", "<", "≤")


def _shape_plan(shape, probe):
    return _plan(_task("1", "M1. The count is %s 6 h." % shape,
                       [TEST_1, "- Legs: (a) a count at %s is flagged [M1]."
                        % probe]))


def _one_task(machine, proof):
    return _plan(_task("1", machine, proof))


def _twin_plan(machine, hit_proof, repaired_proof):
    """The species in task 1, its repaired twin in task 2."""
    return _plan(_task("1", machine, hit_proof),
                 _task("2", machine, repaired_proof))


ONE_SIDED_PLAN = _one_task(VM_MACHINE, VM_ONE_SIDED)
BYTES_PLAN = _one_task(BYTES_MACHINE, BYTES_ONE_SIDED)
RESTATED_PLAN = _one_task(RESTATED_MACHINE, RESTATED_LEGS)
DISJUNCT_PLAN = _one_task(DISJUNCT_MACHINE, DISJUNCT_ONE_LEG)
VM_BRACKETED_PLAN = _one_task(VM_MACHINE, VM_BRACKETED)
BYTES_BRACKETED_PLAN = _one_task(BYTES_MACHINE, BYTES_BRACKETED)
DISJUNCT_REPAIRED_PLAN = _one_task(DISJUNCT_MACHINE, DISJUNCT_BOTH_LEGS)
VM_NUMBERLESS_PLAN = _one_task(VM_MACHINE, VM_NUMBERLESS)

TWIN_PLANS = {
    THRESHOLD: _twin_plan(VM_MACHINE, VM_ONE_SIDED, VM_BRACKETED),
    DISJUNCT: _twin_plan(DISJUNCT_MACHINE, DISJUNCT_ONE_LEG,
                         DISJUNCT_BOTH_LEGS),
}

# leg (d): one task carrying both species — M1 a one-sided bound, M2 a
# one-legged either/or.
BOTH_MACHINE = ("M1. A VM older than 6 h is stale. "
                "M2. The type is `github` or the name starts `gh-`.")
BOTH_PLAN = _one_task(
    BOTH_MACHINE,
    [TEST_1, "- Legs: (a) a VM at 7 h is read as stale [M1]; "
             "(b) a `github` type is accepted [M2]."])
BOTH_LINES = sorted([
    THRESHOLD_6H,
    SPECIES_PREFIX + DISJUNCT + " — task 1: clause M2 names `github` or "
    "`gh-`; the legs name only `github`"])


# --------------------------------------------------------------------------- #
# (a) [M1] [M3] the threshold with legs on one side only                       #
# --------------------------------------------------------------------------- #
def test_a_lower_bounded_clause_probed_only_above_prints_the_whole_line(
        tmp_path, repo):
    lines = _lines(tmp_path, repo, ONE_SIDED_PLAN)
    assert lines == [THRESHOLD_6H], (
        "leg (a) [M1]: `%s` cited by one leg probing `7 h` — a number other "
        "than the bound, none below it — prints exactly this one line:\n%s\n"
        "Got:\n%s" % (VM_MACHINE, THRESHOLD_6H, "\n".join(lines) or "(none)"))


def test_an_upper_bounded_clause_probed_only_below_prints_the_whole_line(
        tmp_path, repo):
    lines = _lines(tmp_path, repo, BYTES_PLAN)
    assert lines == [THRESHOLD_200_BYTES], (
        "leg (a) [M1]: `%s` cited by legs probing `150 bytes` and `199 bytes` "
        "— neither above 200 — prints one line ending `bounds at 200 bytes%s`, "
        "the unit riding into `<bound>` verbatim. Got:\n%s"
        % (BYTES_MACHINE, ONE_SIDED_TAIL, "\n".join(lines) or "(none)"))


@pytest.mark.parametrize("shape", LOWER_SHAPES)
def test_each_lower_bounded_shape_is_read_as_a_bound(tmp_path, repo, shape):
    """leg (a) [M1]: `over`, `more than`, `older than`, `at least`, `>=`, `>` —
    the far side is BELOW the bound, and a leg at `7 h` never reaches it."""
    lines = _lines(tmp_path, repo, _shape_plan(shape, "7 h"))
    assert lines == [THRESHOLD_6H], (
        "leg (a) [M1]: `The count is %s 6 h.` cited by one leg probing `7 h` "
        "prints one line ending `bounds at 6 h%s`; `%s` is a lower-bounded "
        "shape, so `7 h` is the near side and nothing probes below. Got:\n%s"
        % (shape, ONE_SIDED_TAIL, shape, "\n".join(lines) or "(none)"))


@pytest.mark.parametrize("shape", UPPER_SHAPES)
def test_each_upper_bounded_shape_is_read_as_a_bound(tmp_path, repo, shape):
    """leg (a) [M1]: `under`, `less than`, `younger than`, `at most`, `no more
    than`, `within`, `<=`, `<`, `≤` — the far side is ABOVE the bound, and a leg
    at `5 h` never reaches it. `no more than` is an upper-bounded shape whole,
    not the lower-bounded `more than` inside it."""
    lines = _lines(tmp_path, repo, _shape_plan(shape, "5 h"))
    assert lines == [THRESHOLD_6H], (
        "leg (a) [M1]: `The count is %s 6 h.` cited by one leg probing `5 h` "
        "prints one line ending `bounds at 6 h%s`; `%s` is an upper-bounded "
        "shape, so `5 h` is the near side and nothing probes above. Got:\n%s"
        % (shape, ONE_SIDED_TAIL, shape, "\n".join(lines) or "(none)"))


def test_a_leg_that_only_restates_the_bound_probes_nothing(tmp_path, repo):
    lines = _lines(tmp_path, repo, RESTATED_PLAN)
    assert _ours(lines) == [], (
        "leg (a) [M3]: `%s` cited by a leg reading `elapsed under 90 s` "
        "carries no number other than the bound itself, so it probes nothing "
        "and draws no `%s` line — that shape is `default-unpinned`'s or "
        "`duration-without-clock`'s. Got:\n%s"
        % (RESTATED_MACHINE, THRESHOLD, "\n".join(lines) or "(none)"))


# --------------------------------------------------------------------------- #
# (b) [M2] the either/or with a leg for only one of its two spans              #
# --------------------------------------------------------------------------- #
def test_an_either_or_with_one_named_span_prints_the_whole_line(tmp_path, repo):
    lines = _lines(tmp_path, repo, DISJUNCT_PLAN)
    assert lines == [DISJUNCT_LINE], (
        "leg (b) [M2]: `%s` whose legs name only `github` prints exactly this "
        "one line:\n%s\nGot:\n%s"
        % (DISJUNCT_MACHINE, DISJUNCT_LINE, "\n".join(lines) or "(none)"))


# --------------------------------------------------------------------------- #
# (c) [M3] both species are silent on their repaired twins                     #
# --------------------------------------------------------------------------- #
def test_a_bound_with_a_leg_on_each_side_draws_nothing(tmp_path, repo):
    lines = _lines(tmp_path, repo, VM_BRACKETED_PLAN)
    assert _ours(lines) == [], (
        "leg (c) [M3]: `%s` cited by legs probing `5 h` and `7 h` is bracketed "
        "— a number on each side of the bound — so neither species fires. "
        "Got:\n%s" % (VM_MACHINE, "\n".join(lines) or "(none)"))


def test_an_upper_bound_with_a_leg_above_it_draws_nothing(tmp_path, repo):
    lines = _lines(tmp_path, repo, BYTES_BRACKETED_PLAN)
    assert _ours(lines) == [], (
        "leg (c) [M3]: `%s` cited by legs probing `199 bytes` and `201 bytes` "
        "carries a number strictly above the bound, so nothing fires. Got:\n%s"
        % (BYTES_MACHINE, "\n".join(lines) or "(none)"))


def test_an_either_or_naming_both_spans_draws_nothing(tmp_path, repo):
    lines = _lines(tmp_path, repo, DISJUNCT_REPAIRED_PLAN)
    assert _ours(lines) == [], (
        "leg (c) [M3]: `%s` whose legs name `github` AND `gh-` draws no "
        "`%s` line. Got:\n%s"
        % (DISJUNCT_MACHINE, DISJUNCT, "\n".join(lines) or "(none)"))


def test_a_bound_whose_legs_carry_no_number_draws_nothing(tmp_path, repo):
    lines = _lines(tmp_path, repo, VM_NUMBERLESS_PLAN)
    assert _ours(lines) == [], (
        "leg (c) [M3]: `%s` cited by a leg carrying no number at all probes "
        "neither side, so `%s` is silent — the species needs at least one "
        "number other than the bound. Got:\n%s"
        % (VM_MACHINE, THRESHOLD, "\n".join(lines) or "(none)"))


@pytest.mark.parametrize("species", sorted(TWIN_PLANS))
def test_each_species_is_silent_on_its_repaired_twin(tmp_path, repo, species):
    """legs (a), (b), (c) [M1] [M2] [M3]: one plan per species — the hit in
    task 1, the repair in task 2 — yields exactly one line, naming task 1."""
    lines = _ours(_lines(tmp_path, repo, TWIN_PLANS[species]))
    assert _parsed(lines) == [(species, "1", None)], (
        "%s: exactly one line, naming task 1; task 2 holds the repaired twin "
        "and draws none. Got:\n%s" % (species, "\n".join(lines) or "(none)"))


# --------------------------------------------------------------------------- #
# (d) [M4] the frozen `--check` channel and the existing species exam          #
# --------------------------------------------------------------------------- #
def test_one_task_can_carry_both_species(tmp_path, repo):
    """legs (a), (b) [M1] [M2]: the two species read their own clause — M1 the
    bound, M2 the either/or — and each names the clause it came from."""
    lines = _ours(_lines(tmp_path, repo, BOTH_PLAN))
    assert sorted(lines) == BOTH_LINES, (
        "a task whose M1 is one-sided and whose M2 is a one-legged either/or "
        "prints both lines, each naming its own clause:\n%s\nGot:\n%s"
        % ("\n".join(BOTH_LINES), "\n".join(lines) or "(none)"))


def test_without_renders_neither_line_is_printed(tmp_path, repo):
    """leg (d) [M4]: the species ride behind `--renders`; `--check` alone is
    the frozen channel and prints neither."""
    plan = _sign(_write(tmp_path, BOTH_PLAN))
    bare = _check(plan)
    assert bare.returncode == 0, bare.stdout + bare.stderr
    assert bare.stdout.splitlines()[:1] == ["PLAN OK"], bare.stdout
    assert THRESHOLD not in bare.stdout and DISJUNCT not in bare.stdout, (
        "leg (d) [M4]: `--check` without `--renders` prints no "
        "`threshold-one-sided` and no `disjunct-without-leg` line. Got:\n"
        + bare.stdout)


def test_the_species_change_no_verdict_and_no_exit_code(tmp_path, repo):
    """[M3]: an advisory render refuses nothing — both species present, still
    `PLAN OK` and exit 0."""
    plan = _sign(_write(tmp_path, BOTH_PLAN))
    p = _check(plan, "--renders", "--base", str(repo))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        p.stdout + p.stderr)


def _fixture_fn(fixture):
    """The plain function inside a pytest fixture object, so the byte-identity
    assertion of `tests/test_compile_plan_proof_runs.py` can be re-run here."""
    fn = getattr(fixture, "__wrapped__", None)
    if fn is None and hasattr(fixture, "_get_wrapped_function"):
        fn = fixture._get_wrapped_function()
    assert fn is not None, "cannot unwrap %r" % (fixture,)
    return fn


def test_every_run_less_fixture_plan_still_checks_byte_identically_to_base(
        tmp_path_factory):
    """leg (d) [M4]: the two new species ride behind `--renders`, so the frozen
    `--check` channel is untouched — the assertion is
    `tests/test_compile_plan_proof_runs.py`'s frozen-sha comparison, imported
    and called."""
    base_compiler = _fixture_fn(proof_runs.base_compiler)(tmp_path_factory)
    proof_runs.test_every_run_less_fixture_plan_checks_byte_identically_to_base(
        base_compiler)


def test_the_five_species_fixture_still_prints_exactly_its_five_lines(
        tmp_path, repo):
    """leg (d) [M4]: the five-species plan of
    `tests/test_compile_plan_proof_species.py`, re-rendered here — its M4 clause
    `The probe waits ≤ 90 s.` is cited by a leg reading `the probe iterates 3
    times`, and its own line is `duration-without-clock`'s, so neither new
    species may add a sixth."""
    lines = _lines(tmp_path, repo, proof_species.FIVE_SPECIES_PLAN)
    assert [s for s, _, _ in _parsed(lines)] == list(
        proof_species.SPECIES_ORDER), (
        "leg (d) [M4]: exactly the same five lines, in the same order:\n%s\n"
        "Got:\n%s" % ("\n".join(proof_species.SPECIES_ORDER),
                      "\n".join(lines) or "(none)"))


def test_the_duration_twin_still_draws_exactly_one_line(tmp_path, repo):
    """leg (d) [M4]: the duration twin of
    `tests/test_compile_plan_proof_species.py` cites `The probe waits ≤ 90 s.`
    with `the probe iterates 3 times` in task 1 and `elapsed under 90 s` in
    task 2; that exam pins it at one `duration-without-clock` line, so
    `threshold-one-sided` stays silent on both."""
    lines = _lines(tmp_path, repo, proof_species.DURATION_PLAN)
    assert _parsed(lines) == [("duration-without-clock", "1", None)], (
        "leg (d) [M4]: the duration twin still draws exactly one line, "
        "`duration-without-clock` on task 1. Got:\n"
        + ("\n".join(lines) or "(none)"))


def test_the_existing_species_exam_still_passes():
    """leg (d) [M4]: `tests/test_compile_plan_proof_species.py` passes — the
    whole file, run as the driver runs it."""
    p = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
         "tests/test_compile_plan_proof_species.py"],
        capture_output=True, text=True, cwd=str(ROOT))
    assert p.returncode == 0, (
        "leg (d) [M4]: the existing species exam still passes unchanged. "
        "Got rc=%d\n%s%s" % (p.returncode, p.stdout[-4000:], p.stderr[-2000:]))
