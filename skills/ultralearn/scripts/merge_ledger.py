#!/usr/bin/env python3
"""ultralearn ledger merge — append reader findings to the committed ledger
behind a fail-closed redaction guard, then regenerate the markdown digest.
Only abstracted findings from foreign runs may be committed."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

LENSES = ["friction", "routing", "operator", "cost", "frontier"]


def finding_id(finding):
    key = json.dumps({k: finding.get(k) for k in ("runId", "lens", "title")},
                     sort_keys=True)
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def redact_finding(finding, origin, engine_version=None):
    """Return the finding (with id + origin, and engineVersion when known) if
    safe to commit, else None. Fails closed: any origin other than 'home'
    requires evidenceAbstracted. engine_version is a plain version string (the
    bundle's engineVersion.epoch); a None epoch is omitted, not stored as null."""
    if origin != "home" and not finding.get("evidenceAbstracted"):
        return None
    out = dict(finding)
    out["id"] = finding_id(finding)
    out["origin"] = origin
    if engine_version is not None:
        out["engineVersion"] = engine_version
    return out


def _read_jsonl(path):
    path = Path(path)
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def merge_findings(findings, ledger_path, origin_lookup, engine_lookup=None):
    ledger_path = Path(ledger_path)
    existing = _read_jsonl(ledger_path)
    seen = {f.get("id") for f in existing}
    added = []
    for f in findings:
        origin = origin_lookup(f.get("runId"))
        engine_version = engine_lookup(f.get("runId")) if engine_lookup else None
        red = redact_finding(f, origin, engine_version)
        if red is None or red["id"] in seen:
            continue
        seen.add(red["id"])
        added.append(red)
    if added:
        ledger_path.parent.mkdir(parents=True, exist_ok=True)
        with ledger_path.open("a") as fh:
            for f in added:
                fh.write(json.dumps(f, sort_keys=True) + "\n")
    return {"added": len(added), "skipped": len(findings) - len(added)}


def regenerate_digest(ledger_path, digest_path):
    findings = _read_jsonl(ledger_path)
    by_lens = {lens: [] for lens in LENSES}
    for f in findings:
        by_lens.setdefault(f.get("lens", "other"), []).append(f)
    lines = ["# ultralearn — observation ledger (digest)", "",
             f"{len(findings)} finding(s) across {len({f.get('runId') for f in findings})} run(s).", ""]
    for lens in LENSES:
        items = by_lens.get(lens, [])
        if not items:
            continue
        lines.append(f"## {lens} ({len(items)})")
        for f in sorted(items, key=lambda x: -(x.get("severity", 0) * (x.get("novelty", 0) + 1))):
            tag = "" if f.get("origin") == "home" else " _(abstracted)_"
            ev = f.get("engineVersion")
            vtag = f" _(v{ev})_" if ev else ""
            lines.append(f"- **{f.get('title','')}** — {f.get('implication','')} "
                         f"`{f.get('surface','')}`{vtag}{tag}")
        lines.append("")
    Path(digest_path).parent.mkdir(parents=True, exist_ok=True)
    Path(digest_path).write_text("\n".join(lines))


def bundle_lookups(cache_dir):
    """Build (origin_lookup, engine_lookup) over the cached run bundles at
    <cache_dir>/runs/<runId>/bundle.json. origin fails closed to 'foreign'; the
    engine epoch is None when the bundle or field is missing. Each bundle is read
    at most once. Pass both to merge_findings so ledger entries carry the
    ultrapowers version a finding was observed under, surfaced in the digest."""
    cache_dir = Path(cache_dir)
    cache = {}

    def _bundle(run_id):
        key = str(run_id)
        if key not in cache:
            try:
                cache[key] = json.loads(
                    (cache_dir / "runs" / key / "bundle.json").read_text())
            except (OSError, json.JSONDecodeError):
                cache[key] = {}
        return cache[key]

    def origin_lookup(run_id):
        return _bundle(run_id).get("origin") or "foreign"

    def engine_lookup(run_id):
        ev = _bundle(run_id).get("engineVersion")
        return ev.get("epoch") if isinstance(ev, dict) else None

    return origin_lookup, engine_lookup
