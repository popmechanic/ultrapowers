# Harvester Precision v3 Implementation Plan (#150)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — committed pytest suite is the verification; sensor-side only (no engine surface, no sims, no re-bake), sealing not requested.

**Goal:** Close issue #150's three successor modes to #126: (a) crash-resume
runs double-count audits when the same transcript dir is printed twice; (b)
slices always truncate before the operator's approval exchange, blinding the
NEEDS_ACK lens; (c) clean drain-administered runs read as terminus `unknown`
because the drain skips Step-5 and the runDir (the only receipt location) is
torn down.

**Architecture:** All three fixes are sensor-side, mirroring AROUND the frozen
gate periphery. (a) is a dir-level realpath dedupe inside the harvester's
transcript-dir collector. (b) is a conditional slice rule: an `approved`
terminus extends the slice past the artifact cut to the transcript end,
through the existing keyword filter. (c) is a writer/reader pair: the drain's
existing run-record helper gains a `stamp` subcommand that mirrors each
drain-administered gate outcome to a teardown-surviving JSON record under
`<repo-root>/.claude/ultrapowers/receipts/`, and the harvester's terminus
derivation generalizes from "receipt present" to "receipt-or-stamp present",
locating the mirror purely by string-deriving the repo root from the
registry-recorded runDir path (the runDir itself may be deleted).

**Tech Stack:** Python 3 stdlib only (no new dependencies, no Anthropic SDK),
pytest. Suite: `python3 -m pytest` from the repo root (pytest.ini scopes it to
`tests/`). No harness JS is touched, so no `.mjs` sim obligations.

**Spec:** docs/superpowers/specs/2026-08-14-harvester-precision-v3.md

## Global Constraints

- Frozen files stay byte-identical: `skills/ultrapowers/scripts/run_acceptance.sh`,
  `skills/ultrapowers/scripts/ultra_gate.py`, `skills/ultrapowers/scripts/gate_check.py`.
- `skills/ultrapowers/scripts/audit_run.py` is untouched (spec rev 2 deleted that
  surface at trim review).
- The harvester stays advisory/soft-fail: every new read path skips missing
  dirs, unreadable files, malformed JSON, and dead runDirs — with at most a
  diagnostic, never a raise out of a sweep.
- Verdict authority remains the gate's exit code. The stamp record is evidence
  for the ultralearn sensor, never authority — nothing in the engine or the
  drain's merge/park decision reads it.
- Sensor-side only: no engine (`waves.js`) surface, so no sims and no re-bake.
- `python3 -m pytest` green from the repo root before every commit.

---

### Task 1: Dir-level audit dedupe on resolved real paths (mode a)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py:315-336`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing sibling tasks rely on (the dedupe is internal to the
  harvester's transcript-dir collector).

The observed failure signature (a ~50-entry agent block duplicated
back-to-back; an 18-entry block repeated verbatim) is one transcript dir
audited twice: a crash-resume session prints the same "Transcript dir:" line
more than once, the collector keeps every mention, and the audit merge
bare-extends agents across the duplicate audits. The fix is one layer, at the
dir level: dedupe candidates on their resolved real paths (first occurrence
wins, transcript order preserved), so each unique dir is audited exactly once
and the existing key-wise totals summing stays correct with no recompute
machinery.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_harvest_runs.py` (the `_rec` helper and `import
harvest_runs as h` already exist at the top of the file):

```python
# --- #150 mode (a): dir-level audit dedupe on resolved real paths — a
# crash-resume session prints the same "Transcript dir:" twice (sometimes
# via a symlink alias); pre-#150 each mention was audited separately and
# _merge_audits bare-extended the duplicate agent blocks.

def test_transcript_dirs_dedupes_repeated_and_symlinked_dir(tmp_path):
    real = tmp_path / "wf_real"
    real.mkdir()
    (real / "agent-1.jsonl").write_text("{}\n")
    alias = tmp_path / "wf_alias"
    alias.symlink_to(real)
    recs = [
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": f"Transcript dir: {real}"}]}]),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": f"Transcript dir: {real}"}]}]),   # verbatim repeat
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": f"Transcript dir: {alias}"}]}]),  # symlink alias, same real path
    ]
    assert h._transcript_dirs(recs) == [str(real)]


def test_build_bundle_audits_repeated_transcript_dir_once(tmp_path):
    # End-to-end: the crash-resume shape. One agent file (1 assistant turn,
    # 7 output tokens); the dir is printed twice. Pre-#150 the bundle audit
    # carried 2 agents and totals {"turns": 2, "outputTokens": 14}.
    tdir = tmp_path / "wf_resume"
    tdir.mkdir()
    agent_user = {"type": "user", "message": {"role": "user", "content": [
        {"type": "text",
         "text": "You are the setup agent on the session repo main checkout."}]}}
    agent_turn = {"type": "assistant", "message": {
        "role": "assistant", "model": "m1",
        "usage": {"output_tokens": 7}, "content": []}}
    (tdir / "agent-1.jsonl").write_text(
        json.dumps(agent_user) + "\n" + json.dumps(agent_turn) + "\n")
    recs = [
        _rec("assistant", [{"type": "tool_use", "name": "Workflow",
                            "input": {"name": "ultrapowers-run"}}]),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": f"Transcript dir: {tdir}"}]}]),
        # crash-resume: the SAME dir printed again by the resumed session
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": f"Transcript dir: {tdir}"}]}]),
    ]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-x-home")
    assert out is not None
    bundle = json.loads((out / "bundle.json").read_text())
    assert len(bundle["audit"]["agents"]) == 1
    assert bundle["audit"]["totals"] == {"turns": 1, "outputTokens": 7}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -k "dedupes_repeated or audits_repeated" -v`
Expected: both FAIL — `_transcript_dirs` returns 3 entries (dedupe test) and
the bundle audit carries 2 agents with `totals == {"turns": 2, "outputTokens": 14}`.

- [ ] **Step 3: Implement the dedupe**

In `skills/ultralearn/scripts/harvest_runs.py`, the current function reads:

```python
def _transcript_dirs(records):
    """Every candidate "Transcript dir:" mention (#113) whose dir actually
    holds agent transcripts, in transcript order — a session may launch
    several workflows (multiple /ultrapowers launches, or a zero-agent probe
    before the real run) and each agent-bearing dir is its own run's evidence.
    Fallback: [candidates[-1]] when NONE qualify, preserving the old
    single-dir last-resort behavior (e.g. a dir that no longer exists on
    disk when the harvester runs later)."""
    candidates = []
    for _r, b in _iter_blocks(records):
        if not (isinstance(b, dict) and b.get("type") == "tool_result"):
            continue
        txt = _block_text(b)
        if "Transcript dir:" in txt:
            tail = txt.split("Transcript dir:", 1)[1].strip().splitlines()[0]
            tail = tail.strip().rstrip("\\").strip()
            if tail.startswith("/"):
                candidates.append(tail)
    if not candidates:
        return []
    qualifying = [c for c in candidates if Path(c).is_dir() and any(Path(c).glob("agent-*.jsonl"))]
    return qualifying if qualifying else [candidates[-1]]
```

Replace it with (docstring gains the #150 sentence; the collection loop is
unchanged; a dedupe pass runs before the qualifying filter):

```python
def _transcript_dirs(records):
    """Every candidate "Transcript dir:" mention (#113) whose dir actually
    holds agent transcripts, in transcript order — a session may launch
    several workflows (multiple /ultrapowers launches, or a zero-agent probe
    before the real run) and each agent-bearing dir is its own run's evidence.
    Candidates are deduped on their RESOLVED REAL paths (#150 mode a): a
    crash-resume session prints the same dir twice (sometimes via a symlink
    alias), and pre-dedupe each mention was audited separately — the verbatim
    agent-block duplication that overstated audit totals by a full salvage
    run's weight. First occurrence wins; transcript order is preserved.
    Fallback: the LAST unique candidate when NONE qualify, preserving the old
    single-dir last-resort behavior (e.g. a dir that no longer exists on
    disk when the harvester runs later)."""
    candidates = []
    for _r, b in _iter_blocks(records):
        if not (isinstance(b, dict) and b.get("type") == "tool_result"):
            continue
        txt = _block_text(b)
        if "Transcript dir:" in txt:
            tail = txt.split("Transcript dir:", 1)[1].strip().splitlines()[0]
            tail = tail.strip().rstrip("\\").strip()
            if tail.startswith("/"):
                candidates.append(tail)
    if not candidates:
        return []
    seen_real, unique = set(), []
    for c in candidates:
        try:
            key = str(Path(c).resolve())
        except OSError:
            key = c  # unresolvable path: dedupe on the literal string, soft
        if key in seen_real:
            continue
        seen_real.add(key)
        unique.append(c)
    qualifying = [c for c in unique if Path(c).is_dir() and any(Path(c).glob("agent-*.jsonl"))]
    return qualifying if qualifying else [unique[-1]]
```

Note the fallback change is behavior-preserving modulo duplicates:
`unique[-1]` is the last distinct real path (under its first-seen spelling)
instead of the literal last mention.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: PASS — the two new tests and every existing test (in particular
`test_transcript_dirs_returns_all_agent_bearing_candidates`, which has two
distinct dirs and must be unaffected, and
`test_transcript_dir_prefers_dir_with_agents`).

- [ ] **Step 5: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS (all green).

- [ ] **Step 6: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "fix(ultralearn): dedupe transcript-dir candidates on resolved real paths (#150 mode a)"
```

---

### Task 2: Approved-terminus slice extends through the approval exchange (mode b)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py:155-180,683-687`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `slice_transcript(records, terminus=None) -> str` (widened
  signature, default preserves today's behavior; only its same-file caller
  uses the new parameter).

The slicer cuts at the last qualifying run artifact, so the operator's
approval exchange — plain user text after the final artifact — is structurally
excluded, blinding the NEEDS_ACK lens. Rule: when the bundle's terminus is
`approved`, the slice extends past the artifact cut to the transcript end.
The extension passes through the existing `SLICE_KEYWORDS` filter unchanged —
operator user-text survives it, tool noise is filtered exactly as everywhere
else, and since approval is terminal the filtered tail is naturally a handful
of records. No cap, no truncation sentinel (spec rev 2 deleted both).
Non-approved termini keep today's cut.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_harvest_runs.py` (uses the existing `_rec`,
`_wf_launch`, `_real_receipt`, `_merged_feature_repo`, and `REAL` fixtures
already defined in the file):

```python
# --- #150 mode (b): an `approved` terminus extends the slice past the
# artifact cut to the transcript end — the approval exchange (plain user
# text after the final artifact) is exactly what the NEEDS_ACK lens needs.
# The tail still rides the same per-record filter (user text kept, keyword-
# less tool noise dropped). Non-approved termini keep today's cut.

def _approval_tail_recs():
    ok = json.dumps({"mode": "approve", "lockReleased": True, "stamp": "S1"})
    return [
        _wf_launch("S1"),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": ok}]}]),                                   # last artifact: the cut
        _rec("assistant", [{"type": "text",
            "text": "Gate is green. Merge to main and close out?"}]),
        _rec("user", [{"type": "text", "text": "yes - approved, merge it"}]),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": "irrelevant tool noise about lunch"}]}]),
    ]


def test_slice_approved_terminus_extends_past_artifact_cut():
    out = h.slice_transcript(_approval_tail_recs(), terminus="approved")
    assert "yes - approved, merge it" in out       # operator text in the tail survives
    assert "Gate is green" in out                  # keyword ("gate") line survives
    assert "lunch" not in out                      # keyword-less tool noise still dropped


def test_slice_non_approved_terminus_keeps_artifact_cut():
    recs = _approval_tail_recs()
    for terminus in ("NEEDS_ACK", "BLOCKED", "unknown", None):
        out = h.slice_transcript(recs, terminus=terminus)
        assert "yes - approved, merge it" not in out
    # and the one-argument call (default) is unchanged behavior
    assert "yes - approved, merge it" not in h.slice_transcript(recs)


def test_build_bundle_approved_slice_keeps_post_artifact_approval_exchange(tmp_path):
    # End-to-end: a merged (git-ancestry-approved) run's slice.md includes
    # the post-artifact operator turn.
    root = tmp_path / "repo"
    head_sha = _merged_feature_repo(root)
    run_dir = root / ".claude/ultrapowers/run-S1"
    run_dir.mkdir(parents=True)
    (run_dir / "report.json").write_text(
        json.dumps({"waveMerges": [{"headSha": head_sha}]}))
    (run_dir / "gate-receipt.json").write_text(json.dumps(_real_receipt("PASS", 0)))
    ok = json.dumps({"mode": "approve", "lockReleased": True, "stamp": "S1"})
    recs = (REAL
            + [_wf_launch("S1", run_dir=str(run_dir)),
               _rec("user", [{"type": "tool_result", "content": [{"type": "text",
                   "text": ok}]}]),
               _rec("user", [{"type": "text", "text": "ship it - thanks"}])])
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["terminus"] == "approved"
    assert "ship it - thanks" in (out / "slice.md").read_text()
```

Note: `_merged_feature_repo`, `_real_receipt`, and `REAL` already exist in
this test file; the fixture git repo makes the git-ancestry upgrade resolve
`approved` deterministically.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -k "approved_terminus or non_approved_terminus or approval_exchange" -v`
Expected: FAIL — `TypeError: slice_transcript() got an unexpected keyword
argument 'terminus'` for the first two; the end-to-end test fails its
`"ship it - thanks" in slice.md` assertion.

- [ ] **Step 3: Implement the conditional extension**

In `skills/ultralearn/scripts/harvest_runs.py`, the current function head reads:

```python
def slice_transcript(records):
    # Slice envelope (Task 3, registry-keyed — spec §5): the run ends at the
    # last qualifying artifact of the LAST registered launch; anything after
    # is a post-run tangent, never wave-relevant. No qualifying artifact at
    # all (e.g. planning-only, or a pre-registry session with no Workflow
    # tool_result) keeps the full head, unchanged from pre-Task-3 behavior.
    registry = session_registry(records)
    cutoff = _last_artifact_record_index(records, registry)
```

Replace with:

```python
def slice_transcript(records, terminus=None):
    # Slice envelope (Task 3, registry-keyed — spec §5): the run ends at the
    # last qualifying artifact of the LAST registered launch; anything after
    # is a post-run tangent, never wave-relevant. No qualifying artifact at
    # all (e.g. planning-only, or a pre-registry session with no Workflow
    # tool_result) keeps the full head, unchanged from pre-Task-3 behavior.
    # #150 mode (b): when the caller's derived terminus is "approved", the
    # approval exchange — plain operator text AFTER the final artifact — is
    # exactly what the NEEDS_ACK lens needs, so the slice extends past the
    # artifact cut to the transcript end. The tail rides the same per-record
    # filter below (user text kept, keyword-less noise dropped), and since
    # approval is terminal it is naturally a handful of records: no cap, no
    # sentinel. Any other terminus (or the default None) keeps the cut.
    registry = session_registry(records)
    cutoff = _last_artifact_record_index(records, registry)
    if terminus == "approved":
        cutoff = None
```

The rest of the function body (the `lines = []` loop and `return`) is
unchanged. Then update the single caller in `build_bundle`, currently:

```python
    (out / "slice.md").write_text(slice_transcript(records))
```

to:

```python
    (out / "slice.md").write_text(slice_transcript(records, terminus))
```

(`terminus` is already computed earlier in `build_bundle`, before the bundle
dict is assembled — no reordering needed.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: PASS — the three new tests plus every existing slice test
(`test_slice_cuts_after_last_run_artifact`,
`test_slice_ignores_fixture_receipt_inside_read_tool_result`,
`test_slice_no_artifact_after_last_launch_falls_back_to_launch_tool_use_index`,
etc. all call `slice_transcript` with one argument and keep today's cut).

- [ ] **Step 5: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS (all green).

- [ ] **Step 6: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(ultralearn): approved-terminus slice extends through the approval exchange (#150 mode b)"
```

---

### Task 3: Drain-stamp writer — `record_wf_run.py stamp` subcommand + SKILL step (mode c, writer)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultradocket/scripts/record_wf_run.py`
- Modify: `skills/ultradocket/SKILL.md:138-152`
- Test: `tests/test_record_wf_run.py`

**Interfaces:**
- Consumes: `load_wf_runs(run_dir)` from the frozen `ultra_gate` module
  (already imported by this script today; unchanged).
- Produces: the `stamp` subcommand CLI —
  `record_wf_run.py stamp <stamp> <entry> --verdict <v> --exit-code <n> --branch <b> --base <ref>`
  — which writes `<repo-root>/.claude/ultrapowers/receipts/<stamp>-<entry>.json`
  containing exactly
  `{"mode": "drain-stamp", "stamp": str, "entry": str, "verdict": str, "gateExit": int, "branch": str, "base": str, "recordedAt": iso8601-str}`.
  This writer is the SCHEMA AUTHORITY for the record: the harvester-side task
  generates its test fixtures by invoking this CLI, so writer and reader
  cannot drift apart silently. Exit codes: 0 written, 1 not-a-git-repo,
  2 usage error.

The drain skips Step-5 by design and the frozen gate scripts are never
edited, so drain-gated runs have no `gate-receipt.json` for the sensor to
read once the runDir is torn down. This task adds the durable mirror on the
write side: `record_wf_run.py` is already the drain's "write a durable record
keyed by stamp under `.claude/ultrapowers/`" helper (same audience, same
SKILL step region), so the stamp record is a second mode on it — no new
script. Mirror-only: no runDir copy (the motivating 0.1.15 mode is precisely
a deleted runDir). Re-gates overwrite: same stamp + entry after a fix round
replaces the file — last write wins; the final verdict is the record. The
existing run-id mode is untouched. `.claude/ultrapowers/` is already in the
repo `.gitignore`, so the receipts mirror needs no ignore change.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_record_wf_run.py` (the `record`, `make_repo`, `SCRIPT`,
and `load_wf_runs` helpers already exist at the top of the file):

```python
# --- #150 mode (c), writer side: the `stamp` subcommand mirrors a drain-
# administered gate outcome to a teardown-surviving record. THIS WRITER IS
# THE SCHEMA AUTHORITY — the harvester's tests invoke it to generate their
# fixtures, so the assertions here pin the exact record shape.

def stamp_record(repo, stamp, entry, verdict="PASS", exit_code=0,
                 branch="ultra/entry-x", base="ultra/docket-x"):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "stamp", stamp, entry,
         "--verdict", verdict, "--exit-code", str(exit_code),
         "--branch", branch, "--base", base],
        cwd=repo, capture_output=True, text=True)


def test_stamp_mode_writes_mirror_record(tmp_path):
    repo = make_repo(tmp_path)
    r = stamp_record(repo, "20260814-120000", "146", verdict="PASS", exit_code=0)
    assert r.returncode == 0, r.stderr
    path = repo / ".claude/ultrapowers/receipts/20260814-120000-146.json"
    obj = json.loads(path.read_text())
    assert obj["mode"] == "drain-stamp"
    assert obj["stamp"] == "20260814-120000" and obj["entry"] == "146"
    assert obj["verdict"] == "PASS" and obj["gateExit"] == 0
    assert obj["branch"] == "ultra/entry-x" and obj["base"] == "ultra/docket-x"
    assert isinstance(obj["recordedAt"], str) and obj["recordedAt"]
    assert set(obj) == {"mode", "stamp", "entry", "verdict", "gateExit",
                        "branch", "base", "recordedAt"}


def test_stamp_mode_re_record_overwrites_last_write_wins(tmp_path):
    # A re-gate after a fix round replaces the file — the final verdict is
    # the record.
    repo = make_repo(tmp_path)
    assert stamp_record(repo, "20260814-120000", "146",
                        verdict="BLOCKED", exit_code=1).returncode == 0
    assert stamp_record(repo, "20260814-120000", "146",
                        verdict="PASS", exit_code=0).returncode == 0
    path = repo / ".claude/ultrapowers/receipts/20260814-120000-146.json"
    obj = json.loads(path.read_text())
    assert obj["verdict"] == "PASS" and obj["gateExit"] == 0


def test_stamp_mode_leaves_run_id_mode_untouched(tmp_path):
    # Both modes on one stamp: the stamp record never touches wf-runs.json,
    # and the legacy run-id mode round-trips through the frozen reader
    # exactly as before.
    repo = make_repo(tmp_path)
    assert record(repo, "d9", "wf_zzz-9").returncode == 0
    assert stamp_record(repo, "d9", "146").returncode == 0
    ids, unreadable = load_wf_runs(repo / ".claude/ultrapowers/run-d9")
    assert ids == ["wf_zzz-9"] and not unreadable


def test_stamp_mode_rejects_path_separator_in_names(tmp_path):
    repo = make_repo(tmp_path)
    assert stamp_record(repo, "20260814-120000", "a/b").returncode == 2
    assert stamp_record(repo, "a/b", "146").returncode == 2


def test_stamp_mode_missing_required_flag_exits_2(tmp_path):
    repo = make_repo(tmp_path)
    r = subprocess.run([sys.executable, str(SCRIPT), "stamp", "s", "e"],
                       cwd=repo, capture_output=True, text=True)
    assert r.returncode == 2
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_record_wf_run.py -v`
Expected: the 5 new tests FAIL (the current script treats `stamp` as a
positional `<stamp>` and exits 2 on argument count for every stamp-mode
invocation); the 3 existing tests PASS.

- [ ] **Step 3: Implement the subcommand**

Replace the entire contents of `skills/ultradocket/scripts/record_wf_run.py`
with (the run-id mode's body is byte-for-byte today's logic, only moved into
`_run_id_mode` with the shared `_repo_root` helper extracted):

```python
#!/usr/bin/env python3
"""Record drain-launched workflow evidence under .claude/ultrapowers/ (#122, #150).

Two modes:

run-id (legacy, unchanged): `record_wf_run.py <stamp> <wf_runId>`.
The Step-5 gate driver records wf run IDs into run-<stamp>/wf-runs.json; the
drain bypasses that driver by design, so teardown/approve reported an empty
sweep set. This mode writes the same file, importing the FROZEN reader for
shape fidelity (a bare sorted JSON array of run-id strings — drift impossible
by construction).

stamp (#150 mode c): `record_wf_run.py stamp <stamp> <entry> --verdict <v>
--exit-code <n> --branch <b> --base <ref>` mirrors a drain-administered gate
outcome to `<repo-root>/.claude/ultrapowers/receipts/<stamp>-<entry>.json` —
a teardown-surviving, gitignored record the ultralearn harvester reads when
the runDir itself is gone. Mirror-only (no runDir copy — the motivating mode
is precisely a deleted runDir). Verdict authority remains the gate's exit
code; the stamp is evidence for the sensor, never authority. Re-recording
the same <stamp>/<entry> overwrites: last write wins, the final verdict is
the record. THIS SCRIPT IS THE SCHEMA AUTHORITY for the stamp record — the
harvester's tests generate fixtures by invoking this writer, so writer and
reader cannot drift apart silently.
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
from ultra_gate import load_wf_runs  # frozen module: imported, never edited

USAGE = ("usage: record_wf_run.py <stamp> <wf_runId>\n"
         "       record_wf_run.py stamp <stamp> <entry> --verdict <v> "
         "--exit-code <n> --branch <b> --base <ref>")


def _repo_root():
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True)
    if top.returncode != 0:
        return None
    return Path(top.stdout.strip())


def _run_id_mode(argv):
    if len(argv) != 2:
        print(USAGE, file=sys.stderr)
        return 2
    stamp, run_id = argv
    root = _repo_root()
    if root is None:
        print("record_wf_run: not inside a git repository", file=sys.stderr)
        return 1
    run_dir = root / ".claude/ultrapowers" / ("run-" + stamp)
    ids, unreadable = load_wf_runs(run_dir)
    if unreadable:
        print("record_wf_run: existing wf-runs.json is unreadable — refusing to "
              "clobber it; inspect %s" % (run_dir / "wf-runs.json"), file=sys.stderr)
        return 1
    merged = sorted(set(ids) | {run_id})
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "wf-runs.json").write_text(json.dumps(merged, indent=2))
    print("record_wf_run: %s now records %d run id(s)" % (run_dir / "wf-runs.json", len(merged)))
    return 0


def _stamp_mode(argv):
    parser = argparse.ArgumentParser(
        prog="record_wf_run.py stamp",
        description="Mirror a drain-administered gate outcome to a "
                    "teardown-surviving stamp record (#150 mode c).")
    parser.add_argument("stamp")
    parser.add_argument("entry")
    parser.add_argument("--verdict", required=True)
    parser.add_argument("--exit-code", required=True, type=int, dest="exit_code")
    parser.add_argument("--branch", required=True)
    parser.add_argument("--base", required=True)
    args = parser.parse_args(argv)  # argparse exits 2 on a usage error
    if "/" in args.stamp or "/" in args.entry:
        print("record_wf_run: <stamp> and <entry> must not contain '/'",
              file=sys.stderr)
        return 2
    root = _repo_root()
    if root is None:
        print("record_wf_run: not inside a git repository", file=sys.stderr)
        return 1
    receipts = root / ".claude/ultrapowers/receipts"
    receipts.mkdir(parents=True, exist_ok=True)
    record = {
        "mode": "drain-stamp",
        "stamp": args.stamp,
        "entry": args.entry,
        "verdict": args.verdict,
        "gateExit": args.exit_code,
        "branch": args.branch,
        "base": args.base,
        "recordedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    path = receipts / ("%s-%s.json" % (args.stamp, args.entry))
    path.write_text(json.dumps(record, indent=2))  # last write wins by design
    print("record_wf_run: stamp record written to %s" % path)
    return 0


def main():
    argv = sys.argv[1:]
    if argv and argv[0] == "stamp":
        return _stamp_mode(argv[1:])
    return _run_id_mode(argv)


if __name__ == "__main__":
    sys.exit(main())
```

(A drain run-lock stamp is a `YYYYMMDD-HHMMSS` timestamp, so the literal word
`stamp` can never collide with a real first positional argument.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_record_wf_run.py -v`
Expected: PASS — all 8 (3 pre-existing run-id tests prove the legacy mode is
untouched; 5 new stamp-mode tests).

- [ ] **Step 5: Add the SKILL step-3 sentence**

In `skills/ultradocket/SKILL.md`, inside step 3 ("**Administer the
correctness gate**"), the disposition bullet list currently ends with:

```markdown
   - `waived` → no gate exists; **park for the operator** at the end gate. Never
     auto-merge unverified work.
```

Immediately after that bullet (still inside step 3, before the
"4. **Merge or park**" item), insert this paragraph:

```markdown
   Immediately after each drain-administered gate for a **waves-engine
   (`ultrapowers`) entry**, mirror the outcome to a teardown-surviving stamp
   record: `python3 skills/ultradocket/scripts/record_wf_run.py stamp <stamp>
   <entry> --verdict <verdict> --exit-code <exit> --branch <branch> --base
   <docket-integration-line-HEAD>` (same `<stamp>` as the step-2 run-ID
   record; `<verdict>`/`<exit>` are the gate runner's own JSON verdict and
   exit code — the stamp is evidence for the ultralearn sensor, never
   authority). A re-gate after a fix round re-records the same
   `<stamp>`/`<entry>` and overwrites — last write wins; the final verdict is
   the record. Subagent/inline entries record no stamp: they have no engine
   runDir or registry stamp for the harvester to key on.
```

- [ ] **Step 6: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS (all green — no test pins ultradocket SKILL.md text, and the
frozen gate scripts are untouched).

- [ ] **Step 7: Commit**

```bash
git add skills/ultradocket/scripts/record_wf_run.py skills/ultradocket/SKILL.md tests/test_record_wf_run.py
git commit -m "feat(ultradocket): record_wf_run stamp subcommand mirrors drain gate outcomes (#150 mode c)"
```

---

### Task 4: Drain-stamp reader — harvester terminus generalization (mode c, reader)

**Type:** implementation
**Depends-on:** 3
**Review:** adversarial

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py:427-462`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: the `stamp` subcommand CLI and record schema from Task 3 —
  `record_wf_run.py stamp <stamp> <entry> --verdict <v> --exit-code <n> --branch <b> --base <ref>`
  writing `{"mode": "drain-stamp", "stamp", "entry", "verdict", "gateExit", "branch", "base", "recordedAt"}`
  to `<repo-root>/.claude/ultrapowers/receipts/<stamp>-<entry>.json`. The
  writer is the schema authority: this task's tests generate their fixtures
  by INVOKING that CLI via subprocess, never by hand-writing the JSON.
- Produces: `_repo_root_from_run_dir(run_dir: str|None) -> str|None`,
  `_drain_stamp_receipts(run_dir: str|None, stamp: str) -> list[dict]`, and
  the widened `_stamp_terminus(run_dir, stamp_reports, drain_receipts=()) -> str`
  (default preserves every existing call). Sensor-internal — no sibling task
  consumes them.

Reviewer note (why adversarial): the terminus/approved-upgrade logic is the
one surface here that is hard to verify by reading — a dead-runDir path-string
derivation, a glob keyed by locating stamp, precedence between live disk
receipts and the mirror, a multi-entry aggregate, and a git-ancestry upgrade
whose failure mode is a silently wrong statistic rather than a crash. The
prior cycle's adversarial rounds on this exact function family caught
coincidentally-green tests twice.

A drain stamp is gate evidence: the receipt-present terminus path generalizes
to "receipt-or-stamp present", with the same merged-IS-approved upgrade
logic. Mirror discovery is pure path-string derivation — the registry's
recorded runDir string yields the repo root by stripping its
`.claude/ultrapowers/run-<stamp>` suffix; the (possibly deleted) runDir is
never touched on disk. Lookup is the `<stamp>-*.json` glob under
`<repo-root>/.claude/ultrapowers/receipts/`. A live `gate-receipt.json` on
disk always takes precedence over the mirror; the drain stamps are consulted
only when no disk gate receipt exists for the stamp.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_harvest_runs.py` (uses the existing `_rec`,
`_wf_launch`, `REAL`, `_git`, and `_init_git_repo` fixtures already defined
in the file):

```python
# --- #150 mode (c), reader side: drain-administered gate terminus via the
# stamp mirror. Fixtures are GENERATED BY INVOKING THE WRITER (the drain's
# record helper's `stamp` subcommand) — the writer is the schema authority,
# so these fixtures cannot drift from what the drain actually writes.

RECORD_WF_RUN = Path(__file__).resolve().parents[1] / \
    "skills/ultradocket/scripts/record_wf_run.py"


def _write_stamp_record(repo, stamp, entry, verdict, exit_code, branch, base):
    r = subprocess.run(
        [sys.executable, str(RECORD_WF_RUN), "stamp", stamp, entry,
         "--verdict", verdict, "--exit-code", str(exit_code),
         "--branch", branch, "--base", base],
        cwd=str(repo), capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_repo_root_from_run_dir_is_pure_string_derivation():
    assert h._repo_root_from_run_dir(
        "/x/repo/.claude/ultrapowers/run-20260814-120000") == "/x/repo"
    assert h._repo_root_from_run_dir("/x/repo/elsewhere/run-1") is None
    assert h._repo_root_from_run_dir("/x/repo") is None
    assert h._repo_root_from_run_dir(None) is None


def test_drain_stamp_gives_terminus_when_run_dir_deleted(tmp_path):
    # The 0.1.15 mode: the drain gated the entry (PASS via the frozen
    # runner's exit code) and the runDir was torn down; only the stamp
    # mirror survives. Pre-#150 this run read terminus "unknown".
    repo = tmp_path / "repo"
    _init_git_repo(repo)
    _write_stamp_record(repo, "20260814-120000", "146", "PASS", 0,
                        "ultra/entry-146", "ultra/docket-20260814-120000")
    run_dir = repo / ".claude/ultrapowers/run-20260814-120000"  # never exists on disk
    recs = REAL + [_wf_launch("20260814-120000", run_dir=str(run_dir))]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["gateReports"] == []            # no disk gate receipt existed
    assert bundle["runs"][0]["terminus"] == "PASS"
    assert bundle["terminus"] == "PASS"


def test_drain_stamp_ancestry_upgrades_to_approved(tmp_path):
    # Same upgrade rule as the receipt path — merged IS approved. The stamp
    # record carries head (branch) and base itself, so no runDir file read
    # is ever needed.
    repo = tmp_path / "repo"
    _init_git_repo(repo)
    _git(["checkout", "-q", "-b", "ultra/docket-D"], repo)
    _git(["checkout", "-q", "-b", "ultra/entry-146"], repo)
    (repo / "f.txt").write_text("entry\n")
    _git(["commit", "-q", "-am", "entry work"], repo)
    _git(["checkout", "-q", "ultra/docket-D"], repo)
    _git(["merge", "-q", "--no-ff", "-m", "merge entry", "ultra/entry-146"], repo)
    _write_stamp_record(repo, "20260814-130000", "146", "PASS", 0,
                        "ultra/entry-146", "ultra/docket-D")
    run_dir = repo / ".claude/ultrapowers/run-20260814-130000"  # deleted
    recs = REAL + [_wf_launch("20260814-130000", run_dir=str(run_dir))]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["runs"][0]["terminus"] == "approved"
    assert bundle["terminus"] == "approved"
    assert bundle["truncated"] is False


def test_drain_stamp_multi_entry_last_non_approved_wins(tmp_path):
    # One drain stamp covers several docket entries (one record each). All
    # approved -> approved; else the last (filename-sorted) non-approved
    # entry's verdict — mirroring the aggregate-terminus rule.
    repo = tmp_path / "repo"
    _init_git_repo(repo)
    _write_stamp_record(repo, "S", "124", "PASS", 0, "b1", "base")
    _write_stamp_record(repo, "S", "147", "BLOCKED", 1, "b2", "base")
    run_dir = str(repo / ".claude/ultrapowers/run-S")
    drain = h._drain_stamp_receipts(run_dir, "S")
    assert [e["receipt"]["entry"] for e in drain] == ["124", "147"]
    assert all(e["source"] == "stamp" and e["stamp"] == "S" for e in drain)
    assert h._stamp_terminus(run_dir, [], drain) == "BLOCKED"


def test_disk_gate_receipt_takes_precedence_over_drain_stamp(tmp_path):
    # A live disk gate receipt always outranks the mirror.
    repo = tmp_path / "repo"
    _init_git_repo(repo)
    run_dir = repo / ".claude/ultrapowers/run-S9"
    run_dir.mkdir(parents=True)
    (run_dir / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "NEEDS_ACK", "stamp": "S9"}))
    _write_stamp_record(repo, "S9", "146", "PASS", 0, "b", "base")
    stamp_reports = h._disk_receipts_for({"S9": str(run_dir)}, ["S9"])
    drain = h._drain_stamp_receipts(str(run_dir), "S9")
    assert h._stamp_terminus(str(run_dir), stamp_reports, drain) == "NEEDS_ACK"


def test_drain_stamp_receipts_fail_soft(tmp_path):
    assert h._drain_stamp_receipts(None, "S") == []
    assert h._drain_stamp_receipts("/no/engine/suffix", "S") == []
    repo = tmp_path / "repo"                      # no git needed: pure paths
    receipts = repo / ".claude/ultrapowers/receipts"
    receipts.mkdir(parents=True)
    (receipts / "S-bad.json").write_text("{corrupt")
    (receipts / "S-noverdict.json").write_text(json.dumps({"mode": "drain-stamp"}))
    run_dir = str(repo / ".claude/ultrapowers/run-S")
    assert h._drain_stamp_receipts(run_dir, "S") == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -k "drain_stamp or repo_root_from_run_dir or precedence_over" -v`
Expected: FAIL — `AttributeError: module 'harvest_runs' has no attribute
'_repo_root_from_run_dir'` (and `'_drain_stamp_receipts'`); the two
build_bundle tests fail on `terminus == "unknown"`.

- [ ] **Step 3: Implement the reader**

In `skills/ultralearn/scripts/harvest_runs.py`, insert the following directly
above the current `_stamp_terminus` definition:

```python
_RUN_DIR_SUFFIX = re.compile(r"/\.claude/ultrapowers/run-[^/]+$")


def _repo_root_from_run_dir(run_dir):
    """Repo root derived from the registry-recorded runDir PATH STRING (#150
    mode c): strip the `.claude/ultrapowers/run-<stamp>` suffix. Pure string
    work — a drain-gated run's runDir is typically torn down by the time the
    harvester runs, so the runDir is never touched on disk. None when the
    string does not carry the engine suffix."""
    if not isinstance(run_dir, str):
        return None
    m = _RUN_DIR_SUFFIX.search(run_dir)
    return run_dir[:m.start()] if m else None


def _drain_stamp_receipts(run_dir, stamp):
    """Mode (c) mirror lookup (#150): the `<stamp>-*.json` glob under
    `<repo-root>/.claude/ultrapowers/receipts/`, repo root from
    `_repo_root_from_run_dir` — one record per drain-gated docket entry,
    written by the drain's record helper's `stamp` subcommand (the schema
    authority). Entries are labeled by the LOCATING stamp, filename-sorted
    for determinism. Soft-fails: no derivable root, a missing receipts dir,
    or unreadable/malformed JSON is skipped, never raised; only dicts
    carrying a `verdict` qualify."""
    root = _repo_root_from_run_dir(run_dir)
    if root is None:
        return []
    entries = []
    try:
        files = sorted((Path(root) / ".claude/ultrapowers/receipts").glob(stamp + "-*.json"))
    except OSError:
        return []
    for f in files:
        try:
            obj = json.loads(f.read_text())
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        if isinstance(obj, dict) and "verdict" in obj:
            entries.append({"receipt": obj, "stamp": stamp, "source": "stamp"})
    return entries


def _drain_ancestry_approved(run_dir, receipt):
    """Approved-upgrade for a drain-stamp record (#150 mode c): merged IS
    approved, same rule as the receipt path. head = the record's own
    `branch`, base = its `base` — both carried in the record, so no runDir
    file read is ever needed; repo root comes from the runDir PATH STRING.
    Fails soft to False on any unresolvable repo, ref, or git invocation."""
    repo_root = _repo_root_from_run_dir(run_dir)
    if not repo_root:
        return False
    head = receipt.get("branch")
    base = receipt.get("base")
    if not (isinstance(head, str) and head.strip()
            and isinstance(base, str) and base.strip()):
        return False
    try:
        res = subprocess.run(
            ["git", "-C", repo_root, "merge-base", "--is-ancestor",
             head.strip(), base.strip()],
            capture_output=True, text=True, timeout=_GIT_TIMEOUT)
        return res.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _drain_stamp_terminus(run_dir, drain_receipts):
    """Terminus from mode-(c) drain-stamp records (#150): each entry's
    verdict upgrades to `approved` when its recorded branch landed on its
    recorded base. All entries approved -> approved; else the last
    (filename-sorted) non-approved entry's verdict — the aggregate-terminus
    rule applied at the entry level."""
    resolved = []
    for e in drain_receipts:
        receipt = e["receipt"]
        verdict = receipt.get("verdict", "unknown")
        if _drain_ancestry_approved(run_dir, receipt):
            verdict = "approved"
        resolved.append(verdict)
    non_approved = [v for v in resolved if v != "approved"]
    return "approved" if not non_approved else non_approved[-1]
```

Then generalize `_stamp_terminus`. It currently reads:

```python
def _stamp_terminus(run_dir, stamp_reports):
    """Per-stamp terminus (#126 Task 2): the disk receipt's own verdict,
    upgraded to `approved` when git ancestry proves the run's head landed on
    its base branch. Structured only, no transcript scanning: the
    merge-evidence prose matcher (`_merge_evidence_after`) and the
    approve-marker/stamp-interleave tracking it replaced are deleted
    outright — the git check subsumes both. `stamp_reports` is this stamp's
    own disk-sourced gate_reports entries; no disk receipt at all means
    nothing to read a verdict OR a head sha from -> `unknown`."""
    if not stamp_reports:
        return "unknown"
    receipt = stamp_reports[-1]["receipt"]
    verdict = receipt.get("verdict", "unknown")
    if run_dir and _git_ancestry_approved(run_dir, receipt):
        return "approved"
    return verdict
```

Replace it with:

```python
def _stamp_terminus(run_dir, stamp_reports, drain_receipts=()):
    """Per-stamp terminus (#126 Task 2, generalized receipt-or-stamp by #150
    mode c): the disk receipt's own verdict, upgraded to `approved` when git
    ancestry proves the run's head landed on its base branch. Structured
    only, no transcript scanning: the merge-evidence prose matcher
    (`_merge_evidence_after`) and the approve-marker/stamp-interleave
    tracking it replaced are deleted outright — the git check subsumes both.
    `stamp_reports` is this stamp's own disk-sourced gate_reports entries and
    always takes precedence; `drain_receipts` (the #150 stamp mirror) is
    consulted only when no disk receipt exists — the drain skips Step-5 and
    tears the runDir down, so for those runs the mirror is the only gate
    evidence left. Neither present -> `unknown`."""
    if stamp_reports:
        receipt = stamp_reports[-1]["receipt"]
        verdict = receipt.get("verdict", "unknown")
        if run_dir and _git_ancestry_approved(run_dir, receipt):
            return "approved"
        return verdict
    if drain_receipts:
        return _drain_stamp_terminus(run_dir, drain_receipts)
    return "unknown"
```

Finally wire the lookup into `_runs_for_bundle`. Its loop currently reads:

```python
    runs = []
    for stamp in registry["stamps"]:
        stamp_reports = by_stamp.get(stamp, [])
        run_dir = registry["runDirsByStamp"].get(stamp)
        runs.append({
            "stamp": stamp,
            "planPath": registry["planPathsByStamp"].get(stamp),
            "gateReports": stamp_reports,
            "terminus": _stamp_terminus(run_dir, stamp_reports),
        })
    return runs
```

Replace the loop with:

```python
    runs = []
    for stamp in registry["stamps"]:
        stamp_reports = by_stamp.get(stamp, [])
        run_dir = registry["runDirsByStamp"].get(stamp)
        # #150 mode (c): the stamp mirror is consulted only when no disk
        # gate receipt exists for this stamp — it never enters gateReports
        # (which stay disk-sourced only), it only informs terminus.
        drain_receipts = [] if stamp_reports else _drain_stamp_receipts(run_dir, stamp)
        runs.append({
            "stamp": stamp,
            "planPath": registry["planPathsByStamp"].get(stamp),
            "gateReports": stamp_reports,
            "terminus": _stamp_terminus(run_dir, stamp_reports, drain_receipts),
        })
    return runs
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: PASS — the 6 new tests and every existing terminus test unchanged
(`test_stamp_terminus_no_receipt_is_unknown` still passes via the default
`drain_receipts=()`; `test_launch_only_session_bundles_as_engine_unknown`
still reads `unknown` because its fixture repo root `/repo` has no receipts
dir; the `test_stamp_terminus_*` git-ancestry family is untouched on the
receipt path).

- [ ] **Step 5: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS (all green).

- [ ] **Step 6: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(ultralearn): drain-stamp terminus via path-string repo-root mirror lookup (#150 mode c)"
```
