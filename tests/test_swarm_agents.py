"""swarm_watch.py also emits agents.json (live index + bounded recentEvents ring)
and folds per-branch commits[] into status.json. Builds a real git repo + a fixture
transcript dir in tmp_path so same-wave runs stay concurrency-safe."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
sys.path.insert(0, str(SCRIPTS))
import swarm_watch  # noqa: E402


def _run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


IMPL = ("You are an implementer subagent operating inside a dedicated git worktree.\n"
        '### Task 4: do the thing\n')
REVIEW = ("You are an independent reviewer. You receive the original task text.\n"
          "### Task 4: do the thing\n")


def _agent(run_dir, name, first_user, blocks):
    lines = [json.dumps({"type": "user", "version": "2.1.177",
                         "message": {"content": [{"type": "text", "text": first_user}]}})]
    lines.append(json.dumps({"type": "assistant", "version": "2.1.177",
                             "message": {"model": "test-model", "usage": {"output_tokens": 5},
                                         "content": blocks}}))
    (run_dir / f"agent-{name}.jsonl").write_text("\n".join(lines) + "\n")


def test_agents_index_shape_and_ring(tmp_path):
    run_dir = tmp_path / "wf_run"
    run_dir.mkdir()
    _agent(run_dir, "a1", IMPL,
           [{"type": "text", "text": "I'll start by reading the plan."},
            {"type": "tool_use", "name": "Edit", "input": {"file": "api.ts"}}])
    _agent(run_dir, "a2", REVIEW, [{"type": "text", "text": "PASS — no blocking issues"}])
    idx = swarm_watch.agents_index(run_dir, {})
    assert idx["runId"] == "wf_run" and isinstance(idx["ts"], float)
    by_id = {a["id"]: a for a in idx["agents"]}
    assert by_id["a1"]["role"] == "impl" and by_id["a1"]["task"] == "4"
    assert by_id["a1"]["tools"] == 1 and by_id["a1"]["turns"] == 1
    assert by_id["a1"]["state"] == "active" and by_id["a1"]["iter"] == 0
    assert by_id["a2"]["role"] == "review" and by_id["a2"]["task"] == "4"
    # ring: bounded, ascending ts, light {ts,task,role,kind,text}
    evs = idx["recentEvents"]
    assert evs and len(evs) <= swarm_watch.RING_MAX
    assert all(set(e) == {"ts", "task", "role", "kind", "text"} for e in evs)
    assert [e["ts"] for e in evs] == sorted(e["ts"] for e in evs)
    assert any(e["kind"] == "tool_use" and e["text"] == "Edit" for e in evs)


def test_agents_index_second_impl_is_a_fix_round(tmp_path):
    run_dir = tmp_path / "wf_fix"
    run_dir.mkdir()
    _agent(run_dir, "a1", IMPL, [{"type": "text", "text": "first pass"}])
    _agent(run_dir, "a2", IMPL, [{"type": "text", "text": "fix pass"}])
    idx = swarm_watch.agents_index(run_dir, {})
    iters = sorted(a["iter"] for a in idx["agents"] if a["role"] == "impl")
    assert iters == [0, 1], "a second impl agent on a task must be iter 1 (a fix round)"


def test_status_carries_branch_commits(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    def git(*a):
        return _run(["git", "-C", str(repo), *a])

    git("init", "-q")
    git("config", "commit.gpgsign", "false")
    git("config", "user.name", "t")
    git("config", "user.email", "t@t")
    (repo / "f.txt").write_text("base\n")
    git("add", "-A")
    git("commit", "-qm", "baseline")
    git("checkout", "-qb", "ultra/integration-test")
    git("worktree", "add", "-q", "-b", "worktree-wf_impl-t4",
        str(repo / ".claude/worktrees/wf_impl-t4"))
    wt = repo / ".claude/worktrees/wf_impl-t4"
    _run(["git", "config", "commit.gpgsign", "false"], cwd=wt)
    (wt / "t4.txt").write_text("line one\nline two\n")
    _run(["git", "add", "-A"], cwd=wt)
    _run(["git", "commit", "-qm", "feat: task 4"], cwd=wt)

    snap = swarm_watch.snapshot(repo, "ultra/integration-test")
    (branch,) = snap["branches"]
    assert branch["name"] == "worktree-wf_impl-t4"
    assert isinstance(branch["commits"], list) and len(branch["commits"]) == 1
    c = branch["commits"][0]
    assert c["subject"] == "feat: task 4"
    assert c["additions"] == 2 and c["deletions"] == 0 and c["files"] == 1
    assert isinstance(c["sha"], str) and c["sha"]


def test_watch_once_writes_agents_json(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _run(["git", "-C", str(repo), "init", "-q"])
    _run(["git", "-C", str(repo), "config", "user.name", "t"])
    _run(["git", "-C", str(repo), "config", "user.email", "t@t"])
    (repo / "f.txt").write_text("x\n")
    _run(["git", "-C", str(repo), "add", "-A"])
    _run(["git", "-C", str(repo), "commit", "-qm", "base"])
    run_dir = tmp_path / "wf_run"
    run_dir.mkdir()
    _agent(run_dir, "a1", IMPL, [{"type": "text", "text": "hi"}])
    out = tmp_path / "viewer"
    out.mkdir()
    _run([sys.executable, str(SCRIPTS / "swarm_watch.py"), "--repo", str(repo),
          "--out", str(out), "--transcripts", str(run_dir), "--once"])
    idx = json.loads((out / "agents.json").read_text())
    assert idx["agents"] and idx["agents"][0]["role"] == "impl"
