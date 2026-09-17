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

Each row carries a `hand_read: null` for the verdict. `unverified_prefix_jev_disagrees`
is empty — Jev agreed with all 118.
