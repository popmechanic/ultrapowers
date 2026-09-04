"""`- Check:` under Global Constraints is a command, not a sentence (task 1).

A `- Check: <command>` bullet inside the `## Global Constraints` section is
something the driver RUNS. This exam pins the four Machine clauses of that
grammar, leg by leg:

  M1 / leg (a) — a `^-\\s*Check:\\s*(.+)$` bullet (fence-aware, inside the
    section `parse_global_constraints` bounds) yields one entry
    `{"cmd": <command>, "minor": <bool>}` in a top-level `constraintChecks`
    list — in the compile result, the `--emit-launch` payload and the
    `--emit-args` payload, in section order. `cmd` is the value stripped and
    with a whole-value backtick wrapper removed (`_claims_run_command`'s rule);
    a trailing `(minor)` (case-insensitive, optional surrounding whitespace)
    sets `minor` true and is stripped from `cmd`; no section or no `Check:`
    bullet yields `[]` in all three. The Produces symbol is
    `parse_constraint_checks(text: str) -> list[dict]`.
  M2 / leg (b) — `globalConstraints` excludes every `- Check:` line the new
    parser claims and is otherwise the section body verbatim, so a plan
    carrying no `Check:` bullet compiles a `globalConstraints` value
    byte-identical to the BASE compiler's.
  M3 / leg (c) — a `Run:` or `Check:` whose stripped value still carries a
    backtick is refused in BOTH channels (`--check` exits 2, the full compile
    exits 1) with the exact `grammar:` line the clause spells; a WHOLLY
    backticked value is not refused and yields the unwrapped command.
  M4 / leg (d) — every fixture plan still compiles, and each one carrying no
    `Run:` bullet keeps `--check` output byte-identical to the BASE compiler's
    (the byte-identity assertion of `tests/test_compile_plan_proof_runs.py`
    re-run here, so a fixture that now differs names itself).

The BASE compiler is the blob at the frozen sha `tests/test_compile_plan_proof_runs.py`
pins — imported, never re-copied, and never `HEAD:` (a tautology once merged).
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
sys.path.insert(0, str(ROOT / "tests"))
import compile_plan  # noqa: E402
import test_compile_plan_proof_runs as _proof_runs_exam  # noqa: E402
from test_compile_plan_claims import (  # noqa: E402
    HEADER, PROOF, SLOTS, _sign, _task, _write,
)
from test_compile_plan_proof_runs import (  # noqa: E402,F401
    BASE_SHA, CORPUS, base_compiler,
)

# Leg (d)'s second half is leg (e) of the `Run:` exam, re-run against the same
# frozen BASE blob. Aliased to a private name so pytest collects it once, there.
_base_byte_identity = (
    _proof_runs_exam.test_every_run_less_fixture_plan_checks_byte_identically_to_base)


# ---------------------------------------------------------------------------
# Fixtures: a claims-v1 plan whose header carries a `## Global Constraints`
# section, assembled from the claims exam's own slot constants.
# ---------------------------------------------------------------------------

def _plan_with_section(body, *slots):
    """HEADER + a `## Global Constraints` section whose body is `body` + one
    well-formed claims-v1 task."""
    return (HEADER + "## Global Constraints\n\n" + body + "\n\n"
            + _task(*(slots or SLOTS)))


def _plan_without_section(*slots):
    return HEADER + _task(*(slots or SLOTS))


# The section leg (a) names, verbatim.
SECTION = ("- The suite is green.\n"
           "- Check: python3 -m pytest -q tests/test_x.py\n"
           "- Check: `! grep -rn golden fleet/` (minor)\n"
           "- Check:   test -e a.txt  (MINOR)\n"
           "- Naming: no shouting.")

# ... and the three entries it compiles to [M1].
EXPECTED_CHECKS = [
    {"cmd": "python3 -m pytest -q tests/test_x.py", "minor": False},
    {"cmd": "! grep -rn golden fleet/", "minor": True},
    {"cmd": "test -e a.txt", "minor": True},
]

# ... and what is left of the section body once the claimed lines are gone [M2].
EXPECTED_CONSTRAINTS = "- The suite is green.\n- Naming: no shouting."

PROSE_ONLY_SECTION = ("- The suite is green.\n"
                      "- Naming: no shouting.")

# A `- Check:` line inside a fence in the section: not an entry [M1, leg (a)],
# and — since the parser claims it for nothing — still part of the verbatim
# body [M2].
FENCED_SECTION = ("- The suite is green.\n"
                  "\n"
                  "```\n"
                  "- Check: echo fenced\n"
                  "```\n"
                  "\n"
                  "- Naming: no shouting.")

# The `--emit-args` top-level keys before this task (no `--run-dir`), plus the
# one key it adds.
BASE_ARGS_KEYS = {"waves", "wavesPath", "edges", "dependencyEdges", "acceptance",
                  "waveLabels", "globalConstraints", "planPath", "planClaim"}


def _run(plan, *extra):
    return subprocess.run([sys.executable, str(COMPILER), str(plan)] + list(extra),
                          capture_output=True, text=True, cwd=str(ROOT))


def _emit(tmp_path, plan_text, name="plan.md"):
    """Compile a signed plan with `--emit-launch --emit-args`; return the three
    payloads the key must ride in: (compile result on stdout, launch file, args
    file)."""
    plan = _sign(_write(tmp_path, plan_text, name))
    launch = tmp_path / (name + ".launch.json")
    argsf = tmp_path / (name + ".args.json")
    p = _run(plan, "--emit-launch", str(launch), "--emit-args", str(argsf))
    assert p.returncode == 0, (
        "expected a clean compile, got rc=%d:\n%s" % (p.returncode, p.stderr))
    return (json.loads(p.stdout), json.loads(launch.read_text()),
            json.loads(argsf.read_text()))


def _checks_of(payload, channel):
    """`constraintChecks` off one payload, with the absent-key failure named."""
    assert "constraintChecks" in payload, (
        "M1: the %s must carry a top-level `constraintChecks` list — found "
        "keys %s" % (channel, sorted(payload)))
    return payload["constraintChecks"]


def _all_three(tmp_path, plan_text, name="plan.md"):
    """The `constraintChecks` value in each of the three payloads."""
    result, launch, argsf = _emit(tmp_path, plan_text, name)
    return [_checks_of(result, "compile result"),
            _checks_of(launch, "--emit-launch payload"),
            _checks_of(argsf, "--emit-args payload")]


def _refuses_with_line(tmp_path, plan_text, line, name="plan.md"):
    """A refusal closes BOTH channels on the exact spec'd `grammar:` line: the
    full compile exits 1 with it on stderr, `--check` exits 2 with it as one of
    its violation lines. The plan is SIGNED, so nothing else can be the reason."""
    plan = _sign(_write(tmp_path, plan_text, name))
    run = _run(plan)
    assert run.returncode == 1, (
        "M3: the full compile must refuse with exit 1; got rc=%d\nstdout:\n%s"
        % (run.returncode, run.stdout[:400]))
    assert line in run.stderr.splitlines(), (
        "M3: stderr carries no line equal to\n  %r\nstderr was:\n%s"
        % (line, run.stderr))
    check = _run(plan, "--check")
    assert check.returncode == 2, (
        "M3: `--check` must refuse with exit 2; got rc=%d\n%s"
        % (check.returncode, check.stdout[:400]))
    assert line in check.stdout.splitlines(), (
        "M3: `--check` carries no line equal to\n  %r\nstdout was:\n%s"
        % (line, check.stdout))


def _proof_with(bullet):
    """The claims exam's Proof slot with one extra bullet beside its `Test:`."""
    return PROOF.replace("- Test: `tests/test_widget.py`",
                         "- Test: `tests/test_widget.py`\n" + bullet)


# ---------------------------------------------------------------------------
# (a) [M1] the entries: section order, cmd rewriting, the minor flag, []
# ---------------------------------------------------------------------------

def test_check_bullets_compile_to_constraint_checks_in_all_three_payloads(tmp_path):
    for channel, got in zip(("compile result", "--emit-launch payload",
                             "--emit-args payload"),
                            _all_three(tmp_path, _plan_with_section(SECTION))):
        assert got == EXPECTED_CHECKS, (
            "leg (a) [M1]: the %s must carry the three entries in section "
            "order — the bare command (`minor` false), the wholly backticked "
            "one with its wrapper stripped and `(minor)` honoured, and the "
            "whitespace-padded one with `(MINOR)` matched case-insensitively"
            % channel)


def test_a_plan_with_no_global_constraints_section_carries_the_empty_list(tmp_path):
    assert _all_three(tmp_path, _plan_without_section()) == [[], [], []], (
        "leg (a) [M1]: no section — `[]` in all three payloads")


def test_a_section_of_prose_bullets_only_carries_the_empty_list(tmp_path):
    assert _all_three(tmp_path, _plan_with_section(PROSE_ONLY_SECTION)) \
        == [[], [], []], (
        "leg (a) [M1]: a section whose bullets are prose names no check — "
        "`[]` in all three payloads")


def test_a_fenced_check_line_in_the_section_is_not_an_entry(tmp_path):
    assert _all_three(tmp_path, _plan_with_section(FENCED_SECTION)) \
        == [[], [], []], (
        "leg (a) [M1]: the scan is fence-aware — a `- Check:` line inside a "
        "fenced block in the section is not an entry")


def test_parse_constraint_checks_is_the_produced_symbol(tmp_path):
    parse = getattr(compile_plan, "parse_constraint_checks", None)
    assert parse is not None, (
        "M1 / Produces: `parse_constraint_checks(text: str) -> list[dict]` "
        "must exist beside `parse_global_constraints` in compile_plan")
    assert parse(_plan_with_section(SECTION)) == EXPECTED_CHECKS, (
        "leg (a) [M1]: the function walks the section's lines and returns the "
        "same entries the payloads carry")
    assert parse(_plan_without_section()) == [], (
        "leg (a) [M1]: `[]` for a plan with no section")
    assert parse(_plan_with_section(PROSE_ONLY_SECTION)) == [], (
        "leg (a) [M1]: `[]` for a section with no `Check:` bullet")
    assert parse(_plan_with_section(FENCED_SECTION)) == [], (
        "leg (a) [M1]: `[]` for a `Check:` line that is fenced")


def test_the_args_payload_gains_exactly_one_key(tmp_path):
    _, _, argsf = _emit(tmp_path, _plan_with_section(SECTION))
    assert set(argsf) == BASE_ARGS_KEYS | {"constraintChecks"}, (
        "[M1]: `constraintChecks` is THE new `--emit-args` top-level key — "
        "the others are exactly the ones the file carried before")


def test_the_check_channel_is_untouched_by_the_new_key(tmp_path):
    plan = _sign(_write(tmp_path, _plan_with_section(SECTION)))
    p = _run(plan, "--check")
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "[M1]: a plan carrying `- Check:` bullets is well-formed; the checks "
        "ride in the compile result, not in the `--check` channel — got:\n"
        + p.stdout)
    assert "constraintChecks" not in p.stdout, (
        "[M1]: `constraintChecks` rides in the compile result, never in the "
        "`--check` output")


# ---------------------------------------------------------------------------
# (b) [M2] globalConstraints drops the claimed lines and nothing else
# ---------------------------------------------------------------------------

def test_global_constraints_excludes_the_check_lines_and_is_otherwise_verbatim(tmp_path):
    result, launch, argsf = _emit(tmp_path, _plan_with_section(SECTION))
    assert argsf["globalConstraints"] == EXPECTED_CONSTRAINTS, (
        "leg (b) [M2]: the `--emit-args` `globalConstraints` is the section "
        "body with every `- Check:` line removed and the rest verbatim")
    assert result["globalConstraints"] == EXPECTED_CONSTRAINTS, (
        "leg (b) [M2]: the same string in the compile result")
    assert launch["globalConstraints"] == EXPECTED_CONSTRAINTS, (
        "leg (b) [M2]: the same string in the `--emit-launch` payload")


def test_a_fenced_check_line_stays_in_the_verbatim_body(tmp_path):
    result, _, _ = _emit(tmp_path, _plan_with_section(FENCED_SECTION))
    assert result["globalConstraints"] == FENCED_SECTION, (
        "leg (b) [M2]: `globalConstraints` drops the lines the new parser "
        "CLAIMS; a fenced `- Check:` line is claimed by nothing, so the body "
        "rides verbatim")


def _global_constraints(compiler, plan):
    """The `globalConstraints` value a compiler writes, or None when it refuses
    the plan."""
    p = subprocess.run([sys.executable, str(compiler), str(plan)],
                       capture_output=True, text=True, cwd=str(ROOT))
    if p.returncode != 0:
        return None
    return json.loads(p.stdout)["globalConstraints"]


FIXTURE_PLANS = sorted((ROOT / "tests/fixtures/plans").glob("*.md"))


def test_the_fixture_plan_corpus_is_not_empty():
    assert len(FIXTURE_PLANS) >= 6, (
        "leg (b) [M2]: the witnesses are the plans under "
        "tests/fixtures/plans/ — found only %d" % len(FIXTURE_PLANS))


def test_every_fixture_plans_global_constraints_equals_the_base_compilers(base_compiler):
    compared, differing, refused = [], [], []
    for plan in FIXTURE_PLANS:
        mine = _global_constraints(COMPILER, plan)
        theirs = _global_constraints(base_compiler, plan)
        if mine is None or theirs is None:
            # A document under the fixture directory that carries no tasks
            # (README.md, docket.md) is refused — by BOTH compilers, or the
            # refusal itself is the regression.
            refused.append((str(plan.relative_to(ROOT)),
                            mine is None, theirs is None))
            continue
        compared.append((plan, mine))
        if mine != theirs:
            differing.append(str(plan.relative_to(ROOT)))
    assert differing == [], (
        "leg (b) [M2]: a plan carrying no `- Check:` bullet must compile a "
        "`globalConstraints` value byte-identical to the BASE compiler's "
        "(%s); these differ: %s" % (BASE_SHA[:7], differing))
    assert [n for n, m, t in refused if m != t] == [], (
        "leg (b) [M2]: %s is refused by one compiler and not the other"
        % [n for n, m, t in refused if m != t])
    assert any(value for _, value in compared), (
        "leg (b) [M2]: the comparison is vacuous unless at least one compared "
        "plan carries a non-empty Global Constraints section — compared %d"
        % len(compared))


# ---------------------------------------------------------------------------
# (c) [M3] a backtick left in the command is a refusal in both channels
# ---------------------------------------------------------------------------

RUN_BACKTICKED = "grep -q '`x`' file"
CHECK_BACKTICKED = "echo `date`"

RUN_REFUSAL = ("grammar: Run: command carries a backtick — task 1: "
               + RUN_BACKTICKED[:80]
               + "; the driver's shell reads it as a command substitution "
                 "(run-74)")
CHECK_REFUSAL = ("grammar: Check: command carries a backtick — "
                 + CHECK_BACKTICKED[:80]
                 + "; the driver's shell reads it as a command substitution "
                   "(run-74)")


def test_a_run_command_carrying_a_backtick_is_refused_in_both_channels(tmp_path):
    plan_text = _plan_without_section(
        *SLOTS[:4], _proof_with("- Run: " + RUN_BACKTICKED), SLOTS[5])
    _refuses_with_line(tmp_path, plan_text, RUN_REFUSAL)


def test_a_check_command_carrying_a_backtick_is_refused_in_both_channels(tmp_path):
    plan_text = _plan_with_section("- Check: " + CHECK_BACKTICKED)
    _refuses_with_line(tmp_path, plan_text, CHECK_REFUSAL)


LONG_RUN = ("grep -q '`x`' " + "a/very/long/path/" * 5 + "file.txt")


def test_the_refusal_quotes_the_first_eighty_characters(tmp_path):
    assert len(LONG_RUN) > 80, "fixture must exceed the 80-character cut"
    plan_text = _plan_without_section(
        *SLOTS[:4], _proof_with("- Run: " + LONG_RUN), SLOTS[5])
    _refuses_with_line(
        tmp_path, plan_text,
        "grammar: Run: command carries a backtick — task 1: " + LONG_RUN[:80]
        + "; the driver's shell reads it as a command substitution (run-74)")


def test_a_wholly_backticked_run_and_check_are_not_refused(tmp_path):
    plan_text = _plan_with_section(
        "- Check: `test -e a`",
        *(SLOTS[:4] + (_proof_with("- Run: `node check.mjs`"), SLOTS[5])))
    result, launch, argsf = _emit(tmp_path, plan_text)
    assert _checks_of(result, "compile result") == [
        {"cmd": "test -e a", "minor": False}], (
        "leg (c) [M3]: a WHOLE-value backtick wrapper is stripped, not "
        "refused — the value carries no backtick once unwrapped")
    assert _checks_of(argsf, "--emit-args payload") == [
        {"cmd": "test -e a", "minor": False}]
    assert _checks_of(launch, "--emit-launch payload") == [
        {"cmd": "test -e a", "minor": False}]
    entries = [e for wave in result["launch_waves"] for e in wave]
    assert [e["proofRuns"] for e in entries] == [["node check.mjs"]], (
        "leg (c) [M3]: the wholly backticked `Run:` yields `node check.mjs` "
        "and draws no refusal")
    check = _run(_sign(_write(tmp_path, plan_text, "again.md")), "--check")
    assert (check.returncode, check.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "leg (c) [M3]: neither channel refuses a wholly backticked command; "
        "`--check` said:\n" + check.stdout)


# ---------------------------------------------------------------------------
# (d) [M4] the whole fixture corpus still compiles, and stays byte-identical
# ---------------------------------------------------------------------------

TASK_HEAD_RE = re.compile(r"^###\s+Task\s+\w+:", re.M)


def _compile_rc(compiler, plan):
    return subprocess.run([sys.executable, str(compiler), str(plan)],
                          capture_output=True, cwd=str(ROOT)).returncode


def test_every_corpus_plan_still_compiles(base_compiler):
    failed, task_less = [], []
    for plan in CORPUS:
        if not TASK_HEAD_RE.search(plan.read_text()):
            task_less.append(plan)
            continue
        rc = _compile_rc(COMPILER, plan)
        if rc != 0:
            failed.append((str(plan.relative_to(ROOT)), rc))
    assert failed == [], (
        "leg (d) [M4]: every fixture plan under evals/fixtures/*/plan.md and "
        "tests/fixtures/plans/*.md must still compile with exit 0; these did "
        "not: %s" % failed)
    # The corpus glob also catches two documents that carry no task heading
    # (tests/fixtures/plans/README.md, docket.md). They compile under neither
    # compiler — assert that explicitly rather than let the skip hide a change.
    for plan in task_less:
        mine, theirs = _compile_rc(COMPILER, plan), _compile_rc(base_compiler, plan)
        assert mine == theirs != 0, (
            "leg (d) [M4]: %s carries no task heading — it must be refused "
            "exactly as the BASE compiler refuses it (got %d, BASE %d)"
            % (plan.relative_to(ROOT), mine, theirs))


def test_every_run_less_corpus_plan_still_checks_byte_identically(base_compiler):
    # leg (d) [M4]: the `Run:` exam's frozen-sha byte-identity assertion,
    # re-run against this task's compiler, so a Check:-less fixture whose
    # `--check` output now differs names itself here.
    _base_byte_identity(base_compiler)
