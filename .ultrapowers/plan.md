# The catch counter — every test carries the count of reds a fix to implementation turned green

**Grammar:** claims-v1

**Claim:** A catch is a red the fix round then turned green by editing implementation files, never the test and never by re-run alone; ultralearn derives, from each run's recorded driver events (the proof, exam and check runs and the fix-round worker records; #702's slices do not carry per-round patches) and suite records, a per-test-file catch count, records it in the ledger, and emits the list of test files at zero catches over N runs that touched the paths those tests exercise; that list is the input to a deletion plan that goes through the gate like any work. (quoted from #778)

**Goal:** #778 (map #766 The Exam Lifecycle, decisions 2 and 5 of the #767 grilling). Nothing
records what a test has caught since it landed; the two prunings so far (#612, #592) were on
narrative. This plan adds two read-only ultralearn scripts and a SKILL.md section. Seven choices
were made here in place of an operator question, each the least-machinery option: (1) **the
derivation reads the driver's own records, never a transcript** — the evidence tag carries no
`patches/` directory and no per-round patch (a fix round's capture is cumulative and overwrites
`task-<id>.patch`), and the #702 slice elides the middle of a session (run-44's fix worker slice
dropped 15 records, its one edit among them), so a "red the fix round turned green" is read off
`events.jsonl` — a `driver:exam-run` / `driver:proof-run` / `driver:check-run` with `exit` ≠ 0, a
`worker:end` labelled `fix:<task>:<n>`, then the same command green — and "never the test" off the
two fields that record what a fix round may have written: the task row's `examEdited` in
`report.json` and the task's `writes` in `receipt.json`. (2) A red command that names several test
files credits each of them — over-credit is the safe direction for a deletion input — and one path
is credited at most once per fix round. (3) A test's *exercised paths* come from the record too: a
test named by a task's driver run exercises that task's `writes`; the tree is never parsed. (4) The
sink is the findings ledger file itself (`docs/superpowers/observations/ledger.jsonl`, overridable),
as rows of `kind: catch-count` with their own `id`; `merge_ledger.py` is untouched, so its digest's
header count will include these rows under no lens — accepted. (5) The counter is run on this
repository's own runs; it has no origin or redaction concept. (6) The tree's tests are
`tests/test_*.py` and `fleet/tests/test_*.mjs`. (7) **N is emitted, not chosen:** the report prints
the zero-catch curve — for every N up to the largest touching-run count the record holds, how many
tests sit at zero — and lists the deletion input only when the operator passes `--n`. Measured at
BASE over the 68 evidence tags (66 carry driver-run events): 17 credits across 16 test files in
5 runs, 163 of 187 tree tests observed, largest touching-run count 65, 147 tests at zero for N=1.
**Closes:** #778

**Tech Stack:** Python 3 standard library only (`skills/ultralearn/scripts/*.py` declares no
dependency; sibling imports through `sys.path.insert(0, str(Path(__file__).resolve().parent))` as
every script there does). The committed suite is `python3 -m pytest` from the repo root
(`pytest.ini` scopes collection to `tests/`); `tests/test_ultralearn_swallows.py` globs every
script under `skills/ultralearn/scripts/`, so a new script's every `except` handler raises or
calls `swallow("<literal reason>")`.

**Parallelization rationale:** two waves. Wave 1, width 2: the counter (Task 1) and the report
(Task 2) share one literal — the `catch-count` row — written into both Contexts, and neither
imports the other; the report consumes the row's shape, not the counter's behaviour, so it stubs
rows. Wave 2, width 1: the SKILL.md section (Task 3) `Consumes:` both scripts' `Produces:` and
needs their runtime behaviour — its exam runs each script's `--help` and checks every flag the
section advertises against it, which a shape could not settle. No two tasks name one file.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh skills/ultrapowers/scripts/compile_plan.py
- Check: git diff --quiet $ULTRA_BASE -- fleet/
- Check: git diff --quiet $ULTRA_BASE -- skills/ultralearn/scripts/harvest_fleet_runs.py skills/ultralearn/scripts/merge_ledger.py skills/ultralearn/scripts/fleet_events.py skills/ultralearn/scripts/fleet_slice.py skills/ultralearn/scripts/census_many.py skills/ultralearn/scripts/_readers.py skills/ultralearn/scripts/_outcome.py
- The verification periphery is frozen (0.1.0): the first Check pins the three gate scripts and
  the compiler. The second pins the whole engine — this plan reads the record the engine writes and
  changes nothing about how it is written. The third pins every existing ultralearn script: the
  counter is additive.
- The counter and the report are read-only over the record: no model call, no network, no git
  write, no `anthropic` SDK and no `ANTHROPIC_API_KEY`. The one file either writes is the ledger
  named by `--ledger`, and only by appending.
- Paths in a row are repository-relative exactly as the record spells them (`fleet/tests/x.mjs`,
  `tests/x.py`); nothing normalises, resolves or globs them.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The counter derives a run's catches from its record

**Type:** implementation
**Review:** peer

**Files:**
- Create: `skills/ultralearn/scripts/catch_counter.py`
- Test: `tests/test_ultralearn_catches.py`

**Claim:** A catch is a red the fix round then turned green by editing implementation files, never the test and never by re-run alone (quoted from #778)
Machine: M1. For each of `driver:exam-run`, `driver:proof-run` and `driver:check-run`: in a run directory whose `events.jsonl`, read in `id` order, carries for task `K` an event of that kind with `exit` ≠ 0 whose `cmd` names test path `T`, then a `worker:end` whose `label` begins `fix:K:`, then an event of the same kind for `K` with the same `cmd` and `exit` 0, where the `report.json` row with `task` `K` has an `examEdited` that does not name `T` and the `receipt.json` `compile.tasks[]` entry with `id` `K` has a `writes` that does not name `T`, `derive_catches(run_dir)` returns a row whose `catches[T]` is `1` and whose `reds` carries an entry with `task` `K`, `path` `T` and `outcome` `caught`.
M2. When that report row's `examEdited` names `T`, `catches` has no key `T` and the `reds` entry's `outcome` is `exam-edited`.
M3. When `T` is in that task's `writes`, `catches` has no key `T` and the `outcome` is `task-writes`.
M4. When no `worker:end` whose `label` begins `fix:K:` lies between the red event and the green one, `catches` has no key `T` and the `outcome` is `rerun`.
M5. When the next same-kind same-`cmd` event for `K` after the red has `exit` ≠ 0 the `outcome` is `stayed-red`, and when there is no later same-kind same-`cmd` event for `K` it is `no-green`; neither adds a key to `catches`.
M6. One credit per path per fix round: two red events of different kinds for `K` that both name `T` before one `fix:K:0` `worker:end`, each followed by its own green, leave `catches[T]` at `1`.
M7. The row is exactly the keys `kind`, `runId`, `driverRuns`, `catches`, `reds`, `touched`, `exercises`: `kind` is `catch-count`, `runId` is the `run:open` event's `runId`, `driverRuns` counts the events of the three kinds, `touched` is the sorted union of every `writes` list in the receipt, and `exercises[T]` is the sorted union of the `writes` of every task one of whose events of the three kinds names `T` in its `cmd`, whether that event was red or green.
M8. A test path is a token of `cmd` matched by the regular expression `(?<![\w./-])((?:[\w.-]+/)*test[\w.-]*\.(?:py|mjs|js|ts))(?![\w.-])`, in order of appearance; a red whose `cmd` matches none adds nothing to `reds` and nothing to `catches`.
M9. `append_rows(rows, ledger_path)` appends one JSON line per row whose `id` — the first 16 hexadecimal digits of the SHA-256 of the UTF-8 bytes of `runId + "\n" + "catch-count"`, written into the row — the ledger does not already carry, creates the ledger's parent directories when absent, and returns `{"added": n, "skipped": m}`; a second call with the same rows returns `added` 0 and leaves the file's bytes unchanged.
M10. `python3 skills/ultralearn/scripts/catch_counter.py <path>… --ledger <file>` derives one row for every directory holding an `events.jsonl` under the paths — a bare run directory as well as a tree holding several — appends them, prints one line `<n> run(s) counted, <a> row(s) appended, <s> already recorded` on stdout and exits 0; a path under which no such directory exists prints one line beginning `LOOKED-EMPTY:` on stderr and the process still exits 0; a run directory with an `events.jsonl` but no `report.json` and no `receipt.json` yields a row with empty `catches`, `touched` and `exercises`, and no traceback.

**Authorized-by:** #778; map #766 decisions 2 and 5 (grilling #767)

**Interfaces:**
- Consumes: nothing
- Produces: `derive_catches(run_dir: Path) -> dict`
- Produces: `append_rows(rows: list[dict], ledger_path: Path) -> dict`
- Produces: `test_paths_of(cmd: str) -> list[str]`

**Context:** The record, as the engine writes it at BASE (`fleet/run-engine.mjs`,
`fleet/run-waves.mjs`; the harvester pulls exactly these files, `EVIDENCE_FILES` in
`harvest_fleet_runs.py`). `events.jsonl` is one JSON object per line; read it with
`fleet_events.read_events(run_dir)` (sibling module; returns the dicts sorted by `id`, skips a
malformed line, never raises) — the `id` is a ULID and is the order, `ts` is not. The three
driver-run kinds are `{"kind": "driver:exam-run", "task": "2", "cmd": "node
fleet/tests/test_janitor.mjs", "exit": 1, "iter": 0, "id": …, "ts": …}`, `driver:proof-run` with
the same fields, and `driver:check-run` with those fields plus `minor`. **`iter` does not
distinguish the pass before a fix round from the pass after it** — on run-44 the exam ran red at
`iter: 0`, the fix round `fix:2:0` ended, and the exam ran green at `iter: 0` again — so the order
in the log is the only sequence, and a fix round is the event `{"kind": "worker:end", "label":
"fix:2:0", "role": "implementer", …}` (a review-driven round is `fix:2:1`; match the prefix
`fix:<task>:`). `task` is a string in every event; `run:open` carries `runId` (`"run-44"`).
`report.json` is one object; `tasks[]` rows carry `task` (string), `proofFixes`, `fixIterations`,
and `examEdited` — a list of the exam paths whose blob moved since the examiner wrote them,
**present only when an exam was recorded**; treat an absent `examEdited` as `[]`. `receipt.json` is
one object; `compile.tasks[]` entries carry `id` (string) and `writes` (the task's Create +
Modify paths, e.g. `["fleet/RUNBOOK.md", "fleet/janitor.mjs",
"fleet/tests/test_janitor_reap_only.mjs"]` — a test file can be a write). A run directory may lack
either JSON file; read them with the advisory contract of every sibling script: a missing or
unreadable file is an empty record, an `except` handler raises or calls `swallow("<literal>")` from
`_outcome`, and the looked-empty line is `_outcome.report_looked_empty(msg)`. The `catch-count` row
this task writes and Task 2 reads, one literal shared by both Contexts:
`{"kind": "catch-count", "id": "<16 hex>", "runId": "run-44", "driverRuns": 27, "catches":
{"fleet/tests/test_janitor.mjs": 1}, "reds": [{"task": "2", "kind": "driver:exam-run", "path":
"fleet/tests/test_janitor.mjs", "cmd": "node fleet/tests/test_janitor.mjs", "outcome": "caught"}],
"touched": ["fleet/CONTRACT.md", "fleet/RUNBOOK.md", "fleet/janitor.mjs", "fleet/retire.mjs",
"fleet/tests/test_janitor_reap_only.mjs"], "exercises": {"fleet/tests/test_janitor.mjs":
["fleet/RUNBOOK.md", "fleet/janitor.mjs", "fleet/tests/test_janitor_reap_only.mjs"]}}` — `outcome`
is one of `caught`, `exam-edited`, `task-writes`, `rerun`, `stayed-red`, `no-green`. The rule was
run by hand over the 68 evidence tags at BASE before this plan was written: 66 carry driver-run
events; 20 red-then-green pairs, of which 17 credit (3 were the same path under two kinds before
one fix round, run-8), 1 stayed red (run-32 task 3) and 1 had no later run; no `exam-edited`,
`task-writes` or `rerun` outcome occurred in the record yet — those legs are the rule, not the
history. The ledger's other lines are findings rows (`runId`, `lens`, `title`, `id`, …); the
counter appends beside them and never rewrites a line. Every path a row carries is the string the
record spelled, unchanged.
**BASE facts:** (generated at fe0541e)
- `id` at `fleet/run-waves.mjs:106` blob 27f25b5
- `cmd` at `fleet/confine-hook.mjs:295` blob cb77dc8
- `T` at `fleet/tests/test_sandbox_boot.mjs:806` blob c5a6b7a
- `label` at `fleet/run-engine.mjs:638` blob 95be538
- `task` at `fleet/run-engine.mjs:2207` blob 95be538
- `examEdited` at `fleet/run-engine.mjs:1269` blob 95be538
- `reds` at `fleet/run-engine.mjs:1564` blob 95be538
- `kind` at `fleet/lobby.mjs:418` blob 62d348b
- `runId` at `fleet/tests/test_run_main.mjs:382` blob 676df10
- `touched` at `fleet/tests/probe_disallowed_vs_bypass.mjs:65` blob daf5c67
- `added` at `fleet/tests/test_claude_token.mjs:612` blob 15a4988
- `fleet/run-engine.mjs` blob 95be538
- `fleet/run-waves.mjs` blob 27f25b5
- `ts` at `fleet/run-engine.mjs:763` blob 95be538
- `proofFixes` at `fleet/run-engine.mjs:1387` blob 95be538
- `skills/ultralearn/scripts/fleet_events.py` blob 0a4b0a2

**Proof:**
- Test: `tests/test_ultralearn_catches.py`
- Guard: `tests/test_ultralearn_catches.py`
- Run: `python3 -m pytest -q tests/test_ultralearn_catches.py tests/test_ultralearn_swallows.py`
- Legs: (a) a fixture run directory whose events are `run:open`, a `driver:exam-run` for task `1` with `exit` 1 naming `fleet/tests/test_thing.mjs`, a `worker:end` labelled `fix:1:0`, then the same `driver:exam-run` with `exit` 0, whose `report.json` row for task `1` has `examEdited: []` and whose `receipt.json` gives task `1` `writes: ["fleet/thing.mjs"]`, yields `catches` exactly `{"fleet/tests/test_thing.mjs": 1}` — one key, value 1, no other key — and exactly one `reds` entry, with `task` `"1"`, `path` `fleet/tests/test_thing.mjs`, `outcome` `caught` [M1]; (b) the same fixture with the two events as `driver:proof-run` yields the same credit [M1]; (c) the same fixture with the two events as `driver:check-run` (with `minor: false`) yields the same credit [M1]; (d) the fixture of (a) with `examEdited: ["fleet/tests/test_thing.mjs"]` yields `catches` exactly `{}` — the key `fleet/tests/test_thing.mjs` is absent — and the one `reds` entry's `outcome` is `exam-edited`, not `caught` [M2]; (e) the fixture of (a) with `writes: ["fleet/thing.mjs", "fleet/tests/test_thing.mjs"]` yields `catches` exactly `{}` — the key is absent — and the one `reds` entry's `outcome` is `task-writes`, not `caught` [M3]; (f) the fixture of (a) with the `fix:1:0` `worker:end` removed yields `catches` exactly `{}` — the key is absent — and the one `reds` entry's `outcome` is `rerun`, not `caught` [M4]; (g) the fixture of (a) with the green event's `exit` set to 1 yields `outcome` `stayed-red`, and with the green event removed yields `outcome` `no-green`, and in both `catches` is exactly `{}` with the key absent [M5]; (h) a fixture with a red `driver:proof-run` and a red `driver:check-run` for task `1`, both with `cmd` `node fleet/tests/test_thing.mjs`, then one `fix:1:0` `worker:end`, then both green, yields `catches` exactly `{"fleet/tests/test_thing.mjs": 1}` — the value is 1, not 2, and `reds` has exactly two entries [M6]; (i) the row of (a) has exactly the keys `kind`, `runId`, `driverRuns`, `catches`, `reds`, `touched`, `exercises`, `kind` `catch-count`, `runId` the `run:open` event's, `driverRuns` 2, and, with a second task `2` whose only event is a green `driver:proof-run` naming `tests/test_other.py` and whose `writes` are `["lib/other.py"]`, `touched == ["fleet/thing.mjs", "lib/other.py"]` and `exercises == {"fleet/tests/test_thing.mjs": ["fleet/thing.mjs"], "tests/test_other.py": ["lib/other.py"]}` [M7]; (j) `test_paths_of("node fleet/tests/test_x.mjs | grep -q 'ALL TESTS PASSED'")` is `["fleet/tests/test_x.mjs"]`, `test_paths_of("python3 -m pytest -q tests/test_a.py tests/test_b.py")` is `["tests/test_a.py", "tests/test_b.py"]`, `test_paths_of("git diff --quiet $ULTRA_BASE -- fleet/x.mjs")` is `[]`, and a fixture whose only red is that last command yields `reds == []` and `catches == {}` [M8]; (k) `append_rows` on two rows against a ledger path whose parent directory does not yet exist writes two lines each carrying `id` equal to the first 16 hex digits of `hashlib.sha256((runId + "\n" + "catch-count").encode()).hexdigest()` and returns `{"added": 2, "skipped": 0}`, and a second call with the same rows returns `{"added": 0, "skipped": 2}` with the file's bytes unchanged; a ledger pre-seeded with one findings line keeps that line byte-for-byte as its first line [M9]; (l) the CLI on a tree holding two run directories with `--ledger` prints `2 run(s) counted, 2 row(s) appended, 0 already recorded`, exits 0, and a second invocation prints `2 run(s) counted, 0 row(s) appended, 2 already recorded` [M10]; (m) the CLI on an empty directory prints a line starting `LOOKED-EMPTY:` on stderr and exits 0 [M10]; (n) the CLI on a run directory holding only an `events.jsonl` (no `report.json`, no `receipt.json`) exits 0 and its appended row has `catches == {}`, `touched == []` and `exercises == {}` [M10].

**Stale-if:**
- path-exists: `skills/ultralearn/scripts/catch_counter.py`
- path-absent: `skills/ultralearn/scripts/fleet_events.py`
- issue-closed: #778

### Task 2: The report emits the table, the curve and the deletion input

**Type:** implementation
**Review:** peer

**Files:**
- Create: `skills/ultralearn/scripts/catch_report.py`
- Test: `tests/test_ultralearn_catch_report.py`

**Claim:** emits the list of test files at zero catches over N runs that touched the paths those tests exercise (quoted from #778)
Machine: M1. `catch_table(rows, tree_tests)` returns a dict keyed by test path over the union of `tree_tests` and every path that is a key of any row's `catches` or `exercises`; for each path, `catches` is the sum of that row key over the rows, `exercised` is the sorted union of that path's `exercises` lists over the rows, `touchingRuns` is the number of rows whose `touched` shares at least one path with `exercised`, and `status` is `caught` when `catches` > 0, `unobserved` when `exercised` is empty, and `zero` otherwise.
M2. A row whose `kind` is not `catch-count` contributes nothing to `catch_table`.
M3. `zero_curve(table)` returns `[{"n": N, "files": c}, …]` for every N from 1 to the largest `touchingRuns` in the table, `c` the number of entries with `catches` 0 and `touchingRuns` ≥ N; it returns `[]` when the largest is 0.
M4. `tree_test_files(tree)` returns the sorted paths relative to `tree` that match `tests/test_*.py` or `fleet/tests/test_*.mjs` under it.
M5. `python3 skills/ultralearn/scripts/catch_report.py --ledger <file> [--tree <dir>] [--n N]` prints, in order: a Markdown table whose header row is `| test | catches | touching runs | status |` with one row per table entry sorted by path; a `## Zero-catch curve` section with one `N=<n>: <c> file(s)` line per curve entry followed by one `max touching runs: <max>` line; and, only when `--n` is given, a `## Zero catches over <N> runs` section listing exactly the entries with `catches` 0 and `touchingRuns` ≥ N, one path per line, sorted — then exits 0; `--tree` defaults to the current directory.
M6. With a `--ledger` path that does not exist, the CLI prints the table of the tree's tests each with `catches` 0 and status `unobserved`, the curve section with no `N=` line and `max touching runs: 0`, and exits 0.

**Authorized-by:** #778; map #766 decisions 2 and 5 (grilling #767)

**Interfaces:**
- Consumes: nothing
- Produces: `catch_table(rows: list[dict], tree_tests: list[str]) -> dict`
- Produces: `zero_curve(table: dict) -> list[dict]`
- Produces: `tree_test_files(tree: Path) -> list[str]`

**Context:** The report reads the ledger's `catch-count` rows — the shape Task 1 writes, one
literal shared by both Contexts: `{"kind": "catch-count", "id": "<16 hex>", "runId": "run-44",
"driverRuns": 27, "catches": {"fleet/tests/test_janitor.mjs": 1}, "reds": [{"task": "2", "kind":
"driver:exam-run", "path": "fleet/tests/test_janitor.mjs", "cmd": "node
fleet/tests/test_janitor.mjs", "outcome": "caught"}], "touched": ["fleet/CONTRACT.md",
"fleet/RUNBOOK.md", "fleet/janitor.mjs", "fleet/retire.mjs",
"fleet/tests/test_janitor_reap_only.mjs"], "exercises": {"fleet/tests/test_janitor.mjs":
["fleet/RUNBOOK.md", "fleet/janitor.mjs", "fleet/tests/test_janitor_reap_only.mjs"]}}`. The same
file holds the findings rows `merge_ledger.py` writes (`{"runId": …, "lens": "friction", "title":
…, "id": …, …}`, no `kind`) — read every line as `merge_ledger._read_jsonl` does (skip blank and
malformed lines, never raise) and keep only `kind == "catch-count"`. A test's exercised set is the
union across rows on purpose: what run A taught about test T decides whether run B touched T. A
`touchingRuns` of 0 with a non-empty `exercised` is a real `zero` at N=0 and appears in no `N≥1`
count; a path the tree holds that no row ever named is `unobserved` and is never a deletion
candidate — the record has not seen it. `--n` is the operator's choice after reading the curve;
the tool never picks it (the issue: N is measured on the first pass, not fixed in doctrine). The
two globs are this repository's suites (`pytest.ini` collects `tests/`; `tests/test_fleet_suite.py`
bridges `fleet/tests/test_*.mjs`); a foreign tree can pass `--tree` and get its own two globs, no
more. Measured at BASE by hand (68 tags, the rule of Task 1): 214 table entries — 187 in the tree,
27 named only by the record (renamed or deleted since) — 163 observed, largest `touchingRuns` 65,
and the curve began `N=1: 147`, `N=2: 136`, `N=3: 131`, `N=4: 124`, `N=5: 114` and reached 0 at
N=48; so a real report is long, and the table is one line per test with no elision. Output is
plain `print`; nothing is coloured or paginated. Every `except` handler raises or calls
`swallow("<literal>")` from `_outcome` (the suite's glob audits this script too).
**BASE facts:** (generated at fe0541e)
- `touched` at `fleet/tests/probe_disallowed_vs_bypass.mjs:65` blob daf5c67
- `status` at `fleet/claude-token.mjs:358` blob b7e8e7b
- `zero` at `fleet/tests/test_run_engine_pre_review.mjs:320` blob db5604e
- `kind` at `fleet/lobby.mjs:418` blob 62d348b
- `c` at `fleet/confine-hook.mjs:154` blob cb77dc8
- `tree` at `fleet/launch.mjs:367` blob 8cc2fc3
- `pytest.ini` blob 251eb61
- `tests/test_fleet_suite.py` blob 8a2b0c6
- `skills/ultralearn/scripts/merge_ledger.py` blob b3c4ae5

**Proof:**
- Test: `tests/test_ultralearn_catch_report.py`
- Guard: `tests/test_ultralearn_catch_report.py`
- Run: `python3 -m pytest -q tests/test_ultralearn_catch_report.py tests/test_ultralearn_swallows.py`
- Legs: (a) three `catch-count` rows — run A `catches {"tests/test_a.py": 1}`, `touched ["lib/a.py"]`, `exercises {"tests/test_a.py": ["lib/a.py"], "tests/test_b.py": ["lib/b.py"]}`; run B `catches {}`, `touched ["lib/b.py"]`, `exercises {"tests/test_b.py": ["lib/b.py"]}`; run C `catches {}`, `touched ["lib/c.py"]`, `exercises {}` — with `tree_tests ["tests/test_a.py", "tests/test_b.py", "tests/test_d.py"]` give `tests/test_a.py` `catches` exactly 1, `touchingRuns` exactly 1, `status` `caught` [M1]; (b) the same rows give `tests/test_b.py` `catches` exactly 0, `exercised` exactly `["lib/b.py"]`, `touchingRuns` exactly 1 (run A's `touched` misses `lib/b.py`, run B's hits it, run C's misses it), `status` `zero`, not `caught` [M1]; (c) the same rows give `tests/test_d.py` `catches` 0, `exercised` exactly `[]`, `touchingRuns` 0, `status` `unobserved`, not `zero`, and the table has exactly the three keys `tests/test_a.py`, `tests/test_b.py`, `tests/test_d.py` — `lib/b.py` is absent [M1]; (d) adding a findings row `{"runId": "run-9", "lens": "friction", "title": "t", "touched": ["lib/b.py"]}` to the rows of (a) changes no entry — the table is equal to that of (a) [M2]; (e) `zero_curve` on a table with entries `{catches 0, touchingRuns 3}`, `{catches 0, touchingRuns 1}`, `{catches 2, touchingRuns 3}`, `{catches 0, touchingRuns 0}` returns exactly `[{"n": 1, "files": 2}, {"n": 2, "files": 1}, {"n": 3, "files": 1}]` — three entries, no `n` of 4 [M3]; (f) `zero_curve` on a table whose every `touchingRuns` is 0 returns exactly `[]` [M3]; (g) under a temporary tree holding `tests/test_x.py`, `tests/helper.py`, `fleet/tests/test_y.mjs`, `fleet/tests/_helpers.mjs` and `other/test_z.py`, `tree_test_files(tree)` is exactly `["fleet/tests/test_y.mjs", "tests/test_x.py"]` — the helper, the underscore file and `other/test_z.py` are absent [M4]; (h) the CLI with a ledger holding the rows of (a) and `--tree` that temporary tree, without `--n`, prints a header line `| test | catches | touching runs | status |`, one table row per entry, a `## Zero-catch curve` line followed by `N=1: 1 file(s)` and `max touching runs: 1`, no line starting `## Zero catches over`, and exits 0 [M5]; (i) the same invocation with `--n 1` additionally prints `## Zero catches over 1 runs` followed by exactly the line `tests/test_b.py` before end of output, and with `--n 2` prints that heading followed by no path [M5]; (j) the CLI with `--ledger` naming a path that does not exist and `--tree` the temporary tree prints a table row for each of the two tree tests with `0` catches and `unobserved`, no `N=` line, `max touching runs: 0`, and exits 0 [M6].

**Stale-if:**
- path-exists: `skills/ultralearn/scripts/catch_report.py`
- path-absent: `skills/ultralearn/scripts/merge_ledger.py`
- issue-closed: #778

### Task 3: The skill says how a catch is counted and that N is read off the curve

**Type:** implementation

**Files:**
- Modify: `skills/ultralearn/SKILL.md`
- Test: `tests/test_ultralearn_docs.py`

**Claim:** An operator reading `skills/ultralearn/SKILL.md` finds one section that names the two catch scripts, the rule that credits a test only when a fix to implementation turned its red green, and that the deletion window N is read off the report's curve rather than fixed. (derived)
Machine: M1. `skills/ultralearn/SKILL.md` carries a heading line `## The catch counter` whose line number is greater than that of the `## Verb 1` heading and less than that of the `## Verb 2` heading.
M2. The text from that heading to the `## Verb 2` heading names `catch_counter.py`, `catch_report.py`, `catch-count` and `docs/superpowers/observations/ledger.jsonl`.
M3. That text contains `never the test` before `re-run alone`, spells `examEdited` as a code token (a non-space character on each side of the word), and spells `writes` as a code token immediately followed by ` in the receipt` — the two record fields the rule reads, not the verb.
M4. That text names `--n`, contains the word `curve`, and contains `not fixed`.
M5. Every token matching `--[a-z][a-z-]*` in that text is a flag printed by `python3 skills/ultralearn/scripts/catch_counter.py --help` or by `python3 skills/ultralearn/scripts/catch_report.py --help`.
M6. `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn` exits 0.

**Authorized-by:** #778; map #766 decisions 2 and 5 (grilling #767)

**Interfaces:**
- Consumes: `derive_catches(run_dir: Path) -> dict`
- Consumes: `catch_table(rows: list[dict], tree_tests: list[str]) -> dict`
- Produces: nothing

**Context:** `skills/ultralearn/SKILL.md` at BASE has `## Verb 1 — ultralearn (sense)` with three
numbered steps (Harvest, Read, Merge) and a **Historical corpus** paragraph, then `## Verb 2 —
ultralearn distill (propose)`, then `## Privacy`. The new section sits between the Historical
corpus paragraph and Verb 2. What it says, in the operator's terms, is the rule this plan built: a
catch is a red the fix round then turned green by editing implementation files, never the test and
never by re-run alone; the counter reads it off the record — the driver's `driver:exam-run` /
`driver:proof-run` / `driver:check-run` events around a `fix:<task>:<n>` round, the task row's
`examEdited` and the task's `writes` in the receipt — and appends one `catch-count` row per run to
`docs/superpowers/observations/ledger.jsonl` (the same file the findings land in; override with
`--ledger`). The report prints every test in the tree with its count, the zero-catch curve for
every N the record can support, and — only with `--n` — the list of tests at zero over N touching
runs, which is the input to a deletion plan that goes through the gate like any work; N is measured
on the first pass, not fixed in doctrine. The two command lines are
`python3 skills/ultralearn/scripts/catch_counter.py <run dir or tree>… --ledger <file>` and
`python3 skills/ultralearn/scripts/catch_report.py --ledger <file> [--tree <dir>] [--n N]`; the
counter's `--ledger` and the report's `--ledger`, `--tree`, `--n` are the only flags either has,
and both scripts exist in this task's tree because this task follows Tasks 1 and 2. The exam file
already exists (`tests/test_ultralearn_docs.py` pins the harvester's flags against its `--help`);
this task's legs extend it under a comment naming the task, in the same style — `subprocess.run`
of the script with `--help`, `re.findall` over the section's text. `validate_skill.py` checks
the skill's frontmatter and description, which this section does not touch. A `Run:` here carries
no backtick; the section is addressed with `sed -n '/^## The catch counter/,/^## Verb 2/p'`.
**BASE facts:** (generated at fe0541e)
- `skills/ultralearn/SKILL.md` blob 9232914
- `examEdited` at `fleet/run-engine.mjs:1269` blob 95be538
- `tests/test_ultralearn_docs.py` blob 204c1db

**Proof:**
- Test: `tests/test_ultralearn_docs.py`
- Guard: `tests/test_ultralearn_docs.py`
- Run: `test "$(grep -n '^## Verb 1' skills/ultralearn/SKILL.md | cut -d: -f1)" -lt "$(grep -n '^## The catch counter' skills/ultralearn/SKILL.md | cut -d: -f1)"`
- Run: `test "$(grep -n '^## The catch counter' skills/ultralearn/SKILL.md | cut -d: -f1)" -lt "$(grep -n '^## Verb 2' skills/ultralearn/SKILL.md | cut -d: -f1)"`
- Run: `sed -n '/^## The catch counter/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -q 'catch_counter.py'`
- Run: `sed -n '/^## The catch counter/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -q 'catch_report.py'`
- Run: `sed -n '/^## The catch counter/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -q 'catch-count'`
- Run: `sed -n '/^## The catch counter/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -q 'docs/superpowers/observations/ledger.jsonl'`
- Run: `sed -n '/^## The catch counter/,/^## Verb 2/p' skills/ultralearn/SKILL.md | tr '\n' ' ' | grep -q 'never the test.*re-run alone'`
- Run: `sed -n '/^## The catch counter/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -q '[^ ]examEdited[^ ]'`
- Run: `sed -n '/^## The catch counter/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -q '[^ ]writes[^ ] in the receipt'`
- Run: `sed -n '/^## The catch counter/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -q -- '--n'`
- Run: `sed -n '/^## The catch counter/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -q 'curve'`
- Run: `sed -n '/^## The catch counter/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -q 'not fixed'`
- Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn`
- Run: `python3 -m pytest -q tests/test_ultralearn_docs.py`
- Legs: (a) the first two `Run:` lines exit 0 — the heading exists once, after `## Verb 1` and before `## Verb 2` — and the test asserts the same three line numbers are strictly increasing [M1]; (b) the next four `Run:` lines each exit 0, one per name — `catch_counter.py`, `catch_report.py`, `catch-count`, `docs/superpowers/observations/ledger.jsonl` — and the test asserts each of the four is a substring of the section's text [M2]; (c) the `tr | grep` `Run:` finds `never the test` before `re-run alone` inside the section, and the two bracket-class `grep -q` lines after it find `examEdited` with a non-space character on each side and `writes` with a non-space character on each side immediately followed by ` in the receipt` — a bare verb `writes` preceded by a space does not match, and the test asserts the same two regular expressions over the section's text and asserts that the string `the counter writes the ledger` matches neither [M3]; (d) the three `Run:` lines for `--n`, `curve` and `not fixed` each exit 0 within the section [M4]; (e) the test collects every `--[a-z][a-z-]*` token from the section and asserts each one appears in the `--help` output of `catch_counter.py` or of `catch_report.py`, and asserts that a token `--nope` would not — by checking the union of the two help texts does not contain it [M5]; (f) the `validate_skill.py` `Run:` exits 0 [M6].

**Stale-if:**
- path-absent: `skills/ultralearn/SKILL.md`
- path-absent: `tests/test_ultralearn_docs.py`
- issue-closed: #778
