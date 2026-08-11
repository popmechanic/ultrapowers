# Frontier Production Test (shadow fold + live contended A/B) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the manyana production-test instruments per spec `docs/superpowers/specs/2026-08-11-frontier-production-test-design.md`: the #132 reporting fix, a shadow-fold tool that re-merges finished real runs, a frontier fold engine with an AI resolver, and the arm-B live-cell driver — leaving the two live stages as operator-run deliverables.

**Architecture:** Everything lives in `evals/frontier/` + `tests/`. Component 1 narrows #132 to its recorded candidates (set-based comparison + presentation nits). `shadow_fold.py` is a thin front-end over `run_eval`'s existing replay internals. `frontier_fold.py` is a pure fold/event-log/resolution state machine; `run_frontier_cell.py` wires it to the A/B kit's `prepare_cell` and headless implementers.

**Tech Stack:** Python 3 stdlib, git, pytest; LLM work rides headless Claude Code (`claude -p`, the kit's pattern) — no Anthropic SDK, no API key.

**Acceptance:** suite — dev tooling in `evals/frontier/` and `tests/`; the live cells are runtime deliverables, like every eval run (spec §Acceptance).

## Global Constraints

- Only `evals/` and `tests/` change. No `skills/` file, no frozen-periphery script, no CI config, no plugin version bump, no harness JS (so the suite-gate JS guard stays unarmed by construction).
- No Anthropic SDK or `ANTHROPIC_API_KEY` anywhere — LLM calls go through headless Claude Code exactly as `evals/ab_runner.py` does.
- The #132 fix stays inside the issue's recorded candidates: **set-based comparison** (never an accumulation-site dedupe), the two presentation nits, both seed sets as regressions. Exact-count expectations that are order-independent by construction are **preserved as single-canonical-order assertions**, never dropped.
- The edge-drop rule is `schedule_model.drop_same_file_edges` / `SAME_FILE_WHYS`, **imported, never re-typed**.
- Shadow head source is `<run-dir>/report.json` only (plus `--report` override); the fail-loud sha-resolution + ancestry check is the authority, filename is not provenance; every unshadowable shape **parks by name** — never a silent fragment.
- Resolver contract: whole-file in / whole-file out (`resolvedFileLines`), no tools/repo/shell, dispatch only on conflicts carrying manyana's annotated block narration, ≤400 visible lines (else park), one retry then park, **serial dispatch** (at most one in flight), and the **application-validity rule**: a resolution applies only if no intervening fold touched its path since the narration.
- Same-wave tasks run suites concurrently on one machine: tests use `tmp_path` only, no shared on-disk fixtures, no fixed ports.
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: #132 — set-based conflict comparison + presentation nits + seed regressions

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `evals/frontier/run_eval.py:265-266`
- Modify: `evals/frontier/repo_weave.py:262-296`
- Modify: `tests/test_frontier_weave.py:40-62,315-322,460-`
- Test: `tests/test_repo_weave_report_determinism.py`

**Interfaces:**
- Consumes: nothing (first-wave task; existing `repo_weave` API).
- Produces: `conflict_keys(conflicts) -> list` now returns the **sorted set** of `(path, kind)` pairs (both in the eval runner and the test helper); `_fold_presence(base, frontier, task, files, candidates, deleted_marks, conflicts)` gains a leading `base` parameter (its only caller is `fold`, updated in the same task).

- [ ] **Step 1: Write the failing regression tests**

Create `tests/test_repo_weave_report_determinism.py`:

```python
"""#132 regressions. The merge itself was always order-independent (manifests
and conflict SETS: 0/400 fuzz divergence); only the reporting shape flipped:
the multiset at 3+ writers x 2+ regions (12/400) and, pre-`_text_kind`, the
delete/modify kind label (29/500). Fix = the issue's recorded candidates:
set-based comparison + presentation nits. Seed sets are the contract."""
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
sys.path.insert(0, str(ROOT / "tests"))
import repo_weave as rw
from test_frontier_weave import (make_base, fold_in_order, conflict_keys,
                                 assert_order_independent)


def _region_fn(name, body_note):
    return ["def %s(x):" % name, "    # %s" % body_note, "    return x", ""]


def _multiset_case(seed):
    """3 text writers, each editing 2 distinct regions of one path."""
    rng = random.Random(seed)
    regions = [_region_fn("fn_%d" % i, "base") for i in range(6)]
    base = make_base({"hot.py": "\n".join(sum(regions, []))})
    tasks = []
    for t in range(3):
        picks = rng.sample(range(6), 2)
        edited = [list(r) for r in regions]
        for i in picks:
            edited[i] = _region_fn("fn_%d" % i, "edit by t%d" % t)
        tasks.append(rw.task_state_from_contents(
            base, "t%d" % t, {"hot.py": "\n".join(sum(edited, []))}))
    return base, tasks


def test_multiset_seed_set_is_order_independent_under_set_comparison():
    # The 12/400 class: any seed must yield ONE outcome under set comparison.
    for seed in range(400):
        base, tasks = _multiset_case(seed)
        assert_order_independent(base, tasks)


def test_delete_modify_kind_labels_are_order_independent():
    # The 29/500 class: {delete, editA, editB} on one path. Expected to pass
    # against the committed base-derived _text_kind; a failure here means a
    # frontier-derived relabel crept back in (the order-sensitive move the
    # repo_weave docstring warns against).
    lines = ["def keep(x):", "    return x", "", "def gone(y):", "    return y", ""]
    for seed in range(500):
        rng = random.Random(seed)
        base = make_base({"mix.py": "\n".join(lines)})
        edit_a = list(lines); edit_a[1] = "    return x + %d" % rng.randrange(9)
        edit_b = list(lines); edit_b[4] = "    return y * %d" % rng.randrange(9)
        tasks = [rw.task_state_from_contents(base, "del", {}),  # whole-file delete
                 rw.task_state_from_contents(base, "ta", {"mix.py": "\n".join(edit_a)}),
                 rw.task_state_from_contents(base, "tb", {"mix.py": "\n".join(edit_b)})]
        tasks[0].deleted.add("mix.py") if hasattr(tasks[0].deleted, "add") else None
        assert_order_independent(base, tasks)


def test_lone_type_change_reports_no_conflict():
    # Presentation nit 1: a single task rewriting a base TEXT file as binary is
    # a type change by one writer — git reports no conflict, neither do we.
    base = make_base({"doc.txt": "hello\n"})
    t = rw.task_state_from_contents(base, "t1", {"doc.txt": b"\x00\x01"})
    frontier, conflicts = rw.fold(base, base, t)
    assert conflicts == []
    assert rw.manifest(frontier)["doc.txt"] == b"\x00\x01"


def test_concurrent_text_edit_and_binary_write_still_conflicts():
    # The genuine two-writer collision keeps its conflict.
    base = make_base({"doc.txt": "hello\n"})
    t_text = rw.task_state_from_contents(base, "t1", {"doc.txt": "hello world\n"})
    t_bin = rw.task_state_from_contents(base, "t2", {"doc.txt": b"\x00\x01"})
    _, keys = assert_order_independent(base, [t_text, t_bin])
    assert ("doc.txt", "binary") in keys


def test_binary_narration_names_the_actual_manifest_winner():
    # Presentation nit 2: when the text side is a folded whole-file delete,
    # bytes win the manifest — the narration must not claim text wins.
    base = make_base({"doc.txt": "hello\n"})
    t_del = rw.task_state_from_contents(base, "t1", {})
    t_del.deleted.add("doc.txt") if hasattr(t_del.deleted, "add") else None
    t_bin = rw.task_state_from_contents(base, "t2", {"doc.txt": b"\x00\x01"})
    for order in ([0, 1], [1, 0]):
        frontier, conflicts = fold_in_order(base, [t_del, t_bin], order)
        manifest = rw.manifest(frontier)
        for c in conflicts:
            if c.kind == "binary" and "text wins" in c.narration:
                assert isinstance(manifest.get("doc.txt"), str), \
                    "narration claims text wins but bytes won: %r" % c.narration
```

Note on the two `deleted.add(...)` lines: check `task_state_from_contents`'s real
delete convention first (a task whose `contents` omit a base path may already
record the delete). If deletion is derived from omission, drop those lines; if
`TaskState.deleted` is a frozenset, construct the delete the way
`tests/test_frontier_weave.py`'s existing delete tests do (copy their exact
idiom — `test_two_text_writers_and_a_deleter_is_order_independent` contains
one). The test's assertion targets are the contract; the construction idiom
follows the existing test file.

- [ ] **Step 2: Run the new tests to verify current failures**

Run: `python3 -m pytest tests/test_repo_weave_report_determinism.py -x -q`
Expected: `test_multiset_seed_set_...` FAILS on some seed (duplicate `(path, 'lines')`
entries flip the multiset — the 12/400 class) or, if every sampled seed passes,
tighten `_multiset_case` to 3 regions per writer until one fails — the committed
seed set must demonstrably pin the defect. `test_lone_type_change_...` and
`test_binary_narration_...` FAIL (today's `_fold_presence` reports the lone type
change and always says "text wins"). `test_delete_modify_kind_labels...` PASSES
(already fixed on main — keep it as the regression pin).

- [ ] **Step 3: Make the comparison set-based (both sites)**

In `evals/frontier/run_eval.py` replace `conflict_keys`:

```python
def conflict_keys(conflicts):
    """Order-comparison key: the SET of (path, kind) — Conflict's declared
    identity (#132). fold's per-call return is untouched; consumers of the
    per-fold stream (narrations, the arm-B driver) see every conflict."""
    return sorted(set((c.path, c.kind) for c in conflicts))
```

In `tests/test_frontier_weave.py` make the helper identical (same body, same
docstring), and update `assert_order_independent`'s docstring line
"manifest and conflict multiset must agree" → "manifest and conflict set must
agree".

- [ ] **Step 4: Preserve the exact-count pins as single-canonical-order assertions**

In `tests/test_frontier_weave.py`, `test_binary_conflict_count_is_distinct_candidates_minus_one`
currently pins the count via `assert_order_independent(..., expected_conflicts=[("img.bin", "binary")] * 2)`,
which the set-based helper would collapse. Rework it to assert order-independence
and the count separately:

```python
def test_binary_conflict_count_is_distinct_candidates_minus_one():
    base = make_base({"img.bin": b"\x00\x01"})
    tasks = [rw.task_state_from_contents(base, "t%d" % i, {"img.bin": b})
             for i, b in enumerate((b"\x00\x09", b"\x00\x08", b"\x00\x07"))]
    assert_order_independent(base, tasks,
                             expected_manifest={"img.bin": b"\x00\x07"},
                             expected_conflicts=[("img.bin", "binary")])
    # The count invariant (len(candidates) - 1) is order-independent by
    # construction; pin it on ONE canonical order (#132 keeps this pin).
    _, conflicts = fold_in_order(base, tasks, [0, 1, 2])
    assert [(c.path, c.kind) for c in conflicts] == [("img.bin", "binary")] * 2
```

Apply the same split to any other test that passes a duplicated
`expected_conflicts` list (grep for `] * 2` / `] * 3` in the file; rework each
the same way: deduped list to `assert_order_independent`, exact count via one
`fold_in_order` on the canonical order `[0, 1, ...]`).

- [ ] **Step 5: Fix the two presentation nits**

In `evals/frontier/repo_weave.py`, change `_fold_presence` to take `base` and
use it in the binary branch; `fold` passes it through:

```python
def _fold_presence(base, frontier, task, files, candidates, deleted_marks, conflicts):
    """One conflict per path whose incompatible presence records first pair up.
    ... (keep the existing docstring paragraph) ...
    A lone type change is NOT a pairing: when the surviving text weave is the
    base's own (no task ever text-edited the path), a byte write is one
    writer changing the file's type — git reports no conflict there (#132).
    """
    touched = set(task.weaves) | set(task.raw) | set(task.deleted)
    for p in sorted(touched):
        was_text, was_visible, had_bytes, was_deleted = _pairing_facts(
            frontier.files, frontier.raw_candidates, frontier.deleted_marks, p)
        is_text, visible, has_bytes, deleted = _pairing_facts(
            files, candidates, deleted_marks, p)
        text_is_task_authored = files.get(p) is not base.files.get(p)
        if (is_text and has_bytes and not (was_text and had_bytes)
                and text_is_task_authored):
            winner = "text wins the manifest" if visible else "bytes win the manifest"
            conflicts.append(Conflict(p, "binary", task.task_id,
                                      "path %s written as text and as binary "
                                      "concurrently; %s" % (p, winner)))
        if visible and deleted and not (was_visible and was_deleted):
            conflicts.append(Conflict(p, "delete/modify", task.task_id,
                                      "path %s deleted concurrently with text that "
                                      "survives the delete; the text wins the "
                                      "manifest" % p))
```

In `fold`, update the call: `_fold_presence(base, frontier, task, files, candidates, deleted_marks, conflicts)`.

- [ ] **Step 6: Run the new file, then the two existing frontier test files**

Run: `python3 -m pytest tests/test_repo_weave_report_determinism.py tests/test_frontier_weave.py -q`
Expected: all PASS. If an existing `_fold_presence` test now fails because it
constructed a lone-type-change and expected a conflict, that test embodied the
nit — update its expectation to the new contract and say so in the commit body.

- [ ] **Step 7: Run the full suite**

Run: `python3 -m pytest`
Expected: green (run_eval's K1 outcome key change is exercised by the frontier
sim tests; nothing outside `evals/frontier` + its tests knows these symbols).

- [ ] **Step 8: Commit**

```bash
git add evals/frontier/run_eval.py evals/frontier/repo_weave.py \
        tests/test_frontier_weave.py tests/test_repo_weave_report_determinism.py
git commit -m "fix(#132): set-based conflict comparison + lone-type-change and narration nits; seed sets pinned"
```

---

### Task 2: Resolver brief — `references/resolver-prompt.md`

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/frontier/references/resolver-prompt.md`
- Test: `tests/test_resolver_brief.py`

**Interfaces:**
- Consumes: nothing.
- Produces: the resolver I/O contract every consumer builds against — input JSON `{"path": str, "kind": str, "narration": str, "planBodies": [str, ...]}`; output JSON `{"resolvedFileLines": [str, ...]}` (the complete visible line list for the file); the brief file path `evals/frontier/references/resolver-prompt.md`.

**Parallelization rationale:** contract-first — the fold engine (application/validity/park logic) and the cell driver (dispatch) both consume this contract; fixing it as its own first-wave task lets them build in parallel against it.

- [ ] **Step 1: Write the failing test**

Create `tests/test_resolver_brief.py`:

```python
"""The resolver brief is a load-bearing prompt artifact: the driver sends it
verbatim to a headless session. Pin the contract tokens the fold engine and
driver rely on (spec 2026-08-11 component 4)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRIEF = ROOT / "evals/frontier/references/resolver-prompt.md"


def test_brief_exists_and_carries_the_contract_tokens():
    text = BRIEF.read_text()
    for token in (
        "resolvedFileLines",          # the output key, exactly
        "complete visible line list", # whole-file-out, no region output
        "planBodies",                 # input field names
        '"narration"',
        "only JSON",                  # no prose around the object
        "do not invent",              # no content beyond the two sides + context
    ):
        assert token in text, "brief missing contract token: %r" % token


def test_brief_forbids_tools_and_repo_access():
    text = BRIEF.read_text().lower()
    assert "no tools" in text and "no repo access" in text and "no shell" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_resolver_brief.py -q`
Expected: FAIL — file absent.

- [ ] **Step 3: Write the brief**

Create `evals/frontier/references/resolver-prompt.md`:

```markdown
# Frontier conflict resolver — dispatch brief

You are a merge-conflict resolver for the manyana frontier production test.
You have **no tools, no repo access, no shell** — you receive one JSON object
and you return one JSON object. Return **only JSON**: no prose, no fences.

## Input

A single JSON object:

- `"path"` — the conflicted file's repo-relative path.
- `"kind"` — the conflict kind (always a text-narrated kind; non-text
  conflicts are never dispatched to you).
- `"narration"` — the WHOLE annotated file: manyana's merged view with
  conflict markers naming each side (`frontier` = work already merged;
  a task id = the incoming change). Non-marker lines are already-merged
  content.
- `"planBodies"` — the plan text of each task involved in this conflict,
  in the same order as the marker labels introduce them. Use these to
  understand each side's INTENT.

## Output

`{"resolvedFileLines": [...]}` — the **complete visible line list** for the
file after resolution: every line the merged file should contain, top to
bottom, no markers, no trailing-newline entries. This is whole-file-out:
lines outside the conflicted blocks must be preserved exactly as the
narration shows them; **do not invent** content that appears in neither
side nor the narration.

## Rules

1. Honor both sides' intent where they are compatible; where they are not,
   prefer the semantics the plan bodies describe over surface text.
2. Never drop a side silently — if the two sides are irreconcilable,
   still return your best whole-file merge; a held-out test suite grades
   the result and a human reads this transcript verbatim.
3. Return only the JSON object. A malformed reply is retried once, then
   the conflict parks as recorded evidence.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_resolver_brief.py -q`
Expected: PASS.

- [ ] **Step 5: Run the full suite, then commit**

Run: `python3 -m pytest`
Expected: green.

```bash
git add evals/frontier/references/resolver-prompt.md tests/test_resolver_brief.py
git commit -m "feat(frontier): resolver dispatch brief — whole-file JSON contract"
```

---

### Task 3: Fold engine — `evals/frontier/frontier_fold.py`

**Type:** implementation
**Depends-on:** 2
**Review:** adversarial

**Files:**
- Create: `evals/frontier/frontier_fold.py`
- Test: `tests/test_frontier_fold.py`

**Interfaces:**
- Consumes: the resolver I/O contract (from Task 2): output key `resolvedFileLines` = complete visible line list; dispatch only on annotated-narration conflicts. Pre-existing: `repo_weave.fold/publish/manifest/Conflict`, `manyana.update_state/current_lines`, `schedule_model.sampled_orders/fold_all`.
- Produces: `FrontierEngine(base)` — `.fold(task) -> list[Conflict]` (per-fold pre-dedupe stream; appends a fold event), `.epoch() -> int` (event count; capture BEFORE reading a narration), `.apply_resolution(path, epoch, lines) -> bool` (False = an intervening fold touched the path: re-narrate or park), `.manifest() -> dict`, `.events -> list` (JSON-able); module functions `replay(base, tasks_by_id, events) -> dict` (deterministic event-log replay), `raw_shuffle_outcomes(base, tasks, sample_seed) -> set` (live-K1 leg 1), `dispatchable(conflict, state) -> (bool, str)` (annotated-narration predicate + 400-visible-line cap; the str is the park reason when False).

**Parallelization rationale:** seam split — the pure merge-state machine (fold ordering, event log, application validity, replay) is independently testable with fake tasks and a fake resolver, with no kit plumbing or subprocesses; the cell driver consumes its API. A good engineer separates these regardless of parallelism.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_frontier_fold.py`:

```python
"""The frontier fold engine: fold-on-completion, event log + deterministic
replay, resolution application-validity, live-K1 legs, dispatch predicate
(spec 2026-08-11 components 3-4)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
sys.path.insert(0, str(ROOT / "tests"))
import repo_weave as rw
import frontier_fold as ff
from test_frontier_weave import make_base


def _base():
    return make_base({"cli.py": "def a(x):\n    return x\n\ndef b(y):\n    return y\n"})


def _task(base, tid, text):
    return rw.task_state_from_contents(base, tid, {"cli.py": text})


def test_fold_returns_per_fold_stream_and_logs_events():
    base = _base()
    eng = ff.FrontierEngine(base)
    c1 = eng.fold(_task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n"))
    assert c1 == []
    assert [e["type"] for e in eng.events] == ["fold"]
    assert eng.events[0]["task"] == "t1"


def test_replay_of_recorded_events_reproduces_manifest():
    base = _base()
    t1 = _task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n")
    t2 = _task(base, "t2", "def a(x):\n    return x\n\ndef b(y):\n    return y * 2\n")
    eng = ff.FrontierEngine(base)
    eng.fold(t1); eng.fold(t2)
    replayed = ff.replay(base, {"t1": t1, "t2": t2}, eng.events)
    assert replayed == eng.manifest()


def test_application_validity_rejects_stale_resolution():
    base = _base()
    t1 = _task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n")
    t2 = _task(base, "t2", "def a(x):\n    return x\n\ndef b(y):\n    return y * 2\n")
    eng = ff.FrontierEngine(base)
    eng.fold(t1)
    epoch = eng.epoch()                       # narration taken here
    eng.fold(t2)                              # intervening fold touches cli.py
    ok = eng.apply_resolution("cli.py", epoch, ["def a(x):", "    return 0", ""])
    assert ok is False                        # stale: re-narrate or park
    assert all(e["type"] == "fold" for e in eng.events)  # nothing applied


def test_valid_resolution_applies_and_replays():
    base = _base()
    t1 = _task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n")
    eng = ff.FrontierEngine(base)
    eng.fold(t1)
    epoch = eng.epoch()
    lines = ["def a(x):", "    return x + 1", "", "def b(y):", "    return y", ""]
    assert eng.apply_resolution("cli.py", epoch, lines) is True
    assert eng.events[-1]["type"] == "resolve"
    replayed = ff.replay(base, {"t1": t1}, eng.events)
    assert replayed == eng.manifest()
    assert eng.manifest()["cli.py"] == "\n".join(lines[:-1]) + "\n" or \
           eng.manifest()["cli.py"] == "\n".join(lines)


def test_raw_shuffle_outcomes_is_a_singleton_on_clean_tasks():
    base = _base()
    t1 = _task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n")
    t2 = _task(base, "t2", "def a(x):\n    return x\n\ndef b(y):\n    return y * 2\n")
    assert len(ff.raw_shuffle_outcomes(base, [t1, t2], sample_seed=7)) == 1


def test_dispatchable_requires_annotated_narration_and_size_cap():
    ok, _ = ff.dispatchable(
        rw.Conflict("p.py", "lines", "t1", "<<<<<<< frontier\nmarked\n>>>>>>>"),
        {"p.py": "\n".join(["x = %d" % i for i in range(10)])})
    assert ok is True
    no_block, reason = ff.dispatchable(
        rw.Conflict("img.bin", "binary", "t1", "path img.bin written as text and as binary"),
        {"img.bin": b"\x00"})
    assert no_block is False and "narration" in reason
    big, reason = ff.dispatchable(
        rw.Conflict("p.py", "lines", "t1", "<<<<<<< frontier\nmarked\n>>>>>>>"),
        {"p.py": "\n".join(["x = %d" % i for i in range(401)])})
    assert big is False and "400" in reason
```

Adjust `Conflict(...)` construction to the dataclass's real field order (read it
in `repo_weave.py` — it is `(path, kind, task_id, narration)` today; if it
differs, follow the code). The `dispatchable` predicate for "annotated
narration" is: the narration contains a manyana conflict-marker line (the
`MARKERS` prefixes `_relabel` rewrites — import `MARKERS` from `repo_weave` if
exported, else match on the marker strings the module defines).

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_frontier_fold.py -q`
Expected: FAIL/ERROR — `No module named 'frontier_fold'`.

- [ ] **Step 3: Write the module**

Create `evals/frontier/frontier_fold.py`:

```python
#!/usr/bin/env python3
"""Fold-on-completion engine for the frontier production test (spec
2026-08-11, component 3). Pure state machine: no subprocesses, no kit
plumbing. The cell driver owns dispatch; this module owns merge state.

Invariants it enforces (each pinned by tests/test_frontier_fold.py):
* the event log is the durable record: replay(base, tasks, events)
  reproduces the manifest deterministically;
* application validity: a resolution computed from a narration applies only
  if no intervening fold touched its path since the narration's epoch;
* the dispatch predicate: only annotated-block narrations, <= 400 visible
  lines, are resolver-eligible — everything else parks with a named reason.
"""
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "vendor"))
import manyana
import repo_weave as rw
import schedule_model as sm

RESOLVER_LINE_CAP = 400


class FrontierEngine:
    def __init__(self, base):
        self.base = base
        self.frontier = base
        self.events = []            # [{"type": "fold", "task": id} |
                                    #  {"type": "resolve", "path": p, "lines": [...]}]
        self._touched_at = {}       # path -> last event index that folded it

    def epoch(self):
        return len(self.events)

    def fold(self, task):
        self.frontier, conflicts = rw.fold(self.base, self.frontier, task)
        idx = len(self.events)
        self.events.append({"type": "fold", "task": task.task_id})
        for p in set(task.weaves) | set(task.raw) | set(task.deleted):
            self._touched_at[p] = idx
        return conflicts            # per-fold pre-dedupe stream

    def apply_resolution(self, path, epoch, lines):
        if self._touched_at.get(path, -1) >= epoch:
            return False            # stale narration: re-narrate or park
        files = dict(self.frontier.files)
        files[path] = manyana.update_state(files[path], list(lines))
        self.frontier = rw.RepoState(files=files,
                                     deleted_marks=self.frontier.deleted_marks,
                                     raw=dict(self.frontier.raw),
                                     raw_candidates=dict(self.frontier.raw_candidates))
        self.events.append({"type": "resolve", "path": path, "lines": list(lines)})
        return True

    def manifest(self):
        return rw.manifest(self.frontier)


def replay(base, tasks_by_id, events):
    """Re-run the exact recorded sequence; the return must equal the live
    manifest (G2's event-log leg)."""
    eng = FrontierEngine(base)
    for e in events:
        if e["type"] == "fold":
            eng.fold(tasks_by_id[e["task"]])
        else:
            files = dict(eng.frontier.files)
            files[e["path"]] = manyana.update_state(files[e["path"]], list(e["lines"]))
            eng.frontier = rw.RepoState(files=files,
                                        deleted_marks=eng.frontier.deleted_marks,
                                        raw=dict(eng.frontier.raw),
                                        raw_candidates=dict(eng.frontier.raw_candidates))
    return eng.manifest()


def raw_shuffle_outcomes(base, tasks, sample_seed):
    """Live-K1 leg 1: shuffled raw folds (resolutions excluded) must be
    outcome-identical to each other; set-based keys per #132."""
    outcomes = set()
    for order in sm.sampled_orders(len(tasks), seed=sample_seed):
        frontier, conflicts = sm.fold_all(rw.fold, base, tasks, order)
        outcomes.add((tuple(sorted(rw.manifest(frontier).items())),
                      tuple(sorted(set((c.path, c.kind) for c in conflicts)))))
    return outcomes


def dispatchable(conflict, manifest):
    """(ok, park_reason). Resolver-eligible iff the narration carries
    manyana's annotated conflict block AND the file is text under the cap."""
    if not any(line.startswith(rw.MARKERS) for line in conflict.narration.splitlines()):
        return False, "no annotated narration for %s (%s)" % (conflict.path, conflict.kind)
    body = manifest.get(conflict.path)
    if not isinstance(body, str):
        return False, "non-text manifest content for %s" % conflict.path
    if len(body.splitlines()) > RESOLVER_LINE_CAP:
        return False, "file exceeds %d visible lines" % RESOLVER_LINE_CAP
    return True, ""
```

Check `sm.sampled_orders`' real signature before wiring (`sampled_orders(n)` vs
`(n, seed)` — mirror `run_eval.py`'s call); check `rw.MARKERS` is module-level
(it is — `_relabel` reads it); check `rw.RepoState` constructor kwargs against
the dataclass. Follow the code where this sketch and the code disagree, keeping
the tested behavior identical.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_frontier_fold.py -q`
Expected: all PASS.

- [ ] **Step 5: Run the full suite, then commit**

Run: `python3 -m pytest`
Expected: green.

```bash
git add evals/frontier/frontier_fold.py tests/test_frontier_fold.py
git commit -m "feat(frontier): fold engine — event log, deterministic replay, application validity, dispatch predicate"
```

---

### Task 4: Shadow fold — `evals/frontier/shadow_fold.py`

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `evals/frontier/shadow_fold.py`
- Modify: `evals/frontier/run_eval.py`
- Test: `tests/test_shadow_fold.py`

**Interfaces:**
- Consumes: the set-based `conflict_keys` (from Task 1); `run_eval`'s replay internals, promoted in this task.
- Produces: CLI `python3 evals/frontier/shadow_fold.py <run-dir> [--report FILE] [--out DIR]` → writes `<out>/<date>-shadow-<stamp>.md` + `.json`, exit 0 on completion (parks included), non-zero only on abort (ancestry/sha failure on the selected report); public re-exports in `run_eval.py`: `group_chain = _group_chain`, `replay_group = _replay_group`, `is_ancestor = _is_ancestor`.

- [ ] **Step 1: Promote the replay internals (no behavior change)**

At the bottom of `evals/frontier/run_eval.py` add:

```python
# Public aliases for the shadow-fold front-end (spec 2026-08-11): the replay
# internals are reused as-is — behavior pinned by the existing sim tests.
group_chain = _group_chain
replay_group = _replay_group
is_ancestor = _is_ancestor
```

Run: `python3 -m pytest tests/ -k "frontier or workflow_sim" -q` — Expected: green, unchanged.

- [ ] **Step 2: Write the failing tests**

Create `tests/test_shadow_fold.py`. Build a synthetic run: a real temp git repo
whose integration chain has wave 1 = a two-task merge wave **preceded by a
pre-first-merge reconciliation commit**, wave 2 = a single-task FF wave; plus a
matching `report.json`. Assert the shadow: (a) derives the floor as the first
merge's merge-base so the pre-first-merge commit stays in `group_chain`'s hands;
(b) reports wave 1 `clean` with 2 task endpoints; (c) reports the FF wave as
`absorbed`/`trailing-cut` per the inherited dispositions (no segmentation rule);
(d) parks by name when `report.json` is absent; (e) aborts loudly on a
fabricated task sha; (f) MERGED-only: a `FAILED` wave entry is not consumed;
(g) durations: every MERGED task gets an approximate duration or an explicit
`"duration": null` with `"durationReason"`.

```python
"""Shadow-fold: bound the chain, hand it to run_eval's inherited replay
machinery, compare against the shipped trees, park every unshadowable shape
by name (spec 2026-08-11 component 2)."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "evals/frontier/shadow_fold.py"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


def _commit_all(repo, msg):
    git(repo, "add", "-A"); git(repo, "commit", "-qm", msg)
    return git(repo, "rev-parse", "HEAD")


def make_run(tmp_path):
    """fork -> recon (pre-first-merge) -> wave-1 merge(t1)+merge(t2) -> FF t3."""
    repo = tmp_path / "repo"; repo.mkdir()
    git(repo, "init", "-qb", "main")
    git(repo, "config", "user.email", "s@t"); git(repo, "config", "user.name", "s")
    (repo / "a.py").write_text("A = 1\n"); (repo / "b.py").write_text("B = 1\n")
    fork = _commit_all(repo, "fork")
    git(repo, "checkout", "-qb", "integ")
    (repo / "note.md").write_text("recon\n"); recon = _commit_all(repo, "recon")
    heads = {}
    for tid, path, text in (("t1", "a.py", "A = 2\n"), ("t2", "b.py", "B = 2\n")):
        git(repo, "checkout", "-qb", tid, recon if tid == "t1" else recon)
        (repo / path).write_text(text); heads[tid] = _commit_all(repo, tid)
        git(repo, "checkout", "-q", "integ")
        git(repo, "merge", "-q", "--no-ff", tid, "-m", "merge %s" % tid)
    wave1 = git(repo, "rev-parse", "HEAD")
    (repo / "a.py").write_text("A = 3\n"); heads["t3"] = _commit_all(repo, "t3")
    wave2 = heads["t3"]                                    # FF single-task wave
    run_dir = tmp_path / "run-shadowtest"; run_dir.mkdir()
    (run_dir / "report.json").write_text(json.dumps({"waveMerges": [
        {"wave": 1, "status": "MERGED", "headSha": wave1, "branches": ["t1", "t2"]},
        {"wave": 2, "status": "MERGED", "headSha": wave2, "branches": ["t3"]}],
        "tasks": [{"task": t, "headSha": h} for t, h in heads.items()]}))
    return repo, run_dir


def run_shadow(repo, run_dir, out, extra=()):
    return subprocess.run([sys.executable, str(SCRIPT), str(run_dir),
                           "--repo", str(repo), "--out", str(out), *extra],
                          capture_output=True, text=True)


def test_merge_wave_folds_clean_and_ff_wave_takes_inherited_disposition(tmp_path):
    repo, run_dir = make_run(tmp_path)
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0, p.stderr
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    w1 = next(w for w in payload["waves"] if w["wave"] == 1)
    assert w1["disposition"] == "clean" and w1["endpoints"] == 2
    w2 = next(w for w in payload["waves"] if w["wave"] == 2)
    assert w2["disposition"] in ("absorbed", "trailing-cut")
    assert payload["floorSource"] == "merge-base"          # not the FF fallback


def test_no_report_parks_by_name(tmp_path):
    repo, run_dir = make_run(tmp_path)
    (run_dir / "report.json").unlink()
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    assert payload["parked"] == "no finalized report (unshadowable)"


def test_fabricated_task_sha_aborts_loud(tmp_path):
    repo, run_dir = make_run(tmp_path)
    doc = json.loads((run_dir / "report.json").read_text())
    doc["tasks"][0]["headSha"] = doc["tasks"][0]["headSha"][:7] + "0" * 33
    (run_dir / "report.json").write_text(json.dumps(doc))
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode != 0
    assert "does not resolve" in (p.stderr + p.stdout)


def test_non_merged_wave_entries_are_not_consumed(tmp_path):
    repo, run_dir = make_run(tmp_path)
    doc = json.loads((run_dir / "report.json").read_text())
    doc["waveMerges"][1]["status"] = "FAILED"
    (run_dir / "report.json").write_text(json.dumps(doc))
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0, p.stderr
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    assert [w["wave"] for w in payload["waves"]] == [1]


def test_durations_present_or_named_unavailable(tmp_path):
    repo, run_dir = make_run(tmp_path)
    p = run_shadow(repo, run_dir, tmp_path / "out")
    assert p.returncode == 0, p.stderr
    payload = json.loads(next((tmp_path / "out").glob("*-shadow-*.json")).read_text())
    for row in payload["durations"]:
        assert ("seconds" in row and row["seconds"] >= 0) or row.get("reason")
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_shadow_fold.py -q`
Expected: FAIL — script absent.

- [ ] **Step 4: Write `shadow_fold.py`**

Create `evals/frontier/shadow_fold.py`, implementing exactly the spec's
component 2 (read it: `docs/superpowers/specs/2026-08-11-frontier-production-test-design.md`
§Components §2 — the file is in-repo and is the authority on every rule below):

- `--repo` (default `.`), `--report` (default `<run-dir>/report.json`),
  `--out` (default `evals/frontier/results/`).
- Discovery: only `report.json`/`--report`; absent → write the park payload
  (`{"parked": "no finalized report (unshadowable)"}` + the md note), exit 0.
- Authenticate: every MERGED wave's `headSha` and every task `headSha` must
  `git rev-parse --verify <sha>^{commit}` — a non-resolving sha exits non-zero
  with `"<sha> does not resolve"`; every task head must be `is_ancestor` of its
  wave head (reuse `run_eval.is_ancestor`) — violation exits non-zero.
- Bound the chain: tip = last MERGED wave head. Walk first-parent listing
  `(sha, parents)` no deeper than the earliest MERGED wave head's parent. The
  floor = merge-base of the first two-parent merge found (`floorSource:
  "merge-base"`); no two-parent merge in the span → record the inherited
  `"excluded": "no per-task merges (nothing to replay)"` and skip folding
  (durations still emitted).
- Fold: hand the bounded chain to `run_eval.group_chain(repo, chain)` and each
  group to `run_eval.replay_group(repo, group, seed=42)`; disposition per wave
  from the group result (`clean` / `divergent` / `conflicted`), narrations
  verbatim into the JSON. A MERGED wave whose head sits at/below the floor
  reports `absorbed`; chain commits `group_chain` returns as trailing report
  `trailing-cut`.
- Durations: for every MERGED task, `git show -s --format=%ct <sha>` minus the
  prior wave head's (or walk lower bound's) `%ct`; tip at/below the bound →
  `{"task": id, "reason": "at/below walk floor"}`. Reconciliation pseudo-tasks
  get no duration row. Then re-run the makespan model with measured durations
  (mirror `run_eval._makespans`' use of `sm.waves_makespan`/`sm.frontier_makespan`
  — read that function and reuse the same calls) when the run dir's plan is
  available; otherwise emit `"remodel": null` with a reason.
- Output: `<out>/<YYYY-MM-DD>-shadow-<run-dir-basename>.json` + a small `.md`
  rendering of the same payload (dispositions table, narrations, durations).

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_shadow_fold.py -q`
Expected: all PASS.

- [ ] **Step 6: Run the full suite, then commit**

Run: `python3 -m pytest`
Expected: green.

```bash
git add evals/frontier/shadow_fold.py evals/frontier/run_eval.py tests/test_shadow_fold.py
git commit -m "feat(frontier): shadow_fold — re-merge finished runs from the finalized report via the inherited replay machinery"
```

---

### Task 5: Arm-B cell driver — `evals/run_frontier_cell.py`

**Type:** implementation
**Depends-on:** 2, 3

**Files:**
- Create: `evals/run_frontier_cell.py`
- Test: `tests/test_frontier_cell.py`

**Interfaces:**
- Consumes: `FrontierEngine`, `replay`, `raw_shuffle_outcomes`, `dispatchable` (from Task 3, exact signatures in its Produces); the resolver brief + I/O contract (from Task 2); pre-existing kit functions `ab_runner.build_run_plan`, `ab_runner.prepare_cell(plan, root) -> (workdir, baseline, env)`, `ab_runner.scrub_credentials(env)`, `ab_runner.CLAUDE_FLAGS`; `schedule_model.drop_same_file_edges` / `SAME_FILE_WHYS`; `compile_plan.py` in the engine worktree.
- Produces: CLI `python3 evals/run_frontier_cell.py --engine-ref REF [--fixture contend] [--dry-run]` → drives arm B end-to-end, writes `evals/frontier/results/<date>-frontier-cell.json` (events, conflicts, resolutions verbatim, per-task + end-to-end wall clock, peak parallelism, gate result). Internal seams the tests drive directly: `plan_schedule(compiled) -> (ready_sets, dropped_edges)`, `resolve_conflict(engine, conflict, plan_bodies, launcher) -> "applied" | "re-narrated" | "parked:<reason>"`, `preflight(workdir, env, launcher) -> bool`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_frontier_cell.py` (all seams driven with fake launchers —
no subprocess, no network):

```python
"""Arm-B driver seams: edge-drop via the imported constant, serial resolver
dispatch with application validity, retry->park, live-K1 legs, preflight
park (spec 2026-08-11 component 3)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
sys.path.insert(0, str(ROOT / "tests"))
import run_frontier_cell as fc
import frontier_fold as ff
import schedule_model as sm
import repo_weave as rw
from test_frontier_weave import make_base


def test_plan_schedule_drops_exactly_the_same_file_edges():
    compiled = {"tasks": [{"id": t} for t in "1234"],
                "dag_edges": [("1", "2", "write-after-write"),
                              ("1", "3", "write-after-create"),
                              ("2", "3", "ambiguous-files"),
                              ("1", "4", "marker")]}
    ready, dropped = fc.plan_schedule(compiled)
    assert set(dropped) == {("1", "2"), ("1", "3"), ("2", "3")}
    assert ready[0] == {"1", "2", "3"}          # 4 blocked by the kept marker edge
    # The rule is the imported constant, not a re-typed list:
    assert fc.EDGE_DROP is sm.SAME_FILE_WHYS


def _conflicted_engine():
    base = make_base({"cli.py": "def a(x):\n    return x\n"})
    t1 = rw.task_state_from_contents(base, "t1", {"cli.py": "def a(x):\n    return x + 1\n"})
    t2 = rw.task_state_from_contents(base, "t2", {"cli.py": "def a(x):\n    return x - 1\n"})
    eng = ff.FrontierEngine(base)
    eng.fold(t1)
    conflicts = eng.fold(t2)
    assert conflicts, "fixture must actually conflict"
    return eng, conflicts[0]


def test_resolver_contract_violation_retries_once_then_parks():
    eng, conflict = _conflicted_engine()
    calls = []
    def bad_launcher(payload):
        calls.append(payload); return "not json at all"
    outcome = fc.resolve_conflict(eng, conflict, {"t1": "body", "t2": "body"}, bad_launcher)
    assert outcome.startswith("parked:") and len(calls) == 2


def test_valid_resolution_applies_whole_file():
    eng, conflict = _conflicted_engine()
    lines = ["def a(x):", "    return x  # resolved", ""]
    def launcher(payload):
        assert set(payload) >= {"path", "kind", "narration", "planBodies"}
        return json.dumps({"resolvedFileLines": lines})
    assert fc.resolve_conflict(eng, conflict, {"t1": "b", "t2": "b"}, launcher) == "applied"
    assert "resolved" in eng.manifest()["cli.py"]


def test_stale_resolution_renarrates():
    eng, conflict = _conflicted_engine()
    base = eng.base
    t3 = rw.task_state_from_contents(base, "t3", {"cli.py": "def a(x):\n    return 9\n"})
    seen = []
    def launcher(payload):
        if not seen:                 # first call: fold lands mid-flight
            eng.fold(t3)
        seen.append(payload["narration"])
        return json.dumps({"resolvedFileLines": ["def a(x):", "    return 0", ""]})
    outcome = fc.resolve_conflict(eng, conflict, {"t1": "b", "t2": "b", "t3": "b"}, launcher)
    assert outcome in ("applied", "re-narrated:applied")
    assert len(seen) == 2 and seen[0] != seen[1]   # fresh narration on retry


def test_preflight_failure_parks_the_arm(tmp_path):
    def dead_launcher(payload):
        raise RuntimeError("no headless sessions here")
    assert fc.preflight(tmp_path, {}, dead_launcher) is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_frontier_cell.py -q`
Expected: FAIL/ERROR — `No module named 'run_frontier_cell'`.

- [ ] **Step 3: Write the driver**

Create `evals/run_frontier_cell.py`. The spec's component 3 is the authority
(read it before writing). Structure:

```python
#!/usr/bin/env python3
"""Arm B of the frontier production test: build the contend fixture with
truly-parallel same-file tasks, manyana-authoritative merging, and the
resolver on narrated conflicts (spec 2026-08-11, component 3). Arm A is an
ordinary kit cell — this driver replaces only drive_run."""
```

Required pieces (each with the exact behavior the Step-1 tests pin):

- `EDGE_DROP = sm.SAME_FILE_WHYS` (imported); `plan_schedule(compiled)` drops
  exactly the edges whose `why` label is in `EDGE_DROP` (reuse
  `sm.drop_same_file_edges` for the drop; derive ready sets from the kept
  edges) and returns `(ready_sets, dropped_edges)`.
- `resolve_conflict(engine, conflict, plan_bodies, launcher)` — **serial** (the
  caller never overlaps calls): check `ff.dispatchable`; capture
  `epoch = engine.epoch()` and the narration; call
  `launcher({"path":…, "kind":…, "narration":…, "planBodies":[…]})`; parse
  strict JSON `{"resolvedFileLines": [...]}` — malformed → one retry → park.
  On parse success, `engine.apply_resolution(path, epoch, lines)`; `False` →
  re-narrate against the current frontier (fresh epoch + narration, one more
  launcher call) → apply or park. Returns `"applied"` / `"re-narrated:applied"`
  / `"parked:<reason>"`, and every narration/reply is appended to the
  results-log list the caller passes in (verbatim, for E2).
- `launcher` (production form): `subprocess.run(["claude", "-p", brief_plus_payload] +
  ab.CLAUDE_FLAGS, cwd=workdir, env=env, …)` where `brief_plus_payload` is the
  Task-2 brief text + the input JSON; runs inside the cell env (same throwaway
  `CLAUDE_CONFIG_DIR`).
- `preflight(workdir, env, launcher)`: the launch-instant shape — **four**
  concurrent trivial launcher calls, each inside its own concurrently-created
  `git worktree add` + commit in the cell repo; any failure → `False`
  (caller parks the arm with the named reason). Use
  `concurrent.futures.ThreadPoolExecutor(max_workers=4)`.
- `main()`: `build_run_plan(engine_ref, "B", fixture, ROOT)` →
  `prepare_cell(plan, ROOT)` → `try:` preflight → compile the fixture plan in
  the cell (`python3 <engine_wt>/skills/ultrapowers/scripts/compile_plan.py
  <plan> --emit-launch` equivalent: call it and read the JSON) →
  `plan_schedule` → dispatch each ready task as a headless implementer
  (`claude -p` with the task's plan body, cwd = its own worktree branched from
  the fixture base, `ThreadPoolExecutor`) → on each completion, commit check +
  `engine.fold(publish(...))` → conflicts through `resolve_conflict` (serial)
  → after all: live K1 (`ff.raw_shuffle_outcomes` singleton + `ff.replay`
  equals live manifest) → materialize: temp worktree, write the manifest
  files, `git add -A && git commit`, branch `frontier-result` (never
  `repo_weave.materialize`) → sealed gate: read
  `plan["sealInstalls"][0]["sealId"]` and the installed vault manifest's
  `suiteSha256`, run `bash <engine_wt>/skills/ultrapowers/scripts/run_acceptance.sh
  <sealId> frontier-result <suiteSha256> --repo <workdir>` (check the script's
  usage header for the exact sealed-mode argument order before wiring) →
  record wall clocks (cell launch → gate exit; per-task span) + peak
  parallelism → write the results JSON. `finally: scrub_credentials(env)` —
  after the last resolver call, per the kit contract.
- `--dry-run`: stop after `plan_schedule`, print the schedule JSON, exit 0
  (no cell, no credentials).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_frontier_cell.py -q`
Expected: all PASS.

- [ ] **Step 5: Sanity-run the dry path**

Run: `python3 evals/run_frontier_cell.py --engine-ref main --fixture contend --dry-run`
Expected: schedule JSON shows all four implementation tasks ready at t=0
(the three `write-after-write` edges dropped), exit 0.

- [ ] **Step 6: Run the full suite, then commit**

Run: `python3 -m pytest`
Expected: green.

```bash
git add evals/run_frontier_cell.py tests/test_frontier_cell.py
git commit -m "feat(frontier): arm-B cell driver — parallel implementers, serial resolver, event-logged folds, sealed gate"
```

---

### Task 6: Stage 1 — shadow the next real run

**Type:** manual
**Depends-on:** 4

**Files:**
- Create: `evals/frontier/results/<date>-shadow-<stamp>.md` (runtime deliverable)

**Interfaces:**
- Consumes: the shadow CLI (from Task 4).
- Produces: the G1 evidence row for the results doc.

- [ ] After the next real waves-engine run in this repo finalizes its report, run `python3 evals/frontier/shadow_fold.py .claude/ultrapowers/run-<stamp>` from the repo root.
- [ ] G1 requires at least one shadowed wave folding ≥2 task endpoints; an all-FF run accumulates but does not satisfy the floor — keep shadowing subsequent runs until a true merge wave lands.
- [ ] Record the verdict in the stage-2 results doc (Task 7).

---

### Task 7: Stage 2 — live A/B cells + operator adjudication

**Type:** manual
**Depends-on:** 5, 6

**Files:**
- Create: `evals/frontier/results/<date>-production-test.md` (runtime deliverable)

**Interfaces:**
- Consumes: the arm-B driver (from Task 5); the existing kit for arm A.
- Produces: the G2/G3 evidence, E1/E2 measurements, and the operator's recorded adjudication.

- [ ] Arm A: `python3 evals/ab_runner.py --engine-ref <ref> --engine-label A --fixture contend` (the unmodified kit cell). Record wall clock.
- [ ] Arm B: `python3 evals/run_frontier_cell.py --engine-ref <ref> --fixture contend`. Arms run sequentially on one machine.
- [ ] Compose the results doc: G1–G3 verdicts with raw runner JSON; E1 wall-clock table (intervals as pinned in the spec, the review-loop confound named); E2 — every narration + resolution verbatim, with a blank operator-grade line.
- [ ] Operator adjudicates E1 materiality and grades E2; the decision rule's outcome (propose engine increment / stop) is recorded in the doc.

---

## Self-review notes

- Spec coverage: component 1 → Task 1; component 2 → Task 4; component 3 → Task 5 (+ preflight, event log via Task 3); component 4 → Tasks 2 (brief) + 3 (validity/predicate) + 5 (dispatch); G1/G2/G3 + E1/E2 → Tasks 6–7 runtime deliverables. The spec's Testing section maps: determinism file → Task 1, shadow file → Task 4, cell file → Tasks 3+5 (split along the engine/driver seam; union of the spec's named cases covered across `test_frontier_fold.py` + `test_frontier_cell.py`).
- Where prescribed code touches unverified constructor details (TaskState delete idiom, `sampled_orders` signature, `run_acceptance.sh` sealed-mode argument order), the task body names the authoritative in-repo source to read first — tests are the contract, sketches bend to the code.
- Type consistency: `conflict_keys` set-based in both sites (Task 1); `FrontierEngine` API names identical in Task 3 Produces and Task 5 Consumes; `resolvedFileLines`/`planBodies` identical in Tasks 2, 3, 5.

**Acceptance:** suite — dev tooling across `evals/` and `tests/`; the committed suite is the verification; the live cells are runtime deliverables (spec §Acceptance).
