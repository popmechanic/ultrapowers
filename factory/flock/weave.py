#!/usr/bin/env python3
"""PROTOTYPE (map #1292, ticket 4). The weave keeper: every agent's copy of every
file as a Manyana weave, driven over stdin/stdout, one JSON request per line.

Line identity comes from edit calls (`edit`), never from diffing a finished
file, except for the fallback (`rewrite`: a Write or a shell change), which
diffs the visible text and replays the result as edits.

Authorship rides inside the weave: a stored line is `text + SEP + author`, so
two agents writing the same text are two lines (which they are), a line's
author is readable at any time, and the vendored kernel is untouched. `base`
authors every line of BASE.

Requests (all answer {"ok": true, ...} or {"ok": false, "error": ...}):
  base     {root, paths}                  read BASE files into the base weave
  edit     {agent, path, vstart, vend, lines}
  rewrite  {agent, path, content|null}    fallback: Write / shell / delete
  view     {agent, path}                  visible text of one path
  publish  {agent}                        this agent's copy becomes its published copy
  pull     {agent}                        merge every peer's published copy into this one
  merged   {}                             the join of every published copy
  authors  {agent, path}                  [author] per visible line

Added for ticket 2 (#359; every earlier request answers as before, plus fields):
  pull          also answers sameAnchor [{path, from, flags}] (see same_anchor)
  merged        takes an optional order; also answers sameAnchor, digest,
                hiddenOnly, realConflicts
  authors_keyed {agent, path}             [author] per visible line, by identity
  cand_open     {agent, cand}             a private copy for one candidate
  cand_edit     {cand, path, vstart, vend, lines}
  cand_publish  {cand}                    publish it HIDDEN
  cand_pull     {cand}                    pull, keeping the author's own view
  select / rehide {agent, cand}           count moves on agent's copy
  adopt         {agent, path, text, after} a loser's line, placed by the adopter
"""
import difflib, json, os, sys

KERNEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "skills", "ultrapowers", "kernel")
sys.path[:0] = [KERNEL, os.path.join(KERNEL, "vendor")]
import manyana  # noqa: E402
import fold_wave  # noqa: E402

SEP = "␟"
M = manyana


TAG = os.environ.get("FLOCK_TAG", "0") == "1"
INSERTED = {}   # (agent copy, path) -> {text: set(authors)}: the authorship sidecar when TAG is off


def tag(lines, who):
    return [l + SEP + who for l in lines] if TAG else list(lines)


def strip(line):
    return line.split(SEP, 1)[0]


def author(line):
    return line.split(SEP, 1)[1] if SEP in line else "base"


def visible_raw(state):
    return M.current_lines(state)


def apply_edit(state_str, vstart, vend, new_lines):
    """Mark visible [vstart, vend) deleted and insert new_lines there, with
    update_state's own anchoring rule. Returns (state, deleted raw lines)."""
    state = M.deserialize_state(state_str)
    if not state:
        return M.initial_state(new_lines), []
    vis = [i for i, e in enumerate(state) if e[3] % 2]
    gone = []
    for d in vis[vstart:vend]:
        state[d][3] += 1
        gone.append(state[d][0])
    if new_lines:
        if vend > vstart:
            pos = vis[vstart]
        elif vstart > 0:
            pos = vis[vstart - 1] + 1
        else:
            pos = 0
        out = []
        for p in range(len(state) + 1):
            if p == pos:
                if p == len(state):
                    up = True
                elif p == 0:
                    up = False
                else:
                    up = state[p - 1][1] > state[p][1]
                if up:
                    out.append([new_lines[0], state[p - 1][1] + 1, False, 1])
                else:
                    out.append([new_lines[0], state[p][1] + 1, True, 1])
                for line in new_lines[1:]:
                    out.append([line, out[-1][1] + 1, False, 1])
            if p < len(state):
                out.append(state[p])
        state = out
    return M.serialize_state(state), gone


# ── line identity (map #1292 ticket 2 / #359) ─────────────────────────────
# Additive: nothing above changes. Manyana already has a notion of "the same
# line": two entries are one line when they hang off the same parent, on the
# same side, with the same text (merge_tree_lists matches them). `line_keys`
# makes that notion explicit as a short hash per entry, computed from the
# state alone, so a sidecar can be keyed by it and gossiped beside the weave.
import collections, copy as _copy, hashlib  # noqa: E402


def _parents(st):
    """Parent index per entry (-1 = root) and side, by state_to_tree's rule."""
    n = len(st)
    parent = [-1] * n
    last = {}
    for i, (_, depth, ar, _c) in enumerate(st):
        if not ar:
            parent[i] = -1 if depth == 0 else last[depth - 1]
        last[depth] = i
    last = {}
    for i in range(n - 1, -1, -1):
        _, depth, ar, _c = st[i]
        if ar:
            parent[i] = last[depth - 1]
        last[depth] = i
    return parent


def line_keys(state):
    """[key] per entry of `state` (a state string or a deserialized list).
    key = hash(parent key, side, text, rank among equal-text siblings on that
    side). The rank is the one positional part: it is the XaXbX residue."""
    st = M.deserialize_state(state) if isinstance(state, str) else state
    parent = _parents(st)
    keys = [None] * len(st)
    seen = collections.Counter()
    for i in sorted(range(len(st)), key=lambda i: (st[i][1], i)):   # parents are one depth up
        p = parent[i]
        pk = "root" if p < 0 else keys[p]
        text, ar = st[i][0], st[i][2]
        rank = seen[(pk, ar, text)]
        seen[(pk, ar, text)] += 1
        keys[i] = hashlib.blake2b(("%s\0%d\0%s\0%d" % (pk, ar, text, rank)).encode(), digest_size=8).hexdigest()
    return keys


def same_anchor(left, right, merged, lauth, rauth):
    """Concurrent inserts at ONE anchor, from different authors, in a merge of
    `left` and `right` (states) into `merged`. `lauth`/`rauth` are the two
    sides' authorship sidecars {key: set(author)}. Two shapes:
      siblings  lines only on the left and lines only on the right hang off the
                same parent on the same side: Manyana orders them by text
                (it flags the region, and an adds-only union then hides it);
      unified   both sides inserted the same text at the same anchor (one key,
                two authors, neither side knew the other's), so the kernel
                merged them as one line, and what follows it differs by side:
                the kernel flags nothing at all.
    Returns [{kind, anchor, lines, authors}]."""
    lk, rk = set(line_keys(left)), set(line_keys(right))
    st = M.deserialize_state(merged)
    keys, parent = line_keys(st), _parents(st)
    kids = collections.defaultdict(list)
    for i, p in enumerate(parent):
        kids[(p, st[i][2])].append(i)
    out = []

    def anchor_text(p):
        return None if p < 0 else strip(st[p][0])

    def who(auth, k):
        return auth.get(k) or set()
    for (p, side), idx in kids.items():
        vis = [i for i in idx if st[i][3] % 2]
        lonly = [i for i in vis if keys[i] in lk and keys[i] not in rk]
        ronly = [i for i in vis if keys[i] in rk and keys[i] not in lk]
        if lonly and ronly:
            la = set().union(*(who(lauth, keys[i]) for i in lonly))
            ra = set().union(*(who(rauth, keys[i]) for i in ronly))
            if la != ra or not la:
                out.append({"kind": "siblings", "anchor": anchor_text(p), "side": "below" if side else "above",
                            "lines": [strip(st[i][0]) for i in lonly + ronly], "authors": sorted(la | ra)})
    for i, k in enumerate(keys):
        a, b = who(lauth, k), who(rauth, k)
        if a and b and not (a <= b or b <= a) and st[i][3] % 2:
            follow = [j for side in (False, True) for j in kids[(i, side)]
                      if (keys[j] in lk) != (keys[j] in rk)]
            one_side = len({keys[j] in lk for j in follow}) == 1   # both sides: "siblings" already says it
            if follow and one_side:
                out.append({"kind": "unified", "anchor": anchor_text(parent[i]), "line": strip(st[i][0]),
                            "lines": [strip(st[j][0]) for j in follow], "authors": sorted(a | b)})
    return out


def bump(state, want, parity):
    """Raise the count of every entry whose key is in `want` until its parity
    is `parity` (1 = visible, 0 = hidden). Counts only ever rise, so a merge's
    max carries the move to every copy. Returns (state, moved)."""
    st = M.deserialize_state(state)
    moved = 0
    for e, k in zip(st, line_keys(st)):
        if k in want and e[3] % 2 != parity:
            e[3] += 1
            moved += 1
    return M.serialize_state(st), moved


def hidden_only(ann, cands):
    """True when a conflict is only the shadow of a hidden candidate: every line
    Manyana marks "deleted" in it is a candidate's tagged line. The kernel reads
    a dead line that one side holds and the other has never seen as a delete by
    the holder, so a copy that has not pulled a hidden candidate yet 'conflicts'
    with the selector. Nobody deleted anything; the region is safe to take.
    Read per region: a section labelled `... left` is the left side acting and
    `... right` the right; the region is only a shadow when, with the tagged
    dead lines left out, one side no longer acts at all."""
    regions, cur, label = [], None, None
    for l in ann:
        if l.startswith(("<<<<<<< begin", "======= begin")):
            if l.startswith("<<<<<<<"):
                cur = {"L": False, "R": False, "shadow": False}
                regions.append(cur)
            label = l.split("begin ", 1)[1]
        elif l == M.END:
            cur, label = None, None
        elif cur is not None:
            if label.startswith("deleted") and SEP in l and l.rsplit(SEP, 1)[1] in cands:
                cur["shadow"] = True
            elif label.endswith("left"):
                cur["L"] = True
            elif label.endswith("right"):
                cur["R"] = True
    return bool(regions) and all(r["shadow"] and not (r["L"] and r["R"]) for r in regions)


def _union_auth(into, other):
    for path, m in other.items():
        dst = into.setdefault(path, {})
        for k, who in m.items():
            dst.setdefault(k, set()).update(who)


class Keeper:
    def __init__(self):
        self.base = {}        # path -> weave state
        self.copies = {}      # agent -> {path -> state}
        self.published = {}   # agent -> {path -> state}
        # ticket 2 (additive): authorship keyed by line identity, one sidecar per
        # copy, gossiped with it (a union, so order-free); and candidates.
        self.kauth = {}       # copy -> {path -> {key -> set(author)}}
        self.kauth_pub = {}   # agent -> the sidecar as of its last publish
        self.cands = {}       # candidate -> {owner, deletes {path: set(key)}, live {path: set(key)}}

    def auth(self, who):
        return self.kauth.setdefault(who, {})

    def copy(self, agent):
        if agent not in self.copies:
            self.copies[agent] = dict(self.base)
        return self.copies[agent]

    def state(self, agent, path):
        c = self.copy(agent)
        if path not in c:
            c[path] = M.initial_state([])   # absent: the shared empty ancestor for adds
        return c[path]

    def lines(self, agent, path):
        return [strip(l) for l in visible_raw(self.state(agent, path))]

    # ── requests ──────────────────────────────────────────────────────────
    def r_base(self, root, paths):
        for p in paths:
            with open(os.path.join(root, p), encoding="utf-8") as f:
                self.base[p] = M.initial_state(tag(f.read().split("\n"), "base"))
        return {"paths": len(paths)}

    def who(self, agent, path, raw):
        if TAG or SEP in raw:
            return author(raw)
        ins = INSERTED.get(path, {}).get(raw)
        if not ins:
            return "base"
        return sorted(ins)[0] if len(ins) == 1 else "|".join(sorted(ins))

    def r_edit(self, agent, path, vstart, vend, lines, refine=True):
        cur = self.lines(agent, path)
        subs = [(vstart, vend, lines)]
        if refine and vend > vstart and lines:
            ops = difflib.SequenceMatcher(None, cur[vstart:vend], lines, autojunk=False).get_opcodes()
            subs = [(vstart + i1, vstart + i2, lines[j1:j2]) for t, i1, i2, j1, j2 in ops if t != "equal"]
        deleted, touched, peers = 0, 0, set()
        for a, z, new_lines in reversed(subs):
            st = self.state(agent, path)
            vis_raw = visible_raw(st)
            owners = [self.who(agent, path, r) for r in vis_raw[a:z]]
            new, gone = apply_edit(st, a, z, tag(new_lines, agent))
            self.copy(agent)[path] = new
            if new_lines:   # ticket 2: the keyed sidecar learns the new lines' identity
                fresh = collections.Counter(line_keys(new)) - collections.Counter(line_keys(st))
                side = self.auth(agent).setdefault(path, {})
                for k in fresh:
                    side.setdefault(k, set()).add(agent)
            for l in new_lines:
                INSERTED.setdefault(path, {}).setdefault(l, set()).add(agent)
            deleted += len(gone)
            for o in owners:
                if o not in (agent, "base"):
                    touched += 1
                    peers.add(o)
        return {"deleted": deleted, "peer_lines_touched": touched, "peers": sorted(peers), "subedits": len(subs)}

    def r_rewrite(self, agent, path, content):
        old = self.lines(agent, path)
        new = [] if content is None else content.split("\n")
        if content is not None and not old and path not in self.copy(agent):
            self.copy(agent)[path] = M.initial_state([])
        ops = difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes()
        touched, peers = 0, set()
        for tag_, i1, i2, j1, j2 in reversed(ops):
            if tag_ == "equal":
                continue
            r = self.r_edit(agent, path, i1, i2, new[j1:j2], refine=False)
            touched += r["peer_lines_touched"]
            peers |= set(r["peers"])
        return {"ops": sum(1 for o in ops if o[0] != "equal"), "peer_lines_touched": touched, "peers": sorted(peers)}

    def r_view(self, agent, path):
        return {"text": "\n".join(self.lines(agent, path))}

    def r_publish(self, agent):
        self.published[agent] = dict(self.copy(agent))
        self.kauth_pub[agent] = _copy.deepcopy(self.auth(agent))
        return {"paths": len(self.published[agent])}

    def r_pull(self, agent):
        mine = self.copy(agent)
        changed, flagged = [], []
        for peer, pub in self.published.items():
            if peer == agent:
                continue
            peer_auth = self.kauth_pub.get(peer, {})
            for p, st in pub.items():
                before = mine.get(p)
                flags = []
                if before is None:
                    mine[p] = st
                    after, conflict, ann = st, False, []
                else:
                    after, ann = M.merge_states(before, st)
                    conflict = ann != M.current_lines(after)
                    mine[p] = after
                    if st != before:   # ticket 2: concurrent inserts at one anchor (even when mine already holds theirs)
                        flags = same_anchor(before, st, after, self.auth(agent).get(p, {}), peer_auth.get(p, {}))
                _union_auth(self.auth(agent), {p: peer_auth.get(p, {})})
                if flags:
                    flagged.append({"path": p, "from": peer, "flags": flags})
                if before != after:
                    old = [strip(l) for l in visible_raw(before)] if before else []
                    new_raw = visible_raw(after)
                    new = [strip(l) for l in new_raw]
                    if old != new or conflict:
                        heads = [l for l in ann if l.startswith(("<<<<<<< begin", "======= begin"))] if before is not None and conflict else []
                        changed.append({"path": p, "from": peer, "conflict": conflict,
                                        "addsOnly": bool(heads) and all("added" in h for h in heads),
                                        "annotated": "\n".join(strip(l) for l in ann) if conflict else None,
                                        "added": sum(1 for o in difflib.ndiff(old, new) if o.startswith("+ ")),
                                        "removed": sum(1 for o in difflib.ndiff(old, new) if o.startswith("- ")),
                                        "text": "\n".join(new), "exists": bool(new_raw),
                                        "sameAnchor": flags,
                                        "hiddenOnly": conflict and hidden_only(ann, self.cands)})
        return {"changed": changed, "sameAnchor": flagged}

    def r_merged(self, order=None):
        out, conflicts, annotated, adds_only = {}, [], {}, {}
        same, auth, hidden = {}, {}, {}   # ticket 2 (additive): same-anchor flags, shadows, the join's digest
        for who in (order or list(self.published)):
            pub, pauth = self.published[who], self.kauth_pub.get(who, {})
            for p, st in pub.items():
                if p not in out:
                    out[p] = st
                else:
                    m, ann = M.merge_states(out[p], st)
                    if st != out[p]:
                        same.setdefault(p, []).extend(same_anchor(out[p], st, m, auth.get(p, {}), pauth.get(p, {})))
                    if ann != M.current_lines(m):
                        conflicts.append(p)
                        heads = [l for l in ann if l.startswith(("<<<<<<< begin", "======= begin"))]
                        only = all(("added" in h) for h in heads)
                        adds_only[p] = adds_only.get(p, True) and only
                        annotated[p] = "\n".join(strip(l) for l in ann)
                        hidden[p] = hidden.get(p, True) and hidden_only(ann, self.cands)
                    out[p] = m
            _union_auth(auth, pauth)
        files = {p: "\n".join(strip(l) for l in visible_raw(st)) for p, st in out.items()}
        exists = {p: bool(visible_raw(st)) for p, st in out.items()}
        digest = hashlib.blake2b(json.dumps(sorted(out.items())).encode(), digest_size=8).hexdigest()
        return {"files": files, "exists": exists, "conflicts": sorted(set(conflicts)), "annotated": annotated, "addsOnly": adds_only,
                "sameAnchor": {p: f for p, f in same.items() if f}, "digest": digest,
                "hiddenOnly": hidden, "realConflicts": sorted(p for p in set(conflicts) if not hidden.get(p))}

    def r_authors(self, agent, path):
        return {"authors": [self.who(agent, path, l) for l in visible_raw(self.state(agent, path))]}

    # ── ticket 2 (additive): authorship by identity, and hidden candidates ──
    def r_authors_keyed(self, agent, path):
        """[author] per visible line, from the keyed sidecar ("base" when none)."""
        st = M.deserialize_state(self.state(agent, path))
        side = self.auth(agent).get(path, {})
        return {"authors": ["|".join(sorted(side[k])) if side.get(k) else "base"
                            for e, k in zip(st, line_keys(st)) if e[3] % 2]}

    def r_cand_open(self, agent, cand):
        """A candidate is a private copy forked from `agent`'s copy. It is never
        published as itself; only its hidden form is (r_cand_publish)."""
        self.copies[cand] = dict(self.copy(agent))
        self.kauth[cand] = _copy.deepcopy(self.auth(agent))
        self.cands[cand] = {"owner": agent, "deletes": {}, "live": {}}
        return {"paths": len(self.copies[cand])}

    def r_cand_edit(self, cand, path, vstart, vend, lines):
        """An edit inside the candidate. Inserted lines carry the candidate's
        tag in the stored text (stripped from every view), so two candidates'
        identical lines stay two lines; deletions of lines the candidate did
        not write are recorded as pending, because a count can hide an insert
        but cannot withhold a delete."""
        st = self.state(cand, path)
        ents, keys = M.deserialize_state(st), line_keys(st)
        vis = [i for i, e in enumerate(ents) if e[3] % 2]
        pend = self.cands[cand]["deletes"].setdefault(path, set())
        for i in vis[vstart:vend]:
            if not ents[i][0].endswith(SEP + cand):
                pend.add(keys[i])
        new, gone = apply_edit(st, vstart, vend, [l + SEP + cand for l in lines])
        self.copies[cand][path] = new
        return {"deleted": len(gone), "pendingDeletes": len(pend)}

    def _cand_mine(self, cand, st):
        ents, keys = M.deserialize_state(st), line_keys(st)
        return ents, keys, {k for e, k in zip(ents, keys) if e[0].endswith(SEP + cand) and e[3] % 2}

    def r_cand_publish(self, cand):
        """Publish the candidate HIDDEN: its live lines go to the next even count,
        its pending deletes go out one below their private count (a merge keeps
        the max, so this withholds only what the candidate itself did)."""
        rec, out = self.cands[cand], {}
        for path, st in self.copies[cand].items():
            ents, keys, live = self._cand_mine(cand, st)
            pend = rec["deletes"].get(path, set())
            for e, k in zip(ents, keys):
                if k in live:
                    e[3] += 1
                elif k in pend and e[3] % 2 == 0 and e[3] >= 2:
                    e[3] -= 1
            rec["live"][path] = live
            out[path] = M.serialize_state(ents)
        self.published[cand] = out
        self.kauth_pub[cand] = _copy.deepcopy(self.auth(cand))
        return {"live": sum(len(v) for v in rec["live"].values()),
                "pendingDeletes": sum(len(v) for v in rec["deletes"].values())}

    def r_cand_pull(self, cand):
        """Pull peers into the private copy, then re-assert the candidate's own
        view: its live lines visible, its pending deletes deleted (peers hold
        the hidden form, and a merge would otherwise hide it from its author)."""
        rec = self.cands[cand]
        before = {p: self._cand_mine(cand, st)[2] for p, st in self.copies[cand].items()}
        res = self.r_pull(cand)
        for path, st in self.copies[cand].items():
            st, _ = bump(st, before.get(path, set()), 1)
            st, _ = bump(st, rec["deletes"].get(path, set()), 0)
            self.copies[cand][path] = st
        return res

    def _cand_move(self, agent, cand, show):
        rec, moved = self.cands[cand], 0
        mine = self.copy(agent)
        for path in set(rec["live"]) | set(rec["deletes"]):
            if path not in mine:
                continue
            st, a = bump(mine[path], rec["live"].get(path, set()), 1 if show else 0)
            st, b = bump(st, rec["deletes"].get(path, set()), 0 if show else 1)
            mine[path] = st
            moved += a + b
        return {"moved": moved}

    def r_select(self, agent, cand):
        """On `agent`'s copy: the candidate's live lines become visible and its
        pending deletes land. Counts only rise; publish spreads it."""
        return self._cand_move(agent, cand, True)

    def r_rehide(self, agent, cand):
        return self._cand_move(agent, cand, False)

    def r_adopt(self, agent, path, text, after):
        """Partial adoption: `text` (a line of a losing candidate) is inserted
        as a fresh line of `agent`'s, directly after visible line `after`
        (-1 = top). A weave never moves a line, and a hidden line's place is
        fixed by its candidate's parent, so adoption is a new line placed by
        the adopter, not a count move on the old one."""
        return self.r_edit(agent, path, after + 1, after + 1, [text], refine=False)


def serve():
    k = Keeper()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            op = req.pop("op")
            res = getattr(k, "r_" + op)(**req)
            res["ok"] = True
        except Exception as e:  # the prototype reports, never dies
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        sys.stdout.write(json.dumps(res) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    fold_wave.run_on_kernel_thread(serve)
