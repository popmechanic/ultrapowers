# Fleet evidence lifecycle, ephemeral ports, and sizing knobs (#269, #250, #212, #215, #216)

**Status:** slate spec for fleet run-9 (the first W2-representative drive). Fleet code
is sanctioned for change at this sitting per #250/#269's own scheduling notes ("rides
with the next fleet sitting" — this is it). Not plugin machinery: no release required
for fleet/ changes (CLAUDE.md), though the batch will ride the next release anyway
with #271/#259.

**Acceptance:** suite (default disposition; no seal).

## Problems (five issues, one surface)

1. **#269** — `fleet/tests/test_orchestrator.mjs:20` uses `const settle = () =>
   sleep(300)` as a sync barrier for TinyBase CRDT propagation (11 call sites). On a
   slow CI runner the foreign write lands after the sweep reads, so the claim-steal
   assertion sees `[]`. Red-flagged main on the 0.2.20 release commit; passes on
   rerun. A false-red generator on every push.
2. **#250** — every binding fleet test reserves a fixed port (8151 test_orchestrator,
   8152 test_shim, 8153 test_drive). Two suites running concurrently on one machine
   collide (EADDRINUSE); this red-baselined a waves run on 2026-08-25 and makes the
   repo suite concurrency-unsafe — including inside a single /ultrapowers run, whose
   same-wave implementers run the suite simultaneously.
3. **#212** — the #197 evidence pull writes `<dbDir>/sandbox-logs/…/sandbox-logs.tgz`
   and the gate read writes `<dbDir>/gate-read-<runId>.json` — both inside the
   orchestrator's persister dir, which operators wipe between runs by habit (run-6's
   evidence is already lost). The RUNBOOK gives no guidance either way, and whether a
   persisted `fleet.db` carrying prior-run rows perturbs a new run is untested.
4. **#215** — nothing captures what a sandbox actually drew. `stat` (cpu/mem samples)
   and `billing credits usage` (per-VM LLM spend) are only readable BEFORE
   `destroySandbox`; after #213 the credits number is a gateway-regression canary
   (must be flat — nonzero means the run slipped off the Max token back onto the exe
   gateway), and the stat numbers are the only evidence for W2 sizing.
5. **#216** — sandbox size is golden-bound (8 vCPU / 16 GB baked at golden creation);
   exe.dev's `cp` accepts `--cpu/--memory/--disk` but `provisionRun` never passes
   them, so per-plan sizing is a knob that simply doesn't exist.

## Design

Four implementation tasks on the `fleet/` surface only, plus one manual runbook line.
**Ordering constraint discovered while scoping:** until the port fix lands, the fleet
tests are concurrency-unsafe, so the port task runs alone in wave 1 and the other
three fork from a base that already carries it — making their own concurrent suite
runs safe. This is a real build-order dependency, not authoring-order.

### 1. Ephemeral ports (#250)

- `startOrchestrator` (`fleet/orchestrator.mjs`): accept `port: 0`; after the
  `'listening'` await, read `wss.address().port` as the bound port, use it for the
  loopback client URL (`:159`), and add it to the return object:
  `return { store, sweep, heartbeat, stop, port: boundPort }`. Explicit ports keep
  working unchanged (the RUNBOOK's live `port: 8180` stays valid).
- `driveOne` (`fleet/drive.mjs`): today `resolvedWsUrl` is computed at `:91`, BEFORE
  `startOrchestrator` at `:152`. Reorder: start the orchestrator first, take
  `orch.port` as the effective port, then compute `resolvedWsUrl` (when no explicit
  `wsUrl` was given) and thread the effective port into `provisionRun` (`:246-247`)
  and `destroySandbox` (`:138`).
- Tests: `test_orchestrator.mjs` and `test_drive.mjs` switch to `port: 0` and read
  the bound port back (test_drive's assertions at `:451/:454/:464` already
  interpolate `PORT` — they interpolate the read-back value instead; the restart
  scenario at `:348` restarts on the first run's bound port, preserving the
  persistence semantics). `test_shim.mjs` binds its own `WebSocketServer` — bind 0
  and read `wss.address().port`. `test_provision.mjs` binds nothing (exec is
  stubbed); its literal port strings stay.
- The 8151–8159 reservation convention in
  `docs/superpowers/plans/2026-08-21-fleet-w1-hardening-calibration.md` is a plan
  document (historical record) — not edited; the RUNBOOK note "pick a port outside
  the test range" is softened to "any explicit port works; tests bind ephemeral".

### 2. Poll-until-predicate settle (#269)

Test-only (`fleet/tests/test_orchestrator.mjs`). Replace the fixed sleep with a
bounded poll:

```js
const until = async (fn, what, capMs = 5_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < capMs) {
    const v = fn()
    if (v) return v
    await sleep(50)
  }
  throw new Error('until: timed out waiting for ' + what)
}
```

Each of the 11 `settle()` sites waits on the actual observable it was guessing at —
store-state predicates on the CRDT merge landing, e.g. the claim-steal barrier
becomes
`await until(() => orch.store.getRow('claims', 'claim:r1')?.holder === 'sb2', 'sb2 steal to reach the supervisor store')`
before `orch.sweep(T)`, and the orchestrator→client barrier polls
`c1.store.getRow('runs', 'r1')`. Absence-shaped sites (settle before asserting a
*clean* next sweep) use a **quiescence predicate** — poll until the client store has
converged to the just-written rows (e.g.
`until(() => c1.store.getRow('claims','claim:r1')?.revoked === true, …)`) — never a
fixed sleep [trim T3: the carve-out is deleted; a fixed sleep before an absence
assertion is a bounded false-green window that verifies nothing]. Only a site
genuinely inexpressible as a predicate may fall back to a commented sleep, decided
per site, not pre-licensed. The per-file budget stays far under
`test_fleet_suite.py`'s 120 s timeout (polls resolve in tens of ms normally).

### 3. Evidence lifecycle (#212 + #215, one task — both rewrite `pullLogsOnce`)

- **`evidenceDir` option** on `driveOne`, default `` `${dbDir}-evidence` `` (e.g.
  `/tmp/fleet-orch-live` → `/tmp/fleet-orch-live-evidence`). The sandbox-logs pull
  destination and the default `reportPath`/`detailPath` (gate read) move there;
  `detail.sandboxLogs` already names the path, so nothing downstream changes. The
  test pin at `test_drive.mjs:445-448` ("destination must be under dbDir") flips to
  "must be under evidenceDir, never under dbDir".
- **stat + credits capture** in `pullLogsOnce`, before `destroySandbox`, best-effort
  with `logPullTimeoutMs` applied **per command** (tar, stat, credits each get the
  bound): run `ssh exe.dev "stat <vmName> --json --range=24h"` → `<evidence>/stat.json`
  and `ssh exe.dev "billing credits usage --group=box --detail --json"` →
  `<evidence>/credits.json`. The JSON shapes are **captured from the live account**
  (2026-08-26), not guessed [flag U2]: stat is `{name, status, range, points:
  [{timestamp, cpu_cores, cpu_nominal, mem_used_bytes, mem_total_bytes, …}]}` at
  10-minute samples; credits is `{groups: [{box, cost_usd, cost_microcents, entries:
  […], requests, …}], total_cost_usd, month, …}`. Derivations, defined against those
  shapes: `detail.sandboxStat = {peakCores: max(points[].cpu_cores), meanCores:
  mean(points[].cpu_cores), peakMemBytes: max(points[].mem_used_bytes)}`;
  `detail.creditSpendUsd` = the `groups[]` row whose `box === vmName` → its
  `cost_usd`, else `0` when no row exists (no spend recorded = flat = the expected
  canary-green outcome; a nonzero value means the run slipped off the Max token back
  onto the exe gateway). Unparsable output → detail fields null, error pushed, raw
  file still written. Failures never block teardown. Exec-seam tested with a stubbed
  `exec` returning trimmed copies of the captured fixtures (so the parser is pinned
  against the real shape, not a shape the implementer invented). Also `detail` gains
  `effectivePort` — the orchestrator's bound port — which is triage-relevant and is
  the channel `test_drive.mjs` reads the ephemeral port back through [flag U1].
- Placement note [scope]: #215's wording says "the gate read carries both"; both
  fields land in `detail`, not `read` — the `read` is a pinned five-key contract
  asserted by full equality in `test_drive.mjs`, and `detail` is the extension
  surface. Deliberate reinterpretation, disclosed here.
- **dbDir persistence settled by test:** a `test_drive.mjs` scenario runs a second
  `driveOne` against the same `dbDir` (prior run's rows present) and asserts the new
  run's gate read is scoped to its own runId (spend sum, leaseContinuity, sweep). If
  that test is red, the fix is scoping the aggregation by runId in the reader — never
  documenting a wipe. "The reader" is a closed set [flag U5]: `spendObservational`'s
  `totalSpent(…, runId)` (`drive.mjs:414`), `observeClaim` (`drive.mjs:195-202`),
  `receiptsFor` (`drive.mjs:212-215`), and the orchestrator sweep's spend pass over
  all budgets (`orchestrator.mjs:201-250`, whose `:210` revoked-claim guard covers
  parked prior runs — the residual case is a gate-green prior run's unrevoked budget
  row, re-evaluated harmlessly when spend ≤ cap). RUNBOOK gains the explicit lines:
  keep `dbDir` across runs; never `rm` it; evidence lives outside it in
  `evidenceDir` — and the two now-stale path lines are updated: `RUNBOOK.md:198`
  (`<dbDir>/sandbox-logs/…`) and `:214` (`<dbDir>/gate-read-<runId>.json`) [flag U6].

### 4. Sizing knobs (#216)

- `provisionRun` gains optional `cpu`, `memory`, `disk`; when given they append to
  the clone command at `provision.mjs:91` as `--cpu=<n> --memory=<m> --disk=<d>`
  (golden's baked size when absent). **Validated before shell interpolation** [flag
  U3], matching the module's established validate-before-exec posture: `cpu` a
  positive integer; `memory`/`disk` matching `^\d+GB$`; a bad value is refused with
  a thrown error before the clone command is issued. `driveOne` gains `sandboxCpu`/
  `sandboxMemory`/`sandboxDisk` pass-throughs. Exec-seam pinned in
  `test_provision.mjs` (the `cmds[0].startsWith(...)` equality pins move
  accordingly), plus refusal tests for invalid values.
- Deriving size from the compiled plan's widest wave is RUNBOOK guidance in the
  driver snippet (a comment showing `width + 2` vCPU, **clamped to the plan's
  `max_cpus`** [scope: the clamp from #216 rides the comment]), not machinery —
  there is no committed driver CLI to put it in, and calibration waits on #215's
  stat data (W2).
- The orchestrator resize (`ssh exe.dev "resize fleet-orchestrator --cpu=1
  --memory=2GB"`) is a **manual** runbook task — live infra, operator-run.

### Wave-shape facts the plan must carry [T7/U4]

- Wave 1's own suite runs still bind fixed ports (the fix isn't merged yet while it
  builds), so the standing "never run two suites concurrently on this machine"
  caveat holds for exactly one wave longer; the drive procedure must not overlap
  wave 1 with any other local suite.
- Tasks 3 and 4 both edit `fleet/drive.mjs` (the `driveOne` options object and the
  `provisionRun` call site) and both touch `RUNBOOK.md` — real same-wave text
  contention that folds at merge. The plan gives each task stable anchors: task 4
  touches ONLY the options destructure and the `provisionRun` argument list; task 3
  owns `pullLogsOnce`, the evidence paths, and the detail fields.

## What this trades away

Ephemeral test ports remove the documented 8151–8159 reservation as a coordination
mechanism; nothing else consumed it (test_provision's literals are inert strings).
The stat sampler is 10-minute-granularity, so `peakCores` is a floor estimate on a
~25-minute run — good enough to distinguish idle from saturated, named in the detail
field's doc line. The dbDir persistence test may surface a real scoping bug
(untested today); that is the point — the task carries the fix duty rather than
deferring it.

Not in scope: any change to the orchestrator's sweep/guard/spend logic beyond runId
scoping if the persistence test demands it; the committed driver CLI (#193 item 6);
quota preflight (`billing usage` before provisioning — floated in the docket,
unbuilt); engine or plugin surfaces (this slate is fleet-only and needs no release).

## Trim review

**Author disclosure — Adds:** `until()` poll helper (test-only); bound-port return on
`startOrchestrator` + `detail.effectivePort`; `evidenceDir` option + default;
stat/credits capture + `detail.sandboxStat`/`detail.creditSpendUsd`; `cpu/memory/disk`
knobs on `provisionRun` + `driveOne` pass-throughs (validated); one dbDir-persistence
test scenario. **Removes:** the fixed-sleep settle (and its absence carve-out); fixed
test ports and the 8151–8159 reservation convention; evidence-inside-dbDir placement
(and the wipe-vs-keep ambiguity).

**Reviewer verdicts** (fresh-context dispatch, 2026-08-26; grade
`netConceptDelta: up` — "mildly, and warranted; every addition directly demanded by
one of the five operator-approved issues, each with a safe default"):

- T1 (port fix over file lock) / T2 (`${dbDir}-evidence` default, gate read moves
  too) / T5 (sizing knobs minimal) / T6 (persistence test bounded) / T7 (ordering
  real, conversion set complete) — **ENDORSED**, no change.
- T3 (delete the absence-sleep carve-out; quiescence predicates) — **ADOPTED** (§2).
- T4 (stat parsing needs a shape contract or raw-only narrowing) — **ANSWERED by
  capturing the real shapes**: live `stat`/`credits` JSON was pulled from the
  account on 2026-08-26 and the derivations are defined against it (§3); the derived
  fields stay because #215's canary needs a parsed number and the fixture removes
  the self-certification risk. Raw files are still written regardless.
- U1 (bound-port read-back channel) — **ADOPTED**: `detail.effectivePort` (§3).
- U2 (shape contract + timeout semantics) — **ADOPTED**: captured fixtures;
  `logPullTimeoutMs` is per-command (§3).
- U3 (validate sizing knobs before interpolation) — **ADOPTED** (§4).
- U4 (tasks 3/4 same-file contention undeclared) — **ADOPTED**: stable-anchor
  contract in §Wave-shape facts; the plan's tasks carry it.
- U5 (name the reader surfaces) — **ADOPTED** (§3).
- U6 (stale RUNBOOK path lines) — **ADOPTED**: RUNBOOK:198/:214 named (§3).
- U7 (restart-on-bound-port reuse race) — **ACKNOWLEDGED as deliberate**: ephemeral
  ports are effectively never immediately re-grabbed; noted, not machinery.
- Scope notes (max_cpus clamp in the RUNBOOK comment; detail-vs-read placement
  sentence) — **ADOPTED** (§3, §4).
