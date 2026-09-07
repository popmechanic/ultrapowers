import json
import os
import subprocess
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
    monkeypatch.setattr(hfr._readers, "release_timeline",
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
    # A logs pull writes <dest>/<bundle>/sandbox-logs.tgz, so `path.stem` is
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


# ---------- Task 6 (#624 decision c): the harvester reads the tag ----------
#
# A run's record is the tag `ultra/evidence/run-<N>`; while the one-time sweep
# of already-published runs is pending it is still the branch
# `ultra/evidence-run-<N>`. Each test below names the Machine clause and the
# Proof leg it encodes:
#
#   M1 / leg (a)  `evidence_tag(7)` and `evidence_tag("run-7")` are exactly
#                 `ultra/evidence/run-7`, and `evidence_branch(7)` is still
#                 `ultra/evidence-run-7`.
#   M2 / legs (b)(c)(d)(e)
#                 the six files are read at the branch ref; when a read answers
#                 absent before any file has landed and the tag has not yet been
#                 tried, that same file is read once at the tag ref, and if that
#                 read lands, every later file is read at the tag ref.
#   M3 / leg (b)  a swept run — branch gone, tag holding all six — lands and
#                 bundles in one call at the branch ref, then six at the tag
#                 ref (plus, since #702 Task 2, the transcripts listing at the
#                 resolved ref: eight).
#   M4 / leg (c)  a run present on the branch is read at the branch ref alone:
#                 the six files and the listing, none at the tag ref.
#   M5 / leg (d)  a run on neither ref is one `FAILED-LOOKUP:` line naming the
#                 target, the run and both refs; and (the `Run:` leg) `--help`
#                 names the tag.
#
# Hermetic the way `tests/test_harvest_evidence.py` is: `gh` reaches the
# harvester only as a stub executable on a `PATH` set to its directory alone,
# and every harvest passes `--engine-version` so nothing shells out to `git`
# for a release timeline. The stub is restated here rather than imported, so
# this exam does not depend on the other one's fixtures.

T6_HARVEST = (Path(__file__).resolve().parents[1]
              / "skills/ultralearn/scripts/harvest_fleet_runs.py")
T6_TARGET = "popmechanic/smoke"
T6_RUN = "7"
# The two ref spellings, written out rather than asked of the module under
# test: the branch keeps its BASE spelling, the tag is the new one [M1].
T6_BRANCH_REF = "ultra/evidence-run-7"
T6_TAG_REF = "ultra/evidence/run-7"
# fleet/CONTRACT.md's six files under `.ultrapowers/runs/<N>/`, in the order
# the legs mean by "EVIDENCE_FILES order".
T6_EVIDENCE_FILES = ("status.json", "receipt.json", "gate-receipt.json",
                     "report.json", "events.jsonl", "engine.log")


def _t6_path(name, ref):
    """One contents read, spelled in full — the BASE path with the ref as the
    only thing that varies between branch and tag [M2]."""
    return (f"repos/{T6_TARGET}/contents/.ultrapowers/runs/{T6_RUN}/{name}"
            f"?ref={ref}")


def _t6_events_text(run_id="run-7"):
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
    return "\n".join(json.dumps(e) for e in events) + "\n"


def _t6_gate_text(run_id="run-7"):
    return json.dumps({
        "mode": "gate", "stamp": run_id,
        "branch": "ultra/integration-" + run_id,
        "gateCheck": {"verdict": "NEEDS_ACK", "checks": [], "acks": [
            {"type": "deferred:manual", "detail": "RUNBOOK claims"}]},
        "verdict": "NEEDS_ACK"})


def _t6_bodies(run_id="run-7"):
    return {
        "status.json": json.dumps({"run": T6_RUN, "state": "closed"}),
        "receipt.json": json.dumps({"run": T6_RUN, "verdict": "NEEDS_ACK"}),
        "gate-receipt.json": _t6_gate_text(run_id),
        "report.json": json.dumps({
            "integrationBranch": "ultra/integration-" + run_id,
            "baseSha": "3fa4936",
            "tests": {"command": "python3 -m pytest -n auto", "passed": True,
                      "output": "z" * 9000},
            "judgmentCalls": [{"task": "1", "detail": "chose the additive union"}],
            "deferredVerification": []}),
        "events.jsonl": _t6_events_text(run_id),
        "engine.log": "engine: wave 1 dispatched\n",
    }


def _t6_answers(ref, names=T6_EVIDENCE_FILES, run_id="run-7"):
    """What the stub `gh` serves at one ref: `names` of the six files, keyed by
    the full `repos/…?ref=<ref>` argument."""
    bodies = _t6_bodies(run_id)
    return {_t6_path(n, ref): bodies[n] for n in names}


# The `gh` stub: a Python executable named `gh`, answering from a JSON map
# keyed by the `repos/…` argv (a missing key is `gh: HTTP 404` on stderr and
# exit 1) and appending each argv as a JSON line to a log file.
_T6_GH_STUB = '''
import base64
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
answers = json.loads((HERE / "gh-stub.json").read_text())
argv = sys.argv[1:]
with (HERE / "gh-argv.log").open("a") as fh:
    fh.write(json.dumps(argv) + "\\n")

if not argv or argv[0] != "api":
    sys.stderr.write("gh: HTTP 404: Not Found\\n")
    sys.exit(1)

path = None
for arg in argv[1:]:
    if arg.startswith("repos/"):
        path = arg
        break
body = answers.get(path) if path else None
if body is None:
    sys.stderr.write("gh: HTTP 404: Not Found (https://api.github.com/%s)\\n" % path)
    sys.exit(1)

# #702 Task 2: the contents API answers a DIRECTORY path with a JSON ARRAY of
# entries — `name`, `path`, `sha`, `size`, `type`, `download_url`, and no
# `content`. An answer that is a list is printed as that list, unwrapped; every
# file answer is still wrapped in the base64 envelope below.
if isinstance(body, list):
    sys.stdout.write(json.dumps(body) + "\\n")
    sys.exit(0)

raw = body.encode()
sys.stdout.write(json.dumps({
    "name": path.rsplit("/", 1)[-1].split("?")[0],
    "path": path.split("?")[0],
    "sha": "0" * 40,
    "size": len(raw),
    "type": "file",
    "encoding": "base64",
    "content": base64.encodebytes(raw).decode(),
}) + "\\n")
'''


def _t6_install_gh(tmp_path, monkeypatch, answers):
    """Put the stub `gh` on an otherwise empty `PATH`; return its argv log."""
    bin_dir = tmp_path / "t6bin"
    bin_dir.mkdir()
    (bin_dir / "gh-stub.json").write_text(json.dumps(answers))
    stub = bin_dir / "gh"
    stub.write_text(f"#!{sys.executable}\n" + _T6_GH_STUB)
    stub.chmod(0o755)
    monkeypatch.setenv("PATH", str(bin_dir))
    return bin_dir / "gh-argv.log"


def _t6_calls(log):
    """The stub's argv log: one list per `gh` invocation, in order."""
    if not log.exists():
        return []
    return [json.loads(ln) for ln in log.read_text().splitlines() if ln.strip()]


def _t6_refs(log):
    """The `repos/…?ref=…` argument of each `gh api` call, in order."""
    return [c[-1] for c in _t6_calls(log)]


def _t6_main(argv):
    """`hfr.main`, with an argparse `SystemExit` reported as its exit code."""
    try:
        return hfr.main(list(argv))
    except SystemExit as exc:
        if exc.code is None:
            return 0
        return exc.code if isinstance(exc.code, int) else 1


def _t6_harvest(cache):
    return ["--evidence", T6_TARGET, "--run", T6_RUN, "--cache", str(cache),
            "--engine-version", "0.3.0"]


def test_t6_evidence_tag_is_the_run_tag_and_the_branch_keeps_its_base_spelling():
    """M1, leg (a): `evidence_tag(7)` and `evidence_tag("run-7")` are exactly
    `ultra/evidence/run-7` — the tag spelling, not the branch one — and
    `evidence_branch(7)` is still `ultra/evidence-run-7`."""
    assert hfr.evidence_tag(7) == "ultra/evidence/run-7"
    assert hfr.evidence_tag("run-7") == "ultra/evidence/run-7"
    assert hfr.evidence_branch(7) == "ultra/evidence-run-7"
    assert hfr.evidence_branch("run-7") == "ultra/evidence-run-7"


def test_t6_a_swept_run_lands_from_the_tag_in_exactly_eight_calls(
        tmp_path, monkeypatch, capsys):
    """M2/M3, leg (b): the branch is gone and the tag holds all six files. The
    harvest exits 0, writes `<cache>/runs/run-7/bundle.json` with `terminus`
    from the fetched gate receipt, and makes exactly EIGHT `gh api` calls: the
    first at `…/status.json?ref=ultra/evidence-run-7`, the next six at
    `?ref=ultra/evidence/run-7`, one per evidence file, and — #702 Task 2 — the
    `transcripts` listing eighth, at the ref the loop resolved (the tag), which
    this fixture answers 404. A harvester that tries the tag per missing file,
    or never, still fails this leg."""
    log = _t6_install_gh(tmp_path, monkeypatch, _t6_answers(T6_TAG_REF))
    cache = tmp_path / "cache"

    rc = _t6_main(_t6_harvest(cache))
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert _t6_refs(log) == (
        [_t6_path("status.json", T6_BRANCH_REF)]
        + [_t6_path(n, T6_TAG_REF) for n in T6_EVIDENCE_FILES]
        + [_t6_path(T6_TRANSCRIPTS, T6_TAG_REF)]), _t6_refs(log)
    # M2 spells the command exactly: `gh api <path>`, nothing else.
    assert [c for c in _t6_calls(log) if c != ["api", c[-1]]] == [], _t6_calls(log)

    out = cache / "runs" / "run-7"
    assert (out / "bundle.json").exists(), f"no bundle at {out}; stderr:\n{cap.err}"
    b = json.loads((out / "bundle.json").read_text())
    assert b["runId"] == "run-7"
    assert b["terminus"] == "NEEDS_ACK"
    assert b["gateReport"]["gateCheck"]["verdict"] == "NEEDS_ACK"
    assert b["report"]["baseSha"] == "3fa4936"
    assert b["audit"]["totals"]["outputTokens"] == 6463
    assert (out / "slice.md").exists()
    assert _lines(cap.err, "FAILED-LOOKUP:") == [], cap.err


def test_t6_a_run_on_the_branch_is_read_exactly_as_at_base(
        tmp_path, monkeypatch, capsys):
    """M2/M4, leg (c): the branch answers all six, so the tag is never probed —
    the six file reads at `?ref=ultra/evidence-run-7` and, after them, #702
    Task 2's one `transcripts` listing at the same ref: seven calls, none
    containing `ultra/evidence/run-7`. A harvester that probes the tag when the
    branch already answered fails this leg."""
    log = _t6_install_gh(tmp_path, monkeypatch, _t6_answers(T6_BRANCH_REF))
    cache = tmp_path / "cache"

    rc = _t6_main(_t6_harvest(cache))
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert _t6_refs(log) == ([_t6_path(n, T6_BRANCH_REF)
                              for n in T6_EVIDENCE_FILES]
                             + [_t6_path(T6_TRANSCRIPTS, T6_BRANCH_REF)]), _t6_refs(log)
    assert [p for p in _t6_refs(log) if T6_TAG_REF in p] == [], _t6_refs(log)
    assert (cache / "runs" / "run-7" / "bundle.json").exists(), cap.err
    assert _lines(cap.err, "FAILED-LOOKUP:") == [], cap.err


def test_t6_a_run_on_neither_ref_names_both_refs_and_probes_the_tag_once(
        tmp_path, monkeypatch, capsys):
    """M2/M5, leg (d): nothing answers anywhere. Exit 2, exactly one
    `FAILED-LOOKUP:` line naming the target, the run and both refs, no cache,
    and exactly seven `gh api` calls of which exactly one is at the tag ref —
    the `status.json` read, issued second, directly after the `status.json`
    read at the branch ref — the other six being the six files at the branch
    ref in `EVIDENCE_FILES` order. A harvester that re-probes the tag for every
    remaining file after the one tag miss, or that never tries it, fails.

    #702 Task 2 leaves this count where it is: a run that lands nothing raises
    `FailedLookup` before any listing is read, so no path here names
    `transcripts`."""
    assert hfr.EVIDENCE_FILES == T6_EVIDENCE_FILES, hfr.EVIDENCE_FILES
    log = _t6_install_gh(tmp_path, monkeypatch, {})
    cache = tmp_path / "cache"

    rc = _t6_main(_t6_harvest(cache))
    cap = capsys.readouterr()

    assert rc == 2, f"expected exit 2, got {rc}\nstderr:\n{cap.err}"
    failed = _lines(cap.err, "FAILED-LOOKUP:")
    assert len(failed) == 1, f"expected one FAILED-LOOKUP line, got: {cap.err}"
    for token in (T6_TARGET, T6_RUN, T6_BRANCH_REF, T6_TAG_REF):
        assert token in failed[0], f"{token!r} missing from: {failed[0]}"
    assert not (cache / "runs").exists()

    refs = _t6_refs(log)
    assert len(refs) == 7, f"expected seven gh api calls, got {refs}"
    assert refs[0] == _t6_path("status.json", T6_BRANCH_REF), refs
    assert refs[1] == _t6_path("status.json", T6_TAG_REF), refs
    assert [p for p in refs if T6_TAG_REF in p] == [
        _t6_path("status.json", T6_TAG_REF)], refs
    assert [p for p in refs if T6_TAG_REF not in p] == [
        _t6_path(n, T6_BRANCH_REF) for n in T6_EVIDENCE_FILES], refs
    assert [p for p in refs if T6_TRANSCRIPTS in p] == [], refs


def test_t6_an_absence_after_a_file_has_landed_never_falls_back_to_the_tag(
        tmp_path, monkeypatch, capsys):
    """M2, leg (e): the branch answers `status.json`, `gate-receipt.json`,
    `report.json` and `events.jsonl` — so the first read lands and
    `receipt.json` and `engine.log` are absent on the branch — while the tag
    holds all six. The harvest exits 0, writes the bundle, and makes exactly
    seven `gh api` calls (the six files and, #702 Task 2, the `transcripts`
    listing seventh), all at the branch ref and none containing
    `ultra/evidence/run-7`: a harvester that falls back to the tag on an absent
    read after a file has already landed fails this leg, because the tag would
    have answered."""
    answers = dict(
        _t6_answers(T6_BRANCH_REF, ("status.json", "gate-receipt.json",
                                    "report.json", "events.jsonl")),
        **_t6_answers(T6_TAG_REF))
    log = _t6_install_gh(tmp_path, monkeypatch, answers)
    cache = tmp_path / "cache"

    rc = _t6_main(_t6_harvest(cache))
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert _t6_refs(log) == ([_t6_path(n, T6_BRANCH_REF)
                              for n in T6_EVIDENCE_FILES]
                             + [_t6_path(T6_TRANSCRIPTS, T6_BRANCH_REF)]), _t6_refs(log)
    assert [p for p in _t6_refs(log) if T6_TAG_REF in p] == [], _t6_refs(log)
    assert (cache / "runs" / "run-7" / "bundle.json").exists(), cap.err
    assert _lines(cap.err, "FAILED-LOOKUP:") == [], cap.err


# ---------- #702 Task 2: the record carries the slices, the harvester reads
# ---------- them ----------
#
# The evidence branch never carried `claude/projects/`, so every worker of every
# fetched run rendered `_no transcript found_`. The record now holds
# `.ultrapowers/runs/<N>/transcripts/<sessionId>.jsonl`, and the harvester reads
# that directory the way the contents API serves one: a LISTING read of the
# directory path — a JSON array of `{name, path, type, …}` entries, no `content`
# envelope — then one contents read per `type == "file"` entry, at the same ref.
#
#   M3 / legs (e)(f)  one listing read, issued after the six-file loop and after
#                     the `events.jsonl` check, at the ref the loop resolved;
#                     one read per `type == "file"` entry and none for any other
#                     type; a 404 listing is one `harvest_fleet_runs:` line, no
#                     `transcripts/` directory, no `FAILED-LOOKUP:`, exit 0.
#   M4 / leg (e)      the fetched run directory's `transcripts/<sessionId>.jsonl`
#                     renders that worker's slice section, so `slice.md` no
#                     longer says `_no transcript found_`.

#: The directory path segment, and the listing/entry reads spelled through
#: `_t6_path` — the BASE contents path with `transcripts` in the file slot.
T6_TRANSCRIPTS = "transcripts"
#: The two `.jsonl` entries the listing names. The first is the fixture
#: worker's session (`sess-1` in `worker:start`/`worker:end`), so the slice
#: builder joins it to that worker by name.
T6_SLICE_NAMES = ("sess-1.jsonl", "bbbb-2.jsonl")
#: A string that exists nowhere but inside the fetched slice body [M4].
T6_SLICE_MARK = "TRANSCRIPT-OFF-THE-RECORD"


def _t6_slice_text(session_id, mark):
    """A slice file's bytes: the transcript's own shape, one record per line —
    a text turn, an assistant turn carrying a reduced `tool_use`, and the
    elision marker. `_readers.records()` reads it unchanged."""
    return "\n".join([
        json.dumps({"type": "user", "uuid": "u-1", "parentUuid": None,
                    "timestamp": "2026-09-06T00:00:00Z", "sessionId": session_id,
                    "message": {"role": "user",
                                "content": [{"type": "text", "text": mark}]}}),
        json.dumps({"type": "assistant", "uuid": "u-2", "parentUuid": "u-1",
                    "timestamp": "2026-09-06T00:00:01Z", "sessionId": session_id,
                    "message": {"role": "assistant", "model": "claude-opus-5",
                                "content": [
                                    {"type": "text", "text": f"{session_id} reporting"},
                                    {"type": "tool_use", "id": "toolu_1",
                                     "name": "Read",
                                     "input": {"file_path": "/clones/task-1/a.py"}}]}}),
        json.dumps({"type": "system", "subtype": "elided", "records": 37}),
    ]) + "\n"


def _t6_listing_entries(names=T6_SLICE_NAMES):
    """What the contents API answers a directory path with: one entry per file,
    in the listing's own order, plus one `type: "dir"` entry the harvester must
    NOT read — a directory is not a slice."""
    entries = [{"name": n,
                "path": f".ultrapowers/runs/{T6_RUN}/{T6_TRANSCRIPTS}/{n}",
                "sha": "0" * 40, "size": 1, "type": "file",
                "download_url": f"https://example.invalid/{n}"}
               for n in names]
    entries.append({"name": "nested",
                    "path": f".ultrapowers/runs/{T6_RUN}/{T6_TRANSCRIPTS}/nested",
                    "sha": "1" * 40, "size": 0, "type": "dir",
                    "download_url": None})
    return entries


def _t6_slice_bodies(names=T6_SLICE_NAMES):
    """`<name> -> bytes`, the first carrying the fixture worker's session id."""
    return {n: _t6_slice_text(n[:-len(".jsonl")],
                              T6_SLICE_MARK if i == 0 else f"the {n} body")
            for i, n in enumerate(names)}


def _t6_transcript_answers(ref, names=T6_SLICE_NAMES):
    """The listing at `ref` (a JSON array, served unwrapped) plus one file
    answer per listed `.jsonl`, at the same ref."""
    answers = {_t6_path(T6_TRANSCRIPTS, ref): _t6_listing_entries(names)}
    for name, body in _t6_slice_bodies(names).items():
        answers[_t6_path(f"{T6_TRANSCRIPTS}/{name}", ref)] = body
    return answers


def _t6_warn_lines(err):
    """The harvester's own advisory lines — `_warn`'s prefix, not #489's."""
    return [ln for ln in err.splitlines()
            if ln.startswith("harvest_fleet_runs:")]


def test_t2_the_listing_and_every_listed_file_are_read_at_the_resolved_ref(
        tmp_path, monkeypatch, capsys):
    """M3/M4, leg (e): the six files answer on the branch, the listing answers
    with a three-entry array (two `type: "file"` `.jsonl` entries and one
    `type: "dir"`), and each listed file answers with a slice body. The harvest
    exits 0 and the call log is exactly the six file paths, then the listing
    path, then the two `.jsonl` file paths, in that order — nine calls, and no
    path naming `nested`, because a directory entry is not read."""
    answers = dict(_t6_answers(T6_BRANCH_REF),
                   **_t6_transcript_answers(T6_BRANCH_REF))
    log = _t6_install_gh(tmp_path, monkeypatch, answers)
    cache = tmp_path / "cache"

    rc = _t6_main(_t6_harvest(cache))
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    refs = _t6_refs(log)
    assert refs == ([_t6_path(n, T6_BRANCH_REF) for n in T6_EVIDENCE_FILES]
                    + [_t6_path(T6_TRANSCRIPTS, T6_BRANCH_REF)]
                    + [_t6_path(f"{T6_TRANSCRIPTS}/{n}", T6_BRANCH_REF)
                       for n in T6_SLICE_NAMES]), refs
    assert len(refs) == 9, refs
    assert [p for p in refs if "nested" in p] == [], (
        "a `type: \"dir\"` entry is not a slice and is never read: " + repr(refs))
    # M2's spelling is unchanged: `gh api <path>`, nothing else.
    assert [c for c in _t6_calls(log) if c != ["api", c[-1]]] == [], _t6_calls(log)
    assert _lines(cap.err, "FAILED-LOOKUP:") == [], cap.err

    # M4: the worker's section is rendered from the fetched slice, so the string
    # this harvest exists to remove is gone.
    md = (cache / "runs" / "run-7" / "slice.md").read_text()
    assert "## impl:1 (implementer, session sess-1)" in md, md
    assert T6_SLICE_MARK in md, md
    assert "_no transcript found_" not in md, md


def test_t2_each_listed_file_lands_byte_equal_under_the_fetch_destination(
        tmp_path, monkeypatch, capsys):
    """M3, leg (e): `fetch_evidence` writes each listed file's decoded bytes to
    `<dest>/transcripts/<name>`, byte for byte and under the same name — and
    writes nothing for the `type: "dir"` entry. Read through `fetch_evidence`
    itself because `main`'s destination is a `TemporaryDirectory` that is gone
    by the time it returns."""
    answers = dict(_t6_answers(T6_BRANCH_REF),
                   **_t6_transcript_answers(T6_BRANCH_REF))
    _t6_install_gh(tmp_path, monkeypatch, answers)

    dest = hfr.fetch_evidence(T6_TARGET, T6_RUN, tmp_path / "evidence" / T6_RUN)
    capsys.readouterr()

    assert dest == tmp_path / "evidence" / T6_RUN
    landed = dest / T6_TRANSCRIPTS
    assert landed.is_dir(), f"no transcripts/ under {dest}: {sorted(p.name for p in dest.iterdir())}"
    assert sorted(p.name for p in landed.iterdir()) == sorted(T6_SLICE_NAMES), (
        sorted(p.name for p in landed.iterdir()))
    for name, body in _t6_slice_bodies().items():
        assert (landed / name).read_bytes() == body.encode(), name


def test_t2_a_404_listing_is_one_advisory_line_and_no_transcripts_directory(
        tmp_path, monkeypatch, capsys):
    """M3, leg (f): the six files answer and the listing does not (a 404). The
    harvest exits 0 and the bundle lands; the call log is exactly the six file
    paths then the listing path — seven calls, no file reads; stderr carries
    one `harvest_fleet_runs:` line naming `transcripts` and no `FAILED-LOOKUP:`;
    and no `transcripts/` directory is created under the fetch destination. A
    run whose engine wrote no slices is an absence, not a failure."""
    log = _t6_install_gh(tmp_path, monkeypatch, _t6_answers(T6_BRANCH_REF))
    cache = tmp_path / "cache"

    rc = _t6_main(_t6_harvest(cache))
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert _t6_refs(log) == ([_t6_path(n, T6_BRANCH_REF) for n in T6_EVIDENCE_FILES]
                             + [_t6_path(T6_TRANSCRIPTS, T6_BRANCH_REF)]), _t6_refs(log)
    assert (cache / "runs" / "run-7" / "bundle.json").exists(), cap.err
    assert _lines(cap.err, "FAILED-LOOKUP:") == [], cap.err
    warned = _t6_warn_lines(cap.err)
    assert len(warned) == 1, f"expected one harvest_fleet_runs: line, got: {cap.err}"
    assert T6_TRANSCRIPTS in warned[0], warned[0]

    # The same absence, read through `fetch_evidence` so the destination
    # outlives the call: no `transcripts/` directory at all.
    log.unlink()
    dest = hfr.fetch_evidence(T6_TARGET, T6_RUN, tmp_path / "evidence" / T6_RUN)
    capsys.readouterr()
    assert not (dest / T6_TRANSCRIPTS).exists(), (
        "a 404 listing conjures no transcripts/ directory: "
        + repr(sorted(p.name for p in dest.iterdir())))


def test_t6_help_names_the_tag_as_well_as_the_branch():
    """M5, the first `Run:` leg: `--help` names `ultra/evidence/run-<N>`. The
    branch is still named too — reading by tag adds a ref, it does not retire
    the branch while the sweep is pending."""
    proc = subprocess.run([sys.executable, str(T6_HARVEST), "--help"],
                          capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "ultra/evidence/run-" in proc.stdout, proc.stdout
    assert "ultra/evidence-run-" in proc.stdout, proc.stdout
