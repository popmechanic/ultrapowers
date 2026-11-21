#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

_SKILLS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_SKILLS / "ultrapowers/scripts"))

import plan_parse  # noqa: E402
from plan_check import AUTHORING_KEY, _record  # noqa: E402

AUTHORING_BRANCHES = ("risk", "width", "inline", "subagent")

JEV_ASK_TIMEOUT_S = 45
ASK_TS = _SKILLS / "ultrawrite/stories/ask.ts"


def ask_jev(question_set, question, state):
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
    try:
        policy = json.loads(
            (_SKILLS / "ultrawrite/stories/policy.json").read_text())
        return float(policy["flag_at"]["routing_risk"])
    except (OSError, ValueError, KeyError, TypeError):
        return 0.5


def read_routing_risk(tasks):
    value = ask_jev("authoring_routing", "risk", {"plan": {"tasks": [
        {"title": t["title"], "claim": t.get("claim") or "",
         "files": list(t.get("files") or [])} for t in tasks]}})
    return None if value is None else float(value)


def routing_branch(T, width, risk):
    if risk is not None and risk >= routing_risk_threshold():
        return "risk"
    if width >= 2 and T >= 3:
        return "width"
    if T <= 2:
        return "inline"
    return "subagent"


def routing_fact_lines(result, tasks, plan_path):
    T = len(result["tasks"])
    width = result["width"]
    risk = read_routing_risk(tasks)
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
