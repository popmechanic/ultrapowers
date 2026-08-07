# The micro-redirect lane — the honest path becomes the cheap path

_Design for issue #115 (distill 2026-08-06). One deliberate scope change from
the issue, argued below: the head-match re-baseline (part 3) is deleted, not
built._

## Problem

After a gate round, the engine offers two exits: a **full relaunch** (correct
but expensive — a 2-task prose fix consumed 32 agents over 3 rounds) or an
**unaudited inline commit** (cheap but breaks the audit chain). The ledger
shows the economics winning: head-match correctly BLOCKED an orchestrator's
own ~26-line inline shortcut on a security-critical run; three other runs
improvised inline gate commits anyway; redirect relaunches are bespoke
hand-surgery on args/launch JSON, and one session's ad-hoc surgery step
errored mid-flight. One run demonstrated the correct cheap shape **by hand**:
narrow the resume args to the fix's files, drop the task tier, replay
everything else from journal cache — one small fix commit, green gate.

## Design

### 1. The Redirect bullet becomes the micro-redirect (SKILL.md Step 5)

No sibling variant: the **one existing Redirect bullet is rewritten** so the
helper invocation replaces the spread-the-argsFile hand-surgery incantation.
The rewritten bullet: append corrective instructions to only the affected
tasks **via the helper** — file scope narrowed to the fix, tier right-sized
down when the fix is mechanical — and relaunch `resume: true`, same
`integrationBranch`; untouched tasks replay from journal cache. Full
invariants preserved by construction: the fix flows through an implementer,
its reviewer, the wave merge, and a fresh gate. The gate presentation's
**fix-before-merge affordance is retargeted at this lane** in the same edit
(audit `report-format.md` and the gate-output text for the offer; it must
point here, not at an inline commit). One added line: inline commits on the
integration branch are unsanctioned, full stop.

Named asymmetry (follow-up, not this build): **Salvage** still hand-spreads
the receipt argsFile; unifying it onto the helper needs its own verification
of Salvage's wave-rebuild semantics and is filed as a follow-up rather than
silently reshaped here.

### 2. `redirect_args.py` — deterministic relaunch-args authoring (new script)

The hand-surgery step becomes a committed helper. **Authorship:** the
orchestrator authors `findings.json` from the gate report at Step 5; the
helper is the validator and mechanical applier of that judgment, not its
source.

    python3 skills/ultrapowers/scripts/redirect_args.py \
        --receipt <runDir>/receipt.json --findings <findings.json> [--out <path>]

- Loads the receipt's `argsFile` (the mandatory `pluginRoot`/`runDir` spread
  the SKILL already requires) — never rebuilds args from the report.
- Applies `findings.json`, a list of **amend** entries:
  `{"task": "3", "instruction": "…", "files": ["a.py"], "tier": "standard"}`
  — each amends that task's body (appends the corrective instruction under a
  `REDIRECT:` line), narrows its file scope when `files` is given, and
  right-sizes `tier` when given. **Amend-only in v1**: a residual outside any
  task's scope widens the nearest task's `files` via a normal amend entry.
  (Synthesized redirect tasks are parked as a watch-item — build on the second
  observed cross-file residual; a task with no plan anchor also needs its
  engine interaction proven first.)
- Emits the resume args (`resume: true`, same `integrationBranch`, untouched
  tasks byte-identical so the journal cache replays them) to `--out` or
  stdout. Validation: every amended task id must exist; exit non-zero with a
  named error otherwise.
- Stdlib only, no LLM step in the surgery itself.

### 3. Part 3 deleted: no head-match re-baseline

The issue proposed letting operator-authorized inline commits re-baseline
head-match with attribution. Not built, deliberately:

- The micro-redirect removes the **reason** inline commits exist — once the
  honest path costs one cached relaunch of one narrow task, a ~26-line diff no
  longer tempts anyone around the audit chain. Sanctioning the bypass and
  cheapening the non-bypass are substitutes; building both weakens the
  invariant for nothing.
- The stale-BLOCKED-receipt harm (an approved run's last disk receipt reading
  BLOCKED) is a *statistics* problem, and #113's terminus work already fixes
  it where it bites (approve receipts + merge evidence at harvest time).
- head-match stays absolute and `gate_check.py` stays untouched — no frozen
  periphery entry, no attribution vocabulary, no new gate state.

### Canary (rigor trade — required)

Tier right-sizing down + file-scope narrowing trades review rigor for cost, so
both of the issue's canaries are recorded: **redirect-round rate** (compared
across engineVersion before/after adoption) and **head-match-BLOCKED receipts
on ultimately-approved runs** (should go to zero once the lane exists). A
rising canary drafts the reversal per the distill retrospective.

## Surfaces

- `skills/ultrapowers/scripts/redirect_args.py` (new) +
  `tests/test_redirect_args.py` (new).
- `skills/ultrapowers/SKILL.md` — the Redirect bullet rewritten (helper
  replaces the incantation; inline-commit prohibition line). Within the
  complexity-ratchet budget — the deleted incantation pays for the additions.
- `skills/ultrapowers/references/report-format.md` (and gate-output text if it
  carries the offer) — the fix-before-merge affordance retargeted at the
  micro-redirect lane.

Not built: no gate/lock/sweep changes, no waves.js changes, no new report
fields, no head-match modification of any kind.

## Error handling

- Findings entry naming a nonexistent task → exit 1 naming the id; nothing
  emitted.
- Receipt missing `argsFile` / argsFile unreadable → exit 1 naming the path.
- The helper never launches anything — emitting args is its whole authority;
  the engine's own launch validation remains the execution gate.

## Testing

`tests/test_redirect_args.py`: amend-existing (body gains REDIRECT line, files
narrowed, tier changed, sibling tasks byte-identical); unknown task id →
exit 1; missing argsFile → exit 1; emitted args carry
resume/integrationBranch/pluginRoot/runDir from the receipt spread.

## Trim review

**Author disclosure (Adds/Removes), as drafted.** Adds: one committed helper +
tests; a named micro-redirect variant beside the Redirect bullet; a synthesize
mode. Removes: the LLM-owned args-surgery step; the issue's part 3 (head-match
re-baseline — deleted as a substitute, not deferred); the economic incentive
for inline commits.

**Reviewer verdicts** (fresh-context dispatch; saw the draft spec, issue #115,
the doctrine, and SKILL.md): 4 trims + 4 gaps; **endorsed the part-3 deletion
on the merits** ("sanctioning the bypass and cheapening the non-bypass are
substitutes"), contingent on closing the fix-before-merge gap; grade: up as
drafted, **flat on the trimmed shape**.

**Adopt-or-answer:**

1. Sibling variant → **adopted** (merge): the one Redirect bullet is
   rewritten; the helper replaces the hand-surgery incantation outright.
2. Synthesize mode → **adopted** (narrow): amend-only v1; cross-file
   residuals widen the nearest task's files; synthesize parked as a
   watch-item (build trigger: second observed cross-file residual) — which
   also moots the reviewer's synthesized-task-vs-engine gap.
3. Salvage hand-spread asymmetry → **partially adopted**: named in the spec;
   unification filed as an explicit follow-up (Salvage's wave-rebuild
   semantics need their own verification; silently reshaping them here would
   be reverse scope creep).
4. Tautological round-trip self-check → **adopted** (delete).
5. **Gap:** fix-before-merge affordance would keep inviting inline commits →
   **adopted**: report-format/gate-output offer retargeted at this lane in
   the same edit.
6. **Gap:** canary silently dropped → **adopted**: both issue canaries
   restored as a recorded section.
7. **Gap:** findings.json authorship undocumented → **adopted**: orchestrator
   authors from the gate report; helper validates.

**Reviewer grade on the shipped shape: flat** — the helper replaces an
equally-weighty standing incantation, and part 3's machinery never gets built.
