"""collect_seal.py: deterministic collect-case detection. The sealed case's
Acceptance line is derived from manifest.suiteSha256 — never specSha256
(hand-copying between the manifest's two hashes was a live 0.0.35 defect:
SEAL_BROKEN false-blocks in 2 of 10 field runs)."""
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COLLECT = ROOT / "skills/ultrapowers/scripts/collect_seal.py"

SUITE_SHA = "ab" * 32          # a fake but well-formed sha256
SEAL_ID = SUITE_SHA[:12]


def run_collect(spec, vault):
    r = subprocess.run(
        [sys.executable, str(COLLECT), str(spec), "--vault", str(vault)],
        capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def write_spec(tmp_path, text="# spec\nthe feature behaves like X\n"):
    spec = tmp_path / "spec.md"
    spec.write_text(text)
    return spec, hashlib.sha256(spec.read_bytes()).hexdigest()


def make_sealed(vault, spec_sha, *, suite_sha=SUITE_SHA, extra=None):
    entry = vault / suite_sha[:12]
    (entry / "suite").mkdir(parents=True)
    manifest = {"sealId": suite_sha[:12], "specSha256": spec_sha,
                "suiteSha256": suite_sha,
                "runCmd": "python3 -m pytest .ultra-acceptance -q"}
    manifest.update(extra or {})
    (entry / "manifest.json").write_text(json.dumps(manifest))
    return entry


def test_sealed_case_line_is_verbatim_and_uses_suite_hash(tmp_path):
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    make_sealed(vault, sha)
    out = run_collect(spec, vault)
    assert out["case"] == "sealed"
    assert out["sealId"] == SEAL_ID
    assert out["suiteSha256"] == SUITE_SHA
    assert out["acceptanceLine"] == (
        f"**Acceptance:** sealed {SEAL_ID} (sha256:{SUITE_SHA})")


def test_sealed_line_never_carries_the_spec_hash(tmp_path):
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    make_sealed(vault, sha)
    out = run_collect(spec, vault)
    assert sha not in out["acceptanceLine"], (
        "the Acceptance line must carry suiteSha256; stamping specSha256 "
        "is the SEAL_BROKEN false-block defect")


def test_coverage_is_passed_through(tmp_path):
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    cov = [{"criterion": "X happens", "tests": ["test_x"]}]
    make_sealed(vault, sha, extra={"coverage": cov})
    assert run_collect(spec, vault)["coverage"] == cov


def test_seal_for_a_different_spec_is_not_a_match(tmp_path):
    spec, _sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    make_sealed(vault, "0" * 64)          # someone else's seal
    assert run_collect(spec, vault)["case"] == "none"


def test_edited_spec_matches_nothing(tmp_path):
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    make_sealed(vault, sha)
    spec.write_text("# spec\nedited after dispatch\n")
    assert run_collect(spec, vault)["case"] == "none"


def test_pending_draft_manifest_is_not_a_sealed_match(tmp_path):
    # Manifest-first authoring means pending dirs now hold manifest.json
    # DRAFTS (no suiteSha256). A draft must never satisfy the sealed case.
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    pending = vault / f"pending-{sha[:12]}"
    pending.mkdir(parents=True)
    (pending / "manifest.json").write_text(json.dumps(
        {"specSha256": sha, "runCmd": "python3 -m pytest .ultra-acceptance -q"}))
    (pending / "dispatch.json").write_text(json.dumps(
        {"specPath": str(spec), "specSha256": sha, "dispatchedAt": "t"}))
    out = run_collect(spec, vault)
    assert out["case"] == "pending"
    assert out["dispatch"]["specSha256"] == sha


def test_outcome_record_reports_failure_case(tmp_path):
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    pending = vault / f"pending-{sha[:12]}"
    pending.mkdir(parents=True)
    record = {"status": "GREEN_AT_BASELINE", "specSha256": sha,
              "evidence": "all green at base", "createdAt": "t"}
    (pending / "outcome.json").write_text(json.dumps(record))
    out = run_collect(spec, vault)
    assert out["case"] == "failure"
    assert out["outcome"] == record


def test_empty_or_missing_vault_is_none(tmp_path):
    spec, sha = write_spec(tmp_path)
    out = run_collect(spec, tmp_path / "no-such-vault")
    assert out == {"case": "none", "specSha256": sha}
