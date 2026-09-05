"""A wide task is named before a VM is spent on it.

Two more `ADVISORY proof-species:` species, printed under `--check --renders`
before any reader is dispatched: a claims-v1 task whose Files block is wider
than eight `Create:`/`Modify:` entries, and one whose Machine line numbers more
than eight clauses. Both are advisories — they gate nothing, refuse nothing and
change no exit code. This exam pins the four Machine clauses leg by leg:

  M1 / leg (a) — a claims-v1 task whose `Create:` plus `Modify:` entries number
    more than eight prints one line
    `ADVISORY proof-species: wide-files — task <id>: <n> Create/Modify entries
    — run-55's 19-file task hit the worker wall clock while its 3–8-file
    siblings finished; split along a Produces symbol`, `<n>` the count: five
    `Create:` and four `Modify:` give `9`, seven and five give `12`.
  M2 / leg (b) — a claims-v1 task whose Machine line numbers more than eight
    clauses prints one line
    `ADVISORY proof-species: wide-contract — task <id>: <m> Machine clauses —
    one contract per task; split along a Produces symbol`, `<m>` the count:
    nine clauses give `9`, eleven give `11`.
  M3 / leg (c) — both are silent at eight or fewer, and `Test:` entries do not
    count toward `wide-files`: four `Create:`, four `Modify:` and three `Test:`
    draw no `wide-files` line, and eight clauses draw no `wide-contract` line.
  M4 / leg (d) — without `--renders` nothing is printed, so the frozen `--check`
    channel is untouched: a plan that draws BOTH lines under `--renders` draws
    neither under `--check` alone, `tests/test_compile_plan_proof_runs.py`'s
    frozen-sha byte-identity assertion still holds when re-run from here, and
    `tests/test_compile_plan_proof_species.py` — the five-species fixture and
    its line-shape regex — still passes.

Every line either species prints is read back through
`tests/test_compile_plan_proof_species.py`'s own `SPECIES_LINE_RE`, so a line
that does not carry the shared `proof-species` shape fails here as well.

Every fixture plan below is a signed claims-v1 plan (spec §4.5: the compiler
refuses to compile one without its gate-verdict record), and `_rendered`
asserts the fixture's own health — exit 0, `PLAN OK` — before its species lines
are read, so a broken fixture never reads as a missing species. No fixture's
prose carries a `;`-chained `Run:`, a prose leg reference, an unpinned default,
a universal, or a duration bound, so the species already registered at BASE
stay silent and the lines read here are only the two this task adds.
"""
import json
import string
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
# the line shape is that file's regex, read back from here.
import test_compile_plan_proof_runs as proof_runs  # noqa: E402
import test_compile_plan_proof_species as proof_species  # noqa: E402

SPECIES_PREFIX = proof_species.SPECIES_PREFIX
SPECIES_LINE_RE = proof_species.SPECIES_LINE_RE

# The two verbatim lines M1 and M2 pin, quoted from the task's own words. `%d`
# is the only hole: `<id>` is task 1 in every fixture below.
WIDE_FILES_LINE = (
    "ADVISORY proof-species: wide-files — task 1: %d Create/Modify entries — "
    "run-55's 19-file task hit the worker wall clock while its 3–8-file "
    "siblings finished; split along a Produces symbol")
WIDE_CONTRACT_LINE = (
    "ADVISORY proof-species: wide-contract — task 1: %d Machine clauses — "
    "one contract per task; split along a Produces symbol")

HEADER = ("# Plan: A wide task is named before a VM is spent on it\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")


# --------------------------------------------------------------------------- #
# Fixture plans                                                                #
# --------------------------------------------------------------------------- #
def _task(task_id, files, machine, proof):
    """One claims-v1 task carrying all six slots; `files` is the Files-block
    bullet lines, `machine` the Machine restatement, `proof` the Proof-slot
    bullet lines."""
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "%s"
            "\n"
            "**Claim:** An operator sees the width named before a reader is "
            "dispatched. (quoted from #582)\n"
            "Machine: %s\n"
            "\n"
            "**Authorized-by:** #582\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** The repo has no width render of its own yet, so no "
            "plan is read this way.\n"
            "\n"
            "**Proof:**\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #582\n"
            % (task_id, task_id, "".join(l + "\n" for l in files), machine,
               task_id, "".join(l + "\n" for l in proof)))


def _clauses(n):
    """A Machine restatement numbering exactly `n` clauses, none of them
    carrying a default literal, a universal or a duration bound."""
    return " ".join("M%d. The probe writes `out/r%d.json`." % (i, i)
                    for i in range(1, n + 1))


def _legs(n):
    """One lettered leg per clause, each citing its own clause and naming no
    other leg — so the citation grammar is satisfied and no BASE species
    fires."""
    return ("- Legs: "
            + "; ".join("(%s) the file `out/r%d.json` is written [M%d]"
                        % (string.ascii_lowercase[i - 1], i, i)
                        for i in range(1, n + 1))
            + ".")


def _files(creates=0, modifies=0, tests=0):
    return (["- Create: `app/c%d.py`" % i for i in range(1, creates + 1)]
            + ["- Modify: `app/m%d.py`" % i for i in range(1, modifies + 1)]
            + ["- Test: `tests/test_t%d.py`" % i for i in range(1, tests + 1)])


# Two clauses — under the threshold, so a wide-files fixture draws no
# `wide-contract` line and leg (a)'s "exactly one line" is a live check.
NARROW_MACHINE = _clauses(2)
NARROW_LEGS = _legs(2)


def _width_plan(creates=0, modifies=0, tests=0, clauses=2):
    """A one-task plan of the given Files width and clause count."""
    return HEADER + _task("1", _files(creates, modifies, tests),
                          _clauses(clauses), [_legs(clauses)])


# leg (a) [M1]: five `Create:` and four `Modify:` — nine entries.
FIVE_AND_FOUR_PLAN = _width_plan(creates=5, modifies=4)
# leg (a) [M1]: seven and five — twelve entries.
SEVEN_AND_FIVE_PLAN = _width_plan(creates=7, modifies=5)
# leg (b) [M2]: nine and eleven clauses, on a one-file task.
NINE_CLAUSE_PLAN = _width_plan(creates=1, clauses=9)
ELEVEN_CLAUSE_PLAN = _width_plan(creates=1, clauses=11)
# leg (c) [M3]: four `Create:`, four `Modify:` and three `Test:` — eight
# writes, eleven Files entries; and eight clauses, the silent boundary.
FOUR_FOUR_AND_THREE_TESTS_PLAN = _width_plan(creates=4, modifies=4, tests=3)
EIGHT_CLAUSE_PLAN = _width_plan(creates=1, clauses=8)
# leg (d) [M4]: nine entries AND nine clauses on one task — both species.
BOTH_PLAN = _width_plan(creates=5, modifies=4, clauses=9)


# --------------------------------------------------------------------------- #
# Running the compiler over a fixture plan                                     #
# --------------------------------------------------------------------------- #
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


def _write(tmp_path, text, name="plan.md"):
    p = tmp_path / name
    p.write_text(text)
    return _sign(p)


@pytest.fixture
def repo(tmp_path_factory):
    """The git checkout `--base` names: `render_advisories` skips every render
    outside one."""
    r = tmp_path_factory.mktemp("repo")
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


def _healthy(p, what):
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "fixture plan %s must compile clean before its species are read; got "
        "rc=%d\n%s%s" % (what, p.returncode, p.stdout, p.stderr))
    return p.stdout


def _rendered(tmp_path, repo, text, what):
    """`--check --renders` stdout for a signed fixture plan, its own health
    asserted first."""
    plan = _write(tmp_path, text)
    return _healthy(_check(plan, "--renders", "--base", str(repo)), what)


def _species_lines(stdout):
    """Every `ADVISORY proof-species:` line, each held to the shared shape
    `tests/test_compile_plan_proof_species.py` pins."""
    lines = [l for l in stdout.splitlines() if l.startswith(SPECIES_PREFIX)]
    for line in lines:
        assert SPECIES_LINE_RE.match(line), (
            "[M1] [M2]: every line keeps the `proof-species` shape "
            "`ADVISORY proof-species: <species> — task <id>[, leg <label>]: "
            "<detail>` that tests/test_compile_plan_proof_species.py pins "
            "— got:\n" + line)
    return lines


def _of(stdout, species):
    return [l for l in _species_lines(stdout)
            if SPECIES_LINE_RE.match(l).group("species") == species]


def _lines(tmp_path, repo, text, species, what):
    return _of(_rendered(tmp_path, repo, text, what), species)


# --------------------------------------------------------------------------- #
# (a) [M1] the wide-files line, its count and its verbatim text                #
# --------------------------------------------------------------------------- #
def test_five_creates_and_four_modifies_print_the_nine_entry_line(tmp_path, repo):
    lines = _lines(tmp_path, repo, FIVE_AND_FOUR_PLAN, "wide-files",
                   "five Create: and four Modify:")
    assert lines == [WIDE_FILES_LINE % 9], (
        "leg (a) [M1]: a task with five `Create:` and four `Modify:` entries "
        "prints exactly one `wide-files` line, verbatim, with `<n>` = 9. "
        "Expected:\n%s\nGot:\n%s"
        % (WIDE_FILES_LINE % 9, "\n".join(lines) or "(no wide-files line)"))


def test_seven_creates_and_five_modifies_print_the_twelve_entry_line(tmp_path, repo):
    lines = _lines(tmp_path, repo, SEVEN_AND_FIVE_PLAN, "wide-files",
                   "seven Create: and five Modify:")
    assert lines == [WIDE_FILES_LINE % 12], (
        "leg (a) [M1]: seven `Create:` and five `Modify:` entries print the "
        "same line with `12 Create/Modify entries` — `<n>` is the count, not "
        "a constant. Expected:\n%s\nGot:\n%s"
        % (WIDE_FILES_LINE % 12, "\n".join(lines) or "(no wide-files line)"))


def test_a_wide_files_task_with_two_clauses_draws_no_wide_contract_line(tmp_path, repo):
    lines = _lines(tmp_path, repo, FIVE_AND_FOUR_PLAN, "wide-contract",
                   "five Create: and four Modify:")
    assert lines == [], (
        "leg (a) [M1]: the two species are independent — a nine-entry task "
        "whose Machine numbers two clauses draws `wide-files` alone. Got:\n"
        + "\n".join(lines))


# --------------------------------------------------------------------------- #
# (b) [M2] the wide-contract line, its count and its verbatim text             #
# --------------------------------------------------------------------------- #
def test_nine_machine_clauses_print_the_nine_clause_line(tmp_path, repo):
    lines = _lines(tmp_path, repo, NINE_CLAUSE_PLAN, "wide-contract",
                   "nine Machine clauses")
    assert lines == [WIDE_CONTRACT_LINE % 9], (
        "leg (b) [M2]: a task whose Machine line numbers nine clauses, each "
        "cited by a leg, prints exactly one `wide-contract` line, verbatim, "
        "with `<m>` = 9. Expected:\n%s\nGot:\n%s"
        % (WIDE_CONTRACT_LINE % 9, "\n".join(lines) or "(no wide-contract line)"))


def test_eleven_machine_clauses_print_the_eleven_clause_line(tmp_path, repo):
    lines = _lines(tmp_path, repo, ELEVEN_CLAUSE_PLAN, "wide-contract",
                   "eleven Machine clauses")
    assert lines == [WIDE_CONTRACT_LINE % 11], (
        "leg (b) [M2]: eleven clauses print the same line with `11 Machine "
        "clauses` — `<m>` is the count. Expected:\n%s\nGot:\n%s"
        % (WIDE_CONTRACT_LINE % 11,
           "\n".join(lines) or "(no wide-contract line)"))


def test_a_wide_contract_task_with_one_file_draws_no_wide_files_line(tmp_path, repo):
    lines = _lines(tmp_path, repo, NINE_CLAUSE_PLAN, "wide-files",
                   "nine Machine clauses")
    assert lines == [], (
        "leg (b) [M2]: a nine-clause task declaring one `Create:` entry draws "
        "`wide-contract` alone. Got:\n" + "\n".join(lines))


# --------------------------------------------------------------------------- #
# (c) [M3] silent at eight or fewer; `Test:` entries do not count              #
# --------------------------------------------------------------------------- #
def test_four_creates_four_modifies_and_three_tests_draw_no_wide_files_line(
        tmp_path, repo):
    """The eleven Files entries include three `Test:` paths; only the eight
    `Create:`/`Modify:` entries count, and eight is silent."""
    lines = _lines(tmp_path, repo, FOUR_FOUR_AND_THREE_TESTS_PLAN,
                   "wide-files", "four Create:, four Modify:, three Test:")
    assert lines == [], (
        "leg (c) [M3]: silent at eight `Create:`/`Modify:` entries, and the "
        "three `Test:` paths do not count toward `wide-files` — eleven Files "
        "entries, still no line. Got:\n" + "\n".join(lines))


def test_eight_machine_clauses_draw_no_wide_contract_line(tmp_path, repo):
    lines = _lines(tmp_path, repo, EIGHT_CLAUSE_PLAN, "wide-contract",
                   "eight Machine clauses")
    assert lines == [], (
        "leg (c) [M3]: silent at eight clauses — the threshold is MORE than "
        "eight. Got:\n" + "\n".join(lines))


def test_the_silence_at_eight_is_the_threshold_and_not_a_dead_render(tmp_path, repo):
    """leg (c) [M3]: the two silences above are only a threshold if the same
    fixture shape, one entry and one clause wider, does print."""
    wide = _lines(tmp_path, repo, _width_plan(creates=5, modifies=4),
                  "wide-files", "nine entries")
    assert wide == [WIDE_FILES_LINE % 9], (
        "leg (c) [M3]: nine entries print, so eight's silence is a threshold "
        "and not an absent render. Got:\n" + "\n".join(wide))
    contract = _lines(tmp_path, repo, NINE_CLAUSE_PLAN, "wide-contract",
                      "nine clauses")
    assert contract == [WIDE_CONTRACT_LINE % 9], (
        "leg (c) [M3]: nine clauses print, so eight's silence is a threshold "
        "and not an absent render. Got:\n" + "\n".join(contract))


# --------------------------------------------------------------------------- #
# (d) [M4] the frozen `--check` channel is untouched                           #
# --------------------------------------------------------------------------- #
def test_a_plan_drawing_both_lines_draws_neither_without_renders(tmp_path, repo):
    """leg (d) [M4]: one task, nine `Create:`/`Modify:` entries and nine
    clauses — both lines under `--check --renders`, neither under `--check`
    alone."""
    plan = _write(tmp_path, BOTH_PLAN)
    with_renders = _healthy(_check(plan, "--renders", "--base", str(repo)),
                            "nine entries and nine clauses")
    assert _of(with_renders, "wide-files") == [WIDE_FILES_LINE % 9]
    assert _of(with_renders, "wide-contract") == [WIDE_CONTRACT_LINE % 9], (
        "leg (d) [M4]: the fixture draws both lines under `--renders`, so the "
        "silence asserted next is the flag's and not an absent render. Got:\n"
        + with_renders)

    bare = _healthy(_check(plan), "nine entries and nine clauses, no --renders")
    assert "wide-files" not in bare and "wide-contract" not in bare, (
        "leg (d) [M4]: both species ride behind `--renders`; `--check` alone "
        "prints neither line. Got:\n" + bare)
    assert _species_lines(bare) == [], (
        "leg (d) [M4]: `--check` alone prints no `proof-species:` line at all")


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
    """leg (d) [M4]: both species ride behind `--renders`, so every Run-less
    fixture plan's `--check` output stays byte-identical to the compiler at the
    frozen sha — the assertion is `tests/test_compile_plan_proof_runs.py`'s
    frozen-sha comparison, imported and called."""
    base_compiler = _fixture_fn(proof_runs.base_compiler)(tmp_path_factory)
    proof_runs.test_every_run_less_fixture_plan_checks_byte_identically_to_base(
        base_compiler)


def test_the_five_species_exam_still_passes():
    """leg (d) [M4]: `tests/test_compile_plan_proof_species.py` — its
    five-species fixture printing exactly its five lines, its line-shape regex
    and its registration pin — passes unchanged."""
    p = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
         "tests/test_compile_plan_proof_species.py"],
        capture_output=True, text=True, cwd=str(ROOT))
    assert p.returncode == 0, (
        "leg (d) [M4]: the existing species exam must still pass — the "
        "five-species fixture (one file per task, one to three clauses) draws "
        "no new line. Got rc=%d\n%s%s" % (p.returncode, p.stdout, p.stderr))
