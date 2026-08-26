# Post-#259 hardening: fold-over-git residuals + frontier-merge test pins (#275, #247)

**Status:** approved (operator pre-approved 2026-08-26; trim review recorded below)
**Issues:** #275 (six advisory residuals from the #259 run), #247 (two #186 review minors)
**Acceptance:** suite

## Scope

Eight small items, all advisory hardening on the 0.2.21 fold-over-git surface.
None touches the frozen verification periphery (`gate_check.py`, `ultra_gate.py`,
`run_lock.sh`, sealing). Editable surfaces: `finalize_report.py`, `waves.js`
(+ its prompt source `references/wave-merge.md`, re-baked per
`references/workflow-template.md`), reference docs, and tests. `fleet/**` is
untouched.

## Design

### S1 — Critic detach idempotency (#275-1) [baked prompt]

The completeness-critic prompt requires `git branch --show-current` to print
the integration branch, but the critic's own successful detach destroys that
precondition, so an engine-internal in-round retry of the `integration`
dispatch reads empty output and reports BLOCKED with zero findings.

Fix (the issue's adopted shape, one clause): the branch-check sentence in
`references/wave-merge.md` `BAKE:COMPLETENESS_PROMPT` gains an
already-detached acceptance — when `--show-current` prints nothing (a
detached HEAD) and `git rev-parse HEAD` equals
`git rev-parse {{INTEGRATION_BRANCH}}`, the critic treats that sha as
`<derived>` and skips the detach step; every other non-matching case stays
BLOCKED-with-no-findings. Edit the source `.md`, mirror the identical text
into `completenessPrompt` in `waves.js`, keep
`tests/test_no_prompt_drift.py` green. Fail-closed is preserved: a detached
HEAD at any sha *other* than the integration tip still blocks.

### S2 — Vacuous-merge guard in finalize_report.py (#275-2)

A merged-claimed branch with zero commits past the run base passes
`merge-base --is-ancestor` trivially and writes the base sha as the task
head, exit 0 — a fabricated merge claim survives finalization.

The guard needs the run base, which the report does not carry today. Two
halves:

1. `waves.js` adds `baseSha: setup.headSha` to the structured return (one
   line; documented in `references/report-format.md`). Provenance stated
   honestly: `setup.headSha` is the setup **agent's JSON-reported** value —
   the base itself rides model tokens, so this guard is advisory hardening
   layered on the git-derived checks, never a #114-grade authority.
2. `finalize_report.py` reads `target.baseSha`; when it resolves to a
   commit, each merged task additionally checks
   `merge-base --is-ancestor <tip_b> <base>` — success is an **error**
   ("branch X (task Y) tip Z is already an ancestor of the run base B —
   merged claim carries no commits beyond the run base"), exit 1, report
   untouched. When `baseSha` is absent or unresolvable, one named warning
   ("vacuous-merge guard skipped") and the guard is skipped — older saved
   reports keep working.

**Error, not warning** — decided: the implementer contract requires commits,
so a done+merged task always has ≥1 commit past the run base; a
resolvable-but-wrong fabricated `baseSha` fails closed. **Named pytest
pins** (trim review): zero-commit branch claimed merged → exit 1 + report
byte-identical; report without `baseSha` → "vacuous-merge guard skipped"
warning + exit 0; genuine branches with `baseSha` present → exit 0.
Documented residuals: (a) a fabrication whose tip equals a *prior wave's*
merge head (not the run base) is not caught — the run base is the only
engine-known fork point; (b) a fabricated **unresolvable** `baseSha` takes
the skip path (warning, exit 0) — the guard is defeated, not the run: the
git-derived ancestry checks above it still hold.

### S3 — ancestryMisses render widening (#275-3)

`waves.js` renders `String(m.headSha).slice(0, 12)`, but since #259 the
field may carry a resolution-failure message ("fatal: ambiguous …") which
truncation destroys. Fix (trim-review shape, adopted): **delete the
truncation outright** — render the full value. Nothing pins the 12-char
form today, and a full sha in an operator-facing judgment call is
acceptable prose; a format-discriminating conditional would be new
machinery protecting a cosmetic. Pinned in `tests/wave_ancestry_sim.mjs`
(a miss entry carrying a long resolution-failure message asserted to reach
the judgmentCall untruncated). The same sim's clean scenario also pins
S2's `report.baseSha` field.

### S4 — FOLD_LOG.md numbering anchor (#275-4)

`skills/ultrapowers/kernel/FOLD_LOG.md:10` anchors 1-based numbering to the
deleted "`heads/` slot convention". Reword to anchor to the wave numbering
the run reports. One line; no behavior.

### S5 — Named errors for report open/parse (#275-5)

`finalize_report.py` exits 1 with a raw traceback on a missing/malformed
`--report`. Wrap open/parse: OSError → "finalize_report: cannot read
--report <path>: <err>"; JSON decode error → "finalize_report: --report
<path> is not valid JSON: <err>"; exit 1. Message quality only — both paths
were already fail-closed. Pinned (trim review): both messages get a pytest
each, asserting the named fact and the absence of a traceback.

### S6 — test_finalize_report.py pin gaps (#275-6)

- The envelope fixture becomes `{"summary": "ok", "result": body}` and the
  test asserts `summary` survives the rewrite (guards a
  `json.dump(target, …)` regression that would destroy the envelope).
- `test_intermediate_wave_headsha_left_untouched` asserts
  `r.returncode == 0`.

### S7 — frontier_merge.mjs: contended leg of mergedWaveTasks (#247-1)

`mergedWaveTasks` is exercised on the partial-merge path only through
`compositionRows` (scenario 11i: one survivor → uncontended). New scenario:
a 3-task contended wave where one writer fails at implementation and the two
survivors contend. Pins, on the contended leg:

- the fold command carries `--branch` for the survivors only;
- `--commutes` carries only *surviving, declaring* tasks (the failed writer
  declares commutes too, so a drift joining launch tasks instead of merged
  tasks emits its entry — asserted absent);
- the resolver's `CONTENDING TASKS:` block names the survivors and not the
  failed writer;
- the wave completes (fold → resolve → adopt → MERGED).

### S8 — test_compile_plan.py helper folds (#247-2)

The issue names the `*_text` trio (`compile_plan_text`, `_serialize_text`,
`compile_raw_text`, ~line 1159) — three copies of the seven-line
write-tempfile/call/cleanup body. Fold them into the issue's own shape,
`_with_plan_file(plan_md, fn)`; the three public helpers become one-liners
(call sites unchanged).

Disclosed bonus (same file, same shape of duplication, found while in
there): the four path-based subprocess helpers at the top (`compile_plan`,
`compile_plan_serialize`, `compile_plan_raw`, `compile_plan_raw_with`) each
duplicate the `_with_waiver` + try/finally body — fold into one private
`_run_compiler(path, *extra)` returning the CompletedProcess.

## Constraints honored

- Frozen periphery: zero diff.
- Baked prompts: S1 edits `wave-merge.md` first, mirrors into `waves.js`,
  drift pin stays green.
- Harness-JS sim coverage: S2/S3 (waves.js) are pinned in
  `wave_ancestry_sim.mjs`; S7 lands in `frontier_merge.mjs`; both print the
  `ALL SCENARIOS PASSED` sentinel.
- `python3 -m pytest` is the gate (baseline 1146 green); suite runs are
  serialized (fleet fixed ports).
- No release cut; batched into the next one. Close #275/#247 via the PR.

## Trim review

**Author disclosure — Adds:** one report field (`baseSha`), one
finalize_report guard + two named error paths, one baked-prompt clause, one
render widening, ~3 test scenarios/pins, one doc line. **Removes:** three
duplicated test-helper bodies (S8). No new scripts, no new concepts beyond
the `baseSha` report field.

**Reviewer verdicts (fresh-context subagent, 2026-08-26):** S1 keep; S2
keep-but-underspecified (no guard tests named; provenance mis-framed;
fail-open skip path undocumented); S3 trim to unconditional deletion of the
truncation; S4 keep; S5 keep + name a pin; S6 keep; S7 keep (resolver leg
verified necessary — `contendingTasksBlock` reaches a prompt only at the
resolver dispatch); S8 wrong target (spec folded the top-four helpers, the
issue named the `*_text` trio). Scope reconciliation: S2's report field is
an expansion but justified (no smaller channel — the check is undecidable
without the fork point, and `ultra_gate.py` tolerates the new key with zero
periphery diff). Reviewer grade: **netConceptDelta flat** as first specced;
adopting the S3 trim and the S8 correction tips it **down**.

**Adopt-or-answer:**
- S2 guard tests: **adopted** — three named pins added to S2.
- S2 provenance: **adopted** — `baseSha` stated as agent-reported (rides
  model tokens); guard framed as advisory hardening, not #114 authority.
- S2 fail-open skip path: **adopted** — documented as residual (b).
- S3 unconditional deletion: **adopted** — conditional dropped.
- S5 pin: **adopted** — two message pins named.
- S8 correct target: **adopted** — `_with_plan_file` fold of the `*_text`
  trio per the issue; the top-four `_run_compiler` fold kept as a
  disclosed bonus.
- S4 note (frontier_merge.mjs comments the 1-based convention): **answered**
  — that comment anchors to the fold-dir path convention, which survives;
  the FOLD_LOG.md reword anchors to wave numbering, consistent with it.

Final grade (reviewer's rule applied post-adoption): **down**.
