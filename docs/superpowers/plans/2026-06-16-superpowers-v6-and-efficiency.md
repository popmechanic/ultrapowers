# Superpowers v6 integration + efficiency pass Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — building ultrapowers itself (engine + compiler + skill + prompt + script + doc development) whose operator reads every diff; verification is the committed suite (`tests/`, the Node sim `tests/sim_workflow.mjs`, the anti-drift pin `tests/test_no_prompt_drift.py`, the eval fixtures `evals/scripts/tests/`) plus `validate_skill.py`, not a held-out exam. The subject is the verification machinery itself.

**Goal:** Make ultrapowers a v6-native executor that consumes Superpowers v6's `## Global Constraints` + per-task `**Interfaces:**` blocks (using Consumes/Produces to strengthen the dependency DAG) and adopts v6's measured efficiency mechanics (pre-baked review packets, a cannot-verify-from-diff escalation channel, warm-cache dependency bootstrap, terse prompt contracts), without bricking pre-GA users.

**Architecture:** Two parts in one plan. **Part 1 (v6 integration):** vendor a pinned v6 snapshot and re-attest the compat tripwire behind a GA-flip seam (the parser stays additive-tolerant, so v5 plans still compile); teach `compile_plan.py` the two new blocks and use `Consumes`/`Produces` as an exact-token dependency signal that emits a loud "undeclared dependency" finding when a real edge is undeclared; forward both signals into the baked implementer/reviewer prompts. **Part 2 (efficiency):** pre-baked review packets written to the shared common git dir, a `cannot-verify-from-diff` reviewer channel routed to the completeness critic, a lockfile-keyed warm dependency cache + cutting the reviewer's redundant suite run, and terse prompt contracts with a cheap micro-test tuning loop. The compiler track (Tasks 2, 7) and the engine prompt chain (Tasks 9–12) are the two coupled cores; the fixture, scripts, README, eval tooling, and ultraplan doc parallelize around them.

**Tech Stack:** Python (`compile_plan.py` + `pytest`), a frozen JavaScript Workflow engine (`skills/ultrapowers/harnesses/waves.js`) verified by a Node self-asserting simulation (`tests/sim_workflow.mjs`) and the anti-drift pin (`tests/test_no_prompt_drift.py`), bash helper scripts under `skills/ultrapowers/scripts/`, and the eval harness under `evals/`. **Re-bake discipline:** every prompt edit lands in its `references/*.md` source block first, then verbatim into `waves.js`; `tests/test_no_prompt_drift.py` asserts the two stay in sync (whole-block for `reviewer-prompts.md`, static-fragments-in-order for `wave-merge.md`'s `{{placeholder}}` blocks).

**Verification command (this repo, mirrors CI):**
```bash
node tests/sim_workflow.mjs && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan && \
python3 -m pytest tests/ -q
```

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tests/fixtures/superpowers-v6/**` + `PROVENANCE` | Pinned v6 handoff snapshot (dev `08fc48c`) the compat tripwire attests against pre-GA | 1 |
| `tests/test_superpowers_compat.py` | Re-attest the tripwire to the v6 snapshot via one GA-flip-seam helper; v5→v6 tokens | 8 |
| `skills/ultrapowers/SKILL.md` | v6 attestation line + a note on the new v6 plan signals | 8 |
| `skills/ultrapowers/scripts/compile_plan.py` | Parse `## Global Constraints` + per-task `**Interfaces:**`; Interfaces→DAG edge + undeclared-dependency finding | 2, 7 |
| `tests/test_compile_plan.py` | Parser + DAG + finding tests | 2, 7 |
| `skills/ultrapowers/references/dependency-analysis.md` | Document Interfaces-as-edge-source + the finding | 7 |
| `evals/fixtures/flawed/{plan.md,version.txt}` | Regression fixture: undeclared dep now surfaces via an Interfaces edge | 7 |
| `skills/ultrapowers/scripts/review-package` (new) | Pre-baked diff packet written to the shared common git dir | 3 |
| `tests/test_review_package.py` (new) | review-package end-to-end test | 3 |
| `skills/ultrapowers/scripts/warm_cache.sh` (new) | Lockfile-keyed dependency cache + hardlink-clone helper | 4 |
| `tests/test_warm_cache.py` (new) | warm_cache round-trip test | 4 |
| `skills/ultrapowers/references/reviewer-prompts.md` | IMPLEMENTER/REVIEWER prompts + schema: forward signals, terse contracts, packets, cannot-verify, warm-cache | 9, 10, 11, 12 |
| `skills/ultrapowers/references/wave-merge.md` | Completeness critic consumes the cannot-verify checklist | 11 |
| `skills/ultrapowers/references/report-format.md` | Document the `cannotVerify` field + routing | 11 |
| `skills/ultrapowers/harnesses/waves.js` | Re-bake every changed prompt; thread signals/packet/cannot-verify/warm-cache; cut the reviewer suite run | 9, 10, 11, 12 |
| `tests/sim_workflow.mjs` | Self-asserting dispatch-prompt scenarios | 9, 10, 11, 12 |
| `tests/test_no_prompt_drift.py` | **Not edited.** Derives BAKE fragments from source; new fragments ride in automatically (kept green by each engine task's suite run) | — |
| `README.md` | Path drift (`workflow.js`→`harnesses/waves.js`), `Delete:` reconcile, v6 attestation | 5 |
| `evals/scripts/run-micro.py` (new) + `evals/README.md` | Micro-test loop + re-freeze & cost-attribution protocol | 6 |
| `tests/test_run_micro.py` (new) | Offline scorer/aggregation test | 6 |
| `skills/ultraplan/SKILL.md` | Authoring guidance: the v6 blocks are load-bearing | 13 |

**Why the engine chain (Tasks 9–12) is serial, not parallel:** all four edit the same three files — `references/reviewer-prompts.md` (the single source for `GUARD`/`IMPLEMENTER_PROMPT`/`REVIEWER_PROMPT`/schemas), `harnesses/waves.js` (their baked copies + dispatch wiring), and `tests/sim_workflow.mjs` — and the source↔baked pair is bound by `test_no_prompt_drift.py`. Splitting them across a wave would force write-after-write reconciliation on those files, so each declares `Depends-on` the prior (9 → 10 → 11 → 12). The compiler track (2 → 7), the compat track (1 → 8), the three new scripts/fixtures, the README, the eval tooling, and the ultraplan doc all touch disjoint files and wave in parallel around the chain.

### Task 1: Vendor a pinned Superpowers v6 snapshot

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `tests/fixtures/superpowers-v6/skills/writing-plans/SKILL.md`
- Create: `tests/fixtures/superpowers-v6/skills/subagent-driven-development/SKILL.md`
- Create: `tests/fixtures/superpowers-v6/skills/subagent-driven-development/implementer-prompt.md`
- Create: `tests/fixtures/superpowers-v6/skills/subagent-driven-development/task-reviewer-prompt.md`
- Create: `tests/fixtures/superpowers-v6/skills/subagent-driven-development/scripts/task-brief`
- Create: `tests/fixtures/superpowers-v6/skills/subagent-driven-development/scripts/review-package`
- Create: `tests/fixtures/superpowers-v6/skills/requesting-code-review/code-reviewer.md`
- Create: `tests/fixtures/superpowers-v6/skills/receiving-code-review/SKILL.md`
- Create: `tests/fixtures/superpowers-v6/PROVENANCE`

This task implements spec §1.1's first half: freeze a pinned snapshot of the Superpowers v6 handoff surface into `tests/fixtures/superpowers-v6/` so the compat tripwire has a v6 contract to attest against before v6 reaches GA (there is no installed v6 cache yet). The fixture mirrors the eight files the compat suite reads contract tokens from — `writing-plans/SKILL.md`, `subagent-driven-development/SKILL.md` and its `implementer-prompt.md` / `task-reviewer-prompt.md` / `scripts/{task-brief,review-package}`, `requesting-code-review/code-reviewer.md`, and `receiving-code-review/SKILL.md` — each copied **verbatim** from the v6 dev tree, preserving its relative path under the fixture root. Source: the local clone at `/tmp/superpowers-dev`, branch `dev`, commit `08fc48c` (full SHA `08fc48cfd2449ebc0f224ccbbe9999f460308ae5`), dated 2026-06-15.

**This task does NOT touch `tests/test_superpowers_compat.py`.** Re-pointing that test at this fixture and flipping the v5→v6 contract tokens is **Task 8** (the GA-flip seam + token swap). Task 1's own verification is therefore *file-presence + token-presence inside the fixture* — confirming the snapshot carries the v6 contract tokens Task 8 will assert and is missing the deleted v5 files — **not** a run of the compat suite (which still attests against the installed 5.1.0 cache until Task 8 lands).

Concurrency note: this task only **creates** new files under `tests/fixtures/superpowers-v6/**` plus `PROVENANCE`; it writes no file any other task reads or writes, so it shares no on-disk state. Safe to run in its own worktree.

- [ ] **Step 1: Create the fixture directory tree**

```bash
mkdir -p tests/fixtures/superpowers-v6/skills/writing-plans
mkdir -p tests/fixtures/superpowers-v6/skills/subagent-driven-development/scripts
mkdir -p tests/fixtures/superpowers-v6/skills/requesting-code-review
mkdir -p tests/fixtures/superpowers-v6/skills/receiving-code-review
```

- [ ] **Step 2: Copy each v6 handoff file into the fixture, preserving its relative path**

Copy verbatim from the `/tmp/superpowers-dev` source (branch `dev`, commit `08fc48c`). The two `scripts/` files are executable shebang scripts — use `cp -p` so their mode is preserved. (If `/tmp/superpowers-dev` is gone, re-clone superpowers at `08fc48c` first.)

```bash
cp /tmp/superpowers-dev/skills/writing-plans/SKILL.md \
   tests/fixtures/superpowers-v6/skills/writing-plans/SKILL.md
cp /tmp/superpowers-dev/skills/subagent-driven-development/SKILL.md \
   tests/fixtures/superpowers-v6/skills/subagent-driven-development/SKILL.md
cp /tmp/superpowers-dev/skills/subagent-driven-development/implementer-prompt.md \
   tests/fixtures/superpowers-v6/skills/subagent-driven-development/implementer-prompt.md
cp /tmp/superpowers-dev/skills/subagent-driven-development/task-reviewer-prompt.md \
   tests/fixtures/superpowers-v6/skills/subagent-driven-development/task-reviewer-prompt.md
cp -p /tmp/superpowers-dev/skills/subagent-driven-development/scripts/task-brief \
   tests/fixtures/superpowers-v6/skills/subagent-driven-development/scripts/task-brief
cp -p /tmp/superpowers-dev/skills/subagent-driven-development/scripts/review-package \
   tests/fixtures/superpowers-v6/skills/subagent-driven-development/scripts/review-package
cp /tmp/superpowers-dev/skills/requesting-code-review/code-reviewer.md \
   tests/fixtures/superpowers-v6/skills/requesting-code-review/code-reviewer.md
cp /tmp/superpowers-dev/skills/receiving-code-review/SKILL.md \
   tests/fixtures/superpowers-v6/skills/receiving-code-review/SKILL.md
```

- [ ] **Step 3: Confirm all eight files landed at their expected paths**

```bash
for f in \
  skills/writing-plans/SKILL.md \
  skills/subagent-driven-development/SKILL.md \
  skills/subagent-driven-development/implementer-prompt.md \
  skills/subagent-driven-development/task-reviewer-prompt.md \
  skills/subagent-driven-development/scripts/task-brief \
  skills/subagent-driven-development/scripts/review-package \
  skills/requesting-code-review/code-reviewer.md \
  skills/receiving-code-review/SKILL.md; do
  test -f "tests/fixtures/superpowers-v6/$f" && echo "OK  $f" || echo "MISSING  $f"
done
```
Expected: eight `OK` lines, no `MISSING`.

- [ ] **Step 4: Create the PROVENANCE note**

Write `tests/fixtures/superpowers-v6/PROVENANCE` with this full content:

```
Superpowers v6 handoff snapshot — vendored, pinned, read-only.

Source repo:   superpowers (dev branch, unreleased v6 / version 6.0.0)
Local clone:   /tmp/superpowers-dev
Branch:        dev
Commit:        08fc48c (full: 08fc48cfd2449ebc0f224ccbbe9999f460308ae5)
Vendored on:   2026-06-16

Why this exists:
  v6 is unreleased, so there is no installed superpowers plugin cache to
  attest against. tests/test_superpowers_compat.py reads its v6 contract
  tokens from this frozen snapshot until v6 reaches GA, at which point the
  test's source-of-truth function (the GA-flip seam) is re-pointed at the
  installed cache and the attested version is bumped.

Files frozen here (copied verbatim from the source commit above):
  skills/writing-plans/SKILL.md
  skills/subagent-driven-development/SKILL.md
  skills/subagent-driven-development/implementer-prompt.md
  skills/subagent-driven-development/task-reviewer-prompt.md
  skills/subagent-driven-development/scripts/task-brief
  skills/subagent-driven-development/scripts/review-package
  skills/requesting-code-review/code-reviewer.md
  skills/receiving-code-review/SKILL.md

Do not hand-edit these files. To refresh the snapshot, re-copy from the
pinned commit (or a newer pinned commit) and update Commit + Vendored on
above. A drift between this snapshot and shipped v6 is the intended
tripwire once the GA-flip points the compat test at the installed cache.
```

- [ ] **Step 5: Verify the fixture carries the v6 contract tokens Task 8 will assert**

```bash
grep -Fq '### Task N:'           tests/fixtures/superpowers-v6/skills/writing-plans/SKILL.md && echo "OK  task-head" || echo "FAIL  task-head"
grep -Fq '**Files:**'            tests/fixtures/superpowers-v6/skills/writing-plans/SKILL.md && echo "OK  files"     || echo "FAIL  files"
grep -Fq '## Global Constraints' tests/fixtures/superpowers-v6/skills/writing-plans/SKILL.md && echo "OK  global-constraints" || echo "FAIL  global-constraints"
grep -Fq '**Interfaces:**'       tests/fixtures/superpowers-v6/skills/writing-plans/SKILL.md && echo "OK  interfaces" || echo "FAIL  interfaces"
test -f tests/fixtures/superpowers-v6/skills/subagent-driven-development/task-reviewer-prompt.md && echo "OK  task-reviewer-prompt.md" || echo "FAIL  task-reviewer-prompt.md"
```
Expected: five `OK` lines, no `FAIL`.

- [ ] **Step 6: Verify the deleted v5 reviewer-prompt files are ABSENT from the fixture**

```bash
test ! -e tests/fixtures/superpowers-v6/skills/subagent-driven-development/spec-reviewer-prompt.md && echo "OK  spec-reviewer absent" || echo "FAIL  spec-reviewer present"
test ! -e tests/fixtures/superpowers-v6/skills/subagent-driven-development/code-quality-reviewer-prompt.md && echo "OK  code-quality-reviewer absent" || echo "FAIL  code-quality-reviewer present"
```
Expected: two `OK` lines, no `FAIL`.

- [ ] **Step 7: Confirm the vendored copies are byte-identical to their source**

```bash
for f in \
  skills/writing-plans/SKILL.md \
  skills/subagent-driven-development/SKILL.md \
  skills/subagent-driven-development/implementer-prompt.md \
  skills/subagent-driven-development/task-reviewer-prompt.md \
  skills/subagent-driven-development/scripts/task-brief \
  skills/subagent-driven-development/scripts/review-package \
  skills/requesting-code-review/code-reviewer.md \
  skills/receiving-code-review/SKILL.md; do
  diff -q "/tmp/superpowers-dev/$f" "tests/fixtures/superpowers-v6/$f" \
    && echo "IDENTICAL  $f" || echo "DRIFT  $f"
done
```
Expected: eight `IDENTICAL` lines, no `DRIFT`.

- [ ] **Step 8: Commit**

```bash
git add tests/fixtures/superpowers-v6
git commit -m "test(fixtures): vendor pinned superpowers v6 handoff snapshot (08fc48c)"
```

---

### Task 2: Parse v6 Global Constraints + Interfaces blocks

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`, `Depends-on: 2`

Files-note — `skills/ultrapowers/scripts/compile_plan.py` (a `## Global Constraints` section parser, a per-task `**Interfaces:**` block parser, the `**Files:**` loop's stop-at-Interfaces exemption, and the two new fields in the output payloads)
Files-note — `tests/test_compile_plan.py` (three new failing-first tests appended — labeled Modify, not Test, so the file-overlap inference agrees with Task 7's `Depends-on: 2` instead of inferring a reversed read-after-write edge)

This task implements spec §1.2. The compiler is ultrapowers' sole plan parser, so the two v6 blocks are read here or nowhere. Both blocks are **optional**: a v5 plan (no `## Global Constraints`, no `**Interfaces:**`) must still compile clean, with `globalConstraints: ""` and every task's `interfaces` defaulting to `{"consumes": [], "produces": []}` — absence is the v5 case and must never warn. The output contract the engine track consumes is fixed: a top-level `globalConstraints` string and a per-task `interfaces` object `{"consumes": [...], "produces": [...]}`, present in the per-task objects (`tasks[]`), the light `launch_waves[]` objects, and the `--emit-launch` launch-file `tasks[]` (the three places `waves.js` reads task/plan data), plus `globalConstraints` at the top level of both the compiled output and the launch payload.

The one subtlety is the `**Files:**` parser. Today (`compile_plan.py` lines 280–353) any bullet inside an open Files block that is not a checkbox and fails `FILE_LINE` is surfaced as a near-miss conflict ("TOTAL rule", lines 301–308). A `**Interfaces:**` block's `- Consumes:` / `- Produces:` sub-lines are exactly such bullets, so without an exemption a v6 plan would emit two spurious near-miss conflicts per task. The fix is to make `**Interfaces:**` an explicit Files-block terminator, parse the Interfaces sub-lines into `task.interfaces`, and never route them through `files_near_miss`.

Stay fence-aware: the existing `_fence_aware_lines()` already drives the `parse_task` loop, so an Interfaces example inside a code fence is inert with no extra work.

Concurrency note: this task edits `compile_plan.py` and `tests/test_compile_plan.py` — the same two files Task 7 edits, which is why Task 7 declares `Depends-on: 2`; they never run concurrently. Runs `pytest` in its own worktree with no shared ports.

- [ ] **Step 1: Add three failing tests to `tests/test_compile_plan.py`**

Append these three test functions to the end of `tests/test_compile_plan.py`. They use the existing `compile_plan(path)` helper and the `tmp_path` fixture, matching the file's conventions.

```python
def test_global_constraints_and_interfaces_parse_into_new_fields(tmp_path):
    plan = tmp_path / "v6.md"
    plan.write_text(
        "# Plan: V6 blocks\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "## Global Constraints\n\n"
        "- Python 3.11+ only; no new third-party deps.\n"
        "- All public names use snake_case.\n\n"
        "---\n\n"
        "### Task 1: schema\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `apistub/schema.py`\n\n"
        "**Interfaces:**\n"
        "- Produces: `User` dataclass (id: int, name: str, email: str)\n"
        "- Produces: `FIELDS` dict\n\n"
        "- [ ] **Step 1:** write schema\n\n"
        "### Task 2: store\n\n**Type:** implementation\n**Depends-on:** 1\n\n"
        "**Files:**\n- Create: `apistub/store.py`\n\n"
        "**Interfaces:**\n"
        "- Consumes: `User` dataclass (id: int, name: str, email: str)\n\n"
        "- [ ] **Step 1:** write store\n"
    )
    out = compile_plan(plan)
    # Top-level Global Constraints captured verbatim (body only, header stripped).
    assert "Python 3.11+ only; no new third-party deps." in out["globalConstraints"]
    assert "All public names use snake_case." in out["globalConstraints"]
    assert "## Global Constraints" not in out["globalConstraints"]
    # Per-task interfaces, preserving the text after the Consumes:/Produces: label.
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["interfaces"]["produces"] == [
        "`User` dataclass (id: int, name: str, email: str)",
        "`FIELDS` dict",
    ]
    assert by_id["1"]["interfaces"]["consumes"] == []
    assert by_id["2"]["interfaces"]["consumes"] == [
        "`User` dataclass (id: int, name: str, email: str)",
    ]
    assert by_id["2"]["interfaces"]["produces"] == []
    # The fields ride into the launch-ready objects the engine consumes.
    lw_by_id = {t["id"]: t for wave in out["launch_waves"] for t in wave}
    assert lw_by_id["1"]["interfaces"]["produces"][0].startswith("`User` dataclass")
    # The Interfaces sub-lines are NOT mis-read as malformed Files entries.
    assert not any(c["task"] in ("1", "2") and "Files" in c["note"]
                   for c in out["marker_conflicts"])
    # And they did not leak into the write sets (Files parsing stopped cleanly).
    assert by_id["1"]["writes"] == ["apistub/schema.py"]
    assert by_id["2"]["writes"] == ["apistub/store.py"]


def test_v5_plan_compiles_clean_with_empty_interface_defaults(tmp_path):
    plan = tmp_path / "v5.md"
    plan.write_text(
        "# Plan: V5 legacy\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: only\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n"
    )
    out = compile_plan(plan)
    assert out["globalConstraints"] == ""
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["interfaces"] == {"consumes": [], "produces": []}
    assert not any("Interface" in c["note"] or "Global Constraint" in c["note"]
                   for c in out["marker_conflicts"])


def test_interfaces_consumes_line_is_not_a_files_near_miss(tmp_path):
    plan = tmp_path / "exempt.md"
    plan.write_text(
        "# Plan: Exemption\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: consumer\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `app.py`\n\n"
        "**Interfaces:**\n"
        "- Consumes: `validate_payload(payload) -> list[str]`\n"
        "- Produces: `route(store, method, path, payload=None)`\n\n"
        "- [ ] **Step 1:** wire it\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["interfaces"]["consumes"] == [
        "`validate_payload(payload) -> list[str]`"]
    assert by_id["1"]["interfaces"]["produces"] == [
        "`route(store, method, path, payload=None)`"]
    assert by_id["1"]["writes"] == ["app.py"]
    assert not any(c["task"] == "1" and "Files" in c["note"]
                   for c in out["marker_conflicts"])
```

- [ ] **Step 2: Run the new tests and confirm they FAIL (RED)**

```bash
python3 -m pytest tests/test_compile_plan.py -q -k "global_constraints or interface_defaults or consumes_line"
```
Expected: all three FAIL — `compile_plan` output today has no `globalConstraints` key and no `interfaces` field, and `- Consumes:`/`- Produces:` lines currently surface as Files near-miss conflicts.

- [ ] **Step 3: Add the `## Global Constraints` parser to `compile_plan.py`**

Insert this function immediately after `parse_acceptance` (after its closing `return {"mode": "missing"}` at line 434):

```python
# Top-level `## Global Constraints` section (v6, spec 2026-06-16). Fence-aware
# whole-document scan: capture the verbatim body between the `## Global
# Constraints` heading and the next heading of the same-or-shallower level (a
# `#`/`##` line) or end of document. Optional — absent returns "" (the v5 case),
# which must never warn. A trailing `---` rule or trailing blank lines are
# trimmed so the body is the constraints text only, not the section framing.
GLOBAL_CONSTRAINTS_HEAD = re.compile(r"^##\s+Global\s+Constraints\s*$", re.I)
SECTION_BREAK = re.compile(r"^#{1,2}\s+\S")  # next `#`/`##` heading ends the section


def parse_global_constraints(text):
    lines = list(_fence_aware_lines(text))
    start = None
    for i, (line, in_fence) in enumerate(lines):
        if not in_fence and GLOBAL_CONSTRAINTS_HEAD.match(line.strip()):
            start = i + 1
            break
    if start is None:
        return ""
    body = []
    for line, in_fence in lines[start:]:
        if not in_fence and SECTION_BREAK.match(line.strip()):
            break
        body.append(line)
    while body and not body[0].strip():
        body.pop(0)
    while body and (not body[-1].strip() or body[-1].strip() in ("---", "***", "___")):
        body.pop()
    return "\n".join(body)
```

- [ ] **Step 4: Add `**Interfaces:**` parsing to `parse_task` and exempt it from the Files near-miss rule**

Three edits inside `parse_task` (the loop at lines 158–387).

First, declare the accumulators. Replace the existing (line 158-area):

```python
    creates, modifies, reads = [], [], []
    files_near_miss = []
    in_files = False
    files_entries_seen = False
```

with:

```python
    creates, modifies, reads = [], [], []
    files_near_miss = []
    in_files = False
    files_entries_seen = False
    # v6 `**Interfaces:**` block (spec 2026-06-16): opens on `**Interfaces:**`
    # AFTER the Files block, before the first `- [ ]` step. `- Consumes:` /
    # `- Produces:` sub-lines are captured verbatim after the label. Optional —
    # absent leaves both lists empty (the v5 case).
    consumes, produces = [], []
    in_interfaces = False
```

Second, make `**Interfaces:**` close the Files block. Insert this branch immediately BEFORE the existing `if in_files:` block (line 280), and after the `FILES_ISH` near-miss `continue` at line 279:

```python
        if s.startswith("**Interfaces:**"):
            # Opening the Interfaces block closes any open Files block cleanly,
            # so its `- Consumes:`/`- Produces:` sub-lines are never run through
            # the Files near-miss rule below.
            in_files = False
            in_interfaces = True
            continue
        if in_interfaces:
            if not s:
                continue  # blank lines inside the Interfaces block are fine
            if s.startswith("- [") or TASK_HEAD.match(s):
                in_interfaces = False  # a checkbox step (or next heading) ends it
            else:
                mi = re.match(r"^[-*+]\s*(Consumes|Produces)\s*:\s*(.+?)\s*$", s, re.I)
                if mi:
                    (consumes if mi.group(1).lower() == "consumes"
                     else produces).append(mi.group(2).strip())
                    continue
                # Any other line ends the Interfaces block; fall through so a
                # following marker/Files/step line is processed normally.
                in_interfaces = False
        if in_files:
```

(The trailing `if in_files:` is the EXISTING line 280 — the anchor, not a new line.)

Third, surface the two new lists in the `t.update(...)` call (lines 376–386). Change:

```python
             creates=sorted(set(creates)), modifies=sorted(set(modifies)),
             reads=sorted(set(reads)),
             writes=sorted(set(creates) | set(modifies)),
             files_ambiguous=files_ambiguous, prose=prose)
```

to:

```python
             creates=sorted(set(creates)), modifies=sorted(set(modifies)),
             reads=sorted(set(reads)),
             writes=sorted(set(creates) | set(modifies)),
             interfaces={"consumes": consumes, "produces": produces},
             files_ambiguous=files_ambiguous, prose=prose)
```

(`consumes`/`produces` preserve document order and the verbatim text after the label — NOT sorted or deduped.)

- [ ] **Step 5: Emit `globalConstraints` and `interfaces` in all output payloads**

Five edits in `main`.

First, after the `acceptance = parse_acceptance(plan_text)` line (line 834), add:

```python
    global_constraints = parse_global_constraints(plan_text)
```

Second, add `interfaces` to the per-task objects in the `out_tasks` loop (lines 765–770). Change:

```python
        out_tasks.append({"id": t["id"], "title": t["title"], "disposition": disp,
                          "heuristic": heuristic, "writes": t["writes"],
                          "depends_on": t["depends_on"]})
```

to:

```python
        out_tasks.append({"id": t["id"], "title": t["title"], "disposition": disp,
                          "heuristic": heuristic, "writes": t["writes"],
                          "depends_on": t["depends_on"],
                          "interfaces": t["interfaces"]})
```

Third, add `interfaces` to the light `launch_waves` objects (lines 892–895). Change:

```python
    launch_waves = [
        [{"id": tid, "title": by_id[tid]["title"], "files": _files_for(by_id[tid]),
          "depends_on": by_id[tid]["depends_on"]} for tid in wave]
        for wave in waves]
```

to:

```python
    launch_waves = [
        [{"id": tid, "title": by_id[tid]["title"], "files": _files_for(by_id[tid]),
          "depends_on": by_id[tid]["depends_on"],
          "interfaces": by_id[tid]["interfaces"]} for tid in wave]
        for wave in waves]
```

Fourth, add `globalConstraints` to the top-level `result` dict (lines 897–909). Change:

```python
        "mode": mode,
        "degrade_reason": degrade,
        "acceptance": acceptance,
    }
```

to:

```python
        "mode": mode,
        "degrade_reason": degrade,
        "acceptance": acceptance,
        "globalConstraints": global_constraints,
    }
```

Fifth, add both fields to the `--emit-launch` payload (lines 916–924). Change:

```python
        launch_payload = {
            "tasks": [{"id": tid, "title": by_id[tid]["title"],
                       "body": by_id[tid]["body"], "files": _files_for(by_id[tid]),
                       "depends_on": by_id[tid]["depends_on"]}
                      for wave in waves for tid in wave],
            "waves": waves,
            "edges": [[e["from"], e["to"]] for e in edges],
            "acceptance": acceptance,
        }
```

to:

```python
        launch_payload = {
            "tasks": [{"id": tid, "title": by_id[tid]["title"],
                       "body": by_id[tid]["body"], "files": _files_for(by_id[tid]),
                       "depends_on": by_id[tid]["depends_on"],
                       "interfaces": by_id[tid]["interfaces"]}
                      for wave in waves for tid in wave],
            "waves": waves,
            "edges": [[e["from"], e["to"]] for e in edges],
            "acceptance": acceptance,
            "globalConstraints": global_constraints,
        }
```

- [ ] **Step 6: Run the new tests and confirm GREEN, then the full suite**

```bash
python3 -m pytest tests/test_compile_plan.py -q -k "global_constraints or interface_defaults or consumes_line" && \
python3 -m pytest tests/ -q && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers
```
Expected: the three new tests pass; the rest of `tests/` stays green (the new keys are additive); `validate_skill.py` prints `skill ok`.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "feat(compile): parse v6 Global Constraints + per-task Interfaces blocks (spec 1.2)"
```

---

### Task 3: review-package script (pre-baked diff in the shared common git dir)

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/scripts/review-package`
- Test: `tests/test_review_package.py`

Files-note — `skills/ultrapowers/scripts/review-package` (bash, `chmod +x`)
Files-note — `tests/test_review_package.py` (new pytest, real-temp-repo style)

This task implements spec §2.1 — adopt v6's `review-package` (commits + `git diff --stat` + `git diff -U10` → one file the reviewer reads in a single call) but adapt its storage to ultrapowers' reality. v6 writes the packet to a **per-worktree** git path (`git rev-parse --git-path sdd`); in ultrapowers the implementer and reviewer run in **different linked worktrees**, so a per-worktree path is invisible to the reviewer. The adaptation writes to the **shared common git dir** (`git rev-parse --git-common-dir`), which resolves to the same location for every linked worktree of the repo, under `ultra/review-<shortbase>..<shorthead>.diff`.

This is a standalone bash script plus a self-contained pytest; it produces the packet generator other tasks' prompts invoke (Task 10). It depends on nothing and writes only its own two files, so it runs in its own wave with zero edges.

Concurrency note: creates two new files no other task touches, and its pytest builds throwaway temp git repos under `tmp_path` with no shared ports or fixtures.

**FIXED CLI contract** (Task 10's baked prompts depend on this exact interface):
- Invocation: `bash skills/ultrapowers/scripts/review-package <BASE> <HEAD> [OUTFILE]`.
- Default output path when `OUTFILE` is omitted: `"$(git rev-parse --git-common-dir)/ultra/review-<shortbase>..<shorthead>.diff"` (the COMMON git dir, shared across all linked worktrees). `mkdir -p` the `ultra/` dir; resolve to an absolute path.
- File body (markdown, like v6): `# Review package: <base>..<head>`, then `## Commits` (`git log --oneline BASE..HEAD`), `## Files changed` (`git diff --stat BASE..HEAD`), `## Diff` (`git diff -U10 BASE..HEAD`).
- The script **echoes the final output path as the last (and only) stdout line**; the human-readable summary goes to stderr.
- Robustness: `set -euo pipefail`; reject wrong arg counts (usage on stderr, exit 2); fail clearly (stderr + exit 2) if BASE or HEAD is not a valid rev.

- [ ] **Step 1: Write a failing pytest in `tests/test_review_package.py`**

```python
"""End-to-end test for the review-package script — the pre-baked review packet
(spec §2.1). A REAL temp repo with two commits touching one file; asserts the
packet is written to the SHARED common git dir, is echoed on stdout, and carries
the commit subjects, the ## Diff header, and a +/- diff hunk."""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/ultrapowers/scripts/review-package"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-b", "main")
    git(repo, "config", "user.email", "rp@test")
    git(repo, "config", "user.name", "review-package test")
    (repo / "f.txt").write_text("original line\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "first commit subject")
    base = git(repo, "rev-parse", "HEAD").stdout.strip()
    (repo / "f.txt").write_text("changed line\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "second commit subject")
    head = git(repo, "rev-parse", "HEAD").stdout.strip()
    return repo, base, head


def run_script(repo, *args):
    return subprocess.run(["bash", str(SCRIPT), *args], cwd=repo,
                          capture_output=True, text=True)


def test_review_package_writes_to_common_git_dir_and_echoes_path(tmp_path):
    repo, base, head = make_repo(tmp_path)
    p = run_script(repo, base, head)
    assert p.returncode == 0, p.stderr
    out_path = pathlib.Path(p.stdout.strip().splitlines()[-1])
    assert out_path.exists(), f"packet not written: {out_path}"
    common = pathlib.Path(
        git(repo, "rev-parse", "--git-common-dir").stdout.strip())
    if not common.is_absolute():
        common = (repo / common)
    assert out_path.resolve().parent == (common / "ultra").resolve()
    body = out_path.read_text()
    assert "# Review package:" in body
    assert "first commit subject" in body
    assert "second commit subject" in body
    assert "## Commits" in body
    assert "## Files changed" in body
    assert "## Diff" in body
    assert "-original line" in body
    assert "+changed line" in body


def test_review_package_honors_explicit_outfile(tmp_path):
    repo, base, head = make_repo(tmp_path)
    out = tmp_path / "explicit.diff"
    p = run_script(repo, base, head, str(out))
    assert p.returncode == 0, p.stderr
    assert out.exists()
    assert p.stdout.strip().splitlines()[-1] == str(out)
    assert "## Diff" in out.read_text()


def test_review_package_rejects_missing_args(tmp_path):
    repo, base, _ = make_repo(tmp_path)
    p = run_script(repo, base)            # HEAD missing
    assert p.returncode == 2
    assert "usage" in p.stderr.lower()


def test_review_package_rejects_bad_rev(tmp_path):
    repo, base, _ = make_repo(tmp_path)
    p = run_script(repo, base, "nope-not-a-rev")
    assert p.returncode == 2
    assert "HEAD" in p.stderr
```

- [ ] **Step 2: Run the test and confirm it FAILS (RED)**

```bash
python3 -m pytest tests/test_review_package.py -q
```
Expected: every test errors/fails because the script does not exist yet.

- [ ] **Step 3: Write the script `skills/ultrapowers/scripts/review-package`**

```bash
#!/usr/bin/env bash
# Generate a review package: commit list, stat summary, and the net diff with
# extended context, written to a file the reviewer reads in one call. Using the
# recorded per-task BASE (not HEAD~1) keeps multi-commit tasks intact.
#
# Usage: review-package BASE HEAD [OUTFILE]
#
# Default OUTFILE: <common-git-dir>/ultra/review-<base7>..<head7>.diff. Unlike
# v6's per-worktree `git rev-parse --git-path sdd`, ultrapowers' implementer and
# reviewer run in DIFFERENT linked worktrees, so the packet must live somewhere
# both can see: --git-common-dir resolves to the same shared location for every
# linked worktree of the repo.
#
# Echoes the final output path on stdout so callers learn where it wrote.
set -euo pipefail

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: review-package BASE HEAD [OUTFILE]" >&2
  exit 2
fi

base=$1
head=$2

git rev-parse --verify --quiet "$base" >/dev/null || { echo "bad BASE: $base" >&2; exit 2; }
git rev-parse --verify --quiet "$head" >/dev/null || { echo "bad HEAD: $head" >&2; exit 2; }

if [ $# -eq 3 ]; then
  out=$3
else
  dir=$(git rev-parse --git-common-dir)/ultra
  mkdir -p "$dir"
  dir=$(cd "$dir" && pwd)   # absolute, so the echoed path works from any cwd
  out="$dir/review-$(git rev-parse --short "$base")..$(git rev-parse --short "$head").diff"
fi

{
  echo "# Review package: ${base}..${head}"
  echo
  echo "## Commits"
  git log --oneline "${base}..${head}"
  echo
  echo "## Files changed"
  git diff --stat "${base}..${head}"
  echo
  echo "## Diff"
  git diff -U10 "${base}..${head}"
} > "$out"

commits=$(git rev-list --count "${base}..${head}")
echo "wrote ${out}: ${commits} commit(s), $(wc -c < "$out" | tr -d ' ') bytes" >&2
echo "${out}"
```

Then make it executable:

```bash
chmod +x skills/ultrapowers/scripts/review-package
```

(The human-readable `wrote …` summary goes to **stderr** so stdout's final — and only — line is the bare output path, which `test_review_package_honors_explicit_outfile` asserts equals `str(out)` exactly.)

- [ ] **Step 4: Run the test and confirm GREEN**

```bash
python3 -m pytest tests/test_review_package.py -q && python3 -m pytest tests/ -q
```
Expected: all four review-package tests pass; the full suite stays green (the new module is additive).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/review-package tests/test_review_package.py
git commit -m "feat: review-package writes the pre-baked diff to the shared common git dir (spec 2.1)"
```

---

### Task 4: warm_cache.sh (lockfile-keyed dependency cache + hardlink clone)

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/scripts/warm_cache.sh`
- Test: `tests/test_warm_cache.py`

Files-note — `skills/ultrapowers/scripts/warm_cache.sh` (bash, `chmod +x`)
Files-note — `tests/test_warm_cache.py` (new pytest, subprocess-against-a-real-bash-script style)

This task implements spec §2.3 sub-lever **(a)** only — warm-cache the dependency install. (The §2.3(b) reviewer suite-run cut is Task 10.) Today every fresh worktree re-runs `bootstrapCmd` (`pip install -e .`, `bun install`, …) per worktree, per task, per fix-round. This script lets the engine bootstrap a dependency tree **once** into a warm cache keyed by the lockfile hash, then hardlink-clone it into each implementer's worktree near-instantly. Task 12 wires the engine's baked bootstrap step to this exact CLI.

**Correctness never depends on the cache.** A `restore` miss (exit 3) just means the caller runs a normal `bootstrapCmd` install; a lockfile change misses by construction (different hash → different key). Generic over `node_modules` / `.venv`: it clones whatever directory it is told.

**Fixed CLI contract** (Task 12 wires to this verbatim):
- `bash warm_cache.sh restore <lockfile> <target_dir>` — compute the lockfile's content hash; if `<CACHE>/<hash>/` exists, hardlink-clone its contents into `<target_dir>` and **exit 0** (HIT); otherwise **exit 3** (MISS).
- `bash warm_cache.sh populate <lockfile> <source_dir>` — compute the same hash; copy `<source_dir>` into `<CACHE>/<hash>/` **atomically** (temp dir then `mv`); **idempotent**.
- Cache root `<CACHE>` = `"${CLAUDE_PLUGIN_DATA:-$HOME/.ultrapowers/cache}/deps"` (survives plugin updates); `mkdir -p`.
- Hash = hex digest of `shasum -a 256 <lockfile>` (fall back to `sha256sum`).
- Hardlink-clone with detection + fallback: prefer `cp -al`; detect at runtime and fall back to `cp -aR` where hardlink clone is unavailable (macOS BSD `cp`).
- `set -euo pipefail`; clear stderr on missing/extra args, unknown subcommand, missing lockfile, or missing source_dir.

Concurrency note: creates one new script + one new test; the offline test shells out to nothing and needs no network (points `<CACHE>` at `tmp_path` via `CLAUDE_PLUGIN_DATA`).

- [ ] **Step 1: Write the failing pytest in `tests/test_warm_cache.py`**

```python
"""End-to-end test for warm_cache.sh — the lockfile-keyed warm dependency cache
(spec §2.3a). A REAL bash script, a REAL temp cache (CLAUDE_PLUGIN_DATA pointed
at tmp_path), and assertions that a HIT restores files, a changed lockfile MISSES
with exit 3, and populate is atomic + idempotent."""
import os
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
WARM = ROOT / "skills/ultrapowers/scripts/warm_cache.sh"


def run(tmp_path, *args, env_extra=None):
    env = dict(os.environ)
    env["CLAUDE_PLUGIN_DATA"] = str(tmp_path / "plugindata")
    if env_extra:
        env.update(env_extra)
    return subprocess.run(["bash", str(WARM), *args],
                          cwd=tmp_path, capture_output=True, text=True, env=env)


def make_lockfile(tmp_path, name, content):
    lf = tmp_path / name
    lf.write_text(content)
    return lf


def make_deps_dir(tmp_path, name, files):
    d = tmp_path / name
    d.mkdir()
    for rel, body in files.items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body)
    return d


def test_populate_then_restore_hits_and_clones_files(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "dep-a@1.0.0\ndep-b@2.0.0\n")
    src = make_deps_dir(tmp_path, "node_modules",
                        {"dep-a/index.js": "A\n", "dep-b/lib/util.js": "B\n"})
    p = run(tmp_path, "populate", str(lock), str(src))
    assert p.returncode == 0, p.stderr
    target = tmp_path / "fresh_worktree" / "node_modules"
    target.parent.mkdir(parents=True)
    p = run(tmp_path, "restore", str(lock), str(target))
    assert p.returncode == 0, p.stderr
    assert (target / "dep-a/index.js").read_text() == "A\n"
    assert (target / "dep-b/lib/util.js").read_text() == "B\n"


def test_restore_misses_with_exit_3_when_never_populated(tmp_path):
    lock = make_lockfile(tmp_path, "uv.lock", "never-cached\n")
    target = tmp_path / "t" / ".venv"
    target.parent.mkdir(parents=True)
    p = run(tmp_path, "restore", str(lock), str(target))
    assert p.returncode == 3, (p.returncode, p.stdout, p.stderr)
    assert not target.exists()


def test_changed_lockfile_content_misses_with_exit_3(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "dep-a@1.0.0\n")
    src = make_deps_dir(tmp_path, "node_modules", {"dep-a/index.js": "A\n"})
    assert run(tmp_path, "populate", str(lock), str(src)).returncode == 0
    t1 = tmp_path / "w1" / "node_modules"; t1.parent.mkdir(parents=True)
    assert run(tmp_path, "restore", str(lock), str(t1)).returncode == 0
    lock.write_text("dep-a@1.0.1\n")
    t2 = tmp_path / "w2" / "node_modules"; t2.parent.mkdir(parents=True)
    p = run(tmp_path, "restore", str(lock), str(t2))
    assert p.returncode == 3, (p.returncode, p.stdout, p.stderr)
    assert not t2.exists()


def test_populate_is_idempotent(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "dep-a@1.0.0\n")
    src = make_deps_dir(tmp_path, "node_modules", {"dep-a/index.js": "A\n"})
    assert run(tmp_path, "populate", str(lock), str(src)).returncode == 0
    assert run(tmp_path, "populate", str(lock), str(src)).returncode == 0
    target = tmp_path / "w" / "node_modules"; target.parent.mkdir(parents=True)
    p = run(tmp_path, "restore", str(lock), str(target))
    assert p.returncode == 0, p.stderr
    assert (target / "dep-a/index.js").read_text() == "A\n"


def test_restore_rejects_missing_lockfile(tmp_path):
    target = tmp_path / "t"; target.mkdir()
    p = run(tmp_path, "restore", str(tmp_path / "does_not_exist.lock"), str(target))
    assert p.returncode == 2, (p.returncode, p.stdout, p.stderr)
    assert "lockfile" in p.stderr.lower()


def test_populate_rejects_missing_source_dir(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "x\n")
    p = run(tmp_path, "populate", str(lock), str(tmp_path / "no_such_dir"))
    assert p.returncode == 2, (p.returncode, p.stdout, p.stderr)
    assert "source" in p.stderr.lower()


def test_rejects_unknown_subcommand_and_bad_arity(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "x\n")
    p = run(tmp_path, "frobnicate", str(lock), str(tmp_path))
    assert p.returncode == 2
    assert "usage" in p.stderr.lower()
    p = run(tmp_path, "restore", str(lock))
    assert p.returncode == 2
    assert "usage" in p.stderr.lower()


def test_no_args_prints_usage(tmp_path):
    p = run(tmp_path)
    assert p.returncode == 2
    assert "usage" in p.stderr.lower()
```

- [ ] **Step 2: Run RED**

```bash
python3 -m pytest tests/test_warm_cache.py -q
```
Expected: every test errors/fails (the script does not exist yet).

- [ ] **Step 3: Write `skills/ultrapowers/scripts/warm_cache.sh`**

```bash
#!/usr/bin/env bash
# Lockfile-keyed warm dependency cache + hardlink-clone helper (spec §2.3a).
#
# The engine re-bootstraps every fresh worktree (pip install -e ., bun install,
# …) per worktree, per task, per fix-round — the dominant run cost. This helper
# lets the engine bootstrap a dependency tree ONCE into a warm cache keyed by the
# lockfile's content hash, then hardlink-clone it into each worktree near-
# instantly.
#
# CORRECTNESS NEVER DEPENDS ON THIS CACHE. A `restore` miss exits 3 so the caller
# runs a normal install; a changed lockfile misses by construction.
#
# Usage:
#   warm_cache.sh restore  <lockfile> <target_dir>   # exit 0 = HIT, exit 3 = MISS
#   warm_cache.sh populate <lockfile> <source_dir>   # cache <source_dir>; idempotent
set -euo pipefail

CACHE="${CLAUDE_PLUGIN_DATA:-$HOME/.ultrapowers/cache}/deps"

usage() {
  echo "usage: warm_cache.sh restore  <lockfile> <target_dir>   (exit 0=HIT, 3=MISS)" >&2
  echo "       warm_cache.sh populate <lockfile> <source_dir>   (cache deps; idempotent)" >&2
  exit 2
}

hash_lockfile() {
  local lockfile="$1" line
  if command -v shasum >/dev/null 2>&1; then
    line="$(shasum -a 256 "$lockfile")"
  elif command -v sha256sum >/dev/null 2>&1; then
    line="$(sha256sum "$lockfile")"
  else
    echo "error: neither shasum nor sha256sum is available to hash the lockfile" >&2
    exit 1
  fi
  printf '%s' "${line%% *}"
}

clone_tree() {
  local src="$1" dst="$2"
  mkdir -p "$dst"
  if cp_al_supported; then
    cp -al "$src/." "$dst/"
  else
    cp -aR "$src/." "$dst/"
  fi
}

_CP_AL=""
cp_al_supported() {
  if [ -z "$_CP_AL" ]; then
    local probe src dst
    probe="$(mktemp -d)"
    src="$probe/s"; dst="$probe/d"
    mkdir -p "$src"; : > "$src/f"
    if cp -al "$src/." "$dst/" >/dev/null 2>&1; then
      _CP_AL="yes"
    else
      _CP_AL="no"
    fi
    rm -rf "$probe"
  fi
  [ "$_CP_AL" = "yes" ]
}

cmd_restore() {
  [ "$#" -eq 2 ] || usage
  local lockfile="$1" target_dir="$2" hash entry
  [ -f "$lockfile" ] || { echo "error: lockfile not found or not a file: $lockfile" >&2; exit 2; }
  hash="$(hash_lockfile "$lockfile")"
  entry="$CACHE/$hash"
  if [ ! -d "$entry" ]; then
    echo "warm_cache: MISS $hash (no entry) — caller should run a real install" >&2
    exit 3
  fi
  clone_tree "$entry" "$target_dir"
  echo "warm_cache: HIT $hash -> $target_dir"
  exit 0
}

cmd_populate() {
  [ "$#" -eq 2 ] || usage
  local lockfile="$1" source_dir="$2" hash entry tmp
  [ -f "$lockfile" ] || { echo "error: lockfile not found or not a file: $lockfile" >&2; exit 2; }
  [ -d "$source_dir" ] || { echo "error: source_dir not found or not a directory: $source_dir" >&2; exit 2; }
  hash="$(hash_lockfile "$lockfile")"
  entry="$CACHE/$hash"
  mkdir -p "$CACHE"
  if [ -d "$entry" ]; then
    echo "warm_cache: already cached $hash (no-op)"
    exit 0
  fi
  tmp="$(mktemp -d "$CACHE/.tmp.XXXXXX")"
  clone_tree "$source_dir" "$tmp"
  if mv "$tmp" "$entry" 2>/dev/null; then
    echo "warm_cache: cached $hash"
  else
    rm -rf "$tmp"
    echo "warm_cache: already cached $hash (won by a concurrent populate)"
  fi
  exit 0
}

[ "$#" -ge 1 ] || usage
subcommand="$1"; shift
case "$subcommand" in
  restore)  cmd_restore  "$@" ;;
  populate) cmd_populate "$@" ;;
  *)        usage ;;
esac
```

Then make it executable:

```bash
chmod +x skills/ultrapowers/scripts/warm_cache.sh
```

- [ ] **Step 4: Run GREEN**

```bash
python3 -m pytest tests/test_warm_cache.py -q && \
test -x skills/ultrapowers/scripts/warm_cache.sh && echo "executable ok" && \
python3 -m pytest tests/ -q
```
Expected: all warm_cache tests pass; the script is `+x`; the full suite stays green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/warm_cache.sh tests/test_warm_cache.py
git commit -m "feat: lockfile-keyed warm dependency cache + hardlink-clone helper (spec 2.3a)"
```

---

### Task 5: README cleanups (path drift, Delete label, v6 attestation)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `README.md`

This task fixes three honesty defects in `README.md` surfaced by the spec's "Folded-in cleanups": a stale engine path (`workflow.js`, which no longer exists — the engine lives at `harnesses/waves.js`), a `Delete:`-label reconciliation, and a version-attestation claim pointing at the wrong Superpowers version. All three are prose edits with no test pins; verification is greps + `validate_skill.py` staying green.

Concurrency note: edits only `README.md` — disjoint from every other task.

- [ ] **Step 1: Replace the two stale `workflow.js` references with the engine's real path**

First, the bullet near line 37–38. Find:

```
- **Deterministic orchestration — and deterministic compilation.** The engine is a frozen,
  version-controlled Dynamic Workflow script (`skills/ultrapowers/workflow.js`) with the review
```

Replace with:

```
- **Deterministic orchestration — and deterministic compilation.** The engine is a frozen,
  version-controlled Dynamic Workflow script (`skills/ultrapowers/harnesses/waves.js`) with the review
```

Second, the "Deep dive" pointer near line 99–102. Find:

```
Deep dive: [`skills/ultrapowers/SKILL.md`](skills/ultrapowers/SKILL.md) is the front door;
[`skills/ultrapowers/references/`](skills/ultrapowers/references/) covers dependency analysis,
the reviewer prompts and schemas, wave-merge mechanics, the report format, and the maintainer
guide for `workflow.js`.
```

Replace with:

```
Deep dive: [`skills/ultrapowers/SKILL.md`](skills/ultrapowers/SKILL.md) is the front door;
[`skills/ultrapowers/references/`](skills/ultrapowers/references/) covers dependency analysis,
the reviewer prompts and schemas, wave-merge mechanics, the report format, and the maintainer
guide for `harnesses/waves.js`.
```

- [ ] **Step 2: Reconcile the `Delete:` file-label mention (minimal honest edit: confirm no edit needed in README)**

The decision taken is to **drop the mention** (not implement `Delete:`), keeping `compile_plan.py`'s `FILE_LINE` regex authoritative at `Create|Modify|Test`. For `README.md` specifically, the minimal honest edit is **no change**: `grep -ni 'delete' README.md` returns nothing (exit 1), so the README carries no `Delete:` file-label mention to drop. (The `Delete:` reconciliation belongs to the compat/SKILL.md surface, handled in Task 8.) This step exists so the omission is deliberate and auditable; the Step 4 verification (`grep -n 'Delete' README.md` returns nothing) confirms it. **Make no edit in this step.**

- [ ] **Step 3: Update the "validated against 5.1.0" claim to name the vendored v6 snapshot**

Find the "Built for drift" bullet near line 45–50:

```
- **Built for drift.** ultrapowers depends on two substrates it doesn't control: superpowers'
  plan conventions and the experimental Workflow engine. Both are tripwired. Compat tests
  (`tests/test_superpowers_compat.py`) read the *installed* superpowers plugin and fail loudly if
  the contract ultrapowers parses changes (validated against 5.1.0, attested in the skill); a
  zero-agent probe workflow launches before every real run, so engine drift becomes a clean
  sequential fallback instead of a mid-run crash.
```

Replace with:

```
- **Built for drift.** ultrapowers depends on two substrates it doesn't control: superpowers'
  plan conventions and the experimental Workflow engine. Both are tripwired. Compat tests
  (`tests/test_superpowers_compat.py`) read the vendored Superpowers snapshot and fail loudly if
  the contract ultrapowers parses changes (validated against the vendored Superpowers v6 snapshot (dev 08fc48c) in tests/fixtures/superpowers-v6/, attested in the skill); a
  zero-agent probe workflow launches before every real run, so engine drift becomes a clean
  sequential fallback instead of a mid-run crash.
```

(The "read the *installed* superpowers plugin" clause is corrected to "read the vendored Superpowers snapshot" in the same edit, because v6 is unreleased and the compat source-of-truth now resolves to the vendored fixture. The GA-flip seam restores "installed" wording when v6 publishes.)

- [ ] **Step 4: Verify the cleanups and validate the skill**

```bash
grep -n 'workflow.js' README.md; echo "workflow.js exit=$?"
grep -n '5.1.0' README.md; echo "5.1.0 exit=$?"
grep -n 'Delete' README.md; echo "Delete exit=$?"
grep -n 'harnesses/waves.js' README.md
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers
```
Expected: `workflow.js` prints nothing, `exit=1`; `5.1.0` prints nothing, `exit=1`; `Delete` prints nothing, `exit=1`; `harnesses/waves.js` prints two lines; `validate_skill.py` prints `skill ok`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(README): fix workflow.js path drift, drop stale 5.1.0 claim, attest vendored v6 snapshot"
```

---

### Task 6: Micro-test loop + measurement protocol

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/scripts/run-micro.py`
- Modify: `evals/README.md`
- Test: `tests/test_run_micro.py`

Files-note — `evals/scripts/run-micro.py` (the one-API-call-per-sample micro-test loop)
Files-note — `evals/README.md` (append the micro-test loop, re-freeze protocol, and cost-attribution table sections)
Files-note — `tests/test_run_micro.py` (offline — exercises the pure scorer + per-variant aggregation, never a live API call)

This task implements spec §2.4 (the micro-test harness) and §2.5 (the measurement protocol). It is the cheap prompt-phrasing instrument used *before* spending on full runs: one API call per sample, programmatic scoring, an always-present no-guidance control, and per-variant mean + variance. The model call is isolated behind an injectable `call_model` so the unit test runs the scorer and aggregation offline.

Concurrency note: creates one script + one test and appends to `evals/README.md` — disjoint from every other task; the offline test needs no network.

- [ ] **Step 1: Write the failing offline test for the scorer + aggregation**

```python
"""Offline unit tests for the micro-test loop (evals/scripts/run-micro.py).

The live model call is injected, so these tests never touch the network or an
API key: we drive run_variant with a fake call_model and assert on the pure
scorer registry and the mean/variance aggregation."""
import importlib.util
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "run_micro",
    Path(__file__).resolve().parents[1] / "evals" / "scripts" / "run-micro.py",
)
run_micro = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(run_micro)


def test_scorer_registry_contains_known_scorers():
    assert "json_object" in run_micro.SCORERS
    assert "nonempty" in run_micro.SCORERS


def test_json_object_scorer_scores_shape_not_content():
    score = run_micro.SCORERS["json_object"]
    assert score('{"ok": true}', sample={}) == 1.0
    assert score("here is your json: {}", sample={}) == 0.0
    assert score("", sample={}) == 0.0


def test_nonempty_scorer():
    score = run_micro.SCORERS["nonempty"]
    assert score("x", sample={}) == 1.0
    assert score("   ", sample={}) == 0.0


def test_aggregate_reports_mean_and_variance():
    agg = run_micro.aggregate([1.0, 1.0, 1.0])
    assert agg["mean"] == 1.0
    assert agg["variance"] == 0.0
    assert agg["n"] == 3
    agg = run_micro.aggregate([0.0, 1.0])
    assert agg["mean"] == 0.5
    assert agg["variance"] == pytest.approx(0.25)


def test_aggregate_empty_is_safe():
    agg = run_micro.aggregate([])
    assert agg["n"] == 0
    assert agg["mean"] == 0.0
    assert agg["variance"] == 0.0


def test_run_variant_uses_injected_call_model_offline():
    calls = []

    def fake_call_model(prompt):
        calls.append(prompt)
        return '{"answer": 42}'

    result = run_micro.run_variant(
        name="recipe",
        instruction="Return a JSON object.",
        samples=[{"task": "a"}, {"task": "b"}, {"task": "c"}],
        scorer="json_object",
        call_model=fake_call_model,
    )
    assert len(calls) == 3
    assert result["name"] == "recipe"
    assert result["n"] == 3
    assert result["mean"] == 1.0
    assert result["variance"] == 0.0


def test_run_suite_always_includes_no_guidance_control():
    def fake_call_model(prompt):
        return '{}'

    report = run_micro.run_suite(
        variants=[{"name": "recipe", "instruction": "Return a JSON object."}],
        samples=[{"task": "a"}],
        scorer="json_object",
        call_model=fake_call_model,
    )
    names = [v["name"] for v in report["variants"]]
    assert run_micro.CONTROL_NAME in names
    assert "recipe" in names
```

- [ ] **Step 2: Run RED**

```bash
python3 -m pytest tests/test_run_micro.py -q
```
Expected: collection/import error — `evals/scripts/run-micro.py` does not exist.

- [ ] **Step 3: Write `evals/scripts/run-micro.py` in full**

```python
#!/usr/bin/env python3
"""Micro-test loop: one API call per sample, programmatic scoring, always a
no-guidance control.

Purpose (spec §2.4): tune prompt PHRASING cheaply before spending on a full eval
run. A no-guidance CONTROL variant is injected automatically, so every phrasing
is measured against "say nothing at all". The model call is injected
(`call_model`), so the scorer and aggregation are pure and unit-tested offline.

Usage:
    evals/scripts/run-micro.py --variants variants.json --scorer json_object \\
        --samples samples.json --n 5
"""
import argparse
import json
import os
import statistics
import sys
from pathlib import Path

CONTROL_NAME = "control-no-guidance"


def _score_json_object(output, sample):
    """1.0 iff the WHOLE output parses as a JSON object; 0.0 otherwise."""
    try:
        parsed = json.loads(output)
    except (ValueError, TypeError):
        return 0.0
    return 1.0 if isinstance(parsed, dict) else 0.0


def _score_nonempty(output, sample):
    return 1.0 if isinstance(output, str) and output.strip() else 0.0


SCORERS = {
    "json_object": _score_json_object,
    "nonempty": _score_nonempty,
}


def aggregate(scores):
    """Mean + population variance over a list of per-sample scores. Empty-safe."""
    scores = list(scores)
    n = len(scores)
    if n == 0:
        return {"n": 0, "mean": 0.0, "variance": 0.0}
    mean = statistics.fmean(scores)
    variance = statistics.pvariance(scores) if n > 1 else 0.0
    return {"n": n, "mean": mean, "variance": variance}


def compose_prompt(instruction, sample):
    body = json.dumps(sample, sort_keys=True)
    return (instruction + "\n\n" + body) if instruction.strip() else body


def run_variant(name, instruction, samples, scorer, call_model):
    score_fn = SCORERS[scorer]
    scores = []
    for sample in samples:
        prompt = compose_prompt(instruction, sample)
        output = call_model(prompt)
        scores.append(score_fn(output, sample))
    agg = aggregate(scores)
    return {"name": name, **agg}


def run_suite(variants, samples, scorer, call_model):
    if scorer not in SCORERS:
        raise SystemExit(
            "unknown scorer %r; known: %s" % (scorer, ", ".join(sorted(SCORERS)))
        )
    authored = list(variants)
    if not any(v.get("name") == CONTROL_NAME for v in authored):
        authored = [{"name": CONTROL_NAME, "instruction": ""}] + authored
    results = []
    for v in authored:
        results.append(
            run_variant(
                name=v["name"],
                instruction=v.get("instruction", ""),
                samples=samples,
                scorer=scorer,
                call_model=call_model,
            )
        )
    return {"scorer": scorer, "variants": results}


def default_call_model(model="claude-opus-4-8", max_tokens=1024):
    from anthropic import Anthropic  # lazy: import cost + key only on live use

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("ANTHROPIC_API_KEY is not set (required for live runs)")
    client = Anthropic()

    def call_model(prompt):
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(
            block.text for block in resp.content if getattr(block, "type", None) == "text"
        )

    return call_model


def _load_json(path):
    return json.loads(Path(path).read_text())


def main(argv=None):
    p = argparse.ArgumentParser(description="Micro-test loop for prompt phrasing.")
    p.add_argument("--variants", required=True, help="JSON list of {name, instruction}")
    p.add_argument("--samples", required=True, help="JSON list of sample dicts")
    p.add_argument("--scorer", required=True, choices=sorted(SCORERS))
    p.add_argument("--n", type=int, default=None, help="cap samples to the first N")
    p.add_argument("--model", default="claude-opus-4-8")
    args = p.parse_args(argv)

    variants = _load_json(args.variants)
    samples = _load_json(args.samples)
    if args.n is not None:
        samples = samples[: args.n]

    report = run_suite(
        variants=variants,
        samples=samples,
        scorer=args.scorer,
        call_model=default_call_model(model=args.model),
    )
    rows = sorted(
        report["variants"],
        key=lambda r: (r["name"] != CONTROL_NAME, -r["mean"]),
    )
    print("scorer: %s   (n=%d samples/variant)" % (report["scorer"], len(samples)))
    print("%-28s %6s %9s %9s" % ("variant", "n", "mean", "var"))
    for r in rows:
        print("%-28s %6d %9.3f %9.4f" % (r["name"], r["n"], r["mean"], r["variance"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run GREEN**

```bash
python3 -m pytest tests/test_run_micro.py -q && python3 -m pytest tests/ -q
```
Expected: all tests pass with no network touched; the full suite stays green (`run-micro.py` lives under `evals/scripts/`, which pytest does not collect).

- [ ] **Step 5: Append the protocol sections to `evals/README.md`**

Append the following Markdown to the end of `evals/README.md`:

````markdown
## Micro-test loop (prompt-phrasing tuning before full runs)

The 45-cell matrix is the expensive, slow instrument. Before spending a single
matrix run on a prompt change, tune the **phrasing** with the micro-test loop —
one API call per sample, programmatic scoring, seconds and ~$0.15–0.30 per
sample:

```sh
evals/scripts/run-micro.py --variants variants.json --scorer json_object \
    --samples samples.json --n 5
```

`variants.json` is a list of `{name, instruction}` phrasings; `samples.json` is a
list of sample dicts; `--scorer` names a programmatic check (`json_object`,
`nonempty`, …) registered in `SCORERS`. The loop prints each variant's **mean**
and **variance**.

**It always runs a no-guidance control.** A `control-no-guidance` variant (empty
instruction) is injected automatically and sorted to the top. That control is the
bar every phrasing must clear: the v6 work measured that a *prohibition* on output
shape can score **below** saying nothing at all. The rule that follows —
**positive recipe, not prohibition** — is exactly what this loop is for. Use it to
tune the baked reviewer/implementer contracts (§2.4) before committing to a full
run. The model call is injected, so the scorer and aggregation are unit-tested
offline in `tests/test_run_micro.py`.

## Re-freeze protocol (when engine behavior changes)

Engine-behavior changes (new prompts, new tiering, the v6 integration) invalidate
the frozen baseline. To re-measure:

1. **Bump the engine `0.0.x` version.** The plugin version is the behavior proxy
   `report.py` partitions on; a behavior change with no version bump silently
   pools two different engines.
2. **Re-run the 45-cell matrix fresh on the new frozen version.** Do not reuse
   rows produced by an older `plugin_version`. Old rows remain valid *as that
   version's population* — historical, not current.
3. **Never pool across `plugin_version`.** `report.py` partitions medians by
   `plugin_version` and never pools across versions. Do not defeat this by hand.

The old population is not deleted; it is a different engine. Report the re-frozen
engine as its own population beside the prior one, never merged into it.

## Per-component cost-attribution (finding the hot spots)

Headline USD-per-run says *whether* a run was expensive; it does not say *where*
the cost went. Attribute cost per component using the per-role turn/output-token
proxies from `scripts/audit_run.py`. Fill one table per run (or per median cell):

| Component | Turns | Output tokens | Share of run cost | Notes |
|-----------|------:|--------------:|------------------:|-------|
| Controller (orchestration) | | | | setup + wave planning + gate decisions |
| Implementers (all tasks) | | | | the generative bulk; tiered model |
| Reviewers (per-task) | | | | always-opus; the live-git + suite-run sink |
| Final review (completeness critic) | | | | opus on the integrated tree |
| **Total** | | | **100%** | reconcile against `/cost` or `extract_tokens.py` |

Read the table for **share of run cost**, not absolute tokens: the largest share
is the first place an efficiency lever pays off. Re-fill it after any efficiency
change to confirm the share actually moved.
````

- [ ] **Step 6: Verify the README edit and the full suite**

```bash
python3 -m pytest tests/ -q && \
chmod +x evals/scripts/run-micro.py && \
python3 evals/scripts/run-micro.py --help
```
Expected: `pytest tests/` green; `--help` prints the usage (proving the module imports without `anthropic` or an API key).

- [ ] **Step 7: Commit**

```bash
git add evals/scripts/run-micro.py tests/test_run_micro.py evals/README.md
git commit -m "feat(evals): micro-test loop + re-freeze and cost-attribution protocol (spec 2.4, 2.5)"
```

---

### Task 7: Strengthen the DAG with Interfaces (Consumes/Produces)

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Modify: `evals/fixtures/flawed/plan.md`, `evals/fixtures/flawed/version.txt`

Files-note — `skills/ultrapowers/scripts/compile_plan.py` (a new `interface` edge tier in `build_edges`, before layering, plus the undeclared-dependency finding)
Files-note — `tests/test_compile_plan.py` (new failing-first tests)
Files-note — `skills/ultrapowers/references/dependency-analysis.md` (document Interfaces-as-edge-source + the undeclared-dependency finding)
Files-note — `evals/fixtures/flawed/plan.md` (add `**Interfaces:**` to Tasks 1 and 4) and `evals/fixtures/flawed/version.txt` (bump the version note)

This task implements spec §1.3 — *judgment call #1*. It builds on Task 2's `task.interfaces` field (hence `Depends-on: 2`). When Task B `Consumes` an entry that exactly matches an entry Task A `Produces`, B depends on A; add a producer→consumer edge (`add(A, B, "interface")`, i.e. `{"from": A, "to": B}`, the codebase's "from = prerequisite" convention) into the edge set **before** layering, so the Interfaces edge joins file-overlap / `Depends-on` / text-dep edges in the Kahn layering.

Matching is **exact-token, normalized — never fuzzy/substring** (spec §1.3: "a false edge would silently re-order waves; when in doubt, add no edge"). Normalize each Consumes/Produces entry to its leading symbol token (strip surrounding backticks/whitespace; take the identifier up to the first `(`, space, or `:` — so `` `User` dataclass (...)`` and `` `User` `` both normalize to `User`, and `validate_payload(payload) -> list[str]` to `validate_payload`). Two entries match only on **exact string equality of their normalized tokens**. A `Consumes` with no matching `Produces` is **not** an error.

When an Interfaces-implied edge is **not already covered** by a `Depends-on` marker or a file-overlap edge (write-after-create / write-after-write / read-after-write), emit a loud **"undeclared dependency"** finding into the same `marker_conflicts` channel the compiler uses for near-miss conflicts, with `kind="undeclared-dependency"`. The plan still compiles and runs correctly — the finding tells the author their `Depends-on` was wrong.

The `flawed` eval fixture is the regression target. It already lands Task 4 in wave 2 via a `prose-reference` edge (Task 4's prose backticks `schema.User`); adding `**Interfaces:**` makes the dependency explicit and exact-token, and — because Task 4 keeps its load-bearing `**Depends-on:** none` and creates a disjoint file (`store.py`) — the new `interface` edge is NOT covered, so it fires the undeclared-dependency finding.

Concurrency note: edits `compile_plan.py` and `tests/test_compile_plan.py` (shared with Task 2, hence `Depends-on: 2`) plus the disjoint `dependency-analysis.md` and the `flawed` fixture files.

- [ ] **Step 1: Add the `**Interfaces:**` blocks to the `flawed` fixture**

In `evals/fixtures/flawed/plan.md`, add an `**Interfaces:**` block to Task 1 (Produces `User`) and Task 4 (Consumes `User`), AFTER each task's `**Files:**` block and BEFORE its first `- [ ]` step. Do **not** touch Task 4's `**Depends-on:** none` line.

For Task 1, change:

```markdown
**Files:**
- Create: `apistub/schema.py`
- Test: `tests/test_schema.py`

- [ ] **Step 1: Write failing tests** for the schema module:
```

to:

```markdown
**Files:**
- Create: `apistub/schema.py`
- Test: `tests/test_schema.py`

**Interfaces:**
- Produces: `User` dataclass (id: int, name: str, email: str)
- Produces: `FIELDS` dict {"name": str, "email": str}

- [ ] **Step 1: Write failing tests** for the schema module:
```

For Task 4, change:

```markdown
**Files:**
- Create: `apistub/store.py`
- Test: `tests/test_store.py`

- [ ] **Step 1: Write failing tests** for `class MemoryStore`:
```

to:

```markdown
**Files:**
- Create: `apistub/store.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Consumes: `User` dataclass (id: int, name: str, email: str)

- [ ] **Step 1: Write failing tests** for `class MemoryStore`:
```

Then bump `evals/fixtures/flawed/version.txt`. Change its first line from `1-flawed (2026-06-14)` to `2-flawed (2026-06-16)` and append:

```
v2 adds v6 **Interfaces:** blocks (Task 1 Produces `User`; Task 4 Consumes `User`)
so the undeclared-dependency now surfaces as an exact-token Interfaces edge — the
bug is unchanged (Task 4 still declares Depends-on: none).
```

- [ ] **Step 2: Add failing tests to `tests/test_compile_plan.py`**

```python
EVAL_FLAWED = ROOT / "evals/fixtures/flawed/plan.md"


def test_flawed_fixture_interface_edge_orders_task4_after_task1():
    out = compile_plan(EVAL_FLAWED)
    assert {"from": "1", "to": "4", "why": "interface"} in out["dag_edges"]
    wave_of = {tid: i for i, wave in enumerate(out["waves"]) for tid in wave}
    assert wave_of["4"] > wave_of["1"]
    assert "4" not in out["waves"][0]


def test_flawed_fixture_emits_undeclared_dependency_finding():
    out = compile_plan(EVAL_FLAWED)
    findings = [c for c in out["marker_conflicts"]
                if c.get("kind") == "undeclared-dependency"]
    assert any(c["task"] == "4" and "1 -> 4" in c["edge"]
               and "undeclared" in c["note"].lower() for c in findings)


def test_interface_edge_requires_exact_token_match(tmp_path):
    plan = tmp_path / "nearmiss-iface.md"
    plan.write_text(
        "# Plan: Near-miss interface\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: producer\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.py`\n\n"
        "**Interfaces:**\n- Produces: `User`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task 2: near consumer\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `b.py`\n\n"
        "**Interfaces:**\n- Consumes: `Users`\n\n"
        "- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "interface" for e in out["dag_edges"])
    assert not any(c.get("kind") == "undeclared-dependency"
                   for c in out["marker_conflicts"])
    assert out["waves"] == [["1", "2"]]


def test_interface_edge_covered_by_marker_emits_no_finding(tmp_path):
    plan = tmp_path / "covered-iface.md"
    plan.write_text(
        "# Plan: Covered interface\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: producer\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.py`\n\n"
        "**Interfaces:**\n- Produces: `User` dataclass\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task 2: declared consumer\n\n**Type:** implementation\n**Depends-on:** 1\n\n"
        "**Files:**\n- Create: `b.py`\n\n"
        "**Interfaces:**\n- Consumes: `User` dataclass (id, name)\n\n"
        "- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "interface"} in out["dag_edges"]
    assert not any(c.get("kind") == "undeclared-dependency"
                   for c in out["marker_conflicts"])
    assert out["waves"] == [["1"], ["2"]]
```

- [ ] **Step 3: Run the new tests and confirm they FAIL (RED)**

```bash
python3 -m pytest tests/test_compile_plan.py -q -k "interface or flawed_fixture"
```
Expected: all four FAIL — there is no `interface` edge tier yet, no `undeclared-dependency` kind, and the `flawed` fixture lands Task 4 only via `prose-reference`.

- [ ] **Step 4: Add the `interface` edge tier to `build_edges` in `compile_plan.py`**

First, add a normalization helper at module scope, near `prose_references` (after its definition, after line 458):

```python
# Interface-token normalization (v6, spec 2026-06-16 §1.3). A Consumes/Produces
# entry is matched by EXACT token equality — no substring/fuzzy match. Normalize
# to the leading symbol token: strip a leading bullet/label residue and backticks,
# then take the identifier up to the first '(' , whitespace, or ':' so
# "`User` dataclass (id: int)" and "`User`" both reduce to "User", and
# "validate_payload(payload) -> list[str]" reduces to "validate_payload".
def _interface_token(entry):
    s = entry.strip().strip("`").strip()
    if not s:
        return ""
    return re.split(r"[(\s:]", s, 1)[0].strip("`").strip()
```

Then add the new tier inside `build_edges`, placed **immediately after the Tier 2 semantic loop** (the write-after-create / write-after-write / read-after-write rules) and **BEFORE the Tier 2.5 prose-reference comment** (line ~579). This placement is load-bearing: `add()` keeps the first `why` for a given `(from, to)` pair, so recording the `interface` edge before prose-reference lets the explicit Interfaces signal win the label on the `flawed` fixture's `1 -> 4` edge. Insert:

```python
    # Interface tier (v6, spec 2026-06-16 §1.3). When B Consumes a symbol A
    # Produces (EXACT normalized-token equality — never fuzzy), B depends on A:
    # add a producer -> consumer edge. Recorded BEFORE the Tier 2.5 prose-
    # reference loop so that when both would order the same pair, the explicit
    # Interfaces edge wins the `why` label via add()'s first-wins dedup. Like
    # prose-reference the symbols may not map to files, so it is cycle-guarded.
    # Every edge NOT already covered by a Depends-on marker or a file-overlap edge
    # is surfaced as a loud "undeclared dependency" finding: the plan runs
    # correctly AND the author is told their Depends-on was wrong. A Consumes with
    # no matching Produces is not an error.
    produced = {a["id"]: {tok for p in a["interfaces"]["produces"]
                          if (tok := _interface_token(p))}
                for a in impl}
    for b in impl:
        b_consumes = {tok for c in b["interfaces"]["consumes"]
                      if (tok := _interface_token(c))}
        if not b_consumes:
            continue
        for a in impl:
            if a["id"] == b["id"]:
                continue
            if not (b_consumes & produced.get(a["id"], set())):
                continue
            if would_cycle(a["id"], b["id"]):
                continue
            declared = a["id"] in b["depends_on"]
            file_overlap = any(
                e["from"] == a["id"] and e["to"] == b["id"]
                and e["why"] in ("write-after-create", "write-after-write",
                                 "read-after-write")
                for e in edges)
            before = len(edges)
            add(a["id"], b["id"], "interface")
            added = len(edges) > before
            if not declared and not file_overlap:
                shared = sorted(b_consumes & produced[a["id"]])
                add_conflict(
                    b["id"],
                    "undeclared: " + a["id"] + " -> " + b["id"] + " (interface)",
                    "undeclared dependency: Task " + b["id"] + " Consumes "
                    + ", ".join(shared[:3]) + " which Task " + a["id"]
                    + " Produces, but Task " + b["id"]
                    + " does not declare **Depends-on:** " + a["id"]
                    + " and shares no file with it — add the marker"
                    + ("" if added else " (edge already present)"),
                    kind="undeclared-dependency")
```

The `"undeclared: "` edge-key prefix mirrors the existing prose-reference `"inferred: "` prefix: it keeps this note distinct in the `conflict_seen` dedup set.

- [ ] **Step 5: Run the new tests and confirm GREEN, then the full suite**

```bash
python3 -m pytest tests/test_compile_plan.py -q -k "interface or flawed_fixture" && \
python3 -m pytest tests/ -q && \
python3 -m pytest evals/scripts/tests/test_fixtures.py -q && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers
```
Expected: the four new tests pass — including `test_flawed_fixture_interface_edge_orders_task4_after_task1`, whose `{"from": "1", "to": "4", "why": "interface"}` assertion holds because the interface tier (Step 4) records the `1 -> 4` pair before the prose-reference tier. `tests/` stays green; `evals/scripts/tests/test_fixtures.py` stays green (Task 4 still declares `Depends-on: none`, so `test_flawed_preserves_the_buggy_task4` holds); `validate_skill.py` prints `skill ok`.

- [ ] **Step 6: Document Interfaces-as-edge-source and the finding in `dependency-analysis.md`**

In `skills/ultrapowers/references/dependency-analysis.md`, add a new numbered rule to the "Build the DAG" list (after rule 6, the prose-reference rule at line 74):

```markdown
7. **Interface (Consumes/Produces):** B's `**Interfaces:**` block `Consumes:` a symbol that A's `**Interfaces:**` block `Produces:`. Matching is **exact normalized-token equality** — each entry is reduced to its leading symbol token and compared by string equality; there is **no** substring or fuzzy matching (a false edge would silently re-order waves). Edge A → B (`why: "interface"`), producer → consumer. Order-independent in direction but cycle-guarded like prose-reference. A `Consumes` entry with no matching `Produces` anywhere is **not** an error. Every interface edge that is **not** already covered by a `**Depends-on:**` marker or a file-overlap edge (write-after-create / write-after-write / read-after-write) is surfaced in `marker_conflicts` as a loud **undeclared-dependency** finding (`kind: "undeclared-dependency"`) — the plan still compiles and runs, and the author is told their `Depends-on` was wrong. Motivating case: the `flawed` eval fixture — Task 4's store `Consumes: User` which Task 1 `Produces: User`, while Task 4 declares `Depends-on: none`; the interface edge orders Task 4 after Task 1 and the omission is reported.
```

Also update the `why`-labels line (line 78) from:

```markdown
Edge `why` labels emitted by the compiler: `marker`, `write-after-create`, `write-after-write`, `read-after-write`, `prose-reference`, `text`, `ambiguous-files`.
```

to:

```markdown
Edge `why` labels emitted by the compiler: `marker`, `write-after-create`, `write-after-write`, `read-after-write`, `interface`, `prose-reference`, `text`, `ambiguous-files`.
```

And update the precedence paragraph (line 80). Change:

```markdown
`prose-reference` sits between the semantic rules and the document-order heuristics: order-independent in direction (creator → referencer) but cycle-guarded, so an explicit or semantic edge in the opposite direction always wins.
```

to:

```markdown
`interface` and `prose-reference` both sit between the semantic rules and the document-order heuristics: order-independent in direction (producer → consumer; creator → referencer) but cycle-guarded, so an explicit or semantic edge in the opposite direction always wins. `interface` is recorded before `prose-reference`, so when both would order the same pair the explicit Interfaces signal wins the `why` label.
```

Finally, extend the `marker_conflicts` comment in the transparency-block sample (lines 149–153). Change:

```markdown
marker_conflicts: []        # each entry carries kind: "conflict" (needs a human fix —
                            # unparseable type, ghost dep, near-miss spelling, dropped
                            # non-path Files token) or kind: "inference" (a benign edge the
                            # compiler inferred — e.g. a file edge overriding "Depends-on: none",
                            # or a prose-reference edge). Render the two buckets separately.
```

to:

```markdown
marker_conflicts: []        # each entry carries kind: "conflict" (needs a human fix —
                            # unparseable type, ghost dep, near-miss spelling, dropped
                            # non-path Files token), kind: "undeclared-dependency" (an
                            # Interfaces Consumes/Produces edge the author's Depends-on
                            # omitted — fix at authoring), or kind: "inference" (a benign
                            # edge the compiler inferred — e.g. a file edge overriding
                            # "Depends-on: none", or a prose-reference edge). Render the
                            # three buckets separately.
```

- [ ] **Step 7: Re-run the full verification and confirm GREEN**

```bash
python3 -m pytest tests/ -q && \
python3 -m pytest evals/scripts/tests/ -q && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan
```
Expected: `tests/` green (including the four new interface tests); `evals/scripts/tests/` green; both `validate_skill.py` runs print `skill ok`.

- [ ] **Step 8: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py skills/ultrapowers/references/dependency-analysis.md evals/fixtures/flawed/plan.md evals/fixtures/flawed/version.txt
git commit -m "feat(compile): Interfaces Consumes/Produces edges + undeclared-dependency finding (spec 1.3)"
```

---

### Task 8: Re-attest the compat tripwire to the vendored v6 snapshot

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `tests/test_superpowers_compat.py`
- Modify: `skills/ultrapowers/SKILL.md`

Files-note — `tests/test_superpowers_compat.py` (the source-of-truth path, the rebake/token assertions, the attestation-version regex)
Files-note — `skills/ultrapowers/SKILL.md` (the attestation line + a short note naming the new v6 plan signals)

This task implements spec §1.1's re-attestation half. Task 1 froze the pinned v6 handoff surface into `tests/fixtures/superpowers-v6/`; this task points the tripwire at that snapshot and updates what it attests against. v6 deleted `spec-reviewer-prompt.md` and `code-quality-reviewer-prompt.md` (merged into one `task-reviewer-prompt.md`) and added `## Global Constraints` and `**Interfaces:**`. The parser stays additive-tolerant — a v5 plan still compiles — so this task changes only what the suite ATTESTS.

The load-bearing decision: collapse the test's two scattered "where is the Superpowers source" sites — the module-level `CACHE` constant and the `installed()` version-walker — into a **single source-of-truth helper** carrying a clearly-commented **GA-FLIP SEAM**. The helper returns the vendored snapshot today; a one-line edit flips it to the live plugin cache when v6 reaches GA.

This also owns the `Delete:` reconciliation noted in the spec's cleanups: the compat/SKILL.md surface (not the README) is where any `Delete:` mention lives; keep `compile_plan.py`'s `FILE_LINE` (`Create|Modify|Test`) authoritative and do not introduce a `Delete:` contract token.

Concurrency note: edits `tests/test_superpowers_compat.py` and `skills/ultrapowers/SKILL.md` only — disjoint from every other task.

- [ ] **Step 1: Confirm the RED baseline**

Before the snapshot redirect, the suite still attests to 5.1.0 against the installed v5 cache, so the v6 assertions this task adds (the `task-reviewer-prompt.md` rebake source; the `## Global Constraints` / `**Interfaces:**` tokens) do not yet hold. To make the RED concrete, add ONLY the new v6 token assertions (Steps 4–5) on top of the unchanged source location first, then run:

```bash
python3 -m pytest tests/test_superpowers_compat.py -q
```
Expected: FAIL — `test_rebake_source_prompt_files_still_exist` asserts `task-reviewer-prompt.md` exists (the installed v5 cache has none), and `test_writing_plans_template_shape_unchanged` fails on the missing `## Global Constraints` / `**Interfaces:**` tokens. This proves the suite exercises the new v6 contract; the snapshot redirect in Step 2 is what turns it GREEN, not a weakening of the assertions.

- [ ] **Step 2: Collapse the source location into one helper with a GA-FLIP SEAM**

Replace the current module-level cache constant + skip guard (lines 10–14):

```python
ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = pathlib.Path.home() / ".claude/plugins/cache/claude-plugins-official/superpowers"

pytestmark = pytest.mark.skipif(
    not CACHE.exists(), reason="superpowers plugin not installed locally")
```

with:

```python
ROOT = pathlib.Path(__file__).resolve().parents[1]

# ── GA-FLIP SEAM ──────────────────────────────────────────────────────────────
# Superpowers v6 is unreleased, so there is no installed cache to attest against.
# We attest against the pinned v6 snapshot vendored under tests/fixtures/ (frozen
# from dev commit 08fc48c; see that dir's PROVENANCE note). When v6 reaches the
# marketplace, flip this ONE function back to the live plugin cache: replace the
# return body below with the two commented lines, and bump ATTESTED_VERSION to the
# published version string. Nothing else in this file changes — every read of the
# Superpowers source goes through superpowers_source().
ATTESTED_VERSION = "6.0.0-dev-08fc48c"


def superpowers_source():
    return ROOT / "tests/fixtures/superpowers-v6"
    # GA flip — when v6 publishes, delete the line above and uncomment these two,
    # then set ATTESTED_VERSION to the published version (e.g. "6.0.0"):
    # cache = pathlib.Path.home() / ".claude/plugins/cache/claude-plugins-official/superpowers"
    # return installed_version_dir(cache)


# Resolves the newest semver directory under the live plugin cache. Unused while
# the seam points at the vendored snapshot; kept intact so the GA flip is a pure
# one-liner. Exercised by test_version_key_sorts_numerically below.
def installed_version_dir(cache):
    versions = sorted((p for p in cache.iterdir() if p.is_dir()), key=_version_key)
    assert versions, "superpowers cache exists but holds no version directory"
    return versions[-1]


pytestmark = pytest.mark.skipif(
    not superpowers_source().exists(),
    reason="superpowers v6 snapshot missing (run Task 1 first)")
```

Rename the current `installed()` function (lines 36–39) to `installed_version_dir(cache)` (now taking the cache dir as an argument) and delete the old `installed()` definition. Leave `_version_key` (lines 29–33) and `test_version_key_sorts_numerically` (lines 42–45) unchanged.

- [ ] **Step 3: Re-thread every Superpowers read through `superpowers_source()`**

Replace each `installed()` call with `superpowers_source()`. The substitutions are mechanical. For example `test_every_handoff_skill_still_exists` becomes:

```python
def test_every_handoff_skill_still_exists():
    for name in HANDOFF_SKILLS:
        assert (superpowers_source() / "skills" / name / "SKILL.md").exists(), (
            f"superpowers:{name} is gone or renamed — ultrapowers hands off to it; "
            "re-audit SKILL.md Steps 1/5/6, ultraplan's Execution Handoff, and the "
            "re-bake sources in reviewer-prompts.md/wave-merge.md")
```

Apply the identical `installed()` → `superpowers_source()` swap in every other test body that reads a file. After this step `grep -n 'installed()' tests/test_superpowers_compat.py` returns nothing.

- [ ] **Step 4: Update the rebake-source assertion for the v6 unified reviewer**

`test_rebake_source_prompt_files_still_exist` currently reads:

```python
def test_rebake_source_prompt_files_still_exist():
    for rel in ("skills/subagent-driven-development/implementer-prompt.md",
                "skills/subagent-driven-development/spec-reviewer-prompt.md",
                "skills/subagent-driven-development/code-quality-reviewer-prompt.md",
                "skills/requesting-code-review/code-reviewer.md"):
        assert (superpowers_source() / rel).exists(), (
            rel + " is gone — reviewer-prompts.md names it as a re-bake source; "
            "re-audit the re-bake procedure in workflow-template.md")
```

Replace with v6's unified reviewer:

```python
def test_rebake_source_prompt_files_still_exist():
    for rel in ("skills/subagent-driven-development/implementer-prompt.md",
                "skills/subagent-driven-development/task-reviewer-prompt.md",
                "skills/requesting-code-review/code-reviewer.md"):
        assert (superpowers_source() / rel).exists(), (
            rel + " is gone — reviewer-prompts.md names it as a re-bake source; "
            "re-audit the re-bake procedure in workflow-template.md")
```

Then delete `test_code_quality_reviewer_still_delegates_to_code_reviewer_template` (lines 148–152): it reads `code-quality-reviewer-prompt.md`, which v6 deleted.

- [ ] **Step 5: Add the v6 plan-signal tokens to the writing-plans shape check**

`test_writing_plans_template_shape_unchanged` currently reads:

```python
def test_writing_plans_template_shape_unchanged():
    text = (superpowers_source() / "skills/writing-plans/SKILL.md").read_text()
    for token in ("Implementation Plan", "### Task N:", "**Files:**", "- [ ]",
                  "- Create:", "- Modify:", "- Test:", ":123-145"):
        assert token in text, (
            f"writing-plans template lost {token!r} — compile_plan.py and the "
            "Step-1 shape check parse this; re-audit dependency-analysis.md")
```

Add the two new v6 block tokens:

```python
def test_writing_plans_template_shape_unchanged():
    text = (superpowers_source() / "skills/writing-plans/SKILL.md").read_text()
    for token in ("Implementation Plan", "### Task N:", "**Files:**", "- [ ]",
                  "- Create:", "- Modify:", "- Test:", ":123-145",
                  "## Global Constraints", "**Interfaces:**"):
        assert token in text, (
            f"writing-plans template lost {token!r} — compile_plan.py and the "
            "Step-1 shape check parse this; re-audit dependency-analysis.md")
```

- [ ] **Step 6: Point the attestation-version assertion at the seam constant**

`test_attested_version_matches_installed` currently reads:

```python
def test_attested_version_matches_installed():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    m = re.search(r"Tested with superpowers (\d+\.\d+\.\d+)", skill)
    if not m:
        pytest.skip("attestation line not added to SKILL.md yet (orchestrator task)")
    if m.group(1) != installed().name:
        pytest.fail(
            f"installed superpowers {installed().name} != attested {m.group(1)} — "
            "re-run the interop audit, then bump the attestation in SKILL.md")
```

Re-target it at the snapshot wording, matched against `ATTESTED_VERSION`:

```python
def test_attested_version_matches_installed():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    m = re.search(r"vendored Superpowers v6 snapshot \(dev (\w+)\)", skill)
    if not m:
        pytest.skip("v6 attestation line not added to SKILL.md yet (Task 8)")
    if not ATTESTED_VERSION.endswith(m.group(1)):
        pytest.fail(
            f"SKILL.md attests snapshot dev {m.group(1)} but the seam's "
            f"ATTESTED_VERSION is {ATTESTED_VERSION!r} — reconcile the GA-FLIP "
            "SEAM commit with the SKILL.md/README wording")
```

(`ATTESTED_VERSION = "6.0.0-dev-08fc48c"` ends with `08fc48c`, the commit the SKILL.md line names, so this passes once Step 7 lands.)

- [ ] **Step 7: Re-word the SKILL.md attestation line and note the new v6 signals**

In `skills/ultrapowers/SKILL.md`, the attestation paragraph (lines 44–49) currently reads:

```
**Tested with superpowers 5.1.0.** Check the installed version (the directory name
under `~/.claude/plugins/cache/claude-plugins-official/superpowers/`). A newer
version is not a blocker — warn and continue: "ultrapowers was validated against
superpowers 5.1.0; you have <X>. If plan parsing or a handoff misbehaves, suspect
upstream drift first (run `python3 -m pytest tests/test_superpowers_compat.py` in
the ultrapowers repo to localize it)."
```

Replace with:

```
**Validated against the vendored Superpowers v6 snapshot (dev 08fc48c) in tests/fixtures/superpowers-v6/.** v6 is unreleased; there is no installed cache to
attest against yet, so the compat tripwire reads its contract tokens from that
pinned snapshot (flip it to the live cache at the GA-FLIP SEAM in
tests/test_superpowers_compat.py when v6 publishes). Check the installed version
(the directory name under `~/.claude/plugins/cache/claude-plugins-official/superpowers/`).
A different version is not a blocker — warn and continue: "ultrapowers was
validated against the vendored Superpowers v6 snapshot (dev 08fc48c) in tests/fixtures/superpowers-v6/; you have <X>. If plan parsing or a handoff
misbehaves, suspect upstream drift first (run `python3 -m pytest tests/test_superpowers_compat.py` in the ultrapowers repo to localize it)."

**v6 plan signals:** v6 adds two optional plan blocks — `## Global Constraints` in
the header and a per-task `**Interfaces:**` block (`- Consumes:` / `- Produces:`).
The parser stays additive-tolerant: a v5 plan without them still compiles. This
attestation only fixes which contract the tripwire checks; how `compile_plan.py`
consumes the blocks is wired in the compiler tasks.
```

This keeps the exact attestation substring the Step 6 regex matches (`vendored Superpowers v6 snapshot (dev 08fc48c) in tests/fixtures/superpowers-v6/`) byte-identical to Task 5's README wording.

- [ ] **Step 8: Run the compat suite and confirm GREEN**

```bash
python3 -m pytest tests/test_superpowers_compat.py -q
```
Expected: GREEN — every read resolves against the vendored snapshot; the deleted-v5-prompt tests are gone, not failing.

- [ ] **Step 9: Confirm the skill still validates**

```bash
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers
```
Expected: `skill ok`.

- [ ] **Step 10: Commit**

```bash
git add tests/test_superpowers_compat.py skills/ultrapowers/SKILL.md
git commit -m "test: re-attest compat tripwire to vendored Superpowers v6 snapshot (dev 08fc48c)"
```

---

### Task 9: Forward Global Constraints + Interfaces into the baked prompts; terse contracts

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/sim_workflow.mjs`, `tests/test_no_prompt_drift.py`

Files-note — `skills/ultrapowers/references/reviewer-prompts.md` (the `<!-- BAKE:IMPLEMENTER_PROMPT -->` and `<!-- BAKE:REVIEWER_PROMPT -->` blocks)
Files-note — `skills/ultrapowers/harnesses/waves.js` (the `IMPLEMENTER_PROMPT` array, the `REVIEWER_PROMPT` array, a `globalConstraints` arg read, a `globalConstraintsBlock` / `interfacesLine(task)` helper, and the three dispatch sites ~540, ~570, ~641)
Files-note — `tests/sim_workflow.mjs` (new scenario), `tests/test_no_prompt_drift.py` (existing, must stay green)

This task implements spec §1.4 (forward Global Constraints + Interfaces into the baked prompts) and §2.4's terse-contract clause. The compiler (Task 2) emits top-level `globalConstraints` and per-task `interfaces: {consumes, produces}`; this task consumes `args.globalConstraints` and `task.interfaces` and threads them into the implementer and reviewer dispatches.

Re-bake rule: edit the source reference block first, then copy the same words verbatim into `waves.js`. The drift test (`tests/test_no_prompt_drift.py`) normalizes away markdown emphasis, backticks, punctuation, possessive `'s`, em-dashes, and whitespace, so the baked copy uses plain concatenation without em-dashes — but the **words** must match in order. The static prompt text added to the BAKE blocks is baked verbatim; the per-run constraint/interface VALUES are interpolated at dispatch by the helpers and are NOT part of the BAKE block.

Concurrency note: edits `references/reviewer-prompts.md`, `harnesses/waves.js`, and `tests/sim_workflow.mjs` — the exact three files Tasks 10, 11, 12 also edit — so it is the head of a strictly serial chain (9 → 10 → 11 → 12) and runs alone in its wave.

- [ ] **Step 1: Add a failing simulation scenario**

In `tests/sim_workflow.mjs`, add this scenario immediately before the trailing run block, and register `await scenarioForwardedSignals()` on the line just before `console.log('ALL SCENARIOS PASSED')`. (Use the file's existing test harness helpers — `runWorkflow` / `makeAgent` / `baseArgs` — matching the patterns already in the file; adapt the helper names below to the real ones if they differ.)

```javascript
// ── Scenario: forwarded signals — the implementer and reviewer dispatches carry
// the plan's Global Constraints and each task's Interfaces, and the prompts state
// the terse output contract (#1.4, #2.4).
async function scenarioForwardedSignals() {
  const prompts = {}
  const waves = [[
    { id: 'A', title: 'alpha', body: 'do A', tier: 'cheap',
      interfaces: { consumes: ['schema.User'], produces: ['createUser(name: string): User'] } },
    { id: 'B', title: 'beta', body: 'do B', tier: 'cheap' }, // no interfaces
  ]]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim', edges: [],
                 globalConstraints: 'Node >= 20. All copy uses sentence case.' }
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => { prompts[label] = prompt; return undefined }),
    args, budget: undefined,
  })
  assert(/GLOBAL CONSTRAINTS:[\s\S]*Node >= 20/.test(prompts['impl:A']),
    'forwarded: implementer dispatch carries the global constraints text')
  assert(/GLOBAL CONSTRAINTS:[\s\S]*Node >= 20/.test(prompts['review:A:1']),
    'forwarded: reviewer dispatch carries the global constraints text')
  assert(/INTERFACES:[\s\S]*schema\.User/.test(prompts['impl:A']) &&
         /createUser\(name: string\): User/.test(prompts['impl:A']),
    'forwarded: implementer dispatch carries the task interfaces (consumes + produces)')
  assert(/INTERFACES:[\s\S]*schema\.User/.test(prompts['review:A:1']),
    'forwarded: reviewer dispatch carries the task interfaces')
  assert(!/INTERFACES:/.test(prompts['impl:B']),
    'forwarded: a task without interfaces gets no INTERFACES line')
  assert(/final message is your report/i.test(prompts['review:A:1']) &&
         /file:line/.test(prompts['review:A:1']),
    'forwarded: reviewer prompt states the terse report contract')
  assert(/15 lines/.test(prompts['impl:A']),
    'forwarded: implementer prompt caps the back-channel at 15 lines')
  assert(r.tasks.every((t) => t.status === 'done'), 'forwarded: all tasks done')
  console.log('scenario forwarded-signals: OK')
}
```

- [ ] **Step 2: Run the simulation and confirm it FAILS**

```bash
node tests/sim_workflow.mjs
```
Expected: FAIL — `SIM ASSERT FAILED: forwarded: implementer dispatch carries the global constraints text`.

- [ ] **Step 3: Add the terse contract + Interfaces/Global-Constraints intro to the `IMPLEMENTER_PROMPT` source block**

In `skills/ultrapowers/references/reviewer-prompts.md`, inside `<!-- BAKE:IMPLEMENTER_PROMPT -->`, two edits (both POSITIVE-RECIPE).

First, after the existing `SIBLING FILES` bullet, add two bullets:

```
- `GLOBAL CONSTRAINTS`: project-wide requirements (version floors, naming/copy rules, platform reqs) that bind every task (may be absent). Treat them as additional acceptance criteria your work must satisfy.
- `INTERFACES`: the exact neighboring signatures your task consumes and the contract it produces (may be absent). `Consumes` names symbols earlier tasks expose that you may call; `Produces` is the contract later tasks rely on — match those names and types exactly, since the implementers that consume them never see your code.
```

Second, replace the final line of the block:

```
**Return a single JSON object conforming to the implementer status schema below. No prose outside the JSON block.**
```

with:

```
**Return a single JSON object conforming to the implementer status schema below. No prose outside the JSON block.** Keep your back-channel summary to 15 lines or fewer; put the full detail in your committed work and the JSON fields.
```

- [ ] **Step 4: Add the terse contract + attention-lens to the `REVIEWER_PROMPT` source block**

In the same file, inside `<!-- BAKE:REVIEWER_PROMPT -->`, two edits.

First, insert the attention-lens paragraph between the `**Mandate:**` line and `**Spec compliance:**`:

```
**Mandate:** verify everything independently. Do not trust the implementer report.

**Attention lens:** when `GLOBAL CONSTRAINTS` are provided, they are binding requirements the spec demands — gate the diff against every one of them. When `INTERFACES` are provided, confirm the diff produces the named `Produces` contract with the stated types and uses each `Consumes` symbol as named, so neighboring tasks that depend on it stay satisfiable.

**Spec compliance:**
```

Second, replace the final line of the block:

```
**Return a single JSON object conforming to the reviewer verdict schema. No prose outside the JSON block.**
```

with:

```
**Return a single JSON object conforming to the reviewer verdict schema. No prose outside the JSON block.** Your final message is your report: every line is a verdict or a finding carrying file:line evidence.
```

- [ ] **Step 5: Read the `globalConstraints` arg and add the dispatch helpers in `waves.js`**

Immediately after the `planPath` const, insert:

```javascript
// globalConstraints: the plan's project-wide requirements the compiler captured
// from the plan header, '' when the plan had no `## Global Constraints` section.
// Forwarded verbatim into the implementer (binding requirements) and reviewer
// (attention lens) dispatches. (#1.4)
const globalConstraints =
  (ARGS && typeof ARGS.globalConstraints === 'string' && ARGS.globalConstraints.trim()) || ''
```

Then add two helpers right after the `filesLine` const:

```javascript
// The plan's Global Constraints, threaded into the implementer and reviewer
// dispatches. Empty when no constraints were supplied. (#1.4)
const globalConstraintsBlock = globalConstraints
  ? ('\nGLOBAL CONSTRAINTS:\n' + globalConstraints)
  : ''

// A task's Interfaces (compile_plan.py emits { consumes:[...], produces:[...] }),
// threaded so the worktree-isolated implementer learns the neighboring signatures
// it consumes and the contract it must produce, and the reviewer can check the
// produced contract. Empty when the task declared no interfaces. (#1.4)
const interfacesLine = (task) => {
  const i = task && task.interfaces
  if (!i || typeof i !== 'object') return ''
  const consumes = Array.isArray(i.consumes) ? i.consumes : []
  const produces = Array.isArray(i.produces) ? i.produces : []
  if (consumes.length === 0 && produces.length === 0) return ''
  return '\nINTERFACES:' +
    (consumes.length ? ('\nConsumes: ' + consumes.join(', ')) : '') +
    (produces.length ? ('\nProduces: ' + produces.join(', ')) : '')
}
```

- [ ] **Step 6: Re-bake the `IMPLEMENTER_PROMPT` array in `waves.js`**

Add the two new input bullets right after the existing `SIBLING FILES` element (plain concatenation, em-dashes dropped):

```javascript
  '- SIBLING FILES: files owned by tasks running in parallel with yours (may be absent). They do NOT exist at BASE and are not yours: never create, duplicate, modify, or delete a sibling-owned path. If your task cannot be implemented or tested without one, report BLOCKED naming the file — that is a missing dependency edge in the plan, not yours to work around.',
  '- GLOBAL CONSTRAINTS: project-wide requirements (version floors, naming/copy rules, platform reqs) that bind every task (may be absent). Treat them as additional acceptance criteria your work must satisfy.',
  '- INTERFACES: the exact neighboring signatures your task consumes and the contract it produces (may be absent). Consumes names symbols earlier tasks expose that you may call; Produces is the contract later tasks rely on — match those names and types exactly, since the implementers that consume them never see your code.',
  '',
```

And replace the array's final element (`'Return a single JSON object conforming to the implementer status schema below. No prose outside the JSON block.',`) with:

```javascript
  'Return a single JSON object conforming to the implementer status schema below. No prose outside the JSON block. Keep your back-channel summary to 15 lines or fewer; put the full detail in your committed work and the JSON fields.',
```

- [ ] **Step 7: Re-bake the `REVIEWER_PROMPT` array in `waves.js`**

Insert the attention-lens paragraph as two new elements right after the `'Mandate: verify everything independently. Do not trust the implementer report.',` element and its following `''`:

```javascript
  'Mandate: verify everything independently. Do not trust the implementer report.',
  '',
  'Attention lens: when GLOBAL CONSTRAINTS are provided, they are binding requirements the spec demands — gate the diff against every one of them. When INTERFACES are provided, confirm the diff produces the named Produces contract with the stated types and uses each Consumes symbol as named, so neighboring tasks that depend on it stay satisfiable.',
  '',
  'Spec compliance:',
```

And replace the array's final element (`'Return a single JSON object conforming to the reviewer verdict schema. No prose outside the JSON block.',`) with:

```javascript
  'Return a single JSON object conforming to the reviewer verdict schema. No prose outside the JSON block. Your final message is your report: every line is a verdict or a finding carrying file:line evidence.',
```

- [ ] **Step 8: Thread the constraints + interfaces into the three dispatch sites**

Add `globalConstraintsBlock + interfacesLine(task)` immediately after `filesLine(task)` / `siblingsStr` at each of the three assembly sites.

Initial implementer dispatch (~540):

```javascript
  let impl = await agent(
    GUARD + '\n\n' + IMPLEMENTER_PROMPT + '\n\nBASE: ' + baseSha + testCmdLine(task) + bootstrapLine + filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task) + taskBodyBlock(task),
    { label: 'impl:' + task.id, isolation: 'worktree', model: baseModel, schema: IMPLEMENTER_SCHEMA }
  )
```

Reviewer dispatch (~570), the `reviewPrompt` assignment:

```javascript
    const reviewPrompt =
      GUARD + '\n\n' + REVIEWER_PROMPT +
      taskBodyBlock(task) + '\nBRANCH: ' + impl.branch + '\nHEAD: ' + impl.headSha +
      '\nBASE: ' + baseSha + testCmdLine(task) + bootstrapLine + filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task)
```

Fix-round implementer re-dispatch (~641), insert before `taskBodyBlock(task)`:

```javascript
    impl = await agent(
      GUARD + '\n\n' + IMPLEMENTER_PROMPT + '\n\nBASE: ' + impl.headSha + testCmdLine(task) + bootstrapLine + filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task) + taskBodyBlock(task) +
        '\n\nFIX ROUND — the prior implementation of this task exists at commit ' + impl.headSha +
```

- [ ] **Step 9: Run the full verification suite and confirm GREEN**

```bash
node tests/sim_workflow.mjs && \
python3 -m pytest tests/test_no_prompt_drift.py -q && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 -m pytest tests/ -q
```
Expected: the sim prints `scenario forwarded-signals: OK` then `ALL SCENARIOS PASSED`; the drift test passes; `validate_skill.py` prints `skill ok`; `pytest tests/` green. If the drift test fails, the source `.md` words and the `waves.js` words diverged — diff the normalized forms and reconcile (do not edit the test).

- [ ] **Step 10: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "feat: forward Global Constraints + Interfaces into baked prompts; terse contracts (spec 1.4, 2.4)"
```

---

### Task 10: Pre-baked review packets; cut the reviewer's suite run

**Type:** implementation
**Depends-on:** 9, 3

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/sim_workflow.mjs`, `tests/test_no_prompt_drift.py`

Files-note — `skills/ultrapowers/references/reviewer-prompts.md` (the `<!-- BAKE:IMPLEMENTER_PROMPT -->` and `<!-- BAKE:REVIEWER_PROMPT -->` blocks)
Files-note — `skills/ultrapowers/harnesses/waves.js` (the `IMPLEMENTER_PROMPT` array, the `REVIEWER_PROMPT` array)
Files-note — `tests/sim_workflow.mjs` (new scenario), `tests/test_no_prompt_drift.py` (existing, must stay green)

This task implements spec §2.1 (pre-baked review packets) and §2.3 sub-lever (b) (cut the reviewer's full-suite run). It consumes the review-package script from Task 3: `bash skills/ultrapowers/scripts/review-package <BASE> <HEAD> [OUTFILE]` writes the packet to the shared common git dir and ECHOES the output path as its last stdout line. The implementer's final step generates the packet and reports the echoed path; the reviewer reads that packet instead of running `git checkout --detach`+`git diff`, with a guarded fallback to live git when the packet is missing or its HEAD differs. Separately, the reviewer's full-suite run (current step 8) is removed: the reviewer reads, it does not re-test.

Re-bake rule: edit the source reference block first, then copy verbatim into `waves.js`; the drift test normalizes punctuation/em-dashes. No new dispatch VALUE is interpolated (the packet PATH is generated and reported by the implementer agent at runtime); the BAKE blocks carry only static words.

Concurrency note: edits the same three files as Tasks 9, 11, 12 and depends on Task 9 (the baked prompts it edits) and Task 3 (the `review-package` script it invokes). Runs alone in its wave, after 9.

- [ ] **Step 1: Add a failing simulation scenario**

In `tests/sim_workflow.mjs`, add this scenario immediately before the trailing run block, and register `await scenarioReviewPackets()` just before `console.log('ALL SCENARIOS PASSED')` (after `await scenarioForwardedSignals()`):

```javascript
// ── Scenario: pre-baked review packets — the implementer's final step generates
// the packet, the reviewer reads it (guarded fallback to live git), and the
// reviewer no longer runs the suite (#2.1, #2.3b).
async function scenarioReviewPackets() {
  const prompts = {}
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => { prompts[label] = prompt; return undefined }),
    args: baseArgs, budget: undefined,
  })
  assert(/scripts\/review-package/.test(prompts['impl:A']),
    'packets: implementer final step runs the review-package script')
  assert(/last (stdout )?line|echoed/i.test(prompts['impl:A']) && /packet/i.test(prompts['impl:A']),
    'packets: implementer reports the echoed packet path')
  assert(/review packet/i.test(prompts['review:A:1']),
    'packets: reviewer prompt references the pre-baked review packet')
  assert(/do not run git/i.test(prompts['review:A:1']),
    'packets: reviewer reads the packet instead of running git')
  assert(/fall back|missing|does not match/i.test(prompts['review:A:1']),
    'packets: reviewer has a guarded fallback to live git when the packet is missing or stale')
  assert(!/Run the full check suite and confirm it passes/.test(prompts['review:A:1']),
    'packets: reviewer no longer runs the full check suite')
  assert(/BASE\.\.\.HEAD/.test(prompts['review:A:1']),
    'packets: reviewer still anchors to BASE...HEAD')
  assert(/REVIEW role/.test(prompts['review:A:1']) && /Do not write files/.test(prompts['review:A:1']),
    'packets: reviewer stays read-only')
  assert(r.tasks.every((t) => t.status === 'done'), 'packets: all tasks done')
  console.log('scenario review-packets: OK')
}
```

- [ ] **Step 2: Run the simulation and confirm it FAILS**

```bash
node tests/sim_workflow.mjs
```
Expected: FAIL — `SIM ASSERT FAILED: packets: implementer final step runs the review-package script`.

- [ ] **Step 3: Add the packet-generation final step to the `IMPLEMENTER_PROMPT` source block**

In `skills/ultrapowers/references/reviewer-prompts.md`, inside `<!-- BAKE:IMPLEMENTER_PROMPT -->`, extend the **Self-verify before reporting** list (POSITIVE-RECIPE). After the existing `FILES` self-verify bullet, add:

```
- As your final step, generate the review packet for your `BASE...HEAD`: run `bash skills/ultrapowers/scripts/review-package <BASE> <HEAD>` (your committed HEAD). It writes the commits and the `git diff -U10` to the shared common git dir and echoes the packet path as its last stdout line. Report that echoed path so the reviewer reads the exact diff you produced.
```

- [ ] **Step 4: Rewrite spec-compliance step 1 and drop the suite step in the `REVIEWER_PROMPT` source block**

In the same file, inside `<!-- BAKE:REVIEWER_PROMPT -->`, two edits.

First, replace spec-compliance item **1**:

```
1. Check out the implementer HEAD sha as a DETACHED checkout (`git checkout --detach <HEAD>`) — the implementer branch itself is locked by its worktree, so do not check the branch out. Run `git diff BASE...HEAD` yourself.
```

with:

```
1. Read the pre-baked review packet at the path the implementer reported (the commits and `git diff BASE...HEAD` for this task, written to the shared common git dir). Do not run git. Guarded fallback: if no packet path was reported, the file is missing, or its recorded HEAD does not match the implementer HEAD, recover the diff from live git on a DETACHED checkout of the implementer HEAD (`git checkout --detach <HEAD>` — the implementer branch is locked by its worktree, so do not check the branch out) and run `git diff BASE...HEAD` yourself.
```

Second, replace the suite-run region. Currently:

```
7. Test quality: tests assert observable behavior, not implementation details; no tests that trivially pass without exercising real logic. Where the task defines exact outputs or ordering, a loose containment assertion in place of full-value equality is a finding — minor, or blocking when it leaves an acceptance criterion unverified.

8. Run the full check suite and confirm it passes.

When `SIBLING FILES` is provided and the check suite fails ONLY because a sibling-owned file is absent at `BASE`, report a blocking issue that names the sibling file and the words "missing dependency edge" — do not instruct the implementer to create, duplicate, or delete the sibling-owned file.
```

Replace with (drop step 8; reframe the sibling clause):

```
7. Test quality: tests assert observable behavior, not implementation details; no tests that trivially pass without exercising real logic. Where the task defines exact outputs or ordering, a loose containment assertion in place of full-value equality is a finding — minor, or blocking when it leaves an acceptance criterion unverified.

You review by reading the diff and its evidence; the implementer's red green refactor cycle already ran the suite, and the suite runs again at the wave merge and on the integrated tree, so you do not re-run it here.

When `SIBLING FILES` is provided and a criterion is unsatisfiable in the diff ONLY because a sibling-owned file is absent at `BASE`, report a blocking issue that names the sibling file and the words "missing dependency edge" — do not instruct the implementer to create, duplicate, or delete the sibling-owned file.
```

- [ ] **Step 5: Re-bake the `IMPLEMENTER_PROMPT` array in `waves.js`**

Add the packet-generation element directly after the existing `FILES` self-verify element (em-dashes dropped):

```javascript
  '- If FILES is present: confirm every file you created, modified, or deleted is named there or is plainly required by the task text. NEVER delete a file outside FILES — if the task seems to demand it, STOP and report BLOCKED explaining why.',
  '- As your final step, generate the review packet for your BASE...HEAD: run bash skills/ultrapowers/scripts/review-package <BASE> <HEAD> (your committed HEAD). It writes the commits and the git diff -U10 to the shared common git dir and echoes the packet path as its last stdout line. Report that echoed path so the reviewer reads the exact diff you produced.',
```

- [ ] **Step 6: Re-bake the `REVIEWER_PROMPT` array in `waves.js`**

Replace the spec-compliance item-1 element with:

```javascript
  '1. Read the pre-baked review packet at the path the implementer reported (the commits and git diff BASE...HEAD for this task, written to the shared common git dir). Do not run git. Guarded fallback: if no packet path was reported, the file is missing, or its recorded HEAD does not match the implementer HEAD, recover the diff from live git on a DETACHED checkout of the implementer HEAD (git checkout --detach <HEAD> — the implementer branch is locked by its worktree, so do not check the branch out) and run git diff BASE...HEAD yourself.',
```

And replace the suite-run region. Currently:

```javascript
  '7. Test quality: tests assert observable behavior, not implementation details; no tests that trivially pass without exercising real logic. Where the task defines exact outputs or ordering, a loose containment assertion in place of full-value equality is a finding — minor, or blocking when it leaves an acceptance criterion unverified.',
  '',
  '8. Run the full check suite and confirm it passes.',
  '',
  'When SIBLING FILES is provided and the check suite fails ONLY because a sibling-owned file is absent at BASE, report a blocking issue that names the sibling file and the words "missing dependency edge" — do not instruct the implementer to create, duplicate, or delete the sibling-owned file.',
```

Make it:

```javascript
  '7. Test quality: tests assert observable behavior, not implementation details; no tests that trivially pass without exercising real logic. Where the task defines exact outputs or ordering, a loose containment assertion in place of full-value equality is a finding — minor, or blocking when it leaves an acceptance criterion unverified.',
  '',
  'You review by reading the diff and its evidence; the implementer red green refactor cycle already ran the suite, and the suite runs again at the wave merge and on the integrated tree, so you do not re-run it here.',
  '',
  'When SIBLING FILES is provided and a criterion is unsatisfiable in the diff ONLY because a sibling-owned file is absent at BASE, report a blocking issue that names the sibling file and the words "missing dependency edge" — do not instruct the implementer to create, duplicate, or delete the sibling-owned file.',
```

- [ ] **Step 7: Run the full verification suite and confirm GREEN**

```bash
node tests/sim_workflow.mjs && \
python3 -m pytest tests/test_no_prompt_drift.py -q && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 -m pytest tests/ -q
```
Expected: the sim prints `scenario review-packets: OK` then `ALL SCENARIOS PASSED`; drift test passes; `skill ok`; `pytest tests/` green.

- [ ] **Step 8: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "feat: pre-baked review packets; cut the reviewer suite run (spec 2.1, 2.3b)"
```

---

### Task 11: cannot-verify-from-diff escalation to the completeness critic

**Type:** implementation
**Depends-on:** 10

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/sim_workflow.mjs`, `tests/test_no_prompt_drift.py`

Files-note — `skills/ultrapowers/references/reviewer-prompts.md` (the `<!-- BAKE:REVIEWER_PROMPT -->` and `<!-- BAKE:REVIEWER_SCHEMA -->` blocks)
Files-note — `skills/ultrapowers/references/wave-merge.md` (the `<!-- BAKE:COMPLETENESS_PROMPT -->` block)
Files-note — `skills/ultrapowers/references/report-format.md` (the reviewer-verdict / `completenessFindings` documentation)
Files-note — `skills/ultrapowers/harnesses/waves.js` (the `REVIEWER_SCHEMA` const, the `REVIEWER_PROMPT` array, the per-task issue-collection loop, the `completenessPrompt` function, and the completeness dispatch)
Files-note — `tests/sim_workflow.mjs` (new scenario), `tests/test_no_prompt_drift.py` (existing, must stay green)

This task implements spec §2.2. The per-task reviewer, being worktree-isolated, structurally cannot judge requirements that span tasks or live in unchanged code; rather than crawl the repo, it LISTS those requirements and the engine ROUTES them to the completeness critic, which runs at opus on the integrated tree with the plan in hand. Add `cannotVerify: [{requirement, why}]` to the **reviewer verdict schema** (`REVIEWER_SCHEMA` — the schema the per-task reviewer returns; NOT `REVIEW_SCHEMA`, which is the completeness critic's return schema); the reviewer fills it; the engine collects it across a task's reviewers and threads it into the completeness-critic prompt as a checklist; `report-format.md` documents both.

Re-bake rule: edit each source block first, then copy verbatim into `waves.js`. The drift test pins `REVIEWER_SCHEMA`, `REVIEWER_PROMPT`, and `COMPLETENESS_PROMPT` (static fragments around `{{…}}` tokens). The collected cannot-verify VALUES are interpolated at the completeness dispatch and are not part of any BAKE block.

Concurrency note: edits the three shared files plus `wave-merge.md` and `report-format.md`; depends on Task 10's prompt state. Runs alone in its wave, after 10.

- [ ] **Step 1: Add a failing simulation scenario**

In `tests/sim_workflow.mjs`, add this scenario immediately before the trailing run block, and register `await scenarioCannotVerifyEscalation()` just before `console.log('ALL SCENARIOS PASSED')` (after `await scenarioReviewPackets()`):

```javascript
// ── Scenario: cannot-verify-from-diff escalation — reviewers list requirements
// they cannot judge from the diff; the engine routes them into the completeness
// critic's checklist (#2.2).
async function scenarioCannotVerifyEscalation() {
  let integrationPrompt = ''
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    assert(prompt.startsWith('SAFETY: Operate ONLY inside the git worktree'),
      'GUARD must head every dispatched prompt (label=' + label + ')')
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) {
      const id = taskIdFromLabel(label)
      if (id === 'A') {
        return { verdict: 'PASS', issues: [],
                 cannotVerify: [{ requirement: 'end-to-end auth flow across tasks A and C',
                                  why: 'token consumer lives in task C, not in this diff' }] }
      }
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm-' + label }
    if (label === 'integration') {
      integrationPrompt = prompt
      return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: baseArgs, budget: undefined })
  assert(/CANNOT-VERIFY/i.test(integrationPrompt),
    'cannotVerify: the completeness prompt carries a cannot-verify checklist heading')
  assert(integrationPrompt.includes('end-to-end auth flow across tasks A and C'),
    'cannotVerify: the listed requirement reaches the completeness critic')
  assert(integrationPrompt.includes('token consumer lives in task C'),
    'cannotVerify: the why reaches the completeness critic')
  assert(r.tasks.every((t) => t.status === 'done'), 'cannotVerify: all tasks still done (PASS verdict)')
  console.log('scenario cannot-verify-escalation: OK')
}
```

- [ ] **Step 2: Run the simulation and confirm it FAILS**

```bash
node tests/sim_workflow.mjs
```
Expected: FAIL — `SIM ASSERT FAILED: cannotVerify: the completeness prompt carries a cannot-verify checklist heading`.

- [ ] **Step 3: Add `cannotVerify` to the `REVIEWER_SCHEMA` source block**

In `skills/ultrapowers/references/reviewer-prompts.md`, inside `<!-- BAKE:REVIEWER_SCHEMA -->`, add `cannotVerify` as a sibling of `issues` (not required):

```
{
  type: 'object',
  required: ['verdict', 'issues'],
  properties: {
    verdict: { enum: ['PASS', 'FIX_REQUIRED'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'detail'],
        properties: {
          severity: { enum: ['blocking', 'minor'] },
          detail: { type: 'string' },
        },
      },
    },
    cannotVerify: {
      type: 'array',
      items: {
        type: 'object',
        required: ['requirement', 'why'],
        properties: {
          requirement: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
  },
}
```

- [ ] **Step 4: Add the cannot-verify channel to the `REVIEWER_PROMPT` source block**

In the same file, inside `<!-- BAKE:REVIEWER_PROMPT -->`, add a paragraph directly after the "you do not re-run it here" sentence (added by Task 10) and before the `When SIBLING FILES …` paragraph (POSITIVE-RECIPE):

```
For any requirement you cannot verify from the diff alone — it spans tasks, or it depends on unchanged code outside this diff — list it under `cannotVerify` with the requirement and why it is unverifiable from here, rather than crawling the repository to chase it. The completeness critic verifies these against the integrated tree.
```

- [ ] **Step 5: Add the checklist intro to the `COMPLETENESS_PROMPT` source block**

In `skills/ultrapowers/references/wave-merge.md`, inside `<!-- BAKE:COMPLETENESS_PROMPT -->`, add a `{{CANNOT_VERIFY}}` token. The block currently ends:

```
Only once you are verified on that tree: what plan requirement is unmet? What claim is unverified? What code path is untested? {{TEST_INSTRUCTION}}, then review the integrated result against the original plan. List every gap, unverified claim, and untested path.
```

Replace that final sentence with:

```
Only once you are verified on that tree: what plan requirement is unmet? What claim is unverified? What code path is untested? {{TEST_INSTRUCTION}}, then review the integrated result against the original plan. {{CANNOT_VERIFY}}List every gap, unverified claim, and untested path.
```

Also update the prose sentence just above the block to document the new token:

```
The canonical prompt wording (`{{PLAN_STEP}}` is the optional "Read the original plan document at `args.planPath` first." sentence; `{{MERGE_HEAD_SHA}}` is `waveBaseSha` — the last wave's `merge.headSha` — interpolated at dispatch, empty if the run recorded no merge HEAD; `{{CANNOT_VERIFY}}` is the CANNOT-VERIFY checklist the per-task reviewers escalated, empty when none were raised):
```

- [ ] **Step 6: Document the field + routing in `report-format.md`**

In `skills/ultrapowers/references/report-format.md`, find the `tasks[].reviewVerdict` row and add a new row directly after it:

```markdown
| `cannotVerify` (per reviewer) | no | Requirements a per-task reviewer could not judge from its own diff — cross-task or unchanged-code claims. Each item is `{ requirement, why }`. The worktree-isolated reviewer LISTS them instead of crawling the repo; the engine COLLECTS them across the task's reviewers and threads them into the completeness critic's prompt as an explicit checklist. When no merge HEAD was recorded (no completeness critic runs), the items surface as judgment calls at the gate rather than being dropped (#2.2). |
```

Then extend the `completenessFindings` row by appending, before its closing `|`:

```
 The critic's prompt also carries the CANNOT-VERIFY checklist the per-task reviewers escalated; its findings include each item it confirmed or refuted against the integrated tree (#2.2).
```

- [ ] **Step 7: Re-bake the `REVIEWER_SCHEMA` const in `waves.js`**

In the `REVIEWER_SCHEMA = { … }` const, add the `cannotVerify` property as a sibling of `issues` (verbatim from the source block in Step 3).

- [ ] **Step 8: Re-bake the `REVIEWER_PROMPT` array in `waves.js`**

Insert the cannot-verify paragraph (and a blank-line element) directly after the "You review by reading the diff…you do not re-run it here." element (from Task 10), before the `When SIBLING FILES …` element:

```javascript
  'You review by reading the diff and its evidence; the implementer red green refactor cycle already ran the suite, and the suite runs again at the wave merge and on the integrated tree, so you do not re-run it here.',
  '',
  'For any requirement you cannot verify from the diff alone — it spans tasks, or it depends on unchanged code outside this diff — list it under cannotVerify with the requirement and why it is unverifiable from here, rather than crawling the repository to chase it. The completeness critic verifies these against the integrated tree.',
  '',
  'When SIBLING FILES is provided and a criterion is unsatisfiable in the diff ONLY because a sibling-owned file is absent at BASE, report a blocking issue that names the sibling file and the words "missing dependency edge" — do not instruct the implementer to create, duplicate, or delete the sibling-owned file.',
```

- [ ] **Step 9: Collect `cannotVerify` across reviewers and thread it into the completeness prompt**

Four `waves.js` edits.

(a) **Collect at the run level.** Next to the other run-level accumulators (the `const taskResults = []` … `const unfinished = []` block), add:

```javascript
const cannotVerifyItems = []
```

(b) **Capture from each reviewer pass.** In `runTaskInner`, where the lean/adversarial branch sets `issues`/`verdicts`, also accumulate cannotVerify:

```javascript
    let issues, verdicts
    if (taskReviewProfile(task) === 'adversarial') {
      const r1 = await agent(reviewPrompt, reviewOpts(1))
      const r2 = await agent(reviewPrompt, reviewOpts(2))
      issues = (r1.issues || []).concat(r2.issues || [])
      verdicts = [r1.verdict, r2.verdict]
      for (const cv of (r1.cannotVerify || []).concat(r2.cannotVerify || [])) {
        cannotVerifyItems.push({ task: task.id, requirement: cv.requirement, why: cv.why })
      }
    } else {
      const review = await agent(reviewPrompt, reviewOpts())
      issues = review.issues || []
      verdicts = [review.verdict]
      for (const cv of (review.cannotVerify || [])) {
        cannotVerifyItems.push({ task: task.id, requirement: cv.requirement, why: cv.why })
      }
    }
```

(c) **Build the checklist and thread it into the completeness dispatch.** Change `completenessPrompt` to accept the checklist string and interpolate it where `{{CANNOT_VERIFY}}` sits:

```javascript
const completenessPrompt = (mergeHeadSha, cannotVerifyChecklist) =>
  'You are a REVIEW role. Do not write files, create commits, stage changes, or ' +
  'modify the tree in any way. Your only output is your findings/verdict. If the ' +
  'work is wrong, report it — never fix it.\n' +
  (planPath ? ('Read the original plan document at ' + planPath + ' first. ') : '') +
  'First, put yourself on the exact tree the run produced: the integration HEAD ' +
  'is ' + (mergeHeadSha || '') + '. If that value is empty, report BLOCKED and ' +
  'produce no findings — do not guess a tree. Otherwise run git checkout --detach ' +
  (mergeHeadSha || '') + ', then git rev-parse HEAD and confirm it equals ' +
  (mergeHeadSha || '') + '; if it does not, report BLOCKED and produce no ' +
  'findings. Only once you are verified on that tree: what plan requirement is ' +
  'unmet? What claim is unverified? What code path is untested? ' + testInstruction +
  ', then review the integrated result against the original plan. ' + (cannotVerifyChecklist || '') +
  'List every gap, unverified claim, and untested path.'
```

At the completeness dispatch site (~1036), build the checklist string just before the `review = await agent(` call:

```javascript
    const cannotVerifyChecklist = cannotVerifyItems.length
      ? ('CANNOT-VERIFY checklist (escalated by the per-task reviewers — verify each against the integrated tree): ' +
         cannotVerifyItems.map((c) => '[' + c.task + '] ' + c.requirement + ' (' + c.why + ')').join('; ') + '. ')
      : ''
```

and change the prompt argument from `completenessPrompt(waveBaseSha) +` to `completenessPrompt(waveBaseSha, cannotVerifyChecklist) +`.

(d) **No-critic fallback.** Immediately after the integration `if (budgetExhausted()) { … } else { … }` block closes (before the acceptance disposition section), surface unrouted items as judgment calls:

```javascript
// cannot-verify items with no usable completeness critic must not be dropped:
// when the run recorded no merge HEAD, the critic reports BLOCKED, so the items
// surface at the gate as judgment calls instead (#2.2 error handling).
if (cannotVerifyItems.length && !waveBaseSha) {
  for (const c of cannotVerifyItems) {
    judgmentCalls.push('cannot-verify (task ' + c.task + '): ' + c.requirement +
      ' — no completeness critic ran (no merge HEAD); verify manually before the gate')
  }
}
```

- [ ] **Step 10: Run the full verification suite and confirm GREEN**

```bash
node tests/sim_workflow.mjs && \
python3 -m pytest tests/test_no_prompt_drift.py -q && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 -m pytest tests/ -q
```
Expected: the sim prints `scenario cannot-verify-escalation: OK` then `ALL SCENARIOS PASSED`; drift test passes; `skill ok`; `pytest tests/` green. If the drift test fails on `COMPLETENESS_PROMPT`, confirm the static fragment immediately before `{{CANNOT_VERIFY}}` (`…review the integrated result against the original plan. `) and immediately after it (`List every gap…`) both appear in `waves.js` in order.

- [ ] **Step 11: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/references/wave-merge.md skills/ultrapowers/references/report-format.md skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "feat: cannot-verify-from-diff escalation to the completeness critic (spec 2.2)"
```

---

### Task 12: Warm-cache the worktree dependency bootstrap

**Type:** implementation
**Depends-on:** 11, 4

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/sim_workflow.mjs`, `tests/test_no_prompt_drift.py`

Files-note — `skills/ultrapowers/references/reviewer-prompts.md` (the `<!-- BAKE:IMPLEMENTER_PROMPT -->` block)
Files-note — `skills/ultrapowers/harnesses/waves.js` (the `IMPLEMENTER_PROMPT` array and the `bootstrapLine` assembly)
Files-note — `tests/sim_workflow.mjs` (new scenario), `tests/test_no_prompt_drift.py` (existing, must stay green)

This task implements spec §2.3 sub-lever (a). It consumes the warm_cache script from Task 4: `bash skills/ultrapowers/scripts/warm_cache.sh restore <lockfile> <target_dir>` hardlink-clones cached deps into the target (exit 0 = hit; exit 3 = miss), and `... populate <lockfile> <source_dir>` warms the cache after a real install. The implementer's bootstrap step tries `restore` first and, on exit 3, falls through to the real `bootstrapCmd`; after a real install it runs `populate`. Correctness never depends on the cache. This is threaded into the `bootstrapLine` const (the per-worktree setup line only the fresh, worktree-isolated roles receive).

Re-bake rule: the warm-cache invocation lines added to `bootstrapLine` are dynamic dispatch assembly (they interpolate `bootstrapCmd`), so they live in the `bootstrapLine` const, NOT in the BAKE block; only the static "prefer the warm cache" guidance sentence added to `IMPLEMENTER_PROMPT` is baked and pinned by the drift test.

Concurrency note: edits the three shared files; depends on Task 11's prompt/schema state and on Task 4 (the `warm_cache.sh` script). The tail of the serial chain — runs alone, after 11.

- [ ] **Step 1: Add a failing simulation scenario**

In `tests/sim_workflow.mjs`, add this scenario immediately before the trailing run block, and register `await scenarioWarmCacheBootstrap()` just before `console.log('ALL SCENARIOS PASSED')` (after `await scenarioCannotVerifyEscalation()`):

```javascript
// ── Scenario: warm-cache bootstrap — the fresh-worktree bootstrap tries the warm
// cache (restore) first and warms it (populate) after a real install; a miss
// falls through to the real bootstrapCmd (#2.3a).
async function scenarioWarmCacheBootstrap() {
  const prompts = {}
  const waves = [[
    { id: 'A', title: 'py task', body: 'do A', tier: 'cheap' },
    { id: 'B', title: 'bun task', body: 'do B', tier: 'cheap' },
  ]]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim', edges: [],
                 bootstrapCmd: 'python3 -m venv .venv && .venv/bin/pip install -e .' }
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => { prompts[label] = prompt; return undefined }),
    args, budget: undefined,
  })
  assert(/warm_cache\.sh restore/.test(prompts['impl:A']),
    'warmCache: implementer bootstrap tries warm_cache.sh restore first')
  assert(/exit 3/.test(prompts['impl:A']) && /pip install -e \./.test(prompts['impl:A']),
    'warmCache: a cache miss (exit 3) falls through to the real bootstrapCmd')
  assert(/warm_cache\.sh populate/.test(prompts['impl:A']),
    'warmCache: after a real install the implementer populates the cache')
  assert(/warm_cache\.sh restore/.test(prompts['review:A:1']),
    'warmCache: reviewer bootstrap also tries the warm cache')
  assert(prompts['merge:wave1'] && !/warm_cache\.sh/.test(prompts['merge:wave1']),
    'warmCache: the merge agent gets no worktree bootstrap')
  assert(prompts['integration'] && !/warm_cache\.sh/.test(prompts['integration']),
    'warmCache: the completeness critic gets no worktree bootstrap')
  assert(r.tasks.every((t) => t.status === 'done'), 'warmCache: all tasks done')
  console.log('scenario warm-cache-bootstrap: OK')
}
```

(Adapt the `merge:wave1` / `integration` label strings to the file's real label conventions if they differ.)

- [ ] **Step 2: Run the simulation and confirm it FAILS**

```bash
node tests/sim_workflow.mjs
```
Expected: FAIL — `SIM ASSERT FAILED: warmCache: implementer bootstrap tries warm_cache.sh restore first`.

- [ ] **Step 3: Add the warm-cache guidance to the `IMPLEMENTER_PROMPT` source block**

In `skills/ultrapowers/references/reviewer-prompts.md`, inside `<!-- BAKE:IMPLEMENTER_PROMPT -->`, add a step directly after the existing "Anchor to BASE first…" red-green-refactor step (POSITIVE-RECIPE):

```
2. If a `WORKTREE SETUP` line is present, run it before building or testing: it prefers a warm dependency cache (a near-instant hardlink-clone of a prebuilt `node_modules` / `.venv`) and falls through to a real install on a cache miss, then warms the cache for sibling worktrees. The cache is an optimization only — your work is correct whether it hits or misses.
```

- [ ] **Step 4: Re-bake the `IMPLEMENTER_PROMPT` array in `waves.js`**

Add the warm-cache step element directly after the "Anchor to BASE first…" element (em-dashes dropped):

```javascript
  "1. Anchor to BASE first: run git rev-parse HEAD; if it differs from BASE, run git reset --hard <BASE> before anything else — engine worktrees are sometimes cut from a stale ref, and building on the wrong parent reintroduces other tasks' changes and forces merge conflicts.",
  '2. If a WORKTREE SETUP line is present, run it before building or testing: it prefers a warm dependency cache (a near-instant hardlink-clone of a prebuilt node_modules / .venv) and falls through to a real install on a cache miss, then warms the cache for sibling worktrees. The cache is an optimization only — your work is correct whether it hits or misses.',
```

- [ ] **Step 5: Wrap `bootstrapLine` with the warm-cache restore/populate around the real `bootstrapCmd`**

The `bootstrapLine` const currently is:

```javascript
const bootstrapLine = bootstrapCmd
  ? ('\nWORKTREE SETUP: this is a fresh worktree with no installed dependencies; ' +
     'run this before building or testing: ' + bootstrapCmd)
  : ''
```

Replace it with the warm-cache wrapper:

```javascript
// The fresh-worktree bootstrap, wrapped with the warm dependency cache. The agent
// first tries `warm_cache.sh restore <lockfile> <target>` (a near-instant
// hardlink-clone of the prebuilt deps); exit 0 = hit, exit 3 = miss/lockfile
// change → fall through to the real bootstrapCmd, then `warm_cache.sh populate
// <lockfile> <source>` to warm the cache for sibling worktrees. Correctness never
// depends on the cache (#2.3a). Only the FRESH worktree roles receive this; empty
// when no bootstrapCmd was supplied.
const bootstrapLine = bootstrapCmd
  ? ('\nWORKTREE SETUP: this is a fresh worktree with no installed dependencies. ' +
     'First try the warm cache: run `bash skills/ultrapowers/scripts/warm_cache.sh restore <lockfile> <target_dir>` ' +
     '(use the dependency lockfile and the directory deps install into for this stack). ' +
     'If it exits 0 the cache hit and deps are in place. If it exits 3 (cache miss or lockfile change), ' +
     'run the real install before building or testing: ' + bootstrapCmd +
     ' — then warm the cache for siblings: `bash skills/ultrapowers/scripts/warm_cache.sh populate <lockfile> <source_dir>`. ' +
     'The cache is an optimization only; build and test normally whether it hit or missed.')
  : ''
```

(No dispatch-site change is needed: `bootstrapLine` is already threaded into the implementer and reviewer assemblies and excluded from the non-isolated roles — Task 9 left those wirings intact.)

- [ ] **Step 6: Run the full verification suite and confirm GREEN**

```bash
node tests/sim_workflow.mjs && \
python3 -m pytest tests/test_no_prompt_drift.py -q && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 -m pytest tests/ -q
```
Expected: the sim prints `scenario warm-cache-bootstrap: OK` then `ALL SCENARIOS PASSED`; drift test passes (the new warm-cache step in `IMPLEMENTER_PROMPT` matches its source; the `bootstrapLine` invocation lines are NOT part of the BAKE block); `skill ok`; `pytest tests/` green.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "feat: warm-cache the worktree dependency bootstrap (spec 2.3a)"
```

---

### Task 13: ultraplan authoring guidance for Global Constraints + Interfaces

**Type:** implementation
**Depends-on:** 7

**Files:**
- Modify: `skills/ultraplan/SKILL.md`

This task implements spec §1.5: teach plan authors to populate v6's `## Global Constraints` header and per-task `**Interfaces:**` blocks, and tell them those blocks are now **load-bearing in ultrapowers**. Task 7 made the compiler cross-check `Consumes`/`Produces` against `**Depends-on:**` (an omission becomes an "undeclared dependency" finding) and forward `## Global Constraints` to every reviewer; this task makes ultraplan say so.

**Depends-on rationale:** depends on Task 7 because the guidance describes Task 7's compiler behavior. This is a documentation-of-behavior dependency, not a shared-symbol one — Task 13 touches only `skills/ultraplan/SKILL.md`, which no other task writes, so the dependency is purely ordering.

**Why this is safe against the ultraplan anti-drift pin.** The anti-drift test (`tests/test_ultraplan_skill.py`, the test asserting ultraplan mirrors the canonical contract) requires that the normalized text of the two BAKE blocks in `skills/ultrapowers/references/plan-markers.md` (`MARKER_SYNTAX`, `TYPE_SEMANTICS`) each appear as a normalized substring inside `skills/ultraplan/SKILL.md` — currently the "Add markers to every task" section and the "Choose the right Type" section. This new subsection is inserted in the gap **between** the "Authoring rules (the worktree-pure contract)" section and the "Seal the exam" section — it neither edits nor interrupts either mirrored block, so both mirror substrings remain intact. (Read the anti-drift test first to confirm the exact pinned sections before inserting.)

- [ ] **Step 1: Insert the v6 authoring-guidance subsection**

In `skills/ultraplan/SKILL.md`, anchor on the end of the worktree-pure contract section and the start of the seal section. The current text is:

```markdown
5. **Split impure steps out.** If a task would push, deploy, ssh, or wait on a
   human, that part is its own `release` or `manual` task — implementation tasks
   never contain it.

## Seal the exam (after plan approval)
```

Replace it with (inserting the new section between them, leaving both surrounding sections byte-for-byte unchanged):

````markdown
5. **Split impure steps out.** If a task would push, deploy, ssh, or wait on a
   human, that part is its own `release` or `manual` task — implementation tasks
   never contain it.

## Populate the v6 blocks — they are load-bearing here

superpowers v6 adds two plan blocks. In ultrapowers they are **not just
documentation** — the compiler reads them, so populate them deliberately:

1. **`## Global Constraints`** (a header section, project-wide). Copy the spec's
   binding, cross-cutting requirements verbatim — version floors, naming/copy
   rules, platform requirements. ultrapowers forwards this block to **every
   reviewer as its attention lens**, so a reviewer gates the work against exactly
   what the spec demands.

2. **`**Interfaces:**`** (per task, with `Consumes:` / `Produces:` sub-bullets).
   `Produces:` names the function names and param/return types later tasks rely
   on; `Consumes:` names the signatures this task uses from earlier tasks. A
   worktree-isolated implementer sees only its own task body — Interfaces is how
   it learns the names and types its neighbors expose.

These are **load-bearing**: ultrapowers cross-checks each task's `Consumes`
against the `Produces` of every other task. When Task B `Consumes:` a symbol Task
A `Produces:`, the compiler infers B-depends-on-A — and if that edge is **not**
already covered by B's `**Depends-on:**` (or a file-overlap edge), it surfaces a
loud **"undeclared dependency"** finding in the wave-plan transparency render at
the Step-3 gate. The plan still compiles and waves correctly; the finding tells
you your `**Depends-on:**` was wrong — fix it at authoring time. So: whenever a
task `Consumes:` something a sibling `Produces:`, add the matching
`**Depends-on:**` yourself.

**Marker placement is unchanged.** `**Type:**` and `**Depends-on:**` stay in the
contiguous header block immediately after the `### Task N:` heading and before
`**Files:**`. `**Interfaces:**` is **not** a header marker: it sits **after** the
`**Files:**` block and before the first `- [ ]` step. Shape:

```markdown
### Task 4: Wire the health probe

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Modify: `app/server/server.ts`

**Interfaces:**
- Consumes: `schema.User` (from Task 1), `makeProbe(port: number): Probe` (from Task 2)
- Produces: `healthProbe(): Promise<HealthReport>`

- [ ] **Step 1: …**
```

Because `**Interfaces:**` falls after `**Files:**`, it never enters the header
marker block, and `**Type:**`/`**Depends-on:**` keep their exact pinned positions.

## Seal the exam (after plan approval)
````

- [ ] **Step 2: Verify the skill validates and the anti-drift pin stays green**

```bash
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan && \
python3 -m pytest tests/test_ultraplan_skill.py -q
```
Expected: `validate_skill.py` prints `skill ok`; `pytest tests/test_ultraplan_skill.py -q` is green, including the mirror test (the two BAKE mirror blocks are unchanged). If the mirror test fails, the insertion split or altered one of the mirrored sections — move the new section fully outside the "Add markers to every task" and "Choose the right Type" blocks (do not edit the test or the mirrored prose).

- [ ] **Step 3: Run the full suite to confirm no regression**

```bash
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan && \
python3 -m pytest tests/ -q
```
Expected: both `validate_skill.py` runs print `skill ok`; `pytest tests/` green.

- [ ] **Step 4: Commit**

```bash
git add skills/ultraplan/SKILL.md
git commit -m "docs(ultraplan): teach load-bearing Global Constraints + Interfaces (v6, depends on #7)"
```

---

### Task 14: Full verification suite (gate)

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13

The acceptance authority for this `suite`-mode plan. Not executed as a wave task; its command informs `testCmd` and is asserted at the pre-merge gate. The integration must be green on:

```bash
node tests/sim_workflow.mjs && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan && \
python3 -m pytest tests/ -q && \
python3 -m pytest evals/scripts/tests/ -q
```

Expectations:
- `node tests/sim_workflow.mjs` prints `ALL SCENARIOS PASSED`, including the four new scenarios (`forwarded-signals`, `review-packets`, `cannot-verify-escalation`, `warm-cache-bootstrap`) and every existing scenario.
- Both `validate_skill.py` runs print `skill ok`.
- `pytest tests/` is green, including:
  - `tests/test_no_prompt_drift.py` — the re-baked `IMPLEMENTER_PROMPT` / `REVIEWER_PROMPT` / `REVIEWER_SCHEMA` / `COMPLETENESS_PROMPT` match their source reference blocks.
  - `tests/test_superpowers_compat.py` — green against the vendored v6 snapshot.
  - `tests/test_compile_plan.py` — the new Global-Constraints / Interfaces parsing + the interface-edge / undeclared-dependency cases.
  - `tests/test_review_package.py`, `tests/test_warm_cache.py`, `tests/test_run_micro.py` — the new scripts/tooling.
- `pytest evals/scripts/tests/` is green, including `test_flawed_preserves_the_buggy_task4` (Task 4 still declares `Depends-on: none`) and the `flawed` fixture's new interface edge.

---

## Self-Review

**1. Spec coverage:**
- §1.1 (vendored snapshot + re-attestation) → Task 1 (snapshot) + Task 8 (GA-flip seam, token swap, SKILL.md attestation). ✓
- §1.2 (compile_plan.py recognizes the new blocks) → Task 2 (Global Constraints + Interfaces parse, Files-parser exemption, output payloads). ✓
- §1.3 (strengthen the DAG; judgment call #1: exact-match hard edge + undeclared-dependency finding) → Task 7. ✓
- §1.4 (forward Global Constraints + Interfaces into baked prompts) → Task 9. ✓
- §1.5 (ultraplan authoring update) → Task 13. ✓
- §2.1 (pre-baked review packets; judgment call #2: shared common git dir, implementer-generated) → Task 3 (script) + Task 10 (wiring). ✓
- §2.2 (cannot-verify channel → completeness critic) → Task 11. ✓
- §2.3a (warm-cache bootstrap; judgment call #3) → Task 4 (script) + Task 12 (wiring). §2.3b (cut reviewer suite run) → Task 10. ✓
- §2.4 (terse contracts + micro-test loop) → Task 9 (terse) + Task 6 (micro-test). ✓
- §2.5 (measurement protocol) → Task 6. ✓
- Folded-in cleanups (README path drift, Delete reconcile) → Task 5 (paths; README has no `Delete:` to drop) + Task 8 (Delete reconcile lives on the compat/SKILL.md surface; `FILE_LINE` stays `Create|Modify|Test`). ✓
- §Acceptance disposition (`suite`) → header + Task 14 gate. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"add validation"/"similar to Task N" — every script, test, prompt block, const, and edit is given in full. The few "adapt the helper names to the real file" notes in the sim scenarios are explicit instructions to match a pre-existing harness, not missing content.

**3. Type consistency:** The cross-task contract is fixed and consistent: the compiler (Task 2) emits top-level `globalConstraints` (string) and per-task `interfaces: {consumes, produces}`; the engine (Task 9) reads `args.globalConstraints` / `task.interfaces` under those exact names. The `review-package` CLI (`bash …/review-package <BASE> <HEAD> [OUTFILE]`, echoes path) is produced by Task 3 and consumed by Task 10 identically. The `warm_cache.sh restore|populate <lockfile> <dir>` CLI (exit 0 hit / 3 miss) is produced by Task 4 and consumed by Task 12 identically. `cannotVerify: [{requirement, why}]` is added to `REVIEWER_SCHEMA` (the per-task reviewer's schema), filled by the reviewer (Task 11 §3–4), collected by the engine (Task 11 §9), and consumed by `completenessPrompt(mergeHeadSha, cannotVerifyChecklist)` (Task 11 §9c) — one consistent shape. The `interface` edge `why` label and the `undeclared-dependency` conflict `kind` are introduced in Task 7 and documented in Task 7 §6 with matching names.

**Ultraplan additions:**
- Every implementation task carries an explicit `**Type:** implementation`; Task 14 carries `**Type:** gate`. ✓
- Every cross-task constraint appears as `**Depends-on:**` on the downstream task: 2←7, 1←8, 2←9, {9,3}←10, 10←11, {11,4}←12, 7←13, and the gate `Depends-on` all. No preamble holds load-bearing ordering — each task body carries its own concurrency note. ✓
- Every backticked mention of a file another task **creates** has a matching `**Depends-on:**`: Task 8 → `tests/fixtures/superpowers-v6/` (Dep 1); Task 10 → `scripts/review-package` (Dep 3); Task 12 → `scripts/warm_cache.sh` (Dep 4). Files that are *modified* (waves.js, reviewer-prompts.md, compile_plan.py) pre-exist, so no prose-reference edge is inferred. ✓
- No `release`/`manual` work in this change — it is all worktree-pure diffs plus one `gate`. ✓
- The plan carries an `**Acceptance:** suite` line. ✓
- Worktree-purity: within each wave the write sets are disjoint (Wave 1: T1/T2/T3/T4/T5/T6 — fixtures / compile_plan.py / review-package / warm_cache.sh / README / evals; Wave 2: T7 / T8 / T9 — compile_plan.py / compat+SKILL.md / engine-prompts; Wave 3: T10 / T13 — engine-prompts / ultraplan; Wave 4: T11 alone; Wave 5: T12 alone). The engine chain (9→10→11→12) serializes on the three shared files. ✓
