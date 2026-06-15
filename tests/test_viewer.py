"""Swarm viewer: renderer bakes a valid DAG; watcher reads engine footprints.

The viewer is deliberately decoupled from the engine (it observes git
artifacts), so these tests pin the two contracts it does depend on: the
compile_plan.py JSON shape consumed by render_viewer.py, and the
worktree-wf_* / ultra/integration-* naming observed by swarm_watch.py
(the same conventions sweep_worktrees.sh cleans up).
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
PLAN = ROOT / "tests/fixtures/marked-plan.md"


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


def test_render_viewer_bakes_dag(tmp_path):
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    assert "/*__DAG_JSON__*/null" not in html, "placeholder not replaced"
    assert "ULTRAPOWERS" in html
    dag = json.loads(re.search(r"const DAG = (\{.*?\});\n", html).group(1))
    assert dag["waves"] and dag["tasks"] and "edges" in dag
    ids = {t["id"] for t in dag["tasks"]}
    for wave in dag["waves"]:
        assert set(wave) <= ids, "waves reference unknown task ids"


def test_render_viewer_javascript_parses(tmp_path):
    node = shutil.which("node")
    if not node:
        import pytest
        pytest.skip("node not available")
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    js = re.search(r"<script>\n(.*)</script>", html, re.S).group(1)
    js_file = tmp_path / "embedded.js"
    js_file.write_text(js)
    run([node, "--check", str(js_file)])


def test_render_viewer_all_themes(tmp_path):
    out = run([sys.executable, str(SCRIPTS / "render_viewer.py"), "--list-themes"])
    themes = out.stdout.split()
    assert len(themes) == 10
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--out", str(tmp_path), "--all"])
    for name in themes:
        html = (tmp_path / f"swarm-{name}.html").read_text()
        assert "/*__THEME_JSON__*/null" not in html
        assert f'"name": "{name}"' in html


def test_template_has_audit_drawer_inert_without_transcripts(tmp_path):
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    # drawer markup present
    assert 'id="drawer"' in html
    assert "closeDrawer" in html
    # placeholders present and inert (no --transcripts given)
    assert "/*__AUDIT_INDEX__*/null" in html
    assert "/*__AUDIT_EMBED__*/null" in html
    assert "/*__AUDIT_JS__*/" in html
    # drawer references the Task 1 API by name
    assert "AuditProjection" in html


# A richer synthetic agent than test_audit_run's: includes tool_use and
# tool_result blocks so projection has something to render. Built in tmp_path
# (not a committed fixture) so same-wave test runs stay concurrency-safe.
IMPL_PROMPT = ("SAFETY: ...\n\nYou are an implementer subagent operating inside a dedicated git worktree.\n\n"
               "TASK:\n### Task {tid}: do the thing\nbody\n")
REVIEW_PROMPT = ("SAFETY: ...\n\nYou are an independent reviewer. You receive the original task text.\n\n"
                 "### Task {tid}: do the thing\n")
MERGE_PROMPT = "SAFETY: ...\n\nYou are the wave merge agent, operating on the session repo main checkout.\n"


def _write_agent(run_dir, name, first_user, worktree="/wt/x"):
    lines = [
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "text", "text": first_user}]}}),
        "not json {{{",  # malformed line, must be skipped
        json.dumps({"type": "assistant", "version": "2.1.177",
                    "message": {"model": "test-model",
                                "usage": {"output_tokens": 11},
                                "content": [{"type": "text", "text": "I'll start by reading the plan."},
                                            {"type": "tool_use", "name": "Read", "input": {"file": "x.py"}}]}}),
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "tool_result", "content": "240 lines"}]}}),
    ]
    (run_dir / f"agent-{name}.jsonl").write_text("\n".join(lines) + "\n")
    (run_dir / f"agent-{name}.meta.json").write_text(
        json.dumps({"agentType": "workflow-subagent", "worktreePath": worktree}))


def _make_run(tmp_path):
    run_dir = tmp_path / "wf_test"
    run_dir.mkdir()
    _write_agent(run_dir, "a1", IMPL_PROMPT.format(tid="1"))
    _write_agent(run_dir, "a2", REVIEW_PROMPT.format(tid="1"))
    _write_agent(run_dir, "a3", MERGE_PROMPT)
    return run_dir


def test_render_with_transcripts_bakes_index_and_symlinks(tmp_path):
    run_dir = _make_run(tmp_path)
    out = tmp_path / "out"
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(run_dir), "--out", str(out)])
    html = (out / "swarm.html").read_text()
    assert "/*__AUDIT_INDEX__*/null" not in html, "index placeholder not replaced"
    assert "/*__AUDIT_JS__*/" not in html, "audit_project.js not inlined"
    assert "globalThis.AuditProjection" in html, "module body inlined"
    # impl agent classified to task '1' (== DAG station id '1')
    assert '"role": "impl"' in html and '"task": "1"' in html
    assert '"role": "merge"' in html  # run-level agent present
    # live mode: symlink to the raw transcript next to swarm.html, no copy
    link = out / "agent-a1.jsonl"
    assert link.is_symlink(), "expected a symlink in live mode"
    assert pathlib.Path(os.readlink(link)).name == "agent-a1.jsonl"


def test_render_embed_bakes_content_without_symlinks(tmp_path):
    run_dir = _make_run(tmp_path)
    out = tmp_path / "out"
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(run_dir), "--embed", "--out", str(out)])
    html = (out / "swarm.html").read_text()
    assert "/*__AUDIT_EMBED__*/null" not in html, "embed placeholder not replaced"
    assert "240 lines" in html, "tool_result content baked for offline use"
    assert not (out / "agent-a1.jsonl").exists(), "embed mode must not create symlinks"


def test_transcripts_out_must_differ_from_run_dir(tmp_path):
    run_dir = _make_run(tmp_path)
    import subprocess as sp
    p = sp.run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
                "--transcripts", str(run_dir), "--out", str(run_dir)],
               capture_output=True, text=True)
    assert p.returncode != 0
    assert "read-only" in (p.stdout + p.stderr).lower()


def test_swarm_watch_observes_engine_footprints(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    def git(*args):
        return run(["git", *args], cwd=repo)

    git("init", "-q")
    git("config", "commit.gpgsign", "false")
    git("config", "user.name", "t")
    git("config", "user.email", "t@t")
    (repo / "f.txt").write_text("base\n")
    git("add", "-A")
    git("commit", "-qm", "baseline")
    git("checkout", "-qb", "ultra/integration-test")
    git("worktree", "add", "-q", "-b", "worktree-wf_impl-t1",
        str(repo / ".claude/worktrees/wf_impl-t1"))
    wt = repo / ".claude/worktrees/wf_impl-t1"
    run(["git", "config", "commit.gpgsign", "false"], cwd=wt)
    (wt / "t1.txt").write_text("work\n")
    run(["git", "add", "-A"], cwd=wt)
    run(["git", "commit", "-qm", "task 1"], cwd=wt)

    out = run([sys.executable, str(SCRIPTS / "swarm_watch.py"),
               "--repo", str(repo), "--out", str(tmp_path), "--once"])
    snap = json.loads(out.stdout)
    assert snap["integration"]["branch"] == "ultra/integration-test"
    (branch,) = snap["branches"]
    assert branch["name"] == "worktree-wf_impl-t1"
    assert branch["ahead"] == 1 and branch["merged"] is False
    assert branch["worktree"].endswith("wf_impl-t1")

    git("merge", "-q", "worktree-wf_impl-t1", "-m", "merge task 1")
    out = run([sys.executable, str(SCRIPTS / "swarm_watch.py"),
               "--repo", str(repo), "--out", str(tmp_path), "--once"])
    snap = json.loads(out.stdout)
    (branch,) = snap["branches"]
    assert branch["merged"] is True
    assert (tmp_path / "status.json").exists()
