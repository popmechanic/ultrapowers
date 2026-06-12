"""Held-out acceptance tests for the degrade fixture. Never shown to executors."""
import pytest


def test_parse_value():
    from confkit.config import parse_value
    assert parse_value("TRUE") is True
    assert parse_value("false") is False
    assert parse_value("9000") == 9000
    assert parse_value("-3") == -3
    assert parse_value("0.0.0.0") == "0.0.0.0"


def test_load_env_overrides():
    from confkit.config import load_env_overrides
    env = {"CONFKIT_PORT": "9000", "CONFKIT_DEBUG": "true", "PATH": "/bin"}
    assert load_env_overrides(env) == {"port": 9000, "debug": True}
    assert load_env_overrides({}) == {}


def test_load_file(tmp_path):
    from confkit.config import load_file
    f = tmp_path / "app.conf"
    f.write_text("# comment\n\nhost = 0.0.0.0\nport=9100\nmotd = a=b\n")
    assert load_file(str(f)) == {"host": "0.0.0.0", "port": 9100, "motd": "a=b"}


def test_load_file_bad_line(tmp_path):
    from confkit.config import load_file
    f = tmp_path / "bad.conf"
    f.write_text("just words\n")
    with pytest.raises(ValueError, match="bad line"):
        load_file(str(f))


def test_merge_precedence(tmp_path):
    from confkit.config import get_config
    f = tmp_path / "app.conf"
    f.write_text("port=9100\ndebug=true\n")
    cfg = get_config(path=str(f), environ={"CONFKIT_PORT": "9999"})
    assert cfg == {"host": "localhost", "port": 9999, "debug": True}


def test_no_args_still_defaults():
    from confkit.config import get_config
    assert get_config() == {"host": "localhost", "port": 8000, "debug": False}
