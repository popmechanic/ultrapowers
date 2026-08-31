#!/usr/bin/env python3
"""ultralearn fleet fetcher — list and pull `sandbox-logs.tgz` evidence bundles
from the orchestrator host. Read-only and advisory: an unreachable host, a
missing bundle, or a failed copy is skipped with a diagnostic, never raised."""
from __future__ import annotations

import re
import shlex
import subprocess
import sys
from pathlib import Path

DEFAULT_REMOTE_ROOT = "/tmp/fleet-orch-live-evidence/sandbox-logs"

# group 1 is the run number, so `fleet-run-30-1788131392373` yields `run-30`.
# `\S` admits `;`, `$` and backticks, which reach a remote shell through an
# scp path. Bundle names are machine-generated, so spell out the alphabet.
_BUNDLE = re.compile(r"^fleet-run-([A-Za-z0-9._-]+?)-\d+$")

_CONNECT_TIMEOUT = "ConnectTimeout=20"
_LIST_TIMEOUT = 60      # seconds; a directory listing is cheap
_COPY_TIMEOUT = 600     # seconds; the whole corpus is ~11 MB


def _warn(msg):
    print(f"fleet_fetch: {msg}", file=sys.stderr)


def list_remote_bundles(host, remote_root=DEFAULT_REMOTE_ROOT):
    """Return the `fleet-run-<n>-<stamp>` directory names present on `host`, in
    listing order. Any failure is advisory: a diagnostic plus `[]`."""
    cmd = ["ssh", "-n", "-o", _CONNECT_TIMEOUT, host,
           f"ls -1 {shlex.quote(remote_root)}"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=_LIST_TIMEOUT)
    except subprocess.TimeoutExpired:
        _warn(f"listing {host}:{remote_root} timed out; skipping")
        return []
    except OSError as exc:
        _warn(f"cannot run ssh for {host}:{remote_root} ({exc}); skipping")
        return []
    if proc.returncode != 0:
        _warn(f"listing {host}:{remote_root} failed "
              f"(exit {proc.returncode}); skipping")
        return []
    return [line for line in proc.stdout.splitlines() if _BUNDLE.match(line)]


def fetch_bundles(host, dest, remote_root=DEFAULT_REMOTE_ROOT, run_ids=None):
    """scp each matching bundle's `sandbox-logs.tgz` into
    `dest/<bundle-name>/sandbox-logs.tgz`, returning the local paths copied.
    `run_ids` filters on the `run-<n>` id; a failed copy is skipped."""
    dest = Path(dest)
    wanted = None if run_ids is None else set(run_ids)
    copied = []
    for name in list_remote_bundles(host, remote_root):
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
