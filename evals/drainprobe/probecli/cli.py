"""Tiny report CLI: parse args, list rows, print them.

Measurement payload for the #454 concurrent-drain arms (sitting 2, map #360).
A deliberate clone of evals/fixtures/contend's clitool, no longer wired into
the plugin's test suite (its smoke test went with #612). Not plugin machinery.
"""
import argparse

ROWS = [("ada", 3), ("bob", 5), ("eve", 1)]


def build_parser():
    parser = argparse.ArgumentParser(prog="report")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    rows = list(ROWS)
    for name, count in rows:
        print("%s %d" % (name, count))
    return 0
