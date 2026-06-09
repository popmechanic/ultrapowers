# ultrapowers Code-Review Findings (2026-06-09)

Findings from an external code review of the `ultrapowers` skill, conducted against
superpowers' `writing-skills` discipline (including its bundled Anthropic best-practices doc)
and the official Claude Code skill/plugin documentation. Each finding has an ID; the
companion plan (`docs/superpowers/plans/2026-06-09-review-findings-fixes.md`) maps tasks to IDs.

## Correctness (workflow.js)

- **F1 — Setup result discarded.** `SKILL.md` promises an abort when the integration branch
  cannot be created, but `workflow.js` ignores the setup agent's result. A failed setup lets
  every wave run and merge against a branch that doesn't exist.
- **F2 — Reviewer cannot check out the implementer's branch.** Worktree branches are locked and
  checked out in the implementer's worktree; `REVIEWER_PROMPT` tells the reviewer to check the
  branch out, which git refuses. Reviewers need a detached checkout of the HEAD sha.
- **F3 — Wrong diff base, and `main` is assumed.** Setup leaves the main checkout on the
  integration branch, so wave-N worktrees contain prior waves' merged work. Implementer and
  reviewer prompts diff against `main`, so a wave-2 reviewer sees wave-1 changes and is told to
  flag them as scope creep. Repos whose default branch isn't `main` break both prompts. The
  correct base is the integration-branch HEAD at the start of the task's wave.
- **F4 — `judgmentCalls` always empty; `DONE_WITH_CONCERNS` concerns silently dropped.** The
  autonomy posture and report format promise judgment calls; nothing populates the array, and
  the implementer schema's `concerns` field is never read — contradicting wave-merge.md's
  "Nothing is swallowed" guarantee.
- **F5 — Completeness critic never receives the plan.** wave-merge.md says the critic receives
  the original plan; the workflow passes only task IDs/titles and blocked waves. The critic
  cannot review "against the original plan" it never sees.
- **F6 — Cascade-block contradicts wave-merge.md.** The doc says independent downstream waves
  proceed; the code unconditionally breaks and blocks everything. The code's behavior is
  defensible (a failed merge leaves the integration branch broken for every later wave, since
  each wave merges onto it) — the doc should match the code.
- **F7 — Reviewer `verdict` field is dead.** Severity alone decides; a `FIX_REQUIRED` verdict
  with only `minor` issues merges silently with no signal of the inconsistency.
- **F8 — `NEEDS_CONTEXT` after a fix re-dispatch is unhandled.** Only `BLOCKED` is checked after
  the fix round; a `NEEDS_CONTEXT` result proceeds to a second review pass.
- **F9 — `tierOverrides` values unvalidated.** An invalid model alias makes every agent error
  without doing work (documented in workflow-template.md), yet a typo'd override only surfaces
  mid-run. Should fail loud at launch against `haiku`/`sonnet`/`opus`.
- **F10 — Budget check only fires at exactly zero.** `budget.remaining === 0` lets a negative or
  otherwise exhausted remaining value launch a full wave.

## Drift protection

- **F11 — Setup/merge/reconcile/completeness prompts have no drift coverage.** Only `GUARD`,
  `IMPLEMENTER_PROMPT`, and `REVIEWER_PROMPT` carry `BAKE` markers. wave-merge.md is named as
  the source of truth for the other four prompts but has no markers, and mild drift already
  exists (the doc's lockfile-keyed test-detection ladder vs. the baked looser paraphrase).

## Skill authoring (superpowers CSO + official docs)

- **F12 — Description and frontmatter polish.** The description should start with "Use when…"
  (superpowers CSO) and drop the "drop-in alternative" tail (what-it-is, not when-to-use). Add
  `argument-hint: <plan-path>` for autocomplete.
- **F13 — Workflow-tool preflight happens too late.** The Workflow tool is not in the official
  Claude Code docs (undocumented/experimental surface). The fallback triggers only at Step 4/6;
  users can approve a wave plan that can't launch. Check availability at Step 1, before
  dependency analysis and the human gate.
- **F14 — `validate_skill.py` is thin.** No name length/charset check (≤64, letters/digits/
  hyphens), no description cap (≤1024), and only `references/*.md` links are verified —
  `scripts/` links are unchecked.

## Usefulness improvements

- **F15 — No baseline test run.** A red suite before wave 1 poisons every implementer run
  ("confirm the suite is clean") and makes inherited breakage indistinguishable from introduced
  breakage. Setup should run the test command once and record the baseline in the report.
- **F16 — Step-5 "Redirect" has no mechanism.** "Re-run the affected tasks" forces the
  orchestrator to improvise — exactly what the skill forbids. Needs a deterministic resume path
  through the same committed workflow (`args.resume` + filtered waves on the existing
  integration branch).
- **F17 — No run economics in the report.** Per-task model tier, review depth, and fix-loop
  iterations would let the human gate judge whether the parallelism paid off and tune tier
  assignments on the next plan.
