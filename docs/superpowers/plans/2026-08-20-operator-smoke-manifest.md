# Operator Smoke Manifest (#169) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ultraplan-authored plan carries a `## Operator smoke` section — 3–5 behavioral probes aiming the operator's one human check where suite+exam are structurally blind.

**Architecture:** Prose-only: one new ≤200-word authoring section in `skills/ultraplan/SKILL.md`, inserted between "The final authoring step — validate" and "Populate the v6 blocks". No scripts, no engine change, no new pins. Mirrored spans (plan-markers mirror in "Add markers to every task", BRANCH_CLAUSES rubric tokens) are untouched.

**Tech Stack:** Markdown; pytest (existing pins only).

**Spec:** GitHub issue #169 (issue-as-spec; design approved in docket Notes 2026-08-20 — plan-section form chosen over sibling SMOKE.md).

**Acceptance:** suite — prose-only change; the drift/rubric pins plus validate-skill are the verification.

## Global Constraints

- The smoke manifest is ADVISORY ONLY — never a gate input (frozen-periphery firewall); the section text must state this.
- Do not edit the mirrored marker blocks or any rubric-pinned clause (`tests/test_no_prompt_drift.py`, `tests/test_recommendation_rubric.py` must stay green untouched).
- New section ≤200 words.

---

### Task 1: Add the `## Operator smoke` authoring section to ultraplan SKILL.md

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultraplan/SKILL.md`

Insertion point: after the "## The final authoring step — validate" section (currently ending near line 251), before "## Populate the v6 blocks".

**Interfaces:**
- Consumes: nothing.
- Produces: the `## Operator smoke` authoring rule every future plan-authoring session follows.

- [ ] **Step 1: Insert the section** — exactly this text (198 words incl. heading):

```markdown
## Operator smoke — aim the one human check

After validating, append a `## Operator smoke` section to the plan document
itself (never a separate file). It is the operator's post-merge hands-on
check: 3–5 behavioral probes, each two lines —

- `do:` one concrete action in the running software (a command to type, a
  page to open, a button to press)
- `see:` the observable result that proves the seam works

Choose probes adversarially: aim precisely where the suite and any sealed
exam are structurally blind — integration seams between tasks, visual/UI
states, CLI output feel, error-path wording, anything a green gate cannot
see. Never restate what a committed test already asserts; a probe that
merely mirrors the suite is dead weight. Write probes a non-technical
operator can run verbatim, no repo knowledge assumed.

If the plan's work has no operator-observable surface (pure refactor,
internal tooling), write `## Operator smoke` with the single line
"No observable surface — suite is the whole story." rather than inventing
probes.

The manifest is ADVISORY ONLY. It is never a gate input, never parsed by
the compiler or engine, and never blocks a merge — it aims human
attention, nothing more.
```

- [ ] **Step 2: Verify pinned surfaces untouched**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_recommendation_rubric.py -v`
Expected: PASS with zero edits to those tests.

- [ ] **Step 3: Validate the skill + full suite**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` then `python3 -m pytest`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add skills/ultraplan/SKILL.md
git commit -m "feat(ultraplan): operator smoke manifest section in every plan (#169)"
```

## Operator smoke

- do: open `skills/ultraplan/SKILL.md` and read the new section aloud once.
- see: it fits on one screen, ≤200 words, and states ADVISORY ONLY explicitly.
- do: author any small plan with ultraplan after this lands.
- see: the session appends a `## Operator smoke` section with `do:`/`see:` probes without being asked.
