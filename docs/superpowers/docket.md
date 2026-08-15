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
**Notes:** parked at gate 2026-07-27: frozen seal-author brief + sealed opt-in since 0.1.0, near-zero incidence; revisit on fresh sealed-run evidence — All cited evidence (false-red clusters from guessed module paths) predates 0.1.0's demotion of sealed to opt-in; current traffic is ~100% suite disposition, where this defect class cannot occur. The exam-side half requires editing the frozen seal-author brief — only an evals/ab_runner.py-measured regression unfreezes it, and no sealed-run evidence has accrued since. Park until a real sealed-plan cycle produces fresh evidence; the spec-side half (ultraplan pin rule) could proceed alone but has little value without the exam-side binding. || RE-TRIAGED 2026-08-14: sealed remains opt-in with near-zero incidence; no new exam-coupling instances in the 17-run sense pass. Stays parked.

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
**Notes:** Shape assumption on runtime-minted ids (wf_<hex8>-<n> today). Closure direction the issue names: derive the recorded id from the launch response rather than parsing branch names — prefer that derive-don't-parse form at planning. CLUSTER: plan with #111 + #109 as one small post-#108 sweep-hygiene plan (inline engine). PARKED 2026-08-06 at sweep iteration 9 (operator-approved): both closure directions land in FROZEN ultra_gate.py for a zero-occurrence hypothetical (runtime mints wf_<hex8>-<n>; single-segment ids never observed), with verified loud mitigation (left-behind accounting at sweep_worktrees.sh:319-341 enumerates on-disk wf_* unconditionally; --audit re-surfaces by age). REOPEN TRIGGER: an observed runtime id the WF_RUN_RE pattern misses — it will show in the approve receipt's left-behind list. Spec: docs/superpowers/specs/2026-08-06-sweep-hygiene-smalls-design.md. || RE-TRIAGED 2026-08-14: ultra_gate.py is FROZEN periphery (eval route only); mitigations (left-behind accounting, audit re-surfacing) hold; no field occurrence of single-segment ids. Held; no eval cell warranted.

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
**State:** triaged
**Score:** 5 — fail-safe residue, mixed bundle; cherry-pick the unfrozen items
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/wave-merge.md, tests/
**Notes:** Item 1 (critic dual detach authorities) = plan-level prompt-design decision, fails safe today; item 2 (CONFLICT-path token sha) touches FROZEN gate_check — eval route or park; item 3 (unpinned SKILL finalize wiring) conflicts with the anti-pin doctrine — prefer a structural closure or drop; item 4 smalls. Suggest scoping a plan to items 1+3-structural only, or parking until a field incident. || RE-TRIAGED 2026-08-14: after 31c43ad the remaining scope = item 2 (frozen gate_check.py CONFLICT-path sha - EVAL ROUTE ONLY per operator directive 2026-08-14, never a narrative fix; safe-direction residual, no field regression to reproduce => no eval cell this cycle) + item 4 porcelain/mode smalls (no field occurrence). Item 4d's closure corrected by entry #147. Stays triaged.

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
**Notes:** Field 2026-08-09 (wf_fe05bc69-a22): EnterWorktree session passed all 12 preflight stages, then every merge/reconcile/critic git command against the integration worktree was hard-refused by the session Bash guard; wave 1 blocked, all waves cascade-blocked, 0/5 merged. GUARD-SLOT CONTEST decided at triage per machinery-earned-by-recurrence: #120 keeps the slot (2 field occurrences vs this n=1). Held at triaged with prose mitigation (worktree-session-selfhost-block memory + issue text name the remedy: run from repo root). PROMOTE TRIGGER: a second field occurrence, at which point choose between fix option 1 (fail-closed preflight stage, cheap guard) and option 2 (cut integration worktree inside the session worktree's own .claude/worktrees/ — structural, larger blast radius: sweep globbing, gate paths). RE-TRIAGED 2026-08-10: #120's fail-closed worktree-creation guard SHIPPED in 0.1.17, so the contested slot is consumed and settled; operator re-affirmed the 2-vs-1 call this pass. Recommend PARK with the promote trigger (2nd field occurrence of an EnterWorktree-session launch block) rather than re-litigating at every triage; prose mitigation stands (run from repo root — worktree-session-selfhost-block memory + issue text). PARKED at gate 2026-08-10 per recommendation — stops per-pass re-litigation; the promote trigger above (2nd field occurrence of an EnterWorktree-session launch block) is the sole reopen condition. || RE-TRIAGED 2026-08-14: no second EnterWorktree-launch block; sense pass surfaced a COUNTEREXAMPLE (foreign run at ~0.1.15 completed a full engine lifecycle from a nested-worktree session, terminus approved+merged) - the recorded limitation may be narrower than 'any worktree session' (possibly specific to EnterWorktree Bash-guard binding). Stays parked; trigger unchanged; reconcile the counterexample if the trigger ever fires.

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
**Notes:** Field 2026-08-09/10: session A's ultra_gate.py --approve checked out integration+main in the shared primary checkout while session B (lock-waiting, legitimately on another branch) was mid-preflight — B's branch silently became main, compile failed FileNotFoundError. RUN_LOCK serializes runs, not sessions, so lock-waiting sessions are now a real pattern. Issue's own options: (a) loud advisory + marker file surfaced by later preflights, (c) document the serialize-SESSIONS-during-approve rule — both cheap; (b) refuse-on-detected-activity is over-machinery. CAUTION at planning: ultra_gate.py is FROZEN periphery — scope any recording to the orchestrator/SKILL layer or marker-file sidecar unless the eval route is taken. Normal backlog per operator. RE-TRIAGED 2026-08-10: occurrence #1 ⇒ prose lean — take option (c) now (CLAUDE.md/SKILL serialize-sessions-during-approve rule); the marker-file advisory (a) is machinery earned by a second collision. FROZEN caution stands: no ultra_gate.py edit outside the eval route. PARKED (struck) at gate 2026-08-10 under the complexity lens — weak candidate (score 4.5), prose-only value vs doc-mass cost; REOPEN TRIGGER: a second cross-session approve/checkout collision, which per recurrence doctrine also buys the marker-file advisory (option a), not just the prose rule. || RE-TRIAGED 2026-08-14: no second cross-session approve/checkout collision in the 17-run sense pass; stays parked on its reopen trigger.

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
