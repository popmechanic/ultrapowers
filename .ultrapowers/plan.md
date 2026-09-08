# Untrack the evals/frontier replay corpus

**Grammar:** claims-v1

**Claim:** the frontier corpus is frozen replay data (92k lines) that the compiler tests read; it belongs in the same off-repo store, with the tests reading a fixture subset. (quoted from #544)

**Goal:** #544 roadmap step 4 — the Claim above is the issue's step-4 sentence, signed by the
operator before authoring. Step 1 (`docs/superpowers/` untracked, `docs/README.md` the stub,
commit `5efce3a7`, 2026-09-02) is the precedent this plan copies for `evals/frontier`: the
frozen data leaves the index in one commit that keeps history, a tracked stub says what lived
there and where the durable copy is, and `.gitignore` keeps it out of every later commit.
Operator-chosen scope: untrack `evals/frontier/corpus/` and `evals/frontier/results/`
(388 tracked files, 55,831 lines at BASE `1c97ba44`); keep `evals/fixtures/` (the 14 sample
plan repos the compiler tests read) and the nine `evals/frontier/*.py` scripts tracked, since
eighteen files under `tests/` import those scripts. Measured at BASE and pasted into Task 1's
Context: no test reads `evals/frontier/corpus` or `evals/frontier/results` from disk — the
corpus tests replay `corpuslib.make_fixture_corpus`, the synthetic fixture corpus
`tests/conftest.py` builds once per session in a temp dir — and the whole frontier-adjacent
group (317 tests in 18 files) passes with both directories moved out of the tree. So the
"fixture subset" the tests read already exists and is generated, not copied: no file is added
under `tests/fixtures/`, no test is re-pointed, and none is skipped or deleted. This plan does
not close #544: steps 2 and 3 of its roadmap (the plan riding the assignment is done; the
durable ledger replication is #485/#484/#417) stay open, so there is no `**Closes:**` line.

**Tech Stack:** git (index and `.gitignore`), Markdown, Python 3 / pytest under `tests/`
(`python3 -m pytest` from the repo root is the suite; `pytest.ini` scopes bare collection to
`tests/`, which already keeps `evals/` out).

**Parallelization rationale:** one wave, width 2. Task 1 (`Review: peer`) is the untracking
commit — the 388 deletions, the `.gitignore` block and the stub — and Task 2 is the one
CLAUDE.md sentence that tells agents about it. They share one literal, the stub path
`evals/frontier/README.md`, written into both Contexts; neither Consumes a symbol the other
Produces (Task 2 names the stub, never reads it — the sentence is true of the folded tree, not of
Task 1's runtime behaviour), and their Files are disjoint, so no edge is derived. Task 1 is one task, not
several, because the deletions and the `.gitignore` block are one commit shape: the engine's
capture runs `git add -A` before it diffs, so a deletion without the ignore rule in the same
patch is a shape the next fix round could re-add, and the reviewer's rule makes a deletion
outside a task's Files blocking — every deleted path is therefore in Task 1's own Files.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- evals/fixtures evals/results evals/ab_auth.py evals/ab_lib.py evals/ab_runner.py evals/check_renders_ab.py evals/judge.py evals/judge-prompt.md evals/frontier/arm_git.py evals/frontier/arm_weave.py evals/frontier/classify.py evals/frontier/corpus_extract.py evals/frontier/corpuslib.py evals/frontier/replay_corpus.py evals/frontier/run_eval.py evals/frontier/schedule_model.py evals/frontier/synth_corpus.py tests fleet skills pytest.ini`
- The Check above is the scope pin: this run touches only `.gitignore`, `CLAUDE.md`, the new
  `evals/frontier/README.md` and the 388 paths under `evals/frontier/corpus/` and
  `evals/frontier/results/` that leave the index. `evals/fixtures/` stays tracked, the nine
  frontier scripts stay tracked, and no test file changes.
- The deletion keeps history: files leave the index, no commit is rewritten, and the stub names
  the paths so `git log -- evals/frontier/corpus` remains the way to read them.
- No Markdown written by this run names a mechanism that is not in the tree: the stub and the
  CLAUDE.md sentence name `corpus_extract.py`, `synth_corpus.py`, `corpuslib.make_fixture_corpus`
  and `tests/conftest.py`, all present at BASE.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The corpus and results leave the index; a stub and an ignore rule stay

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `.gitignore`
- Create: `evals/frontier/README.md`
- Modify: `evals/frontier/corpus/20260827-200331/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/20260827-200331/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/20260827-200331/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/20260828114629/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/20260828114629/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/20260828114629/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/corpus-index.json`
- Modify: `evals/frontier/corpus/p0b-20260828-103837/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/p0b-20260828-103837/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/p0b-20260828-103837/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-23/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/run-23/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-23/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-25/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/run-25/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-25/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-25/wave-1/task-2.patch`
- Modify: `evals/frontier/corpus/run-26/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/run-26/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-26/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-26/wave-1/task-1.patch`
- Modify: `evals/frontier/corpus/run-26/wave-1/task-2.patch`
- Modify: `evals/frontier/corpus/run-27/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/run-27/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-27/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-27/wave-1/task-1.patch`
- Modify: `evals/frontier/corpus/run-27/wave-1/task-2.patch`
- Modify: `evals/frontier/corpus/run-28/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/run-28/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-28/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-28/wave-1/task-1.patch`
- Modify: `evals/frontier/corpus/run-28/wave-1/task-2.patch`
- Modify: `evals/frontier/corpus/run-28/wave-2/conflicts.json`
- Modify: `evals/frontier/corpus/run-28/wave-2/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-28/wave-2/fold_stats.json`
- Modify: `evals/frontier/corpus/run-28/wave-2/task-3.patch`
- Modify: `evals/frontier/corpus/run-29/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/run-29/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-29/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-29/wave-1/task-1.patch`
- Modify: `evals/frontier/corpus/run-29/wave-1/task-3.patch`
- Modify: `evals/frontier/corpus/run-29/wave-2/conflicts.json`
- Modify: `evals/frontier/corpus/run-29/wave-2/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-29/wave-2/fold_stats.json`
- Modify: `evals/frontier/corpus/run-29/wave-2/task-2.patch`
- Modify: `evals/frontier/corpus/run-29/wave-2/task-4.patch`
- Modify: `evals/frontier/corpus/run-30/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/run-30/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-30/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-30/wave-1/task-1.patch`
- Modify: `evals/frontier/corpus/run-30/wave-1/task-2.patch`
- Modify: `evals/frontier/corpus/run-30/wave-1/task-3.patch`
- Modify: `evals/frontier/corpus/run-30/wave-1/task-4.patch`
- Modify: `evals/frontier/corpus/run-30/wave-1/task-5.patch`
- Modify: `evals/frontier/corpus/run-31/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/run-31/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-31/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-31/wave-1/task-1.patch`
- Modify: `evals/frontier/corpus/run-31/wave-1/task-2.patch`
- Modify: `evals/frontier/corpus/run-31/wave-1/task-3.patch`
- Modify: `evals/frontier/corpus/run-32/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/run-32/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-32/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-32/wave-1/task-1.patch`
- Modify: `evals/frontier/corpus/run-32/wave-1/task-2.patch`
- Modify: `evals/frontier/corpus/run-32/wave-1/task-3.patch`
- Modify: `evals/frontier/corpus/run-32/wave-1/task-4.patch`
- Modify: `evals/frontier/corpus/run-32/wave-2/conflicts.json`
- Modify: `evals/frontier/corpus/run-32/wave-2/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-32/wave-2/fold_stats.json`
- Modify: `evals/frontier/corpus/run-32/wave-2/task-5.patch`
- Modify: `evals/frontier/corpus/run-32/wave-3/conflicts.json`
- Modify: `evals/frontier/corpus/run-32/wave-3/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-32/wave-3/fold_stats.json`
- Modify: `evals/frontier/corpus/run-32/wave-3/task-6.patch`
- Modify: `evals/frontier/corpus/run-33/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/run-33/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-33/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-33/wave-1/task-1.patch`
- Modify: `evals/frontier/corpus/run-33/wave-2/conflicts.json`
- Modify: `evals/frontier/corpus/run-33/wave-2/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-33/wave-2/fold_stats.json`
- Modify: `evals/frontier/corpus/run-33/wave-2/task-2.patch`
- Modify: `evals/frontier/corpus/run-33/wave-2/task-3.patch`
- Modify: `evals/frontier/corpus/run-34/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/run-34/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-34/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/run-34/wave-1/task-1.patch`
- Modify: `evals/frontier/corpus/run-34/wave-2/conflicts.json`
- Modify: `evals/frontier/corpus/run-34/wave-2/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-34/wave-2/fold_stats.json`
- Modify: `evals/frontier/corpus/run-34/wave-2/task-2.patch`
- Modify: `evals/frontier/corpus/run-34/wave-2/task-3.patch`
- Modify: `evals/frontier/corpus/run-34/wave-2/task-4.patch`
- Modify: `evals/frontier/corpus/run-34/wave-3/conflicts.json`
- Modify: `evals/frontier/corpus/run-34/wave-3/fold_log.jsonl`
- Modify: `evals/frontier/corpus/run-34/wave-3/fold_stats.json`
- Modify: `evals/frontier/corpus/run-34/wave-3/task-5.patch`
- Modify: `evals/frontier/corpus/synth-00daa71/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-00daa71/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-00daa71/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-00daa71/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-00daa71/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-0714320/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-0714320/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-0714320/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-0714320/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-0714320/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-0880881/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-0880881/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-0880881/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-0880881/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-0880881/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-08f4ffb/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-08f4ffb/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-08f4ffb/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-08f4ffb/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-08f4ffb/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-0959a0f/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-0959a0f/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-0959a0f/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-0959a0f/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-0959a0f/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-1e29ebb/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-1e29ebb/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-1e29ebb/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-1e29ebb/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-1e29ebb/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-22343f7/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-22343f7/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-22343f7/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-22343f7/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-22343f7/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-236fb0d/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-236fb0d/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-236fb0d/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-236fb0d/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-236fb0d/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-28c1239/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-28c1239/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-28c1239/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-28c1239/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-28c1239/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-2a9a221/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-2a9a221/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-2a9a221/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-2a9a221/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-2a9a221/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-3a6f35a/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-3a6f35a/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-3a6f35a/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-3a6f35a/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-3a6f35a/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-40123f0/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-40123f0/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-40123f0/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-40123f0/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-40123f0/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-448681b/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-448681b/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-448681b/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-448681b/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-448681b/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-521d770/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-521d770/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-521d770/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-521d770/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-521d770/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-55d7ed7/wave-1/conflict-1.hunks.txt`
- Modify: `evals/frontier/corpus/synth-55d7ed7/wave-1/conflict-1.txt`
- Modify: `evals/frontier/corpus/synth-55d7ed7/wave-1/conflict-2.hunks.txt`
- Modify: `evals/frontier/corpus/synth-55d7ed7/wave-1/conflict-2.txt`
- Modify: `evals/frontier/corpus/synth-55d7ed7/wave-1/conflict-3.hunks.txt`
- Modify: `evals/frontier/corpus/synth-55d7ed7/wave-1/conflict-3.txt`
- Modify: `evals/frontier/corpus/synth-55d7ed7/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-55d7ed7/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-55d7ed7/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-55d7ed7/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-55d7ed7/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-5b8abae/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-5b8abae/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-5b8abae/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-5b8abae/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-5b8abae/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-6229ebc/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-6229ebc/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-6229ebc/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-6229ebc/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-6229ebc/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-6500839/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-6500839/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-6500839/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-6500839/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-6500839/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-66c0548/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-66c0548/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-66c0548/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-66c0548/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-66c0548/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-715e70b/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-715e70b/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-715e70b/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-715e70b/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-715e70b/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-767fb9c/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-767fb9c/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-767fb9c/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-767fb9c/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-767fb9c/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-81759f5/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-81759f5/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-81759f5/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-81759f5/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-81759f5/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-8289145/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-8289145/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-8289145/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-8289145/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-8289145/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-8893e8e/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-8893e8e/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-8893e8e/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-8893e8e/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-8893e8e/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-91edea6/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-91edea6/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-91edea6/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-91edea6/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-91edea6/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-975f090/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-975f090/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-975f090/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-975f090/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-975f090/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-a49e543/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-a49e543/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-a49e543/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-a49e543/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-a49e543/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-a989e50/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-a989e50/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-a989e50/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-a989e50/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-a989e50/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-b1e7745/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-b1e7745/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-b1e7745/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-b1e7745/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-b1e7745/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-b6cdc8b/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-b6cdc8b/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-b6cdc8b/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-b6cdc8b/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-b6cdc8b/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-bd42de4/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-bd42de4/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-bd42de4/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-bd42de4/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-bd42de4/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-c64731c/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-c64731c/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-c64731c/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-c64731c/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-c64731c/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-d012eaa/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-d012eaa/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-d012eaa/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-d012eaa/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-d012eaa/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-d38db8d/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-d38db8d/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-d38db8d/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-d38db8d/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-d38db8d/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-d576e45/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-d576e45/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-d576e45/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-d576e45/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-d576e45/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-e1256d8/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-e1256d8/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-e1256d8/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-e1256d8/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-e1256d8/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-eb0998e/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-eb0998e/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-eb0998e/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-eb0998e/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-eb0998e/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-ed89824/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-ed89824/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-ed89824/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-ed89824/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-ed89824/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-f1ed13d/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-f1ed13d/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-f1ed13d/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-f1ed13d/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-f1ed13d/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/synth-fdc1e7f/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/synth-fdc1e7f/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/synth-fdc1e7f/wave-1/fold_stats.json`
- Modify: `evals/frontier/corpus/synth-fdc1e7f/wave-1/task-a.patch`
- Modify: `evals/frontier/corpus/synth-fdc1e7f/wave-1/task-b.patch`
- Modify: `evals/frontier/corpus/w2-entry-slate-20260827/wave-1/conflicts.json`
- Modify: `evals/frontier/corpus/w2-entry-slate-20260827/wave-1/fold_log.jsonl`
- Modify: `evals/frontier/corpus/w2-entry-slate-20260827/wave-1/fold_stats.json`
- Modify: `evals/frontier/results/.gitkeep`
- Modify: `evals/frontier/results/2026-08-10-adjudication.md`
- Modify: `evals/frontier/results/2026-08-10-plan-corpus-binding.md`
- Modify: `evals/frontier/results/2026-08-10-readjudication.md`
- Modify: `evals/frontier/results/2026-08-10-reopen/a-chained.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/a-contend.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/a-degrade.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/a-flawed.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/a-mixed.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/a-webapp.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/a-wide.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/b-add-add-divergent.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/b-add-add-identical.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/b-adjacent-lines.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/b-delete-vs-modify.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/b-disjoint-functions.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/b-four-way-fanin.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-13e97401.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-1a58ed29.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-31339f70.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-39a166c5.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-59a84df7.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-5a74648a.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-8d0ee798.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-a5603190.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-b514f80f.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-b55a480a.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-c64fbdac.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-c8a3a5ce.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-c9feb919.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-d3576a91.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-d9369661.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/c-f2b96216.json`
- Modify: `evals/frontier/results/2026-08-10-reopen/rollup.md`
- Modify: `evals/frontier/results/2026-08-12-production-test.md`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-20260731-145213.json`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-20260731-145213.md`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-20260801-132730.json`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-20260801-132730.md`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-20260812-b2face.json`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-20260812-b2face.md`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-b1emh-20260812.json`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-b1emh-20260812.md`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-day1-b0-bridge-0812.json`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-day1-b0-bridge-0812.md`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-zoho-hardening-0811.json`
- Modify: `evals/frontier/results/2026-08-12-shadow-run-zoho-hardening-0811.md`
- Modify: `evals/frontier/results/2026-08-13-calibration-arm-a.md`
- Modify: `evals/frontier/results/2026-08-13-frontier-cell.json`
- Modify: `evals/frontier/results/2026-08-14-s5-shakedown.md`
- Modify: `evals/frontier/results/2026-08-14-t15-ab.md`
- Modify: `evals/frontier/results/2026-08-19-phase1-gate.md`
- Modify: `evals/frontier/results/2026-08-19-t15-resolver-token-share.md`
- Modify: `evals/frontier/results/2026-08-20-phase2-migration.md`
- Modify: `evals/frontier/results/2026-08-21-phase2-mechanics.md`
- Modify: `evals/frontier/results/2026-08-21-width-w1-gate.md`
- Modify: `evals/frontier/results/2026-08-26-routing-ab.md`
- Modify: `evals/frontier/results/2026-08-28-wave-width.md`
- Modify: `evals/frontier/results/2026-08-29-base-ancestry-guard.md`
- Modify: `evals/frontier/results/2026-08-29-check-renders.md`
- Modify: `evals/frontier/results/2026-08-30-run30-sandbox-burst-load/README.md`
- Modify: `evals/frontier/results/2026-08-30-run30-sandbox-burst-load/samples.txt`
- Modify: `evals/frontier/results/2026-08-31-494-probe-executability.md`
- Modify: `evals/frontier/results/2026-08-31-concurrent-drains.md`
- Modify: `evals/frontier/results/2026-08-31-fold-corpus-validation.md`
- Modify: `evals/frontier/results/2026-08-31-run32-sandbox-burst-load/README.md`
- Modify: `evals/frontier/results/2026-08-31-run32-sandbox-burst-load/samples.txt`
- Modify: `evals/frontier/results/a-chained.json`
- Modify: `evals/frontier/results/a-degrade.json`
- Modify: `evals/frontier/results/a-flawed.json`
- Modify: `evals/frontier/results/a-mixed.json`
- Modify: `evals/frontier/results/a-webapp.json`
- Modify: `evals/frontier/results/a-wide.json`
- Modify: `evals/frontier/results/b-add-add-divergent.json`
- Modify: `evals/frontier/results/b-add-add-identical.json`
- Modify: `evals/frontier/results/b-adjacent-lines.json`
- Modify: `evals/frontier/results/b-delete-vs-modify.json`
- Modify: `evals/frontier/results/b-disjoint-functions.json`
- Modify: `evals/frontier/results/b-four-way-fanin.json`
- Modify: `evals/frontier/results/c-c9feb919.json`
- Modify: `evals/frontier/results/rollup.md`

**Claim:** the frontier corpus is frozen replay data (92k lines) that the compiler tests read; it belongs in the same off-repo store, with the tests reading a fixture subset. (quoted from #544)
Machine: M1. `git ls-files evals/frontier` lists exactly ten paths — the nine scripts `arm_git.py`, `arm_weave.py`, `classify.py`, `corpus_extract.py`, `corpuslib.py`, `replay_corpus.py`, `run_eval.py`, `schedule_model.py`, `synth_corpus.py` and `README.md` — and `git ls-files evals/frontier/corpus evals/frontier/results` lists nothing; `evals/frontier/corpus/corpus-index.json` and `evals/frontier/results/2026-08-20-phase2-migration.md` are absent from the working tree. M2. `.gitignore` ignores `evals/frontier/corpus/` and `evals/frontier/results/`: `git check-ignore -q` exits 0 for `evals/frontier/corpus/corpus-index.json` and for `evals/frontier/results/2026-08-20-phase2-migration.md`, and exits 1 for `evals/frontier/README.md` and for `evals/frontier/corpuslib.py`. M3. `evals/frontier/README.md` says, in this order under its first heading, that the corpus and results are `untracked on purpose` per `#544`, what lived there (`corpus-index.json`, the per-run `wave-<n>` directories, the results readings), where the durable copy is (the laptop), how the corpus is regenerated (`corpus_extract.py`), and that the tests read `make_fixture_corpus` and never this directory. M4. In that tree, `python3 -m pytest -q -p no:cacheprovider` over `tests/test_replay_corpus.py`, `tests/test_corpus_extract.py`, `tests/test_arm_weave.py`, `tests/test_corpuslib.py`, `tests/test_classify.py`, `tests/test_frontier_run_eval.py`, `tests/test_frontier_schedule.py` and `tests/test_frontier_track_c.py` ends with a summary line of the form `<N> passed in <t>s`, at most a warnings count between them — no `skipped`, `failed`, `error` or `deselected` count in it. M5. The fixture those tests read is generated, not this directory: `tests/conftest.py`'s `fixture_corpus` fixture calls `corpuslib.make_fixture_corpus`, and `tests/test_replay_corpus.py`'s `replayed` fixture takes `fixture_corpus`.

**Authorized-by:** #544 §Roadmap step 4; the step-1 precedent commit `5efce3a7` (#559); operator scope decision 2026-09-08 (untrack `evals/frontier/{corpus,results}`, keep `evals/fixtures/` and the scripts).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Measured at BASE `1c97ba44` (2026-09-08). `git ls-files evals | xargs wc -l | tail -1` → `91965 total` over 539 files; per subdirectory: `evals/fixtures` 11,095 (111 files), `evals/frontier` 58,629 (397 files: `corpus` 49,504 over 307 files, `results` 6,327 over 81 files, and 9 scripts), `evals/results` 21,154, the rest scripts and one note. `git ls-files evals/frontier/corpus evals/frontier/results | wc -l` → `388`, `55831 total` lines. The corpus is `corpus-index.json` (67 entries) plus `<runId>/wave-<n>/{conflicts.json,fold_log.jsonl,fold_stats.json,task-*.patch}` for 11 live runs (run-23 … run-34, three 2026-08-27/28 stamps, one `w2-entry-slate`) and 40 `synth-<sha>` synthetic runs; `results/` is 81 readings from 2026-08-10 to 2026-08-31 (`2026-08-10-reopen/`, the shadow-run pairs, `2026-08-20-phase2-migration.md`, the two sandbox-burst-load samples). Who reads what: `git grep -n 'evals/' tests/ fleet/tests/ skills/ evals/*.py .github pytest.ini` finds the only code paths that name `evals/frontier` are docstrings in `tests/test_{arm_weave,classify,corpus_extract,corpuslib,replay_corpus}.py`, `evals/check_renders_ab.py:39` (`DEFAULT_OUT` under `results/`, created with `mkdir(parents=True)` at `:314`, so an absent directory is fine), `evals/frontier/run_eval.py:862` (`--out` default `HERE / "results"`, likewise `mkdir`), `skills/ultrapowers/scripts/compile_plan.py:2175` (a comment), `skills/ultralearn/references/reading-lenses.md:104` and `CLAUDE.md:248` (both cite a results reading by path), and `tests/fixtures/plans/docket.md` (a frozen fixture — do not edit). Eighteen test files do `sys.path.insert(0, str(ROOT / "evals" / "frontier"))` and import the scripts (`tests/conftest.py:21` too) — which is why the nine `.py` files stay tracked. No test opens `evals/frontier/corpus` or `evals/frontier/results`: the replay tests use `tests/conftest.py`'s `fixture_corpus` (`corpuslib.make_fixture_corpus(dest)`, one build per session into `tmp_path_factory`). Proof of that: with both directories moved out of the tree, `python3 -m pytest -q -p no:cacheprovider` over the eight files in M4 plus `tests/test_frontier_weave.py tests/test_frontier_fold.py tests/test_fold_wave.py tests/test_fold_wave_patch.py tests/test_fold_wave_materialize.py tests/test_merge_ledger.py tests/test_weave_crosswave.py tests/test_weave_persistence.py tests/test_weave_shadow.py` printed `317 passed in 124.25s`, and `git status --short` afterwards showed nothing created. `pytest.ini` at BASE is `testpaths = tests` with a comment that it keeps collection out of `evals/fixtures/*/project/` — it needs no change. `.gitignore` at BASE is blob `284654455ee6421e9273840241aebf54fac18e52`; its last block is the `evals/results/cells/` rule under an `# ab_runner eval-cell evidence (#165)` comment — append a new block after it, with its own comment naming #544 step 4, carrying exactly the two lines `evals/frontier/corpus/` and `evals/frontier/results/`. No `!` re-include rule is needed: the stub lives at `evals/frontier/README.md`, outside both ignored directories, and the nine scripts likewise. `.git/info/exclude` is per-checkout and never in a diff, so `.gitignore` is the only mechanism a fleet-produced PR can carry (the docs precedent used `exclude` because it was a hand commit on the laptop). How the deletion travels: the engine's capture (`fleet/run-waves.mjs` `patchAgainstBase`) runs `git add -A` in the clone — `.gitignore` applies, as to a commit — then `git diff --cached --binary --full-index --no-renames --output=<file> <BASE>`, so tracked files removed from the index appear as deletions in the patch, and the kernel (`skills/ultrapowers/kernel/repo_weave.py` `apply_patch_tree`) applies that patch with `git apply --cached --binary` into a temporary index over BASE — a deletion of a file BASE has applies cleanly, and one task deleting 388 paths no sibling names contends with nothing. The patch is written by git to a file (`--output`), never through a Node buffer, so its ~56k lines are not a size problem; the reviewer receives the patch's path, and `git diff --stat` of it reads as 388 deletions plus two edits. The reviewer's rule (`fleet/roles/reviewer.md` rule 3) makes deleting a file present at BASE but absent from FILES blocking, and the implementer's rule says never delete a file outside FILES — which is why every one of the 388 paths is in this task's Files. Removing the two directories from the working tree as well as the index (a plain `git rm -r`, not `--cached`) is what makes M1's absence and M4 hold in this clone; the copies the laptop keeps are the operator's, not the sandbox's. What the stub must say, for M3: the durable copy is the operator's laptop — `evals/frontier/corpus/` and `evals/frontier/results/` copied out of the working tree before this commit is pulled (pulling a commit that deletes tracked files removes them from the working tree) and put back afterwards, where the new rule ignores them; the corpus is rebuilt from run evidence with `python3 evals/frontier/corpus_extract.py --evidence <dir-of-tgz> --out evals/frontier/corpus` and synthetic entries with `synth_corpus.py`; the readings under `results/` were written by `run_eval.py`, `check_renders_ab.py` and by hand and are cited from `CLAUDE.md` (`2026-08-20-phase2-migration.md`) and `skills/ultralearn/references/reading-lenses.md` (`2026-08-19-t15-resolver-token-share.md`) — those citations stay, and the stub is where a reader learns the files are on the laptop; the tests read `corpuslib.make_fixture_corpus` via `tests/conftest.py`'s `fixture_corpus` and never this directory; the nine scripts stay tracked. Keep the stub under one `# evals/frontier/` heading, in the register of `docs/README.md` (the step-1 stub), and no longer than that file's two paragraphs plus a regenerate line. Do not touch `evals/fixtures/`, `evals/results/`, any script, any test, or `tests/fixtures/plans/docket.md`.

**Proof:**
- Run: `test "$(git ls-files evals/frontier | LC_ALL=C sort | tr '\n' ' ')" = 'evals/frontier/README.md evals/frontier/arm_git.py evals/frontier/arm_weave.py evals/frontier/classify.py evals/frontier/corpus_extract.py evals/frontier/corpuslib.py evals/frontier/replay_corpus.py evals/frontier/run_eval.py evals/frontier/schedule_model.py evals/frontier/synth_corpus.py '`
- Run: `test "$(git ls-files evals/frontier/corpus evals/frontier/results | wc -l | tr -d ' ')" = 0`
- Run: `test ! -e evals/frontier/corpus/corpus-index.json`
- Run: `test ! -e evals/frontier/results/2026-08-20-phase2-migration.md`
- Run: `git check-ignore -q evals/frontier/corpus/corpus-index.json`
- Run: `git check-ignore -q evals/frontier/results/2026-08-20-phase2-migration.md`
- Run: `! git check-ignore -q evals/frontier/README.md`
- Run: `! git check-ignore -q evals/frontier/corpuslib.py`
- Run: `grep -c '^evals/frontier/corpus/$' .gitignore | grep -qx 1`
- Run: `grep -c '^evals/frontier/results/$' .gitignore | grep -qx 1`
- Run: `sed -n '/^# /,$p' evals/frontier/README.md | tr '\n' ' ' | grep -q 'untracked on purpose.*#544.*corpus-index.json.*wave-<n>.*results.*laptop.*corpus_extract.py.*make_fixture_corpus'`
- Run: `python3 -m pytest -q -p no:cacheprovider tests/test_replay_corpus.py tests/test_corpus_extract.py tests/test_arm_weave.py tests/test_corpuslib.py tests/test_classify.py tests/test_frontier_run_eval.py tests/test_frontier_schedule.py tests/test_frontier_track_c.py 2>&1 | tail -1 | grep -E '^[0-9]+ passed(, [0-9]+ warnings?)? in [0-9.]+s'`
- Run: `sed -n '/^def fixture_corpus/,/^def /p' tests/conftest.py | grep -q 'corpuslib.make_fixture_corpus'`
- Run: `grep -q '^def replayed(fixture_corpus)' tests/test_replay_corpus.py`
- Legs: (a) the first `Run:` compares the sorted `git ls-files evals/frontier` listing, as one string, against the exact ten paths M1 names — a missing script, a renamed one, an extra tracked file or a surviving corpus or results path each change the string — the second that nothing under `corpus/` or `results/` is tracked, and the third and fourth that the corpus index and the named results reading are absent from the working tree [M1]; (b) the two `git check-ignore -q` lines that must exit 0 establish the rule covers a corpus path and a results path, the two negated ones that the stub and a script are not ignored, and the two `grep -c … | grep -qx 1` lines that each directory rule is present exactly once in `.gitignore` [M2]; (c) the scoped `sed … | grep -q` over the stub, from its first heading to the end, pins the eight operative phrases in order — `untracked on purpose`, `#544`, `corpus-index.json`, `wave-<n>`, `results`, `laptop`, `corpus_extract.py`, `make_fixture_corpus` — so a stub missing any one of them, or ordering the laptop after the regenerate line, fails [M3]; (d) the pytest `Run:` executes after the `test ! -e` lines have established the corpus index and the named reading absent — the tree these tests see is the one without the two directories' tracked files — and the pipeline's exit is the final `grep -E`'s: it matches only a summary line that begins with a count followed by `passed`, then optionally a warnings count, then `in <t>s` — pytest prints that shape only when no test was skipped, failed, errored or deselected, since any of those puts its own count before `passed` and the line no longer begins with `<N> passed` [M4]; (e) the `sed -n` over the body of `tests/conftest.py`'s `fixture_corpus` fixture pins that it calls `corpuslib.make_fixture_corpus`, and the `grep -q` on `tests/test_replay_corpus.py` pins that its `replayed` fixture takes `fixture_corpus` — a replay test reading a different corpus source would have to change one of those lines [M5].

**Stale-if:**
- path-absent: `evals/frontier/corpus/corpus-index.json`
- path-exists: `evals/frontier/README.md`
- issue-closed: #544

### Task 2: CLAUDE.md tells agents the corpus is on the laptop

**Type:** implementation

**Files:**
- Modify: `CLAUDE.md`

**Claim:** An agent reading CLAUDE.md's Layout learns that `evals/frontier/corpus/` and `evals/frontier/results/` are untracked on purpose since #544 step 4, that `evals/frontier/README.md` is the tracked stub, and that the tests read a generated fixture corpus, never those directories. (derived)
Machine: M1. The `evals/fixtures/` bullet of CLAUDE.md's `## Layout` section carries, after its existing sentence, one sentence in the register of the `docs/superpowers/` bullet's `**Untracked since #544 (2026-09-02):**` sentence, saying that `evals/frontier/corpus/` and `evals/frontier/results/` are untracked since #544 step 4 (2026-09-08), that `evals/frontier/README.md` is the tracked stub, that the durable copy is the laptop, that `.gitignore` carries the rule, and that the corpus tests read `corpuslib.make_fixture_corpus` (built by `tests/conftest.py`), never those directories. M2. Nothing else in CLAUDE.md changes: `git diff $ULTRA_BASE --numstat -- CLAUDE.md` reports at most 3 added lines and at most 1 deleted line, and the `## Layout` section's other bullets are unchanged.

**Authorized-by:** #544 §Roadmap step 4; the step-1 precedent commit `5efce3a7`, which added the matching `**Untracked since #544 (2026-09-02):**` sentence to the `docs/superpowers/` bullet.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `1c97ba44`, CLAUDE.md `## Layout` has the bullet beginning `- `evals/fixtures/` — 14 sample plan repos (the legacy-grammar compiler corpus — `wide`,` at line 64, three lines long, ending `; `pytest.ini` keeps pytest from collecting them.` — append the new sentence inside that bullet, so `git diff --numstat` shows the bullet's last line replaced (1 deletion) and the sentence's wrapped lines added (≤ 3 additions). The precedent sentence, in the `docs/superpowers/{specs,plans}/` bullet at lines 51–56, begins `**Untracked since #544 (2026-09-02):** the whole of `docs/superpowers/` is in `.git/info/exclude` and `docs/README.md` is the tracked stub.` — mirror its shape: `**Untracked since #544 step 4 (2026-09-08):** `evals/frontier/corpus/` and `evals/frontier/results/` (the frozen fold corpus and its readings, 388 files) are ignored by `.gitignore`, `evals/frontier/README.md` is the tracked stub, the durable copy is the laptop, and the corpus tests read `corpuslib.make_fixture_corpus` (built once per session by `tests/conftest.py`), never those directories.` The shared literal with Task 1 is the stub path `evals/frontier/README.md`; this task does not read the stub or depend on its content. `CLAUDE.md:248` cites `evals/frontier/results/2026-08-20-phase2-migration.md` as the Phase-2 adjudication record — leave that citation as it is; the new sentence is what tells a reader the file is on the laptop. `CLAUDE.md` is not one of the four operator documents `tests/test_docs_agree_with_code.py` pins, and no test greps CLAUDE.md for the `evals/fixtures/` bullet (`git grep -n 'evals/fixtures' tests/` finds only test bodies that use the fixtures). Edit no other line of CLAUDE.md.

**Proof:**
- Run: `sed -n '/^## Layout/,/^## Wayfinding/p' CLAUDE.md | tr '\n' ' ' | grep -q 'Untracked since #544 step 4 (2026-09-08).*evals/frontier/corpus/.*evals/frontier/results/.*\.gitignore.*evals/frontier/README\.md.*laptop.*make_fixture_corpus.*tests/conftest\.py'`
- Run: `sed -n '/^## Layout/,/^## Wayfinding/p' CLAUDE.md | tr '\n' ' ' | grep -q '14 sample plan repos.*pytest\.ini. keeps pytest from collecting them\..*Untracked since #544 step 4'`
- Run: `git diff $ULTRA_BASE --numstat -- CLAUDE.md | awk '{ exit !($1 <= 3 && $2 <= 1) }'`
- Run: `git diff $ULTRA_BASE -U0 -- CLAUDE.md | grep '^@@' | wc -l | tr -d ' ' | grep -qx 1`
- Run: `git diff $ULTRA_BASE -- CLAUDE.md | grep '^-' | grep -v '^---' | grep -q 'keeps pytest from collecting them'`
- Legs: (a) the first `Run:` scopes to `## Layout` and pins the sentence's eight operative literals in order — the bold prefix with its date, both directory paths, `.gitignore`, the stub path, `laptop`, `make_fixture_corpus`, `tests/conftest.py` — so a sentence missing any one, or placed outside Layout, fails; and the second pins that the sentence follows the `evals/fixtures/` bullet's existing closing text within the same section, so it sits in that bullet and not another [M1]; (b) the `--numstat` line bounds the diff to at most 3 added and 1 deleted line, the `-U0 … grep '^@@'` line establishes exactly one hunk, and the last line establishes that the one deleted line is the `evals/fixtures/` bullet's own closing line — together, a change to any other bullet of `## Layout` or elsewhere in CLAUDE.md fails [M2].

**Stale-if:**
- path-absent: `CLAUDE.md`
- issue-closed: #544
