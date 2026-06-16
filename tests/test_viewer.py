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

# Minimal browser host so the inlined viewer script can BOOT under node (not just
# parse). matches:true puts it in reduced-motion mode, so construction runs but the
# rAF loop never starts; fetch rejects and setTimeout is a no-op so poll() can't hold
# the event loop open. Loaded via `node --require` so the script stays byte-identical
# (its leading 'use strict' keeps top-of-file).
DOM_STUB = """\
function elStub() {
  return {
    style: { setProperty() {} }, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    children: [], textContent: "", className: "", innerHTML: "", hidden: false,
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild(c) { this.children.push(c); return c; }, removeChild() {},
    addEventListener() {}, remove() {},
    getTotalLength() { return 1; }, getPointAtLength() { return { x: 0, y: 0 }; },
    getBBox() { return { x: 0, y: 0, width: 0, height: 0 }; },
    querySelector() { return elStub(); }, querySelectorAll() { return []; },
  };
}
global.document = {
  body: elStub(), documentElement: elStub(),
  createElement() { return elStub(); }, createElementNS() { return elStub(); },
  getElementById() { return elStub(); }, addEventListener() {},
  querySelector() { return elStub(); }, querySelectorAll() { return []; },
};
global.matchMedia = () => ({ matches: true, addEventListener() {} });
global.location = { protocol: "http:" };
global.fetch = () => Promise.reject(new Error("no network in test"));
global.requestAnimationFrame = () => 0;
global.setTimeout = () => 0;
if (!global.performance) global.performance = { now: () => 0 };
"""


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
    # The projection LIBRARY is always inlined — the template references
    # AuditProjection at script load, so it must be defined even with no run data.
    assert "/*__AUDIT_JS__*/" not in html, "library must be inlined, not left as a bare comment"
    assert "globalThis.AuditProjection" in html, "AuditProjection must be defined"
    # The DATA stays inert (no --transcripts): drawer goes quiet via a null index.
    assert "/*__AUDIT_INDEX__*/null" in html
    assert "/*__AUDIT_EMBED__*/null" in html


def test_viewer_boots_without_transcripts_under_dom_stub(tmp_path):
    # Regression for "ReferenceError: AuditProjection is not defined" at script load:
    # the depiction-only render (no --transcripts) must BOOT, not just parse. node
    # --check validates syntax only and cannot catch an undefined-reference runtime
    # error, so this executes the inlined script under a tiny DOM/host stub.
    node = shutil.which("node")
    if not node:
        import pytest
        pytest.skip("node not available")
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    js = re.search(r"<script>\n(.*)</script>", html, re.S).group(1)
    (tmp_path / "embedded.js").write_text(js)
    (tmp_path / "stub.cjs").write_text(DOM_STUB)
    p = subprocess.run(
        [node, "--require", str(tmp_path / "stub.cjs"), str(tmp_path / "embedded.js")],
        capture_output=True, text=True)
    assert p.returncode == 0, "viewer script threw at load:\n" + p.stdout + p.stderr


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


def test_render_with_transcripts_full_inlined_script_parses(tmp_path):
    # Gap #1: the suite only node --check'd the INERT template (no --transcripts),
    # where /*__AUDIT_JS__*/ is a bare comment. With --transcripts the full
    # audit_project.js is inlined; this asserts that full embedded script parses.
    node = shutil.which("node")
    if not node:
        import pytest
        pytest.skip("node not available")
    run_dir = tmp_path / "wf_x"
    run_dir.mkdir()
    (run_dir / "agent-z1.jsonl").write_text(
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "text",
                        "text": "You are an implementer subagent operating inside a dedicated git worktree.\n### Task 1: x\n"}]}})
        + "\n"
        + json.dumps({"type": "assistant", "version": "2.1.177",
                      "message": {"model": "m", "usage": {"output_tokens": 1},
                          "content": [{"type": "text", "text": "hi"},
                                      {"type": "tool_use", "name": "Read", "input": {"file": "a"}}]}})
        + "\n")
    (run_dir / "agent-z1.meta.json").write_text(
        json.dumps({"agentType": "workflow-subagent", "worktreePath": "/wt"}))
    out = tmp_path / "out"
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(run_dir), "--out", str(out)])
    html = (out / "swarm.html").read_text()
    assert "globalThis.AuditProjection" in html, "full audit_project.js was not inlined"
    js = re.search(r"<script>\n(.*)</script>", html, re.S).group(1)
    js_file = out / "embedded_full.js"
    js_file.write_text(js)
    run([node, "--check", str(js_file)])  # full inlined module must parse


def test_transcripts_must_be_a_directory(tmp_path):
    # Gap #3: render_viewer.py raises SystemExit when --transcripts is not a dir.
    not_a_dir = tmp_path / "nope.txt"
    not_a_dir.write_text("x")
    out = tmp_path / "out"
    p = subprocess.run(
        [sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(not_a_dir), "--out", str(out)],
        capture_output=True, text=True)
    assert p.returncode != 0, "expected non-zero exit for a non-directory --transcripts"
    assert "not a directory" in (p.stdout + p.stderr).lower()


def test_embed_escapes_script_close_in_transcript(tmp_path):
    run_dir = tmp_path / "wf_nasty"
    run_dir.mkdir()
    nasty = "result with </script><!-- and   a line sep"
    lines = [
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "text",
                        "text": ("You are an implementer subagent operating inside a "
                                 'dedicated git worktree.\nfind the object whose "id" is "1"\n')}]}}),
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "tool_result", "content": nasty}]}}),
    ]
    (run_dir / "agent-z1.jsonl").write_text("\n".join(lines) + "\n")
    (run_dir / "agent-z1.meta.json").write_text(
        json.dumps({"agentType": "workflow-subagent", "worktreePath": "/wt"}))
    out = tmp_path / "out"
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(run_dir), "--embed", "--out", str(out)])
    html = (out / "swarm.html").read_text()
    # the page has exactly one real closing tag — the transcript's </script> was escaped
    assert html.count("</script>") == 1, "stray </script> from transcript not escaped"
    # the AUDIT_EMBED blob still parses and round-trips the original content
    blob = re.search(r"const AUDIT_EMBED = (\{.*?\});\n", html, re.S).group(1)
    embed = json.loads(blob)                      # < etc. are valid JSON escapes
    assert "</script>" in json.dumps(embed), "content must round-trip after JSON decode"


def test_index_classifies_task_id_from_real_prompt(tmp_path):
    run_dir = tmp_path / "wf_real"
    run_dir.mkdir()
    impl = ("You are an implementer subagent operating inside a dedicated git worktree.\n"
            'find the object whose "id" is "1" and use its "body".\n')
    _write_agent(run_dir, "a1", impl)             # per-task -> task "1"
    _write_agent(run_dir, "a3", MERGE_PROMPT)     # run-level -> task null
    out = tmp_path / "out"
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(run_dir), "--out", str(out)])
    html = (out / "swarm.html").read_text()
    assert '"task": "1"' in html, "real-shape per-task agent not classified to its id"
    assert '"task": null' in html, "run-level agent must be task null"


def test_render_inlines_d3dag_and_layout(tmp_path):
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    assert "/*__D3DAG_JS__*/" not in html, "d3-dag placeholder not replaced"
    assert "/*__SWARM_LAYOUT_JS__*/" not in html, "layout placeholder not replaced"
    assert "d3-dag Version 1.1.0" in html, "vendored d3-dag not inlined"
    assert "globalThis.SwarmLayout" in html or "root.SwarmLayout" in html, "layout adapter not inlined"


def test_viewer_uses_grid_layout(tmp_path):
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)])
    html = (tmp_path / "swarm.html").read_text()
    assert "SwarmLayout.computeGrid" in html, "template must lay out via the grid adapter"
    assert "INTEGRATION" in html  # the sink label retained
    # radial scene primitives are gone — assert on tokens that DID exist in the
    # radial template (a plain "concentric" check was a tautology — never present).
    for radial in ("journeyPath", "ringR", "setAmbient", "startReviewerOrbit"):
        assert radial not in html, f"radial primitive {radial!r} still present"


def test_index_unresolved_task_is_null_not_question_mark(tmp_path):
    run_dir = tmp_path / "wf_unres"
    run_dir.mkdir()
    impl_no_id = "You are an implementer subagent operating inside a dedicated git worktree.\nno id here\n"
    _write_agent(run_dir, "a1", impl_no_id)
    out = tmp_path / "out"
    run([sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN),
         "--transcripts", str(run_dir), "--out", str(out)])
    html = (out / "swarm.html").read_text()
    assert '"task": null' in html, "unresolved task must serialize as null"
    assert '"task": "?"' not in html, "the '?' sentinel must not reach the index"
