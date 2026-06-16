#!/usr/bin/env python3
"""Generate the ULTRAPOWERS swarm viewer for a plan.

Compiles the plan with compile_plan.py, bakes the resulting DAG and a theme
into the self-contained swarm_template.html, and writes <out>/swarm.html. The
viewer is passive: pure depiction when opened directly (file://), semi-live
when swarm_watch.py is writing status.json next to it and the directory is
served over http (fetch is blocked on file://).

Usage:
  render_viewer.py <plan.md> [--out DIR] [--title TITLE] [--theme NAME | --all]
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

# Mirror AuditProjection.CAPS in viewer/audit_project.js — keep in sync.
AUDIT_CAPS = {"text": 8192, "toolInput": 4096, "toolResult": 8192, "collapsed": 200}


def theme(name, frame, glyph, trail, bloom, rings, edge_color, labelcase,
          wave_colors, **vars_):
    return {"name": name, "frame": frame, "glyph": glyph, "trail": trail,
            "bloom": bloom, "rings": rings, "edgeColor": edge_color,
            "labelcase": labelcase, "waveColors": wave_colors, "vars": vars_}


MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace"
GROT = "'Helvetica Neue',Helvetica,Arial,sans-serif"
GEO = "Futura,'Century Gothic','Avenir Next',sans-serif"
HUM = "Avenir,'Trebuchet MS',Verdana,sans-serif"
SERIF = "Georgia,'Hiragino Mincho ProN','Times New Roman',serif"

THEMES = {
    # gleaming offwhite on black — Asteroids, not Apple II
    "asteroids": theme(
        "asteroids", "crt", "diamond", "glow", 2, "none", "mono", "upper",
        ["#f5f6f0"],
        bg="#07080a", ink="#f5f6f0", bright="#ffffff", dim="#6a6d66",
        faint="#2b2d2b", accent="#ffb347", hud="#8a8d85", agent="#ffffff",
        font=MONO, flick="#eef7f0",
        **{"screen-bg": "radial-gradient(ellipse at 50% 48%,#101113 0%,#07080a 62%,#020203 100%)",
           "scan-o": ".16", "vig-o": "1", "glass-o": "1"}),
    # two-ink overprint on warm paper: fluorescent pink + medium blue
    "riso": theme(
        "riso", "mat", "ring", "confetti", 0, "none", "fromWave", "upper",
        ["#0078bf", "#ff48b0"],
        bg="#f6efe2", ink="#0078bf", bright="#1d3557", dim="#9a948a",
        faint="#e2d9c6", accent="#ff48b0", hud="#8c8474", agent="#ff48b0",
        font=MONO, **{"screen-bg": "#f6efe2", "grain-o": ".5", "hub-core": "#ff48b0"}),
    # primaries + black on warm white; circle/triangle/square by wave; lowercase
    "bauhaus": theme(
        "bauhaus", "mat", "primitives", "none", 0, "none", "mono", "lower",
        ["#d12f1e", "#1c56a7", "#e8b50c", "#1a1a1a"],
        bg="#f2efe9", ink="#1a1a1a", bright="#1a1a1a", dim="#1a1a1a",
        faint="#dcd7cc", accent="#d12f1e", hud="#6e6a62", agent="#1a1a1a",
        font=GEO, **{"screen-bg": "#f2efe9"}),
    # mid-century playroom: cream, mustard, burnt orange, teal, walnut
    "eames": theme(
        "eames", "mat", "ring", "confetti", 0, "solid", "fromWave", "upper",
        ["#d2552b", "#2a7f78", "#e3a72f", "#5a4634"],
        bg="#f4ead8", ink="#5a4634", bright="#3c2e22", dim="#a08c72",
        faint="#e6d9bf", accent="#d2552b", hud="#8c7a62", agent="#d2552b",
        font=HUM, **{"screen-bg": "#f4ead8", "grain-o": ".22"}),
    # the DAG as a subway map: thick route lines, white-disc stations
    "transit": theme(
        "transit", "none", "pin", "none", 0, "none", "fromWave", "upper",
        ["#ee352e", "#ff6319", "#00933c", "#0039a6"],
        bg="#fafaf7", ink="#1a1a1a", bright="#000000", dim="#7c7c78",
        faint="#e8e8e2", accent="#ff6319", hud="#5c5c58", agent="#1a1a1a",
        font=GROT,
        **{"screen-bg": "#fafaf7", "edge-w": "4.5", "edge-w-live": "6"}),
    # cyanotype: pale construction lines on deep blue, dashed wave rings
    "blueprint": theme(
        "blueprint", "mat", "square", "dash", 1, "dashed", "mono", "upper",
        ["#e9f1ff"],
        bg="#143a85", ink="#e9f1ff", bright="#ffffff", dim="#7e9bd6",
        faint="#2b549f", accent="#ffd166", hud="#9db8e8", agent="#ffffff",
        font=MONO,
        **{"screen-bg": "linear-gradient(160deg,#16409400,#0e2f6e22),#143a85",
           "grain-o": ".18"}),
    # Milano 1981: pastel ground, dot grid, loud shapes, confetti wakes
    "memphis": theme(
        "memphis", "none", "primitives", "confetti", 0, "none", "index", "upper",
        ["#ff5277", "#00b3a4", "#ffd23f", "#6457a6"],
        bg="#fbeaf0", ink="#2b2233", bright="#2b2233", dim="#b89aa6",
        faint="#caa8b6", accent="#ff5277", hud="#8a6e7a", agent="#2b2233",
        font=HUM,
        **{"screen-bg": "#fbeaf0", "dots-o": ".5",
           "edge-w": "2", "edge-w-live": "3"}),
    # ink on washi, one vermillion seal — brush ticks for stations
    "sumi": theme(
        "sumi", "mat", "asterisk", "dash", 0, "none", "mono", "upper",
        ["#1c1b18"],
        bg="#f7f3ea", ink="#1c1b18", bright="#000000", dim="#8c867a",
        faint="#e6e0d2", accent="#d23c2a", hud="#8c867a", agent="#1c1b18",
        font=SERIF, **{"screen-bg": "#f7f3ea", "grain-o": ".3",
                       "hub-core": "#d23c2a"}),
    # light hardware panel, dark display ink, one safety-orange LED
    "gadget": theme(
        "gadget", "panel", "square", "dash", 0, "solid", "mono", "upper",
        ["#26261f"],
        bg="#ece9e2", ink="#26261f", bright="#11110d", dim="#8f8c80",
        faint="#d8d4c8", accent="#ff4d00", hud="#6e6b60", agent="#ff4d00",
        font=MONO, **{"screen-bg": "linear-gradient(#efece5,#e6e2d8)",
                      "scan-o": ".06", "hub-core": "#ff4d00"}),
    # wall drawing: thin colored lines on gallery white, minimal black stations
    "lewitt": theme(
        "lewitt", "mat", "ring", "none", 0, "solid", "index", "upper",
        ["#e63946", "#f4a261", "#e9c46a", "#2a9d8f", "#457b9d", "#7b4b94"],
        bg="#f7f7f4", ink="#222222", bright="#000000", dim="#9a9a94",
        faint="#e4e4dc", accent="#e63946", hud="#8a8a84", agent="#222222",
        font=GROT, **{"screen-bg": "#f7f7f4", "edge-w": "1.3", "edge-w-live": "2"}),
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
    for ph in (DAG_PLACEHOLDER, THEME_PLACEHOLDER):
        if ph not in html:
            raise SystemExit(f"template placeholder {ph} missing — swarm_template.html was edited?")
    html = html.replace(DAG_PLACEHOLDER, _js_embed(dag))
    html = html.replace(THEME_PLACEHOLDER, _js_embed(THEMES[theme_name]))
    if audit_js is not None:
        html = html.replace(AUDIT_JS_PLACEHOLDER, audit_js)
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
    p.add_argument("--all", action="store_true",
                   help="render every theme as swarm-<theme>.html")
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

    audit_index = audit_embed = audit_js = None
    if args.transcripts:
        run_dir = pathlib.Path(args.transcripts)
        if not run_dir.is_dir():
            raise SystemExit(f"--transcripts: not a directory: {run_dir}")
        if out_dir.resolve() == run_dir.resolve():
            raise SystemExit("--out must differ from --transcripts (transcripts are read-only)")
        audit_index = build_index(run_dir)
        audit_js = AUDIT_JS.read_text()
        if args.embed:
            audit_embed = marshal_embed(run_dir)
        else:
            for f in run_dir.glob("agent-*.jsonl"):  # live: symlink, never copy
                link = out_dir / f.name
                if link.is_symlink() or link.exists():
                    link.unlink()
                os.symlink(f.resolve(), link)

    if args.all:
        for name in THEMES:
            print("wrote", render(dag, name, out_dir / f"swarm-{name}.html",
                                  audit_index, audit_embed, audit_js))
        return

    out = render(dag, args.theme, out_dir / "swarm.html",
                 audit_index, audit_embed, audit_js)
    print(f"wrote {out}  (theme: {args.theme})")
    print(f"  {len(dag['tasks'])} tasks, {len(dag['edges'])} edges, "
          f"{len(dag['waves'])} waves, mode={dag['mode']}")
    print()
    print("semi-live (run from the TARGET repo during an ultrapowers run):")
    print(f"  python3 {HERE / 'swarm_watch.py'} --repo <target-repo> --out {out_dir} &")
    print(f"  (cd {out_dir} && python3 -m http.server 8123)")
    print("  open http://localhost:8123/swarm.html")
    print()
    print(f"depiction only: open file://{out.resolve()}")
    print()
    print(f"one command (render + serve + URL): python3 {HERE / 'serve_viewer.py'} {args.plan}")


if __name__ == "__main__":
    main()
