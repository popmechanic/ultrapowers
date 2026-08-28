# One Driver Phase 0b — The Two Texts (#371) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the text half of One Driver Phase 0 (spec §Delivery shape "P0b"): rewrite `skills/ultrapowers/SKILL.md` to the §Client/§Engine shape at ≤ 1,000 words, add the one mechanism (`ULTRAPOWERS_FLEET_RUN` set by the fleet shim, the `RUN_LOCK` read gone), and make every client-facing text say plainly that ultrapowers runs on an exe.dev fleet with no local engine.

**Architecture:** Three file-disjoint `implementation` tasks in one wave. Task 4 owns the ultrapowers skill text and its reference trims plus the three Python pins that read that text. Task 5 owns `fleet/shim-main.mjs` and the two shim sims it touches. Task 6 owns every other client-facing text (routing hook, ultraplan, ultradocket, README, both manifests, CLAUDE.md) and the new product-statement pin. Nothing under `skills/ultrapowers/scripts/`, `harnesses/`, `viewer/`, `agents/`, `evals/`, or `skills/ultradocket/scripts/` is edited — those belong to the sibling plan P0a (run A). The engine loop (`waves.js`, `kernel/`, `wave-merge.md`, `reviewer-prompts.md`, `workflow-template.md`) is not edited (spec "Not trimmed this phase").

**Tech Stack:** Markdown/JSON prose, bash (SessionStart hook), Node ESM (`fleet/shim-main.mjs` + `.mjs` sims), Python/pytest pins.

**Spec:** `docs/superpowers/specs/2026-08-28-one-driver-phase-0.md` (§mechanism, §Client-facing text, deletion ledger rows 1, 3, 4, 5, 6, 7, 8, 10, "Not trimmed"/"Trimmed" lists, §Delivery shape P0b). Inputs: `docs/superpowers/specs/2026-08-28-one-driver-design-inputs.md` (Amendment 1 decision 6, Amendment 2). Ticket: #371.

**Acceptance:** suite — the committed suite plus the named per-task pins is the verification; the sibling fleet run C on the cut engine (spec bar row 5) is the integration check for both P0 plans and is not part of this plan.

Refs #371 (this plan does not close it — run C and the release do).

**Sequencing.** P0b is driven FIRST (fleet run B) and merges first; P0a (`docs/superpowers/plans/2026-08-28-one-driver-phase-0a-subtraction.md`, the script/agent/viewer subtraction) is driven on P0b's merged base. Consequence for every implementer here — do not "fix" it: on this branch the new `skills/ultrapowers/SKILL.md` and `skills/ultradocket/SKILL.md` name only scripts that P0a will delete later (`ultra_run.py`, `ultra_gate.py`, `finalize_report.py`, `gate_check.py`, `run_acceptance.sh`, `compile_plan.py` survive P0a; nothing else is named), and every script under `skills/ultrapowers/scripts/` still exists here, so `validate_skill.py` passes and the whole committed suite must be green on this branch alone. The only tests deleted here are the ones that pin prose this plan removes (Task 4: `tests/test_terminal_teardown.py`, `tests/test_skill_wf_run_record.py`; Task 6: `tests/test_async_sealing.py`).

## Global Constraints

- `skills/ultrapowers/SKILL.md` ≤ **1000** words by `wc -w` (spec bar row 1; `tests/test_skill_budget.py` pins the absolute at 1000 after Task 4).
- `hooks/session_start.sh` and `skills/ultraplan/SKILL.md` carry the execution-fit rubric **byte-identically** where `tests/test_recommendation_rubric.py` pins it (`SHARED_TOKENS`, `BRANCH_CLAUSES`, canonical order); only the option-1 sentence changes.
- Every `.mjs` sim keeps its exact success sentinel: `ALL TESTS PASSED` (`tests/test_fleet_suite.py` greps it; `run_acceptance.sh --suite-gate` accepts `ALL (SCENARIOS|TESTS) PASSED`). Each fleet sim finishes in under 120 s (`test_fleet_suite.py` timeout).
- Never edit `skills/ultrapowers/references/wave-merge.md`, `references/reviewer-prompts.md`, `references/workflow-template.md`, `harnesses/waves.js`, `kernel/**` — drift-pinned to the engine (spec "Not trimmed this phase"; a task that needs to is off-spec).
- Never edit anything under `skills/ultrapowers/scripts/`, `skills/ultrapowers/viewer/`, `agents/`, `evals/`, `skills/ultradocket/scripts/`, or a Python test for a deleted script — P0a owns those (spec §Delivery shape).
- Every deletion cites its spec deletion-ledger row in the commit message (`row N`).
- No new guard without a deletion in the same task (map #366 rule 5). The one mechanism added is the `ULTRAPOWERS_FLEET_RUN` env var; the `RUN_LOCK` read it replaces is deleted in the same task.
- The product sentinel phrase is exactly `runs on an exe.dev fleet` — present in README.md, `.claude-plugin/plugin.json` `description`, and `.claude-plugin/marketplace.json` `plugins[name=ultrapowers].description` (a pin, not a guard).

---

### Task 4: Rewrite `skills/ultrapowers/SKILL.md` to §Client/§Engine (≤ 1000 words) and trim its references

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/finishing-notes.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/references/design-rationale.md`
- Modify: `tests/test_skill_budget.py`
- Modify: `tests/test_report_runbook.py`
- Modify: `tests/test_finalize_wiring.py`
- Modify: `tests/test_terminal_teardown.py`
- Modify: `tests/test_skill_wf_run_record.py`
- Test: `tests/test_validate_skill.py`
- Test: `tests/test_skill_budget.py`
- Test: `tests/test_report_runbook.py`
- Test: `tests/test_finalize_wiring.py`
- Test: `tests/test_orchestrator_markers.py`
- Test: `tests/test_ultra_run_overlap.py`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (prose + pins only)

**Word budget — a hard number.** `skills/ultrapowers/SKILL.md` is 3,129 words today and must end at **≤ 1000 words** measured by `wc -w skills/ultrapowers/SKILL.md` (the pin in `tests/test_skill_budget.py` uses `len(text.split())`, identical to `wc -w`). Net delta over this task's diff: **≤ −2129 words**. The replacement text below measures **864 words**; if you deviate from it, re-measure with `wc -w` before every commit. The per-section budget the replacement is built to (verify each with `wc -w` on the section if you rewrite it): frontmatter 45 · opening rule 50 · §Client 200 · §Engine step 1 95 · step 2 120 · step 3 55 · step 4 100 · step 5 + two-move rule 190 · Resources 70 = 925 max.

**What the rewrite removes, and the ledger row that licenses each (spec deletion ledger):** Step 1's `lock`/`engine-skew`/`worktree-audit`/`disk-headroom` stage names (rows 1, 2, 5, 11 — the surviving `ultra_run.py` stages are exactly `fleet-run`, `git-repo`, `worktree-probe`, `superpowers-compat`, `compile`, `test-command`, `install`, `dirty-baseline`, `base-branch`); Step 4a½ engine probe (row 5); `record_wf_run.py` (row 2); the viewer offer (row 8); the standing-grant grammar (row 6 → the two-move rule); the review-exhaust `rm`, resume-gate manifest, residual manifest, hygiene check, sweep set, `--teardown`, `RUN_LOCK` (rows 1, 2, 3); Salvage / Redirect / After-PASS batching / round artifacts (row 4); Step 6 sequential fallback (row 10); the sealed vouching rubric (row 7 — a `sealed` disposition is `BLOCKED` at the gate).

**Pins that read this file and must stay green (read each before editing):** `tests/test_orchestrator_markers.py` needs the literal `` `meta.name` `` and the words `not found`; `tests/test_ultra_run_overlap.py::test_skill_md_references_fold_log` needs `kernel/FOLD_LOG.md`; `tests/test_skill_budget.py` (you set it to 1000); `tests/test_finalize_wiring.py` and `tests/test_report_runbook.py` pin the OLD step layout and are rewritten in this task (below). **Two pins are deleted in this task** (the `Modify:` label is the Files grammar's only spelling for a deletion): `tests/test_terminal_teardown.py` pins the Step 5 lock-release / `--teardown` prose (row 1) and `tests/test_skill_wf_run_record.py` pins the `record_wf_run.py` call in Step 4 (row 2) — both would be red on this branch the moment the prose goes, and they are containment pins on text, not tests of a script (the scripts themselves are P0a's). `validate_skill.py` resolves every `references/…`, `scripts/…`, `kernel/…` mention against the skill dir — every script named still exists on this branch (P0a runs after P0b), and the six in Resources also survive P0a (spec "Kept, and why").

- [ ] **Step 1: Baseline the ratchet and pin the new ceiling first (red)**

Run: `wc -w skills/ultrapowers/SKILL.md && python3 -m pytest tests/test_skill_budget.py -q`
Expected: `3129`, and 1 passed.

Edit `tests/test_skill_budget.py` `CEILINGS` — only the ultrapowers line changes (ultraplan's N is unchanged; the ratchet lowers it at release):

```python
CEILINGS = {
    "skills/ultrapowers/SKILL.md": 1000,  # set 2026-08-28 (One Driver Phase 0, #371 bar row 1)
    "skills/ultraplan/SKILL.md": 3569,    # set 2026-08-26 (0.2.23 slate, incl. #248 delta bullet)
}
```

Run: `python3 -m pytest tests/test_skill_budget.py -q`
Expected: FAIL — `skills/ultrapowers/SKILL.md is 3129 words, over its pinned ceiling 1000`.

- [ ] **Step 2: Replace `skills/ultrapowers/SKILL.md` wholesale with this text**

Write the file with exactly this content (frontmatter kept: `allowed-tools` still needs `Workflow` — the sandbox session launches the saved workflow):

````markdown
---
name: ultrapowers
description: Use when the user runs "/ultrapowers <plan-path>", asks to "execute this plan", "go ultra", or wants an approved Superpowers plan built autonomously in parallel waves — on the exe.dev fleet, never on this machine.
argument-hint: <plan-path>
allowed-tools: Workflow Skill Read Grep Glob Bash
---

# Ultrapowers

**Read one variable first.** `ULTRAPOWERS_FLEET_RUN` set → you are the engine
session inside a fleet sandbox: run §Engine. Unset → you are the client on the
operator's machine: run §Client. There is no third mode: nothing in this skill
runs a plan locally, and `ultra_run.py` refuses to (its `fleet-run` stage).

## Client (`ULTRAPOWERS_FLEET_RUN` unset)

Selecting ultrapowers at the planning handoff, or invoking `/ultrapowers` on an
approved plan, **is** the authorization to execute — no further approval pause.

1. **Commit the plan and push it.** Bring the orchestrator's clone to that ref
   (`fleet/RUNBOOK.md` §Live W1 run): `drive-one` pushes the run's base from
   that checkout, and the fitness preflight reads the plan at that ref — never
   from your working tree.
2. **Launch** on the orchestrator with a fresh `run-<N>` (run IDs are never
   reused):

   ```bash
   ssh -n fleet-orchestrator.exe.xyz 'cd /home/exedev/repo && nohup node fleet/drive-one.mjs <plan-path> run-<N> </dev/null >/tmp/drive-run-<N>.out 2>&1 &'
   ```

3. **Watch** the drive log (`ssh fleet-orchestrator.exe.xyz 'tail -f /tmp/drive-run-<N>.out'`)
   or the orchestrator store.
4. **Read the receipt in the PR the orchestrator opens.** Gate-green → a ready
   PR. Parked → a draft PR carrying the gate receipt: acknowledge by marking it
   ready, or re-drive a narrower plan. The laptop never fetches a run branch.

Nothing runs here and there is no local fallback: without the fleet, say so
and stop.

## Engine (`ULTRAPOWERS_FLEET_RUN` set)

You are headless — no operator until the run ends. Never end a turn on a
question or to wait; poll the workflow in-turn until it completes. The sandbox
is disposable: nothing you leave behind matters.

**1. Preflight and compile (deterministic).**

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_run.py <plan> --stamp <stamp> [--test-cmd …] [--bootstrap-cmd …] [--overlap serialize|fold]
```

One call runs every stage fail-closed, in order: `fleet-run`, `git-repo`,
`worktree-probe`, `superpowers-compat`, `compile`, `test-command`, `install`,
`dirty-baseline`, `base-branch`. It writes
`.claude/ultrapowers/run-<stamp>/receipt.json`. Exit 0 → read the receipt and
continue. Non-zero → the last stage names the failure and the run ends here
(no gate receipt reads red, never green).

**2. Judge and fill (LLM-owned).** Adopt the compiler's JSON verbatim
(`receipt.compile`: waves, edges, dispositions); judge only `"heuristic": true`
entries. `waves: []` → nothing to launch; end. Fill the `null` slots in
`receipt.argsFile`: per-task `tier` (`standard`/`most-capable`, by scope and
judgment-likelihood — review agents stay `most-capable` by design) and, for
polyglot plans only, per-task `testCmd`. Run-wide `testCmd`, `bootstrapCmd` and
`baseBranch` come from the receipt. Review depth is plan-authored
(`**Review:**`); never set `task.review`. Then run
`ultra_run.py --validate-knobs <argsFile>`: exit 3 means the baseline is red on
the base ref — launch only if a plan note pre-authorizes the repair, else end.

**3. Render** the interpretation (it reappears with the report): waves, the
edges that shaped them, mode, derived knobs, expected contention
(`declared-commutative` / `composition-unpinned`), dispositions
(`marker_conflicts` grouped by `kind`; `allHeuristic: true` → say
`0 markers — all dispositions inferred`), and the acceptance disposition. No
pause.

**4. Launch** the saved workflow by `meta.name` (`receipt.workflowName` =
`ultrapowers-run`) via the Workflow tool — never author or edit a workflow:

```
args = { ...argsFile, integrationBranch: 'ultra/integration-<stamp>', stamp, baseBranch, reviewProfile? }
```

Always pass `args.edges` — without it dependency blocking is silently off. A
`Workflow "ultrapowers-run" not found` launch means the SessionStart hook did
not install it: fail the run (no receipt → red) rather than improvise. The
headless workflow creates the integration branch in its own worktree, runs,
merges and reconciles each wave, then reviews completeness
(`references/wave-merge.md`; contended-wave fold state: `kernel/FOLD_LOG.md`).

**5. Gate.** Save the Workflow tool's raw result JSON verbatim, then:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/finalize_report.py --report <saved-result.json> --repo . --branch <integrationBranch>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_gate.py --stamp <stamp> --result <saved-result.json>
```

A non-zero `finalize_report.py` is a pre-gate failure: do not run the gate.
`ultra_gate.py` runs `gate_check.py` and administers acceptance (`suite`, or the
verbatim waiver; a `sealed` disposition is `BLOCKED`). Its **exit code is the
authority**; `run-<stamp>/gate-receipt.json` is the record.

**The two-move rule** on the verdict:

- **PASS (exit 0)** → approve.
- **NEEDS_ACK (exit 2)** → approve **iff every** ack is a `deferredVerification`
  item with reason `runtime` or `external`. Write
  `run-<stamp>/standing-approval.json` **first**:
  `{"grantedAt": "launch directive", "instruction": "<the launch directive, verbatim>", "ackList": [...]}`.
  A `manual` task is runbook material, never an ack to consume.
- **Anything else** (BLOCKED, any other ack) → leave the gate receipt as the
  terminal artifact and end the session.

Approve = `ultra_gate.py --approve --stamp <stamp>` (it checks out the
integration branch and re-verifies tests) **and save its JSON output verbatim
to `run-<stamp>/approve-receipt.json`** — the fleet shim greens the run only on
that receipt with a matching stamp. Then end. Say nothing the receipts do not:
quote `verdict`, each failing check's `name`/`detail`, and the acceptance exit
verbatim (`references/report-format.md`). The orchestrator publishes the
branch, the receipts and the PR — you never push.

## Resources

- `references/design-rationale.md` — why each surviving guard exists.
- `references/dependency-analysis.md`, `references/plan-markers.md` — plan → waves.
- `references/reviewer-prompts.md`, `references/wave-merge.md` — the prompts baked into `waves.js`.
- `references/report-format.md`, `references/finishing-notes.md` — report schema; finishing checks.
- `scripts/ultra_run.py`, `scripts/ultra_gate.py`, `scripts/finalize_report.py`,
  `scripts/gate_check.py`, `scripts/run_acceptance.sh`, `scripts/compile_plan.py`.
````

Run: `wc -w skills/ultrapowers/SKILL.md && python3 -m pytest tests/test_skill_budget.py -q && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: a count ≤ 1000 (864 as written), 1 passed, validator silent with exit 0.

- [ ] **Step 3: Repoint the two pins that read the old step layout**

`tests/test_finalize_wiring.py` locates a `## Step 5` heading; the gate now lives under `## Engine`. Replace `_step_5_body` and the three test names/messages so the SAME ordering assertion (finalize before gate, both present) is made over the `## Engine` section:

```python
def _engine_body(text):
    """Return the SKILL.md text spanning '## Engine' up to (not including)
    the next top-level '## ' heading — the sandbox session's gate lives there."""
    m = re.search(r"^## Engine.*$", text, flags=re.MULTILINE)
    assert m, "skills/ultrapowers/SKILL.md has no '## Engine' heading"
    start = m.end()
    nxt = re.search(r"^## ", text[start:], flags=re.MULTILINE)
    end = start + nxt.start() if nxt else len(text)
    return text[start:end]


def _assert_finalize_precedes_gate(text):
    finalize_idx = text.find(FINALIZE_NEEDLE)
    gate_idx = text.find(GATE_NEEDLE)
    assert finalize_idx != -1, "finalize_report.py invocation not found in §Engine"
    assert gate_idx != -1, "ultra_gate.py invocation not found in §Engine"
    assert finalize_idx < gate_idx, (
        "finalize_report.py must be invoked BEFORE ultra_gate.py in §Engine -- "
        f"finalize at index {finalize_idx}, gate at index {gate_idx}"
    )


def test_engine_invokes_finalize_report():
    assert FINALIZE_NEEDLE in _engine_body(SKILL.read_text())


def test_engine_invokes_ultra_gate():
    assert GATE_NEEDLE in _engine_body(SKILL.read_text())


def test_finalize_report_precedes_ultra_gate_in_engine():
    _assert_finalize_precedes_gate(_engine_body(SKILL.read_text()))
```

Update the module docstring's first line to `"""Pin: SKILL.md's §Engine (the sandbox gate) must invoke finalize_report.py BEFORE ultra_gate.py, in that same section.` — the rest stays.

Delete the two prose pins whose text this task removes (rows 1, 2): `git rm tests/test_terminal_teardown.py tests/test_skill_wf_run_record.py`.

`tests/test_report_runbook.py::test_skill_has_skew_preflight_probe_roundtrip_and_schema_degrade` asserts `engine skew` and `round-trip`/`echoWaves` in SKILL.md — both deleted (row 5). Replace that one function (the other two tests in the file are untouched):

```python
def test_gate_owns_merge_sha_guard_and_report_format_documents_wavemerges():
    # The merge-sha guard lives in the gate script — gate_check.py emits the
    # literal and its exit code is the authority (never SKILL.md prose).
    assert "merge-sha guard unavailable" in (ROOT / "skills/ultrapowers/scripts/gate_check.py").read_text()
    fmt = REPORT.read_text()
    assert "waveMerges" in fmt and ("may be empty" in fmt or "missing" in fmt)
```

Run: `python3 -m pytest tests/test_finalize_wiring.py tests/test_report_runbook.py tests/test_orchestrator_markers.py tests/test_ultra_run_overlap.py tests/test_skill_budget.py -q`
Expected: all passed.

- [ ] **Step 4: Trim `references/finishing-notes.md` (rows 3, 7)**

1. Delete the entire `## Residual manifest` section — from the `## Residual manifest` heading through the paragraph ending `runs solely at run close and drain-entry close.` (immediately before `## Shipped SHA ≠ gate-verified SHA`). Row 3.
2. In `## Shipped SHA ≠ gate-verified SHA`, replace `AND the plan's acceptance per its disposition (the sealed exam for `sealed` plans, the suite gate for `suite`) on the rebuilt tree` with `AND the plan's suite gate on the rebuilt tree`. Row 7.

- [ ] **Step 5: Trim `references/report-format.md` (rows 3, 4, 6, 7, 8)**

Anchors are the current line texts; replace exactly these:

1. Field reference, `acceptance` row: replace the sentence `{ mode: 'sealed', sealId, sha256, status: 'PENDING_GATE', passed: null, note } — the workflow does NOT administer the sealed exam (it has no shell; relaying the runner's JSON corrupts it, #36). The exam is administered deterministically at the Step 5 gate, where `run_acceptance.sh`'s exit code decides Approve and its JSON is rendered as receipts.` with `{ mode: 'sealed', … , status: 'PENDING_GATE', passed: null }` is still emitted for a `sealed` line (frozen compiler vocabulary) but the gate reports it `BLOCKED` — sealed acceptance is not administered (One Driver Phase 0, row 7).` Row 7.
2. Delete the paragraph `The three finding-family arrays — `completenessFindings`, `judgmentCalls`, `deferredVerification` — feed the residual manifest at finishing (derive + disposition contract: `finishing-notes.md` §Residual manifest).` Row 3.
3. Presentation item 9a: delete the trailing sentence `After merge, finishing consumes this array via the residual manifest — see finishing-notes.md §Residual manifest.` Row 3.
4. Delete presentation item 12 (`**Live viewer (optional):** …`) in full. Row 8.
5. Replace the paragraph `This pre-merge review is the **second and final gate** … asks the human to choose:` with `This pre-merge review is the **second and final gate** (after plan approval; the wave plan is rendered for transparency but does not pause for approval). After the summary the session applies the two-move rule:`.
6. Replace the whole `- **Approve** — …` bullet with (row 6 — this is the canonical rendering clause, rewritten to the two-move rule):

```markdown
- **Approve** — the two-move rule (`SKILL.md` §Engine step 5 is the executable form; the fleet's launch directive is the standing instruction). `PASS` → approve. `NEEDS_ACK` → approve iff every ack is a `deferredVerification` item with reason `runtime` or `external`, and only after writing `run-<stamp>/standing-approval.json` (`{grantedAt, instruction, ackList}`, the launch directive verbatim as `instruction`) FIRST — the rendered gate presentation lists the same ack list and instruction, so the transcript and the disk agree. Anything else (`BLOCKED`, any other ack type, a `coverage.complete: false`) → do not approve; the gate receipt is the terminal artifact. Approve runs `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/ultra_gate.py --approve --stamp <stamp>` (checkout of the integration branch + re-verified tests) and saves its JSON output verbatim to `run-<stamp>/approve-receipt.json`; the fleet shim's `readGateGreen` greens the run only on that receipt with a matching stamp. The orchestrator publishes the branch and opens the PR — the session never pushes and never hands off to `superpowers:finishing-a-development-branch` (superpowers does not run in a sandbox); the post-merge runbook rides in the PR body.
```

7. Delete the `- **Salvage** — …` and `- **Redirect** — …` bullets in full. Row 4.

Run: `python3 -m pytest tests/test_report_runbook.py -q` — Expected: all passed (the frontier-field and reviewVerdict pins read the untouched field table).

- [ ] **Step 6: Trim `references/design-rationale.md` (rows 4, 5, 7, 10)**

Delete or edit exactly these sections (by their `## §` headings):

1. Delete `## § Step 1 — Self-host skew` in full (row 5: the `engine-skew` stage and `check_engine_skew.sh` are gone).
2. In `## § Step 4 — Determinism guard and the read/write boundary`, replace the quote-block sentence `If it cannot be launched, diagnose with the Step 4a½ preflight before falling back — a freshly installed-this-session copy that the engine cannot yet see is a stale registry (cured by a new session), **not** the engine drift that Step 6 exists for.` with `If it cannot be launched, the run fails (no receipt → red) — never a fallback, never an improvised script.` (rows 5, 10). Keep the rest of the section.
3. In `## § Step 4a — Saved-workflow registry snapshot`: replace `(the manual Step-4a install)` with `(`ultra_run.py`'s `install` stage)`, replace `Workflow "ultrapowers-probe" not found` with `Workflow "ultrapowers-run" not found`, and replace `even though Step 4a had just copied the file` with `even though the install stage had just copied the file` (row 5). Keep the section.
4. Delete `## § Step 4a½ — Args-probe payload-drop history` in full (row 5).
5. In `## § Step 5 — Verdict independence from checkout position (#84)`, replace `(`run_acceptance.sh` does this for the sealed exam and the suite gate alike — see § Step 5 — Why sealed exams are administered at the gate)` with `(`run_acceptance.sh --suite-gate` does this)` (row 7).
6. Delete `## § Step 5 — Why sealed exams are administered at the gate (#36)` in full (row 7).
7. In `## § Dependency inference — the mixed-B-2 eval war story`, delete the sentence `The same run motivated the **Salvage** path, which pulls a failed/blocked branch's already-correct work in rather than reimplementing it.` (row 4).
8. Delete `## § Step 3 — Acceptance vouching (why the rubric needs no code-reading)` in full, including its `**2026-07-03 field evidence**` paragraph (row 7).

Leave every `---` separator between surviving sections; remove the ones that bracketed a deleted section so no two separators are adjacent.

- [ ] **Step 7: Prove nothing stale survives, then run the task gate**

Run:

```bash
grep -nE "sweep_worktrees|run_lock|RUN_LOCK|hygiene_check|residual_manifest|residual manifest|salvage_args|redirect_args|Salvage|Redirect|record_wf_run|serve_viewer|swarm|4a½|Step 6|collect_seal|seal_hash|seal-author|engine-skew|engine skew|ultrapowers-probe|wf-runs|--teardown|disk-headroom" skills/ultrapowers/SKILL.md skills/ultrapowers/references/finishing-notes.md skills/ultrapowers/references/report-format.md skills/ultrapowers/references/design-rationale.md
```

Expected: no output (exit 1). Any hit is a missed trim — fix it.

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 -m pytest tests/test_validate_skill.py tests/test_skill_budget.py tests/test_finalize_wiring.py tests/test_report_runbook.py tests/test_no_prompt_drift.py tests/test_orchestrator_markers.py tests/test_ultra_run_overlap.py -q && wc -w skills/ultrapowers/SKILL.md`
Expected: validator exit 0, all passed, word count ≤ 1000. Then the whole suite on this branch: `python3 -m pytest -q` — Expected: green (every script is still present here; only the two deleted prose pins are gone from the collection).

- [ ] **Step 8: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/finishing-notes.md skills/ultrapowers/references/report-format.md skills/ultrapowers/references/design-rationale.md tests/test_skill_budget.py tests/test_report_runbook.py tests/test_finalize_wiring.py
git rm -q tests/test_terminal_teardown.py tests/test_skill_wf_run_record.py
git commit -m "skill: ultrapowers SKILL.md → §Client/§Engine at ≤1000 words; reference trims; lock/wf-run prose pins deleted (Phase 0 rows 1–8, 10, 11; #371)"
```

---

### Task 5: The shim sets `ULTRAPOWERS_FLEET_RUN`; `readGateGreen` drops the `RUN_LOCK` read

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `fleet/shim-main.mjs`
- Modify: `fleet/tests/test_shim_main_gate.mjs`
- Modify: `fleet/tests/test_drive_lifecycle.mjs`
- Test: `fleet/tests/test_shim_main_gate.mjs`
- Test: `fleet/tests/test_drive_lifecycle.mjs`
- Test: `fleet/tests/test_shim_main_publish.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `engineProcessEnv(runId: string): NodeJS.ProcessEnv`; `spawnEngineProcess({ command, args, cwd, runId }): Promise<number>`; `invokeEngineRun({ repoDir, planPath, sessionId, runId, exec?, spawnEngine?, log?, excludeDirs? }): Promise<{ gateGreen: boolean, error?: string }>` (new required `runId`; `spawnEngine` is now called with `{ command, args, cwd, runId }`)

**The mechanism (spec §"The one mechanism this phase adds").** The engine process spawned by the sandbox shim gets `ULTRAPOWERS_FLEET_RUN=<runId>` in its environment: `skills/ultrapowers/SKILL.md` branches on it (§Engine vs §Client) and `ultra_run.py`'s new `fleet-run` stage (P0a) refuses when it is unset. The variable is set here and nowhere else. In the same task the shim stops reading `RUN_LOCK` in `readGateGreen` (row 1 — `run_lock.sh` is deleted by P0a, so the file the leg reads would never exist; legs 1–3 stay byte-for-byte). Between the two merges a sandbox run refuses at preflight — the fail-closed direction (spec §Delivery shape); merge P0b first or together.

**Where `runId` is at the spawn.** `main()` destructures `{ runId, token, wsUrl, ttlMs }` from `readAssignment(...)` and binds `invokeRun: invokeRun ?? (() => invokeEngineRun({ repoDir, planPath, sessionId, exec, excludeDirs: preRunDirs }))`. `invokeEngineRun` calls `spawnEngine({ command: ENGINE_COMMAND, args: engineArgs(planPath, sessionId), cwd: repoDir })`, defaulting to `spawnEngineProcess`. Thread `runId` through those three points. The `test_shim_main_publish.mjs` `runMain` helper already writes `runId` into the assignment, so the default binding keeps its `checkout fleet-base` assertion.

- [ ] **Step 1: Write the failing scenario (replaces scenarios 12–13)**

In `fleet/tests/test_shim_main_gate.mjs`:

1. Header comment: replace the leg-3 text `approve-receipt.json    — the approve actually RAN (mode: 'approve', matching stamp), and RUN_LOCK no longer names this run's stamp (the approve's own on-disk side effect: the lock release).` with `approve-receipt.json    — the approve actually RAN (mode: 'approve', matching stamp).` and append a line `//   The engine itself is spawned with ULTRAPOWERS_FLEET_RUN=<runId> (Phase 0 §mechanism) — pinned here too.`
2. Import: add `spawnEngineProcess,` and `invokeEngineRun,` to the `from '../shim-main.mjs'` import list.
3. `mkRun`: drop the `lock = null` parameter and the line `if (lock !== null) fs.writeFileSync(path.join(runDir, '..', 'RUN_LOCK'), lock)`.
4. Delete scenarios 12 (`RUN_LOCK still held by this stamp → approve never actually ran`) and 13 (`a different run's lock is not ours → still greens`) in full. Row 1.
5. In their place insert:

```js
// --- 12. the engine spawns with ULTRAPOWERS_FLEET_RUN=<runId> (Phase 0 §mechanism) --
{
  const t12 = tmp()
  delete process.env.ULTRAPOWERS_FLEET_RUN
  // (a) the real spawn seam sets the variable from runId — the child reads it back itself
  assert.equal(
    await spawnEngineProcess({ command: '/bin/sh', args: ['-c', 'test "$ULTRAPOWERS_FLEET_RUN" = "run-77"'], cwd: t12, runId: 'run-77' }),
    0,
  )
  // (b) the inherited env still rides beside it (the credential lives there, #213)
  process.env.FLEET_GATE_TEST_CANARY = 'canary'
  assert.equal(
    await spawnEngineProcess({ command: '/bin/sh', args: ['-c', 'test "$FLEET_GATE_TEST_CANARY" = canary -a "$ULTRAPOWERS_FLEET_RUN" = run-77'], cwd: t12, runId: 'run-77' }),
    0,
  )
  delete process.env.FLEET_GATE_TEST_CANARY
  // (c) invokeEngineRun threads the assignment's runId to the spawn seam
  const seen = []
  const outcome = await invokeEngineRun({
    repoDir: t12,
    planPath: 'docs/plan.md',
    runId: 'run-77',
    exec: async () => ({ code: 0, stdout: '' }),
    spawnEngine: async ({ runId }) => {
      seen.push(runId)
      return 1
    },
    log: () => {},
  })
  assert.deepEqual(seen, ['run-77'])
  assert.equal(outcome.gateGreen, false)
  // (d) no runId → refused before any checkout or spawn (fail-closed, like a missing planPath)
  const calls = []
  const refused = await invokeEngineRun({
    repoDir: t12,
    planPath: 'docs/plan.md',
    exec: async (cmd) => {
      calls.push(cmd)
      return { code: 0, stdout: '' }
    },
    spawnEngine: async () => {
      calls.push('spawn')
      return 0
    },
    log: () => {},
  })
  assert.deepEqual(refused, { gateGreen: false, error: 'missing runId' })
  assert.deepEqual(calls, [])
  ok('engine spawns with ULTRAPOWERS_FLEET_RUN=<runId>; a missing runId refuses before checkout')
}
```

Renumber the old scenarios 14–16 to 13–15 in their comment banners (labels unchanged). The file's last line stays `console.log(`\nALL TESTS PASSED (${passed})`)`.

Run: `node fleet/tests/test_shim_main_gate.mjs`
Expected: FAIL — `SyntaxError: The requested module '../shim-main.mjs' does not provide an export named 'spawnEngineProcess'`… no: `spawnEngineProcess` and `invokeEngineRun` ARE exported today, so the failure is scenario 12(a): `AssertionError … 1 !== 0` (the child's env lacks the variable).

- [ ] **Step 2: Implement in `fleet/shim-main.mjs`**

1. Replace `spawnEngineProcess` with:

```js
/**
 * The engine's environment: the inherited env (the credential lives there,
 * #213) plus `ULTRAPOWERS_FLEET_RUN=<runId>` — the one signal the skill's
 * §Engine/§Client branch and `ultra_run.py`'s `fleet-run` stage read to know
 * they are inside a fleet sandbox (One Driver Phase 0 §mechanism). It is set
 * here and nowhere else; an engine that finds it unset refuses at preflight.
 * (Distinct from the driver's `engineEnv` — the per-run env FILE `provisionRun`
 * delivers, which is what `process.env` already carries by the time this runs.)
 */
export const engineProcessEnv = (runId) => ({ ...process.env, ULTRAPOWERS_FLEET_RUN: runId })

/**
 * The default spawn seam: run a command to completion, resolve its exit code.
 * `stdio: 'inherit'` deliberately — the engine's output is the sandbox's log,
 * and buffering a multi-minute run in memory would serve nobody.
 */
export const spawnEngineProcess = ({ command, args, cwd, runId }) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: engineProcessEnv(runId) })
    child.on('error', () => resolve(1))
    child.on('close', (code) => resolve(code ?? 1))
  })
```

2. `invokeEngineRun`: add `runId,` to the destructured parameters (after `sessionId,`); directly after the `planPath` refusal block add:

```js
  if (!isNonEmptyString(runId)) {
    log('fleet: run assignment carries no runId — refusing to launch the engine')
    return { gateGreen: false, error: 'missing runId' }
  }
```

and change the spawn call to `spawnEngine({ command: ENGINE_COMMAND, args: engineArgs(planPath, sessionId), cwd: repoDir, runId })`. In the doc comment above it, replace `The environment is inherited — that is where the engine's credential lives` with `The environment is inherited plus `ULTRAPOWERS_FLEET_RUN=<runId>` (`engineProcessEnv`) — the inherited half is where the engine's credential lives` and add a `runId` line to the "two things must be true" list: `runId      The assignment carries it; it becomes ULTRAPOWERS_FLEET_RUN, without which the engine refuses at preflight (fail-closed). Absent means fail, now.`

3. `main()`: change the default binding to `invokeEngineRun({ repoDir, planPath, sessionId, runId, exec, excludeDirs: preRunDirs })`.

4. `readGateGreen` (row 1): delete from the comment `// The approve's own on-disk side effect: run_lock.sh release removes the` through `if (lockHolder === receipt.stamp) return false` so the function ends `if (approve.stamp !== receipt.stamp) return false` / `return true`. In the doc comment above it, replace leg 3's text from `Then` through `actually ran to completion.` so leg 3 reads: `3. `approve-receipt.json` exists, is `mode: 'approve'`, and its `stamp` matches the gate receipt's own `stamp` — proving the approve that ran is THIS run's approve, not some other run's leftover receipt.`

Run: `node fleet/tests/test_shim_main_gate.mjs`
Expected: `ALL TESTS PASSED (16)` (17 before: −2 scenarios, +1).

- [ ] **Step 3: Thread `runId` through the lifecycle sim's `invokeEngineRun` calls**

`fleet/tests/test_drive_lifecycle.mjs` calls `invokeEngineRun({ … })` eight times (the happy path at ~line 594 and the sub-cases at ~642, 657, 674, 689, 712, 737, 786) without `runId`; each now refuses with `missing runId` before its checkout and the ordering assertions fail. Add `runId: 'run-lifecycle',` to every one of those calls (next to `planPath: ENGINE_PLAN,`). The recorder's `spawnEngine: async ({ command, args, cwd }) => …` needs no change (the extra `runId` property is ignored). The three direct `spawnEngineProcess({ command: '/bin/sh', … })` calls near line 884 need no change either — `engineProcessEnv(undefined)` spreads the inherited env and Node omits an `undefined` value (verified: `spawn` with `env: { X: undefined }` leaves `X` unset).

Run: `node fleet/tests/test_drive_lifecycle.mjs && node fleet/tests/test_shim_main_publish.mjs`
Expected: both print `ALL TESTS PASSED`.

- [ ] **Step 4: Prove the lock is gone from the shim and run the suite's fleet leg**

Run: `grep -n "RUN_LOCK\|run_lock" fleet/shim-main.mjs fleet/tests/test_shim_main_gate.mjs`
Expected: no output.

Run: `python3 -m pytest tests/test_fleet_suite.py -q`
Expected: every fleet sim passes (each under 120 s; the three edited ones run in well under a second).

- [ ] **Step 5: Commit**

```bash
git add fleet/shim-main.mjs fleet/tests/test_shim_main_gate.mjs fleet/tests/test_drive_lifecycle.mjs
git commit -m "fleet: shim spawns the engine with ULTRAPOWERS_FLEET_RUN=<runId>; readGateGreen drops the RUN_LOCK read (Phase 0 §mechanism, row 1; #371)"
```

---

### Task 6: Client-facing texts — routing rubric, ultraplan sealing cut, ultradocket drain bullet, README, manifests, CLAUDE.md, and the product-sentence pin

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `hooks/session_start.sh`
- Modify: `skills/ultraplan/SKILL.md`
- Modify: `skills/ultraplan/references/seal-author-prompt.md`
- Modify: `tests/test_async_sealing.py`
- Modify: `skills/ultradocket/SKILL.md`
- Modify: `README.md`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `CLAUDE.md`
- Create: `tests/test_product_statement.py`
- Test: `tests/test_product_statement.py`
- Test: `tests/test_recommendation_rubric.py`
- Test: `tests/test_session_hook.py`
- Test: `tests/test_ultraplan_skill.py`
- Test: `tests/test_version_sync.py`
- Test: `tests/test_skill_budget.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (prose + one pin)

**Two files are deleted in this task** (the `Modify:` label is the Files grammar's only spelling for a deletion): `skills/ultraplan/references/seal-author-prompt.md` (row 7) and `tests/test_async_sealing.py` — that test reads the prompt file AND `skills/ultraplan/SKILL.md`'s sealing headings at import time (`### Dispatch at invocation`, `### Collect at plan approval`, `collect_seal.py`, …), so it cannot survive this task's edits; it also reads `agents/seal-author.md`, which P0a deletes — if P0a deletes the same test file, git merges a delete/delete cleanly. Row 7.

**Pins to keep green (read `tests/test_recommendation_rubric.py`, `tests/test_session_hook.py`, `tests/test_ultraplan_skill.py` before editing):** the hook's routing output must still contain `/ultrapowers <plan-path>`, `authorizes execution`, `no approval pause`, and every `SHARED_TOKENS`/`BRANCH_CLAUSES` literal in canonical order; `skills/ultraplan/SKILL.md` must still contain `authorizes execution`, `without a further approval pause`, `REQUIRED SUB-SKILL`, `ultrapowers:ultrapowers`, `Execution Handoff`, the same rubric literals, and the unchanged `<!-- BAKE -->`-mirrored blocks. Shrink budget for `skills/ultraplan/SKILL.md`: **net delta ≤ −400 words** over this task's diff (the sealing step is ~560 words; the disposition rewrite adds ~30); its `test_skill_budget.py` ceiling (3569) is unchanged.

- [ ] **Step 1: Write the failing product-statement pin**

Create `tests/test_product_statement.py`:

```python
"""Pin (not a guard): the product statement of map #366 Amendment 1 decision 6 —
ultrapowers executes on an exe.dev fleet the operator provisions; the plugin is
the client; there is no local engine. README and both manifests must say it in
the same words, so a description edit cannot quietly reintroduce a local engine."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SENTINEL = "runs on an exe.dev fleet"


def test_readme_carries_the_product_sentence():
    assert SENTINEL in (ROOT / "README.md").read_text()


def test_plugin_manifest_carries_the_product_sentence():
    plugin = json.loads((ROOT / ".claude-plugin/plugin.json").read_text())
    assert SENTINEL in plugin["description"]


def test_marketplace_entry_carries_the_product_sentence():
    market = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text())
    entry = next(p for p in market["plugins"] if p["name"] == "ultrapowers")
    assert SENTINEL in entry["description"]
```

Run: `python3 -m pytest tests/test_product_statement.py -q`
Expected: 3 failed (the sentinel appears nowhere yet).

- [ ] **Step 2: Manifests (Amendment 1 decision 6)**

`.claude-plugin/plugin.json` — replace the `description` value with:

```
The client for ultrapowers: /ultrapowers <plan-path> commits an approved Superpowers plan and runs on an exe.dev fleet you provision — parallel waves in a disposable sandbox, independent per-task review, the orchestrator opens the PR. No local engine.
```

`.claude-plugin/marketplace.json` — replace the top-level `description` with `ultrapowers: autonomous parallel execution for Superpowers plans, on an exe.dev fleet you provision.` and the `plugins[0].description` with:

```
ultrapowers client — runs on an exe.dev fleet you provision (parallel waves in a sandbox, per-task review, orchestrator-opened PR); no local engine
```

Do not touch either `version` (`test_version_sync.py` pins them equal; the release bumps them).

- [ ] **Step 3: README — §Get started, a "How it runs" section, and the sentences that now describe deleted lanes**

Edit `README.md` exactly as follows (anchors are current text):

1. In **What you get** item 2, delete the sentence `High-stakes work can also be held to an exam written from your spec that the builder never sees and can't game.` (row 7).
2. In the "In field use…" paragraph, replace `the planning decisions, vouching for the sealed exam's coverage at launch, and one physical-world check` with `the planning decisions and one physical-world check` (row 7).
3. Directly after the **How it works** opening paragraph (the one ending `*what happens if you point it at a real, approved plan?*`), insert:

```markdown
### How it runs

ultrapowers runs on an exe.dev fleet you provision — the plugin is the client. `/ultrapowers <plan-path>` commits your approved plan and launches a run on the fleet orchestrator; every wave, review, and test suite executes inside a disposable sandbox, and the orchestrator opens the pull request with the gate receipt in its body. There is no local engine: nothing builds, tests, or merges on your machine. Provisioning the fleet is a one-time setup — see [`fleet/RUNBOOK.md`](fleet/RUNBOOK.md).
```

4. Delete the parenthetical `(It's the same picture the swarm viewer draws live as a run unfolds.)` (row 8).
5. In **Zoom in: one task's life**, delete from `For high-stakes work there's also a **sealed exam**:` through `You can't game a test you can't read.` so the text runs `…mistake another wave's work for this task's. If the review asks for a fix, …` (row 7).
6. Replace the **It doesn't improvise** paragraph body with: `The script that orchestrates all of this is committed and frozen; it never writes a fresh version of itself at runtime. Same plan in, same structure out. And every run happens in a sandbox that exists only for that run — nothing it does can touch your checkout, and nothing it leaves behind survives it.` (rows 5, 10 — the probe and the sequential step-down are gone).
7. Replace `dependency graphs, git worktrees, sealed tests` with `dependency graphs, git worktrees, disposable sandboxes` (row 7).
8. In **Get started**, replace the whole `**Where it runs.**` paragraph with:

```markdown
**Where it runs.** ultrapowers runs on an exe.dev fleet you provision; the plugin is the client, and there is no local engine — see "How it runs" above and [`fleet/RUNBOOK.md`](fleet/RUNBOOK.md) for the one-time fleet setup. Claude Code's Workflows feature runs inside the sandbox, never on your machine, so the plugin works from any Claude Code surface that can commit a plan.
```

(The `task.gif` alt text still mentions a sealed exam; it describes the animation and is left as-is.)

Run: `python3 -m pytest tests/test_product_statement.py -q` — Expected: 3 passed.

- [ ] **Step 4: The routing rubric's option 1 — both legs, pin-identical where pinned**

`hooks/session_start.sh`, inside the heredoc, replace the three lines

```
   1. Ultrapowers — /ultrapowers <plan-path>: parallel waves, worktree isolation,
      per-task review, one pre-merge human gate. Selecting ultrapowers authorizes execution:
      begin implementation immediately after rendering the wave plan, with no approval pause.
```

with

```
   1. Ultrapowers — /ultrapowers <plan-path>: commits the plan and drives it on the
      exe.dev fleet (parallel waves in a sandbox, per-task review, the orchestrator
      opens the PR). Selecting ultrapowers authorizes execution: the plan is committed
      and the fleet run launched immediately, with no approval pause.
```

`skills/ultraplan/SKILL.md` **Render** list, replace item 1 (`1. **Ultrapowers** — `/ultrapowers <plan-path>`: parallel waves, worktree isolation, per-task review, one pre-merge human gate. Selecting it authorizes execution: ultrapowers renders its wave plan and launches immediately, without a further approval pause.`) with:

```markdown
1. **Ultrapowers** — `/ultrapowers <plan-path>`: commits the plan and drives it
   on the exe.dev fleet (parallel waves in a sandbox, per-task review, the
   orchestrator opens the PR). Selecting it authorizes execution: the plan is
   committed and the fleet run launches immediately, without a further approval
   pause.
```

Leave the rubric's signal definitions and decision tree untouched in both legs (the `risk` definition still names `sealed`; a `sealed` line is parseable and `BLOCKED` at the gate, so the branch is inert, and the lockstep pin makes an unrequested edit there a two-file change for nothing).

Run: `python3 -m pytest tests/test_recommendation_rubric.py tests/test_session_hook.py tests/test_ultraplan_skill.py -q` — Expected: all passed.

- [ ] **Step 5: ultraplan — delete the sealing step and every `sealed` production path (row 7)**

In `skills/ultraplan/SKILL.md`:

1. Delete the whole `## Seal the exam (dispatch at spec approval, collect at plan approval)` section — heading, `### Dispatch at invocation (before drawing tasks)`, `### Collect at plan approval`, through the paragraph beginning `Point the operator at the vouching rubric` — up to (not including) `### Choosing the disposition`.
2. Promote `### Choosing the disposition` to `## Acceptance disposition` and replace its body with:

```markdown
Every marked plan declares one of two Acceptance dispositions:

- **`**Acceptance:** suite — <reason>`** — the default. The committed suite plus
  per-task review is the verification; the engine binds acceptance to the
  committed test result (`acceptance.passed === tests.passed`).
- **`**Acceptance:** waived — <reason>`** — verification genuinely skipped, by
  explicit operator choice. Waivers surface verbatim at the wave-plan gate, in
  the report, and at the pre-merge gate.

`sealed` is no longer producible: the sealing subsystem was cut (One Driver
Phase 0, row 7) — the compiler still parses a `sealed` line (frozen vocabulary)
and the gate reports it `BLOCKED`. Never waive silently on the operator's behalf.
```

3. **Efforts too large for one plan**: replace `a sealed exam or suite whose checks cross the earlier phases` with `a suite whose checks cross the earlier phases`, and `phases sealed separately` with `phases gated separately`.
4. **The fit analysis** branch 1: replace `Independent per-task review, the held-out sealed exam, and one pre-merge gate are the value here` with `Independent per-task review and one pre-merge gate are the value here`.
5. **Operator smoke**: replace `aim where the suite and any sealed exam are structurally blind` with `aim where the suite is structurally blind`.
6. **Self-review additions** last bullet: replace `sealed, suite, or an explicit waiver` with `suite or an explicit waiver`.
7. `git rm skills/ultraplan/references/seal-author-prompt.md` and `git rm tests/test_async_sealing.py`.

Run:

```bash
grep -n "seal" skills/ultraplan/SKILL.md
```

Expected: only the `risk` definition line (`Acceptance is `sealed``) and the `## Acceptance disposition` paragraph that says `sealed` is not producible. Then: `python3 -m pytest tests/test_ultraplan_skill.py tests/test_skill_budget.py tests/test_recommendation_rubric.py -q && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` — Expected: all passed, validator exit 0.

- [ ] **Step 6: ultradocket — the `ultrapowers` drain bullet, the `record_wf_run.py` steps, and the sealed/manifest/hygiene/salvage prose (rows 2, 3, 4, 7)**

In `skills/ultradocket/SKILL.md` (anchors are current text; scripts under `skills/ultradocket/scripts/` are NOT touched — P0a owns them):

1. Frontmatter `description`: replace `sweep the accepted queue into sealed engine-tagged plans` with `sweep the accepted queue into engine-tagged plans`.
2. Triage: replace `Do not guess `sealed`/`suite` at triage` with `Do not guess `suite`/`waived` at triage`.
3. Sweep step 3: replace `→ operator approval → the ultraplan sealing step.` with `→ operator approval.`; replace `(or the sealed/waived equivalents)` with `(or the waived equivalent)`.
4. Sweep step 5: replace `plan path, engine, and (for `sealed` plans only) the seal-id — advancing the entry `accepted → planned → queued` via `docket_lib.transition` (`planned` is the intermediate: approved, seal not yet issued for sealed plans; for `suite`/`waived` plans there is no seal and the entry advances straight to `queued`).` with `plan path and engine — advancing the entry `accepted → planned → queued` via `docket_lib.transition` (`planned` is the approved intermediate; the entry advances straight to `queued`).`
5. Delete the paragraph `**If sealing fails** … never picks up an unsealed sealed plan.`
6. Mode: run, step 2, replace the whole `- `ultrapowers` → …` bullet (through `…tiers per task.`) with:

```markdown
   - `ultrapowers` → commit the plan on the docket line and `drive-one` it on the
     orchestrator (`fleet/RUNBOOK.md` §Live W1 run; the sandbox session runs the
     `/ultrapowers` §Engine, gate included); the orchestrator's PR/receipt is the
     gate. For such an entry step 3 reads that gate receipt instead of
     administering a second gate, and step 4 merges or parks on its verdict.
```

7. Step 3: delete the bullet `- `sealed` → `run_acceptance.sh <sealId> <branch> <sha256>` — the held-out exam.`; delete the whole paragraph `Immediately after each drain-administered gate for a **waves-engine (`ultrapowers`) entry**, mirror the outcome … the harvester to key on.` (row 2).
8. Step 4: delete `(Covers a red suite gate the same way as a red sealed exam — the JSON contract is identical.)`.
9. **The exam-gated auto-approve**: rename the heading to `### The gate-driven auto-approve`; replace the `**Trust the exam, not "looks done."**` bullet with `**Trust the gate, not "looks done."** A "finished" signal from a non-deterministic executor is never enough to merge. Correctness is decided by the plan's suite gate (`run_acceptance.sh --suite-gate`, exit-code authority) — or, for a fleet-driven entry, the orchestrator's gate receipt: exit 0 ⇒ merge; any non-zero ⇒ park. An over-eager auto-advance therefore cannot land broken work on the integration line — the gate it can't touch gates the merge.`; replace `without clearing the deterministic sealed exam and the single end gate` with `without clearing the deterministic suite gate and the single end gate`.
10. **The single end gate**: delete `and the entry's residual manifest (`<runDir>/residual-manifest.md`, … which passes vacuously);` so the sentence reads `…the review posture used (suite-gate authority, or the escalated tasks named); plus portfolio totals and the could-have-parallelized projection.` (row 3); delete `Run the close-of-run hygiene check (`skills/ultrapowers/scripts/hygiene_check.sh`) **before the merge to base and again at close**, quoting its JSON receipt verbatim beside the other receipts — a red receipt blocks the finishing handoff NEEDS_ACK-style, never a silent skip.` (row 3); replace `Parked branches are presented for the operator to Salvage/Redirect with full context (a drain run's args carry no `integrationBranch` and the drain writes no `gate-receipt.json` — pass `--integration-branch <docket-integration-branch>` to the composer).` with `Parked entries are presented with their gate evidence; a re-drive is a new run with a narrower plan — there is no in-place salvage or redirect.` (row 4).

Run: `grep -nE "record_wf_run|residual|hygiene_check|Salvage|Redirect|sealing|seal-id|sealed exam" skills/ultradocket/SKILL.md` — Expected: no output. Then `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultradocket` — Expected: exit 0 (every `skills/ultrapowers/scripts/…` mention left names a surviving script).

- [ ] **Step 7: CLAUDE.md — drop the shared-checkout gotchas and the sealing clause; add nothing**

1. **Commands**: replace `The 5 `tests/*.mjs` viewer/sim specs are **not** in CI` with `The 3 `tests/*.mjs` engine sims are **not** in CI` (row 8).
2. **Layout**, `evals/fixtures/`: replace `by `tests/test_compile_plan.py` and `tests/test_fixture_seals.py`` with `by `tests/test_compile_plan.py`` (row 7).
3. **How features are built here**: replace `(the committed suite is the verification; no held-out exam unless the operator asks to seal)` with `(the committed suite is the verification)`.
4. **The verification periphery is FROZEN** gotcha: replace `The sealing subsystem (`collect_seal.py`, `seal_hash.py`, `run_acceptance.sh`, the seal-author agent + brief), the gate scripts (`gate_check.py`, `ultra_gate.py`, `run_lock.sh`), and the compiler's diagnostic vocabulary` with `The gate scripts (`gate_check.py`, `ultra_gate.py`, `run_acceptance.sh`) and the compiler's diagnostic vocabulary`; replace the closing `Sealed acceptance is opt-in ("seal this plan"); `suite` is the default disposition.` with ``suite` is the default disposition; a `sealed` line still parses (frozen vocabulary) but is `BLOCKED` at the gate — the sealing subsystem was cut in One Driver Phase 0 (row 7).`
5. **The suite-gate runs the `.mjs` harness sims** gotcha: delete the final sentence `The viewer specs (`swarm_*`, `audit_*`) reference `viewer/` and are not run by the gate.` (row 8).
6. Delete the whole `**Self-hosting a `/ultrapowers` run? Serialize them.**` bullet, including its #134 sentences (row 1).

Run: `grep -nE "sweep_worktrees|RUN_LOCK|#134|seal this plan|collect_seal|viewer" CLAUDE.md` — Expected: no output.

- [ ] **Step 8: Run the task gate and commit**

Run: `python3 -m pytest tests/test_recommendation_rubric.py tests/test_session_hook.py tests/test_ultraplan_skill.py tests/test_version_sync.py tests/test_product_statement.py tests/test_skill_budget.py -q && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultradocket && bash hooks/session_start.sh | grep -c "exe.dev fleet"`
Expected: all passed, both validators exit 0, the hook prints its routing block once with the new option 1 (`1`).

```bash
git add hooks/session_start.sh skills/ultraplan/SKILL.md skills/ultradocket/SKILL.md README.md .claude-plugin/plugin.json .claude-plugin/marketplace.json CLAUDE.md tests/test_product_statement.py
git rm -q skills/ultraplan/references/seal-author-prompt.md tests/test_async_sealing.py
git commit -m "docs: ultrapowers runs on an exe.dev fleet — rubric option 1, ultraplan sealing step deleted, ultradocket drive-one bullet, README/manifests/CLAUDE.md product statement + pin (Phase 0 rows 1–4, 7, 8; #371)"
```

---

## Operator smoke

- do: open a fresh Claude Code session in any repo with the plugin installed and read the injected `<ultrapowers-routing>` block.
  see: option 1 says `commits the plan and drives it on the exe.dev fleet` and ends `with no approval pause`; nothing mentions worktree isolation or a local run.
- do: in a session without the fleet, run `/ultrapowers docs/superpowers/plans/<any-approved-plan>.md`.
  see: the skill reads `ULTRAPOWERS_FLEET_RUN` (unset), walks §Client — commit/push, the `drive-one` ssh line, watch, read the PR — and says plainly that nothing runs locally and there is no fallback; it never invokes `ultra_run.py` or the Workflow tool.
- do: `wc -w skills/ultrapowers/SKILL.md` on `main` after merge.
  see: a number ≤ 1000 (the release commit quotes it as bar row 1).
- do: read `README.md` from the top and the plugin's card in `/plugin`.
  see: both say it runs on an exe.dev fleet you provision with no local engine; the README no longer promises a sealed exam, a live viewer, or a sequential step-down.
- do: on the orchestrator, `grep ULTRAPOWERS_FLEET_RUN /tmp/drive-run-<N>.out` after run C (the P0 validating run on the cut engine, driven from P0a+P0b merged).
  see: the sandbox session's log shows it took §Engine (preflight ran `fleet-run` first), and the gate greened on `approve-receipt.json` with no `RUN_LOCK` mention anywhere.

## Execution handoff

3 implementation tasks, one wave (all `Depends-on: none`, files disjoint), no sealed acceptance, no high-stakes runtime surface beyond the shim's spawn seam (covered by its sim) — but the SKILL.md rewrite and the shim change are marked `**Review:** adversarial` because a wrong word in the two-move rule or a dropped env var is invisible to the suite and only surfaces in a live fleet run. **Ultrapowers (recommended)** — by the operator's standing Phase 0 shape: P0b is driven as fleet run B on the orchestrator, concurrently with P0a's run A (spec §Delivery shape), and merged first or together with P0a.
