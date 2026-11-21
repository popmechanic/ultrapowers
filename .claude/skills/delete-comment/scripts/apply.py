#!/usr/bin/env python3
import ast
import collections
import glob
import json
import sys
from pathlib import Path

USAGE = """Usage: apply.py <workdir> [path...]

Deletes every comment block whose verdict in <workdir>/out/*.jsonl is tautology, stale,
excuse or decision, from the files named in <workdir>/blocks.json (or only [path...])."""

if len(sys.argv) < 2:
    print(USAGE)
    sys.exit(1)
R = str(Path(__file__).resolve().parents[4]) + "/"
S = sys.argv[1].rstrip("/") + "/"
DELETE = {"tautology", "stale", "excuse", "decision"}

blocks = {b["id"]: b for b in json.load(open(S + "blocks.json"))}
verdicts = {}
for f in sorted(glob.glob(S + "out/shard*.jsonl")):
    for l in open(f):
        l = l.strip()
        if l:
            v = json.loads(l); verdicts[v["id"]] = v

only = set(sys.argv[2:])
byfile = collections.defaultdict(list)
for cid, v in verdicts.items():
    if v["category"] in DELETE:
        b = blocks[cid]
        if only and b["file"] not in only:
            continue
        byfile[b["file"]].append(b)

def line_spans(lines):
    out, pos = [], 0
    for l in lines:
        out.append(pos); pos += len(l)
    return out

stats = collections.Counter()
failed = []
for f, bs in sorted(byfile.items()):
    src = open(R + f, encoding="utf-8").read()
    lines = src.splitlines(keepends=True)
    kill = set()
    cuts = []
    for b in bs:
        for p in b["parts"]:
            if b["kind"] == "docstring":
                for n in range(p["start"] - 1, p["end"]):
                    kill.add(n)
                continue
            text = p["text"]
            first = text.split("\n")[0]
            nl = text.count("\n")
            cands = [i for i, l in enumerate(lines) if first in l]
            if not cands:
                failed.append((f, p["start"], "not found")); continue
            i = min(cands, key=lambda i: abs(i - (p["start"] - 1)))
            if abs(i - (p["start"] - 1)) > 8:
                failed.append((f, p["start"], "too far")); continue
            col = lines[i].index(first)
            endline = i + nl
            before = lines[i][:col]
            if nl == 0:
                after = lines[i][col + len(first):]
            else:
                last = text.split("\n")[-1]
                after = lines[endline][lines[endline].index(last) + len(last):]
            b_strip, a_strip = before.strip(), after.strip()
            if b_strip == "" and a_strip == "":
                kill.update(range(i, endline + 1))
            elif b_strip == "{" and a_strip == "}" and f.endswith((".tsx", ".jsx")):
                kill.update(range(i, endline + 1))
            elif nl == 0:
                if a_strip == "":
                    cuts.append((i, len(before.rstrip()), len(lines[i].rstrip("\r\n"))))
                else:
                    cuts.append((i, col, col + len(first) + (len(after) - len(after.lstrip(" ")))))
            else:
                failed.append((f, p["start"], "multiline mixed")); continue
    new = list(lines)
    for i, a, z in sorted(cuts, reverse=True):
        if i in kill: continue
        l = new[i]; eol = l[len(l.rstrip("\r\n")):]
        new[i] = l[:a] + l[z:].rstrip("\r\n") + eol if z < len(l.rstrip("\r\n")) else l[:a] + eol
    if f.endswith(".py"):
        for b in bs:
            if b["kind"] != "docstring": continue
            s0, e0 = b["start"] - 1, b["end"] - 1
            nxt = next((k for k in range(e0 + 1, len(new)) if k not in kill and new[k].strip() and not new[k].strip().startswith("#")), None)
            ind = len(new[s0]) - len(new[s0].lstrip())
            nind = None if nxt is None else len(new[nxt]) - len(new[nxt].lstrip())
            if ind > 0 and (nind is None or nind < ind):
                new[s0] = " " * ind + "pass\n"; kill.discard(s0)
    res, gap, top = [], False, True
    for n, l in enumerate(new):
        if n in kill:
            stats["lines"] += 1; gap = True; continue
        if l.strip() == "" and gap and (not res or res[-1].strip() == "" or res[-1].rstrip().endswith(("{", "(", "["))):
            stats["blank"] += 1; continue
        if l.strip() and l.strip()[0] in "}])" and gap and res and res[-1].strip() == "":
            res.pop(); stats["blank"] += 1
        if l.strip(): gap = False
        res.append(l)
    while res and res[0].strip() == "" and 0 in kill:
        res.pop(0); stats["blank"] += 1
    final = "".join(res)
    open(R + f, "w", encoding="utf-8").write(final)
    stats["files"] += 1
    if f.endswith(".py"):
        try:
            ast.parse(final)
        except SyntaxError as e:
            failed.append((f, e.lineno, "py syntax: " + str(e)))
print(dict(stats))
for x in failed:
    print("FAIL", x)
sys.exit(1 if failed else 0)
