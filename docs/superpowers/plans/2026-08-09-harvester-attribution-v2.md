# Harvester Attribution v2 Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The harvester stops reconstructing history from prose — stamps from Workflow `tool_use` args only, receipts from `runDir`-located disk reads only, terminus from receipt verdict + git ancestry, slice envelope registry-keyed — per spec `docs/superpowers/specs/2026-08-09-harvester-attribution-v2-design.md` (issue #126; supersedes #121; the deletion-led cycle's centerpiece).

**Architecture:** All changes live in `harvest_runs.py` + its test file; tasks form a deliberate linear chain (same-file edits). Four text-scans and a repo-walk are deleted; one `git merge-base` call is added. The trim-review-adjudicated spec is authoritative on every lookup path and blind spot.

**Tech Stack:** Python 3 (stdlib only), pytest, existing `_rec`/`_wf_launch` fixture helpers in `tests/test_harvest_runs.py`.

**Acceptance:** suite — deterministic dev tooling; the committed suite is the verification. canaryMetric (next sense pass): re-harvesting the 2026-08-07 drain session attaches real receipts for its five launches (was 0/5) and registers zero fixture stamps (was 3).

## Global Constraints

- Only `skills/ultralearn/scripts/harvest_runs.py` and `tests/test_harvest_runs.py` change. No engine, gate, or frozen-periphery surfaces.
- **Deletions are deletions**: the receipt text-scan, `_merge_evidence_after`, `_legacy_gate_report`, the `planPath` repo-discovery walk, `_has_run_artifact`'s balanced-JSON scan, and the degenerate `per_stamp` ordinal dict are removed, never conditionally retained. Sanctioned survivors: `is_real_run`'s text signals and `Transcript dir:` extraction (detection ≠ attribution).
- Existing top-level bundle keys keep their names and meanings; cached bundles and `bundle_lookups` keep parsing. Pre-driver sessions losing `gateReport` is accepted (watermark makes them historical).
- Deleted-scan tests get scoped replacements, never bare deletion; `test_session_registry_reads_receipt_stamps` is **inverted** into the fixture-stamp-must-NOT-register pin.
- Soft-fail discipline: unreadable receipt/repo/sha ⇒ skip or fall back; git subprocesses get a short timeout, non-zero exit = "not resolvable"; no new exceptions escape `build_bundle`.
- No new dependencies. Suite gate: `python3 -m pytest` green after every task.

---

### Task 1: Registry + receipts v2 — the scan deletions and runDir-located disk reads

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: existing `_iter_blocks`, `_wf_launch` test fixture, `session_registry`'s `tool_use` runDir/planPath extraction (kept).
- Produces: `session_registry(records) -> {"stamps", "planPathsByStamp", "runDirsByStamp"}` (receipt scan deleted); `_disk_receipts_for(run_dirs_by_stamp, stamps) -> [entry]` reading `<runDir>/gate-receipt.json` directly (repo-walk deleted); `build_bundle` wired so `gateReports` and the singular `gateReport` are disk-sourced only; `_legacy_gate_report` deleted.

Spec sections 1–3 and the deletion inventory govern. Key behaviors to pin (write failing tests first, then implement, then full suite, then commit):

- The exact home-bundle repro as a regression pin: a transcript containing a pasted receipt-shaped JSON literal inside a Read/text block (`{"mode": "gate", "verdict": "PASS", "stamp": "FIXTURE-1"}`) registers NO stamp and attaches NO receipt — this is the **inversion** of `test_session_registry_reads_receipt_stamps`.
- `runDirsByStamp` populated from `tool_use` args; `_disk_receipts_for` reads `<runDir>/gate-receipt.json` for registry stamps; entries labeled by the **locating** stamp (never the recorded field); `source: "disk"`.
- The F4 hazard pin: a foreign run whose `planPath` is *relative* must NOT read receipts from the harvester host's CWD/home repo — only its absolute `runDir` is consulted.
- Singular `gateReport` = last disk receipt of the last registered stamp; a session with launches but no disk receipts ⇒ `gateReport` absent/None and terminus `unknown` (the #125 launch-only pin `test_launch_only_session_bundles_as_engine_unknown` must stay green).
- `_legacy_gate_report` deleted; its test converts to: a pre-driver-style session (prose `integrationBranch`, no run dirs) bundles with no `gateReport` (accepted-behavior pin).
- Suite-shape/truncated-receipt scan tests convert to disk-read equivalents.

Commit: `feat(#126): registry drops the receipt text-scan; receipts are runDir-located disk reads only`

---

### Task 2: Terminus v2 — git ancestry replaces the merge-evidence matcher

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: Task 1's disk-sourced `gateReports` and `runDirsByStamp`.
- Produces: `_stamp_terminus` computing per-stamp terminus = disk receipt verdict, upgraded to `approved` when the git-ancestry check passes; `_merge_evidence_after` and the approve-marker/stamp-interleave tracking **deleted**; `_aggregate_terminus` unchanged.

Exact lookups per spec §4 (F3-adjudicated): repo root = nearest `.git`-bearing ancestor of `runDir`; head = `<runDir>/report.json` → `waveMerges[-1].headSha`, falling back to `gate-receipt.json`'s `branch`; base = `<runDir>/receipt.json`'s `baseBranch`, else `git symbolic-ref refs/remotes/origin/HEAD`, else `main`. `git merge-base --is-ancestor <head> <base>` with a short timeout; ancestor ⇒ `approved`; any failure ⇒ receipt verdict; no receipt ⇒ `unknown`.

Pins (failing tests first): BLOCKED receipt + head merged into base in a tmp-repo fixture built to the **foreign** shape ⇒ `approved` (replaces the two merge-evidence prose tests); BLOCKED + unmerged ⇒ BLOCKED; a squash-merge fixture (cherry-picked content, head not an ancestor) ⇒ receipt verdict — the documented blind spot pinned as intended; unresolvable sha/repo ⇒ receipt verdict; `truncated` recomputed from the final terminus.

Commit: `feat(#126): terminus = disk verdict + git ancestry; merge-evidence prose matcher deleted`

---

### Task 3: Registry-keyed slice envelope + hygiene sweep

**Type:** implementation
**Depends-on:** 2
**Review:** lean

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: the registry (`stamps`, launch indices) from Task 1.
- Produces: slice tail cut at the last qualifying artifact of the **last** registered launch, where an artifact = a tool_result carrying a registered stamp, or a Workflow tool_result; `_has_run_artifact`'s balanced-JSON scan deleted; no-artifact fallback = the last launch's own `tool_use` index.

Also in this task (spec F7/F5 hygiene): delete the degenerate `per_stamp` ordinal dict; correct the `_transcript_dir` first→last-qualifying comment; verify the existing prose-mention slice pin (`test_slice_ignores_prose_mention_outside_tool_result`) still passes and add its Read-tool_result sibling: a fixture receipt inside a Read tool_result must NOT become the cutoff (the F6 poisoning-vector pin).

Multi-launch envelope pin: a three-launch session whose last launch's final gate exchange sits late in the transcript keeps that exchange inside the slice; content after it is cut.

Commit: `feat(#126): registry-keyed slice envelope; _has_run_artifact scan deleted; hygiene sweep`
