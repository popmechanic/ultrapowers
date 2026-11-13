"""The hub's VM remover (fleet/reaper.py): what it answers, and on which record.

The remover answers 202 only when the caller is a fleet VM whose name carries
the run it names and the record says that run ended done. The record is the
evidence repository's status page at the run's tag by default; the kata run
issue is the rollback. No socket is opened: the readers are handed in.
"""
import base64
import importlib.util
import json
import pathlib

import pytest

REAPER = pathlib.Path(__file__).resolve().parent.parent / "fleet" / "reaper.py"
spec = importlib.util.spec_from_file_location("fleet_reaper", REAPER)
reaper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reaper)

VM = "fleet-r7-2611130000-abcd"
CALLER = VM + ".exe.xyz"
BODY = {"run": 7, "target": "o/r"}
RAW = json.dumps(BODY).encode("utf-8")
EVIDENCE = "ops/evidence"


def never(*args):
    raise AssertionError(f"no record may be read here, got {args}")


# ── decide(): the caller, the run its name carries, the target, the record ──

def test_decide_answers_202_and_names_only_the_caller():
    assert reaper.decide(CALLER, BODY, True) == (202, VM)
    assert reaper.decide(VM, BODY, True) == (202, VM)


@pytest.mark.parametrize("caller", [None, "", "kata-hub.exe.xyz", "fleet-r8-2611130000-abcd.exe.xyz", "xfleet-r7-1-a"])
def test_decide_refuses_a_caller_that_is_not_the_runs_own_vm(caller):
    assert reaper.decide(caller, BODY, True) == (403, None)


@pytest.mark.parametrize("body", [None, [], {}, {"run": "7", "target": "o/r"}, {"run": True, "target": "o/r"}, {"run": 8, "target": "o/r"}])
def test_decide_refuses_a_body_whose_run_is_not_the_callers(body):
    assert reaper.decide(CALLER, body, True) == (403, None)


@pytest.mark.parametrize("target", [None, 7, "o", "o/r/x", "o r/x", "o/r?x"])
def test_decide_refuses_a_target_that_is_not_owner_repo(target):
    assert reaper.decide(CALLER, {"run": 7, "target": target}, True) == (400, None)


@pytest.mark.parametrize("done", [False, None, "done", 1, {"state": "done"}])
def test_decide_answers_409_unless_the_record_said_done(done):
    assert reaper.decide(CALLER, BODY, done) == (409, None)


# ── The two records ────────────────────────────────────────────────────────

def test_status_done_is_a_status_page_whose_state_is_done():
    assert reaper.status_done({"state": "done", "merged": None}) is True
    for status in [None, {}, {"state": "parked"}, {"state": "failed"}, {"state": "running"}, {"state": "publishing"}, "done"]:
        assert reaper.status_done(status) is False


def test_issue_done_is_a_run_issue_closed_as_done():
    assert reaper.issue_done({"status": "closed", "closed_reason": "done"}) is True
    for issue in [None, {"status": "open"}, {"status": "closed", "closed_reason": "wontfix"}]:
        assert reaper.issue_done(issue) is False


def test_record_of_is_evidence_unless_it_says_kata():
    assert reaper.record_of("kata") == "kata"
    for value in [None, "", "evidence", "KATA", "hub"]:
        assert reaper.record_of(value) == "evidence"


# ── The evidence read ──────────────────────────────────────────────────────

def test_status_url_reads_the_page_at_the_runs_tag_and_no_other_ref():
    assert reaper.status_url(EVIDENCE, "o/r", 7) == (
        "https://github.int.exe.xyz/api/v3/repos/ops/evidence/contents/runs/o-r/7/status.json"
        "?ref=refs%2Ftags%2Fo-r%2Frun-7"
    )


def test_status_of_reads_the_raw_file_and_the_base64_envelope():
    page = {"state": "done", "run": "7"}
    raw = json.dumps(page).encode("utf-8")
    envelope = json.dumps({"encoding": "base64", "content": base64.encodebytes(raw).decode("ascii")}).encode("utf-8")
    assert reaper.status_of(raw) == page
    assert reaper.status_of(envelope) == page
    for junk in [b"", b"not json", b"[]", b'"done"', json.dumps({"encoding": "base64", "content": "!!"}).encode("utf-8")]:
        assert reaper.status_of(junk) is None


def test_read_status_reads_nothing_without_an_evidence_repository(monkeypatch):
    monkeypatch.setattr(reaper.urllib.request, "urlopen", never)
    for evidence in [None, "", "not a repo", "o/r/x"]:
        assert reaper.read_status(evidence, "o/r", 7) is None


class _Answer:
    def __init__(self, raw):
        self.raw = raw

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.raw


def test_read_status_asks_the_edge_once_and_a_missing_tag_is_none(monkeypatch):
    asked = []

    def found(req, timeout=None):
        asked.append((req.full_url, timeout))
        return _Answer(b'{"state": "done"}')

    monkeypatch.setattr(reaper.urllib.request, "urlopen", found)
    assert reaper.read_status(EVIDENCE, "o/r", 7) == {"state": "done"}
    assert asked == [(reaper.status_url(EVIDENCE, "o/r", 7), reaper.READ_SECONDS)]
    assert reaper.READ_SECONDS < 5, "the calling boot waits five seconds"

    def missing(req, timeout=None):
        raise reaper.urllib.error.HTTPError(req.full_url, 404, "Not Found", None, None)

    monkeypatch.setattr(reaper.urllib.request, "urlopen", missing)
    assert reaper.read_status(EVIDENCE, "o/r", 7) is None


# ── One request, decided ───────────────────────────────────────────────────

def reader(status):
    seen = []

    def read(evidence, target, run):
        seen.append((evidence, target, run))
        return status

    return read, seen


def test_evidence_record_done_at_the_tag_answers_202_and_kata_is_not_asked():
    read, seen = reader({"state": "done"})
    assert reaper.answer_for(CALLER, RAW, "evidence", EVIDENCE, read=read, find=never) == (202, VM, 7)
    assert seen == [(EVIDENCE, "o/r", 7)]


@pytest.mark.parametrize("status", [None, {"state": "parked"}, {"state": "failed"}, {"state": "running"}, {}])
def test_evidence_record_that_does_not_say_done_answers_409(status):
    read, _ = reader(status)
    assert reaper.answer_for(CALLER, RAW, "evidence", EVIDENCE, read=read, find=never) == (409, None, 7)


def test_no_record_is_read_for_a_wrong_caller_body_or_target():
    assert reaper.answer_for(None, RAW, "evidence", EVIDENCE, read=never, find=never) == (403, None, None)
    assert reaper.answer_for("kata-hub.exe.xyz", RAW, "evidence", EVIDENCE, read=never, find=never) == (403, None, 7)
    assert reaper.answer_for(CALLER, b"not json", "evidence", EVIDENCE, read=never, find=never) == (400, None, None)
    other = json.dumps({"run": 8, "target": "o/r"}).encode("utf-8")
    assert reaper.answer_for(CALLER, other, "evidence", EVIDENCE, read=never, find=never) == (403, None, 8)
    bad = json.dumps({"run": 7, "target": "nowhere"}).encode("utf-8")
    assert reaper.answer_for(CALLER, bad, "kata", EVIDENCE, read=never, find=never) == (400, None, 7)


def test_the_kata_rollback_decides_on_the_run_issue_and_reads_no_evidence():
    closed = lambda target, run: {"status": "closed", "closed_reason": "done"}
    assert reaper.answer_for(CALLER, RAW, "kata", EVIDENCE, read=never, find=closed) == (202, VM, 7)
    still_open = lambda target, run: {"status": "open"}
    assert reaper.answer_for(CALLER, RAW, "kata", EVIDENCE, read=never, find=still_open) == (409, None, 7)
    assert reaper.answer_for(CALLER, RAW, "kata", EVIDENCE, read=never, find=lambda t, r: None) == (409, None, 7)


def test_rm_succeeded_counts_a_2xx_and_a_vm_already_gone():
    assert reaper.rm_succeeded(200, "") is True
    assert reaper.rm_succeeded(404, "VM Not Found") is True
    assert reaper.rm_succeeded(401, "invalid token") is False
