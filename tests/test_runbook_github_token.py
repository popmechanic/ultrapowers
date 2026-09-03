"""Exam for task 3 — "The RUNBOOK counts six rows and names the per-target cost".

Claim: when I read the RUNBOOK's doctor section it lists the GitHub token as one
of the rows, and the GitHub auth section tells me that every new repo needs the
token widened first and how to check it.

Written at BASE 07b330eb8d358b0bbda9b937149823749e9e2fdf, before `fleet/RUNBOOK.md`
learned about the `github-token` row or the `--target <owner>/<repo>` flag. Every
test below names the Proof leg (a)-(c) and the Machine clause (M1-M3) it encodes:

  (a)/M1  the `## Doctor` body, whitespace-collapsed, contains the M1 sentence
          (five named rows including `github-token`, "and a sixth, preflight"),
          its first fenced line is the five-read-only-rows line, some fenced
          line begins with the `--target <owner>/<repo>` invocation, and neither
          `and a fifth` nor `the four read-only rows` survives in the section
  (b)/M2  the `## GitHub auth (#368) …` body contains the widening sentence and
          both sentences M2 keeps, whitespace-collapsed — and a one-word
          mutation of the widening sentence is *not* found, so the check reads
          the words and not merely their neighbourhood
  (c)/M3  the count of `## ` headings outside fences is BASE's 12, and the set
          of upper-case whole-word shouting verbs in the file equals the set in
          the file's BASE bytes (`git show <BASE>:fleet/RUNBOOK.md`)

Reading note. Prose in this RUNBOOK wraps near column 78 and its fenced blocks
align their `#` comments to a column, so every pin here compares
whitespace-collapsed text: each word, backtick, dash, slash, angle bracket and
mark of punctuation has to match exactly, but where the author puts a line break
— or how far the comment is pushed right — is free.

One BASE fact is frozen here as a literal, read from `fleet/RUNBOOK.md` at
07b330e before any edit existed:

    count of `## ` headings (outside fences) = 12

The BASE shouting-verb set for leg (c) is read from git at the frozen BASE sha
rather than from `HEAD`, so the comparison stays live after the implementer
commits: against `HEAD` it would degrade into comparing the file with itself.
The frozen literal below is the same set, and is used only if the BASE blob
cannot be read from git.

    shouting verbs in fleet/RUNBOOK.md at 07b330e = {"NEV"+"ER"}

The shouted words are assembled from pieces throughout this file so that the exam
itself carries none of them as whole words — the repo-wide pin walks every file
changed since BASE, this one included.
"""

import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNBOOK = ROOT / "fleet" / "RUNBOOK.md"

BASE = "07b330eb8d358b0bbda9b937149823749e9e2fdf"
BASE_HEADING_COUNT = 12

DOCTOR_SECTION = "Doctor"
GITHUB_AUTH_SECTION = "GitHub auth"

# --- M1 -------------------------------------------------------------------

M1_SENTENCE = (
    "`node fleet/doctor.mjs` is the read-only check of everything above: one "
    "row per section — exe.dev account, orchestrator, golden, token, "
    "github-token — and a sixth, preflight, that runs only with `--probe` "
    "because it clones the golden into a throwaway `fleet-doctor-probe` VM and "
    "removes it."
)
M1_FIRST_FENCED_LINE = "node fleet/doctor.mjs           # the five read-only rows"
M1_TARGET_INVOCATION = "node fleet/doctor.mjs --target <owner>/<repo>"
M1_RETIRED = (
    "and a fifth",
    "the four read-only rows",
)

# --- M2 -------------------------------------------------------------------

M2_WIDENING_SENTENCE = (
    "Every new target needs this token's repository access widened before its "
    "first drive: `node fleet/doctor.mjs --target <owner>/<repo>` is the check, "
    "and `/ultrapowers` runs it before every launch, so a too-narrow token "
    "costs a launch, not a run."
)
# The one word the mutation control swaps, and what it becomes. `widened` occurs
# exactly once in the sentence above, so the mutant differs from it by one word.
M2_MUTATED_WORD = ("widened", "narrowed")
M2_KEPT_SENTENCES = (
    "Repository access: every repository you will drive with `/ultrapowers`, "
    "ultrapowers itself included.",
    "A target outside the token's repository access parks the run at publish "
    "with a 403; the branch and its receipts are still pinned in the target's "
    "cache clone under `/home/exedev/targets/`.",
)

# --- M3 -------------------------------------------------------------------

SHOUT_WORDS = ("NEV" + "ER", "ALW" + "AYS", "MU" + "ST")
SHOUT = re.compile(r"\b(" + "|".join(SHOUT_WORDS) + r")\b")
BASE_SHOUT_SET = {"NEV" + "ER"}


# --- helpers --------------------------------------------------------------


def read():
    return RUNBOOK.read_text(encoding="utf-8")


def flat(text):
    """`text` with every run of whitespace collapsed to one space, ends stripped."""
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


def section_lines(text, name):
    """The lines of the `## <name>…` section: its heading up to the next heading.

    `name` is matched as a prefix of the heading text, so `GitHub auth` finds the
    heading that carries the `(#368) — the orchestrator opens the PR` suffix
    without pinning that suffix here. The prefix has to select exactly one heading.
    """
    lines = text.splitlines(keepends=True)
    indexes = heading_indexes(lines)
    titles = [lines[i].rstrip("\n")[3:].strip() for i in indexes]
    matches = [p for p, title in enumerate(titles) if title.startswith(name)]
    assert len(matches) == 1, (
        "fleet/RUNBOOK.md must have exactly one `## ` heading beginning %r; "
        "it has %d (headings: %r)" % (name, len(matches), titles)
    )
    position = matches[0]
    start = indexes[position]
    end = indexes[position + 1] if position + 1 < len(indexes) else len(lines)
    return [line.rstrip("\n") for line in lines[start:end]]


def section(text, name):
    return "\n".join(section_lines(text, name))


def fenced_lines(section_text):
    """The non-blank lines of `section_text` that sit inside a ``` fence."""
    inside_fence = False
    out = []
    for raw in section_text.splitlines():
        if raw.lstrip().startswith("```"):
            inside_fence = not inside_fence
            continue
        if inside_fence and raw.strip():
            out.append(raw.strip())
    return out


def base_shout_set():
    """The shouting verbs in `fleet/RUNBOOK.md` as of the frozen BASE sha.

    Read from git so the leg compares against bytes this exam cannot edit; if the
    BASE blob is unreachable (no git, shallow clone), the frozen literal above
    stands in — it was computed from those same bytes.
    """
    try:
        done = subprocess.run(
            ["git", "show", "%s:fleet/RUNBOOK.md" % BASE],
            cwd=str(ROOT),
            capture_output=True,
        )
    except OSError:
        return BASE_SHOUT_SET
    if done.returncode != 0:
        return BASE_SHOUT_SET
    return set(SHOUT.findall(done.stdout.decode("utf-8")))


def test_the_runbook_is_readable():
    assert RUNBOOK.is_file(), "fleet/RUNBOOK.md is missing"


# --- leg (a) [M1] ---------------------------------------------------------


def test_leg_a_m1_the_doctor_section_states_the_six_row_sentence():
    """(a)/M1 — §Doctor contains the M1 sentence verbatim (collapsed).

    The sentence is what names `github-token` as a row and preflight as the
    sixth; a §Doctor that still says four rows and a fifth fails here.
    """
    body = flat(section(read(), DOCTOR_SECTION))
    assert flat(M1_SENTENCE) in body, (
        "fleet/RUNBOOK.md §%s does not contain, verbatim:\n%s"
        % (DOCTOR_SECTION, M1_SENTENCE)
    )


def test_leg_a_m1_the_first_fenced_line_is_the_five_read_only_rows_line():
    """(a)/M1 — the first line inside §Doctor's fence equals the M1 fenced line."""
    lines = fenced_lines(section(read(), DOCTOR_SECTION))
    assert lines, "fleet/RUNBOOK.md §%s has no fenced lines" % DOCTOR_SECTION
    assert flat(lines[0]) == flat(M1_FIRST_FENCED_LINE), (
        "fleet/RUNBOOK.md §%s's first fenced line is:\n%s\nexpected:\n%s"
        % (DOCTOR_SECTION, lines[0], M1_FIRST_FENCED_LINE)
    )


def test_leg_a_m1_a_fenced_line_begins_with_the_target_invocation():
    """(a)/M1 — some fenced line of §Doctor begins `node … --target <owner>/<repo>`."""
    lines = fenced_lines(section(read(), DOCTOR_SECTION))
    wanted = flat(M1_TARGET_INVOCATION)
    assert any(flat(line).startswith(wanted) for line in lines), (
        "no fenced line of fleet/RUNBOOK.md §%s begins with %r; its fenced "
        "lines are %r" % (DOCTOR_SECTION, M1_TARGET_INVOCATION, lines)
    )


def test_leg_a_m1_the_doctor_section_retires_the_five_row_wording():
    """(a)/M1 — neither `and a fifth` nor `the four read-only rows` is in §Doctor."""
    body = flat(section(read(), DOCTOR_SECTION))
    still_there = [phrase for phrase in M1_RETIRED if flat(phrase) in body]
    assert still_there == [], (
        "fleet/RUNBOOK.md §%s still contains %r" % (DOCTOR_SECTION, still_there)
    )


# --- leg (b) [M2] ---------------------------------------------------------


def test_leg_b_m2_github_auth_states_the_widening_sentence():
    """(b)/M2 — §GitHub auth contains the widening sentence verbatim (collapsed)."""
    body = flat(section(read(), GITHUB_AUTH_SECTION))
    assert flat(M2_WIDENING_SENTENCE) in body, (
        "fleet/RUNBOOK.md §%s does not contain, verbatim:\n%s"
        % (GITHUB_AUTH_SECTION, M2_WIDENING_SENTENCE)
    )


def test_leg_b_m2_a_one_word_mutation_of_the_widening_sentence_is_absent():
    """(b)/M2 — the control: the same sentence with one word swapped is not found.

    `widened` → `narrowed` is the only difference between the mutant and the
    sentence the leg above requires, so a §GitHub auth that satisfies both
    assertions was read word by word, not merely by neighbourhood.
    """
    original, replacement = M2_MUTATED_WORD
    assert M2_WIDENING_SENTENCE.count(original) == 1, (
        "this exam's mutation control is malformed: %r occurs %d times in the "
        "widening sentence, not once"
        % (original, M2_WIDENING_SENTENCE.count(original))
    )
    mutant = flat(M2_WIDENING_SENTENCE.replace(original, replacement))
    assert mutant != flat(M2_WIDENING_SENTENCE), "the mutation control changed nothing"
    body = flat(section(read(), GITHUB_AUTH_SECTION))
    assert mutant not in body, (
        "fleet/RUNBOOK.md §%s contains the mutated sentence:\n%s"
        % (GITHUB_AUTH_SECTION, mutant)
    )


def test_leg_b_m2_github_auth_keeps_both_earlier_sentences():
    """(b)/M2 — §GitHub auth still contains both sentences M2 keeps (collapsed)."""
    body = flat(section(read(), GITHUB_AUTH_SECTION))
    for sentence in M2_KEPT_SENTENCES:
        assert flat(sentence) in body, (
            "fleet/RUNBOOK.md §%s no longer contains, verbatim:\n%s"
            % (GITHUB_AUTH_SECTION, sentence)
        )


# --- leg (c) [M3] ---------------------------------------------------------


def test_leg_c_m3_the_heading_count_is_unchanged_from_base():
    """(c)/M3 — `fleet/RUNBOOK.md` has BASE's 12 `## ` headings, outside fences."""
    present = headings(read())
    assert len(present) == BASE_HEADING_COUNT, (
        "fleet/RUNBOOK.md has %d `## ` headings, not BASE %s's %d; they are %r"
        % (len(present), BASE[:7], BASE_HEADING_COUNT, present)
    )


def test_leg_c_m3_no_new_upper_case_shouting_verb():
    """(c)/M3 — the shouted words in the file are the ones its BASE bytes had."""
    gained = set(SHOUT.findall(read()))
    already = base_shout_set()
    assert gained == already, (
        "fleet/RUNBOOK.md's upper-case whole-word set is %r; its bytes at BASE "
        "%s had %r (gained %r, lost %r)"
        % (
            sorted(gained),
            BASE[:7],
            sorted(already),
            sorted(gained - already),
            sorted(already - gained),
        )
    )
