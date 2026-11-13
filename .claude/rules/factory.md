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
  clock, #1144), then pushes the run's branch and hands the rest to `publish.mjs`: the pull
  request, the self-merge (catching up to a moved main) and the publish probe, run once after the
  engine exits, never inside it (#1441).
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
  `flock/edit_spans.mjs`, `flock/step_reading.mjs`, `flock/past.mjs`, `flock/io.mjs` (the git
  wrapper, the weave keeper client, snapshot writes, `events.jsonl` rows and the `kata.json`
  address the engine, the catch-up and `board.mjs` share), `flock/nogit/git` (the refusing git first on every builder's PATH),
  `preflight.mjs` (the boot's credential probe), `record.mjs` (the status page and PR body),
  `audit.mjs` (a finished run's final computed row).
- A builder's copy is a whole, current tree: every pull takes in every published change, and
  `flock.pulls.mode` (`flock/pulls.mjs`) narrows only what the builder is told of, a change outside
  its scope landing as a `pull` row marked `quiet` (flock-baseline run-10, 2026-11-13: a scope that
  held changes back starved a builder of a file its task needed, and the run ended a draft). A task
  reopened red is told of each same-spot insertion in its files, since the merge orders two
  insertions at one spot by their text.
- `flock/weave_store.py` is main's memory (the main-is-a-peer design, stages 1 and 2; policy
  `flock.main.mode`, `memory` or the rollback `frozen`): one stored weave per tree of the default
  branch, on the target's ref `refs/ultrapowers/weave/v1`. The engine starts every copy from the
  entry of `--base`'s tree (keeper op `memory`, row `weave:memory`) and stores the landed commit's
  entry (`store`, row `weave:store`), its lines authored `@r<N>:<task>`; `catchup.mjs` joins the
  run's entry with the moved main's (`join`, then `settle`) and falls to the three-text join only
  for a path the store does not hold; `publish.mjs` pushes the ref before every merge request (row
  `weave:push`). None of it can fail a run. Main does not yet arrive mid-run (stage 3). A tree's
  weave is built once and shared, never rebuilt from text where one is stored
  (two weaves of one text built by different routes merged back to it 0 times in 25, n=25 files,
  917 commits, 2026-11-12); a commit with no entry is replayed from the nearest stored ancestor,
  one commit at a time, so the recipe is never changed in place: a new recipe is a new ref version.

## Judgment and policy

- **Every judgment is a question** in `factory/questions.json` (the engine's two `flock_*`
  sets; the authoring sets live beside ultrawrite, #1449), sent over
  `jev-client.mjs` (one POST to TypeSafe, no key, `null` on anything unexpected).
- **Every threshold is a cell of `policy.json`** (`publish`, `flock`) carrying its `n`,
  `window`, `experiment` and `rollback`; flipping a cell is the rollback of whatever it gates.

## Kata (the board)

- The board is the Kata 0.18 hub, written directly through `kata.int.exe.xyz`, where the edge
  injects the hub's bearer; the sandbox runs no kata daemon and no credential helper. The boot
  writes the plan commit's `kata.json` to `$FLEET_HOME/plans/<run>.kata.json` and, when it is
  there, passes the engine `--kata-url`, `--kata-json` and `--kata-actor`. The record is rows in
  `events.jsonl`.
- `board.mjs` owns the run's close and marks (`boot.sh` only calls its CLI) and never fails a
  run; hub writes are never the run's failure, and the launcher's `hub.ping()` is the one gate.
- **Seams:** every `*.int.exe.xyz` host is `https://` (an http 301, followed, turns a POST into
  a GET). A `done` close needs a ≥40-character message.
- A byte-identical plan relaunched while its twin is live collides on the board (412, #1308);
  serialize them.

## Evidence

The boot copies `events.jsonl` into the evidence worktree every tick only when the bytes
differ (temp file + `mv`), and commits `status.json`, `plan.json` (the parse the engine read), `events.jsonl`, `engine.log`,
`fleet-boot.log` and (when the setup script left one) `fleet-setup.log` to
`live/<owner>-<repo>/run-<N>` in the operator's evidence repository (read from
`$HOME/fleet-evidence-repo`, under `runs/<owner>-<repo>/<N>/`) every `FLEET_COMMIT_SECONDS`
(default 60) and at each transition; at the end of every run it tags `<owner>-<repo>/run-<N>`,
verifies it and deletes the live branch. No status server — git is the record.
