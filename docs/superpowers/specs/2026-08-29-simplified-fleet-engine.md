# Spec: the simplified fleet engine — Amendment 10's build (#366, #402)

**One sentence.** The fleet engine stops loading `waves.js` and becomes a native
`fleet/` program in which every git verb, path, and sequence is driver code and a
model is dispatched only to make a judgment — implement, review, fix, resolve,
attest — with the driver handing content in and capturing content out.

**Authority.** #366 Amendment 10 (operator, 2026-08-29): *models never run git;
drivers never make judgments.* Mirrored into
`2026-08-28-one-driver-design-inputs.md` by PR #422 — this spec merges after it
and cites the mirror. Sequencing: simplify first, then validate — the
pre-registered cutover bar transfers unchanged to run-26 as this engine's first
run (gate-green, `reported == ledger`, width-2, orchestrator opens a READY PR).
`waves.js` and the Workflow path are **not edited**; they remain the fallback
until cutover.

## §1 The shape

`fleet/run-main.mjs` keeps its outer legs — preflight → tiers → provision →
engine → the clone→repo fetch bridge → finalize/gate → approve (`run-main.mjs`
445–499; the bridge is the leg run-25 parked on and it stays) — and swaps the
engine leg: instead of `runWaves()` executing `waves.js` source, it calls
`runEngine()` from a new **`fleet/run-engine.mjs`** — the wave control flow as
ordinary driver code. Everything below run-main is the assembly that runs today:
`createRunWorker` (one `claude -p` per judgment), `withPatchCapture`,
`cloneAtBase`, `makeEventLog`, the confine-hook, the frozen gate scripts.

**Permission posture: unchanged** (`acceptEdits` + the hook's allow/deny
decisions, the pairing run-25 executed end-to-end). The `bypassPermissions`
switch is **deferred to run-27** as its own measured change: run-26 must park on
at most one novelty class, and first-run-under-bypass would be a second — and
whether `--disallowedTools` still binds under bypass is unmeasured (the
2026-08-29 probe, recorded in Amendment 10's mirror, measured only that a
PreToolUse deny holds). *(Trim review 1: adopted.)*

## §2 The ten sites — was → becomes

| waves.js site | was | becomes |
|---|---|---|
| `setup` | haiku agent runs `git worktree add`, baseline | **driver**: create `ultra/integration-<stamp>` in the integration clone; run `bootstrapCmd` (when supplied) in the integration clone and each task clone at provision; exec `testCmd` there for the baseline |
| `impl:<id>` | judgment + choreography prose | **agent (judgment)**: task + test command; edit your tree; driver captures the diff |
| `review:<id>:<iter>` | judgment + acquisition prose | **agent (judgment)**: the patch file is the input; verdict schema out |
| `fix:<id>:<iter>` | judgment + packet-range/PRIOR ritual | **agent (judgment)**: same tree, the blocking issues, edit in place; capture is cumulative against BASE by construction |
| `merge:wave<n>:fold` / `:apply<i>:<a>` / `:adopt` | opus agent types the kernel CLI string the engine composed | **driver**: `execSeam` the same `fold_wave.py` commands; fold receipts land in the event log |
| `resolve:wave<n>:<i>:<a>` | judgment; agent writes the reply dir | **agent (judgment), read-only role**: conflict hunks in, resolution *contents* out in its schema; the **driver writes the reply dir** (grammar unchanged) and invokes kernel resolve. Risk recorded: an outsized hunk strains a structured reply — surfaced as a failed resolution, never truncated silently |
| ordinary git-merge path | agent merges branches | **deleted, not ported** — a disclosed narrowing of Amendment 10's "becomes driver code," licensed by Amendment 9: under patch input `waves.js:1851` already routes every wave to the kernel unconditionally, so the path is unreachable |
| `reconcile` | judgment + sweep choreography; unreachable on the patch route today | **agent (judgment), new trigger**: after driver adopt, the driver runs `testCmd`; red → dispatch reconcile (cwd = integration clone: fix the failures, commit), cap 2 attempts, driver re-runs the suite after each; still red → wave `TEST_FAILED`, dependents cascade-block (the `waves.js:2301` disposition). This is a semantic addition — today's patch route has no post-fold suite repair at all — and is named as such |
| `integration` critic | judgment + sha-verified detach + its own suite run | **agent (judgment)**: read-only completeness against the integrated tree; the detach and the suite run move to the driver (see §3.1); the critic's three extra git verbs (`checkout --detach`, `rev-parse`, `merge-base`) become deletable — its allowlist collapses to READ_ONLY_TOOLS *(deletion ledger row)* |
| barrier retry / tier escalation / fix-loop cap / fail-run latch | engine JS | **kept verbatim in semantics** — the judgment-flow logic is sound |

## §3 Contracts held fixed (the walls the rewrite must not move)

1. **The report object — field-by-field producers.** `runEngine()` returns the
   structure of `references/report-format.md`; `finalize_report.py` and
   `ultra_gate.py` run unchanged (the verification periphery is frozen, 0.1.0).
   The producers that change, named:
   - `tests.{command,passed,output}` and `acceptance.passed` (mode `suite`):
     the **driver** runs `testCmd` via `execSeam` on the integrated tree after
     the final wave (was: the critic's own suite run) — the critic stays
     read-only.
   - `gitVerified`: **redefined, disclosed.** Was "the critic returned
     `onIntegrationHead: true` and zero ancestry misses." Becomes
     driver-derived: the integration branch tip equals the final adopt
     receipt's sha AND every task reported merged appears in a fold receipt.
     `report-format.md` gains a patch-input note in this change.
   - `ancestryMisses`: driver-derived — tasks reported merged but absent from
     the fold receipts (the #70 silent-drop check, now against receipts
     instead of `merge-base`).
   - `coverage`, `waveMerges`, `frontier`, `baseline`, `baseSha`: driver, from
     its own execs and receipts.
   - `judgmentCalls`, `completenessFindings`, `deferredVerification`,
     `tasks[]`, `unfinished`, `blockedWaves`: unchanged producers (engine log
     and agent replies).
   - `tasks[].startHead` / `baseCorrected`: **kept one more run** — the #314
     guard's deletion waits for the measured license its own comment demands
     (`run-waves.mjs:107-112`), not this spec. *(Trim review gap 6: answered.)*
2. **The worker seam.** `agent(prompt, opts)` with `label`/`model`/`schema`/
   `isolation` and the null-on-abort convention; `roleForLabel` gains no
   permissive default; judgment labels keep their shapes
   (`resolve:wave<n>:<i>:<a>`). The five driver-performed legs emit **no worker
   receipts**; their record is the event log — `driver:stage` plus fold-receipt
   events — so a sense pass still sees the choreography.
3. **Patch capture is the trust anchor** (Amendment 9, #402 obligation 1):
   `withPatchCapture` + patches-dir prefix, unchanged.
4. **Failure vocabulary.** AGENT_NULL → barrier retry; schema-shaped throw →
   one tier escalation; anything else → one same-tier retry; fail-run latches;
   budget latches per label. The escalation regex moves into `run-engine.mjs`
   as the one shared definition; `fleet/tests/test_run_worker.mjs`'s existing
   pin (classify's wording vs the regex, today extracted from waves.js source)
   is repointed at `run-engine.mjs` so the new engine — not the fallback — is
   what the pin holds. *(Trim review gap 1: adopted.)*
5. **The confine-hook**, the per-run `CLAUDE_CONFIG_DIR` spend read, the event
   log, `WIDTH = 8`, per-role timeouts: as assembled in #419.

## §4 Prompts become data files — and the bake machinery becomes unnecessary here

The five judgment prompts live as **plain files in `fleet/roles/`**, read at
dispatch. One copy, so nothing to bake and nothing to drift:
`test_no_prompt_drift.py` keeps pinning the untouched `waves.js` fallback only.
One ceiling: **each role file ≤ 350 words** (#366 rule 5; per-role numbers wait
for per-role data — Trim review 3: adopted). No ALL-CAPS imperatives: a rule
that needs shouting belongs in code.

What the trimmed prompts drop, and why it is safe: worktree-path litanies (cwd
is the clone; the hook is the boundary), BASE-anchoring prose (#314 is
inexpressible under `cloneAtBase`; the schema still carries `startHead`, §3.1),
packet generation (the driver captures), branch/sha self-reporting as authority
(driver derives; agent words are context only), sweep instructions (clones die
with the run dir), the GUARD (replaced by the two-sentence headless orientation
already in `ROLE_PROMPTS`).

## §5 What is deleted, per the deletion-owed rule

Fleet-side only (the Workflow fallback keeps its copies): loading `waves.js`
from the engine path (and the Function-body transform); the
setup/merge/contended/reconcile-sweep prompt machinery as engine inputs;
`INTEGRATION_WT`; the model-relayed kernel CLI dispatches; the review-packet
flow (`review-package` remains for the fallback); the critic's three extra git
verbs; the writeSide role family shrinks to the **reconcile agent alone** (the
resolver becomes a read-only role, §2). Ledger entries go into the release
commit body. Horizon disclosure (Trim review's netConceptDelta condition): until
cutover removes the Workflow path, the repository carries two engines — the
claimed −3 is the post-cutover number; the interim state is +8 and is the price
of an untouched fallback.

## §6 Tests

Sims live in **`fleet/tests/test_*.mjs`** — picked up by
`tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, 120 s per file; every
sim fits or splits). *(Trim review gap 2: adopted — the `run_acceptance.sh:108`
selector instruction is withdrawn; that leg guards `harnesses/*.js`, which this
change does not touch.)*

- **happy width-2** (two patches, fold, adopt, driver suite run, critic,
  report) — the run-26 shape;
- **fix-loop** (FIX_REQUIRED → fix dispatch → pass) and **fix-loop-exhausted**;
- **contended fold** with one conflict → resolver schema reply → driver-written
  reply dir → apply → complete;
- **infra-park** (AGENT_NULL → barrier retry) and **fail-run latch**;
- **suite-fail → reconcile** (driver suite red → reconcile dispatch → green;
  and the cap-2 exhaustion → TEST_FAILED + cascade-block);
- **report-contract pin**: run `finalize_report.py` + `ultra_gate.py` (real
  scripts, temp repo) against a sim-produced report — the frozen periphery is
  the oracle, not a copied schema.

The two standing test fixes (confine-hook env leak, fake-claude stdout
truncation) are **not this spec** — they land first as their own small PR.
*(Trim review 2: adopted.)*

## §7 Sequencing

1. Test-fix PR (small, independent), then build this spec on a branch; sims +
   full suite green locally (seconds, no fleet).
2. One PR to main (this spec, the engine, the role files). The probe plan and
   `probe/run-24` stay throwaway.
3. Orchestrator clone to the merged main; launch run-26
   (`drive-one --engine one-driver`, runId 26).
4. Bar unchanged: gate-green, `reported == ledger`, width-2, READY PR. A parked
   run-26 parks on at most one novelty class — judgment — because the
   choreography classes are code paths the sims already executed and the
   permission posture is the one run-25 ran.

## Trim review

Reviewer: fresh-context subagent, 2026-08-29 (inputs: spec, Amendment 10, the
code; no authoring conversation). Grade: **netConceptDelta −3 post-cutover,
+8 interim** — condition (name the horizon) adopted in §5.

| # | Finding | Disposition |
|---|---|---|
| T1 | Defer the bypassPermissions switch | **Adopted** — §1; run-27, own measurement (incl. `--disallowedTools` under bypass) |
| T2 | Split the two test fixes into their own PR | **Adopted** — §6/§7 |
| T3 | One prose ceiling, not five | **Adopted** — §4 (≤ 350 words/file) |
| T4 | Critic's three git verbs are deletable; ledger owes the row | **Adopted** — §2/§5 |
| T5 | Ordinary-merge deletion is a narrowing of Amendment 10; disclose | **Adopted** — §2 |
| G1 | Escalation-pin cite wrong; new engine's ladder unpinned | **Adopted** — §3.4 (pin repointed at run-engine) |
| G2 | Sim placement/sentinel/selector wrong as written | **Adopted** — §6 |
| G3 | Report producers unstated (`tests`, `gitVerified`, ancestry, baseline/bootstrap) | **Adopted** — §3.1 producer table; `gitVerified` redefinition disclosed, report-format.md updated in-change |
| G4 | Reconcile trigger is an addition, under-specified | **Adopted** — §2 (trigger, cap 2, TEST_FAILED + cascade-block; sim in §6) |
| G5 | writeSide-shrink claim vs resolver writes | **Adopted** — resolver returns contents, driver writes the reply dir; resolver role read-only |
| G6 | `startHead` deletion collides with recorded guard-deletion doctrine | **Answered** — kept one more run; deletion waits for its measured license (§3.1) |
| G7 | Amendment 10 mirror not on this branch | **Answered** — rides PR #422; spec merges after and cites it (Authority) |
| G8 | Outer-stage enumeration drops the fetch bridge; label typo; driver legs' receipts | **Adopted** — §1, §3.2 |
| G9 | Bypass probe evidence is throwaway | **Answered** — the result is recorded in Amendment 10's mirror text; with T1 adopted, bypass ships only with its own fuller measurement |
