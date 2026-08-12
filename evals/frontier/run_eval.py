"""Frontier probe eval runner: corpus tracks, per-case JSON, roll-up report.

Two tracks today:

* **(a) fixtures** — every plan-bearing fixture in `evals/fixtures/` is compiled by
  the committed plan compiler, its implementation tasks are turned into synthetic
  diffs, and the resulting task set is replayed through the weave layer in many
  fold orders. Reports modeled makespans (waves vs frontier vs frontier without
  same-file edges) alongside the K1 order-independence check.
* **(b) same-file scenarios** — five hand-built scenarios that put two or more
  tasks on the *same* file, which is precisely where wave scheduling and frontier
  scheduling can disagree. These produce the conflict narrations an operator
  grades (S3).

* **(c) archived runs** — real `ultra/integration-*` merges are recovered from the
  git history of `--repo`, each wave's task branches are re-published and re-folded
  in sampled orders, and the folded result is compared against the tree the
  historical merge actually recorded. A clean-path mismatch is *silent divergence*
  — the K3 failure condition. Reconciliation commits on the integration chain are
  tolerated (#133): each one folds into its wave as a *pseudo-task* endpoint diff
  (`parent..tip`, consecutive commits coalesced), unless a following wave's
  merge-base already contains it, in which case that wave's base snapshot absorbs
  it. Reconciliation commits after the last merge have no merge tree to compare
  against, so fidelity comparison cuts at the last merge — recorded on the run,
  never silently. The fidelity bar itself is unchanged: every wave's fold must
  reproduce the tree at that wave's last merge, manifest-identical on paths no
  fold order reported a conflict for. Only chains with an octopus merge or no
  per-task merges at all remain unreplayable, and those are excluded by name.

No-silent-caps: a fixture that degrades still runs and records why; a fixture that
cannot produce tasks at all is recorded as an exclusion with its reason; every
archived run that could not be recovered is named with its reason, and K3 states
the recovered-n whenever that n sits below the floor. Every exclusion reaches
`rollup.md`.
"""
import argparse
import json
import random
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import repo_weave as rw  # noqa: E402
import schedule_model as sm  # noqa: E402

sys.path.insert(0, str(HERE / "vendor"))
import manyana  # noqa: E402

FIXTURES = ["wide", "chained", "mixed", "flawed", "degrade", "webapp", "contend"]
COMPILER = ROOT / "skills" / "ultrapowers" / "scripts" / "compile_plan.py"
KNOWN_TRACKS = ("a", "b", "c")
DURATION_LO, DURATION_HI = 60, 600

# Track (c): the marker an integration merge carries, and the smallest number of
# recovered runs that makes K3 worth believing.
INTEGRATION_MARKER = "ultra/integration-"
TRACK_C_FLOOR = 3
# The vendored kernel recurses once per line; a file near the interpreter's
# default recursion limit needs real headroom before manyana ever touches it,
# sized to the corpus actually being replayed (see `_recursion_headroom`).
RECURSION_LINE_FACTOR = 4
RECURSION_MARGIN = 1000
# `%x00` is git's own escape: a literal NUL cannot travel in an argv element.
NUL = "\x00"
FMT_SHA_PARENTS = "%H%x00%P"
FMT_SHA_PARENTS_SUBJECT = "%H%x00%P%x00%s"


# --------------------------------------------------------------------------
# compilation + synthetic-diff construction (track a)
# --------------------------------------------------------------------------

def compile_fixture(name):
    plan = ROOT / "evals" / "fixtures" / name / "plan.md"
    out = subprocess.run([sys.executable, str(COMPILER), str(plan)],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def slug(path):
    """Path stem with every non-alphanumeric run replaced by a single `_`."""
    return re.sub(r"[^0-9a-zA-Z]+", "_", Path(path).stem).strip("_")


def solo_content(task_id, path):
    """The whole-file contribution of the only task that writes `path`."""
    return ("# %s generated for frontier eval\n"
            "def task_%s_%s():\n"
            "    return \"%s\"\n" % (path, task_id, slug(path), task_id))


def shared_base_lines(path):
    """A 10-line base file for a path several tasks append to."""
    lines = ["# %s shared base for frontier eval" % path]
    lines += ["BASE_%d = %d" % (i, i) for i in range(8)]
    lines += ["# end of shared base"]
    return lines


def contiguity_block(task_id, path):
    """The block a task appends to a shared file — checked for non-interleaving."""
    return ["def task_%s_%s():" % (task_id, slug(path)),
            "    return \"%s\"" % task_id]


def shared_content(task_id, path):
    """Shared-path contribution: the common base plus this task's own block."""
    return rw.join_lines(shared_base_lines(path) + [""] + contiguity_block(task_id, path))


def build_fixture_case(name, compiled, seed):
    """Turn a compiled plan into a base state, task states, and durations."""
    impl = [t for t in compiled["tasks"] if t["disposition"] == "implementation"]
    writers = {}
    for task in impl:
        for path in task["writes"]:
            writers.setdefault(path, []).append(task["id"])
    shared = {p for p, ids in writers.items() if len(ids) > 1}

    base = rw.RepoState(
        files={p: manyana.initial_state(shared_base_lines(p)) for p in sorted(shared)},
        deleted_marks=frozenset(), raw={})

    tasks = []
    for task in impl:
        contents = {}
        for path in task["writes"]:
            if path in shared:
                contents[path] = shared_content(task["id"], path)
            else:
                contents[path] = solo_content(task["id"], path)
        tasks.append(rw.task_state_from_contents(base, task["id"], contents))

    rng = random.Random(seed)
    durations = {t["id"]: rng.uniform(DURATION_LO, DURATION_HI) for t in impl}
    return {"name": name, "compiled": compiled, "base": base, "tasks": tasks,
            "durations": durations, "contiguity_paths": sorted(shared)}


def fixture_cases(seed=42):
    """Track (a): one case per plan-bearing fixture.

    A fixture that compiles but yields no implementation tasks is still returned,
    carrying an `excluded` reason — never dropped on the floor.
    """
    cases = []
    for name in FIXTURES:
        try:
            compiled = compile_fixture(name)
        except (subprocess.CalledProcessError, ValueError) as exc:
            cases.append({"name": name, "excluded": "compiler failed: %s" % exc,
                          "compiled": None, "base": None, "tasks": [], "durations": {}})
            continue
        case = build_fixture_case(name, compiled, seed)
        if not case["tasks"]:
            case["excluded"] = "compiled to zero implementation tasks"
        cases.append(case)
    return cases


# --------------------------------------------------------------------------
# same-file scenarios (track b)
# --------------------------------------------------------------------------

def _base_from(files):
    return rw.RepoState(
        files={p: manyana.initial_state(rw.split_lines(c)) for p, c in files.items()},
        deleted_marks=frozenset(), raw={})


def _trio_fn(index, note):
    """One 10-line function; three of them make the 30-line disjoint base."""
    return ["def fn_%d(x):" % index,
            "    # %s" % note,
            "    a = x + %d" % index,
            "    b = a * 2",
            "    c = b - 1",
            "    d = c + %d" % index,
            "    e = d * 3",
            "    f = e - 2",
            "    return f",
            ""]


def _case(name, base, tasks, expect_conflict, expect_kinds, contiguity_paths=()):
    return {"name": name, "base": base, "tasks": tasks,
            "expect_conflict": expect_conflict, "expect_kinds": list(expect_kinds),
            "contiguity_paths": list(contiguity_paths)}


def _disjoint_functions():
    lines = _trio_fn(0, "zero") + _trio_fn(1, "one") + _trio_fn(2, "two")
    base = _base_from({"trio.py": rw.join_lines(lines)})
    a = rw.join_lines(_trio_fn(0, "rewritten by task-a") + _trio_fn(1, "one") + _trio_fn(2, "two"))
    b = rw.join_lines(_trio_fn(0, "zero") + _trio_fn(1, "one") + _trio_fn(2, "rewritten by task-b"))
    return _case("disjoint-functions", base,
                 [rw.task_state_from_contents(base, "task-a", {"trio.py": a}),
                  rw.task_state_from_contents(base, "task-b", {"trio.py": b})],
                 False, [])


def _adjacent_lines():
    lines = ["line%d" % i for i in range(12)]
    base = _base_from({"adjacent.py": rw.join_lines(lines)})
    a = list(lines)
    a[5] = "line5 edited by task-a"
    b = list(lines)
    b[6] = "line6 edited by task-b"
    return _case("adjacent-lines", base,
                 [rw.task_state_from_contents(base, "task-a", {"adjacent.py": rw.join_lines(a)}),
                  rw.task_state_from_contents(base, "task-b", {"adjacent.py": rw.join_lines(b)})],
                 True, ["lines"])


def _delete_vs_modify():
    lines = ["def showcase(x):", "    a = x * 2", "    b = a + 1", "    return b", ""]
    base = _base_from({"showcase.py": rw.join_lines(lines)})
    modified = ["def showcase(x):", "    a = x * 2", "    log(a)",
                "    b = a + 1", "    return b", ""]
    return _case("delete-vs-modify", base,
                 [rw.task_state_from_contents(base, "task-del", {"showcase.py": None}),
                  rw.task_state_from_contents(base, "task-mod",
                                              {"showcase.py": rw.join_lines(modified)})],
                 True, ["delete/modify"])


def _add_add(name, content_a, content_b, expect_conflict, expect_kinds):
    base = _base_from({"keep.py": "KEEP = 1\n"})
    return _case(name, base,
                 [rw.task_state_from_contents(base, "task-a", {"fresh.py": content_a}),
                  rw.task_state_from_contents(base, "task-b", {"fresh.py": content_b})],
                 expect_conflict, expect_kinds)


def _four_way_fanin():
    path = "fanin.py"
    base = _base_from({path: rw.join_lines(shared_base_lines(path))})
    tasks = [rw.task_state_from_contents(base, tid, {path: shared_content(tid, path)})
             for tid in ("1", "2", "3", "4")]
    # No conflict expectation: whatever arises is recorded. The hard assertion is
    # that no task's block is interleaved with another's.
    return _case("four-way-fanin", base, tasks, None, [], [path])


def synthetic_cases():
    """Track (b): the five same-file scenarios (add/add contributes two cases)."""
    return [
        _disjoint_functions(),
        _adjacent_lines(),
        _delete_vs_modify(),
        _add_add("add-add-divergent", "FRESH = \"a\"\n", "FRESH = \"b\"\n", True, ["add/add"]),
        _add_add("add-add-identical", "FRESH = \"same\"\n", "FRESH = \"same\"\n", False, []),
        _four_way_fanin(),
    ]


# --------------------------------------------------------------------------
# case execution
# --------------------------------------------------------------------------

def conflict_keys(conflicts):
    """Order-comparison key: the SET of (path, kind) — Conflict's declared
    identity (#132). fold's per-call return is untouched; consumers of the
    per-fold stream (narrations, the arm-B driver) see every conflict.
    """
    return sorted(set((c.path, c.kind) for c in conflicts))


def _makespans(case):
    """Modeled makespans: wave-by-wave vs frontier vs frontier sans same-file edges."""
    compiled, durations = case["compiled"], case["durations"]
    ids = sorted(durations)
    waves = [[t for t in wave if t in durations] for wave in compiled["waves"]]
    edges = compiled["dag_edges"]
    kept = sm.drop_same_file_edges(edges)
    return {
        "waves": sm.waves_makespan(waves, durations),
        "frontier": sm.frontier_makespan(ids, edges, durations),
        "frontier_no_same_file": sm.frontier_makespan(ids, kept, durations),
        "same_file_edges": len(edges) - len(kept),
        "durations_modeled": True,
    }


def _check_contiguity(frontier, case):
    """K4: each writer's block must appear as one unbroken run in the merged file.

    Only tasks that actually contributed to the path are checked — a fixture
    can mix same-file writers with tasks that never touch the shared path.
    """
    paths = case.get("contiguity_paths") or []
    if not paths:
        return None
    files = rw.manifest(frontier)
    for path in paths:
        content = files.get(path)
        if content is None:
            return False
        for task in case["tasks"]:
            if path not in task.weaves and path not in task.raw:
                continue
            block = "\n".join(contiguity_block(task.task_id, path))
            if content.find(block) < 0:
                return False
    return True


def run_case(case, track):
    """Replay one case through every sampled fold order; emit its JSON record."""
    if case.get("excluded"):
        return {"name": case["name"], "track": track, "makespans": None,
                "folds": {"orders_sampled": 0, "k1_identical": None,
                          "k2_idempotent": None},
                "conflicts": [], "no_interleaving": None,
                "expectations_met": None, "excluded": case["excluded"]}

    base, tasks = case["base"], case["tasks"]
    orders = sm.sampled_orders(len(tasks))
    outcomes, canonical = set(), None
    for order in orders:
        frontier, conflicts = sm.fold_all(rw.fold, base, tasks, order)
        outcomes.add((tuple(sorted(rw.manifest(frontier).items())),
                      tuple(conflict_keys(conflicts))))
        if canonical is None:
            canonical = (frontier, conflicts)
    frontier, conflicts = canonical

    # K2 spot-check: re-folding an already-folded task must change nothing.
    refolded, refold_conflicts = rw.fold(base, frontier, tasks[0])
    k2 = (rw.manifest(refolded) == rw.manifest(frontier)
          and set(conflict_keys(refold_conflicts)) <= set(conflict_keys(conflicts)))

    record = {
        "name": case["name"],
        "track": track,
        "makespans": _makespans(case) if track == "a" else None,
        "folds": {"orders_sampled": len(orders),
                  "k1_identical": len(outcomes) == 1,
                  "k2_idempotent": k2},
        "conflicts": [{"path": c.path, "kind": c.kind, "task": c.task_id,
                       "narration": c.narration} for c in conflicts],
        "no_interleaving": _check_contiguity(frontier, case),
        "expectations_met": _expectations_met(case, conflicts),
        "excluded": None,
    }
    if track == "a":
        record["mode"] = case["compiled"].get("mode")
        record["degrade_reason"] = case["compiled"].get("degrade_reason")
    return record


def _expectations_met(case, conflicts):
    """Track (b) declares what it expects; None means 'whatever arises is fine'."""
    if case.get("expect_conflict") is None:
        return None
    kinds = {kind for _, kind in conflict_keys(conflicts)}
    if case["expect_conflict"] != bool(kinds):
        return False
    return all(k in kinds for k in case["expect_kinds"])


# --------------------------------------------------------------------------
# archived-run extraction + replay (track c)
# --------------------------------------------------------------------------

def _git_text(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args],
                          check=True, capture_output=True, text=True).stdout


def _rev(repo, *args):
    return _git_text(repo, *args).strip()


def _mainline(repo):
    """The branch archived runs were merged into; falls back to HEAD."""
    for name in ("main", "master"):
        probe = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--verify", "--quiet",
             name + "^{commit}"], capture_output=True, text=True)
        if probe.returncode == 0:
            return name
    return "HEAD"


def _log_rows(repo, *args):
    """`git log` rows split on NUL; empty lines dropped."""
    rows = []
    for line in _git_text(repo, "log", *args).splitlines():
        if line.strip():
            rows.append(line.split(NUL))
    return rows


def _integration_chain(repo, merge_sha, first_parent, tip):
    """The integration branch's own first-parent commits, oldest first.

    Returns `[(sha, parents)]` for the commits between the fork point and the
    integration tip — the merges the engine made while integrating the run.
    """
    fork = _rev(repo, "merge-base", first_parent, tip)
    rows = _log_rows(repo, "--first-parent", "--format=" + FMT_SHA_PARENTS,
                     "%s..%s" % (fork, tip))
    return [(sha, parents.split()) for sha, parents in reversed(rows)]


def _chain_defect(chain):
    """Why this chain cannot be decomposed into per-task diffs, or None."""
    for sha, parents in chain:
        if len(parents) > 2:
            return "octopus merge %s on integration chain" % sha
    if not any(len(parents) == 2 for _, parents in chain):
        return "no per-task merges on integration chain (nothing to replay)"
    return None


def _is_ancestor(repo, ancestor, descendant):
    """True when `ancestor` is reachable from `descendant`."""
    probe = subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor",
         ancestor, descendant], capture_output=True)
    return probe.returncode == 0


def _pseudo_task(event):
    """A reconciliation event as a foldable pseudo-task endpoint diff."""
    return {"task_id": "recon-%s" % event["ref"][:8],
            "base_ref": event["base_ref"], "ref": event["ref"]}


def _group_chain(repo, chain):
    """Wave groups, reconciliation pseudo-tasks, and any trailing cut.

    Consecutive two-parent merges sharing a merge-base form one wave, exactly
    as before. A non-merge chain commit is a *reconciliation event* —
    consecutive ones coalesce into a single `parent..tip` diff. An event folds
    into the wave whose merges surround it as a pseudo-task; an event followed
    by a new wave whose merge-base already contains it is absorbed by that
    wave's base snapshot instead (nothing left to fold); events after the last
    merge are returned as `trailing` — they have no merge tree to compare
    against, so the run's fidelity comparison cuts at its last merge.

    Returns `(groups, trailing_events)`.
    """
    groups, pending = [], []
    for sha, parents in chain:
        if len(parents) < 2:
            if pending and parents[0] == pending[-1]["ref"]:
                pending[-1]["ref"] = sha
            else:
                pending.append({"base_ref": parents[0], "ref": sha})
            continue
        base_sha = _rev(repo, "merge-base", parents[0], parents[1])
        task = {"task_id": parents[1][:8], "tip_sha": parents[1]}
        if groups and groups[-1]["base_sha"] == base_sha:
            group = groups[-1]
        else:
            # New wave: events already contained in its base need no fold.
            pending = [e for e in pending
                       if not _is_ancestor(repo, e["ref"], base_sha)]
            group = {"base_sha": base_sha, "tasks": [], "after_sha": sha,
                     "recons": []}
            groups.append(group)
        group["recons"] += [_pseudo_task(e) for e in pending]
        pending = []
        group["tasks"].append(task)
        group["after_sha"] = sha
    return groups, pending


def extract_archived_runs(repo):
    """Recover replayable `ultra/integration-*` runs from `repo`'s history.

    `{"runs": [{"ref", "groups", "trailing_recons"}], "excluded": [{"ref",
    "reason"}]}`, newest run first. Reconciliation commits no longer exclude a
    run (#133): they fold as pseudo-task endpoint diffs, are absorbed by a
    later wave's base, or cut the fidelity comparison at the last merge when
    they trail it (see `_group_chain`). A run is excluded only when its chain
    carries an octopus merge or no per-task merges at all. Everything rejected
    is named in `excluded`.
    """
    repo = Path(repo)
    runs, excluded = [], []
    rows = _log_rows(repo, _mainline(repo), "--merges", "--first-parent",
                     "--format=" + FMT_SHA_PARENTS_SUBJECT)
    for sha, parents_text, subject in rows:
        if INTEGRATION_MARKER not in subject:
            continue
        parents = parents_text.split()
        if len(parents) != 2:
            excluded.append({"ref": sha, "reason":
                             "octopus integration merge (%d parents)" % len(parents)})
            continue
        chain = _integration_chain(repo, sha, parents[0], parents[1])
        if not chain:
            excluded.append({"ref": sha,
                             "reason": "empty integration chain (nothing to replay)"})
            continue
        defect = _chain_defect(chain)
        if defect:
            excluded.append({"ref": sha, "reason": defect})
            continue
        groups, trailing = _group_chain(repo, chain)
        runs.append({"ref": sha, "groups": groups,
                     "trailing_recons": [e["ref"] for e in trailing]})
    return {"runs": runs, "excluded": excluded}


def _change_set(task):
    """Every path a published task touches, deletions included."""
    return set(task.weaves) | set(task.raw) | set(task.deleted)


def _group_refs(group):
    """Every ref whose tree the replay of this group actually reads."""
    return ([group["base_sha"], group["after_sha"]]
            + [t["tip_sha"] for t in group["tasks"]]
            + [r["ref"] for r in group.get("recons", ())])


def _max_line_count(repo, refs):
    """Largest line count among the text files at any of `refs`.

    Computed without invoking the weave kernel at all — this has to run
    *before* we know whether `snapshot`/`publish` would blow the kernel's
    per-line recursion budget on this content, not after.
    """
    max_lines = 0
    seen = set()
    for ref in refs:
        names = _git_text(repo, "ls-tree", "-r", "-z", "--name-only", ref)
        for p in filter(None, names.split(NUL)):
            key = (ref, p)
            if key in seen:
                continue
            seen.add(key)
            blob = subprocess.run(["git", "-C", str(repo), "show", "%s:%s" % (ref, p)],
                                  capture_output=True, check=True).stdout
            if rw.is_binary(blob):
                continue
            n = len(rw.split_lines(blob.decode("utf-8", errors="replace")))
            if n > max_lines:
                max_lines = n
    return max_lines


class _recursion_headroom:
    """Temporarily widen the recursion limit to fit a corpus, then restore it.

    The vendored kernel recurses once per line; a file near the interpreter's
    default 1000-frame limit raises RecursionError deep inside manyana before
    this module ever gets a chance to name it. The bound is sized from the
    corpus actually being replayed rather than a flat constant, so small runs
    pay nothing and large ones get real headroom — and the previous limit is
    always restored on the way out, whether or not RecursionError still
    escapes despite the widened bound.
    """

    def __init__(self, max_lines):
        self._bound = max(sys.getrecursionlimit(),
                          RECURSION_LINE_FACTOR * max_lines + RECURSION_MARGIN)
        self._previous = None

    def __enter__(self):
        self._previous = sys.getrecursionlimit()
        sys.setrecursionlimit(self._bound)
        return self

    def __exit__(self, exc_type, exc, tb):
        sys.setrecursionlimit(self._previous)
        return False


def _replay_group(repo, group, seed):
    """Re-fold one wave and compare it against the tree history recorded."""
    with _recursion_headroom(_max_line_count(repo, _group_refs(group))):
        base = rw.snapshot(repo, group["base_sha"])
        tasks = [rw.publish(base, repo, group["base_sha"], t["tip_sha"],
                            task_id=t["task_id"])
                 for t in group["tasks"]]
        # Reconciliation pseudo-tasks fold exactly like tasks: an endpoint
        # diff (the commit's own parent..tip) woven against the wave base.
        tasks += [rw.publish(base, repo, r["base_ref"], r["ref"],
                             task_id=r["task_id"])
                  for r in group.get("recons", ())]
        after = rw.manifest(rw.snapshot(repo, group["after_sha"]))
        touched = set()
        for task in tasks:
            touched |= _change_set(task)

        orders = sm.sampled_orders(len(tasks), seed=seed)
        outcomes, canonical, conflicted, observed = set(), None, set(), []
        for order in orders:
            frontier, conflicts = sm.fold_all(rw.fold, base, tasks, order)
            outcomes.add((tuple(sorted(rw.manifest(frontier).items())),
                          tuple(conflict_keys(conflicts))))
            conflicted |= {c.path for c in conflicts}
            files = rw.manifest(frontier)
            observed.append({p: files.get(p) for p in touched})
            if canonical is None:
                canonical = (frontier, conflicts)
        frontier, conflicts = canonical

        # Conflicted paths are exempt: the historical merge may have hand-resolved
        # them, and a hand resolution is not the fold layer diverging silently.
        clean = sorted(touched - conflicted)
        divergent = {p for seen in observed for p in clean if seen[p] != after.get(p)}

        refolded, refold_conflicts = rw.fold(base, frontier, tasks[0])
        k2 = (rw.manifest(refolded) == rw.manifest(frontier)
              and set(conflict_keys(refold_conflicts)) <= set(conflict_keys(conflicts)))
    return {
        "orders_sampled": len(orders),
        "k1_identical": len(outcomes) == 1,
        "k2_idempotent": k2,
        "conflicts": conflicts,
        "paths_checked": len(clean),
        "silent_divergence": divergent,
        "conflicted_paths": conflicted,
    }


def _run_c_case(repo, run, seed):
    """One archived run -> one case record, aggregated over its waves."""
    replays = [_replay_group(repo, g, seed) for g in run["groups"]]
    conflicts = [c for r in replays for c in r["conflicts"]]
    return {
        "name": run["ref"][:8],
        "track": "c",
        "makespans": None,
        "folds": {"orders_sampled": sum(r["orders_sampled"] for r in replays),
                  "k1_identical": all(r["k1_identical"] for r in replays),
                  "k2_idempotent": all(r["k2_idempotent"] for r in replays)},
        "conflicts": [{"path": c.path, "kind": c.kind, "task": c.task_id,
                       "narration": c.narration} for c in conflicts],
        "no_interleaving": None,
        "expectations_met": None,
        "excluded": None,
        "ref": run["ref"],
        "groups": [{"base_sha": g["base_sha"], "after_sha": g["after_sha"],
                    "tasks": [t["task_id"] for t in g["tasks"]],
                    "recons": [r["task_id"] for r in g.get("recons", ())]}
                   for g in run["groups"]],
        "reconciliation": {
            "pseudo_tasks": [r["task_id"] for g in run["groups"]
                             for r in g.get("recons", ())],
            # Non-merge commits after the last merge: nothing to compare them
            # against, so fidelity comparison stops at the last merge tree.
            "trailing_cut": list(run.get("trailing_recons", ())),
        },
        "fidelity": {
            "paths_checked": sum(r["paths_checked"] for r in replays),
            "silent_divergence": sorted({p for r in replays
                                         for p in r["silent_divergence"]}),
            "conflicted_paths": sorted({p for r in replays
                                        for p in r["conflicted_paths"]}),
        },
    }


def _k3_verdict(recovered_n, divergence):
    if recovered_n < TRACK_C_FLOOR:
        return "not evaluated (recovered-n=%d below floor %d)" % (recovered_n,
                                                                  TRACK_C_FLOOR)
    if divergence:
        return "false (silent divergence: %s)" % ", ".join(divergence)
    return "true"


def run_track_c(repo, out_dir, seed=42):
    """Replay every recoverable archived run; write `c-<shortsha>.json` cases.

    K3 is `true` only with at least `TRACK_C_FLOOR` recovered runs and zero
    silent divergence; below the floor it names the recovered-n instead of
    quietly passing.

    A run the replay itself cannot complete — the recursion limit still
    exceeded even after `_replay_group` widened it to fit the corpus, or an
    unreadable git object — is demoted to an exclusion carrying that reason.
    It never becomes a crash (which would take the whole track down) and
    never becomes a pass (which would be a silent cap).
    """
    repo, out_dir = Path(repo), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    extraction = extract_archived_runs(repo)

    records, excluded = [], list(extraction["excluded"])
    replayed = []
    for run in extraction["runs"]:
        try:
            record = _run_c_case(repo, run, seed)
        except RecursionError as exc:
            excluded.append({"ref": run["ref"], "reason":
                             "recursion depth: %s" % (str(exc) or
                                                      "kernel recursion limit "
                                                      "exceeded even after "
                                                      "widening it to fit the "
                                                      "corpus")})
            continue
        except subprocess.CalledProcessError as exc:
            excluded.append({"ref": run["ref"], "reason":
                             "replay could not read git objects (git exited %d)"
                             % exc.returncode})
            continue
        (out_dir / ("c-%s.json" % record["name"])).write_text(
            json.dumps(record, indent=2, sort_keys=True) + "\n")
        records.append(record)
        replayed.append(run)

    divergence = sorted({p for r in records
                         for p in r["fidelity"]["silent_divergence"]})
    return {"K3": _k3_verdict(len(records), divergence),
            "records": records,
            "runs": replayed,
            "excluded": excluded,
            "recovered_n": len(records),
            "silent_divergence": divergence}


# --------------------------------------------------------------------------
# driver + report
# --------------------------------------------------------------------------

def _rollup(records, k_gates, tracks, track_c=None):
    out = ["# Frontier probe — roll-up", ""]

    out += ["## Makespans (track a)", ""]
    track_a = [r for r in records if r["track"] == "a" and r["makespans"]]
    if track_a:
        out += ["| fixture | waves | frontier | frontier w/o same-file edges | delta % |",
                "| --- | --- | --- | --- | --- |"]
        for r in track_a:
            ms = r["makespans"]
            delta = (100.0 * (ms["waves"] - ms["frontier"]) / ms["waves"]) if ms["waves"] else 0.0
            out.append("| %s | %.1f | %.1f | %.1f | %.1f%% |"
                       % (r["name"], ms["waves"], ms["frontier"],
                          ms["frontier_no_same_file"], delta))
        out += ["", "Durations are modeled (seeded uniform(%d, %d)), not measured."
                % (DURATION_LO, DURATION_HI)]
        same_file = sum(r["makespans"]["same_file_edges"] for r in track_a)
        if not same_file:
            out.append("No fixture in this corpus carries a same-file dependency edge, "
                       "so the third column necessarily equals the second — the "
                       "same-file column is unexercised here, not measured as neutral.")
        else:
            out.append("Same-file edges dropped for the third column: %d." % same_file)
    else:
        out.append("track (a) not run")
    out.append("")

    out += ["## K-gate summary", ""]
    out.append("- K1 (fold order-independence): %s" % _gate_text(k_gates["K1"]))
    out.append("- K2 (fold idempotence): %s" % _gate_text(k_gates["K2"]))
    k3 = k_gates["K3"]
    out.append("- K3 (real-run fidelity): %s" % (k3 if isinstance(k3, str) else _gate_text(k3)))
    k4 = k_gates["K4_no_interleaving"]
    k4_text = ("not evaluated (no contiguity checks in this run)"
               if k4 is None else _gate_text(k4))
    out.append("- K4 (no interleaving): %s" % k4_text)
    out.append("")

    out += ["## Track (b) narrations (S3 — operator grades these)", ""]
    narrated = [r for r in records if r["track"] == "b" and r["conflicts"]]
    if narrated:
        for r in narrated:
            for c in r["conflicts"]:
                out.append("**%s** — `%s` (%s), reported by %s"
                           % (r["name"], c["path"], c["kind"], c["task"]))
                out += ["", "```", c["narration"], "```", ""]
    else:
        out += ["none", ""]

    if track_c is not None:
        out += _rollup_track_c(track_c)

    out += ["## Exclusions", ""]
    excluded = [r for r in records if r["excluded"]]
    unavailable = [t for t in tracks if t not in KNOWN_TRACKS]
    dropped_runs = (track_c or {}).get("excluded") or []
    if excluded or unavailable or dropped_runs:
        for r in excluded:
            out.append("- `%s-%s`: %s" % (r["track"], r["name"], r["excluded"]))
        for run in dropped_runs:
            out.append("- `c-%s`: %s" % (run["ref"][:8], run["reason"]))
        for t in unavailable:
            out.append("- track (%s): requested but not available in this runner" % t)
    else:
        out.append("none")
    out.append("")
    return "\n".join(out)


def _rollup_track_c(track_c):
    """Recovered archived runs and, by name, every run that was not recovered."""
    out = ["## Track (c) recovered runs", "",
           "Recovered %d run(s); K3 needs at least %d."
           % (track_c["recovered_n"], TRACK_C_FLOOR), "",
           "Extraction is reconciliation-tolerant (#133): a reconciliation "
           "commit folds into its wave as a pseudo-task endpoint diff, is "
           "absorbed by a later wave's merge-base, or — after the last merge "
           "— cuts fidelity comparison at that merge (noted per run below). "
           "The fidelity bar is unchanged: every wave's fold must reproduce "
           "the tree at its last merge on all non-conflicted paths.", ""]
    if track_c["records"]:
        for r in track_c["records"]:
            recon = r.get("reconciliation", {})
            out.append("- `%s` — %d wave(s), %d task(s), %d reconciliation "
                       "pseudo-task(s), %d clean path(s) checked, "
                       "%d silent divergence(s), %d conflicted path(s)"
                       % (r["name"], len(r["groups"]),
                          sum(len(g["tasks"]) for g in r["groups"]),
                          len(recon.get("pseudo_tasks", ())),
                          r["fidelity"]["paths_checked"],
                          len(r["fidelity"]["silent_divergence"]),
                          len(r["fidelity"]["conflicted_paths"])))
            if recon.get("trailing_cut"):
                out.append("  - comparison cut at last merge; trailing "
                           "reconciliation commit(s): %s"
                           % ", ".join(sha[:8] for sha in recon["trailing_cut"]))
            if r["fidelity"]["silent_divergence"]:
                out.append("  - silent divergence: %s"
                           % ", ".join(r["fidelity"]["silent_divergence"]))
    else:
        out.append("- none recovered")
    out += ["", "Runs not recovered:", ""]
    if track_c["excluded"]:
        for run in track_c["excluded"]:
            out.append("- `%s`: %s" % (run["ref"][:8], run["reason"]))
    else:
        out.append("- none")
    out.append("")
    return out


def _gate_text(value):
    if value is None:
        return "not evaluated"
    return "PASS" if value else "FAIL"


def run_tracks(tracks, out_dir, repo=None, seed=42):
    """Run the named tracks, write one JSON per case plus `rollup.md`.

    Tracks (a) and (b) are pure and read no working tree; track (c) is git-backed
    and therefore *requires* `repo` — asked for without one, it raises rather than
    silently reporting a track it never ran. An unknown track is reported as
    unavailable in the summary and the roll-up, never crashed on.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    records, track_c = [], None
    for track in tracks:
        if track == "c":
            if repo is None:
                raise ValueError("track (c) requires a repo path (--repo)")
            track_c = run_track_c(repo, out_dir, seed=seed)
            records.extend(track_c["records"])
            continue
        if track == "a":
            cases = fixture_cases(seed=seed)
        elif track == "b":
            cases = synthetic_cases()
        else:
            continue
        for case in cases:
            record = run_case(case, track)
            (out_dir / ("%s-%s.json" % (track, record["name"]))).write_text(
                json.dumps(record, indent=2, sort_keys=True) + "\n")
            records.append(record)

    scored = [r for r in records if not r["excluded"]]
    interleaving = [r["no_interleaving"] for r in records
                    if r["no_interleaving"] is not None]
    k_gates = {
        "K1": all(r["folds"]["k1_identical"] for r in scored) if scored else None,
        "K2": all(r["folds"]["k2_idempotent"] for r in scored) if scored else None,
        "K3": track_c["K3"] if track_c else "not evaluated (track c not run)",
        "K4_no_interleaving": all(interleaving) if interleaving else None,
    }
    exclusions = [{"case": "%s-%s" % (r["track"], r["name"]), "reason": r["excluded"]}
                  for r in records if r["excluded"]]
    exclusions += [{"case": "c-%s" % run["ref"][:8], "reason": run["reason"]}
                   for run in (track_c["excluded"] if track_c else [])]
    summary = {
        "tracks_requested": list(tracks),
        "tracks_unavailable": [t for t in tracks if t not in KNOWN_TRACKS],
        "seed": seed,
        "cases": records,
        "k_gates": k_gates,
        "exclusions": exclusions,
        "expectations_met": all(r["expectations_met"] for r in records
                                if r["expectations_met"] is not None),
    }
    if track_c:
        summary["track_c"] = {
            "recovered_n": track_c["recovered_n"],
            "runs": [run["ref"] for run in track_c["runs"]],
            "excluded": track_c["excluded"],
            "silent_divergence": track_c["silent_divergence"],
        }
    (out_dir / "rollup.md").write_text(_rollup(records, k_gates, tracks, track_c))
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tracks", default="a,b",
                        help="comma-separated track names (a,b,c)")
    parser.add_argument("--out", default=str(HERE / "results"),
                        help="directory receiving per-case JSON and rollup.md")
    parser.add_argument("--repo", default=str(ROOT),
                        help="repository whose archived runs track (c) replays")
    parser.add_argument("--seed", type=int, default=42,
                        help="seed for modeled task durations")
    args = parser.parse_args(argv)

    tracks = [t.strip() for t in args.tracks.split(",") if t.strip()]
    summary = run_tracks(tracks, Path(args.out), repo=Path(args.repo), seed=args.seed)
    print(json.dumps(summary["k_gates"], indent=2, sort_keys=True))
    for missing in summary["tracks_unavailable"]:
        print("track (%s) requested but not available in this runner" % missing,
              file=sys.stderr)
    for excluded in summary["exclusions"]:
        print("excluded %s: %s" % (excluded["case"], excluded["reason"]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
