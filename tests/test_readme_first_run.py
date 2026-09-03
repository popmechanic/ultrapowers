"""Exam for task 3 — "The README tells a new user which half needs a fleet".

Claim: a new user reads Get started and learns that writing plans needs nothing
but the plugin and that running one needs a fleet the doctor will check for.

Each test names the Proof leg and the Machine clause it encodes:

  (a) [M1] the subsection carries the authoring-needs-no-configuration sentence
  (b) [M1] ... the only-`/ultrapowers`-needs-the-fleet sentence
  (c) [M1] ... the `/ultrapowers setup` sentence
  (d) [M2] the heading occurs exactly once, inside `## Get started`
  (e) [M3] the `**Where it runs.**` line survives (the digest half is retired --
      see the note above leg (e))
  (f) [M4] no new upper-case whole-word occurrence of the three words M4 names

Reading note for (a)-(c): "verbatim" is checked against the subsection with runs
of whitespace collapsed to a single space, so that a sentence hard-wrapped across
source lines still counts. Every character of the sentence -- its wording, order,
punctuation, backticks and em dash -- is still pinned; only the position of a line
break is free.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
README = ROOT / "README.md"

HEADING = "### Before your first run"
GET_STARTED = "## Get started"
WHERE_IT_RUNS = "**Where it runs.**"

# The three sentences M1 pins, verbatim.
SENTENCE_AUTHORING = (
    "Authoring needs no configuration: `ultrawrite`, `compile_plan.py`, "
    "`ultradocket` and `ultralearn` are local Python plus `gh`, and you can "
    "write, gate and compile plans without an exe.dev account."
)
SENTENCE_ONLY_ULTRAPOWERS = (
    "Only `/ultrapowers <plan-path>` needs the fleet — two exe.dev VMs you "
    "provision once, following `fleet/RUNBOOK.md`."
)
SENTENCE_SETUP = (
    "Run `/ultrapowers setup` first: it checks for each piece of the fleet and "
    "walks you to the RUNBOOK section that builds any piece you are missing."
)

# The three upper-case words M4 bans, spelled in halves (adjacent string literals
# concatenate) so this exam file does not itself gain a whole-word occurrence of
# any of them -- the compiled pattern is the M4 alternation over those three words.
BANNED_WORDS = ("NEV" "ER", "ALW" "AYS", "MU" "ST")
WORD_RE = re.compile(r"\b(" + "|".join(BANNED_WORDS) + r")\b")


def readme_text():
    assert README.is_file(), "README.md is missing from the repository root"
    return README.read_text(encoding="utf-8")


def heading_line_indexes(lines):
    """Indexes of the lines that are exactly the `### Before your first run` heading."""
    return [i for i, line in enumerate(lines) if line.rstrip("\r\n").rstrip() == HEADING]


def subsection_text(text):
    """The text between the heading and the next line beginning `**Where it runs.**`.

    Returns the heading line plus everything up to (excluding) that line, which is
    the subsection this task adds.
    """
    lines = text.splitlines(keepends=True)
    starts = heading_line_indexes(lines)
    assert len(starts) == 1, (
        "README.md must contain the %r heading exactly once; found %d"
        % (HEADING, len(starts))
    )
    start = starts[0]
    following = [
        i for i in range(start + 1, len(lines)) if lines[i].startswith(WHERE_IT_RUNS)
    ]
    assert following, (
        "no line beginning %r follows the %r heading" % (WHERE_IT_RUNS, HEADING)
    )
    return "".join(lines[start : following[0]])


def without_subsection(text):
    """`text` with the subsection deleted: every line from the heading up to but
    excluding the first following line beginning `**Where it runs.**`."""
    lines = text.splitlines(keepends=True)
    starts = heading_line_indexes(lines)
    assert len(starts) == 1, (
        "README.md must contain the %r heading exactly once; found %d"
        % (HEADING, len(starts))
    )
    start = starts[0]
    following = [
        i for i in range(start + 1, len(lines)) if lines[i].startswith(WHERE_IT_RUNS)
    ]
    assert following, (
        "no line beginning %r follows the %r heading" % (WHERE_IT_RUNS, HEADING)
    )
    return "".join(lines[:start] + lines[following[0] :])


def collapse(s):
    return " ".join(s.split())


# --- leg (a) [M1] ---------------------------------------------------------

def test_leg_a_subsection_says_authoring_needs_no_configuration():
    """Leg (a) [M1]: the subsection contains the authoring sentence verbatim."""
    body = collapse(subsection_text(readme_text()))
    assert collapse(SENTENCE_AUTHORING) in body, (
        "the `### Before your first run` subsection does not contain, verbatim:\n%s"
        % SENTENCE_AUTHORING
    )


# --- leg (b) [M1] ---------------------------------------------------------

def test_leg_b_subsection_says_only_ultrapowers_needs_the_fleet():
    """Leg (b) [M1]: the subsection contains the only-`/ultrapowers` sentence verbatim."""
    body = collapse(subsection_text(readme_text()))
    assert collapse(SENTENCE_ONLY_ULTRAPOWERS) in body, (
        "the `### Before your first run` subsection does not contain, verbatim:\n%s"
        % SENTENCE_ONLY_ULTRAPOWERS
    )


# --- leg (c) [M1] ---------------------------------------------------------

def test_leg_c_subsection_sends_the_reader_to_ultrapowers_setup():
    """Leg (c) [M1]: the subsection contains the `/ultrapowers setup` sentence verbatim."""
    body = collapse(subsection_text(readme_text()))
    assert collapse(SENTENCE_SETUP) in body, (
        "the `### Before your first run` subsection does not contain, verbatim:\n%s"
        % SENTENCE_SETUP
    )


# --- leg (d) [M2] ---------------------------------------------------------

def test_leg_d_heading_occurs_once_inside_get_started():
    """Leg (d) [M2]: the heading occurs exactly once, after `## Get started`, with no
    `## ` heading between the two."""
    lines = readme_text().splitlines()
    starts = heading_line_indexes(lines)
    assert len(starts) == 1, (
        "README.md must contain the %r heading exactly once; found %d"
        % (HEADING, len(starts))
    )
    heading_index = starts[0]

    get_started = [i for i, line in enumerate(lines) if line.rstrip() == GET_STARTED]
    assert len(get_started) == 1, (
        "README.md must contain the %r heading exactly once; found %d"
        % (GET_STARTED, len(get_started))
    )
    get_started_index = get_started[0]

    assert heading_index > get_started_index, (
        "%r (line %d) must come after %r (line %d)"
        % (HEADING, heading_index + 1, GET_STARTED, get_started_index + 1)
    )
    intervening = [
        (i + 1, lines[i])
        for i in range(get_started_index + 1, heading_index)
        if lines[i].startswith("## ")
    ]
    assert intervening == [], (
        "a `## ` heading lies between %r and %r, so the subsection is not inside "
        "the Get started section: %r" % (GET_STARTED, HEADING, intervening)
    )


# --- leg (e) [M3] ---------------------------------------------------------

# The digest half of leg (e) -- deleting the subsection restores the frozen
# sha256 of README.md at d6efce4, plus its one-character negative control -- was
# run-54 task 3's proof that the task touched nothing else. Its span stops AT the
# `**Where it runs.**` line, so that paragraph counted as outside the subsection
# and was pinned to d6efce4 too. run-55 task 7 (#575) writes into that paragraph
# by machine clause, which a frozen digest cannot survive: a digest pins a file,
# not an edit -- the same reason the matching leg in tests/test_runbook_doctor.py
# was discharged when #569 merged. The proof is not lost, it moved forward:
# tests/test_runbook_one_path.py leg (g) re-freezes it at BASE 3fee7e7 over the
# whole `### Before your first run` subsection (heading up to the next heading,
# so the paragraph is inside it), with its own mutation control. What stays live
# here is the half that needs no digest.


def test_leg_e_the_where_it_runs_line_survives():
    """Leg (e) [M3], the part a frozen digest is not needed for: a line beginning
    `**Where it runs.**` is still in README.md."""
    text = readme_text()
    assert any(
        line.startswith(WHERE_IT_RUNS) for line in text.splitlines()
    ), "README.md no longer contains a line beginning %r" % WHERE_IT_RUNS


# --- leg (f) [M4] ---------------------------------------------------------

def test_leg_f_no_new_upper_case_never_always_must():
    """Leg (f) [M4]: the set of whole-word matches of the three banned upper-case
    words in the modified README.md equals the set in the reconstructed BASE text."""
    text = readme_text()
    reconstructed = without_subsection(text)

    base_words = set(WORD_RE.findall(reconstructed))
    modified_words = set(WORD_RE.findall(text))

    assert base_words == set(), (
        "the reconstructed BASE text should carry no upper-case whole-word "
        "match of %r, but found %r" % (BANNED_WORDS, sorted(base_words))
    )
    assert modified_words == base_words, (
        "README.md gained upper-case whole-word %r that BASE d6efce4 did not contain"
        % sorted(modified_words - base_words)
    )
