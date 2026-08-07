# Eval-Cell Config Isolation Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The eval kit can no longer write to the operator's environment: `prepare_engine` loses its marketplace registration, session cells run under a throwaway `CLAUDE_CONFIG_DIR`, and the harvest reads transcripts from that throwaway — per spec `docs/superpowers/specs/2026-08-06-eval-config-isolation-design.md` (issue #107).

**Architecture:** `prepare_session_config(engine_wt, workspace)` builds an isolated config dir and returns the complete env mapping; `probe_workflow`/`drive_run` consume it verbatim at their `subprocess.run` sites; `_session_transcript` derives its glob root from the same config dir; one subprocess-capture pin asserts no eval-spawned `claude` invocation can address the operator's config. Live isolation unknowns (Keychain auth, enablement + superpowers in a virgin config) are proven by the existing probe before any drive — CI never invokes `claude`.

**Tech Stack:** Python 3 (stdlib only), pytest with monkeypatched `subprocess`.

**Acceptance:** suite — plus the runbook's live checks at the next real eval run (isolation probe, real token counts from the throwaway, operator `/plugin` unaffected).

## Global Constraints

- Only `evals/ab_runner.py` and `tests/test_ab_runner_isolation.py` (new) change. No engine, gate, skill, or frozen-periphery surfaces — in particular `run_acceptance.sh` is untouched (the seal-vault residual is out of scope, named in the spec).
- CI tests never invoke `claude` (the eval-test standing rule): all subprocess behavior is captured/monkeypatched.
- The operator-config invariant is absolute: after this change no code path in `ab_runner.py` may run a `claude` command without `CLAUDE_CONFIG_DIR` pointing inside the cell workspace, except none — `prepare_engine`'s registration is deleted, not conditioned.
- No new dependencies, no Anthropic SDK, no API keys.
- Suite gate: `python3 -m pytest` green after every task.

---

### Task 1: Delete the registration; build `prepare_session_config`; thread the env; add the pin

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `evals/ab_runner.py`
- Test: `tests/test_ab_runner_isolation.py`

**Interfaces:**
- Consumes: existing `prepare_engine`, `probe_workflow`, `drive_run`, `main` in `ab_runner.py`; `CLAUDE_FLAGS`.
- Produces: `prepare_session_config(engine_wt, workspace) -> dict` — a complete env mapping (a copy of `os.environ` plus `CLAUDE_CONFIG_DIR=<workspace>/claude-config`) after materializing the pinned engine inside that config dir; `probe_workflow(workdir, env)` and `drive_run(workdir, plan, env)` accept and pass the mapping to every `claude` invocation.

Tier: standard.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_ab_runner_isolation.py
"""The #107 regression pin: no eval-spawned `claude` invocation can address
the operator's config. Every captured claude command either does not happen
(prepare_engine — the deletion pin) or carries CLAUDE_CONFIG_DIR inside the
cell workspace."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "evals"))
import ab_runner as ab


class Capture:
    def __init__(self):
        self.calls = []

    def __call__(self, cmd, **kw):
        self.calls.append((list(cmd), kw))
        class R:
            returncode = 0
            stdout = "{}"
            stderr = ""
        return R()


def claude_calls(cap):
    return [(c, kw) for c, kw in cap.calls if c and c[0] == "claude"]


def test_prepare_engine_never_invokes_claude(tmp_path, monkeypatch):
    cap = Capture()
    monkeypatch.setattr(ab.subprocess, "run", cap)
    ab.prepare_engine("HEAD", tmp_path)          # git worktree add is fine
    assert claude_calls(cap) == []               # the deletion pin


def test_prepare_session_config_writes_only_inside_workspace(tmp_path, monkeypatch):
    cap = Capture()
    monkeypatch.setattr(ab.subprocess, "run", cap)
    ws = tmp_path / "cell"
    ws.mkdir()
    env = ab.prepare_session_config(tmp_path / "engine-wt", ws)
    cfg = env["CLAUDE_CONFIG_DIR"]
    assert cfg.startswith(str(ws))
    for cmd, kw in claude_calls(cap):            # registration/enablement calls
        assert kw.get("env", {}).get("CLAUDE_CONFIG_DIR") == cfg


def test_probe_and_drive_carry_the_isolated_env(tmp_path, monkeypatch):
    cap = Capture()
    monkeypatch.setattr(ab.subprocess, "run", cap)
    env = {"CLAUDE_CONFIG_DIR": str(tmp_path / "cell/claude-config"), "PATH": "/usr/bin"}
    ab.probe_workflow(tmp_path, env)
    (tmp_path / ".headless-result.json").write_text("{}")
    ab.drive_run(tmp_path, {"planPath": "docs/plans/plan.md"}, env)
    calls = claude_calls(cap)
    assert calls, "probe/drive spawned no claude at all — wiring broke"
    for cmd, kw in calls:
        got = kw.get("env", {}).get("CLAUDE_CONFIG_DIR", "")
        assert got == env["CLAUDE_CONFIG_DIR"]
```

Note for the implementer: `drive_run` aborts via `sys.exit` when the probe fails — restructure the test's drive call if needed so both functions' `claude` invocations are captured (e.g., monkeypatch `ab.probe_workflow` to return True for the drive test half). The assertion that matters is the env on every captured `claude` call.

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_ab_runner_isolation.py -v`
Expected: FAIL — `prepare_engine` still invokes `claude`; `prepare_session_config` undefined; `probe_workflow`/`drive_run` reject the env argument.

- [ ] **Step 3: Implement**

In `evals/ab_runner.py`:

1. `prepare_engine`: delete the `claude plugin marketplace add` call and its comment; the function creates the worktree and returns it.
2. Add `prepare_session_config(engine_wt, workspace)`:

```python
def prepare_session_config(engine_wt, workspace):
    """Materialize the pinned engine inside a throwaway CLAUDE_CONFIG_DIR and
    return the complete env mapping session cells use verbatim (#107: the
    operator's config is unwritable by construction — every claude invocation
    the eval kit spawns carries this mapping). Registration + enablement land
    in the throwaway; partial throwaway state on failure is disposable garbage.
    Live-proven by the probe before any drive: Keychain auth, enablement, and
    the superpowers dependency (spec §3)."""
    cfg = Path(workspace) / "claude-config"
    cfg.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["CLAUDE_CONFIG_DIR"] = str(cfg)
    for cmd in (["claude", "plugin", "marketplace", "add", str(engine_wt)],
                ["claude", "plugin", "install", "ultrapowers@ultrapowers"]):
        r = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit("prepare_session_config: %r failed inside the throwaway "
                     "config (%s) — operator config untouched.\n%s"
                     % (" ".join(cmd), cfg, (r.stderr or r.stdout or "").strip()))
    return env
```

   The exact enablement incantation is a named verification unknown (spec §3): if `claude plugin install` is not the working form, adjust to the form the probe proves (e.g., seeding `settings.json` `enabledPlugins`) — the unit pin constrains only that every invocation carries the throwaway `CLAUDE_CONFIG_DIR`. Materializing `superpowers` into the throwaway (from its marketplace or the plugin cache) belongs in this loop too once the working form is known; leave a clearly-marked follow-the-probe comment if headless verification is impossible in the sandbox.
3. `probe_workflow(workdir, env)` and `drive_run(workdir, plan, env)`: accept the mapping; every `subprocess.run(["claude", …])` passes `env=env` (drive_run merges its `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` into a copy of the mapping rather than `os.environ`).
4. `main`: `engine = prepare_engine(...)`; `env = prepare_session_config(engine, <cell workspace dir>)`; pass `env` through the `probe_workflow`/`drive_run` call sites. The jsdeps/script-only cell path calls `prepare_engine` only — no config, no registration.

- [ ] **Step 4: Run the tests, then the full suite**

Run: `python3 -m pytest tests/test_ab_runner_isolation.py -v && python3 -m pytest`
Expected: green (existing eval unit tests touch assembly/harvest only and keep passing).

- [ ] **Step 5: Commit**

```bash
git add evals/ab_runner.py tests/test_ab_runner_isolation.py
git commit -m "feat(#107): eval cells run under a throwaway CLAUDE_CONFIG_DIR; prepare_engine registration deleted; operator-config pin added"
```

---

### Task 2: Harvest reads the throwaway — loud failure on a missing transcript

**Type:** implementation
**Depends-on:** 1
**Review:** lean

**Files:**
- Modify: `evals/ab_runner.py`
- Test: `tests/test_ab_runner_isolation.py`

**Interfaces:**
- Consumes: the Task 1 env mapping (`CLAUDE_CONFIG_DIR` key) at the `main` call site.
- Produces: `_session_transcript(result_path, config_dir)` — globs `<config_dir>/projects/**/<session_id>.jsonl`; raises `SystemExit` with the expected path when the result names a session but no transcript is found (never the silent raw-result fallback).

Tier: cheap.

- [ ] **Step 1: Write the failing tests**

```python
def test_session_transcript_reads_from_config_dir(tmp_path):
    cfg = tmp_path / "claude-config"
    tdir = cfg / "projects" / "-slug"
    tdir.mkdir(parents=True)
    (tdir / "sess-1.jsonl").write_text("{}")
    result = tmp_path / "result.json"
    result.write_text('{"session_id": "sess-1"}')
    assert ab._session_transcript(result, cfg) == tdir / "sess-1.jsonl"


def test_missing_transcript_is_loud_not_silent(tmp_path):
    cfg = tmp_path / "claude-config"
    cfg.mkdir()
    result = tmp_path / "result.json"
    result.write_text('{"session_id": "sess-gone"}')
    import pytest
    with pytest.raises(SystemExit) as e:
        ab._session_transcript(result, cfg)
    assert "sess-gone" in str(e.value)


def test_no_session_id_still_falls_back_to_result(tmp_path):
    # a crashed run with no session_id keeps today's row-still-harvests behavior
    cfg = tmp_path / "claude-config"
    cfg.mkdir()
    result = tmp_path / "result.json"
    result.write_text("{}")
    assert ab._session_transcript(result, cfg) == result
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_ab_runner_isolation.py -v -k transcript`
Expected: FAIL — `_session_transcript` takes one argument and globs `~/.claude`.

- [ ] **Step 3: Implement**

Re-signature `_session_transcript(result_path, config_dir)`: glob `<config_dir>/projects/**/<session_id>.jsonl`. When `session_id` is present but no match: `sys.exit` naming the session id and the expected glob root (the spec's loud-failure rule — a silently-zeroed `outputTokens` row is worse than a crash). When the result carries no `session_id` at all (crashed run), keep today's raw-result fallback so the crash-row path still harvests. Update the `main`/harvest call site to pass `env["CLAUDE_CONFIG_DIR"]`.

- [ ] **Step 4: Run the tests, then the full suite**

Run: `python3 -m pytest tests/test_ab_runner_isolation.py -v && python3 -m pytest`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add evals/ab_runner.py tests/test_ab_runner_isolation.py
git commit -m "feat(#107): harvest reads the throwaway config's transcripts; missing transcript fails loud"
```
