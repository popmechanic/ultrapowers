"""Exam for task 2 — "The ledger stamps only a true version and refuses an
unreleased one".

Each test names the Proof leg it encodes and the Machine clause that leg comes
from, so the file reads back against the contract:

* [a] M1 — `released` given, a stamp outside it is refused, counted, unwritten;
  a stamp inside it is written and kept verbatim.
* [b] M1 — a `None` epoch is never refused on version grounds.
* [c] M2 — `released` omitted or `None`: BASE behaviour, `0.4.0` still stamped.
* [d] M3 — `bundle_lookups`' `engine_lookup` distrusts the two date bases and
  trusts `explicit`, `plugin-cache-path` and a basis-less (August) bundle.
* [e] M4 — `_readers.released_versions()` is the timeline's version set, `None`
  on an empty timeline, and does not cache.
* [f] M5 — the re-scoped pin in `tests/test_merge_ledger.py` passes against the
  new lookup, and §Verb 1 step 3 of `SKILL.md` names `released_versions` and
  `released=` (the two `sed | grep` Run: lines, in-process).
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills" / "ultralearn" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import merge_ledger as m  # noqa: E402
import _readers  # noqa: E402

SKILL = ROOT / "skills" / "ultralearn" / "SKILL.md"
MERGE_LEDGER_TESTS = ROOT / "tests" / "test_merge_ledger.py"


def _finding(**kw):
    """A home finding, verbatim evidence — the redaction guard passes it."""
    base = {"runId": "r1", "lens": "frontier", "title": "t", "novelty": 2,
            "severity": 1, "evidence": "raw quote", "evidenceAbstracted": False,
            "implication": "x", "surface": "SKILL.md"}
    base.update(kw)
    return base


def _home(run_id):
    return "home"


def _rows(ledger):
    ledger = Path(ledger)
    if not ledger.exists():
        return []
    return [json.loads(line) for line in ledger.read_text().splitlines()
            if line.strip()]


# --- leg (a) [M1] ---------------------------------------------------------

def test_leg_a_unreleased_stamp_is_refused_and_counted(tmp_path):
    """[a][M1] released={"0.3.17"}, lookup says "0.3.18": nothing is written and
    the finding is counted under `refused`."""
    ledger = tmp_path / "ledger.jsonl"
    stats = m.merge_findings([_finding(title="a")], ledger, _home,
                             lambda rid: "0.3.18", released={"0.3.17"})
    assert stats == {"added": 0, "skipped": 1, "refused": 1}
    assert _rows(ledger) == []


def test_leg_a_released_stamp_is_written_verbatim(tmp_path):
    """[a][M1] the same `released`, lookup says "0.3.17": the row lands and its
    engineVersion is exactly that string."""
    ledger = tmp_path / "ledger.jsonl"
    stats = m.merge_findings([_finding(title="a")], ledger, _home,
                             lambda rid: "0.3.17", released={"0.3.17"})
    assert stats == {"added": 1, "skipped": 0, "refused": 0}
    rows = _rows(ledger)
    assert len(rows) == 1
    assert rows[0]["engineVersion"] == "0.3.17"


# --- leg (b) [M1] ---------------------------------------------------------

def test_leg_b_unknown_epoch_is_not_refused(tmp_path):
    """[b][M1] a lookup answering None is not a version outside `released`: the
    finding is added, refused stays 0, and the row carries no engineVersion."""
    ledger = tmp_path / "ledger.jsonl"
    stats = m.merge_findings([_finding(title="a")], ledger, _home,
                             lambda rid: None, released={"0.3.17"})
    assert stats["added"] == 1
    assert stats["refused"] == 0
    assert stats["skipped"] == 0
    rows = _rows(ledger)
    assert len(rows) == 1
    assert "engineVersion" not in rows[0]


# --- leg (c) [M2] ---------------------------------------------------------

def test_leg_c_released_omitted_keeps_base_stamp(tmp_path):
    """[c][M2] the BASE four-argument call still stamps the arbitrary "0.4.0"
    and refuses nothing."""
    ledger = tmp_path / "ledger.jsonl"
    stats = m.merge_findings([_finding(title="a")], ledger, _home,
                             lambda rid: "0.4.0")
    assert stats["added"] == 1
    assert stats.get("refused", 0) == 0
    rows = _rows(ledger)
    assert len(rows) == 1
    assert rows[0]["engineVersion"] == "0.4.0"


def test_leg_c_released_none_keeps_base_stamp(tmp_path):
    """[c][M2] passing released=None explicitly is the same BASE behaviour."""
    ledger = tmp_path / "ledger.jsonl"
    stats = m.merge_findings([_finding(title="b")], ledger, _home,
                             lambda rid: "0.4.0", released=None)
    assert stats["added"] == 1
    assert stats.get("refused", 0) == 0
    rows = _rows(ledger)
    assert len(rows) == 1
    assert rows[0]["engineVersion"] == "0.4.0"


# --- leg (d) [M3] ---------------------------------------------------------

def test_leg_d_engine_lookup_distrusts_the_date_bases(tmp_path):
    """[d][M3] five home bundles, one per basis: the two date bases answer None,
    `explicit`, `plugin-cache-path` and a basis-less bundle keep the epoch.
    `origin_lookup` is unchanged — home for all five."""
    cases = [
        ("d1", {"epoch": "0.3.0", "basis": "home-repo-date"}, None),
        ("d2", {"epoch": "0.3.0", "basis": "foreign-date-upper-bound"}, None),
        ("d3", {"epoch": "0.3.0", "basis": "explicit"}, "0.3.0"),
        ("d4", {"epoch": "0.3.0", "basis": "plugin-cache-path"}, "0.3.0"),
        ("d5", {"epoch": "0.3.0"}, "0.3.0"),
    ]
    for run_id, engine_version, _expected in cases:
        run = tmp_path / "runs" / run_id
        run.mkdir(parents=True)
        (run / "bundle.json").write_text(json.dumps(
            {"origin": "home", "engineVersion": engine_version}))
    origin_lookup, engine_lookup = m.bundle_lookups(tmp_path)
    assert [engine_lookup(r) for r, _ev, _e in cases] == \
        [expected for _r, _ev, expected in cases]
    assert [origin_lookup(r) for r, _ev, _e in cases] == ["home"] * 5


# --- leg (e) [M4] ---------------------------------------------------------

TIMELINE = (("2026-08-28T10:52:30-07:00", "0.2.26"),
            ("2026-08-29T14:03:52-07:00", "0.3.0"),
            ("2026-09-08T00:00:00Z", "0.3.0"))


def test_leg_e_released_versions_is_the_set_and_none_on_empty(monkeypatch):
    """[e][M4] the version set of the timeline (repeats collapse into the set),
    None when the timeline is empty, and no caching of either answer."""
    monkeypatch.setattr(_readers, "release_timeline", lambda: TIMELINE)
    first = _readers.released_versions()
    assert first == frozenset({"0.2.26", "0.3.0"})
    assert isinstance(first, frozenset)

    monkeypatch.setattr(_readers, "release_timeline", lambda: ())
    assert _readers.released_versions() is None

    # back again: a cached first answer would show up here
    monkeypatch.setattr(_readers, "release_timeline", lambda: TIMELINE)
    assert _readers.released_versions() == frozenset({"0.2.26", "0.3.0"})


# --- leg (f) [M5] ---------------------------------------------------------

def _sed_slice(text, start, end):
    """`sed -n '/start/,/end/p'` — from the first line matching `start` through
    the first later line matching `end`, both inclusive."""
    lines = text.splitlines()
    begin = next((i for i, line in enumerate(lines)
                  if re.search(start, line)), None)
    assert begin is not None, f"no line matches {start!r}"
    stop = next((i for i in range(begin + 1, len(lines))
                 if re.search(end, lines[i])), None)
    assert stop is not None, f"no line matches {end!r} after {start!r}"
    return "\n".join(lines[begin:stop + 1])


def _step3():
    return _sed_slice(SKILL.read_text(), r"^3\. \*\*Merge", r"^## Verb 2")


def test_leg_f_merge_ledger_date_basis_pin_is_rescoped():
    """[f][M5] `test_bundle_lookups_reads_cache_and_fails_closed` — the pin that
    owns the `home-repo-date` bundle — passes against the new lookup. Run
    directly (it takes only tmp_path), so a pin left asserting "0.0.12" fails
    here as it would in its own file."""
    spec = importlib.util.spec_from_file_location(
        "_exam_test_merge_ledger", MERGE_LEDGER_TESTS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        module.test_bundle_lookups_reads_cache_and_fails_closed(Path(tmp))


def test_leg_f_skill_step3_names_released_versions():
    """[f][M5] second Run: the step-3 slice contains `released_versions`."""
    assert "released_versions" in _step3()


def test_leg_f_skill_step3_names_the_released_keyword():
    """[f][M5] third Run: the step-3 slice contains `released=`."""
    assert "released=" in _step3()
