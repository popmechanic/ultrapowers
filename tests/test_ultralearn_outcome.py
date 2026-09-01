"""The outcome vocabulary: three words for the three ways a lookup ends.

Each helper writes exactly one machine-greppable line to stderr and nothing to
stdout, and none of them ends the process — callers pick their own exit codes.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import _outcome  # noqa: E402


def test_report_failed_lookup_emits_one_prefixed_line(capsys):
    _outcome.report_failed_lookup("ssh fleet-host: no route to host")
    out, err = capsys.readouterr()
    assert err == "FAILED-LOOKUP: ssh fleet-host: no route to host\n"
    assert out == ""


def test_report_looked_empty_emits_one_prefixed_line(capsys):
    _outcome.report_looked_empty("/srv/ultrapowers/runs")
    out, err = capsys.readouterr()
    assert err == "LOOKED-EMPTY: /srv/ultrapowers/runs\n"
    assert out == ""


def test_swallow_without_exception_emits_the_reason_alone(capsys):
    _outcome.swallow("per-item listing stays advisory")
    out, err = capsys.readouterr()
    assert err == "SWALLOW: per-item listing stays advisory\n"
    assert out == ""


def test_swallow_with_exception_appends_its_repr(capsys):
    _outcome.swallow("bundle 7 unreadable", ValueError("bad json"))
    out, err = capsys.readouterr()
    assert err == "SWALLOW: bundle 7 unreadable: ValueError('bad json')\n"
    assert out == ""


def test_failed_lookup_is_a_runtime_error():
    assert issubclass(_outcome.FailedLookup, RuntimeError)
    with pytest.raises(RuntimeError):
        raise _outcome.FailedLookup("missing remote root")


def test_nothing_exits_the_process(capsys):
    """Three calls, three lines, no SystemExit — exit codes belong to callers."""
    _outcome.report_failed_lookup("a")
    _outcome.report_looked_empty("b")
    _outcome.swallow("c")
    out, err = capsys.readouterr()
    assert err == "FAILED-LOOKUP: a\nLOOKED-EMPTY: b\nSWALLOW: c\n"
    assert out == ""
