"""Concurrent-edit stress on real files — map #1292 ticket 1, part 2.

Every task is an edit in BASE coordinates on a real file, so the correct merge
is known: apply every edit by coordinate. Edits are inserts (lines copied from
elsewhere in the same file — realistic repetition), deletes and replaces.
Classes by the gap between two edits' ranges: 0 (touching), 1-3 (near), >3.

Per case: Manyana (autojunk on/off), git merge-file, and for k=3 the engine's
rebuild-per-fold against a persistent weave. Outcomes:
  clean-right   no conflict, text == truth
  conflict      flagged (a false conflict when the edits are disjoint)
  SILENT-WRONG  no conflict, text != truth   <- the failure that ships
"""
import collections, difflib, itertools, json, os, random, subprocess, sys, tempfile

KERNEL = "/Users/marcusestes/Websites/ultrapowers/skills/ultrapowers/kernel"
sys.path[:0] = [KERNEL, KERNEL + "/vendor"]
import manyana, fold_wave  # noqa: E402

REPO = "/Users/marcusestes/Websites/ultrapowers"
FILES = ["factory/engine.mjs", "fleet/launch.mjs", "skills/ultrapowers/kernel/fold_wave.py",
         "factory/boot.sh", "fleet/CONTRACT.md", "CLAUDE.md"]
SM = difflib.SequenceMatcher
N_PAIRS = int(os.environ.get("N_PAIRS", 400))   # per file
N_TRIPLES = int(os.environ.get("N_TRIPLES", 60))


def make_edit(rng, base):
    n = len(base)
    kind = rng.choice(["insert", "delete", "replace"])
    if kind == "insert":
        at = rng.randrange(0, n + 1)
        src = rng.randrange(0, n)
        new = base[src:src + rng.randint(1, 8)]
        if rng.random() < 0.5:
            new = [l + "  // x%d" % rng.randrange(1000) if l.strip() else l for l in new]
        return (at, at, new)
    a = rng.randrange(0, n - 1)
    z = min(n, a + rng.randint(1, 6))
    if kind == "delete":
        return (a, z, [])
    return (a, z, [l + " /*e%d*/" % rng.randrange(1000) for l in base[a:z]])


def gap(e, f):
    (a1, z1, _), (a2, z2, _) = sorted([e, f])
    return a2 - z1


def disjoint(edits):
    s = sorted(edits, key=lambda e: (e[0], e[1]))
    for x, y in zip(s, s[1:]):
        if y[0] < x[1] or (y[0] == x[0] and x[0] == x[1] and y[0] == y[1]):
            return False
        if x[0] == x[1] and y[0] == x[0]:
            return False  # an insert at the start of another edit: order ambiguous
    return True


def apply(base, edits):
    out, pos = [], 0
    for a, z, new in sorted(edits, key=lambda e: (e[0], e[1])):
        out += base[pos:a] + new
        pos = z
    return out + base[pos:]


def merge_file(cur, base, other):
    with tempfile.TemporaryDirectory() as d:
        fs = []
        for n, c in (("cur", cur), ("base", base), ("other", other)):
            f = os.path.join(d, n)
            open(f, "w").write("\n".join(c))
            fs.append(f)
        r = subprocess.run(["git", "merge-file", "-p", *fs], capture_output=True)
        return r.stdout.decode().split("\n"), r.returncode != 0


def mjoin(a, b):
    m, ann = manyana.merge_states(a, b)
    return m, ann != manyana.current_lines(m)


def outcome(conflict, got, truth):
    if conflict:
        return "conflict"
    return "clean-right" if got == truth else "SILENT-WRONG"


def junk(on):
    manyana.SequenceMatcher = SM if on else (lambda *x, **k: SM(*x, autojunk=False, **k))


def run():
    rng = random.Random(1292)
    tally = collections.Counter()
    examples = []
    for path in FILES:
        base = open(os.path.join(REPO, path)).read().split("\n")
        B0 = manyana.initial_state(base)
        made = 0
        while made < N_PAIRS:
            e, f = make_edit(rng, base), make_edit(rng, base)
            if not disjoint([e, f]):
                continue
            g = gap(e, f)
            cls = "touching" if g == 0 else ("near" if g <= 3 else "far")
            if cls == "far" and made % 3:   # keep far cases to about a third
                continue
            made += 1
            Ta, Tb, truth = apply(base, [e]), apply(base, [f]), apply(base, [e, f])
            for on in (True, False):
                junk(on)
                Wa, Wb = manyana.update_state(B0, Ta), manyana.update_state(B0, Tb)
                m1, c1 = mjoin(Wa, Wb)
                m2, c2 = mjoin(Wb, Wa)
                o = outcome(c1, manyana.current_lines(m1), truth)
                tally[("pair", path, cls, "manyana-junk-" + ("on" if on else "off"), o)] += 1
                tally[("pair", path, cls, "manyana-order-free", "yes" if m1 == m2 else "NO")] += 1 if on else 0
                if o == "SILENT-WRONG" and len(examples) < 12:
                    examples.append({"path": path, "cls": cls, "junk": on, "e": e[:2], "f": f[:2],
                                     "lens": (len(e[2]), len(f[2]))})
            junk(True)
            got, c = merge_file(Ta, base, Tb)
            tally[("pair", path, cls, "git", outcome(c, got, truth))] += 1
        # triples: the engine's rebuild vs a persistent weave
        made = 0
        while made < N_TRIPLES:
            es = [make_edit(rng, base) for _ in range(3)]
            if not disjoint(es):
                continue
            made += 1
            truth = apply(base, es)
            Ws = [manyana.update_state(B0, apply(base, [x])) for x in es]
            persist, cp = Ws[0], False
            head = apply(base, [es[0]])
            rebuilt_conf = False
            for i in (1, 2):
                persist, c = mjoin(persist, Ws[i])
                cp = cp or c
                fr = manyana.update_state(B0, head)
                mr, cr = mjoin(fr, Ws[i])
                rebuilt_conf = rebuilt_conf or cr
                head = manyana.current_lines(mr)
            tally[("triple", path, "-", "persistent", outcome(cp, manyana.current_lines(persist), truth))] += 1
            tally[("triple", path, "-", "rebuild", outcome(rebuilt_conf, head, truth))] += 1
            orders = {mjoin(mjoin(Ws[a], Ws[b])[0], Ws[c])[0] for a, b, c in itertools.permutations(range(3))}
            tally[("triple", path, "-", "order-free", "yes" if len(orders) == 1 else "NO")] += 1
        print(path, "done", file=sys.stderr)
    return tally, examples


if __name__ == "__main__":
    tally, examples = fold_wave.run_on_kernel_thread(run)
    json.dump({"tally": [[list(k), v] for k, v in sorted(tally.items())], "examples": examples},
              open(sys.argv[1] if len(sys.argv) > 1 else "stress.json", "w"), indent=1)
    print("ok")
