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
    live = cm.compute_metrics(Path(cm.__file__).resolve().parents[3])
    assert set(base) == set(live)  # same counters, no stale or missing keys
    assert all(isinstance(v, int) for v in live.values())
    assert live["standingConcepts"] == sum(live[k] for k in cm.CONCEPT_KEYS)


def test_all_surfaces_exist():
    root = Path(cm.__file__).resolve().parents[3]
    for path in set(cm.SURFACES.values()):
        assert (root / path).is_file(), f"metric surface missing: {path}"


def test_verdict_is_quiet_at_baseline_and_flags_regressions():
    base = {"skillSteps": 15, "engineKnobs": 9, "skillWords": 2000}
    assert cm.verdict(base, base) == []
    worse = {"skillSteps": 16, "engineKnobs": 9, "skillWords": 2100}
    lines = cm.verdict(worse, base)
    assert "skillSteps rose 15 -> 16" in lines
    assert "skillWords rose 2000 -> 2100" in lines
    assert not any("engineKnobs" in l for l in lines)  # unchanged -> silent


def test_verdict_ignores_improvements():
    base = {"skillSteps": 15, "skillWords": 2000}
    better = {"skillSteps": 14, "skillWords": 1900}
    assert cm.verdict(better, base) == []
