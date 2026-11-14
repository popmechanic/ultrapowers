---
paths:
  - "fleet/**"
---

# The fleet: launcher, VM and record

`fleet/CONTRACT.md` is the authority for every literal and `fleet/RUNBOOK.md` the operator
procedure; the contract wins. `fleet/` is laptop tools plus the VM bootstrap — the engine is
`factory/`, which imports no fleet file. No orchestrator, no
control VM, no token on any VM or in any argv.

## A launch (`launch.mjs`, split by phase in #1307)

1. Validate: the plan's hash pins (`plan-pins.mjs`), then `plan_check.py --base` through
   `compiler.mjs`, which fetches and runs `plan_check.py` and `plan_parse.py` at `engine=`.
   Its `STALE fact:`, `GREEN-AT-BASE fact:` and `AUTHORING fact:` lines print on the launch line. The VM is sized from
   `plan_parse.py`'s widest wave. `toolchain.mjs` checks what a fresh sandbox can run.
2. Read the evidence repository (`--evidence-repo`, else `"evidence"` in
   `~/.ultrapowers/fleet.json`; neither is a refusal) and the pool from `billing plan --json`;
   compute N from the evidence repository's `live/<owner>-<repo>/run-*` branches and
   `<owner>-<repo>/run-*` tags; refresh the Claude bearer (`claude-token.mjs`).
3. Push the plan as one parentless commit in the evidence repository (tree =
   `runs/<owner>-<repo>/<N>/plan.md` and its siblings) to `live/<owner>-<repo>/run-<N>`. Nothing
   else is told of the run: there is no issue board (the kata hub left on 2026-11-13).
4. Issue ONE lobby verb (`lobby.mjs`): `new` with VM name `fleet-r<N>-<stamp>-<rand>`,
   `--tag fleet`, the assignment as `--comment`, both integrations, `--cpu`/`--memory` from
   `~/.ultrapowers/fleet.json`, and the setup script (`setup-script.mjs`) on stdin. No image,
   no attach, no ssh wait, no explicit start.

On the VM the setup script writes the evidence repository to `$HOME/fleet-evidence-repo`
(the boot fails without it), installs the toolchain, the immutable bootstrap at
`/usr/local/lib/fleet/bootstrap.sh` and the `fleet-run@.service` template, then starts
`fleet-run@<N>.service`. The bootstrap reads the comment once, clones the engine at `engine=`
into `/home/exedev/engines/<sha>`, and execs its `factory/boot.sh` or refuses. It never
overwrites itself (run-68).

## The record

The record lives in the operator's evidence repository, never on the target. The sandbox
commits it to `live/<owner>-<repo>/run-<N>` under `runs/<owner>-<repo>/<N>/` every 10 s and at
each transition, pushes `ultra/integration-run-<N>` to the target (the only branch the target
receives; main's memory, `refs/ultrapowers/weave/v1`, is the one other ref, pushed by the publish
before every merge request) and opens its own PR over REST (`prAuthor` recorded). The PR is the gate. At the end of
every run (done, parked, failed) it tags the last commit `<owner>-<repo>/run-<N>`, verifies it
with `git ls-remote --tags`, then deletes the live branch; a tag that doesn't verify keeps it.
Read a past run at
`repos/<evidence repo>/contents/runs/<owner>-<repo>/<N>/status.json?ref=<owner>-<repo>/run-<N>`.

## The other laptop tools

- `doctor.mjs` — which of its ten rows is missing (the last, `reaper`, asks the hub's VM remover
  whether its exe.dev key still works and reads that key's expiry; `reaper-key.sh` renews it; `exe-verbs.json` feeds its verb-drift row;
  its `evidence` row checks the one-time evidence-repository setup).
- `claude-token.mjs` — the credential: loom-style OAuth, refresh token in the keychain,
  refreshed before every launch, single-flight. **Never force-rotate while a run is live** (see
  CLAUDE.md).
- `janitor.mjs` — reaps finished runs by reading each fleet VM's comment and then the run's
  `status.json` in the evidence repository via `gh api`, at the run's tag, else its live branch;
  never a VM's disk. A run whose page cannot be read is left alone
  and reported `unread`. It also writes the end of a dead
  or orphaned run (`failRun`, then `sealRun`), seals a run that ended with its live branch left
  and no tag, and deletes the closed-unmerged `ultra/integration-run-*` branches, all on the
  targets its rows name (`--target` adds one no VM names).
- `reaper.py` — the hub's VM remover (`reaper.service` on `kata-hub`, port 8001). A finished fleet
  VM POSTs `/reap`; it answers 202 and removes that one VM only when the run's `status.json` at
  its tag in the evidence repository says `done`, read through the read-only integration
  `evidence-read` (attached to `vm:kata-hub` and to the viewer's `vm:ultraviz`, never to the tag). `/etc/reaper/reaper.env` on the hub holds `REAPER_EVIDENCE_REPO`. The hub VM
  keeps its name from the days it ran the kata daemon. Unit tests: `tests/test_reaper.py`.
- `target.mjs` (the per-repository integration, targets and the evidence repository alike),
  `run-read.mjs` (print a run from its evidence record: every claim, give-back, objection,
  conflict, move of main and the pull request; `--follow` watches it; `projectRun` answers plain
  data for any other reader).
- Kata is gone (2026-11-13): no `kata-client.mjs`, `kata-file.mjs`, `kata-hub.mjs`, `board-read.mjs`
  or `fleet/policy.json`, and no tool reads `~/.ultrapowers/kata-hub.env`. `fleet/CONTRACT.md`
  §The hub VM lists what left; the way back is a checkout made before it.

## Tests

`ls fleet/tests/test_*.mjs` is the list: the launcher, doctor, token and run-read sims, the
factory sims (`test_factory_*`), the Flock's scripted runs (`test_flock_*`), the Jev client, and
the hermeticity guard. `_helpers.mjs`, `_boot_helpers.mjs`, `_lobby_helpers.mjs` and
`_flock_helpers.mjs` are the rig; `probe_*.mjs` are live probes and the Bun `*_probe.mjs` files
are run by hand (see `PROBES.md`).

## Traps

- The exe HTTP-proxy edge replaces `Authorization` unconditionally, with no only-if-absent
  option, so wrangler's asset-upload JWT is refused (#1312).
- A catalog user API token needs `account_id` left blank in exe's verify, or it 401s.
- Cloudflare's builder ships bun 1.2.15, which can't read a bun 1.4 lockfile: set `BUN_VERSION`.
