# Audit-drawer fixes: clickable stations, embed safety, stable live refresh

**Date:** 2026-06-15
**Scope:** Viewer only — `skills/ultrapowers/scripts/audit_run.py`, `skills/ultrapowers/scripts/render_viewer.py`, `skills/ultrapowers/viewer/swarm_template.html`, `skills/ultrapowers/viewer/audit_project.js`, and tests. **No engine change** (`waves.js` stays frozen). Transcripts and worktrees stay read-only. Follow-up to `2026-06-15-transcript-audit-drawer-design.md`.

## Problem

Hands-on verification of the shipped audit drawer (v0.0.12) against the run that built it (`…audit-drawer/…/wf_fa2b2a99-92f`, 16 agents) surfaced three defects:

1. **No station is clickable; the 10 per-task agents are unreachable.** `audit_run.classify` resolves every impl/review agent's task to `?`. They get keyed under `byTask["?"]` (which no numbered station T1–T4 matches) *and* are excluded from the hub's `runLevel`. Live DOM: `document.querySelectorAll('.stationG.clickable').length === 0` of 4. The headline interaction — click a task station to read that task's implementer + reviewer — does nothing.
2. **`--embed` SNAPSHOT build is dead.** The baked transcript JSON contains literal `</script>` (agents edited `swarm_template.html` and wrote `re.search(r"<script>(.*?)</script>", html)`). `json.dumps` escapes neither `<` nor `/`, so the HTML parser closes the inline `<script>` at the first `</script>` inside the data. Console shows 6 `SyntaxError`s at `swarm.html:316`; the viewer engine never runs (no stations, `openDrawer` undefined). The "shareable, offline" mode is broken for exactly the kind of run that produces it.
3. **LIVE refresh clobbers expand/scroll.** The 2 s tick re-runs `renderInto`, which does `bodyEl.innerHTML = ""` and rebuilds, snapping every expanded event shut and resetting scroll — even on a finished run whose transcript bytes never change. Measured: `hidden:false` immediately after click → `hidden:true` after the next tick.

### Root cause of #1 (decisive detail)

The classifier's `TASK_HEAD = ### Task ([A-Za-z0-9]+):` assumes the task body header is inlined in the agent's first user message. It is not. The real engine prompt is a SAFETY preamble plus a single instruction:

> TASK: read your verbatim task text from the JSON file at `…/waves-….json` — in its "tasks" array, find the object whose `"id"` is `"2"` and use that object's "body" field…

So the task **id** is present in every per-task prompt as `"id" is "N"`, and the 6 run-level agents (setup, 3× merge, 2× critic) carry no such id. The existing `test_audit_run.py` fixtures use the synthetic `### Task N:` shape — which is **why the bug shipped**: the tests encode a prompt shape the engine never emits.

## Decisions (made during brainstorming, 2026-06-15)

1. **Classification: viewer-only, drift-safe regex.** Recover the task id from the real `"id" is "N"` instruction; keep `### Task N:` as a fallback. No engine changes; honors the "degrade to DEPICTION, never break a run" principle.
2. **Partition by task-id presence, not by role.** An agent with a resolved task id → its station; anything unresolved (or a role-misdetect) → the hub. No agent is ever orphaned. This is the durable safety net if a future engine reword defeats the regex (degrades to "everything on the hub," never to "lost").
3. **Live refresh: skip re-render when unchanged.** Smallest fix that makes finished runs (the common case) keep expand/scroll forever; a growing transcript still re-renders only when bytes actually change.
4. **Testability extractions.** Move the agent partition and the re-render decision into pure functions in `audit_project.js` so the UI logic is unit-tested, not buried untested in the template.
5. **Role-label detection left as-is** (cosmetic tab label only, given decision #2) — out of scope.

## Goals

- Clicking station T*N* opens that task's agents; clicking the hub opens run-level agents. Verified live: ≥1 clickable station, the 10 per-task agents reachable.
- `--embed` opens and renders offline with a `SNAPSHOT` badge, even when transcripts contain `</script>`, `<!--`, or the U+2028/U+2029 line separators.
- On a finished run, an expanded event and scroll position survive indefinitely under LIVE refresh.
- Each fix ships with a regression test built from the **real** prompt/transcript shapes — a test that would have caught the bug.

## Non-goals

- Improving impl-vs-review tab labels (decision #5).
- Append-only / state-preserving live rendering for growing transcripts (skip-if-unchanged is enough; see decision #3).
- Reading the run's `waves-*.json` for authoritative titles (often absent post-run; the prompt regex is sufficient).
- Any engine change, annotation, or write-back.

## Fixes

### Fix A — Stations classify by the real task signal

**Files:** `audit_run.py`, `render_viewer.py` (`build_index`), `swarm_template.html` (`audit` IIFE), `audit_project.js` (new `partitionAgents`).

1. `audit_run.py`: add `TASK_ID = re.compile(r'"id"\s+is\s+"([A-Za-z0-9]+)"')`. In `classify`, for impl/review roles resolve the task as `TASK_ID` → else `TASK_HEAD` (fallback) → else unresolved. Fixes both the advisory audit table and `render_viewer.build_index` (which calls `classify`).
2. `render_viewer.build_index`: emit `task: None` when unresolved — today `"?"` leaks through as truthy and is what orphans agents. Treat `"?" / "" / None` all as `None`.
3. Extract `partitionAgents(index) -> {byTask, runLevel}` into `audit_project.js`. Rule: **`a.task != null` → `byTask[a.task]`; else → `runLevel`** (no longer gated on `role ∈ {impl, review}`). The template's `audit` IIFE calls it.
4. Station/hub click wiring is unchanged; with real task ids, `byTask[t.id]` now matches.

### Fix B — `--embed` escapes inlined JSON

**Files:** `render_viewer.py` (`render`).

Add one helper and use it for every JSON blob inlined into the `<script>` (`AUDIT_INDEX`, `AUDIT_EMBED`, `DAG`, `THEME`):

```python
def _js_embed(obj):
    s = json.dumps(obj)
    for ch, esc in (("<", "\\u003c"), (">", "\\u003e"),
                    ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        s = s.replace(ch, esc)
    return s
```

`<` renders as `<` inside a JS string literal, so the data is byte-identical to the reader; the HTML parser simply never sees `</script>`. The two U+2028/U+2029 line-separator code points are legal mid-string in JSON but illegal in a JS string literal, so they must be escaped too. This also closes the same latent bug in the LIVE build's `AUDIT_INDEX.firstLine` (which escaped only by luck this run), and removes a mild stored-injection vector.

### Fix C — LIVE refresh skips unchanged re-renders

**Files:** `swarm_template.html` (`fetchAndRender`, `loadAgent`), `audit_project.js` (new `shouldRerender`).

Extract `shouldRerender(prevSig, text) -> {render: bool, sig}` into `audit_project.js` (signature = text length, or a cheap hash). In `fetchAndRender`, skip `renderEvents` when the fetched text matches the last rendered signature for the same agent; store the new signature otherwise. Reset the signature in `loadAgent` so switching agents always renders. The first (non-quiet) fetch always renders.

## Testing

Each test is built from the real shapes so it would have caught its bug.

- `tests/test_audit_run.py`: replace the synthetic `### Task N:` fixtures with the real prompt shape (`…read your verbatim task text from the JSON file … whose "id" is "N"…`). Assert `classify → impl:N / review:N`; run-level agents (merge/critic, no id) → no task; the `### Task N:` fallback still resolves.
- `tests/test_viewer.py`: render a run whose transcript content contains `</script>`, `<!--`, and a U+2028; assert the output HTML has exactly **one** `</script>` and that `AUDIT_EMBED` round-trips via `json.loads`. Assert per-task agents land in `byTask` and run-level in `runLevel` at the index level.
- `tests/audit_project_spec.mjs`: unit-test `partitionAgents` (task→station, unresolved→hub, run-level→hub) and `shouldRerender` (unchanged→skip, changed→render, agent-switch→render).

## Acceptance

Re-run today's verification against `wf_fa2b2a99-92f`:

1. `render_viewer.py --transcripts <run> --out /tmp/live` → served over http, ≥1 `.stationG.clickable`, clicking T2 opens the task-2 agents with `●`/`⚙`/`→`, badge `LIVE`.
2. `render_viewer.py --transcripts <run> --embed --out /tmp/embed` → opens with no console errors, hub/station drawers render, badge `SNAPSHOT`.
3. Expand an event under LIVE, wait > 2 s, confirm it stays open.
4. md5 of all transcripts unchanged before/after.

## Packaging

One marked plan (ultraplan). Fix B is pure-Python (`render_viewer.py` + `test_viewer.py`); Fixes A+C are the viewer JS (`audit_run.py`, `swarm_template.html`, `audit_project.js`) and share `swarm_template.html`/`audit_project.js`, so the writing-plans step groups or sequences them while running B in parallel, respecting worktree file-ownership. Bump plugin to **0.0.13**.
