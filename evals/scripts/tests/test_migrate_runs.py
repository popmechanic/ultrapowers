# evals/scripts/tests/test_migrate_runs.py
import json
import pathlib
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import migrate_runs as m  # noqa: E402

STUB = lambda epoch: {"plugin_version": "0.0.7", "sha": "c" * 40}


def _write(tmp_path, rows):
    p = tmp_path / "runs.jsonl"
    p.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return p


def test_relabels_mixed_and_backfills_fields(tmp_path):
    p = _write(tmp_path, [
        {"run_id": "mixed-B-2", "fixture": "mixed", "blocked_tasks": 3,
         "scored_epoch": 100.0},
        {"run_id": "wide-B-1", "fixture": "wide", "blocked_tasks": 0,
         "scored_epoch": 100.0},
    ])
    out = m.migrate(p, engine_resolver=STUB)
    flawed = [r for r in out if r["run_id"] == "flawed-B-2"][0]
    assert flawed["fixture"] == "flawed"
    assert flawed["tasks_planned"] == 6 and flawed["tasks_merged"] == 3
    assert flawed["engine"] == {"plugin_version": "0.0.7", "sha": "c" * 40}
    wide = [r for r in out if r["fixture"] == "wide"][0]
    assert wide["tasks_planned"] == 6 and wide["tasks_merged"] == 6


def test_migration_is_idempotent(tmp_path):
    p = _write(tmp_path, [
        {"run_id": "mixed-A-1", "fixture": "mixed", "blocked_tasks": 0,
         "scored_epoch": 100.0},
    ])
    first = m.migrate(p, engine_resolver=STUB)
    again = m.migrate(p, engine_resolver=STUB)
    assert again[0]["run_id"] == "flawed-A-1"
    assert again[0]["fixture"] == "flawed"
    assert first == again
