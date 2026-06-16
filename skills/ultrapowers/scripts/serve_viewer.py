#!/usr/bin/env python3
"""One command to render + serve the swarm viewer and hand back a URL.

Renders via render_viewer.py, picks a free port, serves the out dir over http in
a detached background process, optionally starts swarm_watch.py for live progress
telemetry, prints the URL, and exits. `--stop <dir>` tears it down. Read-only:
render_viewer.py symlinks (live) or bakes truncated copies (--embed), never
mutating --transcripts.

Usage:
  serve_viewer.py <plan> [--transcripts DIR] [--watch REPO BRANCH] [--out DIR] [--port N]
  serve_viewer.py --stop DIR
"""
import argparse
import os
import pathlib
import socket
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
RENDER = HERE / "render_viewer.py"
WATCH = HERE / "swarm_watch.py"
PIDFILE = ".viewer-pids"


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def stop(out_dir):
    pidpath = pathlib.Path(out_dir) / PIDFILE
    if not pidpath.exists():
        print(f"no viewer running in {out_dir}")
        return
    for line in pidpath.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            os.kill(int(line), 15)  # SIGTERM
        except (ProcessLookupError, ValueError):
            pass
    pidpath.unlink()
    print(f"stopped viewer in {out_dir}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("plan", nargs="?")
    p.add_argument("--transcripts")
    p.add_argument("--watch", nargs=2, metavar=("REPO", "BRANCH"))
    p.add_argument("--out")
    p.add_argument("--port", type=int)
    p.add_argument("--stop", metavar="DIR")
    args = p.parse_args()

    if args.stop:
        stop(args.stop)
        return
    if not args.plan:
        raise SystemExit("plan path required (or --stop DIR)")

    out = pathlib.Path(args.out) if args.out else pathlib.Path(tempfile.mkdtemp(prefix="swarm-"))
    out.mkdir(parents=True, exist_ok=True)

    render_cmd = [sys.executable, str(RENDER), args.plan, "--out", str(out)]
    if args.transcripts:
        render_cmd += ["--transcripts", args.transcripts]
    subprocess.run(render_cmd, check=True, stdout=subprocess.DEVNULL)

    pids = []
    if args.watch:
        repo, branch = args.watch
        w = subprocess.Popen(
            [sys.executable, str(WATCH), "--repo", repo, "--out", str(out), "--integration", branch],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        pids.append(w.pid)

    port = args.port or free_port()
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(out)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    pids.append(srv.pid)

    (out / PIDFILE).write_text("\n".join(str(x) for x in pids) + "\n")
    print(f"▶ http://localhost:{port}/swarm.html")
    print(f"  stop: python3 {pathlib.Path(__file__).resolve()} --stop {out}")


if __name__ == "__main__":
    main()
