"""A `Check:` that runs a sim is named as a per-task cost (task 2).

A `- Check:` bullet under `## Global Constraints` is a command the driver runs
in EVERY task's clone on every pass. When that command runs a test suite, the
cost is multiplied by the wave width — and the compiler can say so before a
reader is dispatched. This exam pins the four Machine clauses, leg by leg:

  M1 / leg (a) — under `--check --renders`, each `- Check:` bullet whose
    command names a path under `tests/` or `fleet/tests/` (a token beginning
    `tests/` or `fleet/tests/`, or containing `/tests/`) prints ONE line
    `ADVISORY check-cost: <command, clipped to 80 characters> — paid by every
    task on every pass; if one task owns what it tests, make it that task's
    Run:`. A plan carrying the three checks leg (a) names prints exactly three
    such lines, in section order, each equal to the clipped command wrapped in
    that prefix and that suffix; a command longer than 80 characters is clipped
    to 79 characters plus `…`.
  M2 / leg (b) — it is silent for a `Check:` naming no such path, for one
    ending `(minor)`, and for a plan with no `## Global Constraints` section;
    the line IS printed for a legacy-grammar plan, since a `Check:` belongs to
    no grammar. Those four fixtures yield zero, zero, zero and one line.
  M3 / leg (c) — without `--renders` nothing is printed: the two-check plan's
    bare `--check` output carries no `check-cost` line, and every Run-less
    fixture plan's `--check` output stays byte-identical to the compiler at the
    frozen sha — the byte-identity assertion of
    `tests/test_compile_plan_proof_runs.py`, imported and re-run from here.
  M4 — `skills/ultrawrite/SKILL.md` §Global Constraints discipline says a
    `Check:` that runs a sim is paid by every task on every pass and belongs in
    the owning task's `Run:`, and its species list under §The proof gate names
    `pinned-elsewhere`, `check-cost`, `prose-check`, `wide-files`,
    `wide-contract`, `threshold-one-sided` and `disjunct-without-leg` after
    `directory-absence-pin`. The three M4 assertions below are the task's own
    `Run:` bullets — the same two greps and the skill validator — expressed in
    Python, so the exam is no stricter than the Proof it grades.

Every claims-v1 fixture plan below is signed (spec §4.5: the compiler refuses
to compile one without its gate-verdict record), and `_rendered` asserts the
fixture's own health — exit 0, `PLAN OK` — before any `check-cost` line is read
off it, so a broken fixture never reads as a missing advisory.
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
VALIDATE_SKILL = ROOT / "skills/ultrapowers/scripts/validate_skill.py"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import compile_plan  # noqa: E402
# leg (c) [M3]: the frozen-sha byte-identity assertion is that file's, re-run here.
import test_compile_plan_proof_runs as proof_runs  # noqa: E402


# --------------------------------------------------------------------------- #
# The line M1 spells, in the task's own words                                  #
# --------------------------------------------------------------------------- #
PREFIX = "ADVISORY check-cost: "
SUFFIX = (" — paid by every task on every pass; if one task owns what it "
          "tests, make it that task's Run:")
CLIP = 80


def _expected_clip(command):
    """M1's `<command, clipped to 80 characters>`, restated here rather than
    imported: whitespace collapsed, and a command longer than `CLIP` cut to
    `CLIP - 1` characters plus `…` (leg (a)'s "79 characters plus `…`")."""
    s = " ".join(command.split())
    return s if len(s) <= CLIP else s[:CLIP - 1].rstrip() + "…"


def _expected_line(command):
    return PREFIX + _expected_clip(command) + SUFFIX


# --------------------------------------------------------------------------- #
# Fixture plans                                                                #
# --------------------------------------------------------------------------- #
HEADER = ("# Plan: A `Check:` that runs a sim is a per-task cost\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

TASK = ("### Task 1: Sample\n"
        "\n"
        "**Type:** implementation\n"
        "\n"
        "**Files:**\n"
        "- Create: `app/probe.py`\n"
        "\n"
        "**Claim:** An operator sees the per-task cost named before any reader "
        "is dispatched. (quoted from #657)\n"
        "Machine: M1. The probe writes `out/report.json`.\n"
        "\n"
        "**Authorized-by:** #657\n"
        "\n"
        "**Interfaces:**\n"
        "- Consumes: nothing\n"
        "- Produces: `probe(n: int) -> str`\n"
        "\n"
        "**Context:** The repo has no check-cost render of its own yet, so no "
        "plan is read this way.\n"
        "\n"
        "**Proof:**\n"
        "- Test: `tests/test_probe.py`\n"
        "- Legs: (a) the report file is written [M1].\n"
        "\n"
        "**Stale-if:**\n"
        "- issue-closed: #657\n")

# A prose bullet rides in every section: it is the other kind of bullet the
# section holds, and nothing runs it, so it prints no line either.
PROSE_BULLET = "- The suite is green."


def _plan(*check_bullets):
    """A signed-shape claims-v1 plan whose `## Global Constraints` section
    carries `check_bullets` in order."""
    section = "\n".join([PROSE_BULLET] + list(check_bullets))
    return HEADER + "## Global Constraints\n\n" + section + "\n\n" + TASK


def _plan_without_section():
    return HEADER + TASK


# leg (a) [M1] — the three commands the leg names, in section order.
THREE_COMMANDS = (
    "node fleet/tests/test_x.mjs | grep -q 'ALL TESTS PASSED'",
    "python3 -m pytest -q tests/test_y.py",
    "node packages/x/tests/y.mjs",
)
THREE_CHECK_PLAN = _plan(*["- Check: " + c for c in THREE_COMMANDS])

# leg (a) [M1] — the clipping witness. 108 characters, so the line carries the
# first 79 (the 79th is `.`, so nothing is stripped) plus `…`.
LONG_COMMAND = ("python3 -m pytest -q "
                "tests/test_a_very_long_module_name_used_only_for_clipping.py "
                "--maxfail=1 --durations=10")
LONG_CLIPPED = ("python3 -m pytest -q "
                "tests/test_a_very_long_module_name_used_only_for_clipping.…")
LONG_CHECK_PLAN = _plan("- Check: " + LONG_COMMAND)

# leg (b) [M2] — the three silent fixtures and the legacy one.
QUIET_COMMAND = "test -e src/x.ts"
QUIET_PLAN = _plan("- Check: " + QUIET_COMMAND)
MINOR_COMMAND = "node fleet/tests/test_x.mjs | grep -q ok"
MINOR_PLAN = _plan("- Check: " + MINOR_COMMAND + " (minor)")
NO_SECTION_PLAN = _plan_without_section()

LEGACY_COMMAND = "python3 -m pytest -q tests/test_y.py"
LEGACY_PLAN = (
    "# Plan: Legacy\n"
    "\n"
    "**Acceptance:** waived — inline test plan\n"
    "\n"
    "## Global Constraints\n"
    "\n"
    + PROSE_BULLET + "\n"
    "- Check: " + LEGACY_COMMAND + "\n"
    "\n"
    "### Task 1: Legacy sample\n"
    "\n"
    "**Type:** implementation\n"
    "**Depends-on:** none\n"
    "\n"
    "**Files:**\n"
    "- Create: `app/legacy.py`\n"
    "- Test: `tests/test_legacy.py`\n"
    "\n"
    "- [ ] **Step 1:** write the probe.\n")

# leg (c) [M3] — the two-check plan.
TWO_COMMANDS = THREE_COMMANDS[:2]
TWO_CHECK_PLAN = _plan(*["- Check: " + c for c in TWO_COMMANDS])


# --------------------------------------------------------------------------- #
# Driving the compiler                                                         #
# --------------------------------------------------------------------------- #
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


def _sign(plan):
    """Stamp an all-pass gate-verdict record beside a claims-v1 plan — the
    compiler refuses to compile one without (spec §4.5). A legacy plan has no
    claims body and needs none."""
    text = plan.read_text()
    if "**Grammar:** claims-v1" not in text:
        return plan
    record = {"tasks": {}, "tally": {"dispatched": 0, "rejected": 0}}
    for t in compile_plan.split_tasks(text):
        claims = compile_plan.parse_claims_body(t["body"], t["id"])
        record["tasks"][t["id"]] = {
            "hash": compile_plan.gate_input_hash(claims["claim"],
                                                 claims["proof"]),
            "verdict": "pass", "reason": "layer match"}
        record["tally"]["dispatched"] += 1
    compile_plan.verdicts_path(plan).write_text(json.dumps(record, indent=2) + "\n")
    return plan


def _write(tmp_path, text, name):
    p = tmp_path / name
    p.write_text(text)
    return _sign(p)


def _check(plan, *extra):
    return subprocess.run(
        [sys.executable, str(COMPILER), "--check", str(plan)] + list(extra),
        capture_output=True, text=True, cwd=str(ROOT))


def _cost_lines(stdout):
    return [l for l in stdout.splitlines() if l.startswith(PREFIX)]


def _rendered(tmp_path, repo, text, name):
    """`--check --renders` stdout for a fixture plan, with the fixture's own
    health asserted first so a broken fixture never reads as a missing line."""
    plan = _write(tmp_path, text, name)
    p = _check(plan, "--renders", "--base", str(repo))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "fixture plan %s must compile clean before its advisories are read; "
        "got rc=%d\n%s%s" % (name, p.returncode, p.stdout, p.stderr))
    return p.stdout


def _lines(tmp_path, repo, text, name):
    return _cost_lines(_rendered(tmp_path, repo, text, name))


# --------------------------------------------------------------------------- #
# (a) [M1] one line per test-naming `Check:`, in section order                 #
# --------------------------------------------------------------------------- #
def test_the_three_test_naming_checks_print_three_lines_in_section_order(
        tmp_path, repo):
    assert _lines(tmp_path, repo, THREE_CHECK_PLAN, "three.md") == [
        _expected_line(c) for c in THREE_COMMANDS], (
        "leg (a) [M1]: a `fleet/tests/` token, a leading `tests/` token and an "
        "embedded `/tests/` token each print exactly one `ADVISORY "
        "check-cost:` line, in section order, each equal to the clipped "
        "command between the prefix %r and the suffix %r" % (PREFIX, SUFFIX))


def test_each_line_is_the_prefix_the_clipped_command_and_the_suffix(
        tmp_path, repo):
    lines = _lines(tmp_path, repo, THREE_CHECK_PLAN, "three_shape.md")
    assert len(lines) == 3, "leg (a) [M1]: three checks, three lines"
    for line, command in zip(lines, THREE_COMMANDS):
        assert line.startswith(PREFIX), (
            "leg (a) [M1]: the line's own prefix is %r — got:\n%s"
            % (PREFIX, line))
        assert line.endswith(SUFFIX), (
            "leg (a) [M1]: the line ends with the verbatim advice %r — got:\n%s"
            % (SUFFIX, line))
        assert line[len(PREFIX):len(line) - len(SUFFIX)] == command, (
            "leg (a) [M1]: what sits between them is the command itself, "
            "clipped to %d characters — expected %r in:\n%s"
            % (CLIP, command, line))


def test_a_command_longer_than_eighty_characters_is_clipped(tmp_path, repo):
    assert len(LONG_COMMAND) > CLIP, "the clipping witness must exceed 80 chars"
    assert LONG_CLIPPED == _expected_clip(LONG_COMMAND)
    assert (len(LONG_CLIPPED), LONG_CLIPPED[-1]) == (CLIP, "…"), (
        "leg (a) [M1]: a command longer than 80 characters is clipped to 79 "
        "characters plus `…`")
    assert LONG_CLIPPED[:-1] == LONG_COMMAND[:CLIP - 1]
    assert _lines(tmp_path, repo, LONG_CHECK_PLAN, "long.md") == [
        PREFIX + LONG_CLIPPED + SUFFIX], (
        "leg (a) [M1]: the clipped command, not the whole one, rides in the "
        "line")


# --------------------------------------------------------------------------- #
# (b) [M2] zero, zero, zero and one                                            #
# --------------------------------------------------------------------------- #
def test_a_check_naming_no_test_path_prints_nothing(tmp_path, repo):
    assert _lines(tmp_path, repo, QUIET_PLAN, "quiet.md") == [], (
        "leg (b) [M2]: `- Check: %s` names no path under `tests/` or "
        "`fleet/tests/` — silent" % QUIET_COMMAND)


def test_a_minor_check_prints_nothing(tmp_path, repo):
    assert _lines(tmp_path, repo, MINOR_PLAN, "minor.md") == [], (
        "leg (b) [M2]: `- Check: %s (minor)` names `fleet/tests/` but ends "
        "`(minor)` — silent" % MINOR_COMMAND)


def test_a_plan_with_no_global_constraints_section_prints_nothing(
        tmp_path, repo):
    assert "## Global Constraints" not in NO_SECTION_PLAN
    assert _lines(tmp_path, repo, NO_SECTION_PLAN, "nosection.md") == [], (
        "leg (b) [M2]: a plan with no `## Global Constraints` section has no "
        "`Check:` to cost — silent")


def test_a_legacy_grammar_plan_prints_the_line(tmp_path, repo):
    assert "**Grammar:**" not in LEGACY_PLAN
    assert _lines(tmp_path, repo, LEGACY_PLAN, "legacy.md") == [
        _expected_line(LEGACY_COMMAND)], (
        "leg (b) [M2]: a `Check:` belongs to no grammar, so the same "
        "test-naming check prints its one line in a legacy-grammar plan too")


# --------------------------------------------------------------------------- #
# (c) [M3] the frozen `--check` channel                                        #
# --------------------------------------------------------------------------- #
def test_without_renders_the_two_check_plan_prints_no_check_cost_line(
        tmp_path, repo):
    # Not vacuous: the same plan under `--renders` prints both lines.
    assert _lines(tmp_path, repo, TWO_CHECK_PLAN, "two_renders.md") == [
        _expected_line(c) for c in TWO_COMMANDS]
    plan = _write(tmp_path, TWO_CHECK_PLAN, "two.md")
    bare = _check(plan)
    assert bare.returncode == 0, bare.stdout + bare.stderr
    assert bare.stdout.splitlines()[:1] == ["PLAN OK"]
    assert "check-cost" not in bare.stdout, (
        "leg (c) [M3]: the render rides behind `--renders`; `--check` alone "
        "prints no `check-cost` line. Got:\n" + bare.stdout)


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
    """leg (c) [M3]: the new render rides behind `--renders`, so the frozen
    `--check` channel is untouched — the assertion is
    `tests/test_compile_plan_proof_runs.py`'s frozen-sha comparison, imported
    and called."""
    base_compiler = _fixture_fn(proof_runs.base_compiler)(tmp_path_factory)
    proof_runs.test_every_run_less_fixture_plan_checks_byte_identically_to_base(
        base_compiler)


# --------------------------------------------------------------------------- #
# [M4] ultrawrite says so                                                      #
# --------------------------------------------------------------------------- #
def _joined(text):
    """`tr '\\n' ' '` — the wrap-joining the task's `Run:` greps do, so a
    sentence broken across lines still reads as one."""
    return text.replace("\n", " ")


def _section(name, until):
    """`sed -n '/^## <name>/,/^## <until>/p'` — the section from its heading
    through the next section's, inclusive."""
    lines = SKILL.read_text().splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith("## " + name))
    end = next(i for i, l in enumerate(lines[start + 1:], start + 1)
               if l.startswith("## " + until))
    return "\n".join(lines[start:end + 1])


def test_global_constraints_discipline_names_the_per_task_cost():
    """[M4]: the task's `Run:` grep over §Global Constraints discipline,
    wraps joined — both halves of the new sentence, in it."""
    body = _joined(_section("Global Constraints discipline", "Execution handoff"))
    assert re.search(r"paid by every task on every pass.*owning task's `Run:`",
                     body), (
        "[M4]: §Global Constraints discipline says a `Check:` that runs a sim "
        "is paid by every task on every pass and belongs in the owning task's "
        "`Run:`. Section read:\n" + body)


def test_the_species_list_names_the_seven_new_species_after_directory_absence_pin():
    """[M4]: the task's `Run:` grep over the whole skill, wraps joined — the
    seven new names in order after the last existing one."""
    assert re.search(
        r"`directory-absence-pin`, `pinned-elsewhere`, `check-cost`, "
        r"`prose-check`, `wide-files`, `wide-contract`, "
        r"`threshold-one-sided`, `disjunct-without-leg`",
        _joined(SKILL.read_text())), (
        "[M4]: the `ADVISORY proof-species:` sentence under §The proof gate "
        "names `pinned-elsewhere`, `check-cost`, `prose-check`, `wide-files`, "
        "`wide-contract`, `threshold-one-sided` and `disjunct-without-leg` "
        "after `directory-absence-pin`")


def test_the_skill_still_validates():
    """[M4]: the task's `Run:` skill validator — a Global Constraints `Check:`
    of this plan, and green at BASE, so it stays green after the edit."""
    p = subprocess.run([sys.executable, str(VALIDATE_SKILL),
                        "skills/ultrawrite"],
                       capture_output=True, text=True, cwd=str(ROOT))
    assert p.returncode == 0, (
        "[M4]: `skills/ultrawrite/SKILL.md` still validates. Got rc=%d\n%s%s"
        % (p.returncode, p.stdout, p.stderr))
