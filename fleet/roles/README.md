# Role prompts

These files are the engine's judgment roles — the prompts handed to a model
when it is asked to decide something. `fleet/run-engine.mjs` reads them at
dispatch, one file per role:

- `implementer.md` — write the task in an isolated tree
- `examiner.md` — write the task's exam: the Proof `Test:` file, red at BASE
- `reviewer.md` — referee a task's diff against its text
- `fix.md` — act on a review's findings
- `resolver.md` — settle a conflicted merge
- `reconcile.md` — repair a wave that landed inconsistent
- `critic.md` — read the finished run for what the plan missed

The register is scientific peer review (#556): a referee checks that a
submission establishes its claim by the stated exam and helps it get there, the
critic is the editor's completeness read, and what a diff cannot settle is a
`minor` finding prefixed `unverified:` rather than a channel of its own. Every
issue the referee raises names its actor — `implementer` when a fix inside this
task's FILES answers it, `plan` when only the task's own text can.

There is no bake step: this directory is the single copy, so editing a file
here changes what the next dispatch sends. Prompt sizes are reported, not
gated — `fleet/tests/test_run_engine.mjs` prints each file's word count and
gates nothing on it (#496). The same test rejects shouted imperatives, and
`fleet/tests/test_roles_peer.mjs` pins the register this directory keeps: the
clause each rule turns on, not a sentence frozen verbatim against its own
author (#612) — a rule that needs shouting belongs in code.

Choreography stays out. Git operations and kernel invocations are driver code
in `run-engine.mjs`; the prompts describe judgment only, and models never run
git themselves (#366 Amendment 10).
