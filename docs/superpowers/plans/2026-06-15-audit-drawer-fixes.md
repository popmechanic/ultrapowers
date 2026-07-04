# Audit-drawer Fixes Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three audit-drawer defects found verifying v0.0.12 — stations never clickable, `--embed` killed by literal `</script>`, and the 2 s LIVE refresh resetting expand/scroll.

**Architecture:** Viewer-only, drift-safe. Recover the task id from the real prompt shape (`"id" is "N"`) and partition agents by task-id presence (unresolved → hub, never orphaned); escape every JSON blob inlined into `<script>`; skip the LIVE re-render when transcript bytes are unchanged. The agent-partition and refresh-decision logic move into pure functions in `audit_project.js` so they are unit-tested, not buried in the template.

**Tech Stack:** Python 3 (`render_viewer.py`, `audit_run.py`, pytest), dependency-free browser JS (`audit_project.js`, `swarm_template.html`), node for the projection spec.

**Acceptance:** suite — ultrapowers' own viewer/scripts; author and operator both read the diffs, and the committed pytest + node-projection suite (with the existing drift pins in `test_no_prompt_drift.py`) is the verification. No held-out exam.

---

### Task 1: JS projection helpers — `partitionAgents` + `shouldRerender`

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/viewer/audit_project.js`
- Test: `tests/audit_project_spec.mjs`

`audit_project.js` is a classic script (no import/export) that `render_viewer.py` inlines into `swarm.html` and that node tests `require`. Add two pure, dependency-free functions and export them on the `API` object. `partitionAgents` replaces the inline partition the template does today; the new rule is **task-id presence**, not role: any agent with `task != null` goes to its station, everything else (including a role-misdetect) goes to the hub, so nothing is ever orphaned. It returns `null` when the index is absent (drawer disabled), matching the template's current `if (!AUDIT_INDEX) return null`. `shouldRerender` lets the live loop skip repainting when the fetched transcript is byte-for-byte what is already on screen (signature = text length; an append-only JSONL only grows).

- [ ] **Step 1: Add the failing spec assertions**

Append, in `tests/audit_project_spec.mjs`, immediately before the final `if (failed) { ... }` block:

```js
// partitionAgents: task!=null -> station; null -> hub; null index -> null
eq(A.partitionAgents(null), null, "partitionAgents null index -> null");
{
  const idx = { agents: [
    { id: "a", role: "impl",    task: "1" },
    { id: "b", role: "review",  task: "1" },
    { id: "c", role: "merge",   task: null },
    { id: "d", role: "unknown", task: "2" },   // role-misdetect still reaches its station
  ]};
  const part = A.partitionAgents(idx);
  eq(Object.keys(part.byTask).sort(), ["1", "2"], "partitionAgents groups by task id");
  eq(part.byTask["1"].length, 2, "partitionAgents: two agents on task 1");
  eq(part.byTask["2"][0].id, "d", "partitionAgents: task id wins over role");
  eq(part.runLevel.map(function (a) { return a.id; }), ["c"], "partitionAgents: unresolved task -> hub");
  ok(part.index === idx, "partitionAgents carries the index through");
}

// shouldRerender: first paint renders; unchanged -> skip; changed -> render
{
  const first = A.shouldRerender(undefined, "abc");
  eq(first, { render: true, sig: 3 }, "shouldRerender: first paint renders");
  eq(A.shouldRerender(first.sig, "abc").render, false, "shouldRerender: unchanged -> skip");
  eq(A.shouldRerender(first.sig, "abcd"), { render: true, sig: 4 }, "shouldRerender: changed -> render");
}
```

- [ ] **Step 2: Run the spec and watch it fail**

Run: `node tests/audit_project_spec.mjs`
Expected: FAIL — `TypeError: A.partitionAgents is not a function` (or a `FAIL partitionAgents ...` line), non-zero exit.

- [ ] **Step 3: Implement the two helpers**

In `skills/ultrapowers/viewer/audit_project.js`, add these functions just above the `var API = { ... }` line:

```js
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
```

Then extend the `API` object to export them:

```js
  var API = { CAPS: CAPS, parseLines: parseLines, projectAgent: projectAgent,
              summaryLine: summaryLine, makeEl: makeEl, renderInto: renderInto,
              partitionAgents: partitionAgents, shouldRerender: shouldRerender };
```

- [ ] **Step 4: Run the spec and watch it pass**

Run: `node tests/audit_project_spec.mjs`
Expected: PASS — prints `ALL TESTS PASSED`, exit 0.

- [ ] **Step 5: Run the pytest wrapper**

Run: `python3 -m pytest tests/test_audit_project.py -q`
Expected: PASS (1 passed).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/viewer/audit_project.js tests/audit_project_spec.mjs
git commit -m "feat(viewer): partitionAgents + shouldRerender helpers (audit drawer fix A/C)"
```

---

### Task 2: Classifier recovers the real task id

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/audit_run.py`
- Test: `tests/test_audit_run.py`

`classify` looks for `### Task N:` in the agent's first user message, but the real engine prompt never inlines that header — it instructs the agent to *"find the object whose `"id"` is `"N"`"* and read the task body from a JSON file. Add a `TASK_ID` regex for that real phrasing, try it first, and keep `TASK_HEAD` as a fallback so the existing synthetic fixtures still classify. `classify` is shared by both the advisory audit table and `render_viewer.build_index`, so this one change fixes both.

- [ ] **Step 1: Add the failing test for the real prompt shape**

In `tests/test_audit_run.py`, add these fixtures next to the existing `IMPL_7`/`REVIEW_7` block:

```python
IMPL_ID_2 = ("SAFETY: Operate ONLY inside the git worktree assigned to you.\n\n"
             "You are an implementer subagent operating inside a dedicated git worktree.\n\n"
             'TASK: read your verbatim task text from the JSON file at /tmp/waves.json — '
             'in its "tasks" array, find the object whose "id" is "2" and use that '
             "object's \"body\" field as the authoritative task text.\n")
REVIEW_ID_3 = ("SAFETY: ...\n\nYou are an independent reviewer. You receive the original task text.\n\n"
               'find the object whose "id" is "3" and use that object\'s "body" field.\n')
```

Add this test function:

```python
def test_classifies_task_id_from_real_prompt_shape(tmp_path):
    agent_file(tmp_path, "a1", IMPL_ID_2, "test-model", turns=1)
    agent_file(tmp_path, "a2", REVIEW_ID_3, "judge-model", turns=1)
    p = run_audit(tmp_path)
    assert p.returncode == 0, p.stderr
    assert "| impl:2 | test-model | 1 | 10 |" in p.stdout
    assert "| review:3 | judge-model | 1 | 10 |" in p.stdout
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_audit_run.py::test_classifies_task_id_from_real_prompt_shape -q`
Expected: FAIL — output has `| impl:? |` / `| review:? |` instead of `impl:2` / `review:3`.

- [ ] **Step 3: Add the `TASK_ID` regex and use it in `classify`**

In `skills/ultrapowers/scripts/audit_run.py`, add below the `TASK_HEAD` definition (line 24):

```python
# The real engine prompt references the task by id rather than an inlined
# header:  …find the object whose "id" is "2"…  (per-task impl/reviewer prompts).
TASK_ID = re.compile(r'"id"\s+is\s+"([A-Za-z0-9]+)"')
```

Change `classify` to try `TASK_ID` first, then fall back to `TASK_HEAD`:

```python
def classify(text):
    for marker, role in ROLE_MARKERS:
        if marker in text:
            if role in ("impl", "review"):
                m = TASK_ID.search(text) or TASK_HEAD.search(text)
                return role + ":" + (m.group(1) if m else "?")
            return role
    return "unknown"
```

- [ ] **Step 4: Run the new test and watch it pass**

Run: `python3 -m pytest tests/test_audit_run.py::test_classifies_task_id_from_real_prompt_shape -q`
Expected: PASS.

- [ ] **Step 5: Run the whole file — the `### Task N:` fallback must still hold**

Run: `python3 -m pytest tests/test_audit_run.py -q`
Expected: PASS (all, including `test_classifies_roles_and_sums_effort`, which exercises the `TASK_HEAD` fallback).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/audit_run.py tests/test_audit_run.py
git commit -m "fix(audit): recover task id from real prompt shape, TASK_HEAD fallback (fix A)"
```

---

### Task 3: Renderer — `null` for unresolved task + escape inlined JSON

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultrapowers/scripts/render_viewer.py`
- Test: `tests/test_viewer.py`

Two renderer changes. (1) `build_index` currently writes `"task": (task or None)`, but a classified-but-unresolved agent carries the sentinel `"?"`, which is truthy and leaks into the index — that is what lands per-task agents under a station id no map node matches. Emit `None` for `"?"`/empty. (2) `render` inlines `json.dumps(...)` into the page's `<script>`; transcripts contain literal `</script>` (and `<!--`, U+2028/U+2029), which break the script element or the JS string. Route every inlined JSON blob through a `_js_embed` helper that escapes those code points; `<` renders as `<` in a JS string, so the data is byte-identical to the reader. This task's index test uses the real `"id" is "N"` prompt shape, so it needs the classifier from Task 2 (hence Depends-on 2).

- [ ] **Step 1: Add the failing embed-escaping test**

In `tests/test_viewer.py`, add:

```python
def test_embed_escapes_script_close_in_transcript(tmp_path):
    run_dir = tmp_path / "wf_nasty"
    run_dir.mkdir()
    nasty = "result with </script><!-- and \u2028 a line sep"
    lines = [
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "text",
                        "text": ("You are an implementer subagent operating inside a "
                                 'dedicated git worktree.\nfind the object whose "id" is "1"\n')}]}}),
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "tool_result", "content": nasty}]}}),
    ]
    (run_dir / "agent-z1.jsonl").write_text("\n".join(lines) + "\n")
    (run_dir / "agent-z1.meta.json").write_text(
        json.dumps({"agentType": "workflow-subagent", "worktreePath": "/wt"}))
    out = tmp_path / "out"
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(run_dir), "--embed", "--out", str(out)])
    html = (out / "swarm.html").read_text()
    # the page has exactly one real closing tag — the transcript's </script> was escaped
    assert html.count("</script>") == 1, "stray </script> from transcript not escaped"
    # the AUDIT_EMBED blob still parses and round-trips the original content
    blob = re.search(r"const AUDIT_EMBED = (\{.*?\});\n", html, re.S).group(1)
    embed = json.loads(blob)                      # < etc. are valid JSON escapes
    assert "</script>" in json.dumps(embed), "content must round-trip after JSON decode"
```

- [ ] **Step 2: Add the failing index tests (real shape + unresolved → null)**

In `tests/test_viewer.py`, add:

```python
def test_index_classifies_task_id_from_real_prompt(tmp_path):
    run_dir = tmp_path / "wf_real"
    run_dir.mkdir()
    impl = ("You are an implementer subagent operating inside a dedicated git worktree.\n"
            'find the object whose "id" is "1" and use its "body".\n')
    _write_agent(run_dir, "a1", impl)             # per-task -> task "1"
    _write_agent(run_dir, "a3", MERGE_PROMPT)     # run-level -> task null
    out = tmp_path / "out"
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(run_dir), "--out", str(out)])
    html = (out / "swarm.html").read_text()
    assert '"task": "1"' in html, "real-shape per-task agent not classified to its id"
    assert '"task": null' in html, "run-level agent must be task null"


def test_index_unresolved_task_is_null_not_question_mark(tmp_path):
    run_dir = tmp_path / "wf_unres"
    run_dir.mkdir()
    impl_no_id = "You are an implementer subagent operating inside a dedicated git worktree.\nno id here\n"
    _write_agent(run_dir, "a1", impl_no_id)
    out = tmp_path / "out"
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(run_dir), "--out", str(out)])
    html = (out / "swarm.html").read_text()
    assert '"task": null' in html, "unresolved task must serialize as null"
    assert '"task": "?"' not in html, "the '?' sentinel must not reach the index"
```

- [ ] **Step 3: Run the three new tests and watch them fail**

Run: `python3 -m pytest tests/test_viewer.py -k "embed_escapes or real_prompt or unresolved" -q`
Expected: FAIL — escaping test sees `count == 2`; `unresolved` test finds `"task": "?"`.

- [ ] **Step 4: Add `_js_embed` and use it for every inlined JSON blob**

In `skills/ultrapowers/scripts/render_viewer.py`, add a module-level helper (e.g. just above `def render(`):

```python
def _js_embed(obj):
    """json.dumps for inlining inside <script>: escape the code points that let
    transcript content break out of the script element or the JS string literal.
    \\u003c renders as '<' in JS, so the decoded data is identical to the reader."""
    s = json.dumps(obj)
    for ch, esc in (("<", "\\u003c"), (">", "\\u003e"),
                    ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        s = s.replace(ch, esc)
    return s
```

In `render`, replace the four `json.dumps(...)` inlining calls with `_js_embed(...)`:

```python
    html = html.replace(DAG_PLACEHOLDER, _js_embed(dag))
    html = html.replace(THEME_PLACEHOLDER, _js_embed(THEMES[theme_name]))
    if audit_js is not None:
        html = html.replace(AUDIT_JS_PLACEHOLDER, audit_js)
    if audit_index is not None:
        html = html.replace(AUDIT_INDEX_PLACEHOLDER, _js_embed(audit_index))
    if audit_embed is not None:
        html = html.replace(AUDIT_EMBED_PLACEHOLDER, _js_embed(audit_embed))
```

(`audit_js` is raw JavaScript source, not JSON — leave its replacement untouched.)

- [ ] **Step 5: Emit `None` for an unresolved task in `build_index`**

In `skills/ultrapowers/scripts/render_viewer.py`, in `build_index`, change the `task` field of the appended agent dict from `"task": (task or None),` to:

```python
            "task": (task if task and task != "?" else None),
```

- [ ] **Step 6: Run the new tests and watch them pass**

Run: `python3 -m pytest tests/test_viewer.py -k "embed_escapes or real_prompt or unresolved" -q`
Expected: PASS (3 passed).

- [ ] **Step 7: Run the whole viewer file**

Run: `python3 -m pytest tests/test_viewer.py -q`
Expected: PASS (all — including `test_render_with_transcripts_bakes_index_and_symlinks`, which still resolves `### Task 1:` via the fallback).

- [ ] **Step 8: Commit**

```bash
git add skills/ultrapowers/scripts/render_viewer.py tests/test_viewer.py
git commit -m "fix(viewer): null unresolved task + escape inlined JSON for --embed (fix A/B)"
```

---

### Task 4: Template delegates partition + live-refresh to the helpers

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/viewer/swarm_template.html`
- Test: `tests/test_swarm_wiring.py`

Files-note — `tests/test_swarm_wiring.py` (create)

Wire the template to the Task 1 helpers and stop the live tick from clobbering open events. Replace the inline `audit` partition with `AuditProjection.partitionAgents(AUDIT_INDEX)` (same `null`-guard, new task-id rule), and make `fetchAndRender` skip the repaint when the fetched transcript is unchanged via `AuditProjection.shouldRerender`. Because the template now *references* `partitionAgents`/`shouldRerender` (defined in `audit_project.js` by Task 1), this task Depends-on 1.

- [ ] **Step 1: Write the failing wiring test**

Create `tests/test_swarm_wiring.py`:

```python
"""Wiring guard: the swarm template must delegate agent partitioning and the
live-refresh decision to the AuditProjection helpers (defined in
audit_project.js, inlined at render), not keep its own inline copies."""
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
PLAN = ROOT / "tests/fixtures/marked-plan.md"


def _run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def _render(tmp_path):
    run_dir = tmp_path / "wf_wire"
    run_dir.mkdir()
    (run_dir / "agent-a1.jsonl").write_text(
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "text",
                        "text": ("You are an implementer subagent operating inside a "
                                 'dedicated git worktree.\nfind the object whose "id" is "1"\n')}]}}) + "\n")
    (run_dir / "agent-a1.meta.json").write_text(
        json.dumps({"agentType": "workflow-subagent", "worktreePath": "/wt"}))
    out = tmp_path / "out"
    _run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
          "--transcripts", str(run_dir), "--out", str(out)])
    return (out / "swarm.html").read_text()


def test_template_delegates_partition_and_refresh(tmp_path):
    html = _render(tmp_path)
    # the helpers are inlined (definition from audit_project.js) ...
    assert "function partitionAgents" in html, "partitionAgents not inlined (Task 1 missing?)"
    assert "function shouldRerender" in html, "shouldRerender not inlined (Task 1 missing?)"
    # ... and the template calls them ...
    assert "AuditProjection.partitionAgents(" in html, "template must call partitionAgents"
    assert "AuditProjection.shouldRerender(" in html, "template must call shouldRerender"
    # ... and the old inline role-gated partition is gone
    assert 'a.role === "impl" || a.role === "review"' not in html, "inline partition not removed"


def test_full_inlined_script_parses(tmp_path):
    node = shutil.which("node")
    if not node:
        import pytest
        pytest.skip("node not available")
    html = _render(tmp_path)
    js = re.search(r"<script>\n(.*)</script>", html, re.S).group(1)
    f = tmp_path / "wired.js"
    f.write_text(js)
    _run([node, "--check", str(f)])
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_swarm_wiring.py -q`
Expected: FAIL — `AuditProjection.partitionAgents(` not found; the old `a.role === "impl" || a.role === "review"` string is still present.

- [ ] **Step 3: Replace the inline `audit` partition**

In `skills/ultrapowers/viewer/swarm_template.html`, replace the whole `const audit = (function () { ... })();` IIFE with one line:

```js
const audit = AuditProjection.partitionAgents(AUDIT_INDEX);
```

- [ ] **Step 4: Track a per-agent signature and skip unchanged repaints**

In the same file, change the live-state declaration:

```js
let liveTimer = null, liveAgentId = null, liveSig = null;
```

In `loadAgent`, in the `else` branch that sets the `LIVE` badge, reset the signature before the first fetch:

```js
  } else {
    d.badge.textContent = "LIVE";
    liveAgentId = a.id;
    liveSig = null;
    fetchAndRender(a, d, false);
    liveTimer = setInterval(function () { if (liveAgentId === a.id) fetchAndRender(a, d, true); }, 2000);
  }
```

Rewrite `fetchAndRender` to consult `shouldRerender`:

```js
function fetchAndRender(a, d, quiet) {
  fetch("./" + a.file, { cache: "no-store" })
    .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
    .then(function (text) {
      const decision = AuditProjection.shouldRerender(liveSig, text);
      liveSig = decision.sig;
      if (!decision.render) return;   // unchanged since last paint: keep expand + scroll
      const p = AuditProjection.parseLines(text);
      renderEvents(AuditProjection.projectAgent(p.entries).events, d, p.versions, p.unparsed);
    })
    .catch(function (err) { if (!quiet) d.body.textContent = "could not load " + a.file + " (" + err + ")"; });
}
```

- [ ] **Step 5: Run the wiring test and watch it pass**

Run: `python3 -m pytest tests/test_swarm_wiring.py -q`
Expected: PASS (2 passed; the node `--check` test confirms the full inlined script still parses).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/viewer/swarm_template.html tests/test_swarm_wiring.py
git commit -m "fix(viewer): delegate partition + skip-unchanged live refresh (fix A/C)"
```

---

### Task 5: Full-suite gate

**Type:** gate
**Depends-on:** none

The pre-merge verification for this run. The node projection spec runs through its pytest wrapper (`test_audit_project.py`), so the single command covers both languages.

Suite command:

```bash
python3 -m pytest tests/ -q
```

Expected: all pass (baseline was 284 collected; this plan adds tests). A non-green suite blocks the merge.

---

### Task 6: Release — bump to 0.0.13 and open PR

**Type:** release
**Depends-on:** 1, 2, 3, 4

**Files:**
- Modify: `.claude-plugin/plugin.json`

Carried verbatim into the post-merge runbook (not executed as a worktree task):

```bash
# bump the plugin manifest 0.0.12 -> 0.0.13
python3 - <<'PY'
import json, pathlib
p = pathlib.Path(".claude-plugin/plugin.json")
d = json.loads(p.read_text())
d["version"] = "0.0.13"
p.write_text(json.dumps(d, indent=2) + "\n")
print("bumped to", d["version"])
PY
git add .claude-plugin/plugin.json
git commit -m "release: 0.0.13 (audit-drawer fixes)"
git push -u origin feat/audit-drawer-fixes
gh pr create --fill --base main --head feat/audit-drawer-fixes
```

---

### Task 7: Manual acceptance re-run

**Type:** manual
**Depends-on:** 6

Operator smoke test, carried into the runbook — re-runs the verification that found these bugs against the build run `wf_fa2b2a99-92f`:

```bash
RUN="$(ls -dt ~/.claude/projects/-Users-marcusestes-Websites-ultrapowers*/*/subagents/workflows/wf_fa2b2a99-92f/ | head -1)"
PLAN="docs/superpowers/plans/2026-06-15-transcript-audit-drawer.md"
md5 "$RUN"/agent-*.jsonl > /tmp/md5_before.txt
python3 skills/ultrapowers/scripts/render_viewer.py "$PLAN" --transcripts "$RUN" --out /tmp/live
python3 skills/ultrapowers/scripts/render_viewer.py "$PLAN" --transcripts "$RUN" --embed --out /tmp/embed
md5 "$RUN"/agent-*.jsonl > /tmp/md5_after.txt && diff /tmp/md5_before.txt /tmp/md5_after.txt && echo "transcripts unmodified"
```

Confirm in a browser: serving `/tmp/live` over http shows ≥1 clickable station; clicking T2 opens the task-2 agents with `●`/`⚙`/`→` under a `LIVE` badge; an expanded event stays open past the 2 s tick. Opening `/tmp/embed/swarm.html` renders with no console errors under a `SNAPSHOT` badge.

---

## Wave structure (informational)

- **Wave 1 (parallel):** Task 1 (`audit_project.js`), Task 2 (`audit_run.py`) — disjoint files.
- **Wave 2 (parallel):** Task 3 (`render_viewer.py`, after Task 2), Task 4 (`swarm_template.html`, after Task 1) — disjoint files.
- Task 5 (gate), Task 6 (release), Task 7 (manual) are excluded from the waves; 5 informs the test gate, 6 and 7 are carried into the post-merge runbook.

Every source and test file is owned by exactly one implementation task; same-wave tasks touch disjoint files and use pytest `tmp_path` (no shared fixtures, no ports), so they are concurrency-safe.
