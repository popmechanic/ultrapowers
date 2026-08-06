# Harvester Session-Scoped Attribution Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harvester receipts, audits, and terminus derive from what the session actually launched — session-launch registry, per-stamp disk fallback (repo-wide glob deleted, #118), multi-run bundle shape, audit union, override-honest terminus, slice envelope — per spec `docs/superpowers/specs/2026-08-06-harvester-session-attribution-design.md` (issues #113 + #118).

**Architecture:** One extraction pass builds a registry (run stamps + planPaths) from transcript artifacts; everything downstream attributes by it. All changes live in `harvest_runs.py` + its test file, so tasks form a deliberate linear chain (same-file edits) — this plan is intentionally narrow; the work has no latent parallelism.

**Tech Stack:** Python 3 (stdlib only), pytest, existing `_rec`/`_real_receipt` fixture helpers in `tests/test_harvest_runs.py`.

**Acceptance:** suite — deterministic dev tooling; the committed suite is the verification.

## Global Constraints

- Only `skills/ultralearn/scripts/harvest_runs.py` and `tests/test_harvest_runs.py` change. `merge_ledger.py`, reader dispatch, and every engine/gate surface are untouched.
- `runId` stays the session hash; all existing top-level bundle fields keep their names and single-run meanings (backward compatibility is a hard constraint — cached bundles and `bundle_lookups` must keep parsing).
- The repo-wide receipt glob is **deleted**, never conditionally retained: after Task 1 there is no code path that attaches a receipt whose stamp is outside the session registry.
- Soft-fail discipline: missing dirs/unreadable files skip silently; no new exceptions escape `build_bundle`.
- No new dependencies, no Anthropic SDK, no API keys.
- Suite gate: `python3 -m pytest` green after every task.

---

### Task 1: Session-launch registry + per-stamp receipt attribution (deletes the glob — #118)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: existing helpers `_iter_blocks`, `_block_text`, `_balanced_json`, `_gate_evidence`, and the `_rec`/`_real_receipt` test fixtures.
- Produces: `session_registry(records) -> {"stamps": [str], "planPathsByStamp": {str: str}}` (stamps in first-appearance transcript order, deduped); `_disk_receipts_for(plan_path, stamps) -> [report-entry]` (same entry shape as `_gate_evidence` reports, `source: "disk"`); `_disk_gate_reports` **deleted**; `build_bundle` wired to both.

Registry sources (spec §1): every Workflow `tool_use` whose parsed `input.args` carries `runDir` matching `…/run-<stamp>` (extract `<stamp>`; the same parsed args' `planPath` keys `planPathsByStamp[stamp]`), and every printed ultra_run/ultra_gate receipt's `"stamp"` field (reuse `_gate_evidence`'s balanced-JSON walk or a parallel scan for `"stamp"`-bearing `mode` receipts). `_disk_receipts_for` locates the repo root from `plan_path` exactly as `_disk_gate_reports` does today, then reads only `<root>/.claude/ultrapowers/run-<stamp>/gate-receipt.json` for each registry stamp **that has no transcript-printed receipt** (per-stamp fallback — never double-source a stamp).

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_harvest_runs.py

def _wf_launch(stamp, plan="docs/superpowers/plans/p.md"):
    args = json.dumps({"planPath": plan,
                       "runDir": f"/repo/.claude/ultrapowers/run-{stamp}",
                       "pluginRoot": "/pr"})
    return _rec("assistant", [{"type": "tool_use", "name": "Workflow",
                               "input": {"name": "ultrapowers-run", "args": args}}])


def test_session_registry_extracts_stamps_and_planpaths():
    recs = [_wf_launch("20260806-1", "docs/superpowers/plans/a.md"),
            _wf_launch("20260806-2", "docs/superpowers/plans/b.md"),
            _wf_launch("20260806-1", "docs/superpowers/plans/a.md")]  # dedup
    reg = h.session_registry(recs)
    assert reg["stamps"] == ["20260806-1", "20260806-2"]
    assert reg["planPathsByStamp"]["20260806-2"] == "docs/superpowers/plans/b.md"


def test_session_registry_reads_receipt_stamps():
    recs = [_rec("user", [{"type": "tool_result", "content": [{"type": "text",
        "text": json.dumps({"mode": "gate", "verdict": "PASS", "stamp": "20260806-9"})}]}])]
    assert "20260806-9" in h.session_registry(recs)["stamps"]


def test_disk_receipts_only_for_registry_stamps(tmp_path):
    # repo with a receipt for an in-registry stamp AND a foreign run dir
    repo = tmp_path / "repo"; (repo / ".git").mkdir(parents=True)
    plans = repo / "docs/superpowers/plans"; plans.mkdir(parents=True)
    plan = plans / "p.md"; plan.write_text("x")
    for stamp, verdict in [("20260806-1", "NEEDS_ACK"), ("19990101-9", "BLOCKED")]:
        d = repo / f".claude/ultrapowers/run-{stamp}"; d.mkdir(parents=True)
        (d / "gate-receipt.json").write_text(json.dumps(
            {"mode": "gate", "verdict": verdict, "stamp": stamp}))
    entries = h._disk_receipts_for(str(plan), ["20260806-1"])
    assert [e["stamp"] for e in entries] == ["20260806-1"]   # foreign 1999 dir NOT attached
    assert all(e["source"] == "disk" for e in entries)


def test_repo_wide_glob_is_gone():
    assert not hasattr(h, "_disk_gate_reports")


def test_build_bundle_never_attaches_out_of_registry_receipts(tmp_path):
    # session that launched stamp A; repo also holds stamp B's receipt
    repo = tmp_path / "repo"; (repo / ".git").mkdir(parents=True)
    plans = repo / "docs/superpowers/plans"; plans.mkdir(parents=True)
    (plans / "p.md").write_text("x")
    for stamp in ("A-1", "B-2"):
        d = repo / f".claude/ultrapowers/run-{stamp}"; d.mkdir(parents=True)
        (d / "gate-receipt.json").write_text(json.dumps(
            {"mode": "gate", "verdict": "NEEDS_ACK", "stamp": stamp}))
    recs = REAL + [_wf_launch("A-1", str(plans / "p.md"))]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    stamps = {g.get("stamp") for g in bundle["gateReports"]}
    assert "B-2" not in stamps and "A-1" in stamps
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -v -k "registry or disk_receipts or glob or out_of_registry"`
Expected: FAIL/ERROR everywhere (`session_registry` / `_disk_receipts_for` undefined; `_disk_gate_reports` still exists).

- [ ] **Step 3: Implement**

Add `session_registry(records)`: walk `_iter_blocks`; for Workflow `tool_use` blocks parse `input.args` (JSON string or dict, same tolerance as `_plan_path`), regex `r"/run-([^/\s]+)$"` on `runDir` for the stamp, record planPath by stamp; for receipt blocks reuse the balanced-JSON walk anchored on `'"mode"'` and collect `obj["stamp"]` from any gate/approve/teardown receipt. Preserve first-appearance order with a seen-set.

Replace `_disk_gate_reports(plan_path)` with `_disk_receipts_for(plan_path, stamps)`: identical repo-root discovery and JSON tolerance, but iterate `run-<stamp>` dirs for the given stamps only; keep per-stamp ordinal assignment. Delete `_disk_gate_reports`.

Wire `build_bundle`: `registry = session_registry(records)`; after `_gate_evidence`, compute `covered = {r["stamp"] for r in gate_reports}`; `disk = _disk_receipts_for(plan_path, [s for s in registry["stamps"] if s not in covered])`; merge disk entries into `gate_reports` (transcript entries first, disk after, stable order); drop the old no-receipts-only fallback branch entirely.

- [ ] **Step 4: Run the new tests, then the full file**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: new tests pass; the pre-existing fallback test that asserted repo-wide glob behavior (if any asserts on `_disk_gate_reports`) is updated in this task to assert the new scoped behavior instead — never deleted without a scoped replacement.

- [ ] **Step 5: Full suite**

Run: `python3 -m pytest`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(#113,#118): session-launch registry; per-stamp disk receipts; repo-wide glob deleted"
```

---

### Task 2: Multi-run bundle shape + audit union

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: `session_registry(records)` and the merged `gate_reports` wiring from Task 1.
- Produces: bundle key `runs` = `[{stamp, planPath, gateReports, terminus}]` (per registry stamp, transcript order); `_transcript_dirs(records) -> [str]` (every candidate dir holding `agent-*.jsonl`); `_merge_audits(audits) -> audit` (agents concatenated, numeric totals summed, notes joined).

Aggregate terminus rule (spec §3): all runs `approved` → `approved`; else the **last non-approved** run's terminus in transcript order. Per-run terminus in this task uses the existing rules (approve marker / last receipt verdict) applied to that stamp's receipts; Task 3 refines them. `_transcript_dir` (singular) becomes a thin `_transcript_dirs(records)[-1]`-style wrapper or is inlined — audit in `build_bundle` becomes `_merge_audits([audit_run.audit(d) for d in _transcript_dirs(records)])`.

- [ ] **Step 1: Write the failing tests**

```python
def test_runs_array_groups_by_stamp_with_aggregate_terminus(tmp_path):
    r1 = json.dumps({"mode": "gate", "verdict": "NEEDS_ACK", "stamp": "S1"})
    ok1 = json.dumps({"mode": "approve", "lockReleased": True, "stamp": "S1"})
    r2 = json.dumps({"mode": "gate", "verdict": "BLOCKED", "stamp": "S2"})
    recs = (REAL
            + [_wf_launch("S1", "docs/superpowers/plans/a.md"),
               _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": r1}]}]),
               _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": ok1}]}]),
               _wf_launch("S2", "docs/superpowers/plans/b.md"),
               _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": r2}]}])])
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    runs = bundle["runs"]
    assert [r["stamp"] for r in runs] == ["S1", "S2"]
    assert runs[0]["planPath"].endswith("a.md") and runs[0]["terminus"] == "approved"
    assert runs[1]["terminus"] == "BLOCKED"
    assert bundle["terminus"] == "BLOCKED"          # last non-approved run
    assert bundle["planPath"].endswith("a.md")      # top-level = first plan, unchanged meaning


def test_merge_audits_sums_totals_and_concats_agents():
    a = {"agents": [{"role": "impl"}], "totals": {"turns": 10, "outputTokens": 100}}
    b = {"agents": [{"role": "review"}], "totals": {"turns": 5, "outputTokens": 50}}
    m = h._merge_audits([a, b])
    assert len(m["agents"]) == 2
    assert m["totals"]["turns"] == 15 and m["totals"]["outputTokens"] == 150


def test_transcript_dirs_returns_all_agent_bearing_candidates(tmp_path):
    d1, d2 = tmp_path / "t1", tmp_path / "t2"
    for d in (d1, d2):
        d.mkdir(); (d / "agent-1.jsonl").write_text("{}")
    recs = [_rec("user", [{"type": "tool_result", "content": [{"type": "text",
                "text": f"Transcript dir: {d}"}]}]) for d in (d1, d2)]
    assert h._transcript_dirs(recs) == [str(d1), str(d2)]
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_harvest_runs.py -v -k "runs_array or merge_audits or transcript_dirs"`
Expected: FAIL (`runs` key absent; `_merge_audits`/`_transcript_dirs` undefined).

- [ ] **Step 3: Implement**

`_transcript_dirs`: today's candidate collection, returning every candidate whose dir holds `agent-*.jsonl` (fallback: `[candidates[-1]]` when none qualify, preserving today's last-resort behavior). `_merge_audits`: shallow-merge — concatenate `agents`, sum numeric values under `totals` key-wise, join non-empty `note` strings with `"; "`; empty input → today's `{"agents": [], "note": "no transcript dir"}` shape. In `build_bundle`: group merged `gate_reports` by stamp into `runs` (planPath from the registry; per-run terminus via the existing verdict/approve rules scoped to that stamp's receipts); session terminus per the aggregate rule; audit via the union. Match the audit dict's real key names to `audit_run.audit`'s output (adjust the test literals in Step 1 to those names if they differ — the test is authoritative once committed).

- [ ] **Step 4: Run the file, then full suite**

Run: `python3 -m pytest tests/test_harvest_runs.py -v && python3 -m pytest`
Expected: green; pre-existing bundle tests unaffected (additive keys only).

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(#113): runs[] drain shape + audit union across launches"
```

---

### Task 3: Terminus honesty + slice envelope

**Type:** implementation
**Depends-on:** 2
**Review:** lean

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: the per-run terminus computation and `runs`/registry wiring from Tasks 1–2.
- Produces: terminus refinement (approve-mode receipt for a registry stamp counts as approval even when not transcript-last; BLOCKED-then-merge-evidence derives `approved` while the receipt's BLOCKED verdict stays visible in the bundle); slice envelope (slice ends at the last run-artifact record).

Merge evidence (spec §5): a `tool_result` whose text contains a merge-success signature naming the run's integration branch — accept the two real shapes: `Merged` + the branch name from that run's receipt (`gh pr merge` output), or `Updating`/`Fast-forward` git-merge output plus the branch name. Keep the matcher to those two conservative shapes; anything fuzzier stays `BLOCKED`.

- [ ] **Step 1: Write the failing tests**

```python
def test_blocked_then_merge_evidence_derives_approved(tmp_path):
    blocked = json.dumps({"mode": "gate", "verdict": "BLOCKED", "stamp": "S1",
                          "integrationBranch": "ultra/integration-S1"})
    recs = (REAL
            + [_wf_launch("S1"),
               _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": blocked}]}]),
               _rec("user", [{"type": "tool_result", "content": [{"type": "text",
                    "text": "Merged pull request #7 (ultra/integration-S1)"}]}])])
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["terminus"] == "approved"
    # override stays DERIVABLE: the receipt's BLOCKED verdict is still in the bundle
    assert bundle["gateReports"][-1]["receipt"]["verdict"] == "BLOCKED"
    assert bundle["truncated"] is False


def test_blocked_without_merge_evidence_stays_blocked(tmp_path):
    blocked = json.dumps({"mode": "gate", "verdict": "BLOCKED", "stamp": "S1",
                          "integrationBranch": "ultra/integration-S1"})
    recs = REAL + [_wf_launch("S1"),
                   _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": blocked}]}])]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    assert json.loads((out / "bundle.json").read_text())["terminus"] == "BLOCKED"


def test_slice_cuts_after_last_run_artifact(tmp_path):
    ok = json.dumps({"mode": "approve", "lockReleased": True, "stamp": "S1"})
    recs = (REAL
            + [_rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": ok}]}]),
               _rec("user", [{"type": "text", "text": "now let's investigate desktop internals"}]),
               _rec("assistant", [{"type": "text", "text": "wave-unrelated post-run tangent"}])])
    out = h.slice_transcript(recs)
    assert "desktop internals" not in out and "tangent" not in out


def test_slice_keeps_planning_head(tmp_path):
    # no artifact after the head → nothing is cut
    out = h.slice_transcript(REAL)
    assert "build the thing" in out
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_harvest_runs.py -v -k "merge_evidence or stays_blocked or slice_cuts or planning_head"`
Expected: the two terminus tests and `slice_cuts` FAIL; `planning_head` may already pass (it pins existing behavior — keep it as the regression guard).

- [ ] **Step 3: Implement**

Terminus: in the per-run/session derivation, after computing the receipt-based verdict, if it is `BLOCKED` scan later records for the conservative merge-evidence matcher (branch name taken from that run's receipt `integrationBranch`); on match, terminus `approved` (`truncated` recomputed from the final terminus). Approve-mode receipts found by stamp (not only transcript-last) count as approval for their run.

Slice envelope: compute the index of the last record containing a run artifact (a balanced-JSON gate/approve/teardown receipt, a Workflow `tool_result`, or a `sweep_worktrees` output line); if any exists, `slice_transcript` ignores records after that index. No start bound.

- [ ] **Step 4: Run the file, then the full suite**

Run: `python3 -m pytest tests/test_harvest_runs.py -v && python3 -m pytest`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(#113): override-honest terminus + slice run-envelope tail cut"
```
