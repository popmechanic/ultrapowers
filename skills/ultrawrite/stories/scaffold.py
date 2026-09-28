#!/usr/bin/env python3
"""Write the starting app a stories-v1 launch builds on.

    scaffold.py <bundle> <dir>

The template (given code), the bundle's signed store module at
client/src/store.js, and one stub screen per piece, which the Flock's builders
replace. Refuses a directory that holds anything but .git."""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bundle import load_bundle  # noqa: E402

TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tinyapp-template")
STORE = "client/src/store.js"
STUB = '''import type {MergeableStore} from 'tinybase';

type Tools = Record<string, (args: Record<string, unknown>) => boolean>;

// The %s piece's screen. A builder writes this file.
export function mount(root: HTMLElement, store: MergeableStore, tools: Tools): void {}
'''


def main(argv):
    if len(argv) != 2:
        print("usage: scaffold.py <bundle> <dir>")
        return 2
    b = load_bundle(argv[0])
    dst = os.path.abspath(argv[1])
    if b["page"]["store"] != STORE:
        print("scaffold: the page's store must be %s, not %s" % (STORE, b["page"]["store"]))
        return 2
    if os.path.isdir(dst) and [n for n in os.listdir(dst) if n != ".git"]:
        print("scaffold: %s is not empty" % dst)
        return 2
    shutil.copytree(TEMPLATE, dst, dirs_exist_ok=True)
    shutil.copyfile(os.path.join(b["dir"], "store.js"), os.path.join(dst, STORE))
    pieces = [c["piece"] for c in b["cards"]]
    pdir = os.path.join(dst, "client", "src", "pieces")
    os.makedirs(pdir, exist_ok=True)
    with open(os.path.join(pdir, "index.ts"), "w", encoding="utf-8") as fh:
        for p in pieces:
            fh.write("import * as %s from './%s';\n" % (p, p))
        fh.write("\nexport const PIECES = [%s] as const;\n" % ", ".join("['%s', %s]" % (p, p) for p in pieces))
    for p in pieces:
        with open(os.path.join(pdir, p + ".ts"), "w", encoding="utf-8") as fh:
            fh.write(STUB % p)
    print("SCAFFOLDED %s: pieces %s" % (dst, ", ".join(pieces)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
