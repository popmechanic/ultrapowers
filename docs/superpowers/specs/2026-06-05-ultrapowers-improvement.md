# ultrapowers — Improvement Spec

- **Date:** 2026-06-05
- **Status:** Brainstorm complete; design approved — awaiting plan
- **Builds on:** `2026-06-02-ultrapowers-design.md`, `2026-06-03-committed-workflow-refactor.md`
- **Skill:** `ultrapowers` (invoked as `/ultrapowers <plan-path>`)
- **Driver:** big-picture feature development across several web-app projects; operator dogfoods ultrapowers to improve ultrapowers.

---

## The reframe (why this spec exists)

A codebase review plus a live cross-check of the current `obra/superpowers` `main` surfaced one realization
that reorganizes the whole improvement effort:

> **ultrapowers' real, unique value is parallel throughput on decomposable work — not autonomy.**

Plain superpowers already runs **headless and autonomous** from plan-approval to done. Its
`subagent-driven-development` (SDD) skill explicitly forbids pausing between tasks
(*"Do not pause to check in with your human partner between tasks"*). So "reduce dependence on the
operator" is **already delivered upstream**. ultrapowers' differentiator is the wave scheduler plus
per-task git-worktree isolation that lets *implementation* run in parallel — which SDD structurally
refuses (*"Never … dispatch multiple implementation subagents in parallel (conflicts)"*, a line that
lives in `subagent-driven-development`, **not** `dispatching-parallel-agents`).

This reframe corrects a factual error in the prior design docs (which motivated ultrapowers as
"moving the human gate to the right place"; superpowers has no per-task human gate to move) and
narrows the improvement space to three questions: **is the engine real, is it efficient, is it
portable across projects.**

## What the review found (condensed)

1. **The launch mechanism is unverified and undocumented.** SKILL.md launches a committed
   `workflow.js` by invoking a `Workflow` tool with a script *path* + `args`. The `Workflow` tool
   exists, but its path-launch signature is **not documented**. The only documented, durable reuse
   surface is a **saved workflow** (`.claude/workflows/<name>` → `/<name>`) that receives input through
   the `args` global. Every green test today exercises a *simulation* of the engine, never the engine.
2. **The discipline is a frozen paraphrase with no upstream-drift guard.** The anti-drift test only
   proves `workflow.js` matches the *local* `reviewer-prompts.md` — not that the local copy matches
   obra's current `implementer-prompt.md` / `spec-reviewer-prompt.md` / `code-quality-reviewer-prompt.md`,
   which moved in superpowers v5.0.6 / v5.1.0.
3. **The per-task review pipeline is the pattern upstream pruned.** ultrapowers runs **two `opus`
   reviewers per task** (spec, then quality) with a 3-round fix loop. superpowers v5.0.6 removed an
   analogous subagent review loop because it *"doubled execution time … without measurably improving
   quality."* This is the highest-value cost lever.
4. **A single frozen `workflow.js` hard-codes per-project assumptions** — the test command ladder
   (`pnpm check → npm test → …`), review depth, and model tiers — which fights "several different web
   apps."
5. **Smaller grounding bugs:** the Step-1 plan detector keys on a `"Plan:"` heading, but current
   superpowers plans are headed `# … Implementation Plan` with `### Task N:` tasks (detection
   currently survives only on the fallback check).

## Decisions (operator-approved 2026-06-05)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope of this round | **Full rework, including the launch pivot.** |
| D2 | Launch mechanism | **Pivot to the saved-workflow + `args` surface** (the only documented, durable path), **gated behind a de-risking spike** that proves launch + handoff in the operator's real environment before any rebuild. |
| D3 | Review depth | **Follow superpowers' lean direction: one independent review pass per task, not two.** Merge spec-compliance + code-quality into a single review. |
| D4 | Reviewer model | **Keep the reviewer at `opus`.** The failure mode of a weak reviewer is the silent false PASS, which is worse than no reviewer. Buy efficiency by **halving the review-pass count**, not by downgrading the model. Implementers stay tiered (haiku/sonnet/opus by scope) because tests verify them. |
| D5 | Fix-loop cap | Tighten from 3 to **2** iterations. |
| D6 | Portability | Push the per-project variables (`testCmd`, review profile, tier overrides) through `args`; keep the tested orchestration skeleton frozen. |

### The static-file question, resolved

The committed `workflow.js` is the **right call for the control plane** (wave loop, fail-loud `args`
validation, GUARD, cascade-blocking) and stays frozen and tested. The error was freezing the
**data/variability plane** (prompts, test command, tiers) into the same file. The fix is
**parameterization through `args`**, not re-authoring the orchestrator each session — which would
reintroduce exactly the nondeterminism the 2026-06-03 refactor correctly removed.

## What changes

- **Launch pivot (D2):** relocate the orchestrator to the saved-workflow surface
  (`.claude/workflows/ultrapowers/…`), invoked as `/ultrapowers` with the computed `waves` handed in
  through `args`. The SKILL.md remains the front door — it validates the plan, computes waves, and
  runs the **wave-plan approval gate before launch** (workflows are headless; the gate cannot move
  inside the run). Distribution (README/install) updated to install the workflow into
  `.claude/workflows/`.
- **Review + cost rework (D3/D4/D5):** a single `REVIEWER_PROMPT` (spec + quality merged) replacing
  the two-pass pipeline; fix-loop cap 2; reviewer pinned to `opus`; implementers tiered. Update
  `reviewer-prompts.md` (source of truth), re-bake `workflow.js`, and update the drift test +
  simulation accordingly.
- **Portability (D6):** `args` gains `testCmd` (overrides the detection ladder), `reviewProfile`
  (`lean` default | `adversarial` opt-in for high-stakes tasks), and `tierOverrides`. Defaults
  preserve current behavior when omitted.
- **Ground-truth corrections (the reframe + #5):** rewrite the motivation in README and the prior
  spec to "parallel throughput, not autonomy"; fix the `dispatching-parallel-agents` misattribution;
  tighten the plan-heading detector to match `# … Implementation Plan` / `### Task N:`; pin the
  superpowers commit/version the discipline was baked from in `reviewer-prompts.md`.
- **Dogfood:** execute the plan (or a slice) *through* the rebuilt ultrapowers and keep the run
  report as the validation artifact.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Saved-workflow launch / skill→workflow handoff may not work as hoped | **Task 1 spike is a hard go/no-go gate** before any rebuild; the spike is the operator's first dogfood run. If the documented path fails too, fall back to keeping the path-launch but documenting it as preview-dependent. |
| Merging two reviewers into one weakens verification | Reviewer stays `opus`; the final integration/completeness gate is retained as the systemic backstop; `reviewProfile: adversarial` restores the two-pass behavior per-task when wanted. |
| Baked discipline drifts from upstream again | Pin the baked-from version; the re-bake procedure + drift test remain the guard within the repo. |
| Dogfooding a tool to fix that same tool | Tasks 2–5 only run through ultrapowers **after** Task 1 confirms the engine launches; Task 1 itself is human-driven. |

## Out of scope

- Forking or modifying any superpowers file.
- Mid-run human interaction (incompatible with headless workflows).
- Auto-syncing the baked discipline from upstream at runtime (manual re-bake remains the model).

## Verification

- Static suite stays green (validator, canary, wrapped `node --check`, API-usage, drift, simulation),
  updated for the single-reviewer pipeline and the new `args` fields.
- Task 1 spike: a real `/ultrapowers`-style launch fires and returns a structured report.
- Dogfood run: the rebuilt ultrapowers executes a slice of this plan and produces a pre-merge report.
