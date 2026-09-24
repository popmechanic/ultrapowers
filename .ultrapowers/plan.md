# The ten live-path defects of the 2026-09-24 review are closed, each proven by a probe

**Grammar:** claims-v1
**Claim:** do: launch this plan; see: the ten live-path defects the 2026-09-24 review found are closed and each is proven by a probe — a worker's run_proof tool answers with its probes' exit codes instead of "unavailable", the janitor never deletes a live run's VM because a colliding launch took its number, one task's crash parks that task and the rest of the run finishes, a plan's Bootstrap line runs as one shell command, a referee cannot write, a consumer never builds on a tree a sibling's fix worker is still editing, a fold re-attempt never marks an adopted task failed, the engine's own interface.settled write reaches the board, and the process-wide writeFileSync patch is gone. (elicited)
**Summary:** The review read every line of the engine and the fleet tools and found ten places where a run can lie, stall or die on a path no sim covers: the worker's proof tool always refused, the janitor could reap a live run, one thrown error could abort every in-flight task. This plan closes each one as its own task with a probe that would fail if the defect came back, and touches nothing the review did not name. After it merges, a run's record says what actually happened and a colliding launch can no longer cost you a live VM.
**Goal:** `factory/engine.mjs` hands `proofRuns` to the worker's tool server, parks a task on any throw inside its landing, resolves a producer's candidate only after the last worker has left its clone, runs the plan's Bootstrap line through `bash -lc`, marks no adopted task `parked` on a fold re-attempt, shares one Kata client between board, tools and its own `interface.settled` write, and no longer patches `fs.writeFileSync`; `factory/worker.mjs` honours `readOnly`; `fleet/kata-client.mjs` gains `runIssueOf`, the one rule the janitor and the board reader use to find a run's issue, and `fleet/launch.mjs` stamps the run issue with its plan sha.
**Tech Stack:** Node 22 ESM, the factory's own sims under `fleet/tests/` (`node <sim> | grep -q 'ALL TESTS PASSED'`), pytest bridge unchanged.
**Bootstrap:** true
**Spec:** the review at `docs/superpowers/specs/2026-09-24-whole-codebase-review.md` (laptop only; every fact a task needs is in its Context), findings C1, C2, E1–E6, E8 (E7 landed in #1281).
**Target:** popmechanic/ultrapowers at `b891ddd9fa1805262ed23d8b831cc76bbe1e5103` (main, 2026-09-24).

## Global Constraints

- Check: python3 -m pytest -q tests/test_fleet_suite.py -k factory
- Check: git diff --quiet $ULTRA_BASE -- factory/policy.json factory/questions.json factory/roles factory/boot.sh skills hooks tests
- A judgment is a question, never a sentence or a regex; nothing here asks one — every rule added reads mechanical facts.
- No new sim is written and no existing sim is edited: the plan's probes and the thirteen factory sims are the proof.

### Task 1: The worker's run_proof tool gets the task's probes

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `factory/engine.mjs`

**Claim:** do: dispatch an implementer for a task that has `Run:` lines; see: when it calls `run_proof` it gets one exit code per line back, not "run_proof unavailable". (derived)
Machine: M1. The `task` object `factory/engine.mjs` hands to `tools({ … })` in `mcpServersFor` carries a `proofRuns` key whose value is the task's own `proofRuns` array (the `lines` the enclosing function already computed), beside `id`, `uid` and `files`.
M2. `node --check factory/engine.mjs` exits 0 and `fleet/tests/test_factory_tools.mjs` prints `ALL TESTS PASSED`.

**Authorized-by:** review 2026-09-24 finding C1 (`factory/engine.mjs:1296` / `factory/tools.mjs:200`); map #1248 (cut three: a run's proof is its probes).

**Interfaces:**
- Consumes: `makeHandlers({ kata, projectId, task, candidates, board, runProof })`
- Produces: none

**Context:** At BASE `factory/engine.mjs` (2,401 lines, `git hash-object` `e5772aeaf05a06fa6870074a8d50a5b2fee2251d`) builds a worker's tool server in `const mcpServersFor = async (taskId, cwd, label, anchor) => {…}` near line 1266: it computes `const lines = Array.isArray(task && task.proofRuns) ? task.proofRuns : []`, builds `runProof` over them, and then calls `tools({ task: { id: taskId, uid: uidFor(taskId), files: task && task.files }, candidates: candidatesFor, board, runProof })`. `factory/tools.mjs:199-201` gates the tool on `task.proofRuns`: `const lines = (task && task.proofRuns) || []; if (!lines.length || typeof runProof !== 'function') return say('run_proof unavailable')`. Because the object never carries `proofRuns`, every call since cut three answered `run_proof unavailable` and implementers shelled the probes out, which the engine records as `{ via: 'bash', exit: null }` — the blind spot the tool exists to close. The fix is one key: `task: { id: taskId, uid: uidFor(taskId), files: task && task.files, proofRuns: lines }`. `tools.mjs` is not changed. `fleet/tests/test_factory_tools.mjs` imports `makeHandlers` and `candidatesOf` only and does not exercise `mcpServersFor`, so it stays green either way; it is the run-wide smoke for the file.

**Proof:**
- Run: sed -n '/const server = await tools({/,/})/p' factory/engine.mjs | grep -q "proofRuns: lines" [M1]
- Run: node --check factory/engine.mjs && node fleet/tests/test_factory_tools.mjs | grep -q 'ALL TESTS PASSED' [M2]
- Legs: (a) the `tools({…})` call's `task` object names `proofRuns: lines` [M1]; (b) the file parses and the tools sim passes [M2].

**Stale-if:**
- path-absent: `factory/tools.mjs`

### Task 2: A run's issue is found by run and plan, open first, so the janitor never reads a colliding launch's abandoned issue as the live run

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/kata-client.mjs`
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/board-read.mjs`
- Modify: `fleet/launch.mjs`

**Claim:** do: launch two plans on one target close enough together that both take the same run number, so the loser refiles under the next number and closes its first issue `wontfix`; see: the janitor still reads the winner's issue as the run's issue, never the loser's abandoned one, and does not reap the winner's VM. (derived)
Machine: M1. `fleet/kata-client.mjs` exports `runIssueOf(issues, run, plan)`: over the elements of `issues` whose `metadata.run` reads as the number `run` and whose `metadata.task` is `undefined`, it answers the first by this preference — when `plan` is a string, an element whose `metadata.plan === plan` over one whose `metadata.plan` is another string; then `status === 'open'` over closed; then a closed element whose `closed_reason !== 'wontfix'` over one whose `closed_reason === 'wontfix'` — and `null` when no element qualifies; an element whose `metadata.plan` is undefined is never excluded by the plan preference.
M2. `fleet/janitor.mjs` and `fleet/board-read.mjs` each import `runIssueOf` from `./kata-client.mjs` and find a run's issue through it: neither file contains the text `Number(i.metadata?.run) === run` or `isRunIssueFor`, and the janitor hands `runIssueOf` the `plan=` sha of the VM's assignment comment when the comment carries a 40-hex one, `null` otherwise.
M3. `fleet/launch.mjs`'s run-issue `createIssue` metadata carries `plan: planSha` beside `run`, `target`, `base` and `closes`.
M4. `node --check` exits 0 on all four files, and `fleet/tests/test_launch_duplicate.mjs` and `fleet/tests/test_board_read.mjs` each print `ALL TESTS PASSED`.

**Authorized-by:** review 2026-09-24 finding C2 (`fleet/janitor.mjs:351`, `fleet/launch.mjs:1402-1408,1772`, `fleet/board-read.mjs:175`); CLAUDE.md §Doctrine "Run in parallel" (concurrent launches are documented practice); #1036 (the duplicate-launch guard).

**Interfaces:**
- Consumes: none
- Produces: `runIssueOf(issues, run, plan) -> issue | null`

**Context:** At BASE (`fleet/janitor.mjs` 881 lines, `5bb8702a…`; `fleet/board-read.mjs` 362 lines, `f80fc7cb…`; `fleet/launch.mjs` `759cb448…`; `fleet/kata-client.mjs` has no `import` line and exports `makeKataClient`, `httpTransport`, `sshTransport` among others). The race: `launch.mjs` files the run issue with `metadata: { run: n, target, base, closes: planClosesOf(planText) }` and `idempotencyKey` `<target>:<planSha>:run-<n>` (line 1772) before `pushPlan` reserves N by push; when the push is refused because another launch took N, `kataBump` (line 1402) closes that issue with `reason: 'wontfix'` and the launch refiles under N+1. Two issues now carry `metadata.run === N`: the loser's, closed wontfix, and the winner's, open and live. `janitor.mjs:351` reads `issues.find((i) => i && typeof i === 'object' && Number(i.metadata?.run) === run) ?? null` — first match in the hub's listing order — and `readingOfIssue` (line 305) turns a closed issue into `finished: true, state: 'wontfix'`, after which the reap (`reapPlan`, line 182, one hour after `closed_at`) removes the winner's VM. `board-read.mjs:175` `isRunIssueFor(issue, n)` has the same ambiguity (it does exclude task issues: `meta.task !== undefined` is false). The janitor already parses the VM comment: `assignmentOf(row)` (line 442) calls `parseComment(row.comment)` and returns `{ run, target }`; the comment carries `plan=<40-hex>` (CONTRACT §Comment), so `assignmentOf` can return `plan` too (the field when it matches `/^[0-9a-f]{40}$/`, else `null`) and `readingFor(target, run)` (line 337) becomes `readingFor(target, run, plan)`, passing it to `runIssueOf(issues, run, plan)`. Put `runIssueOf` in `kata-client.mjs` because both readers already import from it and it is the hub's own shape. Shape of a listing element, as `listIssues` answers it: `{ id, uid, short_id, status: 'open'|'closed', closed_reason?: 'done'|'wontfix', closed_at?, updated_at, metadata: { run?, task?, plan?, … } }`. The preference order in M1 is: plan match (when a plan is given and the element names one), then open, then closed-not-wontfix, then whatever is left, first in listing order within a tier. Keep the `?? null` fallbacks the readers have. `test_launch_duplicate.mjs` drives `launch()` and `janitor()` with fakes and does not pin the run issue's metadata keys; `test_board_read.mjs` imports `board-read.mjs` dynamically and feeds it a fake hub whose run issues carry `metadata.run` only, so M1's "plan undefined is never excluded" is what keeps it green.

**Proof:**
- Run: node -e "import('./fleet/kata-client.mjs').then((m) => { const f = m.runIssueOf; const bad = (l) => { console.log('red', l); process.exit(1) }; const w = { id: 1, status: 'closed', closed_reason: 'wontfix', metadata: { run: 7 } }; const o = { id: 2, status: 'open', metadata: { run: 7 } }; const d = { id: 3, status: 'closed', closed_reason: 'done', metadata: { run: 7 } }; const t = { id: 4, status: 'open', metadata: { run: 7, task: '1' } }; if (f([w, o], 7, null).id !== 2) bad('open over wontfix'); if (f([w, d], 7, null).id !== 3) bad('done over wontfix'); if (f([t, w], 7, null).id !== 1) bad('task issue excluded'); if (f([o], 8, null) !== null) bad('no match is null'); const pa = { id: 5, status: 'open', metadata: { run: 7, plan: 'a'.repeat(40) } }; const pb = { id: 6, status: 'open', metadata: { run: 7, plan: 'b'.repeat(40) } }; if (f([pa, pb], 7, 'b'.repeat(40)).id !== 6) bad('plan match first'); if (f([pa, o], 7, 'b'.repeat(40)).id !== 5) bad('unnamed plan never excluded, listing order kept'); if (f([w, pb], '7', 'b'.repeat(40)).id !== 6) bad('numeric run string'); })" [M1]
- Run: grep -q "runIssueOf" fleet/janitor.mjs && grep -q "runIssueOf" fleet/board-read.mjs && ! grep -q "Number(i.metadata?.run) === run" fleet/janitor.mjs && ! grep -q "isRunIssueFor" fleet/board-read.mjs && grep -q "from './kata-client.mjs'" fleet/janitor.mjs && grep -q "from './kata-client.mjs'" fleet/board-read.mjs [M2]
- Run: grep -A1 "metadata: { run: n, target, base" fleet/launch.mjs | tr '\n' ' ' | grep -q "plan: planSha" [M3]
- Run: node --check fleet/kata-client.mjs && node --check fleet/janitor.mjs && node --check fleet/board-read.mjs && node --check fleet/launch.mjs && node fleet/tests/test_launch_duplicate.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_board_read.mjs | grep -q 'ALL TESTS PASSED' [M4]
- Legs: (a) over seven fixture listings the rule prefers open over wontfix, done over wontfix, excludes a task issue, answers null on no match, prefers the plan match, never excludes an element that names no plan, and reads a numeric string run [M1]; (b) both readers import and call `runIssueOf` and neither carries its old inline match [M2]; (c) the run issue's metadata names `plan: planSha` [M3]; (d) the four files parse and the two sims pass [M4].

**Stale-if:**
- path-absent: `fleet/board-read.mjs`

### Task 3: A throw inside one task's landing parks that task and never the run

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/engine.mjs`

**Claim:** do: run a plan where one task's clone hits a git or filesystem error mid-landing (an index.lock, a clone that is not at BASE); see: that one task is parked with the error's words on its `parked` row and every other task lands and folds as usual. (derived)
Machine: M1. The `catch (err)` that closes `land`'s body in `factory/engine.mjs` no longer rethrows: it contains no `throw err`, and for an error without `bootstrapRed` it returns the same dead-carrying shape the bootstrap park returns, with `dead` beginning `landing threw: ` followed by the error's `stack` when it is a string, else its message, cut to 1500 characters.
M2. The bootstrap park keeps its shape: an error with `bootstrapRed` still returns `dead` beginning `bootstrap failed in `.
M3. `node --check factory/engine.mjs` exits 0 and `fleet/tests/test_factory_retry.mjs` and `fleet/tests/test_factory_refold_dispatch.mjs` each print `ALL TESTS PASSED`.

**Authorized-by:** review 2026-09-24 finding E2 (`factory/engine.mjs:1521,2003`); the engine's own M4 comment at line 1351 ("not an exception that should escape `land()` and crash the whole run").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `land` runs from line 1344 to 1526 of `factory/engine.mjs` (hash `e5772aea…`). Its body is wrapped `try { … } catch (err) { if (!(err && err.bootstrapRed)) throw err; const { clone, exit, tail } = err.bootstrapRed; const reason = 'bootstrap failed in ' + clone + ': exit ' + exit + (tail ? '\n' + tail : ''); return { task, k, anchor, dead: reason, wall_ms: Date.now() - t0 } }` (lines 1519-1525). Everything else inside can throw: `git(['add', '-A'], best.dir)` in `candidateCommitFor` (line 764) on an index.lock, `cloneAtBase`'s "is at X, not BASE" refusal, `fs.readFileSync` of a patch, `capture`. The main loop (line 2003) does `const { id, landing } = await Promise.race([...inflightLandings.values()])` with no guard, so a rejection ends `runEngine`, every other in-flight landing is orphaned (their later rejections become unhandled), and the boot publishes a draft with nothing folded since. The fix is in the catch alone: `if (err && err.bootstrapRed) { …the existing three lines… } const text = err && typeof err.stack === 'string' ? err.stack : String((err && err.message) || err); return { task, k, anchor, dead: ('landing threw: ' + text).slice(0, 1500), wall_ms: Date.now() - t0 }`. The main loop already turns a `dead` landing into a `parked` row, a board post and `parked.add(id)` (lines 2007-2011), so nothing there changes. A rate-limit halt is untouched: `retrying`'s process-wide `halted` still parks through `isRateLimited(best.error)` inside the no-patch branch. The two sims named in M3 both drive `runEngine` with fake deps and are the closest smoke to the landing loop.

**Proof:**
- Run: sed -n '/const land = async (task, anchor) => {/,/^  }$/p' factory/engine.mjs > /tmp/land.txt && test "$(grep -c 'throw err' /tmp/land.txt)" = 0 && grep -q "landing threw: " /tmp/land.txt [M1]
- Run: sed -n '/const land = async (task, anchor) => {/,/^  }$/p' factory/engine.mjs | grep -q "bootstrap failed in " [M2]
- Run: node --check factory/engine.mjs && node fleet/tests/test_factory_retry.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_factory_refold_dispatch.mjs | grep -q 'ALL TESTS PASSED' [M3]
- Legs: (a) `land`'s text has no `throw err` and names the `landing threw: ` prefix [M1]; (b) `land`'s text still names the `bootstrap failed in ` prefix [M2]; (c) the file parses and the two engine sims pass [M3].

**Stale-if:**
- path-absent: `factory/retry.mjs`

### Task 4: A producer's candidate is offered to consumers only after the last worker has left its clone

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/engine.mjs`

**Claim:** do: run a plan where a consumer starts early on a producer's candidate and the producer's landing goes on to a re-dispatch or a referee fix in the same clone; see: the consumer's clone is cut from the tree as it stood after that last worker finished, never from a tree a worker was still editing, and a consumer whose producer died before producing a candidate is parked rather than left waiting. (derived)
Machine: M1. In `factory/engine.mjs`, `candidateDeferred(task.id).resolve(` is called from exactly one place inside `land`, in a `finally` block that closes `land`'s `try`, after the `if (wantsReferee) {` block in file order; it resolves with `{ dir: best.dir, patch: best.patch }` when a candidate was selected and with `null` otherwise.
M2. `candidateCommitFor` throws when the resolved value is `null` (an `Error` whose message contains `no candidate`), and `launchOnCandidate` catches a rejected `candidateCommitFor` and settles the consumer's in-flight landing as `{ id: task.id, landing: { task, dead } }` with `dead` beginning `no candidate`, so a consumer waiting on a dead producer parks instead of rejecting the main loop's race.
M3. `node --check factory/engine.mjs` exits 0 and `fleet/tests/test_factory_refold_dispatch.mjs` prints `ALL TESTS PASSED`.

**Authorized-by:** review 2026-09-24 finding E3 (`factory/engine.mjs:1407` vs `1445-1508`, `764-770`); #1273 (run-232: the early start is conditional on an unmoved head).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE (hash `e5772aea…`) `land` selects `best` (line 1400), then `candidateDeferred(task.id).resolve({ dir: best.dir, patch: best.patch })` (line 1407, "a one-shot resolution, unmoved by any later re-dispatch or fix"), then may run a re-dispatch worker in `best.dir` (lines 1445-1453, `cwd: best.dir`) and a referee-fix worker in `best.dir` (lines 1497-1506). A consumer's `candidateCommitFor(producerId)` (line 762) is `candidateDeferred(producerId).promise.then((best) => { git(['add', '-A'], best.dir); git([… 'commit' …], best.dir); … git(['fetch', best.dir, sha + ':refs/factory/cand-' + producerId], target); return sha })`, so it commits whatever is in `best.dir` the moment the deferred resolves — a half-written tree when a second worker is mid-edit, and a `git add -A` that can itself throw against a worker's own git-free writes. The fix: declare `let best = null` before the `try` (the current `let best = candidates[0]` inside becomes an assignment), remove the resolve at line 1407, and add `finally { candidateDeferred(task.id).resolve(best ? { dir: best.dir, patch: best.patch } : null) }` after the `catch`; because every re-dispatch and fix assigns `best = { ...remeasured }` before `land` returns, the `finally` sees the final candidate. Task 3 edits the same `catch` (text folds; the `finally` is new lines after it). In `candidateCommitFor`, the `.then((best) => {` begins `if (!best) throw new Error('no candidate: task ' + producerId + ' landed without one')`. The consumer's wait is outside `land`: `launchOnCandidate` (line 1832) sets `inflightLandings` to `candidateCommitFor(producerId).then(async (anchor) => { anchorOf.set(task.id, anchor); appendEvent({ kind: 'dispatch:on-candidate', … }); const landing = await land(task, anchor); return { id: task.id, landing } })`, so a rejection there would reject the main loop's `Promise.race` and end the run. Append `.catch((err) => ({ id: task.id, landing: { task, k: 1, anchor: null, dead: ('no candidate from task ' + producerId + ': ' + String((err && err.message) || err)).slice(0, 1500), wall_ms: 0 } }))` to that chain; the main loop's `landing.dead` branch then parks the consumer. The early-start clock cost is the re-dispatch/fix wall for producers that take one; the speculation policy (`speculate.on_candidate`) is untouched. The refold_dispatch sim imports `makeRefoldDispatch` and drives `runEngine` with fakes and is the smoke.

**Proof:**
- Run: test "$(grep -c 'candidateDeferred(task.id).resolve(' factory/engine.mjs)" = 1 && r=$(grep -n 'candidateDeferred(task.id).resolve(' factory/engine.mjs | cut -d: -f1) && f=$(grep -n '} finally {' factory/engine.mjs | awk -F: -v r="$r" '$1 < r' | tail -1 | cut -d: -f1) && w=$(grep -n 'if (wantsReferee) {' factory/engine.mjs | cut -d: -f1) && test "$w" -lt "$f" && test "$f" -lt "$r" && grep -q "resolve(best ? { dir: best.dir, patch: best.patch } : null)" factory/engine.mjs [M1]
- Run: sed -n '/const candidateCommitFor = (producerId) => {/,/^  }$/p' factory/engine.mjs | grep -q "no candidate" && sed -n '/const launchOnCandidate = (task, producerId) => {/,/^  }$/p' factory/engine.mjs | tr '\n' ' ' | grep -q "\.catch(.*no candidate from task" [M2]
- Run: node --check factory/engine.mjs && node fleet/tests/test_factory_refold_dispatch.mjs | grep -q 'ALL TESTS PASSED' [M3]
- Legs: (a) one resolve call, inside a `finally` that sits after the referee block, resolving the final candidate or null [M1]; (b) `candidateCommitFor`'s text names the `no candidate` throw and `launchOnCandidate`'s chain ends in a `.catch` that builds the `no candidate from task` dead landing [M2]; (c) the file parses and the engine sim passes [M3].

**Stale-if:**
- path-absent: `factory/dispatch.mjs`

### Task 5: A plan's Bootstrap line runs as one shell command

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `factory/engine.mjs`
- Modify: `factory/commands.mjs`

**Claim:** do: launch a plan whose Bootstrap line is `npm ci && npm run build`; see: both halves run in every fresh clone, in order, exactly as the same line would run in a shell. (derived)
Machine: M1. `factory/commands.mjs` no longer exports `runAll` and contains no whitespace split of a command (`split(/\s+/)` is absent); `bootstrapFor` is still exported and unchanged in behaviour: `bootstrapFor({ planCmd: 'x', files: [] })` is `'x'`, `bootstrapFor({ planCmd: '', files: ['bun.lock'] })` is `'bun install --frozen-lockfile'`, `bootstrapFor({ planCmd: '', files: ['package-lock.json'] })` is `'npm ci'`, and `bootstrapFor({ planCmd: '', files: [] })` is `null`.
M2. `makeCloner` in `factory/engine.mjs` runs the one bootstrap command as `sh('timeout', [String(seconds), 'bash', '-lc', cmd], clone)` — the same argv shape `factory/proofs.mjs`'s `runLines` uses — and `factory/engine.mjs` no longer imports `runAll`.
M3. `node --check` exits 0 on both files and `fleet/tests/test_factory_boot.mjs` prints `ALL TESTS PASSED`.

**Authorized-by:** review 2026-09-24 finding E4 (`factory/engine.mjs:422-424`, `factory/commands.mjs:55`); #1163 (the same defect on the `Run:` path, fixed by `proofs.runLines`).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `factory/commands.mjs` (83 lines, hash `920baa9c…`) exports `runAll({ cmds, cwd, sh, timeoutSeconds })` and `bootstrapFor({ planCmd, files })`; `runAll` does `const parts = String(cmd).trim().split(/\s+/); const r = sh('timeout', [String(timeoutSeconds), ...parts], cwd)` — so `npm ci && npm run build` becomes `timeout N npm ci '&&' npm run build`, and `npm` receives `&&` as a literal argument. Its header (lines 1-17) claims the opposite, that a `&&` line "reads correctly from here on"; that was true for the `Run:` path only once it moved to `proofs.runLines` (`sh('timeout', [String(timeoutSeconds), 'bash', '-lc', line], cwd, undefined, env)`, `factory/proofs.mjs:37`). `runAll`'s only caller is `makeCloner` (`factory/engine.mjs:409-435`): `const cmd = bootstrapFor({ planCmd: bootstrapCmd, files }); if (cmd) { const r = runAll({ cmds: [cmd], cwd: clone, sh, timeoutSeconds: timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS }); if (r.exit !== 0) {…} }` reading `r.exit` and `r.out`. `makeCloner` is synchronous and is called synchronously from many places, so it stays synchronous: replace the `runAll` call with `const r = sh('timeout', [String(timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS), 'bash', '-lc', cmd], clone)` and read the exit and output the way `commands.mjs`'s own `exitOf`/`outOf` did (`exitOf` reads `status`/`code`/`exitCode` or a bare number; `outOf` joins `stdout` and `stderr` — move both helpers into `engine.mjs` beside `makeCloner`, or export them from `proofs.mjs` which already has copies, and delete `commands.mjs`'s). Delete `runAll` and the header paragraph about it; keep `bootstrapFor` and its doc. The `import { runAll, bootstrapFor } from './commands.mjs'` at `engine.mjs:48` drops `runAll`; the comment at line 308 naming `runAll` is reworded. `fleet/tests/test_factory_boot.mjs` runs the real `factory/boot.sh` with a stubbed `claude` and is the closest smoke; no sim imports `runAll` (grep over `fleet/tests` at BASE: none).

**Proof:**
- Run: node -e "import('./factory/commands.mjs').then((m) => { const bad = (l) => { console.log('red', l); process.exit(1) }; if ('runAll' in m) bad('runAll still exported'); if (m.bootstrapFor({ planCmd: 'x', files: [] }) !== 'x') bad('plan wins'); if (m.bootstrapFor({ planCmd: '', files: ['bun.lock'] }) !== 'bun install --frozen-lockfile') bad('bun'); if (m.bootstrapFor({ planCmd: '', files: ['package-lock.json'] }) !== 'npm ci') bad('npm'); if (m.bootstrapFor({ planCmd: '', files: [] }) !== null) bad('none'); })" && ! grep -q 'split(/\\s+/)' factory/commands.mjs [M1]
- Run: sed -n '/^function makeCloner/,/^}/p' factory/engine.mjs | grep -q "'bash', '-lc', cmd" && ! grep -q "runAll" factory/engine.mjs [M2]
- Run: node --check factory/engine.mjs && node --check factory/commands.mjs && node fleet/tests/test_factory_boot.mjs | grep -q 'ALL TESTS PASSED' [M3]
- Legs: (a) `runAll` is gone from the module's exports, the split is gone from its text, and the four `bootstrapFor` rows answer as before [M1]; (b) `makeCloner`'s text hands the command to `bash -lc` and the engine no longer names `runAll` [M2]; (c) both files parse and the boot sim passes [M3].

**Stale-if:**
- path-absent: `factory/proofs.mjs`

### Task 6: A read-only worker cannot write

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `factory/worker.mjs`

**Claim:** do: dispatch the referee or the resolver, which the engine marks read-only; see: it can read the clone and answer, and every edit tool and Bash are refused to it, so it cannot change the tree it judges. (derived)
Machine: M1. `workerOptions` in `factory/worker.mjs` reads a `readOnly` option: with `readOnly: true` the returned `disallowedTools` is exactly the set union of `DISALLOWED_TOOLS`, `EDIT_TOOLS` and `['Bash']` (each name once, order free); with `readOnly` false or absent it is exactly `DISALLOWED_TOOLS`.
M2. `node --check factory/worker.mjs` exits 0 and `fleet/tests/test_factory_worker_gitblock.mjs` prints `ALL TESTS PASSED`.

**Authorized-by:** review 2026-09-24 finding E5 (`factory/engine.mjs:486,1471` pass `readOnly: true`; `factory/worker.mjs` never reads it).

**Interfaces:**
- Consumes: none
- Produces: `workerOptions({ cwd, systemPrompt, model, files, schema, mcpServers, task, label, onDenied, readOnly }, denials) -> options`

**Context:** At BASE `factory/worker.mjs` (149 lines, hash `004328db…`) exports `EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']` (line 27), `DISALLOWED_TOOLS = ['Bash(git *)', 'WebFetch', 'WebSearch', 'Agent']` (line 30), and `workerOptions({ cwd, systemPrompt, model, files, schema, mcpServers, task, label, onDenied }, denials)` (line 101) building `disallowedTools: [...DISALLOWED_TOOLS]`. `runWorker(opts, deps)` (line 138) calls `workerOptions(opts, denials)` with the whole `opts`, and `factory/engine.mjs:902` already passes `readOnly: Boolean(opts.readOnly)` in `opts`, set `true` for the resolver (line 486) and the referee (line 1471), both with `files: []`. Today `files: []` makes `makeConfineHook` deny the four edit tools (an empty allowed set), but `Bash` writes (`sed -i`, `>`) are unfenced. The change is inside `workerOptions` only: destructure `readOnly`, and build `disallowedTools` as `readOnly ? [...new Set([...DISALLOWED_TOOLS, ...EDIT_TOOLS, 'Bash'])] : [...DISALLOWED_TOOLS]`. The referee's prompt tells it the patch is on disk ("read it there") — `Read`, `Grep` and `Glob` stay allowed, which is what reading needs. `fleet/tests/test_factory_worker_gitblock.mjs` imports `runWorker` and `findGit` and asserts on `Bash(git …)` denials through the hook with a fake `query`; it never passes `readOnly`, so it stays green.

**Proof:**
- Run: node -e "import('./factory/worker.mjs').then((m) => { const bad = (l) => { console.log('red', l); process.exit(1) }; const base = { cwd: '/tmp', systemPrompt: 's', model: 'm', files: [], task: '1', label: 'l', onDenied: () => {} }; const ro = m.workerOptions({ ...base, readOnly: true }, []).disallowedTools; const want = new Set([...m.DISALLOWED_TOOLS, ...m.EDIT_TOOLS, 'Bash']); if (ro.length !== want.size || !ro.every((t) => want.has(t)) || new Set(ro).size !== ro.length) bad('read-only set'); const rw = m.workerOptions({ ...base }, []).disallowedTools; if (JSON.stringify(rw) !== JSON.stringify(m.DISALLOWED_TOOLS)) bad('default set'); const rf = m.workerOptions({ ...base, readOnly: false }, []).disallowedTools; if (JSON.stringify(rf) !== JSON.stringify(m.DISALLOWED_TOOLS)) bad('false set'); })" [M1]
- Run: node --check factory/worker.mjs && node fleet/tests/test_factory_worker_gitblock.mjs | grep -q 'ALL TESTS PASSED' [M2]
- Legs: (a) with `readOnly: true` the disallowed set is exactly the three lists' union with no duplicate, and with `readOnly` absent or false it is exactly `DISALLOWED_TOOLS` [M1]; (b) the file parses and the gitblock sim passes [M2].

**Stale-if:**
- path-absent: `factory/gitblock.mjs`

### Task 7: A fold re-attempt never writes a parked row for an adopted task

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `factory/engine.mjs`

**Claim:** do: run a plan where the fold check re-dispatches an already-adopted task and that re-attempt's fold does not complete; see: the run's record still shows the task adopted, the fold check reports its unresolved red as its own finding, and no `parked` row or conflict post is written for the task. (derived)
Machine: M1. `foldIn` in `factory/engine.mjs` takes a second argument `{ reattempt = false } = {}`; when `reattempt` is true, an incomplete fold or a materialize with no candidate returns `{ sha: null, reason }` without appending a `parked` row, without posting `conflict` to the board and without calling `setFoldOutcome`.
M2. The `reattempt` closure inside `reverifyAfterFold` calls `foldIn` with `{ reattempt: true }`, and the main loop's call of `foldIn(landing)` is unchanged.
M3. `node --check factory/engine.mjs` exits 0 and `fleet/tests/test_factory_reverify.mjs` prints `ALL TESTS PASSED`.

**Authorized-by:** review 2026-09-24 finding E6 (`factory/engine.mjs:1557,1565,1703-1727`); #1251 (the fold check re-runs every adopted task's probes); `factory/record.mjs:97-106` (`projectTasks` overwrites a task's state with the latest row).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `const foldIn = async (landing) => {…}` begins at `factory/engine.mjs:1540`; on `fold.complete !== true` after one resolver pass it does `await board.post(id, 'conflict', reason); appendEvent({ kind: 'parked', task: id, reason }); setFoldOutcome(id, 'parked'); return { sha: null, reason }` (lines 1555-1559), and on a materialize with no `candidateSha` it does `appendEvent({ kind: 'parked', task: id, reason }); setFoldOutcome(id, 'parked'); return { sha: null, reason }` (lines 1564-1567). `reverifyAfterFold`'s `reattempt` (line 1703) clones at `head`, re-dispatches the implementer with the fact, captures a patch and calls `const folded = await foldIn({ task: actionTask, anchor, best: { patch } }); return folded.sha !== null` (lines 1725-1726); `foldRound` (`factory/reverify.mjs`) then writes its own `fold:unresolved` and sets `foldUnresolved`, which is what forces `done: false`. So a failed re-attempt today writes a `parked` row for a task whose `landing` row already stands; `record.mjs`'s `projectTasks` takes the later row and the status page says `failed` while `adopted[]` still lists it. The change: `const foldIn = async (landing, { reattempt = false } = {}) => {…}` guarding the two park paths with `if (!reattempt) { … }` around the post, the row and `setFoldOutcome` (the `return { sha: null, reason }` stays), and the one call in `reattempt` becomes `foldIn({ task: actionTask, anchor, best: { patch } }, { reattempt: true })`. `waveNumber += 1` and the kernel calls are unchanged. `fleet/tests/test_factory_reverify.mjs` drives `foldRound` from `factory/reverify.mjs` with fakes and is the smoke.

**Proof:**
- Run: grep -q "const foldIn = async (landing, { reattempt = false } = {}) => {" factory/engine.mjs && sed -n '/const foldIn = async (landing/,/^  }$/p' factory/engine.mjs | grep -q "if (!reattempt)" [M1]
- Run: grep -q "foldIn({ task: actionTask, anchor, best: { patch } }, { reattempt: true })" factory/engine.mjs && grep -q "const folded = await foldIn(landing)" factory/engine.mjs [M2]
- Run: node --check factory/engine.mjs && node fleet/tests/test_factory_reverify.mjs | grep -q 'ALL TESTS PASSED' [M3]
- Legs: (a) `foldIn`'s signature carries the flag and its body guards on it [M1]; (b) the re-attempt passes the flag and the main loop's call is unchanged [M2]; (c) the file parses and the reverify sim passes [M3].

**Stale-if:**
- path-absent: `factory/reverify.mjs`

### Task 8: One Kata client for the board, the tools and the engine's own interface.settled write

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `factory/engine.mjs`

**Claim:** do: run on a sandbox with a board; see: when the judge settles an interface symbol on a landing, the engine's own `interface.settled` write reaches the run's Kata issue, the same client the board and the worker tools already use. (derived)
Machine: M1. `factory/engine.mjs` exports `buildDeps`, and `buildDeps({ kataUrl: 'https://kata.example', kataActor: 'a', kataProject: 1 }, {})` answers an object whose `kata` has a function `patchMetadata` and whose `board` is not `null`; `buildDeps({}, {})` answers `kata: null`; an `overrides.kata` is answered back as `kata` unchanged.
M2. Inside `buildDeps` the Kata client is made once and that one object is what `board`, `tools` and the returned `kata` all close over: the text of `buildDeps` contains exactly one `makeKataClient(` call.
M3. `node --check factory/engine.mjs` exits 0 and `fleet/tests/test_factory_tools.mjs`, which imports `factory/engine.mjs`, prints `ALL TESTS PASSED`.

**Authorized-by:** review 2026-09-24 finding E1 (`factory/engine.mjs:551,1747-1765,2302-2372`); the engine's own comment at line 548 ("the same client `board` was built over, when there is one").

**Interfaces:**
- Consumes: `makeKataClient({ transport, actor })`
- Produces: `buildDeps(rawArgs, overrides) -> { worker, judge, sh, git, tools, kata, board?, … }`

**Context:** At BASE `function buildDeps (rawArgs = {}, overrides = {})` at `factory/engine.mjs:2302` is not exported (un-exported in #1281) and returns `{ worker, judge, sh, git, tools, … }` with no `kata`; `runEngine` reads `const kata = deps.kata || null` (line 551) and, when `deps.board` is absent and `args.kataUrl` is set, builds the board over `deps.kata || await (async () => { const { makeKataClient, httpTransport } = await import('../fleet/kata-client.mjs'); return makeKataClient({ transport: httpTransport({ url: String(args.kataUrl) }), actor: args.kataActor }) })()` (lines 552-560); `tools` (line 2340) makes a third client the same way, `overrides.kata || makeKataClient(…)`. `maybeSettleInterface` (line 1747) writes `patchWithRevision(kata, args.kataProject, uid, { 'interface.settled': meta })` only `if (kata && uid !== undefined)` — unreachable on the fleet because `kata` is always `null` there; only the worker's own `settled` tool ever mints the cell. `fleet/kata-client.mjs` has no `import` line, so importing it statically at the top of `engine.mjs` costs a run with no board nothing (the dynamic import exists for `tools.mjs`, which resolves the SDK and zod at evaluation — keep that one dynamic). The change, all in `buildDeps`: `import { makeKataClient, httpTransport } from '../fleet/kata-client.mjs'` at the top; in `buildDeps`, `const kata = overrides.kata || (args.kataUrl ? makeKataClient({ transport: httpTransport({ url: String(args.kataUrl) }), actor: args.kataActor }) : null)`; `tools` closes over that `kata` instead of making one; return `kata` in the object; `export function buildDeps`. In `runEngine`, the board fallback's inner `await (async () => …)()` becomes `deps.kata` with the same `makeBoard` call — and since `buildDeps` now always supplies `kata`, the sims that inject their own `deps` without `kata` still get `null` and no board, as before. `fleet/tests/test_factory_tools.mjs` imports `candidatesOf` from `factory/engine.mjs`, so it is the smoke that the module still evaluates with the new static import.

**Proof:**
- Run: node -e "import('./factory/engine.mjs').then((m) => { const bad = (l) => { console.log('red', l); process.exit(1) }; if (typeof m.buildDeps !== 'function') bad('not exported'); const d = m.buildDeps({ kataUrl: 'https://kata.example', kataActor: 'a', kataProject: 1 }, {}); if (!d.kata || typeof d.kata.patchMetadata !== 'function') bad('no client'); const e = m.buildDeps({}, {}); if (e.kata !== null) bad('null without url'); const o = { patchMetadata: () => {} }; if (m.buildDeps({ kataUrl: 'https://kata.example' }, { kata: o }).kata !== o) bad('override'); })" [M1]
- Run: test "$(sed -n '/^export function buildDeps/,/^}/p' factory/engine.mjs | grep -c 'makeKataClient(')" = 1 [M2]
- Run: node --check factory/engine.mjs && node fleet/tests/test_factory_tools.mjs | grep -q 'ALL TESTS PASSED' [M3]
- Legs: (a) `buildDeps` is exported and answers a client with `patchMetadata` under a url, `null` without, and an override unchanged [M1]; (b) `buildDeps`'s text makes exactly one client [M2]; (c) the file parses and the tools sim, which imports the engine, passes [M3].

**Stale-if:**
- path-absent: `fleet/kata-client.mjs`

### Task 9: The engine no longer patches fs.writeFileSync for the whole process

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `factory/engine.mjs`

**Claim:** do: run the engine; see: a write aimed at a directory that does not exist fails where it happens, for every module in the process, instead of being silently retried after a mkdir the engine did behind the caller's back. (derived)
Machine: M1. `factory/engine.mjs` contains no assignment to `fs.writeFileSync` and no `_rawWriteFileSync`; the amendment comment above them (the lines beginning `// Amendment (undeclared by the task's own M1-M6`) is gone with them.
M2. `node --check factory/engine.mjs` exits 0 and every `fleet/tests/test_factory_*.mjs` sim that imports `factory/engine.mjs` still passes: `test_factory_retry.mjs`, `test_factory_refold_dispatch.mjs` and `test_factory_tools.mjs` each print `ALL TESTS PASSED`.

**Authorized-by:** review 2026-09-24 finding E8 (`factory/engine.mjs:63-86`); CLAUDE.md §Doctrine (simplicity of the factory, in lines and roles).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE lines 63-86 of `factory/engine.mjs` (hash `e5772aea…`) are a 14-line comment and `const _rawWriteFileSync = fs.writeFileSync.bind(fs); fs.writeFileSync = (file, data, options) => { try { return _rawWriteFileSync(file, data, options) } catch (err) { if (err && err.code === 'ENOENT' && typeof file === 'string') { fs.mkdirSync(path.dirname(file), { recursive: true }); return _rawWriteFileSync(file, data, options) } throw err } }` — a module-scope replacement of the global `fs.writeFileSync` that every other module in the process (the SDK, `board.mjs`, `tools.mjs`, `record.mjs`) then sees. The comment says it was added for "a caller that writes a policy document into a run directory ahead of the call that would otherwise have made it" — a sim convenience; `runEngine` already does `fs.mkdirSync(runDir, { recursive: true })` at line 564 before its first write. Delete the 24 lines. If a sim relied on it, that sim's own setup writes into a run directory it has not created; at BASE no sim under `fleet/tests/` writes a file into a run directory before calling `runEngine` (grep for `writeFileSync` over `fleet/tests/test_factory_*.mjs` finds writes only into directories the sim `mkdirSync`s first), so the three sims in M2 are expected green; a red one is a plan defect to report, not a reason to restore the patch. Task 3, 4, 7 and 8 edit other regions of the same file; text folds.

**Proof:**
- Run: ! grep -q "fs.writeFileSync = " factory/engine.mjs && ! grep -q "_rawWriteFileSync" factory/engine.mjs && ! grep -q "Amendment (undeclared by the task's own M1-M6" factory/engine.mjs [M1]
- Run: node --check factory/engine.mjs && node fleet/tests/test_factory_retry.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_factory_refold_dispatch.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_factory_tools.mjs | grep -q 'ALL TESTS PASSED' [M2]
- Legs: (a) the assignment, the bound original and the amendment comment are all absent [M1]; (b) the file parses and the three engine-importing sims pass [M2].

**Stale-if:**
- path-absent: `factory/record.mjs`
