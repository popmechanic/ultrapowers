import sys, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultralearn/scripts"))
import complexity_metric as cm

BASELINE = ROOT / "skills/ultralearn/complexity-baseline.json"

def test_baseline_is_shape_current():
    """Advisory: the baseline must exist and carry every metric key for the current
    surfaces. It does NOT fail on a metric increase — G2 is advisory by default.

    The committed baseline stores repo-RELATIVE surface keys so the artifact
    survives the wave merge and CI (where the absolute repo root differs from any
    one implementer worktree). compute_metrics keys parensPerLine by whatever path
    string it is handed (absolute, here), so we relativize the live keys against the
    repo root before comparing sets — never the transient absolute paths."""
    base = json.loads(BASELINE.read_text())
    for k in ("parensPerLine", "longestRuleChars", "distinctIssueRefs", "engineLoc"):
        assert k in base
    root = Path(cm.__file__).resolve().parents[3]
    raw = cm.compute_metrics([str(root / p) for p in cm.GATE_SURFACES])
    current = {
        "parensPerLine": {str(Path(k).relative_to(root)): v
                          for k, v in raw["parensPerLine"].items()},
        "longestRuleChars": raw["longestRuleChars"],
        "distinctIssueRefs": raw["distinctIssueRefs"],
        "engineLoc": raw["engineLoc"],
    }
    assert set(base["parensPerLine"]) == set(current["parensPerLine"])  # same surfaces
    # Advisory only: surface deltas to stdout, never assert them down.
    for line in cm.verdict(current, base):
        print("RATCHET (advisory):", line)
