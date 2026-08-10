# tests/test_harvest_runs.py
import json
import subprocess
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


def test_gate_report_singular_is_none_when_last_stamp_has_no_disk_receipt(tmp_path):
    # Task 1 review carry-forward: the last REGISTERED stamp must have its
    # OWN disk receipt for gateReport (singular) to be non-None — an earlier
    # stamp's stale receipt must never stand in for the session's final
    # outcome just because it's the last one on disk. Per-stamp runs[]
    # entries still carry their own receipts regardless.
    run1 = tmp_path / "run-1"; run1.mkdir()
    (run1 / "gate-receipt.json").write_text(json.dumps(_real_receipt("PASS", 0)))
    # stamp "2" is registered (launched) but has nothing readable on disk.
    recs = REAL + [_wf_launch("1", run_dir=str(run1)), _wf_launch("2")]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["gateReport"] is None                      # never stamp "1"'s stale receipt
    assert [g["stamp"] for g in bundle["gateReports"]] == ["1"]
    assert bundle["runs"][0]["gateReports"][0]["receipt"]["verdict"] == "PASS"  # per-run entry unaffected
    assert bundle["runs"][1]["gateReports"] == []


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


def test_printed_approve_marker_alone_does_not_flip_terminus(tmp_path):
    # #126 Task 2: the approve-marker/stamp-interleave transcript tracking
    # _stamp_terminus used to do is deleted outright — a printed approve
    # marker with no git-ancestry evidence behind it no longer flips a
    # BLOCKED receipt to approved (replaced entirely by the git check).
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
    assert bundle["terminus"] == "BLOCKED"  # no git-merge evidence -> stays BLOCKED


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


def test_disk_receipts_for_skips_non_utf8_receipt(tmp_path):
    # Task 1 review carry-forward: a gate-receipt.json that isn't valid text
    # (corrupted write, wrong encoding) must be skipped like any other
    # unreadable/malformed receipt, never raise out of build_bundle.
    run1 = tmp_path / "run-bad"; run1.mkdir()
    (run1 / "gate-receipt.json").write_bytes(b"\xff\xfe\xfd\xfc not valid utf-8")
    assert h._disk_receipts_for({"bad": str(run1)}, ["bad"]) == []


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
    # #126 Task 2: receipts come from disk (runDir-located); terminus is the
    # disk verdict (no git repo under tmp_path -> ancestry never resolves,
    # so each stamp's terminus is exactly its receipt's own verdict here —
    # the git-ancestry upgrade path has its own dedicated fixtures below).
    run1 = tmp_path / "run-S1"; run1.mkdir()
    (run1 / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "PASS", "stamp": "S1"}))
    run2 = tmp_path / "run-S2"; run2.mkdir()
    (run2 / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "BLOCKED", "stamp": "S2"}))
    recs = (REAL
            + [_wf_launch("S1", "docs/superpowers/plans/a.md", run_dir=str(run1)),
               _wf_launch("S2", "docs/superpowers/plans/b.md", run_dir=str(run2))])
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    runs = bundle["runs"]
    assert [r["stamp"] for r in runs] == ["S1", "S2"]
    assert runs[0]["planPath"].endswith("a.md") and runs[0]["terminus"] == "PASS"
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


# --- Task 2 (#126): terminus = disk receipt verdict + git ancestry (spec
# §4, F1/F2/F3-adjudicated). Real tmp-repo git fixtures — these replace the
# two merge-evidence prose tests above (task-2-brief) now that the harvester
# never scans transcript text for merge evidence at all.

def _git(args, cwd):
    subprocess.run(["git", *args], cwd=str(cwd), check=True,
                    capture_output=True, text=True)


def _rev_parse(cwd, rev):
    return subprocess.run(["git", "rev-parse", rev], cwd=str(cwd),
                           capture_output=True, text=True, check=True).stdout.strip()


def _init_git_repo(root):
    """A minimal git repo fixture with an initial commit on branch 'main'
    (matches the harvester's own default-branch fallback when there's no
    origin remote)."""
    root.mkdir(parents=True, exist_ok=True)
    _git(["init", "-q", "-b", "main"], root)
    _git(["config", "user.email", "t@example.com"], root)
    _git(["config", "user.name", "T"], root)
    (root / "f.txt").write_text("base\n")
    _git(["add", "f.txt"], root)
    _git(["commit", "-q", "-m", "base"], root)
    return root


def _merged_feature_repo(root):
    """A repo where 'feature' branch's head commit IS an ancestor of 'main' —
    a real, non-squash merge (spec §4: "merged IS approved, regardless of
    how the operator got there"). Returns feature's pre-merge head sha."""
    _init_git_repo(root)
    _git(["checkout", "-q", "-b", "feature"], root)
    (root / "f.txt").write_text("feature\n")
    _git(["commit", "-q", "-am", "feature work"], root)
    head_sha = _rev_parse(root, "HEAD")
    _git(["checkout", "-q", "main"], root)
    _git(["merge", "-q", "--no-ff", "-m", "merge feature", "feature"], root)
    return head_sha


def _unmerged_feature_repo(root):
    """A repo where 'feature' branch's head commit is NOT an ancestor of
    'main' — never merged. Returns feature's head sha."""
    _init_git_repo(root)
    _git(["checkout", "-q", "-b", "feature"], root)
    (root / "f.txt").write_text("feature\n")
    _git(["commit", "-q", "-am", "feature work"], root)
    return _rev_parse(root, "HEAD")


def _squash_merged_repo(root):
    """A repo where 'feature' branch's CONTENT landed on main via a squash
    merge — a new commit disconnected from feature's own commit graph, so
    feature's head sha is never an ancestor of main (spec F2's documented
    blind spot). Returns feature's head sha."""
    _init_git_repo(root)
    _git(["checkout", "-q", "-b", "feature"], root)
    (root / "f.txt").write_text("feature\n")
    _git(["commit", "-q", "-am", "feature work"], root)
    head_sha = _rev_parse(root, "HEAD")
    _git(["checkout", "-q", "main"], root)
    _git(["merge", "-q", "--squash", "feature"], root)
    _git(["commit", "-q", "-m", "squash merge feature"], root)
    return head_sha


def test_stamp_terminus_git_ancestry_approves_blocked_receipt_when_merged(tmp_path):
    # BLOCKED receipt + head merged into base (foreign-shaped tmp-repo
    # fixture) -> approved. Foreign-class coverage lives here (spec F8): the
    # live canary is home-only, so the real merge-commit flow needs its own
    # fixture-level pin.
    root = tmp_path / "repo"
    head_sha = _merged_feature_repo(root)
    run_dir = root / ".claude/ultrapowers/run-S1"
    run_dir.mkdir(parents=True)
    (run_dir / "report.json").write_text(json.dumps({"waveMerges": [{"headSha": head_sha}]}))
    (run_dir / "gate-receipt.json").write_text(json.dumps(_real_receipt("BLOCKED", 1)))
    stamp_reports = h._disk_receipts_for({"S1": str(run_dir)}, ["S1"])
    assert h._stamp_terminus(str(run_dir), stamp_reports) == "approved"


def test_stamp_terminus_git_ancestry_blocked_stays_blocked_when_unmerged(tmp_path):
    root = tmp_path / "repo"
    head_sha = _unmerged_feature_repo(root)
    run_dir = root / ".claude/ultrapowers/run-S2"
    run_dir.mkdir(parents=True)
    (run_dir / "report.json").write_text(json.dumps({"waveMerges": [{"headSha": head_sha}]}))
    (run_dir / "gate-receipt.json").write_text(json.dumps(_real_receipt("BLOCKED", 1)))
    stamp_reports = h._disk_receipts_for({"S2": str(run_dir)}, ["S2"])
    assert h._stamp_terminus(str(run_dir), stamp_reports) == "BLOCKED"


def test_stamp_terminus_squash_merge_blind_spot_keeps_receipt_verdict(tmp_path):
    # Documented blind spot (spec F2), pinned as intended behavior: a squash
    # merge cherry-picks CONTENT onto base without carrying feature's own
    # commit graph, so the head sha is never an ancestor -> the receipt
    # verdict stands (honest-to-receipt, mildly stale, never wrong-direction).
    root = tmp_path / "repo"
    head_sha = _squash_merged_repo(root)
    run_dir = root / ".claude/ultrapowers/run-S3"
    run_dir.mkdir(parents=True)
    (run_dir / "report.json").write_text(json.dumps({"waveMerges": [{"headSha": head_sha}]}))
    (run_dir / "gate-receipt.json").write_text(json.dumps(_real_receipt("NEEDS_ACK", 2)))
    stamp_reports = h._disk_receipts_for({"S3": str(run_dir)}, ["S3"])
    assert h._stamp_terminus(str(run_dir), stamp_reports) == "NEEDS_ACK"


def test_stamp_terminus_unresolvable_sha_keeps_receipt_verdict(tmp_path):
    root = tmp_path / "repo"
    _init_git_repo(root)
    run_dir = root / ".claude/ultrapowers/run-S4"
    run_dir.mkdir(parents=True)
    (run_dir / "report.json").write_text(json.dumps(
        {"waveMerges": [{"headSha": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"}]}))
    (run_dir / "gate-receipt.json").write_text(json.dumps(_real_receipt("PASS", 0)))
    stamp_reports = h._disk_receipts_for({"S4": str(run_dir)}, ["S4"])
    assert h._stamp_terminus(str(run_dir), stamp_reports) == "PASS"


def _set_origin_default_branch(root, branch):
    """Fake a configured `origin` remote whose HEAD points at `branch`,
    without needing a real network fetch — writes the ref directly, the same
    end-state `git clone`/`git remote set-head origin <branch>` produces, so
    `git symbolic-ref refs/remotes/origin/HEAD` resolves to it."""
    _git(["update-ref", f"refs/remotes/origin/{branch}", branch], root)
    _git(["symbolic-ref", "refs/remotes/origin/HEAD", f"refs/remotes/origin/{branch}"], root)


# --- adversarial review fix round 1: `_stamp_base_branch`'s level-1
# (receipt.json baseBranch) and level-2 (symbolic-ref) sources were
# unexercised — every prior fixture merged into "main" with no receipt.json
# and no origin remote, so both levels silently fell through to the level-3
# "main" hardcode and the tests passed by coincidence (mutation-tested:
# renaming baseBranch -> baseBranchTYPO left all tests green). These two
# pins merge into a base branch OTHER than "main" so only a correct read of
# the named level actually produces "approved".

def test_stamp_base_branch_level1_receipt_json_drives_ancestry(tmp_path):
    # Level 1 (spec F3): <runDir>/receipt.json's baseBranch. The fixture's
    # integration branch is "develop", never merged into "main" — so this
    # only passes if _stamp_base_branch actually reads receipt.json; a
    # baseBranch->anything-else mutation (or a level-3 "main" fallback
    # substituting for it) must fail this test.
    root = tmp_path / "repo"
    _init_git_repo(root)
    _git(["checkout", "-q", "-b", "develop"], root)
    _git(["checkout", "-q", "-b", "feature"], root)
    (root / "f.txt").write_text("feature\n")
    _git(["commit", "-q", "-am", "feature work"], root)
    head_sha = _rev_parse(root, "HEAD")
    _git(["checkout", "-q", "develop"], root)
    _git(["merge", "-q", "--no-ff", "-m", "merge feature", "feature"], root)
    run_dir = root / ".claude/ultrapowers/run-S6"
    run_dir.mkdir(parents=True)
    (run_dir / "report.json").write_text(json.dumps({"waveMerges": [{"headSha": head_sha}]}))
    (run_dir / "receipt.json").write_text(json.dumps({"baseBranch": "develop"}))
    (run_dir / "gate-receipt.json").write_text(json.dumps(_real_receipt("BLOCKED", 1)))
    stamp_reports = h._disk_receipts_for({"S6": str(run_dir)}, ["S6"])
    assert h._stamp_terminus(str(run_dir), stamp_reports) == "approved"


def test_stamp_base_branch_level2_symbolic_ref_drives_ancestry(tmp_path):
    # Level 2 (spec F3): no receipt.json -> `git symbolic-ref
    # refs/remotes/origin/HEAD`. The fixture's origin HEAD points at
    # "trunk", never merged into "main" — so this only passes if the
    # symbolic-ref read actually resolves and drives the ancestry check.
    root = tmp_path / "repo"
    _init_git_repo(root)
    _git(["branch", "trunk"], root)
    _git(["checkout", "-q", "-b", "feature"], root)
    (root / "f.txt").write_text("feature\n")
    _git(["commit", "-q", "-am", "feature work"], root)
    head_sha = _rev_parse(root, "HEAD")
    _git(["checkout", "-q", "trunk"], root)
    _git(["merge", "-q", "--no-ff", "-m", "merge feature", "feature"], root)
    _set_origin_default_branch(root, "trunk")
    run_dir = root / ".claude/ultrapowers/run-S7"
    run_dir.mkdir(parents=True)
    (run_dir / "report.json").write_text(json.dumps({"waveMerges": [{"headSha": head_sha}]}))
    (run_dir / "gate-receipt.json").write_text(json.dumps(_real_receipt("BLOCKED", 1)))
    stamp_reports = h._disk_receipts_for({"S7": str(run_dir)}, ["S7"])
    assert h._stamp_terminus(str(run_dir), stamp_reports) == "approved"


def test_stamp_terminus_no_git_repo_keeps_receipt_verdict(tmp_path):
    # runDir has no `.git`-bearing ancestor at all -> not resolvable, receipt
    # verdict stands (fail-soft, never a crash).
    run_dir = tmp_path / "no-repo-anywhere" / "run-S5"
    run_dir.mkdir(parents=True)
    (run_dir / "gate-receipt.json").write_text(json.dumps(_real_receipt("PASS", 0)))
    stamp_reports = h._disk_receipts_for({"S5": str(run_dir)}, ["S5"])
    assert h._stamp_terminus(str(run_dir), stamp_reports) == "PASS"


def test_stamp_terminus_no_receipt_is_unknown():
    assert h._stamp_terminus("/does/not/matter", []) == "unknown"


def test_merge_evidence_matcher_is_deleted():
    assert not hasattr(h, "_merge_evidence_after")


def test_truncated_recomputed_from_git_ancestry_terminus(tmp_path):
    # End-to-end (spec pin: "truncated recomputed from the final terminus"):
    # build_bundle's `truncated` flag follows the git-upgraded terminus, not
    # the raw receipt verdict — the BLOCKED receipt stays visible in
    # gateReports even once the run counts as approved.
    root = tmp_path / "repo"
    head_sha = _merged_feature_repo(root)
    run_dir = root / ".claude/ultrapowers/run-S1"
    run_dir.mkdir(parents=True)
    (run_dir / "report.json").write_text(json.dumps({"waveMerges": [{"headSha": head_sha}]}))
    (run_dir / "gate-receipt.json").write_text(json.dumps(_real_receipt("BLOCKED", 1)))
    recs = REAL + [_wf_launch("S1", run_dir=str(run_dir))]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["terminus"] == "approved"
    assert bundle["truncated"] is False
    assert bundle["gateReports"][-1]["receipt"]["verdict"] == "BLOCKED"


# --- Task 3 (#126): slice envelope, registry-keyed (spec §5) — the tail cut
# lands at the last qualifying artifact of the LAST registered launch, where
# an artifact = a tool_result carrying a registered stamp, or a Workflow
# tool_result itself. Unrelated to terminus, unaffected by the Task 2
# rewrite. ---


def test_slice_cuts_after_last_run_artifact(tmp_path):
    # REAL alone registers no launch (its Workflow tool_use carries no
    # runDir-bearing args) — the registry-keyed envelope then falls back to
    # searching the whole transcript, and REAL's own "Transcript dir:" tool
    # result already qualifies as a Workflow tool_result before this "ok"
    # entry is ever reached, so everything after it (incl. "ok" itself) is
    # tangent regardless.
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


# --- fix round 1 (task review), still true post-#126: the slice envelope's
# artifact test must be tool_result-gated, matching the _transcript_dirs /
# is_real_run convention — a plain prose turn that merely mentions
# "integrationBranch" is not a run artifact and must not become the slice
# cutoff. Discriminating shape: no tool_result artifact at all in the
# transcript, so a correct implementation cuts nothing regardless of where
# the prose mention sits.
def test_slice_ignores_prose_mention_outside_tool_result(tmp_path):
    recs = [
        _rec("user", [{"type": "text", "text": "build the thing"}]),
        _rec("assistant", [{"type": "text", "text": "note: integrationBranch naming can get confusing"}]),
        _rec("user", [{"type": "text", "text": "definitely-real-content-after-prose"}]),
    ]
    out = h.slice_transcript(recs)
    assert "definitely-real-content-after-prose" in out


# --- F6 poisoning-vector pin (spec §5, reviewer-adjudicated): the Read-
# tool_result sibling of the prose-mention pin above. Being a `tool_result`
# is NOT enough on its own to qualify as an artifact — a Read of a test
# fixture is a tool_result too, and the drain-session incident this whole
# cycle traces back to was exactly a receipt-shaped JSON literal pasted
# inside one. The fixture receipt here sits AFTER the real (registered-
# stamp) gate exchange, so the old "tool_result gate alone" scan (any
# `"mode"` in _RUN_ARTIFACT_MODES, unconditionally) would treat it as the
# NEWER artifact and wrongly extend the cutoff past it — pulling the
# marker in between along for the ride even though it's genuine tangent.
# Verified red against the pre-#126 implementation before this fix landed.
# Requiring the embedded stamp to be an ACTUAL registered one keeps the
# cutoff at the real artifact instead.
def test_slice_ignores_fixture_receipt_inside_read_tool_result():
    fixture_receipt = json.dumps({"mode": "gate", "verdict": "PASS", "stamp": "FIXTURE-999"})
    ok = json.dumps({"mode": "approve", "lockReleased": True, "stamp": "REAL-1"})
    recs = [
        _wf_launch("REAL-1"),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": ok}]}]),
        _rec("user", [{"type": "text", "text": "should-be-cut-marker"}]),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": f"file contents:\n{fixture_receipt}"}]}]),
        _rec("user", [{"type": "text", "text": "definitely-cut-tangent"}]),
    ]
    out = h.slice_transcript(recs)
    assert "should-be-cut-marker" not in out
    assert "definitely-cut-tangent" not in out


# --- Multi-launch envelope pin (spec §5 / task-3-brief): a three-launch
# session whose LAST launch's final gate exchange sits late in the
# transcript (several turns after the launch itself) must still keep that
# exchange inside the slice; only content strictly after it is cut. Proves
# the envelope's window anchors on the last registered launch, not the first
# artifact found anywhere.
def test_slice_envelope_three_launch_session_keeps_late_final_gate_exchange():
    ok1 = json.dumps({"mode": "approve", "stamp": "S1"})
    ok2 = json.dumps({"mode": "approve", "stamp": "S2"})
    final_gate = json.dumps({"mode": "gate", "verdict": "PASS", "stamp": "S3"})
    recs = [
        _wf_launch("S1"),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": ok1}]}]),
        _wf_launch("S2"),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": ok2}]}]),
        _wf_launch("S3"),
        _rec("user", [{"type": "text", "text": "mid-run discussion about wave scheduling"}]),
        _rec("assistant", [{"type": "text", "text": "more back and forth before the gate runs"}]),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": final_gate}]}]),
        _rec("user", [{"type": "text", "text": "wave-unrelated post-run tangent"}]),
    ]
    out = h.slice_transcript(recs)
    assert "mid-run discussion" in out
    assert "tangent" not in out


# --- No-artifact-after-last-launch fallback pin (spec §5): when the LAST
# registered launch never printed a qualifying artifact at all, the envelope
# falls back to that launch's own tool_use index — nothing after the last
# launch is ever kept blindly just because no artifact says otherwise.
def test_slice_no_artifact_after_last_launch_falls_back_to_launch_tool_use_index():
    recs = [
        _wf_launch("S1"),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": json.dumps({"mode": "approve", "stamp": "S1"})}]}]),
        _wf_launch("S2"),
        _rec("user", [{"type": "text", "text": "content-after-last-launch-with-no-artifact"}]),
    ]
    out = h.slice_transcript(recs)
    assert "content-after-last-launch-with-no-artifact" not in out


# --- Hygiene (F5/F7): the balanced-JSON "mode"-anchored scan and its helpers
# are deleted outright, not gated — the registry-keyed check above replaces
# them entirely.
def test_has_run_artifact_scan_is_deleted():
    assert not hasattr(h, "_has_run_artifact")
    assert not hasattr(h, "_balanced_json")
    assert not hasattr(h, "_RUN_ARTIFACT_MODES")


# --- Hygiene (F7): the degenerate per-stamp ordinal dict (one file per
# stamp, so the ordinal was always 0) is gone — disk-receipt entries no
# longer carry the field at all.
def test_disk_receipt_entries_have_no_ordinal_field(tmp_path):
    run_dir = tmp_path / "run-S1"
    run_dir.mkdir()
    (run_dir / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "PASS", "stamp": "S1"}))
    entries = h._disk_receipts_for({"S1": str(run_dir)}, ["S1"])
    assert "ordinal" not in entries[0]


# --- #137: the slicer manufactured a false "salvage without operator ack"
# observation. Two seams, both proven against the raw metrc-v-estes
# transcript (run 8569f8be64d39b36).
def test_slice_keeps_string_content_user_turns():
    # Seam 1: short CLI prompts are stored as PLAIN STRING message.content;
    # the block iterator only walked list content, so the operator's
    # "what do you recommend?" and "yes" at a salvage decision vanished.
    recs = [
        _rec("assistant", [{"type": "text",
                            "text": "Salvage and relaunch now, or tear down? The gate is red."}]),
        _rec("user", "what do you recommend?"),
        _rec("assistant", [{"type": "text",
                            "text": "Salvage: wave 1 is already merged and green."}]),
        _rec("user", "yes"),
    ]
    out = h.slice_transcript(recs)
    assert "**user:** what do you recommend?" in out
    assert "**user:** yes" in out


def test_slice_string_user_turn_still_truncated():
    recs = [_rec("user", "x" * (h.SLICE_TURN_MAX + 50))]
    out = h.slice_transcript(recs)
    assert "truncated 50 chars" in out


def test_slice_labels_tool_results_as_tool_result_never_user():
    # Seam 2: tool_result blocks ride user-TYPE records; a keyword-matched
    # Bash inspection dump rendered as "**user:** <class 'dict'> [...]" —
    # machine output must never be attributed to the human.
    recs = [
        _rec("user", [{"type": "tool_result", "content": [{"type": "text",
            "text": "<class 'dict'> ['tasks', 'waves']"}]}]),
    ]
    out = h.slice_transcript(recs)
    assert "**user:**" not in out
    assert "**tool_result:** <class 'dict'> ['tasks', 'waves']" in out
