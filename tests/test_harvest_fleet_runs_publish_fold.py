"""Exam for Task 1 — the bundle and the slice carry the publish fold whole.

Claim (quoted from #759): `harvest_fleet_runs.py` keeps every
`driver:publish-fold` event whole in `bundle.json` (a `publishFold` list of the
raw rows) and the slice writer never truncates an event line whose type is in a
small allowlist (`driver:publish-fold`, `publish:pr`, `publish:hold`,
`publish:merge`, `driver:ack-decision`).

Each test below names the Machine clause and the Proof leg it encodes:

  M1 / leg (a)  a run directory whose log carries one `driver:publish-fold` row
                of at least 600 characters (asserted on `len(json.dumps(row))`)
                yields `bundle["publishFold"] == [row]` by dict equality, `id`
                and `ts` included; two such rows yield both, ordered by `id`.
  M2 / leg (b)  a run directory whose log carries no `driver:publish-fold` row
                yields `bundle["publishFold"] == []`, and `bundle.json` is
                still written.
  M3 / leg (c)  in `slice.md`'s `## Event timeline` block, for each of the five
                allowlisted kinds, a row whose rendered summary exceeds 200
                characters is exactly one line carrying every string value the
                row has and not ending in `…`; the negative row — an
                `engine:log` line of 500 characters — is still capped under 260
                characters and still ends in `…`.
  M1 / leg (e)  `BASE_BUNDLE_KEYS` in `tests/test_harvest_evidence.py` names
                `publishFold`, so the bundle-key pin admits the new key.
  M4 / leg (f)  the `1. **friction**` item of
                `skills/ultralearn/references/reading-lenses.md` names
                `bundle.publishFold` and then, in order, `pathsJoined`,
                `pathsConflicted`, `resolversDispatched`, `suite` and
                `disposition`, and no longer names `gate-read-<runId>.detail.json`.

Leg (d) — `test_render_timeline_caps_a_long_summary` still passing as written —
is pinned in `tests/test_fleet_events.py`, alongside the render-level tests of
the same allowlist.

Self-contained and hermetic: its own `_ev` / `_make_run_dir` fixture helpers
(restated, never imported, so it does not depend on another exam's fixtures),
local run directories only, `--engine-version` passed so nothing shells out for
a release timeline, no `gh`, no network.
"""
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "skills/ultralearn/scripts"
LENSES = REPO / "skills/ultralearn/references/reading-lenses.md"

sys.path.insert(0, str(SCRIPTS))
import harvest_fleet_runs as hfr  # noqa: E402

T0 = 1788817200000
SUMMARY_MAX = 200      # the timeline cap this task exempts five kinds from
FOLD_MIN = 600         # M1: the row's JSON line is at least this long

# The five kinds the Claim allowlists — carried whole, never cut to a length.
WHOLE_KINDS = ("driver:publish-fold", "publish:pr", "publish:hold",
               "publish:merge", "driver:ack-decision")


# ---------- fixture helpers (restated here, not imported) ----------

def _ev(i, off_ms, **fields):
    """One event record: `id` is the sort key, `ts` is the wall clock."""
    return dict(fields, id=f"01M1YX{i:04d}", ts=T0 + off_ms)


def _fold_row(i, off_ms, *, run="42", pad_to=FOLD_MIN, disposition="nothing to join"):
    """A `driver:publish-fold` row shaped like the real one at BASE (run-42,
    off its evidence tag), padded on `disposition` until its JSON line is at
    least `pad_to` characters — measured, so the exam cannot pass on a row the
    200-character cap would never have touched."""
    row = _ev(i, off_ms, kind="driver:publish-fold", run=run, attempt="1",
              base="9cd8190", tip="9cd8190", candidate="09577d3",
              pathsJoined=0, pathsConflicted=0, resolversDispatched=0,
              resolverRetries=0, suite="none", disposition=disposition)
    while len(json.dumps(row)) < pad_to:
        # plain ASCII: one padding character is one character of JSON
        row["disposition"] += "-" + "joined-path" * 4
    return row


def _make_run_dir(root, run_id, events):
    """A structurally faithful miniature fleet run directory: an `events.jsonl`
    opened by a `run:open`, plus the empty `claude/projects/` a local run
    carries."""
    d = root / f"run-{run_id}"
    (d / "claude" / "projects").mkdir(parents=True)
    log = [_ev(1, 0, kind="run:open", runId=run_id, base="",
               source="fleet/run-main.mjs")] + list(events)
    (d / "events.jsonl").write_text(
        "\n".join(json.dumps(e) for e in log) + "\n")
    return d


def _bundle(tmp_path, run_id, events, *, log_order=None):
    """Harvest one run directory and return `(bundle, out_dir)`.

    `log_order`, when given, is the order the rows are written to the log in —
    `read_events` sorts by `id`, and M1's ordering leg needs a log whose
    on-disk order is not already the answer."""
    src, cache = tmp_path / "src", tmp_path / "cache"
    run_dir = _make_run_dir(src, run_id, log_order if log_order is not None else events)
    out = hfr.build_fleet_bundle(run_dir, cache, engine_version="0.3.0")
    assert out is not None, "the harvester refused a run directory it can read"
    return json.loads((out / "bundle.json").read_text()), out


def _timeline_lines(out):
    """The lines of `slice.md`'s `## Event timeline` fenced block."""
    text = (out / "slice.md").read_text()
    m = re.search(r"## Event timeline\n\n```\n(.*?)\n```", text, re.S)
    assert m is not None, f"no `## Event timeline` block in slice.md:\n{text[:400]}"
    return m.group(1).splitlines()


def _publish_fold(bundle):
    """`bundle["publishFold"]`, with the missing-key case named rather than
    raised as a bare `KeyError`."""
    assert "publishFold" in bundle, (
        "bundle.json has no top-level `publishFold` key; keys: "
        f"{sorted(bundle)}")
    return bundle["publishFold"]


def _string_values(row):
    return [v for v in row.values() if isinstance(v, str)]


# ---------- M1, leg (a): the bundle carries the raw rows ----------

def test_a_long_publish_fold_row_is_carried_whole_in_the_bundle(tmp_path):
    """M1, leg (a): one `driver:publish-fold` row whose JSON line is at least
    600 characters yields a top-level `publishFold` whose single element equals
    that row as parsed — every key the line carries, `id` and `ts` included."""
    row = _fold_row(2, 5000)
    assert len(json.dumps(row)) >= FOLD_MIN, "fixture row is shorter than 600 chars"

    bundle, _ = _bundle(tmp_path, "run-42", [row])

    assert _publish_fold(bundle) == [row]
    # Spelled out, because the equality above is what a shortened or
    # key-stripped row fails on: every key, and the full-length disposition.
    got = bundle["publishFold"][0]
    assert set(got) == set(row)
    assert got["id"] == row["id"]
    assert got["ts"] == row["ts"]
    assert got["disposition"] == row["disposition"]
    assert len(got["disposition"]) == len(row["disposition"])


def test_two_publish_fold_rows_are_both_carried_in_id_order(tmp_path):
    """M1, leg (a): a log carrying two such rows holds both, in `id` order —
    here the log is written with the later `id` first, so an implementation
    that echoed the file order would fail."""
    first = _fold_row(2, 5000, disposition="joined 3 paths, suite green")
    second = _fold_row(3, 9000, disposition="held: conflicted paths remain")
    assert len(json.dumps(first)) >= FOLD_MIN
    assert len(json.dumps(second)) >= FOLD_MIN
    assert first["id"] < second["id"]

    bundle, _ = _bundle(tmp_path, "run-43", [first, second],
                        log_order=[second, first])

    assert _publish_fold(bundle) == [first, second]
    assert [r["id"] for r in bundle["publishFold"]] == [first["id"], second["id"]]


def test_other_kinds_are_not_folded_into_publish_fold(tmp_path):
    """M1, leg (a): `publishFold` holds the `driver:publish-fold` rows and
    nothing else — a neighbouring `publish:merge` row is not one of them."""
    fold = _fold_row(2, 5000)
    other = _ev(3, 6000, kind="publish:merge", run="42", detail="merged")

    bundle, _ = _bundle(tmp_path, "run-44", [fold, other])

    assert _publish_fold(bundle) == [fold]


# ---------- M2, leg (b): a run with no fold row still bundles ----------

def test_a_run_with_no_publish_fold_row_bundles_with_an_empty_list(tmp_path):
    """M2, leg (b): no `driver:publish-fold` row means `publishFold == []`, and
    `bundle.json` is still written."""
    bundle, out = _bundle(tmp_path, "run-45", [
        _ev(2, 1000, kind="engine:phase", phase="Wave 1"),
        _ev(3, 2000, kind="driver:fail", verdict="needs-ack", detail="deferred:manual"),
    ])

    assert (out / "bundle.json").exists()
    assert _publish_fold(bundle) == []


# ---------- M3, leg (c): the slice timeline carries the five kinds whole ----------

def _long_value(kind):
    """A distinct string value comfortably longer than the 200-character cap,
    plain ASCII so it survives JSON rendering verbatim."""
    value = f"{kind} decision: " + ("paths joined and resolvers dispatched; " * 8)
    assert len(value) > SUMMARY_MAX
    return value


def _five_whole_rows():
    """One row per allowlisted kind, each carrying a >200-character string in
    the field that kind's summary renders."""
    return [
        _fold_row(2, 1000, disposition=_long_value("driver:publish-fold")),
        _ev(3, 2000, kind="publish:pr", run="43", number=12,
            detail=_long_value("publish:pr")),
        _ev(4, 3000, kind="publish:hold", run="43",
            detail=_long_value("publish:hold")),
        _ev(5, 4000, kind="publish:merge", run="43",
            detail=_long_value("publish:merge")),
        _ev(6, 5000, kind="driver:ack-decision", approve=True,
            reason=_long_value("driver:ack-decision")),
    ]


def test_the_five_allowlisted_kinds_render_whole_in_the_slice_timeline(tmp_path):
    """M3, leg (c): for each of `driver:publish-fold`, `publish:pr`,
    `publish:hold`, `publish:merge` and `driver:ack-decision`, `slice.md`'s
    event timeline holds exactly one line for that row, that line carries the
    row's long string value whole and every other string value the row has, and
    it does not end in `…`."""
    rows = _five_whole_rows()
    _, out = _bundle(tmp_path, "run-46", rows)
    lines = _timeline_lines(out)

    for row in rows:
        kind = row["kind"]
        long_value = max(_string_values(row), key=len)
        assert len(long_value) > SUMMARY_MAX

        matching = [ln for ln in lines if row["id"] in ln]
        assert len(matching) == 1, (
            f"{kind}: expected exactly one timeline line, got {len(matching)}")
        line = matching[0]

        assert long_value in line, (
            f"{kind}: the timeline cut the row — its {len(long_value)}-char "
            f"string is not carried whole. Line was:\n{line}")
        assert not line.endswith("…"), f"{kind}: the timeline line was elided:\n{line}"
        for value in _string_values(row):
            assert value in line, f"{kind}: line is missing the value {value!r}"


def test_an_engine_log_row_is_still_capped_in_the_slice_timeline(tmp_path):
    """M3, the negative row, leg (d)'s clause read at the slice: an
    `engine:log` row whose `line` is 500 characters still renders as a line
    shorter than 260 characters, ending in `…`. The exemption is an allowlist,
    not the removal of the cap."""
    row = _ev(2, 1000, kind="engine:log", line="x" * 500)
    _, out = _bundle(tmp_path, "run-47", [row])

    matching = [ln for ln in _timeline_lines(out) if row["id"] in ln]
    assert len(matching) == 1
    assert matching[0].endswith("…")
    assert len(matching[0]) < 260


# ---------- M4, leg (f): the friction lens reads the fold ----------

def _friction_item():
    """The `1. **friction**` item, up to and including the `2. **routing**`
    line — the same range the Proof's `sed` extracts."""
    lines = LENSES.read_text().splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.startswith("1. **friction**"))
    end = next(i for i, ln in enumerate(lines)
               if i > start and ln.startswith("2. **routing**"))
    return lines[start:end + 1]


def test_the_friction_item_names_the_publish_fold_and_its_fields():
    """M4, leg (f): the friction item's text, joined, names `bundle.publishFold`
    and then, in order, `pathsJoined`, `pathsConflicted`,
    `resolversDispatched`, `suite` and `disposition` — the fields a fold
    decision is read from."""
    joined = " ".join(_friction_item())
    assert re.search(
        r"bundle.publishFold.*pathsJoined.*pathsConflicted.*"
        r"resolversDispatched.*suite.*disposition", joined), (
        "the friction item does not name bundle.publishFold followed by the "
        "five fold fields in order")


def test_the_friction_item_no_longer_names_the_stale_gate_read_artifact():
    """M4, leg (f): `gate-read-<runId>.detail.json` — a pre-0.3.0 artifact no
    fleet run writes — no longer appears in the friction item."""
    hits = [ln for ln in _friction_item() if "gate-read-<runId>.detail.json" in ln]
    assert hits == [], f"the friction item still names the stale artifact: {hits}"
