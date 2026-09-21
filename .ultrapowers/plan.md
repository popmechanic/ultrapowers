# The factory's gate holds and its runs end cleanly: a check still red after the repair stops the merge, the repair's re-check is a row, a pair's label reads the later fold, and a done run closes its issue on the hub

**Grammar:** claims-v1

**Claim:** When I launch a plan on the factory and walk away, a run whose checks are still red after its one repair does not merge itself — it leaves its pull request open for me; the record shows the repair's re-check as its own row whether it held or not; a pair's label says how the later of its two folds actually went; and a run that finishes done closes its issue on the hub, so its sandbox is reaped within the hour instead of sitting until someone removes it. (elicited)
**Summary:** This makes the factory's own gate hold and its runs end cleanly. It exists because the first self-merging run merged with a blocking check still red (fixture run-36, n=1 run), and because no factory run has ever closed its issue on the hub, so every finished sandbox waits for a person (n=9 runs, 189–196 and fixture 36). After this run a red check stops a merge, the record says what the repair did, and a finished run cleans up after itself — which is what has to be true before the old engine is deleted.

**Goal:** Unblock cut two of the mow (map #1131): the factory is about to be the only gate, so its gate must hold and its runs must end. Three independent contracts, no edge between them: the fold check's second pass runs the plan's checks and both passes are numbered rows (#1172, #1170); `pair:label` reads the later-folded task and tells a union from a resolver (#1165); the boot reads the run's ids out of the launcher's real multi-line `kata.json`, so the close is sent, and says what the hub answered (#1176, its first and fourth items — the janitor's fallback and the close read-back stay on that issue).
**Closes:** #1172 #1170 #1165

**Tech Stack:** Node 24 ESM for the engine and its exams, no new npm dependency; bash for the boot, `python3` standard library where it parses JSON; the sha-pinned kernel through the engine's existing `kernel(...)` door, not edited.
Spec: none on disk — the four issues are the brief, and everything a worker needs is in its Context. The sandbox holds no spec.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- ':(glob)fleet/run-*.mjs' fleet/sandbox-boot.sh fleet/fleet-bootstrap.sh fleet/roles fleet/kata-client.mjs fleet/launch.mjs fleet/janitor.mjs skills/ultrapowers/kernel skills/ultrapowers/scripts
- A run merges only on mechanical facts: exit codes of exams and of the plan's own commands. No judgment of Jev's and no sentence of a worker's is part of the gate this plan tightens.
- Hub writes are never the run's failure: a close the hub refuses, a close that is skipped and a `leave` that fails are each one `board:` log line, and the run's state and exit code stay what they were.
- Publish is shell and models never run git: nothing in `factory/engine.mjs` talks to GitHub or the hub's close, and nothing in `factory/boot.sh` judges a task.
- Every reading a row records is a fact the engine computed — an exit code, a command, an id, an ordering — never prose.

### Task 1: The fold check's second pass runs the checks too, a check still red ends the run not-done, and both passes are numbered rows

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/engine.mjs`
- Test: `fleet/tests/test_factory_fold_recheck.mjs`

**Claim:** A run whose checks are still red after its one repair does not merge itself, and the record shows the repair's re-check as its own row whether it held or not. (derived)
Machine: M1. On a rig-driven `runEngine` whose one task's exam exits 0 and whose plan names one non-minor check that exits 1 on the folded tree and still exits 1 after the `impl:<id>:fold` re-attempt: the check's command is run under `bash -lc` at least twice — once before that dispatch and once after it — `events.jsonl` carries a `fold:unresolved` row whose `cmd` is that command and whose `exam` is `null`, and the run's result has `done` exactly `false`.
M2. On the same rig, when the `impl:<id>:fold` re-attempt makes the check exit 0: there is no `fold:unresolved` row and `done` is `true`.
M3. In both runs `events.jsonl` carries exactly two `fold:verify` rows for the task, the first with `attempt` exactly `1` and the second with `attempt` exactly `2`, in that order, each carrying `ran`; a fold check that is green on its first pass writes exactly one, with `attempt` `1`.

**Authorized-by:** #1172; #1170; the operator's signed Claim of 2026-09-21.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** You see this task body and nothing else, so everything shared is here. **What the sibling tasks do, and what they assume of the file you share:** one sibling also edits `factory/engine.mjs`, but only `foldIn`, `resolveConflicts`' return value and the `pair:label` block near the end of `runEngine`, plus `factory/pairs.mjs`; the other edits only `factory/boot.sh`. You edit `reverifyAfterFold` and nothing else in the file, so the two engine edits are in different functions and fold as text. **The defect (fixture run-36, 2026-09-21, engine `31a588bf`):** a blocking `Check:` exited 1 on both folded trees — rows `check:line … exit: 1, minor: false` then `fold:red` — each red bought the one re-attempt, both re-attempt patches were empty, and the run still answered `{"done":true}` and the boot merged it. The cause is in `reverifyAfterFold` (about line 1660–1746 of `factory/engine.mjs`): the first pass calls `runExamsAndChecks({ dir, exams, foldedTaskId, timeoutSeconds })`, which runs every touched exam and — when `policy.proofs.run_lines` is on — every entry of `compiled.checks` under `bash -lc` with `env.ULTRA_BASE` set, appends one `check:line` row per check, and folds a non-minor failure into `reds` as `{ kind: 'check', cmd, exit, out }`; but the second pass, after the `impl:<id>:fold` dispatch and its `foldIn`, is called with `includeChecks: false`, so a check red can never reach the `fold:unresolved` branch that sets `foldUnresolved = true` — and `done` is `adopted.length === tasks.length && !foldUnresolved`. Make the second pass run the checks exactly as the first does; a `(minor)` check stays recorded and never blocks, as today. `redEventFields(red)` already answers `{ exam: null, cmd: red.cmd }` for a check red — keep that shape for the `fold:unresolved` row. **The rows (#1170):** today the first pass appends `{ kind: 'fold:verify', task, ran }` and the second pass appends nothing unless it is still red, so a repair that held is read from an absence. Append the first pass's row with `attempt: 1` and one more `{ kind: 'fold:verify', task, ran, attempt: 2 }` for the second pass whether it is green or red; `ran` is what it is today, the exams' `[{task, exit}]` list. Change nothing else about the fold check — not `runRefold`, not `fold:red`, not the board post. **For the examiner — the rig.** No test on the tree drives `factory/engine.mjs` (earlier factory exams live on evidence tags), and `fleet/tests/_engine_helpers.mjs` drives a different, older module — do not use it. Build a small rig in the exam file itself: `import { runEngine, POLICY_PATH } from '../../factory/engine.mjs'` and `import { simEnv } from './_helpers.mjs'` (every child process gets `env: simEnv()`, never `process.env`). Call `runEngine({ plan, target, runDir, base, policy }, { sh, git, board, worker, compiled, log: () => {} })` where: `target` is a real tiny git repository the exam makes in a temp directory (one commit; `base` is its `HEAD`); `plan` is any small markdown file with a `### Task T1:` heading and a `Machine: M1.` line — it is never parsed, because `deps.compiled` is handed in; `policy` is a copy of the file at `POLICY_PATH` with `pairs.mode` set to `'off'` and `select.enabled` set to `false`, its `proofs` cell left as it is (`run_lines: true`); `compiled` is `{ launch_waves: [[{ id: 'T1', title: 'sample', depends_on: [], files: ['impl_note.txt'], testCmd: 'true', proofTests: [], proofRuns: [] }]], dag_edges: [], pairs: [], checks: [{ cmd: 'test -f fixed.txt', minor: false }] }`; `git` is `(argv, cwd) => stdout`, a real `git` that throws on a non-zero exit; `board` is `{ post: async () => null, factsFor: async () => '', setState: async () => null, settled: async () => null, states: async () => ({}) }`; `worker` is `async (opts) => { … return { result: { total_cost_usd: 0.01, result: 'ok' }, denials: [] } }` and never a model — it writes a real file into `opts.cwd` when `opts.role === 'implement'` (always `impl_note.txt`, so the task has a patch; and, for M2 only, `fixed.txt` when `opts.label` ends `:fold`); `sh` is `(cmd, argv, cwd, input, env) => spawnSync-shaped result` that records every call and passes it through to a real child process — except the kernel, which it answers itself: when `cmd === 'python3'` and `argv[0]` includes `fold_wave.py`, answer `fold` with `{ status: 0, stdout: JSON.stringify({ complete: true }) }` and answer `materialize` by cloning `target` to a scratch directory at the `--prev-head` sha, `git apply --binary` the patch file named in `--patch` (its value is `<id>=<patchfile>@<anchor>`; skip the apply when the file is empty), committing with `--allow-empty`, fetching that commit back into `target`, and answering `{ status: 0, stdout: JSON.stringify({ candidateSha: <that sha> }) }`. The engine runs a plan's check as `sh('timeout', [<seconds>, 'bash', '-lc', <cmd>], <clone dir>, undefined, { ULTRA_BASE })`, so "the check ran" is a recorded `sh` call whose `argv` includes `'-lc'` and the check's command; which pass a call belongs to is read from its position relative to the recorded `impl:T1:fold` worker dispatch (record one shared, ordered log of `sh` calls and worker dispatches). Read rows as `fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)`. The exam ends by printing `ALL TESTS PASSED` and exiting 0, and exits non-zero on the first failed assertion.

**Proof:**
- Test: `fleet/tests/test_factory_fold_recheck.mjs`
- Legs: (a) [M1] with a worker that never writes `fixed.txt`: among the recorded `sh` calls whose `argv` includes `'-lc'` and `'test -f fixed.txt'`, at least one comes before the `impl:T1:fold` dispatch in the shared log and at least one after it; the rows include one with `kind` `fold:unresolved`, `cmd` exactly `test -f fixed.txt` and `exam` exactly `null`; and the result's `done` is exactly `false`; (b) [M2] with a worker that writes `fixed.txt` on the dispatch whose label ends `:fold`: no row has `kind` `fold:unresolved`, and the result's `done` is exactly `true`; (c) [M3] in each of those two runs the rows with `kind` `fold:verify` and `task` `T1` are exactly two, their `attempt` values in order exactly `[1, 2]`, and each has an array `ran`; and in a third run whose `checks` is `[{ cmd: 'true', minor: false }]` the `fold:verify` rows are exactly one, with `attempt` exactly `1`, and no `impl:T1:fold` dispatch was recorded.

**Stale-if:**
- issue-closed: #1172

### Task 2: A pair's label reads the fold of whichever task folded later, and tells a union from a resolver

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/pairs.mjs`
- Modify: `factory/engine.mjs`
- Test: `fleet/tests/test_factory_pair_label.mjs`

**Claim:** A pair's label says how the later of its two folds actually went. (derived)
Machine: M1. `labelPair({ pair: { a: '4', b: '7' }, tasks, read, folds: { '4': 'resolved', '7': 'clean' }, foldOrder: ['7', '4'] })` answers `fold` exactly `'resolved'` — task `4` folded later, so its outcome is the pair's — and with `foldOrder: ['4', '7']` the same call answers `fold` exactly `'clean'`.
M2. With `foldOrder: ['7']` and `folds: { '7': 'parked' }` — only one of the pair ever reached the fold — `fold` is exactly `'parked'`; with `foldOrder: []` and `folds: {}` it is exactly `null`; and a call that passes no `foldOrder` at all answers what it answers today, `folds[pair.b]` or `null`.
M3. In `factory/engine.mjs`, `foldIn` records each task's outcome as the first that applies of `parked`, `resolved` (a resolver was dispatched for this fold), `union` (a union reply settled it and no resolver was dispatched), `clean`; it records the order tasks folded in; and the `pair:label` block hands `labelPair` that order as `foldOrder` and writes the answered `fold` on the row as it does today.

**Authorized-by:** #1165; the operator's signed Claim of 2026-09-21.

**Interfaces:**
- Consumes: none
- Produces: `labelPair({ pair, tasks, read, folds, foldOrder })`

**Context:** You see this task body and nothing else, so everything shared is here. **What the sibling tasks do, and what they assume of the file you share:** one sibling also edits `factory/engine.mjs`, but only `reverifyAfterFold` (the fold check's two passes and its `fold:verify` rows); the other edits only `factory/boot.sh`. You edit `foldIn`, what `resolveConflicts` reports back, and the `pair:label` block near the end of `runEngine` — different functions, so the engine edits fold as text. **The defect (run-195, 2026-09-18):** all ten `pair:label` rows read `fold: 'clean'` while task 4's fold onto `factory/engine.mjs` took a resolver (`resolve:4:…` among its dispatch labels) and was adopted. The pair rows exist so Jev's pair verdicts can be re-read against mechanical labels at n = 20 pairs; a label that reads `clean` for a resolved fold makes every pair look like a correct `fold` verdict. The cause is in `factory/pairs.mjs` `labelPair`, whose last lines are `const fold = folds && Object.prototype.hasOwnProperty.call(folds, pair.b) ? folds[pair.b] : null` — it always reads the pair's second NAME, and a pair's names are in plan order, not fold order: the later-folded task is the one whose fold met the other's edits. Give `labelPair` an optional `foldOrder` (task ids, earliest fold first): when it is an array, the pair's `fold` is `folds[x]` for whichever of `pair.a` and `pair.b` appears LATER in it (the only one present, when only one is; `null` when neither is or `folds` has no such key); when it is not passed, behave exactly as today. Compare ids as strings. Leave `calls` and everything else in `labelPair` alone. In the engine, `foldIn` (about line 1573) already keeps `foldOutcomes`, a `Map` it sets to `'parked'`, `'resolved'` or `'clean'` — `usedResolve ? 'resolved' : 'clean'`, where `usedResolve` is true whenever the kernel's first `fold` was incomplete. But `resolveConflicts` (about line 540–610) settles some conflicts with no resolver at all: when `unionPolicy.mode === 'live'` and Jev reads both sides as independent additions, it writes the union reply itself and appends a `{ kind: 'union', … }` row; only otherwise does it `dispatch({ role: 'resolve', … })`. Have it report whether it dispatched any resolver (for example by returning that beside the fold it already returns, or through a counter the caller passes in — your choice, keep it small), and have `foldIn` record `'resolved'` when one was dispatched, `'union'` when the fold needed `resolveConflicts` but no resolver was dispatched, `'clean'` when the first kernel `fold` was complete. Keep an array of task ids in the order `foldIn` set their outcome, and pass it as `foldOrder` where the `pair:label` block (about line 2013) calls `pairsMod.labelPair({ pair, tasks, read, folds })`. `runRefold` has its own call to `resolveConflicts` (about line 2144): keep it working with whatever return shape you choose. The row's keys stay `kind, a, b, calls, fold`. **For the examiner:** `labelPair` is a pure async function — the exam is `import { labelPair } from '../../factory/pairs.mjs'` and direct calls; `tasks` may be `[{ id: '4', proofTests: [] }, { id: '7', proofTests: [] }]`, `read` may be `async () => ''`, and a pair with no `symbol` key answers `calls: null`, which the exam does not assert. M3 says what the engine's code does and is read against the diff at landing; the exam carries no engine rig. The exam ends by printing `ALL TESTS PASSED` and exiting 0, and exits non-zero on the first failed assertion; any child process it starts gets `env: simEnv()` from `./_helpers.mjs` — it needs none.

**Proof:**
- Test: `fleet/tests/test_factory_pair_label.mjs`
- Run: grep -q "foldOrder" factory/engine.mjs
- Legs: (a) [M1] the call with `folds: { '4': 'resolved', '7': 'clean' }` and `foldOrder: ['7', '4']` answers an object whose `fold` is exactly `'resolved'`, and with `foldOrder: ['4', '7']` exactly `'clean'`; (b) [M2] with `foldOrder: ['7']` and `folds: { '7': 'parked' }` the `fold` is exactly `'parked'`; with `foldOrder: []` and `folds: {}` it is exactly `null`; and with no `foldOrder` key and `folds: { '4': 'resolved', '7': 'clean' }` it is exactly `'clean'`; (c) [M3] the `Run:` line — the engine names `foldOrder`, which it does not at BASE; what it records and hands over is read against the diff.

**Stale-if:**
- issue-closed: #1165

### Task 3: A done run's close reaches the hub — the boot reads the run's ids out of the launcher's real multi-line record, and says what the hub answered

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/boot.sh`
- Test: `fleet/tests/test_factory_boot_kata_ids.mjs`

**Claim:** A run that finishes done closes its issue on the hub, so its sandbox is reaped within the hour instead of sitting until someone removes it. (derived)
Machine: M1. `bash factory/boot.sh kata-ids <file>`, over a file holding byte for byte the record the launcher writes — `JSON.stringify(record, null, 2)` and a newline, the shape in this task's Proof — prints exactly `33 01M32D6HP5S5B3C99ZR0T9A6NW` and a newline on stdout and exits 0: the project's integer `id` and the RUN's `uid`, never the project's `uid`, which comes first in the file.
M2. The same command over the same record written on one line (`JSON.stringify(record)`) prints the same line and exits 0; over a file whose record has no `run` object, over a file that is not JSON, and over a path that does not exist, it prints nothing on stdout and exits 1.
M3. `bash factory/boot.sh` with no argument still prints a usage line on stderr and exits 2, and `bash -n factory/boot.sh` exits 0.
M4. `close_run` takes the project id and the run uid from that one reader; it writes one `board:` log line on every path — a skipped close says which of the two ids, or the file, was missing, a 2xx says `board: close answered <code>`, and the refused-close line stays what it is — and `board_down`'s line for a failed `kata federation leave` carries the first line of what `kata` itself printed.

**Authorized-by:** #1176 (its first and fourth items); the operator's signed Claim of 2026-09-21.

**Interfaces:**
- Consumes: none
- Produces: `boot.sh kata-ids <file>`

**Context:** You see this task body and nothing else, so everything shared is here. **What the sibling tasks do:** both siblings edit `factory/engine.mjs` and `factory/pairs.mjs` only; nobody else touches `factory/boot.sh`. **The defect (read on the hub and on run-36's sandbox, 2026-09-21):** no factory run has ever closed its run issue on the hub — runs 189 to 196 and fixture run-36 all read `status: open` (n=9 runs), where old-engine runs read `closed done` — so `fleet/janitor.mjs` reads every finished factory run as live, answers `nothing to do`, and the sandbox sits until a person removes it. `factory/boot.sh` `close_run` sends the close only when it can read a project id and a run uid out of `$FLEET_HOME/plans/$RUN_ID.kata.json`, and returns silently when it cannot. It reads the uid with `json_run_uid`: `grep -o '"run"[[:space:]]*:[[:space:]]*{[^}]*}' "$1" | head -n 1 | json_field uid`. `grep` is line-based, and `fleet/launch.mjs` writes that record as `JSON.stringify(record, null, 2)` — the `"run": {` line and its `}` are different lines — so the pattern never matches, the uid is empty, and the close is skipped without a word. Measured on run-36's own file with the boot's own helper: it reads `[]`; over the same bytes joined onto one line it reads `[01M32D6HP5S5B3C99ZR0T9A6NW]`. The boot's earlier exam passed because its fixture was `JSON.stringify({...})`, one line — the shape the launcher never writes. **The change:** one reader for both ids, parsing the file as JSON rather than grepping it — `fleet_python3` with the standard library is already how this script reads `factory/policy.json` (see `read_self_merge_policy`, about line 380), and every external program in this script goes through its `fleet_*` wrapper. Expose it as a second verb, `boot.sh kata-ids <file>`, printing `<project id> <run uid>` and exiting 0, or printing nothing and exiting 1 when the file is missing, is not JSON, or lacks either `project.id` (an integer) or `run.uid` (a non-empty string). The script's last line is `case "${1:-}" in boot) boot ;; *) printf 'usage: boot.sh boot\n' >&2; exit 2 ;; esac` — add the verb there; an unknown or missing verb still prints a usage line on stderr and exits 2. The verb must not need anything the boot sets up later: no network, no `$FLEET_HOME` contents, nothing but the file. The record is `{ url, project: { id, uid, name }, run: { uid, revision }, tasks: { "<id>": { uid, short_id, revision } } }` — note `project.uid` precedes `run.uid`, and each task has a `uid` too. `close_run` then reads both ids through that reader and drops `json_run_uid` and its `json_int id` read; its three silent `return 0`s (no file, no project id, no run uid) each become one `log "board: close skipped — …"` line naming what was missing; a 2xx answer logs `board: close answered <code>`; the existing `board: closing the run issue failed (exit …, http …)` line is unchanged; a run that did not end `done` still returns before any of this, silently, as today. The request itself — URL `$KATA_ADMIN_URL/api/v1/projects/<id>/issues/<run uid>/actions/close`, the `Idempotency-Key`, `retry_protocol: close-v1`, the `evidence` array, no `authorization` header — is correct and stays byte for byte (measured 2026-09-21: the hub validates that payload shape and answers 400 only when `evidence` is empty). `board_down` today runs `fleet_kata federation leave "$BOARD_PROJECT_NAME" >/dev/null 2>&1` and on failure logs `board: kata federation leave <name> failed — leaving the unit for the box to reap`: capture what `kata` printed and put its first line (at most 300 characters) in that log line, after the existing words; on run-36 that line carried no reason and the cause is still unread. Hub writes are never the run's failure: nothing here changes the run's state, its exit code or the order of `publish`. **For the examiner:** M1 to M3 are the exam — run the script as a child process, `spawnSync('bash', [<absolute path to factory/boot.sh>, 'kata-ids', <file>], { encoding: 'utf8', env: simEnv() })` with `simEnv` from `./_helpers.mjs`, and compare `stdout`, and `status`, exactly. Build the fixture from a JS object with `JSON.stringify(record, null, 2) + '\n'` so it is the launcher's shape by construction, and assert the fixture has more than one line so a later edit cannot quietly flatten it. M4 says what `close_run` and `board_down` log; it is read against the diff at landing, and the two `Run:` lines only pin that the words are there. Do not build a rig that drives `boot.sh boot` against stubs — it is not needed for any clause here. The exam ends by printing `ALL TESTS PASSED` and exiting 0, and exits non-zero on the first failed assertion.

**Proof:**
- Test: `fleet/tests/test_factory_boot_kata_ids.mjs`
- Run: bash -n factory/boot.sh
- Run: grep -q "board: close answered" factory/boot.sh
- Run: grep -q "board: close skipped" factory/boot.sh
- Legs: (a) [M1] the record below, written as `JSON.stringify(record, null, 2) + '\n'` to a temp file that the exam first asserts holds more than one line: `stdout` is exactly `33 01M32D6HP5S5B3C99ZR0T9A6NW\n` and `status` exactly `0`:

```json
{
  "url": "https://kata.int.exe.xyz",
  "project": {
    "id": 33,
    "uid": "01M2HSJCAB4WXJ7C6XEG23B869",
    "name": "popmechanic-tinyapp-fixture"
  },
  "run": {
    "uid": "01M32D6HP5S5B3C99ZR0T9A6NW",
    "revision": 1
  },
  "tasks": {
    "1": {
      "uid": "01M32D6JPS9P9K5S5KDBHKXTRV",
      "short_id": "xtrv",
      "revision": 2
    }
  }
}
```

  (b) [M2] the same record written as `JSON.stringify(record)`: the same `stdout` and `status` `0`; and for each of a record with its `run` key deleted, a file holding `not json`, and a path that does not exist: `stdout` exactly `''` and `status` exactly `1`; (c) [M3] the script run with no argument has `status` exactly `2` and a non-empty `stderr`, and the first `Run:` line — `bash -n` — exits 0; (d) [M4] the second and third `Run:` lines — the two log sentences are in the script; what writes them, and when, is read against the diff.

**Stale-if:**
- issue-closed: #1176
