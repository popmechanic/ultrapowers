# Phase-2 corpus migration reading — compiler subtraction vs the pre-registered answer

One-time reading (spec §2a/§2d), not a permanent test. Adjudicates whether the
Phase-2 compiler subtraction (commit `5765b90`, "keep existence edges, delete
ordering-guess tiers") changed anything on the archived plan corpus beyond the
licensed deletion. Method, numbers, and verdict below.

## Method

The pre-registered answer (spec `2026-08-18-fold-native-authoring-program.md`
§2a) was measured "at rev 3, re-verified at round 3, over the 97 marked
plans" — a fixed census taken when `docs/superpowers/plans/` held 100 files
(97 carrying `Depends-on:`). The live tree today holds 107 files / 104 marked
— seven plans landed since rev 3 (all additions; nothing was removed or
renamed — verified by set difference). Comparing the live corpus's aggregate
edge counts directly against the pre-registered numbers would conflate two
unrelated things: corpus growth and compiler behavior. So this reading uses
two corpora:

- **Pinned corpus** (the actual comparison target): the exact 97-marked/100-file
  snapshot as it existed at commit `c67b0426` (spec rev 3), extracted via
  `git show c67b0426:docs/superpowers/plans/<file>` into a scratch dir. Compiled
  with both the **current** compiler and, as a cross-check, the **pre-subtraction**
  compiler extracted at `5765b90^` (its immediate parent — the last commit before
  the tier deletion; diffed against `8ca6b54` to confirm the only change between
  them is the unrelated Commutes-marker addition, not anything in `build_edges`).
- **Live corpus** (supplementary, not compared against the pre-registered
  numbers): every marked plan in `docs/superpowers/plans/` today, current
  compiler only — recorded to confirm the corpus still compiles clean and to
  show the seven new plans' shape.

Both corpora compiled with `--overlap fold` and `--overlap serialize`;
`dag_edges` `why`-label multiset, `mode`, **and `waves`** collected per plan
per mode (the wave shape is what the engine actually schedules, so an
edge-only reading would miss a scheduling change). Seven
sealed fixture repos under `evals/fixtures/` (`wide`, `chained`, `mixed`,
`degrade`, `contend`, `contend-prod`, `contend-big` — the `test_fixture_seals.py`
set; `webapp` and `flawed` are excluded there and here) compiled the same way
with both compilers.

All throwaway collection scripts ran from the scratchpad; nothing here is a
CI-executed test.

## Step 1/2 — pinned-corpus totals (97 marked plans)

### Old compiler (`5765b90^`) — reproduces the pre-registered answer exactly

| overlap | marker | interface | write-after-create | prose-reference | read-after-write | ambiguous-files | catch-all | write-after-write | `mode: sequential` plans |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fold | 180 | 17 | 2 | 3 (2 plans) | 0 | 0 | 0 | 0 | 20 |
| serialize | 180 | 17 | 2 | 3 (2 plans) | 0 | 0 | 0 | 35 | 23 |

Every number in the `fold` row matches the pre-registered answer verbatim
(marker 180, interface 17, write-after-create 2, prose-reference 3 in 2
plans, read-after-write 0, ambiguous-files 0, catch-all 0, 20 sequential),
confirming the pinned corpus and the extracted old compiler correctly
reproduce the rev-3/round-3 measurement. (The `serialize`-mode sequential
count, 23, was not part of the pre-registered census — recorded here only as
context for the current-compiler diff below.)

### Current compiler — the subject of this reading

| overlap | marker | interface | write-after-create | write-after-write | `mode: sequential` plans |
| --- | --- | --- | --- | --- | --- |
| fold | 180 | 17 | 2 | 0 | 17 |
| serialize | 180 | 17 | 2 | 35 | 17 |

No `prose-reference` / `read-after-write` / `ambiguous-files` / `catch-all`
key appears at all — those `why` labels no longer exist in the compiler's
vocabulary, per the deletion.

### Delta (current − old)

| label | fold Δ | serialize Δ |
| --- | --- | --- |
| marker | 0 | 0 |
| text | 0 | 0 |
| interface | 0 | 0 |
| write-after-create | 0 | 0 |
| write-after-write | n/a (tier absent under fold in both) | 0 |
| prose-reference | **−3** (3 → 0) | **−3** (3 → 0) |
| read-after-write / ambiguous-files / catch-all | 0 (already 0) | 0 (already 0) |
| `mode: sequential` plan count | **−3** (20 → 17) | **−6** (23 → 17) |

`marker`, `interface`, `write-after-create`, and `write-after-write` are
byte-identical between the two compilers on every one of the 97 plans — the
only edge-label change anywhere in the corpus is the `−3 prose-reference`
deletion, and the only other change is the `mode` field on plans whose
sequential classification depended solely on the deleted `fully_overlapping`
degrade (single-implementation-task plans are unaffected — that trigger is
untouched — and were checked: all 17 plans the current compiler marks
`sequential` under fold carry the unchanged `degrade_reason` string
`"Sequential mode: 1 implementation tasks"`).

## Step 3a — per-plan diff rows (multiset changed)

Only two plans in the 97 carry `prose-reference` edges at all — matching
"3 prose-reference (2 plans)" from the pre-registered answer exactly:

| plan | overlap | old multiset | new multiset | mode (old → new) |
| --- | --- | --- | --- | --- |
| `2026-06-16-superpowers-v6-and-efficiency.md` | fold | `{marker: 9, prose-reference: 2}` | `{marker: 9}` | parallel → parallel |
| `2026-06-16-superpowers-v6-and-efficiency.md` | serialize | `{marker: 9, prose-reference: 2, write-after-write: 3}` | `{marker: 9, write-after-write: 3}` | parallel → parallel |
| `2026-08-13-frontier-mode-in-engine.md` | fold | `{interface: 2, marker: 10, prose-reference: 1}` | `{interface: 2, marker: 10}` | parallel → parallel |
| `2026-08-13-frontier-mode-in-engine.md` | serialize | `{interface: 2, marker: 10, prose-reference: 1, write-after-write: 1}` | `{interface: 2, marker: 10, write-after-write: 1}` | parallel → parallel |

2 + 1 = 3 edges lost, exactly the expected `−3`. Neither plan's `mode`
changes. One of the three deleted edges **was** gating, however, and moves
its plan's wave shape — recorded next.

### Wave-shape consequence — one plan, both modes

Deleting an edge moves a wave boundary whenever that edge was the only thing
holding its target back. Of the three deleted `prose-reference` edges,
exactly one is gating:

| deleted edge | plan | other incoming edges to the target | gating? |
| --- | --- | --- | --- |
| `1 → 3` | `2026-06-16-superpowers-v6-and-efficiency.md` | **none** | **yes** |
| `1 → 10` | `2026-06-16-superpowers-v6-and-efficiency.md` | `3 → 10` (marker), `9 → 10` (marker) | no |
| `3 → 9` | `2026-08-13-frontier-mode-in-engine.md` | `4 → 9` (marker) | no |

So `2026-06-16-superpowers-v6-and-efficiency.md` — and only that plan —
changes wave shape, identically under both overlap modes:

| plan | overlap | old waves | new waves |
| --- | --- | --- | --- |
| `2026-06-16-superpowers-v6-and-efficiency.md` | fold | `[['1','2','4','5','6'],['3','7','8','9'],['10','13'],['11'],['12']]` | `[['1','2','3','4','5','6'],['7','8','9'],['10','13'],['11'],['12']]` |
| `2026-06-16-superpowers-v6-and-efficiency.md` | serialize | `[['1','2','4','5','6'],['3','7','8','9'],['10','13'],['11'],['12']]` | `[['1','2','3','4','5','6'],['7','8','9'],['10','13'],['11'],['12']]` |

Task 3 is promoted from wave 2 into wave 1; the wave count is unchanged (5),
and no task moves later. Wave shapes are byte-identical old vs. new on the
other 96 plans in both modes — measured across all 97 × 2 = 194 (plan, mode)
pairs, exactly the 2 pairs tabled above differ.

This stays inside the licensed deletion rather than exceeding it. The
pre-registered answer is stated in edge-label and `mode` terms, and a wave
boundary is a pure function of the edge set: promoting a task whose only
constraint was a deleted ordering-guess edge *is* the deletion taking
effect, not a second behavior change. `2026-08-13-frontier-mode-in-engine.md`
shows the complementary case — its deleted edge was non-gating, so its waves
are unchanged.

## Step 3b — mode-only flips (multiset unchanged, `sequential` → `parallel`)

Every plan below carried the old compiler's `degrade_reason` "…fully
overlapping writes" — the third and last change the deletion licenses, after
the `−3` edges and the one wave-shape promotion above. No plan's `mode`
flipped for any other reason (no plan gained or lost the
single-implementation-task trigger). None of these plans' wave shapes
change; the only wave change on the corpus is the Step 3a one.

| plan | fold flip | serialize flip | old `degrade_reason` |
| --- | --- | --- | --- |
| `2026-06-13-harness-library.md` | yes | yes | Sequential mode: 2 implementation tasks, fully overlapping writes |
| `2026-08-06-eval-config-isolation.md` | yes | yes | Sequential mode: 2 implementation tasks, fully overlapping writes |
| `2026-08-06-gate-integrity-pair.md` | yes | yes | Sequential mode: 2 implementation tasks, fully overlapping writes |
| `2026-08-06-harvester-session-attribution.md` | no (already parallel) | yes | Sequential mode: 3 implementation tasks, fully overlapping writes |
| `2026-08-09-harvester-attribution-v2.md` | no (already parallel) | yes | Sequential mode: 3 implementation tasks, fully overlapping writes |
| `2026-08-14-infra-death-park-retry.md` | no (already parallel) | yes | Sequential mode: 2 implementation tasks, fully overlapping writes |

Three fold-mode flips (20 → 17, matching the aggregate exactly) and six
serialize-mode flips (23 → 17) — more flips under `serialize` because the old
compiler's `fully_overlapping` degrade used `dropped_pairs` (populated only
by the now-deleted `ambiguous-files` tier) to exclude pairs, and
`dropped_pairs` was always empty under `serialize`, so the trigger fired more
readily there. This is entirely inside the licensed deletion — no new
mechanism, no plan gains a wave-ordering edge it didn't have before.

## Step 3c — fixture-shape diffs (seven sealed fixtures)

| fixture | fold diff | serialize diff |
| --- | --- | --- |
| `wide` | none | none |
| `chained` | none | none |
| `mixed` | none | none |
| `contend` | none | none |
| `degrade` | `mode: sequential → parallel` (multiset/waves unchanged: `{marker: 1}`, waves `[['1'],['2']]`) | same flip |
| `contend-prod` | none | `mode: sequential → parallel` (multiset/waves unchanged: `{write-after-write: 6}`, waves `[['1'],['2'],['3'],['4']]`) |
| `contend-big` | none | `mode: sequential → parallel` (multiset/waves unchanged: `{write-after-write: 6}`, waves `[['1'],['2'],['3'],['4']]`) |

Four of the seven fixtures are byte-identical old vs. new in both modes.
`degrade`, `contend-prod`, and `contend-big` show the same class of change as
the plan corpus — a `mode` flip from the deleted `fully_overlapping` degrade,
zero edge-multiset change, zero wave-shape change. No fixture shows any
other delta.

## Verdict

**PASS — exactly the expected diff.** Across the pinned 97-plan corpus and
all seven sealed fixtures, the only differences the current compiler
produces relative to the pre-registered answer are:

1. `−3 prose-reference` edges (2 plans; the deleted heuristic tier),
2. `sequential` → `parallel` mode flips wherever the old compiler's deleted
   `fully_overlapping` degrade was the plan's only sequential trigger (3
   plans under `fold`, matching the aggregate `20 → 17`; 3 more under
   `serialize` only, matching `23 → 17`; plus 3 of the seven fixtures), and
3. the direct arithmetic consequence of (1) on one plan's wave shape:
   `2026-06-16-superpowers-v6-and-efficiency.md` promotes Task 3 from wave 2
   into wave 1 in both overlap modes, because the deleted `1 → 3` edge was
   Task 3's sole incoming constraint. Wave shapes are byte-identical on the
   other 96 plans and on all seven fixtures. This is not a delta beyond the
   licensed deletion — a wave boundary is a pure function of the edge set, so
   deleting a gating ordering-guess edge necessarily promotes its target;
   that is the deletion working, not new behavior.

No other `why`-label count changed (`marker` 180/180, `interface` 17/17,
`write-after-create` 2/2, `write-after-write` 35/35 under `serialize`, all
exact). No plan or fixture that compiled before now fails, or vice versa. No
compiler behavior outside the named deletion moved at all. This is the
"exactly `−3 prose-reference`, plus any `sequential`-mode flips from the
degrade deletion" diff the plan called for — plus that diff's own downstream
effect on one plan's wave shape, and nothing else — the
measured-inert-deletion adjudication (§2d) is satisfied by this reading; the
T15 rig re-run (Task 12) is the remaining integration-spanning acceptance
check.

## Supplementary — live corpus today (104 marked plans, not compared above)

Recorded for corpus health only; the pre-registered answer is pinned to the
97-plan rev-3 census, so these numbers are not diffed against it directly.
Zero compile failures across all 104 marked plans in either overlap mode.
Seven plans landed since rev 3 (pure addition, nothing removed or renamed):
`2026-08-18-fold-native-phase1-resolver-reach.md`,
`2026-08-19-review-strength-heads-pinning.md`,
`2026-08-20-drain-residuals-sensor-half.md`,
`2026-08-20-fold-native-phase2.md` (this plan),
`2026-08-20-harvester-dict-totals-merge.md`,
`2026-08-20-operator-smoke-manifest.md`,
`2026-08-20-phase1-kernel-residuals.md`.

| overlap | marker | interface | write-after-create | write-after-write | `mode: sequential` plans |
| --- | --- | --- | --- | --- | --- |
| fold | 189 | 17 | 2 | 0 | 19 |
| serialize | 189 | 17 | 2 | 41 | 19 |
