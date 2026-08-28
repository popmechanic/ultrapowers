# ultralearn distill — 2026-08-28 (DRAFT, operator-gated; nothing filed)

Corpus: the first #292 fleet-bundle sense pass — runs 14–17 @0.2.23 (52 findings,
ledger 1835). Parked list read first: 14 open `watch-item` issues (#227–#237, #257,
#264, #287, #300, #301) + the #237 bundle (a)–(p).

## Canary — redirect-round rate

| engineVersion | n runs | Σ rounds | Σ tasks | rate | cause split |
| --- | --- | --- | --- | --- | --- |
| 0.2.23 | 4 | 2 | 15 | 0.13 | plan 2 · infra 0 · finding 0 · elective 0 |

First version with the structured field (#224 sensor v5). Both rounds plan-caused;
machinery-caused rounds — the 2026-07-27 reading was 4/4 machinery — are now zero.
No rigor-for-efficiency trade adopted since 0.2.18 shows a rising canary.

## Adopted-proposal retrospective (cluster-died check)

| adopted | shipped | target cluster @≥ adopting version | verdict |
| --- | --- | --- | --- |
| #225 post-PASS redirect policy | 0.2.18 | elective post-PASS rounds | **died** — 0 elective rounds in 4 runs |
| #223 FILES = footprint | 0.2.18 | out-of-FILES edits blocking | **died** — out-of-FILES edits ride as advisory (run-16 task 3 disclosure; #331 run task 3) |
| #285 SIBLING-FILES routing | 0.2.23 | fix rounds mis-routed | **died** — run-15's one fix round routed task-local, second review PASS |
| #286 cheap rung deleted | 0.2.23 | cheap-tier fix cycles | **died** — no tier-attributable failure in 15 tasks |
| #322 headless-fitness preflight | run-15 | deferred:manual parks | **died (n=2)** — admitted runs 16/17; run-14's park predates it |
| #318 parkedPublish | run-15 | park-recovery cost | **unexercised** (no parks since) — but its triage contract has a known defect, #336 |
| #283 hygiene check | 0.2.22 | close-of-run branch/lock drift | **guard tax** — red on every fleet-base run (hardcoded `main`), 3/3; also blind to squash-merged branches (this sitting's #237(e) recurrence) → P6 |
| #319 credits note | run-15 | credits-noise errors line | **possibly-failed fix (first persistence)** — the noise became a note but the canary it guards is null by design in 5/5 readings → P4 is the correction |
| #260/#262/#263 | 0.2.20 | manifest grammar / merge-before-push / sweep pauses | no evidence either way in a fleet corpus (no finishing, no sweep) |

## Watch-item matches (second occurrences)

- **#233 — FIRED.** run-14: task 1's declared Produces shape change had its only strict-equality pin in a sibling-owned file; cost the run's one redirect round. Build licensed → **P1**. Caveat: the specimen is an *additive* shape change; #233's deleted/renamed-symbol grep would have missed it.
- **#237 (b) + (c) + #321 item 2 — a family at ≥3 runs** (width-w1 ×2, skylights, run-14 ×2): plan bodies naming referents that do not exist (report.json fields, another task's file with no edge, gitignored evidence dirs, a per-run field labeled with a monthly baseline). One representation fix collapses all three → **P2**.
- **#237 (e) — recurred this sitting** (home run `suite-subtraction-0828`: `--approve` swept 12 engine branches but the local `ultra/integration-*` survived; auto-merge's `--delete-branch` left the remote too). Root cause is structural: squash merges make "merged" undetectable by ancestry, so every merged-branch detector (hygiene `--fix`, sweep, `gh --delete-branch`) misses them → folded into **P6**.
- **#237 (o) — 4 more clean negatives** (9 total). Still unearned; keep parked.
- **#287 — clock confounded, not fired**: runs 14/15/17 all placed Commutes after Files (six declarations discarded, #332); run-16 declared none. Zero real traversals in the 0.2.2x tail. Restart the clock from the first header-placed Commutes run.
- **#232 (deletion, weak) — one datum FOR it**: run-15's adversarial task 3 second reviewer wrote out a one-clause defect and returned clean; the doubled pass converted nothing. Keep parked; note the datum.
- No match: #227 #228 #229 #234 #235 #236 #257 #264 #300 #301.

## Proposals (ranked; structural-first)

```json
[
  {
    "title": "P1 — A pin of a shape you changed is in your blast radius, whoever owns the file: implementer rule + Produces blast-radius check at --check (#233 build)",
    "surface": "skills/ultrapowers/references/reviewer-prompts.md (IMPLEMENTER_PROMPT, BAKE → re-bake waves.js; eval-gated) + skills/ultraplan/SKILL.md Move 3; fallback: skills/ultrapowers/scripts/compile_plan.py --check (frozen vocabulary → eval-gated)",
    "complexityEffect": "structural",
    "consolidationAttempted": "Yes, partially: the defect exists because ownership routing (#285) tells an implementer a sibling-owned file is not theirs even when their declared Produces change broke a pin inside it — so the representation fix is to define blast radius by the Produces contract, not by FILES ownership: 'a strict-equality/consumer pin of a shape you changed is yours to fix, in any file, disclosed'. That removes the class for every pin the implementer can find by grep. The residual (pins the implementer never looks for) is what the --check grep catches — the additive fallback, and this cycle's one budgeted guard.",
    "canaryMetric": null,
    "netConceptDelta": "flat",
    "rationale": "#233 second occurrence (run-14, cost 1 redirect round: fold candidate TEST_FAILED → git-merge red → merge-role fixup) plus 20 earlier ledger rows in the Produces-shape/sibling-pin family across 8 runs since 0.0.20. The fired watch's own mechanism (grep deleted/renamed symbols) would have missed run-14's additive change, so the check must key on every Produces symbol token: files outside the task's FILES that mention it are rendered as 'blast radius' in the --check transparency output (advisory, never a refusal). Prose half ships now; both engine halves (prompt sentence, --check render) ride an eval-measured case per the freeze.",
    "runIds": ["run-14"],
    "lenses": ["routing", "friction"]
  },
  {
    "title": "P2 — Referent-existence lint: one --check pass resolves every path, report field and task reference a plan body names (#321 item 2 ∪ #237(b) ∪ #237(c))",
    "surface": "skills/ultrapowers/scripts/compile_plan.py --check (advisory render; eval-gated under the frozen vocabulary) + skills/ultraplan/SKILL.md authoring rule",
    "complexityEffect": "structural",
    "consolidationAttempted": "Yes: three parked first occurrences are one class — a plan asserting the existence of something the compiler can check (a backticked path against the tree at BASE, a `report.json`/`detail.*` field against report-format.md, a `Task N` id against the plan's own headings, a sibling's declared file without a Depends-on edge). One resolver pass replaces three would-be guards; each unresolved referent renders once, advisory.",
    "canaryMetric": null,
    "netConceptDelta": "down",
    "rationale": "Family at ≥3 runs: width-w1 (phantom report fields, twice → #190), skylights (dead-letter cross-task hand-off), run-14 (gitignored evidence dirs named as committed; per-run spend field labeled with a monthly baseline traceable to a fixture stub). Reviewers caught all of run-14's by hand — plan-defect density 6-in-4-tasks with zero implementation defects says the authoring lane, not the engine, is the quality bottleneck. Retires #237(b) and #237(c) on adoption.",
    "runIds": ["run-14"],
    "lenses": ["frontier", "routing"]
  },
  {
    "title": "P3 — Pin which token measure the spend cap governs, and record the other beside it",
    "surface": "docs/superpowers/specs/2026-08-21-width-program.md §W1c/W1d constants + fleet/shim-main.mjs (readSessionTokens) + fleet/drive.mjs detail",
    "complexityEffect": "structural",
    "consolidationAttempted": null,
    "canaryMetric": null,
    "netConceptDelta": "flat",
    "rationale": "run-17: the engine workflow reported 590,339 total tokens while the spend ledger the 500k cap meters recorded 191,668 — a 3.1× divergence on one run. Four runs now sit in the 34–51% band of a cap whose measure is unstated. Decision: spendObservational (readSessionTokens, reported==ledger in 4/4 runs) governs; the workflow total (cache reads included) is recorded as detail.engineTotalTokens so the ratio is visible per run. Must land before W2 sets tolerance/anomaly constants from representative runs (≥5).",
    "runIds": ["run-17", "run-14", "run-15", "run-16"],
    "lenses": ["cost"]
  },
  {
    "title": "P4 — DELETION (ADOPTED 2026-08-28, whole-scale): remove all credit telemetry — the drive-layer capture leg AND the per-sitting 'local billing canary' practice; keep the sandbox stat leg and the shim's `engine auth` log line",
    "surface": "fleet/drive.mjs + fleet/tests/test_drive.mjs + fleet/RUNBOOK.md + skills/ultralearn/{SKILL.md, references/reading-lenses.md}; practice: #189 gate-read template, handoff, memory",
    "complexityEffect": "simplification",
    "consolidationAttempted": null,
    "canaryMetric": null,
    "netConceptDelta": "down",
    "rationale": "Operator decision 2026-08-28 after the sense pass: the OAuth-token route (#213) is the design; no further credit telemetry or monitoring is wanted. Evidence: the drive leg read null in 5/5 runs by design (the orchestrator's tag-scoped key refuses billing reads; #319 only turned that into a note — a guard on a leg that can never succeed); the 'local canary' as practiced watched the fleet-golden row, which sandbox spend can never move (sandboxes are destroyed clones whose spend lands under '(deleted)'), so it never measured what it claimed; and the direct per-run receipt already exists — shim.log's `engine auth` line, `oauth_token` in 4/4 recent runs. Account posture bounds the accepted worst case: auto-purchase disabled, $66.41 prepaid. Kept deliberately: `detail.sandboxStat`/`stat-<runId>.json` (W2 sizing input, not credits) and the auth log line as a receipt — with NO assert added (deleting, not guarding). Shipped directly as a fleet-surface PR (no release), not via a plan.",
    "runIds": ["run-14", "run-15", "run-17"],
    "lenses": ["cost"]
  },
  {
    "title": "P5 — versionStamp: read the INSTALLED plugin version on the sandbox instead of deriving both halves from the pushed baseRef",
    "surface": "fleet/shim-main.mjs (stamp the installed plugin version into the runs row) + fleet/drive.mjs cross-check",
    "complexityEffect": "structural",
    "consolidationAttempted": null,
    "canaryMetric": null,
    "netConceptDelta": "flat",
    "rationale": "run-17 completeness finding: the driver's expectation comes from `git show <baseRef>:plugin.json` and the sandbox stamp from readStamp at the same pushed ref, so the pluginVersion leg adds no signal independent of engineSha and the actual #282 incident shape (a stale plugin baked into the golden image — which is the state RIGHT NOW: golden 0.2.23 vs main 0.2.24) remains undetectable. Either read the installed version (`claude plugin list`) on the sandbox, or delete the leg; this proposal is the read. Closes #282's open image-side half.",
    "runIds": ["run-17", "run-14"],
    "lenses": ["routing"]
  },
  {
    "title": "P6 — hygiene_check: take the base branch from the run receipt, and treat a branch whose PR is merged as merged",
    "surface": "skills/ultrapowers/scripts/hygiene_check.sh (+ ultra_gate --approve sweep for the integration branch)",
    "complexityEffect": "structural",
    "consolidationAttempted": "Yes: two guard false-reads share one cause — the check assumes a topology (base = main, merged = ancestor-of-main) that squash merges and the fleet-base lane both violate. Reading base from receipt.json's base-branch stage and merged-ness from `gh pr list --state merged --head` removes both without a new rule.",
    "canaryMetric": null,
    "netConceptDelta": "flat",
    "rationale": "3/3 fleet runs ended red on the branch/sync checks for the deliberate fleet-base topology (each session spent its closing turn explaining it); this sitting's home run left the local and remote `ultra/integration-*` branch behind after a squash merge — #237(e)'s recurrence — because no detector sees a squash-merged branch as merged. A red that is always red trains operators to ignore it.",
    "runIds": ["run-15", "run-16", "run-17"],
    "lenses": ["friction", "operator"]
  }
]
```

## Parked (first occurrences → new watch-items, operator-gated) and chores

- **watch-item (new): reviewer blocking line on in-scope plan-defect fixes.** run-15: two reviewers in one run drew it differently on the same class with the same task-local scope (task 4 FIX_REQUIRED → fixed; task 3 one-clause defect written out, verdict clean, shipped as filed). Prompt surface (eval-gated) — trigger: a second run where an in-scope one-clause plan-defect fix ships unfixed.
- **watch-item (new): `filed:needs-followup-issue` is a manifest disposition that files nothing.** run-15's two rows produced no issue until the 2026-08-28 sense pass filed #336/#337 by hand. The grammar already says `filed:<ref>`; `residual_manifest.py --check` accepting a bare label is the gap. Trigger: a second orphaned `filed:` row.
- **Route to #239 (no machinery):** plan verbatim-literal drift vs BASE — run-15 twice (scenario ids colliding with pre-existing tests; the plan's own regex was the defect), prior 0.1.13/0.1.18. Consolidation is the grilling's thesis itself (contracts + tests, never implementation).
- **Chores (fleet surface, no proposal budget):** `fleet/tests/test_drive.mjs` at 93 s of the 120 s cap (split or raise before the next scenario); golden build prunes `~/.claude/projects` before snapshot (six-day-old transcripts ride into evidence bundles); #190's excludeDirs gate-green scoping merged green-on-deletion — add the passing-spawn drive scenario already queued on #190.
- **Record-only (design working as intended):** standing-approval discipline 4/4 clean; every headless session stopped at the hygiene receipt and refused to push/PR on its own judgment; run-14 park narration; width-2 isolation held; run-15's task-4 implementer lawfully out-reasoned the fix brief with a corpus-equivalence proof; run-17's task-3 implementer completed the Produces contract's skip path unprompted.

## Adoption record (operator, 2026-08-28)

- **P1 + P2:** prose halves ADOPTED and shipped (ultraplan Move 3 + authoring
  rule 6; mirrored in `plan-markers.md`); engine halves (`--check` renders,
  implementer-prompt sentence) commissioned as ONE eval cell — **#345**. #233
  closed on adoption; #237 (b)/(c) retired.
- **P3:** ADOPTED as a spec line only (§W1c unit clause); no new field.
- **P4:** ADOPTED as a whole-scale deletion of credit telemetry — PR **#343**;
  stat leg and the shim's `engine auth` line kept, no assert added. #319 marked
  superseded.
- **P5:** ADOPTED — the shim stamps the INSTALLED plugin version (`claude plugin
  list --json`) and the driver reds `versionStamp` on a mismatch with the pushed
  manifest — PR **#348**; closes #282's image-side half.
- **P6:** ADOPTED — `hygiene_check.sh --run-dir` reads the base branch from the
  receipt; a branch whose PR is merged counts as merged (squash-merge blindness) —
  PR **#347** (with the `filed:#N|URL` grammar); #237 (e) retired.
- **Parked → filed:** reviewer blocking-line inconsistency = watch-item **#344**;
  `filed:` rows that file nothing → FIXED directly instead of parked
  (`residual_manifest.py --check` now requires `filed:#N` or a URL).
- **Chores** (test_drive cap, golden transcript pruning, #190 excludeDirs scenario)
  and the #239 routing note stand as listed.

## Adoption budget

- Additive guard this cycle: **P1's --check fallback** (the #233 build) — one, as licensed.
- Structural / simplification (unbudgeted): P2, P3, P4, P5, P6.
- Deletion candidate: **P4** (strong; evidence 5/5 null by design).
- On adoption: close #233 citing run-14; retire #237 (b), (c), (e) into P2/P6; file the two new watch-items; #319 marked possibly-failed → superseded by P4.
