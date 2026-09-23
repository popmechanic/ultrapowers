#!/usr/bin/env python3
"""Read a release's runs into one table: what authoring cost beside the run.

Every run leaves a gate record, and since this plan that record carries an
`authoring` object — the minutes, the probes, the routing branch the risk
override chose, the lane, and the questions with their recommended and picked
options and how many explain rounds each asked for. One run's record answers
one run; a release is a handful of them, and
the question an operator asks at a release ("what did authoring cost, how often
did the override send a plan to the fleet, how often was Recommended picked")
is a question about the pile. This census is that pile read into one table.

    authoring_census.py --from <dir>
    authoring_census.py --from <dir> --register
    authoring_census.py --fetch <owner>/<repo> --runs <A>..<B> --into <dir>

`<dir>` holds `run-<N>/gate-verdicts.json` files, optionally with a
`run-<N>/status.json` and a `run-<N>/report.json` beside each; a `run-<N>`
with no record is not a row.
`--register` prints one line per option of every question instead of the table
(#735). `--fetch` fills `<dir>` from the plan and evidence tags over `gh api`
and then prints the table over it. `--gh` swaps that binary — the test seam,
and the hook for a caller with its own wrapper; nothing here reaches the
network by any other route, and only under `--fetch`.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import re
import shlex
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# The stem of a run directory: `run-131` is run 131. The census orders by that
# number, not by the name — `run-9` sorts ahead of `run-131`.
RUN_DIR_RE = re.compile(r"^run-(\d+)$")

RECORD_NAME = "gate-verdicts.json"
STATUS_NAME = "status.json"
REPORT_NAME = "report.json"

#: The table's columns, in order. The first line of `--from` output is exactly
#: these names, tab-separated.
COLUMNS = (
    "run",
    "authoring_min",
    "probes",
    "dispatched",
    "rejected",
    "routing",
    "lane",
    "questions",
    "recommended_picked",
    "run_min",
    "amendments",
    "compelled",
    "plan_fault",
    "magnitude",
    "explain_rounds",
)

#: What a column prints when the run's files do not carry it.
MISSING = "-"

#: The reading at or above which an amendment counts as compelled, or as the
#: plan's fault — #1095's own threshold, on #1095's own numbers.
JEV_THRESHOLD = 0.7

#: The four levels a magnitude reads as: cosmetic (0), local (1), substantive
#: (2), reframed (3).
JEV_BUCKETS = 4


def _load_json(path):
    """The JSON at `path`, or None when it is absent or unreadable.

    A malformed record is read as a record that is not there: the census is a
    reading tool over a release's leavings, and one run's bad file is not this
    script's to raise over."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def _obj(value):
    """`value` when it is a JSON object, else an empty one."""
    return value if isinstance(value, dict) else {}


def _run_minutes(status):
    """Whole minutes, rounded down, from `startedAt` to `updatedAt`.

    The contract's shape (`fleet/CONTRACT.md`): both are ISO-8601 with a `Z`
    suffix, which `datetime.fromisoformat` reads once the `Z` is spelled
    `+00:00`. None when either stamp is absent or unparseable."""
    started, updated = status.get("startedAt"), status.get("updatedAt")
    if not isinstance(started, str) or not isinstance(updated, str):
        return None
    try:
        a = datetime.fromisoformat(started.replace("Z", "+00:00"))
        b = datetime.fromisoformat(updated.replace("Z", "+00:00"))
    except ValueError:
        return None
    return int((b - a).total_seconds() // 60)


def _amendments(report):
    """How many amendments the run's workers made, from its `report.json`.

    The report's top-level `amendments` is a list of `{task, amends, what,
    why}` rows, `[]` when none — so the count is that list's length. None when
    the file is absent, unreadable, not an object, or carries no list under
    that key: every run before the plan that introduced the key reads `-`,
    never `0`, because a run that never wrote the key is not a run that made
    no amendment."""
    if not isinstance(report, dict):
        return None
    amendments = report.get("amendments")
    if not isinstance(amendments, list):
        return None
    return len(amendments)


def _number(value):
    """`value` as a float when it is a JSON number, else None. A boolean is
    not a number here: `true` is not a reading."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _bucket(magnitude):
    """Which of the four levels a `magnitude` reads as.

    `min(3, max(0, floor(x + 0.5)))`, spelled out rather than handed to
    `round`, which is banker's in Python and would read 1.5 as local where
    #1095 reads it as substantive. A `magnitude` that is not a number buckets
    as cosmetic: the row was answered, so it counts in `R`, and 0 is the
    reading that claims least."""
    number = _number(magnitude)
    if number is None:
        return 0
    return min(JEV_BUCKETS - 1, max(0, int(math.floor(number + 0.5))))


def jev_cells(report):
    """One run's three amendment-reading cells: `((k, R), (p, R), (c0, c1, c2,
    c3))`, or None when the run carries no amendments list.

    `R` is the rows of `report.amendments` that carry a `jev` object; a row
    whose `jev` is null, absent, or not an object was never read and is no part
    of any denominator. `k` and `p` are the read rows whose `compelled` and
    `plan_fault` reach the threshold, and `c<b>` counts the read rows in each
    magnitude bucket, so the four sum to `R`.

    None, not zeros, when the report is absent, unreadable, not an object, or
    carries no list under `amendments` — the same reading `_amendments` makes,
    and for the same reason: a run that wrote no list read nothing, which is
    not a reading of none. A list with no `jev` row did write one, and reads
    `0/0` and `0/0/0/0`."""
    if not isinstance(report, dict):
        return None
    amendments = report.get("amendments")
    if not isinstance(amendments, list):
        return None
    read = [row.get("jev") for row in amendments if isinstance(row, dict)]
    read = [jev for jev in read if isinstance(jev, dict)]
    compelled = plan_fault = 0
    buckets = [0] * JEV_BUCKETS
    for jev in read:
        value = _number(jev.get("compelled"))
        if value is not None and value >= JEV_THRESHOLD:
            compelled += 1
        value = _number(jev.get("plan_fault"))
        if value is not None and value >= JEV_THRESHOLD:
            plan_fault += 1
        buckets[_bucket(jev.get("magnitude"))] += 1
    return (compelled, len(read)), (plan_fault, len(read)), tuple(buckets)


def _questions(authoring):
    """The record's questions as a list of objects."""
    questions = authoring.get("questions")
    if not isinstance(questions, list):
        return []
    return [_obj(q) for q in questions]


def _picks(question):
    """A question's picks as a list: `picked` is one option, or a list of them
    for a multi-select question (#1189) — one row, one question, either way."""
    picked = question.get("picked")
    return picked if isinstance(picked, list) else [picked]


def _recommended_picked(questions):
    """`(picked, offered)` — the questions that carried a recommended option,
    and those of them whose picks include that option. A question with a null
    `recommended` offered no recommendation and counts in neither."""
    offered = [q for q in questions if q.get("recommended") is not None]
    picked = [q for q in offered if q.get("recommended") in _picks(q)]
    return len(picked), len(offered)


def _explain_rounds(questions):
    """The sum of every row's `explain_rounds` — absent, or not an int,
    counts 0 (#526)."""
    total = 0
    for q in questions:
        value = q.get("explain_rounds")
        if isinstance(value, int) and not isinstance(value, bool):
            total += value
    return total


def census_rows(root):
    """One row per `run-<N>` directory under `root` that holds a record.

    Each row carries the column values, with None where the run's files do not
    carry one, plus the raw question list the register prints from. A record
    older than this plan has no `authoring` key: its row is None in every
    authoring column, and only `dispatched`/`rejected` — which the tally has
    always carried — read."""
    root = Path(root)
    found = []
    try:
        entries = sorted(root.iterdir())
    except OSError:
        return []
    for entry in entries:
        match = RUN_DIR_RE.match(entry.name)
        if not match or not entry.is_dir():
            continue
        record = _load_json(entry / RECORD_NAME)
        if not isinstance(record, dict):
            continue
        found.append((int(match.group(1)), entry, record))

    rows = []
    for number, directory, record in sorted(found, key=lambda item: item[0]):
        tally = _obj(record.get("tally"))
        authoring = record.get("authoring")
        has_authoring = isinstance(authoring, dict)
        authoring = _obj(authoring)
        routing = _obj(authoring.get("routing"))
        questions = _questions(authoring) if has_authoring else []

        status = _load_json(directory / STATUS_NAME)
        run_min = _run_minutes(status) if isinstance(status, dict) else None
        report = _load_json(directory / REPORT_NAME)
        amendments = _amendments(report)
        jev = jev_cells(report)

        rows.append({
            "run": number,
            "authoring_min": authoring.get("minutes") if has_authoring else None,
            "probes": authoring.get("probes") if has_authoring else None,
            "dispatched": tally.get("dispatched"),
            "rejected": tally.get("rejected"),
            "routing": routing.get("branch") if has_authoring else None,
            "lane": routing.get("lane") if has_authoring else None,
            "questions": len(questions) if has_authoring else None,
            "recommended_picked": (
                _recommended_picked(questions) if has_authoring else None),
            "run_min": run_min,
            "amendments": amendments,
            "compelled": jev[0] if jev is not None else None,
            "plan_fault": jev[1] if jev is not None else None,
            "magnitude": jev[2] if jev is not None else None,
            "explain_rounds": (
                _explain_rounds(questions) if has_authoring else None),
            "questions_detail": questions,
        })
    return rows


def _cell(value):
    """A column's text: `-` for what the run's files do not carry.

    A tuple prints slash-separated, however long it is — `<k>/<R>` for a
    ratio, `<c0>/<c1>/<c2>/<c3>` for the four magnitude buckets."""
    if value is None:
        return MISSING
    if isinstance(value, tuple):
        return "/".join("%d" % part for part in value)
    return str(value)


def _sum(rows, key):
    """The sum of `key` over the rows that carry it."""
    return sum(row[key] for row in rows
               if isinstance(row.get(key), int) and not isinstance(row[key], bool))


def _window(rows):
    """The runs the census was read over: `<lowest>..<highest>`, `-` when no
    row was found. `census_rows` sorts by run number, so the ends are the
    first and last row."""
    if not rows:
        return MISSING
    return "%d..%d" % (rows[0]["run"], rows[-1]["run"])


def _totals_line(rows):
    """The table's last line: the release read as one number per question,
    over the window of runs it read (`runs=`, after `plans=`).

    `risk_override` is over the rows that carry a routing record at all — a
    pre-plan record has no branch and is no part of the denominator — and the
    two `recommended_picked` sums are over every row. `amendments` sums the
    rows that carry a count; a release where no run wrote one reads 0. The
    three reading fields sum the same way over every row that carries a
    reading, so a release where none did reads `0/0` and `0/0/0/0` — the empty
    sums, which is what the release notes' line says when nothing was read.
    `explain_rounds`, last, sums `census_rows`'s per-row sums (#526)."""
    routed = [row for row in rows if row["routing"] is not None]
    risk = [row for row in routed if row["routing"] == "risk"]
    picked = offered = 0
    for row in rows:
        if row["recommended_picked"] is not None:
            p, q = row["recommended_picked"]
            picked += p
            offered += q
    compelled = plan_fault = read = 0
    buckets = [0] * JEV_BUCKETS
    for row in rows:
        if row["compelled"] is not None:
            k, r = row["compelled"]
            compelled += k
            read += r
        if row["plan_fault"] is not None:
            plan_fault += row["plan_fault"][0]
        if row["magnitude"] is not None:
            for index, count in enumerate(row["magnitude"]):
                buckets[index] += count
    return ("totals: plans=%d runs=%s risk_override=%d/%d "
            "recommended_picked=%d/%d authoring_min=%d run_min=%d "
            "amendments=%d compelled=%d/%d plan_fault=%d/%d "
            "magnitude=%d/%d/%d/%d explain_rounds=%d"
            % (len(rows), _window(rows), len(risk), len(routed),
               picked, offered,
               _sum(rows, "authoring_min"), _sum(rows, "run_min"),
               _sum(rows, "amendments"),
               compelled, read, plan_fault, read, *buckets,
               _sum(rows, "explain_rounds")))


def render_table(rows):
    """The census as tab-separated text: header, one line per run, totals."""
    lines = ["\t".join(COLUMNS)]
    for row in rows:
        lines.append("\t".join(_cell(row[name]) for name in COLUMNS))
    lines.append(_totals_line(rows))
    return "\n".join(lines)


def render_register(rows):
    """One line per option of every question, in row then question then option
    order (#735): `run-<N>  q<i>  <question>  <option>  <rec|->  <picked|->`.

    The register is the fixed record of what was offered, not a summary of what
    was chosen — every option gets its line whether or not anyone looked at it,
    and a question with no recommended option prints `-` in that column on all
    of them."""
    lines = []
    for row in rows:
        for index, question in enumerate(row["questions_detail"], start=1):
            options = question.get("options")
            if not isinstance(options, list):
                continue
            recommended = question.get("recommended")
            picked = _picks(question)
            for option in options:
                lines.append("\t".join([
                    "run-%d" % row["run"],
                    "q%d" % index,
                    str(question.get("question", "")),
                    str(option),
                    "rec" if recommended is not None and option == recommended
                    else MISSING,
                    "picked" if option is not None and option in picked
                    else MISSING,
                ]))
    return "\n".join(lines)


# --- --fetch: the two tags a run leaves behind -----------------------------

def _contents(target, path, ref):
    """The `gh api` path for one file at one ref."""
    return "repos/%s/contents/%s?ref=%s" % (target, path, ref)


def _fetch_file(gh, target, path, ref):
    """The bytes of one file at one ref, or None when `gh` exits non-zero.

    `gh api …/contents/…` answers JSON whose `content` is base64 with embedded
    newlines, so the decode is over the whole string. The call names exactly
    two arguments — `api` and the contents path — so a caller's wrapper sees
    the same shape the real binary does."""
    proc = subprocess.run(
        gh + ["api", _contents(target, path, ref)],
        capture_output=True, text=True)
    if proc.returncode != 0:
        return None
    try:
        answer = json.loads(proc.stdout)
    except ValueError:
        return None
    content = _obj(answer).get("content")
    if not isinstance(content, str):
        return None
    try:
        return base64.b64decode(content)
    except (ValueError, TypeError):
        return None


def fetch_runs(target, first, last, into, gh="gh"):
    """Fill `into` with `run-<N>/gate-verdicts.json`, `run-<N>/status.json` and
    `run-<N>/report.json` for each N from `first` to `last` inclusive; return
    the runs written.

    The plan tag `ultra/plan/run-<N>` carries the record and the evidence tag
    `ultra/evidence/run-<N>` carries both the status and the report. A run
    whose plan tag has no record is skipped whole — one line on stderr, nothing
    written for it, no directory left behind — because a run with no record is
    no row. A status that does not answer leaves that file unwritten and the
    row's `run_min` a `-`, and a report that does not answer leaves that file
    unwritten and the row's `amendments` a `-`: the authoring numbers are still
    worth reading without either."""
    into = Path(into)
    # The destination exists whether or not any run answers: a release where
    # every tag is missing is an empty census, not a usage error.
    into.mkdir(parents=True, exist_ok=True)
    command = shlex.split(gh) if isinstance(gh, str) else list(gh)
    written = []
    for number in range(int(first), int(last) + 1):
        record = _fetch_file(
            command, target, ".ultrapowers/gate-verdicts.json",
            "ultra/plan/run-%d" % number)
        if record is None:
            print("census: run %d has no gate record at ultra/plan/run-%d "
                  "— skipped" % (number, number), file=sys.stderr)
            continue
        directory = into / ("run-%d" % number)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / RECORD_NAME).write_bytes(record)
        status = _fetch_file(
            command, target, ".ultrapowers/runs/%d/status.json" % number,
            "ultra/evidence/run-%d" % number)
        if status is not None:
            (directory / STATUS_NAME).write_bytes(status)
        report = _fetch_file(
            command, target, ".ultrapowers/runs/%d/report.json" % number,
            "ultra/evidence/run-%d" % number)
        if report is not None:
            (directory / REPORT_NAME).write_bytes(report)
        written.append(number)
    return written


RUNS_RE = re.compile(r"^(\d+)\.\.(\d+)$")


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Read a release's runs into one table: what authoring "
                    "cost beside what the run cost.")
    ap.add_argument("--from", dest="root", metavar="DIR",
                    help="directory holding `run-<N>/gate-verdicts.json` files")
    ap.add_argument("--register", action="store_true",
                    help="print one line per option of every question "
                         "instead of the table")
    ap.add_argument("--fetch", metavar="OWNER/REPO",
                    help="fill --into from this repository's run tags, "
                         "then print the table over it")
    ap.add_argument("--runs", metavar="A..B",
                    help="the inclusive run range to fetch")
    ap.add_argument("--into", metavar="DIR",
                    help="where --fetch writes the runs it reads")
    ap.add_argument("--gh", default="gh",
                    help="the gh binary (or command) to run; default `gh`")
    args = ap.parse_args(argv)

    if args.fetch:
        if not args.runs or not args.into:
            print("census: --fetch needs --runs <A>..<B> and --into <dir>",
                  file=sys.stderr)
            return 1
        match = RUNS_RE.match(args.runs)
        if not match:
            print("census: --runs takes `<A>..<B>`, not `%s`" % args.runs,
                  file=sys.stderr)
            return 1
        first, last = int(match.group(1)), int(match.group(2))
        if first > last:
            print("census: --runs `%s` counts backwards" % args.runs,
                  file=sys.stderr)
            return 1
        fetch_runs(args.fetch, first, last, Path(args.into), args.gh)
        root = Path(args.into)
    elif args.root:
        root = Path(args.root)
    else:
        print("census: give --from <dir> or --fetch <owner>/<repo>",
              file=sys.stderr)
        return 1

    if not root.is_dir():
        print("census: no such directory `%s`" % root, file=sys.stderr)
        return 1

    rows = census_rows(root)
    print(render_register(rows) if args.register else render_table(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
