DEFAULTS = {"host": "localhost", "port": 8000, "debug": False}


def get_config():
    """Return a copy of the default configuration."""
    return dict(DEFAULTS)
