# Vendored browser libraries

The swarm viewer graphs the run with [d3-dag](https://github.com/erikbrinkman/d3-dag)'s
grid layout (the macro/meso graph) and uses [d3-zoom](https://github.com/d3/d3-zoom) for the
optional scroll/pinch camera. To keep `swarm.html` self-contained, offline-capable, and
drift-safe, both libraries are **vendored as committed prebuilt bundles** and inlined at
render time the same way `audit_project.js` is — never fetched from a CDN, never installed at
runtime.

## Files

- `d3-dag.iife.min.js` — d3-dag browser IIFE build. Exposes a global `d3` (with `d3.grid`,
  `d3.graphConnect`, …). Inlined by `render_viewer.py` into `swarm.html`.
- `d3-dag.cjs.min.js` — d3-dag CommonJS build, `require`d by the node specs in `tests/` so the
  grid adapter is testable without a browser.
- `d3-zoom.iife.min.js` — **self-contained** d3-zoom IIFE bundle (includes d3-zoom and the
  pieces of d3-selection it needs — `select`, `selectAll`, `pointer` — plus their transitive
  deps). Merges onto the same global `d3` (`d3.zoom`, `d3.zoomIdentity`, `d3.zoomTransform`,
  `d3.select`). Inlined by `render_viewer.py` AFTER d3-dag. Pure IIFE — **no `require`/UMD
  branch**, so the inlined `swarm.html` still BOOTS under the `tests/test_viewer.py` node DOM
  stub (the slim `dist/d3-zoom.min.js` from npm would `require("d3-selection")` and break it).
- `d3-zoom.cjs.min.js` — the CommonJS build of the same entry, for parity with d3-dag.

## Provenance

- `d3-dag@1.1.0` (Erik Brinkman, ISC license). Source:
  `https://unpkg.com/d3-dag@1.1.0/bundle/d3-dag.iife.min.js` and `…/d3-dag.cjs.min.js`.
- `d3-zoom@3.0.0` (Mike Bostock, ISC license), bundled with `d3-selection@3` and the
  transitive d3 runtime (d3-drag, d3-transition, d3-interpolate, d3-dispatch, d3-timer,
  d3-ease, d3-color). Built once with esbuild (see below).

## Re-vendoring d3-dag (one-time, needs network)

```sh
cd skills/ultrapowers/viewer/vendor
curl -sSL -o d3-dag.iife.min.js https://unpkg.com/d3-dag@1.1.0/bundle/d3-dag.iife.min.js
curl -sSL -o d3-dag.cjs.min.js  https://unpkg.com/d3-dag@1.1.0/bundle/d3-dag.cjs.min.js
```

## Re-vendoring d3-zoom (one-time, needs network + esbuild)

The slim npm `dist/d3-zoom.min.js` externalizes its dependencies (`require("d3-selection")`,
…) and ships a UMD CJS branch, so it is neither self-contained nor node-boot-safe. We build a
self-contained pure-IIFE bundle with esbuild instead:

```sh
tmp=$(mktemp -d) && cd "$tmp"
npm init -y >/dev/null
npm install d3-zoom@3 d3-selection@3 >/dev/null
cat > entry.js <<'EOF'
import * as zoom from "d3-zoom";
import { select, selectAll, pointer } from "d3-selection";
const d3 = (globalThis.d3 = globalThis.d3 || {});
Object.assign(d3, zoom, { select, selectAll, pointer });
EOF
npx esbuild entry.js --bundle --minify --format=iife --legal-comments=none \
  --outfile=d3-zoom.iife.min.js
npx esbuild entry.js --bundle --minify --format=cjs --legal-comments=none \
  --outfile=d3-zoom.cjs.min.js
# copy both into skills/ultrapowers/viewer/vendor/ at the repo root
```

The entry MERGES onto the global `d3` (`Object.assign(globalThis.d3 || {}, …)`), so loading
d3-dag first and d3-zoom second leaves one `d3` carrying both libraries' APIs.

## API used (v1 / v3)

```js
// d3-dag (macro/meso layout)
const graph  = d3.graphConnect()(edges);    // edges: [fromId, toId][] (strings)
const layout = d3.grid(); layout(graph);
for (const n of graph.nodes()) { n.data; n.x; n.y; }
for (const l of graph.links()) { l.source.data; l.target.data; l.points; }

// d3-zoom (optional scroll/pinch — same transform model as click-to-zoom)
const z = d3.zoom().scaleExtent([1, 8]).on("zoom", e => applyTransform(e.transform));
d3.select(svgEl).call(z);                    // wheel + pinch + drag-pan
d3.select(svgEl).call(z.transform, d3.zoomIdentity);  // programmatic reset / fit
```
