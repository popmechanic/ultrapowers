# Sense-Pass Posture Pair (#141 + #142) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two prose paragraphs making silent behaviors inspectable, per spec `docs/superpowers/specs/2026-08-10-sense-pass-posture-pair-design.md`: drains are sensed by commissioned transcript reads (ultralearn), and drains run on suite-gate authority with review-by-exception (ultradocket).

**Architecture:** Prose-only. Each task appends/inserts exactly the spec's final blockquote text into one SKILL.md at the spec's pinned anchor, verifies placement and word budget, and runs the suite as regression cover for tooling.

**Tech Stack:** Markdown, pytest (regression only — no test pins either file's prose).

**Acceptance:** suite — prose-only edits; the committed suite proves the tooling and pinned spans are unaffected; there is no behavior to exam (spec §Acceptance).

## Global Constraints

- Insert the spec's blockquote text **verbatim** (minus the `> ` quoting) — every clause is load-bearing per the spec's four review rounds; do not paraphrase, trim, or "improve" it.
- Net addition ≤ 120 words per file, verified by `wc -w` on the added text.
- No other line of either SKILL.md changes. The `<ultrapowers-routing>` heredoc, the numbered-step text, and every other section stay byte-identical.
- No scripts, no schema, no gate or harvester code, frozen periphery untouched.
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: ultralearn sense verb — commissioned-read paragraph (#141)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/SKILL.md:19`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by other tasks (prose).

- [ ] **Step 1: Insert the paragraph**

In `skills/ultralearn/SKILL.md`, step 1 of Verb 1 currently ends with the watermark sentence ("Incremental: a watermark means re-runs only process new sessions."). Append the following as a continuation of list item 1, indented three spaces to stay inside the list item (an unindented paragraph would visually orphan steps 2–3):

```markdown
   Sequential-engine drains (subagent-driven, inline) make no `Workflow`
   calls and are **invisible to this detector by design** — "0 new" there is
   correct, not a bug. Drains are sensed by **commissioned transcript
   reads**: after a drain, dispatch readers at the drain session's
   transcript with the same five lenses, including the redirect-round count,
   assigned to exactly one reader. Readers MUST set `evidenceAbstracted:
   true` (no bundle triggers the foreign rule), stamp `engineVersion` (plain
   version string — the repo release at drain time), and use the drain
   session id as `runId`; the merge guard then forces only `origin: foreign`
   — accepted. Promote trigger for a drain detector: a sense pass where
   commissioned reads **miss or misread** drain evidence; record the miss as
   a ledger finding.
```

- [ ] **Step 2: Verify placement and budget**

Run:
```bash
grep -n "invisible to this detector by design" skills/ultralearn/SKILL.md
grep -c "assigned to exactly one reader" skills/ultralearn/SKILL.md
git diff skills/ultralearn/SKILL.md | grep "^+" | grep -v "^+++" | sed 's/^+//' | wc -w
```
Expected: the first grep hits inside step 1 (a line number between the watermark sentence and the `2. **Read.**` step); the second prints `1`; the word count is ≤ 120.

- [ ] **Step 3: Run the suite**

Run: `python3 -m pytest`
Expected: green (no test reads this file; the run proves tooling untouched).

- [ ] **Step 4: Commit**

```bash
git add skills/ultralearn/SKILL.md
git commit -m "docs(#141): sense verb — drains are sensed by commissioned transcript reads"
```

---

### Task 2: ultradocket run mode — review-posture paragraph + end-gate item (#142)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultradocket/SKILL.md:167-169,198-199`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by other tasks (prose).

- [ ] **Step 1: Insert the posture paragraph**

In `skills/ultradocket/SKILL.md`, run mode: wrapper step 5 ("**Auto-advance** to the next `queued` entry…") is the last numbered item before the `### The exam-gated auto-approve` heading. Insert the following as a new paragraph between that step's end and the heading (blank line before and after):

```markdown
**Review posture: suite-gate authority, review by exception.** The drain
dispatches no per-task reviewer of its own, and its step-2 dispatch
instructs the sequential executor to skip its review passes — per-task
and final — the step-3 gate is the verification. One exception: each task
its plan marks `**Review:** adversarial` (from `launch_waves[].review`
of step 3's own `compile_plan` run — no extra compile) gets one fresh
review via `superpowers:requesting-code-review` against the diff from
docket-line HEAD plus the plan text, before the plan's gate;
Critical/Important findings park the entry exactly as a red gate does
(Minor: noted at the end gate). Posture drift after this declaration is
the recurrence that buys enforcement.
```

- [ ] **Step 2: Extend the end-gate evidence list**

In the `### The single end gate` section, the per-entry sentence currently reads:

```markdown
Per entry: exam evidence (raw runner JSON), engine, cost,
disposition (`executed`/merged or `parked` + reason), and branch; plus portfolio
totals and the could-have-parallelized projection.
```

Change it to:

```markdown
Per entry: exam evidence (raw runner JSON), engine, cost,
disposition (`executed`/merged or `parked` + reason), branch, and the review
posture used (suite-gate authority, or the escalated tasks named); plus portfolio
totals and the could-have-parallelized projection.
```

- [ ] **Step 3: Verify placement and budget**

Run:
```bash
grep -n "Review posture: suite-gate authority" skills/ultradocket/SKILL.md
grep -c "posture used" skills/ultradocket/SKILL.md
git diff skills/ultradocket/SKILL.md | grep "^+" | grep -v "^+++" | sed 's/^+//' | wc -w
```
Expected: the posture paragraph sits between wrapper step 5 and the `### The exam-gated auto-approve` heading; `posture used` count is `2` (paragraph + end-gate item); net added words ≤ 135 gross for the diff (the ≤120 budget applies to net new words — the end-gate edit re-adds ~14 existing words the diff double-counts; if the gross count exceeds 135, stop and recount by hand).

- [ ] **Step 4: Run the suite**

Run: `python3 -m pytest`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultradocket/SKILL.md
git commit -m "docs(#142): drain review posture declared — suite-gate authority, review by exception"
```
