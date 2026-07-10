#!/usr/bin/env python3
"""Deterministic collect step for sealed acceptance.

Hashes a spec file, scans the vault, and reports which collect case holds —
sealed / failure / pending / none — as one JSON object on stdout. For the
sealed case it prints the exact Acceptance line the plan must carry, derived
from manifest.suiteSha256, so the orchestrator appends it verbatim and never
chooses between the manifest's two hashes (stamping specSha256 was a live
false-block defect). Detection only: the responses to each case stay in the
ultraplan SKILL's collect step.
Spec: docs/superpowers/specs/2026-07-09-sealing-seam-consolidation-design.md
"""
import argparse
import hashlib
import json
import pathlib
import sys


def spec_sha256(spec_path):
    return hashlib.sha256(pathlib.Path(spec_path).read_bytes()).hexdigest()


def _read_json(path):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def collect(spec_path, vault):
    vault = pathlib.Path(vault).expanduser()
    sha = spec_sha256(spec_path)

    # Case: sealed — a non-pending vault entry's manifest records this spec
    # hash. pending-* dirs are skipped: manifest-first authoring leaves a
    # DRAFT manifest (no suiteSha256) in the pending dir, which must never
    # satisfy the sealed case.
    if vault.is_dir():
        for mpath in sorted(vault.glob("*/manifest.json")):
            if mpath.parent.name.startswith("pending-"):
                continue
            m = _read_json(mpath)
            if not m or m.get("specSha256") != sha:
                continue
            seal_id = m.get("sealId") or mpath.parent.name
            suite_sha = m.get("suiteSha256")
            if not suite_sha:
                return {"case": "failure", "specSha256": sha,
                        "error": f"manifest for seal {seal_id} lacks suiteSha256",
                        "manifestPath": str(mpath)}
            return {
                "case": "sealed",
                "specSha256": sha,
                "sealId": seal_id,
                "suiteSha256": suite_sha,
                "acceptanceLine":
                    f"**Acceptance:** sealed {seal_id} (sha256:{suite_sha})",
                "coverage": m.get("coverage"),
            }

    # Cases: failure / pending — the per-dispatch pending dir.
    pending = vault / f"pending-{sha[:12]}"
    outcome = _read_json(pending / "outcome.json")
    if outcome is not None:
        return {"case": "failure", "specSha256": sha,
                "outcome": outcome, "pendingDir": str(pending)}
    dispatch = _read_json(pending / "dispatch.json")
    if dispatch is not None:
        return {"case": "pending", "specSha256": sha,
                "dispatch": dispatch, "pendingDir": str(pending)}

    return {"case": "none", "specSha256": sha}


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Report the sealed-acceptance collect case for a spec file.")
    parser.add_argument("spec", help="path to the approved spec file")
    parser.add_argument(
        "--vault",
        default=str(pathlib.Path.home() / ".ultrapowers" / "acceptance"),
        help="acceptance vault dir (default: ~/.ultrapowers/acceptance)")
    args = parser.parse_args(argv)
    print(json.dumps(collect(args.spec, args.vault), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
