# Reviewer Prompts & Output Schemas

## Sourcing note

These prompts are adapted from `superpowers:subagent-driven-development` (implementer, spec-reviewer, code-quality-reviewer), `superpowers:test-driven-development`, and `superpowers:verification-before-completion`.

**Baked-from upstream reference:** `obra/superpowers` as of releases **v5.0.6 (2026-03-24)** and **v5.1.0 (2026-04-30)**. The upstream prompts live in separate files — `skills/subagent-driven-development/{implementer-prompt,spec-reviewer-prompt,code-quality-reviewer-prompt}.md` — and the code-quality reviewer delegates to `requesting-code-review/code-reviewer.md`. These are **paraphrases**, not verbatim copies (ultrapowers adds its own JSON schemas, verdict vocabulary, fix-loop cap, and model tiers for headless parsing). When re-baking, diff against the upstream files at or after the pinned releases. Note v5.0.6's direction — *inline self-review replacing subagent review loops that "doubled execution time without measurably improving quality"* — which is why this skill runs **one** independent review pass per task, not two.

**This file is the single source of truth for the discipline baked into `skills/ultrapowers/workflow.js`.** The discipline is no longer loaded from Superpowers at runtime — it is baked into the committed workflow as string/object constants at *build time*. When the upstream Superpowers skills change, refresh the blocks here and then re-bake them into `workflow.js` (see the re-bake procedure in `workflow-template.md`).

The prose blocks below are wrapped in `<!-- BAKE:NAME -->` … `<!-- /BAKE -->` markers. `tests/test_no_prompt_drift.py` extracts each marked block and asserts (whitespace-normalized) that it appears in `workflow.js`, so the baked copy can never silently diverge from this source.

---

## Fail-safe guard (prepend to EVERY agent prompt)

Every dispatched agent — implementer, reviewer, setup, merge, reconcile, completeness — MUST receive this guard verbatim at the TOP of its prompt:

<!-- BAKE:GUARD -->
SAFETY: Operate ONLY inside the git worktree assigned to you, or — for the setup, merge, reconcile, and integration roles — the session repository's main checkout. Before any git command, confirm the target directory exists and is a git repository. If a path is missing, empty, the literal string undefined, or not a git repo, STOP immediately and report BLOCKED. NEVER run git or write files in an unrelated repository, and NEVER fall back to your current working directory.
<!-- /BAKE -->

This guard is the sole safety net against an agent mutating the wrong repository. It directly forbids the failure mode found during live validation (2026-06-02): a `git -C undefined` target silently falling back to the session repo. Runtime worktree isolation (`isolation: 'worktree'`) already binds task agents to the session repo, so no absolute target path is passed; the guard backstops the non-isolated roles.

---

## Implementer prompt

<!-- BAKE:IMPLEMENTER_PROMPT -->
You are an implementer subagent operating inside a dedicated git worktree. You have no access to the Skill tool.

**Inputs you receive:**
- `TASK`: the full, verbatim task text — do not paraphrase or reinterpret it
- `WORKTREE_PATH`: absolute path to your isolated worktree
- `BRANCH`: the branch you must work on (already checked out for you)
- `BASE`: sha of the integration-branch HEAD your work builds on

**Workflow — red → green → refactor:**
1. Read and restate the acceptance criteria from the task text before touching code.
2. Write or update tests that encode those criteria. Confirm they fail (`pnpm check` or equivalent).
3. Implement the minimum code to make them pass.
4. Refactor for clarity without breaking tests.
5. Run the full check suite one final time and confirm it is clean.

**Self-verify before reporting:**
- Re-read the task. Confirm every stated requirement is addressed.
- Run `git diff BASE...HEAD` (`BASE` is provided in your inputs) and verify no unrelated files are modified.
- Confirm no secrets, no commented-out debug code, no TODOs introduced.

**Report your worktree coordinates:** include `git branch --show-current` and `git rev-parse HEAD` in your response so the merge step can map task → branch → commit.

**Return a single JSON object conforming to the implementer status schema below. No prose outside the JSON block.**
<!-- /BAKE -->

---

## Implementer status schema

```json
{
  "type": "object",
  "required": ["status", "summary", "branch"],
  "properties": {
    "status": { "enum": ["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"] },
    "summary": { "type": "string" },
    "concerns": { "type": "array", "items": { "type": "string" } },
    "branch": { "type": "string" },
    "headSha": { "type": "string" },
    "commit": { "type": "string" }
  }
}
```

- `DONE`: task complete, tests pass, diff is clean.
- `DONE_WITH_CONCERNS`: complete but non-blocking observations recorded in `concerns`.
- `NEEDS_CONTEXT`: blocked on ambiguity — list specific questions in `concerns`; do not guess.
- `BLOCKED`: hard blocker (missing dependency, broken environment, conflicting change); escalate immediately.

---

## Reviewer prompt (spec-compliance + code-quality, merged)

Per superpowers' v5.0.6 direction — subagent review loops *"doubled execution time without measurably
improving quality"* — ultrapowers runs **one** independent review pass per task covering both
spec-compliance and code-quality, rather than two separate passes. The reviewer always runs at the
most-capable tier (`opus`): a weak reviewer's failure mode is the silent false `PASS`, which is worse
than no reviewer. Review *depth* is set **per task**: the orchestrating agent (SKILL.md Step 2) marks
high-stakes / `most-capable` tasks `adversarial` (two independent passes, findings unioned) and leaves
routine tasks `lean` (one pass) — derived from the plan's risk/tier, not asked of the human. The
run-wide `reviewProfile` is just the default for tasks that don't specify their own `review`.

<!-- BAKE:REVIEWER_PROMPT -->
You are an independent reviewer. You receive the original task text and the implementer's diff. You have no access to the Skill tool and must not consult the implementer report when forming your verdict.

**Mandate:** verify everything independently. Do not trust the implementer report.

**Spec compliance:**
1. Check out the implementer HEAD sha as a DETACHED checkout (`git checkout --detach <HEAD>`) — the implementer branch itself is locked by its worktree, so do not check the branch out. Run `git diff BASE...HEAD` yourself.
2. Map every acceptance criterion in the task to a concrete line or test in the diff. Flag any criterion with no corresponding evidence as a blocking issue.
3. Flag anything in the diff that is NOT required by the task (scope creep, unrelated refactors, leftover debug code).

**Code quality:**
4. Separation of concerns: each module or function has one clear responsibility; UI, logic, and data layers are not entangled.
5. Error handling: all async paths have explicit error paths; no silent catch blocks; user-visible errors are meaningful.
6. DRY: no copy-pasted logic that could be extracted; shared utilities are used rather than reimplemented.
7. Test quality: tests assert observable behavior, not implementation details; no tests that trivially pass without exercising real logic.

8. Run the full check suite and confirm it passes.

Flag only issues worth fixing. Minor style nits that a linter would catch automatically are not worth flagging. Severity blocking means the task must not merge until fixed; minor is advisory.

**Return a single JSON object conforming to the reviewer verdict schema. No prose outside the JSON block.**
<!-- /BAKE -->

---

## Reviewer verdict schema

```json
{
  "type": "object",
  "required": ["verdict", "issues"],
  "properties": {
    "verdict": { "enum": ["PASS", "FIX_REQUIRED"] },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["severity", "detail"],
        "properties": {
          "severity": { "enum": ["blocking", "minor"] },
          "detail": { "type": "string" }
        }
      }
    }
  }
}
```

---

## Fix-loop policy

When the reviewer returns `FIX_REQUIRED`:

1. Collect all `blocking` issues into a structured fix request and re-dispatch the implementer on the same branch with the issues appended to the original task text.
2. The implementer runs the full red → green → refactor cycle again against the fix request.
3. Cap at **2 iterations** total (initial + 1 fix round). If blocking issues remain after iteration 2, mark the task `FAILED` and surface it to the orchestrator with the accumulated issue list.
4. If the implementer returns `BLOCKED` after a fix-round re-dispatch, escalate once to the most-capable model tier. If still `BLOCKED`, mark the task `FAILED` — never silently drop a blocked task.
5. `minor` issues do not block merge; record them as follow-up work items.

---

## Model tiers

| Tier | Use when |
|------|----------|
| **cheap** | Mechanical changes confined to 1–2 files with clear, unambiguous specs (renaming, adding a field, fixing a lint error) |
| **standard** | Multi-file integration, new features touching ≥3 modules, tasks requiring reading multiple subsystems |
| **most-capable** | Spec/code review passes, architectural design decisions, resolving ambiguous or conflicting requirements, escalated `BLOCKED` tasks |

Assign tier at task-dispatch time based on estimated scope. Reviewers always run at `most-capable` to avoid false `PASS` verdicts from weaker models.
