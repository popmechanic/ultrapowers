# Role prompts

These files are the engine's judgment roles — the prompts handed to a model
when it is asked to decide something. `fleet/run-engine.mjs` reads them at
dispatch, one file per role:

- `implementer.md` — write the task in an isolated tree
- `reviewer.md` — judge a task's diff against its text
- `fix.md` — act on a review's findings
- `resolver.md` — settle a conflicted merge
- `reconcile.md` — repair a wave that landed inconsistent
- `critic.md` — read the finished run for what the plan missed

There is no bake step: this directory is the single copy, so editing a file
here changes what the next dispatch sends. Each prompt is capped at 350 words
by a pinning test in `fleet/tests/test_run_engine.mjs`, which also rejects
shouted imperatives — a rule that needs shouting belongs in code.

Choreography stays out. Git operations and kernel invocations are driver code
in `run-engine.mjs`; the prompts describe judgment only, and models never run
git themselves (#366 Amendment 10).
