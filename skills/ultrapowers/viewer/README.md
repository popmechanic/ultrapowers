# ULTRAPOWERS swarm viewer

A passive, optional, local visualization of a run. The macro view is the
compiled plan drawn as a dependency grid: one station per task, placed at its
grid coordinate and tinted by wave, with routed dependency edges converging on
the integration trunk. Click any station to zoom into that task's git-graph,
and again to read a single agent's transcript — a fractal from the whole run
down to one reasoning trace. Faint CRT framing, phosphor bloom, branded
`ULTRAPOWERS` in the corner. It takes no input but the plan (and optionally a
run's transcript dir) — it exists so the human has something true to watch
during the autonomous stretch between launch and the pre-merge gate.

## Fractal zoom

Three levels, with a breadcrumb trail and a ~600ms camera (instant under
reduced-motion); a vendored `d3-zoom` adds optional wheel/pinch on top.

- **macro — `run · wave plan`.** The dependency grid. Stations carry their live
  state in the CSS `[data-state]` grammar: `working`/`implementing`,
  `under-review`, `fixing`, `committed`, `merged` (and `stalled`). The
  integration sink at the convergence opens the run-level agents.
- **meso — `T<id>`.** One task's git topology assembled from observed data: the
  integration trunk, the branch fork, real commit nodes, the review gate(s)
  (one for a lean review, two for adversarial), and the two-parent merge.
- **micro — `transcript`.** One agent's projected transcript in the sidebar.

## Honesty contract

The viewer is deliberately literal, but two things are *inferred*, not observed,
and the README and on-screen labels say so:

- **Observed (the spine):** station states come from git footprints only — a
  worktree under `.claude/worktrees/wf_*` means *in flight*; a `worktree-wf_*`
  branch with commits ahead means *committed*; the branch tip becoming an
  ancestor of the `ultra/integration-*` branch (or vanishing after the merge
  agent's cleanup while integration advanced) means *merged*. In the meso
  git-graph, each commit's `sha` and `subject` are real. The watcher never
  touches the engine; it reads the repo.
- **Inferred (declared, not measured):** in the meso git-graph the impl-vs-fix
  tint is a heuristic — a second implementer agent on a task is a fix round (the
  engine re-dispatches the implementer prompt, so there is no distinct "fix"
  role) — and the gate depth (lean vs adversarial) is read off the agent counts.

The HUD badge states the mode plainly: `OBSERVING` (fresh status.json),
`SIGNAL LOST` (watcher stopped), `WAITING` (no telemetry yet — the static
wave-plan grid).

## Theme

One skin ships: `asteroids` — gleaming offwhite vectors on black, CRT bezel,
phosphor bloom. `--theme asteroids` is the default; `--list-themes` enumerates
the available themes.

## Usage

```sh
# 1. Generate the viewer from the approved plan (any time after Step 3):
python3 skills/ultrapowers/scripts/render_viewer.py docs/plans/plan.md --out /tmp/swarm

# 2. Semi-live: watch the target repo and serve the folder
python3 skills/ultrapowers/scripts/swarm_watch.py --repo <target-repo> --out /tmp/swarm &
(cd /tmp/swarm && python3 -m http.server 8123)
# open http://localhost:8123/swarm.html

# Static preview (no run, no server): open file:///tmp/swarm/swarm.html
```

## Reading transcripts

Pass a run's transcript dir to make the swarm clickable. Clicking a station (or
its line in the cross-agent feed) zooms to that task and projects the agent's
transcript in the sidebar `#transcript` region — subagent reasoning (`●`), tool
calls (`⚙`), and results (`→`). The integration node opens the run-level agents
(setup, merge, reconcile, integration, unclassified). Find the dir at the
"Transcript dir:" line printed when the Workflow launched, or:

```sh
ls -dt ~/.claude/projects/<project-slug>/*/subagents/workflows/*/ | head -1
```

```sh
# Live: symlinks the raw transcripts next to swarm.html (no copy) and streams
# the open agent's file (~2s refresh). Needs the local server (fetch is blocked
# on file://).
python3 skills/ultrapowers/scripts/render_viewer.py <plan.md> \
    --transcripts <run-dir> --out /tmp/swarm
(cd /tmp/swarm && python3 -m http.server 8123)   # open http://localhost:8123/swarm.html

# Offline / shareable: bake truncated content into one self-contained file.
python3 skills/ultrapowers/scripts/render_viewer.py <plan.md> \
    --transcripts <run-dir> --embed --out /tmp/swarm   # open file:///tmp/swarm/swarm.html
```

Transcripts and worktrees are read-only; `--out` must differ from
`--transcripts`. Served over http the transcript region is live (fetching +
refreshing); `--embed` bakes truncated content for offline/`file://` use;
opened over `file://` with neither, the region shows an inline note to serve
over http or re-render with `--embed`. Content is truncated per
`audit_project.js` `CAPS`; expand reveals more up to the cap, then points to the
raw file. The projection happens in the browser — it never loads whole
transcript files into an assistant's context.

## Design notes

- **Positions are prefigured.** The DAG shape is fully known at compile time
  (`compile_plan.py`), so the macro grid is laid out once at render time from
  the compiled waves and edges (`d3-dag` grid via `swarm_layout.js`); stations
  sit at fixed coordinates. There is no motion engine — a station's "alive"
  feel is the CSS state grammar, not movement.
- **Drift-safe by construction.** No engine changes: `waves.js` stays frozen;
  the watcher observes git artifacts that already exist. If the engine's naming
  conventions ever change, the viewer degrades to the static wave-plan grid
  rather than breaking a run.
- **Reduced motion is first-class.** `prefers-reduced-motion` makes the zoom
  camera instant and drops the flicker, leaving the grid and its live state
  colors — the Step-3 transparency block as a picture.
```
