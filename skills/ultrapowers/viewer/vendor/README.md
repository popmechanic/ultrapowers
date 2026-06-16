# Vendored d3-dag

The swarm viewer graphs the run with [d3-dag](https://github.com/erikbrinkman/d3-dag)'s
grid layout. To keep `swarm.html` self-contained, offline-capable, and drift-safe, the
library is **vendored as a committed prebuilt bundle** and inlined at render time the same
way `audit_project.js` is — never fetched from a CDN, never installed at runtime.

## Files

- `d3-dag.iife.min.js` — the browser IIFE build. Exposes a global `d3` (with `d3.grid`,
  `d3.graphConnect`, …). This is the file `render_viewer.py` inlines into `swarm.html`.
- `d3-dag.cjs.min.js` — the CommonJS build, `require`d by the node specs in `tests/` so the
  grid adapter is testable without a browser.

## Provenance

- Package: `d3-dag@1.1.0` (Erik Brinkman, ISC license).
- Source: `https://unpkg.com/d3-dag@1.1.0/bundle/d3-dag.iife.min.js` and `…/d3-dag.cjs.min.js`.

## Re-vendoring (one-time, needs network)

```sh
cd skills/ultrapowers/viewer/vendor
curl -sSL -o d3-dag.iife.min.js https://unpkg.com/d3-dag@1.1.0/bundle/d3-dag.iife.min.js
curl -sSL -o d3-dag.cjs.min.js  https://unpkg.com/d3-dag@1.1.0/bundle/d3-dag.cjs.min.js
```

## API used (v1)

```js
const builder = d3.graphConnect();          // edges: [fromId, toId][] (strings)
const graph   = builder(edges);
const layout  = d3.grid();
const { width, height } = layout(graph);    // mutates nodes/links with coords
for (const n of graph.nodes()) { n.data; n.x; n.y; }
for (const l of graph.links()) { l.source.data; l.target.data; l.points; }
```
