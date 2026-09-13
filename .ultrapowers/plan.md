# KATA_REF reaches the worker — the launch record carries each task's short id (#963)

**Grammar:** claims-v1

**Claim:** do: launch any plan and look at a running worker's environment on the sandbox. see: the worker carries the reference to its own kata issue, so the notes, stuck signals and needs-review label the roles teach can actually land on that issue. (elicited)
**Summary:** This closes the gap that has kept every worker silent on the tracker since Phase A landed: the roles teach the worker to write to its own issue, but the reference it needs was never handed to it. It exists because run-118's fix worker said outright that the reference was unset and skipped every kata command, and a look inside run-117's live workers confirmed the variable was missing. After this run a worker knows which issue is its own, and the next stuck task can be watched raising its hand on the hub.

**Goal:** #963 — `fleet/launch.mjs` records each task's kata row as `{uid, short_id, revision}`, the `short_id` taken from the create answer it already holds, so `run-main.mjs`'s existing `kataRefFor` (which reads `row.short_id`) answers `<project>#<short_id>` and `envFor` sets `KATA_REF` on every worker of a task the record names; `fleet/CONTRACT.md`'s record sentence names the new key; `fleet/tests/test_launch_kata.mjs`'s record pin and `fleet/tests/test_worker_kata_env.mjs` (which today plants `shortId` on the record itself) read the short id from a record shaped as the launcher writes it. The engine (`run-engine.mjs`), `run-main.mjs`, `run-worker.mjs` and `kata-client.mjs` are untouched.
**Closes:** #963

**Tech Stack:** Node 24 ESM (`fleet/launch.mjs`, sims under `fleet/tests/`), Markdown (`fleet/CONTRACT.md`).

**Exam command:** node {paths}

**Spec:** #963 (the measurement and the desired state are in its body; every fact a worker needs is in Context).

**Parallelization rationale:** one wave, one task — one field on one writer, its contract sentence and the two sims that pin the shape; nothing else can carry its own contract.

## Global Constraints

- The engine and the worker are untouched: the ref travels through the record the launcher writes, not through a new engine read.
- Check: git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/run-main.mjs fleet/run-worker.mjs fleet/run-waves.mjs fleet/kata-client.mjs fleet/confine-hook.mjs
- No worker ever holds a kata credential: the only `KATA_AUTH_TOKEN` in `fleet/` is the literal placeholder.
- Check: ! grep -rEn "KATA_AUTH_TOKEN=[A-Za-z0-9]{32,}" fleet/ skills/

### Task 1: The record carries the short id

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/tests/test_launch_kata.mjs`
- Modify: `fleet/tests/test_worker_kata_env.mjs`
- Test: `fleet/tests/test_worker_kata_ref.mjs`

**Claim:** Every worker of a task whose issue is on the hub runs with `KATA_REF=<project>#<short_id>` in its environment, the launch record's task rows carry the `short_id` the launcher already holds from the create answer (`MUTATION_KEYS` has it), and the sim that pins the worker's environment reads the short id from a record shaped exactly as the launcher writes it, never from a value the sim planted. (quoted from #963)
Machine: M1. The kata record the launcher writes to `.ultrapowers/kata.json` has, for every task, a row `{"uid": <26-char ULID>, "short_id": <the create answer's short_id>, "revision": <post-link getIssue revision>}` — keys in that order — and the run row stays `{uid, revision}`. M2. `run-main.mjs`'s `envFor({label: "impl:3"})`, handed a record parsed from bytes the launcher's own record writer produced for tasks 3 and 4, answers an object whose `KATA_REF` is `<project name>#<task 3's short_id>`, and `envFor({label: "review:4:1:2"})` answers task 4's; `envFor({label: "integration"})` answers the three variables and no `KATA_REF`. M3. `fleet/tests/test_worker_kata_env.mjs` no longer assigns `shortId` onto the record object it hands the engine stub: the string `.shortId =` does not occur in that file. M4. `fleet/CONTRACT.md`'s `ultra/plan-run-<N>` bullet spells the task row as `{uid,short_id,revision}` and no longer as `{uid,revision}` for tasks. M5. With a create answer that carries no `short_id`, the launcher's record writer throws a `Refusal` naming the task id and writes no record, rather than writing a row without it.

**Authorized-by:** #963; #810 Phase A (comment of 2026-09-13); #959

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Measured 2026-09-13 on run-117's sandbox: each live implementer's environment carried `KATA_SERVER`, `KATA_AUTH_TOKEN`, `KATA_AUTHOR=impl:<n>@run-117` and no `KATA_REF`; run-118's fix worker wrote "KATA_REF is unset, so I skip the kata commands per the instructions". The chain today: `fleet/launch.mjs` (`buildKataRecord`, around line 1364–1409) creates each task issue with `hub.createIssue` — a mutation whose answer is projected by `MUTATION_KEYS` in `fleet/kata-client.mjs` and so carries `short_id` — then keeps only `{id, uid}` per task and writes `record.tasks[id] = {uid, revision}` after a post-link `getIssue`; `run-main.mjs`'s `kataRefFor(record, label)` (line 437) reads `row.shortId || row.short_id` and the project's `name`, so the moment the row carries `short_id` the ref exists with no engine change; `run-engine.mjs` also tries to set `kataRow.shortId` from its dispatch `getIssue`, whose `ISSUE_KEYS` projection has no `short_id` — leave that as it is (the engine is out of this task's Files; a row that already carries `short_id` needs nothing from it). The record's key order is pinned twice: `fleet/tests/test_launch_kata.mjs` case (f) deep-equals the blob (`tasks: {1: {uid, revision}, …}`, line ~433) — extend that expectation with `short_id` from the fake hub's create answer (`makeFakeKata` answers `short_id: 'K-<n>'`, line ~226) — and `fleet/CONTRACT.md`'s `ultra/plan-run-<N>` bullet (line ~44–46) spells `"tasks":{"<id>":{uid,revision}}`. `fleet/tests/test_worker_kata_env.mjs` builds the record the engine stub receives and then writes `recordSeen.tasks['3'].shortId = SHORT_3` (line ~234) — the planted value that hid this defect; its cases must instead hand run-main a record whose rows carry `short_id`, written the way the launcher writes it. The peer exam `fleet/tests/test_worker_kata_ref.mjs` (guarded) exercises the seam end to end without the engine: it calls the launcher's record writer against the fake hub of `test_launch_kata.mjs`'s shape (import or copy its `makeFakeKata`), parses the bytes it wrote, hands that object to run-main the way `test_worker_kata_env.mjs` does (its `withKata` harness is the pattern), and reads `envFor` — no `claude`, no network, no planted field. A `Run:` on the sim is the driver's, once.

**Proof:**
- Test: `fleet/tests/test_worker_kata_ref.mjs`
- Guard: `fleet/tests/test_worker_kata_ref.mjs`
- Legs: (a) the record writer, against a fake hub whose create answers carry `short_id` `K-3` and `K-4` for tasks 3 and 4, writes a blob whose parsed `tasks['3']` is exactly `{uid, short_id: 'K-3', revision}` with `Object.keys` in that order, `tasks['4']` likewise with `K-4`, and whose `run` row has exactly the keys `uid`, `revision` [M1]; (b) run-main, handed that parsed object as its kata record, answers `envFor({label:'impl:3'}).KATA_REF === '<project>#K-3'`, `envFor({label:'review:4:1:2'}).KATA_REF === '<project>#K-4'`, and `envFor({label:'integration'})` has no `KATA_REF` key while carrying `KATA_SERVER`, `KATA_AUTH_TOKEN` and `KATA_AUTHOR` [M2]; (c) `grep -c '\.shortId =' fleet/tests/test_worker_kata_env.mjs` prints `0`, and that sim still passes when run [M3]; (d) the `ultra/plan-run-<N>` bullet of `fleet/CONTRACT.md`, read as one line, contains `{uid,short_id,revision}` and does not contain `"tasks":{"<id>":{uid,revision}}` [M4]; (e) with a fake hub whose create answer for task 4 omits `short_id`, the record writer throws a `Refusal` whose message names `4`, and no `.ultrapowers/kata.json` bytes are produced [M5].
- Run: node fleet/tests/test_worker_kata_env.mjs 2>&1 | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_kata.mjs 2>&1 | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- issue-closed: #963
- path-absent: `fleet/tests/test_worker_kata_env.mjs`
