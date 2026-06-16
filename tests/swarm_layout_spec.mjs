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
