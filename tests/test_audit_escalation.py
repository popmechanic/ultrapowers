import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts"))
import audit_run


def _impl_file(d, n, task_id, model, turns, out_per_turn):
    lines = [json.dumps({"type": "user", "message": {"role": "user", "content": [
        {"type": "text", "text": f'You are an implementer subagent. Implement the object whose "id" is "{task_id}".'}]}})]
    for _ in range(turns):
        lines.append(json.dumps({"type": "assistant", "message": {"role": "assistant",
            "model": model, "usage": {"output_tokens": out_per_turn},
            "content": [{"type": "text", "text": "x"}]}}))
    (d / f"agent-{n}.jsonl").write_text("\n".join(lines) + "\n")


def test_escalated_task_detected(tmp_path):
    _impl_file(tmp_path, 1, "1", "claude-haiku-4-5-20251001", 5, 100)
    _impl_file(tmp_path, 2, "1", "claude-sonnet-4-6", 5, 200)
    out = audit_run.audit(tmp_path)
    assert out["escalatedTasks"] == ["1"]


def test_single_impl_not_escalated(tmp_path):
    _impl_file(tmp_path, 1, "1", "claude-sonnet-4-6", 5, 200)
    out = audit_run.audit(tmp_path)
    assert out["escalatedTasks"] == []


def test_thrash_flags_low_output_high_turns(tmp_path):
    _impl_file(tmp_path, 1, "1", "claude-haiku-4-5-20251001", 40, 10)  # 10 tok/turn, 40 turns
    out = audit_run.audit(tmp_path)
    assert [c["role"] for c in out["thrashCandidates"]] == ["impl:1"]


def test_thrash_ignores_healthy_implementer(tmp_path):
    _impl_file(tmp_path, 1, "1", "claude-sonnet-4-6", 37, 90)  # 90 tok/turn -> healthy
    out = audit_run.audit(tmp_path)
    assert out["thrashCandidates"] == []


def test_missing_dir_has_empty_signals(tmp_path):
    out = audit_run.audit(tmp_path / "nope")
    assert out["escalatedTasks"] == [] and out["thrashCandidates"] == []
