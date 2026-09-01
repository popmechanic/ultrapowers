# #494 — Executability of the do:/see: probe corpus (measured 2026-08-31)

Charter: issue #494 (map #238). What fraction of the `## Operator smoke` do:/see:
probes already authored in this repo's plans could be decided mechanically?
Corpus study over `docs/superpowers/plans/*.md` only — no probe runner built, no
frozen periphery touched, no fleet access. (Charter item 4, the #441 park
cross-check, was out of this dispatch's scope — plan files only.)

## Corpus

- 151 plan files; **43** carry a `## Operator smoke` section.
- 4 of those 43 declare "No observable surface — suite is the whole story" and
  contain no probes (e.g. `2026-08-28-test-suite-subtraction.md`).
- **127 do:/see: probe pairs** across the remaining 39 plans. That is the corpus.

## Buckets (conservative — doubt resolved toward the harder bucket)

| bucket | n | / total (127) | / non-stale (101) |
|---|---|---|---|
| executable-now | 52 | 40.9% | **51.5%** |
| executable-with-harness | 45 | 35.4% | 44.6% |
| judgment-required | 4 | 3.1% | **4.0%** |
| stale/unrunnable | 26 | 20.5% | — |

**Headline (conservative): executable-now / non-stale = 52/101 ≈ 51%.**
**Ceiling under scaffolding: (executable-now + with-harness) / non-stale = 97/101 ≈ 96%.**
**Judgment-required residue: 4/101 = 4%.**

### Sub-split inside executable-with-harness

28 of the 45 harness probes are of one shape: *"after the next real fleet run,
open `<artifact>` and assert `<field/substring>`"* — the check itself is fully
mechanical (JSON field, grep, tar listing); the only scaffolding is that a run
must have happened. Example: `tar -tzf` the evidence bundle and assert
`frontier/weave/manifest.json` present (`2026-09-01-tier1-weave-persistence.md`).
A probe runner attached to run evidence would decide these with zero judgment.
The other 17 need only local scaffolding: author a scratch fixture plan, run two
processes at once, drive `claude -p` and grep its output.

## Cohorts (by plan date)

| cohort | probes | executable-now | with-harness | judgment | stale |
|---|---|---|---|---|---|
| 08-20 to 08-21 | 16 | 7 (44%) | 7 | 0 | 2 (13%) |
| 08-25 to 08-27 | 55 | 15 (27%) | 17 | 1 | **22 (40%)** |
| 08-28 to 08-29 | 20 | 8 (40%) | 7 | 3 | 2 (10%) |
| 08-30 to 09-01 | 36 | **22 (61%)** | 14 | 0 | **0** |

Two trends. Staleness is concentrated in the 08-25–27 cohort — probes pinned to
`waves.js`, `redirect_args.py`, `salvage_args.py`, the pre-Phase-0 SKILL.md
prose, and `tests/sim_*.mjs`, all deleted at the 0.3.0 cutover or #492.
Post-cutover plans are 0% stale and 61% executable-now: authors are already
converging on exact commands + exact output pins without being asked to.

## Examples (verbatim from the plans)

### executable-now (52)

- do: `python3 skills/ultrapowers/scripts/compile_plan.py --check docs/superpowers/plans/2026-08-20-fold-native-phase2.md`
  see: `PLAN OK` — the new compiler accepts this very plan, including its own marker grammar.
  (`2026-08-20-fold-native-phase2.md`)
- do: `bash skills/ultrapowers/scripts/run_acceptance.sh deadbeef0000 main 0000…`
  see: stderr `usage: run_acceptance.sh --suite-gate --branch BRANCH …`, exit code 2, nothing on stdout.
  (`2026-08-28-one-driver-phase-0a-subtraction.md`)
- do: `grep -rn "serialize the scaffolding" skills/`
  see: no matches — the conservative-default steering prose is gone.
  (`2026-09-01-tier1-weave-persistence.md`)

### executable-with-harness (45)

- do: after the next real fleet run, `tar -tzf` its evidence bundle
  see: `frontier/weave/manifest.json` and `weave-events.jsonl` present in the run dir.
  (`2026-09-01-tier1-weave-persistence.md` — mechanical check, live-run artifact)
- do: create a scratch plan file with one task whose Files block reads `- Modify: src/{a,b}.py`, then run the same `--check` on it.
  see: a refusal naming the glob and telling you to enumerate concrete paths (not a silent pass).
  (`2026-08-20-fold-native-phase2.md` — needs a fixture authored first)
- do: in the run's evidence bundle, `cat report.json | python3 -c "import json,sys; print(json.load(sys.stdin)['completenessFindings'])"`
  see: a list of objects with `severity` and `detail`, or an empty list — never a list of strings.
  (`2026-08-31-critic-blocking-channel.md` — mechanical shape check, live-run artifact)

### judgment-required (4)

- do: in a session without the fleet, run `/ultrapowers docs/superpowers/plans/<any-approved-plan>.md`.
  see: the skill … says plainly that nothing runs locally and there is no fallback; it never invokes `ultra_run.py` or the Workflow tool.
  (`2026-08-28-one-driver-phase-0b-texts.md` — "says plainly" is a paraphrase judgment on LLM narration)
- do: read `README.md` from the top and the plugin's card in `/plugin`.
  see: both say it runs on an exe.dev fleet you provision with no local engine; the README no longer promises a sealed exam, a live viewer, or a sequential step-down.
  (`2026-08-28-one-driver-phase-0b-texts.md` — interactive UI + "no longer promises" reading)
- do: run an ultralearn sense pass and hand a reader the `fleet-runs-2026-08-27/` bundle.
  see: findings cite `detail.*` fields (errors/timedOut/creditSpendUsd) rather than only transcript prose.
  (`2026-08-27-w2-entry-slate.md` — quality judgment on LLM-produced findings)

### stale/unrunnable (26)

- do: `grep -c "footprint, not a fence" skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js`
  see: `2` for each file (implementer + reviewer sentences, source and baked copy).
  (`2026-08-25-files-footprint-not-fence.md` — both files deleted at 0.3.0)
- do: `python3 -m pytest tests/test_skill_budget.py -q`
  see: 1 passed — both ceilings hold at merge-time counts.
  (`2026-08-26-shrink-budget-deltas.md` — test deleted at #492)
- do: at the next real PASS gate with advisory residuals, watch the orchestrator's next move.
  see: a manifest with `filed:` rows and at most one redirect round offered with a stated cost — never an unprompted polish relaunch.
  (`2026-08-25-post-pass-redirect-policy.md` — the LLM orchestrator and redirect machinery are deleted)

## Stale fraction as its own finding

**26/127 = 20.5% of all probes ever authored now reference deleted machinery**,
and they decay in clumps: one architectural deletion (the 0.3.0 cutover) killed
~22 probes at once; #492 killed 2 more. Probes rot exactly as fast as the
machinery they pin — which is an argument *for* executing them (a runner would
have surfaced the rot the day of the deletion) and *against* treating an
archived probe as evidence about the current tree. Notably the decay rate is a
history artifact, not a steady state: the post-cutover cohort is 0% stale so far.

## §Reading

#494 poses two worlds: ~80% executable → probes can carry termination weight
(#447 item 1 is the highest-leverage build); ~25% → the deferred residue eats
the oracle and probes only supplement the suite.

**The corpus is in the first world, decisively.** Even under conservative
classification, half the live probes are decidable today by a script with no
scaffolding at all, and the ceiling under light scaffolding is 96%. The
genuinely-deferred class #206's escape valve must cover — perceptual or
qualitative claims no mechanical check can decide — is **4%**, not 25%: the
valve needs to be small. Moreover, most of what looks deferred is not
perception but *timing*: 28 of the 45 harness probes are mechanical assertions
against the next run's evidence bundle, i.e. executable the moment a runner is
allowed to fire post-run instead of pre-merge. The honest caveat on the 51%
executable-now number: these probes were authored knowing they were advisory,
and the post-cutover cohort (61% executable-now, 0% judgment, 0% stale) shows
the authored ceiling rising on its own — the measured fractions are a floor on
what deliberate authoring would yield. Probes can carry termination weight;
#239's termination answer does not have to come from somewhere else.

## Method

Extraction: regex over `^## Operator smoke` sections; do:/see: pairs including
multi-line wrapped forms (verified by hand against the four wrapped-format
plans). Staleness: every referenced script/test/reference file checked for
existence on today's tree (`main`, clean); probes asserting on pre-Phase-0
SKILL.md prose confirmed gone by grep. Fixtures a not-yet-executed plan will
itself create (`evals/fixtures/claims/` in `2026-08-31-390-cutover.md`) were
classified by what deciding them takes, not penalized as stale, per the
charter's framing note. Classification is per-probe, one bucket each,
conservative on every tie.
