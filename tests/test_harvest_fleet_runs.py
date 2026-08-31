import json
import sys
import tarfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import harvest_fleet_runs as hfr  # noqa: E402

T0 = 1788130000000


def _ev(i, off, **f):
    return dict(f, id=f"01AAA{i:03d}", ts=T0 + off)


def _make_run_dir(root, run_id="run-30", *, with_report=True, with_gate=True):
    """A structurally faithful miniature of a real fleet run directory."""
    d = root / f"run-{run_id}"
    (d / "claude" / "projects" / "-clones-task-1").mkdir(parents=True)
    events = [
        _ev(1, 0, kind="run:open", runId=run_id, base="", source="fleet/run-main.mjs"),
        _ev(2, 1000, kind="engine:phase", phase="Wave 1"),
        _ev(3, 1000, kind="worker:start", label="impl:1", role="implementer",
            sessionId="sess-1", cwd="/clones/task-1", model="opus"),
        _ev(4, 61000, kind="worker:end", label="impl:1", role="implementer",
            sessionId="sess-1", exitCode=0, timedOut=False, outcome="ok",
            status=None,
            meter={"input": 30, "output": 6463, "cacheRead": 452825,
                   "cacheCreation": 20113, "costUsd": 0.5913,
                   "models": ["claude-opus-5"]}),
        _ev(5, 62000, kind="driver:fail", verdict="needs-ack", detail="deferred:manual"),
    ]
    events[3]["class"] = "success"
    (d / "events.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
    (d / "claude" / "projects" / "-clones-task-1" / "sess-1.jsonl").write_text(
        json.dumps({"type": "user",
                    "message": {"content": [{"type": "text",
                                             "text": "run the wave gate"}]}}) + "\n")
    if with_report:
        (d / "report.json").write_text(json.dumps({
            "integrationBranch": "ultra/integration-" + run_id,
            "baseSha": "3fa4936",
            "tests": {"command": "python3 -m pytest -n auto", "passed": True,
                      "output": "z" * 9000},
            "judgmentCalls": [{"task": "1", "detail": "chose the additive union"}],
            "deferredVerification": [],
        }))
    if with_gate:
        (d / "gate-receipt.json").write_text(json.dumps({
            "mode": "gate", "stamp": run_id,
            "branch": "ultra/integration-" + run_id,
            "gateCheck": {"verdict": "NEEDS_ACK", "checks": [], "acks": [
                {"type": "deferred:manual", "detail": "RUNBOOK claims"}]},
            "verdict": "NEEDS_ACK"}))
    (d / "confine-denials.jsonl").write_text(
        json.dumps({"tool": "Bash", "reason": "outside clone"}) + "\n")
    return d


def _tarball(tmp_path, run_dir):
    """Repack a run dir the way the orchestrator stores it."""
    tgz = tmp_path / "sandbox-logs.tgz"
    with tarfile.open(tgz, "w:gz") as tf:
        tf.add(run_dir, arcname=f"repo/.claude/ultrapowers/{run_dir.name}")
    return tgz


# ---------- discovery ----------

def test_discover_finds_a_bare_run_dir(tmp_path):
    d = _make_run_dir(tmp_path)
    assert hfr.discover_run_dirs(d, tmp_path / "w") == [d]


def test_discover_finds_run_dirs_nested_under_a_tree(tmp_path):
    root = tmp_path / "tree" / "repo" / ".claude" / "ultrapowers"
    root.mkdir(parents=True)
    a = _make_run_dir(root, "run-30")
    b = _make_run_dir(root, "run-31")
    assert hfr.discover_run_dirs(tmp_path / "tree", tmp_path / "w") == sorted([a, b])


def test_discover_unpacks_a_tarball(tmp_path):
    d = _make_run_dir(tmp_path / "src")
    got = hfr.discover_run_dirs(_tarball(tmp_path, d), tmp_path / "w")
    assert [p.name for p in got] == ["run-run-30"]
    assert (got[0] / "events.jsonl").exists()


def test_discover_skips_a_dir_with_no_event_log(tmp_path):
    (tmp_path / "run-run-21").mkdir()
    assert hfr.discover_run_dirs(tmp_path, tmp_path / "w") == []


def test_discover_of_a_missing_path_is_advisory(tmp_path):
    assert hfr.discover_run_dirs(tmp_path / "gone", tmp_path / "w") == []


# ---------- bundle assembly ----------

def _bundle(tmp_path, **kw):
    d = _make_run_dir(tmp_path, **{k: v for k, v in kw.items() if k.startswith("with_")})
    cache = tmp_path / "cache"
    out = hfr.build_fleet_bundle(
        d, cache, **{k: v for k, v in kw.items() if not k.startswith("with_")})
    return out, json.loads((out / "bundle.json").read_text())


def test_bundle_lands_in_the_cache_under_the_fleet_run_id(tmp_path):
    out, b = _bundle(tmp_path)
    assert out == tmp_path / "cache" / "runs" / "run-30"
    assert b["runId"] == "run-30"
    assert (out / "slice.md").exists()


def test_bundle_carries_the_lookup_fields_merge_ledger_reads(tmp_path):
    _, b = _bundle(tmp_path, engine_version="0.3.0")
    assert b["origin"] == "home"
    assert b["engineVersion"]["epoch"] == "0.3.0"
    assert b["engineVersion"]["basis"] == "explicit"
    assert b["sessionKind"] == "engine"


def test_bundle_dates_itself_from_the_event_log_when_no_version_is_given(tmp_path, monkeypatch):
    # Hermetic on purpose. `engine_epoch_at` falls back to `_release_timeline()`,
    # which is real git history — and in a depth-1 CI clone git reports the
    # boundary commit as introducing every file, so the timeline collapses to a
    # single entry dated at checkout time, AFTER T0. The walk then breaks on its
    # first row and returns epoch None. Pin the timeline instead of asking the
    # clone what its history was.
    monkeypatch.setattr(hfr.harvest_runs, "_release_timeline",
                        lambda: (("2026-08-28T10:52:30-07:00", "0.2.26"),
                                 ("2026-08-29T14:03:52-07:00", "0.3.0")))
    _, b = _bundle(tmp_path)
    assert b["engineVersion"]["basis"] == "home-repo-date"
    assert b["engineVersion"]["asOf"].startswith("2026-")
    # T0 is 2026-08-30, after the One Driver cutover — never the shadowed 0.2.26
    # the pre-Task-2 timeline returned (see Task 2(c)).
    assert b["engineVersion"]["epoch"] == "0.3.0"


def test_bundle_terminus_comes_from_the_gate_receipt(tmp_path):
    _, b = _bundle(tmp_path)
    assert b["terminus"] == "NEEDS_ACK"
    assert b["truncated"] is True
    assert b["gateReport"]["gateCheck"]["acks"][0]["type"] == "deferred:manual"


def test_bundle_without_a_gate_receipt_is_unknown_not_a_crash(tmp_path):
    _, b = _bundle(tmp_path, with_gate=False)
    assert b["terminus"] == "unknown"
    assert b["truncated"] is True
    assert b["gateReport"] is None


def test_bundle_folds_the_audit_from_the_event_meters(tmp_path):
    _, b = _bundle(tmp_path)
    agents = b["audit"]["agents"]
    assert [a["label"] for a in agents] == ["impl:1"]
    assert agents[0]["role"] == "implementer"
    assert agents[0]["outputTokens"] == 6463
    assert agents[0]["wallSec"] == 60.0
    assert b["audit"]["totals"]["outputTokens"] == 6463
    assert b["audit"]["totals"]["costUsd"] == 0.5913
    assert b["audit"]["totals"]["agents"] == 1
    assert "meter" in b["audit"]["unitNote"]


def test_bundle_caps_the_suite_output_but_keeps_its_tail(tmp_path):
    _, b = _bundle(tmp_path)
    assert "output" not in b["report"]["tests"]
    assert len(b["report"]["tests"]["outputTail"]) <= 2000
    assert b["report"]["tests"]["passed"] is True
    assert b["report"]["judgmentCalls"][0]["detail"] == "chose the additive union"


def test_bundle_without_a_report_is_advisory(tmp_path):
    _, b = _bundle(tmp_path, with_report=False)
    assert b["report"] is None
    assert b["runId"] == "run-30"


def test_bundle_carries_the_event_summary_and_confine_denials(tmp_path):
    _, b = _bundle(tmp_path)
    assert b["events"]["runId"] == "run-30"
    assert b["events"]["counts"]["worker:end"] == 1
    assert b["events"]["terminal"]["verdict"] == "needs-ack"
    assert b["confineDenials"][0]["tool"] == "Bash"


def test_slice_carries_the_timeline_and_the_worker_transcript(tmp_path):
    out, _ = _bundle(tmp_path)
    md = (out / "slice.md").read_text()
    assert "## Event timeline" in md
    assert "01AAA001  +0.0s  run:open  runId=run-30" in md
    assert "## impl:1 (implementer, session sess-1)" in md
    assert "run the wave gate" in md


def test_a_run_dir_with_no_run_open_event_is_refused(tmp_path):
    d = _make_run_dir(tmp_path)
    (d / "events.jsonl").write_text(json.dumps(
        {"kind": "engine:phase", "phase": "Wave 1", "id": "01A", "ts": T0}) + "\n")
    assert hfr.build_fleet_bundle(d, tmp_path / "cache") is None
    assert not (tmp_path / "cache").exists()


# ---------- CLI ----------

def test_main_harvests_and_reports_the_count(tmp_path, capsys):
    _make_run_dir(tmp_path / "src")
    rc = hfr.main([str(tmp_path / "src"), "--cache", str(tmp_path / "cache")])
    assert rc == 0
    assert "1 bundle" in capsys.readouterr().out
    assert (tmp_path / "cache" / "runs" / "run-30" / "bundle.json").exists()


def test_main_is_incremental_and_force_overrides(tmp_path, capsys):
    _make_run_dir(tmp_path / "src")
    args = [str(tmp_path / "src"), "--cache", str(tmp_path / "cache")]
    hfr.main(args)
    capsys.readouterr()
    hfr.main(args)
    assert "0 bundle" in capsys.readouterr().out
    hfr.main(args + ["--force"])
    assert "1 bundle" in capsys.readouterr().out


def test_main_with_no_runs_found_is_a_clean_zero(tmp_path, capsys):
    rc = hfr.main([str(tmp_path / "empty"), "--cache", str(tmp_path / "cache")])
    assert rc == 0
    assert "0 bundle" in capsys.readouterr().out


# ---------- #464 item 1: every bundle tarball is named sandbox-logs.tgz ----------

def test_two_bundles_unpack_to_separate_directories(tmp_path):
    # fetch_bundles writes <dest>/<bundle>/sandbox-logs.tgz, so `path.stem` is
    # the SAME string for every bundle. A stem-keyed unpack dir made each
    # tarball re-report every run extracted before it: 8 tarballs -> 36 dirs.
    src = tmp_path / "src"
    a = _make_run_dir(src / "a", "run-30")
    b = _make_run_dir(src / "b", "run-31")
    tars = []
    for i, d in enumerate((a, b)):
        # the real layout: one directory per bundle, identical file name
        bundle = tmp_path / "dest" / f"fleet-run-{30 + i}-178813{i}"
        bundle.mkdir(parents=True)
        tgz = bundle / "sandbox-logs.tgz"
        with tarfile.open(tgz, "w:gz") as tf:
            tf.add(d, arcname=f"repo/.claude/ultrapowers/{d.name}")
        tars.append(tgz)
    work = tmp_path / "w"
    found = []
    for t in tars:
        found += hfr.discover_run_dirs(t, work)
    assert len(found) == 2, f"expected 2 run dirs, got {len(found)}: {found}"
    assert sorted(p.name for p in found) == ["run-run-30", "run-run-31"]


def test_a_non_object_jsonl_record_is_skipped_with_a_diagnostic(tmp_path, capsys):
    d = _make_run_dir(tmp_path)
    (d / "confine-denials.jsonl").write_text('"a bare string"\n{"tool":"Bash"}\n')
    out = hfr.build_fleet_bundle(d, tmp_path / "cache")
    b = json.loads((out / "bundle.json").read_text())
    assert b["confineDenials"] == [{"tool": "Bash"}]
    assert "non-object record" in capsys.readouterr().err
