# Docket Tooling Seams (#122) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three seams every drain re-hits become machinery or named guidance: PLAN-TOGETHER clusters compile as first-class units, drain launches record their wf run IDs where the frozen teardown/approve already look, and the sweep names the exact compiling Acceptance grammar.

**Architecture:** `compile_docket.py` learns cluster semantics (unit = unique Plan path, members advance together, score = max) and drops the raise that rejected the sweep's own output shape. A new small helper writes `run-<stamp>/wf-runs.json` using the frozen module's own reader for shape fidelity. Two sentences land in the ultradocket SKILL.

**Tech Stack:** Python 3 (stdlib only), pytest.

**Acceptance:** suite — self-contained dev tooling (scripts + tests + SKILL prose); the committed pytest suite is the verification.

## Global Constraints

- Frozen periphery untouched: `ultra_gate.py`, `gate_check.py`, `run_lock.sh` are read/imported only, never edited.
- `compile_plan.py`'s Acceptance grammar (`ACCEPT_SUITE`) is NOT widened — part 1 is authoring guidance only.
- `wf-runs.json` shape is a bare JSON array of run-id strings, sorted, no wrapping key — asserted by round-tripping through the frozen `ultra_gate.load_wf_runs`, never by a hand-written shape assumption.
- The run dir resolves as `<git rev-parse --show-toplevel>/.claude/ultrapowers/run-<stamp>/`, exactly as the frozen reader resolves it; never cwd-relative.

---

### Task 1: compile_docket cluster semantics

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultradocket/scripts/compile_docket.py:75-107`
- Test: `tests/test_compile_docket.py`

**Interfaces:**
- Consumes: `docket_lib.parse_docket` / `Entry` (existing, unchanged).
- Produces: `compile_docket(docket_text, ...)` result gains `"units": {<plan_path>: [<issue_id>, ...]}`; `order` is deduped by plan path; a cluster's rank score is the max of member scores; queued entries sharing a Plan no longer raise; members disagreeing on `Engine` (or, for sealed clusters, `Seal`) raise `ValueError` naming the members.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_compile_docket.py` (reuse the file's existing docket-text fixture helpers; if it builds docket text inline, follow that idiom):

```python
def _entry(issue, score, plan, engine="inline", state="queued", seal=None, extra=""):
    lines = [f"### #{issue}: t{issue}", f"**State:** {state}", f"**Score:** {score} — x",
             "**Est-files:** a.py", f"**Plan:** {plan}"]
    if seal:
        lines.append(f"**Seal:** {seal}")
    lines.append(f"**Engine:** {engine}")
    return "\n".join(lines) + "\n" + extra


def _resolver(writes_by_plan, mode="suite"):
    return lambda p: (writes_by_plan.get(p, ["w.py"]), mode)


def test_plan_together_cluster_forms_one_unit():
    text = "# Docket\n\n" + _entry("1", "9", "p/shared.md") + "\n" + \
           _entry("2", "7", "p/shared.md") + "\n" + _entry("3", "8", "p/solo.md")
    out = compile_docket(text, facts_resolver=_resolver({}))
    assert out["order"] == ["p/shared.md", "p/solo.md"]      # deduped, max(9,7)=9 first
    assert out["units"] == {"p/shared.md": ["1", "2"], "p/solo.md": ["3"]}


def test_cluster_collision_reported_once_per_plan_pair():
    text = "# Docket\n\n" + _entry("1", "9", "p/shared.md") + "\n" + \
           _entry("2", "7", "p/shared.md") + "\n" + _entry("3", "8", "p/solo.md")
    out = compile_docket(text, facts_resolver=_resolver(
        {"p/shared.md": ["x.py"], "p/solo.md": ["x.py"]}))
    assert len(out["collisions"]) == 1
    assert set(out["collisions"][0]["plans"]) == {"p/shared.md", "p/solo.md"}


def test_sealed_cluster_member_missing_seal_raises_naming_member():
    # regression coverage of the EXISTING pre-unitization no_seal check
    text = "# Docket\n\n" + _entry("1", "9", "p/s.md", seal="abcdef123456") + "\n" + \
           _entry("2", "7", "p/s.md")   # same plan, no Seal
    try:
        compile_docket(text, facts_resolver=_resolver({}, mode="sealed"))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "2" in str(e)


def test_cluster_engine_disagreement_raises_naming_members():
    text = "# Docket\n\n" + _entry("1", "9", "p/s.md", engine="inline") + "\n" + \
           _entry("2", "7", "p/s.md", engine="ultrapowers")
    try:
        compile_docket(text, facts_resolver=_resolver({}))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "1" in str(e) and "2" in str(e)


def test_single_entry_result_unchanged():
    text = "# Docket\n\n" + _entry("1", "9", "p/a.md") + "\n" + _entry("2", "7", "p/b.md")
    out = compile_docket(text, facts_resolver=_resolver({}))
    assert out["order"] == ["p/a.md", "p/b.md"]
    assert out["units"] == {"p/a.md": ["1"], "p/b.md": ["2"]}
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_compile_docket.py -v`
Expected: the new tests FAIL — the shared-plan ones on `duplicate Plan paths` ValueError, `units` ones on KeyError.

- [ ] **Step 3: Implement cluster semantics**

In `skills/ultradocket/scripts/compile_docket.py`, replace the span from the duplicate-check through the return (the existing per-entry `missing`/`no_seal` checks above it stay untouched):

```python
    # PLAN-TOGETHER clusters (#122): unit = unique Plan path; queued entries
    # sharing a Plan advance together. The old duplicate-Plan raise rejected a
    # shape the sweep deliberately produces. Accepted loss, recorded: an
    # accidental copy-paste duplicate is now indistinguishable from a
    # deliberate cluster and silently clusters — it still advances through the
    # same gate rather than corrupting anything.
    units = {}
    for e in entries:
        units.setdefault(e.plan, []).append(e)

    for plan, members in units.items():
        engines = {m.engine for m in members}
        if len(engines) > 1:
            names = ", ".join("#" + m.issue for m in members)
            raise ValueError(
                f"cluster {plan} members disagree on Engine ({names}): "
                "PLAN-TOGETHER entries must share one executor")
        if facts[plan][1] == "sealed" and len({m.seal for m in members}) > 1:
            names = ", ".join("#" + m.issue for m in members)
            raise ValueError(
                f"sealed cluster {plan} members disagree on Seal ({names})")

    unit_score = {plan: max(float(m.score.split()[0]) for m in members)
                  for plan, members in units.items()}
    by_score = sorted(units, key=lambda p: -unit_score[p])
    wsets = {p: set(facts[p][0]) for p in units}

    collisions = []
    for i, a in enumerate(by_score):
        for b in by_score[i + 1:]:
            shared = wsets[a] & wsets[b]
            if shared:
                collisions.append({"plans": [a, b], "shared": sorted(shared)})

    order = list(by_score)

    remaining = list(order)
    groups = []
    while remaining:
        group, used = [], set()
        for p in list(remaining):
            if not (wsets[p] & used):
                group.append(p)
                used |= wsets[p]
                remaining.remove(p)
        groups.append(group)
    projection = {
        "groups": groups,
        "max_concurrent": max(len(g) for g in groups) if groups else 0,
        "critical_path_len": len(groups),
    }

    return {"order": order, "collisions": collisions,
            "units": {p: [m.issue for m in members] for p, members in units.items()},
            "budget_usd": budget_usd, "could_have_parallelized": projection}
```

(The `facts` dict resolves each unique plan once already — `{e.plan: facts_resolver(e.plan) for e in entries}` naturally dedupes. Delete the old `plan_paths`/`dupes` block.)

- [ ] **Step 4: Run the full test file**

Run: `python3 -m pytest tests/test_compile_docket.py -v`
Expected: ALL PASS, including every pre-existing test (single-entry behavior identical: `order`, `collisions`, projection shapes unchanged).

- [ ] **Step 5: Commit**

```bash
git add skills/ultradocket/scripts/compile_docket.py tests/test_compile_docket.py
git commit -m "feat(#122): compile_docket learns PLAN-TOGETHER cluster semantics"
```

### Task 2: record_wf_run helper

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultradocket/scripts/record_wf_run.py`
- Test: `tests/test_record_wf_run.py`

**Interfaces:**
- Consumes: `load_wf_runs(run_dir) -> (ids, unreadable)` imported from the frozen gate module (read-only import).
- Produces: CLI `record_wf_run.py <stamp> <wf_runId>` — creates/merges `<git toplevel>/.claude/ultrapowers/run-<stamp>/wf-runs.json` as a sorted bare JSON array of run-id strings; idempotent; exits non-zero with a message on an unreadable existing file (never silently clobbers a corrupt record).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_record_wf_run.py`:

```python
# tests/test_record_wf_run.py
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/ultradocket/scripts/record_wf_run.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from ultra_gate import load_wf_runs  # the FROZEN reader is the shape authority


def record(repo, stamp, run_id):
    return subprocess.run([sys.executable, str(SCRIPT), stamp, run_id],
                          cwd=repo, capture_output=True, text=True)


def make_repo(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    return tmp_path


def test_record_creates_and_merges_idempotently(tmp_path):
    repo = make_repo(tmp_path)
    assert record(repo, "d1", "wf_aaa-1").returncode == 0
    assert record(repo, "d1", "wf_aaa-1").returncode == 0   # same id: no dup
    assert record(repo, "d1", "wf_bbb-2").returncode == 0   # new id: appended
    run_dir = repo / ".claude/ultrapowers/run-d1"
    ids, unreadable = load_wf_runs(run_dir)                  # round-trip through frozen reader
    assert ids == ["wf_aaa-1", "wf_bbb-2"] and not unreadable


def test_record_resolves_run_dir_from_git_toplevel_not_cwd(tmp_path):
    repo = make_repo(tmp_path)
    sub = repo / "docs"
    sub.mkdir()
    r = subprocess.run([sys.executable, str(SCRIPT), "d2", "wf_ccc-3"],
                       cwd=sub, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    ids, _ = load_wf_runs(repo / ".claude/ultrapowers/run-d2")
    assert ids == ["wf_ccc-3"]


def test_record_refuses_unreadable_existing_file(tmp_path):
    repo = make_repo(tmp_path)
    run_dir = repo / ".claude/ultrapowers/run-d3"
    run_dir.mkdir(parents=True)
    (run_dir / "wf-runs.json").write_text("{corrupt")
    r = record(repo, "d3", "wf_ddd-4")
    assert r.returncode == 1 and "unreadable" in r.stderr.lower()
    assert (run_dir / "wf-runs.json").read_text() == "{corrupt"  # never clobbered
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_record_wf_run.py -v`
Expected: FAIL — the script does not exist.

- [ ] **Step 3: Implement the helper**

Create `skills/ultradocket/scripts/record_wf_run.py`:

```python
#!/usr/bin/env python3
"""Record a drain-launched workflow run ID where the frozen gate already looks (#122).

The Step-5 gate driver records wf run IDs into run-<stamp>/wf-runs.json; the
drain bypasses that driver by design, so teardown/approve reported an empty
sweep set. This helper writes the same file, importing the FROZEN reader for
shape fidelity (a bare sorted JSON array of run-id strings — drift impossible
by construction). Usage: record_wf_run.py <stamp> <wf_runId>
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
from ultra_gate import load_wf_runs  # frozen module: imported, never edited


def main():
    if len(sys.argv) != 3:
        print("usage: record_wf_run.py <stamp> <wf_runId>", file=sys.stderr)
        return 2
    stamp, run_id = sys.argv[1], sys.argv[2]
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True)
    if top.returncode != 0:
        print("record_wf_run: not inside a git repository", file=sys.stderr)
        return 1
    run_dir = Path(top.stdout.strip()) / ".claude/ultrapowers" / ("run-" + stamp)
    ids, unreadable = load_wf_runs(run_dir)
    if unreadable:
        print("record_wf_run: existing wf-runs.json is unreadable — refusing to "
              "clobber it; inspect %s" % (run_dir / "wf-runs.json"), file=sys.stderr)
        return 1
    merged = sorted(set(ids) | {run_id})
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "wf-runs.json").write_text(json.dumps(merged, indent=2))
    print("record_wf_run: %s now records %d run id(s)" % (run_dir / "wf-runs.json", len(merged)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests**

Run: `python3 -m pytest tests/test_record_wf_run.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultradocket/scripts/record_wf_run.py tests/test_record_wf_run.py
git commit -m "feat(#122): record_wf_run writes drain launch IDs where the frozen gate reads"
```

### Task 3: SKILL guidance — Acceptance grammar + drain recording

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultradocket/SKILL.md`

**Interfaces:**
- Consumes: the recording helper's CLI (`record_wf_run.py <stamp> <wf_runId>`) from the task that creates it.
- Produces: two SKILL sentences — the sweep names the exact compiling Acceptance form; the drain records each launch ID immediately after launch.

- [ ] **Step 1: Add the sweep grammar sentence**

In `skills/ultradocket/SKILL.md`, sweep step 3 ("**Plan** through the normal pipeline…"), append to that step's text:

```
 Plans the sweep writes must carry the exact compiling Acceptance form —
   `**Acceptance:** suite — <one-line rationale>` (or the sealed/waived
   equivalents) — verified by the pipeline's existing `compile_plan.py --check`
   step; a bare `suite.` parses as `missing` and reds the drain.
```

- [ ] **Step 2: Add the drain recording sentence**

In the drain section's step 2, `ultrapowers` engine branch, after the sentence ending "…following `/ultrapowers` Steps 2–4 for the engine probe, run lock, and args assembly.", insert:

```
 Immediately after each Workflow launch, record the runtime run ID:
     `python3 skills/ultradocket/scripts/record_wf_run.py <stamp> <wf_runId>`
     (the drain's run-lock stamp, one per drain) — teardown and approve then
     derive the sweep set exactly as in single-run mode.
```

- [ ] **Step 3: Verify no pinned prose broke and the suite is green**

Run: `python3 -m pytest`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add skills/ultradocket/SKILL.md
git commit -m "docs(#122): sweep names the compiling Acceptance form; drain records launch IDs"
```

### Task 4: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: exit 0, no failures.
