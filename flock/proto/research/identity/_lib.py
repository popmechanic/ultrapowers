"""Shared imports for the ticket-2 readings (map #1292, #359). The vendored
kernel is imported, never modified; the keeper is flock/proto/weave.py."""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROTO = os.path.normpath(os.path.join(HERE, "..", ".."))
TREE = os.path.normpath(os.path.join(PROTO, "..", ".."))
KERNEL = os.path.join(TREE, "skills", "ultrapowers", "kernel")
sys.path[:0] = [PROTO, KERNEL, os.path.join(KERNEL, "vendor")]

import manyana as M  # noqa: E402
import fold_wave  # noqa: E402
import weave as W  # noqa: E402


def keeper(files):
    """A Keeper whose BASE is `files` {path: [line]}, read from memory."""
    k = W.Keeper()
    for p, lines in files.items():
        k.base[p] = M.initial_state(list(lines))
    return k


def read(path):
    with open(os.path.join(TREE, path), encoding="utf-8") as f:
        return f.read().split("\n")
