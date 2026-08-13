#!/usr/bin/env python3
"""Arm B of the frontier production test: build the contend fixture with
truly-parallel same-file tasks, manyana-authoritative merging, and the
resolver on narrated conflicts (spec 2026-08-11, component 3). Arm A is an
ordinary kit cell — this driver replaces only drive_run.

The cell plumbing (engine worktree, seal install, project clone, workflow
seeding, throwaway session config, credential scrub window) is the A/B kit's,
used verbatim: this file owns the *schedule*, the *fold*, and the *resolver*,
nothing else.

Seams the suite drives directly (tests/test_frontier_cell.py):
  plan_schedule(compiled)                    -> (ready_sets, dropped_edges)
  resolve_conflict(engine, c, bodies, launch)-> applied | re-narrated:applied
                                                | parked:<reason>
  live_k1(engine, tasks)                     -> (ok, detail)
  preflight(workdir, env, launcher)          -> bool
"""
import argparse
import concurrent.futures as cf
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
sys.path.insert(0, str(ROOT / "skills" / "ultrapowers" / "kernel"))
import ab_runner as ab                                          # noqa: E402
import frontier_fold as ff                                      # noqa: E402
import repo_weave as rw                                         # noqa: E402
import schedule_model as sm                                     # noqa: E402

# The edge-drop rule IS the modeled one — imported, never re-typed. Retyping it
# is how a driver silently stops measuring the thing the model measured.
EDGE_DROP = sm.SAME_FILE_WHYS

# Arm B's own resolver dispatch brief: no tools, no repo, no shell — one JSON
# object in, one JSON object out (see make_resolver_launcher below). This is
# NOT the engine's baked RESOLVER_PROMPT (skills/ultrapowers/references/
# wave-merge.md, BAKE:RESOLVER_PROMPT / harnesses/waves.js): that prompt reads
# a narration file and writes a reply file inside a wave worktree, a contract
# change made deliberately when the engine's fold path was built (spec
# 2026-08-12, "Where it lives"). The two prompts serve different contracts on
# purpose, so this brief is not a copy of that baked text and carries no drift
# pin of its own — it lives only here, read only by this file.
RESOLVER_BRIEF = """# Frontier conflict resolver — dispatch brief

You are a merge-conflict resolver for the manyana frontier production test.
You have **no tools, no repo access, no shell** — you receive one JSON object
and you return one JSON object. Return **only JSON**: no prose, no fences.

## Input

A single JSON object:

- `"path"` — the conflicted file's repo-relative path.
- `"kind"` — the conflict kind (always a text-narrated kind; non-text
  conflicts are never dispatched to you).
- `"narration"` — the WHOLE annotated file: manyana's merged view with
  conflict markers naming each side (`frontier` = work already merged;
  a task id = the incoming change). Non-marker lines are already-merged
  content.
- `"planBodies"` — the plan text of each task involved in this conflict,
  in the same order as the marker labels introduce them. Use these to
  understand each side's INTENT.

## Output

`{"resolvedFileLines": [...]}` — the **complete visible line list** for the
file after resolution: every line the merged file should contain, top to
bottom, no markers, no trailing-newline entries. This is whole-file-out:
lines outside the conflicted blocks must be preserved exactly as the
narration shows them; **do not invent** content that appears in neither
side nor the narration.

## Rules

1. Honor both sides' intent where they are compatible; where they are not,
   prefer the semantics the plan bodies describe over surface text.
2. Never drop a side silently — if the two sides are irreconcilable,
   still return your best whole-file merge; a held-out test suite grades
   the result and a human reads this transcript verbatim.
3. Return only the JSON object. A malformed reply is retried once, then
   the conflict parks as recorded evidence.
"""
RESULTS_DIR = ROOT / "evals/frontier/results"
RESULT_BRANCH = "frontier-result"
PREFLIGHT_WIDTH = 4          # contend frees exactly four tasks at t=0
MAX_ATTEMPTS = 2             # one dispatch + one retry, then park (G3)
IMPLEMENTER_TIMEOUT = 3600
RESOLVER_TIMEOUT = 900
PREFLIGHT_TIMEOUT = 900

IMPLEMENTER_PROMPT = (
    "You are implementing ONE task of an approved plan inside a dedicated git "
    "worktree that is already checked out for you.\n\n"
    "Implement the task exactly as written, run the project's tests, and COMMIT "
    "your work on the current branch before you finish — uncommitted work is "
    "discarded and the task is recorded as parked. Do not merge, do not push, do "
    "not create or switch branches, and never touch any directory outside this "
    "worktree. You are running non-interactively: do not ask questions.\n\n"
    "--- TASK ---\n{body}\n")

PREFLIGHT_PROMPT = (
    "Preflight probe. In this git worktree, write a file named PREFLIGHT.md whose "
    "only content is the word ok, then commit it with git. Reply with the single "
    "word done and nothing else.")


# --------------------------------------------------------------------------- #
# Schedule                                                                     #
# --------------------------------------------------------------------------- #
def _edges(compiled):
    """compile_plan's `dag_edges` normalized to {"from","to","why"} dicts.

    The compiler emits dicts; a hand-built schedule (and the suite) may use
    (from, to, why) triples. Both mean the same edge.
    """
    out = []
    for e in compiled.get("dag_edges") or []:
        if isinstance(e, dict):
            out.append({"from": e["from"], "to": e["to"], "why": e.get("why")})
        else:
            src, dst, why = e
            out.append({"from": src, "to": dst, "why": why})
    return out


def _scheduled_ids(compiled):
    """The tasks arm B dispatches: the compiler's wave membership when it is
    present (gate/release/manual dispositions never enter `waves`, and arm B
    dispatches implementers only), else every declared task."""
    waves = compiled.get("waves")
    if waves:
        return [tid for wave in waves for tid in wave]
    return [t["id"] if isinstance(t, dict) else t
            for t in compiled.get("tasks") or []]


def _kept_edges(compiled):
    """(scheduled ids, all edges, kept edges) — the drop is `schedule_model`'s."""
    ids = _scheduled_ids(compiled)
    known = set(ids)
    edges = [e for e in _edges(compiled)
             if e["from"] in known and e["to"] in known]
    return ids, edges, sm.drop_same_file_edges(edges)


def plan_schedule(compiled):
    """(ready_sets, dropped_edges) for a compiled plan.

    Same-file edges go (they exist only to serialize concurrent writers, which
    the frontier merges instead); marker and interface edges stay. `ready_sets`
    are the dependency layers of the surviving DAG — the first set is what
    dispatches at t=0. Layers describe the schedule; the driver itself
    dispatches event-driven, with no wave barrier between them.
    """
    ids, edges, kept = _kept_edges(compiled)
    kept_pairs = {(e["from"], e["to"]) for e in kept}
    dropped, seen = [], set()
    for e in edges:
        pair = (e["from"], e["to"])
        if pair not in kept_pairs and pair not in seen:
            seen.add(pair)
            dropped.append(pair)
    upstream = upstream_map(ids, kept)
    ready, placed, remaining = [], set(), list(ids)
    while remaining:
        layer = {t for t in remaining if upstream[t] <= placed}
        if not layer:
            raise ValueError("cycle among kept edges: %s" % sorted(remaining))
        ready.append(layer)
        placed |= layer
        remaining = [t for t in remaining if t not in layer]
    return ready, dropped


def upstream_map(ids, kept):
    upstream = {t: set() for t in ids}
    for e in kept:
        upstream[e["to"]].add(e["from"])
    return upstream


# --------------------------------------------------------------------------- #
# Resolver dispatch (serial: at most one call in flight, by construction)      #
# --------------------------------------------------------------------------- #
def _marker_labels(narration):
    """The side labels a narration introduces, in first-appearance order."""
    labels, seen = [], set()
    for line in narration.splitlines():
        if line.startswith(rw.MARKERS):
            label = line.split()[-1]
            if label not in seen:
                seen.add(label)
                labels.append(label)
    return labels


def _bodies_for(conflict, plan_bodies):
    """The colliding tasks' plan bodies, in the order the markers introduce
    them (the brief's contract). `frontier` names already-merged work, not a
    task, so it contributes no body."""
    ordered = [l for l in _marker_labels(conflict.narration) if l in plan_bodies]
    if conflict.task_id in plan_bodies and conflict.task_id not in ordered:
        ordered.append(conflict.task_id)
    return [plan_bodies[t] for t in ordered]


def _resolved_lines(reply):
    """Strict parse of the resolver's reply -> (lines, violation)."""
    try:
        obj = json.loads(reply)
    except (TypeError, ValueError):
        return None, "reply is not JSON"
    if not isinstance(obj, dict) or "resolvedFileLines" not in obj:
        return None, "reply carries no resolvedFileLines"
    lines = obj["resolvedFileLines"]
    if not isinstance(lines, list) or not all(isinstance(x, str) for x in lines):
        return None, "resolvedFileLines is not a list of strings"
    return lines, ""


def _renarrate(engine, path):
    """The fresh narration for `path` after an intervening fold moved it.

    The spec's mechanism ("re-fold the conflicting endpoint idempotently and
    dispatch the fresh narration") cannot produce one: the weave is monotone,
    so re-folding an endpoint the frontier already contains conflicts with
    nothing and narrates nothing (measured, not assumed). What *is* fresh is
    the frontier's own current whole file — manyana's fold drops no side, so
    every colliding side's lines are visible in it and whole-file-in /
    whole-file-out stays well defined against it. Returns None (park) when the
    path is gone or non-text.
    """
    body = engine.manifest().get(path)
    return body if isinstance(body, str) else None


def _record(log, conflict, attempt, narration, reply):
    log.append({"path": conflict.path, "kind": conflict.kind,
                "taskId": conflict.task_id, "attempt": attempt,
                "narration": narration, "reply": reply})


def resolve_conflict(engine, conflict, plan_bodies, launcher, log=None):
    """Dispatch one narrated conflict to the resolver and apply its whole-file
    answer. Returns "applied" / "re-narrated:applied" / "parked:<reason>".

    Serial by construction — a synchronous call the driver makes one at a time,
    so no other resolution can land on the path between narration and
    application; only a fold can, and `apply_resolution` catches exactly that.
    Every narration and reply is appended verbatim to `log` (E2 evidence).
    """
    log = [] if log is None else log
    path = conflict.path
    ok, reason = ff.dispatchable(conflict, engine.manifest())
    if not ok:
        return "parked:" + reason
    bodies = _bodies_for(conflict, plan_bodies)
    narration, renarrated = conflict.narration, False
    for attempt in range(1, MAX_ATTEMPTS + 1):
        epoch = engine.epoch()
        payload = {"path": path, "kind": conflict.kind,
                   "narration": narration, "planBodies": bodies}
        try:
            reply = launcher(payload)
        except Exception as exc:                     # a dead launcher is evidence
            _record(log, conflict, attempt, narration, "<launcher failed: %s>" % exc)
            return "parked:resolver launcher failed on %s (%s)" % (path, exc)
        _record(log, conflict, attempt, narration, reply)
        lines, violation = _resolved_lines(reply)
        if lines is None:
            if attempt == MAX_ATTEMPTS:
                return "parked:%s — contract violated twice on %s" % (violation, path)
            continue                                 # one retry, same narration
        if engine.apply_resolution(path, epoch, lines):
            return "re-narrated:applied" if renarrated else "applied"
        if attempt == MAX_ATTEMPTS:
            return "parked:frontier moved under the resolution twice on %s" % path
        fresh = _renarrate(engine, path)
        if fresh is None:
            return "parked:no fresh narration for %s after an intervening fold" % path
        narration, renarrated = fresh, True
    return "parked:resolver attempts exhausted on %s" % path


def live_k1(engine, tasks, seed=42):
    """The resolution-aware K1 check, both legs (G2).

    (1) Shuffled raw folds are outcome-identical to each other — resolutions
    excluded, since a raw fold can never equal a resolver-modified state.
    (2) The recorded fold/resolution event log replays to the shipped manifest.
    """
    outcomes = ff.raw_shuffle_outcomes(engine.base, list(tasks), seed)
    replayed = ff.replay(engine.base, {t.task_id: t for t in tasks}, engine.events)
    detail = {"shuffleOutcomes": len(outcomes),
              "replayMatches": replayed == engine.manifest()}
    return bool(len(outcomes) == 1 and detail["replayMatches"]), detail


# --------------------------------------------------------------------------- #
# Headless launchers (the kit's pattern: claude -p, no SDK, no API key)        #
# --------------------------------------------------------------------------- #
def _unwrap(stdout):
    """`--output-format json` wraps the reply in an envelope; the resolver
    contract is about the reply itself."""
    try:
        obj = json.loads(stdout)
    except ValueError:
        return stdout
    if isinstance(obj, dict) and isinstance(obj.get("result"), str):
        return obj["result"]
    return stdout


def headless(prompt, cwd, env, timeout):
    res = subprocess.run(["claude", "-p", prompt] + ab.CLAUDE_FLAGS, cwd=str(cwd),
                         capture_output=True, text=True, timeout=timeout, env=env)
    if res.returncode != 0:
        raise RuntimeError("claude exited %d in %s: %s"
                           % (res.returncode, cwd, (res.stderr or res.stdout)[-400:]))
    return res.stdout


def make_resolver_launcher(workdir, env, gauge=None, brief=None):
    """The production resolver launcher: brief + input JSON, no tools, no repo
    work — the reply text is the whole contract."""
    text = brief if brief is not None else RESOLVER_BRIEF

    def launcher(payload):
        prompt = "%s\n\n## Input\n\n%s\n" % (text, json.dumps(payload, indent=2))
        with (gauge if gauge is not None else _Gauge()):
            return _unwrap(headless(prompt, workdir, env, RESOLVER_TIMEOUT))
    return launcher


def make_probe_launcher(env):
    """Implementer-shaped trivial call used by preflight: it runs in the
    worktree the caller made and commits there, exactly as an implementer
    does."""
    def launcher(payload):
        return _unwrap(headless(PREFLIGHT_PROMPT, payload["cwd"], env,
                                PREFLIGHT_TIMEOUT))
    return launcher


def make_implementer(env, gauge):
    def implement(body, cwd):
        with gauge:
            return _unwrap(headless(IMPLEMENTER_PROMPT.format(body=body), cwd, env,
                                    IMPLEMENTER_TIMEOUT))
    return implement


# --------------------------------------------------------------------------- #
# Git helpers (every one of them targets the cell repo, never the checkout)    #
# --------------------------------------------------------------------------- #
def _git(repo, args, env=None):
    """(ok, stdout). Never raises: a failed git command is a parked task or a
    failed preflight, not a traceback."""
    try:
        res = subprocess.run(["git"] + list(args), cwd=str(repo), env=env or None,
                             capture_output=True, text=True)
    except OSError:
        return False, ""
    return res.returncode == 0, res.stdout.strip()


def _is_repo_root(path, env=None):
    ok, top = _git(path, ["rev-parse", "--show-toplevel"], env)
    if not ok or not top:
        return False
    try:
        return Path(top).resolve() == Path(path).resolve()
    except OSError:
        return False


class _Gauge:
    """Peak concurrent headless sessions — near-free driver bookkeeping."""

    def __init__(self):
        self._lock = threading.Lock()
        self.live = 0
        self.peak = 0

    def __enter__(self):
        with self._lock:
            self.live += 1
            self.peak = max(self.peak, self.live)
        return self

    def __exit__(self, *exc):
        with self._lock:
            self.live -= 1
        return False


# --------------------------------------------------------------------------- #
# Preflight: the launch-instant shape at its real width                        #
# --------------------------------------------------------------------------- #
def preflight(workdir, env, launcher, width=PREFLIGHT_WIDTH):
    """Four concurrent trivial implementer-shaped launches, each in its own
    concurrently-created worktree, each committing. Any failure -> False (the
    caller parks the arm with the named reason). Never mutates anything outside
    the cell repo: it refuses a `workdir` that is not itself a repo root.
    """
    workdir = Path(workdir)
    if not _is_repo_root(workdir, env):
        return False
    scratch = Path(tempfile.mkdtemp(prefix="frontier-preflight-"))
    names = ["frontier-preflight-%d" % i for i in range(width)]

    def probe(name):
        wt = scratch / name
        ok, _ = _git(workdir, ["worktree", "add", "-b", name, str(wt), "HEAD"], env)
        if not ok:
            return False
        before = _git(wt, ["rev-parse", "HEAD"], env)[1]
        try:
            reply = launcher({"cwd": str(wt)})
        except Exception:
            return False
        after = _git(wt, ["rev-parse", "HEAD"], env)[1]
        return bool(reply) and bool(after) and after != before

    try:
        with cf.ThreadPoolExecutor(max_workers=width) as pool:
            return all(list(pool.map(probe, names)))
    finally:
        for name in names:
            _git(workdir, ["worktree", "remove", "--force", str(scratch / name)], env)
            _git(workdir, ["branch", "-D", name], env)
        shutil.rmtree(scratch, ignore_errors=True)


# --------------------------------------------------------------------------- #
# Materialize + gate                                                           #
# --------------------------------------------------------------------------- #
def materialize_branch(workdir, baseline, manifest, branch=RESULT_BRANCH, env=None):
    """Write the folded manifest to `branch` through a temp worktree.

    Deliberately not `repo_weave.materialize`, whose contract is
    failure-artifact dumps only. Returns the new head sha.
    """
    scratch = Path(tempfile.mkdtemp(prefix="frontier-result-"))
    tree = scratch / "tree"
    ok, out = _git(workdir, ["worktree", "add", "-b", branch, str(tree), baseline], env)
    if not ok:
        shutil.rmtree(scratch, ignore_errors=True)
        raise RuntimeError("could not create the result worktree: %s" % out)
    try:
        for child in tree.iterdir():
            if child.name == ".git":
                continue
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()
        for path, content in sorted(manifest.items()):
            target = tree / path
            target.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(content, bytes):
                target.write_bytes(content)
            else:
                target.write_text(content, encoding="utf-8")
        _git(tree, ["add", "-A"], env)
        ok, out = _git(tree, ["commit", "-qm", "frontier fold: arm B result"], env)
        if not ok:
            raise RuntimeError("could not commit the folded tree: %s" % out)
        return _git(tree, ["rev-parse", "HEAD"], env)[1]
    finally:
        _git(workdir, ["worktree", "remove", "--force", str(tree)], env)
        shutil.rmtree(scratch, ignore_errors=True)


def run_gate(engine_wt, workdir, plan, branch=RESULT_BRANCH):
    """Administer the fixture's sealed exam against the folded branch —
    exit-code authority, no interpretation."""
    installs = plan.get("sealInstalls") or []
    seal_id = installs[0].get("sealId") if installs else None
    if not seal_id:
        return {"ran": False, "reason": "fixture ships no sealed exam"}
    vault = Path(os.environ.get("ULTRAPOWERS_VAULT",
                                Path.home() / ".ultrapowers/acceptance"))
    manifest_path = vault / seal_id / "manifest.json"
    try:
        suite_sha = json.loads(manifest_path.read_text()).get("suiteSha256")
    except (OSError, ValueError) as exc:
        return {"ran": False, "reason": "unreadable vault manifest %s (%s)"
                                        % (manifest_path, exc)}
    if not suite_sha:
        return {"ran": False, "reason": "vault manifest %s carries no suiteSha256"
                                        % manifest_path}
    cmd = ["bash", str(Path(engine_wt) / "skills/ultrapowers/scripts/run_acceptance.sh"),
           seal_id, branch, suite_sha, "--repo", str(workdir)]
    if os.environ.get("ULTRAPOWERS_VAULT"):
        cmd += ["--vault", str(vault)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return {"ran": True, "sealId": seal_id, "branch": branch,
            "exitCode": res.returncode, "passed": res.returncode == 0,
            "stdout": res.stdout.strip(), "stderr": res.stderr.strip()[-2000:]}


# --------------------------------------------------------------------------- #
# The run                                                                      #
# --------------------------------------------------------------------------- #
def compile_in(compiler, plan_path, launch_path=None):
    # Pre-drop edge set (--overlap serialize): keeps same_file_edges non-circular
    # for the schedule/model code that drops them itself (schedule_model.py's
    # SAME_FILE_WHYS), rather than letting the compiler drop them first.
    cmd = [sys.executable, str(compiler), "--overlap", "serialize", str(plan_path)]
    if launch_path is not None:
        cmd += ["--emit-launch", str(launch_path)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit("compile_plan failed on %s:\n%s"
                 % (plan_path, (res.stderr or res.stdout).strip()))
    return json.loads(res.stdout)


def drive_arm_b(engine_wt, workdir, baseline, env, plan, result):
    """Compile -> dispatch -> fold -> resolve -> K1 -> materialize -> gate.

    Fills `result` in place so a crash mid-run still leaves the evidence that
    was gathered up to the crash.
    """
    launch_path = Path(tempfile.mkdtemp(prefix="frontier-launch-")) / "launch.json"
    compiler = Path(engine_wt) / "skills/ultrapowers/scripts/compile_plan.py"
    compiled = compile_in(compiler, workdir / "docs/plans/plan.md", launch_path)
    bodies = {t["id"]: t["body"] for t in json.loads(launch_path.read_text())["tasks"]}
    ready, dropped = plan_schedule(compiled)
    ids, _edges_all, kept = _kept_edges(compiled)
    upstream = upstream_map(ids, kept)
    result["schedule"] = {"readySets": [sorted(s) for s in ready],
                          "droppedEdges": [list(p) for p in dropped],
                          "keptEdges": [[e["from"], e["to"], e["why"]] for e in kept]}

    gauge = _Gauge()
    implement = make_implementer(env, gauge)
    resolver = make_resolver_launcher(workdir, env, gauge)
    base_state = rw.snapshot(workdir, baseline)
    engine = ff.FrontierEngine(base_state)
    scratch = Path(tempfile.mkdtemp(prefix="frontier-tasks-"))
    folded, spans, parked, resolutions = [], {}, {}, []
    log = result.setdefault("resolverTranscript", [])
    conflicts_seen = result.setdefault("conflicts", [])

    def work(tid):
        branch = "frontier-task-%s" % tid
        tree = scratch / branch
        started = time.monotonic()
        ok, out = _git(workdir, ["worktree", "add", "-b", branch, str(tree), baseline], env)
        if not ok:
            return tid, branch, started, time.monotonic(), "worktree add failed: %s" % out
        try:
            implement(bodies[tid], tree)
        except Exception as exc:
            return tid, branch, started, time.monotonic(), "implementer failed: %s" % exc
        return tid, branch, started, time.monotonic(), None

    pending, running, done = set(ids), {}, set()
    try:
        with cf.ThreadPoolExecutor(max_workers=max(1, len(ids))) as pool:
            while pending or running:
                for tid in sorted(pending):
                    if upstream[tid] <= done:
                        running[pool.submit(work, tid)] = tid
                        pending.discard(tid)
                if not running:
                    for tid in sorted(pending):
                        parked[tid] = "upstream task parked"
                    break
                future = next(cf.as_completed(list(running)))
                running.pop(future)
                tid, branch, t_start, t_end, failure = future.result()
                spans[tid] = round(t_end - t_start, 1)
                if failure:
                    parked[tid] = failure
                    continue
                head = _git(workdir, ["rev-parse", branch], env)[1]
                if not head or head == baseline:
                    parked[tid] = "implementer committed nothing"
                    continue
                task = rw.publish(base_state, workdir, baseline, branch, tid)
                folded.append(task)
                done.add(tid)
                # Folds and resolutions run here, on the driver thread: at most
                # one resolver session is ever in flight, whatever a fold
                # narrates.
                for conflict in engine.fold(task):
                    conflicts_seen.append({"path": conflict.path,
                                           "kind": conflict.kind,
                                           "taskId": conflict.task_id,
                                           "narration": conflict.narration})
                    outcome = resolve_conflict(engine, conflict, bodies,
                                               resolver, log=log)
                    resolutions.append({"path": conflict.path,
                                        "kind": conflict.kind,
                                        "outcome": outcome})
    finally:
        for tid in ids:
            _git(workdir, ["worktree", "remove", "--force",
                           str(scratch / ("frontier-task-%s" % tid))], env)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(launch_path.parent, ignore_errors=True)

    result["taskWallClockSec"] = spans
    result["parkedTasks"] = parked
    result["resolutions"] = resolutions
    result["peakParallelism"] = gauge.peak
    result["events"] = engine.events
    result["foldOrder"] = [t.task_id for t in folded]

    ok, k1 = live_k1(engine, folded)
    result["liveK1"] = dict(k1, passed=ok)
    result["resultHead"] = materialize_branch(workdir, baseline, engine.manifest(),
                                              env=env)
    result["gate"] = run_gate(engine_wt, workdir, plan)
    result["status"] = "complete"


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Frontier production test, arm B: parallel implementers, "
                    "fold-on-completion, resolver on narrated conflicts.")
    ap.add_argument("--engine-ref", required=True,
                    help="sha or branch to pin the engine at")
    ap.add_argument("--fixture", default="contend")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the schedule and exit: no cell, no credentials")
    args = ap.parse_args(argv)

    plan = ab.build_run_plan(args.engine_ref, "B", args.fixture, ROOT)
    if args.dry_run:
        # This checkout's compiler: --dry-run cuts no engine worktree, so
        # --engine-ref is recorded but not resolved.
        compiled = compile_in(ROOT / "skills/ultrapowers/scripts/compile_plan.py",
                              plan["planPath"])
        ready, dropped = plan_schedule(compiled)
        print(json.dumps({"fixture": args.fixture, "engineRef": args.engine_ref,
                          "dryRun": True,
                          "readySets": [sorted(s) for s in ready],
                          "droppedEdges": [list(p) for p in dropped]}, indent=2))
        return 0

    started = datetime.now(timezone.utc).isoformat()
    t0 = time.monotonic()
    result = {"arm": "B", "fixture": args.fixture, "engineRef": args.engine_ref,
              "startedAt": started, "status": "parked"}
    # `prepare_cell` cuts its own engine worktree but does not return it, and
    # this driver needs the pinned compile_plan.py + run_acceptance.sh. A second
    # detached worktree at the same ref is the cheap way to get them without
    # reaching into the kit's internals or reading THIS checkout's scripts
    # (which would unpin the arm).
    engine_wt = ab.prepare_engine(plan["engineRef"], ROOT)
    workdir, baseline, env = ab.prepare_cell(plan, ROOT)
    result.update({"workdir": str(workdir), "baseline": baseline})
    try:
        if not preflight(workdir, env, make_probe_launcher(env)):
            result["parkedReason"] = (
                "preflight failed: %d concurrent headless implementer-shaped "
                "launches did not all commit in their own worktrees"
                % PREFLIGHT_WIDTH)
        else:
            try:
                drive_arm_b(engine_wt, workdir, baseline, env, plan, result)
            except Exception as exc:                # evidence survives a crash
                result["status"] = "crashed"
                result["crashDetail"] = "%s: %s" % (type(exc).__name__, exc)
    finally:                                        # after the LAST resolver call
        ab.scrub_credentials(env)

    result["wallClockSec"] = round(time.monotonic() - t0, 1)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = RESULTS_DIR / ("%s-frontier-cell.json"
                         % datetime.now(timezone.utc).date().isoformat())
    out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items()
                      if k not in ("events", "conflicts", "resolverTranscript")},
                     indent=2))
    print("full results: %s" % out, file=sys.stderr)
    gate = result.get("gate") or {}
    return 0 if result["status"] == "complete" and gate.get("passed") else 1


if __name__ == "__main__":
    sys.exit(main())
