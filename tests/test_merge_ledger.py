import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import merge_ledger as m


def _finding(**kw):
    base = {"runId": "r1", "lens": "frontier", "title": "t", "novelty": 2,
            "severity": 1, "evidence": "raw quote", "evidenceAbstracted": False,
            "implication": "x", "surface": "SKILL.md"}
    base.update(kw)
    return base


def test_home_verbatim_allowed():
    out = m.redact_finding(_finding(), "home")
    assert out is not None and "id" in out and out["origin"] == "home"


def test_foreign_verbatim_rejected():
    assert m.redact_finding(_finding(evidenceAbstracted=False), "foreign") is None


def test_foreign_abstracted_allowed():
    out = m.redact_finding(_finding(evidenceAbstracted=True, evidence="shape only"), "foreign")
    assert out is not None and out["origin"] == "foreign"


def test_unknown_origin_fails_closed():
    assert m.redact_finding(_finding(evidenceAbstracted=False), "mystery") is None


def test_finding_id_is_stable():
    assert m.finding_id(_finding()) == m.finding_id(_finding())


def test_merge_dedups_and_is_idempotent(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    origin = lambda rid: "home"
    f = [_finding(title="a"), _finding(title="b")]
    s1 = m.merge_findings(f, ledger, origin)
    assert s1["added"] == 2
    s2 = m.merge_findings(f, ledger, origin)  # same findings again
    assert s2["added"] == 0
    assert len(ledger.read_text().splitlines()) == 2


def test_merge_applies_redaction(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    origin = lambda rid: "foreign"
    f = [_finding(title="leak", evidenceAbstracted=False)]
    stats = m.merge_findings(f, ledger, origin)
    assert stats["added"] == 0  # foreign verbatim never lands
    assert not ledger.exists() or ledger.read_text().strip() == ""


def test_regenerate_digest_groups_by_lens(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings([_finding(title="a", lens="friction"),
                      _finding(title="b", lens="frontier")],
                     ledger, lambda rid: "home")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    text = digest.read_text()
    assert "friction" in text and "frontier" in text
