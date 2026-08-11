"""Unit tests for the shared *.harness.json runtime reader (spec
2026-08-10-eval-kit-reader-consolidation). scan() is the single runtime
manifest contract for the session hook and the eval kit."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/ultrapowers/scripts/harness_manifest.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from harness_manifest import scan


def _manifest(d, name, fname=None, raw=None, backing=True):
    (d / name).write_text(raw if raw is not None else json.dumps({"file": fname}))
    if fname and backing:
        (d / fname).write_text("// harness\n")


def test_scan_orders_by_manifest_filename_not_file_value(tmp_path):
    _manifest(tmp_path, "a.harness.json", "z.js")
    _manifest(tmp_path, "z.harness.json", "a.js")
    files, problems = scan(tmp_path)
    assert files == ["z.js", "a.js"]  # a.harness.json sorts first
    assert problems == []


def test_scan_reports_unparseable_json_as_problem(tmp_path):
    _manifest(tmp_path, "good.harness.json", "good.js")
    _manifest(tmp_path, "bad.harness.json", raw="{not json")
    files, problems = scan(tmp_path)
    assert files == ["good.js"]
    assert problems == ["bad.harness.json: unparseable JSON"]


def test_scan_reports_missing_file_key_as_problem(tmp_path):
    _manifest(tmp_path, "nokey.harness.json", raw=json.dumps({"name": "x"}))
    files, problems = scan(tmp_path)
    assert files == []
    assert problems == ["nokey.harness.json: missing `file` key"]


def test_scan_reports_absent_backing_file_as_problem(tmp_path):
    _manifest(tmp_path, "ghost.harness.json", "ghost.js", backing=False)
    files, problems = scan(tmp_path)
    assert files == []
    assert problems == ["ghost.harness.json: backing file ghost.js absent"]


def test_scan_of_missing_dir_is_empty_not_an_error(tmp_path):
    assert scan(tmp_path / "nowhere") == ([], [])


def test_cli_stdout_carries_only_filenames(tmp_path):
    _manifest(tmp_path, "good.harness.json", "good.js")
    _manifest(tmp_path, "bad.harness.json", raw="{not json")
    p = subprocess.run([sys.executable, str(SCRIPT), str(tmp_path)],
                       capture_output=True, text=True)
    assert p.returncode == 0
    assert p.stdout.splitlines() == ["good.js"]   # problems never on stdout
    assert "bad.harness.json" in p.stderr


def test_scan_docstring_carries_the_backward_tolerance_rule():
    import harness_manifest
    doc = harness_manifest.scan.__doc__ or ""
    assert "extend" in doc.lower() and "never replace" in doc.lower()
