# Complexity Governance & Gate Consolidation Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land three ultralearn-distilled improvements to the ultrapowers engine — a consolidated deferred-verification gate channel, a re-narrativized `judgmentCalls` field, and two complexity governors for the ultralearn loop — each built to *reduce* standing complexity rather than accrete it.

**Architecture:** Three independent specs compiled into one plan. Spec A replaces the report's `visualEyeballItems` string list with one reason-tagged `deferredVerification` channel and routes its sandbox-unreachable reasons through the gate's *existing* false-green acknowledgement. Spec B collapses the densest field-reference in the spec (`judgmentCalls`) into a four-kind taxonomy, documentation-only. Spec C adds a distill consolidation rubric (G1) and a reproducible complexity metric + advisory ratchet (G2) to the ultralearn skill. The only same-file contention is `references/report-format.md` (Spec A + Spec B), which is serialized; all other work splits on clean file seams.

**Tech Stack:** Python 3 (pytest, the test gate scoped by `pytest.ini`); the `waves.js` Dynamic Workflow (Node); Markdown skill/reference docs.

**Acceptance:** suite — engine/skill/doc development. Author and operator both read the diffs; the committed pytest suite, the prompt-drift pins, and adversarial per-task review are the verification. No held-out exam is authored (`acceptance.passed === tests.passed`). The `tests/*.mjs` sims are not in CI — run the named ones manually where a task says so.

## Global Constraints

- **Versioning stays `0.0.x`; this plan ships no release** — no `plugin.json`/`marketplace.json` bump in any task. (A release is a separate `release`-typed follow-up.)
- **Prompts are baked; never edit only a baked copy.** The five `<!-- BAKE:* -->` blocks (GUARD, IMPLEMENTER_PROMPT, IMPLEMENTER_SCHEMA, REVIEWER_PROMPT, REVIEWER_SCHEMA) in `references/reviewer-prompts.md` are pinned by `tests/test_no_prompt_drift.py`. The completeness-critic prompt is **not** in that set — it is inline in `waves.js` and may be edited directly. No task may alter a baked block.
- **No direct Anthropic API calls and no `ANTHROPIC_API_KEY`** in any shipped or dev script.
- **The `deferredVerification` field replaces `visualEyeballItems`** (internal report contract; full rename, no alias). `reason` enum is exactly `browser | runtime | external | manual`.
- **Spec B is documentation-only:** the `judgmentCalls` JSON schema and the ~20 `judgmentCalls.push(...)` sites in `waves.js` stay byte-identical; only the field-reference prose and presentation order change.
- **The governors must not become the accretion they treat:** G1 *prefers* structural/simplification framings, it does not *forbid* additive guards; G2 is *advisory by default* (reports deltas; does not hard-fail CI on any metric increase). Strict ratchet mode is opt-in only.
- **`python3 -m pytest` must be green at the end of every task** (it is the acceptance authority for this plan).

---

### Task A1: Deferred-verification channel — report schema & presentation

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/report-format.md`

**Interfaces:**
- The `deferredVerification` report field contract — `{ deliverable: string, reason: "browser"|"runtime"|"external"|"manual", why?: string }[]` — documented here in the schema, field reference, and presentation. This is a spec-fixed contract restated identically in A2 and A3's own bodies, not a built artifact handed between tasks (no `Consumes:`/`Produces:` symbol edge).

**Parallelization rationale:** the field contract is fixed verbatim in A1/A2/A3 bodies (contract-first), so the doc, the engine, and the gate are authored in parallel instead of chained — they touch three different files and share only the named contract.

- [ ] **Step 1: Replace the schema property.** In the JSON schema block, replace the line
  `"visualEyeballItems": { "type": "array", "items": { "type": "string" } },`
  with:

```jsonc
"deferredVerification": { "type": "array", "items": { "type": "object",
  "required": ["deliverable", "reason"],
  "properties": {
    "deliverable": { "type": "string" },
    "reason": { "type": "string", "enum": ["browser", "runtime", "external", "manual"] },
    "why":  { "type": "string" } } } },
```

- [ ] **Step 2: Replace the field-reference row.** Replace the `| `visualEyeballItems` | … |` table row with a `deferredVerification` row stating: deliverables the completeness critic found present and structurally complete but whose behavior the sandbox could not execute, each tagged with a `reason` — `browser` (live UI), `runtime` (target runtime the sandbox can't run: boot, device, deploy target), `external` (unreachable service/credential/network), `manual` (human judgment: aesthetic, product-fit). State the gating rule: a non-empty `runtime` or `external` group is a structural false-green and routes into the **same** acknowledgement disposition as `coverage.complete: false`; `browser`/`manual` remain a verify-then-approve checklist.

- [ ] **Step 3: Rewrite presentation §9a.** Rename the "Verify in a browser" section to "**Deferred verification — confirm before trusting green**", rendered grouped by `reason`, and add to the Approve bullet (§ Presentation, Approve) that a non-empty `runtime`/`external` group requires explicit operator acknowledgement before Approve, exactly as `coverage.complete: false` does. Leave every other field and disposition unchanged.

- [ ] **Step 4: Verify the suite is green.**

Run: `python3 -m pytest`
Expected: PASS (no pytest pins `report-format.md` field names; this confirms no regression).

- [ ] **Step 5: Commit.**

```bash
git add skills/ultrapowers/references/report-format.md
git commit -m "feat(report): replace visualEyeballItems with reason-tagged deferredVerification channel"
```

---

### Task A2: Deferred-verification channel — engine (`waves.js`)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/sim_workflow.mjs` (manual sim — update its expectations)

**Interfaces:**
- Self-contained: the field contract is a spec decision restated verbatim in this task's own body (Steps 2–3). No build-time symbol is consumed from or produced for A1/A3 — the three share only the spec-fixed contract, so no interface edge is declared.

**Parallelization rationale:** the completeness prompt is inline in `waves.js` (not a baked block) and the field contract is fixed in the spec, restated in each task body — so doc (A1), engine (A2), and gate (A3) are three independent diffs on three different files, with no build-time hand-off between them.

- [ ] **Step 1: Update the completeness-critic prompt instruction.** At the `completenessPrompt` definition (~`waves.js:361`), replace the instruction
  `'whose behavior can only be confirmed in a browser or live UI, list it under ' + "visualEyeball so the operator's attention goes exactly there."`
  with an instruction to list each such deliverable under `deferredVerification` as an object `{ deliverable, reason, why }`, where `reason` is one of `browser` (live UI), `runtime` (a target runtime the sandbox cannot run — process boot, device, deploy target), `external` (an unreachable service/credential/network), or `manual` (requires human judgment), so the gate can route runtime/external items to an explicit acknowledgement.

- [ ] **Step 2: Update the critic return schema.** At the schema field (~`waves.js:438`), replace
  `visualEyeball: { type: 'array', items: { type: 'string' } },`
  with:

```js
deferredVerification: { type: 'array', items: { type: 'object', properties: {
  deliverable: { type: 'string' },
  reason: { type: 'string', enum: ['browser', 'runtime', 'external', 'manual'] },
  why: { type: 'string' } } } },
```

- [ ] **Step 3: Update the collection + report assembly.** At ~`waves.js:1184`, replace
  `const visualEyeballItems = (review && Array.isArray(review.visualEyeball)) ? review.visualEyeball : []`
  with
  `const deferredVerification = (review && Array.isArray(review.deferredVerification)) ? review.deferredVerification : []`
  and rename the report property `visualEyeballItems` → `deferredVerification` wherever the report object is assembled. At the budget-deferred early return (~`waves.js:871`), replace `visualEyeballItems: []` with `deferredVerification: []`. Grep to confirm zero remaining `visualEyeball` occurrences: `grep -n visualEyeball skills/ultrapowers/harnesses/waves.js` must print nothing.

- [ ] **Step 4: Update the manual sim expectations.** In `tests/sim_workflow.mjs`, rename any `visualEyeballItems` assertion to `deferredVerification` and adjust the expected shape from a string list to the object list `{ deliverable, reason, why }`.

- [ ] **Step 5: Verify drift pin + suite + sim.**

Run: `python3 -m pytest tests/test_no_prompt_drift.py && python3 -m pytest`
Expected: PASS (no baked block was touched).
Run: `node tests/sim_workflow.mjs`
Expected: PASS (sim reflects the renamed field).

- [ ] **Step 6: Commit.**

```bash
git add skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "feat(engine): emit reason-tagged deferredVerification from the completeness critic"
```

---

### Task A3: Deferred-verification channel — Step 5 gate

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`

**Interfaces:**
- Self-contained: the contract (a non-empty `runtime`/`external` group is a structural false-green) is restated in this task's own body. No build-time symbol is consumed from A1 or A2 — no interface edge is declared.

**Parallelization rationale:** the gate prose lives in `SKILL.md`, a different file from A1's reference doc and A2's engine — independent diff against the spec-fixed contract.

- [ ] **Step 1: Add the gate rule.** In `SKILL.md` Step 5 (the Approve disposition, near the existing `coverage.complete` / `visualEyeballItems` handling), add: render `deferredVerification` grouped by `reason`; a non-empty **`runtime`** or **`external`** group is a structural false-green (green is blind to it) and must be surfaced for explicit operator acknowledgement before Approve — reuse the existing `coverage.complete: false` acknowledgement disposition, do not invent a new one. `browser` and `manual` groups stay as the present verify-then-approve checklist. Replace any lingering `visualEyeballItems` reference in Step 5 with `deferredVerification`.

- [ ] **Step 2: Verify the suite + rubric pin are green.**

Run: `python3 -m pytest tests/test_recommendation_rubric.py && python3 -m pytest`
Expected: PASS (Step 5 gate prose is not part of the pinned recommendation rubric; this confirms no regression).

- [ ] **Step 3: Commit.**

```bash
git add skills/ultrapowers/SKILL.md
git commit -m "feat(gate): route runtime/external deferredVerification through the false-green acknowledgement"
```

---

### Task B1: `judgmentCalls` re-narrativization (doc-only)

**Type:** implementation
**Depends-on:** A1

**Files:**
- Modify: `skills/ultrapowers/references/report-format.md`

**Interfaces:**
- Doc-only; no interface symbols. `Depends-on: A1` is a file-seam serialization (both tasks modify `report-format.md`), declared as a marker so the two never share a wave.

- [ ] **Step 1: Replace the `judgmentCalls` field-reference.** Replace the single ~1,059-character `| `judgmentCalls` | no | … |` sentence with a four-kind taxonomy. The kinds, by what they ask of the operator:

```
| `judgmentCalls` | no | Non-obvious autonomous decisions, each one of four kinds (the kind is carried in the entry's string prefix): **autonomy** — a defensible call, FYI, asks nothing (tier-escalation recovery, fell-back-to-default review depth/tier, convergent output); **degradation** — verify the affected slice (budget-deferred, integration-review-deferred, agent-error); **disagreement** — look before approving (reviewer verdict/severity mismatch, reviewer returned no verdict, lost-coordinates, merge reported MERGED without headSha, suite-acceptance failed); **binding** — likely a plan typo (endpoint not in run, dependent before prerequisite, endpoints share a wave). New cases slot into an existing kind rather than lengthening this reference. |
```

- [ ] **Step 2: Regroup presentation §8.** Change the "Judgment calls" presentation step to render the entries **grouped by kind**, leading with `disagreement` and folding `autonomy` last, using the existing string prefixes to bucket them. Do not change the schema or any producer — this is presentation/documentation only.

- [ ] **Step 3: Confirm schema and producers are untouched.**

Run: `git diff --stat` — expected: only `report-format.md` changed.
Run: `grep -c 'judgmentCalls.push' skills/ultrapowers/harnesses/waves.js` — expected: unchanged from baseline (no producer edited).

- [ ] **Step 4: Verify the suite is green.**

Run: `python3 -m pytest`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add skills/ultrapowers/references/report-format.md
git commit -m "docs(report): re-narrativize judgmentCalls into a four-kind taxonomy"
```

---

### Task C1: Complexity metric script (G2)

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultralearn/scripts/complexity_metric.py`
- Test: `tests/test_complexity_metric.py`

**Interfaces:**
- Produces: `compute_metrics(paths: list[str]) -> dict` returning `{ "parensPerLine": {path: float}, "longestRuleChars": int, "distinctIssueRefs": int, "engineLoc": int }`; and `verdict(metrics: dict, baseline: dict) -> list[str]` returning one human-readable delta line per regressed metric (empty list when within baseline). CLI: `python3 complexity_metric.py [--baseline <path>]` prints the metrics JSON and any verdict lines.

- [ ] **Step 1: Write the failing test.**

```python
# tests/test_complexity_metric.py
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import complexity_metric as cm

def test_metrics_basic(tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("a (b) (c) line one.\nNo parens here. See #29 and #4afb.\n")
    m = cm.compute_metrics([str(f)])
    assert m["parensPerLine"][str(f)] == 1.0          # 2 '(' over 2 lines
    assert m["distinctIssueRefs"] == 2                  # #29, #4afb
    assert m["engineLoc"] == 2
    assert m["longestRuleChars"] >= len("a (b) (c) line one.")

def test_verdict_flags_regression():
    base = {"parensPerLine": {"x": 0.5}, "longestRuleChars": 100, "distinctIssueRefs": 5, "engineLoc": 10}
    worse = {"parensPerLine": {"x": 0.7}, "longestRuleChars": 100, "distinctIssueRefs": 5, "engineLoc": 10}
    lines = cm.verdict(worse, base)
    assert any("x" in l for l in lines) and len(lines) == 1
    assert cm.verdict(base, base) == []
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `python3 -m pytest tests/test_complexity_metric.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'complexity_metric'`.

- [ ] **Step 3: Implement the script.**

```python
# skills/ultralearn/scripts/complexity_metric.py
"""Reproducible complexity metric over the engine's gate-spec surfaces.
Advisory governor for the ultralearn loop (G2): measures accretion; never branches."""
from __future__ import annotations
import json, re, sys
from pathlib import Path

ISSUE_RE = re.compile(r"#[0-9]+[a-z]*")
SENT_RE = re.compile(r"(?<=[.])\s+(?=[A-Z`|])")

def compute_metrics(paths):
    parens, longest, refs, loc = {}, 0, set(), 0
    for p in paths:
        text = Path(p).read_text()
        lines = text.splitlines() or [""]
        parens[p] = round(text.count("(") / len(lines), 4)
        loc += len(lines)
        refs.update(ISSUE_RE.findall(text))
        longest = max([longest] + [len(s) for s in SENT_RE.split(text)])
    return {"parensPerLine": parens, "longestRuleChars": longest,
            "distinctIssueRefs": len(refs), "engineLoc": loc}

def verdict(metrics, baseline):
    out = []
    for f, v in metrics.get("parensPerLine", {}).items():
        b = baseline.get("parensPerLine", {}).get(f)
        if b is not None and v > b:
            out.append(f"parensPerLine[{f}] rose {b} -> {v}")
    for k in ("longestRuleChars", "distinctIssueRefs", "engineLoc"):
        b = baseline.get(k)
        if b is not None and metrics.get(k, 0) > b:
            out.append(f"{k} rose {b} -> {metrics[k]}")
    return out

GATE_SURFACES = [
    "skills/ultrapowers/SKILL.md",
    "skills/ultrapowers/references/report-format.md",
    "skills/ultrapowers/references/reviewer-prompts.md",
    "skills/ultrapowers/references/dependency-analysis.md",
    "skills/ultrapowers/references/wave-merge.md",
]

def main(argv):
    root = Path(__file__).resolve().parents[3]
    metrics = compute_metrics([str(root / p) for p in GATE_SURFACES])
    print(json.dumps(metrics, indent=2, sort_keys=True))
    if "--baseline" in argv:
        base = json.loads(Path(argv[argv.index("--baseline") + 1]).read_text())
        for line in verdict(metrics, base):
            print("RATCHET:", line)
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `python3 -m pytest tests/test_complexity_metric.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit.**

```bash
git add skills/ultralearn/scripts/complexity_metric.py tests/test_complexity_metric.py
git commit -m "feat(ultralearn): add reproducible complexity metric (G2)"
```

---

### Task C2: Complexity baseline + advisory ratchet (G2)

**Type:** implementation
**Depends-on:** C1

**Files:**
- Create: `skills/ultralearn/complexity-baseline.json`
- Test: `tests/test_complexity_ratchet.py`

**Interfaces:**
- Consumes: `compute_metrics` / `verdict` from Task C1 (`skills/ultralearn/scripts/complexity_metric.py`).
- Emits the committed baseline file the ratchet compares against, plus an advisory pin that asserts the baseline is shape-current and reports deltas without failing on increase.

- [ ] **Step 1: Stamp the baseline from the current tree.**

Run: `python3 skills/ultralearn/scripts/complexity_metric.py > skills/ultralearn/complexity-baseline.json`
Then confirm it parses: `python3 -c "import json; json.load(open('skills/ultralearn/complexity-baseline.json'))"`
Expected: no error; the file holds `parensPerLine`/`longestRuleChars`/`distinctIssueRefs`/`engineLoc`.

- [ ] **Step 2: Write the advisory ratchet test.**

```python
# tests/test_complexity_ratchet.py
import sys, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultralearn/scripts"))
import complexity_metric as cm

BASELINE = ROOT / "skills/ultralearn/complexity-baseline.json"

def test_baseline_is_shape_current():
    """Advisory: the baseline must exist and carry every metric key for the current
    surfaces. It does NOT fail on a metric increase — G2 is advisory by default."""
    base = json.loads(BASELINE.read_text())
    for k in ("parensPerLine", "longestRuleChars", "distinctIssueRefs", "engineLoc"):
        assert k in base
    root = Path(cm.__file__).resolve().parents[3]
    current = cm.compute_metrics([str(root / p) for p in cm.GATE_SURFACES])
    assert set(base["parensPerLine"]) == set(current["parensPerLine"])  # same surfaces
    # Advisory only: surface deltas to stdout, never assert them down.
    for line in cm.verdict(current, base):
        print("RATCHET (advisory):", line)
```

- [ ] **Step 3: Run the suite to verify the ratchet passes green.**

Run: `python3 -m pytest tests/test_complexity_ratchet.py -v`
Expected: PASS (baseline is shape-current; deltas, if any, print but do not fail).

- [ ] **Step 4: Commit.**

```bash
git add skills/ultralearn/complexity-baseline.json tests/test_complexity_ratchet.py
git commit -m "feat(ultralearn): commit complexity baseline + advisory ratchet (G2)"
```

---

### Task C3: Distill consolidation rubric (G1)

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultralearn/references/distilling-proposals.md`

**Interfaces:**
- Standalone new reference doc; consumed by C4 via the `Depends-on: C3` marker (a path reference, not a code symbol), so no interface edge is needed.

**Parallelization rationale:** a standalone new reference doc — no shared file with any other task; the SKILL.md wiring (C4) depends on it but the doc is authored independently.

- [ ] **Step 1: Write the rubric.** Create `skills/ultralearn/references/distilling-proposals.md`, mirroring the structure of `references/reading-lenses.md` (the readers' rubric). It instructs the distill agent that every proposal MUST carry:
  - `complexityEffect` — one of `additive-guard` (adds a conditional/field/rule that handles one case — accretes), `structural` (changes a representation so a class of cases can't occur — neutral/▼), or `simplification` (removes a branch/field/rule — ▼).
  - `consolidationAttempted` — for any cluster seen in **≥3 runs** or **≥2 prior distills**, a one-line answer to *"can a representation change delete this whole cluster?"*; if yes, the structural framing is the proposal and the additive guard is the fallback; if no, state why the guard is irreducible.
  - `netConceptDelta` — does standing-concept count go up / flat / down.

  Include the governing rule verbatim: *prefer `structural`/`simplification`; an `additive-guard` on a recurring cluster requires a recorded `consolidationAttempted`. The rubric prefers — it does not forbid; some edge cases are genuinely irreducible.*

- [ ] **Step 2: Verify the suite is green.**

Run: `python3 -m pytest`
Expected: PASS (new reference file; no pin regresses).

- [ ] **Step 3: Commit.**

```bash
git add skills/ultralearn/references/distilling-proposals.md
git commit -m "feat(ultralearn): add distill consolidation rubric (G1)"
```

---

### Task C4: Wire the governors into the `distill` verb (G1 + G2)

**Type:** implementation
**Depends-on:** C1, C2, C3

**Files:**
- Modify: `skills/ultralearn/SKILL.md`

**Interfaces:**
- References `references/distilling-proposals.md` (C3), `scripts/complexity_metric.py` (C1), and `skills/ultralearn/complexity-baseline.json` (C2) by path in the Verb-2 prose — all three ordered via the `Depends-on: C1, C2, C3` markers (path references, not code symbols), so the documented `--baseline` command is coherent only after the baseline file exists.

- [ ] **Step 1: Add the G1 rubric clause to Verb 2.** In `skills/ultralearn/SKILL.md` Verb 2 (`ultralearn distill`), add a sentence: *draft each proposal against `references/distilling-proposals.md`; prefer `structural`/`simplification` framings, and for any recurring cluster record the consolidation attempt before proposing an additive guard.*

- [ ] **Step 2: Add the G2 metric/ratchet step to Verb 2.** Add a step: *run `python3 skills/ultralearn/scripts/complexity_metric.py --baseline skills/ultralearn/complexity-baseline.json`; surface any `RATCHET:` deltas in the distill output, and when a gate-spec surface is over baseline, make a consolidation pass on that surface the top-ranked proposal rather than a new feature. The ratchet is advisory — it informs ranking, it does not block.*

- [ ] **Step 3: Keep the skill pin green.**

Run: `python3 -m pytest tests/test_ultralearn_skill.py -v`
Expected: PASS. If the pin asserts specific Verb-2 text that changed, update the expected string in `tests/test_ultralearn_skill.py` to match the new prose (the pin tracks the skill; update it deliberately), then re-run.

- [ ] **Step 4: Verify the full suite is green.**

Run: `python3 -m pytest`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add skills/ultralearn/SKILL.md tests/test_ultralearn_skill.py
git commit -m "feat(ultralearn): wire consolidation rubric + complexity ratchet into distill"
```

---

## Self-Review

**Spec coverage:**
- Spec A (deferred-verification): schema/field-ref/presentation (A1), engine emission (A2), Step-5 gate acknowledgement (A3). ✓
- Spec B (judgmentCalls C1, doc-only): field-ref taxonomy + presentation regroup, schema/producers untouched (B1). ✓ C2 structural option intentionally deferred (per spec §3, evidence-gated).
- Spec C (governors): metric script (C1), baseline + advisory ratchet (C2), G1 rubric (C3), Verb-2 wiring (C4). ✓ The "soft-by-default, not a wall" constraint is encoded in C2's advisory test and C4's "advisory — does not block".

**File-seam / wave check (by hand, confirmed against `compile_plan.py`):**
- Wave 1 (no deps): A1, A2, A3, C1, C3 — files `report-format.md`, `waves.js`, `ultrapowers/SKILL.md`, `complexity_metric.py`(+test), `distilling-proposals.md`. All distinct → width 5, no collision. A1/A2/A3 are independent because the field contract is spec-fixed and restated in each body (no build-time hand-off), not chained.
- Wave 2: B1 (dep A1, same-file serialize on `report-format.md`), C2 (dep C1) — files `report-format.md`, `complexity-baseline.json`(+ratchet test). Distinct → no collision.
- Wave 3: C4 (dep C1, C2, C3) — file `ultralearn/SKILL.md`. C4 follows C2 because its documented `--baseline` command is only coherent once the baseline file exists (a true dependency, declared). ✓

**Type consistency:** the report field is `deferredVerification` with `reason ∈ {browser,runtime,external,manual}` in A1 (doc), A2 (engine schema + collection), and A3 (gate) — identical everywhere. The metric API `compute_metrics`/`verdict`/`GATE_SURFACES` defined in C1 is consumed by C2's test and C4's prose under those exact names. ✓

**Placeholder scan:** every code/doc step carries the actual content (schema blocks, the taxonomy row, the full metric script, both tests). No TBD/TODO. ✓

**Acceptance:** `suite` — declared in the header; no sealing step required (engine/skill/doc development, diffs readable).

---

## Execution Handoff

**Fit analysis:** 8 implementation tasks, widest wave 5 (A1, A2, A3, C1, C3 run in parallel), low risk (docs / prompts / scripts; no auth, payments, migrations, data integrity, or public API; behavior verifiable by reading the diffs and the suite). Parallel width present and T≥4 → **Ultrapowers (recommended)**.

1. **Ultrapowers (recommended)** — `/ultrapowers docs/superpowers/plans/2026-06-27-complexity-governance-and-gate-consolidation.md`: parallel waves, worktree isolation, per-task review, one pre-merge human gate. Selecting this authorizes execution: ultrapowers renders its wave plan for transparency and launches immediately, without a further approval pause.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential, review between tasks.
3. **Inline** — superpowers:executing-plans, continuous inline execution.
