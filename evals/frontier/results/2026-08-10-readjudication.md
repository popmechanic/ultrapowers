# Frontier probe — reopening-trigger re-adjudication (2026-08-10)

This executes the pre-registered reopening trigger from
`2026-08-10-adjudication.md` — nothing more. That adjudication shelved
increment two *for lack of evidence, not disproven*, and defined the exact
corpus fix that would earn a second look: make K3 evaluable (#133) plus one
fixture with genuine same-file contention, then re-run the same probe and
re-adjudicate against the spec's decision rule as written
(`docs/superpowers/specs/2026-08-09-frontier-kernel-sim-design.md`
§Success criteria). This document records that re-run
(`results/2026-08-10-reopen/`, mainline at `b1417a6`, seed 42) and the
re-adjudication. Per the trigger, no engine work follows from this document
either way — a reopen unlocks a design conversation, not a build.

## Corpus fix 1 — K3 made evaluable (#133)

**Chosen semantics: reconciliation commits fold as pseudo-task endpoint
diffs.** The trigger allowed two designs and required the choice to be stated,
not patched in. What was chosen, precisely:

- Wave groups form exactly as before: consecutive two-parent merges on the
  integration chain sharing a merge-base.
- A non-merge chain commit is a *reconciliation event*; consecutive ones
  coalesce into a single `parent..tip` diff. An event folds into the wave
  whose merges surround it as a pseudo-task (`recon-<sha8>`), participating in
  every sampled fold order like any task.
- An event followed by a new wave whose merge-base already contains it (the
  common between-waves case — the next wave's tasks forked after the
  reconciliation landed) is absorbed by that wave's base snapshot; there is
  nothing left to fold.
- Events after the last merge have no merge tree to compare against, so
  fidelity comparison **cuts at the last merge** for that run — the
  option-2 fallback, applied only to tails, and named per run in the report.
- Chains with an octopus merge, or with no per-task merges at all, remain
  unreplayable and are excluded by name.

**Why this choice:** reconciled runs are exactly the interesting merges, and
cutting the whole run at the last pre-reconciliation merge would have
discarded most of the corpus's post-reconciliation waves. The pseudo-task
design keeps every wave a comparison target while keeping each wave a pure
fold: all fold inputs are endpoint diffs against the wave base, and the
fidelity bar is **unchanged** — every wave's fold must reproduce the tree at
its last merge, manifest-identical on all paths no fold order reported a
conflict for. Nothing about the bar was blurred to admit the corpus.

**Result:** recovered-n **1 → 16** (floor: 3). All 20 remaining exclusions
are chains with no per-task merges — subagent-driven/inline runs merged
through an integration-named branch; no extraction semantics could replay
them, and they are named in the report.

## Corpus fix 2 — a fixture with genuine same-file contention

`evals/fixtures/contend/`: three of four implementation tasks genuinely edit
`clitool/cli.py` (each owns a parser line, a helper function, and a line in
`main`), with **no `Depends-on` markers serializing them** — honoring the
corpus-circularity finding that the 2026-08-09 fixtures inherited the very
serialization rule under test, which made S1's same-file column structurally
vacuous. The plan compiles `parallel` with three inferred `write-after-write`
edges (waves `[[1,4],[2],[3]]`); that contention is the fixture's point and
is pinned by `test_contend_fixture_carries_genuine_same_file_contention`.
The fixture carries a sealed acceptance suite (`seal_hash`), passes
`compile_plan.py --check`, and its reference solution passes the sealed
suite 9/9.

## Measurement summary (results/2026-08-10-reopen/)

**Kernel track — all four gates green for the first time:**

- **K1 (order-independence): PASS** — identical manifests and conflict sets
  across all sampled fold orders on every case, including all 16 archived
  runs with pseudo-tasks in the mix. The #132 conservative false-reds
  (multiset / delete-modify-label order-dependence at 3+ writers per path)
  did **not** trip; per scope, #132 is left open and untouched.
- **K2 (fold idempotence): PASS** on every case.
- **K3 (real-run fidelity): TRUE** — previously `not evaluated (n=1)`. 16
  recovered runs, 92 tasks plus 27 reconciliation pseudo-tasks, 305 fold
  orders sampled, **346 clean paths checked, zero silent divergence, zero
  conflicted paths**. Every wave of every recovered run re-folds to the
  exact tree the historical merge sequence shipped. Six runs carry a named
  trailing-reconciliation cut.
- **K4 (no interleaving): PASS** — no task's block interleaved with
  another's on any shared path, now including the contend fixture's
  three-writer file. (The fixture exposed a latent probe bug here: the
  contiguity check demanded blocks from tasks that never wrote the shared
  path; fixed to check actual writers only.)

**Scheduler track (S1) — the same-file column is now populated:**

| fixture | waves | frontier | frontier w/o same-file edges | barrier recovery | same-file recovery |
| --- | --- | --- | --- | --- | --- |
| wide / chained / mixed / flawed / degrade | — | — | — | 0.0% | 0.0% (no same-file edges) |
| webapp | 1063.6 | 1011.2 | 1011.2 | 4.9% | 0.0% (no same-file edges) |
| contend | 687.3 | 687.3 | **405.3** | 0.0% | **41.0%** |

The split the spec asked for is now measurable: on the contention shape,
barrier removal alone recovers nothing (the write-after-write chain is the
critical path), and dropping the same-file edges — what the frontier thesis
proposes the kernel makes safe — recovers 41% of makespan. The kernel-side
evidence that dropping them is safe is K1/K4 on that same fixture: all 24
fold orders converge, no interleaving, and the contested merges surface
narrated `lines` conflicts rather than silent corruption.

**S3:** unchanged from the operator's 2026-08-10 grade (**usable**); the
track-(b) narration set is byte-identical in this re-run. The #132
presentation blemishes noted there stand.

## Honest caveats

- Durations are **modeled** (seeded uniform 60–600s), not measured; every S1
  number is a model output. The spec says this; it bears repeating here.
- `contend` is one authored-for-purpose fixture. It demonstrates that the
  serialization rule's cost is real and large *on a genuinely contended
  shape*; it does not measure how often real plans would contend if the rule
  were removed — the historical corpus cannot show that, because every
  archived plan was authored under the rule.
- K3's fidelity evidence covers waves whose merges git resolved cleanly (346
  clean paths, 0 conflicted in replay). Real same-file contention under a
  relaxed rule would produce conflicted folds, whose resolution quality is
  S3/operator territory, not K3's.

## Decision rule — applied as written

The rule: *"K1–K4 green and a material S1 delta → increment two (live-sync
probe or frontier engine) may be proposed. Any K failure or a dull S1 →
shelve. 'Material' is deliberately left to operator judgment over the
report."*

- **K1–K4: green.** The K-side precondition is satisfied for the first time;
  the 2026-08-10 shelving's stated grounds — K3 unmeasurable, S1 same-file
  column unexercised — are both dissolved by the corpus fixes the trigger
  prescribed.
- **S1 materiality: the operator's call, by construction.** The distribution
  on the table: 0% on five fixtures, 4.9% barrier recovery on webapp, and
  41% same-file recovery on the one genuinely contended fixture (modeled
  durations, n=1 contended shape).

**Recorded outcome: the shelve-for-lack-of-evidence rationale no longer
holds.** Whether the measured S1 delta is *material* — and therefore whether
increment two may be **proposed** — is the operator's adjudication over this
report, exactly as the rule reserves it. Both readings are defensible on
these numbers: 41% recovery on contended shapes is the thesis's predicted
payoff made visible; equally, one modeled fixture is a thin base for an
engine redesign, and the operator may direct more contended fixtures (or
measured durations) before judging materiality.

Per the trigger's own terms, even an operator "material" verdict unlocks a
design conversation only. No frontier engine work is proposed or performed
here.

## Issue dispositions from this cycle

- **#133** — resolved by the reconciliation-tolerant extraction above
  (close on merge).
- **#132** — not tripped by this re-run (K1 green throughout); left open and
  untouched, as scoped.
