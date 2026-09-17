# fleet/tests

These are the fleet engine's own tests — `.mjs` suites run under `node` and
joined into the Python suite through `tests/test_fleet_suite.py`.

This file is the index a stranger reads before opening one: every
`fleet/tests/test_*.mjs` in the tree gets a line, basename first and then what
it examines. The `probe_*.mjs` files are not indexed here — they are live
measurements and design gates, and `PROBES.md` is their list.

## The engine kernel — `test_run_engine_*`

The wave scheduler, the review pairing, the fix loop, the examiner and the gate,
one sim per question:

- `test_run_engine_ready_set.mjs` — the ready set and the epoch: a task is
  dispatched the moment everything it depends on has been folded in, and a lane
  folds whatever has landed when a slot frees, instead of waiting on a wave
  barrier.
- `test_run_engine_fold_policy.mjs` — when a freed lane claims an epoch at all:
  a fold that releases a queued task, ends the run, or adopts a result that has
  aged a suite's length, with the record saying which in a `why`.
- `test_run_engine_stale_patch.mjs` — the anchor the engine hands the kernel per
  result, and the `applied` reading the record owes afterwards: `base`,
  `rebased` or `resolved` per task.
- `test_run_engine_lockfile_regen.mjs` — the capture drops lockfiles and the
  fold regenerates them: the run's lockfile is rebuilt from the merged manifests
  at each fold, and no worker is asked to merge one by hand.
- `test_run_engine_reuse.mjs` — two exams at one path: the reuse refusal naming
  the fold's own reason, and a run whose issues are already closed `done`.
- `test_run_engine_re_edge.mjs` — a task whose proof needs a sibling still in
  flight waits for that sibling and is dispatched again, instead of failing the
  run.
- `test_run_engine_joined_proofs.mjs` — the integrated pass re-runs a merged
  task's `Run:` lines only when one of that task's files appears in the fold's
  joined paths.
- `test_run_engine_own_proofs.mjs` — the implementer iterates against its own
  task's proofs: a `PROOFS:` block built from the task's `Run:` commands and the
  run's Global Constraints `Check:` commands, in place of a `TEST COMMAND:`
  line the examiner alone keeps.
- `test_run_engine_proof_runs.mjs` — the driver runs a task's `Run:` proofs
  itself, after the implementer and before the review, in the task's own clone
  through the engine's `sh` seam, and a non-zero exit sends the task back
  whatever the reviewer said.
- `test_run_engine_one_of_each.mjs` — the run's judgment economy: one referee
  per task, at most one repair round, and no critic reading the finished run.
- `test_run_engine_review_economy.mjs` — what a reviewer-minute bought, and the
  removal of the `cannotVerify` channel that bought nothing.
- `test_run_engine_infra_retry.mjs` — one bounded retry for the single-dispatch
  judgments, whose death would otherwise park or fail-close a whole run on one
  overloaded minute.
- `test_run_engine_export_collision.mjs` — a worker that adds a public name a
  sibling task was contracted to provide is told so on the driver's own
  pre-review pass, and gets the one repair round every other red of that pass
  buys.
- `test_run_engine_nul_guard.mjs` — the same pass on a patch that puts a stray
  `0x00` byte into a source file, so no later merge stalls on a file git and the
  fold kernel read as binary.
- `test_run_engine_amendments.mjs` — a worker declares an amendment and the
  driver writes the typed row onto `events.jsonl` and `report.json`, per task.
- `test_run_engine_amendment_lens.mjs` — those declared amendments rendered into
  the prompt of the referee who grades them, as a lens rather than an
  undisclosed divergence.
- `test_run_engine_state_exams.mjs` — the report row's state-exam record: the
  action wall and whether the browser ran.
- `test_run_engine_state_handshake.mjs` — the state handshake: what a task
  publishes as the state it reached, and what the driver holds against it.
- `test_run_engine_kata_close.mjs` — the engine stamps an issue with the run and
  sha that adopted it before it closes it.
- `test_run_engine_kata_landing.mjs` — a task's issue reads `landed` when the
  driver takes its result and `adopted` when it is folded, and the hook's
  `needs-human` is cleared.

## The launcher — `test_launch_*`

- `test_launch_size.mjs` — the VM is sized from the compiled plan's widest wave
  and the dispatch width is the plan's, not a process constant.
- `test_launch_bump.mjs` — a launch whose push of `ultra/plan-run-<N>` is
  refused bumps to N+1 and re-files its first payload under the number it got.
- `test_launch_duplicate.mjs` — the launcher refuses a plan already live on the
  target, names the run, and takes `--again`.
- `test_launch_compile_facts.mjs` — the launch line carries the compiler's
  `Stale-if` fact lines: an advisory beside the base facts on a clean compile,
  and the compiler's own refusal line otherwise.

## The sandbox boot — `test_sandbox_boot_*`

- `test_sandbox_boot_engine_env.mjs` — the boot starts a run's engine with no
  renderer address and reads no address file.
- `test_sandbox_boot_fold_record.mjs` — the boot copies the run's fold record —
  fold logs, conflicts index, narration, resolver briefs and replies, the weave
  sidecar's manifest and event log — onto the evidence branch beside the
  receipts, and never the weave's blob store.
- `test_sandbox_boot_kata_export.mjs` — the `kata.jsonl` on a run's evidence tag
  holds only that run's issues and events, out of a project holding every run of
  the repository.
- `test_sandbox_boot_close_evidence.mjs` — the boot's `done` close of the run
  issue always carries evidence, built from the PR URL and the merged sha.
- `test_sandbox_boot_amendments.mjs` — the pull request body lists every
  amendment by task, above the folded record.
- `test_sandbox_boot_disclosures.mjs` — an edit a task needed but could not make
  becomes a ticket the run opens beside its PR.
- `test_sandbox_boot_card_cells.mjs` — the PR card says which task no reviewer
  read, rendered inside the existing mutant cell rather than a new column.
- `test_sandbox_boot_viz.mjs` — the refresher serves `events.jsonl` beside the
  page, so the page shows the fleet turning and the record keeps up.

## The worker seam — `test_worker_*`

- `test_worker_prompt_stdin.mjs` — the worker hands every prompt to the child on
  stdin, never on argv.
- `test_worker_kata_env.mjs` — every worker session is a kata actor with its
  issue in hand.

## The singletons

- `test_publish_fold.mjs` — the publish fold writes its receipts and reads them
  back.
- `test_resolver_brief.mjs` — the publish-fold brief names its contending block
  and main's patch by path, one conflicted path per brief.
- `test_facts_block.mjs` — the matcher and the `FACTS:` renderer: which of a
  run's receipts a brief's files pick up, kept short, and rendered as nothing
  when there is nothing to say.
- `test_janitor.mjs` — the janitor's fallback, driven with `kata: null`: a run
  read off the target's own evidence when there is no hub to ask.
- `test_doctor_rows.mjs` — the doctor's `ROW_IDS`, the launcher's config keys
  and the setup script's env file, after the renderer left the laptop side.
- `test_probe_kata_facts.mjs` — the shape of `probe_kata_facts.mjs`: one line
  per fact, stamped with the hub's version.
- `test_sims_are_hermetic.mjs` — the probe below.

## The rig

- `_helpers.mjs` — the rig's environment: `simEnv()` builds the environment
  every process a sim starts runs under, so a sim sees what it was handed and
  never the box it runs on. `test_sims_are_hermetic.mjs` is the probe that
  keeps it true. `_engine_helpers.mjs`, `_lobby_helpers.mjs`,
  `_readiness_helpers.mjs` and `_sandbox_boot_helpers.mjs` are the per-family
  rigs built on it, and `fixtures/` holds what they read.
