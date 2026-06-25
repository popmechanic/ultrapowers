"""Tests for check_engine_skew.sh — the launch-safety preflight that detects when
the installed (cached) engine differs from the repo engine, preventing stale-engine runs."""
import subprocess
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKEW = ROOT / "skills/ultrapowers/scripts/check_engine_skew.sh"


def _engine(d, body):
    (d / "skills/ultrapowers/harnesses").mkdir(parents=True, exist_ok=True)
    (d / "skills/ultrapowers/harnesses/waves.js").write_text(body)
    return d


def test_in_sync_when_engines_match(tmp_path):
    a = _engine(tmp_path / "cache", "WAVES_V1")
    b = _engine(tmp_path / "repo", "WAVES_V1")
    p = subprocess.run(["bash", str(SKEW), str(a), str(b)], capture_output=True, text=True)
    assert p.returncode == 0 and "IN_SYNC" in p.stdout


def test_skew_when_engines_differ(tmp_path):
    a = _engine(tmp_path / "cache", "OLD")
    b = _engine(tmp_path / "repo", "NEW")
    p = subprocess.run(["bash", str(SKEW), str(a), str(b)], capture_output=True, text=True)
    assert p.returncode != 0 and "SKEW" in (p.stdout + p.stderr)
