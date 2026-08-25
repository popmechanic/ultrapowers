# Post-PASS Redirect Policy Implementation Plan (#225)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a PASS verdict, advisory residuals default to `filed:` and every finding the operator does want fixed is batched into ONE redirect round; an elective polish relaunch happens only on an explicit operator opt-in with the round's fixed cost stated up front. Serial narrow rounds dominated cost in four of six batch runs (58% tokens / 69% wall in a five-round tail).

**Architecture:** Prose only — the cycle's ONE additive guard (the "redirect-after-PASS token policy" watch-item fired its second occurrence). One new bullet in SKILL.md Step 5 beside the Redirect bullet, and one sentence in `references/finishing-notes.md` §Residual manifest tying the default disposition to the grammar that already exists there (`filed:<ref>`). Nothing changes for NEEDS_ACK or BLOCKED: the ack rules in Step 5 stay authoritative, and "batch into one round" must never read as "the orchestrator swallows acks" (#236 watch). No test pins the Redirect wording; no new machinery.

**canaryMetric:** elective redirect-round share by engineVersion — if elective rounds do not fall in the next distill, the prose failed and the next distill drafts the reversal.

**Tech Stack:** Markdown.

**Spec:** GitHub issue #225 plus its docket entry `docs/superpowers/docket.md` (`### #225`). Sequenced after #222 (which rewrote the Salvage bullet and added a **Round artifacts** bullet) and #223 (which reworded the Redirect bullet's `files` clause); this plan adds a new bullet and touches neither.

**Acceptance:** suite — pure skill/reference prose with no test pin; the committed suite (skill-validator + rubric/marker pins) is the verification, no held-out exam.

## Global Constraints

- The verification periphery is FROZEN: never touch `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `run_acceptance.sh`, `collect_seal.py`, `seal_hash.py`.
- SKILL.md Step 5's ack rules (the `2 (NEEDS_ACK)` clause and standing-approval sidecar rules) are not reworded; the new bullet only references them.
- Shrink budget: the net word delta of this plan to `skills/ultrapowers/SKILL.md` is ≤ +110 words (`wc -w` before vs after).
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` must pass.
- No Anthropic API calls or SDK anywhere; no new dependencies.
- The full gate is `python3 -m pytest`; every task leaves it green.

---

### Task 1: SKILL.md Step 5 — the post-PASS redirect policy bullet (+ finishing-notes cross-reference)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/finishing-notes.md`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing code-level.

- [ ] **Step 1: Record the word count**

Run: `wc -w skills/ultrapowers/SKILL.md`
Expected: a number N (record it; the post-edit count must be ≤ N + 110).

- [ ] **Step 2: Insert the policy bullet**

In `skills/ultrapowers/SKILL.md` Step 5, immediately after the `- **Redirect (micro-redirect)** — …Return here.` bullet (before whatever bullet follows it), insert exactly:

```markdown
- **After PASS: file, batch, price** — once the gate returns PASS (exit 0),
  every advisory residual (minor review findings, non-blocking completeness
  findings, judgment calls) defaults to `filed:<ref>` in the residual manifest
  (`references/finishing-notes.md` §Residual manifest). Findings you do intend
  to fix go into ONE redirect round — never a round per finding. An elective
  polish relaunch is the operator's explicit choice, priced before asking:
  state the round's fixed cost (tasks relaunched × this run's per-round cost —
  quote `audit_run.py` turns/tokens for the prior round when present). This
  changes nothing for NEEDS_ACK or BLOCKED: the ack rules above stay
  authoritative, and batching never means an ack is swallowed.
```

- [ ] **Step 3: Cross-reference the default in finishing-notes**

In `skills/ultrapowers/references/finishing-notes.md` §Residual manifest, directly after the `- `waived:<reason>` — stays open with the reason stated.` line, add the paragraph:

```markdown
After a PASS verdict the default for every advisory row is `filed:<ref>`
(SKILL.md Step 5, **After PASS: file, batch, price**); `fixed` is earned by
the one batched redirect round, never by a round per row.
```

- [ ] **Step 4: Verify budget, validator, and pins**

Run: `wc -w skills/ultrapowers/SKILL.md` — Expected: ≤ N + 110.
Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` — Expected: exit 0.
Run: `python3 -m pytest tests/ -q -k "skill or recommendation or ultraplan or canary"` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/finishing-notes.md
git commit -m "docs(skill): Step 5 post-PASS redirect policy — file by default, batch into one round, price elective relaunches (#225)"
```

---

### Task 2: Suite gate

**Type:** gate
**Depends-on:** 1

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: all green.

---

## Operator smoke

- do: open `skills/ultrapowers/SKILL.md` Step 5 and find **After PASS: file, batch, price**.
  see: it sits right after the Redirect bullet; it names `filed:<ref>`, "ONE redirect round", and the priced opt-in; the `2 (NEEDS_ACK)` clause above it is unchanged.
- do: at the next real PASS gate with advisory residuals, watch the orchestrator's next move.
  see: a manifest with `filed:` rows and at most one redirect round offered with a stated cost — never an unprompted polish relaunch. (Canary: elective redirect-round share by engineVersion.)
