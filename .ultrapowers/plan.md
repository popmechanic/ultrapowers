# A parked run's issue stays open as the needs-human row — the boot writes a state key, the janitor reads it (#964)

**Grammar:** claims-v1

**Claim:** do: let a run park, then open its run issue on the hub and run the janitor an hour later. see: the run issue still open, carrying needs-human and the park reason for me to answer, with no failed close recorded, and the janitor reaping the parked VM on time instead of calling it stale forever. (elicited)
**Summary:** This makes a parked run behave the way the tracker was designed: the run's issue stays open as the row that asks a person for a decision, instead of the sandbox trying to close it and being refused because the failed task underneath it is still open. It exists because run-118 showed that refusal live, and the janitor then reads every parked run as still running and never reaps its machine. After this run a park is a question on the hub you can answer, and machines of parked runs are cleaned up like any other.

**Goal:** #964 — on a `parked` or `failed` exit `fleet/sandbox-boot.sh` no longer closes the run issue; it writes three flat metadata keys on it — `work.state` (`parked`|`failed`), `work.attention` (`needs-human`) and `work.attention_msg` (the page's error head) — through the hub's metadata endpoint; a `done` exit writes `work.state=done` and then closes the run issue `done` as today. `fleet/janitor.mjs` reads a run as finished when its issue is `closed` OR its `work.state` is one of `done|parked|failed`, ages it from `closed_at` or, for an open issue with a state key, `updated_at`, and writes a death as the same three keys with `work.state=failed` instead of a `wontfix` close that a Phase A run's open tasks would refuse. `fleet/CONTRACT.md`'s four sentences on the run issue's close and the janitor's hub read say so. Operator decision 2026-09-13: kata's own supervise model — the operator resolves and closes a parked run's issue by hand.
**Closes:** #964

**Tech Stack:** bash (`fleet/sandbox-boot.sh`), Node 24 ESM (`fleet/janitor.mjs`, sims under `fleet/tests/`), Markdown (`fleet/CONTRACT.md`).

**Exam command:** node {paths}

**Spec:** #964 (its body, and the operator's decision recorded there).

**Parallelization rationale:** one wave, two wide — task 1 (the boot's park path and its contract sentences) and task 2 (the janitor's read and death and its contract sentences). The three key names and their values are a shared literal in both Contexts; the janitor needs the boot's *shape*, not its runtime behaviour, so no edge. Both edit `fleet/CONTRACT.md` in different bullets; text folds.

## Global Constraints

- The engine is untouched; the task-issue close discipline of #959 (a failed task stays open with `needs-review` + `needs-human`) is untouched.
- Check: git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/run-main.mjs fleet/run-worker.mjs fleet/roles/
- The `done` path is untouched: a gate-green run still closes its run issue `done` with the merge sha or the PR as evidence.
- Check: test "$(git diff $ULTRA_BASE -- fleet/sandbox-boot.sh | grep -c '^-.*kata_close_run done')" = 0
- The three keys are spelled the same everywhere: `work.state`, `work.attention`, `work.attention_msg` — the flat spellings kata stores (#960). (Each task's own exam pins its file's spelling; a check spanning both files would run in each task's clone, where only one is edited — run-121 parked on exactly that.)

### Task 1: The boot leaves a parked run's issue open with the state key

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/tests/test_sandbox_boot_kata.mjs`
- Test: `fleet/tests/test_sandbox_boot_park_state.mjs`

**Claim:** On a park the boot does not close the run issue: it sets the run issue's `work.attention` to `needs-human` with the park reason as `work.attention_msg`, and writes `work.state=parked` (and `done`/`failed` on those exits) as a flat metadata key; the operator resolves and closes the run issue by hand. (quoted from #964)
Machine: M1. For each of the three non-green exits of the boot — a parked run with a PR (gate verdict NEEDS_ACK), a run with nothing ahead of base, and an engine that exited non-zero — the boot makes no request to the run issue's `actions/close` path and makes exactly one `POST` to `/api/v1/projects/<project>/issues/<run uid>/metadata` whose JSON body is `{"actor": "sandbox:run-<N>", "patch": {"work.state": <"parked" or "failed">, "work.attention": "needs-human", "work.attention_msg": <the page's error head>}}`, with `work.state` `parked` for the two parks and `failed` for the engine exit, and the `work.attention_msg` equal to the page's `error` cell's first line. M2. A gate-green run makes exactly one metadata `POST` whose body is `{"actor": "sandbox:run-<N>", "patch": {"work.state": "done"}}` and then its one `actions/close` with reason `done`, in that order; and on the NEEDS_ACK park exit a metadata `POST` the hub refuses (curl non-zero) records one `kata:write-failed` event with `what` = `metadata`, makes no close, and the page still ends `parked`. M3. `fleet/CONTRACT.md`'s sentence that today says a parked or failed run closes its run issue `wontfix` (the `Kata record` bullet, ~line 289) says instead that a parked or failed run leaves its run issue open and writes the three keys, naming all three, and the sentence at ~line 497 that says `wontfix` is "the run issue's own park" no longer says so.

**Authorized-by:** #964; #810 §Supervise (the re-charter of 2026-09-13); operator decision 2026-09-13

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The three sites are `kata_close_run wontfix "$(plan_title) — $(error_head)"` in `fleet/sandbox-boot.sh` — after `write_status failed "engine exit $code"` (~line 3196), after `write_status parked "nothing to publish"` (~line 3241) and after `write_status parked "$PR_URL$fold_tail"` (~line 3353); the `done` site (~lines 3346–3348) stays. on the `done` site the same helper is called first with the single key `work.state=done` and no attention keys, then `kata_close_run done` as today; `kata_close_run` (~line 1414) is the pattern to copy for the new metadata helper — it reads `project.id` and `run.uid` from `$KATA_FILE`, builds the body with an inline python where a string is a string, sends with `fleet_curl -fsS --max-time 30 -X POST -H 'content-type: application/json' -H "Idempotency-Key: $RUN_ID:run:park"`, and on a non-zero curl records `append_event kata:write-failed what=s:metadata "uid=s:$uid" "detail=s:…"` and continues; run-118's refused close is the shape (`kata:write-failed what=close … curl exit 22`). Measured 2026-09-13 on the hub over HTTPS: `POST /api/v1/projects/13/issues/<uid>/metadata` with body `{"actor":"operator:laptop","patch":{"work.state":"parked","work.attention":"needs-human","work.attention_msg":"…"}}` and NO `If-Match` header answered 200 with the issue at the next revision and the three keys stored flat — so send no `If-Match`. The `error_head` helper already yields the page's error's first line. The existing sim `fleet/tests/test_sandbox_boot_kata.mjs` pins the old behaviour at its M6 leg (f) cases (`closes its issue wontfix with the park reason and no evidence`, ~lines 531–556, using `assertOneClose`, `CLOSE_URL` and `writeFailed(ctx)`), and a `STUB_KATA_CLOSE_EXIT` case for a dark hub; those cases must now assert no close and one metadata POST — the boot sim's stubbed `curl` records every argv it is called with (`_sandbox_boot_helpers.mjs` ~line 213, `argv "curl" "$@"`), and `test_sandbox_boot_kata.mjs`'s `closeArgv(ctx)` / `whyCurl(ctx)` show how a request's argv and `-d` body are read back; the stub needs a `STUB_KATA_META_EXIT` knob (beside `STUB_KATA_CLOSE_EXIT`) for M2's refused write. The peer exam `fleet/tests/test_sandbox_boot_park_state.mjs` (guarded) drives the boot the way `test_sandbox_boot_kata.mjs` does (`makeHome`, `boot(ctx, ['boot'], env)`, `statusOf`) with the same `KATA_ENV` and the verdict knobs `STUB_VERDICT: 'NEEDS_ACK'`, `STUB_NO_COMMITS: '1'`, and `STUB_ENGINE_CODE: '1'` for a non-zero engine exit (the helpers' knob; the full list is the `STUB_*` names in `_sandbox_boot_helpers.mjs`). The contract's two sentences: `fleet/CONTRACT.md` ~line 289 ("a run whose page ends `parked` or `failed` closes that run issue `wontfix` with no evidence") and ~line 497 ("`wontfix` is never the engine's word about a task — it is the run issue's own park (#940) and otherwise a person's decision"); a sibling task edits the janitor's bullets (~lines 614–640) of the same file — text folds, do not touch those.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_park_state.mjs`
- Guard: `fleet/tests/test_sandbox_boot_park_state.mjs`
- Legs: the driver runs the `Test:` sim as the exam command, and the `Run:` below is the sibling sim whose pins this task rewrites; (a) for each of the three exits — NEEDS_ACK park with a PR, nothing-ahead park, engine non-zero exit — the stub's recorded requests contain no URL ending `/actions/close` for the run uid and exactly one `POST` to `…/issues/<run uid>/metadata`, whose parsed body deep-equals `{actor: 'sandbox:run-7', patch: {'work.state': X, 'work.attention': 'needs-human', 'work.attention_msg': <first line of statusOf(ctx).error>}}` with X `parked`, `parked`, `failed` respectively [M1]; (b) a gate-green boot records exactly one metadata POST whose parsed body deep-equals `{actor: 'sandbox:run-7', patch: {'work.state': 'done'}}` and one close with `reason: 'done'`, the POST's argv recorded before the close's, and the page `done`; and a boot with `STUB_KATA_META_EXIT: '7'` on the NEEDS_ACK park exits 0 with the page `parked`, zero closes, and exactly one `kata:write-failed` event whose `what` is `metadata` [M2]; (c) the `Kata record` bullet of `fleet/CONTRACT.md`, read as one line, matches `parked.*failed.*open.*work\.state.*work\.attention.*work\.attention_msg` and does not match `parked.*or.*failed.*closes that run issue .wontfix`, and the line that contains "never the engine's word about a task" does not contain "the run issue's own park" [M3].
- Run: node fleet/tests/test_sandbox_boot_kata.mjs 2>&1 | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- issue-closed: #964
- path-absent: `fleet/tests/test_sandbox_boot_kata.mjs`

### Task 2: The janitor reads a run's finish from the state key

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/tests/test_janitor_hub.mjs`
- Test: `fleet/tests/test_janitor_state_key.mjs`

**Claim:** The janitor reads a run's finish from that `work.state` key (any of `done|parked|failed`) or from `closed`, never from `open` alone, so a parked run's VM is reaped an hour after the park like any other. (quoted from #964)
Machine: M1. For a hub-read row whose run issue is `open` and whose `metadata["work.state"]` is one of `done`, `parked`, `failed`: the janitor's reading is `finished: true` with `state` equal to that value and `updatedAt` equal to the issue's `updated_at`, and a VM whose such row is older than `--age` is removed (`rm <vm> --json`) — one row per value. M2. A hub-read row whose run issue is `open` with no `work.state` key is read as before: `finished: false`, `state: 'open'`, reported stale when older than the age and never removed; a `closed` issue is read as before from `closed_reason` and `closed_at`. M3. A death (unit dead, hub row open) is written to the hub as one `POST` to `…/issues/<run uid>/metadata` with body `{actor: 'janitor', patch: {'work.state': 'failed', 'work.attention': 'needs-human', 'work.attention_msg': <the death error>}}` under `Idempotency-Key: janitor:run-<N>:death`, and no `actions/close` request is made; the report row reads `hubMarked: true`. M4. `fleet/CONTRACT.md`'s janitor bullets say a run issue `closed` OR carrying `work.state` in `done|parked|failed` is a finished run, and that a death is written as the three keys, not a `wontfix` close.

**Authorized-by:** #964; operator decision 2026-09-13

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `fleet/janitor.mjs`: `readingOfIssue(project, issue)` (~line 213) derives `finished` from `issue.status === 'closed'` alone and `state` from `closed_reason`; extend it so an open issue with `issue.metadata['work.state']` in `['done','parked','failed']` is `finished: true, live: false, state: <that value>, updatedAt: issue.updated_at` — kata stores dotted keys flat, so read `metadata['work.state']`, never `metadata.work.state` (#960). `REAPABLE_STATES` (~line 312) is the evidence-read list (`done|parked|failed`); the same three words. `writeDeath` (~line 445–500) calls `hub.client.close(reading.project.id, reading.issue.uid, {reason: 'wontfix', …})` under the key `janitor:run-<N>:death`; replace that call with a metadata patch — the hub client in the janitor is the ssh-curl seam `openHub` builds (~line 599), whose `close` posts to `…/actions/close`; add a `patchMetadata(projectId, uid, body)` beside it posting to `…/issues/<uid>/metadata` with the same bearer sourcing and the same idempotency header, and rename the report flag `hubClosed` to `hubMarked`. The measured API shape (2026-09-13): body `{"actor": …, "patch": {…}}`, no `If-Match`, answers 200 with the issue. The existing sim `fleet/tests/test_janitor_hub.mjs` pins the old rules: the stale row (`state: 'open', lastUpdate: hoursAgo(7)`, ~line 336), `hubClosed: true` on a death and the `close.remote` assertions (~lines 455–470), and its fake hub's `close:` stub (~line 420) — extend the fake with the metadata route and update those pins; keep every other case as it is. The three keys are `work.state`, `work.attention`, `work.attention_msg`, with `needs-human` as the attention value — the same literals the boot writes. The peer exam `fleet/tests/test_janitor_state_key.mjs` (guarded) drives the janitor the way `test_janitor_hub.mjs` does (its fake exec, fake hub and `runJanitor`-style entry; read that file for the harness). The contract's janitor bullets are `fleet/CONTRACT.md` ~lines 614–640 (the hub read: "that run issue `closed` is a finished run, its `closed_reason` …" and the death: "one `wontfix` close of the run issue under `Idempotency-Key janitor:run-<N>:death`"); a sibling task edits the boot's bullets (~lines 289, 497) of the same file — text folds, do not touch those.

**Proof:**
- Test: `fleet/tests/test_janitor_state_key.mjs`
- Guard: `fleet/tests/test_janitor_state_key.mjs`
- Legs: the driver runs the `Test:` sim as the exam command, and the `Run:` below is the sibling sim whose pins this task rewrites; (a) for each of `done`, `parked`, `failed`: a fake hub answering an `open` run issue with `metadata: {'work.state': <value>}` updated two hours ago yields a reading `{finished: true, state: <value>, updatedAt: <that updated_at>}` and the pass's mutating verbs include `rm <vm> --json` for that VM [M1]; (b) an `open` issue with no `work.state` updated seven hours ago yields `finished: false`, appears in `stale`, and no `rm` is issued for it; a `closed` issue with `closed_reason: 'done'` reads `state: 'done'` aged from `closed_at` exactly as before [M2]; (c) a dead unit with an open hub row produces exactly one hub request, a `POST` whose URL ends `/issues/<run uid>/metadata`, whose body deep-equals `{actor: 'janitor', patch: {'work.state': 'failed', 'work.attention': 'needs-human', 'work.attention_msg': <deathError>}}`, whose remote carries `Idempotency-Key: janitor:run-<N>:death`, and no request whose URL ends `/actions/close`; the death row reads `hubMarked: true` [M3]; (d) the janitor bullets of `fleet/CONTRACT.md`, read as one line, match `closed.*or.*work\.state.*done\|parked\|failed` and `death.*work\.state.*failed` and do not match `wontfix. close of the run issue under` [M4].
- Run: node fleet/tests/test_janitor_hub.mjs 2>&1 | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- issue-closed: #964
- path-absent: `fleet/tests/test_janitor_hub.mjs`
