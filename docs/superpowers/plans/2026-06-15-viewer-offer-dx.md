# Viewer-Offer DX Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the swarm viewer a push, not a pull — a one-command `serve_viewer.py` helper plus opt-in offers at launch (live progress) and the pre-merge gate (audit drawer).

**Architecture:** Orchestrator-facing only. A new `serve_viewer.py` renders via `render_viewer.py`, picks a free port, serves the out dir over http in a detached background process, optionally starts `swarm_watch.py`, prints a localhost URL, and tears down with `--stop`. SKILL.md (Step 4 + Step 5) and `report-format.md` gain one-line opt-in offers that call it. No engine change (`waves.js` frozen); transcripts stay read-only.

**Tech Stack:** Python 3 stdlib (`argparse`, `socket`, `subprocess`, `http.server`), pytest.

**Acceptance:** suite — ultrapowers' own tooling; author and operator read the diffs, and the committed pytest suite is the verification. No held-out exam.

---

### Task 1: `serve_viewer.py` — render + serve + URL + `--stop`

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/scripts/serve_viewer.py`
- Test: `tests/test_serve_viewer.py`

One unit, one job: render the viewer, serve it on a free port in a detached background process, print a clickable URL, and tear it down. Wraps `render_viewer.py` (and optionally `swarm_watch.py`) so the orchestrator's offer and a manual user both collapse to one line. Read-only on transcripts — it only invokes `render_viewer.py`, which symlinks (live) or bakes truncated copies (`--embed`), never mutating the source.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_serve_viewer.py`:

```python
"""serve_viewer.py: render + serve the swarm viewer on a free port, --stop tears
it down. Subprocess-driven (same pattern as test_viewer.py); each test binds its
own free port via the helper and uses tmp_path, so same-wave runs stay safe."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SERVE = ROOT / "skills/ultrapowers/scripts/serve_viewer.py"
PLAN = ROOT / "tests/fixtures/marked-plan.md"


def _serve(args):
    return subprocess.run([sys.executable, str(SERVE), *args],
                          check=True, capture_output=True, text=True)


def _poll(url, tries=60):
    for _ in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=0.5) as r:
                return r.status
        except Exception:
            time.sleep(0.1)
    return None


def test_serves_then_stops(tmp_path):
    out = tmp_path / "v"
    p = _serve([str(PLAN), "--out", str(out)])
    m = re.search(r"http://localhost:(\d+)/swarm\.html", p.stdout)
    assert m, p.stdout
    url = m.group(0)
    try:
        assert _poll(url) == 200, "server never served swarm.html"
        assert (out / "swarm.html").exists()
        assert (out / ".viewer-pids").exists()
    finally:
        _serve(["--stop", str(out)])
    assert _poll(url, tries=10) is None, "server still up after --stop"
    assert not (out / ".viewer-pids").exists()


def test_stop_idempotent(tmp_path):
    out = tmp_path / "empty"
    out.mkdir()
    p = _serve(["--stop", str(out)])
    assert "no viewer" in p.stdout.lower()


def test_transcripts_read_only(tmp_path):
    run_dir = tmp_path / "wf"
    run_dir.mkdir()
    (run_dir / "agent-a1.jsonl").write_text(
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "text",
                        "text": "You are an implementer subagent operating inside a dedicated git worktree.\n"}]}}) + "\n")
    (run_dir / "agent-a1.meta.json").write_text(
        json.dumps({"agentType": "workflow-subagent", "worktreePath": "/wt"}))
    before = hashlib.md5((run_dir / "agent-a1.jsonl").read_bytes()).hexdigest()
    out = tmp_path / "v"
    _serve([str(PLAN), "--transcripts", str(run_dir), "--out", str(out)])
    try:
        after = hashlib.md5((run_dir / "agent-a1.jsonl").read_bytes()).hexdigest()
        assert after == before, "transcript was mutated"
        assert (out / "agent-a1.jsonl").is_symlink(), "live mode must symlink, not copy"
    finally:
        _serve(["--stop", str(out)])


def test_watch_writes_status(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    def git(*a):
        subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True)

    git("init", "-q")
    git("config", "user.name", "t")
    git("config", "user.email", "t@t")
    (repo / "f.txt").write_text("x\n")
    git("add", "-A")
    git("commit", "-qm", "base")
    git("checkout", "-qb", "ultra/integration-test")
    out = tmp_path / "v"
    _serve([str(PLAN), "--watch", str(repo), "ultra/integration-test", "--out", str(out)])
    try:
        for _ in range(60):
            if (out / "status.json").exists():
                break
            time.sleep(0.1)
        assert (out / "status.json").exists(), "--watch did not start swarm_watch"
    finally:
        _serve(["--stop", str(out)])
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `python3 -m pytest tests/test_serve_viewer.py -q`
Expected: FAIL — `serve_viewer.py` does not exist (subprocess non-zero / file not found).

- [ ] **Step 3: Implement `serve_viewer.py`**

Create `skills/ultrapowers/scripts/serve_viewer.py`:

```python
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
    subprocess.run(render_cmd, check=True)

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
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `python3 -m pytest tests/test_serve_viewer.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/serve_viewer.py tests/test_serve_viewer.py
git commit -m "feat(viewer): serve_viewer.py one-command render+serve+stop helper"
```

---

### Task 2: Surface the viewer at launch and the gate

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/scripts/render_viewer.py`
- Test: `tests/test_viewer_offer_touchpoints.py`

Wire the helper from Task 1 into the orchestrator's flow as one-line opt-in offers: live progress at launch (Step 4), the audit drawer at the gate (Step 5), and a one-command pointer in `render_viewer.py`'s printed next-steps for manual users. These reference `serve_viewer.py` (created by Task 1), hence Depends-on 1.

- [ ] **Step 1: Write the failing wiring test**

Create `tests/test_viewer_offer_touchpoints.py`:

```python
"""Wiring guard: the orchestrator-facing docs must offer the viewer at launch and
the gate via serve_viewer.py, and render_viewer.py must point manual users at it."""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
REPORT_FMT = ROOT / "skills/ultrapowers/references/report-format.md"
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
PLAN = ROOT / "tests/fixtures/marked-plan.md"


def test_skill_offers_viewer_at_launch_and_gate():
    text = SKILL.read_text()
    # launch offer (Step 4, live progress) + gate offer (Step 5, audit drawer)
    assert text.count("serve_viewer.py") >= 2, "expected a serve_viewer offer at both launch and gate"
    assert "--watch" in text, "launch offer should use the live-progress --watch mode"
    assert "--transcripts" in text, "gate offer should use the audit-drawer --transcripts mode"


def test_report_format_mentions_transcript_offer():
    assert "serve_viewer.py" in REPORT_FMT.read_text(), "report presentation order must include the transcript-read offer"


def test_render_viewer_prints_serve_viewer_pointer(tmp_path):
    out = subprocess.run(
        [sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)],
        check=True, capture_output=True, text=True)
    assert "serve_viewer.py" in out.stdout, "render_viewer should point at the one-command helper"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_viewer_offer_touchpoints.py -q`
Expected: FAIL — `serve_viewer.py` appears nowhere in `SKILL.md`, `report-format.md`, or the `render_viewer.py` output yet.

- [ ] **Step 3: Add the launch offer to `SKILL.md` (Step 4)**

In `skills/ultrapowers/SKILL.md`, find the paragraph that ends Step 4 (it ends with `See` … ``references/wave-merge.md`` `for the mechanics that are baked into the script.`). Immediately after that paragraph (before the `---` that opens Step 5), insert:

```markdown
**After launch, offer the live view (interactive runs only).** The run is now headless, but this conversation is not — surface a one-line opt-in so the human can watch the autonomous stretch: *"Want to watch live? I'll serve the swarm at a localhost URL."* On yes, run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py <plan-path> --watch . <integrationBranch>` and hand back the printed `http://localhost:<port>/swarm.html` — `swarm_watch` animates agents fanning out and merging from git footprints. Tear it down at the gate (`serve_viewer.py --stop <dir>`). Skip the offer in a headless/non-interactive run — no one is watching, so do not spin up a server.
```

- [ ] **Step 4: Replace the gate's audit-read prose with a user-facing offer (Step 5)**

In `skills/ultrapowers/SKILL.md`, replace the entire paragraph that begins `To *read* the transcripts (not just their effort stats), render the swarm viewer with` … (through `… see ``skills/ultrapowers/viewer/README.md``.`) with:

```markdown
To *read* the transcripts (not just their effort stats), offer the audit drawer as a one-line choice when presenting the report: *"Want to read any agent's transcript? I'll open the audit drawer."* On yes, first tear down the launch viewer if one is running (`python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py --stop <launch-dir>`), then run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py <plan-path> --transcripts <transcript-dir>` and hand back the printed URL; click a station to open its subagent's reasoning + tool I/O. Leave it running (the human is reading) with its `--stop` line printed; add `--embed` to `render_viewer.py` for a self-contained offline file. Read-only; see `skills/ultrapowers/viewer/README.md`.
```

- [ ] **Step 5: Add the transcript-read offer to the report presentation order**

In `skills/ultrapowers/references/report-format.md`, the `## Presentation` numbered list currently ends at item `11. **Effort audit (optional):**`. Add a new item immediately after it:

```markdown
12. **Transcript reading (optional):** offer to open the audit drawer — `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py <plan-path> --transcripts <transcript-dir>` — so the human can read any agent's reasoning + tool I/O in a browser. One line, opt-in, read-only; skip in headless runs.
```

- [ ] **Step 6: Add the one-command pointer to `render_viewer.py`'s printed next-steps**

In `skills/ultrapowers/scripts/render_viewer.py`, the single-render branch of `main()` ends with `print(f"depiction only: open file://{out.resolve()}")`. Immediately after that line, add:

```python
    print()
    print(f"one command (render + serve + URL): python3 {HERE / 'serve_viewer.py'} {args.plan}")
```

- [ ] **Step 7: Run the wiring test and watch it pass**

Run: `python3 -m pytest tests/test_viewer_offer_touchpoints.py -q`
Expected: PASS (3 passed).

- [ ] **Step 8: Verify the skill still validates and commit**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: `skill ok`

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md \
        skills/ultrapowers/scripts/render_viewer.py tests/test_viewer_offer_touchpoints.py
git commit -m "feat(viewer): offer the viewer at launch + gate via serve_viewer.py"
```

---

### Task 3: Full-suite gate

**Type:** gate
**Depends-on:** none

The pre-merge verification. With `pytest.ini` (`testpaths = tests evals/scripts/tests`) already in place, the bare command collects only the real suites.

Suite command:

```bash
python3 -m pytest -q
```

Expected: all pass (baseline 318 + the tests this plan adds). A non-green suite blocks the merge.

---

## Wave structure (informational)

- **Wave 1:** Task 1 (`serve_viewer.py` + its test).
- **Wave 2:** Task 2 (docs + `render_viewer.py` pointer + wiring test), after Task 1 (it references `serve_viewer.py`).
- Task 3 (gate) is excluded from the waves; it informs the test gate.

Every source and test file is owned by exactly one implementation task; tasks use pytest `tmp_path` and bind their own free ports (no shared fixtures, no fixed ports), so runs stay concurrency-safe.
