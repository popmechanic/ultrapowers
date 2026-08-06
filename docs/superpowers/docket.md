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
**Notes:** SPLIT at triage per the issue's own structure. Drainable: (1) --check argparse help understates the --run-dir exclusion, (2) prune honest-receipt failure branch untested (seed an undeletable dir; assert failed name absent from return, named in scratch-hygiene detail), (3) sim engineAuthoredSpan guard blind spot — derive the span by subtracting plan-authored blocks, not truncating at first marker (harness-sim change: pass sentinel discipline applies), (4) SKILL.md Salvage/Redirect bullets must say relaunch args = spread the receipt's argsFile (mandatory pluginRoot/runDir). NOT drainable: the three live-run verification checkboxes — they close only by observing the first real /ultrapowers run after 0.1.12 re-resolves (/plugin + new session); keep the issue open for those after items 1–4 land.

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
**Notes:** parked at gate 2026-07-27: frozen seal-author brief + sealed opt-in since 0.1.0, near-zero incidence; revisit on fresh sealed-run evidence — All cited evidence (false-red clusters from guessed module paths) predates 0.1.0's demotion of sealed to opt-in; current traffic is ~100% suite disposition, where this defect class cannot occur. The exam-side half requires editing the frozen seal-author brief — only an evals/ab_runner.py-measured regression unfreezes it, and no sealed-run evidence has accrued since. Park until a real sealed-plan cycle produces fresh evidence; the spec-side half (ultraplan pin rule) could proceed alone but has little value without the exam-side binding.

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
**State:** queued
**Score:** 9 — integration correctness (Q-priority 1) at the merge boundary; a fabricated SHA silently defeats the ancestry safety net
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/wave-merge.md, tests/
**Plan:** docs/superpowers/plans/2026-08-06-derived-task-heads.md
**Engine:** ultrapowers
**Notes:** Distill 2026-08-06: 11 findings/9 runs, two fresh at 0.1.13/0.1.14 — recorded 40-char task heads with a valid 7-char prefix and fabricated tail (merge/report agent hand-transcribes SHAs). Derive-don't-record: harness stamps heads from git rev-parse output mechanically. Harness JS change → .mjs sim + pass sentinel required; prompt source edits per anti-drift rule. Does NOT touch the frozen gate (the optional rev-parse-verify-on-read follow-up is explicitly out of scope).

### #113: ultralearn: session-scoped receipt attribution — match receipts/terminus/audit to the session that launched them
**State:** queued
**Score:** 8.5 — protects the measurement loop every distill and every frozen-periphery unfreeze route trusts; completes #98 at multi-launch/drain scale
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, tests/test_harvest_runs.py
**Plan:** docs/superpowers/plans/2026-08-06-harvester-session-attribution.md
**Engine:** subagent-driven
**Notes:** Distill 2026-08-06: largest ledger family (59 findings/50 runs), fresh sev-2s AT 0.1.13 post-#98: approved run bundled as BLOCKED; 9-plan drain bundled as single-plan NEEDS_ACK with a receipt stamped 4 days later; audit covers launch 1 of 5; slice tails contaminated. Fix: match receipts to wf run IDs/stamps the session launched, union audit across launches, terminus from matched receipt + transcript approval evidence, multi-plan bundle shape, slice trimmed to run envelope. PLAN TOGETHER WITH #118 (deletes the disk-fallback sweep this replaces).

### #112: Structural: plan-defect judgmentCall lane — disclosed fixes of plan-transcribed defects instead of gate redirects
**State:** accepted
**Score:** 8.5 — autonomy + token efficiency: the dominant redirect generator (25 findings/19 runs); redirect rounds are the main post-launch cost
**Est-files:** skills/ultrapowers/references/reviewer-prompts.md, skills/ultrapowers/harnesses/waves.js, skills/ultraplan/SKILL.md, skills/ultrapowers/references/plan-markers.md, skills/ultrapowers/references/report-format.md
**Notes:** Distill 2026-08-06 headliner. Extends the proven judgmentCalls channel: implementer/reviewer may fix plan-verbatim defects with a mandatory disclosed plan-defect judgmentCall; reviewer verifies; gate report lists plan-divergence calls in one section; plan-defect becomes a first-class note type so the canary can split plan-authored from implementer defects. canaryMetric: redirect-round rate + gate-routed plan-defect count. Carries a prose RIDER: ultraplan authoring line — agent-CLI spikes must isolate CLAUDE_CONFIG_DIR (sev-3 false-memory contamination, first occurrence → prose only). Prompt re-bake + pin tests apply.

### #115: Sanction the micro-redirect lane: narrow-resume pattern, deterministic relaunch-args helper, head-match re-baseline
**State:** accepted
**Score:** 8 — token efficiency + audit-chain honesty: 22 findings/14 runs; head-match validated live but approved runs fossilize as BLOCKED receipts
**Est-files:** skills/ultrapowers/SKILL.md, skills/ultrapowers/references/wave-merge.md, skills/ultrapowers/scripts/, skills/ultrapowers/scripts/gate_check.py, tests/
**Notes:** Distill 2026-08-06. Three parts: (1) document narrow-files+drop-tier resume as the sanctioned micro-redirect (field-proven by hand), (2) deterministic helper: prior receipt + findings list → relaunch args (removes fumble-prone LLM file surgery), (3) operator-authorized inline commits re-baseline head-match with attribution instead of leaving stale BLOCKED receipts. CAUTION: gate_check.py is frozen periphery — scope the re-baseline as recording attribution, never weakening the check; if that can't be done cleanly, split part 3 out at planning. canaryMetric: redirect-round rate + BLOCKED-receipts-on-approved-runs (should hit 0).

### #107: eval kit: prepare_engine's marketplace registration clobbers the operator's real 'ultrapowers' marketplace
**State:** accepted
**Score:** 7.5 — engine-mutates-operator-environment family (same family as #99, scored 7); sev-3 live incident, predicted verbatim by the run's own deferred ack
**Est-files:** evals/ab_runner.py, tests/
**Notes:** Filed 2026-07-28 from the live /plugin breakage; distill 2026-08-06 appended: the #96 run's deferredVerification named the exact side effect pre-release and nothing acted on it. Fix: eval cells get the same isolation discipline as the engine (namespaced/temp marketplace name or isolated CLAUDE_CONFIG_DIR, never the production manifest name). Consider the general lesson at planning: deferred acks naming operator-environment mutation should trigger pre-release mitigation.

### #116: Preflight baseline check: smoke-run the stamped testCmd in the validate-knobs worktree before launch
**State:** accepted
**Score:** 7.5 — the cycle's ONE budgeted additive guard (9 findings/9 runs): moves the red-baseline decision to the operator pre-launch
**Est-files:** skills/ultrapowers/scripts/ultra_run.py, tests/test_ultra_run.py, skills/ultrapowers/SKILL.md
**Notes:** Distill 2026-08-06. Reuses the --validate-knobs throwaway worktree: run the stamped testCmd once pre-launch; red baseline → explicit operator decision (fix drift / accept named off-plan repair / launch anyway with reds recorded inherited); also catches crashing auto-detected testCmds inside preflight (subsumes the segfault-teardown case). Field evidence: reconcile agent committed into a plan-protected path mid-run because baseline was red; gate had to manually exonerate a pre-existing flake. Receipt gains a baseline verdict field.

### #117: Gate false-red: canonicalize the acceptance worktree path (macOS /var symlink)
**State:** accepted
**Score:** 7 — gate-manufactured deterministic false-red (sev 3, A/B-proven in field); FROZEN periphery with the unfreeze route named
**Est-files:** skills/ultrapowers/scripts/run_acceptance.sh, tests/, evals/
**Notes:** Distill 2026-08-06: mktemp on macOS returns /var→/private/var symlinked paths; path-identity-sensitive toolchains (native tsc) see duplicate modules → 3 identical BLOCKEDs on an untouched file; same commit green on canonical path. Fix: pwd -P canonicalization at BOTH mktemp call sites. Unfreeze route per #96 precedent: eval/test fixture reproducing false-BLOCKED on a symlinked path, counter 1→0. PLAN TOGETHER WITH #105 (same file, same unfreeze ceremony — false-red + false-green pair).

### #105: Empty-command guards are truthiness/-z based: whitespace-only testCmd still buys a false green
**State:** accepted
**Score:** 6.5 — a false GREEN at the gate outranks its size; proven by execution during the 2026-07-27 drain; small, both sides of the frozen boundary
**Est-files:** skills/ultrapowers/scripts/ultra_run.py, skills/ultrapowers/scripts/run_acceptance.sh, tests/
**Notes:** Filed by the drain's own critic (executed repro: --suite-gate --run '   ' → passed:true). ultra_run.py side (truthiness knob-drop) is unfrozen; run_acceptance.sh side is FROZEN — ride #117's eval-fixture unfreeze ceremony. Normalize/strip then validate non-empty; empty-after-strip refuses loudly on both sides. PLAN TOGETHER WITH #117.

### #103: #84 hardening follow-ups: pin the sweep instruction, test the detach↔approve coupling, close GUARD/prompt seams
**State:** accepted
**Score:** 6 — hardening seams on deletion machinery, all currently held by prose or nothing; named by the #84 build's own reviews
**Est-files:** skills/ultrapowers/SKILL.md, skills/ultrapowers/scripts/sweep_worktrees.sh, skills/ultrapowers/scripts/ultra_gate.py, skills/ultrapowers/harnesses/waves.js, tests/
**Notes:** Five seams from the #84 reviews (2026-07-27 drain). Note the machinery-earned-by-recurrence bar at planning: prefer structural closures (e.g. make approve sweep the integration worktree mechanically rather than pinning the SKILL.md sentence) over pin-tests of prose — the distill doctrine and #106 both push against new pins. Partial overlap with what the 0.1.14 live shakedown will prove; check each seam against #108's shipped behavior before planning. PLAN TOGETHER WITH #102 (its doc face).

### #118: Simplification: delete the harvester's disk-fallback receipt sweep once session-scoped attribution lands
**State:** queued
**Score:** 6 — mandatory deletion candidate of distill 2026-08-06; the fallback IS the contamination vector behind the misattribution family
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, tests/test_harvest_runs.py
**Plan:** docs/superpowers/plans/2026-08-06-harvester-session-attribution.md
**Engine:** subagent-driven
**Notes:** Strictly-down simplification, subsumed by #113's structural change. One-time audit first: how many cached bundles depended on the fallback and whether any of those attributions were correct. PLAN TOGETHER WITH #113 (one plan, fallback deleted in the same change that replaces it).

### #110: WF_RUN_RE requires ≥2 hyphen-separated id segments — single-segment runtime ids would go unrecorded
**State:** accepted
**Score:** 5.5 — hardening nit on the #108 leak-closure; mitigated today by left-behind accounting + audit re-surfacing
**Est-files:** skills/ultrapowers/scripts/ultra_gate.py, tests/
**Notes:** Shape assumption on runtime-minted ids (wf_<hex8>-<n> today). Closure direction the issue names: derive the recorded id from the launch response rather than parsing branch names — prefer that derive-don't-parse form at planning. CLUSTER: plan with #111 + #109 as one small post-#108 sweep-hygiene plan (inline engine).

### #102: docs: workflow-template.md contradicts shipped #84 behavior in three places
**State:** accepted
**Score:** 5.5 — the canonical authoring/re-bake reference misleads every future harness edit; cheap, pure docs
**Est-files:** skills/ultrapowers/references/workflow-template.md
**Notes:** Three pre-#84 descriptions of merge/completeness running on the session main checkout — now false (integration in a dedicated worktree). PLAN TOGETHER WITH #103 (same subject, doc face + hardening face).

### #111: sweep --audit: absurd --age-hours magnitudes overflow the threshold arithmetic (report-only)
**State:** accepted
**Score:** 5 — report-only blast radius, implausible input; found by the #108 adversarial reviewer
**Est-files:** skills/ultrapowers/scripts/sweep_worktrees.sh, tests/
**Notes:** 64-bit wrap inverts the age filter at --age-hours ≥ ~20 digits. Magnitude bound beside the existing digits-only case + one test. CLUSTER: plan with #110 + #109 (one inline sweep-hygiene plan).

### #106: Test-mass skeptical review: ~1,170 of the drain's 1,667 inserted lines are tests/sims — audit for ballast
**State:** accepted
**Score:** 5 — simplicity objective; the counterweight pass the complexity doctrine requires after a heavy drain
**Est-files:** tests/, skills/ultrapowers/harnesses/, docs/
**Notes:** Analysis-first: classify the drain's added tests (pins-of-pins, known-fragile triggers, meta-assertions) and propose deletions with evidence; deletions land behind the suite gate. Candidates enumerated in the issue by the drain's own reviews. Output may be small — a deletion PR plus keep-verdicts — which is success, not failure.

### #109: Stale waves.js comment: integration-worktree cleanup still describes the pre-#108 manual sweep call
**State:** accepted
**Score:** 4.5 — trivial comment fix, but a stale claim inside the engine misleads harness editors
**Est-files:** skills/ultrapowers/harnesses/waves.js
**Notes:** One comment. CLUSTER: plan with #110 + #111 (one inline sweep-hygiene plan). Mind the anti-drift rule if the comment lives in a baked span.

### #104: Subtraction candidate: retire the snapshot/restore family once #84 shakedown proves the checkout is never touched
**State:** triaged
**Score:** 4 — real subtraction, but its precondition (0.1.14 live-shakedown evidence that the checkout is untouched) has not been observed yet
**Est-files:** skills/ultrapowers/scripts/run_lock.sh, skills/ultrapowers/harnesses/waves.js, tests/
**Notes:** DO NOT ACCEPT THIS CYCLE unless the operator overrides: the closing event is the live shakedown this very docket run provides (its ultrapowers-engine entries run on installed 0.1.14). If the drain's runs show zero checkout mutation and clean sweeps, next cycle's triage promotes this to accepted with field evidence in hand.

### #119: Complexity-audit loop: adversarial trim review at spec approval + distill cluster-died retrospective
**State:** accepted
**Score:** 7 — operator-commissioned standing requirement; guards the complexity budget of every future change; prose-only build
**Est-files:** CLAUDE.md, skills/ultralearn/references/distilling-proposals.md
**Notes:** Spec ALREADY WRITTEN + committed (docs/superpowers/specs/2026-08-06-complexity-audit-loop-design.md) with its own first trim review adjudicated in-spec — planning sweep should go straight from that spec to a plan, no new brainstorm. Practice already adopted in-session for the 2026-08-06 sweep; this entry makes it durable. Two prose surfaces, no scripts, no gate changes. Accepted directly at creation by explicit operator commission (brainstorm 2026-08-06).
