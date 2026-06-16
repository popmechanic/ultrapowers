// Fractal-zoom state machine for the swarm viewer. Pure reducer: tracks the
// macro/meso/micro level + focus and yields the breadcrumb trail. No DOM — the
// template (swarm_template.html) wires clicks, the 600ms camera, and d3-zoom to
// it. Keep in sync with render_viewer.py's SWARM_ZOOM_PLACEHOLDER.
(function (root) {
  "use strict";

  function create() {
    var level = "macro", task = null, agentId = null, agentLabel = null;

    function crumbs() {
      var out = [{ label: "run · wave plan", level: "macro" }];
      if (level === "meso" || level === "micro")
        out.push({ label: "T" + task, level: "meso" });
      if (level === "micro")
        out.push({ label: agentLabel || "transcript", level: "micro" });
      return out;
    }
    return {
      level: function () { return level; },
      focus: function () { return { task: task, agentId: agentId }; },
      toMeso: function (taskId) { level = "meso"; task = String(taskId); agentId = null; agentLabel = null; },
      toMicro: function (taskId, aid, label) {
        level = "micro"; task = String(taskId); agentId = aid; agentLabel = label || null;
      },
      out: function () {
        if (level === "micro") { level = "meso"; agentId = null; agentLabel = null; }
        else if (level === "meso") { level = "macro"; task = null; }
        return level;
      },
      reset: function () { level = "macro"; task = null; agentId = null; agentLabel = null; },
      crumbs: crumbs,
    };
  }

  var api = { create: create };
  root.SwarmZoom = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
