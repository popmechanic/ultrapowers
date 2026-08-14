# Infra-Death Park-and-Retry + mergeWave Null-Guard Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a dead agent process (terminal-Overloaded null reply) survivable: null-normalize the wave-merge dispatches, and route infra-deaths in the task pipeline to a single budget-checkpointed retry at the wave barrier instead of an immediate retry into the same overload storm.

**Architecture:** Two independent seams in the engine harness. Seam 1 mirrors the contended path's proven null guards onto the two unguarded wave-merge dispatches (merge, reconcile), synthesizing CONFLICT so the existing reconcile/DEFERRED machinery absorbs a dead merge agent. Seam 2 classifies infra-death by the engine-minted `AGENT_NULL` prefix only, mints that marker at the two dispatch sites still missing it (reviewer, fix-round), parks the task under a transient marker, and retries all parked tasks once — chunk-parallel at 16 — at the wave barrier, replacing markers in place so the transient state never reaches report.json.

**Tech Stack:** Plain JS Dynamic Workflow (no wall clock, no timers, no imports); Node-run deterministic simulation (`tests/sim_workflow.mjs`); pytest for the anti-drift pins.

**Spec:** docs/superpowers/specs/2026-08-14-infra-death-park-retry.md

**Acceptance:** suite — the committed suite plus the harness sims are the verification; harness JS changes, so the suite-gate runs tests/sim_workflow.mjs via node and requires exit 0 plus the ALL SCENARIOS PASSED sentinel.

## Global Constraints

- Frozen periphery untouched: zero edits to `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `run_acceptance.sh`, or the sealing subsystem.
- No new report.json vocabulary: the transient `parked-infra` marker must never appear in report.json — not in `tasks`, `judgmentCalls`, `unfinished`, or any other field. Never put the literal string `parked-infra` inside any judgmentCall/log/unfinished text.
- No baked-prompt text changes: stay clear of the pinned prompt constants in the harness (`IMPLEMENTER_PROMPT`, `REVIEWER_PROMPT`, `MERGE_PROMPT`, `RECONCILE_PROMPT`, GUARD, and the contended-merge prompts); `tests/test_no_prompt_drift.py` must stay green with no re-bake.
- `tests/sim_workflow.mjs` must keep printing the `ALL SCENARIOS PASSED` sentinel on success (the suite-gate keys on exit code AND that sentinel when harness JS changes).

---

### Task 1: mergeWave null-guards (merge + reconcile dispatch normalization)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js:1468-1495`
- Test: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: none (self-contained normalization inside the wave-merge dispatcher; no symbols from any sibling task)
- Produces: none (no new exported or cross-task symbols; the change is internal control flow — a null merge/reconcile reply becomes a synthesized CONFLICT object consumed by the existing reconciliation loop)

Background for the implementer: `agent()` RETURNS null (does not throw) on terminal Overloaded or an engine skip. The merge and reconcile dispatch sites in `mergeWave` carry throw-guards only, so a null reply reaches `merge.status` and TypeErrors; `mergeWave` is unwrapped at its call site, so that TypeError aborts the whole run and loses every already-merged wave. The contended path already null-guards its fold/resolve/adopt dispatches — this task mirrors that discipline onto the two remaining sites. No new states, no new vocabulary: a dead agent is normalized exactly like the existing catch branches.

- [ ] **Step 1: Write the two failing sim scenarios**

Open `tests/sim_workflow.mjs`. Find this function (near the end of the file):

```js
// #96: the budget-exhausted-before-setup early report still stamps the command —
// the gate reads tests.command on every exit path, so it is never undefined.
async function scenarioEarlyExhaustStampsCommand() {
  const report = await runWorkflow({
    agent: makeAgent(), args: baseArgs, budget: { total: 100, remaining: 0 } })
  eq(report.tests.command, 'pnpm check',
     'budget-exhausted early report stamps tests.command from args.testCmd')
  eq(report.tests.passed, false, 'budget-exhausted early report cannot read as passed')
  console.log('scenario early-exhaust-stamps-command: OK')
}
```

Immediately AFTER its closing brace, add these two scenario functions. They follow the file's existing idiom (see `scenarioMergeThrowContained` / `scenarioReconcileThrowContained`, which cover the thrown-error twin of this defect); a handler returning `null` from `makeAgent` simulates the terminal-Overloaded null reply because `makeAgent` only falls through on `undefined`:

```js
// ── Scenario: null MERGE reply → synthesized CONFLICT → reconcile engages ─────
// agent() returns null (not throws) on terminal Overloaded; the merge dispatch
// must normalize it like its catch branch instead of TypeError-ing at
// merge.status and aborting the whole run (#148 §1).
async function scenarioMergeNullContained() {
  let reconciled = false
  const waves = [[{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }]]
  const args = { ...LAUNCH_ARGS, waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('merge:')) return null // terminal Overloaded: null reply, no throw
      if (label.startsWith('reconcile:')) { reconciled = true; return { status: 'MERGED', headSha: 'm1' } }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(reconciled, 'mergeNull: a null merge reply degrades to CONFLICT and reconcile dispatches')
  eq(r.waveMerges[0] && r.waveMerges[0].status, 'MERGED', 'mergeNull: reconcile recovered the wave')
  assert(r.tasks.length === 1 && r.blockedWaves.length === 0, 'mergeNull: run completed normally — no TypeError abort')
  console.log('scenario merge-null-contained: OK')
}

// ── Scenario: null RECONCILE reply → synthesized CONFLICT → attempt cap ends it ─
// Both reconcile attempts die; the existing attempt cap (2) must terminate the
// loop with the wave blocked and the run alive — never a TypeError (#148 §1).
async function scenarioReconcileNullContained() {
  const waves = [
    [{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
  ]
  const args = { ...LAUNCH_ARGS, waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'merge:wave1') return { status: 'CONFLICT', detail: 'clash' }
      if (label.startsWith('reconcile:')) return null // dead reconcile agent, both attempts
      return undefined
    }),
    args, budget: undefined,
  })
  eq(r.blockedWaves.length, 1, 'reconcileNull: wave 1 blocked after both null reconciles (attempt cap 2)')
  assert(r.blockedWaves[0] && /null reply/.test(r.blockedWaves[0].detail),
    'reconcileNull: block detail names the null reply, not a TypeError')
  assert(r.unfinished.some((u) => /B: cascade-blocked/.test(u)),
    'reconcileNull: wave 2 cascade-blocked, run still returned a report')
  console.log('scenario reconcile-null-contained: OK')
}
```

Then find the await block at the very end of the file:

```js
await scenarioTestCmdMissing()
await scenarioMechanicalTestsCommandNoField()
await scenarioCriticCommandIgnored()
await scenarioEarlyExhaustStampsCommand()

console.log('ALL SCENARIOS PASSED')
```

and add the two awaits after `await scenarioEarlyExhaustStampsCommand()` (keeping the sentinel line last):

```js
await scenarioMergeNullContained()
await scenarioReconcileNullContained()
```

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL (nonzero exit, no `ALL SCENARIOS PASSED` line). The merge-null scenario dies with `TypeError: Cannot read properties of null (reading 'status')` — the exact whole-run abort this task makes inexpressible.

- [ ] **Step 3: Null-normalize the merge dispatch**

Open `skills/ultrapowers/harnesses/waves.js`. In `mergeWave`, find:

```js
  let merge
  try {
    merge = await agent(
      fillPaths(GUARD + '\n\n' + MERGE_PROMPT + ' ' + slotsLine) +
        '\nMerge in this order:\n' + branchList,
      { label: 'merge:wave' + (waveIdx + 1), model: TIER.cheap, schema: MERGE_SCHEMA }
    )
  } catch (e) {
    merge = { status: 'CONFLICT', detail: 'merge agent error: ' + String((e && e.message) || e) }
  }
```

Replace with (the try/catch is unchanged; only the trailing null-normalization is new):

```js
  let merge
  try {
    merge = await agent(
      fillPaths(GUARD + '\n\n' + MERGE_PROMPT + ' ' + slotsLine) +
        '\nMerge in this order:\n' + branchList,
      { label: 'merge:wave' + (waveIdx + 1), model: TIER.cheap, schema: MERGE_SCHEMA }
    )
  } catch (e) {
    merge = { status: 'CONFLICT', detail: 'merge agent error: ' + String((e && e.message) || e) }
  }
  // agent() RETURNS null (not throws) on terminal Overloaded/skip. The contended
  // path already null-guards its fold/resolve/adopt dispatches — the asymmetry
  // here was the defect (#148 §1): a null reply reached merge.status, and the
  // TypeError aborted the whole run (mergeWave is unwrapped at its call site).
  // Normalize exactly like the catch branch so a dead merge agent routes into
  // the existing reconcile/DEFERRED machinery.
  if (!merge) merge = { status: 'CONFLICT', detail: 'merge agent died (null reply — terminal overload); task branches intact' }
```

- [ ] **Step 4: Null-normalize the reconcile dispatch**

A few lines below, still in `mergeWave`, find:

```js
    } catch (e) {
      merge = { status: 'CONFLICT', detail: 'reconcile agent error: ' + String((e && e.message) || e) }
    }
  }
  return merge
```

Replace with:

```js
    } catch (e) {
      merge = { status: 'CONFLICT', detail: 'reconcile agent error: ' + String((e && e.message) || e) }
    }
    // Same normalization as the merge dispatch above: a dead reconcile agent
    // becomes CONFLICT, and the loop's attempt cap (2) terminates — the run
    // survives with the wave blocked and every task branch intact.
    if (!merge) merge = { status: 'CONFLICT', detail: 'reconcile agent died (null reply — terminal overload); task branches intact' }
  }
  return merge
```

(The reconcile-null scenario's `/null reply/` assertion matches this exact detail string.)

- [ ] **Step 5: Run the sim to verify it passes**

Run: `node tests/sim_workflow.mjs`
Expected: PASS — `scenario merge-null-contained: OK`, `scenario reconcile-null-contained: OK`, every pre-existing scenario OK, and the final line `ALL SCENARIOS PASSED`, exit 0.

- [ ] **Step 6: Run the pytest suite**

Run: `python3 -m pytest`
Expected: PASS (all green). In particular `tests/test_no_prompt_drift.py` stays green — no prompt constant was touched.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "fix(waves): null-guard mergeWave merge/reconcile dispatches (#148)"
```

---

### Task 2: Infra-death classification + park-and-retry at the wave barrier

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js:821-836,949-981,1070-1086,1133-1153,1762-1769`
- Test: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: none (uses only symbols already defined in the harness: `runTaskInner`, `parallel`, `budgetExhausted`, `noteFailures`, `siblingLine`, `EDGES`, `CONCURRENCY`, `BUDGET_DEFERRED_NOTE`, `resolvedModel`, `taskReviewProfile`; no symbols from any sibling task)
- Produces: none externally (adds the internal classifier `isInfraFault(msg): boolean` — a single `AGENT_NULL`-prefix test — and the internal transient task status `'parked-infra'`, which is replaced in place before any report field is built and must never leave the harness)

Background for the implementer: the engine cannot currently distinguish "the reviewer rejected this work" from "the reviewer's process died." `agent()` returns null on terminal Overloaded; the implementer dispatch already converts that into a thrown `AGENT_NULL:`-prefixed Error, but a dead reviewer TypeErrors at `r1.issues` and a dead fix-round reply TypeErrors at `impl.status` — both land in `runTask`'s catch, which retries the whole pipeline once, immediately, at the same tier, straight back into the same overload storm, then records `status:'failed', reviewVerdict:'agent-error'` and cascade-blocks every transitive dependent. This task (a) mints the `AGENT_NULL` marker at all three null-reachable pipeline dispatch sites, (b) classifies infra-death by that engine-minted prefix ONLY (never free-text Overloaded/529 matching — `agent()` does not throw overload-worded errors, so a text matcher could only misclassify agent-authored error text), and (c) parks infra-dead tasks for one chunk-parallel retry at the wave barrier. This runtime has no wall clock and no timers, so barrier position IS the backoff: the storm gets the remainder of the wave's own runtime to clear. Non-infra faults (schema trips, structural errors) keep today's behavior byte-for-byte. Known, accepted trade (do not "fix" it): a parked task is neither failed nor done when a later same-wave chunk dispatches, so a same-wave dependent may run while its parent is parked — the engine discloses that via a judgmentCalls entry when the parent's retry then fails, and the suite gate is the backstop.

- [ ] **Step 1: Write the four failing sim scenarios**

Open `tests/sim_workflow.mjs`. Immediately AFTER the closing brace of `scenarioEarlyExhaustStampsCommand` (the same insertion region the mergeWave-null scenarios use; if those already sit there, add these after them — order among the new functions does not matter), add:

```js
// ── Scenario: dead reviewer → park → barrier retry succeeds (#148 §2–§3) ──────
// review:A:1 returns null once (terminal Overloaded). The task must PARK — not
// burn its retry immediately into the storm — then recover at the wave barrier.
// Zero failed tasks; the transient 'parked-infra' marker never reaches the report.
async function scenarioInfraDeathParkRecovers() {
  let reviewACalls = 0
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'review:A:1') {
        reviewACalls++
        if (reviewACalls === 1) return null // dead reviewer: null reply, no throw
      }
      return undefined
    }),
    args: baseArgs, budget: undefined,
  })
  const a = r.tasks.find((t) => t.task === 'A')
  assert(a && a.status === 'done', 'infraPark: A recovered at the barrier retry and is done')
  assert(r.tasks.every((t) => t.status !== 'failed'), 'infraPark: zero failed tasks recorded')
  assert(r.waveMerges[0] && r.waveMerges[0].status === 'MERGED', 'infraPark: wave 1 merged after recovery')
  assert(r.judgmentCalls.some((j) => /task A: infra-death/.test(j)),
    'infraPark: park recorded as a judgment call')
  assert(r.judgmentCalls.some((j) => /recovered at the barrier retry/.test(j)),
    'infraPark: recovery recorded as a judgment call')
  assert(!r.judgmentCalls.some((j) => /retrying once at/.test(j)),
    'infraPark: the immediate same-tier retry lane must NOT fire for an infra-death')
  assert(!JSON.stringify(r).includes('parked-infra'),
    'infraPark: the transient marker never appears anywhere in the report')
  console.log('scenario infra-death-park-recovers: OK')
}

// ── Scenario: park retry dies again → failed, dependents blocked (#148 §3) ────
// review:A:1 returns null EVERY time: the initial pipeline parks, the barrier
// retry dies the same way → today's terminal semantics: status failed with
// reviewVerdict agent-error, and the dependent is blocked before dispatch.
async function scenarioInfraDeathRetryDies() {
  const waves = [
    [{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
  ]
  const args = { ...LAUNCH_ARGS, waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
    edges: [['A', 'B']] }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'review:A:1') return null // dead reviewer, every attempt
      return undefined
    }),
    args, budget: undefined,
  })
  const a = r.tasks.find((t) => t.task === 'A')
  assert(a !== undefined, 'infraRetryDies: A appears in tasks')
  eq(a.status, 'failed', 'infraRetryDies: A failed after the barrier retry died')
  eq(a.reviewVerdict, 'agent-error', 'infraRetryDies: terminal verdict is agent-error, exactly as today')
  assert(r.judgmentCalls.some((j) => /barrier retry after infra-death failed/.test(j)),
    'infraRetryDies: the dead retry recorded as a judgment call')
  assert(r.unfinished.some((u) => /^B: blocked — depends on a failed task/.test(u)),
    'infraRetryDies: dependent B blocked before dispatch')
  assert(!JSON.stringify(r).includes('parked-infra'),
    'infraRetryDies: the transient marker never appears anywhere in the report')
  console.log('scenario infra-death-retry-dies: OK')
}

// ── Scenario: null fix-round reply → AGENT_NULL → park lane (#148 §2, sim 5) ──
// Without the fix-round AGENT_NULL throw, a null fix reply TypeErrors at
// impl.status with a message no classifier matches, silently keeping the
// storm-retry behavior. It must mint the marker and park instead.
async function scenarioFixRoundNullParks() {
  let reviewACalls = 0
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'review:A:1') {
        reviewACalls++
        // First review demands a fix; the post-park retry's review passes.
        if (reviewACalls === 1) {
          return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'needs work' }] }
        }
        return undefined
      }
      if (label === 'fix:A:1') return null // dead fix-round implementer
      return undefined
    }),
    args: baseArgs, budget: undefined,
  })
  const a = r.tasks.find((t) => t.task === 'A')
  assert(a && a.status === 'done', 'fixNull: A parked on the dead fix round, then recovered at the barrier')
  assert(r.judgmentCalls.some((j) => /AGENT_NULL: fix-round implementer agent returned null/.test(j)),
    'fixNull: classified by the engine-minted AGENT_NULL marker, not a raw TypeError')
  assert(!r.judgmentCalls.some((j) => /retrying once at/.test(j)),
    'fixNull: routed to the park lane, never the immediate storm retry')
  assert(!JSON.stringify(r).includes('parked-infra'),
    'fixNull: the transient marker never appears anywhere in the report')
  console.log('scenario fix-round-null-parks: OK')
}

// ── Scenario: budget exhausted before the barrier retry → deferred lane (#148 §3) ─
// The retry pass is budget-checkpointed like every dispatch site. Exhaustion
// routes the parked task to deferred/unfinished — never 'failed' — so a budget
// event does not cascade-block dependents as a failure would.
async function scenarioInfraParkBudgetDefers() {
  let reviewDied = false
  const waves = [
    [{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
  ]
  const args = { ...LAUNCH_ARGS, waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
    edges: [['A', 'B']] }
  const budget = { total: 100, remaining: () => (reviewDied ? 0 : 50) }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'review:A:1') { reviewDied = true; return null } // park A, then budget hits 0
      return undefined
    }),
    args, budget,
  })
  assert(r.unfinished.some((u) => /^A: deferred \(budget exhausted before infra-death barrier retry\)/.test(u)),
    'parkBudget: parked task routed to the deferred/unfinished lane')
  assert(!r.tasks.some((t) => t.task === 'A'), 'parkBudget: no task record for A — deferred, not failed')
  assert(!r.unfinished.some((u) => /blocked — depends on a failed task/.test(u)),
    'parkBudget: budget deferral never cascade-blocks dependents as a failure')
  assert(r.unfinished.some((u) => /^B: deferred \(budget exhausted\)/.test(u)),
    'parkBudget: dependent B lands in the budget lane too, not the blocked lane')
  assert(r.judgmentCalls.some((j) => /budget exhausted/.test(j)), 'parkBudget: cause in judgmentCalls')
  assert(!JSON.stringify(r).includes('parked-infra'),
    'parkBudget: the transient marker never appears anywhere in the report')
  console.log('scenario infra-park-budget-defers: OK')
}
```

Then add the four awaits at the end of the file, below every existing await (if the two mergeWave-null awaits are already present there, these go below them too) but BEFORE the `console.log('ALL SCENARIOS PASSED')` sentinel line:

```js
await scenarioInfraDeathParkRecovers()
await scenarioInfraDeathRetryDies()
await scenarioFixRoundNullParks()
await scenarioInfraParkBudgetDefers()
```

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL (nonzero exit, no sentinel). First failure is `SIM ASSERT FAILED: infraPark: park recorded as a judgment call` — today the dead reviewer TypeErrors into the immediate-retry lane, whose second review passes, so no park entry exists (and the forbidden `retrying once at` entry does).

- [ ] **Step 3: Add the isInfraFault classifier**

Open `skills/ultrapowers/harnesses/waves.js`. Find:

```js
const looksStructural = (msg) =>
  /cannot find module|module not found|no module named|importerror|cannot import|is not defined/i.test(msg)
```

Immediately after those two lines, add:

```js
// Infra-death: the agent PROCESS died (terminal Overloaded), not a judgment
// about the work. The ONLY trustworthy signal is the engine-minted AGENT_NULL
// marker — one prefix test, the same unforgeable-marker discipline as
// isSchemaTrip's engine-shape regex. Never free-text match Overloaded/529:
// agent() returns null rather than throwing overload-worded errors, so a text
// matcher could only ever match agent-authored or incidental error text and
// misclassify a genuine failure into the park lane.
const isInfraFault = (msg) => msg.startsWith('AGENT_NULL')
```

- [ ] **Step 4: Mint AGENT_NULL at the reviewer dispatches**

In `runTaskInner`, find:

```js
    let issues, verdicts
    if (taskReviewProfile(task) === 'adversarial') {
      const r1 = await agent(reviewPrompt, reviewOpts(1))
      const r2 = await agent(reviewPrompt, reviewOpts(2))
      issues = (r1.issues || []).concat(r2.issues || [])
```

Replace with:

```js
    let issues, verdicts
    if (taskReviewProfile(task) === 'adversarial') {
      const r1 = await agent(reviewPrompt, reviewOpts(1))
      // agent() RETURNS null (not throws) on terminal Overloaded — mint the
      // engine AGENT_NULL marker BEFORE any property access, so a dead reviewer
      // routes to the infra-death park lane instead of a TypeError at r1.issues.
      if (r1 === null) throw new Error('AGENT_NULL: reviewer agent returned null (terminal Overloaded or skipped)')
      const r2 = await agent(reviewPrompt, reviewOpts(2))
      if (r2 === null) throw new Error('AGENT_NULL: reviewer agent returned null (terminal Overloaded or skipped)')
      issues = (r1.issues || []).concat(r2.issues || [])
```

Then a few lines below, find the lean branch:

```js
    } else {
      const review = await agent(reviewPrompt, reviewOpts())
      issues = review.issues || []
```

Replace with:

```js
    } else {
      const review = await agent(reviewPrompt, reviewOpts())
      // Same marker as the adversarial branch: null means the process died.
      if (review === null) throw new Error('AGENT_NULL: reviewer agent returned null (terminal Overloaded or skipped)')
      issues = review.issues || []
```

- [ ] **Step 5: Mint AGENT_NULL at the fix-round dispatch**

Still in `runTaskInner`, find the end of the fix-round dispatch:

```js
      { label: 'fix:' + task.id + ':' + iter, isolation: 'worktree', model: TIER.mostCapable, schema: IMPLEMENTER_SCHEMA }
    )
    noteConcerns(impl)
```

Replace with:

```js
      { label: 'fix:' + task.id + ':' + iter, isolation: 'worktree', model: TIER.mostCapable, schema: IMPLEMENTER_SCHEMA }
    )
    // agent() RETURNS null (not throws) on terminal Overloaded — same class as
    // the initial implementer dispatch above. Without this, a null fix reply
    // passes noteConcerns harmlessly and TypeErrors at impl.status with a
    // message no classifier matches — a mid-storm fix-round death would
    // silently keep the storm-retry behavior instead of parking.
    if (impl === null) throw new Error('AGENT_NULL: fix-round implementer agent returned null (terminal Overloaded or skipped)')
    noteConcerns(impl)
```

- [ ] **Step 6: Park infra-deaths in runTask instead of the immediate retry**

Find the top of `runTask`'s catch:

```js
  } catch (e) {
    const msg = String((e && e.message) || e)
    // Default the one retry to the SAME tier; escalate one rung ONLY for a
    // capability-fixable schema trip. Never escalate an Overloaded/null fault.
    const capabilityFixable = isSchemaTrip(msg)
```

Replace with:

```js
  } catch (e) {
    const msg = String((e && e.message) || e)
    // Infra-death (engine-minted AGENT_NULL: the agent PROCESS died — terminal
    // Overloaded), not a judgment about the work: an immediate retry would
    // dispatch straight back into the same overload storm. Park a transient
    // marker instead; the wave barrier retries it exactly once after the storm
    // has had the remainder of the wave's own runtime to clear (this runtime
    // has no wall clock or timers — barrier position IS the backoff). The
    // marker is replaced in place before the merge set is computed, so its
    // status can never reach report.json. All other fault classes keep the
    // immediate retry below, byte-for-byte.
    if (isInfraFault(msg)) {
      judgmentCalls.push('task ' + task.id + ': infra-death (' + msg +
        ') — parked for one barrier retry (no immediate retry into the live storm)')
      log('task ' + task.id + ' infra-death — parked for barrier retry')
      return { task: task.id, status: 'parked-infra', reviewVerdict: 'agent-error',
               notes: msg, tier: resolvedModel(task.tier || 'standard'),
               review: taskReviewProfile(task), fixIterations: 0 }
    }
    // Default the one retry to the SAME tier; escalate one rung ONLY for a
    // capability-fixable schema trip. Never escalate an Overloaded/null fault.
    const capabilityFixable = isSchemaTrip(msg)
```

Note the sim tracing: the scenario regexes `/task A: infra-death/`, and (for absence) `/retrying once at/`, match this judgment string and the untouched existing retry judgment string respectively.

- [ ] **Step 7: Add the barrier retry pass in the wave loop**

In the main wave loop, find the comment block that immediately follows the per-chunk dispatch loop's closing brace:

```js
  // When every task in the wave is dep-blocked/failed (no mergeable branches),
  // skip the merge — but when NO edges were supplied (not even an empty array)
```

Immediately BEFORE that comment (i.e., after the chunk loop ends and before the `mergeable` computation — position is load-bearing: a wave whose tasks all parked must never take the all-SKIPPED branch with stranded markers), insert:

```js
  // ── Infra-death barrier retry pass (#148 §3) ────────────────────────────────
  // Tasks parked on an AGENT_NULL infra-death get exactly ONE retry here, at
  // the wave barrier (runTaskInner, same tier, fresh worktree — the proven
  // self-heal semantics). Chunked through parallel() at the same CONCURRENCY
  // cap as task dispatch, so the wave's tail is one task-duration, not N.
  // Marker replacement is IN-PLACE in BOTH results and taskResults (the
  // chunkLost precedent below) so the transient status never reaches
  // report.json. Budget-checkpointed like every dispatch site: exhaustion
  // routes parked tasks to the deferred/unfinished lane — never 'failed' — so
  // a budget event cannot cascade-block dependents the way a failure would.
  const parkedInfra = results.filter((r) => r && r.status === 'parked-infra')
  for (let off = 0; off < parkedInfra.length; off += CONCURRENCY) {
    if (budgetExhausted()) {
      for (const p of parkedInfra.slice(off)) {
        unfinished.push(p.task + ': deferred (budget exhausted before infra-death barrier retry)')
        const ri = results.indexOf(p); if (ri !== -1) results.splice(ri, 1)
        const ti = taskResults.indexOf(p); if (ti !== -1) taskResults.splice(ti, 1)
        log('task ' + p.task + ' infra-death retry deferred: budget exhausted')
      }
      if (!budgetDeferred) {
        budgetDeferred = true
        judgmentCalls.push(BUDGET_DEFERRED_NOTE)
      }
      break
    }
    const pchunk = parkedInfra.slice(off, off + CONCURRENCY)
    log('wave ' + (w + 1) + ' barrier: retrying ' + pchunk.length + ' infra-parked task(s)')
    const retried = await parallel(pchunk.map((p) => () => (async () => {
      const task = WAVES[w].find((t) => t.id === p.task)
      try {
        const res = await runTaskInner(task, waveBaseSha, siblingLine(task, WAVES[w]))
        judgmentCalls.push('task ' + task.id + ': parked on infra-death, recovered at the barrier retry')
        return res
      } catch (e2) {
        const msg2 = String((e2 && e2.message) || e2)
        judgmentCalls.push('task ' + task.id + ': barrier retry after infra-death failed — ' + msg2)
        log('task ' + task.id + ' FAILED after infra-death barrier retry: ' + msg2)
        return { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
                 notes: msg2, tier: p.tier, review: p.review, fixIterations: 0 }
      }
    })()))
    for (let k = 0; k < pchunk.length; k++) {
      const p = pchunk[k], res = retried[k]
      const ri = results.indexOf(p); if (ri !== -1) results[ri] = res
      const ti = taskResults.indexOf(p); if (ti !== -1) taskResults[ti] = res
      if (res.status === 'failed') {
        // Documented WaW weakening (accepted trade, #148 §3): a same-wave
        // dependent may have dispatched while its parent was parked (parked is
        // neither failed nor done at chunk time). Disclose it when the retry
        // then failed — the drain-administered suite gate is the backstop for
        // any resulting integration gap.
        for (const [a, b] of EDGES) {
          if (a === p.task && results.some((r2) => r2 && r2.task === b)) {
            judgmentCalls.push('task ' + b + ': ran while same-wave dependency ' + a +
              ' was parked and the barrier retry then failed — WaW ordering weakened; the suite gate is the backstop')
          }
        }
      }
    }
    noteFailures()
  }
```

- [ ] **Step 8: Run the sim to verify it passes**

Run: `node tests/sim_workflow.mjs`
Expected: PASS — the four new scenarios print OK (`infra-death-park-recovers`, `infra-death-retry-dies`, `fix-round-null-parks`, `infra-park-budget-defers`), every pre-existing scenario stays OK (non-infra faults are byte-for-byte unchanged: `scenario agent-throw-degrades` and the escalate scenarios must still pass), and the final line is `ALL SCENARIOS PASSED`, exit 0.

- [ ] **Step 9: Run the pytest suite**

Run: `python3 -m pytest`
Expected: PASS (all green). `tests/test_no_prompt_drift.py` stays green — no pinned prompt constant was touched.

- [ ] **Step 10: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "feat(waves): infra-death park-and-retry at the wave barrier (#148)"
```
