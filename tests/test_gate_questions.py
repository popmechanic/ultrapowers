"""The authoring gate's caught_v2 question exempts only wiring (#1528), as the gate rule
in skills/ultrawrite/SKILL.md does."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
Q = json.loads((ROOT / "skills/ultrawrite/stories/questions.json").read_text())


def test_caught_v2_exempts_only_wiring():
    q = Q["sets"]["authoring_gate"]["questions"]["caught_v2"]
    text = json.dumps(q)
    assert "which function calls which" in text and "what a function is passed" in text
    for gone in ("order of steps", "logs a line", "shaped"):
        assert gone not in text, gone
    ctx = q["instructions"]["context"]
    for needed in ("an ordering of events", "a byte-exact string", "a line the code prints or logs"):
        assert needed in ctx, needed
