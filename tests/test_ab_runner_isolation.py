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


def test_drive_carries_the_isolated_env(tmp_path, monkeypatch):
    # The probe died with the registry snapshot (Phase 0 row 5); the drive is
    # the only claude spawn left and must carry the cell's isolated env.
    cap = Capture()
    monkeypatch.setattr(ab.subprocess, "run", cap)
    env = {"CLAUDE_CONFIG_DIR": str(tmp_path / "cell/claude-config"), "PATH": "/usr/bin"}
    (tmp_path / ".headless-result.json").write_text("{}")
    ab.drive_run(tmp_path, {"planPath": "docs/plans/plan.md"}, env)
    calls = claude_calls(cap)
    assert calls, "drive spawned no claude at all — wiring broke"
    for cmd, kw in calls:
        got = kw.get("env", {}).get("CLAUDE_CONFIG_DIR", "")
        assert got == env["CLAUDE_CONFIG_DIR"]


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
