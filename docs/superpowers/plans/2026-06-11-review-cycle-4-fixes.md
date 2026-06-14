# Review Cycle 4 Fixes Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — review-cycle fixes; verified by the committed test suite, not a held-out exam.

**Goal:** Close the iteration-4 findings: the `edges: []` vs edges-missing conflation, the lost-done sweep's chunk-timing hole, the four stale "SKIPPED never cascades" doc spots, compiler polish (conflict dedupe, zero-impl mode, heading-line text-dep exclusion, line-range coverage), and the remaining compat pins.

**Architecture:** Same file-cluster discipline as prior cycles. Docs that describe behavior delivered by a code task depend on it.

**Tech Stack:** Python 3 (pytest), Node 22 (sim), markdown.

**House rules for every task:** before committing run `python3 -m pytest tests/ -q` (all green), `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`, and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` (both print `skill ok`). Commit on your assigned branch with a conventional message. No version bumps.

---

### Task 1: Compiler polish — conflict dedupe, zero-impl mode, heading-line exclusion, line-range coverage, incremental adjacency

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`

Five small verified findings in `skills/ultrapowers/scripts/compile_plan.py`:

**Fix A — duplicate `marker_conflicts` entries.** The text-dep loop appends one conflict per regex MATCH with no dedupe ("Run after Task A passes." plus "verify after Task A is green." → two byte-identical entries), and a `**Depends-on:** 9, 9` marker likewise duplicates. Dedupe conflicts on the `(task, edge)` pair before appending — a small `conflict_seen` set shared by the marker and text loops.

**Fix B — gates/release-only plans report `mode: "sequential"` with `degrade_reason: "Sequential mode: 0 implementation tasks"`.** The degrade trigger `len(impl) <= 2` catches zero. With `waves: []` there is nothing to sequence and the message misleads. Skip the entire degrade block when `not impl` (leave `mode: "parallel"`, `degrade_reason: null`; the existing "no implementation tasks" stderr warning already covers the situation).

**Fix C — the task's own heading line is scanned for text dependencies.** `split_tasks` includes the `### Task N: <title>` line in `body`, so a task TITLED "cleanup after Task 1 lands" produces a real `text` edge — but dependency-analysis.md promises "Task titles … are NOT matched". Make the code match the doc: when building `prose` in `parse_task`, skip lines that match `TASK_HEAD` (the heading is metadata, not prose). Prose sections BETWEEN task headings still fold into the preceding task's body and stay scanned — that is documented separately.

**Fix D — the upstream line-range form (`Modify: path.py:123-145`) is handled by one untested line.** `p.split(":")[0]` strips ranges correctly (verified live) but no test or fixture uses a ranged path; a regression would silently parallelize two tasks editing different ranges of the same file. Add the test below; no code change expected.

**Fix E — `would_cycle` rebuilds the adjacency map on every call inside the O(N²) pair loops** (measured superlinear blowup ≥80 tasks). Maintain the adjacency incrementally instead: build `adj = {}` once next to `seen`, append inside `add()` (`adj.setdefault(a, []).append(b)`), and let `would_cycle` use the maintained map directly. Behavior identical; all existing precedence tests must stay green.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_compile_plan.py`:

```python
def test_duplicate_conflict_entries_are_deduped(tmp_path):
    plan = tmp_path / "dupconf.md"
    plan.write_text(
        "# Plan: Dup conflicts\n\n"
        "### Task A: gate-ish\n\n**Type:** gate\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n\n"
        "### Task B: follower\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n"
        "- [ ] **Step 1:** Run after Task A passes.\n"
        "- [ ] **Step 2:** Verify again after Task A is green.\n"
    )
    out = compile_plan(plan)
    drops = [c for c in out["marker_conflicts"] if c["task"] == "B"]
    assert len(drops) == 1


def test_zero_impl_plan_is_not_sequential_mode(tmp_path):
    plan = tmp_path / "zeromode.md"
    plan.write_text(
        "# Plan: Gates only\n\n"
        "### Task A: suite gate\n\n**Type:** gate\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n"
    )
    out = compile_plan(plan)
    assert out["waves"] == []
    assert out["mode"] == "parallel"
    assert out["degrade_reason"] is None


def test_task_title_does_not_create_text_edge(tmp_path):
    plan = tmp_path / "titledep.md"
    plan.write_text(
        "# Plan: Title dep\n\n"
        "### Task 1: base\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: cleanup after Task 1 lands\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "text" for e in out["dag_edges"])
    assert out["waves"] == [["1", "2"]]


def test_line_ranged_paths_strip_to_overlap(tmp_path):
    plan = tmp_path / "ranged.md"
    plan.write_text(
        "# Plan: Ranged\n\n"
        "### Task A: edit top\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/existing.py:123-145`\n\n- [ ] **Step 1:** top\n\n"
        "### Task B: edit bottom\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/existing.py:200-260`\n\n- [ ] **Step 1:** bottom\n"
    )
    out = compile_plan(plan)
    assert {"from": "A", "to": "B", "why": "write-after-write"} in out["dag_edges"]
    assert out["waves"] == [["A"], ["B"]]
```

- [ ] **Step 2: Run them** — `python3 -m pytest tests/test_compile_plan.py -q`. Expected: dedupe, mode, and title tests FAIL; the ranged test should already PASS (it pins existing behavior — keep it).
- [ ] **Step 3: Implement fixes A, B, C, E.**
- [ ] **Step 4: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 5: Commit** — `git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py && git commit -m "fix: dedupe conflicts, honest zero-impl mode, titles excluded from text deps, ranged-path pin, incremental adjacency"`.

### Task 2: Workflow — edges-supplied semantics, per-chunk lost-done sweep, self-describing lost verdicts, budget sim

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `tests/sim_workflow.mjs`

Three verified findings plus the sim gaps they expose:

**Fix A — `edges: []` (compiler-proven independence) is conflated with "no edges supplied".** SKILL.md Step 4b tells the orchestrator to always pass the converted `dag_edges`; a dependency-free plan legitimately yields `edges: []`. But the conservative-cascade branch gates on `EDGES.length === 0`, so a zero-mergeable wave cascades even though the compiler PROVED later tasks independent — and its detail string ("no dependency edges supplied") is false. Fix: capture `const edgesSupplied = !!(ARGS && Array.isArray(ARGS.edges))` next to the EDGES validation, and gate the conservative cascade on `!edgesSupplied` instead of `EDGES.length === 0`. The detail string becomes true by construction. (An explicitly supplied empty array now takes the SKIPPED-continue path — the compiler asserted independence.)

**Fix B — the lost-done sweep runs after the whole wave, so a same-wave dependent in a LATER CHUNK still dispatches.** A `done`-without-coordinates task in chunk 1 is only downgraded to `failed` after all chunks ran; the per-chunk `noteFailures()` re-check never sees it, so an intra-wave dependent (edge into a >16-wide wave) dispatches and merges against a base missing its prerequisite — contradicting the sweep's own judgment-call text. Fix: move the lost-done sweep INSIDE the chunk loop, immediately after `for (const r of chunkResults) results.push(r)` — downgrade each lost result, push its judgmentCall and log line there, so the next chunk's `noteFailures()` sees the failure. Wave-level report wording stays identical.

**Fix C — a lost-done record reads `status: 'failed', reviewVerdict: 'clean'`** — a combination the field reference declares impossible; the explanation lives only in judgmentCalls. When downgrading, also set `r.reviewVerdict = 'lost-coordinates'` and append the reason to `r.notes` (e.g. `(r.notes ? r.notes + '; ' : '') + 'reported done without mergeable coordinates — downgraded to failed'`). A sibling doc task adds `lost-coordinates` to report-format.md's verdict vocabulary and widens the tripwire regex.

**Sim additions** (`tests/sim_workflow.mjs`):

1. **Update `scenarioNoEdgesZeroMergeableCascades`** — it currently OMITS `edges` (cascade expected: still passes). ADD a second leg to the same scenario (or a sibling scenario) launching with `edges: []` explicitly: assert NO cascade — wave 2's task dispatches and completes, wave-1's merge records `SKIPPED`, `blockedWaves` stays empty.
2. **Extend `scenarioDoneWithoutHeadShaNotMerged`** — assert the record now carries `reviewVerdict: 'lost-coordinates'` and notes mentioning "downgraded".
3. **New `scenarioLostDoneBlocksDependents`** — two legs: (a) cross-wave: waves `[[A],[B]]`, `edges: [['A','B']]`, A returns DONE without headSha → assert `impl:B` never dispatches and B lands in `unfinished`; (b) intra-wave across chunks: a 17-task wave with `edges: [['T0','T16']]`, T0 returns DONE without headSha → assert `impl:T16` never dispatches (this is the chunk-timing fix; it FAILS before Fix B).
4. **New `scenarioMidRunBudgetDeferral`** — `budget` with `remaining` as a FUNCTION returning a counter that hits 0 after wave 1 completes (e.g. start at 2 and decrement per call, or flip a flag after the first merge): assert wave-2 tasks land in `unfinished` with `deferred (budget exhausted` entries, EXACTLY ONE judgmentCall matching /budget exhausted mid-run/, no `impl:` dispatches after the flip, and the integration review still runs (the report's `tests` field is populated).
5. **Extend `scenarioReconcileTierOverride`** (or scenarioPortability) — record `opts.model` for the `setup` and `merge:wave*` labels under `tierOverrides: { cheap: 'sonnet', mostCapable: 'sonnet' }`-style overrides and assert they follow the overridden `cheap` — pinning the last untested clause of the documented tier routing.

- [ ] **Step 1: Add/extend the sim scenarios first**, run `node tests/sim_workflow.mjs` — expect failures (edges-[] leg cascades; lost verdict still `clean`; T16 dispatches; budget scenario may partially pass — keep all assertions).
- [ ] **Step 2: Apply fixes A–C.**
- [ ] **Step 3: Re-run the sim** — `ALL SCENARIOS PASSED`.
- [ ] **Step 4: Full suite + both validators** — all green (no BAKE text changed), `skill ok` twice.
- [ ] **Step 5: Commit** — `git add skills/ultrapowers/workflow.js tests/sim_workflow.mjs && git commit -m "fix: edges-supplied semantics, per-chunk lost-done sweep, lost-coordinates verdict; budget and tier sim pins"`.

### Task 3: Report docs — conditional cascade truth, lost-coordinates vocabulary, widened tripwire

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/references/workflow-template.md`
- Modify: `tests/test_report_runbook.py`

Verify on your branch first: workflow.js now gates the conservative cascade on edges-NOT-supplied (not emptiness), downgrades lost-done results per chunk with `reviewVerdict: 'lost-coordinates'`. CRITICAL: do not touch wave-merge.md's five BAKE blocks; keep report-format pinned strings (`Post-merge runbook`, `Step-2`, `finishing-a-development-branch`, `blockedWaves`, `Blocked waves`, `tests.passed`, `git checkout <integrationBranch>`, `SKIPPED`, no `clean up worktrees`).

Four doc-spot corrections (the "SKIPPED never cascades" claim is currently UNCONDITIONAL in all four — the code is conditional):

1. **wave-merge.md, Per-Wave Merge paragraph** — replace the sentence ending "and later waves still run — dependency edges, not the cascade, decide what downstream work is blocked." with "and later waves still run when dependency edges were supplied (they decide what downstream work is blocked) or when nothing in the wave actually ran. When `args.edges` was NOT supplied and tasks did run, the workflow cannot know what depends on the lost work — it records the `SKIPPED` merge plus a `blockedWaves` entry ('no mergeable branches and no dependency edges supplied — cascading conservatively') and cascade-blocks later waves."
2. **wave-merge.md, cascade-rationale parenthetical** — replace "(A SKIPPED merge — nothing to integrate — does not cascade.)" with "(A SKIPPED merge does not cascade when edges were supplied; without edges it cascades conservatively.)". Also extend the zero-mergeable cause list "(every task failed, dep-blocked, or deferred)" with ", or reported done without mergeable coordinates".
3. **report-format.md** — (a) `waveMerges` row: replace "(`SKIPPED` = no mergeable branches; integration branch untouched, no cascade)" with "(`SKIPPED` = no mergeable branches, integration branch untouched; cascades only when no dependency edges were supplied and tasks actually ran)". (b) Presentation item 6 (Blocked waves): widen "any wave whose merge failed after reconciliation" to "any wave whose merge failed after reconciliation, or that cascaded conservatively (zero mergeable branches with no dependency edges supplied)". (c) `reviewVerdict` row: add to the Failed-tasks list "`lost-coordinates` (reported done without branch/headSha — downgraded to failed; see the matching judgmentCalls entry)". (d) `judgmentCalls` row: add "tasks reported done without mergeable coordinates" to the enumeration.
4. **workflow-template.md, Structure bullet** — replace "A wave with no mergeable branches records `SKIPPED` and does NOT cascade; the integration branch is untouched." with "A wave with no mergeable branches records `SKIPPED` (integration branch untouched); it cascades conservatively only when no dependency edges were supplied and tasks actually ran."

**Tripwire widening** — `tests/test_report_runbook.py::test_report_format_documents_every_review_verdict` extracts verdicts with `re.findall(r"reviewVerdict:([^\n]+)", wf)`, which misses assignment-form verdicts (`r.reviewVerdict = 'lost-coordinates'`). Widen the extraction to `re.findall(r"reviewVerdict\s*[:=]([^\n]+)", wf)` so the new verdict is enforced; run the test and confirm it FAILS before the report-format edit lands and passes after.

- [ ] **Step 1: Widen the tripwire regex first**, run `python3 -m pytest tests/test_report_runbook.py -q` — expect FAIL on `lost-coordinates` undocumented.
- [ ] **Step 2: Apply the four doc corrections**; re-run — all pass.
- [ ] **Step 3: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 4: Commit** — `git add skills/ultrapowers/references/wave-merge.md skills/ultrapowers/references/report-format.md skills/ultrapowers/references/workflow-template.md tests/test_report_runbook.py && git commit -m "docs: conditional cascade truth, lost-coordinates vocabulary, widened verdict tripwire"`.

### Task 4: dependency-analysis.md — text-dep scope precision, reachability wording, ranged paths, ambiguous caveat

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/references/dependency-analysis.md`

Verify on your branch: the compiler now excludes the heading line from text-dep prose. PINNED STRINGS that must survive (tests/test_marker_compiler.py): "## Classify" before "## Build the DAG", `plan-markers.md`, `**Depends-on:**`, `additive`, `marker_conflicts`, `post-merge runbook`, `preamble`, `fence-aware`, `dispositions`, `compile_plan.py`, `derived_knobs`, `"heuristic": true`. Four edits:

1. **Rule 4 text-dep scope.** After "Task titles and phase-level prose are NOT matched — convert them to `**Depends-on:**` markers on the downstream task (ultraplan authoring rule 2).", add: "Precisely: the task's own heading line is excluded from the scan, but prose sections that sit between task headings fold into the PRECEDING task's body and ARE scanned — keep ordering prose out of interstitial sections."
2. **Precedence sentence.** Replace "yield to any opposing explicit or semantic PATH — reachability through earlier `marker`, `text`, `write-after-create`, or `read-after-write` edges, not just a direct reverse edge." with "yield to any opposing PATH — reachability through ALL earlier-recorded edges, not just a direct reverse edge (a reverse path always contains at least one explicit or semantic edge, since heuristics never create cycles)."
3. **Ambiguous-files caveat.** In the Conservative Defaults ambiguous bullet, after "gets `ambiguous-files` edges from every preceding implementation task AND into every following one", insert "(minus any edge the reachability yield suppresses)".
4. **Input section, ranged paths.** In the Files-block bullet of the Input section, append: "Paths may carry the upstream line-range suffix (`existing.py:123-145`); the compiler strips the suffix, so two tasks editing different ranges of one file still overlap and serialize."

- [ ] **Step 1: Apply the four edits.**
- [ ] **Step 2: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 3: Commit** — `git add skills/ultrapowers/references/dependency-analysis.md && git commit -m "docs: text-dep scope precision, reachability wording, ambiguous caveat, ranged paths"`.

### Task 5: Compat pins round 4 — status taxonomy, ordered-pass mandate, line-range token, warning routing

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_superpowers_compat.py`

Two unpinned upstream-behavior paraphrases plus two warning-routing fixes (superpowers 5.1.0 installed; nothing skips):

1. Append two pins:

```python
def test_sdd_implementer_status_taxonomy_unchanged():
    text = (installed() / "skills/subagent-driven-development/implementer-prompt.md").read_text()
    assert "DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT" in text, (
        "the implementer status taxonomy changed — reviewer-prompts.md's headless-downgrade "
        "notes and workflow.js's IMPLEMENTER_SCHEMA enum are built on these four statuses")


def test_sdd_still_mandates_ordered_two_pass_review():
    text = (installed() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "Start code quality review before spec compliance" in text, (
        "SDD no longer red-flags merging/reordering the two review passes — "
        "reviewer-prompts.md's 'deliberate divergence' note describes a mandate that moved; re-audit it")
```

2. In `test_writing_plans_template_shape_unchanged`, add the ranged-path example token `":123-145"` to the token tuple (compile_plan.py strips that suffix; if upstream drops the example the strip rule needs a re-audit).
3. Fix two warning strings: in `test_every_handoff_skill_still_exists`, extend the message to "…re-audit SKILL.md Steps 1/5/6, ultraplan's Execution Handoff, and the re-bake sources in reviewer-prompts.md/wave-merge.md"; in `test_executing_plans_still_runs_continuously`, extend to "…re-audit plan-markers.md Executor variance and ultraplan's Inline option".

- [ ] **Step 1: Apply; run** `python3 -m pytest tests/test_superpowers_compat.py -q` — all pass, none skipped.
- [ ] **Step 2: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 3: Commit** — `git add tests/test_superpowers_compat.py && git commit -m "test: pin status taxonomy, ordered-pass mandate, ranged-path token; route warnings to all dependent docs"`.

### Task 6: Sourcing note + ultraplan wording

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultraplan/SKILL.md`

Two small truth-ups. CRITICAL: do NOT touch the BAKE blocks in reviewer-prompts.md nor the mirrored marker blocks in ultraplan.

1. **reviewer-prompts.md sourcing note** — the parenthetical "(ultrapowers adds its own JSON schemas, verdict vocabulary, fix-loop cap, and model tiers for headless parsing)" claims the model tiers as ultrapowers' own, but the cheap/standard/most-capable scheme with near-identical signals comes from subagent-driven-development's Model Selection section — which therefore isn't on the re-bake diff list. Replace "and model tiers for headless parsing" with "and the fix-loop cap for headless parsing; the model-tier scheme is adapted from subagent-driven-development's Model Selection section — include it in re-bake diffs".
2. **ultraplan SKILL.md Inline option** — "batch execution (continuous since superpowers 5.0.0 — no per-task checkpoints)" still leads with the dropped behavior, and upstream's own menu text it overlays is stale. Replace with "continuous inline execution (upstream removed batch checkpoints in superpowers 5.0.0; its own handoff text still says otherwise — trust the behavior, not the menu)". Keep `superpowers:executing-plans` and the surrounding list structure intact (pinned strings: `REQUIRED SUB-SKILL`, `ultrapowers:ultrapowers`, `Execution Handoff`).

- [ ] **Step 1: Apply both edits.**
- [ ] **Step 2: Full suite + both validators** — all green, `skill ok` twice.
- [ ] **Step 3: Commit** — `git add skills/ultrapowers/references/reviewer-prompts.md skills/ultraplan/SKILL.md && git commit -m "docs: model tiers credited to SDD Model Selection; honest Inline-option wording"`.

### Task 7: Full-suite gate

**Type:** gate
**Depends-on:** none

**Files:** none (verification only)

- [ ] **Step 1:** Run: `python3 -m pytest tests/ -q` — every test green, zero failures.
- [ ] **Step 2:** Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` — `skill ok`.
- [ ] **Step 3:** Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` — `skill ok`.
- [ ] **Step 4:** Run: `node tests/sim_workflow.mjs` — `ALL SCENARIOS PASSED`.
