import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import complexity_metric as cm


def test_metrics_basic(tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("a (b) (c) line one.\nNo parens here. See #29 and #4afb.\n")
    m = cm.compute_metrics([str(f)])
    assert m["parensPerLine"][str(f)] == 1.0          # 2 '(' over 2 lines
    assert m["distinctIssueRefs"] == 2                  # #29, #4afb
    assert m["engineLoc"] == 2
    assert m["longestRuleChars"] >= len("a (b) (c) line one.")


def test_verdict_flags_regression():
    base = {"parensPerLine": {"x": 0.5}, "longestRuleChars": 100, "distinctIssueRefs": 5, "engineLoc": 10}
    worse = {"parensPerLine": {"x": 0.7}, "longestRuleChars": 100, "distinctIssueRefs": 5, "engineLoc": 10}
    lines = cm.verdict(worse, base)
    assert any("x" in l for l in lines) and len(lines) == 1
    assert cm.verdict(base, base) == []
