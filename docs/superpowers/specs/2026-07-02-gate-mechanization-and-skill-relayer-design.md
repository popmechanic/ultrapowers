# Gate Mechanization and SKILL.md Re-layer — Design

**Date:** 2026-07-02
**Origin:** the Fable 5 full code review of 0.0.29 (four-reviewer audit; findings verified live). Operator approved the Tier-1 + items-5–7 scope, quality-first tie-breaks.
**Acceptance disposition:** `suite` — engine/skill/script work on ultrapowers itself; the committed suite, drift pins, and per-task review are the verification.

## Problem

The engine (`waves.js`), compiler (`compile_plan.py`), and gate runner (`run_acceptance.sh`) are deterministic and hardened. The layer between them is not: `ultrapowers/SKILL.md` is 7,141 words / 517 lines (official guidance: <500 lines, 1.5–2k-word ideal), and its Step-5 gate is ~10 safety-critical MUST-checks executed from LLM recall. Dependency blocking works only if the orchestrator remembers to pass `args.edges`. The interactive gate trusts the report's LLM-self-reported `tests.passed` for `suite`/unmarked plans, while a deterministic runner (`run_acceptance.sh --suite-gate`) already exists and is used by the docket drain. Two verified compiler bugs can corrupt or refuse runs. A tail of ~8 tests asserts nothing real. ~600 KB of regenerable ultralearn ledger output is git-tracked.

Design rule applied throughout: **move authority from prose to exit codes; move maintainer rationale out of operator instructions.** Every new script fails closed and emits a JSON receipt.

## Component 1 — Compiler fixes (`compile_plan.py`)

**1a. Uppercase-extension paths.** `_is_pathlike` currently drops slashless tokens with uppercase extensions (`Config.YAML`) from write-sets; two tasks modifying the same such file compile into the same wave with no edge (verified). New rule: a trailing extension matching `[a-z0-9]{1,8}` case-insensitively counts as a real extension when the extension is **all-lowercase or all-uppercase**; mixed-case (`schema.User`, `Foo.Bar`) stays an identifier, dropped and surfaced as today. Erring toward "path" is safe: a false edge costs parallelism, a dropped write corrupts a merge.

**1b. Heading-net false positive.** The any-level `Task <token>:` alternative in `near_head` refuses whole plans over prose headings like `## Task tracking: overview` (verified), with a hint that misdirects. New rule: that alternative flags only tokens that look like task ids — containing a digit, or ≤3 characters — so `## Task 2:` and `## Task A3:` still abort loudly while `## Task tracking:`, `## Task list:`, `## Task ordering:` compile. Residual ambiguity (`## Task ids:` still flags) is documented in the error text.

Both fixes land with regression tests in `tests/test_compile_plan.py`, including: same-file `Config.YAML` collision serializes; `schema.User` in a Files entry still drops with a near-miss note; each reproduced prose heading compiles; `## Task 2:` still refuses.

## Component 2 — `scripts/gate_check.py` (new)

The mechanical Step-5 checks, with exit-code authority. The orchestrator first saves the workflow's report JSON verbatim to disk (new durable artifact: `.claude/ultrapowers/report-<stamp>.json`), then runs:

```
python3 gate_check.py --run-id <runId> --branch <integrationBranch> --report <path> [--repo DIR]
```

Checks, in order (all fail closed; a malformed/unreadable report is BLOCKED, never a pass):

1. Lock ownership: `run_lock.sh check <runId>` exits 0.
2. Clean tree: `git status --porcelain` empty.
3. Report-shape guard: `waveMerges` present, non-empty, last entry has `headSha` (the budget-exhausted/SKIPPED degrade).
4. Tree identity: `git rev-parse <branch>` equals `waveMerges[last].headSha`.
5. `gitVerified === true`.
6. `ancestryMisses` empty.
7. `missingDeliverables` empty.
8. Acknowledgement items (not blockers): `coverage.complete === false`, and any `deferredVerification` entries with reason `runtime`/`external`, are collected as NEEDS_ACK items with the itemized evidence.

Output: one JSON verdict `{ verdict: "PASS" | "NEEDS_ACK" | "BLOCKED", checks: [...], acks: [...] }`. Exit 0 = PASS, exit 2 = NEEDS_ACK (operator must explicitly acknowledge the enumerated items before Approve), exit 1 = BLOCKED. A transcription typo in the saved report can only produce BLOCKED (git is the ground truth the report is checked against). Unit tests drive it against fixture reports + throwaway git repos, covering every check's pass and fail branch.

`gate_check.py` replaces the corresponding SKILL.md prose; it does not administer acceptance (component 3 does) and does not release locks or sweep (those remain explicit orchestrator actions on the gate's outcome).

## Component 3 — Deterministic suite at the interactive gate

Step 5's Approve path administers the test gate deterministically for **every** disposition:

- `sealed` — unchanged: `run_acceptance.sh <sealId> <branch> <sha256>`.
- `suite` **and unmarked (`null`)** — new: `run_acceptance.sh --suite-gate --branch <integrationBranch> --run <derived testCmd> --base <baseBranch>`. Exit code is the authority; the report's `tests.passed` becomes triage context only.

Bundled `run_acceptance.sh` fixes (all LOW findings from the review):

- `cleanup()` removes the leaked `mktemp -d` parent, not just the worktree.
- `emit` receives output already truncated shell-side (`tail -c 8000`) so a multi-MB log cannot blow the env-var limit and lose the JSON receipt.
- `--suite-gate` without `--base` prints a one-line warning that the harness-JS sim guard is disarmed (docket drain always passes it; this covers future callers).

Covered by additions to `tests/test_run_acceptance.py`.

## Component 4 — `compile_plan.py --emit-args <path>`

Emits the complete launch-args skeleton as JSON: light `waves` (id/title/files/depends_on/interfaces), `wavesPath` (when `--emit-launch` also given), `edges` **as pairs**, `acceptance`, `waveLabels`, `globalConstraints`, `planPath`. The orchestrator fills in only its genuine judgment — per-task `tier`, optional `review` overrides, `testCmd`/`bootstrapCmd`, `baseBranch`, `stamp`/`integrationBranch` — and passes the object through. This removes the hand-assembly class of failure ("forgot to convert `dag_edges` to pairs", "forgot `edges` entirely → blocking silently off"). Tested in `tests/test_compile_plan.py`: emitted args parse, edges are pairs matching `dag_edges`, acceptance/labels/constraints ride through, waves match `launch_waves`.

## Component 5 — Test cleanup

- **Delete** `tests/test_test_import_guidance.py` (cannot fail — asserts unavoidable words).
- **Fix** `tests/test_cross_phase_review.py` — replace the always-true `"pr" in blob` with a specific phrase assert.
- **Fix** `tests/test_complexity_ratchet.py` — assert the ratchet verdict (or the delta computation) instead of printing it; if it stays advisory-only, rename it so the name stops promising a gate.
- **Delete the 5 `waves.js` source-pins** — `test_review_floor.py`, `test_review_dispatch_lean.py`, `test_escalation_classifier.py`, `test_wave_roadmap.py`, `test_wave_roadmap_preview.py` — after confirming each pinned behavior has an equivalent scenario in `tests/sim_workflow.mjs` (reviewer-floor, escalation-classifier, wave-labels, wave-roadmap-preview already exist; add a sim assertion for the two-worktree-isolation dispatch count if absent).
- **Add** `tests/test_wave_ancestry.py` — a pytest wrapper for `wave_ancestry_sim.mjs` mirroring `test_workflow_sim.py` (exit 0 **and** `ALL SCENARIOS PASSED` in stdout), so the #70 ancestry sim runs in the default suite and CI, not only in the suite-gate.

## Component 6 — SKILL.md re-layer (last; sole writer of SKILL.md)

Rewrite `skills/ultrapowers/SKILL.md` as a ≤2,000-word, <500-line operator core: the step sequence, the exact commands, the decision tables. The bug-history rationale (#29/#32/#36 backstories, eval war stories, design essays) moves to a new `references/design-rationale.md` with one-line pointers from the steps it explains (operator decision: move, don't delete). Steps 4–5 are rewritten around components 2–4: assemble args via `--emit-args`, save the report to disk, run `gate_check.py`, administer acceptance per disposition via `run_acceptance.sh`, act on exit codes.

Constraints:

- `validate_skill.py skills/ultrapowers` stays green (frontmatter + reference integrity).
- The ten test files that reference `skills/ultrapowers/SKILL.md` (`test_orchestrator_markers.py`, `test_salvage_gate.py`, `test_viewer_offer_touchpoints.py`, `test_report_runbook.py`, `test_compat_skill_wiring.py`, `test_terminal_teardown.py`, `test_review_trigger_prose.py`, `test_cross_phase_review.py`, `test_finishing_notes.py`, `test_harness_registry.py`) are updated **deliberately in the same task** — each pinned behavior must survive the rewrite or the pin is consciously retired with a reason.
- No behavioral contract changes beyond the component 2–4 rewiring: fallback path, resume/redirect/salvage mechanics, runbook handling, viewer offers, and the read/write boundary keep their meaning at shorter length.

## Component 7 — Hygiene

- Add `docs/superpowers/observations/ledger.jsonl` and `ledger.md` to `.gitignore` and `git rm --cached` them (regenerable output; local files remain).
- Shrink the `waves.js` wave-label fallback: keep `args.waveLabels` (canonical, from the compiler) and single-task-title labeling; the shared-noun/common-dir derivation (~55 lines, hand-mirrored from Python) reduces to `'Wave N'`. Update the sim's wave-label scenarios accordingly. `compile_plan.py`'s `derive_wave_label` stays the single source.

## Non-goals

- No changes to the review prompts, schemas, or the bake/pin regime (working as designed).
- No pruning of the viewer, ultralearn, or ultradocket (review verdict: keep; all off the hot path).
- No re-layer of `ultraplan/SKILL.md` (3,030 words — within tolerance).
- No new orchestration surfaces; `gate_check.py` and `--emit-args` mechanize existing contracts only.

## Testing summary

Every script change is TDD'd in its existing test file; `gate_check.py` gets a new test module with per-check pass/fail coverage against throwaway git repos. The `waves.js` label change is exercised by the updated sim (which the suite-gate's JS guard runs on any harness diff, and `test_workflow_sim.py` runs in CI). Expected end state: suite green with the ballast removed, `wave_ancestry_sim` in the default gate, and `python3 -m pytest` remaining the single command.

## Risks

- The SKILL.md rewrite is the highest-blast-radius task; it is sequenced last, after the scripts it references exist, and every retired pin is an explicit decision recorded in the task.
- `_is_pathlike` leniency could admit an all-caps identifier (`CONSTANTS.FOO`) as a path, creating a spurious edge; accepted — over-serialization is the safe failure direction, and the near-miss surfacing still names dropped tokens.
- Saving the report JSON via the orchestrator is one model-mediated write; `gate_check.py` treats git as ground truth, so corruption yields BLOCKED, not false pass.
