# Transcript Audit Drawer Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a transcript-reading drawer to the swarm viewer so a human can click a station (or the hub) and read that subagent's reasoning + tool I/O, live, without parsing raw JSONL by hand.

**Architecture:** One projection implementation in browser JS (`viewer/audit_project.js`), inlined into `swarm.html` at render time. `render_viewer.py` gains `--transcripts`/`--embed`: it builds a tiny metadata **index** (reusing `audit_run.py`'s classifier) and either symlinks the raw transcripts next to `swarm.html` (live; drawer fetches one file on click and re-fetches to stream) or bakes truncated content (`--embed`; offline/`file://`). The drawer slides over the existing SVG map. No engine change; transcripts/worktrees stay read-only.

**Tech Stack:** Python 3 (`render_viewer.py`), dependency-free vanilla JS (projection module + drawer), pytest, and node tests wrapped under pytest (the `sim_workflow.mjs` + `test_workflow_sim.py` pattern).

**Acceptance:** suite — viewer feature in the ultrapowers plugin itself; the author and operator read the diffs and the committed tests (the JS projection spec plus the extended render/template tests) are the verification. No held-out sealed exam.

---

## Cross-task contract (the projection API)

`viewer/audit_project.js` exposes a single global `AuditProjection`, used by the drawer (Task 2), produced/inlined by the renderer (Task 3), and tested directly (Task 1). It is a classic script (no `import`/`export`) so it inlines into a `<script>`, and also assigns `module.exports` so node can `require` it.

- `AuditProjection.CAPS` → `{ text: 8192, toolInput: 4096, toolResult: 8192, collapsed: 200 }`.
- `AuditProjection.parseLines(text, caps?)` → `{ entries, versions, unparsed }`. Line-level defensive parse of raw JSONL text. `entries` are `{ type, content:[blocks] }` for `type` ∈ {assistant, user} only.
- `AuditProjection.projectAgent(entries, caps?)` → `{ events }`. Block-level projection. Each event is one of:
  - `{ kind:"text", text, truncated }`
  - `{ kind:"tool_use", name, input, truncated }`
  - `{ kind:"tool_result", result, truncated }`
  - `{ kind:"unknown", blockType }`
- `AuditProjection.summaryLine(event)` → collapsed one-line string with glyph (`● …` / `⚙ name(…)` / `→ …` / `‹unrecognized block: TYPE›`).

**Convergence rule (Task 1 + Task 3 must agree):** `projectAgent` accepts a `tool_use` block whose `input` is **either** an object (the live `parseLines` path JSON-stringifies it) **or** a pre-stringified string (the `--embed` marshaller in Task 3 stringifies-and-truncates it to bound snapshot size). `tool_result` `content` may be a string or an array of `{type:"text",text}`. The `--embed` marshaller in Task 3 produces the same `entries` shape as `parseLines`, so the one `projectAgent` renders both paths.

---

### Task 1: Projection module + node spec

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/viewer/audit_project.js`
- Create: `tests/audit_project_spec.mjs`
- Create: `tests/test_audit_project.py`

Implements the cross-task projection API above. Pure, dependency-free, dual-use (browser + node). The drawer in Task 2 calls `AuditProjection.parseLines`/`projectAgent`/`summaryLine`/`CAPS` exactly as named here; the renderer in Task 3 inlines this file and its `--embed` marshaller produces `entries` matching `parseLines`. Per the convergence rule above, `projectAgent`'s `tool_use` branch must accept `input` as an object **or** a string.

- [ ] **Step 1: Write the failing node spec**

Create `tests/audit_project_spec.mjs`:

```js
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const A = require("../skills/ultrapowers/viewer/audit_project.js");

let failed = 0;
const J = (x) => JSON.stringify(x);
function eq(actual, expected, msg) {
  if (J(actual) !== J(expected)) { failed++; console.error("FAIL", msg, "\n  got", J(actual), "\n  exp", J(expected)); }
}
function ok(cond, msg) { if (!cond) { failed++; console.error("FAIL", msg); } }

// assistant text
let r = A.projectAgent([{ type: "assistant", content: [{ type: "text", text: "hello" }] }]);
eq(r.events, [{ kind: "text", text: "hello", truncated: 0 }], "assistant text");

// tool_use with object input (live path)
r = A.projectAgent([{ type: "assistant", content: [{ type: "tool_use", name: "Read", input: { file: "a.js" } }] }]);
eq(r.events[0].kind, "tool_use", "tool_use kind");
eq(r.events[0].name, "Read", "tool_use name");
ok(r.events[0].input.includes("a.js"), "tool_use object input stringified");

// tool_use with string input (embed path) — must NOT double-encode
r = A.projectAgent([{ type: "assistant", content: [{ type: "tool_use", name: "Bash", input: "pytest -q" }] }]);
eq(r.events[0].input, "pytest -q", "tool_use string input used as-is");

// tool_result as string
r = A.projectAgent([{ type: "user", content: [{ type: "tool_result", content: "240 lines" }] }]);
eq(r.events, [{ kind: "tool_result", result: "240 lines", truncated: 0 }], "tool_result string");

// tool_result as array of text blocks
r = A.projectAgent([{ type: "user", content: [{ type: "tool_result", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] }]);
eq(r.events[0].result, "a b", "tool_result array joined");

// unknown block type surfaced, not dropped
r = A.projectAgent([{ type: "assistant", content: [{ type: "thinking", text: "x" }] }]);
eq(r.events[0].kind, "unknown", "unknown block kind");
eq(r.events[0].blockType, "thinking", "unknown block type carried");

// truncation + remainder count
const big = "x".repeat(A.CAPS.text + 50);
r = A.projectAgent([{ type: "assistant", content: [{ type: "text", text: big }] }]);
eq(r.events[0].text.length, A.CAPS.text, "text capped at CAPS.text");
eq(r.events[0].truncated, 50, "truncated remainder counted");

// parseLines: malformed line skipped, version captured, attachment dropped
const text = [
  J({ type: "assistant", version: "2.1.177", message: { content: [{ type: "text", text: "hi" }] } }),
  "not json {{{",
  J({ type: "attachment", version: "2.1.177", message: { content: [] } }),
].join("\n");
const p = A.parseLines(text);
eq(p.unparsed, 1, "one malformed line counted");
eq(p.versions, ["2.1.177"], "version captured");
eq(A.projectAgent(p.entries).events, [{ kind: "text", text: "hi", truncated: 0 }], "parseLines->project drops attachment");

// user string content becomes a text block
const p2 = A.parseLines(J({ type: "user", message: { content: "the task prompt" } }));
eq(A.projectAgent(p2.entries).events, [{ kind: "text", text: "the task prompt", truncated: 0 }], "user string content -> text");

// summaryLine glyphs
eq(A.summaryLine({ kind: "tool_use", name: "Bash", input: "pytest -q" }), "⚙ Bash(pytest -q)", "summaryLine tool_use");
eq(A.summaryLine({ kind: "unknown", blockType: "thinking" }), "‹unrecognized block: thinking›", "summaryLine unknown");

if (failed) { console.error(failed + " FAILED"); process.exit(1); }
console.log("ALL TESTS PASSED");
```

Create `tests/test_audit_project.py`:

```python
"""Run the JS transcript-projection spec (tests/audit_project_spec.mjs).

Projection logic lives once, in viewer/audit_project.js; this is its guard.
Requires node; skips without it (same pattern as test_workflow_sim.py)."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = ROOT / "tests/audit_project_spec.mjs"


def test_audit_projection_js():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    p = subprocess.run([node, str(SPEC)], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "ALL TESTS PASSED" in p.stdout, p.stdout + p.stderr
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `python3 -m pytest tests/test_audit_project.py -v`
Expected: FAIL (the `require` resolves nothing — `Cannot find module .../audit_project.js`). If node is absent it SKIPS; install/enable node so the test actually runs.

- [ ] **Step 3: Implement the projection module**

Create `skills/ultrapowers/viewer/audit_project.js`:

```js
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

  var API = { CAPS: CAPS, parseLines: parseLines, projectAgent: projectAgent, summaryLine: summaryLine };
  if (typeof globalThis !== "undefined") globalThis.AuditProjection = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `python3 -m pytest tests/test_audit_project.py -v`
Expected: PASS (node prints `ALL TESTS PASSED`).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/viewer/audit_project.js tests/audit_project_spec.mjs tests/test_audit_project.py
git commit -m "feat: transcript projection module (audit_project.js) + node spec"
```

---

### Task 2: Drawer in the swarm template

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/viewer/swarm_template.html`
- Test: `tests/test_viewer.py`

Add a transcript drawer that slides over the SVG map. The drawer calls the `AuditProjection` API (defined in Task 1, inlined by Task 3) — referenced as a runtime global; this task does not import the file. The drawer is inert unless transcripts are baked (`AUDIT_INDEX` non-null), so a normal `render_viewer.py` run (no `--transcripts`) is unchanged. New placeholders: `/*__AUDIT_INDEX__*/null`, `/*__AUDIT_EMBED__*/null`, and `/*__AUDIT_JS__*/` (where Task 3 inlines the projection module from Task 1). The drawer uses these `AuditProjection` members: `parseLines`, `projectAgent`, `summaryLine`, `CAPS`. The exact return shapes appear in the complete drawer code in Step 3 below, so this task is self-contained even though it runs in parallel with Task 1 — both sides are authored to the same API here.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_viewer.py` (the imports/`run`/`PLAN`/`SCRIPTS` helpers already exist there):

```python
def test_template_has_audit_drawer_inert_without_transcripts(tmp_path):
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    # drawer markup present
    assert 'id="drawer"' in html
    assert "closeDrawer" in html
    # placeholders present and inert (no --transcripts given)
    assert "/*__AUDIT_INDEX__*/null" in html
    assert "/*__AUDIT_EMBED__*/null" in html
    assert "/*__AUDIT_JS__*/" in html
    # drawer references the Task 1 API by name
    assert "AuditProjection" in html
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_viewer.py::test_template_has_audit_drawer_inert_without_transcripts -v`
Expected: FAIL (`id="drawer"` not in the template yet).

- [ ] **Step 3: Implement the template changes**

In `skills/ultrapowers/viewer/swarm_template.html`:

(3a) Add the drawer CSS inside the `<style>` block (near the other component rules, before `</style>`):

```css
  .drawer{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
    width:min(86%,640px);max-height:78%;display:flex;flex-direction:column;
    background:var(--screen-bg);border:1px solid var(--dim);border-radius:10px;
    box-shadow:0 10px 60px rgba(0,0,0,.6);color:var(--ink);font-family:var(--font);
    z-index:20;overflow:hidden}
  .drawer[hidden]{display:none}
  .drawer-head{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--faint)}
  .drawer-badge{font-size:11px;letter-spacing:.1em;color:var(--accent);
    border:1px solid var(--accent);border-radius:4px;padding:1px 6px}
  .drawer-title{flex:1;font-size:12px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .drawer-x{background:none;border:1px solid var(--dim);color:var(--hud);
    border-radius:4px;cursor:pointer;font:inherit;font-size:11px;padding:1px 6px}
  .drawer-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:6px 12px}
  .drawer-tabs .tab{background:none;border:1px solid var(--dim);color:var(--ink);
    border-radius:4px;cursor:pointer;font:inherit;font-size:11px;padding:1px 8px}
  .drawer-body{overflow:auto;padding:6px 12px;font-size:12px;line-height:1.45}
  .drawer-body .ev{margin:4px 0}
  .drawer-body .ev-head{white-space:pre-wrap}
  .drawer-body .ev-tool_result .ev-head{opacity:.8}
  .drawer-body pre.ev-full{white-space:pre-wrap;margin:4px 0 8px;padding:6px 8px;
    background:rgba(127,127,127,.12);border-radius:6px;max-height:40vh;overflow:auto}
  .drawer-foot{padding:6px 12px;border-top:1px solid var(--faint);font-size:10px;opacity:.6}
  .stationG.clickable{cursor:pointer}
```

(3b) Add the drawer DOM. Place it inside `.screen` immediately after the `<div class="hud">…</div>` block (the HUD is at line ~131), so it overlays the SVG:

```html
  <div id="drawer" class="drawer" hidden>
    <div class="drawer-head">
      <span id="drawerBadge" class="drawer-badge">LIVE</span>
      <span id="drawerTitle" class="drawer-title"></span>
      <button class="drawer-x" onclick="closeDrawer()">esc ✕</button>
    </div>
    <div id="drawerTabs" class="drawer-tabs"></div>
    <div id="drawerBody" class="drawer-body"></div>
    <div id="drawerFoot" class="drawer-foot"></div>
  </div>
```

(3c) Add the audit placeholders + JS. Immediately after the line `const DAG = /*__DAG_JSON__*/null;` (line ~141), add:

```js
/*__AUDIT_JS__*/
const AUDIT_INDEX = /*__AUDIT_INDEX__*/null;
const AUDIT_EMBED = /*__AUDIT_EMBED__*/null;

const audit = (function () {
  if (!AUDIT_INDEX) return null;            // no transcripts baked: drawer disabled
  const byTask = {}, runLevel = [];
  AUDIT_INDEX.agents.forEach(function (a) {
    if ((a.role === "impl" || a.role === "review") && a.task != null) {
      (byTask[a.task] = byTask[a.task] || []).push(a);
    } else { runLevel.push(a); }
  });
  return { byTask: byTask, runLevel: runLevel, index: AUDIT_INDEX };
})();

let liveTimer = null, liveAgentId = null;

function drawerEls() {
  return {
    root: document.getElementById("drawer"),
    title: document.getElementById("drawerTitle"),
    badge: document.getElementById("drawerBadge"),
    body: document.getElementById("drawerBody"),
    foot: document.getElementById("drawerFoot"),
    tabs: document.getElementById("drawerTabs"),
  };
}
function roleLabel(a) { return a.task != null ? (a.role + ":" + a.task) : a.role; }
function mkEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function stopLive() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } liveAgentId = null; }
function closeDrawer() { stopLive(); drawerEls().root.hidden = true; }
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });

function openDrawer(agents, label) {
  if (!audit || !agents || !agents.length) return;
  const d = drawerEls();
  d.root.hidden = false;
  d.tabs.innerHTML = "";
  agents.forEach(function (a) {
    const b = mkEl("button", "tab", roleLabel(a));
    b.onclick = function () { loadAgent(a, label); };
    d.tabs.appendChild(b);
  });
  loadAgent(agents[0], label);
}

function loadAgent(a, label) {
  stopLive();
  const d = drawerEls();
  d.title.textContent = (label ? label + " · " : "") + roleLabel(a) +
    " · " + (a.model || "?") + " · " + a.turns + " turns";
  d.body.textContent = "loading…";
  if (AUDIT_EMBED && AUDIT_EMBED[a.id]) {
    d.badge.textContent = "SNAPSHOT";
    const ev = AuditProjection.projectAgent(AUDIT_EMBED[a.id]).events;
    renderEvents(ev, d, (AUDIT_INDEX.versions || []), 0);
  } else if (location.protocol === "file:") {
    d.badge.textContent = "STATIC";
    d.body.textContent = "Serve this folder over http for live transcripts, or re-render with --embed for offline content.";
    d.foot.textContent = "";
  } else {
    d.badge.textContent = "LIVE";
    liveAgentId = a.id;
    fetchAndRender(a, d, false);
    liveTimer = setInterval(function () { if (liveAgentId === a.id) fetchAndRender(a, d, true); }, 2000);
  }
}

function fetchAndRender(a, d, quiet) {
  fetch("./" + a.file, { cache: "no-store" })
    .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
    .then(function (text) {
      const p = AuditProjection.parseLines(text);
      renderEvents(AuditProjection.projectAgent(p.entries).events, d, p.versions, p.unparsed);
    })
    .catch(function (err) { if (!quiet) d.body.textContent = "could not load " + a.file + " (" + err + ")"; });
}

function renderEvents(events, d, versions, unparsed) {
  d.body.innerHTML = "";
  events.forEach(function (ev) {
    const row = mkEl("div", "ev ev-" + ev.kind);
    const head = mkEl("div", "ev-head", AuditProjection.summaryLine(ev));
    row.appendChild(head);
    const full = ev.kind === "text" ? ev.text
      : ev.kind === "tool_use" ? ev.input
      : ev.kind === "tool_result" ? ev.result : "";
    if (full && full.length > AuditProjection.CAPS.collapsed) {
      const more = ev.truncated ? "\n… (+" + ev.truncated + " more chars — see raw file)" : "";
      const pre = mkEl("pre", "ev-full", full + more);
      pre.hidden = true;
      head.style.cursor = "pointer";
      head.onclick = function () { pre.hidden = !pre.hidden; };
      row.appendChild(pre);
    }
    d.body.appendChild(row);
  });
  d.foot.textContent = "format " + ((versions && versions.join(", ")) || "?") +
    (unparsed ? " · " + unparsed + " unparsed lines" : "");
}
```

(3d) Wire the click targets. Inside the existing `DAG.tasks.forEach((t, ti) => { … })` station loop (line ~313), after `stations[t.id] = { … }` is assigned, add:

```js
  if (audit && audit.byTask[t.id]) {
    g.classList.add("clickable");
    g.addEventListener("click", function () { openDrawer(audit.byTask[t.id], "Task " + t.id); });
  }
```

And after `const gHub = document.getElementById('hub');` (line ~252), add:

```js
if (audit && audit.runLevel.length) {
  gHub.style.cursor = "pointer";
  gHub.addEventListener("click", function () { openDrawer(audit.runLevel, "run-level"); });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_viewer.py -v`
Expected: PASS — the new drawer test passes, and the existing `test_render_viewer_bakes_dag`, `test_render_viewer_javascript_parses` (node `--check` on the embedded script, including the inert `/*__AUDIT_JS__*/` comment and the `AuditProjection` global references — syntax-only), and `test_render_viewer_all_themes` still pass.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/viewer/swarm_template.html tests/test_viewer.py
git commit -m "feat: transcript drawer DOM/CSS/JS in swarm template (inert without transcripts)"
```

---

### Task 3: render_viewer `--transcripts` / `--embed`

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Modify: `skills/ultrapowers/scripts/render_viewer.py`
- Test: `tests/test_viewer.py`

Adds `--transcripts <run-dir>` and `--embed` to `render_viewer.py`. Builds the metadata index by importing `audit_run.py` (sibling module: `first_user_text`, `classify`, `collect`); inlines `viewer/audit_project.js` (created by Task 1) into the `/*__AUDIT_JS__*/` placeholder (added by Task 2); replaces `/*__AUDIT_INDEX__*/null`. In live mode, symlinks each `agent-*.jsonl` next to `swarm.html` (no copy; transcripts stay read-only — reading through a symlink does not mutate the target). With `--embed`, instead bakes truncated content into `/*__AUDIT_EMBED__*/null`. The `--embed` marshaller produces `entries` matching `AuditProjection.parseLines` and stringifies `tool_use` inputs (see the convergence rule at the top of this plan).

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_viewer.py`:

```python
import os  # add near the top imports if not already present

# A richer synthetic agent than test_audit_run's: includes tool_use and
# tool_result blocks so projection has something to render. Built in tmp_path
# (not a committed fixture) so same-wave test runs stay concurrency-safe.
IMPL_PROMPT = ("SAFETY: ...\n\nYou are an implementer subagent operating inside a dedicated git worktree.\n\n"
               "TASK:\n### Task {tid}: do the thing\nbody\n")
REVIEW_PROMPT = ("SAFETY: ...\n\nYou are an independent reviewer. You receive the original task text.\n\n"
                 "### Task {tid}: do the thing\n")
MERGE_PROMPT = "SAFETY: ...\n\nYou are the wave merge agent, operating on the session repo main checkout.\n"


def _write_agent(run_dir, name, first_user, worktree="/wt/x"):
    lines = [
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "text", "text": first_user}]}}),
        "not json {{{",  # malformed line, must be skipped
        json.dumps({"type": "assistant", "version": "2.1.177",
                    "message": {"model": "test-model",
                                "usage": {"output_tokens": 11},
                                "content": [{"type": "text", "text": "I'll start by reading the plan."},
                                            {"type": "tool_use", "name": "Read", "input": {"file": "x.py"}}]}}),
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "tool_result", "content": "240 lines"}]}}),
    ]
    (run_dir / f"agent-{name}.jsonl").write_text("\n".join(lines) + "\n")
    (run_dir / f"agent-{name}.meta.json").write_text(
        json.dumps({"agentType": "workflow-subagent", "worktreePath": worktree}))


def _make_run(tmp_path):
    run_dir = tmp_path / "wf_test"
    run_dir.mkdir()
    _write_agent(run_dir, "a1", IMPL_PROMPT.format(tid="1"))
    _write_agent(run_dir, "a2", REVIEW_PROMPT.format(tid="1"))
    _write_agent(run_dir, "a3", MERGE_PROMPT)
    return run_dir


def test_render_with_transcripts_bakes_index_and_symlinks(tmp_path):
    run_dir = _make_run(tmp_path)
    out = tmp_path / "out"
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(run_dir), "--out", str(out)])
    html = (out / "swarm.html").read_text()
    assert "/*__AUDIT_INDEX__*/null" not in html, "index placeholder not replaced"
    assert "/*__AUDIT_JS__*/" not in html, "audit_project.js not inlined"
    assert "globalThis.AuditProjection" in html, "module body inlined"
    # impl agent classified to task '1' (== DAG station id '1')
    assert '"role": "impl"' in html and '"task": "1"' in html
    assert '"role": "merge"' in html  # run-level agent present
    # live mode: symlink to the raw transcript next to swarm.html, no copy
    link = out / "agent-a1.jsonl"
    assert link.is_symlink(), "expected a symlink in live mode"
    assert pathlib.Path(os.readlink(link)).name == "agent-a1.jsonl"


def test_render_embed_bakes_content_without_symlinks(tmp_path):
    run_dir = _make_run(tmp_path)
    out = tmp_path / "out"
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(run_dir), "--embed", "--out", str(out)])
    html = (out / "swarm.html").read_text()
    assert "/*__AUDIT_EMBED__*/null" not in html, "embed placeholder not replaced"
    assert "240 lines" in html, "tool_result content baked for offline use"
    assert not (out / "agent-a1.jsonl").exists(), "embed mode must not create symlinks"


def test_transcripts_out_must_differ_from_run_dir(tmp_path):
    run_dir = _make_run(tmp_path)
    import subprocess as sp
    p = sp.run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
                "--transcripts", str(run_dir), "--out", str(run_dir)],
               capture_output=True, text=True)
    assert p.returncode != 0
    assert "read-only" in (p.stdout + p.stderr).lower()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_viewer.py -k "transcripts or embed" -v`
Expected: FAIL (`render_viewer.py` rejects the unknown `--transcripts` argument).

- [ ] **Step 3: Implement the renderer changes**

In `skills/ultrapowers/scripts/render_viewer.py`:

(3a) Add `import os` to the imports, and after `HERE = pathlib.Path(__file__).resolve().parent`, make `audit_run` importable and define the new placeholders/caps:

```python
sys.path.insert(0, str(HERE))
import audit_run  # sibling module: first_user_text, classify, collect

AUDIT_INDEX_PLACEHOLDER = "/*__AUDIT_INDEX__*/null"
AUDIT_EMBED_PLACEHOLDER = "/*__AUDIT_EMBED__*/null"
AUDIT_JS_PLACEHOLDER = "/*__AUDIT_JS__*/"
AUDIT_JS = HERE.parent / "viewer" / "audit_project.js"

# Mirror AuditProjection.CAPS in viewer/audit_project.js — keep in sync.
AUDIT_CAPS = {"text": 8192, "toolInput": 4096, "toolResult": 8192, "collapsed": 200}
```

(3b) Add the index builder and the `--embed` marshaller (these are the only new functions). Place them above `def main():`:

```python
def build_index(run_dir):
    """Metadata only — no transcript content. Reuses audit_run's classifier."""
    agents = []
    versions = set()
    for f in sorted(run_dir.glob("agent-*.jsonl")):
        role_full = audit_run.classify(audit_run.first_user_text(f))  # "impl:1" / "merge" / "unknown"
        role, _, task = role_full.partition(":")
        model, turns, out_tokens = audit_run.collect(f)
        tools, first_line = 0, ""
        for line in f.read_text().splitlines():
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if d.get("version"):
                versions.add(d["version"])
            if d.get("type") == "assistant":
                for b in (d.get("message", {}).get("content") or []):
                    if isinstance(b, dict):
                        if b.get("type") == "tool_use":
                            tools += 1
                        if not first_line and b.get("type") == "text":
                            first_line = (b.get("text") or "")[:AUDIT_CAPS["collapsed"]]
        meta = {}
        mp = f.with_suffix(".meta.json")
        if mp.exists():
            try:
                meta = json.loads(mp.read_text())
            except json.JSONDecodeError:
                meta = {}
        agents.append({
            "id": f.stem[len("agent-"):],
            "file": f.name,
            "role": role,
            "task": (task or None),
            "model": model,
            "turns": turns,
            "tools": tools,
            "outTokens": out_tokens,
            "firstLine": first_line,
            "worktree": meta.get("worktreePath", ""),
        })
    return {"runId": run_dir.name, "versions": sorted(versions), "agents": agents}


def _trunc_block(b):
    bt = b.get("type")
    if bt == "text":
        return {"type": "text", "text": (b.get("text") or "")[:AUDIT_CAPS["text"]]}
    if bt == "tool_use":
        inp = b.get("input")
        s = json.dumps(inp if inp is not None else {})[:AUDIT_CAPS["toolInput"]]
        return {"type": "tool_use", "name": b.get("name", "?"), "input": s}  # string input: see convergence rule
    if bt == "tool_result":
        c = b.get("content")
        if isinstance(c, list):
            c = " ".join((x.get("text") or "") for x in c if isinstance(x, dict))
        elif not isinstance(c, str):
            c = "" if c is None else str(c)
        return {"type": "tool_result", "content": c[:AUDIT_CAPS["toolResult"]]}
    return {"type": bt or "unknown"}


def marshal_embed(run_dir):
    """For --embed: truncated entries matching AuditProjection.parseLines, so the
    one projectAgent renders both embedded and fetched data. One file at a time."""
    out = {}
    for f in sorted(run_dir.glob("agent-*.jsonl")):
        entries = []
        for line in f.read_text().splitlines():
            if not line.strip():
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = d.get("type")
            if t not in ("assistant", "user"):
                continue
            content = (d.get("message") or {}).get("content")
            if isinstance(content, list):
                blocks = [_trunc_block(b) for b in content if isinstance(b, dict)]
            elif isinstance(content, str):
                blocks = [{"type": "text", "text": content[:AUDIT_CAPS["text"]]}]
            else:
                blocks = []
            entries.append({"type": t, "content": blocks})
        out[f.stem[len("agent-"):]] = entries
    return out
```

(3c) Extend `render()` to accept and bake the audit data. Change its signature and body:

```python
def render(dag, theme_name, out_path, audit_index=None, audit_embed=None, audit_js=None):
    html = TEMPLATE.read_text()
    for ph in (DAG_PLACEHOLDER, THEME_PLACEHOLDER):
        if ph not in html:
            raise SystemExit(f"template placeholder {ph} missing — swarm_template.html was edited?")
    html = html.replace(DAG_PLACEHOLDER, json.dumps(dag))
    html = html.replace(THEME_PLACEHOLDER, json.dumps(THEMES[theme_name]))
    if audit_js is not None:
        html = html.replace(AUDIT_JS_PLACEHOLDER, audit_js)
    if audit_index is not None:
        html = html.replace(AUDIT_INDEX_PLACEHOLDER, json.dumps(audit_index))
    if audit_embed is not None:
        html = html.replace(AUDIT_EMBED_PLACEHOLDER, json.dumps(audit_embed))
    out_path.write_text(html)
    return out_path
```

(3d) In `main()`, add the args and build the audit data after `out_dir` is created. Add the arguments alongside the existing ones:

```python
    p.add_argument("--transcripts", help="run transcript dir — enables the audit drawer")
    p.add_argument("--embed", action="store_true",
                   help="bake truncated transcript content for offline/file:// use")
```

After `out_dir.mkdir(parents=True, exist_ok=True)` and before the `--all`/single render calls, add:

```python
    audit_index = audit_embed = audit_js = None
    if args.transcripts:
        run_dir = pathlib.Path(args.transcripts)
        if not run_dir.is_dir():
            raise SystemExit(f"--transcripts: not a directory: {run_dir}")
        if out_dir.resolve() == run_dir.resolve():
            raise SystemExit("--out must differ from --transcripts (transcripts are read-only)")
        audit_index = build_index(run_dir)
        audit_js = AUDIT_JS.read_text()
        if args.embed:
            audit_embed = marshal_embed(run_dir)
        else:
            for f in run_dir.glob("agent-*.jsonl"):  # live: symlink, never copy
                link = out_dir / f.name
                if link.is_symlink() or link.exists():
                    link.unlink()
                os.symlink(f.resolve(), link)
```

Then pass the audit data into both render call sites. In the `--all` branch:

```python
    if args.all:
        for name in THEMES:
            print("wrote", render(dag, name, out_dir / f"swarm-{name}.html",
                                  audit_index, audit_embed, audit_js))
        return
```

And the single-theme call:

```python
    out = render(dag, args.theme, out_dir / "swarm.html",
                 audit_index, audit_embed, audit_js)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_viewer.py -v`
Expected: PASS — the three new transcript/embed tests plus all pre-existing viewer tests.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/render_viewer.py tests/test_viewer.py
git commit -m "feat: render_viewer --transcripts/--embed bakes audit index + drawer"
```

---

### Task 4: Documentation

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `skills/ultrapowers/viewer/README.md`
- Modify: `skills/ultrapowers/SKILL.md`

Document the audit drawer: the `--transcripts`/`--embed` flags, the live vs snapshot vs static data modes, and the honesty labels. Add one pointer in SKILL.md's post-run section. (No new test; the gate's `validate_skill.py` covers reference integrity.)

- [ ] **Step 1: Update the viewer README**

In `skills/ultrapowers/viewer/README.md`, add a section after the "Usage" block:

````markdown
## Reading transcripts (audit drawer)

Pass a run's transcript dir to make stations clickable — clicking opens a drawer
over the map showing that subagent's reasoning (`●`), tool calls (`⚙`), and
results (`→`). The hub opens the run-level agents (setup, merge, reconcile,
integration, unclassified). Find the dir at the "Transcript dir:" line printed
when the Workflow launched, or:

```sh
ls -dt ~/.claude/projects/<project-slug>/*/subagents/workflows/*/ | head -1
```

```sh
# Live: symlinks the raw transcripts next to swarm.html (no copy) and streams
# the open agent's file (~2s refresh). Needs the local server (fetch is blocked
# on file://).
python3 skills/ultrapowers/scripts/render_viewer.py <plan.md> \
    --transcripts <run-dir> --out /tmp/swarm
(cd /tmp/swarm && python3 -m http.server 8123)   # open http://localhost:8123/swarm.html

# Offline / shareable: bake truncated content into one self-contained file.
python3 skills/ultrapowers/scripts/render_viewer.py <plan.md> \
    --transcripts <run-dir> --embed --out /tmp/swarm   # open file:///tmp/swarm/swarm.html
```

Transcripts and worktrees are read-only; `--out` must differ from `--transcripts`.
The drawer badge states provenance: `LIVE` (fetching + refreshing), `SNAPSHOT`
(`--embed` content), or `STATIC` (opened over `file://` with no embedded content —
serve over http or re-render with `--embed`). Content is truncated per
`audit_project.js` `CAPS`; "expand" reveals more up to the cap, then points to the
raw file. The drawer projects transcripts in the browser — it never loads whole
files into an assistant's context.
````

- [ ] **Step 2: Add the SKILL.md pointer**

In `skills/ultrapowers/SKILL.md`, in the post-run section (the paragraph mentioning `audit_run.py`, around line 325), append:

```markdown
To *read* the transcripts (not just their effort stats), render the swarm viewer
with `--transcripts <transcript-dir>`: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/render_viewer.py <plan-path> --transcripts <transcript-dir> --out /tmp/swarm`, serve `/tmp/swarm` over http, and click a station to open its subagent's reasoning + tool I/O in the audit drawer (add `--embed` for a self-contained, offline file). Read-only; see `skills/ultrapowers/viewer/README.md`.
```

- [ ] **Step 3: Verify skill reference integrity**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: `skill ok`.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/viewer/README.md skills/ultrapowers/SKILL.md
git commit -m "docs: audit drawer usage in viewer README and SKILL.md"
```

---

### Task 5: Full-suite verification

**Type:** gate

The suite that gates this plan. Not executed as a task; its command informs the run's `testCmd`, and its expectations are listed at the wave-plan gate.

- `python3 -m pytest tests/ -q` from the repo root — expect all pass. Includes the node-wrapped JS projection spec (`tests/test_audit_project.py`) and the extended `tests/test_viewer.py`; node-dependent tests skip cleanly when node is absent.
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` — expect `skill ok`.
- `python3 skills/ultrapowers/scripts/render_viewer.py tests/fixtures/marked-plan.md --out /tmp/swarm-smoke --all` — expect 10 themed files written, no traceback.
```
