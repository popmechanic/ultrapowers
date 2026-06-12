import re

DEFAULTS = {"host": "localhost", "port": 8000, "debug": False}


def parse_value(raw):
    if raw.lower() == "true":
        return True
    if raw.lower() == "false":
        return False
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    return raw


def load_env_overrides(environ):
    out = {}
    for key, value in environ.items():
        if key.startswith("CONFKIT_"):
            out[key[len("CONFKIT_"):].lower()] = parse_value(value)
    return out


def load_file(path):
    out = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                raise ValueError("bad line")
            key, _, value = line.partition("=")
            out[key.strip()] = parse_value(value.strip())
    return out


def get_config(path=None, environ=None):
    cfg = dict(DEFAULTS)
    if path is not None:
        cfg.update(load_file(path))
    if environ is not None:
        cfg.update(load_env_overrides(environ))
    return cfg
