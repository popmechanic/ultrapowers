---
paths:
  - "factory/**"
---

# The factory engine

The engine a fleet run gets: `fleet/fleet-bootstrap.sh` clones this repo at the launch's
`--engine` sha and execs that checkout's `factory/boot.sh` (no other engine is launchable).
Models never run git.

## Shape

- `boot.sh` prepares the clone, the plan, the verdict record and the evidence worktree, brings
  up the board, runs `engine.mjs` as one transient unit under `RuntimeMaxSec` (one clock, no
  worker caps, #1144), and publishes as shell — a push and one POST.
- `engine.mjs` is the run as search, a pool with no waves: per task `k` implementers
  (`dispatch.mjs` decides who a task waits on; `worker.mjs` is one SDK `query()` per
  dispatch), a measurement (`measure.mjs`: the task's `Run:` probes in the candidate's clone,
  then the existing tests `select.mjs` offers), selection, at most one re-dispatch
  (`retry.mjs`), a referee when `readTask` asks for one, and a fold through the kernel on every
  adoption (`fold.mjs`). Every fold re-runs every adopted task's probes and selected tests on
  the folded tree (`reverify.mjs`, #1251); the plan's `Check:` lines run on every folded tree
  with `ULTRA_BASE` (`checks-at-base.mjs` reads them once at base).
- Supporting modules: `clone.mjs` (`cloneAtBase`), `commands.mjs` (a fresh clone's bootstrap),
  `facts.mjs` / `proofs.mjs` (a task's proof lines, run), `hunks.mjs` (what Jev is shown of an
  oversized patch, #1154), `pairs.mjs` + `baseread.mjs` (the pair builder), `union.mjs` (the
  kernel's union rule), `refold.mjs` (a finished run's work folded onto a moved base),
  `kprobe.mjs` (the `dispatch.k_probe` cell), `watch.mjs` (the supervisor's questions),
  `preflight.mjs` (the boot's credential probe), `record.mjs` (the boot's renderer),
  `audit.mjs` (a finished run's final computed row). `replay/` holds landing-replay scripts
  and results.

## Judgment and policy

- **Every judgment is a question** in `questions.json`, read through `judge.mjs` (the one judge)
  over `jev-client.mjs` (one POST to TypeSafe, no key, `null` on anything unexpected).
- **Every threshold is a cell of `policy.json`** carrying its `n`, `window`, `experiment` and
  `rollback`; flipping a cell is the rollback of whatever it gates.
- **Prompts:** the implementer and resolver prompts are `roles/implement.md` and
  `roles/resolve.md`, read at dispatch — one copy, no bake step. The referee's brief is inline
  in `engine.mjs` (`REFEREE_SYSTEM`). Role-file sizes are reported (`wc -w`), never gated; the
  one surviving pin is stylistic (no shouted imperatives).

## The worker

- `tools.mjs` holds the worker's in-process tools: `note`, `hand`, `settled`, `sibling_fact`,
  `task_facts`, `run_proof`. `note` and `hand` write Kata comments through the engine's own
  client (`fleet/kata-client.mjs`, the one fleet file the engine imports).
- **The git block** is a PreToolUse hook (`makeGitHook` in `worker.mjs`), reading each Bash
  line through `gitblock.mjs`'s `findGit`; `DISALLOWED_TOOLS` is the coarse prefix list beside
  it.
- **A worker sees its own task body and nothing else** — not the plan header, not
  `## Global Constraints`, not a sibling. A literal two tasks share must be in the body of
  each, or the worker invents it (runs 192–194 lost their board to two invented Kata shapes,
  #1149, #1155).

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
