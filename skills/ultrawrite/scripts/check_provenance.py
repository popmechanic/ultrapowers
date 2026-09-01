#!/usr/bin/env python3
"""Resolve a `claims-v1` plan's Claim quotes and Authorized-by anchors.

The compiler stays a pure function: it checks the provenance tag's *form* and
stops. Resolution — does `#NNN` exist, and does the operator sentence still
read verbatim in it — needs the network, so it lives here, in `ultrawrite`'s
validation step, ahead of the compile (spec 2026-08-31 §4.4).

    check_provenance.py <plan.md> [--gh <cmd>]

Exit 0 when every `quoted:#NNN` claim string-matches its issue body and every
Authorized-by anchor resolves; exit 2 with one line per failure; exit 1 on a
usage error. `--gh` swaps the `gh` binary — the test seam, and the hook for a
caller with its own wrapper. Nothing here reaches the network by any other
route: the binary is never resolved by bare name when `--gh` names one.

The signature is over the quote AT SIGNING TIME (§4.4): a later edit to the
issue does not retro-invalidate a signed claim — that drift is Stale-if's
department, not this script's.
"""
from __future__ import annotations

import argparse
import re
import shlex
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
from compile_plan import (  # noqa: E402
    CLAIMS_GRAMMAR,
    CLAIM_PROVENANCE_RE,
    parse_claims_body,
    plan_grammar,
    split_tasks,
)

# An issue reference inside the Authorized-by slot. A slot may cite several
# anchors (`#489; spec ... §3`); every issue among them must resolve, and the
# non-issue anchors (spec sections, decision records) are not this script's to
# check — no mechanism can.
ANCHOR_RE = re.compile(r"#(\d+)")
MACHINE_RE = re.compile(r"^machine\s*:", re.I)


def operator_sentence(claim):
    """The operator's signed sentence: the Claim slot up to the `Machine:`
    restatement, with the provenance tag that closes it stripped."""
    lines = []
    for line in claim.splitlines():
        if MACHINE_RE.match(line.strip()):
            break
        lines.append(line)
    return CLAIM_PROVENANCE_RE.sub("", "\n".join(lines).strip()).strip()


def fold(text):
    """CRLF normalization plus wrap folding, so the comparison is over words.

    The match is exact — every word, in order, verbatim — but a markdown hard
    wrap is not paraphrase: the authoring agent rewraps the sentence to fit the
    plan's column and the issue wraps it to fit GitHub's. Folding every
    whitespace run to one space is what makes "exact substring" mean the same
    thing on both sides of that."""
    return " ".join(text.replace("\r\n", "\n").replace("\r", "\n").split())


def issue_body(number, gh, cache):
    """The body of issue `number`, or None when it does not resolve."""
    if number not in cache:
        proc = subprocess.run(
            gh + ["issue", "view", number, "--json", "body", "-q", ".body"],
            capture_output=True, text=True)
        cache[number] = proc.stdout if proc.returncode == 0 else None
    return cache[number]


def check_plan(md_text, gh):
    """Every provenance failure the plan earns, in task order, plus the counts
    of what was resolved. `elicited` claims are skipped outright — there is no
    issue to fetch, so they cost no `gh` call."""
    failures, cache = [], {}
    quotes = anchors = 0
    for task in split_tasks(md_text):
        claims = parse_claims_body(task["body"], task["id"])
        provenance = claims["claim_provenance"] or ""
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
                # The vacuous pass: a Claim that is nothing but its tag strips
                # to "", and "" is a substring of every body, so the comparison
                # below would sign off on a quote of nothing.
                failures.append(
                    "provenance: task %s claim quotes #%s with an empty "
                    "operator sentence — the Claim is nothing but its "
                    "provenance tag" % (task["id"], number))
            elif sentence not in fold(body):
                failures.append("provenance: task %s claim is not verbatim in "
                                "#%s" % (task["id"], number))
        for number in dict.fromkeys(ANCHOR_RE.findall(claims["authorized_by"])):
            anchors += 1
            if issue_body(number, gh, cache) is None:
                failures.append("provenance: task %s Authorized-by anchor #%s "
                                "does not resolve" % (task["id"], number))
    return failures, quotes, anchors


def _plural(n, word):
    return "%d %s%s" % (n, word, "" if n == 1 else "s")


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

    failures, quotes, anchors = check_plan(md_text, shlex.split(args.gh))
    for line in failures:
        print(line)
    if failures:
        return 2
    print("provenance: ok — %s and %s resolve"
          % (_plural(quotes, "claim quote"), _plural(anchors, "anchor")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
