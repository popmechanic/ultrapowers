# Retire audit_run misrankCandidates (#152) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the dead `misrankCandidates` heuristic (zero actioned flags in ~156 sensed runs; missed both target classes) from `audit_run.py`, its tests, and its one prose mention.

**Architecture:** Pure subtraction behind the suite gate. `escalatedTasks` and `thrashCandidates` are separate code paths and STAY. The consumer grep was completed at triage: no consumer outside `audit_run.py`, two test files, and one prose line — the harvester provably drops the key before the ledger (`_merge_audits` rebuilds from agents/totals/note only).

**Tech Stack:** Python 3 stdlib, pytest.

**Spec:** none — issue #152 is the spec (fully-mapped deletion; sweep-recorded per the #124 precedent). The deletion reverses the 2026-06-25 tier-floor spec's keep-verdict (`docs/superpowers/specs/2026-06-25-tier-floor-structured-implementer.md:92`) on the observed miss record: zero actioned flags, both target classes missed, one clear false positive on planned-tier intent.

**Acceptance:** suite — subtraction-eval doctrine: the deletion lands behind the committed suite with tests updated in the same change; no frozen-periphery surface is touched so no eval cell is triggered.

## Global Constraints

- `escalatedTasks` and `thrashCandidates` (audit_run.py) must survive byte-for-byte in behavior — only the misrank family is deleted.
- No frozen file is in scope (audit_run.py is advisory tooling, outside the verification periphery).
- Historical plans/specs mentioning misrank are records, not consumers — leave them unmodified.

---

### Task 1: Delete the misrank family from audit_run.py, tests, and prose

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/audit_run.py`
- Modify: `tests/test_audit_run.py:57-70`
- Modify: `tests/test_audit_refactor.py:13`
- Modify: `skills/ultrapowers/references/report-format.md:117`

**Interfaces:**
- Consumes: nothing from other tasks (single-task plan).
- Produces: `audit_run.audit(dir)` return shape no longer contains the key `misrankCandidates` (still contains `agents`, `totals`, `escalatedTasks`, `thrashCandidates`, and `note` on the empty path).

- [ ] **Step 1: Turn the key-set assertion into a deletion pin (failing first)**

In `tests/test_audit_refactor.py`, change the assertion at line 13 from:

```python
    assert set(out) >= {"agents", "totals", "misrankCandidates"}
```

to:

```python
    assert set(out) >= {"agents", "totals", "escalatedTasks", "thrashCandidates"}
    assert "misrankCandidates" not in out   # retired by #152 — deletion pin
```

Delete these two tests from `tests/test_audit_run.py` (lines 57–70) entirely:
`test_flags_misrank_candidate_above_1_5x_same_model_median` and
`test_no_flagging_under_two_same_model_samples`.

- [ ] **Step 2: Run the pin to verify it fails**

Run: `python3 -m pytest tests/test_audit_refactor.py -v`
Expected: FAIL on `assert "misrankCandidates" not in out` (the key is still produced).

- [ ] **Step 3: Delete the heuristic from audit_run.py**

Four regions in `skills/ultrapowers/scripts/audit_run.py`:

1. **Docstring** (lines ~6–8): the sentence fragment "…and prints a markdown effort table plus tier-misrank candidates: implementers above 1.5x the median turns of SAME-MODEL peers (transcripts carry resolved model strings, not tier names — grouping by model is exact)." becomes "…and prints a markdown effort table plus escalated-task and thrash signals."
2. **Thrash comment** (lines ~48–51): "Absolute thrash heuristic (no same-model-peer requirement, unlike the relative misrank detector): an implementer doing many turns for little output." becomes "Absolute thrash heuristic: an implementer doing many turns for little output."
3. **`audit()`**: remove `"misrankCandidates": [],` from the empty-shape return dict; remove the whole relative-misrank block (the `impls = [...]`, `by_model = {}` build over `impls`, and the `misrank = []` loop computing `med`/extending `misrank` — these exist only to feed misrank); remove `"misrankCandidates": misrank,` from the final return dict. `totals`, the escalated block (`impl_by_task`), and the thrash block stay untouched.
4. **`main()`**: remove the misrank rendering block — the `impls`/`by_model`/`flagged` computation over `rows` and BOTH print branches ("**Tier-misrank candidates**…" loop and the "No tier-misrank candidates…" else). The unclassified-agents warning above it and the escalated/thrash rendering below it stay untouched.

Then check whether `statistics` is still used anywhere in the file:

Run: `grep -n "statistics\." skills/ultrapowers/scripts/audit_run.py`
Expected: no hits (both `statistics.median` calls lived in the deleted blocks) → remove the `import statistics` line. If there is a hit, leave the import.

- [ ] **Step 4: Run the audit tests to verify green**

Run: `python3 -m pytest tests/test_audit_run.py tests/test_audit_refactor.py -v`
Expected: PASS — the deletion pin passes, escalated/thrash tests untouched and green.

- [ ] **Step 5: Update the prose consumer**

In `skills/ultrapowers/references/report-format.md` item 11 (line 117), replace:

"role, model, turns, output tokens, and any tier-misrank candidates (implementers above 1.5x the median turns of same-model peers)."

with:

"role, model, turns, output tokens, plus escalated-task and thrash signals."

The rest of item 11 (the "Advisory only…" sentence) stays.

- [ ] **Step 6: Run the full suite (includes the report-runbook pin)**

Run: `python3 -m pytest`
Expected: PASS — `tests/test_report_runbook.py` was verified at triage to pin no misrank/effort phrasing, so the prose edit breaks nothing.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/scripts/audit_run.py tests/test_audit_run.py tests/test_audit_refactor.py skills/ultrapowers/references/report-format.md
git commit -m "refactor(audit_run): retire the misrankCandidates heuristic (#152) — zero actioned flags in ~156 runs; escalated/thrash signals stay"
```
