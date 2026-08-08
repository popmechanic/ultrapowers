# Test-Mass Audit Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the drain's test-mass counterweight pass — verdict every test line in `f2efcd3..511c945 -- tests/`, delete only with bite proofs, root-immunize the fragile prune test, add the two reviewer-named coverage closers — per spec `docs/superpowers/specs/2026-08-06-test-mass-audit-design.md` (issue #106).

**Architecture:** One audited sweep. The verdict table (keep/delete/fix per added test, with bite-proof records) is the deliverable's evidence; it travels in the task's completion notes to the gate, destined for the #106 closure comment — no standing repo doc. Deletions land only where a mutation of the subject turned the named survivor red.

**Tech Stack:** pytest, node (sim), git.

**Acceptance:** suite — the committed suite is the verification.

## Global Constraints

- Audited population: `git diff f2efcd3..511c945 -- tests/` exactly (release commits 0.1.12 → 0.1.13; the tags do not exist, and the mis-stamped 0.2.0 commit f38a9ad sits in the window — these SHA endpoints are authoritative).
- Only files under `tests/` change. No engine, no scripts, no docs, no standing audit artifact.
- **Every deletion carries a bite proof in its verdict row**: subject mutated → named survivor red → mutation reverted. No proof, no deletion (the verdict flips to keep).
- A mostly-keep table is a valid outcome; the criteria are the authority, not the shrink target.
- `sim_workflow.mjs` edits keep the `ALL SCENARIOS PASSED` sentinel printing.
- Suite gate: `python3 -m pytest` and `node tests/sim_workflow.mjs` green at the end.

---

### Task 1: The audited sweep

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `tests/test_sweep_worktrees.py`
- Modify: `tests/test_ultra_run.py`
- Modify: `tests/test_compile_plan.py`
- Modify: `tests/sim_workflow.mjs`
- Modify: `tests/test_async_sealing.py`

**Interfaces:**
- Consumes: nothing from other tasks (single-task plan).
- Produces: the verdict table in the completion notes (destined for the #106 closure comment at the gate).

Tier: most-capable — judgment-heavy audit across the suite; adversarial review checks every deletion's bite proof independently.

(The Files list above names the drain-window test files by expectation; the population derivation in Step 1 is authoritative — audit exactly the files the diff names, and only those.)

- [ ] **Step 1: Derive the population**

Run: `git diff f2efcd3..511c945 --stat -- tests/` and `git diff f2efcd3..511c945 -- tests/ | grep -E '^\+.*def test_|^\+.*scenario'`
List every added test function and sim scenario. This list is the verdict table's row set.

- [ ] **Step 2: Add the two coverage closers (TDD)**

**(a) `package-json-bun` ladder rung** (in the file that tests `detect_test_cmd` — `tests/test_ultra_run.py`): read the rung's implementation in `ultra_run.py`'s detection ladder first, then pin it and its precedence against the pnpm rung:

```python
def test_detect_test_cmd_bun_rung(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "package.json").write_text('{"scripts": {"test": "bun test"}}')
    (repo / "bun.lockb").write_text("")
    cmd, rule = h_detect(repo)          # adapt to the module's real entry point
    assert rule == "package-json-bun"
    assert "bun" in cmd


def test_detect_test_cmd_bun_vs_pnpm_precedence(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "package.json").write_text('{"scripts": {"test": "x"}}')
    (repo / "bun.lockb").write_text("")
    (repo / "pnpm-lock.yaml").write_text("")
    cmd, rule = h_detect(repo)
    # pin whichever precedence the ladder implements TODAY — the pin's job is
    # to make a future silent reorder fail loudly, not to legislate an order
    assert rule in ("package-json-bun", "package-json-pnpm")
    # then assert the SPECIFIC rule observed, as a literal
```

Write red (the rung has zero coverage today, so at minimum the first test is new), adapt fixture details to the ladder's real markers, then green.

**(b) `FILES_EXEMPT_MARKERS` parametrize** (in `tests/test_compile_plan.py`): find the existing exemption test that covers only `gate`, and parametrize it over every marker in `FILES_EXEMPT_MARKERS` (gate/manual/release) so a future narrowing of the exemption set fails green-to-red.

- [ ] **Step 3: Root-immunize the fragile prune test**

`test_prune_failure_is_named_in_the_scratch_hygiene_detail` relies on DAC mode bits and is red under root (Docker contributors). Add the skip marker with the reason:

```python
@pytest.mark.skipif(os.geteuid() == 0,
                    reason="DAC mode bits do not bind root; the undeletable-dir trigger cannot fire")
```

- [ ] **Step 4: Verdict every remaining row**

For each added test/scenario from Step 1 (excluding Steps 2–3's subjects):

- **keep** when a ledger finding/issue cites its pinned failure, or it is sole coverage of a live path — one-line justification in the row.
- **delete** candidates (the issue names the starting set: the prune honesty proofs, the sim guard self-test, the post-#101 tierOverrides overlap pair): run the bite proof — mutate the pinned subject, run the named survivor, record red, revert. Proof recorded in the row → delete; survivor stays green under mutation → the candidate is load-bearing, verdict flips to **keep** with that finding recorded.

- [ ] **Step 5: Apply deletions and run everything**

Run: `python3 -m pytest && node tests/sim_workflow.mjs`
Expected: suite green (with the two adds green), sim sentinel printed after any scenario removals.

- [ ] **Step 6: Commit, table in the notes**

```bash
git add tests/
git commit -m "test(#106): drain test-mass audit — <N> deleted with bite proofs, 2 coverage closers added, prune test root-immunized"
```

Include the **full verdict table** (row: test name | verdict | justification/bite-proof) in your completion summary notes — it travels through the gate report to the operator for the #106 closure comment. Do not commit it as a repo file.
