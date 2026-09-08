"""Task 3 (#761, recording #698): the cache is keyed by run AND opening date,
and the incremental skip compares the record's sha.

The cache key was the bare fleet `runId`, so a restarted numbering landed a new
`run-30` on an older `run-30`'s bundle, and the skip was "a bundle exists at
this key" — which never noticed that the run's committed record had moved on.
This exam encodes the two halves and the three bundle keys that carry the
record's identity. Each test names the Machine clause and the Proof leg it
comes from:

  M1 / leg (a)  `build_fleet_bundle` writes to `<cache>/runs/run-<N>-<YYYY-MM-DD>/`,
                the date being `events.openedAt` in UTC; two run dirs with one
                `runId` on two UTC days leave two directories; a log with no
                timestamp at all writes to `<cache>/runs/run-<N>/`.
  M2 / legs (b)(h)(i)
                `bundle.json` carries `evidenceSha`, `evidenceRef` and `target`,
                read from `<run dir>/evidence-ref.json`, each `null` when that
                file is absent.
  M3 / leg (c)  `fetch_evidence` makes one `gh api repos/<target>/commits/<ref>`
                read at the resolved ref, after the six file reads and before
                the `transcripts` listing, and writes `<dest>/evidence-ref.json`
                = `{"target": …, "ref": …, "sha": …}`; a non-zero answer is a
                `null` sha, one `harvest_fleet_runs:` line and a run that still
                bundles.
  M4 / leg (d)  `main` skips only when the cached bundle's `evidenceSha` equals
                the fetched sha (`null` equal to `null`); a mismatch rebuilds
                and counts as written; `--force` rebuilds regardless.
  M6 / leg (g)  `SKILL.md`'s Verb 1 section names the dated cache directory and
                the `evidenceSha` comparison, and no longer says the key is the
                bare `runId`.

Hermetic and self-contained: its own fixture helpers and its own `gh` stub —
a Python executable on a `PATH` set to its directory alone — and every harvest
passes `--engine-version 0.3.0`, so nothing shells out to `git` for a release
timeline and nothing reaches the network.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import harvest_fleet_runs as hfr  # noqa: E402

SKILL = (Path(__file__).resolve().parents[1] / "skills/ultralearn/SKILL.md")

#: The BASE exam's fixture clock: 2026-08-30T22:46:40Z.
T0 = 1788130000000
#: Seven days and change later: 2026-09-06T22:50:00Z — a different UTC day.
T1 = 1788735000000
DATE0 = "2026-08-30"
DATE1 = "2026-09-06"

TARGET = "popmechanic/smoke"
RUN = "7"
BRANCH_REF = "ultra/evidence-run-7"
TAG_REF = "ultra/evidence/run-7"
#: The one commits read M3 adds, spelled in full: the ref is a path segment
#: here, not a `?ref=` query — one path for a branch, a tag or a sha alike.
COMMITS_PATH = f"repos/{TARGET}/commits/{TAG_REF}"
#: `fleet/CONTRACT.md`'s six files, in the order the harvester reads them.
EVIDENCE_FILES = ("status.json", "receipt.json", "gate-receipt.json",
                  "report.json", "events.jsonl", "engine.log")
TRANSCRIPTS = "transcripts"

#: The cache key a fetched run-7 whose log opens at T0 must land under [M1].
KEY7 = f"run-7-{DATE0}"

SHA_A = "a" * 40
SHA_B = "b" * 40


# ---------- fixtures ----------

def _ev(i, off, ts0, **f):
    """One event record. `ts0 is None` means the log carries no timestamp at
    all — the third case of M1."""
    rec = dict(f, id=f"01AAA{i:03d}")
    if ts0 is not None:
        rec["ts"] = ts0 + off
    return rec


def _events_text(run_id, ts0):
    events = [
        _ev(1, 0, ts0, kind="run:open", runId=run_id, base="",
            source="fleet/run-main.mjs"),
        _ev(2, 1000, ts0, kind="engine:phase", phase="Wave 1"),
        _ev(3, 1000, ts0, kind="worker:start", label="impl:1", role="implementer",
            sessionId="sess-1", cwd="/clones/task-1", model="opus"),
        _ev(4, 61000, ts0, kind="worker:end", label="impl:1", role="implementer",
            sessionId="sess-1", exitCode=0, timedOut=False, outcome="ok",
            status=None,
            meter={"input": 30, "output": 6463, "cacheRead": 452825,
                   "cacheCreation": 20113, "costUsd": 0.5913,
                   "models": ["claude-opus-5"]}),
        _ev(5, 62000, ts0, kind="driver:fail", verdict="needs-ack",
            detail="deferred:manual"),
    ]
    events[3]["class"] = "success"
    return "\n".join(json.dumps(e) for e in events) + "\n"


def _gate_text(run_id):
    return json.dumps({
        "mode": "gate", "stamp": run_id,
        "branch": "ultra/integration-" + run_id,
        "gateCheck": {"verdict": "NEEDS_ACK", "checks": [], "acks": [
            {"type": "deferred:manual", "detail": "RUNBOOK claims"}]},
        "verdict": "NEEDS_ACK"})


def _report_text(run_id):
    return json.dumps({
        "integrationBranch": "ultra/integration-" + run_id,
        "baseSha": "3fa4936",
        "tests": {"command": "python3 -m pytest -n auto", "passed": True,
                  "output": "z" * 9000},
        "judgmentCalls": [{"task": "1", "detail": "chose the additive union"}],
        "deferredVerification": []})


def _make_run_dir(root, name, *, run_id="run-30", ts0=T0, evidence_ref=None):
    """A structurally faithful miniature of an unpacked fleet run directory.
    `evidence_ref`, when given, is written to `<run dir>/evidence-ref.json` —
    exactly what `fetch_evidence` leaves behind [M2]."""
    d = root / name
    (d / "claude" / "projects" / "-clones-task-1").mkdir(parents=True)
    (d / "events.jsonl").write_text(_events_text(run_id, ts0))
    (d / "gate-receipt.json").write_text(_gate_text(run_id))
    (d / "report.json").write_text(_report_text(run_id))
    (d / "confine-denials.jsonl").write_text(
        json.dumps({"tool": "Bash", "reason": "outside clone"}) + "\n")
    if evidence_ref is not None:
        (d / "evidence-ref.json").write_text(json.dumps(evidence_ref))
    return d


# ---------- the `gh` stub ----------
#
# A Python executable named `gh`, answering from a JSON map keyed by the
# `repos/…` argument and appending each argv as a JSON line to a log. A key
# absent from the map is `gh: HTTP 404` and exit 1 — an ANSWER, not a failure.
# A string body is wrapped in the contents API's base64 file envelope (whose
# `sha` is a BLOB sha, deliberately not the commit sha this task reads); a list
# body is a directory listing and a dict body is a commit object, both printed
# unwrapped, the way `gh api` prints what the endpoint returned.

_GH_STUB = '''
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

if isinstance(body, (list, dict)):
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


def _file_path(name, ref):
    """One contents read, spelled in full."""
    return (f"repos/{TARGET}/contents/.ultrapowers/runs/{RUN}/{name}?ref={ref}")


def _file_answers(ref, run_id="run-7"):
    bodies = {
        "status.json": json.dumps({"run": RUN, "state": "closed"}),
        "receipt.json": json.dumps({"run": RUN, "verdict": "NEEDS_ACK"}),
        "gate-receipt.json": _gate_text(run_id),
        "report.json": _report_text(run_id),
        "events.jsonl": _events_text(run_id, T0),
        "engine.log": "engine: wave 1 dispatched\n",
    }
    return {_file_path(n, ref): bodies[n] for n in EVIDENCE_FILES}


def _install_gh(tmp_path, monkeypatch, answers, slot="gh0"):
    """Put the stub `gh` on an otherwise empty `PATH`; return its argv log."""
    bin_dir = tmp_path / slot
    bin_dir.mkdir()
    (bin_dir / "gh-stub.json").write_text(json.dumps(answers))
    stub = bin_dir / "gh"
    stub.write_text(f"#!{sys.executable}\n" + _GH_STUB)
    stub.chmod(0o755)
    monkeypatch.setenv("PATH", str(bin_dir))
    return bin_dir / "gh-argv.log"


def _calls(log):
    if not log.exists():
        return []
    return [json.loads(ln) for ln in log.read_text().splitlines() if ln.strip()]


def _paths(log):
    """The `repos/…` argument of each `gh api` call, in order."""
    return [next(a for a in c[1:] if a.startswith("repos/"))
            for c in _calls(log) if len(c) > 1 and c[0] == "api"]


def _main(argv):
    """`hfr.main`, with an argparse `SystemExit` reported as its exit code."""
    try:
        return hfr.main(list(argv))
    except SystemExit as exc:
        if exc.code is None:
            return 0
        return exc.code if isinstance(exc.code, int) else 1


def _harvest(cache, *extra):
    return ["--evidence", TARGET, "--run", RUN, "--cache", str(cache),
            "--engine-version", "0.3.0", *extra]


def _outcome_lines(err, prefix):
    return [ln for ln in err.splitlines() if ln.startswith(prefix)]


def _warn_lines(err):
    """The harvester's own advisory lines — `_warn`'s prefix."""
    return [ln for ln in err.splitlines() if ln.startswith("harvest_fleet_runs:")]


def _cached(cache, key):
    return json.loads((cache / "runs" / key / "bundle.json").read_text())


# ---------- M1, leg (a): the key is the run and its opening UTC day ----------

def test_a_bundle_lands_under_the_run_id_and_its_opening_utc_day(tmp_path):
    """M1, leg (a): `build_fleet_bundle` writes a run whose `runId` is `run-30`
    and whose `openedAt` is `1788130000000` to `<cache>/runs/run-30-2026-08-30/`
    — the run id and that timestamp's UTC date. The bundle inside still carries
    `runId: run-30`: the key changed, the field did not."""
    d = _make_run_dir(tmp_path / "src", "run-run-30", run_id="run-30", ts0=T0)
    cache = tmp_path / "cache"

    out = hfr.build_fleet_bundle(d, cache, engine_version="0.3.0")

    assert out == cache / "runs" / f"run-30-{DATE0}", out
    b = json.loads((out / "bundle.json").read_text())
    assert b["runId"] == "run-30"
    assert b["events"]["openedAt"] == T0
    assert (out / "slice.md").exists()


def test_one_run_id_on_two_utc_days_leaves_two_cache_directories(tmp_path, capsys):
    """M1, leg (a): two run directories, both `runId` `run-30`, opening at
    `1788130000000` (2026-08-30) and `1788735000000` (2026-09-06), harvested
    into ONE cache leave exactly `run-30-2026-08-30` and `run-30-2026-09-06`
    under `runs/`, each with its own `bundle.json` whose `runId` is `run-30`.
    A harvester keyed on the bare `runId` leaves one directory and silently
    overwrites the older run's bundle — the #761 report."""
    src = tmp_path / "src"
    _make_run_dir(src, "run-30-first", run_id="run-30", ts0=T0)
    _make_run_dir(src, "run-30-restarted", run_id="run-30", ts0=T1)
    cache = tmp_path / "cache"

    rc = _main([str(src), "--cache", str(cache), "--engine-version", "0.3.0"])
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert sorted(p.name for p in (cache / "runs").iterdir()) == [
        f"run-30-{DATE0}", f"run-30-{DATE1}"]
    assert "2 bundle(s)" in cap.out, cap.out
    for key in (f"run-30-{DATE0}", f"run-30-{DATE1}"):
        assert _cached(cache, key)["runId"] == "run-30", key
    assert _cached(cache, f"run-30-{DATE0}")["events"]["openedAt"] == T0
    assert _cached(cache, f"run-30-{DATE1}")["events"]["openedAt"] == T1


def test_a_log_with_no_timestamp_at_all_keys_on_the_bare_run_id(tmp_path):
    """M1, leg (a): a run whose log carries no `ts` on any event has no opening
    day to key on, and writes to `<cache>/runs/run-30/` — the bare run id, with
    no trailing dash and no `None` in the path."""
    d = _make_run_dir(tmp_path / "src", "run-run-30", run_id="run-30", ts0=None)
    cache = tmp_path / "cache"

    out = hfr.build_fleet_bundle(d, cache, engine_version="0.3.0")

    assert out == cache / "runs" / "run-30", out
    assert sorted(p.name for p in (cache / "runs").iterdir()) == ["run-30"]
    b = json.loads((out / "bundle.json").read_text())
    assert b["runId"] == "run-30"
    assert b["events"]["openedAt"] is None


# ---------- M2, legs (b)(h)(i): the record's identity rides in the bundle ----

def test_a_run_directory_with_an_evidence_ref_carries_its_sha_ref_and_target(tmp_path):
    """M2, legs (b)(h)(i): a run directory holding `evidence-ref.json` =
    `{"target": "popmechanic/smoke", "ref": "ultra/evidence/run-7", "sha":
    "a"*40}` bundles with `evidenceSha == "a"*40`, `evidenceRef ==
    "ultra/evidence/run-7"` and `target == "popmechanic/smoke"` — read back
    after the JSON round-trip the cache actually stores."""
    ref = {"target": TARGET, "ref": TAG_REF, "sha": SHA_A}
    d = _make_run_dir(tmp_path / "src", "run-run-7", run_id="run-7", ts0=T0,
                      evidence_ref=ref)

    out = hfr.build_fleet_bundle(d, tmp_path / "cache", engine_version="0.3.0")
    b = json.loads((out / "bundle.json").read_text())

    assert b["evidenceSha"] == SHA_A
    assert b["evidenceRef"] == TAG_REF
    assert b["target"] == TARGET


def test_a_local_run_directory_carries_null_for_all_three_record_keys(tmp_path):
    """M2, legs (b)(h)(i): a LOCAL run directory has no `evidence-ref.json`, so
    all three keys are present and `null` — present, because the bundle is the
    interface and a lens reads keys, not `KeyError`s."""
    d = _make_run_dir(tmp_path / "src", "run-run-30", run_id="run-30", ts0=T0)

    out = hfr.build_fleet_bundle(d, tmp_path / "cache", engine_version="0.3.0")
    b = json.loads((out / "bundle.json").read_text())

    for key in ("evidenceSha", "evidenceRef", "target"):
        assert key in b, f"{key} missing from the bundle: {sorted(b)}"
        assert b[key] is None, (key, b[key])


# ---------- M3, leg (c): one commits read, in one place ----------

def test_the_commits_read_sits_after_the_six_files_and_before_the_listing(
        tmp_path, monkeypatch, capsys):
    """M3, leg (c): with the six files answering at the tag, the commits path
    `repos/popmechanic/smoke/commits/ultra/evidence/run-7` answering
    `{"sha": "a"*40}` and the `transcripts` listing 404, the stub's argv log is
    exactly: `status.json` at the branch ref (the miss that resolves the ref),
    the six files at the tag ref, then the commits path, then the listing —
    nine calls, the commits read immediately after the sixth file read and
    immediately before the listing, at the ref the six files resolved to. The
    bundle's `evidenceSha` is that sha, and `<dest>/evidence-ref.json` records
    the target, the ref and the sha."""
    log = _install_gh(tmp_path, monkeypatch,
                      dict(_file_answers(TAG_REF), **{COMMITS_PATH: {"sha": SHA_A}}))
    cache = tmp_path / "cache"

    rc = _main(_harvest(cache))
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    paths = _paths(log)
    assert paths == ([_file_path("status.json", BRANCH_REF)]
                     + [_file_path(n, TAG_REF) for n in EVIDENCE_FILES]
                     + [COMMITS_PATH]
                     + [_file_path(TRANSCRIPTS, TAG_REF)]), paths
    assert paths[-3] == _file_path("engine.log", TAG_REF), paths
    assert paths[-2] == COMMITS_PATH, paths
    assert paths[-1] == _file_path(TRANSCRIPTS, TAG_REF), paths
    # M3 spells the command exactly: `gh api <path>`, nothing else.
    assert _calls(log)[-2] == ["api", COMMITS_PATH], _calls(log)[-2]

    assert _outcome_lines(cap.err, "FAILED-LOOKUP:") == [], cap.err
    assert _cached(cache, KEY7)["evidenceSha"] == SHA_A

    # The file itself, read through `fetch_evidence` because `main`'s
    # destination is a `TemporaryDirectory` that is gone by the time it returns.
    log.unlink()
    dest = hfr.fetch_evidence(TARGET, RUN, tmp_path / "evidence" / RUN)
    capsys.readouterr()
    assert json.loads((dest / "evidence-ref.json").read_text()) == {
        "target": TARGET, "ref": TAG_REF, "sha": SHA_A}


def test_a_commits_read_that_answers_non_zero_is_a_null_sha_and_one_line(
        tmp_path, monkeypatch, capsys):
    """M3, leg (c): with the commits path absent from the stub's map (`gh`
    exits 1), the harvest still exits 0 and still bundles — the record's sha is
    advisory, not load-bearing — the bundle's `evidenceSha` is `None`, and
    stderr carries exactly one `harvest_fleet_runs:` line, naming run 7 and the
    ref the record was read at. No `FAILED-LOOKUP:` line: a sha that could not
    be resolved is not a run that could not be read."""
    answers = dict(_file_answers(TAG_REF))
    # An EMPTY listing, so the only advisory line left is the sha's.
    answers[_file_path(TRANSCRIPTS, TAG_REF)] = []
    log = _install_gh(tmp_path, monkeypatch, answers)
    cache = tmp_path / "cache"

    rc = _main(_harvest(cache))
    cap = capsys.readouterr()

    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert COMMITS_PATH in _paths(log), _paths(log)
    assert _outcome_lines(cap.err, "FAILED-LOOKUP:") == [], cap.err
    assert "1 bundle(s)" in cap.out, cap.out

    b = _cached(cache, KEY7)
    assert b["evidenceSha"] is None, b["evidenceSha"]
    assert b["evidenceRef"] == TAG_REF
    assert b["target"] == TARGET

    warned = _warn_lines(cap.err)
    assert len(warned) == 1, f"expected one advisory line, got: {cap.err}"
    assert TAG_REF in warned[0], warned[0]
    assert re.search(r"\b7\b", warned[0].replace(TAG_REF, "")), warned[0]


# ---------- M4, leg (d): the skip compares the record's sha ----------

def test_a_cached_bundle_is_skipped_only_while_the_records_sha_matches(
        tmp_path, monkeypatch, capsys):
    """M4, leg (d): four harvests into one cache.

    1. the commits path answers `"a"*40` — one bundle written;
    2. the same map again — `0 bundle(s)` and `1 already cached`;
    3. the commits path now answers `"b"*40` — `1 bundle(s)` and `0 already
       cached`, and the cached `bundle.json`'s `evidenceSha` is now `"b"*40`.
       A harvester that skips on the key alone prints `0 bundle(s)` here and
       fails this leg;
    4. the same `"b"` map with `--force` — `1 bundle(s)` regardless."""
    cache = tmp_path / "cache"
    answers_a = dict(_file_answers(TAG_REF), **{COMMITS_PATH: {"sha": SHA_A}})
    answers_b = dict(_file_answers(TAG_REF), **{COMMITS_PATH: {"sha": SHA_B}})

    _install_gh(tmp_path, monkeypatch, answers_a, slot="gh-a1")
    rc = _main(_harvest(cache))
    cap = capsys.readouterr()
    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert "1 bundle(s)" in cap.out, cap.out
    assert _cached(cache, KEY7)["evidenceSha"] == SHA_A

    _install_gh(tmp_path, monkeypatch, answers_a, slot="gh-a2")
    rc = _main(_harvest(cache))
    cap = capsys.readouterr()
    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert "0 bundle(s)" in cap.out, cap.out
    assert "1 already cached" in cap.out, cap.out

    _install_gh(tmp_path, monkeypatch, answers_b, slot="gh-b1")
    rc = _main(_harvest(cache))
    cap = capsys.readouterr()
    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert "1 bundle(s)" in cap.out, (
        "a record whose sha moved is rebuilt, not skipped: " + cap.out)
    assert "0 already cached" in cap.out, cap.out
    assert _cached(cache, KEY7)["evidenceSha"] == SHA_B

    _install_gh(tmp_path, monkeypatch, answers_b, slot="gh-b2")
    rc = _main(_harvest(cache, "--force"))
    cap = capsys.readouterr()
    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert "1 bundle(s)" in cap.out, cap.out


def test_a_local_run_with_no_record_sha_stays_cached_on_the_second_harvest(
        tmp_path, capsys):
    """M4, leg (d): a LOCAL run directory carries no `evidence-ref.json`, so
    the fetched sha and the cached `evidenceSha` are both `null` — equal — and
    the second harvest into the same cache prints `1 already cached` and
    `0 bundle(s)`. An implementation that rebuilds every sha-less run (treating
    `null != null`) fails this leg, and with it every local harvest's
    incremental contract."""
    src, cache = tmp_path / "src", tmp_path / "cache"
    _make_run_dir(src, "run-run-30", run_id="run-30", ts0=T0)
    args = [str(src), "--cache", str(cache), "--engine-version", "0.3.0"]

    rc = _main(args)
    cap = capsys.readouterr()
    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert "1 bundle(s)" in cap.out, cap.out

    rc = _main(args)
    cap = capsys.readouterr()
    assert rc == 0, f"expected exit 0, got {rc}\nstderr:\n{cap.err}"
    assert "0 bundle(s)" in cap.out, cap.out
    assert "1 already cached" in cap.out, cap.out
    assert sorted(p.name for p in (cache / "runs").iterdir()) == [f"run-30-{DATE0}"]


# ---------- M6, leg (g): the skill says what the harvester does ----------

def _verb_1_section():
    """`sed -n '/^## Verb 1/,/^## Verb 2/p'`, in Python: the Verb 1 heading
    through the Verb 2 heading inclusive, which is the range the Proof's two
    `Run:` legs grep."""
    lines = SKILL.read_text().splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.startswith("## Verb 1"))
    end = next(i for i, ln in enumerate(lines[start + 1:], start=start + 1)
               if ln.startswith("## Verb 2"))
    return lines[start:end + 1]


def test_the_skill_names_the_dated_cache_key_and_the_evidence_sha_test():
    """M6, leg (g): the Verb 1 section, joined, names
    `~/.claude/ultralearn/runs/run-<N>-<date>/` and then `evidenceSha` — the
    key and the test the "already cached" decision now makes — and no longer
    says the key is `keyed by the fleet` runId."""
    section = _verb_1_section()
    joined = " ".join(section)

    assert re.search(re.escape("runs/run-<N>-<date>/") + r".*"
                     + re.escape("evidenceSha"), joined), joined
    assert [ln for ln in section if "keyed by the fleet" in ln] == [], (
        "the bare-runId key is gone from Verb 1: "
        + repr([ln for ln in section if "keyed by the fleet" in ln]))
