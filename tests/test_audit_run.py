"""audit_run.py: deterministic post-run effort audit (issue #20).
Synthetic fixture transcripts — no engine dependency; if the real engine's
layout drifts, the script degrades to its advisory diagnostic."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
AUDIT = ROOT / "skills/ultrapowers/scripts/audit_run.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))

# Every engine role prompt must classify; each marker string must exist
# verbatim in the baked source so classifier and engine cannot drift apart.
ENGINE_SOURCES = [
    (ROOT / "skills/ultrapowers/harnesses/waves.js").read_text(),
    (ROOT / "skills/ultrapowers/references/wave-merge.md").read_text(),
]

IMPL_7 = ("SAFETY: Operate ONLY inside the git worktree assigned to you.\n\n"
          "You are an implementer subagent operating inside a dedicated git worktree.\n\n"
          "TASK:\n### Task 7: fix the sweep\nbody\n")
IMPL_9 = IMPL_7.replace("### Task 7: fix the sweep", "### Task 9: docs sweep")
IMPL_1 = IMPL_7.replace("### Task 7: fix the sweep", "### Task 1: small fix")
REVIEW_7 = ("SAFETY: ...\n\nYou are an independent reviewer. You receive the original task text.\n\n"
            "### Task 7: fix the sweep\n")
MERGE = "SAFETY: ...\n\nYou are the wave merge agent, operating on the session repo main checkout.\n"


def agent_file(d, name, first_user, model, turns, tokens_each=10):
    lines = [json.dumps({"type": "user",
                         "message": {"content": [{"type": "text", "text": first_user}]}}),
             "not json {{{"]                      # malformed line: must be skipped
    for _ in range(turns):
        lines.append(json.dumps({"type": "assistant",
                                 "message": {"model": model,
                                             "usage": {"output_tokens": tokens_each}}}))
    (d / f"agent-{name}.jsonl").write_text("\n".join(lines) + "\n")


def run_audit(target):
    return subprocess.run([sys.executable, str(AUDIT), str(target)],
                          capture_output=True, text=True)


def test_classifies_roles_and_sums_effort(tmp_path):
    agent_file(tmp_path, "a1", IMPL_7, "test-model", turns=3)
    agent_file(tmp_path, "a2", REVIEW_7, "judge-model", turns=2)
    agent_file(tmp_path, "a3", MERGE, "test-model", turns=1)
    p = run_audit(tmp_path)
    assert p.returncode == 0, p.stderr
    assert "| impl:7 | test-model | 3 | 30 |" in p.stdout
    assert "| review:7 | judge-model | 2 | 20 |" in p.stdout
    assert "| merge | test-model | 1 | 10 |" in p.stdout


def test_missing_dir_is_advisory_exit_zero(tmp_path):
    p = run_audit(tmp_path / "does-not-exist")
    assert p.returncode == 0
    assert "nothing to audit" in p.stdout


def test_empty_dir_is_advisory_exit_zero(tmp_path):
    p = run_audit(tmp_path)
    assert p.returncode == 0
    assert "nothing to audit" in p.stdout


def test_unrecognized_prompt_counts_as_unknown(tmp_path):
    agent_file(tmp_path, "a1", "Some future prompt shape", "m", turns=1)
    p = run_audit(tmp_path)
    assert p.returncode == 0
    assert "| unknown | m | 1 | 10 |" in p.stdout
    assert "unclassified" in p.stdout


IMPL_ID_2 = ("SAFETY: Operate ONLY inside the git worktree assigned to you.\n\n"
             "You are an implementer subagent operating inside a dedicated git worktree.\n\n"
             'TASK: read your verbatim task text from the JSON file at /tmp/waves.json — '
             'in its "tasks" array, find the object whose "id" is "2" and use that '
             "object's \"body\" field as the authoritative task text.\n")
REVIEW_ID_3 = ("SAFETY: ...\n\nYou are an independent reviewer. You receive the original task text.\n\n"
               'find the object whose "id" is "3" and use that object\'s "body" field.\n')


def test_classifies_task_id_from_real_prompt_shape(tmp_path):
    agent_file(tmp_path, "a1", IMPL_ID_2, "test-model", turns=1)
    agent_file(tmp_path, "a2", REVIEW_ID_3, "judge-model", turns=1)
    p = run_audit(tmp_path)
    assert p.returncode == 0, p.stderr
    assert "| impl:2 | test-model | 1 | 10 |" in p.stdout
    assert "| review:3 | judge-model | 1 | 10 |" in p.stdout


def test_every_role_marker_exists_in_baked_sources():
    from audit_run import ROLE_MARKERS
    for marker, _role in ROLE_MARKERS:
        assert any(marker in src for src in ENGINE_SOURCES), marker


def test_no_engine_prompt_classifies_unknown():
    from audit_run import classify, ROLE_MARKERS
    for marker, role in ROLE_MARKERS:
        assert classify("xxx " + marker + " yyy") != "unknown"


# --- Task 7 (sensor baseline): wallSec per transcript, wallSecByTask totals.

def agent_file_ts(d, name, first_user, model, timestamps, tokens_each=10):
    """Like `agent_file` but each assistant turn carries an explicit ISO 8601
    `timestamp` (one per entry of `timestamps`), so `collect`'s wall_sec (last
    minus first record timestamp) is exercised deterministically."""
    lines = [json.dumps({"type": "user",
                         "message": {"content": [{"type": "text", "text": first_user}]}})]
    for ts in timestamps:
        lines.append(json.dumps({"type": "assistant", "timestamp": ts,
                                 "message": {"model": model,
                                             "usage": {"output_tokens": tokens_each}}}))
    (d / f"agent-{name}.jsonl").write_text("\n".join(lines) + "\n")


def test_collect_computes_wall_sec_from_first_and_last_timestamp(tmp_path):
    from audit_run import collect
    agent_file_ts(tmp_path, "a1", IMPL_7, "test-model",
                 ["2026-08-18T00:00:00.000Z", "2026-08-18T00:01:30.000Z"])
    model, turns, out_tokens, wall_sec = collect(tmp_path / "agent-a1.jsonl")
    assert model == "test-model" and turns == 2 and out_tokens == 20
    assert wall_sec == 90.0


def test_collect_wall_sec_zero_when_timestamps_absent(tmp_path):
    from audit_run import collect
    agent_file(tmp_path, "a1", IMPL_7, "test-model", turns=2)  # no `timestamp` field at all
    _model, _turns, _out_tokens, wall_sec = collect(tmp_path / "agent-a1.jsonl")
    assert wall_sec == 0.0


def test_collect_wall_sec_zero_with_single_timestamp(tmp_path):
    from audit_run import collect
    agent_file_ts(tmp_path, "a1", IMPL_7, "test-model", ["2026-08-18T00:00:00.000Z"])
    _model, _turns, _out_tokens, wall_sec = collect(tmp_path / "agent-a1.jsonl")
    assert wall_sec == 0.0


def test_audit_agents_carry_wall_sec(tmp_path):
    from audit_run import audit
    agent_file_ts(tmp_path, "a1", IMPL_7, "test-model",
                 ["2026-08-18T00:00:00.000Z", "2026-08-18T00:01:30.000Z"])
    out = audit(tmp_path)
    assert out["agents"][0]["role"] == "impl:7"
    assert out["agents"][0]["wallSec"] == 90.0


def test_audit_totals_wall_sec_by_task_sums_across_transcripts_for_one_id(tmp_path):
    # Two implementer transcripts for the SAME task id (the auto-escalate
    # retry shape): their wallSec values must sum under that id, not overwrite.
    from audit_run import audit
    agent_file_ts(tmp_path, "a1", IMPL_7, "haiku",
                 ["2026-08-18T00:00:00.000Z", "2026-08-18T00:01:00.000Z"])       # 60s
    agent_file_ts(tmp_path, "a2", IMPL_7, "sonnet",
                 ["2026-08-18T01:00:00.000Z", "2026-08-18T01:00:30.000Z"])       # 30s
    out = audit(tmp_path)
    assert out["totals"]["wallSecByTask"] == {"7": 90.0}


def test_audit_totals_wall_sec_by_task_keyed_per_task_id(tmp_path):
    from audit_run import audit
    agent_file_ts(tmp_path, "a1", IMPL_7, "m",
                 ["2026-08-18T00:00:00.000Z", "2026-08-18T00:01:00.000Z"])  # task 7: 60s
    agent_file_ts(tmp_path, "a2", IMPL_9, "m",
                 ["2026-08-18T00:00:00.000Z", "2026-08-18T00:00:10.000Z"])  # task 9: 10s
    out = audit(tmp_path)
    assert out["totals"]["wallSecByTask"] == {"7": 60.0, "9": 10.0}


def test_audit_missing_dir_totals_carry_empty_wall_sec_by_task(tmp_path):
    from audit_run import audit
    out = audit(tmp_path / "does-not-exist")
    assert out["totals"]["wallSecByTask"] == {}


# --- Task 1 (#188): Resolver role marker

RESOLVER = ("SAFETY: ...\n\nYou are a merge-conflict resolver for one file in one wave. "
            "You have no repo to explore: read exactly the hunks file named below.\n")


def test_resolver_prompt_classifies_as_resolver(tmp_path):
    from audit_run import classify
    assert classify(RESOLVER) == "resolver"
    agent_file(tmp_path, "r1", RESOLVER, "test-model", turns=2)
    p = run_audit(tmp_path)
    assert p.returncode == 0, p.stderr
    assert "| resolver | test-model | 2 | 20 |" in p.stdout
    assert "unclassified" not in p.stdout
