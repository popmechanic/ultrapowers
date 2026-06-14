#!/usr/bin/env python3
"""Canonical content hash of a sealed acceptance suite directory.

sha256 over (relative-path, file-bytes) pairs in sorted order: the same suite
hashes identically regardless of machine, vault location, or copy. This file
is the ONLY hash implementation — the sealing author and run_acceptance.sh
both call it (spec: docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md).
"""
import hashlib
import pathlib
import sys


def suite_hash(directory):
    root = pathlib.Path(directory)
    h = hashlib.sha256()
    for f in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = f.relative_to(root).as_posix()
        h.update(rel.encode() + b"\0" + f.read_bytes() + b"\0")
    return h.hexdigest()


if __name__ == "__main__":
    print(suite_hash(sys.argv[1]))
