"""Exam for task 2 — "The skill tells a stranger about the second secret".

Claim: walking `/ultrapowers setup` names both secrets and walks the GitHub one
the same way as the Claude one, and the launch instructions tell the client to
check that token against the repository it is run in before anything is staged.

Written against BASE 07b330eb8d358b0bbda9b937149823749e9e2fdf, where
`references/first-run.md` still has five sections, `## token` still calls itself
"the only row that touches a secret", and `SKILL.md` still says "five pieces"
and runs the doctor before the rsync without `--target`.

Every test names the Proof leg and the Machine clause it encodes:

  (a) [M1] the `## ` headings of `first-run.md`, in file order, are exactly the
      six row ids `exe-dev`, `orchestrator`, `golden`, `token`, `github-token`,
      `preflight` — no seventh, none reordered.
  (b) [M2] the `## github-token` body carries all three M2 sentences, and a
      one-word mutation of each is absent (so the pin is on the words, not on
      the presence of a section).
  (c) [M3] `## token` has dropped `This is the only row that touches a secret.`
      and gained the two-rows sentence, while keeping the
      0600-direct-from-output sentence and `claude setup-token`; the
      `## orchestrator` body still carries the every-repository sentence.
  (d) [M4] `SKILL.md` §Setup says `The fleet is six pieces`, names the six row
      ids in the doctor's order, carries the five-read-only probe sentence, and
      no longer says `five pieces` or `four read-only rows`.
  (e) [M5] §Client carries the new `--target <repo>` doctor sentence, placed
      after the sentence that derives `repo`, and the old
      `run the doctor without --probe` string is gone.
  (f) [M6] `validate_skill.py skills/ultrapowers` exits 0 printing `skill ok`,
      and neither file gained one of the three upper-case whole-word shouted
      imperatives (see `SHOUTY`) that its `git show HEAD:` bytes do not carry.

Two reading notes for the "verbatim" checks:

  * Prose in both files wraps at the margin, so every pinned sentence is
    compared with runs of whitespace collapsed to one space: a line break
    inside a sentence is allowed, a changed word is not.
  * The task text quotes its sentences inside backticks, which cannot express
    the inline-code backticks a markdown author would put around `--target`,
    `ok` or `--probe`. So the comparison also ignores backtick characters:
    every word, its order and its punctuation are pinned; only the inline-code
    formatting of the terms inside a sentence is the author's choice.

Offline: reads two committed files, runs one committed script and one
`git show` of the committed bytes.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL_REL = "skills/ultrapowers/SKILL.md"
FIRST_RUN_REL = "skills/ultrapowers/references/first-run.md"
SKILL = ROOT / SKILL_REL
FIRST_RUN = ROOT / FIRST_RUN_REL
VALIDATE = "skills/ultrapowers/scripts/validate_skill.py"
SKILL_DIR = "skills/ultrapowers"

# --- M1: the six doctor rows, in the doctor's order -----------------------

ROW_IDS = [
    "exe-dev",
    "orchestrator",
    "golden",
    "token",
    "github-token",
    "preflight",
]

# --- M2: the three sentences the new `## github-token` section states ------

M2_BUILD = (
    "Build it from RUNBOOK §GitHub auth (#368) — the orchestrator opens the PR."
)
M2_SECRET = (
    "The token is saved to a 0600 file straight from the GitHub page, never "
    "through this conversation: its value is never pasted here."
)
M2_TARGET = (
    "A new target means widening this token's repository access before its "
    "first drive; the doctor's --target <owner>/<repo> flag is the check, and "
    "a red row here costs a launch, not a run."
)

# One word changed in each: the pin is on the sentence, not on a lookalike.
M2_SENTENCES = [
    (
        "build-from-RUNBOOK",
        M2_BUILD,
        M2_BUILD.replace("the orchestrator opens", "the operator opens"),
    ),
    (
        "secret-rule-for-a-page",
        M2_SECRET,
        M2_SECRET.replace("straight from the GitHub page", "directly from the GitHub page"),
    ),
    (
        "widen-before-the-first-drive",
        M2_TARGET,
        M2_TARGET.replace("before its first drive", "after its first drive"),
    ),
]

# --- M3: what leaves and what stays in the sections above ------------------

M3_RETIRED = "This is the only row that touches a secret."
M3_TWO_ROWS = (
    "This is the first of two rows that touch a secret; github-token is the "
    "other."
)
M3_TOKEN_0600 = (
    "The token is written to a 0600 file directly from the command's output, "
    "never through the clipboard, and its value is never pasted into this "
    "conversation."
)
M3_SETUP_TOKEN_COMMAND = "claude setup-token"
M3_ORCHESTRATOR = (
    "The GitHub token it holds has to reach every repository you will drive; "
    "ultrapowers itself is one of them."
)

# --- M4: §Setup counts six pieces and five read-only rows ------------------

M4_SIX_PIECES = "The fleet is six pieces"
M4_PROBE_ENDS_SETUP = (
    "When the five read-only rows are `ok`, run the doctor once more with "
    "`--probe`; a `ready` verdict ends setup."
)
M4_RETIRED_COUNTS = ["five pieces", "four read-only rows"]

# --- M5: §Client checks the token against this target ----------------------

M5_DOCTOR_WITH_TARGET = (
    "Before the rsync, run the doctor with `--target <repo>` and without "
    "`--probe`; a verdict other than `ready` means there is no fleet to launch "
    "on for this target — offer `/ultrapowers setup` and stop."
)
M5_REPO_DERIVATION = "gh repo view --json nameWithOwner"
M5_RETIRED = "run the doctor without `--probe`"

# --- M6: the three words neither file may gain ----------------------------

# Spelled in halves (adjacent string literals concatenate) so this exam does not
# itself gain a whole-word occurrence of any of them.
SHOUTY = ("NEV" "ER", "ALW" "AYS", "MU" "ST")
SHOUTY_RE = re.compile(r"\b(" + "|".join(SHOUTY) + r")\b")


# --- helpers --------------------------------------------------------------

def pin(text):
    """Collapse whitespace and drop backticks — see the reading notes above."""
    return re.sub(r"\s+", " ", text.replace("`", "")).strip()


def read(path):
    assert path.is_file(), f"{path.relative_to(ROOT)} not found"
    return path.read_text(encoding="utf-8")


def sections(text):
    """[(heading, body)] for each `## ` heading, skipping fenced regions."""
    out, in_fence, heading, buf = [], False, None, []
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        elif not in_fence and line.startswith("## "):
            if heading is not None:
                out.append((heading, "\n".join(buf)))
            heading, buf = line[3:].strip(), []
            continue
        if heading is not None:
            buf.append(line)
    if heading is not None:
        out.append((heading, "\n".join(buf)))
    return out


def headings(text):
    return [heading for heading, _ in sections(text)]


def section_body(text, wanted, label):
    found = [body for heading, body in sections(text) if heading == wanted]
    assert len(found) == 1, (
        f"{label}: expected exactly one `## {wanted}` heading, found "
        f"{len(found)} (headings: {headings(text)!r})"
    )
    return found[0]


def first_run_section(wanted, leg):
    return section_body(read(FIRST_RUN), wanted, f"{leg} first-run.md")


def skill_section(wanted, leg):
    return section_body(read(SKILL), wanted, f"{leg} SKILL.md")


def git_show(rel_path):
    """The committed bytes of `rel_path` at HEAD, as text."""
    proc = subprocess.run(
        ["git", "show", f"HEAD:{rel_path}"],
        cwd=ROOT, capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        f"`git show HEAD:{rel_path}` exited {proc.returncode}: {proc.stderr}"
    )
    return proc.stdout


def run_validate_skill():
    return subprocess.run(
        [sys.executable, VALIDATE, SKILL_DIR],
        cwd=ROOT, capture_output=True, text=True,
    )


# --- leg (a) [M1]: six sections, named for the rows, in the doctor's order --

def test_leg_a_first_run_headings_are_the_six_row_ids_in_order():
    """(a)[M1] the `## ` headings of first-run.md, in file order, equal the
    six row ids — the walk indexes this file by row id alone."""
    found = headings(read(FIRST_RUN))
    assert found == ROW_IDS, (
        f"(a)[M1] first-run.md `## ` headings are {found!r}, expected "
        f"{ROW_IDS!r}"
    )


def test_leg_a_first_run_has_no_seventh_section():
    """(a)[M1] exactly six sections: no seventh heading, and none repeated."""
    found = headings(read(FIRST_RUN))
    assert len(found) == 6, (
        f"(a)[M1] first-run.md has {len(found)} `## ` headings, expected 6: "
        f"{found!r}"
    )


# --- leg (b) [M2]: the `## github-token` section ---------------------------

def test_leg_b_github_token_section_carries_all_three_sentences():
    """(b)[M2] all three M2 sentences are in the `## github-token` body; when
    one is not, this names the first one missing."""
    body = pin(first_run_section("github-token", "(b)[M2]"))
    missing = [(tag, text) for tag, text, _ in M2_SENTENCES if pin(text) not in body]
    assert not missing, (
        f"(b)[M2] `## github-token` is missing {len(missing)} of the three "
        f"pinned sentences; the first absent is {missing[0][0]}, verbatim:\n"
        + missing[0][1]
    )


def test_leg_b_github_token_section_bridges_to_the_runbook():
    """(b)[M2] the section names the RUNBOOK section that builds the token and
    says who opens the PR."""
    body = pin(first_run_section("github-token", "(b)[M2]"))
    assert pin(M2_BUILD) in body, (
        "(b)[M2] `## github-token` is missing, verbatim:\n" + M2_BUILD
    )


def test_leg_b_github_token_section_states_the_secret_rule_for_a_page():
    """(b)[M2] unlike the Claude token, this one comes from a browser page, so
    the 0600 rule is phrased for a page and forbids this conversation."""
    body = pin(first_run_section("github-token", "(b)[M2]"))
    assert pin(M2_SECRET) in body, (
        "(b)[M2] `## github-token` is missing, verbatim:\n" + M2_SECRET
    )


def test_leg_b_github_token_section_states_the_new_target_rule():
    """(b)[M2] a new target means widening repository access first, and the
    doctor's `--target <owner>/<repo>` flag is how that is checked."""
    body = pin(first_run_section("github-token", "(b)[M2]"))
    assert pin(M2_TARGET) in body, (
        "(b)[M2] `## github-token` is missing, verbatim:\n" + M2_TARGET
    )


def test_leg_b_one_word_mutations_of_the_three_sentences_are_absent():
    """(b)[M2] each pin is on the sentence's words: a one-word mutation of any
    of the three is not in the section."""
    body = pin(first_run_section("github-token", "(b)[M2]"))
    for tag, original, mutated in M2_SENTENCES:
        assert pin(mutated) != pin(original), (
            f"(b)[M2] the {tag} control is not a mutation of its sentence"
        )
        assert pin(mutated) not in body, (
            f"(b)[M2] `## github-token` carries the mutated {tag} sentence:\n"
            + mutated
        )


# --- leg (c) [M3]: the sections the new one changes ------------------------

def test_leg_c_token_section_no_longer_claims_to_be_the_only_secret():
    """(c)[M3] there are two rows that touch a secret now, so the sentence
    that said there was one is gone from `## token`."""
    body = pin(first_run_section("token", "(c)[M3]"))
    assert pin(M3_RETIRED) not in body, (
        "(c)[M3] the `## token` section still carries the retired sentence:\n"
        + M3_RETIRED
    )


def test_leg_c_token_section_names_github_token_as_the_other_secret():
    """(c)[M3] `## token` points at the second secret by row id."""
    body = pin(first_run_section("token", "(c)[M3]"))
    assert pin(M3_TWO_ROWS) in body, (
        "(c)[M3] the `## token` section is missing, verbatim:\n" + M3_TWO_ROWS
    )


def test_leg_c_token_section_keeps_its_0600_rule_and_command():
    """(c)[M3] the rewrite is in place: the 0600-direct-from-output sentence
    and `claude setup-token` both survive in `## token`."""
    body = first_run_section("token", "(c)[M3]")
    assert pin(M3_TOKEN_0600) in pin(body), (
        "(c)[M3] the `## token` section dropped, verbatim:\n" + M3_TOKEN_0600
    )
    assert M3_SETUP_TOKEN_COMMAND in body, (
        "(c)[M3] the `## token` section no longer mentions "
        f"`{M3_SETUP_TOKEN_COMMAND}`"
    )


def test_leg_c_orchestrator_section_keeps_the_every_repository_sentence():
    """(c)[M3] the sentence a sibling exam pins in `## orchestrator` survives
    this task untouched."""
    body = pin(first_run_section("orchestrator", "(c)[M3]"))
    assert pin(M3_ORCHESTRATOR) in body, (
        "(c)[M3] the `## orchestrator` section dropped, verbatim:\n"
        + M3_ORCHESTRATOR
    )


# --- leg (d) [M4]: §Setup counts six pieces -------------------------------

def test_leg_d_setup_says_the_fleet_is_six_pieces():
    """(d)[M4] the count the setup walk opens with is six."""
    body = pin(skill_section("Setup", "(d)[M4]"))
    assert pin(M4_SIX_PIECES) in body, (
        "(d)[M4] `## Setup` does not contain, verbatim:\n" + M4_SIX_PIECES
    )


def test_leg_d_setup_lists_the_six_row_ids_in_the_doctors_order():
    """(d)[M4] each row id appears in §Setup, and their first occurrences are
    in the doctor's order — `github-token` sits between `token` and
    `preflight`."""
    body = skill_section("Setup", "(d)[M4]")
    positions = []
    for row_id in ROW_IDS:
        # `(?<![\w-])` keeps the `token` probe off the tail of `github-token`.
        m = re.search(r"(?<![\w-])" + re.escape(row_id) + r"(?![\w-])", body)
        assert m is not None, (
            f"(d)[M4] `## Setup` never names the row id `{row_id}`"
        )
        positions.append((row_id, m.start()))
    assert positions == sorted(positions, key=lambda pair: pair[1]), (
        "(d)[M4] `## Setup` names the row ids out of the doctor's order; first "
        f"occurrences are {positions!r}, expected the order {ROW_IDS!r}"
    )


def test_leg_d_setup_ends_on_five_read_only_rows_then_probe():
    """(d)[M4] five rows are read-only now, and `--probe` still ends setup."""
    body = pin(skill_section("Setup", "(d)[M4]"))
    assert pin(M4_PROBE_ENDS_SETUP) in body, (
        "(d)[M4] `## Setup` does not contain, verbatim:\n" + M4_PROBE_ENDS_SETUP
    )


def test_leg_d_setup_drops_the_old_counts():
    """(d)[M4] the two BASE counts — `five pieces` and `four read-only rows` —
    are gone from §Setup."""
    body = pin(skill_section("Setup", "(d)[M4]"))
    still_there = [phrase for phrase in M4_RETIRED_COUNTS if pin(phrase) in body]
    assert not still_there, (
        "(d)[M4] `## Setup` still carries the retired count(s): "
        + ", ".join(repr(phrase) for phrase in still_there)
    )


def test_leg_d_skill_file_drops_the_old_counts_everywhere():
    """(d)[M4] SKILL.md as a whole contains neither `five pieces` nor
    `four read-only rows`."""
    text = pin(read(SKILL))
    still_there = [phrase for phrase in M4_RETIRED_COUNTS if pin(phrase) in text]
    assert not still_there, (
        "(d)[M4] SKILL.md still carries the retired count(s): "
        + ", ".join(repr(phrase) for phrase in still_there)
    )


# --- leg (e) [M5]: §Client checks the token against this target ------------

def test_leg_e_client_runs_the_doctor_with_the_target_flag():
    """(e)[M5] the client checks the fleet for *this* target before staging
    anything, and offers setup when the verdict is not `ready`."""
    body = pin(skill_section("Client", "(e)[M5]"))
    assert pin(M5_DOCTOR_WITH_TARGET) in body, (
        "(e)[M5] `## Client` does not contain, verbatim:\n"
        + M5_DOCTOR_WITH_TARGET
    )


def test_leg_e_doctor_sentence_comes_after_repo_is_derived():
    """(e)[M5] the sentence names `<repo>`, so it sits after the sentence that
    derives `repo` with `gh repo view --json nameWithOwner`, not above the
    numbered list where `<repo>` is undefined."""
    body = pin(skill_section("Client", "(e)[M5]"))
    doctor_at = body.find(pin(M5_DOCTOR_WITH_TARGET))
    repo_at = body.find(pin(M5_REPO_DERIVATION))
    assert repo_at != -1, (
        "(e)[M5] `## Client` no longer derives `repo` with "
        f"`{M5_REPO_DERIVATION}`"
    )
    assert doctor_at != -1, (
        "(e)[M5] `## Client` does not contain, verbatim:\n"
        + M5_DOCTOR_WITH_TARGET
    )
    assert doctor_at > repo_at, (
        f"(e)[M5] the doctor sentence (offset {doctor_at}) precedes the "
        f"derivation of `repo` (offset {repo_at}) in `## Client`; it has to "
        "follow it, or `<repo>` is undefined where it is used"
    )


def test_leg_e_the_untargeted_doctor_sentence_is_gone():
    """(e)[M5] the BASE string `run the doctor without `--probe`` is absent
    from SKILL.md: the check moved, it was not duplicated."""
    text = pin(read(SKILL))
    assert pin(M5_RETIRED) not in text, (
        "(e)[M5] SKILL.md still contains the retired string:\n" + M5_RETIRED
    )


# --- leg (f) [M6]: the skill still validates, and neither file shouts ------

def test_leg_f_validate_skill_prints_skill_ok():
    """(f)[M6] the edited skill still validates: frontmatter intact, every
    `references/<file>` it names resolves."""
    proc = run_validate_skill()
    assert proc.returncode == 0, (
        f"(f)[M6] validate_skill.py exited {proc.returncode}:\n"
        f"{proc.stdout}{proc.stderr}"
    )
    assert "skill ok" in proc.stdout, (
        f"(f)[M6] validate_skill.py stdout was {proc.stdout!r}, expected it to "
        "contain 'skill ok'"
    )


def test_leg_f_committed_files_carry_no_shouted_imperative():
    """(f)[M6] the BASE fact this leg compares against: neither file's
    `git show HEAD:` bytes carry a shouted imperative (see `SHOUTY`)."""
    for rel_path in (SKILL_REL, FIRST_RUN_REL):
        committed = set(SHOUTY_RE.findall(git_show(rel_path)))
        assert committed == set(), (
            f"(f)[M6] the committed bytes of {rel_path} carry the shouted "
            f"word(s) {sorted(committed)!r}"
        )


def test_leg_f_neither_file_gains_a_shouted_imperative():
    """(f)[M6] the set of upper-case whole-word matches in each working-tree
    file equals the set in its `git show HEAD:` bytes."""
    for path, rel_path in ((SKILL, SKILL_REL), (FIRST_RUN, FIRST_RUN_REL)):
        committed = set(SHOUTY_RE.findall(git_show(rel_path)))
        working = set(SHOUTY_RE.findall(read(path)))
        assert working == committed, (
            f"(f)[M6] {rel_path} gained the upper-case whole-word "
            f"{sorted(working - committed)!r} that its committed bytes do not "
            "carry"
        )
