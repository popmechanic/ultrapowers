# Live Swarm Viewer — Phases 2 & 3: Live Data + Fractal Zoom Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the d3-dag grid viewer **live** during a run (a per-agent index, a cross-agent feed, and streaming transcripts) and let the human **zoom** from the run grid down into one task's real commit/review/merge graph and into a single agent's transcript — all from observed git + transcript data, in a single self-contained `swarm.html`.

**Architecture:** Two new data emissions and a layered render. `swarm_watch.py` keeps writing `status.json` (now with per-branch `commits[]`) and additionally writes `agents.json` (a light per-agent index + a bounded `recentEvents` ring) by incrementally tailing the run's transcript dir. The viewer becomes a split pane: the left pane is the existing d3-dag grid plus two deeper zoom levels (a data-driven meso git-graph built by a new `SwarmLayout.buildMeso`, and a micro transcript); the right sidebar is always text (ASCII wave readout + live feed at macro, the focused agent's transcript at meso/micro). A pure-logic `SwarmZoom` state machine (new `swarm_zoom.js`) tracks the macro↔meso↔micro level; the template drives a 600 ms CSS camera into the clicked node, with optional d3-zoom scroll/pinch on the same transform. `serve_viewer.py` threads `--transcripts` into the `--watch` launch path so the launch viewer is live-state AND readable from the moment it opens; the docs collapse the two viewer offers into one.

**Tech stack:** Python 3 (`swarm_watch.py`, `serve_viewer.py`, `render_viewer.py`), vanilla browser JS + inline SVG (`swarm_template.html`), dependency-free node-testable modules (`swarm_layout.js`, `swarm_zoom.js`, `audit_project.js`) with `module.exports`, the already-committed vendored `d3-dag@1.1.0` and `d3-zoom@3.0.0` IIFE/CJS bundles, node + pytest tests.

**Phase scope:** This plan covers **Phase 2 (Live data + wiring)** and **Phase 3 (Fractal zoom + polish)** of the three-increment spec. **Phase 1 (the d3-dag grid render layer) is already merged to main (v0.0.15)** — this plan builds on its seams (`SwarmLayout.computeGrid`, the grid-rendered phosphor `swarm_template.html`, the `/*__…_JS__*/` inline placeholders in `render_viewer.py`, the vendored `viewer/vendor/d3-dag.*`). Do not re-derive Phase 1; extend it.

---

## Global Constraints

These bind every task; ultrapowers forwards this section to every reviewer as its attention lens.

- **Self-contained, offline, drift-safe.** `swarm.html` stays one self-contained file. d3-dag **and d3-zoom** are the **already-committed vendored bundles** under `skills/ultrapowers/viewer/vendor/` (`d3-dag.iife.min.js`, `d3-zoom.iife.min.js`), inlined like `audit_project.js`. Never fetch from a CDN; never add a runtime package manager or build step to the render/serve/watch path.
- **No engine changes.** The viewer and watcher observe git/transcript artifacts only. Do not touch `waves.js`, `compile_plan.py`'s output shape, or anything the engine executes. `build_dag`'s JSON contract (`title`, `mode`, `waves`, `edges`, `tasks`) is fixed.
- **Boot under the node DOM stub.** A rendered `swarm.html` (with AND without `--transcripts`) must still BOOT under the stub in `tests/test_viewer.py` (executed via `node --require`, not merely `node --check`). The inlined d3-zoom bundle is a pure IIFE with no `require`/UMD branch precisely so this holds; any new `d3.zoom(...)`/`d3.select(...)` wiring must be guarded so it does not run (or throw) under the reduced-motion stub.
- **JS logic lives in `module.exports` modules, tested by node specs wrapped in pytest.** Layout/topology math (`swarm_layout.js`), the zoom state machine (`swarm_zoom.js`), and transcript projection (`audit_project.js`) are dependency-free classic scripts that also set `module.exports`. Every one has a `tests/*_spec.mjs` run by a `tests/test_*.py` wrapper (skips without node), mirroring `tests/test_swarm_layout.py`.
- **Keep `audit_project.js` CAPS in sync.** If (and only if) you change `AuditProjection.CAPS`, mirror it in `AUDIT_CAPS` in `render_viewer.py`. This plan does **not** change CAPS; the watcher's event-text cap is its own local constant.
- **Honesty model.** Every visible signal is observed: station state, the feed, the meso commit graph, and transcripts come from git and the transcripts. The only dramatization is easing/pulse styling. No fictional agents or orbits. Keep the `OBSERVING / SIGNAL LOST / DEPICTION` badges and the seeded `file://` DEPICTION fallback.
- **Positions are prefigured.** The macro grid is laid out once (Phase 1). Live data changes a station's state/color and drives the feed/transcripts only — never a macro node's position.
- **Accessibility & motion.** Animate only `transform`/`opacity`; no layout shift; `tabular-nums` for changing counters. Every animation has a `prefers-reduced-motion` path that disables it (instant level swap). Stations and feed lines are focusable, keyboard-operable buttons with aria labels; Esc always escapes a zoom; ≥44px hit targets; hover affordances behind `@media (hover: hover)`.

### Shared data contracts (authoritative — Tasks 1, 3, 6, 7 build to these)

**`agents.json`** (written by `swarm_watch.py` beside `swarm.html`; polled by the viewer like `status.json`):

```json
{
  "runId": "<transcript dir name>",
  "ts": 1718553600.0,
  "agents": [
    { "id": "a1c2", "file": "agent-a1c2.jsonl", "role": "impl", "task": "4",
      "iter": 0, "model": "claude-...", "turns": 12, "tools": 7,
      "state": "active", "lastActivity": 1718553598.0, "firstLine": "I'll start by…" }
  ],
  "recentEvents": [
    { "ts": 1718553597.0, "task": "5", "role": "impl", "kind": "tool_use", "text": "Edit" },
    { "ts": 1718553598.0, "task": "1", "role": "review", "kind": "text", "text": "PASS — no blocking issues" }
  ]
}
```

- `role` ∈ `impl|review|setup|merge|reconcile|integration|unknown` (from `audit_run.classify`). `task` is the resolved id or `null` (run-level). `iter` is the 0-based ordinal among agents sharing one `(task, role)`, by discovery order — best-effort; **a second `impl` agent on a task is a fix round** (the engine re-dispatches the implementer prompt, so there is no distinct "fix" role marker). `state` is `"active"` (transcript grew this interval) or `"idle"`. `recentEvents` is bounded to the last **40** events across all agents, ascending by `ts`; each `text` is a one-line ≤200-char summary.

**`status.json` branch entries** gain `commits[]` (oldest→newest), from `git log <integration>..<branch> --numstat`:

```json
{ "name": "worktree-wf_impl-t4", "sha": "…", "ahead": 2, "merged": false, "worktree": "…",
  "commits": [ { "sha": "9f1a", "subject": "test: red", "additions": 12, "deletions": 0, "files": 1 },
               { "sha": "3b7c", "subject": "feat: green", "additions": 40, "deletions": 3, "files": 2 } ] }
```

**`SwarmLayout.buildMeso(meso)`** input/output (Task 3) and **`SwarmZoom.create()`** API (Task 4) are specified in their tasks' Interfaces blocks.

**Acceptance:** suite — this is ultrapowers' own viewer tooling. Author and operator both read the diffs; the committed node specs (`swarm_meso_spec.mjs`, `swarm_zoom_spec.mjs`), the pytest viewer/watch/serve tests, and the node boot-under-stub test are the verification (`acceptance.passed === tests.passed`). No held-out sealed exam.

### Pre-flight (already done — do not repeat in a worktree)

The d3-zoom bundle is **already vendored and committed to `main`** (`viewer/vendor/d3-zoom.iife.min.js` + `.cjs.min.js`, README updated) by an esbuild step run before this plan's execution, exactly as Phase 1 vendored d3-dag. The worktree tasks consume the committed bundle and stay network-free. If for any reason the bundle is absent, rebuild it per `viewer/vendor/README.md` and commit to the base branch **before** launching — never inside a worktree task.

---

### Task 1: Watcher emits `agents.json` + per-branch `commits[]` — `swarm_watch.py`

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/swarm_watch.py`
- Create: `tests/test_swarm_agents.py`

**Interfaces:**
- Consumes: `audit_run.classify(text) -> "role[:task]"` and `audit_run.first_user_text(path) -> str` (sibling module, imported via `sys.path` like `render_viewer.py` does); the existing `git(repo, *args)`, `snapshot(repo, integration)`, and `worktrees(repo)` helpers in this file.
- Produces: a new `--transcripts DIR` CLI flag; `agents_index(transcript_dir, state) -> dict` (the `agents.json` payload from the Shared data contracts, with `state` a dict persisted across intervals holding byte offsets, per-agent counters, and the event ring); `branch_commits(repo, integration, name) -> list[{sha,subject,additions,deletions,files}]`; `snapshot(...)` branch entries now carry `commits[]`; the watch loop writes `agents.json` atomically beside `status.json` when `--transcripts` is a directory.

- [ ] **Step 1: Write the failing test**

Create `tests/test_swarm_agents.py`:

```python
"""swarm_watch.py also emits agents.json (live index + bounded recentEvents ring)
and folds per-branch commits[] into status.json. Builds a real git repo + a fixture
transcript dir in tmp_path so same-wave runs stay concurrency-safe."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
sys.path.insert(0, str(SCRIPTS))
import swarm_watch  # noqa: E402


def _run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


IMPL = ("You are an implementer subagent operating inside a dedicated git worktree.\n"
        '### Task 4: do the thing\n')
REVIEW = ("You are an independent reviewer. You receive the original task text.\n"
          "### Task 4: do the thing\n")


def _agent(run_dir, name, first_user, blocks):
    lines = [json.dumps({"type": "user", "version": "2.1.177",
                         "message": {"content": [{"type": "text", "text": first_user}]}})]
    lines.append(json.dumps({"type": "assistant", "version": "2.1.177",
                             "message": {"model": "test-model", "usage": {"output_tokens": 5},
                                         "content": blocks}}))
    (run_dir / f"agent-{name}.jsonl").write_text("\n".join(lines) + "\n")


def test_agents_index_shape_and_ring(tmp_path):
    run_dir = tmp_path / "wf_run"
    run_dir.mkdir()
    _agent(run_dir, "a1", IMPL,
           [{"type": "text", "text": "I'll start by reading the plan."},
            {"type": "tool_use", "name": "Edit", "input": {"file": "api.ts"}}])
    _agent(run_dir, "a2", REVIEW, [{"type": "text", "text": "PASS — no blocking issues"}])
    idx = swarm_watch.agents_index(run_dir, {})
    assert idx["runId"] == "wf_run" and isinstance(idx["ts"], float)
    by_id = {a["id"]: a for a in idx["agents"]}
    assert by_id["a1"]["role"] == "impl" and by_id["a1"]["task"] == "4"
    assert by_id["a1"]["tools"] == 1 and by_id["a1"]["turns"] == 1
    assert by_id["a1"]["state"] == "active" and by_id["a1"]["iter"] == 0
    assert by_id["a2"]["role"] == "review" and by_id["a2"]["task"] == "4"
    # ring: bounded, ascending ts, light {ts,task,role,kind,text}
    evs = idx["recentEvents"]
    assert evs and len(evs) <= swarm_watch.RING_MAX
    assert all(set(e) == {"ts", "task", "role", "kind", "text"} for e in evs)
    assert [e["ts"] for e in evs] == sorted(e["ts"] for e in evs)
    assert any(e["kind"] == "tool_use" and e["text"] == "Edit" for e in evs)


def test_agents_index_second_impl_is_a_fix_round(tmp_path):
    run_dir = tmp_path / "wf_fix"
    run_dir.mkdir()
    _agent(run_dir, "a1", IMPL, [{"type": "text", "text": "first pass"}])
    _agent(run_dir, "a2", IMPL, [{"type": "text", "text": "fix pass"}])
    idx = swarm_watch.agents_index(run_dir, {})
    iters = sorted(a["iter"] for a in idx["agents"] if a["role"] == "impl")
    assert iters == [0, 1], "a second impl agent on a task must be iter 1 (a fix round)"


def test_status_carries_branch_commits(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    def git(*a):
        return _run(["git", "-C", str(repo), *a])

    git("init", "-q")
    git("config", "commit.gpgsign", "false")
    git("config", "user.name", "t")
    git("config", "user.email", "t@t")
    (repo / "f.txt").write_text("base\n")
    git("add", "-A")
    git("commit", "-qm", "baseline")
    git("checkout", "-qb", "ultra/integration-test")
    git("worktree", "add", "-q", "-b", "worktree-wf_impl-t4",
        str(repo / ".claude/worktrees/wf_impl-t4"))
    wt = repo / ".claude/worktrees/wf_impl-t4"
    _run(["git", "config", "commit.gpgsign", "false"], cwd=wt)
    (wt / "t4.txt").write_text("line one\nline two\n")
    _run(["git", "add", "-A"], cwd=wt)
    _run(["git", "commit", "-qm", "feat: task 4"], cwd=wt)

    snap = swarm_watch.snapshot(repo, "ultra/integration-test")
    (branch,) = snap["branches"]
    assert branch["name"] == "worktree-wf_impl-t4"
    assert isinstance(branch["commits"], list) and len(branch["commits"]) == 1
    c = branch["commits"][0]
    assert c["subject"] == "feat: task 4"
    assert c["additions"] == 2 and c["deletions"] == 0 and c["files"] == 1
    assert isinstance(c["sha"], str) and c["sha"]


def test_watch_once_writes_agents_json(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _run(["git", "-C", str(repo), "init", "-q"])
    _run(["git", "-C", str(repo), "config", "user.name", "t"])
    _run(["git", "-C", str(repo), "config", "user.email", "t@t"])
    (repo / "f.txt").write_text("x\n")
    _run(["git", "-C", str(repo), "add", "-A"])
    _run(["git", "-C", str(repo), "commit", "-qm", "base"])
    run_dir = tmp_path / "wf_run"
    run_dir.mkdir()
    _agent(run_dir, "a1", IMPL, [{"type": "text", "text": "hi"}])
    out = tmp_path / "viewer"
    out.mkdir()
    _run([sys.executable, str(SCRIPTS / "swarm_watch.py"), "--repo", str(repo),
          "--out", str(out), "--transcripts", str(run_dir), "--once"])
    idx = json.loads((out / "agents.json").read_text())
    assert idx["agents"] and idx["agents"][0]["role"] == "impl"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_swarm_agents.py -q`
Expected: FAIL — `AttributeError: module 'swarm_watch' has no attribute 'agents_index'` / `RING_MAX`, and `KeyError: 'commits'`.

- [ ] **Step 3: Add `commits[]` to `snapshot` and the new emission code to `swarm_watch.py`**

At the top of `skills/ultrapowers/scripts/swarm_watch.py`, after the existing stdlib imports, make `audit_run` importable (mirrors `render_viewer.py`):

```python
import sys
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import audit_run  # sibling: classify, first_user_text
```

Add the per-branch commit reader and the agent index, above `def main()`:

```python
RING_MAX = 40
EVENT_TEXT_CAP = 200


def _oneline(s, n=EVENT_TEXT_CAP):
    return " ".join((s or "").split())[:n]


def branch_commits(repo, integration, name):
    """Real commits on the branch beyond integration, oldest->newest, with +/- and
    file counts. One `git log --numstat` per branch (the loop already runs git here)."""
    if not integration:
        return []
    out = git(repo, "log", f"{integration}..{name}", "--numstat",
              "--pretty=format:%x1e%h%x1f%s")
    commits = []
    for rec in out.split("\x1e"):
        rec = rec.lstrip("\n")
        if not rec:
            continue
        head, _, body = rec.partition("\n")
        sha, _, subject = head.partition("\x1f")
        add = dele = files = 0
        for ln in body.splitlines():
            cols = ln.split("\t")
            if len(cols) == 3:
                files += 1
                if cols[0].isdigit():
                    add += int(cols[0])
                if cols[1].isdigit():
                    dele += int(cols[1])
        commits.append({"sha": sha, "subject": subject,
                        "additions": add, "deletions": dele, "files": files})
    commits.reverse()  # git log is newest-first; the graph reads oldest-first
    return commits


def _event_from_block(b):
    """(kind, text) for a renderable content block, else None."""
    t = b.get("type")
    if t == "text":
        return ("text", _oneline(b.get("text")))
    if t == "tool_use":
        return ("tool_use", _oneline(b.get("name") or "?"))
    if t == "tool_result":
        c = b.get("content")
        if isinstance(c, list):
            c = " ".join(x.get("text", "") for x in c if isinstance(x, dict))
        return ("tool_result", _oneline(c if isinstance(c, str) else str(c)))
    return None


def agents_index(transcript_dir, state):
    """Light per-agent index + bounded recentEvents ring. Incremental: `state`
    persists byte offsets, per-agent counters, and the ring across intervals, so the
    watcher tails only newly appended transcript bytes — never re-reads whole files."""
    ring = state.setdefault("ring", [])
    offsets = state.setdefault("offsets", {})
    counters = state.setdefault("counters", {})
    agents = []
    for f in sorted(transcript_dir.glob("agent-*.jsonl")):
        aid = f.stem[len("agent-"):]
        c = counters.setdefault(aid, {"turns": 0, "tools": 0, "model": "?",
                                      "firstLine": "", "role": None, "task": None})
        if c["role"] is None:
            role, _, task = audit_run.classify(audit_run.first_user_text(f)).partition(":")
            c["role"] = role
            c["task"] = task if task and task != "?" else None
        try:
            st = f.stat()
        except OSError:
            continue
        size, mtime = st.st_size, st.st_mtime
        off = offsets.get(f.name, 0)
        if off > size:      # truncated/rotated: re-read from the top
            off = 0
        grew = size > off
        if grew:
            with open(f, "rb") as fh:
                fh.seek(off)
                chunk = fh.read()
            offsets[f.name] = size
            for line in chunk.decode("utf-8", "replace").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                typ = d.get("type")
                if typ == "assistant":
                    c["turns"] += 1
                    msg = d.get("message") or {}
                    c["model"] = msg.get("model", c["model"])
                    for b in (msg.get("content") or []):
                        if not isinstance(b, dict):
                            continue
                        if b.get("type") == "tool_use":
                            c["tools"] += 1
                        if not c["firstLine"] and b.get("type") == "text":
                            c["firstLine"] = _oneline(b.get("text"))
                        ev = _event_from_block(b)
                        if ev:
                            ring.append({"ts": mtime, "task": c["task"], "role": c["role"],
                                         "kind": ev[0], "text": ev[1]})
                elif typ == "user":
                    for b in (d.get("message") or {}).get("content") or []:
                        if isinstance(b, dict) and b.get("type") == "tool_result":
                            ev = _event_from_block(b)
                            if ev:
                                ring.append({"ts": mtime, "task": c["task"], "role": c["role"],
                                             "kind": ev[0], "text": ev[1]})
        agents.append({"id": aid, "file": f.name, "role": c["role"], "task": c["task"],
                       "model": c["model"], "turns": c["turns"], "tools": c["tools"],
                       "state": "active" if grew else "idle",
                       "lastActivity": mtime, "firstLine": c["firstLine"]})
    # iter: 0-based ordinal among agents sharing one (task, role), by discovery order
    seen = {}
    for a in sorted(agents, key=lambda x: (x["lastActivity"], x["file"])):
        key = (a["task"], a["role"])
        a["iter"] = seen.get(key, 0)
        seen[key] = a["iter"] + 1
    ring.sort(key=lambda e: e["ts"])
    if len(ring) > RING_MAX:
        del ring[:-RING_MAX]
    return {"runId": transcript_dir.name, "ts": time.time(),
            "agents": agents, "recentEvents": list(ring)}
```

In `snapshot(repo, integration)`, inside the `for line in out.splitlines():` branch loop, after `entry = {...}` and the `if integration:` block, add the commits before `branches.append(entry)`:

```python
        entry["commits"] = branch_commits(repo, integration, name)
        branches.append(entry)
```

- [ ] **Step 4: Wire `--transcripts` into `main()`**

In `main()`, add the flag (after the existing `--once` arg):

```python
    p.add_argument("--transcripts", help="run transcript dir — also emit agents.json")
```

After `out = pathlib.Path(args.out) / "status.json"` and its `mkdir`, add:

```python
    tdir = pathlib.Path(args.transcripts) if args.transcripts else None
    agents_out = pathlib.Path(args.out) / "agents.json"
    astate = {}
```

Inside the `while True:` loop, after the `os.replace(tmp, out)` that writes `status.json` and **before** the `if args.once:` block, add:

```python
        if tdir and tdir.is_dir():
            idx = agents_index(tdir, astate)
            atmp = agents_out.with_suffix(".tmp")
            atmp.write_text(json.dumps(idx))
            os.replace(atmp, agents_out)
```

(The existing `--once` branch still prints the `status.json` snapshot to stdout unchanged; `agents.json` is asserted as a file.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_swarm_agents.py -q`
Expected: 4 passed.

- [ ] **Step 6: Confirm the existing watcher test still passes (commits[] is additive)**

Run: `python3 -m pytest tests/test_viewer.py::test_swarm_watch_observes_engine_footprints -q`
Expected: 1 passed (the branch entry now also has `commits`, which that test does not assert against — additive).

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/scripts/swarm_watch.py tests/test_swarm_agents.py
git commit -m "feat(viewer): swarm_watch emits agents.json + per-branch commits[]"
```

---

### Task 2: `serve_viewer.py` threads `--transcripts` into the `--watch` path

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/serve_viewer.py`
- Modify: `tests/test_serve_viewer.py`

**Interfaces:**
- Consumes: the existing `main()` arg parsing (`--transcripts`, `--watch REPO BRANCH`, `--out`) and the `WATCH`/`RENDER` path constants in this file.
- Produces: `build_watch_cmd(python, watch_script, repo, branch, out, transcripts) -> list[str]` — the swarm_watch invocation including `--transcripts <dir>` when a transcript dir is given; `main()` calls it so the live watcher also emits `agents.json`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_serve_viewer.py`:

```python
def test_build_watch_cmd_threads_transcripts():
    import importlib.util
    spec = importlib.util.spec_from_file_location("serve_viewer", SERVE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cmd = mod.build_watch_cmd("python3", "/w/swarm_watch.py", "/repo",
                              "ultra/integration-x", "/out", "/run/transcripts")
    assert "--transcripts" in cmd
    assert cmd[cmd.index("--transcripts") + 1] == "/run/transcripts"
    assert "--integration" in cmd and "ultra/integration-x" in cmd
    # no transcripts -> no flag (back-compat with --watch-only callers)
    cmd2 = mod.build_watch_cmd("python3", "/w/swarm_watch.py", "/repo",
                               "ultra/integration-x", "/out", None)
    assert "--transcripts" not in cmd2
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_serve_viewer.py::test_build_watch_cmd_threads_transcripts -q`
Expected: FAIL — `AttributeError: module 'serve_viewer' has no attribute 'build_watch_cmd'`.

- [ ] **Step 3: Add the helper and call it from `main()`**

In `skills/ultrapowers/scripts/serve_viewer.py`, add the helper above `def main()`:

```python
def build_watch_cmd(python, watch_script, repo, branch, out, transcripts):
    cmd = [python, str(watch_script), "--repo", repo, "--out", str(out),
           "--integration", branch]
    if transcripts:
        cmd += ["--transcripts", transcripts]
    return cmd
```

In `main()`, replace the `if args.watch:` block's command construction:

```python
    pids = []
    if args.watch:
        repo, branch = args.watch
        w = subprocess.Popen(
            build_watch_cmd(sys.executable, WATCH, repo, branch, out, args.transcripts),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        pids.append(w.pid)
```

(`args.transcripts` already feeds the `render_cmd` above this block; now it also feeds the watcher, so one `serve_viewer … --transcripts <dir> --watch <repo> <branch>` invocation renders the transcript-readable viewer AND starts the watcher emitting `status.json` + `agents.json`.)

- [ ] **Step 4: Run the new test + the existing serve suite**

Run: `python3 -m pytest tests/test_serve_viewer.py -q`
Expected: all pass (new unit test + `test_serves_then_stops`, `test_stop_idempotent`, `test_transcripts_read_only`, `test_watch_writes_status`).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/serve_viewer.py tests/test_serve_viewer.py
git commit -m "feat(viewer): serve_viewer threads --transcripts into the --watch path"
```

---

### Task 3: Meso git-graph assembly — `SwarmLayout.buildMeso`

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/viewer/swarm_layout.js`
- Create: `tests/swarm_meso_spec.mjs`
- Create: `tests/test_swarm_meso.py`

**Interfaces:**
- Consumes: nothing external — pure geometry (no d3). Inputs are the Shared data contracts (a branch's `commits[]` and the task's `agents.json` agents).
- Produces: `SwarmLayout.buildMeso(meso) -> { trunk:{x,y0,y1}, fork:{x,y}, merge:{x,y}|null, branchX, commits:[{sha,subject,role:'impl'|'fix',x,y}], gates:[{lane:0|1,kind:'lean'|'adversarial',x,y}], width, height }` where `meso = { commits:[{sha,subject,additions?,deletions?,files?}] (oldest→newest), agents:[{role,iter?}] (this task's agents), merged:boolean, reviewDepth?:'lean'|'adversarial' }`. Derivation: `fixIters = max(0, count(role==='impl') - 1)`; the **last** `min(fixIters, commits.length-1)` commits are tinted `role:'fix'` (≥1 impl always retained); `nReview = count(role==='review')`; gates appear only when `nReview>0` — one `lean` gate, or two `adversarial` gates (`reviewDepth` overrides, else `nReview>=2 ⇒ adversarial`); `merge` is non-null iff `merged`. Commit `sha`/`subject` are real; only the impl/fix tint is inferred.

- [ ] **Step 1: Write the failing node spec**

Create `tests/swarm_meso_spec.mjs`:

```js
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../skills/ultrapowers/viewer/swarm_layout.js");

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error("FAIL", m); } };
const finite = o => Number.isFinite(o.x) && Number.isFinite(o.y);

// A — lean review, no fix, merged
const a = L.buildMeso({
  commits: [{ sha: "aaa", subject: "test: red" }, { sha: "bbb", subject: "feat: green" }],
  agents: [{ role: "impl" }, { role: "review" }],
  merged: true,
});
ok(a.commits.length === 2 && a.commits.every(c => c.role === "impl"), "A: 2 impl commits, none fix");
ok(a.gates.length === 1 && a.gates[0].kind === "lean", "A: one lean gate");
ok(a.merge && finite(a.merge), "A: merge node present (merged)");
ok(finite(a.fork) && a.fork.y < a.commits[0].y, "A: fork above first commit");
ok(a.commits[0].y < a.commits[1].y, "A: commits ordered top->down");
ok(a.commits[1].y < a.merge.y, "A: merge below the last commit");
ok([a.fork, ...a.commits, ...a.gates, a.merge].every(finite), "A: all coords finite");
ok(a.width > 0 && a.height > 0, "A: positive bounds");

// B — adversarial review + a fix round, not merged
const b = L.buildMeso({
  commits: [{ sha: "1", subject: "red" }, { sha: "2", subject: "green" }, { sha: "3", subject: "fix" }],
  agents: [{ role: "impl" }, { role: "review" }, { role: "review" }, { role: "impl" }],
  merged: false,
});
ok(b.commits.filter(c => c.role === "fix").length === 1, "B: last commit tinted fix");
ok(b.commits[2].role === "fix" && b.commits[0].role === "impl", "B: fix is the LAST commit");
ok(b.gates.length === 2 && b.gates.every(g => g.kind === "adversarial"), "B: two adversarial gates");
ok(b.gates[0].lane !== b.gates[1].lane, "B: adversarial gates on different lanes");
ok(b.merge === null, "B: no merge node (unmerged)");

// C — explicit reviewDepth override + zero commits edge case
const c = L.buildMeso({ commits: [], agents: [{ role: "impl" }], merged: false, reviewDepth: "lean" });
ok(Array.isArray(c.commits) && c.commits.length === 0, "C: no commits ok");
ok(c.gates.length === 0, "C: no review agent => no gate even with reviewDepth hint");
ok(c.width > 0 && c.height > 0 && finite(c.fork), "C: still a valid box");

console.log(failed === 0 ? "ALL TESTS PASSED" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

Create the pytest wrapper `tests/test_swarm_meso.py` (mirrors `tests/test_swarm_layout.py`):

```python
"""Run the JS meso-assembly spec (tests/swarm_meso_spec.mjs). Requires node; skips without it."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = ROOT / "tests/swarm_meso_spec.mjs"


def test_swarm_meso_js():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    p = subprocess.run([node, str(SPEC)], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "ALL TESTS PASSED" in p.stdout, p.stdout + p.stderr
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/swarm_meso_spec.mjs`
Expected: FAIL — `L.buildMeso is not a function`.

- [ ] **Step 3: Implement `buildMeso` in `swarm_layout.js`**

In `skills/ultrapowers/viewer/swarm_layout.js`, add `buildMeso` inside the IIFE (before the `var api = …` line) and export it. Pure geometry — no d3, deterministic:

```js
  // Meso git-graph topology for ONE task, assembled from observed data: the
  // integration trunk, the branch fork, real commit nodes, review gate(s), and
  // the two-parent merge. sha/subject are real; the impl/fix tint is inferred
  // (a second impl agent on a task is a fix round — the engine re-dispatches the
  // implementer prompt, so there is no distinct "fix" role). Geometry only.
  var M_MARGIN = 60, M_ROW = 64, M_LANE = 120, M_GATE_DX = 26;

  function buildMeso(meso) {
    var commits = (meso.commits || []).map(function (c) {
      return { sha: c.sha, subject: c.subject, role: "impl", x: 0, y: 0 };
    });
    var agents = meso.agents || [];
    var nImpl = agents.filter(function (a) { return a.role === "impl"; }).length;
    var nReview = agents.filter(function (a) { return a.role === "review"; }).length;
    var fixIters = Math.max(0, nImpl - 1);

    var trunkX = M_MARGIN, branchX = M_MARGIN + M_LANE;
    var forkY = M_MARGIN;

    // tint the LAST fixIters commits as fix (keep >=1 impl)
    var fixCount = Math.min(fixIters, Math.max(0, commits.length - 1));
    var firstFix = commits.length - fixCount;
    for (var i = 0; i < commits.length; i++)
      commits[i].role = (i >= firstFix) ? "fix" : "impl";

    // lay rows top->down: impl commits, then gate row, then fix commits
    var row = 1;
    for (var j = 0; j < firstFix; j++) {
      commits[j].x = branchX; commits[j].y = forkY + row * M_ROW; row++;
    }
    var gates = [];
    if (nReview > 0) {
      var kind = (meso.reviewDepth === "lean") ? "lean"
        : (meso.reviewDepth === "adversarial") ? "adversarial"
        : (nReview >= 2 ? "adversarial" : "lean");
      var gy = forkY + row * M_ROW; row++;
      if (kind === "adversarial") {
        gates.push({ lane: 0, kind: kind, x: branchX - M_GATE_DX, y: gy });
        gates.push({ lane: 1, kind: kind, x: branchX + M_GATE_DX, y: gy });
      } else {
        gates.push({ lane: 0, kind: kind, x: branchX, y: gy });
      }
    }
    for (var k = firstFix; k < commits.length; k++) {
      commits[k].x = branchX; commits[k].y = forkY + row * M_ROW; row++;
    }

    var lastY = forkY + Math.max(1, row) * M_ROW;
    var merge = meso.merged ? { x: trunkX, y: lastY + M_ROW } : null;
    var bottomY = merge ? merge.y : lastY;
    return {
      trunk: { x: trunkX, y0: forkY, y1: bottomY },
      fork: { x: branchX, y: forkY },
      merge: merge, branchX: branchX, commits: commits, gates: gates,
      width: branchX + M_LANE,
      height: bottomY + M_MARGIN,
    };
  }
```

Add `buildMeso` to the exported `api` object:

```js
  var api = { computeGrid: computeGrid, buildMeso: buildMeso, SINK: SINK };
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `node tests/swarm_meso_spec.mjs`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 5: Run the pytest wrapper + the existing layout spec (no regression)**

Run: `python3 -m pytest tests/test_swarm_meso.py tests/test_swarm_layout.py -q`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/viewer/swarm_layout.js tests/swarm_meso_spec.mjs tests/test_swarm_meso.py
git commit -m "feat(viewer): SwarmLayout.buildMeso — data-driven meso git-graph topology"
```

---

### Task 4: Zoom state machine — `viewer/swarm_zoom.js`

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/viewer/swarm_zoom.js`
- Create: `tests/swarm_zoom_spec.mjs`
- Create: `tests/test_swarm_zoom.py`

**Interfaces:**
- Consumes: nothing — a DOM-free pure reducer (the template wires DOM/animation to it in Task 7).
- Produces: a global/`module.exports` object `SwarmZoom` with `SwarmZoom.create() -> z` where `z.level()` is `'macro'|'meso'|'micro'`; `z.focus()` is `{ task, agentId }`; `z.toMeso(taskId)`, `z.toMicro(taskId, agentId)`, `z.reset()` set state; `z.out()` pops one level (micro→meso→macro, idempotent at macro) and returns the new level; `z.crumbs()` returns an ordered array `[{label, level}]` for the breadcrumb (macro: `[{label:'run · wave plan', level:'macro'}]`; meso adds `{label:'T<task>', level:'meso'}`; micro adds `{label:<agentLabel||'transcript'>, level:'micro'}`).

- [ ] **Step 1: Write the failing node spec**

Create `tests/swarm_zoom_spec.mjs`:

```js
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Z = require("../skills/ultrapowers/viewer/swarm_zoom.js");

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error("FAIL", m); } };

const z = Z.create();
ok(z.level() === "macro", "starts at macro");
ok(z.crumbs().length === 1 && z.crumbs()[0].level === "macro", "macro crumb only");

z.toMeso("4");
ok(z.level() === "meso" && z.focus().task === "4", "toMeso sets meso + task");
const mc = z.crumbs();
ok(mc.length === 2 && mc[1].label === "T4" && mc[1].level === "meso", "meso crumb is T4");

z.toMicro("4", "a1");
ok(z.level() === "micro" && z.focus().agentId === "a1", "toMicro sets micro + agent");
ok(z.crumbs().length === 3 && z.crumbs()[2].level === "micro", "micro adds a third crumb");

ok(z.out() === "meso", "out: micro -> meso");
ok(z.focus().agentId === null, "out clears the agent when leaving micro");
ok(z.out() === "macro", "out: meso -> macro");
ok(z.out() === "macro", "out at macro stays macro (idempotent)");
ok(z.focus().task === null, "macro clears the task");

z.toMicro("7", "b2");           // jump straight to micro
ok(z.level() === "micro" && z.focus().task === "7", "direct toMicro ok");
z.reset();
ok(z.level() === "macro" && z.focus().task === null, "reset -> macro");

console.log(failed === 0 ? "ALL TESTS PASSED" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

Create the pytest wrapper `tests/test_swarm_zoom.py`:

```python
"""Run the JS zoom-state-machine spec (tests/swarm_zoom_spec.mjs). Requires node; skips without it."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = ROOT / "tests/swarm_zoom_spec.mjs"


def test_swarm_zoom_js():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    p = subprocess.run([node, str(SPEC)], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "ALL TESTS PASSED" in p.stdout, p.stdout + p.stderr
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/swarm_zoom_spec.mjs`
Expected: FAIL — `Cannot find module '../skills/ultrapowers/viewer/swarm_zoom.js'`.

- [ ] **Step 3: Implement `swarm_zoom.js`**

Create `skills/ultrapowers/viewer/swarm_zoom.js`. Classic script (no import/export) so `render_viewer.py` can inline it; also sets `module.exports`, mirroring `swarm_layout.js`/`audit_project.js`. DOM-free:

```js
// Fractal-zoom state machine for the swarm viewer. Pure reducer: tracks the
// macro/meso/micro level + focus and yields the breadcrumb trail. No DOM — the
// template (swarm_template.html) wires clicks, the 600ms camera, and d3-zoom to
// it. Keep in sync with render_viewer.py's SWARM_ZOOM_PLACEHOLDER.
(function (root) {
  "use strict";

  function create() {
    var level = "macro", task = null, agentId = null, agentLabel = null;

    function crumbs() {
      var out = [{ label: "run · wave plan", level: "macro" }];
      if (level === "meso" || level === "micro")
        out.push({ label: "T" + task, level: "meso" });
      if (level === "micro")
        out.push({ label: agentLabel || "transcript", level: "micro" });
      return out;
    }
    return {
      level: function () { return level; },
      focus: function () { return { task: task, agentId: agentId }; },
      toMeso: function (taskId) { level = "meso"; task = String(taskId); agentId = null; agentLabel = null; },
      toMicro: function (taskId, aid, label) {
        level = "micro"; task = String(taskId); agentId = aid; agentLabel = label || null;
      },
      out: function () {
        if (level === "micro") { level = "meso"; agentId = null; agentLabel = null; }
        else if (level === "meso") { level = "macro"; task = null; }
        return level;
      },
      reset: function () { level = "macro"; task = null; agentId = null; agentLabel = null; },
      crumbs: crumbs,
    };
  }

  var api = { create: create };
  root.SwarmZoom = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `node tests/swarm_zoom_spec.mjs`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 5: Run the pytest wrapper**

Run: `python3 -m pytest tests/test_swarm_zoom.py -q`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/viewer/swarm_zoom.js tests/swarm_zoom_spec.mjs tests/test_swarm_zoom.py
git commit -m "feat(viewer): SwarmZoom — DOM-free macro/meso/micro zoom state machine"
```

---

### Task 5: Inline d3-zoom + `swarm_zoom.js` in `render_viewer.py`; add template placeholders

**Type:** implementation
**Depends-on:** 4

**Files:**
- Modify: `skills/ultrapowers/scripts/render_viewer.py`
- Modify: `skills/ultrapowers/viewer/swarm_template.html` (add two placeholders only — the body rewrite is Tasks 6 & 7)
- Modify: `tests/test_viewer.py`

**Interfaces:**
- Consumes: the committed `skills/ultrapowers/viewer/vendor/d3-zoom.iife.min.js` (pre-flight) and `skills/ultrapowers/viewer/swarm_zoom.js` (Task 4); the existing inline machinery (`D3DAG_PLACEHOLDER`, `SWARM_LAYOUT_PLACEHOLDER`, the mandatory-placeholder check loop in `render`).
- Produces: rendered `swarm.html` containing the inlined d3-zoom IIFE (merged onto the global `d3`) and the inlined `SwarmZoom`; new placeholders `/*__D3ZOOM_JS__*/` and `/*__SWARM_ZOOM_JS__*/`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_viewer.py`:

```python
def test_render_inlines_d3zoom_and_swarm_zoom(tmp_path):
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    assert "/*__D3ZOOM_JS__*/" not in html, "d3-zoom placeholder not replaced"
    assert "/*__SWARM_ZOOM_JS__*/" not in html, "swarm_zoom placeholder not replaced"
    assert "globalThis.SwarmZoom" in html or "root.SwarmZoom" in html, "SwarmZoom not inlined"
    # d3-zoom merged onto the same global d3 as d3-dag (both present, neither clobbered)
    assert "globalThis.SwarmLayout" in html or "root.SwarmLayout" in html, "d3-dag/layout still inlined"
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_viewer.py::test_render_inlines_d3zoom_and_swarm_zoom -q`
Expected: FAIL — placeholders absent / not inlined.

- [ ] **Step 3: Add the two placeholders to the template**

In `skills/ultrapowers/viewer/swarm_template.html`, the inline block currently reads:

```js
/*__AUDIT_JS__*/
/*__D3DAG_JS__*/
/*__SWARM_LAYOUT_JS__*/
```

Insert the d3-zoom placeholder immediately after `/*__D3DAG_JS__*/` (so d3-zoom merges into the `d3` global d3-dag just created), and the swarm-zoom placeholder after the layout one:

```js
/*__AUDIT_JS__*/
/*__D3DAG_JS__*/
/*__D3ZOOM_JS__*/
/*__SWARM_LAYOUT_JS__*/
/*__SWARM_ZOOM_JS__*/
```

(Tasks 6 & 7 consume the resulting `d3.zoom`/`d3.select` and `SwarmZoom` globals.)

- [ ] **Step 4: Inline both in `render_viewer.py`**

Add the constants next to the d3-dag ones (after `SWARM_LAYOUT_JS = …`):

```python
D3ZOOM_PLACEHOLDER = "/*__D3ZOOM_JS__*/"
SWARM_ZOOM_PLACEHOLDER = "/*__SWARM_ZOOM_JS__*/"
D3ZOOM_JS = HERE.parent / "viewer" / "vendor" / "d3-zoom.iife.min.js"
SWARM_ZOOM_JS = HERE.parent / "viewer" / "swarm_zoom.js"
```

In `render(...)`, in the loop that checks the d3-dag/layout placeholders are present, extend it to the new pair, then replace them. The d3-zoom IIFE starts with `(()=>{…` and the d3-dag inline ends with `})` (no semicolon), so prepend a `;\n` guard exactly as the layout inline does; `swarm_zoom.js` follows the layout inline (which ends with `)`), so it also needs the guard. Update:

```python
    for ph in (D3DAG_PLACEHOLDER, SWARM_LAYOUT_PLACEHOLDER,
               D3ZOOM_PLACEHOLDER, SWARM_ZOOM_PLACEHOLDER):
        if ph not in html:
            raise SystemExit(f"template placeholder {ph} missing — swarm_template.html was edited?")
    html = html.replace(D3DAG_PLACEHOLDER, D3DAG_JS.read_text())
    html = html.replace(D3ZOOM_PLACEHOLDER, ";\n" + D3ZOOM_JS.read_text())
    html = html.replace(SWARM_LAYOUT_PLACEHOLDER, ";\n" + SWARM_LAYOUT_JS.read_text())
    html = html.replace(SWARM_ZOOM_PLACEHOLDER, ";\n" + SWARM_ZOOM_JS.read_text())
```

(Replace the existing two `D3DAG`/`SWARM_LAYOUT` replace lines and their check loop with this block — do not leave the old loop in place, or the new placeholders go unchecked.)

- [ ] **Step 5: Run the viewer tests to verify they pass (incl. boot)**

Run: `python3 -m pytest tests/test_viewer.py -q`
Expected: all pass — the new inline test, plus `test_render_viewer_javascript_parses` and `test_viewer_boots_without_transcripts_under_dom_stub`. The template body has not changed yet (Tasks 6 & 7 do that), and the inlined d3-zoom is a pure IIFE with no `require`, so it loads cleanly under the node stub.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/render_viewer.py skills/ultrapowers/viewer/swarm_template.html tests/test_viewer.py
git commit -m "feat(viewer): inline vendored d3-zoom + swarm_zoom state machine"
```

---

### Task 6: Split pane + sidebar (ASCII wave readout + live cross-agent feed) — `swarm_template.html`

**Type:** implementation
**Depends-on:** 1, 5

**Files:**
- Modify: `skills/ultrapowers/viewer/swarm_template.html`
- Modify: `tests/test_viewer.py`

**Interfaces:**
- Consumes: the `agents.json` contract (Task 1) fetched live like `status.json`; the existing `AuditProjection.renderInto`/`makeEl` (Phase 1), the `el()`/theme helpers, the `poll()`/`gotStatus()`/`matchTask()`/`updateHud()` observer, and the `setState`/`RANK` station grammar.
- Produces: a split layout (`.layout` grid: left `.stage-pane` holds the existing `<svg id="stage">`; right `.sidebar`). The sidebar holds `#readout` (ASCII `━━ WAVE n ━━` headers with each task + status) and `#feed` (the live `recentEvents` ring, clickable lines), plus a `#transcript` region (`#txHead`/`#txBody`/`#txFoot`) that the transcript functions render into (the Phase-1 modal `#drawer` is retired in favor of this region). `loadAgent(a,label)` renders into `#transcript`; a richer station-state grammar (`implementing`/`under-review`/`fixing`/`committed`/`merged`/`stalled`) derived from `agents.json` joined with `status.json`.

This task makes the viewer **live and readable at the macro level**. The fractal zoom (macro↔meso↔micro left-pane camera) is Task 7; here, clicking a station or a feed line focuses that agent's transcript in the sidebar.

- [ ] **Step 1: Add failing render assertions**

Add to `tests/test_viewer.py`:

```python
def test_viewer_has_split_sidebar_and_feed(tmp_path):
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    assert 'id="sidebar"' in html and 'id="readout"' in html and 'id="feed"' in html
    assert 'id="transcript"' in html, "transcript region must live in the sidebar"
    assert "agents.json" in html, "viewer must poll agents.json for the live feed"
    # the Phase-1 modal drawer is retired in favor of the sidebar transcript region
    assert 'id="drawer"' not in html, "modal drawer should be replaced by the sidebar"
```

Run: `python3 -m pytest tests/test_viewer.py::test_viewer_has_split_sidebar_and_feed -q`
Expected: FAIL — sidebar/feed/agents.json not present; `id="drawer"` still present.

- [ ] **Step 2: Replace the modal-drawer markup with a split pane + sidebar**

In `swarm_template.html`, wrap the existing `.screen` content. Replace the `<div class="bezel"><div class="screen" id="screen">` … `</div></div>` structure so the screen contains a two-column `.layout`: the left column keeps the `<svg id="stage">` + overlays + HUD exactly as today; the right column is the new sidebar. Remove the entire `<div id="drawer" class="drawer" hidden> … </div>` block and add the sidebar before the closing `.screen` div:

```html
  <div class="layout">
    <div class="stage-pane">
      <!-- the existing <svg id="stage"> … </svg> and .ovl overlays + .hud + .brand stay here -->
    </div>
    <aside class="sidebar" id="sidebar">
      <div id="readout" class="readout"></div>
      <ul id="feed" class="feed" aria-label="cross-agent activity feed"></ul>
      <section id="transcript" class="transcript" hidden>
        <div class="tx-head"><span id="txTitle" class="tx-title"></span>
          <button id="txClose" class="tx-x" type="button">esc ✕</button></div>
        <div id="txBody" class="tx-body"></div>
        <div id="txFoot" class="tx-foot"></div>
      </section>
    </aside>
  </div>
```

- [ ] **Step 3: Add split-pane + sidebar CSS**

Replace the Phase-1 `.drawer*` CSS block (from `.drawer{…}` through `.drawer-foot{…}`) with split + sidebar styling (palette vars unchanged):

```css
  .layout{position:absolute;inset:0;display:grid;grid-template-columns:58% 42%}
  .stage-pane{position:relative;overflow:hidden}
  .stage-pane svg{position:absolute;inset:0;width:100%;height:100%}
  .sidebar{position:relative;display:flex;flex-direction:column;gap:8px;
    padding:14px 14px 12px;border-left:1px solid var(--faint);overflow:hidden;
    color:var(--ink);font-family:var(--font);font-size:11px;background:var(--bg)}
  .readout{white-space:pre-wrap;line-height:1.5;letter-spacing:.04em;overflow:auto;max-height:42%}
  .readout .wave{color:var(--hud);letter-spacing:.18em}
  .readout .t{color:var(--ink)} .readout .t.dim{opacity:.5}
  .feed{list-style:none;margin:0;padding:0;overflow:auto;flex:1;
    border-top:1px solid var(--faint)}
  .feed li{padding:2px 0;cursor:pointer;color:var(--hud);
    font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media (hover:hover){ .feed li:hover{color:var(--ink)} }
  .feed li .ts{opacity:.6;margin-right:6px}
  .transcript{display:flex;flex-direction:column;min-height:0;flex:2;
    border-top:1px solid var(--faint)}
  .transcript[hidden]{display:none}
  .tx-head{display:flex;align-items:center;gap:8px;padding:4px 0}
  .tx-title{flex:1;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tx-x{background:none;border:1px solid var(--dim);color:var(--hud);border-radius:4px;
    cursor:pointer;font:inherit;font-size:10px;padding:1px 6px}
  .tx-body{overflow:auto;flex:1;line-height:1.45}
  .tx-body .ev{margin:4px 0} .tx-body .ev-head{white-space:pre-wrap}
  .tx-body pre.ev-full{white-space:pre-wrap;margin:4px 0 8px;padding:6px 8px;
    background:rgba(127,127,127,.12);border-radius:6px;max-height:40vh;overflow:auto}
  .tx-foot{padding:4px 0;font-size:10px;opacity:.6}
```

- [ ] **Step 4: Repoint the transcript functions to the sidebar region**

In the `<script>`, the Phase-1 drawer helpers reference `#drawer*` elements. Replace `drawerEls()`, `closeDrawer()`, and `loadAgent()`'s element handles to target the sidebar transcript region. Replace the `drawerEls` function and the `closeDrawer`/keydown wiring with:

```js
function txEls() {
  return {
    root: document.getElementById("transcript"),
    title: document.getElementById("txTitle"),
    body: document.getElementById("txBody"),
    foot: document.getElementById("txFoot"),
  };
}
function stopLive() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } liveAgentId = null; }
function closeTranscript() { stopLive(); txEls().root.hidden = true; }
document.getElementById("txClose").addEventListener("click", closeTranscript);
```

In `openDrawer(agents, label)` → rename to `focusAgent(agents, label)`; drop the per-agent tab strip (the sidebar shows one agent at a time) and load the first agent, revealing the region:

```js
function focusAgent(agents, label) {
  if (!audit || !agents || !agents.length) return;
  txEls().root.hidden = false;
  loadAgent(agents[0], label);
}
```

In `loadAgent(a, label)`, replace `const d = drawerEls();` with `const d = txEls();`, drop the `d.badge` lines (no badge element in the sidebar), and where it set `d.tabs`/badge text, set `d.title.textContent` only. `fetchAndRender`/`renderEvents` are unchanged (they take `d` with `.body`/`.foot`). Update the station/sink click handlers built in the Phase-1 grid construction to call `focusAgent(...)` instead of `openDrawer(...)`.

- [ ] **Step 5: Build the ASCII wave readout + the live feed; poll `agents.json`**

After the grid construction, add the readout/feed renderers and an agents poller. The readout lists each wave with its tasks and current station state; the feed renders the `recentEvents` ring as clickable lines:

```js
const readoutEl = document.getElementById('readout');
const feedEl = document.getElementById('feed');
const agentsByTask = {};   // taskId -> [agent]   (from agents.json)
let agentsList = [];

function fmtTime(ts) {
  const d = new Date(ts * 1000);
  const p = n => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}
function renderReadout() {
  const lines = [];
  waves.forEach((wave, wi) => {
    lines.push('<div class="wave">━━ WAVE ' + (wi + 1) + ' ━━</div>');
    wave.forEach(id => {
      const st = stations[String(id)];
      const s = st ? st.state : 'pending';
      const dim = (s === 'pending') ? ' dim' : '';
      lines.push('<div class="t' + dim + '">  T' + id + ' · ' + s + '</div>');
    });
  });
  readoutEl.innerHTML = lines.join('');
}
function renderFeed(events) {
  feedEl.innerHTML = '';
  events.slice().reverse().forEach(ev => {
    const li = mkEl('li', null);
    const glyph = ev.kind === 'tool_use' ? '⚙' : ev.kind === 'tool_result' ? '→' : '●';
    li.innerHTML = '<span class="ts">' + fmtTime(ev.ts) + '</span>' +
      (ev.task != null ? 'T' + ev.task + ' ' : '') + glyph + ' ' +
      (ev.text || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    if (ev.task != null && agentsByTask[ev.task])
      li.addEventListener('click', () => focusAgent(agentsByTask[ev.task], 'T' + ev.task));
    feedEl.appendChild(li);
  });
}
function gotAgents(idx) {
  agentsList = idx.agents || [];
  for (const k in agentsByTask) delete agentsByTask[k];
  agentsList.forEach(a => {
    if (a.task != null) (agentsByTask[a.task] = agentsByTask[a.task] || []).push(a);
    // enrich station state from the active role on the task
    if (a.task != null && a.state === 'active') {
      if (a.role === 'review') setState(a.task, 'under-review');
      else if (a.role === 'impl' && a.iter > 0) setState(a.task, 'fixing');
      else if (a.role === 'impl') setState(a.task, 'implementing');
    }
  });
  renderFeed(idx.recentEvents || []);
  renderReadout();
}
async function pollAgents() {
  try {
    const r = await fetch('agents.json', { cache: 'no-store' });
    if (r.ok) gotAgents(await r.json());
  } catch (e) { /* file:// or no run yet: readout still renders from DEPICTION */ }
  setTimeout(pollAgents, 2000);
}
renderReadout();
pollAgents();
```

- [ ] **Step 6: Extend the station-state grammar with `implementing`/`under-review`/`fixing`**

Update the Phase-1 `RANK` map and CSS so the richer agents.json-derived states render and never downgrade. In the `<script>`, replace the `RANK` constant:

```js
const RANK = { pending: 0, implementing: 1, 'under-review': 2, fixing: 3,
               working: 1, committed: 4, merged: 5, stalled: 9 };
```

(`working` stays as an alias for `status.json`-only runs that never saw `agents.json`.) In the station-state CSS block, add color rules alongside the existing ones:

```css
  [data-state=implementing] .node{opacity:1}
  [data-state=implementing] .core{fill:var(--accent);opacity:1}
  [data-state=under-review] .node{opacity:1;stroke-dasharray:3 3}
  [data-state=under-review] .core{fill:var(--hud);opacity:1}
  [data-state=fixing] .node{opacity:1}
  [data-state=fixing] .core{fill:var(--accent);opacity:1;animation:lostblink 1.4s steps(2) infinite}
  [data-state=implementing] .stlabel,[data-state=under-review] .stlabel,[data-state=fixing] .stlabel{opacity:1}
```

(Keep the existing `working`/`committed`/`merged`/`stalled` rules. `gotStatus` still maps branch `ahead`→`committed`, `merged`→`merged`; `agents.json` supplies the finer in-flight states. The `setState` never-downgrade guard uses `RANK`, so `committed` from git is not overwritten by a late `implementing`.)

- [ ] **Step 7: Run the viewer suite (render + boot) and eyeball**

Run: `python3 -m pytest tests/test_viewer.py -q`
Expected: all pass — the new split-sidebar assertion, the boot-under-stub test (the stub already provides `getElementById`/`addEventListener`; `pollAgents`/`setTimeout` is a no-op under the stub), and the JS-parse test. If boot fails on a missing element id, ensure every `getElementById(...)` the new code calls has matching markup (the stub returns a generic element for unknown ids, so this should pass).

Run: `python3 skills/ultrapowers/scripts/render_viewer.py tests/fixtures/marked-plan.md --out /tmp/swarmlive && echo "open file:///tmp/swarmlive/swarm.html"`
Expected: a split view — grid left, sidebar right with `━━ WAVE n ━━` headers and an (empty, on `file://`) feed; DEPICTION still animates the grid. No console errors.

- [ ] **Step 8: Commit**

```bash
git add skills/ultrapowers/viewer/swarm_template.html tests/test_viewer.py
git commit -m "feat(viewer): split pane + sidebar ASCII wave readout + live cross-agent feed"
```

---

### Task 7: Fractal zoom — macro↔meso↔micro camera, data-driven meso graph, scroll/pinch — `swarm_template.html`

**Type:** implementation
**Depends-on:** 3, 4, 6

**Files:**
- Modify: `skills/ultrapowers/viewer/swarm_template.html`
- Modify: `tests/test_viewer.py`

**Interfaces:**
- Consumes: `SwarmZoom.create()` (Task 4, inlined by Task 5), `SwarmLayout.buildMeso(meso)` (Task 3, already inlined via the Phase-1 layout inline), the d3-zoom global `d3.zoom`/`d3.select`/`d3.zoomIdentity` (Task 5), the split-pane sidebar + `focusAgent`/`loadAgent` (Task 6), `status.json` branch `commits[]` + `agents.json` (Tasks 1), and the Phase-1 `el()`/`stations`/`posById`/`matchTask` helpers.
- Produces: a left-pane semantic zoom. Clicking a station flies the camera (600 ms, `ease-in-out`, `transform-origin` at the node, animating only `transform`/`opacity`) into a `#meso` git-graph built by `buildMeso` from that task's `commits[]` + agents; clicking a meso node loads that agent's transcript (micro) in the sidebar; a `#crumbs` breadcrumb + Esc + background-click + `z.out()` zoom out; `prefers-reduced-motion` swaps levels instantly; optional d3-zoom wheel/pinch drives the same scene transform (guarded off under reduced motion).

- [ ] **Step 1: Add failing render assertions**

Add to `tests/test_viewer.py`:

```python
def test_viewer_wires_fractal_zoom(tmp_path):
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    assert "SwarmZoom.create" in html, "template must drive zoom via SwarmZoom"
    assert "SwarmLayout.buildMeso" in html, "meso graph must be built by buildMeso"
    assert 'id="crumbs"' in html and 'id="meso"' in html, "breadcrumb + meso group required"
    assert "prefers-reduced-motion" in html  # reduced-motion path present
    assert "d3.zoom" in html, "optional scroll/pinch wiring present"
```

Run: `python3 -m pytest tests/test_viewer.py::test_viewer_wires_fractal_zoom -q`
Expected: FAIL — none of those tokens are in the template yet.

- [ ] **Step 2: Add the meso group, breadcrumb, and camera CSS**

In `swarm_template.html`, inside `<svg id="stage">`'s `<g id="scene">`, add a sibling group for the meso graph (hidden until zoom), after `<g id="sink"></g>`:

```html
      <g id="meso" class="meso-layer" hidden></g>
```

Add a breadcrumb element to the `.stage-pane` (above the svg, after the HUD markup):

```html
  <div id="crumbs" class="crumbs" aria-label="zoom breadcrumb"></div>
```

Add camera + meso + breadcrumb CSS (transform/opacity only — no layout shift):

```css
  .crumbs{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:15;
    color:var(--hud);font-family:var(--font);font-size:10px;letter-spacing:.16em}
  .crumbs button{background:none;border:none;color:var(--hud);cursor:pointer;font:inherit;padding:0 2px}
  .crumbs button[aria-current=true]{color:var(--ink)}
  #scene{transition:transform .6s ease-in-out,opacity .6s ease-in-out;transform-origin:50% 50%}
  #scene.zoomed{opacity:0;pointer-events:none}
  .meso-layer[hidden]{display:none}
  .meso-trunk{stroke:var(--ink);stroke-width:2;opacity:.5}
  .meso-branch{stroke:var(--dim);stroke-width:1.6;fill:none;opacity:.8}
  .meso-commit{fill:var(--bg);stroke:currentColor;stroke-width:1.6;cursor:pointer}
  .meso-commit.fix{stroke-dasharray:3 2}
  .meso-gate{fill:none;stroke:var(--hud);stroke-width:1.4;cursor:pointer}
  .meso-merge{fill:var(--accent)}
  .meso-label{fill:var(--ink);font-family:var(--font);font-size:10px}
  @media (prefers-reduced-motion:reduce){ #scene{transition:none} }
```

- [ ] **Step 3: Wire the zoom state machine, the camera, and the breadcrumb**

In the `<script>`, after the grid + sidebar code (Task 6) and before the DEPICTION schedule, add the zoom controller. It animates the macro `#scene` out and renders the meso graph, honoring reduced motion:

```js
// ─── fractal zoom: macro grid ↔ meso git-graph ↔ micro transcript ───────────
const zoom = SwarmZoom.create();
const scene = document.getElementById('scene');
const mesoG = document.getElementById('meso');
const crumbsEl = document.getElementById('crumbs');
const stagePane = document.querySelector('.stage-pane');

function renderCrumbs() {
  crumbsEl.innerHTML = '';
  const cs = zoom.crumbs();
  cs.forEach((c, i) => {
    const b = mkEl('button', null, c.label);
    if (i === cs.length - 1) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => { goTo(c.level, zoom.focus().task); });
    crumbsEl.appendChild(b);
    if (i < cs.length - 1) crumbsEl.appendChild(mkEl('span', null, ' › '));
  });
}
function clearMeso() { mesoG.innerHTML = ''; mesoG.hidden = true; }

function renderMeso(taskId) {
  // assemble from observed data: branch commits[] (status.json) + task agents (agents.json)
  const br = (lastStatus.branches || []).find(b => matchTask(b.name + ' ' + (b.worktree || '')) == taskId);
  const m = SwarmLayout.buildMeso({
    commits: (br && br.commits) || [],
    agents: (agentsByTask[taskId] || []).map(a => ({ role: a.role, iter: a.iter })),
    merged: !!(br && br.merged),
  });
  mesoG.innerHTML = '';
  document.getElementById('stage').setAttribute('viewBox', `0 0 ${m.width} ${m.height}`);
  el('line', { class: 'meso-trunk', x1: m.trunk.x, y1: m.trunk.y0, x2: m.trunk.x, y2: m.trunk.y1 }, mesoG);
  el('path', { class: 'meso-branch',
    d: `M ${m.trunk.x} ${m.fork.y} L ${m.branchX} ${m.fork.y}` +
       (m.merge ? ` M ${m.branchX} ${m.fork.y} L ${m.branchX} ${m.merge.y - 0} L ${m.trunk.x} ${m.merge.y}` : '') }, mesoG);
  m.commits.forEach(c => {
    const cl = 'meso-commit' + (c.role === 'fix' ? ' fix' : '');
    const node = el('circle', { class: cl, cx: c.x, cy: c.y, r: 8 }, mesoG);
    el('text', { class: 'meso-label', x: c.x + 14, y: c.y + 3 }, mesoG).textContent =
      c.sha + ' ' + (c.subject || '').slice(0, 28);
    node.addEventListener('click', ev => {
      ev.stopPropagation();
      const ags = agentsByTask[taskId] || [];
      const impl = ags.find(a => a.role === 'impl') || ags[0];
      if (impl) { zoom.toMicro(taskId, impl.id, 'T' + taskId); focusAgent([impl], 'T' + taskId); renderCrumbs(); }
    });
  });
  m.gates.forEach(g => {
    el('rect', { class: 'meso-gate', x: g.x - 7, y: g.y - 7, width: 14, height: 14, rx: 3 }, mesoG);
  });
  if (m.merge) el('circle', { class: 'meso-merge', cx: m.merge.x, cy: m.merge.y, r: 6 }, mesoG);
  mesoG.hidden = false;
}

function goTo(level, taskId) {
  if (level === 'macro') {
    zoom.reset(); closeTranscript(); clearMeso();
    scene.classList.remove('zoomed');
    document.getElementById('stage').setAttribute('viewBox', `0 0 ${grid.width} ${grid.height}`);
  } else if (level === 'meso') {
    zoom.toMeso(taskId); closeTranscript(); renderMeso(taskId);
    scene.classList.add('zoomed');
  }
  renderCrumbs();
}

function zoomToStation(taskId, node) {
  // camera origin at the clicked node so the fly-in emanates from it
  const r = node.getBBox ? node.getBBox() : null;
  if (r) scene.style.transformOrigin = (r.x + r.width / 2) + 'px ' + (r.y + r.height / 2) + 'px';
  goTo('meso', taskId);   // CSS .zoomed transition (or instant under reduced-motion) handles the rest
}

stagePane.addEventListener('click', e => { if (e.target === scene || e.target.tagName === 'svg') goTo('macro'); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (zoom.level() === 'macro') return;
  goTo(zoom.out() === 'macro' ? 'macro' : 'meso', zoom.focus().task);
});
renderCrumbs();
```

In the Phase-1 station construction loop, change the station click handler so a click **zooms** (not just opens a transcript). Replace the per-station `g.addEventListener('click', …)` body with:

```js
  g.classList.add('clickable');
  g.setAttribute('tabindex', '0');
  g.setAttribute('role', 'button');
  g.addEventListener('click', () => zoomToStation(String(t.id), g));
  g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoomToStation(String(t.id), g); } });
```

(Capture `lastStatus` in `gotStatus`: add `lastStatus = s;` at the top of `gotStatus(s)` and declare `let lastStatus = {};` near the other observer state so `renderMeso` can read the freshest `commits[]`.)

- [ ] **Step 4: Add the optional d3-zoom scroll/pinch (guarded off under reduced motion)**

After the zoom controller, attach d3-zoom to the stage for continuous wheel/pinch zoom — only when motion is allowed and d3-zoom is present, so the node boot stub (reduced) and any d3-less render skip it:

```js
// optional: continuous wheel/pinch on the same scene transform (phase 3+).
if (!reduced && typeof d3 !== 'undefined' && d3.zoom) {
  try {
    const zb = d3.zoom().scaleExtent([1, 8]).on('zoom', ev => {
      scene.style.transform = 'translate(' + ev.transform.x + 'px,' + ev.transform.y +
        'px) scale(' + ev.transform.k + ')';
    });
    d3.select(document.getElementById('stage')).call(zb);
  } catch (e) { /* d3-zoom optional: never block the core click-to-zoom */ }
}
```

- [ ] **Step 5: Run the viewer suite (render + boot) and eyeball the zoom**

Run: `python3 -m pytest tests/test_viewer.py -q`
Expected: all pass — `test_viewer_wires_fractal_zoom`, the split-sidebar test, the boot-under-stub test (the d3-zoom attach is skipped because the stub reports `prefers-reduced-motion: reduce`, i.e. `matchMedia(...).matches === true`), and the JS-parse test.

Run with a transcript fixture to see meso + micro live:
```bash
python3 skills/ultrapowers/scripts/render_viewer.py tests/fixtures/marked-plan.md \
  --transcripts $(python3 - <<'PY'
import json,pathlib,tempfile
d=pathlib.Path(tempfile.mkdtemp())
(d/'agent-a1.jsonl').write_text(json.dumps({"type":"user","version":"2.1.177","message":{"content":[{"type":"text","text":"You are an implementer subagent operating inside a dedicated git worktree.\n### Task 1: x\n"}]}})+"\n"+json.dumps({"type":"assistant","version":"2.1.177","message":{"model":"m","usage":{"output_tokens":1},"content":[{"type":"text","text":"working"},{"type":"tool_use","name":"Edit","input":{"file":"a"}}]}})+"\n")
(d/'agent-a1.meta.json').write_text(json.dumps({"agentType":"workflow-subagent","worktreePath":"/wt"}))
print(d)
PY
) --out /tmp/swarmzoom --embed && echo "open file:///tmp/swarmzoom/swarm.html"
```
Expected (served or `--embed`): clicking station T1 flies into a meso git-graph; clicking a commit opens the agent transcript in the sidebar; the breadcrumb shows `run · wave plan › T1`; Esc returns to the grid. No console errors.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/viewer/swarm_template.html tests/test_viewer.py
git commit -m "feat(viewer): fractal macro↔meso↔micro zoom + data-driven meso git-graph"
```

---

### Task 8: Collapse the two viewer offers into one live+readable viewer — `SKILL.md` + `report-format.md`

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `tests/test_viewer_offer_touchpoints.py`

**Interfaces:**
- Consumes: the `serve_viewer.py … --transcripts <dir> --watch . <branch>` invocation enabled by Task 2 (one command renders the transcript-readable viewer AND starts the watcher emitting `status.json` + `agents.json`).
- Produces: a single live+readable viewer offer at launch (Step 4) instead of two separate offers (launch `--watch` + post-run `--transcripts`); the gate (Step 5) references the already-open live viewer rather than spinning a second one; the touchpoints test asserts the collapsed shape.

- [ ] **Step 1: Update the touchpoints test to the collapsed intent (failing)**

In `tests/test_viewer_offer_touchpoints.py`, replace `test_skill_offers_viewer_at_launch_and_gate` with an assertion that the SINGLE launch offer uses both flags together:

```python
def test_skill_offers_one_live_readable_viewer():
    text = SKILL.read_text()
    assert "serve_viewer.py" in text, "the live viewer must be offered"
    # ONE launch command now streams transcripts during the run: both flags together
    assert "--transcripts" in text and "--watch" in text, "live viewer uses both --transcripts and --watch"
    import re
    # the launch offer threads --transcripts and --watch into a single serve_viewer invocation
    assert re.search(r"serve_viewer\.py[^\n]*--transcripts[^\n]*--watch", text), \
        "launch offer must combine --transcripts and --watch in one command"
    assert text.count("serve_viewer.py") >= 2, "still expect the offer + its --stop teardown line"
```

Run: `python3 -m pytest tests/test_viewer_offer_touchpoints.py -q`
Expected: FAIL — the current SKILL.md launch offer (`serve_viewer.py <plan> --watch . <branch>`) has no `--transcripts` on the same line.

- [ ] **Step 2: Collapse the launch offer in `SKILL.md` (Step 4)**

In `skills/ultrapowers/SKILL.md`, find the launch-time offer paragraph beginning **"After launch, offer the live view (interactive runs only)."** Replace its command and wording so the one viewer is live-state AND transcript-readable from the moment it opens:

> **After launch, offer the live, readable view (interactive runs only).** The run is headless, but this conversation is not — surface a one-line opt-in: *"Want to watch live? I'll open the swarm viewer — live progress and every agent's transcript, streaming."* On yes, run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py <plan-path> --transcripts <transcript-dir> --watch . <integrationBranch>` and hand back the printed `http://localhost:<port>/swarm.html`. One viewer now does both jobs: `swarm_watch` writes `status.json` (station state) **and** `agents.json` (the live cross-agent feed + per-agent index) from the run's git + transcript footprints, and the viewer streams each agent's transcript on demand. The transcript dir is printed in the Workflow launch result ("Transcript dir:"). Tear it down at the gate (`serve_viewer.py --stop <dir>`). Skip the offer in a headless/non-interactive run.

- [ ] **Step 3: Fold the post-run audit-drawer offer into "already open" (Step 5)**

In `SKILL.md` Step 5, find the paragraph beginning **"To *read* the transcripts (not just their effort stats), offer the audit drawer…"**. Replace it so it points at the already-running live viewer and only spins a fresh one if none is open:

> To *read* the transcripts at the gate: if the live viewer from Step 4 is still running, it already shows every agent's transcript — point the human at the open `http://localhost:<port>/swarm.html` (click a station to zoom into its commits and agents; click a commit to read that agent's reasoning + tool I/O). If no viewer is running (headless launch, or it was torn down), offer to open one: *"Want to read any agent's transcript? I'll open the swarm viewer."* On yes, run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py <plan-path> --transcripts <transcript-dir>` and hand back the URL; add `--embed` for a self-contained offline file. Read-only; see `skills/ultrapowers/viewer/README.md`.

(This keeps `serve_viewer.py` mentioned at both Step 4 and Step 5 — the touchpoints test still sees ≥2 mentions, both flags, and the combined launch command.)

- [ ] **Step 4: Update `report-format.md` item 12**

In `skills/ultrapowers/references/report-format.md`, replace item **12. Transcript reading (optional)** so it reflects the one live viewer:

> 12. **Live viewer (optional):** if the launch-time live viewer is still serving, point the human at its `http://localhost:<port>/swarm.html` — live station state, the cross-agent feed, and click-to-zoom into any agent's transcript. Otherwise offer to open one: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/serve_viewer.py <plan-path> --transcripts <transcript-dir>`. One line, opt-in, read-only; skip in headless runs.

- [ ] **Step 5: Run the touchpoints test + the render pointer test**

Run: `python3 -m pytest tests/test_viewer_offer_touchpoints.py -q`
Expected: 3 passed (`test_skill_offers_one_live_readable_viewer`, `test_report_format_mentions_transcript_offer`, `test_render_viewer_prints_serve_viewer_pointer`).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md tests/test_viewer_offer_touchpoints.py
git commit -m "docs(viewer): collapse the two viewer offers into one live+readable viewer"
```

---

### Task 9: Full suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7, 8

**Files:** none — verification only.

Run the viewer-relevant suites and confirm green:

- `node tests/swarm_meso_spec.mjs` → `ALL TESTS PASSED`
- `node tests/swarm_zoom_spec.mjs` → `ALL TESTS PASSED`
- `node tests/swarm_layout_spec.mjs` → `ALL TESTS PASSED` (Phase-1 layout unregressed)
- `node tests/audit_project_spec.mjs` → `ALL TESTS PASSED`
- `python3 -m pytest tests/test_viewer.py tests/test_swarm_agents.py tests/test_serve_viewer.py tests/test_swarm_meso.py tests/test_swarm_zoom.py tests/test_swarm_layout.py tests/test_viewer_offer_touchpoints.py -q`
- `python3 -m pytest tests/ -q` (full suite; nothing else regressed)

Expected: all green. This gate writes nothing; its command set informs `testCmd` (`python3 -m pytest tests/ -q`, which runs the node specs via their pytest wrappers).

---

## Self-review (spec coverage)

- **`agents.json` (index + bounded `recentEvents` ring), incremental tailing** → Task 1.
- **Per-branch `commits[]` folded into `status.json`** → Task 1.
- **`serve_viewer.py` threads `--transcripts` into the `--watch` live path** → Task 2.
- **Split layout: graph left, always-text sidebar right** → Task 6.
- **ASCII wave headers + live cross-agent feed (clickable)** → Task 6.
- **Richer observed station-state grammar (implementing/under-review/fixing)** → Task 6.
- **Data-driven meso commit/review/merge git-graph (trunk, fork, real commits, gates for reviews, fix-tinted commits, two-parent merge)** → Task 3 (`buildMeso`) + Task 7 (render).
- **Click-to-zoom backbone: 600 ms ease-in-out, transform-origin at the node, transform+opacity only, Esc/breadcrumb/background out** → Task 7 + `SwarmZoom` (Task 4).
- **Micro: focused agent transcript via the existing projection** → Task 6 (sidebar transcript) + Task 7 (meso-node → micro).
- **Optional scroll/pinch via d3-zoom on the same transform** → Task 7 (guarded).
- **`prefers-reduced-motion` swaps instantly** → Task 7 CSS + the reduced guard.
- **One live+readable viewer; SKILL.md/report-format.md collapsed** → Task 8.
- **Self-contained/offline/drift-safe; vendored d3-zoom; boots under the DOM stub; node-spec'd JS logic; CAPS unchanged** → Global Constraints + Tasks 3/4 node specs + Task 5 boot test + the pre-flight vendor commit.
- **Honesty model preserved (observed signals; DEPICTION/OBSERVING/SIGNAL LOST badges)** → Global Constraints; Tasks 6/7 add only observed data and easing.

## Appendix — Acceptance coverage (suite disposition)

This plan builds ultrapowers' own viewer tooling; verification is the committed test
suite the operator can read, not a held-out exam. Coverage map:

| Spec requirement | Verifying test(s) |
|---|---|
| `agents.json` shape + bounded ring + fix-round `iter` | `tests/test_swarm_agents.py` |
| per-branch `commits[]` (+/−, files) | `tests/test_swarm_agents.py::test_status_carries_branch_commits` |
| watcher emits `agents.json` end-to-end (`--once`) | `tests/test_swarm_agents.py::test_watch_once_writes_agents_json` |
| `serve_viewer` threads `--transcripts` into watch | `tests/test_serve_viewer.py::test_build_watch_cmd_threads_transcripts` |
| meso topology (lean/adversarial/fix/merge) | `tests/swarm_meso_spec.mjs` (via `tests/test_swarm_meso.py`) |
| zoom macro↔meso↔micro transitions + breadcrumb | `tests/swarm_zoom_spec.mjs` (via `tests/test_swarm_zoom.py`) |
| d3-zoom + SwarmZoom inlined, viewer still boots | `tests/test_viewer.py::test_render_inlines_d3zoom_and_swarm_zoom`, `…::test_viewer_boots_without_transcripts_under_dom_stub` |
| split sidebar + feed + agents.json polling | `tests/test_viewer.py::test_viewer_has_split_sidebar_and_feed` |
| fractal-zoom wiring + reduced-motion + scroll/pinch | `tests/test_viewer.py::test_viewer_wires_fractal_zoom` |
| one live+readable viewer offer | `tests/test_viewer_offer_touchpoints.py::test_skill_offers_one_live_readable_viewer` |
