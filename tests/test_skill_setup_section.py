"""The skill's setup path: the agent fixes, the human consents.

The claim under test (#598): *first use runs the doctor; every red row is fixed
by the agent, in order, with a one-line explanation; the run launches when
green.* This file is a lint over `skills/ultrapowers/SKILL.md` — over the
`## Setup` section as a region of text, and over the `## Client` section's first
step — checking the shape the claim needs rather than the wording it happens to
have:

  * every question the setup path poses is an AskUserQuestion, so a bare prose
    question ("which repo do you want?") is a failure and the same sentence
    posed through AskUserQuestion is not [M1];
  * the agent runs the commands. The five commands the section is built from
    are named, the retired offer-it-to-the-human form (`! node`, `! ssh`,
    "you run", "in your terminal") is gone, and each of the three human steps —
    the exe.dev signup, the GitHub app approval, the claude.ai approval — is
    followed by an AskUserQuestion carrying a recommended next step [M2];
  * the loop closes: the doctor is re-run after each fix and the row that
    turned `ok` is read back, the launch happens on `ready`, and the client's
    step 1 falls into the setup path inline instead of stopping [M3];
  * the frontmatter admits AskUserQuestion, the retired vocabulary of the
    pre-lift fleet is absent, and the four things `test_docs_agree_with_code.py`
    already pins about this file — the launch line's flags, the walk, the VM
    name shape, `validate_skill.py` — still hold [M4].

The lint over questions is exercised against its own fixtures below, so a
regex that stopped matching anything cannot pass this file silently.

Offline: reads one committed file and runs one local Python script.
"""
import pathlib
import re
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"


def skill_text():
    assert SKILL.is_file(), f"{SKILL} not found"
    return SKILL.read_text(encoding="utf-8")


# ── reading a section out of the page ────────────────────────────────────────

def section_lines(heading):
    """The lines of the `## <heading>` section, heading included, up to the
    next `## `."""
    lines = skill_text().splitlines()
    starts = [i for i, line in enumerate(lines) if line.strip() == f"## {heading}"]
    assert len(starts) == 1, (
        f"expected exactly one `## {heading}` heading in {SKILL}, found {len(starts)}"
    )
    start = starts[0]
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("## "):
            return lines[start:i]
    return lines[start:]


def setup_lines():
    return section_lines("Setup")


def setup_text():
    return "\n".join(setup_lines())


def client_step_one():
    """The `## Client` section's first numbered step, up to step 2."""
    lines = section_lines("Client")
    starts = [i for i, line in enumerate(lines) if re.match(r"^1\.\s", line)]
    assert starts, (
        "the `## Client` section has no `1. ` step to read — step 1 is where the "
        "doctor's verdict is acted on [M3]"
    )
    start = starts[0]
    for i in range(start + 1, len(lines)):
        if re.match(r"^\d+\.\s", lines[i]):
            return lines[start:i]
    return lines[start:]


def test_the_sections_this_file_lints_are_readable():
    """An empty read would satisfy every pin below without checking anything."""
    assert len(setup_lines()) > 5, (
        f"the `## Setup` section of {SKILL} is empty or nearly so: {setup_lines()!r}"
    )
    assert len(client_step_one()) >= 1, "the `## Client` section's step 1 is empty"


# ── (a) every question is an AskUserQuestion [M1] ────────────────────────────

RULE_SENTENCE = (
    "The setup agent uses AskUserQuestion wherever a question can be posed as choices."
)
ASK = "AskUserQuestion"
FENCE_RE = re.compile(r"^\s*```")


def prose_questions(lines):
    """The lines that pose a question outside a fenced block without posing it
    through AskUserQuestion. This is the lint; the fixtures below pin it."""
    found, fenced = [], False
    for line in lines:
        if FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced:
            continue
        if "?" in line and ASK not in line:
            found.append(line)
    return found


# The fixtures: the same lint over a three-line section. The first poses its
# question as prose and must fail; the second poses the same question through
# AskUserQuestion and must pass; the third hides a `?` in a fenced command,
# which is a command and not a question.
FIXTURE_PROSE = [
    "## Setup",
    "",
    "Ask the user: which repo do you want?",
]
FIXTURE_ASK = [
    "## Setup",
    "",
    "Ask with AskUserQuestion: which repo do you want? — this one (Recommended) / another",
]
FIXTURE_FENCED = [
    "## Setup",
    "",
    "```bash",
    "curl 'https://example.invalid/x?y=1'",
    "```",
]


def test_the_question_lint_fails_a_bare_prose_question():
    """The fixture leg of (a): a section with one bare prose question fails."""
    assert prose_questions(FIXTURE_PROSE) == [FIXTURE_PROSE[2]], (
        "the question lint did not flag a bare prose question — it would pass "
        "any section, so the pin on SKILL.md below would be vacuous [M1]"
    )


def test_the_question_lint_passes_an_askuserquestion_line_and_skips_fences():
    assert prose_questions(FIXTURE_ASK) == [], (
        "the question lint flagged a question posed through AskUserQuestion; it "
        "is meant to flag prose questions only [M1]"
    )
    assert prose_questions(FIXTURE_FENCED) == [], (
        "the question lint flagged a `?` inside a fenced block; fenced blocks are "
        "commands, not questions [M1]"
    )


def test_setup_states_the_askuserquestion_rule_verbatim():
    """(a) [M1] — the rule sentence, as the task words it."""
    assert RULE_SENTENCE in setup_text(), (
        f"the `## Setup` section does not contain, verbatim:\n  {RULE_SENTENCE}"
    )


def test_setup_names_askuserquestion_at_least_four_times():
    """(a) [M1] — the rule plus the questions it governs."""
    count = setup_text().count(ASK)
    assert count >= 4, (
        f"the `## Setup` section names {ASK} {count} time(s); the setup path poses "
        "the exe.dev, claude.ai and GitHub app consents plus the rule sentence, so "
        "at least 4 are expected"
    )


def test_every_question_in_setup_is_an_askuserquestion():
    """(a) [M1] — a `?` outside a fence with no AskUserQuestion is prose."""
    offenders = prose_questions(setup_lines())
    assert not offenders, (
        f"the `## Setup` section poses {len(offenders)} question(s) as prose "
        f"rather than through {ASK}:\n" + "\n".join("  " + o for o in offenders)
    )


# ── (b) the agent runs the commands; the human consents [M2] ─────────────────

RUNS_SENTENCE = "The agent runs every command in this section itself."

# The retired offer-it-to-the-human form. `! <command>` was the harness's
# "here, you type this"; the setup path runs the command itself now.
OFFER_FORMS = ("you run", "in your terminal", "! node", "! ssh")

# The five commands the setup path is built from, exactly as the task names them.
COMMANDS = (
    "node <plugin-root>/fleet/doctor.mjs --json",
    "node <plugin-root>/fleet/claude-token.mjs login --code-from-clipboard",
    "node <plugin-root>/fleet/target.mjs <owner>/<repo>",
    "ssh exe.dev integrations setup github",
    'ssh exe.dev "integrations detach <name> tag:fleet"',
)

# The three steps only a human can take, and the question that follows each.
HUMAN_STEPS = ("exe.dev", "GitHub app", "claude.ai")
CONSENT_QUESTION = "Done in the browser?"
RECOMMENDED = "Recommended"


def test_setup_says_the_agent_runs_the_commands():
    """(b) [M2] — the sentence, verbatim."""
    assert RUNS_SENTENCE in setup_text(), (
        f"the `## Setup` section does not contain, verbatim:\n  {RUNS_SENTENCE}"
    )


@pytest.mark.parametrize("form", OFFER_FORMS)
def test_setup_never_offers_a_command_to_the_human(form):
    """(b) [M2] — the retired offer-it-to-the-human form is gone."""
    offenders = [line for line in setup_lines() if form in line]
    assert not offenders, (
        f"the `## Setup` section still hands a command to the human with "
        f"`{form}`:\n" + "\n".join("  " + o for o in offenders)
    )


@pytest.mark.parametrize("command", COMMANDS, ids=lambda c: c.split()[0] + ":" + c.split()[1])
def test_setup_names_each_of_the_agents_commands(command):
    """(b) [M2] — any one of the five absent fails the leg."""
    assert command in setup_text(), (
        f"the `## Setup` section does not name the command `{command}`"
    )


@pytest.mark.parametrize("marker", HUMAN_STEPS)
def test_setup_names_each_human_step(marker):
    """(b) [M2] — the three steps only a human can take."""
    assert marker in setup_text(), (
        f"the `## Setup` section never names the human step `{marker}`"
    )


def first_ask_after(marker):
    """(index, line) of the first AskUserQuestion line at or after the first
    occurrence of `marker` in the `## Setup` section."""
    lines = setup_lines()
    start = next((i for i, line in enumerate(lines) if marker in line), None)
    assert start is not None, f"`{marker}` does not occur in the `## Setup` section [M2]"
    for i in range(start, len(lines)):
        if ASK in lines[i]:
            return i, lines[i]
    return None, None


@pytest.mark.parametrize("marker", HUMAN_STEPS)
def test_each_human_step_is_followed_by_a_recommended_question(marker):
    """(b) [M2] — a marker with no question after it, or a question lacking
    `Recommended`, fails the leg."""
    index, line = first_ask_after(marker)
    assert index is not None, (
        f"nothing after the human step `{marker}` poses an {ASK}; the human acts "
        "in the browser and the agent waits on their answer"
    )
    assert CONSENT_QUESTION in line, (
        f"the first {ASK} after the human step `{marker}` does not ask "
        f"`{CONSENT_QUESTION}`:\n  {line}"
    )
    assert RECOMMENDED in line, (
        f"the first {ASK} after the human step `{marker}` carries no "
        f"`{RECOMMENDED}` option — the recommended option is the next step:\n  {line}"
    )


def test_the_three_human_steps_have_three_distinct_questions():
    """(b) [M2] — one question per consent, not one question read three ways."""
    indexes = {marker: first_ask_after(marker)[0] for marker in HUMAN_STEPS}
    assert len(set(indexes.values())) == 3, (
        "the three human steps do not resolve to three distinct AskUserQuestion "
        f"lines; line indexes within the section: {indexes!r}"
    )


# ── (c) the loop closes and the client falls in inline [M3] ──────────────────

PARAGRAPH_TOKENS = (
    "after each fix",   # the re-run
    r"\bdoctor\b",      # what is re-run
    r"\bturned\b",      # the row that changed
    r"\bok\b",          # what it turned to
    r"\bread\b",        # and it is read back
)


def setup_paragraphs():
    return [p for p in re.split(r"\n\s*\n", setup_text()) if p.strip()]


def test_setup_describes_the_per_fix_doctor_loop():
    """(c) [M3] — one paragraph carries the whole loop, not five scattered words."""
    for paragraph in setup_paragraphs():
        if all(re.search(token, paragraph, re.I) for token in PARAGRAPH_TOKENS):
            return
    pytest.fail(
        "no paragraph of the `## Setup` section says the doctor is re-run after "
        "each fix and the row that turned `ok` is read back — looked for all of "
        + ", ".join(repr(t) for t in PARAGRAPH_TOKENS)
        + " in one paragraph"
    )


LAUNCH_WORD_RE = re.compile(r"\blaunch", re.I)
READY_WORD_RE = re.compile(r"\bready\b", re.I)


def test_setup_launches_on_a_ready_verdict():
    """(c) [M3] — the run launches when the verdict is `ready`."""
    hits = [
        line for line in setup_lines()
        if LAUNCH_WORD_RE.search(line) and READY_WORD_RE.search(line)
    ]
    assert hits, (
        "no line of the `## Setup` section ties the launch to a `ready` verdict"
    )


STOP_WORD_RE = re.compile(r"\bstop\b", re.I)


def test_client_step_one_falls_into_setup_inline():
    """(c) [M3] — on a verdict other than `ready`, the client runs the setup
    path inline in the same turn, and never says to stop."""
    step = client_step_one()
    text = "\n".join(step)
    assert "inline" in text, (
        "the `## Client` section's step 1 does not say the setup path is run "
        "`inline`; a not-ready verdict has to be repaired in the same turn"
    )
    assert "fleet/doctor.mjs" in text, (
        "the `## Client` section's step 1 does not name `fleet/doctor.mjs` — the "
        "verdict it acts on is the doctor's"
    )
    offenders = [line for line in step if STOP_WORD_RE.search(line)]
    assert not offenders, (
        "the `## Client` section's step 1 still tells the agent to stop:\n"
        + "\n".join("  " + o for o in offenders)
    )


# ── (d) frontmatter, vocabulary, and the pins already on this file [M4] ──────

FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.S)
ALLOWED_TOOLS_RE = re.compile(r"^allowed-tools:\s*(.+)$", re.M)


def allowed_tools():
    frontmatter = FRONTMATTER_RE.match(skill_text())
    assert frontmatter, f"{SKILL} has no `---`-delimited frontmatter"
    match = ALLOWED_TOOLS_RE.search(frontmatter.group(1))
    assert match, f"{SKILL}'s frontmatter has no `allowed-tools:` line"
    return match.group(1).strip()


def test_frontmatter_allows_askuserquestion():
    """(d) [M4] — the tool the setup path is built on is admitted."""
    value = allowed_tools()
    assert ASK in value, (
        f"{SKILL}'s `allowed-tools` does not list {ASK}: {value!r}"
    )


# Names the setup path no longer routes through: the run's plan, code and
# evidence live on the target's branches, and the walk is the skill's own
# reference — not a fleet-runs repo, a golden VM, or fleet/RUNBOOK.md.
RETIRED_NAMES = ("fleet-runs", "golden", "RUNBOOK")


@pytest.mark.parametrize("name", RETIRED_NAMES)
def test_the_skill_names_no_retired_mechanism(name):
    """(d) [M4]."""
    text = skill_text()
    hits = [line for line in text.splitlines() if name in line]
    assert not hits, (
        f"{SKILL} still names `{name}`:\n" + "\n".join("  " + h for h in hits)
    )


def test_the_skill_still_routes_a_red_row_to_the_walk():
    """(d) [M4] — the walk survives the rewrite."""
    assert "references/first-run.md" in skill_text(), (
        f"{SKILL} no longer routes a red doctor row to `references/first-run.md`"
    )


LAUNCH_LINE_RE = re.compile(r"node .*fleet/launch\.mjs")
FLAG_RE = re.compile(r"(?<![\w-])--([A-Za-z][A-Za-z0-9-]*)")


def test_exactly_one_launch_line_carrying_target_and_base_only():
    """(d) [M4] — the launch line and its flag vocabulary survive the rewrite."""
    lines = [line for line in skill_text().splitlines() if LAUNCH_LINE_RE.search(line)]
    assert len(lines) == 1, (
        f"expected exactly one `node …fleet/launch.mjs` line in {SKILL}, found "
        f"{len(lines)}: {lines!r}"
    )
    flags = {"--" + name for name in FLAG_RE.findall(lines[0])}
    assert flags == {"--target", "--base"}, (
        "the launch line's flags are not `--target` and `--base` only: "
        f"{sorted(flags)!r}\n  {lines[0].strip()}"
    )


VM_NAME_RE = re.compile(r"fleet-r<N>-")


def test_the_skill_still_shows_the_vm_name_shape():
    """(d) [M4]."""
    assert VM_NAME_RE.search(skill_text()), (
        f"{SKILL} no longer shows a `fleet-r<N>-…` VM name"
    )


def test_validate_skill_accepts_the_ultrapowers_skill():
    """(d) [M4]."""
    result = subprocess.run(
        [sys.executable,
         str(ROOT / "skills/ultrapowers/scripts/validate_skill.py"),
         str(ROOT / "skills/ultrapowers")],
        capture_output=True, text=True)
    assert result.returncode == 0, (
        "validate_skill.py rejected skills/ultrapowers:\n"
        + result.stdout + result.stderr
    )
