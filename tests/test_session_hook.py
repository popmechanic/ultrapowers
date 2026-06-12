"""The SessionStart routing hook: the deterministic half of plan routing.

The ultraplan skill description makes layering-onto-writing-plans LIKELY; the
hook makes it RELIABLE by injecting the rule into every session's context.
These tests pin the hook config shape, the script's output, and the sharpened
trigger description so none of the three legs regresses silently."""
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_hooks_json_uses_plugin_wrapper_format_and_plugin_root():
    cfg = json.loads((ROOT / "hooks/hooks.json").read_text())
    # Plugin hooks.json requires the {"hooks": {...}} wrapper (settings.json
    # uses the unwrapped form — the two are not interchangeable).
    assert "hooks" in cfg, "plugin hooks.json must wrap events in a 'hooks' key"
    starts = cfg["hooks"]["SessionStart"]
    cmds = [h["command"] for s in starts for h in s["hooks"] if h["type"] == "command"]
    assert any("${CLAUDE_PLUGIN_ROOT}/hooks/session_start.sh" in c for c in cmds), \
        "SessionStart must invoke the script via ${CLAUDE_PLUGIN_ROOT} for portability"


def test_session_start_script_emits_the_routing_rule():
    p = subprocess.run(["bash", str(ROOT / "hooks/session_start.sh")],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    out = p.stdout
    assert "ultrapowers:ultraplan" in out
    assert "superpowers:writing-plans" in out
    assert "/ultrapowers <plan-path>" in out
    assert "subagent-driven-development" in out   # the three-option handoff
    assert "executing-plans" in out
    # Anti-drift pin for the no-pause contract (2026-06-12): selecting
    # ultrapowers at the handoff IS the authorization. The hook is the copy
    # every session reads — keep it in lockstep with SKILL.md Step 3.
    assert "authorizes execution" in out
    assert "no approval pause" in out


def test_ultraplan_description_triggers_on_every_plan():
    # The description is the probabilistic trigger: it must fire at the
    # plan-writing MOMENT, not only when /ultrapowers was already chosen.
    frontmatter = (ROOT / "skills/ultraplan/SKILL.md").read_text().split("---")[1]
    assert "EVERY implementation plan" in frontmatter
    assert "superpowers:writing-plans" in frontmatter
