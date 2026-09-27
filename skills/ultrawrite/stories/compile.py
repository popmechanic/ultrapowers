#!/usr/bin/env python3
"""Compile a signed bundle into a stories-v1 plan.

    compile.py <bundle> --app <dir> --plan-id <id> --date YYYY-MM-DD --out <plan.md>

Every probe is derived: `given` from the story's earlier steps, `do` from the
step itself, and `expect` from the step's recorded diff. Nothing is written
from memory. The app's older signed stories become guards."""
import argparse
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bundle import load_bundle  # noqa: E402
from checks import run_checks  # noqa: E402
import steps as steps_mod  # noqa: E402
import probe_block  # noqa: E402


probe_for = probe_block.probe_for


def _fence(p):
    return ["```probe", json.dumps(p, sort_keys=True, ensure_ascii=False), "```"]


def _piece_order(cards):
    done, order, left = set(), [], list(cards)
    while left:
        ready = [c for c in left if all(d in done for d in c.get("depends_on", []))]
        if not ready:
            raise SystemExit("compile: the pieces depend on each other in a circle")
        for c in ready:
            order.append(c); done.add(c["piece"]); left.remove(c)
    return order


def compile_plan(b, plan_id, guard_rows):
    page, cards = b["page"], b["cards"]
    sentences = {s["id"]: s["sentence"] for s in page.get("stories", [])}
    out = ["# " + page["title"], "",
           "**Grammar:** stories-v1", "**Stack:** tinyapp", "**Plan-id:** " + plan_id,
           "**Kind:** " + page["kind"], "**Summary:** " + " ".join(page["summary"]),
           "**Store:** `%s` sha256:%s" % (page["store"], b["store_sha256"]), "",
           "## Stories", ""]
    out += ["- %s: %s" % (s["id"], s["sentence"]) for s in page.get("stories", [])]
    if page.get("links"):
        out += ["", "## Links", ""] + ["- %s: %s" % (l["id"], l["sentence"]) for l in page["links"]]
    if page.get("numbers"):
        out += ["", "## Numbers", ""] + ["- %s: %s | measure: %s | target: %s"
                                         % (n["id"], n["sentence"], n["measure"], n["target"])
                                         for n in page["numbers"]]
    if guard_rows:
        out += ["", "## Guards", ""]
        for sid, srows in steps_mod.stories_of(guard_rows).items():
            for i, r in enumerate(srows):
                out += _fence(probe_for(r, srows[:i], "G:%s.%d" % (sid, r["step"])))

    setups = {s["id"]: s.get("setup", []) for s in page.get("stories", [])}
    assigned = {}
    for sid, srows in steps_mod.stories_of(b["steps"]).items():
        for i, r in enumerate(srows):
            if r["layer"] != "ui":
                if i >= len(setups.get(sid, [])):
                    raise SystemExit("compile: story %s step %d was not done on the screen; "
                                     "do it by clicking in the preview" % (sid, r["step"]))
                continue
            assigned.setdefault(r["piece"], []).append(
                (sid, probe_for(r, srows[:i], "%s.%d" % (sid, r["step"]))))

    n = 0
    for c in _piece_order(cards):
        n += 1
        mine = assigned.get(c["piece"], [])
        out += ["", "### Task %d: The %s piece" % (n, c["piece"]), "",
                "**Piece:** " + c["piece"],
                "**Depends-on-pieces:** " + (", ".join(c.get("depends_on", [])) or "none"),
                "**Files:**",
                "- Create: `client/src/pieces/%s.ts`" % c["piece"],
                "**Purpose:** " + c["purpose"], "**Actions:**"]
        for a in c["actions"]:
            refuses = "; refuses: " + "; ".join(a["refuses"]) if a.get("refuses") else ""
            out.append("- `%s` — %s%s" % (a["name"], a["description"], refuses))
        out.append("**Stories:**")
        out += ["- %s: %s" % (sid, sentences[sid]) for sid in sorted({s for s, _ in mine})]
        out.append("**Proof:**")
        for _, p in mine:
            out += _fence(p)
    return "\n".join(out) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description="Compile a signed bundle into a stories-v1 plan.")
    ap.add_argument("bundle")
    ap.add_argument("--app", required=True)
    ap.add_argument("--plan-id", required=True)
    ap.add_argument("--date", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    b = load_bundle(args.bundle)
    refusals, facts = run_checks(b)
    for f in facts:
        print(f)
    if refusals:
        print("\n".join(refusals))
        print("%d refusal(s)" % len(refusals))
        return 2

    export = os.path.join(args.app, "stories", "steps.jsonl")
    older = steps_mod.load_steps(export) if os.path.exists(export) else []
    prefix = args.plan_id + "/"
    guards = [r for r in older if not r["story"].startswith(prefix)]
    text = compile_plan(b, args.plan_id, guards)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text)

    sentences = {s["id"]: s["sentence"] for s in b["page"].get("stories", [])}
    mine = [dict(r, story=prefix + r["story"], plan=args.plan_id, signed=args.date,
                 sentence=sentences.get(r["story"], "")) for r in b["steps"]]
    os.makedirs(os.path.dirname(export), exist_ok=True)
    steps_mod.dump_steps(sorted(guards + mine, key=lambda r: (r["story"], r["step"])), export)
    store_dst = os.path.join(args.app, b["page"]["store"])
    os.makedirs(os.path.dirname(store_dst), exist_ok=True)
    shutil.copyfile(os.path.join(b["dir"], "store.js"), store_dst)

    probes = text.count("```probe")
    guard_n = sum(len(v) for v in steps_mod.stories_of(guards).values())
    tasks = text.count("\n### Task ")
    print("COMPILED %s: %d task(s), %d probe(s), %d guard(s)"
          % (args.plan_id, tasks, probes - guard_n, guard_n))
    return 0


if __name__ == "__main__":
    sys.exit(main())
