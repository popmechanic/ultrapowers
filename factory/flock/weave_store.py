#!/usr/bin/env python3
"""The weave store: main's memory (the main-is-a-peer design, stage 1). No engine reads it yet.

Each tree of a target's default branch has at most one stored weave, an *entry*: one commit on
the ref `refs/ultrapowers/weave/v1` of the target repository, subject `weave <tree sha>`. The ref
is an append-only log of entries; their order means nothing, and lookup is by subject. Where two
entries name one tree, the one nearer the root is the entry.

An entry's tree:
  meta.json                   {"v": 1, "tree", "via": "genesis" | "replay" | "run", "unwoven": [path]}
  w/<path>/.weave-state       the Manyana state string of <path>
  w/<path>/.weave-auth        {line key: [label]}, who wrote each line (weave.py's kauth)
  w/<path>/.weave-dels        {line key: [label]}, who deleted each line (weave.py's kdel)

A path with no `.weave-state` has the weave `initial_state` of its text at that tree. A path that
is ever not a regular UTF-8 file is listed in `unwoven` and never woven again.

The one rule (probe, n=25 files, 917 commits, 2026-11-12: two weaves of one text built by
different routes merged back to that text 0 times in 25): a tree's weave is built once and shared.
A commit with no entry is replayed from the nearest stored first-parent ancestor, one commit at a
time, each changed file through the keeper's `rewrite`. That recipe is a pure function of the
ancestor's entry and the commits, so two sandboxes write byte-identical entries, and replaying
A->B->C equals replaying B->C from a stored B. A replayed line is authored `@c:<commit sha12>`.

Git stays the fact: every load checks each stored path's visible text against git's text at that
tree, and a mismatch raises Drift.

    python3 factory/flock/weave_store.py open --repo <dir> --commit <sha> [--remote origin]
    python3 factory/flock/weave_store.py push --repo <dir> [--remote origin]

    python3 factory/flock/weave_store.py join --repo <dir> --run <sha> --onto <sha> --out <file> [--remote origin]
    python3 factory/flock/weave_store.py settle --repo <dir> --commit <sha> --from <file>

`join` is the catch-up's merge: the run's entry joined with the moved main's, one JSON line
{"joined": true, "conflicts": [path], "files": {path: text | null}, "paths": [path]}: `paths` every
path it decided, `files` those whose text differs from the moved main's; or {"joined": false,
"reason"}. The joined Memory goes to --out.
`settle` stores that Memory as the entry of the commit the catch-up then made:
{"stored": true, "entry"} or {"stored": false, "reason"}.

`open` prints one JSON line: {"memory": true, "tree", "via", "stored", "unwoven"} (exit 0),
{"memory": false, "reason": "before-genesis"} (exit 0), or {"memory": false, "reason": "drift",
"paths"} (exit 1). With --remote it syncs first, and a store it begins is pushed before it is used.
"""
import json, os, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import weave as W  # noqa: E402

M = W.M
REF = "refs/ultrapowers/weave/v1"
REMOTE_REF = "refs/ultrapowers/weave-remote/v1"
STATE, AUTH, DELS = ".weave-state", ".weave-auth", ".weave-dels"
REGULAR = ("100644", "100755")
ABSENT = "000000"
IDENTITY = {"GIT_AUTHOR_NAME": "flock", "GIT_AUTHOR_EMAIL": "flock@ultrapowers.invalid",
            "GIT_COMMITTER_NAME": "flock", "GIT_COMMITTER_EMAIL": "flock@ultrapowers.invalid"}


class Drift(Exception):
    """Stored weaves whose visible text is not git's text at their tree."""

    def __init__(self, tree, paths):
        super().__init__("weave drift at %s: %s" % (tree[:12], ", ".join(paths[:5])))
        self.tree, self.paths = tree, paths


def git(repo, *args, data=None, env=None, ok=False):
    """One git process in `repo`; its stdout as bytes. A non-zero exit raises unless `ok`."""
    r = subprocess.run(["git", "-C", repo, *args], input=data, capture_output=True,
                       env=None if env is None else {**os.environ, **env})
    if r.returncode != 0 and not ok:
        raise RuntimeError("git %s exited %d: %s" % (" ".join(args), r.returncode, r.stderr.decode("utf-8", "replace")))
    return r.stdout if r.returncode == 0 else None


def out(repo, *args, **kw):
    r = git(repo, *args, **kw)
    return None if r is None else r.decode().strip()


def tree_of(repo, rev):
    return out(repo, "rev-parse", rev + "^{tree}")


def entries(repo, ref=REF):
    """{tree sha: entry commit} off `ref`; of two entries for one tree, the one nearer the root."""
    log = out(repo, "log", "--format=%H %s", ref, ok=True)
    found = {}
    for line in (log or "").splitlines():   # tip first, so a rootward entry overwrites
        sha, _, subject = line.partition(" ")
        if subject.startswith("weave "):
            found[subject[len("weave "):]] = sha
    return found


def cat(repo, shas):
    """{blob sha: bytes} for `shas`, through one `cat-file --batch`."""
    shas = list(dict.fromkeys(shas))
    if not shas:
        return {}
    raw = git(repo, "cat-file", "--batch", data=("\n".join(shas) + "\n").encode())
    got, i = {}, 0
    for sha in shas:
        nl = raw.index(b"\n", i)
        head = raw[i:nl].split()
        if head[-1] == b"missing":
            raise RuntimeError("blob %s is missing" % sha)
        size = int(head[2])
        got[sha] = raw[nl + 1:nl + 1 + size]
        i = nl + 1 + size + 1
    return got


def listing(repo, tree):
    """{path: (mode, blob sha)} for every blob under `tree`."""
    raw = git(repo, "ls-tree", "-r", "-z", tree)
    found = {}
    for rec in raw.split(b"\0"):
        if not rec:
            continue
        head, _, path = rec.partition(b"\t")
        mode, _kind, sha = head.decode().split()
        found[path.decode("utf-8", "surrogateescape")] = (mode, sha)
    return found


def text_of(data):
    """A blob's bytes as text, or None when they are not UTF-8."""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


class Memory:
    """One tree's weaves: the stored paths' states and sidecars, and the paths never woven."""

    def __init__(self, tree, entry=None, via=None):
        self.tree, self.entry, self.via = tree, entry, via
        self.states = {}      # path -> Manyana state string
        self.auth = {}        # path -> {line key: set(label)}
        self.dels = {}        # path -> {line key: set(label)}
        self.unwoven = set()
        self.dirty = set()    # paths changed since `entry` was read

    def summary(self):
        return {"memory": True, "tree": self.tree, "via": self.via, "stored": len(self.states), "unwoven": len(self.unwoven)}

    def to_json(self):
        lists = lambda side: {p: {k: sorted(v) for k, v in m.items()} for p, m in side.items()}
        return {"tree": self.tree, "entry": self.entry, "via": self.via, "states": self.states, "auth": lists(self.auth),
                "dels": lists(self.dels), "unwoven": sorted(self.unwoven), "dirty": sorted(self.dirty)}

    @classmethod
    def from_json(cls, doc):
        mem = cls(doc["tree"], doc["entry"], doc["via"])
        sets = lambda side: {p: {k: set(v) for k, v in m.items()} for p, m in side.items()}
        mem.states, mem.auth, mem.dels = doc["states"], sets(doc["auth"]), sets(doc["dels"])
        mem.unwoven, mem.dirty = set(doc["unwoven"]), set(doc["dirty"])
        return mem


def load(repo, entry):
    """The Memory an entry commit holds."""
    blobs = listing(repo, tree_of(repo, entry))
    data = cat(repo, [sha for _, sha in blobs.values()])
    meta = json.loads(data[blobs["meta.json"][1]])
    mem = Memory(meta["tree"], entry, meta["via"])
    mem.unwoven = set(meta["unwoven"])
    for p, (_, sha) in blobs.items():
        if not p.startswith("w/"):
            continue
        path, _, leaf = p[2:].rpartition("/")
        if leaf == STATE:
            mem.states[path] = data[sha].decode("utf-8")
        elif leaf in (AUTH, DELS):
            side = {k: set(v) for k, v in json.loads(data[sha]).items()}
            (mem.auth if leaf == AUTH else mem.dels)[path] = side
    return mem


def verify(repo, mem):
    """The stored paths whose visible text is not git's text at the Memory's tree."""
    at = listing(repo, mem.tree)
    data = cat(repo, [at[p][1] for p in mem.states if p in at])
    bad = []
    for p, state in mem.states.items():
        want = []   # absent at this tree: every line deleted
        if p in at:
            text = text_of(data[at[p][1]]) if at[p][0] in REGULAR else None
            if text is None:
                bad.append(p)
                continue
            want = text.split("\n")
        if M.current_lines(state) != want:
            bad.append(p)
    return sorted(bad)


def replay(repo, mem, parent, commit):
    """Carry `mem` from `parent`'s tree to `commit`'s: each changed text file through the keeper's
    rewrite, authored `@c:<commit sha12>`. The one recipe by which a tree with no entry gets one."""
    raw = git(repo, "diff-tree", "-r", "--no-renames", "--raw", "-z", parent, commit)
    parts = raw.split(b"\0")
    changes = []
    for i in range(0, len(parts) - 1, 2):
        old_mode, new_mode, old_sha, new_sha, _status = parts[i].decode().lstrip(":").split()
        changes.append((parts[i + 1].decode("utf-8", "surrogateescape"), old_mode, new_mode, old_sha, new_sha))
    data = cat(repo, [s for _, om, nm, osha, nsha in changes for m, s in ((om, osha), (nm, nsha)) if m in REGULAR])
    label = "@c:" + commit[:12]
    keeper = W.Keeper()
    keeper.kauth[label], keeper.kdel[label] = mem.auth, mem.dels   # shared: the keeper's writes are the Memory's
    work = []
    for path, old_mode, new_mode, old_sha, new_sha in changes:
        if path in mem.unwoven:
            continue
        old = text_of(data[old_sha]) if old_mode in REGULAR else None
        new = text_of(data[new_sha]) if new_mode in REGULAR else None
        if (old_mode != ABSENT and old is None) or (new_mode != ABSENT and new is None):
            mem.unwoven.add(path)
            for side in (mem.states, mem.auth, mem.dels):
                side.pop(path, None)
            mem.dirty.add(path)
            continue
        if path in mem.states:
            keeper.base[path] = mem.states[path]
        elif old is not None:
            keeper.base[path] = M.initial_state(old.split("\n"))
        work.append((path, new))
    for path, new in work:
        keeper.r_rewrite(label, path, new)
        mem.states[path] = keeper.copy(label)[path]
        mem.dirty.add(path)
    mem.tree = tree_of(repo, commit)


def _side_json(side):
    return json.dumps({k: sorted(v) for k, v in side.items() if v}, sort_keys=True, separators=(",", ":")).encode()


def _blob(repo, data):
    return git(repo, "hash-object", "-w", "--stdin", data=data).decode().strip()


def write_entry(repo, mem, via):
    """Store `mem` as the entry for its tree and return the entry commit. The first entry for a
    tree is the only one: when one is already there it is returned and nothing is written."""
    have = entries(repo)
    if mem.tree in have:
        return have[mem.tree]
    with tempfile.TemporaryDirectory() as tmp:
        env = {"GIT_INDEX_FILE": os.path.join(tmp, "index"), **IDENTITY}
        if mem.entry:
            git(repo, "read-tree", mem.entry, env=env)
        lines = []
        null = "0" * 40
        for path in sorted(mem.dirty):
            leaves = {STATE: None, AUTH: None, DELS: None}
            if path in mem.states:
                leaves[STATE] = mem.states[path].encode("utf-8")
                for leaf, side in ((AUTH, mem.auth), (DELS, mem.dels)):
                    if any(side.get(path, {}).values()):
                        leaves[leaf] = _side_json(side[path])
            for leaf, data in leaves.items():
                where = ("w/%s/%s" % (path, leaf)).encode("utf-8", "surrogateescape")
                lines.append((b"0 " + null.encode() if data is None else b"100644 " + _blob(repo, data).encode()) + b"\t" + where)
        meta = json.dumps({"v": 1, "tree": mem.tree, "via": via, "unwoven": sorted(mem.unwoven)}, sort_keys=True).encode()
        lines.append(b"100644 " + _blob(repo, meta).encode() + b"\tmeta.json")
        git(repo, "update-index", "-z", "--index-info", data=b"\0".join(lines) + b"\0", env=env)
        tree = out(repo, "write-tree", env=env)
    tip = out(repo, "rev-parse", "--verify", "-q", REF, ok=True)
    commit = out(repo, "commit-tree", "--no-gpg-sign", tree, *(["-p", tip] if tip else []), "-m", "weave " + mem.tree, env=IDENTITY)
    git(repo, "update-ref", REF, commit, *([tip] if tip else []))
    mem.entry, mem.via, mem.dirty = commit, via, set()
    return commit


def resolve(repo, commit):
    """The Memory of `commit`'s tree: its entry, or one replayed from the nearest stored
    first-parent ancestor and stored. None when no ancestor has an entry (before genesis)."""
    have = entries(repo)
    if not have:
        return None
    log = subprocess.Popen(["git", "-C", repo, "log", "--first-parent", "--format=%H %T", commit],
                           stdout=subprocess.PIPE, text=True)
    path, found = [], None
    for line in log.stdout:
        sha, tree = line.split()
        if tree in have:
            found = have[tree]
            break
        path.append(sha)
    log.stdout.close()
    log.wait()
    if found is None:
        return None
    mem = load(repo, found)
    bad = verify(repo, mem)
    if bad:
        raise Drift(mem.tree, bad)
    if not path:
        return mem
    chain = path[::-1]   # oldest first
    replay(repo, mem, chain[0] + "^", chain[0])
    for parent, child in zip(chain, chain[1:]):
        replay(repo, mem, parent, child)
    bad = verify(repo, mem)
    if bad:
        raise Drift(mem.tree, bad)
    write_entry(repo, mem, "replay")
    return mem


def genesis(repo, commit):
    """Begin the store: an empty entry at `commit`'s tree, where every path's weave is its text."""
    mem = Memory(tree_of(repo, commit))
    write_entry(repo, mem, "genesis")
    return mem


def union(into, other):
    """Take `other`'s labels into `into`: both are one path's {line key: set(label)}."""
    for k, who in other.items():
        into.setdefault(k, set()).update(who)


def settle(repo, commit, mem, via="run"):
    """Store `mem` as the entry of `commit`'s tree: the weaves a run (or a catch-up's join) ended on.
    A stored path that is not a regular UTF-8 file there becomes unwoven. Raises Drift, and stores
    nothing, when a stored path's visible text is not git's text at that tree."""
    mem.tree = tree_of(repo, commit)
    at = listing(repo, mem.tree)
    data = cat(repo, [at[p][1] for p in mem.states if p in at and at[p][0] in REGULAR])
    for p in [p for p in mem.states if p in at and (at[p][0] not in REGULAR or text_of(data[at[p][1]]) is None)]:
        mem.unwoven.add(p)
        for side in (mem.states, mem.auth, mem.dels):
            side.pop(p, None)
        mem.dirty.add(p)
    bad = verify(repo, mem)
    if bad:
        raise Drift(mem.tree, bad)
    return write_entry(repo, mem, via)


def join(repo, run, onto):
    """The catch-up's merge. `run` is the run's own commit, whose entry the engine stored; `onto` is
    the moved main. Both weaves descend from the entry the run started on, so this is one
    `merge_states` per path that differs, with every line's identity kept: no text is diffed.
    Returns ({"joined": True, "conflicts", "files", "paths"}, Memory) or ({"joined": False, "reason"}, None)."""
    have = entries(repo)
    if tree_of(repo, run) not in have:
        return {"joined": False, "reason": "no-run-entry"}, None
    mem = resolve(repo, onto)
    if mem is None:
        return {"joined": False, "reason": "before-genesis"}, None
    ours = load(repo, have[tree_of(repo, run)])
    at = listing(repo, mem.tree)
    lazy = [p for p in ours.states if p not in mem.states and p in at and at[p][0] in REGULAR]
    data = cat(repo, [at[p][1] for p in lazy])
    conflicts, files, decided = [], {}, []
    for p in sorted(ours.states):
        if p in mem.unwoven or p in ours.unwoven:
            continue
        theirs = mem.states.get(p)
        if theirs is None and p in at:
            text = text_of(data[at[p][1]]) if at[p][0] in REGULAR else None
            if text is None:
                continue                      # not text on main: the catch-up's own byte rule decides it
            theirs = M.initial_state(text.split("\n"))
        mine = ours.states[p]
        decided.append(p)
        if theirs is None:
            new = mine                        # the run made this path
        elif theirs == mine:
            continue
        else:
            new, marked = M.merge_states(theirs, mine)
            if marked != M.current_lines(new):
                conflicts.append(p)
        union(mem.auth.setdefault(p, {}), ours.auth.get(p, {}))
        union(mem.dels.setdefault(p, {}), ours.dels.get(p, {}))
        if new != mem.states.get(p):
            mem.states[p] = new
            mem.dirty.add(p)
        before = M.current_lines(theirs) if theirs is not None else []
        after = M.current_lines(new)
        if after != before:
            files[p] = "\n".join(after) if after else None
    mem.unwoven |= ours.unwoven
    return {"joined": True, "conflicts": conflicts, "files": files, "paths": decided}, mem


def sync(repo, remote="origin"):
    """Take in the remote's entries. Local entries whose trees the remote lacks are kept, re-parented
    onto the remote's tip; one whose tree the remote holds is dropped, and named in `forks` when the
    two differ. A local genesis is dropped once the remote has any entry: a store has one beginning."""
    fetched = git(repo, "fetch", "-q", remote, "+%s:%s" % (REF, REMOTE_REF), ok=True)
    theirs = entries(repo, REMOTE_REF) if fetched is not None else {}
    tip = out(repo, "rev-parse", "--verify", "-q", REMOTE_REF, ok=True) if theirs else None
    if not tip:
        return {"forks": [], "kept": len(entries(repo))}
    mine = out(repo, "rev-list", "--reverse", REF, "--not", REMOTE_REF, ok=True)
    forks, kept = [], 0
    for sha in (mine or "").split():
        subject = out(repo, "log", "-1", "--format=%s", sha)
        tree = subject[len("weave "):]
        if tree in theirs:
            if tree_of(repo, sha) != tree_of(repo, theirs[tree]):
                forks.append(tree)
            continue
        if json.loads(git(repo, "show", sha + ":meta.json"))["via"] == "genesis":
            continue
        tip = out(repo, "commit-tree", "--no-gpg-sign", tree_of(repo, sha), "-p", tip, "-m", subject, env=IDENTITY)
        kept += 1
    git(repo, "update-ref", REF, tip)
    return {"forks": forks, "kept": kept}


def push(repo, remote="origin", tries=5):
    """Sync, then push the local entries without force; a refused push syncs and tries again."""
    forks = []
    for _ in range(tries):
        forks += sync(repo, remote)["forks"]
        if forks:
            # this clone built a tree's weave the remote holds differently, so what it wove on top
            # of its own is not main's memory: keep the remote's and push nothing
            return {"pushed": False, "forks": forks}
        tip = out(repo, "rev-parse", "--verify", "-q", REF, ok=True)
        if not tip:
            return {"pushed": False, "forks": forks}
        if tip == out(repo, "rev-parse", "--verify", "-q", REMOTE_REF, ok=True):
            return {"pushed": True, "forks": forks}
        # the lease is the remote tip this clone last saw (none: the ref must not exist yet), so the
        # push lands only on the entries it was built on
        lease = "--force-with-lease=%s:%s" % (REF, out(repo, "rev-parse", "--verify", "-q", REMOTE_REF, ok=True) or "")
        if git(repo, "push", "-q", lease, remote, "%s:%s" % (REF, REF), ok=True) is not None:
            git(repo, "update-ref", REMOTE_REF, tip)
            return {"pushed": True, "forks": forks}
    return {"pushed": False, "forks": forks}


def open_store(repo, commit, remote=None):
    """The Memory a run starts from at `commit`, or None when the commit is older than the store.
    With no store anywhere, begins one at `commit`; with a remote, a store begun here is pushed
    before it is used, so two sandboxes beginning at once end on one beginning."""
    if remote:
        sync(repo, remote)
    mem = resolve(repo, commit)
    if mem is None and not entries(repo):
        genesis(repo, commit)
        if remote:
            push(repo, remote)
        mem = resolve(repo, commit)
    return mem


def main(argv):
    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default
    verb, repo, remote = (argv[0] if argv else None), arg("--repo"), arg("--remote")
    if verb == "open" and repo and arg("--commit"):
        try:
            mem = open_store(repo, out(repo, "rev-parse", arg("--commit")), remote)
        except Drift as e:
            print(json.dumps({"memory": False, "reason": "drift", "paths": e.paths}))
            return 1
        print(json.dumps(mem.summary() if mem else {"memory": False, "reason": "before-genesis"}))
        return 0
    if verb == "join" and repo and arg("--run") and arg("--onto") and arg("--out"):
        if remote:
            sync(repo, remote)
        try:
            res, mem = join(repo, out(repo, "rev-parse", arg("--run")), out(repo, "rev-parse", arg("--onto")))
        except Drift as e:
            res, mem = {"joined": False, "reason": "drift", "paths": e.paths}, None
        if mem is not None:
            with open(arg("--out"), "w", encoding="utf-8") as f:
                json.dump(mem.to_json(), f)
        print(json.dumps(res))
        return 0 if res["joined"] else 1
    if verb == "settle" and repo and arg("--commit") and arg("--from"):
        with open(arg("--from"), encoding="utf-8") as f:
            mem = Memory.from_json(json.load(f))
        try:
            print(json.dumps({"stored": True, "entry": settle(repo, out(repo, "rev-parse", arg("--commit")), mem)}))
            return 0
        except Drift as e:
            print(json.dumps({"stored": False, "reason": "drift", "paths": e.paths}))
            return 1
    if verb == "push" and repo:
        res = push(repo, remote or "origin")
        print(json.dumps(res))
        return 0 if res["pushed"] else 1
    print("usage: weave_store.py open --repo <dir> --commit <sha> [--remote <name>] | push --repo <dir> [--remote <name>]"
          " | join --repo <dir> --run <sha> --onto <sha> --out <file> [--remote <name>] | settle --repo <dir> --commit <sha> --from <file>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(W.run_on_kernel_thread(main, sys.argv[1:]))
