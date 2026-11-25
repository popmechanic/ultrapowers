import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not installed")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "skills/ultrawrite/stories/jev_checks.ts")


FIXTURE = os.path.join(ROOT, "evals/fixtures/product/product.json")


def run(*args):
    r = subprocess.run(["bun", TOOL, *args], capture_output=True, text=True, timeout=30)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def record_dir(tmp_path):
    shutil.copy(FIXTURE, tmp_path / "product.json")
    return str(tmp_path)


def test_a_stage_is_required(tmp_path):
    code, _, err = run(record_dir(tmp_path))
    assert code == 2
    assert err.startswith("usage:")


def test_the_bundle_stage_is_gone(tmp_path):
    code, _, err = run(record_dir(tmp_path), "--stage", "bundle")
    assert code == 2
    assert err.startswith("usage:")


def test_the_retired_ask_file_flag_prints_usage(tmp_path):
    code, _, err = run(record_dir(tmp_path), "--ask-file", "x", "--stage", "map")
    assert code == 2
    assert err.startswith("usage:")
