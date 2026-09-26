"""Offline weave replay — map #1292 ticket 1.

For every fleet PR head whose first-parent chain carries per-landing `task N`
commits, recover each landing's own change against the run's base, then for
every path two or more landings touched (a real same-file concurrency case):

  A  convergence   — merge the tasks' weaves in every order (<=24): one state?
  B  persistent    — the order-free join's text vs the recorded final text
  C  rebuild       — the engine's method (frontier re-derived from base by
                     update_state each landing) vs a persistent frontier, and
                     each vs the recorded landing text
  D  git control   — sequential `git merge-file` from base
  E  autojunk off  — A-C again with difflib's popularity heuristic disabled
  T  timing        — wall of the weave work per path, by size

Reconstruction: T_i = C_i with the earlier landings' changes to the path
reverted (`git merge-file -p C_i P_i BASE`); a conflict there means the task's
lines overlap an earlier landing's — counted as `entangled`, not replayed.
"""
import difflib, itertools, json, os, random, subprocess, sys, tempfile, time

KERNEL = "/Users/marcusestes/Websites/ultrapowers/skills/ultrapowers/kernel"
sys.path[:0] = [KERNEL, KERNEL + "/vendor"]
import manyana, repo_weave as rw, fold_wave  # noqa: E402

REPO = sys.argv[1] if len(sys.argv) > 1 else "/Users/marcusestes/Websites/ultrapowers"
REF_GLOB = sys.argv[2] if len(sys.argv) > 2 else "refs/remotes/pr"
OUT = sys.argv[3] if len(sys.argv) > 3 else "replay.jsonl"
SM = difflib.SequenceMatcher


def git(*a, check=True):
    return subprocess.run(["git", "-C", REPO, *a], capture_output=True, check=check).stdout


def blob(ref, p):
    r = subprocess.run(["git", "-C", REPO, "show", f"{ref}:{p}"], capture_output=True)
    return r.stdout if r.returncode == 0 else None


def text(b):
    if b is None:
        return None
    if rw.is_binary(b):
        raise ValueError("binary")
    return b.decode()


def merge_file(cur, base, other):
    with tempfile.TemporaryDirectory() as d:
        fs = []
        for n, c in (("cur", cur), ("base", base), ("other", other)):
            f = os.path.join(d, n)
            open(f, "w").write(c or "")
            fs.append(f)
        r = subprocess.run(["git", "merge-file", "-p", *fs], capture_output=True)
        return r.stdout.decode(), r.returncode


def rebase_hunks(base_t, P, C):
    """Apply the P->C change onto base by line mapping, no context.
    Returns (T, why): T None when a hunk touches or anchors on lines that
    exist only because an earlier landing put them there (a dependent edit)."""
    b, p, c = lines(base_t), lines(P), lines(C)
    pmap = {}
    for tag, i1, i2, j1, j2 in SM(None, b, p, autojunk=False).get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                pmap[j1 + k] = i1 + k
    edits = []
    for tag, i1, i2, j1, j2 in SM(None, p, c, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        if i2 > i1:
            idx = [pmap.get(k) for k in range(i1, i2)]
            if None in idx or idx != list(range(idx[0], idx[0] + len(idx))):
                return None, "edits-earlier-lines"
            edits.append((idx[0], idx[-1] + 1, c[j1:j2]))
        else:
            if i1 == 0:
                at = 0
            elif (i1 - 1) in pmap:
                at = pmap[i1 - 1] + 1
            elif i1 in pmap:
                at = pmap[i1]
            else:
                return None, "anchors-on-earlier-lines"
            edits.append((at, at, c[j1:j2]))
    out, pos = [], 0
    for a, z, new in sorted(edits, key=lambda e: (e[0], e[1])):
        if a < pos:
            return None, "overlapping-hunks"
        out += b[pos:a] + new
        pos = z
    out += b[pos:]
    return "\n".join(out), "mapped"


def landings(ref):
    rows = git("log", "--first-parent", "--format=%H %s", "-80", ref).decode().splitlines()
    chain, started = [], False
    for row in rows:
        sha, subj = row.split(" ", 1)
        is_task = subj.startswith("task ") and subj[5:].strip().isdigit()
        if is_task:
            started = True
            chain.append((sha, subj))
        elif started:
            return sha, list(reversed(chain))
    return None, []


def lines(t):
    return rw.split_lines(t) if t is not None else []


def conflicted(merged, ann):
    return ann != manyana.current_lines(merged)


def join(a, b):
    m, ann = manyana.merge_states(a, b)
    return m, conflicted(m, ann)


def weave_text(state):
    return "\n".join(manyana.current_lines(state))


def replay_path(base_t, recorded, tasks):
    """tasks: [(i, T_i, P_i_text, C_i_text)] in landing order."""
    out = {}
    B0 = manyana.initial_state(lines(base_t)) if base_t is not None else manyana.initial_state([])
    W = {i: manyana.update_state(B0, lines(T)) for i, T, _, _ in tasks}
    ids = [i for i, *_ in tasks]
    perms = list(itertools.permutations(ids))
    if len(perms) > 24:
        random.seed(0)
        perms = random.sample(perms, 24)
    states, conf_any = set(), False
    for order in perms:
        s = W[order[0]]
        c = False
        for j in order[1:]:
            s, cj = join(s, W[j])
            c = c or cj
        states.add(s)
        conf_any = conf_any or c
    out["A_converges"] = len(states) == 1
    final_state = next(iter(states))
    out["B_conflict"] = conf_any
    out["B_matches_recorded"] = (not conf_any) and weave_text(final_state) == recorded
    # C: per landing after the first, rebuild vs persistent
    reb, per = [], []
    persist = W[ids[0]]
    for i, T, P, C in tasks[1:]:
        frontier = manyana.update_state(B0, lines(P))
        mr, cr = join(frontier, W[i])
        mp, cp = join(persist, W[i])
        reb.append({"conflict": cr, "matches": (not cr) and weave_text(mr) == C})
        per.append({"conflict": cp, "matches": (not cp) and weave_text(mp) == C,
                    "same_as_rebuild": weave_text(mp) == weave_text(mr) and cp == cr})
        persist = mp
    out["C_rebuild"], out["C_persist"] = reb, per
    # D: git merge-file, sequential from base
    acc, gconf = base_t or "", False
    for i, T, _, _ in tasks:
        acc, rc = merge_file(acc, base_t or "", T)
        gconf = gconf or rc != 0
    out["D_git_conflict"] = gconf
    out["D_git_matches_recorded"] = (not gconf) and acc == recorded
    out["D_git_equals_weave"] = (not gconf) and (not conf_any) and acc == weave_text(final_state)
    return out


def with_autojunk(on, fn, *a):
    manyana.SequenceMatcher = SM if on else (lambda *x, **k: SM(*x, autojunk=False, **k))
    try:
        return fn(*a)
    finally:
        manyana.SequenceMatcher = SM


def main():
    refs = git("for-each-ref", "--format=%(refname:short)", REF_GLOB).decode().split()
    rows, stats = [], {"runs": 0, "landings": 0, "shared_paths": 0, "entangled": 0, "binary": 0, "deleted": 0}
    for ref in refs:
        base, chain = landings(ref)
        if len(chain) < 2:
            continue
        stats["runs"] += 1
        stats["landings"] += len(chain)
        shas = [base] + [s for s, _ in chain]
        touched = {}
        for k in range(1, len(shas)):
            for p in git("diff", "--no-renames", "--name-only", shas[k - 1], shas[k]).decode().split():
                touched.setdefault(p, []).append(k)
        for p, ks in sorted(touched.items()):
            if len(ks) < 2:
                continue
            stats["shared_paths"] += 1
            try:
                base_t = text(blob(base, p))
                recorded = text(blob(shas[-1], p))
                tasks, entangled, adjacent = [], False, False
                for k in ks:
                    C, P = text(blob(shas[k], p)), text(blob(shas[k - 1], p))
                    if C is None:
                        raise LookupError("deleted")
                    if P == base_t:
                        T = C
                    else:
                        T, rc = merge_file(C, P or "", base_t or "")
                        if rc != 0:
                            T, why = rebase_hunks(base_t, P, C)
                            if T is None:
                                entangled = why
                            else:
                                adjacent = True
                    tasks.append((k, T, P, C))
            except ValueError:
                stats["binary"] += 1
                continue
            except LookupError:
                stats["deleted"] += 1
                continue
            row = {"ref": ref, "path": p, "landings": ks, "base_lines": len(lines(base_t)),
                   "final_lines": len(lines(recorded)), "entangled": entangled, "adjacent": adjacent}
            if entangled:
                stats["entangled"] += 1
                rows.append(row)
                continue
            t0 = time.perf_counter()
            row["junk_on"] = with_autojunk(True, replay_path, base_t, recorded, tasks)
            row["secs_on"] = round(time.perf_counter() - t0, 3)
            t0 = time.perf_counter()
            row["junk_off"] = with_autojunk(False, replay_path, base_t, recorded, tasks)
            row["secs_off"] = round(time.perf_counter() - t0, 3)
            rows.append(row)
            print(ref, p, ks, row["secs_on"], file=sys.stderr)
    with open(OUT, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(json.dumps(stats))


if __name__ == "__main__":
    fold_wave.run_on_kernel_thread(main)
