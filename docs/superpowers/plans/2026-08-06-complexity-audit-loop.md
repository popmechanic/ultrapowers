# Complexity-Audit Loop Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codify the operator's standing complexity requirement durably — the adversarial trim review at spec approval and the adopted-proposal retrospective at distill — per spec `docs/superpowers/specs/2026-08-06-complexity-audit-loop-design.md` (issue #119; the practice has run in-session for the whole 2026-08-06 sweep, ten live dispatches).

**Architecture:** Two prose surfaces, no machinery: one binding sentence in CLAUDE.md's "How features are built here", and an append to `skills/ultralearn/references/distilling-proposals.md` carrying the trim-reviewer dispatch brief, the `## Trim review` spec-section format, and the cluster-died retrospective rule.

**Tech Stack:** Markdown.

**Acceptance:** suite — the committed suite is the verification.

## Global Constraints

- Only `CLAUDE.md` and `skills/ultralearn/references/distilling-proposals.md` change. No scripts, no new files, no agent-registry entries, no gate changes.
- The appended doctrine text must match the spec's amended (post-trim-review) design: one named practice ("trim review"), reviewer owns the `netConceptDelta` grade, reversal drafts trigger on **second** persistence.
- Suite gate: `python3 -m pytest` green (in particular `test_version_sync.py`, which reads CLAUDE.md).

---

### Task 1: The binding sentence + the doctrine append

**Type:** implementation
**Depends-on:** none
**Review:** lean

**Files:**
- Modify: `CLAUDE.md`
- Modify: `skills/ultralearn/references/distilling-proposals.md`

**Interfaces:**
- Consumes: nothing from other tasks (single-task plan).
- Produces: nothing consumed by other tasks.

Tier: cheap.

- [ ] **Step 1: Add the CLAUDE.md binding sentence**

In "How features are built here", after the sentence describing the brainstorm → spec flow, add:

> Every spec gets an **adversarial trim review** before operator review — a fresh-context subagent proposing the trimmed version (dispatch brief in `skills/ultralearn/references/distilling-proposals.md` §Trim review); the spec carries a `## Trim review` section with adopt-or-answer for every trim, and the reviewer — never the author — grades `netConceptDelta`.

- [ ] **Step 2: Append the trim-review brief + retrospective rule to distilling-proposals.md**

Append the following two sections verbatim:

```markdown
## The trim review (spec approval — every spec in this repo)

Before any spec is presented for operator review, dispatch **one**
fresh-context subagent — the seal-author independence model. Its inputs are
ONLY: the spec text, the originating proposal/issue text, and this file.
Never the authoring conversation.

Its mandate, three parts:

1. **Propose the trimmed version** — for each design element: could it be
   deleted, narrowed, or merged with what exists, without losing the claimed
   value? Where useful, also flag under-specification (an authority-granting
   or periphery-touching spec can fail by being too thin).
2. **Reconcile scope** — did the design grow beyond the originating
   proposal's claimed `complexityEffect`/`netConceptDelta`? Name every
   expansion.
3. **Grade `netConceptDelta` itself** — the author never grades their own
   design.

Bounded: one dispatch, no loops, no fix authority. Give the reviewer the
relevant code files when the spec changes code — the strongest catches come
from reviewers grounded in what exists.

The spec then carries a `## Trim review` section: the author's compact
Adds/Removes disclosure (input to the reviewer, not a verdict), the
reviewer's verdicts and grade, and an **adopt-or-answer** entry for every
trim — rejections visible with reasons; the operator adjudicates. A
no-findings review is recorded as such and the spec proceeds: the check is
advisory to the operator, never a false-red gate.

## The adopted-proposal retrospective (every distill — the cluster-died check)

Required distill output: for every previously adopted proposal whose fix has
shipped in a released version, compare its target cluster's recurrence in
ledger findings at `engineVersion >=` the adopting release.

- **First persistence** → flag the proposal **possibly-failed fix**.
- **Second persistence** → drafting the reversal (or the corrected fix) is
  mandatory distill output — the same recurrence bar this doctrine applies
  to everything else.

This generalizes the `canaryMetric` reverse-check from rigor trades to all
adopted proposals with a named target cluster, at instruction-only cost.
Adoption of any reversal stays operator-gated, as ever.
```

- [ ] **Step 3: Run the suite**

Run: `python3 -m pytest`
Expected: green, including `test_version_sync.py` (the CLAUDE.md edit is outside the versioning prose it reads).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md skills/ultralearn/references/distilling-proposals.md
git commit -m "feat(#119): complexity-audit loop codified — trim review at spec approval; cluster-died retrospective at distill"
```
