#!/usr/bin/env python3
"""ultralearn ledger merge — append reader findings to the committed ledger
behind a fail-closed redaction guard, then regenerate the markdown digest.
Only abstracted findings from foreign runs may be committed."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _outcome import swallow  # noqa: E402  (marks every deliberate skip)

LENSES = ["friction", "routing", "operator", "cost", "frontier"]

# #696: a bundle whose engineVersion.basis is one of these carries a version
# GUESSED from the run's date, not read from anything. The guess dated whole
# eras of findings to versions the plugin never released, so a date-basis
# bundle now stamps no version at all: an absent stamp is honest, a wrong one
# is not. The read bases — "explicit" (the harvester was told), and
# "plugin-cache-path" (a foreign run's own cache directory named it) — stay
# trusted, as does a bundle with no basis key (August's, written before the
# field existed).
DATE_GUESS_BASES = frozenset({"home-repo-date", "foreign-date-upper-bound"})


def finding_id(finding):
    key = json.dumps({k: finding.get(k) for k in ("runId", "lens", "title")},
                     sort_keys=True)
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def redact_finding(finding, origin, engine_version=None):
    """Return the finding (with id + origin, and engineVersion when known) if
    safe to commit, else None. Origin is one of "home" | "foreign" |
    "synthetic" (eval-cell runs; field statistics exclude synthetic rows by
    construction). Fails closed: any origin other than 'home' commits
    abstracted findings only. engine_version is a plain version string (the
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
            except json.JSONDecodeError as exc:
                swallow("malformed ledger line skipped; the rest of the "
                        "ledger still reads", exc)
                continue
    return out


def merge_findings(findings, ledger_path, origin_lookup, engine_lookup=None,
                   released=None):
    """Append the committable findings to the ledger; return counts.

    `released` is the set of version strings this plugin actually released
    (`_readers.released_versions()`). When it is given, a finding whose engine
    lookup answers a version outside it is refused — not written, and counted
    under `refused`. A lookup answering None is not refused on that ground:
    an unknown version is a missing stamp, not a false one. When `released` is
    None the history is not there to judge by, so nothing is refused for its
    version. `skipped` stays `len(findings) - added`, so a refused finding is
    skipped too."""
    ledger_path = Path(ledger_path)
    existing = _read_jsonl(ledger_path)
    seen = {f.get("id") for f in existing}
    added = []
    refused = 0
    for f in findings:
        origin = origin_lookup(f.get("runId"))
        engine_version = engine_lookup(f.get("runId")) if engine_lookup else None
        if (released is not None and isinstance(engine_version, str)
                and engine_version not in released):
            refused += 1
            continue
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
    return {"added": len(added), "skipped": len(findings) - len(added),
            "refused": refused}


def _redirect_rate_table(findings):
    """#220: aggregate structured redirect-round counts by engineVersion.
    Rows lacking a well-formed redirectRounds (dict with int total) are
    skipped — historical prose-only rows never enter the table. One row per
    runId: the LAST qualifying ledger row wins (append-only → most recent).
    A version's rate renders "—" unless every counted row carries an integer
    implementationTasks (a partial denominator would inflate the rate)."""
    latest = {}
    for f in findings:
        rr = f.get("redirectRounds")
        if (isinstance(rr, dict) and isinstance(rr.get("total"), int)
                and not isinstance(rr.get("total"), bool)):
            latest[f.get("runId")] = f
    by_ver = {}
    for f in latest.values():
        ver = f.get("engineVersion") or "unknown"
        row = by_ver.setdefault(ver, {"runs": 0, "rounds": 0, "tasks": 0,
                                      "tasksKnown": True})
        row["runs"] += 1
        row["rounds"] += f["redirectRounds"]["total"]
        tasks = f.get("implementationTasks")
        if isinstance(tasks, int) and not isinstance(tasks, bool):
            row["tasks"] += tasks
        else:
            row["tasksKnown"] = False
    if not by_ver:
        return []
    lines = ["## redirect-round rate by engineVersion", "",
             "| engineVersion | n runs | Σ rounds | Σ tasks | rate |",
             "| --- | --- | --- | --- | --- |"]
    for ver in sorted(by_ver):
        row = by_ver[ver]
        if row["tasksKnown"] and row["tasks"] > 0:
            rate = f"{row['rounds'] / row['tasks']:.2f}"
        else:
            rate = "—"
        lines.append(f"| {ver} | {row['runs']} | {row['rounds']} "
                     f"| {row['tasks']} | {rate} |")
    lines.append("")
    return lines


def regenerate_digest(ledger_path, digest_path):
    findings = _read_jsonl(ledger_path)
    by_lens = {lens: [] for lens in LENSES}
    for f in findings:
        by_lens.setdefault(f.get("lens", "other"), []).append(f)
    lines = ["# ultralearn — observation ledger (digest)", "",
             f"{len(findings)} finding(s) across {len({f.get('runId') for f in findings})} run(s).", ""]
    lines.extend(_redirect_rate_table(findings))
    for lens in LENSES:
        items = by_lens.get(lens, [])
        if not items:
            continue
        lines.append(f"## {lens} ({len(items)})")
        for f in sorted(items, key=lambda x: -(x.get("severity", 0) * (x.get("novelty", 0) + 1))):
            if f.get("origin") == "home":
                tag = ""
            elif f.get("origin") == "synthetic":
                tag = " _(synthetic)_"
            else:
                tag = " _(abstracted)_"
            ev = f.get("engineVersion")
            vtag = f" _(v{ev})_" if ev else ""
            lines.append(f"- **{f.get('title','')}** — {f.get('implication','')} "
                         f"`{f.get('surface','')}`{vtag}{tag}")
        lines.append("")
    Path(digest_path).parent.mkdir(parents=True, exist_ok=True)
    Path(digest_path).write_text("\n".join(lines))


def _opened_at(bundle):
    """A bundle's `events.openedAt`, or -inf so a bundle without one sorts
    below every bundle that has one."""
    opened = (bundle.get("events") or {}).get("openedAt")
    if isinstance(opened, (int, float)) and not isinstance(opened, bool):
        return opened
    return float("-inf")


def bundle_lookups(cache_dir):
    """Build (origin_lookup, engine_lookup) over the cached run bundles under
    <cache_dir>/runs/*/bundle.json. origin fails closed to 'foreign'; the engine
    epoch is None when the bundle or field is missing, and None again when the
    bundle's `engineVersion.basis` says the epoch was guessed from a date
    (DATE_GUESS_BASES) rather than read. Each bundle is read at
    most once. Pass both to merge_findings so ledger entries carry the
    ultrapowers version a finding was observed under, surfaced in the digest.

    The ledger's runId is the bare `run-30`, and the harvester's cache key is
    `run-30-<opening date>`, so a lookup by directory name alone would fail
    closed to 'foreign' for every fleet run. A run's candidates are therefore
    the directory named exactly for it (August's caches are keyed that way, and
    they still answer) plus every bundle whose `runId` field names it; the one
    with the greatest `events.openedAt` wins, so a restarted numbering reads as
    its most recent run rather than as whichever directory sorts first."""
    cache_dir = Path(cache_dir).expanduser()
    cache = {}
    by_dir = {}
    scanned = []

    def _scan():
        """`<directory name> -> bundle`, read once and lazily: a lookup pair
        over a cache of N runs costs one directory walk, not one per id."""
        if scanned:
            return by_dir
        scanned.append(True)
        try:
            entries = sorted((cache_dir / "runs").iterdir())
        except OSError as exc:
            swallow("run cache unreadable; every origin falls closed to "
                    "'foreign'", exc)
            return by_dir
        for entry in entries:
            path = entry / "bundle.json"
            if not path.is_file():
                continue
            try:
                bundle = json.loads(path.read_text())
            except (OSError, json.JSONDecodeError) as exc:
                swallow("bundle unreadable; it is not a lookup candidate and "
                        "its origin falls closed to 'foreign'", exc)
                continue
            if isinstance(bundle, dict):
                by_dir[entry.name] = bundle
        return by_dir

    def _bundle(run_id):
        key = str(run_id)
        if key not in cache:
            candidates = [b for name, b in _scan().items()
                          if name == key or b.get("runId") == key]
            cache[key] = max(candidates, key=_opened_at, default={})
        return cache[key]

    def origin_lookup(run_id):
        return _bundle(run_id).get("origin") or "foreign"

    def engine_lookup(run_id):
        ev = _bundle(run_id).get("engineVersion")
        if not isinstance(ev, dict):
            return None
        if ev.get("basis") in DATE_GUESS_BASES:
            return None            # a date guess is not a version this reads
        return ev.get("epoch")

    return origin_lookup, engine_lookup
