# Plan Markers — the Parallel-Execution Contract

Additive per-task annotations on a `superpowers:writing-plans` document that make
wave compilation deterministic. Sequential executors (subagent-driven-development,
executing-plans) ignore them; ultrapowers trusts them. A plan without markers still
runs — `dependency-analysis.md` falls back to the classification heuristics below.

## The worktree-pure task contract

An ultrapowers task is **a pure diff against the integration branch**. Concretely it:

- pushes nothing to any remote and never checks out or merges a long-lived branch;
- needs no human interaction between launch and final commit;
- mutates nothing outside its own worktree — no deploys, no ssh, no launchd/systemd
  installs, no writes to shared services;
- is verified by tests that can run concurrently with other tasks' tests (unique
  ports, temp paths, no shared on-disk fixtures).

A task that satisfies the contract is waved. A task that violates it is classified
out of the DAG (see Type semantics). Classification is evidence checked against this
invariant, not pattern-matching a list of known-bad idioms — new idioms classify
correctly as long as the contract is what gets tested.

## Marker syntax

<!-- BAKE:MARKER_SYNTAX -->
Markers are bold-labeled lines placed immediately after the task heading, before the
`**Files:**` block:

- `**Type:**` — one of `implementation` (the default when absent), `gate`,
  `release`, or `manual`.
- `**Depends-on:**` — comma-separated task IDs from the plan's own numbering
  (`2`, `A3`, `C4b`), or `none`.
- `**Review:**` — optional; one of `adversarial` or `lean`. Names the tasks that
  earn a second independent review pass. Unmarked tasks are `lean`. An invalid
  or duplicate value is a compile error.
<!-- /BAKE -->

Example:

````markdown
### Task 4: Wire the health probe

**Type:** implementation
**Depends-on:** 2, 3

**Files:**
- Modify: `app/server/server.ts`
````

`Depends-on` is **additive**: file-overlap edges are still inferred, and the union of
marker edges and inferred edges orders the waves. `**Depends-on:** none` asserts the
author expects no incoming edges; if another rule still finds one, the conflicting edge wins — explicit text edges included (the conflict entry's `edge` field carries the literal `why` label: `write-after-create`, `write-after-write`, `read-after-write`, `prose-reference`, `text`, or `ambiguous-files`)
and the disagreement is surfaced in the transparency block
under `marker_conflicts` — never silently dropped.

A dependency that lives **only** inside a test's `import` of a sibling task's symbol is
invisible to the compiler by design — it infers edges from markers, `Test:` path overlap,
and prose references, never from source or test *file contents*. When a task's **test**
imports a symbol a sibling task owns, declare it as an explicit `**Depends-on:**` on the
importing task; otherwise the two run in parallel off a base where the imported sibling does
not yet exist and the wave cascade-blocks.

Markers are honored only in the **header block** — the contiguous run of marker lines (and blanks) immediately after the task heading. The first other line (a description paragraph, the `**Files:**` line, a checkbox step) ends the block; marker-shaped lines after it are ignored and surfaced in `marker_conflicts`, never trusted. Repeated `**Depends-on:**` lines accumulate; `none` combined with concrete ids is contradictory — the ids win, surfaced as a conflict. Contradictory `**Type:**` markers keep the first and surface the rest; near-miss spellings, colon placement, or missing values (`**type:**`, `**Depends-On:**`, `**Type**:`, a bare `**Depends-on:**`) are flagged for correction rather than silently treated as prose; Files entries with a wrong label case, colon spacing, bullet character, or unbackticked multi-path values are surfaced and dropped from overlap inference; and a heading that fails the `### Task <id>:` shape — including wrong heading levels like `## Task 2:` — is a loud compile error (it would silently fold its task into the previous one).

`Depends-on` edges bind only between `implementation` tasks: a marker naming a `gate`/`release`/`manual` task (or an unknown id) is dropped at compile time and surfaced in `marker_conflicts` — ordering against excluded tasks is meaningless once they leave the wave set. The same drop-and-surface rule covers text dependencies naming excluded tasks, and self-referential markers.

## Type semantics (dispositions)

<!-- BAKE:TYPE_SEMANTICS -->
- `implementation` — a worktree-pure diff. Waved and executed.
- `gate` — verification only (suite, lint, status checks); writes nothing. Compiled
  into run configuration: its suite command informs `testCmd`, its expectations are
  listed in the wave-plan transparency render. Never executed as a task.
- `release` — publish ritual: version bumps, pushes, marketplace re-pins, deploys.
  Excluded from the waves; carried verbatim into the post-merge runbook.
- `manual` — requires a human or another machine (credentials, hardware, owner
  action). Excluded from the waves; carried verbatim into the post-merge runbook.
<!-- /BAKE -->

## Executor variance

The dispositions above bind **ultrapowers**. A sequential executor
(subagent-driven-development, executing-plans) reads the same plan and treats
every task — including `gate`, `release`, and `manual` — as an ordinary task to
execute in document order. As of superpowers 5.1.0 both sequential executors run **continuously**
(executing-plans dropped its batch checkpoints in 5.0.0; subagent-driven-development's explicit directive landed in 5.1.0) — subagent-driven-development explicitly instructs "Do not pause
to check in with your human partner between tasks" — so a `release` push or a
`manual` owner step in the plan **executes inline without fresh human eyes**. The
safety comes from plan approval (the human approved exactly those steps when
approving the plan) and from placement (put `release`/`manual` tasks LAST, so
nothing irreversible runs before all implementation work has landed and been
reviewed). When ultrapowers itself falls back to a sequential executor (SKILL.md
Step 6), it withholds `release`/`manual` tasks from the handoff and carries them
as the post-merge runbook instead. The semantic difference to author for:

- `gate` — ultrapowers compiles it into run config; a sequential executor runs
  it as written. Write gates so both work: pure verification commands, no writes.
- `release` / `manual` — ultrapowers defers them to the post-merge runbook; a
  sequential executor runs them inline at their document position. Place them
  LAST in the plan so the inline execution order equals the deferred order.

## Classification heuristics (unmarked plans)

For tasks without a `**Type:**` marker, classify by evidence, in this precedence:

1. **release** — any step contains `git push`, checks out or merges a long-lived
   branch (`git checkout main`), deploys (`ssh`, `scp`, `systemctl`, provider CLIs),
   or the body says to run "after the branch merges".
2. **manual** — steps are addressed to the owner / a human ("the owner runs…",
   "cannot be done from this machine") or need credentials/hardware the repo does
   not contain.
3. **gate** — the `**Files:**` block is `none`, empty, or missing AND every step
   only runs tests, linters, `git status`, or `git log`.
4. otherwise **implementation**.

Precedence matters: a task that pushes AND verifies is `release`, not `gate`. The
empty-Files conservative default in `dependency-analysis.md` applies only to tasks
that classify as `implementation`.

The executable compiler (`scripts/compile_plan.py`) implements these heuristics as
a conservative regex subset: release evidence is the literal patterns `git push`,
`git checkout main`, `git merge main|master`, `ssh`, `scp`, `systemctl`, and "after
the branch merges" — it does not recognize provider CLIs or other deploy idioms by
name. The gate and manual heuristics are likewise regex subsets: gate fires on "no
write paths plus any test-runner/lint/git-status mention in the prose" (an existence
check, not a proof that every step is read-only), and on the Files axis it is broader than the contract: a `Test:`-only Files block counts as 'no writes', and manual additionally fires on
the phrase "on the deployment". The gate heuristic also has a build/QA arm: a task whose `writes` set is empty and whose steps are build/verification-only (no implementation verb in its prose) is classified `gate`, not `implementation` — otherwise the empty Files block would draw an ambiguous-files fan-in from every upstream task and force a serial tail. All such classifications arrive flagged for
re-judgment. Heuristic classifications are flagged `"heuristic": true` in its output
precisely so the orchestrating agent re-judges them against the full contract above.

## Compile-time obligations

Whatever the classification source (marker or heuristic), the compiling agent MUST
(the mechanical obligations — task splitting, fence-aware extraction, classification,
edges, runbook collection — are implemented by `scripts/compile_plan.py`; preamble
inlining and ordering-prose supersession remain the orchestrating agent's judgment,
recorded in the transparency block):

- record every non-`implementation` disposition in the Step-3 transparency block —
  the rendered **interpretation** of the plan (not just the wave grouping) is the
  human's audit surface, and it reappears with the final report;
- collect `release` and `manual` tasks, verbatim and in document order, into the
  **post-merge runbook**, rendered with the final report; on approval the
  orchestrating agent carries it through the finishing-a-development-branch
  handoff and presents it as the follow-up list (the upstream skill accepts no
  checklist input);
- inline preamble coordination notes into the bodies of the tasks they affect —
  task agents see only their own `body`;
- convert global ordering prose ("execute phases in order") into edges only where it
  names concrete task pairs; blanket ordering is superseded by the computed DAG and
  the supersession is recorded as a judgment line;
- extract task bodies **fence-aware** — a heading inside a ``` code fence is content,
  not a section boundary (tilde `~~~` fences too; classification evidence and text
  dependencies are likewise matched against fence-stripped prose only — fenced
  examples never drive classification or edges) (plans embed whole markdown documents
  in their steps).

## Authoring rules that complement the markers

For the plan author (loaded at writing time by the `ultraplan` skill):

- Make every task body self-contained; coordination knowledge lives in the affected
  task's body, never only in a preamble.
- Encode ordering as `**Depends-on:**` on the downstream task; never write global
  ordering prose.
- Describe a sibling task **by role, not by filename**. In a `Produces:`/`Consumes:`
  interface field — and in any description prose before the first `- [ ]` step — name
  what the sibling *does*, never its output path. Backticking a sibling's filename in a
  description field injects a *phantom* serializing edge: the compiler cannot tell a real
  dependency from a passing mention, so it infers the edge and warns `description-inferred`.
  The write-time fix is not to add a `**Depends-on:**` — it is to not write the filename.
  Reserve backticked paths for this task's own `**Files:**` entries.
- Never instruct branch creation — the executor owns branching.
- Give every test a unique port / temp path so same-wave suites can run concurrently.
- Mark gates, releases, and manual steps explicitly so nothing rides on heuristics.

(End of plan-markers.md.)
