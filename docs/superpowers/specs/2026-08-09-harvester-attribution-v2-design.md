# Harvester attribution v2 — delete the transcript receipt text-scan (issue #126)

_Distill 2026-08-09 headliner; supersedes #121. The deletion-led cycle's
centerpiece: the fix is removal of the brittleness vector, not another
recognition shape._

## Problem

`session_registry`'s balanced-JSON receipt scan (anchored on `"mode"`) reads
ANY transcript text. At 0.1.15, on the home bundle of the drain session itself:

- three test-fixture stamps from **pasted plan text** registered as runs
  (`S1`, `S2`, `20260806-9` — fixture literals inside a Read-tool result);
- the top-level `gateReport` was a **fixture literal** from another plan's
  test code;
- all five **real** launches lost their receipts (drain-mode suite receipts
  carry no recognized shape; the approve receipt was truncated past the
  anchor) — terminus `unknown` for the session that released 0.1.15.

Separately (foreign, 0.1.14): a stale FIRST receipt stood for a five-gate-cycle
run, and the merge-evidence prose matcher — the patch for exactly that — never
fires for disk-sourced receipts (#121).

Three fix generations (#98, #113/#118, this) — reconstruction-from-prose is
the defect class. Retrospective verdict: #113 = possibly-failed fix, first
persistence.

## Design

**One principle: the harvester stops reconstructing history from prose. Two
structured sources only.**

1. **Stamps: Workflow `tool_use` args only.** `session_registry` keeps its
   `runDir`/`planPath` extraction from actual `tool_use` blocks (structurally
   verified — inexpressible from pasted text). The balanced-JSON receipt scan
   is **deleted**, not gated.
2. **Receipts: per-stamp disk reads only, located by `runDir`.**
   `session_registry` already parses each launch's absolute `runDir` from the
   Workflow `tool_use` args; keep it (`runDirsByStamp`) and read
   `<runDir>/gate-receipt.json` directly. The `planPath`-based repo-discovery
   walk is **deleted** (a relative planPath resolved against the harvester's
   CWD could attribute a foreign run's receipts to the home repo — trim
   review F4). Disk-write semantics stated precisely (F1): `ultra_gate.py`
   writes `gate-receipt.json` only on the **full** gate path; early-blocked
   cycles, `--approve`, and `--teardown` print without writing. So the disk
   receipt is "the last completed gate cycle's verdict" — approval and
   early-block cycles are invisible to disk by construction, which is exactly
   what §4's git check compensates for. No transcript entry ever enters
   `gateReports`.
3. **`gateReport` (singular)** derives from the same disk source (last
   receipt of the last stamp) — the fixture-literal poisoning path dies with
   the scan.
4. **Terminus: receipt verdict + git ancestry** _(operator decision,
   2026-08-09)_. Per stamp, with the exact lookups (F3): repo root = the
   `runDir`'s nearest ancestor containing `.git`; head =
   `<runDir>/report.json` → `waveMerges[-1].headSha` (file-derived
   post-#114), falling back to the branch name in `gate-receipt.json`'s
   `branch` key; base = `<runDir>/receipt.json`'s `baseBranch`, else the
   repo's default branch (`git symbolic-ref refs/remotes/origin/HEAD`, else
   `main`). Check `git merge-base --is-ancestor <head> <base>`: ancestor ⇒
   `approved` — merged IS approved, regardless of how the operator got there.
   Not resolvable ⇒ keep the receipt verdict (fail-soft, never a crash). No
   receipt on disk ⇒ `unknown`.
   **Known blind spot, accepted and documented (F2):** squash/rebase merges
   defeat the ancestry check, so a squash-merged run keeps its last full-gate
   verdict (e.g. NEEDS_ACK) instead of `approved` — an honest-to-receipt,
   mildly stale reading, strictly better than today's prose matcher for
   merge-commit flows (this repo's norm, incl. every drain) and worse only
   for squash flows the matcher happened to catch. If field evidence shows
   the squash case mattering, the structural route is an approve-side disk
   marker via the `ultra_gate.py` eval-route unfreeze — named here, not
   built.
   The **merge-evidence prose matcher is deleted** — the git check replaces
   the thing it was approximating, and fixes the stale-BLOCKED class (#121)
   structurally for merge-commit flows.
5. **Multi-launch slice envelope, registry-keyed (F6):** an artifact
   qualifies for the tail cut only if it is a tool_result carrying a
   **registered stamp** (or a Workflow tool_result itself) — which deletes
   `_has_run_artifact`'s own `"mode"`-anchored balanced-JSON scan, whose
   poisoning vector (fixture receipts inside Read tool_results) survives the
   tool_result gate. The cut lands at the last qualifying artifact of the
   **last** registered launch; if that launch printed no artifact, the
   envelope falls back to that launch's own `tool_use` index (nothing after
   the last launch is cut blindly).
6. **Hygiene carried from #121:** disk entries labeled by the locating
   (registry) stamp, never the recorded field; `_transcript_dir` comment
   corrected.

Aggregate terminus and the `runs[]` shape are unchanged (all-approved ⇒
approved; else last non-approved, in registry order). The blessed
launch-only classifier path (#125) is unaffected — a launch with no disk
receipt bundles as `engine`/`unknown`/`truncated`, as pinned.

## What this deletes — the full inventory (F5)

**Deleted:**
- The `"mode"`-anchored balanced-JSON receipt scan in `session_registry`.
- The merge-evidence prose matcher (`_merge_evidence_after`) and its
  conservative-shapes contract.
- `_legacy_gate_report` (the pre-driver `integrationBranch` prose scan) —
  pre-driver sessions lose their `gateReport`, accepted: the watermark makes
  them historical-only.
- The approve-marker/stamp-interleave tracking in `_stamp_terminus` (the git
  check subsumes it).
- The `planPath` repo-discovery walk in `_disk_receipts_for`.
- `_has_run_artifact`'s balanced-JSON scan (registry-keyed envelope, §5).
- The degenerate `per_stamp` ordinal dict (one file per stamp — F7).

**Sanctioned survivors (detection ≠ attribution):** `is_real_run`'s text
signals and the `Transcript dir:` extraction — they decide whether a session
is worth bundling, never what its history was.

Net: four text-scans and a repo-walk out; one `git merge-base` call in.
`complexityEffect: simplification`, `netConceptDelta: down`.

## Surfaces

`skills/ultralearn/scripts/harvest_runs.py` + `tests/test_harvest_runs.py`
only. No engine, gate, or frozen-periphery files. Existing bundle schema keys
keep their names and meanings (additive-only history preserved; cached
bundles keep parsing).

## Acceptance

Suite. `canaryMetric`: home-bundle receipt accuracy — re-harvesting the
2026-08-07 drain session must attach the real receipts for its five launches
(was 0/5) and register zero fixture stamps (was 3).

## Error handling

Soft-fail throughout: unreadable receipt/repo/sha ⇒ skip or fall back, never
raise out of `build_bundle`. Git invocations get a short timeout and treat
any non-zero exit as "not resolvable".

## Testing

Rewrite the receipt-scan tests as their disk-sourced equivalents (never
deleted without a scoped replacement): fixture-stamp-in-pasted-text must NOT
register — `test_session_registry_reads_receipt_stamps` is explicitly
**inverted** into that pin, not removed (F9); suite-shape and truncated
receipts become irrelevant by construction (their tests convert to disk-read
cases); BLOCKED-receipt + head-merged-in-fixture-repo ⇒ approved (the
git-ancestry pin on a **foreign-shaped** tmp-repo fixture — the live canary
is home-only, so the foreign stale-receipt class gets its coverage here,
F8); BLOCKED + unmerged ⇒ BLOCKED; squash-merged fixture ⇒ receipt verdict
(the documented blind spot, pinned as intended behavior); unresolvable sha ⇒
receipt verdict; no receipt ⇒ unknown; relative-planPath foreign run must
NOT read the home repo (the F4 hazard pin); multi-launch slice envelope pin
incl. the no-artifact fallback.

## Trim review

_Author disclosure (input to the reviewer, not a verdict): Adds = git-ancestry
terminus derivation (a swap for the merge-evidence matcher, operator-decided);
Removes = the receipt text-scan and its recognition-shape obligations._

Reviewer (fresh-context, code-grounded) returned 9 findings; grade below.
Adjudication:

- **F1 (disk-write semantics overstated) — ADOPTED.** §2 now states the
  exact write behavior; the disk receipt is defined as "last completed gate
  cycle."
- **F2 (squash-merge blind spot) — ADOPTED as accept-and-document.** §4
  names the blind spot, pins it as intended behavior, and names the
  eval-route approve-marker as the future structural fix. Rationale: strictly
  better for merge-commit flows, mildly stale (never wrong-direction) for
  squash flows.
- **F3 (nonexistent receipt fields) — ADOPTED.** §4 now names the exact
  file/field per lookup (report.json headSha; gate-receipt branch;
  receipt.json baseBranch; symbolic-ref default).
- **F4 (runDir-derived location) — ADOPTED.** §2 rewritten; the repo-walk is
  in the deletion inventory; the mis-resolution hazard gets a pin.
- **F5 (incomplete deletion inventory) — ADOPTED.** Full inventory section
  added, including `_legacy_gate_report` and the sanctioned survivors.
- **F6 (slice envelope mechanism + surviving scan) — ADOPTED.** §5 rewritten
  registry-keyed; `_has_run_artifact`'s scan joins the deletions.
- **F7 (mtime/ordinal parenthetical) — ADOPTED.** Removed; `per_stamp`
  ordinal dict added to deletions.
- **F8 (§4 scope expansion; home-only canary) — ANSWERED.** The expansion is
  the operator-decided swap and is now fully specified (F1/F3/F4 adopted);
  foreign-class coverage moves to the fixture-level ancestry pin since the
  live canary cannot exercise foreign repos.
- **F9 (invert, don't delete, the receipt-stamp pin) — ADOPTED.** Testing
  section names the inversion.

**Reviewer's `netConceptDelta` grade: down (conditional)** — "down as
designed; flat if implemented as currently written." The conditions (F5
inventory landing, F3 fields existing) are now part of the design, so the
graded state is the specified state.
