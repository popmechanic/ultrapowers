#!/usr/bin/env python3
"""The weave census (#1401): did a Flock merge ever write a line neither builder wrote? Not a
test: nothing runs it automatically; run it to re-read the answer over newer runs.

    python3 evals/readings/weave_census.py <fleet-evidence clone> <ultrapowers checkout> > census.json

Over every Flock run tagged in the evidence repository (a run whose events carry `builder:open`
or `edge` rows) it prints three lists as JSON:
  runs        per run: fallback, conflict and peer-rewrite event counts, multi-writer paths;
  fused       per run that landed on this repository's main: every added line holding a token that
              is two of the file's earlier tokens run together (run-277's species), and whether
              that token is still on origin/main. The scan names candidates; a person reads each;
  provenance  per run with a weave-ops digest: every line of the final snapshot is in the base or
              in some builder's edit or recorded rewrite, else `unknown` (a shell rewrite whose
              text was not recorded) or `FOREIGN`. The base read is the landed commit's parent,
              which is later than the run's base when main moved under it (a catch-up): a
              `FOREIGN` line there can be the run's own base line (run-264)."""
import collections, hashlib, json, os, re, subprocess, sys

FE = sys.argv[1]            # fleet-evidence clone
UP = sys.argv[2]            # ultrapowers checkout


def git(repo, *a):
    return subprocess.run(["git", "-C", repo, *a], capture_output=True).stdout.decode("utf-8", "replace")


def show(tag, name):
    return git(FE, "show", f"{tag}:{name}")


def fused(line, pre_tokens):
    """Whitespace tokens of `line` that are two pre-image tokens run together and are not
    themselves pre-image tokens (`snapshots.jsonlred-checks.json`)."""
    hits = []
    for t in line.split():
        if t in pre_tokens or len(t) < 8:
            continue
        for i in range(4, len(t) - 3):
            if t[:i] in pre_tokens and t[i:] in pre_tokens:
                hits.append((t, t[:i], t[i:]))
                break
    return hits


rows, fuse_hits, prov = [], [], []
for tag in git(FE, "tag").split():
    files = git(FE, "ls-tree", "-r", "--name-only", tag).split()
    ev_name = next((f for f in files if f.endswith("/events.jsonl")), None)
    if not ev_name:
        continue
    evs = [json.loads(l) for l in show(tag, ev_name).splitlines() if l.strip().startswith("{")]
    kinds = collections.Counter(e.get("kind") for e in evs)
    if not (kinds["builder:open"] or kinds["edge"]):
        continue                                                  # not a Flock run
    d = os.path.dirname(ev_name)
    writers = collections.defaultdict(set)
    for e in evs:
        if e.get("kind") in ("edit", "fallback") and e.get("path"):
            writers[e["path"]].add(e["agent"])
    pull_conf = sum(1 for e in evs if e.get("kind") == "pull" for c in e.get("changed", []) if c.get("conflict"))
    status = {}
    if f"{d}/status.json" in files:
        try:
            status = json.loads(show(tag, f"{d}/status.json"))
        except ValueError:
            pass
    ts = next((e.get("ts") for e in evs if e.get("ts")), "")
    row = {
        "tag": tag, "date": ts[:10],
        "fallback": kinds["fallback"],
        "fallback_peer": sum(1 for e in evs if e.get("kind") == "fallback" and e.get("peer_lines", 0) > 0),
        "edit_peer": sum(1 for e in evs if e.get("kind") == "edit" and e.get("peer_lines", 0) > 0),
        "conflict_open": kinds["conflict:open"], "conflict_close": kinds["conflict:close"],
        "conflict_union": kinds["conflict:union"], "pull_conflict": pull_conf,
        "multi_writer_paths": sorted(p for p, w in writers.items() if len(w) > 1),
        "merged": status.get("merged"), "pr": status.get("pr"),
    }
    rows.append(row)

    # ── landed text: fused tokens in every added line of the squash commit on this repo's main
    if tag.startswith("popmechanic-ultrapowers/") and row["merged"] and git(UP, "cat-file", "-t", row["merged"]).strip() == "commit":
        sha = row["merged"]
        for path in git(UP, "diff", "--name-only", f"{sha}^", sha).split():
            pre = git(UP, "show", f"{sha}^:{path}")
            pre_tok = set(pre.split())
            post = git(UP, "show", f"{sha}:{path}")
            added = set(post.split("\n")) - set(pre.split("\n"))
            for l in added:
                for h in fused(l, pre_tok):
                    on_main = h[0] in git(UP, "show", f"origin/main:{path}")
                    fuse_hits.append({"tag": tag, "sha": sha[:8], "path": path, "token": h[0], "parts": h[1:],
                                      "writers": sorted(writers.get(path, [])), "still_on_main": on_main})

    # ── provenance: every line of the final snapshot's changed files, against base ∪ what agents wrote
    ops_name = next((f for f in files if "weave-ops" in f), None)
    st_name = f"{d}/snapshot-texts.json"
    sn_name = f"{d}/snapshots.jsonl"
    if ops_name and st_name in files and sn_name in files and row["merged"] and tag.startswith("popmechanic-ultrapowers/"):
        texts = json.loads(show(tag, st_name))["texts"]
        snaps = [json.loads(l) for l in show(tag, sn_name).splitlines() if l.strip()]
        ops = [json.loads(l) for l in show(tag, ops_name).splitlines() if l.strip()]
        wrote = collections.defaultdict(set)      # path -> lines some agent put there
        blind = set()                             # paths with a shell rewrite whose text is not on record
        for o in ops:
            if o["op"] == "edit":
                wrote[o["path"]].update(o["lines"])
            elif o["op"] == "rewrite":
                t = texts.get(o.get("content_sha1") or "")
                if t is None and o.get("content_sha1"):
                    blind.add(o["path"])
                elif t is not None:
                    wrote[o["path"]].update(t.split("\n"))
        base = f"{row['merged']}^"
        final = snaps[-1] if snaps else {"changed": []}
        for c in final["changed"]:
            text = texts.get(c["sha1"])
            if text is None:
                prov.append({"tag": tag, "path": c["path"], "class": "final-text-missing"})
                continue
            base_lines = set(git(UP, "show", f"{base}:{c['path']}").split("\n"))
            stray = [l for l in text.split("\n") if l not in base_lines and l not in wrote[c["path"]]]
            cls = "clean" if not stray else ("unknown(rewrite text unrecorded)" if c["path"] in blind else "FOREIGN")
            prov.append({"tag": tag, "path": c["path"], "class": cls, "lines": len(text.split("\n")),
                         "stray": stray[:5], "n_stray": len(stray)})

json.dump({"runs": rows, "fused": fuse_hits, "provenance": prov}, sys.stdout, indent=1)
