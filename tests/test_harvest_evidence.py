"""Exam for Task 2 — `--evidence owner/repo --run N` replaces `--remote`.

Claim: `harvest_fleet_runs.py --evidence owner/repo --run N` pulls a run's
record straight from the target's `ultra/evidence-run-N` branch and builds the
same bundle the ledger reads.

Each test below names the Machine clause and the Proof leg it encodes:

  M1 / leg (a)  `--evidence OWNER/REPO` with one or more `--run N` (`run-N`
                normalised); `--evidence` without `--run` is exit 2 + a usage
                line; `--remote` and `--remote-root` are gone; `--help` names
                `--evidence` and not `--remote`.
  M2 / legs (a)(b)
                the six evidence files fetched with exactly
                `gh api repos/OWNER/REPO/contents/.ultrapowers/runs/N/<file>
                ?ref=ultra/evidence-run-N`, the base64 `content` decoded into
                `<tmp>/evidence/N/`, and handed to `discover_run_dirs`; a
                non-zero `gh` on one file is a marked skip and the run still
                bundles — except `events.jsonl`, whose absence is a
                `FAILED-LOOKUP:` naming the run and the branch.
  M3 / leg (c)  no `gh` on `PATH`, or a `gh` that fails on every path, makes
                the run a `FailedLookup` naming `OWNER/REPO` and `N`, and the
                process exits 2 only when nothing else built or was skipped.
  M4 / leg (d)  `fleet_fetch.py` and its test are gone, the harvester does not
                import `fleet_fetch`, the deleted remote test and the
                `NOT_YET_SWEPT` entry are gone, the docs allowlist names
                `--evidence` and not `--remote`/`--remote-root`.
  M5 / leg (e)  the bundle written for a run directory on disk is unchanged
                from the one the BASE harvester writes.

Hermetic by construction: `gh` reaches the harvester only as a stub executable
on `PATH` (`PATH` is set to the stub directory alone), and every harvest here
passes `--engine-version` so nothing shells out to `git` for a release
timeline. No network, no real `gh`, no real `ssh`.
"""
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "skills/ultralearn/scripts"
HARVEST = SCRIPTS / "harvest_fleet_runs.py"

sys.path.insert(0, str(SCRIPTS))
import harvest_fleet_runs as hfr  # noqa: E402

TARGET = "popmechanic/smoke"
RUN = "7"
BRANCH = f"ultra/evidence-run-{RUN}"

# fleet/CONTRACT.md's six files under `.ultrapowers/runs/<N>/` on the evidence
# branch — the set M2 names, in the order M2 names them.
EVIDENCE_FILES = ("status.json", "receipt.json", "gate-receipt.json",
                  "report.json", "events.jsonl", "engine.log")

# The bundle key set the BASE harvester writes, taken from its blob at the
# plan's BASE sha (2cc873fb2d040fbe081f35ff0ababc408eaa6500) run over the
# fixture below. Frozen here so M5 compares against BASE, not against whatever
# the harvester happens to write after this task.
BASE_BUNDLE_KEYS = frozenset({
    "runId", "sessionId", "projectSlug", "origin", "sessionKind",
    "engineVersion", "planPath", "transcriptDir", "gateReport", "terminus",
    "truncated", "audit", "report", "events", "planningFound",
    "confineDenials"})

T0 = 1788130000000


# ---------- fixture: `_make_run_dir`'s run directory, and the same bytes
# ---------- served over the contents API by the `gh` stub.

def _ev(i, off, **f):
    return dict(f, id=f"01AAA{i:03d}", ts=T0 + off)


def _events_text(run_id):
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


def _report_text(run_id):
    return json.dumps({
        "integrationBranch": "ultra/integration-" + run_id,
        "baseSha": "3fa4936",
        "tests": {"command": "python3 -m pytest -n auto", "passed": True,
                  "output": "z" * 9000},
        "judgmentCalls": [{"task": "1", "detail": "chose the additive union"}],
        "deferredVerification": [],
    })


def _gate_text(run_id):
    return json.dumps({
        "mode": "gate", "stamp": run_id,
        "branch": "ultra/integration-" + run_id,
        "gateCheck": {"verdict": "NEEDS_ACK", "checks": [], "acks": [
            {"type": "deferred:manual", "detail": "RUNBOOK claims"}]},
        "verdict": "NEEDS_ACK"})


def _make_run_dir(root, run_id="run-30"):
    """`tests/test_harvest_fleet_runs.py`'s `_make_run_dir` fixture, restated
    here so this exam does not import a module two concurrent tasks rewrite.
    Same files, same bytes: the structurally faithful miniature of a real
    fleet run directory that M5 compares BASE and HEAD over."""
    d = root / f"run-{run_id}"
    (d / "claude" / "projects" / "-clones-task-1").mkdir(parents=True)
    (d / "events.jsonl").write_text(_events_text(run_id))
    (d / "claude" / "projects" / "-clones-task-1" / "sess-1.jsonl").write_text(
        json.dumps({"type": "user",
                    "message": {"content": [{"type": "text",
                                             "text": "run the wave gate"}]}}) + "\n")
    (d / "report.json").write_text(_report_text(run_id))
    (d / "gate-receipt.json").write_text(_gate_text(run_id))
    (d / "confine-denials.jsonl").write_text(
        json.dumps({"tool": "Bash", "reason": "outside clone"}) + "\n")
    return d


def _api_path(name, run=RUN, target=TARGET):
    """The read `fleet/janitor.mjs` makes, spelled out in full — M2."""
    return (f"repos/{target}/contents/.ultrapowers/runs/{run}/{name}"
            f"?ref=ultra/evidence-run-{run}")


def _expected_paths(run=RUN, target=TARGET):
    return [_api_path(n, run, target) for n in EVIDENCE_FILES]


def _answers(run=RUN, run_id=None, *, missing=(), target=TARGET):
    """What the stub `gh` serves: one contents envelope per evidence path."""
    run_id = run_id or f"run-{run}"
    bodies = {
        "status.json": json.dumps({"run": run, "state": "closed"}),
        "receipt.json": json.dumps({"run": run, "verdict": "NEEDS_ACK"}),
        "gate-receipt.json": _gate_text(run_id),
        "report.json": _report_text(run_id),
        "events.jsonl": _events_text(run_id),
        "engine.log": "engine: wave 1 dispatched\n",
    }
    return {_api_path(n, run, target): body for n, body in bodies.items()
            if n not in missing}


# ---------- the `gh` stub: the deleted remote test's idiom, an executable on
# ---------- PATH, reused for the contents API.

_STUB_BODY = '''
import base64
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
conf = json.loads((HERE / "gh-stub.json").read_text())
argv = sys.argv[1:]
with (HERE / "gh-argv.log").open("a") as fh:
    fh.write(json.dumps(argv) + "\\n")

if conf.get("failAll") or not argv or argv[0] != "api":
    sys.stderr.write("gh: HTTP 404: Not Found\\n")
    sys.exit(1)

path = None
for arg in argv[1:]:
    if arg.startswith("repos/"):
        path = arg
        break
body = conf["answers"].get(path) if path else None
if body is None:
    sys.stderr.write("gh: HTTP 404: Not Found (https://api.github.com/%s)\\n" % path)
    sys.exit(1)

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


def _install_gh(tmp_path, monkeypatch, answers=None, *, fail_all=False,
                absent=False):
    """Put a `gh` on an otherwise empty `PATH` and return its argv log path.

    `absent=True` installs no `gh` at all — the M3 "missing from PATH" case.
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = bin_dir / "gh-argv.log"
    if not absent:
        (bin_dir / "gh-stub.json").write_text(
            json.dumps({"answers": answers or {}, "failAll": fail_all}))
        stub = bin_dir / "gh"
        stub.write_text(f"#!{sys.executable}\n" + _STUB_BODY)
        stub.chmod(0o755)
    monkeypatch.setenv("PATH", str(bin_dir))
    return log


def _calls(log):
    """The stub's argv log: one list per `gh` invocation, in order."""
    if not log.exists():
        return []
    return [json.loads(ln) for ln in log.read_text().splitlines() if ln.strip()]


def _main(argv):
    """`hfr.main`, with an argparse `SystemExit` reported as its exit code."""
    try:
        return hfr.main(list(argv))
    except SystemExit as exc:
        if exc.code is None:
            return 0
        return exc.code if isinstance(exc.code, int) else 1


def _lines(err, prefix):
    return [ln for ln in err.splitlines() if ln.startswith(prefix)]


# ---------- M1 + M2, leg (a): the fetch, the paths, the bundle ----------

def test_evidence_run_fetches_exactly_the_six_contents_paths_and_bundles(
        tmp_path, monkeypatch, capsys):
    """M1/M2, leg (a): `--evidence popmechanic/smoke --run 7 --cache <tmp>`
    with a stub `gh` answering the six paths exits 0, makes exactly six
    `gh api` calls of the contract's form, and lands a bundle whose `terminus`
    comes from the fetched gate receipt."""
    log = _install_gh(tmp_path, monkeypatch, _answers())
    cache = tmp_path / "cache"

    rc = _main(["--evidence", TARGET, "--run", RUN, "--cache", str(cache),
                "--engine-version", "0.3.0"])
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    calls = _calls(log)
    assert len(calls) == 6, f"expected six gh api calls, got {calls}"
    assert sorted(c[-1] for c in calls) == sorted(_expected_paths()), calls
    # M2 spells the command exactly: `gh api <path>`, nothing else.
    assert [c for c in calls if c != ["api", c[-1]]] == [], calls

    bundle = cache / "runs" / "run-7" / "bundle.json"
    assert bundle.exists(), f"no bundle at {bundle}; stderr:\n{cap.err}"
    b = json.loads(bundle.read_text())
    assert b["runId"] == "run-7"
    assert b["terminus"] == "NEEDS_ACK"
    assert b["gateReport"]["gateCheck"]["verdict"] == "NEEDS_ACK"
    assert b["report"]["baseSha"] == "3fa4936"
    assert b["audit"]["totals"]["outputTokens"] == 6463
    assert (cache / "runs" / "run-7" / "slice.md").exists()
    assert _lines(cap.err, "FAILED-LOOKUP:") == []


def test_run_spelled_run_dash_n_normalises_to_the_same_six_paths(
        tmp_path, monkeypatch, capsys):
    """M1, leg (a): `--run run-7` is the same run as `--run 7` — the same six
    paths, the same branch, the same bundle."""
    log = _install_gh(tmp_path, monkeypatch, _answers())
    cache = tmp_path / "cache"

    rc = _main(["--evidence", TARGET, "--run", "run-7", "--cache", str(cache),
                "--engine-version", "0.3.0"])
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert sorted(c[-1] for c in _calls(log)) == sorted(_expected_paths())
    assert (cache / "runs" / "run-7" / "bundle.json").exists()


def test_two_run_flags_fetch_two_runs(tmp_path, monkeypatch, capsys):
    """M1, leg (a): "one or more `--run N`" — each run gets its own six paths
    on its own evidence branch, and each bundles."""
    answers = dict(_answers(), **_answers("8"))
    log = _install_gh(tmp_path, monkeypatch, answers)
    cache = tmp_path / "cache"

    rc = _main(["--evidence", TARGET, "--run", "7", "--run", "8",
                "--cache", str(cache), "--engine-version", "0.3.0"])
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert sorted(c[-1] for c in _calls(log)) == sorted(
        _expected_paths("7") + _expected_paths("8"))
    assert (cache / "runs" / "run-7" / "bundle.json").exists()
    assert (cache / "runs" / "run-8" / "bundle.json").exists()


def test_evidence_without_run_is_exit_two_and_a_usage_line(
        tmp_path, monkeypatch, capsys):
    """M1, leg (a): `--evidence x/y` with no `--run` exits 2 with a usage line
    naming `--run` — a refusal by the parser that knows `--evidence`, not the
    parser that has never heard of it."""
    _install_gh(tmp_path, monkeypatch, _answers())

    rc = _main(["--evidence", "x/y", "--cache", str(tmp_path / "cache")])
    err = capsys.readouterr().err

    assert rc == 2, f"expected exit 2, got {rc}\nstderr:\n{err}"
    assert "usage:" in err.lower(), err
    assert "--run" in err, err
    assert "unrecognized argument" not in err, (
        "`--evidence` must be a flag the CLI accepts, not an unknown one: " + err)


def test_remote_and_remote_root_are_no_longer_accepted(
        tmp_path, monkeypatch, capsys):
    """M1/M4, legs (a)(d): `--remote h` and `--remote-root /x` are
    unrecognised arguments now, exit 2."""
    _install_gh(tmp_path, monkeypatch, _answers())

    rc = _main(["--remote", "h", "--cache", str(tmp_path / "cache")])
    err = capsys.readouterr().err
    assert rc == 2, f"expected exit 2, got {rc}\nstderr:\n{err}"
    assert "unrecognized argument" in err and "--remote" in err, err

    rc = _main(["--remote-root", "/x", "--cache", str(tmp_path / "cache")])
    err = capsys.readouterr().err
    assert rc == 2, f"expected exit 2, got {rc}\nstderr:\n{err}"
    assert "unrecognized argument" in err and "--remote-root" in err, err


def test_help_names_evidence_and_never_remote():
    """M1/M4, legs (a)(d): the second `Run:` leg — `--help` names `--evidence`
    and does not name `--remote` (nor `--remote-root`, which contains it)."""
    proc = subprocess.run([sys.executable, str(HARVEST), "--help"],
                          capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "--evidence" in proc.stdout, proc.stdout
    assert "--remote" not in proc.stdout, proc.stdout


# ---------- M2, leg (b): absence is a skip; a missing event log is not ----------

def test_absent_engine_log_and_receipt_are_skips_and_the_run_still_bundles(
        tmp_path, monkeypatch, capsys):
    """M2, leg (b): a `gh` that 404s `engine.log` and `receipt.json` still
    bundles the run and exits 0, with a skip diagnostic naming each absent
    file on stderr and no failure counted."""
    log = _install_gh(tmp_path, monkeypatch,
                      _answers(missing=("engine.log", "receipt.json")))
    cache = tmp_path / "cache"

    rc = _main(["--evidence", TARGET, "--run", RUN, "--cache", str(cache),
                "--engine-version", "0.3.0"])
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert len(_calls(log)) == 6, "all six paths are still asked for"
    assert (cache / "runs" / "run-7" / "bundle.json").exists(), cap.err
    assert "engine.log" in cap.err, f"absent engine.log went unmarked: {cap.err}"
    assert "receipt.json" in cap.err, f"absent receipt.json went unmarked: {cap.err}"
    assert _lines(cap.err, "FAILED-LOOKUP:") == [], cap.err


def test_absent_events_jsonl_is_a_failed_lookup_naming_the_run_and_branch(
        tmp_path, monkeypatch, capsys):
    """M2, leg (b): `events.jsonl` is the one absence that is a failure — a
    `FAILED-LOOKUP:` line naming the run and `ultra/evidence-run-7`, exit 2,
    and nothing written to the cache."""
    _install_gh(tmp_path, monkeypatch, _answers(missing=("events.jsonl",)))
    cache = tmp_path / "cache"

    rc = _main(["--evidence", TARGET, "--run", RUN, "--cache", str(cache),
                "--engine-version", "0.3.0"])
    cap = capsys.readouterr()

    failed = _lines(cap.err, "FAILED-LOOKUP:")
    assert len(failed) == 1, f"expected one FAILED-LOOKUP line, got: {cap.err}"
    assert BRANCH in failed[0], failed[0]
    assert RUN in failed[0], failed[0]
    assert rc == 2, f"expected exit 2, got {rc}\nstderr:\n{cap.err}"
    assert not (cache / "runs").exists()


# ---------- M3, leg (c): no gh, or a gh that fails on everything ----------

def test_a_missing_gh_is_a_failed_lookup_naming_the_target_and_run(
        tmp_path, monkeypatch, capsys):
    """M3, leg (c): with no `gh` on `PATH` the run is a `FailedLookup` naming
    `popmechanic/smoke` and `7`, and the process exits 2 because nothing else
    built."""
    _install_gh(tmp_path, monkeypatch, absent=True)
    cache = tmp_path / "cache"

    rc = _main(["--evidence", TARGET, "--run", RUN, "--cache", str(cache),
                "--engine-version", "0.3.0"])
    cap = capsys.readouterr()

    failed = _lines(cap.err, "FAILED-LOOKUP:")
    assert len(failed) == 1, f"expected one FAILED-LOOKUP line, got: {cap.err}"
    assert TARGET in failed[0], failed[0]
    assert RUN in failed[0], failed[0]
    assert rc == 2, f"expected exit 2, got {rc}\nstderr:\n{cap.err}"
    assert not (cache / "runs").exists()


def test_a_gh_that_fails_on_every_path_is_a_failed_lookup(
        tmp_path, monkeypatch, capsys):
    """M3, leg (c): a `gh` that exits non-zero on every file is the same
    failure — named, counted, exit 2."""
    _install_gh(tmp_path, monkeypatch, _answers(), fail_all=True)
    cache = tmp_path / "cache"

    rc = _main(["--evidence", TARGET, "--run", RUN, "--cache", str(cache),
                "--engine-version", "0.3.0"])
    cap = capsys.readouterr()

    failed = _lines(cap.err, "FAILED-LOOKUP:")
    assert len(failed) == 1, f"expected one FAILED-LOOKUP line, got: {cap.err}"
    assert TARGET in failed[0], failed[0]
    assert RUN in failed[0], failed[0]
    assert rc == 2, f"expected exit 2, got {rc}\nstderr:\n{cap.err}"
    assert not (cache / "runs").exists()


def test_a_healthy_positional_beside_a_failing_evidence_still_exits_zero(
        tmp_path, monkeypatch, capsys):
    """M3, leg (c): the exit rule `main` keeps — `2 if failed and not built
    and not skipped else 0`. One input failed, one bundle landed, so the
    harvest exits 0 and still names the failure."""
    _install_gh(tmp_path, monkeypatch, _answers(), fail_all=True)
    src, cache = tmp_path / "src", tmp_path / "cache"
    _make_run_dir(src, "run-30")

    rc = _main([str(src), "--evidence", TARGET, "--run", RUN,
                "--cache", str(cache), "--engine-version", "0.3.0"])
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert len(_lines(cap.err, "FAILED-LOOKUP:")) == 1, cap.err
    assert (cache / "runs" / "run-30" / "bundle.json").exists()
    assert not (cache / "runs" / "run-7").exists()
    assert "1 bundle" in cap.out


# ---------- the Produces contract ----------

def test_fetch_evidence_writes_the_run_directory_and_normalises_the_run(
        tmp_path, monkeypatch):
    """Produces: `fetch_evidence(target: str, run: str, dest: Path) -> Path` —
    it asks for the six contract paths and returns the directory the evidence
    landed in, which is what `discover_run_dirs` is handed (M2). `run-7` and
    `7` name the same run."""
    log = _install_gh(tmp_path, monkeypatch, _answers())

    out = hfr.fetch_evidence(TARGET, RUN, tmp_path / "evidence")

    assert isinstance(out, Path), f"fetch_evidence must return a Path, got {out!r}"
    assert out == tmp_path / "evidence" or (tmp_path / "evidence") in out.parents
    assert out.is_dir()
    assert (out / "events.jsonl").is_file()
    assert (out / "events.jsonl").read_text() == _events_text("run-7")
    assert (out / "gate-receipt.json").is_file()
    assert sorted(c[-1] for c in _calls(log)) == sorted(_expected_paths())
    assert hfr.discover_run_dirs(out, tmp_path / "work") == [out]

    log.unlink()
    again = hfr.fetch_evidence(TARGET, "run-7", tmp_path / "evidence2")
    assert (again / "events.jsonl").is_file()
    assert sorted(c[-1] for c in _calls(log)) == sorted(_expected_paths())


# ---------- M4, leg (d): the ssh fetcher and its traces are gone ----------

def test_the_ssh_fetcher_and_its_test_no_longer_exist():
    """M4, leg (d): the first `Run:` leg — `fleet_fetch.py` and
    `tests/test_fleet_fetch.py` are deleted and the harvester does not import
    the module."""
    assert not (SCRIPTS / "fleet_fetch.py").exists()
    assert not (REPO / "tests/test_fleet_fetch.py").exists()
    assert "fleet_fetch" not in HARVEST.read_text()


def test_the_remote_harvest_test_and_the_swallow_quarantine_entry_are_gone():
    """M4, leg (d): `test_remote_harvest_of_an_unreachable_host_fails_loud` is
    deleted, and `NOT_YET_SWEPT` no longer names `fleet_fetch.py`."""
    assert "test_remote_harvest_of_an_unreachable_host_fails_loud" not in (
        REPO / "tests/test_harvest_fleet_runs.py").read_text()
    assert "fleet_fetch" not in (
        REPO / "tests/test_ultralearn_swallows.py").read_text()


def test_the_docs_flag_allowlist_names_evidence_and_not_remote():
    """M4, leg (d): `tests/test_ultralearn_docs.py`'s allowlist names
    `--evidence` and neither `--remote` nor `--remote-root`."""
    text = (REPO / "tests/test_ultralearn_docs.py").read_text()
    assert "--evidence" in text
    assert "--remote" not in text


# ---------- M5, leg (e): the bundle the ledger reads is unchanged ----------

def test_a_local_run_dir_bundles_exactly_as_the_base_harvester_did(
        tmp_path, monkeypatch, capsys):
    """M5, leg (e): harvesting `_make_run_dir`'s directory as a positional
    yields a `bundle.json` whose key set equals the one the BASE harvester
    writes for the same directory, with equal `runId`, `origin`, `terminus`
    and `engineVersion` (basis and epoch). `merge_ledger.bundle_lookups` reads
    `origin` and `engineVersion.epoch`; the bundle is the interface, so this
    pin must stay green at BASE and after."""
    _install_gh(tmp_path, monkeypatch, absent=True)
    src, cache = tmp_path / "src", tmp_path / "cache"
    _make_run_dir(src, "run-30")

    rc = _main([str(src), "--cache", str(cache), "--engine-version", "0.3.0"])
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    out = cache / "runs" / "run-30"
    b = json.loads((out / "bundle.json").read_text())
    assert set(b) == set(BASE_BUNDLE_KEYS), (
        "bundle keys drifted from BASE: "
        f"added {sorted(set(b) - BASE_BUNDLE_KEYS)}, "
        f"dropped {sorted(BASE_BUNDLE_KEYS - set(b))}")
    assert b["runId"] == "run-30"
    assert b["origin"] == "home"
    assert b["terminus"] == "NEEDS_ACK"
    assert b["engineVersion"] == {"epoch": "0.3.0",
                                  "asOf": "2026-08-30T22:46:40Z",
                                  "basis": "explicit"}
    assert b["sessionKind"] == "engine"
    assert b["truncated"] is True
    assert b["confineDenials"] == [{"tool": "Bash", "reason": "outside clone"}]
    assert (out / "slice.md").exists()
