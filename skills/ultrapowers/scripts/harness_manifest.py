#!/usr/bin/env python3
"""The single runtime reader of the *.harness.json manifest schema.

Consumers: hooks/session_start.sh (via the CLI, lax) and the eval kit's
seed_workflows (via scan(), fail-closed). A schema change edits scan() here
plus the test-side pin in tests/test_harness_registry.py.
Spec: docs/superpowers/specs/2026-08-10-eval-kit-reader-consolidation-design.md
"""
import json
import sys
from pathlib import Path


def scan(harness_dir):
    """Return (files, problems) for the *.harness.json manifests under
    harness_dir, in manifest-filename order.

    files: each manifest's `file` value, for manifests that parse, carry a
    `file` key, and whose backing file exists beside them. problems: one
    line per manifest failing any of those checks. Never raises.

    Backward tolerance is part of this contract: the eval kit reads
    manifests inside PINNED older-engine worktrees with the checkout's
    scan(), so a schema migration must EXTEND the accepted forms, never replace
    them — only a manifest unreadable under ANY known form is a
    problem. Otherwise the first schema change makes every pre-change
    engine ref hard-fail in the kit.
    """
    harness_dir = Path(harness_dir)
    files, problems = [], []
    for manifest in sorted(harness_dir.glob("*.harness.json")):
        try:
            fname = json.loads(manifest.read_text()).get("file")
        except Exception:
            problems.append("%s: unparseable JSON" % manifest.name)
            continue
        if not fname:
            problems.append("%s: missing `file` key" % manifest.name)
            continue
        if not (harness_dir / fname).is_file():
            problems.append("%s: backing file %s absent" % (manifest.name, fname))
            continue
        files.append(fname)
    return files, problems


if __name__ == "__main__":
    files, problems = scan(sys.argv[1])
    for line in problems:
        print(line, file=sys.stderr)   # never stdout: the hook word-splits stdout
    for line in files:
        print(line)
