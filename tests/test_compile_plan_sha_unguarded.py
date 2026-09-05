"""A proof that diffs or shows a sha is told to guard for its absence.

A `Run:` (or a Global Constraints `- Check:`) that reaches for a BASE sha with
`git diff`, `git show`, `git log` or `git cat-file` runs in a depth-1 clone that
does not hold that commit — so the leg dies on the fetch, not on the claim
(#572). A render named `sha-unguarded`, printed only under `--check --renders`,
names each such command before a reader is dispatched. This exam pins the four
Machine clauses, leg by leg:

  M1 / leg (a) — under `--check --renders`, each claims-v1 task `Run:` command
    carrying one of the four verbs followed — after any run of tokens beginning
    `-` — by an operand of one of the three shapes (7–40 hex, 7–40 hex then
    `:`, or leading `HEAD:`), and carrying neither `git cat-file -e` nor
    `git rev-parse --verify`, prints ONE line naming its FIRST such operand,
    equal to `ADVISORY sha-unguarded: task <id> Run: <command clipped to 80
    characters> — <operand>` + the verbatim tail, in which `<sha>` is those
    five literal characters.
  M2 / leg (b) — a `- Check:` bullet of the same shape prints the same line
    with `Check: <command clipped to 80 characters>` in place of
    `task <id> Run: <command clipped to 80 characters>`, in a claims-v1 plan
    and a legacy-grammar plan alike; a `Check:` ending `(minor)` prints none;
    `Run:` lines print in task order before `Check:` lines in section order.
  M3 / leg (c) — six shapes are silent, each once as a `Run:` and once as a
    `Check:`: a verb with no operand, a sha after a verb outside the four, 6
    hex, 41 hex, and the two guarded commands.
  M4 / leg (d) — without `--renders` nothing is printed, so the four-verb
    plan's bare `--check` is `PLAN OK` and 0 with no `sha-unguarded` line;
    every Run-less fixture plan's `--check` output stays byte-identical to the
    compiler at the frozen sha (`tests/test_compile_plan_proof_runs.py`'s
    assertion, imported and re-run from here); and
    `tests/test_compile_plan_proof_species.py` still passes.

Every claims-v1 fixture plan below is signed (spec §4.5: the compiler refuses
to compile one without its gate-verdict record), and `_rendered` asserts the
fixture's own health — exit 0, `PLAN OK` — before any `sha-unguarded` line is
read off it, so a broken fixture never reads as a missing advisory.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
SPECIES_EXAM = "tests/test_compile_plan_proof_species.py"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import compile_plan  # noqa: E402
# leg (d) [M4]: the frozen-sha byte-identity assertion is that file's, re-run here.
import test_compile_plan_proof_runs as proof_runs  # noqa: E402


# --------------------------------------------------------------------------- #
# The line M1 and M2 spell, in the task's own words                            #
# --------------------------------------------------------------------------- #
PREFIX = "ADVISORY sha-unguarded: "
# The tail after ` — <operand>`, verbatim. `<sha>` rides as those five literal
# characters — it is the advice's placeholder, not a substitution site.
TAIL = (" reaches for BASE, which a depth-1 clone does not hold; guard it in "
        "the same command with git cat-file -e <sha>^{commit} or git rev-parse "
        "--verify, and skip the leg when the guard fails")
CLIP = 80


def _expected_clip(command):
    """M1's `<command clipped to 80 characters>`, restated here rather than
    imported: whitespace collapsed, and a command longer than `CLIP` cut to
    `CLIP - 1` characters plus `…` — the compiler's own `_clip_run`."""
    s = " ".join(command.split())
    return s if len(s) <= CLIP else s[:CLIP - 1].rstrip() + "…"


def _run_line(task_id, command, operand):
    """M1's whole line for a task `Run:` command."""
    return "%stask %s Run: %s — %s%s" % (PREFIX, task_id,
                                         _expected_clip(command), operand, TAIL)


def _check_line(command, operand):
    """M2's whole line: `Check: <clipped>` in place of `task <id> Run:
    <clipped>`, everything else identical."""
    return "%sCheck: %s — %s%s" % (PREFIX, _expected_clip(command), operand,
                                   TAIL)


# --------------------------------------------------------------------------- #
# Fixture plans                                                                #
# --------------------------------------------------------------------------- #
HEADER = ("# Plan: A proof that reaches for a sha guards for its absence\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

# A prose bullet rides in every Global Constraints section: it is the other
# kind of bullet the section holds, and nothing runs it.
PROSE_BULLET = "- The suite is green."

MACHINE = "M1. The probe writes `out/report.json`."
LEGS = "- Legs: (a) the report file is written [M1]."


def _task(task_id, proof):
    """One claims-v1 task carrying all six slots; `proof` is the Proof-slot
    bullet lines (each without its trailing newline). Its Machine line NUMBERS
    its clause, so the render's claims-v1 read is live for every task here."""
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "- Create: `app/probe_%s.py`\n"
            "\n"
            "**Claim:** An operator sees the unguarded sha named before any "
            "reader is dispatched. (quoted from #572)\n"
            "Machine: %s\n"
            "\n"
            "**Authorized-by:** #572\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** The repo has no sha-unguarded render of its own yet, "
            "so no plan is read this way.\n"
            "\n"
            "**Proof:**\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #572\n"
            % (task_id, task_id, task_id, MACHINE, task_id,
               "".join(line + "\n" for line in proof)))


def _run_task(task_id, *commands):
    """A task whose Proof names `commands` as `Run:` bullets, in order."""
    return _task(task_id, ["- Run: " + c for c in commands] + [LEGS])


def _test_task(task_id):
    """A task whose Proof names an exam file and no command."""
    return _task(task_id, ["- Test: `tests/test_probe_%s.py`" % task_id, LEGS])


def _plan(*tasks, checks=()):
    """A claims-v1 plan; `checks` are `- Check:` bullet VALUES, in section
    order, and the section sits between the header and the first task."""
    section = ""
    if checks:
        section = ("## Global Constraints\n\n"
                   + "\n".join([PROSE_BULLET] + ["- Check: " + c
                                                 for c in checks])
                   + "\n\n")
    return HEADER + section + "\n".join(tasks)


def _legacy_plan(*checks):
    """A legacy-grammar plan: no `**Grammar:**` line, a `Depends-on:` marker
    and a checkbox step. A `Check:` belongs to no grammar."""
    return ("# Plan: Legacy\n"
            "\n"
            "**Acceptance:** waived — inline test plan\n"
            "\n"
            "## Global Constraints\n"
            "\n"
            + "\n".join([PROSE_BULLET] + ["- Check: " + c for c in checks])
            + "\n"
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


# --- leg (a) [M1] the witnesses ---------------------------------------------
FOUR_VERBS = ("git diff", "git show", "git log", "git cat-file")
SHA7 = "d6efce4"
SHA40 = "0a3559a2e0c9998553c0c725e5510e20e5802b1b"


def _verb_command(verb):
    return "%s --name-only %s -- fleet/x.mjs" % (verb, SHA7)


# The three operand shapes, each with the operand the line must name.
SHAPE_CASES = (
    ("git show " + SHA40, SHA40),                      # a bare 40-hex token
    ("git show %s:fleet/x.mjs" % SHA7, "%s:fleet/x.mjs" % SHA7),  # hex then `:`
    ("git show HEAD:fleet/x.mjs", "HEAD:fleet/x.mjs"),            # leading HEAD:
)

# Two flag tokens between the verb and the operand — `-1` and `--format=%H`.
FLAGS_COMMAND = "git log -1 --format=%H " + SHA7
# Two operands; only the FIRST is named.
TWO_OPERAND_COMMAND = "git diff %s 0a3559a" % SHA7
# Two Run: bullets on one task, in Proof order.
TWO_RUN_COMMANDS = ("git show " + SHA7, "git show 0a3559a")

# The clipping witnesses: exactly 100 characters each, no run of whitespace and
# no whitespace at index 78, so the clip is literally the first 79 characters
# plus `…`.
LONG_RUN = "git diff --name-only %s -- fleet/%s.mjs" % (SHA7, "x" * 58)
LONG_CHECK = "git diff --quiet %s -- fleet/%s.mjs" % (SHA7, "x" * 62)

# The four-verb plan leg (d) names: one task carrying all four commands.
FOUR_VERB_PLAN = _plan(_run_task("1", *[_verb_command(v) for v in FOUR_VERBS]))

# --- leg (b) [M2] the Check: witnesses --------------------------------------
QUIET_CHECK = "git diff --quiet %s -- fleet/x.mjs" % SHA7

# --- leg (c) [M3] the six silent shapes -------------------------------------
SILENT_COMMANDS = (
    # a verb of the four and no operand of any of the three shapes
    "git diff --quiet -- fleet/x.mjs",
    # the only sha-shaped token follows a verb outside the four
    'test "$(git hash-object fleet/x.mjs)" = ' + SHA40,
    # 6 hex — below the 7-character floor
    "git show abc123",
    # 41 hex — above the 40-character ceiling
    "git show " + SHA40 + "1",
    # guarded by the substring `git cat-file -e`
    "git cat-file -e %s^{commit} && git diff --name-only %s -- fleet/x.mjs "
    "|| true" % (SHA7, SHA7),
    # guarded by the substring `git rev-parse --verify`
    "git rev-parse --verify %s && git diff --name-only %s -- fleet/x.mjs "
    "|| true" % (SHA7, SHA7),
)


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
    compile_plan.verdicts_path(plan).write_text(json.dumps(record, indent=2)
                                                + "\n")
    return plan


def _write(tmp_path, text, name="plan.md"):
    p = tmp_path / name
    p.write_text(text)
    return _sign(p)


def _check(plan, *extra):
    return subprocess.run(
        [sys.executable, str(COMPILER), "--check", str(plan)] + list(extra),
        capture_output=True, text=True, cwd=str(ROOT))


def _sha_lines(stdout):
    return [l for l in stdout.splitlines() if l.startswith(PREFIX)]


def _rendered(tmp_path, repo, text, name="plan.md"):
    """`--check --renders` stdout for a fixture plan, with the fixture's own
    health asserted first so a broken fixture never reads as a missing line."""
    plan = _write(tmp_path, text, name)
    p = _check(plan, "--renders", "--base", str(repo))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "fixture plan %s must compile clean before its advisories are read; "
        "got rc=%d\n%s%s" % (name, p.returncode, p.stdout, p.stderr))
    return p.stdout


def _lines(tmp_path, repo, text, name="plan.md"):
    return _sha_lines(_rendered(tmp_path, repo, text, name))


# --------------------------------------------------------------------------- #
# (a) [M1] the four verbs, the three operand shapes, the whole line            #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("verb", FOUR_VERBS)
def test_each_of_the_four_verbs_prints_one_line_naming_its_operand(
        tmp_path, repo, verb):
    command = _verb_command(verb)
    assert _lines(tmp_path, repo, _plan(_run_task("1", command))) == [
        _run_line("1", command, SHA7)], (
        "leg (a) [M1]: `%s` is one of the four verbs, `%s` sits after a run of "
        "hyphen-leading tokens and is 7 hex, and the command carries neither "
        "`git cat-file -e` nor `git rev-parse --verify` — so exactly one line, "
        "equal to:\n%s" % (verb, SHA7, _run_line("1", command, SHA7)))


@pytest.mark.parametrize("command,operand", SHAPE_CASES)
def test_each_of_the_three_operand_shapes_is_named_in_full(
        tmp_path, repo, command, operand):
    assert _lines(tmp_path, repo, _plan(_run_task("1", command))) == [
        _run_line("1", command, operand)], (
        "leg (a) [M1]: the operand `%s` is named whole — a token of 7 to 40 "
        "characters from 0-9a-f, a token whose first 7 to 40 characters are "
        "from 0-9a-f and whose next character is a colon, or a token "
        "beginning `HEAD:`" % operand)


def test_flag_tokens_between_the_verb_and_the_operand_are_skipped(
        tmp_path, repo):
    assert _lines(tmp_path, repo, _plan(_run_task("1", FLAGS_COMMAND))) == [
        _run_line("1", FLAGS_COMMAND, SHA7)], (
        "leg (a) [M1]: `-1` and `--format=%H` both begin with a hyphen, so the "
        "operand is the first token after them — one line naming " + SHA7)


def test_a_command_with_two_operands_names_only_the_first(tmp_path, repo):
    assert _lines(tmp_path, repo,
                  _plan(_run_task("1", TWO_OPERAND_COMMAND))) == [
        _run_line("1", TWO_OPERAND_COMMAND, SHA7)], (
        "leg (a) [M1]: `%s` carries two sha-shaped operands and prints exactly "
        "one line, naming the FIRST such operand `%s`"
        % (TWO_OPERAND_COMMAND, SHA7))


def test_a_task_with_two_run_commands_prints_two_lines_in_proof_order(
        tmp_path, repo):
    plan = _plan(_run_task("1", *TWO_RUN_COMMANDS))
    assert _lines(tmp_path, repo, plan) == [
        _run_line("1", TWO_RUN_COMMANDS[0], SHA7),
        _run_line("1", TWO_RUN_COMMANDS[1], "0a3559a")], (
        "leg (a) [M1]: one line per such command — two `task 1 Run:` lines in "
        "Proof order, the `%s` line first" % SHA7)


def test_a_hundred_character_run_is_clipped_to_seventy_nine_plus_ellipsis(
        tmp_path, repo):
    assert len(LONG_RUN) == 100, "the clipping witness is 100 characters"
    clipped = _expected_clip(LONG_RUN)
    assert clipped == LONG_RUN[:79] + "…" and len(clipped) == CLIP, (
        "leg (a) [M1]: the clip is the first 79 characters plus `…`")
    line = _run_line("1", LONG_RUN, SHA7)
    assert _lines(tmp_path, repo, _plan(_run_task("1", LONG_RUN))) == [line], (
        "leg (a) [M1]: a `Run:` of 100 characters rides clipped, while the "
        "operand after ` — ` is named in full. Expected:\n" + line)
    assert LONG_RUN not in line, (
        "leg (a) [M1]: the whole 100-character command never reaches the line")


def test_no_sha_unguarded_text_escapes_the_advisory_prefix(tmp_path, repo):
    """The render contract: nothing about this species reaches stdout except
    through a line that starts `ADVISORY sha-unguarded: `."""
    out = _rendered(tmp_path, repo, FOUR_VERB_PLAN)
    assert [l for l in out.splitlines() if "sha-unguarded" in l] == \
        _sha_lines(out)


def test_the_render_is_registered_directly_after_check_cost():
    """The task's Context: its own render, `ADVISORY_RENDERS.append(("sha-
    unguarded", _render_sha_unguarded))` directly after the `check-cost`
    append — not a `proof-species` line, because a `Check:` belongs to no task
    and the species line shape names one."""
    names = [n for n, _ in compile_plan.ADVISORY_RENDERS]
    assert "sha-unguarded" in names, (
        "[M1]: the render registers itself under the name `sha-unguarded` — "
        "registry holds %s" % names)
    assert names[names.index("check-cost") + 1] == "sha-unguarded", (
        "[M1]: it is appended directly after `check-cost` — got %s" % names)
    assert ("sha-unguarded", compile_plan._render_sha_unguarded) in \
        compile_plan.ADVISORY_RENDERS, (
        "[M1]: the registered function is `_render_sha_unguarded`")


def test_the_render_is_a_plain_fn_tasks_ctx_returning_advisory_lines(
        tmp_path, repo):
    """The registry contract: `fn(tasks, ctx) -> list[str]`, every line
    prefixed `ADVISORY ` — the same four lines the subprocess prints."""
    plan = _write(tmp_path, FOUR_VERB_PLAN)
    text = plan.read_text()
    tasks = [compile_plan.parse_task(
        t, raise_on_marker_error=False,
        grammar=compile_plan.plan_grammar(text),
        plan_claim=compile_plan.parse_plan_claim(text))
        for t in compile_plan.split_tasks(text)]
    ctx = {"base": repo, "plan_path": plan.resolve(), "tracked": set(),
           "task_ids": {t["id"] for t in tasks}, "exclude": ()}
    out = compile_plan._render_sha_unguarded(tasks, ctx)
    assert isinstance(out, list) and all(isinstance(l, str) for l in out), out
    assert all(l.startswith("ADVISORY ") for l in out), (
        "[M1]: every returned line starts with the literal `ADVISORY `")
    assert out == [_run_line("1", _verb_command(v), SHA7) for v in FOUR_VERBS]


# --------------------------------------------------------------------------- #
# (b) [M2] the `Check:` line, both grammars, `(minor)`, and print order        #
# --------------------------------------------------------------------------- #
def test_a_claims_v1_check_prints_the_check_line(tmp_path, repo):
    plan = _plan(_test_task("1"), checks=[QUIET_CHECK])
    assert _lines(tmp_path, repo, plan) == [_check_line(QUIET_CHECK, SHA7)], (
        "leg (b) [M2]: a `- Check:` of the M1 shape prints the same line with "
        "`Check: <command clipped to 80 characters>` in place of `task <id> "
        "Run: <command clipped to 80 characters>`. Expected:\n"
        + _check_line(QUIET_CHECK, SHA7))


def test_a_legacy_grammar_check_prints_the_same_line(tmp_path, repo):
    plan = _legacy_plan(QUIET_CHECK)
    assert "**Grammar:**" not in plan
    assert "**Depends-on:** none" in plan and "- [ ] **Step 1:**" in plan
    assert _lines(tmp_path, repo, plan, "legacy.md") == [
        _check_line(QUIET_CHECK, SHA7)], (
        "leg (b) [M2]: a `Check:` belongs to no grammar — the same line in a "
        "legacy-grammar plan (no Grammar line, a Depends-on marker and a "
        "checkbox step)")


def test_a_minor_check_prints_nothing(tmp_path, repo):
    plan = _plan(_test_task("1"), checks=[QUIET_CHECK + " (minor)"])
    assert _lines(tmp_path, repo, plan, "minor.md") == [], (
        "leg (b) [M2]: the same `Check:` ending `(minor)` prints none")


def test_run_lines_print_in_task_order(tmp_path, repo):
    plan = _plan(_run_task("1", "git show 0a3559a"),
                 _run_task("2", "git show " + SHA7))
    assert _lines(tmp_path, repo, plan) == [
        _run_line("1", "git show 0a3559a", "0a3559a"),
        _run_line("2", "git show " + SHA7, SHA7)], (
        "leg (b) [M2]: exactly two lines, in task order — the `task 1 Run:` "
        "line first even though task 2's operand sorts first")


def test_check_lines_print_in_section_order(tmp_path, repo):
    checks = ["git show 0a3559a", "git show " + SHA7]
    plan = _plan(_test_task("1"), checks=checks)
    assert _lines(tmp_path, repo, plan) == [
        _check_line(checks[0], "0a3559a"),
        _check_line(checks[1], SHA7)], (
        "leg (b) [M2]: exactly two lines, in section order — the `0a3559a` "
        "line first")


def test_a_hundred_character_check_is_clipped_to_seventy_nine_plus_ellipsis(
        tmp_path, repo):
    assert len(LONG_CHECK) == 100, "the clipping witness is 100 characters"
    clipped = _expected_clip(LONG_CHECK)
    assert clipped == LONG_CHECK[:79] + "…" and len(clipped) == CLIP
    line = _check_line(LONG_CHECK, SHA7)
    plan = _plan(_test_task("1"), checks=[LONG_CHECK])
    assert _lines(tmp_path, repo, plan, "longcheck.md") == [line], (
        "leg (b) [M2]: a `Check:` of 100 characters rides clipped to its "
        "first 79 characters plus `…`. Expected:\n" + line)
    assert LONG_CHECK not in line


def test_run_lines_print_before_check_lines(tmp_path, repo):
    plan = _plan(_run_task("1", "git show " + SHA7), checks=[QUIET_CHECK])
    assert _lines(tmp_path, repo, plan) == [
        _run_line("1", "git show " + SHA7, SHA7),
        _check_line(QUIET_CHECK, SHA7)], (
        "leg (b) [M2]: exactly two lines — the `task 1 Run:` line before the "
        "`Check:` line")


# --------------------------------------------------------------------------- #
# (c) [M3] the six silent shapes, once as a `Run:` and once as a `Check:`      #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("command", SILENT_COMMANDS)
def test_a_silent_shape_as_a_run_prints_nothing(tmp_path, repo, command):
    assert _lines(tmp_path, repo, _plan(_run_task("1", command))) == [], (
        "leg (c) [M3]: `- Run: %s` draws no `sha-unguarded` line" % command)


@pytest.mark.parametrize("command", SILENT_COMMANDS)
def test_a_silent_shape_as_a_check_prints_nothing(tmp_path, repo, command):
    plan = _plan(_test_task("1"), checks=[command])
    assert _lines(tmp_path, repo, plan) == [], (
        "leg (c) [M3]: `- Check: %s` draws no `sha-unguarded` line" % command)


def test_the_silent_shapes_are_not_silent_by_accident(tmp_path, repo):
    """Non-vacuity: the two guarded commands differ from a firing one only by
    their guard, so their silence is the guard's doing and not a parse that
    missed the verb."""
    unguarded = "git diff --name-only %s -- fleet/x.mjs || true" % SHA7
    assert _lines(tmp_path, repo, _plan(_run_task("1", unguarded))) == [
        _run_line("1", unguarded, SHA7)], (
        "leg (c) [M3]: strip the `git cat-file -e` / `git rev-parse --verify` "
        "head off the guarded commands and the same tail fires")


# --------------------------------------------------------------------------- #
# (d) [M4] the frozen `--check` channel and the existing exams                 #
# --------------------------------------------------------------------------- #
def test_without_renders_the_four_verb_plan_prints_nothing(tmp_path, repo):
    # Not vacuous: the same plan under `--renders` prints all four lines.
    assert _lines(tmp_path, repo, FOUR_VERB_PLAN, "four_renders.md") == [
        _run_line("1", _verb_command(v), SHA7) for v in FOUR_VERBS]
    plan = _write(tmp_path, FOUR_VERB_PLAN, "four.md")
    bare = _check(plan)
    assert bare.returncode == 0, bare.stdout + bare.stderr
    assert bare.stdout.splitlines()[:1] == ["PLAN OK"], (
        "leg (d) [M4]: `--check` alone exits 0 with `PLAN OK` as its first "
        "line. Got:\n" + bare.stdout)
    assert "sha-unguarded" not in bare.stdout, (
        "leg (d) [M4]: the render rides behind `--renders`; `--check` alone "
        "prints no `sha-unguarded` line. Got:\n" + bare.stdout)


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
    `tests/test_compile_plan_proof_runs.py`'s frozen-sha comparison, imported
    and called."""
    base_compiler = _fixture_fn(proof_runs.base_compiler)(tmp_path_factory)
    proof_runs.test_every_run_less_fixture_plan_checks_byte_identically_to_base(
        base_compiler)


def test_the_five_species_exam_still_passes():
    """leg (d) [M4]: the five-species fixture's `Run:` commands carry no git
    verb, so this render is silent on it and that exam still prints exactly
    its five lines — run as its own pytest process."""
    p = subprocess.run([sys.executable, "-m", "pytest", "-q",
                        "-p", "no:cacheprovider", SPECIES_EXAM],
                       capture_output=True, text=True, cwd=str(ROOT))
    assert p.returncode == 0, (
        "leg (d) [M4]: `%s` still passes. Got rc=%d\n%s%s"
        % (SPECIES_EXAM, p.returncode, p.stdout, p.stderr))
