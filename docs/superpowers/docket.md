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
**Notes:** Shape assumption on runtime-minted ids (wf_<hex8>-<n> today). Closure direction the issue names: derive the recorded id from the launch response rather than parsing branch names — prefer that derive-don't-parse form at planning. CLUSTER: plan with #111 + #109 as one small post-#108 sweep-hygiene plan (inline engine). PARKED 2026-08-06 at sweep iteration 9 (operator-approved): both closure directions land in FROZEN ultra_gate.py for a zero-occurrence hypothetical (runtime mints wf_<hex8>-<n>; single-segment ids never observed), with verified loud mitigation (left-behind accounting at sweep_worktrees.sh:319-341 enumerates on-disk wf_* unconditionally; --audit re-surfaces by age). REOPEN TRIGGER: an observed runtime id the WF_RUN_RE pattern misses — it will show in the approve receipt's left-behind list. Spec: docs/superpowers/specs/2026-08-06-sweep-hygiene-smalls-design.md.

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
**State:** executed
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
**State:** executed
**Score:** 9.5 — the deletion-led cycle's centerpiece: measurement-loop integrity AND genuine simplification (north-star simplest-codebase clause)
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, tests/test_harvest_runs.py
**Plan:** docs/superpowers/plans/2026-08-09-harvester-attribution-v2.md
**Engine:** subagent-driven
**Notes:** Distill 2026-08-09 headliner; supersedes #121 (closed). Sev-3 field evidence at 0.1.15 (home bundle: fixture stamps registered as runs, gateReport = fixture literal, 5/5 real receipts lost). Fix IS a deletion: stamps from Workflow tool_use args only; receipts/gateReport from per-stamp disk reads only (last-write-wins); multi-launch slice envelope; carries #121's hygiene items. canaryMetric: home-bundle receipt accuracy 0/5 → 5/5. SEQUENCE FIRST with #104 (already accepted) — one deletion pair, per operator directive. Issue body carries the full design — short brainstorm.

### #127: redirect_args.py derives the integration branch from the argsFile
**State:** executed
**Score:** 7 — operator-attention efficiency on the field-validated micro-redirect lane; 3/3 sessions stumbled on first call
**Est-files:** skills/ultrapowers/scripts/redirect_args.py, tests/test_redirect_args.py, skills/ultrapowers/SKILL.md
**Plan:** docs/superpowers/plans/2026-08-10-redirect-lane-derivation-pair.md
**Engine:** subagent-driven
**Notes:** Tiny structural fix: derivation order argsFile.integrationBranch → --integration-branch → gate-receipt.json → loud error. One new test. SKILL micro-redirect bullet drops the gate-receipt clause. Drain-sized.

### #120: Worktree creation fails closed on an existing path (narrowed scope)
**State:** executed
**Score:** 7 — integration correctness; 2nd field occurrence (wrong-worktree dispatch blocked a foreign run); the cycle's ONE additive guard
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/wave-merge.md, tests/
**Plan:** docs/superpowers/plans/2026-08-10-worktree-create-fail-closed.md
**Engine:** inline
**Notes:** OPERATOR-NARROWED at distill: ONLY the single fail-closed check at worktree creation for non-resume launches (path exists → loud error naming path + sweep remedy). NOT in scope: HEAD-equals-base assert (ancestry check owns that symptom, proven in field), audit surfaces, new error taxonomy. Harness JS → .mjs sim + sentinel + anti-drift obligations.

### #122: Docket tooling seams from the drain shakedown
**State:** executed
**Score:** 6.5 — every future drain re-hits all three seams (Acceptance grammar guidance, compile_docket clusters, drain-mode run-ID recording); autonomy robustness
**Est-files:** skills/ultradocket/SKILL.md, skills/ultradocket/scripts/compile_docket.py, tests/test_compile_docket.py
**Plan:** docs/superpowers/plans/2026-08-10-docket-tooling-seams.md
**Engine:** subagent-driven
**Notes:** Three parts: (1) sweep step-3/5 guidance names the exact compiling Acceptance form (prose; grammar itself is eval-gated compiler vocabulary — do NOT widen ACCEPT_SUITE); (2) compile_docket learns PLAN-TOGETHER cluster semantics (unit = unique plan, entries advance together — the drain's deduped-view logic, promoted); (3) drain-mode launch-ID recording so teardown's sweep set derives instead of being hand-reconstructed. Self-contained dev tooling, suite disposition.

### #128: Standing pre-authorization at NEEDS_ACK, recorded
**State:** queued
**Score:** 6 — consent-record honesty at the single human gate; 3 field observations; operator-decided direction (sanction-with-recording)
**Est-files:** skills/ultrapowers/SKILL.md, skills/ultrapowers/references/report-format.md
**Plan:** docs/superpowers/plans/2026-08-10-standing-preauth-recording.md
**Engine:** inline
**Notes:** CAUTION at planning: the approve receipt is written by FROZEN ultra_gate.py — unless the eval route is taken, scope the recording to the orchestrator layer (gate presentation + report + SKILL prose: print the ack list being consumed under the standing grant with its verbatim instruction + turn), never an ultra_gate.py edit. Also: verify the harvester/slicer preserves short human turns before treating the salvage-no-ack observation as real (check while implementing).

### #123: Engine residuals from the 2026-08-07 drain
**State:** triaged
**Score:** 5 — fail-safe residue, mixed bundle; cherry-pick the unfrozen items
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/wave-merge.md, tests/
**Notes:** Item 1 (critic dual detach authorities) = plan-level prompt-design decision, fails safe today; item 2 (CONFLICT-path token sha) touches FROZEN gate_check — eval route or park; item 3 (unpinned SKILL finalize wiring) conflicts with the anti-pin doctrine — prefer a structural closure or drop; item 4 smalls. Suggest scoping a plan to items 1+3-structural only, or parking until a field incident.

### #124: Gate residuals from #117/#105
**State:** triaged
**Score:** 4 — cosmetic/coverage smalls on shipped fixes
**Est-files:** tests/test_run_acceptance.py, skills/ultrapowers/SKILL.md
**Notes:** --baseline-under-symlink test, platform-split mktemp mechanism comment, SKILL --test-cmd loud-fail note. All cheap; frozen files untouched (tests + docs only). Could ride any future inline unit as a tail task.

### #131: Redirect/Salvage relaunch inherits stale heads/ slots from the prior launch
**State:** executed
**Score:** 8 — integration correctness at the derive-don't-record authority layer; operator-designated priority class this cycle
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/scripts/redirect_args.py, skills/ultrapowers/references/wave-merge.md, tests/
**Plan:** docs/superpowers/plans/2026-08-10-redirect-lane-derivation-pair.md
**Engine:** subagent-driven
**Notes:** Field 2026-08-10 (redirect wf_e5afc7c1-dd4): redirect relaunch left a stale heads/wave-4 slot 10h older than the redirect's real final head; the completeness critic's baked detach-target rule ('highest-numbered wave-<n> slot') would have detached onto the pre-redirect tree — only the critic's mtime judgment saved it, where the sidecar convention was supposed to be authority. STRUCTURAL fix, not a guard (does not consume the cycle's one-additive-guard slot): clear heads/ on relaunch or namespace slots per wf-run so a stale slot is inexpressible. Shares the relaunch surface with #127 — consider PLAN-TOGETHER at sweep (one plan, redirect-lane hardening pair). Harness JS changes ⇒ .mjs sim + pass sentinel + anti-drift re-bake obligations.

### #129: Preflight passes but the run is unexecutable when /ultrapowers launches from a worktree-isolated session
**State:** triaged
**Score:** 6.5 — real sev-3 field block (~630K tokens burned) but n=1 and the one-additive-guard slot this cycle is already committed to #120
**Est-files:** skills/ultrapowers/scripts/ultra_run.py, skills/ultrapowers/SKILL.md, tests/test_ultra_run.py
**Notes:** Field 2026-08-09 (wf_fe05bc69-a22): EnterWorktree session passed all 12 preflight stages, then every merge/reconcile/critic git command against the integration worktree was hard-refused by the session Bash guard; wave 1 blocked, all waves cascade-blocked, 0/5 merged. GUARD-SLOT CONTEST decided at triage per machinery-earned-by-recurrence: #120 keeps the slot (2 field occurrences vs this n=1). Held at triaged with prose mitigation (worktree-session-selfhost-block memory + issue text name the remedy: run from repo root). PROMOTE TRIGGER: a second field occurrence, at which point choose between fix option 1 (fail-closed preflight stage, cheap guard) and option 2 (cut integration worktree inside the session worktree's own .claude/worktrees/ — structural, larger blast radius: sweep globbing, gate paths).

### #130: Review packet can point at a commit no branch contains — retry trap after a contaminated first attempt
**State:** triaged
**Score:** 5.5 — path-hygiene/integrity on run exhaust; agents defended correctly twice, so latent not active
**Est-files:** skills/ultrapowers/scripts/review-package.sh, skills/ultrapowers/harnesses/waves.js, tests/test_review_package.py
**Notes:** Field 2026-08-09 (wf_fe05bc69-a22): review-d796ce6..bb969e6.diff (211KB) named a contaminated orphan commit — no branch contained it, its diff deleted the plan/spec under execution; the clean redo was the real branch tip. Merge agent AND completeness critic independently caught it; a packet-trusting retry would have merged the wrong tree. Fix direction is derive-don't-record: name/validate packets by branch tip, not recorded sha pair (issue option b — redo overwrites predecessor — is the simplest inexpressible-shape). Also carries a secondary question: how a first attempt committed unrelated-work files at all (implementer worktree hygiene). Normal backlog per operator.

### #134: Gate approve moves the shared primary checkout while other sessions may be working in it
**State:** triaged
**Score:** 4.5 — low severity (git checkout restores), confusing failure; observed from the receiving end this cycle
**Est-files:** skills/ultrapowers/scripts/ultra_gate.py, skills/ultrapowers/SKILL.md, CLAUDE.md
**Notes:** Field 2026-08-09/10: session A's ultra_gate.py --approve checked out integration+main in the shared primary checkout while session B (lock-waiting, legitimately on another branch) was mid-preflight — B's branch silently became main, compile failed FileNotFoundError. RUN_LOCK serializes runs, not sessions, so lock-waiting sessions are now a real pattern. Issue's own options: (a) loud advisory + marker file surfaced by later preflights, (c) document the serialize-SESSIONS-during-approve rule — both cheap; (b) refuse-on-detected-activity is over-machinery. CAUTION at planning: ultra_gate.py is FROZEN periphery — scope any recording to the orchestrator/SKILL layer or marker-file sidecar unless the eval route is taken. Normal backlog per operator.

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
