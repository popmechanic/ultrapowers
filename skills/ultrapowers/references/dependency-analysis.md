# Dependency Analysis: Plan Doc → Task DAG → Waves

## Input

An approved `superpowers:writing-plans` plan document — headed `# <Feature> Implementation Plan`,
with a numbered list of Tasks each titled `### Task N: <name>` and containing:

- A short title and description paragraph.
- A `**Files:**` block listing paths under `Create:`, `Modify:`, and optionally `Test:` sub-labels.
- One or more checkbox steps (`- [ ] …`) describing what the task does.

Parse each task to extract two file sets:

- **writes** = `Create:` paths ∪ `Modify:` paths (files the task changes on disk).
- **reads** = `Test:` paths are treated as reads only — they do not generate outbound edges unless another task also writes them.

---

## Build the DAG

For every ordered pair of tasks (A, B) where A ≠ B, add a directed edge **A → B** (meaning B depends on A) when any of the following hold:

1. **Write-after-create:** B's `Modify:` set contains a path that appears in A's `Create:` set. B cannot modify a file that does not exist yet.
2. **Write-after-write (same file):** A's `writes` set and B's `writes` set share at least one path. Concurrent writes to the same file are never safe; serialize them in document order (A before B if A appears first in the plan).
3. **Explicit text dependency:** B's task body contains a phrase matching `depends on Task A`, `after Task A`, or `requires Task A` (case-insensitive, where A is the task number or title).

Collect all edges into an adjacency list. Each node is identified by its task number (T1, T2, …, TN).

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

- **Ambiguous Files block:** if a task's `**Files:**` block is missing, empty, or contains glob patterns that cannot be resolved statically, treat that task as depending on all tasks that precede it in the document. Place it in its own wave after those tasks.
- **Implicit shared directories:** if two tasks each create or modify files in the same directory AND one task's description mentions scaffolding, initialization, or setup, serialize the scaffolding task before the other.
- **Unknown paths:** a path that does not exist in the repo yet counts as a `Create:` — do not assume it is safe to write concurrently with another task that also lists that same path.

---

## Cycle Detection

After building the adjacency list, run DFS-based cycle detection before computing any waves.

If a cycle is found:

1. **Abort wave computation immediately.**
2. Surface the offending edge list to the human in plain language: "Cycle detected: T3 → T5 → T3 via shared file `foo/bar.ts`."
3. Ask the human to revise the plan to break the cycle — do not guess an ordering or silently drop an edge.

---

## Small-Plan Degrade

If either condition is true:

- Total task count ≤ 2, **or**
- Every task shares at least one path in its `writes` set with every other task (fully overlapping writes)

…collapse to a single sequential wave `[[T1, T2, …, TN]]` in document order and skip worktree machinery entirely. Log the reason: `"Sequential mode: N tasks, overlapping writes."` Run tasks one at a time in the main worktree.

---

## Transparency: Computed Output

This block is what the main agent renders at the **Step-3 wave-plan approval gate** (see `SKILL.md`)
so the human can sanity-check the parallelization before launch, and it is also included in the final
report (see `report-format.md`). Record the following:

```
dag_edges:
  - T1 → T3  (T3 modifies app/foo.ts created by T1)
  - T2 → T3  (explicit: "after Task 2")

waves:
  wave_0: [T1, T2]
  wave_1: [T3]
  wave_2: [T4]

mode: parallel   # or "sequential" if small-plan degrade applied
degrade_reason:  # populated only in sequential mode
```

Include this block verbatim in the agent's report so reviewers can audit the scheduling decisions without re-running the analysis.
