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

Added for ticket 2 (#359; every earlier request answers as before, plus fields):
  pull          also answers sameAnchor [{path, from, flags}] (see same_anchor)
  merged        takes an optional order; also answers sameAnchor, digest
  authors_keyed {agent, path}             [author] per visible line, by identity

Added for #1401: edit and rewrite also answer peerRewrites [{peers, peer, before, after}], one per
sub-edit that replaced or deleted lines a peer wrote: `peer` the peer's lines, `before` what those
lines had replaced when the peer wrote them, `after` what this edit put there.
  lost          {}                        [{path, author, lines}]: lines each agent's published copy shows
                                          as its own that the join of every published copy no longer shows
"""
import difflib, json, os, re, sys, threading

KERNEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "skills", "ultrapowers", "kernel")
sys.path[:0] = [os.path.join(KERNEL, "vendor")]
import manyana  # noqa: E402

# The vendored kernel's merge walk (`merge_states` -> `state_to_tree` ->
# `pull_out_tree`/`merge_trees`/`insert_tree`) recurses once per weave-state
# entry, ~2*lines+4 frames. Raising `sys.setrecursionlimit` alone does not buy
# those frames: the C stack runs out first and the interpreter dies on a
# SIGSEGV. So the recursion limit is raised on a thread given a 1 GiB stack,
# which is what lets a large file weave.
STACK_BYTES = 1 << 30
THREAD_RECURSION_LIMIT = 1_000_000


def run_on_kernel_thread(fn, *args, **kwargs):
    """Run `fn` on a thread with a 1 GiB stack and the fixed recursion limit.

    The result and any exception are marshalled back to the caller — including
    `SystemExit`, so exit codes are unchanged by the hop. A platform that
    refuses the big stack (`ValueError` from `threading.stack_size`) or the
    thread itself (`RuntimeError` from `Thread.start()`) falls through to a
    main-thread call plus one stderr line: the work still runs, just without
    the headroom. `threading.stack_size` is process-global like the recursion
    limit, so the prior stack size is restored in every path — a thread's
    stack is fixed at `start()`, so threads created later are unaffected.

    `sys.setrecursionlimit` is interpreter-global, not per-thread, so raising
    it inside the thread raises it for the whole process. The limit is
    therefore restored before the thread ends — the caller (and, in-process,
    every later caller) keeps the limit it had. Restoring is safe because the
    thread's own stack is shallow again by then: `fn` has already returned or
    unwound.
    """
    box = {}

    def target():
        prior = sys.getrecursionlimit()
        sys.setrecursionlimit(THREAD_RECURSION_LIMIT)
        try:
            box["result"] = fn(*args, **kwargs)
        except BaseException as e:      # marshal everything back, incl. SystemExit
            box["exc"] = e
        finally:
            sys.setrecursionlimit(prior)

    try:
        prior_stack = threading.stack_size(STACK_BYTES)
    except ValueError as e:
        # Nothing was changed: stack_size raises before mutating.
        print("weave: big-stack thread unavailable (%s); running in main "
              "thread" % e, file=sys.stderr)
        return fn(*args, **kwargs)
    try:
        t = threading.Thread(target=target, name="weave-kernel")
        t.start()
    except RuntimeError as e:
        print("weave: big-stack thread unavailable (%s); running in main "
              "thread" % e, file=sys.stderr)
        return fn(*args, **kwargs)
    finally:
        # Process-global, like the recursion limit: a thread's stack is fixed
        # at start(), so restoring here affects only threads created later.
        threading.stack_size(prior_stack)
    t.join()
    if "exc" in box:
        raise box["exc"]
    return box["result"]

SEP = "␟"
M = manyana


TAG = os.environ.get("FLOCK_TAG", "0") == "1"
INSERTED = {}   # (agent copy, path) -> {text: set(authors)}: the authorship sidecar when TAG is off
REPLACED = {}   # (path, text) -> the visible lines the edit that wrote `text` replaced (#1401)


def tag(lines, who):
    return [l + SEP + who for l in lines] if TAG else list(lines)


# A stored line is `text + SEP + label`, and only the LAST SEP is ours: the text may carry the
# character itself (this file's own `SEP = ...` line does), and splitting at the first one cut
# every such line short (ultrapowers run-247 merged `SEP = "` into this file, 2026-09-27).
_LABEL = re.compile(r"[A-Za-z0-9:_|.+-]{1,64}")


def _split(line):
    if SEP in line:
        text, label = line.rsplit(SEP, 1)
        if _LABEL.fullmatch(label):
            return text, label
    return line, None


def strip(line):
    return _split(line)[0]


def author(line):
    return _split(line)[1] or "base"


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
        # copy, gossiped with it (a union, so order-free).
        self.kauth = {}       # copy -> {path -> {key -> set(author)}}
        self.kauth_pub = {}   # agent -> the sidecar as of its last publish

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
        deleted, touched, peers, rewrites = 0, 0, set(), []
        for a, z, new_lines in reversed(subs):
            st = self.state(agent, path)
            vis_raw = visible_raw(st)
            owners = [self.who(agent, path, r) for r in vis_raw[a:z]]
            gone_text = [strip(r) for r in vis_raw[a:z]]
            theirs = [(o, t) for o, t in zip(owners, gone_text) if o not in (agent, "base")]
            if theirs:
                rewrites.append({"peers": sorted({p for o, _ in theirs for p in o.split("|")}),
                                 "peer": [t for _, t in theirs],
                                 "before": [b for _, t in theirs for b in REPLACED.get((path, t), [])],
                                 "after": list(new_lines)})
            for l in new_lines:
                REPLACED[(path, l)] = gone_text
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
        return {"deleted": deleted, "peer_lines_touched": touched, "peers": sorted(peers), "subedits": len(subs),
                "peerRewrites": rewrites[::-1]}

    def r_rewrite(self, agent, path, content):
        old = self.lines(agent, path)
        new = [] if content is None else content.split("\n")
        if content is not None and not old and path not in self.copy(agent):
            self.copy(agent)[path] = M.initial_state([])
        ops = difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes()
        touched, peers, rewrites = 0, set(), []
        for tag_, i1, i2, j1, j2 in reversed(ops):
            if tag_ == "equal":
                continue
            r = self.r_edit(agent, path, i1, i2, new[j1:j2], refine=False)
            touched += r["peer_lines_touched"]
            peers |= set(r["peers"])
            rewrites[:0] = r["peerRewrites"]
        return {"ops": sum(1 for o in ops if o[0] != "equal"), "peer_lines_touched": touched, "peers": sorted(peers),
                "peerRewrites": rewrites}

    def r_view(self, agent, path):
        return {"text": "\n".join(self.lines(agent, path))}

    def r_publish(self, agent):
        self.published[agent] = dict(self.copy(agent))
        self.kauth_pub[agent] = _copy.deepcopy(self.auth(agent))
        return {"paths": len(self.published[agent])}

    def r_pull(self, agent, paths=None):
        # paths (optional): take in only these paths' published changes; absent, take in all
        want = None if paths is None else set(paths)
        mine = self.copy(agent)
        changed, flagged = [], []
        for peer, pub in self.published.items():
            if peer == agent:
                continue
            peer_auth = self.kauth_pub.get(peer, {})
            for p, st in pub.items():
                if want is not None and p not in want:
                    continue
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
                                        "sameAnchor": flags})
        return {"changed": changed, "sameAnchor": flagged}

    def r_merged(self, order=None):
        out, conflicts, annotated, adds_only = {}, [], {}, {}
        same, auth = {}, {}   # ticket 2 (additive): same-anchor flags, the join's digest
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
                    out[p] = m
            _union_auth(auth, pauth)
        files = {p: "\n".join(strip(l) for l in visible_raw(st)) for p, st in out.items()}
        exists = {p: bool(visible_raw(st)) for p, st in out.items()}
        digest = hashlib.blake2b(json.dumps(sorted(out.items())).encode(), digest_size=8).hexdigest()
        return {"files": files, "exists": exists, "conflicts": sorted(set(conflicts)), "annotated": annotated, "addsOnly": adds_only,
                "sameAnchor": {p: f for p, f in same.items() if f}, "digest": digest}

    def r_lost(self):
        """Per (path, author): the visible lines of the author's published copy that the author wrote
        (keyed sidecar) and whose key is not visible in the join, in file order."""
        join = {}
        for who in self.published:
            for p, st in self.published[who].items():
                join[p] = st if p not in join else M.merge_states(join[p], st)[0]
        seen = {}
        for p, st in join.items():
            js = M.deserialize_state(st)
            seen[p] = {k for e, k in zip(js, line_keys(js)) if e[3] % 2}
        lost = []
        for who, pub in self.published.items():
            pauth = self.kauth_pub.get(who, {})
            for p, st in pub.items():
                ps, side = M.deserialize_state(st), pauth.get(p, {})
                gone = [strip(e[0]) for e, k in zip(ps, line_keys(ps))
                        if e[3] % 2 and who in side.get(k, ()) and k not in seen.get(p, ())]
                if gone:
                    lost.append({"path": p, "author": who, "lines": gone})
        return {"lost": sorted(lost, key=lambda d: (d["path"], d["author"]))}

    # ── ticket 2 (additive): authorship by identity ──
    def r_authors_keyed(self, agent, path):
        """[author] per visible line, from the keyed sidecar ("base" when none)."""
        st = M.deserialize_state(self.state(agent, path))
        side = self.auth(agent).get(path, {})
        return {"authors": ["|".join(sorted(side[k])) if side.get(k) else "base"
                            for e, k in zip(st, line_keys(st)) if e[3] % 2]}


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
    run_on_kernel_thread(serve)
