# A/B Rig on the One Driver (local cells) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the fold-vs-serialize A/B instrument (#402 item 6) around the One Driver engine: one local cell per invocation, driving `fleet/run-main.mjs` against the existing `evals/fixtures/*`, appending schema-compatible rows to `evals/results/runs.jsonl`.

**Architecture:** Three small Python modules in `evals/`: a pure assembly+harvest library (`ab_lib.py`), a credential-seeding module (`ab_auth.py`), and a CLI runner (`ab_runner.py`) that wires them around one `node fleet/run-main.mjs` subprocess. The engine already provides per-run `CLAUDE_CONFIG_DIR` isolation and rides `CLAUDE_CODE_OAUTH_TOKEN` from the inherited env, so the rig's auth job is only extracting the operator's live credential (macOS Keychain, file fallback — ported from the deleted rig at `git show 44e0d15^:evals/ab_runner.py`). Cells run ONE at a time, by hand, on the operator's laptop subscription — never in CI, never concurrent (operator decision 2026-08-30, recorded on #402).

**Tech Stack:** Python 3 stdlib only. No new dependencies.

**Spec:** Issue #402 (item 6) + the 2026-08-30 operator comment (local cells; existing fixtures only — baseline comparability is the point; Bun enters later as an additive fixture, never by converting these).

## Global Constraints

- No test may ever invoke a real `claude` or `node` binary for a cell run: every test injects a stub through the exec seam (`run` parameter). The suite runs on machines where `claude` exists and is authenticated — an unstubbed call would launch a real LLM session.
- No `anthropic` SDK, no `ANTHROPIC_API_KEY` (CLAUDE.md: repo code makes no direct API calls).
- `evals/fixtures/*` are read-only test data: the rig copies from them, never writes into them, and never converts them (baseline comparability, #402).
- `evals/results/runs.jsonl` is append-only: one JSON object per line, never rewritten.
- Credential values must never be written to logs, exceptions, or result rows — only their presence/absence may be reported.
- Tests must be pytest-xdist-safe: every temp path from `tmp_path`, no fixed ports, no shared on-disk state (#426).

**Acceptance:** suite — the committed pytest suite plus per-task review verifies the rig; the real-binary probe is the operator's manual smoke (see the `manual` task and Operator smoke), per the two-claims-two-tests doctrine.

---

### Task 1: Cell assembly + harvest library (`evals/ab_lib.py`)

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/ab_lib.py`
- Test: `tests/test_ab_lib.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `build_cell(fixture: str, repo_root: Path, workspace: Path, fixtures_root: Path | None = None) -> Path` (assembled cell git repo); `harvest_row(run_dir: Path, meta: dict) -> dict` (one runs.jsonl row); `ENGINE_REPO_PARTS: tuple` (the repo-relative paths every cell repo must carry).

**Parallelization rationale:** assembly/harvest is pure-filesystem and shares no code with credential seeding (Task 2); fixing the row schema and cell layout here up front lets Task 3 build the CLI against a contract. A good engineer would separate the pure library from the subprocess wiring regardless of parallelism.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_ab_lib.py
import json, pathlib, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
from ab_lib import build_cell, harvest_row, ENGINE_REPO_PARTS


def _make_fixture(tmp_path):
    fx = tmp_path / "fixtures" / "mini"
    (fx / "project").mkdir(parents=True)
    (fx / "project" / "app.py").write_text("x = 1\n")
    (fx / "plan.md").write_text("# P\n\n### Task 1: A\n")
    return tmp_path / "fixtures"


def test_build_cell_assembles_a_committed_repo(tmp_path):
    fixtures = _make_fixture(tmp_path)
    cell = build_cell("mini", repo_root=ROOT, workspace=tmp_path / "ws",
                      fixtures_root=fixtures)
    assert (cell / "app.py").read_text() == "x = 1\n"
    assert (cell / "plan.md").is_file()
    # Engine-required repo-relative parts travel with the cell:
    assert (cell / "skills/ultrapowers/scripts/ultra_run.py").is_file()
    assert (cell / "fleet/confine-hook.mjs").is_file()
    # git repo, clean, on a branch, everything committed:
    st = subprocess.run(["git", "status", "--porcelain"], cwd=cell,
                        capture_output=True, text=True)
    assert st.stdout == ""
    log = subprocess.run(["git", "log", "--oneline"], cwd=cell,
                         capture_output=True, text=True)
    assert len(log.stdout.strip().splitlines()) == 1


def test_build_cell_never_writes_into_the_fixture(tmp_path):
    fixtures = _make_fixture(tmp_path)
    before = sorted(p.relative_to(fixtures) for p in fixtures.rglob("*"))
    build_cell("mini", repo_root=ROOT, workspace=tmp_path / "ws",
               fixtures_root=fixtures)
    after = sorted(p.relative_to(fixtures) for p in fixtures.rglob("*"))
    assert before == after


def _write_run_dir(tmp_path):
    rd = tmp_path / "run-ab1"
    rd.mkdir()
    events = [
        {"ts": "2026-08-30T10:00:00.000Z", "kind": "driver:stage", "stage": "preflight"},
        {"ts": "2026-08-30T10:00:05.000Z", "kind": "worker:start", "label": "impl:1", "role": "implementer"},
        {"ts": "2026-08-30T10:05:00.000Z", "kind": "worker:end", "label": "impl:1", "role": "implementer",
         "meter": {"input": 10, "output": 1000, "cacheRead": 50, "cacheCreation": 5, "costUsd": 0.1, "models": ["m"]}},
        {"ts": "2026-08-30T10:06:00.000Z", "kind": "worker:end", "label": "rev:1", "role": "reviewer",
         "meter": {"input": 5, "output": 200, "cacheRead": 20, "cacheCreation": 2, "costUsd": 0.02, "models": ["m"]}},
        {"ts": "2026-08-30T10:10:00.000Z", "kind": "driver:stage", "stage": "approved"},
    ]
    with open(rd / "events.jsonl", "w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")
    (rd / "args.json").write_text(json.dumps(
        {"waves": [[{"id": "1"}, {"id": "2"}], [{"id": "3"}]]}))
    return rd


def test_harvest_row_sums_meters_and_reads_shape(tmp_path):
    rd = _write_run_dir(tmp_path)
    row = harvest_row(rd, {"fixture": "mini", "armOverlap": "fold",
                           "runId": "ab1", "engineRef": "abc123",
                           "exitCode": 0, "cellDir": "/tmp/cell"})
    assert row["fixture"] == "mini"
    assert row["armOverlap"] == "fold"
    assert row["engine"] == "one-driver"
    assert row["verdict"] == "approved"
    assert row["wallClockSec"] == 600.0          # first ts -> last ts
    assert row["outputTokens"] == 1200           # summed worker:end meters
    assert row["tokens"] == {"input": 15, "output": 1200, "cacheRead": 70,
                             "cacheCreation": 7, "costUsd": 0.12}
    assert row["waveShape"] == [["1", "2"], ["3"]]
    assert row["invalid"] is None


def test_harvest_row_nonzero_exit_records_failure_verdict(tmp_path):
    rd = _write_run_dir(tmp_path)
    with open(rd / "events.jsonl", "a") as f:
        f.write(json.dumps({"ts": "2026-08-30T10:11:00.000Z",
                            "kind": "driver:fail", "verdict": "gate-red",
                            "detail": "suite failed"}) + "\n")
    row = harvest_row(rd, {"fixture": "mini", "armOverlap": "serialize",
                           "runId": "ab2", "engineRef": "abc123",
                           "exitCode": 1, "cellDir": "/tmp/cell"})
    assert row["verdict"] == "gate-red"
    assert row["invalid"] is None


def test_harvest_row_missing_events_is_invalid(tmp_path):
    rd = tmp_path / "empty-run"
    rd.mkdir()
    row = harvest_row(rd, {"fixture": "mini", "armOverlap": "fold",
                           "runId": "ab3", "engineRef": "abc123",
                           "exitCode": 1, "cellDir": "/tmp/cell"})
    assert row["invalid"] == "no-events"


def test_engine_repo_parts_exist_at_head():
    for part in ENGINE_REPO_PARTS:
        assert (ROOT / part).exists(), part
```

- [ ] **Step 2: Run the tests, confirm they fail** (`python3 -m pytest tests/test_ab_lib.py -q` — ImportError)

- [ ] **Step 3: Implement `evals/ab_lib.py`**

Interface-complete requirements; glue may be sketched in code as the implementer sees fit:

```python
ENGINE_REPO_PARTS = ("skills/ultrapowers/scripts", "fleet/confine-hook.mjs")

def build_cell(fixture, repo_root, workspace, fixtures_root=None):
    """fixtures_root defaults to repo_root/'evals/fixtures'. Copies
    <fixtures_root>/<fixture>/project/* to <workspace>/<fixture>/ (workspace
    created), copies plan.md beside it, copies each ENGINE_REPO_PARTS tree
    from repo_root, then `git init -b main` + one commit (user
    'ab-rig <ab@localhost>' configured locally). Returns the cell path.
    Reads fixtures only — never writes under fixtures_root."""

def harvest_row(run_dir, meta):
    """Builds the runs.jsonl row from the run dir's events.jsonl + args.json.
    wallClockSec = seconds between first and last event ts (ISO-8601 'Z').
    tokens = the five-way sum over every worker:end meter (models list
    excluded); outputTokens mirrors tokens['output'] for historical-row
    compatibility. verdict = 'approved' when meta['exitCode'] == 0, else the
    last driver:fail event's verdict (or 'failed' if none). waveShape = task
    ids per wave from args.json. invalid = 'no-events' when events.jsonl is
    missing/empty, else None. Row carries: startedAt (first ts), fixture,
    armOverlap, engine='one-driver', engineRef, runId, mode='local',
    wallClockSec, tokens, outputTokens, verdict, waveShape, cellDir, invalid."""
```

- [ ] **Step 4: Run the tests, confirm they pass**
- [ ] **Step 5: Commit** (`git add evals/ab_lib.py tests/test_ab_lib.py && git commit -m "feat(#402): A/B cell assembly + harvest library"`)

---

### Task 2: Credential seeding (`evals/ab_auth.py`)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `evals/ab_auth.py`
- Test: `tests/test_ab_auth.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `seed_worker_auth(base_env: dict, run=subprocess.run, home: Path | None = None) -> dict` — a copy of base_env with `CLAUDE_CODE_OAUTH_TOKEN` set, or `SystemExit` with a loud, token-free message.

**Parallelization rationale:** the credential path is the one high-stakes surface in this plan; isolating it in its own module with its own adversarial review keeps the blast radius one file. It shares nothing with Task 1.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_ab_auth.py
import json, pathlib, sys
import pytest
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
from ab_auth import seed_worker_auth

CRED = {"claudeAiOauth": {"accessToken": "tok-live-123", "refreshToken": "r"}}


class _Result:
    def __init__(self, code, out):
        self.returncode, self.stdout = code, out


def test_keychain_token_lands_in_env_only():
    calls = []
    def fake_run(cmd, **kw):
        calls.append(cmd)
        return _Result(0, json.dumps(CRED))
    env = seed_worker_auth({"PATH": "/bin"}, run=fake_run,
                           home=pathlib.Path("/nonexistent"))
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == "tok-live-123"
    assert env["PATH"] == "/bin"
    assert calls and calls[0][0] == "security"          # Keychain first
    # timeout guards the GUI-prompt hang (deleted rig, #107 lineage)


def test_file_fallback_when_keychain_empty(tmp_path):
    (tmp_path / ".claude").mkdir()
    (tmp_path / ".claude" / ".credentials.json").write_text(json.dumps(CRED))
    env = seed_worker_auth({}, run=lambda *a, **k: _Result(1, ""),
                           home=tmp_path)
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == "tok-live-123"


def test_oserror_falls_through_to_file(tmp_path):
    (tmp_path / ".claude").mkdir()
    (tmp_path / ".claude" / ".credentials.json").write_text(json.dumps(CRED))
    def raising_run(*a, **k):
        raise OSError("no security binary")
    env = seed_worker_auth({}, run=raising_run, home=tmp_path)
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == "tok-live-123"


def test_no_credentials_exits_loud_without_leaking(tmp_path, capsys):
    with pytest.raises(SystemExit):
        seed_worker_auth({}, run=lambda *a, **k: _Result(1, ""), home=tmp_path)
    err = capsys.readouterr().err + str(capsys.readouterr().out)
    assert "tok-" not in err


def test_malformed_credential_json_exits_loud(tmp_path):
    with pytest.raises(SystemExit):
        seed_worker_auth({}, run=lambda *a, **k: _Result(0, "not json"),
                         home=tmp_path)


def test_input_env_is_not_mutated():
    base = {"A": "1"}
    seed_worker_auth(base, run=lambda *a, **k: _Result(0, json.dumps(CRED)),
                     home=pathlib.Path("/nonexistent"))
    assert base == {"A": "1"}
```

- [ ] **Step 2: Run the tests, confirm they fail** (`python3 -m pytest tests/test_ab_auth.py -q` — ImportError)

- [ ] **Step 3: Implement `evals/ab_auth.py` exactly** (adversarial task — code verbatim):

```python
#!/usr/bin/env python3
"""Credential seeding for local A/B cells (#402 item 6).

The engine (fleet/run-main.mjs) gives every worker a throwaway per-run
CLAUDE_CONFIG_DIR and lets the credential ride the inherited env as
CLAUDE_CODE_OAUTH_TOKEN. Locally that env var does not exist — the operator's
live credential sits in the macOS Keychain (or ~/.claude/.credentials.json on
Linux, where that file IS the live store). This module extracts the live
access token at cell start. Lineage: seed_credentials in the deleted rig
(git show 44e0d15^:evals/ab_runner.py) — same Keychain-then-file chain, same
GUI-prompt timeout; the difference is the destination (env var, not a copied
credentials file) because the engine owns the config dir now.

Access tokens expire: a cell that fails auth mid-run is rerun after the
operator refreshes (open claude interactively once). Loud over stale.
The token value itself must never appear in any message this module emits.
"""
import json
import subprocess
import sys
from pathlib import Path


def seed_worker_auth(base_env, run=subprocess.run, home=None):
    """Return a copy of base_env with CLAUDE_CODE_OAUTH_TOKEN set from the
    live credential store, or SystemExit with a token-free message."""
    home = Path(home) if home is not None else Path.home()
    cred_text = ""
    try:
        # timeout: a locked keychain / untrusting ACL raises a GUI prompt;
        # over SSH that blocks forever and the file fallback is never reached.
        kc = run(["security", "find-generic-password",
                  "-s", "Claude Code-credentials", "-w"],
                 capture_output=True, text=True, timeout=10)
        cred_text = kc.stdout.strip() if kc.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        cred_text = ""
    if not cred_text:
        cred_file = home / ".claude" / ".credentials.json"
        cred_text = cred_file.read_text() if cred_file.is_file() else ""
    token = ""
    if cred_text:
        try:
            token = (json.loads(cred_text).get("claudeAiOauth") or {}) \
                .get("accessToken") or ""
        except json.JSONDecodeError:
            sys.exit("ab_auth: credential store present but unparseable — "
                     "not JSON. Open claude interactively once to refresh, "
                     "then rerun the cell.")
    if not token:
        sys.exit("ab_auth: no live credential found — Keychain item "
                 "'Claude Code-credentials' and %s both came up empty. "
                 "Open claude interactively once, then rerun the cell."
                 % (home / ".claude" / ".credentials.json"))
    env = dict(base_env)
    env["CLAUDE_CODE_OAUTH_TOKEN"] = token
    return env
```

- [ ] **Step 4: Run the tests, confirm they pass**
- [ ] **Step 5: Commit** (`git add evals/ab_auth.py tests/test_ab_auth.py && git commit -m "feat(#402): live-credential seeding for local cells"`)

---

### Task 3: The cell runner CLI (`evals/ab_runner.py`)

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Create: `evals/ab_runner.py`
- Test: `tests/test_ab_runner.py`

**Interfaces:**
- Consumes: `build_cell(fixture, repo_root, workspace, fixtures_root=None)` and `harvest_row(run_dir, meta)` from Task 1; `seed_worker_auth(base_env, run=..., home=...)` from Task 2.
- Produces: `main(argv, run=subprocess.run) -> int` and the CLI `python3 evals/ab_runner.py <fixture> --overlap fold|serialize [--run-id ID] [--results-dir DIR]`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_ab_runner.py
import json, os, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
import ab_runner
from ab_runner import main

CRED = json.dumps({"claudeAiOauth": {"accessToken": "tok-x"}})


def _fixture_tree(tmp_path):
    fx = tmp_path / "fixtures" / "mini"
    (fx / "project").mkdir(parents=True)
    (fx / "project" / "app.py").write_text("x = 1\n")
    (fx / "plan.md").write_text("# P\n\n### Task 1: A\n")
    return tmp_path / "fixtures"


def _stub_run(record, engine_exit=0):
    """One stub for every subprocess: answers the Keychain probe with CRED and
    fabricates a run dir when the engine command appears."""
    class R:
        def __init__(self, code, out=""):
            self.returncode, self.stdout, self.stderr = code, out, ""
    def run(cmd, **kw):
        record.append((cmd, kw))
        if cmd[0] == "security":
            return R(0, CRED)
        if cmd[0] == "node":
            cell = pathlib.Path(cmd[cmd.index("--repo") + 1])
            run_id = cmd[2]
            rd = cell / ".claude" / "ultrapowers" / ("run-" + run_id)
            rd.mkdir(parents=True)
            (rd / "events.jsonl").write_text(json.dumps(
                {"ts": "2026-08-30T10:00:00.000Z", "kind": "driver:stage",
                 "stage": "preflight"}) + "\n" + json.dumps(
                {"ts": "2026-08-30T10:01:00.000Z", "kind": "worker:end",
                 "label": "impl:1", "role": "implementer",
                 "meter": {"input": 1, "output": 7, "cacheRead": 0,
                           "cacheCreation": 0, "costUsd": 0.0, "models": []}}) + "\n")
            (rd / "args.json").write_text(json.dumps({"waves": [[{"id": "1"}]]}))
            return R(engine_exit)
        return R(0)  # git plumbing inside build_cell runs real; nothing else does
    return run


def test_one_cell_end_to_end_appends_a_row(tmp_path, monkeypatch):
    record = []
    results = tmp_path / "results"
    rc = main(["mini", "--overlap", "fold", "--run-id", "ab-t1",
               "--results-dir", str(results),
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws")],
              run=_stub_run(record))
    assert rc == 0
    rows = [json.loads(l) for l in
            (results / "runs.jsonl").read_text().splitlines()]
    assert len(rows) == 1
    row = rows[0]
    assert (row["fixture"], row["armOverlap"], row["runId"]) == ("mini", "fold", "ab-t1")
    assert row["engine"] == "one-driver"
    assert row["outputTokens"] == 7
    # the engine invocation used the assembled cell and the fold arm:
    node_cmd = next(c for c, kw in record if c[0] == "node")
    assert node_cmd[1].endswith("fleet/run-main.mjs")
    assert "--overlap" in node_cmd and node_cmd[node_cmd.index("--overlap") + 1] == "fold"
    # the engine env carried the seeded token; the parent env was not mutated:
    node_kw = next(kw for c, kw in record if c[0] == "node")
    assert node_kw["env"]["CLAUDE_CODE_OAUTH_TOKEN"] == "tok-x"
    assert "CLAUDE_CODE_OAUTH_TOKEN" not in os.environ or \
        os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") != "tok-x"


def test_engine_failure_still_appends_a_row_and_exits_nonzero(tmp_path):
    record = []
    results = tmp_path / "results"
    rc = main(["mini", "--overlap", "serialize", "--run-id", "ab-t2",
               "--results-dir", str(results),
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws")],
              run=_stub_run(record, engine_exit=1))
    assert rc != 0
    rows = [json.loads(l) for l in
            (results / "runs.jsonl").read_text().splitlines()]
    assert len(rows) == 1 and rows[0]["verdict"] != "approved"


def test_unknown_fixture_refuses_before_spawning_anything(tmp_path):
    record = []
    rc = main(["nope", "--overlap", "fold",
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws"),
               "--results-dir", str(tmp_path / "results")],
              run=_stub_run(record))
    assert rc != 0
    assert not any(c[0] == "node" for c, kw in record)


def test_overlap_is_mandatory_and_validated(tmp_path):
    rc = main(["mini", "--overlap", "sideways",
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws"),
               "--results-dir", str(tmp_path / "results")],
              run=_stub_run([]))
    assert rc != 0
```

- [ ] **Step 2: Run the tests, confirm they fail**

- [ ] **Step 3: Implement `evals/ab_runner.py`**

Interface-complete requirements; glue may be sketched:

```python
def main(argv, run=subprocess.run):
    """Parse: fixture positional; --overlap fold|serialize (required,
    validated); --run-id (default 'ab-' + UTC yyyymmddHHMMSS); --results-dir
    (default evals/results under the repo root); --fixtures-root and
    --workspace (test seams; default evals/fixtures and a mkdtemp).
    Refuse (return 2, no subprocess) when the fixture dir or its plan.md is
    missing. Then: build_cell -> seed_worker_auth(os.environ, run=run) ->
    invoke ['node', str(repo_root/'fleet/run-main.mjs'), 'plan.md', run_id,
    '--repo', str(cell), '--overlap', arm] with cwd=repo_root and the seeded
    env (run(...) via the seam; NO timeout is fine — the operator watches) ->
    harvest_row(cell/'.claude/ultrapowers'/('run-'+run_id), meta) with
    engineRef = `git rev-parse --short HEAD` in repo_root -> append the row
    (one json.dumps line) to results_dir/'runs.jsonl' (parents created) ->
    print the row to stdout -> return 0 iff engine exit was 0.
    The seeded env goes ONLY to the engine subprocess; os.environ untouched."""
```

The runner prints where the cell repo and run dir live so the operator can inspect transcripts; it does not copy them into results (the run dir already holds events, envelopes and receipts — copying was the old rig's workaround for OS tmp cleanup, and `--workspace` now lets the operator choose a durable location instead).

- [ ] **Step 4: Run the tests, confirm they pass**
- [ ] **Step 5: Run the full suite** (`python3 -m pytest -q`) — expected: green
- [ ] **Step 6: Commit** (`git add evals/ab_runner.py tests/test_ab_runner.py && git commit -m "feat(#402): one-driver A/B cell runner"`)

---

### Task 4: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3

**Files:**
- Test: `tests/test_ab_lib.py`, `tests/test_ab_auth.py`, `tests/test_ab_runner.py`

Run: `python3 -m pytest -q` — the whole committed suite green, including the three new test files.

---

### Task 5: Operator smoke — one real cell per arm

**Type:** manual
**Depends-on:** 4

**Files:**
- Test: `evals/results/runs.jsonl`

On the laptop (never a sandbox), with no other suite or fleet run active:

```bash
python3 evals/ab_runner.py wide --overlap fold
python3 evals/ab_runner.py wide --overlap serialize
```

Each appends one row to `evals/results/runs.jsonl` and prints it. This is the real-binary probe the stubbed tests cannot give (two claims, two tests): it proves credential seeding against the live Keychain, the engine invocation, and the harvest against real events. Cells ride the laptop subscription (~20–40 min each; check `/usage` first). The registered fold-vs-serialize protocol across fixtures is scheduled separately by the operator.

---

## Operator smoke

- do: `python3 evals/ab_runner.py wide --overlap fold` (laptop, nothing else running)
- see: the engine runs for ~20–40 min, then one JSON row prints with `"verdict": "approved"`, a plausible `wallClockSec`, and non-zero `outputTokens`; the same row is the new last line of `evals/results/runs.jsonl`.
- do: `python3 evals/ab_runner.py wide --overlap serialize`, then compare the two rows' `waveShape`.
- see: the serialize row's `waveShape` has at least as many waves; on contention fixtures (`contend*`) it must have more.
- do: `python3 evals/ab_runner.py nonexistent --overlap fold`
- see: an immediate refusal naming the missing fixture — no engine run, no row.
