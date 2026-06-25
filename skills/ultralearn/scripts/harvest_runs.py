#!/usr/bin/env python3
"""ultralearn harvester — detect real ultrapowers runs across projects and
build per-run bundles into a local cache. Read-only and advisory: malformed or
missing input is skipped with a diagnostic, never raised."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
import audit_run  # noqa: E402  (provides audit())

SLICE_KEYWORDS = ("wave", "integrationbranch", "/ultrapowers", "gate",
                  "transcript dir", "recommended", "depends-on")


def _block_text(block):
    """Flatten a content block's text (handles nested tool_result content)."""
    if not isinstance(block, dict):
        return ""
    t = block.get("text")
    if isinstance(t, str):
        return t
    c = block.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(_block_text(b) for b in c)
    return ""


def _iter_blocks(records):
    for r in records:
        content = (r.get("message") or {}).get("content")
        if isinstance(content, list):
            for b in content:
                yield r, b


def is_real_run(records):
    saw_workflow, saw_dir, saw_report = False, False, False
    for _r, b in _iter_blocks(records):
        if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == "Workflow":
            saw_workflow = True
        if isinstance(b, dict) and b.get("type") == "tool_result":
            txt = _block_text(b)
            if "Transcript dir:" in txt:
                saw_dir = True
            if "integrationBranch" in txt:
                saw_report = True
    return saw_workflow and (saw_dir or saw_report)


def classify_origin(project_slug, home_slug):
    if project_slug == home_slug or project_slug.startswith(home_slug + "--"):
        return "home"
    return "foreign"


def slice_transcript(records):
    lines = []
    for r, b in _iter_blocks(records):
        rtype = r.get("type")
        txt = _block_text(b).strip()
        if not txt:
            continue
        if rtype == "user" and b.get("type") == "text":
            lines.append(f"**user:** {txt}")
        elif any(k in txt.lower() for k in SLICE_KEYWORDS):
            lines.append(f"**{rtype}:** {txt}")
    return "\n\n".join(lines)


def _plan_path(records):
    for _r, b in _iter_blocks(records):
        txt = _block_text(b)
        if "/ultrapowers " in txt:
            tail = txt.split("/ultrapowers ", 1)[1].split()[0].strip()
            return tail or None
    return None


def stitch_planning(plan_path, projects_root, session_records):
    if not plan_path:
        return {"planningFound": False, "planningSlice": "", "planningSource": None}
    for _r, b in _iter_blocks(session_records):
        if isinstance(b, dict) and b.get("type") == "tool_use" \
                and b.get("name") in ("Write", "Edit") \
                and (b.get("input") or {}).get("file_path", "").endswith(plan_path.lstrip(".")):
            return {"planningFound": True,
                    "planningSlice": slice_transcript(session_records),
                    "planningSource": "same-session"}
    return {"planningFound": False, "planningSlice": "", "planningSource": None}


def _records(session_path):
    out = []
    for line in Path(session_path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _gate_report(records):
    for _r, b in _iter_blocks(records):
        txt = _block_text(b)
        i = txt.find('{"integrationBranch"')
        if i == -1:
            i = txt.find('"integrationBranch"')
            if i != -1:
                i = txt.rfind("{", 0, i)
        if i != -1:
            try:
                return json.loads(txt[i:txt.rindex("}") + 1])
            except (json.JSONDecodeError, ValueError):
                continue
    return None


def _transcript_dir(records):
    for _r, b in _iter_blocks(records):
        txt = _block_text(b)
        if "Transcript dir:" in txt:
            tail = txt.split("Transcript dir:", 1)[1].strip().splitlines()[0]
            return tail.strip().rstrip("\\").strip() or None
    return None


def build_bundle(session_path, project_slug, cache_dir, home_slug):
    try:
        records = _records(session_path)
    except OSError:
        return None
    if not is_real_run(records):
        return None
    session_id = Path(session_path).stem
    run_id = hashlib.sha256(f"{project_slug}/{session_id}".encode()).hexdigest()[:16]
    tdir = _transcript_dir(records)
    bundle = {
        "runId": run_id,
        "sessionId": session_id,
        "projectSlug": project_slug,
        "origin": classify_origin(project_slug, home_slug),
        "planPath": _plan_path(records),
        "transcriptDir": tdir,
        "gateReport": _gate_report(records),
        "audit": audit_run.audit(tdir) if tdir else {"agents": [], "note": "no transcript dir"},
        "planningFound": stitch_planning(_plan_path(records),
                                         Path(session_path).parent.parent, records)["planningFound"],
    }
    out = Path(cache_dir) / "runs" / run_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2))
    (out / "slice.md").write_text(slice_transcript(records))
    return out


def _load_watermark(cache_dir):
    wm = Path(cache_dir) / "watermark.json"
    if wm.exists():
        try:
            return set(json.loads(wm.read_text()))
        except (json.JSONDecodeError, OSError):
            return set()
    return set()


def _save_watermark(cache_dir, seen):
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    (Path(cache_dir) / "watermark.json").write_text(json.dumps(sorted(seen)))


def harvest(projects_root, cache_dir, home_slug):
    projects_root, cache_dir = Path(projects_root), Path(cache_dir)
    seen = _load_watermark(cache_dir)
    new_bundles = []
    if not projects_root.is_dir():
        print(f"ultralearn: no projects root at {projects_root}", file=sys.stderr)
        return []
    for proj in sorted(projects_root.iterdir()):
        if not proj.is_dir():
            continue
        for session in sorted(proj.glob("*.jsonl")):
            key = f"{proj.name}/{session.stem}"
            if key in seen:
                continue
            try:
                bundle = build_bundle(session, proj.name, cache_dir, home_slug)
            except Exception as exc:  # advisory: never crash a sweep
                print(f"ultralearn: skipped {key}: {exc}", file=sys.stderr)
                bundle = None
            seen.add(key)
            if bundle is not None:
                new_bundles.append(bundle)
    _save_watermark(cache_dir, seen)
    return new_bundles


def _default_home_slug():
    return str(Path(__file__).resolve().parents[3]).replace("/", "-")


def main(argv=None):
    argv = argv or sys.argv[1:]
    projects = Path(argv[0]) if argv else Path.home() / ".claude/projects"
    cache = Path.home() / ".claude/ultralearn"
    bundles = harvest(projects, cache, _default_home_slug())
    print(f"ultralearn: {len(bundles)} new run bundle(s) under {cache}/runs")
    for b in bundles:
        print(f"  - {b}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
