#!/usr/bin/env python3
"""Credential seeding for local A/B cells (#402 item 6).

The engine (fleet/run-main.mjs) gives every worker a throwaway per-run
CLAUDE_CONFIG_DIR and lets the credential ride the inherited env as
CLAUDE_CODE_OAUTH_TOKEN. Locally that env var does not exist — the operator's
live credential sits in the macOS Keychain (or ~/.claude/.credentials.json on
Linux, where that file IS the live store). This module extracts the live
access token at cell start. Lineage: seed_credentials in the deleted rig
(git show 44e0d15^:evals/ab_runner.py) — same Keychain-then-file chain, same
GUI-prompt timeout; the difference is the destination (env var, not a copied
credentials file) because the engine owns the config dir now.

Access tokens expire: a cell that fails auth mid-run is rerun after the
operator refreshes (open claude interactively once). Loud over stale.
The token value itself must never appear in any message this module emits.
"""
import json
import subprocess
import sys
from pathlib import Path


def seed_worker_auth(base_env, run=subprocess.run, home=None):
    """Return a copy of base_env with CLAUDE_CODE_OAUTH_TOKEN set from the
    live credential store, or SystemExit with a token-free message."""
    home = Path(home) if home is not None else Path.home()
    cred_text = ""
    try:
        # timeout: a locked keychain / untrusting ACL raises a GUI prompt;
        # over SSH that blocks forever and the file fallback is never reached.
        kc = run(["security", "find-generic-password",
                  "-s", "Claude Code-credentials", "-w"],
                 capture_output=True, text=True, timeout=10)
        cred_text = kc.stdout.strip() if kc.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        cred_text = ""
    if not cred_text:
        cred_file = home / ".claude" / ".credentials.json"
        cred_text = cred_file.read_text() if cred_file.is_file() else ""
    token = ""
    if cred_text:
        try:
            token = (json.loads(cred_text).get("claudeAiOauth") or {}) \
                .get("accessToken") or ""
        except json.JSONDecodeError:
            sys.exit("ab_auth: credential store present but unparseable — "
                     "not JSON. Open claude interactively once to refresh, "
                     "then rerun the cell.")
    if not token:
        sys.exit("ab_auth: no live credential found — Keychain item "
                 "'Claude Code-credentials' and %s both came up empty. "
                 "Open claude interactively once, then rerun the cell."
                 % (home / ".claude" / ".credentials.json"))
    env = dict(base_env)
    env["CLAUDE_CODE_OAUTH_TOKEN"] = token
    return env
