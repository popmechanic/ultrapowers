"""Lockstep guard: plugin.json and marketplace.json must carry the SAME version.
A release bumps both; plugin.json wins silently if they drift (CLAUDE.md gotcha;
observed live as ledger finding 5000bc37c482ec5c)."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
PLUGIN = ROOT / ".claude-plugin/plugin.json"
MARKETPLACE = ROOT / ".claude-plugin/marketplace.json"


def test_plugin_and_marketplace_versions_match():
    plugin_version = json.loads(PLUGIN.read_text())["version"]
    market = json.loads(MARKETPLACE.read_text())
    entry = next(p for p in market["plugins"] if p["name"] == "ultrapowers")
    assert entry["version"] == plugin_version, (
        f"version drift: plugin.json={plugin_version!r} but marketplace.json "
        f"plugins[ultrapowers]={entry['version']!r} — a release must bump BOTH"
    )
