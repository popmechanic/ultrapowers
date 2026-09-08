# ultralearn: a many-run census, a ledger that refuses a guessed version, and a harvest step that names what exists

**Grammar:** claims-v1

**Claim:** `census.py` (or a sibling `census_many.py`) takes many run directories (`run-*/` holding `events.jsonl` + `report.json` + `status.json`, plus an optional era/engine label per run or read off the report's `engineVersion`) and emits one row per run — era, engine sha/version, tasks, width (max concurrent workers), phase walls (start/setup/wave/fold/critic/gate/publish), minutes and $ by role, longest chain, fix rounds, terminus, launch→PR→merged when the status carries them — as CSV and Markdown, so a later sitting appends rows instead of writing a new census document. Runs without `events.jsonl` (pre-24) are rows with the receipt-level columns filled and the rest blank, never skipped. The existing single-run output stays. (quoted from #695)

**Goal:** #695, #696 and #697 — three ultralearn tickets on disjoint files, one run. The
laptop's `docs/superpowers/observations/census.py` reads ONE `events.jsonl`; it is untracked
(the whole of `docs/superpowers/` is in `.git/info/exclude` since #544) and absent from every
sandbox, so #695's deliverable is a TRACKED sibling, `skills/ultralearn/scripts/census_many.py`,
with a tracked fixture of three synthetic run directories for its exam; the laptop script is
untouched. #696's sandbox-doable half is the tracked `skills/ultralearn/scripts/merge_ledger.py`:
the merge refuses a row whose engine version is not a released version, and the stamp it writes
is never a date-basis guess (a bundle whose `engineVersion.basis` is `home-repo-date` or
`foreign-date-upper-bound` stamps nothing). **Out of scope of this run, by construction:** the
one-time rewrite of the laptop's `docs/superpowers/observations/ledger.jsonl` (2,384 rows on
2026-09-08; 219 carry `engineEpoch`, 2,165 carry `engineVersion`) — that file is on no sandbox,
so the operator runs that pass on the laptop after this PR merges, with the refusal rule as its
lens. #697 is prose: §Verb 1 step 1 of `skills/ultralearn/SKILL.md` names only what exists.
**Closes:** #697 #695 #696

**Tech Stack:** Python 3 standard library only under `skills/ultralearn/scripts/` (no third-party
import, no network, no `anthropic`); the suite is `python3 -m pytest` from the repo root
(`pytest.ini` scopes it to `tests/`); `tests/test_ultralearn_swallows.py` globs every `*.py` under
`skills/ultralearn/scripts/` and refuses an `except` handler that neither raises nor calls
`swallow("<literal reason>")` from `_outcome.py`.

**Parallelization rationale:** one wave, width 3. Task 1 creates `census_many.py` and its fixture
and consumes only `fleet_events.read_events`, which exists at BASE; Task 2 edits
`merge_ledger.py`, `_readers.py`, the one re-scoped pin in `tests/test_merge_ledger.py`, and step 3
of `skills/ultralearn/SKILL.md`; Task 3 edits step 1 of the same `SKILL.md` and adds one paragraph
after step 3 — two regions of one file, which fold as text. No task consumes a symbol another
produces; the two `SKILL.md` regions are named in both Contexts so neither writes the other's
literals.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- The verification periphery is frozen (0.1.0); the Check above is its pin.
- No script under `skills/ultralearn/scripts/` imports a third-party package, reads the network,
  or calls an LLM; every `except` handler in a new or edited script raises or calls
  `swallow("<non-empty literal>")` — `tests/test_ultralearn_swallows.py` is the lens and it
  enumerates the directory by glob.
- The harvester's bundle keeps its BASE key set (`tests/test_harvest_evidence.py` pins it): no
  task adds or removes a `bundle.json` key.
- Every file the exams read is tracked; no exam reads `docs/superpowers/`, `~/.claude/`, or
  `.claude/`, which are absent from the sandbox.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: One row per run, across many run directories

**Type:** implementation
**Review:** peer

**Files:**
- Create: `skills/ultralearn/scripts/census_many.py`
- Create: `tests/fixtures/ultralearn/census/run-101/events.jsonl`
- Create: `tests/fixtures/ultralearn/census/run-101/report.json`
- Create: `tests/fixtures/ultralearn/census/run-101/status.json`
- Create: `tests/fixtures/ultralearn/census/run-102/events.jsonl`
- Create: `tests/fixtures/ultralearn/census/run-102/report.json`
- Create: `tests/fixtures/ultralearn/census/run-102/status.json`
- Create: `tests/fixtures/ultralearn/census/run-103/report.json`
- Create: `tests/fixtures/ultralearn/census/run-103/status.json`
- Test: `tests/test_census_many.py`

**Claim:** An operator points one command at many run directories and sees one table — CSV or Markdown, one row per run in run order — and a run that has no event log still gets its row, with what its receipt and status say filled in and the rest blank. (derived)
Machine: M1. `python3 skills/ultralearn/scripts/census_many.py <path>...` treats each path as a
run directory or a tree containing them — a run directory is a directory holding at least one
of `events.jsonl`, `report.json`, `status.json` — and emits exactly one row per run directory
found, ordered by the integer in the `run` column's `run-<N>` ascending regardless of argv
order, under exactly these 31 columns in this order: `run`, `era`, `engine`, `terminus`,
`tasks`, `width`, `minutes_total`, `cost_usd`, `start`, `setup_min`, `wave_min`, `fold_min`,
`critic_min`, `gate_min`, `publish_min`, `min_examiner`, `usd_examiner`, `min_implementer`,
`usd_implementer`, `min_reviewer`, `usd_reviewer`, `min_critic`, `usd_critic`, `min_resolver`,
`usd_resolver`, `longest_chain_min`, `fix_rounds`, `launched_at`, `pr`, `merged`, `status_min`.
M2. For a run directory holding `events.jsonl`, the row is computed from the log by the rules in
Context; on the fixture `tests/fixtures/ultralearn/census/run-101` the row is exactly the
run-101 row pinned in Context (`width` `1`, `minutes_total` `8.0`, `cost_usd` `2.50`,
`setup_min` `1.0`, `wave_min` `7.0`, `fold_min` `1.0`, `critic_min` `1.0`, `gate_min` `2.0`,
`publish_min` `3.0`, `longest_chain_min` `7.0`, `fix_rounds` `0`, `status_min` `20.0`), and on
`run-102` exactly the run-102 row (`width` `2`, `tasks` `2`, `minutes_total` `9.0`, `cost_usd`
`5.00`, `min_implementer` `6.0`, `longest_chain_min` `5.0`, `fix_rounds` `1`, `fold_min` and
`publish_min` the empty string, `pr` and `merged` the empty string, `status_min` `15.0`).
M3. A run directory without `events.jsonl` yields a row — never omitted — whose `run` is the
directory name, `terminus`, `launched_at`, `pr`, `merged` and `status_min` come from
`status.json`, `tasks` is the length of `report.json`'s `tasks` list and `engine` its
`engineVersion` when that is a string, and every other column is the empty string; on the
fixture `run-103` the row is exactly the run-103 row pinned in Context.
M4. `--csv PATH` writes the table as CSV (header line then rows, written by Python's `csv`
module); `--md PATH` writes it as a Markdown pipe table (a header line, a `| --- |` separator
line, then rows); with neither flag the Markdown table is printed to stdout; and `--csv PATH
--append` on an existing non-empty CSV leaves that file's prior bytes intact as a prefix,
writes no second header line, and appends one row per run.
M5. `--label RUN=TEXT`, repeatable, fills `era` with `TEXT` on the row whose `run` is `RUN` and
leaves `era` empty elsewhere; `engine` is `report.json`'s `engineVersion` when that key holds a
string and the empty string otherwise.

**Authorized-by:** #695 (enhancement, experience-compiler)

**Interfaces:**
- Consumes: `read_events(run_dir) -> list[dict]` (from `skills/ultralearn/scripts/fleet_events.py`, at BASE)
- Produces: `census_rows(paths: list[str], labels: dict[str, str]) -> list[dict]`

**Context:** The laptop's single-run `docs/superpowers/observations/census.py` is untracked and
not on any sandbox — this task creates a tracked sibling and does not touch it. What a real run
directory holds at BASE (read on 2026-09-08 from run-29's record): `report.json` keys are
`acceptance ancestryMisses baseSha baseline blockedWaves completenessFindings coverage
deferredVerification dependencyEdges frontier gitVerified integratedChecks integratedRuns
integrationBranch judgmentCalls missingDeliverables reviewEconomy shallowSuite tasks tests
unfinished waveMerges waves` — **no `engineVersion` key exists in any BASE report**, which is why
M5 reads it only when present; `status.json` is the contract's
`{"run","state","phase","pr","prAuthor","merged","branch","vm","startedAt","updatedAt","error"}`
(`pr` a URL or null, `merged` a 40-hex sha or null, `startedAt`/`updatedAt` ISO `Z` strings);
`events.jsonl` is one JSON object per line with `kind`, `id` (the sort key) and `ts` (ms epoch).
The event vocabulary the row reads, as the engine emits it: `run:open` (`runId`),
`engine:phase` (`phase`: `Setup`, `Wave 1`, `Wave 2`…, `Depth-1 Leg` on runs before #712,
`Integration Review`), `driver:stage` (`stage`: `tiers`, `provision`, `engine`, `engine-done`,
`finalize`, `acceptance-capture`, `gate`, `acks`, `approve`), `worker:start` / `worker:end`
(`label`, `role`, `sessionId`; the end carries `meter.costUsd`), `driver:approved`,
`driver:fail` (`verdict`), `driver:publish-fold`, `publish:pr`, `publish:merge`,
`publish:hold`. Worker labels across every cached bundle on 2026-09-08: prefixes `exam`,
`impl`, `fix`, `review`, `reconcile`, `resolve`, `setup`, `merge`, `integration`; roles
`examiner`, `implementer` (also the role of a `fix:` worker), `reviewer`, `critic`, `resolver`,
`writeSide`. A retry reuses its label, so pair each `worker:end` with the most recent unmatched
`worker:start` of the same label. Read the log through `fleet_events.read_events(run_dir)`
(id-sorted, malformed lines skipped) — never re-implement the parser.

The rules, one per column (minutes are `ms/60000` formatted `%.1f`; dollars `%.2f`; counts as
decimal integers; every value a string; a rule whose inputs are missing yields the empty
string): `run` = `runId` of the first `run:open`, else the directory name. `era` = the
`--label` text for that run, else empty. `engine` = M5. `terminus` = `status.json`'s `state`,
else empty. `tasks` = the number of distinct task ids among worker labels whose prefix is
`exam`, `impl`, `fix` or `review` (the id is the label's second colon-field); with no events,
`len(report.tasks)`. `width` = the maximum number of workers alive at once, sweeping starts and
ends by `ts` with an end at time t processed before a start at time t. `minutes_total` = the sum
of every paired worker's `end.ts - start.ts`; `cost_usd` = the sum of `meter.costUsd` over the
ends. `start` = the first event's `ts` as ISO UTC `%Y-%m-%dT%H:%M:%SZ`. `setup_min` = first
`Wave` phase ts − `Setup` phase ts. `wave_min` = `Integration Review` phase ts − first `Wave`
phase ts. `critic_min` = `engine-done` stage ts − `Integration Review` phase ts. `gate_min` =
terminal ts − `gate` stage ts, where the terminal event is the last `driver:approved` or
`driver:fail`. `fold_min` = last `driver:publish-fold` ts − terminal ts; `publish_min` = last
`publish:pr`/`publish:merge`/`publish:hold` ts − terminal ts. `min_<role>` / `usd_<role>` for
each of `examiner`, `implementer`, `reviewer`, `critic`, `resolver` = that role's summed
minutes and dollars, `0.0` / `0.00` when the run has events but no such worker. `longest_chain_min`
= the maximum over task ids of the summed durations of that task's `exam`/`impl`/`fix`/`review`
workers. `fix_rounds` = the count of `worker:start` labels beginning `fix:`. `launched_at` =
`status.startedAt`; `pr` = `status.pr` or empty; `merged` = `status.merged` or empty;
`status_min` = `updatedAt − startedAt` in minutes. CLI: positional paths (one or more), `--csv
PATH`, `--md PATH`, `--append`, `--label RUN=TEXT` (repeatable). Discovery walks each path with
`os.walk`; a directory with none of the three files is not a run and yields nothing (the fixture
root `tests/fixtures/ultralearn/census/` itself is such a directory). Expose the computation as
`census_rows(paths, labels)` returning the list of row dicts (keys = the 31 columns) so the exam
can call it as well as the CLI; keep `COLUMNS` as a module-level tuple. `tests/test_ultralearn_swallows.py`
audits this file: every `except` handler raises or calls `swallow("<reason>")` imported from
`_outcome` the way `merge_ledger.py` does.

**The fixture, verbatim** — `T0 = 1788130000000` (`2026-08-30T22:46:40Z`); each event's `id`
is `01AAA` + a three-digit counter in listed order, `ts` = `T0 + offset`; every `worker:end`
carries `exitCode 0`, `timedOut false`, `outcome "ok"`, `class "success"`, `status null` and
`meter {"input": 1, "output": 1, "cacheRead": 0, "cacheCreation": 0, "costUsd": <usd>, "models":
["claude-opus-5"]}`; every `worker:start` carries `cwd "/c/<label>"` and `model "opus"`.
`run-101/events.jsonl` (offset ms → event): 0 `run:open` runId `run-101` base `""` source
`fleet/run-main.mjs`; 0 `driver:stage` stage `provision`; 60000 `engine:phase` `Setup`; 120000
`engine:phase` `Wave 1`; 120000 start `exam:1` role `examiner` sessionId `s-101-1`; 180000 end
`exam:1` costUsd 0.25; 180000 start `impl:1` `implementer` `s-101-2`; 420000 end `impl:1`
costUsd 1.0; 420000 start `review:1:1:1` `reviewer` `s-101-3`; 540000 end `review:1:1:1`
costUsd 0.5; 540000 `engine:phase` `Integration Review`; 540000 start `integration` `critic`
`s-101-4`; 600000 end `integration` costUsd 0.75; 600000 `driver:stage` `engine-done`; 600000
`driver:stage` `gate`; 720000 `driver:approved` stamp `run-101`; 780000 `driver:publish-fold`
attempt 1 disposition `folded`; 840000 `publish:pr` url `https://github.com/o/r/pull/1`; 900000
`publish:merge` sha `a`×40. `run-101/report.json` =
`{"baseSha": "d"×40, "integrationBranch": "ultra/integration-run-101", "tasks": [{"task": "1"}], "tests": {"passed": true}}`.
`run-101/status.json` = `{"run": "101", "state": "done", "phase": "merged", "pr":
"https://github.com/o/r/pull/1", "prAuthor": "o", "merged": "a"×40, "branch":
"ultra/integration-run-101", "vm": "fleet-r101-x", "startedAt": "2026-08-30T22:40:00Z",
"updatedAt": "2026-08-30T23:00:00Z", "error": null}`.
`run-102/events.jsonl`: 0 `run:open` `run-102`; 0 `engine:phase` `Setup`; 60000 `engine:phase`
`Wave 1`; 60000 start `impl:1` `implementer` `s-102-1`; 60000 start `impl:2` `implementer`
`s-102-2`; 180000 end `impl:1` costUsd 1.0; 240000 end `impl:2` costUsd 1.5; 240000 start
`review:1:1:1` `reviewer` `s-102-3`; 300000 end `review:1:1:1` costUsd 0.5; 300000 start
`fix:1:1` `implementer` `s-102-4`; 360000 end `fix:1:1` costUsd 0.5; 360000 start
`review:1:2:1` `reviewer` `s-102-5`; 420000 end `review:1:2:1` costUsd 0.5; 420000
`engine:phase` `Integration Review`; 420000 start `integration` `critic` `s-102-6`; 480000 end
`integration` costUsd 1.0; 480000 `driver:stage` `engine-done`; 480000 `driver:stage` `gate`;
540000 `driver:fail` verdict `needs-ack` detail `deferred:manual`. `run-102/report.json` =
`{"baseSha": "d"×40, "integrationBranch": "ultra/integration-run-102", "tasks": [{"task": "1"}, {"task": "2"}], "tests": {"passed": false}}`;
`run-102/status.json` = `{"run": "102", "state": "parked", "phase": "needs-ack", "pr": null,
"prAuthor": null, "merged": null, "branch": "ultra/integration-run-102", "vm": "fleet-r102-x",
"startedAt": "2026-08-30T23:10:00Z", "updatedAt": "2026-08-30T23:25:00Z", "error": null}`.
`run-103/` has NO `events.jsonl`; `report.json` = `{"baseSha": "b"×40, "integrationBranch":
"ultra/integration-run-103", "engineVersion": "0.3.17", "tasks": [{"task": "1"}, {"task": "2"},
{"task": "3"}], "tests": {"passed": true}}`; `status.json` = `{"run": "103", "state": "done",
"phase": "merged", "pr": "https://github.com/o/r/pull/3", "prAuthor": "o", "merged": "c"×40,
"branch": "ultra/integration-run-103", "vm": "fleet-r103-x", "startedAt": "2026-08-30T23:30:00Z",
"updatedAt": "2026-08-30T23:42:00Z", "error": null}`.

**The three rows, verbatim** (column = value; an unlisted column is the empty string).
run-101: `run` `run-101`, `terminus` `done`, `tasks` `1`, `width` `1`, `minutes_total` `8.0`,
`cost_usd` `2.50`, `start` `2026-08-30T22:46:40Z`, `setup_min` `1.0`, `wave_min` `7.0`,
`fold_min` `1.0`, `critic_min` `1.0`, `gate_min` `2.0`, `publish_min` `3.0`, `min_examiner` `1.0`,
`usd_examiner` `0.25`, `min_implementer` `4.0`, `usd_implementer` `1.00`, `min_reviewer` `2.0`,
`usd_reviewer` `0.50`, `min_critic` `1.0`, `usd_critic` `0.75`, `min_resolver` `0.0`,
`usd_resolver` `0.00`, `longest_chain_min` `7.0`, `fix_rounds` `0`, `launched_at`
`2026-08-30T22:40:00Z`, `pr` `https://github.com/o/r/pull/1`, `merged` `a`×40, `status_min`
`20.0`. run-102: `run` `run-102`, `terminus` `parked`, `tasks` `2`, `width` `2`,
`minutes_total` `9.0`, `cost_usd` `5.00`, `start` `2026-08-30T22:46:40Z`, `setup_min` `1.0`,
`wave_min` `6.0`, `critic_min` `1.0`, `gate_min` `1.0`, `min_examiner` `0.0`, `usd_examiner`
`0.00`, `min_implementer` `6.0`, `usd_implementer` `3.00`, `min_reviewer` `2.0`, `usd_reviewer`
`1.00`, `min_critic` `1.0`, `usd_critic` `1.00`, `min_resolver` `0.0`, `usd_resolver` `0.00`,
`longest_chain_min` `5.0`, `fix_rounds` `1`, `launched_at` `2026-08-30T23:10:00Z`, `status_min`
`15.0`. run-103: `run` `run-103`, `engine` `0.3.17`, `terminus` `done`, `tasks` `3`,
`launched_at` `2026-08-30T23:30:00Z`, `pr` `https://github.com/o/r/pull/3`, `merged` `c`×40,
`status_min` `12.0`.
**BASE facts:** (generated at 1c97ba4)
- `run` at `fleet/doctor.mjs:719` blob f9a1174
- `engine` at `fleet/launch.mjs:471` blob 6150d59
- `tasks` at `fleet/fitness.mjs:112` blob 1cb6825
- `start` at `fleet/confine-hook.mjs:179` blob cb77dc8
- `pr` at `fleet/tests/test_sandbox_boot.mjs:302` blob 975a504
- `merged` at `fleet/tests/test_run_engine_conflict.mjs:73` blob 88b807e
- `RUN` at `fleet/tests/test_publish_fold.mjs:60` blob a98efe7
- `skills/ultralearn/scripts/fleet_events.py` blob 0a4b0a2
- `startedAt` at `fleet/tests/test_setup_script.mjs:305` blob 32f2a4d
- `updatedAt` at `fleet/janitor.mjs:495` blob c8d8258
- `Z` at `fleet/tests/test_publish_fold.mjs:1138` blob a98efe7
- `kind` at `fleet/lobby.mjs:418` blob 62d348b
- `id` at `fleet/run-waves.mjs:106` blob 27f25b5
- `ts` at `fleet/run-engine.mjs:719` blob e45a4ec
- `runId` at `fleet/tests/test_run_main.mjs:382` blob c29479b
- `phase` at `fleet/tests/test_sandbox_boot_selfmerge.mjs:513` blob 00ac21b
- `stage` at `fleet/run-main.mjs:548` blob 4cb8b21
- `provision` at `fleet/tests/_engine_helpers.mjs:38` blob 8aa0df0
- `gate` at `fleet/run-main.mjs:753` blob 4cb8b21
- `acks` at `fleet/run-main.mjs:277` blob 4cb8b21
- `label` at `fleet/run-engine.mjs:594` blob e45a4ec
- `role` at `fleet/run-worker.mjs:813` blob 3606982
- `sessionId` at `fleet/run-worker.mjs:816` blob 3606982
- `verdict` at `evals/frontier/replay_corpus.py:51` blob 7d40d74
- `exam` at `fleet/publish-fold.mjs:160` blob 6797792
- `impl` at `fleet/run-engine.mjs:1189` blob e45a4ec
- `fix` at `fleet/tests/test_roles_peer.mjs:48` blob 4847687
- `review` at `fleet/run-engine.mjs:1522` blob e45a4ec
- `resolve` at `fleet/tests/test_run_engine_exam_together.mjs:138` blob 71b366c
- `merge` at `fleet/run-engine.mjs:2065` blob e45a4ec
- `integration` at `fleet/run-waves.mjs:103` blob 27f25b5
- `examiner` at `fleet/tests/test_exam_dispatch_role.mjs:54` blob 051dad7
- `reviewer` at `fleet/tests/test_roles_peer.mjs:42` blob 4847687
- `critic` at `fleet/run-main.mjs:767` blob 4cb8b21
- `state` at `fleet/claude-token.mjs:76` blob b7e8e7b
- `tests/test_ultralearn_swallows.py` blob e9f739c
- `carries` at `evals/frontier/classify.py:19` blob fe29aaf
- `fleet/run-main.mjs` blob 4cb8b21
- `a` at `fleet/run-engine.mjs:644` blob e45a4ec
- `done` at `fleet/run-worker.mjs:972` blob 3606982
- `parked` at `fleet/publish-fold.mjs:657` blob 6797792
- `c` at `fleet/confine-hook.mjs:154` blob cb77dc8

**Proof:**
- Test: `tests/test_census_many.py`
- Legs, each invoking the script with `sys.executable` in a `tmp_path` working directory and
  reading the tracked fixture by its repo-relative path: (a) with the tree
  `tests/fixtures/ultralearn/census` as the one positional and `--csv out.csv`, the CSV's header
  equals the 31 column names in the pinned order and its data rows' `run` values are exactly
  `run-101`, `run-102`, `run-103` in that order; with the three run directories passed as three
  positionals in the order 103, 102, 101 the `run` order is still 101, 102, 103 — a script that
  keeps argv order, or that emits a row for the fixture root, fails [M1]; (b) the run-101 row
  of that CSV equals the pinned run-101 dict, every one of the 31 columns compared — a script
  that counts the critic's minute in the wave, or formats `2.5` for `cost_usd`, fails [M2];
  (c) the run-102 row equals the pinned run-102 dict — a width of `1` (starts at equal `ts`
  not seen as concurrent), a `fix_rounds` of `0`, a `longest_chain_min` of `3.0` (the fix and
  its re-review not chained to task 1), or a `fold_min` other than the empty string fails [M2];
  (d) the run-103 row equals the pinned run-103 dict: `tasks` `3`, `engine` `0.3.17`, `terminus`
  `done`, `status_min` `12.0`, and the empty string in every timing and role column — a script
  that skips the directory, or writes `0.0` where no log exists, fails [M3]; (e) `--md out.md`
  writes a file whose first line begins `| run | era | engine |`, whose second line is a
  separator of 31 `---` cells, and which has exactly three row lines after it; the stdout of a
  run with neither `--csv` nor `--md` equals that file's text; and running `--csv out.csv
  --append` a second time on the same three directories leaves the first run's bytes as an
  exact prefix, the file with exactly one line starting `run,era,` and six data rows [M4];
  (f) with `--label run-101=lift`, the CSV's run-101 row has `era` `lift` and the other two
  rows have `era` empty; and the run-101 row's `engine` is the empty string (its report has no
  `engineVersion`) while run-103's is `0.3.17` [M5].

**Stale-if:**
- path-absent: `skills/ultralearn/scripts/fleet_events.py`
- path-exists: `skills/ultralearn/scripts/census_many.py`
- issue-closed: #695

### Task 2: The ledger stamps only a true version and refuses an unreleased one

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultralearn/scripts/merge_ledger.py`
- Modify: `skills/ultralearn/scripts/_readers.py`
- Modify: `tests/test_merge_ledger.py`
- Modify: `skills/ultralearn/SKILL.md`
- Test: `tests/test_ledger_engine_stamp.py`

**Claim:** After the run, a merge into the ledger stamps a finding's engine version only when the bundle knows it for real, and turns away a finding stamped with a version this plugin never released. (derived)
Machine: M1. `merge_findings(findings, ledger_path, origin_lookup, engine_lookup=None,
released=None)`: when `released` is a collection of version strings, a finding whose
`engine_lookup(runId)` value is a string not in `released` is not written and is counted in a
new `refused` key of the returned dict; a finding whose lookup value is `None` is not refused
on that ground; `added` keeps its BASE meaning and `skipped` stays `len(findings) - added`.
M2. With `released` omitted or `None`, no finding is refused for its version: the BASE
behaviour, including the stamp of an arbitrary string such as `0.4.0`, is unchanged.
M3. `bundle_lookups(cache_dir)`'s `engine_lookup(runId)` answers `None` when the run's bundle has
`engineVersion.basis` equal to `home-repo-date` or `foreign-date-upper-bound`, and the epoch when
the basis is `explicit`, `plugin-cache-path`, or absent; `origin_lookup` is unchanged.
M4. `_readers.released_versions()` returns a `frozenset` of the version strings in
`release_timeline()`, and `None` when that timeline is empty — the caller's signal that the
history is not there to judge by.
M5. `tests/test_merge_ledger.py` still passes with its one date-basis pin re-scoped to `None`;
and §Verb 1 step 3 of `skills/ultralearn/SKILL.md` (from `3. **Merge.**` to `## Verb 2`) names
`released_versions` and `released=`.

**Authorized-by:** #696 (bug, experience-compiler)

**Interfaces:**
- Consumes: none
- Produces: `released_versions() -> frozenset[str] | None`

**Context:** At BASE `1c97ba44`, `merge_ledger.merge_findings(findings, ledger_path,
origin_lookup, engine_lookup=None)` returns `{"added": n, "skipped": len(findings) - n}` and
stamps `engineVersion` (a plain string) from `engine_lookup(runId)` when that is not `None`;
`bundle_lookups` (`merge_ledger.py:154` to 219) returns `engine_lookup` as
`ev.get("epoch") if isinstance(ev, dict) else None` over the bundle's `engineVersion` dict
`{epoch, asOf, basis}`. The harvester (`harvest_fleet_runs.py:628` to 631) writes basis
`explicit` when `--engine-version` was passed and otherwise `_readers.engine_epoch_at(as_of,
origin)` — basis `home-repo-date` (home) or `foreign-date-upper-bound` (foreign), the date guess
#696 names: every cached fleet bundle on the laptop on 2026-09-08 carries `home-repo-date` (run-45:
`{"epoch": "0.3.18", "asOf": "2026-09-07T22:23:09Z", "basis": "home-repo-date"}`), and the
laptop ledger carries `0.4.0` ×6 and `0.5.0` ×6 under `engineEpoch`, versions that never
existed. `plugin-cache-path` is a foreign run's plugin cache directory naming its version — a
read, not a guess — and a bundle with no `basis` key is an August bundle
(`tests/test_merge_ledger.py:388` writes one) whose epoch stays trusted. `_readers.release_timeline()`
(`_readers.py:86`) is `lru_cache`d and walks `git log -- .claude-plugin/plugin.json`, returning
`()` on any error and a one-row timeline in a depth-1 clone — so `released_versions()` must NOT
cache (the exam monkeypatches `release_timeline`) and must answer `None` on `()`. Released
versions of this plugin at BASE, from `chore(release):` commits on `main`, newest first:
0.3.21 0.3.20 0.3.19 0.3.18 0.3.17 0.3.16 0.3.15 0.3.14 0.3.13 0.3.12 0.3.11 0.3.10 0.3.9 0.3.8
0.3.7 0.3.6 0.3.5 0.3.4 0.3.3 0.3.2 0.3.1 0.3.0 0.2.26 … 0.0.6 — the timeline's version set is
that list (0.3.0 recurs: shipped 2026-06-10 and again at the 2026-08-29 cutover, which is why
`collapse_timeline` keeps repeats and why the set, not the sequence, is what `released_versions`
returns). No consumer of `merge_findings`'s return dict outside `tests/test_merge_ledger.py`
reads `skipped` (`git grep` on 2026-09-08). Pins owned here: `tests/test_merge_ledger.py:104`
`test_bundle_lookups_reads_cache_and_fails_closed` writes a bundle with basis `home-repo-date`
and asserts `engine_lookup("r1") == "0.0.12"` — re-scope that one assertion to `is None` and
say why in a comment; `test_bundle_lookups_expands_tilde` (no basis key, expects `0.1.12`) and
the four `_t3_` tests (basis `explicit`) stand. Do not add a `bundle.json` key. The skill text:
§Verb 1 step 3 (`skills/ultralearn/SKILL.md` lines 64–75 at BASE) says
`merge_findings(findings, "docs/superpowers/observations/ledger.jsonl", origin_lookup, engine_lookup)`
— rewrite that step to build the lookups, then
`released = released_versions()` from `_readers`, then pass `released=released` as the fifth
argument, and to say in one sentence that a date-basis bundle stamps no version and a version
outside the released set is refused and counted as `refused`. Step 3 is this task's only region
of that file; Task 3 of this wave rewrites step 1 and adds a `**Historical corpus**` paragraph
after step 3 — do not write the literals `ultralearn/runs/`, `10–23` or `Historical corpus`,
and do not touch step 1 or step 2. The one-time rewrite of the laptop's
`docs/superpowers/observations/ledger.jsonl` is the operator's, on the laptop, after this merges.
**BASE facts:** (generated at 1c97ba4)
- `refused` at `fleet/tests/test_sandbox_boot_selfmerge.mjs:723` blob 00ac21b
- `added` at `fleet/tests/test_claude_token.mjs:612` blob 15a4988
- `skipped` at `fleet/retire.mjs:369` blob 3c94125
- `origin_lookup` at `skills/ultralearn/scripts/merge_ledger.py:212` blob 5db7a06
- `tests/test_merge_ledger.py` blob e3f65b2
- `skills/ultralearn/SKILL.md` blob 63f9ad4
- `bundle_lookups` at `skills/ultralearn/scripts/merge_ledger.py:159` blob 5db7a06
- `engine_lookup` at `skills/ultralearn/scripts/merge_ledger.py:215` blob 5db7a06
- `release_timeline` at `skills/ultralearn/scripts/_readers.py:93` blob f722f84
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `collapse_timeline` at `skills/ultralearn/scripts/_readers.py:132` blob f722f84
- `merge_findings` at `skills/ultralearn/scripts/merge_ledger.py:58` blob 5db7a06
- `tests/test_merge_ledger.py:104` blob e3f65b2 line 104 `def test_bundle_lookups_reads_cache_and_fails_closed(tmp_pat`
- `test_bundle_lookups_reads_cache_and_fails_closed` at `tests/test_merge_ledger.py:104` blob e3f65b2
- `test_bundle_lookups_expands_tilde` at `tests/test_merge_ledger.py:271` blob e3f65b2
- `origin` at `fleet/launch.mjs:381` blob 6150d59
- `home` at `fleet/tests/_sandbox_boot_helpers.mjs:615` blob 7654fff
- `skills/ultralearn/scripts/merge_ledger.py` blob 5db7a06
- `skills/ultralearn/scripts/_readers.py` blob f722f84

**Proof:**
- Test: `tests/test_ledger_engine_stamp.py`
- Run: python3 -m pytest -q tests/test_merge_ledger.py -p no:cacheprovider
- Run: sed -n '/^3\. \*\*Merge/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -q 'released_versions'
- Run: sed -n '/^3\. \*\*Merge/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -q 'released='
- Legs, each over a `tmp_path` ledger and a home `origin_lookup`: (a) with `released =
  {"0.3.17"}` and an `engine_lookup` answering `"0.3.18"`, one finding: the result is
  `{"added": 0, "skipped": 1, "refused": 1}` and the ledger file is absent or empty; with the
  lookup answering `"0.3.17"`: `{"added": 1, "skipped": 0, "refused": 0}` and the one row's
  `engineVersion` is `0.3.17` — a merge that writes the `0.3.18` row, or omits `refused`,
  fails [M1]; (b) with the same `released` and a lookup answering `None`, the finding is added
  (`added` 1, `refused` 0) and its row has no `engineVersion` key [M1]; (c) two rows, each
  with a lookup answering `"0.4.0"`: with `released` omitted (the BASE four-argument call), and
  with `released=None` passed explicitly — in both, `added` is 1, the row's `engineVersion` is
  exactly `0.4.0`, and `refused` is 0 or absent; a merge that refuses the unreleased `0.4.0` on
  either call, or drops its stamp, fails [M2]; (d) five bundles under
  `<tmp>/runs/<id>/bundle.json`, each `origin` `home` with `engineVersion` `{"epoch": "0.3.0",
  "basis": <b>}` for `<b>` in `home-repo-date`, `foreign-date-upper-bound`, `explicit`,
  `plugin-cache-path`, and a fifth bundle whose `engineVersion` is `{"epoch": "0.3.0"}` with no
  `basis` key: `engine_lookup` answers `None`, `None`, `"0.3.0"`, `"0.3.0"`, `"0.3.0"` in turn
  and `origin_lookup` answers `home` for all five — a lookup that still trusts the two date
  bases, or that drops the epoch of the basis-less bundle, fails [M3]; (e) with
  `_readers.release_timeline` monkeypatched to `(("2026-08-28T10:52:30-07:00", "0.2.26"),
  ("2026-08-29T14:03:52-07:00", "0.3.0"), ("2026-09-08T00:00:00Z", "0.3.0"))`,
  `released_versions()` equals `frozenset({"0.2.26", "0.3.0"})`; monkeypatched to `()`, it is
  `None` — a function that caches its first answer, or returns an empty set for no history,
  fails one of the two [M4]; (f) the first `Run:` exits 0 — `tests/test_merge_ledger.py` green
  whole, its `test_bundle_lookups_reads_cache_and_fails_closed` now asserting `engine_lookup("r1")
  is None` for its `home-repo-date` bundle, so a lookup left trusting the date basis fails that
  file and a pin left at `"0.0.12"` fails against the new lookup; the second `Run:` exits 0
  (step 3, from `3. **Merge.**` to `## Verb 2`, contains `released_versions`) and the third
  exits 0 (the same slice contains `released=`) — a step 3 that omits either literal fails its
  own command [M5].

**Stale-if:**
- path-absent: `skills/ultralearn/scripts/merge_ledger.py`
- path-absent: `skills/ultralearn/scripts/_readers.py`
- path-absent: `tests/test_merge_ledger.py`
- issue-closed: #696

### Task 3: The harvest step names only what exists

**Type:** implementation

**Files:**
- Modify: `skills/ultralearn/SKILL.md`

**Claim:** The skill's harvest step names only what exists: the tag-first evidence read, the one cache path, the `--run`/`--force`/positional forms; the runs 10–23 paragraph moves to a "historical corpus" note pointing at `.claude/ultrapowers/fleet-evidence-archive/` (tarballs, per-run, read only for archaeology). (quoted from #697)
Machine: M1. §Verb 1 step 1 of `skills/ultralearn/SKILL.md` (the lines from `1. **Harvest.**`
to `2. **Read.**`) names the tag `ultra/evidence/run-<N>` before it names the branch
`ultra/evidence-run-<N>`, and carries the literal `ultralearn/runs/` exactly once — the one
cache path, `~/.claude/ultralearn/runs/run-<N>-<date>/`.
M2. Step 1 names `--run`, `--force`, `--engine-version` and the word `positional`.
M3. The file contains none of `commissioned way`, `fleet-runs-2026-08-26`,
`fleet-runs-2026-08-27`, `dbDir`, `shim.log`, `fleet-run.json`, `gate-read-`, `stat-<runId>`;
it contains exactly one paragraph whose line begins `**Historical corpus`, that paragraph
(to its next blank line) names `.claude/ultrapowers/fleet-evidence-archive/` and `10–23`, and
every line of the file naming `10–23` is inside that paragraph.
M4. `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn` prints `skill ok`
and `python3 -m pytest -q tests/test_ultralearn_docs.py` passes on the edited tree.

**Authorized-by:** #697 (bug, experience-compiler); #624 / R1b (the record is the tag
`ultra/evidence/run-<N>`, the branch transient)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** BASE `1c97ba44`. The section runs from line 12 `## Verb 1 — …` to line 77 `## Verb 2
— …`; step 1 is lines 14–58, step 2 lines 59–63, step 3 lines 64–75. What step 1 says that is
no longer so, by line: 19 "reads each run's committed record off its `ultra/evidence-run-<N>`
branch" (the harvester reads the branch first and the tag `ultra/evidence/run-<N>` when the
branch is gone — `harvest_fleet_runs.py --help` says so verbatim: "pull each --run's committed
record from this target's ultra/evidence-run-<N> branch, or its ultra/evidence/run-<N> tag once
that branch is gone" — and since #624/R1b the tag is the record of every finished run and the
branch exists only while a run is in flight, so the sentence names the tag first and the branch
as the in-flight fallback); 24–25 "runs 10–23 predate it and are the commissioned read's"; and
the whole paragraph 43–58 `**Runs 10–23 only — fleet evidence bundles read the commissioned
way** (#292) …` with its `gate-read-<runId>.json`, `stat-<runId>.json`, `shim.log`,
`fleet-run.json`, `<dbDir>-evidence/`, `.claude/ultrapowers/fleet-runs-2026-08-26/` and
`fleet-runs-2026-08-27/` layout — every one of those shapes is pre-0.3.5 and gone. Counts at
BASE over the whole file: `commissioned way` 2, `fleet-runs-2026-08-2` 2, `dbDir` 1, `shim.log`
1, `fleet-run.json` 1, `gate-read-` 2, `stat-<runId>` 1, `10–23` 2 (both in step 1),
`ultralearn/runs/` 1 (line 22, `~/.claude/ultralearn/runs/run-<N>-<date>/` — the harvester's
default `--cache ~/.claude/ultralearn` plus `runs/<runId>-<date>`, which is already the one
cache path: keep that literal, once), `ultra/evidence/run-<N>` 0, `fleet-evidence-archive` 0,
`positional` 1, `--force` 1, `--run` 2. The harvester's real interface (from `--help` on
2026-09-08): positional `paths` (a run dir, a tree containing them, or a sandbox-logs tarball),
`--cache CACHE` (default `~/.claude/ultralearn`), `--evidence OWNER/REPO`, `--run N`
(repeatable; `run-N` accepted), `--origin {home,foreign}`, `--engine-version`,
`--slice-budget`, `--force` (rebuild bundles already cached). `tests/test_ultralearn_docs.py`
pins two things and nothing else: the file names `harvest_fleet_runs.py` and `events.jsonl`, and
every `--flag` the file advertises from the set `--evidence --run --cache --force --origin
--engine-version --slice-budget` is in the CLI's `--help` — all seven are, so naming
`--engine-version` is safe and wanted: Task 2 of this wave makes the merge stamp no version from
a date-basis bundle, so step 1 should say that `--engine-version <release>` stamps the bundle
explicitly and that without it the bundle's version is a date guess the merge will not stamp.
Keep what is still true in step 1: the `harvest_fleet_runs.py --evidence <owner>/<repo> --run
<N>` line, the bundle path sentence, the incremental `evidenceSha` sentence, and the whole
"Sequential-engine drains … commissioned transcript reads …" paragraph (lines 30–42; the word
`commissioned` there is not `commissioned way` and stays). The historical note: one paragraph
starting at column 0 with `**Historical corpus**`, placed after step 3 and before `## Verb 2`,
saying that runs 10–23 (before `events.jsonl`, pre-#421) are read only for archaeology from
`.claude/ultrapowers/fleet-evidence-archive/` — on the laptop on 2026-09-08 that directory holds
`sandbox-logs/fleet-run-<N>-<stamp>/sandbox-logs.tgz` per run (18 of them, runs 10 onward),
`gate-read-run-<N>.json` reads and `stat-run-<N>.json` payloads (name the tarballs; do not
spell `gate-read-` or `stat-<runId>`, which M3 forbids), and that the directory is untracked and
absent from any sandbox. Task 2 of this wave rewrites step 3 (`3. **Merge.**` to `## Verb 2`)
of this file — do not edit step 3, and keep the note outside it (after step 3's last line and a
blank line). `validate_skill.py` resolves every `scripts/<file>` and `references/<file>` the body
names against `skills/ultralearn/` — name only files that exist there.
**BASE facts:** (generated at 1c97ba4)
- `skills/ultralearn/SKILL.md` blob 63f9ad4
- `positional` at `fleet/lobby.mjs:320` blob 62d348b
- `paths` at `fleet/run-engine.mjs:255` blob e45a4ec
- `tests/test_ultralearn_docs.py` blob 204c1db
- `skills/ultralearn/scripts/harvest_fleet_runs.py` blob bf5161e

**Proof:**
- Run: sed -n '/^1\. \*\*Harvest/,/^2\. \*\*Read/p' skills/ultralearn/SKILL.md | tr '\n' ' ' | grep -q 'ultra/evidence/run-<N>.*ultra/evidence-run-<N>'
- Run: test "$(sed -n '/^1\. \*\*Harvest/,/^2\. \*\*Read/p' skills/ultralearn/SKILL.md | grep -o 'ultralearn/runs/' | grep -c .)" = 1
- Run: sed -n '/^1\. \*\*Harvest/,/^2\. \*\*Read/p' skills/ultralearn/SKILL.md | grep -q -- '--run'
- Run: sed -n '/^1\. \*\*Harvest/,/^2\. \*\*Read/p' skills/ultralearn/SKILL.md | grep -q -- '--force'
- Run: sed -n '/^1\. \*\*Harvest/,/^2\. \*\*Read/p' skills/ultralearn/SKILL.md | grep -q -- '--engine-version'
- Run: sed -n '/^1\. \*\*Harvest/,/^2\. \*\*Read/p' skills/ultralearn/SKILL.md | grep -q 'positional'
- Run: bash -c '! grep -q -e "commissioned way" -e "fleet-runs-2026-08-26" -e "fleet-runs-2026-08-27" -e "dbDir" -e "shim.log" -e "fleet-run.json" -e "gate-read-" -e "stat-<runId>" skills/ultralearn/SKILL.md'
- Run: test "$(grep -c '^\*\*Historical corpus' skills/ultralearn/SKILL.md)" = 1
- Run: sed -n '/^\*\*Historical corpus/,/^$/p' skills/ultralearn/SKILL.md | grep -q '\.claude/ultrapowers/fleet-evidence-archive/'
- Run: sed -n '/^\*\*Historical corpus/,/^$/p' skills/ultralearn/SKILL.md | grep -q '10–23'
- Run: test "$(grep -c '10–23' skills/ultralearn/SKILL.md)" = "$(sed -n '/^\*\*Historical corpus/,/^$/p' skills/ultralearn/SKILL.md | grep -c '10–23')"
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn | grep -q 'skill ok'
- Run: python3 -m pytest -q tests/test_ultralearn_docs.py -p no:cacheprovider
- Legs: (a) the first `Run:` exits 0 — step 1, joined into one line, names the tag and then
  the branch; at BASE the tag is named nowhere in the file, so the BASE text fails it, and a
  rewrite that names only the tag (dropping the in-flight branch) fails it too — and the second
  `Run:` exits 0, the count of occurrences of `ultralearn/runs/` in step 1 (each occurrence
  counted, two on one line counting as two) being exactly `1`; a second spelling of the cache
  path raises it to `2` [M1]; (b) the third through sixth `Run:` each exit 0 —
  step 1 names `--run`, `--force`, `--engine-version` and `positional`; dropping any one fails
  its own command [M2]; (c) the seventh `Run:` exits 0 — the file holds none of the eight
  retired literals; at BASE it holds all eight, so a paragraph left in place fails it; the
  eighth `Run:` exits 0 — exactly one line begins `**Historical corpus` (at BASE `0`); the ninth
  and tenth exit 0 — that paragraph, to its next blank line, names the archive directory and
  `10–23`; and the eleventh exits 0 — every `10–23` in the file is inside that paragraph, so the
  BASE sentence at line 24 left in step 1 fails it [M3]; (d) the twelfth `Run:` prints `skill
  ok` (a `scripts/` or `references/` path the note names that does not exist under
  `skills/ultralearn/` fails it) and the thirteenth passes the docs pin — every advertised flag
  is a real flag [M4].

**Stale-if:**
- path-absent: `skills/ultralearn/SKILL.md`
- path-absent: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- path-absent: `tests/test_ultralearn_docs.py`
- issue-closed: #697
