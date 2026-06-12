# Unified agent visualization for the evals blog post

**Date:** 2026-06-12
**Target:** `docs/superpowers-ultrapowers-evals.html` (plus a new capture script and `docs/media/` output)
**Status:** Approved in brainstorm (animated mockups reviewed interactively)

## Problem

The blog post currently uses three unrelated visual languages for orchestration:
Gantt-style CSS blocks for the serial/waves race, four ad-hoc static DAG
thumbnails on the fixture cards, and no diagram at all for the section that
explains how the engine works. The shapes being compared (serial vs.
fan-out/fan-in waves) are the heart of the post and deserve one consistent,
honest visual metaphor. The post must also be cross-postable to platforms that
cannot run JavaScript (X.com), so the animations need an exported
GIF/MP4 form.

## The visual grammar

One vocabulary across every figure:

- **Time flows left to right.** Always. In the race figure, horizontal
  distance is literally measured minutes.
- **A line is an agent's work.** No path is visible before an agent traces
  it; the moving dot carves the line into existence (stroke-dashoffset
  reveal synced to a dot riding `getPointAtLength`).
- **Nodes:** hollow circle = pending task; filled circle = committed task.
  Task nodes carry their task number; the number→name mapping lives in the
  figcaption.
- **Fan-out / fan-in is the signature shape.** Work starts from a single
  point on the trunk, fans out into concurrent lanes (one per worktree),
  and fans back into a single merge point. Solo tasks are small bumps off
  the trunk — even a solo task gets its own worktree and merge.
- **Colors** (mapped to the post's existing palette):
  - gray — the integration branch (trunk) and structure
  - blue (`--blue`, #1d4ed8 family) — serial condition / serial worker
  - green (`--green`, #047857 family) — wave workers
  - terracotta family (post accent #c2410c) — independent reviewers
  - purple (`--purple`, #7c3aed family) — merge agent / merge nodes
- **The square is the human.** Circles are machine events; the single
  square node is the pre-merge gate where the engine stops and waits.
- **Merge pulse:** an expanding ring at the fan-in marks the merge agent
  landing work on the trunk.
- **Two-tone lanes:** worker color from fork to commit node, reviewer color
  from commit node to fan-in. The lane's tail after the node *is* the
  review-and-merge phase.

## The four pieces

### 1. Anatomy figure (new; engine-explainer section)

Full-size teaching diagram, placed in the "Ultrapowers" section before the
race. One wave, three lanes, fully labeled:

- "integration branch" under the trunk start
- "worktrees — one isolated copy each" at the fan-out
- "one agent per task" at the commit nodes, with model tier label
  (**Sonnet**)
- "independent review" on the reviewer-colored lane tails, with tier label
  (**Opus**)
- "merge agent" at the fan-in (leader line), with tier label (**Haiku**)
- "your gate" under the terminal square

Staging: trunk carves → fork → three workers carve to commits (staggered) →
reviewers pick up each lane and carve to the fan-in → merge node fills +
pulse → trunk resumes → gate square fills. Labels fade in with their phase.
This figure carries the whole pitch: parallelism, isolation, independent
review, and budgeted intelligence (model tiering).

### 2. Race figure (replaces the Gantt blocks)

Both conditions on **one shared time axis** with a ruler in real minutes
(0–46.4 across the figure width). Linear motion, no easing — distance is
time. Every coordinate is measured, not invented:

- **Serial lane (mixed-A-1, launched 22:37:39, 2786 s):** one blue line,
  task-completion nodes (review-fix commit times) at 6.5, 12.8, 17.7,
  23.9, 30.8, 42.6 min; line ends at the 46.4 min plan-complete report.
- **Waves lane (mixed-B-1, 1015 s; t0 = final merge − 1015 s, which aligns
  exactly):** wave 1 = tasks 1+4, commits ~6.7/6.8, merged 8.7; wave 2 =
  tasks 2+3, commits ~9.7, merged 10.75; wave 3 = task 5, fast-forward at
  11.9; wave 4 = task 6, commit 15.25, merged 16.9. Diamond/bump widths and
  node positions follow these timestamps; purple merge nodes at every
  fan-in.
- Numbered nodes (1 schema, 2 validation, 3 serialization, 4 store,
  5 handlers, 6 router); mapping in the figcaption.
- Running min-counters per lane (mono font); waves counter freezes at
  16.9 with a dashed vertical guide labeled "waves finish — serial is
  still on task 3".
- Existing figcaption updated to state both lanes are exact renderings of
  the two scored runs (run ids included).

### 3. Fixture thumbnails (replace the old `.dag` SVGs)

Static, completed-state miniatures in the same vocabulary (carved lines,
filled nodes, purple merge dots), sized for the `details` summary rows:

- **wide** — one six-lane fan
- **chained** — five sequential solo bumps
- **mixed** — two two-lane diamonds, then two solo bumps
- **degrade** — dashed gray "ghost fan" (the parallel plan the engine
  declined) behind two solid serialized bumps

No animation at thumbnail scale.

### 4. Trade-off explorer (unchanged behavior)

Stays a bar chart; not an orchestration shape. Palette already matches.

## Animation engine

A ~60-line dependency-free engine inline in the post, ported from the
proven pattern in `skills/ultrapowers/viewer/swarm_template.html`, with one
structural requirement: **a deterministic, seekable timeline.**

- Each animated figure registers a timeline: a pure function
  `render(tMs)` built from declarative segments (carve, fill, pulse,
  label-fade) with absolute start/duration times. No wall-clock reads, no
  randomness inside `render`.
- Live playback: `requestAnimationFrame` advances `t` from 0 to the
  timeline duration.
- Capture playback: a capture harness sets `t` directly
  (`window.__seek(figureId, tMs)` exposed when `?capture` is in the query
  string) — frame-exact stepping for GIF export.
- Carve primitive: `dashoffset = L · (1 − p)` plus dot at
  `getPointAtLength(L · p)`; node-fill marks trigger on the dot's x
  position so fills land at honest timestamps.
- Triggers: play once on scroll-into-view (IntersectionObserver, as the
  current post already does), per-figure replay button,
  `prefers-reduced-motion` renders `render(duration)` immediately and
  hides replay buttons (current post convention).
- Race figure uses linear time mapping; anatomy figure may ease segment
  interiors (it is not on a time axis).

## GIF/MP4 export pass

A capture script at `docs/scripts/render_post_media.py` (post tooling lives
with the post; `evals/scripts/` stays eval-only) that:

1. Launches headless Chrome on the post with `?capture`.
2. For each animated figure (anatomy, race): steps the timeline at 30 fps,
   screenshotting the figure's bounding box at 2× device scale.
3. Appends ~2 s of hold frames on the completed state so the loop breathes.
4. Assembles via ffmpeg: a palette-optimized looping GIF **and** an MP4
   (X.com converts GIFs to video on upload; MP4 is smaller and sharper) per
   figure, written to `docs/media/`.

White (paper) background baked into captures; figures must render fully
within their own bounding box (no overflow) so the clip rect is clean.

## What is removed

- The `.race` Gantt block markup, its CSS, and its replay JS.
- The four old `.dag` thumbnail SVGs and the `.dag` CSS.
- Nothing else in the post changes except the figcaptions tied to the new
  figures and any sentence that referenced the old visuals (e.g. "Read the
  time column against the diagrams up top" still works, but verify).

## Accessibility

- Each animated figure keeps an `aria-label` describing the full story.
- `prefers-reduced-motion`: completed state, instantly, no autoplay.
- Numbered nodes are backed by the figcaption mapping (no color-only or
  motion-only information; the guide line and counters carry the race
  outcome in text).

## Non-goals

- No anime.js vendoring (decided against; native seekable engine instead).
- No changes to the trade-off explorer beyond palette consistency checks.
- No CRT/swarm-viewer aesthetics; everything uses the post's warm
  editorial style.
- No new figures beyond the four pieces above (the overnight-queue section
  stays prose).

## Data provenance (for the plan's reference)

- Serial timestamps: `git log` of `/tmp/eval-runs/mixed-A-1`, launch
  22:37:39 from `runs.jsonl` notes; completions = final review-fix commit
  per task.
- Wave timestamps: `git log` of `/tmp/eval-runs/mixed-B-1`; t0 = final
  merge epoch (1781248472) − 1015 s wall clock; all wave boundaries from
  merge/commit epochs. **The plan should snapshot these derived numbers
  into the figure code (or a small JSON comment block) since `/tmp` run
  dirs are ephemeral.**
