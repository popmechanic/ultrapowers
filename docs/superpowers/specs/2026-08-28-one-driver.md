# The One Driver — spec (#389, map #366)

**Status:** DRAFT, awaiting adversarial trim review then operator review. Not plan-ready
until §8 is complete and the trim review has run.
**Map:** #366 *The One Driver*. **Ticket:** #389. **Client half:** #390 (dependency posture).
**Design inputs (frozen, adopt-or-answer row by row):**
`docs/superpowers/specs/2026-08-28-one-driver-design-inputs.md`, **Amendments 1–6**.
**Supporting measurements:** `2026-08-28-claude-p-worker-parity.md` (#365, as corrected),
`2026-08-28-prompt-cache-across-workers.md` (#382), `2026-08-28-one-driver-phase-0.md`
(shipped 0.2.26).

---

## 1. The change, in one page

Today an LLM reads `skills/ultrapowers/SKILL.md` and sequences deterministic scripts, then
hands a plan to Claude Code's Workflow tool, which reaches workers through `agent()`. Two
non-determinisms sit above the work: an LLM operator, and a runtime we do not control that
cuts worktrees from the session checkout rather than from BASE.

**After this spec there is one program.** `fleet/drive-one.mjs` grows the wave loop that
lives in `harnesses/waves.js` today and becomes *the engine*. It provisions each worker's
clone at BASE itself, dispatches one `claude -p` process per worker with a prompt file and
a JSON schema, reads the result envelope, merges, folds, gates, and opens the PR. **No LLM
ever orchestrates.** An LLM appears only as a worker: implementer, reviewer, critic, and —
new under Amendment 4 — **wave author**.

Three consequences fall out rather than being engineered:

- **Wrong-base becomes inexpressible.** The thing that cuts the clone is the thing that
  knows BASE, so #314's `startHead`/`baseCorrected` guard and its watch (#354) have nothing
  left to detect.
- **Prompts stop being baked.** They are files the driver passes with
  `--append-system-prompt-file`, so `workflow-template.md`, `test_no_prompt_drift.py` and
  the re-bake ritual go.
- **Roles stop being requests.** A reviewer that cannot call `Edit` is a flag-set, not a
  sentence in a prompt.

And one thing the operator asked for arrives: **the operator signs an intent document, not
a plan** (Amendment 4). The plan is derived one wave at a time by a worker reading the
merged tree, and is disposable.

**What does not change:** the trust core. Receipts at shas, exit codes as authority, the
standing grant, park-by-default, one human gate on the PR. This spec moves *who sequences*,
never *what is proven* (rule 1).

## 2. The run, end to end

The laptop is a thin client (Amendment 1). Every step below except 1 and 9 runs on exe.dev.

1. **Author + sign (laptop, HITL).** The operator and the owned authoring skill (#390)
   produce `intent.md` — task set, `Depends-on` edges, `Interfaces`, one acceptance
   statement per task, `## Global Constraints`, `## Standing decisions`, cadence. The
   deterministic **intent checker** refuses an empty or `unknown` slot, and refuses any
   human-eyes acceptance statement with no matching pre-authorization (§6). Commit, push.
2. **Launch.** `node fleet/drive-one.mjs <intent-path> run-<N>` on the orchestrator. This
   is the whole client surface.
3. **Provision.** The driver copies `fleet-golden` to a run sandbox and, inside it, cuts
   `clones/integration` and one `clones/task-<id>` per task **at BASE**, by hand.
4. **Derive wave *n*.** The **wave author** worker runs read-only against
   `clones/integration` (the merged tree — real code, not the base) and emits
   `plans/wave-<n>.json`: bodies, `**Files:**` refinement inside already-signed tasks,
   `**Commutes:**`. It may not add or remove tasks, edges, or acceptance statements — those
   are signed. Schema-validated on the way out.
5. **Dispatch.** One `claude -p` per task in the wave, concurrently, on this sandbox
   (packing rule: one wave per sandbox, width ≤ 4). Implement → review → fix, where a fix
   round is `--resume <implementer session-id>` (§8, Amendment 6).
6. **Merge + fold.** Unchanged in semantics: the fold kernel, `fold_wave.py`,
   `wave-merge.md`'s reconciliation, the completeness critic. Map #360 owns its future.
7. **Admission check at the wave boundary.** If the window is under pressure the next wave
   does not start: the run folds what it has, publishes, and says so in the receipt (§5).
8. **Gate once.** `gate_check.py` / `ultra_gate.py` as library functions. Exit code is the
   authority. Two-move rule on the verdict, with manual acks now discharged by named
   pre-authorizations from `## Standing decisions` (§6).
9. **The orchestrator opens the PR** with the receipt (Amendment 1 decision 5). Green → a
   ready PR. Parked → a draft PR. The operator adjudicates recorded judgment calls there,
   and merges. The laptop never fetches a run branch.

## 3. The four role flag-sets

Roles are **data** — one JSON object per role in the driver, not prose. Amendment 4 makes
it four; the fourth is specified here for the first time.

| role | model / effort | permission | tools | writable |
|---|---|---|---|---|
| **wave author** *(new)* | `opus`, `--effort high` | `dontAsk` | `Read,Grep,Glob,Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git status *),Write` | **the run dir only** |
| implementer | per-task tier | `acceptEdits` | default minus `Bash(git stash *)`, `Bash(git push *)` | its own clone only |
| reviewer | `most-capable` | `dontAsk` | `Read,Grep,Glob,Bash(git diff *),Bash(git log *),Bash(git status *)` | nothing |
| critic | `most-capable` | `dontAsk` | same as reviewer | nothing |

Confinement is a `PreToolUse` hook passed inline via `--settings`, denying `Edit`/`Write`/
`Bash` writes outside the role's writable root — the boundary the sandbox VM backs up. OS
sandboxing is interactive-only, so the hook is the mechanism (Amendment 3).

**The wave author is the delicate one, and its shape is the point.** It runs with `cwd =
clones/integration` so it reads the *merged* tree, but its hook allows `Write` only under
`<run>/plans/`. It therefore cannot edit the code it is planning against — the separation
that makes "derive the plan" different from "start implementing." Its output is
schema-validated (`--json-schema`), so a wave author that wanders produces a non-conforming
envelope and is retried with escalation, exactly as `runTaskInner` does today.

Per Amendment 6, giving each role its own system-prompt file costs nothing: the shared
cache block sits *before* the appended prompt.

## 4. The run directory, and where the derived plan lives

One tree per run, inside the sandbox, disposable. `CLAUDE_CONFIG_DIR` points into it, so
**the run directory is the evidence bundle** — complete, and nothing else's (Amendment 3).

```
<run-root>/
  intent.md                     the signed artifact, copied at the sha it was read at
  intent.sha
  claude/                       CLAUDE_CONFIG_DIR — every worker transcript
  clones/
    integration/                the merged tree; the wave author's cwd
    task-<id>/                  one clone per task, cut at BASE by the driver
  plans/
    wave-<n>.json               the derived plan (schema-validated)
    wave-<n>.md                 its rendered form, for the receipt and the PR body
  judgment/
    <task-id>-<k>.json          one recorded fork: both readings, the branch taken, why
  workers/
    <task-id>/{cmd,envelope.json,stream.jsonl}
  receipts/
    receipt.json  gate-receipt.json  approve-receipt.json
```

**The receipt grows to carry the derivation** (Amendment 4). Added to today's schema:

| field | carries |
|---|---|
| `intent.sha`, `intent.path` | what was signed |
| `waves[].planSha`, `waves[].plan` | the derived plan for that wave, inline — the receipt is self-contained, the run dir is not kept |
| `judgmentCalls[]` | `{taskId, question, readings: [a, b], taken, rationale, standingDecision?}` — `#204` loudness; the operator adjudicates these at the PR |
| `acceptance[]` | `{taskId, statement, evidence}` — one pair per signed acceptance statement |
| `admission[]` | `{waveIndex, decision, signal}` — why a wave started or did not (§5) |
| `standingDecisions[]` | which pre-authorizations were consumed, and by which ack |

A judgment call that no `## Standing decisions` entry anticipated is still taken and still
recorded — it is not a park (Amendment 4). Canary 3 measures how often the operator
overrules one.

## 5. Admission control — the replacement for the deleted cap

The 500 k per-run cap and `fleet/orchestrator.mjs:214–281` are deleted (Amendment 4). Three
mechanisms replace it, all already owned:

1. **Wave-boundary admission control.** Between waves the driver decides whether to start
   the next one. Under pressure it does not: the run folds what it has, publishes, opens
   the PR, and the receipt says *"stopped at wave 2 of 3 for window pressure."* Honest and
   terminal, never destructive.
2. **Per-worker `--max-budget-usd`** as the runaway backstop — exit 1
   `error_max_budget_usd`, clean envelope (parity R-o3/R-l9).
3. **The existing convergence caps** as the terminal condition.

**The signal, decided.** #389's verify-before-adopt is discharged by Amendment 6:
`GET /api/oauth/usage` **is** scriptable and returns `five_hour.utilization` /
`seven_day.utilization` / `resets_at` / `locked_reason` — but **the orchestrator's
`setup-token` credential is not accepted for it** (429, the endpoint's unauthenticated
shape; four controls in the note). So:

> **The cutover ships signal (b): `rate_limit_event` observation in `--output-format
> stream-json`** (confirmed observable, parity R-o8). The driver treats a `rate_limit_event`
> seen by any worker in wave *n* as pressure, and does not start wave *n+1*.
>
> **Deferred to a follow-up ticket:** provisioning the orchestrator with a profile-scoped
> credential and polling `/api/oauth/usage` at each wave boundary — the stronger,
> *predictive* form of the same control.

The reason for taking the weaker signal first is not that it is better. It is that it adds
no credential surface in the release whose whole claim is subtraction, and a reactive signal
already dominates the thing being deleted: a post-hoc dollar cap that could only destroy
work already paid for, and that never fired in twelve runs (peak 63%).

## 6. The intent document, and rule 7's ceiling

**Seven slots, fixed.** `## Scope` · `## Tasks` (id, `Depends-on`, `Interfaces`,
`Produces:`, one acceptance statement) · `## Global Constraints` · `## Standing decisions` ·
`## Cadence` · `## Acceptance` · `## Out of scope`.

**Each acceptance statement is operator-verifiable and carries no implementation code:** a
`do:`/`see:` example where behavior is observable, a **number or bar** where it is not.
Phase 0's own bar (864 words / 13 scripts / 11 guards / parity green) is the proof the
number-form verifies non-observable work. A task that can produce neither is the
#322/run-14 shape and the intent checker refuses it at authoring time — free, before any
spend.

**Rule 7's ceiling, proposed for operator adjudication:**

| ceiling | number | why this one |
|---|---|---|
| intent doc, total | **≤ 900 words** | roughly a signed page; past it the effort is too big and gets decomposed, not annotated |
| `## Standing decisions` entries | **≤ 8** | the accretion site; a cap is the only counter-reflex that has worked (rule 5) |
| slot count | **exactly 7** | a new slot owes a deleted one, in the same PR |
| engine prose (`SKILL.md`) | **≤ 400 words** | pre-registered in #366; from 864 today, 3,129 before Phase 0 |
| owned authoring skill (#390) | **≤ 1,500 words** | replaces ultraplan 3,038 + writing-plans 1,059 + brainstorming's shape — a real subtraction, not a rename |
| driver + engine, combined lines | **≤ 6,157** | today's `fleet/*.mjs` 3,803 + `waves.js` 2,354. **The port may not grow the code**, even while absorbing the wave loop |

All six are pinned by tests, the way `test_skill_budget.py` pins SKILL.md, and raised only
in a release-commit body (the practice from 0.2.23).

## 7. What the driver may become

Rule 5 is the rule that keeps this from being tower #2, so it gets teeth here:

- **Every guard added after go-live owes a deletion in the same PR.** Not "a deletion
  eventually" — in the same PR, named in the commit body with the number that licenses it.
- **A guard needs a measured number, never an incident narrative** (`subtraction-eval-doctrine`).
- **The line ceiling in §6 is the outer bound.** A PR that crosses it is refused regardless
  of what it adds.
- **Port, don't rewrite** (rule 3). `tests/sim_workflow.mjs`, `sim_base_ancestry.mjs`,
  `sim_derived_heads.mjs` become driver sims — same scenarios, same
  `ALL (SCENARIOS|TESTS) PASSED` sentinel. A rewrite that cannot run them is a different
  program and is out of scope.

## 8. Design inputs — adopt or answer

Every row of the frozen design-inputs file. `adopted §x` / `answered: …` / `deferred → #N`.

### 8a. Deletion ledger (10 rows)

| dies | disposition |
|---|---|
| `run_lock.sh`, RUN_LOCK, "serialize runs" (#134) | **adopted** — shipped in Phase 0 (0.2.26) |
| `sweep_worktrees.sh`, wf-runs / `wf_<stamp>` / `--all`, #157's leak class | **adopted** — shipped in Phase 0; the residual prose (`waves.js:409`, `wave-merge.md`, `sim_workflow.mjs:843`) dies with the port, §10 · #386 |
| `hygiene_check.sh`, `residual_manifest.py` | **adopted** — shipped in Phase 0 |
| `salvage_args.py`, `redirect_args.py`, resume-in-place, Salvage/Redirect lanes | **adopted** — shipped in Phase 0. A redirect is a new run with a narrower intent |
| Step 4a½ registry probe, `check_engine_skew.sh`, `harness_manifest.py`, `ultrapowers-probe` | **adopted** — shipped in Phase 0; `waves.harness.json` + `test_harness_registry.py`'s manifest test die with the Workflow tool, §10 |
| baked prompts, `references/workflow-template.md`, `tests/test_no_prompt_drift.py` | **adopted §1, §3** — prompts become `roles/*.md` files the driver passes with `--append-system-prompt-file`. `reviewer-prompts.md` + `wave-merge.md` become those files rather than sources for a bake |
| #314 guard (`startHead`/`baseCorrected`, watch #354), `FOLD_LOG.md`'s ancestry precondition | **adopted §1, §2 step 3** — the driver cuts at BASE, so the guard has nothing to detect. **This closes #354 as moot** rather than by measuring its trip rate |
| NEEDS_ACK prose grammar | **adopted** — shipped in Phase 0; the schema now also expresses pre-authorized manual claims and decision classes (§6, Amendment 4) |
| `check_superpowers_compat.py`, `resolve_superpowers.py`, `superpowers_contract.py` | **adopted §8e** — all three die outright; Amendment 4 voids the *"authoring still does (HITL)"* carve-out and #390 forks the authoring path |
| `ultra_run.py`, `finalize_report.py`, `warm_cache.sh`, `audit_run.py` | **adopted §1** — absorbed into the driver as functions. Their tests move to driver tests, they do not vanish |
| `review-package` *(not in the frozen ledger — added by this spec, with its number)* | **adopted §1** — it exists only to bridge **linked worktrees**: its header says *"implementer and reviewer run in DIFFERENT linked worktrees, so the packet must live somewhere both can see"*, and it derives that shared path from `--git-common-dir`. The driver gives each worker an **independent clone at BASE** and owns the run dir, so the derivation is dead and the remaining work is three git commands the driver runs itself, writing to `<run>/workers/<task-id>/`. `tests/test_review_package.py` follows it |

**Kept, verbatim in semantics:** `compile_plan.py` (+ `--check --renders`), the fold kernel
+ `fold_wave.py`, `gate_check.py`/`ultra_gate.py` as library functions,
`run_acceptance.sh`'s suite-gate half, `validate_skill.py`, `report-format.md`, the store
(#308), `ultralearn`. **Changed from kept:** `readSessionTokens` + the spend cap
(deleted, §8d); the store's `budgets` table (deleted, §8d).

**Script count:** 13 today → **6** (`compile_plan.py`, `gate_check.py`, `ultra_gate.py`,
`run_acceptance.sh`, `validate_skill.py`, + the new intent checker). Eight deleted, one
added. Bar is ≤ 10. **Guards deleted with a licensing number: 11 in Phase 0 + 4 here** (the
#314 guard, the spend-cap supervisor, the #322 dispatch-time fitness preflight, the three
superpowers-compat scripts counted as one) — bar is ≥ 6.

### 8b. Harness mechanics (12 rows, as corrected by Amendment 3)

| mechanic | disposition |
|---|---|
| Structured worker replies | **adopted §3, as corrected** — the harness retries in-loop with a `[structured-output-enforce]` nudge and bounces schema violations to the model as tool errors; the fail-closed envelope is `subtype: error_max_turns` / exit 1 / `structured_output: null`. The driver's retry-with-escalation wraps a harness that already retried |
| Role isolation, enforced not prompted | **adopted §3** — four flag-sets, `PreToolUse` hook via `--settings`. #315's stash ban becomes a denied tool |
| Per-worker knobs | **adopted §3** — `--model`, `--effort`, `--fallback-model`, `--max-turns`, `--max-budget-usd` |
| Spend from the result | **adopted, as corrected** — **sum `modelUsage`**, not top-level `usage` (last API call only). `readSessionTokens` and #209's transcript coupling retire. `total_cost_usd` is a client-side estimate and is recorded, never enforced against |
| Isolated sessions per worker | **adopted §4** — distinct `--session-id`, per-run `CLAUDE_CONFIG_DIR` (+ `CLAUDE_CODE_PROJECT_DIR_NAME`, 2.1.234+, on the golden's 2.1.238). The run dir is the evidence bundle; #350's golden-prune chore is moot |
| Fix rounds resume, not restart | **adopted §2 step 5 — and the pre-registered measurement is discharged, not carried.** Amendment 6 measured it: `--resume` is **3.1× cheaper** than a fresh dispatch, at 2 s and at 11 min alike. Amendment 3's n=1 "resume 1.7× fresh, the cache had partly expired" is reversed and its explanation falsified. Driver closes worker stdin (`</dev/null`) |
| Prompt files, no bake | **adopted with the Amendment 3 substitute** — **`--bare` is a blocker**: it refuses subscription OAuth on 2.1.238 and 2.1.250. Ships as `--setting-sources user --disable-slash-commands` + per-run `CLAUDE_CONFIG_DIR`, which achieves the row's intent (no session_start hook, no superpowers, no stray skills, `--json-schema` + `--append-system-prompt-file` honored). **#384 stays open** as the watch: the day `-p` defaults to bare, workers need an explicit non-bare flag or the fleet's auth route breaks |
| Worker-side subagents, bounded | **adopted** — `--agents`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` / `_SPAWN_DEPTH`. `subagent_stats.refused.*` exposes cap trips. In stream-json a background subagent may emit **two** `result` lines — take the last |
| Failure classes | **adopted, as corrected** — observed exits are **0 / 1 / 143** only (no 2, no 130). Classify from `subtype` / `terminal_reason`, never the exit code alone. `api_retry` cited, not reproduced |
| Live progress into the store | **adopted §4** — `stream-json` tool-use events piped into TinyBase rows; this is also where `rate_limit_event` is read for §5. Replaces the shim's 5-minute spend ticks |
| Agent SDK as the upgrade path | **answered: not now.** CLI first — shell-debuggable, zero deps, and the docs' policy note (third parties may not offer claude.ai login for SDK-built products) makes it the policy-safe path. Trigger for revisiting: a synchronous `canUseTool` decision a hook cannot express |
| Plugin CI (`claude plugin eval`) | **deferred → #390** — it regression-tests the thin client's skills, which is the client half's surface, not the engine's |

**Amendment 3's packing rule:** **adopted §2 step 5** — one wave per sandbox, width ≤ 4,
spilling to a second sandbox only above the cap. Amendment 6 confirms nothing about the
cache argues otherwise (§8f).

### 8c. Amendment 1 — the laptop is a thin client

| row | disposition |
|---|---|
| No local execution substrate at all | **adopted §2** — the laptop authors, launches, observes, approves. Unit tests and sims stay local; the acceptance suite never does |
| Decision 5 — the orchestrator opens the PR | **adopted §2 step 9** — shipped already (#368, 0.2.26). Parks publish as draft PRs |
| Decision 6 — product statement | **deferred → #390** — README + marketplace wording is the client half's |
| Ledger additions (local driver path, #134 hazard, #250, local SKILL Steps 1–6, RUNBOOK laptop steps) | **adopted** — shipped in Phase 0 |
| #364 superseded and closed | **adopted** — no local sandbox to measure |
| Bar addition — laptop resident footprint ≈ 0 during a width-3 drain | **adopted §9** — measured once in the cutover PR (RSS + disk delta) |

### 8d. Amendment 4 — the plan shape

| row | disposition |
|---|---|
| Three tiers: signed / in-loop planning / building | **adopted §2, §3, §6** |
| No verbatim implementation code; one operator-verifiable acceptance statement per task | **adopted §6**; enforced by the intent checker, not by prose |
| No new mid-run human contact; forks are recorded judgment calls | **adopted §4** — `judgment/` + `receipt.judgmentCalls[]`, adjudicated at the PR |
| One gate per run, unchanged | **adopted §2 step 8** |
| NEEDS_ACK schema expands to manual claims + decision classes | **adopted §6** |
| The three superpowers-compat scripts die outright | **adopted §8a** |
| `readSessionTokens` + spend cap deleted | **adopted §5** — with `fleet/orchestrator.mjs:214–281`, the `budgets` table, `remaining`/`mayEnqueueSpend`, and the `capTokens` plumbing through `drive.mjs` / `drive-one.mjs` / `shim.mjs` |
| Store: `budgets` goes; new rows for admission decisions and judgment calls | **adopted §4, §5** |
| `compile_plan.py` gains the intent-checker sibling; `--renders` runs against real code at derivation time | **adopted §6, §2 step 4** |
| Role flag-sets become **four** | **adopted §3** — the wave author is specified there |
| The laptop authors intent; the fleet authors plans | **adopted §2** |
| #382 gains the between-waves cache-decay input | **adopted §8f** — measured: it costs nothing |
| Manual acks pre-authorized; parks → 0 in the observed record | **adopted §6**. The gate is untouched; the class becomes unpopulated at the authoring layer. **The periphery freeze holds** |
| `**Commutes:**` moves to the derivation tier and stays | **adopted §2 step 4** — #242(c)'s retirement trigger has not fired; run-20 produced the first real `autoResolved: 1` |
| Rule 7 — the intent doc's schema is ceilinged | **adopted §6**, with numbers proposed for adjudication |
| Canaries 1–3 | **adopted §9** |
| Bar, restated (6 rows) | **adopted §9** |

### 8e. Amendment 5 — "extends, does not fork" is lifted

| row | disposition |
|---|---|
| One owned authoring skill (brainstorming + writing-plans + ultraplan collapse) | **deferred → #390**, the client half. This spec depends on its *output* (the intent doc schema, §6) and specifies that schema here so #390 and #389 cannot drift |
| Drop the seven practice skills, do not vendor | **deferred → #390** |
| mattpocock skills uncoupled | **deferred → #390** |
| One precedence line in `hooks/session_start.sh` | **deferred → #390** |
| Word ceiling pinned by a test | **adopted §6** (the number), **built in #390** |
| Retire the three compat scripts | **adopted §8a** — engine-path deletion is this spec's; #390 owns the authoring-path consequence |
| Check the license before shipping derived prose | **deferred → #390** |

### 8f. Amendment 6 — #382 measured

| row | disposition |
|---|---|
| Cross-process prefix sharing holds completely | **adopted §9** (cost row) |
| `-p` writes the 1 h breakpoint by default | **adopted** — no `subagentPromptCacheTtl` analogue is built |
| The 72.6% block is keyed on model + CLI version alone | **adopted §3** — per-role prompt files are free; **§7 pins the worker CLI version per run**, which the sandbox image already does |
| Wave-boundary gap costs nothing (6 min, 11 min → 100%) | **adopted §2 step 4** — the serial authoring pass is priced on its own tokens; no overlap of authoring with execution to protect a cache |
| Fix rounds `--resume`, 3.1× cheaper | **adopted §2 step 5, §8b** |
| Cost: cold wave of 3 avoids 72.6% of prefix write cost | **adopted §9** |
| The Workflow arm is not reconstructable | **answered:** the gate-parity row (§9) compares wave shape and gate verdict, not tokens, precisely because the old engine cannot report per-agent tokens. The cost row is measured on the **new** engine against the recorded run-13…23 ledger totals |
| Do not contort the design for B2 (shared `cwd`) | **adopted §3** — per-clone write confinement is what makes role isolation enforceable; ~$0.008/worker is not worth trading it for |

## 9. The bar, and the canaries

Every number goes into the cutover release commit. **The release is refused without them.**

| measure | today | bar |
|---|---|---|
| engine prose | 864 words (`SKILL.md`) | **≤ 400** |
| owned authoring skill | 3,038 (ultraplan) + 1,059 (writing-plans) | **≤ 1,500** (#390) |
| intent-doc schema | — | **7 slots, ≤ 900 words, ≤ 8 standing decisions** |
| scripts under `skills/ultrapowers/scripts/` | 13 | **≤ 10** (projected 6, §8a) |
| driver + engine, combined lines | 6,157 | **≤ 6,157 — the port may not grow the code** |
| guards deleted, each with a licensing number | 11 (Phase 0) | **≥ 6 more** (projected 4 named + Phase 0's) |
| gate parity | — | on every `evals/fixtures/*/plan.md` (**10 fixtures**: chained, contend, contend-big, contend-prod, degrade, flawed, flawed-routing, mixed, webapp, wide — `jsdeps` carries no plan), the **derived** plan's wave shape and gate verdict equal the old engine's **authored** plan for the same intent. Each of the 10 gains an intent doc; writing them is in-scope build work, not a follow-up |
| live parity | — | **≥ 3 fleet runs green**, one at width ≥ 2, with `reported == ledger` and all five §W1d legs |
| cost | runs 13–23 ledger | **tokens per merged task ≤ 1.15×** |
| parks per run | 3 across runs 18–23, all `deferred:manual` | **0** |
| laptop resident footprint, width-3 drain | — | **RSS + disk delta ≈ 0** |

**On the cost row, stated plainly because a bar one expects to fail is not a bar:** this
design **does not pay for itself in tokens.** It saves ≈ 38–100 k/run in prevented do-overs
and spends ≈ 40–150 k/run authoring waves — a wash, plausibly negative. The 1.15× is a
deliberate pre-registered admission. What it buys is the deletion of a defect class (all six
defects in runs 18–23 were in verbatim plan bodies), spend moved off the operator's shared
window, and attention moved to statements the operator can actually adjudicate. Amendment 6
moves this row toward the driver — ~73% of every worker's prefix is a cache read by
construction — but not far enough to change the claim. **Never sell this on tokens.**

**Canaries (pre-registered).** Map #238's *"plan-caused redirect rounds → ~0"* is rejected
as unfalsifiable: it goes to zero by construction once plans carry no bodies. The taxonomy
splits into **contract-caused** (the signed artifact was wrong) and **derivation-caused**
(the wave author wrote a bad body against real code).

| # | canary | baseline | bar |
|---|---|---|---|
| 1 | redirect rounds per task, all causes | 0.57 (29/51) | ≤ 0.57, no regression |
| 2 | derivation-caused rounds per task | 0.33 equivalent | **≤ 0.15** |
| 3 | judgment calls overturned by the operator at the PR | new | **≤ 1 in 5**; worse → that fork class reverts to parking |

## 10. Cutover

1. Build on branch `one-driver`. The old path is untouched until the new one clears §9.
2. The existing sims must pass against the driver (rule 3): `sim_workflow.mjs`,
   `sim_base_ancestry.mjs`, `sim_derived_heads.mjs`, same sentinel. The suite-gate's
   harness-JS leg follows the code to its new home.
3. Validate with fleet runs — the fleet is both vehicle and first customer.
4. **One release, 0.3.0**, deleting the old path in the same release, with every §9 number
   in the release commit. This is the operator's explicit override of "stay on 0.2.x."
5. **#386 closes at this release** — each of its residual lines is deleted or explicitly
   kept, including the stale prose naming deleted scripts, `waves.harness.json`, the
   ultradocket `Seal` field, and the execution-handoff rubric's Inline/Subagent-Driven
   options (abolished by Amendment 1, refused by the `fleet-run` stage).
6. **#354 closes as moot** (§8a), and **#384 stays open** as a watch (§8b).
7. Then map **#360 Tier 1** lands on the simplified base.

## 11. Out of scope

- **The merge kernel.** Map #360 owns it. This spec ports `fold_wave.py` and the
  reconciliation semantics unchanged and touches neither `kernel/vendor/manyana.py` nor the
  layering rule (*Manyana merges values, TinyBase coordinates the index*).
- **The verification periphery.** `gate_check.py`, `ultra_gate.py`, `run_acceptance.sh` and
  the compiler's diagnostic vocabulary move house without changing behavior. The one thing
  that changes — manual acks being discharged by pre-authorization — happens at the
  *authoring* layer, leaving the gate's logic untouched (§8d).
- **Re-drive reuse** (#383) — after cutover, on the driver.
- **The predictive admission signal** (§5) — a follow-up ticket, not the cutover.
- **The client half** (#390) — sequenced with this spec, specified only where the two must
  not drift (§6, §8e).

## Trim review

**Author's Adds/Removes disclosure** (input to the reviewer, not a verdict — the author
does not grade their own design):

*Adds:* a fourth worker role (the wave author, §3) · a second signed artifact and the
intent-doc ↔ derived-plan seam (§6) · `plans/` and `judgment/` in the run dir, and six new
receipt fields (§4) · one script, the intent checker (§8a) · six ceiling numbers pinned by
tests (§6) · wave-boundary admission control (§5) · a new failure mode, *a plan can be
derived wrong* (canary 2 exists for it) · maintenance of a forked authoring skill (#390).

*Removes:* the Workflow-tool coupling entirely — `waves.js`, `waves.harness.json`,
`workflow-template.md`, `test_no_prompt_drift.py`, the bake ritual, the registry probe ·
eight scripts deleted against one added (13 → 6) · four more guards with licensing numbers: the #314 base-ancestry
guard (**#354 closes as moot**), the spend-cap supervisor, the #322 fitness preflight, the
three superpowers-compat scripts · the 500 k cap with `orchestrator.mjs:214–281`, the
`budgets` table and the `capTokens` plumbing · `readSessionTokens` and #209's transcript
coupling · verbatim implementation code from plans — the source of 6/6 defects in runs
18–23 · parks (3 → 0 in the observed record) · four prose↔code seams against one added.

**Reviewer's verdicts, and the `netConceptDelta` grade:** *pending — dispatched
2026-08-28.*

## Open, for the operator

1. **The six ceiling numbers in §6** are the spec's proposals, not decisions. The two that
   bind hardest are the authoring skill at ≤ 1,500 words and the combined line ceiling at
   ≤ 6,157 (the port may not grow the code).
2. **§5's disposition** — reactive `rate_limit_event` for the cutover, predictive
   `/api/oauth/usage` deferred. The alternative is provisioning a second credential class
   on the orchestrator now.
3. **§8b defers `claude plugin eval` to #390.** If it should gate the engine too, say so.
