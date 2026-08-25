# Sensor Precision v5 Implementation Plan (#224, absorbs #188)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ultralearn sensor read relaunch-heavy runs correctly: resolver transcripts classify (#188); implementer/reviewer transcripts whose prompt carries no task-id line are attributed through their `FILES:` line; wall-clock is keyed per attempt with a `live` figure that excludes dead/escalated attempts; every transcript dir is tagged with its `wfRunId`, its stamp (joined through `wf-runs.json`) and its round; every run's fold stats are recorded, not only the last stamp's; and a NEEDS_ACK receipt whose stamp was approved in-session reads `approved`.

**Architecture:** Reader-side only, fixture-first — no engine, no `.mjs`, no frozen script. (T1) `audit_run.py` ROLE_MARKERS + `harvest_runs.py` ENGINE_ROLES gain `resolver` (#188, strict subset). (T2) `audit_run.py`: a `FILES:`-line join against the launch's per-task files (the transcript reading: on relaunch rounds @0.2.14 the hand-composed bodies carried no `### Task N:` heading and no `"id" is` sentence — `TASK:\nAMEND …` — so no regex can recover the id; the `FILES: a, b` line is the one deterministic key the prompt still carries), per-agent `attempt`, and `totals.liveWallSecByTask` (the LAST attempt per task; earlier attempts are the escalation/zombie retries the raw sum double-counted). (T3) `harvest_runs.py`: per-dir audits tagged `wfRunId`/`stamp`/`round` via `<runDir>/wf-runs.json` membership (a sorted id array — never assume launch order; transcript order is the round order), `totals.liveWallSecByRun` keyed `{wfRunId: {task: sec}}` so multi-plan sessions cannot collide, `runs[].frontier` per stamp. (T4) `_stamp_terminus`: a NEEDS_ACK disk verdict upgrades to `approved` when the session carries a machine approve receipt for that stamp (`ultra_gate.py --approve`'s printed JSON: `mode: "approve"`, matching `stamp`, `lockReleased: true`) recorded after that stamp's last launch; BLOCKED never flips this way (the existing #126 pin stays green as written). `planningFound` is left unchanged: the reported false reading is consistent with a plan authored in a different session (the docket sweep authors, the drain runs), which is a correct `false` — recorded as a judgment call, not a fix.

**Tech Stack:** Python 3 stdlib, pytest. Fixtures are synthetic transcripts (`tests/test_audit_run.py` `agent_file*` helpers; `tests/test_harvest_runs.py` `_rec`/`_wf_launch`/`_real_receipt` helpers).

**Spec:** GitHub issues #224 and #188 plus their docket entries (`### #224`, `### #188` — #188 is absorbed: `close #188` rides T1's commit). `#206`'s charter counters are not added (not cheap enough to ride here).

**Acceptance:** suite — sensor scripts + tests; the committed pytest suite (extended by every task below) is the verification, no held-out exam.

## Global Constraints

- The verification periphery is FROZEN: never touch `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `run_acceptance.sh`, `collect_seal.py`, `seal_hash.py`. `record_wf_run.py`'s stamp-record schema is not changed.
- `skills/ultrapowers/harnesses/waves.js`, the kernel, and every `.mjs` sim are not edited.
- Every existing key of `audit_run.audit()`'s result and of the bundle (`audit.totals.wallSecByTask`, `frontier.maxLinesByWave`, `runs[]` fields, `terminus`, `truncated`, `planningFound`) keeps its name and meaning — additions only, so `skills/ultralearn/references/reading-lenses.md` readers stay correct.
- `tests/test_read_launch_reads_waves_and_edges` pins `_read_launch`'s exact return shape — do not add keys to it; new launch-derived data uses a new helper.
- `tests/test_harvest_runs.py::test_printed_approve_marker_alone_does_not_flip_terminus` stays green as written: a BLOCKED disk receipt never flips on an approve marker.
- No Anthropic API calls or SDK anywhere; no new dependencies.
- Tests must be concurrency-safe: derive every path from pytest's `tmp_path`, no shared on-disk fixtures, no ports.
- The full gate is `python3 -m pytest`; every task leaves it green.

---

### Task 1: Resolver role marker (#188)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/audit_run.py`
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_audit_run.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `audit_run.classify(text)` returns `"resolver"` for a resolver prompt; `harvest_runs.ENGINE_ROLES` contains `"resolver"`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_audit_run.py`:

```python
RESOLVER = ("SAFETY: ...\n\nYou are a merge-conflict resolver for one file in one wave. "
            "You have no repo to explore: read exactly the hunks file named below.\n")


def test_resolver_prompt_classifies_as_resolver(tmp_path):
    from audit_run import classify
    assert classify(RESOLVER) == "resolver"
    agent_file(tmp_path, "r1", RESOLVER, "test-model", turns=2)
    p = run_audit(tmp_path)
    assert p.returncode == 0, p.stderr
    assert "| resolver | test-model | 2 | 20 |" in p.stdout
    assert "unclassified" not in p.stdout
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_audit_run.py -v -k resolver`
Expected: FAIL (`classify` returns `"unknown"`).

- [ ] **Step 3: Add the marker and the engine role**

In `skills/ultrapowers/scripts/audit_run.py` ROLE_MARKERS, insert after the `("You are the reconciliation agent", "reconcile"),` tuple:

```python
    # #188: the resolver prompt (references/wave-merge.md RESOLVER_PROMPT,
    # baked into waves.js) opens with this phrase.
    ("You are a merge-conflict resolver", "resolver"),
```

In `skills/ultralearn/scripts/harvest_runs.py` change `ENGINE_ROLES` to:

```python
ENGINE_ROLES = {"setup", "merge", "review", "reconcile", "resolver", "integration"}
```

- [ ] **Step 4: Run the tests**

Run: `python3 -m pytest tests/test_audit_run.py tests/test_harvest_runs.py -q`
Expected: PASS (including `test_every_role_marker_exists_in_baked_sources` — the phrase exists verbatim in `wave-merge.md` and `waves.js`).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/audit_run.py skills/ultralearn/scripts/harvest_runs.py tests/test_audit_run.py
git commit -m "feat(sensor): resolver role marker in audit_run + harvest ENGINE_ROLES (#224)

close #188"
```

---

### Task 2: audit_run — FILES-line attribution, attempts, live wall-clock

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/audit_run.py`
- Test: `tests/test_audit_run.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces:
  - `classify(text: str, files_by_task: dict[str, list[str]] | None = None) -> str` — when the role is `impl`/`review` and neither `TASK_ID` nor `TASK_HEAD` matches, and `files_by_task` is given, parse the prompt's `FILES: <a>, <b>, …` line (`FILES_LINE = re.compile(r"^FILES: (.+)$", re.MULTILINE)`), split on `", "`, and return `<role>:<id>` for the UNIQUE task whose `set(files)` equals the parsed set; otherwise `<role>:?` as today.
  - `audit(transcript_dir, files_by_task=None) -> dict` — each agent dict gains `"file"` (the transcript basename) and, for `impl:<id>`/`review:<id>` roles, `"attempt"` (1-based, ordered by the transcript's first timestamp with `None` last, then filename, among transcripts sharing the same role string); `totals` gains `"liveWallSecByTask": {task_id: wallSec of the highest-attempt impl transcript}`. `wallSecByTask` (raw sum) is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_audit_run.py` (the `agent_file_ts` helper already exists there):

```python
IMPL_FILES_ONLY = ("SAFETY: ...\n\nYou are an implementer subagent operating inside a dedicated git worktree.\n"
                   "\nBASE: abc\nFILES: commands/kb-setup.md, tests/test_setup.py\n"
                   "SIBLING FILES: 1: app/lib.ts\n\nTASK:\nAMEND (two gate findings) on the merged file.\n")
REVIEW_FILES_ONLY = ("SAFETY: ...\n\nYou are an independent reviewer. You receive the original task text.\n"
                     "\nFILES: commands/kb-setup.md, tests/test_setup.py\n")
FILES_BY_TASK = {"1": ["app/lib.ts"], "5": ["commands/kb-setup.md", "tests/test_setup.py"],
                 "6": ["CLAUDE.md"]}


def test_classify_falls_back_to_files_line_join():
    from audit_run import classify
    assert classify(IMPL_FILES_ONLY) == "impl:?"                    # no launch: today's answer
    assert classify(IMPL_FILES_ONLY, FILES_BY_TASK) == "impl:5"
    assert classify(REVIEW_FILES_ONLY, FILES_BY_TASK) == "review:5"
    # order-insensitive, and an ambiguous (non-unique) match stays '?'
    assert classify(IMPL_FILES_ONLY, {"5": ["tests/test_setup.py", "commands/kb-setup.md"]}) == "impl:5"
    assert classify(IMPL_FILES_ONLY, {"5": FILES_BY_TASK["5"], "7": FILES_BY_TASK["5"]}) == "impl:?"
    # an explicit id line still wins over the FILES join
    assert classify(IMPL_ID_2 + "\nFILES: commands/kb-setup.md, tests/test_setup.py\n", FILES_BY_TASK) == "impl:2"


def test_audit_accepts_files_by_task_for_attribution(tmp_path):
    from audit_run import audit
    agent_file(tmp_path, "a1", IMPL_FILES_ONLY, "test-model", turns=1)
    assert [a["role"] for a in audit(tmp_path)["agents"]] == ["impl:?"]
    assert [a["role"] for a in audit(tmp_path, FILES_BY_TASK)["agents"]] == ["impl:5"]


def test_audit_numbers_attempts_and_reports_live_wall_sec(tmp_path):
    from audit_run import audit
    # task 7: a zombie first attempt (8000 s) then the live retry (900 s)
    agent_file_ts(tmp_path, "z1", IMPL_7, "test-model",
                  ["2026-08-19T10:00:00Z", "2026-08-19T12:13:20Z"])   # 8000 s
    agent_file_ts(tmp_path, "a2", IMPL_7, "test-model",
                  ["2026-08-19T12:20:00Z", "2026-08-19T12:35:00Z"])   # 900 s
    agent_file_ts(tmp_path, "b1", IMPL_9, "test-model",
                  ["2026-08-19T10:00:00Z", "2026-08-19T10:05:00Z"])   # 300 s
    data = audit(tmp_path)
    by_file = {a["file"]: a for a in data["agents"]}
    assert by_file["agent-z1.jsonl"]["attempt"] == 1
    assert by_file["agent-a2.jsonl"]["attempt"] == 2
    assert by_file["agent-b1.jsonl"]["attempt"] == 1
    assert data["totals"]["wallSecByTask"] == {"7": 8900.0, "9": 300.0}     # raw sum unchanged
    assert data["totals"]["liveWallSecByTask"] == {"7": 900.0, "9": 300.0}  # last attempt only
    assert data["escalatedTasks"] == ["7"]


def test_audit_attempt_order_falls_back_to_filename_without_timestamps(tmp_path):
    from audit_run import audit
    agent_file(tmp_path, "b", IMPL_7, "test-model", turns=1)
    agent_file(tmp_path, "a", IMPL_7, "test-model", turns=1)
    by_file = {x["file"]: x for x in audit(tmp_path)["agents"]}
    assert by_file["agent-a.jsonl"]["attempt"] == 1 and by_file["agent-b.jsonl"]["attempt"] == 2


def test_audit_missing_dir_totals_carry_empty_live_wall_sec(tmp_path):
    from audit_run import audit
    assert audit(tmp_path / "nope")["totals"]["liveWallSecByTask"] == {}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m pytest tests/test_audit_run.py -v -k "files_line or files_by_task or attempts or attempt_order or live_wall"`
Expected: FAIL (`classify` rejects the second argument; no `attempt`/`file`/`liveWallSecByTask`).

- [ ] **Step 3: Implement in `skills/ultrapowers/scripts/audit_run.py`**

Add beside `TASK_ID`:

```python
# #224: a relaunch-round prompt whose body was inlined without a "### Task N:"
# heading (and no wavesPath "id" sentence) still carries the task's declared
# file scope on one line — the one deterministic key left to join on.
FILES_LINE = re.compile(r"^FILES: (.+)$", re.MULTILINE)
```

Replace `classify` with:

```python
def _files_line_task(text, files_by_task):
    m = FILES_LINE.search(text)
    if not m or not files_by_task:
        return None
    want = {p.strip() for p in m.group(1).split(", ") if p.strip()}
    hits = [tid for tid, files in files_by_task.items()
            if isinstance(files, list) and set(files) == want]
    return hits[0] if len(hits) == 1 else None


def classify(text, files_by_task=None):
    for marker, role in ROLE_MARKERS:
        if marker in text:
            if role in ("impl", "review"):
                m = TASK_ID.search(text) or TASK_HEAD.search(text)
                tid = m.group(1) if m else _files_line_task(text, files_by_task)
                return role + ":" + (tid if tid else "?")
            return role
    return "unknown"
```

Change `collect` to also return the first timestamp: return `(model, turns, out_tokens, wall_sec, first_ts)` (a `datetime` or `None`), and update `main()`'s unpacking accordingly (`model, turns, out_tokens, _wall_sec, _first = collect(f)`). Replace `audit` with:

```python
def audit(transcript_dir, files_by_task=None):
    """Structured effort audit for one per-run engine transcript dir.

    Advisory by contract: a missing/empty/drifted dir returns a dict with an
    empty 'agents' list and a 'note' — never raises. `files_by_task` (launch
    task id -> declared files) enables the FILES-line join for prompts that
    carry no task-id line (#224)."""
    d = Path(transcript_dir)
    files = sorted(d.glob("agent-*.jsonl")) if d.is_dir() else []
    if not files:
        return {"agents": [], "totals": {"turns": 0, "outputTokens": 0,
                                         "wallSecByTask": {}, "liveWallSecByTask": {}},
                "escalatedTasks": [], "thrashCandidates": [],
                "note": f"no agent-*.jsonl under {transcript_dir}"}
    agents = []
    for f in files:
        role = classify(first_user_text(f), files_by_task)
        model, turns, out_tokens, wall_sec, first_ts = collect(f)
        agents.append({"role": role, "model": model, "turns": turns,
                       "outputTokens": out_tokens, "wallSec": wall_sec,
                       "file": f.name, "_first": first_ts})
    # attempt: 1-based order among transcripts sharing one impl:/review: role,
    # by first timestamp (unstamped last) then filename — earlier attempts are
    # the escalation/zombie retries a raw sum double-counts (#224).
    by_role = {}
    for a in agents:
        if a["role"].startswith(("impl:", "review:")):
            by_role.setdefault(a["role"], []).append(a)
    for lst in by_role.values():
        lst.sort(key=lambda a: (a["_first"] is None,
                                a["_first"] or datetime.min.replace(tzinfo=timezone.utc),
                                a["file"]))
        for i, a in enumerate(lst, 1):
            a["attempt"] = i
    for a in agents:
        a.pop("_first", None)
    agents.sort(key=lambda a: -a["turns"])
    totals = {"turns": sum(a["turns"] for a in agents),
              "outputTokens": sum(a["outputTokens"] for a in agents)}
    impl_by_task = {}
    for a in agents:
        if a["role"].startswith("impl:"):
            impl_by_task.setdefault(a["role"].split(":", 1)[1], []).append(a)
    escalated = sorted(tid for tid, lst in impl_by_task.items() if len(lst) > 1)
    totals["wallSecByTask"] = {tid: sum(a["wallSec"] for a in lst)
                               for tid, lst in impl_by_task.items()}
    totals["liveWallSecByTask"] = {tid: max(lst, key=lambda a: a["attempt"])["wallSec"]
                                   for tid, lst in impl_by_task.items()}
    thrash = [a for a in agents
              if a["role"].startswith("impl")
              and a["turns"] >= THRASH_MIN_TURNS
              and (a["outputTokens"] / a["turns"] if a["turns"] else 0) < THRASH_MAX_PER_TURN]
    return {"agents": agents, "totals": totals,
            "escalatedTasks": escalated, "thrashCandidates": thrash}
```

Sorting note: `_first` values are timezone-aware datetimes from `_parse_ts`, so the placeholder is `datetime.min.replace(tzinfo=timezone.utc)` (add `timezone` to the `from datetime import …` line) — the key tuple never mixes aware and naive values.

- [ ] **Step 4: Run the whole audit test file**

Run: `python3 -m pytest tests/test_audit_run.py -v`
Expected: all PASS, including the pre-existing `test_audit_totals_wall_sec_by_task_*` pins (raw sum unchanged).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/audit_run.py tests/test_audit_run.py
git commit -m "feat(sensor): audit_run FILES-line task attribution, per-attempt numbering, liveWallSecByTask (#224)"
```

---

### Task 3: harvest — wfRunId/stamp/round tagging, per-run live wall-clock and frontier

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes (Task 2): `audit_run.audit(transcript_dir, files_by_task=None)`; agents carry `file`/`attempt`; `totals.liveWallSecByTask`.
- Produces (module `harvest_runs`):
  - `_launch_files_by_task(run_dir) -> dict[str, list[str]]` — from `<run_dir>/launch.json` `tasks` (list or dict shape), `{id: files}`; `{}` when absent/malformed.
  - `_wf_run_ids(run_dir) -> list[str]` — the `<run_dir>/wf-runs.json` array (strings only); `[]` when absent/malformed. Membership only — the file is sorted, never launch order.
  - Bundle additions: each `audit.agents[]` entry carries `wfRunId` (transcript dir basename), `stamp` (the registry stamp whose `wf-runs.json` lists that id, else `None`), `round` (0-based index of the dir among the dirs attributed to the same stamp, in transcript order; dirs with no stamp count in their own sequence); `audit.totals.liveWallSecByRun: {wfRunId: {task: sec}}` (no cross-run summing); `runs[]` entries gain `wfRunIds` and `frontier: {"maxLinesByWave": …}` for that stamp's runDir. `frontier.maxLinesByWave` at top level is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_harvest_runs.py`:

```python
def test_launch_files_by_task_and_wf_run_ids_soft(tmp_path):
    assert h._launch_files_by_task(None) == {} and h._wf_run_ids(None) == []
    run_dir = tmp_path / "run"; run_dir.mkdir()
    assert h._launch_files_by_task(str(run_dir)) == {} and h._wf_run_ids(str(run_dir)) == []
    (run_dir / "launch.json").write_text(json.dumps(
        {"waves": [["1"]], "edges": [], "tasks": [{"id": "1", "files": ["a.py"]}, {"id": "2"}]}))
    (run_dir / "wf-runs.json").write_text(json.dumps(["wf_b-2", "wf_a-1", 7]))
    assert h._launch_files_by_task(str(run_dir)) == {"1": ["a.py"]}
    assert h._wf_run_ids(str(run_dir)) == ["wf_b-2", "wf_a-1"]
    (run_dir / "launch.json").write_text(json.dumps(
        {"waves": [], "edges": [], "tasks": {"3": {"id": "3", "files": ["c.py"]}}}))
    assert h._launch_files_by_task(str(run_dir)) == {"3": ["c.py"]}
    (run_dir / "wf-runs.json").write_text("{corrupt")
    assert h._wf_run_ids(str(run_dir)) == []


def _impl_transcript(d, name, task_line, ts):
    d.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps({"type": "user", "message": {"content": [{"type": "text", "text":
             "SAFETY: ...\n\nYou are an implementer subagent operating inside a dedicated git worktree.\n"
             + task_line}]}})]
    for t in ts:
        lines.append(json.dumps({"type": "assistant", "timestamp": t,
                                 "message": {"model": "m", "usage": {"output_tokens": 5}}}))
    (d / f"agent-{name}.jsonl").write_text("\n".join(lines) + "\n")


def test_bundle_tags_agents_with_wf_run_id_stamp_round_and_live_wall(tmp_path):
    # one stamp, two rounds: the first launch (wf_x-1) and a redirect relaunch
    # (wf_x-2) whose prompt carries only a FILES: line. wf-runs.json is SORTED.
    run1 = tmp_path / "run-20260825-000001"; run1.mkdir()
    (run1 / "launch.json").write_text(json.dumps(
        {"waves": [["1"]], "edges": [], "tasks": [{"id": "1", "files": ["a.py", "b.py"]}]}))
    (run1 / "wf-runs.json").write_text(json.dumps(["wf_x-1", "wf_x-2"]))
    d1 = tmp_path / "wf" / "wf_x-1"; d2 = tmp_path / "wf" / "wf_x-2"
    _impl_transcript(d1, "a", '\nTASK: … find the object whose "id" is "1" …\n',
                     ["2026-08-25T10:00:00Z", "2026-08-25T10:10:00Z"])          # 600 s
    _impl_transcript(d2, "b", "\nFILES: b.py, a.py\n\nTASK:\nAMEND the guard.\n",
                     ["2026-08-25T11:00:00Z", "2026-08-25T11:02:00Z"])          # 120 s
    recs = [
        _rec("user", [{"type": "text", "text": "build the thing"}]),
        _wf_launch("20260825-000001", run_dir=str(run1)),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
             "text": f"Transcript dir: {d1}\n"}]}]),
        _wf_launch("20260825-000001", run_dir=str(run1)),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
             "text": f"Transcript dir: {d2}\n"}]}]),
    ]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    agents = sorted(bundle["audit"]["agents"], key=lambda a: a["wfRunId"])
    assert [(a["wfRunId"], a["stamp"], a["round"], a["role"], a["attempt"]) for a in agents] == [
        ("wf_x-1", "20260825-000001", 0, "impl:1", 1),
        ("wf_x-2", "20260825-000001", 1, "impl:1", 1),
    ]
    assert bundle["audit"]["totals"]["wallSecByTask"] == {"1": 720.0}     # summed across dirs, unchanged
    assert bundle["audit"]["totals"]["liveWallSecByRun"] == {"wf_x-1": {"1": 600.0}, "wf_x-2": {"1": 120.0}}
    assert bundle["runs"][0]["wfRunIds"] == ["wf_x-1", "wf_x-2"]
    assert bundle["runs"][0]["frontier"] == {"maxLinesByWave": {}}


def test_bundle_agent_with_unlisted_dir_has_null_stamp(tmp_path):
    run1 = tmp_path / "run-20260825-000002"; run1.mkdir()
    d1 = tmp_path / "wf" / "wf_q-9"
    _impl_transcript(d1, "a", '\nTASK: … whose "id" is "1" …\n', ["2026-08-25T10:00:00Z"])
    recs = [
        _rec("user", [{"type": "text", "text": "build the thing"}]),
        _wf_launch("20260825-000002", run_dir=str(run1)),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
             "text": f"Transcript dir: {d1}\n"}]}]),
    ]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    a = bundle["audit"]["agents"][0]
    assert (a["wfRunId"], a["stamp"], a["round"]) == ("wf_q-9", None, 0)


def test_runs_entries_carry_per_stamp_frontier(tmp_path):
    run1 = tmp_path / "run-20260825-000003"; run1.mkdir()
    d = run1 / "frontier" / "wave-1"; d.mkdir(parents=True)
    (d / "fold_stats.json").write_text(json.dumps({"maxLines": [4, 9]}))
    recs = REAL + [_wf_launch("20260825-000003", run_dir=str(run1))]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["runs"][-1]["frontier"] == {"maxLinesByWave": {"1": [4, 9]}}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -v -k "files_by_task or wf_run_id or unlisted_dir or per_stamp_frontier"`
Expected: FAIL (helpers missing; no `wfRunId`/`stamp`/`round`/`liveWallSecByRun`/`wfRunIds`/per-run `frontier`).

- [ ] **Step 3: Implement in `skills/ultralearn/scripts/harvest_runs.py`**

Add the two helpers next to `_read_launch`:

```python
def _launch_files_by_task(run_dir):
    """{task id: declared files} from <run_dir>/launch.json tasks (list or
    dict shape) — the join key the FILES-line attribution needs (#224).
    Soft: {} on any absence or malformation."""
    if not run_dir:
        return {}
    try:
        obj = json.loads((Path(run_dir) / "launch.json").read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    tasks = obj.get("tasks") if isinstance(obj, dict) else None
    items = (tasks.values() if isinstance(tasks, dict)
             else tasks if isinstance(tasks, list) else [])
    out = {}
    for t in items:
        if isinstance(t, dict) and isinstance(t.get("files"), list) and t.get("id") is not None:
            out[str(t["id"])] = [str(p) for p in t["files"]]
    return out


def _wf_run_ids(run_dir):
    """The <run_dir>/wf-runs.json id array (strings only). MEMBERSHIP only:
    the file is sorted by the writer, never launch order (#224)."""
    if not run_dir:
        return []
    try:
        obj = json.loads((Path(run_dir) / "wf-runs.json").read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return []
    return [x for x in obj if isinstance(x, str)] if isinstance(obj, list) else []
```

In `_runs_for_bundle`, add to each entry: `"wfRunIds": _wf_run_ids(run_dir)` and `"frontier": {"maxLinesByWave": _frontier_max_lines(run_dir)}`.

In `build_bundle`, replace `audit = _merge_audits([audit_run.audit(d) for d in tdirs])` with:

```python
    # #224: each transcript dir is one relaunch round; join it to its stamp
    # through that stamp's wf-runs.json (membership) and number rounds in
    # transcript order. The FILES-line join reads the stamp's launch.json.
    stamp_by_run_id = {}
    for stamp in registry["stamps"]:
        for rid in _wf_run_ids(registry["runDirsByStamp"].get(stamp)):
            stamp_by_run_id.setdefault(rid, stamp)
    audits, rounds_seen = [], {}
    for d in tdirs:
        wf_run_id = Path(d).name
        stamp = stamp_by_run_id.get(wf_run_id)
        round_ix = rounds_seen.get(stamp, 0)
        rounds_seen[stamp] = round_ix + 1
        files_by_task = _launch_files_by_task(registry["runDirsByStamp"].get(stamp)) if stamp else None
        a = audit_run.audit(d, files_by_task)
        for agent in a.get("agents") or []:
            agent.update({"wfRunId": wf_run_id, "stamp": stamp, "round": round_ix})
        live = (a.get("totals") or {}).get("liveWallSecByTask")
        if isinstance(live, dict) and live:
            a.setdefault("totals", {})["liveWallSecByRun"] = {wf_run_id: dict(live)}
        audits.append(a)
    audit = _merge_audits(audits)
```

`_merge_audits` already merges dict-valued totals key-wise; because `liveWallSecByRun` is keyed by `wfRunId` (unique per dir) its inner dicts never sum across runs — but its leaves are dicts, which the existing merge drops (it sums numeric leaves only). Extend the dict branch: when `sv` is a dict, deep-copy it into `sub[sk]` if absent (never sum). Keep `liveWallSecByTask` out of the merged totals (drop it in `_merge_audits` — it would collide across stamps exactly like `wallSecByTask` does; the per-run form is the honest one).

- [ ] **Step 4: Run the tests**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: all PASS, including `test_read_launch_reads_waves_and_edges` (shape untouched) and the `_merge_audits` pins.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(sensor): harvest tags agents with wfRunId/stamp/round via wf-runs.json, liveWallSecByRun, per-stamp frontier (#224)"
```

---

### Task 4: terminus — NEEDS_ACK approved in-session reads approved

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: nothing from sibling tasks (edits `_stamp_terminus`/`_runs_for_bundle`/`build_bundle` at different anchors than Task 3; text overlap folds at merge).
- Produces: `_approve_receipt_seen(records, stamp) -> bool` — True when a `tool_result` block AFTER the stamp's last launch (`_last_launch_tool_use_index`) contains a JSON object with `"mode": "approve"`, `"stamp": <stamp>` and `"lockReleased": true` (parse the block text as JSON; if that fails, search it for the first `{`…`}` span that parses). `_stamp_terminus(run_dir, stamp_reports, drain_receipts=(), approve_seen=False)`: a disk verdict of exactly `NEEDS_ACK` upgrades to `approved` when `approve_seen`; any other verdict (BLOCKED included) is unchanged by the flag.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_harvest_runs.py` (the `_approve_marker`, `_real_receipt`, `_wf_launch` helpers exist):

```python
def test_needs_ack_receipt_with_in_session_approve_reads_approved(tmp_path):
    run1 = tmp_path / "run-20260703-000000"; run1.mkdir()
    (run1 / "gate-receipt.json").write_text(json.dumps(_real_receipt("NEEDS_ACK", 2)))
    ok = json.dumps(_approve_marker())  # stamp "20260703-000000"
    recs = REAL + [_wf_launch("20260703-000000", run_dir=str(run1)),
                   _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": ok}]}])]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["terminus"] == "approved"
    assert bundle["runs"][-1]["terminus"] == "approved"
    assert bundle["truncated"] is False


def test_approve_receipt_before_the_launch_or_for_another_stamp_does_not_count(tmp_path):
    run1 = tmp_path / "run-20260703-000000"; run1.mkdir()
    (run1 / "gate-receipt.json").write_text(json.dumps(_real_receipt("NEEDS_ACK", 2)))
    other = dict(_approve_marker(), stamp="20260703-999999")
    recs = REAL + [
        _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": json.dumps(_approve_marker())}]}]),
        _wf_launch("20260703-000000", run_dir=str(run1)),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": json.dumps(other)}]}]),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text":
             json.dumps(dict(_approve_marker(), lockReleased=False))}]}]),
    ]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["terminus"] == "NEEDS_ACK"


def test_approve_receipt_seen_unit():
    launch = _wf_launch("s1", run_dir="/repo/.claude/ultrapowers/run-s1")
    hit = _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text":
           "approve done:\n" + json.dumps(dict(_approve_marker(), stamp="s1"))}]}])
    assert h._approve_receipt_seen([launch, hit], "s1") is True
    assert h._approve_receipt_seen([hit, launch], "s1") is False      # before the launch
    assert h._approve_receipt_seen([launch, hit], "s2") is False      # other stamp
    assert h._approve_receipt_seen([launch], "s1") is False
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -v -k "in_session_approve or does_not_count or approve_receipt_seen"`
Expected: FAIL (`_approve_receipt_seen` missing; terminus stays `NEEDS_ACK`). Also run `-k printed_approve_marker` — Expected: PASS (unchanged pin).

- [ ] **Step 3: Implement**

Add after `_last_launch_tool_use_index`:

```python
_JSON_SPAN = re.compile(r"\{.*\}", re.DOTALL)


def _approve_receipt_seen(records, stamp):
    """#224: True when a tool_result AFTER this stamp's last launch carries
    ultra_gate.py --approve's printed receipt for it — mode "approve", the
    same stamp, lockReleased true. Machine-written evidence that the approve
    checkout + sweep ran, not a prose marker."""
    start = _last_launch_tool_use_index(records, stamp)
    if start is None:
        return False
    for idx, _r, b in _iter_blocks_indexed(records):
        if idx <= start or not (isinstance(b, dict) and b.get("type") == "tool_result"):
            continue
        txt = _block_text(b)
        if '"approve"' not in txt:
            continue
        obj = None
        try:
            obj = json.loads(txt)
        except json.JSONDecodeError:
            m = _JSON_SPAN.search(txt)
            if m:
                try:
                    obj = json.loads(m.group(0))
                except json.JSONDecodeError:
                    obj = None
        if (isinstance(obj, dict) and obj.get("mode") == "approve"
                and obj.get("stamp") == stamp and obj.get("lockReleased") is True):
            return True
    return False
```

Change `_stamp_terminus`'s signature to `(run_dir, stamp_reports, drain_receipts=(), approve_seen=False)` and, in its disk-receipt branch, after the git-ancestry check: `if verdict == "NEEDS_ACK" and approve_seen: return "approved"`. Thread the flag: `_runs_for_bundle(registry, gate_reports, records=None)` computes `approve_seen = _approve_receipt_seen(records, stamp) if records is not None else False` per stamp and passes it; `build_bundle` calls `_runs_for_bundle(registry, gate_reports, records)`. Update the `_stamp_terminus` docstring with one sentence: NEEDS_ACK is the one verdict an in-session approve receipt upgrades — acks are given in-session by design, while BLOCKED stays BLOCKED (the #126 pin).

- [ ] **Step 4: Run the tests**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(sensor): NEEDS_ACK receipt approved in-session reads approved (machine approve receipt only) (#224)"
```

---

### Task 5: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: all green.

---

## Operator smoke

- do: `python3 skills/ultrapowers/scripts/audit_run.py ~/.claude/projects/-Users-marcusestes-Websites-skylights-project-skylights/2400e852-d670-4c3e-a814-72737e2a656a/subagents/workflows/wf_dce09460-307 | head -20`
  see: the table still prints (advisory tool, exit 0); rows remain `impl:?` here because the standalone CLI has no launch — the join needs the harvester.
- do: `python3 skills/ultralearn/scripts/harvest_runs.py --project -Users-marcusestes-Websites-skylights-project-skylights --session 2400e852-d670-4c3e-a814-72737e2a656a` (flags per `harvest_runs.py --help`), then open the rewritten bundle's `audit.agents`.
  see: the relaunch-round agents carry `wfRunId: "wf_dce09460-307"`, a `round` ≥ 1, and `impl:5`/`review:5` instead of `impl:?`; `totals.liveWallSecByRun` is keyed by run id.
- do: `gh issue view 188 --json state -q .state` after the drain merges.
  see: `CLOSED` (absorbed by T1's commit).
