"""Is Manyana's line identity derivable and stable enough to key a sidecar?

weave.line_keys() names every entry by (parent, side, text, rank among
equal-text siblings) — the same thing merge_tree_lists matches on. This reading
drives 3 agents' persistent copies through the Flock pattern on the repo's large
files (edit calls, inserted lines copied from the same file so duplicates like
`}` and blank lines are everywhere, gossip interleaved), then asks:

  survival   every key the authorship sidecar recorded at edit time is still a
             key of the converged weave (a key that vanishes is a lost owner)
  converged  every copy ends byte-identical after gossip, whatever the order
  base lines each visible BASE line (known by its key in the initial weave) is
             attributed to `base` — by the keyed sidecar, and by the current
             text-keyed one (weave.INSERTED), side by side
  ranked     the share of entries whose key needed a rank > 0: the positional
             residue, where identity rests on sibling order
"""
import collections, json, os, random, sys
import _lib as L

M, W = L.M, L.W
FILES = ["factory/engine.mjs", "fleet/launch.mjs", "skills/ultrapowers/kernel/fold_wave.py"]


def edit(rng, vis):
    n = len(vis)
    kind = rng.choice(["insert", "insert", "delete", "replace"])
    if kind == "insert":
        at = rng.randrange(0, n + 1)
        src = rng.randrange(0, n)
        new = vis[src:src + rng.randint(1, 5)]
        if rng.random() < 0.3:
            new = [l + "  // x%d" % rng.randrange(1000) if l.strip() else l for l in new]
        return at, at, new or ["}"]
    a = rng.randrange(0, n - 1)
    z = min(n, a + rng.randint(1, 4))
    if kind == "delete":
        return a, z, []
    return a, z, [l + " /*e%d*/" % rng.randrange(1000) for l in vis[a:z]]


def ranks(st):
    ents = M.deserialize_state(st)
    parent = W._parents(ents)
    seen = collections.Counter()
    ranked = 0
    for i in sorted(range(len(ents)), key=lambda i: (ents[i][1], i)):
        key = (parent[i], ents[i][2], ents[i][0])
        ranked += seen[key] > 0
        seen[key] += 1
    return ranked, len(ents)


def trial(rng, path, base):
    W.INSERTED.clear()
    k = L.keeper({path: base})
    base_keys = set(W.line_keys(k.base[path]))
    agents = ["A", "B", "C"]
    for rnd in range(6):
        for a in agents:
            for _ in range(rng.randint(1, 2)):
                vis = k.lines(a, path)
                k.r_edit(a, path, *edit(rng, vis), refine=rng.random() < 0.5)
            k.r_publish(a)
        for a in rng.sample(agents, 2):
            k.r_pull(a)
    for _ in range(2):
        for a in agents:
            k.r_pull(a)
            k.r_publish(a)
    states = {k.state(a, path) for a in agents}
    final = k.state("A", path)
    fkeys = set(W.line_keys(final))
    recorded = set().union(*(set(k.auth(a).get(path, {})) for a in agents))
    ents = M.deserialize_state(final)
    keys = W.line_keys(ents)
    keyed = k.r_authors_keyed("A", path)["authors"]
    texted = k.r_authors("A", path)["authors"]
    vis_keys = [kk for e, kk in zip(ents, keys) if e[3] % 2]
    base_vis = [i for i, kk in enumerate(vis_keys) if kk in base_keys]
    rk, n = ranks(final)
    return {"recorded": len(recorded), "lost": len(recorded - fkeys), "converged": len(states) == 1,
            "base visible": len(base_vis),
            "base misattributed (keyed)": sum(1 for i in base_vis if keyed[i] != "base"),
            "base misattributed (text)": sum(1 for i in base_vis if texted[i] != "base"),
            "ranked": rk, "entries": n}


def main(n_per_file):
    rng = random.Random(359)
    tot = collections.Counter()
    for path in FILES:
        base = L.read(path)
        for _ in range(n_per_file):
            r = trial(rng, path, base)
            tot["trials"] += 1
            tot["trials converged"] += r["converged"]
            for key in ("recorded", "lost", "base visible", "base misattributed (keyed)",
                        "base misattributed (text)", "ranked", "entries"):
                tot[key] += r[key]
            tot["trials with a lost key"] += r["lost"] > 0
    return dict(tot)


if __name__ == "__main__":
    r = L.fold_wave.run_on_kernel_thread(main, int(sys.argv[2]) if len(sys.argv) > 2 else 20)
    json.dump(r, open(sys.argv[1] if len(sys.argv) > 1 else "keys.json", "w"), indent=1)
    print(json.dumps(r, indent=1))
