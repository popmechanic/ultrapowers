import json
import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not installed")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES = os.path.join(ROOT, "skills/ultrawrite/themes")
SAMPLE = os.path.join(THEMES, "sample.ts")
STRUCTURE = os.path.join(THEMES, "structure.css")


def contract():
    with open(os.path.join(THEMES, "contract.json")) as f:
        return json.load(f)


def run_sample(*args):
    r = subprocess.run(["bun", SAMPLE, *args], capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout, r.stderr


def test_the_sample_renders_every_markup_slot_the_contract_lists():
    rendered = set(json.loads(run_sample("--slots")[1]))
    listed = {s["slot"] for c in contract()["components"] for s in c["slots"] if s["in"] == "markup"}
    assert listed - rendered == set()


def test_the_sample_renders_no_slot_the_contract_omits():
    rendered = set(json.loads(run_sample("--slots")[1]))
    known = {s["slot"] for c in contract()["components"] for s in c["slots"]}
    assert rendered - known == set()


def test_the_structure_sheet_declares_its_layers_first():
    assert open(STRUCTURE).read().lstrip().startswith("@layer ui-sdk, structure;")
