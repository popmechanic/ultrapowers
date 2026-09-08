# Plan: Guard: and the reserved exam directory — the exam proves the claim once and lives on the tag

**Grammar:** claims-v1

**Claim:** The examiner writes every exam under a reserved directory (`tests/exams/<run>/` or `fleet/tests/exams/<run>/`); inside a run the suite collects that directory from the branch, so the wave suite, the fold's suite and the frozen gate see the exams exactly as today; at publish the engine moves the reserved directory onto the evidence tag and the PR carries none of it; a task whose Proof has a `Guard:` bullet naming a file in its Files gets that file written to the normal `tests/` path and merged. (quoted from #777)

**Goal:** #777 under map #766 (decisions 3, 4 and 9 of the #767 grilling): the peer's exam lands under a reserved, run-named directory that the run's suite collects and that publish strips onto the evidence tag; a `Guard:` bullet in Proof is the author-signed opt-in that keeps one exam at its normal path and merges it; ultrawrite teaches the bullet, the compiler advises on it, the fold looks for an exam where the engine wrote it, and the frozen gate scripts, the diagnostic vocabulary and `.github/workflows/ci.yml` are untouched.
**Closes:** #777

**Tech Stack:** Node 24 (`fleet/*.mjs`, sims under `fleet/tests/test_*.mjs`), bash (`fleet/sandbox-boot.sh`, a new `fleet/strip-exams.sh`), Python 3 (`compile_plan.py`, pytest under `tests/`).

Spec: `docs/superpowers/specs/` has none — the design record is #767's nine decisions and #777's desired state, quoted into each task's Context below.

**Parallelization rationale:** wave 1 is five wide — Task 1 (engine: the landing path and the handoff), Task 2 (compiler: `Guard:`), Task 3 (the pytest bridge), Task 4 (publish strips to the record), Task 5 (ultrawrite teaches `Guard:`) share no symbol and every shared shape (the slug rule, the `proofGuards` key, the `EXAM PATHS:` line, the `exams/` evidence directory) is a literal in the Context of each task that touches it. Wave 2 is Task 6 alone: the publish fold has to open an exam where the engine's handoff actually put it, which is Task 1's runtime behaviour (the landing path on the integration branch), not a shape a contract can promise — so it `Consumes:` `reservedExamPath` and waits.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh
- Check: git diff --quiet $ULTRA_BASE -- .github/workflows/ci.yml
- The compiler's diagnostic vocabulary gains no word: `Guard:` is read into an `ADVISORY` line and a task field, never a `grammar:` refusal, and `Acceptance: suite` keeps its meaning (the committed suite, on the branch that includes the exams).
- No test pins a sentence of a document; a prose deliverable is proven by a scoped `Run:`.
- The fold kernel (`skills/ultrapowers/kernel/vendor/manyana.py`) is not touched.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The exam lands under the reserved directory

**Type:** implementation
**Review:** peer

**Files:**
- Create: `fleet/exam-paths.mjs`
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/roles/examiner.md`
- Test: `fleet/tests/test_run_engine_reserved_exams.mjs`

**Claim:** An operator opening a run's integration branch finds each task's peer-written exam under `tests/exams/<run>/` (or `fleet/tests/exams/<run>/` for a `fleet/tests/` path) and not at the path the Proof named, except an exam the task's Proof marked `Guard:`, which sits at the path the Proof names. (derived)
Machine: M1. For a task with a non-empty `proofTests` and a `testCmd`, the driver computes each Proof path's landing path with `reservedExamPath(p, runId)` from `fleet/exam-paths.mjs`: `tests/<rest>` lands at `tests/exams/<slug>/<rest>`, `fleet/tests/<rest>` lands at `fleet/tests/exams/<slug>/<rest>`, where `<slug>` is `runId` with every character outside `[A-Za-z0-9_]` replaced by `_` (`run-7` is `run_7`); a path under neither prefix lands at itself; a path listed in the task's `proofGuards` lands at itself.
M2. The examiner's prompt carries, directly after its `TEST COMMAND:` line, one `EXAM PATHS: <proof path> -> <landing path>` line per Proof path whose landing path differs, and its `TEST COMMAND:` line is the task's `testCmd` with each such Proof path replaced by its landing path; a task with no differing path gets no `EXAM PATHS:` line and the prompt it gets at BASE, byte for byte.
M3. At the handoff the driver copies the examiner's bytes to the landing path in the graded clone, restores the Proof path there to its BASE state (deleted when absent at BASE) whenever the landing path differs, records `examBlobs` and judges `examEdited` at the landing paths, runs the exam as the remapped command, appends `driver:exam-handoff` with `paths` naming the landing paths, and the integration branch after the wave holds the exam bytes at the landing path and nothing at the Proof path.
M4. A landing path ending `.py` under `tests/exams/<slug>/` gets an empty `__init__.py` in `tests/exams/<slug>/` and in every directory between it and the file, on the graded clone and so on the branch.
M5. `fleet/exam-paths.mjs` exports `examSlug(runId)`, `reservedExamPath(p, runId)` and `reservedExamDirs(runId)`; `reservedExamDirs('run-7')` is exactly `['tests/exams/run_7', 'fleet/tests/exams/run_7']`.
M6. `fleet/roles/examiner.md` tells the examiner that an `EXAM PATHS:` line names where each exam is written, in place of the Proof `Test:` path it maps from, and that the file's relative imports are written for the path it lands at; `fleet/tests/test_roles_examiner.mjs` still passes on it.

**Authorized-by:** #777 (desired state, sentence 1 and the `Guard:` clause); #767 decisions 3 and 9; map #766

**Interfaces:**
- Consumes: nothing (the `proofGuards` key is a shared literal, below)
- Produces: `reservedExamPath(p: string, runId: string) -> string`
- Produces: `examSlug(runId: string) -> string`
- Produces: `reservedExamDirs(runId: string) -> string[]`

**Context:** BASE is `1c97ba442c65d882354953d16590b1f8eb0c7a7a` (v0.3.21). The engine's exam machinery is `fleet/run-engine.mjs` lines 1027 (`examinerInputs = testCmdLine(task, workerTestCmd) + sharedInputs`), 1055–1069 (`proofTests`, `examTestCmd`, `blobShaIn`), 1264–1272 (the examiner's blobs and the red-at-BASE probe, read in `exam-<id>`), 1290–1320 (the handoff: `for (const [p, sha] of examinerBlobs) … copyFileSync(path.resolve(examDir, p), dest)`, the re-capture, `examBlobs`), 1363–1368 (`runExam` runs `examTestCmd` in `cloneDir`). The run id is `args.stamp` (run-main sets `stamp = runId`; on the fleet `runId` is `run-<N>`; the sims pass `stamp: 'sim'` or their own). The examiner writes in its own clone `exam-<id>` and its confine root is that clone (`fleet/confine-hook.mjs`: root 1 is the hook's cwd), so no hook change is needed for a path under `tests/exams/`. Shared literal, the task field the compiler emits (Task 2 of this plan): `proofGuards: string[]` on every wave entry, `[]` when the Proof names no `Guard:` — read it exactly as `proofTests` is read (`Array.isArray` then filter strings), and an entry without the key is `[]`. Shared literal, the slug rule: `runId.replace(/[^A-Za-z0-9_]/g, '_')`; the same rule is spelled in bash by `fleet/strip-exams.sh` (Task 4), and the two agree on `run-7` → `run_7`. Shared literal, the prompt line: `\nEXAM PATHS: tests/test_x.py -> tests/exams/run_7/test_x.py` — one line per differing path, in Proof order, placed directly after the `TEST COMMAND:` line and before `FILES:`; the implementer's prompt never carries it. Why the `__init__.py` (M4), measured at BASE with pytest 8.4.2: with `pytest.ini` `testpaths = tests` and no `tests/__init__.py`, a curated `tests/test_a.py` beside `tests/exams/run-53/test_a.py` aborts collection with `import file mismatch` in every shape tried (no `__init__.py`; `__init__.py` in `run-53/`; in `exams/` and `run-53/`), and collects both — `2 passed` — only as `tests/exams/run_53/__init__.py` with an underscore name; `--import-mode=importlib` also collects both but ten curated tests import sibling test modules by name (`import test_compile_plan_proof_runs`), which importlib mode breaks, so the package shape is the one used. The existing sims keep their `proofTests: ['t1_test.sh']` (sixteen files at BASE, none under `tests/` or `fleet/tests/`), and M1's "under neither prefix lands at itself" plus M2's "no `EXAM PATHS:` line" is what keeps `fleet/tests/test_run_engine_exam_together.mjs` (whose leg (a) asserts the exam and implementer tails differ only in the `TEST COMMAND:` line) and its fifteen siblings green without an edit — do not remap a path outside the two prefixes. The patch re-capture after the handoff (`patchAgainstBase({ files: task.files })`) filters only binary drops, so a file outside the task's Files rides the patch as the exam does today. `fleet/roles/examiner.md` is 411 words at BASE (blob `3a8c8acf9e60d1a868db0bbfcc2226d42566bbf4`); sizes are reported, never gated, and `fleet/tests/test_roles_examiner.mjs` refuses `NEVER`/`ALWAYS`/`MUST`, the word `adversarial`, and a second spelling of the reply shape. The sim's examiner stub must read the `EXAM PATHS:` line from its prompt and write where it says — that is what the model does; a stub that writes the Proof path proves nothing. Lesson pasted from the record (run-8, 2026-09-04): a behaviour change owns every existing pin of it — the sixteen sims were grepped for `proofTests: [` and none names a `tests/` or `fleet/tests/` path.

**Proof:**
- Test: `fleet/tests/test_run_engine_reserved_exams.mjs`
- Legs: (a) `reservedExamPath('tests/test_x.py', 'run-7')` is `tests/exams/run_7/test_x.py`, `reservedExamPath('fleet/tests/test_y.mjs', 'run-7')` is `fleet/tests/exams/run_7/test_y.mjs`, `reservedExamPath('t1_test.sh', 'run-7')` is `t1_test.sh`, `examSlug('run-7')` is `run_7`, and `reservedExamDirs('run-7')` deep-equals `['tests/exams/run_7', 'fleet/tests/exams/run_7']` [M1][M5]; (b) a task with `proofTests: ['tests/test_t1.sh']`, `testCmd: 'bash tests/test_t1.sh'`, no `proofGuards`, under `stamp: 'sim1'`: the examiner's prompt has exactly one `EXAM PATHS:` line, `EXAM PATHS: tests/test_t1.sh -> tests/exams/sim1/test_t1.sh`, directly after a `TEST COMMAND: bash tests/exams/sim1/test_t1.sh` line, and the implementer's prompt has no `EXAM PATHS:` line [M2]; (c) the same task with `proofGuards: ['tests/test_t1.sh']`: no `EXAM PATHS:` line, the `TEST COMMAND:` line is `bash tests/test_t1.sh`, and after the wave the branch holds the peer's bytes at `tests/test_t1.sh` and no `tests/exams/` directory [M1][M2]; (d) a task with `proofTests: ['t1_test.sh']` gets an examiner prompt whose tail after `examiner.md` equals the implementer's tail after `implementer.md` once the `TEST COMMAND:` line is swapped, and carries no `EXAM PATHS:` line [M2]; (e) for the unguarded `tests/test_t1.sh` task above, with an implementer stub that also writes its own `tests/test_t1.sh`: after the wave `git show <branch>:tests/exams/sim1/test_t1.sh` is byte-equal to what the examiner wrote, `git show <branch>:tests/test_t1.sh` fails (absent), the row's `examEdited` is `[]`, the `driver:exam-handoff` event's `paths` deep-equals `['tests/exams/sim1/test_t1.sh']`, and every `driver:exam-run` event's `cmd` is `bash tests/exams/sim1/test_t1.sh` [M3]; (f) a task with `proofTests: ['tests/sub/test_t2.py']` and a `testCmd` that does not name the path: after the wave the branch holds `tests/exams/sim1/__init__.py`, `tests/exams/sim1/sub/__init__.py` and `tests/exams/sim1/sub/test_t2.py`, and a task with `proofTests: ['fleet/tests/test_t3.mjs']` leaves no `__init__.py` under `fleet/tests/exams/` [M4]; (g) the sentinel `ALL TESTS PASSED` closes the file [M3].
- Run: grep -q 'EXAM PATHS' fleet/roles/examiner.md
- Run: ! git show $ULTRA_BASE:fleet/roles/examiner.md | grep -q 'EXAM PATHS'
- Run: node fleet/tests/test_roles_examiner.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_exam_together.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (h) `examiner.md` names the `EXAM PATHS:` line, BASE's `examiner.md` does not (the negative control exits 1 on a role file without it), and the role sim still passes on the new text [M6]; (i) the exam-together sim, whose paths are under neither prefix, is unchanged in outcome [M2].

**Stale-if:**
- path-absent: `fleet/run-engine.mjs`
- path-absent: `fleet/roles/examiner.md`
- path-exists: `fleet/exam-paths.mjs`
- issue-closed: #777

### Task 2: `Guard:` in the compiler

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan_proof_tests.py`
- Test: `tests/test_compile_plan_guard.py`

**Claim:** `compile_plan.py` checks that each `Guard:` names a file in the task's Files (an advisory, no new frozen vocabulary) (quoted from #777)
Machine: M1. `parse_claims_body` reads every `- Guard: <path>` bullet of the Proof slot (backticks stripped, whitespace trimmed, first occurrence kept, Proof order) into `claims["proof_guards"]`, and `--emit-args` writes `proofGuards` on every wave entry — that list for a claims-v1 task, `[]` for a task naming none and for a legacy-grammar body.
M2. `--check --renders` prints one `ADVISORY guard: task <id> names `<path>` — not in its Files` line for each `Guard:` path that is not a path of the task's Files block, and prints no `ADVISORY guard:` line for a `Guard:` path that is a Files path and a Proof `Test:` path.
M3. `--check --renders` prints one `ADVISORY guard: task <id> names `<path>` — the Proof names no Test: at that path` line for a `Guard:` path that is in the Files block but is not one of the task's Proof `Test:` paths.
M4. A `Guard:` bullet is neither a `Test:` path nor a `Run:` command: it is absent from `proofTests` and `proofRuns`, derives no `testCmd` of its own, draws no `grammar:` line, and a plan whose only change is a `Guard:` bullet still prints `PLAN OK`.

**Authorized-by:** #777 (desired state, the `compile_plan.py` clause); #767 decisions 3 and 7

**Interfaces:**
- Consumes: nothing
- Produces: `proofGuards` (the wave-entry key; `list[str]`, Proof order)
- Produces: `proof_guards` (the `claims` dict key `parse_claims_body` fills)

**Context:** BASE `1c97ba442c65d882354953d16590b1f8eb0c7a7a`. The Proof slot is read at `skills/ultrapowers/scripts/compile_plan.py` lines 911–930: `FILE_LINE` (line 65, `Create|Modify|Test|…`) fills `proof_tests`/`proof_tests_ordered`, `RUN_LINE` (line 71, `^-\s*Run:\s*(.+)$`) fills `proof_runs`; the dict returned at lines 954–960 is where `proof_guards` joins them; the wave entry is assembled at lines 4302–4313 (`proofTests`, `testCmd`, `proofRuns`) and `proofGuards` goes beside them. The Files block's paths for the M2 check are every `Create:`/`Modify:`/`Test:` bullet of the task's `**Files:**` block (the same `_claims_file_paths` reader). Advisory renders register by appending `(name, fn)` to `ADVISORY_RENDERS` (line 2530; the last append at BASE is `check-cost`, line 3797): give the guard render and its append a region of its own directly after the `check-cost` append, and print nothing for a task with no `Guard:` — `tests/test_compile_plan_proof_runs.py` leg (e) compares every fixture plan's `--check` bytes against the blob at its frozen `BASE_SHA`, and no fixture carries a `Guard:`. `tests/test_compile_plan_proof_tests.py` line 240 pins `PROOF_SLOT_KEYS = ("proofTests", "proofRuns")` and deletes those keys before deep-equalling each fixture's `waves` to a BASE literal, so adding the `proofGuards` key turns that pin red unless the tuple gains `"proofGuards"` — that file is in this task's Files for exactly that edit and nothing else (lesson from run-8: a behaviour change owns every existing pin of it). Shared literal, the emitted shape: `"proofGuards": list(claims.get("proof_guards", []))`, `[]` on a legacy body — the engine (Task 1) reads it with `Array.isArray` and an absent key as `[]`. The frozen periphery (`gate_check.py`, `ultra_gate.py`, `run_acceptance.sh`) is not touched and the plan-level `Check:` diffs them against BASE. The advisory line shape follows `ADVISORY check-cost: … — …` (line 3791): prefix `ADVISORY guard: `, then the task and path, an em dash, the reason.

**Proof:**
- Test: `tests/test_compile_plan_guard.py`
- Legs: (a) a claims-v1 task whose Proof carries `- Test: `tests/test_w.py``, `- Guard: `tests/test_w.py`` and a `- Legs:` line: `parse_claims_body` returns `proof_guards == ["tests/test_w.py"]`, `--emit-args` writes `proofGuards == ["tests/test_w.py"]` on its entry, a sibling task with no `Guard:` writes `proofGuards == []`, and a legacy-grammar plan's entries all carry `proofGuards == []`; a task whose Proof carries `- Guard: `tests/test_w.py``, then `- Guard: `tests/test_v.py``, then `- Guard: `tests/test_w.py`` again returns `proof_guards == ["tests/test_w.py", "tests/test_v.py"]` and, with neither path in its Files block, draws exactly two `ADVISORY guard:` lines, one naming `tests/test_w.py` and one naming `tests/test_v.py` [M1][M2]; (b) the guarded task above, with `tests/test_w.py` in its Files block as a `Test:` bullet: `--check --renders` stdout has no line starting `ADVISORY guard:` [M2]; (c) a task whose `Guard:` names `tests/test_elsewhere.py`, in neither its Files block nor its Proof: stdout has exactly one line starting `ADVISORY guard:` and it contains `tests/test_elsewhere.py` and `not in its Files` [M2]; (d) a task whose Files block lists `- Test: `tests/test_g.py`` and whose Proof names `- Test: `tests/test_w.py`` and `- Guard: `tests/test_g.py``: stdout has exactly one `ADVISORY guard:` line and it contains `the Proof names no Test:` [M3]; (e) for the guarded task above: `proofTests == ["tests/test_w.py"]`, `proofRuns == []`, `testCmd == "python3 -m pytest -q tests/test_w.py"`, no `--check` line contains `grammar:`, and `--check` prints `PLAN OK`; the same plan with the `Guard:` bullet deleted prints byte-identical `--check` stdout [M4].
- Run: python3 -m pytest -q tests/test_compile_plan_proof_tests.py tests/test_compile_plan_proof_runs.py tests/test_compile_plan_task_test_cmd.py
- Legs: (f) the three existing wave-entry pins pass with the new key present [M1].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- path-absent: `tests/test_compile_plan_proof_tests.py`
- issue-closed: #777

### Task 3: The suite collects the reserved directory from the branch

**Type:** implementation

**Files:**
- Modify: `tests/test_fleet_suite.py`
- Test: `tests/test_fleet_suite_collection.py`

**Claim:** inside a run the suite collects that directory from the branch (quoted from #777)
Machine: M1. `tests/test_fleet_suite.py` exports `collect_sims(fleet_dir)`, which returns every `<fleet_dir>/tests/test_*.mjs` and every `<fleet_dir>/tests/exams/*/test_*.mjs`, `SLOW_FIRST` names first and the rest alphabetical by path relative to `<fleet_dir>/tests`, keeping two files of one basename in different directories both.
M2. The bridge's parametrize ids are each path relative to `fleet/tests/` (`test_x.mjs`, `exams/run_7/test_x.mjs`), `TESTS` is `collect_sims(FLEET)`, and on a tree with no `fleet/tests/exams/` directory the bridge collects exactly the files `fleet/tests/test_*.mjs` in the BASE order: the `SLOW_FIRST` members present, in `SLOW_FIRST` order, then every other file sorted by basename.
M3. `python3 -m pytest` from the repo root collects a `.py` exam at `tests/exams/<slug>/test_x.py` beside a curated `tests/test_x.py` of the same basename when `tests/exams/<slug>/__init__.py` is present, running both.

**Authorized-by:** #777 (desired state, sentence 2); #767 decision 4

**Interfaces:**
- Consumes: nothing
- Produces: `collect_sims(fleet_dir: str) -> list[str]`

**Context:** BASE `1c97ba442c65d882354953d16590b1f8eb0c7a7a`; `tests/test_fleet_suite.py` is blob `5fefe7471cf74af1912e0f01af4fc48602da7f5c`: `SLOW_FIRST` at line 19, `_slowest_first(paths)` at line 25 keys `by_name` on `os.path.basename`, so a second file of one basename would be dropped, and `TESTS` at line 33 is `_slowest_first(glob(fleet/tests/test_*.mjs))` — sixty-nine sims at BASE, the parametrize `ids` are basenames, and `python3 -m pytest --collect-only -q tests/test_fleet_suite.py | grep -c '::'` prints `70` at BASE (never pin that number: sibling plans add sims). `tests/conftest.py` moves the bridge to the front by its basename `test_fleet_suite.py` — unchanged. Neither `fleet/tests/exams/` nor `tests/exams/` exists at BASE, which is why CI on main runs the curated tree with no workflow edit: the glob is empty there. Shared literal, the reserved directories (written by the engine, Task 1): `tests/exams/<slug>/` and `fleet/tests/exams/<slug>/`, `<slug>` the run id with every character outside `[A-Za-z0-9_]` replaced by `_`; the engine writes an empty `__init__.py` in `tests/exams/<slug>/` for a `.py` exam. Measured at BASE with pytest 8.4.2 (`pytest.ini`: `testpaths = tests`, no `tests/__init__.py`): `tests/test_a.py` beside `tests/exams/run_53/test_a.py` with `tests/exams/run_53/__init__.py` collects `2 passed`; without the `__init__.py`, or with a hyphenated `run-53` directory, collection aborts with `import file mismatch`. M3's exam builds that tree under `tmp_path` and runs `python3 -m pytest -q` there as a subprocess — it is a fact about the collector the run relies on, not a test of pytest's source. Sibling test modules are imported by name in this suite (`from test_fleet_suite import collect_sims` is the existing convention, e.g. `tests/test_compile_plan_check_cost.py` line 57).

**Proof:**
- Test: `tests/test_fleet_suite_collection.py`
- Legs: (a) under `tmp_path`, a `fleet/tests/` holding `test_a.mjs`, `test_b.mjs`, `test_sandbox_boot.mjs` and `exams/run_7/test_a.mjs`: `collect_sims(tmp_path/'fleet')` returns four paths, `test_sandbox_boot.mjs` (a member of the module's `SLOW_FIRST`, asserted by the test before it relies on it) first, then `exams/run_7/test_a.mjs`, `test_a.mjs`, `test_b.mjs` in that order (relative names), a `_helpers.mjs` beside them and an `exams/run_7/probe_x.mjs` are absent from the result, and a tree without `exams/` returns the three others in the same order [M1]; (b) under `tmp_path`, a tree holding a byte-for-byte copy of the repository's `tests/test_fleet_suite.py` and of its `pytest.ini`, a `fleet/package.json` with no dependencies and an empty `fleet/node_modules/`, and `fleet/tests/test_a.mjs`, `fleet/tests/test_b.mjs`, `fleet/tests/exams/run_7/test_a.mjs`, each a script printing `ALL TESTS PASSED`: `python3 -m pytest --collect-only -q tests/test_fleet_suite.py` run there lists the ids `exams/run_7/test_a.mjs`, `test_a.mjs`, `test_b.mjs` in that order, `python3 -m pytest -q tests/test_fleet_suite.py` run there exits 0 with `4 passed` (three sims and `test_fleet_has_tests`), and after `fleet/tests/exams/run_7/test_a.mjs` is rewritten to exit 1 without the sentinel the same command exits non-zero and its summary names `exams/run_7/test_a.mjs` as the one failure [M2]; (c) `python3 -m pytest --collect-only -q tests/test_fleet_suite.py` from the repository root prints ids that, in printed order, equal the list the test computes itself — not through `collect_sims` — from `glob('fleet/tests/test_*.mjs')` plus `glob('fleet/tests/exams/*/test_*.mjs')`, each relative to `fleet/tests/`, reordered as the `SLOW_FIRST` members present in `SLOW_FIRST` order, then the rest sorted; and when `fleet/tests/exams/` does not exist on the tree at hand (the case at BASE, which the test reads off the filesystem rather than assumes, so a later branch carrying a run's exams keeps this leg green), no printed id contains `exams/` and the list is exactly the `fleet/tests/test_*.mjs` basenames [M2]; (d) under `tmp_path`, a tree holding a byte-for-byte copy of the repository's `pytest.ini`, `tests/test_dup.py` (one passing test) and `tests/exams/run_7/test_dup.py` (one passing test) plus `tests/exams/run_7/__init__.py`: `python3 -m pytest -q` there exits 0 and its last line contains `2 passed`; without the `__init__.py` it exits non-zero [M3].

**Stale-if:**
- path-absent: `tests/test_fleet_suite.py`
- path-exists: `fleet/tests/exams`
- issue-closed: #777

### Task 4: Publish strips the reserved directory onto the record

**Type:** implementation
**Review:** peer

**Files:**
- Create: `fleet/strip-exams.sh`
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_strip_exams.mjs`
- Test: `fleet/tests/test_sandbox_boot_exams.mjs`

**Claim:** An operator opening a run's pull request sees no `tests/exams/` or `fleet/tests/exams/` file in its diff, and opening `ultra/evidence/run-<N>` finds every exam the run wrote under `.ultrapowers/runs/<N>/exams/`. (derived)
Machine: M1. `bash fleet/strip-exams.sh <target-clone> <branch> <run-id> <evidence-dest>`, when `<branch>`'s tree holds `tests/exams/<slug>/` or `fleet/tests/exams/<slug>/` (`<slug>` = `<run-id>` with every character outside `[A-Za-z0-9_]` replaced by `_`), copies every file of each present directory to `<evidence-dest>/exams/<that directory>/…` byte for byte and moves `<branch>` to exactly one new commit whose sole parent is the previous tip, whose subject is `<run-id>: exams to the record`, and whose tree is the previous tree with those directories removed and every other path byte-identical; the clone's `HEAD`, index and working tree are unchanged.
M2. When neither directory is in `<branch>`'s tree the script exits 0, prints one line containing `nothing to strip`, and the branch and `<evidence-dest>` are unchanged.
M3. `push_head` in `fleet/sandbox-boot.sh` runs `bash "$ENGINE_REPO_DIR/fleet/strip-exams.sh" "$TARGET_DIR" "$BRANCH" "$RUN_ID" "$EVIDENCE_DIR/$EVIDENCE_PATH"` before its push, on attempt 1 and again on attempt 2, each time after that attempt's fold unit; and the run's last evidence push (`done`) comes after the strip, so `exams/` rides the commit the evidence tag marks.
M4. `fleet/CONTRACT.md`'s evidence-branch paragraph names `exams/` as the directory publish moves the reserved exam directories into, in a sentence placed after the `transcripts/<sessionId>.jsonl` sentence and before the `The publish fold writes its own` sentence.

**Authorized-by:** #777 (desired state, sentence 3); #767 decisions 1 and 9

**Interfaces:**
- Consumes: nothing
- Produces: `fleet/strip-exams.sh` (argv: target-clone, branch, run-id, evidence-dest)

**Context:** BASE `1c97ba442c65d882354953d16590b1f8eb0c7a7a`. Publish is the boot script's act, not the engine's: `push_head` (`fleet/sandbox-boot.sh` line 1088) pushes `$BRANCH` — a plain push on attempt 1, `--force-with-lease=$BRANCH:<pushedHead>` on attempt 2 — then `await_branch_visible` (line 1286) reads `BRANCH_HEAD` from `git rev-parse "$BRANCH"` and `fold_receipt_set` records it as `pushedHead`; because the strip runs before that read, the lease for attempt 2 is the strip commit the remote actually holds. Attempt 2's fold floors on attempt 1's `candidate` (the folded head BEFORE the strip — `publish-fold.mjs` line 567 `floor = prior.candidate || engineHead`), so the exams return with every re-fold and the strip is re-applied inside `push_head` on every attempt; the fold's own suite therefore still sees the exams (the claim's sentence 2). The target clone's working tree is at `base=`; the branch is a ref (`ultra/integration-run-<N>`), so the strip is plumbing against the ref, never a checkout: read the tree with `git ls-tree -d --name-only <branch> -- <dir>` (present when the line prints), copy with `git archive <branch> -- <dirs> | tar -x -C <evidence-dest>/exams` (or `git show <branch>:<path>` per file from `git ls-tree -r --name-only`), build the new tree under a temporary `GIT_INDEX_FILE` (`read-tree <branch>`, `rm -r --cached -q -- <dirs>`, `write-tree`, `commit-tree -p <branch>`), and `git update-ref refs/heads/<branch> <new> <old>`. The evidence worktree is `$EVIDENCE_DIR` and the run's path inside it is `$EVIDENCE_PATH` (`.ultrapowers/runs/<N>`, line 401); `push_evidence` stages `$EVIDENCE_PATH` whole, so a directory written there rides the next evidence commit without a `collect_evidence` list change — the publish fold's `publish-fold/` receipts already ride that way (line 872 `fold_dir`). `RUN_ID` is `run-<N>` (line 397). Shared literal, the slug rule (also spelled in `fleet/exam-paths.mjs`, Task 1): `run-7` → `run_7`, `printf '%s' "$RUN_ID" | tr -c 'A-Za-z0-9_\n' '_'`. The boot rig (`fleet/tests/_sandbox_boot_helpers.mjs`) stubs `git` wholesale (its `git` stub answers `rev-parse`, `rev-list`, `ls-remote`, `push`, and exits 0 for everything else) and builds a fake engine checkout at `$FLEET_HOME/engines/<sha>/fleet/` holding empty `run-main.mjs`, `publish-fold.mjs` and a `package.json` (`makeHome`, line 620–635); `makeHome` must also write `strip-exams.sh` there as a stub that appends `<time> CALL strip-exams <argv…>` to `$FLEET_HOME/fleet-boot.log` (the `say` shape of `PRELUDE`, line 606) and exits 0, so the boot sim reads its position in the one stream with `stream`/`indexOf`; the real script's behaviour is proven in `test_strip_exams.mjs` against REAL git repositories (the rig for that is the file's own: `git init`, commits, a branch carrying `tests/exams/run_7/test_a.py`, `tests/exams/run_7/__init__.py`, `fleet/tests/exams/run_7/test_b.mjs`, a Guard exam at `tests/test_guard.py` and a curated `tests/test_c.py`). `fleet/tests/test_publish_fold.mjs` leg (h) slices `fleet/CONTRACT.md` between the anchors `The publish fold writes its own `publish-fold/` receipts directory` and `\n    Committed from a detached worktree` and between `Its disposition is one of `folded`` and `A `hold=1` run still folds` — the new sentence goes BEFORE the first anchor (after the `transcripts/<sessionId>.jsonl` sentence, lines 50–51) and inside neither region. `tests/test_docs_agree_with_code.py` checks that every `fleet/*.mjs|sh` named in `SKILL.md`, `first-run.md`, `RUNBOOK.md` and `README.md` exists — this task names the new script only in `CONTRACT.md`, which that test does not read. Scripts pass `bash -n` (contract §Rules).

**Proof:**
- Test: `fleet/tests/test_strip_exams.mjs`
- Test: `fleet/tests/test_sandbox_boot_exams.mjs`
- Legs: (a) `test_strip_exams.mjs`: a real repository whose branch `ultra/integration-run-7` carries `tests/exams/run_7/__init__.py`, `tests/exams/run_7/test_a.py`, `fleet/tests/exams/run_7/test_b.mjs`, `tests/test_guard.py` and `tests/test_c.py`, with the clone's `HEAD` on `main`: after `bash fleet/strip-exams.sh <clone> ultra/integration-run-7 run-7 <dest>`, `git rev-parse ultra/integration-run-7^` equals the previous tip, `git log -1 --format=%s ultra/integration-run-7` is `run-7: exams to the record`, `git ls-tree -r --name-only ultra/integration-run-7` contains neither `tests/exams/` nor `fleet/tests/exams/` and still contains `tests/test_guard.py` and `tests/test_c.py` with their blob shas unchanged, `<dest>/exams/tests/exams/run_7/test_a.py` and `<dest>/exams/fleet/tests/exams/run_7/test_b.mjs` are byte-equal to the branch's previous blobs, and `git rev-parse HEAD`, `git status --porcelain` and the index are what they were [M1]; (b) a branch carrying only `fleet/tests/exams/run_7/test_b.mjs`: exactly that directory is stripped and copied, `tests/` untouched [M1]; (c) a branch with neither directory: exit 0, stdout contains `nothing to strip`, the tip sha and `<dest>` unchanged [M2]; (d) `test_sandbox_boot_exams.mjs`, the green boot: in `fleet-boot.log` a `CALL strip-exams <target> ultra/integration-run-7 run-7 <evidence>/.ultrapowers/runs/7` line sits after the `systemd-run fold fleet-fold-7-1` line and before the first `git … push origin ultra/integration-run-7` argv line, and the last evidence push (`isEvidencePush`) is after it; a boot under `STUB_NO_COMMITS=1` (nothing ahead of base, no push) has no `CALL strip-exams` line at all [M3]; (e) the same boot under `STUB_MERGE_CODE=405` with `STUB_HEAD_SHA_2` set (the retry): two `CALL strip-exams` lines, the second after `systemd-run fold fleet-fold-7-2` and before the `--force-with-lease` push [M3]; (f) the sentinel `ALL TESTS PASSED` closes both files [M1].
- Run: bash -n fleet/strip-exams.sh
- Run: bash -n fleet/sandbox-boot.sh
- Run: sed -n "/the run.s record under/,/The publish fold writes its own/p" fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'transcripts/<sessionId>.jsonl.*exams/'
- Run: node fleet/tests/test_publish_fold.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (g) both scripts parse [M1][M3]; (h) the contract names `exams/` after the transcripts sentence and before the publish-fold sentence, and the fold sim's contract anchors still hold [M4].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-exists: `fleet/strip-exams.sh`
- issue-closed: #777

### Task 5: ultrawrite teaches `Guard:`

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `skills/ultrapowers/references/plan-markers.md`

**Claim:** An author reading ultrawrite's Proof slot learns that an exam lives on the run's evidence tag unless the Proof marks it `Guard:`, which names one of its `Test:` paths and merges that file, and learns where the exam lands on the branch. (derived)
Machine: M1. The `**Proof:**` bullet of `skills/ultrawrite/SKILL.md` (from the line beginning `- **Proof:**` to the line beginning `- **Stale-if:**`) states that a `- Guard:` bullet names one of the task's Proof `Test:` paths, that the file it names is written at that path and merged, and that an exam without one lives on the evidence tag `ultra/evidence/run-<N>` and is stripped from the pull request.
M2. The same region states that the examiner writes an unguarded exam under `tests/exams/<run>/` (or `fleet/tests/exams/<run>/`), so a `.mjs` exam's relative imports are written for that depth, and that a `Guard:` is what protects a later run from breaking this claim (the `runner_for` class).
M3. `skills/ultrapowers/references/plan-markers.md` §Proof grammar states the runtime half: the driver writes each unguarded exam under the reserved directory, publish moves it onto the evidence tag, and a `Guard:` file stays at its path.
M4. `validate_skill.py` accepts `skills/ultrawrite`, and the execution-handoff rubric pinned by `tests/test_recommendation_rubric.py` is unchanged.

**Authorized-by:** #777 (desired state, the ultrawrite clause); #767 decision 3

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** BASE `1c97ba442c65d882354953d16590b1f8eb0c7a7a`; `skills/ultrawrite/SKILL.md` is blob `b86897b9a8d63058885a17b27202d9d978067cd3` (398 lines) and `skills/ultrapowers/references/plan-markers.md` is blob `4c3ca486d67173d0f4a1fc6992ea17560f0a651c` whose `## Proof grammar` section (line 223) is its last, three sentences on `Run:`. The Proof slot bullet runs from line 91 (`- **Proof:** the exam — tests, golden pairs …`) through line 123, the `Run:` paragraph starting at line 100 — put the `Guard:` paragraph directly after the `Run:` paragraph and before the `Name **one exam file per behaviour surface**` paragraph, and revise that paragraph's "extends that file instead of opening a second one": under the reserved directory an unguarded exam is a new file per run by construction, so "extend the existing file" now means a `Guard:`. `tests/test_recommendation_rubric.py` pins tokens of the `## Execution handoff` section against `hooks/session_start.sh` — do not touch that section. `tests/test_docs_agree_with_code.py` reads `skills/ultrapowers/SKILL.md`, not ultrawrite's. Decision text to teach, quoted from #767: "The author writes `Guard:` in Proof at plan time, like `Run:`; the compiler checks it names a file in Files; the peer examiner still writes it. Absent = tag only." and "The only defect class a merged exam protects beyond the tag is a LATER run breaking an EARLIER claim (run-8's `runner_for` pin). That class is what `Guard:` is for." The bullet shape the compiler reads (Task 2): `- Guard: `tests/test_x.py``, in the Proof slot, naming a `Test:` path of the same Proof; the advisory when it does not. No `Run:` command below carries a backtick — the greps look for the word `Guard:` and the path prefix, never a backticked literal.

**Proof:**
- Run: sed -n '/^- \*\*Proof:\*\*/,/^- \*\*Stale-if:\*\*/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'Guard:.*Test:.*merged'
- Run: sed -n '/^- \*\*Proof:\*\*/,/^- \*\*Stale-if:\*\*/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'ultra/evidence/run-<N>'
- Run: ! git show $ULTRA_BASE:skills/ultrawrite/SKILL.md | sed -n '/^- \*\*Proof:\*\*/,/^- \*\*Stale-if:\*\*/p' | grep -q 'Guard:'
- Run: sed -n '/^- \*\*Proof:\*\*/,/^- \*\*Stale-if:\*\*/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'tests/exams/<run>/.*fleet/tests/exams/<run>/.*relative imports'
- Run: sed -n '/^- \*\*Proof:\*\*/,/^- \*\*Stale-if:\*\*/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'Guard:.*later run'
- Run: sed -n '/^## Proof grammar/,$p' skills/ultrapowers/references/plan-markers.md | tr '\n' ' ' | grep -q 'tests/exams/<run>/.*evidence tag.*Guard:'
- Run: ! git show $ULTRA_BASE:skills/ultrapowers/references/plan-markers.md | grep -q 'Guard:'
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite | grep -q 'skill ok'
- Run: python3 -m pytest -q tests/test_recommendation_rubric.py
- Legs: (a) the Proof bullet names `Guard:`, ties it to a `Test:` path and says the file is merged, and BASE's Proof bullet, which has no `Guard:`, fails that grep (the negative control exits 1 there) [M1]; (b) the same region names the evidence tag `ultra/evidence/run-<N>` as where an unguarded exam lives [M1]; (c) the region names `tests/exams/<run>/`, `fleet/tests/exams/<run>/` and the relative-imports consequence [M2]; (d) the region names the later-run class a `Guard:` protects [M2]; (e) plan-markers' §Proof grammar names the reserved directory, the evidence tag and `Guard:` in that order, and BASE's plan-markers.md, with no `Guard:` anywhere, fails that grep [M3]; (f) `validate_skill.py` prints `skill ok` (its refusal line would fail the grep) and the rubric pin passes [M4].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
- path-absent: `skills/ultrapowers/references/plan-markers.md`
- issue-closed: #777

### Task 6: The fold finds an exam where the engine wrote it

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/publish-fold.mjs`
- Test: `fleet/tests/test_publish_fold.mjs`

**Claim:** An operator whose run folds over a moved main still sees the joined path's exams run before the suite — this run's at the reserved directory, and a `Guard:` exam (one the Proof kept at its own `Test:` path) at that path — and a main-side exam that now lives on its tag is recorded as skipped rather than failing the fold. (derived)
Machine: M1. For each contender `{ run, task }` of a joined path, `EXAM_CHECK` runs each Proof `Test:` exam at `reservedExamPath(exam, 'run-' + run)` — imported from `fleet/exam-paths.mjs`, where `tests/<rest>` maps to `tests/exams/run_<N>/<rest>` and `fleet/tests/<rest>` to `fleet/tests/exams/run_<N>/<rest>` (the run id `run-<N>` with `-` replaced by `_`) and any other path maps to itself, so run 7's `tests/exam_run.mjs` is `tests/exams/run_7/exam_run.mjs` — when that file exists in the candidate tree, else at `exam` when that file exists; the `exam` field of the recorded check and of a `suite red` reason is the path it ran.
M2. An exam present at neither path is recorded as `{ check: 'exam', exam, path, result: 'skipped' }`, is not run, and does not stop the pass or change the disposition.
M3. The existing legs of `fleet/tests/test_publish_fold.mjs`, whose exams sit at repository-root paths, pass unchanged.
M4. Every exam check of an attempt runs before that attempt's suite command, as `CANDIDATE_CHECKS` orders them at BASE.

**Authorized-by:** #777 (desired state, sentence 2 — the fold's suite sees the exams); #767 decisions 1 and 4; #754

**Interfaces:**
- Consumes: `reservedExamPath(p: string, runId: string) -> string`
- Produces: nothing

**Context:** BASE `1c97ba442c65d882354953d16590b1f8eb0c7a7a`. `fleet/publish-fold.mjs` lines 196–242 (`EXAM_CHECK`): `contendingTasks` (`fleet/publish-fold-block.mjs` line 236) answers `[{ run, task }]` where `run` is each contender's own run NUMBER (`'7'`, the `--run` argv value for this run's tasks, and the frontier commit's `Fleet-Run:` number for a main-side task), `proofExams(task.body)` reads the `- Test:` bullets, and `examArgvFor(exam)` runs `node`/`python3 -m pytest -q`/`bun test` on that path in `ctx.integ`, the candidate's tree; an absent file exits non-zero and the pass stops as `suite red` with `reason: <exam> red on <path>`. The engine's run id on the fleet is `run-<N>` (`RUN_ID`), so the reserved path of a contender is `reservedExamPath(exam, 'run-' + run)` — `tests/test_x.py` under run 7 is `tests/exams/run_7/test_x.py`. Why the fold has to change: once the engine's handoff writes this run's exam at the reserved path, and once publish strips a run's exams onto its evidence tag, a main-side run's exam is absent from every later tree — running the Proof path verbatim would read `suite red` for a file that was never meant to be there. Why the runtime dependency (rule 2): the fold opens the file where the engine's handoff put it; the landing path is what Task 1's engine writes at run time, and importing `reservedExamPath` from `fleet/exam-paths.mjs` is what keeps the two from drifting. Decision 1 (#767) accepts that a main-side exam no longer runs at the fold: "the A1/A2 seam class stays with CI on the merge commit". The sim's rig writes exams at repository-root paths (`exam_main.mjs`, `exam_run.mjs`, `exam_mod.mjs`, lines 1728–1844) — under neither prefix, so `reservedExamPath` returns them unchanged and M3 holds without editing those legs; add the new legs under a comment naming this task, using the rig's `newCase`/`cliRun`/`recorder` seams and its receipt readers (`receipt.json` `attempts.<n>.checks`). `fleet/CONTRACT.md`'s receipts sentence (`{ check, exam, path, result }`) is unchanged: `skipped` is already a value it documents.

**Proof:**
- Test: `fleet/tests/test_publish_fold.mjs`
- Legs: (a) a case whose run task's Proof names `- Test: `tests/exam_run.mjs`` and whose branch carries the exam at `tests/exams/run_7/exam_run.mjs` and nothing at `tests/exam_run.mjs`: the receipt's checks carry `{ check: 'exam', exam: 'tests/exams/run_7/exam_run.mjs', path: 'a.txt', result: 'pass' }`, the recorded argv ran `node tests/exams/run_7/exam_run.mjs`, and the disposition is `folded`; the same case with that exam exiting 1 is `suite red` with `reason` `tests/exams/run_7/exam_run.mjs red on a.txt` [M1]; (b) a case whose run task's Proof names `- Test: `tests/exam_guard.mjs`` (the `Guard:` shape: the file sits at its Proof path) with the file at `tests/exam_guard.mjs` and nothing at `tests/exams/run_7/exam_guard.mjs`: the check's `exam` is `tests/exam_guard.mjs`, the recorded argv ran `node tests/exam_guard.mjs`, and the disposition is `folded` [M1]; (c) a case whose main-side contender (a frontier commit carrying `Fleet-Run: 3` and a plan tag whose task names `- Test: `tests/exam_three.mjs``) has that file at neither `tests/exams/run_3/exam_three.mjs` nor `tests/exam_three.mjs` in the candidate: the checks carry `{ check: 'exam', exam: 'tests/exam_three.mjs', path: 'a.txt', result: 'skipped' }`, no argv names `exam_three.mjs`, the run's own exam still runs after it, and the disposition is `folded` [M2]; (d) in the case of the first leg, the recorder's call list has the `node tests/exams/run_7/exam_run.mjs` call at a lower index than the attempt's suite command call (`bash check.sh`), and a `suite red` from that exam records `suite: 'none'` — the suite never ran [M4]; (e) every leg of the file present at BASE passes unchanged [M3]; (f) the sentinel `ALL TESTS PASSED` closes the file [M1].

**Stale-if:**
- path-absent: `fleet/publish-fold.mjs`
- path-absent: `fleet/exam-paths.mjs`
- issue-closed: #777
