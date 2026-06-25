"""Resolve the ACTIVE superpowers install(s) from the settings cascade plus
installed_plugins.json. Read-only: never mutates plugin config. The old check
listed one hard-coded cache directory and so read a DISABLED install's version;
this reads `enabledPlugins` (the authoritative active signal) instead."""
import argparse
import json
import pathlib


def _load(path):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except Exception:
        return {}


def _enabled_map(claude_home, project):
    """Merge enabledPlugins across the settings cascade; later files win."""
    home = pathlib.Path(claude_home)
    proj = pathlib.Path(project)
    merged = {}
    for p in (home / "settings.json",
              proj / ".claude/settings.json",
              proj / ".claude/settings.local.json"):
        merged.update(_load(p).get("enabledPlugins", {}))
    return merged


def resolve_active(claude_home, project):
    enabled = _enabled_map(claude_home, project)
    installed = _load(pathlib.Path(claude_home) / "plugins/installed_plugins.json").get("plugins", {})
    active = []
    for key, entries in installed.items():
        name = key.split("@", 1)[0]
        if name != "superpowers":
            continue
        if enabled.get(key) is False:  # explicit false disables; absent => enabled
            continue
        marketplace = key.split("@", 1)[1] if "@" in key else None
        for e in (entries if isinstance(entries, list) else [entries]):
            active.append({
                "marketplace": marketplace,
                "installPath": e.get("installPath"),
                "version": e.get("version"),
                "gitCommitSha": e.get("gitCommitSha"),
            })
    return {"active": active, "ambiguous": len(active) > 1}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--claude-home", default=str(pathlib.Path.home() / ".claude"))
    ap.add_argument("--project", default=".")
    a = ap.parse_args()
    print(json.dumps(resolve_active(a.claude_home, a.project), indent=2))


if __name__ == "__main__":
    main()
