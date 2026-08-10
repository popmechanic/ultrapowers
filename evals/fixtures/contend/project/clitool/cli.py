"""Tiny report CLI: parse args, list rows, print them."""
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
