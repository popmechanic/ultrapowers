# #84 hardening remainder — the live seams, the stale seam, and the doc face

_Design for issues #103 + #102, one build. Each of #103's five seams gets an
explicit disposition after a staleness check against shipped 0.1.14 (#108) —
the distill doctrine's weigh-the-engineVersion rule applied at planning._

## Staleness verdicts (checked against current main; audited by the trim review)

- **Seam 1 (unpinned sweep instruction): STALE — closed structurally by
  #108.** `ultra_gate.py --approve` mechanically appends `wf_<stamp>` to the
  sweep set (lines 139-141) and any non-zero sweep fails approve via
  `sweepFailures` (148-165). No build; closing evidence recorded on the issue
  at the end gate.
- **Seam 2 (approve↔detach coupling): STALE — closed by code, found at trim
  review.** Approve-on-held-branch already fails loudly: `git checkout` at
  ultra_gate.py:131-133 feeds git's stderr (which names the holding worktree)
  into `blocked()`. The budget-exhausted report signal is already pinned by
  three sims (`scenarioBudgetExhausted`, `scenarioBudgetDiesMidWave`,
  `scenarioBudgetDiesBeforeReconcile`). No build; same evidence-recording as
  seam 1. The frozen scripts stay byte-identical **unconditionally**.
- **Seam 3 (GUARD omits the per-task reviewer): PARTIALLY STALE.** The
  current GUARD names review roles READ-ONLY; what remains is the location
  list, which gives the per-task reviewer no sanctioned arm. One clause.
- **Seam 4 (resume-reuse cleanliness): LIVE, narrower than filed.** The
  contract sentence is missing, but "zero sim coverage of that arm" was
  wrong — `scenarioResume` (F16) already exercises the resume setup prompt.
  The fix is the sentence; the pin is the existing drift machinery.
- **Seam 5 (setup bootstrap outcome): DEMOTED to watch-item.** No observed
  incident is cited, and setup already reports its baseline result — a red
  bootstrap surfaces as a red baseline, so the marginal value of a separate
  field is unproven. Build trigger: the first observed opaque-TEST_FAILED
  actually traced to a hidden bootstrap failure. (This also keeps the cycle
  at exactly one budgeted additive guard — #116 holds that slot.)
- **Dead-critic corner** (a thrown completeness critic — the one seam-2 leg
  the sims may not cover): watch-item, build on first occurrence.
- **Sequencing note:** #103 asked to sequence after the #84 live shakedown.
  Seams 1–2 closed against *code*, not runtime behavior, so the shakedown
  cannot reopen them; seams 3–4 and #102 are prose-coherence items the
  shakedown does not touch. The shakedown itself arrives with this docket
  run's engine-executed entries.
- **#102's three workflow-template.md contradictions: LIVE** (pure docs).

## Design (the live items)

### 1. Seam 3 remainder — the GUARD location clause

One clause in the GUARD (source `reviewer-prompts.md` BAKE:GUARD + identical
re-bake): the per-task reviewer operates non-isolated in the session launch
directory, read-only, judging from the pre-baked packet. Fold the em-dash
appositive nit into the same edit (source and bake matched exactly).

### 2. Seam 4 — the resume-reuse cleanliness sentence

The resume setup prompt's reuse arm gains its expectation: the reused
integration worktree must be clean before checkout — a dirty tree is reported
BLOCKED with the porcelain output, never silently absorbed into the run's
diff. Source: `wave-merge.md`; re-bake. One assertion line added to the
existing `scenarioResume` (the dispatched resume prompt carries the
cleanliness sentence) — **no new sim scenario**: the live dirty-tree behavior
is prose compliance the canned-agent harness cannot exercise, and the drift
pin already owns sentence fidelity.

### 3. #102 — workflow-template.md catches up with #84

Fix the three named contradictions (merge/completeness "on the session main
checkout" ×2; setup "checks it out before creating the integration branch")
to describe the shipped choreography: integration lives in its dedicated
worktree under `.claude/`, setup creates it, the critic detaches inside it.

## Surfaces

- `skills/ultrapowers/references/reviewer-prompts.md` (GUARD clause + em-dash)
  and `skills/ultrapowers/references/wave-merge.md` (resume sentence), each
  re-baked into `harnesses/waves.js`; drift pins green; existing sims pass
  (harness change ⇒ sentinel discipline), `scenarioResume` gains one
  assertion line.
- `skills/ultrapowers/references/workflow-template.md` — the three fixes.
- Frozen scripts byte-identical, unconditionally.

## Error handling

- Resume-reuse dirty tree → BLOCKED with porcelain output (prompt contract;
  agent-compliance class, watched not machine-enforced).

## Testing

- Drift pins (GUARD, setup prompts) green across source + bake.
- Existing sims green with the one added `scenarioResume` assertion; the
  suite-gate's sentinel discipline applies to the waves.js re-bake.
- No new test files, no new scenarios — deliberate, per #106's ballast
  pressure and the trim review.

## Trim review

**Author disclosure (Adds/Removes), as drafted.** Adds: one GUARD clause, one
resume cleanliness sentence, one optional setup-schema field, two sim
scenarios, one coupling pin, a conditional frozen-script error-message rider.
Removes: one stale seam; three false doc claims.

**Reviewer verdicts** (fresh-context dispatch; saw the draft spec, issues
#103 + #102, the doctrine, and `ultra_gate.py`; explicitly primed with
#106's ballast pressure): 3 trims + 4 gaps + a staleness audit that
**out-stalenessed the draft** — seam 2 is closed by code (loud approve
failure at ultra_gate.py:131-133; budget signal triple-sim-pinned) and the
draft's seam-4 "zero sim coverage" premise was false (`scenarioResume` F16
exists); grade as drafted: marginally up, driven entirely by test/pin mass —
"precisely the #106 accretion vector this review exists to catch."

**Adopt-or-answer:**

1. Seam-2 build (map + sim pin + conditional frozen rider) → **adopted**
   (delete): moved to the staleness section with code citations; frozen
   scripts byte-identical unconditionally.
2. Seam-4 new sim scenario → **adopted** (narrow): the sentence + one
   assertion line in the existing `scenarioResume`; no new scenario.
3. New-sims testing bullet → **adopted** (delete): the build's tests/
   footprint is ~zero new mass, deliberately.
4. **Gap** seam-2 evidence symmetry → **adopted**: recorded like seam 1.
5. **Gap** seam-5 recurrence basis → **adopted, beyond the reviewer's
   either/or**: demoted to a watch-item outright — no cited incident, setup's
   baseline report already surfaces the failure indirectly, and #116 already
   holds the cycle's one additive-guard slot. Build trigger named.
6. **Gap** dead-critic corner → **adopted**: watch-item, first occurrence.
7. **Gap** #103's sequencing precondition → **adopted**: recorded — code-level
   closures can't be reopened by the shakedown; the shakedown arrives with
   this docket run's engine entries.

**Reviewer grade on the trimmed shape: flat** — two prompt sentences and
three doc corrections, with the falsehood removals offsetting the coherence
clause.
