# The fold log

One JSONL file per wave, written by the frontier CLI and read back by
`frontier_fold.rehydrate(repo, log_path)`.

```
<runDir>/frontier/wave-<n>/fold_log.jsonl
```

`<n>` is **1-based**, matching the wave numbering the run reports. Everything else
the wave records lives beside it in the same directory.

The log is also **the authority for what has folded**. The wave's task list
is re-supplied to every CLI call — as `--branch <taskId>=<branch>:<headSha>`
triples, or as `--patch <taskId>=<file>` patches against the base (One Driver
Amendment 9), in task-index order and mixable; the recorded `fold` events must
be an `(id, headSha)` prefix of that list over the same `base`, or the call
refuses (`log/list disagreement`). For a patch task `headSha` is the **tree**
the patch yields over the base, derived afresh on every call, so a patch file
edited mid-wave is that same disagreement. `remaining` is the supplied list
minus that prefix, and **`complete` is derived, never recorded**: every task
folded and no narrated path left unresolved.

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

It is also a precondition on every branch head: `fold` and `resolve` refuse
(exit 2, nothing written) any task head the base is not an ancestor of. Each
task's state is published as a two-point diff against the base, so a head cut
from a stale ref would read as a revert of everything the base gained since —
folded, that silently reverted 3,472 lines of an integration line on a green
suite (#246). The engine's fallback, an ordinary three-way merge, handles a
stale parent correctly; the fold cannot. A patch task has no ancestry to
check: it is against the base by construction, and its refusal is the
patch-side one — a patch that does not apply over the base (exit 2, nothing
written, the task named on stderr).

### `fold` — one per task folded, in task-index order

```json
{"type": "fold", "task": "<task id>", "headSha": "<the task branch head>"}
{"type": "fold", "task": "<task id>", "headSha": "<the derived tree>", "patch": "<file>"}
```

`headSha` is what makes the log self-sufficient: the task's `TaskState` is
re-derived with `publish(base, repo, baseSha, headSha)` rather than stored.
The second form is a **patch task**: `headSha` is the tree sha
`repo_weave.apply_patch_tree(repo, baseSha, patch)` yields, and `rehydrate`
re-derives it from the file on every call (the tree object itself is
unreferenced and may be pruned — the file is the durable record), refusing
with `ValueError` if the file no longer yields the recorded sha.
Task-index order (not completion order) is what the CLI writes — completion
order is not observable to the engine, and K1 order-independence is exactly
what the self-checks assert, so determinism costs nothing.

Folding is **incremental**: the CLI stops at the first fold that opens a
conflict, so a partial log is the normal mid-wave state, not damage. A
`resolve` that completes the current stop continues folding and may append
further `fold` events in the same call.

### `resolve` — one per applied resolution

```json
{"type": "resolve", "path": "<path>", "epoch": 3, "lines": ["...", "..."]}
```

`lines` is the whole file, split by the kernel's own `split_lines` — so a file
with a final newline carries a trailing `""` entry, and the file materializes
byte-identical. `epoch` is the event count at which the narration was read.

**Validity is never re-checked on rehydration.** Live, `apply_resolution`
refuses a resolution whose path was touched by a fold or an earlier
resolution at or after its epoch — **the CLI then exits 2 and the engine
falls the wave back; there is no re-narration.** That refusal is the
idempotency guard: the resolve STEP is agent-driven, and a command re-issued
after its log append would otherwise re-apply stale whole-file lines *after*
the continued fold and silently clobber the next task's contribution. Every
narration is fresh against the frontier it was read off, because folding
stops at the conflict that opened it.

### Auto-union (the assume rung)

> **Producer status (2026-09-01, #390):** the CLI flag below is a supported
> contract and still works, but its only producer was the `Commutes:` plan
> marker, retired under the claims-v1 grammar — the engine now passes
> `--commutes` only for legacy-grammar plans that declare it. A run whose plan
> is claims-v1 never exercises this rung; conflicts there take ordinary
> dispatch. If fold metrics show the union optimization is missed, the measured
> case is for the engine deriving commutativity from diff shape (spec §1.2).

A `resolve` event is also what the CLI writes when it resolves a conflict
**itself**, with no resolver dispatch. `fold`/`resolve --commutes
<taskId>=<path1,path2,...>` (repeatable) declares a task's commutative paths.
When a conflict opens on a path that **every** writer declared — the incoming
task, plus every already-folded task whose `base..head` diff touches it — and
**every segment of every hunk is `added`**, the CLI applies the kernel's own
merged block body (marker lines dropped) through the same splice +
`apply_resolution` path a reply takes. Any `deleted` segment anywhere in the
conflict, any undeclared writer, or any non-`lines`/`add/add` kind falls back
to ordinary dispatch — with the one-line `contract:` header in the hunks file
whenever every writer declared, whether or not the union applied.

The safety ground is **weave-inertness**, not the self-checks: the union reply
byte-equals the frontier's current visible lines, and `update_state` is the
identity on visible-equal lines, so the live fold sequence stays equal to the
raw one the completion self-checks gate.

The event is an ordinary `resolve` — rehydrate, replay, the K-gates and the
epoch idempotency guard are untouched. What the auto-union adds is recorded
in two places, both outside the log:

- the `conflicts.json` entry gains `"autoResolved": true` and **keeps
  `dispatchable: true`**; its narration and hunks brief are still written, so
  the audit trail is unchanged;
- every `fold`/`resolve` stdout reply that carries `conflicts` also carries
  `"autoResolved": <int>` — the count auto-resolved **in that CLI call**, `0`
  when none.

A fold no longer stops on a conflict it auto-resolved: an auto-resolved entry
never appears in `open`, so a fold whose conflicts all union keeps folding.
Dispatch stops and parks are unchanged.

Recorded, that same resolution re-applies **unconditionally**: the log
records what actually applied, and re-deciding it would silently drop a
resolution the run really made. Rehydration appends resolve events to the
engine's event list, so the epoch clock reconstructs exactly — a
manifest-only comparison cannot see a desynced clock.

## One fact, one record

The fold log records what the merge state *did*. It is not the wave's
scratchpad:

- **conflicts and parks** — the narration files (`conflict-<i>.txt`), their
  hunk-scoped briefs (`conflict-<i>.hunks.txt`), every `dispatchable()`
  verdict including park reasons, and the `autoResolved` flag — live in the
  conflicts index beside the log;
- **fold sizing** — `fold_stats.json` beside the log, `{"maxLines": [...]}`,
  one entry per CLI call that folded: the largest text file that call merged.
  It is the one fact nothing else records, which is why it is a file of its
  own rather than a field in the log;
- **fallbacks** live in the engine's own run records; so do the CLI call
  count and wall time, which the CLI cannot see across processes.

Nothing is written to two places.
