# One infra death at the last step no longer parks a green run — the critic, the examiner and the reviewer each get one bounded retry

**Grammar:** claims-v1

**Claim:** When the integration critic's worker ends with `class: infra` (a 429, a 5xx, a transport error — never an `agent-error` or a timeout), the engine re-dispatches the critic once, after a bounded backoff (e.g. 60 s), on the same integration HEAD and with the same brief; the second attempt's result is the attestation. (quoted from #830)

**Goal:** #830 (`bug`, `determinism`; map #727 — a retry is code, not judgment). Run-71
(2026-09-09, PR #828) finished seven tasks clean, folded two waves, and parked BLOCKED on the
gate's `git-verified` row alone because the integration critic's one `claude -p` ended on a 429:
`agent()` returned `null`, the engine recorded "integration review returned no result", and
`gitVerified` was withheld. Fail-closed stays; what changes is that the three single-dispatch
judgments whose death costs a run or a task — the integration critic, the wave-0 examiner beside
a kept implementer, and the reviewer (one of a pair, or the lean single) — are re-dispatched
exactly once after a bounded backoff when their call returns `null`, and only then. A second
`null` is what today's first `null` was. Every attempt is named in `judgmentCalls` with the status
code the worker recorded. `fleet/run-engine.mjs` only, plus one engine sim.
**Closes:** #830

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`). The engine sims run the real engine below the agent
seam (real git, real clones-at-BASE, real patch capture, the real fold kernel through the real
`sh` seam) with canned judgments — `rig()` of `fleet/tests/_engine_helpers.mjs`, whose repo's
suite is `bash check.sh` and whose `extraArgs` are merged into `runEngine`'s `args`. The suite is
`python3 -m pytest` from the repo root, which bridges every `fleet/tests/test_*.mjs` through
`tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, 300 s per file, no network).

**Exam command:** node {paths}

**Spec:** none — the issue is the spec; its desired-state paragraph is quoted above and in the
task.

**Parallelization rationale:** one wave, width 1. One mechanism (a null reply, one backoff, one
re-dispatch with the same prompt, two record lines) at three call sites of one file, exercised by
one sim; splitting the sites across tasks would have two strangers each write the shared helper
into `fleet/run-engine.mjs` — an adjacent insert at one location that the fold sends to a
resolver, not a fold. Linear by construction, and `Review: peer`: a retry lane is termination
logic whose miss is invisible on a green run and costs a live run to see.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- fleet/run-worker.mjs fleet/run-waves.mjs fleet/run-main.mjs skills/ultrapowers/scripts/gate_check.py
- The only infra signal the engine reads is a `null` reply from `agent()` (the `AGENT_NULL`
  doctrine at the top of `fleet/run-engine.mjs`): no free-text matching of `Overloaded`, `429`
  or `rate limit` against a thrown message, and no change to `isInfraFault`, `isSchemaTrip` or
  `looksStructural`.
- A thrown call (an `agent-error`, a schema trip, a structural error) is retried exactly as at
  BASE: the retry lanes that exist today — the examiner-alone re-dispatch on a rejected examiner
  (#762), the same-tier `runTask` retry, the barrier retry of a `parked-infra` task — are
  neither removed nor widened.
- No new npm dependency, no timer that holds the process open (`unref` every `setTimeout` the
  backoff creates), and no sleep in the sims longer than a second.

**Acceptance:** suite — the committed suite is the verification.

---

### Task 1: One bounded retry for the three single-dispatch judgments

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_infra_retry.mjs`

**Claim:** A second `infra` death is fail-closed as today and the report's `judgmentCalls` names both attempts with their status codes. The same one-retry rule applies to the examiner and the reviewer pair (the two other single-dispatch judgments whose death parks a task), each recorded in `judgmentCalls`. (quoted from #830)
Machine: M1. `fleet/run-engine.mjs` exports `INFRA_BACKOFF_MS` equal to `60000`, and `runEngine` waits `args.infraBackoffMs` milliseconds when that is a finite number greater than or equal to zero, else `INFRA_BACKOFF_MS`, between a judgment call's `null` reply and its re-dispatch.
M2. When the `integration` call returns `null`, the engine dispatches `integration` a second time with a prompt byte-identical to the first and the same `model` and `schema`; a second reply that is an object is the attestation — `criticRan` holds, `report.gitVerified` is `true`, and `report.completenessFindings` is that reply's `findings`.
M3. When the `integration` call returns `null` twice, there is no third dispatch: `report.gitVerified` is `false`, `report.completenessFindings` is the one fail-closed finding of BASE (`integration review did not run — completeness unverified; check the tree before merging`), and `gate_check.py` on that report exits `1` with verdict `BLOCKED` and `git-verified` among its failed checks.
M4. Each attempt that returns `null` leaves one `judgmentCalls` entry: attempt one, `infra-retry: <label> attempt 1 returned null (status <S>) — re-dispatched once after <ms> ms`; attempt two, `infra-retry: <label> attempt 2 returned null (status <S>) — no third attempt; fail-closed`, where `<S>` is the `status` of the most recent `worker:end` event carrying that `label` in `<runDir>/events.jsonl` and is `unknown` when no such event exists; a task-scoped entry is prefixed `task <id>: `; and each re-dispatch appends one `driver:infra-retry` event `{label, attempt: 1, status}` to `<runDir>/events.jsonl`.
M5. An `integration` call that throws is dispatched exactly once and leaves no `infra-retry:` entry, and a run whose every call replies first time leaves no `infra-retry:` entry and no `driver:infra-retry` event.
M6. When `exam:<id>` returns `null` and the implementer's reply is kept (`DONE` or `DONE_WITH_CONCERNS` with driver-captured coordinates), the engine waits the backoff, re-cuts and bootstraps the examiner's clone at BASE, and dispatches `exam:<id>` a second time with the same prompt while `impl:<id>` is dispatched exactly once; a second reply of status `DONE` is examined as an examiner that answered first time (the task's `exam` is not `blocked`), and a second `null` proceeds unexamined as at BASE (`exam` is `blocked`, the judgment call containing `proceeds unexamined` is present).
M7. When one reviewer of a pair returns `null` while the other returns a verdict, only the `null` half is dispatched a second time with the same prompt after the backoff, and when a lean single review returns `null` it is dispatched a second time; in both shapes `impl:<id>` is dispatched exactly once and no judgment call contains `parked for one barrier retry`; when the re-dispatched reviewer returns `null` again, the task is parked and recovered at the barrier retry as at BASE (a judgment call contains `recovered at the barrier retry`, and `impl:<id>` is dispatched a second time by that retry).
M8. The backoff elapses before the re-dispatch: with `args.infraBackoffMs` of `300`, the second `integration` dispatch begins at least `300` ms after the first returned `null`; with `0`, the sim exits `0` under `timeout 120`.

**Authorized-by:** #830; `fleet/run-engine.mjs` §fault classifiers ("AGENT_NULL is the engine-minted infra marker"); `fleet/run-worker.mjs` §classify (`INFRA_STATUSES = [429, 500, 502, 503, 504, 529]` → outcome `null`).

**Interfaces:**
- Consumes: none
- Produces: `INFRA_BACKOFF_MS`
- Produces: `infraBackoffMs`

**Context:** How an infra death reaches the engine, measured at BASE `3fb782b6`: `fleet/run-worker.mjs`
`classify()` maps an envelope whose `api_error_status` is in `INFRA_STATUSES` to outcome `null`,
`createRunWorker` emits `{kind: 'worker:end', label, class: 'infra', status: 429, …}` through
`onEvent` — which run-main's `makeEventLog` appends to `<runDir>/events.jsonl` — and then
**returns `null`** from `agent()`; the status code never travels in the return value. The
engine's `appendEvent` writes to the same file, so the engine reads the code back by scanning
`<runDir>/events.jsonl` for the last `worker:end` line whose `label` equals the call's label.
`null` is also what `classify` returns for a SIGINT abort (`class: 'aborted'`), which ends the
run anyway; a timeout is a SIGTERM exit 143 → a throw (`WORKER_SIGTERM`), never `null`, and a
throw is an `agent-error` for this plan's purpose — the throw lanes are untouched. The three
call sites at BASE: the critic at `runCritic` (label `integration`, `REVIEWER_MODEL`,
`CRITIC_SCHEMA`; today a `null` falls straight to the fail-closed finding); the examiner in
`runTaskInner`'s pair lane (label `exam:<id>`; the pair is `Promise.allSettled`ed, a *rejected*
examiner beside a kept implementer already re-dispatches once through `cutExamClone()` +
`bootstrapExamClone()` + `agent(examPrompt, examOpts)` — a *fulfilled* `null` today falls to
`ex = null` → `exam = 'blocked'` → "proceeds unexamined", with no retry; extend that null path
with the same re-cut/bootstrap/re-dispatch, keeping the kept-reply condition); and the reviewers
in the review loop (labels `review:<id>:<iter>:1` and `review:<id>:<iter>:2` for a pair,
`review:<id>:<iter>` for lean, `iter` starting at 1; today `r1 === null || r2 === null` throws
`AGENT_NULL: reviewer agent returned null …`, which `runTask` turns into `parked-infra` and the
barrier retry re-runs the whole task, implementer included). The sim's canned worker mirrors the
production order for a death: the stub appends
`{"kind":"worker:end","label":<label>,"class":"infra","status":429}` (its own `id`/`ts` may be
anything) to `<runDir>/events.jsonl` and then returns `null`; a stub that returns `null` without
writing the event is the `status unknown` row. `runDir` is the `runDir` handed to `rig`, and the
report is `await run()`; there is no `report.status` — BLOCKED is `gate_check.py`'s reading of
`gitVerified`, invoked as `fleet/tests/test_run_engine_actor_routing.mjs` does (`--run-id sim
--branch <integrationBranch> --report <file> --repo <integ>`; exit `1` = BLOCKED, `0` = PASS,
`2` = NEEDS_ACK; `verdict.checks[]` carries `{name, ok}`) — that script is frozen periphery and
is not edited. The pair's `review: 'peer'` on the wave task selects the pair lane and a clean
referee leaves `pairThisRound` true at `iter` 1. The existing pins that this change must leave
standing, all read at BASE: `test_run_engine_critic_inputs.mjs` scenario 5 (a critic that
*throws* withholds `gitVerified` — a throw is not retried, so it holds); `test_run_engine_fixloop.mjs`
scenario 3 (an implementer `null` → `parked-infra` → barrier retry — the implementer is not a
judgment and is not touched); `test_run_engine_examiner.mjs` (the rejected-examiner lane, its
one `driver:exam-redispatch` event and its `examiner died` call — the `null` lane adds
`infra-retry:` lines and a `driver:infra-retry` event, never a second `driver:exam-redispatch`);
`test_run_engine_review_pair.mjs` (pair labels and prompts). The backoff is a `setTimeout`
promise with `unref()` so a sim never holds the process open; the `driver:infra-retry` event and
the two `judgmentCalls` literals of M4 are the whole record — no new report field. What the
Claude Code docs say (guide review, 2026-09-09, `code.claude.com/docs/en/errors.md` and
`env-vars.md`): `claude -p` retries a temporary 429 and every 5xx itself, with exponential
backoff, up to `CLAUDE_CODE_MAX_RETRIES` attempts (default 10, cap 15), and
`CLAUDE_CODE_RETRY_WATCHDOG=1` makes an unattended session retry 429/529 without bound; a
spend-limit 429 is not retried. On give-up the CLI exits non-zero (1) with the result envelope on
stdout carrying `is_error: true` and `api_error_status` — the field `classify()` already keys on
— and nothing on stderr in json mode. So a `null` reaching the engine is a retries-exhausted death
(the CLI's ten fast attempts already failed), and the engine's one re-dispatch after a full minute
is a second, coarser tier that the CLI's seconds-scale backoff does not provide — that is why
both stand. The watchdog was considered and not adopted: an unbounded worker never emits
`worker:end`, so the record would show a judgment that neither died nor answered, and the
fail-closed second death would have nothing to fire on; `run-worker.mjs`'s comment naming the
CLI retry "undocumented" is now stale but that file is outside this plan's Files. `--resume` after
an API error is not documented as reliable, so the re-dispatch is a fresh worker with the same
prompt, never a resume.

**Proof:**
- Test: `fleet/tests/test_run_engine_infra_retry.mjs`
- Guard: `fleet/tests/test_run_engine_infra_retry.mjs`
- Run: timeout 120 node fleet/tests/test_run_engine_infra_retry.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_critic_inputs.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_examiner.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_review_pair.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_fixloop.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) `INFRA_BACKOFF_MS` imported from `../run-engine.mjs` is exactly `60000`; every scenario of this sim passes `args.infraBackoffMs` as `0` through `rig`'s `extraArgs` except the clock scenario, which passes `300`, and a scenario that passes `args.infraBackoffMs` as the string `'x'` with a once-null critic still re-dispatches, its judgment call reading `re-dispatched once after 60000 ms` — the sim stubs `globalThis.setTimeout` for that one scenario to fire immediately and records the delay it was asked for, which is exactly `60000` [M1]; (b) a one-task run whose stub writes the 429 `worker:end` line and returns `null` on the first `integration` call and returns `cleanCritic()` on the second: the `integration` label was dispatched exactly `2` times, the two `integration` prompts are `===`, the two `opts.model` and `opts.schema` are the first call's, `report.gitVerified` is `true`, and `report.completenessFindings` is exactly `[]` [M2]; (c) the once-null critic run with a second `integration` stub returning `criticWithFindings([{severity: 'minor', detail: 'sim'}])` carries exactly that one finding in `report.completenessFindings` [M2]; (d) a run whose stub writes the 429 line and returns `null` on the first `integration` call and writes a `worker:end` line with `status` `503` and returns `null` on the second: dispatched exactly `2` times, `report.gitVerified` is `false`, `report.completenessFindings` is exactly one finding whose `detail` is `integration review did not run — completeness unverified; check the tree before merging`, and `gate_check.py` on the written report exits `1`, its `verdict` is `BLOCKED`, and the failed checks include one named `git-verified` [M3]; (e) in the once-null critic run, `report.judgmentCalls` contains exactly one entry equal to `infra-retry: integration attempt 1 returned null (status 429) — re-dispatched once after 0 ms` and no entry containing `attempt 2`; in the twice-null critic run it contains that entry and exactly one equal to `infra-retry: integration attempt 2 returned null (status 503) — no third attempt; fail-closed` — the second attempt's own event, not the first's, since both lines carry the label `integration` and only the later one says `503`; a run whose stub returns `null` once for `integration` **without** writing the `worker:end` line yields the attempt-1 entry with `status unknown`; and `<runDir>/events.jsonl` of the once-null run holds exactly one line with `kind` `driver:infra-retry`, `label` `integration`, `attempt` `1` and `status` `429`, while the twice-null run holds exactly one such line too (no third attempt means no second re-dispatch event) [M4]; (f) a run whose `integration` stub throws `new Error('sim: the critic died')` dispatches `integration` exactly once, `report.gitVerified` is `false`, and no `judgmentCalls` entry contains `infra-retry:`; and the all-green run of the sim (every label answers first time) has no `judgmentCalls` entry containing `infra-retry:` and no `driver:infra-retry` line in `events.jsonl` [M5]; (g) a peer task run with `extraArgs.bootstrapCmd` of `touch booted.txt`, whose stub on the first `exam:T1` call writes `stale.txt` in its `cwd` (the examiner's clone), writes the 429 line and returns `null`, whose implementer writes `one.txt` and returns `doneImpl(cwd)`, and whose second `exam:T1` call first asserts that `stale.txt` is absent from its `cwd` and `booted.txt` is present there (the clone was re-cut at BASE and bootstrapped again — a reused clone would still hold `stale.txt`), then writes a red-at-BASE exam (`[ -f one.txt ]`) at the Proof path and returns `{status: 'DONE', summary: 'sim'}`: `exam:T1` dispatched exactly `2` times with `===` prompts, `impl:T1` exactly `1` time, `report.tasks[0].exam` is not `blocked` and not `null`, `report.judgmentCalls` contains exactly one entry equal to `task T1: infra-retry: exam:T1 attempt 1 returned null (status 429) — re-dispatched once after 0 ms`, and no entry contains `re-dispatching the examiner alone`; and the same shape with the implementer returning `{...doneImpl(cwd), status: 'DONE_WITH_CONCERNS', concerns: ['sim concern']}` also dispatches `exam:T1` exactly `2` times with the task ending `done` [M6]; (h) the same shape with `exam:T1` returning `null` both times: dispatched exactly `2` times, `impl:T1` exactly `1` time, `report.tasks[0].exam` is `blocked`, one judgment call contains `proceeds unexamined`, and one equals `task T1: infra-retry: exam:T1 attempt 2 returned null (status 429) — no third attempt; fail-closed` [M6]; (i) a peer task whose stub writes the 429 line for `review:T1:1:2` and returns `null` on its first call and `passReview()` on its second, with `review:T1:1:1` returning `passReview()` first time: `review:T1:1:2` dispatched exactly `2` times with `===` prompts, `review:T1:1:1` exactly `1` time, `impl:T1` exactly `1` time, `report.tasks[0].status` is `done`, no judgment call contains `parked for one barrier retry`, and one equals `task T1: infra-retry: review:T1:1:2 attempt 1 returned null (status 429) — re-dispatched once after 0 ms`; a lean task whose `review:T1:1` returns `null` once then `passReview()`: `review:T1:1` dispatched exactly `2` times, `impl:T1` exactly `1` time, status `done`; and a lean task whose `review:T1:1` returns `null` on its first two calls (the attempt and its one re-dispatch) and `passReview()` on its third (the barrier retry's re-run of the task, which dispatches `impl:T1` a second time): one judgment call equals `task T1: infra-retry: review:T1:1 attempt 2 returned null (status 429) — no third attempt; fail-closed`, one contains `parked for one barrier retry`, one contains `recovered at the barrier retry`, `impl:T1` was dispatched exactly `2` times and `review:T1:1` exactly `3` times, and `report.tasks[0].status` is `done` [M7]; (j) with `infraBackoffMs: 300`, the stub's `Date.now()` at the start of the second `integration` call minus its `Date.now()` when the first returned `null` is at least `300`, and the judgment call reads `re-dispatched once after 300 ms`; and the `Run:` of this file is under `timeout 120` and exits `0` [M8].

**Stale-if:**
- path-exists: `fleet/tests/test_run_engine_infra_retry.mjs`
- path-absent: `fleet/tests/_engine_helpers.mjs`
- issue-closed: #830
