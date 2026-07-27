# Run-scoped engine scratch — structural identity + lifecycle (issue #90)

- **Date:** 2026-07-27
- **Status:** approved design (operator, 2026-07-27); brainstormed from the
  superpowers 6.2.0 review (SDD plan-scoped-workspace spec, 2026-07-06)
- **Problem owner:** the execution engine (`skills/ultrapowers/harnesses/waves.js`,
  `scripts/ultra_run.py`, `scripts/review-package`)
- **Acceptance:** suite

## Problem

The engine manufactures its own gate dirt. Two mechanisms, both field-observed
in the 2026-07-07 foreign-run corpus (engines 0.0.31–0.0.32):

1. **Repo-relative script resolution.** The baked implementer prompt says
   `run bash skills/ultrapowers/scripts/review-package` — a path that exists
   only when the target repo *is* the plugin repo. In foreign repos the script
   is absent, the prompt's fallback branch has implementers dump raw diffs,
   and those artifacts landed in the session checkout and tripped the gate's
   clean-tree check to BLOCKED (ledger run `4d5b8b8f`).
2. **Unowned scratch location.** `review-package`'s default OUTFILE is
   `<main-root>/.superpowers/ultra/…` — a directory whose `.gitignore` exists
   only if superpowers' own scripts happened to run in that repo. Where it
   hasn't, the packets are untracked dirt; one run tripped the clean-tree
   check on both rounds on engine exhaust alone (ledger run `7b75abe4`).

Every recognized-exhaust BLOCKED dilutes the clean-tree signal (#32): it
trains orchestrators and operators to treat gate reds as probably-noise —
the one habit the verification chain cannot afford — and levies its clock
tax at the exact point the human is waiting.

**Root cause** (borrowing the 6.2.0 SDD spec's formulation, which fits
verbatim): identity lives nowhere in the data; correctness relies on cleanup
that has no trigger. The fix must be structural. This is the third
generation of scratch-location guards (`.git/ultra` → `.superpowers/ultra` →
here); the design below ends the lineage by making the location a
consequence of run identity rather than a rule agents must remember.

## Design

### 1. The driver injects `pluginRoot` and `runDir` (single channel)

`ultra_run.py` already knows both: `PLUGIN_ROOT` is a module constant, and it
creates `<repo-root>/.claude/ultrapowers/run-<stamp>/` before compiling. Both
paths travel to the harness **in the launch file** — the single knob channel
(#89) — never as ad-hoc inline args. `waves.js` interpolates them when
composing prompts.

### 2. Absolute script resolution, explicit OUTFILE

The baked implementer instruction becomes:

```
bash <pluginRoot>/skills/ultrapowers/scripts/review-package <BASE> <HEAD> \
  <runDir>/review/<taskId>-<base7>..<head7>.diff
```

- The script always exists at `pluginRoot`, so the **script-absent fallback
  branch in the implementer prompt is deleted outright** — the class of
  raw-diff-in-checkout artifacts becomes inexpressible.
- The packet always lands under the run dir. `<runDir>` is derived from the
  main repo root, so it is the same absolute path from every linked worktree
  (the sharing property the old `.superpowers/ultra` comment defended).
- The reviewer's guarded no-packet fallback (recover the diff read-only with
  `git diff <BASE> <HEAD>`; writes nothing) **stays** — it is engine-bypass
  safety, not a scratch writer.

### 3. Self-ignoring parent `.gitignore`

The driver writes `.claude/ultrapowers/.gitignore` containing `*` (idempotent,
every run). `review-package` maintains the same file when it has to create its
default directory (see §4) — both writers, mirroring 6.2.0's `sdd-workspace`
parent-level ignore. Every run dir and everything in it is structurally
invisible to `git status` and `git add -A`, in any repo, tracked-state
permitting (a file already tracked defeats gitignore; no engine path commits
these files, and none are tracked today).

### 4. `review-package` default location retired

The bare-CLI default (no OUTFILE) moves from `<main-root>/.superpowers/ultra/`
to `<main-root>/.claude/ultrapowers/scratch/`, under the same parent ignore,
which the script creates (with the `.gitignore`) if absent. The engine never
uses the default — it always passes OUTFILE — but manual invocations keep
working and stop littering. `.superpowers/ultra` is retired; no retroactive
cleanup of existing litter in target repos (out of scope, as 6.2.0 chose).

### 5. Run-dir lifecycle

Exhaust and record are different kinds and get different treatment:

- **Exhaust** (`<runDir>/review/` — packets, regenerable forever from the
  BASE/HEAD shas recorded in the gate report): deleted by the orchestrator at
  the pre-merge gate step (SKILL.md Step 5 gains one line, after the gate
  verdict is recorded). The gate *scripts* are frozen; SKILL.md operator text
  is not, and the orchestrator session has the shell the harness script lacks.
  Green or red, the packets go — inspection at the gate uses the recorded shas.
- **Records** (transcripts, launch/args, receipts — what the viewer and
  ultralearn consume): kept. At the **start** of each run, before creating its
  own run dir, `ultra_run.py` prunes run dirs beyond the newest **10**,
  oldest first. Ten runs comfortably spans an ultralearn harvest window while
  bounding disk growth.
- **Prune safety:** the prune matches only `run-<stamp>`-patterned names
  directly under `.claude/ultrapowers/` and refuses everything else — it can
  never touch operator files, seal dirs, `scratch/`, or the in-flight run.
  Correctness never depends on either deletion: a crashed run that skipped
  its gate-step cleanup is simply removed by a later prune ("cleanup that has
  no trigger" is exactly the trap this design exists to avoid — the trigger
  here is the next run, and staleness is inert in the meantime because run
  identity is structural).

## Touch points

- `scripts/ultra_run.py` — inject `pluginRoot`/`runDir` into the launch file;
  write the parent `.gitignore`; start-of-run prune (keep 10, pattern-guarded).
- `scripts/review-package` — new default dir + parent-ignore maintenance;
  header comment rewritten (the `.superpowers/ultra` rationale is obsolete).
- `references/reviewer-prompts.md` — implementer packet instruction (absolute
  path, explicit OUTFILE, fallback branch deleted); reviewer packet-location
  wording. **Re-bake into `waves.js` per `references/workflow-template.md`;
  `tests/test_no_prompt_drift.py` stays green.**
- `harnesses/waves.js` — read `pluginRoot`/`runDir` from the launch file;
  interpolate into prompt composition.
- `skills/ultrapowers/SKILL.md` — Step 5 gains the exhaust-deletion line.

## Testing

- **pytest:** prune keeps newest 10 and never the current run; prune refuses
  non-`run-*` names (seal dirs, operator files, `scratch/`); parent
  `.gitignore` written idempotently by both writers; `review-package` default
  lands under `.claude/ultrapowers/scratch/`; launch file carries
  `pluginRoot`/`runDir`.
- **Harness sims (`tests/*.mjs`):** harness JS changes, so the suite-gate
  runs the sims — they must assert the composed prompts carry the absolute
  script path and run-dir OUTFILE, contain no repo-relative invocation and no
  script-absent fallback text, and must print the `ALL SCENARIOS PASSED`
  sentinel.
- **Prompt-drift pin:** re-bake keeps `test_no_prompt_drift.py` green.

## Out of scope (deliberate)

- **Scoped iteration-2 re-review (6.2.0's fix-loop lesson) — parked with an
  evidence gate**, not rejected: build it when a sense pass shows
  `fix-loop-exhausted` verdicts where iteration 2 failed on findings absent
  from iteration 1's list. Design sketch exists in the 2026-07-27 brainstorm;
  our cap-2 loop shows zero implementer-caused redirects across ~60 field
  tasks today, so the machinery is not yet earned.
- Stash-don't-delete snapshot restore (separate incident, separate design).
- Retroactive cleanup of `.superpowers/ultra` litter in target repos.
- Any change to the frozen verification periphery (gate scripts, sealing,
  compiler diagnostics). The gate merely stops seeing engine exhaust; its
  checks are untouched.
- End-of-life deletion of records beyond the keep-10 prune.
