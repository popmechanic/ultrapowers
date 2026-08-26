# Fold-over-git Head Recording Implementation Plan (#259)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge/reconcile agents stop writing `<runDir>/heads/` slot files; `finalize_report.py` derives task and final-wave heads from integration-branch ancestry, and the completeness critic derives its detach target from git itself.

**Architecture:** Git is the append-only ledger — task branches survive their merge and the integration branch tip IS the run's tree. The slot convention is deleted from the three merge-side baked prompts; the critic's "highest-numbered slot" derivation becomes "the integration branch tip you verify yourself"; finalize folds branch tips + the tip into the report's headSha fields once, deterministically. The frozen gate consumes the exact same report fields.

**Tech Stack:** Python 3 (scripts + pytest), the baked-prompt system (`references/wave-merge.md` → `harnesses/waves.js`, pinned by `tests/test_no_prompt_drift.py`), Node `.mjs` behavioral sims.

**Spec:** `docs/superpowers/specs/2026-08-26-fold-over-git-heads.md`

**Acceptance:** suite — operator directive on #259: default disposition, committed suite + per-task review is the verification; no seal.

## Global Constraints

- FROZEN, zero diff: `skills/ultrapowers/scripts/gate_check.py`, `skills/ultrapowers/scripts/ultra_gate.py`, `skills/ultrapowers/scripts/run_lock.sh`, `skills/ultrapowers/scripts/collect_seal.py`, `skills/ultrapowers/scripts/seal_hash.py`, `skills/ultrapowers/scripts/run_acceptance.sh`.
- `tests/test_no_prompt_drift.py` stays green: every prompt change lands in BOTH the reference `.md` source and the baked copy in `skills/ultrapowers/harnesses/waves.js`.
- Every Node sim under `tests/*.mjs` that is touched must exit 0 and print the literal sentinel `ALL SCENARIOS PASSED` on success.
- After this change, no prompt, doc, or comment instructs any agent to create or write `<runDir>/heads/` slot files (the `rotate_round_artifacts` legacy-dir handling in `redirect_args.py` remains — it renames pre-change dirs, it does not create them).
- `finalize_report.py` exits 1 naming the specific fact on any anomaly, rewrites the report atomically and only on full success, and never falls back to model-reported values.

---

### Task 1: finalize_report.py — the ancestry fold

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/finalize_report.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_finalize_report.py`

**Interfaces:**
- Consumes: report JSON shape — `waveMerges: [{wave, status, headSha?, branches: [taskId]}]`, `tasks: [{task, branch, headSha?}]`, optionally wrapped in a `result` object (the saved workflow envelope).
- Produces: CLI `finalize_report.py --report <file> --repo <dir> --branch <integrationBranch>` (the `--heads` argument is REMOVED). Exit 0 = report rewritten with derived headShas; exit 1 = anomaly named on stderr, report untouched.

**Parallelization rationale:** the fold is a pure consumer of the report/git contract — no shared code with the prompt surfaces in Tasks 2/3.

- [ ] **Step 1: Rewrite `tests/test_finalize_report.py` (failing tests first)**

Replace the file's fixtures and tests wholesale. Keep the existing header conventions (`SCRIPT` path constant, subprocess `git` helper). New content:

```python
import json, subprocess, sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts/finalize_report.py"


def _git(repo, *a):
    return subprocess.run(["git", "-C", str(repo), *a], check=True,
                          capture_output=True, text=True).stdout.strip()


def _commit(repo, msg):
    subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@t",
                    "-c", "user.name=t", "commit", "--allow-empty", "-q",
                    "-m", msg], check=True)


def _merge(repo, branch):
    subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@t",
                    "-c", "user.name=t", "merge", "-q", "--no-ff",
                    "-m", "merge " + branch, branch], check=True)


def make_run(tmp_path):
    """Real repo shaped like a two-wave run: base -> merge b1, b2 (wave 1)
    -> merge b3 (wave 2) -> plain reconcile-fixup commit on the tip."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _commit(repo, "base")
    base = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", "-b", "ultra/integration-t")
    tips = {}
    for n in ("1", "2"):
        _git(repo, "checkout", "-q", "-b", "worktree-wf_t-" + n, base)
        _commit(repo, "task " + n)
        tips[n] = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", "ultra/integration-t")
    _merge(repo, "worktree-wf_t-1")
    _merge(repo, "worktree-wf_t-2")
    _git(repo, "checkout", "-q", "-b", "worktree-wf_t-3")  # wave 2 forks from the wave-1 tip
    _commit(repo, "task 3")
    tips["3"] = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", "ultra/integration-t")
    _merge(repo, "worktree-wf_t-3")
    _commit(repo, "reconcile fixup")
    tip = _git(repo, "rev-parse", "HEAD")
    return repo, tips, tip


def make_report(tmp_path, tips, envelope=False, last_status="MERGED",
                final_recorded="f" * 40):
    body = {
        "waveMerges": [
            {"wave": 1, "status": "MERGED", "headSha": "a" * 40,
             "branches": ["1", "2"]},
            {"wave": 2, "status": last_status, "headSha": final_recorded,
             "branches": ["3"] if last_status == "MERGED" else []},
        ],
        "tasks": [
            {"task": "1", "status": "done", "branch": "worktree-wf_t-1",
             "headSha": "b" * 40},
            {"task": "2", "status": "done", "branch": "worktree-wf_t-2",
             "headSha": tips["2"]},
            {"task": "3", "status": "done", "branch": "worktree-wf_t-3",
             "headSha": "c" * 40},
        ],
    }
    p = tmp_path / "report.json"
    p.write_text(json.dumps({"result": body} if envelope else body))
    return p


def run(report, repo, branch="ultra/integration-t"):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--report", str(report),
         "--repo", str(repo), "--branch", branch],
        capture_output=True, text=True)


def test_derives_task_heads_and_final_tip(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    data = json.loads(report.read_text())
    by_id = {t["task"]: t for t in data["tasks"]}
    for n in ("1", "2", "3"):
        assert by_id[n]["headSha"] == tips[n]
    # final MERGED entry gets the branch tip (reconcile fixup included)
    assert data["waveMerges"][1]["headSha"] == tip


def test_intermediate_wave_headsha_left_untouched(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    run(report, repo)
    data = json.loads(report.read_text())
    assert data["waveMerges"][0]["headSha"] == "a" * 40  # model-recorded context


def test_recorded_vs_derived_warning_never_blocks(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)   # task 1 recorded b*40 != real tip
    r = run(report, repo)
    assert r.returncode == 0
    assert "warning" in r.stderr and "b" * 40 in r.stderr


def test_envelope_shaped_report(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips, envelope=True)
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    data = json.loads(report.read_text())["result"]
    assert data["waveMerges"][1]["headSha"] == tip


def test_dropped_task_fails_loudly(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    # a branch that exists but never merged into the integration branch
    _git(repo, "checkout", "-q", "-b", "worktree-wf_t-9", tips["1"] + "^")
    _commit(repo, "orphan")
    _git(repo, "checkout", "-q", "ultra/integration-t")
    report = make_report(tmp_path, tips)
    data = json.loads(report.read_text())
    data["waveMerges"][1]["branches"].append("9")
    data["tasks"].append({"task": "9", "status": "done",
                          "branch": "worktree-wf_t-9", "headSha": "d" * 40})
    report.write_text(json.dumps(data))
    before = report.read_text()
    r = run(report, repo)
    assert r.returncode == 1
    assert "not an ancestor" in r.stderr and "worktree-wf_t-9" in r.stderr
    assert report.read_text() == before


def test_unresolvable_branch_fails(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    data = json.loads(report.read_text())
    data["tasks"][0]["branch"] = "no-such-branch"
    report.write_text(json.dumps(data))
    r = run(report, repo)
    assert r.returncode == 1
    assert "no-such-branch" in r.stderr


def test_missing_tasks_entry_and_missing_branch_fail(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    data = json.loads(report.read_text())
    del data["tasks"][0]["branch"]
    data["waveMerges"][0]["branches"].append("7")   # no tasks[] entry
    report.write_text(json.dumps(data))
    r = run(report, repo)
    assert r.returncode == 1
    assert "task 1" in r.stderr and "7" in r.stderr


def test_non_merged_last_entry_untouched_but_task_heads_derived(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips, last_status="SKIPPED",
                         final_recorded="")
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    data = json.loads(report.read_text())
    assert data["waveMerges"][1].get("headSha") == ""      # untouched
    by_id = {t["task"]: t for t in data["tasks"]}
    assert by_id["1"]["headSha"] == tips["1"]              # wave-1 still derived


def test_merged_final_entry_without_recorded_sha_gets_tip(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips, final_recorded="")
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    assert json.loads(report.read_text())["waveMerges"][1]["headSha"] == tip


def test_unresolvable_integration_branch_fails(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    r = run(report, repo, branch="ultra/no-such")
    assert r.returncode == 1
    assert "ultra/no-such" in r.stderr


def test_wrong_shape_report_fails(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    p = tmp_path / "report.json"
    p.write_text(json.dumps({"tasks": []}))
    r = run(p, repo)
    assert r.returncode == 1
    assert "waveMerges" in r.stderr


def test_resume_round_report_only_lists_new_tasks(tmp_path):
    # round-2 style: the report names only task 3; tasks 1/2 landed in a
    # prior round and are absent from this report — must not error.
    repo, tips, tip = make_run(tmp_path)
    body = {
        "waveMerges": [{"wave": 1, "status": "MERGED", "headSha": "e" * 40,
                        "branches": ["3"]}],
        "tasks": [{"task": "3", "status": "done",
                   "branch": "worktree-wf_t-3", "headSha": "c" * 40}],
    }
    p = tmp_path / "report.json"
    p.write_text(json.dumps(body))
    r = run(p, repo)
    assert r.returncode == 0, r.stderr
    data = json.loads(p.read_text())
    assert data["tasks"][0]["headSha"] == tips["3"]
    assert data["waveMerges"][0]["headSha"] == tip
```

- [ ] **Step 2: Run the new tests — verify they fail**

Run: `python3 -m pytest tests/test_finalize_report.py -q`
Expected: FAIL (the current script requires `--heads` and reads slot files).

- [ ] **Step 3: Rewrite `skills/ultrapowers/scripts/finalize_report.py`**

Full replacement content:

```python
#!/usr/bin/env python3
"""Derive report headSha fields from integration-branch ancestry (#259).

Git is the append-only ledger: task branches survive their merge, and the
integration branch tip IS the tree the run produced, whatever round produced
it. This helper folds those facts into report.json once, deterministically —
merge/reconcile agents no longer write <runDir>/heads/ sidecars (#259 deleted
that convention; #114's invariant — nothing the gate trusts rides model
tokens — now holds with zero agent compliance). Per merged task the branch
tip is resolved and asserted an ancestor of the integration tip; the final
MERGED waveMerges entry gets the tip itself (reconcile agents legitimately
append fixup commits after the last branch merge). Intermediate wave heads
stay model-recorded context — no mechanical consumer reads them. Fails
loudly naming the fact; never falls back to token-reported values; rewrites
the report atomically and only on full success.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile


def _git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args),
                          capture_output=True, text=True)


def rev_parse(repo, ref):
    r = _git(repo, "rev-parse", "--verify", "--quiet", ref + "^{commit}")
    return r.stdout.strip() if r.returncode == 0 else None


def is_ancestor(repo, sha, tip):
    return _git(repo, "merge-base", "--is-ancestor", sha, tip).returncode == 0


def select_target(report):
    """Return the dict carrying "waveMerges"/"tasks", or (None, err) if neither
    the top level nor a "result" object has that shape."""
    if isinstance(report.get("waveMerges"), list):
        return report, None
    result = report.get("result")
    if isinstance(result, dict) and isinstance(result.get("waveMerges"), list):
        return result, None
    return None, (
        "wrong shape: report has neither a top-level \"waveMerges\" list "
        "nor a \"result\".\"waveMerges\" list"
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--report", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--branch", required=True,
                    help="the run's integration branch name")
    a = ap.parse_args()

    with open(a.report) as f:
        report = json.load(f)

    target, shape_err = select_target(report)
    if shape_err:
        print("finalize_report: " + shape_err, file=sys.stderr)
        sys.exit(1)

    tip = rev_parse(a.repo, a.branch)
    if not tip:
        print("finalize_report: integration branch %s does not resolve in %s"
              % (a.branch, a.repo), file=sys.stderr)
        sys.exit(1)

    errors, warnings = [], []
    updated = 0
    tasks_by_id = {str(t.get("task")): t for t in (target.get("tasks") or [])}
    merges = target.get("waveMerges") or []

    for wm in merges:
        if wm.get("status") != "MERGED":
            continue
        for tid in wm.get("branches") or []:
            entry = tasks_by_id.get(str(tid))
            if entry is None:
                errors.append("no tasks[] entry for merged task %s" % tid)
                continue
            branch = entry.get("branch")
            if not branch:
                errors.append("tasks[] entry for merged task %s has no "
                              "branch" % tid)
                continue
            tip_b = rev_parse(a.repo, branch)
            if not tip_b:
                errors.append("branch %s (task %s) does not resolve"
                              % (branch, tid))
                continue
            if not is_ancestor(a.repo, tip_b, tip):
                errors.append(
                    "branch %s (task %s) tip %s is not an ancestor of %s "
                    "tip %s — task reported merged but never landed"
                    % (branch, tid, tip_b, a.branch, tip))
                continue
            recorded = entry.get("headSha")
            if recorded and recorded != tip_b:
                warnings.append("task %s: recorded headSha %s != derived %s"
                                % (tid, recorded, tip_b))
            entry["headSha"] = tip_b
            updated += 1

    if merges and merges[-1].get("status") == "MERGED":
        recorded = merges[-1].get("headSha")
        if recorded and recorded != tip:
            warnings.append("final wave: recorded headSha %s != derived tip %s"
                            % (recorded, tip))
        merges[-1]["headSha"] = tip
        updated += 1

    for w in warnings:  # context for the operator, never blocking
        print("finalize_report: warning: " + w + " (context, not blocking)",
              file=sys.stderr)
    if errors:
        for e in errors:
            print("finalize_report: " + e, file=sys.stderr)
        sys.exit(1)

    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(a.report)))
    with os.fdopen(fd, "w") as f:
        json.dump(report, f, indent=2)
    os.replace(tmp, a.report)
    print("finalize_report: %d headSha field(s) derived from %s ancestry"
          % (updated, a.branch))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `python3 -m pytest tests/test_finalize_report.py -q`
Expected: PASS (all tests).

- [ ] **Step 5: Update SKILL.md Step 5 invocation**

In `skills/ultrapowers/SKILL.md`, replace the finalize invocation block (currently `--report <saved-result.json> --heads <runDir>/heads --repo .`) and its following sentence with:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/finalize_report.py \
  --report <saved-result.json> --repo . --branch <integrationBranch>
```

and the prose sentence after it becomes: "It rewrites the envelope's `result.*` headSha fields in place, derived from integration-branch ancestry (merged task branch tips + the integration tip for the final MERGED wave). A non-zero exit is a pre-gate failure: surface it and do **NOT** run `ultra_gate.py`; never fall back to token-reported values. Then run the gate driver with the finalized file:" (the ultra_gate invocation below it is unchanged).

- [ ] **Step 6: Run the wiring pin and full script tests**

Run: `python3 -m pytest tests/test_finalize_report.py tests/test_finalize_wiring.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/scripts/finalize_report.py skills/ultrapowers/SKILL.md tests/test_finalize_report.py
git commit -m "feat: finalize_report derives headShas from integration-branch ancestry (#259)"
```

---

### Task 2: Delete the slot convention from the baked prompts; critic derives from git

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/sim_derived_heads.mjs`
- Test: `tests/frontier_merge.mjs`
- Test: `tests/wave_ancestry_sim.mjs`

**Interfaces:**
- Produces: `mergedShas` entries shaped `{task, branch}` (the model-typed `headSha` is dropped); critic prompt contract "derive that tree from git itself" with `<derived>` = the integration branch tip the critic resolves; merge/reconcile/adopt prompts with NO heads-recording instructions.
- Consumes: nothing from other tasks.

**Parallelization rationale:** the prompt surface (wave-merge.md + waves.js + its sims) is one coupled unit with no code shared with the finalize script or the prose docs.

The prompt text below is the contract; keep it exact — the drift pin (`tests/test_no_prompt_drift.py`) matches wave-merge.md BAKE blocks against waves.js after normalization, so every change lands in both files.

- [ ] **Step 1: Edit `references/wave-merge.md` — MERGE_PROMPT and RECONCILE_PROMPT**

In both the `BAKE:MERGE_PROMPT` and `BAKE:RECONCILE_PROMPT` blocks, delete the span from `Before you report, record heads mechanically FROM THE LAUNCH DIRECTORY` through `re-record.` inclusive, and change the sentence that followed it from `After the heads are recorded and only if you are reporting MERGED, sweep this wave's consumed worktrees:` to:

```
If and only if you are reporting MERGED, sweep this wave's consumed worktrees:
```

Everything else in both blocks (the BLOCKED preamble, merge order, sweep contract, never-delete-branches) stays byte-identical.

- [ ] **Step 2: Edit `references/wave-merge.md` — CONTENDED_MERGE_PROMPT STEP adopt**

In the `BAKE:CONTENDED_MERGE_PROMPT` block's STEP adopt paragraph, delete the same `Before you report, record heads mechanically … re-record.` span, and change `then report TEST_FAILED with the failing output and write no slots.` to `then report TEST_FAILED with the failing output.` The rest of STEP adopt (read-tree test, reset --hard adoption, fallback warning, foldCliWallTimeSec) stays byte-identical.

- [ ] **Step 3: Edit `references/wave-merge.md` — COMPLETENESS_PROMPT detach + authority**

In the `BAKE:COMPLETENESS_PROMPT` block, replace the span from `First, put yourself on the exact tree the run produced` through `recorded merge sha <recorded> != derived heads/ slot <derived>.` with:

```
First, put yourself on the exact tree the run produced, and derive that tree from git itself — never detach at a sha typed into this prompt. Confirm git branch --show-current prints {{INTEGRATION_BRANCH}}; if it does not, report BLOCKED and produce no findings — do not guess a tree. Run git rev-parse HEAD: that sha is <derived>, your detach target. Then run git checkout --detach <derived> and confirm git rev-parse HEAD still equals <derived>; if the detach fails (a dirty or conflicted worktree) or the confirmation differs, report BLOCKED and produce no findings. Only then cross-check the value the run recorded, which is context and not authority: the recorded merge sha is {{MERGE_HEAD_SHA}}. If that recorded value is non-empty and differs from <derived>, report BLOCKED with a finding that names both, written exactly as: recorded merge sha <recorded> != derived integration tip <derived>.
```

And replace the closing authority span from `Authoritative shas live in <runDir>/heads/:` through `context, not authority.` with:

```
Authoritative shas live in git: the branch tips you resolve yourself and the integration HEAD you derived. Treat a branch you cannot resolve exactly as an ancestry miss. Sha values quoted elsewhere in this prompt are context, not authority.
```

The middle of the block (review questions, GLOBAL CONSTRAINTS, TDD-order omission, onIntegrationHead, deferredVerification) stays byte-identical, and the `After confirming HEAD equals <derived> (the heads/-derived detach target),` sentence becomes `After confirming HEAD equals <derived> (the git-derived detach target),`.

- [ ] **Step 4: Edit `references/wave-merge.md` — COMPLETENESS_ANCESTRY**

Replace the `BAKE:COMPLETENESS_ANCESTRY` block body with:

```
You are also given mergedShas, the task id and branch name of every mergeable done task. For each entry, resolve the branch tip yourself with git rev-parse <branch> and assert that its commit landed in this integration tree by running git merge-base --is-ancestor <tip> HEAD; return under ancestryMisses every task whose branch does not resolve or whose tip is not an ancestor of the current HEAD (an empty ancestryMisses when they all are), carrying the resolved tip (or the resolution failure) as that entry's headSha. A branch tip that is not an ancestor is a silently dropped task, and the controller treats a non-empty ancestryMisses as BLOCKED. mergedShas: {{MERGED_SHAS}}
```

Update the surrounding non-BAKE prose in the same section (`{{MERGED_SHAS}}` is now "the JSON list of `{task, branch}` entries").

- [ ] **Step 5: Rewrite `references/wave-merge.md` §Derived Task Heads**

Replace the section body (slot layout, shell-redirection rules, slots-line example, highest-numbered-slot derivation) with prose describing the fold-over-git contract: git is the ledger (task branches survive their merge; the integration tip is the run's tree); no agent writes sidecars; the critic derives its detach target from the branch it verifies and resolves task branch tips itself; `finalize_report.py` folds branch tips + the tip into the report at gate time; #114's invariant (nothing the gate trusts rides model tokens) now holds with zero agent compliance; task ids and branch names still come from `waves.js` control flow / implementer reports, and a name that resolves wrong fails closed through the ancestry assertions. Also delete the now-false paragraph at ~line 84-85 ("Records the same heads it reports into the `<runDir>/heads/` sidecar…") and fix the two prose cross-references to the slot sentence (the `headsSlotsLine` note at ~line 138 and the `heads/` slot-precedent aside at ~line 143 — the frontier directory naming survives, the slot precedent phrasing goes).

- [ ] **Step 6: Re-bake `harnesses/waves.js`**

Apply the same text changes to the baked copies, per `references/workflow-template.md`:

- `MERGE_PROMPT` (~line 425) and `RECONCILE_PROMPT` (~line 463): delete the record-heads span; `'If and only if you are reporting MERGED, '` before the sweep sentence.
- `contendedMergePrompt` STEP adopt (~line 598): same deletion; drop `and write no slots`.
- `completenessPrompt` (~line 670): new detach text with `integrationBranch` interpolated where the source has `{{INTEGRATION_BRANCH}}`; new authority paragraph; `(the git-derived detach target)`.
- `ancestryBlock` inside `completenessPrompt`: the new COMPLETENESS_ANCESTRY text, still ending `+ JSON.stringify(mergedShas)`.
- Delete `headsSlotsLine` (~lines 500-511) entirely; remove `slotsLine` from `mergeWave` (~1759) and from both dispatch concatenations (~1775, ~1798); change `contendedMerge(merged, waveIdx, slotsLine)` to `contendedMerge(merged, waveIdx)` at the definition (~1404) and call site (~1767), and drop `' ' + slotsLine +` from its dispatch (~1446).
- `mergedShas.push(...)` (~2174): entries become `({ task: r.task, branch: r.branch })`.
- Update the stale comments: the #114 block above MERGE_PROMPT (~418-424), the headsSlotsLine comment (~500-502), the contended "heads/ slot sentence is carried verbatim" comment (~536-538), the #123/#114 completeness comments (~663-666, ~727-730), the mergeWave slots comment (~1757-1758), and the critic-dispatch comment naming `<runDir>` "the heads/ sidecar dir" (~2204-2205). Comments state the new contract; none may claim agents write slots.
- `REVIEW_SCHEMA.ancestryMisses` stays `{task, headSha}` — the critic now fills `headSha` with the tip it resolved.
- Grep check before moving on: `grep -n "runDir>/heads\|headsSlotsLine\|slotsLine\|record heads" skills/ultrapowers/harnesses/waves.js` must return nothing.

- [ ] **Step 7: Run the drift pin — verify green**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q`
Expected: PASS (every BAKE block matches its baked copy).

- [ ] **Step 8: Rewrite `tests/sim_derived_heads.mjs` to pin the new contract**

Keep the file name, the real-orchestrator harness (`runWorkflow`), the two-wave scenario, and the `ALL SCENARIOS PASSED` sentinel. Replace the header comment (it now pins the fold-over-git contract, #259) and the assertions:

- For EVERY dispatched merge-side prompt (labels starting `merge:` / `reconcile:`): assert the prompt does NOT contain `<runDir>/heads`, does NOT contain `record heads`, and does NOT contain `For this wave that means slots`.
- Merge prompts still contain `If and only if you are reporting MERGED, sweep` (the sweep survives the deletion).
- The completeness critic prompt (label `integration`): assert it contains the literals `derive that tree from git itself`, `git branch --show-current prints ultra/integration-sim`, `recorded merge sha <recorded> != derived integration tip <derived>`, and `Authoritative shas live in git`.
- The critic prompt's `mergedShas:` JSON contains `"branch":"<branch reported by the stub implementers>"` for each merged task and does NOT contain any `"headSha"` key inside the mergedShas list.
- Assert the critic prompt does NOT contain `<runDir>/heads`.

- [ ] **Step 9: Update `tests/frontier_merge.mjs` and `tests/wave_ancestry_sim.mjs`**

- `frontier_merge.mjs` (~lines 180-205): the two loops asserting `heads/task-A`, `heads/task-B`, `heads/wave-1` reach the contended dispatch become assertions that the contended dispatch contains NO `<runDir>/heads` and NO slot names; update the ~line 49 comment referencing the "heads/ slot precedent".
- `wave_ancestry_sim.mjs`: update the mergedShas expectations to the `{task, branch}` shape and the new ancestry instruction literal (`resolve the branch tip yourself with git rev-parse`).
- Check `tests/sim_workflow.mjs` for assertions on slot wording (`grep -n "heads" tests/sim_workflow.mjs`); update any stub/assert text that depends on the deleted instructions (the `'no wave-1 slot readable'` stub string is critic-authored free text — update it to `'integration branch not checked out'`-style wording only if an assertion reads it; otherwise leave).

- [ ] **Step 10: Run all four sims — verify sentinel**

Run: `node tests/sim_derived_heads.mjs && node tests/frontier_merge.mjs && node tests/wave_ancestry_sim.mjs && node tests/sim_workflow.mjs`
Expected: each exits 0 and prints `ALL SCENARIOS PASSED`.

- [ ] **Step 11: Run the pytest suite slice**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_recommendation_rubric.py -q`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add skills/ultrapowers/references/wave-merge.md skills/ultrapowers/harnesses/waves.js tests/sim_derived_heads.mjs tests/frontier_merge.mjs tests/wave_ancestry_sim.mjs tests/sim_workflow.mjs
git commit -m "feat: delete heads/ slot convention — critic and finalize derive from git (#259)"
```

---

### Task 3: Prose consumers of the dead convention

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/scripts/redirect_args.py`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/scripts/harvest_runs.py`

**Interfaces:**
- Consumes: the new contract described in the spec (`docs/superpowers/specs/2026-08-26-fold-over-git-heads.md` §2-§4) — cite it, don't invent.
- Produces: nothing consumed by other tasks.

**Parallelization rationale:** pure prose accuracy pass; zero code shared with Tasks 1-2.

- [ ] **Step 1: Update SKILL.md redirect prose**

Find the redirect/resume prose claiming `heads/` behavior (grep `heads` in SKILL.md outside the Step-5 block Task 1 owns). Rewrite the claims "the relaunch's merge writes a fresh `heads/`" and "never clear `heads/` … by hand" to match the new contract: no run writes `heads/` any more; rotation still renames a legacy `heads/` dir from pre-#259 runs; headShas are derived from git at finalize time.

- [ ] **Step 2: Update redirect_args.py docstrings**

Module docstring (~lines 11-12) and `rotate_round_artifacts` docstring (~lines 57-58): the `heads/` rename is now legacy-dir handling (pre-#259 runs only; new runs never create it); delete the "stale higher wave-<n> slot" rationale sentence. Behavior unchanged — `python3 -m pytest tests/test_redirect_args.py tests/test_salvage_args.py -q` must stay green with zero code edits.

- [ ] **Step 3: Update report-format.md**

- The `headSha provenance` row (~line 65): headShas are derived at finalization from git ancestry by `finalize_report.py --branch` — merged task heads from branch tips (asserted ancestors of the integration tip), the final MERGED wave from the integration tip; intermediate `waveMerges[].headSha` values are model-recorded context, not authority; the `<runDir>/heads/` sidecars no longer exist.
- The `gitVerified` (~line 80) and `completenessFindings` (~line 84) rows: the critic detaches at the integration branch tip it derives itself (not "the recorded merge HEAD" via slots); recorded values are cross-checked context.
- The frontier row (~line 76): drop the "`heads/` slot precedent" phrasing.

- [ ] **Step 4: Update the harvest_runs.py comment**

The comment near line 477 ("file-derived, post-#114") becomes "git-derived at finalize, post-#259". Comment only; no behavior.

- [ ] **Step 5: Verify no stray references and run the suite slice**

Run: `grep -rn "runDir>/heads\|heads/ slot\|heads/task-\|heads/wave-" skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md skills/ultrapowers/scripts/redirect_args.py skills/ultrapowers/scripts/harvest_runs.py`
Expected: no hits describing live behavior (legacy-dir rotation notes explicitly marked pre-#259 are fine).
Run: `python3 -m pytest tests/test_redirect_args.py tests/test_salvage_args.py tests/test_finalize_wiring.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/scripts/redirect_args.py skills/ultrapowers/references/report-format.md skills/ultrapowers/scripts/harvest_runs.py
git commit -m "docs: retire heads/ slot prose — headShas are git-derived (#259)"
```

---

### Task 4: Full-suite gate

**Type:** gate
**Depends-on:** 1, 2, 3

**Files:**
- Test: `tests/`

- [ ] **Step 1: Full suite**

Run: `python3 -m pytest -q`
Expected: all green (baseline was 1142 passed; count may shift with the rewritten finalize tests).

- [ ] **Step 2: Harness sims**

Run: `node tests/sim_derived_heads.mjs && node tests/frontier_merge.mjs && node tests/wave_ancestry_sim.mjs && node tests/sim_workflow.mjs`
Expected: each prints `ALL SCENARIOS PASSED`.

- [ ] **Step 3: Frozen-periphery check**

Run: `git diff --name-only origin/main... -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_lock.sh skills/ultrapowers/scripts/collect_seal.py skills/ultrapowers/scripts/seal_hash.py skills/ultrapowers/scripts/run_acceptance.sh`
Expected: empty output.

## Operator smoke

- do: `python3 skills/ultrapowers/scripts/finalize_report.py --help`
- see: usage lists `--report`, `--repo`, `--branch`; no `--heads`.
- do: `grep -c "record heads" skills/ultrapowers/harnesses/waves.js`
- see: `0`.
- do: `node tests/sim_derived_heads.mjs`
- see: last line `ALL SCENARIOS PASSED`.
