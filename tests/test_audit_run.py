"""audit_run.py: deterministic post-run effort audit (issue #20).
Synthetic fixture transcripts — no engine dependency; if the real engine's
layout drifts, the script degrades to its advisory diagnostic."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
AUDIT = ROOT / "skills/ultrapowers/scripts/audit_run.py"

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


def test_flags_misrank_candidate_above_1_5x_same_model_median(tmp_path):
    agent_file(tmp_path, "a1", IMPL_1, "model-x", turns=10)
    agent_file(tmp_path, "a2", IMPL_9, "model-x", turns=10)
    agent_file(tmp_path, "a3", IMPL_7, "model-x", turns=40)   # 4x the median
    p = run_audit(tmp_path)
    assert "Tier-misrank candidates" in p.stdout
    assert "impl:7" in p.stdout.split("Tier-misrank candidates")[1]


def test_no_flagging_under_two_same_model_samples(tmp_path):
    agent_file(tmp_path, "a1", IMPL_7, "model-x", turns=40)
    agent_file(tmp_path, "a2", IMPL_9, "model-y", turns=10)
    p = run_audit(tmp_path)
    assert "No tier-misrank candidates" in p.stdout


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
