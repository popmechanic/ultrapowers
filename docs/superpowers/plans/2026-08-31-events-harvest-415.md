# Fleet Events Harvest (#415) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ultralearn a second harvester that turns a One Driver fleet run's
evidence directory into the same `bundle.json` + `slice.md` the reader lenses
already consume, so post-0.3.0 runs stop being invisible to the sensor.

**Architecture:** A **sibling** script, not an extension. `harvest_runs.py` detects
runs by a `Workflow` tool_result and scans `~/.claude/projects`; that tool was
deleted in PR #434 and fleet runs execute in sandboxes, so the Workflow-era path
can never see them. It stays **frozen** (it still correctly harvests runs 21–23 and
sequential drains). The new path traverses a fleet run directory
(`events.jsonl`, `report.json`, `gate-receipt.json`, `claude/projects/`) and writes
the **same bundle shape into the same cache** — `~/.claude/ultralearn/runs/<runId>/`
— because the bundle is the interface: `merge_ledger.bundle_lookups` and the five
reading lenses then work untouched. Shared readers (`_records`, `slice_transcript`,
release-timeline epoch resolution) are reused, not reimplemented.

**Tech Stack:** Python 3 standard library only, pytest. No new dependencies.

**Spec:** `.claude/ultrapowers/handoffs/2026-08-31-run32-reconnect-the-sensor.md`
(the verified findings this plan is written from) and GitHub issue #415.

## Global Constraints

- **Python standard library only.** No new entries in any requirements file, no
  third-party imports. A distributed plugin must need no API key and no install
  step: **no direct Anthropic API calls, no `anthropic` SDK, no
  `ANTHROPIC_API_KEY`** in any file this plan touches.
- **The harvester contract is read-only and advisory.** Copied verbatim from
  `skills/ultralearn/scripts/harvest_runs.py:1-4`: *"Read-only and advisory:
  malformed or missing input is skipped with a diagnostic, never raised."* Every
  new reader in this plan obeys it — a truncated `events.jsonl`, a missing
  `report.json`, an unreadable transcript produces a skip plus a `stderr`
  diagnostic and a bundle without that field, never a traceback.
- **The Workflow-era path is frozen, with one named exception.** No change to
  `harvest_runs.py` may alter what an existing pre-cutover session harvests.
  Task 2 is the only task that edits that file: its `engine_epoch_at` extraction
  is behavior-preserving, and its `ENGINE_ROLES` change is **strictly additive**
  — no member is ever removed, because removing one can reclassify an
  already-harvested historical session from `engine` to `meta`. The single
  licensed exception is Task 2(c), the `_release_timeline` de-duplication fix,
  which changes a session's resolved epoch **only** where a version string
  recurred in this repo's release history — the defect itself.
- **The verification periphery is FROZEN (0.1.0).** No task changes
  `gate_check.py`, `ultra_gate.py`, `run_acceptance.sh`, or the compiler's
  diagnostic vocabulary.
- **Events sort by `id`, never by `ts`.** `fleet/run-waves.mjs:272-284` documents
  the invariant: id and ts come from one `Date.now()`, and when the monotonic
  clamp fires on a backwards clock step *"the id stays the sort key, ts stays the
  wall clock"*. Any code in this plan that orders events orders them by `id`.
- **Concurrency-safe tests.** Same-wave suites run at the same time on one
  machine. Every test builds its fixtures under pytest's `tmp_path`; no test reads
  or writes a shared on-disk fixture directory, a fixed temp path, or a network
  port.
- **A check that cannot fail is not a check.** Every test added here must have
  been observed to fail before its implementation exists (the TDD steps make this
  explicit). Any test whose assertion would hold against an empty implementation
  is a plan violation.

**Acceptance:** suite — every deliverable is a pure Python reader with a
deterministic output shape; the committed pytest suite plus per-task review is the
whole verification. The one thing the suite cannot reach — that the shapes match
the *real* eight-run corpus on the orchestrator — is an operator smoke probe
below, run post-merge against `/tmp/fleet-orch-live-evidence/sandbox-logs/`.

---

### Task 1: The event-log reader

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultralearn/scripts/fleet_events.py`
- Test: `tests/test_fleet_events.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `read_events(run_dir) -> list[dict]` — parse `<run_dir>/events.jsonl`, skip
    unparseable lines, return records sorted by `id`.
  - `summarize_events(events) -> dict` — the `events` bundle field (shape pinned
    in Step 1 below).
  - `render_timeline(events) -> str` — one line per event, ULID-prefixed.
  - `EVENT_KINDS: frozenset[str]` — the engine's emitted vocabulary.

**Parallelization rationale:** the event log is a self-contained input format with
no dependency on the cache, the slice builder, or the network. Fixing its output
shape up front is the contract every downstream task builds against, so Tasks 3
and 5 need not wait for it. A good engineer separates *parsing the log* from
*assembling a bundle* regardless of parallelism — the summary is the thing that
gets tested against real runs, and mixing it into the assembler would bury it.

The vocabulary is fixed by the engine source, not guessed. From
`fleet/run-worker.mjs:468-552`, `fleet/run-main.mjs:358-548` and
`fleet/run-waves.mjs:215-293`:

~~~
run:open  engine:log  engine:phase  worker:start  worker:end  worker:refused
run:fatal  capture:error  driver:stage  driver:fail  driver:auth
driver:ack-decision  driver:approved
~~~

Every record additionally carries `id` (a ULID) and `ts` (epoch ms), stamped last
by `makeEventLog` so an envelope can never clobber them.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_fleet_events.py`. The helper writes a miniature but
structurally faithful run — ULIDs are lexically ordered strings, so short
ascending literals stand in for real ones:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import fleet_events  # noqa: E402

T0 = 1788130000000


def _ev(i, ts_offset_ms, **fields):
    """One event record: id is the sort key, ts is the wall clock."""
    return dict(fields, id=f"01AAA{i:03d}", ts=T0 + ts_offset_ms)


EVENTS = [
    _ev(1, 0, kind="run:open", runId="run-30", base="", source="fleet/run-main.mjs"),
    _ev(2, 1000, kind="driver:stage", stage="provision", detail="BASE 3fa4936"),
    _ev(3, 1500, kind="driver:auth", authMethod="oauth_token",
        apiKeySource=None, subscriptionType=None),
    _ev(4, 2000, kind="engine:phase", phase="Setup"),
    _ev(5, 2500, kind="engine:log", line="setup: baseline green"),
    _ev(6, 3000, kind="engine:phase", phase="Wave 1"),
    _ev(7, 3000, kind="worker:start", label="impl:1", role="implementer",
        sessionId="sess-1", cwd="/clones/task-1", model="opus"),
    _ev(8, 3000, kind="worker:start", label="impl:2", role="implementer",
        sessionId="sess-2", cwd="/clones/task-2", model="opus"),
    _ev(9, 63000, kind="worker:end", label="impl:1", role="implementer",
        sessionId="sess-1", exitCode=0, timedOut=False, outcome="ok",
        class_="success", status=None,
        meter={"input": 30, "output": 6463, "cacheRead": 452825,
               "cacheCreation": 20113, "costUsd": 0.5913, "models": ["claude-opus-5"]}),
    _ev(10, 70000, kind="worker:refused", label="impl:3", why="budget-already-tripped"),
    _ev(11, 80000, kind="driver:ack-decision", approve=False,
        reason="non-pre-authorized ack(s): deferred:manual"),
    _ev(12, 80000, kind="driver:fail", verdict="needs-ack",
        detail="non-pre-authorized ack(s): deferred:manual"),
]
# `class` is a Python keyword; the engine emits it as a plain JSON key.
for e in EVENTS:
    if "class_" in e:
        e["class"] = e.pop("class_")


def _write_log(run_dir, events=None):
    run_dir.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(e) for e in (EVENTS if events is None else events)]
    (run_dir / "events.jsonl").write_text("\n".join(lines) + "\n")
    return run_dir


def test_read_events_sorts_by_id_not_ts(tmp_path):
    run_dir = _write_log(tmp_path / "run-run-30", list(reversed(EVENTS)))
    got = fleet_events.read_events(run_dir)
    assert [e["id"] for e in got] == [e["id"] for e in EVENTS]


def test_read_events_skips_unparseable_lines(tmp_path):
    run_dir = tmp_path / "run-run-30"
    run_dir.mkdir(parents=True)
    (run_dir / "events.jsonl").write_text(
        json.dumps(EVENTS[0]) + "\n{ this is not json\n\n" + json.dumps(EVENTS[1]) + "\n")
    got = fleet_events.read_events(run_dir)
    assert [e["id"] for e in got] == ["01AAA001", "01AAA002"]


def test_read_events_missing_file_returns_empty(tmp_path):
    assert fleet_events.read_events(tmp_path / "nope") == []


def test_summarize_top_level(tmp_path):
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    assert s["runId"] == "run-30"
    assert s["openedAt"] == T0
    assert s["endedAt"] == T0 + 80000
    assert s["wallSec"] == 80.0
    assert s["authMethod"] == "oauth_token"
    assert s["counts"]["worker:start"] == 2
    assert s["counts"]["worker:end"] == 1
    assert s["eventCount"] == 12


def test_summarize_phases_and_stages(tmp_path):
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    assert [p["phase"] for p in s["phases"]] == ["Setup", "Wave 1"]
    assert s["phases"][0]["id"] == "01AAA004"
    assert [g["stage"] for g in s["stages"]] == ["provision"]
    assert s["stages"][0]["detail"] == "BASE 3fa4936"


def test_summarize_pairs_workers_and_carries_the_meter(tmp_path):
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    by_label = {w["label"]: w for w in s["workers"]}
    assert set(by_label) == {"impl:1", "impl:2", "impl:3"}
    done = by_label["impl:1"]
    assert done["role"] == "implementer"
    assert done["sessionId"] == "sess-1"
    assert done["startId"] == "01AAA007"
    assert done["endId"] == "01AAA009"
    assert done["wallSec"] == 60.0
    assert done["class"] == "success"
    assert done["exitCode"] == 0
    assert done["meter"]["output"] == 6463
    assert done["meter"]["costUsd"] == 0.5913


def test_summarize_marks_unpaired_and_refused_workers(tmp_path):
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    by_label = {w["label"]: w for w in s["workers"]}
    # started, never ended — the run was cut off mid-wave
    assert by_label["impl:2"]["endId"] is None
    assert by_label["impl:2"]["wallSec"] is None
    assert s["unpaired"] == ["impl:2"]
    # refused before it ever started
    assert by_label["impl:3"]["refused"] == "budget-already-tripped"
    assert by_label["impl:3"]["startId"] is None


def test_summarize_terminal_and_ack_decision(tmp_path):
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    assert s["ackDecision"]["approve"] is False
    assert s["ackDecision"]["reason"] == "non-pre-authorized ack(s): deferred:manual"
    assert s["terminal"]["kind"] == "driver:fail"
    assert s["terminal"]["verdict"] == "needs-ack"


def test_summarize_terminal_on_an_approved_run(tmp_path):
    events = EVENTS[:9] + [
        _ev(20, 90000, kind="driver:approved", stamp="run-30",
            integrationBranch="ultra/integration-run-30")]
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30", events)))
    assert s["terminal"]["kind"] == "driver:approved"
    assert s["terminal"]["integrationBranch"] == "ultra/integration-run-30"
    assert s["ackDecision"] is None


def test_summarize_empty_log_is_advisory_not_fatal():
    s = fleet_events.summarize_events([])
    assert s["runId"] is None
    assert s["workers"] == []
    assert s["wallSec"] is None
    assert s["terminal"] is None


def test_render_timeline_line_shape(tmp_path):
    md = fleet_events.render_timeline(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    lines = md.splitlines()
    assert lines[0] == "01AAA001  +0.0s  run:open  runId=run-30"
    assert lines[3] == "01AAA004  +2.0s  engine:phase  Setup"
    assert "01AAA007  +3.0s  worker:start  impl:1 role=implementer model=opus" in md
    assert "01AAA012  +80.0s  driver:fail  needs-ack — non-pre-authorized" in md
    assert len(lines) == 12


def test_render_timeline_caps_a_long_summary(tmp_path):
    long_line = "x" * 500
    run_dir = _write_log(tmp_path / "run-run-30",
                         [EVENTS[0], _ev(9, 10, kind="engine:log", line=long_line)])
    md = fleet_events.render_timeline(fleet_events.read_events(run_dir))
    tail = md.splitlines()[1]
    assert tail.endswith("…")
    assert len(tail) < 260


def test_render_timeline_renders_an_unknown_kind(tmp_path):
    run_dir = _write_log(tmp_path / "run-run-30",
                         [EVENTS[0], _ev(9, 10, kind="worker:teleported", label="x")])
    md = fleet_events.render_timeline(fleet_events.read_events(run_dir))
    assert "worker:teleported" in md
    assert '"label": "x"' in md or "label=x" in md


def test_event_kinds_matches_the_engine_vocabulary():
    assert fleet_events.EVENT_KINDS == frozenset({
        "run:open", "engine:log", "engine:phase", "worker:start", "worker:end",
        "worker:refused", "run:fatal", "capture:error", "driver:stage",
        "driver:fail", "driver:auth", "driver:ack-decision", "driver:approved"})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_fleet_events.py -v`
Expected: FAIL — collection error, `ModuleNotFoundError: No module named 'fleet_events'`.

- [ ] **Step 3: Write the implementation**

Create `skills/ultralearn/scripts/fleet_events.py`. Module docstring restates the
advisory contract. Implementation notes, in order:

- `EVENT_KINDS` — the frozenset literal asserted in the test.
- `read_events(run_dir)`: `Path(run_dir) / "events.jsonl"`; on `OSError` return
  `[]`; iterate lines, `json.loads` each inside `try/except
  json.JSONDecodeError` and skip failures; keep only `dict` records; return
  `sorted(records, key=lambda e: str(e.get("id") or ""))`.
- `summarize_events(events)`: single pass. Track `counts` with
  `collections.Counter` over `kind`. `openedAt` = `ts` of the first `run:open`
  (else the first record's `ts`, else `None`); `endedAt` = the last record's
  `ts`; `wallSec` = `round((endedAt - openedAt) / 1000, 1)` when both are
  present else `None`. `runId` from `run:open`. `authMethod` from the first
  `driver:auth` that carries the key. `phases` / `stages` are lists of
  `{phase|stage, detail, id, ts}`. Workers accumulate into an ordered dict keyed
  by `label`, first-seen order: a `worker:start` fills
  `role`, `sessionId`, `cwd`, `model`, `startId` and `startTs`; a `worker:end` fills
  `endId`, `endTs`, `exitCode`, `timedOut`, `outcome`, `class`, `status` and `meter` and, when
  `startTs` is known, `wallSec`; a `worker:refused` fills `refused` (its `why`)
  and `refusedDetail`. Every worker record carries all keys, defaulting to
  `None`, so consumers never `KeyError`. `unpaired` = labels with a `startId`
  and no `endId`, in first-seen order. `ackDecision` = the last
  `driver:ack-decision` (or `None`). `terminal` = the last record whose kind is
  `driver:approved` or `driver:fail` (or `None`). `eventCount` = `len(events)`.
  `fatals` = the `run:fatal` and `capture:error` records verbatim.
- `render_timeline(events)`: `openedAt` from the first `run:open` (else the first
  record's `ts`). One line per event, joined with `\n`:
  `f"{eid}  +{rel:.1f}s  {kind}  {summary}"` where `rel = (ts - openedAt) / 1000`
  (`0.0` when either is missing). `summary` is a per-kind one-liner —

  ~~~
  run:open           runId=<runId>
  driver:stage       <stage> — <detail>          (the em-dash half omitted when detail is absent)
  driver:auth        authMethod=<authMethod>     (else <detail>)
  driver:ack-decision approve=<approve> <reason>
  driver:approved    stamp=<stamp> branch=<integrationBranch>
  driver:fail        <verdict> — <detail>
  engine:phase       <phase>
  engine:log         <line>
  worker:start       <label> role=<role> model=<model> session=<sessionId>
  worker:end         <label> class=<class> exit=<exitCode> out=<meter.output>tok cost=$<meter.costUsd>
  worker:refused     <label> why=<why> <detail>
  run:fatal          <label> <detail>
  capture:error      <label> <detail>
  ~~~

  An unrecognized kind renders `json.dumps` of the record minus `kind`, `id`,
  `ts`. Every summary is then truncated to 200 characters with a trailing `…`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_fleet_events.py -v`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/fleet_events.py tests/test_fleet_events.py
git commit -m "feat(ultralearn): read and summarize a fleet run's event log (#415)"
```

---

### Task 2: Fix the epoch reader, and the role vocabulary the cutover left behind

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

Three edit sites in that file: `ENGINE_ROLES` at line 24, `_release_timeline`
at lines 902-940, and `_engine_epoch` at lines 980-1010.

**Interfaces:**
- Consumes: nothing.
- Produces: `engine_epoch_at(ts, origin, timeline=None, cache_version=None) -> dict`
  in `harvest_runs`, returning `{"epoch": str|None, "asOf": ts, "basis": str}` —
  the same dict `_engine_epoch` returns today, resolved from a timestamp instead
  of a transcript. A fleet run has no transcript to date itself from; its
  `run:open` event carries the clock.
- Produces: `collapse_timeline(rows) -> tuple[tuple[str, str], ...]` in
  `harvest_runs` — the release-timeline de-duplication, extracted so it can be
  tested without git.

Three fixes to the historical module.

**(a) `engine_epoch_at`.** `_engine_epoch(records, origin, timeline, cache_version)`
today calls `_run_timestamp(records)` and then does date resolution against the
release timeline. Split the second half out so a caller holding only a timestamp
can reach it. `_engine_epoch` keeps its exact signature and behavior and becomes a
two-line wrapper.

**(b) `ENGINE_ROLES`.** It reads
`{"setup", "merge", "review", "reconcile", "resolver", "integration"}`. `merge` was
deleted at 0.3.0 and `implementer`, `critic`, `fix`, `reviewer` were never in it,
so `classify_session_kind` mis-classifies runs it should recognize. The fix is a
**union**: add the missing roles, remove nothing. Removing `merge` (or any other
member) would reclassify an already-harvested historical session from `engine` to
`meta` — a silent rewrite of the ledger's own provenance — which the Global
Constraints forbid.

**(c) `_release_timeline` shadows a recurring version — and it is shadowing
`0.3.0` right now.** The timeline is built from every commit that touched
`.claude-plugin/plugin.json`, sorted oldest-first, then de-duplicated by *keeping
each version's first appearance*. This repo shipped a **0.3.0 on 2026-06-10**,
before the version scheme reset to `0.0.x`/`0.1.x`. So today's 0.3.0 — the One
Driver cutover, committed `543714c` on 2026-08-29 — is discarded as a duplicate,
and the newest entry the timeline holds is `0.2.26` (2026-08-28). Verified:

~~~
$ python3 -c "import sys; sys.path.insert(0,'skills/ultralearn/scripts'); import harvest_runs as h; print(h._release_timeline()[-1])"
('2026-08-28T10:52:30-07:00', '0.2.26')

$ python3 -c "import sys; sys.path.insert(0,'skills/ultralearn/scripts'); import harvest_runs as h; print([r for r in h._release_timeline() if r[1].startswith('0.3')])"
[('2026-06-10T20:46:07-07:00', '0.3.0'), ('2026-06-10T20:53:11-07:00', '0.3.1')]
~~~

Every post-cutover run would therefore be stamped `engineVersion.epoch =
"0.2.26"` — the wrong era, on the exact field `merge_ledger.bundle_lookups`
reads to tell eras apart, which is the one distinction the sense pass over runs
24–31 exists to make.

The fix is to collapse **consecutive runs** of the same version instead of
globally uniquifying: a version that legitimately recurs after a reset keeps
both entries, and a version repeated across adjacent commits still collapses to
one. Extract that as `collapse_timeline(rows)`.

This is the plan's one licensed departure from *"the Workflow-era path is
frozen"*, and it is narrow: the walk in `engine_epoch_at` picks the same entry as
before for every date, **except** where a version recurred — which is precisely
the bug. It changes no other historical session's epoch.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_harvest_runs.py`:

```python
def test_engine_roles_covers_the_one_driver_roles():
    # fleet/roles/*.md at 0.3.0 plus the labels run-worker.mjs emits.
    assert {"implementer", "critic", "fix", "reviewer", "reconcile", "resolver"} \
        <= harvest_runs.ENGINE_ROLES


def test_engine_roles_never_drops_a_historical_member():
    # Removing one reclassifies an already-harvested pre-cutover session
    # from "engine" to "meta". Additive only.
    assert {"setup", "merge", "review", "reconcile", "resolver", "integration"} \
        <= harvest_runs.ENGINE_ROLES


def test_classify_session_kind_recognizes_an_implementer_only_run():
    audit = {"agents": [{"role": "implementer"}, {"role": "reviewer"}]}
    assert harvest_runs.classify_session_kind(
        [], audit, None, False, has_registered_launch=False) == "engine"


def test_engine_epoch_at_resolves_from_a_bare_timestamp():
    timeline = [("2026-08-01T00:00:00Z", "0.2.0"), ("2026-08-29T00:00:00Z", "0.3.0")]
    got = harvest_runs.engine_epoch_at("2026-08-30T12:00:00Z", "home", timeline)
    assert got == {"epoch": "0.3.0", "asOf": "2026-08-30T12:00:00Z",
                   "basis": "home-repo-date"}


def test_engine_epoch_at_honors_a_foreign_cache_version():
    got = harvest_runs.engine_epoch_at("2026-08-30T12:00:00Z", "foreign", [],
                                       cache_version="0.2.26")
    assert got["epoch"] == "0.2.26"
    assert got["basis"] == "plugin-cache-path"


def test_engine_epoch_at_unknown_timestamp_is_advisory():
    got = harvest_runs.engine_epoch_at(None, "home", [("2026-08-01T00:00:00Z", "0.2.0")])
    assert got["epoch"] is None
    assert got["basis"] == "unknown"


def test_collapse_timeline_collapses_adjacent_duplicates():
    rows = [("2026-06-10T00:00:00Z", "0.3.0"), ("2026-06-10T01:00:00Z", "0.3.0"),
            ("2026-07-01T00:00:00Z", "0.1.0")]
    assert harvest_runs.collapse_timeline(rows) == (
        ("2026-06-10T00:00:00Z", "0.3.0"), ("2026-07-01T00:00:00Z", "0.1.0"))


def test_collapse_timeline_keeps_a_version_that_recurs_after_a_reset():
    # This repo shipped 0.3.0 twice: 2026-06-10, then again at the One Driver
    # cutover. Uniquifying globally discards the second and dates every
    # post-cutover run to 0.2.26.
    rows = [("2026-06-10T00:00:00Z", "0.3.0"), ("2026-07-01T00:00:00Z", "0.1.0"),
            ("2026-08-28T00:00:00Z", "0.2.26"), ("2026-08-29T00:00:00Z", "0.3.0")]
    assert harvest_runs.collapse_timeline(rows)[-1] == ("2026-08-29T00:00:00Z", "0.3.0")


def test_a_run_today_dates_to_the_head_plugin_version():
    # Non-self-referential: the expected value comes from git, not from the
    # function under test. Fails today, returning 0.2.26.
    import json as _json
    import subprocess as _sp
    from datetime import datetime as _dt, timezone as _tz
    root = harvest_runs._repo_root()
    head = _json.loads(_sp.run(
        ["git", "-C", str(root), "show", "HEAD:.claude-plugin/plugin.json"],
        capture_output=True, text=True, check=True).stdout)["version"]
    now = _dt.now(_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert harvest_runs.engine_epoch_at(now, "home")["epoch"] == head
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -k "engine_roles or engine_epoch_at or implementer_only or collapse_timeline or run_today" -v`
Expected: FAIL — `AttributeError: module 'harvest_runs' has no attribute
'engine_epoch_at'` (and `collapse_timeline`) on the epoch tests, assertion
failures on the role tests (`implementer` is absent from `ENGINE_ROLES`), and
`test_a_run_today_dates_to_the_head_plugin_version` failing
`assert '0.2.26' == '0.3.0'`.

- [ ] **Step 3: Write the implementation**

Replace line 24 with the union, and carry the reason in the comment:

```python
# One Driver (0.3.0) renamed the cast: `merge` is gone and implementer/critic/
# fix/reviewer arrived. This set is ADDITIVE ONLY — dropping a member would
# reclassify an already-harvested pre-cutover session from engine to meta.
ENGINE_ROLES = {"setup", "merge", "review", "reconcile", "resolver", "integration",
                "implementer", "critic", "fix", "reviewer"}
```

Next, replace `_release_timeline`'s de-duplication. Today it reads:

```python
        seen, timeline = set(), []
        for dt, ver in rows:
            if ver not in seen:           # keep each version's first appearance
                seen.add(ver)
                timeline.append((dt, ver))
        return tuple(timeline)
```

Replace those five lines with a call to the extracted function, and add it
beside `_release_timeline`:

```python
        return collapse_timeline(rows)


def collapse_timeline(rows):
    """Collapse CONSECUTIVE runs of one version, keeping the first of each run.

    Not a global uniquify: this repo shipped 0.3.0 on 2026-06-10 and again at
    the One Driver cutover on 2026-08-29, and keeping only the first appearance
    discarded the cutover — dating every post-0.3.0 run to 0.2.26, the wrong
    era, on the field the ledger uses to tell eras apart."""
    timeline, last = [], None
    for dt, ver in rows:
        if ver != last:
            timeline.append((dt, ver))
            last = ver
    return tuple(timeline)
```

Then extract the epoch resolver. `engine_epoch_at` takes the timestamp directly
and holds the body that lives in `_engine_epoch` today from `if cache_version and
origin == "foreign":` onward — unchanged, including the `timeline is None →
_release_timeline()` default and the `basis` strings. `_engine_epoch` keeps its
docstring and signature and becomes:

```python
def _engine_epoch(records, origin, timeline=None, cache_version=None):
    """<existing docstring, unchanged>"""
    return engine_epoch_at(_run_timestamp(records), origin, timeline, cache_version)
```

- [ ] **Step 4: Run the full harvest suite to verify nothing historical moved**

Run: `python3 -m pytest tests/test_harvest_runs.py tests/test_merge_ledger.py -v`
Expected: PASS — the new tests plus every pre-existing test, unchanged.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "fix(ultralearn): unshadow the recurring 0.3.0 epoch, share the reader, teach ENGINE_ROLES the 0.3.0 cast (#415)"
```

---

### Task 3: The per-worker slice builder

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultralearn/scripts/fleet_slice.py`
- Test: `tests/test_fleet_slice.py`

**Interfaces:**
- Consumes: `harvest_runs._records(session_path) -> list[dict]` and
  `harvest_runs.slice_transcript(records, terminus=None) -> str` — both exist at
  BASE, unchanged by this plan.
- Produces:
  - `WORKER_BUDGET: int = 12000`
  - `find_transcript(projects_root, session_id) -> Path | None`
  - `worker_slice(transcript_path, budget=WORKER_BUDGET) -> str`
  - `build_slice(timeline_md, workers, projects_root, budget=WORKER_BUDGET) -> str`
    — `workers` is a list of plain dicts carrying at least `label`, `role`,
    `sessionId`.

**Parallelization rationale:** `build_slice` takes the timeline as a **string**
and the workers as **plain dicts**, so it imports nothing from `fleet_events` and
builds against the contract instead of the code. That is also the better design
independent of parallelism: a slice builder that knows how to parse an event log
is a slice builder you cannot test without one.

The budget is not arbitrary. Measured against run-30's real bundle: 14 worker
transcripts, `slice_transcript` output totalling **564,293 characters** — roughly
140k tokens, far past what one reader should carry, and there are eight
post-cutover runs. A 12,000-character per-worker budget brings one run to ~160k
characters (~40k tokens), which one reader carries comfortably. Head 8,000 + tail
4,000: an implementer's brief is at the top and its conclusion is at the bottom;
the middle is the part a lens least often needs.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_fleet_slice.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import fleet_slice  # noqa: E402


def _write_transcript(projects_root, slug, session_id, turns):
    d = projects_root / slug
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{session_id}.jsonl"
    p.write_text("\n".join(
        json.dumps({"type": t, "message": {"content": [{"type": "text", "text": txt}]}})
        for t, txt in turns) + "\n")
    return p


def test_find_transcript_locates_a_session_under_any_slug(tmp_path):
    root = tmp_path / "projects"
    _write_transcript(root, "-home-exedev-clones-task-1", "sess-1", [("user", "hi")])
    assert fleet_slice.find_transcript(root, "sess-1").name == "sess-1.jsonl"
    assert fleet_slice.find_transcript(root, "sess-nope") is None
    assert fleet_slice.find_transcript(tmp_path / "gone", "sess-1") is None


def test_worker_slice_under_budget_is_returned_whole(tmp_path):
    p = _write_transcript(tmp_path / "projects", "slug", "s",
                          [("user", "run the wave gate please")])
    out = fleet_slice.worker_slice(p, budget=4000)
    assert "run the wave gate please" in out
    assert "elided" not in out


def test_worker_slice_over_budget_keeps_head_and_tail(tmp_path):
    head, middle, tail = "HEADMARK", "m" * 40000, "TAILMARK"
    p = _write_transcript(tmp_path / "projects", "slug", "s",
                          [("user", head), ("user", middle), ("user", tail)])
    out = fleet_slice.worker_slice(p, budget=1200)
    assert head in out
    assert tail in out
    assert "…[elided " in out
    assert len(out) < 1600


def test_worker_slice_of_an_unreadable_file_is_advisory(tmp_path):
    assert fleet_slice.worker_slice(tmp_path / "missing.jsonl") == ""


def test_build_slice_sections_workers_in_order(tmp_path):
    root = tmp_path / "projects"
    _write_transcript(root, "-clones-task-1", "sess-1", [("user", "first worker gate")])
    _write_transcript(root, "-clones-integration", "sess-2", [("user", "second worker gate")])
    workers = [
        {"label": "impl:1", "role": "implementer", "sessionId": "sess-1"},
        {"label": "review:1:1", "role": "reviewer", "sessionId": "sess-2"},
    ]
    md = fleet_slice.build_slice("01AAA001  +0.0s  run:open  runId=run-30",
                                 workers, root)
    assert md.index("## Event timeline") < md.index("## impl:1")
    assert md.index("## impl:1") < md.index("## review:1:1")
    assert "## impl:1 (implementer, session sess-1)" in md
    assert "first worker gate" in md
    assert "second worker gate" in md


def test_build_slice_names_a_worker_with_no_transcript(tmp_path):
    root = tmp_path / "projects"
    root.mkdir()
    md = fleet_slice.build_slice("tl", [{"label": "impl:9", "role": "implementer",
                                         "sessionId": "gone"}], root)
    assert "## impl:9 (implementer, session gone)" in md
    assert "_no transcript found_" in md


def test_build_slice_with_no_workers_still_carries_the_timeline(tmp_path):
    md = fleet_slice.build_slice("01AAA001  +0.0s  run:open  runId=run-30", [],
                                 tmp_path / "projects")
    assert "## Event timeline" in md
    assert "runId=run-30" in md
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_fleet_slice.py -v`
Expected: FAIL — collection error, `ModuleNotFoundError: No module named 'fleet_slice'`.

- [ ] **Step 3: Write the implementation**

Create `skills/ultralearn/scripts/fleet_slice.py`. It puts
`skills/ultralearn/scripts` on `sys.path` the same way `harvest_runs.py` does for
`audit_run`, then `import harvest_runs`. Implementation notes:

- `find_transcript(projects_root, session_id)`: return the first match of
  `Path(projects_root).glob(f"*/{session_id}.jsonl")`, `None` on no match or
  `OSError`.
- `worker_slice(transcript_path, budget)`: `harvest_runs._records(path)` inside
  `try/except OSError` returning `""`; `harvest_runs.slice_transcript(records)`
  (no `terminus` — the approved-tail extension is a Workflow-session concept);
  if the result is within `budget`, return it; otherwise return
  `text[:head] + f"\n\n…[elided {n} chars]…\n\n" + text[-tail:]` with
  `head = budget * 2 // 3`, `tail = budget - head`, and `n` the elided count.
- `build_slice(timeline_md, workers, projects_root, budget)`: `## Event timeline`
  section holding `timeline_md` in a fenced block, then one
  `## <label> (<role>, session <sessionId>)` section per worker in list order,
  each holding its `worker_slice` — or the literal `_no transcript found_` when
  `find_transcript` returns `None` or the slice is empty. Join with blank lines.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_fleet_slice.py -v`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/fleet_slice.py tests/test_fleet_slice.py
git commit -m "feat(ultralearn): budgeted per-worker slice builder for fleet runs (#415)"
```

---

### Task 4: Pull evidence bundles from the orchestrator

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultralearn/scripts/fleet_fetch.py`
- Test: `tests/test_fleet_fetch.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULT_REMOTE_ROOT: str = "/tmp/fleet-orch-live-evidence/sandbox-logs"`
  - `list_remote_bundles(host, remote_root=DEFAULT_REMOTE_ROOT) -> list[str]` —
    the `fleet-run-<n>-<stamp>` directory names present on `host`.
  - `fetch_bundles(host, dest, remote_root=DEFAULT_REMOTE_ROOT, run_ids=None) -> list[Path]`
    — `scp` each matching bundle's `sandbox-logs.tgz` into
    `dest/<bundle-name>/sandbox-logs.tgz`, returning the local paths.

**Parallelization rationale:** the network fetch is a separate concern from
bundle assembly and shares no state with it — it hands back local paths, which is
all Task 5 needs. Isolating it also makes it testable, which it is not once it is
tangled into the assembler: these tests stub `ssh` and `scp` on `PATH`, which only
works because nothing else in the module needs the real binaries.

The remote layout is verified, not assumed:
`/tmp/fleet-orch-live-evidence/sandbox-logs/fleet-run-30-1788131392373/sandbox-logs.tgz`,
17 bundles present, 11 MB total.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_fleet_fetch.py`. The stub binaries are written into `tmp_path`
and prepended to `PATH`, so no test touches the network or a shared path:

```python
import os
import stat
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import fleet_fetch  # noqa: E402


def _stub(bin_dir, name, body):
    bin_dir.mkdir(parents=True, exist_ok=True)
    p = bin_dir / name
    p.write_text("#!/bin/sh\n" + body)
    p.chmod(p.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return p


def _path_with(monkeypatch, bin_dir):
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")


LISTING = "fleet-run-24-100\nfleet-run-30-200\nfleet-run-31-300\n"


def test_list_remote_bundles_parses_the_listing(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", f"printf '{LISTING}'\n")
    assert fleet_fetch.list_remote_bundles("h") == [
        "fleet-run-24-100", "fleet-run-30-200", "fleet-run-31-300"]


def test_list_remote_bundles_ignores_non_bundle_lines(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", "printf 'README\\nfleet-run-30-200\\n'\n")
    assert fleet_fetch.list_remote_bundles("h") == ["fleet-run-30-200"]


def test_list_remote_bundles_on_ssh_failure_is_advisory(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", "exit 255\n")
    assert fleet_fetch.list_remote_bundles("h") == []


def test_fetch_bundles_writes_one_tarball_per_bundle(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", f"printf '{LISTING}'\n")
    # scp's last argument is the destination path; write a marker there.
    _stub(tmp_path / "bin", "scp", 'eval "dest=\\${$#}"; printf tarball > "$dest"\n')
    got = fleet_fetch.fetch_bundles("h", tmp_path / "dest")
    assert [p.parent.name for p in got] == [
        "fleet-run-24-100", "fleet-run-30-200", "fleet-run-31-300"]
    assert all(p.name == "sandbox-logs.tgz" and p.read_text() == "tarball" for p in got)


def test_fetch_bundles_filters_by_run_id(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", f"printf '{LISTING}'\n")
    _stub(tmp_path / "bin", "scp", 'eval "dest=\\${$#}"; printf tarball > "$dest"\n')
    got = fleet_fetch.fetch_bundles("h", tmp_path / "dest", run_ids=["run-30"])
    assert [p.parent.name for p in got] == ["fleet-run-30-200"]


def test_fetch_bundles_skips_a_failed_copy(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", f"printf '{LISTING}'\n")
    _stub(tmp_path / "bin", "scp", "exit 1\n")
    assert fleet_fetch.fetch_bundles("h", tmp_path / "dest") == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_fleet_fetch.py -v`
Expected: FAIL — collection error, `ModuleNotFoundError: No module named 'fleet_fetch'`.

- [ ] **Step 3: Write the implementation**

Create `skills/ultralearn/scripts/fleet_fetch.py`. Implementation notes:

- `_BUNDLE = re.compile(r"^fleet-run-(\S+?)-\d+$")` — group 1 is the run number,
  so `fleet-run-30-1788131392373` yields run id `run-30`.
- `list_remote_bundles`: `subprocess.run(["ssh", "-n", "-o", "ConnectTimeout=20",
  host, f"ls -1 {shlex.quote(remote_root)}"], capture_output=True, text=True,
  timeout=60)`; non-zero exit, `OSError`, or `subprocess.TimeoutExpired` →
  print a diagnostic to `stderr` and return `[]`; otherwise return the stdout
  lines matching `_BUNDLE`, in listing order.
- `fetch_bundles`: list, filter by `run_ids` (matching `f"run-{m.group(1)}"`),
  then per bundle `mkdir` `dest/<name>` and
  `subprocess.run(["scp", "-o", "ConnectTimeout=20",
  f"{host}:{remote_root}/{name}/sandbox-logs.tgz", str(out)], ...)` with a
  600-second timeout. A failed copy prints a diagnostic and is skipped, never
  raised. Return the successfully-copied paths.
- No shell string interpolation of untrusted input: `shlex.quote` the remote root,
  and every `subprocess.run` takes an argument list, never `shell=True`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_fleet_fetch.py -v`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/fleet_fetch.py tests/test_fleet_fetch.py
git commit -m "feat(ultralearn): fetch fleet evidence bundles from the orchestrator (#415)"
```

---

### Task 5: The sibling harvester

**Type:** implementation
**Depends-on:** 1, 2, 3, 4
**Review:** adversarial

**Files:**
- Create: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- Test: `tests/test_harvest_fleet_runs.py`

**Interfaces:**
- Consumes: `fleet_events.read_events`, `fleet_events.summarize_events`,
  `fleet_events.render_timeline` (Task 1); `harvest_runs.engine_epoch_at`
  (Task 2); `fleet_slice.build_slice`, `fleet_slice.WORKER_BUDGET` (Task 3);
  `fleet_fetch.fetch_bundles`, `fleet_fetch.DEFAULT_REMOTE_ROOT` (Task 4).
- Produces:
  - `discover_run_dirs(path, workdir) -> list[Path]`
  - `build_fleet_bundle(run_dir, cache_dir, *, origin="home", engine_version=None, budget=WORKER_BUDGET) -> Path | None`
  - `main(argv=None) -> int`

This task is `adversarial` because a silently-wrong bundle is the failure that
costs most: the reader believes it, and its findings enter
`docs/superpowers/observations/ledger.jsonl`, which is durable. Every step below
carries exact code.

**The bundle shape is the interface.** `merge_ledger.bundle_lookups` reads
`origin` (failing closed to `foreign`) and `engineVersion.epoch` from
`<cache>/runs/<runId>/bundle.json`; the five lenses read the rest. The fleet
bundle therefore carries the same keys as a Workflow-era bundle, plus `events`.
Field sources, all verified against run-30's real evidence directory:

| field | source |
|---|---|
| `runId` | `events.jsonl` `run:open.runId` → `run-30` |
| `sessionId` | `null` — a fleet run has no single orchestrator session |
| `projectSlug` | the run directory's name (`run-run-30`) |
| `origin` | the `--origin` flag, default `home` (the operator's own fleet) |
| `sessionKind` | `"engine"` — an events log plus a gate receipt IS an engine run |
| `engineVersion` | `--engine-version`, else `engine_epoch_at(run:open ts)` |
| `planPath` | `fleet-run.json` `planPath`, else `null` |
| `transcriptDir` | `<run_dir>/claude/projects` |
| `gateReport` | `gate-receipt.json`, verbatim |
| `terminus` | `gateReport.gateCheck.verdict`, else `"unknown"` |
| `truncated` | `terminus in ("NEEDS_ACK", "BLOCKED", "unknown")` |
| `audit` | folded from the event log's per-worker `meter` |
| `report` | `report.json` with `tests.output` replaced by `tests.outputTail` |
| `events` | `summarize_events(...)` |
| `planningFound` | `false` — planning happened on the laptop, not in the sandbox |
| `confineDenials` | parsed `confine-denials.jsonl`, else `[]` |

- [ ] **Step 1: Write the failing tests**

Create `tests/test_harvest_fleet_runs.py`:

```python
import json
import sys
import tarfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import harvest_fleet_runs as hfr  # noqa: E402

T0 = 1788130000000


def _ev(i, off, **f):
    return dict(f, id=f"01AAA{i:03d}", ts=T0 + off)


def _make_run_dir(root, run_id="run-30", *, with_report=True, with_gate=True):
    """A structurally faithful miniature of a real fleet run directory."""
    d = root / f"run-{run_id}"
    (d / "claude" / "projects" / "-clones-task-1").mkdir(parents=True)
    events = [
        _ev(1, 0, kind="run:open", runId=run_id, base="", source="fleet/run-main.mjs"),
        _ev(2, 1000, kind="engine:phase", phase="Wave 1"),
        _ev(3, 1000, kind="worker:start", label="impl:1", role="implementer",
            sessionId="sess-1", cwd="/clones/task-1", model="opus"),
        _ev(4, 61000, kind="worker:end", label="impl:1", role="implementer",
            sessionId="sess-1", exitCode=0, timedOut=False, outcome="ok",
            status=None,
            meter={"input": 30, "output": 6463, "cacheRead": 452825,
                   "cacheCreation": 20113, "costUsd": 0.5913,
                   "models": ["claude-opus-5"]}),
        _ev(5, 62000, kind="driver:fail", verdict="needs-ack", detail="deferred:manual"),
    ]
    events[3]["class"] = "success"
    (d / "events.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
    (d / "claude" / "projects" / "-clones-task-1" / "sess-1.jsonl").write_text(
        json.dumps({"type": "user",
                    "message": {"content": [{"type": "text",
                                             "text": "run the wave gate"}]}}) + "\n")
    if with_report:
        (d / "report.json").write_text(json.dumps({
            "integrationBranch": "ultra/integration-" + run_id,
            "baseSha": "3fa4936",
            "tests": {"command": "python3 -m pytest -n auto", "passed": True,
                      "output": "z" * 9000},
            "judgmentCalls": [{"task": "1", "detail": "chose the additive union"}],
            "deferredVerification": [],
        }))
    if with_gate:
        (d / "gate-receipt.json").write_text(json.dumps({
            "mode": "gate", "stamp": run_id,
            "branch": "ultra/integration-" + run_id,
            "gateCheck": {"verdict": "NEEDS_ACK", "checks": [], "acks": [
                {"type": "deferred:manual", "detail": "RUNBOOK claims"}]},
            "verdict": "NEEDS_ACK"}))
    (d / "confine-denials.jsonl").write_text(
        json.dumps({"tool": "Bash", "reason": "outside clone"}) + "\n")
    return d


def _tarball(tmp_path, run_dir):
    """Repack a run dir the way the orchestrator stores it."""
    tgz = tmp_path / "sandbox-logs.tgz"
    with tarfile.open(tgz, "w:gz") as tf:
        tf.add(run_dir, arcname=f"repo/.claude/ultrapowers/{run_dir.name}")
    return tgz


# ---------- discovery ----------

def test_discover_finds_a_bare_run_dir(tmp_path):
    d = _make_run_dir(tmp_path)
    assert hfr.discover_run_dirs(d, tmp_path / "w") == [d]


def test_discover_finds_run_dirs_nested_under_a_tree(tmp_path):
    root = tmp_path / "tree" / "repo" / ".claude" / "ultrapowers"
    root.mkdir(parents=True)
    a = _make_run_dir(root, "run-30")
    b = _make_run_dir(root, "run-31")
    assert hfr.discover_run_dirs(tmp_path / "tree", tmp_path / "w") == sorted([a, b])


def test_discover_unpacks_a_tarball(tmp_path):
    d = _make_run_dir(tmp_path / "src")
    got = hfr.discover_run_dirs(_tarball(tmp_path, d), tmp_path / "w")
    assert [p.name for p in got] == ["run-run-30"]
    assert (got[0] / "events.jsonl").exists()


def test_discover_skips_a_dir_with_no_event_log(tmp_path):
    (tmp_path / "run-run-21").mkdir()
    assert hfr.discover_run_dirs(tmp_path, tmp_path / "w") == []


def test_discover_of_a_missing_path_is_advisory(tmp_path):
    assert hfr.discover_run_dirs(tmp_path / "gone", tmp_path / "w") == []


# ---------- bundle assembly ----------

def _bundle(tmp_path, **kw):
    d = _make_run_dir(tmp_path, **{k: v for k, v in kw.items() if k.startswith("with_")})
    cache = tmp_path / "cache"
    out = hfr.build_fleet_bundle(
        d, cache, **{k: v for k, v in kw.items() if not k.startswith("with_")})
    return out, json.loads((out / "bundle.json").read_text())


def test_bundle_lands_in_the_cache_under_the_fleet_run_id(tmp_path):
    out, b = _bundle(tmp_path)
    assert out == tmp_path / "cache" / "runs" / "run-30"
    assert b["runId"] == "run-30"
    assert (out / "slice.md").exists()


def test_bundle_carries_the_lookup_fields_merge_ledger_reads(tmp_path):
    _, b = _bundle(tmp_path, engine_version="0.3.0")
    assert b["origin"] == "home"
    assert b["engineVersion"]["epoch"] == "0.3.0"
    assert b["engineVersion"]["basis"] == "explicit"
    assert b["sessionKind"] == "engine"


def test_bundle_dates_itself_from_the_event_log_when_no_version_is_given(tmp_path):
    _, b = _bundle(tmp_path)
    assert b["engineVersion"]["basis"] == "home-repo-date"
    assert b["engineVersion"]["asOf"].startswith("2026-")
    # T0 is 2026-08-30, after the One Driver cutover — never the shadowed 0.2.26
    # the pre-Task-2 timeline returned (see Task 2(c)).
    assert b["engineVersion"]["epoch"] == "0.3.0"


def test_bundle_terminus_comes_from_the_gate_receipt(tmp_path):
    _, b = _bundle(tmp_path)
    assert b["terminus"] == "NEEDS_ACK"
    assert b["truncated"] is True
    assert b["gateReport"]["gateCheck"]["acks"][0]["type"] == "deferred:manual"


def test_bundle_without_a_gate_receipt_is_unknown_not_a_crash(tmp_path):
    _, b = _bundle(tmp_path, with_gate=False)
    assert b["terminus"] == "unknown"
    assert b["truncated"] is True
    assert b["gateReport"] is None


def test_bundle_folds_the_audit_from_the_event_meters(tmp_path):
    _, b = _bundle(tmp_path)
    agents = b["audit"]["agents"]
    assert [a["label"] for a in agents] == ["impl:1"]
    assert agents[0]["role"] == "implementer"
    assert agents[0]["outputTokens"] == 6463
    assert agents[0]["wallSec"] == 60.0
    assert b["audit"]["totals"]["outputTokens"] == 6463
    assert b["audit"]["totals"]["costUsd"] == 0.5913
    assert b["audit"]["totals"]["agents"] == 1
    assert "meter" in b["audit"]["unitNote"]


def test_bundle_caps_the_suite_output_but_keeps_its_tail(tmp_path):
    _, b = _bundle(tmp_path)
    assert "output" not in b["report"]["tests"]
    assert len(b["report"]["tests"]["outputTail"]) <= 2000
    assert b["report"]["tests"]["passed"] is True
    assert b["report"]["judgmentCalls"][0]["detail"] == "chose the additive union"


def test_bundle_without_a_report_is_advisory(tmp_path):
    _, b = _bundle(tmp_path, with_report=False)
    assert b["report"] is None
    assert b["runId"] == "run-30"


def test_bundle_carries_the_event_summary_and_confine_denials(tmp_path):
    _, b = _bundle(tmp_path)
    assert b["events"]["runId"] == "run-30"
    assert b["events"]["counts"]["worker:end"] == 1
    assert b["events"]["terminal"]["verdict"] == "needs-ack"
    assert b["confineDenials"][0]["tool"] == "Bash"


def test_slice_carries_the_timeline_and_the_worker_transcript(tmp_path):
    out, _ = _bundle(tmp_path)
    md = (out / "slice.md").read_text()
    assert "## Event timeline" in md
    assert "01AAA001  +0.0s  run:open  runId=run-30" in md
    assert "## impl:1 (implementer, session sess-1)" in md
    assert "run the wave gate" in md


def test_a_run_dir_with_no_run_open_event_is_refused(tmp_path):
    d = _make_run_dir(tmp_path)
    (d / "events.jsonl").write_text(json.dumps(
        {"kind": "engine:phase", "phase": "Wave 1", "id": "01A", "ts": T0}) + "\n")
    assert hfr.build_fleet_bundle(d, tmp_path / "cache") is None
    assert not (tmp_path / "cache").exists()


# ---------- CLI ----------

def test_main_harvests_and_reports_the_count(tmp_path, capsys):
    _make_run_dir(tmp_path / "src")
    rc = hfr.main([str(tmp_path / "src"), "--cache", str(tmp_path / "cache")])
    assert rc == 0
    assert "1 bundle" in capsys.readouterr().out
    assert (tmp_path / "cache" / "runs" / "run-30" / "bundle.json").exists()


def test_main_is_incremental_and_force_overrides(tmp_path, capsys):
    _make_run_dir(tmp_path / "src")
    args = [str(tmp_path / "src"), "--cache", str(tmp_path / "cache")]
    hfr.main(args)
    capsys.readouterr()
    hfr.main(args)
    assert "0 bundle" in capsys.readouterr().out
    hfr.main(args + ["--force"])
    assert "1 bundle" in capsys.readouterr().out


def test_main_with_no_runs_found_is_a_clean_zero(tmp_path, capsys):
    rc = hfr.main([str(tmp_path / "empty"), "--cache", str(tmp_path / "cache")])
    assert rc == 0
    assert "0 bundle" in capsys.readouterr().out
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_harvest_fleet_runs.py -v`
Expected: FAIL — collection error, `ModuleNotFoundError: No module named
'harvest_fleet_runs'`.

- [ ] **Step 3: Write the implementation**

Create `skills/ultralearn/scripts/harvest_fleet_runs.py`:

```python
#!/usr/bin/env python3
"""ultralearn fleet harvester — turn a One Driver fleet run's evidence
directory into the same bundle the reading lenses already consume.

SIBLING of harvest_runs.py, not an extension. That module detects runs by a
`Workflow` tool_result and scans ~/.claude/projects; the Workflow tool was
deleted in PR #434 and fleet runs execute in sandboxes, so it can never see
them. It stays frozen — it still correctly harvests runs 21-23 and sequential
drains. This module shares its readers (_records, slice_transcript,
engine_epoch_at) and writes the SAME bundle shape into the SAME cache, because
the bundle is the interface: merge_ledger.bundle_lookups and the five lenses
then work untouched.

Read-only and advisory: malformed or missing input is skipped with a
diagnostic, never raised.
"""
from __future__ import annotations

import argparse
import json
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fleet_events            # noqa: E402
import fleet_fetch             # noqa: E402
import fleet_slice             # noqa: E402
import harvest_runs            # noqa: E402

SUITE_OUTPUT_TAIL = 2000       # chars of `tests.output` kept; the head is boilerplate
AUDIT_UNIT_NOTE = ("outputTokens = the worker:end meter's output field, summed "
                   "over workers (the engine's own accounting, not a transcript sum)")


def _warn(msg):
    print(f"harvest_fleet_runs: {msg}", file=sys.stderr)


def _read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        _warn(f"unreadable {path}: {exc}")
        return None


def _read_jsonl(path):
    out = []
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return out
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def discover_run_dirs(path, workdir):
    """Resolve a user-supplied path to fleet run directories.

    Accepts a bare run dir, any tree containing them, or a sandbox-logs
    tarball (unpacked under `workdir`). A run dir is exactly a directory
    holding an `events.jsonl` — pre-#421 runs (10-23) have none and are
    correctly invisible here; harvest_runs.py still owns 21-23.
    """
    path = Path(path)
    if not path.exists():
        _warn(f"no such path: {path}")
        return []
    if path.is_file():
        if not tarfile.is_tarfile(path):
            _warn(f"not a directory or tarball: {path}")
            return []
        dest = Path(workdir) / path.stem
        dest.mkdir(parents=True, exist_ok=True)
        try:
            with tarfile.open(path) as tf:
                # Refuse absolute paths and parent escapes before extracting.
                members = [m for m in tf.getmembers()
                           if not m.name.startswith("/") and ".." not in Path(m.name).parts]
                tf.extractall(dest, members=members)
        except (OSError, tarfile.TarError) as exc:
            _warn(f"cannot unpack {path}: {exc}")
            return []
        return discover_run_dirs(dest, workdir)
    if (path / "events.jsonl").is_file():
        return [path]
    return sorted(p.parent for p in path.rglob("events.jsonl") if p.is_file())


def _fold_audit(workers):
    """The audit, folded from the event log's per-worker meters. The engine's
    own accounting — no transcript re-summing, so it cannot drift from what
    the run was actually billed."""
    agents, totals = [], {"agents": 0, "inputTokens": 0, "outputTokens": 0,
                          "cacheReadTokens": 0, "cacheCreationTokens": 0, "costUsd": 0.0}
    for w in workers:
        m = w.get("meter") or {}
        agents.append({
            "label": w.get("label"), "role": w.get("role"),
            "sessionId": w.get("sessionId"), "model": w.get("model"),
            "class": w.get("class"), "exitCode": w.get("exitCode"),
            "timedOut": w.get("timedOut"), "refused": w.get("refused"),
            "wallSec": w.get("wallSec"),
            "inputTokens": m.get("input"), "outputTokens": m.get("output"),
            "cacheReadTokens": m.get("cacheRead"),
            "cacheCreationTokens": m.get("cacheCreation"),
            "costUsd": m.get("costUsd"), "models": m.get("models"),
        })
        totals["agents"] += 1
        for tk, mk in (("inputTokens", "input"), ("outputTokens", "output"),
                       ("cacheReadTokens", "cacheRead"),
                       ("cacheCreationTokens", "cacheCreation"),
                       ("costUsd", "costUsd")):
            v = m.get(mk)
            if isinstance(v, (int, float)):
                totals[tk] += v
    totals["costUsd"] = round(totals["costUsd"], 6)
    return {"agents": agents, "totals": totals, "unitNote": AUDIT_UNIT_NOTE}


def _trim_report(report):
    """report.json verbatim, minus the suite's multi-kilobyte output — whose
    head is pytest boilerplate and whose tail is the verdict a lens needs."""
    if not isinstance(report, dict):
        return None
    out = dict(report)
    tests = out.get("tests")
    if isinstance(tests, dict):
        tests = dict(tests)
        text = tests.pop("output", None)
        if isinstance(text, str):
            tests["outputTail"] = text[-SUITE_OUTPUT_TAIL:]
        out["tests"] = tests
    return out


def build_fleet_bundle(run_dir, cache_dir, *, origin="home", engine_version=None,
                       budget=fleet_slice.WORKER_BUDGET):
    """Write <cache_dir>/runs/<runId>/{bundle.json,slice.md}. Returns the
    directory, or None when the run dir carries no usable event log."""
    run_dir = Path(run_dir)
    events = fleet_events.read_events(run_dir)
    summary = fleet_events.summarize_events(events)
    run_id = summary.get("runId")
    if not run_id:
        _warn(f"{run_dir}: no run:open event — not a fleet run directory")
        return None

    gate_report = _read_json(run_dir / "gate-receipt.json") \
        if (run_dir / "gate-receipt.json").exists() else None
    terminus = "unknown"
    if isinstance(gate_report, dict):
        verdict = (gate_report.get("gateCheck") or {}).get("verdict") \
            or gate_report.get("verdict")
        if isinstance(verdict, str) and verdict:
            terminus = verdict

    fleet_run = _read_json(run_dir / "fleet-run.json") \
        if (run_dir / "fleet-run.json").exists() else None
    plan_path = (fleet_run or {}).get("planPath")

    opened = summary.get("openedAt")
    as_of = (datetime.fromtimestamp(opened / 1000, timezone.utc)
             .strftime("%Y-%m-%dT%H:%M:%SZ") if isinstance(opened, (int, float)) else None)
    if engine_version:
        engine = {"epoch": engine_version, "asOf": as_of, "basis": "explicit"}
    else:
        engine = harvest_runs.engine_epoch_at(as_of, origin)

    projects_root = run_dir / "claude" / "projects"
    bundle = {
        "runId": run_id,
        "sessionId": None,
        "projectSlug": run_dir.name,
        "origin": origin,
        "sessionKind": "engine",
        "engineVersion": engine,
        "planPath": plan_path,
        "transcriptDir": str(projects_root),
        "gateReport": gate_report,
        "terminus": terminus,
        "truncated": terminus in ("NEEDS_ACK", "BLOCKED", "unknown"),
        "audit": _fold_audit(summary.get("workers") or []),
        "report": _trim_report(_read_json(run_dir / "report.json")
                               if (run_dir / "report.json").exists() else None),
        "events": summary,
        "planningFound": False,
        "confineDenials": _read_jsonl(run_dir / "confine-denials.jsonl"),
    }

    out = Path(cache_dir).expanduser() / "runs" / run_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2))
    (out / "slice.md").write_text(fleet_slice.build_slice(
        fleet_events.render_timeline(events), summary.get("workers") or [],
        projects_root, budget))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("paths", nargs="*",
                    help="fleet run dir, a tree containing them, or a sandbox-logs tarball")
    ap.add_argument("--cache", default="~/.claude/ultralearn")
    ap.add_argument("--remote", metavar="HOST",
                    help="pull evidence bundles from an orchestrator over ssh")
    ap.add_argument("--remote-root", default=fleet_fetch.DEFAULT_REMOTE_ROOT)
    ap.add_argument("--run", action="append", dest="run_ids", metavar="run-30",
                    help="restrict --remote to these run ids (repeatable)")
    ap.add_argument("--origin", default="home", choices=("home", "foreign"))
    ap.add_argument("--engine-version", default=None)
    ap.add_argument("--slice-budget", type=int, default=fleet_slice.WORKER_BUDGET)
    ap.add_argument("--force", action="store_true",
                    help="rebuild bundles that are already cached")
    args = ap.parse_args(argv)

    cache = Path(args.cache).expanduser()
    with tempfile.TemporaryDirectory(prefix="ultralearn-fleet-") as tmp:
        paths = [Path(p) for p in args.paths]
        if args.remote:
            paths += fleet_fetch.fetch_bundles(
                args.remote, Path(tmp) / "remote",
                remote_root=args.remote_root, run_ids=args.run_ids)
        run_dirs = []
        for p in paths:
            run_dirs += discover_run_dirs(p, Path(tmp) / "unpack")

        built, skipped = 0, 0
        for d in run_dirs:
            run_id = fleet_events.summarize_events(
                fleet_events.read_events(d)).get("runId")
            if run_id and not args.force and (cache / "runs" / run_id / "bundle.json").exists():
                skipped += 1
                continue
            if build_fleet_bundle(d, cache, origin=args.origin,
                                  engine_version=args.engine_version,
                                  budget=args.slice_budget):
                built += 1

    print(f"{built} bundle(s) written to {cache}/runs "
          f"({skipped} already cached, {len(run_dirs)} run dir(s) seen)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_harvest_fleet_runs.py -v`
Expected: PASS, 19 tests.

- [ ] **Step 5: Run the whole suite**

Run: `python3 -m pytest -n auto`
Expected: PASS — no pre-existing test regressed.

- [ ] **Step 6: Commit**

```bash
git add skills/ultralearn/scripts/harvest_fleet_runs.py tests/test_harvest_fleet_runs.py
git commit -m "feat(ultralearn): harvest fleet runs from their event log (#415)"
```

---

### Task 6: Teach the skill and the lenses about the new corpus

**Type:** implementation
**Depends-on:** 5

**Files:**
- Modify: `skills/ultralearn/SKILL.md:11-40`
- Modify: `skills/ultralearn/references/reading-lenses.md`
- Test: `tests/test_ultralearn_docs.py`

**Interfaces:**
- Consumes: the CLI surface of `skills/ultralearn/scripts/harvest_fleet_runs.py`
  (Task 5) — the flags named in the docs must be the flags that exist.
- Produces: nothing consumed by another task.

Two changes, both prose.

**(a) `SKILL.md`.** Verb 1 step 1 currently opens with a `KNOWN GAP since 0.3.0`
paragraph saying fleet runs are invisible *"when #415's harvest lands"*. It has
landed. Replace that paragraph with the fleet harvest step: the command, what a
run directory is, and that pre-#421 runs (10–23) still belong to the
Workflow-era harvester. Leave the sequential-drain and commissioned-read
paragraphs untouched — that machinery is unchanged.

**(b) `reading-lenses.md`.** Add one short section, `## Reading across the
cutover`, carrying two disciplines the new corpus makes necessary:

1. **A finding class that stops appearing may have been deleted, not fixed.**
   The pre-0.3.0 corpus was the LLM-orchestrator engine. Ten issues were closed
   on 2026-08-30 as moot-by-cutover — defects in machinery 0.3.0 deleted. A
   reader comparing eras must make the distinction expressible, or the first
   pass reads the cutover as an improvement it was not. When a lens wants to
   claim an improvement across the boundary, it states which of the two it is,
   or it does not make the claim.
2. **Cite event ids.** A fleet bundle carries `events` and its `slice.md` opens
   with a ULID-stamped timeline. An observation about timing, ordering, or a
   worker's fate cites the ULIDs it rests on, so the operator can check it
   mechanically against `events.jsonl` (#415's success criterion).

The test pins the claims that would silently rot — the stale gap sentence, and
the flag names.

- [ ] **Step 1: Write the failing test**

Create `tests/test_ultralearn_docs.py`:

```python
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultralearn/SKILL.md"
LENSES = ROOT / "skills/ultralearn/references/reading-lenses.md"
HARVEST = ROOT / "skills/ultralearn/scripts/harvest_fleet_runs.py"


def test_the_known_gap_paragraph_is_gone():
    assert "KNOWN GAP since 0.3.0" not in SKILL.read_text()


def test_skill_names_the_fleet_harvester_and_its_corpus():
    text = SKILL.read_text()
    assert "harvest_fleet_runs.py" in text
    assert "events.jsonl" in text


def test_every_flag_the_skill_advertises_exists():
    help_text = subprocess.run(
        [sys.executable, str(HARVEST), "--help"],
        capture_output=True, text=True, check=True).stdout
    advertised = set(re.findall(r"`?(--[a-z][a-z-]+)", SKILL.read_text()))
    for flag in advertised & {"--remote", "--run", "--cache", "--force",
                              "--origin", "--engine-version", "--slice-budget",
                              "--remote-root"}:
        assert flag in help_text, f"SKILL.md advertises {flag}, the CLI has no such flag"


def test_lenses_carry_the_cutover_disciplines():
    text = LENSES.read_text()
    assert "## Reading across the cutover" in text
    assert "deleted, not fixed" in text
    assert "ULID" in text
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_ultralearn_docs.py -v`
Expected: FAIL — `test_the_known_gap_paragraph_is_gone`,
`test_skill_names_the_fleet_harvester_and_its_corpus`, and
`test_lenses_carry_the_cutover_disciplines` all fail against the current text.

- [ ] **Step 3: Write the prose**

In `SKILL.md`, replace the `KNOWN GAP since 0.3.0` paragraph with, in substance:

~~~
   **Fleet runs (0.3.0 and later) come from their event log**, not from
   `~/.claude/projects` — the driver makes no `Workflow` tool call and runs in
   a sandbox, so the detector above cannot see them:
   `python3 skills/ultralearn/scripts/harvest_fleet_runs.py --remote fleet-orchestrator.exe.xyz`
   pulls each evidence tarball, or pass an unpacked run directory as a
   positional argument. It writes the same `bundle.json` + `slice.md` into the
   same cache, keyed by the fleet `runId` (`run-30`), so step 2 and step 3 are
   unchanged. `--run run-30` restricts the pull; `--force` rebuilds a cached
   bundle. A fleet run directory is one holding an `events.jsonl`; runs 10–23
   predate it and remain the Workflow-era harvester's (21–23) or the
   commissioned read's.
~~~

In `reading-lenses.md`, append the `## Reading across the cutover` section
carrying disciplines (1) and (2) above, in the file's existing voice.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_ultralearn_docs.py -v`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/SKILL.md skills/ultralearn/references/reading-lenses.md \
        tests/test_ultralearn_docs.py
git commit -m "docs(ultralearn): the sensor sees fleet runs again (#415)"
```

---

### Task 7: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6

**Files:**
- Test: `tests/`

The committed suite is the acceptance.

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest -n auto`
Expected: PASS, zero failures. The pre-existing count grows by the tests added
here (59: 14 + 9 + 7 + 6 + 19 + 4); no pre-existing test changes its result.

- [ ] **Step 2: Validate the skill directories**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: both pass — the same two checks CI runs.

---

## Operator smoke

The suite proves the readers are correct against synthetic runs. It cannot prove
they are correct against the **real** eight-run corpus, which lives on the
orchestrator and is not in the repo. That is what these probes are for.

- **do:** `python3 skills/ultralearn/scripts/harvest_fleet_runs.py --remote fleet-orchestrator.exe.xyz`
  **see:** it finishes without a traceback and prints `8 bundle(s) written to
  …/runs` — the eight post-cutover runs (24–31). Runs 10–23 are seen and
  correctly skipped: they have no event log.

- **do:** `cat ~/.claude/ultralearn/runs/run-30/bundle.json | head -40`
  **see:** `"runId": "run-30"`, `"origin": "home"`, `"terminus": "NEEDS_ACK"`,
  and an `engineVersion.epoch` that is a real version string, not `null`.

- **do:** `head -20 ~/.claude/ultralearn/runs/run-30/slice.md`
  **see:** an `## Event timeline` block whose first line is a 26-character ULID
  followed by `+0.0s  run:open  runId=run-30`. Pick any ULID from that block and
  find it with `grep` in the same run's real `events.jsonl` — it is there,
  character for character. That is the mechanical verifiability #415 asks for.

- **do:** `wc -c ~/.claude/ultralearn/runs/run-*/slice.md`
  **see:** every slice under about 250,000 characters. Run-30's unbudgeted
  slices measured 564,293; if any file here approaches that, the per-worker
  budget is not being applied.

- **do:** `python3 -c "import json,glob; print(sorted(json.load(open(p))['runId'] for p in glob.glob('$HOME/.claude/ultralearn/runs/*/bundle.json')))"`
  **see:** `run-14 … run-20` (the older commissioned reads) alongside `run-24 …
  run-31`, with no id appearing twice — the new bundles do not collide with
  what the ledger already holds.
