"""complexity_metric: the baseline stays shape-current AND verdict() actually
detects regressions. The repo-level ratchet remains advisory (G2) — what must
be TESTED is the mechanism, not a hard gate on today's numbers."""
import sys, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultralearn/scripts"))
import complexity_metric as cm

BASELINE = ROOT / "skills/ultralearn/complexity-baseline.json"


def test_baseline_is_shape_current():
    base = json.loads(BASELINE.read_text())
    for k in ("parensPerLine", "longestRuleChars", "distinctIssueRefs", "engineLoc"):
        assert k in base
    root = Path(cm.__file__).resolve().parents[3]
    raw = cm.compute_metrics([str(root / p) for p in cm.GATE_SURFACES])
    live = {str(Path(k).relative_to(root)) for k in raw["parensPerLine"]}
    assert set(base["parensPerLine"]) == live  # same surfaces


def test_verdict_is_quiet_at_baseline_and_flags_regressions():
    base = {"parensPerLine": {"a.md": 0.5}, "longestRuleChars": 100,
            "distinctIssueRefs": 3, "engineLoc": 1000}
    assert cm.verdict(base, base) == []
    worse = {"parensPerLine": {"a.md": 0.7}, "longestRuleChars": 150,
             "distinctIssueRefs": 3, "engineLoc": 1200}
    lines = cm.verdict(worse, base)
    assert any(l.startswith("parensPerLine[a.md] rose") for l in lines)
    assert "longestRuleChars rose 100 -> 150" in lines
    assert "engineLoc rose 1000 -> 1200" in lines
    assert not any("distinctIssueRefs" in l for l in lines)  # unchanged → silent


def test_verdict_ignores_improvements():
    base = {"parensPerLine": {"a.md": 0.5}, "longestRuleChars": 100,
            "distinctIssueRefs": 3, "engineLoc": 1000}
    better = {"parensPerLine": {"a.md": 0.3}, "longestRuleChars": 80,
              "distinctIssueRefs": 2, "engineLoc": 900}
    assert cm.verdict(better, base) == []
