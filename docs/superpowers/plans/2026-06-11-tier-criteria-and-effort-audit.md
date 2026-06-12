# Judgment-Risk Tier Criteria + Run Effort Audit Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close issue #20 — sharpen the model-tier criteria around judgment-likelihood (docs) and add a deterministic post-run effort-audit script, shipped as 0.0.8.

**Architecture:** Two independent lanes — a docs lane (Task 1) and a script lane (Task 2) — joined by an integration-docs task (Task 3) that touches files from both. Spec: `docs/superpowers/specs/2026-06-11-tier-criteria-and-effort-audit-design.md`.

**Tech Stack:** Python 3 stdlib only (json, re, statistics, pathlib), pytest. Suite: `python3 -m pytest tests/ -q` and `node tests/sim_workflow.mjs` — both must pass before every commit.

---

### Task 1: Judgment-risk tier criteria in the orchestrator docs

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_report_runbook.py` (existing pins only — update if the suite flags changed phrasing)

- [ ] **Step 1: Rework the Model tiers table**

In `skills/ultrapowers/references/reviewer-prompts.md`, the `## Model tiers` section (it sits OUTSIDE the BAKE blocks — verified; do not touch anything between `<!-- BAKE:` markers). Replace the table and the first sentence of the paragraph below it:

Current table rows:

| Tier | Use when |
|------|----------|
| **cheap** | Mechanical changes confined to 1–2 files with clear, unambiguous specs (renaming, adding a field, fixing a lint error) |
| **standard** | Multi-file integration, new features touching ≥3 modules, tasks requiring reading multiple subsystems |
| **most-capable** | Spec/code review passes, architectural design decisions, resolving ambiguous or conflicting requirements, fix-round re-dispatches |

New table + assignment sentence (the rest of the paragraph — "Reviewers always run at `most-capable` …" through the tierOverrides sentence — stays byte-identical):

| Tier | Use when |
|------|----------|
| **cheap** | Transcription-grade tasks only: the plan supplies complete code the author verified by running it, confined to 1–2 files, and the task touches none of the judgment-risk classes below |
| **standard** | Multi-file integration, new features touching ≥3 modules, tasks requiring reading multiple subsystems — or ANY task, regardless of diff size, hitting a judgment-risk class: (1) shell/git/environment semantics, where specs are often subtly wrong; (2) edits to test-pinned docs or strings, which require pin-hunting across files; (3) steps that anticipate deviation ("if X differs, do Y") or whose code the plan author could not run to verify |
| **most-capable** | Spec/code review passes, architectural design decisions, resolving ambiguous or conflicting requirements, fix-round re-dispatches |

New assignment sentence (replaces "Assign tier at task-dispatch time based on estimated scope."):

> Assign tier at task-dispatch time by estimated scope AND judgment-likelihood — realized difficulty tracks spec risk, not diff size (issue #20: the three heaviest implementations in run wf_df7eefdb-7b1 were all cheap-tier, and exactly the three that drew reviewer notes).

- [ ] **Step 2: Update the Step-2 pointer in SKILL.md**

In `skills/ultrapowers/SKILL.md`, the Step-2 bullet "**Assign a model tier** per task (`cheap` / `standard` / `most-capable`) by estimated scope, per `references/reviewer-prompts.md`." becomes "… by estimated scope **and judgment-likelihood** (the risk classes in `references/reviewer-prompts.md` bump small-diff tasks to `standard`)."

Also run `grep -rn "estimated scope" skills/ultrapowers/` and update any other occurrence to the same combined wording (dependency-analysis.md may carry one).

- [ ] **Step 3: Run the suites**

Run: `python3 -m pytest tests/ -q && node tests/sim_workflow.mjs`
Expected: green. `tests/test_no_prompt_drift.py` must pass UNCHANGED — if it fails, a BAKE block was touched; revert that hunk (the tier table is not baked). If a doc-pinning test (`test_report_runbook.py`, `test_validate_skill.py`) asserts the old "estimated scope" phrasing, update the pin to the new phrasing in this commit.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/SKILL.md
git commit -m "docs: tier assignment by judgment-likelihood, not just scope (#20)"
```

(Include any pin-updated test files in the same commit.)

---

### Task 2: scripts/audit_run.py — post-run effort audit

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/scripts/audit_run.py`
- Test: `tests/test_audit_run.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_audit_run.py`:

```python
"""audit_run.py: deterministic post-run effort audit (issue #20).
Synthetic fixture transcripts — no engine dependency; if the real engine's
layout drifts, the script degrades to its advisory diagnostic."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
AUDIT = ROOT / "skills/ultrapowers/scripts/audit_run.py"

IMPL_7 = ("SAFETY: Operate ONLY inside the git worktree assigned to you.\n\n"
          "You are an implementer subagent operating inside a dedicated git worktree.\n\n"
          "TASK:\n### Task 7: fix the sweep\nbody\n")
IMPL_9 = IMPL_7.replace("### Task 7: fix the sweep", "### Task 9: docs sweep")
IMPL_1 = IMPL_7.replace("### Task 7: fix the sweep", "### Task 1: small fix")
REVIEW_7 = ("SAFETY: ...\n\nYou are an independent reviewer. You receive the original task text.\n\n"
            "### Task 7: fix the sweep\n")
MERGE = "SAFETY: ...\n\nYou are the wave merge agent, operating on the session repo main checkout.\n"


def agent_file(d, name, first_user, model, turns, tokens_each=10):
    lines = [json.dumps({"type": "user",
                         "message": {"content": [{"type": "text", "text": first_user}]}}),
             "not json {{{"]                      # malformed line: must be skipped
    for _ in range(turns):
        lines.append(json.dumps({"type": "assistant",
                                 "message": {"model": model,
                                             "usage": {"output_tokens": tokens_each}}}))
    (d / f"agent-{name}.jsonl").write_text("\n".join(lines) + "\n")


def run_audit(target):
    return subprocess.run([sys.executable, str(AUDIT), str(target)],
                          capture_output=True, text=True)


def test_classifies_roles_and_sums_effort(tmp_path):
    agent_file(tmp_path, "a1", IMPL_7, "test-model", turns=3)
    agent_file(tmp_path, "a2", REVIEW_7, "judge-model", turns=2)
    agent_file(tmp_path, "a3", MERGE, "test-model", turns=1)
    p = run_audit(tmp_path)
    assert p.returncode == 0, p.stderr
    assert "| impl:7 | test-model | 3 | 30 |" in p.stdout
    assert "| review:7 | judge-model | 2 | 20 |" in p.stdout
    assert "| merge | test-model | 1 | 10 |" in p.stdout


def test_flags_misrank_candidate_above_1_5x_same_model_median(tmp_path):
    agent_file(tmp_path, "a1", IMPL_1, "model-x", turns=10)
    agent_file(tmp_path, "a2", IMPL_9, "model-x", turns=10)
    agent_file(tmp_path, "a3", IMPL_7, "model-x", turns=40)   # 4x the median
    p = run_audit(tmp_path)
    assert "Tier-misrank candidates" in p.stdout
    assert "impl:7" in p.stdout.split("Tier-misrank candidates")[1]


def test_no_flagging_under_two_same_model_samples(tmp_path):
    agent_file(tmp_path, "a1", IMPL_7, "model-x", turns=40)
    agent_file(tmp_path, "a2", IMPL_9, "model-y", turns=10)
    p = run_audit(tmp_path)
    assert "No tier-misrank candidates" in p.stdout


def test_missing_dir_is_advisory_exit_zero(tmp_path):
    p = run_audit(tmp_path / "does-not-exist")
    assert p.returncode == 0
    assert "nothing to audit" in p.stdout


def test_empty_dir_is_advisory_exit_zero(tmp_path):
    p = run_audit(tmp_path)
    assert p.returncode == 0
    assert "nothing to audit" in p.stdout


def test_unrecognized_prompt_counts_as_unknown(tmp_path):
    agent_file(tmp_path, "a1", "Some future prompt shape", "m", turns=1)
    p = run_audit(tmp_path)
    assert p.returncode == 0
    assert "| unknown | m | 1 | 10 |" in p.stdout
    assert "unclassified" in p.stdout
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_audit_run.py -q`
Expected: every test FAILS (script does not exist).

- [ ] **Step 3: Implement the script**

Create `skills/ultrapowers/scripts/audit_run.py`:

```python
#!/usr/bin/env python3
"""Post-run effort audit for ultrapowers workflow transcripts (issue #20).

Reads the engine's per-run transcript directory (the "Transcript dir:" path
printed at Workflow launch), classifies each agent-*.jsonl by role from the
stable baked-prompt phrases, sums assistant turns and output tokens, and
prints a markdown effort table plus tier-misrank candidates: implementers
above 1.5x the median turns of SAME-MODEL peers (transcripts carry resolved
model strings, not tier names — grouping by model stays correct under
tierOverrides remapping).

ADVISORY BY CONTRACT: a missing directory, no agent files, or a drifted
layout prints one diagnostic and exits 0 — this script must never block the
Step-5 gate. Read-only: it writes nothing.
"""
from __future__ import annotations

import json
import re
import statistics
import sys
from pathlib import Path

TASK_HEAD = re.compile(r"### Task ([A-Za-z0-9]+):")
# First phrases of the baked prompts (reviewer-prompts.md / wave-merge.md).
# tests/test_no_prompt_drift.py pins those sources into workflow.js, so the
# classifier inherits their stability; an unmatched prompt degrades to
# "unknown", never to an error.
ROLE_MARKERS = [
    ("You are an implementer subagent", "impl"),
    ("You are an independent reviewer", "review"),
    ("You are the setup agent", "setup"),
    ("You are the wave merge agent", "merge"),
    ("You are the reconciliation agent", "reconcile"),
    ("What plan requirement is unmet?", "integration"),
]


def first_user_text(path):
    for line in path.read_text().splitlines():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if d.get("type") != "user":
            continue
        c = d.get("message", {}).get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            for block in c:
                if isinstance(block, dict) and block.get("type") == "text":
                    return block.get("text", "")
    return ""


def classify(text):
    for marker, role in ROLE_MARKERS:
        if marker in text:
            if role in ("impl", "review"):
                m = TASK_HEAD.search(text)
                return role + ":" + (m.group(1) if m else "?")
            return role
    return "unknown"


def collect(path):
    model, turns, out_tokens = "?", 0, 0
    for line in path.read_text().splitlines():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if d.get("type") != "assistant":
            continue
        turns += 1
        msg = d.get("message", {})
        model = msg.get("model", model)
        out_tokens += (msg.get("usage") or {}).get("output_tokens", 0) or 0
    return model, turns, out_tokens


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: audit_run.py <transcript-dir>  (advisory tool — exits 0 regardless)")
        return 0
    root = Path(argv[0])
    files = sorted(root.glob("agent-*.jsonl")) if root.is_dir() else []
    if not files:
        print(f"audit_run: no agent-*.jsonl under {root} — transcript dir missing "
              "or engine layout drifted; nothing to audit.")
        return 0

    rows = []
    for f in files:
        role = classify(first_user_text(f))
        model, turns, out_tokens = collect(f)
        rows.append((role, model, turns, out_tokens))
    rows.sort(key=lambda r: -r[2])

    print("| role | model | turns | output tokens |")
    print("|---|---|---:|---:|")
    for role, model, turns, out_tokens in rows:
        print(f"| {role} | {model} | {turns} | {out_tokens} |")

    unknown = sum(1 for r in rows if r[0] == "unknown")
    if unknown:
        print(f"\n{unknown} agent file(s) unclassified — baked-prompt phrases may have drifted.")

    impls = [r for r in rows if r[0].startswith("impl:")]
    by_model = {}
    for r in impls:
        by_model.setdefault(r[1], []).append(r)
    flagged = []
    for group in by_model.values():
        if len(group) < 2:
            continue  # single-sample noise: never flag a lone task
        med = statistics.median(r[2] for r in group)
        flagged.extend(r for r in group if med and r[2] > 1.5 * med)
    if flagged:
        print("\n**Tier-misrank candidates** (turns > 1.5x median of same-model implementers):")
        for role, model, turns, _ in sorted(flagged, key=lambda r: -r[2]):
            print(f"- {role} on {model}: {turns} turns — consider a higher tier for tasks like this")
    else:
        print("\nNo tier-misrank candidates (no implementer exceeded 1.5x its same-model median).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests, then the full suite**

Run: `python3 -m pytest tests/test_audit_run.py -q && python3 -m pytest tests/ -q && node tests/sim_workflow.mjs`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/audit_run.py tests/test_audit_run.py
git commit -m "feat: post-run effort audit script with tier-misrank flagging (#20)"
```

---

### Task 3: Wire the audit into the Step-5 gate docs

**Type:** implementation
**Depends-on:** 1, 2

(Why these edges: 1 also edits `skills/ultrapowers/SKILL.md`; 2 creates the script this task documents — `validate_skill.py` checks reference integrity, so the script must exist when this task's worktree is cut.)

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`

- [ ] **Step 1: Add the optional audit bullet to SKILL.md Step 5**

In `skills/ultrapowers/SKILL.md`, Step 5 begins with the checkout-restore paragraph ("**First, restore the session checkout.** …"). Immediately after that paragraph, add:

> **Optionally, audit the run's effort** (recommended after any sizable run): run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/audit_run.py <transcript-dir>` — the transcript directory is printed in the Workflow launch result ("Transcript dir:"). Include its effort table when presenting the report; flagged tier-misrank candidates feed the NEXT plan's tier assignments. The script is advisory by contract (read-only, exits 0 even when the engine's transcript layout has drifted) — never treat its absence of output as a gate failure.

- [ ] **Step 2: Add the Effort audit section to report-format.md**

In `skills/ultrapowers/references/report-format.md`, in the human-facing presentation order (after the post-merge runbook item), add:

> **Effort audit (optional):** the per-agent markdown table from `scripts/audit_run.py` — role, model, turns, output tokens, and any tier-misrank candidates (implementers above 1.5x the median turns of same-model peers). Advisory only: it informs the next run's tier assignments and never gates this one.

- [ ] **Step 3: Run the suites and commit**

Run: `python3 -m pytest tests/ -q && node tests/sim_workflow.mjs`
Expected: green (`validate_skill.py` via `test_validate_skill.py` confirms the new script reference resolves; update any presentation-order pin the suite flags).

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md
git commit -m "docs: wire the effort audit into the Step-5 gate and report format (#20)"
```

---

### Task 4: Full-suite verification gate

**Type:** gate
**Depends-on:** 1, 2, 3

Run and require green:

- `python3 -m pytest tests/ -q` — exit 0, no failures.
- `node tests/sim_workflow.mjs` — every scenario prints OK, exit 0.
- `git status` — clean tree.

---

### Task 5: Release 0.0.8

**Type:** release
**Depends-on:** 4

After the integration branch merges to main:

- [ ] Bump `"version"` to `0.0.8` in `.claude-plugin/plugin.json` AND `.claude-plugin/marketplace.json` (both must agree — plugin.json wins silently).
- [ ] Commit: `release: 0.0.8 — judgment-risk tier criteria + post-run effort audit`
- [ ] `git push origin main`

---

### Task 6: Close issue 20

**Type:** manual
**Depends-on:** 5

Owner/orchestrator action with `gh` after 0.0.8 is pushed. (Deliberately NOT a PR-body closing keyword — prose like that auto-closed an issue with the wrong state reason once already.)

- [ ] Comment on and close issue 20 as completed: name the fixing commits, note "shipped in 0.0.8", and point at issue 21 as the recorded follow-up (plan-marker tier hints, gated on audit data from 2+ runs).
