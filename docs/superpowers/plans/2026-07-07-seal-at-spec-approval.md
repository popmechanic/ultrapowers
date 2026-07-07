# Seal at Spec-Approval Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move sealed-exam authoring off the human critical path — dispatch the acceptance author in the background at spec approval, collect the finished seal at plan approval, keyed by the spec content hash.

**Architecture:** Prose-only protocol change across three files plus one new drift-pin test. The ultraplan sealing section splits into dispatch-at-invocation (background, per-dispatch pending dir `pending-<specSha12>/`, `dispatch.json` receipt) and collect-at-plan-approval (content-addressed lookup, durable `outcome.json` failure surfacing, synchronous fallback). The seal-author brief swaps its hard-coded shared `pending/` path for the passed pending dir, records `specSha256` in the manifest, and writes the durable failure record. Spec: `docs/superpowers/specs/2026-07-07-seal-at-spec-approval-design.md`, issue #93.

**Tech Stack:** Markdown skill prose, pytest drift pins. No new scripts.

**Acceptance:** suite — ultrapowers' own skill/prompt development; the committed drift-pin suite plus operator-read diffs are the verification.

## Global Constraints

- `agents/seal-author.md` frontmatter stays byte-identical: `effort: high` present, no `model:` key (pinned by `tests/test_seal_author_agent.py`, which must pass **unmodified**).
- Neither `skills/ultraplan/SKILL.md` nor `skills/ultraplan/references/seal-author-prompt.md` may state a reasoning-effort value — the existing regex pin rejects `<value> effort` / `effort: <value>` phrasings.
- Both dispatch texts keep the literal agent-type token `ultrapowers:seal-author`; the brief keeps the literal `most-capable tier`.
- No new scripts, no Anthropic SDK/API usage: dispatch, dedup, and collect are skill-prose driven using `shasum -a 256` and existing scripts.
- The brief remains the single source for author-side behavior; SKILL.md summarizes it in at most one paragraph and never duplicates step-level instructions.
- In `skills/ultraplan/SKILL.md`, only the `## Seal the exam` section changes — every other section keeps its pinned tokens (see `tests/test_ultraplan_skill.py`).
- Versioning stays `0.0.x`; a release bumps `plugin.json` and `marketplace.json` to the **same** value.

---

### Task 1: The async sealing protocol (brief + agent definition + SKILL section + pins)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `tests/test_async_sealing.py`
- Modify: `skills/ultraplan/references/seal-author-prompt.md`
- Modify: `agents/seal-author.md`
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_async_sealing.py`

**Interfaces:**
- Consumes: none
- Produces: the async sealing contract tokens pinned by the new test file (`<pendingDir>`, `specSha256`, `dispatch.json`, `outcome.json`, dispatch/collect section headings)

This is deliberately one task: the dispatcher side (SKILL.md) and the author side (the brief) are two halves of a single protocol — same vocabulary (`specSha256`, `<pendingDir>`, `dispatch.json`, `outcome.json`), and a mismatch between the halves is exactly the defect class to prevent. The plan is intentionally narrow; the work has no latent parallelism.

- [ ] **Step 1: Write the failing drift-pin test file**

Create `tests/test_async_sealing.py` with exactly:

```python
"""Async sealing contract (#93): dispatch at spec approval, collect at plan
approval, keyed by the spec content hash.

All four of the seal author's original inputs exist at spec approval, so the
ultraplan sealing step dispatches the author in the background when the skill
is invoked and collects the finished seal after plan approval. These pins hold
the two halves of the protocol in lockstep: the brief works in a per-dispatch
pending dir (the shared pending/ path was the two-seals race), records the
spec hash in the manifest (collection is content-addressed, so a spec edit
invalidates by construction), and leaves a durable failure record; the skill
text dispatches at invocation, writes the dispatch receipt, surfaces failures
at plan approval, and falls back to today's synchronous flow.
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROMPT = (ROOT / "skills/ultraplan/references/seal-author-prompt.md").read_text()
SKILL = (ROOT / "skills/ultraplan/SKILL.md").read_text()
AGENT = (ROOT / "agents/seal-author.md").read_text()


# --- the brief (author side) ---

def test_brief_works_in_the_per_dispatch_pending_dir():
    assert "<pendingDir>" in PROMPT, (
        "the pending dir must be a dispatch input, not a constant"
    )
    assert "<vault>/pending/" not in PROMPT, (
        "a shared pending/ path is the two-seals race the per-dispatch "
        "dir exists to prevent"
    )


def test_brief_records_spec_hash_in_manifest():
    assert "specSha256" in PROMPT, (
        "manifest.specSha256 is the collection key — without it a stale "
        "seal is indistinguishable from a fresh one"
    )


def test_brief_writes_durable_failure_record():
    assert "outcome.json" in PROMPT
    assert "durable failure record" in PROMPT, (
        "GREEN_AT_BASELINE / EXAM_BOOTSTRAP_ERROR must survive the session "
        "that dispatched them — a returned message alone is lost to "
        "compaction"
    )


# --- the agent definition (thin pointer) ---

def test_agent_definition_names_the_new_inputs():
    assert "six inputs" in AGENT
    assert "pending dir" in AGENT


# --- ultraplan SKILL.md (dispatcher side) ---

def test_skill_dispatches_at_invocation_in_background():
    assert "### Dispatch at invocation" in SKILL
    assert "in the background" in SKILL


def test_skill_writes_the_dispatch_receipt():
    assert "dispatch.json" in SKILL, (
        "the receipt is what makes crashed-dispatch detection and "
        "stale-spec cleanup read state instead of guessing"
    )


def test_skill_collects_content_addressed_at_plan_approval():
    assert "### Collect at plan approval" in SKILL
    assert "specSha256" in SKILL
    assert "shasum -a 256" in SKILL


def test_skill_surfaces_async_failures_at_plan_approval():
    assert "outcome.json" in SKILL
    assert "at plan approval, never silently after" in SKILL


def test_skill_falls_back_to_synchronous_dispatch():
    assert "dispatch synchronously" in SKILL, (
        "the fallback is the never-worse-than-status-quo guarantee"
    )
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_async_sealing.py -v`
Expected: 9 FAILs (`<pendingDir>` not in PROMPT, `### Dispatch at invocation` not in SKILL, etc.). If any test unexpectedly PASSES, stop — a token collides with existing prose; tighten that token before proceeding.

- [ ] **Step 3: Rewrite the seal-author brief**

Replace the **entire content** of `skills/ultraplan/references/seal-author-prompt.md` with:

~~~markdown
# Seal author prompt (sealed acceptance)

Dispatch a fresh subagent of agent type `ultrapowers:seal-author`
(most-capable tier at dispatch; the reasoning-effort knob is pinned in the
plugin's `agents/seal-author.md` definition, never inherited from the
session) with exactly this brief plus the six inputs — spec text, test
conventions, base branch, vault path, spec hash (`specSha256`, computed by
the dispatcher over the approved spec file), and the per-dispatch pending
dir `<pendingDir>` (`<vault>/pending-<first-12-hex-of-specSha256>/`,
created by the dispatcher, which writes its `dispatch.json` receipt there
before dispatching).

---

You are the independent acceptance author. You have the feature SPEC only.
You must never ask for, read, or be told the implementation plan (when you
are dispatched at spec approval, it does not exist yet).

1. Derive acceptance criteria from the spec — observable behavior only.
2. Write a test suite encoding those criteria, in the repo's test framework,
   into `<pendingDir>/suite/`. Tests must run from a repo checkout root
   with the suite mounted at `.ultra-acceptance/` (e.g. run command
   `python3 -m pytest .ultra-acceptance -q`). If the repo's own libraries need
   an editable install or other setup to import (a `kb_lib`-style package, a
   polyglot monorepo), author a one-line `bootstrapCmd` that prepares the
   worktree (e.g. `python3 -m venv .venv && .venv/bin/pip install -e .[dev]`,
   with `runCmd` then invoking `.venv/bin/python -m pytest …`). Leave
   `bootstrapCmd` empty when the bare checkout already imports.
3. Prove RED through the EXACT gate runner — never an ad-hoc pytest call:
   `bash <plugin>/skills/ultrapowers/scripts/run_acceptance.sh --baseline \
     --suite <pendingDir>/suite --branch <base> --run "<runCmd>" \
     [--bootstrap "<bootstrapCmd>"]`.
   It must report `PROVEN_RED` (exit 0) because the feature is absent. If it
   reports `GREEN_AT_BASELINE`, the spec may already be satisfied — do not
   weaken tests to force red. If it reports `EXAM_BOOTSTRAP_ERROR`, fix
   `bootstrapCmd` until the env prepares. Read the output: a
   `redKind:"collection"` red must fail on the FEATURE's own import/symbol —
   if it fails importing a repo library instead, your `bootstrapCmd` is
   incomplete; fix it and rerun until the only failure is the feature.
   On a terminal failure — GREEN_AT_BASELINE, or an EXAM_BOOTSTRAP_ERROR you
   cannot fix — write `<pendingDir>/outcome.json`:
   { status: "GREEN_AT_BASELINE" | "EXAM_BOOTSTRAP_ERROR", specSha256,
   evidence (≤2000 chars), createdAt }, leave `<pendingDir>` in place as the
   durable failure record (the collect step reads it at plan approval; a
   failure must never exist only in your returned message), remove the
   worktree, and return the failure report with the runner output.
4. Compute the hash: `python3 <plugin>/skills/ultrapowers/scripts/seal_hash.py <pendingDir>/suite`.
   Rename `<pendingDir>` to `<vault>/<first-12-hex-of-hash>`. Write
   `manifest.json`: { sealId, planPath: null, specPath, specSha256,
   suiteSha256, runCmd, bootstrapCmd, createdAt, baselineSha, redEvidence
   (≤2000 chars), coverage: [{criterion, tests[]}] }.
   The coverage summary MUST also list every spec section the suite deliberately
   does not cover (browser-only, target-runtime-only, environment it cannot
   execute) with a one-line reason each — exclusions are vouched by the operator
   and flow into the gate's `deferredVerification` checklist.
5. Remove the worktree. Return ONLY: sealId, suiteSha256, redEvidence,
   coverage summary. Never return suite contents.
~~~

- [ ] **Step 4: Update the agent definition body (frontmatter untouched)**

Replace the **entire content** of `agents/seal-author.md` with (the frontmatter block is byte-identical to what is already there — only the body paragraph changes):

~~~markdown
---
name: seal-author
description: Independent acceptance author for sealed exams. Dispatched by the ultraplan sealing step with the full brief from skills/ultraplan/references/seal-author-prompt.md — never auto-select this agent for other work. Its reasoning-effort knob is pinned here (the single channel) so sealing cost never inherits the session's ambient effort setting; tier stays a dispatch-time decision, so no model key.
effort: high
---

You are the independent acceptance author. Your complete brief and its six
inputs — spec text, test conventions, base branch, vault path, spec hash,
pending dir — arrive in the task prompt; follow the brief exactly. You must
never ask for, read, or be told the implementation plan (when you are
dispatched at spec approval, it does not exist yet).
~~~

- [ ] **Step 5: Rewrite the ultraplan sealing section**

In `skills/ultraplan/SKILL.md`, replace the region starting at the line
`## Seal the exam (after plan approval)` and ending with the numbered item that ends `…the
spec may describe behavior that already exists.` (inclusive — i.e. the heading, the intro
paragraph, and numbered items 1–4). The two paragraphs that follow ("The operator may
instead record …" and "When the operator reviews …") and the `### Choosing the disposition`
subsection **stay exactly as they are**. New content for the replaced region:

~~~markdown
## Seal the exam (dispatch at spec approval, collect at plan approval)

A marked plan is not execution-ready until it carries an `**Acceptance:**`
line (the compiler refuses it otherwise). Every input the acceptance author
needs exists before the plan does, so a `sealed` plan front-runs its seal in
the background and collects it after the human approves the plan. Collection
is content-addressed by the spec hash: an edited spec can never match a
stale seal, by construction.

### Dispatch at invocation (before drawing tasks)

When this skill is invoked alongside writing-plans — the spec-approval
moment — and before any tasks are drawn:

1. Decide the Acceptance disposition first (see "Choosing the disposition").
   Only a clear `sealed` front-runs; `suite`, `waived`, and ambiguous cases
   skip dispatch — collect-time falls back to a synchronous seal.
2. Compute the spec hash: `shasum -a 256 <spec-file>` → `specSha256`.
3. Dedup against the vault `~/.ultrapowers/acceptance/`: a sealed dir whose
   `manifest.json` records this `specSha256`, a
   `pending-<first-12-hex>/outcome.json` failure record, or a pending dir
   whose background author is still running all mean this spec is already
   handled — skip.
4. Otherwise create `<vault>/pending-<first-12-hex-of-specSha256>/`, write
   the dispatch receipt `dispatch.json` there
   (`{specPath, specSha256, dispatchedAt}` — crashed-dispatch detection and
   stale-spec cleanup read this receipt instead of guessing), and dispatch
   a fresh-context author subagent in the background — agent type
   `ultrapowers:seal-author`, whose definition pins the reasoning-effort
   knob so sealing cost never rides the session's ambient setting — per
   `references/seal-author-prompt.md`. Its inputs are ONLY: the spec text,
   the repo's test conventions (framework, run command, naming), the base
   branch name, the vault path, the spec hash, and the pending dir. Never
   the plan (it does not exist yet), never this conversation's history.
   Plan authoring proceeds in the foreground without waiting.

The author works inside its per-dispatch pending dir, proves the suite RED
through the exact gate runner (`run_acceptance.sh --baseline …`), seals on
success, and on GREEN_AT_BASELINE or an unfixable EXAM_BOOTSTRAP_ERROR
leaves `outcome.json` in the pending dir as a durable failure record — the
brief owns that discipline end to end.

### Collect at plan approval

After the human approves the plan, hash the spec file as approved
(`shasum -a 256`) and take the first matching case:

1. **A sealed dir's manifest records this `specSha256`** → append to the
   plan, after the header block: `**Acceptance:** sealed <seal-id>
   (sha256:<hash>)` plus the coverage summary as a short appendix
   (spec-derived, safe to show). Zero wait.
2. **An `outcome.json` failure record matches** → surface it at plan
   approval, never silently after: GREEN_AT_BASELINE counts as attempt #1
   toward the two-attempt stop rule below; EXAM_BOOTSTRAP_ERROR surfaces
   with its evidence before any re-dispatch.
3. **The background author is still running** → say so and wait for it —
   the residual wait is bounded by today's synchronous cost minus the time
   already elapsed.
4. **No record for this hash** — the spec was edited after dispatch (a
   stale hash can never match), the dispatch crashed (a pending dir with
   no `outcome.json` and no live author), or nothing was dispatched →
   remove superseded `pending-*` dirs whose `dispatch.json` names this
   spec path, then dispatch synchronously with the same brief and inputs
   and wait. Never worse than the status quo.

Two consecutive green-at-baseline attempts → stop and tell the human: the
spec may describe behavior that already exists.
~~~

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `python3 -m pytest tests/test_async_sealing.py -v`
Expected: 9 PASS.

- [ ] **Step 7: Verify the pre-existing knob pins still hold**

Run: `python3 -m pytest tests/test_seal_author_agent.py tests/test_ultraplan_skill.py tests/test_recommendation_rubric.py -v`
Expected: all PASS with **zero edits** to those test files. If `test_dispatch_texts_do_not_regrow_effort_values` fails, the new prose stated an effort value — reword the prose, never the test.

- [ ] **Step 8: Run the full suite**

Run: `python3 -m pytest`
Expected: all green (579 before this task, 588 after; no failures, no skips introduced).

- [ ] **Step 9: Commit**

```bash
git add tests/test_async_sealing.py skills/ultraplan/references/seal-author-prompt.md agents/seal-author.md skills/ultraplan/SKILL.md
git commit -m "feat(ultraplan): seal at spec-approval — async, content-addressed (#93)"
```

---

### Task 2: Full-suite gate

**Type:** gate
**Depends-on:** 1

**Files:**

- [ ] **Step 1: Run the committed suite**

Run: `python3 -m pytest`
Expected: exit 0, all tests pass (expected count 588).

- [ ] **Step 2: Validate both skill dirs**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: both exit 0.

---

### Task 3: Release 0.0.35

**Type:** release
**Depends-on:** 2

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Bump both manifests to the same value**

Set `"version": "0.0.35"` in `.claude-plugin/plugin.json` **and** `.claude-plugin/marketplace.json` (they drift silently if only one moves).

- [ ] **Step 2: Release commit on main and push**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore(release): 0.0.35 — seal at spec-approval (#93: ultraplan dispatches the acceptance author in the background at invocation, collects content-addressed by specSha256 at plan approval, durable outcome.json failure surfacing, synchronous fallback; pinned by test_async_sealing.py)"
git push
```

Close issue #93 (the PR body or a closing comment referencing the release).

- [ ] **Step 3: Note the cache lag**

The installed plugin runs 0.0.34 prose until `/plugin` re-resolves 0.0.35 and a new session starts; repo work does not depend on it.
