# tests/test_harvest_runs.py
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import harvest_runs as h


def _rec(type_, content):
    return {"type": type_, "message": {"role": type_, "content": content}}


REAL = [
    _rec("user", [{"type": "text", "text": "build the thing"}]),
    _rec("assistant", [{"type": "tool_use", "name": "Workflow", "input": {"name": "ultrapowers-run"}}]),
    _rec("user", [{"type": "tool_result", "content": [{"type": "text",
        "text": "Transcript dir: /tmp/run-x\n{\"integrationBranch\":\"ultra/x\"}"}]}]),
]
DISCUSSION = [
    _rec("user", [{"type": "text", "text": "let's discuss /ultrapowers and integrationBranch"}]),
    _rec("assistant", [{"type": "text", "text": "integrationBranch is a report field; Transcript dir: explained"}]),
]


def test_real_run_detected():
    assert h.is_real_run(REAL) is True


def test_discussion_only_not_detected():
    assert h.is_real_run(DISCUSSION) is False


def test_classify_origin_home_and_worktree_variants():
    home = "-Users-marcusestes-Websites-ultrapowers"
    assert h.classify_origin(home, home) == "home"
    assert h.classify_origin(home + "--claude-worktrees-foo", home) == "home"
    assert h.classify_origin("-Users-marcusestes-Documents-Legal-x", home) == "foreign"


def test_slice_keeps_user_turns_and_run_turns_drops_noise():
    recs = [
        _rec("user", [{"type": "text", "text": "build the thing"}]),
        _rec("assistant", [{"type": "text", "text": "Wave 1: tasks A, B"}]),
        _rec("assistant", [{"type": "text", "text": "unrelated chatter about lunch"}]),
    ]
    out = h.slice_transcript(recs)
    assert "build the thing" in out
    assert "Wave 1" in out
    assert "lunch" not in out


def test_build_bundle_writes_json_and_slice(tmp_path):
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in REAL) + "\n")
    cache = tmp_path / "cache"
    home = "-Users-marcusestes-Websites-ultrapowers"
    out = h.build_bundle(session, "-Users-marcusestes-Documents-Legal-x", cache, home)
    assert out is not None
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["origin"] == "foreign"
    assert bundle["planPath"] is None or isinstance(bundle["planPath"], str)
    assert set(bundle) >= {"runId", "sessionId", "projectSlug", "origin", "gateReport", "audit"}
    assert (out / "slice.md").exists()


def test_build_bundle_skips_non_run(tmp_path):
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in DISCUSSION) + "\n")
    out = h.build_bundle(session, "any", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    assert out is None


def test_harvest_is_incremental_and_idempotent(tmp_path):
    projects = tmp_path / "projects" / "-Users-marcusestes-Documents-Legal-x"
    projects.mkdir(parents=True)
    (projects / "s1.jsonl").write_text("\n".join(json.dumps(r) for r in REAL) + "\n")
    cache = tmp_path / "cache"
    home = "-Users-marcusestes-Websites-ultrapowers"
    first = h.harvest(tmp_path / "projects", cache, home)
    assert len(first) == 1
    second = h.harvest(tmp_path / "projects", cache, home)
    assert second == []  # watermark -> nothing new


# --- #64: extractors must anchor on Workflow STRUCTURE, not the first prose
# match. Fixture mirrors the real transcript shape: the Workflow tool_use input
# is {name, args} with args a JSON *string*; skill prose earlier in the session
# carries the literal `<plan-path>` placeholder and a report-format schema whose
# "required" array contains "integrationBranch".
DOC_DENSE = [
    # skill prose — the trap (placeholder, a "Transcript dir:" prose mention, and
    # a schema-shaped integrationBranch with no real value)
    _rec("user", [{"type": "text", "text":
        'Run `/ultrapowers <plan-path>`. The "Transcript dir:" path is printed at '
        'launch. Report schema: {"type":"object","required":["integrationBranch","waves"]}.'}]),
    # the REAL launch — input is {name, args}; args is a JSON STRING
    _rec("assistant", [{"type": "tool_use", "name": "Workflow",
        "input": {"name": "ultrapowers-run",
                  "args": json.dumps({"planPath": "docs/superpowers/plans/real-plan.md",
                                       "integrationBranch": "ultra/real"})}}]),
    # the REAL launch result — tool_result carrying the authoritative abs path
    _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text":
        "Workflow launched.\n"
        "Transcript dir: /Users/x/.claude/projects/p/subagents/workflows/wf_real\n"
        "Run ID: wf_real"}]}]),
    # a tool_result holding a schema DECOY before the (here absent) real report
    _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text":
        'schema {"type":"object","required":["integrationBranch","waves"]} end'}]}]),
]


def test_plan_path_reads_workflow_args_json_string_not_prose():
    assert h._plan_path(DOC_DENSE) == "docs/superpowers/plans/real-plan.md"


def test_plan_path_skips_placeholder_when_no_tool_use():
    recs = [_rec("user", [{"type": "text", "text": "see `/ultrapowers <plan-path>`"}])]
    assert h._plan_path(recs) is None  # a bare placeholder is not a real path


def test_transcript_dir_from_tool_result_is_absolute_not_prose():
    assert h._transcript_dir(DOC_DENSE) == \
        "/Users/x/.claude/projects/p/subagents/workflows/wf_real"


def test_transcript_dir_prefers_dir_with_agents(tmp_path):
    probe = tmp_path / "wf_probe"; probe.mkdir()           # zero agents (a probe run)
    run = tmp_path / "wf_run"; run.mkdir()
    (run / "agent-1.jsonl").write_text("{}\n")             # the real run
    recs = [
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": f"Transcript dir: {probe}"}]}]),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": f"Transcript dir: {run}"}]}]),
    ]
    assert h._transcript_dir(recs) == str(run)


def test_gate_report_returns_none_when_only_schema_decoy_present():
    # the report-format schema has "integrationBranch" in a "required" array but
    # no real top-level value — must NOT be mistaken for a gate report
    assert h._gate_report(DOC_DENSE) is None


def test_gate_report_extracts_real_report_skipping_decoy():
    recs = [_rec("user", [{"type": "tool_result", "content": [{"type": "text", "text":
        'schema {"type":"object","required":["integrationBranch"]} '
        'result {"integrationBranch":"ultra/real","waves":[["1"]],"tasks":[]} '
        'usage {"tokens":5}'}]}])]
    gr = h._gate_report(recs)
    assert gr is not None and gr["integrationBranch"] == "ultra/real"
