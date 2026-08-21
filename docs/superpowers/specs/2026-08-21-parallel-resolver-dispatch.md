# Parallel resolver dispatch across paths — feasibility read (#183)

**Status: RESEARCH READ — not a build, no code changes proposed here.**
Ticket `wayfinder:research` #183 on The Width Program map (#174). Question:
can §1b multi-open stops dispatch resolvers concurrently — are conflicts on
distinct paths truly independent? Companion to the #177 measurement designs
(`2026-08-21-width-semantic-defense-measurements.md`, committed `a24b895`);
win sizing below uses #177's numbers. Frozen verification periphery
untouched throughout; the gate surface a build would answer to is named in
§5.

---

## 1. Current dispatch structure — strictly serial by construction

### 1.1 The work list

`skills/ultrapowers/harnesses/waves.js` (engine at `19c4264`), the contended
merge path. The comment above the loop states the contract outright
(`waves.js:1547–1554`):

> ```
> // Serial resolver WORK LIST — one agent at a time, awaited, so serialization
> // is by construction. It is a work list rather than a `for` over `open`
> // because the incremental protocol folds ON past a drained stop inside the
> // same `resolve` call: a later stop's conflicts arrive as an apply REPLY, and
> // the list must be REPLACED by that reply's `open`. Iterating `open` alone
> // would resolve the first stop and then adopt a candidate the CLI never
> // called complete.
> ```

Control flow (`waves.js:1555–1685`), one iteration per outstanding entry:

```
let outstanding = open.slice()
worklist:
while (outstanding.length) {
  const entry = outstanding[0]
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (budgetExhausted()) return finish(null, 'budget exhausted before resolving …')
    res = await agent( GUARD + RESOLVER_PROMPT + HUNKS/REPLY-DIR lines
                       + contendingTasksBlock(waveTasks), … )     // ← resolver dispatch, AWAITED
    …
    applied = await dispatchMerge('resolve',
      KERNEL_CLI + ' resolve … --conflict ' + entry.i + ' --reply-dir ' + replyDir …)
                                                                   // ← apply via merge agent, AWAITED
    if (applied.status === 'REJECTED') { retry once, else fallback }
    if (applied.status === 'CONFLICTS' && waiting) { outstanding.shift(); continue worklist }
    if (applied.status === 'CONFLICTS' && open)    { outstanding = applied.open.slice(); continue worklist }
    if (applied.status === 'FOLDED' && complete)   { outstanding = []; continue worklist }
  }
}
```

Two awaited agent dispatches per conflict, strictly alternating: the
**resolver** (reads the hunks file, writes the reply dir) and the
**resolve-apply merge agent** (`dispatchMerge`, `model: TIER.mostCapable` —
`waves.js:1443` — which runs the `resolve` CLI inside the integration
worktree and copies its stdout). Nothing overlaps anything.

### 1.2 Where multi-open stops constrain ordering

Spec §1b (program spec `2026-08-18-fold-native-authoring-program.md`, engine
loop, ~lines 298–311): "(i) when one stop opens more than one entry
(distinct paths), folding continues only after *all* open entries of that
stop are applied (the `waiting` reply)". The CLI's `resolve` reply for a
not-yet-drained stop is `{applied: true, waiting: [i,...]}` (§1b protocol
table); the engine holds the waiting set to its own bookkeeping
(`waves.js:1643–1650`):

> ```
> if (applied.status === 'CONFLICTS' && Array.isArray(applied.waiting)) {
>   const expectWaiting = outstanding.slice(1).map((e) => e.i)
>   if (!applied.waiting.length || !sameIds(applied.waiting, expectWaiting))
>     return finish(null, 'resolve on ' + entry.path + ' reported waiting […] but the
>       engine was holding […] outstanding')
>   outstanding.shift()
>   continue worklist
> ```

Note what this guard actually pins: **apply order** (head-first off the
engine's list), not dispatch order. The count-authority guards
(`waves.js:1508–1545` on the fold reply; `1656–1664` on a continued-fold
reply) pin `open.length` against `dispatchable`/`conflicts` — they
constrain *what must be resolved*, not *when each resolver runs*. The
serialization of resolver *dispatches* is an implementation property of the
awaited loop, not a property any guard demands.

### 1.3 What "distinct paths at one stop" means mechanically

The incremental fold stops at the first fold event that opens ≥1
`lines`/`add-add` conflict (§1b). A stop opens multiple entries only when
folding **one task** conflicts with the frontier on **two or more distinct
paths simultaneously**. All hunks files for the stop's entries are derived
at that moment, before any resolution applies. Sequential *stops* (the n−1
dispatches per contended path from #177) are a different axis: each later
stop exists only after the previous resolution applied and folding
continued — those are inherently serial and no dispatch scheme can overlap
them.

---

## 2. Independence analysis — real sharing vs bookkeeping

### 2.1 Resolvers share no checkout, no index, no working tree

The baked resolver prompt (`references/wave-merge.md:222`, pinned into
`waves.js:633` by `test_no_prompt_drift`):

> "You are a merge-conflict resolver for one file in one wave. You have no
> repo to explore: read exactly the hunks file named below and write exactly
> the reply directory named below — one file per HUNK (h1.txt, h2.txt, …)
> plus notes.txt — and touch nothing else. Never run git, never edit the
> file under conflict, never create a commit; the hunks file and the reply
> directory are your only sanctioned locations."

And the contended merge-agent prompt (`wave-merge.md:187`): the fold CLI
"**moves no ref and writes nothing into the worktree**". So the ticket's
git-index/working-tree collision worry does not exist on this path: two
resolvers on distinct paths read distinct `conflict-<i>.hunks.txt` files
and write distinct `reply-<i>-<m>/` directories under the same
`frontier/wave-<n>/` dir. Distinct files, no git operations, no shared
mutable file.

### 2.2 Kernel state is per-path — structural independence

`skills/ultrapowers/kernel/repo_weave.py`: the frontier holds one weave
state per path (`files[p] = manyana.merge_states(files[p], w)` at line 270;
"a per-path constant" at 22/252; "per-path total is `len(candidates) − 1`
no matter what order tasks arrive" at 283). Applying path A's resolution
cannot change path B's conflict content, markers, or hunks — path B's
narration was derived from `files[B]`, which resolution of A never touches.

**The key informational fact:** for entries of the *same stop*, the hunks
files are all written before any of the stop's resolutions applies. A
resolver at entry 2 of a stop sees exactly the same brief whether entry 1's
resolver has finished or not. **Concurrent dispatch is informationally
identical to serial dispatch for same-stop entries** — serial order today
gives resolver 2 zero visibility into resolver 1's reply (it sees only its
own hunks file + `contendingTasksBlock`, both fixed at stop time,
`waves.js:1374–1393`). Parallelism therefore removes no defense that
currently exists.

### 2.3 The sharing that is REAL and must stay serial

- **The `resolve` CLI apply.** Each `resolve` invocation is a fresh process
  that rehydrates frontier state from `fold_log.jsonl`, applies, appends a
  resolve event, and may **continue folding** to the next stop (§1b
  protocol table). Two concurrent `resolve` processes on the same log =
  rehydrate/append lost-update race, and each one's "did the stop drain?"
  decision depends on the other's append. Applies are genuinely serial.
  (They are also cheap on the CLI side — fold CLI wall ~0.8s, T15 §Honesty
  bounds — though each apply is wrapped in its own `dispatchMerge` agent
  whose wall is not separately recorded.)
- **The epoch idempotency guard** (`apply_resolution`'s `_touched_at`
  refusal, spec §1b "Kept … trim round 2, B5") is per-path and protects
  re-issued commands; it neither blocks nor is threatened by parallel
  *dispatch*, only by concurrent *applies* — covered above.

### 2.4 The sharing that is mere bookkeeping (single-threaded engine state)

`outstanding` (the work list), `transcripts` (the A/B grading surface,
`waves.js:1605–1607`), `judgmentCalls`, `addWall` accumulation, and the
budget checkpoint (`budgetExhausted()`, `waves.js:1849–1853` — a read on
`budget.remaining`). All live in the single-threaded workflow JS; a
`parallel()` fan of resolver dispatches mutates none of them mid-flight if
recording happens at collection time. The engine already owns a
concurrent-dispatch primitive: task pipelines fan out through
`await parallel(runnable.map((task) => () => runTask(…)))`
(`waves.js:2000–2001`) — parallel resolver dispatch would be the same
primitive at a different call site.

---

## 3. Concurrency-cap interaction

`const CONCURRENCY = 16 // engine cap: up to 16 concurrent agents per run`
(`waves.js:1926`) — the code is a flat 16, chunking wave dispatch
(`waves.js:1979`); I could not ground the ticket's "min(16, CPUs−2)"
formula anywhere in the repo (stated honestly; possibly a platform-side
property of the Workflow runtime not visible in this codebase).

Resolvers **cannot contend with in-flight task agents**: `contendedMerge`
runs at the wave barrier, after `await parallel(...)` has returned for
every chunk of the wave (`waves.js:1964–2018`) and before the next wave's
loop iteration dispatches anything. During the merge phase the engine runs
at most one agent at a time today (merge agent and resolver alternating).
A parallel fan of k resolvers peaks at k concurrent agents in a phase whose
current peak is 1 — for any recorded stop shape (k ≤ 3 conflicts total per
run, and never more than 1 per stop) this is far under the cap. Only a
pathological plan (one task conflicting on ≥16 distinct paths at one stop)
would need chunking, and the task-dispatch chunking pattern already exists
to copy. The engine's own comment warns the inverse case
(`waves.js:1185–1187`: task pipelines must stay single-agent so wave width
equals peak concurrency) — a build would add the symmetric consideration
for the merge phase.

---

## 4. Win sizing against #177 baselines

#177 baselines: resolver serial share **4.73% tokens / ~8–13% wall
(derived)** at width 4; per-dispatch resolver wall **43.6–69.4s**; **n−1
serial dispatches per contended path** (`2026-08-19-phase1-gate.md`,
`2026-08-21-width-semantic-defense-measurements.md`).

**The ceiling formula.** Let d ≈ 1 min per resolver dispatch, s = number of
stops, k_j = open entries (distinct paths) at stop j. Serial resolver wall
= Σ k_j·d; parallel-across-paths = s·d (each stop compresses to its
slowest dispatch); **saved = Σ (k_j − 1)·d**. The apply legs (one
`dispatchMerge` per conflict) stay serial either way and are not removed.

**What the record says k_j is: 1, always.** Every live conflict ever
recorded — T15's 5, the Phase-1 gate's 3 + 3, the Phase-2 mechanics
re-run's 3 + 2 + 2 — was on a single path (`app/registry.py`); the
shakedown's natural fold (`waves.js`, 2,325 lines) had zero conflicts. **No
multi-open stop has ever occurred in a live run**; the shape exists only in
the sims (scenarios 5, 9p, 9p2, 10c simulate `waiting: [2]`). So the
parallelizable component of the observed 8–13% wall share is exactly
**0%** — all of it is sequential-stop, same-path dispatch wall, which is
epoch-ordered and unparallelizable by construction (§1.3).

**Hypothetical shapes (derived, labeled as such):**
- Width 4, two contended paths, every stop opening both (k=2, s=3): saved
  ≈ 3 min on a ~26-min run ≈ **11% of wall** — roughly the whole current
  resolver share, and the best realistic case.
- The #177 width-6 threshold scenario (share >15% wall): parallel dispatch
  helps only the across-path fraction of that share. If contention stays
  concentrated on one registration surface per wave — which the §2c
  "author for the resolver" guidance and every fixture actively encourage —
  the across-path fraction stays near zero and this build recovers almost
  nothing. If contention spreads across surfaces, auto-union
  (`Commutes:`, spec §2b consumer 3, already built, zero-dispatch) removes
  entire dispatches rather than overlapping them — strictly dominant where
  it applies, and it is #177's first-named response candidate.

**Conclusion of the sizing:** the win is real but conditional on a conflict
shape (multi-path stops) with zero live observations, and it is bounded
above by a share (8–13% wall) that #177 already pre-registered a >15%
threshold for before any response is licensed.

---

## 5. Risk register + what the build must prove

Preconditions and risks, each with its gate surface:

1. **Applies stay strictly serial.** Only the resolver *agent* dispatches
   parallelize; `resolve` CLI invocations remain one-at-a-time in
   conflicts-index order (the fold-log race, §2.3). The waiting-set guard
   (`waves.js:1643–1648`) then holds unchanged — it pins apply order, which
   parallel dispatch does not alter.
2. **Budget checkpoint granularity.** Today the checkpoint precedes every
   dispatch (`waves.js:1563`); a parallel fan commits k dispatches at one
   checkpoint. Exhaustion mid-fan must await all in-flight resolvers before
   routing to fallback. Gate surface: `tests/frontier_merge.mjs` scenarios
   5 (`budget-exhausted-mid-loop`) and 10c
   (`budget-exhausted-mid-work-list`) — both currently assert the *second*
   resolver is never dispatched; a parallel build changes that contract
   deliberately and must rewrite these scenarios, not weaken them.
3. **Failure-in-fan semantics.** A null reply (terminal Overloaded) or
   throw from one resolver while siblings are in flight routes the wave to
   fallback (`waves.js:1597–1603`); the build must await the fan and fall
   back once, not k times. Cancellation semantics of an in-flight `agent()`
   call are **not grounded anywhere in this repo** — whether abandoned
   siblings keep consuming budget is a runtime property a build must probe
   first (the `waves.js:1577–1587` model-omission probe is the precedent
   for how to verify runtime behavior before relying on it).
4. **REJECTED retry stays per-entry and serializes naturally.** A grammar
   rejection surfaces at apply time (serial); the one re-brief
   (`waves.js:1630–1637`) then runs alone. Scenario 9m pins the retry
   contract.
5. **Transcript determinism.** `transcripts` is the A/B grading surface,
   recorded "verbatim" (`waves.js:1604–1607`); a parallel fan must record
   in conflicts-index order regardless of completion order, or every
   future grading read inherits nondeterministic ordering. Same doctrine as
   the merge contract's task-index ordering comment (`waves.js:1446–1447`).
6. **Semantic cross-path coupling — no new exposure, and no lost defense.**
   Same-stop resolvers are informationally identical under serial and
   parallel dispatch (§2.2): each sees only its own hunks file plus the
   same `contendingTasksBlock`. The T15 canonicalization class (a resolver
   making a legal-but-order-sensitive choice) operates *within* one file's
   blocks; two resolvers making mutually inconsistent canonical choices
   across two files (e.g., different name ordering conventions on two
   registration surfaces) is possible — but exactly as possible today,
   since serial dispatch shows neither resolver the other's reply. The
   defense is unchanged: post-fold suite + sealed exam (#177's posture),
   and the #177 semantic-miss measurement design already covers this
   stratum. Parallel dispatch adds nothing to measure that #177 does not
   already pre-register.
7. **Prompt surfaces untouched.** `RESOLVER_PROMPT` and the contended-merge
   STEP describe per-dispatch contracts, not inter-dispatch scheduling —
   dispatch concurrency is engine-side. No re-bake expected; the pin
   (`tests/test_no_prompt_drift.py` — parametrized from wave-merge.md BAKE
   blocks including `CONTENDED_MERGE_PROMPT`, `RESOLVER_PROMPT`) must stay
   green regardless.
8. **Sim-sentinel obligation.** Any `harnesses/*.js` change requires
   covering `.mjs` sims printing the `ALL SCENARIOS PASSED` sentinel
   (CLAUDE.md suite-gate rule). New scenarios owed: parallel fan over a
   multi-open stop (all applied, order pinned), failure-in-fan → single
   fallback, budget exhaustion mid-fan, transcripts in index order.

**Named test-pin inventory (the build's gate surface):**
`tests/frontier_merge.mjs` scenarios 2 (conflict-resolved), 5, 9m/9m2
(REJECTED retry / apply-ERROR), 9p/9p2 (waiting shape legal/mismatch), 9g/
9g2, 9n/9n2, 9f, 9i (count authority), 9d/9o/9o2/9q (selfChecks scope),
10a (work-list-to-complete), 10b (parked pre-scan), 10c, 11a/11b
(auto-resolved, commutes args); `tests/test_no_prompt_drift.py` (baked
prompts); `tests/sim_workflow.mjs` (whole-engine sim); kernel pins in
`tests/` for the §1b protocol table (fold/resolve stdout shapes and exits —
these do not change: the CLI contract is untouched by dispatch-side
parallelism).

---

## 6. Verdict

**Feasible with named preconditions — but premature until two conditions
hold, per the #177 pre-registration.**

*Feasibility:* distinct-path independence is structural, not assumed — the
kernel's state is per-path (`files[p]`), resolvers touch no repo and no
shared file, same-stop briefs are fixed before any dispatch, and the
engine's `parallel()` primitive plus its chunking pattern already exist.
The serial constraints that must survive (CLI applies, waiting-order guard,
retry, budget/fallback semantics) are all localized in the
`waves.js:1547–1685` work list and pinned by named sims. Nothing touches
the frozen periphery, the CLI protocol, or any baked prompt.

*Prematurity:* (1) the parallelizable conflict shape — a multi-open stop —
has **zero live observations**; every recorded conflict sits on one path,
so the build's realized win on the entire recorded corpus is zero minutes.
(2) #177 pre-registered the trigger for acting on resolver serial cost:
median wall share >15% at writer-width ≥6 over ≥5 contended runs (or
exceeding the serial review/gate tail) — currently ~8–13% derived at width
4 — and named auto-union coverage as the first response, which removes
dispatches outright where `Commutes:` applies (also never yet fired live).
Building parallel dispatch now would be machinery ahead of both its
threshold and its conflict shape, against the repo's earned-by-recurrence
doctrine.

*What would flip the verdict:* the first sense pass showing multi-open
stops occurring at all (readable today from `conflicts.json` — entries
sharing a stop with distinct `path` values; no new field needed), together
with #177's resolver-share threshold trip where the across-path fraction of
the share is material. Both readings ride the #177 designs unchanged.

---

## 7. Sources

- `skills/ultrapowers/harnesses/waves.js` @ `19c4264` — serial work-list
  comment and loop (1547–1685); resolver dispatch (1588–1596); apply via
  `dispatchMerge` at `TIER.mostCapable` (1443, 1612–1616); waiting guard
  (1643–1650); count-authority guards (1508–1545, 1656–1664); REJECTED
  retry (1630–1637); transcripts record (1604–1607); budget fn (1849–1853)
  and checkpoint (1563); `CONCURRENCY = 16` (1926); wave chunking + task
  `parallel()` fan (1964–2002); single-agent-pipeline comment (1185–1187);
  `contendingTasksBlock` (1374–1393); RESOLVER_PROMPT bake (628–653);
  FOLD_SCHEMA (799–840).
- `skills/ultrapowers/references/wave-merge.md` — resolver prompt (line
  222: "no repo to explore … touch nothing else"); contended merge-agent
  prompt (187: "moves no ref and writes nothing into the worktree").
- `skills/ultrapowers/kernel/repo_weave.py` — per-path state (lines 22,
  174, 204–208, 252, 270–276, 283, 310–318).
- `docs/superpowers/specs/2026-08-18-fold-native-authoring-program.md` —
  §1b engine loop (multi-open continuation, waiting reply, protocol table);
  §1c "Dispatch stays serial, one resolver at a time"; §2b consumer 3
  (auto-union); §Verification (named sim inventory).
- `docs/superpowers/specs/2026-08-21-width-semantic-defense-measurements.md`
  (#177, `a24b895`) — resolver share 4.73% tokens / 8–13% wall derived;
  n−1 serial dispatches; >15% threshold and response candidates.
- `evals/frontier/results/2026-08-14-t15-ab.md`,
  `2026-08-19-phase1-gate.md`, `2026-08-21-phase2-mechanics.md` — every
  recorded conflict on one path (`app/registry.py`); per-dispatch wall
  43.6–69.4s; fold CLI wall 0.8s; shakedown zero-conflict fold.
- `tests/frontier_merge.mjs` — scenario inventory quoted in §5 (waiting
  sims at lines 350–378, 844–891, 1012–1038); `tests/test_no_prompt_drift.py`
  (BAKE-block parametrization, lines 54–82); CLAUDE.md (sim-sentinel
  suite-gate rule; frozen-periphery clause).
