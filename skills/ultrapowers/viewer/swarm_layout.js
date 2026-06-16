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
