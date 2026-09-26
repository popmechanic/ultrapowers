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


class Keeper:
    def __init__(self):
        self.base = {}        # path -> weave state
        self.copies = {}      # agent -> {path -> state}
        self.published = {}   # agent -> {path -> state}

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
        return {"paths": len(self.published[agent])}

    def r_pull(self, agent):
        mine = self.copy(agent)
        changed = []
        for peer, pub in self.published.items():
            if peer == agent:
                continue
            for p, st in pub.items():
                before = mine.get(p)
                if before is None:
                    mine[p] = st
                    after, conflict, ann = st, False, []
                else:
                    after, ann = M.merge_states(before, st)
                    conflict = ann != M.current_lines(after)
                    mine[p] = after
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
                                        "text": "\n".join(new), "exists": bool(new_raw)})
        return {"changed": changed}

    def r_merged(self):
        out, conflicts, annotated, adds_only = {}, [], {}, {}
        for pub in self.published.values():
            for p, st in pub.items():
                if p not in out:
                    out[p] = st
                else:
                    m, ann = M.merge_states(out[p], st)
                    if ann != M.current_lines(m):
                        conflicts.append(p)
                        heads = [l for l in ann if l.startswith(("<<<<<<< begin", "======= begin"))]
                        only = all(("added" in h) for h in heads)
                        adds_only[p] = adds_only.get(p, True) and only
                        annotated[p] = "\n".join(strip(l) for l in ann)
                    out[p] = m
        files = {p: "\n".join(strip(l) for l in visible_raw(st)) for p, st in out.items()}
        exists = {p: bool(visible_raw(st)) for p, st in out.items()}
        return {"files": files, "exists": exists, "conflicts": sorted(set(conflicts)), "annotated": annotated, "addsOnly": adds_only}

    def r_authors(self, agent, path):
        return {"authors": [self.who(agent, path, l) for l in visible_raw(self.state(agent, path))]}


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
