"""Runs the checker's own bun tests (factory/stack/tinyapp/*.test.ts) inside
the pytest gate. Skips, naming the tool, when bun is missing."""
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_bun_tests_for_the_checker():
    if shutil.which("bun") is None:
        pytest.skip("bun is not on PATH")
    r = subprocess.run(["bun", "test", "factory/stack/tinyapp"], cwd=ROOT,
                       capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
