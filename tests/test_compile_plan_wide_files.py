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

Task "The wide-files knee reads the paths" (#666, proposal 1: "the advisory
reads the paths, not only the count") narrows the `wide-files` knee for two
kinds of task, and its rows live in the last section of this file:

  #666 M1 / leg (a) — more than FOUR `Create:`/`Modify:` entries that include
    `fleet/run-engine.mjs` print one line naming the engine as the reason.
  #666 M2 / leg (b) — more than four entries that include more than one
    `fleet/tests/test_<name>.mjs` sim, and no engine path, print one line
    naming `<k>` sims as the reason; the engine reason wins when both hold.
  #666 M3 / leg (c), (d) — every other task keeps the eight knee: one sim, two
    `_helpers.mjs` modules, four entries with the engine, and `Test:`-only sim
    paths are all silent, and the app-path fixtures still draw the BASE line.
  #666 M4 / leg (e) — `wide-contract` is unchanged, `--check` alone is still
    silent, the frozen-sha byte identity still holds, and the five-species
    exam and the species-vocabulary pins still pass.

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


# =========================================================================== #
# Task "The wide-files knee reads the paths" (#666) — the narrow knee.        #
#                                                                             #
# Everything above is this task's M3/M4 app-path rows and stays as it is. The #
# rows below are its own four clauses: the engine reason [M1], the sims       #
# reason [M2], the eight knee everywhere else [M3], and the untouched frozen  #
# channel [M4].                                                               #
# =========================================================================== #
# The two verbatim narrow-knee lines, quoted from the task's own Machine
# clauses. Both end in the same advice; `<id>` is task 1 in every fixture.
NARROW_KNEE_ADVICE = (
    "run-10's eight-file engine task took 24.7 min while its one- and "
    "two-file siblings took 2–4; split along a Produces symbol")
# M1: `%d` is `<n>`, the Create: plus Modify: count.
ENGINE_KNEE_LINE = (
    "ADVISORY proof-species: wide-files — task 1: %d Create/Modify entries, "
    "wide at four because it writes fleet/run-engine.mjs — "
    + NARROW_KNEE_ADVICE)
# M2: the holes are `<n>` then `<k>`, the count of sim paths.
SIMS_KNEE_LINE = (
    "ADVISORY proof-species: wide-files — task 1: %d Create/Modify entries, "
    "wide at four because it writes %d fleet/tests/test_*.mjs sims — "
    + NARROW_KNEE_ADVICE)

ENGINE_PATH = "fleet/run-engine.mjs"


def _sims(n):
    """`n` paths of the shape `fleet/tests/test_<name>.mjs` — the sim shape
    M2 reads (`startswith` `fleet/tests/test_`, `endswith` `.mjs`)."""
    return ["fleet/tests/test_s%d.mjs" % i for i in range(1, n + 1)]


def _helpers(n):
    """`n` modules under the same directory WITHOUT the `test_` prefix — not
    sims, so leg (c) [M3] expects silence for them."""
    return ["fleet/tests/h%d_helpers.mjs" % i for i in range(1, n + 1)]


def _app(n, kind="m"):
    return ["app/%s%d.py" % (kind, i) for i in range(1, n + 1)]


def _path_plan(creates=(), modifies=(), tests=(), clauses=2):
    """A one-task plan whose Files block names these exact paths — the width
    helpers above build `app/` paths only, and these fixtures need the engine
    path and the sim paths by name."""
    files = (["- Create: `%s`" % p for p in creates]
             + ["- Modify: `%s`" % p for p in modifies]
             + ["- Test: `%s`" % p for p in tests])
    return HEADER + _task("1", files, _clauses(clauses), [_legs(clauses)])


# leg (a) [M1]: five `Modify:` — the engine and four `app/` paths.
ENGINE_FIVE_PLAN = _path_plan(modifies=[ENGINE_PATH] + _app(4))
# leg (a) [M1] [M2]: seven — the engine under `Create:`, two sims and four
# `app/` paths under `Modify:`. Both reasons hold; the engine reason wins.
ENGINE_AND_SIMS_SEVEN_PLAN = _path_plan(creates=[ENGINE_PATH],
                                        modifies=_sims(2) + _app(4))
# leg (a) [M1]: nine — the engine and eight `app/` paths. Over the OLD knee
# too, so the reason-carrying line must win over the BASE line.
ENGINE_NINE_PLAN = _path_plan(modifies=[ENGINE_PATH] + _app(8))
# leg (b) [M2]: two sims and three `app/` paths — five entries, `<k>` = 2.
SIMS_FIVE_PLAN = _path_plan(modifies=_sims(2) + _app(3))
# leg (b) [M2]: three sims and three `app/` paths — six entries, `<k>` = 3.
SIMS_SIX_PLAN = _path_plan(modifies=_sims(3) + _app(3))
# leg (b) [M2]: two sims and eight `app/` paths — ten entries, over the old
# knee as well, so again the reason-carrying line must win.
SIMS_TEN_PLAN = _path_plan(modifies=_sims(2) + _app(8))
# leg (c) [M3]: exactly ONE sim and four `app/` paths — more than one is the
# M2 trigger, so one is silent.
ONE_SIM_FIVE_PLAN = _path_plan(modifies=_sims(1) + _app(4))
# leg (c) [M3]: two `fleet/tests/<name>_helpers.mjs` and three `app/` paths —
# no `test_` prefix, so not sims.
HELPERS_FIVE_PLAN = _path_plan(modifies=_helpers(2) + _app(3))
# leg (c) [M3]: four entries including the engine — four is not MORE than four.
ENGINE_FOUR_PLAN = _path_plan(modifies=[ENGINE_PATH] + _app(3))
# leg (c) [M3]: four `Create:` `app/` paths and three sim paths under `Test:` —
# a `Test:` entry is a read; it neither counts nor triggers.
FOUR_APP_AND_THREE_SIM_TESTS_PLAN = _path_plan(creates=_app(4, "c"),
                                               tests=_sims(3))
# leg (d) [M3]: nine entries of which exactly one is a sim — the eight knee.
NINE_WITH_ONE_SIM_PLAN = _path_plan(modifies=_sims(1) + _app(8))


def _wide(tmp_path, repo, text, what):
    return _lines(tmp_path, repo, text, "wide-files", what)


# --------------------------------------------------------------------------- #
# #666 (a) [M1] the engine path narrows the knee to four                      #
# --------------------------------------------------------------------------- #
def test_666_five_entries_including_the_engine_print_the_engine_knee_line(
        tmp_path, repo):
    lines = _wide(tmp_path, repo, ENGINE_FIVE_PLAN,
                  "the engine and four app/ paths")
    assert lines == [ENGINE_KNEE_LINE % 5], (
        "#666 leg (a) [M1]: five `Create:`/`Modify:` entries including "
        "`fleet/run-engine.mjs` print exactly one `wide-files` line, verbatim, "
        "with `<n>` = 5. Expected:\n%s\nGot:\n%s"
        % (ENGINE_KNEE_LINE % 5, "\n".join(lines) or "(no wide-files line)"))


def test_666_the_engine_reason_wins_over_the_sims_reason(tmp_path, repo):
    """#666 leg (a) [M1] [M2]: one line per task — a task that writes the
    engine AND more than one sim prints the M1 line and no M2 line."""
    out = _rendered(tmp_path, repo, ENGINE_AND_SIMS_SEVEN_PLAN,
                    "the engine, two sims and four app/ paths")
    lines = _of(out, "wide-files")
    assert lines == [ENGINE_KNEE_LINE % 7], (
        "#666 leg (a) [M1] [M2]: seven entries — the engine under `Create:`, "
        "two sims and four `app/` paths under `Modify:` — print exactly one "
        "`wide-files` line, the engine one, with `<n>` = 7. Expected:\n%s\n"
        "Got:\n%s"
        % (ENGINE_KNEE_LINE % 7, "\n".join(lines) or "(no wide-files line)"))
    sims = [l for l in _species_lines(out) if "sims" in l]
    assert sims == [], (
        "#666 leg (a) [M1] [M2]: the engine reason wins, so no line naming "
        "`sims` is printed for the same task. Got:\n" + "\n".join(sims))


def test_666_nine_entries_including_the_engine_print_the_engine_line_not_base(
        tmp_path, repo):
    lines = _wide(tmp_path, repo, ENGINE_NINE_PLAN,
                  "the engine and eight app/ paths")
    assert lines == [ENGINE_KNEE_LINE % 9], (
        "#666 leg (a) [M1]: nine entries including `fleet/run-engine.mjs` "
        "print the engine line with `<n>` = 9 — one line, and NOT the BASE "
        "eight-knee line\n%s\nExpected:\n%s\nGot:\n%s"
        % (WIDE_FILES_LINE % 9, ENGINE_KNEE_LINE % 9,
           "\n".join(lines) or "(no wide-files line)"))


# --------------------------------------------------------------------------- #
# #666 (b) [M2] more than one sim narrows the knee to four                    #
# --------------------------------------------------------------------------- #
def test_666_five_entries_with_two_sims_print_the_sims_knee_line(tmp_path, repo):
    lines = _wide(tmp_path, repo, SIMS_FIVE_PLAN, "two sims and three app/ paths")
    assert lines == [SIMS_KNEE_LINE % (5, 2)], (
        "#666 leg (b) [M2]: five entries of which two are "
        "`fleet/tests/test_<name>.mjs` print exactly one `wide-files` line, "
        "verbatim, with `<n>` = 5 and `<k>` = 2. Expected:\n%s\nGot:\n%s"
        % (SIMS_KNEE_LINE % (5, 2),
           "\n".join(lines) or "(no wide-files line)"))


def test_666_six_entries_with_three_sims_count_the_sims(tmp_path, repo):
    lines = _wide(tmp_path, repo, SIMS_SIX_PLAN, "three sims and three app/ paths")
    assert lines == [SIMS_KNEE_LINE % (6, 3)], (
        "#666 leg (b) [M2]: `<n>` is the entry count and `<k>` the sim count — "
        "three sims and three `app/` paths give `<n>` = 6, `<k>` = 3. "
        "Expected:\n%s\nGot:\n%s"
        % (SIMS_KNEE_LINE % (6, 3),
           "\n".join(lines) or "(no wide-files line)"))


def test_666_ten_entries_with_two_sims_print_the_sims_line_not_base(tmp_path, repo):
    lines = _wide(tmp_path, repo, SIMS_TEN_PLAN, "two sims and eight app/ paths")
    assert lines == [SIMS_KNEE_LINE % (10, 2)], (
        "#666 leg (b) [M2]: ten entries of which two are sims print exactly "
        "one `wide-files` line, the sims one with `<n>` = 10 and `<k>` = 2 — "
        "NOT the BASE eight-knee line\n%s\nExpected:\n%s\nGot:\n%s"
        % (WIDE_FILES_LINE % 10, SIMS_KNEE_LINE % (10, 2),
           "\n".join(lines) or "(no wide-files line)"))


# --------------------------------------------------------------------------- #
# #666 (c) [M3] everything else keeps the eight knee — the silences           #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("text,what,why", [
    (ONE_SIM_FIVE_PLAN, "one sim and four app/ paths",
     "one `fleet/tests/test_<name>.mjs` is not MORE than one, so five entries "
     "stay under the eight knee and print nothing"),
    (HELPERS_FIVE_PLAN, "two fleet/tests helpers modules and three app/ paths",
     "`fleet/tests/<name>_helpers.mjs` has no `test_` prefix, so it is not a "
     "sim and five entries print nothing"),
    (ENGINE_FOUR_PLAN, "the engine and three app/ paths",
     "four entries is not MORE than four, so even the engine prints nothing"),
    (FOUR_APP_AND_THREE_SIM_TESTS_PLAN, "four app/ Create: and three sim Test:",
     "a `Test:` entry is a read — three sim paths there neither count toward "
     "`<n>` nor trigger the sims reason"),
])
def test_666_the_narrow_knee_is_silent(tmp_path, repo, text, what, why):
    lines = _wide(tmp_path, repo, text, what)
    assert lines == [], (
        "#666 leg (c) [M3]: %s — %s. Got:\n%s" % (what, why, "\n".join(lines)))


def test_666_the_silence_at_four_is_the_threshold_and_not_a_dead_render(
        tmp_path, repo):
    """#666 leg (c) [M3]: the four-entry engine fixture is silent only if the
    same fixture one `app/` entry wider prints — otherwise the silence is an
    absent render, not a threshold."""
    silent = _wide(tmp_path, repo, ENGINE_FOUR_PLAN,
                   "the engine and three app/ paths")
    assert silent == [], (
        "#666 leg (c) [M3]: four entries including the engine print no "
        "`wide-files` line. Got:\n" + "\n".join(silent))
    wider = _wide(tmp_path, repo, ENGINE_FIVE_PLAN,
                  "the engine and four app/ paths")
    assert wider == [ENGINE_KNEE_LINE % 5], (
        "#666 leg (c) [M3]: the SAME fixture one `app/` entry wider prints the "
        "M1 line with `<n>` = 5, so the silence at four is the threshold. "
        "Expected:\n%s\nGot:\n%s"
        % (ENGINE_KNEE_LINE % 5, "\n".join(wider) or "(no wide-files line)"))


# --------------------------------------------------------------------------- #
# #666 (d) [M3] the app-path rows still draw the BASE eight-knee line         #
# --------------------------------------------------------------------------- #
def test_666_the_app_path_fixture_still_draws_the_base_eight_knee_line(
        tmp_path, repo):
    lines = _wide(tmp_path, repo, FIVE_AND_FOUR_PLAN,
                  "five Create: and four Modify: app/ paths")
    assert lines == [WIDE_FILES_LINE % 9], (
        "#666 leg (d) [M3]: the existing five-`Create:`-and-four-`Modify:` "
        "app-path fixture still prints exactly the BASE eight-knee line with "
        "`<n>` = 9 — the narrow knee reads paths, it does not move the old "
        "one. Expected:\n%s\nGot:\n%s"
        % (WIDE_FILES_LINE % 9, "\n".join(lines) or "(no wide-files line)"))


def test_666_nine_entries_with_one_sim_draw_the_base_line_not_the_sims_line(
        tmp_path, repo):
    lines = _wide(tmp_path, repo, NINE_WITH_ONE_SIM_PLAN,
                  "one sim and eight app/ paths")
    assert lines == [WIDE_FILES_LINE % 9], (
        "#666 leg (d) [M3]: nine entries of which exactly one is a sim are "
        "wide by the EIGHT knee, so the BASE line prints and the M2 line does "
        "not. Expected:\n%s\nGot:\n%s"
        % (WIDE_FILES_LINE % 9, "\n".join(lines) or "(no wide-files line)"))


# --------------------------------------------------------------------------- #
# #666 (e) [M4] wide-contract, the frozen channel, the neighbouring exams     #
# --------------------------------------------------------------------------- #
def test_666_the_wide_contract_species_is_unchanged(tmp_path, repo):
    nine = _lines(tmp_path, repo, NINE_CLAUSE_PLAN, "wide-contract",
                  "nine Machine clauses")
    eleven = _lines(tmp_path, repo, ELEVEN_CLAUSE_PLAN, "wide-contract",
                    "eleven Machine clauses")
    assert (nine, eleven) == ([WIDE_CONTRACT_LINE % 9],
                              [WIDE_CONTRACT_LINE % 11]), (
        "#666 leg (e) [M4]: `wide-contract` is untouched — its nine-clause and "
        "eleven-clause fixtures still print exactly their lines. Got:\n%s\n%s"
        % ("\n".join(nine) or "(none)", "\n".join(eleven) or "(none)"))


def test_666_the_engine_fixture_draws_nothing_without_renders(tmp_path, repo):
    """#666 leg (e) [M4]: the narrow knee rides behind `--renders` like the
    knee it narrows — the five-entry engine fixture draws its line under
    `--check --renders` and nothing under `--check` alone."""
    plan = _write(tmp_path, ENGINE_FIVE_PLAN)
    with_renders = _healthy(_check(plan, "--renders", "--base", str(repo)),
                            "the engine and four app/ paths")
    assert _of(with_renders, "wide-files") == [ENGINE_KNEE_LINE % 5], (
        "#666 leg (e) [M4]: the fixture draws the M1 line under `--renders`, "
        "so the silence asserted next is the flag's and not an absent render. "
        "Got:\n" + with_renders)

    bare = _check(plan)
    assert (bare.returncode, bare.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "#666 leg (e) [M4]: `--check` alone exits 0 with `PLAN OK` as its "
        "first line, exactly as at BASE. Got rc=%d\n%s%s"
        % (bare.returncode, bare.stdout, bare.stderr))
    assert _of(bare.stdout, "wide-files") == [], (
        "#666 leg (e) [M4]: `--check` alone prints no `wide-files` line. "
        "Got:\n" + bare.stdout)
    assert "wide-files" not in bare.stdout, (
        "#666 leg (e) [M4]: the frozen `--check` channel names the species "
        "nowhere. Got:\n" + bare.stdout)


def test_666_the_species_vocabulary_and_five_species_exams_still_pass():
    """#666 leg (e) [M4]: the Proof's `Run:` — the five-species fixture
    (exactly five lines, one per registered species) and the
    species-vocabulary pins over the skill text, neither of which this task
    may move."""
    p = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
         "tests/test_compile_plan_proof_species.py",
         "tests/test_compile_plan_check_cost.py"],
        capture_output=True, text=True, cwd=str(ROOT))
    assert p.returncode == 0, (
        "#666 leg (e) [M4]: the narrow knee adds no species and no word to the "
        "refusal vocabulary, so both exams pass unchanged. Got rc=%d\n%s%s"
        % (p.returncode, p.stdout, p.stderr))
