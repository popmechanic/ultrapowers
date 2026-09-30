#!/usr/bin/env python3
"""The execution handoff's signals, computed (ultrawrite §Execution handoff).

    routing.py <plan.md>

Prints `ROUTING fact: T=<n>, width <w>, risk <r>, branch <b>`: T the
implementation tasks, width the largest launch wave, risk one Jev reading of
`authoring_routing` / `risk` (via `skills/ultrawrite/stories/ask.ts`; any
failure reads `risk unread` and the line ends `(computed without risk)`), and
the branch by the first-match rule. When risk was read and the gate record's
`authoring.routing.branch` names another branch, one more line says
`ROUTING fact: recorded branch <r> differs from the computed branch <b>` — a
pointer, never a refusal. Exits 0, or 2 when the plan does not parse.

Moved out of the launch-time `plan_check.py` (#1440): its only reader is the
author at the handoff, and the fetched copy the launcher runs has no `ask.ts`
beside it.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

# scripts -> ultrawrite -> skills
_SKILLS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_SKILLS / "ultrapowers/scripts"))

import plan_parse  # noqa: E402
from plan_check import AUTHORING_KEY, _record  # noqa: E402

AUTHORING_BRANCHES = ("risk", "width", "inline", "subagent")

JEV_ASK_TIMEOUT_S = 45
ASK_TS = _SKILLS / "ultrawrite/stories/ask.ts"


def ask_jev(question_set, question, state):
    """One Jev reading through `ask.ts <set> <question>` over `state`, or None
    for any failure — no `bun`, no `ask.ts`, a timeout, a non-zero exit,
    output not `{"noul": <number>}`, or a null. `ask.ts` prints that object
    as its one stdout line; the last line is the one read."""
    bun = shutil.which("bun")
    if bun is None or not ASK_TS.is_file():
        return None
    try:
        proc = subprocess.run(
            [bun, str(ASK_TS), question_set, question],
            input=json.dumps(state), capture_output=True, text=True,
            timeout=JEV_ASK_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    try:
        value = json.loads(proc.stdout.strip().splitlines()[-1])["noul"]
    except (ValueError, IndexError, KeyError, TypeError):
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def routing_risk_threshold():
    """`flag_at.routing_risk` of the stories policy; 0.5 when unreadable."""
    try:
        policy = json.loads(
            (_SKILLS / "ultrawrite/stories/policy.json").read_text())
        return float(policy["flag_at"]["routing_risk"])
    except (OSError, ValueError, KeyError, TypeError):
        return 0.5


def read_routing_risk(tasks):
    """One Jev reading of `authoring_routing` / `risk` over the plan's
    implementation tasks, or None for any failure (`ask_jev`)."""
    value = ask_jev("authoring_routing", "risk", {"plan": {"tasks": [
        {"title": t["title"], "claim": t.get("claim") or "",
         "files": list(t.get("files") or [])} for t in tasks]}})
    return None if value is None else float(value)


def routing_branch(T, width, risk):
    """ultrawrite §Execution handoff, first match wins."""
    if risk is not None and risk >= routing_risk_threshold():
        return "risk"
    if width >= 2 and T >= 3:
        return "width"
    if T <= 2:
        return "inline"
    return "subagent"


def routing_fact_lines(result, tasks, plan_path):
    """The `ROUTING fact:` line, and — risk read, the record naming another
    of the four branches — the mismatch line. Asks Jev once."""
    impl = [t for t in tasks if t.get("type") == "implementation"]
    T = len(result["tasks"])
    width = max((len(w) for w in result["launch_waves"]), default=0)
    risk = read_routing_risk(impl)
    branch = routing_branch(T, width, risk)
    if risk is None:
        lines = ["ROUTING fact: T=%d, width %d, risk unread, branch %s "
                 "(computed without risk)" % (T, width, branch)]
    else:
        lines = ["ROUTING fact: T=%d, width %d, risk %.2f, branch %s"
                 % (T, width, risk, branch)]
        auth = _record(plan_path).get(AUTHORING_KEY)
        routing = auth.get("routing") if isinstance(auth, dict) else None
        recorded = routing.get("branch") if isinstance(routing, dict) else None
        if recorded in AUTHORING_BRANCHES and recorded != branch:
            lines.append("ROUTING fact: recorded branch %s differs from the "
                         "computed branch %s" % (recorded, branch))
    return lines


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: routing.py <plan.md>", file=sys.stderr)
        return 2
    plan = Path(argv[0])
    try:
        result, tasks = plan_parse.parse_plan_full(plan.read_text())
    except (OSError, UnicodeDecodeError, plan_parse.Refusal) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    for line in routing_fact_lines(result, tasks, plan):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
