# Eval-methodology Hardening Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the eval matrix honest — expose half-merged plans (coverage), separate the latent-dependency stressor into its own `flawed` fixture, and stamp + partition runs by engine version so pre/post-hardening results are never silently pooled.

**Architecture:** Pure eval-methodology change, no engine code touched. A small shared `engine_version.py` helper resolves the ultrapowers engine version (plugin version + repo sha) for both live scoring and historical backfill. Scorers stamp two new field groups (`tasks_planned`/`tasks_merged`, `engine{}`) onto each `runs.jsonl` row; an idempotent `migrate_runs.py` relabels the legacy buggy-plan `mixed` rows to `flawed` and backfills the new fields on the 14 existing rows; `report.py` adds a coverage column with a green-but-incomplete flag and partitions every table by engine version. A new `flawed` fixture preserves the buggy plan verbatim while `mixed` gets its Task 4 dependency corrected.

**Tech Stack:** Python 3 standard library (`json`, `subprocess`, `argparse`, `statistics`), pytest, git.

**Spec:** `docs/superpowers/specs/2026-06-14-eval-methodology-hardening-design.md`

**Acceptance:** suite — this is ultrapowers' own eval scripts/fixtures/docs; the operator reads the diffs, and the committed pytest suite (`evals/scripts/tests/`) plus the fixture-invariant tests are the verification. No held-out exam.

---

## File Structure

| Path | New? | Responsibility | Task |
|------|------|----------------|------|
| `evals/scripts/engine_version.py` | new | Resolve engine version (plugin version + repo sha) live and at a past epoch | 1 |
| `evals/scripts/report.py` | modify | Coverage column + green-but-incomplete flag; partition every table by engine version | 2 |
| `evals/fixtures/flawed/` | new (copy) | The buggy-plan regime: `mixed` with the latent Task 4→Task 1 dependency, preserved | 3 |
| `evals/fixtures/mixed/plan.md` | modify | Correct Task 4 `Depends-on` to `1`; `version.txt` bump | 3 |
| `evals/scripts/score_run.py` | modify | Stamp `engine{}` + `tasks_planned`/`tasks_merged`; extract testable `assemble_row` | 4 |
| `evals/scripts/autoscore.py` | modify | Extract pure `parse_counters`; derive planned/merged; pass them through | 4 |
| `evals/scripts/migrate_runs.py` | new | Relabel mixed→flawed + backfill engine/task fields on the 14 rows (idempotent) | 5 |
| `evals/results/runs.jsonl` | modify (data) | Migrated in place by Task 5's run step | 5 |
| `evals/README.md` | modify | Document `flawed` regime, 45-cell matrix, freeze-then-complete + non-pooling policy, `version.txt` convention | 6 |
| `evals/scripts/tests/test_*.py` | new | Unit tests for each unit above | 1–6 |

**Canonical row-schema additions** (every scorer/migration/report task agrees on these field names — embedded here once, repeated in each task body that needs it):

```jsonc
{
  "tasks_planned": 6,          // implementation tasks the engine planned (int | null)
  "tasks_merged": 3,           // tasks that reached done/MERGED (int | null)
  "engine": {                  // the ultrapowers ENGINE version (≠ row "head", the fixture repo)
    "plugin_version": "0.0.10",
    "sha": "eefcbab32a44a712f322f7a5bd3c4fe0d0a60db1"
  }
}
```

---

### Task 1: Engine-version helper

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/scripts/engine_version.py`
- Test: `evals/scripts/tests/test_engine_version.py`

This module is the single source of truth for "what engine version produced this run." The engine version is the plugin version (`.claude-plugin/plugin.json`) plus the ultrapowers repo HEAD sha — distinct from a run row's `head`, which is the *fixture* repo HEAD. `current_engine()` is for live scoring; `engine_at_epoch(epoch)` is for backfilling historical rows from their `scored_epoch`.

- [ ] **Step 1: Write the failing test**

```python
# evals/scripts/tests/test_engine_version.py
import json
import pathlib
import subprocess
import sys
import time

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import engine_version as ev  # noqa: E402

ROOT = ev.repo_root()


def _head():
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
                          capture_output=True, text=True).stdout.strip()


def test_repo_root_points_at_plugin_manifest():
    assert (ROOT / ".claude-plugin" / "plugin.json").exists()


def test_current_engine_matches_head_and_plugin_json():
    eng = ev.current_engine()
    assert eng["sha"] == _head()
    assert len(eng["sha"]) == 40
    expected = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text())["version"]
    assert eng["plugin_version"] == expected


def test_engine_at_epoch_now_resolves_to_head():
    eng = ev.engine_at_epoch(time.time())
    assert eng["sha"] == _head()
    assert isinstance(eng["plugin_version"], str) and eng["plugin_version"]


def test_engine_at_epoch_far_past_returns_a_real_commit():
    eng = ev.engine_at_epoch(1)  # 1970, predates the repo
    assert len(eng["sha"]) == 40
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest evals/scripts/tests/test_engine_version.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'engine_version'`.

- [ ] **Step 3: Write the implementation**

```python
# evals/scripts/engine_version.py
#!/usr/bin/env python3
"""Resolve the ultrapowers *engine* version for an eval run.

The engine version is the plugin version (.claude-plugin/plugin.json) plus the
ultrapowers repo HEAD sha — distinct from a run row's `head`, which is the
*fixture* repo HEAD. score_run.py stamps the live engine; migrate_runs.py
backfills historical rows from each row's scored_epoch.
"""
import json
import pathlib
import subprocess
import time


def repo_root():
    # engine_version.py -> scripts -> evals -> repo root
    return pathlib.Path(__file__).resolve().parents[2]


def _git(args, root):
    return subprocess.run(["git", *args], cwd=root,
                          capture_output=True, text=True).stdout.strip()


def _version_from_text(text):
    return json.loads(text)["version"] if text.strip() else "unknown"


def current_engine():
    """The engine version at HEAD right now (for live scoring)."""
    root = repo_root()
    sha = _git(["rev-parse", "HEAD"], root)
    version = json.loads(
        (root / ".claude-plugin" / "plugin.json").read_text())["version"]
    return {"plugin_version": version, "sha": sha}


def engine_at_epoch(epoch, branch="main"):
    """The engine version that was HEAD at unix `epoch` (for backfill)."""
    root = repo_root()
    iso = time.strftime("%Y-%m-%d %H:%M:%S +0000", time.gmtime(epoch))
    sha = _git(["rev-list", "-1", f"--before={iso}", branch], root)
    if not sha:  # epoch predates the branch — use its first commit
        sha = _git(["rev-list", "--max-parents=0", branch], root).splitlines()[0]
    text = _git(["show", f"{sha}:.claude-plugin/plugin.json"], root)
    return {"plugin_version": _version_from_text(text), "sha": sha}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest evals/scripts/tests/test_engine_version.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add evals/scripts/engine_version.py evals/scripts/tests/test_engine_version.py
git commit -m "evals: add engine_version helper (plugin version + repo sha)"
```

---

### Task 2: Report — coverage column, green-but-incomplete flag, engine partitioning

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `evals/scripts/report.py` (full rewrite below)
- Test: `evals/scripts/tests/test_report.py`

`report.py` must (a) add a `coverage (med)` column = median of `tasks_merged / tasks_planned`, (b) flag any cell with `⚠` when a run in it is suite-green yet coverage < 100%, and (c) partition every table by engine version (`plugin_version@shortsha`) so medians are never pooled across engine versions. Rows missing the new fields degrade gracefully (`engine` → `unknown`, coverage → `-`). The row-schema fields this reads are `tasks_planned`, `tasks_merged`, and `engine{plugin_version, sha}` (canonical shape in the plan preamble).

- [ ] **Step 1: Write the failing test**

```python
# evals/scripts/tests/test_report.py
import json
import pathlib
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import report  # noqa: E402


def test_engine_key_unknown_when_missing():
    assert report.engine_key({}) == "unknown"
    assert report.engine_key(
        {"engine": {"plugin_version": "0.0.9", "sha": "abcdef1234"}}
    ) == "0.0.9@abcdef1"


def test_coverage_none_when_unplanned():
    assert report.coverage({}) is None
    assert report.coverage({"tasks_planned": 6, "tasks_merged": 3}) == 0.5


def test_green_but_incomplete_flag():
    green_incomplete = {"suite": {"failed": 0, "errors": 0},
                        "tasks_planned": 6, "tasks_merged": 3}
    green_complete = {"suite": {"failed": 0, "errors": 0},
                      "tasks_planned": 6, "tasks_merged": 6}
    red_incomplete = {"suite": {"failed": 2, "errors": 0},
                      "tasks_planned": 6, "tasks_merged": 3}
    assert report.green_but_incomplete([green_complete, green_incomplete]) is True
    assert report.green_but_incomplete([green_complete]) is False
    assert report.green_but_incomplete([red_incomplete]) is False


def _row(**kw):
    base = {"run_id": "x", "fixture": "mixed", "condition": "B", "rep": 1,
            "cost_usd": 7.0, "weekly_pct": None, "wall_clock_s": 600.0,
            "suite": {"passed": 58, "failed": 0, "errors": 0, "total": 58},
            "acceptance": {"passed": 7, "failed": 0, "errors": 0, "total": 7},
            "fix_rounds": 0, "blocked_tasks": 0,
            "tasks_planned": 6, "tasks_merged": 6,
            "engine": {"plugin_version": "0.0.10", "sha": "b" * 40}}
    base.update(kw)
    return base


def test_main_adds_coverage_flags_and_splits_engines(tmp_path, monkeypatch, capsys):
    rows = [
        _row(run_id="mixed-B-1", rep=1, tasks_merged=3, blocked_tasks=3,
             acceptance={"passed": 3, "failed": 4, "errors": 0, "total": 7},
             engine={"plugin_version": "0.0.9", "sha": "a" * 40}),
        _row(run_id="mixed-B-2", rep=2, tasks_merged=6,
             engine={"plugin_version": "0.0.10", "sha": "b" * 40}),
    ]
    (tmp_path / "runs.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in rows))
    monkeypatch.setattr(report, "RESULTS", tmp_path)
    report.main()
    out = capsys.readouterr().out
    assert "coverage (med)" in out
    assert "⚠" in out                       # green-but-incomplete 0.0.9 row
    assert "0.0.9@aaaaaaa" in out                # two engines, not pooled
    assert "0.0.10@bbbbbbb" in out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest evals/scripts/tests/test_report.py -q`
Expected: FAIL — `AttributeError: module 'report' has no attribute 'engine_key'`.

- [ ] **Step 3: Rewrite `report.py`**

Replace the entire contents of `evals/scripts/report.py` with:

```python
#!/usr/bin/env python3
"""Aggregate eval results into the comparison report.

Reads evals/results/runs.jsonl (+ judgments.jsonl if present) and prints a
markdown report: per fixture x condition x engine-version medians for cost,
clock, acceptance pass rate, suite green rate, plan coverage, and fix rounds;
then judge win rates.

Rows are partitioned by engine version (plugin_version + short sha): medians are
never pooled across engine versions. A cell that is suite-green but has a run
with plan coverage < 100% is flagged (green-but-incomplete).
"""
import json
import pathlib
import statistics
from collections import defaultdict

EVALS = pathlib.Path(__file__).resolve().parents[1]
RESULTS = EVALS / "results"


def load(name):
    path = RESULTS / name
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def median(xs):
    return statistics.median(xs) if xs else float("nan")


def engine_key(r):
    """Stable per-engine label; rows without an engine stamp group as unknown."""
    e = r.get("engine")
    if not e:
        return "unknown"
    return f'{e.get("plugin_version", "?")}@{e.get("sha", "")[:7]}'


def is_green(r):
    return r["suite"]["failed"] == 0 and r["suite"]["errors"] == 0


def coverage(r):
    """tasks_merged / tasks_planned, or None when not recorded."""
    planned = r.get("tasks_planned")
    merged = r.get("tasks_merged")
    if not planned or merged is None:
        return None
    return merged / planned


def green_but_incomplete(rs):
    """True if any run is suite-green yet merged fewer tasks than planned."""
    return any(is_green(r) and (coverage(r) is not None and coverage(r) < 1.0)
               for r in rs)


def main():
    runs = load("runs.jsonl")
    if not runs:
        raise SystemExit("no runs scored yet")

    cells = defaultdict(list)
    for r in runs:
        cells[(r["fixture"], r["condition"], engine_key(r))].append(r)

    fixtures = sorted({k[0] for k in cells})
    conditions = sorted({k[1] for k in cells})
    engines = sorted({k[2] for k in cells})

    print("# ultrapowers eval report\n")
    print(f"{len(runs)} scored runs across {len(fixtures)} fixtures, "
          f"conditions {', '.join(conditions)}, "
          f"engine versions {', '.join(engines)}.\n")
    print("> Medians are partitioned by engine version and never pooled across "
          "them. ⚠ marks a cell that is suite-green but has a run with plan "
          "coverage < 100% (green-but-incomplete).\n")

    for fixture in fixtures:
        print(f"## {fixture}\n")
        print("| cond | engine | n | median API-equiv $ | weekly % (med) "
              "| median clock | acceptance | suite green | coverage (med) "
              "| fix rounds (med) |")
        print("|------|--------|---|--------------------|----------------"
              "|--------------|------------|-------------|----------------"
              "|------------------|")
        for cond in conditions:
            for eng in engines:
                rs = cells.get((fixture, cond, eng))
                if not rs:
                    continue
                cost = median([r["cost_usd"] for r in rs])
                pcts = [r["weekly_pct"] for r in rs
                        if r.get("weekly_pct") is not None]
                pct = f"{median(pcts):.1f}%" if pcts else "-"
                clock = median([r["wall_clock_s"] for r in rs])
                acc = [r["acceptance"] for r in rs]
                acc_rate = (sum(a["passed"] for a in acc) /
                            max(1, sum(a["total"] for a in acc)))
                green = sum(1 for r in rs if is_green(r))
                covs = [c for c in (coverage(r) for r in rs) if c is not None]
                cov = f"{median(covs):.0%}" if covs else "-"
                if green_but_incomplete(rs):
                    cov += " ⚠"
                fixr = median([r["fix_rounds"] for r in rs])
                print(f"| {cond} | {eng} | {len(rs)} | ${cost:.2f} | {pct} "
                      f"| {clock/60:.1f}m | {acc_rate:.0%} | {green}/{len(rs)} "
                      f"| {cov} | {fixr:.0f} |")
        print()

    judgments = load("judgments.jsonl")
    if judgments:
        print("## Blinded pairwise judge\n")
        wins = defaultdict(lambda: defaultdict(int))
        run_cond = {r["run_id"]: r["condition"] for r in runs}
        for j in judgments:
            conds = tuple(sorted(run_cond.get(rid, "?") for rid in j["pair"]))
            winner = j["winner_run_id"]
            label = run_cond.get(winner, "tie")
            wins[conds][label] += 1
        print("| matchup | " + " | ".join(conditions + ["tie"]) + " |")
        print("|---------|" + "---|" * (len(conditions) + 1))
        for conds, tally in sorted(wins.items()):
            row = " | ".join(str(tally.get(c, 0)) for c in conditions + ["tie"])
            print(f"| {' vs '.join(conds)} | {row} |")
        print()

    # Cross-condition headlines, also partitioned by engine version so the
    # frozen baseline and a later (hardened) engine never fuse into one figure.
    print("## Cost per passing acceptance test\n")
    print("| cond | engine | total API-equiv $ | acceptance passed | $/pass "
          "| runs/week (Max plan) |")
    print("|------|--------|-------------------|-------------------|--------"
          "|----------------------|")
    by_cond = defaultdict(list)
    for r in runs:
        by_cond[(r["condition"], engine_key(r))].append(r)
    for cond, eng in sorted(by_cond):
        rs = by_cond[(cond, eng)]
        total = sum(r["cost_usd"] for r in rs)
        passed = sum(r["acceptance"]["passed"] for r in rs)
        per = f"${total / passed:.2f}" if passed else "n/a"
        pcts = [r["weekly_pct"] for r in rs if r.get("weekly_pct") is not None]
        rpw = f"~{100 / median(pcts):.0f}" if pcts and median(pcts) > 0 else "-"
        print(f"| {cond} | {eng} | ${total:.2f} | {passed} | {per} | {rpw} |")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest evals/scripts/tests/test_report.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add evals/scripts/report.py evals/scripts/tests/test_report.py
git commit -m "evals: report shows plan coverage + flags green-but-incomplete; partitions by engine version (#26, #28)"
```

---

### Task 3: Promote the flawed plan — `flawed` fixture + corrected `mixed`

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/fixtures/flawed/` (recursive copy of the mixed fixture directory)
- Create: `evals/fixtures/flawed/version.txt`
- Modify: `evals/fixtures/mixed/plan.md` (Task 4 dependency)
- Create: `evals/fixtures/mixed/version.txt`
- Test: `evals/scripts/tests/test_fixtures.py`

`flawed` is "mixed with the latent-dependency plan, preserved." Copy the whole `mixed/` directory FIRST (capturing today's buggy `plan.md`, plus `project/`, `reference/`, `acceptance/` unchanged), THEN fix `mixed/plan.md` so the two diverge by exactly the one corrected marker. The buggy plan declares Task 4 `**Depends-on:** none` while its spec requires `add()` to return a `schema.User` from Task 1; `mixed` must instead declare `**Depends-on:** 1`. Note: Task 1 also carries `**Depends-on:** none`, so scope the edit to the Task 4 block (heading included) — do not global-replace.

- [ ] **Step 1: Write the failing test**

```python
# evals/scripts/tests/test_fixtures.py
import pathlib

FIX = pathlib.Path(__file__).resolve().parents[2] / "fixtures"


def _task4_depends_on(plan_path):
    block = plan_path.read_text().split("### Task 4:")[1].split("### Task 5:")[0]
    for line in block.splitlines():
        if line.startswith("**Depends-on:**"):
            return line.split("**Depends-on:**")[1].strip()
    raise AssertionError("no Depends-on marker in Task 4")


def test_mixed_task4_now_depends_on_task1():
    assert _task4_depends_on(FIX / "mixed" / "plan.md") == "1"


def test_flawed_preserves_the_buggy_task4():
    assert _task4_depends_on(FIX / "flawed" / "plan.md") == "none"


def test_flawed_reuses_the_mixed_acceptance_suite_verbatim():
    flawed = (FIX / "flawed" / "acceptance" / "test_acceptance_mixed.py").read_text()
    mixed = (FIX / "mixed" / "acceptance" / "test_acceptance_mixed.py").read_text()
    assert flawed == mixed


def test_flawed_carries_project_and_reference():
    assert (FIX / "flawed" / "project" / "apistub").is_dir()
    assert (FIX / "flawed" / "reference" / "apistub").is_dir()


def test_both_fixtures_are_versioned():
    assert (FIX / "mixed" / "version.txt").exists()
    assert (FIX / "flawed" / "version.txt").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest evals/scripts/tests/test_fixtures.py -q`
Expected: FAIL — `test_mixed_task4_now_depends_on_task1` (still `none`) and the `flawed` paths do not exist.

- [ ] **Step 3: Copy `mixed` → `flawed` (preserving the buggy plan)**

```bash
cp -R evals/fixtures/mixed evals/fixtures/flawed
```

- [ ] **Step 4: Add the `flawed` version marker**

Create `evals/fixtures/flawed/version.txt`:

```
1-flawed (2026-06-14)
Preserves the intentional latent dependency: Task 4 (In-memory store) declares
Depends-on: none but its spec requires add() to return a schema.User created by
Task 1. Do NOT "fix" this — the bug IS the fixture. Promoted from mixed per #27.
```

- [ ] **Step 5: Correct Task 4's dependency in `mixed/plan.md`**

In `evals/fixtures/mixed/plan.md`, scope the change to the Task 4 block (the heading makes it unique vs. Task 1's identical marker). Replace:

```
### Task 4: In-memory store

**Type:** implementation
**Depends-on:** none
```

with:

```
### Task 4: In-memory store

**Type:** implementation
**Depends-on:** 1
```

- [ ] **Step 6: Add the `mixed` version marker**

Create `evals/fixtures/mixed/version.txt`:

```
2 (2026-06-14)
Task 4 (In-memory store) Depends-on corrected to 1 (was none): add() returns a
schema.User created by Task 1. Bumped after the latent dependency was promoted
into the dedicated flawed fixture (#27). Restart mixed's matrix cells.
```

- [ ] **Step 7: Run test to verify it passes**

Run: `python -m pytest evals/scripts/tests/test_fixtures.py -q`
Expected: PASS (5 passed).

- [ ] **Step 8: Commit**

```bash
git add evals/fixtures/flawed evals/fixtures/mixed/plan.md evals/fixtures/mixed/version.txt evals/scripts/tests/test_fixtures.py
git commit -m "evals: promote buggy mixed plan to flawed fixture; fix mixed Task 4 dependency (#27)"
```

---

### Task 4: Scorers — stamp engine version and plan coverage

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `evals/scripts/score_run.py` (import the engine_version helper from Task 1, add args, extract `assemble_row`)
- Modify: `evals/scripts/autoscore.py` (extract pure `parse_counters`, derive planned/merged)
- Test: `evals/scripts/tests/test_scorers.py`

Both scorers must persist the canonical new fields (`engine{plugin_version, sha}`, `tasks_planned`, `tasks_merged` — shape in the plan preamble). `score_run.py` reads the live engine via `current_engine()` from the `evals/scripts/engine_version.py` helper (created in Task 1) and gains `--tasks-planned`/`--tasks-merged` args (parallel to the existing `--fix-rounds`/`--blocked-tasks`); its row assembly is extracted into a pure `assemble_row(...)` so it can be tested without a git working tree. `autoscore.py`'s transcript-parsing is extracted into a pure `parse_counters(flat)` that additionally derives `planned` (total task statuses) and `merged` (statuses in `done`/`MERGED`), which it forwards to `score_run.py`.

- [ ] **Step 1: Write the failing test**

```python
# evals/scripts/tests/test_scorers.py
import pathlib
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import autoscore  # noqa: E402
import score_run  # noqa: E402


def test_parse_counters_extracts_planned_merged_blocked_fixes():
    flat = ('prefix "fixIterations": 2 noise "integrationBranch": "x" '
            '"status": "MERGED" "status": "done" "status": "blocked"')
    c = autoscore.parse_counters(flat)
    assert c["planned"] == 3
    assert c["merged"] == 2
    assert c["blocked"] == 1
    assert c["fixes"] == 2


def test_parse_counters_returns_none_on_echo_without_tasks():
    assert autoscore.parse_counters("no task entries here") is None


def test_assemble_row_carries_engine_and_coverage_fields():
    row = score_run.assemble_row(
        run_id="mixed-B-9", fixture="mixed", condition="B", rep=9,
        head="f" * 40, cost_usd=7.0,
        weekly_pct_before=None, weekly_pct_after=None, wall=600.0,
        suite={"passed": 58, "failed": 0, "errors": 0, "total": 58},
        acceptance={"passed": 3, "failed": 4, "errors": 0, "total": 7},
        fix_rounds=0, blocked_tasks=3, redirects=0, notes="t",
        engine={"plugin_version": "0.0.10", "sha": "a" * 40},
        tasks_planned=6, tasks_merged=3, scored_epoch=123.0)
    assert row["engine"] == {"plugin_version": "0.0.10", "sha": "a" * 40}
    assert row["tasks_planned"] == 6 and row["tasks_merged"] == 3
    assert row["weekly_pct"] is None


def test_assemble_row_computes_weekly_pct_delta():
    row = score_run.assemble_row(
        run_id="x", fixture="wide", condition="B", rep=1, head="0" * 40,
        cost_usd=1.0, weekly_pct_before=2.0, weekly_pct_after=3.5, wall=1.0,
        suite={"passed": 1, "failed": 0, "errors": 0, "total": 1},
        acceptance={"passed": 1, "failed": 0, "errors": 0, "total": 1},
        fix_rounds=0, blocked_tasks=0, redirects=0, notes="",
        engine={"plugin_version": "0.0.10", "sha": "a" * 40},
        tasks_planned=6, tasks_merged=6, scored_epoch=1.0)
    assert row["weekly_pct"] == 1.5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest evals/scripts/tests/test_scorers.py -q`
Expected: FAIL — `AttributeError: module 'autoscore' has no attribute 'parse_counters'` (and `score_run.assemble_row` missing).

- [ ] **Step 3a: Refactor `autoscore.py` — extract `parse_counters`, derive planned/merged**

In `evals/scripts/autoscore.py`, add the pure parser and rewrite `reliability_counters` and the relevant part of `main` to use it. Replace the existing `reliability_counters` function with:

```python
def parse_counters(flat):
    """Pull reliability counters from a de-escaped workflow-result line.

    Returns dict(fixes, blocked, planned, merged), or None if the line carries
    no task entries (a differently-escaped echo must not silently zero them).
    """
    fixes = re.findall(r'fixIterations":\s*(\d+)', flat)
    statuses = re.findall(r'"status":\s*"(\w+)"', flat)
    if not fixes and not statuses:
        return None
    return {
        "fixes": sum(int(m) for m in fixes),
        "blocked": sum(1 for s in statuses if s not in ("done", "MERGED")),
        "planned": len(statuses),
        "merged": sum(1 for s in statuses if s in ("done", "MERGED")),
    }


def reliability_counters(run_dir):
    """Best (last parseable) counters from the workflow result transcript."""
    stem = pathlib.Path(run_dir).resolve().name
    best = None
    for proj in PROJECTS.glob(f"*-eval-runs-{stem}*"):
        for f in proj.glob("*.jsonl"):
            for line in open(f, errors="replace"):
                if "fixIterations" not in line or "integrationBranch" not in line:
                    continue
                c = parse_counters(line.replace("\\", ""))
                if c is not None:
                    best = c
    if best is None:
        return None, "workflow result summary not found in transcript"
    return best, ""
```

Then update `main()` in `autoscore.py`. Replace this block:

```python
    branch = integration_branch(args.run_dir)
    cost, n_files = run_cost(args.run_dir)
    fixes, blocked, counter_note = reliability_counters(args.run_dir)
```

with:

```python
    branch = integration_branch(args.run_dir)
    cost, n_files = run_cost(args.run_dir)
    counters, counter_note = reliability_counters(args.run_dir)
    if counters is None:
        counters = {"fixes": 0, "blocked": 0, "planned": 0, "merged": 0}
```

And replace the `score_run.py` argument list in `main()`. Change:

```python
           "--fix-rounds", str(fixes),
           "--blocked-tasks", str(blocked),
           "--redirects", "0",
           "--notes", notes]
```

to:

```python
           "--fix-rounds", str(counters["fixes"]),
           "--blocked-tasks", str(counters["blocked"]),
           "--tasks-planned", str(counters["planned"]),
           "--tasks-merged", str(counters["merged"]),
           "--redirects", "0",
           "--notes", notes]
```

- [ ] **Step 3b: Update `score_run.py` — import helper, add args, extract `assemble_row`**

In `evals/scripts/score_run.py`, add the import near the other imports (after `import xml.etree.ElementTree as ET`):

```python
from engine_version import current_engine
```

Add two arguments alongside the existing `--fix-rounds` / `--blocked-tasks` definitions:

```python
    p.add_argument("--tasks-planned", type=int, default=None,
                   help="implementation tasks the engine planned")
    p.add_argument("--tasks-merged", type=int, default=None,
                   help="tasks that reached done/MERGED")
```

Add the pure row builder above `def main():`:

```python
def assemble_row(*, run_id, fixture, condition, rep, head, cost_usd,
                 weekly_pct_before, weekly_pct_after, wall, suite, acceptance,
                 fix_rounds, blocked_tasks, redirects, notes, engine,
                 tasks_planned, tasks_merged, scored_epoch):
    weekly = (round(weekly_pct_after - weekly_pct_before, 2)
              if weekly_pct_before is not None and weekly_pct_after is not None
              else None)
    return {
        "run_id": run_id, "fixture": fixture, "condition": condition, "rep": rep,
        "head": head, "cost_usd": cost_usd, "weekly_pct": weekly,
        "wall_clock_s": wall, "suite": suite, "acceptance": acceptance,
        "fix_rounds": fix_rounds, "blocked_tasks": blocked_tasks,
        "tasks_planned": tasks_planned, "tasks_merged": tasks_merged,
        "redirects": redirects, "engine": engine, "notes": notes,
        "scored_epoch": scored_epoch,
    }
```

Replace the inline `row = { ... }` dict literal in `main()` (the whole assignment) with a call to the builder:

```python
    row = assemble_row(
        run_id=run_id, fixture=args.fixture, condition=args.condition,
        rep=args.rep, head=head, cost_usd=args.cost_usd,
        weekly_pct_before=args.weekly_pct_before,
        weekly_pct_after=args.weekly_pct_after, wall=wall,
        suite={"passed": s_pass, "failed": s_fail, "errors": s_err, "total": s_total},
        acceptance={"passed": a_pass, "failed": a_fail, "errors": a_err, "total": a_total},
        fix_rounds=args.fix_rounds, blocked_tasks=args.blocked_tasks,
        redirects=args.redirects, notes=args.notes, engine=current_engine(),
        tasks_planned=args.tasks_planned, tasks_merged=args.tasks_merged,
        scored_epoch=time.time())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest evals/scripts/tests/test_scorers.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add evals/scripts/score_run.py evals/scripts/autoscore.py evals/scripts/tests/test_scorers.py
git commit -m "evals: scorers stamp engine version + plan coverage (#26, #28)"
```

---

### Task 5: Migrate `runs.jsonl` — relabel mixed→flawed + backfill engine/coverage

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `evals/scripts/migrate_runs.py` (imports the engine_version helper from Task 1)
- Modify: `evals/results/runs.jsonl` (data; rewritten by running the script)
- Test: `evals/scripts/tests/test_migrate_runs.py`

One idempotent script owns the data file. It (1) relabels every legacy `mixed` row to `flawed` (those runs executed the buggy plan now living in the `flawed` fixture — relabel `run_id` prefix and `fixture`), then (2) backfills `engine` from each row's `scored_epoch` via `engine_at_epoch` (created in Task 1) and `tasks_planned`/`tasks_merged` from the per-fixture implementation-task count minus `blocked_tasks`. Re-running must be a no-op: already-`flawed` rows are not re-prefixed and present fields are untouched. The resolver is injectable so the test stays hermetic (no git).

- [ ] **Step 1: Write the failing test**

```python
# evals/scripts/tests/test_migrate_runs.py
import json
import pathlib
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import migrate_runs as m  # noqa: E402

STUB = lambda epoch: {"plugin_version": "0.0.7", "sha": "c" * 40}


def _write(tmp_path, rows):
    p = tmp_path / "runs.jsonl"
    p.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return p


def test_relabels_mixed_and_backfills_fields(tmp_path):
    p = _write(tmp_path, [
        {"run_id": "mixed-B-2", "fixture": "mixed", "blocked_tasks": 3,
         "scored_epoch": 100.0},
        {"run_id": "wide-B-1", "fixture": "wide", "blocked_tasks": 0,
         "scored_epoch": 100.0},
    ])
    out = m.migrate(p, engine_resolver=STUB)
    flawed = [r for r in out if r["run_id"] == "flawed-B-2"][0]
    assert flawed["fixture"] == "flawed"
    assert flawed["tasks_planned"] == 6 and flawed["tasks_merged"] == 3
    assert flawed["engine"] == {"plugin_version": "0.0.7", "sha": "c" * 40}
    wide = [r for r in out if r["fixture"] == "wide"][0]
    assert wide["tasks_planned"] == 6 and wide["tasks_merged"] == 6


def test_migration_is_idempotent(tmp_path):
    p = _write(tmp_path, [
        {"run_id": "mixed-A-1", "fixture": "mixed", "blocked_tasks": 0,
         "scored_epoch": 100.0},
    ])
    first = m.migrate(p, engine_resolver=STUB)
    again = m.migrate(p, engine_resolver=STUB)
    assert again[0]["run_id"] == "flawed-A-1"
    assert again[0]["fixture"] == "flawed"
    assert first == again
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest evals/scripts/tests/test_migrate_runs.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'migrate_runs'`.

- [ ] **Step 3: Write `migrate_runs.py`**

```python
# evals/scripts/migrate_runs.py
#!/usr/bin/env python3
"""Idempotent migration of evals/results/runs.jsonl.

1. Relabel every legacy `mixed` row -> `flawed`: those runs executed the buggy
   plan that is now the dedicated flawed fixture (issue #27).
2. Backfill `engine` (from each row's scored_epoch) and tasks_planned /
   tasks_merged (per-fixture implementation-task count minus blocked_tasks).

Re-running is a no-op: already-flawed rows are not re-prefixed and present
fields are left untouched.
"""
import argparse
import json
import pathlib
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
from engine_version import engine_at_epoch  # noqa: E402

RESULTS = SCRIPTS.parent / "results"

# implementation-task count per fixture plan (coverage denominator)
FIXTURE_TASKS = {"wide": 6, "chained": 5, "mixed": 6, "flawed": 6, "degrade": 2}


def migrate_row(row, engine_resolver):
    # 1. relabel legacy mixed -> flawed (idempotent)
    if row.get("fixture") == "mixed":
        row["fixture"] = "flawed"
        rid = row.get("run_id", "")
        if rid.startswith("mixed-"):
            row["run_id"] = "flawed-" + rid[len("mixed-"):]
    # 2. backfill engine version
    if not row.get("engine"):
        row["engine"] = engine_resolver(row["scored_epoch"])
    # 3. backfill plan coverage
    if row.get("tasks_planned") is None:
        planned = FIXTURE_TASKS.get(row.get("fixture"))
        if planned is not None:
            row["tasks_planned"] = planned
            row["tasks_merged"] = max(0, planned - row.get("blocked_tasks", 0))
    return row


def migrate(path=None, engine_resolver=engine_at_epoch):
    path = pathlib.Path(path) if path else RESULTS / "runs.jsonl"
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    rows = [migrate_row(r, engine_resolver) for r in rows]
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return rows


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--path", help="runs.jsonl (default evals/results/runs.jsonl)")
    args = p.parse_args()
    rows = migrate(args.path)
    flawed = sum(1 for r in rows if r["fixture"] == "flawed")
    have_engine = all("engine" in r for r in rows)
    print(f"migrated {len(rows)} rows; {flawed} flawed; "
          f"all carry engine={have_engine}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest evals/scripts/tests/test_migrate_runs.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Run the migration on the real data**

Run: `python evals/scripts/migrate_runs.py`
Expected output: `migrated 14 rows; 5 flawed; all carry engine=True`

- [ ] **Step 6: Verify the migrated data**

Run: `python -c "import json; rows=[json.loads(l) for l in open('evals/results/runs.jsonl') if l.strip()]; print('rows', len(rows)); print('fixtures', sorted({r['fixture'] for r in rows})); print('no mixed left', all(r['fixture']!='mixed' for r in rows)); print('all engine', all('engine' in r and r['engine'].get('sha') for r in rows)); print('all coverage', all(r.get('tasks_planned') for r in rows))"`
Expected: `rows 14`, fixtures include `flawed` and NOT `mixed`, `no mixed left True`, `all engine True`, `all coverage True`.

- [ ] **Step 7: Confirm idempotency on the real file**

Run: `python evals/scripts/migrate_runs.py && python evals/scripts/migrate_runs.py`
Expected: identical `migrated 14 rows; 5 flawed; all carry engine=True` both times, and `git diff --stat evals/results/runs.jsonl` shows the file unchanged after the second run relative to the first.

- [ ] **Step 8: Commit**

```bash
git add evals/scripts/migrate_runs.py evals/scripts/tests/test_migrate_runs.py evals/results/runs.jsonl
git commit -m "evals: migrate runs.jsonl — relabel mixed->flawed, backfill engine + coverage (#26, #27, #28)"
```

---

### Task 6: Document the methodology changes in `evals/README.md`

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `evals/README.md`
- Test: `evals/scripts/tests/test_readme.py`

Document the fifth `flawed` regime (which reuses `evals/fixtures/flawed/`), the 45-cell matrix, the per-fixture `version.txt` convention, the engine-version stamping with the report's non-pooling rule, and the freeze-then-complete operating policy. Read the file first to match its existing structure and headings; the additions below are the required content.

- [ ] **Step 1: Write the failing test**

```python
# evals/scripts/tests/test_readme.py
import pathlib

README = pathlib.Path(__file__).resolve().parents[2] / "README.md"


def test_readme_documents_new_methodology():
    t = README.read_text().lower()
    assert "flawed" in t                      # the 5th fixture regime
    assert "45" in t                          # 5 x 3 x 3 matrix
    assert "version.txt" in t                 # fixture-version convention
    assert "engine version" in t              # stamping + non-pooling
    assert "coverage" in t                    # plan-coverage column
    assert "freeze" in t                      # freeze-then-complete policy
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest evals/scripts/tests/test_readme.py -q`
Expected: FAIL — terms not present.

- [ ] **Step 3: Read the README and apply the edits**

Read `evals/README.md`. Make these four edits, matching surrounding style:

1. **Fixtures list** — add the `flawed` regime next to the existing four:

```
- **flawed:** the `mixed` apistub task graph carried by a plan with a latent,
  undeclared dependency (Task 4's in-memory store must return a `schema.User`
  created by Task 1, yet declares `Depends-on: none`). Reuses mixed's project,
  reference, and held-out acceptance suite verbatim — only the plan differs. It
  measures the engine on *realistic (buggy) plans*, where `mixed` now measures
  it on *correct* ones. Promoted from the original mixed plan (#27).
```

2. **Matrix size** — update the matrix line from 4 fixtures / 36 runs to:

```
5 fixtures x 3 conditions x 3 reps = 45 runs (capacity-safe scheduling: one run
per 5-hour window).
```

3. **Validity rule** — append a "Fixture versions & methodology" subsection near the existing broken-plan validity rule:

```
**Fixture versions.** Each fixture carries a `version.txt` recording its
generation and what changed. When a frozen plan is found broken, fix it, bump
`version.txt`, and restart that fixture's cells (per the validity rule above).
The buggy first generation may instead be *promoted* to its own fixture (see
`flawed`) so the stressor is measured deliberately rather than lost.

**Engine versions & pooling.** Every run row records the engine version that
produced it: the plugin version (`.claude-plugin/plugin.json`) plus the
ultrapowers repo HEAD sha (distinct from the row's `head`, which is the fixture
repo). `report.py` partitions all medians by engine version and never pools rows
across versions — pre- and post-hardening runs appear as separate populations.

**Freeze-then-complete.** Complete the remaining cells of the matrix on the
current frozen engine before merging engine-behavior changes (e.g. the
eval-driven hardening plan). The hardened engine is then run and reported as a
separate population, not merged into the frozen baseline's medians.

**Plan coverage.** Each row records `tasks_planned`/`tasks_merged`; `report.py`
shows median coverage and flags any cell that is suite-green but coverage < 100%
(green-but-incomplete) — a half-merged plan can no longer read as a clean pass.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest evals/scripts/tests/test_readme.py -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add evals/README.md evals/scripts/tests/test_readme.py
git commit -m "evals: document flawed fixture, engine versioning, coverage, freeze policy (#26, #27, #28)"
```

---

### Task 7: Full eval-scripts test suite (verification)

**Type:** gate

**Suite command:** `python -m pytest evals/scripts/tests/ -q`

**Expectations (verification only — writes nothing):**
- All tests across `test_engine_version.py`, `test_report.py`, `test_fixtures.py`, `test_scorers.py`, `test_migrate_runs.py`, `test_readme.py` pass.
- Smoke: `python evals/scripts/report.py` runs without error against the migrated `runs.jsonl` and prints a `coverage (med)` column, an `engine` column, and (given the relabeled `flawed` rows) at least one `⚠` flag.
- `evals/results/runs.jsonl` contains 14 rows, every row carries a non-empty `engine.sha` and a `tasks_planned`, and no row has `fixture == "mixed"`.

---

### Task 8: Operational follow-up (runbook)

**Type:** manual

Carried into the post-merge runbook — not executed by the engine:

- Under the **freeze-then-complete** policy, run the outstanding cells of the 45-cell matrix on the current frozen engine (including the fresh `mixed` cells and the new `flawed` cells) **before** merging the eval-driven hardening plan (`docs/superpowers/plans/2026-06-12-eval-driven-hardening.md`). Do not pool the hardened engine's runs into the frozen baseline; `report.py` already partitions them.
- After the matrix work lands, close issues #26, #27, #28 referencing this plan and the migrated `runs.jsonl`.

---

## Self-Review

**Spec coverage:**
- #26 coverage column + flag → Tasks 2 (report), 4 (scorers persist fields), 5 (backfill). ✓
- #26 backfill = `tasks_planned` constant − `blocked_tasks` → Task 5 `migrate_row`. ✓
- #27 promote `flawed` + fix `mixed` + bump + relabel rows → Tasks 3 (fixtures) + 5 (relabel). ✓
- #27 restart mixed cells (fresh) → relabel empties mixed (Task 5) + runbook (Task 8). ✓
- #28 engine field (plugin version + engine sha, distinct from `head`) → Tasks 1 + 4. ✓
- #28 backfill via `scored_epoch` → Tasks 1 (`engine_at_epoch`) + 5. ✓
- #28 report refuses to pool silently → Task 2 (partition by engine in every table). ✓
- #28 freeze-then-complete policy → Task 6 (README) + Task 8 (runbook). ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code and exact commands with expected output. ✓

**Type consistency:** Field names (`tasks_planned`, `tasks_merged`, `engine.plugin_version`, `engine.sha`) identical across Tasks 1/2/4/5. `engine_key`, `coverage`, `is_green`, `green_but_incomplete` used consistently in Task 2 + its test. `assemble_row`/`parse_counters` signatures match their tests in Task 4. `migrate`/`migrate_row`/`engine_resolver` match Task 5's test. ✓

**ultraplan additions:**
- Every task carries an explicit `**Type:**`. ✓
- Cross-task constraints are `**Depends-on:**` lines (4→1, 5→1, 6→3), not prose. ✓
- No preamble holds load-bearing coordination absent from task bodies (the canonical schema is repeated in each task that needs it; coordination notes — Task-4-block scoping, copy-before-fix order — live in the affected task bodies). ✓
- Gate (7) and manual (8) are marked; nothing relies on classifier heuristics. ✓
- Backticked cross-task module/path mentions have matching `Depends-on`: Task 4 → `engine_version`/`current_engine` (1); Task 5 → `engine_version`/`engine_at_epoch` (1); Task 6 → `evals/fixtures/flawed/` (3). Task 5's `"flawed"` is a code-fenced string literal (a rewritten field value), not a path reference to Task 3's created dir, so no edge to 3. ✓
- Worktree-purity: wave 1 {1,2,3} and wave 2 {4,5,6} each edit disjoint file sets; only Task 5 touches `runs.jsonl`; tests use `tmp_path`/monkeypatch and read-only git — concurrency-safe. ✓
- Acceptance line present: `suite`. ✓

**Compiled waves (expected):** Wave 1 = Tasks 1, 2, 3 (parallel). Wave 2 = Tasks 4, 5, 6 (parallel). Task 7 → run config (`testCmd`). Task 8 → post-merge runbook.
