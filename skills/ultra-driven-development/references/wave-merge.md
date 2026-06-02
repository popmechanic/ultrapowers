# Wave Merge Reference

How a wave's worktree branches get merged into one integration branch, reconciled on failure, and finally reviewed.

---

## Integration Branch

The workflow script cannot run git (no shell or filesystem access), so all git operations are delegated to agents. Before Wave 1 begins, the controller dispatches a **setup agent** whose sole job is to create the integration branch in the main checkout:

```
git checkout -b ultra/integration-<timestamp>
```

The timestamp is passed in via `args` at workflow startup — workflows cannot call `Date.now()`. The setup agent confirms the branch name and HEAD sha back to the controller, which stores both for use in subsequent merge steps.

---

## Worktree and Branch Facts

Task agents run in isolated worktrees at:

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
3. After all merges succeed, detects and runs the project's test command by checking in order: `pnpm-lock.yaml` → `pnpm check`; `package.json` (no pnpm lock) → `npm test`; `pytest.ini` / `pyproject.toml` / `setup.py` → `pytest`; `Cargo.toml` → `cargo test`; `go.mod` → `go test ./...`.
4. Reports back: success with final integration HEAD sha, or failure with the conflict diff or failing test output.

---

## Reconciliation

On a merge conflict or a failed post-merge test, the controller dispatches a single **reconciliation agent**. It receives the conflict diff or failing test output alongside the full task context and is expected to resolve the issue on the integration branch and re-run the test command.

Caps and failure handling:

- The fix loop is capped at **2 attempts**. Each attempt and its outcome are logged via `log()`.
- If the reconciliation agent fails both attempts, the wave is marked **`blocked`**.
- Its branches are left intact — do not delete worktrees for a blocked wave.
- The blocked wave, its conflict/diff, and the failing output are recorded in the final report.
- The run continues with subsequent waves **unless** a downstream wave declares a hard dependency on the blocked wave's output. If it does, that downstream wave is also marked `blocked` (cascading block), logged, and skipped — but waves without that dependency proceed normally.
- Do not abort the whole run for a single blocked wave unless every remaining wave depends on it.

---

## Integration and Completeness Review

After the final wave's merge agent completes successfully (or is blocked), the controller:

1. Runs the full test suite one more time on the integration branch from the main checkout, regardless of whether the last wave passed its own test run. Log the result.
2. Dispatches a **completeness-critic agent** using `superpowers:verification-before-completion`. Its prompt: "What plan requirement is unmet? What claim is unverified? What code path is untested?" The agent receives the original plan, the full list of tasks, the blocked-wave log (if any), and the final test output.
3. All findings from the critic — gaps, unverified claims, untested paths — are appended to the run report verbatim.

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
