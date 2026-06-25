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


def redact_finding(finding, origin):
    """Return the finding (with id + origin) if safe to commit, else None.
    Fails closed: any origin other than 'home' requires evidenceAbstracted."""
    if origin != "home" and not finding.get("evidenceAbstracted"):
        return None
    out = dict(finding)
    out["id"] = finding_id(finding)
    out["origin"] = origin
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


def merge_findings(findings, ledger_path, origin_lookup):
    ledger_path = Path(ledger_path)
    existing = _read_jsonl(ledger_path)
    seen = {f.get("id") for f in existing}
    added = []
    for f in findings:
        origin = origin_lookup(f.get("runId"))
        red = redact_finding(f, origin)
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
            lines.append(f"- **{f.get('title','')}** — {f.get('implication','')} "
                         f"`{f.get('surface','')}`{tag}")
        lines.append("")
    Path(digest_path).parent.mkdir(parents=True, exist_ok=True)
    Path(digest_path).write_text("\n".join(lines))
