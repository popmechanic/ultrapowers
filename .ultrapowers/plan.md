# The first ratchet — seven silent sims go, and the counter's window is honest

**Grammar:** claims-v1

**Claim:** do: run the suite. see: seven sims that caught nothing in fifteen runs are gone and it is still green; and the counter's report now counts a test's window only from the run after it landed and never lists the bridge that runs the sims. (elicited)

**Summary:** The project keeps a meter that says which tests have ever caught a real defect. Seven engine simulations have had fifteen chances and caught nothing, so this run deletes them, as the doctrine says ballast goes. It also fixes two ways the meter could mislead: a brand-new test was being judged against runs that happened before it existed, and the harness that runs every simulation was showing up as a test that never caught anything. After this run the meter's list of deletion candidates is one you can act on without a second look.

**Goal:** #871 decision 7 as amended 2026-09-10 (the window counts only runs since the test landed; runners are never candidates) and #875 step 1's first deletion: the seven files at zero catches over the N=15 window that existed through it and that no in-flight plan touches — `fleet/tests/test_publish_fold.mjs`, `test_run_engine.mjs`, `test_run_engine_baseline.mjs`, `test_run_engine_exam_evidence.mjs`, `test_run_engine_suite_passes.mjs`, `test_run_main.mjs`, `test_sandbox_boot_approval_evidence.mjs` — go; `catch_counter.py` records each run's start; `catch_report.py` counts a test's window from its landing and marks runners. The six zero-catch files that plans in flight modify (`_reconcile`, `_red_suite_record`, `_integrated_clean`, `_state_exams`, `test_sandbox_boot.mjs`, `test_docs_agree_with_code.py`) are the next ratchet's.

**Tech Stack:** Python 3 (`skills/ultralearn/scripts/catch_counter.py`, `catch_report.py`, pytest), Node 24 ESM sims, Markdown

**Spec:** #875 (step 1's reading of 2026-09-10 on the ticket); memory `grilling-871-suite-as-sensor-decisions` decision 7; every fact a worker needs is in its task's Context.

**Parallelization rationale:** one wave, two wide. Task 1 deletes sims and their mentions; task 2 changes the two ultralearn scripts and their tests. Disjoint files, no shared symbol. No chain.

**Launch base:** after the queue (the engine plan, the card, the Viz sensor, #887) has merged, so that no in-flight plan's Files meet a deletion.

## Global Constraints

- A deletion is whole: no test, mention or bridge entry survives that names a deleted file, except history (a past run's reading in CLAUDE.md's Doctrine section, a fixture plan under `tests/fixtures/`, or a plan under `docs/`).
- Check: python3 -m pytest -q tests/test_fleet_suite_collection.py

**Acceptance:** suite — the committed suite is the verification.

### Task 1: Seven sims that caught nothing are gone

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_publish_fold.mjs`
- Modify: `fleet/tests/test_run_engine.mjs`
- Modify: `fleet/tests/test_run_engine_baseline.mjs`
- Modify: `fleet/tests/test_run_engine_exam_evidence.mjs`
- Modify: `fleet/tests/test_run_engine_suite_passes.mjs`
- Modify: `fleet/tests/test_run_main.mjs`
- Modify: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`
- Modify: `tests/test_fleet_suite.py`
- Modify: `CLAUDE.md`
- Modify: `fleet/tests/test_run_record_keys.mjs`
- Modify: `fleet/roles/README.md`

**Claim:** Seven sims that caught nothing in fifteen runs are gone, nothing left in the tree names them, and the bridge still collects the rest. (derived)
Machine: M1. For each of `fleet/tests/test_publish_fold.mjs`, `fleet/tests/test_run_engine.mjs`, `fleet/tests/test_run_engine_baseline.mjs`, `fleet/tests/test_run_engine_exam_evidence.mjs`, `fleet/tests/test_run_engine_suite_passes.mjs`, `fleet/tests/test_run_main.mjs`, `fleet/tests/test_sandbox_boot_approval_evidence.mjs`: the path is absent. M2. `tests/test_fleet_suite.py` names none of the seven basenames, and `CLAUDE.md` contains no `test_run_engine.mjs` outside its `## Doctrine` section. M3. `python3 -m pytest -q tests/test_fleet_suite_collection.py` passes, and the bridge's collected sim list (`collect_sims('fleet')` in `tests/test_fleet_suite.py`, run from the tree) still holds more than fifty sims and contains none of the seven.

**Authorized-by:** #871 decision 7 (amended 2026-09-10); #875 step 1's reading (N=15 window)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The seven are whole-file deletions; none exports a symbol and no sim imports from them (checked at BASE: zero `export` lines, zero `from './<name>'` imports). Who names them outside history: `tests/test_fleet_suite.py:72-73` lists `test_run_engine_exam_evidence.mjs` and `test_publish_fold.mjs` in a tuple (the slow-sims set with a longer wall) — drop those two entries; `CLAUDE.md:132` says prose sizes are reported in "`test_run_engine.mjs`'s stderr" — drop that clause (the release commit body and `wc -w` remain the reporting sites); `CLAUDE.md:213` names `test_publish_fold.mjs` as one of the four kernel-seen pairs of the 2026-09-08 drain — that is history in the `## Doctrine` section and stays. `tests/test_fleet_suite_collection.py:124` names `exams/run_7/test_publish_fold.mjs` in a docstring as a fixture path — a fixture name, stays. `tests/fixtures/plans/2026-09-07/*.md` name `test_run_main.mjs` and `test_sandbox_boot_approval_evidence.mjs` — fixture plan texts read by no test as executable, stay. Sims that pin a sibling's existence by name (`existsSync(path.join(REPO_ROOT, 'fleet/tests', name))`): `test_run_engine_exam_evidence.mjs:481` and `test_run_main.mjs:759` are among the deleted, and no surviving sim names one of the seven that way (checked at BASE). The in-flight engine plan's task 4 names `test_run_engine_early_baseline.mjs` and `test_run_engine_baseline.mjs` as `Run:` probes — that run lands before this one and its probes ran on its own base; after this deletion a future plan cannot name `test_run_engine_baseline.mjs`, which is the point. Every remaining reference to any of the seven basenames under `fleet/`, `skills/`, `tests/` (outside `tests/fixtures/`) is an error to fix here. Two files outside the seven pin their existence and must move with them (read at BASE `eefdffe4`, 2026-09-11): `fleet/tests/test_run_record_keys.mjs:442-448` has a case `the three sims the Proof runs are still there for the bridge` asserting `test_run_engine.mjs`, `test_run_main.mjs` and `test_sandbox_boot_approval_evidence.mjs` exist under `fleet/tests/` — delete that case whole (its comment at `:26` names the same three; reword it), since with the three gone it has nothing left to grade; and `fleet/roles/README.md:24` says `fleet/tests/test_run_engine.mjs` prints each role file's word count — reword to name where the prose sizes are reported now (the release commit body), or drop the sentence. Comments in `test_roles_peer.mjs:37,77` and `test_weave_emit.mjs:6` mention `test_run_engine.mjs` as history and stay.

**Proof:**
- Run: for f in test_publish_fold.mjs test_run_engine.mjs test_run_engine_baseline.mjs test_run_engine_exam_evidence.mjs test_run_engine_suite_passes.mjs test_run_main.mjs test_sandbox_boot_approval_evidence.mjs; do test ! -e "fleet/tests/$f" || { echo "survives: $f"; exit 1; }; done
- Run: for f in test_publish_fold.mjs test_run_engine.mjs test_run_engine_baseline.mjs test_run_engine_exam_evidence.mjs test_run_engine_suite_passes.mjs test_run_main.mjs test_sandbox_boot_approval_evidence.mjs; do test "$(grep -c "$f" tests/test_fleet_suite.py)" = 0 || { echo "bridge names: $f"; exit 1; }; done; test "$(sed -n '1,/^## Doctrine/p' CLAUDE.md | grep -c 'test_run_engine\.mjs')" = 0 && test "$(sed -n '/^## How features are built/,$p' CLAUDE.md | grep -c 'test_run_engine\.mjs')" = 0
- Run: python3 -m pytest -q tests/test_fleet_suite_collection.py && python3 -c "import sys, os; sys.path.insert(0,'tests'); import test_fleet_suite as b; names={os.path.basename(p) for p in b.collect_sims('fleet')}; bad=[n for n in ('test_publish_fold.mjs','test_run_engine.mjs','test_run_engine_baseline.mjs','test_run_engine_exam_evidence.mjs','test_run_engine_suite_passes.mjs','test_run_main.mjs','test_sandbox_boot_approval_evidence.mjs') if n in names]; assert not bad, bad; assert len(names) > 50, len(names); print('bridge collects none of the seven')"
- Legs: (a) the first Run: names any of the seven that survives and fails [M1]; (b) the second Run: names any of the seven still in the bridge and fails, and fails on `test_run_engine.mjs` anywhere in CLAUDE.md before `## Doctrine` or after `## How features are built` [M2]; (c) the third Run: runs the collection test and asks the bridge's own collector, failing on any of the seven in its list [M3].

**Stale-if:**
- path-absent: `tests/test_fleet_suite.py`
- path-absent: `tests/test_fleet_suite_collection.py`

### Task 2: The counter's window starts when the test lands, and runners are never candidates

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultralearn/scripts/catch_counter.py`
- Modify: `skills/ultralearn/scripts/catch_report.py`
- Modify: `skills/ultralearn/SKILL.md`
- Modify: `tests/test_ultralearn_catch_report.py`
- Modify: `tests/test_ultralearn_catches.py`
- Test: `tests/test_catch_report_window.py`

**Claim:** The counter's report counts a test's window only from the run after it landed and never lists the bridge that runs the sims. (derived)
Machine: M1. Each `catch-count` row `catch_counter.py` writes carries `startedAt`, the run directory's `status.json` `startedAt` string, or `null` when that file or key is absent. M2. `catch_report.py` counts, for each test, `touchingRuns` over the rows whose `startedAt` is later than the test's landing — the committer date of the commit that first added the file, read from the `--tree` with `git log --diff-filter=A --format=%cI -1 -- <path>`; a file with no such commit (untracked) lands at the epoch; a row with no `startedAt` counts toward no test's window, and the report ends with one line `<k> row(s) carry no startedAt — recount them` when `k` is above zero and prints no such line when it is zero. M3. When two rows carry the same `runId`, the later row in the ledger is the one read and the earlier contributes nothing. M4. A test file whose text contains the line `# catch-counter: runner` has status `runner`, is counted in no curve point, and appears in no `--n` listing; `tests/test_fleet_suite.py` carries that line. M5. `skills/ultralearn/SKILL.md`'s counter section says the window starts at the test's landing, that a recount supersedes an earlier row, and what the runner marker is.

**Authorized-by:** #871 decision 7 as amended 2026-09-10 (operator: count only runs since the test landed; exclude runners)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `catch_counter.py` writes one `catch-count` row per run directory with `id`, `kind`, `runId`, `driverRuns`, `reds`, `catches`, `touched`, `exercises` (its `main` and the row builder near `touched = sorted(...)`); the run directory always holds `status.json` (the boot script copies it into the record) whose `startedAt` is an ISO string like `2026-09-10T16:28:26Z` — add `startedAt` to the row, `null` when unreadable, following the file's rule that a missing record is an empty record, never a traceback. `catch_report.py`: `catch_table(rows, tree_tests)` computes `touchingRuns` as the number of rows whose `touched` intersects the test's union `exercised`; make it `catch_table(rows, tree_tests, landed=None, ...)` where `landed` maps test path → ISO date (built by a new `landing_dates(tree, paths)` that runs `git log --diff-filter=A --format=%cI -1 -- <path>` once per path in `--tree`, returning the epoch `1970-01-01T00:00:00+00:00` for a path git does not know), and count a row only when it has a `startedAt` and `startedAt > landed[path]` (compare as `datetime` after parsing; `Z` is UTC, the git date carries an offset). Rows are de-duplicated by `runId` first, last wins (`_catch_rows` gains that pass; ledger rows are append-only, so a recount is an appended row). The runner marker: `tree_test_files` stays; a new `runner_files(tree, paths)` reads each test file and returns those containing the exact line `# catch-counter: runner` (for a `.mjs` file the same text after `//` also counts); `_status` returns `runner` for them regardless of catches, `zero_curve` and `zero_over` skip them, and `table_lines` prints them with their status. The report's last line today is `max touching runs: N`; the `startedAt` note goes after it. `tests/test_fleet_suite.py` gains the marker as its second line (after the module docstring's first line or as the first comment). `tests/test_ultralearn_catch_report.py` (16 cases) builds rows without `startedAt` and pins `touchingRuns` counts (legs (a), (b), (e), (h), (i)) — those fixtures gain `startedAt` values later than the fixture tree's landing (the fixture tree is created under `tmp_path`, so its files are untracked and land at the epoch: any real date counts) and keep their counts; add nothing else there. `tests/test_ultralearn_catches.py` (27 cases) pins the counter's rows field by field — add one case there asserting `startedAt` on a row, under a comment naming this task. The existing 29 ledger rows on the laptop carry no `startedAt`; the operator recounts runs 60–89 after this lands (the last-row-wins rule is what makes that a recount and not a duplicate). The exam builds a tmp tree with a git history: one test file committed at a known date, a second untracked, a third carrying the runner marker; rows with `startedAt` before and after the committed date; two rows sharing a `runId`.

**Proof:**
- Test: `tests/test_catch_report_window.py`
- Guard: `tests/test_catch_report_window.py`
- Legs (the driver runs the `Test:` file as this task's exam command; the `Run:` lines are the two sibling test files): (a) `catch_counter.py` run over a run directory whose `status.json` carries `startedAt` `2026-09-10T16:28:26Z` appends a row with exactly that string; over a run directory with no `status.json`, and over one whose `status.json` is `{}` (no `startedAt` key), it appends a row with `startedAt` `null` — three run directories, three rows, none raising [M1]; (b) in a tmp git tree where `tests/test_a.py` was committed at `2026-09-05T12:00:00+00:00`, a row touching what it exercises with `startedAt` `2026-09-04T00:00:00Z` counts 0 touching runs for it, a row at `2026-09-06T00:00:00Z` counts 1, and a row with no `startedAt` counts 0 and yields the line `1 row(s) carry no startedAt — recount them`; an untracked `tests/test_b.py` counts the `2026-09-04` row (epoch landing); with every row carrying `startedAt` the note line is absent [M2]; (c) two rows with `runId` `run-7`, the first touching `test_a.py`'s paths and the second touching nothing, yield 0 touching runs for `test_a.py` (last wins), and reversed yield 1 [M3]; (d) a file `tests/test_bridge.py` containing the line `# catch-counter: runner` and exercised by every row has status `runner`, the curve at N=1 counts 0 for it while a sibling zero test counts 1, and `--n 1` lists the sibling and not the bridge; `grep -c '^# catch-counter: runner$' tests/test_fleet_suite.py` is 1 [M4]; (e) the counter section of `skills/ultralearn/SKILL.md` (from the heading containing `catch counter` to the next `## `) contains `landed`, `recount` and `catch-counter: runner` [M5].
- Run: python3 -m pytest -q tests/test_ultralearn_catch_report.py
- Run: python3 -m pytest -q tests/test_ultralearn_catches.py

**Stale-if:**
- path-absent: `skills/ultralearn/scripts/catch_report.py`
- path-absent: `skills/ultralearn/scripts/merge_ledger.py`
