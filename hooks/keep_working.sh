#!/usr/bin/env bash
set -euo pipefail

python3 -c "$(cat <<'PY'
import json
import sys

raw = sys.stdin.read()

try:
    d = json.loads(raw)
except Exception:
    sys.exit(0)

if not isinstance(d, dict):
    sys.exit(0)

if d.get("stop_hook_active") is True:
    sys.exit(0)

tasks = [
    t for t in (d.get("background_tasks") or [])
    if isinstance(t, dict) and str(t.get("status")) in ("running", "pending")
]

if not tasks:
    sys.exit(0)

lines = []
for t in tasks:
    ttype = t.get("type")
    ttype = str(ttype) if ttype is not None else ""
    desc = t.get("description")
    if desc is None:
        desc = t.get("id")
    desc = str(desc)
    lines.append(f"- {ttype}: {desc}")

reason = (
    "Background work is still in flight:\n"
    + "\n".join(lines)
    + "\n\nBefore idling, ask yourself: is there anything else productive to "
    "do while that runs — work that does not depend on those results (prep, "
    "verification, the next step's inputs, an issue to file, a record to "
    "write)? If yes, do it now. If genuinely nothing, say so in one line and "
    "stop."
)

print(json.dumps({
    "decision": "block",
    "reason": reason,
    "hookSpecificOutput": {
        "hookEventName": "Stop",
        "continueLoop": True,
        "additionalContext": reason,
    },
}))
PY
)" || true

exit 0
