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
    # DELEGATES to the single source. This used to hard-code 3038 — a second
    # copy of a number whose home is tests/test_skill_budget.py — and 0.3.1
    # raised the canonical one to 3798 without moving this one, so the two
    # contradicted each other until the next word was added. The obligation
    # this test was written for (#425 greenfield content lands NET-ZERO, paid
    # by trimming rather than by raising the cap) was discharged when #425
    # merged and is recorded in git; freezing an absolute here to re-assert it
    # forever only guaranteed the copies would drift.
    import test_skill_budget
    ceiling = test_skill_budget.CEILINGS["skills/ultraplan/SKILL.md"]
    assert len(SKILL.read_text().split()) <= ceiling


def test_types_gotcha_is_recorded():
    # @types/bun + "types": ["bun"]; `bun-types` fails TS2688. An author who
    # hits this loses an hour, so the reference must name it.
    text = REF.read_text()
    assert "@types/bun" in text
