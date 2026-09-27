"""steps_from_rows reads rows from a directory of one-JSON-per-row files (as
ArtifactData `list ... out_dir=...` writes them), a JSON file (a list, or a
wrapped `documents`/`docs` object), or a `{"id","data":{...}}`-shaped row —
and refuses anything else."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrawrite/preview"))
import steps_from_rows as sfr  # noqa: E402

SCRIPT = ROOT / "skills/ultrawrite/preview/steps_from_rows.py"

E = [{}, {}]
ONE = [{"todos": {"0": {"text": "a"}}}, {}]


def db_row(session, at, story, step, before, after):
    return {"id": "%s-%s-%d" % (session, story, step), "session": session, "at": at, "story": story,
            "step": step, "piece": "todo", "tool": "addTodo", "args": {"text": "a"},
            "layer": "store", "ui": None, "before": before, "after": after, "see": []}


def test_load_rows_reads_a_directory_of_one_json_per_row_files(tmp_path):
    out_dir = tmp_path / "steps"
    out_dir.mkdir()
    row = db_row("s1", 100, "S1", 1, E, ONE)
    (out_dir / "doc1.json").write_text(json.dumps(row), encoding="utf-8")
    got = sfr.load_rows(str(out_dir))
    assert got == [row]


def test_load_rows_reads_a_json_file_list(tmp_path):
    row = db_row("s1", 100, "S1", 1, E, ONE)
    p = tmp_path / "rows.json"
    p.write_text(json.dumps([row]), encoding="utf-8")
    got = sfr.load_rows(str(p))
    assert got == [row]


def test_load_rows_reads_a_wrapped_json_file(tmp_path):
    row = db_row("s1", 100, "S1", 1, E, ONE)
    wrapped = {"id": "doc1", "data": row, "version": 3}
    p = tmp_path / "rows.json"
    p.write_text(json.dumps([wrapped]), encoding="utf-8")
    got = sfr.load_rows(str(p))
    assert got == [row]


def test_load_rows_unwraps_data_shaped_rows_in_a_directory(tmp_path):
    out_dir = tmp_path / "steps"
    out_dir.mkdir()
    row = db_row("s1", 100, "S1", 1, E, ONE)
    wrapped = {"id": "doc1", "data": row, "version": 1}
    (out_dir / "doc1.json").write_text(json.dumps(wrapped), encoding="utf-8")
    got = sfr.load_rows(str(out_dir))
    assert got == [row]


def test_load_rows_reads_a_documents_wrapped_json_file(tmp_path):
    row = db_row("s1", 100, "S1", 1, E, ONE)
    p = tmp_path / "rows.json"
    p.write_text(json.dumps({"documents": [row]}), encoding="utf-8")
    got = sfr.load_rows(str(p))
    assert got == [row]


def test_load_rows_refuses_an_unrecognized_input(tmp_path):
    p = tmp_path / "rows.json"
    p.write_text(json.dumps("not a list or object"), encoding="utf-8")
    with pytest.raises(SystemExit) as exc_info:
        sfr.load_rows(str(p))
    assert exc_info.value.code == 2


def test_cli_exits_2_and_names_the_path_for_an_unrecognized_input(tmp_path):
    p = tmp_path / "rows.json"
    p.write_text(json.dumps(42), encoding="utf-8")
    out = tmp_path / "steps.jsonl"
    res = subprocess.run([sys.executable, str(SCRIPT), str(p), str(out)],
                          capture_output=True, text=True)
    assert res.returncode == 2
    assert "steps_from_rows: unrecognized rows input %s" % p in res.stderr


def test_cli_reads_a_directory_end_to_end(tmp_path):
    out_dir = tmp_path / "steps"
    out_dir.mkdir()
    row = db_row("s1", 100, "S1", 1, E, ONE)
    (out_dir / "doc1.json").write_text(json.dumps(row), encoding="utf-8")
    out = tmp_path / "steps.jsonl"
    res = subprocess.run([sys.executable, str(SCRIPT), str(out_dir), str(out)],
                          capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    lines = out.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    got = json.loads(lines[0])
    assert got["story"] == "S1" and got["step"] == 1
