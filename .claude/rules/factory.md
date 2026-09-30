---
paths:
  - "factory/**"
---

# The engine: the Flock

There is one engine, the Flock (`flock/engine.mjs`, map #1292). `fleet/fleet-bootstrap.sh`
clones this repo at the launch's `--engine` sha and execs that checkout's `factory/boot.sh`,
which always runs the Flock. The factory, the engine before it, was retired under map #1292
rule 8; its rollback is a launch from a checkout made before the retirement. The directory
keeps the name `factory/`. Models never run git.

## Shape

- `boot.sh` prepares the clone, the plan, the verdict record and the evidence worktree, brings
  up the board, runs `flock/engine.mjs` as one transient unit under `RuntimeMaxSec` (one
  clock, #1144), and publishes as shell — a push and one POST.
- `flock/engine.mjs` is the run as a leaderless swarm: it seeds the board from the plan
  (`flock/plan.mjs`), runs an elastic pool of builder sessions that claim tasks, each on its
  own copy, keeps every copy's weave (`flock/weave.py` over the kernel's sha-pinned
  `vendor/manyana.py`), merges peers after each tool batch, and tests every published
  snapshot at the edge. A task is proved by its `Run:` probes and the plan's `Check:` lines;
  the Flock selects no existing tests. The run ends one commit ahead of `--base`.
- `flock/catchup.mjs` catches a finished run up to a moved main: it joins the run's work onto
  the new main through the weave keeper and re-runs the plan's setup, probes and check with
  `ULTRA_BASE` set to the new main; on a conflict or a red check it leaves the run's commit
  alone, so the boot opens a draft.
- Supporting modules: `flock/flock_board.mjs` (the board), `flock/kata_mirror.mjs` (board
  moves mirrored onto Kata), `flock/scope.mjs` (the scope rule, #1333), `flock/pulls.mjs`,
  `flock/edit_spans.mjs`, `flock/step_reading.mjs`, `flock/past.mjs`, `commands.mjs` (a fresh
  clone's bootstrap), `gitblock.mjs` (`findGit`, the builders' git block),
  `preflight.mjs` (the boot's credential probe), `record.mjs` (the boot's renderer),
  `audit.mjs` (a finished run's final computed row).

## Judgment and policy

- **Every judgment is a question** in `questions.json` (`flock_step`), sent over
  `jev-client.mjs` (one POST to TypeSafe, no key, `null` on anything unexpected).
- **Every threshold is a cell of `policy.json`** (`publish`, `flock`) carrying its `n`,
  `window`, `experiment` and `rollback`; flipping a cell is the rollback of whatever it gates.

## Kata (the board)

- `board.mjs` owns the board's lifecycle on the sandbox (spoke config, bind, run close; `boot.sh` only calls its CLI) and
  never fails a run; hub writes are never the run's failure, and the boot's ping is the one
  gate. `kata-credential.mjs` is the spoke's `credential_provider` helper (#983).
- The board is a Kata 0.18 spoke per sandbox, syncing through `kata-sync.int.exe.xyz` (the
  spoke's own bearer passes through untouched); the helper administers through
  `kata.int.exe.xyz`, where the edge injects the hub's. The record is rows in `events.jsonl`.
- **Seams:** every `*.int.exe.xyz` host is `https://` (an http 301, followed, turns a POST into
  a GET). A `done` close needs a ≥40-character message. `federation status --json` has no
  `status` cell: bound reads `"role":"spoke"` + `"provider_status":"ready"`, unbound
  `standalone` + `pending`; a helper exiting non-zero is logged as
  `category=hub_unavailable status=0`, which looks like a network fault and isn't.
- A byte-identical plan relaunched while its twin is live collides on the board (412, #1308);
  serialize them.

## Evidence

The boot copies `events.jsonl` into the evidence worktree every tick only when the bytes
differ (temp file + `mv`), and commits `status.json`, `events.jsonl`, `engine.log`,
`fleet-boot.log` and (when the setup script left one) `fleet-setup.log` to
`live/<owner>-<repo>/run-<N>` in the operator's evidence repository (read from
`$HOME/fleet-evidence-repo`, under `runs/<owner>-<repo>/<N>/`) every `FLEET_COMMIT_SECONDS`
(default 60) and at each transition; at the end of every run it tags `<owner>-<repo>/run-<N>`,
verifies it and deletes the live branch. No status server — git is the record.
