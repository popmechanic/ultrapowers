# The phase cell reads the run's own progress — a kata write failure is never the phase (#952)

**Grammar:** claims-v1

**Claim:** do: open a run's status page or the Viz index while the hub proxy is failing its writes. see: the phase cell still names the wave and the worker or driver step the run is on, never a kata, transcript, log or capture line. (elicited)
**Summary:** This makes the status page's phase cell report only what the run itself is doing. It exists because during run-114 the page and the Viz index read a failed hub write as if it were the run's phase, the moment the proxy started answering 502s. After this run a glance at the page tells you which wave and which worker the run is on, and a bookkeeping hiccup never dresses itself up as progress.

**Goal:** #952 — the boot script's `sub` projection (the `· <sub>` half of `status.json`'s `phase`) takes, when no worker is open, the kind of the last `driver:*` or `worker:*` event after the last `engine:phase`, skipping `kata:*`, `transcript:*`, `engine:log` and `capture:*` lines, and stays null when only skipped kinds follow the phase; `fleet/CONTRACT.md`'s status-cell sentence names the excluded kinds. The `tasks` projection, the engine and the Viz page are untouched.
**Closes:** #952

**Tech Stack:** bash + Python 3 (`fleet/sandbox-boot.sh`, its `project_read` python block), Node 24 ESM sims under `fleet/tests/`, Markdown (`fleet/CONTRACT.md`).

**Exam command:** node {paths}

**Spec:** #952 (its desired-state paragraph is the whole spec; the facts a worker needs are in Context).

**Parallelization rationale:** one wave, one task — a single projection rule, its contract sentence and the sim that pins it are one surface and fold as one patch; there is no second contract to split off.

## Global Constraints

- The engine, the worker and the confine hook are exactly what they are at BASE: this change lives in the boot script's projection and its contract sentence only.
- Check: git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/run-worker.mjs fleet/run-waves.mjs fleet/confine-hook.mjs
- The `project` verb still reads and writes nothing: `bash fleet/sandbox-boot.sh project <events.jsonl> [<args.json>]` prints the projection and leaves the tree as it found it.
- Check: git diff --quiet $ULTRA_BASE -- fleet/roles/

### Task 1: The sub-phase skips bookkeeping kinds

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_sandbox_boot_viz.mjs`

**Claim:** The projection skips event kinds that are not the run's own progress — `kata:*`, `transcript:*`, `engine:log`, `capture:*` — and takes the last `driver:*`/`worker:*` kind instead (or the last `engine:phase` alone when none has landed since). (quoted from #952)
Machine: M1. For each trailing kind of `kata:write-failed`, `transcript:slice`, `engine:log` and `capture:dropped`: a log of an `engine:phase`, then `worker:start impl:1`, then `worker:end impl:1`, then one event of that kind, projects `sub` as `worker:end`. M2. A log of an `engine:phase` followed only by a `kata:write-failed` and a `transcript:slice` projects `sub` as `null`. M3. A log of an `engine:phase`, `worker:start impl:2` with no later `worker:end impl:2`, then a `kata:write-failed`, projects `sub` as `impl:2`. M4. The three prefixes the sim's case (c) already pins read as they do at BASE: the prefix ending at line 13 projects `driver:wave-adopted`, the full fixture projects `impl:2`, the `engine:phase` line alone projects `null`. M5. `fleet/CONTRACT.md`'s `**status.json:**` bullet, in its sub-phase sentence, names `kata:*`, `transcript:*`, `engine:log` and `capture:*` as the kinds the projection skips, and says the kind taken is the last `driver:*`/`worker:*` one.

**Authorized-by:** #952

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The projection is the python heredoc inside `project_read` in `fleet/sandbox-boot.sh` (the block under the comment "The sub-phase: the label of the most recent worker still running, else the kind of the last event when the log has moved past its last `engine:phase`"): it computes `phase_at` as the index of the last `engine:phase` and, when `phase_at < last`, sets `sub` to `events[last]["kind"]`. The rule that replaces it: walk the events after `phase_at` from the end and take the first whose kind starts with `driver:` or `worker:`; none found means `sub` stays `None`. The open-label rule above it is untouched — an open worker label still wins over any trailing event (M3). Kinds the engine writes to `events.jsonl` that are not progress: `kata:write-failed` (#934, the hub write that failed and was not fatal), `transcript:slice`, `transcript:missing`, `engine:log`, `capture:dropped`, `capture:error`; `resolver:reply` is neither and is skipped too. The `project` verb of the boot script prints the same projection for any log, and the sim's `project(logPath)` and `plant(text)` helpers in `fleet/tests/test_sandbox_boot_viz.mjs` call it; its `ev(n, body)`, `start(n, label, role)` and `end(n, label, role)` helpers and its fixture `B` (fourteen lines, an `engine:phase` first, `driver:wave-adopted` at line 13, `impl:2` opened at line 14) are what a new case builds on. The exam extends that file at case (c)'s surface — new cases under a comment naming this task, the existing fourteen cases unchanged — and the file is guarded, so it merges with the patch. The status bullet in `fleet/CONTRACT.md` is the `- **status.json:**` bullet; its sub-phase sentence today reads "either the label of the most recent worker still running or the kind of the last event — otherwise"; case (f) of the sim greps that bullet for `· <sub>` and the eight state names, which must survive the edit. The Viz page at ultraviz reads `phase` as text and needs no change.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_viz.mjs`
- Guard: `fleet/tests/test_sandbox_boot_viz.mjs`
- Legs: (a) for each of `kata:write-failed`, `transcript:slice`, `engine:log` and `capture:dropped` as the trailing line after `engine:phase`, `worker:start impl:1`, `worker:end impl:1`: `project(...).sub` equals `worker:end` and does not equal that trailing kind [M1]; (b) `engine:phase` then `kata:write-failed` then `transcript:slice` alone: `project(...).sub` is `null` [M2]; (c) `engine:phase`, `worker:start impl:2`, `kata:write-failed`: `project(...).sub` equals `impl:2` [M3]; (d) the sim's existing case (c) assertions still hold — the prefix of `B` ending at line 13 projects `driver:wave-adopted`, the full `B` projects `impl:2`, and the `engine:phase` line alone projects `null` [M4]; (e) the `**status.json:**` bullet of `fleet/CONTRACT.md`, read as one line, matches `kata:\*.*transcript:\*.*engine:log.*capture:\*` and matches `driver:\*./.worker:\*` — the driver runs the `Test:` sim as the exam command, and the sim greps the bullet with `sed -n` scoped to it [M5].
- Run: node fleet/tests/test_sandbox_boot_viz.mjs 2>&1 | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- issue-closed: #952
- path-absent: `fleet/tests/test_sandbox_boot_viz.mjs`
