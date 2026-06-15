"""The SessionStart routing hook: the deterministic half of plan routing.

The ultraplan skill description makes layering-onto-writing-plans LIKELY; the
hook makes it RELIABLE by injecting the rule into every session's context.
These tests pin the hook config shape, the script's output, and the sharpened
trigger description so none of the three legs regresses silently."""
import json
import pathlib
import re
import subprocess
import tempfile

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


def test_session_start_installs_saved_workflows_before_registry_snapshot():
    # Root cause of "Workflow 'ultrapowers-probe' not found": the engine
    # snapshots its saved-workflow registry at session start, but Step 4a
    # copied the harnesses MID-session — too late to register. The hook must
    # install them at session start (CLAUDE_PROJECT_DIR/.claude/workflows) so
    # they exist before the snapshot, for every registered harness.
    with tempfile.TemporaryDirectory() as proj:
        p = subprocess.run(["bash", str(ROOT / "hooks/session_start.sh")],
                           capture_output=True, text=True,
                           env={"CLAUDE_PROJECT_DIR": proj, "PATH": _path()})
        assert p.returncode == 0, p.stderr
        wf = pathlib.Path(proj) / ".claude" / "workflows"
        manifests = sorted((ROOT / "skills/ultrapowers/harnesses").glob("*.harness.json"))
        assert manifests, "no harness manifests to install"
        for m in manifests:
            spec = json.loads(m.read_text())
            installed = wf / spec["file"]
            assert installed.exists(), f"hook did not install {spec['file']}"
            # meta.name must survive the copy — that is what the engine resolves by.
            name = re.search(r"meta\s*=\s*\{.*?name:\s*'([^']+)'",
                             installed.read_text(), re.S)
            assert name and name.group(1) == spec["name"]


def test_session_start_install_does_not_pollute_routing_context():
    # The hook's stdout becomes session context; the install must be silent so
    # only the routing rule reaches the model.
    with tempfile.TemporaryDirectory() as proj:
        p = subprocess.run(["bash", str(ROOT / "hooks/session_start.sh")],
                           capture_output=True, text=True,
                           env={"CLAUDE_PROJECT_DIR": proj, "PATH": _path()})
        assert p.returncode == 0, p.stderr
        out = p.stdout.strip()
        assert out.startswith("<ultrapowers-routing>")
        assert out.endswith("</ultrapowers-routing>")


def _path():
    import os
    return os.environ.get("PATH", "/usr/bin:/bin:/usr/local/bin")


def test_ultraplan_description_triggers_on_every_plan():
    # The description is the probabilistic trigger: it must fire at the
    # plan-writing MOMENT, not only when /ultrapowers was already chosen.
    frontmatter = (ROOT / "skills/ultraplan/SKILL.md").read_text().split("---")[1]
    assert "EVERY implementation plan" in frontmatter
    assert "superpowers:writing-plans" in frontmatter
