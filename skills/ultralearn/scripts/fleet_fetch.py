#!/usr/bin/env python3
"""ultralearn fleet fetcher — list and pull `sandbox-logs.tgz` evidence bundles
from the orchestrator host. Read-only, and advisory per item: a missing bundle
or a failed copy is skipped with a diagnostic, never raised.

The top-level lookup is NOT advisory (#489). "I could not ask" and "I asked and
the root was empty" are different facts, and spelled as two empty lists they read
identically downstream — which is how the pre-#466 `DEFAULT_REMOTE_ROOT` ghost
path read as "no runs" for a whole census. `lookup_remote_bundles` raises
`FailedLookup` for the first and returns `[]` for the second, and the CLI turns
that into exit 2 + `FAILED-LOOKUP:` versus exit 0 + `LOOKED-EMPTY:`.
"""
from __future__ import annotations

import argparse
import re
import shlex
import subprocess
import sys
from pathlib import Path

from _outcome import FailedLookup, report_failed_lookup, report_looked_empty

# Must track `DEFAULTS.evidenceDir` in fleet/drive-one.mjs — the same directory
# named twice, in two languages (#466). Pinned by tests/test_fleet_fetch.py,
# because the drift was SILENT before #489: `ls` on a missing dir listed nothing
# and a sense pass read zero bundles as "no runs". A missing root now raises.
DEFAULT_REMOTE_ROOT = "/home/exedev/fleet-evidence/sandbox-logs"

# group 1 is the run number, so `fleet-run-30-1788131392373` yields `run-30`.
# `\S` admits `;`, `$` and backticks, which reach a remote shell through an
# scp path. Bundle names are machine-generated, so spell out the alphabet.
_BUNDLE = re.compile(r"^fleet-run-([A-Za-z0-9._-]+?)-\d+$")

_CONNECT_TIMEOUT = "ConnectTimeout=20"
_LIST_TIMEOUT = 60      # seconds; a directory listing is cheap
_COPY_TIMEOUT = 600     # seconds; the whole corpus is ~11 MB

# ssh reserves 255 for its own failures (no route, auth refused, DNS); anything
# else non-zero came back from the remote `ls`, i.e. the host answered and the
# root is what is wrong. Two causes, two messages.
_SSH_FAILED = 255


def _warn(msg):
    print(f"fleet_fetch: {msg}", file=sys.stderr)


def lookup_remote_bundles(host, remote_root=DEFAULT_REMOTE_ROOT):
    """Return the `fleet-run-<n>-<stamp>` directory names present on `host`, in
    listing order, or raise `FailedLookup` when the listing could not be made.

    An empty list is an answer — the root was read and held no bundles. It is
    never a stand-in for a lookup that did not happen.
    """
    cmd = ["ssh", "-n", "-o", _CONNECT_TIMEOUT, host,
           f"ls -1 {shlex.quote(remote_root)}"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=_LIST_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise FailedLookup(
            f"ssh {host}: listing {remote_root} timed out "
            f"after {_LIST_TIMEOUT}s") from None
    except OSError as exc:
        raise FailedLookup(f"ssh {host}: cannot run ssh ({exc})") from exc
    if proc.returncode == _SSH_FAILED:
        raise FailedLookup(f"ssh {host}: host unreachable (ssh exit 255)")
    if proc.returncode != 0:
        raise FailedLookup(
            f"ssh {host}: remote root {remote_root} is missing or unreadable "
            f"(ls exit {proc.returncode})")
    return [line for line in proc.stdout.splitlines() if _BUNDLE.match(line)]


def list_remote_bundles(host, remote_root=DEFAULT_REMOTE_ROOT):
    """`lookup_remote_bundles` with the failure made advisory: a diagnostic plus
    `[]`. Callers that must tell the two apart use the lookup directly."""
    try:
        return lookup_remote_bundles(host, remote_root)
    except FailedLookup as exc:
        _warn(f"{exc}; skipping")
        return []


def fetch_bundles(host, dest, remote_root=DEFAULT_REMOTE_ROOT, run_ids=None):
    """scp each matching bundle's `sandbox-logs.tgz` into
    `dest/<bundle-name>/sandbox-logs.tgz`, returning the local paths copied.
    `run_ids` filters on the `run-<n>` id; a failed copy is skipped.

    Raises `FailedLookup` when the listing itself could not be made — the
    harvest layer catches it and counts a failed input (run-45 critic finding:
    calling the advisory wrapper here made that handler unreachable, so a dead
    host was silent on the harvest path)."""
    return _copy_bundles(host, dest, remote_root,
                         lookup_remote_bundles(host, remote_root), run_ids)


def _copy_bundles(host, dest, remote_root, names, run_ids=None):
    """Copy the named bundles; a failed copy is skipped with a diagnostic."""
    dest = Path(dest)
    wanted = None if run_ids is None else set(run_ids)
    copied = []
    for name in names:
        run_id = f"run-{_BUNDLE.match(name).group(1)}"
        if wanted is not None and run_id not in wanted:
            continue
        out_dir = dest / name
        out = out_dir / "sandbox-logs.tgz"
        # `-s` forces the SFTP protocol, which does NOT expand the remote path
        # through a shell — the injection channel is closed by the protocol
        # rather than by quoting. shlex.quote stays as defence in depth for a
        # legacy-SCP fallback.
        remote = shlex.quote(f"{remote_root}/{name}/sandbox-logs.tgz")
        cmd = ["scp", "-s", "-o", _CONNECT_TIMEOUT,
               f"{host}:{remote}", str(out)]
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
            proc = subprocess.run(cmd, capture_output=True, text=True,
                                  timeout=_COPY_TIMEOUT)
        except subprocess.TimeoutExpired:
            _warn(f"copying {name} timed out; skipping")
            continue
        except OSError as exc:
            _warn(f"cannot copy {name} ({exc}); skipping")
            continue
        if proc.returncode != 0:
            _warn(f"copying {name} failed (exit {proc.returncode}); skipping")
            continue
        copied.append(out)
    return copied


def main(argv=None):
    """Fetch every bundle under `remote_root` into `dest`, printing each local
    path. Exit 2 with `FAILED-LOOKUP:` when the root could not be read at all;
    exit 0 with `LOOKED-EMPTY:` when it was read and held no bundles."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("host", help="orchestrator host, as ssh spells it")
    ap.add_argument("--dest", required=True,
                    help="local directory to copy bundles into")
    ap.add_argument("--remote-root", default=DEFAULT_REMOTE_ROOT)
    ap.add_argument("--run-id", action="append", dest="run_ids",
                    help="restrict to this run id (repeatable), e.g. run-30")
    args = ap.parse_args(argv)

    where = f"{args.host}:{args.remote_root}"
    try:
        names = lookup_remote_bundles(args.host, args.remote_root)
    except FailedLookup as exc:
        report_failed_lookup(str(exc))
        return 2
    if not names:
        report_looked_empty(where)
        return 0

    copied = _copy_bundles(args.host, args.dest, args.remote_root,
                           names, args.run_ids)
    if not copied and args.run_ids:
        report_looked_empty(f"{where} (no bundles for {' '.join(args.run_ids)})")
    for path in copied:
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
