"""Tiny report CLI: parse args, list rows, print them. Reference solution."""
import argparse
import json


ROWS = [("ada", 3), ("bob", 5), ("eve", 1)]


def build_parser():
    parser = argparse.ArgumentParser(prog="report")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--format", choices=["plain", "csv"], default="plain")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--sort", action="store_true")
    parser.add_argument("--reverse", action="store_true")
    parser.add_argument("--total", action="store_true")
    parser.add_argument("--header", action="store_true")
    parser.add_argument("--json", action="store_true")
    return parser


def header(n):
    return "rows: %d" % n


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


def sort_rows(rows):
    return sorted(rows, key=lambda row: row[0])


def reverse_rows(rows):
    return list(rows)[::-1]


def total(rows):
    return sum(count for _, count in rows)


def column_header():
    return "name count"


def to_json(rows):
    return json.dumps([{"name": name, "count": count} for name, count in rows])


def main(argv=None):
    args = build_parser().parse_args(argv)
    rows = list(ROWS)
    if args.sort:
        rows = sort_rows(rows)
    if args.reverse:
        rows = reverse_rows(rows)
    rows = clamp(rows, args.limit)
    if args.verbose:
        print(header(len(rows)))
    if args.header:
        print(column_header())
    if args.json:
        print(to_json(rows))
    else:
        for row in rows:
            print(render(row, args.format))
    if args.total:
        print("total: %d" % total(rows))
    return 0
