#!/usr/bin/env python3
import difflib, json, os, sys, threading

KERNEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "skills", "ultrapowers", "kernel")
sys.path[:0] = [os.path.join(KERNEL, "vendor")]
import manyana  # noqa: E402

STACK_BYTES = 1 << 30
THREAD_RECURSION_LIMIT = 1_000_000


def run_on_kernel_thread(fn, *args, **kwargs):
    box = {}

    def target():
        prior = sys.getrecursionlimit()
        sys.setrecursionlimit(THREAD_RECURSION_LIMIT)
        try:
            box["result"] = fn(*args, **kwargs)
        except BaseException as e:
            box["exc"] = e
        finally:
            sys.setrecursionlimit(prior)

    try:
        prior_stack = threading.stack_size(STACK_BYTES)
    except ValueError as e:
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
        threading.stack_size(prior_stack)
    t.join()
    if "exc" in box:
        raise box["exc"]
    return box["result"]

M = manyana


def task_label(agent, task):
    return agent if task is None else agent + "." + str(task)


def strip(line):
    return line


def label_of(side, key):
    who = side.get(key)
    return "|".join(sorted(who)) if who else "base"


def visible_raw(state):
    return M.current_lines(state)


def apply_edit(state_str, vstart, vend, new_lines):
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


import collections, copy as _copy, hashlib  # noqa: E402


def _parents(st):
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
    st = M.deserialize_state(state) if isinstance(state, str) else state
    parent = _parents(st)
    keys = [None] * len(st)
    seen = collections.Counter()
    for i in sorted(range(len(st)), key=lambda i: (st[i][1], i)):
        p = parent[i]
        pk = "root" if p < 0 else keys[p]
        text, ar = st[i][0], st[i][2]
        rank = seen[(pk, ar, text)]
        seen[(pk, ar, text)] += 1
        keys[i] = hashlib.blake2b(("%s\0%d\0%s\0%d" % (pk, ar, text, rank)).encode(), digest_size=8).hexdigest()
    return keys


def same_anchor(left, right, merged, lauth, rauth):
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
            one_side = len({keys[j] in lk for j in follow}) == 1
            if follow and one_side:
                out.append({"kind": "unified", "anchor": anchor_text(parent[i]), "line": strip(st[i][0]),
                            "lines": [strip(st[j][0]) for j in follow], "authors": sorted(a | b)})
    return out


def both_created(left, right, lauth, rauth):
    def only(mine, theirs, auth):
        st = M.deserialize_state(mine)
        held = set(line_keys(theirs))
        return {l for e, k in zip(st, line_keys(st)) if e[3] % 2 and k not in held for l in auth.get(k, ())}
    lo, ro = only(left, right, lauth), only(right, left, rauth)
    stored = lambda who: any(l.startswith("@") for l in who)
    built = lambda who: any(not l.startswith("@") for l in who)
    return (stored(lo) and built(ro)) or (built(lo) and stored(ro))


def _union_auth(into, other):
    for path, m in other.items():
        dst = into.setdefault(path, {})
        for k, who in m.items():
            dst.setdefault(k, set()).update(who)


def _union_del(into, other):
    _union_auth(into, other)


def _lost_of(join, auth, dels):
    lost = {}
    for p, st in join.items():
        js, side, dside = M.deserialize_state(st), auth.get(p, {}), dels.get(p, {})
        for e, k in zip(js, line_keys(js)):
            if e[3] % 2 or not (side.get(k, set()) - {"base"}):
                continue
            by = dside.get(k, set())
            if by & side[k]:
                continue
            lost.setdefault((p, label_of(side, k), "|".join(sorted(by))), []).append(e[0])
    return [{"path": p, "author": a, "by": b or None, "lines": ls}
            for (p, a, b), ls in sorted(lost.items(), key=lambda kv: kv[0])]


def _union_rep(into, other):
    for path, m in other.items():
        dst = into.setdefault(path, {})
        for k, by in m.items():
            mine = dst.get(k)
            if mine is None:
                dst[k] = dict(by)
            else:
                for lab, gone in by.items():
                    mine.setdefault(lab, gone)


def _copy_rep(side):
    return {p: {k: dict(by) for k, by in m.items()} for p, m in side.items()}


def _before(by):
    seen, out = set(), []
    for lab in sorted(by):
        for line in by[lab]:
            if line not in seen:
                seen.add(line)
                out.append(line)
    return out


class Keeper:
    def __init__(self):
        self.base = {}
        self.copies = {}
        self.published = {}
        self.kauth = {}
        self.kauth_pub = {}
        self.kdel = {}
        self.kdel_pub = {}
        self.krep = {}
        self.krep_pub = {}
        self.mem = None
        self.mem_installed = set()

    def auth(self, who):
        return self.kauth.setdefault(who, {})

    def dels(self, who):
        return self.kdel.setdefault(who, {})

    def reps(self, who):
        return self.krep.setdefault(who, {})

    def copy(self, agent):
        if agent not in self.copies:
            self.copies[agent] = dict(self.base)
        return self.copies[agent]

    def state(self, agent, path):
        c = self.copy(agent)
        if path not in c:
            c[path] = M.initial_state([])
        return c[path]

    def lines(self, agent, path):
        return [strip(l) for l in visible_raw(self.state(agent, path))]

    def r_base(self, root, paths):
        for p in paths:
            with open(os.path.join(root, p), encoding="utf-8", newline="") as f:
                self.base[p] = M.initial_state(f.read().split("\n"))
        return {"paths": len(paths)}

    def who(self, agent, path, key):
        return label_of(self.auth(agent).get(path, {}), key)

    def r_edit(self, agent, path, vstart, vend, lines, refine=True, task=None):
        label = task_label(agent, task)
        cur = self.lines(agent, path)
        subs = [(vstart, vend, lines)]
        if refine and vend > vstart and lines:
            ops = difflib.SequenceMatcher(None, cur[vstart:vend], lines, autojunk=False).get_opcodes()
            subs = [(vstart + i1, vstart + i2, lines[j1:j2]) for t, i1, i2, j1, j2 in ops if t != "equal"]
        deleted, touched, peers, rewrites = 0, 0, set(), []
        for a, z, new_lines in reversed(subs):
            st = self.state(agent, path)
            ss = M.deserialize_state(st)
            vis_keys = [k for e, k in zip(ss, line_keys(ss)) if e[3] % 2][a:z]
            owners = [self.who(agent, path, k) for k in vis_keys]
            gone_text = visible_raw(st)[a:z]
            theirs = [(o, t, k) for o, t, k in zip(owners, gone_text, vis_keys) if o not in (label, "base")]
            if theirs:
                rside = self.reps(agent).get(path, {})
                rewrites.append({"peers": sorted({p for o, _, _ in theirs for p in o.split("|")}),
                                 "peer": [t for _, t, _ in theirs],
                                 "before": [b for _, _, k in theirs for b in _before(rside.get(k, {}))],
                                 "after": list(new_lines)})
            new, gone = apply_edit(st, a, z, list(new_lines))
            self.copy(agent)[path] = new
            if new_lines:
                fresh = collections.Counter(line_keys(new)) - collections.Counter(line_keys(st))
                side = self.auth(agent).setdefault(path, {})
                rside = self.reps(agent).setdefault(path, {})
                gone_t = tuple(gone_text)
                for k in fresh:
                    side.setdefault(k, set()).add(label)
                    rside.setdefault(k, {})[label] = gone_t
            dside = self.dels(agent).setdefault(path, {})
            for k in vis_keys:
                dside.setdefault(k, set()).add(label)
            deleted += len(gone)
            for o in owners:
                if o not in (label, "base"):
                    touched += 1
                    peers.add(o)
        return {"deleted": deleted, "peer_lines_touched": touched, "peers": sorted(peers), "subedits": len(subs),
                "peerRewrites": rewrites[::-1]}

    def r_rewrite(self, agent, path, content, task=None):
        old = self.lines(agent, path)
        new = [] if content is None else content.split("\n")
        if content is not None and not old and path not in self.copy(agent):
            self.copy(agent)[path] = M.initial_state([])
        ops = difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes()
        touched, peers, rewrites = 0, set(), []
        for tag_, i1, i2, j1, j2 in reversed(ops):
            if tag_ == "equal":
                continue
            r = self.r_edit(agent, path, i1, i2, new[j1:j2], refine=False, task=task)
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
        self.kdel_pub[agent] = _copy.deepcopy(self.dels(agent))
        self.krep_pub[agent] = _copy_rep(self.reps(agent))
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
                flags, made = [], False
                if before is not None and st == self.base.get(p):
                    continue
                if before is None:
                    mine[p] = st
                    after, conflict, ann = st, False, []
                elif st == before:
                    after, conflict, ann = before, False, []
                else:
                    after, ann = M.merge_states(before, st)
                    conflict = ann != M.current_lines(after)
                    mine[p] = after
                    if st != before:
                        flags = same_anchor(before, st, after, self.auth(agent).get(p, {}), peer_auth.get(p, {}))
                        made = conflict and p not in self.base and both_created(before, st, self.auth(agent).get(p, {}), peer_auth.get(p, {}))
                _union_auth(self.auth(agent), {p: peer_auth.get(p, {})})
                _union_del(self.dels(agent), {p: self.kdel_pub.get(peer, {}).get(p, {})})
                _union_rep(self.reps(agent), {p: self.krep_pub.get(peer, {}).get(p, {})})
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
                                        "bothCreated": made,
                                        "annotated": "\n".join(strip(l) for l in ann) if conflict else None,
                                        "added": sum(1 for o in difflib.ndiff(old, new) if o.startswith("+ ")),
                                        "removed": sum(1 for o in difflib.ndiff(old, new) if o.startswith("- ")),
                                        "text": "\n".join(new), "exists": bool(new_raw),
                                        "sameAnchor": flags})
        return {"changed": changed, "sameAnchor": flagged}

    def r_merged(self, order=None):
        out, conflicts, annotated, adds_only, made = {}, [], {}, {}, {}
        same, auth, dels = {}, {}, {}
        for who in (order or list(self.published)):
            _union_del(dels, self.kdel_pub.get(who, {}))
            pub, pauth = self.published[who], self.kauth_pub.get(who, {})
            for p, st in pub.items():
                if p not in out:
                    out[p] = st
                elif st == out[p] or st == self.base.get(p):
                    pass
                else:
                    m, ann = M.merge_states(out[p], st)
                    if st != out[p]:
                        same.setdefault(p, []).extend(same_anchor(out[p], st, m, auth.get(p, {}), pauth.get(p, {})))
                    if ann != M.current_lines(m):
                        conflicts.append(p)
                        heads = [l for l in ann if l.startswith(("<<<<<<< begin", "======= begin"))]
                        only = all(("added" in h) for h in heads)
                        adds_only[p] = adds_only.get(p, True) and only
                        if p not in self.base and both_created(out[p], st, auth.get(p, {}), pauth.get(p, {})):
                            made[p] = True
                        annotated[p] = "\n".join(strip(l) for l in ann)
                    out[p] = m
            _union_auth(auth, pauth)
        files = {p: "\n".join(strip(l) for l in visible_raw(st)) for p, st in out.items()}
        exists = {p: bool(visible_raw(st)) for p, st in out.items()}
        return {"files": files, "exists": exists, "conflicts": sorted(set(conflicts)), "annotated": annotated, "addsOnly": adds_only,
                "bothCreated": made,
                "sameAnchor": {p: f for p, f in same.items() if f},
                "lost": _lost_of(out, auth, dels)}

    def r_memory(self, repo, commit, remote=None):
        import weave_store as S
        if self.copies:
            raise RuntimeError("memory comes before any copy")
        try:
            mem = S.open_store(repo, commit, remote)
        except S.Drift as e:
            return {"memory": False, "reason": "drift", "paths": e.paths}
        if mem is None:
            return {"memory": False, "reason": "before-genesis"}
        for p, st in mem.states.items():
            if p in self.base:
                self.base[p] = st
                self.mem_installed.add(p)
        self.mem = mem
        return {**mem.summary(), "installed": len(self.mem_installed)}

    def r_main(self, repo, commit, remote=None, skip=None):
        import re
        import weave_store as S
        old = self.mem
        if old is None:
            return {"moved": False, "reason": "no-memory"}
        if remote:
            S.sync(repo, remote)
        try:
            new = S.resolve(repo, commit)
        except S.Drift as e:
            return {"moved": False, "reason": "drift", "paths": e.paths}
        if new is None:
            return {"moved": False, "reason": "before-genesis"}
        gone = sorted(p for p in self.base if p in new.unwoven and p not in old.unwoven)
        if gone:
            return {"moved": False, "reason": "no-longer-text", "paths": gone}
        pub = self.published.setdefault("main", {})
        fresh = lambda now, was: {k: who - was.get(k, set()) for k, who in now.items() if who - was.get(k, set())}
        changed = []
        for p, st in new.states.items():
            if st == old.states.get(p) or (skip and re.search(skip, p)):
                continue
            if p not in self.base and p not in pub and not M.current_lines(st):
                continue
            pub[p] = st
            self.mem_installed.add(p)
            changed.append(p)
            _union_auth(self.kauth_pub.setdefault("main", {}), {p: fresh(new.auth.get(p, {}), old.auth.get(p, {}))})
            _union_del(self.kdel_pub.setdefault("main", {}), {p: fresh(new.dels.get(p, {}), old.dels.get(p, {}))})
        self.mem = new
        return {"moved": True, "tree": new.tree, "via": new.via, "paths": sorted(changed)}

    def r_store(self, repo, commit, run="?"):
        import weave_store as S
        mem = self.mem
        if mem is None:
            return {"stored": False, "reason": "no-memory"}
        join, auth, dels = self._join()
        named = lambda side: {k: {l if l.startswith("@") else "@r%s:%s" % (run, l.split(".", 1)[1] if "." in l else "?") for l in who}
                              for k, who in side.items()}
        changed = 0
        for p, st in join.items():
            if p in mem.unwoven:
                continue
            old = mem.states.get(p)
            if old is None and st == self.base.get(p):
                continue
            if old is not None and p not in self.mem_installed:
                st = M.merge_states(old, st)[0]
            if st == old:
                continue
            mem.states[p] = st
            mem.dirty.add(p)
            S.union(mem.auth.setdefault(p, {}), named(auth.get(p, {})))
            S.union(mem.dels.setdefault(p, {}), named(dels.get(p, {})))
            changed += 1
        self.mem = None
        try:
            entry = S.settle(repo, commit, mem)
        except S.Drift as e:
            return {"stored": False, "reason": "drift", "paths": e.paths}
        return {"stored": True, "entry": entry, "tree": mem.tree, "paths": changed}

    def _join(self):
        join, auth, dels = {}, {}, {}
        for who, pub in self.published.items():
            for p, st in pub.items():
                join[p] = st if p not in join else M.merge_states(join[p], st)[0]
            _union_auth(auth, self.kauth_pub.get(who, {}))
            _union_del(dels, self.kdel_pub.get(who, {}))
        return join, auth, dels

    def r_blame(self):
        join, auth, _ = self._join()
        out = {}
        for p, st in join.items():
            js, side = M.deserialize_state(st), auth.get(p, {})
            mine = {k: {l for l in who if not l.startswith("@")} for k, who in side.items()}
            out[p] = [label_of(mine, k) for e, k in zip(js, line_keys(js)) if e[3] % 2]
        return {"blame": out}

    def r_authors_keyed(self, agent, path):
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
        except Exception as e:
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        sys.stdout.write(json.dumps(res) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    run_on_kernel_thread(serve)
