#!/usr/bin/env python3
"""Vault an eval fixture's acceptance suite and print its Acceptance line.

Usage: seal_fixture.py <fixture-name> [--vault DIR]
Copies evals/fixtures/<name>/acceptance/ into the vault under its seal-id,
writes manifest.json, and prints the exact line to add to the fixture plan.
Idempotent: re-running overwrites the same vault entry (hash-addressed).
"""
import argparse
import datetime
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from seal_hash import suite_hash  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fixture")
    ap.add_argument("--vault", default=str(pathlib.Path.home() / ".ultrapowers/acceptance"))
    args = ap.parse_args()
    suite = ROOT / "evals/fixtures" / args.fixture / "acceptance"
    if not suite.is_dir():
        sys.exit(f"no acceptance suite at {suite}")
    digest = suite_hash(suite)
    seal_id = digest[:12]
    entry = pathlib.Path(args.vault) / seal_id
    if entry.exists():
        shutil.rmtree(entry)
    (entry / "suite").parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(suite, entry / "suite")
    (entry / "manifest.json").write_text(json.dumps({
        "sealId": seal_id, "planPath": f"evals/fixtures/{args.fixture}/plan.md",
        "specPath": None, "suiteSha256": digest,
        "runCmd": "python3 -m pytest .ultra-acceptance -q",
        "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "baselineSha": None, "redEvidence": "pre-existing eval suite, sealed retroactively",
        "coverage": []}, indent=2))
    print(f"**Acceptance:** sealed {seal_id} (sha256:{digest})")


if __name__ == "__main__":
    main()
