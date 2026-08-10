"""Tiny report CLI: parse args, list rows, print them. Reference solution."""
import argparse

ROWS = [("ada", 3), ("bob", 5), ("eve", 1)]


def build_parser():
    parser = argparse.ArgumentParser(prog="report")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--format", choices=["plain", "csv"], default="plain")
    parser.add_argument("--limit", type=int, default=None)
    return parser


def render(row, fmt):
    name, count = row
    if fmt == "csv":
        return "%s,%d" % (name, count)
    return "%s %d" % (name, count)


def clamp(rows, limit):
    if limit is None:
        return list(rows)
    if limit < 0:
        raise ValueError("limit must be >= 0")
    return list(rows)[:limit]


def main(argv=None):
    args = build_parser().parse_args(argv)
    rows = clamp(ROWS, args.limit)
    if args.verbose:
        print("rows: %d" % len(rows))
    for row in rows:
        print(render(row, args.format))
    return 0
