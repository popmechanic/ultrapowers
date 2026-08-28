# The Width Program — fleet-scale operation: wide plans, distributed sealed drains, run-level fold, coordinated by a TinyBase store

**Status: SPEC (rev 4) — OPERATOR-APPROVED 2026-08-21 (approval adjudicated trim rounds 1–3; all findings adopted or answered). The destination of wayfinder map
#174, whose 9 tickets were resolved 2026-08-21 and whose Decisions list this
document compiles into phases. Sibling to
`2026-08-18-fold-native-authoring-program.md` (the enabler program, shipped
through 0.2.17); same house rules: phases are measurement-gated, nothing
architectural is kept on principle, the verification periphery stays FROZEN.**

Every mechanism below carries the ticket that decided it (#175–#183) or the
document that grounds it. Nothing here re-litigates a map decision; changes
to those decisions go back through the map issue, not this spec.

## Background — what is decided and what is measured

- **Authoring (#175):** plans stay a steerable session practice —
  contract-first: a serial architect authors the skeleton (tasks,
  Type/Depends-on, Interfaces, Commutes, test contracts); parallel
  subagents fill bodies. Judge-panel decomposition is deferred behind
  measurement. No engine plan-authoring workflow.
- **Integration (#176):** N run branches fold into a **docket frontier**
  with the wave-fold machinery one level up; incremental, arrival order;
  cross-run folds are uncontracted, so semantic contention **parks the
  run** while others keep folding; post-fold verification = full committed
  suite + that run's sealed exam against the post-fold frontier tree; red ⇒
  unwind that fold, park the run.
- **Human surface (#181):** park by default; page only on fleet stall,
  API-spend anomaly, or the standing security list. Per drained docket: one
  machine-written **drain manifest** (receipt fields verbatim + paths,
  #171 one level up) with a consolidated **batch SMOKE** section re-aimed
  at seams *between* plans (advisory, never a gate input). Sealing is an
  **AFK fleet lane** on API billing.
- **Doctrine (#180, shipped `6a3fb8c`):** superpowers is contained to HITL
  sessions — **fleet sandboxes never install it**; ticket ownership by
  `wayfinder:*` label; bare "frontier" is banned (merge/map/docket).
- **Defense (#177, `2026-08-21-width-semantic-defense-measurements.md`):**
  three pre-registered measurements (semantic-miss strata, resolver wall
  share, straggler cost) with baselines and thresholds; the escalation bar
  is existence-form. The record holds zero confirmed semantic misses.
- **Parallel resolvers (#183, `2026-08-21-parallel-resolver-dispatch.md`):**
  feasible, premature — every live conflict ever recorded is single-path;
  build only on its named preconditions.
- **Store (#178, prototype branch `claw/proto-178-store-schema`):** schema
  validated live against MergeableStore CRDTs — runs / claims / budgets /
  spend (append-only, writer-namespaced) / receipts (git pointers). Claim
  state is a pure function of (row, clock). The plain ws-server is a
  guard-less relay: the merge guard is a **post-hoc converge-away sweep in
  the orchestrator process** (a predicate over its own synced store, the
  prototype's shape — not a separate service), defends bugs not
  adversaries.
- **Provisioning (#179, `2026-08-21-fleet-provisioning-facts.md`):** `cp`
  clones a VM in ~0.7s with full disk; Claude Code preinstalled; **API
  auth is zero-secrets via the exe.dev LLM integration (proven live)**;
  store tokens are SSH-written at claim time, never baked into images.
  Plan upgraded to XLarge: 16-vCPU pool; an 8-vCPU runner gives 6
  concurrent agents (`nproc` presents 1:1); practical shape ≈ 2-vCPU
  orchestrator + 6–8-vCPU runners, ~2 pool-saturating concurrent runs —
  matching the subscription token window's ~2–3.
- **Dashboard (#182, prototype branch `claw/proto-182-fleet-dashboard`):**
  variant C, **Attention triage** — pages and parks render full-width with
  why + next act; healthy runs collapse to a tickertape. Noise =
  everything green.

## Goal and pre-registered outcomes

Ship the ability to drain a sealed docket across exe.dev sandboxes with the
operator AFK between plan approval and drain review, without weakening any
verification the single-run engine already performs.

Pre-registered outcomes (read at each phase gate, §W1d/§W2d):

- **O1 (works at all):** a full remote run — provision → claim → run →
  gate-green → receipts — completes with every receipt binding to a git
  sha reachable from the fetched run branch, zero store-caused failures.
- **O2 (width pays):** a 2-run concurrent drain's wall clock beats the
  **measured serial comparator** — the same docket drained serially in one
  sandbox, run once at the W2 gate as a paid measurement arm (same
  hardware class, same billing). The token ratio is **record-and-read**
  at the same gate (reported beside the T15 fold precedent of 1.111×;
  the operator adjudicates) — no pass/fail token constant is
  pre-registered, because none is grounded.
- **O3 (defense holds):** the #177 reads accrue with **S3 = 0** (no
  escaped semantic miss). One confirmed S3 fires that doc's escalation
  bar and pauses width scaling until adjudicated.
- **O4 (attention economics):** every operator intervention traces to a
  park card or page — nothing the operator needed was discovered outside
  the manifest/dashboard surface. **Read point: the W2 gate (over its ≥2
  drains), then a standing read through the first 3 real drains.**

## Non-goals (this program)

- Live CRDT sync of working trees (breaks frozen verification contexts).
- OIDC/MCP auth for fleet machines; vendoring Julian code; adopting celld
  now (watch at ~0.3+ — two recorded drivers: standing frontier
  persistence, adversarial store guarding).
- Any change to the frozen verification periphery (gate scripts, seal
  subsystem, compiler diagnostics vocabulary).
- Moving plan authoring inside the engine (#175 decided session practice).
- Building Phase-W3 machinery ahead of its pre-registered trigger.
- Token-supply scaling beyond one account.

## Where it lives

- New top-level `fleet/` (repo code, plain node, no build step — the
  author's delegated choice, matching the viewer/kernel no-build
  convention): the orchestrator process (ws-server wiring + in-process
  guard sweep + provisioner + drain driver + manifest writer), the lifted
  store module, and the **fleet run shim** — the small sandbox-resident
  client (delivered with the run assignment) that claims and renews the
  lease, appends spend rows from the run report's token counters, flips
  run status, and reports gate-green. The shim exists for two reasons:
  spend rows are **guard-enforced** writer-scoped (the `<writerId>:<seq>`
  namespace makes a proxied spend row a literal guard violation), and
  renews must come from the sandbox for **liveness semantics** — a proxied
  renew would defeat the dead-sandbox lease-expiry detection §Error
  handling depends on. It **wraps** the run invocation and the run engine
  stays unchanged. **No `anthropic` SDK and no API key anywhere in
  `fleet/`** — sandbox model access rides the exe.dev LLM integration
  (session auth, not repo code).
- The run engine (`skills/ultrapowers/harnesses/waves.js`) is **unchanged
  in W1** and untouched by the docket-fold driver in W2 (which drives the
  existing fold kernel CLI from outside the run, one level up).
- Prototype primary sources stay on their throwaway branches; lifted code
  is rewritten under tests, per prototype doctrine.

## Phase W1 — one remote run, end to end (the minimal O1 slice)

**W1a. Golden sandbox and execution posture.** One hand-maintained golden
VM: exeuntu + node + the ultrapowers plugin + a warmed repo clone + **no
superpowers** (#180) + **no credentials of any kind**. Per run: `cp` the
golden VM, SSH-deliver the run assignment and a fresh store token
(short-TTL, orchestrator-minted — never in the image; the
snapshot-shared-lease trap), start the run headless under
`ANTHROPIC_BASE_URL=https://llm.int.exe.xyz` with a dummy
`ANTHROPIC_API_KEY` (#179, proven), under the fleet run shim (§Where it
lives). The run executes with full permissions **inside** the sandbox —
the disposable VM is the permission boundary; it holds nothing but the
clone, the shim, and the short-TTL store token. The current base sha
reaches the sandbox at provision time: the orchestrator **pushes** the
base ref over the same SSH transport it later pulls from (the golden
clone is only as fresh as hand-maintenance). **W1a preflight probe:**
before the first real run, verify VM→VM `git fetch` over SSH end to end —
it is the one transport link no #179 fact demonstrates; the named
fallback is symmetric read-only git remotes over the `https://<vm>.exe.xyz`
proxies — the orchestrator pulls run branches from the sandbox's, and the
sandbox fetches its base ref at provision from the orchestrator's. Runner tier
6–8 vCPU (width w needs w+2). **Sandboxes are deleted after fold/park —
never recycled** (a reused sandbox carries prior-run residue; clone-per-run
costs 0.7s). The run stamps its plugin version + engine sha into its run
report (the join key every #177/W2d read needs).

**W1b. Orchestrator, store, and branch transport.** A 2-vCPU orchestrator
sandbox runs the plain TinyBase ws-server with the #178 schema, **backed
by its per-path SQLite persister** (the substrate research's supported
mode). The persister exists for one stated reason: **§W1c's hard spend cap
depends on ledger continuity across orchestrator restarts** — without it,
a restart would erase the very sums the cap enforces. (Persisted claims
are also a real recovery side benefit: a lost claims row re-derives as
*free*, not expired, which would fail in-flight sandboxes' renews and
abandon their runs — persistence is what lets §Error handling's
renew-on-reconnect resume them.) The converge-away guard
runs as a sweep in the same process. Claim/lease logic lifts from
`schema.mjs` (rewritten under tests — including one deliberate delta: the
guard grants the orchestrator process a **supervisory exemption** so its
own §W1c hard-action revoke of a held claim is not converged-away; a
verbatim lift would reject it at the holder check before the revoke
exemption is reached. The rewrite carries the test case for exactly
this). Store rows carry pointers and small
scalars only — receipts are `{sha, path, verdict-as-display-hint}`;
content authority is git. **Branch transport: the orchestrator PULLS run
branches from sandboxes over SSH** (`git fetch ssh://<sandbox>`); sandboxes
hold no origin credential and by policy never initiate transport (the repo
is public, so this is policy, not capability — stated honestly). The
orchestrator alone holds a push credential, and only it writes
`fleet/<runId>` branches and the frontier ref to origin. Main's existing
branch protection is untouched. Stated honestly, the orchestrator's full
credential set is: the **account-level exe.dev SSH credential** (it
provisions, deletes, and reaches every sandbox — strictly more than a
push credential) plus the **sole origin push credential**. That
concentration is the design: one hardened box instead of N disposable
ones.

**W1c. Spend authority.** `capTokens` is set per run by the docket sweep
(from the plan's size class) and a docket cap over all runs; both live in
`budgets`. Sandboxes append spend rows (writer-namespaced, #178) from the
run report's token counters at task boundaries. Two enforcement layers,
per the #178 advisory/post-hoc split: (1) **page** (class 2) when docket
spend crosses its cap projection — the trailing-median burn-rate page is
statistically empty below a window of runs, so it **activates only once a
trailing window of ≥5 runs exists** (W2 at the earliest); (2) **hard
action** when a run's ledger sum exceeds its `capTokens`: the orchestrator
revokes the claim (explicit `revoked`, #178 semantics), deletes the
sandbox, and parks the run with the overshoot as its why — and because a
revoked claim is claimable by no one, **the park card's next-act includes
the explicit operator claim reset**, or the drained run would wedge at
claim time. The anomaly multiple, cap defaults, and the §W1d
spend-vs-report tolerance are **set at the W1 gate from the first run's
measured burn** — pre-registering the mechanism now, the constants when
data exists. **Unit (decided 2026-08-28, distill P3):** `capTokens`, the
spend ledger, `spendObservational`, and every W2 spend constant are
measured by the shim's `readSessionTokens` sum — never by the engine
workflow's own `totalTokens`, which counts cache reads and every subagent
and read 3.1× the ledger on run-17 (590,339 vs 191,668). A constant set
against the wrong measure fires the hard action at a third of the intended
headroom, or never.

**W1d. Gate read.** **O1**, plus: lease-renewal continuity across the run
(no false expiry), every receipt the run produced resolvable at its sha
on the fetched branch, the version stamp present, and spend rows summing
to within the run report's own token totals — an **observational** read at
n=1 (the tolerance it sets is derived from this same run; it becomes
pass/fail from W2 on). The W1 plan's sealed exam is
authored **the existing in-session way** — the AFK sealing lane debuts in
W2 where n>1 makes it earn (trim T1). Rollback: W1 failure modes are
provisioning/auth/store bugs — fix or abandon costs nothing; the run
engine was never touched.

## Phase W2 — width: concurrent drains, docket frontier, attention surface

**W2a. Concurrent drains + the sealing lane.** The docket sweep
(unchanged, HITL) produces plans; sealed exams are authored by the **AFK
sealing lane** — sandboxes on API billing, same seal-author brief, pinned
effort, RED-proof through the exact gate runner; only *where* the author
runs moves (#181). The authored exam travels the same transport as
everything else: the orchestrator pulls it from the sealing sandbox and
pushes it to origin before dispatch, so runs receive it in their base.
The drain driver dispatches runs to ~2 concurrent
sandboxes (pool arithmetic, #179); each sandbox's shim makes the actual
claim, guard-legally. Plan dependencies serialize at
dispatch (#176).

**W2b. Docket-frontier fold.** As each run goes gate-green (in arrival
order): fold its branch into the docket frontier with the existing fold
kernel CLI driven from the orchestrator's integration checkout. Text
conflicts get resolver dispatches under the same kernel contract as
in-wave (hunks file in, reply directory out, one dispatch at a time,
cross-run = uncontracted ⇒ semantic contention parks the run, no operator
turn). **The cross-run resolver brief is a named W2b design deliverable**:
the in-wave brief's contending-context block is per-plan, so the
docket-level brief must be rebuilt from the *two runs'* plan task bodies —
it gets its own review against the recorded in-wave brief before first
use (trim U4; "same as in-wave" is the contract, not the brief text).
Then the full committed suite + **that run's sealed exam re-run against
the post-fold frontier tree**; red ⇒ unwind the fold (reset the frontier
ref to its pre-fold sha), park the run. All fold logs/receipts land in
git; the store gets pointers + status transitions.

**W2c. Attention surface + drain manifest.** Drain-manifest v1 debuts
here (trim T2): per-run receipt fields verbatim + paths + aggregates +
the batch SMOKE section (concatenated per-plan probes, deduped, re-aimed
at seams between plans; advisory only). Dashboard = the #182 variant-C
page over the store + `ssh exe.dev stat --json`; park cards carry the
receipts-verbatim detail line; the fold lane is a drill-in. Pages wired
to the three #181 classes: **class 1 (fleet stall)** fires when the
frontier cannot advance — orchestrator heartbeat absent or all runs
parked; **class 2 (spend)** per §W1c; **class 3 (security)** is produced
by the orchestrator scanning run reports and receipts for the engine's
own escalation and BLOCKED markers (the run-level escalation list the
engine already emits — the fleet adds the scanner, not a new list). A
converge-away storm (repeated guard violations from one writer) **parks
that run** — the default doctrine, not a page.

**W2d. Sensors + gate reads.** Ship #188 (resolver ROLE_MARKERS entry —
additive, sensor-side). The #177 designs go live and read over ≥2 drains:
semantic-miss strata (S3 must stay 0; S2 stratified by writer count),
measured resolver wall share (replaces the derived 8–13%), straggler
series at the first observed width >4 — plus the drain-level counters
this spec's own outcomes need (parks per drain, unwind rate, O2's
wall/token reading against the measured serial comparator, O4's
intervention audit; spec-licensed, disclosed in Adds). Rollback: the
docket-fold driver is outside the run engine — reverting to serial
drains is deleting a scheduler, not surgery.

## Phase W3 — escalations fire by number only

Nothing in W3 is built on a narrative. Each trigger's constants live in
their pre-registration documents — cited, not copied, so a source
amendment cannot leave a stale second copy (trim T3):

| trigger (constants live in the cited source) | response |
|---|---|
| one confirmed S3 escaped miss (#177 §3, existence-form) | pause width; pick among #177's five named stronger defenses by the evidence, per subtraction-eval doctrine |
| resolver wall-share threshold (#177 §2b) with a material across-path fraction (#183 preconditions) | build parallel resolver dispatch against #183's named gate surface |
| plans systematically narrower than specs allow (#175 trigger, read from wave-shape/fold-rate) | judge-panel decomposition as an authoring escalation |
| straggler threshold (#177 §2c) | feeds the fold-native program's existing Phase-3 rule verbatim |
| standing-frontier need across drains, or adversarial-guard need (#178) | celld/DO substrate revisit (~0.3+, both drivers recorded) |
| third superpowers version-skew incident (#180) | measured migration case — contain posture until then |

## Verification (suite disposition)

The program's builds go through normal marked plans (`Acceptance: suite`;
sealing on request as ever). `fleet/` is new surface, not periphery: it
lands with its own pytest/node tests and they join the committed suite.
The run engine's suite-gate rule stands — any change to
`harnesses/*.js` (none is planned before W3's resolver item) needs its
covering `.mjs` sim and sentinel. The frozen periphery is not modified by
any phase; W2b consumes the fold kernel CLI as a caller.

## Error handling

- Store unreachable mid-run: runs continue (the store is coordination,
  not verification); leases may expire — claims re-derive from store +
  clock on reconnect; a claimed-over zombie's renew is rejected by epoch.
- Sandbox death: lease expires silently, run becomes claimable; the
  half-done branch is abandoned (runs are idempotent from plan + base).
- **Orchestrator death and recovery:** drains stall ⇒ page class 1. On
  restart, the SQLite-persisted store reloads (claims, spend, receipts
  pointers survive); every lease that expired during downtime re-derives
  as `expired` — in-flight sandboxes that kept working renew on reconnect
  (same epoch) or, if claimed-over, hit zombie rejection and stop. If the
  persisted store is itself lost, the drain re-seeds from git + the
  docket: run branches, receipts, and the frontier ref are all in git;
  only unpushed spend rows are written off, recorded in the manifest as a
  ledger gap. No recovery step is improvised over live sandboxes.
- Guard converge-away storm: park the offending run (§W2c).

## Release

W1 and W2 each release as normal 0.2.x patches (operator's versioning
call stands: minor bumps only on explicit call). CI green on main before
and after, per the standing release gotcha.

## Adds / Removes (author disclosure for trim review)

Adds: `fleet/` (orchestrator process: ws-server wiring + in-process guard
sweep + claim logic + provisioner + drain driver + manifest writer;
dashboard page; **the fleet run shim**); **the SQLite store persister**
(kept for §W1c ledger continuity, stated in §W1b); **the cross-run
resolver brief** (a designed, separately-reviewed W2b deliverable);
golden-VM runbook; #188 marker tuple; batch-SMOKE
manifest section; spend-authority mechanism (§W1c; constants set at the
W1 gate); the measured serial comparator arm (one paid drain, W2 gate);
drain-level counters (W2d, spec-licensed); the W3 trigger table
(agreement, not code).
Removes: nothing (this program is additive; subtraction candidates appear
only after the W2 reads exist).
Deliberately absent: engine plan-authoring workflow (#175), parallel
resolver dispatch (#183 premature), judge panel (#175 deferred), celld
(#178/#180 watch), any waves.js change before a W3 trigger, any
periphery change, sandbox git credentials (transport is
orchestrator-initiated in both directions), sandbox recycling.

## Trim review

### Round 1 (fresh-context reviewer, 2026-08-21; grade rev 1: W1 **up**, W2 **up**, W3 **flat**, overall **up** — "the delta above what the map already decided is modest"; verdict: trimmed W1 is the minimal O1 slice; the graver finding is the under-specification cluster U1–U3, which "can fail dangerously by being thin")

Findings and adopt-or-answer (rev 2 incorporates all adoptions):

- **T1 defer AFK sealing lane out of W1 — ADOPTED** (§W1d; lane debuts W2a).
- **T2 defer drain-manifest v1 to W2 — ADOPTED** (§W2c; W1 reads raw receipts).
- **T3 W3 table cites constants by source, no second copy — ADOPTED** (§W3).
- **T4 guard is an in-process sweep, not a separate replica component — ADOPTED** (Background #178 entry, §W1b, Adds).
- **T5 delete-only sandboxes, no recycling — ADOPTED** (§W1a).
- **U1 spend authority unoperationalized — ADOPTED**: §W1c added (two-layer mechanism now; constants set at the W1 gate from measured burn — deliberately not invented ungrounded, per the reviewer's own S1 logic).
- **U2 origin-push credential unscoped — ADOPTED, resolved safer**: transport inverted to orchestrator-pull-over-SSH; sandboxes hold no git credential at all (§W1b). Also discharges S3.
- **U3 execution posture + security-page producer — ADOPTED**: §W1a (sandbox is the permission boundary) and §W2c (producer = orchestrator scanning the engine's own escalation/BLOCKED markers).
- **U4 "exactly as in-wave" resolver brief not buildable — ADOPTED**: cross-run brief named as a W2b design deliverable with its own review (§W2b).
- **U5 orchestrator-death recovery — ADOPTED**: SQLite persister + recovery paragraph (§W1b, §Error handling).
- **U6 O2 serial comparator undefined — ADOPTED**: one measured serial-drain arm at the W2 gate, paid once (§Goal O2).
- **U7 1.35× token bound underived — ADOPTED**: demoted to record-and-read; wall remains the criterion (§Goal O2). Discharges S1.
- **U8 run version identity — ADOPTED**: version stamp in the run report, read at the W1 gate (§W1a, §W1d).
- **S1 — discharged by U7.** **S3 — discharged by U2.** **S6 — discharged by T5.**
- **S2 `fleet/` location/no-build — ANSWERED, kept**: a location must be named; the choice is disclosed as delegated detail and matches the repo's viewer/kernel no-build convention.
- **S4 "strike-tolerance per Julian" — ADOPTED as trim**: replaced by the plainer, doctrine-consistent rule "guard storm parks the offending run" (§W2c, §Error handling); the Julian citation no longer carries mechanism weight.
- **S5 drain-level counters — ANSWERED, kept**: they are the only way O2/O4 (this spec's licensed pre-registrations) become readable; now explicitly disclosed as spec-licensed in §W2d and Adds.

Operator adjudication of this round: pending at spec approval.

### Round 2 (fresh-context reviewer, 2026-08-21; grade rev 2: W1 **up**, W2 **up**, W3 **flat**, overall **up** — "every rev-2 concept either makes a pre-registered outcome readable or closes a round-1 hole"; termination judgment: **round 3 needed, narrowly** — three contract-level completions, "I expect rev 3's delta to be a handful of sentences and the next round to terminate")

Findings and adopt-or-answer (rev 3 incorporates all adoptions):

- **T-r2-1 dual recovery story (persister + git re-seed) — ADOPTED (keep persister, state linkage)**: §W1b now states the persister exists solely for §W1c ledger continuity; claims need no persistence. Persister added to Adds (discharges S-r2-1).
- **T-r2-2 trailing-median page empty at n=1–2 — ADOPTED**: §W1c layer (1) narrowed to docket-cap projection; the median-multiple page activates at a ≥5-run trailing window.
- **U-r2-1 sandbox-side fleet client required but unnamed — ADOPTED**: the **fleet run shim** named in §Where-it-lives (with the guard-semantics reason it must exist), wired into §W1a, added to Adds (discharges S-r2-3). The largest catch of the round.
- **U-r2-2 base-ref delivery unstated — ADOPTED**: orchestrator pushes the base ref to the sandbox at provision over the same SSH transport (§W1a).
- **U-r2-3 VM→VM SSH fetch unproven + credential set understated — ADOPTED**: W1a preflight probe named, HTTPS-proxy remote as fallback; §W1b states the orchestrator's full credential set honestly (account-level exe.dev SSH + sole origin push) and why the concentration is the design.
- **U-r2-4 spend-revoked park not drainable — ADOPTED**: park card's next-act includes the explicit operator claim reset (§W1c).
- **U-r2-5 sealed-exam transport — ADOPTED**: orchestrator pulls from the sealing sandbox, pushes to origin pre-dispatch (§W2a).
- **U-r2-6 O4 read point — ADOPTED**: W2 gate over ≥2 drains, then standing through the first 3 (§Goal).
- **U-r2-7 spend-sum tolerance — ADOPTED**: set at the W1 gate (§W1c).
- **S-r2-1/S-r2-2/S-r2-3 Adds disclosure gaps — ADOPTED**: persister, cross-run resolver brief, and fleet run shim all disclosed in Adds.

Operator adjudication of this round: pending at spec approval.

### Round 3 (fresh-context reviewer, scoped to the rev-3 delta, 2026-08-21; delta grade **flat** — "every one converts a hidden dependency round 2 proved already latent into a stated contract"; **termination judgment: TERMINATE** — 7 findings, all wording/bookkeeping or single-clause completions with no design freedom; reviewer recommended folding them at adjudication rather than a round 4)

Findings and adopt-or-answer (rev 4 folds all seven in):

- **F1 shim rationale half-misattributed — ADOPTED**: spend rows are guard-enforced writer-scoped; renews are sandbox-written for liveness semantics (§Where it lives).
- **F2 verbatim guard lift would converge-away the orchestrator's own hard-action revoke — ADOPTED**: supervisory exemption named in §W1b with its test case in the planned rewrite.
- **F3 base-delivery leg had no fallback — ADOPTED**: symmetric read-only HTTPS-proxy remotes in both directions (§W1a); "cannot reach origin" relabeled as policy, not capability (§W1b).
- **F4 persister parenthetical imprecise — ADOPTED**: lost claims re-derive as free, not expired; persisted claims are what make renew-on-reconnect resumable (§W1b).
- **F5 Deliberately-absent label — ADOPTED**: "orchestrator-initiated in both directions".
- **F6 W1 spend-sum read circular at n=1 — ADOPTED**: labeled observational at W1, pass/fail from W2 (§W1d).
- **F7 "driver claims runs" verb — ADOPTED**: driver dispatches; the shim claims (§W2a).

**Trim review complete: rounds terminated per the review-to-diminishing-returns protocol. Operator adjudication of all three rounds: at spec approval.**
