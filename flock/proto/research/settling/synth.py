#!/usr/bin/env python3
"""RESEARCH (map #1292, ticket 5). Synthetic Flock run records, some of which oscillate.

  python3 flock/proto/research/settling/synth.py [out dir]   (default: research/settling/synthetic)

Each scenario drives the prototype's own weave keeper (flock/proto/weave.py) the way
host.mjs does (base, edit, publish, pull) and writes the same three records a real run
leaves: weave-ops.jsonl, snapshots.json (the merged code after every publish, hashed as
the edge hashes it), and events.jsonl. The real runs showed no oscillation, so these are
what the detector must catch, plus controls it must not flag.

`expect` is what the detector should say; check_synth.py compares.
"""
import hashlib, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
import weave as W  # noqa: E402

BASE = {"svc/config.py": "import os\n\nTIMEOUT = 30\nRETRIES = 3\n\n\ndef load(x):\n    return x\n"}


def snap_hash(files):
    return hashlib.sha1(json.dumps(files, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()[:10]


class Run:
    def __init__(self, out, name):
        self.dir = os.path.join(out, name)
        shutil.rmtree(self.dir, ignore_errors=True)
        base = os.path.join(self.dir, "base")
        for p, text in BASE.items():
            os.makedirs(os.path.dirname(os.path.join(base, p)), exist_ok=True)
            open(os.path.join(base, p), "w").write(text)
        W.INSERTED.clear()
        self.k = W.Keeper()
        self.t = 0
        self.ops, self.events, self.snaps = [], [], []
        self.op("base", root=base, paths=sorted(BASE))

    def op(self, op, **kw):
        self.t += 1000
        self.ops.append({"t": self.t, "op": op, **kw})
        return getattr(self.k, "r_" + op)(**kw)

    def ev(self, kind, **kw):
        self.events.append({"t": self.t, "kind": kind, **kw})

    def set_line(self, agent, path, old, new):
        """An Edit call replacing one line's text (old -> new) in the agent's copy."""
        lines = self.k.lines(agent, path)
        i = lines.index(old)
        self.op("edit", agent=agent, path=path, vstart=i, vend=i + 1, lines=[new])

    def insert_after(self, agent, path, anchor, new):
        lines = self.k.lines(agent, path)
        i = lines.index(anchor) + 1
        self.op("edit", agent=agent, path=path, vstart=i, vend=i, lines=[new])

    def delete_line(self, agent, path, old):
        lines = self.k.lines(agent, path)
        i = lines.index(old)
        self.op("edit", agent=agent, path=path, vstart=i, vend=i + 1, lines=[])

    def publish(self, agent):
        self.op("publish", agent=agent)
        self.ev("publish", agent=agent)
        m = self.k.r_merged()
        h = snap_hash(m["files"])
        if not self.snaps or self.snaps[-1]["snap"] != h:
            self.snaps.append({"snap": h, "t": self.t, "files": m["files"]})

    def pull(self, agent):
        self.op("pull", agent=agent)

    def write(self, expect):
        with open(os.path.join(self.dir, "weave-ops.jsonl"), "w") as f:
            for o in self.ops:
                f.write(json.dumps(o) + "\n")
        with open(os.path.join(self.dir, "events.jsonl"), "w") as f:
            for e in self.events:
                f.write(json.dumps(e) + "\n")
        json.dump(self.snaps, open(os.path.join(self.dir, "snapshots.json"), "w"))
        json.dump(expect, open(os.path.join(self.dir, "expect.json"), "w"), indent=1)


P = "svc/config.py"


def tug_of_war(out):
    """Two agents alternate one line between two values: 30 <-> 60, twice each."""
    r = Run(out, "S1-tug-of-war")
    r.set_line("A", P, "TIMEOUT = 30", "TIMEOUT = 60"); r.publish("A")
    r.pull("B"); r.set_line("B", P, "TIMEOUT = 60", "TIMEOUT = 30"); r.publish("B")
    r.pull("A"); r.set_line("A", P, "TIMEOUT = 30", "TIMEOUT = 60"); r.publish("A")
    r.pull("B"); r.set_line("B", P, "TIMEOUT = 60", "TIMEOUT = 30"); r.publish("B")
    r.write({"oscillating": True, "why": "A and B flip TIMEOUT 30<->60 twice"})


def add_remove_war(out):
    """One agent adds a guard line, another deletes it, twice."""
    r = Run(out, "S2-add-remove-war")
    g = "    if x is None: return None"
    r.insert_after("A", P, "def load(x):", g); r.publish("A")
    r.pull("B"); r.delete_line("B", P, g); r.publish("B")
    r.pull("A"); r.insert_after("A", P, "def load(x):", g); r.publish("A")
    r.pull("B"); r.delete_line("B", P, g); r.publish("B")
    r.write({"oscillating": True, "why": "A adds the guard, B deletes it, twice"})


def one_revert(out):
    """Control: a peer reverts a change once, and it stays reverted."""
    r = Run(out, "S3-one-revert")
    r.set_line("A", P, "TIMEOUT = 30", "TIMEOUT = 60"); r.publish("A")
    r.pull("B"); r.set_line("B", P, "TIMEOUT = 60", "TIMEOUT = 30"); r.publish("B")
    r.pull("A"); r.set_line("A", P, "RETRIES = 3", "RETRIES = 5"); r.publish("A")
    r.write({"oscillating": False, "why": "one revert by a peer, then other work: legal", "reverts": 1})


def self_thrash(out):
    """Control for the swarm verdict: one agent toggles its own line, publishing each time."""
    r = Run(out, "S4-self-thrash")
    for a, b in [("30", "60"), ("60", "30"), ("30", "60"), ("60", "30")]:
        r.set_line("A", P, "TIMEOUT = " + a, "TIMEOUT = " + b); r.publish("A")
    r.write({"oscillating": False, "why": "one agent thrashing is a per-agent stall signal, not a swarm oscillation", "self_thrash": 1})


def conflict_reopen_loop(out):
    """A conflict on one region closed and reopened twice (the ledger's own records)."""
    r = Run(out, "S5-conflict-reopen-loop")
    r.set_line("A", P, "TIMEOUT = 30", "TIMEOUT = 60"); r.publish("A")
    for i in range(3):
        r.t += 1000; r.ev("conflict:open", path=P, region="r1", between=["A", "B"])
        r.t += 1000; r.ev("conflict:close", path=P, region="r1", by="A" if i % 2 == 0 else "B", note="kept mine")
    r.write({"oscillating": True, "why": "the conflict on region r1 is closed and reopened twice"})


def livelock_no_repeat(out):
    """Control for oscillation (a stall case): content keeps changing and never repeats."""
    r = Run(out, "S6-livelock-no-repeat")
    cur = "TIMEOUT = 30"
    for i, a in enumerate(["A", "B", "A", "B", "A", "B"]):
        r.pull(a)
        new = "TIMEOUT = %d" % (31 + i)
        r.set_line(a, P, cur, new); r.publish(a)
        cur = new
    r.write({"oscillating": False, "why": "never returns to a content: livelock, which the stall belief reads, not the oscillation detector"})


def three_cycle(out):
    """Three agents rotate one line through three values and start round again."""
    r = Run(out, "S7-three-cycle")
    seq = [("A", "30", "60"), ("B", "60", "90"), ("C", "90", "30"), ("A", "30", "60")]
    for a, x, y in seq:
        r.pull(a); r.set_line(a, P, "TIMEOUT = " + x, "TIMEOUT = " + y); r.publish(a)
    r.write({"oscillating": True, "why": "30 -> 60 -> 90 -> 30 -> 60 across A, B, C"})


def same_intent(out):
    """Control: two agents make the identical change without seeing each other."""
    r = Run(out, "S8-same-intent")
    r.set_line("A", P, "TIMEOUT = 30", "TIMEOUT = 60")
    r.set_line("B", P, "TIMEOUT = 30", "TIMEOUT = 60")
    r.publish("A"); r.publish("B"); r.pull("A"); r.pull("B")
    r.write({"oscillating": False, "why": "identical concurrent edits merge as one"})


SCENARIOS = [tug_of_war, add_remove_war, one_revert, self_thrash, conflict_reopen_loop, livelock_no_repeat, three_cycle, same_intent]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "synthetic")
    os.makedirs(out, exist_ok=True)
    for s in SCENARIOS:
        s(out)
    print("wrote", len(SCENARIOS), "scenarios to", out)


if __name__ == "__main__":
    W.fold_wave.run_on_kernel_thread(main)
