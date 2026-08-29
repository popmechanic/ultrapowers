# Intent — One Driver, the engine half (0.3.0)

**Signed by:** operator, pending. **Spec:** `docs/superpowers/specs/2026-08-28-one-driver.md`.
**Branch:** `one-driver`. **Ticket:** #389. **Sibling intent:** the client half (#390) —
see `## Out of scope`.

> **SUPERSEDED AS A RUN INPUT (2026-08-28).** The port is a *substitution*, not a rebuild —
> `waves.js` is already parameterised over its worker dispatcher, so the work is one function
> and a clone-provisioning change, gated by sims that run locally in seconds. See the
> one-driver spec **§1a** (the seam) and **§10** (five stages). This document survives as the
> **record of intent** — its task set names real work and its acceptance statements stand —
> but it is not compiled, and the bridge that fed it to the old engine is deleted.


*This is the first intent document written against the spec's §6 schema. Seven slots, no
verbatim implementation code, one operator-verifiable acceptance statement per task. Where
the schema chafed, it is recorded in `## Cadence` rather than silently worked around — that
friction is an input to #390.*

## Scope

Move the wave loop out of Claude Code's Workflow tool and into the fleet driver, so that no
LLM ever orchestrates a run. The driver provisions each worker's clone at BASE itself,
dispatches one `claude -p` process per worker with a role prompt file and a JSON schema,
reads the result envelope, merges, folds, gates, and hands the run to the orchestrator to
publish. `harnesses/waves.js` and the Workflow-tool coupling are deleted in the same
release.

This intent covers the **engine** only. The authoring skill, the dropped superpowers
dependencies and the ultradocket rework ship in the same release from a separate intent.

## Global Constraints

- **The trust core does not move.** Receipts at shas, exit codes as authority, the standing
  grant, park-by-default, one human gate on the PR. Any change that weakens a receipt is out
  of scope, not a judgment call.
- **Port, don't rewrite.** `tests/sim_workflow.mjs`, `sim_base_ancestry.mjs` and
  `sim_derived_heads.mjs` must pass against the driver with the same scenarios and the same
  `ALL (SCENARIOS|TESTS) PASSED` sentinel. Work that cannot run them is a different program.
- **No API key.** Workers are `claude -p` on the subscription token. Never add the
  `anthropic` SDK or `ANTHROPIC_API_KEY` to any shipped or dev path.
- **Every worker carries `--exclude-dynamic-system-prompt-sections`**, and the worker
  environment never carries `FORCE_PROMPT_CACHING_5M` or `DISABLE_PROMPT_CACHING*`.
- **No local execution substrate.** Unit tests and sims run locally; nothing that spawns a
  worker or runs the acceptance suite does.
- **Frozen periphery.** `gate_check.py`, `ultra_gate.py`, `run_acceptance.sh` and the
  compiler's diagnostic vocabulary change house, not behaviour.

## Tasks

### T1 — worker dispatch and the process supervisor

- **Depends-on:** —
- **Interfaces:** `dispatchWorker({role, task, clone, sessionId}) -> envelope`
- **Produces:** `runWorker(opts) -> {structuredOutput, usage, exitClass, sessionId}`;
  `classifyExit(envelope, code) -> 'success'|'max_turns'|'budget'|'auth'|'sigterm'|'abort'`
- **Files:** `fleet/worker.mjs`, `fleet/roles/implementer.md`, `fleet/roles/reviewer.md`,
  `fleet/roles/critic.md`, `fleet/roles/write-side.md`, `fleet/tests/test_worker.mjs`
  *(`fleet/roles/wave-author.md` belongs to T6, which owns that role)*
- **tier:** most-capable
- **Acceptance:** `do:` kill a worker mid-run with SIGTERM. `see:` the driver records exit
  class `sigterm` with no envelope, retries that task exactly once, and the run continues.
  A worker that exits 1 with `error: "not logged in"` fails the **run**, not the task.

### T2 — clones cut at BASE by the driver

- **Depends-on:** —
- **Interfaces:** `provisionClones(intent, base) -> {integration, tasks: {id: path}}`
- **Produces:** one clone per task plus `clones/integration`, every one at BASE
- **Files:** `fleet/clones.mjs`, `fleet/tests/test_clones.mjs`
- **tier:** most-capable
- **Acceptance:** `do:` run any multi-task intent. `see:` every task clone's `HEAD` equals
  BASE at dispatch, and `tests/sim_base_ancestry.mjs` passes with **no** `baseCorrected`
  field emitted anywhere — the #314 condition is inexpressible, not merely unobserved.

### T3 — role flag-sets as data

- **Depends-on:** T1
- **Interfaces:** `ROLES = {waveAuthor, implementer, writeSide, reviewer, critic}`
- **Produces:** one JSON object per role: model, effort, permission mode, allowlist,
  writable root, prompt file
- **Files:** `fleet/roles.mjs`, `fleet/settings-hook.mjs`, `fleet/tests/test_roles.mjs`
- **tier:** most-capable
- **Acceptance:** `do:` give a reviewer worker a hostile task ordering four routes to modify
  its clone, under a **neutral** role prompt. `see:` every route denied, the clone byte-identical,
  and the denials in `permission_denials`. A cooperative role prompt does not count as a pass
  (parity R-w1).

### T4 — the wave loop

- **Depends-on:** T1, T2, T3
- **Interfaces:** `runWave(waveTasks, base) -> {results, merged}`
- **Produces:** implement → review → fix per task, with fix rounds via `--resume`; tier
  escalation on `structured_output: null`
- **Files:** `fleet/wave.mjs`, `fleet/tests/test_wave.mjs`, `tests/sim_workflow.mjs`
- **tier:** most-capable
- **Acceptance:** `do:` run `tests/sim_workflow.mjs` against the driver. `see:`
  `ALL SCENARIOS PASSED`, unchanged scenarios. Separately: a fix round costs **≤ 0.4×** a
  fresh dispatch of the same task, measured from `modelUsage` (cache note §F measured 3.1×
  cheaper; 0.4× is the bar with margin).

### T5 — merge, fold and reconcile

- **Depends-on:** T1, T2, T3
- **Interfaces:** the existing fold kernel and `fold_wave.py`, called from the driver
- **Produces:** wave merge, contended-wave fold, reconciliation, the completeness critic
- **Files:** `fleet/merge.mjs`, `fleet/tests/test_merge.mjs`, `tests/sim_derived_heads.mjs`
- **tier:** most-capable
- **Acceptance:** `do:` run `tests/sim_derived_heads.mjs` against the driver. `see:`
  `ALL SCENARIOS PASSED`. The fold kernel is called, never reimplemented:
  `kernel/vendor/manyana.py` is byte-identical to its sha-pinned copy.

### T6 — the wave author and plan derivation

- **Depends-on:** T3, T8
- **Interfaces:** `deriveWave(intent, n, integrationClone) -> plans/wave-n.json`
- **Produces:** derived bodies, narrowed `Files:`, `Commutes:`; identity diff against the
  signed set
- **Files:** `fleet/derive.mjs`, `fleet/roles/wave-author.md`, `fleet/schemas/wave-plan.json`,
  `fleet/tests/test_derive.mjs`
- **tier:** most-capable
- **Acceptance:** `do:` hand the wave author a derived plan that invents a task id, drops an
  edge, or rewords an acceptance statement. `see:` the driver rejects it as a failed
  derivation, quotes the diff back once, and parks on the retry. Wave 1 never invokes the
  wave author at all.

### T7 — admission observation, from both meters

- **Depends-on:** T1
- **Interfaces:** `admission[]` rows on the receipt
- **Produces:** per wave boundary **and** per mid-wave checkpoint — (a) the *model* meter:
  `api_retry` counts, `error` values and `retry_delay_ms` from `stream-json`; (b) the
  *substrate* meter: `avg_cpu_cores`, `disk_used_bytes` and `vm_count` from
  `ssh exe.dev "billing usage --json"`, plus the run sandbox's own
  `stat <vm> --json --range=24h`. Nothing is gated.
- **Files:** `fleet/admission.mjs`, `fleet/tests/test_admission.mjs`
- **tier:** standard
- **Acceptance:** `see:` after any multi-wave run, `admission[]` carries one row per wave
  boundary and per mid-wave checkpoint, each with **both** meters, and **every row's
  `decision` is `observed`**. A row with any other value is a bug in this release.

  Two meters and not one, because they fail differently and 0.3.1 has to tell them apart:
  the model meter is the account rate window (the `/api/oauth/usage` half is unreadable from
  the orchestrator's token, so `api_retry` is the reactive proxy), and the substrate meter is
  exe.dev capacity, which **is** readable today with no credential problem. **Read the meter,
  never sum allocation** — summing `allocated_cpus` reports 31 against a cap of 16 while the
  metered `avg_cpu_cores` is 0.245 (RUNBOOK §Capacity).

### T8 — the receipt carries the derivation

- **Depends-on:** —
- **Interfaces:** `report-format.md` schema v2
- **Produces:** `intent.sha`, `waves[].plan`, `judgmentCalls[]` re-typed to objects,
  `acceptance[]` as an array, `admission[]`, `standingDecisions[]`
- **Files:** `skills/ultrapowers/references/report-format.md`, `fleet/receipt.mjs`,
  `fleet/tests/test_receipt.mjs`
- **tier:** most-capable
- **Acceptance:** `do:` read a green run's receipt alone, without the run directory. `see:`
  the intent sha, every derived wave plan, every judgment call with both readings, and one
  `{statement, evidence}` pair per signed acceptance statement. The run directory is not
  needed to adjudicate the PR.

### T9 — the claim-lease reaper, with the cap deletion

- **Depends-on:** —
- **Interfaces:** the orchestrator sweep
- **Produces:** the spend pass deleted; a sandbox whose claim lease expired with no drive
  heartbeat is destroyed
- **Files:** `fleet/orchestrator.mjs`, `fleet/store.mjs`, `fleet/drive.mjs`,
  `fleet/tests/test_orchestrator.mjs`
- **tier:** most-capable
- **Acceptance:** `do:` kill a drive process mid-run and leave the sandbox running.
  `see:` the sweep destroys that sandbox within one lease period, and the reason recorded is
  liveness, never spend. **The reaper and the cap deletion are one task on purpose** — they
  must not ship in separate PRs.

### T10 — execute the deletion ledger

- **Depends-on:** T4, T5, T6, T7, T8
- **Interfaces:** —
- **Produces:** `waves.js`, `waves.harness.json`, `workflow-template.md`,
  `test_no_prompt_drift.py`, `test_harness_registry.py`'s manifest test, and eight scripts
  deleted
- **Files:** `skills/ultrapowers/harnesses/`, `skills/ultrapowers/scripts/`,
  `skills/ultrapowers/references/`, `tests/`
- **tier:** standard
- **Acceptance:** `see:` `ls skills/ultrapowers/scripts/ | wc -l` reports **≤ 10**, and
  `python3 -m pytest` is green with no test referencing a deleted script. Six guards are
  named in the release commit, each with the number that licenses it.

### T11 — `ab_runner` re-armed on the driver

- **Depends-on:** T4, T5, T8
- **Interfaces:** `evals/ab_runner.py` drives the driver, remotely
- **Produces:** gate parity runnable on the fleet
- **Files:** `evals/ab_runner.py`, `tests/test_ab_runner.py`,
  `evals/fixtures/chained/intent.md`, `evals/fixtures/contend/intent.md`,
  `evals/fixtures/contend-big/intent.md`, `evals/fixtures/contend-prod/intent.md`,
  `evals/fixtures/degrade/intent.md`, `evals/fixtures/flawed/intent.md`,
  `evals/fixtures/flawed-routing/intent.md`, `evals/fixtures/mixed/intent.md`,
  `evals/fixtures/webapp/intent.md`, `evals/fixtures/wide/intent.md`
- **tier:** most-capable
- **Acceptance:** `do:` run gate parity across the ten fixtures carrying a `plan.md`.
  `see:` for each, the derived plan's wave shape and gate verdict equal the old engine's
  authored plan for the same intent. Any divergence is named in the receipt, not averaged
  away.

### T12 — engine SKILL.md

- **Depends-on:** T10
- **Interfaces:** the operator-facing skill text
- **Produces:** "run the driver; read the receipt"
- **Files:** `skills/ultrapowers/SKILL.md`, `tests/test_skill_budget.py`
- **tier:** standard
- **Acceptance:** `see:` `wc -w skills/ultrapowers/SKILL.md` reports **≤ 400**, pinned by
  `test_skill_budget.py`, and the text names no script that no longer exists.

## Standing decisions

Pre-authorized. The run takes these branches, records them as judgment calls, and does not
park.

1. **Deleting a test whose only subject is deleted code is authorized** — it is part of the
   ledger, not a reduction in coverage.
2. **Renaming or splitting a `fleet/*.mjs` module is authorized** where behaviour is
   unchanged; the `Files:` block names intent, not a final layout.
3. **Where the port and `waves.js` disagree on behaviour and `waves.js` has no test, the
   sim's expectation wins**; record the divergence.
4. **Adjusting a role's allowlist to make a repro pass is authorized**, provided the writable
   root is unchanged and the hostile-prompt acceptance still passes.
5. **`deferred:manual` acks on documentation wording are pre-authorized** — README, SKILL.md
   and marketplace text read correctly if the words are present and name nothing deleted.
6. **A fixture whose intent doc cannot be back-formed faithfully may be dropped from gate
   parity**, provided it is named in the receipt and at least eight of ten remain.
7. **Choosing between `--resume` and a fresh dispatch for a *review* worker is authorized**
   either way; only the implementer fix round is measured (T4).

## Cadence

One run, waves derived against the merged tree. **Width ≤ 8, one wave per sandbox** —
measured on a real 8-vCPU sandbox (`evals/frontier/results/2026-08-28-wave-width.md`),
not the inherited "4 suggested". This intent's own graph peaks at width 4, so 0.3.0 will
not exercise 8; it is a default waiting on the first run that needs it.

**Where the §6 schema chafed, recorded for #390 rather than worked around:**

- **The release does not fit one intent document.** Splitting engine from client was not a
  stylistic choice — the client half has its own `Files:` universe and no dependency edges
  into these twelve tasks. §10's "reviewable pieces on one branch" is therefore the *natural*
  shape, and the schema should probably say that a release may carry more than one signed
  intent rather than leaving an author to discover it.
- **`Files:` on a port is a forward-looking guess.** Several tasks name files that do not
  exist yet, so the compiler's write-after-write overlap edges are derived from predicted
  paths. Standing decision 2 exists only to absorb that. A schema that distinguished
  *existing* from *created* files would not need it.
- **The compiler refuses globs in `Files:`, and it is right to** — a glob silently drops
  overlap coverage, which is the entire reason `Files:` is signed. Two tasks carried one
  (`fleet/roles/*.md`, `evals/fixtures/*/intent.md`) and were caught by a dry-run compile
  before any spend. **The intent checker (client C2) must refuse a glob at authoring
  time**, so this is never discovered by the compiler again.
- **`Depends-on: —` appears four times.** Four genuinely independent tasks is a wide wave 1,
  which is good — but it also means wave 1 does the most work with the least derived context,
  the inverse of what the derivation tier is for.

## Acceptance

The run is green when: every task's acceptance statement above is met; the three sims pass
with their sentinel; `python3 -m pytest` is green; and gate parity (T11) reports on ten
fixtures. The release is refused without the §9 numbers in its commit body.

## Out of scope

- **The client half** — the merged authoring skill, `ultraplan`'s deletion, the seven dropped
  practice skills, the precedence line, CLAUDE.md's rule text, README/marketplace wording,
  and the `ultradocket` sweep rework. Same release, same branch, **separate signed intent**.
- **The admission gate itself** — 0.3.1, fitted to what T7 records.
- **Re-drive reuse** (#383), and **#360 Tier 1**.
- **The deterministic intent checker.** It validates a signed intent at authoring time, so it
  ships with the authoring skill in the client half. T10's `≤ 10` script count assumes it
  present; if the client half slips, T10's number is `≤ 9` and the release commit says so.
- Any change to `kernel/vendor/manyana.py`, or to the gate's verdict logic.
