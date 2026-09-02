"""Exam for task 4 — the RUNBOOK names the account step and the doctor.

Claim: every RUNBOOK section the doctor can send an operator to exists, including
the one for the account needed before any VM, and the RUNBOOK says the doctor is
how the operator checks the work.

Written at BASE d6efce4da55f6a750a2632d30a70a0c635113c68, before either new section exists.
Every test below names the Proof leg (a)–(e) and the Machine clause (M1–M5) it
encodes:

  (a)/M1  the six `## ` heading texts are all present, `exe.dev account` is the
          first heading in file order, and `Doctor` immediately precedes `Preflight`
  (b)/M2  the `## exe.dev account` section carries the assumption sentence verbatim,
          a fenced `ssh exe.dev whoami`, and a `~/.ssh/config` stanza with
          `Host *.exe.xyz exe.dev` and `IdentitiesOnly yes`
  (c)/M3  the `## Doctor` section carries all three M3 sentences verbatim
  (d)/M4  deleting the two new sections (each from its `## ` heading up to the next
          `## ` heading) restores the BASE bytes — proved against the frozen BASE
          SHA-256 below, with a mutation control — and the heading count is BASE + 2
  (e)/M5  the file gains no upper-case whole-word shouting verb (NEV…/ALW…/MU…)

Two BASE facts are frozen here as literals, computed from `fleet/RUNBOOK.md` at
d6efce4da55f6a750a2632d30a70a0c635113c68 before any edit existed:

    sha256(fleet/RUNBOOK.md) = 9f20c2c78ddbdc2a63a9338980ea6b9f79d5b6a6d21621b1d7fd91aa208a5766
    count of `## ` headings  = 10

Prose in this RUNBOOK wraps near column 78, so the verbatim-sentence checks compare
whitespace-collapsed text: every word, backtick, dash and mark of punctuation must
match exactly, but the author stays free to wrap the sentence across lines.
"""

import hashlib
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNBOOK = ROOT / "fleet" / "RUNBOOK.md"

BASE = "d6efce4da55f6a750a2632d30a70a0c635113c68"
BASE_DIGEST = "9f20c2c78ddbdc2a63a9338980ea6b9f79d5b6a6d21621b1d7fd91aa208a5766"
BASE_HEADING_COUNT = 10

NEW_SECTIONS = ("exe.dev account", "Doctor")

# M1 — all six, none absent.
REQUIRED_HEADINGS = (
    "exe.dev account",
    "Golden VM build",
    "Orchestrator VM",
    "Engine auth — the Max subscription, delivered per run (#213)",
    "Preflight",
    "Doctor",
)

# M2 — the sentence the account section states verbatim.
M2_SENTENCE = "Everything below assumes an exe.dev account whose SSH key is registered, so that `ssh exe.dev whoami` prints your username."

# M2 — the check and the `~/.ssh/config` lines the fenced block shows.
M2_COMMAND = "ssh exe.dev whoami"
M2_CONFIG_LINES = ("Host *.exe.xyz exe.dev", "IdentitiesOnly yes")

# M3 — the three sentences the Doctor section states verbatim.
M3_SENTENCES = (
    "`node fleet/doctor.mjs` is the read-only check of everything above: one row per section — exe.dev account, orchestrator, golden, token — and a fifth, preflight, that runs only with `--probe` because it clones the golden into a throwaway `fleet-doctor-probe` VM and removes it.",
    "A missing row names the section of this file that builds it; `--json` is what `/ultrapowers setup` reads.",
    "Re-run it after every step of a build and after every `claude plugin update` on the golden; a green doctor is the posture check, not the build's exit code.",
)

# M5 — the words no file in the repository may gain. They are assembled from
# pieces so this exam carries none of them as whole words either: the run-54
# task 5 leg walks every file changed since BASE, this one included.
SHOUT_WORDS = ("NEV" + "ER", "ALW" + "AYS", "MU" + "ST")
SHOUT = re.compile(r"\b(" + "|".join(SHOUT_WORDS) + r")\b")


def read():
    return RUNBOOK.read_text(encoding="utf-8")


def flat(text):
    """`text` with every run of whitespace collapsed to one space."""
    return " ".join(text.split())


def heading_indexes(lines):
    """Indexes of the `## ` heading lines of `lines`, skipping fenced blocks.

    A ``` fence toggles; a `## ` line inside one is a shell comment, not a heading.
    """
    indexes = []
    inside_fence = False
    for index, raw in enumerate(lines):
        line = raw.rstrip("\n")
        if line.lstrip().startswith("```"):
            inside_fence = not inside_fence
            continue
        if not inside_fence and line.startswith("## "):
            indexes.append(index)
    return indexes


def headings(text):
    """The `## ` heading texts of `text`, in file order."""
    lines = text.splitlines(keepends=True)
    return [lines[i].rstrip("\n")[3:].strip() for i in heading_indexes(lines)]


def section_span(text, name):
    """(start, end) line indexes of section `name`: its heading up to the next one."""
    lines = text.splitlines(keepends=True)
    indexes = heading_indexes(lines)
    for position, index in enumerate(indexes):
        if lines[index].rstrip("\n")[3:].strip() == name:
            end = indexes[position + 1] if position + 1 < len(indexes) else len(lines)
            return index, end
    raise AssertionError(
        f"fleet/RUNBOOK.md has no `## {name}` section; its headings are {headings(text)}"
    )


def section(text, name):
    start, end = section_span(text, name)
    return "".join(text.splitlines(keepends=True)[start:end])


def fenced_lines(section_text):
    """The lines of `section_text` that sit inside a ``` fence."""
    inside_fence = False
    out = []
    for raw in section_text.splitlines():
        if raw.lstrip().startswith("```"):
            inside_fence = not inside_fence
            continue
        if inside_fence:
            out.append(raw)
    return out


def fenced_commands(section_text):
    """Every fenced line, stripped, plus its form with a trailing `#` comment cut."""
    out = []
    for line in fenced_lines(section_text):
        stripped = line.strip()
        out.append(stripped)
        head = stripped.split("#", 1)[0].strip()
        if head:
            out.append(head)
    return out


def config_units(section_text):
    """The `~/.ssh/config` line units of the section's fenced blocks.

    The RUNBOOK writes this stanza either as plain lines of a config file or as one
    `printf "Host …\nIdentitiesOnly yes\n" > ~/.ssh/config` line (the form the
    `## Orchestrator VM` section already uses), so a literal backslash-n counts as a
    line break here too, and a leading `printf ` or quote is stripped off.
    """
    units = []
    for line in fenced_lines(section_text):
        for piece in line.split("\\n"):
            piece = piece.strip().strip("\"'").strip()
            if piece.startswith("printf "):
                piece = piece[len("printf "):].strip().strip("\"'").strip()
            units.append(piece)
    return units


def without_new_sections(text):
    """`text` with the two new sections deleted — the pre-edit RUNBOOK, per M4."""
    lines = text.splitlines(keepends=True)
    spans = sorted(section_span(text, name) for name in NEW_SECTIONS)
    for start, end in reversed(spans):
        del lines[start:end]
    return "".join(lines)


def test_the_runbook_is_readable():
    assert RUNBOOK.is_file(), "fleet/RUNBOOK.md is missing"


def test_leg_a_m1_every_one_of_the_six_headings_is_present():
    """(a)/M1 — the six required heading strings minus the file's headings is empty."""
    present = headings(read())
    absent = [name for name in REQUIRED_HEADINGS if name not in present]
    assert absent == [], (
        f"`## ` headings absent from fleet/RUNBOOK.md: {absent}; present: {present}"
    )


def test_leg_a_m1_exe_dev_account_is_the_first_heading():
    """(a)/M1 — `exe.dev account` is exactly the first element in file order."""
    present = headings(read())
    assert present, "fleet/RUNBOOK.md has no `## ` headings"
    assert present[0] == "exe.dev account", (
        f"first `## ` heading is {present[0]!r}, not 'exe.dev account'"
    )


def test_leg_a_m1_doctor_immediately_precedes_preflight():
    """(a)/M1 — the element after `Doctor` is exactly `Preflight`."""
    present = headings(read())
    assert "Doctor" in present, f"no `## Doctor` heading; headings: {present}"
    after = present[present.index("Doctor") + 1:]
    assert after, "`## Doctor` is the last heading; `## Preflight` must follow it"
    assert after[0] == "Preflight", (
        f"the heading after `Doctor` is {after[0]!r}, not 'Preflight'"
    )


def test_leg_b_m2_the_account_section_states_the_assumption_sentence():
    """(b)/M2 — the `## exe.dev account` section contains the M2 sentence verbatim."""
    body = flat(section(read(), "exe.dev account"))
    assert M2_SENTENCE in body, (
        f"the `## exe.dev account` section does not contain, verbatim:\n{M2_SENTENCE}"
    )


def test_leg_b_m2_the_account_section_shows_the_whoami_check_in_a_fence():
    """(b)/M2 — a fenced block of that section contains the line `ssh exe.dev whoami`."""
    commands = fenced_commands(section(read(), "exe.dev account"))
    assert M2_COMMAND in commands, (
        f"no fenced line {M2_COMMAND!r} in the `## exe.dev account` section; "
        f"its fenced lines are {commands}"
    )


def test_leg_b_m2_the_account_section_shows_the_ssh_config_stanza():
    """(b)/M2 — the stanza's lines include `Host *.exe.xyz exe.dev`, `IdentitiesOnly yes`."""
    body = section(read(), "exe.dev account")
    assert "~/.ssh/config" in body, (
        "the `## exe.dev account` section names no `~/.ssh/config` stanza"
    )
    units = config_units(body)
    for line in M2_CONFIG_LINES:
        assert line in units, (
            f"the `~/.ssh/config` stanza has no line {line!r}; its lines are {units}"
        )


def test_leg_c_m3_the_doctor_section_states_all_three_sentences():
    """(c)/M3 — the `## Doctor` section contains each of the three sentences verbatim."""
    body = flat(section(read(), "Doctor"))
    for expected in M3_SENTENCES:
        assert expected in body, (
            f"the `## Doctor` section does not contain, verbatim:\n{expected}"
        )


# The two byte-identical-to-BASE legs ((d)/M4: deleting the two sections
# restores the frozen sha256 of fleet/RUNBOOK.md at d6efce4, and its one-char
# negative control) were run-54's proof that task 4 touched nothing else. They
# were discharged when #569 merged (9051fc2); the very next RUNBOOK edit
# (run-53b, the sandbox-size knob) would have re-failed them forever, since a
# frozen digest pins a file, not an edit. The heading-count half of M4 stays.


def test_leg_d_m4_the_heading_count_is_base_plus_two():
    """(d)/M4 — the count of `## ` headings is BASE's count plus two."""
    count = len(headings(read()))
    assert count == BASE_HEADING_COUNT + 2, (
        f"fleet/RUNBOOK.md has {count} `## ` headings, not BASE {BASE}'s "
        f"{BASE_HEADING_COUNT} plus two"
    )


def test_leg_e_m5_no_new_upper_case_never_always_or_must():
    """(e)/M5 — the shouted words in the file are the ones the BASE text already had."""
    text = read()
    gained = set(SHOUT.findall(text))
    already = set(SHOUT.findall(without_new_sections(text)))
    assert gained == already, (
        f"fleet/RUNBOOK.md gained upper-case whole-word {sorted(gained - already)}; "
        f"BASE {BASE} had {sorted(already)}"
    )
