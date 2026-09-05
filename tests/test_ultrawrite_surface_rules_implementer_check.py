"""Implementer's own red/green check for Task 2 (#609 items 1 and 3, #665 (a)).

The graded exam is written by a peer from the same task text; this file is the
implementer's copy of the same contract, kept under a different name so the two
never collide. Every command below is one of the task's `Run:` bullets, run
verbatim through `bash -c` so a passing run here means the same string passes
there.

M1 — the Proof bullet of §The six body slots says an exam file is one per
     behaviour surface and named for it, that a later task extends it, and that
     the task's legs sit under a comment naming the task.
M2 — the same bullet says a `byte-identical to BASE` / `git show HEAD:`
     comparison is a tautology at the integration head, and names the frozen
     pre-edit literal, the 40-hex sha and `git fetch --depth=1 origin <sha>`.
M3 — rule 4 of §Decomposition judgment names the adjacent-insert shape, the
     resolver, run-12's five tasks and three resolver workers, and the
     registration-is-a-new-file rule.
M4 — §Self-review carries the exam-file-naming line.
M5 — the skill still validates and its shouted-word counts stay at BASE's zeros
     (frozen literals from `0a3559a`, not a read-back of HEAD).
"""
import pathlib
import re
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = "skills/ultrawrite/SKILL.md"

SIX_SLOTS = (
    "sed -n '/^### The six body slots/,/^## Elicit the claim/p' " + SKILL
)
DECOMPOSITION = (
    "sed -n '/^## Decomposition judgment/,/^## Global Constraints discipline/p' "
    + SKILL
)
SELF_REVIEW = "sed -n '/^## Self-review/,$p' " + SKILL
SQUEEZE = " | tr -s '[:space:]' ' '"


def run(command):
    return subprocess.run(["bash", "-c", command], cwd=ROOT,
                          capture_output=True, text=True)


RUN_BULLETS = [
    # (clause, the Run: command verbatim)
    ("M1", SIX_SLOTS + SQUEEZE + " | grep -q 'one exam file per behaviou\\?r "
     "surface.*named for it.*later task.*extends.*under a comment naming the "
     "task'"),
    ("M1", SIX_SLOTS + SQUEEZE
     + " | grep -q 'one exam file per behaviou\\?r surface'"),
    ("M1", SIX_SLOTS + SQUEEZE + " | grep -q 'later task.*extends'"),
    ("M1", SIX_SLOTS + SQUEEZE
     + " | grep -q 'under a comment naming the task'"),
    ("M2", SIX_SLOTS + SQUEEZE + " | grep -q 'byte-identical to BASE.*git show "
     "HEAD:.*tautology at the integration head.*frozen pre-edit literal.*40-hex "
     "sha.*git fetch --depth=1 origin.*depth'"),
    ("M2", SIX_SLOTS + " | grep -qF -- 'git fetch --depth=1 origin <sha>'"),
    ("M3", DECOMPOSITION + SQUEEZE + " | grep -q 'Let same-file edits "
     "stand.*adjacent inserts at one location.*resolver.*own region or "
     "file.*registration is a new file.*never an appended line'"),
    ("M3", DECOMPOSITION + SQUEEZE
     + " | grep -q 'run-12.*five tasks.*three resolver workers'"),
    ("M4", SELF_REVIEW + SQUEEZE + " | grep -q 'exam file is named for its "
     "behaviou\\?r surface.*comment naming the task'"),
]


@pytest.mark.parametrize("clause,command", RUN_BULLETS,
                         ids=["%s-%d" % (c, i)
                              for i, (c, _) in enumerate(RUN_BULLETS)])
def test_run_bullet_exits_zero(clause, command):
    done = run(command)
    assert done.returncode == 0, (
        "[%s]: `%s` exited %d\n%s%s"
        % (clause, command, done.returncode, done.stdout, done.stderr))


def test_m5_validate_skill_prints_skill_ok():
    done = run("python3 skills/ultrapowers/scripts/validate_skill.py "
               "skills/ultrawrite")
    assert done.returncode == 0, done.stdout + done.stderr
    assert done.stdout.strip() == "skill ok", done.stdout


# The three words are assembled from pieces so this file carries none of them as
# whole words — the same discipline `tests/test_proof_modes_documented.py` keeps.
SHOUT_WORDS = ("NEV" + "ER", "ALW" + "AYS", "MU" + "ST")


def test_m5_shouted_word_counts_stay_at_bases_zeros():
    """Frozen literals from BASE (`0a3559a`), not a read-back of HEAD."""
    text = (ROOT / SKILL).read_text()
    counts = {w: len(re.findall(r"\b" + w + r"\b", text)) for w in SHOUT_WORDS}
    assert counts == {SHOUT_WORDS[0]: 0, SHOUT_WORDS[1]: 0, SHOUT_WORDS[2]: 0}, (
        "%s shouts: %r" % (SKILL, counts))


def test_m5_the_tests_that_read_the_skill_still_pass():
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
         "tests/test_ultrawrite_skill.py", "tests/test_plan_level_claim.py",
         "tests/test_review_peer.py", "tests/test_proof_modes_documented.py",
         "tests/test_compile_plan_check_cost.py",
         "tests/test_compile_plan_prose_check.py",
         "tests/test_compile_plan_integration_hostile.py",
         "tests/test_marker_contract.py"],
        cwd=ROOT, capture_output=True, text=True)
    assert done.returncode == 0, done.stdout[-4000:] + done.stderr[-2000:]
