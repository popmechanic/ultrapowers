# The offline replays that choose the factory's thresholds

`factory/questions.json` is the judge. This directory is how its thresholds are
read off the record rather than guessed, and `factory/policy.json` is where the
chosen numbers land, each carrying the `n` and the `window` it was read over.

The corpus is not tracked. `residuals_dataset.jsonl` — 1,157 reviewer residuals
over 84 runs, built by `build_residuals.py` on 2026-09-16 — lives on the laptop,
like `evals/frontier/corpus/`. What is tracked here is the script, the summary and
the sample, so a reading can be cited without the corpus being carried.

```bash
python3 factory/replay/replay_landing.py <dataset.jsonl> <out.jsonl> [limit]
python3 factory/replay/analyze_landing.py <dataset.jsonl> <out.jsonl> [summary.json]
python3 factory/replay/sample_disagreements.py <dataset.jsonl> <out.jsonl> <handread.jsonl>
```

The replay reads its questions FROM `questions.json` and never restates them: the
whole point of one judge file is that the strings a replay scores are the strings
a run asks.

## What the 2026-09-17 pass said (n = 1,157 residuals, 84 runs)

Full output: `results/2026-09-17-landing-replay.txt`. 1,157 calls, 2.53M input
tokens, **$0.106**, median 320 ms. Answers: `results/landing_out.jsonl.gz`.

**Three of the ten `landing` questions could not be asked.** `borne_out` and
`defect_visible` need `hunks`, and no tag carries the pre-fix patch — #1127
reading 3 says so in terms. `settled_by_fact` needs sibling facts the corpus
predates. So `t₁` has no offline reading at all and the false-block rates below
are **upper bounds**: the missing conjunct can only remove blocks.

| reading | result |
|---|---|
| **false-block rate**, policy minus `borne_out`, on rows opus graded minor | 0.8% at `claim_false ≥ 0.5`, 0.3% at 0.7, 0.2% at 0.8, **0% at 0.9** |
| `status` = unverified vs the `unverified:` prefix | conf ≥ 0.9: precision 54%, recall 92%, agreement 91% |
| `actor` = plan vs the `plan-defect:` prefix | conf ≥ 0.8: precision 21%, recall 36%; conf ≥ 0.9: precision 23%, recall 20% |
| `routeToPlan`'s regex, same rows | precision 100% (30/30), recall 27% — **but see below** |
| `scope_only` vs the `outside_files:` prefix | precision ≤ 16% at every threshold; recall 60% at 0.5 |

Read honestly, three of those are bad news for the cut as filed:

- **The regex's 100% precision is definitional, not measured.** `route_to_plan`
  opens `if not detail.startswith('plan-defect:')`, so it is a strict subset of
  the label by construction and cannot score otherwise. Recall is the only fair
  axis: 27% for the regex, 36% for Jev at conf ≥ 0.8. #1127's "replaced by
  `actor` with confidence" is not yet earned on this reading.
- **`scope_only` does not track `outside_files`** at any threshold tried.
- **`status` has a strong prior**: Jev answers `unverified` on 1,019 of 1,157
  rows. Recall is nearly perfect because it almost always says so, which is why
  precision is what matters and why the threshold has to be high.

The good news is the one that matters most: **the blocking conjunction is
conservative.** Even without `borne_out`, at `claim_false ≥ 0.7` it promotes 3
of 1,157 graded-minor residuals, and at 0.9 it promotes none — which is also a
warning that too high a `t₂` makes the gate inert.

None of this flips a default: it is one offline replay against a label that is
opus grading itself inconsistently, which is the premise of #1127 in the first
place. A Jev/prefix disagreement is not a Jev error.

## The fifty

`results/handread_50.jsonl` is the stratified sample #1127 reading 1 owes a
person, drawn deterministically (seed 1131) across the five ways the two
readings part company — 10 each:

| stratum | in corpus |
|---|---|
| `no_prefix_jev_says_plan` | 107 |
| `no_prefix_jev_says_unverified` | 62 |
| `outside_files_prefix_jev_low_scope` | 39 |
| `plan_prefix_jev_disagrees` | 28 |
| `would_block_graded_minor` | 25 |

Each row carries its `hand_read` (2026-09-17, Fable). `unverified_prefix_jev_disagrees`
is empty — Jev agreed with all 118.

## What the hand read said, and the thresholds it chose (2026-09-17, Fable)

62 rows read: the stratified fifty, plus every one of the twelve rows the policy
would promote at its widest setting — because those twelve *are* the false-block
risk, and the fifty happened to hold only four of them. Verdicts are in
`results/handread_50.jsonl`; the thresholds and their bases are in
`factory/policy.json`, each with its `n` and `window` or an `unread` that says why.

Where Jev was right: 29 of the fifty outright, and ten of ten on the
`outside_files` stratum — the reviewer's prefix measures *footprint* (where the
edit landed), `scope_only` asks about *unrequested work*, and a required,
disclosed out-of-FILES edit is the first and not the second. `subject =
footprint` is the honest proxy for that prefix (precision 45%, recall 66% at
conf ≥ 0.8) and it gates nothing.

Where Jev was wrong, three shapes, each of which moved a threshold:

1. **`unverified` is a prior.** Jev says it on 88% of rows. Read as an unconditional
   demotion it would have suppressed four real defects in the fifty (#40, #43,
   #44, #49) at confidence 0.31–0.63. So only a *confident* unverified demotes:
   `t_status = 0.9`, where the label reads precision 54% / recall 92% and a hand
   read of ten no-prefix rows at ≥ 0.91 found eight right. The promoted set is
   insensitive to this value across 0.8–0.95.
2. **`cannot act here` reads as `cannot verify`** (#13, #15) — two verified
   observations about paths outside FILES came back `unverified`. Conservative
   in effect; costs recall. A wording candidate for the next replay, not this one.
3. **`examiner` fires on the word** (#36, #39): a finding that *mentions* a leg or
   an exam gets actor `examiner` at 0.44–0.59. 91 rows say examiner, median
   confidence 0.45, six at ≥ 0.8. The blocking rule already needs `implementer`,
   so this costs nothing there; a plan route it would have caught is missed.

**The promoted twelve** (`t₂ = 0.7, t₃ = 0.6, t₄ = 0.7, t_status = 0.9`): ten right —
eight unambiguous defects in FILES (a missing probe-arm case; `from_tag`'s silent
zero; a second issue filed on re-entry; an uncaught `UnicodeDecodeError`; a
substring grep over a shared log; `--untracked-files=normal` losing a manifest; a
deleted judgment call once taught at `report-format.md:112` (deleted 2026-09-24); `failingPaths` not
deduplicated) and two trivial-but-correct doc rows. Two wrong: run-127/3, a plan
defect Jev mis-actored at `fixable = 0.60`, which `t₃ = 0.7` removes; and
run-115/1, a worker's `concern:` disclosure of a budget bump — a note, which the
factory routes to the `note` set and never to `landing`. At `t₂ = 0.8` the policy
keeps four of the right ones and loses five real defects, so **`t₂ = 0.7`**: the
exam is the first value, and one accepted false block in 1,157 (0.09%, upper
bound) buys five caught defects.

**Plan routing is not yet earned as the regex's replacement.** `actor = plan` at
≥ 0.8 reads precision 21% / recall 36% against a label whose own recall is
unknown (six of ten no-prefix routes were right on the hand read — the label had
missed them). `t₅ = 0.8` with the regex kept as the floor below it, exactly as
#1127 filed, plus one guard the question's own criterion supplies: a `plan` route
with `fixable_in_files ≥ 0.5` contradicts the answer that produced it (#6, fix
0.88, was the one wrong route read).

**Unread, and said so in the file:** `t₁` (`borne_out`, 0.8) and `t₆`
(`settled_by_fact`, 0.9), both set high on judgment because each *promotes*, with
`n: 0` and the live reading that measures them first named. Every other set's
thresholds are `record-only` as their tickets filed them, or carried verbatim
from the engine (`note.stuck` 0.7, `note.plan_defect` 0.7, n = 779 notes).

