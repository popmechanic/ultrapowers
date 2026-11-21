#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import re
import shlex
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
from plan_check import explain_rounds, picks, recommended_picked  # noqa: E402

RUN_DIR_RE = re.compile(r"^run-(\d+)$")

RECORD_NAME = "gate-verdicts.json"
STATUS_NAME = "status.json"

COLUMNS = (
    "run",
    "authoring_min",
    "dispatched",
    "rejected",
    "routing",
    "lane",
    "questions",
    "recommended_picked",
    "run_min",
    "explain_rounds",
)

MISSING = "-"


def _load_json(path):
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def _obj(value):
    return value if isinstance(value, dict) else {}


def _run_minutes(status):
    started, updated = status.get("startedAt"), status.get("updatedAt")
    if not isinstance(started, str) or not isinstance(updated, str):
        return None
    try:
        a = datetime.fromisoformat(started.replace("Z", "+00:00"))
        b = datetime.fromisoformat(updated.replace("Z", "+00:00"))
    except ValueError:
        return None
    return int((b - a).total_seconds() // 60)


def _questions(authoring):
    questions = authoring.get("questions")
    if not isinstance(questions, list):
        return []
    return [_obj(q) for q in questions]


def census_rows(root):
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

        rows.append({
            "run": number,
            "authoring_min": authoring.get("minutes") if has_authoring else None,
            "dispatched": tally.get("dispatched"),
            "rejected": tally.get("rejected"),
            "routing": routing.get("branch") if has_authoring else None,
            "lane": routing.get("lane") if has_authoring else None,
            "questions": len(questions) if has_authoring else None,
            "recommended_picked": (
                recommended_picked(questions) if has_authoring else None),
            "run_min": run_min,
            "explain_rounds": (
                explain_rounds(questions) if has_authoring else None),
            "questions_detail": questions,
        })
    return rows


def _cell(value):
    if value is None:
        return MISSING
    if isinstance(value, tuple):
        return "/".join("%d" % part for part in value)
    return str(value)


def _sum(rows, key):
    return sum(row[key] for row in rows
               if isinstance(row.get(key), int) and not isinstance(row[key], bool))


def _window(rows):
    if not rows:
        return MISSING
    return "%d..%d" % (rows[0]["run"], rows[-1]["run"])


def _totals_line(rows):
    routed = [row for row in rows if row["routing"] is not None]
    risk = [row for row in routed if row["routing"] == "risk"]
    picked = offered = 0
    for row in rows:
        if row["recommended_picked"] is not None:
            p, q = row["recommended_picked"]
            picked += p
            offered += q
    return ("totals: plans=%d runs=%s risk_override=%d/%d "
            "recommended_picked=%d/%d authoring_min=%d run_min=%d "
            "explain_rounds=%d"
            % (len(rows), _window(rows), len(risk), len(routed),
               picked, offered,
               _sum(rows, "authoring_min"), _sum(rows, "run_min"),
               _sum(rows, "explain_rounds")))


def render_table(rows):
    lines = ["\t".join(COLUMNS)]
    for row in rows:
        lines.append("\t".join(_cell(row[name]) for name in COLUMNS))
    lines.append(_totals_line(rows))
    return "\n".join(lines)


def render_register(rows):
    lines = []
    for row in rows:
        for index, question in enumerate(row["questions_detail"], start=1):
            options = question.get("options")
            if not isinstance(options, list):
                continue
            recommended = question.get("recommended")
            picked = picks(question)
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


def _slug(target):
    return target.replace("/", "-")


def run_tag(target, number):
    return "%s/run-%d" % (_slug(target), int(number))


def evidence_contents_path(evidence, target, number, name):
    return "repos/%s/contents/runs/%s/%d/%s?ref=%s" % (
        evidence, _slug(target), int(number), name, run_tag(target, number))


def _fetch_file(gh, path):
    proc = subprocess.run(
        gh + ["api", path],
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


def fetch_runs(target, first, last, into, gh="gh", *, evidence):
    into = Path(into)
    into.mkdir(parents=True, exist_ok=True)
    command = shlex.split(gh) if isinstance(gh, str) else list(gh)
    written = []
    for number in range(int(first), int(last) + 1):
        record = _fetch_file(command, evidence_contents_path(
            evidence, target, number, RECORD_NAME))
        if record is None:
            print("census: run %d has no gate record at %s in %s — skipped"
                  % (number, run_tag(target, number), evidence),
                  file=sys.stderr)
            continue
        directory = into / ("run-%d" % number)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / RECORD_NAME).write_bytes(record)
        status = _fetch_file(command, evidence_contents_path(
            evidence, target, number, STATUS_NAME))
        if status is not None:
            (directory / STATUS_NAME).write_bytes(status)
        written.append(number)
    return written


RUNS_RE = re.compile(r"^(\d+)\.\.(\d+)$")

DEFAULT_CONFIG = "~/.ultrapowers/fleet.json"


def _configured_evidence(config):
    try:
        setting = json.loads(Path(config).expanduser().read_text())
    except (OSError, ValueError):
        return None
    value = _obj(setting).get("evidence")
    return value if isinstance(value, str) and value.strip() else None


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
    ap.add_argument("--evidence-repo", metavar="OWNER/REPO",
                    help="the evidence repository --fetch reads run folders "
                         "from; default the `evidence` key of --config")
    ap.add_argument("--config", metavar="PATH", default=DEFAULT_CONFIG,
                    help="the operator's setting file; default "
                         "`~/.ultrapowers/fleet.json`")
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
        evidence = args.evidence_repo or _configured_evidence(args.config)
        if not evidence:
            print("census: no evidence repository — give --evidence-repo "
                  "<owner>/<repo> or set the `evidence` key in %s"
                  % args.config, file=sys.stderr)
            return 2
        fetch_runs(args.fetch, first, last, Path(args.into), args.gh,
                   evidence=evidence)
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
