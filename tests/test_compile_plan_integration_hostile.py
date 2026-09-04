"""The two integration-hostile `Run:` shapes draw their own advisory species.

Since #604 the driver re-runs every merged task's `Run:` on the *adopted* tree,
where every sibling's changes have folded in. Two `Run:` shapes are wrong by
construction there: a suite total pinned to an absolute number (a sibling that
adds one test falsifies it) and a bare directory checked absent (a
`__pycache__` keeps it alive). This exam pins the four Machine clauses of the
task that names them, leg by leg:

  M1 / leg (a) — under `--check --renders`, a `Run:` carrying `--collect-only`
    with, in the segment before its first `|`, no token containing `/` and none
    ending in `.py`, compared against a bare integer (`= <digits>`,
    `== <digits>` or `-eq <digits>`), draws exactly one line
    `ADVISORY proof-species: suite-total-pin — task <id>: <detail>` whose
    detail carries the command's text.
  M2 / leg (b) — under `--check --renders`, a `Run:` of the form
    `test ! -e <path>` or `test ! -d <path>` whose path's last segment carries
    no `.` draws exactly one line
    `ADVISORY proof-species: directory-absence-pin — task <id>: <detail>`
    whose detail carries the command's text.
  M3 / leg (c) — a collect-only segment naming a `.py` path, and a `test ! -e`
    on a path whose last segment has a dot, draw neither line; and no line of
    either species changes the verdict — every plan in this exam prints
    `PLAN OK` and exits 0.
  M4 — the ultrawrite skill's proof-gate sentence that opens "…name the
    rejection species found by hand" lists both new species names.

Every fixture plan below is a signed claims-v1 plan (the compiler refuses to
compile one without its gate-verdict record), and `_rendered` asserts the
fixture's own health — exit 0, `PLAN OK` — before reading any species line off
it, so a broken fixture never reads as a missing species.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
SKILL = ROOT / "skills/ultrawrite/SKILL.md"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import compile_plan  # noqa: E402

SPECIES_PREFIX = "ADVISORY proof-species: "
SUITE_TOTAL = "suite-total-pin"
DIRECTORY_ABSENCE = "directory-absence-pin"

# The clip the render's detail rides under (`_clip_run`'s default): a command
# no longer than this reaches the detail verbatim.
RUN_CLIP = 80

HEADER = ("# Plan: The integration-hostile Run: shapes\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

# A Machine clause and a citing leg that trip none of the five species already
# rendered: no `defaults to`, no `every`/`each`/`all`, no duration bound, no
# `leg (x)` written in prose.
MACHINE = "M1. The probe writes `out/report.json`."
LEG = "- Legs: (a) the report file is written [M1]."


def _task(task_id, runs):
    """One claims-v1 task carrying all six slots, whose Proof is the given
    `Run:` commands plus one citing leg."""
    proof = "".join("- Run: %s\n" % cmd for cmd in runs) + LEG + "\n"
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "- Create: `app/probe_%s.py`\n"
            "\n"
            "**Claim:** An operator sees the integration-hostile shapes named "
            "before a reader is dispatched. (quoted from #631)\n"
            "Machine: %s\n"
            "\n"
            "**Authorized-by:** #631\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** The repo has no species render for these two shapes "
            "yet, so no plan is read this way.\n"
            "\n"
            "**Proof:**\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #631\n"
            % (task_id, task_id, task_id, MACHINE, task_id, proof))


def _plan(*tasks):
    return HEADER + "\n".join(tasks)


def _sign(plan):
    """Stamp an all-pass gate-verdict record beside a claims-v1 plan — the
    compiler refuses to compile one without."""
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
    """The git checkout `--base` names: `render_advisories` skips every render
    outside one."""
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
    """`--check --renders` on a signed fixture plan: its stdout, with the
    fixture's own health asserted first so a broken fixture never reads as a
    missing species line. Doubles as leg (c) [M3]'s verdict assertion — every
    plan in this exam passes through here."""
    plan = tmp_path / name
    plan.write_text(text)
    _sign(plan)
    p = _check(plan, "--renders", "--base", str(repo))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "leg (c) [M3]: an advisory render changes no verdict and no exit code "
        "— fixture plan %s must print `PLAN OK` and exit 0; got rc=%d\n%s%s"
        % (name, p.returncode, p.stdout, p.stderr))
    return p.stdout


def _species(stdout, species):
    """Every `ADVISORY proof-species:` line of the named species."""
    return [l for l in stdout.splitlines()
            if l.startswith(SPECIES_PREFIX + species + " ")]


# --------------------------------------------------------------------------- #
# The fixture commands                                                         #
# --------------------------------------------------------------------------- #
# (a) [M1]: `--collect-only`, nothing path-like before the first `|`, compared
# against a bare integer. The three comparison spellings M1 names.
SUITE_TOTAL_EQ = ('test "$(python3 -m pytest --collect-only -q | tail -1 | '
                  "cut -d' ' -f1)\" = 1461")
SUITE_TOTAL_MINUS_EQ = SUITE_TOTAL_EQ.replace("= 1461", "-eq 1461")
SUITE_TOTAL_DOUBLE_EQ = SUITE_TOTAL_EQ.replace("= 1461", "== 1461")
SUITE_TOTAL_COMMANDS = {
    "=": SUITE_TOTAL_EQ,
    "-eq": SUITE_TOTAL_MINUS_EQ,
    "==": SUITE_TOTAL_DOUBLE_EQ,
}

# (b) [M2]: `test ! -e <dir>` and `test ! -d <dir>`, the path's last segment
# carrying no `.`.
ABSENCE_E = "test ! -e tests/drainprobe"
ABSENCE_D = "test ! -d tests/drainprobe"
ABSENCE_COMMANDS = {"-e": ABSENCE_E, "-d": ABSENCE_D}

# (c) [M3]: the two repaired shapes — a collect-only segment naming a `.py`
# path, and a `test ! -e` whose last path segment has a dot.
BENIGN_COLLECT = ('test "$(python3 -m pytest --collect-only -q tests/test_x.py '
                  '| grep -c ::)" = 7')
BENIGN_ABSENCE = "test ! -e tests/drainprobe.py"

BENIGN_PLAN = _plan(_task("1", [BENIGN_COLLECT, BENIGN_ABSENCE]))


# --------------------------------------------------------------------------- #
# (a) [M1] the suite-total pin                                                 #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("spelling", sorted(SUITE_TOTAL_COMMANDS))
def test_leg_a_m1_a_collect_only_pin_draws_exactly_one_suite_total_line(
        tmp_path, repo, spelling):
    """leg (a) [M1] — one line per hit, its detail carrying the command."""
    command = SUITE_TOTAL_COMMANDS[spelling]
    out = _rendered(tmp_path, repo, _plan(_task("1", [command])))
    lines = _species(out, SUITE_TOTAL)
    assert len(lines) == 1, (
        "leg (a) [M1]: `- Run: %s` draws exactly one `%s` line under "
        "`--check --renders`; got %d:\n%s"
        % (command, SUITE_TOTAL, len(lines), out))
    prefix = "%s%s — task 1: " % (SPECIES_PREFIX, SUITE_TOTAL)
    assert lines[0].startswith(prefix), (
        "leg (a) [M1]: the line begins `%s`; got:\n%s" % (prefix, lines[0]))
    detail = lines[0][len(prefix):]
    assert len(command) <= RUN_CLIP, (
        "leg (a) [M1]: this command is %d characters, under the %d-character "
        "clip, so it rides in the detail whole" % (len(command), RUN_CLIP))
    assert command in detail, (
        "leg (a) [M1]: the remainder carries the whole `Run:` command "
        "verbatim — `%s`; got: %s" % (command, detail))


def test_leg_a_m1_the_suite_total_line_is_the_only_species_line_it_draws(
        tmp_path, repo):
    """leg (a) [M1] / leg (c) [M3]: the collect-only pin draws its own species
    and not the directory one."""
    out = _rendered(tmp_path, repo, _plan(_task("1", [SUITE_TOTAL_EQ])))
    assert _species(out, DIRECTORY_ABSENCE) == [], (
        "leg (a) [M1]: a `--collect-only` pin is not a directory-absence pin:\n"
        + out)


def test_leg_a_m1_the_species_prints_only_under_renders(tmp_path, repo):
    """leg (a) [M1]: `Under --check --renders` — `--check` alone is silent."""
    plan = tmp_path / "plan.md"
    plan.write_text(_plan(_task("1", [SUITE_TOTAL_EQ, ABSENCE_E])))
    _sign(plan)
    bare = _check(plan)
    assert bare.returncode == 0, bare.stdout + bare.stderr
    assert bare.stdout.splitlines()[:1] == ["PLAN OK"], bare.stdout
    assert SUITE_TOTAL not in bare.stdout and DIRECTORY_ABSENCE not in bare.stdout, (
        "leg (a) [M1] / leg (b) [M2]: both species ride behind `--renders`; "
        "`--check` alone names neither. Got:\n" + bare.stdout)


# --------------------------------------------------------------------------- #
# (b) [M2] the directory-absence pin                                           #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("flag", sorted(ABSENCE_COMMANDS))
def test_leg_b_m2_a_bare_directory_absence_draws_exactly_one_line(
        tmp_path, repo, flag):
    """leg (b) [M2] — `test ! -e <dir>` and `test ! -d <dir>` each draw one."""
    command = ABSENCE_COMMANDS[flag]
    out = _rendered(tmp_path, repo, _plan(_task("1", [command])))
    lines = _species(out, DIRECTORY_ABSENCE)
    assert len(lines) == 1, (
        "leg (b) [M2]: `- Run: %s` draws exactly one `%s` line under "
        "`--check --renders`; got %d:\n%s"
        % (command, DIRECTORY_ABSENCE, len(lines), out))
    prefix = "%s%s — task 1: " % (SPECIES_PREFIX, DIRECTORY_ABSENCE)
    assert lines[0].startswith(prefix), (
        "leg (b) [M2]: the line begins `%s`; got:\n%s" % (prefix, lines[0]))
    detail = lines[0][len(prefix):]
    assert command in detail, (
        "leg (b) [M2]: the remainder carries `%s` verbatim; got: %s"
        % (command, detail))


def test_leg_b_m2_the_absence_line_is_the_only_species_line_it_draws(
        tmp_path, repo):
    """leg (b) [M2] / leg (c) [M3]: a bare-directory absence is not a suite
    total."""
    out = _rendered(tmp_path, repo, _plan(_task("1", [ABSENCE_E])))
    assert _species(out, SUITE_TOTAL) == [], (
        "leg (b) [M2]: `test ! -e <dir>` draws no `%s` line:\n%s"
        % (SUITE_TOTAL, out))


def test_leg_a_and_b_one_task_carrying_both_shapes_draws_one_of_each(
        tmp_path, repo):
    """legs (a) [M1] and (b) [M2]: the two species are independent — one task
    carrying both `Run:` shapes draws exactly one line of each."""
    out = _rendered(tmp_path, repo, _plan(_task("1", [SUITE_TOTAL_EQ, ABSENCE_D])))
    assert (len(_species(out, SUITE_TOTAL)),
            len(_species(out, DIRECTORY_ABSENCE))) == (1, 1), (
        "legs (a) [M1] / (b) [M2]: one `%s` line and one `%s` line. Got:\n%s"
        % (SUITE_TOTAL, DIRECTORY_ABSENCE, out))


# --------------------------------------------------------------------------- #
# (c) [M3] the repaired shapes, and the untouched verdict                      #
# --------------------------------------------------------------------------- #
def test_leg_c_m3_a_collect_only_naming_a_py_path_draws_no_suite_total_line(
        tmp_path, repo):
    out = _rendered(tmp_path, repo, BENIGN_PLAN)
    assert _species(out, SUITE_TOTAL) == [], (
        "leg (c) [M3]: `%s` names a `.py` path in the segment before its "
        "first `|`, so it draws no `%s` line. Got:\n%s"
        % (BENIGN_COLLECT, SUITE_TOTAL, out))


def test_leg_c_m3_an_absence_on_a_dotted_last_segment_draws_no_line(
        tmp_path, repo):
    out = _rendered(tmp_path, repo, BENIGN_PLAN)
    assert _species(out, DIRECTORY_ABSENCE) == [], (
        "leg (c) [M3]: `%s`'s last path segment carries a `.`, so it draws no "
        "`%s` line. Got:\n%s" % (BENIGN_ABSENCE, DIRECTORY_ABSENCE, out))


ALL_PLANS = {
    "suite-total-eq": _plan(_task("1", [SUITE_TOTAL_EQ])),
    "suite-total-minus-eq": _plan(_task("1", [SUITE_TOTAL_MINUS_EQ])),
    "suite-total-double-eq": _plan(_task("1", [SUITE_TOTAL_DOUBLE_EQ])),
    "absence-e": _plan(_task("1", [ABSENCE_E])),
    "absence-d": _plan(_task("1", [ABSENCE_D])),
    "both": _plan(_task("1", [SUITE_TOTAL_EQ, ABSENCE_D])),
    "benign": BENIGN_PLAN,
}


@pytest.mark.parametrize("name", sorted(ALL_PLANS))
def test_leg_c_m3_every_plan_in_this_exam_prints_plan_ok_and_exits_zero(
        tmp_path, repo, name):
    """leg (c) [M3] — no line of either species changes the exit code."""
    plan = tmp_path / "plan.md"
    plan.write_text(ALL_PLANS[name])
    _sign(plan)
    p = _check(plan, "--renders", "--base", str(repo))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "leg (c) [M3]: plan %s still prints `PLAN OK` and exits 0; got rc=%d\n"
        "%s%s" % (name, p.returncode, p.stdout, p.stderr))


# --------------------------------------------------------------------------- #
# [M4] the ultrawrite skill's species sentence                                 #
# --------------------------------------------------------------------------- #
def _proof_gate_section():
    """The `## The proof gate` section of the skill, wrapped lines joined —
    the same slice the Proof's `sed`/`grep` bullet reads."""
    text = SKILL.read_text()
    m = re.search(r"^## The proof gate.*?(?=^## The worktree-pure contract)",
                  text, re.S | re.M)
    assert m, ("[M4]: the skill still carries a `## The proof gate` section "
               "ending at `## The worktree-pure contract`")
    return " ".join(m.group(0).splitlines())


def test_m4_the_skill_species_sentence_names_both_new_species():
    """[M4] — the sentence that opens "…name the rejection species found by
    hand" lists `suite-total-pin` and `directory-absence-pin`, in the
    proof-gate section and nowhere else."""
    section = _proof_gate_section()
    assert re.search(r"found by hand.*%s.*%s" % (re.escape(SUITE_TOTAL),
                                                 re.escape(DIRECTORY_ABSENCE)),
                     section), (
        "[M4]: `%s` reads only the proof-gate section and requires both names "
        "after the phrase `found by hand` that opens the species sentence — "
        "a name written anywhere else in the skill does not satisfy it. "
        "Section reads:\n%s" % (SKILL.relative_to(ROOT), section))


def test_m4_the_species_sentence_keeps_naming_the_five_it_already_named():
    """[M4] — the two names are ADDED to the list, not swapped in: the five
    species already rendered stay in the same sentence."""
    section = _proof_gate_section()
    for species in ("run-chained-semicolon", "leg-named-in-prose",
                    "default-unpinned", "universal-as-count-floor",
                    "duration-without-clock"):
        assert re.search(r"found by hand.*%s" % re.escape(species), section), (
            "[M4]: `%s` still names `%s` after `found by hand`" % (
                SKILL.relative_to(ROOT), species))
