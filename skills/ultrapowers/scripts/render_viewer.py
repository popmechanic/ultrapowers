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
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
TEMPLATE = HERE.parent / "viewer" / "swarm_template.html"
DAG_PLACEHOLDER = "/*__DAG_JSON__*/null"
THEME_PLACEHOLDER = "/*__THEME_JSON__*/null"


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


def render(dag, theme_name, out_path):
    html = TEMPLATE.read_text()
    for ph in (DAG_PLACEHOLDER, THEME_PLACEHOLDER):
        if ph not in html:
            raise SystemExit(f"template placeholder {ph} missing — swarm_template.html was edited?")
    html = html.replace(DAG_PLACEHOLDER, json.dumps(dag))
    html = html.replace(THEME_PLACEHOLDER, json.dumps(THEMES[theme_name]))
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

    if args.all:
        for name in THEMES:
            print("wrote", render(dag, name, out_dir / f"swarm-{name}.html"))
        return

    out = render(dag, args.theme, out_dir / "swarm.html")
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


if __name__ == "__main__":
    main()
