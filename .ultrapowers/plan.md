# The harvester reads the evidence branch; the Workflow-era harvester and the ssh fetcher go

**Grammar:** claims-v1

**Claim:** After this run `harvest_fleet_runs.py --evidence owner/repo --run N` pulls a run's
record straight from the target's `ultra/evidence-run-N` branch and builds the same bundle the
ledger reads; the Workflow-era harvester, the ssh fetcher and their tests are gone, and only
the readers the fleet harvester actually imports remain. (elicited)

**Goal:** #605 and #612 layer 3. `skills/ultralearn/scripts/fleet_fetch.py` scps
`sandbox-logs.tgz` from `/home/exedev/fleet-evidence/sandbox-logs` on an orchestrator host
that was deleted at 0.3.5; `harvest_runs.py` (1,303 lines) detects runs by a `Workflow`
tool_result in `~/.claude/projects` transcripts, and the Workflow tool was deleted at 0.3.0 —
117 tests exercise it, 88 of them the Workflow half. Since #598 every run's record is committed
to the target repository's `ultra/evidence-run-<N>` branch under `.ultrapowers/runs/<N>/`
(`status.json`, `receipt.json`, `gate-receipt.json`, `report.json`, `events.jsonl`,
`engine.log`). What the fleet harvester actually imports from `harvest_runs.py` is measured:
`fleet_slice.py` uses `_records`, `_iter_blocks_indexed`, `_block_text`, `SLICE_TURN_MAX`,
`SLICE_KEYWORDS`; `harvest_fleet_runs.py` uses `engine_epoch_at` — nothing else in the repo
imports it. Those readers move to a small module; the rest is deleted with its tests; the
fetch path becomes the contents API the janitor already uses.

**Tech Stack:** Python 3.11 under `skills/ultralearn/scripts/` (no third-party deps; `gh` is
shelled out to), pytest under `tests/` (stub binaries on `PATH` for `gh`, the idiom
`test_remote_harvest_of_an_unreachable_host_fails_loud` uses for `ssh`).

**Spec:** #605 (the ticket); #612's audit rows for `test_harvest_runs.py` and
`test_fleet_fetch.py`.

**Parallelization rationale:** One wave, width 2. Task 1 moves the live readers and deletes the
Workflow harvester; Task 2 replaces the ssh fetch with the evidence-branch fetch and deletes
the fetcher. Both edit `harvest_fleet_runs.py` (Task 1 its `harvest_runs` import and one call
site; Task 2 its CLI and fetch path) and `tests/test_harvest_fleet_runs.py` (Task 1 one
monkeypatch target; Task 2 one deleted test and new ones) — text that folds at merge. Neither
needs the other's behaviour: Task 2's fetch lands files in a directory the existing
`discover_run_dirs` already reads.

## Global Constraints

- The bundle the ledger reads keeps its shape: `merge_ledger.py` is byte-identical to BASE, and
  a run directory harvested at BASE and after this run yields `bundle.json` files that differ
  in no key.
- No network in any test: `gh`, `git` and `ssh` reach a test only as stub executables on `PATH`.
- `python3 -m pytest tests/ -n auto` passes; `python3 skills/ultrapowers/scripts/validate_skill.py
  skills/ultralearn` prints `skill ok`.
- Nothing under `fleet/` changes.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The five live readers move to `_readers.py`; the Workflow-era harvester goes

**Type:** implementation
**Review:** peer

**Files:**
- Create: `skills/ultralearn/scripts/_readers.py`
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Modify: `skills/ultralearn/scripts/fleet_slice.py`
- Modify: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- Modify: `skills/ultralearn/SKILL.md`
- Modify: `tests/test_harvest_runs.py`
- Modify: `tests/test_harvest_fleet_runs.py`

**Claim:** Only the readers the fleet harvester actually imports remain. (derived)
Machine: M1. `skills/ultralearn/scripts/_readers.py` exports exactly `records(session_path)`,
`block_text(block)`, `iter_blocks_indexed(records)`, `SLICE_KEYWORDS`, `SLICE_TURN_MAX`,
`engine_epoch_at(ts, origin, timeline=None, cache_version=None)`, `release_timeline()` and
`collapse_timeline(rows)`, with the bodies `harvest_runs.py` carried at BASE (the
`swallow`-marked skips kept, the `lru_cache` decorator on `release_timeline` kept — the
string `lru_cache` present in the module) and nothing else public. M2. `skills/ultralearn/scripts/harvest_runs.py` does not exist, and no file
under `skills/` or `tests/` imports it (`import harvest_runs`, `from harvest_runs` absent);
`fleet_slice.py` reads the five names from `_readers` and `harvest_fleet_runs.py` reads
`engine_epoch_at` from `_readers`. M3. `tests/test_harvest_runs.py` does not exist;
`tests/test_readers.py` carries the six reader tests that exist at BASE
(`test_engine_epoch_at_resolves_from_a_bare_timestamp`,
`test_engine_epoch_at_honors_a_foreign_cache_version`,
`test_engine_epoch_at_unknown_timestamp_is_advisory`,
`test_a_run_today_dates_to_the_head_plugin_version`,
`test_collapse_timeline_collapses_adjacent_duplicates`,
`test_collapse_timeline_keeps_a_version_that_recurs_after_a_reset`) re-pointed at `_readers`,
plus one direct test each for `records` (an unparseable line is skipped and the rest read),
`block_text` (a nested `tool_result` content list flattens to its texts joined by newlines)
and `iter_blocks_indexed` (a string `content` yields one `text` block at the record's index).
M4. `tests/test_harvest_fleet_runs.py`'s `test_bundle_dates_itself_from_the_event_log_when_no_version_is_given`
monkeypatches `_readers.release_timeline` and passes; `tests/test_fleet_slice.py` passes
unchanged. M5. `skills/ultralearn/SKILL.md` no longer contains `harvest_runs.py`, `tool_result` or
`.claude/projects`; its harvest step names `harvest_fleet_runs.py`, `events.jsonl` and the
usage `--evidence <owner>/<repo> --run <N>`, and no longer contains `--remote`. M6. `python3 -m pytest tests/ --collect-only
-q` reports exactly `1364 tests collected` in this task's tree (BASE's 1472, less
`test_harvest_runs.py`'s 117, plus `test_readers.py`'s 9).

**Authorized-by:** #605; #612 audit row `tests/test_harvest_runs.py` ("delete the Workflow half
and its tests (~90); keep the 5 shared readers … Lands with #605"); #434 (the Workflow tool
deleted at 0.3.0).

**Interfaces:**
- Consumes: none
- Produces: `records(session_path) -> list[dict]`
- Produces: `block_text(block) -> str`
- Produces: `iter_blocks_indexed(records) -> Iterator[tuple[int, dict, dict]]`
- Produces: `engine_epoch_at(ts, origin, timeline=None, cache_version=None) -> dict`
- Produces: `release_timeline() -> tuple`
- Produces: `collapse_timeline(rows) -> tuple`

**Context:** The measured import graph at BASE. `fleet_slice.py` line 13 `import harvest_runs`
and uses `harvest_runs._iter_blocks_indexed` (:145), `harvest_runs._block_text` (:147),
`harvest_runs.SLICE_TURN_MAX` (:152–154), `harvest_runs.SLICE_KEYWORDS` (:156),
`harvest_runs._records` (:177); its comment at :133 says it deliberately does NOT use
`slice_transcript`. `harvest_fleet_runs.py` line 37 `import harvest_runs` and one call,
`harvest_runs.engine_epoch_at(as_of, origin)` (:221). `tests/test_harvest_fleet_runs.py:183`
`monkeypatch.setattr(hfr.harvest_runs, "_release_timeline", lambda: ((…), (…)))`. Nothing
else imports the module (`evals/frontier/corpus_extract.py` and
`skills/ultrawrite/scripts/extract_gate_input.py` mention it only in comments). The bodies
to move, from `harvest_runs.py`: `_block_text` (42–54, self-recursive, no deps),
`_iter_blocks_indexed` (62–77, the #137 string-content branch included), `_records`
(381–393, uses `swallow` from `_outcome`), `_repo_root` (931), `_to_dt` (935–945),
`_release_timeline` (949–985, `@functools.lru_cache(maxsize=1)`, shells `git log
--format=%H%x09%cI -- .claude-plugin/plugin.json` and `git show` per commit, returns `()` on
any error), `collapse_timeline` (988–1000), `engine_epoch_at` (1057–1080) and the constants
`SLICE_KEYWORDS` (26) and `SLICE_TURN_MAX` (28). Drop the underscore on the public names;
`_readers.py` does its own `sys.path.insert(0, str(Path(__file__).resolve().parent))` before
`from _outcome import swallow`, the idiom every script in the directory uses. The six tests
to keep are at `tests/test_harvest_runs.py` lines 1691, 1698, 1705, 1727 (this one also
touches `_release_timeline` and `_repo_root`), 1711, 1718; every other test there calls
`build_bundle`/`harvest`/`slice_transcript`/`_stamp_terminus`/`_drain_*` — the Workflow
half — and goes with the module. `slice_transcript` is dead code: its only caller was
`build_bundle`. `tests/test_fleet_slice.py` imports `fleet_slice` alone. `SKILL.md` today:
line 15 `python3 skills/ultralearn/scripts/harvest_runs.py`, line 17 `~/.claude/projects` inside
the fleet-harvest sentence, line 19 `python3 skills/ultralearn/scripts/harvest_fleet_runs.py
--remote fleet-orchestrator.exe.xyz`, lines 27–31 the "Workflow-era detector scans
`~/.claude/projects` … `Workflow` tool_result" paragraph, and lines 44–59 a "Runs 10–23 only"
paragraph naming `.claude/projects` at line 54 — this task owns the whole file: delete line
15 and the detector paragraph, rewrite line 19 as `python3
skills/ultralearn/scripts/harvest_fleet_runs.py --evidence <owner>/<repo> --run <N>` (the
concurrent Task 2 implements that flag; `tests/test_ultralearn_docs.py`'s allowlist at BASE
does not name `--evidence`, so the docs pin stays green in this clone), and reword the two
sentences that mention `.claude/projects` so the literal is gone (the fleet sentence can say
"not from a session transcript"; the runs-10–23 paragraph can say "the engine transcripts").
`tests/test_ultralearn_docs.py` pins `harvest_fleet_runs.py` and `events.jsonl` in the
skill and every advertised flag from a fixed allowlist — unchanged by this task. Counting:
`python3 -m pytest tests/ --collect-only -q | tail -n 1`; BASE 1472; −117 +9 = 1364.

**Proof:**
- Test: `tests/test_readers.py`
- Run: `test "$(python3 -m pytest tests/ --collect-only -q 2>/dev/null | tail -n 1 | cut -d' ' -f1)" = 1364`
- Run: `test ! -e skills/ultralearn/scripts/harvest_runs.py && test ! -e tests/test_harvest_runs.py && ! grep -rqE 'import harvest_runs|from harvest_runs' skills tests && grep -q 'from _readers import\|import _readers' skills/ultralearn/scripts/fleet_slice.py && grep -q '_readers' skills/ultralearn/scripts/harvest_fleet_runs.py`
- Run: `python3 -c "import sys; sys.path.insert(0,'skills/ultralearn/scripts'); import _readers as r; names=sorted(n for n in dir(r) if not n.startswith('_') and (n.isupper() or getattr(getattr(r,n),'__module__',None)=='_readers')); assert names==['SLICE_KEYWORDS','SLICE_TURN_MAX','block_text','collapse_timeline','engine_epoch_at','iter_blocks_indexed','records','release_timeline'], names"`
- Run: `! grep -q 'harvest_runs.py' skills/ultralearn/SKILL.md && ! grep -q 'tool_result' skills/ultralearn/SKILL.md && ! grep -q '\.claude/projects' skills/ultralearn/SKILL.md && ! grep -q -- '--remote' skills/ultralearn/SKILL.md && grep -q 'harvest_fleet_runs.py' skills/ultralearn/SKILL.md && grep -q 'events.jsonl' skills/ultralearn/SKILL.md && grep -q -- '--evidence <owner>/<repo> --run <N>' skills/ultralearn/SKILL.md && grep -q 'lru_cache' skills/ultralearn/scripts/_readers.py && python3 -m pytest -q tests/test_ultralearn_docs.py tests/test_fleet_slice.py tests/test_harvest_fleet_runs.py tests/test_readers.py`
- Legs: (a) the third Run: exits non-zero unless the module's public names are exactly the
  eight, so an extra public helper or a missing reader fails it; `tests/test_readers.py`
  asserts `engine_epoch_at` on a bare timestamp, a foreign cache version and an unknown
  timestamp, the head-version dating, and both `collapse_timeline` cases, plus `records`
  skipping one unparseable line among three, `block_text` flattening a nested
  `tool_result`, and `iter_blocks_indexed` yielding `(0, record, {"type": "text", "text":
  …})` for a string-content record [M1, M3]; (b) the second Run: exits non-zero if either
  deleted file survives, if any file under `skills/` or `tests/` still imports
  `harvest_runs`, or if either live consumer does not read from `_readers` [M2]; (c) the
  fourth Run: exits non-zero if the skill still contains `harvest_runs.py`, `tool_result`,
  `.claude/projects` or `--remote`, if it no longer names the fleet harvester, its corpus or
  the `--evidence <owner>/<repo> --run <N>` usage, if `lru_cache` is absent from the readers
  module, or if the docs pin, the slice tests, the fleet-harvester tests (with their
  monkeypatch re-pointed) or the reader tests fail [M1, M4, M5]; (d) the first Run: exits non-zero unless exactly 1364 tests collect — one reader
  test fewer or one Workflow test kept fails it [M6].

**Stale-if:**
- path-absent: `skills/ultralearn/scripts/_outcome.py`
- path-absent: `skills/ultralearn/scripts/fleet_slice.py`
- issue-closed: #605

### Task 2: `--evidence owner/repo --run N` replaces `--remote`; the ssh fetcher goes

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- Modify: `skills/ultralearn/scripts/fleet_fetch.py`
- Modify: `tests/test_fleet_fetch.py`
- Modify: `tests/test_harvest_fleet_runs.py`
- Modify: `tests/test_ultralearn_swallows.py`
- Modify: `tests/test_ultralearn_docs.py`
- Test: `tests/test_harvest_evidence.py`

**Claim:** `harvest_fleet_runs.py --evidence owner/repo --run N` pulls a run's record straight
from the target's `ultra/evidence-run-N` branch and builds the same bundle the ledger reads.
(derived)
Machine: M1. `harvest_fleet_runs.py` accepts `--evidence OWNER/REPO` with one or more `--run
N` (`N` a run number, `run-N` also accepted and normalised), refuses `--evidence` without
`--run` with exit 2 and a usage line, and no longer accepts `--remote` or `--remote-root`
(`--help` names `--evidence` and not `--remote`). M2. For each run it fetches each of
`status.json`, `receipt.json`, `gate-receipt.json`, `report.json`, `events.jsonl`,
`engine.log` with exactly `gh api
repos/OWNER/REPO/contents/.ultrapowers/runs/N/<file>?ref=ultra/evidence-run-N`, decodes the
contents envelope's base64 `content`, writes the file under `<tmp>/evidence/N/`, and hands
that directory to the existing `discover_run_dirs`; a file whose `gh api` exits non-zero is
an absence — a marked skip, the run still bundles — except `events.jsonl`, whose absence is
a `FailedLookup` naming the run and the branch (`FAILED-LOOKUP:` on stderr, counted as a
failure). M3. A `gh` that is missing from `PATH`, or that exits non-zero on every file, makes
the run a `FailedLookup` naming `OWNER/REPO` and `N` and the process exits 2 when nothing
else built, exactly the exit rule `main` keeps (`2 if failed and not built and not skipped
else 0`). M4. `skills/ultralearn/scripts/fleet_fetch.py` and `tests/test_fleet_fetch.py` do
not exist; `harvest_fleet_runs.py` does not import `fleet_fetch`; `tests/test_harvest_fleet_runs.py`
no longer defines `test_remote_harvest_of_an_unreachable_host_fails_loud`;
`tests/test_ultralearn_swallows.py`'s `NOT_YET_SWEPT` no longer names `fleet_fetch.py`;
`tests/test_ultralearn_docs.py`'s flag allowlist names `--evidence` and not `--remote` or
`--remote-root`. M5. The bundle written for a run directory that already exists on disk is
unchanged: harvesting `tests/test_harvest_fleet_runs.py`'s `_make_run_dir` fixture yields a
`bundle.json` whose keys and `origin`/`engineVersion`/`terminus`/`runId` values equal the
ones the BASE harvester writes.

**Authorized-by:** #605 ("Repoint the harvest at the committed evidence … a fetch of the
evidence branch"); #612 audit row `tests/test_fleet_fetch.py` ("delete, with the module and
`harvest_fleet_runs --remote`"); `fleet/CONTRACT.md` (the six files under
`.ultrapowers/runs/<N>/` on `ultra/evidence-run-<N>`); `fleet/janitor.mjs` (`gh api
repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>` — the
same read).

**Interfaces:**
- Consumes: none
- Produces: `fetch_evidence(target: str, run: str, dest: Path) -> Path`

**Context:** `harvest_fleet_runs.py` today: imports at 30–37 (`from _outcome import
FailedLookup, report_failed_lookup, report_looked_empty`, `import fleet_events`, `import
fleet_fetch`, `import fleet_slice`, `import harvest_runs` — the last is the concurrent Task
1's line; touch only the `fleet_fetch` line); `main()` at 259–322 with `ap.add_argument("--remote",
metavar="HOST", …)`, `--remote-root` (default `fleet_fetch.DEFAULT_REMOTE_ROOT`), `--run`
(`action="append", dest="run_ids"`), `--origin`, `--engine-version`, `--slice-budget`,
`--force`; inside `with tempfile.TemporaryDirectory(prefix="ultralearn-fleet-") as tmp:` the
block `if args.remote: try: paths += fleet_fetch.fetch_bundles(args.remote, Path(tmp) /
"remote", remote_root=…, run_ids=…) except FailedLookup as exc: report_failed_lookup(str(exc));
failed += 1` — the seam to replace; `discover_run_dirs(path, workdir)` (80–120) accepts a
bare run dir (one holding `events.jsonl`), a tree, or a tarball, so the fetched
`<tmp>/evidence/N/` directory needs no new reader; `build_fleet_bundle` reads
`events.jsonl`, `gate-receipt.json`, `report.json`, and tolerates a missing `fleet-run.json`
and `confine-denials.jsonl` (neither is on the evidence branch — `planPath` is `None` then,
which is already the advisory path); the exit rule is line 322. The contents API answers a
JSON envelope with `content` (base64, newline-wrapped) and `encoding: "base64"`; `gh api`
exits 1 with `HTTP 404` on an absent path — the janitor treats that as an answer, not a
failure. Shell out with `subprocess.run(["gh", "api", path], capture_output=True,
text=True, timeout=…)`; a `FileNotFoundError` (no `gh`) is the M3 case. Tests stub `gh`
with an executable on `PATH` that writes the envelope for a known path and exits 1 with
`HTTP 404` otherwise — the idiom at `tests/test_harvest_fleet_runs.py:484`
(`test_remote_harvest_of_an_unreachable_host_fails_loud` puts a fake `ssh` on `PATH`; that
test is deleted here, its idiom reused). `tests/test_ultralearn_swallows.py` line 89
`NOT_YET_SWEPT = frozenset({"fleet_fetch.py", "harvest_fleet_runs.py"})` — keep
`harvest_fleet_runs.py` unless every `except` in it is `swallow`-marked. `tests/test_ultralearn_docs.py`
line 24–33: `test_every_flag_the_skill_advertises_exists` intersects the flags the skill
advertises with the allowlist `{--remote, --run, --cache, --force, --origin,
--engine-version, --slice-budget, --remote-root}` and checks each against `--help`; the
skill's line 19 today advertises `--remote fleet-orchestrator.exe.xyz`; the concurrent Task 1
owns `SKILL.md` and rewrites that line to `--evidence <owner>/<repo> --run <N>` — this task
does not touch the skill file; in this clone the skill still advertises `--remote`, which the
rewritten allowlist no longer names, so the docs pin stays green here and after the fold. `_make_run_dir(root, run_id,
with_report, with_gate)` at `tests/test_harvest_fleet_runs.py:19` writes `events.jsonl`,
`report.json`, `gate-receipt.json`, `confine-denials.jsonl` and a transcript dir — the M5
fixture; the BASE bundle for comparison is produced by `git show
2cc873fb2d040fbe081f35ff0ababc408eaa6500:skills/ultralearn/scripts/harvest_fleet_runs.py`
run in a temp copy of the scripts directory, or simply by asserting the key set and the
four values the ledger reads (`merge_ledger.py`'s `bundle_lookups` reads `origin` and
`engineVersion.epoch`).

**Proof:**
- Test: `tests/test_harvest_evidence.py`
- Run: `test ! -e skills/ultralearn/scripts/fleet_fetch.py && test ! -e tests/test_fleet_fetch.py && ! grep -q 'fleet_fetch' skills/ultralearn/scripts/harvest_fleet_runs.py && ! grep -q 'fleet_fetch' tests/test_ultralearn_swallows.py && ! grep -q 'test_remote_harvest_of_an_unreachable_host_fails_loud' tests/test_harvest_fleet_runs.py && grep -q -- '--evidence' tests/test_ultralearn_docs.py && ! grep -q -- '--remote' tests/test_ultralearn_docs.py`
- Run: `python3 skills/ultralearn/scripts/harvest_fleet_runs.py --help | grep -q -- '--evidence' && ! python3 skills/ultralearn/scripts/harvest_fleet_runs.py --help | grep -q -- '--remote'`
- Run: `python3 -m pytest -q tests/test_harvest_evidence.py tests/test_harvest_fleet_runs.py tests/test_ultralearn_swallows.py tests/test_ultralearn_docs.py`
- Legs: (a) `--evidence popmechanic/smoke --run 7 --cache <tmp>` with a stub `gh` that answers
  the six paths for run 7 (each a base64 envelope of a file from `_make_run_dir`) exits 0,
  the stub's argv log shows exactly six `api` calls each of the form
  `repos/popmechanic/smoke/contents/.ultrapowers/runs/7/<file>?ref=ultra/evidence-run-7`,
  and `<cache>/runs/<runId>/bundle.json` exists with `terminus` from the fetched
  gate-receipt; `--run run-7` produces the same six paths; `--evidence x/y` with no `--run`
  exits 2 and prints a usage line naming `--run`; `--remote h` exits 2 as an unrecognised
  argument [M1, M2]; (b) a stub `gh` that 404s `engine.log` and `receipt.json` still bundles
  the run and exits 0 with a skip diagnostic on stderr; a stub that 404s `events.jsonl`
  prints `FAILED-LOOKUP:` naming `ultra/evidence-run-7` and exits 2 [M2]; (c) with no `gh` on
  `PATH`, and with a `gh` that exits 1 on every path, `--evidence popmechanic/smoke --run 7`
  prints `FAILED-LOOKUP:` naming `popmechanic/smoke` and `7` and exits 2; with a healthy run
  directory given as a positional beside the failing `--evidence`, the exit is 0 and the
  positional run bundles [M3]; (d) the first and second Run: exit non-zero if any deleted
  file, import, test or flag survives, or if `--help` lacks `--evidence` [M4]; (e) harvesting
  `_make_run_dir`'s directory as a positional yields a `bundle.json` whose key set equals
  the one the BASE harvester (its blob at the plan's BASE sha, run from a temp copy of the
  scripts directory) writes for the same directory, with equal `runId`, `origin`,
  `terminus` and `engineVersion.basis`; the third Run: exits non-zero if any of the four
  pytest files fails [M5].

**Stale-if:**
- path-absent: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- path-absent: `fleet/janitor.mjs`
- issue-closed: #605
