"""Gap 3 / #359 — can a weave built from EDIT CALLS keep line identity?

`apply_edit` is our wrapper, not a patch to the vendored kernel: it reads and
writes Manyana's documented state format, marks exactly the lines an edit call
deleted, and inserts with `update_state`'s own depth/anchor rule — no diff, so
no guessing. Three experiments, all against known truth:

  1  the one silent wrong from the stress test (fleet/launch.mjs 891-895)
  2  the stress test again: pairs and triples, edit-built vs diff-built weaves
  3  the Flock pattern: 3 agents x 4 edits each on a PERSISTENT replica,
     gossip merges interleaved with edits; each later edit is located the way
     Claude's Edit tool locates it (a text block that must occur exactly once
     in the agent's current file, extended with context until unique)
"""
import collections, json, os, random, sys

KERNEL = "/Users/marcusestes/Websites/ultrapowers/skills/ultrapowers/kernel"
sys.path[:0] = [KERNEL, KERNEL + "/vendor"]
import manyana, fold_wave  # noqa: E402

REPO = "/Users/marcusestes/Websites/ultrapowers"
FILES = ["factory/engine.mjs", "fleet/launch.mjs", "skills/ultrapowers/kernel/fold_wave.py",
         "factory/boot.sh", "fleet/CONTRACT.md", "CLAUDE.md"]


def visible(state):
    return manyana.current_lines(state)


def apply_edit(state_str, vstart, vend, new_lines):
    """Delete visible lines [vstart, vend) and insert new_lines there."""
    state = manyana.deserialize_state(state_str)
    if not state:
        return manyana.initial_state(new_lines)
    vis = [i for i, e in enumerate(state) if e[3] % 2]
    for d in vis[vstart:vend]:
        state[d][3] += 1
    if not new_lines:
        return manyana.serialize_state(state)
    if vend > vstart:
        pos = vis[vstart]
    elif vstart > 0:
        pos = vis[vstart - 1] + 1
    else:
        pos = 0
    result = []
    for p in range(len(state) + 1):
        if p == pos:
            if p == len(state):
                up = True
            elif p == 0:
                up = False
            else:
                up = state[p - 1][1] > state[p][1]
            if up:
                result.append([new_lines[0], state[p - 1][1] + 1, False, 1])
            else:
                result.append([new_lines[0], state[p][1] + 1, True, 1])
            for line in new_lines[1:]:
                result.append([line, result[-1][1] + 1, False, 1])
        if p < len(state):
            result.append(state[p])
    return manyana.serialize_state(result)


def join(a, b):
    m, ann = manyana.merge_states(a, b)
    return m, ann != manyana.current_lines(m)


def apply_base(base, edits):
    out, pos = [], 0
    for a, z, new in sorted(edits, key=lambda e: (e[0], e[1])):
        out += base[pos:a] + new
        pos = z
    return out + base[pos:]


def make_edit(rng, base, lo=0, hi=None):
    hi = len(base) if hi is None else hi
    kind = rng.choice(["insert", "delete", "replace"])
    if kind == "insert":
        at = rng.randrange(lo, hi + 1)
        src = rng.randrange(0, len(base))
        new = base[src:src + rng.randint(1, 8)]
        if rng.random() < 0.5:
            new = [l + "  // x%d" % rng.randrange(1000) if l.strip() else l for l in new]
        return (at, at, new)
    a = rng.randrange(lo, max(lo + 1, hi - 1))
    z = min(hi, a + rng.randint(1, 6))
    if kind == "delete":
        return (a, z, [])
    return (a, z, [l + " /*e%d*/" % rng.randrange(1000) for l in base[a:z]])


def disjoint(edits):
    s = sorted(edits, key=lambda e: (e[0], e[1]))
    for x, y in zip(s, s[1:]):
        if y[0] < x[1]:
            return False
        if x[0] == x[1] and y[0] == x[0]:
            return False
    return True


def outcome(conf, got, truth):
    return "conflict" if conf else ("clean-right" if got == truth else "SILENT-WRONG")


def exp1():
    base = open(os.path.join(REPO, "fleet/launch.mjs")).read().split("\n")
    B0 = manyana.initial_state(base)
    truth = base[:891] + base[895:]
    out = {}
    for name, mk in (("diff-built", lambda e: manyana.update_state(B0, apply_base(base, [e]))),
                     ("edit-built", lambda e: apply_edit(B0, e[0], e[1], e[2]))):
        Wa, Wb = mk((892, 895, [])), mk((891, 892, []))
        m, c = join(Wa, Wb)
        out[name] = outcome(c, visible(m), truth)
    return out


def exp2(rng, n_pairs, n_triples):
    t = collections.Counter()
    for path in FILES:
        base = open(os.path.join(REPO, path)).read().split("\n")
        B0 = manyana.initial_state(base)
        made = 0
        while made < n_pairs:
            e, f = make_edit(rng, base), make_edit(rng, base)
            if not disjoint([e, f]):
                continue
            (a1, z1, _), (a2, z2, _) = sorted([e, f], key=lambda x: (x[0], x[1]))
            g = a2 - z1
            cls = "touching" if g == 0 else ("near" if g <= 3 else "far")
            if cls == "far" and made % 3:
                continue
            made += 1
            truth = apply_base(base, [e, f])
            for how in ("diff", "edit"):
                if how == "diff":
                    Wa, Wb = manyana.update_state(B0, apply_base(base, [e])), manyana.update_state(B0, apply_base(base, [f]))
                else:
                    Wa, Wb = apply_edit(B0, *e), apply_edit(B0, *f)
                m1, c1 = join(Wa, Wb)
                m2, _ = join(Wb, Wa)
                t[("pair", cls, how, outcome(c1, visible(m1), truth))] += 1
                t[("pair", cls, how, "order-free" if m1 == m2 else "ORDER-DEPENDENT")] += 1
        made = 0
        while made < n_triples:
            es = [make_edit(rng, base) for _ in range(3)]
            if not disjoint(es):
                continue
            made += 1
            truth = apply_base(base, es)
            Ws = [apply_edit(B0, *x) for x in es]
            states, conf = set(), False
            for order in [(0, 1, 2), (2, 1, 0), (1, 0, 2)]:
                s, c = Ws[order[0]], False
                for i in order[1:]:
                    s, ci = join(s, Ws[i])
                    c = c or ci
                states.add(s)
                conf = conf or c
            t[("triple", "-", "edit", outcome(conf, visible(next(iter(states))), truth))] += 1
            t[("triple", "-", "edit", "order-free" if len(states) == 1 else "ORDER-DEPENDENT")] += 1
    return t


def locate(view, base, a, z):
    """Edit-tool location: the base block [a,z) (or, for an insert, the base
    line at a) must occur exactly once in `view`; extend with following, then
    preceding, base lines until it does. Returns (vstart, vend) or None."""
    n = len(base)
    if a == z:  # insert before base line a: anchor on the line itself
        if a >= n:
            return (len(view), len(view)) if view and view[-1] == base[-1] else None
        blk_a, blk_z = a, a + 1
    else:
        blk_a, blk_z = a, z
    for extra_after in range(0, 12):
        for extra_before in range(0, 12):
            s, e = max(0, blk_a - extra_before), min(n, blk_z + extra_after)
            block = base[s:e]
            hits = [i for i in range(len(view) - len(block) + 1) if view[i:i + len(block)] == block]
            if len(hits) == 1:
                off = hits[0] + (blk_a - s)
                if a == z:
                    return (off, off)
                return (off, off + (z - a))
            if not hits:
                break
    return None


def exp3(rng, trials):
    t = collections.Counter()
    for path in FILES:
        base = open(os.path.join(REPO, path)).read().split("\n")
        B0 = manyana.initial_state(base)
        n = len(base)
        for trial in range(trials):
            cuts = sorted(rng.sample(range(10, n - 10), 2))
            regions = [(0, cuts[0]), (cuts[0], cuts[1]), (cuts[1], n)]
            plans = []
            for lo, hi in regions:
                es = []
                tries = 0
                while len(es) < 4 and tries < 200:
                    tries += 1
                    e = make_edit(rng, base, lo, hi)
                    if e[1] > hi or not disjoint(es + [e]):
                        continue
                    if any(abs(e[0] - x[1]) < 3 and abs(x[0] - e[1]) < 3 for x in es):
                        continue
                    es.append(e)
                plans.append(sorted(es, key=lambda e: (e[0], e[1])))
            truth = apply_base(base, [e for es in plans for e in es])
            for how in ("edit", "diff"):
                reps = [B0, B0, B0]
                conf, missed = False, 0
                for rnd in range(4):
                    for ag in range(3):
                        if rnd >= len(plans[ag]):
                            continue
                        a, z, new = plans[ag][rnd]
                        view = visible(reps[ag])
                        loc = locate(view, base, a, z)
                        if loc is None:
                            missed += 1
                            continue
                        if how == "edit":
                            reps[ag] = apply_edit(reps[ag], loc[0], loc[1], new)
                        else:
                            reps[ag] = manyana.update_state(reps[ag], view[:loc[0]] + new + view[loc[1]:])
                    for _ in range(2):
                        x, y = rng.sample(range(3), 2)
                        m, c = join(reps[x], reps[y])
                        conf = conf or c
                        reps[x] = reps[y] = m
                for x, y in [(0, 1), (1, 2), (0, 2), (0, 1)]:
                    m, c = join(reps[x], reps[y])
                    conf = conf or c
                    reps[x] = reps[y] = m
                same = len({r for r in reps}) == 1
                t[(how, "converged" if same else "DIVERGED")] += 1
                if missed:
                    t[(how, "an edit could not be located")] += 1
                    continue
                t[(how, outcome(conf, visible(reps[0]), truth))] += 1
    return t


def main():
    rng = random.Random(359)
    res = {"exp1": exp1()}
    t2 = exp2(rng, int(os.environ.get("N_PAIRS", 300)), int(os.environ.get("N_TRIPLES", 50)))
    res["exp2"] = [[list(k), v] for k, v in sorted(t2.items())]
    t3 = exp3(rng, int(os.environ.get("N_TRIALS", 40)))
    res["exp3"] = [[list(k), v] for k, v in sorted(t3.items())]
    return res


if __name__ == "__main__":
    r = fold_wave.run_on_kernel_thread(main)
    json.dump(r, open(sys.argv[1] if len(sys.argv) > 1 else "edits.json", "w"), indent=1)
    print(json.dumps(r["exp1"]))
    agg = collections.defaultdict(collections.Counter)
    for (kind, cls, how, o), v in r["exp2"]:
        agg[(kind, cls, how)][o] += v
    for k in sorted(agg):
        print(k, dict(agg[k]))
    for k, v in r["exp3"]:
        print("flock", k, v)
