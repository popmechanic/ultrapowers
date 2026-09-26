"""Gap 5's two limits, as design, tested against known truth (map #1292 ticket 2).

Lifecycle: a candidate is a PRIVATE copy (r_cand_open), edited in private
(r_cand_edit), published HIDDEN (r_cand_publish), and made visible by a count
move on any copy (r_select), undone the same way (r_rehide). Partial adoption
is a fresh line placed by the adopter (r_adopt). Every step is the vendored
kernel plus the keeper's sidecar; nothing forks Manyana.
"""
import itertools, json, sys
import _lib as L

M, W = L.M, L.W
P = "src/csv.js"
BASE = ["function importCsv(text) {", "  const header = text.slice(0, 1)", "}", "",
        "function exportCsv(rows) {", "  return rows.join('\\n')", "}"]
C1 = ["  const rows = text.split('\\n')", "  if (!rows.length) throw new Error('empty')"]
C2 = ["  const rows = parse(text, { strict: true })", "  return rows.map(toWidget)"]
PEER = "  // peer C: a comment in exportCsv"


def view(k, who):
    return k.lines(who, P)


def join_all(k, order):
    return k.r_merged(order=order)


def run():
    out = {}
    k = L.keeper({P: BASE})
    # two candidates for the same slot, each private, each replacing base line 1
    k.r_cand_open("A", "c1"); k.r_cand_edit("c1", P, 1, 2, C1)
    k.r_cand_open("B", "c2"); k.r_cand_edit("c2", P, 1, 2, C2)
    k.r_edit("C", P, 6, 6, [PEER]); k.r_publish("C")
    # (b) privacy: before publish, nobody else holds a candidate line
    k.r_pull("A"); k.r_pull("B")
    out["b1 private until published"] = {
        "A sees base+peer only": view(k, "A") == BASE[:6] + [PEER] + BASE[6:],
        "c1's author sees its own candidate": view(k, "c1") == BASE[:1] + C1 + BASE[2:]}
    # publish hidden: peers merge the lines but see base (the replaced line stays!)
    k.r_cand_publish("c1"); k.r_cand_publish("c2")
    k.r_pull("A"); k.r_pull("B"); k.r_pull("C")
    held = sum(1 for e in M.deserialize_state(k.state("A", P)) if W.SEP in e[0])
    m = join_all(k, ["C", "c1", "c2"])
    out["b2 published hidden"] = {
        "peers hold the candidate lines": held == 4,
        "peers still see base + peer": view(k, "A") == BASE[:6] + [PEER] + BASE[6:],
        "a pending delete is withheld (base line 1 still visible)": BASE[1] in view(k, "C"),
        "no conflict": not m["conflicts"],
        "order-free": len({join_all(k, list(o))["digest"] for o in itertools.permutations(["C", "c1", "c2"])}) == 1}
    # the author keeps seeing its candidate after pulling peers that hold it hidden
    k.r_cand_pull("c1")
    out["b3 the author's view survives a pull"] = {"c1 sees C1": view(k, "c1") == BASE[:1] + C1 + BASE[2:6] + [PEER] + BASE[6:]}
    # select c2 on A only; B stays stale; gossip carries it
    k.r_select("A", "c2"); k.r_publish("A")
    k.r_publish("B")
    want = BASE[:1] + C2 + BASE[2:6] + [PEER] + BASE[6:]
    m = join_all(k, ["A", "B", "C", "c1", "c2"])
    digests = {join_all(k, list(o))["digest"] for o in itertools.permutations(["A", "B", "C", "c1", "c2"])}
    out["s1 select c2 on one copy"] = {"text exactly as intended": m["files"][P].split("\n") == want,
                                        "conflict": bool(m["realConflicts"]), "shadow conflict (hidden-only)": bool(m["conflicts"]) and not m["realConflicts"], "order-free (120 orders)": len(digests) == 1}
    # re-hide, then re-select, on different copies
    k.r_pull("B"); k.r_rehide("B", "c2"); k.r_publish("B")
    m = join_all(k, ["A", "B", "C", "c1", "c2"])
    out["s2 re-hide on another copy"] = {"base restored exactly": m["files"][P].split("\n") == BASE[:6] + [PEER] + BASE[6:]}
    k.r_pull("C"); k.r_select("C", "c2"); k.r_publish("C")
    m = join_all(k, ["A", "B", "C", "c1", "c2"])
    out["s3 re-select"] = {"c2 back exactly": m["files"][P].split("\n") == want, "conflict": bool(m["realConflicts"])}

    # (a) partial adoption: c2 selected, adopt c1's guard line BETWEEN c2's two lines
    k.r_pull("A")
    before = view(k, "A")
    at = before.index(C2[0])
    k.r_adopt("A", P, C1[1], at)
    k.r_edit("D", P, 0, 0, ["// peer D: a header comment"]); k.r_publish("D")
    k.r_publish("A")
    want_a = ["// peer D: a header comment"] + BASE[:1] + [C2[0], C1[1], C2[1]] + BASE[2:6] + [PEER] + BASE[6:]
    m = join_all(k, ["A", "B", "C", "D", "c1", "c2"])
    ords = {join_all(k, list(o))["digest"] for o in itertools.permutations(["A", "B", "C", "D", "c1", "c2"])}
    out["a1 adopt c1's guard between c2's lines (re-insert)"] = {
        "placed exactly where chosen": m["files"][P].split("\n") == want_a,
        "conflict": bool(m["realConflicts"]), "order-free (720 orders)": len(ords) == 1}
    # the old design: raise the hidden line's count instead -> it lands where c1 hangs
    k2 = L.keeper({P: BASE})
    k2.r_cand_open("A", "c1"); k2.r_cand_edit("c1", P, 1, 2, C1); k2.r_cand_publish("c1")
    k2.r_cand_open("B", "c2"); k2.r_cand_edit("c2", P, 1, 2, C2); k2.r_cand_publish("c2")
    k2.r_pull("A"); k2.r_select("A", "c2")
    key = [kk for e, kk in zip(M.deserialize_state(k2.state("A", P)), W.line_keys(k2.state("A", P))) if e[0].startswith(C1[1])]
    st, _ = W.bump(k2.state("A", P), set(key), 1)
    got = [W.strip(l) for l in M.current_lines(st)]
    out["a0 the count-move adoption (gap 5's shape)"] = {"result": got,
                                                        "guard lands before the return": got.index(C1[1]) < got.index(C2[1])}
    # two selectors adopt the same line at the same place concurrently -> one line
    k3 = L.keeper({P: BASE})
    for who in ("A", "B"):
        k3.r_edit(who, P, 1, 2, C2)            # both already hold the selected text
    k3.r_publish("A"); k3.r_publish("B")
    k3.r_pull("A"); k3.r_pull("B")
    for who in ("A", "B"):
        k3.r_adopt(who, P, C1[1], k3.lines(who, P).index(C2[0])); k3.r_publish(who)
    m = k3.r_merged()
    out["a2 the same adoption twice, concurrently"] = {"adopted line appears once": m["files"][P].split("\n").count(C1[1]) == 1,
                                                       "conflict": bool(m["conflicts"])}
    # two candidates carrying the SAME line text at the same anchor stay two lines
    k4 = L.keeper({P: BASE})
    for c, who in (("x", "A"), ("y", "B")):
        k4.r_cand_open(who, c); k4.r_cand_edit(c, P, 2, 2, ["  return rows"]); k4.r_cand_publish(c)
    k4.r_pull("A"); k4.r_select("A", "x"); k4.r_publish("A")
    m = k4.r_merged()
    out["t1 identical lines in two candidates"] = {"select x shows exactly one": m["files"][P].split("\n").count("  return rows") == 1}
    # two copies select DIFFERENT candidates at once (kept from the gap reading)
    k5 = L.keeper({P: BASE})
    k5.r_cand_open("A", "c1"); k5.r_cand_edit("c1", P, 1, 2, C1); k5.r_cand_publish("c1")
    k5.r_cand_open("B", "c2"); k5.r_cand_edit("c2", P, 1, 2, C2); k5.r_cand_publish("c2")
    k5.r_pull("A"); k5.r_pull("B")
    k5.r_select("A", "c1"); k5.r_select("B", "c2"); k5.r_publish("A"); k5.r_publish("B")
    m = k5.r_merged()
    out["t2 two different selections at once"] = {"conflict flagged": bool(m["realConflicts"])}
    return out


FILES = ["factory/engine.mjs", "fleet/launch.mjs", "skills/ultrapowers/kernel/fold_wave.py"]


def apply_base(base, edits):
    out, pos = [], 0
    for a, z, new in sorted(edits, key=lambda e: (e[0], e[1])):
        out += base[pos:a] + new
        pos = z
    return out + base[pos:]


def stress(n_per_file, seed=1292):
    """Known truth at scale: per trial, 2-3 private candidates replace one
    region; 2 peers edit elsewhere (>= 4 lines away); some copies stay stale;
    one candidate is selected on one copy, then re-hidden on another, then a
    line of a loser is adopted after a chosen line of the winner. Every edit is
    in BASE coordinates, so the right text is exact."""
    import random, collections
    rng = random.Random(seed)
    t = collections.Counter()
    for path in FILES:
        base = L.read(path)
        n = len(base)
        for trial in range(n_per_file):
            a = rng.randrange(20, n - 30)
            z = a + rng.randint(1, 5)
            ncand = rng.choice([2, 3])
            cands = []
            for c in range(ncand):
                src = rng.randrange(0, n - 8)
                body = base[src:src + rng.randint(1, 6)]
                cands.append([l + (" /*c%d*/" % c if rng.random() < 0.7 else "") for l in body] or ["//c%d" % c])
            peers = []
            for pz in range(2):
                while True:
                    pa = rng.randrange(0, n - 2)
                    if pa + 3 < a - 4 or pa > z + 4:
                        if all(pa + 3 < qa - 1 or pa > qz + 1 for qa, qz, _ in peers):
                            break
                pzz = pa + rng.randint(0, 2)
                peers.append((pa, pzz, [base[pa] + " // peer%d" % pz] if pzz > pa or rng.random() < .5 else ["// peer%d" % pz]))
            k = L.keeper({path: base})
            agents = ["A", "B", "C"]
            for i, c in enumerate(cands):
                k.r_cand_open(agents[i % 3], "c%d" % i)
                k.r_cand_edit("c%d" % i, path, a, z, c)
            for i, (pa, pzz, new) in enumerate(peers):
                who = "P%d" % i
                k.r_edit(who, path, pa, pzz, new, refine=False)
                k.r_publish(who)
            for i in range(ncand):
                k.r_cand_publish("c%d" % i)
            for who in agents:
                if rng.random() < 0.6:          # some copies stay stale
                    k.r_pull(who)
                k.r_publish(who)
            win = rng.randrange(ncand)
            sel = rng.choice(agents)
            k.r_pull(sel)
            k.r_select(sel, "c%d" % win)
            k.r_publish(sel)
            names = list(k.published)
            truth = apply_base(base, [(a, z, cands[win])] + peers)
            digests, real, shadow = set(), False, False
            for _ in range(3):
                rng.shuffle(names)
                m = k.r_merged(order=list(names))
                digests.add(m["digest"])
                real |= bool(m["realConflicts"])
                shadow |= bool(m["conflicts"]) and not m["realConflicts"]
            got = m["files"][path].split("\n")
            t[("select", "right" if got == truth else "WRONG")] += 1
            t[("select", "real conflict" if real else "no real conflict")] += 1
            t[("select", "shadow conflict" if shadow else "no shadow")] += 1
            t[("select", "order-free" if len(digests) == 1 else "ORDER-DEPENDENT")] += 1
            # re-hide on a different copy
            other = rng.choice([x for x in agents if x != sel])
            k.r_pull(other)
            k.r_rehide(other, "c%d" % win)
            k.r_publish(other)
            m = k.r_merged()
            t[("rehide", "right" if m["files"][path].split("\n") == apply_base(base, peers) else "WRONG")] += 1
            t[("rehide", "real conflict" if m["realConflicts"] else "no real conflict")] += 1
            # re-select, then adopt one loser line after a chosen winner line
            k.r_pull(sel)
            k.r_select(sel, "c%d" % win)
            lose = rng.choice([i for i in range(ncand) if i != win])
            line = rng.choice(cands[lose])
            after_in = rng.randrange(len(cands[win]))
            vis = k.lines(sel, path)
            # the winner's lines sit at BASE a (peers before a shift it)
            shift = sum(len(new) - (pzz - pa) for pa, pzz, new in peers if pa < a)
            k.r_adopt(sel, path, line, a + shift + after_in)
            k.r_publish(sel)
            want = apply_base(base, [(a, z, cands[win][:after_in + 1] + [line] + cands[win][after_in + 1:])] + peers)
            m = k.r_merged()
            t[("adopt", "right" if m["files"][path].split("\n") == want else "WRONG")] += 1
            t[("adopt", "real conflict" if m["realConflicts"] else "no real conflict")] += 1
            assert vis[a + shift:a + shift + len(cands[win])] == cands[win], "the test's own arithmetic"
    return {" / ".join(k_): v for k_, v in sorted(t.items())}


if __name__ == "__main__" and len(sys.argv) > 2 and sys.argv[2] == "stress":
    r = L.fold_wave.run_on_kernel_thread(stress, int(sys.argv[3]) if len(sys.argv) > 3 else 100)
    print(json.dumps(r, indent=1))
    json.dump(r, open(sys.argv[1], "w"), indent=1)
    sys.exit(0)

if __name__ == "__main__":
    r = L.fold_wave.run_on_kernel_thread(run)
    print(json.dumps(r, indent=1))
    bad = [(t, k, v) for t, d in r.items() for k, v in d.items() if isinstance(v, bool) and
           ((k == "conflict" and v) or (k not in ("conflict", "shadow conflict (hidden-only)") and not v and not t.startswith("a0")))]
    print("UNEXPECTED:", bad)
    if len(sys.argv) > 1:
        json.dump(r, open(sys.argv[1], "w"), indent=1)
