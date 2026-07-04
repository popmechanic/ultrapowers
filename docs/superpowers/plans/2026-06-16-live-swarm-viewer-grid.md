# Live Swarm Viewer — Phase 1: d3-dag Grid Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the swarm viewer's radial hub-and-rings layout with a legible, top→down **d3-dag grid**, in the phosphor skin, preserving every existing behavior (live status polling, the transcript drawer, DEPICTION playback, and the HUD badges).

**Architecture:** The compiled DAG (`tasks` + `edges` + `waves`, already baked by `render_viewer.py`) is laid out **once** by d3-dag's grid operator into node `x/y` and routed edge paths; a synthetic `__INT__` sink collects the terminal tasks at the floor. The layout math lives in a new dependency-free `viewer/swarm_layout.js` (node-testable, `module.exports`), called from the template with the vendored d3-dag global. Positions are static (the DAG is frozen at compile time); live data only recolors stations.

**Tech stack:** Python 3 (`render_viewer.py`), vanilla browser JS + inline SVG (`swarm_template.html`), vendored `d3-dag@1.1.0` (committed IIFE bundle, global `d3`), node + pytest tests.

**Phase scope:** This is Phase 1 of three. It swaps the layout and skin inside the **existing single pane**. The split sidebar + ASCII wave readout (Phase 2, with the live feed) and the macro→meso→micro fractal zoom (Phase 3) are **out of scope here** and get their own plans. Do not add a sidebar, `agents.json`, or zoom in this plan.

---

## Global Constraints

These bind every task; reviewers gate the work against them.

- **Self-contained, offline, drift-safe.** `swarm.html` stays a single self-contained file. d3-dag is the **already-committed vendored bundle** at `skills/ultrapowers/viewer/vendor/d3-dag.iife.min.js` (global `d3`), inlined like `audit_project.js`. Never fetch from a CDN; never add a runtime package manager or build step.
- **No engine changes.** The viewer observes git/transcript artifacts only. Do not touch `waves.js`, `compile_plan.py` output shape, or anything under the engine. `build_dag`'s JSON contract (`title`, `mode`, `waves`, `edges`, `tasks`) is fixed.
- **Boot under node.** The inlined `<script>` in a rendered `swarm.html` must still BOOT under the DOM stub in `tests/test_viewer.py` (not merely `node --check`).
- **Preserve provenance modes.** Keep `file://` DEPICTION (seeded playback) and the `OBSERVING / SIGNAL LOST / DEPICTION` HUD badge semantics. Keep the transcript drawer working exactly as today.
- **Phosphor is the default skin.** Keep the `--theme` palette mechanism (CSS custom properties) so `--theme` still recolors; drop only the radial-specific *structural* switches (glyph, trail, bloom, rings, edge-color-mode, label-case) that the grid replaces.
- **Positions are prefigured.** Compute grid coordinates once at construction from the baked DAG. Live `status.json` data changes a station's state/color only — never its position.
- **DAG-faithful.** Node positions come from running d3-dag grid over the real `edges`; do not hand-place nodes.

**Acceptance:** suite — this is ultrapowers' own viewer tooling. Author and operator both read the diffs; the committed node specs, the pytest viewer/render tests, and the node boot test are the verification (`acceptance.passed === tests.passed`). No held-out sealed exam.

---

### Task 1: Grid layout adapter — `viewer/swarm_layout.js`

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/viewer/swarm_layout.js`
- Create: `tests/swarm_layout_spec.mjs`
- Create: `tests/test_swarm_layout.py`

**Interfaces:**
- Consumes: the vendored d3-dag CJS build `skills/ultrapowers/viewer/vendor/d3-dag.cjs.min.js` (for the node spec) and the d3-dag browser global `d3` (at viewer runtime), specifically `d3.graphConnect()` and `d3.grid()`.
- Produces: a global/`module.exports` object `SwarmLayout` with:
  - `SwarmLayout.computeGrid(dag, d3) -> { nodes: {id, x, y}[], edges: {from, to, points: [number,number][]}[], width, height, sinkId }` where `dag = { tasks:[{id,...}], edges:[[from,to],...], waves:[[id,...]] }`, `d3` is the d3-dag namespace (needs `.graphConnect` and `.grid`), coordinates are scaled into a `0..width / 0..height` box with a fixed margin, every task plus a synthetic sink node `__INT__` (id from `sinkId`) is present, and terminal tasks (no outgoing task→task edge) are linked to the sink.

- [ ] **Step 1: Write the failing node spec**

Create `tests/swarm_layout_spec.mjs`:

```js
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const d3 = require("../skills/ultrapowers/viewer/vendor/d3-dag.cjs.min.js");
const L = require("../skills/ultrapowers/viewer/swarm_layout.js");

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error("FAIL", m); } };

// fixture: 7 tasks, 3 waves, real edges (from runs-before to)
const dag = {
  tasks: [1,2,3,4,5,6,7].map(id => ({ id })),
  edges: [[1,4],[2,4],[2,5],[3,5],[4,6],[5,6],[4,7]],
  waves: [[1,2,3],[4,5],[6,7]],
};

const g = L.computeGrid(dag, d3);

// every task plus the synthetic sink is positioned
const ids = new Set(g.nodes.map(n => String(n.id)));
ok([1,2,3,4,5,6,7].every(i => ids.has(String(i))), "all 7 tasks positioned");
ok(ids.has(g.sinkId), "sink node positioned");
ok(g.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)), "finite coords");
ok(g.width > 0 && g.height > 0, "positive bounds");

// top->down: wave-0 roots sit above the sink
const y = id => g.nodes.find(n => String(n.id) === String(id)).y;
ok(y(1) < y(g.sinkId) && y(2) < y(g.sinkId) && y(3) < y(g.sinkId), "roots above sink");
ok(y(6) > y(4) && y(6) > y(5), "wave-2 below its predecessors");

// terminal tasks (6 and 7 — nothing depends on them) link to the sink
const toSink = g.edges.filter(e => String(e.to) === g.sinkId).map(e => String(e.from)).sort();
ok(toSink.includes("6") && toSink.includes("7"), "terminals 6,7 -> sink");
// real dependency edges are preserved with routed points
const e46 = g.edges.find(e => String(e.from) === "4" && String(e.to) === "6");
ok(e46 && Array.isArray(e46.points) && e46.points.length >= 2, "edge 4->6 has points");

// isolated task (no edges) still appears and links to the sink
const dag2 = { tasks:[{id:1},{id:2}], edges:[[1,2]], waves:[[1],[2]] };
const g2 = L.computeGrid(dag2, d3);
ok(new Set(g2.nodes.map(n=>String(n.id))).has("1"), "task 1 present");

console.log(failed === 0 ? "ALL TESTS PASSED" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

Create the pytest wrapper `tests/test_swarm_layout.py` (mirrors `tests/test_audit_project.py`):

```python
"""Run the JS grid-layout spec (tests/swarm_layout_spec.mjs).

Layout math lives once, in viewer/swarm_layout.js; this is its guard.
Requires node; skips without it."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = ROOT / "tests/swarm_layout_spec.mjs"


def test_swarm_layout_js():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    p = subprocess.run([node, str(SPEC)], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "ALL TESTS PASSED" in p.stdout, p.stdout + p.stderr
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/swarm_layout_spec.mjs`
Expected: FAIL — `Cannot find module '../skills/ultrapowers/viewer/swarm_layout.js'`.

- [ ] **Step 3: Implement `swarm_layout.js`**

Create `skills/ultrapowers/viewer/swarm_layout.js`. Classic script (no import/export) so `render_viewer.py` can inline it into `swarm.html`'s `<script>`; also sets `module.exports` for node, mirroring `audit_project.js`:

```js
// Grid layout adapter for the swarm viewer. Dependency-free: receives the d3-dag
// namespace (graphConnect + grid) so the same code runs in the browser (global d3)
// and under node (the vendored CJS build). Keep in sync with render_viewer.py's
// D3DAG_PLACEHOLDER / SWARM_LAYOUT_PLACEHOLDER.
(function (root) {
  "use strict";

  var SINK = "__INT__";
  var MARGIN = 60;      // px padding inside the viewBox
  var SPREAD = 110;     // px between grid lanes/ranks

  // dag: { tasks:[{id}], edges:[[from,to]], waves:[[id]] }
  // d3:  the d3-dag namespace (needs graphConnect + grid)
  function computeGrid(dag, d3) {
    var taskIds = dag.tasks.map(function (t) { return String(t.id); });
    var taskSet = {};
    taskIds.forEach(function (id) { taskSet[id] = true; });

    // real dependency edges (from runs before to), string-keyed
    var edges = (dag.edges || [])
      .map(function (e) { return [String(e[0]), String(e[1])]; })
      .filter(function (e) { return taskSet[e[0]] && taskSet[e[1]]; });

    // terminal tasks = no outgoing task->task edge; link each to the sink so every
    // task is reachable (isolated tasks included) and the graph converges visually.
    var hasOut = {};
    edges.forEach(function (e) { hasOut[e[0]] = true; });
    var sinkEdges = taskIds
      .filter(function (id) { return !hasOut[id]; })
      .map(function (id) { return [id, SINK]; });

    var allEdges = edges.concat(sinkEdges);

    var graph = d3.graphConnect()(allEdges);
    var layout = d3.grid();
    layout(graph);

    // collect raw coords, then scale into a 0..W / 0..H box with margins
    var raw = [];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    graph.nodes().forEach(function (n) {
      raw.push({ id: n.data, x: n.x, y: n.y });
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    });
    var sx = function (x) { return MARGIN + (x - minX) * SPREAD; };
    var sy = function (y) { return MARGIN + (y - minY) * SPREAD; };
    var width = MARGIN * 2 + (maxX - minX) * SPREAD;
    var height = MARGIN * 2 + (maxY - minY) * SPREAD;

    var nodes = raw.map(function (n) { return { id: n.id, x: sx(n.x), y: sy(n.y) }; });
    var outEdges = [];
    graph.links().forEach(function (l) {
      outEdges.push({
        from: l.source.data, to: l.target.data,
        points: l.points.map(function (p) { return [sx(p[0]), sy(p[1])]; }),
      });
    });

    return { nodes: nodes, edges: outEdges, width: width, height: height, sinkId: SINK };
  }

  var api = { computeGrid: computeGrid, SINK: SINK };
  root.SwarmLayout = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `node tests/swarm_layout_spec.mjs`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 5: Run the pytest wrapper**

Run: `python3 -m pytest tests/test_swarm_layout.py -q`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/viewer/swarm_layout.js tests/swarm_layout_spec.mjs tests/test_swarm_layout.py
git commit -m "feat(viewer): d3-dag grid layout adapter (swarm_layout.js) + node spec"
```

---

### Task 2: Inline d3-dag + the layout adapter; collapse themes to palettes — `render_viewer.py`

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/scripts/render_viewer.py`
- Modify: `skills/ultrapowers/viewer/swarm_template.html`
- Modify: `tests/test_viewer.py`

Files-note — `skills/ultrapowers/viewer/swarm_template.html` (add two placeholders only — full template surgery is Task 3)

**Interfaces:**
- Consumes: `skills/ultrapowers/viewer/swarm_layout.js` (from Task 1), the committed `skills/ultrapowers/viewer/vendor/d3-dag.iife.min.js`.
- Produces: rendered `swarm.html` containing the inlined d3-dag IIFE (global `d3`) and the inlined `SwarmLayout`; a simplified `THEMES` table whose entries carry only palette data (`name`, `frame`, `waveColors`, `vars`); the new placeholders `/*__D3DAG_JS__*/` and `/*__SWARM_LAYOUT_JS__*/`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_viewer.py`:

```python
def test_render_inlines_d3dag_and_layout(tmp_path):
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    assert "/*__D3DAG_JS__*/" not in html, "d3-dag placeholder not replaced"
    assert "/*__SWARM_LAYOUT_JS__*/" not in html, "layout placeholder not replaced"
    assert "d3-dag Version 1.1.0" in html, "vendored d3-dag not inlined"
    assert "globalThis.SwarmLayout" in html or "root.SwarmLayout" in html, "layout adapter not inlined"
```

Also update the existing theme-count assertion in `test_render_viewer_all_themes`: the
viewer now ships palette-only themes. Change `assert len(themes) == 10` to match the
post-collapse set (keep all ten palette names, so this stays `== 10`; if you drop any
palette, update the number to the real count).

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_viewer.py::test_render_inlines_d3dag_and_layout -q`
Expected: FAIL — placeholders absent / not inlined.

- [ ] **Step 3: Add the two placeholders to the template**

In `skills/ultrapowers/viewer/swarm_template.html`, immediately after the existing
`/*__AUDIT_JS__*/` placeholder line (currently near the top of the main `<script>`), add:

```js
/*__D3DAG_JS__*/
/*__SWARM_LAYOUT_JS__*/
```

(Task 3 consumes the resulting `d3` and `SwarmLayout` globals.)

- [ ] **Step 4: Inline both in `render_viewer.py`**

Add the constants near the other placeholders (after `AUDIT_JS = …`):

```python
D3DAG_PLACEHOLDER = "/*__D3DAG_JS__*/"
SWARM_LAYOUT_PLACEHOLDER = "/*__SWARM_LAYOUT_JS__*/"
D3DAG_JS = HERE.parent / "viewer" / "vendor" / "d3-dag.iife.min.js"
SWARM_LAYOUT_JS = HERE.parent / "viewer" / "swarm_layout.js"
```

In `render(...)`, alongside the `AUDIT_JS_PLACEHOLDER` replacement, add (these libraries are
mandatory, like the projection library — the template references `d3`/`SwarmLayout` at load):

```python
for ph in (D3DAG_PLACEHOLDER, SWARM_LAYOUT_PLACEHOLDER):
    if ph not in html:
        raise SystemExit(f"template placeholder {ph} missing — swarm_template.html was edited?")
html = html.replace(D3DAG_PLACEHOLDER, D3DAG_JS.read_text())
html = html.replace(SWARM_LAYOUT_PLACEHOLDER, SWARM_LAYOUT_JS.read_text())
```

- [ ] **Step 5: Collapse `theme()` and `THEMES` to palette-only**

The grid replaces the radial structural switches, so `theme()` no longer needs `glyph`,
`trail`, `bloom`, `rings`, `edge_color`, or `labelcase`. Replace the `theme()` helper with:

```python
def theme(name, frame, wave_colors, **vars_):
    return {"name": name, "frame": frame, "waveColors": wave_colors, "vars": vars_}
```

Rewrite each of the ten `THEMES` entries to the new signature, dropping the removed
positional args and keeping `name`, `frame`, `waveColors`, and the `vars`. Keep all ten
palette names (`asteroids` stays the phosphor default). Example for the default:

```python
    "asteroids": theme(
        "asteroids", "crt", ["#f5f6f0"],
        bg="#07080a", ink="#f5f6f0", bright="#ffffff", dim="#6a6d66",
        faint="#2b2d2b", accent="#ffb347", hud="#8a8d85", agent="#ffffff",
        font=MONO, flick="#eef7f0",
        **{"screen-bg": "radial-gradient(ellipse at 50% 48%,#101113 0%,#07080a 62%,#020203 100%)",
           "scan-o": ".16", "vig-o": "1", "glass-o": "1"}),
```

Apply the same drop-the-structural-args transform to the other nine entries (`riso`,
`bauhaus`, `eames`, `transit`, `blueprint`, `memphis`, `sumi`, `gadget`, `lewitt`),
preserving each entry's `frame`, `waveColors`, and `vars` exactly as they are today.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_viewer.py -q`
Expected: all pass (new inline test + the theme-count test + existing DAG/parse/boot tests). The boot/parse tests still pass because Task 3 has not yet changed the template body — the inlined d3-dag IIFE loads cleanly under node (`var d3 = Object.assign(d3 || {}, …)`).

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/scripts/render_viewer.py skills/ultrapowers/viewer/swarm_template.html tests/test_viewer.py
git commit -m "feat(viewer): inline vendored d3-dag + layout adapter; palette-only themes"
```

---

### Task 3: Render the grid in the template — `swarm_template.html`

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Modify: `skills/ultrapowers/viewer/swarm_template.html`
- Modify: `tests/test_viewer.py`

Files-note — `tests/test_viewer.py` (extend the DOM stub + add a grid-render assertion)

**Interfaces:**
- Consumes: `SwarmLayout.computeGrid(dag, d3)` and `SwarmLayout.SINK` (Task 1, inlined by Task 2); the d3-dag global `d3` (`d3.graphConnect`, `d3.grid`, inlined by Task 2); the unchanged baked `DAG` (`tasks`, `edges`, `waves`, `title`) and `THEME` (now `name`/`frame`/`waveColors`/`vars`).
- Produces: a grid-rendered `swarm.html` — one station per task plus the `INTEGRATION` sink, routed edges, phosphor station-state grammar — preserving the status poller, transcript drawer, DEPICTION playback, and HUD badges.

This task replaces the radial *scene construction and choreography* only. The observer
(`poll`/`gotStatus`/`matchTask`/`updateHud`), the drawer (`openDrawer`/`loadAgent`/
`fetchAndRender`/`renderEvents` and helpers), the DEPICTION schedule, the HUD badge logic,
and the theme-application/`el()` helpers are **carried over** — adapted only where they
reference radial specifics (`stations[id].angle/r/journey`, orbits, `dispatch`/`returnHome`).

- [ ] **Step 1: Add a grid-render boot assertion (failing test)**

Extend the DOM stub in `tests/test_viewer.py` so grid construction can run under node.
Add these to the `elStub()` return object and globals (the new code reads `viewBox`,
queries node geometry, and sets transforms):

```python
# add inside elStub(): a no-op getBBox + querySelector returning a stub
#   getBBox() { return { x:0, y:0, width:0, height:0 }; },
#   querySelector() { return elStub(); },
#   querySelectorAll() { return []; },
# (append to DOM_STUB elStub literal)
```

Add a new test that asserts the grid path runs (not the radial one):

```python
def test_viewer_uses_grid_layout(tmp_path):
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    assert "SwarmLayout.computeGrid" in html, "template must lay out via the grid adapter"
    assert "INTEGRATION" in html  # the sink label retained
    # radial scene primitives are gone
    assert "concentric" not in html.lower()
```

Run: `python3 -m pytest tests/test_viewer.py::test_viewer_uses_grid_layout -q`
Expected: FAIL — `SwarmLayout.computeGrid` not yet referenced by the template.

- [ ] **Step 2: Replace the `<body>` scene markup**

In `swarm_template.html`, the `<svg id="stage">` scene currently holds radial groups
(`rings`, `journeys`, `trails`, `hub`, …). Replace the inner `<g id="scene">` group set with
the grid groups (keep the `<defs>` bloom filters and the surrounding `.screen`/overlays/HUD/
drawer/brand markup unchanged):

```html
    <g id="scene">
      <g id="edges"></g>
      <g id="stations"></g>
      <g id="sink"></g>
    </g>
```

- [ ] **Step 3: Replace the station-state CSS with grid glyphs**

Replace the radial station grammar block (the CSS from `.stationG{…}` through `.ring{…}`,
currently ~lines 74-93) with a grid station grammar. Stations are a circle (`.node`) + a
label; state changes color/opacity, never position:

```css
  .stationG{color:var(--ink)}
  .node{fill:var(--bg);stroke:currentColor;stroke-width:1.6;opacity:.32;transition:opacity .5s,fill .5s}
  .core{fill:none;opacity:0;transition:opacity .5s}
  [data-state=working] .node{opacity:1}
  [data-state=working] .core{fill:var(--accent);opacity:1}
  [data-state=committed] .node{opacity:1}
  [data-state=committed] .core{fill:currentColor;opacity:1}
  [data-state=merged] .node{opacity:.7}
  [data-state=merged] .core{fill:var(--accent);opacity:.9}
  [data-state=stalled] .node{stroke:var(--accent);opacity:1;animation:lostblink 1.1s steps(2) infinite}
  .stlabel{fill:currentColor;opacity:.55;font-family:var(--font);font-size:11px;
           letter-spacing:.12em;text-anchor:middle;transition:opacity .5s}
  [data-state=working] .stlabel,[data-state=committed] .stlabel{opacity:1}
  .edge{fill:none;stroke:var(--dim);opacity:.34;stroke-width:var(--edge-w);transition:opacity .5s}
  .edge.live{opacity:.95;stroke-width:var(--edge-w-live)}
  .stationG.clickable{cursor:pointer}
```

- [ ] **Step 4: Replace the radial layout + scene construction with the grid**

In the main `<script>`, delete the radial layout block (the `polar`/`ringR`/`angleOf`
angle-packing math, ~lines 322-355) and the radial scene construction (`journeyPath`,
`edgePathD`, the `GLYPHS` table, the per-station `stations[...] = {angle,r,journey,…}`
construction, the hub arc/pulse, and `setAmbient`/ambient orbiters, ~lines 357-511).
Replace them with grid construction:

```js
// ─── grid layout: positions are prefigured from the compiled DAG ────────────
const gEdges = document.getElementById('edges');
const gStations = document.getElementById('stations');
const gSink = document.getElementById('sink');

const grid = SwarmLayout.computeGrid(DAG, d3);
document.getElementById('stage').setAttribute('viewBox', `0 0 ${grid.width} ${grid.height}`);
const posById = {};
grid.nodes.forEach(n => { posById[String(n.id)] = n; });
const taskWave = {};
DAG.waves.forEach((wave, wi) => wave.forEach(id => { taskWave[String(id)] = wi; }));
const waveColor = w => THEME.waveColors[w % THEME.waveColors.length];

// edges (routed polylines from the grid)
grid.edges.forEach(e => {
  const d = 'M ' + e.points.map(p => p[0] + ' ' + p[1]).join(' L ');
  el('path', { class: 'edge', d, 'data-from': e.from, 'data-to': e.to }, gEdges);
});

// stations: one per task, placed at the grid coordinate
const stations = {};
DAG.tasks.forEach(t => {
  const id = String(t.id), p = posById[id];
  if (!p) return;
  const wi = taskWave[id] || 0;
  const g = el('g', { class: 'stationG', 'data-state': 'pending',
    transform: `translate(${p.x} ${p.y})`, style: `color:${waveColor(wi)}` }, gStations);
  el('circle', { class: 'node', r: 11 }, g);
  el('circle', { class: 'core', r: 4.5 }, g);
  const label = el('text', { class: 'stlabel', y: 26 }, g);
  label.textContent = 'T' + t.id;
  stations[id] = { id, x: p.x, y: p.y, el: g, state: 'pending' };
  if (audit && audit.byTask[t.id]) {
    g.classList.add('clickable');
    g.addEventListener('click', function () { openDrawer(audit.byTask[t.id], 'Task ' + t.id); });
  }
});

// the integration sink
const sink = posById[grid.sinkId];
if (sink) {
  const g = el('g', { class: 'stationG', transform: `translate(${sink.x} ${sink.y})`,
    style: 'color:var(--ink)' }, gSink);
  el('circle', { class: 'node', r: 14, style: 'opacity:.8' }, g);
  el('circle', { cx: 0, cy: 0, r: 5, fill: 'var(--hub-core)' }, g);
  const label = el('text', { class: 'stlabel', y: 30 }, g);
  label.textContent = 'INTEGRATION';
  if (audit && audit.runLevel.length) {
    g.classList.add('clickable');
    g.addEventListener('click', function () { openDrawer(audit.runLevel, 'run-level'); });
  }
}
```

- [ ] **Step 5: Simplify `setState` and the frame loop (retire fictional orbits)**

Replace the radial `setState` choreography (`dispatch`/`startReviewerOrbit`/`returnHome`/
`pulseHub`/`energizeEdges`, ~lines 514-568) with a state machine that recolors stations and
lights satisfied edges — real-event-driven, no flights or orbits:

```js
const RANK = { pending: 0, working: 1, committed: 2, merged: 3, stalled: 9 };
function setState(id, s) {
  const st = stations[String(id)];
  if (!st || st.state === s) return;
  if (s !== 'stalled' && RANK[s] < RANK[st.state]) return; // never downgrade
  st.state = s;
  st.el.dataset.state = s;
  if (s === 'committed' || s === 'merged') energizeEdges(String(id));
  updateHud();
}
function energizeEdges(fromId) {
  document.querySelectorAll('#edges .edge[data-from="' + fromId + '"]')
    .forEach(p => p.classList.add('live'));
}
```

In the `frame(ts)` rAF loop (~lines 668-700), delete the radial per-frame work (`hubArc`
rotation, `ambient.forEach` orbiters, the per-station `scale` pulse using `st.angle`, the
reviewer-orbit math). Keep the loop driving the DEPICTION schedule, `stepTweens()` (if any
tweens remain — none are required now; you may drop `tweens`/`animate`/`stepTweens` if
unused), and the periodic `updateHud()`. A station's "alive" feel now comes from the CSS
`[data-state=working]` styling, not motion. Keep `prefers-reduced-motion` honored (no rAF
when reduced — already handled at the bottom of the file).

- [ ] **Step 6: Carry over the observer, drawer, DEPICTION, and badges (adapt references)**

Keep these blocks, editing only the radial references noted:

- **`buildSchedule()` / DEPICTION** (~lines 570-596): keep. It only calls `setState(id, …)`
  on a timer — no radial coupling. Keep the screen-click replay handler, but drop its
  references to `stopReviewerOrbit` and `journey` resets (just reset each station's
  `state`/`dataset.state` to `pending` and remove `.live` from edges).
- **observer** `poll()`/`gotStatus()`/`matchTask()`/`updateHud()` (~lines 598-665): keep
  verbatim. They call `setState` and read `taskWave`/`stations`, all preserved. Remove the
  `setAmbient(...)` call inside `gotStatus` (ambient orbiters are gone).
- **drawer** functions and the `audit` wiring (~lines 188-260): keep verbatim.
- **theme application + `el()`** (~lines 268-300): keep. Keep `hashStr`/`mulberry32`/`rand`
  (DEPICTION still seeds its schedule from `rand`).

- [ ] **Step 7: Run the boot + render tests**

Run: `python3 -m pytest tests/test_viewer.py -q`
Expected: all pass — including `test_viewer_uses_grid_layout`, the boot-under-stub test, and
the JS-parse test. If boot fails on a missing DOM method, add the no-op to `DOM_STUB` and
re-run (do not weaken the test's intent).

- [ ] **Step 8: Render a viewer and eyeball it**

Run: `python3 skills/ultrapowers/scripts/render_viewer.py tests/fixtures/marked-plan.md --out /tmp/swarmgrid && echo "open file:///tmp/swarmgrid/swarm.html"`
Expected: a top→down grid of labelled stations flowing into INTEGRATION, phosphor skin, DEPICTION playback animating states. No console errors.

- [ ] **Step 9: Commit**

```bash
git add skills/ultrapowers/viewer/swarm_template.html tests/test_viewer.py
git commit -m "feat(viewer): render the DAG as a d3-dag grid; retire radial orbits"
```

---

### Task 4: Full suite gate

**Type:** gate
**Depends-on:** 1, 2, 3

**Files:**
- None (verification only).

Run the viewer-relevant suites and confirm green:

- `python3 -m pytest tests/test_viewer.py tests/test_swarm_layout.py tests/test_audit_project.py -q`
- `node tests/swarm_layout_spec.mjs` → `ALL TESTS PASSED`
- `node tests/audit_project_spec.mjs` → `ALL TESTS PASSED`
- `python3 -m pytest tests/ -q` (full suite; nothing else regressed)

Expected: all green. This gate writes nothing; its command set informs `testCmd`.

---

## Self-review (spec coverage)

- **d3-dag grid, vertical top→down, INTEGRATION sink** → Tasks 1 (adapter) + 3 (render).
- **Vendored, inlined, self-contained / offline** → vendored bundle (already committed) + Task 2 inline.
- **Phosphor default; palette dict kept as data; radial structural switches dropped** → Task 2.
- **Positions computed once; live data only recolors** → Task 3 (`computeGrid` at construction; `setState` recolors).
- **Preserve status polling, drawer, DEPICTION, badges; retire fictional orbits** → Task 3 Steps 5-6.
- **Boots under node DOM stub; tests updated** → Tasks 2-3 test steps.
- **Out of scope (Phase 2/3):** split sidebar, ASCII wave readout, `agents.json`, live feed, fractal zoom — intentionally absent; called out in the header.
