"""evals/check_renders_ab.py (#345): the campaign's OUTPUT SCHEMA is pinned;
its numbers are the operator's to read at integration, never asserted."""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "evals/check_renders_ab.py"
DOC = ROOT / "evals/frontier/results/2026-08-29-check-renders.md"
sys.path.insert(0, str(ROOT / "evals"))
import check_renders_ab as cell  # noqa: E402


def _table_rows(text, heading):
    """Data rows (list of cell lists) of the first markdown table under `heading`."""
    section = text.split(heading, 1)[1].split("\n## ", 1)[0]
    rows = [l for l in section.splitlines() if l.startswith("|")]
    return [[c.strip() for c in r.strip("|").split("|")] for r in rows[2:]]


def test_parse_advisories_groups_blocks():
    out = ("PLAN OK\n\n"
           "ADVISORY blast-radius: Task 1 Produces `runShim` — 2 file(s) at BASE outside Task 1's Files mention it:\n"
           "  - fleet/drive.mjs\n  - fleet/tests/test_drive.mjs\n"
           "ADVISORY referent: Task 4 names `x/y.md` — not at BASE, not in Task 4's Files, not Created by a task it Depends-on\n")
    blocks = cell.parse_advisories(out)
    assert [(b["render"], b["task"], len(b["lines"])) for b in blocks] == [
        ("blast-radius", "1", 3), ("referent", "4", 1)]
    assert cell.parse_advisories("PLAN OK\n") == []


def test_corpus_is_fixtures_plus_0827_plans():
    entries = cell.corpus()
    names = [e["name"] for e in entries]
    for f in cell.CANONICAL:
        assert f in names
    assert "2026-08-27-w2-entry-slate" in names
    assert sum(1 for e in entries if e["canonical"]) == 5
    for e in entries:
        assert e["plan"].exists() and e["base"].is_dir()


def test_restricted_campaign_writes_the_schema(tmp_path):
    out = tmp_path / "cell.md"
    p = subprocess.run([sys.executable, str(SCRIPT), "--out", str(out),
                        "--only", "wide", "--only", "2026-08-27-w2-entry-slate"],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    text = out.read_text()
    for heading in cell.DOC_SECTIONS:
        assert heading in text, heading
    corpus_rows = _table_rows(text, "## Corpus")
    assert [r[0] for r in corpus_rows] == ["`wide`", "`2026-08-27-w2-entry-slate`"]
    # exit parity is the frozen contract, not a number: pinned per row
    for r in corpus_rows:
        assert r[2] == r[3], r
    known_rows = _table_rows(text, "## Known instances")
    assert len(known_rows) == len(cell.KNOWN_INSTANCES)
    assert all(r[4] in ("yes", "NO", "not run") for r in known_rows)
    fp_rows = _table_rows(text, "## Canonical false positives")
    assert [r[0] for r in fp_rows] == ["`wide`"]
    assert re.search(r"^- known instances surfaced: \d+/%d$" % len(cell.KNOWN_INSTANCES),
                     text, re.M)
    assert re.search(r"^- canonical false positives: \d+ \(bar: 0\)$", text, re.M)


def test_committed_results_doc_matches_schema():
    assert DOC.exists(), "Task 4 runs the campaign and commits the doc"
    text = DOC.read_text()
    for heading in cell.DOC_SECTIONS:
        assert heading in text, heading
    assert len(_table_rows(text, "## Corpus")) == len(cell.corpus())
    assert len(_table_rows(text, "## Known instances")) == len(cell.KNOWN_INSTANCES)
    assert [r[0] for r in _table_rows(text, "## Canonical false positives")] == \
        ["`%s`" % f for f in cell.CANONICAL]
