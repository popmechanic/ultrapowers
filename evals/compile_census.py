#!/usr/bin/env python3
"""A one-line-per-fixture digest of what a compiler makes of the fixture corpus.

    compile_census.py <path-to-compile_plan.py>

Every directory under `evals/fixtures/` that carries a `plan.md` is compiled
plainly — no `--check`, no flags — with the compiler at the given path, and one
line is printed per fixture, sorted by directory name:

    <fixture directory name> <sha256 of the scheduling shape>

The shape is `json.dumps([waves, dag_edges, launch_waves], sort_keys=True)` over
that compile's JSON: the waves, the edges between them, and the launch waves —
everything a plan compiles TO, and nothing about how the compile narrated
itself. Two compilers that print the same thirteen lines schedule every fixture
identically, which is what a refactor of the compiler has to show:

    python3 evals/compile_census.py <base-blob> > base.txt
    python3 evals/compile_census.py skills/ultrapowers/scripts/compile_plan.py > new.txt
    diff base.txt new.txt

A fixture whose compile fails, or whose JSON is missing any of the three keys,
is not a difference to be diffed — it is a broken measurement, so the census
exits 1 with that fixture's directory name on stderr rather than printing a
digest of a shape it did not get.

The compiler resolves `PLUGIN_ROOT` as `parents[3]` of its own file at import,
so a blob dropped at a shallow path cannot import. The census therefore copies
the file it is given into `<tmpdir>/a/b/c/compile_plan.py` and runs the copy:
the compiler imports only the standard library, so a copy at that depth needs
no sibling.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "evals/fixtures"
SHAPE_KEYS = ("waves", "dag_edges", "launch_waves")


def fixture_plans():
    """Every `evals/fixtures/*/plan.md`, sorted by directory name."""
    return sorted(FIXTURES.glob("*/plan.md"), key=lambda p: p.parent.name)


def shape_digest(compiler, plan):
    """The sha256 of the scheduling shape `compiler` gives `plan`.

    Raises `RuntimeError` when the compile fails or its JSON carries none of
    a key — the caller turns either into the same exit-1 line."""
    p = subprocess.run([sys.executable, str(compiler), str(plan)],
                       capture_output=True, text=True, cwd=str(ROOT))
    if p.returncode != 0:
        raise RuntimeError("compile exited %d: %s"
                           % (p.returncode, p.stderr.strip()))
    try:
        compiled = json.loads(p.stdout)
    except ValueError as e:
        raise RuntimeError("compile printed no JSON (%s)" % e)
    missing = [k for k in SHAPE_KEYS if k not in compiled]
    if missing:
        raise RuntimeError("compiled JSON lacks %s" % ", ".join(missing))
    shape = json.dumps([compiled[k] for k in SHAPE_KEYS], sort_keys=True)
    return hashlib.sha256(shape.encode("utf-8")).hexdigest()


def census(compiler):
    """One `<name> <digest>` line per fixture, in sorted directory order."""
    with tempfile.TemporaryDirectory() as tmp:
        deep = Path(tmp) / "a" / "b" / "c"
        deep.mkdir(parents=True)
        copy = deep / "compile_plan.py"
        shutil.copyfile(str(compiler), str(copy))
        lines = []
        for plan in fixture_plans():
            name = plan.parent.name
            try:
                lines.append("%s %s" % (name, shape_digest(copy, plan)))
            except RuntimeError as e:
                sys.exit("%s: %s" % (name, e))
        return lines


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("compiler", type=Path,
                    help="the compile_plan.py whose compiles are censused")
    args = ap.parse_args(argv)
    if not args.compiler.is_file():
        sys.exit("error: %s is not a file" % args.compiler)
    for line in census(args.compiler):
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
