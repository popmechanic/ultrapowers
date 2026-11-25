import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not installed")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "skills/ultrawrite/stories/jev_checks.ts")


def run(*args):
    r = subprocess.run(["bun", TOOL, *args], capture_output=True, text=True, timeout=30)
    return r.returncode, r.stdout.strip()


def test_a_stage_is_required(tmp_path):
    assert run(str(tmp_path))[0] == 2


def test_the_bundle_stage_is_gone(tmp_path):
    assert run(str(tmp_path), "--stage", "bundle")[0] == 2
