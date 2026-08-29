# One Driver — the record: design inputs answered, review, decisions

**Companion to** `2026-08-28-one-driver.md`, which states the design. This file carries the
three things that are *records* rather than instructions, moved here so the spec can be read
in any order without tripping over its own history:

1. **§Design inputs** — the adopt-or-answer table that satisfies the consumption contract in
   `2026-08-28-one-driver-design-inputs.md` (*"a spec that skips a row is not plan-ready"*).
   Every deletion-ledger and harness-mechanics row, plus Amendments 1, 3, 4, 5, 6.
2. **§Trim review** — the adversarial review CLAUDE.md requires of every spec, with
   adopt-or-answer per finding and the `netConceptDelta` grade (given by the reviewer, never
   the author).
3. **§Decisions taken** — the seven operator decisions of 2026-08-28.

**None of this is a work order.** The design is the spec; the work is #400 → #401 → #402 →
#403. This is where you look to find out *why* something is the way it is, or to check that
a design input was answered rather than skipped.

*Corrections this document once carried inline — "a first draft said X, that was wrong" —
now live in `git log -p` on these two files, which records them better than prose can.*

---

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
`run_acceptance.sh`'s suite-gate half, `validate_skill.py`, the store (#308), `ultralearn`.

**Corrected from "kept verbatim": `report-format.md`.** §4 re-types two of its documented
fields — `judgmentCalls[]` (string array → objects, `:51`) and `acceptance` (object →
array, `:24`/`:77`). That is a contract change, and calling it "six new receipt fields"
concealed it. The four-kind taxonomy (`:86`) survives as the `kind` field; the schema and
`finalize_report.py`'s consumers move together, in the same PR.

**Changed from kept:** `readSessionTokens` + the spend cap (deleted, §8d); the store's
`budgets` table (deleted, §8d).

**`waves.js`'s own budget object — a ledger row this spec adds, with its number.** Not in
the frozen ledger, not in "kept verbatim", and distinct from `orchestrator.mjs`'s spend
supervisor: `budgetExhausted()` (`waves.js:1838–1842`) reads the **Workflow runtime's
`budget` global** (`:14`), and eight checkpoints defer work against it — `:1557` (conflict
resolution), `:1776` (each reconciliation attempt), `:1847` (before setup), `:1956`,
`:1971`, `:2021`, `:2105`, `:2180` — pushing `BUDGET_DEFERRED_NOTE` (`:181`,
*"budget exhausted mid-run — remaining work deferred to unfinished"*) into `judgmentCalls`.

**Licensed by:** the `budget` global is the Workflow runtime's, so it dies with the tool —
there is no choice about the mechanism. **But the behaviour is not free to drop**, and §5
must carry it (see §5): those checkpoints fire **mid-wave**, including per 16-task chunk,
while §5's admission control is specified at wave boundaries only. A wave that runs out of
room at task 9 of 16 defers honestly today and would run to exhaustion under a
boundary-only design. §5 now specifies both.

**Deletions the cap removal cascades — claimed here so they are not rediscovered** (the
#386 pattern): `store.mjs:93–111`'s `opts.supervisor` / `supervisorExempt`, whose only
caller is the supervisor's revoke; `drive.mjs:634` `revokeAndPark` and `:638`
`destroySandbox` as **action handlers** (the sandbox is still destroyed at teardown — what
dies is the spend-triggered path).

**Script count:** 13 today → **6** (`compile_plan.py`, `gate_check.py`, `ultra_gate.py`,
`run_acceptance.sh`, `validate_skill.py`, + the new intent checker). Eight deleted, one
added. Bar is ≤ 10.

**Guards deleted, counted honestly for THIS release.** A first draft wrote *"11 in Phase 0 +
4 here — bar is ≥ 6"*, which double-counts: Phase 0 already cleared the map's ≥ 6 on its own
(11), and 4 < 6, so this release failed its own restated bar on its face. **Phase 0's 11 do
not count toward 0.3.0.** This release deletes **six**, each with its licensing number:

| # | guard | licensed by |
|---|---|---|
| 1 | the #314 base-ancestry guard (`startHead`/`baseCorrected`) + watch #354 | the driver cuts at BASE; the condition is inexpressible |
| 2 | the spend-cap supervisor (`orchestrator.mjs:214–281`) | never fired; peak 63%; post-hoc and destructive |
| 3 | the #322 dispatch-time fitness preflight | the intent checker refuses at authoring, free, before spend |
| 4 | the three superpowers-compat scripts (one guard, three files) | the engine never touches superpowers |
| 5 | `store.mjs:93–111` `supervisor`/`supervisorExempt` | orphaned by 2 — its only caller was the revoke |
| 6 | `drive.mjs:634/:638` `revokeAndPark`/`destroySandbox` **as action handlers** | orphaned by 2; teardown still destroys the sandbox |

Six, with numbers, without borrowing Phase 0's.

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

| *(Amendment 3, "the driver builds itself")* process supervisor — last `result` line, SIGTERM timeout | **adopted §4a** — absent from a first draft entirely; the trim review caught it. §4a carries the exit-class table, the last-`result`-line rule, and the per-role deadline |
| *(Amendment 3, same list)* three role flag-sets as data | **adopted §3, corrected to six rows** — Amendment 4 made the flag-sets four; the *role inventory* is seven in `waves.js`, three of which write to the integration worktree (`:232–235`). A four-row table could not express merge / reconcile / resolver |

**Amendment 3's packing rule:** **adopted §2 step 5, with the constant measured and
raised 4 → 8** (`evals/frontier/results/2026-08-28-wave-width.md`: on a real 8-vCPU
sandbox, wall-clock is flat to N=12 with 27/27 successes; CPU peak 66% at N=8 and 98% at
N=12, so 8 is the last width with margin). Amendment 3's 4 was the largest width ever run
plus one, measured on a box one eighth the size. One wave per sandbox,
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
| `**Commutes:**` moves to the derivation tier and stays | **adopted §2 step 4, §6** — declared by the wave author against the task's own signed `Files:` block. #242(c)'s retirement trigger has not fired; run-20 produced the first real `autoResolved: 1` |
| *"The #181 spend page stays as observation only, never an action"* | **adopted §5 item 0** — the `spend` table survives, `total_cost_usd` is recorded and never enforced against, and the page never acts. Absent from a first draft of §8; the trim review caught it |
| *"the question bank is drawn from the ultralearn ledger and the redirect corpus, never invented"* | **adopted §6** — the provenance rule is stated with the slot, not left to #390. §6 exists so #389 and #390 cannot drift, and a first draft let exactly that happen |
| Rule 7 — the intent doc's schema is ceilinged | **adopted §6**, with numbers proposed for adjudication |
| Canaries 1–3 | **adopted §9** |
| Bar, restated (6 rows) | **adopted §9** |

### 8e. Amendment 5 — "extends, does not fork" is lifted

**#390 ships INSIDE 0.3.0** (decided this sitting). A draft of this spec deferred it beside
the release; that was wrong, and the reason is a coupling rather than a preference: **the
driver consumes an intent document, and the only thing that produces one is #390.** An
engine released first would have a derived-plan pipeline whose input artifact has no
authoring tool — the front and back halves of one release disagreeing. The counter-argument
that carried the deferral was a license review of unknown length; **superpowers is MIT**
(© 2025 Jesse Vincent), which permits modify/merge/publish/sublicense with an attribution
notice, so that work is minutes and does not gate anything.

| row | disposition |
|---|---|
| One owned authoring skill (brainstorming + writing-plans + ultraplan collapse) | **adopted, in 0.3.0.** Schema in §6 so the two halves cannot drift; ceiling ≤ 1,500 words, release-refusing (§9) |
| Drop the seven practice skills, do not vendor | **adopted, in 0.3.0** — 10,054 words dropped as dependencies, none copied |
| mattpocock skills uncoupled | **adopted** — available to operator sessions, required by nothing in the pipeline |
| One precedence line in `hooks/session_start.sh` | **adopted, in 0.3.0** — see below |
| Word ceiling pinned by a test | **adopted §6, §9** — enforced in this release |
| Retire the three compat scripts | **adopted §8a** |
| Check the license before shipping derived prose | **adopted §10** — MIT; ship the copyright and permission notice with the derived prose. Not a gate |

**Superpowers stays installed on the operator's machine** (decided this sitting). Dropping
the *dependency* does not stop superpowers running: its `SessionStart` hook fires from the
user's own install, wrapped in `<EXTREMELY_IMPORTANT>`, with a routing table that names
`superpowers:brainstorming` by hand. Uninstalling would fix that and cost the operator
10,054 words of practice skills they use **outside** ultrapowers. So the residual is handled
by one precedence line in our existing hook, leaning on superpowers' own documented rule
(*"User instructions … take precedence over skills"*), declaring that the ultrapowers
authoring skill owns the plan-authoring pipeline. **No new mechanism.** If that measurably
fails in practice, *then* there is a case for something heavier — not before.
| CLAUDE.md's own standing rule (*"extends, does not fork"*) | **adopted §10 step 4** — the rule is already marked lifted in CLAUDE.md (PR #391); the **text is deleted** in the 0.3.0 release commit, alongside the engine-path deletions. A first draft assigned it to nobody |

### 8f. Amendment 6 — #382 measured

| row | disposition |
|---|---|
| Cross-process prefix sharing holds completely | **adopted §9** (cost row) |
| `-p` writes the 1 h breakpoint by default | **adopted** — no `subagentPromptCacheTtl` analogue is built |
| The 72.6% block is keyed on model + CLI version alone | **adopted §3 and §7 bullet 5** — per-role prompt files are free. A first draft marked this adopted against a §7 that contained no such pin; §7 now carries it explicitly |
| Wave-boundary gap costs nothing (6 min, 11 min → 100%) | **adopted §2 step 4** — the serial authoring pass is priced on its own tokens; no overlap of authoring with execution to protect a cache |
| Fix rounds `--resume`, 3.1× cheaper | **adopted §2 step 5, §8b** |
| Cost: cold wave of 3 avoids 72.6% of prefix write cost | **adopted §9** |
| The Workflow arm is not reconstructable | **answered:** the gate-parity row (§9) compares wave shape and gate verdict, not tokens, precisely because the old engine cannot report per-agent tokens. The cost row is measured on the **new** engine against the recorded run-13…23 ledger totals |
| Do not contort the design for B2 (shared `cwd`) | **adopted §3, and superseded in the driver's favour** — cache note §H measured `--exclude-dynamic-system-prompt-sections`, which raises cross-clone sharing 72.6% → **88.4%** and cuts per-worker prefix creation 58% while every worker keeps its own clone. Every worker carries the flag; the shared-`cwd` contortion stays rejected because it is no longer the only way to buy B2 |
| *(new, cache note §I)* TTL settings are below the golden's floor and unneeded | **answered:** `promptCacheTtl` / `subagentPromptCacheTtl` need 2.1.242+, the orchestrator runs 2.1.238, and the default is already the 1 h we want. What the driver owes is the **negative**: never set `FORCE_PROMPT_CACHING_5M=1`, never let `DISABLE_PROMPT_CACHING*` reach a worker's env. §7 bullet 5 |
| *(new, cache note §I)* Workers move from the 5-min bucket to the 1-h one | **adopted §9** — a workflow agent's requests fall outside the main-conversation TTL bucket (5 min by the docs, *including on a subscription*); making each worker a main conversation moves it to 1 h. A second, independent reason the driver's cache position beats the engine it replaces |

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

**Reviewer's verdicts.** One fresh-context reviewer, dispatched 2026-08-28 per
`skills/ultralearn/references/distilling-proposals.md` §Trim review, grounded in the spec,
#389, #366, the frozen inputs, the supporting measurements, and the code. It found real
defects — including one verifiably false cross-reference and one predicate that would have
halted nearly every run. A **second reviewer was spawned in error** (the first appeared idle
when it was working), stood down, and returned findings anyway; four were new and are
recorded below as **R2**. Both are credited. **Adopt-or-answer for every finding, rejections
visible:**

### Trims

| # | trim | disposition |
|---|---|---|
| 1 | narrow the wave author to waves ≥ 2 — at wave 1 `clones/integration` *is* BASE, so the author is a pure extra LLM hop | **ADOPTED** (§2 step 4). The reviewer is right that §3's own justification was false at wave 1. Takes the authoring pass off every single-wave run |
| 2 | delete the ≤ 900-word intent-doc ceiling; keep the slot count and the ≤ 8 cap | **ADOPTED** (§6). Rule 7's named target is `## Standing decisions`, which the other two close |
| 3 | merge `judgment/*.json` into the receipt; do not create the directory | **ADOPTED** (§4). The same argument that inlines `waves[].plan` applies |
| 4 | delete the "laptop resident footprint ≈ 0" bar row — it cannot come out any other way | **ADOPTED** (§9). Amendment 1 asked for it while a local facsimile substrate was live, then deleted that substrate. It restated the architecture instead of testing it |
| 5 | merge §7 bullets 1 and 2 — one rule stated twice | **ADOPTED** (§7) |
| 6 | §5's mechanism 3 does not survive the port: `budgetExhausted()` reads the Workflow runtime's `budget` global | **ADOPTED** (§5). Verified at `waves.js:14, 1838–1842`. What carries over is `attempt <= 2` per-unit caps, not a run terminator, and §5 now says so |
| 7 | stop counting Phase 0's 11 guards toward this release's bar — and 4 < "≥ 6" fails on its face | **ADOPTED** (§8a, §9). Six named for this release, each with its number, none borrowed |
| 8 | claim the deletions the spend-cap removal cascades (`store.mjs:93–111`, `drive.mjs:634/:638`) | **ADOPTED** (§8a, §5 item 0). Also supplies two of the six in trim 7 |
| 9 | drop the ≤ 1,500-word authoring-skill row from *this* release's refusing bar | **ADOPTED** (§9, §11). A number enforced in #390 must not refuse 0.3.0; it stays stated so the two cannot drift |

### Under-specification

| # | finding | disposition |
|---|---|---|
| 1 | §5's `rate_limit_event` predicate is contradicted by its own citation — R-o8 saw one in a 21 s width-1 test at 9% utilization; as written it halts every run at wave 1 | **ADOPTED, section rewritten** (§5). The reviewer is also right that no such event type is documented: it is `system`/`api_retry` with `error: "rate_limit"`. Now a two-clause predicate (retry *exhaustion*, or a rate-plus-delay threshold set from the first three runs), with an explicit fallback to observation-only if no threshold separates ordinary retries from pressure |
| 2 | §3's four-row table cannot express merge / reconcile / resolver, which write to the integration worktree | **ADOPTED** (§3). Verified at `waves.js:232–235` and the dispatch sites. Table is five rows covering all seven roles, grouped by writable root |
| 3 | the ported critic loses `git checkout --detach`, which releases the branch `ultra_gate.py --approve` needs | **ADOPTED** (§3). Verified at `waves.js:373–376` and `:619–630`. This one weakened a receipt, which rule 1 forbids — the best catch in the review |
| 4 | `--add-dir` is unexercised; the Bash-write predicate is unspecifiable; `git diff --output=` is an open escape | **ADOPTED with a named limit** (§3). `--add-dir` becomes a build-blocking repro. The Bash denial is a closed denylist of write-capable git forms, not a general predicate — stated as a narrowing, with the hook as boundary and the sandbox as backstop |
| 5 | wave shape is compiled from `Files:` the intent doc does not carry | **ADOPTED** (§6). `Files:` is signed; the wave author may only *narrow* it. Resolves the contradiction with keeping `compile_plan.py` verbatim |
| 6 | per-task `tier` has no source — a spend authority granted by omission | **ADOPTED** (§6). `tier` is signed |
| 7 | §5 removes destructive authority without saying what remains | **ADOPTED** (§5 item 0) |
| 8 | the store's new rows are adopted and never specified | **PARTLY ANSWERED.** §4/§5 now name what they hold (`admission[]` with counts; judgment calls). The row *shapes* and their legal transitions against `store.mjs:30–39` are **deferred to the plan** — schema work the spec should not invent ahead of the port |
| 9 | §4's receipt collides with `report-format.md`: two of "six new fields" are re-types | **ADOPTED** (§4, §8a). `report-format.md` moves out of "kept verbatim" and the change is disclosed as four additions plus two re-types |
| 10 | the process supervisor is unspecified | **ADOPTED — new §4a**, carrying the exit-class table, the last-`result`-line rule, and per-role deadlines |
| 11 | surviving park classes are never enumerated | **ANSWERED, deliberately not enumerated here.** Amendment 4 fixes them (irreversible/destructive, credentials/security, admission refusal) and §9 sets the *observed* rate to 0 — a prediction about the corpus, not a claim that parks are impossible. §2 step 9 keeps the draft-PR path because the classes still exist |
| 12 | gate parity's venue is unstated and `ab_runner` is local-by-design, dead under Amendment 1 | **ADOPTED** (§9 caveat 2). Verified against the Phase 0 spec's row 7, which deferred re-arming to this port. Now in-scope build work for 0.3.0 |
| 13 | the parity intent docs are back-formed from the answer | **ADOPTED as a stated limit** (§9 caveat 1). Cannot be fully cured — recorded as a necessary, not sufficient, condition, with the mitigation named |

### Scope expansions

| # | expansion | disposition |
|---|---|---|
| 1 | six ceilings where #389 asked for three | **PARTLY ADOPTED** — now five, and one (the authoring skill) is #390's to enforce. Rule 7 explicitly asks for a slot count *and* a standing-decisions cap, so two of the three are its own text |
| 2 | the combined-line ceiling permits +2,354 lines of driver growth and excludes what the port creates | **ADOPTED, and the ceiling is now DELETED entirely** (§6). Both reviewers were right and a third attempt would have been wrong too: the operator dropped the line ceiling this sitting, amending #366 rule 5. Rule 5's intent carries in the prose ceilings, scripts ≤ 10, guards ≥ 6, and §7's guard-deletion rule — which names accreted guards precisely, where a line count cannot tell a guard from a well-factored function |
| 3 | the wave author gains scheduling and spend authority by omission | **ADOPTED** (§6) — `Files:` and `tier` signed; the author may only narrow |
| 4 | the run-directory layout as a specified artifact | **ANSWERED, kept.** The handoff named "where the derived plan lives and how the receipt carries it" as a question the spec must settle; a layout is the answer. `judgment/` is deleted (trim 3) and `roles/` added, which is the port's own surface |
| 5 | `admission[]` and `standingDecisions[]` beyond Amendment 4's four | **ADOPTED as disclosure** (§4) — six changes, four additions and two re-types, stated as such |
| 6 | deferring `claude plugin eval` to #390 | **ANSWERED** — it tests the client's skills; it is Open question 3 for the operator |
| 7 | canary 2's taxonomy is load-bearing with no stated classifier | **ADOPTED** (§9) — the reviewer that raises the round classifies it, ties go to *contract* so the canary cannot flatter itself |

### R2 — the second reviewer's independent findings

| # | finding | disposition |
|---|---|---|
| R2-1 | **`waves.js`'s own budget object is undispositioned in §8** — `budgetExhausted()` (`:1838`), `BUDGET_DEFERRED_NOTE` (`:181`), and **eight** deferral checkpoints, distinct from `orchestrator.mjs`'s supervisor | **ADOPTED — new ledger row in §8a, and §5 changed.** The sharper half is behavioural: those checkpoints fire **mid-wave**, including per 16-task chunk, while §5 was specified at wave boundaries only. A wave running out of room at task 9 of 16 defers honestly today and would have run to exhaustion under the spec as written. §5 now specifies both granularities |
| R2-2 | **§5 deletes the only out-of-band VM reclamation.** `actions.destroySandbox` reaches the orchestrator's action surface at exactly one site — `orchestrator.mjs:281`, inside the deleted spend pass; every other destroy is `drive.mjs`'s teardown, **inside the drive process** | **ADOPTED — §5 item 0 rewritten.** A killed or crashed drive would have left a billed VM alive forever. Replaced by a **claim-lease reaper** over rows that already exist (claims have holders; `orchestrator.mjs:301` has the heartbeat). Deliberately a *liveness* trigger: the right reason to destroy a VM is "nothing is using it", never "it spent too much" |
| R2-3 | **The line ceiling is already stale and, as written, already violated.** `fleet/*.mjs` is **3,818** on main (PR #393 added 15 this sitting), and `fleet/**` — the glob the spec actually wrote — is **4,476**, above the ≤ 4,400 bar | **ADOPTED, and it ended the ceiling.** The finding that a bar failed on the day it was written is what prompted the operator to drop the line ceiling outright rather than let a third draft try again (§6). The two failed drafts are kept in §6 as the argument |
| R2-4 | **The wave author's "may not add or remove tasks" has no enforcement** — `--json-schema` validates shape, not identity against `intent.sha` | **ADOPTED** (§2 step 4). The driver diffs the derived plan against the signed set by identity: equal id sets, byte-identical edges / `Interfaces` / `tier` / acceptance statements, `Files:` a subset. A mismatch is a failed derivation, retried once with the diff quoted, then parked. This is why `intent.sha` is in the receipt |

**Rejected: none, from either reviewer.** Every finding was adopted, adopted with a named
limit, or answered; two (under-spec 8, 11) are answered rather than implemented, with the
reason given.

### `netConceptDelta`, graded by the reviewer: **`flat`**

The reviewer's justification, which the author accepts: the code removals are real and large,
and removing verbatim implementation bodies deletes a defect class rather than guarding it —
but the *standing-concept* ledger is not the code ledger, and what a reader must newly hold
(intent doc, standing decisions and their consumption protocol, judgment calls as objects,
the derived plan as a second artifact with its own failure mode, the wave author, admission
control, the ceilings, the canaries and the cause taxonomy) offsets it. Two things keep it
from `down`: the largest single concept deletion — collapsing three authoring skills into one
and dropping seven — is **deferred to #390**, so this spec spends the additions now and books
the subtraction elsewhere; and five of the ten deletion-ledger rows already shipped in
Phase 0. **The author's Adds/Removes disclosure above implies `down` and the reviewer is
right that it does not earn it.** The disclosure is left unedited, as the record of what the
author claimed before the grade.

## Decisions taken (operator, 2026-08-28 — this spec is now plan-ready)

Seven, in the order they were put. Each changed the spec; none is left open.

| # | decision | effect |
|---|---|---|
| 1 | **No line ceiling on code.** Rule 5's intent carries in the prose ceilings, scripts ≤ 10, guards ≥ 6, and §7's guard-deletion rule | §6, §7, §9. **Amends #366 rule 5** — mirrored into the design-inputs file the same sitting |
| 2 | **Admission control ships as observation only in 0.3.0**; the gate is built in 0.3.1 from the data 0.3.0 collects | §5, §11. The claim-lease VM reaper ships regardless — that is a leak fix, not a policy choice |
| 3 | **`claude plugin eval` gates the client only** | §11, §8b |
| 4 | **#390 ships inside 0.3.0** *(author's call, delegated)* — the driver consumes an intent doc and only #390 produces one | §8e, §10, §11 |
| 5 | **The authoring skill's ≤ 1,500-word ceiling is a release-refusing bar**, raisable only by stating the new number and its reason in the release commit body | §6, §9 |
| 6 | **Superpowers stays installed**; one precedence line in `hooks/session_start.sh` declares which skill owns the pipeline | §8e |
| 7 | **`ultradocket`'s sweep is reworked inside 0.3.0** — *against the recommendation to defer it*, so no tool anywhere still emits the old artifact | §10 |

Two of these went against the author's recommendation and are recorded as such: **7** (the
release grows to stay coherent) and, in a different direction, **1** (the author proposed a
ceiling twice and both drafts were defective — the operator removed the mechanism rather
than accept a third attempt).

**Still owed before the plan, and named so they are not assumed** (§3, §9, §10):

- ~~`--add-dir` is unexercised~~ — **DISCHARGED 2026-08-28** (parity R-w1/w2/w3): the
  wave-author flag-set holds under a hostile prompt; no cwd inversion needed.
- `ab_runner` must be re-armed on the driver before gate parity can be reported.
- The claim-lease reaper lands in the same PR as the cap deletion, never after.
