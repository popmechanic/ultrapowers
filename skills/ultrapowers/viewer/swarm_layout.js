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

  var api = { computeGrid: computeGrid, buildMeso: buildMeso, SINK: SINK };
  root.SwarmLayout = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
