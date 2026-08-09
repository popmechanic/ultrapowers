# tests/test_harvest_runs.py
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import harvest_runs as h


def _rec(type_, content):
    return {"type": type_, "message": {"role": type_, "content": content}}


def _wf_launch(stamp, plan="docs/superpowers/plans/p.md", run_dir=None):
    """A Workflow tool_use launch record carrying structurally-real runDir/
    planPath args — the only source `session_registry` trusts for stamps and
    receipt locations post-#126. `run_dir` defaults to a fixed, guaranteed-
    nonexistent path so callers that don't care about actual disk receipts
    get a stamp registered with nothing readable behind it."""
    run_dir = run_dir or f"/repo/.claude/ultrapowers/run-{stamp}"
    args = json.dumps({"planPath": plan, "runDir": run_dir, "pluginRoot": "/pr"})
    return _rec("assistant", [{"type": "tool_use", "name": "Workflow",
                               "input": {"name": "ultrapowers-run", "args": args}}])


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
    # REAL alone carries only prose evidence (no registered run-<stamp>
    # launch); #126 deletes the legacy prose scan classify_session_kind used
    # to lean on, so a registered launch is appended to keep this an "engine"
    # session — unrelated to what this test actually pins (bundle/slice I/O).
    session = tmp_path / "sess.jsonl"
    recs = REAL + [_wf_launch("REAL-1")]
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
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
    recs = REAL + [_wf_launch("REAL-1")]  # see test_build_bundle_writes_json_and_slice
    (projects / "s1.jsonl").write_text("\n".join(json.dumps(r) for r in recs) + "\n")
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


# --- #126: gateReport/gateReports are disk-sourced only (runDir-located
# reads) — _gate_report/_gate_evidence/_legacy_gate_report (and every
# transcript-text receipt scan they did) are deleted outright. These tests
# convert the old scan-shape/decoy/legacy-fallback pins to their disk-read
# equivalents.

def _real_receipt(verdict, gate_exit):
    # Mirror ultra_gate.py's exact serialized key order and nested shape,
    # written to a real gate-receipt.json (the only place a receipt is ever
    # read from post-#126).
    return {"mode": "gate", "stamp": "20260703-000000",
            "reportPath": "/tmp/r.json", "branch": "ultra/integration-x",
            "gateCheck": {"verdict": verdict,
                          "checks": [{"name": "lock", "ok": True, "detail": ""}],
                          "acks": []},
            "gateCheckExit": gate_exit,
            "acceptance": {"disposition": "suite", "exit": 0},
            "verdict": verdict}


def test_doc_dense_decoy_never_manufactures_a_bundle(tmp_path):
    # DOC_DENSE's schema-shaped "integrationBranch" decoy (a "required" array
    # entry, not a real value) previously needed a careful legacy-scan skip;
    # now it's moot by construction — no transcript text is ever scanned for
    # receipts, and DOC_DENSE's Workflow args carry a planPath but no runDir,
    # so no stamp is ever registered either. No engine signal at all -> meta.
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in DOC_DENSE) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    assert out is None


def test_gate_report_singular_is_last_disk_receipt_of_last_registered_stamp(tmp_path):
    run1 = tmp_path / "run-1"; run1.mkdir()
    run2 = tmp_path / "run-2"; run2.mkdir()
    (run1 / "gate-receipt.json").write_text(json.dumps(_real_receipt("NEEDS_ACK", 2)))
    (run2 / "gate-receipt.json").write_text(json.dumps(_real_receipt("PASS", 0)))
    recs = REAL + [_wf_launch("1", run_dir=str(run1)), _wf_launch("2", run_dir=str(run2))]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["gateReport"]["verdict"] == "PASS"        # last registered stamp's disk receipt
    assert [g["stamp"] for g in bundle["gateReports"]] == ["1", "2"]


def test_pre_driver_session_bundles_with_no_gate_report(tmp_path):
    # #126: _legacy_gate_report (the pre-driver prose "integrationBranch"
    # scan) is deleted outright, not gated. Accepted-behavior pin: a
    # pre-driver-style session — no registered run-<stamp> launch at all —
    # still bundles via its audited engine-role agents, but with no
    # gateReport: without a runDir there is nothing to disk-read.
    tdir = tmp_path / "wf_legacy"
    _agent_file(tdir, 1, "You are the setup agent on the session repo main checkout.")
    recs = [
        _rec("assistant", [{"type": "tool_use", "name": "Workflow",
                            "input": {"name": "ultrapowers-run"}}]),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text":
            f"Transcript dir: {tdir}\nfinal report: "
            '{"integrationBranch":"ultra/integration-20260701-000000","tasks":[]}'}]}]),
    ]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    assert out is not None
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["sessionKind"] == "engine"
    assert bundle["gateReport"] is None
    assert bundle["gateReports"] == []
    assert bundle["runs"] == []


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
    recs = [dict(REAL[0], timestamp="2026-06-20T10:00:00.000Z")] + REAL[1:] + [_wf_launch("REAL-1")]
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


# --- #98/#126: full gate history, terminus, truncation, disk read, synthetic ---

def _approve_marker():
    # Mirror ultra_gate.py --approve's printed JSON shape.
    return {"mode": "approve", "stamp": "20260703-000000",
            "branch": "ultra/integration-x", "swept": None, "lockReleased": True}


def test_stamp_terminus_approved_when_approve_marker_follows_disk_blocked(tmp_path):
    # The recovered-false-red case (#98), now disk-sourced: a BLOCKED receipt
    # on disk, then the approve marker printed in the transcript -> approved,
    # while the BLOCKED receipt itself stays visible in gateReports.
    run1 = tmp_path / "run-20260703-000000"; run1.mkdir()
    (run1 / "gate-receipt.json").write_text(json.dumps(_real_receipt("BLOCKED", 1)))
    ok = json.dumps(_approve_marker())  # stamp "20260703-000000", matches the launch below
    recs = REAL + [_wf_launch("20260703-000000", run_dir=str(run1)),
                   _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": ok}]}])]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["terminus"] == "approved"
    assert bundle["gateReports"][-1]["receipt"]["verdict"] == "BLOCKED"


def test_disk_receipts_for_reads_only_requested_stamps_in_order(tmp_path):
    # #126: run_dirs_by_stamp only — no repo-wide glob, no planPath-relative
    # walk. Reads exactly the requested (registry) stamps, in the order
    # given, and skips any run dir present in the mapping but not requested.
    run_a = tmp_path / "run-a"; run_a.mkdir()
    run_b = tmp_path / "run-b"; run_b.mkdir()
    run_foreign = tmp_path / "run-foreign"; run_foreign.mkdir()
    (run_a / "gate-receipt.json").write_text(json.dumps(_real_receipt("BLOCKED", 1)))
    (run_b / "gate-receipt.json").write_text(json.dumps(_real_receipt("PASS", 0)))
    (run_foreign / "gate-receipt.json").write_text(json.dumps(_real_receipt("NEEDS_ACK", 2)))
    run_dirs = {"a": str(run_a), "b": str(run_b), "foreign": str(run_foreign)}
    entries = h._disk_receipts_for(run_dirs, ["a", "b"])
    assert [e["receipt"]["verdict"] for e in entries] == ["BLOCKED", "PASS"]
    assert all(e["source"] == "disk" for e in entries)
    # labeled by the LOCATING stamp, never the receipt's own recorded field
    # (every _real_receipt hardcodes "stamp": "20260703-000000")
    assert [e["stamp"] for e in entries] == ["a", "b"]


def test_disk_receipts_for_fails_soft(tmp_path):
    assert h._disk_receipts_for({}, ["a"]) == []
    assert h._disk_receipts_for(None, ["a"]) == []
    assert h._disk_receipts_for({"a": str(tmp_path / "gone")}, ["a"]) == []  # no file there
    assert h._disk_receipts_for({"a": str(tmp_path)}, []) == []


def test_bundle_carries_evidence_fields(tmp_path):
    run1 = tmp_path / "run-1"; run1.mkdir()
    (run1 / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "NEEDS_ACK", "stamp": "1",
         "integrationBranch": "ultra/x"}))
    session = tmp_path / "sess.jsonl"
    recs = REAL + [_wf_launch("1", run_dir=str(run1))]
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-marcusestes-Documents-Legal-x",
                         tmp_path / "cache", "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["gateReport"]["integrationBranch"] == "ultra/x"  # unchanged meaning
    assert bundle["gateReports"][0]["receipt"]["integrationBranch"] == "ultra/x"
    assert bundle["terminus"] == "NEEDS_ACK"
    assert bundle["truncated"] is True


def test_classify_origin_synthetic_temp_roots():
    home = "-Users-marcusestes-Websites-ultrapowers"
    for slug in ("-tmp-jsdeps-cell-abc", "-private-tmp-x",
                 "-var-folders-9k-xyz", "-private-var-folders-9k-xyz"):
        assert h.classify_origin(slug, home) == "synthetic"
    assert h.classify_origin(home, home) == "home"
    assert h.classify_origin(home + "--worktree", home) == "home"
    assert h.classify_origin("-Users-x-proj", home) == "foreign"


# --- #113/#118/#126: session-launch registry + per-stamp disk receipt
# attribution (deletes the repo-wide glob AND the receipt text-scan) ---

def test_session_registry_extracts_stamps_planpaths_and_rundirs():
    recs = [_wf_launch("20260806-1", "docs/superpowers/plans/a.md"),
            _wf_launch("20260806-2", "docs/superpowers/plans/b.md"),
            _wf_launch("20260806-1", "docs/superpowers/plans/a.md")]  # dedup
    reg = h.session_registry(recs)
    assert reg["stamps"] == ["20260806-1", "20260806-2"]
    assert reg["planPathsByStamp"]["20260806-2"] == "docs/superpowers/plans/b.md"
    assert reg["runDirsByStamp"]["20260806-1"] == "/repo/.claude/ultrapowers/run-20260806-1"
    assert reg["runDirsByStamp"]["20260806-2"] == "/repo/.claude/ultrapowers/run-20260806-2"


def test_session_registry_ignores_pasted_receipt_json_literal():
    # #126 INVERSION PIN — the exact home-bundle repro (0.1.15 drain session):
    # a receipt-shaped JSON literal pasted inside a Read/text tool_result
    # (test-fixture code, plan prose) must register NO stamp. Pre-#126 this
    # was test_session_registry_reads_receipt_stamps, which asserted the
    # OPPOSITE (the stamp DID register) — the balanced-JSON "mode" scan that
    # did that is deleted, not gated.
    recs = [_rec("user", [{"type": "tool_result", "content": [{"type": "text",
        "text": json.dumps({"mode": "gate", "verdict": "PASS", "stamp": "20260806-9"})}]}])]
    reg = h.session_registry(recs)
    assert reg["stamps"] == []
    assert "20260806-9" not in reg["stamps"]


def test_build_bundle_never_attaches_pasted_fixture_receipt(tmp_path):
    # Build-bundle-level companion to the inversion pin: a real registered
    # launch with NO disk receipt sits alongside a pasted fixture-shaped
    # receipt elsewhere in the transcript — the fixture stamp never appears
    # anywhere in the bundle, and the real launch correctly has no gateReport.
    recs = (REAL
            + [_wf_launch("REAL-1")]
            + [_rec("user", [{"type": "tool_result", "content": [{"type": "text", "text":
                "plan fixture: " + json.dumps(
                    {"mode": "gate", "verdict": "PASS", "stamp": "FIXTURE-1"})}]}])])
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert [r["stamp"] for r in bundle["runs"]] == ["REAL-1"]  # FIXTURE-1 never registered
    assert bundle["gateReports"] == []
    assert bundle["gateReport"] is None


def test_disk_receipts_only_for_registry_stamps(tmp_path):
    # a receipt for an in-registry stamp AND a foreign run dir both exist on
    # disk; only the requested (registered) stamp is ever read.
    run1 = tmp_path / "run-20260806-1"; run1.mkdir()
    run_foreign = tmp_path / "run-19990101-9"; run_foreign.mkdir()
    (run1 / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "NEEDS_ACK", "stamp": "20260806-1"}))
    (run_foreign / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "BLOCKED", "stamp": "19990101-9"}))
    run_dirs = {"20260806-1": str(run1), "19990101-9": str(run_foreign)}
    entries = h._disk_receipts_for(run_dirs, ["20260806-1"])
    assert [e["stamp"] for e in entries] == ["20260806-1"]   # foreign 1999 dir NOT attached
    assert all(e["source"] == "disk" for e in entries)


def test_repo_wide_glob_is_gone():
    assert not hasattr(h, "_disk_gate_reports")


def test_build_bundle_never_attaches_out_of_registry_receipts(tmp_path):
    # session that launched stamp A; a receipt for stamp B sits on disk too,
    # but B was never registered by THIS session's own launches.
    run_a = tmp_path / "run-A-1"; run_a.mkdir()
    run_b = tmp_path / "run-B-2"; run_b.mkdir()
    (run_a / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "NEEDS_ACK", "stamp": "A-1"}))
    (run_b / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "NEEDS_ACK", "stamp": "B-2"}))
    recs = REAL + [_wf_launch("A-1", run_dir=str(run_a))]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    stamps = {g.get("stamp") for g in bundle["gateReports"]}
    assert "B-2" not in stamps and "A-1" in stamps


def test_relative_plan_path_never_leaks_home_repo_receipts(tmp_path, monkeypatch):
    # F4 hazard pin: `_disk_receipts_for` takes run_dirs_by_stamp only — there
    # is no plan_path parameter to resolve relative-to-CWD at all, so a
    # foreign run's relative planPath can never cause the harvester to read
    # receipts from its own CWD/home repo. Prove it structurally: plant a
    # decoy receipt under the harvester's CWD at the exact location a
    # plan_path-relative walk would have found, and confirm only the launch's
    # real (foreign) absolute runDir is ever read.
    monkeypatch.chdir(tmp_path)
    decoy_dir = tmp_path / ".claude/ultrapowers/run-F4-1"
    decoy_dir.mkdir(parents=True)
    (decoy_dir / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "NEEDS_ACK", "stamp": "home-decoy"}))
    foreign_run = tmp_path / "foreign-repo/.claude/ultrapowers/run-F4-1"
    foreign_run.mkdir(parents=True)
    (foreign_run / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "PASS", "stamp": "F4-1"}))
    recs = REAL + [_wf_launch("F4-1", plan="../relative/plan.md", run_dir=str(foreign_run))]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-foreign", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["gateReport"]["verdict"] == "PASS"           # from the foreign runDir
    assert bundle["gateReport"].get("stamp") != "home-decoy"   # never the CWD-relative decoy


# --- Task 2 (#113): multi-run bundle shape + audit union across launches ---

def test_runs_array_groups_by_stamp_with_aggregate_terminus(tmp_path):
    # #126: receipts now come from disk (runDir-located), not transcript
    # JSON blobs — the approve marker (ok1) is still a real transcript event
    # (`_stamp_terminus`'s own approve-marker tracking is untouched in this
    # task; Task 2 replaces it with git ancestry).
    run1 = tmp_path / "run-S1"; run1.mkdir()
    (run1 / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "NEEDS_ACK", "stamp": "S1"}))
    run2 = tmp_path / "run-S2"; run2.mkdir()
    (run2 / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "BLOCKED", "stamp": "S2"}))
    ok1 = json.dumps({"mode": "approve", "lockReleased": True, "stamp": "S1"})
    recs = (REAL
            + [_wf_launch("S1", "docs/superpowers/plans/a.md", run_dir=str(run1)),
               _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": ok1}]}]),
               _wf_launch("S2", "docs/superpowers/plans/b.md", run_dir=str(run2))])
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    runs = bundle["runs"]
    assert [r["stamp"] for r in runs] == ["S1", "S2"]
    assert runs[0]["planPath"].endswith("a.md") and runs[0]["terminus"] == "approved"
    assert runs[1]["terminus"] == "BLOCKED"
    assert bundle["terminus"] == "BLOCKED"          # last non-approved run
    assert bundle["planPath"].endswith("a.md")      # top-level = first plan, unchanged meaning


def test_merge_audits_sums_totals_and_concats_agents():
    a = {"agents": [{"role": "impl"}], "totals": {"turns": 10, "outputTokens": 100}}
    b = {"agents": [{"role": "review"}], "totals": {"turns": 5, "outputTokens": 50}}
    m = h._merge_audits([a, b])
    assert len(m["agents"]) == 2
    assert m["totals"]["turns"] == 15 and m["totals"]["outputTokens"] == 150


def test_transcript_dirs_returns_all_agent_bearing_candidates(tmp_path):
    d1, d2 = tmp_path / "t1", tmp_path / "t2"
    for d in (d1, d2):
        d.mkdir(); (d / "agent-1.jsonl").write_text("{}")
    recs = [_rec("user", [{"type": "tool_result", "content": [{"type": "text",
                "text": f"Transcript dir: {d}"}]}]) for d in (d1, d2)]
    assert h._transcript_dirs(recs) == [str(d1), str(d2)]


# --- fix round 1 (adversarial review): isolate classify_session_kind's new
# has_registered_launch signal — a session whose ONLY engine evidence is a
# structurally-verified Workflow launch (real run-<stamp> args). No printed
# gate receipts, no agent-*.jsonl transcripts, no integrationBranch, and no
# self-authored plan (planningFound stays False since nothing Writes/Edits
# the plan path). Previously "meta"/dropped; now "engine"/bundled with
# terminus "unknown". Pinning this in isolation (it was previously only
# incidentally covered inside a scenario that ALSO had gate receipts) so the
# operator's spec-owner sign-off has an exact, tested description to bless
# or reverse.
def test_launch_only_session_bundles_as_engine_unknown(tmp_path):
    # plan path has no .git ancestor under tmp_path -> _disk_receipts_for
    # deterministically returns [] (no accidental match against the real repo).
    plan = str(tmp_path / "docs/superpowers/plans/p.md")
    # mentioned so is_real_run's saw_dir signal fires, but never created on
    # disk -> _transcript_dirs falls back to it, audit_run.audit finds no
    # agent-*.jsonl -> merged audit has zero agents (no engine-role signal).
    tdir = tmp_path / "wf_launch_only"
    recs = [
        _wf_launch("ONLY-1", plan),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": f"Transcript dir: {tdir}"}]}]),
    ]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    assert out is not None
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["sessionKind"] == "engine"
    assert bundle["terminus"] == "unknown"
    assert bundle["truncated"] is True
    assert bundle["gateReports"] == []
    assert bundle["planningFound"] is False
    assert [r["stamp"] for r in bundle["runs"]] == ["ONLY-1"]
    assert bundle["runs"][0]["terminus"] == "unknown"
    assert bundle["runs"][0]["gateReports"] == []


# --- Task 3 (#113): terminus honesty (override-derivable via merge evidence)
# + slice envelope (tail cut at the last run-artifact record) ---

def test_blocked_then_merge_evidence_derives_approved(tmp_path):
    # #126: gateReports is disk-sourced (a real gate-receipt.json backs the
    # BLOCKED verdict below); `_stamp_terminus`'s own approve/blocked-branch
    # tracking (untouched this task — Task 2 replaces it with git ancestry)
    # still walks the transcript for ITS override bookkeeping, so the same
    # receipt is also printed there — exactly what ultra_gate.py's real
    # stdout does (prints AND writes gate-receipt.json on every full gate).
    blocked = json.dumps({"mode": "gate", "verdict": "BLOCKED", "stamp": "S1",
                          "integrationBranch": "ultra/integration-S1"})
    run1 = tmp_path / "run-S1"; run1.mkdir()
    (run1 / "gate-receipt.json").write_text(blocked)
    recs = (REAL
            + [_wf_launch("S1", run_dir=str(run1)),
               _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": blocked}]}]),
               _rec("user", [{"type": "tool_result", "content": [{"type": "text",
                    "text": "Merged pull request #7 (ultra/integration-S1)"}]}])])
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["terminus"] == "approved"
    # override stays DERIVABLE: the receipt's BLOCKED verdict is still in the bundle
    assert bundle["gateReports"][-1]["receipt"]["verdict"] == "BLOCKED"
    assert bundle["truncated"] is False


def test_blocked_without_merge_evidence_stays_blocked(tmp_path):
    blocked = json.dumps({"mode": "gate", "verdict": "BLOCKED", "stamp": "S1",
                          "integrationBranch": "ultra/integration-S1"})
    run1 = tmp_path / "run-S1"; run1.mkdir()
    (run1 / "gate-receipt.json").write_text(blocked)
    recs = REAL + [_wf_launch("S1", run_dir=str(run1)),
                   _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": blocked}]}])]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    assert json.loads((out / "bundle.json").read_text())["terminus"] == "BLOCKED"


def test_slice_cuts_after_last_run_artifact(tmp_path):
    ok = json.dumps({"mode": "approve", "lockReleased": True, "stamp": "S1"})
    recs = (REAL
            + [_rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": ok}]}]),
               _rec("user", [{"type": "text", "text": "now let's investigate desktop internals"}]),
               _rec("assistant", [{"type": "text", "text": "wave-unrelated post-run tangent"}])])
    out = h.slice_transcript(recs)
    assert "desktop internals" not in out and "tangent" not in out


def test_slice_keeps_planning_head(tmp_path):
    # no artifact after the head → nothing is cut
    out = h.slice_transcript(REAL)
    assert "build the thing" in out


# --- fix round 1 (task review): _has_run_artifact must be tool_result-gated,
# matching the _transcript_dirs / is_real_run convention — a plain prose turn
# that merely mentions "integrationBranch" is not a run artifact and must not
# become the slice cutoff. Discriminating shape: no tool_result artifact at
# all in the transcript, so a correct implementation cuts nothing regardless
# of where the prose mention sits.
def test_slice_ignores_prose_mention_outside_tool_result(tmp_path):
    recs = [
        _rec("user", [{"type": "text", "text": "build the thing"}]),
        _rec("assistant", [{"type": "text", "text": "note: integrationBranch naming can get confusing"}]),
        _rec("user", [{"type": "text", "text": "definitely-real-content-after-prose"}]),
    ]
    out = h.slice_transcript(recs)
    assert "definitely-real-content-after-prose" in out
