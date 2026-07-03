import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import complexity_metric as cm


def test_skill_step_counter():
    text = ("## Step 1 — Preflight\nprose\n## Step 2 — Compile\n"
            "**4a — Install.** body\n**4a½ — Preflight.** body\n"
            "**1. Restore the checkout.** body\n**bold prose** not a step\n")
    assert cm.count_skill_steps(text) == 5  # 2 sections + 3 sub-steps


def test_engine_knob_counter():
    text = "const a = ARGS.testCmd; if (ARGS.testCmd || ARGS.waves) {} // ARGS.waves"
    assert cm.count_engine_knobs(text) == 2  # distinct: testCmd, waves


def test_enum_state_counter():
    text = "x: { enum: ['A', 'B'] }, y: { enum: ['B', 'C'] }"
    assert cm.count_enum_states(text) == 3  # A, B, C — distinct across schemas


def test_lock_verb_counter():
    text = "case $1 in\n  acquire)\n  check)\n  acquire)\n  *)\nesac\n"
    assert cm.count_lock_verbs(text) == 2  # distinct: acquire, check; '*)' excluded


def test_gate_check_counter():
    text = 'check("lock", ok)\ncheck("lock", False, "msg")\ncheck("clean-tree", ok)'
    assert cm.count_gate_checks(text) == 2  # distinct names, not call sites


def test_compile_flag_counter():
    text = 'ap.add_argument("plan", type=Path)\nap.add_argument("--emit-args", x=1)'
    assert cm.count_compile_flags(text) == 1  # positional excluded


def test_verdict_flags_regression_and_stays_quiet():
    base = {"standingConcepts": 40, "skillWords": 2000}
    worse = {"standingConcepts": 41, "skillWords": 2000}
    assert cm.verdict(worse, base) == ["standingConcepts rose 40 -> 41"]
    assert cm.verdict(base, base) == []
