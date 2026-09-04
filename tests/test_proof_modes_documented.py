"""Pin (Task 3, #589 claims-v2): the three prose documents survive their edit.

What is left here is what a machine can check about the three documents without
matching a sentence of them: `skills/ultrawrite/SKILL.md` still validates, and
none of the three files gained a shouted whole word against BASE.

The verbatim sentence pins that used to sit here (legs (a)-(d) / M1-M4) are
gone: a string assertion establishes that a sentence is present, never that it
produces the behaviour. The behaviour those sentences describe is proved by the
compiler, driver and examiner tests that exercise it.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

SKILL_PATH = "skills/ultrawrite/SKILL.md"
EXAMINER_PATH = "fleet/roles/examiner.md"
MARKERS_PATH = "skills/ultrapowers/references/plan-markers.md"


def read(rel):
    return (ROOT / rel).read_text()


# The three words are assembled from pieces so this file carries none of them as
# whole words: it is itself one of the files the fleet's M7 leg walks, and that leg
# fails a file that gains a shouted word against BASE. The counts stay frozen 0s.
SHOUT_WORDS = ("NEV" + "ER", "ALW" + "AYS", "MU" + "ST")
BASE_SHOUT_COUNTS = {SHOUT_WORDS[0]: 0, SHOUT_WORDS[1]: 0, SHOUT_WORDS[2]: 0}


# --- leg (e) / M5: the skill validates and nothing shouts -------------------

def test_leg_e_m5_validate_skill_prints_skill_ok():
    """(e)/M5 — `validate_skill.py skills/ultrawrite` exits 0 and prints `skill ok`."""
    done = subprocess.run(
        [sys.executable, "skills/ultrapowers/scripts/validate_skill.py", "skills/ultrawrite"],
        cwd=ROOT, capture_output=True, text=True,
    )
    assert done.returncode == 0, (
        f"validate_skill.py exited {done.returncode}:\n{done.stdout}{done.stderr}"
    )
    lines = [line for line in done.stdout.splitlines() if line.strip()]
    assert lines and lines[-1].strip() == "skill ok", (
        f"validate_skill.py printed {done.stdout!r}, not `skill ok`"
    )


def test_leg_e_m5_no_shouted_whole_word_is_added_to_the_three_files():
    """(e)/M5 — whole-word NEV/ALW/MU counts are BASE's 0, 0 and 0 in each file.

    Frozen literals measured at `0a3559a`, not a read-back: against HEAD the
    comparison is a tautology once the edit is committed.
    """
    for rel in (SKILL_PATH, EXAMINER_PATH, MARKERS_PATH):
        text = read(rel)
        counts = {
            word: len(re.findall(r"\b" + word + r"\b", text)) for word in SHOUT_WORDS
        }
        assert counts == BASE_SHOUT_COUNTS, (
            f"{rel} shouts: counts are {counts!r}, BASE 0a3559a had {BASE_SHOUT_COUNTS!r}"
        )
