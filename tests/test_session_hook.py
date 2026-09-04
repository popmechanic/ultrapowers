"""The SessionStart routing hook: the deterministic half of plan routing.

The ultrawrite skill description makes authoring-with-ultrawrite LIKELY; the
hook makes it RELIABLE by injecting the rule into every session's context.
These tests pin the hook config shape, the script's output, and the sharpened
trigger description so none of the three legs regresses silently."""
import json
import pathlib
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
    assert "ultrapowers:ultrawrite" in out
    # #390 cutover: ultrawrite OWNS plan bodies, so rule 1 names it alone — the
    # writing-plans co-invocation sentence (and the ultraplan skill) are gone.
    assert "ultraplan" not in out
    assert "superpowers:writing-plans" not in out
    assert "/ultrapowers <plan-path>" in out
    assert "subagent-driven-development" in out   # the three-option handoff
    assert "executing-plans" in out



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


def test_ultrawrite_description_names_no_writing_plans():
    frontmatter = (ROOT / "skills/ultrawrite/SKILL.md").read_text().split("---")[1]
    # The external dependency is named as RETIRED, never as a co-invocation.
    assert "superpowers:writing-plans" not in frontmatter


def test_session_start_carries_no_reflex_recommendation():
    p = subprocess.run(["bash", str(ROOT / "hooks/session_start.sh")],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    out = p.stdout
    # The reflex crown is gone: the hook no longer tags a marked plan as the
    # recommended route before any analysis has happened.
    assert "(recommended for marked plans)" not in out

# (The waves.js install tests died at 0.3.0 with the install step itself.)
