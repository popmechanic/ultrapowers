# Surface the swarm viewer at launch and the pre-merge gate

**Date:** 2026-06-15
**Scope:** Orchestrator-facing only — a new `skills/ultrapowers/scripts/serve_viewer.py` helper, touchpoint offers in `skills/ultrapowers/SKILL.md` (Step 4 launch, Step 5 gate) and `skills/ultrapowers/references/report-format.md`, and a one-line pointer in `render_viewer.py`'s printed next-steps. **No engine change** (`waves.js` stays frozen). The viewer stays passive and read-only. Follow-up to the transcript-audit-drawer work.

## Problem

The swarm viewer is a pull, not a push. Tracing every reference across `skills/`, `hooks/`, and `references/`, the developer is never proactively offered it:

- The execution handoff (the SessionStart routing hook) and the workflow launch result mention `/workflows` (the engine's text progress tree) and print the `Transcript dir:` path — but say nothing about the swarm viewer or `swarm_watch`.
- The only in-flow mention is `SKILL.md` Step 5 (the pre-merge gate), written as an instruction to the *orchestrating agent*, not a user-facing offer: "To read the transcripts… render the swarm viewer with `--transcripts`…".
- Otherwise discovery is manual: read `viewer/README.md` or notice `render_viewer.py`.

This contradicts the viewer's stated purpose (`viewer/README.md`): "it exists so the human has something true to watch **during the autonomous stretch between launch and the pre-merge gate**." That stretch is exactly when nothing points to it; by the time it *is* mentioned (the gate) the run is over and there is nothing live to watch. And even once discovered, both modes are a manual multi-command dance (render → serve over http → open localhost), with `swarm_watch` adding a third process for the live view.

## Decisions (made during brainstorming, 2026-06-15)

1. **Surface at both touchpoints.** Launch (Step 4) offers the **live progress** view; the pre-merge gate (Step 5) offers the **audit drawer** for transcript reading. Two moments, two genuinely different views.
2. **One-command helper.** A new `serve_viewer.py` renders, picks a free port, serves in the background, optionally starts `swarm_watch`, prints a clickable URL, and tears down with `--stop`. Both the orchestrator's offer and a manual user collapse to one line.
3. **Active, opt-in.** The orchestrator surfaces a one-line offer and, on yes, runs the helper and hands back the URL. **Headless/cron runs skip the offer** (no one is watching; don't spin up a server) — matching the skill's existing headless posture.
4. **No engine change.** Orchestrator-run shell + SKILL.md / report-format prose only; `waves.js` stays frozen, consistent with the viewer's drift-safe principle.
5. **Launch offers the progress view, not clickable transcripts.** The audit index is baked at render time, so at launch clicking a station would show only the agents that existed when the viewer was rendered. The live-progress geometry (`swarm_watch`) is the right launch view; clickable-transcript value lands at the gate with the complete index.

## Goals

- The developer is offered the viewer at launch (live progress) and at the gate (transcript reading), each as a one-line opt-in.
- On yes, a single command renders + serves and returns a clickable `http://localhost:<port>/swarm.html`.
- A manual user gets the same one-liner.
- Headless runs never spin up a server.
- No engine change; transcripts stay read-only (live mode symlinks, never copies — unchanged).

## Non-goals

- Auto-opening the developer's browser (the orchestrator hands a URL; it does not drive the user's browser).
- Always-on serving, or serving without an explicit opt-in.
- Any `waves.js` / engine change, or new viewer features (this is discovery + serving, not the viewer itself).
- A live-updating audit index during a run (the static index is fine; the gate has the complete one).

## The helper: `scripts/serve_viewer.py`

One unit, one job: render → serve → print URL → tear down.

```
serve_viewer.py <plan> [--transcripts <dir>] [--watch <repo> <integration-branch>] [--out <dir>] [--port N]
serve_viewer.py --stop <dir>
```

- Renders via `render_viewer.py` (threading `--transcripts` through when given). `--out` defaults to a fresh `mktemp` dir under the system temp.
- `--watch <repo> <branch>` starts `swarm_watch.py --repo <repo> --out <out> --integration <branch>` in the background — the live telemetry that writes `status.json` next to `swarm.html`.
- Picks a **free port** by binding `:0` (or honors `--port`), starts `python3 -m http.server <port> --directory <out>` **detached** (`subprocess.Popen(..., start_new_session=True)`), and writes the child PIDs to `<out>/.viewer-pids`.
- Prints `▶ http://localhost:<port>/swarm.html` and the matching `serve_viewer.py --stop <out>` line, then **exits** — so the caller gets the URL immediately and the server outlives the call.
- `--stop <dir>` reads `<dir>/.viewer-pids` and terminates the server (and watcher), then removes the PID file. Idempotent: a missing/empty PID file is a no-op.
- Read-only: never writes into `--transcripts`; the underlying `render_viewer.py` symlinks (live) or bakes truncated copies (`--embed`), never mutating the source.

## Touchpoints (SKILL.md + report-format.md)

The orchestrator surfaces these; they are not engine behavior.

- **Step 4 — launch (live progress).** Immediately after launching the workflow and reporting the run is underway, the orchestrator adds a one-line **opt-in offer**: *"Want to watch live? I'll serve the swarm at a localhost URL."* On yes → `serve_viewer.py <plan> --watch . <integration-branch>` → hand back the printed URL. Note that it will be torn down at the gate. Skip the offer entirely in a headless/non-interactive run.
- **Step 5 — gate (transcript reading).** The buried orchestrator-facing audit-read prose becomes a **user-facing offer** in the report presentation order (`report-format.md`): *"Want to read any agent's transcript? I'll open the audit drawer."* On yes → first `serve_viewer.py --stop <launch-out>` (tear down the launch viewer if it is running), then `serve_viewer.py <plan> --transcripts <transcript-dir>` → hand back the URL, and mention `render_viewer.py … --embed` for a shareable offline file. The gate viewer is left running (the user is actively reading) with its `--stop` line printed.
- **`render_viewer.py` next-steps.** Add one line to the existing printed usage pointing manual users at `serve_viewer.py` as the one-command path. (Pure addition; the existing lines stay.)

## Lifecycle & headless safety

- The launch viewer is torn down at the gate; the gate viewer persists until the user runs the printed `--stop`. PIDs live in the out dir, so nothing orphans across the run.
- The offer is a question the orchestrator asks; a headless/cron run skips it and serves nothing.

## Testing

`tests/test_serve_viewer.py` (pytest, subprocess — same pattern as `test_viewer.py` / `test_sweep_worktrees.py`):

- Renders and serves: run `serve_viewer.py <plan> --out <tmp> --port <free>`, parse the printed URL, `curl` it → 200, and `agent` files are reachable; then `--stop <tmp>` → the port no longer responds.
- Free-port selection: omit `--port`, assert the printed URL's port is open and serving.
- `--watch`: with a tiny git fixture repo + integration branch, assert `status.json` appears in the out dir.
- Read-only: with `--transcripts <fixture>`, md5 the fixture transcripts before/after → identical; out dir holds symlinks, not copies.
- `--stop` idempotence: stopping an already-stopped/never-started dir exits 0.

Tests bind their own free ports and use `tmp_path`, so same-wave runs stay concurrency-safe.

## Packaging

One marked plan (ultraplan). The helper + its test are one task; the SKILL.md / report-format.md / render_viewer.py touchpoint edits are a second (they reference `serve_viewer.py`, so they Depend-on the helper task). `suite` acceptance — ultrapowers' own tooling, verified by the committed suite. No version bump decision here; fold into the next release.
