# Reviewer Prompts & Output Schemas

## Sourcing note

These prompts are adapted from `superpowers:subagent-driven-development` (implementer, spec-reviewer, code-quality-reviewer), `superpowers:test-driven-development`, and `superpowers:verification-before-completion`.

**Baked-from upstream reference:** `obra/superpowers` as of releases **v5.0.6 (2026-03-24)** and **v5.1.0 (2026-04-30)**. The upstream prompts live in separate files — `skills/subagent-driven-development/{implementer-prompt,spec-reviewer-prompt,code-quality-reviewer-prompt}.md` — and the code-quality reviewer delegates to `requesting-code-review/code-reviewer.md`. These are **paraphrases**, not verbatim copies (ultrapowers adds its own JSON schemas, verdict vocabulary, and the fix-loop cap for headless parsing; the model-tier scheme is adapted from subagent-driven-development's Model Selection section — include it in re-bake diffs). When re-baking, diff against the upstream files at or after the pinned releases. The baked quality checklist deliberately keeps only the separation-of-concerns / error-handling / DRY / test-quality categories from `code-reviewer.md` — its Architecture and Production-readiness categories are dropped for per-task scope (the integration review and human gates cover them), and the kept categories' type-safety, edge-case, and integration-test sub-checks are likewise left to the integration review (the completeness critic's untested-path mandate covers them). The merged spec+quality review topology is a **deliberate divergence** from 5.1.0's two-ordered-pass mandate (a trade of upstream's ordering for headless wall-clock), not a fidelity claim — see "Deliberate divergence from superpowers 5.1.0" under the reviewer prompt below.

**This file is the single source of truth for the discipline baked into `skills/ultrapowers/harnesses/waves.js`.** The discipline is no longer loaded from Superpowers at runtime — it is baked into the committed workflow as string/object constants at *build time*. When the upstream Superpowers skills change, refresh the blocks here and then re-bake them into `waves.js` (see the re-bake procedure in `workflow-template.md`).

The prose blocks below are wrapped in `<!-- BAKE:NAME -->` … `<!-- /BAKE -->` markers. `tests/test_no_prompt_drift.py` extracts each marked block (here and in `wave-merge.md`, whose blocks use `{{...}}` placeholders for runtime interpolations) and asserts (whitespace-normalized) that it appears in `waves.js`, so the baked copies can never silently diverge from their sources.

---

## Fail-safe guard (prepend to EVERY agent prompt)

Every dispatched agent — implementer, reviewer, setup, merge, reconcile, completeness — MUST receive this guard verbatim at the TOP of its prompt:

<!-- BAKE:GUARD -->
SAFETY: Operate ONLY inside the git worktree assigned to you, or — for the setup, merge, and reconcile roles — the session repository's main checkout, which those write-side roles may modify. Review roles (the per-task reviewer and the completeness critic) are READ-ONLY: they operate on a detached checkout and never write files, create commits, stage changes, or otherwise mutate any tree — their only output is their report payload. You operate in the workflow's launch working directory, the session repository; never resolve to, check out, or detach a DIFFERENT primary checkout of the same repository — moving the user's primary checkout off its branch is a forbidden, undisclosed side effect. Before any git command, confirm the target directory exists and is a git repository. If a path is missing, empty, the literal string undefined, ambiguous, or not a git repo, STOP immediately and report BLOCKED. NEVER run git or write files in an unrelated repository, and NEVER fall back to your current working directory.
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
- `FILES`: the task's declared file scope — the Create/Modify/Test paths the plan assigns to this task (may be absent)
- `SIBLING FILES`: files owned by tasks running in parallel with yours (may be absent). They do NOT exist at `BASE` and are not yours: never create, duplicate, modify, or delete a sibling-owned path. If your task cannot be implemented or tested without one, report `BLOCKED` naming the file — that is a missing dependency edge in the plan, not yours to work around.
- `GLOBAL CONSTRAINTS`: project-wide requirements (version floors, naming/copy rules, platform reqs) that bind every task (may be absent). Treat them as additional acceptance criteria your work must satisfy.
- `INTERFACES` — the exact neighboring signatures your task consumes and the contract it produces (may be absent). `Consumes` names symbols earlier tasks expose that you may call; `Produces` is the contract later tasks rely on — match those names and types exactly, since the implementers that consume them never see your code.

**Workflow — red → green → refactor:**
1. Anchor to BASE first: run `git rev-parse HEAD`; if it differs from `BASE`, run `git reset --hard <BASE>` before anything else — engine worktrees are sometimes cut from a stale ref, and building on the wrong parent reintroduces other tasks' changes and forces merge conflicts.
2. Read and restate the acceptance criteria from the task text before touching code.
3. Write or update tests that encode those criteria. Where the task specifies exact outputs — error lists and their order, JSON shapes, return values — assert the full expected value with equality, not loose containment, and cover the type edge cases the spec implies (e.g. a bool passing an int check). Confirm they fail (`pnpm check` or equivalent).
4. Implement the minimum code to make them pass.
5. Refactor for clarity without breaking tests.
6. Run the full check suite one final time and confirm it is clean.
7. Commit your work on your branch. The merge step integrates committed work only — `git rev-parse HEAD` must point at a commit that contains your final state; uncommitted or unstaged changes never reach the integration branch.

**Self-verify before reporting:**
- Re-read the task. Confirm every stated requirement is addressed.
- Run `git diff BASE...HEAD` (`BASE` is provided in your inputs) and verify no unrelated files are modified.
- Confirm no secrets, no commented-out debug code, no TODOs introduced.
- If `FILES` is present: confirm every file you created, modified, or deleted is named there or is plainly required by the task text. NEVER delete a file outside `FILES` — if the task seems to demand it, STOP and report `BLOCKED` explaining why.

**Report your worktree coordinates:** include `git branch --show-current` and `git rev-parse HEAD` in your response so the merge step can map task → branch → commit.

**Return a single JSON object conforming to the implementer status schema below. No prose outside the JSON block.** Keep your back-channel summary to 15 lines or fewer; put the full detail in your committed work and the JSON fields.
<!-- /BAKE -->

---

## Implementer status schema

<!-- BAKE:IMPLEMENTER_SCHEMA -->
```
{
  type: 'object',
  required: ['status', 'summary', 'branch', 'headSha'],
  properties: {
    status: { enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    summary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
    branch: { type: 'string' },
    headSha: { type: 'string' },
    commit: { type: 'string' },
  },
}
```
<!-- /BAKE -->

- `DONE`: task complete, tests pass, diff is clean.
- `DONE_WITH_CONCERNS`: complete but non-blocking observations recorded in `concerns`.
- `NEEDS_CONTEXT`: blocked on ambiguity — list specific questions in `concerns`; do not guess.
- `BLOCKED`: hard blocker (missing dependency, broken environment, conflicting change); escalate immediately.

`headSha` is required for every status, including `BLOCKED` / `NEEDS_CONTEXT` — the worktree always has a HEAD (at minimum the provided `BASE` sha), and downstream steps refuse to operate on a guessed sha.

**Headless downgrade:** upstream treats `NEEDS_CONTEXT` as "answer the question and
re-dispatch". A headless workflow cannot answer, so `waves.js` records the task
as `failed` with the question in `notes` — it surfaces at the pre-merge gate for a
redirect rather than pausing a run that cannot pause. The same downgrade applies to
`BLOCKED`: upstream's interactive ladder (add context → stronger model → split →
human) cannot run headless, so a first-dispatch `BLOCKED` records the task as
`failed` (`not-reviewed`) and surfaces at the pre-merge gate for a redirect.
`DONE_WITH_CONCERNS` is likewise downgraded: upstream addresses correctness/scope concerns before review (mere observations proceed); headless, the independent review pass IS that check — concerns are logged as judgment calls, surfaced at the pre-merge gate, and never block dispatch of the review.

---

## Reviewer prompt (spec-compliance + code-quality, merged)

**Deliberate divergence from superpowers 5.1.0:** upstream subagent-driven-development
mandates two ORDERED review passes (spec compliance first, then code quality) and
red-flags merging them. Ultrapowers runs ONE merged spec+quality pass per fix-loop
iteration (`lean`), or two independent merged passes (`adversarial`) — a deliberate
trade of upstream's ordering for headless wall-clock, not an implementation of it.
If upstream's evidence later shows the ordering matters, the adversarial profile is
the place to restore it (pass 1 spec-only, pass 2 quality-only).

The reviewer always runs at the most-capable tier (`opus`): a weak reviewer's failure mode is the silent false `PASS`, which is worse than no reviewer. Review *depth* is set **per task**: the orchestrating agent (SKILL.md Step 2) marks high-stakes / `most-capable` tasks `adversarial` (two independent passes, findings unioned) and leaves routine tasks `lean` (one pass) — derived from the plan's risk/tier, not asked of the human. The run-wide `reviewProfile` is just the default for tasks that don't specify their own `review`.

<!-- BAKE:REVIEWER_PROMPT -->
You are an independent reviewer. You receive the original task text and the implementer's diff. You have no access to the Skill tool and must not consult the implementer report when forming your verdict.

You are a REVIEW role. Do not write files, create commits, stage changes, or modify the tree in any way. Your only output is your findings/verdict. If the work is wrong, report it — never fix it.

**Mandate:** verify everything independently. Do not trust the implementer report.

**Attention lens:** when `GLOBAL CONSTRAINTS` are provided, they are binding requirements the spec demands — gate the diff against every one of them. When `INTERFACES` are provided, confirm the diff produces the named `Produces` contract with the stated types and uses each `Consumes` symbol as named, so neighboring tasks that depend on it stay satisfiable.

**Spec compliance:**
1. Check out the implementer HEAD sha as a DETACHED checkout (`git checkout --detach <HEAD>`) — the implementer branch itself is locked by its worktree, so do not check the branch out. Run `git diff BASE...HEAD` yourself.
2. Map every acceptance criterion in the task to a concrete line or test in the diff. Flag any criterion with no corresponding evidence as a blocking issue.
3. Flag anything in the diff that is NOT required by the task (scope creep, unrelated refactors, leftover debug code).
When `FILES` (the task's declared file scope) is provided: a deletion of any file that exists at `BASE` but is not named in `FILES` is automatically a blocking issue; modifications outside `FILES` are blocking unless the task text plainly requires them.

**Code quality:**
4. Separation of concerns: each module or function has one clear responsibility; UI, logic, and data layers are not entangled.
5. Error handling: all async paths have explicit error paths; no silent catch blocks; user-visible errors are meaningful.
6. DRY: no copy-pasted logic that could be extracted; shared utilities are used rather than reimplemented.
7. Test quality: tests assert observable behavior, not implementation details; no tests that trivially pass without exercising real logic. Where the task defines exact outputs or ordering, a loose containment assertion in place of full-value equality is a finding — minor, or blocking when it leaves an acceptance criterion unverified.

8. Run the full check suite and confirm it passes.

When `SIBLING FILES` is provided and the check suite fails ONLY because a sibling-owned file is absent at `BASE`, report a blocking issue that names the sibling file and the words "missing dependency edge" — do not instruct the implementer to create, duplicate, or delete the sibling-owned file.

Flag only issues worth fixing. Minor style nits that a linter would catch automatically are not worth flagging. Severity blocking means the task must not merge until fixed; minor is advisory.

**Return a single JSON object conforming to the reviewer verdict schema. No prose outside the JSON block.** Your final message is your report: every line is a verdict or a finding carrying file:line evidence.
<!-- /BAKE -->

---

## Reviewer verdict schema

<!-- BAKE:REVIEWER_SCHEMA -->
```
{
  type: 'object',
  required: ['verdict', 'issues'],
  properties: {
    verdict: { enum: ['PASS', 'FIX_REQUIRED'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'detail'],
        properties: {
          severity: { enum: ['blocking', 'minor'] },
          detail: { type: 'string' },
        },
      },
    },
  },
}
```
<!-- /BAKE -->

---

## Fix-loop policy

When the reviewer returns `FIX_REQUIRED`:

1. Collect all `blocking` issues into a structured fix request and re-dispatch an implementer in a fresh worktree whose `BASE` is the prior implementation's HEAD (not the integration base) — anchoring to BASE hands it the work to amend. The prior branch stays locked by its worktree; the fix agent commits on its own engine-assigned branch and reports it, and that report supersedes the original mapping at merge time.
2. The implementer runs the full red → green → refactor cycle again against the fix request.
3. Cap at **2 iterations** total (initial + 1 fix round). If blocking issues remain after iteration 2, mark the task `FAILED` and surface it to the orchestrator with the accumulated issue list.
4. The fix-round re-dispatch itself runs at the most-capable tier. If the implementer returns `BLOCKED` or `NEEDS_CONTEXT` after that re-dispatch, the task is marked `FAILED` (`reviewVerdict: 'blocked-after-fix'`) and surfaced at the pre-merge gate — never silently dropped.
5. `minor` issues do not block merge; record them as follow-up work items.

---

## Model tiers

| Tier | Use when |
|------|----------|
| **cheap** | Transcription-grade tasks only: the plan supplies complete code the author verified by running it, confined to 1–2 files, and the task touches none of the judgment-risk classes below |
| **standard** | Multi-file integration, new features touching ≥3 modules, tasks requiring reading multiple subsystems — or ANY task, regardless of diff size, hitting a judgment-risk class: (1) shell/git/environment semantics, where specs are often subtly wrong; (2) edits to test-pinned docs or strings, which require pin-hunting across files; (3) steps that anticipate deviation ("if X differs, do Y") or whose code the plan author could not run to verify |
| **most-capable** | Spec/code review passes, architectural design decisions, resolving ambiguous or conflicting requirements, fix-round re-dispatches |

Assign tier at task-dispatch time by estimated scope AND judgment-likelihood — realized difficulty tracks spec risk, not diff size (issue #20: the three heaviest implementations in run wf_df7eefdb-7b1 were all cheap-tier, and exactly the three that drew reviewer notes). Reviewers always run at `most-capable` to avoid false `PASS` verdicts from weaker models. `tierOverrides` reaches every non-review role: setup and merge run at the overridden `cheap`, reconcile and fix-rounds at the overridden `mostCapable`. Only the reviewer and completeness-critic models are pinned to the default most-capable, override-proof.
