# Wrong plans

Seven small plans for the fixture `popmechanic/flock-baseline`: one correct control and six that
each carry one planted flaw. They read how a swarm copes when its plan is wrong. `manifest.json`
names each flaw, what coping well looks like, and the commit every run starts from.

To take a reading, copy the plans and their `*.gate-verdicts.json` into a clone of the target (the
launcher checks a plan against the repository it sits in), then launch each one held, so nothing
merges and every run starts from the same commit:

```bash
node fleet/launch.mjs <clone>/.plan/wrong/<id>.md --target popmechanic/flock-baseline --base <manifest base> --engine <sha> --repo <clone> --hold
```

`wrong-literal` is refused by the launcher on its gate record; that refusal is its result. Score
the rest from the evidence clone, then close the held pull requests unmerged:

```bash
python3 evals/readings/wrong_plans.py <evidence clone> control=<run> contradiction=<run> wrong-files=<run> stale-premise=<run> missing-edge=<run> clause-vs-suite=<run> wrong-literal=gate --jev --json evals/results/wrong-plans-<date>.json
```

The plans say nothing of what they are for. The first round (2026-11-13, runs 25–30) named the
reading in every task, and one builder cited an operator's decision that did not exist; its
results are kept as `evals/results/wrong-plans-2026-11-13-leaked.json` and are not a baseline.
