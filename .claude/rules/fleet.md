---
paths:
  - "fleet/**"
---

# The fleet: launcher, VM and record

`fleet/CONTRACT.md` is the authority for every literal and `fleet/RUNBOOK.md` the operator
procedure; the contract wins. `fleet/` is laptop tools plus the VM bootstrap — the engine is
`factory/`, and the only fleet file it imports is `kata-client.mjs`. No orchestrator, no
control VM, no token on any VM or in any argv.

## A launch (`launch.mjs`, split by phase in #1307)

1. Validate: the plan's hash pins (`plan-pins.mjs`), then `plan_check.py --base` through
   `compiler.mjs`, which fetches and runs `plan_check.py` and `plan_parse.py` at `engine=`.
   Its `BASE fact:` and `STALE fact:` lines print on the launch line. The VM is sized from
   `plan_parse.py`'s widest wave. `toolchain.mjs` checks what a fresh sandbox can run.
2. Read the pool from `billing plan --json`; compute N from the target's own
   `ultra/*-run-*` branches; refresh the Claude bearer (`claude-token.mjs`).
3. Push the plan as one commit on base (tree = base + `.ultrapowers/plan.md`) to
   `ultra/plan-run-<N>`; file the run on the kata hub (`kata-file.mjs`).
4. Issue ONE lobby verb (`lobby.mjs`): `new` with VM name `fleet-r<N>-<stamp>-<rand>`,
   `--tag fleet`, the assignment as `--comment`, both integrations, `--cpu`/`--memory` from
   `~/.ultrapowers/fleet.json`, and the setup script (`setup-script.mjs`) on stdin. No image,
   no attach, no ssh wait, no explicit start.

On the VM the setup script installs the toolchain, the immutable bootstrap at
`/usr/local/lib/fleet/bootstrap.sh` and the `fleet-run@.service` template, then starts
`fleet-run@<N>.service`. The bootstrap reads the comment once, clones the engine at `engine=`
into `/home/exedev/engines/<sha>`, and execs its `factory/boot.sh` or refuses. It never
overwrites itself (run-68).

## The record

The sandbox commits evidence to `ultra/evidence-run-<N>` under `.ultrapowers/runs/<N>/`,
pushes `ultra/integration-run-<N>` and opens its own PR over REST (`prAuthor` recorded). The
PR is the gate. Publish tags `ultra/plan/run-<N>` and `ultra/evidence/run-<N>`, verifies both
with `git ls-remote --tags`, then deletes the two branches; a tag that doesn't verify keeps its
branch, and a `failed` run keeps both for the sweep. Read a past run at
`.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>`.

## The other laptop tools

- `doctor.mjs` — which of its nine rows is missing (`exe-verbs.json` feeds its verb-drift row).
- `claude-token.mjs` — the credential: loom-style OAuth, refresh token in the keychain,
  refreshed before every launch, single-flight. **Never force-rotate while a run is live** (see
  CLAUDE.md).
- `janitor.mjs` — reaps finished runs by reading each fleet VM's comment and asking the kata
  hub for the run issue's state, falling back to the target's evidence via `gh api` only when
  the hub is dark; never a VM's disk.
- `target.mjs` (the per-target integration), `board-read.mjs` (print a run's board),
  `retire.mjs` (the one-time branches-to-tags sweep), `kata-hub.mjs` + `kata-hub-setup.sh` +
  `kata.service` (build the one kata hub).
- The laptop reads the hub daemon with `ssh kata-hub.exe.xyz curl localhost:8000/api/v1/…`,
  the bearer from `~/.ultrapowers/kata-hub.env` on stdin, never on an argv.

## Tests

`ls fleet/tests/test_*.mjs` is the list: the launcher, doctor, token and board-read sims, the
factory sims (`test_factory_*`), the Jev client, and the hermeticity guard. `_helpers.mjs`,
`_boot_helpers.mjs` and `_lobby_helpers.mjs` are the rig; `probe_*.mjs` are live probes run by
hand (see `PROBES.md`).

## Traps

- The exe HTTP-proxy edge replaces `Authorization` unconditionally, with no only-if-absent
  option, so wrangler's asset-upload JWT is refused (#1312).
- A catalog user API token needs `account_id` left blank in exe's verify, or it 401s.
- Cloudflare's builder ships bun 1.2.15, which can't read a bun 1.4 lockfile: set `BUN_VERSION`.
