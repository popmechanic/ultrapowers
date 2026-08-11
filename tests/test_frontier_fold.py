"""The frontier fold engine: fold-on-completion, event log + deterministic
replay, resolution application-validity, live-K1 legs, dispatch predicate
(spec 2026-08-11 components 3-4)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
sys.path.insert(0, str(ROOT / "tests"))
import repo_weave as rw
import frontier_fold as ff
from test_frontier_weave import make_base


def _base():
    return make_base({"cli.py": "def a(x):\n    return x\n\ndef b(y):\n    return y\n"})


def _task(base, tid, text):
    return rw.task_state_from_contents(base, tid, {"cli.py": text})


def test_fold_returns_per_fold_stream_and_logs_events():
    base = _base()
    eng = ff.FrontierEngine(base)
    c1 = eng.fold(_task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n"))
    assert c1 == []
    assert [e["type"] for e in eng.events] == ["fold"]
    assert eng.events[0]["task"] == "t1"


def test_replay_of_recorded_events_reproduces_manifest():
    base = _base()
    t1 = _task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n")
    t2 = _task(base, "t2", "def a(x):\n    return x\n\ndef b(y):\n    return y * 2\n")
    eng = ff.FrontierEngine(base)
    eng.fold(t1); eng.fold(t2)
    replayed = ff.replay(base, {"t1": t1, "t2": t2}, eng.events)
    assert replayed == eng.manifest()


def test_application_validity_rejects_stale_resolution():
    base = _base()
    t1 = _task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n")
    t2 = _task(base, "t2", "def a(x):\n    return x\n\ndef b(y):\n    return y * 2\n")
    eng = ff.FrontierEngine(base)
    eng.fold(t1)
    epoch = eng.epoch()                       # narration taken here
    eng.fold(t2)                              # intervening fold touches cli.py
    ok = eng.apply_resolution("cli.py", epoch, ["def a(x):", "    return 0", ""])
    assert ok is False                        # stale: re-narrate or park
    assert all(e["type"] == "fold" for e in eng.events)  # nothing applied


def test_valid_resolution_applies_and_replays():
    base = _base()
    t1 = _task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n")
    eng = ff.FrontierEngine(base)
    eng.fold(t1)
    epoch = eng.epoch()
    lines = ["def a(x):", "    return x + 1", "", "def b(y):", "    return y", ""]
    assert eng.apply_resolution("cli.py", epoch, lines) is True
    assert eng.events[-1]["type"] == "resolve"
    replayed = ff.replay(base, {"t1": t1}, eng.events)
    assert replayed == eng.manifest()
    assert eng.manifest()["cli.py"] == "\n".join(lines[:-1]) + "\n" or \
           eng.manifest()["cli.py"] == "\n".join(lines)


def test_raw_shuffle_outcomes_is_a_singleton_on_clean_tasks():
    base = _base()
    t1 = _task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n")
    t2 = _task(base, "t2", "def a(x):\n    return x\n\ndef b(y):\n    return y * 2\n")
    assert len(ff.raw_shuffle_outcomes(base, [t1, t2], sample_seed=7)) == 1


def test_dispatchable_requires_annotated_narration_and_size_cap():
    ok, _ = ff.dispatchable(
        rw.Conflict("p.py", "lines", "t1", "<<<<<<< frontier\nmarked\n>>>>>>>"),
        {"p.py": "\n".join(["x = %d" % i for i in range(10)])})
    assert ok is True
    no_block, reason = ff.dispatchable(
        rw.Conflict("img.bin", "binary", "t1", "path img.bin written as text and as binary"),
        {"img.bin": b"\x00"})
    assert no_block is False and "narration" in reason
    big, reason = ff.dispatchable(
        rw.Conflict("p.py", "lines", "t1", "<<<<<<< frontier\nmarked\n>>>>>>>"),
        {"p.py": "\n".join(["x = %d" % i for i in range(401)])})
    assert big is False and "400" in reason


# --- contract legs the Produces list states but the plan sketch leaves untested


def test_events_are_json_able():
    """`.events` is the durable record: it must survive a JSON round trip."""
    base = _base()
    t1 = _task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n")
    eng = ff.FrontierEngine(base)
    eng.fold(t1)
    eng.apply_resolution("cli.py", eng.epoch(),
                         ["def a(x):", "    return 0", "", "def b(y):", "    return y"])
    assert json.loads(json.dumps(eng.events)) == eng.events


def test_re_narration_after_a_stale_rejection_applies():
    """False is 're-narrate or park', not a dead end: a fresh epoch applies."""
    base = _base()
    t1 = _task(base, "t1", "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n")
    t2 = _task(base, "t2", "def a(x):\n    return x\n\ndef b(y):\n    return y * 2\n")
    eng = ff.FrontierEngine(base)
    eng.fold(t1)
    stale = eng.epoch()
    eng.fold(t2)
    lines = ["def a(x):", "    return 0", "", "def b(y):", "    return y * 2"]
    assert eng.apply_resolution("cli.py", stale, lines) is False
    assert eng.apply_resolution("cli.py", eng.epoch(), lines) is True
    assert eng.manifest()["cli.py"] == "\n".join(lines) + "\n"


def test_resolution_on_an_untouched_path_applies():
    """A path no fold has touched is never stale (epoch 0 included)."""
    base = make_base({"cli.py": "x = 1\n", "other.py": "y = 1\n"})
    eng = ff.FrontierEngine(base)
    eng.fold(rw.task_state_from_contents(base, "t1", {"cli.py": "x = 2\n"}))
    assert eng.apply_resolution("other.py", eng.epoch(), ["y = 2"]) is True
    assert eng.manifest()["other.py"] == "y = 2\n"


def test_dispatchable_parks_a_non_text_manifest_body_by_name():
    """Marker-bearing narration is not enough: bytes cannot be whole-filed."""
    ok, reason = ff.dispatchable(
        rw.Conflict("img.bin", "lines", "t1", "<<<<<<< frontier\nmarked\n>>>>>>>"),
        {"img.bin": b"\x00\x01"})
    assert ok is False and "img.bin" in reason
