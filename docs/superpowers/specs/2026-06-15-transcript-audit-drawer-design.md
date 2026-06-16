# Transcript audit drawer: read subagent transcripts from the swarm viewer

**Date:** 2026-06-15
**Scope:** Viewer only — `skills/ultrapowers/viewer/*`, `skills/ultrapowers/scripts/render_viewer.py`, docs, and new tests. **No engine change** (`waves.js` stays frozen). Transcripts and worktrees are read-only.

## Problem

An ultrapowers run spawns dozens of subagents. Each writes a full JSONL transcript — reasoning, every tool call, every result — to `~/.claude/projects/<project-slug>/<session-id>/subagents/workflows/<runId>/agent-<id>.jsonl`. These files are the only record of what the agents actually thought and did; the CLI `/workflows` view is just a progress tree.

Reading them today means parsing raw JSONL by hand. The files are 60–350 KB each and there are dozens per run (~10 MB total), so loading them is hostile to a human and unsafe for an assistant's context window. Two existing tools touch this data but neither lets you *read* it:

- `scripts/audit_run.py` — read-only effort *stats* (turns, tokens, tool counts, tier-misrank flags). No content.
- `scripts/render_viewer.py` + `swarm_watch.py` + `viewer/` — a live *progress* visualization (the DAG as a vector-monitor swarm, observed from git footprints). Never touches transcripts.

The gap: there is no way to read a subagent's reasoning and tool I/O at will.

## Decisions (made during brainstorming, 2026-06-15)

1. **Surface:** a browser viewer, integrated with the existing swarm viewer (not a CLI, not a standalone page).
2. **Integration depth:** a transcript **drawer that slides over the swarm map**. Stations and run-level agents become clickable; the map you watch *is* the index.
3. **Data mode:** **live from the start**, with **no duplicated content on disk**. The drawer fetches one raw transcript file on demand and projects it client-side; while open it re-fetches to stream new events.
4. **No projection drift, no migration.** Projection logic lives exactly once, in browser JS. Python does classification (metadata) and, for the optional offline export, dumb marshalling — never projection. No `node` dependency is added to the render path; the bilingual repo split (JS engine/browser, Python tooling) is kept.

## Goals

- Click a swarm station → read that task's implementer (and reviewer) transcript as prose: reasoning `●`, tool calls `⚙ name(input)`, results `→`.
- Click the hub → read run-level agents (setup, merge, reconcile, integration, unclassified).
- Live: an open drawer streams new events as the agent runs (`tail -f` in the UI).
- Self-contained offline export for sharing (`--embed`), openable via `file://`.
- Honest labeling of data provenance and parse failures, matching the viewer's existing honesty contract.
- Never load whole transcripts into an assistant's context: the human's browser consumes them; the render step streams files in Python and embeds only metadata (or, for `--embed`, bounded truncated content).

## Non-goals (v1)

- Cross-agent search or a unified timeline.
- Map-wide live transcript counts (the swarm map already shows live progress from git; the drawer live-tails only the open agent).
- HTTP Range incremental fetch (re-fetching the whole open file is cheap locally).
- Any annotation, editing, or write-back. Transcripts and worktrees stay read-only.
- Live wave attribution for merge agents (not reliably derivable from classification; merge agents attach to the hub).

## Architecture

Three units with a clean interface, plus docs. The Python side never implements projection — that is what keeps one projection implementation and adds no `node` dependency.

| Unit | File | Responsibility |
|---|---|---|
| **Projection module** | `viewer/audit_project.js` *(new; pure JS, zero deps)* | The only projection. Given an agent's event blocks, produce rendered items (`●` text / `⚙ tool(input)` / `→ result`), collapse/expand state, truncation, and block-level defensive handling (string vs array `content`, missing fields, unknown block types). Inlined verbatim into the output HTML at bake time; imported directly by the node test. |
| **Index / marshal step** | `scripts/render_viewer.py` *(extend)* | New flags `--transcripts <run-dir>` and `--embed`. Build the per-agent **index** (metadata only) by importing `audit_run.py`'s `first_user_text`/`classify`/`collect`. Create symlinks to the raw `.jsonl` in the out dir (live mode). Inline `audit_project.js`. For `--embed`, marshal each agent's content into bounded truncated JSON. Bake `AUDIT_INDEX`, `AUDIT_EMBED`, `AUDIT_JS` into the template. |
| **Drawer UI** | `viewer/swarm_template.html` *(extend)* | Drawer DOM; click handlers on stations, agents, and hub; data-mode badge; live-refresh loop; reduced-motion still view. New placeholders `/*__AUDIT_INDEX__*/null`, `/*__AUDIT_EMBED__*/null`, `/*__AUDIT_JS__*/`. |
| Docs | `viewer/README.md`, `SKILL.md` | Document `--transcripts`/`--embed`, data modes, honesty labels; one pointer in SKILL.md's post-run section beside the existing `audit_run.py` mention. |

### Index schema (baked `AUDIT_INDEX`)

Metadata only — no transcript content. Tiny (order of a few KB for ~43 agents):

```json
{
  "runId": "wf_268a37b9-a8f",
  "versions": ["2.1.177"],
  "agents": [
    {
      "id": "a687dc80b3983cb23",
      "file": "agent-a687dc80b3983cb23.jsonl",
      "role": "impl", "task": "6",
      "model": "claude-...", "turns": 31, "tools": 18, "outTokens": 12044,
      "firstLine": "I'll implement Task 6 (kb-staging.js) following the plan exactly...",
      "worktree": ".../.claude/worktrees/wf_268a37b9-a8f-25"
    }
  ]
}
```

`role` ∈ `{impl, review, setup, merge, reconcile, integration, unknown}`; `task` present only for `impl`/`review`. `firstLine` is the agent's first assistant text (truncated). `worktree` comes from `agent-<id>.meta.json`.

## Data flow

1. **Render:** `render_viewer.py <plan.md> --transcripts <run-dir> [--out DIR] [--embed]` — compiles the DAG (unchanged path via `compile_plan.py`), builds the index, inlines `audit_project.js`, writes `<out>/swarm.html`. Live mode also creates `<out>/agent-<id>.jsonl` symlinks into the read-only run dir (reading through a symlink does not mutate the target).
2. **Serve (live):** `cd <out> && python3 -m http.server` — the same one-liner the semi-live swarm already documents.
3. **Click:** the drawer fetches `./agent-<id>.jsonl` (one file, on demand) and projects it with `audit_project.js`.
4. **Live:** while open, the drawer re-fetches its file on an interval (~2 s) and renders appended events. No files are written; the symlink target is the single source of truth.
5. **Offline / shareable:** `--embed` bakes bounded truncated content into `AUDIT_EMBED`; `swarm.html` then opens via `file://` with no server and no symlinks.

`fetch()` is blocked on `file://` (the swarm viewer already relies on this for `status.json`). Therefore: live needs the local server; `file://` shows the map plus the index, and full drawer content only when `--embed` was used.

## Agent → station mapping

The classifier and the compiler share the exact regex `^### Task ([A-Za-z0-9]+):`, so a task id needs no translation.

- `impl:N`, `review:N` → station **Task N**. A station may hold an implementer and one or more reviewers; the drawer shows a small switcher when more than one agent maps to a station.
- `setup`, `merge`, `reconcile`, `integration`, `unknown` → **run-level**, listed when the hub is clicked. Merge agents attach to the hub (not to wave rings) by deliberate simplification.

## Projection and truncation

One shared cap constant governs both the JS projector and the Python `--embed` marshaller:

- assistant text: shown in full, capped ~8 KB with expand;
- tool input: collapsed to ~200 chars, expand to ~4 KB;
- tool result: collapsed to ~200 chars, expand to ~8 KB.

Beyond the hard cap, the drawer links to the raw file path and line rather than embedding more. In live mode the whole file is already fetched, so expand reveals already-in-memory text up to the cap. In `--embed` mode Python truncates at marshal time so snapshots stay bounded.

## Defensive parsing

Two layers, by where each runs:

- **Python (line level):** wrap each `json.loads` in try/except and skip unparseable lines; tolerate missing keys; collect the set of `.version` values seen and the count of unparsed lines.
- **JS (block level):** handle `content` as a string or as an array of `{type:"text", text}`; tolerate missing fields; render an unknown block type as a dim `‹unrecognized block: TYPE›` rather than dropping it silently.

## Data modes and honesty labels

The drawer header badge states provenance, mirroring the viewer's `OBSERVING`/`DEPICTION`/`SIGNAL LOST`:

- **`LIVE`** — fetching and refreshing from a served file.
- **`SNAPSHOT @ <time>`** — embedded content from `--embed`.
- **`STATIC`** — index only; no content available (serve over http, or re-render with `--embed`).

The footer notes `rendered under format vX · N unparsed lines` when relevant.

## File-level change list

- `skills/ultrapowers/viewer/audit_project.js` — new projection module.
- `skills/ultrapowers/viewer/swarm_template.html` — drawer DOM, handlers, badge, live loop, three new placeholders.
- `skills/ultrapowers/scripts/render_viewer.py` — `--transcripts`, `--embed`; index build (import from `audit_run.py`); symlink creation; JS inlining; `--embed` marshalling.
- `skills/ultrapowers/scripts/audit_run.py` — only if a helper must be extracted for clean reuse; behavior unchanged.
- `skills/ultrapowers/viewer/README.md`, `skills/ultrapowers/SKILL.md` — docs.

## Testing (tests-first)

- `tests/fixtures/audit_run/` *(new)* — a tiny synthetic run: implementer, reviewer, and merge agents plus edge cases (result-as-string, result-as-array, a malformed line, an unknown block type, a drifted `.version`, an attachment). Task ids align with `evals/fixtures/mixed/plan.md`.
- `tests/test_audit_project.mjs` *(new, node)* — projection of each block type; truncation and expand boundary; unknown-block and string-vs-array handling. Node precedent: `tests/sim_workflow.mjs`.
- `tests/test_viewer.py` *(extend)* — `--transcripts` render: placeholders replaced, drawer markup present, index baked, symlinks created (live) / content baked (`--embed`); mapping `impl:6 → station 6`.
- `tests/test_audit_run.py` *(extend)* — any helper extracted for reuse stays green.

## Future work (clean adds on this seam)

Cross-agent search/timeline; map-wide live counts via `swarm_watch.py`'s `status.json`; HTTP Range incremental fetch; wave attribution for merge agents.
