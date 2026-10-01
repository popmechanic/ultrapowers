#!/usr/bin/env python3
"""Parse a stories-v1 plan to the fields the engine and the laptop's check
read. The Flock's field names (tasks, dag_edges, launch_waves, checks,
bootstrapCmd, publish) are kept. proofRuns stays empty: each task's facts are
its probes, which factory/flock/plan.mjs turns into check.ts calls itself."""
import re

from plan_parse import task_sections
from probe_block import parse_probe_text


class StoriesRefusal(Exception):
    pass


# preserve is the declared shape for the Numbers checker still owed; nothing reads it yet.
KINDS = ("behaviour", "preserve")
STACKS = ("tinyapp",)
HEADER_RE = re.compile(r'^\*\*([A-Za-z-]+):\*\*\s*(.*)$')
TASK_RE = re.compile(r'^### Task (\d+):\s*(.+)$')
ID_BULLET_RE = re.compile(r'^- ([SLN]\d+):\s*(.+)$')
STORE_RE = re.compile(r'^`([^`]+)`\s+sha256:([0-9a-f]{64})$')
ACTION_RE = re.compile(r'^- `([^`]+)`')
FILE_RE = re.compile(r'^- Create:\s*`([^`]+)`$')


def _blocks(lines):
    out, i = [], 0
    while i < len(lines):
        if lines[i].strip() == "```probe":
            j, body = i + 1, []
            while j < len(lines) and lines[j].strip() != "```":
                body.append(lines[j]); j += 1
            if j == len(lines):
                raise StoriesRefusal("grammar: a ```probe fence is never closed")
            out.append(("probe", "\n".join(body)))
            i = j + 1
            continue
        out.append(("line", lines[i].rstrip()))
        i += 1
    return out


def _probe(body):
    p, errs = parse_probe_text(body)
    if errs:
        raise StoriesRefusal("grammar: " + "; ".join(errs))
    return p


def _layers(ids, edges):
    left, done, waves = list(ids), set(), []
    while left:
        wave = [i for i in left if all(e["from"] in done for e in edges if e["to"] == i)]
        if not wave:
            raise StoriesRefusal("grammar: the pieces depend on each other in a circle")
        waves.append(wave)
        done |= set(wave)
        left = [i for i in left if i not in done]
    return waves


def parse_stories_text(text):
    head, section, task, field = {}, None, None, None
    stories, links, numbers, guards, tasks = [], [], [], [], []
    for kind, val in _blocks(text.splitlines()):
        if kind == "probe":
            if task is not None and field == "proof":
                task["probes"].append(_probe(val))
            elif task is None and section == "guards":
                guards.append(_probe(val))
            else:
                raise StoriesRefusal("grammar: a probe fence outside a task's Proof or the Guards section")
            continue
        s = val.strip()
        m = TASK_RE.match(s)
        if m:
            task = {"id": m.group(1), "title": m.group(2).strip(), "piece": None,
                    "depends_pieces": [], "files": [], "purpose": "", "actions": [],
                    "stories": [], "probes": []}
            tasks.append(task)
            field = None
            continue
        if s.startswith("## "):
            section, task, field = s[3:].strip().lower(), None, None
            continue
        hm = HEADER_RE.match(s)
        if hm:
            key, value = hm.group(1).lower(), hm.group(2).strip()
            if task is None:
                head[key] = value
                continue
            field = key
            if key == "piece":
                task["piece"] = value
            elif key == "depends-on-pieces":
                task["depends_pieces"] = [] if value in ("", "none") else [x.strip() for x in value.split(",")]
            elif key == "purpose":
                task["purpose"] = value
            continue
        if task is not None:
            fm, am, bm = FILE_RE.match(s), ACTION_RE.match(s), ID_BULLET_RE.match(s)
            if field == "files" and fm:
                task["files"].append(fm.group(1))
            elif field == "actions" and am:
                task["actions"].append(am.group(1))
            elif field == "stories" and bm:
                task["stories"].append(bm.group(1))
            continue
        bm = ID_BULLET_RE.match(s)
        if bm and section == "stories":
            stories.append({"id": bm.group(1), "sentence": bm.group(2)})
        elif bm and section == "links":
            links.append({"id": bm.group(1), "sentence": bm.group(2)})
        # numbers is the declared shape for the Numbers checker still owed; nothing reads it yet.
        elif bm and section == "numbers":
            parts = [x.strip() for x in bm.group(2).split(" | ")]
            fields = dict(x.split(": ", 1) for x in parts[1:] if ": " in x)
            numbers.append({"id": bm.group(1), "sentence": parts[0],
                            "measure": fields.get("measure", ""), "target": fields.get("target", "")})

    if head.get("grammar") != "stories-v1":
        raise StoriesRefusal("grammar: **Grammar:** stories-v1 is missing")
    if head.get("stack") not in STACKS:
        raise StoriesRefusal("grammar: Stack %s is not one this plugin knows" % head.get("stack"))
    if head.get("kind") not in KINDS:
        raise StoriesRefusal("grammar: Kind must be behaviour or preserve")
    if not head.get("plan-id"):
        raise StoriesRefusal("grammar: **Plan-id:** is missing")
    sm = STORE_RE.match(head.get("store", ""))
    if sm is None:
        raise StoriesRefusal("grammar: **Store:** must be `path` sha256:<64 hex>")
    by_piece = {}
    for t in tasks:
        if not t["piece"]:
            raise StoriesRefusal("grammar: task %s names no **Piece:**" % t["id"])
        if t["piece"] in by_piece:
            raise StoriesRefusal("grammar: piece %s has two tasks" % t["piece"])
        by_piece[t["piece"]] = t
    edges = []
    for t in tasks:
        for dep in t["depends_pieces"]:
            if dep not in by_piece:
                raise StoriesRefusal("grammar: task %s depends on piece %s, which has no task" % (t["id"], dep))
            edges.append({"from": by_piece[dep]["id"], "to": t["id"],
                          "why": "piece %s depends on %s" % (t["piece"], dep)})
    for t in tasks:
        t["files"] = sorted(t["files"])
        t["depends_on"] = [e["from"] for e in edges if e["to"] == t["id"]]
        t["proofRuns"], t["proofRunClauses"] = [], []
        t["interfaces"] = {"consumes": [], "produces": []}
    sections = task_sections(text)
    for t in tasks:
        t["body"] = sections.get(t["id"], "")
    by_id = {t["id"]: t for t in tasks}
    # A TinyApp plan that publishes carries the same three header lines a claims plan does;
    # the boot deploys after the self-merge and verifies with ULTRA_PUBLISH_URL set.
    unwrap = lambda v: v[1:-1] if v and len(v) > 1 and v[0] == v[-1] == "`" else v
    publish = None
    if head.get("publish") or head.get("verify"):
        publish = {"deploy": unwrap(head.get("publish")) or None, "verify": unwrap(head.get("verify")) or None,
                   "rollback": unwrap(head.get("rollback")) or None}
    return {
        "grammar": "stories-v1", "stack": head["stack"], "plan_id": head["plan-id"],
        "kind": head["kind"], "summary": head.get("summary", ""),
        "store": {"path": sm.group(1), "sha256": sm.group(2)},
        "stories": stories, "links": links, "numbers": numbers, "guards": guards,
        "tasks": tasks, "dag_edges": edges,
        "launch_waves": [[by_id[i] for i in w] for w in _layers([t["id"] for t in tasks], edges)],
        "checks": [], "bootstrapCmd": "bun install", "publish": publish,
    }
