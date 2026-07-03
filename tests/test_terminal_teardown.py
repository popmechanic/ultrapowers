"""SKILL.md Step 5 must release the run lock on EVERY terminal exit, not only
Approve — otherwise a declined / aborted / abandoned-BLOCKED run leaves RUN_LOCK
held (it has no timeout) and wedges the next /ultrapowers in the repo (P5,
spec 2026-06-27-terminal-teardown-lock-release.md)."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"


def test_lock_release_is_not_approve_exclusive():
    text = SKILL.read_text()
    # The lock release moved into the gate driver: Approve releases via
    # `ultra_gate.py --approve` and the terminal-teardown path releases via
    # `ultra_gate.py --teardown` on the non-Approve exits too. Both verbs present
    # ⇒ release is not Approve-exclusive.
    assert "--approve" in text and "--teardown" in text
    assert text.count("ultra_gate.py") >= 2


def test_terminal_teardown_section_exists_and_points_at_sweep():
    text = SKILL.read_text()
    assert "Terminal teardown" in text
    # The non-Approve paths must NOT auto-sweep (worktrees are triage evidence) —
    # they point the operator at the deterministic cleanup instead.
    assert "sweep_worktrees.sh --run" in text
