# One Driver — design inputs (map #366, frozen 2026-08-28)

**What this file is.** The committed, in-repo copy of wayfinder map #366 as it stood
at the end of the sitting that chartered it — the diagnosis, the two-half eureka, the
operator's decisions (including Amendment 1), the pre-registered bar, the deletion
ledger, the rules, and the harness mechanics read from the Claude Code docs. Issues
sprawl and get forgotten; this file is the version the build must read.

**Consumption contract.** The one-driver spec (`docs/superpowers/specs/<date>-one-driver.md`,
written after the #243 grilling) MUST carry a `## Design inputs` section that lists every
row of the **deletion ledger** and every row of the **harness mechanics** table below and,
for each, says one of: `adopted` (with the spec section that implements it), `answered`
(why not, in one sentence), or `deferred` (to which ticket). A spec that skips a row is
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
- #243 — grilling: plan only the merge frontier (prerequisite for the spec)
- #360 — map: The Merge Frontier (sequenced after cutover)
- #368 — task: the orchestrator opens the PR (Amendment 1 decision 5; buildable now)
- ~~#364~~ — superseded by Amendment 1 (no local substrate)
- (to file after the grilling) `wayfinder:task` — the one-driver spec + build

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

