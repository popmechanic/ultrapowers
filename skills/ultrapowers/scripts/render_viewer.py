#!/usr/bin/env python3
"""Generate the ULTRAPOWERS swarm viewer for a plan.

Compiles the plan with compile_plan.py, bakes the resulting DAG into the
self-contained swarm_template.html, and writes <out>/swarm.html. The viewer is
passive: pure depiction when opened directly (file://), semi-live when
swarm_watch.py is writing status.json next to it and the directory is served
over http (fetch is blocked on file://).

Usage:
  render_viewer.py <plan.md> [--out DIR] [--title TITLE]
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
TEMPLATE = HERE.parent / "viewer" / "swarm_template.html"
PLACEHOLDER = "/*__DAG_JSON__*/null"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("plan")
    p.add_argument("--out", default=".", help="directory for swarm.html")
    p.add_argument("--title", help="HUD title (default: plan H1)")
    args = p.parse_args()

    plan = pathlib.Path(args.plan)
    compiled = json.loads(subprocess.run(
        [sys.executable, str(HERE / "compile_plan.py"), str(plan)],
        check=True, capture_output=True, text=True).stdout)

    title = args.title
    if not title:
        m = re.match(r"#\s*(.+?)(?:\s+Implementation Plan)?\s*$",
                     plan.read_text().splitlines()[0])
        title = m.group(1) if m else plan.stem

    impl = [t for t in compiled["tasks"] if t["disposition"] == "implementation"]
    dag = {
        "title": title,
        "mode": compiled["mode"],
        "waves": compiled["waves"],
        "edges": [[e["from"], e["to"]] for e in compiled["dag_edges"]],
        "tasks": [{"id": t["id"], "title": t["title"]} for t in impl],
    }

    html = TEMPLATE.read_text()
    if PLACEHOLDER not in html:
        raise SystemExit("template placeholder missing — swarm_template.html was edited?")
    html = html.replace(PLACEHOLDER, json.dumps(dag))

    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "swarm.html"
    out.write_text(html)

    print(f"wrote {out}")
    print(f"  {len(impl)} tasks, {len(dag['edges'])} edges, "
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
