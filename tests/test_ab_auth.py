"""ab_auth: live-credential seeding for local A/B cells. Never runs `security`
or `claude` for real -- every test injects a stub through the `run` seam."""
import json, pathlib, subprocess, sys
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
        calls.append((cmd, kw))
        return _Result(0, json.dumps(CRED))
    env = seed_worker_auth({"PATH": "/bin"}, run=fake_run,
                           home=pathlib.Path("/nonexistent"))
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == "tok-live-123"
    assert env["PATH"] == "/bin"
    assert calls and calls[0][0][0] == "security"       # Keychain first
    assert calls[0][0] == ["security", "find-generic-password",
                           "-s", "Claude Code-credentials", "-w"]
    # timeout guards the GUI-prompt hang (deleted rig, #107 lineage)
    assert calls[0][1]["timeout"] == 10
    # the token is the only key the seam adds
    assert set(env) == {"PATH", "CLAUDE_CODE_OAUTH_TOKEN"}


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


def test_timeout_falls_through_to_file(tmp_path):
    """A locked keychain raises a GUI prompt; over SSH that hangs until the
    timeout fires -- the file fallback must still be reached."""
    (tmp_path / ".claude").mkdir()
    (tmp_path / ".claude" / ".credentials.json").write_text(json.dumps(CRED))
    def timing_out_run(*a, **k):
        raise subprocess.TimeoutExpired(cmd="security", timeout=10)
    env = seed_worker_auth({}, run=timing_out_run, home=tmp_path)
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == "tok-live-123"


def test_no_credentials_exits_loud_without_leaking(tmp_path, capsys):
    with pytest.raises(SystemExit) as excinfo:
        seed_worker_auth({}, run=lambda *a, **k: _Result(1, ""), home=tmp_path)
    err = capsys.readouterr().err + str(capsys.readouterr().out)
    assert "tok-" not in err
    # the message is the only place a token could surface, and it is loud
    message = str(excinfo.value)
    assert "tok-" not in message
    assert "no live credential found" in message
    assert str(tmp_path / ".claude" / ".credentials.json") in message


def test_malformed_credential_json_exits_loud(tmp_path):
    with pytest.raises(SystemExit) as excinfo:
        seed_worker_auth({}, run=lambda *a, **k: _Result(0, "not json"),
                         home=tmp_path)
    assert "unparseable" in str(excinfo.value)


def test_credential_without_token_exits_loud(tmp_path):
    """Well-formed JSON with no accessToken is as unusable as no file."""
    with pytest.raises(SystemExit) as excinfo:
        seed_worker_auth({}, run=lambda *a, **k: _Result(0, json.dumps(
            {"claudeAiOauth": {"refreshToken": "r"}})), home=tmp_path)
    assert "no live credential found" in str(excinfo.value)


def test_input_env_is_not_mutated():
    base = {"A": "1"}
    seed_worker_auth(base, run=lambda *a, **k: _Result(0, json.dumps(CRED)),
                     home=pathlib.Path("/nonexistent"))
    assert base == {"A": "1"}
