# Fold Corpus Replayer Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the corpus extractor and the two-arm fold replayer that retroactively validate the live fold-only merge path against git's answer (Tier-1 gate, map #360).

**Architecture:** A shared corpus data model (`corpuslib.py`) defines the on-disk corpus layout, the `ArmResult` answer shape, and a synthetic fixture builder that drives the real kernel CLI. Three consumers build against it: an extractor that turns rescued `sandbox-logs.tgz` evidence into a committed corpus, Arm W (the weave's answer via `frontier_fold.rehydrate` plus a fresh-fold determinism re-check), and Arm G (sequential git three-way merges) with the five-class comparator and the two mechanical ride-along predicates. A CLI ties them into one results JSON + rendered markdown of the pre-registered readings.

**Tech Stack:** Python 3 (stdlib + git subprocess only), pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`

**Acceptance:** suite — the committed fixture-corpus tests are the verification; the real-corpus replay is a post-merge manual step whose GO/NO verdict the results doc records.

## Global Constraints

- New code lives only under `evals/frontier/` and `tests/`; `skills/ultrapowers/kernel/vendor/manyana.py`, `skills/ultrapowers/scripts/gate_check.py`, `skills/ultrapowers/scripts/ultra_gate.py`, `skills/ultrapowers/scripts/run_acceptance.sh`, and everything under `fleet/` are byte-identical in the final diff.
- The replayer and every test run offline and deterministically: no network, no model calls, no `anthropic` import anywhere in the diff.
- Arm G merges use strategy `ort` with rename detection disabled (`-X no-renames`), matching the kernel's rename-blind `--no-renames` patches.
- Every test writes only under pytest `tmp_path`; no fixed ports, no shared on-disk fixtures.

---

### Task 1: Corpus contract — data model, layout, and the fixture builder

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/frontier/corpuslib.py`
- Test: `tests/test_corpuslib.py`

**Interfaces:**
- Produces: `CorpusEntry` (dataclass: `run_id: str, wave: int, base_sha: str, mode: str, wave_dir: pathlib.Path` — `mode` is `"patch"` or `"branch"`); `PathAnswer` (dataclass: `status: str, content: bytes | None` — `status` is `"clean"`, `"contended"`, or `"binary"`); `ArmResult` (dataclass: `per_path: dict[str, PathAnswer], complete: bool`); `load_corpus_index(corpus_root: Path) -> list[CorpusEntry]`; `write_corpus_index(corpus_root: Path, entries: list[CorpusEntry]) -> None`; `make_fixture_corpus(dest: Path) -> tuple[Path, Path]` (returns `(repo_path, corpus_root)`)

**Parallelization rationale:** contract-first — Tasks 2, 3, and 4 all consume `CorpusEntry`/`ArmResult` and the fixture builder, and can build in parallel against it; a good engineer would fix the data model of a two-arm comparison harness first regardless of parallelism.

The corpus layout this task owns (the spec's Deliverable A shape):

```
<corpus_root>/corpus-index.json                 # [{runId, wave, baseSha, mode, tasks: [ids], skipped: null|reason}]
<corpus_root>/<runId>/wave-<n>/fold_log.jsonl   # patch fields rewritten corpus-relative
<corpus_root>/<runId>/wave-<n>/task-<id>.patch
```

`make_fixture_corpus(dest)` builds a scratch git repo (`dest/repo`, `git init`, one base commit of 3–4 text files plus one small binary file) and drives the **real kernel CLI** (`skills/ultrapowers/kernel/fold_wave.py fold --patch …` — import path per the mechanism `tests/test_frontier_kernel.py` already uses) to produce genuine fold logs for four waves, one per scenario:

1. two patches on disjoint files → every path lands class 1 (agreement);
2. two patches appending different lines at the same anchor of one file → the weave unions or narrates while git conflicts (class 3 material) — seed it as the commuting-appends shape so the class-2 mechanical-equivalence branch is also reachable;
3. two patches where one rewrites a region the other edits inside → both arms contend (class 5), and the region's context includes a line occurring twice in the base (the XaXbX-flag seed);
4. one patch deleting lines within 3 lines of the other patch's hunk span on the same file, plus an edit to the binary file (deletion-adjacency + binary-exclusion seeds).

- [ ] **Step 1: Write the failing tests** — exact assertions:

```python
def test_index_roundtrip(tmp_path):
    entries = [corpuslib.CorpusEntry("run-9", 1, "a" * 40, "patch", tmp_path / "run-9" / "wave-1")]
    corpuslib.write_corpus_index(tmp_path, entries)
    loaded = corpuslib.load_corpus_index(tmp_path)
    assert [(e.run_id, e.wave, e.base_sha, e.mode) for e in loaded] == [("run-9", 1, "a" * 40, "patch")]

def test_load_refuses_missing_index(tmp_path):
    with pytest.raises(FileNotFoundError, match="corpus-index.json"):
        corpuslib.load_corpus_index(tmp_path)

def test_fixture_corpus_shape(tmp_path):
    repo, corpus = corpuslib.make_fixture_corpus(tmp_path)
    entries = corpuslib.load_corpus_index(corpus)
    assert len(entries) == 4 and all(e.mode == "patch" for e in entries)
    for e in entries:
        log = (e.wave_dir / "fold_log.jsonl").read_text().splitlines()
        first = json.loads(log[0])
        assert first == {"type": "base", "sha": e.base_sha}
        # every fold event's patch path is corpus-relative and exists
        for line in log[1:]:
            ev = json.loads(line)
            if ev.get("type") == "fold" and "patch" in ev:
                assert not ev["patch"].startswith("/")
                assert (e.wave_dir / ev["patch"]).is_file()
```

- [ ] **Step 2: Run `python3 -m pytest tests/test_corpuslib.py -v` — expect FAIL (module not found)**
- [ ] **Step 3: Implement `corpuslib.py`** — dataclasses and index I/O are direct; `make_fixture_corpus` creates the scratch repo, writes each scenario's edits in throwaway clones, produces patches with `git diff --no-renames --full-index <base>`, then invokes the kernel CLI per wave to write genuine `fold_log.jsonl` files, and finally rewrites each `fold` event's `patch` field to the wave-relative filename. Sketch the glue; the four scenario contents must match the descriptions above exactly (they are the seeds later tasks' tests assert on).
- [ ] **Step 4: Run `python3 -m pytest tests/test_corpuslib.py -v` — expect PASS**
- [ ] **Step 5: Commit** — `feat(evals): corpus contract + fixture builder for the fold replayer`

---

### Task 2: The extractor — rescued tarballs → committed corpus

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `evals/frontier/corpus_extract.py`
- Test: `tests/test_corpus_extract.py`

**Interfaces:**
- Consumes: `CorpusEntry`, `write_corpus_index` (from Task 1)
- Produces: CLI `python3 evals/frontier/corpus_extract.py --evidence <dir-of-tgz> --out <corpus_root>`; `extract_tarball(tgz: Path, out_root: Path) -> list[CorpusEntry]`

Behavior to pin: for each `sandbox-logs.tgz` under `--evidence`, pull only `*/frontier/wave-*/fold_log.jsonl`, the sibling conflicts/resolve artifacts in the same wave dir, and `*/patches/task-*.patch`; lay them out per the Task-1 corpus layout; **rewrite each `fold` event's `patch` field** from its recorded absolute sandbox path to `task-<id>.patch` (wave-relative), copying the patch file beside the log; detect mode (`"patch"` if any fold event carries a `patch` field, else `"branch"`); read `base_sha` from the log's first line; a tarball with no fold logs contributes an index row with `skipped: "no fold logs"` — never silence.

- [ ] **Step 1: Write the failing tests** — build a synthetic `sandbox-logs.tgz` in `tmp_path` containing a `repo/.claude/ultrapowers/run-run-99/frontier/wave-1/fold_log.jsonl` whose fold event names `/home/exedev/absolute/task-1.patch`, plus that patch file at its in-tarball location; assert:

```python
entries = corpus_extract.extract_tarball(tgz, out)
assert entries[0].run_id == "run-99" and entries[0].mode == "patch"
ev = [json.loads(l) for l in (entries[0].wave_dir / "fold_log.jsonl").read_text().splitlines()]
folds = [e for e in ev if e["type"] == "fold"]
assert folds[0]["patch"] == "task-1.patch"
assert (entries[0].wave_dir / "task-1.patch").is_file()
```

  Add a second test: a tarball with no fold logs yields one index row with `skipped == "no fold logs"`.
- [ ] **Step 2: Run `python3 -m pytest tests/test_corpus_extract.py -v` — expect FAIL**
- [ ] **Step 3: Implement** (tarfile + json rewriting; sketch the glue), wire the CLI with argparse, call `write_corpus_index` over all tarballs' entries.
- [ ] **Step 4: Run `python3 -m pytest tests/test_corpus_extract.py -v` — expect PASS**
- [ ] **Step 5: Commit** — `feat(evals): corpus extractor for rescued fleet evidence`

---

### Task 3: Arm W — the weave's answer from the record, plus the determinism re-check

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `evals/frontier/arm_weave.py`
- Test: `tests/test_arm_weave.py`

**Interfaces:**
- Consumes: `CorpusEntry`, `PathAnswer`, `ArmResult`, `make_fixture_corpus` (from Task 1)
- Produces: `weave_answer(repo: Path, entry: CorpusEntry) -> ArmResult`; `integrity_check(repo: Path, entry: CorpusEntry) -> list[str]` (per-fold `apply_patch_tree == recorded headSha` failures, empty = clean); `determinism_check(repo: Path, entry: CorpusEntry) -> dict` (keys `matches: bool, divergence: str | None`)

Behavior to pin: `weave_answer` uses `frontier_fold.rehydrate(repo, entry.wave_dir / "fold_log.jsonl")` — the recorded log, including any recorded resolve events, IS the answer (a fresh `fold` stops at the first conflict and cannot answer for contended folds). Per-path status: `"contended"` for any path with a narrated unresolved conflict, `"binary"` for non-text candidates, else `"clean"` with the folded content. `integrity_check` re-derives each patch task's tree via `repo_weave.apply_patch_tree` and compares to the recorded `headSha`. `determinism_check` re-runs a fresh `fold_wave.py fold` over the same inputs in a scratch copy and compares the resulting conflict set (and, when the recorded fold is complete, the manifest) against the record; any mismatch is reported, never raised.

- [ ] **Step 1: Write the failing tests** — over `make_fixture_corpus`: the disjoint wave yields `complete=True` and both files' answers `status == "clean"` with content equal to each patch applied over base; the both-contend wave yields the shared path `status == "contended"`; `integrity_check` returns `[]` on every fixture entry, and returns one failure after a test mutates a byte in a corpus patch copy; `determinism_check(...)["matches"] is True` on every fixture entry. Exact assertion shape:

```python
w = arm_weave.weave_answer(repo, disjoint_entry)
assert w.complete and w.per_path["a.txt"].status == "clean"
assert arm_weave.integrity_check(repo, disjoint_entry) == []
assert arm_weave.determinism_check(repo, disjoint_entry)["matches"] is True
```

- [ ] **Step 2: Run `python3 -m pytest tests/test_arm_weave.py -v` — expect FAIL**
- [ ] **Step 3: Implement** (thin wrapper over `frontier_fold` / `repo_weave` / the CLI; import path per `tests/test_frontier_kernel.py`; sketch the glue).
- [ ] **Step 4: Run `python3 -m pytest tests/test_arm_weave.py -v` — expect PASS**
- [ ] **Step 5: Commit** — `feat(evals): arm W — recorded weave answer + determinism re-check`

---

### Task 4: Arm G, the five-class comparator, and the ride-along predicates

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Create: `evals/frontier/arm_git.py`
- Create: `evals/frontier/classify.py`
- Test: `tests/test_classify.py`

**Interfaces:**
- Consumes: `CorpusEntry`, `PathAnswer`, `ArmResult`, `make_fixture_corpus` (from Task 1)
- Produces: `git_answer(repo: Path, entry: CorpusEntry, weave: ArmResult) -> ArmResult`; `classify(weave: ArmResult, git: ArmResult) -> list[dict]` (one dict per path: `{"path", "cls" (1–5 or "binary"), "mechanically_explained": bool | None, "xaxbx": bool}`); `xaxbx_flag(base_text: str, patch_texts: list[str], path: str) -> bool`; `deletion_adjacency(entry: CorpusEntry, k: int = 3) -> list[dict]` (each `{"path", "task_del", "task_near", "deleted_line": int}`)

This task decides the spec's GO/NO verdict, so its core code is exact (adversarial review audits the diff against it).

**Parallelization rationale:** Arm G consumes only Task 1's contract — its runtime input `weave: ArmResult` is a shape, not Task 3's code — so it builds beside Arm W, and the comparator is a pure function testable without either arm.

- [ ] **Step 1: Write the failing tests** — over `make_fixture_corpus` plus hand-built `ArmResult` pairs:

```python
def test_five_classes_from_handbuilt_arms():
    W = lambda s, c=None: corpuslib.PathAnswer(s, c)
    weave = corpuslib.ArmResult({"one": W("clean", b"x\ny\n"), "two": W("clean", b"y\nx\n"),
                                 "thr": W("clean", b"a\n"), "fou": W("contended"), "fiv": W("contended"),
                                 "bin": W("binary")}, True)
    git = corpuslib.ArmResult({"one": W("clean", b"x\ny\n"), "two": W("clean", b"x\ny\n"),
                               "thr": W("contended"), "fou": W("clean", b"b\n"), "fiv": W("contended"),
                               "bin": W("binary")}, True)
    got = {v["path"]: v["cls"] for v in classify.classify(weave, git)}
    assert got == {"one": 1, "two": 2, "thr": 3, "fou": 4, "fiv": 5, "bin": "binary"}
    two = [v for v in classify.classify(weave, git) if v["path"] == "two"][0]
    assert two["mechanically_explained"] is True     # same line multiset, reordered

def test_class2_unexplained_when_content_differs():
    W = lambda s, c=None: corpuslib.PathAnswer(s, c)
    weave = corpuslib.ArmResult({"p": W("clean", b"x\n")}, True)
    git = corpuslib.ArmResult({"p": W("clean", b"z\n")}, True)
    assert classify.classify(weave, git)[0]["mechanically_explained"] is False

def test_path_in_one_arm_only_is_unexplained_class2():
    weave = corpuslib.ArmResult({"p": corpuslib.PathAnswer("clean", b"x\n")}, True)
    git = corpuslib.ArmResult({}, True)
    v = classify.classify(weave, git)[0]
    assert v["cls"] == 2 and v["mechanically_explained"] is False
```

  Plus fixture-driven tests: `git_answer` on the disjoint wave agrees with each patch applied over base (class 1 everywhere); on the same-anchor wave the shared path is conflicted on the git arm; `xaxbx_flag` is `True` for the class-5 fixture path (its hunk context contains a line occurring ≥2× in the base file) and `False` for the disjoint wave's paths; `deletion_adjacency` on the deletion-adjacency wave returns exactly one row naming the two task ids and the file, and returns `[]` on the disjoint wave.
- [ ] **Step 2: Run `python3 -m pytest tests/test_classify.py -v` — expect FAIL**
- [ ] **Step 3: Implement `classify.py`** — exact code for the verdict core:

```python
def _lines(b):
    return b.split(b"\n")

def classify(weave, git):
    out = []
    for path in sorted(set(weave.per_path) | set(git.per_path)):
        w, g = weave.per_path.get(path), git.per_path.get(path)
        if (w and w.status == "binary") or (g and g.status == "binary"):
            out.append({"path": path, "cls": "binary", "mechanically_explained": None, "xaxbx": False})
            continue
        if w is None or g is None:  # one arm never produced an answer: a defect signal, never silent
            out.append({"path": path, "cls": 2, "mechanically_explained": False, "xaxbx": False})
            continue
        wc, gc = w.status == "contended", g.status == "contended"
        if wc and gc:
            cls, expl = 5, None
        elif not wc and gc:
            cls, expl = 3, None
        elif wc and not gc:
            cls, expl = 4, None
        elif w.content == g.content:
            cls, expl = 1, None
        else:
            cls = 2
            expl = sorted(_lines(w.content)) == sorted(_lines(g.content))  # line-multiset equality
        out.append({"path": path, "cls": cls, "mechanically_explained": expl, "xaxbx": False})
    return out
```

  `xaxbx_flag(base_text, patch_texts, path)`: collect every context line (leading space) and added line (leading `+`) of every hunk targeting `path`; return `True` iff any collected line occurs ≥2 times among `base_text`'s lines. `deletion_adjacency(entry, k=3)`: parse each corpus patch's hunks per path into (deleted base line numbers, base spans); for each ordered task pair on a shared path, report a row when a deleted base line of one lies within `[start−k, end+k]` of any hunk span of the other. Both implemented as pure functions over the patch text — exact hunk-header parsing (`@@ -s,n +s2,n2 @@`), no git calls.
- [ ] **Step 4: Implement `arm_git.py`** — scratch-clone `repo` at `entry.base_sha`; for each fold-log task in recorded order, `git apply --index` its patch on a branch cut from base and commit; then merge sequentially with `git merge -X no-renames --no-edit <commit_i>`: on conflict, record the conflicted paths (their `PathAnswer` is `"contended"`), complete the merge by checking out **the weave's content** for those paths when the weave is clean there (stage `--ours` when it is not — the path is class-5 material and its content is excluded from comparison), commit, and continue with the next task. Final per-path content read from the resulting tree; binary paths reported `"binary"`. Sketch the subprocess glue; the conflict-completion rule above is exact.
- [ ] **Step 5: Run `python3 -m pytest tests/test_classify.py -v` — expect PASS**
- [ ] **Step 6: Commit** — `feat(evals): arm G + five-class comparator + ride-along predicates`

---

### Task 5: The replayer CLI and the pre-registered-readings renderer

**Type:** implementation
**Depends-on:** 1, 3, 4

**Files:**
- Create: `evals/frontier/replay_corpus.py`
- Test: `tests/test_replay_corpus.py`

**Interfaces:**
- Consumes: `load_corpus_index`, `make_fixture_corpus` (Task 1); `weave_answer`, `integrity_check`, `determinism_check` (Task 3); `git_answer`, `classify`, `xaxbx_flag`, `deletion_adjacency` (Task 4)
- Produces: CLI `python3 evals/frontier/replay_corpus.py --repo <path> --corpus <root> --out <results.json>`; `replay(repo: Path, corpus_root: Path) -> dict`; `render_results(results: dict) -> str`

Behavior to pin: `replay` iterates the index; per entry it runs integrity → weave → git → classify → ride-alongs, catching per-entry failures into a `skipped` list with reasons (unresolvable base sha, integrity failure, unreadable patch) — **skips are counted by name, never silent**. The results dict carries: per-class counts and per-run breakdown, every class-2 instance with both contents verbatim and its `mechanically_explained` flag, class-"binary" and skip counts, the XaXbX census, deletion-adjacency rows, determinism-check divergences, and the verdict line: `GO` iff replayed ≥50 and no unexplained class-2; `NO` iff any unexplained class-2; `INSUFFICIENT-CORPUS` otherwise. `render_results` emits the markdown skeleton of the spec's pre-registered readings in that order. On a corpus root without `corpus-index.json` the CLI exits 2 with a one-line refusal naming the missing file — no traceback.

- [ ] **Step 1: Write the failing tests** — over the fixture corpus:

```python
results = replay_corpus.replay(repo, corpus)
assert results["verdict"] == "INSUFFICIENT-CORPUS"        # 4 fixture folds < 50, no unexplained class-2
assert results["counts"][1] >= 1 and results["counts"][5] >= 1
assert results["skipped"] == []
md = replay_corpus.render_results(results)
assert "INSUFFICIENT-CORPUS" in md and "class 2" in md.lower()
```

  Plus: a results dict hand-built with one unexplained class-2 renders verdict `NO`; the CLI on an empty `tmp_path` corpus exits 2 and stderr names `corpus-index.json`.
- [ ] **Step 2: Run `python3 -m pytest tests/test_replay_corpus.py -v` — expect FAIL**
- [ ] **Step 3: Implement** (iteration, aggregation, argparse, renderer — sketch the glue; the verdict rule above is exact).
- [ ] **Step 4: Run `python3 -m pytest tests/test_replay_corpus.py -v`, then the full `python3 -m pytest` — expect PASS**
- [ ] **Step 5: Commit** — `feat(evals): fold-corpus replayer CLI + readings renderer`

---

### Task 6: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5

**Files:**
- Test: `python3 -m pytest`

The committed suite green, including the four new test files, with the Global Constraints holding (no diff outside `evals/frontier/`, `tests/`, and this plan/spec's docs).

---

### Task 7: Rescue the evidence off the orchestrator

**Type:** manual
**Depends-on:** none

**Files:**
- Test: `ls ~/fleet-evidence-archive/sandbox-logs`

Laptop-only (ssh credentials): copy the single-copy evidence before anything else can lose it.

```bash
mkdir -p ~/fleet-evidence-archive
rsync -av fleet-orchestrator.exe.xyz:/home/exedev/fleet-evidence/ ~/fleet-evidence-archive/
```

Evidence this is the right location and worth rescuing (recorded 2026-08-31, this session):

```
$ ssh fleet-orchestrator.exe.xyz 'ls /home/exedev/fleet-evidence/sandbox-logs'
fleet-run-10-… through fleet-run-33-…   (19 run dirs, each holding sandbox-logs.tgz)
$ # fold-log rows counted inside the tarballs: 64 total, 43 patch-input (runs 25–33)
```

The archive stays uncommitted (transcripts inside). The GO/NO verdict depends only on the corpus subset Task 8 extracts, so a partial rsync of the `sandbox-logs/` subtree alone unblocks Task 8.

---

### Task 8: Run the real replay — corpus commit, pre-registered readings, verdict

**Type:** manual
**Depends-on:** 2, 5, 7

**Files:**
- Create: `evals/frontier/corpus/` (committed corpus subset)
- Create: `evals/frontier/results/<date>-fold-corpus-validation.md`

Laptop, post-merge, in this order (the readings doc is written **before** the replay runs — that ordering is what makes the result readable):

```bash
# 1. write the results doc skeleton with the spec's pre-registered readings section, before replaying
# 2. extract the committed corpus
python3 evals/frontier/corpus_extract.py --evidence ~/fleet-evidence-archive/sandbox-logs --out evals/frontier/corpus
# 3. replay
python3 evals/frontier/replay_corpus.py --repo . --corpus evals/frontier/corpus --out /tmp/fold-corpus-results.json
# 4. paste the rendered readings into the results doc; commit corpus + results doc
```

If the verdict is `INSUFFICIENT-CORPUS`: pad with synthetic folds cut from this repo's history, marked as synthetic in both the index and the results doc, reported separately from real folds (spec pre-registration). If any class-2 is unexplained: the verdict is `NO` — publish it as a defect datum on #360 and stop sitting 3; the operator alone may accept a written explanation. Record the verdict on #360 either way.

---

## Operator smoke

- do: `python3 -c "import pathlib, sys; sys.path.insert(0, 'evals/frontier'); import corpuslib; print(corpuslib.make_fixture_corpus(pathlib.Path('/tmp/fold-demo')))"` then `python3 evals/frontier/replay_corpus.py --repo /tmp/fold-demo/repo --corpus /tmp/fold-demo/corpus --out /tmp/fold-demo/results.json`
- see: a readable markdown summary on stdout with a verdict line (`INSUFFICIENT-CORPUS` on the 4-fold demo), non-zero counts for several classes, and an explicit (possibly empty) skip section.

- do: `python3 evals/frontier/replay_corpus.py --repo . --corpus /tmp/does-not-exist --out /tmp/x.json`
- see: a one-line refusal naming `corpus-index.json`, exit code 2 — not a Python traceback.

- do: after Task 7's rsync, `python3 evals/frontier/corpus_extract.py --evidence ~/fleet-evidence-archive/sandbox-logs --out /tmp/real-corpus && head -c 400 /tmp/real-corpus/corpus-index.json`
- see: index rows naming real run ids (`run-25`…`run-33`) with 40-char base shas, and wave dirs containing `task-*.patch` files whose fold logs reference them by relative name.
