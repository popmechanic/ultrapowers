# tests/test_audit_refactor.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts"))
import audit_run

FIX = Path(__file__).resolve().parents[1] / "tests/fixtures/ultralearn/audit"

def test_audit_returns_structured_dict():
    out = audit_run.audit(FIX)
    assert isinstance(out, dict)
    assert set(out) >= {"agents", "totals", "misrankCandidates"}
    assert isinstance(out["agents"], list) and len(out["agents"]) == 1
    a = out["agents"][0]
    assert set(a) >= {"role", "model", "turns", "outputTokens"}
    assert out["totals"]["turns"] == a["turns"]

def test_audit_missing_dir_is_advisory():
    out = audit_run.audit(Path("/no/such/dir"))
    assert out["agents"] == []
    assert "note" in out
