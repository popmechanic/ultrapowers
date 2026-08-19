# Fold-native Phase 1 — resolver reach — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — the committed pytest suite plus the `.mjs` harness sims (`tests/frontier_merge.mjs`, `tests/sim_workflow.mjs`; the suite-gate runs them because `harnesses/waves.js` changes and both print their pass sentinel) are the verification; the T15-rig cells and the shakedown are manual runtime stages (Tasks 10–11), not the gate; sealing not requested.

**Goal:** Make fold reach the files that carry real contention: hunk-scoped resolver briefs, incremental fold (resolve, then continue), the 400-line cap retired, a big-stack fold thread, the `contend-big` fixture and its T15-rig gate, and the sensor baseline Phase 2/3 read — released as 0.3.0 after the gate passes.

**Architecture:** A brief-layer change (new `kernel/hunks.py`: derive hunks from the kernel's annotated narration, splice per-hunk replies back) over an unchanged kernel and fold-log schema; `fold_wave.py` becomes an incremental protocol (fold → stop at first conflicting fold → resolve → continue → complete) with a park pre-scan, `--conflict <i>` addressing, a stale refusal instead of re-narration, and a `materialize` completeness refusal; kernel work runs on a 1 GiB-stack thread; `RESOLVER_LINE_CAP` and every size term go; `waves.js` runs a work-list resolver loop with a `REJECTED` retry and re-baked STEP/RESOLVER prompts; `contend-big` = `contend-prod` with a ~6k-line `registry.py`; `audit_run.py`/`harvest_runs.py` gain the Phase-3 fields.

**Tech Stack:** Python 3 stdlib (kernel/CLI/tests, pytest), Node ESM (`waves.js`, `tests/frontier_merge.mjs`), git, the existing `evals/ab_runner.py` rig.

**Spec:** `docs/superpowers/specs/2026-08-18-fold-native-authoring-program.md` (rev 6, §Phase 1, §Verification, §Trim review) — the plan argues from it; every protocol table row, exit code, and stdout key below is copied from §1b.

## Global Constraints

- Frozen verification periphery untouched: `skills/ultrapowers/scripts/{ultra_gate.py,gate_check.py,collect_seal.py,seal_hash.py,run_acceptance.sh,run_lock.sh}` are never edited. The compiler's diagnostic vocabulary is **not** changed in Phase 1 (only the `fold_eligible` line-count term goes).
- Kernel and fold-log contract unchanged: `fold_log.jsonl` keeps exactly three event types (`base`, `fold`, `resolve`); `rehydrate`/`replay`/K-gates untouched; the 4-line `_touched_at`/epoch refusal in `FrontierEngine.apply_resolution` is **kept** (idempotency guard).
- Prompts are baked: edit `skills/ultrapowers/references/wave-merge.md`, re-bake per `references/workflow-template.md`, keep `python3 -m pytest tests/test_no_prompt_drift.py` green. `FOLD_SCHEMA` is JS-only and pinned by the sim.
- Harness JS changed ⇒ `node tests/frontier_merge.mjs` and `node tests/sim_workflow.mjs` must print `ALL SCENARIOS PASSED`; every new guard is mutation-verified (temporarily invert it, watch its scenario fail, restore).
- Reply grammar (spec §1a): a hunk reply file is a sequence of `\n`-terminated lines; empty file = zero lines; a final line without `\n` is a rejection; the file's final-newline status is inherited from the narration, never from a hunk. Exit codes (spec §1b): 0 ok · 2 stale / log-list disagreement / log-exists · 3 self-check failure or kernel-limit park · 4 rejected.
- Python versions: local dev is 3.9 (`/usr/bin/python3`), CI is 3.11 (`.github/workflows/ci.yml`); the big-stack thread is what makes 3.9 fold large files — the 100k-line pin must pass on both.
- No direct Anthropic API calls, no `anthropic` SDK, no `ANTHROPIC_API_KEY`.
- Release: 0.3.0 (architectural — cap retired, brief shape changed): bump **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`; commit `chore(release): 0.3.0 — …`; confirm `gh run list --branch main` green afterwards.
- Concurrency-safe tests: every test uses `tmp_path` repos and unique run dirs; no shared on-disk fixtures; subprocess tests use `sys.executable`.

---

### Task 1: Read the resolver token share out of the T15 transcripts (measurement before build)

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/frontier/results/2026-08-19-t15-resolver-token-share.md`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the resolver token share number the Phase-1 gate's E2″ promise is argued from (a results doc; no code).

Spec §1a: "the plan's first task reads the resolver token share out of the preserved T15 transcripts so E2″ is promised from data, not assumed."

- [ ] **Step 1: Locate the T15 fold-arm cell.** `evals/frontier/results/2026-08-14-t15-ab.md` names it: cell run dir `run-20260814-055932`, transcripts under that cell's workflow dir; the raw JSON `2026-08-13-frontier-cell.json` and `runs.jsonl` under `evals/results/` carry `outputTokens` per arm (arm B 231,245). Find the arm-B agent transcripts (`agent-*.jsonl`) with `grep -l "merge-conflict resolver" <cell-transcript-dir>/agent-*.jsonl`.
- [ ] **Step 2: Sum resolver tokens.** For each resolver transcript, sum `message.usage.output_tokens` over `type == "assistant"` records (the same read `audit_run.collect` does) — write a 15-line Python snippet in the doc's appendix that does exactly this so the number is reproducible. Also record per-dispatch input size: the narration file line count (`conflict-N.txt`) and the appended contending-tasks block size (all four task bodies).
- [ ] **Step 3: Write the doc** with: total arm-B output tokens; resolver output tokens (5 dispatches) and share; per-dispatch narration lines vs task-bodies chars; the projected brief size under hunk scoping (Σ blocks + 2·40 context lines per hunk) for the same conflicts; one sentence stating whether the file or the task bodies were the bulk of the brief. Conclude with the E2″ expectation for `contend-big` in one line ("hunk briefs remove the whole-file term; the task-body term is unchanged in Phase 1").
- [ ] **Step 4: Commit.** `git add evals/frontier/results/2026-08-19-t15-resolver-token-share.md && git commit -m "evals: T15 resolver token-share reading (Phase-1 task 1)"`

---

### Task 2: `kernel/hunks.py` — derive hunks from an annotated narration; splice per-hunk replies back

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `skills/ultrapowers/kernel/hunks.py`
- Test: `tests/test_hunks.py`

**Interfaces:**
- Consumes: `repo_weave.split_lines`, `repo_weave.join_lines`, `repo_weave.MARKERS`; the kernel marker forms (`<<<<<<< begin added|deleted <side>`, `======= begin added|deleted <side>`, `>>>>>>> end conflict`; sides after `_relabel`: `frontier`, `<task>`, `both`).
- Produces: `CONTEXT_LINES = 40`; `class HunkError(Exception)` with `.reason: str`; `derive(annotated: str) -> tuple[str, list[dict]]` returning `(hunks_text, blocks)` where each block is `{"id": "h1", "start": int, "end": int, "bodyEnd": int, "eofTail": list[str]}` (0-based inclusive line indices into `split_lines(annotated)` covering the block only, markers inclusive; `bodyEnd` = last reply-owned line, `eofTail` = the EOF `added both` segment moved to trailing context, `[]` otherwise); `read_reply_dir(reply_dir: Path, blocks) -> dict[str, list[str]]` (raises `HunkError` per spec §1a rejections); `splice(annotated: str, replies: dict[str, list[str]], blocks) -> list[str]` (whole-file line list, context byte-identical); `strip_markers(annotated: str) -> list[str]` (the kernel's merged content: drops marker lines and `deleted`-segment lines — the round-trip oracle); `MARKER_SHAPED = "marker-shaped content"` (park reason).

Spec §1a rules restated for the implementer: a block runs from a `<<<<<<< begin ` line to the next `>>>>>>> end conflict` line, inclusive; segments inside are separated by `======= begin ` lines; each segment is `added` or `deleted` for a side. **`added both` segments are reply-owned** — except the EOF case: when the file's last block ends at EOF (nothing after its end marker) and its final segment is `added both`, that whole segment (whitespace-only by construction: `[""]`, `["", ""]`, …) is moved out of the block into trailing context. Context = up to `CONTEXT_LINES` unmarked lines before/after a block, truncated at a neighbouring block's markers. If any *content* line (a line that is not at a marker position) is byte-equal to a marker form, `derive` raises `HunkError(MARKER_SHAPED)`.

- [ ] **Step 1: Write the failing tests** — `tests/test_hunks.py`:

```python
"""hunks.py — derive/splice for hunk-scoped resolver briefs (spec §1a).
Round-trip oracle: splice(derive(A), kernel-merged block bodies) == strip_markers(A)."""
import sys
from pathlib import Path
import pytest

KERNEL = Path(__file__).resolve().parents[1] / "skills/ultrapowers/kernel"
sys.path.insert(0, str(KERNEL)); sys.path.insert(0, str(KERNEL / "vendor"))
import hunks
import repo_weave as rw
import manyana


def _annotate(base, left, right, task="task-2"):
    """Real kernel annotation, relabeled like _fold_text does (frontier/<task>)."""
    b = manyana.initial_state(rw.split_lines(base))
    l = manyana.update_state(b, rw.split_lines(left))
    r = manyana.update_state(b, rw.split_lines(right))
    _merged, ann = manyana.merge_states(l, r)
    return rw._relabel(ann, task)


def _block_bodies(annotated, blocks):
    """The kernel's own merged content per block: added lines kept, deleted dropped."""
    lines = rw.split_lines(annotated)
    out = {}
    for b in blocks:
        body, keep = [], True
        for ln in lines[b["start"]:b["end"] + 1]:
            if ln.startswith("<<<<<<< begin ") or ln.startswith("======= begin "):
                keep = " added " in ln
                continue
            if ln == ">>>>>>> end conflict":
                continue
            if keep:
                body.append(ln)
        out[b["id"]] = body
    return out


BASE = "a\nwire()\nz\n"


def test_derive_one_block_and_context():
    ann = _annotate(BASE, "a\nwire()\nx\nz\n", "a\nwire()\ny\nz\n")
    text, blocks = hunks.derive(ann)
    assert len(blocks) == 1 and blocks[0]["id"] == "h1"
    assert "HUNK h1 lines" in text and "--- context (read-only)" in text
    assert "<<<<<<< begin added frontier" in text and ">>>>>>> end conflict" in text
    assert "wire()" in text  # context carried


def test_round_trip_property_on_kernel_shapes():
    cases = [
        (BASE, "a\nwire()\nx\nz\n", "a\nwire()\ny\nz\n"),          # interior
        ("x\n", "x\na\n", "x\nb\n"),                                # EOF, ends \n
        ("x\n\n", "x\na\n\n", "x\nb\n\n"),                          # EOF, ends \n\n
        ("x", "x\na", "x\nb"),                                      # no final newline
        ("a\nb\nc\nd\n", "a\nB\nc\nd\n", "a\nb\nc\nD\n"),           # two blocks
    ]
    for base, left, right in cases:
        ann = _annotate(base, left, right)
        _text, blocks = hunks.derive(ann)
        replies = _block_bodies(ann, blocks)
        assert hunks.splice(ann, replies, blocks) == hunks.strip_markers(ann), (base, left, right)


def test_eof_added_both_segment_moves_to_context():
    ann = _annotate("x\n\n", "x\na\n\n", "x\nb\n\n")
    text, blocks = hunks.derive(ann)
    # the trailing ["", ""] is context, not inside the reply-owned block
    lines = rw.split_lines(ann)
    blk = lines[blocks[0]["start"]:blocks[0]["end"] + 1]
    assert "======= begin added both" not in blk
    out = hunks.splice(ann, {"h1": ["a", "b"]}, blocks)
    assert rw.join_lines(out) == "x\na\nb\n\n"          # final newline + blank kept


def test_marker_shaped_content_parks():
    ann = _annotate(BASE, "a\nwire()\nx\nz\n", "a\nwire()\ny\nz\n")
    poisoned = ann.replace("z", ">>>>>>> end conflict")   # content line equal to a marker form
    with pytest.raises(hunks.HunkError) as e:
        hunks.derive(poisoned)
    assert e.value.reason == hunks.MARKER_SHAPED


def test_read_reply_dir_grammar(tmp_path):
    ann = _annotate(BASE, "a\nwire()\nx\nz\n", "a\nwire()\ny\nz\n")
    _t, blocks = hunks.derive(ann)
    d = tmp_path / "reply-1-1"; d.mkdir()
    (d / "h1.txt").write_text("x\ny\n")
    assert hunks.read_reply_dir(d, blocks) == {"h1": ["x", "y"]}
    (d / "h1.txt").write_text("")                                   # zero lines = deletion
    assert hunks.read_reply_dir(d, blocks) == {"h1": []}
    (d / "h1.txt").write_text("x\ny")                                # no final newline
    with pytest.raises(hunks.HunkError) as e: hunks.read_reply_dir(d, blocks)
    assert "final line" in e.value.reason
    (d / "h1.txt").write_text("x\n>>>>>>> end conflict\n")           # exact marker form
    with pytest.raises(hunks.HunkError) as e: hunks.read_reply_dir(d, blocks)
    assert "marker" in e.value.reason
    (d / "h1.txt").write_text("=======\n")                           # bare ======= is legal
    assert hunks.read_reply_dir(d, blocks) == {"h1": ["======="]}
    (d / "h1.txt").unlink()                                          # omitted hunk
    with pytest.raises(hunks.HunkError) as e: hunks.read_reply_dir(d, blocks)
    assert "missing" in e.value.reason
    (d / "h1.txt").write_text("x\n"); (d / "h9.txt").write_text("q\n")   # unknown hunk
    with pytest.raises(hunks.HunkError) as e: hunks.read_reply_dir(d, blocks)
    assert "unknown" in e.value.reason


def test_context_truncates_at_neighbouring_markers():
    base = "\n".join(f"l{i}" for i in range(10)) + "\n"
    left = base.replace("l3", "L3").replace("l6", "L6")
    right = base.replace("l3", "R3").replace("l6", "R6")
    ann = _annotate(base, left, right)
    text, blocks = hunks.derive(ann)
    assert len(blocks) == 2
    # no marker line appears in a context section
    in_ctx = False
    for ln in text.splitlines():
        if ln.startswith("--- context"): in_ctx = True
        elif ln.startswith("--- conflict") or ln.startswith("HUNK "): in_ctx = False
        elif in_ctx: assert not ln.strip().startswith(("<<<<<<< begin", "======= begin", ">>>>>>> end")), ln
```

- [ ] **Step 2: Run to verify they fail** — `python3 -m pytest tests/test_hunks.py -q` → `ModuleNotFoundError: hunks`.
- [ ] **Step 3: Implement `skills/ultrapowers/kernel/hunks.py`:**

```python
"""Hunk-scoped resolver briefs (spec 2026-08-18-fold-native-authoring-program §1a).

derive():  annotated narration -> (hunks text, block index)
splice():  annotated narration + per-hunk replies -> whole-file line list
The kernel and the fold log never see any of this: the splice output is the
whole-file line list `FrontierEngine.apply_resolution` always took.
"""
from pathlib import Path
import repo_weave as rw

CONTEXT_LINES = 40
MARKER_SHAPED = "marker-shaped content"
_BEGIN, _SEP, _END = "<<<<<<< begin ", "======= begin ", ">>>>>>> end conflict"


class HunkError(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def _is_marker(ln):
    return ln.startswith(_BEGIN) or ln.startswith(_SEP) or ln == _END


def _blocks(lines):
    """[(start, end)] inclusive indices of every marker block; raises on a
    content line byte-equal to a marker form (undelimitable)."""
    out, i, n = [], 0, len(lines)
    while i < n:
        ln = lines[i]
        if ln.startswith(_BEGIN):
            j = i + 1
            while j < n and lines[j] != _END:
                if lines[j].startswith(_BEGIN):
                    raise HunkError(MARKER_SHAPED)
                j += 1
            if j >= n:
                raise HunkError(MARKER_SHAPED)
            out.append((i, j)); i = j + 1
        elif _is_marker(ln):
            raise HunkError(MARKER_SHAPED)     # SEP/END outside a block
        else:
            i += 1
    return out


def _segments(lines, start, end):
    """[(kind, side, [content lines])] for a block, in order."""
    segs, cur = [], None
    for ln in lines[start:end + 1]:
        if ln.startswith(_BEGIN) or ln.startswith(_SEP):
            head = ln[len(_BEGIN):] if ln.startswith(_BEGIN) else ln[len(_SEP):]
            kind, side = head.split(" ", 1)
            cur = (kind, side, []); segs.append(cur)
        elif ln == _END:
            break
        else:
            cur[2].append(ln)
    return segs


def _eof_both_tail(lines, start, end):
    """Spec §1a EOF rule: block ends at EOF and its final segment is `added both`
    -> that (whitespace-only) segment leaves the block. Returns the trailing
    context lines to carry, or []."""
    if end != len(lines) - 1:
        return []
    segs = _segments(lines, start, end)
    if segs and segs[-1][0] == "added" and segs[-1][1] == "both":
        return list(segs[-1][2])
    return []


def derive(annotated):
    lines = rw.split_lines(annotated)
    spans = _blocks(lines)
    blocks, out = [], []
    for k, (start, end) in enumerate(spans, start=1):
        hid = "h%d" % k
        tail = _eof_both_tail(lines, start, end)
        prev_end = spans[k - 2][1] if k >= 2 else -1
        next_start = spans[k][0] if k < len(spans) else len(lines)
        before = lines[max(prev_end + 1, start - CONTEXT_LINES):start]
        after = tail if tail else lines[end + 1:min(next_start, end + 1 + CONTEXT_LINES)]
        body_end = end
        if tail:   # drop the trailing `added both` separator + its lines from the block body
            body_end = end - len(tail) - 1
        blocks.append({"id": hid, "start": start, "end": end, "bodyEnd": body_end,
                       "eofTail": tail})
        out.append("HUNK %s lines %d-%d" % (hid, start + 1, end + 1))
        out.append("--- context (read-only)"); out.extend("  " + l for l in before)
        out.append("--- conflict"); out.extend(lines[start:body_end + 1])
        if tail:
            out.append(_END)
        out.append("--- context (read-only)"); out.extend("  " + l for l in after)
        out.append("")
    return "\n".join(out), blocks


def strip_markers(annotated):
    lines = rw.split_lines(annotated)
    out, keep, in_block = [], True, False
    for ln in lines:
        if ln.startswith(_BEGIN) or ln.startswith(_SEP):
            in_block, keep = True, (" added " in ln + " ")
            continue
        if ln == _END:
            in_block, keep = False, True
            continue
        if keep:
            out.append(ln)
    return out


def read_reply_dir(reply_dir, blocks):
    reply_dir = Path(reply_dir)
    ids = [b["id"] for b in blocks]
    present = {p.stem for p in reply_dir.glob("h*.txt")}
    unknown = sorted(present - set(ids))
    if unknown:
        raise HunkError("unknown hunk file(s): %s" % ", ".join(unknown))
    replies = {}
    for hid in ids:
        f = reply_dir / (hid + ".txt")
        if not f.is_file():
            raise HunkError("missing reply for %s" % hid)
        data = f.read_bytes().decode("utf-8", errors="replace")
        if data == "":
            replies[hid] = []
            continue
        if not data.endswith("\n"):
            raise HunkError("%s: final line without newline" % hid)
        body = data[:-1].split("\n")
        for ln in body:
            if _is_marker(ln):
                raise HunkError("%s: reply contains a kernel marker form" % hid)
        replies[hid] = body
    return replies


def splice(annotated, replies, blocks):
    lines = rw.split_lines(annotated)
    out, pos = [], 0
    for b in blocks:
        out.extend(lines[pos:b["start"]])
        out.extend(replies[b["id"]])
        out.extend(b["eofTail"])
        pos = b["end"] + 1
    out.extend(lines[pos:])
    return out
```

- [ ] **Step 4: Run** `python3 -m pytest tests/test_hunks.py -q` → all pass. If `test_round_trip_property_on_kernel_shapes` fails on the `\n\n` case, the `bodyEnd` arithmetic is off by one — the tail segment occupies `1 + len(tail)` lines before `_END`.
- [ ] **Step 5: Commit.** `git add skills/ultrapowers/kernel/hunks.py tests/test_hunks.py && git commit -m "kernel: hunks.py — derive/splice for hunk-scoped resolver briefs (spec §1a)"`

---

### Task 3: `fold_wave.py` — incremental fold protocol, `--conflict` resolve, stale refusal, materialize completeness, `fold_stats.json`

**Type:** implementation
**Depends-on:** 2
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/kernel/fold_wave.py`
- Modify: `skills/ultrapowers/kernel/FOLD_LOG.md`
- Test: `tests/test_fold_wave.py`
- Test: `tests/test_fold_wave_materialize.py`

**Interfaces:**
- Consumes: `hunks.derive/read_reply_dir/splice/HunkError/MARKER_SHAPED` (Task 2); existing `frontier_fold.FrontierEngine`, `rehydrate`, `dispatchable`, `_union_touched`, `raw_shuffle_outcomes`; `repo_weave.publish/snapshot_scoped`.
- Produces: the CLI protocol of spec §1b — `fold --repo --run-dir --wave --base --branch <id>=<branch>:<sha>...` (stdout `{clean, conflicts, dispatchable, parked, open: [{i, path, kind, epoch, hunksFile, hunkCount}], remaining, complete, selfChecks?}`; exit 0 / 2 log exists / 3); `resolve --repo --run-dir --wave --conflict <i> --reply-dir <dir> --branch <triples>...` (stdout shapes: `{applied:true, waiting:[i..]}` · `{applied:true, conflicts, dispatchable, open, remaining, complete:false}` · `{applied:true, open:[], remaining:[], complete:true, selfChecks}` · `{applied:false, stale:true}` · `{applied:false, rejected:true, reason}`; exit 0 / 2 stale or log-list disagreement / 3 self-check or kernel-limit / 4 rejected); `materialize` refuses incomplete folds with `{fallback: "incomplete fold: <n> task(s) unfolded / <m> path(s) unresolved"}` exit 3; `frontier/wave-<n>/fold_stats.json` = `{"maxLines": [<per fold call>]}`; `conflicts.json` entries gain `hunksFile`, `hunkCount`.

Design notes for the implementer (from spec §1b): the fold log is the authority for what has folded — its `fold` events must be an `(id, headSha)` prefix of the supplied triples over the same `base`, else exit 2 `log/list disagreement`. `remaining` = supplied minus that prefix. `complete` is derived (all folded ∧ `_unresolved_paths` empty), never recorded. The **park pre-scan**: `fold`'s first call folds the whole wave once in memory (no log) to report parks up front; a parked pre-scan writes the park entries + `conflict-<i>.txt` reasons to `conflicts.json`, writes no log, exits 0 with `parked > 0` (the engine maps it to PARKED). Then the incremental pass writes `base` + folds until the first fold that opens ≥1 `lines`/`add-add` conflict → narrations + hunks files + index entries at monotonic `i` → stop. `resolve` locates its entry by `--conflict <i>`, applies at that entry's `epoch` (stale → exit 2, no re-narration), and — when every entry of the current stop (entries at the max narrated epoch) is resolved — continues folding. Self-checks (raw shuffle + rehydrate-manifest replay) run in whichever call completes the wave.

- [ ] **Step 1: Rewrite the stale test and add protocol tests** in `tests/test_fold_wave.py` (reuse `make_repo`, `add_third_branch`, `do_fold`, `run_cli`, `last_json`; add a `do_resolve(repo, run_dir, wave, i, reply_dir, branch_specs)` helper mirroring `do_fold` with `--conflict`, `--reply-dir` and the same `--branch` triples). Delete `test_resolve_stale_renarrates_once_markerless`. Add:

```python
def _reply_dir(tmp_path, name, **hunk_files):
    d = tmp_path / name; d.mkdir()
    for hid, text in hunk_files.items():
        (d / (hid + ".txt")).write_text(text)
    return d


def test_fold_stops_at_first_conflicting_fold_and_reports_remaining(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    t3 = add_third_branch(repo, base_sha)                 # (name, sha) editing c()
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"]), ("t3", t3[0], t3[1])]
    r = do_fold(repo, run_dir, 1, base_sha, specs)
    assert r.returncode == 0, r.stderr
    p = last_json(r)
    assert p["complete"] is False and p["remaining"] == ["t3"]
    assert p["conflicts"] == p["dispatchable"] == len(p["open"]) == 1
    e = p["open"][0]
    assert e["path"] == "app.py" and e["hunkCount"] == 1
    assert Path(e["hunksFile"]).is_file() and "HUNK h1" in Path(e["hunksFile"]).read_text()
    assert "selfChecks" not in p                           # a stop reply carries none
    events = [json.loads(l) for l in (run_dir / "frontier/wave-1/fold_log.jsonl").read_text().splitlines()]
    assert [ev["task"] for ev in events if ev["type"] == "fold"] == ["t1", "t2"]


def test_resolve_applies_then_continues_to_completion_with_self_checks(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    t3 = add_third_branch(repo, base_sha)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"]), ("t3", t3[0], t3[1])]
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))
    d = _reply_dir(tmp_path, "reply-1-1", h1="    return y + 1 * 2\n")
    r = run_cli("resolve", "--repo", str(repo), "--run-dir", str(run_dir), "--wave", "1",
                "--conflict", str(p["open"][0]["i"]), "--reply-dir", str(d),
                *sum([["--branch", "%s=%s:%s" % s] for s in specs], []))
    assert r.returncode == 0, r.stderr
    q = last_json(r)
    assert q["applied"] is True and q["complete"] is True and q["selfChecks"] == "ok"
    events = [json.loads(l) for l in (run_dir / "frontier/wave-1/fold_log.jsonl").read_text().splitlines()]
    assert [ev["type"] for ev in events] == ["base", "fold", "fold", "resolve", "fold"]
    stats = json.loads((run_dir / "frontier/wave-1/fold_stats.json").read_text())
    assert len(stats["maxLines"]) >= 1


def test_reissued_resolve_is_a_stale_refusal_not_a_renarration(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    t3 = add_third_branch(repo, base_sha)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"]), ("t3", t3[0], t3[1])]
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))
    d = _reply_dir(tmp_path, "reply-1-1", h1="    return y + 1 * 2\n")
    args = ["resolve", "--repo", str(repo), "--run-dir", str(run_dir), "--wave", "1",
            "--conflict", str(p["open"][0]["i"]), "--reply-dir", str(d),
            *sum([["--branch", "%s=%s:%s" % s] for s in specs], [])]
    assert run_cli(*args).returncode == 0
    r = run_cli(*args)                                     # the same command again
    assert r.returncode == 2 and last_json(r) == {"applied": False, "stale": True}
    assert not (run_dir / "frontier/wave-1").glob("conflict-*renarr*")


def test_rejected_reply_exits_4_with_reason(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])]
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))
    d = _reply_dir(tmp_path, "reply-1-1", h1="    return y\n>>>>>>> end conflict\n")
    r = run_cli("resolve", "--repo", str(repo), "--run-dir", str(run_dir), "--wave", "1",
                "--conflict", str(p["open"][0]["i"]), "--reply-dir", str(d),
                *sum([["--branch", "%s=%s:%s" % s] for s in specs], []))
    assert r.returncode == 4
    q = last_json(r)
    assert q["applied"] is False and q["rejected"] is True and "marker" in q["reason"]


def test_log_list_disagreement_refuses(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])]
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))
    d = _reply_dir(tmp_path, "reply-1-1", h1="    return y\n")
    r = run_cli("resolve", "--repo", str(repo), "--run-dir", str(run_dir), "--wave", "1",
                "--conflict", str(p["open"][0]["i"]), "--reply-dir", str(d),
                "--branch", "t2=t2:%s" % heads["t2"], "--branch", "t1=t1:%s" % heads["t1"])  # reordered
    assert r.returncode == 2 and "disagreement" in (r.stderr + r.stdout)


def test_pre_scan_reports_parks_before_any_narration(tmp_path):
    repo, base_sha, heads = make_union_scope_repo(tmp_path)   # existing helper with a binary/presence park
    run_dir = tmp_path / "run"
    r = do_fold(repo, run_dir, 1, base_sha, [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])])
    p = last_json(r)
    if p["parked"]:
        assert not (run_dir / "frontier/wave-1/fold_log.jsonl").exists()
        idx = json.loads((run_dir / "frontier/wave-1/conflicts.json").read_text())
        assert all(e["dispatchable"] is False for e in idx)
```

Adjust the last test to whichever existing helper builds a park (`make_union_scope_repo` or `make_big_conflict_repo` — read them; if none parks, build a repo whose t1 adds a binary blob and t2 modifies the same path — `add/add` non-text parks). Also add to `tests/test_fold_wave_materialize.py`:

```python
def test_materialize_refuses_incomplete_fold(tmp_path):
    # fold stops at the first conflict; materialize before resolve must not build a candidate
    repo, base_sha, heads = make_repo(tmp_path)
    t3 = add_third_branch(repo, base_sha)
    run_dir = tmp_path / "run"
    do_fold(repo, run_dir, 1, base_sha, [("t1","t1",heads["t1"]),("t2","t2",heads["t2"]),("t3",t3[0],t3[1])])
    r = run_cli("materialize", "--repo", str(repo), "--run-dir", str(run_dir), "--wave", "1",
                "--prev-head", base_sha, "--task-head", "t1=%s" % heads["t1"],
                "--task-head", "t2=%s" % heads["t2"], "--task-head", "t3=%s" % t3[1])
    assert r.returncode == 3
    assert last_json(r)["fallback"].startswith("incomplete fold:")
```

- [ ] **Step 2: Run to verify they fail** — `python3 -m pytest tests/test_fold_wave.py tests/test_fold_wave_materialize.py -q` (new tests fail: no `--conflict`, no `remaining`, etc.).
- [ ] **Step 3: Implement in `fold_wave.py`.** Structure:

```python
import hunks  # beside the kernel

def _read_log(log_path):  # [] when absent
def _fold_prefix_check(recorded, branches, base_sha):
    """(ok, remaining_triples). recorded fold events must be an (id, headSha)
    prefix of branches; base must match. ok=False -> exit 2 disagreement."""
def _narrate(wave_dir, index, conflict, epoch):
    """write conflict-<i>.txt + conflict-<i>.hunks.txt (hunks.derive; a HunkError
    parks the entry with reason MARKER_SHAPED), append index entry with
    hunksFile/hunkCount, return the entry"""
def _fold_until_stop(eng, states, remaining, log_path, wave_dir, index, stats):
    """fold in order; after each fold append the fold event + stats maxLines;
    if the fold opened >=1 lines/add-add conflict -> narrate them all, return
    (open_entries, remaining_after). Else continue; when empty -> ([], [])."""
def _current_stop(index, recorded):
    """entries at max narrated epoch; waiting = those whose path has no resolve
    event at-or-after that epoch"""
def _complete_reply(eng, base, folded, repo, log_path, manifest):
    """run self-checks; return (payload_fields, exit_code)"""

def cmd_fold(args):
    # exit 2 if log exists (kept)
    # snapshot + publish all (as today)
    # PRE-SCAN: eng0 = FrontierEngine(base); fold all in memory; collect parks
    #   (dispatchable False entries incl. kernel-limit); if any -> write index +
    #   conflict-<i>.txt reasons, no log, print {clean:False, conflicts:len,
    #   dispatchable:0, parked:len, open:[], remaining:[all ids], complete:False}; exit 0
    # INCREMENTAL: write base event; _fold_until_stop; if stop -> print stop reply
    #   (conflicts == dispatchable == len(open)); else complete reply with selfChecks

def cmd_resolve(args):
    # log missing -> exit 2; prefix check -> exit 2 disagreement
    # entry = index[i]; reply = hunks.read_reply_dir (HunkError -> print rejected, exit 4)
    # rehydrate; lines = hunks.splice(conflict-<i>.txt, replies, blocks)  (blocks re-derived)
    # if not eng.apply_resolution(entry.path, entry.epoch, lines): print stale, exit 2
    # append resolve event; stop = _current_stop(...); if waiting: print {applied, waiting}; exit 0
    # else continue folding (_fold_until_stop with the remaining triples' published states)
    #   -> new stop reply (with conflicts/dispatchable) or complete reply (+selfChecks, exit 0/3)

def cmd_materialize(args):
    # NEW first check: every --task-head (id, sha) has a fold event AND _unresolved_paths empty
    #   else _fallback("incomplete fold: %d task(s) unfolded / %d path(s) unresolved")
```

Keep `_recursion_headroom` for now (Task 4 replaces it). Delete `_renarration_dispatchable`. Update the module docstring. Write `fold_stats.json` as `{"maxLines": [...]}` (append per fold call; a clean wave writes it too).

- [ ] **Step 4: Update `kernel/FOLD_LOG.md`** — the resolve prose: "`apply_resolution` refuses a stale epoch → the CLI exits 2 and the engine falls the wave back; there is no re-narration; folding is incremental — a `resolve` that completes the current stop continues folding and may append further `fold` events" — and note `fold_stats.json` beside the log (not in it).
- [ ] **Step 5: Run** `python3 -m pytest tests/test_fold_wave.py tests/test_fold_wave_materialize.py tests/test_frontier_fold.py tests/test_frontier_cell.py -q` → all pass (existing tests that asserted the old `resolve --path/--epoch/--reply-file` shape are rewritten to the new CLI in this task; the stale-renarration test is deleted, not skipped).
- [ ] **Step 6: Commit.** `git add skills/ultrapowers/kernel/fold_wave.py skills/ultrapowers/kernel/FOLD_LOG.md tests/test_fold_wave.py tests/test_fold_wave_materialize.py && git commit -m "kernel: incremental fold protocol — stop/resolve/continue, --conflict, stale refusal, materialize completeness, fold_stats (spec §1b)"`

---

### Task 4: Retire the cap; run kernel work on a 1 GiB-stack thread

**Type:** implementation
**Depends-on:** 3
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/kernel/frontier_fold.py`
- Modify: `skills/ultrapowers/kernel/fold_wave.py`
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_fold_wave.py`
- Test: `tests/test_frontier_fold.py`
- Test: `tests/test_compile_plan.py`

**Interfaces:**
- Consumes: the Task-3 `cmd_fold/cmd_resolve/cmd_materialize` bodies (this task wraps them).
- Produces: `fold_wave.run_on_kernel_thread(fn, *a, **kw)` (runs `fn` on a thread with `threading.stack_size(STACK_BYTES)`, `STACK_BYTES = 1 << 30`, recursion limit `THREAD_RECURSION_LIMIT = 1_000_000` set inside the thread; `ValueError` from `stack_size` or `RuntimeError` from `Thread.start()` → run in the main thread + one stderr line; result and exception marshalled back so exit codes are unchanged); `frontier_fold.dispatchable(conflict, manifest)` without the size term; `RESOLVER_LINE_CAP` deleted everywhere; `compile_plan._PathEligibility` without the line-count branch.

- [ ] **Step 1: Tests first.** In `tests/test_fold_wave.py` delete `test_recursion_bound_is_sized_from_the_corpus_not_a_flat_ceiling` and `test_fold_parks_a_named_kernel_limit_when_the_bound_is_insufficient` (their premise — a sized bound — retires); keep `test_fold_of_a_10k_line_single_writer_file_stays_inside_the_exit_contract` and add:

```python
def test_fold_of_a_100k_line_pair_never_segfaults(tmp_path):
    """Spec §1d pin: 100k-line two-writer fold succeeds on the running interpreter
    (on 3.9 the big-stack thread is what makes it true) — never exit 139."""
    repo, base_sha, heads = make_single_writer_repo(tmp_path, 100_000, name="huge")
    # make_single_writer_repo builds one branch; add a second writer editing the other end:
    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    p = repo / "huge.py"; lines = p.read_text().split("\n"); lines[5] = "# t2 edit"
    p.write_text("\n".join(lines)); _git(repo, "add", "-A"); _git(repo, "commit", "-qm", "t2")
    t2 = _git(repo, "rev-parse", "HEAD"); _git(repo, "checkout", "-q", base_sha)
    r = do_fold(repo, tmp_path / "run", 1, base_sha,
                [("t1", "t1", heads["t1"]), ("t2", "t2", t2)])
    assert r.returncode in (0, 3), (r.returncode, r.stderr[-500:])   # never 139/-11
    assert r.returncode == 0, r.stderr[-500:]
```

In `tests/test_frontier_fold.py`, replace any test asserting the "> 400 visible lines" park with one asserting a 5,000-line text conflict is `dispatchable`. In `tests/test_compile_plan.py`, replace the `over RESOLVER_LINE_CAP` pre-filter test with one asserting a 5,000-line existing text file does **not** keep the write-after-write edge under `--overlap fold --repo-root` (symlink and null-byte tests stay).

- [ ] **Step 2: Run to verify they fail** (100k on 3.9 → exit 139; dispatchable test → parked; compile test → edge kept).
- [ ] **Step 3: Implement.**
  - `frontier_fold.py`: delete `RESOLVER_LINE_CAP` and the size branch of `dispatchable`; fix the module docstring ("<= 400 visible lines" → "annotated narration present and text manifest content"); `_kernel_limit_entry` wording: "kernel recursion limit exceeded folding task %s; largest text path %s (%d lines)" (no bound).
  - `compile_plan.py`: remove `from frontier_fold import RESOLVER_LINE_CAP`; in `_PathEligibility.__missing__` drop the line-count branch (symlink + null-byte remain); update the docstring and the `--overlap` help text; delete the `_git_max_lines`/`_state_max_lines` sizing helpers in `fold_wave.py` if nothing else uses them (`_state_max_lines` still feeds `fold_stats.json maxLines` — keep it for that).
  - `fold_wave.py`: add
    ```python
    import threading
    STACK_BYTES = 1 << 30
    THREAD_RECURSION_LIMIT = 1_000_000

    def run_on_kernel_thread(fn, *args, **kwargs):
        box = {}
        def target():
            sys.setrecursionlimit(THREAD_RECURSION_LIMIT)
            try:
                box["result"] = fn(*args, **kwargs)
            except BaseException as e:      # marshal everything back, incl. SystemExit
                box["exc"] = e
        try:
            threading.stack_size(STACK_BYTES)
            t = threading.Thread(target=target, name="fold-kernel")
            t.start(); t.join()
        except (ValueError, RuntimeError) as e:
            print("fold_wave: big-stack thread unavailable (%s); running in main thread" % e,
                  file=sys.stderr)
            return fn(*args, **kwargs)
        if "exc" in box:
            raise box["exc"]
        return box["result"]
    ```
    and in `main()`: `return run_on_kernel_thread(args.func, args)`. Replace every `with _recursion_headroom(...)` block with a plain body (the thread's limit is fixed); delete `_recursion_headroom`, `RECURSION_LINE_FACTOR`, `RECURSION_MARGIN`; keep the `except RecursionError` → kernel-limit park lanes exactly as they are (they remain the only ceiling).
- [ ] **Step 4: Run** `python3 -m pytest tests/test_fold_wave.py tests/test_frontier_fold.py tests/test_compile_plan.py tests/test_fold_wave_materialize.py -q` → green on 3.9 locally; also run the 100k test under `python3.11` if available (`/Users/marcusestes/.local/bin/python3.11 -m pytest tests/test_fold_wave.py -k 100k -q`).
- [ ] **Step 5: Commit.** `git commit -am "kernel: retire RESOLVER_LINE_CAP; fold on a 1 GiB-stack thread with a fixed recursion limit (spec §1d)"`

---

### Task 5: Engine — work-list resolver loop, `REJECTED`, hunk briefs, re-baked STEP/RESOLVER prompts, report fields, sim scenarios

**Type:** implementation
**Depends-on:** 2, 3
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `tests/frontier_merge.mjs`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: the CLI protocol from Task 3 (stdout shapes, exit codes, `--conflict`, `--reply-dir`, `remaining`, `complete`, `waiting`, `hunksFile`); the reply-dir grammar from Task 2.
- Produces: `FOLD_SCHEMA.status` enum `['FOLDED','CONFLICTS','PARKED','ERROR','REJECTED']`; `FOLD_SCHEMA` fields `remaining: string[]`, `complete: boolean`, `waiting: integer[]`, `open[].i`, `open[].hunksFile`, `open[].hunkCount` (`narrationFile` dropped); `resolverTranscripts[]` entries `{conflict: <i>, attempt, path, epoch, hunksFile, replyDir, status, notes}`; `frontierEntry.foldCliCalls`; the re-baked `CONTENDED_MERGE_PROMPT` STEP fold/resolve text and `RESOLVER_PROMPT`.

**STEP mapping (spec §1b, verbatim contract):** `parked > 0` on the fold reply ⇒ PARKED (order-first, as today); `open` non-empty ⇒ CONFLICTS with `conflicts == dispatchable == open.length`; `applied + waiting` ⇒ CONFLICTS with `open: []` and `waiting` equal to the engine's outstanding set; `complete` ⇒ FOLDED with `selfChecks`; exit 4 ⇒ REJECTED; other non-zero ⇒ ERROR. The `selfChecks` guard applies to the completing reply only; the missing-count guard to open-bearing replies; the empty-`open` guard is re-scoped to require `waiting`.

- [ ] **Step 1: Sim first — edit `tests/frontier_merge.mjs`** (each scenario must fail if its guard is inverted; keep the `ALL SCENARIOS PASSED` sentinel):
  - scenario 3 `stale-renarration` → rewrite as `stale-fallback`: apply reply `{status:'ERROR', detail:'stale'}` (exit 2 mapping) ⇒ wave falls back, no second resolver dispatch.
  - 9m `resolution-not-applied` → invert: a `REJECTED` apply reply ⇒ exactly one more resolver dispatch (reply dir `reply-<i>-2/`), then a second `REJECTED` ⇒ fallback; an `ERROR` apply reply ⇒ immediate fallback.
  - 9f: keep fold-only; add `9p waiting-shape-legal`: an apply reply `{status:'CONFLICTS', open:[], waiting:[2]}` when the engine's outstanding set is `[2]` ⇒ loop continues (no fallback); `waiting:[]`/mismatch ⇒ fallback.
  - 9d/9o: keep on the completing reply; add `9q stop-reply-no-selfchecks-not-checked`: a fold reply `{status:'CONFLICTS', conflicts:1, dispatchable:1, open:[...], remaining:['t3'], complete:false}` with **no** `selfChecks` ⇒ no fallback.
  - new `10a work-list-to-complete`: fold stops with 1 open + remaining `['t3']`; resolve reply `{status:'CONFLICTS', conflicts:1, dispatchable:1, open:[{i:2,...}], remaining:[], complete:false}` ⇒ second resolver dispatch; then `{status:'FOLDED', complete:true, selfChecks:'ok', open:[], remaining:[]}` ⇒ adopt. Assert 2 resolver dispatches, `foldCliCalls === 4` (fold, resolve, resolve, materialize).
  - new `10b parked-pre-scan`: fold reply `{status:'PARKED', parked:1, conflicts:1, dispatchable:0, open:[], remaining:[...]}` ⇒ fallback with the park reason.
  - new `10c budget-exhausted-mid-work-list` (mirror of scenario 5 across the continued-fold leg).
  - 9n `conflicts-counts-omitted` on a continued-fold reply: `{status:'CONFLICTS', open:[...]}` with no `conflicts` ⇒ fallback (extend the existing scenario with a resolve-leg case).
- [ ] **Step 2: Run** `node tests/frontier_merge.mjs` → the new/rewritten scenarios fail (engine still has the old loop).
- [ ] **Step 3: Implement in `waves.js`** (`contendedMerge`):
  - `FOLD_SCHEMA`: add `'REJECTED'` to the enum; add `remaining`, `complete`, `waiting`; `open` items `required: ['i','path','epoch','hunksFile']` + `hunkCount`.
  - Fold-reply guards: keep null/ERROR/PARKED/parked-count/missing-count/open-count guards; move the `selfChecks` guard behind `if (fold.complete === true || fold.status === 'FOLDED')`.
  - Replace the `for (open) { for (attempt ≤ 2) }` loop with a **work-list**: `let outstanding = open.slice()` (by `i`); `let calls = 1` (the fold); while `outstanding.length`: take `entry = outstanding[0]`; for `attempt` 1..2: budget checkpoint; `replyDir = fillPaths(frontierDir(waveNumber) + '/reply-' + entry.i + '-' + attempt)`; dispatch the resolver with `'\nHUNKS: ' + entry.path + ' — read ' + entry.hunksFile + '\nREPLY DIR: write one file per hunk (h1.txt, h2.txt, …) plus notes.txt into ' + replyDir` (+ on attempt 2: `'\nPREVIOUS REPLY REJECTED: ' + reason`); record the transcript entry (`conflict: entry.i, hunksFile, replyDir`); `RESOLVED` required else fallback; `applied = await dispatchMerge('resolve', KERNEL_CLI + ' resolve --repo . --run-dir <runDir> --wave ' + waveNumber + ' --conflict ' + entry.i + ' --reply-dir ' + replyDir + branchArgs, …)`; `calls++`; map: `REJECTED` → `if (attempt === 1) continue; else fallback`; `ERROR` → fallback; `CONFLICTS` with `waiting` → verify `waiting` equals the outstanding ids minus `entry.i` (count authority) then `outstanding.shift(); break`; `CONFLICTS` with `open` → require `typeof applied.conflicts === 'number' && applied.dispatchable === applied.open.length` then `outstanding = applied.open.slice(); break`; `FOLDED` with `complete === true` → require `applied.selfChecks === 'ok'`, `outstanding = []; break`; anything else → fallback.
  - `frontierEntry`: `foldCliCalls: calls + 1` (materialize), `foldCliWallTimeSec` = sum of the wall times each STEP reply reports (`fold.foldCliWallTimeSec + Σ applied.foldCliWallTimeSec + adopt.foldCliWallTimeSec`), `selfChecks` from the completing reply.
- [ ] **Step 4: Prompts — edit `references/wave-merge.md`, then re-bake into `waves.js`** per `references/workflow-template.md`:
  - STEP fold: replace the `open` sentence: "…for each entry whose dispatchable is true add an open entry carrying that entry's i, path, epoch, its hunksFile (the conflict-<i>.hunks.txt path from the entry) and hunkCount. Copy remaining and complete from the JSON; copy selfChecks only when the JSON carries it (a stop reply does not)."
  - STEP resolve (full replacement): "Run the resolve invocation. Report FOLDED when it prints complete true — copy selfChecks. Report CONFLICTS when it prints applied true with an open list — copy conflicts, dispatchable, remaining and complete and add one open entry per listed entry exactly as in STEP fold — or with a waiting list — report open as empty and copy waiting. Report REJECTED when the exit code is 4 — copy reason into detail. Report ERROR on any other non-zero exit, including stale true. Time the invocation and report its wall clock in foldCliWallTimeSec."
  - STEP adopt: add "Time the invocation and report its wall clock in foldCliWallTimeSec."
  - `RESOLVER_PROMPT` (full rewrite, keep the GUARD sentence): "You are a merge-conflict resolver for one file in one wave. You have no repo to explore: read exactly the hunks file named below and write exactly the reply directory named below — one file per HUNK (h1.txt, h2.txt, …) plus notes.txt — and touch nothing else. Never run git, never edit the file under conflict, never create a commit; the hunks file and the reply directory are your only sanctioned locations. Each HUNK shows a conflict block with read-only context above and below it: frontier is the work already folded in, a task id is the incoming change, both is content shared by both sides — carry every both line. For each HUNK write the lines that should replace the whole conflict block, top to bottom, with no conflict markers: a file of newline-terminated lines, an empty file meaning the block resolves to nothing. Never write context lines. Honor both sides' intent where they are compatible; where they are not, prefer the semantics the contending task bodies describe over surface text; never drop a side silently — if the two sides are irreconcilable, still write your best merge for that hunk and say so in notes.txt; nothing invented that appears in neither side nor the narration. When a HUNK header carries a contract line, obey it. Report RESOLVED once every hunk file is written, or BLOCKED with the reason if you could not read the hunks file or could not write the reply directory."
  - `report-format.md`: `resolverTranscripts[]` fields → `conflict, attempt, path, epoch, hunksFile, replyDir, status, notes`; `frontierEntry` gains `foldCliCalls`; `selfChecks` "sourced from the completing CLI reply".
- [ ] **Step 5: Run** `node tests/frontier_merge.mjs` (sentinel), `node tests/sim_workflow.mjs` (sentinel), `python3 -m pytest tests/test_no_prompt_drift.py -q`. Mutation-verify each new guard (invert, watch the scenario fail, restore).
- [ ] **Step 6: Commit.** `git commit -am "engine: work-list resolver loop, REJECTED retry, hunk briefs, re-baked STEP/RESOLVER prompts, sim scenarios (spec §1b/§1c)"`

---

### Task 6: `contend-big` fixture

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/fixtures/contend-big/`
- Modify: `tests/test_fixture_seals.py`

**Interfaces:**
- Consumes: `evals/fixtures/contend-prod/` (frozen at `486f02a`; seal id `4d131df61152`).
- Produces: `evals/fixtures/contend-big/` — same plan, same tasks, same acceptance dir byte-identical, `app/registry.py` ≈ 6,000 lines with the registration hub, its config block and wiring section unchanged and in the same relative positions.

- [ ] **Step 1: Copy.** `git show 486f02a --stat | head -1` to confirm the frozen sha; `cp -R evals/fixtures/contend-prod evals/fixtures/contend-big`.
- [ ] **Step 2: Inflate `registry.py`.** Read it (147 lines) and note the three edit sites the four tasks touch (module docstring, the config block "near its existing keys", the wiring section "at the bottom"). Insert ≈5,800 lines of realistic surrounding module **between** those sites, never inside them: for example three sections of `_helpers_*` functions with docstrings and typed signatures, a `_LEGACY_SETTINGS` dict of ~800 entries, and a `_compat` shim class block — plain Python that imports nothing new and is never referenced by tests. Keep the file's docstring at the top, the config block after it, and the wiring section as the last thing in the file. `wc -l` must be 5,500–6,500. `python3 -c "import ast,sys; ast.parse(open('evals/fixtures/contend-big/project/app/registry.py').read())"` passes.
- [ ] **Step 3: Pin.** Add `"contend-big"` to `tests/test_fixture_seals.py::FIXTURES`; run `python3 -m pytest tests/test_fixture_seals.py -q` (the seal dir is byte-identical → same id `4d131df61152`); run the fixture's own suite on its base (`cd evals/fixtures/contend-big/project && python3 -m pytest -q`) — green; the sealed exam is red on base by construction (do not run it here).
- [ ] **Step 4: Compile the fixture plan** — `python3 skills/ultrapowers/scripts/compile_plan.py evals/fixtures/contend-big/plan.md --overlap fold --repo-root evals/fixtures/contend-big/project` — once the kernel's cap term is retired elsewhere in this plan, the pair keeps no write-after-write edge; while the cap term still exists it serializes the pair, which is expected and not this task's concern.
- [ ] **Step 5: Commit.** `git add evals/fixtures/contend-big tests/test_fixture_seals.py && git commit -m "evals: contend-big fixture — contend-prod with a ~6k-line registry.py (spec §1e)"`

---

### Task 7: Sensor baseline — `wallSec`, `fold_stats` maxLines, launch DAG, planning word/turn counts

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/audit_run.py`
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Modify: `skills/ultralearn/references/reading-lenses.md`
- Test: `tests/test_audit_run.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: the file names/shapes spec §1f fixes — `frontier/wave-<n>/fold_stats.json` = `{"maxLines": [int, ...]}`; `<runDir>/launch.json` (`waves`, `edges`).
- Produces: `audit_run.collect(path) -> (model, turns, out_tokens, wall_sec)` (`wall_sec` = last − first record `timestamp`, 0 when absent); each `agents[]` entry gains `wallSec`; `audit()` totals gain `wallSecByTask: {<task id>: summed wallSec across impl transcripts}`; bundle gains `frontier: {maxLinesByWave: {"1": [..], ...}}`, `launch: {waves, edges}` (from the registered runDir's `launch.json`, disk-sourced like receipts), `planning: {planWords, planningTurns}` when `planningFound`.

- [ ] **Step 1: Tests.** `tests/test_audit_run.py`: write two agent files with ISO `timestamp`s 90s apart, `impl:7` role → `wallSecByTask == {"7": 90.0}` (two transcripts for one id sum). `tests/test_harvest_runs.py`: a run dir with `frontier/wave-1/fold_stats.json` `{"maxLines":[147, 6012]}` and `launch.json` `{"waves":[["1","2"]],"edges":[]}` → bundle carries them; `planningFound` session → `planning.planWords` equals the plan file's word count and `planningTurns` the count of `user` text records before the launch.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**: `collect` reads each record's `timestamp` (ISO 8601 with `Z`; `datetime.fromisoformat(ts.replace("Z","+00:00"))`), keeps first/last; `audit()` sums per `impl:<id>`. Harvester: in `build_bundle`, for the last registered runDir read `frontier/wave-*/fold_stats.json` (soft), `launch.json` (soft), and compute planning counts when `planning_found`. Add the three fields to the fold-canary lens in `reading-lenses.md` (one bullet each: what to read, what a rising `maxLines` means, what `wallSecByTask` feeds — Phase 3's measured leg).
- [ ] **Step 4: Run** `python3 -m pytest tests/test_audit_run.py tests/test_harvest_runs.py -q` → green.
- [ ] **Step 5: Commit.** `git commit -am "sensor: wallSec per task, fold_stats maxLines, launch DAG, planning word/turn counts in the bundle (spec §1f)"`

---

### Task 8: Full-suite verification

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7

- [ ] `python3 -m pytest -q` — all green (on 3.9 locally; CI on 3.11 must be green too).
- [ ] `node tests/frontier_merge.mjs && node tests/sim_workflow.mjs` — both print `ALL SCENARIOS PASSED`.
- [ ] `python3 -m pytest tests/test_no_prompt_drift.py tests/test_fixture_seals.py tests/test_all_plans_compile.py -q` — green.
- [ ] `git diff --stat main...HEAD -- skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/run_lock.sh skills/ultrapowers/scripts/collect_seal.py skills/ultrapowers/scripts/seal_hash.py skills/ultrapowers/scripts/run_acceptance.sh` — empty.
- [ ] `grep -rn "RESOLVER_LINE_CAP\|_renarration_dispatchable\|_recursion_headroom" skills/ tests/ evals/` — no hits outside `evals/frontier/results/` history docs.

---

### Task 9: PR

**Type:** release
**Depends-on:** 8

- [ ] Push the branch, open the PR (`gh pr create`) with the spec link, the T15 token-share number (Task 1), and the sim/suite results; merge to `main` after CI is green. Do **not** bump the version yet — the release waits on Task 11.

---

### Task 10: T15-rig cells, floors, resolver grading, shakedown (operator-attended)

**Type:** manual
**Depends-on:** 9

Per spec §1e. Run from a fresh session on the merged `main`, from the repo root, one cell at a time (serialize runs):

- [ ] **Floors (counted condition):** `python3 evals/ab_runner.py --engine-ref <main sha> --engine-label A-verify --fixture contend-big --arm-overlap serialize`; each implementer ≥ its T14 floor (5.9/6.8/5.2/5.1 min) — else re-shape the fixture (Task 6) before any counted cell. This run is **not** the counted arm A.
- [ ] **Counted arm A:** `--engine-ref <0.2.14 sha bccbbc3> --engine-label A --fixture contend-big --arm-overlap serialize`.
- [ ] **Counted arm B:** `--engine-ref <main sha> --engine-label B --fixture contend-big --arm-overlap fold`.
- [ ] **Mechanics cell:** `--engine-ref <main sha> --engine-label B --fixture contend-prod --arm-overlap fold` (hard gates + resolver grading; E2 read directionally against T15's 1.111).
- [ ] **Hard gates (all cells, verbatim T15):** arm identity, both gates green with the sealed exam green on both integrated trees, `selfChecks: ok`, zero fallbacks on the contended wave, every park named, zero silent divergence. **E1″ wall ≤ 0.6× and E2″ tokens ≤ 1.1× on `contend-big`.**
- [ ] **Resolver grading:** read every `reply-<i>-<m>/` + `notes.txt` against its hunks file — both sides' intent kept, nothing invented, notes used for anything irreconcilable. Record verdicts + numbers in `evals/frontier/results/<run-date>-phase1-gate.md`.
- [ ] **Shakedown:** the next real plan carrying a natural big-file pair runs `/ultrapowers`; read its `frontier/` records (`fold_stats.json` maxLines, hunk counts, `foldCliCalls`, resolver wall) before release.

---

### Task 11: Release 0.3.0

**Type:** release
**Depends-on:** 10

- [ ] On `main`: set `"version": "0.3.0"` in **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`; commit `chore(release): 0.3.0 — fold-native Phase 1: hunk-scoped resolver briefs, incremental fold, cap retired (spec 2026-08-18)`; push; confirm `gh run list --branch main --limit 1` is green.
