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
    model, turns, out_tokens, wall_sec, _first = collect(tmp_path / "agent-a1.jsonl")
    assert model == "test-model" and turns == 2 and out_tokens == 20
    assert wall_sec == 90.0


def test_collect_wall_sec_zero_when_timestamps_absent(tmp_path):
    from audit_run import collect
    agent_file(tmp_path, "a1", IMPL_7, "test-model", turns=2)  # no `timestamp` field at all
    _model, _turns, _out_tokens, wall_sec, _first = collect(tmp_path / "agent-a1.jsonl")
    assert wall_sec == 0.0


def test_collect_wall_sec_zero_with_single_timestamp(tmp_path):
    from audit_run import collect
    agent_file_ts(tmp_path, "a1", IMPL_7, "test-model", ["2026-08-18T00:00:00.000Z"])
    _model, _turns, _out_tokens, wall_sec, _first = collect(tmp_path / "agent-a1.jsonl")
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


# --- Task 2 (#224): FILES-line task attribution, attempt numbering, liveWallSecByTask.

IMPL_FILES_ONLY = ("SAFETY: ...\n\nYou are an implementer subagent operating inside a dedicated git worktree.\n"
                   "\nBASE: abc\nFILES: commands/kb-setup.md, tests/test_setup.py\n"
                   "SIBLING FILES: 1: app/lib.ts\n\nTASK:\nAMEND (two gate findings) on the merged file.\n")
REVIEW_FILES_ONLY = ("SAFETY: ...\n\nYou are an independent reviewer. You receive the original task text.\n"
                     "\nFILES: commands/kb-setup.md, tests/test_setup.py\n")
FILES_BY_TASK = {"1": ["app/lib.ts"], "5": ["commands/kb-setup.md", "tests/test_setup.py"],
                 "6": ["CLAUDE.md"]}


def test_classify_falls_back_to_files_line_join():
    from audit_run import classify
    assert classify(IMPL_FILES_ONLY) == "impl:?"                    # no launch: today's answer
    assert classify(IMPL_FILES_ONLY, FILES_BY_TASK) == "impl:5"
    assert classify(REVIEW_FILES_ONLY, FILES_BY_TASK) == "review:5"
    # order-insensitive, and an ambiguous (non-unique) match stays '?'
    assert classify(IMPL_FILES_ONLY, {"5": ["tests/test_setup.py", "commands/kb-setup.md"]}) == "impl:5"
    assert classify(IMPL_FILES_ONLY, {"5": FILES_BY_TASK["5"], "7": FILES_BY_TASK["5"]}) == "impl:?"
    # an explicit id line still wins over the FILES join
    assert classify(IMPL_ID_2 + "\nFILES: commands/kb-setup.md, tests/test_setup.py\n", FILES_BY_TASK) == "impl:2"


def test_audit_accepts_files_by_task_for_attribution(tmp_path):
    from audit_run import audit
    agent_file(tmp_path, "a1", IMPL_FILES_ONLY, "test-model", turns=1)
    assert [a["role"] for a in audit(tmp_path)["agents"]] == ["impl:?"]
    assert [a["role"] for a in audit(tmp_path, FILES_BY_TASK)["agents"]] == ["impl:5"]


def test_audit_numbers_attempts_and_reports_live_wall_sec(tmp_path):
    from audit_run import audit
    # task 7: a zombie first attempt (8000 s) then the live retry (900 s)
    agent_file_ts(tmp_path, "z1", IMPL_7, "test-model",
                  ["2026-08-19T10:00:00Z", "2026-08-19T12:13:20Z"])   # 8000 s
    agent_file_ts(tmp_path, "a2", IMPL_7, "test-model",
                  ["2026-08-19T12:20:00Z", "2026-08-19T12:35:00Z"])   # 900 s
    agent_file_ts(tmp_path, "b1", IMPL_9, "test-model",
                  ["2026-08-19T10:00:00Z", "2026-08-19T10:05:00Z"])   # 300 s
    data = audit(tmp_path)
    by_file = {a["file"]: a for a in data["agents"]}
    assert by_file["agent-z1.jsonl"]["attempt"] == 1
    assert by_file["agent-a2.jsonl"]["attempt"] == 2
    assert by_file["agent-b1.jsonl"]["attempt"] == 1
    assert data["totals"]["wallSecByTask"] == {"7": 8900.0, "9": 300.0}     # raw sum unchanged
    assert data["totals"]["liveWallSecByTask"] == {"7": 900.0, "9": 300.0}  # last attempt only
    assert data["escalatedTasks"] == ["7"]


def test_audit_attempt_order_falls_back_to_filename_without_timestamps(tmp_path):
    from audit_run import audit
    agent_file(tmp_path, "b", IMPL_7, "test-model", turns=1)
    agent_file(tmp_path, "a", IMPL_7, "test-model", turns=1)
    by_file = {x["file"]: x for x in audit(tmp_path)["agents"]}
    assert by_file["agent-a.jsonl"]["attempt"] == 1 and by_file["agent-b.jsonl"]["attempt"] == 2
