"""The same-line insert with no conflict flag (gap 3's Flock trials), made
deterministic, characterized, counted, and given a mechanical signal.

A  the two shapes, on four lines each, with git merge-file beside them
B  a stress on the repository's six large files: two agents insert at the
   SAME BASE position (blocks copied from elsewhere in the file, as agents do)
C  the prototype's own record: every recorded weave-op stream under
   flock/proto/runs replayed through the keeper, counting what the signal fires on

The signal is weave.same_anchor(): concurrent inserts that hang off one anchor,
from different authors, read from the keyed authorship sidecar.
"""
import collections, glob, json, os, random, subprocess, sys, tempfile
import _lib as L

M, W = L.M, L.W
FILES = ["factory/engine.mjs", "fleet/launch.mjs", "skills/ultrapowers/kernel/fold_wave.py",
         "factory/boot.sh", "fleet/CONTRACT.md", "CLAUDE.md"]


def git_merge(base, a, b):
    """git merge-file on three texts: (clean?, merged lines)."""
    with tempfile.TemporaryDirectory() as d:
        paths = []
        for name, lines in (("a", a), ("o", base), ("b", b)):
            p = os.path.join(d, name)
            with open(p, "w") as f:
                f.write("\n".join(lines) + "\n")
            paths.append(p)
        r = subprocess.run(["git", "merge-file", "-p", *paths], capture_output=True, text=True)
        return r.returncode == 0, r.stdout.rstrip("\n").split("\n")


def pair(base, path, at, xa, xb):
    """Agents A and B each insert a block before BASE line `at`; A publishes,
    B pulls (the host's path) and the edge joins both (the other path)."""
    k = L.keeper({path: base})
    k.r_edit("A", path, at, at, xa, refine=False)
    k.r_edit("B", path, at, at, xb, refine=False)
    k.r_publish("A"); k.r_publish("B")
    ch = {"conflict": False, "addsOnly": True, "sameAnchor": []}
    for who in ("A", "B"):
        r = k.r_pull(who)
        for c in r["changed"]:
            ch["conflict"] |= c["conflict"]
            ch["addsOnly"] &= (c["addsOnly"] or not c["conflict"])
        for f in r["sameAnchor"]:
            ch["sameAnchor"] += f["flags"]
    ch["addsOnly"] = ch["addsOnly"] and ch["conflict"]
    m = k.r_merged()
    return ch, m


def part_a():
    base = ["function f() {", "  a()", "}", "g()"]
    out = {}
    for name, xa, xb in (("siblings: two different lines at one spot", ["  guard()"], ["  log()"]),
                         ("unified: one block starts with the other's line", ["}"], ["}", "h()"]),
                         ("identical blocks (git calls this clean too)", ["  log()"], ["  log()"])):
        ch, m = pair(base, "f.js", 3, xa, xb)
        gclean, gtext = git_merge(base, base[:3] + xa + base[3:], base[:3] + xb + base[3:])
        out[name] = {"kernel conflict": ch["conflict"], "host would union (adds only)": ch.get("addsOnly", False),
                     "the swarm is told": bool(ch["conflict"] and not ch.get("addsOnly")),
                     "same-anchor flag": [f["kind"] for f in ch["sameAnchor"]],
                     "merged": m["files"]["f.js"].split("\n"), "git clean": gclean}
    return out


def block(rng, base):
    src = rng.randrange(0, len(base))
    new = base[src:src + rng.randint(1, 6)]
    if rng.random() < 0.5:
        new = [l + "  // x%d" % rng.randrange(1000) if l.strip() else l for l in new]
    return new or [""]


def part_b(n_per_file, seed=1292, prefix=False):
    rng = random.Random(seed)
    t = collections.Counter()
    ex = {}
    for path in FILES:
        base = L.read(path)
        for _ in range(n_per_file):
            at = rng.randrange(1, len(base))
            xa, xb = block(rng, base), block(rng, base)
            if prefix:                                  # the characterization: B opens with A's whole block
                xb = xa + xb
            if xa == xb:
                continue
            t[("shared first line",) if xa[0] == xb[0] else ("different first lines",)] += 1
            ch, m = pair(base, path, at, xa, xb)
            kinds = sorted({f["kind"] for f in ch["sameAnchor"]})
            told = ch["conflict"] and not ch.get("addsOnly")
            gclean, _ = git_merge(base, base[:at] + xa + base[at:], base[:at] + xb + base[at:])
            got = m["files"][path].split("\n")
            both = [base[:at] + xa + xb + base[at:], base[:at] + xb + xa + base[at:]]
            shape = "both blocks, one order" if got in both else "blocks interleaved or merged"
            key = ("kernel " + ("conflict" if ch["conflict"] else "clean"),
                   "adds-only" if ch.get("addsOnly") else "-",
                   "flag " + ("+".join(kinds) if kinds else "none"),
                   "git " + ("clean" if gclean else "conflict"), shape)
            t[key] += 1
            t[("total",)] += 1
            t[("swarm told by the kernel+union",) if told else ("swarm NOT told by the kernel+union",)] += 1
            t[("swarm told with the flag",) if (told or kinds) else ("swarm NOT told with the flag",)] += 1
            if key not in ex:
                ex[key] = {"path": path, "at": at, "a": xa, "b": xb}
    return {" | ".join(k): v for k, v in sorted(t.items())}, {" | ".join(k): v for k, v in ex.items()}


def part_c():
    """Only finished runs (a summary.json beside the ops), so a run in flight
    is never half-read."""
    runs = sorted(f for f in glob.glob(os.path.join(L.PROTO, "runs", "*", "weave-ops.jsonl"))
                  if os.path.exists(os.path.join(os.path.dirname(f), "summary.json")))
    t = collections.Counter()
    hits = []
    for f in runs:
        W.INSERTED.clear()
        k = W.Keeper()
        for line in open(f):
            op = json.loads(line)
            op.pop("t", None)
            name = op.pop("op")
            r = getattr(k, "r_" + name)(**op)
            if name == "pull":
                t["pulls"] += 1
                byp = {(c["path"], c["from"]): c for c in r["changed"]}
                flagged = {(s["path"], s["from"]) for s in r["sameAnchor"]}
                for c in r["changed"]:
                    t["pull changes"] += 1
                    if c["conflict"]:
                        t["conflicts at pull"] += 1
                        t["adds-only (unioned by the host)" if c["addsOnly"] else "conflicts opened for an agent"] += 1
                        if c["addsOnly"]:
                            t["adds-only unions that share an anchor" if (c["path"], c["from"]) in flagged
                              else "adds-only unions at different anchors"] += 1
                for s in r["sameAnchor"]:
                    c = byp.get((s["path"], s["from"]), {"conflict": False, "addsOnly": False})
                    for fl in s["flags"]:
                        t["same-anchor flag: " + fl["kind"]] += 1
                        t["same-anchor flag on: " + ("adds-only union" if c["conflict"] and c["addsOnly"] else
                                                     "opened conflict" if c["conflict"] else "clean merge")] += 1
                        hits.append({"run": os.path.basename(os.path.dirname(f)), "path": s["path"],
                                     "conflict": c["conflict"], "addsOnly": c["addsOnly"], **fl})
        t["runs"] += 1
    t["run names"] = [os.path.basename(os.path.dirname(f)) for f in runs]
    return dict(t), hits


def main():
    out = {"A": part_a()}
    n = int(os.environ.get("N_PER_FILE", 200))
    out["B"], out["B examples"] = part_b(n)
    out["B prefix"], out["B prefix examples"] = part_b(max(1, n // 4), seed=1293, prefix=True)
    out["C"], out["C hits"] = part_c()
    return out


if __name__ == "__main__":
    r = L.fold_wave.run_on_kernel_thread(main)
    json.dump(r, open(sys.argv[1] if len(sys.argv) > 1 else "same_anchor.json", "w"), indent=1)
    print(json.dumps({k: r[k] for k in ("A", "B", "B prefix", "C")}, indent=1))
    print(json.dumps(r["C hits"], indent=1)[:3000])
