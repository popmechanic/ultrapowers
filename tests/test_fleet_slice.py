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


# ---------- #415: a worker slice must carry the worker's own output ----------
#
# `worker_slice` delegated to `harvest_runs.slice_transcript`, whose
# `SLICE_KEYWORDS` filter was written for the single LLM-orchestrator
# transcript. Against a WORKER transcript it selects almost at random: across
# fleet runs 24-32 the nine slices carried 0,6,0,0,1,0,1,0,0 assistant blocks
# for 77 workers. Every implementer's reasoning and every reviewer's verdict
# was dropped. The verdict itself does not live in a text block at all — it is
# the worker's structured envelope — so the repair is two-sided: keep assistant
# turns, and append `envelope.json`.

def _write_envelope(workers_root, dirname, payload):
    d = workers_root / dirname
    d.mkdir(parents=True, exist_ok=True)
    p = d / "envelope.json"
    p.write_text(json.dumps(payload))
    return p


def test_worker_slice_keeps_assistant_turns_without_a_keyword(tmp_path):
    # The defect, minimally: assistant prose carrying none of SLICE_KEYWORDS.
    p = _write_transcript(tmp_path / "projects", "slug", "s", [
        ("user", "implement task 3"),
        ("assistant", "The plan's fixture omits a trailing newline; I added one."),
    ])
    out = fleet_slice.worker_slice(p, budget=4000)
    assert "trailing newline" in out
    assert "**assistant:**" in out


def test_worker_slice_still_keeps_user_turns_and_keyworded_tool_results(tmp_path):
    # Regression guard: the repair is additive, it does not drop what worked.
    root = tmp_path / "projects"
    d = root / "slug"
    d.mkdir(parents=True)
    p = d / "s.jsonl"
    p.write_text("\n".join([
        json.dumps({"type": "user", "message": {"content": [
            {"type": "text", "text": "your brief mentions the gate"}]}}),
        json.dumps({"type": "user", "message": {"content": [
            {"type": "tool_result", "text": "wave 1 complete"}]}}),
        json.dumps({"type": "user", "message": {"content": [
            {"type": "tool_result", "text": "total 4\ndrwxr-xr-x 2 x x"}]}}),
    ]) + "\n")
    out = fleet_slice.worker_slice(p, budget=4000)
    assert "your brief mentions the gate" in out
    assert "**tool_result:** wave 1 complete" in out
    assert "drwxr-xr-x" not in out


def test_build_slice_appends_the_worker_envelope(tmp_path):
    root = tmp_path / "projects"
    _write_transcript(root, "-clones-task-1", "sess-1", [("user", "brief")])
    workers_root = tmp_path / "workers"
    _write_envelope(workers_root, "impl_1", {
        "session_id": "sess-1",
        "structured_output": {"verdict": "PASS", "concerns": ["fixture drift"]},
        "permission_denials": [{"tool": "Bash", "command": "wc -l x"}],
        "stop_reason": "tool_use", "num_turns": 15, "is_error": False,
    })
    md = fleet_slice.build_slice(
        "tl", [{"label": "impl:1", "role": "implementer", "sessionId": "sess-1"}],
        root, workers_root=workers_root)
    assert "fixture drift" in md
    assert "PASS" in md


def test_build_slice_envelope_carries_permission_denials(tmp_path):
    # run-32: confine-denials.jsonl recorded 3 denials; the 14 envelopes
    # recorded 20. The denial ledger under-reports, so the envelope's copy is
    # the one a friction lens must see.
    root = tmp_path / "projects"
    _write_transcript(root, "-clones-task-1", "sess-1", [("user", "brief")])
    workers_root = tmp_path / "workers"
    _write_envelope(workers_root, "review_1_1", {
        "session_id": "sess-1",
        "permission_denials": [{"tool": "Bash", "command": "wc -l tests/x.py"},
                               {"tool": "Bash", "command": "wc -c tests/y.py"}],
    })
    md = fleet_slice.build_slice(
        "tl", [{"label": "review:1:1", "role": "reviewer", "sessionId": "sess-1"}],
        root, workers_root=workers_root)
    assert "permission_denials" in md
    assert "wc -c tests/y.py" in md


def test_build_slice_envelope_prefers_structured_output_over_result(tmp_path):
    # `result` and `structured_output` are near-duplicates (run-32: 107,745
    # chars combined, ~half of it redundant). Carry one.
    root = tmp_path / "projects"
    _write_transcript(root, "-clones-task-1", "sess-1", [("user", "brief")])
    workers_root = tmp_path / "workers"
    _write_envelope(workers_root, "impl_1", {
        "session_id": "sess-1",
        "result": "RESULTCOPY",
        "structured_output": {"verdict": "STRUCTUREDCOPY"},
    })
    md = fleet_slice.build_slice(
        "tl", [{"label": "impl:1", "role": "implementer", "sessionId": "sess-1"}],
        root, workers_root=workers_root)
    assert "STRUCTUREDCOPY" in md
    assert "RESULTCOPY" not in md


def test_build_slice_envelope_falls_back_to_result(tmp_path):
    root = tmp_path / "projects"
    _write_transcript(root, "-clones-task-1", "sess-1", [("user", "brief")])
    workers_root = tmp_path / "workers"
    _write_envelope(workers_root, "impl_1",
                    {"session_id": "sess-1", "result": "RESULTCOPY"})
    md = fleet_slice.build_slice(
        "tl", [{"label": "impl:1", "role": "implementer", "sessionId": "sess-1"}],
        root, workers_root=workers_root)
    assert "RESULTCOPY" in md


def test_build_slice_envelope_is_budgeted(tmp_path):
    root = tmp_path / "projects"
    _write_transcript(root, "-clones-task-1", "sess-1", [("user", "brief")])
    workers_root = tmp_path / "workers"
    _write_envelope(workers_root, "integration", {
        "session_id": "sess-1",
        "structured_output": {"head": "HEADMARK", "pad": "z" * 60000,
                              "tail": "TAILMARK"},
    })
    md = fleet_slice.build_slice(
        "tl", [{"label": "integration", "role": "critic", "sessionId": "sess-1"}],
        root, workers_root=workers_root, envelope_budget=1200)
    assert "HEADMARK" in md
    assert "…[elided " in md
    assert len(md) < 4000


def test_build_slice_without_workers_root_is_unchanged(tmp_path):
    # The parameter is optional: every existing caller and test still works.
    root = tmp_path / "projects"
    _write_transcript(root, "-clones-task-1", "sess-1", [("user", "brief")])
    md = fleet_slice.build_slice(
        "tl", [{"label": "impl:1", "role": "implementer", "sessionId": "sess-1"}],
        root)
    assert "## impl:1 (implementer, session sess-1)" in md
    assert "envelope" not in md


def test_build_slice_missing_envelope_is_advisory(tmp_path):
    root = tmp_path / "projects"
    _write_transcript(root, "-clones-task-1", "sess-1", [("user", "brief")])
    md = fleet_slice.build_slice(
        "tl", [{"label": "impl:1", "role": "implementer", "sessionId": "sess-1"}],
        root, workers_root=tmp_path / "nothing-here")
    assert "## impl:1 (implementer, session sess-1)" in md
    assert "brief" in md


def test_build_slice_unreadable_envelope_reports_on_stderr(tmp_path, capsys):
    root = tmp_path / "projects"
    _write_transcript(root, "-clones-task-1", "sess-1", [("user", "brief")])
    workers_root = tmp_path / "workers"
    d = workers_root / "impl_1"
    d.mkdir(parents=True)
    (d / "envelope.json").write_text("{not json")
    fleet_slice.build_slice(
        "tl", [{"label": "impl:1", "role": "implementer", "sessionId": "sess-1"}],
        root, workers_root=workers_root)
    assert "envelope" in capsys.readouterr().err


# ---------- #702 Task 2: the record carries the slices ----------
#
# A harvested run directory has no `claude/projects/` at all — the evidence
# branch never carried one — so the reader that answered `_no transcript found_`
# for every worker of every fetched run has to look in the run dir's own
# `transcripts/` first. A local sandbox-logs tarball has BOTH, and the
# `transcripts/` copy is the reduced one, so it wins there too.
#
#   M4 / leg (g)  `find_transcript(projects_root, session_id, run_dir=None)` is
#                 `<run_dir>/transcripts/<session_id>.jsonl` when `run_dir` is
#                 given and that file exists, else the first
#                 `<projects_root>/*/<session_id>.jsonl`, else None;
#                 `build_slice(…, run_dir=None)` hands it through.
#   M5 / leg (h)  `_worker_lines` renders a `tool_use` block as
#                 `**tool_use:** <name> <json.dumps(kept, sort_keys=True)>` over
#                 the six path-shaped keys alone, so a `content`, `new_string`
#                 or `prompt` input never reaches a rendered slice.

#: The only `tool_use` input keys a rendered slice may show [M5].
SLICE_INPUT_KEYS = ("file_path", "path", "command", "pattern", "glob", "description")


def _write_run_transcript(run_dir, session_id, turns):
    """The harvested layout: `<run_dir>/transcripts/<sessionId>.jsonl`, the file
    `collect_evidence` copies and `fetch_evidence` writes back."""
    d = Path(run_dir) / "transcripts"
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{session_id}.jsonl"
    p.write_text("\n".join(
        json.dumps({"type": t, "sessionId": session_id,
                    "message": {"role": t, "content": [{"type": "text", "text": txt}]}})
        for t, txt in turns) + "\n")
    return p


def test_t2_find_transcript_prefers_the_run_dirs_transcripts_copy(tmp_path):
    """M4, leg (g): both present -> the `transcripts/` path."""
    projects = tmp_path / "projects"
    _write_transcript(projects, "-clones-task-1", "sess-1", [("user", "PROJECTSCOPY")])
    run_dir = tmp_path / "run"
    slice_file = _write_run_transcript(run_dir, "sess-1", [("user", "TRANSCRIPTSCOPY")])

    assert fleet_slice.find_transcript(projects, "sess-1", run_dir=run_dir) == slice_file


def test_t2_find_transcript_falls_back_to_projects_when_the_run_dir_has_none(tmp_path):
    """M4, leg (g): `run_dir` given but holding no file for this session -> the
    first `<projects_root>/*/<session_id>.jsonl`."""
    projects = tmp_path / "projects"
    p = _write_transcript(projects, "-clones-task-1", "sess-1", [("user", "PROJECTSCOPY")])
    run_dir = tmp_path / "run"
    _write_run_transcript(run_dir, "some-other-session", [("user", "not this one")])

    assert fleet_slice.find_transcript(projects, "sess-1", run_dir=run_dir) == p


def test_t2_find_transcript_without_a_run_dir_is_the_projects_file(tmp_path):
    """M4, leg (g): `run_dir=None` -> the `projects/` file, even when a
    `transcripts/` copy exists somewhere; and neither -> None. The default keeps
    every BASE caller reading exactly what it read before."""
    projects = tmp_path / "projects"
    p = _write_transcript(projects, "-clones-task-1", "sess-1", [("user", "PROJECTSCOPY")])
    run_dir = tmp_path / "run"
    _write_run_transcript(run_dir, "sess-1", [("user", "TRANSCRIPTSCOPY")])

    assert fleet_slice.find_transcript(projects, "sess-1", run_dir=None) == p
    assert fleet_slice.find_transcript(projects, "sess-1") == p
    # Neither: no `projects/` file, no `transcripts/` file -> None.
    assert fleet_slice.find_transcript(projects, "sess-nope", run_dir=run_dir) is None
    assert fleet_slice.find_transcript(projects, "sess-nope", run_dir=None) is None


def test_t2_build_slice_renders_a_worker_from_the_run_dirs_transcript(tmp_path):
    """M4, leg (g): a harvested run directory — `transcripts/<sessionId>.jsonl`
    and a `projects_root` with no file for that session — renders the worker's
    section from the `transcripts/` file, and `_no transcript found_` is absent.
    That string for every worker of every fetched run is the defect."""
    projects = tmp_path / "projects"
    projects.mkdir()
    run_dir = tmp_path / "run"
    _write_run_transcript(run_dir, "sess-1", [("user", "TRANSCRIPTSCOPY brief")])

    md = fleet_slice.build_slice(
        "tl", [{"label": "impl:1", "role": "implementer", "sessionId": "sess-1"}],
        projects, run_dir=run_dir)

    assert "## impl:1 (implementer, session sess-1)" in md
    assert "TRANSCRIPTSCOPY brief" in md
    assert "_no transcript found_" not in md


def test_t2_build_slice_without_a_run_dir_is_unchanged(tmp_path):
    """M4, leg (g): `run_dir` is optional and defaults to None — the BASE
    behaviour, so every caller that passes none reads what it read before."""
    projects = tmp_path / "projects"
    _write_transcript(projects, "-clones-task-1", "sess-1", [("user", "PROJECTSCOPY")])
    md = fleet_slice.build_slice(
        "tl", [{"label": "impl:1", "role": "implementer", "sessionId": "sess-1"}],
        projects)
    assert "PROJECTSCOPY" in md
    assert "_no transcript found_" not in md


def _write_tool_use(path, blocks):
    """One slice-shaped assistant record whose content is `blocks`."""
    path.write_text(json.dumps({
        "type": "assistant", "uuid": "u-1", "parentUuid": None,
        "timestamp": "2026-09-06T00:00:00Z", "sessionId": "sess-1",
        "message": {"role": "assistant", "model": "claude-opus-5",
                    "content": blocks}}) + "\n")
    return path


def test_t2_worker_slice_renders_tool_use_without_the_file_body(tmp_path):
    """M5, leg (h): a `Write` `tool_use` renders as its name plus the six-key
    subset of its input, `sort_keys=True` — so `/a/b.py` is visible and the file
    body it was carrying is not. At BASE `block_text` returns "" for a
    `tool_use` block and the block is skipped entirely."""
    p = _write_tool_use(tmp_path / "s.jsonl", [
        {"type": "text", "text": "writing the module"},
        {"type": "tool_use", "id": "toolu_1", "name": "Write",
         "input": {"file_path": "/a/b.py", "content": "SECRET-BODY"}},
        {"type": "tool_use", "id": "toolu_2", "name": "Read",
         "input": {"file_path": "/c.py"}},
    ])

    out = fleet_slice.worker_slice(p, budget=4000)

    assert '**tool_use:** Write {"file_path": "/a/b.py"}' in out, out
    assert '**tool_use:** Read {"file_path": "/c.py"}' in out, out
    assert "SECRET-BODY" not in out, out
    # The repair is additive: the assistant's prose still renders.
    assert "writing the module" in out, out


def test_t2_worker_slice_tool_use_keeps_only_the_six_path_shaped_keys(tmp_path):
    """M5, leg (h): `kept` holds only `file_path`, `path`, `command`, `pattern`,
    `glob` and `description` — dumped `sort_keys=True`, so the rendering is one
    string, not a dict repr — and a `tool_use` whose input has none of the six
    renders as `<name> {}`. No slice carries file contents."""
    p = _write_tool_use(tmp_path / "s.jsonl", [
        {"type": "tool_use", "id": "toolu_1", "name": "Bash",
         "input": {"command": "python3 -m pytest -q", "description": "run the suite",
                   "timeout": 120}},
        {"type": "tool_use", "id": "toolu_2", "name": "Grep",
         "input": {"pattern": "collect_evidence", "glob": "*.sh",
                   "path": "/repo/fleet", "output_mode": "content"}},
        {"type": "tool_use", "id": "toolu_3", "name": "Edit",
         "input": {"file_path": "/a/b.py", "old_string": "OLD-BODY",
                   "new_string": "NEW-BODY"}},
        {"type": "tool_use", "id": "toolu_4", "name": "Task",
         "input": {"prompt": "PROMPT-BODY", "subagent_type": "claude"}},
    ])

    out = fleet_slice.worker_slice(p, budget=8000)

    assert ('**tool_use:** Bash {"command": "python3 -m pytest -q", '
            '"description": "run the suite"}') in out, out
    assert ('**tool_use:** Grep {"glob": "*.sh", "path": "/repo/fleet", '
            '"pattern": "collect_evidence"}') in out, out
    assert '**tool_use:** Edit {"file_path": "/a/b.py"}' in out, out
    assert "**tool_use:** Task {}" in out, out
    for forbidden in ("OLD-BODY", "NEW-BODY", "PROMPT-BODY", "subagent_type",
                      "output_mode", "timeout"):
        assert forbidden not in out, f"{forbidden!r} rode into the slice:\n{out}"


def test_t2_a_rendered_slice_shows_only_the_six_input_keys(tmp_path):
    """M5, leg (h): the constraint as one sweep — every key of every rendered
    `tool_use` input is one of the six, whatever the tool was called with. A
    live, unreduced transcript under `projects/` renders no `Write` `content`
    either, which is why the filter is on the renderer and not on the copy."""
    p = _write_tool_use(tmp_path / "s.jsonl", [
        {"type": "tool_use", "id": "toolu_1", "name": "Write",
         "input": {"file_path": "/a/b.py", "content": "SECRET-BODY",
                   "description": "write it", "notes": {"nested": "NESTED-BODY"}}},
    ])

    out = fleet_slice.worker_slice(p, budget=4000)

    line = [ln for ln in out.splitlines() if ln.startswith("**tool_use:**")]
    assert line == ['**tool_use:** Write {"description": "write it", '
                    '"file_path": "/a/b.py"}'], out
    rendered = json.loads(line[0].split(" ", 2)[2])
    assert set(rendered) <= set(SLICE_INPUT_KEYS), rendered
    assert "SECRET-BODY" not in out and "NESTED-BODY" not in out, out
