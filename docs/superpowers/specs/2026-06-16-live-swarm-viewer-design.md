# Live swarm viewer: d3-dag grid, fractal zoom, real-time transcripts

Replace the radial swarm viewer with a legible **d3-dag grid**, make it update **live**
during a run, and let the human **zoom from the run down into a single subagent's
version-control work**. The viewer stays passive, read-only, and self-contained.

## Problem

Two complaints, two root causes.

1. **The DAG is illegible to a layperson.** The radial layout (hub = integration,
   waves = concentric rings, tasks placed by angle) encodes dependencies as edges that
   cross rings and state as subtle opacity/glyph changes. You cannot trace what depends on
   what, nor read where the run is.

2. **It never feels live.** The machinery exists — `swarm_watch.py` writes `status.json`
   from git and the viewer polls it — but:
   - The launch viewer starts **without `--transcripts`** (`SKILL.md:319`), so the rich
     real-time signal (agents reasoning, tool calls landing) never reaches the screen
     during the run. Transcripts are offered only *after* the run, as a separate viewer.
   - `AUDIT_INDEX` is **baked at render time**, so agents spawned later in the run never
     appear.
   - `status.json` carries only coarse git state, so between commits the screen is dead.

## Decisions (brainstormed 2026-06-16)

- **Layout:** d3-dag **grid** preset, vertical, top→down, with INTEGRATION as the sink at
  the floor. Waves are *implicit* in the vertical ranks — no drawn wave containers.
- **Look:** a single shipped skin, **phosphor (dark)**. Keep the theme *palette*
  dictionary as data (so `--theme` still recolors); drop the radial-only structural
  switches (rings, glyphs, orbits).
- **Information architecture:** a split pane. Left = the zoomable graph. Right = an
  always-text sidebar: ASCII wave headers + a live feed at the macro level, the focused
  agent's transcript at the meso/micro level.
- **Fractal zoom:** one git-graph at three zoom levels — macro (the task grid) → meso (one
  task's commit/review/merge graph) → micro (an agent's transcript). **Click-to-zoom** is
  the backbone; scroll/pinch is an optional later enhancement on the same transform model.
- **Honesty:** motion is driven by *real* observed activity. Retire the fictional agent
  orbits. Keep the `OBSERVING / SIGNAL LOST / DEPICTION` badges and keep DEPICTION
  (seeded playback) for the no-telemetry case.
- **Packaging:** vendor a committed, pre-built d3-dag (+ d3-zoom) browser bundle and inline
  it, exactly as `audit_project.js` is inlined. No CDN, no runtime npm.

## Goals

- A first-time viewer can trace dependencies and read where the run is in five seconds.
- During a run, the screen shows real work continuously: state flips, a live cross-agent
  feed, and streaming transcripts — no dead stretches.
- One click descends from the whole run into a single task's real git history and the
  reasoning of the agents that produced it.
- The viewer remains a single self-contained `swarm.html`: passive, read-only, offline-
  capable, and drift-safe (no engine changes).

## Non-goals

- No live re-layout for "discovered" work. The wave/task set is **frozen at compile time**
  (`compile_plan.py` emits an immutable `waves` array; `waves.js` only iterates it). The
  graph skeleton is known up front; only *state and timing* are live.
- No general graph editor, no manual node dragging, no pan/zoom persistence across reloads.
- No second viewer for transcripts — the launch viewer becomes the one live, readable view.
- No port of the ten radial themes. The palette data survives; the radial structure does not.

## Architecture overview (data flow)

```
compile_plan.py ──(baked once at render)──► DAG: tasks, dag_edges, waves
                                             → d3-dag grid → macro node x/y + edge paths

swarm_watch.py  ──(poll ~2s)──► status.json  git truth: branches (ahead/merged/commits[]),
                                             worktrees, integration
swarm_watch.py  ──(poll ~2s)──► agents.json  live transcript index: per-agent
                                             id/file/role/task/iter/model/turns/state/
                                             lastActivity  +  a bounded recentEvents ring

viewer (macro)  ── polls status.json + agents.json ─► station state, ASCII readout, feed
viewer (meso)   ── on zoom: read the task's branch commits (status.json) + its agents
                   (agents.json); fetch the few relevant agent-*.jsonl on demand
viewer (micro)  ── stream the one focused agent-*.jsonl (audit_project.js projection)
```

The watcher stays light: it tails transcripts only enough to maintain the `recentEvents`
ring and per-agent metadata. Every heavy, full-transcript projection happens client-side,
on demand, for the *one* agent in focus — never for all agents at once.

## The graph: d3-dag grid (macro) — legibility

`render_viewer.py`'s `build_dag` already extracts `title`, `mode`, `waves`, `edges`
(from `dag_edges`), and `tasks` from the compiled plan. The template feeds `tasks` +
`edges` to **d3-dag's grid layout**, with the wave index pinned as the topological rank,
and reads back `node.x / node.y` and each link's `points`.

- Vertical, top→down. Wave 0 at the top, later waves below, and INTEGRATION as a synthetic
  sink at the floor that terminal tasks (those nothing depends on) flow into — the point
  where every branch ultimately merges.
- One **station per implementation task** = one real git branch (`worktree-wf_*`). That is
  the station's meaning: an isolated unit of work that forks from integration and merges
  back.
- Edges are the real `dag_edges`, drawn as the grid's routed link paths (metro-line feel).
- Positions are computed **once** (the DAG is static) and never move; live data only
  changes a station's color/state and animates pulses. This preserves the project's
  "paths are prefigured" property.
- Station state grammar (all observed): `pending` (faint) → `implementing` (amber) →
  `under-review` → `fixing` → `committed` → `merged` (green) → `stalled` (watcher lost or
  no activity). Derived from `status.json` (branch ahead/merged) joined with `agents.json`
  (which role is currently active on the task).

Waves are *implicit* in the vertical ranks. The wave abstraction lives as text in the
sidebar (below).

## The fractal zoom: macro → meso → micro

The left pane is a semantic zoom. Only one level is visible at a time, so no level is busy.

### Macro
The task grid above. Sidebar shows the ASCII wave readout + live feed.

### Meso (the subagent git-graph)
Clicking a station descends into that task's real version-control work, drawn as a faithful
commit graph, **assembled from observed data**:

- The integration **trunk** (a vertical line) and the task **branch** forking off it at the
  fork commit.
- The implementer's **actual commits** as nodes on the branch (from
  `git log <integration>..<branch>`: short sha, subject, files, +/−). Count is real (TDD
  runs produce several; a one-shot produces one).
- Reviews as **gates**, not commit-nodes (reviewers are read-only): one gate for lean
  review, two parallel gates that rejoin for adversarial review. Verdict (PASS /
  FIX_REQUIRED) and blocking-issue count come from the review agent's transcript.
- The fixer's commits appear **only if a fix iteration occurred** (role `fix:task:iter`).
- The **merge** node is a genuine two-parent join: the branch tip and the integration
  trunk converging into one merged commit. This is the "multiple lines → one commit" the
  whole picture is built around; the wave-wide version of it is the macro convergence into
  the sink.

Each node is clickable → its agent's transcript loads in the sidebar (micro). The meso for
a task is built lazily on first zoom and refreshed while that task is in focus.

### Micro
The focused agent's transcript: reasoning (`●`), tool calls (`⚙`), results (`→`), streamed
~2s from its `agent-*.jsonl` via the existing `audit_project.js` projection. Truncated by
`CAPS`; never loads a whole file into an assistant's context.

### Zoom interaction
- **Click-to-zoom** is the backbone. The camera flies into the clicked node:
  `transform-origin` at the node, **600ms**, `ease-in-out`, animating only `transform` and
  `opacity`. The slower-than-usual duration is deliberate — the zoom is a rare, special
  traversal, not a high-frequency control, so it earns emphasis.
- **Exit:** Esc, a `⟵ map` breadcrumb, or clicking the background. The breadcrumb always
  shows the current depth (`run · wave plan` / `T4`).
- **Scroll/pinch (optional, phase 3+):** d3-zoom drives the same `zoom.transform` for
  continuous zoom + pan, so click-to-fit and wheel/pinch are one model, not two systems.
- **Reduced motion:** `prefers-reduced-motion` swaps levels instantly, with no transform
  animation. Keyboard: stations are focusable buttons; Enter/Space zoom in, Esc out.

## The split layout & sidebar

Left pane = the graph (≈ 55–60%). Right sidebar = always text.

- **At macro:** an ASCII wave readout — `━━ WAVE 2 ━━ ● working` headers with each task
  listed under its wave and its status — followed by a live, time-ordered **feed** of
  recent events across all agents (`12:04 T5 ⚙ Edit api.ts`, `T1 → merged`). The feed is
  the `recentEvents` ring from `agents.json`; clicking a line focuses that agent.
- **At meso/micro:** the focused agent's streaming transcript.

## Liveness: agents.json + the wiring fix

Three changes turn the existing machinery live.

1. **`swarm_watch.py` emits `agents.json`.** Given the run's transcript dir, it enumerates
   `agent-*.jsonl` each interval and writes a light index: per agent `id/file/role/task/
   iter/model/turns/tools/state/lastActivity`, plus a bounded `recentEvents` ring (the last
   ~40 events across all agents: `{ts, task, role, kind, text}`). It also folds a per-branch
   `commits[]` summary into `status.json`'s branch entries (it already runs git per branch).
   The watcher never opens a whole transcript beyond what the ring needs.

2. **`serve_viewer.py` passes `--transcripts` into the live path.** The launch/watch
   invocation renders with the run's transcript dir *and* starts the watcher against it, so
   the one viewer is live-state *and* readable from the moment it opens.

3. **`SKILL.md` collapses the two offers into one.** The launch-time offer becomes a single
   live, transcript-readable viewer; the post-run "audit drawer" offer is folded in (or
   reduced to "it's already open"). The headless/non-interactive skip stays.

The viewer polls `status.json` (git truth) and `agents.json` (activity), merges them onto
stations and the feed, and discovers agents as they appear. It fetches a full `agent-*.jsonl`
only for the agent in focus.

## Honesty model

- **Observed (solid):** station state, the feed, the meso commit graph, and every
  transcript are real — from git and the transcripts. The "sense of work" is now actual
  work, which strengthens the honesty contract rather than decorating around it.
- **Dramatized (minimal):** only easing and pulse styling remain. A station pulses when a
  real transcript line or git event lands; there are no fictional orbits or ambient agents.
- **Badges:** `OBSERVING` (fresh `status.json`), `SIGNAL LOST` (watcher stopped),
  `DEPICTION` (no telemetry — seeded, deterministic playback of the computed wave plan for
  `file://` / pre-run). The Observed/Dramatized legend stays.

## Components touched

| File | Change |
|---|---|
| `viewer/swarm_template.html` | Rewritten render layer: d3-dag grid, split pane, sidebar readout + feed, fractal zoom state machine. Largest change. |
| `viewer/vendor/d3-dag.bundle.js` (new) | Committed, pre-built d3-dag (+ d3-zoom) browser bundle, inlined at render. |
| `scripts/render_viewer.py` | Inline the vendor bundle; pass the DAG to the grid; keep the palette/theme var seam; drop radial-only theme switches. |
| `scripts/swarm_watch.py` | Emit `agents.json` (index + `recentEvents`); add per-branch `commits[]` to `status.json`. |
| `scripts/serve_viewer.py` | Thread `--transcripts` into the `--watch` live path. |
| `viewer/audit_project.js` | Reused for micro; add a small commit/meso assembly helper if needed (keep `CAPS` in sync). |
| `skills/ultrapowers/SKILL.md`, `references/report-format.md` | One live+readable viewer offer; update wording. |

## Packaging

Vendor d3-dag and d3-zoom as a **single committed browser bundle** under
`viewer/vendor/`, produced once by a documented esbuild step (recorded in
`viewer/vendor/README.md`), and inline it into `swarm.html` the way `render_viewer.py`
inlines `audit_project.js`. This keeps `swarm.html` self-contained, offline-capable, and
drift-safe. No CDN, no runtime package manager. If a future maintainer prefers zero
dependencies, the grid layout could be reimplemented in vanilla JS (the waves already give
the ranks), but the vendored bundle is the chosen path because the user asked for d3-dag.

## Accessibility & motion

- Animate only `transform` and `opacity`; no layout shift; `tabular-nums` for changing
  counters.
- Every animation has a `prefers-reduced-motion` path that disables it.
- Stations and feed lines are focusable, keyboard-operable buttons with aria labels; Esc
  always escapes a zoom. 44px minimum hit targets (transparent hit circles over small
  glyphs).
- Hover affordances behind `@media (hover: hover)`.

## Testing

- **Python (pytest):** `swarm_watch.py` emits a well-formed `agents.json` (index fields,
  bounded `recentEvents`) and per-branch `commits[]` from a fixture transcript dir + git
  repo; degrades when the transcript dir is absent. `serve_viewer.py` threads
  `--transcripts` into the watch path.
- **JS (node, as today via `module.exports`):** d3-dag grid produces deterministic node
  positions for a fixture DAG; meso assembly builds the right topology from fixture
  commits + agents (lean vs adversarial vs fix-loop); the zoom state machine transitions
  macro→meso→macro and loads the right transcript. `audit_project.js` projection unchanged.
- **Degradation:** `file://` shows DEPICTION + STATIC transcripts; missing `agents.json`
  leaves macro working from `status.json` + the baked DAG.

## Phasing (one spec, three increments)

1. **Grid** — replace the radial render layer with the d3-dag grid; vendor + inline the
   bundle; phosphor skin; ASCII wave readout. Shippable on its own (legibility win).
2. **Live** — `agents.json` from the watcher; the split feed; `serve_viewer.py` +
   `SKILL.md` wiring so the launch viewer streams transcripts during the run.
3. **Fractal zoom + polish** — click-to-zoom macro↔meso↔micro, the data-driven meso commit
   graph, real-event pulses, reduced-motion paths; optional scroll/pinch.
