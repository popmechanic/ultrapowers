# Frontier Kernel + Scheduler Simulation Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the offline manyana probe specified in `docs/superpowers/specs/2026-08-09-frontier-kernel-sim-design.md` — a vendored CRDT merge kernel, a repo-level weave layer, a closed-form scheduling model, and a replay-eval runner — producing the measurement report that decides whether a frontier engine is ever proposed.

**Architecture:** Everything lives in `evals/frontier/` (eval quarter; zero engine surface). Three modules over a vendored, patched, sha-pinned `manyana.py`: `repo_weave.py` (RepoState/TaskState/fold — the repo-level merge layer), `schedule_model.py` (closed-form makespans + generic fold replay + bisection), `run_eval.py` (corpus tracks a/b/c + JSON results + roll-up markdown). Tests in `tests/` so the ordinary suite and CI cover them.

**Tech Stack:** Python 3.9+ stdlib only; git via `subprocess`; pytest.

**Acceptance:** suite — probe is eval-only, operator reads the diff; committed suite + per-task review is the verification (spec disposition).

## Global Constraints

- Python 3.9-compatible everywhere (CI pins 3.11, dev default is 3.9; the vendored kernel carries the one documented PEP 701 patch — no other 3.10+ syntax anywhere).
- Stdlib only — no new dependencies, no `anthropic` SDK, no API keys, no network at test time (the vendor fetch in Task 1 is the single build-time network step).
- No changes outside `evals/frontier/`, `tests/`, and `docs/` — never touch `skills/`, `hooks/`, `.claude-plugin/`, or `.github/workflows/`.
- All randomness seeded (`random.Random(42)` or a fixed per-case seed) — CI-deterministic.
- No silent caps: every exclusion (skipped fixture, excluded archived run, below-floor corpus) must be named in the emitted report.
- Text normalization rule (probe-wide): file content is compared as lines joined by `\n` with exactly one trailing `\n` for non-empty files; both sides of any fidelity comparison get the same normalization.

---

### Task 1: Vendored kernel with compatibility patch and pin

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/frontier/vendor/manyana.py`
- Create: `evals/frontier/vendor/PROVENANCE.md`
- Test: `tests/test_frontier_kernel.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: importable module `manyana` (add `evals/frontier/vendor` to `sys.path`) with `initial_state(lines) -> str`, `current_lines(state: str) -> list[str]`, `update_state(state: str, lines: list[str]) -> str`, `merge_states(s1: str, s2: str) -> tuple[str, list[str]]`; vendored-file constant `PATCHED_SHA256 = "3c8ba319bb286aac0ca8f2d7ac355e2610eafa290d2f1e46c7eb5ff562220004"` asserted in the pin test.

**PRIOR ATTEMPT (2026-08-09, run wf_fe05bc69-a22):** this task was completed
cleanly once and its merge was blocked by run machinery, not content. Reuse the
finished work instead of re-fetching: commit `4810195` on branch
`worktree-wf_fe05bc69-a22-3` carries all three files, review-verdict clean,
vendored sha matching the pin exactly. `git checkout 4810195 -- evals/frontier/vendor/ tests/test_frontier_kernel.py`
then apply this plan's one delta — the `assert len(ran) == 18` count-guard in
`test_upstream_suite_passes` (Step 4 below shows the final form) — and verify
per Steps 2 and 5. Never use commit `bb969e6` (a contaminated attempt no branch
contains: it touches `skills/` and deletes plan documents). If the branch is
gone, fall back to the fetch path in Step 1.

- [ ] **Step 1: Fetch upstream and apply the one-line patch**

```bash
mkdir -p evals/frontier/vendor /tmp/manyana-vendor
git clone --depth 1 https://github.com/bramcohen/manyana /tmp/manyana-vendor/manyana
git -C /tmp/manyana-vendor/manyana rev-parse HEAD   # expect bd77d480e7649f239c42d10a5e64565ee064dd08
cp /tmp/manyana-vendor/manyana/manyana.py evals/frontier/vendor/manyana.py
```

Then apply exactly one edit to `evals/frontier/vendor/manyana.py` (upstream line 123, inside `serialize_state`). Replace:

```python
        result.append(f'{depth} {['<', '>'][anchored_right]} {count} {line}')
```

with:

```python
        arrow = ('<', '>')[anchored_right]
        result.append(f'{depth} {arrow} {count} {line}')
```

This is the PEP 701 nested-quote f-string that only parses on Python ≥ 3.12; the hoisted form is behavior-identical and parses on 3.9. No other change of any kind.

- [ ] **Step 2: Verify the patch locally**

```bash
python3 -c "import ast; ast.parse(open('evals/frontier/vendor/manyana.py').read()); print('parses')"
python3 evals/frontier/vendor/manyana.py    # runs manyana's built-in suite
shasum -a 256 evals/frontier/vendor/manyana.py
```

Expected: `parses`, `18 tests passed, 0 tests failed`, and sha256 `3c8ba319bb286aac0ca8f2d7ac355e2610eafa290d2f1e46c7eb5ff562220004`. If the upstream HEAD is no longer `bd77d480e7649f239c42d10a5e64565ee064dd08`, STOP and report BLOCKED with the observed sha — do not vendor a different upstream revision, because the pin and this plan's assumptions were computed against that commit.

- [ ] **Step 3: Write PROVENANCE.md**

```markdown
# Vendored: manyana

- Upstream: https://github.com/bramcohen/manyana
- Upstream commit: bd77d480e7649f239c42d10a5e64565ee064dd08
- License: public domain (upstream README)
- Local patch (exactly one, for Python < 3.12 compatibility — upstream line 123
  uses PEP 701 nested same-quote f-string syntax):

    -        result.append(f'{depth} {['<', '>'][anchored_right]} {count} {line}')
    +        arrow = ('<', '>')[anchored_right]
    +        result.append(f'{depth} {arrow} {count} {line}')

- sha256 of the patched file (pinned by tests/test_frontier_kernel.py):
  3c8ba319bb286aac0ca8f2d7ac355e2610eafa290d2f1e46c7eb5ff562220004

Re-vendoring procedure: fetch upstream, re-apply the patch hunk above, re-run
`python3 evals/frontier/vendor/manyana.py` (all tests must pass), update the
sha256 in BOTH this file and tests/test_frontier_kernel.py in the same commit.
```

- [ ] **Step 4: Write the failing pin/parse/wrap tests**

Create `tests/test_frontier_kernel.py`:

```python
"""Vendored manyana kernel: pin, parse-compatibility, and upstream-suite wrap."""
import ast
import hashlib
import io
import sys
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "evals" / "frontier" / "vendor"
sys.path.insert(0, str(VENDOR))
import manyana

PATCHED_SHA256 = "3c8ba319bb286aac0ca8f2d7ac355e2610eafa290d2f1e46c7eb5ff562220004"


def test_vendor_pin():
    data = (VENDOR / "manyana.py").read_bytes()
    assert hashlib.sha256(data).hexdigest() == PATCHED_SHA256, (
        "vendored manyana.py changed without updating the pin; "
        "see evals/frontier/vendor/PROVENANCE.md for the re-vendor procedure"
    )


def test_vendor_parses_pre_312():
    # Guard the compatibility claim itself: the file must be plain pre-3.12 syntax.
    ast.parse((VENDOR / "manyana.py").read_text())


def test_provenance_records_pin():
    text = (VENDOR / "PROVENANCE.md").read_text()
    assert PATCHED_SHA256 in text
    assert "bd77d480e7649f239c42d10a5e64565ee064dd08" in text


def test_upstream_suite_passes():
    # manyana's own runner: every module-level callable named test* is a test.
    failures = []
    ran = []
    for name in sorted(dir(manyana)):
        if name.startswith("test") and callable(getattr(manyana, name)):
            fn = getattr(manyana, name)
            if fn.__code__.co_argcount == 0:
                ran.append(name)
                try:
                    with redirect_stdout(io.StringIO()):
                        fn()
                except Exception as exc:  # noqa: BLE001 - collecting all failures
                    failures.append(f"{name}: {exc!r}")
    assert not failures, failures
    # 18 zero-arg test* functions at the pinned revision (2 param'd helpers are
    # invoked by their parents): guards the wrap against a silently-empty sweep
    # if a future re-vendor changes the naming convention.
    assert len(ran) == 18, ran


def test_kernel_api_roundtrip():
    state = manyana.initial_state(["hello", "world"])
    assert manyana.current_lines(state) == ["hello", "world"]
    state2 = manyana.update_state(state, ["hello", "brave", "world"])
    assert manyana.current_lines(state2) == ["hello", "brave", "world"]
    merged, annotated = manyana.merge_states(state2, state2)
    assert manyana.current_lines(merged) == ["hello", "brave", "world"]
    assert annotated == manyana.current_lines(merged)  # no conflict -> identical
```

- [ ] **Step 5: Run the tests to verify they fail before vendoring is committed, then pass**

```bash
python3 -m pytest tests/test_frontier_kernel.py -v
```

Expected: PASS (the vendor files were created in Steps 1–3; if any test fails, fix the vendoring, never the assertions).

- [ ] **Step 6: Run the full suite and commit**

```bash
python3 -m pytest
git add evals/frontier/vendor tests/test_frontier_kernel.py
git commit -m "feat(frontier): vendor manyana kernel (one documented PEP 701 patch, sha-pinned)"
```

---

### Task 2: Repo-level weave layer

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Create: `evals/frontier/repo_weave.py`
- Test: `tests/test_frontier_weave.py`

**Interfaces:**
- Consumes: the vendored kernel module from Task 1 (`initial_state` / `current_lines` / `update_state` / `merge_states`, imported by adding `evals/frontier/vendor` to `sys.path`).
- Produces:
  - `RepoState(files: dict[str, str], deleted_marks: frozenset, raw: dict[str, bytes], raw_touched: frozenset)` — frozen dataclass; `files` maps path → weave state for text files, `raw` maps path → bytes for binary files, `deleted_marks` is the union of file-delete records folded so far, `raw_touched` is the set of binary paths some already-folded task wrote (distinguishes base bytes from task bytes so a lone binary modifier folds clean).
  - `TaskState(task_id: str, weaves: dict[str, str], deleted: frozenset, raw: dict[str, bytes])`
  - `Conflict(path: str, kind: str, task_id: str, narration: str)` — frozen dataclass; `kind` ∈ `{"lines", "add/add", "delete/modify", "binary"}`; identity for set comparisons is `(path, kind)`.
  - `snapshot(repo: Path, ref: str) -> RepoState`
  - `publish(base: RepoState, repo: Path, base_ref: str, ref: str, task_id: str) -> TaskState`
  - `task_state_from_contents(base: RepoState, task_id: str, contents: dict) -> TaskState` — pure/no-git variant; `contents` maps path → new text (`str`), `None` (delete), or `bytes` (binary).
  - `fold(base: RepoState, frontier: RepoState, task: TaskState) -> tuple[RepoState, list[Conflict]]`
  - `manifest(state: RepoState) -> dict[str, object]` — path → normalized text (`str`) or raw `bytes`; deleted/empty-invisible files omitted.
  - `materialize(state: RepoState, dest: Path) -> None` — failure-artifact dump only, never on a comparison path.
- **Parallelization rationale:** merge semantics isolated behind `fold`/`task_state_from_contents` so the scheduling model (built concurrently) binds only to this signature — a boundary a good engineer draws anyway to keep analytics testable without git or the kernel.

**Semantics (implement exactly):**

- Text vs binary: a blob is binary iff it contains `\x00` or fails UTF-8 decode.
- Text file → lines via `content.split("\n")` after stripping exactly one trailing `"\n"` if present (empty file → `[]`); manifest re-joins with `"\n"` and appends one trailing `"\n"` when lines are non-empty (the Global Constraints normalization rule).
- `snapshot`: `git ls-tree -r -z --name-only <ref>` for paths, `git show <ref>:<path>` (as bytes, `-z`-safe) for contents; text → `initial_state(lines)` into `files`, binary → `raw`. `deleted_marks` starts empty.
- `task_state_from_contents` / `publish`: for each changed path —
  - modified text file present in base: `weaves[p] = update_state(base.files[p], new_lines)`;
  - added text file: `weaves[p] = update_state(initial_state([]), new_lines)` (weave over the empty base, so concurrent adds share a common ancestor and merge deterministically);
  - deleted file: `weaves[p] = update_state(base.files[p], [])` **and** `p` added to `deleted`;
  - binary add/modify: `raw[p] = new_bytes`; binary delete: `p` in `deleted` only.
  - `publish` derives the change list via `git diff --name-status -z --no-renames <base_ref> <ref>` (statuses A/M/D only; `--no-renames` per spec — renames are delete+add).
- `fold` (functional; never mutate inputs):
  - for each `(p, w)` in `task.weaves`: if `p` in `frontier.files`: `merged, annotated = merge_states(frontier.files[p], w)`; new `files[p] = merged`; conflict iff `annotated != current_lines(merged)`; else new `files[p] = w`, no conflict.
  - conflict `kind`: `"delete/modify"` if `p in task.deleted or p in frontier.deleted_marks`; else `"add/add"` if `p not in base.files and p not in base.raw`; else `"lines"`.
  - narration: join the annotated lines with `"\n"`, then on marker lines only (lines starting with `<<<<<<<`, `=======`, or `>>>>>>>`) replace the word `left` with `frontier` and `right` with `task.task_id`. (`merge_states` is always called with the frontier state as the first argument, so `left` is deterministically the frontier side.)
  - for each `(p, b)` in `task.raw`: conflict `("binary")` iff `p in frontier.raw_touched and frontier.raw.get(p) != b`, or `p in frontier.files` — a lone modifier of a base binary folds clean. On every fold of `p` set `raw_touched |= {p}`; on a binary conflict the surviving bytes are the lexicographically smaller of the two candidates (`min(frontier.raw[p], b)`) — an arbitrary but deterministic tiebreak so binary conflicts stay order-independent (K1); otherwise `raw[p] = b`.
  - new `deleted_marks = frontier.deleted_marks | task.deleted`; binary deletes remove `p` from `raw` when `p not in frontier.files` (text tombstones live inside the weave — no dict removal for text paths, presence is decided by `manifest`).
- `manifest`: include text path `p` iff `current_lines(files[p])` is non-empty **or** `p not in deleted_marks`; include raw paths still in `raw`. (An empty never-deleted file is present and empty; a deleted file whose merged weave still shows lines — the delete/modify survivor case — is present with those lines.)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_frontier_weave.py`:

```python
"""Repo-level weave layer: fold semantics, order-independence, idempotency."""
import sys
from itertools import permutations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import repo_weave as rw

sys.path.insert(0, str(ROOT / "evals" / "frontier" / "vendor"))
import manyana


def make_base(contents):
    files, raw = {}, {}
    for p, c in contents.items():
        if isinstance(c, bytes):
            raw[p] = c
        else:
            files[p] = manyana.initial_state(rw.split_lines(c))
    return rw.RepoState(files=files, deleted_marks=frozenset(), raw=raw)


BASE = make_base({
    "calc.py": "def calculate(x):\n    a = x * 2\n    b = a + 1\n    return b\n",
    "other.py": "VALUE = 1\n",
})


def fold_in_order(base, tasks, order):
    frontier, conflicts = base, []
    for i in order:
        frontier, cs = rw.fold(base, frontier, tasks[i])
        conflicts.extend(cs)
    return frontier, conflicts


def conflict_keys(conflicts):
    return sorted((c.path, c.kind) for c in conflicts)


def test_disjoint_files_fold_clean_any_order():
    t1 = rw.task_state_from_contents(BASE, "t1", {"calc.py": "def calculate(x):\n    return x * 2\n"})
    t2 = rw.task_state_from_contents(BASE, "t2", {"other.py": "VALUE = 2\n"})
    tasks = [t1, t2]
    results = [fold_in_order(BASE, tasks, list(o)) for o in permutations(range(2))]
    manifests = [rw.manifest(f) for f, _ in results]
    assert manifests[0] == manifests[1]
    assert all(cs == [] for _, cs in results)
    assert manifests[0]["other.py"] == "VALUE = 2\n"


def test_same_file_distant_edits_fold_clean():
    body = "\n".join(f"line{i}" for i in range(20)) + "\n"
    base = make_base({"big.py": body})
    t1 = rw.task_state_from_contents(base, "t1", {"big.py": body.replace("line1\n", "line1-edited\n")})
    t2 = rw.task_state_from_contents(base, "t2", {"big.py": body.replace("line18\n", "line18-edited\n")})
    frontier, conflicts = fold_in_order(base, [t1, t2], [0, 1])
    assert conflicts == []
    m = rw.manifest(frontier)
    assert "line1-edited" in m["big.py"] and "line18-edited" in m["big.py"]


def test_delete_modify_conflicts_and_is_order_independent():
    t_del = rw.task_state_from_contents(BASE, "t-del", {"calc.py": None})
    t_mod = rw.task_state_from_contents(
        BASE, "t-mod",
        {"calc.py": "def calculate(x):\n    a = x * 2\n    logger.debug(a)\n    b = a + 1\n    return b\n"})
    tasks = [t_del, t_mod]
    results = [fold_in_order(BASE, tasks, list(o)) for o in permutations(range(2))]
    m0, m1 = (rw.manifest(f) for f, _ in results)
    assert m0 == m1
    k0, k1 = (conflict_keys(cs) for _, cs in results)
    assert k0 == k1
    assert ("calc.py", "delete/modify") in k0
    narrations = [c.narration for _, cs in results for c in cs]
    assert any("frontier" in n or "t-del" in n or "t-mod" in n for n in narrations)


def test_add_add_identical_clean_divergent_conflicts():
    ta = rw.task_state_from_contents(BASE, "ta", {"new.py": "x = 1\n"})
    tb_same = rw.task_state_from_contents(BASE, "tb", {"new.py": "x = 1\n"})
    tb_diff = rw.task_state_from_contents(BASE, "tb", {"new.py": "x = 2\n"})
    f, cs = fold_in_order(BASE, [ta, tb_same], [0, 1])
    assert conflict_keys(cs) == []
    assert rw.manifest(f)["new.py"] == "x = 1\n"
    _, cs2 = fold_in_order(BASE, [ta, tb_diff], [0, 1])
    assert ("new.py", "add/add") in conflict_keys(cs2)


def test_fold_idempotent():
    t1 = rw.task_state_from_contents(BASE, "t1", {"calc.py": "def calculate(x):\n    return x\n"})
    f1, c1 = rw.fold(BASE, BASE, t1)
    f2, c2 = rw.fold(BASE, f1, t1)
    assert rw.manifest(f1) == rw.manifest(f2)
    assert conflict_keys(c2) == []


def test_three_task_permutations_identical():
    base = make_base({"a.py": "a1\na2\na3\n", "b.py": "b1\nb2\n"})
    tasks = [
        rw.task_state_from_contents(base, "t1", {"a.py": "a1\na2-x\na3\n"}),
        rw.task_state_from_contents(base, "t2", {"b.py": None}),
        rw.task_state_from_contents(base, "t3", {"c.py": "c1\n"}),
    ]
    outcomes = set()
    for order in permutations(range(3)):
        frontier, conflicts = fold_in_order(base, tasks, list(order))
        outcomes.add((tuple(sorted(rw.manifest(frontier).items())),
                      tuple(conflict_keys(conflicts))))
    assert len(outcomes) == 1


def test_binary_both_touch_conflicts():
    base = make_base({"img.bin": b"\x00\x01"})
    t1 = rw.task_state_from_contents(base, "t1", {"img.bin": b"\x00\x02"})
    t2 = rw.task_state_from_contents(base, "t2", {"img.bin": b"\x00\x03"})
    _, cs = fold_in_order(base, [t1, t2], [0, 1])
    assert ("img.bin", "binary") in conflict_keys(cs)


def test_snapshot_publish_roundtrip(tmp_path):
    import subprocess
    repo = tmp_path / "r"
    repo.mkdir()

    def git(*args):
        subprocess.run(["git", "-C", str(repo), *args], check=True,
                       capture_output=True, text=True)

    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    (repo / "f.py").write_text("one\ntwo\n")
    git("add", "."); git("commit", "-qm", "base")
    base_sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    (repo / "f.py").write_text("one\ntwo\nthree\n")
    (repo / "g.py").write_text("g\n")
    git("add", "."); git("commit", "-qm", "task")
    base = rw.snapshot(repo, base_sha)
    task = rw.publish(base, repo, base_sha, "HEAD", "t1")
    frontier, conflicts = rw.fold(base, base, task)
    assert conflicts == []
    m = rw.manifest(frontier)
    assert m["f.py"] == "one\ntwo\nthree\n" and m["g.py"] == "g\n"


def test_materialize_writes_tree(tmp_path):
    t1 = rw.task_state_from_contents(BASE, "t1", {"new.py": "x = 1\n"})
    frontier, _ = rw.fold(BASE, BASE, t1)
    rw.materialize(frontier, tmp_path / "out")
    assert (tmp_path / "out" / "new.py").read_text() == "x = 1\n"
    assert (tmp_path / "out" / "calc.py").exists()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3 -m pytest tests/test_frontier_weave.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'repo_weave'`.

- [ ] **Step 3: Implement `evals/frontier/repo_weave.py`**

Implement exactly the interface and semantics in the blocks above. Skeleton with the load-bearing pieces:

```python
"""Repo-level weave layer over the vendored manyana kernel (frontier probe)."""
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))
import manyana

MARKERS = ("<<<<<<<", "=======", ">>>>>>>")


def split_lines(content):
    if content == "":
        return []
    if content.endswith("\n"):
        content = content[:-1]
    return content.split("\n")


def join_lines(lines):
    return "\n".join(lines) + "\n" if lines else ""


def is_binary(data: bytes) -> bool:
    if b"\x00" in data:
        return True
    try:
        data.decode("utf-8")
        return False
    except UnicodeDecodeError:
        return True


@dataclass(frozen=True)
class RepoState:
    files: dict
    deleted_marks: frozenset
    raw: dict
    raw_touched: frozenset = frozenset()


@dataclass(frozen=True)
class TaskState:
    task_id: str
    weaves: dict
    deleted: frozenset
    raw: dict


@dataclass(frozen=True)
class Conflict:
    path: str
    kind: str      # lines | add/add | delete/modify | binary
    task_id: str
    narration: str


def _git(repo, *args) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args],
                          check=True, capture_output=True).stdout


def snapshot(repo, ref) -> RepoState:
    names = _git(repo, "ls-tree", "-r", "-z", "--name-only", ref).decode()
    files, raw = {}, {}
    for p in filter(None, names.split("\0")):
        blob = _git(repo, "show", f"{ref}:{p}")
        if is_binary(blob):
            raw[p] = blob
        else:
            files[p] = manyana.initial_state(split_lines(blob.decode()))
    return RepoState(files=files, deleted_marks=frozenset(), raw=raw)


def task_state_from_contents(base, task_id, contents) -> TaskState:
    weaves, raw, deleted = {}, {}, set()
    for p, c in contents.items():
        if c is None:
            deleted.add(p)
            if p in base.files:
                weaves[p] = manyana.update_state(base.files[p], [])
        elif isinstance(c, bytes):
            raw[p] = c
        elif p in base.files:
            weaves[p] = manyana.update_state(base.files[p], split_lines(c))
        else:
            weaves[p] = manyana.update_state(manyana.initial_state([]), split_lines(c))
    return TaskState(task_id=task_id, weaves=weaves, deleted=frozenset(deleted), raw=raw)


def publish(base, repo, base_ref, ref, task_id) -> TaskState:
    out = _git(repo, "diff", "--name-status", "-z", "--no-renames", base_ref, ref).decode()
    parts = [x for x in out.split("\0") if x]
    contents = {}
    for status, p in zip(parts[0::2], parts[1::2]):
        if status.startswith("D"):
            contents[p] = None
        else:
            blob = _git(repo, "show", f"{ref}:{p}")
            contents[p] = blob if is_binary(blob) else blob.decode()
    return task_state_from_contents(base, task_id, contents)


def _relabel(annotated, task_id):
    out = []
    for line in annotated:
        if line.startswith(MARKERS):
            line = line.replace("left", "frontier").replace("right", task_id)
        out.append(line)
    return "\n".join(out)


def fold(base, frontier, task):
    files = dict(frontier.files)
    raw = dict(frontier.raw)
    conflicts = []
    for p, w in task.weaves.items():
        if p in files:
            merged, annotated = manyana.merge_states(files[p], w)
            files[p] = merged
            if annotated != manyana.current_lines(merged):
                if p in task.deleted or p in frontier.deleted_marks:
                    kind = "delete/modify"
                elif p not in base.files and p not in base.raw:
                    kind = "add/add"
                else:
                    kind = "lines"
                conflicts.append(Conflict(p, kind, task.task_id, _relabel(annotated, task.task_id)))
        else:
            files[p] = w
            if p in frontier.deleted_marks and p not in task.deleted:
                conflicts.append(Conflict(p, "delete/modify", task.task_id,
                                          "file deleted in frontier; re-modified by " + task.task_id))
    raw_touched = set(frontier.raw_touched)
    for p, b in task.raw.items():
        if (p in raw_touched and raw.get(p) != b) or p in files:
            conflicts.append(Conflict(p, "binary", task.task_id,
                                      "binary path touched concurrently: " + p))
            if p in raw:
                raw[p] = min(raw[p], b)  # deterministic tiebreak: K1 holds for binaries
        else:
            raw[p] = b
        raw_touched.add(p)
    for p in task.deleted:
        if p in raw:
            del raw[p]
    return (RepoState(files=files,
                      deleted_marks=frontier.deleted_marks | task.deleted,
                      raw=raw,
                      raw_touched=frozenset(raw_touched)),
            conflicts)


def manifest(state):
    out = {}
    for p, w in state.files.items():
        lines = manyana.current_lines(w)
        if lines or p not in state.deleted_marks:
            out[p] = join_lines(lines)
    out.update(state.raw)
    return out


def materialize(state, dest):
    dest = Path(dest)
    for p, content in manifest(state).items():
        target = dest / p
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            target.write_bytes(content)
        else:
            target.write_text(content)
```

One subtlety to preserve from the tests: `fold` must handle the frontier-deleted-then-modified path (`p` absent from `files` because it never existed there — cannot happen for text, whose tombstones stay in `files`; the `else` branch above covers a task re-adding a path another task deleted where the weave is present, and the `deleted_marks` check narrates it).

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3 -m pytest tests/test_frontier_weave.py -v
```

Expected: all PASS. Debug semantics against the vendored kernel, never by weakening assertions — order-independence (`test_three_task_permutations_identical`) is a hard spec gate (K1).

- [ ] **Step 5: Run the full suite and commit**

```bash
python3 -m pytest
git add evals/frontier/repo_weave.py tests/test_frontier_weave.py
git commit -m "feat(frontier): repo-level weave layer (RepoState/TaskState/fold)"
```

---

### Task 3: Scheduling model

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/frontier/schedule_model.py`
- Test: `tests/test_frontier_schedule.py`

**Interfaces:**
- Consumes: the compiled-plan JSON shape produced by the existing plan compiler script (`tasks[].id`, `tasks[].disposition`, `dag_edges[]` as `{"from","to","why"}`, `waves` as `list[list[id]]`) — read as plain dicts, no import of engine code. Also a generic fold callable with signature `fold_fn(base, frontier, task) -> (frontier, list)` — supplied by callers; this module never imports the weave layer.
- Produces:
  - `SAME_FILE_WHYS = frozenset({"write-after-create", "write-after-write", "ambiguous-files"})`
  - `waves_makespan(waves: list, durations: dict) -> float`
  - `frontier_makespan(task_ids: list, edges: list, durations: dict) -> float` — `edges` are `{"from","to","why"}` dicts; longest weighted path.
  - `drop_same_file_edges(edges: list) -> list`
  - `fold_all(fold_fn, base, tasks: list, order: list) -> tuple` — folds `tasks[i]` for `i` in `order`; returns `(frontier, conflicts)`.
  - `sampled_orders(n: int, seed: int = 42) -> list[list[int]]` — all permutations for `n <= 4`, else 20 seeded shuffles (always including identity).
  - `bisect_single(tasks: list, is_red) -> tuple` — `is_red(subset) -> bool` where `subset` is a sub-list of `tasks` (elements, not indices), monotone single-culprit; returns `(culprit_element, probes)` with `probes <= ceil(log2(len(tasks)))`.
  - `isolate_min_set(tasks: list, is_red) -> tuple` — greedy ddmin-style reduction for interaction failures; returns `(surviving_elements_in_input_order, probes)`; elements need not be order-comparable (no sorting); measured, not gated.
- **Parallelization rationale:** pure analytics over plan JSON + an injected fold callable; independent of the weave layer by design (test with fakes), so it builds in the same wave as Task 1/Task 2's chain without file or interface contact.

**PRIOR ATTEMPT (2026-08-09, run wf_fe05bc69-a22):** completed cleanly once;
the merge was blocked by run machinery, not content. Commit `0488619` on branch
`worktree-wf_fe05bc69-a22-4` carries both files, review-verdict clean. Reuse it
(`git checkout 0488619 -- evals/frontier/schedule_model.py tests/test_frontier_schedule.py`)
and then apply this plan's deltas, which resolve that run's review findings:
`isolate_min_set` must return surviving elements in input order with no
`sorted()` call, and the tests below now use non-index, non-order-comparable
elements plus the `probes == len(probes_seen)` assertion. If the branch is
gone, implement from scratch per the steps.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_frontier_schedule.py`:

```python
"""Closed-form makespans, fold replay, and structural bisection."""
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import schedule_model as sm

DUR = {"1": 10.0, "2": 20.0, "3": 5.0, "4": 8.0}


def test_waves_makespan_sum_of_maxima():
    waves = [["1", "3"], ["2"], ["4"]]
    assert sm.waves_makespan(waves, DUR) == 10.0 + 20.0 + 8.0


def test_frontier_makespan_is_critical_path():
    edges = [{"from": "1", "to": "2", "why": "marker"},
             {"from": "3", "to": "4", "why": "marker"}]
    # chains: 1->2 = 30, 3->4 = 13
    assert sm.frontier_makespan(["1", "2", "3", "4"], edges, DUR) == 30.0


def test_drop_same_file_edges():
    edges = [{"from": "1", "to": "2", "why": "marker"},
             {"from": "1", "to": "2", "why": "write-after-write"},
             {"from": "3", "to": "4", "why": "ambiguous-files"},
             {"from": "3", "to": "4", "why": "write-after-create"}]
    kept = sm.drop_same_file_edges(edges)
    assert [e["why"] for e in kept] == ["marker"]


def test_fold_all_uses_order_and_collects_conflicts():
    calls = []

    def fake_fold(base, frontier, task):
        calls.append(task)
        return frontier + [task], (["c-" + task] if task == "bad" else [])

    frontier, conflicts = sm.fold_all(fake_fold, [], ["a", "bad", "b"], [2, 0, 1])
    assert calls == ["b", "a", "bad"]
    assert frontier == ["b", "a", "bad"]
    assert conflicts == ["c-bad"]


def test_sampled_orders_small_is_exhaustive_large_is_seeded():
    assert len(sm.sampled_orders(3)) == 6
    big = sm.sampled_orders(10)
    assert len(big) == 20
    assert list(range(10)) in big
    assert big == sm.sampled_orders(10)  # deterministic


def test_bisect_single_finds_culprit_within_log_bound():
    # Elements are deliberately NOT their own indices, and n=13 is not a power
    # of two — both guard the contract (elements returned, bound still holds).
    tasks = ["t%d" % i for i in range(13)]
    culprit = "t11"

    probes_seen = []

    def is_red(subset):
        probes_seen.append(list(subset))
        return culprit in subset

    found, probes = sm.bisect_single(tasks, is_red)
    assert found == culprit
    assert probes == len(probes_seen)  # self-reported count matches reality
    assert probes <= math.ceil(math.log2(len(tasks)))


def test_isolate_min_set_pairwise():
    # dict elements: unhashable-in-sets is fine, but they are NOT order-
    # comparable, so this also guards the no-sorting contract.
    tasks = [{"id": i} for i in range(8)]
    pair = [{"id": 2}, {"id": 5}]

    probes_seen = []

    def is_red(subset):
        probes_seen.append(1)
        return all(p in subset for p in pair)

    found, probes = sm.isolate_min_set(tasks, is_red)
    assert found == pair  # input order preserved
    assert probes == len(probes_seen)
    assert probes > 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3 -m pytest tests/test_frontier_schedule.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'schedule_model'`.

- [ ] **Step 3: Implement `evals/frontier/schedule_model.py`**

```python
"""Closed-form scheduling model + generic fold replay + structural bisection."""
import math
import random
from itertools import permutations

SAME_FILE_WHYS = frozenset({"write-after-create", "write-after-write",
                            "ambiguous-files"})


def waves_makespan(waves, durations):
    return float(sum(max(durations[t] for t in wave) for wave in waves if wave))


def frontier_makespan(task_ids, edges, durations):
    upstream = {t: [] for t in task_ids}
    for e in edges:
        if e["from"] in upstream and e["to"] in upstream:
            upstream[e["to"]].append(e["from"])
    memo = {}

    def finish(t):
        if t not in memo:
            memo[t] = durations[t] + max((finish(u) for u in upstream[t]),
                                         default=0.0)
        return memo[t]

    return float(max(finish(t) for t in task_ids)) if task_ids else 0.0


def drop_same_file_edges(edges):
    return [e for e in edges if e["why"] not in SAME_FILE_WHYS]


def fold_all(fold_fn, base, tasks, order):
    frontier, conflicts = base, []
    for i in order:
        frontier, cs = fold_fn(base, frontier, tasks[i])
        conflicts.extend(cs)
    return frontier, conflicts


def sampled_orders(n, seed=42):
    if n <= 4:
        return [list(p) for p in permutations(range(n))]
    rng = random.Random(seed)
    orders = [list(range(n))]
    while len(orders) < 20:
        o = list(range(n))
        rng.shuffle(o)
        orders.append(o)
    return orders


def bisect_single(tasks, is_red):
    lo, hi = 0, len(tasks)
    probes = 0
    while hi - lo > 1:
        mid = (lo + hi) // 2
        probes += 1
        if is_red(tasks[lo:mid]):
            hi = mid
        else:
            lo = mid
    return tasks[lo], probes


def isolate_min_set(tasks, is_red):
    # Returns surviving ELEMENTS in input order — never sorts (elements may not
    # be order-comparable, e.g. dicts).
    current = list(tasks)
    probes = 0
    changed = True
    while changed:
        changed = False
        for t in list(current):
            trial = [x for x in current if x is not t]
            probes += 1
            if is_red(trial):
                current = trial
                changed = True
    return current, probes
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3 -m pytest tests/test_frontier_schedule.py -v
```

Expected: all PASS. Note `bisect_single`'s bound: each probe halves the candidate range, so probes ≤ ⌈log₂ n⌉ — the S2 hard gate.

- [ ] **Step 5: Run the full suite and commit**

```bash
python3 -m pytest
git add evals/frontier/schedule_model.py tests/test_frontier_schedule.py
git commit -m "feat(frontier): closed-form scheduling model, fold replay, bisection"
```

---

### Task 4: Eval runner — fixture and same-file tracks, roll-up report

**Type:** implementation
**Depends-on:** 1, 2, 3

**Files:**
- Create: `evals/frontier/run_eval.py`
- Create: `evals/frontier/results/.gitkeep`
- Test: `tests/test_frontier_run_eval.py`

**Interfaces:**
- Consumes: `RepoState` / `task_state_from_contents` / `fold` / `manifest` / `Conflict` (Task 2); `waves_makespan` / `frontier_makespan` / `drop_same_file_edges` / `fold_all` / `sampled_orders` (Task 3); the vendored kernel (Task 1, transitively via the weave layer). Invokes the existing plan compiler by subprocess: `python3 skills/ultrapowers/scripts/compile_plan.py <plan.md>` (read-only use of a committed script — not a modification of it).
- Produces:
  - `run_tracks(tracks: list, out_dir: Path, repo: Path = None, seed: int = 42) -> dict` — executes the named tracks (`"a"`, `"b"`; `"c"` is added by a later task and until then reports itself unavailable in the summary rather than crashing), writes one JSON per case into `out_dir`, plus `rollup.md`.
  - `fixture_cases(seed: int) -> list[dict]` — track (a): one case per plan-bearing fixture (`wide`, `chained`, `mixed`, `flawed`, `degrade`, `webapp`), each `{"name", "compiled", "base", "tasks", "durations"}` where `compiled` is the compiler JSON, `base` a synthetic `RepoState`, `tasks` a list of `TaskState`, `durations` seeded `uniform(60, 600)` per implementation task (reported as modeled).
  - `synthetic_cases() -> list[dict]` — track (b): the five spec scenarios (below), each `{"name", "base", "tasks", "expect_conflict": bool, "expect_kinds": list, "contiguity_paths": list}`.
  - CLI: `python3 evals/frontier/run_eval.py --tracks a,b --out evals/frontier/results [--seed 42]`.
- **Parallelization rationale:** none — this is the integration consumer of Tasks 1–3; its dependencies are genuine data/interface edges.

**Track (a) synthetic diffs (per the spec):** for each fixture task, read its compiled `writes` list; for each written path, the task's contribution is a generated file `"""# <path> generated for frontier eval\ndef task_<id>_<slug>():\n    return "<id>"\n"""` (slug = path stem, non-alphanumerics replaced with `_`). Paths written by multiple tasks (rare in fixtures) get per-task distinct function blocks appended to a shared 10-line base file so weave merging is actually exercised. The base `RepoState` contains only the shared-path base files; solo-written paths are adds. Fixtures whose compilation degrades (e.g. `flawed`) still run — the case records `compiled["mode"]` and `degrade_reason` in its JSON rather than being skipped (no-silent-caps); if a fixture cannot produce tasks at all it is recorded as `{"name": ..., "excluded": "<reason>"}` in the summary.

**Track (b) scenarios (exact set):**

1. `disjoint-functions` — 30-line base file with three 10-line functions; two tasks each rewrite a different function. Expect: clean, no conflicts.
2. `adjacent-lines` — two tasks edit immediately adjacent lines of one file. Expect: conflict (`lines`).
3. `delete-vs-modify` — one task deletes the file, the other inserts a line mid-function (the manyana README showcase). Expect: conflict (`delete/modify`).
4. `add-add-divergent` + `add-add-identical` — both tasks create the same new path, with different / identical content. Expect: conflict (`add/add`) / clean.
5. `four-way-fanin` — four tasks each append their own function block to one shared file. Expect: whatever conflicts arise are recorded; hard assertion is **no interleaving** — each task's block appears contiguously in the merged manifest (check with `content.find(block) >= 0` for the joined block text).

**Per-case JSON shape:**

```json
{
  "name": "wide", "track": "a",
  "makespans": {"waves": 0.0, "frontier": 0.0, "frontier_no_same_file": 0.0,
                 "durations_modeled": true},
  "folds": {"orders_sampled": 0, "k1_identical": true},
  "conflicts": [{"path": "", "kind": "", "task": "", "narration": ""}],
  "excluded": null
}
```

(`makespans` is null for track-b cases; `k1_identical` means every sampled order produced an identical `(manifest, sorted (path, kind) conflict keys)` pair.)

**`rollup.md` sections (exact headings):** `# Frontier probe — roll-up`, `## Makespans (track a)` (table: fixture, waves, frontier, frontier w/o same-file edges, delta %), `## K-gate summary` (K1/K2/K4 pass-fail per the runs performed; K3 line reads `not evaluated (track c not run)` until track c exists), `## Track (b) narrations (S3 — operator grades these)` (every conflicted track-b case's verbatim narration in a fenced block), `## Exclusions` (every excluded case with reason, or `none`).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_frontier_run_eval.py`:

```python
"""Eval runner: fixture + synthetic tracks, JSON cases, roll-up report."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import run_eval


def test_fixture_cases_cover_all_plan_fixtures():
    cases = run_eval.fixture_cases(seed=42)
    names = {c["name"] for c in cases}
    assert names == {"wide", "chained", "mixed", "flawed", "degrade", "webapp"}


def test_synthetic_cases_shape():
    cases = run_eval.synthetic_cases()
    names = [c["name"] for c in cases]
    assert "delete-vs-modify" in names and "four-way-fanin" in names
    for c in cases:
        assert c["base"] is not None and len(c["tasks"]) >= 2


def test_run_tracks_a_b_writes_cases_and_rollup(tmp_path):
    summary = run_eval.run_tracks(["a", "b"], tmp_path, seed=42)
    files = sorted(p.name for p in tmp_path.glob("*.json"))
    assert any(f.startswith("a-wide") for f in files)
    assert any(f.startswith("b-delete-vs-modify") for f in files)
    rollup = (tmp_path / "rollup.md").read_text()
    assert "## Makespans (track a)" in rollup
    assert "## K-gate summary" in rollup
    assert "not evaluated (track c not run)" in rollup
    assert "## Track (b) narrations (S3" in rollup
    assert "## Exclusions" in rollup
    # b-track expectations enforced
    dvm = json.loads((tmp_path / "b-delete-vs-modify.json").read_text())
    assert any(c["kind"] == "delete/modify" for c in dvm["conflicts"])
    assert summary["k_gates"]["K1"] is True
    assert summary["k_gates"]["K4_no_interleaving"] is True


def test_track_a_case_records_makespans_and_k1(tmp_path):
    run_eval.run_tracks(["a"], tmp_path, seed=42)
    wide = json.loads((tmp_path / "a-wide.json").read_text())
    ms = wide["makespans"]
    assert ms["durations_modeled"] is True
    assert ms["frontier"] <= ms["waves"]
    assert ms["frontier_no_same_file"] <= ms["frontier"] + 1e-9
    assert wide["folds"]["k1_identical"] is True
    assert wide["folds"]["orders_sampled"] >= 2


def test_disjoint_functions_clean_adjacent_conflicts(tmp_path):
    run_eval.run_tracks(["b"], tmp_path, seed=42)
    clean = json.loads((tmp_path / "b-disjoint-functions.json").read_text())
    assert clean["conflicts"] == []
    adj = json.loads((tmp_path / "b-adjacent-lines.json").read_text())
    assert len(adj["conflicts"]) >= 1
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3 -m pytest tests/test_frontier_run_eval.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'run_eval'`.

- [ ] **Step 3: Implement `evals/frontier/run_eval.py`**

Structure (implement fully — the fixture/synthetic builders per the two spec blocks above, then the driver):

```python
"""Frontier probe eval runner: corpus tracks, per-case JSON, roll-up report."""
import argparse
import json
import random
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import repo_weave as rw
import schedule_model as sm

FIXTURES = ["wide", "chained", "mixed", "flawed", "degrade", "webapp"]
COMPILER = ROOT / "skills" / "ultrapowers" / "scripts" / "compile_plan.py"


def compile_fixture(name):
    plan = ROOT / "evals" / "fixtures" / name / "plan.md"
    out = subprocess.run([sys.executable, str(COMPILER), str(plan)],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)
```

- `fixture_cases(seed)`: per fixture, compile; implementation tasks only; build base/tasks per the Track (a) synthetic-diff rules; durations `random.Random(seed).uniform(60, 600)` per task. Makespans read the compiler's `compiled["waves"]` (plain lists of task-id strings) and `compiled["dag_edges"]` — never `launch_waves`, which is a launch-payload variant carrying entry dicts.
- `synthetic_cases()`: the five Track (b) scenarios verbatim.
- `run_case(case)`: `orders = sm.sampled_orders(len(tasks))`; fold every order via `sm.fold_all(rw.fold, base, tasks, order)`; `k1_identical` = all `(manifest, conflict-key)` pairs equal; makespans from `sm.waves_makespan` / `sm.frontier_makespan(ids, edges, dur)` / `sm.frontier_makespan(ids, sm.drop_same_file_edges(edges), dur)` for track a; K4 contiguity check for `four-way-fanin`; K2 spot-check = re-fold the first task into the final frontier and assert manifest+conflict-keys unchanged (record as `k2_idempotent`).
- `run_tracks(tracks, out_dir, repo=None, seed=42)`: run cases, write `<track>-<name>.json`, aggregate `k_gates` (`K1`, `K2`, `K4_no_interleaving`; `K3` = `"not evaluated (track c not run)"` when `"c"` not in tracks — a later task supplies track c), write `rollup.md` with the exact headings from the block above, return the summary dict.
- `if __name__ == "__main__":` argparse CLI per the Produces block.

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3 -m pytest tests/test_frontier_run_eval.py -v
```

Expected: all PASS. If a fixture case surprises (e.g. `flawed` degrades), record it per the no-silent-caps rule rather than special-casing it out.

- [ ] **Step 5: Run the full suite and commit**

```bash
python3 -m pytest
git add evals/frontier/run_eval.py evals/frontier/results/.gitkeep tests/test_frontier_run_eval.py
git commit -m "feat(frontier): eval runner - fixture + same-file tracks, roll-up report"
```

---

### Task 5: Archived-run replay (track c)

**Type:** implementation
**Depends-on:** 2, 4
**Review:** adversarial

**Files:**
- Modify: `evals/frontier/run_eval.py`
- Test: `tests/test_frontier_track_c.py`

**Interfaces:**
- Consumes: `snapshot` / `publish` / `fold` / `manifest` (Task 2); `sampled_orders` / `fold_all` (Task 3); the runner/report plumbing of Task 4 (`run_tracks` dispatch, per-case JSON shape, roll-up sections).
- Produces:
  - `extract_archived_runs(repo: Path) -> dict` — `{"runs": [run...], "excluded": [{"ref", "reason"}...]}`; each run is `{"ref": <integration merge sha>, "groups": [{"base_sha", "tasks": [{"task_id", "tip_sha"}], "after_sha"}...]}` where a group is one wave (tasks sharing a merge-base) and `after_sha` is the integration commit after that group's last merge.
  - `run_track_c(repo: Path, out_dir: Path, seed: int = 42) -> dict` — replays each group's tasks in sampled orders via `publish` + `fold`, checks fidelity, writes `c-<shortsha>.json` cases and feeds the roll-up: `K3` = `true` only if `len(runs) >= 3` and zero silent divergence; `"not evaluated (recovered-n=<n> below floor 3)"` when under floor.
  - `run_tracks` accepts `"c"` and requires `repo` for it (CLI `--repo`, default the repo root).
- **Parallelization rationale:** none — extends the runner file Task 4 owns (genuine same-file dependency) and consumes Task 2's git-backed API.

**Extraction mechanism (implement exactly):**

1. Candidate integration merges on main: `git log <mainline> --merges --first-parent --format=%H%x00%P%x00%s`, keeping commits whose subject contains `ultra/integration-`.
2. For each candidate `M`: the integration tip is `M`'s second parent. Walk the integration chain: `git rev-list --first-parent <tip>` down to the fork point (`git merge-base <M^1> <tip>`).
3. Every commit on that chain must be a merge commit (2 parents). Any non-merge commit on the chain (a reconciliation/fix commit) makes per-task diff extraction lossy → exclude the whole run with reason `"reconciliation commit <sha> on integration chain"` (no-silent-caps: it lands in `excluded`).
4. For each merge commit `m` on the chain (oldest first): task tip = `m`'s second parent; the task's base = `git merge-base <m^1> <m^2>`. Consecutive merges sharing the same base form one **group** (a wave); the group's `after_sha` is the last merge commit of the group.
5. Replay per group: `base = snapshot(repo, base_sha)`; `tasks = [publish(base, repo, base_sha, tip, task_id=tip[:8]) ...]`; fold in `sampled_orders(len(tasks))`; **fidelity** = for every path in any task's change set that produced no conflict in the replay, folded manifest content must equal the same path's content at `after_sha` (normalized per Global Constraints; compare via `snapshot(repo, after_sha)`'s manifest). A clean-path mismatch is **silent divergence** — the K3 failure condition. Conflicted paths are recorded but exempt from strict equality (the historical merge may have hand-resolved them).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_frontier_track_c.py` (builds a miniature integration-shaped repo in `tmp_path` — no dependence on real repo history in CI):

```python
"""Track (c): archived-run extraction and replay fidelity, on a synthetic repo."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import run_eval


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def build_integration_repo(tmp_path, with_reconciliation=False):
    repo = tmp_path / "r"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    (repo / "a.py").write_text("a1\na2\n")
    (repo / "b.py").write_text("b1\nb2\n")
    git(repo, "add", "."); git(repo, "commit", "-qm", "base")
    base = git(repo, "rev-parse", "HEAD")
    # two task branches off base
    git(repo, "checkout", "-qb", "task1", base)
    (repo / "a.py").write_text("a1-edited\na2\n")
    git(repo, "commit", "-qam", "task1 work")
    git(repo, "checkout", "-qb", "task2", base)
    (repo / "b.py").write_text("b1\nb2\nb3\n")
    git(repo, "commit", "-qam", "task2 work")
    # integration branch: merge both
    git(repo, "checkout", "-qb", "ultra/integration-test", base)
    git(repo, "merge", "-q", "--no-ff", "task1", "-m", "merge task1")
    git(repo, "merge", "-q", "--no-ff", "task2", "-m", "merge task2")
    if with_reconciliation:
        (repo / "a.py").write_text("a1-reconciled\na2\n")
        git(repo, "commit", "-qam", "fix after merge")
    tip = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", tip,
        "-m", "Merge branch 'ultra/integration-test'")
    return repo


def test_extract_finds_clean_run(tmp_path):
    repo = build_integration_repo(tmp_path)
    result = run_eval.extract_archived_runs(repo)
    assert result["excluded"] == []
    assert len(result["runs"]) == 1
    groups = result["runs"][0]["groups"]
    assert sum(len(g["tasks"]) for g in groups) == 2


def test_reconciliation_run_excluded_by_name(tmp_path):
    repo = build_integration_repo(tmp_path, with_reconciliation=True)
    result = run_eval.extract_archived_runs(repo)
    assert result["runs"] == []
    assert len(result["excluded"]) == 1
    assert "reconciliation commit" in result["excluded"][0]["reason"]


def test_replay_fidelity_and_floor(tmp_path):
    repo = build_integration_repo(tmp_path)
    out = tmp_path / "out"
    out.mkdir()
    summary = run_eval.run_track_c(repo, out, seed=42)
    cases = list(out.glob("c-*.json"))
    assert len(cases) == 1
    case = json.loads(cases[0].read_text())
    assert case["fidelity"]["silent_divergence"] == []
    # one recovered run < floor of 3 -> K3 not evaluated, stated with n
    assert summary["K3"] == "not evaluated (recovered-n=1 below floor 3)"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3 -m pytest tests/test_frontier_track_c.py -v
```

Expected: FAIL with `AttributeError: module 'run_eval' has no attribute 'extract_archived_runs'`.

- [ ] **Step 3: Implement track c in `evals/frontier/run_eval.py`**

Add `extract_archived_runs` and `run_track_c` per the extraction mechanism block, wire `"c"` into `run_tracks` (requiring `repo`), extend the roll-up: the `## K-gate summary` K3 line becomes `true` / `false (silent divergence: <paths>)` / `not evaluated (recovered-n=<n> below floor 3)`, and a new `## Track (c) recovered runs` section lists every recovered run's short sha and every exclusion with its reason. Case JSON adds a `"fidelity": {"paths_checked": int, "silent_divergence": [], "conflicted_paths": []}` block.

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3 -m pytest tests/test_frontier_track_c.py tests/test_frontier_run_eval.py -v
```

Expected: all PASS, including Task 4's tests (the runner file changed — its existing behavior must not regress).

- [ ] **Step 5: Run the full suite and commit**

```bash
python3 -m pytest
git add evals/frontier/run_eval.py tests/test_frontier_track_c.py
git commit -m "feat(frontier): track c - archived-run extraction and replay fidelity"
```

---

### Task 6: Full-suite verification

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5

**Files:** (none — verification only)

- [ ] **Step 1: Run the complete test suite**

```bash
python3 -m pytest
```

Expected: all tests pass — the pre-existing suite plus the five new `test_frontier_*` files, with zero modifications outside `evals/frontier/`, `tests/`, and `docs/`.

---

## Post-merge runbook (operator)

Not part of the waves — the probe's actual measurement run, performed after merge:

1. `python3 evals/frontier/run_eval.py --tracks a,b,c --repo . --out evals/frontier/results/`
2. Read `evals/frontier/results/rollup.md`; grade the Track (b) narrations (S3) and record the grade in the results doc.
3. Commit `evals/frontier/results/` (the committed-eval-results convention).
4. Adjudicate the spec's decision rule: K1–K4 + a material S1 delta → increment two may be proposed; otherwise shelve with the report as evidence.
