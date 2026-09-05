"""A prose constraint a command could decide prints as an `ADVISORY prose-check:` line.

A `## Global Constraints` prose bullet that names a script or a file and says it
is byte-identical, unchanged, unedited, or that it prints something / exits 0, is
a bullet the driver could have RUN. Left as prose it is only the referee's
attention lens, so it comes back as a per-task unverifiable finding and parks the
run on an ack. A render named `prose-check`, registered in `ADVISORY_RENDERS`,
says so under `--check --renders` before any reader is dispatched.

This exam pins the task's three testable Machine clauses, leg by leg:

  M1 / leg (a) — under `--check --renders`, every prose bullet under
    `## Global Constraints` (never a `- Check:` line) that names a backticked
    path or script (a backticked span carrying `/`, or ending `.py`, `.mjs`,
    `.sh`, `.ts`, `.js` or `.md`) AND carries one of the seven phrases
    (`byte-identical`, `unchanged from BASE`, `is not edited`, `are not edited`,
    `not changed`, `prints `, `exits 0`), with no `- Check:` in the same section
    naming that path, draws exactly one line — `ADVISORY prose-check:
    \\`## Global Constraints\\` says "<bullet, clipped to 90 characters>"` plus the
    verbatim advice tail. Seven bullets, one per phrase, draw seven lines in
    section order; a bare `validate_skill.py` (no slash, matched by its `.py`
    ending) draws one; a bullet wrapped over two lines is joined before matching,
    so a path on the first line and the phrase on the second still draw one; a
    bullet longer than 90 characters is quoted as its first 89 characters + `…`.
  M2 / leg (b) — silent when a `- Check:` in the section names the same path,
    when the bullet carries a path and no phrase, when it carries a phrase and no
    path, when it carries neither, when the bullet sits in a task's Context slot
    instead of the section, and when the plan has no section at all. A path named
    only by a task's Proof `Run:` is NOT a `- Check:` in the section, so that
    bullet still draws its line — the exclusion is by `Check:`, not by mention.
  M3 / leg (c) — the render rides behind `--renders`: `--check` alone prints no
    `prose-check` line, and the frozen `--check` channel is untouched — the
    byte-identity assertion of `tests/test_compile_plan_proof_runs.py` (its
    frozen-sha comparison), imported and re-run from here.

M4 (the §Global Constraints discipline sentence in `skills/ultrawrite/SKILL.md`)
is pinned by the task's own Proof `Run:` bullets — a `sed`/`grep` over that
section and the skill validator — not from this file.

Every fixture plan below is a signed claims-v1 plan (spec §4.5: the compiler
refuses to compile one without its gate-verdict record), and `_rendered` asserts
the fixture's own health — exit 0, `PLAN OK` — before reading any advisory line
off it, so a broken fixture can never read as a missing render.
"""
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_compile_plan_claims import _sign, _write  # noqa: E402
# leg (c) [M3]: the byte-identity assertion is that file's, re-run from here.
import test_compile_plan_proof_runs as proof_runs  # noqa: E402


# --------------------------------------------------------------------------- #
# The line M1 spells, split at the seam so the quoted bullet can be read back   #
# --------------------------------------------------------------------------- #
PREFIX = "ADVISORY prose-check: "
OPENING = PREFIX + '`## Global Constraints` says "'
# The advice tail, verbatim from M1 and from leg (a) — it opens with a space and
# an em dash, and a render whose tail differs by one character fails here.
TAIL = ('" \u2014 a command can decide this; write it as a Check: so the driver '
        "runs it, since a prose bullet is only the referee's lens and parks the "
        "run on an ack")
CLIP = 90


def _line(quoted):
    """The whole line M1 spells for a bullet quoted as `quoted`."""
    return OPENING + quoted + TAIL


def _quoted(line):
    """The bullet a `prose-check` line quotes, with M1's shape enforced."""
    assert line.startswith(OPENING) and line.endswith(TAIL), (
        "[M1]: every line is shaped `%s<bullet>%s` — got:\n%s"
        % (OPENING, TAIL, line))
    return line[len(OPENING):len(line) - len(TAIL)]


# --------------------------------------------------------------------------- #
# Fixture plans: a claims-v1 plan, optionally with a Global Constraints section #
# --------------------------------------------------------------------------- #
HEADER = ("# Plan: A prose constraint a command could decide\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

CONTEXT = ("**Context:** The compiler carries no prose-check render yet, so a\n"
           "constraints bullet a command could decide is read by nobody until a\n"
           "reviewer meets it as a lens.")

PROOF = ("**Proof:**\n"
         "- Test: `tests/test_probe.py`\n"
         "- Legs: (a) the render draws one line per bullet [M1].")

# The same Proof, plus a `Run:` naming the path leg (b) asks about. A `Run:` is
# a command the DRIVER runs for one task; it is not a `- Check:` in the section,
# so it must not silence the section's bullet.
PROOF_WITH_RUN = ("**Proof:**\n"
                  "- Test: `tests/test_probe.py`\n"
                  "- Run: node fleet/launch.mjs --dry-run\n"
                  "- Legs: (a) the render draws one line per bullet [M1].")


def _task(context=CONTEXT, proof=PROOF):
    return ("### Task 1: Sample\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "- Create: `app/probe.py`\n"
            "- Test: `tests/test_probe.py`\n"
            "\n"
            "**Claim:** An operator is told a prose constraint is a command "
            "before a reader is dispatched. (quoted from #632)\n"
            "Machine: M1. The render draws one line per decidable bullet.\n"
            "\n"
            "**Authorized-by:** #632\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe(n: int) -> str`\n"
            "\n"
            + context + "\n"
            "\n"
            + proof + "\n"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #632\n")


def _plan(section=None, context=CONTEXT, proof=PROOF):
    """HEADER, an optional `## Global Constraints` section whose body is
    `section`, and one well-formed claims-v1 task."""
    head = HEADER
    if section is not None:
        head += "## Global Constraints\n\n" + section + "\n\n"
    return head + _task(context, proof)


# The bullet leg (a) and leg (b) both turn on, and its text once the list marker
# is gone — what M1 quotes.
BYTE_IDENTICAL = "- `fleet/launch.mjs` is byte-identical to BASE."
BYTE_IDENTICAL_TEXT = "`fleet/launch.mjs` is byte-identical to BASE."

# One bullet per phrase M1 lists, in the clause's own order, each naming a
# distinct backticked path (`tests/fixtures/corpus.json` qualifies by its `/`
# alone — no code extension).
SEVEN_BULLETS = [
    "- `fleet/launch.mjs` is byte-identical to BASE.",
    "- `fleet/lib/drive.mjs` is unchanged from BASE.",
    "- `scripts/gate_check.py` is not edited.",
    "- The tables in `docs/notes.md` are not edited.",
    "- `tests/fixtures/corpus.json` is not changed.",
    "- `skills/probe/report.sh` prints `ready`.",
    "- `tools/verify.ts` exits 0 on a clean tree.",
]
SEVEN_TEXTS = [b[2:] for b in SEVEN_BULLETS]

# A bare script name: no slash at all, a path only by its `.py` ending.
BARE_SCRIPT = "- `validate_skill.py` prints `skill ok`."
BARE_SCRIPT_TEXT = BARE_SCRIPT[2:]

# One bullet over two lines: the path on the first, the phrase on the second.
# Matched only if the continuation line is joined to the bullet before matching.
WRAPPED = ("- `fleet/launch.mjs` and every module it loads at boot are\n"
           "  unchanged from BASE.")
WRAPPED_TEXT = ("`fleet/launch.mjs` and every module it loads at boot are "
                "unchanged from BASE.")

# A bullet past the 90-character clip.
LONG = ("- `fleet/launch.mjs` is byte-identical to BASE, and so is every helper "
        "module it imports at boot.")
LONG_TEXT = LONG[2:]


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


def _check(plan, *extra):
    return subprocess.run(
        [sys.executable, str(COMPILER), "--check", str(plan)] + list(extra),
        capture_output=True, text=True, cwd=str(ROOT))


def _rendered(tmp_path, repo, text, name="plan.md"):
    """`--check --renders` stdout for a signed fixture plan, with the fixture's
    own health asserted first so a broken fixture never reads as a missing
    advisory line."""
    plan = _sign(_write(tmp_path, text, name))
    p = _check(plan, "--renders", "--base", str(repo))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "fixture plan %s must compile clean before its advisories are read; "
        "got rc=%d\n%s%s" % (name, p.returncode, p.stdout, p.stderr))
    return p.stdout


def _lines(tmp_path, repo, text, name="plan.md"):
    return [l for l in _rendered(tmp_path, repo, text, name).splitlines()
            if l.startswith(PREFIX)]


# --------------------------------------------------------------------------- #
# (a) [M1] — the line, the seven phrases, the bare script, the wrap, the clip   #
# --------------------------------------------------------------------------- #
def test_a_byte_identical_bullet_draws_exactly_one_line_spelled_in_full(
        tmp_path, repo):
    """leg (a) [M1]: one bullet, one line — quoted text and advice tail whole."""
    lines = _lines(tmp_path, repo, _plan(BYTE_IDENTICAL))
    assert lines == [_line(BYTE_IDENTICAL_TEXT)], (
        "leg (a) [M1]: a `## Global Constraints` bullet naming "
        "`fleet/launch.mjs` and saying `byte-identical`, with no `- Check:` in "
        "the section, draws exactly one line — the bullet quoted, then the "
        "verbatim advice tail. Got:\n" + "\n".join(lines or ["<no line>"]))


def test_the_seven_phrases_each_draw_their_own_line_in_section_order(
        tmp_path, repo):
    """leg (a) [M1]: seven bullets, one per phrase, seven lines, in order."""
    assert all(len(t) <= CLIP for t in SEVEN_TEXTS), (
        "fixture guard: each of the seven bullets is short enough to be quoted "
        "whole, so this leg reads the phrase set and not the clip")
    lines = _lines(tmp_path, repo, _plan("\n".join(SEVEN_BULLETS)))
    assert [_quoted(l) for l in lines] == SEVEN_TEXTS, (
        "leg (a) [M1]: one bullet per phrase (`byte-identical`, `unchanged "
        "from BASE`, `is not edited`, `are not edited`, `not changed`, "
        "`prints `, `exits 0`), each naming a distinct backticked path, draws "
        "exactly seven lines in section order. Got %d:\n%s"
        % (len(lines), "\n".join(lines or ["<no line>"])))


def test_a_bare_script_name_is_a_path_by_its_extension(tmp_path, repo):
    """leg (a) [M1]: `validate_skill.py` has no `/`; its `.py` ending is enough."""
    lines = _lines(tmp_path, repo, _plan(BARE_SCRIPT))
    assert lines == [_line(BARE_SCRIPT_TEXT)], (
        "leg (a) [M1]: `- `validate_skill.py` prints `skill ok`.` names a "
        "script by its `.py` ending with no slash in sight, and carries the "
        "`prints ` phrase — one line. Got:\n"
        + "\n".join(lines or ["<no line>"]))


def test_a_bullet_wrapped_over_two_lines_is_joined_before_matching(
        tmp_path, repo):
    """leg (a) [M1]: path on line one, phrase on line two — still one bullet."""
    assert len(WRAPPED_TEXT) <= CLIP, (
        "fixture guard: the joined bullet is under the clip, so its quoted "
        "form is the whole joined text")
    lines = _lines(tmp_path, repo, _plan(WRAPPED))
    assert lines == [_line(WRAPPED_TEXT)], (
        "leg (a) [M1]: a bullet's continuation lines (lines starting no new "
        "`- `) join before matching, or the path and the phrase sit on "
        "different lines and neither is seen. Got:\n"
        + "\n".join(lines or ["<no line>"]))


def test_a_bullet_past_ninety_characters_is_clipped_to_eighty_nine_and_ellipsis(
        tmp_path, repo):
    """leg (a) [M1]: over 90 characters, the quote is 89 characters + `…`."""
    assert len(LONG_TEXT) > CLIP and not LONG_TEXT[:CLIP - 1].endswith(" "), (
        "fixture guard: the long bullet is past the clip and its 89th "
        "character is not a space, so the clip is unambiguous")
    lines = _lines(tmp_path, repo, _plan(LONG))
    assert len(lines) == 1, (
        "leg (a) [M1]: the long bullet draws one line. Got:\n"
        + "\n".join(lines or ["<no line>"]))
    assert _quoted(lines[0]) == LONG_TEXT[:CLIP - 1] + "\u2026", (
        "leg (a) [M1]: a bullet longer than 90 characters is quoted as its "
        "first 89 characters plus `…`. Got:\n" + _quoted(lines[0]))


# --------------------------------------------------------------------------- #
# (b) [M2] — where it is silent, and the one place it is not                    #
# --------------------------------------------------------------------------- #
def test_a_check_naming_the_same_path_silences_the_bullet(tmp_path, repo):
    """leg (b) [M2]: the section already runs it — the prose is its gloss."""
    section = (BYTE_IDENTICAL + "\n"
               '- Check: test "$(git hash-object fleet/launch.mjs)" = abc')
    lines = _lines(tmp_path, repo, _plan(section))
    assert lines == [], (
        "leg (b) [M2]: a `- Check:` command in the same section naming "
        "`fleet/launch.mjs` silences the bullet — the plans this session "
        "launched carry exactly this prose-above-its-Check shape. Got:\n"
        + "\n".join(lines))


def test_a_path_with_no_phrase_is_silent(tmp_path, repo):
    """leg (b) [M2]: `- `src/x.ts` is the entry point.` decides nothing."""
    lines = _lines(tmp_path, repo, _plan("- `src/x.ts` is the entry point."))
    assert lines == [], (
        "leg (b) [M2]: a bullet naming a path but carrying none of the seven "
        "phrases is an ordinary orienting sentence, not a command. Got:\n"
        + "\n".join(lines))


def test_a_phrase_with_no_path_is_silent(tmp_path, repo):
    """leg (b) [M2]: a phrase alone names nothing a command could read."""
    lines = _lines(tmp_path, repo,
                   _plan("- Nothing here is byte-identical by accident."))
    assert lines == [], (
        "leg (b) [M2]: `byte-identical` with no backticked path or script is "
        "a sentence about the work, with no argument to hand a command. "
        "Got:\n" + "\n".join(lines))


def test_an_ordinary_result_claim_is_silent(tmp_path, repo):
    """leg (b) [M2]: neither a path nor a phrase."""
    lines = _lines(tmp_path, repo, _plan("- Every new module has a test."))
    assert lines == [], (
        "leg (b) [M2]: an ordinary result claim carries no path and no "
        "phrase, and draws nothing. Got:\n" + "\n".join(lines))


def test_the_bullet_in_a_task_context_slot_is_silent(tmp_path, repo):
    """leg (b) [M2]: the render reads the section, not a task's prose."""
    context = "**Context:** " + BYTE_IDENTICAL_TEXT + " That is the whole of\n" \
              "what the boot path guarantees today."
    plan = _plan("- Every new module has a test.", context=context)
    lines = _lines(tmp_path, repo, plan)
    assert lines == [], (
        "leg (b) [M2]: the same sentence in a task's Context slot is not a "
        "Global Constraints bullet — the render reads only the section, and "
        "the section here says nothing decidable. Got:\n" + "\n".join(lines))


def test_a_path_named_only_by_a_proof_run_does_not_silence_the_bullet(
        tmp_path, repo):
    """leg (b) [M2]: the exclusion is a `- Check:` in the section, nothing else."""
    plan = _plan(BYTE_IDENTICAL, proof=PROOF_WITH_RUN)
    assert "fleet/launch.mjs" in PROOF_WITH_RUN and "- Check:" not in plan, (
        "fixture guard: the path is named by a task's Proof `Run:` and by no "
        "`- Check:` anywhere in the plan")
    lines = _lines(tmp_path, repo, plan)
    assert lines == [_line(BYTE_IDENTICAL_TEXT)], (
        "leg (b) [M2]: a task's Proof `Run:` naming `fleet/launch.mjs` runs "
        "for that one task, not for the section — only a `- Check:` in the "
        "section silences the bullet, so the line still prints. Got:\n"
        + "\n".join(lines or ["<no line>"]))


def test_a_plan_with_no_global_constraints_section_is_silent(tmp_path, repo):
    """leg (b) [M2]: no section, nothing to read."""
    plan = _plan(None)
    assert "## Global Constraints" not in plan, (
        "fixture guard: this plan carries no section at all")
    lines = _lines(tmp_path, repo, plan)
    assert lines == [], (
        "leg (b) [M2]: a plan with no `## Global Constraints` section draws "
        "no line. Got:\n" + "\n".join(lines))


# --------------------------------------------------------------------------- #
# (c) [M3] — the render rides behind `--renders`; the check channel is frozen   #
# --------------------------------------------------------------------------- #
def test_without_renders_the_render_prints_nothing(tmp_path, repo):
    """leg (c) [M3]: `--check` alone prints no `prose-check` line."""
    plan = _sign(_write(tmp_path, _plan(BYTE_IDENTICAL)))
    bare = _check(plan)
    assert bare.returncode == 0, bare.stdout + bare.stderr
    assert bare.stdout.splitlines()[:1] == ["PLAN OK"], bare.stdout
    assert "prose-check" not in bare.stdout, (
        "leg (c) [M3]: the render rides behind `--renders`; `--check` alone "
        "prints no `prose-check` line. Got:\n" + bare.stdout)


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
    """leg (c) [M3]: the new render rides behind `--renders`, so every Run-less
    fixture plan's `--check` output stays byte-identical to the compiler at the
    frozen sha — the assertion is
    `tests/test_compile_plan_proof_runs.py`'s frozen-sha comparison, imported
    and called."""
    base_compiler = _fixture_fn(proof_runs.base_compiler)(tmp_path_factory)
    proof_runs.test_every_run_less_fixture_plan_checks_byte_identically_to_base(
        base_compiler)
