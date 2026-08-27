# Fleet store liveness (#288) + self-approved-ack gate green (#191)

**Issues:** #288 (store silence mid-run), #191 (shim greens only on bare PASS).
Ride-alongs: #290 (drive critic residuals), #282 items 1–2/5 (RUNBOOK papercuts),
#211 (sandbox host-key posture).

## Problem — measured, not narrated

Across runs 9/9b/9c (2026-08-26) the orchestrator store received **zero sandbox
writes** — not the initial claim, not `claimed`/`running`, not spend, not the
terminal status — while the sandbox shim ran to completion and printed its
outcome normally (`shim.log` in the evidence corpus). The three `fleet.db`
files hold only driver-side rows (`runs` seed, `budgets`, `meta.heartbeat`).

**Root cause, reproduced locally against the shipped tinybase 6.7.5 + ws 8:**
`createWsSynchronizer(store, new WebSocket(url))` **resolves silently when the
WebSocket handshake fails** — both on connection-refused and on a 401
`verifyClient` rejection — and `startSync()` resolves too. Every subsequent
`setRow` is a local no-op sync-wise. The socket's `readyState` is `3` (CLOSED)
after the silent resolve, so the failure is mechanically checkable — the shim
just never checks. Any transport failure (tunnel dead, token rejected, timing)
therefore produces a full-length, token-spending run that is invisible to the
orchestrator, and the driver's only signal is a 30-min heartbeat timeout with
an empty store.

Three secondary defects compound it, each independently sufficient to break a
long run even over a **live** socket:

1. **Renew cadence is coupled to ttl** (`renewEveryMs ?? ttlMs/3`, shim.mjs).
   At the #279-mandated `ttlMs` 4 h that is one store write per **80 min**,
   while the driver's progress watchdog (`heartbeatTimeoutMs`) fires at 30 min
   of silence — so a healthy engine phase >30 min is structurally killed, and
   spend rows (sampled only at renew boundaries) never land (`ledger: 0`).
2. **Terminal writes race teardown** (#282 item 3): `runShim` writes
   `parked`/`gate-green` and immediately `stopSync()`/`destroy()`s with no
   flush — the ws round-trip carrying the final status can be cancelled
   (the orchestrator's own `stop()` documents the same measured loss mode).
3. **The driver has no fail-fast on a sandbox that never connects**: a dead
   transport is indistinguishable from a slow run until `heartbeatTimeoutMs`,
   and the drive emits no mid-run progress lines at all (9d's nohup log is
   0 bytes — nothing was ever printed before the driver died).

Separately (#191): `readGateGreen` returns true **only** on `verdict ===
'PASS'`. A run that self-approved a NEEDS_ACK gate under the #281 standing
directive (`run-<stamp>/standing-approval.json` written, approve executed)
still parks, so any plan with an honest `deferred:external` claim can never
reach `o1: true` headlessly.

## Design

All changes live in `fleet/**` (+ its tests + RUNBOOK). No engine surface, no
FROZEN-periphery file (`ultra_gate.py`, `gate_check.py`, `run_lock.sh` are
read, never edited).

### 1. Verified ws transport (shim.mjs, shim-main.mjs) — the #288 core

- One seam, one helper: `connectOpenWs(url, {timeoutMs, log})` (exported,
  shim-main.mjs) resolves an **OPEN** `WebSocket` — with persistent
  `close`/`error` listeners that log to shim.log — or rejects with a legible
  reason (`error`/`close`/timeout during connect). `runShim` gains an
  `openSocket` parameter **defaulting to `connectOpenWs`** — the injectable
  seam IS the helper, not a second shape beside it. `createWsSynchronizer` is
  never handed an unverified socket, on either client.
- **Fail fast, before tokens burn:** if the shim cannot open its socket, the
  run must not launch the engine. On connect failure `runShim` returns
  `{status: 'no-store', error}` without calling `invokeRun`; `main()` logs the
  reason to shim.log and exits non-zero.
- **Verified publish (flush + one rescue, one function):** a
  `deliverAndClose(synchronizer, ws, {store, url, openSocket, log})`-shaped
  helper runs at every teardown boundary (runShim's terminal write,
  shim-main's trailing publish): if the socket is OPEN — `await
  synchronizer.save()`, bounded wait for `ws.bufferedAmount === 0`, short
  settle, teardown; if the socket is dead — **one** fresh
  `openSocket`+synchronizer over the same store (a MergeableStore re-sync
  pushes all local state, terminal status and receipts included), then the
  same flush. A rescue that also fails — including a 401 on a token whose ttl
  the run outlived, now mechanically visible as a close-during-connect — is
  logged and given up: fail-closed, but loudly. The rescue is kept (not
  insurance-on-insurance): the tunnel's lifetime across a multi-hour engine
  phase is exactly the unverified leg #288 item 2 names, the engine spend is
  already sunk at terminal time, and one reconnect is the difference between
  a supervisable run and a lost one.

### 2. Renew cadence cap (shim.mjs)

`renewInterval = renewEveryMs ?? min(floor(ttlMs/3), RENEW_CAP_MS)` with
`RENEW_CAP_MS = 5 * 60_000`. Lease renewals (and the spend sampling that rides
them) land at ≤5-min cadence regardless of ttl, so the driver's watchdog has a
real progress signal and a 4-h-ttl run stays visibly alive.

### 3. Driver fail-fast + live progress (drive.mjs)

- `claimTimeoutMs` (default 10 min): if the run's status is still `pending`
  and no claim row has appeared this long after provisioning, the watch stops
  with `neverClaimed: true` in the detail and a distinct error — a dead
  transport is now a 10-minute legible failure, not a heartbeat mystery.
  Necessary even with the shim-side fail-fast: the shim starts detached, so
  its non-zero exit is invisible to the driver. A `neverClaimed` stop exits
  into the **existing** teardown path unchanged — evidence pull,
  `destroySandbox`, report write all still run — and the sim pins that.
- `progressLog` seam (default: timestamped lines via `console.error`): logs
  provision start/done, every progress-key transition (status, claim epoch,
  spend/receipt counts), timeout/terminal/publish/teardown boundaries, and
  the final read — the live progress surface #282 item 4 asked for, in the
  drive log itself.

### 4. Shim runs the base under test (provision.mjs)

`shimStartCommand` checks out `fleet-base` **before** starting the shim.
Today the shim executes the golden image's stale checkout while the stamp
attests `fleet-base` — fleet fixes like this one would not even run on the
next drive without a golden rebuild. Command contract, pinned by the
command-string test: the checkout's own output (including a dirty-tree
refusal) is redirected into shim.log first, and `&&` gates the nohup — a
failed checkout starts nothing, leaves its reason as shim.log's only content,
and surfaces via the driver's `claimTimeoutMs`. Shape:
`ssh <flags> <vm> 'git -C /home/exedev/repo checkout -q fleet-base
> /home/exedev/shim.log 2>&1 && <env prefix>nohup node
/home/exedev/repo/fleet/shim-main.mjs >> /home/exedev/shim.log 2>&1 &'`.
(`invokeEngineRun`'s own checkout stays — belt and suspenders. This element
is net-new deployment machinery, owned as such in the Trim review below.)
The trailing `&` backgrounds the whole AND-list, so the checkout also runs
detached — provisionRun never learns its exit status; a failed checkout
surfaces only via shim.log plus the driver's claimTimeoutMs.

### 5. #191 — self-approved NEEDS_ACK may green, mechanically

`readGateGreen(receiptFile)` becomes verdict-shaped, all evidence read from
the **same run directory** as the machine-written receipt:

- `PASS` → green (unchanged).
- `NEEDS_ACK` → green **iff all three hold**:
  1. `standing-approval.json` exists and parses (the #281 sidecar, written
     before the approve);
  2. every ack in the receipt's `gateCheck.acks` has type `deferred:runtime`
     or `deferred:external` — the standing grant's class, re-checked
     mechanically from machine-written bytes, so a session that wrongly
     self-approved a `coverage` or `deferred:manual` ack cannot green;
  3. the approve actually executed: `approve-receipt.json` exists, parses,
     has `mode: 'approve'` and a `stamp` matching the receipt's, **and**
     `.claude/ultrapowers/RUN_LOCK` no longer holds this stamp — the lock
     release is `ultra_gate.py --approve`'s own on-disk side effect, so this
     half of the leg is machine-observable, not transcribed. (The approve
     receipt's hygiene fields — `lockReleased`, `sweepFailures`,
     `wfRunsUnreadable` — are deliberately NOT checked: worktree-sweep
     hygiene inside a VM destroyed minutes later says nothing about the
     result's validity.)
- anything else (BLOCKED, bare NEEDS_ACK, missing/unreadable receipt) → red.

`STANDING_DIRECTIVE` gains one clause: after a sanctioned self-approve, save
`ultra_gate.py --approve`'s JSON output verbatim to
`run-<stamp>/approve-receipt.json`. (The gate scripts are FROZEN; nothing here
edits them — the lock file is read, never written.)

**Trust posture, stated plainly:** `standing-approval.json` and
`approve-receipt.json` are session-authored (an LLM transcribing under a
prompt clause), like the run's `gate-green` status itself — leg 2 and the
lock check are the machine-observable halves. This stays inside the fleet's
existing trust boundary: the driver's cross-boundary verification remains the
receipt-resolvability read (sha/path dereference on the fetched branch), and
nothing sandbox-authored is newly trusted.

### 6. Ride-alongs

- **#290-1:** move the `path.join` calls in `pullLogsOnce`/`captureJson`
  inside their try blocks (a throwing join must not skip teardown).
- **#290-2:** hoist the `isSafeVmName` guard to the top of `pullLogsOnce`
  (before `sandboxLogPullCommand` interpolates `vmName`) and add the refusal
  test.
- **#290-3:** end-to-end test that `driveOne({sandboxCpu, sandboxMemory,
  sandboxDisk})` threads the flags into the emitted `cp` command.
- **#211:** every **sandbox-bound** command gets
  `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` (ssh flags;
  `-c core.sshCommand=…` for the git push/fetch) — sandboxes are ephemeral,
  there is nothing to pin. The issue's cheaper alternative (`ssh-keygen -R`
  in `destroySandbox`) is rejected deliberately: it does not survive a
  crashed teardown and does not cover the drive-side fetch, which are exactly
  the paths where a stale key strands a run. Lobby (`exe.dev`) and golden
  commands keep the normal config. RUNBOOK gains the never-reuse-a-runId
  rule.
- **#282-1/2/5 (RUNBOOK):** golden preflight line comparing
  `ssh fleet-golden 'claude plugin list'` against the base ref's manifest;
  the update command is `claude plugin update ultrapowers@ultrapowers` (bare
  name fails); the driver snippet names `runId`/`capTokens`/`ttlMs`/
  `heartbeatTimeoutMs` explicitly.

## Verification

Suite disposition (default). Every behavior above lands with a sim in
`fleet/tests/*.mjs` printing the `ALL TESTS PASSED` sentinel (the suite-gate
runs them when harness/fleet JS changes is N/A — fleet tests join via
`tests/test_fleet_suite.py`), each file exiting 0 inside the 120 s cap:

- connect-refused / 401 / timeout → `runShim` returns `no-store`, engine never
  invoked (spy), shim-main exits non-zero with the reason logged;
- dead-socket-at-terminal → rescue reconnect delivers the terminal status +
  receipts to a live server store (in-process ws server, real sync);
- renew cadence: `ttlMs` 4 h → renew timer ≤ `RENEW_CAP_MS`;
- flush: terminal write present in the server store after teardown (the
  measured 5/5-loss shape, now 0/5);
- driver: never-claimed run stops at `claimTimeoutMs` with the distinct
  detail; progress lines emitted through the seam;
- `readGateGreen`: PASS green; bare NEEDS_ACK red; NEEDS_ACK + all three
  evidence legs green; each leg removed/violated individually → red
  (including a `deferred:manual` or `coverage` ack, a stamp mismatch);
- command-string pins updated for the host-key flags + fleet-base checkout;
  sizing pass-through and `isSafeVmName` refusal covered.

`python3 -m pytest` green at the 1169 baseline (plus the new tests).

## Out of scope

- Engine/gate surfaces (FROZEN periphery untouched).
- Mid-run ws auto-reconnect beyond the single terminal rescue (a dropped
  socket mid-engine-phase still costs the mid-run spend rows; the terminal
  publish is what o1 needs, and the rescue covers it).
- Publishing the parked run's ack list into the store (#282 item 4's larger
  design) — the progress lines + evidence pull cover triage for now.
- Why the 9-series handshakes failed while runs 7/8 succeeded: not
  reconstructable post-hoc from the corpus (the silent client erased the
  evidence); the new lifecycle logging + fail-fast turns any recurrence into
  a named, 10-minute failure on the next live run.

## Trim review

**Author disclosure (input, not verdict).** Adds: verified-connect helper +
`no-store` status; verified-publish (flush + one rescue); `RENEW_CAP_MS`;
`claimTimeoutMs` + `progressLog`; fleet-base-at-shim-start; three-leg
NEEDS_ACK green + session-written `approve-receipt.json` + one
STANDING_DIRECTIVE clause; sandbox host-key flags; #290 fixes; RUNBOOK lines.
Removes: nothing (the renew-interval coupling is replaced, not removed).

**Reviewer verdicts (fresh-context, one dispatch)** — adopt-or-answer:

1. *Merge the two connect seams into one* — **adopted**: `openSocket`
   defaults to `connectOpenWs`; no second shape.
2. *Terminal rescue is insurance-on-insurance; trim candidate* — **answered
   (kept)**: the tunnel's lifetime across a multi-hour engine phase is the
   unverified leg #288 item 2 names; spend is sunk at terminal time; rescue
   and flush are merged into one verified-publish function so the concept
   count does not double. Reviewer's thicken (rescue with an outlived token
   401s) — **adopted**, named as the logged give-up path.
3. *State that `neverClaimed` still runs teardown/evidence/report* —
   **adopted**, pinned in the sim.
4. *Element 4 under-specifies the composed shim-start command* — **adopted**:
   command shape pinned in spec and test.
5. *Leg 3 over-pins hygiene fields; substitute a machine check* —
   **adopted**: hygiene fields dropped; RUN_LOCK release (approve's own
   on-disk side effect) added as the mechanical half. *Label the trust
   posture* — **adopted** (Trust posture paragraph).
6. *#211 picks the invasive option without defending it* — **adopted**: the
   one-sentence defense now stands in the element.

**Scope reconciliation (reviewer):** element 4 is net-new deployment
machinery (owned in its element); element 5 pulls #191's fix forward from the
issue's own "W2's design" disposition — owned: the operator's standing
instruction for this cycle mandates fixing #191 now with exactly this shape
(#280/#281 changed the landscape the issue was written in); the terminal
rescue exceeds #288/#282-3's literal asks (defended in item 2 above);
`progressLog` substitutes for #282-4's store-published summary (declared in
out-of-scope).

**Reviewer's `netConceptDelta`: up** — ~nine new named mechanisms, zero
deletions. Recorded as graded; the operator's cycle instruction sanctions the
scope.
