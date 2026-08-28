#!/usr/bin/env python3
"""Eval cell #345 — the two `--check` advisory renders, measured together.

Arm A = `compile_plan.py --check <plan>` (current); arm B = `--check --renders
--base <base>` (P1 Produces blast-radius + P2 referent-existence). Corpus =
every evals/fixtures/<name>/plan.md (BASE = its project/; canonical = wide/
chained/mixed/degrade/contend, where the bar is zero advisories) + every
docs/superpowers/plans/2026-08-27-*.md (BASE = repo root; run-14's known
instances live in the w2-entry-slate plan).

Per plan it records exit code per arm (the frozen contract: must match),
verdict-line identity, advisory counts per render, and the bytes/lines arm B
adds; then true positives against KNOWN_INSTANCES, false positives on the
canonical fixtures, and render size. It WRITES the results doc; it asserts
nothing about the numbers — those are the operator's to read (adoption bar:
every known instance surfaced, zero canonical false positives). Deterministic,
headless, stdlib + git only. Never runs in CI beyond the schema pin in
tests/test_check_renders_ab.py.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
DEFAULT_OUT = ROOT / "evals/frontier/results/2026-08-29-check-renders.md"
CANONICAL = ("wide", "chained", "mixed", "degrade", "contend")
RENDERS = ("blast-radius", "referent")
DOC_SECTIONS = ("## Corpus", "## Known instances", "## Canonical false positives",
                "## Render size", "## Bar (#345)", "## Raw advisories (arm B)")

# The true-positive list: (plan stem, render, task id, needle). A needle is a
# substring expected on SOME line of an advisory block for that plan/render/
# task in arm B's stdout. All three are run-14 (#345's specimens).
KNOWN_INSTANCES = [
    {"plan": "2026-08-27-w2-entry-slate", "render": "blast-radius", "task": "1",
     "needle": "fleet/tests/test_drive.mjs",
     "why": "run-14 task 1: additive `runShim` outcome shape change; the strict-equality "
            "pin lived in sibling-owned test_drive.mjs; cost one redirect round (#233)"},
    {"plan": "2026-08-27-w2-entry-slate", "render": "referent", "task": "4",
     "needle": ".claude/ultrapowers/fleet-runs-2026-08-26",
     "why": "gitignored evidence dir named as if committed (#321 item 2)"},
    {"plan": "2026-08-27-w2-entry-slate", "render": "referent", "task": "4",
     "needle": "detail.creditSpendUsd",
     "why": "per-run spend field labeled with a monthly baseline; the field is gone at "
            "BASE since #343, so the existence check surfaces it"},
]

ADVISORY_RE = re.compile(r"^ADVISORY (blast-radius|referent): Task ([A-Za-z0-9]+) ")


def corpus():
    entries = []
    for plan in sorted((ROOT / "evals/fixtures").glob("*/plan.md")):
        name = plan.parent.name
        entries.append({"name": name, "plan": plan, "base": plan.parent / "project",
                        "canonical": name in CANONICAL})
    for plan in sorted((ROOT / "docs/superpowers/plans").glob("2026-08-27-*.md")):
        entries.append({"name": plan.stem, "plan": plan, "base": ROOT, "canonical": False})
    return entries


def run_check(plan, base, renders):
    cmd = [sys.executable, str(COMPILER), "--check", str(plan)]
    if renders:
        cmd += ["--renders", "--base", str(base)]
    return subprocess.run(cmd, capture_output=True, text=True)


def parse_advisories(stdout):
    """Advisory blocks: a header line + its indented detail lines."""
    blocks = []
    for line in stdout.splitlines():
        m = ADVISORY_RE.match(line)
        if m:
            blocks.append({"render": m.group(1), "task": m.group(2), "lines": [line]})
        elif line.startswith("  ") and blocks:
            blocks[-1]["lines"].append(line)
    return blocks


def measure(entry):
    a = run_check(entry["plan"], entry["base"], False)
    b = run_check(entry["plan"], entry["base"], True)
    blocks = parse_advisories(b.stdout)
    base = entry["base"]
    return {
        "name": entry["name"], "canonical": entry["canonical"],
        "base": "." if base == ROOT else str(base.relative_to(ROOT)),
        "exit_a": a.returncode, "exit_b": b.returncode,
        "verdict_identical": a.stdout.splitlines()[:1] == b.stdout.splitlines()[:1],
        "counts": {r: sum(1 for k in blocks if k["render"] == r) for r in RENDERS},
        "bytes_added": len(b.stdout.encode()) - len(a.stdout.encode()),
        "lines_added": b.stdout.count("\n") - a.stdout.count("\n"),
        "advisories": blocks,
        "stdout_b": b.stdout,
    }


def known_status(rows):
    by_name = {r["name"]: r for r in rows}
    out = []
    for k in KNOWN_INSTANCES:
        row = by_name.get(k["plan"])
        if row is None:
            status = "not run"
        else:
            hit = any(b["render"] == k["render"] and b["task"] == k["task"]
                      and any(k["needle"] in l for l in b["lines"])
                      for b in row["advisories"])
            status = "yes" if hit else "NO"
        out.append({**k, "surfaced": status})
    return out


def render_doc(rows, known, base_sha):
    L = []
    L.append("# Eval cell: two `--check` renders — P1 blast-radius + P2 referent-existence (#345)")
    L.append("")
    L.append("Base: `%s`. Arms: **A** = `compile_plan.py --check <plan>` (current); **B** = "
             "`--check --renders --base <base>` (both renders). Corpus: every "
             "`evals/fixtures/*/plan.md` (BASE = the fixture's `project/`; canonical = %s) + "
             "every `docs/superpowers/plans/2026-08-27-*.md` (BASE = repo root). Produced by "
             "`python3 evals/check_renders_ab.py`; numbers below are read by the operator, "
             "not asserted by any test." % (base_sha, "/".join(CANONICAL)))
    L.append("")
    L.append("## Corpus")
    L.append("")
    L.append("| Plan | Canonical | exit A | exit B | verdict line identical | blast-radius | referent | +bytes | +lines |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        L.append("| `%s` | %s | %d | %d | %s | %d | %d | %d | %d |" % (
            r["name"], "yes" if r["canonical"] else "no", r["exit_a"], r["exit_b"],
            "yes" if r["verdict_identical"] else "NO",
            r["counts"]["blast-radius"], r["counts"]["referent"],
            r["bytes_added"], r["lines_added"]))
    L.append("")
    L.append("## Known instances")
    L.append("")
    L.append("| Plan | Render | Task | Needle | Surfaced | Why |")
    L.append("|---|---|---|---|---|---|")
    for k in known:
        L.append("| `%s` | %s | %s | `%s` | %s | %s |" % (
            k["plan"], k["render"], k["task"], k["needle"], k["surfaced"], k["why"]))
    L.append("")
    L.append("## Canonical false positives")
    L.append("")
    L.append("| Fixture | blast-radius | referent |")
    L.append("|---|---|---|")
    # CANONICAL order, not corpus (glob) order: the bar reads down the declared
    # list, and tests/test_check_renders_ab.py pins the rows to it.
    canon = sorted((r for r in rows if r["canonical"]),
                   key=lambda r: CANONICAL.index(r["name"]))
    for r in canon:
        L.append("| `%s` | %d | %d |" % (r["name"], r["counts"]["blast-radius"],
                                        r["counts"]["referent"]))
    L.append("")
    L.append("## Render size")
    L.append("")
    total_b = sum(r["bytes_added"] for r in rows)
    total_l = sum(r["lines_added"] for r in rows)
    L.append("- arm B adds %d bytes / %d lines across %d plan(s) (mean %.1f bytes, %.1f lines per plan)."
             % (total_b, total_l, len(rows),
                total_b / len(rows) if rows else 0.0, total_l / len(rows) if rows else 0.0))
    for name in RENDERS:
        L.append("- %s: %d advisory block(s) in total." % (
            name, sum(r["counts"][name] for r in rows)))
    L.append("")
    L.append("## Bar (#345)")
    L.append("")
    surfaced = sum(1 for k in known if k["surfaced"] == "yes")
    fp = sum(r["counts"]["blast-radius"] + r["counts"]["referent"] for r in canon)
    parity = [r["name"] for r in rows if r["exit_a"] != r["exit_b"] or not r["verdict_identical"]]
    L.append("- known instances surfaced: %d/%d" % (surfaced, len(known)))
    L.append("- canonical false positives: %d (bar: 0)" % fp)
    L.append("- exit-code / verdict-line parity: %s" % (
        "all rows equal" if not parity else "MISMATCH on " + ", ".join(parity)))
    L.append("")
    L.append("## Raw advisories (arm B)")
    L.append("")
    for r in rows:
        L.append("### `%s`" % r["name"])
        L.append("")
        L.append("```text")
        adv = [l for b in r["advisories"] for l in b["lines"]]
        L.extend(adv if adv else ["(none)"])
        L.append("```")
        L.append("")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--only", action="append", default=[],
                    help="restrict the corpus to these names (repeatable)")
    args = ap.parse_args(argv)
    entries = corpus()
    if args.only:
        entries = [e for e in entries if e["name"] in args.only]
    rows = [measure(e) for e in entries]
    known = known_status(rows)
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                         capture_output=True, text=True).stdout.strip() or "unknown"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render_doc(rows, known, sha) + "\n")
    print(json.dumps({
        "out": str(args.out), "plans": len(rows),
        "known_surfaced": sum(1 for k in known if k["surfaced"] == "yes"),
        "known_total": len(known),
        "canonical_false_positives": sum(
            r["counts"]["blast-radius"] + r["counts"]["referent"]
            for r in rows if r["canonical"]),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
