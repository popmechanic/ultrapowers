from confkit.config import DEFAULTS, get_config


def test_defaults():
    assert get_config() == {"host": "localhost", "port": 8000, "debug": False}


def test_returns_copy():
    cfg = get_config()
    cfg["port"] = 1
    assert DEFAULTS["port"] == 8000
