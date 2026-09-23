"""Tests for hooks/keep_working.sh, the Stop hook ultrawrite/ultrapowers declare."""
import json
import pathlib
import subprocess

HOOK = pathlib.Path(__file__).resolve().parent.parent / "hooks" / "keep_working.sh"

BLOCK_INPUT = {
    "stop_hook_active": False,
    "background_tasks": [
        {"id": "a1", "type": "subagent", "status": "running",
         "description": "Author wave-1 plan R1", "agent_type": "general-purpose"},
        {"id": "m2", "type": "monitor", "status": "running",
         "description": "run-9 transitions"},
    ],
    "session_crons": [],
}

ALLOW_INPUTS = [
    {"stop_hook_active": True, "background_tasks": [
        {"id": "a1", "type": "subagent", "status": "running", "description": "x"}]},
    {"stop_hook_active": False, "background_tasks": []},
    {"stop_hook_active": False},
    {"stop_hook_active": False, "background_tasks": [
        {"id": "a1", "type": "shell", "status": "completed", "description": "done"}]},
]

RAW_ALLOW_INPUTS = ["", "not json"]


def run_hook(input_text):
    result = subprocess.run(
        ["bash", str(HOOK)], input=input_text, capture_output=True, text=True
    )
    return result.returncode, result.stdout


def test_block_when_background_work_running():
    rc, out = run_hook(json.dumps(BLOCK_INPUT))
    assert rc == 0
    lines = [l for l in out.splitlines() if l.strip()]
    assert len(lines) == 1
    d = json.loads(lines[0])
    reason = d["reason"]
    assert d["decision"] == "block"
    assert reason.startswith(
        "Background work is still in flight:\n"
        "- subagent: Author wave-1 plan R1\n"
        "- monitor: run-9 transitions\n\n"
        "Before idling, ask yourself: is there anything else productive to do while that runs"
    )
    assert reason.endswith("say so in one line and stop.")
    hso = d["hookSpecificOutput"]
    assert hso["hookEventName"] == "Stop"
    assert hso["continueLoop"] is True
    assert hso["additionalContext"] == reason


def test_allow_cases_produce_no_output():
    for inp in ALLOW_INPUTS:
        rc, out = run_hook(json.dumps(inp))
        assert rc == 0 and out == ""
    for inp in RAW_ALLOW_INPUTS:
        rc, out = run_hook(inp)
        assert rc == 0 and out == ""
