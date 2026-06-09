# Wave Merge Reference

How a wave's worktree branches get merged into one integration branch, reconciled on failure, and finally reviewed.

**Source-of-truth note:** the setup, merge, reconciliation, and completeness-critic prompts described
here are **baked into `skills/ultrapowers/workflow.js`** as the `SETUP_PROMPT`, `MERGE_PROMPT`,
`RECONCILE_PROMPT`, and `COMPLETENESS_PROMPT` constants. When you change the procedure here, re-bake
those constants (see the re-bake procedure in `workflow-template.md`). The committed workflow runs
this machinery; the main agent does not author it.

---

## Integration Branch

The workflow script cannot run git (no shell or filesystem access), so all git operations are delegated to agents. Before Wave 1 begins, the controller dispatches a **setup agent** whose sole job is to create the integration branch in the main checkout:

```
git checkout -b ultra/integration-<timestamp>
```

The timestamp is passed in via `args` at workflow startup — workflows cannot call `Date.now()`. The setup agent confirms the branch name and HEAD sha back to the controller, which stores both for use in subsequent merge steps.

The setup agent first checks out `args.baseBranch` when supplied (the orchestrator derives the repo's default branch in SKILL.md Step 2 — protects against a stale checkout left by a previous run), runs the project test command once to establish the **baseline**, and reports `baselinePassed` / `baselineOutput`. The workflow validates the setup report and **throws** if the integration branch was not created — no task runs against a missing branch. A red baseline does not abort the run; it is logged, recorded in the report's `baseline` field, and surfaced as a judgment call so the pre-merge gate can weigh every later test result against it.

The canonical prompt wording (`{{...}}` tokens mark values `workflow.js` interpolates at run time; `{{BASE_STEP}}` is the optional base-branch checkout sentence):

<!-- BAKE:SETUP_PROMPT_CREATE -->
You are the setup agent on the session repo main checkout. {{BASE_STEP}}Create the integration branch: git checkout -b {{INTEGRATION_BRANCH}}. Then establish the test baseline: {{TEST_INSTRUCTION}} and record whether it passes. Report the branch name, its HEAD sha, and the baseline result in your JSON result.
<!-- /BAKE -->

Under `args.resume` (the deterministic redirect path), setup reuses the existing branch instead:

<!-- BAKE:SETUP_PROMPT_RESUME -->
You are the setup agent on the session repo main checkout. Check out the EXISTING integration branch {{INTEGRATION_BRANCH}} — it must already exist; report BLOCKED if it does not, and do not create a new branch. Then establish the test baseline: {{TEST_INSTRUCTION}} and record whether it passes. Report the branch name, its HEAD sha, and the baseline result in your JSON result.
<!-- /BAKE -->

---

## Worktree and Branch Facts

Task agents run in isolated worktrees provisioned by `isolation: 'worktree'`. `<repo>` is the
**session repository** (the repo `/ultrapowers` was invoked from) — the runtime binds worktrees there
natively, so no external target path is passed to the workflow:

```
<repo>/.claude/worktrees/wf_<runId>-<n>
```

Each worktree is checked out on a runtime-assigned branch named:

```
worktree-wf_<runId>-<n>
```

Branches are locked for the duration of the run. When a task agent finishes with no file changes, its worktree is auto-removed and no branch is reported. When changes exist, the worktree persists until the merge step consumes it.

Each implementer agent is responsible for self-reporting its branch name and HEAD sha at the end of its run. This self-report is the only mechanism by which the merge step learns the task-to-branch mapping — the script cannot inspect the filesystem to discover branches.

---

## Per-Wave Merge

After all task agents in a wave complete, the controller dispatches a single **merge agent** (non-isolated, running in the main checkout). The merge agent receives the list of `{ task, branch, sha }` entries reported by the wave's implementers.

The merge agent:

1. Checks out the integration branch (`ultra/integration-<timestamp>`).
2. Merges each reported branch in deterministic task-index order (task 0 first, then 1, 2, …). Fixed order makes conflicts reproducible.
3. After all merges succeed, detects and runs the project's test command by checking in order: `pnpm-lock.yaml` → `pnpm check`; `package.json` (no pnpm lock) → `npm test`; `pytest.ini` / `pyproject.toml` / `setup.py` → `pytest`; `Cargo.toml` → `cargo test`; `go.mod` → `go test ./...`. **When `args.testCmd` is supplied, that exact command is used instead of this detection ladder** (set it for monorepos or custom runners; baked into `MERGE_PROMPT` / `COMPLETENESS_PROMPT` via `testInstruction`).
4. Reports back: success with final integration HEAD sha, or failure with the conflict diff or failing test output.

The canonical prompt wording:

<!-- BAKE:MERGE_PROMPT -->
You are the wave merge agent, operating on the session repo main checkout (no worktree). Check out {{INTEGRATION_BRANCH}}. Merge each reported branch in the given task-index order (deterministic, so conflicts are reproducible). After all merges succeed, {{TEST_INSTRUCTION}}. Report MERGED with the final HEAD sha, or CONFLICT / TEST_FAILED with the conflict diff or failing output.
<!-- /BAKE -->

---

## Reconciliation

On a merge conflict or a failed post-merge test, the controller dispatches a single **reconciliation agent**. It receives the conflict diff or failing test output alongside the full task context and is expected to resolve the issue on the integration branch and re-run the test command.

The canonical prompt wording:

<!-- BAKE:RECONCILE_PROMPT -->
You are the reconciliation agent on {{INTEGRATION_BRANCH}}. You are given a merge conflict diff or failing test output. Resolve it on the integration branch and re-run the project test command. Report MERGED on success, or CONFLICT / TEST_FAILED with detail if you cannot resolve it.
<!-- /BAKE -->

Caps and failure handling:

- The fix loop is capped at **2 attempts**. Each attempt and its outcome are logged via `log()`.
- If the reconciliation agent fails both attempts, the wave is marked **`blocked`**.
- Its branches are left intact — do not delete worktrees for a blocked wave.
- The blocked wave, its conflict/diff, and the failing output are recorded in the final report.
- When a wave's merge cannot be reconciled, the wave is marked **`blocked`** and **all later waves are cascade-blocked** (recorded in `unfinished`, surfaced under `## Blocked Waves`). Every later wave merges onto the same integration branch the failed wave left in an unknown state, and by wave construction each wave-N+1 task depends on some wave-N task — so continuing selectively would integrate onto a broken base. The committed workflow therefore stops dispatching after an unrecoverable merge; nothing after the blocked wave runs. The integration/completeness review still runs and reports.

---

## Integration and Completeness Review

After the final wave's merge agent completes successfully (or is blocked), the controller:

1. Runs the full test suite one more time on the integration branch from the main checkout, regardless of whether the last wave passed its own test run. Log the result.
2. Dispatches a **completeness-critic agent** using `superpowers:verification-before-completion`. Its prompt: "What plan requirement is unmet? What claim is unverified? What code path is untested?" The agent receives `args.planPath` and reads the plan from disk (agents have fs access; the script does not), plus the full list of tasks, the blocked-wave log (if any), and the final test output.
3. All findings from the critic — gaps, unverified claims, untested paths — are appended to the run report verbatim.

The canonical prompt wording (`{{PLAN_STEP}}` is the optional "Read the original plan document at `args.planPath` first." sentence):

<!-- BAKE:COMPLETENESS_PROMPT -->
{{PLAN_STEP}}What plan requirement is unmet? What claim is unverified? What code path is untested? On {{INTEGRATION_BRANCH}} from the main checkout, {{TEST_INSTRUCTION}}, then review the integrated result against the original plan. List every gap, unverified claim, and untested path.
<!-- /BAKE -->

The report section header for this step is `## Integration Review`. Blocked waves appear under `## Blocked Waves`.

---

## No Silent Caps

Every truncation is surfaced explicitly:

| Event | Logged via | Appears in report |
|---|---|---|
| Reconciliation attempt 1 or 2 fails | `log()` | `## Blocked Waves` |
| Wave marked `blocked` | `log()` | `## Blocked Waves` |
| Downstream wave cascade-blocked | `log()` | `## Blocked Waves` |
| Fix-loop cap reached | `log()` | `## Blocked Waves` |
| Completeness-critic findings | — | `## Integration Review` |

Nothing is swallowed. If a cap fires and nothing is logged, that is a bug in the workflow.
