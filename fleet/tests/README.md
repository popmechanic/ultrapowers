# fleet/tests

These are the fleet engine's own tests — `.mjs` suites run under `node` and
joined into the Python suite through `tests/test_fleet_suite.py`.

This file is the index a stranger reads before opening one: every
`fleet/tests/test_*.mjs` in the tree gets a line, basename first and then what
it examines. The `probe_*.mjs` files are not indexed here — they are live
measurements and design gates, and `PROBES.md` is their list.

## What survives cut one (2026-09-18)

The sims whose only subject was the old engine, the old boot, the old worker or the
publish fold left the tree in cut one of the mow — 47 files, 32,805 lines: the 19 the
catch report read at zero catches over five or more touching runs, and the rest on the
operator's licence that a frozen subject's sims can catch nothing new. The code they
examined goes at cut two. Git history holds every one of them.

- `test_launch_duplicate.mjs` — the launcher refuses a plan already live on the
  target, names the run, and takes `--again`. Kept at zero catches over 29 runs
  (#1264, 2026-09-24): the run-number check runs on the laptop before any sandbox
  exists, and no fleet probe can launch twice, so this sim is the only alarm for the
  race that killed run-10 (2026-09-15).
- `test_worker_kata_env.mjs` — every worker session is a kata actor with its
  issue in hand.
- `test_probe_kata_facts.mjs` — the shape of `probe_kata_facts.mjs`: one line
  per fact, stamped with the hub's version.
- `test_jev_client.mjs` — the Jev client: one POST at the edge hostname with no
  `Authorization` header of its own, and `null` after one log line on every
  lane that is not an answer.
- `test_sims_are_hermetic.mjs` — the probe below.

## The singletons

- `test_board_read.mjs` — the board reader: the pure projection over a
  fixture in the hub's shape, the paging, and the ssh argv carrying the
  token's name and never a value.
- `test_factory_preflight.mjs` — the boot's credential probe: one printed classification per answer the edge can give, never a decision, and both entry guards through a symlinked `factory/`.
- `test_factory_boot.mjs` — the boot end to end against stubs: the pull
  request opened and merged, every record row stamped, the two tags on the
  origin and neither branch, and a failed engine's own exit code.
- `test_jev_questions.mjs` — the sitting's two question sets and the readers
  over the client.
- `test_factory_worker_gitblock.mjs` — the factory worker's git block: the
  whole Bash line is read, a git command word is denied, and the denial is a
  row.
- `test_factory_facts.mjs` — the landing's facts: probe and selected-test
  assertion lines attributed to the clauses they cite, the per-clause facts
  array under its cap, and the judge asking about each clause over it.
- `test_factory_record.mjs` — the boot's record module: a row with its `ts`,
  the 13-cell status page with `tasks` last, the pull request body byte for
  byte, and the policy read.
- `test_factory_retry.mjs` — the infra retry: a gateway death before the
  first turn is dispatched once more after the backoff, labelled `:retry`
  with `retry_of`, and nothing else is.
- `test_factory_board.mjs` — the board's CLI: the spoke's two files byte for
  byte, the bound-wait's local id, and the run close's Idempotency-Key order
  on a stub hub that never fails the run.
- `test_factory_tools.mjs` — the worker's in-process tools: `settled` reads its candidates off the worker's own patch at every call, a new file's exports included, and a refusal names what it found.

## The rig

- `_helpers.mjs` — the rig's environment: `simEnv()` builds the environment
  every process a sim starts runs under, so a sim sees what it was handed and
  never the box it runs on. `test_sims_are_hermetic.mjs` is the probe that
  keeps it true. `_engine_helpers.mjs`, `_lobby_helpers.mjs`,
  `_readiness_helpers.mjs` and `_sandbox_boot_helpers.mjs` are the per-family
  rigs built on it, and `fixtures/` holds what they read.
