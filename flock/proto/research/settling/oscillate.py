#!/usr/bin/env python3
"""RESEARCH (map #1292, ticket 5). The oscillation detector, offline.

  python3 flock/proto/research/settling/oscillate.py <run dir> [...] [--json]

Reads a Flock run's own records and says whether the swarm oscillated: the same
content changed back and forth instead of converging. Four signals, each
mechanical, each from a record the host already writes:

  span    weave-ops.jsonl, replayed through the prototype's own keeper
          (flock/proto/weave.py, imported, never edited). Every edit call becomes
          one or more line-span transitions `before -> after` on a path, in the
          editing agent's own copy. A transition that exactly undoes an earlier
          one on the same path (its `after` is the other's `before` and its
          `before` the other's `after`) is a flip-back. Two or more alternating
          flip-backs on one span, by two or more agents, is an OSCILLATION
          (A -> B -> A -> B). One flip-back by another agent is a `revert` (legal:
          a peer fixing a line). Alternation inside one agent is `self_thrash`,
          which is a per-agent stall signal, not a swarm oscillation.
  line    snapshots.json: the merged code at every edge. A non-blank line that
          leaves a path, comes back, and leaves again is an OSCILLATION; one
          return is a `line_return`.
  hash    snapshots.json: a merged content hash that is revisited and then left
          again (H1, H2, H1, H2) is an OSCILLATION; one revisit is `hash_revisit`.
  conflict events.jsonl: a conflict on the same path (and, when the record has
          it, the same marked region) closed and reopened twice is an
          OSCILLATION; once is a `conflict_reopen`.

The detector also checks its own replay: every snapshot hash in snapshots.json
must be reproduced by merging the replayed published copies after some publish
(`fidelity`), or the span signal is not trusted for that run.
"""
import collections, difflib, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROTO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, PROTO)
import weave as W  # noqa: E402  (the prototype's keeper, read-only use)


def snap_hash(files):
    # byte-identical to host.mjs: sha1(JSON.stringify(m.files)).slice(0, 10)
    return hashlib.sha1(json.dumps(files, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()[:10]


def blank(lines):
    return all(not l.strip() for l in lines)


def sub_edits(before, vstart, vend, lines, refine=True):
    """The line-span transitions one edit call makes, refined as weave.r_edit refines."""
    old = before[vstart:vend]
    subs = [(tuple(old), tuple(lines))]
    if refine and old and lines:
        ops = difflib.SequenceMatcher(None, old, lines, autojunk=False).get_opcodes()
        subs = [(tuple(old[i1:i2]), tuple(lines[j1:j2])) for t, i1, i2, j1, j2 in ops if t != "equal"]
    return [(a, b) for a, b in subs if a != b and not (blank(a) and blank(b))]


def replay(run):
    """Replay weave-ops.jsonl; return the span transitions and the merged hashes seen."""
    W.INSERTED.clear()
    k = W.Keeper()
    trans = []          # (t, agent, path, before, after)
    merged_hashes = set()
    ops_path = os.path.join(run, "weave-ops.jsonl")
    if not os.path.exists(ops_path):
        return None, None
    for line in open(ops_path):
        o = json.loads(line)
        t, op = o.pop("t"), o.pop("op")
        if op == "base" and os.path.isdir(os.path.join(run, "base")):
            o["root"] = os.path.join(run, "base")
        if op == "edit":
            before = k.lines(o["agent"], o["path"])
            for a, b in sub_edits(before, o["vstart"], o["vend"], o["lines"]):
                trans.append((t, o["agent"], o["path"], a, b))
        elif op == "rewrite":
            before = k.lines(o["agent"], o["path"])
            new = [] if o["content"] is None else o["content"].split("\n")
            for tg, i1, i2, j1, j2 in difflib.SequenceMatcher(None, before, new, autojunk=False).get_opcodes():
                if tg != "equal":
                    for a, b in sub_edits(before, i1, i2, new[j1:j2], refine=False):
                        trans.append((t, o["agent"], o["path"], a, b))
        getattr(k, "r_" + op)(**o)
        if op == "publish":
            merged_hashes.add(snap_hash(k.r_merged()["files"]))
    return trans, merged_hashes


def span_signal(trans):
    """Chain each path's transitions (a transition continues the chain whose latest content is
    its `before`), then read each chain's sequence of contents. A content that comes back and is
    then left again is an oscillation (A->B->A->B, or a longer cycle A->B->C->A->B)."""
    chains = collections.defaultdict(list)   # path -> [ {states, agents, t} ]
    for t, agent, path, a, b in trans:
        open_ = [c for c in chains[path] if c["states"][-1] == a]
        if open_:
            c = open_[-1]
        else:
            c = {"states": [a], "steps": []}
            chains[path].append(c)
        c["states"].append(b)
        c["steps"].append((t, agent))
    out = {"oscillations": [], "reverts": [], "self_undos": [], "self_thrash": []}
    for path, cs in chains.items():
        for c in cs:
            st = c["states"]
            revisits = [j for j in range(2, len(st)) if st[j] in st[:j]]
            if not revisits:
                continue
            departed = any(j < len(st) - 1 for j in revisits)
            agents = sorted({a for _, a in c["steps"]})
            row = {"path": path, "states": len(st), "flip_backs": len(revisits), "agents": agents,
                   "contents": [list(x)[:2] for x in st[:4]], "t": [t for t, _ in c["steps"]]}
            if departed and len(agents) >= 2:
                out["oscillations"].append(row)
            elif departed:
                out["self_thrash"].append(row)
            elif len(agents) >= 2:
                out["reverts"].append(row)
            else:
                out["self_undos"].append(row)
    return out


def line_signal(snaps):
    """A non-blank line that leaves a path, returns, and leaves again, in the merged snapshots."""
    state = collections.defaultdict(lambda: collections.defaultdict(list))  # path -> line -> [present bools]
    paths = set()
    for s in snaps:
        paths |= set(s["files"])
    for s in snaps:
        for p in paths:
            c = collections.Counter(s["files"].get(p, "").split("\n"))
            for line in set(c) | set(state[p]):
                if line.strip():
                    state[p][line].append(c.get(line, 0))
    returns, osc = [], []
    for p, lines in state.items():
        for line, counts in lines.items():
            # count left/returned on the multiplicity series
            lefts = rets = 0
            peak = counts[0]
            for x, y in zip(counts, counts[1:]):
                if y < x:
                    lefts += 1
                elif y > x and lefts > rets and y <= peak:
                    rets += 1
                peak = max(peak, y)
            if rets and lefts > rets:
                osc.append({"path": p, "line": line[:80], "series": counts})
            elif rets:
                returns.append({"path": p, "line": line[:80], "series": counts})
    return {"oscillations": osc, "line_returns": returns}


def hash_signal(snaps):
    seq = [s["snap"] for s in snaps]
    revisits, osc = [], []
    first = {}
    for i, h in enumerate(seq):
        if h in first and i - first[h] > 1:
            left_again = i + 1 < len(seq) and seq[i + 1] != h
            (osc if left_again and seq[i + 1] in seq[:i] else revisits).append({"hash": h, "at": [first[h], i]})
        first.setdefault(h, i)
    return {"oscillations": osc, "hash_revisits": revisits, "sequence": seq}


def conflict_signal(events):
    hist = collections.defaultdict(list)
    for e in events:
        if e["kind"] in ("conflict:open", "conflict:close"):
            key = (e["path"], e.get("region"))
            hist[key].append(e["kind"].split(":")[1])
    reopens, osc = [], []
    for (path, region), seq in hist.items():
        n = sum(1 for a, b in zip(seq, seq[1:]) if a == "close" and b == "open")
        if n >= 2:
            osc.append({"path": path, "region": region, "sequence": seq})
        elif n == 1:
            reopens.append({"path": path, "region": region, "sequence": seq})
    return {"oscillations": osc, "conflict_reopens": reopens}


def detect(run):
    snaps_p = os.path.join(run, "snapshots.json")
    snaps = json.load(open(snaps_p)) if os.path.exists(snaps_p) else []
    ev_p = os.path.join(run, "events.jsonl")
    events = [json.loads(l) for l in open(ev_p) if l.strip()] if os.path.exists(ev_p) else []
    trans, merged = replay(run)
    rec = {s["snap"] for s in snaps}
    fidelity = None if merged is None else (len(rec & merged), len(rec))
    span = span_signal(trans) if trans is not None else None
    line = line_signal(snaps)
    hsh = hash_signal(snaps)
    con = conflict_signal(events)
    trusted_span = span is not None and fidelity is not None and fidelity[1] > 0 and fidelity[0] == fidelity[1]
    # With a trusted replay the span signal decides (it knows who wrote what, so it can tell
    # one agent's own thrash from two agents' tug of war); the merged-snapshot signals are then
    # corroboration. Without one, the snapshot signals decide.
    content = len(span["oscillations"]) if trusted_span else len(line["oscillations"]) + len(hsh["oscillations"])
    osc = content + len(con["oscillations"])
    return {
        "run": os.path.basename(os.path.normpath(run)),
        "oscillations": osc,
        "verdict": "OSCILLATING" if osc else "converging",
        "decided_by": ("span+conflict" if trusted_span else "line+hash+conflict"),
        "replay_fidelity": fidelity and f"{fidelity[0]}/{fidelity[1]} recorded snapshots reproduced",
        "transitions": None if trans is None else len(trans),
        "span": span and {k: len(v) for k, v in span.items()},
        "line": {k: len(v) for k, v in line.items()},
        "hash": {"oscillations": len(hsh["oscillations"]), "revisits": len(hsh["hash_revisits"]), "snapshots": len(hsh["sequence"])},
        "conflict": {k: len(v) for k, v in con.items()},
        "detail": {"span": span, "line": line, "hash": hsh, "conflict": con},
    }


def main():
    runs = [a for a in sys.argv[1:] if not a.startswith("--")]
    rows = [detect(r) for r in runs]
    if "--json" in sys.argv:
        print(json.dumps(rows, indent=1))
        return
    if "--check" in sys.argv:
        # synthetic runs carry expect.json; a real run is expected to converge
        bad = 0
        for run, r in zip(runs, rows):
            ep = os.path.join(run, "expect.json")
            exp = json.load(open(ep)) if os.path.exists(ep) else {"oscillating": False}
            ok = (r["oscillations"] > 0) == exp["oscillating"]
            for key in ("reverts", "self_thrash"):
                if key in exp:
                    ok = ok and r["span"] is not None and r["span"][key] == exp[key]
            bad += not ok
            print(f"{'ok ' if ok else 'BAD'} {r['run'][:40]:40} expected {'OSCILLATING' if exp['oscillating'] else 'converging':12}"
                  f" got {r['verdict']:12} (by {r['decided_by']}; span {r['span']}; conflict {r['conflict']})")
        print(f"{len(rows) - bad}/{len(rows)} as expected")
        sys.exit(1 if bad else 0)
    for r in rows:
        print(f"{r['run'][:44]:44} {r['verdict']:12} osc={r['oscillations']} "
              f"fidelity={r['replay_fidelity']} transitions={r['transitions']} "
              f"span={r['span']} line={r['line']} hash={r['hash']} conflict={r['conflict']}")


if __name__ == "__main__":
    W.fold_wave.run_on_kernel_thread(main)
