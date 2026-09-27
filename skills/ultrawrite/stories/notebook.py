#!/usr/bin/env python3
"""The operator notebook: a private file, read at the start of every planning
session, that learns the operator's words. Outside every repo on purpose."""
import argparse
import datetime
import os
import sys

SECTIONS = {
    "worked": "## Words that worked",
    "failed": "## Words that failed",
    "lands": "## Explanations that land",
    "author": "## The author decides",
    "retired": "## Retired questions",
    "readings": "## Plan readings",
}
SEED = """# Operator notebook

Read at the start of every planning session. Every *Please explain*, every
edited word and every mark on a preview adds a line.

## Words that worked

## Words that failed

- 2026-09-27: "probe" needed its definition first; lead with "the check a plan runs".

## Explanations that land

- 2026-09-27: A concrete before-and-after example lands where abstract words didn't.
- 2026-09-27: A visual explainer page helps when a mechanism is unfamiliar.
- 2026-09-27: When a design changes quickly, show the old shape beside the new one.

## The author decides

- 2026-09-27: Filing and plumbing details are the author's to decide; the operator decides what the app does and how it looks.

## Retired questions

## Plan readings
"""


def path():
    home = os.environ.get("ULTRAPOWERS_HOME", os.path.expanduser("~/.ultrapowers"))
    return os.path.join(home, "notebook.md")


def ensure():
    p = path()
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(SEED)
    return p


def add(section_key, text, date):
    p = ensure()
    heading = SECTIONS[section_key]
    with open(p, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    i = lines.index(heading) + 1
    while i < len(lines) and not lines[i].startswith("## "):
        i += 1
    while i > 0 and lines[i - 1] == "":
        i -= 1
    lines.insert(i, "- %s: %s" % (date, text))
    if i + 1 < len(lines) and lines[i + 1].startswith("## "):
        lines.insert(i + 1, "")
    with open(p, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def log_plan(plan_id, rounds, marks, explains, edits, date):
    add("readings", "%s: rounds %d, marks %d, please-explain %d, stories edited after preview %d"
        % (plan_id, rounds, marks, explains, edits), date)


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    a = sub.add_parser("add")
    a.add_argument("section")
    a.add_argument("text")
    l = sub.add_parser("log")
    l.add_argument("plan_id")
    for k in ("rounds", "marks", "explains", "edits"):
        l.add_argument("--" + k, type=int, required=True)
    args = ap.parse_args(argv)
    today = datetime.date.today().isoformat()
    if args.cmd == "show":
        with open(ensure(), encoding="utf-8") as fh:
            sys.stdout.write(fh.read())
    elif args.cmd == "add":
        if args.section not in SECTIONS or args.section == "readings":
            sys.stderr.write("notebook: section must be one of worked, failed, lands, author, retired\n")
            return 2
        add(args.section, args.text, today)
    else:
        log_plan(args.plan_id, args.rounds, args.marks, args.explains, args.edits, today)
    return 0


if __name__ == "__main__":
    sys.exit(main())
