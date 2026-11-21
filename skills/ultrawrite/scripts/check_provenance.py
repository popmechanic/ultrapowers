#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shlex
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
from plan_check import gh_issue_view, verdicts_path  # noqa: E402
from routing import ask_jev  # noqa: E402
from plan_parse import (  # noqa: E402
    CLAIMS_GRAMMAR,
    CLAIM_PROVENANCE_RE,
    claim_provenance,
    operator_lines,
    parse_plan_claim,
    parse_plan_full,
    plan_claim_provenance,
    plan_grammar,
)

ANCHOR_RE = re.compile(r"#(\d+)")


def operator_sentence(claim):
    return CLAIM_PROVENANCE_RE.sub(
        "", "\n".join(operator_lines(claim)).strip()).strip()


def fold(text):
    return " ".join(text.replace("\r\n", "\n").replace("\r", "\n").split())


def issue_body(number, gh, cache):
    if number not in cache:
        proc = gh_issue_view(gh, number, "body")
        cache[number] = proc.stdout if proc.returncode == 0 else None
    return cache[number]


def check_plan(md_text, gh, matched=None):
    failures, cache = [], {}
    if matched is None:
        matched = []
    quotes = derived = anchors = 0
    plan_claim = parse_plan_claim(md_text)
    plan_provenance = plan_claim_provenance(md_text) or ""
    if plan_provenance.startswith("quoted:#"):
        quotes += 1
        number = plan_provenance.split("#", 1)[1]
        body = issue_body(number, gh, cache)
        sentence = fold(plan_claim or "")
        if body is None:
            failures.append("provenance: plan-level claim quotes #%s, which "
                            "does not resolve" % number)
        elif not sentence:
            failures.append(
                "provenance: plan-level claim quotes #%s with an empty "
                "operator sentence — the Claim is nothing but its provenance "
                "tag" % number)
        elif sentence not in fold(body):
            failures.append("provenance: plan-level claim is not verbatim in "
                            "#%s" % number)
        else:
            matched.append(("plan-level claim", number, body, sentence))
    for task in parse_plan_full(md_text)[1]:
        claims = task
        provenance = claim_provenance(task["claim"]) or ""
        if claims.get("claim") and not provenance:
            failures.append(
                "provenance: task %s claim carries no recognizable provenance "
                "tag — `(elicited)`, `(derived)` or `(quoted from #NNN)`"
                % task["id"])
        if provenance == "derived":
            derived += 1
        if provenance.startswith("quoted:#"):
            quotes += 1
            number = provenance.split("#", 1)[1]
            body = issue_body(number, gh, cache)
            sentence = fold(operator_sentence(claims["claim"]))
            if body is None:
                failures.append(
                    "provenance: task %s claim quotes #%s, which does not "
                    "resolve" % (task["id"], number))
            elif not sentence:
                failures.append(
                    "provenance: task %s claim quotes #%s with an empty "
                    "operator sentence — the Claim is nothing but its "
                    "provenance tag" % (task["id"], number))
            elif sentence not in fold(body):
                failures.append("provenance: task %s claim is not verbatim in "
                                "#%s" % (task["id"], number))
            else:
                matched.append(("task %s claim" % task["id"], number, body,
                                sentence))
        for number in dict.fromkeys(ANCHOR_RE.findall(claims["authorized_by"])):
            anchors += 1
            if issue_body(number, gh, cache) is None:
                failures.append("provenance: task %s Authorized-by anchor #%s "
                                "does not resolve" % (task["id"], number))
    return failures, quotes, derived, anchors


def jev_desired_state(body, sentence):
    return ask_jev("authoring_desired_state", "desired_state",
                   {"issue_body": body, "sentence": sentence})


def record_readings(plan_path, rows):
    record = verdicts_path(plan_path)
    try:
        data = (json.loads(record.read_text(encoding="utf-8"))
                if record.exists() else {})
        if not isinstance(data, dict):
            return
        data.setdefault("jev_readings", []).extend(rows)
        record.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError, AttributeError):
        pass


def _plural(n, word):
    return "%d %s%s" % (n, word, "" if n == 1 else "s")


def _series(parts):
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Resolve a claims-v1 plan's Claim quotes and "
                    "Authorized-by anchors against GitHub.")
    ap.add_argument("plan", help="path to the plan markdown")
    ap.add_argument("--gh", default="gh",
                    help="the gh binary (or command) to run; default `gh`")
    args = ap.parse_args(argv)

    path = Path(args.plan)
    if not path.is_file():
        print("provenance: no such plan `%s`" % args.plan, file=sys.stderr)
        return 1
    md_text = path.read_text(encoding="utf-8")
    if plan_grammar(md_text) != CLAIMS_GRAMMAR:
        print("provenance: `%s` is not a %s plan — nothing to resolve"
              % (args.plan, CLAIMS_GRAMMAR))
        return 0

    matched = []
    failures, quotes, derived, anchors = check_plan(
        md_text, shlex.split(args.gh), matched)
    rows = []
    for subject, number, body, sentence in matched:
        value = jev_desired_state(body, sentence)
        if value is None:
            continue
        print("JEV desired_state: %.2f — %s quotes #%s"
              % (value, subject, number))
        rows.append({"question": "desired_state", "subject": subject,
                     "issue": int(number), "noul": value,
                     "date": datetime.now(timezone.utc).strftime("%Y-%m-%d")})
    if rows:
        record_readings(path, rows)
    for line in failures:
        print(line)
    if failures:
        return 2
    counts = [_plural(quotes, "claim quote")]
    if derived:
        counts.append("%d derived" % derived)
    counts.append(_plural(anchors, "anchor"))
    print("provenance: ok — %s resolve" % _series(counts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
