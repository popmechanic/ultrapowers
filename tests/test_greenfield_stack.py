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


def test_skill_stays_within_its_pinned_ceiling():
    # the absolute lives in tests/test_skill_budget.py; this asserts the
    # net-zero obligation was honored rather than the ceiling raised.
    assert len(SKILL.read_text().split()) <= 3038


def test_types_gotcha_is_recorded():
    # @types/bun + "types": ["bun"]; `bun-types` fails TS2688. An author who
    # hits this loses an hour, so the reference must name it.
    text = REF.read_text()
    assert "@types/bun" in text
