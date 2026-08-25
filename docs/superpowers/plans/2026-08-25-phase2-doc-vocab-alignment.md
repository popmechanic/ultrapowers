# Phase-2 Doc/Vocab Alignment Implementation Plan (#185)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every reference that plan authors and ultraplan read into line with the compiler as it exists after the Phase-2 tier deletion (0.2.17): the kept edge vocabulary is `marker`, `text`, `interface`, `write-after-create` (+ `write-after-write` under `--overlap serialize` only); the `read-after-write`, `prose-reference`, `ambiguous-files`, and catch-all tiers and the `--repo-root` eligibility pre-filter are gone.

**Architecture:** Pure doc subtraction across six files, no code. (T1) `references/dependency-analysis.md` — rewrite the reads rule, the write-after-write rule, delete the read-after-write and prose-reference rules, renumber, restate the edge-label list and the precedence paragraph in the kept vocabulary, replace the "Ambiguous Files block" default with the compile-time refusal the compiler actually performs, say ONCE that the runtime materialization guard is the sole fold-eligibility authority. (T2) the smalls: `design-rationale.md`'s war story (prose is no longer inferred — declare Interfaces/Depends-on), `SKILL.md`'s retired `--repo-root` sentence, `CLAUDE.md`'s one ragged 115-char line (fill only), the migration record's missing `text` row, and a one-line comment in `evals/frontier/schedule_model.py` — the `ambiguous-files` label is KEPT there because `tests/test_frontier_cell.py` and `tests/test_frontier_schedule.py` build synthetic edges with it (the docket's "drop only if the frontier tests still pass" condition fails, so it stays, labeled retired). The compiler and its diagnostic vocabulary are not touched (FROZEN).

**Tech Stack:** Markdown; one Python comment.

**Spec:** GitHub issue #185 plus its docket entry `docs/superpowers/docket.md` (`### #185`). Kept vocabulary ground truth: `tests/test_compile_plan.py` `KEPT_EDGE_WHYS = {"marker", "text", "interface", "write-after-create"}` and `test_undeclared_dependency_suppression_set_is_write_after_create_and_write_after_write`.

**Acceptance:** suite — docs only; the committed suite (doc pins in `tests/test_marker_compiler.py`, skill validators) is the verification, no held-out exam.

## Global Constraints

- The verification periphery is FROZEN: never touch `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `run_acceptance.sh`, `collect_seal.py`, `seal_hash.py`; `compile_plan.py` and its diagnostic vocabulary are not edited.
- `tests/test_marker_compiler.py` pins these strings in `dependency-analysis.md` and they must survive: `plan-markers.md`; `## Classify` before `## Build the DAG`; the four type names; `**Depends-on:**`; `additive`; `marker_conflicts`; `post-merge runbook`; `preamble`; `fence-aware`; `dispositions`; `compile_plan.py`; `derived_knobs`; `"heuristic": true`.
- After T1, `grep -n "read-after-write\|prose-reference\|ambiguous-files\|catch-all\|repo-root" skills/ultrapowers/references/dependency-analysis.md` returns nothing.
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `… skills/ultraplan` must pass.
- No Anthropic API calls or SDK anywhere; no new dependencies.
- The full gate is `python3 -m pytest`; every task leaves it green.

---

### Task 1: dependency-analysis.md — the kept vocabulary only

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/dependency-analysis.md`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing code-level.

- [ ] **Step 1: Input section — line-range sentence and the reads rule**

In **## Input**, change `…so two tasks editing different ranges of one file still overlap and serialize.` to `…so two tasks editing different ranges of one file still overlap.`

Replace the whole `- **reads** = …` bullet with:

```markdown
- **reads** = `Test:` paths. They count toward the same-file overlap set — upstream TDD tasks WRITE their test files — so two tasks sharing any path (written or tested) form an overlapping pair. Under `--overlap serialize` the pair serializes in document order unless an explicit or semantic edge already orders it; under the default `--overlap fold` the pair shares a wave and the engine folds the edits at merge time. There is no static eligibility pre-filter: the runtime materialization guard is the sole authority on whether a pair folds or falls back.
```

- [ ] **Step 2: Build the DAG — rules 3, 5, 6, 7**

Replace rule 3 (**Write-after-write**) with:

```markdown
3. **Write-after-write (same file, `--overlap serialize` only):** A's `writes` set and B's `writes` set share at least one path (the overlap set is `writes ∪ Test:` paths on both sides — see the reads bullet). Under `--overlap serialize` concurrent writes to one file are never safe, so the pair serializes in document order (A before B if A appears first in the plan). Under `--overlap fold` — the default since 0.2.0 — this tier creates no edge: the two tasks share a wave and the engine folds their same-file edits at merge time, with the runtime fold predicate authoritative; the pair is recorded in `dropped_pairs` (both orderings). A pair is droppable only where this tier would have created a NEW edge: forward document order, no edge already recorded for the pair (a `marker`, `text`, `interface`, or `write-after-create` edge keeps it serialized), and not cycle-blocked. Every other `why` label survives fold untouched.
```

Delete rule 5 (**Read-after-write**) and rule 6 (**Prose-reference**) entirely. Renumber rule 7 (**Interface**) to **5**, and inside it change `or a file-overlap edge (write-after-create / write-after-write / read-after-write)` to `or a file-overlap edge (write-after-create; write-after-write under `--overlap serialize`)`. Keep the rest of the interface rule verbatim (it names the `flawed` fixture and the undeclared-dependency finding).

- [ ] **Step 3: Edge labels and precedence**

Replace the `Edge `why` labels emitted by the compiler: …` line with:

```markdown
Edge `why` labels emitted by the compiler: `marker`, `text`, `interface`, `write-after-create` — plus `write-after-write` under `--overlap serialize` only.
```

Replace the `Precedence: …` paragraph with:

```markdown
Precedence: the document-order heuristic (`write-after-write`, serialize mode only) yields to any opposing PATH — reachability through ALL earlier-recorded edges, not just a direct reverse edge (a reverse path always contains at least one explicit or semantic edge, since the heuristic never creates cycles). A cycle that survives this precedence is a genuine plan contradiction — surfaced as a loud error, never resolved by guessing. `interface` sits between the semantic rules and the document-order heuristic: order-independent in direction (producer → consumer) but cycle-guarded, so an explicit or semantic edge in the opposite direction always wins.
```

- [ ] **Step 4: Conservative Defaults — the refusal, not a guess**

Replace the `- **Ambiguous Files block:** …` bullet with:

```markdown
- **Files-less or glob `Files:` blocks refuse:** a marked `implementation` task with no parsed `Create:`/`Modify:`/`Test:` path, or with glob characters in any path, is a compile-time refusal — `compile_plan.py --check` names the task and the fix — never a guessed ordering. (Gates and release/manual tasks have already left the set during classification.)
```

- [ ] **Step 5: Transparency block comment**

In the `marker_conflicts: []` comment block, change `kind: "inference" (a benign edge the compiler inferred — e.g. a file edge overriding "Depends-on: none", or a prose-reference edge)` to `kind: "inference" (a benign edge the compiler inferred — e.g. a file edge overriding "Depends-on: none", or an interface edge)`.

- [ ] **Step 6: Verify**

Run: `grep -n "read-after-write\|prose-reference\|ambiguous-files\|catch-all\|repo-root" skills/ultrapowers/references/dependency-analysis.md; echo exit=$?` — Expected: no lines, `exit=1`.
Run: `python3 -m pytest tests/test_marker_compiler.py tests/test_compile_plan.py -q` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/references/dependency-analysis.md
git commit -m "docs(compiler): dependency-analysis.md teaches the kept edge vocabulary only; pre-filter + deleted tiers removed (#185)"
```

---

### Task 2: The smalls — rationale citation, SKILL.md flag, CLAUDE.md fill, migration row, schedule_model comment

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/design-rationale.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `CLAUDE.md`
- Modify: `evals/frontier/results/2026-08-20-phase2-migration.md`
- Modify: `evals/frontier/schedule_model.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing code-level.

- [ ] **Step 1: design-rationale.md — the mixed-B-2 war story**

In `skills/ultrapowers/references/design-rationale.md` § *Dependency inference — the mixed-B-2 eval war story*, replace the sentence `That is the motivating failure behind the compiler's **prose-reference edge** (`references/dependency-analysis.md`) — an undeclared dependency expressed only in prose is serialized instead of cascading at runtime — and behind the **Salvage** path, …` with `A prose-only reference like that is no longer inferred: the prose-reference tier that once serialized it was deleted in Phase 2 (0.2.17), so the guard is authoring — declare the `**Interfaces:**` `Consumes`/`Produces` pair or the `**Depends-on:**` marker (`references/dependency-analysis.md`), and the compiler's loud `undeclared-dependency` finding catches a declared-but-unlinked pair at the Step-3 render. The same run motivated the **Salvage** path, …` keeping the remainder of the sentence and paragraph verbatim.

- [ ] **Step 2: SKILL.md — the retired flag**

In `skills/ultrapowers/SKILL.md` Step 1, delete the two lines `` `--repo-root` is always stamped onto the compile call — no operator input `` / `needed.` (the flag was retired with the pre-filter; `ultra_run.py` no longer stamps it).

- [ ] **Step 3: CLAUDE.md — fill the ragged line**

In `CLAUDE.md`'s FROZEN-periphery bullet, the 115-character line `   97-plan census) plus the T15 rig re-run (Task 12). Sealed acceptance is opt-in ("seal this plan"); `suite` is the` and its 22-character continuation `   default disposition.` become:

```
   97-plan census) plus the T15 rig re-run (Task 12). Sealed acceptance is
   opt-in ("seal this plan"); `suite` is the default disposition.
```

Fill only — no word changes. Verify with `awk 'length > 100' CLAUDE.md` → no output.

- [ ] **Step 4: Migration record — the `text` row**

In `evals/frontier/results/2026-08-20-phase2-migration.md` § *Delta (current − old)*, add after the `| marker | 0 | 0 |` row:

```
| text | 0 | 0 |
```

so the table enumerates the full kept vocabulary (`text` edges: 0 → 0, unchanged — the docket's advisory row from the Task-10 review).

- [ ] **Step 5: schedule_model.py — label the retired member**

In `evals/frontier/schedule_model.py`, above `SAME_FILE_WHYS = frozenset({…})` add the comment:

```python
# `ambiguous-files` is a RETIRED compiler label (Phase 2, 0.2.17) kept here
# only because tests/test_frontier_cell.py and tests/test_frontier_schedule.py
# build synthetic edges with it — the model drops it as same-file, harmlessly.
```

- [ ] **Step 6: Verify**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 -m pytest tests/test_frontier_cell.py tests/test_frontier_schedule.py tests/test_canary.py -q` — Expected: exit 0 / PASS.
Run: `awk 'length > 100' CLAUDE.md` — Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/references/design-rationale.md skills/ultrapowers/SKILL.md CLAUDE.md evals/frontier/results/2026-08-20-phase2-migration.md evals/frontier/schedule_model.py
git commit -m "docs: Phase-2 vocab alignment — rationale citation, retired --repo-root sentence, CLAUDE.md fill, migration text row, schedule_model note (#185)"
```

---

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1, 2

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: all green.

---

## Operator smoke

- do: `grep -rn "prose-reference\|read-after-write\|ambiguous-files" skills/ultrapowers/references/dependency-analysis.md skills/ultrapowers/SKILL.md skills/ultraplan/SKILL.md`
  see: no matches in `dependency-analysis.md` or either SKILL.md; the only remaining mentions anywhere are `design-rationale.md`'s one "was deleted" sentence, the migration record, and `schedule_model.py`'s retired-label comment.
- do: open `skills/ultrapowers/references/dependency-analysis.md` § Build the DAG.
  see: five numbered rules — marker, write-after-create, write-after-write (serialize only), text, interface — and no rule mentioning `--repo-root`.
