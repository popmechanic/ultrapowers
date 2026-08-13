# The fold log

One JSONL file per wave, written by the frontier CLI and read back by
`frontier_fold.rehydrate(repo, log_path)`.

```
<runDir>/frontier/wave-<n>/fold_log.jsonl
```

`<n>` is **1-based**, matching the `heads/` slot convention. Everything else
the wave records lives beside it in the same directory.

## Self-sufficiency contract

**The log plus the repository are the whole record.** Each CLI invocation in a
wave is its own process and carries nothing in memory from the last one, so
every invocation begins by rehydrating:

```python
engine = frontier_fold.rehydrate(repo, run_dir / "frontier" / "wave-1" / "fold_log.jsonl")
```

`rehydrate` reconstructs the engine's `frontier`, its event list, its epoch
clock and its touched-path map — not merely the manifest. `fold` events
re-publish their task from the recorded `headSha`, which is a pure function of
git objects, so nothing about a task's contents is duplicated into the log.

Snapshot scoping is an ordering contract: derive **every** fold event's touched
set first (`git diff` base..head), union them, build the scoped base from that
union, **then** walk the events. A per-task streaming scope would misclassify a
path that a later task also touches as an `add/add` instead of a `modify`.

## Events

Exactly three types. One JSON object per line, in the order they happened.

### `base` — first line, exactly once

```json
{"type": "base", "sha": "<wave base sha>"}
```

The commit every task in the wave branched from. `rehydrate` refuses a log
that does not open with it. Otherwise inert: it seeds the engine and is
skipped by the event walk.

### `fold` — one per task folded, in task-index order

```json
{"type": "fold", "task": "<task id>", "headSha": "<the task branch head>"}
```

`headSha` is what makes the log self-sufficient: the task's `TaskState` is
re-derived with `publish(base, repo, baseSha, headSha)` rather than stored.
Task-index order (not completion order) is what the CLI writes — completion
order is not observable to the engine, and K1 order-independence is exactly
what the self-checks assert, so determinism costs nothing.

### `resolve` — one per applied resolution

```json
{"type": "resolve", "path": "<path>", "epoch": 3, "lines": ["...", "..."]}
```

`lines` is the whole file, split by the kernel's own `split_lines` — so a file
with a final newline carries a trailing `""` entry, and the file materializes
byte-identical. `epoch` is the event count at which the narration was read.

**Validity is never re-checked on rehydration.** Live, `apply_resolution`
refuses a resolution whose path was touched by a fold at or after its epoch,
and the caller re-narrates. Recorded, that same resolution re-applies
**unconditionally**: the log records what actually applied, and re-deciding it
would silently drop a resolution the run really made. Rehydration appends
resolve events to the engine's event list, so the epoch clock reconstructs
exactly — a manifest-only comparison cannot see a desynced clock.

## One fact, one record

The fold log records what the merge state *did*. It is not the wave's
scratchpad:

- **conflicts and parks** — the narration files and every `dispatchable()`
  verdict, including park reasons — live in the conflicts index beside the log;
- **fallbacks** live in the engine's own run records.

Nothing is written to two places.
