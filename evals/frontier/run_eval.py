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

Track (c) is supplied by a later task; until then it reports itself unavailable in
the summary rather than crashing, and the K3 gate reads "not evaluated".

No-silent-caps: a fixture that degrades still runs and records why; a fixture that
cannot produce tasks at all is recorded as an exclusion with its reason. Every
exclusion reaches `rollup.md`.
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

FIXTURES = ["wide", "chained", "mixed", "flawed", "degrade", "webapp"]
COMPILER = ROOT / "skills" / "ultrapowers" / "scripts" / "compile_plan.py"
KNOWN_TRACKS = ("a", "b")
DURATION_LO, DURATION_HI = 60, 600


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
    return sorted((c.path, c.kind) for c in conflicts)


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
    """K4: each task's block must appear as one unbroken run in the merged file."""
    paths = case.get("contiguity_paths") or []
    if not paths:
        return None
    files = rw.manifest(frontier)
    for path in paths:
        content = files.get(path)
        if content is None:
            return False
        for task in case["tasks"]:
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
# driver + report
# --------------------------------------------------------------------------

def _rollup(records, k_gates, tracks):
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
    out.append("- K3 (bisection): %s" % (k3 if isinstance(k3, str) else _gate_text(k3)))
    out.append("- K4 (no interleaving): %s" % _gate_text(k_gates["K4_no_interleaving"]))
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

    out += ["## Exclusions", ""]
    excluded = [r for r in records if r["excluded"]]
    unavailable = [t for t in tracks if t not in KNOWN_TRACKS]
    if excluded or unavailable:
        for r in excluded:
            out.append("- `%s-%s`: %s" % (r["track"], r["name"], r["excluded"]))
        for t in unavailable:
            out.append("- track (%s): requested but not available in this runner" % t)
    else:
        out.append("none")
    out.append("")
    return "\n".join(out)


def _gate_text(value):
    if value is None:
        return "not evaluated"
    return "PASS" if value else "FAIL"


def run_tracks(tracks, out_dir, repo=None, seed=42):
    """Run the named tracks, write one JSON per case plus `rollup.md`.

    `repo` is reserved for the git-backed track (c), which a later task supplies;
    tracks (a) and (b) are pure and read no working tree. An unknown track is
    reported as unavailable in the summary and the roll-up, never crashed on.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    records = []
    for track in tracks:
        if track == "a":
            cases = fixture_cases(seed=seed)
        elif track == "b":
            cases = synthetic_cases()
        else:
            # Track (c) arrives with a later task; say so, do not crash.
            continue
        for case in cases:
            record = run_case(case, track)
            (out_dir / ("%s-%s.json" % (track, record["name"]))).write_text(
                json.dumps(record, indent=2, sort_keys=True) + "\n")
            records.append(record)

    scored = [r for r in records if not r["excluded"]]
    k_gates = {
        "K1": all(r["folds"]["k1_identical"] for r in scored) if scored else None,
        "K2": all(r["folds"]["k2_idempotent"] for r in scored) if scored else None,
        "K3": ("not evaluated (track c not run)" if "c" not in tracks else None),
        "K4_no_interleaving": all(r["no_interleaving"] for r in records
                                  if r["no_interleaving"] is not None),
    }
    summary = {
        "tracks_requested": list(tracks),
        "tracks_unavailable": [t for t in tracks if t not in KNOWN_TRACKS],
        "seed": seed,
        "cases": records,
        "k_gates": k_gates,
        "exclusions": [{"case": "%s-%s" % (r["track"], r["name"]), "reason": r["excluded"]}
                       for r in records if r["excluded"]],
        "expectations_met": all(r["expectations_met"] for r in records
                                if r["expectations_met"] is not None),
    }
    (out_dir / "rollup.md").write_text(_rollup(records, k_gates, tracks))
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tracks", default="a,b",
                        help="comma-separated track names (a,b)")
    parser.add_argument("--out", default=str(HERE / "results"),
                        help="directory receiving per-case JSON and rollup.md")
    parser.add_argument("--seed", type=int, default=42,
                        help="seed for modeled task durations")
    args = parser.parse_args(argv)

    tracks = [t.strip() for t in args.tracks.split(",") if t.strip()]
    summary = run_tracks(tracks, Path(args.out), seed=args.seed)
    print(json.dumps(summary["k_gates"], indent=2, sort_keys=True))
    for missing in summary["tracks_unavailable"]:
        print("track (%s) requested but not available in this runner" % missing,
              file=sys.stderr)
    for excluded in summary["exclusions"]:
        print("excluded %s: %s" % (excluded["case"], excluded["reason"]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
