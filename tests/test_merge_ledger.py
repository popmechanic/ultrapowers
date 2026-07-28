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


def test_engine_version_stamped_when_lookup_provided(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings([_finding(title="a")], ledger,
                     lambda rid: "home", lambda rid: "0.0.10")
    entry = json.loads(ledger.read_text().splitlines()[0])
    assert entry["engineVersion"] == "0.0.10"


def test_engine_version_absent_without_lookup(tmp_path):
    # Backward compatible: the 3-arg form stamps no engineVersion.
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings([_finding(title="a")], ledger, lambda rid: "home")
    entry = json.loads(ledger.read_text().splitlines()[0])
    assert "engineVersion" not in entry


def test_engine_version_none_epoch_is_omitted(tmp_path):
    # An unknown epoch (None) must not write engineVersion: null noise.
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings([_finding(title="a")], ledger,
                     lambda rid: "home", lambda rid: None)
    entry = json.loads(ledger.read_text().splitlines()[0])
    assert "engineVersion" not in entry


def test_digest_shows_engine_version(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings([_finding(title="a", lens="friction")], ledger,
                     lambda rid: "home", lambda rid: "0.0.10")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    assert "0.0.10" in digest.read_text()


def test_bundle_lookups_reads_cache_and_fails_closed(tmp_path):
    run = tmp_path / "runs" / "r1"
    run.mkdir(parents=True)
    (run / "bundle.json").write_text(json.dumps(
        {"origin": "home",
         "engineVersion": {"epoch": "0.0.12", "asOf": "t", "basis": "home-repo-date"}}))
    origin_lookup, engine_lookup = m.bundle_lookups(tmp_path)
    assert origin_lookup("r1") == "home"
    assert engine_lookup("r1") == "0.0.12"
    # missing bundle: origin fails closed to foreign, epoch is unknown
    assert origin_lookup("missing") == "foreign"
    assert engine_lookup("missing") is None


def test_synthetic_verbatim_rejected_abstracted_allowed():
    # synthetic is non-home → fail-closed redaction, same as foreign.
    assert m.redact_finding(_finding(evidenceAbstracted=False), "synthetic") is None
    out = m.redact_finding(_finding(evidenceAbstracted=True, evidence="shape only"),
                           "synthetic")
    assert out is not None and out["origin"] == "synthetic"


def test_digest_tags_synthetic_rows(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    rows = [
        m.redact_finding(_finding(title="synth", evidenceAbstracted=True,
                                  evidence="shape"), "synthetic"),
        m.redact_finding(_finding(title="field", evidenceAbstracted=True,
                                  evidence="shape"), "foreign"),
    ]
    ledger.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    digest = tmp_path / "digest.md"
    m.regenerate_digest(ledger, digest)
    text = digest.read_text()
    synth_line = next(line for line in text.splitlines() if "synth" in line)
    field_line = next(line for line in text.splitlines() if "field" in line)
    assert "_(synthetic)_" in synth_line and "_(abstracted)_" not in synth_line
    assert "_(abstracted)_" in field_line
