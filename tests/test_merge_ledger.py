import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import merge_ledger as m


def _finding(**kw):
    base = {"runId": "r1", "lens": "frontier", "title": "t", "novelty": 2,
            "severity": 1, "evidence": "raw quote", "evidenceAbstracted": False,
            "implication": "x", "surface": "SKILL.md"}
    base.update(kw)
    return base


def test_home_verbatim_allowed():
    out = m.redact_finding(_finding(), "home")
    assert out is not None and "id" in out and out["origin"] == "home"


def test_foreign_verbatim_rejected():
    assert m.redact_finding(_finding(evidenceAbstracted=False), "foreign") is None


def test_foreign_abstracted_allowed():
    out = m.redact_finding(_finding(evidenceAbstracted=True, evidence="shape only"), "foreign")
    assert out is not None and out["origin"] == "foreign"


def test_unknown_origin_fails_closed():
    assert m.redact_finding(_finding(evidenceAbstracted=False), "mystery") is None


def test_finding_id_is_stable():
    assert m.finding_id(_finding()) == m.finding_id(_finding())


def test_merge_dedups_and_is_idempotent(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    origin = lambda rid: "home"
    f = [_finding(title="a"), _finding(title="b")]
    s1 = m.merge_findings(f, ledger, origin)
    assert s1["added"] == 2
    s2 = m.merge_findings(f, ledger, origin)  # same findings again
    assert s2["added"] == 0
    assert len(ledger.read_text().splitlines()) == 2


def test_merge_applies_redaction(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    origin = lambda rid: "foreign"
    f = [_finding(title="leak", evidenceAbstracted=False)]
    stats = m.merge_findings(f, ledger, origin)
    assert stats["added"] == 0  # foreign verbatim never lands
    assert not ledger.exists() or ledger.read_text().strip() == ""


def test_regenerate_digest_groups_by_lens(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings([_finding(title="a", lens="friction"),
                      _finding(title="b", lens="frontier")],
                     ledger, lambda rid: "home")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    text = digest.read_text()
    assert "friction" in text and "frontier" in text


def test_engine_version_stamped_when_lookup_provided(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings([_finding(title="a")], ledger,
                     lambda rid: "home", lambda rid: "0.0.10")
    entry = json.loads(ledger.read_text().splitlines()[0])
    assert entry["engineVersion"] == "0.0.10"


def test_engine_version_absent_without_lookup(tmp_path):
    # Backward compatible: the 3-arg form stamps no engineVersion.
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings([_finding(title="a")], ledger, lambda rid: "home")
    entry = json.loads(ledger.read_text().splitlines()[0])
    assert "engineVersion" not in entry


def test_engine_version_none_epoch_is_omitted(tmp_path):
    # An unknown epoch (None) must not write engineVersion: null noise.
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings([_finding(title="a")], ledger,
                     lambda rid: "home", lambda rid: None)
    entry = json.loads(ledger.read_text().splitlines()[0])
    assert "engineVersion" not in entry


def test_digest_shows_engine_version(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings([_finding(title="a", lens="friction")], ledger,
                     lambda rid: "home", lambda rid: "0.0.10")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    assert "0.0.10" in digest.read_text()


def test_bundle_lookups_reads_cache_and_fails_closed(tmp_path):
    run = tmp_path / "runs" / "r1"
    run.mkdir(parents=True)
    (run / "bundle.json").write_text(json.dumps(
        {"origin": "home",
         "engineVersion": {"epoch": "0.0.12", "asOf": "t", "basis": "home-repo-date"}}))
    origin_lookup, engine_lookup = m.bundle_lookups(tmp_path)
    assert origin_lookup("r1") == "home"
    # #696: basis 'home-repo-date' is a guess from the run's date, not a read
    # version — the lookup no longer trusts it, so this bundle stamps nothing.
    assert engine_lookup("r1") is None
    # missing bundle: origin fails closed to foreign, epoch is unknown
    assert origin_lookup("missing") == "foreign"
    assert engine_lookup("missing") is None


def test_synthetic_verbatim_rejected_abstracted_allowed():
    # synthetic is non-home → fail-closed redaction, same as foreign.
    assert m.redact_finding(_finding(evidenceAbstracted=False), "synthetic") is None
    out = m.redact_finding(_finding(evidenceAbstracted=True, evidence="shape only"),
                           "synthetic")
    assert out is not None and out["origin"] == "synthetic"


def test_digest_tags_synthetic_rows(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    rows = [
        m.redact_finding(_finding(title="synth", evidenceAbstracted=True,
                                  evidence="shape"), "synthetic"),
        m.redact_finding(_finding(title="field", evidenceAbstracted=True,
                                  evidence="shape"), "foreign"),
    ]
    ledger.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    digest = tmp_path / "digest.md"
    m.regenerate_digest(ledger, digest)
    text = digest.read_text()
    synth_line = next(line for line in text.splitlines() if "synth" in line)
    field_line = next(line for line in text.splitlines() if "field" in line)
    assert "_(synthetic)_" in synth_line and "_(abstracted)_" not in synth_line
    assert "_(abstracted)_" in field_line


def test_structured_redirect_fields_pass_through(tmp_path):
    # #220: the canary fields must land in the ledger row intact.
    ledger = tmp_path / "ledger.jsonl"
    f = _finding(title="redirect count",
                 redirectRounds={"total": 3, "infra": 1, "finding": 2,
                                 "plan": 0, "elective": 0},
                 implementationTasks=7)
    m.merge_findings([f], ledger, lambda rid: "home")
    entry = json.loads(ledger.read_text().splitlines()[0])
    assert entry["redirectRounds"]["total"] == 3
    assert entry["implementationTasks"] == 7


def test_digest_renders_redirect_rate_table(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings(
        [_finding(title="rr a", runId="r1",
                  redirectRounds={"total": 3, "infra": 1, "finding": 2,
                                  "plan": 0, "elective": 0},
                  implementationTasks=6),
         _finding(title="rr b", runId="r2",
                  redirectRounds={"total": 1, "infra": 0, "finding": 1,
                                  "plan": 0, "elective": 0},
                  implementationTasks=4)],
        ledger, lambda rid: "home", lambda rid: "0.2.21")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    text = digest.read_text()
    assert "redirect-round rate by engineVersion" in text
    # 0.2.21: 2 runs, 4 rounds, 10 tasks, rate 0.40
    row = next(line for line in text.splitlines() if line.startswith("| 0.2.21"))
    assert "| 2 |" in row and "| 4 |" in row and "| 10 |" in row and "0.40" in row


def test_digest_tolerates_old_shape_rows(tmp_path):
    # Append-only ledger: historical rows carry no structured fields and
    # must neither crash the digest nor enter the rate table.
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings(
        [_finding(title="old prose-only count", runId="r1"),
         _finding(title="new structured", runId="r2",
                  redirectRounds={"total": 2, "infra": 0, "finding": 2,
                                  "plan": 0, "elective": 0},
                  implementationTasks=5)],
        ledger, lambda rid: "home")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    text = digest.read_text()
    table_rows = [line for line in text.splitlines()
                  if line.startswith("|") and "engineVersion" not in line
                  and "---" not in line]
    assert len(table_rows) == 1  # only the structured row aggregates
    # Review nit: the prose-only row must not leak into the counts either.
    assert "| 1 |" in table_rows[0] and "| 2 |" in table_rows[0]


def test_digest_skips_malformed_redirect_rounds(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings(
        [_finding(title="bad shape", runId="r1", redirectRounds="three"),
         _finding(title="bad total", runId="r2",
                  redirectRounds={"total": "x"})],
        ledger, lambda rid: "home")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)  # must not raise
    assert "redirect-round rate by engineVersion" not in digest.read_text()


def test_digest_rate_dash_when_tasks_unknown(tmp_path):
    # A structured count with no implementationTasks still aggregates —
    # rate renders as an em-dash instead of dividing by zero.
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings(
        [_finding(title="rr no tasks", runId="r1",
                  redirectRounds={"total": 2, "infra": 0, "finding": 2,
                                  "plan": 0, "elective": 0})],
        ledger, lambda rid: "home", lambda rid: "0.2.21")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    row = next(line for line in digest.read_text().splitlines()
               if line.startswith("| 0.2.21"))
    assert "—" in row


def test_digest_rate_dash_on_partial_task_denominator(tmp_path):
    # Review minor: a version where only SOME rows carry implementationTasks
    # must render "—", not divide by the partial denominator (which would
    # silently inflate the rate — the exact bug the rule prevents).
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings(
        [_finding(title="rr with tasks", runId="r1",
                  redirectRounds={"total": 3, "infra": 0, "finding": 3,
                                  "plan": 0, "elective": 0},
                  implementationTasks=6),
         _finding(title="rr without tasks", runId="r2",
                  redirectRounds={"total": 1, "infra": 1, "finding": 0,
                                  "plan": 0, "elective": 0})],
        ledger, lambda rid: "home", lambda rid: "0.2.21")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    row = next(line for line in digest.read_text().splitlines()
               if line.startswith("| 0.2.21"))
    assert "—" in row and "0.67" not in row and "0.50" not in row


def test_digest_dedupes_runid_last_row_wins(tmp_path):
    # Trim review F7b: a re-sensed run whose retitled count finding landed
    # twice (the ledger dedupes by runId+lens+title, so a retitle duplicates)
    # counts ONCE — the last qualifying ledger row wins.
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings(
        [_finding(title="rr first", runId="r1",
                  redirectRounds={"total": 5, "infra": 0, "finding": 5,
                                  "plan": 0, "elective": 0},
                  implementationTasks=10),
         _finding(title="rr resensed", runId="r1",
                  redirectRounds={"total": 2, "infra": 0, "finding": 2,
                                  "plan": 0, "elective": 0},
                  implementationTasks=10)],
        ledger, lambda rid: "home", lambda rid: "0.2.21")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    row = next(line for line in digest.read_text().splitlines()
               if line.startswith("| 0.2.21"))
    assert "| 1 |" in row and "| 2 |" in row and "0.20" in row


def test_bundle_lookups_expands_tilde(tmp_path, monkeypatch):
    # The skill doc's own example call passes ~/.claude/ultralearn; an
    # unexpanded tilde made every bundle read fail closed to 'foreign' and
    # silently dropped the engine-version stamp (#91 item 2).
    monkeypatch.setenv("HOME", str(tmp_path))
    bundle_dir = tmp_path / ".claude/ultralearn/runs/r9"
    bundle_dir.mkdir(parents=True)
    (bundle_dir / "bundle.json").write_text(json.dumps(
        {"origin": "home", "engineVersion": {"epoch": "0.1.12"}}))
    origin, engine = m.bundle_lookups("~/.claude/ultralearn")
    assert origin("r9") == "home"
    assert engine("r9") == "0.1.12"


# ---------- Task 3 (#761, recording #698): the lookup reads the dated key ----
#
# The harvester's cache key is now `run-<N>-<date>`, but the ledger's `runId` is
# still the bare `run-30`. A lookup that reads `runs/<runId>/bundle.json` alone
# would fail closed to 'foreign' for every fleet run harvested under the new
# key — dropping the engine-version stamp and re-redacting home findings.
#
#   M5 / leg (e)  `bundle_lookups(cache)` answers `origin_lookup("run-30")` and
#                 `engine_lookup("run-30")` from the bundle under
#                 `<cache>/runs/*/bundle.json` whose `runId` field is `run-30`,
#                 choosing the greatest `events.openedAt` when more than one
#                 carries that id; a directory named exactly `run-30` is a
#                 candidate too; and an id no bundle carries still answers
#                 'foreign' and None.

def _t3_write_bundle(cache, key, *, run_id, origin, opened_at, epoch):
    """One cached bundle at `<cache>/runs/<key>/bundle.json`, carrying the three
    fields the lookup reads: `runId`, `origin`/`engineVersion.epoch`, and
    `events.openedAt` (the tie-break)."""
    d = cache / "runs" / key
    d.mkdir(parents=True)
    (d / "bundle.json").write_text(json.dumps({
        "runId": run_id,
        "origin": origin,
        "engineVersion": {"epoch": epoch, "asOf": None, "basis": "explicit"},
        "events": {"runId": run_id, "openedAt": opened_at},
    }))
    return d


def test_t3_bundle_lookups_take_the_latest_opened_bundle_for_one_run_id(tmp_path):
    """M5, leg (e): a cache holding BOTH `runs/run-24/bundle.json` (August's
    bare key: origin 'home', openedAt 1756500000000, epoch 0.2.25) and
    `runs/run-24-2026-09-05/bundle.json` (origin 'foreign', openedAt
    1788600000000, epoch 0.3.17) answers for the LATER of the two — the lookup
    reads past a restarted numbering's older namesake rather than migrating it."""
    _t3_write_bundle(tmp_path, "run-24", run_id="run-24", origin="home",
                     opened_at=1756500000000, epoch="0.2.25")
    _t3_write_bundle(tmp_path, "run-24-2026-09-05", run_id="run-24",
                     origin="foreign", opened_at=1788600000000, epoch="0.3.17")

    origin_lookup, engine_lookup = m.bundle_lookups(tmp_path)

    assert origin_lookup("run-24") == "foreign"
    assert engine_lookup("run-24") == "0.3.17"


def test_t3_bundle_lookups_find_a_run_under_its_dated_key(tmp_path):
    """M5, leg (e): a cache holding only `runs/run-30-2026-08-30/bundle.json`
    with `runId` `run-30` answers `origin_lookup("run-30") == "home"`. This is
    the whole point: the ledger says `run-30`, the cache says
    `run-30-2026-08-30`, and a lookup keyed on the directory name alone fails
    closed to 'foreign' for every fleet run."""
    _t3_write_bundle(tmp_path, "run-30-2026-08-30", run_id="run-30",
                     origin="home", opened_at=1788130000000, epoch="0.3.0")

    origin_lookup, engine_lookup = m.bundle_lookups(tmp_path)

    assert origin_lookup("run-30") == "home"
    assert engine_lookup("run-30") == "0.3.0"


def test_t3_bundle_lookups_still_read_a_bare_run_directory(tmp_path):
    """M5, leg (e): a cache holding only the BARE directory
    `runs/run-30/bundle.json` (`runId` `run-30`, origin 'home', openedAt
    1788130000000) still answers 'home' — August's un-migrated bundles keep
    resolving. An implementation that globs only dated directories fails this."""
    _t3_write_bundle(tmp_path, "run-30", run_id="run-30", origin="home",
                     opened_at=1788130000000, epoch="0.3.0")

    origin_lookup, engine_lookup = m.bundle_lookups(tmp_path)

    assert origin_lookup("run-30") == "home"
    assert engine_lookup("run-30") == "0.3.0"


def test_t3_bundle_lookups_still_fail_closed_for_an_id_no_bundle_carries(tmp_path):
    """M5, leg (e): on that same cache, an id no bundle carries still fails
    closed — `origin_lookup("run-99") == "foreign"` and `engine_lookup("run-99")
    is None`. Scanning the directory widens what can be FOUND, never what is
    trusted when nothing is."""
    _t3_write_bundle(tmp_path, "run-30", run_id="run-30", origin="home",
                     opened_at=1788130000000, epoch="0.3.0")

    origin_lookup, engine_lookup = m.bundle_lookups(tmp_path)

    assert origin_lookup("run-99") == "foreign"
    assert engine_lookup("run-99") is None
