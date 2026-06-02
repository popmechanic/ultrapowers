---
name: ultra-driven-development
description: This skill should be used when the user asks to "execute this plan", "go ultra", "run the plan as a workflow", "ultra-driven development", or wants to autonomously implement an approved Superpowers plan in parallel. The drop-in alternative to superpowers:subagent-driven-development.
allowed-tools: Workflow Skill Read Grep Glob Bash Edit Write
---

# Ultra-Driven Development

Autonomously implement an approved Superpowers plan via a parallel, worktree-isolated Dynamic Workflow. Each task runs in its own git worktree, passes through a mandatory spec-compliance and code-quality review pipeline, and merges into a single integration branch. A human-readable report and merge gate conclude the run.

---

## Invocation Context

Run this skill from within the target project's git repository. Worktrees are created as subdirectories of the session repo root. Do not run from a detached HEAD or from outside the project tree.

---

## Step 1 — Confirm an Approved Plan Exists

Before touching code, verify that a `superpowers:writing-plans` plan document exists and is approved. Look for a markdown file whose top-level heading matches "Plan:" or that contains a numbered list of tasks with `**Files:**` blocks and `- [ ]` checkbox steps.

If no approved plan is found, stop immediately. Inform the user: "No approved plan found. Run `superpowers:brainstorming` to explore the problem, then `superpowers:writing-plans` to produce a structured plan document. Return here once the plan is approved."

Do not proceed with a plan that exists only as freeform prose or bullet points — it must have numbered tasks with explicit file lists.

---

## Step 2 — Load Implementer and Reviewer Discipline

Invoke the following skills via the Skill tool to refresh the discipline that will be baked into every agent call in the workflow. Load all three before authoring the workflow script.

- `superpowers:subagent-driven-development` — implementer role, worktree conventions, and structured output schema
- `superpowers:test-driven-development` — red → green → refactor cycle that every implementer must follow
- `superpowers:verification-before-completion` — adversarial self-check criteria for both implementers and the final completeness reviewer

After loading, extract the following from the refreshed discipline and hold them in working memory for Step 4:

- The implementer prompt and its JSON output schema (see `references/reviewer-prompts.md`)
- The spec-compliance and code-quality reviewer prompts and the shared reviewer verdict schema
- The fix-loop policy (cap at 3 iterations; escalate `BLOCKED` once to the most-capable tier)

---

## Step 3 — Analyze Dependencies and Compute Waves

Follow `references/dependency-analysis.md` in full to turn the plan into a `waves: Task[][]` structure.

**Parse each task** to extract its `writes` set (`Create:` paths ∪ `Modify:` paths) and identify any explicit `depends on` / `after` / `requires` phrases in the task body.

**Build the DAG** by applying the three edge rules: write-after-create, write-after-write on the same file (serialize in document order), and explicit text dependency.

**Run cycle detection** (DFS) before computing any waves. If a cycle is found, stop and surface it to the user in plain language — never guess an ordering. Ask the user to revise the plan to break the cycle.

**Apply conservative defaults:** tasks with missing or unresolvable `**Files:**` blocks depend on all prior tasks; shared-directory scaffolding tasks are serialized first.

**Apply the small-plan degrade:** if total task count ≤ 2 OR every task's `writes` set overlaps with every other task's `writes` set, collapse to a single sequential wave and log the reason. Skip worktree machinery; run tasks one at a time in the main worktree.

**Record the computed output** (DAG edges, wave list, mode, degrade reason if applicable) for inclusion in the final report per `references/dependency-analysis.md`'s transparency block.

---

## Step 4 — Author the Workflow Script

Follow `references/workflow-template.md` to author the Dynamic Workflow script. This is a pure orchestrator: it sequences barriers, maps task inputs to `agent()` calls, and collects structured outputs. It has no shell or filesystem access.

**Fill in the skeleton:**

- Set `args = { waves, integrationBranch }` where `integrationBranch` is `ultra/integration-<timestamp>` (use the current unix timestamp, or pass it through args since the script cannot call `Date.now()`).
- Populate `meta.phases` with one entry per wave, titled "Wave N".
- For each wave, call `parallel()` over the wave's tasks, each dispatching `runTask(task)`.

**Per-task pipeline (`runTask`):**

1. **Implementer agent** — `isolation: 'worktree'`, model tier assigned by scope (cheap / standard / most-capable per `references/reviewer-prompts.md`). Bake in the full implementer prompt from `references/reviewer-prompts.md`, substituting real verbatim task text (not file references). The implementer returns a JSON object conforming to the implementer status schema: `{ status, summary, branch, headSha, commit }`.
2. **Spec-compliance reviewer** — `isolation: 'worktree'`, model `most-capable`. Runs only after the implementer reports `DONE` or `DONE_WITH_CONCERNS`. Bake in the spec-compliance reviewer prompt from `references/reviewer-prompts.md`. Returns the reviewer verdict schema: `{ verdict, issues[] }`.
3. **Code-quality reviewer** — `isolation: 'worktree'`, model `most-capable`. Runs only after the spec-compliance reviewer returns `PASS`. Bake in the code-quality reviewer prompt from `references/reviewer-prompts.md`. Returns the reviewer verdict schema.
4. **Fix loop** — when either reviewer returns `FIX_REQUIRED`, collect all `blocking` issues into a fix request and re-dispatch the implementer on the same branch. Cap at 3 iterations total. If blocking issues remain after iteration 3, mark the task `FAILED` and return a structured failure result — never throw. `minor` issues do not block; record them as follow-up items.

**Handle budget pressure:** check `budget.total` before launching each wave. If headroom is insufficient, skip remaining waves, note deferred tasks in the return value, and still run the integration review on what has merged.

**Dispatch the setup agent** before Wave 1 begins. The setup agent (non-isolated, main checkout) creates the integration branch and reports its name and HEAD sha back to the controller.

**Merge step per wave:** after all task agents in a wave settle, dispatch a single merge agent (non-isolated, main checkout) per `references/wave-merge.md`. The merge agent receives the wave's `{ task, branch, sha }` list, merges branches in deterministic task-index order, runs the project's test command, and reports success or failure.

**Reconciliation on merge failure:** dispatch a reconciliation agent (non-isolated) with the conflict diff or failing test output. Cap at 2 attempts. On both failing, mark the wave `blocked`. Continue subsequent waves unless they declare a hard dependency on the blocked wave — cascade-block only those downstream waves, not the entire run.

**Integration and completeness review** — after the final wave, dispatch a completeness-critic agent using `superpowers:verification-before-completion`. Its prompt: "What plan requirement is unmet? What claim is unverified? What code path is untested?" Feed it the original plan, the full task list, the blocked-wave log, and the final test output. Append all findings verbatim to the report.

**Substitute real task text.** Every `agent()` call must carry the full verbatim task body, acceptance criteria, and file list inlined into the prompt string. Do not pass file paths that the headless script cannot resolve — paste the content.

---

## Step 5 — Launch the Workflow

Invoke the Workflow tool with the fully authored script and `args = { waves, integrationBranch }`. Do not pause mid-run. Workflows are headless: the orchestrator cannot receive input after launch. Surface all decisions in the final report, not during execution.

---

## Step 6 — Wave Merges and Integration Review (Inside the Workflow)

The merge machinery executes inside the workflow per `references/wave-merge.md`. Key points:

- The integration branch is `ultra/integration-<timestamp>`, created by the setup agent before Wave 1.
- Each wave's merge agent merges branches in task-index order for reproducibility.
- Worktrees live at `<repo>/.claude/worktrees/wf_<runId>-<n>`. Do not delete worktrees for blocked waves — they are needed for diagnosis.
- After the final wave, a completeness-critic agent reviews the integrated result against the original plan. All gaps are recorded verbatim in the `completenessFindings` field of the report.

---

## Step 7 — Present the Pre-Merge Report

When the workflow returns, render the report object per `references/report-format.md` as a concise human-readable summary in this order:

1. **Integration branch** — name of the branch ready for review.
2. **Wave plan** — one line per wave: which tasks ran in parallel and the order of waves.
3. **Dependency edges** — the DAG edges that shaped wave ordering (from the transparency block computed in Step 3).
4. **Per-task status** — compact table or bullet list: task name, status (`done` / `failed` / `skipped`), review verdict, and notes.
5. **Test result** — pass or fail, the command used, and any relevant output excerpt.
6. **Judgment calls** — bullet each non-obvious autonomous decision so the human can spot disagreements early.
7. **Unfinished / completeness findings** — tasks deferred or blocked, plus any gaps the completeness-critic found. An empty list means nothing was left behind.

After the summary, name the integration branch and present the human with two choices:

- **Approve** — proceed to `superpowers:finishing-a-development-branch` to merge, clean up worktrees, and close the plan.
- **Redirect** — provide corrective instructions; re-enter the execution loop for the affected tasks before returning to this gate.

---

## Autonomy Posture

Operate with catastrophe-only escalation. Mid-run questions are not possible — the workflow is headless. Handle all ambiguity by making a conservative, logged judgment call and surfacing it in the final report under `judgmentCalls`. Blocked tasks are never silently dropped: they appear under `## Blocked Waves` in the report with full context. The human sees every non-obvious decision at the pre-merge gate, not mid-run.

The only events that warrant aborting the entire run before the integration review are:

- A dependency cycle detected in Step 3 (requires human plan revision before re-entry).
- The repo is in a detached HEAD or the integration branch cannot be created.

In all other cases, continue the run, log the problem, and surface it in the report.

---

## Resources

- `references/dependency-analysis.md` — DAG construction, topological layering, cycle detection, small-plan degrade, and the transparency block format
- `references/workflow-template.md` — Dynamic Workflow skeleton, `agent()` / `parallel()` / `phase()` / `budget` API, model tier defaults
- `references/reviewer-prompts.md` — Implementer prompt, spec-compliance reviewer prompt, code-quality reviewer prompt, JSON schemas, fix-loop policy
- `references/wave-merge.md` — Integration branch setup, per-wave merge agent, reconciliation caps, cascade-blocking, completeness-critic dispatch
- `references/report-format.md` — JSON schema for the workflow return value and the human-facing presentation order
- `scripts/validate_skill.py` — Run with `python3 scripts/validate_skill.py skills/ultra-driven-development` to verify frontmatter and reference integrity; expected output: `skill ok`
