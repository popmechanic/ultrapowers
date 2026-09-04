"""The recurring rejection species print as `ADVISORY proof-species:` lines.

A render named `proof-species`, registered in `ADVISORY_RENDERS`, names the
four shapes the 2026-09-04 rejections kept turning on — a `;`-chained `Run:`,
a `leg (e)` written in prose, an unpinned default and an `every` checked as a
count floor — plus the duration bound with no wall-clock leg, all before a
reader is dispatched. This exam pins the four Machine clauses leg by leg:

  M1 / leg (a) — the render prints under `--check --renders` one line per hit,
    shaped `ADVISORY proof-species: <species> — task <id>[, leg <label>]:
    <detail>`, for claims-v1 tasks only (a legacy-grammar plan, and a task
    whose Machine line carries no numbered clause, print none); a two-task
    plan carrying one hit of each species prints exactly five lines, in the
    species order run-chained-semicolon, leg-named-in-prose, default-unpinned,
    universal-as-count-floor, duration-without-clock, and every line for task 1
    before any line for task 2.
  M2 / leg (b) — the five species, each a text property, each with its own
    detail: one plan per species, the species in task 1 and its repaired twin
    in task 2, yields exactly one line, naming task 1 and never task 2.
  M3 / leg (c) — each species is silent on its repaired twin and the render
    changes no exit code: the five-species plan still prints `PLAN OK` and
    exits 0.
  M4 / legs (c), (d) — without `--renders` nothing is printed, so every
    Run-less fixture plan's `--check` output stays byte-identical to BASE's
    compiler — `tests/test_compile_plan_proof_runs.py`'s leg (e) assertion,
    imported and re-run from here.

Every fixture plan below is a signed claims-v1 plan (spec §4.5: the compiler
refuses to compile one without its gate-verdict record), and `_lines` asserts
the fixture's own health — exit 0, `PLAN OK` — before reading the species
lines off it, so a broken fixture never reads as a missing species.
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
# leg (d) [M4]: the byte-identity assertion is that file's, re-run from here.
import test_compile_plan_proof_runs as proof_runs  # noqa: E402

HEADER = ("# Plan: The recurring rejection species\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

# The verbatim detail strings M2 pins, each quoted from the task's own words.
JOIN_ADVICE = "the exit status is the last command's — join with && or || exit 1"
PROSE_ADVICE = ('the parser splits at the next expected label — write '
                '"the previous leg"')
UNPINNED_DETAIL = "no citing leg pins it"
COUNT_FLOOR_DETAIL = "a universal cited only by a count floor"
NO_CLOCK_DETAIL = "a duration bound with no wall-clock leg"

# M1's line shape. `<species>` is the registered species name, `<id>` the task
# id, `<label>` present only for a leg species — the compiler's own
# "task %s, leg %s" idiom (clause_citation_violations), so the label rides
# parenthesised exactly as `parse_proof_legs` returns it.
SPECIES_PREFIX = "ADVISORY proof-species: "
SPECIES_LINE_RE = re.compile(
    r"^ADVISORY proof-species: (?P<species>[a-z][a-z0-9-]*) — "
    r"task (?P<task>[^,:]+)(?:, leg (?P<leg>[^:]+))?: (?P<detail>.+)$")


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
            "**Claim:** An operator sees the species named before any reader "
            "is dispatched. (quoted from #616)\n"
            "Machine: %s\n"
            "\n"
            "**Authorized-by:** #616\n"
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


def _parsed(lines):
    """(species, task id, leg label) per line, with M1's shape enforced."""
    out = []
    for line in lines:
        m = SPECIES_LINE_RE.match(line)
        assert m, ("[M1]: every line is shaped `ADVISORY proof-species: "
                   "<species> — task <id>[, leg <label>]: <detail>` "
                   "— got:\n" + line)
        out.append((m.group("species"), m.group("task"), m.group("leg")))
    return out


def _detail(line):
    return SPECIES_LINE_RE.match(line).group("detail")


# --------------------------------------------------------------------------- #
# The fixture plans                                                            #
# --------------------------------------------------------------------------- #
# Task 1 carries exactly one hit of each species; task 2 is its repaired twin,
# clause for clause and leg for leg. The `;` in task 1's Run: is unquoted; its
# leg (d) names leg (b) in prose (a BACK-reference, so `parse_proof_legs` — which
# splits only at the next EXPECTED label — still reads four legs); M2's default
# literal `4` appears in no citing leg; M3's universal is cited only by a count
# floor; M4's duration bound is cited by a leg naming no clock.
FIVE_MACHINE_1 = ("M1. The probe writes `out/report.json`. "
                  "M2. The retry budget defaults to `4`. "
                  "M3. Every row is counted. "
                  "M4. The probe waits ≤ 90 s.")
FIVE_MACHINE_2 = ("M1. The probe writes `out/summary.json`. "
                  "M2. The retry budget defaults to `4`. "
                  "M3. Every row is counted. "
                  "M4. The probe waits ≤ 90 s.")
CHAINED_RUN = "python3 scripts/probe.py; python3 scripts/collect.py"
JOINED_RUN = "python3 scripts/probe.py && python3 scripts/collect.py"

FIVE_SPECIES_PLAN = _plan(
    _task("1", FIVE_MACHINE_1,
          ["- Run: " + CHAINED_RUN,
           "- Legs: (a) the report file is written [M1]; (b) the budget is "
           "honoured [M2]; (c) at least 3 rows are counted [M3]; (d) the probe "
           "iterates 3 times, as in leg (b) [M4]."]),
    _task("2", FIVE_MACHINE_2,
          ["- Run: " + JOINED_RUN,
           "- Legs: (a) the summary file is written [M1]; (b) the budget is "
           "honoured at `4` [M2]; (c) exactly 3 rows are counted [M3]; (d) "
           "elapsed under 90 s, as in the previous leg [M4]."]))

# The five species in registration order, as leg (a) names them.
SPECIES_ORDER = ("run-chained-semicolon", "leg-named-in-prose",
                 "default-unpinned", "universal-as-count-floor",
                 "duration-without-clock")

# A legacy-grammar plan (no `**Grammar:**` line) whose one task's step carries
# every species' text: the render reads a task's `claims`, which a legacy task
# has none of.
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
    "- Create: `app/legacy.py`\n"
    "- Test: `tests/test_legacy.py`\n"
    "\n"
    "- [ ] **Step 1:** run `python3 scripts/probe.py; python3 "
    "scripts/collect.py`; the retry budget defaults to `4`; every row is "
    "counted; the probe waits ≤ 90 s, as in leg (b).\n")

# A claims-v1 task whose Machine line numbers no clause: `machine_clauses` is
# empty, which is M1's guard — the render treats it exactly as legacy, so even
# its `;`-chained Run: and its prose leg reference print nothing.
UNNUMBERED_PLAN = _plan(_task(
    "1",
    "The probe writes `out/report.json` and waits ≤ 90 s; the retry budget "
    "defaults to `4`; every row is counted.",
    ["- Run: " + CHAINED_RUN,
     "- The probe writes the report.",
     "- The count holds as in leg (b)."]))


def _twin_plan(machine_1, proof_1, machine_2, proof_2):
    """One species in task 1, its repaired twin in task 2."""
    return _plan(_task("1", machine_1, proof_1), _task("2", machine_2, proof_2))


TEST_1 = "- Test: `tests/test_probe_one.py`"
TEST_2 = "- Test: `tests/test_probe_two.py`"
WRITES_1 = "M1. The probe writes `out/report.json`."
WRITES_2 = "M1. The probe writes `out/summary.json`."

# (b) `- Run: a; b` versus `- Run: a && b` and `- Run: echo 'a; b'` — the
# quoted `;` (single- and double-quoted alike) is silent.
RUN_PLAN = _twin_plan(
    WRITES_1, ["- Run: a; b", "- Legs: (a) the report file is written [M1]."],
    WRITES_2, ["- Run: a && b",
               "- Run: echo 'a; b'",
               "- Run: python3 -c \"print(1); print(2)\"",
               "- Legs: (a) the summary file is written [M1]."])

# (b) a leg saying `as in leg (b)` versus one saying `as in the previous leg`.
PROSE_MACHINE = "M1. The probe writes `out/report.json`. M2. The rows are counted."
PROSE_PLAN = _twin_plan(
    PROSE_MACHINE,
    [TEST_1, "- Legs: (a) the report file is written [M1]; (b) the rows are "
             "counted [M2]; (c) the count holds as in leg (b) [M2]."],
    PROSE_MACHINE,
    [TEST_2, "- Legs: (a) the report file is written [M1]; (b) the rows are "
             "counted [M2]; (c) the count holds as in the previous leg [M2]."])

# (b) `M1. X defaults to `4`.` cited by a leg with no `4` versus one asserting `4`.
DEFAULT_MACHINE = "M1. The retry budget defaults to `4`."
DEFAULT_PLAN = _twin_plan(
    DEFAULT_MACHINE, [TEST_1, "- Legs: (a) the budget is honoured [M1]."],
    DEFAULT_MACHINE, [TEST_2, "- Legs: (a) the budget is honoured at `4` [M1]."])

# (b) `M1. every row is counted.` cited only by `at least 3 rows` versus
# `exactly 3 rows`.
UNIVERSAL_MACHINE = "M1. Every row is counted."
UNIVERSAL_PLAN = _twin_plan(
    UNIVERSAL_MACHINE, [TEST_1, "- Legs: (a) at least 3 rows are counted [M1]."],
    UNIVERSAL_MACHINE, [TEST_2, "- Legs: (a) exactly 3 rows are counted [M1]."])

# (b) `M1. waits ≤ 90 s.` cited by `iterates 3 times` versus `elapsed under 90 s`.
DURATION_MACHINE = "M1. The probe waits ≤ 90 s."
DURATION_PLAN = _twin_plan(
    DURATION_MACHINE, [TEST_1, "- Legs: (a) the probe iterates 3 times [M1]."],
    DURATION_MACHINE, [TEST_2, "- Legs: (a) elapsed under 90 s [M1]."])

# Task-major print order: task 1 carries only the LAST species in registration
# order, task 2 only the FIRST. Species-major order would print task 2's line
# first; task-major order is what leg (a) pins.
ORDER_PLAN = _plan(
    _task("1", DURATION_MACHINE,
          [TEST_1, "- Legs: (a) the probe iterates 3 times [M1]."]),
    _task("2", WRITES_2,
          ["- Run: a; b", "- Legs: (a) the summary file is written [M1]."]))

# A command longer than the 80 characters M2 clips the detail to.
LONG_RUN = ("python3 scripts/probe.py --emit-report out/report.json --verbose; "
            "python3 scripts/collect.py --emit-summary out/summary.json")
LONG_RUN_PLAN = _plan(_task(
    "1", WRITES_1,
    ["- Run: " + LONG_RUN, "- Legs: (a) the report file is written [M1]."]))


# --------------------------------------------------------------------------- #
# (a) [M1] the render, its registration, its line shape and its print order    #
# --------------------------------------------------------------------------- #
def test_the_render_is_registered_under_the_name_proof_species():
    assert ("proof-species", compile_plan._render_proof_species) in \
        compile_plan.ADVISORY_RENDERS, (
            "leg (a) [M1]: the render is `_render_proof_species` registered as "
            "`ADVISORY_RENDERS.append((\"proof-species\", "
            "_render_proof_species))` — registry holds %s"
            % [n for n, _ in compile_plan.ADVISORY_RENDERS])


def test_the_render_is_a_plain_fn_tasks_ctx_returning_advisory_lines(tmp_path, repo):
    """The registry contract: `fn(tasks, ctx) -> list[str]`, every line
    prefixed `ADVISORY ` — the same five lines the subprocess prints."""
    plan = _sign(_write(tmp_path, FIVE_SPECIES_PLAN))
    text = plan.read_text()
    tasks = [compile_plan.parse_task(t, raise_on_marker_error=False,
                                     grammar=compile_plan.plan_grammar(text),
                                     plan_claim=compile_plan.parse_plan_claim(text))
             for t in compile_plan.split_tasks(text)]
    ctx = {"base": repo, "plan_path": plan.resolve(), "tracked": set(),
           "task_ids": {t["id"] for t in tasks}, "exclude": ()}
    out = compile_plan._render_proof_species(tasks, ctx)
    assert isinstance(out, list) and all(isinstance(l, str) for l in out), out
    assert all(l.startswith("ADVISORY ") for l in out), (
        "leg (a) [M1]: every returned line starts with the literal `ADVISORY `")
    assert _parsed(out) == [(SPECIES_ORDER[0], "1", None),
                            (SPECIES_ORDER[1], "1", "(d)"),
                            (SPECIES_ORDER[2], "1", None),
                            (SPECIES_ORDER[3], "1", None),
                            (SPECIES_ORDER[4], "1", None)]


def test_five_species_plan_prints_one_line_per_hit_in_species_order(tmp_path, repo):
    lines = _lines(tmp_path, repo, FIVE_SPECIES_PLAN)
    assert _parsed(lines) == [(SPECIES_ORDER[0], "1", None),
                              (SPECIES_ORDER[1], "1", "(d)"),
                              (SPECIES_ORDER[2], "1", None),
                              (SPECIES_ORDER[3], "1", None),
                              (SPECIES_ORDER[4], "1", None)], (
        "leg (a) [M1]: exactly five lines — one per species hit in task 1, "
        "in the order %s, the leg species naming its leg label; task 2 is the "
        "repaired twin and draws none. Got:\n%s"
        % (", ".join(SPECIES_ORDER), "\n".join(lines)))


def test_no_proof_species_text_escapes_the_advisory_prefix(tmp_path, repo):
    """The render contract: nothing about the species reaches stdout except
    through a line that starts `ADVISORY `."""
    out = _rendered(tmp_path, repo, FIVE_SPECIES_PLAN)
    assert [l for l in out.splitlines() if "proof-species" in l] == _species(out)


def test_every_line_for_task_one_prints_before_any_line_for_task_two(tmp_path, repo):
    lines = _lines(tmp_path, repo, ORDER_PLAN)
    assert _parsed(lines) == [("duration-without-clock", "1", None),
                              ("run-chained-semicolon", "2", None)], (
        "leg (a) [M1]: print order is task-major — task 1's last-species "
        "hit prints before task 2's first-species hit. Got:\n"
        + "\n".join(lines))


def test_a_legacy_grammar_plan_prints_none(tmp_path, repo):
    plan = _write(tmp_path, LEGACY_PLAN)
    p = _check(plan, "--renders", "--base", str(repo))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        p.stdout + p.stderr)
    assert _species(p.stdout) == [], (
        "leg (a) [M1]: the species are a claims-v1 property; a legacy task "
        "carries no `claims`, so a legacy plan draws nothing even when its "
        "steps carry every species' text")


def test_a_claims_task_with_no_numbered_clause_prints_none(tmp_path, repo):
    assert _lines(tmp_path, repo, UNNUMBERED_PLAN) == [], (
        "leg (a) [M1]: an empty `machine_clauses` is the legacy guard — a "
        "task whose Machine line numbers no clause is silent, its `;`-chained "
        "`Run:` and its prose leg reference included")


# --------------------------------------------------------------------------- #
# (b) [M2] one plan per species: the hit in task 1, its repaired twin in 2     #
# --------------------------------------------------------------------------- #
def _one_hit(lines, species, leg=None):
    assert _parsed(lines) == [(species, "1", leg)], (
        "leg (b) [M2]: `%s` yields exactly one line, naming task 1%s; task 2 "
        "holds the repaired twin and draws none. Got:\n%s"
        % (species, " and leg %s" % leg if leg else "", "\n".join(lines)))
    return lines[0]


def test_run_chained_semicolon_fires_on_an_unquoted_semicolon_only(tmp_path, repo):
    lines = _lines(tmp_path, repo, RUN_PLAN)
    _one_hit(lines, "run-chained-semicolon")
    assert "task 2" not in "\n".join(lines), (
        "leg (b) [M2]: `a && b`, `echo 'a; b'` and `python3 -c \"print(1); "
        "print(2)\"` are silent — a `;` inside single or double quotes is "
        "not a chain")


def test_run_chained_semicolon_detail_names_the_command_and_the_join(tmp_path, repo):
    lines = _lines(tmp_path, repo, FIVE_SPECIES_PLAN)
    assert lines, "leg (b) [M2]: the chained `Run:` draws a line at all"
    detail = _detail(lines[0])
    assert len(CHAINED_RUN) <= 80
    assert CHAINED_RUN in detail, (
        "leg (b) [M2]: the detail carries the command's first 80 characters "
        "— this command is %d characters, so all of it. Got: %s"
        % (len(CHAINED_RUN), detail))
    assert JOIN_ADVICE in detail, (
        "leg (b) [M2]: the detail carries the verbatim advice `%s`. Got: %s"
        % (JOIN_ADVICE, detail))


def test_run_chained_semicolon_detail_clips_a_long_command(tmp_path, repo):
    line = _one_hit(_lines(tmp_path, repo, LONG_RUN_PLAN), "run-chained-semicolon")
    detail = _detail(line)
    assert len(LONG_RUN) > 80
    assert LONG_RUN[:60] in detail, (
        "leg (b) [M2]: the detail opens with the command. Got: %s" % detail)
    assert LONG_RUN not in detail, (
        "leg (b) [M2]: only the command's first 80 characters ride in the "
        "detail — this one is %d. Got: %s" % (len(LONG_RUN), detail))
    assert JOIN_ADVICE in detail


def test_leg_named_in_prose_fires_on_a_parenthesised_label_only(tmp_path, repo):
    _one_hit(_lines(tmp_path, repo, PROSE_PLAN), "leg-named-in-prose", "(c)")


def test_leg_named_in_prose_detail_names_the_label_and_the_split(tmp_path, repo):
    lines = _lines(tmp_path, repo, PROSE_PLAN)
    assert lines, "leg (b) [M2]: `as in leg (b)` draws a line at all"
    detail = _detail(lines[0])
    assert re.search(r"(?<![A-Za-z])b(?![A-Za-z])", detail), (
        "leg (b) [M2]: the detail names the label the prose reference points "
        "at — `b`. Got: " + detail)
    assert PROSE_ADVICE in detail, (
        "leg (b) [M2]: the detail carries the verbatim advice `%s`. Got: %s"
        % (PROSE_ADVICE, detail))


def test_default_unpinned_fires_when_no_citing_leg_holds_the_literal(tmp_path, repo):
    line = _one_hit(_lines(tmp_path, repo, DEFAULT_PLAN), "default-unpinned")
    detail = _detail(line)
    assert "4" in detail, (
        "leg (b) [M2]: the detail names the unpinned literal `4`. Got: " + detail)
    assert UNPINNED_DETAIL in detail, (
        "leg (b) [M2]: the detail carries the verbatim `%s`. Got: %s"
        % (UNPINNED_DETAIL, detail))


def test_universal_as_count_floor_fires_on_a_count_floor_only(tmp_path, repo):
    line = _one_hit(_lines(tmp_path, repo, UNIVERSAL_PLAN),
                    "universal-as-count-floor")
    assert line == ("ADVISORY proof-species: universal-as-count-floor — "
                    "task 1: " + COUNT_FLOOR_DETAIL), (
        "leg (b) [M2]: the whole line, detail included. Got: " + line)


def test_duration_without_clock_fires_when_no_citing_leg_names_a_clock(tmp_path, repo):
    line = _one_hit(_lines(tmp_path, repo, DURATION_PLAN),
                    "duration-without-clock")
    assert line == ("ADVISORY proof-species: duration-without-clock — "
                    "task 1: " + NO_CLOCK_DETAIL), (
        "leg (b) [M2]: the whole line, detail included. Got: " + line)


TWIN_PLANS = {
    "run-chained-semicolon": RUN_PLAN,
    "leg-named-in-prose": PROSE_PLAN,
    "default-unpinned": DEFAULT_PLAN,
    "universal-as-count-floor": UNIVERSAL_PLAN,
    "duration-without-clock": DURATION_PLAN,
}


@pytest.mark.parametrize("species", sorted(TWIN_PLANS))
def test_each_species_is_silent_on_its_repaired_twin(tmp_path, repo, species):
    """leg (b) [M2] / [M3]: exactly one line per plan, and no line names the
    repaired task."""
    lines = _lines(tmp_path, repo, TWIN_PLANS[species])
    assert [t for _, t, _ in _parsed(lines)] == ["1"], (
        "%s: the repaired twin in task 2 draws no line. Got:\n%s"
        % (species, "\n".join(lines)))


# --------------------------------------------------------------------------- #
# (c) [M3, M4] the verdict and the exit code are untouched                     #
# --------------------------------------------------------------------------- #
def test_the_five_species_plan_still_prints_plan_ok_and_exits_zero(tmp_path, repo):
    plan = _sign(_write(tmp_path, FIVE_SPECIES_PLAN))
    p = _check(plan, "--renders", "--base", str(repo))
    assert p.returncode == 0, p.stdout + p.stderr
    assert p.stdout.splitlines()[0] == "PLAN OK", (
        "leg (c) [M3]: an advisory render changes no verdict and no exit "
        "code — five species present, still `PLAN OK` and 0. Got:\n"
        + p.stdout)
    assert len(_species(p.stdout)) == 5


def test_without_renders_the_render_prints_nothing(tmp_path, repo):
    plan = _sign(_write(tmp_path, FIVE_SPECIES_PLAN))
    bare = _check(plan)
    assert bare.returncode == 0, bare.stdout + bare.stderr
    assert "proof-species" not in bare.stdout, (
        "leg (c) [M4]: the render rides behind `--renders`; `--check` alone "
        "prints no `proof-species:` line. Got:\n" + bare.stdout)
    assert bare.stdout.splitlines()[0] == "PLAN OK"


# --------------------------------------------------------------------------- #
# (d) [M4] the frozen `--check` channel: the BASE byte-identity assertion      #
# --------------------------------------------------------------------------- #
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
    """leg (d) [M4]: the new render rides behind `--renders`, so the frozen
    `--check` channel is untouched — the assertion is
    `tests/test_compile_plan_proof_runs.py`'s leg (e), imported and called."""
    base_compiler = _fixture_fn(proof_runs.base_compiler)(tmp_path_factory)
    proof_runs.test_every_run_less_fixture_plan_checks_byte_identically_to_base(
        base_compiler)
