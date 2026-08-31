# Plan Markers — the Parallel-Execution Contract

> **Audience: the authoring agent.** The operator brainstorms and signs; they never
> write this artifact. Every imperative below addresses the agent doing the authoring —
> which since #243 derives a plan one wave at a time at execution, rather than a whole
> task graph up front. The change was **horizon, locus and signing boundary**, never
> human→machine: an agent authored these before and an agent authors them after.

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
- `**Commutes:**` — optional; comma-separated backticked paths, each of which
  must also appear in this task's own `**Files:**` block. It asserts that this
  task's edits to those files are order-insensitive additive registrations, so
  the engine may union them instead of resolving them. Declare it only when
  true — review audits the claim the way it audits a test contract. A path
  outside the task's own `**Files:**` block is surfaced as a marker conflict
  and dropped, never a compile error. Like every marker it belongs in the
  header block; after `**Files:**` it is discarded and `--check` refuses it.
<!-- /BAKE -->

Example:

````markdown
### Task 4: Wire the health probe

**Type:** implementation
**Depends-on:** 2, 3

**Files:**
- Modify: `app/server/server.ts`
````

`Depends-on` is **additive**: existence and interface edges are still inferred, and the
union of marker edges and inferred edges orders the waves. The kept `why` vocabulary is
`marker`, `text`, `interface`, and `write-after-create` — plus `write-after-write` only
under the `--overlap serialize` rollback knob. Concurrent same-file **text** writes are
not an ordering signal at all: the fold path resolves them at merge, so the compiler
emits no edge for them. `**Depends-on:** none` asserts the author expects no incoming
edges; if another rule still finds one, the conflicting edge wins — explicit text edges
included (the conflict entry's `edge` field carries the literal `why` label) — and the
disagreement is surfaced in the transparency block under `marker_conflicts`, never
silently dropped.

A dependency that lives **only** inside a test's `import` of a sibling task's symbol is
invisible to the compiler by design — it infers edges from markers, `Files:` paths, and
`Interfaces:` symbols, never from source or test *file contents*. An explicit
`**Depends-on:**` on the importing task is now the **only** thing that orders a `Test:`
against a file a sibling creates; declare it, or the two run in parallel off a base where
the imported sibling does not yet exist and the wave cascade-blocks.

Markers are honored only in the **header block** — the contiguous run of marker lines (and blanks) immediately after the task heading. The first other line (a description paragraph, the `**Files:**` line, a checkbox step) ends the block; marker-shaped lines after it are ignored and surfaced in `marker_conflicts`, never trusted. Repeated `**Depends-on:**` lines accumulate; `none` combined with concrete ids is contradictory — the ids win, surfaced as a conflict. Contradictory `**Type:**` markers keep the first and surface the rest; near-miss spellings, colon placement, or missing values (`**type:**`, `**Depends-On:**`, `**Type**:`, a bare `**Depends-on:**`) are flagged for correction rather than silently treated as prose; a Files entry with an unknown or wrong-case label (`Delete:`, `modify:`) is a loud, named compile-time violation carrying a did-you-mean canonical-label fix (see Files grammar below) — never silently dropped; a canonical-label line with a wrong colon spacing, bullet character, or unbackticked multi-path value is a formatting-only near-miss, still tolerated and surfaced-but-dropped from overlap inference so one stray bullet never fails the whole compile; and a heading that fails the `### Task <id>:` shape — including wrong heading levels like `## Task 2:` — is a loud compile error (it would silently fold its task into the previous one).

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
the phrase "on the deployment". The gate heuristic also has a build/QA arm: a task whose `writes` set is empty and whose steps are build/verification-only (no implementation verb in its prose) is classified `gate`, not `implementation` — an empty-Files task has no contention surface to schedule against, so calling it implementation would only obscure the plan. All such classifications arrive flagged for
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

The compiler orders only what the plan states. It no longer guesses an ordering from a
backticked filename in prose, from a glob-shaped path, or from an undeclarable write
set; each of those is now a **refusal** rather than a soft serializing edge:

- a `**Files:**` path containing a glob character — `*`, `?`, `[`, or a `{a,b}` brace
  expansion — is a violation naming the offending path;
- `catch-all` is not a Files label: it is refused as an unknown label with a
  did-you-mean pointing at the canonical labels;
- a **marked** `implementation` task whose `**Files:**` block declares no path at all is
  refused ("declares no file paths under Files:") — a `Test:`-only block satisfies it,
  and heuristically classified (unmarked) tasks are exempt.

## Files grammar

A `**Files:**` bullet is a canonical label, a colon, and one backticked path —
nothing else:

- **Canonical labels:** `Create`, `Modify`, `Test` (`Test fixture(s)` /
  `Fixture(s)` remain accepted aliases). Any other label — an unknown verb
  (`Delete:`, `Read:`, `Remove:`, `catch-all:`) or a wrong-case spelling of a
  known one (`modify:`) — is a compile-time violation naming a canonical
  replacement (a `Delete:`/`Remove:` line suggests `Modify`, a `Read:` line
  suggests `Test`, an `add:` line suggests `Create`).
- **One backticked path per bullet, nothing trailing it.** A parenthetical note
  after the path (`` `src/lib/db.js` (only the pool init, lines 12-40) ``)
  is a violation: the note belongs in the task's prose, never on the Files
  line, because an annotated line would otherwise contribute nothing to
  write-overlap inference and a same-wave collision could hide behind it.
- **No globs.** `*`, `?`, `[`, or a `{a,b}` brace expansion in a path is a
  violation naming the offending path — enumerate the concrete files the task
  touches instead. Brace globs are refused outright; there is no softer
  serializing fallback for an unenumerated write set.
- **No open write sets.** `catch-all` is not a label (see above). A task whose
  writes genuinely cannot be scoped to concrete paths is not schedulable —
  split it until it is, or mark it `gate`/`manual`.
- **The canonical empty form** is `**Files:** none` (header-inline) or a lone
  `- none` bullet under the header — legal for `gate`/`release`/`manual`
  tasks, and the one shape a **marked** `implementation` task may not use: it
  is refused with "declares no file paths under Files:".

`scripts/compile_plan.py --check <plan.md>` runs this grammar — plus the
Interfaces grammar below — over an entire plan in one pass, printing every
violation with its did-you-mean fix and exiting 2, or printing `PLAN OK` and
exiting 0. Plain compile enforces the same rules but stops at the first
violating task (`SystemExit`) instead of collecting every one. `--check --renders`
appends the advisory renders after the verdict — P1 Produces blast-radius (code
files at BASE outside a task's Files that mention a Produces symbol) and P2
referent-existence (paths, `report.json` fields, `Task N` refs the body names
that resolve nowhere); every such line starts with `ADVISORY `, and the verdict
and exit code are unchanged (#345).

## Interfaces grammar

A `**Interfaces:**` `Consumes:`/`Produces:` value is valid grammar in either of
two shapes — the compiler rejects neither:

- **Symbol-led** — the value **LEADS with the symbol it names**: a backticked
  identifier, or a bare identifier optionally followed by its signature
  (`` `helper(x: int) -> str` ``, or a bare `helper` / `helper(x: int) -> str`).
  Comma-separate several to name more than one (a symbol list). **Only a
  symbol-led value tokenizes to a symbol that can pair against a sibling's
  contract to form a dependency edge** — so recommend a symbol-led value for
  anything a sibling consumes.
- **Free prose** — a sentence describing the contract in words rather than
  leading with a symbol. It documents the interface for a human reader but
  tokenizes to empty (a bare word trailed by more prose never leads with a
  symbol), so it never forms an edge. This is valid grammar, not a violation;
  the compiler simply infers no interface edge from it.

A **placeholder** value — `nothing`, `none`, `n/a`, `na`, bare or followed by
trailing prose (`nothing (test-data-only change)`, `none — standalone`) —
tokenizes to empty and can never pair into an interface edge. Placeholder
Consumes/Produces lines are always legal; they are the correct way to say
"this task has no interface contract."

## Authoring rules that complement the markers

For the plan author (loaded at writing time by the `ultraplan` skill):

- Make every task body self-contained; coordination knowledge lives in the affected
  task's body, never only in a preamble.
- Encode ordering as `**Depends-on:**` on the downstream task; never write global
  ordering prose.
- Let same-file edits stand. Concurrent same-file text writes fold at merge, so never
  split a feature, chain a fan, or add a `**Depends-on:**` to dodge a collision. Declare
  `**Commutes:**` on shared append-natured surfaces — registration surfaces (route
  tables, export lists, manifests) and shared test modules where two tasks each append
  test functions to the same file; both writers declare it, and only for append-shaped
  edits. Chain only non-text (binary/symlink) same-file pairs, which always fall back.
  Blast radius follows the contract, not the file: a task that changes a declared
  `Produces:` shape owns every strict-equality pin of it, in any sibling's file —
  list that file in its own `**Files:**` (#233).
- Name only what exists: every path, `report.json` field, or task a body cites must
  exist at BASE, be created by a task it `Depends-on`, or be defined in
  `report-format.md` — a phantom referent is a dead letter across worktrees. Run
  `scripts/compile_plan.py --check --renders <plan.md>` and read its `ADVISORY`
  blast-radius and referent lines before handoff.
- Never instruct branch creation — the executor owns branching.
- Give every test a unique port / temp path so same-wave suites can run concurrently.
- Mark gates, releases, and manual steps explicitly so nothing rides on heuristics.
- Spike tasks that spawn the real agent CLI must isolate `CLAUDE_CONFIG_DIR` (or disable session persistence) — a spawned session can otherwise write false memories or session state into the host project.

(End of plan-markers.md.)
