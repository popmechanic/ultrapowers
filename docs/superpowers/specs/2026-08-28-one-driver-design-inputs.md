# One Driver — design inputs (map #366, frozen 2026-08-28; mirrors Amendments 1–5, children #371/#389/#390)

**What this file is.** The committed, in-repo copy of wayfinder map #366 as it stood
at the end of the sitting that chartered it — the diagnosis, the two-half eureka, the
operator's decisions (including Amendment 1), the pre-registered bar, the deletion
ledger, the rules, and the harness mechanics read from the Claude Code docs. Issues
sprawl and get forgotten; this file is the version the build must read.

**Consumption contract.** The one-driver spec MUST carry a `## Design inputs` section
— **as of 2026-08-28 it lives in the spec's companion,
`docs/superpowers/specs/2026-08-28-one-driver-answers.md`, so the spec itself can state the
design in one voice; the contract is satisfied there and is unchanged** — that lists every
row of the **deletion ledger** and every row of the **harness mechanics** table below —
**including the rows Amendments 3, 4 and 5 correct or replace** — and, for each, says one
of: `adopted` (with the spec section that implements it), `answered` (why not, in one
sentence), or `deferred` (to which ticket). A spec that skips a row is
not plan-ready — the same adopt-or-answer discipline the trim review already imposes.
The pre-registered **bar** goes into the cutover release commit verbatim with its numbers
filled in; the release is refused without them.

**Live pointers.** Map #366 (amendments land there first, then here); #365 (`claude -p`
parity research — verifies each mechanics row with a repro); #368 (orchestrator opens the
PR — buildable now); #243 (grilling, precedes the spec); #360 (Merge Frontier, sequenced
after cutover). Baseline numbers: run-20's evidence bundle, 2026-08-28.

---

A wayfinder map (CLAUDE.md §Wayfinding). Chartered by the operator on 2026-08-28 after an outside review of this codebase and the width-3 fleet drain. This is the **thought trace** — the reasoning, the numbers, and the rules — so that whoever builds it (us, later) starts from the eureka and not from the tower.

## The diagnosis we accept (outside review, 2026-08-28)

> "The deterministic parts are scripts; but sequencing them correctly is still an LLM following markdown … each scar became another step in the protocol rather than a simplification."

The complexity the review names — the 6-step operator protocol (SKILL.md, 3,129 words), the NEEDS_ACK standing-grant grammar, salvage/redirect lanes, residual manifests, hygiene receipts, round-artifact rotation, the three-way sweep choreography, the registry-snapshot probe (Step 4a½) — is **not merge machinery and not verification machinery**. It is one thing: *a non-deterministic operator (an LLM) sequencing deterministic scripts against a long-lived shared checkout*. Every one of those guards exists to protect that checkout from that operator. The merge kernel (map #360) and the trust core (receipts, exit-code authority, gate) are a fifth of the surface and are not the problem.

## The eureka (two halves)

**Half 1 — encapsulate every run.** A fleet run today (`fleet/drive.mjs` → `provisionRun` → `shim-main.mjs` → `claude -p "/ultrapowers <plan>\n\n<standing directive>"`) still executes the *entire* in-session protocol inside the sandbox. What it changes is the shell: the operator side is code, the in-session LLM has exactly two legal moves (approve iff every ack is `deferredVerification` runtime/external, else park), and the mess is disposable. Runs 18/19/20 (2026-08-28) were each one CLI command → one JSON gate read → one receipt at a sha → a mechanical verdict; the parks were clean refusals, the green was a clean self-approve. **Once every run is encapsulated, the guards whose only job was surviving on a shared machine are dead weight** — and can be deleted with a number, not an argument.

**Half 2 — the driver IS the engine.** `harnesses/waves.js` (2,354 lines of JavaScript) already orchestrates everything — waves, per-task implement→review→fix loops, fold, suite, report — but it runs inside Claude Code's Workflow tool and reaches agents only through `agent()`. That coupling is *why* prompts are baked (+ a drift pin, + `workflow-template.md`), why saved workflows resolve by `meta.name`, why the registry probe exists, and — found on 2026-08-28 — **why the engine cannot provision its own worktrees** (#314's guard exists because `isolation:'worktree'` belongs to the runtime and cuts from the session checkout, not BASE). Move that loop into the driver (`fleet/drive.mjs` + `shim-main.mjs` are already 80% of it), dispatch `claude -p` per worker with a prompt *file* and `--json-schema`, cut each worker's clone at BASE yourself, and: the LLM never orchestrates anything — it only ever appears as a worker; platform coupling drops from three (Workflow tool, superpowers contract, plugin mechanics) to one (`claude -p`); prompts are files; and wrong-base is *inexpressible* because the thing that cuts the clone is the thing that knows BASE.

## Decisions taken (operator, 2026-08-28)

1. **Scope: driver is the engine** (Half 1 + Half 2), not encapsulation alone.
2. **Substrate: no Docker** ("it feels huge to run locally"). The local sandbox is a *facsimile*: a shared-object git clone in a per-run scratch root (0.14 s to provision, 188 KB `.git`, `rm -rf` = complete teardown, zero bookkeeping in the primary checkout) + copy-on-write dependency caches + the cheapest write-confinement that passes (#364 measures). exe.dev VMs remain the **width knob**, never a requirement — the same driver, `--remote` selects the VM provisioner.
3. **Cuts:** the sealing subsystem (`collect_seal.py`, `seal_hash.py`, the seal-author agent + brief, the sealed half of `run_acceptance.sh`) and the viewer (`render_viewer.py`, `serve_viewer.py`, `swarm_watch.py`, the 5 `.mjs` specs outside CI) are **not ported**; they stay in git history and return only on a real request from a real user. `ultradocket`'s drain half becomes "drive a plan"; its triage half stays. `ultralearn` stays whole — it is the feedback loop.
4. **Cutover: experimental branch → fleet-validated → one release 0.3.0.** The old path is untouched until the new one clears the bar below; then it is deleted in one minor-bump release (the operator's explicit override of the "stay on 0.2.x" call, memory `versioning-0-2-x-stays`).

## Pre-registered bar (write the numbers into the cutover PR; the release is refused without them)

| measure | today | bar |
|---|---|---|
| prose an LLM must follow to run a plan | `skills/ultrapowers/SKILL.md` 3,129 words + refs | ≤ 400 words: "run the driver; read the receipt" |
| scripts under `skills/ultrapowers/scripts/` | 26 | ≤ 10 (deletion ledger below) |
| guards deleted with a licensing number | 0 | ≥ 6 (ledger) |
| gate parity | — | on every `evals/fixtures/*/plan.md`, the driver-engine's wave shape and gate verdict equal the Workflow engine's (`evals/ab_runner.py` runs both arms) |
| live parity | — | ≥ 3 fleet runs (one local-facsimile, two exe.dev, one at width ≥ 2) green with `reported == ledger` and all five §W1d legs |
| cost | run-13/15/16/17/18/19/20 ledger | tokens ≤ 1.0× the Workflow engine on the same fixture (an orchestrator LLM no longer spends anything), wall ≤ 1.0× |
| parks per run on the fixture corpus | (record on the old engine first) | ≤ old |
| surface ceiling | — | the spec names a line/word ceiling for the driver + prompts; every guard added after go-live owes a deletion in the same PR |

## Deletion ledger (pre-registered; each row names the number that licenses it)

| dies | why it existed | licensed by |
|---|---|---|
| `run_lock.sh`, RUN_LOCK, "serialize runs" (#134) | two LLM sessions sharing one checkout | one driver process per run root |
| `sweep_worktrees.sh`, wf-runs.json / `wf_<stamp>` / `--all` choreography, #157's leak class | git worktrees registered in the primary `.git` | facsimile root, `rm -rf` (#364 reading 1) |
| `hygiene_check.sh` (worktree/branch/lock legs), `residual_manifest.py` | close-of-run drift on a shared checkout | nothing persists to be hygienic |
| `salvage_args.py`, `redirect_args.py`, resume-in-place, the Salvage/Redirect lanes | repairing a run in place because relaunch was expensive and the checkout was shared | re-drive from the published receipt (#318's `parkedPublish` already carries the work out) — a redirect is a new run with a narrower plan |
| Step 4a½ registry probe, `check_engine_skew.sh`, `harness_manifest.py`, `ultrapowers-probe` | the Workflow tool's registry-snapshot-at-session-start | no Workflow tool |
| baked prompts, `references/workflow-template.md`, `tests/test_no_prompt_drift.py` | `waves.js` must be a single committed file | prompts are files the driver reads |
| #314 guard (`startHead`/`baseCorrected`, watch #354), `FOLD_LOG.md`'s ancestry precondition | the runtime cut worktrees from the wrong ref | the driver cuts at BASE (#364 reading 5: 100/100) |
| NEEDS_ACK prose grammar (quotable grants, sidecar-first, per-gate consumption) | an LLM had to *decide* under a legal contract | the directive's two-move rule becomes `standing-approval.json`'s schema, enforced in code (`shim-main.mjs:318–375` already does this) |
| `check_superpowers_compat.py`, `resolve_superpowers.py`, `superpowers_contract.py` (engine path) | the engine ran inside a superpowers-hosting session | the engine never touches superpowers; authoring still does (HITL) |
| `ultra_run.py`, `finalize_report.py`, `warm_cache.sh`, `audit_run.py` | pieces of the loop invoked from prose | absorbed into the driver as functions |

**Kept, verbatim in semantics:** `compile_plan.py` (+ `--check --renders`), the fold kernel + `fold_wave.py` (map #360 owns its future), `gate_check.py`/`ultra_gate.py` as *library functions* the driver calls (exit-code authority, receipts, "receipts not narration"), `run_acceptance.sh`'s suite-gate half, `validate_skill.py`, the `report-format.md` contract, `readSessionTokens` and the spend cap, the store (#308), `ultralearn`.

## Rules

1. **The trust core does not move.** Receipts at shas, exit codes as authority, the standing grant, park-by-default, the human gate on the PR. The rebuild changes *who sequences*, not *what is proven*. Any PR that weakens a receipt is off-map (#204).
2. **No API key, ever.** Workers are `claude -p` on the subscription token (CLAUDE.md rule; fleet #213 route). `--max-budget-usd` is a backstop, tokens from transcripts are the meter.
3. **Port, don't rewrite, the loop.** `waves.js`'s `runTaskInner` / wave scheduler / fold adoption / completeness critic are the *behavior*; the port keeps their sims (`tests/sim_workflow.mjs` etc. become driver sims — same scenarios, same `ALL SCENARIOS PASSED` sentinel). A rewrite that cannot run the existing sims is a different program.
4. **The plan's shape is #243's call, not this map's.** Critique #3 (the plan as a single point of failure, correction batched into paid relaunch quanta) is real and this map does not fix it. #243's grilling ("plan only the merge frontier") should precede the spec so the driver implements the *post-grilling* plan shape rather than inheriting today's.
5. **Surface ceiling in the spec, deletion owed per guard.** This is the rule that prevents the rebuild from becoming tower #2. The review's sharpest line is a property of how we respond to incidents; the ceiling is the only counter-reflex we have found that works (the SKILL.md word pin proved it).
6. **Experimental branches carry one pre-registered metric, not a trim review to convergence.** Evaluation rigor is for engine-behavior claims (it is what turned run-18's 2/3 into an honest 3/3); ceremony is not. Two people run this; the fixtures, sims, and gate reads are what make breaking cheap — protect the evidence base, not the code.

## Route

1. #364 facsimile sandbox (prototype, numbers) ∥ #365 `claude -p` parity (research, decision) — both can start now, neither touches the engine.
2. #243 grilling — operator session — plan shape.
3. Spec: `docs/superpowers/specs/<date>-one-driver.md` (destination; feeds writing-plans + ultraplan + a fleet drive of its own build, like any other effort). Names the ceiling. Adopts #364/#365 verbatim.
4. Build on branch `one-driver`; validate against the bar with fleet runs (the fleet is both the vehicle and the first customer — `drive.mjs` becomes the driver).
5. Cutover release 0.3.0 with the ledger numbers in the release commit; delete the old path in that release.
6. Then map #360 Tier 1 lands on the simplified base (one place for the weave to live: the driver's store).

## Children

- #364 — prototype: the facsimile sandbox
- #365 — research: `claude -p` worker parity
- #243 — grilling: plan only the merge frontier — **RESOLVED 2026-08-28** → Amendments 4 + 5
- #360 — map: The Merge Frontier (sequenced after cutover)
- #371 — task: Phase 0, the encapsulation-only cut (Amendment 2; after #368)
- #368 — task: the orchestrator opens the PR (Amendment 1 decision 5; buildable now)
- ~~#364~~ — superseded by Amendment 1 (no local substrate)
- #389 — `wayfinder:task`: the one-driver spec + build (filed after the grilling; #382 is its remaining input)
- #390 — `wayfinder:task`: dependency posture — one owned authoring skill (Amendment 5; on map #238)
- #382 — research: prompt-cache sharing across a wave of separate `claude -p` workers — **RESOLVED + CLOSED 2026-08-28** → Amendment 6 below; #389 unblocked
- #383 — prototype: re-drive reuse, the driver's `resumeFromRunId` (added 2026-08-28; after cutover, on the driver; bar ≥ 50% tokens on a one-task park)
- #384 — watch-item: `-p` bare-by-default breaks subscription OAuth (from Amendment 3)
- #386 — task checklist: Phase 0 residuals owed to the port (stale prose naming deleted scripts, dead code, the cosmetic-manual-ack class, token renewal 2026-11-26) — closes at the 0.3.0 cutover
- #387 — fleet chore (not a map ticket): sandbox sizing datum feeding the packing rule

Written by the coordinating session as the trace of the 2026-08-28 conversation. The operator said: "Sometimes I think we're too iterative together. I don't mind investing in big, nearly clean room rebuilds." This map is that investment, with the one constraint that keeps it from reproducing what it replaces.

## Amendment 1 (operator, 2026-08-28, same sitting) — the laptop is a thin client; exe.dev is the only substrate

Prompted by the operator's own constraint: agent workloads have halted this laptop on memory pressure and it is chronically short of disk. So **decision 2 is replaced**: there is no local execution substrate at all. Not a facsimile sandbox, not Docker, not a worktree. The laptop **authors** (brainstorm → spec → plan, superpowers HITL, text only), **launches** (`drive-one` on the orchestrator), **observes** (the store / W2c attention surface — now the primary client, not deferred), and **approves** (the GitHub PR). Everything that runs an LLM worker or a test suite runs on an exe.dev sandbox. Unit tests and sims for developing the driver itself stay local (seconds, no LLM); the 5-minute acceptance suite never does.

**Decision 5 — the orchestrator opens the PR.** It holds a fine-grained GitHub token (this repo; contents + pull-requests) and, on gate-green (or self-approve under the standing grant), pushes the integration branch and opens the PR with the gate receipt in the body. The laptop never fetches a run branch again. This deletes the fetch → pin (`keep/run-N`) → rebase-or-merge → PR → delete-branch dance done three times on 2026-08-28, and the `FETCH_HEAD` near-loss class (#333 item 1) outright. Parked runs publish the same way with `unapproved` in the PR title/labels — the park card *is* a draft PR.

**Decision 6 — product statement.** ultrapowers is *our system*; the plugin is its thin client. README + marketplace say plainly: execution runs on an exe.dev fleet you provision (RUNBOOK); no local engine. Vendor commitment accepted with eyes open (single provider, network required for every run, the orchestrator is the machine that matters and must outlive sessions).

**Ledger additions (licensed by the amendment itself):** the entire local execution path of the driver (one substrate, one provisioner `cp fleet-golden`); #134's primary-checkout hazard; "never run two suites on one machine" (#250); the local `/ultrapowers` skill's Steps 1–6 (the skill becomes: push plan, launch, watch, read receipt); the laptop-side integration steps in RUNBOOK §Live W1 run. **#364 is superseded and closed** (no local sandbox to measure); #365 stands (cwd = the sandbox; its confinement leg is moot).

**Bar addition:** the laptop's resident footprint during a width-3 drain is the client process only — no worktrees, no suites, no `node_modules` copies; measure it once in the cutover PR (RSS + disk delta ≈ 0).

**Route change:** #364 dropped; add child "orchestrator opens the PR" (`wayfinder:task`) — buildable NOW on the old path because it pays for itself on the next run.



## Harness mechanics adopted (Claude Code docs read 2026-08-28 via the claude-code-guide agent; #365 verifies each with a repro before the spec adopts it)

The driver-engine is not a re-implementation of the Workflow tool on top of bare `claude -p`; the headless harness already carries most of what `agent()` gave us, plus things it never did. Each row names the flag and the thing it makes unnecessary.

| mechanic | flags / env | what it replaces or makes inexpressible |
|---|---|---|
| **Structured worker replies** | `claude -p --output-format json --json-schema <schema>` → `structured_output` in the result envelope; non-conforming reply = non-zero exit, no retry | the Workflow `agent({schema})` trip; the driver implements retry-with-escalation exactly as `runTaskInner` does today |
| **Role isolation, enforced not prompted** | reviewer/critic: `--permission-mode dontAsk --allowedTools "Read,Grep,Glob,Bash(git diff *),Bash(git log *),Bash(git status *)"`; implementer: `--permission-mode acceptEdits --disallowedTools "Bash(git stash *),Bash(git push *)"`; all workers: a `PreToolUse` hook passed via `--settings '<json>'` that denies `Edit`/`Write`/`Bash` targets outside the clone root | the prompt-level "you are a read-only role" (#32 class); **the #315 stash ban becomes a denied tool, not a sentence**; write-confinement without Docker/seatbelt (OS sandboxing is interactive-only in the current docs) — the hook is the boundary the VM backs up |
| **Per-worker knobs** | `--model`, `--effort`, `--fallback-model`, `--max-turns`, `--max-budget-usd` (backstop) | the tier row's `haiku/sonnet/opus` ladder and the fix-loop caps, per dispatch |
| **Spend from the result, not the transcript** | result JSON carries `usage` + `total_cost_usd` per worker; subagent spend included in `total_cost_usd` | **`readSessionTokens` and its transcript-format coupling (#209) retire**; the cap is summed from result envelopes; OTEL (`CLAUDE_CODE_ENABLE_TELEMETRY=1` + OTLP to the orchestrator) is the optional live feed for the store's spend rows |
| **Isolated sessions per worker** | `--session-id <uuid>` per worker (never shared — the 20-concurrent-subagent pool and the transcript file are per session); `CLAUDE_CONFIG_DIR=<run root>/claude` per run (+ `CLAUDE_CODE_PROJECT_DIR_NAME`) | pulling `~/.claude/projects` off the sandbox and pruning the golden (#350's chore) — **the evidence bundle is the run's config dir**, complete and nothing else's |
| **Fix rounds resume, not restart** | `claude -p --resume <implementer session-id> "<review findings>"` | today's fix round is a fresh dispatch with a review packet; resuming keeps the implementer's context on cache. **Pre-registered question for the build, not a decision:** measure fix-round tokens resume vs fresh on the fixture corpus; adopt the cheaper one |
| **Prompt files, no bake** | `--append-system-prompt-file <role.md>`; `--bare` so a worker never auto-loads the repo's `.claude/` (no session_start hook, no superpowers, no stray skills) | `references/workflow-template.md`, `test_no_prompt_drift.py`, the baked copies; **the engine's last contact with superpowers** |
| **Worker-side subagents, bounded** | `--agents '<json>'` for a role's helpers; `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` / `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` per worker | the runtime's unbounded spawn; transcripts land under the worker's own session dir |
| **Failure classes from exit codes + events** | exit `0/1/2/130/143`; `system/api_retry` events in `--output-format stream-json` | waves.js's overload/AGENT_NULL heuristics become a table |
| **Live progress into the store** | `stream-json` tool-use events (+ `--forward-subagent-text`) piped by the driver into TinyBase rows | the shim's 5-minute spend ticks; the W2c attention surface reads per-tool events |
| **Agent SDK as the upgrade path** | `@anthropic-ai/claude-agent-sdk` `query()` supports `CLAUDE_CODE_OAUTH_TOKEN`, `outputFormat`, hooks, `canUseTool`, per-message usage | start on the CLI (shell-debuggable, zero deps); move to the SDK only if `canUseTool`/per-call logging is needed for the dashboard. The "no API key" rule holds on both |
| **Plugin CI** | `claude plugin eval` (early access) | regression-tests the thin client's skills headlessly |

**Verify-before-adopt list for #365:** `--max-budget-usd` under subscription auth; that `--settings` inline hooks fire in `-p`; that `dontAsk` never blocks on a hidden prompt; the exact `structured_output` failure shape; whether `--bare` still honors `--json-schema` + `--append-system-prompt-file`; `CLAUDE_CODE_PROJECT_DIR_NAME` version floor (2.1.234+) on the golden's `claude`.


## Amendment 2 (operator, 2026-08-28) — Phase 0: the encapsulation-only cut ships first, on the current engine

Half 1 of the eureka does not need Half 2. Before the `waves.js` port begins, one sitting ships the deletions that only ever protected a shared laptop checkout — on the existing Workflow-tool engine, validated by one fleet run, with the engine loop untouched:

1. **`/ultrapowers` becomes remote-only.** The skill is "commit the plan, launch `drive-one` on the orchestrator, watch the store, read the receipt." SKILL.md's local execution steps (1–6 as they stand) go; the in-sandbox session still runs the engine via the same skill text, so the cut applies inside the sandbox too.
2. **Delete from the protocol and `skills/ultrapowers/scripts/`:** `run_lock.sh` + RUN_LOCK, `sweep_worktrees.sh` and the wf-runs / `wf_<stamp>` / `--all` choreography, `hygiene_check.sh`, `residual_manifest.py`, `salvage_args.py`, `redirect_args.py` and the Salvage/Redirect lanes (a redirect is a new run with a narrower plan; a park re-drives from `parkedPublish`), the Step 4a½ registry probe + `check_engine_skew.sh` + `harness_manifest.py` + `ultrapowers-probe`, and the NEEDS_ACK prose grammar (the directive's two-move rule and `standing-approval.json`'s schema, already enforced in `shim-main.mjs:318–375`, ARE the rule). Their tests go with them. Sealing + viewer go now too (decision 3).
3. **#368 lands in the same phase** so the laptop never fetches a run branch again.
4. **The fleet shim stops running the deleted steps** (it invokes the skill; nothing else changes).

**Why first:** it is roughly half the deletion ledger, it de-risks the port by shrinking what must be ported, and it pays out immediately if the port takes longer than hoped. **Bar for Phase 0 (its own release, 0.2.26 or 0.3.0-pre — operator's call at the time):** SKILL.md ≤ 1,000 words (from 3,129); scripts ≤ 16 (from 26); one fleet run green on the cut engine with all five §W1d legs; the PR opened by the orchestrator. The numbers go in the release commit. Phase 0 is a code-producing effort → normal flow: short spec (it is the ledger rows above), plan, fleet drive of its own build.

**Route (revised):** #368 ∥ #365 → **Phase 0 cut** → #243 grilling → one-driver spec (adopt-or-answer every row of this file) → port on branch → 0.3.0 → #360 Tier 1.


## Amendment 3 (2026-08-28) — §Harness mechanics verified by #365: three rows corrected, one blocker

`docs/superpowers/specs/2026-08-28-claude-p-worker-parity.md` reproduced every row above
(36 `claude -p` invocations, 27 on the fleet's 2.1.238, all subscription OAuth). The
table stands except where this amendment says otherwise; the spec adopts the **corrected**
row, and the parity doc is the citation.

| row | correction |
|---|---|
| Structured worker replies | the harness itself retries in-loop (a `[structured-output-enforce]` nudge; schema violations bounce to the model as tool errors); the fail-closed envelope is `subtype: error_max_turns`, exit 1, `structured_output: null`. So: **not** "non-zero exit, no retry" — the driver's retry-with-escalation wraps a harness that already retried |
| Spend from the result | subagent tokens fold into `modelUsage` / `total_cost_usd` exactly (#209 retires) — but the top-level `usage` is the LAST API call only; **sum `modelUsage`**. Tokens stay the cap unit; `--max-budget-usd` trips at exit 1 `error_max_budget_usd` (backstop) |
| Failure classes | observed exits are **0** (completed — and a SIGINT abort with `is_error: true`), **1** (max_turns, budget, not-logged-in), **143** (SIGTERM, no envelope). No 2, no 130. Classify from `subtype` / `terminal_reason`, never the exit code alone; `api_retry` cited, not reproduced |
| Fix rounds resume | mechanism holds headless; ~~the cost claim is **not** supported at n=1 (resume 1.7× fresh after ~10 min cache decay)~~ — **measured and REVERSED by Amendment 6: resume is 3.1× cheaper than a fresh dispatch, and nothing decays at 11 min.** Fix rounds resume; the pre-registered measurement is discharged. Driver must close the worker's stdin (`</dev/null`) |
| Prompt files, no bake | **BLOCKER: `--bare` refuses subscription OAuth** on 2.1.238 and 2.1.250 ("Not logged in", exit 1, even with `CLAUDE_CODE_OAUTH_TOKEN`; the docs say bare reads only `ANTHROPIC_API_KEY`/`apiKeyHelper` and will become the `-p` default "in a future release"). Proven substitute: `--setting-sources user --disable-slash-commands` + per-run `CLAUDE_CONFIG_DIR` — project hooks don't fire, the repo's CLAUDE.md is not loaded, skills are off, `--json-schema` + `--append-system-prompt-file` honored. **Watch-item for the port:** the day `-p` defaults to bare, workers need an explicit non-bare flag or the fleet's auth route (#213) breaks |
| Worker-side subagents | holds; a background subagent can emit TWO `result` lines in stream-json — take the last |
| Agent SDK | cite-only; the docs carry a policy note that third parties may not offer claude.ai login for SDK-built products → CLI-first is also the policy-safe path. Trigger for switching: a synchronous `canUseTool` decision a hook cannot express |

**Packing rule (decided):** one wave per sandbox — workers per sandbox = wave width, capped by a
driver constant (4 suggested), spilling to a second sandbox only above the cap. N=3 on a
1-vCPU/2 GB box ran clean; the binding limits are the account rate window and per-worker
worktree disk/CPU, not the CLI. Sandboxes-per-wave buys nothing and multiplies `cp fleet-golden`.

**The driver builds itself:** worktree provisioning at BASE, wave scheduler + process supervisor
(last `result` line, SIGTERM timeout), retry-with-escalation on `structured_output: null`,
`modelUsage` token metering, the failure-class table, three role flag-sets (data, not prose),
the per-run config-dir layout.


## Amendment 4 (operator, 2026-08-28) — the plan shape: sign intent, derive the plan

Rule 4 said the plan's shape is #243's call. It was decided in an operator grilling on
2026-08-28 (full record: #243, decision comment). **The operator signs an intent
document; the plan is machine-derived one wave at a time against the merged tree, and is
disposable.** The driver implements this shape, not today's.

**The three tiers.** *Signed* (operator, once, pre-run): task set, `Depends-on` edges,
`Interfaces`, one acceptance statement per task, `## Global Constraints`,
`## Standing decisions`, cadence. *In-loop planning* (the wave author, per wave, against
the merged tree): all bodies and steps, `**Files:**` refinement inside an approved task,
`**Commutes:**`. *Building* (the implementer): the diff only — never its own `Files:`,
never the acceptance statement.

**No verbatim implementation code in plans.** Each implementation task carries one
operator-verifiable acceptance statement: a `do:`/`see:` example where behavior is
observable, a number or bar where it is not. Verbatim *contract* survives (`Produces:`
signatures, the acceptance statement); verbatim *implementation* dies. Licensed by the
defect record: all six defects in runs 18–23 were in verbatim body parts, and Phase 0's
own bar (864 words / 13 scripts / 11 guards / parity green) is the proof the number-form
verifies non-observable work. A task that can produce neither an example nor a number is
the #322/run-14 shape and becomes inexpressible at authoring time.

**No new mid-run human contact.** On a fork the wave author takes its recommended branch,
writes the fork and both readings into the receipt (#204 loudness), and continues; the
operator adjudicates at the PR. Parks shrink to the trust core (irreversible/destructive,
credentials/security, admission refusal). Today's parks are terminal and lose nothing
(`parkedPublish`); a mid-run park would lose waves 2–N and is strictly more expensive
than anything that exists. Anticipated forks are pre-authorized in `## Standing
decisions`, generalizing the #191 standing grant from ack classes to decision classes;
its question bank is drawn from the ultralearn ledger and the redirect corpus, never
invented.

**One gate per run, unchanged** (ultraplan's integrated-green rule; rule 1). The receipt
grows to carry the derivation: intent sha, each wave's derived plan, every judgment call,
acceptance-statement → evidence pairs.

### Rows of this file that change shape

| row | change |
|---|---|
| NEEDS_ACK prose grammar → `standing-approval.json` | the schema expands to express pre-authorized **manual claims** and **decision classes**, not just ack classes |
| `check_superpowers_compat.py`, `resolve_superpowers.py`, `superpowers_contract.py` | the carve-out *"authoring still does (HITL)"* is **void** — the authoring path is forked too (see Amendment 5); all three die outright |
| `readSessionTokens` and the spend cap (kept-verbatim) | **the cap is deleted** — see below |
| the store (#308) (kept-verbatim) | the `budgets` table goes; new rows for admission decisions and judgment calls |
| `compile_plan.py` (+ `--check --renders`) (kept-verbatim) | gains a sibling — the deterministic **intent-doc checker** — and its `--renders` advisory now runs against **real code** at derivation time, strictly better than #345's measured 3/3 against a stale base |
| §Harness mechanics / §5 "three role flag-sets" | becomes **four**: implementer, reviewer, critic, **wave author** (read-only on code, write only to the run dir) |
| §Amendment 1 "the laptop authors" | splits — the laptop authors **intent**; the fleet authors **plans** |
| child #382 | gains an input: a serial authoring pass *between* waves is dead time in which prefix caches decay (#365: resume 1.7× fresh after ~10 min) |

### The per-run token cap is deleted

`fleet/orchestrator.mjs:214–281` (the spend pass: park + revoke claim + **destroy
sandbox** + page), the `budgets` table, `remaining`/`mayEnqueueSpend` in `store.mjs`, and
the `capTokens` plumbing through `drive.mjs` / `drive-one.mjs` / `shim.mjs`.

Licensed by: it is post-hoc (the tokens are spent before it can fire, so it only destroys
the in-flight work — and unlike a gate park there is no `parkedPublish`); **it has never
fired** (peak across runs 12–23 is run-18's 313,749 = 63% of cap); it measures dollars
when the scarce resource is the account rate window shared with the operator's own
sessions (`exe-dev-economics`; the eval-cell lesson *"read `/usage`, not a guessed
window"*; parity doc §7); and it was calibrated from size means against the recorded
lesson *"calibration = size means not floors."*

Replaced by three mechanisms already owned: **wave-boundary admission control** off the
real meter (under pressure the next wave does not start; the run folds, publishes and ends
honestly — *"stopped at wave 2 of 3 for window pressure"* in the receipt); **per-worker
`--max-budget-usd`** as the runaway backstop (exit 1 `error_max_budget_usd`, clean
envelope, parity doc R-o3/R-l9); and the **existing convergence caps** as the terminal
condition. The #181 spend page stays as observation only, never an action.

**Verify before adopt, beside #382:** whether the remaining window is programmatically
readable from the orchestrator. `rate_limit_event` is confirmed observable in
`stream-json` (parity doc R-o8); `/usage` scriptability is unverified.

### Manual acks are pre-authorized (parks → 0 in the observed record)

The gate is **untouched** and still honestly emits `deferred:manual` (#322's scope note
stands — the ack classing is correct). The run consumes a *named* pre-authorization from
`## Standing decisions` and self-approves; the receipt quotes both the claim and the
pre-authorization that discharged it. The intent-doc checker refuses any human-eyes
acceptance statement with no matching pre-authorization, so a guaranteed park is caught at
authoring, free. This is not a periphery edit: the gate's logic is unchanged and the class
becomes unpopulated by construction at the authoring layer.

> **All three parks in runs 18–23 were `deferred:manual`** — run-18 (the #345 adoption
> verdict), run-19 (suite-gate discovery verified statically only), run-21 (the `/plugin`
> card wording). Runs 20/22/23 carried only `deferred:runtime`/`external` acks, all
> self-approved, all green. **Parks under this rule across runs 18–23: 0.**

`**Commutes:**` moves to the derivation tier (#271's datum: declaration, not nature, is
the bottleneck) and **stays** — #242(c)'s retirement trigger has not fired; run-20 produced
the first real `autoResolved: 1`.

### The bar, restated

| row | restated |
|---|---|
| cost | `tokens ≤ 1.0×` per run → **tokens per *merged task* ≤ 1.15×**. The unit changes because a run's task count is no longer fixed once do-overs move between runs. The 1.15× is a deliberate pre-registered admission: **this design does not pay for itself in tokens** (saved ≈ 38–100k/run against an authoring pass per wave ≈ 40–150k/run — a wash, plausibly negative). It buys the deletion of a defect class, spend moved off the operator's shared window, and attention moved to statements the operator can adjudicate. A bar one expects to fail is not a bar |
| gate parity | measured on the **derived** plan against the old engine's authored plan for the same intent (same wave shape, same gate verdict); each `evals/fixtures/*/` gains an intent doc |
| parks per run | strengthened from "≤ old" — the observed record goes to 0 |
| prose ceiling | a second ceiling for the owned authoring skill, plus the intent doc's own (below) |
| guards deleted ≥6 | +4 rows: the spend-cap supervisor, the #322 dispatch-time fitness preflight, and the three superpowers-compat scripts |
| scripts ≤10 | +1 intent checker, −1 fitness preflight — holds |

### New rule 7 — the intent doc's schema is ceilinged

`## Standing decisions` is exactly the shape that accretes; every future incident will want
to add one, which is *"each scar became another step in the protocol"* with a fresh home
and a good excuse. **A fixed slot count and a word ceiling, pinned by a test the way
`test_skill_budget.py` pins SKILL.md. A new slot owes a deleted one. Standing decisions are
capped per intent doc** — past the cap the effort is too big and gets decomposed, not
annotated.

### Canaries (pre-registered)

Map #238's target *"plan-caused redirect rounds → ~0"* is **rejected as unfalsifiable** —
it goes to zero by construction once plans carry no bodies. The cause taxonomy splits into
**contract-caused** (the signed artifact was wrong) and **derivation-caused** (the wave
author wrote a bad body against real code).

| # | canary | baseline | bar |
|---|---|---|---|
| 1 | redirect rounds per task, all causes | 0.57 (29/51, distill 2026-08-24) | ≤ 0.57, no regression |
| 2 | derivation-caused rounds per task | 0.33 equivalent (17/51 plan-caused) | ≤ 0.15 |
| 3 | judgment calls overturned by the operator at the PR | new | ≤ 1 in 5; worse → that fork class reverts to parking |


## Amendment 5 (operator, 2026-08-28) — "extends, does not fork" is lifted

CLAUDE.md's founding constraint (*ultrapowers extends, does not fork, superpowers*) was a
decision taken when the project was a bolt-on execution method. The operator lifted it in
the #243 grilling. **Fork exactly one thing — the authoring path — and drop the rest
rather than vendoring it.**

- **Owned (forked):** `superpowers:brainstorming` + `superpowers:writing-plans` +
  `ultrapowers:ultraplan` collapse into **one** authoring skill carrying the slot schema,
  the fork question bank, the read-back, and the deterministic completeness check.
- **Dropped (not vendored):** `subagent-driven-development`, `executing-plans`,
  `using-git-worktrees`, `test-driven-development`, `requesting-code-review`,
  `verification-before-completion`, `systematic-debugging`. Nothing in the pipeline
  invokes them; the reviewer, critic and gate do this in-engine with receipts.
- **Uncoupled:** mattpocock skills stay available to operator sessions, required by nothing.

**Measured case:** `ultraplan/SKILL.md` is 3,038 words against `writing-plans`' 1,059 —
2.9× its parent — and carries three explicit overrides of it (replacing the mandated
header line; *"writing-plans demands complete code in every step; here that holds only
where…"*; two execution options becoming three). Under Amendment 4 that override becomes
total. **Vendoring was considered and rejected:** `subagent-driven-development` alone is
4,825 words and the set is ~10,000 — the largest surface addition in project history, one
release after Phase 0's −9,104 lines, against rule 5 — and it does not cure the stated
problem, because superpowers' `SessionStart` hook fires from the *user's* install
regardless of what we depend on.

**Residual, handled without machinery:** that hook names the skill by hand (*"'Let's build
X' → superpowers:brainstorming first"*), and its own text supplies the lever — *"User
instructions (CLAUDE.md, AGENTS.md, direct requests) take precedence over skills."* One
precedence line in the existing `hooks/session_start.sh` declares which skill owns this
pipeline. If that proves insufficient in practice, *then* there is a measured case for
something heavier. Check the license before shipping derived prose.

Recorded as its own `wayfinder:task` on map #238 — it changes what the plugin *is*
(CLAUDE.md's standing rule, the marketplace description, the hook, three skills), not only
how plans are shaped.

**Net complexity of Amendments 4+5, audited before the operator confirmed:** prose down
(ultraplan's body rules, its three override sections, `plan-markers.md`'s authoring half
and "Executor variance" section; 8,552 words of superpowers skills no longer loaded and
reconciled at authoring time; one owned skill replacing three), **scripts −3**, **guards
−2 with numbers**, and **four prose↔code seams deleted** against one added — deleted:
plan-text ↔ real code (6/6 defects), superpowers ↔ ultrapowers, guessed number ↔
destructive action, gate class ↔ standing grant; added: intent doc ↔ derived plan.
Increases named honestly: two artifacts where there was one, a new failure mode (a plan can
be *derived* wrong — canary 2 exists for it), a new audit obligation in the receipt, and
maintenance of a forked skill. Rule 7 is the condition that keeps the ledger from reversing.


## Amendment 6 (2026-08-28) — #382 measured: prompt-cache behaviour across `claude -p` workers

`docs/superpowers/specs/2026-08-28-prompt-cache-across-workers.md` (23 `claude -p` runs +
10 HTTP controls, all on the fleet's 2.1.238, subscription OAuth, **no settings file on the
host** so every default is Claude Code's own). This is the input #389 was blocked on. The
spec adopts these rows; the note is the citation.

| row | measured |
|---|---|
| Cross-process prefix sharing | **holds, completely.** A separate process launched after the first exited read **100%** of its prefix (`cc=0, cr=24,984`). Not session-, run- or process-scoped |
| Default cache TTL in `-p` | **1 hour.** `ephemeral_1h_input_tokens` = the whole write, `ephemeral_5m` = **0**, on haiku / opus / fable. 12× the Workflows fan-out default; **no `subagentPromptCacheTtl` analogue is needed** |
| What the big block is keyed on | **model + CLI version alone** — not the role prompt, not the clone. Three siblings launched simultaneously in fresh clones with a brand-new role prompt file each read **18,139 (72.6%)**. The appended system prompt sits *after* the breakpoint |
| Prefix decomposition | B1 18,139 (72.6%, model+CLI) · B2 4,069 (16.3%, role file ⊕ `cwd`) · B3 2,776 (11.1%, task text). opus: 16,020 / 2,777 / 3,186 |
| Wave-boundary gap (Amendment 4's second question) | **costs nothing.** 6-min gap → 100%/100%/100%; 11-min gap → 100%. Price the serial authoring pass on its own tokens; there is no decay surcharge, and no reason to overlap authoring with execution to protect a cache |
| Fix round: resume vs fresh | **resume, 3.1× cheaper** (`cc` 109 at 2 s, 92 at 11 min, vs 2,776 fresh). Overturns Amendment 3's row and the parity doc's item 10, whose "the prior turn's cache had partly expired" explanation is falsified |
| Cost | opus, empty task: cold **$0.0686** → full hit **$0.0120** = **5.7×**. A cold wave of 3 writes 20,535 prefix tokens instead of 74,952 — **72.6% of the wave's prefix write cost is never paid** |
| The Workflow arm | **not reconstructable** — `fleet-receipts/run-*/` holds the gate receipt only, and Workflows report tokens in the UI only (parity §9). Comparison is docs-claim vs measurement, and stated as such |

**Packing rule: unchanged.** Amendment 3's rule stands as written — one wave per sandbox,
width ≤ ~4 *(raised to **8** by measurement — see the amendment at the end of this file)*.
Launching siblings together is a wall-clock choice, not a cache choice: the
prefix is there an hour later either way. No TTL flag, no launch-window choreography.

**Cost row: not endangered.** `tokens per merged task ≤ 1.15×` — the cache term moves
toward the driver, not away. Expect ~73% prefix cache-read share on a cold wave and ~100%
on a re-dispatch into the same clone within the hour, which is the fix-round case.

**Two spec obligations this adds:**

1. **Pin the worker CLI version per run.** B1 is invalidated for every worker after a CLI
   roll or a model switch mid-wave, at ~18 k tokens each. The sandbox image already pins
   it — say so on purpose.
2. **Adopt `--exclude-dynamic-system-prompt-sections`, and keep rejecting the contortion.**
   Measured after the docs pass (note §H): the documented flag moves cwd/env/git-status out
   of the cached prefix and raises cross-clone sharing **72.6% → 88.4%**, cutting per-worker
   prefix creation 58% — while every worker keeps its own clone. The shared-`cwd` trade,
   which would have cost the per-clone write confinement that makes role isolation
   enforceable, stays rejected because it is no longer the only way to buy B2.


**Docs pass (primary sources, note §I) — three additions to the measured rows:**

| row | disposition |
|---|---|
| The 1 h default we measured is the **main-conversation** bucket; a workflow agent's requests fall outside it and get **5 minutes by default, including on a subscription** ([workflows#prompt-caching-in-a-fan-out](https://code.claude.com/docs/en/workflows#prompt-caching-in-a-fan-out)) | The port does not merely avoid a TTL setting — it **moves every worker from the 5-minute bucket into the 1-hour one** by making each worker a main conversation. A second, independent reason the driver's cache position beats the engine it replaces |
| `promptCacheTtl` / `subagentPromptCacheTtl` need **v2.1.242+**; the orchestrator runs **2.1.238** | Immaterial — the default is already the one we want. What the driver owes is the negative: **never set `FORCE_PROMPT_CACHING_5M=1`**, never let `DISABLE_PROMPT_CACHING*` reach a worker's env |
| `rate_limit_event` is **not a documented event type** — what exists is `system`/`api_retry` with `rate_limit` as one value of its `error` field, alongside `attempt` / `max_retries` / `retry_delay_ms` ([headless#handle-api-retries](https://code.claude.com/docs/en/headless#handle-api-retries)) | **Corrects this amendment's own admission-control wording** and the spec's first draft, which would have halted nearly every multi-wave run at wave 1. The predicate is retry **exhaustion** on a `rate_limit` error, or a rate-plus-delay threshold calibrated from the first three runs — never a single retry |

### Verify-before-adopt discharged: is the rate window programmatically readable?

Amendment 4 deleted the 500 k cap in favour of **wave-boundary admission control off the
real meter**, and left this unverified. Measured:

**The endpoint is real and scriptable.** `GET https://api.anthropic.com/api/oauth/usage`
with a bearer OAuth token returns HTTP 200 and `five_hour.utilization` /
`seven_day.utilization` / `resets_at` / `locked_reason` / `extra_usage` — a rate-window
reading, exactly what the deleted dollar cap was groping for.

**The orchestrator's credential cannot read it.** `/home/exedev/.fleet/claude-oauth-token`
returns **429** on every header variant. Controls: bogus token → **401**; **no** auth
header → **429** from both hosts; laptop keychain token ×3 → **200/200/200**. So 429 is the
endpoint's *unauthenticated* shape and the `setup-token` credential is not accepted for it —
it authenticates for inference fine (all 23 runs). The laptop credential carries
`user:profile` among its scopes; the long-lived one evidently does not. Both are
`sk-ant-oat01`, both 108 chars — the shape does not distinguish them.

**Disposition the spec must take (recommendation, not a decision):** `rate_limit_event`
observation in `stream-json` (confirmed, parity R-o8) **for the cutover** — no new
credential in the release that is meant to be a subtraction, and a reactive signal is
already strictly better than a post-hoc dollar cap that destroyed the sandbox; a
profile-scoped orchestrator credential polling `/api/oauth/usage` at wave boundaries as a
**follow-up ticket**, which is the stronger form of what Amendment 4 asked for.


## Amendment 7 (operator, 2026-08-28) — seven decisions on the spec; rule 5 loses its line ceiling

Taken at the review of `docs/superpowers/specs/2026-08-28-one-driver.md` (#389, PR #394).
The spec is **plan-ready**; these are mirrored here the same sitting, per the map's rule.

| # | decision |
|---|---|
| 1 | **No line ceiling on code** — see the rule 5 amendment below |
| 2 | **Admission control ships as OBSERVATION ONLY in 0.3.0.** The gate is built in 0.3.1 from the data 0.3.0 collects. The claim-lease VM reaper ships regardless (it is a leak fix) |
| 3 | **`claude plugin eval` gates the client surface only**, not the engine |
| 4 | **#390 ships INSIDE 0.3.0**, not beside it |
| 5 | **The owned authoring skill's ≤ 1,500-word ceiling is a release-refusing bar**, raisable only by stating the new number and its reason in the release commit body (the 0.2.23 practice) |
| 6 | **Superpowers stays installed on the operator's machine**; the residual is one precedence line in `hooks/session_start.sh` |
| 7 | **`ultradocket`'s sweep is reworked inside 0.3.0** so no tool anywhere still emits the old artifact |

### Rule 5 is amended: the surface ceiling is on PROSE, not on lines of code

**Rule 5 as chartered:** *"Surface ceiling in the spec, deletion owed per guard … the
ceiling is the only counter-reflex we have found that works (the SKILL.md word pin proved
it)."* The **deletion-owed-per-guard** half is untouched and remains binding. The **ceiling**
half is narrowed to the artifact its evidence covers.

**Why, in three measured points rather than a preference:**

1. **The proof behind rule 5 is a prose pin.** SKILL.md 3,129 → 864, where length *is* the
   harm: more steps for an LLM to sequence is more places to drift. That is the failure the
   outside review named. A 2,354-line wave loop is not dangerous because it is 2,354 lines.
2. **On this codebase a line count taxes the design record.** Comments are **33–50%** of the
   files such a ceiling would govern — `shim-main.mjs` 50%, `drive.mjs` 36%,
   `orchestrator.mjs` 33%, `waves.js` 33% — and here they carry *why* (`BASE_REF` is the
   fixed point; four things must be true before a token is spent). The operator does not
   read code, so that prose is how the reasoning survives at all.
3. **It fails this project's own doctrine.** Incident narratives never justify guards
   (`subtraction-eval-doctrine`); a line ceiling is a guard on ourselves with **no measured
   case** behind it. Two drafts proved the point empirically: the first (≤ 6,157) permitted
   **62% driver growth** while claiming to freeze the code, and the second (≤ 4,400) was
   **already violated on the day it was written** (`fleet/**` = 4,476, because it counted
   `RUNBOOK.md` and a lockfile).

**What now carries rule 5's intent** — counts of things a human or an LLM must actually
hold, plus the rule that names the real enemy:

- **prose ceilings**: engine `SKILL.md` ≤ 400 words · owned authoring skill ≤ 1,500 words ·
  intent doc exactly 7 slots, ≤ 8 standing decisions;
- **scripts ≤ 10**; **guards deleted ≥ 6, each with its licensing number**;
- **every guard added after go-live owes a deletion in the same PR, and a measured number** —
  which names *accreted guards*, the thing the chartering diagnosis actually indicted
  (*"each scar became another step in the protocol"*), where a line count cannot distinguish
  a guard from a well-factored function.

**All ceilings share one escape hatch, and it is what lets them be hard bars:** a ceiling is
raised only by writing the new number **and its reason** into the release commit body. It
binds, it is visible the moment it moves, and it can never stall a release outright.

### Consequences for rows elsewhere in this file

| row | change |
|---|---|
| §Pre-registered bar, *"surface ceiling"* | reads **prose ceiling**; the line/word ceiling "for the driver" is deleted, the one "for prompts" stands |
| §Amendment 4, *"prose ceiling — a second ceiling for the owned authoring skill"* | now a **release-refusing** bar at ≤ 1,500 words |
| §Amendment 4, the deleted cap's replacement | 0.3.0 **observes**; the wave-boundary control itself is 0.3.1's, fitted to real `api_retry` distributions rather than to an estimate — the same objection that licensed deleting the cap ("calibrated from size means") applies to replacing it with a guess |
| §Amendment 5, all seven rows | **in 0.3.0**, not deferred; superpowers stays installed, handled by the precedence line |
| §Decisions taken, 3 (*ultradocket's drain half becomes "drive a plan"*) | becomes **"emit an intent doc"**, and lands **in 0.3.0** |

### Amendment 3's packing constant is measured (2026-08-28) — 4 → 8

*"Capped by a driver constant (4 suggested) … N=3 on a 1-vCPU/2 GB box ran clean"* was the
largest width ever run **plus one**, measured on a box **one eighth** the size of a real run
sandbox. Measured properly on a `cp fleet-golden` clone (8 vCPU / 15 GB),
`evals/frontier/results/2026-08-28-wave-width.md`:

| N | total wall | success | CPU % peak | load peak |
|---|---|---|---|---|
| 1 | 11.94 s | 1/1 | — | — |
| 4 | 14.60 s | 4/4 | 29 | 0.28 |
| **8** | 12.83 s | **8/8** | **66** | 0.21 |
| 12 | 13.89 s | 12/12 | **98** | 1.13 |

Wall-clock is **flat** — +16% for 12× the work — with **zero non-success envelopes across
27 workers**. CPU peak rises ~8 points per worker and hits the ceiling at N=12. **The
constant becomes 8**: the last width with margin.

**Bounded, and the bound matters:** these workers only *read* (`Read,Grep,Glob`). A real
implementer runs the test suite, which is CPU-bound in a way `Grep` is not — so this
measures the dispatch layer's ceiling, not the workload's. Still owed: the same arms with a
worker that runs `pytest`.


## Amendment 8 (2026-08-28) — the seam already exists; the port is a substitution

Found while reviewing the build plan, after the spec was plan-ready. Recorded in full as
one-driver spec **§1a**; mirrored here because it changes what the build *is*.

**`harnesses/waves.js` is already parameterised over its worker dispatcher.** It is a
function of six injected globals — `agent, parallel, phase, log, args, budget` — and the
Workflow tool is only one thing that supplies them. `tests/sim_workflow.mjs` already supplies
a second set with a stubbed `agent`. **The driver is the third.**

The entire interface is `agent(prompt, opts)` with **four** option keys — `label`, `model`,
`schema`, and `isolation: 'worktree'` at exactly **two** of the ten call sites — plus one
return convention: `agent()` returns **`null`**, never throws, on terminal overload.

**Consequences for rows in this file:**

| row | change |
|---|---|
| §Eureka half 2, *"move that loop into the driver"* | sharpened: the loop does not move house, it gets a third implementation of a seam it already has. Scheduler, fix loop, fold adoption, reconciliation and the critic are **unchanged** |
| §Rules 3, *"port, don't rewrite"* | now literally achievable, and measurable: the three sims run the real `waves.js` against an injected dispatcher, so passing them **is** the port's specification |
| #314 / `baseCorrected` | `waves.js:1116` states the cause in its own words — *"engine worktrees are cut by the runtime (`isolation: 'worktree'`), not by this script."* The driver cutting at BASE is the two-site change that makes it inexpressible |
| §Route step 4, "build on branch, validate with fleet runs" | **restaged** — spec §10: stage 1 is local and gated by sims, because the thing being built is what runs fleet builds. Using the old engine to build its replacement requires a bridge, and the bridge is a graft |
| §Amendment 4's plan shape | unchanged as a *design*, but not exercised by the port itself. The port is stage 1; derivation is stage 3 |

**The plan this replaces.** A first build plan decomposed the port into twelve tasks and
**ten new modules**, driven on the fleet through a bridge that converted the intent document
into a marked plan the old engine could compile. That is a rewrite wearing a port's clothes,
forbidden by rule 3 in the same document that cited rule 3 — and it stacked three novelties
(new artifact, no plan bodies, retiring executor) on the one change that must not go wrong.

**The operator's catch, kept because it generalises:** *things go wrong when one system tries
to graft onto another.* The bridge was the graft. It is deleted.
