// Transcript projection — the SINGLE projection implementation.
// Classic script (no import/export) so render_viewer.py inlines it into
// swarm.html's <script>; also sets module.exports so node tests can require it.
// Dependency-free. Keep CAPS in sync with AUDIT_CAPS in render_viewer.py.
(function () {
  "use strict";
  var CAPS = { text: 8192, toolInput: 4096, toolResult: 8192, collapsed: 200 };

  function cap(s, n) {
    s = (s == null) ? "" : String(s);
    return s.length > n ? { text: s.slice(0, n), truncated: s.length - n } : { text: s, truncated: 0 };
  }

  function resultText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map(function (b) { return (b && b.text) ? b.text : ""; }).join(" ");
    }
    return content == null ? "" : String(content);
  }

  // Line-level defensive parse: raw JSONL text -> {entries, versions, unparsed}.
  function parseLines(text, caps) {
    caps = caps || CAPS;
    var entries = [], versions = {}, unparsed = 0;
    var lines = String(text).split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var d;
      try { d = JSON.parse(lines[i]); } catch (e) { unparsed++; continue; }
      if (d && d.version) versions[d.version] = true;
      if (!d || (d.type !== "assistant" && d.type !== "user")) continue;
      var content = d.message && d.message.content;
      var blocks = [];
      if (Array.isArray(content)) {
        for (var j = 0; j < content.length; j++) blocks.push(content[j]);
      } else if (typeof content === "string") {
        blocks.push({ type: "text", text: content });
      }
      entries.push({ type: d.type, content: blocks });
    }
    return { entries: entries, versions: Object.keys(versions), unparsed: unparsed };
  }

  // Block-level projection: entries -> rendered events.
  function projectAgent(entries, caps) {
    caps = caps || CAPS;
    var events = [];
    for (var i = 0; i < entries.length; i++) {
      var type = entries[i].type, blocks = entries[i].content || [];
      for (var j = 0; j < blocks.length; j++) {
        var b = blocks[j] || {};
        if (type === "assistant" && b.type === "text") {
          var c = cap(b.text, caps.text);
          events.push({ kind: "text", text: c.text, truncated: c.truncated });
        } else if (type === "assistant" && b.type === "tool_use") {
          var raw = (typeof b.input === "string")
            ? b.input
            : JSON.stringify(b.input == null ? {} : b.input);
          var inp = cap(raw, caps.toolInput);
          events.push({ kind: "tool_use", name: b.name || "?", input: inp.text, truncated: inp.truncated });
        } else if (type === "user" && b.type === "tool_result") {
          var rr = cap(resultText(b.content), caps.toolResult);
          events.push({ kind: "tool_result", result: rr.text, truncated: rr.truncated });
        } else if (type === "user" && b.type === "text") {
          var t = cap(b.text, caps.text);
          events.push({ kind: "text", text: t.text, truncated: t.truncated });
        } else {
          events.push({ kind: "unknown", blockType: (b.type || type || "?") });
        }
      }
    }
    return { events: events };
  }

  function oneline(s, n) {
    s = (s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
  function summaryLine(ev) {
    if (ev.kind === "text") return "● " + oneline(ev.text, CAPS.collapsed);
    if (ev.kind === "tool_use") return "⚙ " + ev.name + "(" + oneline(ev.input, CAPS.collapsed) + ")";
    if (ev.kind === "tool_result") return "→ " + oneline(ev.result, CAPS.collapsed);
    return "‹unrecognized block: " + ev.blockType + "›";
  }

  // ── DOM-agnostic rendering ──────────────────────────────────────────────
  // These build the drawer's event list. They take a `doc` (anything with
  // createElement) and element handles, so they run in a browser AND under a
  // tiny test stub — no jsdom. The swarm template's mkEl/renderEvents are thin
  // wrappers over makeEl/renderInto.
  function makeEl(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderInto(doc, bodyEl, footEl, events, versions, unparsed) {
    bodyEl.innerHTML = "";
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var row = makeEl(doc, "div", "ev ev-" + ev.kind);
      var head = makeEl(doc, "div", "ev-head", summaryLine(ev));
      row.appendChild(head);
      var full = ev.kind === "text" ? ev.text
        : ev.kind === "tool_use" ? ev.input
        : ev.kind === "tool_result" ? ev.result : "";
      if (full && full.length > CAPS.collapsed) {
        var more = ev.truncated ? "\n… (+" + ev.truncated + " more chars — see raw file)" : "";
        var pre = makeEl(doc, "pre", "ev-full", full + more);
        pre.hidden = true;
        head.style.cursor = "pointer";
        // capture `pre` per iteration (var is function-scoped)
        head.onclick = (function (preEl) { return function () { preEl.hidden = !preEl.hidden; }; })(pre);
        row.appendChild(pre);
      }
      bodyEl.appendChild(row);
    }
    if (footEl) {
      footEl.textContent = "format " + ((versions && versions.join(", ")) || "?") +
        (unparsed ? " · " + unparsed + " unparsed lines" : "");
    }
  }

  // Partition the run index into per-task stations and run-level (hub) agents.
  // Rule: a resolved task id wins (even if the role was misdetected); anything
  // without one lands on the hub — no agent is ever unreachable. Returns null
  // when no index was baked (drawer disabled), matching the template's guard.
  function partitionAgents(index) {
    if (!index || !index.agents) return null;
    var byTask = {}, runLevel = [];
    index.agents.forEach(function (a) {
      if (a.task != null) (byTask[a.task] = byTask[a.task] || []).push(a);
      else runLevel.push(a);
    });
    return { byTask: byTask, runLevel: runLevel, index: index };
  }

  // Live refresh: only repaint when the fetched transcript differs from what is
  // already rendered, so expanded events and scroll position survive a tick.
  // Signature is text length — an append-only JSONL changes length whenever it
  // changes content.
  function shouldRerender(prevSig, text) {
    var sig = String(text == null ? "" : text).length;
    return { render: sig !== prevSig, sig: sig };
  }

  var API = { CAPS: CAPS, parseLines: parseLines, projectAgent: projectAgent,
              summaryLine: summaryLine, makeEl: makeEl, renderInto: renderInto,
              partitionAgents: partitionAgents, shouldRerender: shouldRerender };
  if (typeof globalThis !== "undefined") globalThis.AuditProjection = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
