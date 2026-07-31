# Worktree-Sweep Leak Remediation Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the worktree-leak class measured in the 2026-07-31 vibes.diy post-mortem: approve sweeps every run ID the pipeline ever minted, every sweep accounts for what it did NOT remove, a janitor path surfaces concluded-run leftovers without operator memory, and the docs state the manual-merge obligation.

**Architecture:** The gate driver already saves each launch's report; `result.tasks[].branch` carries `worktree-wf_<runId>-<n>`, so the set of runtime run IDs is *derived* from artifacts the pipeline already produces (`run-<stamp>/wf-runs.json`, unioned across relaunch gates) instead of being threaded by the orchestrating model. `sweep_worktrees.sh` grows a leftover-accounting tail, an explicit `--all` scope, a loud RUN_LOCK-fallback notice, and a report-only `--audit` mode; `ultra_run.py` runs the audit as a non-blocking preflight advisory so the next run surfaces the previous run's leftovers.

**Tech Stack:** bash (BSD/GNU portable), Python 3 stdlib, pytest.

**Spec:** `docs/superpowers/specs/2026-07-31-worktree-sweep-leak-remediation.md`

**Acceptance:** suite — committed pytest suite is the verification; sealing not requested by the operator.

## Global Constraints

- No Anthropic SDK or `ANTHROPIC_API_KEY` anywhere (CLAUDE.md — a distributed plugin must need no API key).
- `ultra_gate.py` is in the frozen verification periphery; this change is operator-authorized (see spec) but must NOT alter gate checks, acceptance administration, or verdict logic — only sweep/janitor bookkeeping. `gate_check.py` and `run_lock.sh` are untouched.
- Shell must run on macOS (BSD userland) and Linux: mtime via `stat -f %m "$p" 2>/dev/null || stat -c %Y "$p"`, no GNU-only flags, keep `set -euo pipefail` semantics (no command may fail the sweep mid-loop).
- Sweep exit codes are unchanged: reporting leftovers is stdout, never a failure; a live locked run is reported, not an error.
- SKILL.md prose pins must stay green: `test_terminal_teardown.py` requires `--approve`, `--teardown`, ≥2 `ultra_gate.py` mentions, "Terminal teardown", and the literal `sweep_worktrees.sh --run` in the teardown path.
- No `skills/ultrapowers/harnesses/*.js` changes in this plan — no `.mjs` sim obligations.
- The existing output contract of `sweep_worktrees.sh` is preserved: the `swept: N worktree(s) removed, M branch(es) deleted, K kept, L locked worktree(s) kept` summary line and the `kept (locked …)` / `kept (unmerged …)` lines keep their exact wording (tests pin them).

---

### Task 1: Sweep accounting — `--all`, loud RUN_LOCK fallback, leftover report

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/sweep_worktrees.sh`
- Test: `tests/test_sweep_worktrees.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `sweep_worktrees.sh --all` (explicit repo-wide scope that ignores the RUNID/RUN_LOCK fallback; mutually exclusive with `--run`, exit 2 if combined); stdout line `note: scope inherited from RUN_LOCK (<id>) — a stale lock silently narrows the sweep; pass --all for a repo-wide sweep` whenever scope came from the RUN_LOCK file; stdout accounting after every sweep: one `left behind: <path> (<size>, <D>d old[, locked — possibly live])` line per remaining `.claude/worktrees/wf_*` entry plus a `left behind: <N> worktree(s), <size> total — outside this sweep's scope (repo-wide sweep: --all)` summary, and NO `left behind` output when nothing remains.

**Parallelization rationale:** none needed — this task and Task 3 touch disjoint files and are genuinely independent fixes of the same incident.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_sweep_worktrees.py` (module already imports `pathlib`, `subprocess`; the helpers `make_repo`, `add_engine_worktree`, `git`, `branches` exist at top of file — reuse them):

```python
def test_scoped_sweep_reports_what_it_left_behind(tmp_path):
    """Finding 1 (vibes.diy 2026-07-31): a scoped sweep silently no-oped on 20
    non-matching wf_* dirs (~23 GB). The sweep must account for every wf_* entry
    it did NOT remove."""
    repo = make_repo(tmp_path)
    add_engine_worktree(repo, "run1-1", "e.txt", merge=True)
    wt_other, _ = add_engine_worktree(repo, "run2-1", "f.txt", merge=False)

    p = subprocess.run(["bash", str(SWEEP), "--run", "run1"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert wt_other.exists()                        # out of scope — kept
    assert f"left behind: {wt_other}" in p.stdout   # ...but accounted for
    assert "left behind: 1 worktree(s)" in p.stdout
    assert "d old" in p.stdout                      # age is part of the line


def test_clean_sweep_reports_no_leftovers(tmp_path):
    repo = make_repo(tmp_path)
    add_engine_worktree(repo, "test-9", "g.txt", merge=True)
    p = subprocess.run(["bash", str(SWEEP)], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "left behind" not in p.stdout


def test_locked_leftover_is_reported_with_lock_marker(tmp_path):
    """A live run's locked worktree is kept AND shows up in the accounting —
    reported, never an error (exit stays 0)."""
    repo = make_repo(tmp_path)
    wt, _ = add_engine_worktree(repo, "live-1", "i.txt", merge=False)
    git(repo, "worktree", "lock", str(wt))
    p = subprocess.run(["bash", str(SWEEP)], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert wt.exists()
    assert f"left behind: {wt}" in p.stdout
    assert "locked" in p.stdout


def test_stale_run_lock_fallback_is_loud_and_all_overrides_it(tmp_path):
    """The stale-RUN_LOCK scoping trap: with no --run, a leftover RUN_LOCK
    silently narrowed even an intended repo-wide sweep to one run. Now the
    inherited scope is announced, the skipped dirs are accounted for, and
    --all performs the intended repo-wide sweep."""
    repo = make_repo(tmp_path)
    lockdir = repo / ".claude" / "ultrapowers"
    lockdir.mkdir(parents=True)
    (lockdir / "RUN_LOCK").write_text("stale-run")
    wt, _ = add_engine_worktree(repo, "otherrun-1", "h.txt", merge=True)

    p = subprocess.run(["bash", str(SWEEP)], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "scope inherited from RUN_LOCK (stale-run)" in p.stdout
    assert wt.exists()
    assert f"left behind: {wt}" in p.stdout

    p = subprocess.run(["bash", str(SWEEP), "--all"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not wt.exists()
    assert "left behind" not in p.stdout
    assert "scope inherited" not in p.stdout


def test_all_and_run_are_mutually_exclusive(tmp_path):
    repo = make_repo(tmp_path)
    p = subprocess.run(["bash", str(SWEEP), "--all", "--run", "x"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 2
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_sweep_worktrees.py -v`
Expected: the five new tests FAIL (no `left behind` output, `--all` rejected by the usage guard); the three pre-existing tests PASS.

- [ ] **Step 3: Implement in `sweep_worktrees.sh`**

Three edits. First, extend the arg parser (replace the existing `while [ $# -gt 0 ]` block):

```bash
FORCE=""
RUN_SCOPE=""
ALL_SCOPE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE="--force" ;;
    --all) ALL_SCOPE="yes" ;;
    --run)
      shift
      RUN_SCOPE="${1:?--run requires a runId argument}"
      ;;
    *)
      echo "usage: sweep_worktrees.sh [--run <runId> | --all] [--force]" >&2
      exit 2
      ;;
  esac
  shift
done
if [ -n "$ALL_SCOPE" ] && [ -n "$RUN_SCOPE" ]; then
  echo "sweep_worktrees.sh: --all and --run are mutually exclusive" >&2
  exit 2
fi
```

Second, gate the fallback on `--all` and make the RUN_LOCK inheritance loud (replace the existing "Fall back to RUNID env or RUN_LOCK file" block; keep the `RUN_SCOPE="${RUN_SCOPE#wf_}"` strip after it, unchanged):

```bash
# Fall back to RUNID env or RUN_LOCK file when neither --run nor --all given.
# The RUN_LOCK fallback is the stale-lock scoping trap (vibes.diy 2026-07-31):
# a leftover lock silently narrows an intended repo-wide sweep to one run —
# so inheriting it is announced, and --all bypasses the fallback entirely.
if [ -z "$ALL_SCOPE" ]; then
  if [ -z "$RUN_SCOPE" ] && [ -n "${RUNID:-}" ]; then
    RUN_SCOPE="$RUNID"
  fi
  if [ -z "$RUN_SCOPE" ] && [ -f "$ROOT/.claude/ultrapowers/RUN_LOCK" ]; then
    RUN_SCOPE="$(cat "$ROOT/.claude/ultrapowers/RUN_LOCK")"
    echo "note: scope inherited from RUN_LOCK (${RUN_SCOPE}) — a stale lock silently narrows the sweep; pass --all for a repo-wide sweep"
  fi
fi
```

Third, append the accounting tail after the existing final `echo "swept: …"` summary line (bottom of the script). Portability: BSD `stat -f %m` first, GNU `stat -c %Y` fallback; sizes via one `du -sk` per leftover:

```bash
# ── leftover accounting ──────────────────────────────────────────────────
# A scoped sweep says nothing about non-matching wf_* dirs — that silence is
# how ~23 GB sat invisible for a month (vibes.diy 2026-07-31). Account for
# every engine worktree this invocation did NOT remove, loudly, with size and
# age; silent only when the directory is genuinely clean.
human_kb() {
  awk -v kb="$1" 'BEGIN {
    if (kb >= 1048576)   printf "%.1fG", kb / 1048576
    else if (kb >= 1024) printf "%.0fM", kb / 1024
    else                 printf "%dK", kb }'
}
mtime_of() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || date +%s
}
now="$(date +%s)"
left_n=0
left_kb=0
for wt in "$ROOT"/.claude/worktrees/wf_*; do
  [ -e "$wt" ] || continue
  left_n=$((left_n + 1))
  kb="$(du -sk "$wt" 2>/dev/null | cut -f1)"
  kb="${kb:-0}"
  left_kb=$((left_kb + kb))
  days=$(( (now - $(mtime_of "$wt")) / 86400 ))
  lock=""
  if is_locked "$wt"; then lock=", locked — possibly live"; fi
  echo "left behind: $wt ($(human_kb "$kb"), ${days}d old${lock})"
done
if [ "$left_n" -gt 0 ]; then
  echo "left behind: $left_n worktree(s), $(human_kb "$left_kb") total — outside this sweep's scope (repo-wide sweep: --all)"
fi
```

Also update the header comment block at the top of the script: add one line documenting `--all` (explicit repo-wide scope, ignores RUNID/RUN_LOCK) and one line noting every sweep ends with a leftover accounting of unremoved `wf_*` entries.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_sweep_worktrees.py -v`
Expected: all PASS (new five + pre-existing three).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/sweep_worktrees.sh tests/test_sweep_worktrees.py
git commit -m "feat(sweep): leftover accounting, --all scope, loud RUN_LOCK fallback (Findings 1+trap, 2026-07-31 post-mortem)"
```

---

### Task 2: `--audit` — report-only janitor mode

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/sweep_worktrees.sh`
- Test: `tests/test_sweep_worktrees.py`

**Interfaces:**
- Consumes: the extended arg parser and the `human_kb`/`mtime_of`/`is_locked` helpers from the sweep-accounting task (same file).
- Produces: `sweep_worktrees.sh --audit [--age-hours N]` — report-only (removes/deletes nothing, always exit 0); flags every `.claude/worktrees/wf_*` worktree and every `worktree-wf_*` branch that (a) does not belong to the RUN_LOCK'd live run and (b) is older than N hours (default 24); per-item lines start `orphan worktree:` / `stale branch:`; summary line starts `audit:` and is `audit: clean …` when nothing is flagged. `--audit` combined with `--run`, `--all`, or `--force` exits 2.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_sweep_worktrees.py`. Add `import os` and `import time` to the module imports:

```python
def _age(path, days):
    old = time.time() - days * 86400
    os.utime(path, (old, old))


def test_audit_flags_old_orphans_and_removes_nothing(tmp_path):
    """Findings 2+3: kept-for-inspection degrades to kept-forever because
    nothing re-surfaces it. --audit is the janitor's eyes: report-only."""
    repo = make_repo(tmp_path)
    wt_old, br_old = add_engine_worktree(repo, "old-1", "j.txt", merge=False)
    _age(wt_old, days=2)
    wt_new, _ = add_engine_worktree(repo, "new-1", "k.txt", merge=False)

    p = subprocess.run(["bash", str(SWEEP), "--audit"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert f"orphan worktree: {wt_old}" in p.stdout
    # age guard: a fresh worktree (default threshold 24h) is not nagged
    assert f"orphan worktree: {wt_new}" not in p.stdout
    # report-only: nothing was removed or deleted
    assert wt_old.exists() and wt_new.exists()
    assert br_old in branches(repo)
    assert "audit:" in p.stdout


def test_audit_age_hours_zero_flags_stale_branches_too(tmp_path):
    repo = make_repo(tmp_path)
    wt, br = add_engine_worktree(repo, "fresh-1", "l.txt", merge=False)
    p = subprocess.run(["bash", str(SWEEP), "--audit", "--age-hours", "0"],
                       cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert f"orphan worktree: {wt}" in p.stdout
    assert f"stale branch: {br}" in p.stdout
    assert "unmerged" in p.stdout
    assert wt.exists() and br in branches(repo)


def test_audit_exempts_the_run_lock_live_run(tmp_path):
    repo = make_repo(tmp_path)
    lockdir = repo / ".claude" / "ultrapowers"
    lockdir.mkdir(parents=True)
    (lockdir / "RUN_LOCK").write_text("liverun")
    wt_live, _ = add_engine_worktree(repo, "liverun-1", "m.txt", merge=False)
    _age(wt_live, days=2)
    wt_dead, _ = add_engine_worktree(repo, "deadrun-1", "n.txt", merge=False)
    _age(wt_dead, days=2)

    p = subprocess.run(["bash", str(SWEEP), "--audit"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert f"orphan worktree: {wt_dead}" in p.stdout
    assert f"orphan worktree: {wt_live}" not in p.stdout
    assert "liverun" in p.stdout          # the exemption is stated, not silent


def test_audit_clean_repo_says_clean(tmp_path):
    repo = make_repo(tmp_path)
    p = subprocess.run(["bash", str(SWEEP), "--audit"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "audit: clean" in p.stdout


def test_audit_rejects_sweep_flags(tmp_path):
    repo = make_repo(tmp_path)
    for combo in (["--audit", "--force"], ["--audit", "--all"],
                  ["--audit", "--run", "x"]):
        p = subprocess.run(["bash", str(SWEEP), *combo], cwd=repo,
                           capture_output=True, text=True)
        assert p.returncode == 2, combo
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_sweep_worktrees.py -v`
Expected: the five new audit tests FAIL (`--audit` hits the usage guard, exit 2 — so the three flag-combination asserts may pass trivially, but the four behavior tests fail); everything from the prior task still PASSES.

- [ ] **Step 3: Implement `--audit` in `sweep_worktrees.sh`**

Extend the arg parser with two cases (inside the existing `case "$1"`):

```bash
    --audit) AUDIT="yes" ;;
    --age-hours)
      shift
      AGE_HOURS="${1:?--age-hours requires a number}"
      ;;
```

Initialize `AUDIT=""` and `AGE_HOURS="24"` beside `FORCE=""`, update the usage line to `usage: sweep_worktrees.sh [--run <runId> | --all] [--force] | --audit [--age-hours <N>]`, and after the `--all`/`--run` exclusivity check add:

```bash
if [ -n "$AUDIT" ] && { [ -n "$FORCE" ] || [ -n "$ALL_SCOPE" ] || [ -n "$RUN_SCOPE" ]; }; then
  echo "sweep_worktrees.sh: --audit is report-only and takes no sweep flags" >&2
  exit 2
fi
```

Then, BEFORE the RUNID/RUN_LOCK fallback block (audit must not consume the fallback), insert the audit mode. It needs `human_kb`/`mtime_of` — move those two helper functions up, defining them right after the `is_locked` helper, so both the audit block and the leftover tail (which stays at the bottom) can call them:

```bash
# ── audit mode (report-only janitor) ─────────────────────────────────────
# "Kept for inspection" degrades to kept-forever unless something re-surfaces
# it (Findings 2+3, vibes.diy 2026-07-31). Flags engine worktrees and
# worktree-wf_* branches that belong to no live (RUN_LOCK'd) run and are older
# than --age-hours (default 24 — freshly-kept triage evidence is not nagged).
# Removes nothing, deletes nothing, always exits 0.
if [ -n "$AUDIT" ]; then
  live=""
  if [ -f "$ROOT/.claude/ultrapowers/RUN_LOCK" ]; then
    live="$(cat "$ROOT/.claude/ultrapowers/RUN_LOCK")"
    live="${live#wf_}"
  fi
  now="$(date +%s)"
  cutoff=$((AGE_HOURS * 3600))
  orphans=0; orphan_kb=0; stale=0
  for wt in "$ROOT"/.claude/worktrees/wf_*; do
    [ -e "$wt" ] || continue
    name="$(basename "$wt")"
    if [ -n "$live" ]; then
      case "$name" in "wf_${live}-"*) continue ;; esac
    fi
    age=$(( now - $(mtime_of "$wt") ))
    [ "$age" -lt "$cutoff" ] && continue
    orphans=$((orphans + 1))
    kb="$(du -sk "$wt" 2>/dev/null | cut -f1)"
    kb="${kb:-0}"
    orphan_kb=$((orphan_kb + kb))
    lock=""
    if is_locked "$wt"; then lock=", locked"; fi
    echo "orphan worktree: $wt ($(human_kb "$kb"), $((age / 86400))d old${lock})"
  done
  while IFS= read -r br; do
    [ -n "$br" ] || continue
    if [ -n "$live" ]; then
      case "$br" in "worktree-wf_${live}-"*) continue ;; esac
    fi
    ct="$(git -C "$ROOT" log -1 --format=%ct "$br" 2>/dev/null || echo "$now")"
    age=$(( now - ct ))
    [ "$age" -lt "$cutoff" ] && continue
    stale=$((stale + 1))
    if git -C "$ROOT" merge-base --is-ancestor "$br" HEAD 2>/dev/null; then
      state="merged"
    else
      state="unmerged — failed/blocked work kept for inspection"
    fi
    echo "stale branch: $br ($state, last commit $((age / 86400))d ago)"
  done < <(git -C "$ROOT" branch --list "worktree-wf_*" --format='%(refname:short)')
  if [ "$orphans" -eq 0 ] && [ "$stale" -eq 0 ]; then
    echo "audit: clean (no orphan worktrees or stale branches older than ${AGE_HOURS}h${live:+; live run ${live} exempt})"
  else
    echo "audit: $orphans orphan worktree(s) ($(human_kb "$orphan_kb")), $stale stale branch(es) older than ${AGE_HOURS}h${live:+; live run ${live} exempt} — triage, then remove with sweep_worktrees.sh --all [--force]"
  fi
  exit 0
fi
```

Also add one `--audit` line to the header comment block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_sweep_worktrees.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/sweep_worktrees.sh tests/test_sweep_worktrees.py
git commit -m "feat(sweep): --audit report-only janitor for concluded runs (Findings 2+3)"
```

---

### Task 3: Gate derives wf run IDs; approve sweeps the full set

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_gate.py`
- Test: `tests/test_ultra_gate.py`

**Interfaces:**
- Consumes: the sweep script's pre-existing `--run <id>` interface (unchanged by the other tasks; `--run` accepts the `wf_`-prefixed stem and strips it itself).
- Produces: `run-<stamp>/wf-runs.json` — a sorted JSON list of every `wf_<runId>` observed across all gate calls for this stamp, derived from `report.tasks[].branch` (`worktree-wf_<runId>-<n>`), written in gate mode immediately after the report is saved (so even a BLOCKED gate records IDs); gate receipts carry `wfRuns` (the current list); `--approve` sweeps each ID in wf-runs.json ∪ {`--wf-run` value if given} ∪ {`wf_<stamp>`} and its receipt's `swept` field becomes a map of run ID → sweep summary; `--teardown` output carries `wfRuns` so the triage-evidence hint names the exact IDs to sweep later.

**Parallelization rationale:** none needed — disjoint file from the sweep-script tasks; the gate calls the sweep only through its stable CLI.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ultra_gate.py` (reuses `make_repo`, `good_report`, `run_gate`, `sh`; `re` is not needed in the test module):

```python
def add_worktree(repo, name):
    wt = repo / ".claude" / "worktrees" / name
    sh(["git", "worktree", "add", "-b", "worktree-" + name, str(wt)], cwd=repo)
    return wt


def test_gate_records_every_launch_wf_run_id(tmp_path):
    """Finding 1 root cause: a resumed run mints a NEW wf_runId per Workflow
    invocation, and coverage was orchestrator-threaded. The gate derives each
    launch's runId from the report's task branches and unions across gates."""
    repo, scripts, head = make_repo(tmp_path)
    report = good_report(head)
    report["tasks"] = [
        {"task": "1", "status": "done", "branch": "worktree-wf_1d170a73-a62-1"},
        {"task": "2", "status": "done", "branch": "worktree-wf_1d170a73-a62-2"},
    ]
    r1 = tmp_path / "r1.json"
    r1.write_text(json.dumps({"result": report}))
    run_gate(repo, scripts, r1)
    wf_file = repo / ".claude/ultrapowers/run-t1/wf-runs.json"
    assert json.loads(wf_file.read_text()) == ["wf_1d170a73-a62"]

    # a Salvage/Redirect relaunch gates again under a fresh runtime id — union
    report["tasks"] = [{"task": "2", "status": "done",
                        "branch": "worktree-wf_7cf88e9e-c10-1"}]
    r2 = tmp_path / "r2.json"
    r2.write_text(json.dumps({"result": report}))
    r = run_gate(repo, scripts, r2)
    assert json.loads(wf_file.read_text()) == ["wf_1d170a73-a62",
                                               "wf_7cf88e9e-c10"]
    assert json.loads(r.stdout)["wfRuns"] == ["wf_1d170a73-a62",
                                              "wf_7cf88e9e-c10"]


def test_gate_skips_unparseable_branches_without_failing(tmp_path):
    repo, scripts, head = make_repo(tmp_path)
    report = good_report(head)
    report["tasks"] = [{"task": "1", "status": "done", "branch": "feat/odd-name"},
                      {"task": "2", "status": "done"}]
    result = tmp_path / "r.json"
    result.write_text(json.dumps({"result": report}))
    r = run_gate(repo, scripts, result)
    assert r.returncode == 0, r.stdout + r.stderr        # still a PASS verdict
    assert not (repo / ".claude/ultrapowers/run-t1/wf-runs.json").exists()


def test_approve_sweeps_every_recorded_run_id_plus_stamp(tmp_path):
    """Requirement 1: one gate call, total coverage — every recorded runtime
    id AND the wf_<stamp> integration worktree, no orchestrator-threaded list."""
    repo, scripts, _ = make_repo(tmp_path)
    run_dir = repo / ".claude/ultrapowers/run-t1"
    (run_dir / "wf-runs.json").write_text(
        json.dumps(["wf_1d170a73-a62", "wf_7cf88e9e-c10"]))
    wt_a = add_worktree(repo, "wf_1d170a73-a62-1")
    wt_b = add_worktree(repo, "wf_7cf88e9e-c10-1")
    wt_int = add_worktree(repo, "wf_t1-integration")
    r = sh([sys.executable, str(scripts / "ultra_gate.py"),
            "--stamp", "t1", "--approve", "--branch", "ultra/int"],
           cwd=repo, check=False)
    assert r.returncode == 0, r.stdout + r.stderr
    assert not wt_a.exists() and not wt_b.exists() and not wt_int.exists()
    out = json.loads(r.stdout)
    assert sorted(out["swept"]) == ["wf_1d170a73-a62", "wf_7cf88e9e-c10",
                                    "wf_t1"]


def test_approve_without_records_still_sweeps_the_stamp(tmp_path):
    repo, scripts, _ = make_repo(tmp_path)
    wt_int = add_worktree(repo, "wf_t1-integration")
    r = sh([sys.executable, str(scripts / "ultra_gate.py"),
            "--stamp", "t1", "--approve", "--branch", "ultra/int"],
           cwd=repo, check=False)
    assert r.returncode == 0, r.stdout + r.stderr
    assert not wt_int.exists()
    assert list(json.loads(r.stdout)["swept"]) == ["wf_t1"]


def test_approve_wf_run_flag_is_still_honored_as_belt(tmp_path):
    repo, scripts, _ = make_repo(tmp_path)
    wt = add_worktree(repo, "wf_extra999-zzz-1")
    r = sh([sys.executable, str(scripts / "ultra_gate.py"),
            "--stamp", "t1", "--approve", "--branch", "ultra/int",
            "--wf-run", "wf_extra999-zzz"],
           cwd=repo, check=False)
    assert r.returncode == 0, r.stdout + r.stderr
    assert not wt.exists()
    assert "wf_extra999-zzz" in json.loads(r.stdout)["swept"]


def test_teardown_names_the_recorded_run_ids(tmp_path):
    repo, scripts, _ = make_repo(tmp_path)
    run_dir = repo / ".claude/ultrapowers/run-t1"
    (run_dir / "wf-runs.json").write_text(json.dumps(["wf_1d170a73-a62"]))
    r = sh([sys.executable, str(scripts / "ultra_gate.py"),
            "--stamp", "t1", "--teardown"], cwd=repo, check=False)
    assert r.returncode == 0
    out = json.loads(r.stdout)
    assert out["wfRuns"] == ["wf_1d170a73-a62"]
    # worktrees still kept — teardown remains evidence-preserving
    assert "sweep" in out
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_gate.py -v`
Expected: the seven new tests FAIL (`wf-runs.json` never written, `swept` is `None`, no `wfRuns` key); all pre-existing tests PASS.

- [ ] **Step 3: Implement in `ultra_gate.py`**

Add `import re` to the imports and, below `HERE = …`:

```python
# Engine worktree branches are `worktree-wf_<runId>-<n>`; the runtime run id
# is `wf_<8 hex>-<3 alnum>` (the Workflow tool's transcript stem). Deriving
# the id set from the report's branches is what makes approve-time sweep
# coverage total without an orchestrator-threaded id list (requirement 1,
# vibes.diy 2026-07-31 post-mortem). Non-matching branches are skipped.
WF_RUN_RE = re.compile(r"^worktree-(wf_[0-9a-f]{8}-[0-9a-z]{3})-")


def load_wf_runs(run_dir):
    path = run_dir / "wf-runs.json"
    if path.is_file():
        try:
            return [str(x) for x in json.loads(path.read_text())]
        except Exception:
            return []
    return []


def record_wf_runs(run_dir, report):
    ids = set(load_wf_runs(run_dir))
    for task in report.get("tasks") or []:
        if isinstance(task, dict):
            m = WF_RUN_RE.match(str(task.get("branch") or ""))
            if m:
                ids.add(m.group(1))
    if ids:
        (run_dir / "wf-runs.json").write_text(json.dumps(sorted(ids), indent=2))
    return sorted(ids)
```

In **gate mode**, immediately after `report_path.write_text(...)` (before `gate_check.py` runs, so a BLOCKED verdict still records the launch):

```python
    receipt["wfRuns"] = record_wf_runs(run_dir, report)
```

In **teardown mode**, extend the output object:

```python
    if a.teardown:
        r = sh(lock + ["release", a.stamp], cwd=root)
        out = {"mode": "teardown", "stamp": a.stamp,
               "lockReleased": r.returncode == 0,
               "wfRuns": load_wf_runs(run_dir),
               "sweep": "bash " + str(HERE / "sweep_worktrees.sh") +
                        " --run <id>  # for each of wfRuns plus wf_" + a.stamp +
                        " — worktrees kept as triage evidence"}
        print(json.dumps(out, indent=2))
        return 0 if r.returncode == 0 else 1
```

In **approve mode**, replace the `swept = None / if a.wf_run:` block with:

```python
        # Sweep every run id the pipeline ever minted (recorded at each gate)
        # plus the wf_<stamp> integration worktree — one call, total coverage.
        ids = load_wf_runs(run_dir)
        if a.wf_run and a.wf_run not in ids:
            ids.append(a.wf_run)
        integration_id = "wf_" + a.stamp
        if integration_id not in ids:
            ids.append(integration_id)
        swept = {}
        for rid in ids:
            swept[rid] = sh(["bash", str(HERE / "sweep_worktrees.sh"),
                             "--run", rid], cwd=root).stdout.strip()
```

Update the module docstring's `--approve` sentence to: `--approve: checkout the integration branch, sweep every recorded wf run id plus wf_<stamp> (wf-runs.json ∪ --wf-run), release the lock.` The `--wf-run` argparse help becomes `extra wf_<runId> to sweep (belt; the recorded wf-runs.json set is always swept)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_ultra_gate.py tests/test_terminal_teardown.py -v`
Expected: all PASS (including all pre-existing gate tests — verdict logic untouched).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_gate.py tests/test_ultra_gate.py
git commit -m "feat(gate): derive wf run ids from reports; approve sweeps the full set (requirement 1)"
```

---

### Task 4: Preflight surfaces the audit (janitor without operator memory)

**Type:** implementation
**Depends-on:** 2
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Test: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: `sweep_worktrees.sh --audit` (report-only janitor mode; per-item lines `orphan worktree:` / `stale branch:`, summary line starting `audit:`, always exit 0).
- Produces: a `worktree-audit` receipt stage in `ultra_run.py` — always `ok: true` (advisory, never blocks a launch), its detail carrying the audit's stdout; positioned after the `snapshot` stage (the lock is held, so the live run is exempt by construction).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ultra_run.py` (reuses `make_repo`, `run_driver`, `sh`; add `import os` and `import time` to the module imports):

```python
def test_preflight_surfaces_worktree_audit_without_blocking(tmp_path):
    """Requirement 3: concluded-run leftovers surface at the NEXT run's
    preflight instead of relying on the operator's memory — advisory only."""
    repo = make_repo(tmp_path)
    stale = repo / ".claude" / "worktrees" / "wf_deadrun-1"
    sh(["git", "worktree", "add", "-b", "worktree-wf_deadrun-1", str(stale)],
       cwd=repo)
    old = time.time() - 3 * 86400
    os.utime(stale, (old, old))

    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr        # never blocks
    receipt = json.loads(r.stdout)
    audit = [s for s in receipt["stages"] if s["stage"] == "worktree-audit"]
    assert len(audit) == 1
    assert audit[0]["ok"] is True
    assert "wf_deadrun-1" in audit[0]["detail"]
    assert stale.exists()                                # advisory: untouched


def test_preflight_audit_is_clean_on_a_clean_repo(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    audit = [s for s in receipt["stages"] if s["stage"] == "worktree-audit"]
    assert len(audit) == 1 and audit[0]["ok"] is True
    assert "audit: clean" in audit[0]["detail"]
```

Note the existing `stage(...)` helper stores the message under the `detail` key of each stage dict — mirror whatever key `test_happy_path_receipt` / `test_green_stages_never_carry_failure_phrasings` read (`detail` vs `success`); use the same key those tests use when asserting on stage text.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_run.py -v`
Expected: the two new tests FAIL (no `worktree-audit` stage); all pre-existing tests PASS.

- [ ] **Step 3: Implement the advisory stage in `ultra_run.py`**

In `main()`, directly after the `snapshot` stage block (and before the base-branch derivation), add:

```python
    # Janitor advisory (requirement 3, vibes.diy 2026-07-31): surface leftover
    # engine worktrees/branches from CONCLUDED runs at the next launch, so
    # "kept for inspection" cannot silently become kept-forever. The lock is
    # already held, so this run is exempt by construction. Advisory only —
    # a janitor report must never block a launch.
    r = sh(["bash", str(HERE / "sweep_worktrees.sh"), "--audit"], cwd=root)
    audit_out = (r.stdout or r.stderr or "").strip()
    stage("worktree-audit", True, success=audit_out or "audit produced no output")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_ultra_run.py -v`
Expected: all PASS (including `test_happy_path_receipt`'s `all(s["ok"] …)` and the green-stage-phrasing scan — the audit stage is always ok).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_run.py tests/test_ultra_run.py
git commit -m "feat(preflight): worktree-audit advisory stage — janitor without operator memory (requirement 3)"
```

---

### Task 5: SKILL.md — total-sweep approve, manual-merge obligation, audit pointers

**Type:** implementation
**Depends-on:** 1, 2, 3
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_terminal_teardown.py`

**Interfaces:**
- Consumes: the approve semantics from the gate task (`--approve` sweeps the recorded wf-runs.json set plus `wf_<stamp>`; `--wf-run` is an optional belt), and the `--all` / `--audit` flags from the sweep tasks.
- Produces: updated Step-5 operator prose; prose-pin coverage asserting the new ritual text.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_terminal_teardown.py`:

```python
def test_approve_is_total_sweep_and_manual_merge_still_owes_the_sweep():
    """2026-07-31 post-mortem, requirement 4: approve performs the full sweep
    set itself (wf-runs.json + wf_<stamp>), the manual-merge path is told it
    still owes the sweep, and the janitor (--audit) is named."""
    text = SKILL.read_text()
    assert "wf-runs.json" in text
    assert "sweep_worktrees.sh --all" in text
    assert "--audit" in text
    # bootstrapCmd is why every leak is a multi-GB leak — say so where the
    # operator reads the wrap-up ritual.
    assert "multi-GB" in text
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_terminal_teardown.py -v`
Expected: the new test FAILS; the two pre-existing pins PASS.

- [ ] **Step 3: Edit `skills/ultrapowers/SKILL.md` Step 5**

Three edits, in the Step 5 section only. Keep the literal strings `--approve`, `--teardown`, `Terminal teardown`, and `sweep_worktrees.sh --run` present somewhere in the file (existing prose pins).

**(a)** Replace the Approve bullet's opening (through "…does not match.") with:

```markdown
- **Approve** — only on PASS (or an acknowledged NEEDS_ACK). Run
  `ultra_gate.py --approve --stamp <stamp>` — it does
  `git checkout <integrationBranch>` (re-verifies tests on the integration tree),
  sweeps **every wf run ID the gate recorded across launches**
  (`run-<stamp>/wf-runs.json` — Salvage/Redirect relaunches each mint a fresh
  runtime ID, and all of them are swept) plus `wf_<stamp>` (the dedicated
  integration worktree), reports any `wf_*` leftovers it did not remove, and
  releases the lock. `--wf-run <wf_runId>` is accepted as an extra belt ID;
  no separate sweep call is needed. A **manual-merge wrap-up that bypasses
  `ultra_gate.py` still owes the full sweep set** — once no other run is live,
  `sweep_worktrees.sh --all` — `bootstrapCmd` installs per worktree, so every
  leaked worktree is a multi-GB leak.
```

The rest of the Approve bullet ("When work spanned **multiple phases or runs**…") is unchanged.

**(b)** In the **Terminal teardown** bullet, after the sentence ending "…for the dedicated integration worktree, which that glob misses." append:

```markdown
  The teardown receipt's `wfRuns` lists the recorded IDs verbatim;
  `sweep_worktrees.sh --audit` re-lists kept leftovers later (age-guarded),
  and the next run's preflight surfaces them automatically.
```

**(c)** In the Resources section, extend the sweep line to:

```markdown
- `scripts/sweep_worktrees.sh`, `scripts/run_lock.sh` — sweep (`--run` /
  `--all` / report-only `--audit`) and run lock.
```

- [ ] **Step 4: Run the full suite to verify green**

Run: `python3 -m pytest tests/test_terminal_teardown.py tests/test_session_hook.py tests/test_recommendation_rubric.py -v` then `python3 -m pytest`
Expected: all PASS (the rubric/hook pins do not touch Step 5, but verify anyway).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/SKILL.md tests/test_terminal_teardown.py
git commit -m "docs(skill): approve = total sweep; manual-merge owes the sweep; audit pointers (requirement 4)"
```
