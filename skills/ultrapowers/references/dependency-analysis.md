# Dependency Analysis: Plan Doc → Task DAG → Waves

## Input

An approved `superpowers:writing-plans` plan document — headed `# <Feature> Implementation Plan`,
with a numbered list of Tasks each titled `### Task N: <name>` and containing:

- A short title and description paragraph.
- A `**Files:**` block listing paths under `Create:`, `Modify:`, and optionally `Test:` sub-labels.
- One or more checkbox steps (`- [ ] …`) describing what the task does.
- Optionally, the parallel-execution markers from `plan-markers.md`: `**Type:**` and
  `**Depends-on:**` lines between the task heading and the `**Files:**` block.

Parse each task to extract two file sets:

- **writes** = `Create:` paths ∪ `Modify:` paths (files the task changes on disk).
- **reads** = `Test:` paths. A reader generates no outbound edges, but when another task writes a path this task reads, the compiler adds an edge writer → reader (`why: "read-after-write"`) — you cannot test a file that does not exist yet.

Extract each task's verbatim body **fence-aware**: a heading inside a ``` code fence
is content, not a section boundary — plans routinely embed whole markdown documents
inside their steps.

---

## Classify Before Building the DAG

**Run the compiler on every plan, marked or not:** `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/compile_plan.py <plan-path>`. It implements the classification heuristics itself and flags every non-marker judgment `"heuristic": true`. On a **marked** plan, use its JSON verbatim for the `dag_edges`, `dispositions` (rendered from `tasks[].disposition` plus `gates`), `marker_conflicts`, `post_merge_runbook`, `waves`, `mode`, and `degrade_reason` of the transparency block, reserving judgment for heuristic-flagged entries. On an **unmarked** plan, treat the same JSON as the draft analysis: verify every flagged classification and inferred edge against `plan-markers.md` before adopting it — never hand-derive from scratch what the compiler already computed.

Classify every task per `plan-markers.md` — trust an explicit `**Type:**` marker;
otherwise apply the contract heuristics there (release → manual → gate →
implementation, in that precedence). The dispositions:

- **implementation** — enters the DAG below.
- **gate** — leaves the task set. Compile it into run configuration: its suite
  command informs `testCmd`; its expectations are listed in the transparency block
  so the human sees what the engine's per-wave merge tests and completeness critic
  now cover. Never executed as a task.
- **release** / **manual** — leaves the task set. Collect verbatim, in document
  order, into the **post-merge runbook** (rendered with the final report; handed to
  `superpowers:finishing-a-development-branch` on approval). Never run headless,
  never silently dropped.

While classifying, also:

- **Inline preamble knowledge.** Coordination notes living outside task bodies
  (ordering sections, port tables, exclusion lists) must be copied into the bodies
  of the tasks they affect — task agents see only their own `body`.
- **Supersede blanket ordering prose.** "Execute phases in order" converts to edges
  only where it names concrete task pairs; otherwise the computed DAG supersedes it
  and the supersession is recorded as a judgment line in the transparency block.

---

## Build the DAG

For every ordered pair of tasks (A, B) where A ≠ B, add a directed edge **A → B** (meaning B depends on A) when any of the following hold:

1. **Explicit marker:** B carries `**Depends-on:**` naming A. Marker edges are
   **additive** to the inferred rules below — the union orders the waves.
   `**Depends-on:** none` asserts the author expects no incoming edges; if inference still finds one, the inferred edge wins (its `why` is named in the conflict note) and the disagreement is surfaced in the
   transparency block under `marker_conflicts`.
2. **Write-after-create:** B's `Modify:` set contains a path that appears in A's `Create:` set. B cannot modify a file that does not exist yet.
3. **Write-after-write (same file):** A's `writes` set and B's `writes` set share at least one path. Concurrent writes to the same file are never safe; serialize them in document order (A before B if A appears first in the plan).
4. **Explicit text dependency:** B's task body contains a phrase matching `depends on Task A`, `after Task A`, or `requires Task A` (case-insensitive, where A is the task NUMBER exactly as written in the heading). Task titles and phase-level prose are NOT matched — convert them to `**Depends-on:**` markers on the downstream task (ultraplan authoring rule 2).
5. **Read-after-write:** A's `writes` set shares a path with B's `reads` set → edge A → B. Like write-after-create, this applies regardless of document order.

Collect all edges into an adjacency list. Each node is identified by its task number (T1, T2, …, TN).

Edge `why` labels emitted by the compiler: `marker`, `write-after-create`, `write-after-write`, `read-after-write`, `text`, `ambiguous-files`.

Precedence: document-order heuristics (write-after-write, ambiguous-files) yield to any opposing explicit or semantic edge (marker, text, write-after-create, read-after-write). A cycle that survives this precedence is a genuine plan contradiction — surfaced as a loud error, never resolved by guessing.

---

## Group into Waves

Apply topological layering (Kahn's algorithm) to produce `waves: Task[][]`:

1. Compute in-degree for every node.
2. **Wave 0:** all nodes with in-degree 0.
3. Remove wave-0 nodes and decrement in-degrees of their successors.
4. **Wave 1:** all nodes now with in-degree 0. Repeat until the graph is empty.

Each wave is a set of tasks that can execute in parallel — their dependencies are fully satisfied by all prior waves.

---

## Conservative Defaults

Apply these rules before finalizing the DAG:

- **Ambiguous Files block:** if an `implementation` task's `**Files:**` block is missing, empty, or contains glob patterns that cannot be resolved statically, treat that task as depending on all tasks that precede it in the document. (Gates and release/manual tasks have already left the set during classification — this default applies only to tasks classified `implementation`.) Place it in its own wave after those tasks. The compiler implements this mechanically: an `implementation` task with no parsed `Create:`/`Modify:`/`Test:` paths, or with glob characters in any path, gets `ambiguous-files` edges from every preceding implementation task AND into every following one — serializing it into its own wave at its document position.
The remaining two defaults are hand-derivation guidance only — the compiler is static and does not inspect the repo; apply them when reviewing heuristic-flagged output:

- **Implicit shared directories:** if two tasks each create or modify files in the same directory AND one task's description mentions scaffolding, initialization, or setup, serialize the scaffolding task before the other.
- **Unknown paths:** a path that does not exist in the repo yet counts as a `Create:` — do not assume it is safe to write concurrently with another task that also lists that same path.

---

## Cycle Detection

After building the adjacency list, run cycle detection before accepting any waves — the compiler detects cycles as tasks Kahn layering cannot place; when hand-deriving, DFS works too.

If a cycle is found:

1. **Abort wave computation immediately.**
2. Surface the offending edge list to the human in plain language: The compiler reports the unplaceable tasks: `compile_plan: cycle detected among tasks A, B — revise the plan to break it; refusing to guess an ordering.` When hand-deriving, name the offending edges too.
3. Ask the human to revise the plan to break the cycle — do not guess an ordering or silently drop an edge.

---

## Small-Plan Degrade

If either condition is true:

- Implementation task count ≤ 2 (counted after classification removes gates, release, and manual tasks), **or**
- Every task shares at least one path in its `writes` set with every other task (fully overlapping writes)

…emit one single-task wave per task in topological (Kahn) order — `[[T1], [T2], …]` — so dependency edges are still honored. The run flows through the standard workflow machinery (worktrees, per-task review, per-wave merge); sequential mode simply means no two tasks ever execute concurrently. The compiler's `degrade_reason` reads `Sequential mode: N implementation tasks` (suffixed with `, fully overlapping writes` when that trigger fired).

---

## Transparency: Computed Output

This block is what the main agent renders at the **Step-3 wave-plan approval gate** (see `SKILL.md`)
so the human can sanity-check the parallelization before launch. The waves, dependency edges, and
post-merge runbook reappear in the final report; the full block itself is rendered only at the
Step-3 gate. Record the following:

```
dag_edges:
  - T1 → T3  (T3 modifies app/foo.ts created by T1)
  - T2 → T3  (explicit: "after Task 2")
  - T2 → T4  (marker: "Depends-on: 2")

dispositions:
  - T5: gate → compiled into testCmd / wave verification (not executed)
  - T6: release → post-merge runbook
marker_conflicts: []        # e.g. "Depends-on: none" overridden by a file edge
inlined_notes:
  - "port table from the preamble → T3, T4 bodies"

post_merge_runbook: [T6]    # rendered with the final report, in document order

derived_knobs:
  testCmd: python3 -m pytest tests/ -q
  baseBranch: main
  review: { T1: adversarial, default: lean }
  tierOverrides: {}

waves:
  wave_0: [T1, T2]
  wave_1: [T3]
  wave_2: [T4]

mode: parallel   # or "sequential" if small-plan degrade applied
degrade_reason:  # populated only in sequential mode
```

Include this block verbatim in the agent's report so reviewers can audit the scheduling decisions without re-running the analysis.
