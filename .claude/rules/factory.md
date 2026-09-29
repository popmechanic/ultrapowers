---
paths:
  - "factory/**"
---

# The engine: the Flock

There is one engine, the Flock (`factory/flock/engine.mjs`, map #1292). `fleet/fleet-bootstrap.sh`
clones this repo at the launch's `--engine` sha and execs that checkout's `factory/boot.sh`, which
always runs the Flock. The factory, the engine before it, was retired under map #1292 rule 8
(2026-09-29); its rollback is a launch run from a checkout made before the retirement. Models
never run git.

## Shape

- `boot.sh` prepares the clone, the plan, the verdict record and the evidence worktree, brings
  up the board, runs `flock/engine.mjs` as one transient unit under `RuntimeMaxSec` (one clock,
  #1144), and publishes as shell — a push and one POST.
- `flock/engine.mjs` is the run as a leaderless swarm: it seeds the board (`flock/flock_board.mjs`,
  the plan read through `flock/plan.mjs`), runs each builder's session on its own copy, keeps
  every copy's weave (`flock/weave.py`, over sha-pinned Manyana), merges peers into each copy
  after each tool batch, and tests every published snapshot at the edge with the plan's `Run:`
  probes and `Check:` lines under `ULTRA_BASE`. The builder pool is elastic.
- **Catch-up.** A run that finishes after main moved runs `flock/catchup.mjs`: the weave keeper
  joins the run's work onto the new main, the plan's setup, probes and check re-run with
  `ULTRA_BASE` set to the new main, and a conflict or a red check leaves the run's commit alone,
  so the boot opens a draft.
- Supporting modules: `commands.mjs` (a fresh clone's bootstrap), `gitblock.mjs` (`findGit`, the
  builders' git block), `flock/kata_mirror.mjs` (board moves mirrored onto Kata),
  `flock/past.mjs` (a failed previous run's items for the brief), `preflight.mjs` (the boot's
  credential probe), `record.mjs` (the boot's renderer), `audit.mjs` (a finished run's final
  computed row).

## Judgment and policy

- **Every judgment is a question** in `questions.json` (`flock_step`), read over
  `jev-client.mjs` (one POST to TypeSafe, no key, `null` on anything unexpected).
- **Every threshold is a cell of `policy.json`** (`publish`, `flock`) carrying its `n`,
  `window`, `experiment` and `rollback`; flipping a cell is the rollback of whatever it gates.

## The builder

- A builder pulls its own work from the board and publishes through the board's tools; it never
  runs git (the engine reads each Bash line through `gitblock.mjs`'s `findGit`).
- **A builder sees its own task body and the board** — not the plan header, not
  `## Global Constraints`. A literal two tasks share must be in the body of each, or the builder
  invents it (runs 192–194 lost their board to two invented Kata shapes, #1149, #1155).

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
differ (temp file + `mv`), and commits `status.json`, `events.jsonl` and `engine.log` to
`ultra/evidence-run-<N>` every `FLEET_COMMIT_SECONDS` (default 60). No status server — git is
the record.
