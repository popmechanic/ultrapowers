#!/usr/bin/env python3
"""Generate the ULTRAPOWERS swarm viewer for a plan.

Compiles the plan with compile_plan.py, bakes the resulting DAG and a theme
into the self-contained swarm_template.html, and writes <out>/swarm.html. The
viewer is passive: a static DAG when opened directly (file://), semi-live
when swarm_watch.py is writing status.json next to it and the directory is
served over http (fetch is blocked on file://).

Usage:
  render_viewer.py <plan.md> [--out DIR] [--title TITLE] [--theme NAME]
  render_viewer.py --list-themes
"""
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import audit_run  # sibling module: first_user_text, classify, collect

TEMPLATE = HERE.parent / "viewer" / "swarm_template.html"
DAG_PLACEHOLDER = "/*__DAG_JSON__*/null"
THEME_PLACEHOLDER = "/*__THEME_JSON__*/null"

AUDIT_INDEX_PLACEHOLDER = "/*__AUDIT_INDEX__*/null"
AUDIT_EMBED_PLACEHOLDER = "/*__AUDIT_EMBED__*/null"
AUDIT_JS_PLACEHOLDER = "/*__AUDIT_JS__*/"
AUDIT_JS = HERE.parent / "viewer" / "audit_project.js"

D3DAG_PLACEHOLDER = "/*__D3DAG_JS__*/"
SWARM_LAYOUT_PLACEHOLDER = "/*__SWARM_LAYOUT_JS__*/"
D3DAG_JS = HERE.parent / "viewer" / "vendor" / "d3-dag.iife.min.js"
SWARM_LAYOUT_JS = HERE.parent / "viewer" / "swarm_layout.js"

D3ZOOM_PLACEHOLDER = "/*__D3ZOOM_JS__*/"
SWARM_ZOOM_PLACEHOLDER = "/*__SWARM_ZOOM_JS__*/"
D3ZOOM_JS = HERE.parent / "viewer" / "vendor" / "d3-zoom.iife.min.js"
SWARM_ZOOM_JS = HERE.parent / "viewer" / "swarm_zoom.js"

# Mirror AuditProjection.CAPS in viewer/audit_project.js — keep in sync.
AUDIT_CAPS = {"text": 8192, "toolInput": 4096, "toolResult": 8192, "collapsed": 200}


def theme(name, frame, wave_colors, **vars_):
    return {"name": name, "frame": frame, "waveColors": wave_colors, "vars": vars_}


MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace"

THEMES = {
    # gleaming offwhite on black — Asteroids, not Apple II
    "asteroids": theme(
        "asteroids", "crt", ["#f5f6f0"],
        bg="#07080a", ink="#f5f6f0", bright="#ffffff", dim="#6a6d66",
        faint="#2b2d2b", accent="#ffb347", hud="#8a8d85", agent="#ffffff",
        font=MONO, flick="#eef7f0",
        **{"screen-bg": "radial-gradient(ellipse at 50% 48%,#101113 0%,#07080a 62%,#020203 100%)",
           "scan-o": ".16", "vig-o": "1", "glass-o": "1"}),
}
DEFAULT_THEME = "asteroids"


def build_dag(plan, title):
    compiled = json.loads(subprocess.run(
        [sys.executable, str(HERE / "compile_plan.py"), str(plan)],
        check=True, capture_output=True, text=True).stdout)
    if not title:
        m = re.match(r"#\s*(.+?)(?:\s+Implementation Plan)?\s*$",
                     plan.read_text().splitlines()[0])
        title = m.group(1) if m else plan.stem
    impl = [t for t in compiled["tasks"] if t["disposition"] == "implementation"]
    return {
        "title": title,
        "mode": compiled["mode"],
        "waves": compiled["waves"],
        "waveLabels": compiled.get("waveLabels", []),
        "edges": [[e["from"], e["to"]] for e in compiled["dag_edges"]],
        "tasks": [{"id": t["id"], "title": t["title"]} for t in impl],
    }


def build_index(run_dir):
    """Metadata only — no transcript content. Reuses audit_run's classifier."""
    agents = []
    versions = set()
    for f in sorted(run_dir.glob("agent-*.jsonl")):
        role_full = audit_run.classify(audit_run.first_user_text(f))  # "impl:1" / "merge" / "unknown"
        role, _, task = role_full.partition(":")
        model, turns, out_tokens = audit_run.collect(f)
        tools, first_line = 0, ""
        for line in f.read_text().splitlines():
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if d.get("version"):
                versions.add(d["version"])
            if d.get("type") == "assistant":
                for b in (d.get("message", {}).get("content") or []):
                    if isinstance(b, dict):
                        if b.get("type") == "tool_use":
                            tools += 1
                        if not first_line and b.get("type") == "text":
                            first_line = (b.get("text") or "")[:AUDIT_CAPS["collapsed"]]
        meta = {}
        mp = f.with_suffix(".meta.json")
        if mp.exists():
            try:
                meta = json.loads(mp.read_text())
            except json.JSONDecodeError:
                meta = {}
        agents.append({
            "id": f.stem[len("agent-"):],
            "file": f.name,
            "role": role,
            "task": (task if task and task != "?" else None),
            "model": model,
            "turns": turns,
            "tools": tools,
            "outTokens": out_tokens,
            "firstLine": first_line,
            "worktree": meta.get("worktreePath", ""),
        })
    return {"runId": run_dir.name, "versions": sorted(versions), "agents": agents}


def _trunc_block(b):
    bt = b.get("type")
    if bt == "text":
        return {"type": "text", "text": (b.get("text") or "")[:AUDIT_CAPS["text"]]}
    if bt == "tool_use":
        inp = b.get("input")
        s = json.dumps(inp if inp is not None else {})[:AUDIT_CAPS["toolInput"]]
        return {"type": "tool_use", "name": b.get("name", "?"), "input": s}  # string input: see convergence rule
    if bt == "tool_result":
        c = b.get("content")
        if isinstance(c, list):
            c = " ".join((x.get("text") or "") for x in c if isinstance(x, dict))
        elif not isinstance(c, str):
            c = "" if c is None else str(c)
        return {"type": "tool_result", "content": c[:AUDIT_CAPS["toolResult"]]}
    return {"type": bt or "unknown"}


def marshal_embed(run_dir):
    """For --embed: truncated entries matching AuditProjection.parseLines, so the
    one projectAgent renders both embedded and fetched data. One file at a time."""
    out = {}
    for f in sorted(run_dir.glob("agent-*.jsonl")):
        entries = []
        for line in f.read_text().splitlines():
            if not line.strip():
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = d.get("type")
            if t not in ("assistant", "user"):
                continue
            content = (d.get("message") or {}).get("content")
            if isinstance(content, list):
                blocks = [_trunc_block(b) for b in content if isinstance(b, dict)]
            elif isinstance(content, str):
                blocks = [{"type": "text", "text": content[:AUDIT_CAPS["text"]]}]
            else:
                blocks = []
            entries.append({"type": t, "content": blocks})
        out[f.stem[len("agent-"):]] = entries
    return out


def _js_embed(obj):
    """json.dumps for inlining inside <script>: escape the code points that let
    transcript content break out of the script element or the JS string literal.
    \\u003c renders as '<' in JS, so the decoded data is identical to the reader."""
    s = json.dumps(obj)
    for ch, esc in (("<", "\\u003c"), (">", "\\u003e"),
                    (" ", "\\u2028"), (" ", "\\u2029")):
        s = s.replace(ch, esc)
    return s


def render(dag, theme_name, out_path, audit_index=None, audit_embed=None, audit_js=None):
    html = TEMPLATE.read_text()
    for ph in (DAG_PLACEHOLDER, THEME_PLACEHOLDER, AUDIT_JS_PLACEHOLDER):
        if ph not in html:
            raise SystemExit(f"template placeholder {ph} missing — swarm_template.html was edited?")
    html = html.replace(DAG_PLACEHOLDER, _js_embed(dag))
    html = html.replace(THEME_PLACEHOLDER, _js_embed(THEMES[theme_name]))
    # The projection library is mandatory, not optional: swarm_template references
    # AuditProjection at script load (not just inside the drawer), so it must always
    # be defined or the whole viewer dies with a ReferenceError before it paints. The
    # drawer goes inert through a null AUDIT_INDEX below, never through a missing lib.
    html = html.replace(AUDIT_JS_PLACEHOLDER,
                        audit_js if audit_js is not None else AUDIT_JS.read_text())
    # d3-dag IIFE, d3-zoom IIFE, and the layout/zoom adapters are mandatory — the
    # template references d3 and SwarmLayout/SwarmZoom at load; a missing inline
    # would crash the viewer immediately.
    for ph in (D3DAG_PLACEHOLDER, SWARM_LAYOUT_PLACEHOLDER,
               D3ZOOM_PLACEHOLDER, SWARM_ZOOM_PLACEHOLDER):
        if ph not in html:
            raise SystemExit(f"template placeholder {ph} missing — swarm_template.html was edited?")
    html = html.replace(D3DAG_PLACEHOLDER, D3DAG_JS.read_text())
    html = html.replace(D3ZOOM_PLACEHOLDER, ";\n" + D3ZOOM_JS.read_text())
    html = html.replace(SWARM_LAYOUT_PLACEHOLDER, ";\n" + SWARM_LAYOUT_JS.read_text())
    html = html.replace(SWARM_ZOOM_PLACEHOLDER, ";\n" + SWARM_ZOOM_JS.read_text())
    if audit_index is not None:
        html = html.replace(AUDIT_INDEX_PLACEHOLDER, _js_embed(audit_index))
    if audit_embed is not None:
        html = html.replace(AUDIT_EMBED_PLACEHOLDER, _js_embed(audit_embed))
    out_path.write_text(html)
    return out_path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("plan", nargs="?")
    p.add_argument("--out", default=".", help="directory for swarm.html")
    p.add_argument("--title", help="HUD title (default: plan H1)")
    p.add_argument("--theme", default=DEFAULT_THEME, choices=sorted(THEMES))
    p.add_argument("--list-themes", action="store_true")
    p.add_argument("--transcripts", help="run transcript dir — enables the audit drawer")
    p.add_argument("--embed", action="store_true",
                   help="bake truncated transcript content for offline/file:// use")
    args = p.parse_args()

    if args.list_themes:
        for name in THEMES:
            print(name)
        return
    if not args.plan:
        raise SystemExit("plan path required (or --list-themes)")

    dag = build_dag(pathlib.Path(args.plan), args.title)
    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # The projection library is always inlined by render(); --transcripts only adds
    # the per-run DATA (index, and embedded content when --embed).
    audit_index = audit_embed = None
    if args.transcripts:
        run_dir = pathlib.Path(args.transcripts)
        if not run_dir.is_dir():
            raise SystemExit(f"--transcripts: not a directory: {run_dir}")
        if out_dir.resolve() == run_dir.resolve():
            raise SystemExit("--out must differ from --transcripts (transcripts are read-only)")
        audit_index = build_index(run_dir)
        if args.embed:
            audit_embed = marshal_embed(run_dir)
        else:
            for f in run_dir.glob("agent-*.jsonl"):  # live: symlink, never copy
                link = out_dir / f.name
                if link.is_symlink() or link.exists():
                    link.unlink()
                os.symlink(f.resolve(), link)

    out = render(dag, args.theme, out_dir / "swarm.html",
                 audit_index, audit_embed)
    print(f"wrote {out}  (theme: {args.theme})")
    print(f"  {len(dag['tasks'])} tasks, {len(dag['edges'])} edges, "
          f"{len(dag['waves'])} waves, mode={dag['mode']}")
    print()
    print("semi-live (run from the TARGET repo during an ultrapowers run):")
    print(f"  python3 {HERE / 'swarm_watch.py'} --repo <target-repo> --out {out_dir} &")
    print(f"  (cd {out_dir} && python3 -m http.server 8123)")
    print("  open http://localhost:8123/swarm.html")
    print()
    print(f"static preview: open file://{out.resolve()}")
    print()
    print(f"one command (render + serve + URL): python3 {HERE / 'serve_viewer.py'} {args.plan}")


if __name__ == "__main__":
    main()
