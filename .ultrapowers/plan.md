# The real-join fixture patches for the fold-order sim — the sim reads them and the run's record carries the reading (#832)

**Grammar:** claims-v1

**Claim:** do: run the fold-order sim on the merged engine with the real same-file fixtures in place. see: one line per real-join fixture saying whether every adoption order lands on the one-shot fold's tree, in the run's own record, so the Phase C decision is read off a measurement over real joins and not over the synthetic corpus alone. (elicited)
**Summary:** This finishes the measurement run-117 started: the sim is on main and green over the synthetic corpus, but the three real same-file fixtures never reached it because the exam that graded their patches used the wrong instrument. It exists because the pool of Phase C is only safe if arrival order cannot change a fold's result on real joins, and those fixtures are the real joins the kernel was built for. After this run the record shows, fixture by fixture, whether sequential adoption equals the wave fold, and #832 closes on that reading.

**Goal:** #832's second half — the per-task patches for `contend`, `contend-wide` and `degrade`, produced once by `evals/frontier/split_fixture.py` (a scripted split of `reference/` against `project/` by each task's declared symbol) and committed under `fleet/tests/fixtures/readiness/<fixture>/` with a `manifest.json` each, in the shape `fleet/tests/test_readiness_fold_order.mjs` (on main since #962, `2f327c6f`) already reads by glob; an exam that grades the patches with the kernel's own fold against `reference/`, never with `git apply`; and the sim run once on the adopted tree so its per-fixture lines are in the run's record. `contend-big` and `bun-greenfield` have no `reference/` tree at BASE and stay out. The kernel, the engine and the sim are untouched.
**Closes:** #832

**Tech Stack:** Python 3 (`evals/frontier/split_fixture.py`, `skills/ultrapowers/kernel/fold_wave.py` driven as a CLI), Node 24 ESM sims under `fleet/tests/`, git.

**Exam command:** node {paths}

**Spec:** #832 (its body; the corrected grading instrument is in Context).

**Parallelization rationale:** one wave, one task — the split, its patches, their manifests and their exam are one surface; the sim that consumes them is already on main.

## Global Constraints

- The kernel is untouched (#360): nothing under `skills/ultrapowers/kernel/` changes.
- Check: git diff --quiet $ULTRA_BASE -- skills/ultrapowers/kernel/
- The fold-order sim, its helpers and its exam are untouched: this task feeds them, it does not edit them.
- Check: git diff --quiet $ULTRA_BASE -- fleet/tests/test_readiness_fold_order.mjs fleet/tests/_readiness_helpers.mjs fleet/tests/test_readiness_fold_order_exam.mjs fleet/tests/fixtures/readiness-corpus/
- The fixtures under `evals/fixtures/` are untouched: a split error is resolved in the script's override table, never in the fixture.
- Check: git diff --quiet $ULTRA_BASE -- evals/fixtures/

### Task 1: The real-join fixture patches

**Type:** implementation
**Review:** peer

**Files:**
- Create: `evals/frontier/split_fixture.py`
- Create: `fleet/tests/fixtures/readiness/contend/manifest.json`
- Create: `fleet/tests/fixtures/readiness/contend/task-1.patch`
- Create: `fleet/tests/fixtures/readiness/contend/task-2.patch`
- Create: `fleet/tests/fixtures/readiness/contend/task-3.patch`
- Create: `fleet/tests/fixtures/readiness/contend/task-4.patch`
- Create: `fleet/tests/fixtures/readiness/contend-wide/manifest.json`
- Create: `fleet/tests/fixtures/readiness/contend-wide/task-1.patch`
- Create: `fleet/tests/fixtures/readiness/contend-wide/task-2.patch`
- Create: `fleet/tests/fixtures/readiness/contend-wide/task-3.patch`
- Create: `fleet/tests/fixtures/readiness/contend-wide/task-4.patch`
- Create: `fleet/tests/fixtures/readiness/contend-wide/task-5.patch`
- Create: `fleet/tests/fixtures/readiness/contend-wide/task-6.patch`
- Create: `fleet/tests/fixtures/readiness/contend-wide/task-7.patch`
- Create: `fleet/tests/fixtures/readiness/contend-wide/task-8.patch`
- Create: `fleet/tests/fixtures/readiness/degrade/manifest.json`
- Create: `fleet/tests/fixtures/readiness/degrade/task-1.patch`
- Create: `fleet/tests/fixtures/readiness/degrade/task-2.patch`
- Test: `fleet/tests/test_readiness_fixtures.mjs`

**Claim:** The three real-join fixtures that carry a reference tree — `contend`, `contend-wide` and `degrade` — each get their per-task patches, produced once by a scripted split of the reference against the project by each task's declared symbol, committed under `fleet/tests/fixtures/readiness/<fixture>/`, the one root the fold-order sim reads, and graded by the kernel's own fold. (derived)
Machine: M1. For each of `contend` (tasks 1–4), `contend-wide` (tasks 1–8) and `degrade` (tasks 1–2): `fleet/tests/fixtures/readiness/<fixture>/` holds a `manifest.json` and exactly those `task-<id>.patch` files — one per task of `evals/fixtures/<fixture>/plan.md` whose Files block lists a `Modify:` or `Create:` path, none for a `**Files:** none` task — and each patch alone applies cleanly (`git apply --check`) to a scratch commit of `evals/fixtures/<fixture>/project`. M2. For each of those three fixtures, the kernel's simultaneous fold of all its patches — `fold_wave.py fold --base <scratch BASE> --patch <id>=<patch>… --commutes <id>=<paths>…` as the manifest declares, then `materialize --prev-head <BASE>` — exits 0 and yields a candidate whose tree holds, for every path under the fixture's `reference/`, content byte-identical to `reference/`. M3. `python3 evals/frontier/split_fixture.py <fixture> <out-dir>` regenerates byte-identical patches and manifest for each of the three fixtures from `evals/fixtures/<fixture>/` alone. M4. Each `manifest.json` has exactly the keys `fixture`, `project`, `tasks`, `commutes`, `replies`, with `fixture` the directory's own name, `tasks` a list of `{id, patch}` in task order where every `patch` is `task-<id>.patch` and names a file beside the manifest, `replies` the literal `replies`, and `project` equal to `evals/fixtures/<fixture>/project`. M5. The three directories sit directly under `fleet/tests/fixtures/readiness/` — no other root, no deeper nesting — and that root holds exactly those three directories. M6. Neither `contend-big` nor `bun-greenfield` has a directory under `fleet/tests/fixtures/readiness/`, and `split_fixture.py` exits non-zero on a fixture with no `reference/` tree, naming it. M7. `node fleet/tests/test_readiness_fold_order.mjs` on this tree prints one set line for each of `contend`, `contend-wide` and `degrade` in its `<set> n=<tasks> orders=<k> tree=<sha> sim=<sha> ok|caught steps=<n> kernelCalls=<n>` form and ends `ALL TESTS PASSED`.

**Authorized-by:** #832; #360 §Ground truth (the real-join fixtures); run-117's record (`ultra/evidence/run-117`: the corpus half green, task 2 failed on a `git apply` leg)

**Interfaces:**
- Consumes: none
- Produces: `split_fixture(fixture: str, out_dir: Path) -> list[Path]` (in `evals/frontier/split_fixture.py`)

**Context:** Run-117 (2026-09-13) built this task once and lost it to its exam, not to its work: the split script asserted that applying every task's atoms reproduces `reference/` byte for byte, and its patches applied one at a time, but the exam's leg for M2 tried `git apply` of all patches together (plain, `--unidiff-zero`, `--3way`) and every real-join fixture conflicted, as same-file joins do under git — that is the class the kernel exists for, and the kernel is the instrument. Grade M2 with the kernel: build the scratch BASE (commit `project/` with `GIT_AUTHOR_DATE=GIT_COMMITTER_DATE=2026-08-31T00:00:00+00:00` and a fixed author and email, so the sha is reproducible), run `python3 skills/ultrapowers/kernel/fold_wave.py fold --repo <scratch> --run-dir <tmp> --wave 1 --base <BASE> --patch <id>=<patch>… --commutes <id>=<path,…>…` (the manifest's `commutes` map, every task on its shared file), then `materialize --repo <scratch> --run-dir <tmp> --wave 1 --prev-head <BASE> --patch <id>=<patch>…` (no `--commutes` on materialize), read `candidateSha` from its stdout JSON, and compare `git show <candidate>:<path>` to `reference/<path>` for every file under `reference/`. `fold` refuses a wave whose `<run-dir>/frontier/wave-1/fold_log.jsonl` exists, so use a fresh run dir per fixture; a `{"fallback": …}` from materialize is a failed leg, not a retry. The sim `fleet/tests/test_readiness_fold_order.mjs` and its helpers `fleet/tests/_readiness_helpers.mjs` are on main (#962): the sim reads every `fleet/tests/fixtures/readiness/*/manifest.json` by glob, builds each set's BASE from `project/` itself, folds it simultaneously and in every order `sampled_orders` returns (all n! for n ≤ 4, twenty for n > 4), carries each manifest's `commutes` onto the `adopted` pseudo-task at every sequential step, and answers conflicts from `replies/<path with / as __>/h<N>.txt` beside the manifest — so a fixture whose simultaneous fold narrates a hunk that commutes does not license needs that reply committed with the region's text as `reference/` has it; measure once by running the sim and commit what it asks for. The manifest is exactly `{"fixture": "<name>", "project": "evals/fixtures/<name>/project", "tasks": [{"id": "<task id>", "patch": "task-<id>.patch"}, …], "commutes": {"<task id>": ["<path>", …]}, "replies": "replies"}`. The fixtures: `contend` has 5 tasks, tasks 1–3 `Modify: clitool/cli.py` (the `--verbose`, `--format`, `--limit` flags), task 4 `Create: clitool/textutil.py`, task 5 `**Files:** none` (no patch); `reference/` differs from `project/` in `clitool/cli.py` and adds `clitool/textutil.py`; `project/tests/` has no counterpart in `reference/`, so no patch touches tests. `contend-wide` has 8 tasks all `Modify: clitool/cli.py`; `degrade` has 3, tasks 1–2 `Modify: confkit/config.py`, task 3 `**Files:** none`. Fourteen patch files in all, every one in this task's Files. The split rule: turn `reference/<path> − project/<path>` into atoms, assign each to the task whose declared symbol its added lines mention, keep a block with its header's task, and resolve an unclaimed or doubly-claimed atom in the script's own override table, exiting non-zero on any left. A patch is `git diff --binary --full-index --no-renames <BASE>` taken in a clone of the scratch repo. M7's sim run costs about 0.75 s per fold-plus-materialize: `contend-wide` at 20 orders of 8 steps is the long pole (~2 min); the suite bridge caps a sim file at 300 s.

**Proof:**
- Test: `fleet/tests/test_readiness_fixtures.mjs`
- Guard: `fleet/tests/test_readiness_fixtures.mjs`
- Legs: (a) for each of `contend`, `contend-wide`, `degrade`: the exam parses `evals/fixtures/<fixture>/plan.md` itself, counts the `### Task` headings whose Files block carries a `Modify:` or `Create:` bullet and lists their ids, asserts those computed counts are 4, 8 and 2 respectively, asserts the manifest's `tasks` ids equal that computed id list, asserts the patch files on disk are exactly `task-<id>.patch` for those ids and no other file, and `git apply --check` of each listed patch alone against a fresh scratch commit of `project/` exits 0 [M1]; (b) for each of the three, the kernel `fold` of all its patches with the manifest's commutes exits 0, `materialize --prev-head <BASE>` prints a `candidateSha`, and for every path under `reference/` the candidate's blob bytes equal the reference file's bytes — and a negative row: the same fold with one patch left out yields at least one reference path whose bytes differ, so the comparison is known non-vacuous [M2]; (c) for each of the three, running `split_fixture.py` into a temp dir yields files whose `sha256` equal the committed ones, file for file [M3]; (d) each manifest parses, has exactly the five keys, `fixture` equals its directory name, `tasks[i].id` are in ascending task order, every `tasks[i].patch` equals `task-<id>.patch` and exists beside the manifest, `replies` is the string `replies`, and `project` is the fixture's project path [M4]; (e) `ls fleet/tests/fixtures/readiness/` lists exactly `contend`, `contend-wide`, `degrade` and nothing else, and each `manifest.json` is at depth one under that root [M5]; (f) `test ! -e fleet/tests/fixtures/readiness/contend-big` and `test ! -e fleet/tests/fixtures/readiness/bun-greenfield`, and `split_fixture.py bun-greenfield <tmp>` exits non-zero with `bun-greenfield` on stderr and writes nothing into `<tmp>` [M6]; (g) the driver runs the `Test:` sim as the exam command, and the `Run:` below is the sim's own output: its stdout has exactly one line starting `contend `, one starting `contend-wide ` and one starting `degrade `, each matching the set-line form, and its last line is `ALL TESTS PASSED` [M7].
- Run: node fleet/tests/test_readiness_fixtures.mjs 2>&1 | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_readiness_fold_order.mjs 2>&1 | tee /tmp/readiness-fold-order.txt | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- issue-closed: #832
- path-absent: `fleet/tests/test_readiness_fold_order.mjs`
- path-absent: `evals/fixtures/contend/reference`
- path-absent: `evals/fixtures/contend-wide/reference`
- path-absent: `evals/fixtures/degrade/reference`
