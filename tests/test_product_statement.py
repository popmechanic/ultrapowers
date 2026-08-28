"""Pin (not a guard): the product statement of map #366 Amendment 1 decision 6 —
ultrapowers executes on an exe.dev fleet the operator provisions; the plugin is
the client; there is no local engine. README and both manifests must say it in
the same words, so a description edit cannot quietly reintroduce a local engine."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SENTINEL = "runs on an exe.dev fleet"


def test_readme_carries_the_product_sentence():
    assert SENTINEL in (ROOT / "README.md").read_text()


def test_plugin_manifest_carries_the_product_sentence():
    plugin = json.loads((ROOT / ".claude-plugin/plugin.json").read_text())
    assert SENTINEL in plugin["description"]


def test_marketplace_entry_carries_the_product_sentence():
    market = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text())
    entry = next(p for p in market["plugins"] if p["name"] == "ultrapowers")
    assert SENTINEL in entry["description"]
