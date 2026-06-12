import sys

from ledger.parse import parse_line
from ledger.report import format_report


def main(argv):
    try:
        entries = []
        with open(argv[0]) as f:
            for line in f:
                if line.strip():
                    entries.append(parse_line(line.strip()))
        print(format_report(entries))
        return 0
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
