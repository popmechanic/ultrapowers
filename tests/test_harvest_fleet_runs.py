import json
import os
import sys
import tarfile
from pathlib import Path

import pytest

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


def _lines(err, prefix):
    """The machine-greppable outcome lines, in order — the whole point of the
    #489 prefixes is that they can be selected rather than read."""
    return [ln for ln in err.splitlines() if ln.startswith(prefix)]


def _bundle_tarball(dest_root, bundle_name, run_dir):
    """The orchestrator's on-disk layout: one directory per evidence bundle,
    the tarball inside it always named `sandbox-logs.tgz`."""
    d = dest_root / bundle_name
    d.mkdir(parents=True)
    tgz = d / "sandbox-logs.tgz"
    with tarfile.open(tgz, "w:gz") as tf:
        tf.add(run_dir, arcname=f"repo/.claude/ultrapowers/{run_dir.name}")
    return tgz


def _corrupt_tarball(dest_root, bundle_name, run_dir):
    """A `sandbox-logs.tgz` whose gzip stream stops mid-member — what a
    truncated scp actually leaves behind. Padded with incompressible bytes so
    the first tar header still reads: the file opens and fails on *extract*,
    which is the path a plain `is_tarfile` check walks straight past."""
    (run_dir / "pad.bin").write_bytes(os.urandom(1 << 17))
    tgz = _bundle_tarball(dest_root, bundle_name, run_dir)
    raw = tgz.read_bytes()
    tgz.write_bytes(raw[:len(raw) * 2 // 5])
    (run_dir / "pad.bin").unlink()
    assert tarfile.is_tarfile(tgz), "corrupt fixture must still open"
    return tgz


def _make_quiet_run_dir(root, run_id="run-40"):
    """Readable, real events, nothing for a lens to find: no workers, no
    report, no gate receipt, no confine denials."""
    d = root / f"run-{run_id}"
    d.mkdir(parents=True)
    events = [
        _ev(1, 0, kind="run:open", runId=run_id, base="", source="fleet/run-main.mjs"),
        _ev(2, 1000, kind="engine:phase", phase="Wave 1"),
        _ev(3, 2000, kind="engine:log", detail="no tasks dispatched"),
    ]
    (d / "events.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return d


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


def test_discover_of_a_missing_path_is_a_failed_lookup(tmp_path):
    # #489: "could not look" is not "looked and found nothing". A path that is
    # not there was never looked at, so it raises rather than reading as empty.
    with pytest.raises(hfr.FailedLookup) as exc:
        hfr.discover_run_dirs(tmp_path / "gone", tmp_path / "w")
    assert str(exc.value) == f"no such evidence path: {tmp_path / 'gone'}"


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
    # A real tree that holds no fleet runs: the lookup succeeded and found
    # nothing. LOOKED-EMPTY, exit 0 — the opposite of a missing path.
    (tmp_path / "empty").mkdir()
    rc = hfr.main([str(tmp_path / "empty"), "--cache", str(tmp_path / "cache")])
    assert rc == 0
    cap = capsys.readouterr()
    assert "0 bundle" in cap.out
    assert _lines(cap.err, "LOOKED-EMPTY:") == [
        f"LOOKED-EMPTY: {tmp_path / 'empty'}: no fleet run directories"]
    assert _lines(cap.err, "FAILED-LOOKUP:") == []


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


# ---------- #489: fail loud at the input layer ----------

def test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land(tmp_path, capsys):
    # The N−M contract: two inputs, one unreadable, one bundle lands and the
    # corrupt run is named. Partial failure never aborts the remainder.
    src, dest, cache = tmp_path / "src", tmp_path / "dest", tmp_path / "cache"
    good = _bundle_tarball(dest, "fleet-run-30-1788130000",
                           _make_run_dir(src, "run-30"))
    bad = _corrupt_tarball(dest, "fleet-run-31-1788130001",
                           _make_run_dir(src, "run-31"))

    rc = hfr.main([str(good), str(bad), "--cache", str(cache)])

    assert rc == 0
    cap = capsys.readouterr()
    failed = _lines(cap.err, "FAILED-LOOKUP:")
    assert len(failed) == 1, failed
    assert failed[0].startswith(f"FAILED-LOOKUP: cannot unpack {bad}: ")
    assert "run-31" in failed[0]
    assert (cache / "runs" / "run-30" / "bundle.json").exists()
    assert not (cache / "runs" / "run-31").exists()
    assert "1 bundle" in cap.out


def test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line(tmp_path, capsys):
    src, dest, cache = tmp_path / "src", tmp_path / "dest", tmp_path / "cache"
    good = _bundle_tarball(dest, "fleet-run-30-1788130000",
                           _make_run_dir(src, "run-30"))
    bad = dest / "fleet-run-31-1788130001" / "sandbox-logs.tgz"
    bad.parent.mkdir(parents=True)
    bad.write_bytes(b"this is not a tarball at all" * 64)

    rc = hfr.main([str(good), str(bad), "--cache", str(cache)])

    assert rc == 0
    cap = capsys.readouterr()
    assert _lines(cap.err, "FAILED-LOOKUP:") == [
        f"FAILED-LOOKUP: not a fleet run directory or tarball: {bad}"]
    assert (cache / "runs" / "run-30" / "bundle.json").exists()


def test_every_input_failing_exits_two(tmp_path, capsys):
    src, dest, cache = tmp_path / "src", tmp_path / "dest", tmp_path / "cache"
    a = _corrupt_tarball(dest, "fleet-run-30-1788130000",
                         _make_run_dir(src, "run-30"))
    b = dest / "fleet-run-31-1788130001" / "sandbox-logs.tgz"
    b.parent.mkdir(parents=True)
    b.write_bytes(b"garbage" * 64)

    rc = hfr.main([str(a), str(b), "--cache", str(cache)])

    assert rc == 2
    cap = capsys.readouterr()
    assert len(_lines(cap.err, "FAILED-LOOKUP:")) == 2
    assert not (cache / "runs").exists()
    assert "0 bundle" in cap.out


def test_main_on_a_missing_path_exits_two_naming_the_path(tmp_path, capsys):
    rc = hfr.main([str(tmp_path / "gone"), "--cache", str(tmp_path / "cache")])
    assert rc == 2
    assert _lines(capsys.readouterr().err, "FAILED-LOOKUP:") == [
        f"FAILED-LOOKUP: no such evidence path: {tmp_path / 'gone'}"]


def test_a_failure_beside_an_already_cached_run_is_not_a_total_failure(tmp_path, capsys):
    # Exit 2 means *every* input failed. A run that was already harvested is a
    # successful lookup, so the run beside it failing is still exit 0.
    src, cache = tmp_path / "src", tmp_path / "cache"
    _make_run_dir(src, "run-30")
    hfr.main([str(src), "--cache", str(cache)])
    capsys.readouterr()

    rc = hfr.main([str(src), str(tmp_path / "gone"), "--cache", str(cache)])

    assert rc == 0
    cap = capsys.readouterr()
    assert len(_lines(cap.err, "FAILED-LOOKUP:")) == 1
    assert "0 bundle" in cap.out


# ---------- #489: no structurally empty bundle is ever written ----------

def test_build_refuses_a_zero_event_run_dir(tmp_path, capsys):
    d = _make_run_dir(tmp_path, "run-30")
    (d / "events.jsonl").write_text("\n   \n")

    assert hfr.build_fleet_bundle(d, tmp_path / "cache") is None

    assert not (tmp_path / "cache").exists()
    assert _lines(capsys.readouterr().err, "FAILED-LOOKUP:") == [
        f"FAILED-LOOKUP: {d}: bundle would carry zero events — refused"]


def test_a_zero_event_bundle_is_refused_and_absent_from_the_cache(tmp_path, capsys):
    src, cache = tmp_path / "src", tmp_path / "cache"
    d = _make_run_dir(src, "run-30")
    (d / "events.jsonl").write_text("")

    rc = hfr.main([str(src), "--cache", str(cache)])

    assert rc == 2
    cap = capsys.readouterr()
    assert _lines(cap.err, "FAILED-LOOKUP:") == [
        f"FAILED-LOOKUP: {d}: bundle would carry zero events — refused"]
    assert not (cache / "runs").exists()
    assert "0 bundle" in cap.out


def test_a_zero_event_run_beside_a_healthy_one_refuses_only_itself(tmp_path, capsys):
    src, cache = tmp_path / "src", tmp_path / "cache"
    _make_run_dir(src, "run-30")
    empty = _make_run_dir(src, "run-31")
    (empty / "events.jsonl").write_text("")

    rc = hfr.main([str(src), "--cache", str(cache)])

    assert rc == 0
    cap = capsys.readouterr()
    assert _lines(cap.err, "FAILED-LOOKUP:") == [
        f"FAILED-LOOKUP: {empty}: bundle would carry zero events — refused"]
    assert (cache / "runs" / "run-30" / "bundle.json").exists()
    assert sorted(p.name for p in (cache / "runs").iterdir()) == ["run-30"]


# ---------- #489: looked-and-found-nothing stays a healthy bundle ----------

def test_a_run_with_events_but_no_findings_still_bundles_and_looks_empty(tmp_path, capsys):
    src, cache = tmp_path / "src", tmp_path / "cache"
    _make_quiet_run_dir(src, "run-40")

    rc = hfr.main([str(src), "--cache", str(cache)])

    assert rc == 0
    cap = capsys.readouterr()
    out = cache / "runs" / "run-40"
    assert json.loads((out / "bundle.json").read_text())["runId"] == "run-40"
    assert (out / "slice.md").exists()
    assert _lines(cap.err, "LOOKED-EMPTY:") == [
        "LOOKED-EMPTY: run-40: bundle carries no worker, report, gate receipt, "
        "or confine-denial evidence"]
    assert _lines(cap.err, "FAILED-LOOKUP:") == []
    assert "1 bundle" in cap.out


def test_a_run_that_carries_findings_is_never_reported_looked_empty(tmp_path, capsys):
    src, cache = tmp_path / "src", tmp_path / "cache"
    _make_run_dir(src, "run-30")

    rc = hfr.main([str(src), "--cache", str(cache)])

    assert rc == 0
    assert _lines(capsys.readouterr().err, "LOOKED-EMPTY:") == []
