import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))

import routing  # noqa: E402
from routing import plan_parse  # noqa: E402

FIXTURE = ROOT / "evals/fixtures/claims/plan.md"


def test_risk_reading_sees_tasks_without_a_type_line(monkeypatch, tmp_path):
    text = re.sub(r"^\*\*Type:\*\*.*\n", "", FIXTURE.read_text(), flags=re.M)
    result, tasks = plan_parse.parse_plan_full(text)
    assert all(t.get("type") is None for t in tasks)

    asked = []
    monkeypatch.setattr(routing, "ask_jev",
                        lambda q, k, payload: asked.append(payload) or None)
    routing.routing_fact_lines(result, tasks, tmp_path / "plan.md")

    assert len(asked) == 1
    assert len(asked[0]["plan"]["tasks"]) == len(result["tasks"]) == 3
