# tests/test_readers.py — the five live readers, at their new home.
#
# Task 1 M1/M3: `skills/ultralearn/scripts/_readers.py` carries the reader
# bodies `harvest_runs.py` held at BASE, with the underscore dropped on the
# eight public names. These are the six reader tests that lived in
# `tests/test_harvest_runs.py` re-pointed at `_readers`, plus one direct test
# each for `records`, `block_text` and `iter_blocks_indexed` — the three
# readers `fleet_slice.py` consumes that BASE only ever covered indirectly.
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import _readers  # noqa: E402


# --- engine_epoch_at / release_timeline / collapse_timeline ----------------
# M1: exported from `_readers` with the BASE bodies. M3: the six BASE reader
# tests, re-pointed.


def test_engine_epoch_at_resolves_from_a_bare_timestamp():
    timeline = [("2026-08-01T00:00:00Z", "0.2.0"), ("2026-08-29T00:00:00Z", "0.3.0")]
    got = _readers.engine_epoch_at("2026-08-30T12:00:00Z", "home", timeline)
    assert got == {"epoch": "0.3.0", "asOf": "2026-08-30T12:00:00Z",
                   "basis": "home-repo-date"}


def test_engine_epoch_at_honors_a_foreign_cache_version():
    got = _readers.engine_epoch_at("2026-08-30T12:00:00Z", "foreign", [],
                                   cache_version="0.2.26")
    assert got["epoch"] == "0.2.26"
    assert got["basis"] == "plugin-cache-path"


def test_engine_epoch_at_unknown_timestamp_is_advisory():
    got = _readers.engine_epoch_at(None, "home", [("2026-08-01T00:00:00Z", "0.2.0")])
    assert got["epoch"] is None
    assert got["basis"] == "unknown"


def test_collapse_timeline_collapses_adjacent_duplicates():
    rows = [("2026-06-10T00:00:00Z", "0.3.0"), ("2026-06-10T01:00:00Z", "0.3.0"),
            ("2026-07-01T00:00:00Z", "0.1.0")]
    assert _readers.collapse_timeline(rows) == (
        ("2026-06-10T00:00:00Z", "0.3.0"), ("2026-07-01T00:00:00Z", "0.1.0"))


def test_collapse_timeline_keeps_a_version_that_recurs_after_a_reset():
    # This repo shipped 0.3.0 twice: 2026-06-10, then again at the One Driver
    # cutover. Uniquifying globally discards the second and dates every
    # post-cutover run to 0.2.26.
    rows = [("2026-06-10T00:00:00Z", "0.3.0"), ("2026-07-01T00:00:00Z", "0.1.0"),
            ("2026-08-28T00:00:00Z", "0.2.26"), ("2026-08-29T00:00:00Z", "0.3.0")]
    assert _readers.collapse_timeline(rows)[-1] == ("2026-08-29T00:00:00Z", "0.3.0")


def test_a_run_today_dates_to_the_head_plugin_version():
    # Non-self-referential: the expected value comes from git, not from the
    # function under test. Fails without the collapse fix, returning 0.2.26.
    #
    # Needs real history. A depth-1 clone yields a ONE-row timeline dated at
    # checkout time, which always precedes `now` — so this assertion would hold
    # there whether or not `collapse_timeline` exists, and a check that cannot
    # fail is not a check. Skip rather than pretend.
    import pytest as _pytest
    if len(_readers.release_timeline()) < 2:
        _pytest.skip("shallow clone: no plugin.json history to collapse")
    import json as _json
    import subprocess as _sp
    from datetime import datetime as _dt, timezone as _tz
    root = _readers._repo_root()
    head = _json.loads(_sp.run(
        ["git", "-C", str(root), "show", "HEAD:.claude-plugin/plugin.json"],
        capture_output=True, text=True, check=True).stdout)["version"]
    now = _dt.now(_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert _readers.engine_epoch_at(now, "home")["epoch"] == head


# --- records / block_text / iter_blocks_indexed ----------------------------
# M3: one direct test each for the three readers the slicer calls.


def test_records_skips_an_unparseable_line_and_reads_the_rest(tmp_path):
    # M3: "an unparseable line is skipped and the rest read" — the swallow-
    # marked skip in `_records`, kept (M1). Three lines in, two records out,
    # in order.
    session = tmp_path / "sess.jsonl"
    session.write_text('{"type": "user", "seq": 1}\n'
                       'not json at all\n'
                       '{"type": "assistant", "seq": 2}\n')
    assert _readers.records(session) == [{"type": "user", "seq": 1},
                                         {"type": "assistant", "seq": 2}]


def test_block_text_flattens_a_nested_tool_result_content_list():
    # M3: "a nested `tool_result` content list flattens to its texts joined by
    # newlines" — how `is_real_run` and the slicer see tool output at all.
    block = {"type": "tool_result", "content": [
        {"type": "text", "text": "Transcript dir: /tmp/run-x"},
        {"type": "text", "text": '{"integrationBranch":"ultra/x"}'},
    ]}
    assert _readers.block_text(block) == (
        'Transcript dir: /tmp/run-x\n{"integrationBranch":"ultra/x"}')


def test_iter_blocks_indexed_yields_a_text_block_for_string_content():
    # M3: "a string `content` yields one `text` block at the record's index"
    # — the #137 branch. A one-word operator ack arrives as plain string
    # content and must not be structurally invisible.
    record = {"type": "user", "message": {"role": "user", "content": "yes"}}
    assert list(_readers.iter_blocks_indexed([record])) == [
        (0, record, {"type": "text", "text": "yes"})]
