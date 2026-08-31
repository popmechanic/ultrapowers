"""Pin: the greenfield stack defaults exist as authoring guidance, SKILL.md
points at them, and the two canonical knob strings are stated verbatim (#425).
The strings are quoted by fleet/fitness.mjs's nudge and by the Bun eval
fixture; this is the one place they are defined."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
REF = ROOT / "skills/ultraplan/references/greenfield-stack.md"
SKILL = ROOT / "skills/ultraplan/SKILL.md"

TEST_CMD = "bunx tsc --noEmit && bun test"
BOOTSTRAP_CMD = "bun install"


def test_reference_exists_and_states_the_canonical_knobs():
    assert REF.is_file()
    text = REF.read_text()
    assert TEST_CMD in text
    assert BOOTSTRAP_CMD in text
    # bare `tsc` needs a global install; the deviation from #425's prose is
    # deliberate and must stay documented where an author will see it.
    assert "bunx" in text
    # the engine boundary is the point of the whole restriction
    assert "engine" in text.lower()


def test_skill_points_at_the_reference():
    assert "references/greenfield-stack.md" in SKILL.read_text()


# The word-ceiling test that stood here is DELETED (#492), along with
# tests/test_skill_budget.py, which owned the number it delegated to.
#
# The record the deletion is paid with: zero observed instances of a cap
# preventing bloat, three of it causing harm — a 1000 cap on a 354-word file
# that bound nothing for months; a cap at ONE word of headroom that made an
# implementer delete a normative rule to pay an arithmetically impossible
# budget (run-31, #455); and the same number stated in two files, contradicting
# itself silently from the moment 0.3.1 merged (the defect this very test was
# rewritten to fix, #491).
#
# The replacement, named so it does not grow back: CAP WHAT IS READ, NOT WHAT
# IS STORED. `fleet/run-engine.mjs:142` loads `fleet/roles/*.md` at dispatch —
# the only prose an agent is MADE to read, already capped at 350 words AT THE
# POINT OF USE (fleet/tests/test_run_engine.mjs). A file ceiling on an
# authoring document measures storage, not attention, and is satisfiable by
# moving bytes sideways.
#
# The count is not lost, only demoted from a gate to a reading: CI's "Report
# skill prose sizes" step prints it on every run, and a release commit body
# records it where the ratchet already lived (#366 Amendment 7).


def test_types_gotcha_is_recorded():
    # @types/bun + "types": ["bun"]; `bun-types` fails TS2688. An author who
    # hits this loses an hour, so the reference must name it.
    text = REF.read_text()
    assert "@types/bun" in text
