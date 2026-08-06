# Derived Task Heads Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recorded SHAs (task heads, wave-merge heads, the critic's detach target) derive from git output via mechanical sidecar files — never from model tokens — per spec `docs/superpowers/specs/2026-08-06-derived-task-heads-design.md` (issue #114).

**Architecture:** The merge/reconcile agent is the single sidecar writer: after a wave lands it shell-redirects `git rev-parse` output into `<runDir>/heads/` slots. A new deterministic helper `finalize_report.py` overwrites the report's headSha fields from those slots right before `gate_check.py` (which is untouched — frozen periphery). The completeness critic reads the slots as its authority.

**Tech Stack:** Python 3 (stdlib only), pytest, Node (.mjs harness sim), baked-prompt editing per the anti-drift rule.

**Acceptance:** suite — ultrapowers' own engine/skill work; the committed suite plus harness sims is the verification.

## Global Constraints

- **Frozen periphery untouched:** no edits to `gate_check.py`, `run_acceptance.sh`, `ultra_gate.py`, `run_lock.sh`, or any sealing script.
- **Anti-drift:** engine prompts are baked from `skills/ultrapowers/references/wave-merge.md`; every prompt edit lands in the source `.md` AND identically in `harnesses/waves.js`; `tests/test_no_prompt_drift.py` must stay green.
- **Harness sim sentinel:** any `harnesses/*.js` change must be covered by a `tests/*.mjs` sim that exits 0 AND prints `ALL SCENARIOS PASSED` (the suite-gate requires the sentinel).
- **Sidecar convention (pinned; both Task 1 and Task 2 build against this, do not vary it):** directory `<runDir>/heads/`; slot `task-<taskId>` holds the merged task branch's tip, slot `wave-<n>` holds the integration HEAD after wave n's merge; each file contains exactly one lowercase 40-hex SHA plus optional trailing newline, produced by shell redirection of `git rev-parse` output.
- **No new dependencies, no Anthropic SDK, no API keys.**
- **Shell fragments placed in prompts must be BSD/GNU portable** (`mkdir -p`, plain `>` redirection).
- **SKILL.md edits stay inside the complexity-ratchet budget** — the ratchet test in the suite must stay green; trim adjacent prose in the same edit if the added step exceeds the budget.
- Report rewrite is **atomic on success only** (write temp file, `os.replace`); a failing finalize leaves report.json byte-identical.

---

### Task 1: `finalize_report.py` — mechanical report finalization

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `skills/ultrapowers/scripts/finalize_report.py`
- Test: `tests/test_finalize_report.py`

**Interfaces:**
- Consumes: nothing from other tasks — the sidecar format is the pinned Global-Constraints convention, not a code import.
- Produces: CLI `python3 skills/ultrapowers/scripts/finalize_report.py --report <report.json> --heads <headsDir> --repo <repoDir>` → exit 0 (report's `tasks[].headSha` / `waveMerges[].headSha` overwritten from sidecars, one summary line on stdout) or exit 1 (each problem printed to stderr naming its slot; report untouched).

**Parallelization rationale:** the sidecar format is pinned verbatim in Global Constraints, so this task and Task 2 build against the same prose contract with zero file overlap — both run in wave 1.

Tier: standard.

Semantics (report shapes come from `harnesses/waves.js` ~line 1453): a wave entry participates iff `status == "MERGED"`; its `branches` array holds **task ids**; task entries are keyed by `task`. For every MERGED wave: require slot `wave-<wave>`, and for each id in `branches` require slot `task-<id>`. Tasks that ended failed/blocked/deferred appear in no MERGED wave's `branches`, so they are tolerated absent by construction.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_finalize_report.py
import json, subprocess, sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts/finalize_report.py"


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    def git(*a):
        return subprocess.run(["git", "-C", str(repo), *a], check=True,
                              capture_output=True, text=True).stdout.strip()
    git("init", "-q")
    git("-c", "user.email=t@t", "-c", "user.name=t",
        "commit", "--allow-empty", "-q", "-m", "c1")
    return repo, git("rev-parse", "HEAD")


def write_sidecars(tmp_path, mapping):
    heads = tmp_path / "heads"
    heads.mkdir(exist_ok=True)
    for slot, value in mapping.items():
        (heads / slot).write_text(value + "\n")
    return heads


def write_report(tmp_path, wave_status="MERGED", token_sha="f" * 40):
    report = {
        "waveMerges": [{"wave": 1, "status": wave_status,
                        "headSha": token_sha, "branches": ["1"]}],
        "tasks": [{"task": "1", "status": "done", "headSha": token_sha}],
    }
    p = tmp_path / "report.json"
    p.write_text(json.dumps(report))
    return p


def run(report, heads, repo):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--report", str(report),
         "--heads", str(heads), "--repo", str(repo)],
        capture_output=True, text=True)


def test_overwrites_headshas_from_sidecars(tmp_path):
    repo, sha = make_repo(tmp_path)
    heads = write_sidecars(tmp_path, {"task-1": sha, "wave-1": sha})
    report = write_report(tmp_path)          # token value is f*40, NOT sha
    r = run(report, heads, repo)
    assert r.returncode == 0, r.stderr
    data = json.loads(report.read_text())
    assert data["waveMerges"][0]["headSha"] == sha
    assert data["tasks"][0]["headSha"] == sha


def test_missing_task_sidecar_fails_naming_slot_and_leaves_report(tmp_path):
    repo, sha = make_repo(tmp_path)
    heads = write_sidecars(tmp_path, {"wave-1": sha})   # task-1 absent
    report = write_report(tmp_path)
    before = report.read_text()
    r = run(report, heads, repo)
    assert r.returncode == 1
    assert "task-1" in r.stderr
    assert report.read_text() == before


def test_malformed_sidecar_fails_naming_slot(tmp_path):
    repo, sha = make_repo(tmp_path)
    heads = write_sidecars(tmp_path, {"task-1": "deadbeef", "wave-1": sha})
    report = write_report(tmp_path)
    r = run(report, heads, repo)
    assert r.returncode == 1
    assert "task-1" in r.stderr


def test_nonresolving_sidecar_fails_naming_slot(tmp_path):
    repo, sha = make_repo(tmp_path)
    heads = write_sidecars(tmp_path, {"task-1": "1" * 40, "wave-1": sha})
    report = write_report(tmp_path)
    r = run(report, heads, repo)
    assert r.returncode == 1
    assert "task-1" in r.stderr and "resolv" in r.stderr


def test_unmerged_waves_and_failed_tasks_tolerated_absent(tmp_path):
    repo, _ = make_repo(tmp_path)
    heads = write_sidecars(tmp_path, {})     # empty heads dir
    report = write_report(tmp_path, wave_status="SKIPPED")
    r = run(report, heads, repo)
    assert r.returncode == 0, r.stderr
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_finalize_report.py -v`
Expected: FAIL/ERROR on every test (script does not exist yet).

- [ ] **Step 3: Write the implementation**

```python
#!/usr/bin/env python3
"""Overwrite report headSha fields from the run's heads/ sidecars (#114).

The merge agent writes each SHA mechanically (git rev-parse output shell-
redirected into <runDir>/heads/ slots); this helper copies those file-derived
values into report.json so nothing the gate trusts ever rides model tokens.
Fails loudly naming the slot; never falls back to the token-reported values;
rewrites the report atomically and only on full success.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

HEX40 = re.compile(r"^[0-9a-f]{40}$")


def read_slot(heads_dir, slot):
    path = os.path.join(heads_dir, slot)
    if not os.path.isfile(path):
        return None, "missing sidecar " + slot
    raw = open(path).read().strip()
    if not HEX40.match(raw):
        return None, "malformed sidecar %s: %r" % (slot, raw[:60])
    return raw, None


def resolves(repo, sha):
    return subprocess.run(
        ["git", "-C", repo, "rev-parse", "--verify", "--quiet", sha + "^{commit}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--report", required=True)
    ap.add_argument("--heads", required=True)
    ap.add_argument("--repo", required=True)
    a = ap.parse_args()

    with open(a.report) as f:
        report = json.load(f)

    errors = []
    updated = 0
    tasks_by_id = {str(t.get("task")): t for t in (report.get("tasks") or [])}

    for wm in report.get("waveMerges") or []:
        if wm.get("status") != "MERGED":
            continue
        for slot, apply in [("wave-%s" % wm.get("wave"), lambda s, wm=wm: wm.__setitem__("headSha", s))] + [
            ("task-%s" % tid, lambda s, tid=tid: tasks_by_id.get(str(tid), {}).__setitem__("headSha", s))
            for tid in (wm.get("branches") or [])
        ]:
            sha, err = read_slot(a.heads, slot)
            if err:
                errors.append(err)
            elif not resolves(a.repo, sha):
                errors.append("non-resolving sidecar %s: %s" % (slot, sha))
            else:
                apply(sha)
                updated += 1

    if errors:
        for e in errors:
            print("finalize_report: " + e, file=sys.stderr)
        sys.exit(1)

    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(a.report)))
    with os.fdopen(fd, "w") as f:
        json.dump(report, f, indent=2)
    os.replace(tmp, a.report)
    print("finalize_report: %d headSha field(s) derived from %s" % (updated, a.heads))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_finalize_report.py -v`
Expected: 5 passed.

- [ ] **Step 5: Run the full suite**

Run: `python3 -m pytest`
Expected: all green (no existing test touches these paths).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/finalize_report.py tests/test_finalize_report.py
git commit -m "feat(#114): finalize_report.py — derive report headShas from heads/ sidecars"
```

---

### Task 2: Merge/reconcile sidecar writes + critic file-read (prompt sources, re-bake, sim)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/sim_derived_heads.mjs`

**Interfaces:**
- Consumes: nothing from other tasks — the sidecar format is the pinned Global-Constraints convention.
- Produces: dispatched merge/reconcile prompts carrying the sidecar-write instruction with concrete slot names; dispatched completeness-critic prompt carrying the file-read-authority instruction.

Tier: most-capable — baked-prompt coherence work is the engine's known redirect generator; pay once for the top tier.

The three exact prompt sentences below are the contract; land them verbatim in BOTH `references/wave-merge.md` (source) and `harnesses/waves.js` (baked copy), keeping `tests/test_no_prompt_drift.py` green.

Merge-agent addition (append to `MERGE_PROMPT`; also append to `RECONCILE_PROMPT`, which likewise reports MERGED heads):

> Before you report, record heads mechanically: run mkdir -p <runDir>/heads, then for each task branch you merged run git rev-parse <branch> > <runDir>/heads/task-<taskId>, then git rev-parse HEAD > <runDir>/heads/wave-<waveNumber>. Shell redirection only — never type a sha by hand.

At the dispatch sites (`mergeWave` for the merge agent; the reconciliation dispatch for the reconcile agent), append one per-dispatch line naming the concrete slots so the agent infers nothing — the wave number `w + 1` and the mergeable task ids are both in scope there:

> For this wave that means slots: heads/task-3, heads/task-7, and heads/wave-2.

(Build that string from the actual ids/wave number at dispatch; the example ids above are illustrative — the sim asserts the mechanism, not these literals.)

Completeness-critic addition (inside `completenessPrompt`, after the existing ancestry block):

> Authoritative shas live in <runDir>/heads/: read task-<id> for each merged task id in your inputs, and the highest-numbered wave-<n> slot is your detach target. Treat a missing or malformed slot for a merged task exactly as an ancestry miss. Sha values quoted elsewhere in this prompt are context, not authority.

Wiring notes: `<runDir>`/`<pluginRoot>` tokens are substituted by the existing bake helper (waves.js ~line 340, `s.split('<runDir>').join(ARGS.runDir)`); confirm `MERGE_PROMPT`, `RECONCILE_PROMPT`, and the completeness dispatch flow through it (the implementer prompt at ~line 284 already does) — if any dispatch site bypasses the substitution, route that prompt string through the same helper rather than concatenating `ARGS.runDir` ad hoc. The critic keeps receiving the merged task **ids** in its inputs (ids come from waves.js control flow, not from model transcription — they are not part of this defect class); only the SHA authority moves to files.

- [ ] **Step 1: Write the failing sim**

Create `tests/sim_derived_heads.mjs` following the existing harness-sim pattern in `tests/sim_workflow.mjs` (stub `agent()`/`parallel()`, load `skills/ultrapowers/harnesses/waves.js`, capture every dispatched prompt). Scenarios, asserting on the **dispatched strings** (the ledger's lesson: quote the dispatched text, never a paraphrase):

- merge-agent prompt contains `heads/task-` AND `git rev-parse` AND `> ` (the redirection fragment) AND the run's actual runDir value (post-substitution — assert it does NOT contain the literal `<runDir>` token).
- merge-agent per-dispatch line names `heads/wave-1` and one `heads/task-<id>` for a real task id in the scenario.
- reconcile prompt contains the same sidecar-write fragment.
- critic prompt contains `heads/` and `detach target` and `ancestry miss`, with runDir substituted.

The sim must exit 0 and print `ALL SCENARIOS PASSED` on success (suite-gate sentinel — Global Constraints).

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_derived_heads.mjs`
Expected: non-zero exit; assertions about `heads/` fail (prompts don't carry the instruction yet).

- [ ] **Step 3: Edit the prompt source, then re-bake**

Add the three sentences above to `skills/ultrapowers/references/wave-merge.md` in the merge-agent, reconcile-agent, and completeness-critic sections; make the identical edits to `MERGE_PROMPT`, `RECONCILE_PROMPT`, and `completenessPrompt` in `harnesses/waves.js`; add the per-dispatch concrete-slots line at the two dispatch sites.

- [ ] **Step 4: Run the sim and the drift pin**

Run: `node tests/sim_derived_heads.mjs && python3 -m pytest tests/test_no_prompt_drift.py -v`
Expected: sim prints `ALL SCENARIOS PASSED`, exits 0; drift pin green.

- [ ] **Step 5: Run the full suite and the existing sims**

Run: `python3 -m pytest && node tests/sim_workflow.mjs`
Expected: all green; existing sim still prints its sentinel.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/references/wave-merge.md skills/ultrapowers/harnesses/waves.js tests/sim_derived_heads.mjs
git commit -m "feat(#114): merge/reconcile agents write heads/ sidecars; critic reads them as authority"
```

---

### Task 3: SKILL.md Step 5 finalize step + report-format note

**Type:** implementation
**Depends-on:** 1
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`

**Interfaces:**
- Consumes: the Task 1 CLI — `python3 skills/ultrapowers/scripts/finalize_report.py --report <report.json> --heads <runDir>/heads --repo <repo>` (exit 0 success / exit 1 pre-gate failure).
- Produces: nothing consumed by other tasks.

Tier: cheap.

- [ ] **Step 1: Add the finalize step to SKILL.md Step 5**

In the Step-5 gate sequence (immediately before the sentence describing running `gate_check.py`), insert:

> Before `gate_check.py`, finalize the report: `python3 <pluginRoot>/skills/ultrapowers/scripts/finalize_report.py --report <saved-report.json> --heads <runDir>/heads --repo .` — it overwrites every recorded headSha from the merge agent's mechanical sidecars. A non-zero exit is a pre-gate failure: surface it and do not run the gate; never fall back to the token-reported values.

Keep the complexity-ratchet test green: if the addition exceeds the word budget, trim adjacent Step-5 prose in the same edit (Global Constraints).

- [ ] **Step 2: Add the provenance line to report-format.md**

In the section describing `tasks[].headSha` / `waveMerges[].headSha`, add one line:

> headSha values are file-derived at finalization from `<runDir>/heads/` sidecars written mechanically by the merge agent (`finalize_report.py`); the structured-output values they replace are context, not authority.

- [ ] **Step 3: Run the suite (ratchet + drift pins included)**

Run: `python3 -m pytest`
Expected: all green — in particular the SKILL.md ratchet test and any SKILL.md-pinning tests.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md
git commit -m "docs(#114): Step-5 finalize-before-gate + report-format provenance note"
```
