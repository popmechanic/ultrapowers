# Frontier Mode in the Shipping Engine — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the frontier fold capability inside the wave engine, dark behind `--overlap serialize`, exactly as specced in `docs/superpowers/specs/2026-08-12-frontier-mode-in-engine-design.md` (final, 12-round trim review) — kernel promoted to `skills/ultrapowers/kernel/`, fold-mode compiler, derived-contention merge path, shadow probe, and the pre-registered A/B apparatus.

**Architecture:** The manyana kernel and fold state machine move from `evals/frontier/` into `skills/ultrapowers/kernel/` as the engine's founding module; a deterministic `fold_wave.py` CLI (fold / resolve / materialize) owns all fold state via git + a replayable fold log; `compile_plan.py` gains an `--overlap {serialize,fold}` knob (serialize default, byte-identical to today) and `waves.js` gains a contended branch of the existing merge-agent role that derives contention from wave shape + `files` (no new compiler field). The eval line re-points; the A/B apparatus (fixture + ab_runner arm) is built but the cells run as manual stages.

**Tech Stack:** Python 3 stdlib (compiler stays subprocess-free), git plumbing (`commit-tree`, `read-tree`, `ls-tree`, `update-index`), Claude Code Dynamic Workflows (`waves.js`), pytest, node `.mjs` sims.

**Acceptance:** suite — committed pytest + the `.mjs` harness sims (suite-gate sentinel discipline) are the verification; sealing not requested by the operator.

## Global Constraints

- **Spec is authority:** `docs/superpowers/specs/2026-08-12-frontier-mode-in-engine-design.md` (commit `03ff865`). Where this plan and the spec disagree, the spec wins; flag the disagreement in the task report.
- `--overlap serialize` compile output is **byte-identical to today's** on every plan shape (spec §1). Any task that touches `compile_plan.py` must keep the byte-identity pins green.
- The shipped default is `OVERLAP_DEFAULT = "serialize"` — **§5 of the spec (ultraplan relaxation, rubric change, default flip) is NOT built by this plan.**
- `compile_plan.py` stays **stdlib-only and subprocess-free**; its only filesystem access beyond the plan file is the `--repo-root` pre-filter probes (spec §1).
- No new compiler diagnostic vocabulary: ineligible paths ride the existing `marker_conflicts` `kind: "inference"` records (spec §Release; the 0.1.0 freeze).
- All line counting goes through the kernel's `split_lines` — never `str.splitlines()` (they differ by one on every trailing-newline file, spec §2).
- Engine prompts are **baked**: edit `skills/ultrapowers/references/wave-merge.md` source blocks AND the baked consts in `harnesses/waves.js`; `tests/test_no_prompt_drift.py` pins them (spec §3; CLAUDE.md anti-drift rule).
- New harness sims MUST print `ALL SCENARIOS PASSED` on success (suite-gate sentinel, CLAUDE.md).
- The verification periphery is FROZEN: no changes to `collect_seal.py`, `seal_hash.py`, `run_acceptance.sh`, `gate_check.py`, `ultra_gate.py`, `run_lock.sh`.
- Test gate: `python3 -m pytest` from repo root; run affected `.mjs` sims via `node tests/<name>.mjs`.
- Concurrency safety: every new pytest test uses `tmp_path` for repos/dirs; no shared on-disk fixtures; sims use their own scratch dirs.
- Fold-log path convention: `<runDir>/frontier/wave-<n>/` with `<n>` **1-based** (the `heads/` slot precedent).

---

### Task 1: Promote the kernel to `skills/ultrapowers/kernel/`

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/kernel/__init__.py`
- Create: `skills/ultrapowers/kernel/vendor/manyana.py`
- Create: `skills/ultrapowers/kernel/vendor/PROVENANCE.md`
- Create: `skills/ultrapowers/kernel/repo_weave.py`
- Create: `skills/ultrapowers/kernel/frontier_fold.py`
- Modify: `evals/frontier/schedule_model.py`
- Modify: `evals/frontier/shadow_fold.py`
- Modify: `evals/frontier/run_eval.py`
- Modify: `evals/run_frontier_cell.py`
- Test: `tests/test_frontier_kernel.py`
- Test: `tests/test_frontier_fold.py`
- Test: `tests/test_repo_weave.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: importable package path `skills/ultrapowers/kernel` — `from kernel import repo_weave, frontier_fold` when `skills/ultrapowers` is on `sys.path`, and the two generic helpers relocated into the kernel: `sampled_orders(n: int, seed: int = 42) -> list[list[int]]` and `fold_all(fold_fn, base, tasks, order) -> tuple[RepoState, list[Conflict]]` (moved out of `evals/frontier/schedule_model.py`, which now imports them back). All existing public names (`FrontierEngine`, `replay`, `raw_shuffle_outcomes`, `dispatchable`, `RESOLVER_LINE_CAP`, `split_lines`, `join_lines`, `fold`, `publish`, `snapshot`, `manifest`) are unchanged in this task — moves only, zero behavior change.

**Parallelization rationale:** module promotion is the spec's founding-orientation move — the kernel becomes a real package other tasks import, which is what lets the compiler (Task 6), the CLI (Tasks 3–4), and the engine docs (Task 7) proceed against a stable import path.

This is a **pure move**: `git mv`, then re-point imports and the two test pins. No logic changes. The sha256 vendor pin and the parse-under-running-interpreter pin must both re-point and stay green, proving the move changed nothing.

- [ ] **Step 1: Move the files with git mv**

```bash
mkdir -p skills/ultrapowers/kernel/vendor
git mv evals/frontier/vendor/manyana.py skills/ultrapowers/kernel/vendor/manyana.py
git mv evals/frontier/vendor/PROVENANCE.md skills/ultrapowers/kernel/vendor/PROVENANCE.md
git mv evals/frontier/repo_weave.py skills/ultrapowers/kernel/repo_weave.py
git mv evals/frontier/frontier_fold.py skills/ultrapowers/kernel/frontier_fold.py
touch skills/ultrapowers/kernel/__init__.py
```

- [ ] **Step 2: Fix the kernel's internal sys.path bootstrap**

`frontier_fold.py` currently does `sys.path.insert` for its own dir and `vendor/`. Update the two lines to the new layout (same pattern, new relative dir):

```python
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "vendor"))
```

(Paths are relative to `__file__`, so the text is unchanged — verify it resolves under the new location; `repo_weave.py` has an equivalent header if it bootstraps `vendor/`, update identically.)

- [ ] **Step 3: Move `sampled_orders` and `fold_all` into the kernel**

Cut both functions (and only these two) from `evals/frontier/schedule_model.py` and paste them verbatim into `skills/ultrapowers/kernel/frontier_fold.py` (below `RESOLVER_LINE_CAP`, above `FrontierEngine`; `sampled_orders` needs `random` and `itertools.permutations` imports added to `frontier_fold.py`). Replace them in `schedule_model.py` with:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "skills" / "ultrapowers" / "kernel"))
from frontier_fold import sampled_orders, fold_all  # noqa: E402  (promoted to the kernel; modeling-only module imports back)
```

`frontier_fold.py`'s own `import schedule_model as sm` and its `sm.sampled_orders`/`sm.fold_all` call sites in `raw_shuffle_outcomes` change to direct local calls — the shipped kernel must not import eval-only code (spec §Where it lives).

- [ ] **Step 4: Re-point the eval and test imports**

In `evals/frontier/shadow_fold.py`, `evals/frontier/run_eval.py`, `evals/run_frontier_cell.py`, and every `tests/test_frontier_*.py` / `tests/test_repo_weave.py` that inserts `evals/frontier` (or `evals/frontier/vendor`) on `sys.path` to import `repo_weave` / `frontier_fold` / `manyana`: change the inserted path to `skills/ultrapowers/kernel` (and `skills/ultrapowers/kernel/vendor` where `manyana` is imported directly). `tests/test_frontier_kernel.py`'s `VENDOR` path constant re-points to `skills/ultrapowers/kernel/vendor/manyana.py` — the sha256 pin content is untouched.

- [ ] **Step 5: Run the full suite to verify the move is behavior-free**

Run: `python3 -m pytest`
Expected: PASS, same count as baseline (`git stash && python3 -m pytest` first if you need the baseline number). Any failure is an import you missed — fix the path, never the logic.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(kernel): promote manyana kernel + fold modules to skills/ultrapowers/kernel (pure move, imports re-pointed)"
```

---

### Task 2: Kernel semantics — bijective line convention, `[]`-as-absence, `rehydrate`, fold-log schema

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/kernel/repo_weave.py`
- Modify: `skills/ultrapowers/kernel/frontier_fold.py`
- Create: `skills/ultrapowers/kernel/FOLD_LOG.md`
- Test: `tests/test_kernel_bijection.py`
- Test: `tests/test_rehydrate.py`

**Interfaces:**
- Consumes: the promoted kernel package (Task 1).
- Produces: `split_lines(content: str) -> list[str]` = `content.split("\n")` and `join_lines(lines: list[str]) -> str` = `"\n".join(lines)` — a bijection over existing files where the empty file is `[""]` and `[]` denotes absence (never returned by `split_lines`); `rehydrate(repo: pathlib.Path, log_path: pathlib.Path) -> FrontierEngine` — rebuilds a live engine from git + the fold log, applying recorded resolutions **unconditionally**; `replay(...)` becomes a thin wrapper over `rehydrate`; the three-event fold-log JSONL vocabulary documented in `kernel/FOLD_LOG.md`: `{"type":"base","sha":...}` (first line), `{"type":"fold","task":...,"headSha":...}`, `{"type":"resolve","path":...,"epoch":int,"lines":[...]}`. `frontier_fold._visible` is deleted. `dispatchable()` counts lines via `split_lines`, never `splitlines()`.

- [ ] **Step 1: Write the failing bijection tests**

`tests/test_kernel_bijection.py` (sys.path bootstrap to `skills/ultrapowers/kernel` as in the re-pointed kernel tests):

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "ultrapowers" / "kernel"))
import repo_weave as rw
import frontier_fold as ff


def test_split_join_is_a_bijection_on_trailing_and_no_trailing_newline():
    assert rw.split_lines("a\nb\n") == ["a", "b", ""]
    assert rw.split_lines("a\nb") == ["a", "b"]
    assert rw.join_lines(["a", "b", ""]) == "a\nb\n"
    assert rw.join_lines(["a", "b"]) == "a\nb"


def test_empty_file_is_single_empty_line_and_join_inverts():
    assert rw.split_lines("") == [""]
    assert rw.join_lines([""]) == ""


def test_split_lines_never_yields_empty_list():
    # [] denotes absence; split_lines can never produce it.
    for content in ("", "\n", "x", "x\n", "\n\n"):
        assert rw.split_lines(content) != []


def test_deleted_path_stays_omitted_and_emptied_file_materializes_empty(tmp_path):
    # deletion mark ([]) and truncation-to-empty ([""]) no longer collide:
    # a state whose visible lines are [] and is marked deleted is omitted;
    # a state whose visible lines are [""] survives as the empty file.
    base = rw.RepoState(files={}, deleted_marks=set(), raw={}, raw_candidates={})
    import manyana
    files = {"gone.txt": manyana.update_state(manyana.initial_state(["x"]), []),
             "empty.txt": manyana.update_state(manyana.initial_state(["x"]), [""])}
    state = rw.RepoState(files=files, deleted_marks={"gone.txt"}, raw={}, raw_candidates={})
    m = rw.manifest(state)
    assert "gone.txt" not in m
    assert m["empty.txt"] == ""


def test_dispatchable_counts_via_split_lines_exact_cap_boundary():
    # a body of exactly RESOLVER_LINE_CAP visible lines (per split_lines) is
    # dispatchable; one more is not. splitlines() would disagree by one on
    # the trailing-newline spelling — the kernel's own convention decides.
    cap = ff.RESOLVER_LINE_CAP
    body_at_cap = "\n".join("l%d" % i for i in range(cap - 1)) + "\n"   # split_lines -> cap elements
    assert len(rw.split_lines(body_at_cap)) == cap
    body_over = body_at_cap + "x\n"
    assert len(rw.split_lines(body_over)) == cap + 2

    class C:  # minimal conflict stand-in
        def __init__(self, path): self.path, self.kind = path, "text"
        narration = rw.MARKERS[0] + " begin added x\n"
    ok, _ = ff.dispatchable(C("f.py"), {"f.py": body_at_cap})
    assert ok
    ok, reason = ff.dispatchable(C("f.py"), {"f.py": body_over})
    assert not ok and "visible lines" in reason
```

(If the `Conflict` stand-in shape mismatches the real namedtuple, construct the real `rw.Conflict` — match whatever `dispatchable` actually reads: `.narration`, `.path`, `.kind`.)

- [ ] **Step 2: Write the failing rehydrate tests**

`tests/test_rehydrate.py` — build a tiny real git repo in `tmp_path` with a base commit and two task branches editing one file (mirror the arrangement in the existing `tests/test_frontier_fold.py` fixtures), then:

```python
def test_rehydrate_reconstructs_epoch_and_touched_map_across_processes(tmp_path):
    # live: fold t1, resolve path at its epoch, fold t2  -> record log
    # rehydrated: rehydrate(repo, log)                    -> same epoch(),
    # same touched map, same manifest. Epoch equality is the point: replay()
    # historically skipped appending resolve events and desynced the clock.
    live = drive_live_engine(tmp_path)          # helper below
    log = tmp_path / "fold_log.jsonl"
    write_log(log, live.events_with_base)       # base line + events, per FOLD_LOG.md
    re = ff.rehydrate(tmp_path / "repo", log)
    assert re.epoch() == live.engine.epoch()
    assert re._touched_at == live.engine._touched_at
    assert re.manifest() == live.engine.manifest()


def test_rehydrate_applies_recorded_resolve_unconditionally():
    # A recorded resolve whose epoch would FAIL apply_resolution's staleness
    # check must still apply during rehydration (the log records what
    # actually applied; re-deciding it would silently drop a resolution).
    ...  # construct a log where a fold event on the same path precedes the
         # resolve event with an earlier epoch; assert the resolved lines
         # are present in the rehydrated manifest.


def test_replay_is_a_thin_wrapper_and_matches_rehydrate():
    ...  # ff.replay(base, tasks_by_id, events) == rehydrate(...).manifest()
```

Fill the two `...` bodies concretely against the fixture-repo helper you write in this file (no fixtures shared with other test files; everything under `tmp_path`).

- [ ] **Step 3: Run both files to verify they fail**

Run: `python3 -m pytest tests/test_kernel_bijection.py tests/test_rehydrate.py -v`
Expected: FAIL — today `split_lines("a\nb")` drops nothing but `join_lines` re-adds; `rehydrate` doesn't exist.

- [ ] **Step 4: Implement the bijection in `repo_weave.py`**

```python
def split_lines(content):
    """Bijection between byte strings and line lists for EXISTING files:
    the empty file is [""], and [] is not in the range — [] denotes absence
    (deletion mark / never-existed) and stays constructible only at the
    absence sites (task_state_from_contents delete mark, the shared empty
    ancestor, _resolved_state's default)."""
    return content.split("\n")


def join_lines(lines):
    return "\n".join(lines)
```

Sweep `repo_weave.py` for the old convention's compensations and remove them; update `_base_text_untouched`'s docstring — delete the sentence claiming "an empty base file's delete weave equals the base's own state" (under the bijection that collision no longer arises; the `deleted_marks` conjunct stays, it is load-bearing for other reasons — spec §2). In `frontier_fold.py`: delete `_visible` and call `rw.split_lines` directly at its former call site; audit `dispatchable()` to count via `len(rw.split_lines(body))`.

- [ ] **Step 5: Implement `rehydrate` and thin-wrapper `replay` in `frontier_fold.py`**

```python
def rehydrate(repo, log_path):
    """Rebuild a live FrontierEngine from git + the fold log.

    fold events re-publish the task from its recorded headSha (a pure
    function of git objects) and re-fold it; resolve events re-apply their
    recorded lines UNCONDITIONALLY and are appended to the event list so
    the epoch clock reconstructs exactly. Validity is never re-checked:
    the log records what actually applied. base events seed the engine;
    they are otherwise inert."""
    import json
    events = [json.loads(l) for l in Path(log_path).read_text().splitlines() if l.strip()]
    assert events and events[0]["type"] == "base"
    base_sha = events[0]["sha"]
    # scoped base per the union-then-fold ordering contract: derive every
    # fold event's touched set first (git diff name-status vs base), union,
    # snapshot only those paths at base.
    task_heads = [(e["task"], e["headSha"]) for e in events if e["type"] == "fold"]
    touched = _union_touched(repo, base_sha, [h for _, h in task_heads])
    base = rw.snapshot_scoped(repo, base_sha, touched)
    eng = FrontierEngine(base)
    states = {tid: rw.publish(base, repo, base_sha, head, task_id=tid) for tid, head in task_heads}
    for e in events[1:]:
        if e["type"] == "fold":
            eng.fold(states[e["task"]])
        elif e["type"] == "resolve":
            eng.frontier = _resolved_state(eng.frontier, e["path"], e["lines"])
            eng.events.append({"type": "resolve", "path": e["path"],
                               "epoch": e["epoch"], "lines": list(e["lines"])})
    return eng
```

Add `snapshot_scoped(repo, ref, paths)` to `repo_weave.py` (same construction as `snapshot` but over the given path list only) and `_union_touched(repo, base_sha, heads)` via `git diff --name-status --no-renames <base>..<head>` per head. (`rehydrate` may shell to git — it is kernel/CLI code, not the compiler.) Rewrite `replay(base, tasks_by_id, events)` to construct the engine the same way from in-memory inputs and delegate the event walk to a shared private `_apply_events(eng, states, events)` so the two cannot drift.

- [ ] **Step 6: Write `kernel/FOLD_LOG.md`**

Document exactly: the path convention (`<runDir>/frontier/wave-<n>/fold_log.jsonl`, `<n>` 1-based), the three event types with their fields as in Interfaces above, the self-sufficiency contract (log + repo → `rehydrate`), the no-validity-recheck rule, and that conflicts/parks live in the conflicts index (Task 3), fallbacks in engine records — one fact, one record.

- [ ] **Step 7: Run the new tests and the whole suite**

Run: `python3 -m pytest tests/test_kernel_bijection.py tests/test_rehydrate.py -v && python3 -m pytest`
Expected: new tests PASS; pre-existing kernel tests that pinned the OLD convention (`join_lines([""]) == "\n"`, trailing-newline normalization) will FAIL — update those assertions to the bijection (this is the spec'd behavior change, disclosed as kernel-wide; every other failure is a regression to fix).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(kernel): bijective line convention with []-as-absence, rehydrate(repo,log), fold-log schema"
```

---

### Task 3: `fold_wave.py` CLI — `fold` and `resolve` subcommands

**Type:** implementation
**Depends-on:** 2

**Files:**
- Create: `skills/ultrapowers/kernel/fold_wave.py`
- Test: `tests/test_fold_wave.py`

**Interfaces:**
- Consumes: `rehydrate`, `FrontierEngine`, `dispatchable`, `RESOLVER_LINE_CAP`, `split_lines`, the fold-log schema (Task 2).
- Produces: the CLI contract the engine prompt (Task 9) invokes:
  - `python3 <pluginRoot>/skills/ultrapowers/kernel/fold_wave.py fold --repo <path> --run-dir <dir> --wave <n> --base <sha> --branch <taskId>=<branchName>:<headSha> [--branch ...]` — branches given in **task-index order**; refuses (exit 2, message `fold log already exists for wave <n>`) when `frontier/wave-<n>/fold_log.jsonl` exists; writes `fold_log.jsonl`, per-conflict narrations `conflict-<i>.txt`, and the conflicts index `conflicts.json` (`[{"i":1,"path":...,"kind":...,"dispatchable":bool,"reason":str,"epoch":int}]` — parks are the entries with `"dispatchable": false`, kernel-limit parks included); runs both live self-checks (sampled raw fold orders outcome-identical via `sampled_orders`+`fold_all`; log replay reproduces the manifest via `rehydrate`); prints one-line JSON `{"clean":bool,"conflicts":N,"dispatchable":N,"parked":N,"selfChecks":"ok"|"failed: <which>"}`; self-check failure exits 3.
  - `... resolve --repo <path> --run-dir <dir> --wave <n> --path <p> --epoch <e> --reply-file <f>` — reply file is whole-file bytes, split by kernel `split_lines`; applies under epoch validity; on stale, re-narrates ONCE: writes the frontier's current whole file (markerless — re-folding narrates nothing) to the next `conflict-<i>.txt`, appends it to `conflicts.json` with `"renarration": true` and the new epoch, prints `{"applied":false,"stale":true,"renarrationFile":...,"epoch":E}`; on success appends the `resolve` event (with lines) and prints `{"applied":true}`.
  - Exit codes: 0 success, 2 precondition refusal, 3 self-check failure.

**Parallelization rationale:** none claimed — Tasks 3 and 4 share `fold_wave.py` and chain by design; the split exists because materialize's git-plumbing surface deserves its own reviewer gate, not to create width.

- [ ] **Step 1: Write the failing tests for `fold`**

In `tests/test_fold_wave.py`, build a real git repo under `tmp_path` (helper `make_repo(tmp_path)`: base commit with `app.py` (3 short functions) + `other.txt`; two branches `t1`, `t2` each editing `app.py` differently so one genuine conflict arises, `t2` also deleting `other.txt`). Invoke the CLI via `subprocess.run([sys.executable, CLI, "fold", ...])`. Assert:

```python
def test_fold_writes_log_narrations_index_and_passes_self_checks(tmp_path): ...
    # exit 0; fold_log.jsonl first line type=="base"; two fold events with
    # the branches' headShas in the given task-index order; conflicts.json
    # has >=1 entry with dispatchable True and an existing conflict-<i>.txt
    # whose text contains a rw.MARKERS prefix; stdout JSON selfChecks=="ok".

def test_fold_refuses_preexisting_log(tmp_path): ...
    # second invocation exits 2 with "fold log already exists for wave 1".

def test_fold_scoped_snapshot_folds_single_writer_modify_as_modify(tmp_path): ...
    # a base-existing path touched by only ONE task must fold as a modify,
    # never add/add: assert no conflict with kind add/add on that path and
    # the folded content equals that branch's content. (Union-then-fold
    # ordering contract — a per-task streaming scope breaks this.)

def test_fold_kernel_limit_parks_with_named_reason(tmp_path): ...
    # a ~1200-line file edited by both branches -> conflicts.json entry with
    # dispatchable False and "visible lines" (or recursion) in reason; exit 0.
```

- [ ] **Step 2: Write the failing tests for `resolve`**

```python
def test_resolve_applies_at_valid_epoch_and_appends_lines_event(tmp_path): ...
    # run fold; take conflicts.json[0]'s epoch and path; write a plausible
    # whole-file reply; resolve exits 0, {"applied": true}; last log event is
    # type resolve carrying the reply's split_lines; rehydrate(log).manifest()
    # contains the resolved content byte-identically (incl. no-final-newline
    # reply -> byte-identical materialized value in the manifest).

def test_resolve_stale_renarrates_once_markerless(tmp_path): ...
    # fold a third branch (advance the epoch past the narration), then
    # resolve with the old epoch: {"applied": false, "stale": true}; the
    # renarration file exists, contains NO rw.MARKERS prefix on any line,
    # and conflicts.json's new entry has renarration true + the new epoch.
```

- [ ] **Step 3: Run to verify failure**

Run: `python3 -m pytest tests/test_fold_wave.py -v`
Expected: FAIL — `fold_wave.py` does not exist.

- [ ] **Step 4: Implement `fold_wave.py` (`fold` + `resolve`)**

Structure: `argparse` subcommands; every invocation is a fresh process — `resolve` starts by `rehydrate(repo, log)`; `fold` builds the scoped base per the union-then-fold contract (derive each branch's touched set via `git diff --name-status --no-renames <base>..<head>`, union, `snapshot_scoped`), then folds in the given branch order, writing events/narrations/index as specified in Interfaces. Self-checks after folding: `raw_shuffle_outcomes`-style sampled orders over the published task states (outcome-identical or exit 3), and `rehydrate(repo, log).manifest() == engine.manifest()` (or exit 3, naming which check). All I/O under `<runDir>/frontier/wave-<n>/`; agents will relay only the stdout JSON scalars (#36).

- [ ] **Step 5: Run to verify pass, then full suite**

Run: `python3 -m pytest tests/test_fold_wave.py -v && python3 -m pytest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/kernel/fold_wave.py tests/test_fold_wave.py
git commit -m "feat(kernel): fold_wave CLI — fold + resolve (scoped snapshots, self-checks, conflicts index, fresh-log refusal, markerless re-narration)"
```

---

### Task 4: `fold_wave.py` CLI — `materialize` subcommand (temporary index, observed modes)

**Type:** implementation
**Depends-on:** 3
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/kernel/fold_wave.py`
- Test: `tests/test_fold_wave_materialize.py`

**Interfaces:**
- Consumes: `rehydrate` (Task 2), the fold/resolve state on disk (Task 3).
- Produces: `... materialize --repo <path> --run-dir <dir> --wave <n> --prev-head <sha> --task-head <taskId>=<sha> [--task-head ...]` → builds the candidate commit via a temporary index and prints `{"candidateSha": "<sha>"}` (exit 0); named park (exit 2, reason on stdout JSON `{"park": reason}`) on a mode change or differing creator modes; named fallback (exit 3, `{"fallback": reason}`) on a non-regular folded path. Parents of the candidate = `<prev-head>` + task heads, in the given order. **The worktree and all branch refs are untouched** — adoption is the engine's job (Task 9).

- [ ] **Step 1: Write the failing tests**

`tests/test_fold_wave_materialize.py`, fresh `tmp_path` git repos per test:

```python
def test_materialize_builds_candidate_with_touched_set_and_parents(tmp_path): ...
    # after fold(+resolve): materialize exits 0; git cat-file the candidate:
    # parents == [prevHead, t1Head, t2Head]; the tree contains the folded
    # content for touched paths; `git status --porcelain` in the worktree is
    # EMPTY and the branch ref is unmoved (the temp-index construction).

def test_materialize_deletion_reaches_tree_untouched_paths_survive(tmp_path): ...
    # t2's deleted file is ABSENT from the candidate tree (touched-set
    # keying: manifest omits deletions, so absence-from-manifest within the
    # touched set means --force-remove); an untracked-by-the-fold executable
    # (mode 100755) and a symlink elsewhere in the repo keep exact mode and
    # link target in the candidate tree (paths outside the touched set are
    # never visited).

def test_materialize_folded_path_keeps_base_mode_and_created_path_takes_creator_mode(tmp_path): ...
    # a folded 100755 file keeps its bit (mode from prev integration head);
    # a path the fold ADDS gets its creating task's mode (creator commits it
    # 100755 -> candidate has 100755).

def test_materialize_parks_on_mode_change_and_on_differing_creator_modes(tmp_path): ...
    # a task chmods a folded path (blob identical, mode differs at its head
    # per ls-tree) -> exit 2, {"park": ...} naming the path; two creators
    # with 100644 vs 100755 -> exit 2.

def test_materialize_no_final_newline_byte_identity(tmp_path): ...
    # a resolved file whose reply had no final newline materializes into the
    # candidate blob byte-identically (git cat-file blob == reply bytes).
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_fold_wave_materialize.py -v`
Expected: FAIL — no `materialize` subcommand.

- [ ] **Step 3: Implement `materialize`**

The temporary-index route, exactly (spec §2): with `env = {**os.environ, "GIT_INDEX_FILE": str(tmpindex)}` —

```
git read-tree <prevHead>                       # seed the temp index
# per path in the union of the fold events' touched sets:
#   in manifest  -> sha = git hash-object -w --stdin  (content bytes via join_lines)
#                   mode = observed (below)
#                   git update-index --add --cacheinfo <mode>,<sha>,<path>
#   not in manifest -> git update-index --force-remove <path>
git write-tree                                 # -> treeSha
git commit-tree <treeSha> -p <prevHead> -p <t1Head> -p <t2Head> ... -m "frontier fold wave <n>"
```

Mode observation via `git ls-tree <ref> -- <path>` (the text pipeline is mode-blind; `--name-status` reports a chmod as `M` with identical blobs): base-existing path → mode from `<prevHead>`, **after verifying no task's head shows a different mode for it** (differ → park); fold-added path → creating task's mode (creators disagree → park); non-regular object (symlink/gitlink mode) among folded paths → fallback exit 3. Never touch the worktree or any ref.

- [ ] **Step 4: Run to verify pass, then full suite**

Run: `python3 -m pytest tests/test_fold_wave_materialize.py -v && python3 -m pytest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/kernel/fold_wave.py tests/test_fold_wave_materialize.py
git commit -m "feat(kernel): fold_wave materialize — temporary-index candidate, touched-set keying, observed modes, named parks/fallbacks"
```

---

### Task 5: Compiler — `--overlap` knob, construction-time drop, labeling predicate, flatten deletion

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Test: `tests/test_compile_overlap.py`

**Interfaces:**
- Consumes: nothing from other tasks (kernel constants arrive in Task 6, which layers the pre-filter on this knob).
- Produces: `--overlap {serialize,fold}` argv on `compile_plan.py` with module constant `OVERLAP_DEFAULT = "serialize"`; under `fold`, the tier-3 loop **does not create** `write-after-write` edges for droppable pairs and records them in `dropped_pairs` (both orderings); the `fully_overlapping` flatten line is **deleted**; `mode`/`degrade_reason` recompute via the full-pair-iteration predicate. Byte-identity: `--overlap serialize` output is byte-identical to today's on every shape. (In this task, with no pre-filter yet, **every** new-edge pair is droppable; Task 6 narrows eligibility.)

- [ ] **Step 1: Capture the byte-identity baseline**

Before touching the compiler, snapshot today's outputs for the four pin shapes and the eval fixtures:

```bash
for f in wide chained mixed flawed degrade contend; do
  python3 skills/ultrapowers/scripts/compile_plan.py evals/fixtures/$f/plan.md > /tmp/baseline-$f.json
done
```

- [ ] **Step 2: Write the failing tests**

`tests/test_compile_overlap.py` — author four inline plan strings (write them fully in the test file, following the marker grammar used throughout `tests/test_compile_plan.py`): (a) three tasks all `Modify: src/x.py`, no Depends-on; (b) same but the tasks additionally chained by explicit `Depends-on` markers *(ineligibility itself arrives with Task 6's pre-filter — in this task the “ineligible” pin is expressed as: an explicit marker edge means the pair is not droppable)*; (c) two tasks with disjoint writes sharing one `- Test: tests/shared.py`; (d) two tasks overlapping on `src/x.py` plus a third with disjoint files. Tests:

```python
def test_serialize_mode_is_byte_identical_to_default_invocation():
    # compile each fixture plan with no flag and with --overlap serialize;
    # json output strings must be IDENTICAL (byte-identity by construction).

def test_fold_drops_only_new_write_after_write_edges():
    # shape (a) under fold: zero write-after-write edges; one wave of 3.
    # shape (b) under fold: marker edges survive; pairs already in seen are
    # neither dropped nor freed (chain preserved).
    # shape (c) under fold: the reads-driven w-a-w edge drops; both tasks
    # share a wave.

def test_labeling_predicate_full_iteration_four_shapes():
    # (a) fold  -> mode parallel, no degrade_reason, one wave
    # (a) serialize -> mode sequential, degrade_reason contains
    #     "fully overlapping writes", singleton waves  (today's output)
    # (b) both modes -> sequential label unchanged from today
    # (c) both modes -> mode parallel (writes-only predicate; Test: path
    #     lives in reads)
    # (d) both modes -> mode parallel (the disjoint third task contributes
    #     the False terms; the kept-pairs reading would flip this)

def test_ambiguous_task_still_serializes_against_drop_affected_peers():
    # add a task with an empty Files block to shape (a) under fold: it still
    # receives ambiguous-files edges against all three (drop at construction
    # keeps later tiers' reachability true).

def test_reachability_direction_flip_is_pinned():
    # construct: t1,t2 overlap (droppable); t3 overlaps t1 via an explicit
    # marker edge t3->t1; today reachability t2->..->? blocks some forward
    # edge — assert the documented direction under fold vs serialize so the
    # disclosed behavioral difference has a pinned witness.
```

- [ ] **Step 3: Run to verify failure**

Run: `python3 -m pytest tests/test_compile_overlap.py -v`
Expected: FAIL — no `--overlap` flag.

- [ ] **Step 4: Implement**

In `compile_plan.py`: add the argv flag + `OVERLAP_DEFAULT = "serialize"`; thread `overlap_mode` into `build_edges`. In the tier-3 loop, a pair about to receive a **new** `write-after-write` edge (forward order, not in `seen`, `not would_cycle`) is *dropped* instead when `overlap_mode == "fold"` and the pair is eligible (`eligible(pair)` is a hook returning `True` unconditionally in this task; Task 6 supplies the real pre-filter): record `dropped_pairs.add((a,b)); dropped_pairs.add((b,a))`, skip `add()`. Delete the `fully_overlapping` flatten line (`waves = [[tid] for wave ...]`) — it is dead code (Kahn already yields singletons whenever the predicate fires). Recompute the label with the spec's exact predicate:

```python
fully_overlapping = len(impl) > 1 and all(
    (set(a["writes"]) & set(b["writes"])
     and (a["id"], b["id"]) not in dropped_pairs)
    for a in impl for b in impl if a["id"] != b["id"])
```

`dropped_pairs` empty under serialize ⇒ reduces to today's expression literally. Update `references/dependency-analysis.md`'s degrade wording to match the recomputation.

- [ ] **Step 5: Verify byte-identity against the baseline, run everything**

```bash
for f in wide chained mixed flawed degrade contend; do
  python3 skills/ultrapowers/scripts/compile_plan.py --overlap serialize evals/fixtures/$f/plan.md | diff - /tmp/baseline-$f.json || echo "BYTE DIFF in $f — FIX BEFORE COMMIT"
done
python3 -m pytest
```
Expected: zero diffs; suite green.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py skills/ultrapowers/references/dependency-analysis.md tests/test_compile_overlap.py
git commit -m "feat(compiler): --overlap knob — construction-time write-after-write drop, dead flatten deleted, full-iteration labeling predicate (byte-identical under serialize)"
```

---

### Task 6: Compiler — `--repo-root` eligibility pre-filter (hermetic, memoised, inert without root)

**Type:** implementation
**Depends-on:** 2, 5

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Test: `tests/test_compile_prefilter.py`

**Interfaces:**
- Consumes: `RESOLVER_LINE_CAP` and `split_lines` imported from `skills/ultrapowers/kernel/frontier_fold` / `repo_weave` (Task 2) — a Python import, no subprocess; the `eligible(pair)` hook and `--overlap` machinery (Task 5).
- Produces: `--repo-root <path>` argv; the real `eligible()`: a pair keeps its serializing edge when any path in its overlap set (`writes ∪ reads`, both sides), resolved against the root and existing there, is non-text, over `RESOLVER_LINE_CAP` counted via `split_lines`, or a symlink (`Path.is_symlink()`; gitlinks are left to the runtime guard — the compiler stays subprocess-free). **Without `--repo-root` the pre-filter is inert and every pair is eligible** (documented property). Eligibility memoised per path; each ineligible path recorded once in `marker_conflicts` as `{"task": "", "edge": "<path>", "note": "<reason — pairs kept serialized>", "kind": "inference"}` (the `type_conflicts` `task:""` precedent keeps the `(task, edge)` dedupe unique per path).

- [ ] **Step 1: Write the failing tests**

`tests/test_compile_prefilter.py` — reuse the inline-plan-authoring helper pattern from Task 5's test file (copy the helper; do not import across test files). Build a `tmp_path` root with: `big.py` (RESOLVER_LINE_CAP+50 lines), `bin.dat` (null bytes), `link.py` (symlink), `ok.py` (10 lines):

```python
def test_prefilter_keeps_edges_for_ineligible_paths_with_inference_records(tmp_path):
    # plan: t1,t2 both Modify big.py; t3,t4 both Modify ok.py.
    # fold + --repo-root: t1-t2 edge SURVIVES (write-after-write), t3-t4
    # drops; marker_conflicts contains exactly ONE kind=="inference" entry
    # whose edge field is "big.py" and task field is "" (memoised per path,
    # deterministic count).

def test_prefilter_covers_reads_paths(tmp_path):
    # t1,t2 disjoint writes, shared "- Test: tests/big_test.py" where that
    # file exists at root and is over-cap: edge survives (full overlap set,
    # not writes∩writes).

def test_binary_and_symlink_paths_keep_edges(tmp_path): ...

def test_exact_cap_boundary_counts_via_split_lines(tmp_path):
    # a file whose split_lines length is exactly RESOLVER_LINE_CAP is
    # ELIGIBLE; one more line is not. (splitlines() would disagree by one.)

def test_without_repo_root_prefilter_is_inert(tmp_path):
    # same big.py plan compiled WITHOUT --repo-root: the pair drops (every
    # pair eligible; documented property — runtime predicate authoritative).

def test_serialize_mode_untouched_by_prefilter_flags(tmp_path):
    # --overlap serialize --repo-root <root>: byte-identical to plain
    # serialize output (the pre-filter only ever runs in fold mode).
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_compile_prefilter.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Kernel import at module top with a path bootstrap relative to `__file__` (`skills/ultrapowers/scripts` → `../kernel`); memoised `_path_eligibility(root) -> dict[str, tuple[bool, str]]` computed lazily per path (read bytes; null byte ⇒ non-text; decode utf-8 with `errors="replace"` then `len(split_lines(text))` vs cap; `Path.is_symlink()` first). `eligible(a, b)` consults the memo over `(writes(a)|reads(a)) | (writes(b)|reads(b))` intersected paths existing under the root. Emit one `inference` record per ineligible path via the existing `add_conflict` (fields per Interfaces). Add the two conditional sentences to `dependency-analysis.md` (rule 3 and the reads bullet): under `--overlap fold` an eligible same-file pair is scheduled concurrently and folded, runtime predicate authoritative.

- [ ] **Step 4: Run to verify pass; re-verify byte-identity; full suite**

Run: `python3 -m pytest tests/test_compile_prefilter.py tests/test_compile_overlap.py -v && python3 -m pytest`
Expected: PASS (the Task 5 byte-identity test re-runs and must stay green).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py skills/ultrapowers/references/dependency-analysis.md tests/test_compile_prefilter.py
git commit -m "feat(compiler): --repo-root eligibility pre-filter — hermetic, memoised per path, inert without root, existing inference vocabulary"
```

---

### Task 7: Plumbing and docs — `ultra_run.py` forwarding, `validate_skill.py` kernel regex, SKILL.md

**Type:** implementation
**Depends-on:** 2, 5

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrapowers/scripts/validate_skill.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_ultra_run_overlap.py`

**Interfaces:**
- Consumes: `--overlap` / `--repo-root` argv (Tasks 5–6); `kernel/FOLD_LOG.md` (Task 2, the link target).
- Produces: `ultra_run.py` accepts `--overlap {serialize,fold}` and forwards it onto the `compile_plan.py` argv it builds, **always** stamping `--repo-root <root>` from its existing repo root; the receipt continues to embed the full compile object (no new receipt field — arm identity derives from it). `validate_skill.py`'s link-check regex alternation gains `kernel` (`references|scripts|kernel`). `SKILL.md`: Step 1 documents the optional `overlap=serialize|fold` launch argument (operator-facing home); the engine section references `kernel/FOLD_LOG.md` (making the extended link check live); Step 3's mode/degrade rendering wording matches the Task 5 recomputation.

- [ ] **Step 1: Write the failing tests**

`tests/test_ultra_run_overlap.py`:

```python
def test_ultra_run_builds_compile_argv_with_overlap_and_repo_root(tmp_path):
    # call the argv-construction seam (extract it as a pure helper if it is
    # inline today: `compile_argv(plan, run_dir, root, overlap)`), assert
    # "--overlap","fold" present when passed, absent->serialize default not
    # injected (compiler default governs), and "--repo-root",str(root)
    # always present.

def test_validate_skill_checks_kernel_links(tmp_path):
    # a SKILL.md body naming kernel/FOLD_LOG.md with the file present passes;
    # with the file absent fails — proving the regex extension is live.

def test_skill_md_references_fold_log():
    text = Path("skills/ultrapowers/SKILL.md").read_text()
    assert "kernel/FOLD_LOG.md" in text
```

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_ultra_run_overlap.py -v` → FAIL.

- [ ] **Step 3: Implement** — thread the argument through `ultra_run.py` (extract `compile_argv()` if needed so the test has a pure seam); one-token regex change in `validate_skill.py:26`; the three SKILL.md edits (keep Step 1's invocation line format; the `overlap` argument documented next to the existing launch knobs; a one-line pointer in the engine section: "Contended-wave fold state and replay contract: `kernel/FOLD_LOG.md`").

- [ ] **Step 4: Verify** — `python3 -m pytest tests/test_ultra_run_overlap.py -v && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 -m pytest` → PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_run.py skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers/SKILL.md tests/test_ultra_run_overlap.py
git commit -m "feat(plumbing): --overlap launch forwarding + --repo-root stamp; validate_skill kernel links; SKILL.md docs"
```

---

### Task 8: Shadow line — two-leg octopus probe + eval serialize re-points

**Type:** implementation
**Depends-on:** 5

**Files:**
- Modify: `evals/frontier/shadow_fold.py`
- Modify: `evals/frontier/run_eval.py`
- Modify: `evals/run_frontier_cell.py`
- Test: `tests/test_shadow_octopus.py`
- Test: `tests/test_frontier_run_eval.py`

**Interfaces:**
- Consumes: `--overlap serialize` argv (Task 5).
- Produces: `shadow_fold._build_waves` marks any merged wave head with ≥3 parents `disposition: "excluded"` (reason string `octopus adoption commit (N parents) — fold log is the replay record`) **before** the group/trailing/absorbed dispatch; `_shadow`'s no-floor branch sets that same octopus reason instead of `NO_PER_TASK_MERGES_REASON` when **any** merged head has ≥3 parents (no head ≥3 keeps the merge-free name). `run_eval.compile_fixture`, `shadow_fold._remodel` (its only compiler shell-out), and `run_frontier_cell`'s compile all pass `--overlap serialize` (pre-drop edge set; keeps `same_file_edges` non-circular).

- [ ] **Step 1: Write the failing tests**

`tests/test_shadow_octopus.py` — build tiny `tmp_path` git repos shaping integration chains (commit helpers in-file):

```python
def test_mixed_run_contended_wave_first_gets_per_wave_excluded_row(tmp_path):
    # chain: base -> octopus O (3 parents) -> ordinary 2-parent merge M.
    # _find_floor finds M -> merge-base flow; _build_waves output: O's row
    # disposition == "excluded" with "octopus" in the reason (NOT "absorbed"),
    # M's wave shadows normally.

def test_modal_shape_octopus_plus_fastforward_uses_octopus_whole_run_reason(tmp_path):
    # chain: base -> octopus O -> single-parent (fast-forwarded) head H.
    # no 2-parent merge anywhere -> no-floor branch; excluded reason contains
    # "octopus", NOT the no-per-task-merges string (any-head predicate).

def test_merge_free_run_keeps_existing_name(tmp_path):
    # chain of single-parent commits only -> excluded reason is exactly
    # run_eval/shadow_fold's existing NO_PER_TASK_MERGES_REASON.
```

Extend `tests/test_frontier_run_eval.py`: keep the existing contend assertions but point `compile_fixture` at the serialize compile; add the fold-leg assertion:

```python
def test_contend_fixture_contention_under_both_compiles():
    ser = run_eval.compile_fixture("contend")                       # now --overlap serialize
    waw = [e for e in ser["dag_edges"] if e["why"] == "write-after-write"]
    assert ser["mode"] == "parallel" and len(waw) >= 2
    fold = run_eval.compile_fixture("contend", overlap="fold")      # new kwarg
    assert not [e for e in fold["dag_edges"] if e["why"] == "write-after-write"]
    waves = fold["launch_waves"]
    assert any(sum(1 for t in w if set(t["files"]) & u) >= 2
               for w in waves
               for u in [set().union(*[set(t2["files"]) for t2 in w]) - set()]
               ) or _some_wave_has_two_tasks_with_intersecting_files(waves)
```

(Write `_some_wave_has_two_tasks_with_intersecting_files(waves)` as a plain helper — pairwise intersection over each wave's task `files`; use it alone if the inline comprehension reads poorly.)

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_shadow_octopus.py tests/test_frontier_run_eval.py -v` → FAIL.

- [ ] **Step 3: Implement** — the per-wave probe first in `_build_waves`'s per-wave dispatch (parent count via the existing parent-reading helper); the whole-run leg inside `_shadow`'s existing `else` arm (`merged` and `repo` are in scope there): `any(len(_commit_parents(repo, w["headSha"])) >= 3 for w in merged)` selects the octopus reason. Add `overlap="serialize"` parameter to `compile_fixture` (default serialize, explicit `--overlap` on the argv either way); `_remodel` and `run_frontier_cell.compile_in` gain the explicit `--overlap serialize` argv token.

- [ ] **Step 4: Verify** — `python3 -m pytest tests/test_shadow_octopus.py tests/test_frontier_run_eval.py -v && python3 -m pytest` → PASS.

- [ ] **Step 5: Commit**

```bash
git add evals/frontier/shadow_fold.py evals/frontier/run_eval.py evals/run_frontier_cell.py tests/test_shadow_octopus.py tests/test_frontier_run_eval.py
git commit -m "feat(shadow): two-leg octopus probe (per-wave excluded row; any-head whole-run reason); eval entry points compile --overlap serialize"
```

---

### Task 9: Engine — the contended merge path in `waves.js`

**Type:** implementation
**Depends-on:** 4
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `tests/test_no_prompt_drift.py`
- Test: `tests/test_report_runbook.py`

**Interfaces:**
- Consumes: the `fold_wave.py` CLI contract — argv shapes, file layout, stdout JSON, exit codes (Tasks 3–4); the inline task `files` field (already emitted by the compiler today).
- Produces: the contended branch of `mergeWave(results, waveIdx)`: routing rule (three conjuncts — `!resume`; live wave base: a module-scope `waveBaseLive` boolean set false in the existing `MERGED`-without-`headSha` branch, checked here; ≥2 mergeable results whose `WAVES[waveIdx]` entries, joined by `r.task === t.id`, have pairwise-intersecting `files`); `FOLD_SCHEMA` (`{status: enum ['FOLDED','CONFLICTS','PARKED','ERROR'], counts..., detail}` — small scalars; the **adoption** reply reuses `MERGE_SCHEMA`'s `MERGED` + `headSha` shape so existing call-site handling is unchanged); two new contiguous BAKE blocks in `wave-merge.md` — `BAKE:CONTENDED_MERGE_PROMPT` (carries the `heads/` slot-recording sentence verbatim from the merge contract; locates the CLI via `<pluginRoot>`; interpolates `waveBaseSha` as fold base and `<prevHead>`; spells the exact git sequence: `git read-tree -u --reset <candidate>^{tree}` → suite → green: `git reset --hard <candidate>` + slots; red: `git reset --hard <prevHead>` + `git clean -fd`) and `BAKE:RESOLVER_PROMPT` (file-read contract; accepts annotated AND markerless narration shapes; whole-file reply to a reply file); the serial resolver loop (per-conflict `budgetExhausted()` checkpoint; dispatch options `{ label, schema }` with `model` **omitted** — live-verify this shape against the real runtime before finishing the task and record the result as a dated comment beside the dispatch, matching the file's existing verified-live note style; if omission is rejected, dispatch at `TIER.standard` and update §6-facing honesty text per the spec's pre-stated fallback); contended dispatch at `TIER.mostCapable`; contended `catch` → fallback to the git-merge path, never reconcile; `report.json` gains the per-contended-wave `frontier` section (foldLogPath, conflictsIndex, selfChecks, foldCliWallTimeSec, resolverTranscripts) — mirrored in `report-format.md`. `test_no_prompt_drift.py`'s wave parametrization derives from `wave-merge.md`'s BAKE blocks **plus** the known-names floor (`assert set(KNOWN) <= set(wave_blocks())`); `test_report_runbook.py` gains the frontier-field assertion (every field the section emits appears in `report-format.md`, the `reviewVerdict`-literals shape).

- [ ] **Step 1: Author the two BAKE blocks in `wave-merge.md`**

Write `BAKE:CONTENDED_MERGE_PROMPT` and `BAKE:RESOLVER_PROMPT` as complete prompt texts per Interfaces (start `CONTENDED_MERGE_PROMPT` from `MERGE_PROMPT`'s opening integration-branch verification sentences and the verbatim slot-recording sentence; the resolver prompt is rewritten from the retired `evals/frontier/references/resolver-prompt.md` content for the file-read + both-shapes contract — then delete that file, its home moved here per the spec).

- [ ] **Step 2: Update the prompt-pin tests (failing first)**

In `tests/test_no_prompt_drift.py`: replace the hardcoded `WAVE_PROMPTS` list with `sorted(wave_blocks())` derivation **plus** `KNOWN = {...six existing names...}` and `assert KNOWN <= set(wave_blocks())`; run — the two new blocks now parametrize and FAIL (no baked consts yet). In `tests/test_report_runbook.py`: add the frontier-fields assertion listing exactly the five field names from Interfaces; FAIL (report-format.md lacks them).

- [ ] **Step 3: Implement in `waves.js`**

Bake both consts; add `FOLD_SCHEMA`; add `let waveBaseLive = true` beside `waveBaseSha` and set it `false` inside the existing `MERGED`-without-`headSha` branch; implement the contended branch inside `mergeWave` per Interfaces (fold dispatch → per-conflict serial resolver loop with budget checkpoint and one re-narration → materialize+adopt dispatch replying `MERGED`+`headSha`); every failure path (`ERROR` status, park, thrown dispatch, budget exhaustion, candidate suite failure reported by the agent) falls through to the existing plain-merge dispatch code path with a `judgmentCalls` entry naming the fallback reason; assemble the `frontier` report section from the dispatch replies' scalars. Update `report-format.md` with the section's five fields.

- [ ] **Step 4: Live-verify the model-omitted dispatch shape**

From a scratch Dynamic Workflow (or the smallest driveable harness invocation available), dispatch one trivial agent with `{ label, schema }` and no `model`; record the outcome as a dated comment beside the resolver dispatch (the file's existing note style). If rejected: switch the dispatch to `TIER.standard` and note it — the spec pre-states this branch.

- [ ] **Step 5: Verify pins and suite**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_report_runbook.py -v && python3 -m pytest`
Expected: PASS. (`node tests/frontier_merge.mjs` does not exist yet — Task 10 covers the harness sim; the suite-gate will require it before this branch can pass `--suite-gate`, which is why Task 10 depends on this one and precedes the gate.)

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/references/wave-merge.md skills/ultrapowers/references/report-format.md tests/test_no_prompt_drift.py tests/test_report_runbook.py
git rm -r evals/frontier/references
git commit -m "feat(engine): contended merge path — derived contention (3 conjuncts), FOLD_SCHEMA, baked contended+resolver prompts, serial resolver loop, candidate adoption, frontier report section"
```

---

### Task 10: Harness sim — `tests/frontier_merge.mjs`

**Type:** implementation
**Depends-on:** 9

**Files:**
- Create: `tests/frontier_merge.mjs`

**Interfaces:**
- Consumes: the contended branch, `FOLD_SCHEMA`, prompt consts, routing rule, and report section (Task 9); the sim-harness pattern of `tests/sim_workflow.mjs` (stubbed `agent(prompt, opts)` captured per label).
- Produces: a node sim that drives `waves.js`'s contended path through stubbed agents across these scenarios, asserting per scenario and printing the sentinel line `ALL SCENARIOS PASSED` on success (exit non-zero otherwise): (1) clean fold → adoption replies `MERGED`+`headSha`, `heads/` slot names for every merged task id present in the contended dispatch text, `frontier` report section populated; (2) conflict → resolver → resolve → adopt, resolver dispatch options assert `label` + `schema` present and `model` absent (or `TIER.standard` per Task 9's live-verify outcome — assert whichever shipped); (3) stale → markerless re-narration → resolve; (4) park → fallback to plain merge with a named `judgmentCalls` entry; (5) budget exhaustion mid-resolver-loop → fallback; (6) thrown contended dispatch → fallback, never reconcile; (7) candidate-suite-failure reply → fallback; (8) routing: two tagged-shape tasks from *disjoint* dropped pairs (no pairwise `files` intersection) do NOT route contended; a lone mergeable survivor does NOT route; `resume: true` launch does NOT route; a prior wave's `MERGED`-without-`headSha` (frozen base) routes the next contended-shaped wave to plain merge.

- [ ] **Step 1: Write the sim** — follow `tests/sim_workflow.mjs`'s loader/stub structure (read it first; reuse its harness-loading approach, not its scenarios). Each scenario builds its own ARGS (waves with `files` on task entries) and stub replies; assertions per Interfaces; final line `console.log("ALL SCENARIOS PASSED")` only if every scenario held.

- [ ] **Step 2: Run it** — `node tests/frontier_merge.mjs` → sentinel printed, exit 0. Fix `waves.js` (not the sim) where behavior and spec disagree.

- [ ] **Step 3: Verify the suite-gate wiring** — `bash skills/ultrapowers/scripts/run_acceptance.sh --suite-gate --base HEAD~3` (any base ref that includes the Task 9 harness change) discovers the sim via its `harnesses/` reference and gates on the sentinel. Expected: the gate runs it and reports green.

- [ ] **Step 4: Commit**

```bash
git add tests/frontier_merge.mjs
git commit -m "test(engine): frontier_merge harness sim — 8 contended-path scenarios, suite-gate sentinel"
```

---

### Task 11: The `contend-prod` fixture (sealed) 

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/fixtures/contend-prod/plan.md`
- Create: `evals/fixtures/contend-prod/project/`
- Create: `evals/fixtures/contend-prod/acceptance/`
- Modify: `tests/test_fixture_seals.py`

**Interfaces:**
- Consumes: nothing from other tasks (fixture content is engine-independent).
- Produces: a production-length contended fixture: 4 independent implementation tasks, each a real multi-file feature with tests, all four modifying one shared hot file of < `RESOLVER_LINE_CAP` visible lines; `plan.md` marked per ultraplan grammar with `**Acceptance:** sealed <first-12-hex> (sha256:<hash>)` matching the `acceptance/` suite (the committed convention `test_fixture_seals.py` pins for its `FIXTURES`); `contend-prod` added to the `FIXTURES` list.

- [ ] **Step 1: Author the project** — a small but real Python web-ish service under `project/` (an HTTP-less request-router + storage module + report renderer is enough — ~8 files, a pytest suite, a `README`): the hot file is `project/app/registry.py` (~200 lines: route table + plugin registration + config defaults) which every feature must extend. Features (one task each): (1) input-validation layer + its config block; (2) an export/report formatter + registry entry; (3) a rate-limit/quota module + registry hooks; (4) an audit-log module + registry hooks. Each feature = its own new module + tests + a `registry.py` modification. Size each task's prescribed work so a competent implementer needs ≥5 minutes (multi-file, ~10+ tests, real edge cases in the task body) — Task 13 (calibration) verifies the floors empirically and resizes if missed.
- [ ] **Step 2: Author `plan.md`** — ultraplan markers, `Depends-on: none` on all four (genuinely independent; the same-file overlap on `registry.py` is the point), full TDD step bodies per fixture convention (mirror `evals/fixtures/contend/plan.md`'s structure at larger scale).
- [ ] **Step 3: Author the sealed acceptance suite** — write `acceptance/` tests from the plan's *behavioral claims only* (exam style: black-box over the four features' documented behaviors + the composed registry), then compute and record the seal per the existing convention: `python3 skills/ultrapowers/scripts/seal_hash.py evals/fixtures/contend-prod/acceptance` (read the sibling fixtures' plan.md Acceptance lines for the exact format) and write the `**Acceptance:** sealed ...` line into `plan.md`.
- [ ] **Step 4: Add to `FIXTURES`** in `tests/test_fixture_seals.py`; run `python3 -m pytest tests/test_fixture_seals.py -v` → PASS.
- [ ] **Step 5: Compile-check the fixture plan** — `python3 skills/ultrapowers/scripts/compile_plan.py --check evals/fixtures/contend-prod/plan.md` → `PLAN OK`.
- [ ] **Step 6: Commit**

```bash
git add evals/fixtures/contend-prod tests/test_fixture_seals.py
git commit -m "feat(evals): contend-prod fixture — 4 production-length contended tasks, sealed acceptance, FIXTURES entry"
```

---

### Task 12: `ab_runner.py` — arm dimension + receipt-derived identity gate

**Type:** implementation
**Depends-on:** 5, 7

**Files:**
- Modify: `evals/ab_runner.py`
- Test: `tests/test_ab_arm_identity.py`

**Interfaces:**
- Consumes: the `overlap` launch argument (Task 7's plumbing; the flag name from Task 5); `receipt.json`'s embedded `compile` object (existing).
- Produces: an `--arm-overlap {serialize,fold}` flag threaded into `DRIVE_PROMPT` (the `/ultrapowers` launch line gains `overlap=<mode>`) and `build_run_plan`; after each cell, `assert_arm_identity(receipt: dict, arm_overlap: str) -> tuple[bool, str]` — serialize: ≥2 `dag_edges` with `why == "write-after-write"` on the fixture; fold: zero such edges AND ≥2 tasks sharing a `launch_waves` wave with pairwise-intersecting `files` AND (route-away leg, run-dir side) `frontier/wave-<n>/` present for every contended-shaped wave; a failed identity **still appends its row** marked `"invalid": "arm-identity: <detail>"` (so `--rerun-of` has a row to supersede); harvest rows gain `armOverlap` and `identity` fields.

- [ ] **Step 1: Write the failing tests** — `tests/test_ab_arm_identity.py` drives `assert_arm_identity` as a pure function over hand-built receipt dicts + a `tmp_path` run dir (present/absent `frontier/wave-1/`): serialize-pass, serialize-fail (edges dropped), fold-pass, fold-fail-edges-present, fold-fail-route-away (contended-shaped wave, no frontier dir). Run → FAIL.
- [ ] **Step 2: Implement** — the pure function + the threading (flag → `DRIVE_PROMPT.format` gains the `overlap=` token → `build_run_plan` carries it → post-cell assertion → row fields; invalid rows appended, never dropped).
- [ ] **Step 3: Verify** — `python3 -m pytest tests/test_ab_arm_identity.py -v && python3 -m pytest` → PASS.
- [ ] **Step 4: Commit**

```bash
git add evals/ab_runner.py tests/test_ab_arm_identity.py
git commit -m "feat(evals): ab_runner arm dimension — overlap flag threading, receipt-derived identity + route-away check, invalid rows appended"
```

---

### Task 13: Gate — full suite + harness sims green

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12

**Files:**
- Test: `tests/`

Run `python3 -m pytest` (everything above green, including the byte-identity, bijection, rehydrate, materialize, pre-filter, shadow, prompt-pin, seal, and arm-identity suites) and `node tests/frontier_merge.mjs` (sentinel). `bash skills/ultrapowers/scripts/run_acceptance.sh --suite-gate --base <branch-base>` passes with the new sim discovered.

---

### Task 14: Calibration run (fixture floors)

**Type:** manual
**Depends-on:** 13

Operator-driven, per spec §6: run **arm A** once on `contend-prod` (`ab_runner` with `--arm-overlap serialize`, full protocol). Verify the pre-registered floors: every implementer ≥ 5 minutes wall clock, arm A end-to-end ≥ 30 minutes. If a floor is missed, resize the fixture's task bodies (Task 11's files) and re-run calibration before any counted cell. Record the calibration reading (not a counted cell) in `evals/frontier/results/`.

---

### Task 15: The A/B cells + adjudication

**Type:** manual
**Depends-on:** 14

Per spec §6, exactly: **n = 1 pair**, arms sequential on one machine, same engine ref. Arm A `--arm-overlap serialize`, arm B `--arm-overlap fold`. Hard gates (non-overrulable): arm identity from `receipt.json`'s compile object; both arms' gates green; arm B fold-log self-checks clean; zero fallbacks on contended waves in arm B; every contended-shaped wave in arm B actually took the fold path (no route-away); zero silent divergence; every park named. E1′: arm B wall clock ≤ 0.7× arm A. E2′: arm B output tokens ≤ 1.25× arm A + operator grades any live resolutions from the verbatim transcripts. Only E1′/E2′ may be overruled, with recorded reasoning. Results doc in `evals/frontier/results/` carries the honesty bounds (n=1 directional; width-4; first live observation of the bijective convention). **Pass** → the §5 follow-up (default flip + relaxation + rubric + shakedown) proceeds as its own effort, then release. **Miss** → Task 16 releases the branch as-is (dark) with the result recorded.

---

### Task 16: Release (dark)

**Type:** release
**Depends-on:** 15

Minor bump (architectural): set the same new version in **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`; commit `chore(release): 0.2.0 — frontier mode in the shipping engine (dark: --overlap serialize default)` on `main`; push. The verification periphery is untouched; the release ships `OVERLAP_DEFAULT = "serialize"` regardless of the A/B outcome (a pass adds the §5 follow-up BEFORE this release per spec §6; a miss releases exactly this branch).

---

## Self-review (writing-plans + ultraplan checklists)

- **Spec coverage:** §Where-it-lives moves → T1; bijection/rehydrate/FOLD_LOG → T2; fold CLI → T3/T4; §1 compiler → T5/T6; plumbing/validate/SKILL docs → T7; shadow/eval → T8; §3 engine + §4 report + prompt pins → T9; sim → T10; §6 fixture+seal → T11; ab_runner → T12; gates/calibration/cells/release → T13–T16. §5 deliberately absent (pass-branch follow-up, spec §5). K3 disclosure needs no code (spec §Where it lives).
- **Placeholders:** the `...` bodies in T2/T3 test listings are accompanied by concrete comment specifications of inputs and assertions in place — implementers write the bodies from those lines plus in-file helpers; no TBDs remain.
- **Type consistency:** `rehydrate(repo, log_path)` (T2) is what T3/T4's CLI and tests call; `RESOLVER_LINE_CAP`/`split_lines` names match T6's imports; `--overlap`/`--repo-root`/`OVERLAP_DEFAULT` spelling consistent across T5/T6/T7/T8/T12; `FOLD_SCHEMA`/prompt-const names consistent T9/T10.
- **Ultraplan:** every task carries `**Type:**`/`**Depends-on:**`; same-file chains declared (1→2→3→4 kernel files; 5→6 compiler; 9→10 by interface+test-import); no prose-ordering; no branch instructions; tmp_path isolation throughout; architectural moves carry rationale lines; Acceptance line present (suite).
