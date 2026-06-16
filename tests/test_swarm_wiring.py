"""Wiring guard: the swarm template must delegate agent partitioning and the
live-refresh decision to the AuditProjection helpers (defined in
audit_project.js, inlined at render), not keep its own inline copies."""
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
PLAN = ROOT / "tests/fixtures/marked-plan.md"


def _run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def _render(tmp_path):
    run_dir = tmp_path / "wf_wire"
    run_dir.mkdir()
    (run_dir / "agent-a1.jsonl").write_text(
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "text",
                        "text": ("You are an implementer subagent operating inside a "
                                 'dedicated git worktree.\nfind the object whose "id" is "1"\n')}]}}) + "\n")
    (run_dir / "agent-a1.meta.json").write_text(
        json.dumps({"agentType": "workflow-subagent", "worktreePath": "/wt"}))
    out = tmp_path / "out"
    _run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
          "--transcripts", str(run_dir), "--out", str(out)])
    return (out / "swarm.html").read_text()


def test_template_delegates_partition_and_refresh(tmp_path):
    html = _render(tmp_path)
    # the helpers are inlined (definition from audit_project.js) ...
    assert "function partitionAgents" in html, "partitionAgents not inlined (Task 1 missing?)"
    assert "function shouldRerender" in html, "shouldRerender not inlined (Task 1 missing?)"
    # ... and the template calls them ...
    assert "AuditProjection.partitionAgents(" in html, "template must call partitionAgents"
    assert "AuditProjection.shouldRerender(" in html, "template must call shouldRerender"
    # ... and the old inline role-gated partition is gone
    assert 'a.role === "impl" || a.role === "review"' not in html, "inline partition not removed"


def test_full_inlined_script_parses(tmp_path):
    node = shutil.which("node")
    if not node:
        import pytest
        pytest.skip("node not available")
    html = _render(tmp_path)
    js = re.search(r"<script>\n(.*)</script>", html, re.S).group(1)
    f = tmp_path / "wired.js"
    f.write_text(js)
    _run([node, "--check", str(f)])
