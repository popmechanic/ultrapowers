# Base-ancestry provisioning guard (#314) — mechanics cell, 2026-08-29

Engine at `d3a6652` (this branch's integrated tree). Instrument:
`tests/sim_base_ancestry.mjs` — real git in a temp repository, the real
orchestrator body, a git-backed implementer stub that provisions each task
worktree from a chosen ref and runs the prompt's anchor recipe. Commands run:

```bash
git rev-parse --short HEAD
node tests/sim_base_ancestry.mjs | tee /tmp/base-ancestry-sim.out
node tests/sim_workflow.mjs | tail -1
node tests/wave_ancestry_sim.mjs | tail -1
node tests/sim_derived_heads.mjs | tail -1
node tests/frontier_merge.mjs | tail -1
python3 -m pytest tests/test_compile_plan.py tests/test_fixture_seals.py tests/test_js_specs.py tests/test_no_prompt_drift.py -q | tail -3
```

## Reproduced condition

| scenario | worktree cut from | `is-ancestor BASE cut` | tasks | `baseCorrected` recorded | #314 trip calls |
|---|---|---|---|---|---|
| engine-newer (#314 literal: origin/main fetched, 2 commits past BASE) | newer ref | true | 3 | 3 | 3 |
| engine-older (integration branch advanced past main) | older ref | false | 3 | 3 | 3 |

Predicate note: `git merge-base --is-ancestor BASE HEAD` is TRUE on the #314
shape (row 1), so the ancestor test proposed in the issue would have passed
silently; the shipped predicate is exact equality `HEAD == BASE`.
Every task's commit parent equalled BASE after the correction (asserted).

## False trips

| control | implementer dispatches | `baseCorrected` non-null | #314 trip calls |
|---|---|---|---|
| engine-clean (cut from BASE) | 3 | 0 | 0 |
| engine-missing-startHead (schema bypass) | 3 | 0 | 0 (3 `unverified` calls, by design) |
| pre-existing harness sims (`sim_workflow`, `wave_ancestry_sim`, `sim_derived_heads`, `frontier_merge`) | all | pass unchanged — `ALL SCENARIOS PASSED` ×4 | — |
| compile corpus control (`test_compile_plan.py`, `test_fixture_seals.py`) | — | pass unchanged (the guard is runtime-only) | — |

## Cost

TIMING anchor-to-base stale (rev-parse + reset --hard + confirm): mean 7.8 ms over n=20
TIMING anchor-to-base clean (rev-parse + confirm): mean 5.1 ms over n=20

Per worktree, once, before any task work; the reset path only runs when the
provisioning ref was wrong.

## Bar (plan header) and readings

- Trips on the reproduced condition, both directions: met — newer=3, older=3
- Zero false trips on the clean control and the pre-existing sims: met — clean=0, missing=0, all four pre-existing sims `ALL SCENARIOS PASSED`
- Cost stated: stale mean 7.8 ms over n=20; clean mean 5.1 ms over n=20

## Operator verdict

_pending — the operator reads the numbers above at integration; this record
states no verdict._
