# Docket

### #96: Gate derives its inputs from the receipt: suite-gate bootstrap + mechanical tests.command
**State:** verified
**Score:** 9.5 — integration-correctness (Q-priority 1) at the merge boundary itself; distill headliner
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/reviewer-prompts.md, skills/ultrapowers/scripts/run_acceptance.sh, skills/ultrapowers/scripts/ultra_gate.py, evals/, docs/superpowers/specs/2026-07-27-gate-derives-inputs.md
**Plan:** docs/superpowers/plans/2026-07-27-gate-derives-inputs.md
**Engine:** ultrapowers
**Notes:** One structural change deletes three ledger clusters (suite-gate bootstrap false-red ×7 runs, LLM-edited gate inputs ×10 runs, critic prose in tests.command ×2) — after it, no agent has a legitimate reason to edit a gate input. NOT directly drainable: spec STUB exists at docs/superpowers/specs/2026-07-27-gate-derives-inputs.md and needs brainstorm → full spec before planning. Two halves: engine half (waves.js stamps tests.command mechanically, critic narrative → tests.output; prompt re-bake + .mjs sim sentinel required) is normal suite work; periphery half (run_acceptance.sh/ultra_gate.py consume receipt.bootstrapCmd) is FROZEN and unfreezes only via the eval route the stub names — JS-fixture cell reproducing the false-BLOCKED, mechanical counter 1→0, no other counter regressing. Supersedes #94 (closed at triage), absorbs #91 item 1; plan together with #91 item 7 (edit-disclosure containment for the hazard this removes).

### #98: ultralearn harvester: capture the FINAL gate receipt per stamp, tag eval-cell runs as synthetic
**State:** verified
**Score:** 8 — protects the measurement loop every distill (and the frozen-periphery unfreeze route) trusts
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, skills/ultralearn/scripts/merge_ledger.py, tests/test_harvest_runs.py, tests/test_merge_ledger.py
**Plan:** docs/superpowers/plans/2026-07-27-harvester-gate-evidence.md
**Engine:** inline
**Notes:** Two measurement-integrity defects: stale gate evidence (23-run family — bundles store the first BLOCKED receipt for runs that actually recovered and merged, miscounting false-reds as terminal) and synthetic contamination (6 of 21 "field" bundles this pass were A/B eval cells flowing into the redirect-canary/clean-pass statistics). Fix: last-receipt-per-stamp with ordinal + truncated flag; origin: synthetic for eval-cell-convention paths. Not the frozen periphery. Ranked above the driver cosmetics because bad sensing corrupts every future triage.

### #97: Receipt stage details must state the stage's own verdict
**State:** verified
**Score:** 7.5 — single most frequent ledger finding (14/118 runs, every version 0.0.35→0.1.11); receipt honesty of a fail-closed driver
**Est-files:** skills/ultrapowers/scripts/ultra_run.py, tests/test_ultra_run.py
**Plan:** docs/superpowers/plans/2026-07-27-receipt-stage-verdicts.md
**Engine:** inline
**Notes:** git-repo stage reports ok:true with "not inside a git repository" detail; worktree-probe detail is raw porcelain; one compile detail was a 2KB raw-JSON dump. One emission-point change in ultra_run.py's stage() path: detail states the stage's own conclusion, probe stdout/stderr attach only on failure. Pin with a test asserting no ok:true stage carries known failure phrasings. Small structural driver fix, not the frozen periphery; good early drain candidate.

### #100: Derive baseBranch from the launched checkout, not the repo default branch
**State:** verified
**Score:** 7.5 — integration built on a stale base is an integration-correctness defect (4 runs, one sev 3 @0.1.11)
**Est-files:** skills/ultrapowers/scripts/ultra_run.py, tests/test_ultra_run.py, skills/ultrapowers/SKILL.md
**Plan:** docs/superpowers/plans/2026-07-27-basebranch-launched-checkout.md
**Engine:** inline
**Notes:** Observed: session on a feature branch 2 ahead (containing the plan itself), driver derived baseBranch=main → plan unreachable from integration HEAD, merge-back conflicted. Derive-don't-assume: base = branch the operator launched from (rev-parse at preflight), fall back to repo default only on detached HEAD with a loud receipt note. Self-hosted runs on this repo launch from main and are unaffected. Small driver fix, not the frozen periphery; good early drain candidate. Family relative of #84 (session-checkout coupling).

### #99: --validate-knobs must probe bootstrapCmd in a throwaway worktree
**State:** verified
**Score:** 7 — engine-mutates-operator-environment family (with the 0.0.35 snapshot-restore data destruction); recurrence bar met at family level
**Est-files:** skills/ultrapowers/scripts/ultra_run.py, tests/test_ultra_run.py
**Plan:** docs/superpowers/plans/2026-07-27-validate-knobs-worktree-probe.md
**Engine:** inline
**Notes:** Observed @0.1.1: a wrong bootstrapCmd draft executed against the live session env stripped the test runner from the operator's venv; the agent restoring it unprompted is not a design. Relocate the probe to a disposable worktree, judge no-op-ness by resulting tree state. Design caveat to carry into the plan: name which side effects the worktree boundary does NOT contain (shared global package caches). Small driver fix, not the frozen periphery; good early drain candidate.

### #95: Loose ends from the #90 build — drainable items 1–4 ONLY (split at triage)
**State:** verified
**Score:** 6.5 — hardening gaps flagged by the #90 build's own reviewers; all cheap; guard-integrity items keep the suite honest
**Est-files:** skills/ultrapowers/scripts/compile_plan.py, tests/test_compile_plan.py, tests/sim_workflow.mjs (or the scratch sim), skills/ultrapowers/SKILL.md
**Plan:** docs/superpowers/plans/2026-07-27-90-loose-ends.md
**Engine:** ultrapowers
**Notes:** SPLIT at triage per the issue's own structure. Drainable: (1) --check argparse help understates the --run-dir exclusion, (2) prune honest-receipt failure branch untested (seed an undeletable dir; assert failed name absent from return, named in scratch-hygiene detail), (3) sim engineAuthoredSpan guard blind spot — derive the span by subtracting plan-authored blocks, not truncating at first marker (harness-sim change: pass sentinel discipline applies), (4) SKILL.md Salvage/Redirect bullets must say relaunch args = spread the receipt's argsFile (mandatory pluginRoot/runDir). NOT drainable: the three live-run verification checkboxes — they close only by observing the first real /ultrapowers run after 0.1.12 re-resolves (/plugin + new session); keep the issue open for those after items 1–4 land. || CLEAR-OUT 2026-08-20: live-run checkboxes verified (84intwt review/ exhaust; 20260819-175527 exhaust deletion + redirect-args pluginRoot/runDir); issue CLOSED.

### #91: Field hardening from the 2026-07-07 distill — remainder after #96 absorption
**State:** verified
**Score:** 6 — real field defects but a mixed bundle; item 1 gone to #96, item 4 touches a frozen surface
**Est-files:** skills/ultralearn/scripts/merge_ledger.py, skills/ultrapowers/scripts/compile_plan.py, skills/ultrapowers/SKILL.md, skills/ultrapowers/references/finishing-notes.md, tests/
**Plan:** docs/superpowers/plans/2026-07-27-field-hardening-remainder.md
**Engine:** ultrapowers
**Notes:** Item 1 ABSORBED by #96 (noted on the issue) — do not build here. Verified today: item 2 (merge_ledger bundle_lookups expanduser) still unfixed in main — one-line fix + tilde test. Item 3: compile_plan skips Files parsing/conflict emission for non-waved dispositions (needs a small ordering refactor). Items 5–6 prose (deferredVerification union at resume gates; shipped-SHA≠gate-SHA ⇒ mandatory re-run). Item 4 (seal-author brief) is FROZEN — park that piece unless the eval route is taken; do not let a drain touch skills/ultraplan/references/seal-author-prompt.md. Item 7 (edit-disclosure containment) plans WITH #96. Suggest scoping the plan to items 2+3+5+6 explicitly.

### #101: Retire the tierOverrides channel (deletion candidate)
**State:** verified
**Score:** 5.5 — simplicity objective; warned-against ballast (~60 lines + 2 sims + 4 doc surfaces + 1 baked-prompt clause); zero observed use in 118 runs
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/reviewer-prompts.md, skills/ultrapowers/SKILL.md, skills/ultrapowers/references/workflow-template.md, skills/ultrapowers/references/dependency-analysis.md, tests/sim_workflow.mjs, tests/test_no_prompt_drift.py
**Plan:** docs/superpowers/plans/2026-07-27-retire-tieroverrides.md
**Engine:** inline
**Notes:** Per subtraction-eval doctrine: delete behind the measurement gate — mechanics hard-gated via harness sims (replace the two tierOverrides scenarios with a sim proving unknown top-level arg keys are handled coherently) + suite; no A/B quality cell needed (no user-exercised behavior changes). Two invariants must survive: reviewer pinned to most-capable becomes unconditional (baked prompt sentence edited at source + re-baked, drift pin green), and per-task tier correctness via inline wave-entry tiers (the #89 single channel) is untouched. Kill condition: any real workflow that passes tierOverrides — none known.

### #84: Structural: the run never mutates the operator's checkout (integration in a dedicated worktree)
**State:** verified
**Score:** 5 — deletes the snapshot/restore/stash concept family; strong alignment (autonomy + path hygiene) but the largest blast radius on this slate
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/scripts/ultra_run.py, skills/ultrapowers/scripts/run_lock.sh, skills/ultrapowers/SKILL.md, tests/
**Plan:** docs/superpowers/plans/2026-07-27-integration-worktree.md
**Engine:** ultrapowers
**Notes:** The remaining member of the session-checkout-coupling class after #90 (scratch, shipped 0.1.12) and #100 (baseBranch). CAUTION: the issue text proposes "gate_check inspects the integration worktree" — gate_check.py is FROZEN; the plan must either leave gate scripts byte-identical (point them at the worktree via existing arguments) or take the eval route. Feasibility checks the issue names (A2 non-isolated reviewers stay non-isolated; finishing-branch Approve = the single sanctioned checkout mutation) belong in the brainstorm. Recommend sequencing AFTER #100/#99 land — they shrink and sharpen this class. Needs brainstorm → spec; not a drain-sized item.

### #86: Structural: the spec pins one durable contract surface; sealed exams bind only to pins
**State:** parked
**Score:** 3 — recommend PARK: exam-side binds to the FROZEN seal-author brief, and sealed is opt-in since 0.1.0 so incidence is near zero
**Est-files:** skills/ultraplan/SKILL.md, skills/ultraplan/references/seal-author-prompt.md
**Notes:** parked at gate 2026-07-27: frozen seal-author brief + sealed opt-in since 0.1.0, near-zero incidence; revisit on fresh sealed-run evidence — All cited evidence (false-red clusters from guessed module paths) predates 0.1.0's demotion of sealed to opt-in; current traffic is ~100% suite disposition, where this defect class cannot occur. The exam-side half requires editing the frozen seal-author brief — only an evals/ab_runner.py-measured regression unfreezes it, and no sealed-run evidence has accrued since. Park until a real sealed-plan cycle produces fresh evidence; the spec-side half (ultraplan pin rule) could proceed alone but has little value without the exam-side binding. || RE-TRIAGED 2026-08-14: sealed remains opt-in with near-zero incidence; no new exam-coupling instances in the 17-run sense pass. Stays parked. || CLEAR-OUT 2026-08-20: issue CLOSED as not-planned on GitHub; park record + reopen trigger unchanged.

### #87: Review-depth heuristic deletion — VERIFY & CLOSE, do not plan
**State:** parked
**Score:** 1 — verify-and-close, shipped in 0.0.32; no build
**Est-files:** (none — no build)
**Notes:** issue CLOSED as already-shipped (0.0.32); verify-and-close, never a drain entry — Verified in main today: RISK_PATH/isRiskSurface survive only as a historical comment (waves.js:652, "the heuristic era"); the plan-authored **Review:** marker (adversarial|lean) is live in references/plan-markers.md. Both halves of the issue's proposed shape are shipped and released (0.0.32, 2026-07-03 review-depth+grammar cycle). Close on GitHub with the evidence; nothing remains to build.

### #85: Narrow the plan grammar — VERIFY & CLOSE, do not plan
**State:** parked
**Score:** 1 — verify-and-close, shipped in 0.0.32; no build
**Est-files:** (none — no build)
**Notes:** issue CLOSED as already-shipped (0.0.32); verify-and-close, never a drain entry — Verified in main today: compile_plan.py carries the --check authoring-time collecting mode with #85 cited in its own comments (lines 221, 749); the 0.0.32 release ("symbol-shaped tokenizer + validator deletion") was this issue's build. Close on GitHub with the evidence. If any individual tolerance branch the issue lists is later found still live, file it as its own small issue rather than reopening this umbrella.

### #74: Durable triage-rationale field — VERIFY & CLOSE, do not plan
**State:** parked
**Score:** 1 — verify-and-close, shipped in 0.0.29 (PR #83); no build
**Est-files:** (none — no build)
**Notes:** issue CLOSED as already-shipped (0.0.29, PR #83); verify-and-close, never a drain entry — Verified in main today: docket_lib.py parses, serializes, and round-trips **Notes:** (dataclass field, _FIELD regex, serializer), and the ultradocket skill doc both mandates recording rationale in Notes and carries the no-guess-disposition guard the issue's part 2 asked for. This very triage pass is exercising the feature. Close on GitHub with the evidence.

### #70: engine: assert every mergeable task landed in the integration ancestry (close silent done-task drop)
**State:** verified
**Score:** 9 — integration-correctness (top theme); cryptographic post-merge ancestry assertion; low-risk; suite-disposition
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/wave-merge.md, tests/test_no_prompt_drift.py
**Plan:** docs/superpowers/plans/2026-07-01-integration-ancestry-assertion.md
**Engine:** ultrapowers

### #69: engine: cross-phase integration review before the final PR
**State:** verified
**Score:** 8 — integration-correctness; finishing-handoff review for multi-phase seams; med-risk (dense finishing path); suite-disposition
**Est-files:** skills/ultrapowers/SKILL.md, skills/ultrapowers/references/finishing-notes.md, skills/ultrapowers/references/report-format.md
**Plan:** docs/superpowers/plans/2026-07-01-cross-phase-integration-review.md
**Engine:** inline

### #64: Harvester extractors mis-parse doc-dense / self-referential sessions
**State:** parked
**Score:** 8 — integration-correctness; BUT core fix appears already landed in main (4b9ef85+3736ea8) — verify and close, do not plan; suite-disposition
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, tests/test_harvest_runs.py
**Notes:** issue CLOSED as already-fixed (4b9ef85+3736ea8); verify-and-close, never built — not a drain entry

### #68: run_lock.sh restore landed on the wrong branch in a multi-run session — add a post-restore guard
**State:** verified
**Score:** 7 — integration-correctness; deterministic post-restore HEAD guard; non-reproducible so hard to validate; suite-disposition
**Est-files:** skills/ultrapowers/scripts/run_lock.sh, tests/test_run_lock.py
**Plan:** docs/superpowers/plans/2026-07-01-run-lock-restore-guard.md
**Engine:** inline

### #71: ultraplan: declare test-only dependencies as explicit Depends-on
**State:** verified
**Score:** 7 — authoring-robustness; doc-only guidance across two mirrors plus drift pins; low-risk; suite-disposition
**Est-files:** skills/ultrapowers/references/plan-markers.md, skills/ultraplan/SKILL.md, tests/test_recommendation_rubric.py
**Plan:** docs/superpowers/plans/2026-07-01-test-import-depends-on.md
**Engine:** inline

### #65: ultraplan: harden compile_plan.py Files-parser + make description-edge guidance load-bearing
**State:** verified
**Score:** 7 — authoring-robustness; partly landed already (9b9f191+8f5b5ad) so re-scope to the remainder; needs compiler-internals expertise; suite-disposition
**Est-files:** skills/ultraplan/SKILL.md, skills/ultrapowers/references/plan-markers.md, skills/ultrapowers/scripts/compile_plan.py
**Plan:** docs/superpowers/plans/2026-07-01-ultraplan-compile-plan-hardening.md
**Engine:** subagent-driven

### #67: Relocate ultrapowers scratch out of .git/ (protected-path root)
**State:** verified
**Score:** 7 — path-hygiene (Q-priority 3); move review packets off .git/ultra; low-risk; self-contained; suite-disposition
**Est-files:** skills/ultrapowers/scripts/review-package.sh, skills/ultrapowers/harnesses/waves.js, tests/test_review_package.py
**Plan:** docs/superpowers/plans/2026-07-01-relocate-scratch-out-of-git.md
**Engine:** inline

### #114: Structural: derive recorded task-head SHAs from git output — never LLM-transcribed
**State:** verified
**Score:** 9 — integration correctness (Q-priority 1) at the merge boundary; a fabricated SHA silently defeats the ancestry safety net
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/wave-merge.md, tests/
**Plan:** docs/superpowers/plans/2026-08-06-derived-task-heads.md
**Engine:** ultrapowers
**Notes:** Distill 2026-08-06: 11 findings/9 runs, two fresh at 0.1.13/0.1.14 — recorded 40-char task heads with a valid 7-char prefix and fabricated tail (merge/report agent hand-transcribes SHAs). Derive-don't-record: harness stamps heads from git rev-parse output mechanically. Harness JS change → .mjs sim + pass sentinel required; prompt source edits per anti-drift rule. Does NOT touch the frozen gate (the optional rev-parse-verify-on-read follow-up is explicitly out of scope).

### #113: ultralearn: session-scoped receipt attribution — match receipts/terminus/audit to the session that launched them
**State:** verified
**Score:** 8.5 — protects the measurement loop every distill and every frozen-periphery unfreeze route trusts; completes #98 at multi-launch/drain scale
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, tests/test_harvest_runs.py
**Plan:** docs/superpowers/plans/2026-08-06-harvester-session-attribution.md
**Engine:** subagent-driven
**Notes:** Distill 2026-08-06: largest ledger family (59 findings/50 runs), fresh sev-2s AT 0.1.13 post-#98: approved run bundled as BLOCKED; 9-plan drain bundled as single-plan NEEDS_ACK with a receipt stamped 4 days later; audit covers launch 1 of 5; slice tails contaminated. Fix: match receipts to wf run IDs/stamps the session launched, union audit across launches, terminus from matched receipt + transcript approval evidence, multi-plan bundle shape, slice trimmed to run envelope. PLAN TOGETHER WITH #118 (deletes the disk-fallback sweep this replaces).

### #112: Structural: plan-defect judgmentCall lane — disclosed fixes of plan-transcribed defects instead of gate redirects
**State:** verified
**Score:** 8.5 — autonomy + token efficiency: the dominant redirect generator (25 findings/19 runs); redirect rounds are the main post-launch cost
**Est-files:** skills/ultrapowers/references/reviewer-prompts.md, skills/ultrapowers/harnesses/waves.js, skills/ultraplan/SKILL.md, skills/ultrapowers/references/plan-markers.md, skills/ultrapowers/references/report-format.md
**Plan:** docs/superpowers/plans/2026-08-06-plan-defect-lane.md
**Engine:** ultrapowers
**Notes:** Distill 2026-08-06 headliner. Extends the proven judgmentCalls channel: implementer/reviewer may fix plan-verbatim defects with a mandatory disclosed plan-defect judgmentCall; reviewer verifies; gate report lists plan-divergence calls in one section; plan-defect becomes a first-class note type so the canary can split plan-authored from implementer defects. canaryMetric: redirect-round rate + gate-routed plan-defect count. Carries a prose RIDER: ultraplan authoring line — agent-CLI spikes must isolate CLAUDE_CONFIG_DIR (sev-3 false-memory contamination, first occurrence → prose only). Prompt re-bake + pin tests apply.

### #115: Sanction the micro-redirect lane: narrow-resume pattern, deterministic relaunch-args helper, head-match re-baseline
**State:** verified
**Score:** 8 — token efficiency + audit-chain honesty: 22 findings/14 runs; head-match validated live but approved runs fossilize as BLOCKED receipts
**Est-files:** skills/ultrapowers/SKILL.md, skills/ultrapowers/references/wave-merge.md, skills/ultrapowers/scripts/, skills/ultrapowers/scripts/gate_check.py, tests/
**Plan:** docs/superpowers/plans/2026-08-06-micro-redirect-lane.md
**Engine:** inline
**Notes:** Distill 2026-08-06. Three parts: (1) document narrow-files+drop-tier resume as the sanctioned micro-redirect (field-proven by hand), (2) deterministic helper: prior receipt + findings list → relaunch args (removes fumble-prone LLM file surgery), (3) operator-authorized inline commits re-baseline head-match with attribution instead of leaving stale BLOCKED receipts. CAUTION: gate_check.py is frozen periphery — scope the re-baseline as recording attribution, never weakening the check; if that can't be done cleanly, split part 3 out at planning. canaryMetric: redirect-round rate + BLOCKED-receipts-on-approved-runs (should hit 0).

### #107: eval kit: prepare_engine's marketplace registration clobbers the operator's real 'ultrapowers' marketplace
**State:** verified
**Score:** 7.5 — engine-mutates-operator-environment family (same family as #99, scored 7); sev-3 live incident, predicted verbatim by the run's own deferred ack
**Est-files:** evals/ab_runner.py, tests/
**Plan:** docs/superpowers/plans/2026-08-06-eval-config-isolation.md
**Engine:** inline
**Notes:** Filed 2026-07-28 from the live /plugin breakage; distill 2026-08-06 appended: the #96 run's deferredVerification named the exact side effect pre-release and nothing acted on it. Fix: eval cells get the same isolation discipline as the engine (namespaced/temp marketplace name or isolated CLAUDE_CONFIG_DIR, never the production manifest name). Consider the general lesson at planning: deferred acks naming operator-environment mutation should trigger pre-release mitigation.

### #116: Preflight baseline check: smoke-run the stamped testCmd in the validate-knobs worktree before launch
**State:** verified
**Score:** 7.5 — the cycle's ONE budgeted additive guard (9 findings/9 runs): moves the red-baseline decision to the operator pre-launch
**Est-files:** skills/ultrapowers/scripts/ultra_run.py, tests/test_ultra_run.py, skills/ultrapowers/SKILL.md
**Plan:** docs/superpowers/plans/2026-08-06-preflight-baseline-check.md
**Engine:** inline
**Notes:** Distill 2026-08-06. Reuses the --validate-knobs throwaway worktree: run the stamped testCmd once pre-launch; red baseline → explicit operator decision (fix drift / accept named off-plan repair / launch anyway with reds recorded inherited); also catches crashing auto-detected testCmds inside preflight (subsumes the segfault-teardown case). Field evidence: reconcile agent committed into a plan-protected path mid-run because baseline was red; gate had to manually exonerate a pre-existing flake. Receipt gains a baseline verdict field.

### #117: Gate false-red: canonicalize the acceptance worktree path (macOS /var symlink)
**State:** verified
**Score:** 7 — gate-manufactured deterministic false-red (sev 3, A/B-proven in field); FROZEN periphery with the unfreeze route named
**Est-files:** skills/ultrapowers/scripts/run_acceptance.sh, tests/, evals/
**Plan:** docs/superpowers/plans/2026-08-06-gate-integrity-pair.md
**Engine:** ultrapowers
**Notes:** Distill 2026-08-06: mktemp on macOS returns /var→/private/var symlinked paths; path-identity-sensitive toolchains (native tsc) see duplicate modules → 3 identical BLOCKEDs on an untouched file; same commit green on canonical path. Fix: pwd -P canonicalization at BOTH mktemp call sites. Unfreeze route per #96 precedent: eval/test fixture reproducing false-BLOCKED on a symlinked path, counter 1→0. PLAN TOGETHER WITH #105 (same file, same unfreeze ceremony — false-red + false-green pair).

### #105: Empty-command guards are truthiness/-z based: whitespace-only testCmd still buys a false green
**State:** verified
**Score:** 6.5 — a false GREEN at the gate outranks its size; proven by execution during the 2026-07-27 drain; small, both sides of the frozen boundary
**Est-files:** skills/ultrapowers/scripts/ultra_run.py, skills/ultrapowers/scripts/run_acceptance.sh, tests/
**Plan:** docs/superpowers/plans/2026-08-06-gate-integrity-pair.md
**Engine:** ultrapowers
**Notes:** Filed by the drain's own critic (executed repro: --suite-gate --run '   ' → passed:true). ultra_run.py side (truthiness knob-drop) is unfrozen; run_acceptance.sh side is FROZEN — ride #117's eval-fixture unfreeze ceremony. Normalize/strip then validate non-empty; empty-after-strip refuses loudly on both sides. PLAN TOGETHER WITH #117.

### #103: #84 hardening follow-ups: pin the sweep instruction, test the detach↔approve coupling, close GUARD/prompt seams
**State:** verified
**Score:** 6 — hardening seams on deletion machinery, all currently held by prose or nothing; named by the #84 build's own reviews
**Est-files:** skills/ultrapowers/SKILL.md, skills/ultrapowers/scripts/sweep_worktrees.sh, skills/ultrapowers/scripts/ultra_gate.py, skills/ultrapowers/harnesses/waves.js, tests/
**Plan:** docs/superpowers/plans/2026-08-06-84-hardening-remainder.md
**Engine:** ultrapowers
**Notes:** Five seams from the #84 reviews (2026-07-27 drain). Note the machinery-earned-by-recurrence bar at planning: prefer structural closures (e.g. make approve sweep the integration worktree mechanically rather than pinning the SKILL.md sentence) over pin-tests of prose — the distill doctrine and #106 both push against new pins. Partial overlap with what the 0.1.14 live shakedown will prove; check each seam against #108's shipped behavior before planning. PLAN TOGETHER WITH #102 (its doc face).

### #118: Simplification: delete the harvester's disk-fallback receipt sweep once session-scoped attribution lands
**State:** verified
**Score:** 6 — mandatory deletion candidate of distill 2026-08-06; the fallback IS the contamination vector behind the misattribution family
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, tests/test_harvest_runs.py
**Plan:** docs/superpowers/plans/2026-08-06-harvester-session-attribution.md
**Engine:** subagent-driven
**Notes:** Strictly-down simplification, subsumed by #113's structural change. One-time audit first: how many cached bundles depended on the fallback and whether any of those attributions were correct. PLAN TOGETHER WITH #113 (one plan, fallback deleted in the same change that replaces it).

### #110: WF_RUN_RE requires ≥2 hyphen-separated id segments — single-segment runtime ids would go unrecorded
**State:** parked
**Score:** 5.5 — hardening nit on the #108 leak-closure; mitigated today by left-behind accounting + audit re-surfacing
**Est-files:** skills/ultrapowers/scripts/ultra_gate.py, tests/
**Notes:** Shape assumption on runtime-minted ids (wf_<hex8>-<n> today). Closure direction the issue names: derive the recorded id from the launch response rather than parsing branch names — prefer that derive-don't-parse form at planning. CLUSTER: plan with #111 + #109 as one small post-#108 sweep-hygiene plan (inline engine). PARKED 2026-08-06 at sweep iteration 9 (operator-approved): both closure directions land in FROZEN ultra_gate.py for a zero-occurrence hypothetical (runtime mints wf_<hex8>-<n>; single-segment ids never observed), with verified loud mitigation (left-behind accounting at sweep_worktrees.sh:319-341 enumerates on-disk wf_* unconditionally; --audit re-surfaces by age). REOPEN TRIGGER: an observed runtime id the WF_RUN_RE pattern misses — it will show in the approve receipt's left-behind list. Spec: docs/superpowers/specs/2026-08-06-sweep-hygiene-smalls-design.md. || RE-TRIAGED 2026-08-14: ultra_gate.py is FROZEN periphery (eval route only); mitigations (left-behind accounting, audit re-surfacing) hold; no field occurrence of single-segment ids. Held; no eval cell warranted. || CLEAR-OUT 2026-08-20: issue CLOSED as not-planned on GitHub; park record + reopen trigger unchanged.

### #102: docs: workflow-template.md contradicts shipped #84 behavior in three places
**State:** verified
**Score:** 5.5 — the canonical authoring/re-bake reference misleads every future harness edit; cheap, pure docs
**Est-files:** skills/ultrapowers/references/workflow-template.md
**Plan:** docs/superpowers/plans/2026-08-06-84-hardening-remainder.md
**Engine:** ultrapowers
**Notes:** Three pre-#84 descriptions of merge/completeness running on the session main checkout — now false (integration in a dedicated worktree). PLAN TOGETHER WITH #103 (same subject, doc face + hardening face).

### #111: sweep --audit: absurd --age-hours magnitudes overflow the threshold arithmetic (report-only)
**State:** verified
**Score:** 5 — report-only blast radius, implausible input; found by the #108 adversarial reviewer
**Est-files:** skills/ultrapowers/scripts/sweep_worktrees.sh, tests/
**Plan:** docs/superpowers/plans/2026-08-06-sweep-hygiene-smalls.md
**Engine:** inline
**Notes:** 64-bit wrap inverts the age filter at --age-hours ≥ ~20 digits. Magnitude bound beside the existing digits-only case + one test. CLUSTER: plan with #110 + #109 (one inline sweep-hygiene plan).

### #106: Test-mass skeptical review: ~1,170 of the drain's 1,667 inserted lines are tests/sims — audit for ballast
**State:** verified
**Score:** 5 — simplicity objective; the counterweight pass the complexity doctrine requires after a heavy drain
**Est-files:** tests/, skills/ultrapowers/harnesses/, docs/
**Plan:** docs/superpowers/plans/2026-08-06-test-mass-audit.md
**Engine:** ultrapowers
**Notes:** Analysis-first: classify the drain's added tests (pins-of-pins, known-fragile triggers, meta-assertions) and propose deletions with evidence; deletions land behind the suite gate. Candidates enumerated in the issue by the drain's own reviews. Output may be small — a deletion PR plus keep-verdicts — which is success, not failure.

### #109: Stale waves.js comment: integration-worktree cleanup still describes the pre-#108 manual sweep call
**State:** verified
**Score:** 4.5 — trivial comment fix, but a stale claim inside the engine misleads harness editors
**Est-files:** skills/ultrapowers/harnesses/waves.js
**Plan:** docs/superpowers/plans/2026-08-06-sweep-hygiene-smalls.md
**Engine:** inline
**Notes:** One comment. CLUSTER: plan with #110 + #111 (one inline sweep-hygiene plan). Mind the anti-drift rule if the comment lives in a baked span.

### #104: Subtraction candidate: retire the snapshot/restore family once #84 shakedown proves the checkout is never touched
**State:** verified
**Score:** 4 — real subtraction, but its precondition (0.1.14 live-shakedown evidence that the checkout is untouched) has not been observed yet
**Est-files:** skills/ultrapowers/scripts/run_lock.sh, skills/ultrapowers/harnesses/waves.js, tests/
**Plan:** docs/superpowers/plans/2026-08-09-snapshot-family-retirement.md
**Engine:** ultrapowers
**Notes:** DO NOT ACCEPT THIS CYCLE unless the operator overrides: the closing event is the live shakedown this very docket run provides (its ultrapowers-engine entries run on installed 0.1.14). If the drain's runs show zero checkout mutation and clean sweeps, next cycle's triage promotes this to accepted with field evidence in hand. — PROMOTED 2026-08-09 by operator direction (distill deletion-led cycle): precondition met — 0.1.14/0.1.15 live shakedown showed 5 waves runs + resumes with zero checkout mutation, snapshot/restore a no-op throughout, plus a machine-crash recovery with zero loss via git-durable state alone. Sequence WITH #126 (deletion-first).

### #119: Complexity-audit loop: adversarial trim review at spec approval + distill cluster-died retrospective
**State:** verified
**Score:** 7 — operator-commissioned standing requirement; guards the complexity budget of every future change; prose-only build
**Est-files:** CLAUDE.md, skills/ultralearn/references/distilling-proposals.md
**Plan:** docs/superpowers/plans/2026-08-06-complexity-audit-loop.md
**Engine:** inline
**Notes:** Spec ALREADY WRITTEN + committed (docs/superpowers/specs/2026-08-06-complexity-audit-loop-design.md) with its own first trim review adjudicated in-spec — planning sweep should go straight from that spec to a plan, no new brainstorm. Practice already adopted in-session for the 2026-08-06 sweep; this entry makes it durable. Two prose surfaces, no scripts, no gate changes. Accepted directly at creation by explicit operator commission (brainstorm 2026-08-06).

### #126: Harvester attribution v2: delete the transcript receipt text-scan
**State:** verified
**Score:** 9.5 — the deletion-led cycle's centerpiece: measurement-loop integrity AND genuine simplification (north-star simplest-codebase clause)
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, tests/test_harvest_runs.py
**Plan:** docs/superpowers/plans/2026-08-09-harvester-attribution-v2.md
**Engine:** subagent-driven
**Notes:** Distill 2026-08-09 headliner; supersedes #121 (closed). Sev-3 field evidence at 0.1.15 (home bundle: fixture stamps registered as runs, gateReport = fixture literal, 5/5 real receipts lost). Fix IS a deletion: stamps from Workflow tool_use args only; receipts/gateReport from per-stamp disk reads only (last-write-wins); multi-launch slice envelope; carries #121's hygiene items. canaryMetric: home-bundle receipt accuracy 0/5 → 5/5. SEQUENCE FIRST with #104 (already accepted) — one deletion pair, per operator directive. Issue body carries the full design — short brainstorm.

### #127: redirect_args.py derives the integration branch from the argsFile
**State:** verified
**Score:** 7 — operator-attention efficiency on the field-validated micro-redirect lane; 3/3 sessions stumbled on first call
**Est-files:** skills/ultrapowers/scripts/redirect_args.py, tests/test_redirect_args.py, skills/ultrapowers/SKILL.md
**Plan:** docs/superpowers/plans/2026-08-10-redirect-lane-derivation-pair.md
**Engine:** subagent-driven
**Notes:** Tiny structural fix: derivation order argsFile.integrationBranch → --integration-branch → gate-receipt.json → loud error. One new test. SKILL micro-redirect bullet drops the gate-receipt clause. Drain-sized.

### #120: Worktree creation fails closed on an existing path (narrowed scope)
**State:** verified
**Score:** 7 — integration correctness; 2nd field occurrence (wrong-worktree dispatch blocked a foreign run); the cycle's ONE additive guard
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/wave-merge.md, tests/
**Plan:** docs/superpowers/plans/2026-08-10-worktree-create-fail-closed.md
**Engine:** inline
**Notes:** OPERATOR-NARROWED at distill: ONLY the single fail-closed check at worktree creation for non-resume launches (path exists → loud error naming path + sweep remedy). NOT in scope: HEAD-equals-base assert (ancestry check owns that symptom, proven in field), audit surfaces, new error taxonomy. Harness JS → .mjs sim + sentinel + anti-drift obligations.

### #122: Docket tooling seams from the drain shakedown
**State:** verified
**Score:** 6.5 — every future drain re-hits all three seams (Acceptance grammar guidance, compile_docket clusters, drain-mode run-ID recording); autonomy robustness
**Est-files:** skills/ultradocket/SKILL.md, skills/ultradocket/scripts/compile_docket.py, tests/test_compile_docket.py
**Plan:** docs/superpowers/plans/2026-08-10-docket-tooling-seams.md
**Engine:** subagent-driven
**Notes:** Three parts: (1) sweep step-3/5 guidance names the exact compiling Acceptance form (prose; grammar itself is eval-gated compiler vocabulary — do NOT widen ACCEPT_SUITE); (2) compile_docket learns PLAN-TOGETHER cluster semantics (unit = unique plan, entries advance together — the drain's deduped-view logic, promoted); (3) drain-mode launch-ID recording so teardown's sweep set derives instead of being hand-reconstructed. Self-contained dev tooling, suite disposition.

### #128: Standing pre-authorization at NEEDS_ACK, recorded
**State:** verified
**Score:** 6 — consent-record honesty at the single human gate; 3 field observations; operator-decided direction (sanction-with-recording)
**Est-files:** skills/ultrapowers/SKILL.md, skills/ultrapowers/references/report-format.md
**Plan:** docs/superpowers/plans/2026-08-10-standing-preauth-recording.md
**Engine:** inline
**Notes:** CAUTION at planning: the approve receipt is written by FROZEN ultra_gate.py — unless the eval route is taken, scope the recording to the orchestrator layer (gate presentation + report + SKILL prose: print the ack list being consumed under the standing grant with its verbatim instruction + turn), never an ultra_gate.py edit. Also: verify the harvester/slicer preserves short human turns before treating the salvage-no-ack observation as real (check while implementing).

### #123: Engine residuals from the 2026-08-07 drain
**State:** parked
**Score:** 5 — fail-safe residue, mixed bundle; cherry-pick the unfrozen items
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/wave-merge.md, tests/
**Notes:** Item 1 (critic dual detach authorities) = plan-level prompt-design decision, fails safe today; item 2 (CONFLICT-path token sha) touches FROZEN gate_check — eval route or park; item 3 (unpinned SKILL finalize wiring) conflicts with the anti-pin doctrine — prefer a structural closure or drop; item 4 smalls. Suggest scoping a plan to items 1+3-structural only, or parking until a field incident. || RE-TRIAGED 2026-08-14: after 31c43ad the remaining scope = item 2 (frozen gate_check.py CONFLICT-path sha - EVAL ROUTE ONLY per operator directive 2026-08-14, never a narrative fix; safe-direction residual, no field regression to reproduce => no eval cell this cycle) + item 4 porcelain/mode smalls (no field occurrence). Item 4d's closure corrected by entry #147. Stays triaged. || CLEAR-OUT 2026-08-20: issue CLOSED as superseded — item 1 resolved by #114/#173 (heads/-derived detach, recorded sha demoted to context), item 3 pinned by test_finalize_wiring.py; survivor = item 2 (CONFLICT-path sha, fails-safe, frozen gate_check ⇒ eval route). || TRIAGE 2026-08-25: entry was stale at triaged; issue CLOSED 2026-08-20 as superseded (survivor item 2 = frozen gate_check eval route). Parked to match; reopen trigger unchanged.

### #124: Gate residuals from #117/#105
**State:** verified
**Score:** 4 — cosmetic/coverage smalls on shipped fixes
**Est-files:** tests/test_run_acceptance.py, skills/ultrapowers/SKILL.md
**Plan:** docs/superpowers/plans/2026-08-14-gate-residual-smalls.md
**Engine:** inline
**Notes:** --baseline-under-symlink test, platform-split mktemp mechanism comment, SKILL --test-cmd loud-fail note. All cheap; frozen files untouched (tests + docs only). Could ride any future inline unit as a tail task. || RE-TRIAGED 2026-08-14: ACCEPT items 1-3 only (baseline-mode symlinked-TMPDIR test, dual-mechanism comment, SKILL --test-cmd loud-failure note); item 4 is frozen-periphery restated and stays by name. Inline-sized. GATE: accepted under the operator's kickoff delegation for this cycle. || SWEEP 2026-08-14: no separate spec (three mechanical smalls; the issue text is the spec — recorded per sweep). Engine=inline (T=2). Compile: 2 independent tasks, no edges.

### #131: Redirect/Salvage relaunch inherits stale heads/ slots from the prior launch
**State:** verified
**Score:** 8 — integration correctness at the derive-don't-record authority layer; operator-designated priority class this cycle
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/scripts/redirect_args.py, skills/ultrapowers/references/wave-merge.md, tests/
**Plan:** docs/superpowers/plans/2026-08-10-redirect-lane-derivation-pair.md
**Engine:** subagent-driven
**Notes:** Field 2026-08-10 (redirect wf_e5afc7c1-dd4): redirect relaunch left a stale heads/wave-4 slot 10h older than the redirect's real final head; the completeness critic's baked detach-target rule ('highest-numbered wave-<n> slot') would have detached onto the pre-redirect tree — only the critic's mtime judgment saved it, where the sidecar convention was supposed to be authority. STRUCTURAL fix, not a guard (does not consume the cycle's one-additive-guard slot): clear heads/ on relaunch or namespace slots per wf-run so a stale slot is inexpressible. Shares the relaunch surface with #127 — consider PLAN-TOGETHER at sweep (one plan, redirect-lane hardening pair). Harness JS changes ⇒ .mjs sim + pass sentinel + anti-drift re-bake obligations.

### #129: Preflight passes but the run is unexecutable when /ultrapowers launches from a worktree-isolated session
**State:** parked
**Score:** 6.5 — real sev-3 field block (~630K tokens burned) but n=1 and the one-additive-guard slot this cycle is already committed to #120
**Est-files:** skills/ultrapowers/scripts/ultra_run.py, skills/ultrapowers/SKILL.md, tests/test_ultra_run.py
**Notes:** Field 2026-08-09 (wf_fe05bc69-a22): EnterWorktree session passed all 12 preflight stages, then every merge/reconcile/critic git command against the integration worktree was hard-refused by the session Bash guard; wave 1 blocked, all waves cascade-blocked, 0/5 merged. GUARD-SLOT CONTEST decided at triage per machinery-earned-by-recurrence: #120 keeps the slot (2 field occurrences vs this n=1). Held at triaged with prose mitigation (worktree-session-selfhost-block memory + issue text name the remedy: run from repo root). PROMOTE TRIGGER: a second field occurrence, at which point choose between fix option 1 (fail-closed preflight stage, cheap guard) and option 2 (cut integration worktree inside the session worktree's own .claude/worktrees/ — structural, larger blast radius: sweep globbing, gate paths). RE-TRIAGED 2026-08-10: #120's fail-closed worktree-creation guard SHIPPED in 0.1.17, so the contested slot is consumed and settled; operator re-affirmed the 2-vs-1 call this pass. Recommend PARK with the promote trigger (2nd field occurrence of an EnterWorktree-session launch block) rather than re-litigating at every triage; prose mitigation stands (run from repo root — worktree-session-selfhost-block memory + issue text). PARKED at gate 2026-08-10 per recommendation — stops per-pass re-litigation; the promote trigger above (2nd field occurrence of an EnterWorktree-session launch block) is the sole reopen condition. || RE-TRIAGED 2026-08-14: no second EnterWorktree-launch block; sense pass surfaced a COUNTEREXAMPLE (foreign run at ~0.1.15 completed a full engine lifecycle from a nested-worktree session, terminus approved+merged) - the recorded limitation may be narrower than 'any worktree session' (possibly specific to EnterWorktree Bash-guard binding). Stays parked; trigger unchanged; reconcile the counterexample if the trigger ever fires. || CLEAR-OUT 2026-08-20: BUILT via issue option 1 — fail-closed launch-checkout preflight stage (merge 7d99590, suite 1074); issue CLOSED.

### #130: Review packet can point at a commit no branch contains — retry trap after a contaminated first attempt
**State:** verified
**Score:** 5.5 — path-hygiene/integrity on run exhaust; agents defended correctly twice, so latent not active
**Est-files:** skills/ultrapowers/scripts/review-package.sh, skills/ultrapowers/harnesses/waves.js, tests/test_review_package.py
**Plan:** docs/superpowers/plans/2026-08-10-review-packet-branch-naming.md
**Engine:** inline
**Notes:** Field 2026-08-09 (wf_fe05bc69-a22): review-d796ce6..bb969e6.diff (211KB) named a contaminated orphan commit — no branch contained it, its diff deleted the plan/spec under execution; the clean redo was the real branch tip. Merge agent AND completeness critic independently caught it; a packet-trusting retry would have merged the wrong tree. Fix direction is derive-don't-record: name/validate packets by branch tip, not recorded sha pair (issue option b — redo overwrites predecessor — is the simplest inexpressible-shape). Also carries a secondary question: how a first attempt committed unrelated-work files at all (implementer worktree hygiene). Normal backlog per operator. RE-TRIAGED 2026-08-10: stands for acceptance as normal backlog. Option (b) — name packets by branch tip so a redo overwrites its predecessor — is the doctrine-aligned inexpressible-shape and is STRUCTURAL, not a guard (does not consume a guard slot). Harness JS touched at planning ⇒ .mjs sim + pass sentinel + anti-drift obligations.

### #134: Gate approve moves the shared primary checkout while other sessions may be working in it
**State:** parked
**Score:** 4.5 — low severity (git checkout restores), confusing failure; observed from the receiving end this cycle
**Est-files:** skills/ultrapowers/scripts/ultra_gate.py, skills/ultrapowers/SKILL.md, CLAUDE.md
**Notes:** Field 2026-08-09/10: session A's ultra_gate.py --approve checked out integration+main in the shared primary checkout while session B (lock-waiting, legitimately on another branch) was mid-preflight — B's branch silently became main, compile failed FileNotFoundError. RUN_LOCK serializes runs, not sessions, so lock-waiting sessions are now a real pattern. Issue's own options: (a) loud advisory + marker file surfaced by later preflights, (c) document the serialize-SESSIONS-during-approve rule — both cheap; (b) refuse-on-detected-activity is over-machinery. CAUTION at planning: ultra_gate.py is FROZEN periphery — scope any recording to the orchestrator/SKILL layer or marker-file sidecar unless the eval route is taken. Normal backlog per operator. RE-TRIAGED 2026-08-10: occurrence #1 ⇒ prose lean — take option (c) now (CLAUDE.md/SKILL serialize-sessions-during-approve rule); the marker-file advisory (a) is machinery earned by a second collision. FROZEN caution stands: no ultra_gate.py edit outside the eval route. PARKED (struck) at gate 2026-08-10 under the complexity lens — weak candidate (score 4.5), prose-only value vs doc-mass cost; REOPEN TRIGGER: a second cross-session approve/checkout collision, which per recurrence doctrine also buys the marker-file advisory (option a), not just the prose rule. || RE-TRIAGED 2026-08-14: no second cross-session approve/checkout collision in the 17-run sense pass; stays parked on its reopen trigger. || CLEAR-OUT 2026-08-20: option (c) shipped — CLAUDE.md approve-window session-serialization rule (merge 7d99590); (a)/(b) = frozen ultra_gate.py, eval route only; issue CLOSED, reopen on recurrence with loss.

### #132: frontier probe: K1 conflict reporting — multiset and delete/modify-label order-dependence at 3+ writers per path
**State:** parked
**Score:** 3 — evals/frontier only, no engine surface; conservative-direction reporting artifact (false-red K1, never false-green)
**Est-files:** evals/frontier/
**Notes:** Frontier residual, disclosed+acked at the 2026-08-10 gate. DORMANT by operator directive: the manyana thesis is SHELVED per pre-registered rule; do not work this unless the reopening trigger fires (evals/frontier/results/2026-08-10-adjudication.md = #133 corpus fix + one same-file-contention fixture, then re-run the probe). If reopened, fix wants its own reviewed pass (both run_eval tracks consume the Conflict list), not a drive-by.

### #133: frontier probe: K3 unmeasurable on this repo — 35/36 archived runs excluded for reconciliation commits
**State:** parked
**Score:** 3 — evals/frontier corpus only; itself PART of the frontier reopening trigger, so it activates only when the operator invokes that trigger
**Est-files:** evals/frontier/
**Notes:** Frontier residual. DORMANT by operator directive — this issue IS half the reopening trigger (adjudication doc: #133 corpus fix + same-file fixture ⇒ re-run probe), so it is worked exactly when the operator invokes the trigger, never on momentum. Preferred option per issue: tolerate reconciliation commits in extraction (pseudo-task diffs or cut at last pre-reconciliation merge) WITH designed comparison semantics, not a patch; foreign corpora (--tracks c elsewhere) is the fallback.

### #139: eval kit: extract prepare_cell() — ab_runner.main and run_ab_cell.main duplicate the six-step cell setup
**State:** verified
**Score:** 7 — measurement-loop integrity + simplicity: dedups a drift seam that has already fired once between the two A/B entry points
**Est-files:** evals/ab_runner.py, evals/run_ab_cell.py, tests/
**Plan:** docs/superpowers/plans/2026-08-10-eval-kit-reader-consolidation.md
**Engine:** ultrapowers
**Notes:** From PR #138's adversarially-verified review (CONFIRMED, anchored ab_runner.py:589). The drift risk already fired pre-#138: only the run-scoped driver carried the headless fixes, so the two A/B entry points ran different setups — and #138 itself had to insert seed_workflows at the correct slot in both files. Fix is deduplication (deletion-shaped, doctrine-aligned): extract prepare_cell(plan, engine_ref, root) -> (engine, workdir, baseline, env); both mains call it; run_ab_cell's dirt seeding moves after prepare_session_config unchanged (reviewer verified it never touches the run repo). Protects the eval kit that gates every frozen-periphery unfreeze. evals/ only — not frozen periphery. PLAN TOGETHER WITH #140 (same file, one small eval-kit follow-up plan).

### #140: eval kit: seed_workflows is a second, untested reader of the *.harness.json manifest schema — pin the contract with the session hook
**State:** verified
**Score:** 6.5 — measurement-integrity class: manifest-schema drift would make the A/B measure a saved-workflow config real operators never get
**Est-files:** evals/ab_runner.py, hooks/session_start.sh, skills/ultrapowers/harnesses/, tests/
**Plan:** docs/superpowers/plans/2026-08-10-eval-kit-reader-consolidation.md
**Engine:** ultrapowers
**Notes:** From PR #138's review (PLAUSIBLE, anchored ab_runner.py:333). HALF ALREADY LANDED: the empty-seed hard-fail shipped in #138's fix round (verified in main today, ab_runner.py:368-373 refuses an unprobeable cell). Remaining scope is ONLY part (b): one pin test asserting seed_workflows and hooks/session_start.sh extract the same file list from the committed *.harness.json manifests. This is a two-code-readers contract pin (test_no_prompt_drift precedent), not a prose pin — compatible with the anti-pin doctrine. Consequence if unpinned: infrastructure drift masquerades as an engine regression in A/B numbers. PLAN TOGETHER WITH #139. ACCEPTANCE CONDITIONAL (gate 2026-08-10): planning must examine the one-reader option FIRST — if #139's prepare_cell extraction can cheaply collapse kit+hook to a single manifest reader, the pin is never born; the pin test lands only if cross-language reality (bash hook / python kit) keeps two readers.

### #141: ultralearn harvester cannot see subagent-driven/inline drains — a growing sensing blind spot
**State:** verified
**Score:** 6 — sensing honesty for the growing off-waves drain share; occurrence #1 so prose only, no detector build
**Est-files:** skills/ultralearn/SKILL.md
**Plan:** docs/superpowers/plans/2026-08-10-sense-pass-posture-pair.md
**Engine:** inline
**Notes:** First formal occurrence (2026-08-10 sense pass); prose per machinery-earned-by-recurrence, confirmed by operator at triage commission. Take the issue's option 2: the sense verb documents that drains are harvested by commissioned read, not by the detector — the harvester's "0 new" on the 2026-08-10 drain (0 Workflow calls, 4 plans / 9 tasks) was CORRECT behavior. Recurrence is by design (the execution-fit rubric honestly routes small portfolios off waves), so record the PROMOTE TRIGGER explicitly: a sense pass where commissioned reads MISS or misread drain evidence — not merely occur — buys option 1 (sessionKind:drain detection via docket transitions + detached-worktree run_acceptance receipts). CLUSTER with #142: one tiny inline prose pair, both 2026-08-10 sense-pass posture findings.

### #142: Drain per-task review devolved to orchestrator-inline diff reads — review posture undeclared in the drain flow
**State:** verified
**Score:** 6 — verification-posture honesty at the drain: silent narrowing recorded nowhere; occurrence #1 so prose only
**Est-files:** skills/ultradocket/SKILL.md
**Plan:** docs/superpowers/plans/2026-08-10-sense-pass-posture-pair.md
**Engine:** inline
**Notes:** First formal occurrence (2026-08-10 sense pass); prose per machinery-earned-by-recurrence. Not an incident — suite gates held (exit-code authority intact, JS-sim guard fired for the waves.js plan) and the redirect canary read 0 — but the 2026-08-10 drain dispatched 9 implementer tasks with ZERO independent reviewers while the authoring session had promised per-task review, and nothing recorded the narrowing. Fix: the run-mode flow declares its review posture — (a) drains inherit full subagent-driven per-task review vs (b) drains run on suite-gate authority with review-by-exception — and the end gate states which posture was used. One paragraph, no guard. The (a)-vs-(b) choice itself is an OPERATOR decision at planning (trades drain tokens against review depth for every future drain). Recurrence after write-down is what buys enforcement. CLUSTER with #141.

### #146: Fix-round dispatch seams: packet records fix-commit-only range; fix worktrees cut from stale base; implementer-reported sha tails
**State:** verified
**Score:** 8 — integration correctness (quarterly #1); derive-don't-record structural class, recurrence-backed across campaign + 3 foreign field runs
**Est-files:** skills/ultrapowers/harnesses/waves.js, tests/sim_workflow.mjs, tests/
**Plan:** docs/superpowers/plans/2026-08-14-fix-round-dispatch-derivation.md
**Engine:** ultrapowers
**Notes:** Triage 2026-08-14 (post-0.2.0 cycle). Campaign evidence (evals/frontier/results/2026-08-13-calibration-arm-a.md, attempts 3-8): (1) fix-round review packet diffs <impl-head>..<fix-head> instead of task-BASE->head x2 (one packet exposed ~6% of changed lines); (2) fix-round worktrees cut from stale base x3, implementers self-recovered via reset to BASE; (3) implementer-reported headSha with correct 7-char prefix + fabricated tail x1. CROSS-VALIDATED by the 2026-08-14 sense pass: the packet-range class independently hit 3 foreign field runs at 0.1.17-0.1.18 (multi-commit task packets cut first-commit..head or starting past BASE; reviewers recovered from the git object store each time; a packet-trusting reviewer certifies a fraction of the task). Class fix = derive fix-round dispatch inputs (BASE, packet range) from the run's sidecars once, never per-agent-reported values; cover BOTH the fix-round leg and the multi-commit first-review packet. Harness JS => .mjs sim + pass sentinel + anti-drift obligations. GATE: accepted under the operator's kickoff delegation for this cycle (triage->sweep->drain instructed 2026-08-14; no live gate). || SWEEP 2026-08-14: spec docs/superpowers/specs/2026-08-14-fix-round-dispatch-derivation.md, adversarial trim review adopted (orig graded up; trimmed to fix-round-only override + 10-word reviewer-fallback belt = the cycle's one additive guard). Engine=ultrapowers via risk override (engine dispatch/review integrity). Compile: waves [[1],[2,3]], WaW 1->2 line-cap-serialized (waves.js 2022>400).

### #147: Shakedown-run critic residuals: trusted-green stamp unguarded (waves.js:2007), critic BLOCKED fail-safe widened, prompt inconsistency, weak finalize-wiring self-check
**State:** verified
**Score:** 7.5 — verification-boundary gaps recorded by the run's own completeness critic and never dispositioned before release; integration correctness (quarterly #1)
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/wave-merge.md, tests/sim_workflow.mjs, tests/test_finalize_wiring.py
**Plan:** docs/superpowers/plans/2026-08-14-shakedown-critic-residuals.md
**Engine:** ultrapowers
**Notes:** Triage 2026-08-14. Source: .claude/ultrapowers/run-20260814-101750/report.json completenessFindings (the s5 shakedown), surfaced by the sense pass - none were dispositioned at the delegated gate; filed as gh #147. (i) waves.js:2007 stamps gate-facing tests.passed unconditionally; delivered scenario (tests/sim_workflow.mjs:2874-2913) does not assert the 'must NOT carry a trusted green' property => #123 item 4d closure is PARTIAL. (ii) critic BLOCKED fail-safe now fires on 'no wave-<n> slot readable' (occurs whenever wave 1 blocks) and drops escalated CANNOT-VERIFY items; uncovered. (iii) critic prompt trailing sentence re-elevates the recorded merge sha the same change demoted to a cross-check (benign, unpinned). (iv) tests/test_finalize_wiring.py self-check proves the presence pin only, never the ordering pin. All surfaces harness/references/tests - NOT frozen periphery. Distill note recorded: completenessFindings had no forced disposition slot under standing delegation. GATE: accepted under the operator's kickoff delegation for this cycle. || SWEEP 2026-08-14: spec docs/superpowers/specs/2026-08-14-shakedown-critic-residuals.md, adversarial trim review adopted (item 1 ANSWERED-not-built: tests.passed is triage context, gate exit code is authority; item 2 trimmed to dead-predicate fix at waves.js:1944; trimmed version graded down). Engine=ultrapowers via risk override (critic/merge-path integrity). Compile: waves [[1,3],[2]], WaW 1->2 line-cap-serialized.

### #148: Engine treats infra-killed agents as review failures — park-and-retry for API-overload agent death + mergeWave null-guard
**State:** verified
**Score:** 8.5 — integration correctness at the merge boundary (quarterly #1): sev-2 whole-run abort class + sev-3 cascade that converts committed work into failures
**Est-files:** skills/ultrapowers/harnesses/waves.js, tests/sim_workflow.mjs
**Plan:** docs/superpowers/plans/2026-08-14-infra-death-park-retry.md
**Engine:** ultrapowers
**Notes:** Triage 2026-08-14 (post-distill). Both seams grounded at HEAD 10eae33. (1) Infra-death conflated with review failure: runTask catch emits status:failed/reviewVerdict:agent-error (waves.js:976-978) after one immediate same-tier retry (954-967) that re-runs the whole pipeline incl. a possibly-committed implementer; reviewer dispatches (~1073-1086) have NO null guard (null reply → TypeError → catch path); noteFailures cascade-blocks transitive dependents (1673-1686, 1735-1742). (2) mergeWave git-merge/reconcile dispatches catch throws only (1469-1492) but agent() RETURNS null on terminal Overloaded (engine's own comment 1288-1291) → TypeError at merge.status (1478); mergeWave unwrapped at call site (1815) → whole-run abort losing every merged wave. Fix shape: (a) null-guard the two git-merge-path dispatches, synthesizing CONFLICT like the contended path's proven guards (1292/1399/1417/1443); (b) park-for-delayed-retry with backoff for infra-death instead of failed so the DAG holds. (b) needs planning: wave-barrier/budget interaction, and terminal parked MUST surface via EXISTING report vocabulary — frozen gate_check.py consumes report fields (120-140), no vocabulary change. This is waves.js CODE, not baked prompts (no re-bake), but keep edits clear of pinned prompt constants. Harness JS ⇒ sim_workflow.mjs scenarios (null merge reply; null reviewer reply; park + delayed recovery; terminal park → dependents blocked) printing ALL SCENARIOS PASSED (sentinel exists :3031; agent() mocked per scenario). || GATE 2026-08-14 (post-distill): accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-14: spec docs/superpowers/specs/2026-08-14-infra-death-park-retry.md rev 2, trim review adopted (AGENT_NULL-prefix classifier only; fix-round null site covered; retry pass position/budget/parallelism pinned; WaW weakening documented-accepted; grade flat). Engine=ultrapowers via risk override (hard-to-verify failure routing; both tasks adversarial). Compile: waves [[1,2]], fold-eligible same-file pair. || DRAIN 2026-08-14 (docket-20260814-154105): e148 wf_cc877cf0-725, 11 agents/838k/43min, 2/2 clean 0 fix-iter, waves [[1],[2]] line-cap WaW; gate green (942 + sims sentinel), merged 9b800d2. Residuals for end gate: barrier-retry bypasses chunkLost sweep (unreachable today), 2 stale comments (waves.js:964-965,1049-1052), 2 deferredVerification:runtime premises (agent-null-not-throw, parallel-order). No fix round -> #146 deferred:runtime still open.

### #149: Residual manifest at finishing — every report.json finding dispositioned before a run or drain closes
**State:** verified
**Score:** 8 — verification-boundary honesty (north star): the run's own self-reported gaps currently survive only in orchestrator memory
**Est-files:** skills/ultrapowers/references/report-format.md, skills/ultrapowers/SKILL.md, skills/ultrapowers/references/finishing-notes.md, skills/ultradocket/SKILL.md, tests/test_report_runbook.py
**Plan:** docs/superpowers/plans/2026-08-14-residual-manifest.md
**Engine:** subagent-driven
**Notes:** Triage 2026-08-14 (post-distill). Grounded hole: report.json emits completenessFindings/judgmentCalls/deferredVerification (report-format.md:42/48/50) but only deferredVerification has any consumer (gate_check.py:140 NEEDS_ACK path + finishing-notes checklist :61); SKILL.md:244-248 documents the orchestrator-memory dependence (resume gates: "carry prior items forward yourself"); the ultradocket end gate derives no residual list from report.json. Fix shape: finishing/release/drain-close derives a residual manifest in which every finding lands in {fixed|acked|filed|waived-with-reason}; mechanize the resume-gate union the same way. MUST NOT touch frozen gate scripts (gate_check.py, ultra_gate.py, run_lock.sh) — enforcement lives in the finishing/close prose or a NEW non-frozen script; do NOT extend gate_check NEEDS_ACK machinery. Keep the test_report_runbook.py pin green; report-format.md is NOT a bake source (no re-bake); no harness JS (no .mjs sim). Ceremony caution: one derivation step, not a new gate. Plan-together candidate: #147's residue named this as its deferred structural fix — the report-format.md:79 gitVerified doc-sweep item can ride the same contract edit; ultrapowers finishing + ultradocket end-gate can be one plan sharing that edit. || GATE 2026-08-14 (post-distill): accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-14: spec docs/superpowers/specs/2026-08-14-residual-manifest.md rev 2, trim review adopted (content-hash ids; single contract home finishing-notes.md; one vocabulary; --gate-acks prefill; check-at-close-only; gitVerified absorption DROPPED as unrelated; grade up-honest). Engine=subagent-driven (T=3, width 2, low risk -> else branch). Compile: waves [[1],[2,3]]; plan-embedded script+tests proven runnable (9 passed). SKILL shrink budgets stated as hard criteria. || DRAIN 2026-08-14 (docket-20260814-154105): PARKED by the review-by-exception lane (first firing). All 3 tasks executed clean on branch ultra/docket-e149 (1ad0c86 script+9tests, 22e9256 contract home, 9ed521d SKILL wiring; suite 953) but the Task-1 adversarial review returned 2 Important + 1 Important test-gap (0 Critical), parking per posture: (I1) derive accepts any readable JSON and emits vacuous-green empty manifest - silent total evaporation via one wrong argument (residual_manifest.py:59-63,:100; plan-inherited); (I2) --gate-acks pre-fill over-matches - deliverable-only prefix ignores the why, acks unrecorded items (:83-96 vs gate_check detail shape; plan-inherited); (T1) filed:-bare/waived:-bare red states unpinned (DISPOSITION regex relaxation would go green). 4 Minor noted. SALVAGE SHAPE: fix I1 (die when no family key present), I2 (match deliverable+why prefix), T1 (red-state pins) on the branch, re-review, re-gate. Branch kept; full review in end-gate evidence. || SALVAGE 2026-08-14 (operator-authorized at end gate): fix r1 89b789a (die-on-non-report, why-in-prefix ack, red-state pins; 959) + r2 1958c75 (exact-match ack detail incl. STRUCTURAL_SUFFIX byte-copy; 961); re-review CLOSED (cross-ack repro inert, coercion byte-identical both sides). Gate green (961) vs main, merged b1e7745, verified. Un-park state-set recorded here since docket_lib has no parked->queued path.

### #150: Harvester precision v3 — dedupe double-counted audits, slice through the approval exchange, drain-administered gate terminus
**State:** verified
**Score:** 6.5 — sensor precision protecting the measurement loop every distill trusts; three successor modes to #126, each at the 2-3-run recurrence bar
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, skills/ultrapowers/scripts/audit_run.py, skills/ultradocket/scripts/record_wf_run.py, skills/ultradocket/SKILL.md, tests/test_harvest_runs.py, tests/test_audit_run.py, tests/test_record_wf_run.py
**Plan:** docs/superpowers/plans/2026-08-14-harvester-precision-v3.md
**Engine:** ultrapowers
**Notes:** Triage 2026-08-14 (post-distill). Sensor-side only; harvester is advisory-by-contract (soft-fail). (a) LOAD-BEARING: audit double-count — _transcript_dirs collects every "Transcript dir:" tool_result with no dedupe (harvest_runs.py:315-336) and _merge_audits bare-extends agents across dirs (:494-496), so a crash-resume that reprints a dir double-audits it; fix = per-agent transcript-identity dedupe (audit_run.py agent entries carry NO identity field today :117-118 — additive field in non-frozen audit_run.py + dedupe in harvest_runs.py; dir-level path dedupe alone may miss the overlapping-dirs variant). (b) Slice truncation: _last_artifact_record_index cuts at the last qualifying artifact (:123-152, drop at :164-166), so the operator's approval exchange is always excluded — boundary rule (how far past the cutoff) is a planning decision. (c) Drain-administered gate terminus: gate-receipt.json is written ONLY by frozen ultra_gate.py (:249) and the drain skips Step-5 by design (ultradocket SKILL.md:132-133) → no receipt in runDir → terminus "unknown"; fix = NEW drain-side evidence stamp from ultradocket tooling (record_wf_run.py writes run ids only) + teardown-surviving mirror; location/format are planning decisions; mirror AROUND the frozen files, never in them. (a) ships alone if (b)/(c) design stalls. pytest fixtures (test_harvest_runs.py has receipt-fixture patterns to extend); no .mjs sims, no re-bake. || GATE 2026-08-14 (post-distill): accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-14: spec docs/superpowers/specs/2026-08-14-harvester-precision-v3.md rev 2, trim review adopted (dir-level dedupe only, audit_run untouched; no cap/sentinel; mirror-only stamp as record_wf_run subcommand; writer=schema authority; grade flat-after-trims). Engine=ultrapowers (T=4, widest wave 3, low risk; task 4 adversarial by declared judgment). Compile: waves [[1,2,3],[4]], edge 3->4 marker; task-4 fixtures invoke the task-3 writer. || DRAIN 2026-08-14: SKIPPED (collision-dependent of parked #149 - shared ultradocket SKILL.md); stays queued for the next drain after #149 salvage. || DRAIN-B 2026-08-14: e150 wf_e970a0a9-8ad, 15 agents/1.08M/48min, 4/4 clean 0 fix-iter, waves [[1,3],[2],[4]] (line-cap WaW on harvest_runs.py pair, canary n=6); gate green (982), merged. Residual manifest DERIVED per the new #149 contract (15 rows; headline: mode-c approved-upgrade likely inert in production — pre-merge stamp + pinned-sha base never ancestor; branch-name base form is the only tested spelling); drain stamps recorded via the new subcommand for e148/e151/e150 (branch-name bases). Residual rows to disposition at the 2nd end gate; candidate consolidated follow-up issue: approved-upgrade join (+head-sha fallback field), falsy-root guard asymmetry + vacuous-approved guard, NUL ValueError except, exit-1 test, singular transcriptDir ordering, filename-hyphen doc note.

### #151: Disk headroom — between-wave sweep of merged-task worktrees (structural) + preflight free-disk check (the cycle's one additive guard)
**State:** verified
**Score:** 8 — disk-exhaustion family 3rd/4th occurrence (sev-2 twice); ENOSPC mid-merge masquerades as a merge CONFLICT and corrupts the integration signal
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/wave-merge.md, skills/ultrapowers/scripts/ultra_run.py, tests/test_ultra_run.py, skills/ultrapowers/scripts/sweep_worktrees.sh, tests/test_sweep_worktrees.py, tests/sim_workflow.mjs
**Plan:** docs/superpowers/plans/2026-08-14-disk-headroom.md
**Engine:** ultrapowers
**Notes:** Triage 2026-08-14 (post-distill). Two independent halves, good wave parallelism, no shared interface. (1) STRUCTURAL between-wave sweep of just-merged tasks' worktrees at the wave barrier — grounded: no sweep exists in the wave loop today (waves.js:366-377 keeps worktrees as evidence until the approve-time #108 sweep); waves.js has no shell access (zero child_process hits), so the sweep is a prompt-step (edit references/wave-merge.md + re-bake per workflow-template.md, drift pin green) or a small dispatched cleanup agent; MUST target only just-merged worktrees — sweep_worktrees.sh --run is too blunt (:258-284 keeps unmerged BRANCHES, not worktrees; a naive --run sweep destroys blocked/parked evidence); resume/redirect must tolerate already-swept merged worktrees; branches untouched, so the frozen approve-path sweep stays idempotent with NO ultra_gate.py edit. (2) Preflight free-disk headroom check in ultra_run.py vs rough per-task estimate × wave width, warn-or-block with conservative warn default — THE CYCLE'S ONE ADDITIVE GUARD, already charged at distill; no other new guards this cycle. Obligations: harness JS ⇒ .mjs sim + ALL SCENARIOS PASSED sentinel; wave-merge.md re-bake; pytest coverage in test_ultra_run.py (+ test_sweep_worktrees.py if the script gains a precise mode). || GATE 2026-08-14 (post-distill): accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-14: spec docs/superpowers/specs/2026-08-14-disk-headroom.md rev 2, trim review adopted (branch-name trust model corrected: regex narrowing + porcelain identity check; bea1875 reversal acknowledged, BOTH pins replaced incl. test_no_prompt_drift.py:118; env knob deleted; min(2GiB,estimate) floor; contended path declared best-effort-excluded; grade up-earned). Engine=ultrapowers via risk override (model-typed input driving forced deletion; task 1 adversarial). Compile: waves [[1,2]], disjoint files. Preflight stage = the cycle ONE additive guard. || DRAIN 2026-08-14 (docket-20260814-154105): e151 wf_fa74a18c-615, 9 agents/699k/23min, 2/2 clean 0 fix-iter, wave [[1,2]] parallel disjoint; FIRST RUN ON THE #148-PATCHED ENGINE (clean). Gate green (951 + 4 sims sentinel), merged. Residuals for end gate: sweep-line paths repo-relative vs agent cwd = integration worktree (prompt absolute-path clause is the only guard; silent-no-op risk, fails safe - consider absolute paths follow-up); multi-entry SWEEP PATHS list + outside-fillPaths placement unpinned by sims; disclosed task-local sim-regex narrowing (unsatisfiable plan assertion). No fix round.

### #152: Retire audit_run misrankCandidates — deletion candidate, zero actioned flags in ~156 runs
**State:** verified
**Score:** 7 — simplicity objective via subtraction doctrine; dead diagnostic that missed both target classes and false-fired on planned-tier intent
**Est-files:** skills/ultrapowers/scripts/audit_run.py, tests/test_audit_run.py, tests/test_audit_refactor.py, skills/ultrapowers/references/report-format.md
**Plan:** docs/superpowers/plans/2026-08-14-retire-misrank-candidates.md
**Engine:** inline
**Notes:** Triage 2026-08-14 (post-distill). CONSUMER GREP COMPLETE AT TRIAGE (repo-wide): key produced only in audit_run.py (:111 empty shape, :124-129 compute, :144 return, :176-191 render, docstring :7, thrash comment :51); test consumers = test_audit_run.py:57-70 (two tests) + test_audit_refactor.py:13 key-set assertion; prose consumer = report-format.md:117 (verified NOT pinned by test_report_runbook.py); harvest_runs.py imports audit() but _merge_audits (:487-508) rebuilds from agents/totals/note only — misrankCandidates never reached the ledger; render_viewer.py/swarm_watch.py/viewer//tests/*.mjs/evals/ zero hits. escalatedTasks/thrashCandidates are separate paths (:134-145, main :193-202) and STAY. Deletion lands behind the suite gate per subtraction doctrine (tests updated in the same change, never narrative-merged); reverses the 2026-06-25 tier-floor spec :92 keep-verdict — plan cites the observed miss record as the reversal basis. Historical plans/specs mentioning misrank are records, not consumers — leave them. No frozen surfaces, no sims, no re-bake. Inline-sized; could ride as a tail task. || GATE 2026-08-14 (post-distill): accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-14: no separate spec (fully-mapped deletion; the issue is the spec — #124 precedent). Engine=inline (T=1, no width, low risk). Plan compiles PLAN OK; key-set assertion becomes the deletion pin; statistics import removed if orphaned. || DRAIN 2026-08-14: SKIPPED (collision-dependent of parked #149 - shared report-format.md); stays queued for the next drain after #149 salvage. || DRAIN-B 2026-08-14: unblocked by #149 salvage; inline on ultra/docket-e152 per plan (pin red->green, -53/+7 lines, statistics import orphan removed), suite 966, gate green (sims correctly skipped), merged.

### #153: redirect_args integrationBranch derivation can never fire — gate receipt says branch, derivation reads integrationBranch (#127 follow-up)
**State:** verified
**Score:** 8.5 — deterministic dead path at the redirect lane (4 sessions observed, not flaky); smallest fix on the slate; closes the recurring first-call-stumble family
**Est-files:** skills/ultrapowers/scripts/redirect_args.py, tests/test_redirect_args.py
**Plan:** docs/superpowers/plans/2026-08-14-redirect-args-branch-fallback.md
**Engine:** inline
**Notes:** Triage 2026-08-14 (post-distill). Grounded at HEAD: ultra_gate.py stores the branch under key "branch" (:192 set, :249 write; no integrationBranch key ever written) while redirect_args.py:64 reads "integrationBranch"; compile-emitted args.json carries no integrationBranch either (compile_plan.py args_payload ~:1691-1704) — so every flag-less redirect_args call dies on the fail-loud path by construction. Fix is ONE LINE in redirect_args.py ONLY (accept "branch" as receipt fallback; keep integrationBranch precedence for legacy/hand-built receipts) + a regression test using a REAL-shaped gate-receipt fixture ("branch" key, no "integrationBranch") — the existing fixture at test_redirect_args.py:23-24 uses the unrealistic key, which is exactly how this passed green; keep it as legacy-key coverage. Writer side is FROZEN — never rename the key in ultra_gate.py; hold the reader-side one-line scope at planning per operator directive. Pure Python + pytest; no harness JS, no sims, no re-bake. Evidence: home run b457d1f9 transcript lines 294-298 (distill 2026-08-14). || GATE 2026-08-14 (post-distill): accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-14: no separate spec (deterministic one-line schema-mismatch fix; the issue is the spec — #124 precedent). Engine=inline (T=1, no width, low risk). Plan compiles PLAN OK; legacy-key precedence pinned alongside the real-shaped fixture. || DRAIN 2026-08-14 (docket-20260814-154105): inline on ultra/docket-e153, TDD per plan (expected red/green split confirmed), suite 944 (+2 tests), gate green (sims correctly skipped - no harness JS), merged 99c6e55.

### #172: Fold-native Phase 2 — planning kickoff (design-inputs pointer)
**State:** parked
**Score:** 9 — the program's declared NEXT (0.2.15 campaign record); north-star autonomy via resolver reach
**Est-files:** docs/superpowers/specs/2026-08-18-fold-native-authoring-program.md, docs/superpowers/specs/2026-08-19-phase2-design-inputs.md
**Notes:** Triage 2026-08-20. #172 is a POINTER issue — adds no scope; the program spec (2026-08-18, §Phase 2) stays the single source of truth and the 2026-08-19 design-inputs note (maturity ladder / assume-rung, resolver-friendly authoring guidance, semantic-contention posture, operator-verification practice, Task-10 evidence) is additive input, never build-from-alone. NOT drain-sized (#96 precedent): route = operator brainstorm → Phase-2 spec rev → plan; the sweep iteration for this entry IS that brainstorm, pre-seeded with both docs. Close #172 when the Phase-2 spec rev absorbs the note. || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-20: skip-parked at iteration 1 by operator direction — ALL of #172 (Phase-2 planning) deferred to a dedicated sitting outside this docket cycle. Recorded input from the aborted brainstorm: operator ruled the assume-rung (compile-time exploitation of Commutes) OUT of Phase-2 scope — earn it after the composition-unpinned canary reads. Unpark = the operator convening the Phase-2 planning sitting.

### #163: hunks.read_reply_dir strictness: invalid UTF-8 silently rewritten to U+FFFD; stray in-block separator not parked
**State:** verified
**Score:** 7.5 — integration correctness (quarterly #1) at the resolver splice boundary: the one silent path in a byte-fidelity function
**Est-files:** skills/ultrapowers/kernel/hunks.py, tests/test_hunks.py
**Plan:** docs/superpowers/plans/2026-08-20-phase1-kernel-residuals.md
**Engine:** subagent-driven
**Notes:** Triage 2026-08-20, verified live at HEAD 91a67c5: hunks.py:141 decodes replies errors="replace" (every sibling malformed-reply case raises HunkError; this one silently corrupts bytes on a splice whose purpose is byte fidelity); _blocks raises MARKER_SHAPED only for nested-begin/unterminated — a content line byte-equal to SEP/END inside a block is treated as a marker, not parked. Both transcribed verbatim from the Phase-1 plan; task-2 adversarial reviewers routed them to the gate. Fix: errors="strict" → HunkError + park-on-unexpected-marker-form, tests for both. Kernel is NOT frozen periphery; no sims, no re-bake. Advisory rider: marker grammar now literal in three files (manyana.py, repo_weave.py, hunks.py) — drift risk, note only. CLUSTER: plan with #162 + #164 as one Phase-1 kernel-residuals plan (shared fold_wave.py/hunks.py/test_hunks.py surfaces). || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-20: PLAN-TOGETHER cluster #163+#162+#164, one plan docs/superpowers/plans/2026-08-20-phase1-kernel-residuals.md (no separate spec — the issue texts are the spec, #124 precedent; design approved by operator this session). Acceptance suite. Compile: PLAN OK, waves [[1,2,3]], shared test_fold_wave.py fold-eligible. Engine=subagent-driven (T=3, width 3, low risk -> else branch); Task 1 (#163 hunks strictness) marked Review: adversarial for the drain's review-by-exception lane.

### #166: harvest_runs._merge_audits drops dict-valued totals (wallSecByTask) on multi-transcript-dir sessions
**State:** verified
**Score:** 7 — measurement-loop integrity (the sensor every distill trusts); silent data loss on exactly the interesting runs (Salvage/Redirect relaunches)
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, tests/test_harvest_runs.py
**Plan:** docs/superpowers/plans/2026-08-20-harvester-dict-totals-merge.md
**Engine:** inline
**Notes:** Triage 2026-08-20, verified live at HEAD: _merge_audits sums only isinstance(int/float) totals key-wise — Phase-1 Task 7's new dict-valued wallSecByTask is skipped, so any session with >1 registered transcript dir (the filing run had 3 wf runs) silently loses it from bundle.audit.totals. Per-dir audit_run output unaffected; harvester is advisory-by-contract (soft-fail), so blast radius is sensing precision only. Fix: merge dict-valued totals key-wise (sum per task id) + a two-transcript-dir test; audit_run.py CLI table intentionally omits wallSec (stdout pinned) — structured dict only. Not frozen; drain-sized inline candidate. || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-20: design APPROVED at iteration-3 boundary (operator, this session), plan not yet written — resume here. Approved design: _merge_audits gains a dict-valued branch beside the numeric isinstance (merge key-wise, sum per task id, numeric leaf values only, bools excluded) + one test registering two transcript dirs with overlapping wallSecByTask ids; CLI stdout table untouched (pinned). No separate spec (issue-as-spec). Engine=inline (T=1). || SWEEP 2026-08-20 (resumed): plan WRITTEN + compiled PLAN OK + operator-approved; acceptance suite; queued.

### #169: ultraplan: emit an operator smoke manifest (SMOKE.md) with every plan
**State:** verified
**Score:** 7 — autonomy objective at the operator's actual verification boundary: aims the ONE human check (UI/CLI smoke) that currently runs on intuition; operator-commissioned practice (2026-08-19)
**Est-files:** skills/ultraplan/SKILL.md, skills/ultrapowers/references/plan-markers.md, tests/test_recommendation_rubric.py
**Plan:** docs/superpowers/plans/2026-08-20-operator-smoke-manifest.md
**Engine:** inline
**Notes:** Triage 2026-08-20. Authoring-skill prose ONLY — 3-5 adversarially-chosen behavioral probes ("do this" / "you should see") aimed where suite+exam are structurally blind (integration seams, visual/UI states, boundary feel). Constraints pre-recorded in the issue from the 2026-08-19 cost review: advisory output only, NEVER a gate input (frozen-periphery firewall); ~1 min authoring-time agent pass; zero run-time cost; no scripts, no engine change. Mind the ultraplan/plan-markers mirror + rubric pin when editing SKILL text. Design question for the brainstorm: where the manifest lives (plan section vs sibling SMOKE.md) and whether ultradocket's end gate surfaces it. Drain-sized (inline/subagent, prose + pins). || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-20: design APPROVED at iteration-3 boundary (operator, this session), plan not yet written — resume here. Approved design: manifest lands as a `## Operator smoke` SECTION IN THE PLAN DOCUMENT (not a sibling SMOKE.md — operator chose plan-section form); ultraplan SKILL.md gains one <=200-word section (draft in session: after the --check/validate section; 3-5 probes, each `do:`/`see:` lines, aimed at green-but-wrong seams the suite/exam cannot see; skip-if-no-observable-surface line; ADVISORY ONLY never a gate input, stated in the section). Mirrored spans (plan-markers mirror, BRANCH_CLAUSES rubric pin) untouched. Engine=inline (T=1, prose). || SWEEP 2026-08-20 (resumed): plan WRITTEN + compiled PLAN OK + operator-approved; acceptance suite; queued.

### #156: Drain 2026-08-14 residuals: approved-upgrade production join, guard asymmetries, park-lane pins, sweep-path addressing
**State:** verified
**Score:** 6.5 — recorded residual debt from the #148-#153 cycle under the #149 contract; headline item makes a shipped terminus-upgrade mode actually fire in production
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, skills/ultradocket/scripts/record_wf_run.py, skills/ultradocket/SKILL.md, skills/ultrapowers/harnesses/waves.js, tests/
**Plan:** docs/superpowers/plans/2026-08-20-drain-residuals-sensor-half.md
**Engine:** subagent-driven
**Notes:** Triage 2026-08-20. Twelve enumerated items in two disjoint halves. Sensor/drain-tooling half (items 1-7, headline = mode-(c) approved-upgrade join: pre-merge stamp keys on receipt['branch'] with no head-sha fallback, so pinned-sha bases are permanently inert and swept branches silently stay at raw verdict; plus falsy-root guard asymmetry, vacuous-approved pin, NUL ValueError, exit-1 pin, transcriptDir ordering decision, filename doc note). Engine half (items 8-12: barrier-retry chunkLost sweep gap + two stale waves.js comments + unpinned r1/r2 null guards + SWEEP PATHS addressing/pins — all currently-unreachable or fails-safe; sim-sentinel + anti-drift obligations on any waves.js touch). SCOPE SUGGESTION at planning: sensor half is the load-bearing plan; engine half is earn-by-recurrence candidates — cherry-pick or split per #95/#123 precedent. No frozen files needed (stamp schema lives in record_wf_run.py, the writer = schema authority per #150). || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-20: design APPROVED at iteration-3 boundary (operator, this session), plan not yet written — resume here. Approved scope: items 1-7 + 9 built; items 8, 10-12 HELD by name per earn-by-recurrence. Approved design: T1 mode-c join — record_wf_run.py stamp subcommand DERIVES headSha at record time (git rev-parse --verify <branch>, derive-don't-record; key present only when resolvable, loud stderr otherwise), _drain_ancestry_approved tries headSha-first-then-branch (survives swept branches), ultradocket SKILL step-3 wording names a MOVING branch ref for --base, filename-not-hyphen-splittable doc note rides the writer docstring; fixtures via the writer (schema authority). T2 harvester guard smalls — _drain_stamp_receipts `if root is None`->`if not root` + pin; _drain_stamp_terminus empty list -> 'unknown' not 'approved' (fail-safe behavior change, call site already guards) + pin; _transcript_dirs except (OSError, ValueError) for NUL paths + pin; transcriptDir fallback = LAST-MENTION-WINS ([A,B,A]->A, operator-approved) + pin; record_wf_run stamp non-git-cwd exit-1 pin. T3 waves.js stale comments — current ~:1063-1064 ('Never escalate an Overloaded/null fault' — nulls now parked above by isInfraFault) and ~:1133-1136 (AGENT_NULL throw rationale predates park lane; now routes to barrier park, not same-tier retry); comments are code-not-prompt, no re-bake; suite-gate sims run as usual. Engine=subagent-driven (T=3, width 3, low risk). || SWEEP 2026-08-20 (resumed): plan WRITTEN (items 1-7+9; 8,10-12 held by name) + compiled PLAN OK + operator-approved; acceptance suite; queued.

### #162: fold_wave: three residual RecursionError park lanes have no deterministic test (+ hunks two-block round-trip gap)
**State:** verified
**Score:** 6 — verification-boundary coverage on the kernel's only remaining ceiling (post-cap-retirement park lane); mutation-sweep evidence, not speculation
**Est-files:** skills/ultrapowers/kernel/fold_wave.py, tests/test_fold_wave.py, tests/test_hunks.py
**Plan:** docs/superpowers/plans/2026-08-20-phase1-kernel-residuals.md
**Engine:** subagent-driven
**Notes:** Triage 2026-08-20, verified live: except RecursionError lanes at fold_wave.py:322 (continued-fold in the resolve leg — the one that matters most under incremental fold), :366 (_self_checks), :561 (cmd_resolve rehydrate), plus the mid-fold park lane in cmd_fold; the gate critic's mutation sweep showed all silent when neutered across 178 targeted tests (only the _pre_scan lane got pinned in the redirect round). Fix recipe exists: monkeypatch fw.THREAD_RECURSION_LIMIT low, assert exit 3 / named park / caller limit restored; mutation-verify each. Rider: test_hunks.py "# two blocks" case actually produces zero blocks — no test round-trips a multi-block narration through splice's pos-advance loop; add a genuine two-block case. Tests-only (+ possibly zero source changes). CLUSTER: plan with #163 + #164. || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-20: PLAN-TOGETHER cluster #163+#162+#164, one plan docs/superpowers/plans/2026-08-20-phase1-kernel-residuals.md (no separate spec — the issue texts are the spec, #124 precedent; design approved by operator this session). Acceptance suite. Compile: PLAN OK, waves [[1,2,3]], shared test_fold_wave.py fold-eligible. Engine=subagent-driven (T=3, width 3, low risk -> else branch); Task 1 (#163 hunks strictness) marked Review: adversarial for the drain's review-by-exception lane.

### #164: Post-Phase-1 hygiene: restore threading.stack_size after run_on_kernel_thread; scrub retired sized-bound wording in run_eval.py
**State:** verified
**Score:** 5.5 — cheap hygiene pair; the stack_size leak is a real process-global footgun for the two in-process API consumers
**Est-files:** skills/ultrapowers/kernel/fold_wave.py, evals/frontier/run_eval.py, tests/test_fold_wave.py
**Plan:** docs/superpowers/plans/2026-08-20-phase1-kernel-residuals.md
**Engine:** subagent-driven
**Notes:** Triage 2026-08-20, both verified live at HEAD: fold_wave.py:117 sets threading.stack_size(1 GiB) and never restores (process-global — after one in-process call via run_eval._replay_group or tests, every later thread in that interpreter reserves 1 GiB; mirror the existing recursion-limit save/restore-in-finally); run_eval.py:647-649 still emits "kernel recursion limit exceeded even after widening it to fit the corpus" — sized-bound language Phase 1 retired (text-only; Task-8 gate grep missed it because it names no retired symbol). Third bullet (marker-literal triplication) is #163's advisory rider — do not double-count. evals/ + kernel, nothing frozen. CLUSTER: plan with #163 + #162 as one kernel-residuals plan. || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || GATE 2026-08-20: accepted, full slate, no budget ceiling (operator gate decision via AskUserQuestion this session). || SWEEP 2026-08-20: PLAN-TOGETHER cluster #163+#162+#164, one plan docs/superpowers/plans/2026-08-20-phase1-kernel-residuals.md (no separate spec — the issue texts are the spec, #124 precedent; design approved by operator this session). Acceptance suite. Compile: PLAN OK, waves [[1,2,3]], shared test_fold_wave.py fold-eligible. Engine=subagent-driven (T=3, width 3, low risk -> else branch); Task 1 (#163 hunks strictness) marked Review: adversarial for the drain's review-by-exception lane.

### #173: merge prompts: heads-slot git -C pinning + base-sha self-check — VERIFY & CLOSE, do not plan
**State:** parked
**Score:** 1 — verify-and-close: the requested fix shipped in 0.2.15, same day the issue was filed
**Est-files:** (none — no build)
**Notes:** Triage 2026-08-20: the exact fix the issue specifies (git -C {{INTEGRATION_WT}} on every heads-slot rev-parse in all three prompt blocks + wave-slot self-check-before-report + launch-directory recovery clause) is live in references/wave-merge.md at HEAD (verified :91/:190/:258), re-baked into waves.js, sim re-pinned (1de543a), landed via shakedown merge 9ddb817, released 0.2.15 (91a67c5) — the issue was filed at 16:58 local and the shakedown run built it hours later, and that run's own reviewer hardening rounds covered it. Engine-side JS verification of recorded heads stays parked per earn-by-recurrence, as the issue itself states. Close on GitHub with the commit evidence; nothing to build. || GATE 2026-08-20: verify-and-close executed — issue closed on GitHub with commit evidence (0516c10/9ddb817/91a67c5); parked as a no-build record. || GATE 2026-08-20: verify-and-close executed — issue closed on GitHub with commit evidence (0516c10/9ddb817/91a67c5); parked as a no-build record.

### #222: engine: key every round's artifacts by wfRunId + one deterministic relaunch composer for Redirect AND Salvage — the corrected fix for #149
**State:** executed
**Score:** 8.5 — integration correctness (Q-priority 1): the #149 manifest input never mechanically exists (report.json overwritten, heads/ deleted); autonomy (no orchestrator memory)
**Est-files:** skills/ultrapowers/scripts/redirect_args.py, skills/ultrapowers/scripts/salvage_args.py (new), skills/ultrapowers/scripts/residual_manifest.py, skills/ultrapowers/scripts/finalize_report.py, skills/ultrapowers/SKILL.md, skills/ultrapowers/references/wave-merge.md, skills/ultrapowers/harnesses/waves.js, tests/test_redirect_args.py, tests/sim_derived_heads.mjs, tests/test_ultra_gate.py
**Plan:** docs/superpowers/plans/2026-08-25-round-artifacts-relaunch-composer.md
**Engine:** ultrapowers
**Notes:** Build FIRST in the distill cluster (everything else edits the same Step-5 bullet / redirect_args.py or consumes its per-round artifacts). SCOPE CUT: as written it touches FROZEN ultra_gate.py (per-round report path) and gate_check.py (round-union coverage/ancestry) on an incident narrative (4/6 runs) — not licensed. Non-frozen variant: ultra_gate.py keeps writing report.json; the composers (redirect_args.py + new salvage_args.py) snapshot report.json→report-<n>.json and ROTATE heads/→heads-<n>/ before relaunch (never rmtree — preserves the #131 reason: relaunch renumbers waves so a stale higher wave-<n> slot wins the critic's detach rule); residual_manifest.py (non-frozen) derives over the report-*.json glob at every resume gate and run close; delete the 'delete heads/ before relaunch' prose (SKILL.md:298, redirect_args.py:125-128, test_redirect_args.py:174-190 flips). Cut round-union coverage in the gate: relaunch coverage is by construction the amended set (waves.js tasksPlanned); cross-round completeness lives in the manifest union. Brainstorm holes: the harness does not know its own wfRunId (waves.js keys on stamp / branch names) — key by a launcher-passed round counter; wf-runs.json is a SORTED id array (ultra_gate.py:44-68), not launch order. salvage_args.py = sibling of redirect_args.py (PRIOR ATTEMPT preamble, kept branch+sha, blocking notes, checkout-sha instruction, spread receipt argsFile, resume:true) replacing SKILL.md:287-301 hand-composition. Any waves.js prompt touch ⇒ re-bake + drift pin + .mjs sims (sim_derived_heads.mjs has 28 heads refs; must keep the ALL…PASSED sentinel). Dependents: #236 (watch — its input), #229 (watch), #224 soft, #223 shares redirect_args.py; serialize with #186 on waves.js.

### #223: engine: FILES is a footprint, not a fence — out-of-FILES edits advisory (deletions still block); redirect `files` derived, never hand-narrowed
**State:** queued
**Score:** 7.5 — token efficiency (costliest fix-loop exhaustion + a burned critic round in the 08-24 bundle); authoring robustness (engine amplified incomplete FILES on 3/7 tasks)
**Est-files:** skills/ultrapowers/references/reviewer-prompts.md, skills/ultrapowers/harnesses/waves.js, tests/test_no_prompt_drift.py, skills/ultrapowers/scripts/redirect_args.py, tests/test_redirect_args.py, skills/ultrapowers/SKILL.md
**Plan:** docs/superpowers/plans/2026-08-25-files-footprint-not-fence.md
**Engine:** inline
**Notes:** Two tasks. T1 reviewer-prompts.md :57 (IMPLEMENTER 'confirm every changed path is named there') + :134 (REVIEWER 'modifications outside FILES are blocking') — modifications outside FILES become a reported advisory (concern/judgment call); deletions outside FILES stay blocking verbatim; SIBLING FILES rule (:38,:147) untouched; re-bake waves.js, drift pin green, check tests/sim_workflow.mjs fixtures for the sentence. T2 redirect_args.py:98-100 derives `files` = task FILES ∪ instruction paths (path-like token regex, deterministic+tested) ∪ finding files and never narrows; rewrite the narrowing pin at test_redirect_args.py:35-49; strike SKILL.md:303-304 'narrow files to the fix' (leave the tier clause alone — #230 watch owns it). No canary (agreed at distill). Sequence AFTER #222 or plan together as one redirect-lane plan and bake waves.js ONCE with #226. #233 (watch) is the authoring-side complement — cite, don't bundle.

### #226: deletion: stop manufacturing 'TDD red-before-green not observable' residual rows — the completeness critic treats process-ordering claims as non-findings
**State:** queued
**Score:** 7 — token efficiency + autonomy (11 zero-information acked:process dispositions per run under #149's mandatory-ack grammar); simplification (the cycle's mandatory deletion)
**Est-files:** skills/ultrapowers/references/wave-merge.md, skills/ultrapowers/references/reviewer-prompts.md, skills/ultrapowers/harnesses/waves.js, tests/test_no_prompt_drift.py, skills/ultraplan/SKILL.md, skills/ultrapowers/references/plan-markers.md
**Plan:** docs/superpowers/plans/2026-08-25-process-ordering-non-findings.md
**Engine:** inline
**Notes:** Issue names the WRONG file: the completeness-critic brief is wave-merge.md:279-312 (BAKE:COMPLETENESS_PROMPT, :282), not reviewer-prompts.md — audit REVIEWER_PROMPT (:121-160) too since several reviewers also recorded it. One clause: a claim about the ORDER work was performed that the integrated diff cannot evidence is not a finding — omit it (not gaps/unverified/deferredVerification); constraints about test presence/coverage still verify. Do NOT reword 'what plan requirement is unmet?' — audit_run.py:41 ROLE_MARKERS keys on it. Root cause is plans copying a TDD line into ## Global Constraints (11 plans; ultraplan SKILL.md:268-271 forwards them as every reviewer's lens) — brainstorm decides whether to restore arm A's dropped second half: ultraplan guidance that process-ordering rules are per-task steps, never Global Constraints (mirror plan-markers.md, keep test_ultraplan_skill.py green). Re-bake + drift pin + .mjs sims; coordinate ONE waves.js bake with #222/#223. Verify by absence of acked:process TDD rows in the next bundle.

### #225: SKILL.md Step 5 prose: post-PASS redirect policy — advisory residuals default to `filed:`; elective polish relaunch is an explicit operator opt-in with the round's fixed cost stated (the cycle's ONE additive guard)
**State:** queued
**Score:** 7 — token efficiency head-on (58% tokens / 69% wall in a five-round tail); autonomy (default disposition without an operator round)
**Est-files:** skills/ultrapowers/SKILL.md, skills/ultrapowers/references/finishing-notes.md
**Plan:** docs/superpowers/plans/2026-08-25-post-pass-redirect-policy.md
**Engine:** inline
**Notes:** Rider-sized: one rule in the Step-5 Redirect bullet (SKILL.md:301-320) — after PASS (exit 0) advisory residuals default to filed:<ref> (grammar already at finishing-notes.md:98-103); batch all known findings into ONE redirect round; elective/polish relaunch only on explicit operator opt-in with the fixed round cost stated (agents × per-round cost, quote audit_run numbers when present). Nothing changes for NEEDS_ACK/BLOCKED; ack rules SKILL.md:225-243 stay authoritative ('batch into one round' must not become 'orchestrator swallows acks' — #236 watch). No test pins the Redirect wording; canary = elective redirect-round rate by engineVersion, no new sensor field. Land after #222's rewrite of the same bullet, or inline first as a one-liner.

### #192: engine: headless fleet runs use the whole-repo pytest as every task's testCmd — redundant, dominates wall-clock
**State:** parked
**Score:** 6.5 — token efficiency + execution speed (~1080 irrelevant tests × every TDD step; 35–42 min of run wall-clock); engine-side, not fleet
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/scripts/ultra_run.py, tests/*.mjs (new sim), skills/ultrapowers/SKILL.md
**Notes:** parked at gate 2026-08-25 (operator narrowing): defer: after run-9 / W2 — fleet live-unproven without the Max token (#208); keep 0.2.18 to the distill slate — Brainstorm-first on the SOURCE of a per-task testCmd. Cheapest correct option: a FILES-derived local testCmd (pytest path filter over the task's Files: dirs → tests/ siblings) applied ONLY to the implementer/TDD step (waves.js testCmdLine :161,:942-944 fallback), with reviewer/merge/gate unchanged on the run-wide command — no marker, no compiler change, one waves.js function + a covering .mjs sim (sentinel). State the invariant in the plan: per-task scoping loses cross-module regressions at the implementer step, acceptable only because wave-merge and the gate still run the whole suite. Alternative (plan-authored marker) touches mirror-pinned skill text + compile_plan.py (FROZEN diagnostic vocabulary — add no diagnostic); choose only if derivation proves ambiguous. Benefit measurable only on a live fleet run (BLOCKED on the Max token file); mechanism pins in the sim. Fold #198 in as a one-line rider. Plan aware of #234 (watch: preflight validating per-task testCmds fires if this makes them common) and #223 (same FILES footprint semantics).

### #190: fleet W1 residuals: spend-token source inert, untested invokeRun join, stale-receipt scoping, round advisories
**State:** parked
**Score:** 6 — code quality / integration correctness of the spend authority and receipt path (a stale gitignored receipt could green a never-gated run); exec-seam unit-gateable, no live run needed to gate
**Est-files:** fleet/shim-main.mjs, fleet/orchestrator.mjs, fleet/drive.mjs, fleet/provision.mjs, fleet/tests/test_shim.mjs, fleet/tests/test_orchestrator.mjs, fleet/tests/test_drive.mjs, fleet/tests/test_provision.mjs
**Notes:** parked at gate 2026-08-25 (operator narrowing): defer: after run-9 / W2 — fleet live-unproven without the Max token (#208); keep 0.2.18 to the distill slate — Item 1 SHIPPED (9d1929b, proven live run-7/8) — retitle/scope to the hardening list before planning. CLUSTER A anchor: build items 2–10 + #211 + #212 + #209-interim + #193 items 6/7 as ONE fleet-hardening plan — every item is a guard/latch/scope/path change pinned via the existing stubbed-exec seam and in-process orchestrator tests. Highest value: missing-runs-row → treat like a refusal (orchestrator.mjs:221-249 falls through to revoke+destroy on a half-written store); park-refusal latch (:226 re-pages every sweep); receipt scoping to the session the shim launched (findGateReceiptFile :435-439 = newest across ALL run dirs — the false-green vector); versionStamp cross-check against the pushed base sha (drive.mjs:407-409); ttl 15m vs publish 30m (drive.mjs:78-87); payload validation (provision.mjs:114-116); main()'s invokeRun binding untested (:785). Do NOT change the store schema or the guard's supervisory-exemption contract (#178). Test-hygiene item is a rider. test_provision.mjs pins full command strings by equality — pins move with any command change. Fleet plans gate NEEDS_ACK (deferred:external) by construction — operator ack at the gate is the licensed path (#204), then a live shakedown once the token file exists.

### #211: fleet: sandbox host-key reuse hazard — reused runId makes the #196 tunnel (and #197 pull) fail under accept-new
**State:** parked
**Score:** 6 — integration correctness of the live path (latent red at the tunnel step before the shim starts); unit-gateable flag assertions
**Est-files:** fleet/provision.mjs, fleet/drive.mjs, fleet/tests/test_provision.mjs, fleet/tests/test_drive.mjs, fleet/RUNBOOK.md
**Notes:** parked at gate 2026-08-25 (operator narrowing): defer: after run-9 / W2 — fleet live-unproven without the Max token (#208); keep 0.2.18 to the distill slate — CLUSTER A (with #190). Prefer option 1: `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` on every SANDBOX-bound command (provision.mjs:94 probe already has the first flag; :116 payload delivery, :153 tunnelCommand, drive.mjs:37-38 log pull have none) — ephemeral VMs have nothing to pin; over ssh-keygen -R on destroy (a crashed driver never reaches destroy). Keep exe.dev lobby + golden commands on normal config. Consolidate into one sandboxSsh(vmName) prefix helper so the four postures cannot drift; driveOne refuses a missing runId (or derives a unique one) instead of defaulting to 'run-1' (drive.mjs:75); RUNBOOK:204 gets the uniqueness line. Latent today (runIds 1–8 unique); live reproduction blocked on the token file.

### #212: fleet: #197 evidence is written inside dbDir, which the run procedure wipes — move it out / settle whether a fresh dbDir is needed
**State:** parked
**Score:** 6 — code quality/observability (run-6's evidence already lost this way); unit-gateable
**Est-files:** fleet/drive.mjs, fleet/orchestrator.mjs, fleet/tests/test_drive.mjs, fleet/tests/test_orchestrator.mjs, fleet/RUNBOOK.md
**Notes:** parked at gate 2026-08-25 (operator narrowing): defer: after run-9 / W2 — fleet live-unproven without the Max token (#208); keep 0.2.18 to the distill slate — CLUSTER A. Two tasks: (1) evidenceDir option defaulting OUTSIDE dbDir (sibling fleet-evidence/); gate-read-<runId>.json may stay in dbDir, the tgz + #215's stat/credits go to evidenceDir (drive.mjs:92,116-117); (2) answer 'does a persisted store affect a new run?' WITH A TEST (drive test on a pre-populated store carrying prior-run rows asserting sweep/spend/leaseContinuity unaffected) — the answer sets the RUNBOOK line ('persisted store harmless → never wipe' vs 'mv, never rm'; RUNBOOK:169,198 has no guidance). Sequence BEFORE #215 so its new files land in the right place.

### #224: ultralearn: sensor precision v5 — audit keyed by (stamp, task, attempt) with dead attempts excluded, relaunch role attribution via wf-runs.json, every fold call recorded, terminus/planningFound correct for in-session approve
**State:** queued
**Score:** 6 — token efficiency indirectly (unblocks #230's tier-cost audit and the fold canary); sensor-only; the retrospective is unverifiable until this lands
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, skills/ultrapowers/scripts/audit_run.py, tests/test_harvest_runs.py, tests/test_audit_run.py, skills/ultradocket/scripts/record_wf_run.py
**Plan:** docs/superpowers/plans/2026-08-25-sensor-precision-v5.md
**Engine:** ultrapowers
**Notes:** ABSORBS #188 (strict subset — its body says so): FIRST task = ('You are a merge-conflict resolver','resolver') in audit_run.py ROLE_MARKERS (:29-42; note the file is under ultrapowers/scripts) + 'resolver' in harvest_runs.py ENGINE_ROLES (:23) + one classify test; `close #188` in that commit. Reader-side only, fixture-first: (1) audit_run.py wallSecByTask keyed by (stamp,task,attempt), emit liveWallSec excluding mechanically-dead attempts; impl:? (34/56) is a TASK_ID regex miss (:20-23,:70-75) — look at a transcript before design; (2) relaunch round attribution via transcript-dir order joined to wf-runs.json ids — the harvester reads NO wf-runs.json today and wf-runs.json is SORTED, never assume launch order; (3) _frontier_max_lines (:712) reads one fold_stats.json per wave → record every one present (verify the writer's layout first; if the kernel must emit per-call stats that is engine + .mjs scope — file separately); (4) terminus/planningFound from the in-session approve exchange (extend _stamp_terminus fallback before 'unknown'). #150 v3 / #160 v4 already shipped persisted-first terminus. Don't touch record_wf_run's stamp schema unless a field is needed. Parallelizable with #222 (disjoint files); benefits from #222's per-round artifacts but does not require them. Add counters #206's charter trigger (b) needs (ambiguity-fork / deferred-property / underspecification rates) only if cheap.

### #185: Doc/vocab alignment after Phase-2 tier deletion (0.2.17)
**State:** queued
**Score:** 6 — authoring robustness (dependency-analysis.md is what plan authors/ultraplan read and it still teaches three deleted tiers + a retired flag); simplicity
**Est-files:** skills/ultrapowers/references/dependency-analysis.md, skills/ultrapowers/references/design-rationale.md, skills/ultrapowers/SKILL.md, evals/frontier/schedule_model.py, evals/frontier/results/2026-08-20-phase2-migration.md, CLAUDE.md
**Plan:** docs/superpowers/plans/2026-08-25-phase2-doc-vocab-alignment.md
**Engine:** inline
**Notes:** Pure doc subtraction, cheap tier, suite is the gate; bundle with #186 or ship as a one-task plan. Rewrite rules 6 / Ambiguous-Files block / precedence in dependency-analysis.md (:18,:71,:74-81,:102,:158) to the kept vocabulary (tests/test_compile_plan.py:2385 KEPT_EDGE_WHYS = marker, text, interface, write-after-create, + write-after-write under serialize); delete the --repo-root pre-filter paragraphs (say once: the runtime materialization guard is the sole eligibility authority); design-rationale.md:168 'prose-reference edge'; SKILL.md:38 '--repo-root is always stamped' (flag retired, ultra_run.py:135); drop 'ambiguous-files' from schedule_model.py:10 ONLY if evals/frontier tests still pass; add the `text: 0 → 0 (unchanged)` row to the migration record's Current-compiler table; fill CLAUDE.md:99 only. Do NOT touch the compiler or its diagnostic vocabulary (FROZEN).

### #186: Test-strength follow-ups from Phase-2 adversarial reviews (autoResolved sum, compositionRows negatives, parse re-pins)
**State:** queued
**Score:** 6 — code quality (each item names a mutation that stays green today) + integration correctness (autoResolved/compositionRows feed the residual manifest on the contended-merge path)
**Est-files:** tests/frontier_merge.mjs, skills/ultrapowers/harnesses/waves.js, tests/test_compile_plan.py
**Plan:** docs/superpowers/plans/2026-08-25-phase2-test-strength.md
**Engine:** inline
**Notes:** Two tasks. (a) engine — frontier_merge.mjs scenario 11e (fold autoResolved=1 + resolve autoResolved=2 → frontier 3; today no scenario has non-zero counts on both legs so `+=`→`=` in waves.js addWall ~:1417 stays green), four compositionRows negatives (single-writer, all-declared, mixed-writes wave with a task missing writes, partially-merged wave excluding the failed writer), then hoist the duplicated merged-wave-task join (waves.js:1402-1403 and :1759-1761) into one helper; :1733/:1738 guards get pins. waves.js non-prompt code — no re-bake — but the suite-gate runs frontier_merge.mjs (sentinel present :19/:505; NOT in pytest/CI); run `node tests/frontier_merge.mjs` locally. (b) compiler TESTS only — write-set pins for Config.YAML staying in writes and :line-range strip (compile_plan.py:83-101,:445), behavioral suppression pin under --overlap serialize (:2369 is source-grep only), tighten the catch-all did-you-mean assertion (:2351-2366) to the exact _LABEL_SUGGEST string. Mutation-verify each pin before commit. Do NOT touch compile_plan.py logic (FROZEN vocabulary). SERIALIZE with #222 on waves.js (same-file contention), never concurrently.

### #193: fleet/RUNBOOK.md: gaps that each cost a parked run before the golden was correct (found in Task 10 #189)
**State:** parked
**Score:** 5.5 — operational robustness (each gap cost a parked run = attention + tokens); two items are code
**Est-files:** fleet/RUNBOOK.md, fleet/drive-one.mjs (new), fleet/drive.mjs, fleet/tests/test_drive_one.mjs (new), CLAUDE.md
**Notes:** parked at gate 2026-08-25 (operator narrowing): defer: after run-9 / W2 — fleet live-unproven without the Max token (#208); keep 0.2.18 to the distill slate — SPLIT at planning. (a) items 6+7 are CODE → CLUSTER A: committed `fleet/drive-one.mjs <plan> <runId> [--port --db-dir --evidence-dir --cpu --memory]` reading the token file itself (replaces the retyped fleet-drive-one.tmp.mjs at RUNBOOK:149-181), plus an optional trace(cmd,result) hook recorded to detail.exec[]/detail.tunnel (drive.mjs has no trace hook). (b) doc gaps → CLUSTER C, one rewrite of the 'Golden VM build' + 'Live W1 run' sections with the real commands from the #189 comments: placeholder clone URL (:35), `claude plugin install` is not a real command (:40) → marketplace add + install --scope user, nodesource, pytest, git identity, settings.json creation shape (:75-78 only edits), warm-until-cmp-no-op loop, fresh-clone probe, orchestrator `ssh-key add --tag=fleet`, run-on-orchestrator not repo root (:104,:145), `nohup … </dev/null`, `billing usage` quota preflight before multi-runner drains; plus #208's shakedown paragraph (a fleet change is done at one live-green on the smoke plan vs the run-7/8 baseline, recorded as gate-read-run-N.json in evals/frontier/results/) and a one-line CLAUDE.md fleet-entry addendum; plus #211/#212 RUNBOOK lines. Auth section (:53-94) + tunnel/evidence (:184-202) already landed (dd36eb9, df8133d). If #217 is resumed, its doctor/onboarding should OWN the golden-build section and this shrinks to the run procedure — decide ordering before writing.

### #215: fleet: pull `stat` + credits-usage per sandbox BEFORE teardown (#197 evidence) — drawn vCPU/mem for sizing, credit spend as a gateway-regression canary
**State:** parked
**Score:** 5.5 — token efficiency (credits canary for the ANTHROPIC_API_KEY-beats-OAuth regression that burned ~$5/run through run-8) + W2 sizing data for the §W1c constants
**Est-files:** fleet/drive.mjs, fleet/tests/test_drive.mjs, fleet/RUNBOOK.md
**Notes:** parked at gate 2026-08-25 (operator narrowing): defer: after run-9 / W2 — fleet live-unproven without the Max token (#208); keep 0.2.18 to the distill slate — CLUSTER B first, AFTER #212 settles evidenceDir. Small, additive, best-effort under the existing logPullTimeoutMs bound at the pullLogsOnce hook (drive.mjs:107-135): write <evidenceDir>/stat.json + credits.json before destroySandbox, surface detail.sandboxStat (peakCores/meanCores/peakMemBytes — say peak is a floor estimate: stat samples every 10 min → 2–3 points per 25-min run) + detail.creditSpendUsd, and push a detail.errors entry when credits are non-zero (the canary assertion, not a page). Never fatal, never blocks teardown (billing-clock rule). Stubbed-exec JSON parsing pins; real numbers need live runs (BLOCKED on the token file). Second independent spend-fault signal alongside #209's interim check.

### #216: fleet: pass sandbox cpu/memory/disk through provisionRun → `cp --cpu --memory --disk` so size is a plan-derived knob, not golden-bound
**State:** parked
**Score:** 5 — execution speed/width knob + cost (16-vCPU cycle-average bound from the run-8 finding); passthrough is unit-gateable, the sizing policy is not yet
**Est-files:** fleet/provision.mjs, fleet/drive.mjs, fleet/tests/test_provision.mjs, fleet/tests/test_drive.mjs
**Notes:** parked at gate 2026-08-25 (operator narrowing): defer: after run-9 / W2 — fleet live-unproven without the Max token (#208); keep 0.2.18 to the distill slate — CLUSTER B second. Build the PASSTHROUGH ONLY: flags appended to `cp` (provision.mjs:91) when given, golden size when absent (exec-seam pinned; test_provision.mjs equality pins move), and --cpu/--memory options on the committed driver CLI (#193 item 6). DEFER 'derive from the compiled plan's widest wave' until ≥1 sized run has sandboxStat evidence (#215) — the engine concurrency claim min(16, CPUs−2) is the issue's assertion, unverified. Sequence: cluster A (CLI) → #215 → #216. Add a `billing usage` quota preflight if cheap, else leave to #193/#217. Live proof BLOCKED on the token file.

### #209: readSessionTokens couples to Claude Code's transcript format (silent-undercount risk) — prefer the engine emitting its own token total
**State:** parked
**Score:** 5 — integration correctness of the spend authority (an under-counting cap looks like it works); interim check is cheap, the engine-emit direction rests on an unverified premise
**Est-files:** fleet/shim-main.mjs, fleet/tests/test_shim_main_tokens.mjs, fleet/drive.mjs
**Notes:** parked at gate 2026-08-25 (operator narrowing): defer: after run-9 / W2 — fleet live-unproven without the Max token (#208); keep 0.2.18 to the distill slate — Build ONLY the defensive interim in CLUSTER A: readSessionTokens (shim-main.mjs:221-285) returns {total, files, subagentDirs}; the shim flags (spend row + status detail) when a multi-task plan yields zero subagent transcripts or the file count drops between samples; the driver surfaces it in detail.errors so reported==ledger can no longer hide a format shift. PARK the engine-emit direction as a research question — grep finds NO usage/output_tokens/totalTokens anywhere in waves.js or ultra_run.py, so 'the engine already knows the number' is an assumption; whether Workflow-dispatched agents expose usage to the harness is unverified. If yes → small report.json field and readReportTokens (:171, present, null-returning) takes over; if no → the transcript path is the only source and the interim check is the permanent defense.

### #198: engine: ultra_run --validate-knobs first attempt exceeds the engine's own 2-min Bash timeout (self-heals on retry)
**State:** parked
**Score:** 3 — token/time papercut; self-heals; rider on #192
**Est-files:** skills/ultrapowers/SKILL.md
**Notes:** parked at gate 2026-08-25: rider on #192 (one SKILL.md line) — reopen only if #192 is struck — RIDER on #192 (same suite-time root cause), or a trivial inline one-liner exempt from ceremony. validate_knobs (ultra_run.py:168-262) already has an internal 1800 s timeout at :255; only the caller's Bash tool timeout (default 120 s → exit 143) is wrong. Fix = one line in SKILL.md:96-104 instructing a Bash timeout sized to bootstrap+suite (600000 ms max) or run_in_background for the validate call. Not the rubric-pinned span. Strike or park here if #192 carries it.

### #208: fleet is unit-green but live-unproven by construction — make a live-canary shakedown a standing gate before trusting fleet changes
**State:** parked
**Score:** 4 — code quality thesis verbatim ('every claim gated by something it cannot touch'); one paragraph, not a build; rider on #193 docs
**Est-files:** fleet/RUNBOOK.md, CLAUDE.md
**Notes:** parked at gate 2026-08-25: rider on #193 cluster C (shakedown paragraph + CLAUDE.md addendum) — reopen only if #193 is struck — RIDER on #193 cluster C (doc pass). The manual instance happened (run-8, e8fb032) but no 'shakedown'/'canary' text exists in RUNBOOK or CLAUDE.md. Deliverable = one RUNBOOK paragraph (a fleet change is done at one live-green on docs/superpowers/plans/2026-08-21-fleet-w1-smoke.md against the run-7/8 baseline — spend 44.6k–47.2k, ~25 min — recorded as gate-read-run-N.json in evals/frontier/results/) + a one-line CLAUDE.md fleet-entry addendum ('changes here never require a plugin release' is silent on live proof). Do NOT build a scheduled canary drain (W2c/W2d; no token file to run it). Doctrine consequence: fleet plans gate NEEDS_ACK by construction — operator ack at the gate is the licensed path, never a reason to soften the gate (#204). Strike or park here if #193 carries it.

### #188: audit_run.py: add resolver entry to ROLE_MARKERS so resolver transcripts stop classifying as 'unknown'
**State:** parked
**Score:** 1 — absorbed by #224 (strict subset); verify-and-close on #224's first commit
**Est-files:** skills/ultrapowers/scripts/audit_run.py, skills/ultralearn/scripts/harvest_runs.py, tests/test_audit_run.py
**Notes:** parked at gate 2026-08-25: absorbed by #224 (first task, `close #188` in that commit) — reopen only if #224 is struck — ABSORBED INTO #224 — do not plan separately. One tuple ('You are a merge-conflict resolver','resolver') at audit_run.py:29-42 (phrase at wave-merge.md:222 / baked waves.js:634) + 'resolver' in harvest_runs.py ENGINE_ROLES (:23) + one classify test; `close #188` in #224's first commit. If #224 slips a cycle, ship alone as a trivial one-liner exempt from ceremony. Park at gate (record), reopen only if #224 is struck.

### #189: Width W1: one remote run end-to-end (fleet/ orchestrator + store + shim + golden VM)
**State:** parked
**Score:** 1 — verify-and-close; W1 fully delivered and proven live three times; no build
**Est-files:** 
**Notes:** parked at gate 2026-08-25: VERIFY-AND-CLOSE — W1 delivered and proven live runs 6/7/8; close on GitHub with the commit chain; W2 gets its own umbrella — VERIFY-AND-CLOSE, never a drain entry. All four §W1 deliverables merged 263f559 and proven live runs 6/7/8: Task 10 O1 GREEN 1391c23 (record evals/frontier/results/2026-08-21-width-w1-gate.md); #190 item 1 9d1929b (run-7 spend 44571==44571); run-7 FLOOR + §W1c/W1d constants deferred to W2 by operator call a8eb1f1; #196/#197 df8133d; run-8 gate-green e8fb032 (47171==47171); #213 Max-subscription auth dd36eb9. Every residual has its own issue (#190–#193, #196, #197, #211, #212, #215, #216, #217). The only unreflected text is the constants paragraph — W2 scope by decision (RUNBOOK:231-245). Close with the commit chain; give W2 (spec §Phase W2 :212-266) its own umbrella issue rather than reusing this one.

### #191: fleet W1: the shim greens only on a bare PASS gate verdict, so any honest deferred:external ack parks the run
**State:** parked
**Score:** 5 — autonomy + integration correctness, but bounded by #204 (never make the gate greener by making it less honest); a status-vocabulary/spec decision, not a patch — recommend PARK to W2 design
**Est-files:** fleet/shim-main.mjs, fleet/drive.mjs, fleet/orchestrator.mjs, fleet/RUNBOOK.md, docs/superpowers/specs/2026-08-21-width-program.md
**Notes:** parked at gate 2026-08-25: W2a/W2c design decision (needs-ack status vs sweep filter) bounded by #204; reopen at W2 planning after cluster A's receipt scoping — Recommend PARK (the issue itself says 'belongs in W2's design, not a W1 patch'). readGateGreen (shim-main.mjs:298-300) returns verdict==='PASS' only. Option (a) a new terminal status (needs-ack) that publishes receipts and counts toward O1 while carrying the ack VERBATIM to the attention surface (#182 variant C park cards) = a W2c decision; option (b) docket-sweep filter = W2a. Constraint from #204: the ack stays TOLD, only its recording location moves — no auto-ack. If planned, cluster A's receipt-scoping work (#190) is a prerequisite (same readGateGreen/findGateReceiptFile seam). Live proof needs a plan with an intrinsic deferred ack (runs 4/5 pattern) — blocked on the token file. Reopen at W2 planning.

### #217: fleet: first-run operator onboarding — guided configuration of exe.dev account, credentials, golden/orchestrator, and the Max-subscription token mechanism
**State:** parked
**Score:** 5 — autonomy/operator attention, but audience n=1 today and the brainstorm was parked by the operator; recommend PARK with a narrow doctor seed
**Est-files:** fleet/doctor.mjs (new), fleet/tests/test_doctor.mjs (new), fleet/RUNBOOK.md
**Notes:** parked at gate 2026-08-25: operator-parked brainstorm (persona/form factor/plugin-facing); fleet/doctor.mjs seed remains an opt-in — Recommend PARK until the operator resumes the brainstorm (persona, form factor skill-vs-script, automation depth, and whether fleet/ becomes plugin-facing — contra CLAUDE.md 'not plugin machinery' — are all theirs). The docketable SEED needing no design decision: a machine-readable fleet/doctor.mjs posture checklist over the exec seam (idempotent {check, ok, detail} rows, exit non-zero on red: exe whoami, billing plan/usage, orchestrator key tag, token file 0600 + sk-ant-oat prefix without echo, golden settings.json shape/no ANTHROPIC_*, plugin list enabled, workflows cmp, fresh-clone probe, git status clean, known_hosts drift). It is the verify half the issue calls highest-value, answers #193's posture gaps, and is the gate a #208 shakedown runs first — its first live output would be 'token file missing', the current blocker. Accept as 'doctor seed only' if the operator wants a build now.

### #187: Recalibrate contend-big: reviewer bar now exceeds the fixture's test engineering (2x fix-loop-exhausted on fixture-test weaknesses)
**State:** parked
**Score:** 4 — code quality (the fixture is the fold A/B's instrument) and a Phase-3 prerequisite, but eval-campaign-shaped with live spend and no consumer scheduled; recommend PARK
**Est-files:** evals/fixtures/contend-big/plan.md, evals/fixtures/contend-big/acceptance/, evals/fixtures/contend-big/project/tests/test_registry.py, evals/ab_runner.py, evals/frontier/results/
**Notes:** parked at gate 2026-08-25: eval-campaign-shaped (re-shape → floors → re-seal → counted cells, live spend); pull when Phase 3 or a scheduled A/B needs a counted contend-big cell — Recommend PARK until something needs a counted contend-big cell (Phase 3 kickoff, or an A/B that #229/#232/#230 actually schedule). Not drain-able unattended: acceptance = re-shape → re-verify implementer floors per spec §1e (floors are counted, never assumed; T14 took 8 calibration attempts; floors drifted 25–35% in 5 days) → re-seal → counted cells (~27 min, ~$13 each, ≥2 runs since calibration = means not floors). When pulled: (1) re-shape only the plan task text (non-alphabetical actors for top_actors at plan.md:118/390, explicit match= for every raise; test_registry.py:40 bare pytest.raises) so acceptance/ and the seal 4d131df61152 shared byte-identical with contend-prod (tests/test_fixture_seals.py:10) stay untouched if possible — else change both together explicitly; (2) one uncounted floors run read as means; (3) record in evals/frontier/results/. Re-sealing USES seal_hash.py/collect_seal.py (FROZEN — use, don't modify). Do NOT build a 'recalibrate on reviewer upgrade' mechanism — the standing rule is one doctrine sentence in spec §1e or CLAUDE.md, rideable on any doc PR.

### #207: Swarm viewer: ground the display in the plan (tasks, waves, plain-language events)
**State:** parked
**Score:** 3 — presentation-layer vision; low quarter alignment (runs against #200 'silence is healthy'); items 2–3 need an observable the viewer's honesty contract forbids inferring; recommend PARK pending brainstorm
**Est-files:** skills/ultrapowers/viewer/swarm_template.html, skills/ultrapowers/scripts/swarm_watch.py, skills/ultrapowers/scripts/render_viewer.py, tests/test_viewer.py, tests/test_swarm_agents.py, tests/test_swarm_wiring.py
**Notes:** parked at gate 2026-08-25: needs brainstorm → spec (verdict observables vs viewer honesty contract; rides #222's per-round artifacts); items 1+4 remain a cheap opt-in — Recommend PARK (needs brainstorm → spec). Partially landed since June (9903f1f, cd73986): station→task mapping, role:task labels, per-station [data-state], text wave readout. Missing is presentation. Items 2–3 (review verdicts / fix-round outcomes as events) need either transcript parsing the viewer README 'Observed vs Inferred' contract must declare, or an engine-written per-task verdict file — which rides #222's per-round artifacts, not a viewer PR: a design decision. Brainstorm settles (1) git-observed-only vs declared-inferred vs engine receipts; (2) acceptance form (manual eyeball vs pinned render_viewer/swarm_watch data contracts — viewer .mjs specs are not in CI or the gate). Cheap win WITHOUT the brainstorm if the operator wants it: items 1+4 only as one small suite-gated task (label `T<id> · <title>` — title already in DAG.tasks[].title via render_viewer.py:83; embed task body in build_dag :68-85; pin both in test_viewer.py). Sequence any viewer work after #222.
