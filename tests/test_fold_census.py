"""The fold census: one row per run, conflicts by shape, dispatches and retries.

The exam for `skills/ultrapowers/scripts/fold_census.py`, leg by leg:

  * (a)/[M1] a run directory `run-7` with one `frontier/wave-1/` holding five
    entries prints a header whose eleven whitespace-separated fields are
    exactly `run waves conflicts insert-only deletion-only overlapping binary
    parked dispatches retries resolved`, and one row whose first field is
    `run-7` and whose `waves` is 1; two run directories on one argv print
    their rows in argv order, both ways round.
  * (b)/[M2] the five entries read, through `--json`, as `binary`,
    `deletion-only`, `insert-only` (`anchors` 1), `overlapping` and
    `unclassified`, and the table row reads `conflicts` 5 with `insert-only`
    1, `deletion-only` 1, `overlapping` 1, `binary` 1 — the `unclassified`
    entry is in `conflicts` and in none of the four. A sixth case, a `lines`
    entry whose narration carries only `deleted` segments, is `deletion-only`.
  * (c)/[M3] `dispatches` 3, `retries` 1, `resolved` 1, `parked` 3 for that
    run, and per conflict `2/1/true`, `1/0/false` and `0/0/false` for each of
    the three parked entries.
  * (d)/[M1] a run whose only record is `publish-fold/frontier/wave-1/` names
    that wave `publish-1` and reads `waves` 1, `binary` 1; a run carrying both
    roots reads `waves` 2 and sums their counts.
  * (e)/[M5] an empty run directory prints ten zeros at exit 0; a wave whose
    `conflicts.json` is `{` earns one stderr line naming that file, is still
    counted in `waves`, and exits 0; an argument that is not a directory exits
    2, is named on stderr, and earns no row.
  * (f)/[M4] the `--json` object's keys are exactly `run`, `waves`, `totals`,
    each conflict's exactly M4's eleven, each wave's exactly `wave` and
    `conflicts`, and `totals`' exactly the ten count columns.
  * (g)/[M2] the Interfaces check: `shape_of` and `census_run` imported once
    through `importlib.util.spec_from_file_location`, with the parameter names
    the task spells.
  * (i)/[M4] the Proof's second `Run:` — `--help` names `--json`.

The script is driven as a subprocess over run directories built under
`tmp_path`, in the style of `tests/test_authoring_census.py`; the fixtures are
hand-written by the Context's rules, never produced by the kernel.

Four readings this file pins, all from the task's own words:

  * the table's fields are joined with two spaces and "a reader splits on
    whitespace" (Context), so every table assertion here splits — the exam
    never pins the separator as bytes.
  * `unclassified` "is in `conflicts` and in none of the four" (M2), so
    `run-7` reads `conflicts` 5 while its four shape columns sum to 4.
  * `parked` is "the number of entries whose `dispatchable` is false" (M3) and
    is independent of shape, so the `binary` and `delete/modify` entries —
    which leg (c) writes `dispatchable` false, as the kernel does, there being
    no annotated narration to brief on — are parked too, for 3.
  * shape comes from `kind` first (M2): the `binary` and `delete/modify`
    entries here carry a reason-line `conflict-<i>.txt` with no marker, which
    the marker leg would read as `unclassified`, and M2's `kind` clauses
    decide them before it.
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CENSUS = ROOT / "skills/ultrapowers/scripts/fold_census.py"

# M1's header, in M1's order: `run` then the ten count columns.
HEADER = ["run", "waves", "conflicts", "insert-only", "deletion-only",
          "overlapping", "binary", "parked", "dispatches", "retries",
          "resolved"]
COUNTS = HEADER[1:]

# M4's eleven per-conflict keys, and the two keys of a wave object.
CONFLICT_KEYS = {"i", "path", "kind", "shape", "anchors", "dispatchable",
                 "autoResolved", "hunkCount", "dispatches", "retries",
                 "resolved"}
WAVE_KEYS = {"wave", "conflicts"}


# ------------------------------------------------------------- the narrations
#
# Hand-written by the Context's rules against the marker grammar of
# `skills/ultrapowers/kernel/hunks.py` lines 18-19: a marker line is the kind
# first, then the side (`frontier`, a task id, or `both`).

INSERT_ONLY = """the line above
<<<<<<< begin added frontier
the frontier's new line
======= begin added 2
task 2's new line
>>>>>>> end conflict
the line below
"""

# The Context: `overlapping` adds a `======= begin deleted frontier` segment.
OVERLAPPING = """the line above
<<<<<<< begin added frontier
the frontier's new line
======= begin added 2
task 2's new line
======= begin deleted frontier
the line the frontier drops
>>>>>>> end conflict
the line below
"""

# The Context: `deletion-only` uses only `deleted` segments.
DELETION_ONLY = """the line above
<<<<<<< begin deleted frontier
the line the frontier drops
======= begin deleted 2
the line task 2 drops
>>>>>>> end conflict
the line below
"""

# `fold_wave.py` line 757: a park that never reached a narration carries its
# reason in `conflict-<i>.txt` and no marker. M2 reads that as `unclassified`.
REASON_ONLY = "no hunks derived for %s\n"


# ------------------------------------------------------------------- the seam

def census(*args):
    """The script, as a subprocess. Nothing here reaches into its internals."""
    assert CENSUS.is_file(), (
        "the census script does not exist yet: %s" % CENSUS)
    return subprocess.run([sys.executable, str(CENSUS), *args],
                          capture_output=True, text=True)


def rows(out):
    """The table, split on whitespace as the Context says a reader does."""
    return [ln.split() for ln in out.splitlines() if ln.strip()]


def row_named(out, name):
    """The one row whose first field is `name`, as a dict on HEADER."""
    table = rows(out)
    assert table, "no output at all"
    assert table[0] == HEADER, table[0]
    hits = [r for r in table[1:] if r and r[0] == name]
    assert len(hits) == 1, "%d rows for %s in %r" % (len(hits), name, table)
    assert len(hits[0]) == len(HEADER), hits[0]
    return dict(zip(HEADER, hits[0]))


def json_line(run_dir):
    """The one `--json` object for one run directory."""
    p = census("--json", str(run_dir))
    assert p.returncode == 0, p.stdout + p.stderr
    lines = [ln for ln in p.stdout.splitlines() if ln.strip()]
    assert len(lines) == 1, p.stdout
    return json.loads(lines[0])


def by_index(obj):
    """Every conflict of every wave of one `--json` object, keyed on `i`."""
    out = {}
    for wave in obj["waves"]:
        for conflict in wave["conflicts"]:
            out[conflict["i"]] = conflict
    return out


# --------------------------------------------------------------- the fixtures

def write_wave(wave_dir, entries, narrations=None, replies=(), log_rows=()):
    """One wave directory as `fold_wave.py` writes one, by hand."""
    wave_dir.mkdir(parents=True)
    (wave_dir / "conflicts.json").write_text(json.dumps(entries, indent=2) + "\n")
    for i, text in (narrations or {}).items():
        (wave_dir / ("conflict-%d.txt" % i)).write_text(text)
    for name in replies:
        (wave_dir / name).mkdir()
        (wave_dir / name / "reply.txt").write_text("the resolver's reply\n")
    if log_rows:
        (wave_dir / "fold_log.jsonl").write_text(
            "".join(json.dumps(r) + "\n" for r in log_rows))
    return wave_dir


def entry(i, path, kind, dispatchable, epoch, hunk_count=0, **extra):
    """One `conflicts.json` entry, in the Context's literal shape."""
    e = {"i": i, "path": path, "kind": kind, "dispatchable": dispatchable,
         "reason": "" if dispatchable else "parked", "epoch": epoch,
         "hunksFile": "conflict-%d.hunks.txt" % i if dispatchable else "",
         "hunkCount": hunk_count}
    e.update(extra)
    return e


def build_run_7(tmp_path, name="run-7"):
    """Legs (a)/(b)/(c): one `frontier/wave-1/` holding the five entries.

    `i` 1 is the insert-only entry at epoch 3 with two replies and a resolve
    at epoch 3; `i` 2 the overlapping entry at epoch 5 with one reply and a
    resolve at epoch 4; `i` 3, 4 and 5 are the binary, the `delete/modify` and
    the never-narrated park, all `dispatchable` false as the kernel writes
    them — no annotated narration to brief on.
    """
    run = tmp_path / name
    entries = [
        entry(1, "src/alpha.py", "lines", True, 3, hunk_count=2),
        entry(2, "src/beta.py", "lines", True, 5, hunk_count=1,
              autoResolved=True),
        entry(3, "assets/logo.png", "binary", False, 3),
        entry(4, "src/gone.py", "delete/modify", False, 3),
        entry(5, "src/deep.py", "lines", False, 5),
    ]
    write_wave(
        run / "frontier" / "wave-1",
        entries,
        narrations={
            1: INSERT_ONLY,
            2: OVERLAPPING,
            3: REASON_ONLY % "assets/logo.png",
            4: REASON_ONLY % "src/gone.py",
            5: REASON_ONLY % "src/deep.py",
        },
        replies=["reply-1-1", "reply-1-2", "reply-2-1"],
        log_rows=[
            {"type": "base", "sha": "a" * 40},
            {"type": "fold", "task": "2", "headSha": "b" * 40},
            {"type": "resolve", "path": "src/alpha.py", "epoch": 3,
             "lines": ["the settled line"]},
            {"type": "resolve", "path": "src/beta.py", "epoch": 4,
             "lines": ["the earlier settled line"]},
        ],
    )
    return run


def build_publish_only(tmp_path, name="run-3"):
    """Leg (d): a run recorded before this plan — only the publish fold's copy."""
    run = tmp_path / name
    write_wave(run / "publish-fold" / "frontier" / "wave-1",
               [entry(1, "assets/logo.png", "binary", False, 1)],
               narrations={1: REASON_ONLY % "assets/logo.png"})
    return run


def build_both_roots(tmp_path, name="run-11"):
    """Leg (d): both records under one run — the counts sum over two waves."""
    run = tmp_path / name
    write_wave(run / "frontier" / "wave-1",
               [entry(1, "src/alpha.py", "lines", True, 1, hunk_count=1)],
               narrations={1: INSERT_ONLY})
    write_wave(run / "publish-fold" / "frontier" / "wave-1",
               [entry(1, "assets/logo.png", "binary", False, 1)],
               narrations={1: REASON_ONLY % "assets/logo.png"})
    return run


# --------------------------------------------------------- (a)/[M1] the table

def test_a_the_header_and_the_one_row(tmp_path):
    """(a)/[M1]: the header's eleven fields are exactly M1's, in M1's order,
    and `run-7` earns one row whose first field is its basename, `waves` 1."""
    run = build_run_7(tmp_path)
    p = census(str(run))
    assert p.returncode == 0, p.stdout + p.stderr
    table = rows(p.stdout)
    assert table[0] == HEADER, p.stdout
    assert len(table) == 2, p.stdout
    assert table[1][0] == "run-7", p.stdout
    assert row_named(p.stdout, "run-7")["waves"] == "1", p.stdout


def test_a_two_run_directories_print_in_argv_order(tmp_path):
    """(a)/[M1]: one row per run directory, in argv order — both ways round."""
    seven = build_run_7(tmp_path)
    three = build_publish_only(tmp_path)

    forward = census(str(seven), str(three))
    assert forward.returncode == 0, forward.stdout + forward.stderr
    assert [r[0] for r in rows(forward.stdout)[1:]] == ["run-7", "run-3"], \
        forward.stdout

    backward = census(str(three), str(seven))
    assert backward.returncode == 0, backward.stdout + backward.stderr
    assert [r[0] for r in rows(backward.stdout)[1:]] == ["run-3", "run-7"], \
        backward.stdout


# --------------------------------------------------------- (b)/[M2] the shapes

def test_b_the_five_entries_read_as_their_five_shapes(tmp_path):
    """(b)/[M2]: `binary` from the kind, `deletion-only` from `delete/modify`,
    `insert-only` from an all-`added` narration at one anchor, `overlapping`
    where both kinds occur, `unclassified` for the marker-less reason line."""
    run = build_run_7(tmp_path)
    conflicts = by_index(json_line(run))
    assert set(conflicts) == {1, 2, 3, 4, 5}, sorted(conflicts)
    assert conflicts[1]["shape"] == "insert-only", conflicts[1]
    assert conflicts[1]["anchors"] == 1, conflicts[1]
    assert conflicts[2]["shape"] == "overlapping", conflicts[2]
    assert conflicts[2]["anchors"] == 1, conflicts[2]
    assert conflicts[3]["shape"] == "binary", conflicts[3]
    assert conflicts[4]["shape"] == "deletion-only", conflicts[4]
    assert conflicts[5]["shape"] == "unclassified", conflicts[5]
    # M4: `anchors` is 0 when unclassified, and is the count of
    # `>>>>>>> end conflict` lines otherwise — the three reason-line
    # narrations carry none.
    assert conflicts[5]["anchors"] == 0, conflicts[5]
    assert conflicts[3]["anchors"] == 0, conflicts[3]
    assert conflicts[4]["anchors"] == 0, conflicts[4]
    # M4: the entry's own fields travel with it.
    assert conflicts[1]["path"] == "src/alpha.py", conflicts[1]
    assert conflicts[1]["kind"] == "lines", conflicts[1]
    assert conflicts[1]["hunkCount"] == 2, conflicts[1]
    assert conflicts[2]["autoResolved"] is True, conflicts[2]


def test_b_the_row_counts_each_shape_once_and_conflicts_counts_all_five(tmp_path):
    """(b)/[M2]: the table reads `conflicts` 5 with one of each of the four
    shape columns — the `unclassified` entry is in `conflicts` and in none."""
    run = build_run_7(tmp_path)
    p = census(str(run))
    assert p.returncode == 0, p.stdout + p.stderr
    row = row_named(p.stdout, "run-7")
    assert row["conflicts"] == "5", p.stdout
    assert row["insert-only"] == "1", p.stdout
    assert row["deletion-only"] == "1", p.stdout
    assert row["overlapping"] == "1", p.stdout
    assert row["binary"] == "1", p.stdout


def test_b_a_lines_entry_with_only_deleted_segments_is_deletion_only(tmp_path):
    """(b)/[M2]: the sixth case — a `lines` entry whose narration carries only
    `deleted` segments is `deletion-only`, in the JSON and in the column."""
    run = tmp_path / "run-8"
    write_wave(run / "frontier" / "wave-1",
               [entry(1, "src/removed.py", "lines", True, 1, hunk_count=1)],
               narrations={1: DELETION_ONLY})
    conflicts = by_index(json_line(run))
    assert conflicts[1]["shape"] == "deletion-only", conflicts[1]
    p = census(str(run))
    assert p.returncode == 0, p.stdout + p.stderr
    row = row_named(p.stdout, "run-8")
    assert row["deletion-only"] == "1", p.stdout
    assert row["insert-only"] == "0", p.stdout
    assert row["overlapping"] == "0", p.stdout


# ------------------------------- (c)/[M3] dispatches, retries, parked, resolved

def test_c_the_row_counts_dispatches_retries_parked_and_resolved(tmp_path):
    """(c)/[M3]: three `reply-<i>-<attempt>/` directories are 3 dispatches, the
    one at attempt 2 is the single retry, the three `dispatchable` false
    entries are 3 parked, and only `src/alpha.py` carries a resolve row at or
    after its entry's epoch, for 1 resolved."""
    run = build_run_7(tmp_path)
    p = census(str(run))
    assert p.returncode == 0, p.stdout + p.stderr
    row = row_named(p.stdout, "run-7")
    assert row["dispatches"] == "3", p.stdout
    assert row["retries"] == "1", p.stdout
    assert row["resolved"] == "1", p.stdout
    assert row["parked"] == "3", p.stdout


def test_c_the_per_conflict_dispatches_retries_and_resolved(tmp_path):
    """(c)/[M3]/[M4]: `2/1/true` for the insert-only entry, `1/0/false` for the
    overlapping one — its resolve row is at epoch 4, below its epoch 5 — and
    `0/0/false` for each of the three parked entries."""
    conflicts = by_index(json_line(build_run_7(tmp_path)))
    assert (conflicts[1]["dispatches"], conflicts[1]["retries"],
            conflicts[1]["resolved"]) == (2, 1, True), conflicts[1]
    assert (conflicts[2]["dispatches"], conflicts[2]["retries"],
            conflicts[2]["resolved"]) == (1, 0, False), conflicts[2]
    for i in (3, 4, 5):
        assert (conflicts[i]["dispatches"], conflicts[i]["retries"],
                conflicts[i]["resolved"]) == (0, 0, False), conflicts[i]
        assert conflicts[i]["dispatchable"] is False, conflicts[i]
    assert conflicts[1]["dispatchable"] is True, conflicts[1]
    assert conflicts[2]["dispatchable"] is True, conflicts[2]


# ------------------------------------------------------ (d)/[M1] the two roots

def test_d_a_publish_fold_wave_is_named_publish_1(tmp_path):
    """(d)/[M1]: a run whose only record is `publish-fold/frontier/wave-1/`
    names that wave `publish-1` and reads `waves` 1, `binary` 1."""
    run = build_publish_only(tmp_path)
    obj = json_line(run)
    assert [w["wave"] for w in obj["waves"]] == ["publish-1"], obj
    p = census(str(run))
    assert p.returncode == 0, p.stdout + p.stderr
    row = row_named(p.stdout, "run-3")
    assert row["waves"] == "1", p.stdout
    assert row["binary"] == "1", p.stdout
    assert row["conflicts"] == "1", p.stdout


def test_d_both_roots_read_two_waves_and_sum_their_counts(tmp_path):
    """(d)/[M1]: a run carrying both `frontier/wave-1/` and
    `publish-fold/frontier/wave-1/` reads `waves` 2 and sums their counts."""
    run = build_both_roots(tmp_path)
    obj = json_line(run)
    assert sorted(w["wave"] for w in obj["waves"]) == ["1", "publish-1"], obj
    p = census(str(run))
    assert p.returncode == 0, p.stdout + p.stderr
    row = row_named(p.stdout, "run-11")
    assert row["waves"] == "2", p.stdout
    assert row["conflicts"] == "2", p.stdout
    assert row["insert-only"] == "1", p.stdout
    assert row["binary"] == "1", p.stdout
    assert row["parked"] == "1", p.stdout


# ------------------------------------------------------- (e)/[M5] the edges

def test_e_a_run_with_no_record_prints_ten_zeros_and_exits_0(tmp_path):
    """(e)/[M5]: a run directory with neither `frontier/` nor
    `publish-fold/frontier/` prints a row of ten zeros and exits 0."""
    run = tmp_path / "run-0"
    run.mkdir()
    p = census(str(run))
    assert p.returncode == 0, p.stdout + p.stderr
    row = row_named(p.stdout, "run-0")
    assert [row[c] for c in COUNTS] == ["0"] * 10, p.stdout


def test_e_a_malformed_conflicts_json_is_one_stderr_line_at_exit_0(tmp_path):
    """(e)/[M5]: a wave whose `conflicts.json` is `{` prints one stderr line
    naming that file's path, is counted in `waves`, contributes no conflict,
    and exits 0 — never a traceback."""
    run = tmp_path / "run-5"
    wave = run / "frontier" / "wave-1"
    wave.mkdir(parents=True)
    bad = wave / "conflicts.json"
    bad.write_text("{")
    p = census(str(run))
    assert p.returncode == 0, p.stdout + p.stderr
    assert "Traceback" not in p.stderr, p.stderr
    said = [ln for ln in p.stderr.splitlines() if ln.strip()]
    assert len(said) == 1, p.stderr
    assert str(bad) in said[0], said[0]
    row = row_named(p.stdout, "run-5")
    assert row["waves"] == "1", p.stdout
    assert row["conflicts"] == "0", p.stdout


def test_e_an_argument_that_is_not_a_directory_exits_2(tmp_path):
    """(e)/[M5]: the exit is 2 when one argument is not a directory, with that
    argument named on stderr and no row printed for it."""
    run = build_run_7(tmp_path)
    notdir = tmp_path / "not-a-run"
    notdir.write_text("this is a file\n")
    p = census(str(run), str(notdir))
    assert p.returncode == 2, "%d\n%s%s" % (p.returncode, p.stdout, p.stderr)
    assert "Traceback" not in p.stderr, p.stderr
    assert str(notdir) in p.stderr, p.stderr
    assert "not-a-run" not in [r[0] for r in rows(p.stdout)], p.stdout


# --------------------------------------------------------- (f)/[M4] the keys

def test_f_the_json_object_carries_exactly_the_keys_m4_names(tmp_path):
    """(f)/[M4]: top level exactly `run`, `waves`, `totals`; each wave exactly
    `wave` and `conflicts`; each conflict exactly the eleven; `totals` exactly
    the ten count columns."""
    obj = json_line(build_run_7(tmp_path))
    assert set(obj) == {"run", "waves", "totals"}, sorted(obj)
    assert obj["run"] == "run-7", obj["run"]
    assert isinstance(obj["waves"], list), obj["waves"]
    for wave in obj["waves"]:
        assert set(wave) == WAVE_KEYS, sorted(wave)
        for conflict in wave["conflicts"]:
            assert set(conflict) == CONFLICT_KEYS, sorted(conflict)
    assert set(obj["totals"]) == set(COUNTS), sorted(obj["totals"])


def test_f_the_totals_are_the_rows_ten_counts(tmp_path):
    """(f)/[M4]: `totals` carries the ten count columns of the table, and
    reads what the table reads for the same run."""
    run = build_run_7(tmp_path)
    obj = json_line(run)
    p = census(str(run))
    assert p.returncode == 0, p.stdout + p.stderr
    row = row_named(p.stdout, "run-7")
    assert {k: str(v) for k, v in obj["totals"].items()} == \
        {c: row[c] for c in COUNTS}, (obj["totals"], row)


def test_f_json_prints_one_object_per_run_directory_per_line(tmp_path):
    """(f)/[M4]: one JSON object per run directory per line, in argv order."""
    seven = build_run_7(tmp_path)
    three = build_publish_only(tmp_path)
    p = census("--json", str(seven), str(three))
    assert p.returncode == 0, p.stdout + p.stderr
    lines = [ln for ln in p.stdout.splitlines() if ln.strip()]
    assert len(lines) == 2, p.stdout
    assert [json.loads(ln)["run"] for ln in lines] == ["run-7", "run-3"], \
        p.stdout


# -------------------------------------------------------- the Proof's `Run:`

def test_i_help_names_the_json_flag():
    """(i)/[M4]: the Proof's second `Run:` line — `--help` names `--json`."""
    p = census("--help")
    assert p.returncode == 0, p.stdout + p.stderr
    assert "--json" in p.stdout, p.stdout


# ------------------------------------------------------------- the Interfaces

def load_module():
    import importlib.util
    assert CENSUS.is_file(), (
        "the census script does not exist yet: %s" % CENSUS)
    spec = importlib.util.spec_from_file_location("fold_census", CENSUS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_g_the_produced_symbols_carry_the_names_the_task_spells():
    """(g)/Interfaces: `census_run(run_dir)` and `shape_of(kind, narration)`,
    with those parameter names."""
    import inspect
    module = load_module()
    wanted = {"census_run": ["run_dir"], "shape_of": ["kind", "narration"]}
    for name, params in wanted.items():
        fn = getattr(module, name, None)
        assert callable(fn), "no callable `%s` in %s" % (name, CENSUS)
        got = list(inspect.signature(fn).parameters)
        assert got == params, "%s%s" % (name, tuple(got))


def test_g_shape_of_reads_one_narration_on_its_own():
    """(g)/[M2]: `shape_of("lines", narration)` is `insert-only` for leg (b)'s
    insert-only narration and `unclassified` for the empty string; the two
    `kind` clauses of M2 decide before any marker is read."""
    shape_of = load_module().shape_of
    assert shape_of("lines", INSERT_ONLY) == "insert-only"
    assert shape_of("lines", "") == "unclassified"
    assert shape_of("lines", OVERLAPPING) == "overlapping"
    assert shape_of("lines", DELETION_ONLY) == "deletion-only"
    assert shape_of("binary", "") == "binary"
    assert shape_of("delete/modify", "") == "deletion-only"


def test_g_census_run_answers_the_json_object_for_one_directory(tmp_path):
    """(g)/Interfaces: `census_run(run_dir)` returns a `dict` equal to the
    parsed `--json` line for the same directory, given a `str` or a `Path`."""
    run = build_run_7(tmp_path)
    census_run = load_module().census_run
    expected = json_line(run)
    got = census_run(run)
    assert isinstance(got, dict), type(got)
    assert got == expected, (got, expected)
    assert census_run(str(run)) == expected
