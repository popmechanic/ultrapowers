# Two deletions: the depth-1 leg is gone and the baseline runs only on a red wave

**Grammar:** claims-v1

**Claim:** A green run executes the committed suite twice, not four times: the depth-1 leg is gone (CI's depth-1 checkout keeps that guard) and the baseline runs only when a wave's suite is red, to say whether the red is the base's or the diff's. (elicited)

**Goal:** #712 — the Claim above is the operator's sentence, confirmed 2026-09-08 after the
tree-hash memo shape was rejected ("this feels complex"). The fixed-cost census of runs 33–45
(`docs/superpowers/observations/2026-09-08-fixed-cost-census.md`) counts four driver-owned
suite passes per clean run, ~5.5 min each on 4 vCPU: the **baseline** (`fleet/run-engine.mjs:898`,
in the Setup phase, on BASE's tree), the **wave candidate** (line 1732, in the integration clone
after `read-tree`; a reconcile re-run at 1782), the **depth-1 leg** (line 2095, in a shallow
clone of the adopted head — the same tree the candidate pass judged), and the **gate's**
acceptance (`ultra_gate.py:136` → `run_acceptance.sh --suite-gate`, both frozen since 0.1.0 and
untouched here). Read against run-45's `events.jsonl` (2026-09-08): `tiers` at 0.0 min,
`provision` at 5.6, `Setup` 5.6 → `baseline green` 11.2, `Wave 1` 11.2 → `Depth-1 Leg` 32.2 →
`depth-1 leg: green` 37.8, `gate` 37.8 → `approve` 43.5 — so the census's "provision 5.4" is a
fifth pass, `ultra_run.py --validate-knobs`'s preflight of `testCmd` at BASE (`run-main.mjs:567`,
exit 3 on red, fail-closed), which this plan leaves where it is. Two deletions, one plan: the
engine no longer clones at depth 1 or runs the suite there — the guard #465 built that leg for
(a history-coupled test green in a full clone and red at depth 1) is kept by CI, whose required
check runs `actions/checkout` at its default depth 1 on every PR before merge
(`.github/workflows/ci.yml:17` to 21); and the Setup phase no longer runs the suite on BASE up
front — the baseline runs exactly once, only when a wave's candidate suite is red, to tell a red
BASE from a red diff, and a run whose every wave is green never runs it. Expected saving on a
green run: the two ~5.6-min passes, ~11 min of a ~43-min engine wall.
**Closes:** #712

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`); the engine sims run the real engine below the agent
seam (real git, real clones, real patch capture and the real fold kernel through the real `sh`
seam) with canned judgments, through `rig()` of `fleet/tests/_engine_helpers.mjs`, whose repo's
suite is `bash check.sh`. The suite is `python3 -m pytest` from the repo root, which bridges every
`fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, no
network).

**Exam command:** node {paths}

**Parallelization rationale:** one wave, width 2 — both tasks `Review: peer`. The two deletions
are two contracts over two regions of `fleet/run-engine.mjs` (the depth-1 leg at lines 2034–2111
with its three consumers at 2169, 2239 and 2298; the baseline at 873–907 with its consumers at
1732–1745, 2143 and 2300), two rows of `skills/ultrapowers/references/report-format.md` (33–34
and 95; 39, 100 and 128) and two exam files, and neither consumes a symbol the other produces —
same-file text folds. Each task's exam counts the suite's executions BY DIRECTORY, so it grades
the same in its own clone (where the sibling's deletion has not happened) and on the folded tree:
Task 1 pins that no execution happens outside the integration clone, Task 2 that the integration
clone sees exactly one per green wave and none in Setup; the Claim's "twice" is their
conjunction on the adopted tree, which the committed suite (Acceptance) runs whole.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/ultra_run.py`
- The verification periphery is frozen (0.1.0) and the two Checks above are its pin; what no
  command decides is the meaning: the gate's own acceptance suite (`run_acceptance.sh
  --suite-gate`) still executes on every run, and `receipt.json`'s `testCmd` is still the plan's
  command, never a wrapper — the `--validate-knobs` preflight in `ultra_run.py` runs as at BASE.
- No sim this plan adds or edits compares the tree to BASE, reads `ULTRA_BASE` as a base to diff
  against, or embeds a 40-hex commit sha; every sha a leg asserts is read from the sim's own
  repository at run time.
- The run record stays data: the existing event kinds (`engine:phase`, `engine:log`,
  `driver:proof-run`, `driver:exam-run`, `driver:check-run`, `driver:integrated-run`,
  `driver:integrated-check`, `driver:integrated-clean`, `driver:exam-handoff`) keep their BASE
  fields, and no new event kind is added — the engine emits no event for a suite execution at
  BASE and emits none after this plan.
- `report.tests` and `report.acceptance` keep their BASE shape and meaning: `tests` is the
  driver's last suite result on the adopted tree, `acceptance.passed` mirrors `tests.passed`.
- Every assertion that stands at BASE in the sims a task's Files names still holds, except the
  ones that task's Context names as re-scoped or deleted with what replaces them; the new legs
  sit in the exam file named for their surface.
- The four operator documents name no mechanism that is not there
  (`tests/test_docs_agree_with_code.py` is the lens; both tasks run it).

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The depth-1 leg is gone; CI's depth-1 checkout keeps the guard

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `fleet/tests/_engine_helpers.mjs`
- Modify: `fleet/tests/test_run_engine_shallow.mjs`
- Modify: `fleet/tests/test_run_engine_depth1_beside_critic.mjs`
- Modify: `fleet/tests/test_exam_edited_patches.mjs`
- Modify: `fleet/tests/test_run_engine_actor_routing.mjs`
- Modify: `fleet/tests/test_run_engine_exam_edits.mjs`
- Modify: `fleet/tests/test_run_engine_exam_evidence.mjs`
- Modify: `fleet/tests/test_run_engine_exam_fix_edit.mjs`
- Modify: `fleet/tests/test_run_engine_exam_together.mjs`
- Modify: `fleet/tests/test_run_engine_examiner.mjs`
- Modify: `fleet/tests/test_run_engine_implementer_suite.mjs`
- Modify: `fleet/tests/test_run_engine_integrated_clean.mjs`
- Modify: `fleet/tests/test_run_engine_integrated_runs.mjs`
- Modify: `fleet/tests/test_run_engine_pre_review.mjs`
- Modify: `fleet/tests/test_run_engine_proof_runs.mjs`
- Modify: `fleet/tests/test_run_engine_review_economy.mjs`
- Test: `fleet/tests/test_run_engine_suite_passes.mjs`

**Claim:** After a run whose adopted tree is green, no depth-1 clone was made and no ack was manufactured for one: the shallow leg is gone from the engine, its record, its documents and its sims, and CI's depth-1 checkout is the guard for a history-coupled test. (derived)
Machine: M1. After a run whose wave merged green, `<runDir>/clones/shallow` does not exist, and
every execution of the suite command happened in `<runDir>/clones/integration` — the suite's
own log of `$PWD` per execution has no line naming any other directory.
M2. The phases the engine announces on a one-wave run whose wave merged are exactly `Setup`,
`Wave 1`, `Integration Review`, in that order — no `Depth-1 Leg`.
M3. `report` has no `shallowSuite` key; on a history-coupled suite (green in a full clone of a
two-commit repository, red at depth 1: `[ "$(git rev-list --count HEAD)" -gt 1 ]`) the wave is
`MERGED`, `report.tests.passed` is true, `report.deferredVerification` is `[]`, and no
`judgmentCalls` entry starts with `depth-1 leg:`.
M4. The completeness critic is dispatched exactly once on a run whose wave merged, and not at
all on a run whose only implementer returned `BLOCKED`, whose report then carries a
`completenessFindings` entry containing `no wave merged`.
M5. `fleet/tests/test_run_engine_shallow.mjs` and
`fleet/tests/test_run_engine_depth1_beside_critic.mjs` are absent, and no tracked file under
`fleet/`, `skills/`, `tests/` (`tests/fixtures/` excluded) or `.github/` contains `shallowSuite`,
`shallowLeg`, `shallowDeferred`, `runShallowLeg`, `Depth-1 Leg` or `depth-1 leg:`.
M6. `.github/workflows/ci.yml`'s checkout comment — the eight lines directly above its
`uses: actions/checkout` line — names `#712`, the file says `gate leg` nowhere, and no line of the file sets a
`fetch-depth:` key (a line of whitespace then `fetch-depth:` — a comment naming it is not a key); `fleet/tests/test_run_engine_integrated_clean.mjs`
prints `ALL TESTS PASSED` with its `shallowLeg` knob removed; and
`tests/test_docs_agree_with_code.py` passes.

**Authorized-by:** #712 (enhancement, fleet); the operator's decision of 2026-09-08 (two
deletions, the memo rejected); #465 (closed — the leg's origin: run-32 gated green and CI went
red on `git log` collapsing at a shallow boundary; CI's `actions/checkout` at default depth 1 is
the guard that survives, `.github/workflows/ci.yml:17` to 21).

**Interfaces:**
- Consumes: none
- Produces: nothing a sibling consumes — the rig's new phase array and the deletions are read by the exam and by the operator, never by a task

**Context:** The leg at BASE `1631e87`, by line in `fleet/run-engine.mjs`: the comment block and
`runShallowLeg` at 2034–2111 (`shallowSuite`, `shallowDeferred`, `shallowCalls`, the
`phase('Depth-1 Leg')` at 2070, the `file://` `--depth 1` clone into `<runDir>/clones/shallow` at
2075–2083, the bootstrap and `await sh(testCmd, shallowDir)` at 2089–2095, the `deferred:manual`
item at 2106 — run-40's class, a `manual` ack the gate does not pre-authorize, manufactured on a
red leg); its three consumers: `await Promise.all([runShallowLeg(), runCritic()])` and
`judgmentCalls.push(...shallowCalls, ...criticCalls)` at 2169–2170, the
`.concat(shallowDeferred ? [shallowDeferred] : [])` at 2239, and `shallowSuite,` in the report at
2298. After this task the critic runs alone where the pair ran (`await runCritic()` and
`judgmentCalls.push(...criticCalls)`), `deferredVerification` is the critic's list plus
`planDeferred`, and the report has no `shallowSuite` key at all — not `null`, absent — because a
sim at BASE pinned `null` as "did not run" and an absent key is what an engine without the leg
returns. **Run-46 (#713 + #753, landing before this launch) edits `fleet/run-engine.mjs` between
lines 1252 and 1376 and `fleet/run-main.mjs`'s `ackDecision`; every site above is below that
region, so all of them shift by run-46's net line delta — locate them by the strings
`runShallowLeg`, `shallowDeferred` and `shallowSuite`, not by number.** The sibling task of this
wave edits the same file at 508, 873–907, 1732–1745, 2143 and 2300 (the baseline) — none of those
lines is this task's, and `baseline,` at 2300 stays. The record: `report-format.md` carries the
leg in its schema at lines 33–34 (`"shallowSuite": { "oneOf": …`) and in the field table at
line 95 (the `shallowSuite` row); both go, and no other line of that file names the leg (the
sibling edits lines 39, 100 and 128 of the same file, the `baseline` rows). `fleet/CONTRACT.md`,
`fleet/RUNBOOK.md`, `README.md`, `skills/ultrapowers/SKILL.md` and `first-run.md` name neither the
leg nor `shallowSuite` at BASE (checked by `git grep`), so the doc pin
`tests/test_docs_agree_with_code.py` has nothing to lose and is run as the lens. CI: the comment
at `.github/workflows/ci.yml:17` to 21 says fetch-depth stays default because "it is the real
consumer shape #465's depth-1 gate leg exists to predict" — rewrite it to say the depth-1 checkout
IS the guard for a history-coupled test since #712 deleted the engine's leg, keep `#465`, keep the
step at actions/checkout v7 with no `fetch-depth`, and change nothing else in the workflow (a
workflow edit merged while another run is live strands that run's publish — the operator merges
this PR when no other run is live). The sims: `fleet/tests/test_run_engine_shallow.mjs` (four
scenarios, all the leg's) and `fleet/tests/test_run_engine_depth1_beside_critic.mjs` (the
leg-beside-critic overlap, #654) are deleted — `git rm`, the file gone from the tree — and the one
assertion in them that is not the leg's, scenario c2 of the second (no critic dispatch and the
`no wave merged` finding when nothing merged), is re-homed as this task's leg (d);
`fleet/tests/test_run_engine_critic_inputs.mjs` scenario 4 pins the same finding and is
untouched. Thirteen sims pass `shallowLeg: false` in `extraArgs` or `args` to skip the leg
(`test_exam_edited_patches.mjs:60`, `test_run_engine_actor_routing.mjs:82`,
`test_run_engine_exam_edits.mjs:56`, `test_run_engine_exam_evidence.mjs:164`,
`test_run_engine_exam_fix_edit.mjs:58`, `test_run_engine_exam_together.mjs:172`,
`test_run_engine_examiner.mjs:59`, `test_run_engine_implementer_suite.mjs:174`,
`test_run_engine_integrated_clean.mjs:115`, `test_run_engine_integrated_runs.mjs:148, 217, 354,
430, 502, 542`, `test_run_engine_pre_review.mjs` ×15, `test_run_engine_proof_runs.mjs:107, 297,
486, 550`, `test_run_engine_review_economy.mjs:100, 142, 190, 233, 309`); the knob is deleted from
each — an engine that reads no `args.shallowLeg` must not be handed one — and every other
assertion in them stands. Two history comments (`test_run_engine_exam_fix_edit.mjs:279–282`,
`test_run_engine_proof_runs.mjs:244–248`, "run-54's depth-1 leg caught exactly this") record why a
BASE-pin guards `cat-file -e`; they may stay as history or be put in the past tense, and the
sweep in M5 does not match them (it matches the identifiers and the `depth-1 leg:` prefix, not
the phrase). The rig: `fleet/tests/_engine_helpers.mjs:54` (and the line after) says `extraArgs` exists for "the
depth-1 leg's shallowLeg knob" — reword; and `rig()` gains a `phases` array beside `logs`,
filled by a `phase: (p) => phases.push(String(p))` passed to `runEngine` (the rig leaves `phase`
a no-op at BASE, which is why the deleted sim observed the overlap from the suite command
instead), returned as `phases`. The new exam counts executions from the suite command itself:
its `check.sh`, written into the repo at `makeRepo` time, appends `$PWD` and `$(git write-tree)`
to an absolute log path under the sim's temp dir on every execution, then exits by the `BROKEN`
rule — the implementer stubs never run the suite and no task carries `proofTests`, so the log's
lines are exactly the driver's executions, each naming the directory it ran in and the tree its
index held. The engine emits no event for a suite execution — the only traces at BASE are
`engine:log` lines (`setup: … baseline green`, `wave N candidate suite RED — reconcile attempt`,
`depth-1 leg: green`) and the command's own side effects — so the count is the command's log,
never an event count. In this task's own clone the sibling's baseline still runs in
`clones/integration`, so M1 is written as "no execution outside the integration clone", which
holds there and on the folded tree alike; the "exactly one" is the sibling's clause. `report`
after this task still carries `baseline` (the sibling decides its value) and `tests`,
`acceptance`, `deferredVerification`, `judgmentCalls` with their BASE meanings.
**BASE facts:** (generated at 1631e87)
- `report` at `fleet/run-main.mjs:643` blob 97baef8
- `shallowSuite` at `fleet/run-engine.mjs:2064` blob 8694de1
- `judgmentCalls` at `fleet/run-engine.mjs:823` blob 8694de1
- `fleet/tests/test_run_engine_shallow.mjs` blob bc1cd56
- `fleet/tests/test_run_engine_depth1_beside_critic.mjs` blob 2f31a59
- `shallowDeferred` at `fleet/run-engine.mjs:2065` blob 8694de1
- `runShallowLeg` at `fleet/run-engine.mjs:2067` blob 8694de1
- `.github/workflows/ci.yml` blob 85ce5eb
- `fleet/tests/test_run_engine_integrated_clean.mjs` blob 4f9edb7
- `tests/test_docs_agree_with_code.py` blob 3db67e0
- `.github/workflows/ci.yml:17` blob 85ce5eb line 17 `steps:`
- `fleet/run-engine.mjs` blob 8694de1
- `shallowCalls` at `fleet/run-engine.mjs:2066` blob 8694de1
- `manual` at `fleet/tests/test_run_engine_shallow.mjs:64` blob bc1cd56
- `deferredVerification` at `fleet/run-engine.mjs:2237` blob 8694de1
- `planDeferred` at `fleet/run-engine.mjs:2231` blob 8694de1
- `fleet/run-main.mjs` blob 97baef8
- `ackDecision` at `fleet/run-main.mjs:262` blob 97baef8
- `baseline` at `fleet/run-engine.mjs:899` blob 8694de1
- `fleet/CONTRACT.md` blob 486545c
- `fleet/RUNBOOK.md` blob 0c6f461
- `README.md` blob 245f9e9
- `skills/ultrapowers/SKILL.md` blob 802f596
- `fleet/tests/test_run_engine_critic_inputs.mjs` blob 211f419
- `extraArgs` at `fleet/tests/test_run_engine_fold_subject.mjs:50` blob 8a38a1b
- `args` at `fleet/publish-fold.mjs:547` blob 024f6f5
- `fleet/tests/_engine_helpers.mjs:54` blob f929b25 line 54 `// Extra runEngine args merged last (the depth-1 leg's`
- `phases` at `fleet/tests/test_sandbox_boot.mjs:917` blob 120c765
- `logs` at `fleet/tests/_engine_helpers.mjs:66` blob f929b25
- `runEngine` at `fleet/run-engine.mjs:682` blob 8694de1
- `phase` at `fleet/tests/test_sandbox_boot_selfmerge.mjs:513` blob 00ac21b
- `makeRepo` at `fleet/tests/_engine_helpers.mjs:21` blob f929b25
- `proofTests` at `fleet/run-engine.mjs:1010` blob 8694de1
- `tests` at `fleet/run-engine.mjs:2243` blob 8694de1
- `acceptance` at `fleet/run-engine.mjs:2247` blob 8694de1
- `reason` at `fleet/run-engine.mjs:633` blob 8694de1
- `integration` at `fleet/run-waves.mjs:103` blob 27f25b5
- `detail` at `fleet/doctor.mjs:621` blob f9a1174
- `fleet/tests/_engine_helpers.mjs` blob f929b25

**Proof:**
- Test: `fleet/tests/test_run_engine_suite_passes.mjs`
- Run: `bash -c '! git grep -q -e shallowSuite -e shallowLeg -e shallowDeferred -e runShallowLeg -e "Depth-1 Leg" -e "depth-1 leg:" -- fleet skills tests .github ":!tests/fixtures"'`
- Run: `bash -c 'test ! -e fleet/tests/test_run_engine_shallow.mjs && test ! -e fleet/tests/test_run_engine_depth1_beside_critic.mjs'`
- Run: `bash -c 'grep -B8 "uses: actions/checkout" .github/workflows/ci.yml | grep -q "#712" && ! grep -q "gate leg" .github/workflows/ci.yml && ! grep -qE "^[[:space:]]+fetch-depth:" .github/workflows/ci.yml'`
- Run: `bash -c 'node fleet/tests/test_run_engine_integrated_clean.mjs | grep -q "ALL TESTS PASSED"'`
- Run: `python3 -m pytest -q tests/test_docs_agree_with_code.py`
- Legs, under a comment naming this task (`#712 Task 1`), each over its own `rig()` run with a
  `check.sh` that appends `$PWD` and `$(git write-tree)` to the sim's log on every execution:
  (a) a one-wave run whose implementer writes `T1.txt` in a two-commit repository: the wave is
  `MERGED`, `report.tests.passed` is true, `<runDir>/clones/shallow` does not exist
  (`fs.existsSync` false), the log has at least one line, and every line's directory is
  `<runDir>/clones/integration` — an engine that still clones fails the path assertion, one that
  runs the suite anywhere else fails the directory sweep [M1]; (b) the previous leg's run read
  further: `phases` (the rig's new array) deep-equals `['Setup', 'Wave 1', 'Integration Review']`
  — an engine that still announces the leg fails on the extra element [M2]; (c) the same shape
  with the history-coupled `check.sh` (`[ "$(git rev-list --count HEAD)" -gt 1 ]`, green in the
  rig's full clones): the wave is `MERGED`, `report.tests.passed` is true,
  `Object.hasOwn(report, 'shallowSuite')` is false, `report.deferredVerification` deep-equals `[]`
  (so no item has `reason` `manual` and none has a `deliverable` starting `depth-1 clone of`), and
  no `report.judgmentCalls` entry starts with `depth-1 leg:` — an engine that still runs the leg
  fails on the `manual` item, one that keeps the key as `null` fails `hasOwn` [M3]; (d) two runs:
  the merged run of the first leg, whose stub counted the `integration` label dispatched exactly
  once; and a run whose only implementer returns `{ status: 'BLOCKED', … }`, whose stub counted
  `integration` zero times, whose `report.waveMerges` has no `MERGED` entry, and whose
  `report.completenessFindings` has an entry whose `detail` includes `no wave merged` [M4];
  (e) the first `Run:` exits 0 (the sweep finds none of the six strings in a tracked file of the
  four directories, fixtures excluded) and the second exits 0 (both sim files are absent) — a
  deletion that leaves either file, the knob in any of the thirteen sims, or the row in
  `report-format.md`, fails one of the two [M5]; (f) the third `Run:` exits 0 (`#712` is within the eight lines
  above the `uses: actions/checkout` line — a `#712` written anywhere else in the file does not
  satisfy it — `gate leg` appears nowhere in the file, and no line is whitespace then `fetch-depth:` — a
  `with: fetch-depth: 0` added to the step fails it, the comment's own mention of the key does
  not), the fourth
  prints the sibling sim's sentinel with the knob gone, and the fifth passes the docs pin [M6].

**Stale-if:**
- path-absent: `fleet/run-engine.mjs`
- path-absent: `fleet/tests/test_run_engine_shallow.mjs`
- path-absent: `fleet/tests/test_run_engine_depth1_beside_critic.mjs`
- path-absent: `fleet/tests/_engine_helpers.mjs`
- issue-closed: #712

### Task 2: The baseline runs once, only when a wave's suite is red

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `fleet/tests/test_run_engine.mjs`
- Test: `fleet/tests/test_run_engine_baseline.mjs`

**Claim:** A run whose every wave's suite is green never runs the suite on BASE; when a wave's suite is red the driver runs the suite on BASE once, before repairing, and the record says whether BASE itself was red or green. (derived)
Machine: M1. On a run whose every wave's candidate suite exits 0, the suite command executes in
`<runDir>/clones/integration` exactly once per merged wave and never during `Setup`: the suite's
own log of `$PWD` and index tree per execution has, for that directory, exactly one line per
`MERGED` wave, each carrying that wave's adopted tree (`git rev-parse <waveMerges[i].headSha>^{tree}`)
and none carrying BASE's tree (`git rev-parse <base>^{tree}`); no `engine:log` line contains
`baseline`; and `report.baseline` is `null`.
M2. When a wave's candidate suite exits non-zero, the driver executes the suite command exactly
once on BASE's tree — one logged line whose tree is `git rev-parse <base>^{tree}` — before that
wave's first `reconcile:` dispatch, records `report.baseline` as `{ passed, output }` and one
`engine:log` line `baseline: green on <baseSha>` or `baseline: RED on <baseSha>`; the
`reconcile:` agent is then dispatched with the candidate tree in the integration clone (the
implementer's file and the red marker both present in its cwd), and the wave ends as at BASE —
`FIXED` → `MERGED` at the reconciled head with `report.tests.passed` true; `BLOCKED` →
`TEST_FAILED` with the integration branch back at its previous head.
M3. A red baseline: `report.baseline.passed` is false, exactly one `judgmentCalls` entry starts
with `baseline: the suite is RED on BASE`, and when a wave later merges the critic's brief
carries a line starting `Baseline: the suite is RED on BASE`; a green baseline draws no
`judgmentCalls` entry starting `baseline:` and the critic's brief carries no line starting
`Baseline:`.
M4. The baseline executes at most once per run: across two waves whose candidates are both red,
the log carries exactly one line with BASE's tree.
M5. `skills/ultrapowers/references/report-format.md`'s `baseline` schema line is
`"baseline": { "oneOf": [{"type":"null"}, …` , and its `baseline` field row and its
Presentation item 3 each carry both the phrase `only when a wave` (the suite runs on BASE only
when a wave's candidate suite is red) and the word `null` (the field's value otherwise); `fleet/run-engine.mjs` no longer carries `already failing before any task ran` (BASE's
judgment-call literal) and carries `the suite is RED on BASE`;
`fleet/tests/test_run_engine.mjs` prints `ALL TESTS PASSED` with its baseline pin re-scoped to
`null`; and `tests/test_docs_agree_with_code.py` passes.

**Authorized-by:** #712 (enhancement, fleet); the operator's decision of 2026-09-08 (two
deletions: the baseline goes lazy — "green runs pay nothing; red runs pay today's cost").

**Interfaces:**
- Consumes: none
- Produces: nothing a sibling consumes — the report field's new value and the two log literals are read by the exam and by the operator, never by a task

**Context:** The baseline at BASE `1631e87`, by line in `fleet/run-engine.mjs`: `phase('Setup')`
at 875 (kept — the phase is the branch creation and the bootstraps, and the `Setup` phase event
stays); `const baselineRun = await sh(testCmd, integ)` at 898 and the `baseline` object at 899,
the red path's judgment call `baseline: test suite was already failing before any task ran (…)
— task results inherit a red suite` at 901–902 with its log at 903, and the Setup log line
`setup: branch <b> at <sha>; baseline green|RED` at 905–906; its consumers: the critic's brief at
2143–2145 (`baseline.passed === false ? '\nBaseline: the test suite failed before any task ran —
…' : ''`) and `baseline,` in the report at 2300; a comment at 508 ("baseline, then each wave's
candidate") and one at 886. The wave site: `let suite = await sh(testCmd, integ)` at 1732, run
after `git read-tree -u --reset <candidate>^{tree}` at 1731 with the branch unmoved (HEAD is
`prevHead` — BASE on wave 1, the previous adopted head on a later wave); red enters the reconcile
loop at 1740 (`reconcile:wave<N>:<attempt>`, cap 2, `git add -A` + commit, re-run at 1782). **Run-46
(#713 + #753, landing before this launch) edits `fleet/run-engine.mjs` between lines 1252 and
1376 and `fleet/run-main.mjs`'s `ackDecision`; lines 508 and 873–907 stay where they are and
1732–1782, 2143 and 2300 shift by run-46's net line delta — locate them by `sh(testCmd, integ)`,
`baseline.passed === false` and `    baseline,`, not by number.** The sibling task of this wave
deletes the depth-1 leg at 2034–2111, 2169–2170, 2239 and 2298 of the same file — none of those
lines is this task's; `baseline,` at 2300 stays as it is. The shape after this task: `let
baseline = null` in Setup, the Setup log line `setup: branch <b> at <sha>` with no baseline
segment, and one driver function that runs the suite on BASE's tree at most once per run — called
at the wave site when `suite.code !== 0`, before the reconcile loop's first dispatch, and a no-op
when `baseline` is already set. Where it runs is the implementer's, under two constraints the exam
reads: the execution's index tree is BASE's (`git rev-parse <baseSha>^{tree}`) — in the
integration clone by `git read-tree -u --reset <baseSha>^{tree}`, suite, then `git read-tree -u
--reset <candidate>^{tree}` again (the shape this plan expects; a fresh clone at `baseSha`
bootstrapped with `bootstrapCmd` is the alternative, at the cost of that bootstrap) — and when the
reconcile agent is dispatched the integration clone's worktree and index again hold the candidate
tree, since the agent edits files there and the driver's `git add -A` commits what it finds. The
literals: the log line is `baseline: green on <baseSha>` / `baseline: RED on <baseSha>` (the
40-hex `baseSha` of line 882); the red path's judgment call starts `baseline: the suite is RED on
BASE` and carries a tail of the output; the critic's brief line starts `Baseline: the suite is
RED on BASE` and is present only when `baseline` is an object with `passed` false (`baseline &&
baseline.passed === false` — the BASE expression throws on `null`). `report.baseline` is `null`
when the suite never ran on BASE and `{ passed, output }` (BASE's shape, `output` the 2000-char
tail) when it did. A red baseline changes nothing else about the wave: the reconcile loop, the
`FIXED`/`BLOCKED` outcomes, `TEST_FAILED`'s `reset --hard prevHead` and the cascade are BASE's,
exactly as BASE's Setup-time red baseline changed nothing about them — "the existing red-baseline
path" is the judgment call, the critic's note and `report.baseline.passed` false, and this task
keeps all three. Why BASE's tree and not the previous wave's head on a later wave: the previous
head was judged green when it was adopted, so a later wave's red is the diff's unless BASE itself
moved under the run, which it cannot; the operator's sentence names BASE, and the exam's leg (d)
pins BASE's tree for a wave-2 red. Note for the record, not a clause: `ultra_run.py
--validate-knobs` (`fleet/run-main.mjs:567`) already ran `testCmd` on BASE in a probe worktree
before the engine started and failed the run closed on red (exit 3), so on the fleet a red
baseline here means BASE went red between the preflight and the wave — a flake or an environment
difference — which is exactly what the red-vs-diff reading is for; the rig runs no preflight, so
the sim reaches the red-BASE rows by committing `BROKEN` at BASE. The exam counts executions from
the suite command itself: its `check.sh`, written into the repo at `makeRepo` time, appends `$PWD`
and `$(git write-tree)` to an absolute log path under the sim's temp dir on every execution, then
exits by the `BROKEN` rule (`[ ! -f BROKEN ]`); `git write-tree` names the index's tree, which is
the candidate's after `read-tree`, BASE's during the baseline whichever way it is run, and the
reconciled commit's after the driver's commit — so a line's tree tells the exam WHICH tree ran
without the exam knowing how. In this task's own clone the sibling's depth-1 leg still runs the
command in `<runDir>/clones/shallow`, so every count in M1–M4 is over the lines whose directory is
`<runDir>/clones/integration`, which holds there and on the folded tree alike; the "no execution
elsewhere" is the sibling's clause. The engine emits no event for a suite execution (the traces
at BASE are `engine:log` lines and the command's own side effects), so the count is the command's
log, never an event count. Pins re-scoped, owned here: `fleet/tests/test_run_engine.mjs:75`
`assert.equal(report.baseline.passed, true)` on a green two-wave run becomes
`assert.strictEqual(report.baseline, null)` (strict, so an engine that drops the key fails);
`fleet/tests/test_run_engine_cap_width.mjs:183` (`shells.length >= 2`, "baseline + candidate")
still holds because that scenario's candidate is red — the baseline runs beside the candidate —
and is not touched; `tests/test_fleet_events.py:22`'s `setup: baseline green` is a harvester
fixture of a run-30 log, historical data, and is not touched. The documents: `report-format.md`
line 39's schema becomes `"baseline": { "oneOf": [{"type":"null"}, {"type":"object", "properties":
{ "passed": {"type":"boolean"}, "output": {"type":"string"} }}] }` (the shape line 33 uses),
line 100's row says the suite ran on BASE only because a wave's candidate suite was red — `null`
when no wave was red, `passed: false` means BASE itself was red — and line 128's Presentation
item 3 says the same in one sentence (the sibling task edits lines 33–34 and 95 of this file, the
`shallowSuite` rows). `tests/test_docs_agree_with_code.py` pins none of those sentences.
**BASE facts:** (generated at 1631e87)
- `baseline` at `fleet/run-engine.mjs:899` blob 8694de1
- `judgmentCalls` at `fleet/run-engine.mjs:823` blob 8694de1
- `skills/ultrapowers/references/report-format.md` blob 654d902
- `fleet/run-engine.mjs` blob 8694de1
- `fleet/tests/test_run_engine.mjs` blob 25a93da
- `tests/test_docs_agree_with_code.py` blob 3db67e0
- `fleet/run-main.mjs` blob 97baef8
- `ackDecision` at `fleet/run-main.mjs:262` blob 97baef8
- `bootstrapCmd` at `fleet/run-engine.mjs:768` blob 8694de1
- `baseSha` at `fleet/run-engine.mjs:883` blob 8694de1
- `output` at `fleet/lobby.mjs:247` blob 62d348b
- `makeRepo` at `fleet/tests/_engine_helpers.mjs:21` blob f929b25
- `fleet/tests/test_run_engine.mjs:75` blob 25a93da line 75 `assert.equal(report.baseline.passed, true)`
- `fleet/tests/test_run_engine_cap_width.mjs:183` blob 9a1e799 line 183 `assert.ok(shells.length >= 2, 'the driver ran the suite at l`
- `tests/test_fleet_events.py:22` blob 39be477 line 22 `_ev(5, 2500, kind="engine:log", line="setup: baseline green"`
- `shallowSuite` at `fleet/run-engine.mjs:2064` blob 8694de1
- `T1` at `fleet/tests/test_publish_fold.mjs:206` blob bb75648
- `T2` at `fleet/tests/test_run_engine_exam_evidence.mjs:246` blob 7ab5c73
- `integration` at `fleet/run-waves.mjs:103` blob 27f25b5
- `base` at `fleet/doctor.mjs:305` blob f9a1174
- `fleet/tests/_engine_helpers.mjs` blob f929b25

**Proof:**
- Test: `fleet/tests/test_run_engine_baseline.mjs`
- Run: `grep -q '"baseline": { "oneOf"' skills/ultrapowers/references/report-format.md`
- Run: `bash -c 'grep -E "^\| .baseline. \|" skills/ultrapowers/references/report-format.md | grep null | grep -q "only when a wave"'`
- Run: `bash -c 'grep -E "^3\. " skills/ultrapowers/references/report-format.md | grep null | grep -q "only when a wave"'`
- Run: `bash -c '! grep -q "already failing before any task ran" fleet/run-engine.mjs && grep -q "the suite is RED on BASE" fleet/run-engine.mjs'`
- Run: `bash -c 'node fleet/tests/test_run_engine.mjs | grep -q "ALL TESTS PASSED"'`
- Run: `python3 -m pytest -q tests/test_docs_agree_with_code.py`
- Legs, under a comment naming this task (`#712 Task 2`), each over its own `rig()` run with a
  `check.sh` that appends `$PWD` and `$(git write-tree)` to the sim's log on every execution and
  exits by the `BROKEN` rule; every count below is over the log's lines whose directory is
  `<runDir>/clones/integration` — call them the integration lines: (a) two waves, `T1` then `T2`
  with the edge `T1 -> T2`, each implementer writing its own file: both waves are `MERGED`, the
  integration lines are exactly two, in order the trees `git rev-parse <waveMerges[0].headSha>^{tree}`
  and `git rev-parse <waveMerges[1].headSha>^{tree}`, neither equal to `git rev-parse <base>^{tree}`;
  no rig log line contains `baseline`; and `assert.strictEqual(report.baseline, null)` — an
  engine that still runs the suite in Setup fails the line count and the BASE-tree inequality,
  one that drops the key fails the strict null [M1]; (b) one wave whose implementer writes
  `T1.txt` and `BROKEN`, the `reconcile:` stub recording the integration line count at its
  dispatch and asserting `BROKEN` and `T1.txt` both exist in its cwd, then removing `BROKEN` and
  answering `FIXED`: the integration lines are exactly three — the candidate's tree, then
  `git rev-parse <base>^{tree}`, then the reconciled head's tree
  (`git rev-parse <waveMerges[0].headSha>^{tree}`) — the count at dispatch was two, the wave is
  `MERGED`, `report.tests.passed` is true, `report.baseline` deep-equals `{ passed: true,
  output: <string> }` in `passed`, a rig log line is exactly `baseline: green on <base>`, no
  `judgmentCalls` entry starts with `baseline:`, and the `integration` stub's prompt contains no
  line starting `Baseline:` — an engine that runs the baseline after the reconcile fails the
  dispatch count, one that leaves BASE's tree in place for the agent fails the `BROKEN`-exists
  assertion [M2, M3]; (c) a repository with `BROKEN` committed at BASE, one wave whose implementer
  writes `T1.txt`, the `reconcile:` stub removing `BROKEN` and answering `FIXED`: the integration
  lines are exactly three with the second equal to `git rev-parse <base>^{tree}`, the wave is
  `MERGED`, `report.baseline.passed` is false, a rig log line is exactly `baseline: RED on <base>`,
  exactly one `judgmentCalls` entry starts with `baseline: the suite is RED on BASE`, and the
  `integration` stub's prompt contains a line starting `Baseline: the suite is RED on BASE`
  [M2, M3]; (d) the same red-at-BASE repository with the `reconcile:` stub answering `BLOCKED`:
  the integration lines are exactly two (candidate, then BASE's tree), the wave is `TEST_FAILED`,
  `git rev-parse <integrationBranch>` in the integration clone equals `base`, and
  `report.baseline.passed` is false [M2]; (e) two waves with no edge, `T1`'s implementer writing
  `T1.txt` and `BROKEN` with the `reconcile:` stub removing `BROKEN` and answering `FIXED` on
  wave 1, `T2`'s implementer writing `T2.txt` and `BROKEN` with the stub answering `BLOCKED` on
  wave 2: wave 1 is `MERGED`, wave 2 is `TEST_FAILED`, and exactly one integration line carries
  `git rev-parse <base>^{tree}` — its position the second, after wave 1's candidate — out of
  exactly four (wave-1 candidate, BASE, wave-1 reconciled, wave-2 candidate) — an engine that runs
  the baseline again on wave 2 fails the count, one that runs it on wave 1's head instead of BASE
  fails the equality [M4]; (f) the first `Run:` exits 0 (the schema line admits `null`), the
  second and third exit 0 (the `baseline` field row, and the line starting `3. `, each carry
  both `null` and `only when a wave` — a row or item that says `null` without the trigger, or the
  trigger without `null`, fails its grep), the fourth
  exits 0 (BASE's judgment-call literal is gone from the engine and the new one is present), the fifth prints the sibling sim's sentinel
  with its pin re-scoped, and the sixth passes the docs pin — a schema line that keeps BASE's
  bare object shape fails the first, a field row or Presentation item that keeps BASE's "before
  wave 1" sentence, or names only one of `null` and `only when a wave`, fails the second or third, an engine that keeps BASE's judgment-call
  literal, or lacks the new one, fails the fourth, and a `test_run_engine.mjs` still pinning
  `report.baseline.passed` fails the fifth [M5].

**Stale-if:**
- path-absent: `fleet/run-engine.mjs`
- path-absent: `fleet/tests/test_run_engine.mjs`
- path-absent: `fleet/tests/_engine_helpers.mjs`
- issue-closed: #712
