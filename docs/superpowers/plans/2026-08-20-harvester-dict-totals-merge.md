# Harvester Dict-Valued Totals Merge (#166) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `_merge_audits` merges dict-valued totals (`wallSecByTask`) key-wise across multi-transcript-dir sessions instead of silently dropping them.

**Architecture:** One additive branch in `_merge_audits` beside the existing numeric `isinstance` check: dict values merge key-wise (sum per task id, numeric leaves only, bools excluded). Per-dir `audit_run` output and the CLI stdout table are untouched.

**Tech Stack:** Python 3, pytest.

**Spec:** GitHub issue #166 (issue-as-spec; design approved in docket Notes 2026-08-20).

**Acceptance:** suite — sensor-precision fix on advisory tooling; the committed suite plus the new merge test is the verification.

## Global Constraints

- Harvester is advisory-by-contract: soft-fail, never raise, on malformed input.
- `audit_run.py` CLI stdout table is pinned — do not change it (structured dict only).
- No Anthropic SDK / API key in any repo code.

---

### Task 1: Dict-valued totals branch in `_merge_audits`

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py:648-670`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: existing `_merge_audits(audits) -> dict` shape (`agents`/`totals`/`note`).
- Produces: `_merge_audits` now preserves dict-valued totals keys, e.g. `totals["wallSecByTask"] = {taskId: summed_seconds}`.

- [ ] **Step 1: Write the failing test** (beside `test_merge_audits_sums_totals_and_concats_agents`, same direct-call style):

```python
def test_merge_audits_merges_dict_valued_totals_keywise():
    # Two transcript dirs' audits with overlapping wallSecByTask ids (#166):
    # numeric leaves sum per task id; bools and non-numeric leaves are dropped.
    a = {"agents": [], "totals": {"turns": 1, "wallSecByTask": {"1": 10.0, "2": 5}}}
    b = {"agents": [], "totals": {"turns": 2, "wallSecByTask": {"2": 7, "3": True, "4": "x"}}}
    m = h._merge_audits([a, b])
    assert m["totals"]["turns"] == 3
    assert m["totals"]["wallSecByTask"] == {"1": 10.0, "2": 12}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_harvest_runs.py::test_merge_audits_merges_dict_valued_totals_keywise -v`
Expected: FAIL — `KeyError: 'wallSecByTask'` (dict values are currently skipped).

- [ ] **Step 3: Implement the branch.** In `_merge_audits`, extend the totals loop:

```python
        for k, v in (a.get("totals") or {}).items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                totals[k] = totals.get(k, 0) + v
            elif isinstance(v, dict):
                # #166: dict-valued totals (wallSecByTask) merge key-wise —
                # numeric leaves sum per task id; bools/non-numerics dropped.
                sub = totals.setdefault(k, {})
                if isinstance(sub, dict):
                    for sk, sv in v.items():
                        if isinstance(sv, (int, float)) and not isinstance(sv, bool):
                            sub[sk] = sub.get(sk, 0) + sv
```

- [ ] **Step 4: Run the suite**

Run: `python3 -m pytest tests/test_harvest_runs.py -v` then `python3 -m pytest`
Expected: all PASS (existing numeric-totals and empty-input tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "fix(ultralearn): merge dict-valued audit totals key-wise (#166)"
```
