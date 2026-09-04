# The five live readers move to `_readers.py`; the Workflow-era harvester goes (recovery of run-2 Task 1)

**Grammar:** claims-v1

**Claim:** After this run only the readers the fleet harvester actually imports remain; the
Workflow-era harvester and its tests are gone. (elicited)

**Goal:** Run-2 (plan `2026-09-04-harvester-on-the-evidence-branch.md`) landed its Task 2 — the
`--evidence owner/repo --run N` fetch, `fleet_fetch.py` deleted — and lost its Task 1 to
`fix-loop-exhausted`: `tests/test_ultralearn_swallows.py::test_healthy_paths_unchanged` passes
the literal path `tests/test_harvest_runs.py` to a pytest subprocess, that file was in Task 2's
FILES, so no diff confined to Task 1's FILES could delete the test file and keep the suite green.
Round 1 ruled the compelled one-line re-point lawful; the fix round reverted it; round 2 blocked.
This plan is Task 1 again, on run-2's integration head, with that file in its own FILES.

**Tech Stack:** Python 3.11 under `skills/ultralearn/scripts/`, pytest under `tests/`.

**Spec:** #605; run-2's report (`.ultrapowers/runs/2/report.json` on `ultra/evidence-run-2`).

**Parallelization rationale:** One task. Nothing to widen: the deletion, the new module, the two
re-pointed importers and the one re-pointed test path are one contract.

## Global Constraints

- The bundle the ledger reads keeps its shape: `skills/ultralearn/scripts/merge_ledger.py` is
  byte-identical to BASE.
- `skills/ultralearn/scripts/harvest_fleet_runs.py`'s CLI is unchanged from BASE: `--help` names
  `--evidence`, `--run`, `--cache`, `--force`, `--origin`, `--engine-version`, `--slice-budget`
  and not `--remote`.
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
- Modify: `tests/test_ultralearn_swallows.py`

**Claim:** Only the readers the fleet harvester actually imports remain. (derived)
Machine: M1. `skills/ultralearn/scripts/_readers.py` exports exactly `records(session_path)`,
`block_text(block)`, `iter_blocks_indexed(records)`, `SLICE_KEYWORDS`, `SLICE_TURN_MAX`,
`engine_epoch_at(ts, origin, timeline=None, cache_version=None)`, `release_timeline()` and
`collapse_timeline(rows)`, with the bodies `harvest_runs.py` carried at BASE (the
`swallow`-marked skips kept, the `lru_cache` decorator on `release_timeline` kept — the string
`lru_cache` present in the module) and nothing else public. M2. `skills/ultralearn/scripts/harvest_runs.py`
does not exist, and no file under `skills/` or `tests/` imports it (`import harvest_runs`, `from
harvest_runs` absent); `fleet_slice.py` imports `_readers` and refers to each of `records`, `block_text`,
`iter_blocks_indexed`, `SLICE_KEYWORDS`, `SLICE_TURN_MAX` through it (as `_readers.<name>` or
on a `from _readers import` line naming it) while defining none of the eight reader names
itself; `harvest_fleet_runs.py` likewise imports `_readers`, refers to `engine_epoch_at` through
it, and defines none of the eight itself. M3. `tests/test_harvest_runs.py`
does not exist; `tests/test_readers.py` collects exactly nine tests: the six reader tests that
exist at BASE (`test_engine_epoch_at_resolves_from_a_bare_timestamp`,
`test_engine_epoch_at_honors_a_foreign_cache_version`,
`test_engine_epoch_at_unknown_timestamp_is_advisory`,
`test_a_run_today_dates_to_the_head_plugin_version`,
`test_collapse_timeline_collapses_adjacent_duplicates`,
`test_collapse_timeline_keeps_a_version_that_recurs_after_a_reset`) re-pointed at `_readers`,
plus one direct test each for `records` (an unparseable line is skipped and the rest read),
`block_text` (a nested `tool_result` content list flattens to its texts joined by newlines) and
`iter_blocks_indexed` (a string `content` yields one `text` block at the record's index). M4.
`tests/test_harvest_fleet_runs.py`'s `test_bundle_dates_itself_from_the_event_log_when_no_version_is_given`
monkeypatches `_readers.release_timeline` and passes; `tests/test_fleet_slice.py` is
byte-identical to BASE and passes. M5. `tests/test_ultralearn_swallows.py::test_healthy_paths_unchanged` passes the
paths `"tests/test_readers.py", "tests/test_fleet_slice.py",` then `"tests/test_merge_ledger.py"` to
its pytest subprocess — `tests/test_harvest_runs.py` no longer appears in the file — and its
`NOT_YET_SWEPT` line and every other line of the file are unchanged from BASE. M6.
`skills/ultralearn/SKILL.md` no longer contains `harvest_runs.py`, `tool_result` or
`.claude/projects`; its harvest step names `harvest_fleet_runs.py`, `events.jsonl` and the usage
`--evidence <owner>/<repo> --run <N>`, and no longer contains `--remote`.

**Authorized-by:** #605; #612 audit row `tests/test_harvest_runs.py`; run-2's report (the
referee's round-1 ruling that the swallows re-point is compelled and lawful).

**Interfaces:**
- Consumes: none
- Produces: `records(session_path) -> list[dict]`
- Produces: `block_text(block) -> str`
- Produces: `iter_blocks_indexed(records) -> Iterator[tuple[int, dict, dict]]`
- Produces: `engine_epoch_at(ts, origin, timeline=None, cache_version=None) -> dict`
- Produces: `release_timeline() -> tuple`
- Produces: `collapse_timeline(rows) -> tuple`

**Context:** BASE is run-2's integration head (`108a2c752daa6d1ad351e884538fe7d668a0b172`), where
Task 2 already landed: `harvest_fleet_runs.py` has `--evidence`/`--run` and no `fleet_fetch`
import; `tests/test_harvest_evidence.py` exists; `tests/test_ultralearn_docs.py`'s allowlist
names `--evidence` and not `--remote`; `tests/test_ultralearn_swallows.py`'s `NOT_YET_SWEPT` is
`frozenset({"harvest_fleet_runs.py"})`. The measured import graph: `fleet_slice.py` line 13
`import harvest_runs` and uses `harvest_runs._iter_blocks_indexed`, `._block_text`,
`.SLICE_TURN_MAX`, `.SLICE_KEYWORDS`, `._records`; `harvest_fleet_runs.py` `import harvest_runs`
(line 38 at this BASE) and one call `harvest_runs.engine_epoch_at(as_of, origin)`;
`tests/test_harvest_fleet_runs.py:183` `monkeypatch.setattr(hfr.harvest_runs,
"_release_timeline", …)`; `tests/test_ultralearn_swallows.py:222–228`
`test_healthy_paths_unchanged` runs `[sys.executable, "-m", "pytest", "-p", "no:xdist", "-q",
"tests/test_harvest_runs.py", "tests/test_fleet_slice.py", "tests/test_merge_ledger.py"]` and
asserts exit 0 — pytest exits 4 on a nonexistent path, which is what killed run-2's Task 1;
change that one argument to `tests/test_readers.py` and nothing else in the file. Nothing else
imports `harvest_runs` (`evals/frontier/corpus_extract.py` and
`skills/ultrawrite/scripts/extract_gate_input.py` mention it in comments only). The bodies to
move, from `harvest_runs.py`: `_block_text` (42–54), `_iter_blocks_indexed` (62–77, the #137
string-content branch included), `_records` (381–393, uses `swallow` from `_outcome`),
`_repo_root` (931), `_to_dt` (935–945), `_release_timeline` (949–985,
`@functools.lru_cache(maxsize=1)`, shells `git log --format=%H%x09%cI --
.claude-plugin/plugin.json` and `git show` per commit, returns `()` on any error),
`collapse_timeline` (988–1000), `engine_epoch_at` (1057–1080), and the constants
`SLICE_KEYWORDS` (26) and `SLICE_TURN_MAX` (28). Drop the underscore on the public names;
`_readers.py` does its own `sys.path.insert(0, str(Path(__file__).resolve().parent))` before
`from _outcome import swallow`. The six tests to keep are at `tests/test_harvest_runs.py` lines
1691, 1698, 1705, 1727 (also touches `_release_timeline` and `_repo_root`), 1711, 1718; every
other test there exercises the Workflow half and goes with the module. `SKILL.md` today: line
15 `python3 skills/ultralearn/scripts/harvest_runs.py`, line 17 `~/.claude/projects` inside the
fleet-harvest sentence, line 19 `… harvest_fleet_runs.py --remote fleet-orchestrator.exe.xyz`,
lines 27–31 the "Workflow-era detector scans `~/.claude/projects` … `Workflow` tool_result"
paragraph, and a "Runs 10–23 only" paragraph naming `.claude/projects` at line 54 — delete line
15 and the detector paragraph, rewrite line 19 as `python3
skills/ultralearn/scripts/harvest_fleet_runs.py --evidence <owner>/<repo> --run <N>`, and reword
the two sentences that mention `.claude/projects` so the literal is gone. Count pins are
per-file only (absolute suite counts fail on any integrated tree — run-4's lesson).

**Proof:**
- Test: `tests/test_readers.py`
- Run: `test ! -e skills/ultralearn/scripts/harvest_runs.py && test ! -e tests/test_harvest_runs.py && ! grep -rqE 'import harvest_runs|from harvest_runs' skills tests && grep -qE '^(from _readers import|import _readers)' skills/ultralearn/scripts/fleet_slice.py && grep -qE '^(from _readers import|import _readers)' skills/ultralearn/scripts/harvest_fleet_runs.py && ! grep -qE '^def (records|block_text|iter_blocks_indexed|engine_epoch_at|release_timeline|collapse_timeline)\b|^SLICE_(KEYWORDS|TURN_MAX) *=' skills/ultralearn/scripts/fleet_slice.py skills/ultralearn/scripts/harvest_fleet_runs.py && for n in records block_text iter_blocks_indexed SLICE_KEYWORDS SLICE_TURN_MAX; do grep -qE "_readers\.$n\b|^from _readers import .*\b$n\b" skills/ultralearn/scripts/fleet_slice.py || exit 1; done && grep -qE '_readers\.engine_epoch_at\b|^from _readers import .*\bengine_epoch_at\b' skills/ultralearn/scripts/harvest_fleet_runs.py && git diff --quiet 108a2c752daa6d1ad351e884538fe7d668a0b172 -- tests/test_fleet_slice.py && test "$(python3 -m pytest --collect-only -q tests/test_readers.py 2>/dev/null | grep -c '::')" = 9`
- Run: `python3 -c "import sys; sys.path.insert(0,'skills/ultralearn/scripts'); import _readers as r; names=sorted(n for n in dir(r) if not n.startswith('_') and (n.isupper() or getattr(getattr(r,n),'__module__',None)=='_readers')); assert names==['SLICE_KEYWORDS','SLICE_TURN_MAX','block_text','collapse_timeline','engine_epoch_at','iter_blocks_indexed','records','release_timeline'], names"`
- Run: `! grep -q 'test_harvest_runs.py' tests/test_ultralearn_swallows.py && grep -q '"tests/test_readers.py", "tests/test_fleet_slice.py",' tests/test_ultralearn_swallows.py && grep -q '"tests/test_merge_ledger.py"\]' tests/test_ultralearn_swallows.py && grep -q 'NOT_YET_SWEPT = frozenset({"harvest_fleet_runs.py"})' tests/test_ultralearn_swallows.py && test "$(git diff --numstat 108a2c752daa6d1ad351e884538fe7d668a0b172 -- tests/test_ultralearn_swallows.py | cut -f1,2)" = "$(printf '1\t1')"`
- Run: `! grep -q 'harvest_runs.py' skills/ultralearn/SKILL.md && ! grep -q 'tool_result' skills/ultralearn/SKILL.md && ! grep -q '\.claude/projects' skills/ultralearn/SKILL.md && ! grep -q -- '--remote' skills/ultralearn/SKILL.md && grep -q 'harvest_fleet_runs.py' skills/ultralearn/SKILL.md && grep -q 'events.jsonl' skills/ultralearn/SKILL.md && grep -q -- '--evidence <owner>/<repo> --run <N>' skills/ultralearn/SKILL.md && grep -q 'lru_cache' skills/ultralearn/scripts/_readers.py && python3 -m pytest -q tests/test_ultralearn_docs.py tests/test_fleet_slice.py tests/test_harvest_fleet_runs.py tests/test_readers.py tests/test_ultralearn_swallows.py`
- Legs: (a) the second Run: exits non-zero unless the module's public names are exactly the
  eight, so an extra public helper or a missing reader fails it; `tests/test_readers.py`
  asserts `engine_epoch_at` on a bare timestamp, a foreign cache version and an unknown
  timestamp, the head-version dating, and both `collapse_timeline` cases, plus `records`
  skipping one unparseable line among three, `block_text` flattening a nested `tool_result`,
  and `iter_blocks_indexed` yielding `(0, record, {"type": "text", "text": …})` for a
  string-content record [M1, M3]; (b) the first Run: exits non-zero if either deleted file
  survives, if any file under `skills/` or `tests/` still imports `harvest_runs`, if either
  consumer lacks a top-level `_readers` import, if either consumer still defines any of the
  eight reader names itself (the `^def`/`^SLICE_` sweep — a duplicate copy fails it), if any of
  the slicer's five names or the harvester's `engine_epoch_at` is not referred to through
  `_readers` (a stray import with local copies fails the per-name grep), if `tests/test_fleet_slice.py` differs from BASE by a byte, or if
  `tests/test_readers.py` collects other than nine [M2, M3, M4]; (c) the third Run: exits non-zero if the swallows test still names
  `tests/test_harvest_runs.py`, if the re-pointed line is not exactly `"tests/test_readers.py",
  "tests/test_fleet_slice.py",` followed by the `"tests/test_merge_ledger.py"]` closing, if the `NOT_YET_SWEPT` line changed,
  or if the file's diff against BASE is anything other than one line added and one removed
  [M5]; (d) the fourth Run: exits non-zero if the skill still contains `harvest_runs.py`,
  `tool_result`, `.claude/projects` or `--remote`, if it no longer names the fleet harvester,
  its corpus or the `--evidence <owner>/<repo> --run <N>` usage, if `lru_cache` is absent from
  the readers module, or if the docs pin, the slice tests, the fleet-harvester tests (with
  their monkeypatch re-pointed), the reader tests or the swallows file fail [M1, M4, M6].

**Stale-if:**
- path-absent: `skills/ultralearn/scripts/_outcome.py`
- path-absent: `tests/test_harvest_evidence.py`
- issue-closed: #605
