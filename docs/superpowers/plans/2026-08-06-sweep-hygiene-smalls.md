# Sweep-Hygiene Smalls Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the `--age-hours` overflow (#111, net-zero-branch bound) and the stale waves.js approve-sweep comment (#109, source-first) — per spec `docs/superpowers/specs/2026-08-06-sweep-hygiene-smalls-design.md` (#110 parked separately).

**Architecture:** One widened validation arm in `sweep_worktrees.sh` + one boundary test; one comment correction in `harnesses/waves.js` preceded by a references/ source grep so a re-bake cannot resurrect the falsehood.

**Tech Stack:** bash, pytest.

**Acceptance:** suite.

## Global Constraints

- Only `skills/ultrapowers/scripts/sweep_worktrees.sh`, `tests/` (one test), and the `harnesses/waves.js` comment change. Frozen scripts byte-identical; no prompt constants change (drift pins stay green with no source edit unless the #109 grep finds a source — then source and copy change together).
- The waves.js touch means the suite-gate runs the `.mjs` sims — they must stay green with their sentinel (comments are invisible to sims; any sim failure is collateral to investigate, not accept).
- Suite gate: `python3 -m pytest` green.

---

### Task 1: #111 bound + #109 comment

**Type:** implementation
**Depends-on:** none
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/scripts/sweep_worktrees.sh`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/test_sweep_worktrees.py`

**Interfaces:**
- Consumes: the existing `--age-hours` validation case arm (`''|*[!0-9]*`) and its usage-error style.
- Produces: nothing consumed by other tasks.

Tier: cheap.

- [ ] **Step 1: Write the failing boundary test**

Locate the existing `--age-hours` validation tests (in `tests/test_sweep_worktrees.py` or the test file that covers the sweep script — follow its existing invocation helper) and add one test asserting both boundary sides:

```python
def test_age_hours_magnitude_bound(tmp_path):
    repo = <the file's existing repo fixture>
    # 20 digits: rejected as a usage error, never a wrapped threshold
    r = <run sweep> ["--audit", "--age-hours", "9" * 20]
    assert r.returncode != 0
    assert "older than" not in r.stdout
    assert "at most 6 digits" in r.stderr
    # 6 digits: accepted, threshold echoed
    r = <run sweep> ["--audit", "--age-hours", "999999"]
    assert r.returncode == 0
    assert "999999" in r.stdout + r.stderr
```

(Adapt the fixture/helper names to the file's existing pattern; the four assertions are the pin.)

- [ ] **Step 2: Run to verify the rejection half fails**

Run: `python3 -m pytest tests/ -v -k age_hours_magnitude`
Expected: FAIL — 20 digits currently exits 0 with a wrapped "older than" line.

- [ ] **Step 3: Widen the existing validation arm**

In `sweep_worktrees.sh`'s `--age-hours` validation `case` (the `''|*[!0-9]*` arm, evaluated on the raw string BEFORE the `10#` normalization), add the 7-plus-digit alternative to the same arm and widen its one message:

```bash
case "$AGE_HOURS" in
  ''|*[!0-9]*|???????*)
    echo "sweep_worktrees.sh: --age-hours requires a non-negative integer of at most 6 digits" >&2
    exit 2 ;;
esac
```

(Match the arm's existing exit code and message prefix exactly — widen, don't duplicate.)

- [ ] **Step 4: Fix the #109 comment, source-first**

1. Grep the sources: `grep -rn "ADDITIONAL sweep" skills/ultrapowers/references/` (and the surrounding comment phrases). If the stale text appears in any reference, fix source and copy together; if nowhere, the copy-only edit is licensed — record that in the commit message.
2. Rewrite the waves.js:349–351 comment to the shipped behavior: `ultra_gate.py --approve` sweeps every recorded wf run id plus `wf_<stamp>` (the integration worktree) mechanically; no additional SKILL.md-issued sweep call exists.

- [ ] **Step 5: Run everything**

Run: `python3 -m pytest && node tests/sim_workflow.mjs`
Expected: suite green including the new boundary test; sim prints its sentinel (comment edits are invisible to it).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/sweep_worktrees.sh tests/ skills/ultrapowers/harnesses/waves.js
git commit -m "fix(#111,#109): --age-hours 6-digit bound inside the existing arm; waves.js approve-sweep comment matches shipped #108 behavior

#109 source grep: <'found in <ref> — fixed together' | 'absent from references/ — copy-only edit licensed'>"
```
