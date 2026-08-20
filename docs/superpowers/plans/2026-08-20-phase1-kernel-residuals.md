# Phase-1 Kernel Residuals Implementation Plan (#163 + #162 + #164)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three residual-manifest issues from the Phase-1 fold-native run: reply-grammar strictness in the hunks layer (#163), deterministic pins on the silent `RecursionError` park lanes (#162), and the `stack_size` process-global leak plus retired wording (#164).

**Architecture:** Three independent small changes to the fold-native kernel and its eval kit. No frozen surface is touched; no harness JS (no `.mjs` sims, no prompt re-bake). The hunks change adds rejections (fails closed); the fold_wave changes are tests-only plus one save/restore fix; the run_eval change is text-only.

**Tech Stack:** Python 3, pytest. Kernel modules under `skills/ultrapowers/kernel/`.

**Spec:** The issue texts are the spec (per the #124/#152 precedent — fully-mapped smalls, every claim verified live at triage 2026-08-20): GitHub issues #163, #162, #164, mirrored in the docket entries in `docs/superpowers/docket.md`.

**Acceptance:** suite — three verified-at-triage kernel smalls; the committed pytest suite (extended by every task below) is the verification, no held-out exam.

## Global Constraints

- The verification periphery is FROZEN: never touch `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `run_acceptance.sh`, `collect_seal.py`, `seal_hash.py`. No task in this plan has any reason to open them.
- No Anthropic API calls or SDK anywhere; no new dependencies.
- Tests must be concurrency-safe: derive every path from pytest's `tmp_path`, no shared on-disk fixtures, no ports.
- The full gate is `python3 -m pytest` (pytest.ini scopes to `tests/`); every task leaves it green.
- Marker vocabulary ground truth (from `skills/ultrapowers/kernel/vendor/manyana.py` `conflict_strings`): kinds are `added`/`deleted`, sides are `left`/`right`/`both`.

---

### Task 1: hunks.py reply-grammar strictness (#163)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/kernel/hunks.py`
- Test: `tests/test_hunks.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing sibling tasks rely on. `HunkError(reason)` shapes are unchanged; two new rejection cases only: `"<hid>: reply not valid UTF-8"` from `read_reply_dir`, and the existing `MARKER_SHAPED` constant (`"marker-shaped content"`) now also raised for an in-block marker line with an unknown kind/side head.

The two defects (both transcribed verbatim from the Phase-1 plan; task-2's adversarial reviewers routed them to the gate — issue #163):

1. `read_reply_dir` decodes reply files with `errors="replace"`, silently rewriting invalid UTF-8 to U+FFFD — the one silent path in a function whose whole purpose is byte fidelity. Every sibling malformed-reply case raises `HunkError`.
2. `_blocks` parks a marker-form line only when it is a nested `<<<<<<< begin `, an unterminated block, or a stray SEP/END at top level. Inside a block, a `======= begin `-prefixed content line is silently treated as a segment head; downstream, `strip_markers` keeps content only when the parsed kind equals `added`, so an unknown head like `======= begin frobnicate zone` silently drops the lines after it.

Fix shape: strict decode with a named rejection; validate every marker head (both `<<<<<<< begin ` at block open and `======= begin ` inside a block) against the annotator's actual vocabulary — kinds `{added, deleted}`, sides `{left, right, both}` — and park anything else as `MARKER_SHAPED`. A content line byte-equal to a *valid* marker form is genuinely undelimitable; the existing top-level defense already parks stray SEP/END there, and a content line equal to the END marker inside a block terminates the block early so the real END line then parks at top level — pin that behavior with a test rather than changing it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_hunks.py` (match its existing import style — it imports the kernel module as `hunks`; reuse its existing narration-building helpers if present, otherwise the literal narrations below are self-contained):

```python
def test_reply_with_invalid_utf8_is_rejected_not_replaced(tmp_path):
    annotated = "\n".join([
        "ctx",
        "<<<<<<< begin added left",
        "L",
        "======= begin added right",
        "R",
        ">>>>>>> end conflict",
        "tail",
    ])
    _text, blocks = hunks.derive(annotated)
    (tmp_path / "h1.txt").write_bytes(b"caf\xe9\n")
    with pytest.raises(hunks.HunkError) as exc:
        hunks.read_reply_dir(tmp_path, blocks)
    assert "not valid UTF-8" in exc.value.reason
    assert "h1" in exc.value.reason


def test_in_block_marker_with_unknown_head_parks_as_marker_shaped():
    annotated = "\n".join([
        "<<<<<<< begin added left",
        "L",
        "======= begin frobnicate zone",
        "R",
        ">>>>>>> end conflict",
    ])
    with pytest.raises(hunks.HunkError) as exc:
        hunks.derive(annotated)
    assert exc.value.reason == hunks.MARKER_SHAPED


def test_begin_marker_with_unknown_head_parks_as_marker_shaped():
    annotated = "\n".join([
        "<<<<<<< begin exploded sideways",
        "L",
        ">>>>>>> end conflict",
    ])
    with pytest.raises(hunks.HunkError) as exc:
        hunks.derive(annotated)
    assert exc.value.reason == hunks.MARKER_SHAPED


def test_content_line_equal_to_end_marker_inside_a_block_still_parks():
    # The in-block END-equal line terminates the block early; the real END
    # then sits at top level, where the existing defense parks it. Pinned
    # here so the indirect defense cannot be lost in a refactor.
    annotated = "\n".join([
        "<<<<<<< begin added left",
        ">>>>>>> end conflict",   # content byte-equal to the END marker
        "more",
        ">>>>>>> end conflict",
    ])
    with pytest.raises(hunks.HunkError) as exc:
        hunks.derive(annotated)
    assert exc.value.reason == hunks.MARKER_SHAPED


def test_two_block_narration_round_trips_through_splice():
    # Genuine two-block coverage for splice's pos-advance loop: l0..l9 with
    # l3 and l6 diverging. (#162's rider: the existing "# two blocks"
    # comment sits on a case the kernel annotates as ZERO blocks.)
    annotated = "\n".join([
        "l0", "l1", "l2",
        "<<<<<<< begin added left",
        "L3",
        "======= begin added right",
        "R3",
        ">>>>>>> end conflict",
        "l4", "l5",
        "<<<<<<< begin added left",
        "L6",
        "======= begin added right",
        "R6",
        ">>>>>>> end conflict",
        "l7", "l8", "l9",
    ])
    _text, blocks = hunks.derive(annotated)
    assert [b["id"] for b in blocks] == ["h1", "h2"]
    out = hunks.splice(annotated, {"h1": ["L3"], "h2": ["R6"]}, blocks)
    assert out == ["l0", "l1", "l2", "L3", "l4", "l5", "R6", "l7", "l8", "l9"]
```

If `tests/test_hunks.py` contains a case commented `# two blocks` over an `a/b/c/d` vs `a/B/c/d` vs `a/b/c/D` shape, leave that case in place (it pins the zero-block annotation) but fix its comment to say what it actually produces.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_hunks.py -v -k "invalid_utf8 or unknown_head or end_marker_inside or two_block"`
Expected: `test_reply_with_invalid_utf8_is_rejected_not_replaced`, `test_in_block_marker_with_unknown_head_parks_as_marker_shaped`, and `test_begin_marker_with_unknown_head_parks_as_marker_shaped` FAIL (no exception raised / wrong content survives). `test_content_line_equal_to_end_marker_inside_a_block_still_parks` and `test_two_block_narration_round_trips_through_splice` may already PASS — they are pins.

- [ ] **Step 3: Implement the strictness in `skills/ultrapowers/kernel/hunks.py`**

Add the vocabulary beside the existing marker constants (module top, after `_BEGIN, _SEP, _END`):

```python
_KINDS, _SIDES = {"added", "deleted"}, {"left", "right", "both"}


def _valid_head(ln):
    kind, side = _seg_head(ln)
    return kind in _KINDS and side in _SIDES
```

In `_blocks`, validate heads in both positions — the block opener and the in-block scan:

```python
def _blocks(lines):
    """[(start, end)] inclusive indices of every marker block; raises on a
    content line byte-equal to a marker form (undelimitable) and on any
    marker head outside the annotator vocabulary (silently restructures
    segments otherwise)."""
    out, i, n = [], 0, len(lines)
    while i < n:
        ln = lines[i]
        if ln.startswith(_BEGIN):
            if not _valid_head(ln):
                raise HunkError(MARKER_SHAPED)
            j = i + 1
            while j < n and lines[j] != _END:
                if lines[j].startswith(_BEGIN):
                    raise HunkError(MARKER_SHAPED)
                if lines[j].startswith(_SEP) and not _valid_head(lines[j]):
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
```

In `read_reply_dir`, replace the lenient decode (currently `data = f.read_bytes().decode("utf-8", errors="replace")`):

```python
        try:
            data = f.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            raise HunkError("%s: reply not valid UTF-8" % hid)
```

- [ ] **Step 4: Run the task tests, then the whole suite**

Run: `python3 -m pytest tests/test_hunks.py -v` — all PASS.
Run: `python3 -m pytest` — all PASS (in particular `tests/test_fold_wave.py`'s marker-shaped and resolve tests must not regress: `derive()` is called by `fold_wave.cmd_resolve` on real narrations, whose heads are all in-vocabulary by construction).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/kernel/hunks.py tests/test_hunks.py
git commit -m "fix(kernel): reject invalid-UTF-8 replies and unknown marker heads in hunks (#163)"
```

---

### Task 2: Deterministic pins on the silent RecursionError park lanes (#162)

**Type:** implementation
**Depends-on:** none

**Files:**
- Test: `tests/test_fold_wave.py`

**Interfaces:**
- Consumes: existing helpers in `tests/test_fold_wave.py` — `make_repo(tmp_path)` (contended two-writer fixture), `add_third_branch(repo, base_sha)`, `make_single_writer_repo(tmp_path, n_lines, name="huge")`, `_reply_dir(tmp_path, name, **hunk_files)`, `last_json(result)`; the in-process pattern of `test_fold_parks_a_named_kernel_limit_when_the_thread_limit_is_insufficient` (`fw.main(argv)` + `monkeypatch` + `capsys`).
- Produces: nothing sibling tasks rely on (tests only; zero source changes).

Four lanes stayed silent when neutered to a bare re-raise across 178 targeted tests (the gate critic's mutation sweep, issue #162). Each test below pins one lane through the CLI contract, in-process so monkeypatches reach the CLI's own process. Each carries a mutation-verification step: temporarily neuter the lane, watch the test fail, restore. Where a lane cannot be reached deterministically end-to-end (the pre-scan is a superset of the incremental pass, so it always parks first), the test bypasses the earlier stage with a targeted monkeypatch — that seam is stated in the test's docstring.

- [ ] **Step 1: Write the mid-fold park test (pins `_fold_until_stop`'s `except RecursionError` and `cmd_fold`'s kernel-park branch)**

```python
def test_midfold_kernel_park_stays_inside_the_exit_contract(
        tmp_path, monkeypatch, capsys):
    """The continued-fold lane: `_fold_until_stop` catches a mid-work-list
    RecursionError and `cmd_fold` writes the named park. Reached by
    bypassing `_pre_scan` (a deliberate seam: the pre-scan park set is a
    superset, so end-to-end it always fires first and this lane stays
    silent — exactly how the mutation sweep found it)."""
    n = 3000
    repo, base_sha, t1_sha, _ = make_single_writer_repo(tmp_path, n)
    run_dir = tmp_path / "run"
    monkeypatch.setattr(fw, "_pre_scan", lambda *_a, **_k: ([], None))
    monkeypatch.setattr(fw, "THREAD_RECURSION_LIMIT", 200)
    prior_limit = sys.getrecursionlimit()

    code = fw.main(["fold", "--repo", str(repo), "--run-dir", str(run_dir),
                    "--wave", "1", "--base", base_sha,
                    "--branch", "t1=t1:%s" % t1_sha])
    out = capsys.readouterr().out

    assert sys.getrecursionlimit() == prior_limit
    assert code == 3
    payload = json.loads(out.strip().splitlines()[-1])
    assert payload["selfChecks"].startswith(
        "failed: kernel recursion limit folding task t1")
    assert payload["parked"] >= 1 and payload["complete"] is False
    index = json.loads(
        (run_dir / "frontier" / "wave-1" / "conflicts.json").read_text())
    parks = [e for e in index if e["kind"] == "kernel-limit"]
    assert parks and parks[0]["dispatchable"] is False
```

- [ ] **Step 2: Write the `_self_checks` lane test**

```python
def test_selfchecks_recursion_overrun_reports_failed_not_crash(
        tmp_path, monkeypatch, capsys):
    """`_self_checks`' own RecursionError lane: the wave folded, but the
    shuffle/rehydrate verification overran the limit -> a named `failed:`
    verdict and exit 3, never an unhandled crash."""
    repo, base_sha, t1_sha, _ = make_single_writer_repo(tmp_path, 50)
    run_dir = tmp_path / "run"

    def overrun(*_a, **_k):
        raise RecursionError("verification overran")
    monkeypatch.setattr(ff, "raw_shuffle_outcomes", overrun)

    code = fw.main(["fold", "--repo", str(repo), "--run-dir", str(run_dir),
                    "--wave", "1", "--base", base_sha,
                    "--branch", "t1=t1:%s" % t1_sha])
    out = capsys.readouterr().out

    assert code == 3
    payload = json.loads(out.strip().splitlines()[-1])
    assert payload["selfChecks"] == "failed: kernel recursion limit in self-checks"
```

(If `test_fold_wave.py` does not already import the frontier module as `ff`, mirror the import the existing kernel-limit test file header uses.)

- [ ] **Step 3: Write the `cmd_resolve` rehydrate-lane test**

```python
def test_resolve_rehydrate_recursion_overrun_exits_3_with_stderr(
        tmp_path, monkeypatch, capsys):
    """`cmd_resolve`'s rehydrate lane: the reply grammar has already
    passed when `_apply_events` overruns -> stderr names the wave, exit 3,
    and no resolve event is appended to the log."""
    repo, base_sha, heads = make_repo(tmp_path)   # heads = {"t1": sha, "t2": sha}
    run_dir = tmp_path / "run"
    branch_args = []
    for task_id, head_sha in heads.items():       # insertion order = argv order
        branch_args += ["--branch", "%s=%s:%s" % (task_id, task_id, head_sha)]
    assert fw.main(["fold", "--repo", str(repo), "--run-dir", str(run_dir),
                    "--wave", "1", "--base", base_sha] + branch_args) == 0
    capsys.readouterr()
    wave_dir = run_dir / "frontier" / "wave-1"
    index = json.loads((wave_dir / "conflicts.json").read_text())
    entry = next(e for e in index if e["dispatchable"])
    log_before = (wave_dir / "fold_log.jsonl").read_text()
    replies = _reply_dir(tmp_path, "r1",
                         **{("h%d" % k): "resolved\n"
                            for k in range(1, entry["hunkCount"] + 1)})

    def overrun(*_a, **_k):
        raise RecursionError("rehydrate overran")
    monkeypatch.setattr(ff, "_apply_events", overrun)

    code = fw.main(["resolve", "--repo", str(repo), "--run-dir", str(run_dir),
                    "--wave", "1", "--conflict", str(entry["i"]),
                    "--reply-dir", str(replies)] + branch_args)
    captured = capsys.readouterr()

    assert code == 3
    assert "kernel recursion limit rehydrating wave 1" in captured.err
    assert (wave_dir / "fold_log.jsonl").read_text() == log_before
```

- [ ] **Step 4: Write the `cmd_resolve` continued-fold park test**

```python
def test_resolve_continued_fold_kernel_park_exits_3_and_records(
        tmp_path, monkeypatch, capsys):
    """`cmd_resolve`'s handling of a kernel park returned by the continued
    fold: named stderr line, exit 3, park entry in the index. The
    `_fold_until_stop` return seam is monkeypatched directly — its except
    lane itself is pinned by the mid-fold test above."""
    repo, base_sha, heads = make_repo(tmp_path)   # heads = {"t1": sha, "t2": sha}
    t3_name, t3_sha = add_third_branch(repo, base_sha)
    heads[t3_name] = t3_sha
    run_dir = tmp_path / "run"
    branch_args = []
    for task_id, head_sha in heads.items():       # t1, t2, t3 in argv order
        branch_args += ["--branch", "%s=%s:%s" % (task_id, task_id, head_sha)]
    assert fw.main(["fold", "--repo", str(repo), "--run-dir", str(run_dir),
                    "--wave", "1", "--base", base_sha] + branch_args) == 0
    capsys.readouterr()
    wave_dir = run_dir / "frontier" / "wave-1"
    index = json.loads((wave_dir / "conflicts.json").read_text())
    entry = next(e for e in index if e["dispatchable"])
    replies = _reply_dir(tmp_path, "r1",
                         **{("h%d" % k): "resolved\n"
                            for k in range(1, entry["hunkCount"] + 1)})

    def parked_continue(_eng, states, remaining, *_a, **_k):
        return [], list(remaining), (t3_name, states[t3_name])
    monkeypatch.setattr(fw, "_fold_until_stop", parked_continue)

    code = fw.main(["resolve", "--repo", str(repo), "--run-dir", str(run_dir),
                    "--wave", "1", "--conflict", str(entry["i"]),
                    "--reply-dir", str(replies)] + branch_args)
    captured = capsys.readouterr()

    assert code == 3
    assert ("kernel recursion limit folding task %s in wave 1" % t3_name) \
        in captured.err
    index = json.loads((wave_dir / "conflicts.json").read_text())
    assert any(e["kind"] == "kernel-limit" for e in index)
```

The three-writer shape is load-bearing: `add_third_branch`'s own docstring guarantees the initial fold stops at the t1/t2 conflict with t3 still in `remaining`, so `cmd_resolve`'s continued-fold branch (`if remaining:`) is genuinely reached and the patched `_fold_until_stop` return exercises its kernel-park handling for real.

- [ ] **Step 5: Run the new tests**

Run: `python3 -m pytest tests/test_fold_wave.py -v -k "midfold or selfchecks_recursion or rehydrate_recursion or continued_fold_kernel"`
Expected: all 4 PASS (they pin existing behavior — red-first does not apply; the mutation step below is the falsifier).

- [ ] **Step 6: Mutation-verify each lane**

For each of the four lanes, temporarily neuter the handler and confirm exactly the matching test fails, then restore:

1. `fold_wave.py` `_fold_until_stop`: change `except RecursionError:` body to `raise` → `test_midfold_kernel_park_stays_inside_the_exit_contract` FAILS (RecursionError escapes `fw.main`). Restore.
2. `_self_checks`: change its `except RecursionError:` body to `raise` → `test_selfchecks_recursion_overrun_reports_failed_not_crash` FAILS. Restore.
3. `cmd_resolve` rehydrate `except RecursionError:` body to `raise` → `test_resolve_rehydrate_recursion_overrun_exits_3_with_stderr` FAILS. Restore.
4. `cmd_resolve` continued-fold `if kernel_park is not None:` branch: replace `return 3` with `pass` → `test_resolve_continued_fold_kernel_park_exits_3_and_records` FAILS. Restore.

Run: `git diff --stat skills/ultrapowers/kernel/` afterwards.
Expected: empty — the kernel source is byte-identical to where this task started.

- [ ] **Step 7: Run the whole suite and commit**

Run: `python3 -m pytest`
Expected: all PASS.

```bash
git add tests/test_fold_wave.py
git commit -m "test(kernel): pin the four silent RecursionError park lanes (#162)"
```

---

### Task 3: stack_size restore + retired sized-bound wording (#164)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/kernel/fold_wave.py`
- Modify: `evals/frontier/run_eval.py`
- Test: `tests/test_fold_wave.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `run_on_kernel_thread(fn, *args, **kwargs)` keeps its exact signature and marshalling contract; new invariant only — `threading.stack_size()` observed by the caller is unchanged after the call returns, on the thread path and on both fallback paths.

Two hygiene items from issue #164 (the third bullet there is #163's advisory rider — not built here):

1. `run_on_kernel_thread` sets `threading.stack_size(STACK_BYTES)` (1 GiB) and never restores it. `stack_size` is process-global for every thread created afterwards; the function is also an in-process API (`evals/frontier/run_eval.py:_replay_group`, `tests/test_fold_wave.py`), so after one call every later thread in that interpreter reserves 1 GiB. Mirror the recursion-limit handling: capture the prior value, restore it once the big-stack thread has started (a thread's stack is fixed at `start()`).
2. `evals/frontier/run_eval.py`'s track-C exclusion fallback still reads `"kernel recursion limit exceeded even after widening it to fit the corpus"` — sized-bound language Phase 1 retired; the function's own docstring already carries the correct kernel-limit phrasing. Text-only; no test pins the old string (verified at triage).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_fold_wave.py`:

```python
def test_run_on_kernel_thread_restores_process_global_stack_size(monkeypatch):
    """stack_size is process-global; the 1 GiB request must not leak to
    threads created after the call — on the happy path or on the
    Thread.start() fallback path (where the size was already changed
    before the failure)."""
    prior = threading.stack_size()
    assert fw.run_on_kernel_thread(lambda x: x * 3, 5) == 15
    assert threading.stack_size() == prior

    def refuse_start(*_a, **_k):
        raise RuntimeError("can't start new thread")
    monkeypatch.setattr(fw.threading.Thread, "start", refuse_start)
    assert fw.run_on_kernel_thread(lambda x: x + 1, 41) == 42
    assert threading.stack_size() == prior
```

(`tests/test_fold_wave.py` already imports `threading` for the existing `run_on_kernel_thread` tests; if not, add the import at the top with the others.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_fold_wave.py::test_run_on_kernel_thread_restores_process_global_stack_size -v`
Expected: FAIL — after the first call, `threading.stack_size()` reads `STACK_BYTES` (1073741824), not the prior value.

- [ ] **Step 3: Implement the save/restore in `run_on_kernel_thread`**

Replace the dispatch block at the bottom of `skills/ultrapowers/kernel/fold_wave.py::run_on_kernel_thread` (currently one `try` around `stack_size` + `Thread` + `start` + `join` with a combined `except (ValueError, RuntimeError)`) with:

```python
    try:
        prior_stack = threading.stack_size(STACK_BYTES)
    except ValueError as e:
        # Nothing was changed: stack_size raises before mutating.
        print("fold_wave: big-stack thread unavailable (%s); running in main "
              "thread" % e, file=sys.stderr)
        return fn(*args, **kwargs)
    try:
        t = threading.Thread(target=target, name="fold-kernel")
        t.start()
    except RuntimeError as e:
        print("fold_wave: big-stack thread unavailable (%s); running in main "
              "thread" % e, file=sys.stderr)
        return fn(*args, **kwargs)
    finally:
        # Process-global, like the recursion limit: a thread's stack is fixed
        # at start(), so restoring here affects only threads created later.
        threading.stack_size(prior_stack)
    t.join()
    if "exc" in box:
        raise box["exc"]
    return box["result"]
```

Also update the docstring's platform-refusal sentence to note the prior stack size is restored in every path (mirroring its existing recursion-limit paragraph).

- [ ] **Step 4: Run the fold_wave tests**

Run: `python3 -m pytest tests/test_fold_wave.py -v -k "run_on_kernel_thread"`
Expected: all PASS — including the existing `test_run_on_kernel_thread_falls_back_to_the_main_thread` (its `stack_size` monkeypatches return `None`; the restore call passes that value back to the same mock, which accepts anything).

- [ ] **Step 5: Scrub the retired wording in `evals/frontier/run_eval.py`**

In the track-C `except RecursionError` handler (~line 644–651), replace the fallback string so the reason reads:

```python
        except RecursionError as exc:
            excluded.append({"ref": run["ref"], "reason":
                             "recursion depth: %s" % (str(exc) or
                                                      "kernel recursion limit "
                                                      "exceeded on the "
                                                      "big-stack kernel "
                                                      "thread")})
            continue
```

The sized-bound clause ("even after widening it to fit the corpus") names machinery Phase 1 retired; the replacement matches the module docstring's own phrasing.

- [ ] **Step 6: Run the whole suite and commit**

Run: `python3 -m pytest`
Expected: all PASS.

```bash
git add skills/ultrapowers/kernel/fold_wave.py evals/frontier/run_eval.py tests/test_fold_wave.py
git commit -m "fix(kernel): restore process-global stack_size after run_on_kernel_thread; scrub retired sized-bound wording (#164)"
```
