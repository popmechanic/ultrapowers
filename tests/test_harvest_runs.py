# tests/test_harvest_runs.py
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import harvest_runs as h


def _rec(type_, content):
    return {"type": type_, "message": {"role": type_, "content": content}}


REAL = [
    _rec("user", [{"type": "text", "text": "build the thing"}]),
    _rec("assistant", [{"type": "tool_use", "name": "Workflow", "input": {"name": "ultrapowers-run"}}]),
    _rec("user", [{"type": "tool_result", "content": [{"type": "text",
        "text": "Transcript dir: /tmp/run-x\n{\"integrationBranch\":\"ultra/x\"}"}]}]),
]
DISCUSSION = [
    _rec("user", [{"type": "text", "text": "let's discuss /ultrapowers and integrationBranch"}]),
    _rec("assistant", [{"type": "text", "text": "integrationBranch is a report field; Transcript dir: explained"}]),
]


def test_real_run_detected():
    assert h.is_real_run(REAL) is True


def test_discussion_only_not_detected():
    assert h.is_real_run(DISCUSSION) is False


def test_classify_origin_home_and_worktree_variants():
    home = "-Users-marcusestes-Websites-ultrapowers"
    assert h.classify_origin(home, home) == "home"
    assert h.classify_origin(home + "--claude-worktrees-foo", home) == "home"
    assert h.classify_origin("-Users-marcusestes-Documents-Legal-x", home) == "foreign"


def test_slice_keeps_user_turns_and_run_turns_drops_noise():
    recs = [
        _rec("user", [{"type": "text", "text": "build the thing"}]),
        _rec("assistant", [{"type": "text", "text": "Wave 1: tasks A, B"}]),
        _rec("assistant", [{"type": "text", "text": "unrelated chatter about lunch"}]),
    ]
    out = h.slice_transcript(recs)
    assert "build the thing" in out
    assert "Wave 1" in out
    assert "lunch" not in out


def test_build_bundle_writes_json_and_slice(tmp_path):
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in REAL) + "\n")
    cache = tmp_path / "cache"
    home = "-Users-marcusestes-Websites-ultrapowers"
    out = h.build_bundle(session, "-Users-marcusestes-Documents-Legal-x", cache, home)
    assert out is not None
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["origin"] == "foreign"
    assert bundle["planPath"] is None or isinstance(bundle["planPath"], str)
    assert set(bundle) >= {"runId", "sessionId", "projectSlug", "origin", "gateReport", "audit"}
    assert (out / "slice.md").exists()


def test_build_bundle_skips_non_run(tmp_path):
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in DISCUSSION) + "\n")
    out = h.build_bundle(session, "any", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    assert out is None


def test_harvest_is_incremental_and_idempotent(tmp_path):
    projects = tmp_path / "projects" / "-Users-marcusestes-Documents-Legal-x"
    projects.mkdir(parents=True)
    (projects / "s1.jsonl").write_text("\n".join(json.dumps(r) for r in REAL) + "\n")
    cache = tmp_path / "cache"
    home = "-Users-marcusestes-Websites-ultrapowers"
    first = h.harvest(tmp_path / "projects", cache, home)
    assert len(first) == 1
    second = h.harvest(tmp_path / "projects", cache, home)
    assert second == []  # watermark -> nothing new


# --- #64: extractors must anchor on Workflow STRUCTURE, not the first prose
# match. Fixture mirrors the real transcript shape: the Workflow tool_use input
# is {name, args} with args a JSON *string*; skill prose earlier in the session
# carries the literal `<plan-path>` placeholder and a report-format schema whose
# "required" array contains "integrationBranch".
DOC_DENSE = [
    # skill prose — the trap (placeholder, a "Transcript dir:" prose mention, and
    # a schema-shaped integrationBranch with no real value)
    _rec("user", [{"type": "text", "text":
        'Run `/ultrapowers <plan-path>`. The "Transcript dir:" path is printed at '
        'launch. Report schema: {"type":"object","required":["integrationBranch","waves"]}.'}]),
    # the REAL launch — input is {name, args}; args is a JSON STRING
    _rec("assistant", [{"type": "tool_use", "name": "Workflow",
        "input": {"name": "ultrapowers-run",
                  "args": json.dumps({"planPath": "docs/superpowers/plans/real-plan.md",
                                       "integrationBranch": "ultra/real"})}}]),
    # the REAL launch result — tool_result carrying the authoritative abs path
    _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text":
        "Workflow launched.\n"
        "Transcript dir: /Users/x/.claude/projects/p/subagents/workflows/wf_real\n"
        "Run ID: wf_real"}]}]),
    # a tool_result holding a schema DECOY before the (here absent) real report
    _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text":
        'schema {"type":"object","required":["integrationBranch","waves"]} end'}]}]),
]


def test_plan_path_reads_workflow_args_json_string_not_prose():
    assert h._plan_path(DOC_DENSE) == "docs/superpowers/plans/real-plan.md"


def test_plan_path_skips_placeholder_when_no_tool_use():
    recs = [_rec("user", [{"type": "text", "text": "see `/ultrapowers <plan-path>`"}])]
    assert h._plan_path(recs) is None  # a bare placeholder is not a real path


def test_transcript_dir_from_tool_result_is_absolute_not_prose():
    assert h._transcript_dir(DOC_DENSE) == \
        "/Users/x/.claude/projects/p/subagents/workflows/wf_real"


def test_transcript_dir_prefers_dir_with_agents(tmp_path):
    probe = tmp_path / "wf_probe"; probe.mkdir()           # zero agents (a probe run)
    run = tmp_path / "wf_run"; run.mkdir()
    (run / "agent-1.jsonl").write_text("{}\n")             # the real run
    recs = [
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": f"Transcript dir: {probe}"}]}]),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": f"Transcript dir: {run}"}]}]),
    ]
    assert h._transcript_dir(recs) == str(run)


def test_gate_report_returns_none_when_only_schema_decoy_present():
    # the report-format schema has "integrationBranch" in a "required" array but
    # no real top-level value — must NOT be mistaken for a gate report
    assert h._gate_report(DOC_DENSE) is None


def test_gate_report_extracts_real_report_skipping_decoy():
    recs = [_rec("user", [{"type": "tool_result", "content": [{"type": "text", "text":
        'schema {"type":"object","required":["integrationBranch"]} '
        'result {"integrationBranch":"ultra/real","waves":[["1"]],"tasks":[]} '
        'usage {"tokens":5}'}]}])]
    gr = h._gate_report(recs)
    assert gr is not None and gr["integrationBranch"] == "ultra/real"


# --- 0.0.31+ driver era: ultra_gate.py prints a gate receipt (mode=="gate",
# has a "verdict") on every administered gate. _gate_report must prefer that
# printed receipt over the legacy integrationBranch scan, which stays as the
# fallback for pre-driver sessions.
def make_records_with_text(text):
    """Minimal record shape _gate_report walks: one user record whose sole
    content block is a tool_result text block carrying the given text (mirrors
    the file's existing _gate_report fixtures above)."""
    return [_rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": text}]}])]


def _real_receipt(verdict, gate_exit):
    # Mirror ultra_gate.py's exact serialized key order and nested shape: the
    # "gateCheck" dict lands directly before "gateCheckExit", so a synthetic
    # fixture cannot reconstruct the old '"gateCheckExit"'-anchor blind spot.
    return {"mode": "gate", "stamp": "20260703-000000",
            "reportPath": "/tmp/r.json", "branch": "ultra/integration-x",
            "gateCheck": {"verdict": verdict,
                          "checks": [{"name": "lock", "ok": True, "detail": ""}],
                          "acks": []},
            "gateCheckExit": gate_exit,
            "acceptance": {"disposition": "suite", "exit": 0},
            "verdict": verdict}


def test_gate_report_prefers_printed_ultra_gate_receipt(tmp_path):
    receipt = _real_receipt("NEEDS_ACK", 2)
    records = make_records_with_text(  # use the file's existing record builder
        "gate administered:\n" + json.dumps(receipt, indent=2) + "\ndone")
    got = h._gate_report(records)
    assert got is not None and got["verdict"] == "NEEDS_ACK"


def test_gate_report_takes_last_receipt_when_rerun(tmp_path):
    first = _real_receipt("BLOCKED", 1)
    second = _real_receipt("NEEDS_ACK", 2)
    records = make_records_with_text(
        json.dumps(first, indent=2) + "\nre-ran after parking docs\n"
        + json.dumps(second, indent=2))
    assert h._gate_report(records)["verdict"] == "NEEDS_ACK"


def test_gate_report_parses_real_ultra_gate_serialized_receipt(tmp_path):
    # Regression: ultra_gate.py serializes the NESTED "gateCheck" dict directly
    # before "gateCheckExit", so anchoring on '"gateCheckExit"' + rfind('{')
    # lands on the gateCheck sub-object (verdict but no mode=="gate") and real
    # printed receipts MISS. Build the receipt in ultra_gate.py's exact key
    # order and shape, serialize the way it does (indent=2), and require the
    # OUTER receipt back.
    receipt = {"mode": "gate", "stamp": "20260703-000000",
               "reportPath": "/tmp/r.json", "branch": "ultra/integration-x",
               "gateCheck": {"verdict": "PASS",
                             "checks": [{"name": "lock", "ok": True, "detail": ""}],
                             "acks": []},
               "gateCheckExit": 0,
               "acceptance": {"disposition": "suite", "exit": 0},
               "verdict": "PASS"}
    records = make_records_with_text(
        "gate administered:\n" + json.dumps(receipt, indent=2) + "\ndone")
    got = h._gate_report(records)
    assert got is not None
    assert got.get("mode") == "gate"
    assert got["verdict"] == "PASS"


def test_gate_report_falls_back_to_legacy_scan(tmp_path):
    # a transcript with a real report JSON (integrationBranch) but no printed
    # receipt must keep working exactly as before (pre-driver sessions).
    legacy = {"integrationBranch": "ultra/integration-20260701-000000",
              "tasks": [], "gitVerified": True}
    records = make_records_with_text("final report:\n" + json.dumps(legacy))
    got = h._gate_report(records)
    assert got is not None
    assert got["integrationBranch"].startswith("ultra/integration-")


# --- engine epoch: map a run's launch time to the version current then. The
# timeline is date-ordered so the 0.x → 0.0.x reset resolves correctly, and the
# comparison must normalize a UTC 'Z' run stamp against git's numeric offset.
TIMELINE = (
    ("2026-06-11T07:00:00-07:00", "0.6.0"),   # 14:00Z
    ("2026-06-11T12:00:00-07:00", "0.0.6"),   # 19:00Z — same-day reset, later
    ("2026-06-14T09:00:00-07:00", "0.0.9"),
    ("2026-06-25T00:54:35-07:00", "0.0.19"),
)


def _ts(stamp):
    return {"type": "user", "timestamp": stamp, "message": {"role": "user", "content": []}}


def test_engine_epoch_picks_latest_release_at_or_before_run():
    out = h._engine_epoch([_ts("2026-06-20T10:00:00.000Z")], "home", TIMELINE)
    assert out["epoch"] == "0.0.9"
    assert out["basis"] == "home-repo-date"


def test_engine_epoch_handles_version_reset_by_timestamp_not_semver():
    # a run at 20:00Z on reset day is AFTER the 0.0.6 reset (19:00Z), not 0.6.0
    out = h._engine_epoch([_ts("2026-06-11T20:00:00.000Z")], "home", TIMELINE)
    assert out["epoch"] == "0.0.6"


def test_engine_epoch_normalizes_utc_against_git_offset():
    # 14:30Z is AFTER the 0.6.0 commit (14:00Z) but BEFORE 0.0.6 (19:00Z);
    # naive string compare of '...-07:00' vs '...Z' would get this wrong
    out = h._engine_epoch([_ts("2026-06-11T14:30:00.000Z")], "foreign", TIMELINE)
    assert out["epoch"] == "0.6.0"
    assert out["basis"] == "foreign-date-upper-bound"


def test_engine_epoch_unknown_without_timestamp():
    out = h._engine_epoch([_rec("user", [{"type": "text", "text": "no ts"}])], "home", TIMELINE)
    assert out["epoch"] is None and out["basis"] == "unknown"


def test_build_bundle_includes_engine_version(tmp_path):
    session = tmp_path / "sess.jsonl"
    recs = [dict(REAL[0], timestamp="2026-06-20T10:00:00.000Z")] + REAL[1:]
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-marcusestes-Documents-Legal-x",
                         tmp_path / "cache", "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert "engineVersion" in bundle
    assert set(bundle["engineVersion"]) == {"epoch", "asOf", "basis"}
    assert bundle["engineVersion"]["basis"] == "foreign-date-upper-bound"


# --- P3: engine-fingerprint, dedup, provenance, truncation, targeting ---
def _agent_file(d, n, first_user_text):
    """An agent-*.jsonl whose first user turn drives audit_run.classify's role."""
    d.mkdir(parents=True, exist_ok=True)
    rec = {"type": "user", "message": {"role": "user",
           "content": [{"type": "text", "text": first_user_text}]}}
    (d / f"agent-{n}.jsonl").write_text(json.dumps(rec) + "\n")


def _run_session(tdir, *, with_integration):
    """A session that passes is_real_run: a Workflow tool_use + a tool_result
    naming the transcript dir (and optionally an integrationBranch)."""
    tr = f"Transcript dir: {tdir}"
    if with_integration:
        tr += '\nresult {"integrationBranch":"ultra/x","waveMerges":[]}'
    return [
        _rec("assistant", [{"type": "tool_use", "name": "Workflow",
                            "input": {"name": "ultrapowers-run"}}]),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": tr}]}]),
    ]


def test_non_engine_workflow_session_is_not_an_engine_run(tmp_path):
    # all agents role:unknown, no integration branch, no planning -> meta, dropped
    tdir = tmp_path / "projects" / "p" / "subagents" / "workflows" / "wf_meta"
    _agent_file(tdir, 1, "Search the web for X and draft an issue.")
    _agent_file(tdir, 2, "Summarize the findings.")
    session = tmp_path / "s.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in _run_session(tdir, with_integration=False)) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache", "-Users-x-home")
    assert out is None


def test_real_engine_session_is_kept_and_tagged(tmp_path):
    tdir = tmp_path / "projects" / "p" / "subagents" / "workflows" / "wf_real"
    _agent_file(tdir, 1, "You are the setup agent on the session repo main checkout.")
    _agent_file(tdir, 2, "You are the wave merge agent, operating on the session repo main checkout.")
    session = tmp_path / "s.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in _run_session(tdir, with_integration=True)) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache", "-Users-x-home")
    assert out is not None
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["sessionKind"] == "engine"


def test_same_run_double_emitted_is_deduped(tmp_path):
    proj = tmp_path / "projects" / "-Users-x-proj"
    tdir = tmp_path / "projects" / "-Users-x-proj" / "subagents" / "workflows" / "wf_dup"
    _agent_file(tdir, 1, "You are the setup agent on the session repo main checkout.")
    for stem in ("s1", "s2"):
        (proj / f"{stem}.jsonl").parent.mkdir(parents=True, exist_ok=True)
        (proj / f"{stem}.jsonl").write_text(
            "\n".join(json.dumps(r) for r in _run_session(tdir, with_integration=True)) + "\n")
    bundles = h.harvest(tmp_path / "projects", tmp_path / "cache", "-Users-x-home")
    assert len(bundles) == 1  # one transcriptDir -> one bundle


def test_slice_truncates_oversized_user_turn():
    recs = [_rec("user", [{"type": "text", "text": "X" * 40000}]),
            _rec("user", [{"type": "text", "text": "build the thing"}])]
    out = h.slice_transcript(recs)
    assert "build the thing" in out
    assert "X" * 40000 not in out and len(out) < 40000


def test_harvest_targets_a_single_project(tmp_path):
    for slug in ("-Users-x-aaa", "-Users-x-bbb"):
        tdir = tmp_path / "projects" / slug / "subagents" / "workflows" / f"wf_{slug[-3:]}"
        _agent_file(tdir, 1, "You are the setup agent on the session repo main checkout.")
        sess = tmp_path / "projects" / slug / "s.jsonl"
        sess.write_text("\n".join(json.dumps(r) for r in _run_session(tdir, with_integration=True)) + "\n")
    bundles = h.harvest(tmp_path / "projects", tmp_path / "cache", "-Users-x-home", project="-Users-x-aaa")
    slugs = {json.loads((b / "bundle.json").read_text())["projectSlug"] for b in bundles}
    assert slugs == {"-Users-x-aaa"}
