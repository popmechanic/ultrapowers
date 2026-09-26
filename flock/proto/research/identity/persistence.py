"""Persistence: how a weave grows with history, and when compaction is owed.

One weave per file, driven by a long stream of edit calls through the keeper's
apply_edit (no diffing). At checkpoints the reading records the blob size, the
entry count, the share of dead lines, the deepest line, the cost of one edit,
of computing the identity keys, of a no-op merge (a pull that brings nothing),
and of a real merge (two copies forked at the checkpoint, 10 edits each). The
same merge on a compacted weave (initial_state of the visible text) is the
comparison: compaction is exactly the rebuild-from-BASE the engine does today.

Also read: how many edit calls one file actually took in one prototype run
(flock/proto/runs/*/weave-ops.jsonl), which is the scale a run-long weave sees.
"""
import collections, glob, json, os, random, statistics, sys, time
import _lib as L

M, W = L.M, L.W
FILES = ["factory/engine.mjs", "fleet/launch.mjs", "skills/ultrapowers/kernel/fold_wave.py"]
CHECKS = [0, 100, 250, 500, 1000, 2000, 4000]


def edit(rng, vis):
    n = len(vis)
    kind = rng.choice(["insert", "delete", "replace"])
    if kind == "insert" or n < 3:
        at = rng.randrange(0, n + 1)
        src = rng.randrange(0, max(1, n))
        new = vis[src:src + rng.randint(1, 8)] or ["// x"]
        if rng.random() < 0.5:
            new = [l + "  // x%d" % rng.randrange(1000) if l.strip() else l for l in new]
        return at, at, new
    a = rng.randrange(0, n - 1)
    z = min(n, a + rng.randint(1, 6))
    if kind == "delete":
        return a, z, []
    return a, z, [l + " /*e%d*/" % rng.randrange(1000) for l in vis[a:z]]


def ms(fn, reps=3):
    best = []
    for _ in range(reps):
        t0 = time.perf_counter()
        fn()
        best.append((time.perf_counter() - t0) * 1000)
    return round(statistics.median(best), 2)


def tree_depth(st):
    ents = M.deserialize_state(st)
    return max((e[1] for e in ents), default=0)


def fork_merge(rng, st):
    a, b = st, st
    for _ in range(10):
        a = W.apply_edit(a, *edit(rng, M.current_lines(a)))[0]
        b = W.apply_edit(b, *edit(rng, M.current_lines(b)))[0]
    return a, b


def stream(path, seed=1292):
    rng = random.Random(seed)
    base = L.read(path)
    st = M.initial_state(base)
    rows, done, window = [], 0, []
    for target in CHECKS:
        while done < target:
            vis = M.current_lines(st)
            e = edit(rng, vis)
            t0 = time.perf_counter()
            st = W.apply_edit(st, *e)[0]
            window.append((time.perf_counter() - t0) * 1000)
            done += 1
        ents = M.deserialize_state(st)
        vis = M.current_lines(st)
        a, b = fork_merge(random.Random(target), st)
        comp = M.initial_state(vis)
        ca, cb = fork_merge(random.Random(target), comp)
        rows.append({
            "edits": done, "bytes": len(st.encode()), "entries": len(ents), "visible": len(vis),
            "dead share": round(1 - len(vis) / max(1, len(ents)), 3), "max depth": tree_depth(st),
            "edit ms (mean over window)": round(statistics.mean(window), 2) if window else None,
            "keys ms": ms(lambda: W.line_keys(st), 1),
            "no-op merge ms": ms(lambda: M.merge_states(st, st)),
            "real merge ms": ms(lambda: M.merge_states(a, b)),
            "compacted bytes": len(comp.encode()), "compacted real merge ms": ms(lambda: M.merge_states(ca, cb)),
            "order-free": M.merge_states(a, b)[0] == M.merge_states(b, a)[0]})
        window = []
    return rows


def run_scale():
    """Edit calls per file per run, from the prototype's recorded op streams."""
    per = []
    for f in glob.glob(os.path.join(L.PROTO, "runs", "*", "weave-ops.jsonl")):
        c = collections.Counter()
        for line in open(f):
            op = json.loads(line)
            if op["op"] in ("edit", "rewrite"):
                c[op["path"]] += 1
        per += list(c.values())
    return {"files x runs": len(per), "max edits on one file in one run": max(per, default=0),
            "median": statistics.median(per) if per else 0}


def main():
    return {"scale": run_scale(), **{p: stream(p) for p in FILES}}


if __name__ == "__main__":
    r = L.fold_wave.run_on_kernel_thread(main)
    json.dump(r, open(sys.argv[1] if len(sys.argv) > 1 else "persistence.json", "w"), indent=1)
    print(json.dumps(r["scale"]))
    for p in FILES:
        print(p)
        for row in r[p]:
            print("  ", row)
