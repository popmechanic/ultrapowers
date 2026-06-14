# ULTRAPOWERS swarm viewer

A passive, optional, local visualization of a run: the integration branch as a
phosphor hub, waves as concentric rings, tasks as vector-era stations, agents as
bright points that fan out along prefigured motion paths and come home to merge.
Vectrex-style bloom and afterglow; faint CRT framing; branded `ULTRAPOWERS` in
the corner. It takes no input — it exists so the human has something true to
watch during the autonomous stretch between launch and the pre-merge gate.

## Honesty contract

Two layers, labeled on screen and never mixed:

- **Observed (solid geometry):** station states come from git footprints only —
  a worktree under `.claude/worktrees/wf_*` means *in flight*; a `worktree-wf_*`
  branch with commits ahead means *committed*; the branch tip becoming an
  ancestor of the `ultra/integration-*` branch (or vanishing after the merge
  agent's cleanup while integration advanced) means *merged*. The watcher never
  touches the engine; it reads the repo.
- **Dramatized (orbits & travel):** departure flights, the elliptical reviewer
  orbit, pulse rhythms. Decoration on top of true state, declared in the legend.

The HUD badge states the mode plainly: `OBSERVING` (fresh status.json),
`SIGNAL LOST` (watcher stopped), `DEPICTION` (no telemetry — a deterministic,
seeded playback of the computed wave plan; click to replay).

## Themes

One template, ten skins — palettes plus structural switches (frame, station
glyph, agent wake, bloom). `--theme NAME` picks one, `--all` renders every
theme as `swarm-<name>.html`, `--list-themes` enumerates them.

| Theme | Vibe |
|---|---|
| `asteroids` | gleaming offwhite vectors on black, CRT bezel, phosphor bloom (default) |
| `riso` | two-ink risograph overprint — fluorescent pink + blue on warm paper, grain |
| `bauhaus` | primaries + black on warm white; circle/triangle/square by wave; lowercase |
| `eames` | mid-century playroom — cream, mustard, burnt orange, teal, walnut beads |
| `transit` | the DAG as a subway map: thick route lines, white-disc stations, Helvetica |
| `blueprint` | cyanotype — pale construction lines on deep blue, dashed wave rings |
| `memphis` | Milano 1981 — pastel ground, dot grid, loud shapes, confetti wakes |
| `sumi` | ink on washi, brush-tick stations, one vermillion seal at the hub |
| `gadget` | light hardware panel, dark display ink, safety-orange LED accents |
| `lewitt` | wall-drawing — thin lines in cycled color on gallery white |

## Usage

```sh
# 1. Generate the viewer from the approved plan (any time after Step 3):
python3 skills/ultrapowers/scripts/render_viewer.py docs/plans/plan.md --out /tmp/swarm

# 2. Semi-live: watch the target repo and serve the folder
python3 skills/ultrapowers/scripts/swarm_watch.py --repo <target-repo> --out /tmp/swarm &
(cd /tmp/swarm && python3 -m http.server 8123)
# open http://localhost:8123/swarm.html

# Depiction only (no run, no server): open file:///tmp/swarm/swarm.html
```

## Design notes

- **Paths are prefigured.** The DAG shape is fully known at compile time
  (`compile_plan.py`), so every journey and edge is a precomputed SVG path; the
  animation engine just rides them (`getPointAtLength` + rAF — the same
  technique as anime.js `svg.createMotionPath`, which can be swapped in at the
  `animate()`/`motionSampler()` seam if a vendored copy is added).
- **Vectrex, not raster.** Vector-monitor aesthetics: strong phosphor bloom
  (SVG feGaussianBlur merge), afterglow trails on moving agents, angular
  station glyphs; the raster scanlines are kept to a whisper.
- **Drift-safe by construction.** No engine changes: `waves.js` stays
  frozen; the watcher observes git artifacts that already exist. If the engine's
  naming conventions ever change, the viewer degrades to DEPICTION mode rather
  than breaking a run.
- `prefers-reduced-motion` renders the still wave-plan diagram with live state
  colors — the Step-3 transparency block as a picture.
