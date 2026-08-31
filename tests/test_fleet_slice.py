import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import fleet_slice  # noqa: E402


def _write_transcript(projects_root, slug, session_id, turns):
    d = projects_root / slug
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{session_id}.jsonl"
    p.write_text("\n".join(
        json.dumps({"type": t, "message": {"content": [{"type": "text", "text": txt}]}})
        for t, txt in turns) + "\n")
    return p


def test_find_transcript_locates_a_session_under_any_slug(tmp_path):
    root = tmp_path / "projects"
    _write_transcript(root, "-home-exedev-clones-task-1", "sess-1", [("user", "hi")])
    assert fleet_slice.find_transcript(root, "sess-1").name == "sess-1.jsonl"
    assert fleet_slice.find_transcript(root, "sess-nope") is None
    assert fleet_slice.find_transcript(tmp_path / "gone", "sess-1") is None


def test_worker_slice_under_budget_is_returned_whole(tmp_path):
    p = _write_transcript(tmp_path / "projects", "slug", "s",
                          [("user", "run the wave gate please")])
    out = fleet_slice.worker_slice(p, budget=4000)
    assert "run the wave gate please" in out
    assert "elided" not in out


def test_worker_slice_over_budget_keeps_head_and_tail(tmp_path):
    head, middle, tail = "HEADMARK", "m" * 40000, "TAILMARK"
    p = _write_transcript(tmp_path / "projects", "slug", "s",
                          [("user", head), ("user", middle), ("user", tail)])
    out = fleet_slice.worker_slice(p, budget=1200)
    assert head in out
    assert tail in out
    assert "…[elided " in out
    assert len(out) < 1600


def test_worker_slice_of_an_unreadable_file_is_advisory(tmp_path):
    assert fleet_slice.worker_slice(tmp_path / "missing.jsonl") == ""


def test_build_slice_sections_workers_in_order(tmp_path):
    root = tmp_path / "projects"
    _write_transcript(root, "-clones-task-1", "sess-1", [("user", "first worker gate")])
    _write_transcript(root, "-clones-integration", "sess-2", [("user", "second worker gate")])
    workers = [
        {"label": "impl:1", "role": "implementer", "sessionId": "sess-1"},
        {"label": "review:1:1", "role": "reviewer", "sessionId": "sess-2"},
    ]
    md = fleet_slice.build_slice("01AAA001  +0.0s  run:open  runId=run-30",
                                 workers, root)
    assert md.index("## Event timeline") < md.index("## impl:1")
    assert md.index("## impl:1") < md.index("## review:1:1")
    assert "## impl:1 (implementer, session sess-1)" in md
    assert "first worker gate" in md
    assert "second worker gate" in md


def test_build_slice_names_a_worker_with_no_transcript(tmp_path):
    root = tmp_path / "projects"
    root.mkdir()
    md = fleet_slice.build_slice("tl", [{"label": "impl:9", "role": "implementer",
                                         "sessionId": "gone"}], root)
    assert "## impl:9 (implementer, session gone)" in md
    assert "_no transcript found_" in md


def test_build_slice_with_no_workers_still_carries_the_timeline(tmp_path):
    md = fleet_slice.build_slice("01AAA001  +0.0s  run:open  runId=run-30", [],
                                 tmp_path / "projects")
    assert "## Event timeline" in md
    assert "runId=run-30" in md


# ---------- #464 item 3: a bad transcript skips, never raises ----------

def test_worker_slice_survives_invalid_utf8(tmp_path):
    # A transcript still streaming to disk can end mid-multibyte; read_text()
    # is strict UTF-8 and raises UnicodeDecodeError, which is not an OSError.
    p = tmp_path / "s.jsonl"
    p.write_bytes(b'{"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}\n\xff\xfe')
    assert fleet_slice.worker_slice(p) == ""


def test_worker_slice_survives_a_non_dict_record(tmp_path):
    # `_records` drops unparseable lines but keeps a valid JSON scalar/list,
    # and slice_transcript then calls .get() on it -> AttributeError.
    p = tmp_path / "s.jsonl"
    p.write_text('"just a string"\n[1,2,3]\n')
    assert fleet_slice.worker_slice(p) == ""


def test_worker_slice_reports_the_skip_on_stderr(tmp_path, capsys):
    # The advisory contract is "a skip PLUS a stderr diagnostic" — assert the
    # diagnostic, so deleting it cannot leave the suite green.
    p = tmp_path / "s.jsonl"
    p.write_text('"just a string"\n')
    fleet_slice.worker_slice(p)
    assert "cannot read" in capsys.readouterr().err
