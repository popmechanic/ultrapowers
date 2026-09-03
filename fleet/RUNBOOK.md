# Fleet RUNBOOK

The operator procedure for the fleet: what to build once, what happens per
run, what each state means, how to read a failure, and how to roll back.
`fleet/CONTRACT.md` is the authority for every literal here; where the two
disagree, the contract wins. Every command below names a real file in `fleet/`.

## The shape

A run is a number N. Its plan is `plans/run-N.md` in the private
`popmechanic/fleet-runs` repository, committed by the launcher before any VM
exists. The launcher copies the golden to a fresh VM named
`fleet-r<N>-<yymmddHHMM>-<4 hex>`, attaches the run's integrations to that VM,
writes the assignment as the VM comment, waits for ssh, and starts the run:
`systemctl --user --no-block start fleet-run.service`. That unit runs an immutable
bootstrap, which reads the comment once, clones the engine at `engine=<sha>`
into `/home/exedev/engines/<sha>`, and execs that checkout's
`fleet/sandbox-boot.sh`. The boot script runs the engine as a transient user
service with a memory cap, serves a status page, commits `status.json` and the
receipts to `fleet-runs` at every transition, and — only when there is
something to publish — waits for the write grant, pushes and opens the PR.

There is no orchestrator, no control VM, and no token on any VM. The Claude
subscription and the GitHub credentials are injected at exe.dev's edge, per VM,
for a bounded window. The grant tool and the janitor read `fleet-runs`, never
a VM.

## One-time setup

`node fleet/doctor.mjs --json` says which of these you are missing;
`skills/ultrapowers/references/first-run.md` walks each row for a first-timer.

**1. The exe.dev account.** Register a key and point `~/.ssh/config` at it:

```
Host *.exe.xyz exe.dev
  StrictHostKeyChecking accept-new
  IdentitiesOnly yes
  IdentityFile ~/.ssh/id_ed25519
```

`ssh exe.dev whoami` printing your username is the whole of this step. This
account key is what `launch.mjs` and `grant.mjs` use: `integrations attach`
and `detach` need it.

A second key, tag-scoped, is the right one for anything that only reaps.
Register it with `ssh-key add --tag=fleet`. Measured 2026-09-03: such a key
sees only fleet-tagged VMs in `ls --json`, can `comment` and `rm` them, gets
"not found" for anything else, and is refused `integrations attach` and
`detach`. Put the janitor's cron behind it.

**2. The Claude subscription, as an `http-proxy` integration.** The token
goes in on stdin and never touches a VM. The `anthropic-beta` list is injected
because the proxy does not forward the client's own header:

```bash
claude setup-token > ~/.fleet-oauth-token
chmod 600 ~/.fleet-oauth-token
ssh exe.dev "integrations add http-proxy --name claude-max \
  --target https://api.anthropic.com --bearer=- \
  --header 'anthropic-beta: claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24,extended-cache-ttl-2025-04-11'" \
  < ~/.fleet-oauth-token
rm ~/.fleet-oauth-token
```

Re-capture the beta list when the Claude CLI version changes (`integrations
edit claude-max --header=…`). Rotate the token with
`integrations edit claude-max --bearer=-` and a fresh token on stdin.
`claude-max` is attached per run, per VM, `--for 6h`, never to a tag.

**3. The GitHub integrations.** One for the state channel, attached to the
tag; a pair per target repository, attached to nothing:

```bash
ssh exe.dev "integrations add github --name fleet-runs \
  --repository popmechanic/fleet-runs --act-as-user --attach tag:fleet"
ssh exe.dev "integrations add github --name t-<owner>-<repo>-ro \
  --repository <owner>/<repo> --readonly"
ssh exe.dev "integrations add github --name t-<owner>-<repo>-rw \
  --repository <owner>/<repo> --act-as-user"
```

The launcher attaches `-ro` to the run's VM for six hours; `grant.mjs`
detaches it and attaches `-rw` for fifteen minutes. The two are never on one
VM at once, and `fleet-runs` is the only GitHub integration on `tag:fleet`. A
public target needs no `-ro` object; the launcher skips the attach when there
is none. `--act-as-user` attributes pushes and PRs to you once your GitHub
account is linked on exe.dev's Integrations page; until then `gh` acts as the
installation bot, which is fine.

**4. The `fleet-runs` repository and the laptop config.** Create the private
repo `popmechanic/fleet-runs` once. The tools clone it to `fleetRuns` on first
use. `~/.ultrapowers/fleet.json` is optional; these are the defaults:

```json
{
  "golden": "fleet-golden",
  "fleetRuns": "~/.ultrapowers/fleet-runs",
  "vmTokenPath": "~/.ultrapowers/vm-token"
}
```

`vmTokenPath` holds a token from
`ssh exe.dev "ssh-key generate-api-key --vm=<vm> --exp=1h"`, which is how a
laptop script reads a VM's status page without a browser. Pass `--exp` every
time.

**5. The golden.** See §The golden.

## The golden

The image every run VM is copied from: node, bun, npm, pytest with xdist,
`busybox`, `gh`, the immutable `/home/exedev/fleet-bootstrap.sh`, the user unit
`~/.config/systemd/user/fleet-run.service` (installed, not enabled — the
launcher starts it), linger for `exedev`, and the stamp
`/home/exedev/.fleet-golden` = sha256 of `fleet/golden-setup.sh`, written last.
No engine checkout, no `ANTHROPIC_*` anywhere. The engine is cloned per run
at the sha the assignment names, so the golden goes stale only when
`golden-setup.sh` changes.

```bash
sh fleet/golden.sh build <fresh-name>     # a VM from golden-setup.sh
sh fleet/golden.sh verify <fresh-name>    # the stamp equals the script's sha
sh fleet/golden.sh swap --from <fresh-name> --to fleet-golden
```

Build under a fresh name every time: exe.dev reserves deleted VM names, so a
name is one incarnation. `verify` is not optional and `swap` is separate on
purpose: the golden in service keeps serving runs while the new one is built
and checked. Never `rm fleet-golden` to make room — a build that then fails
leaves no image at all. Never `defaults write dev.exe new.setup-script`: that
setting is account-wide.

## Per run

```bash
node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <sha>
```

The launcher, in this order: commits the plan to `fleet-runs` as
`plans/run-N.md`; `cp`s the golden to `fleet-r<N>-…`; attaches `claude-max`
and `t-<owner>-<repo>-ro` to that VM `--for 6h`; writes the comment
`run=<N> plan=<sha> target=<owner>/<repo> base=<sha> engine=<sha>`; waits up to
120 s for `ssh <ssh_dest> true`; then starts the unit over ssh. It prints the
run number, the VM name and the status URL. A refusal — an unpushed base, a
malformed target, a missing integration — exits before any lobby verb runs.

`--engine <sha>` pins the engine; the default is the public tip of this
repository, because the sandbox clones from GitHub. `--run N` overrides the
run number; `--overlap` and `--tier` ride the comment to the engine.

**Watch.** The same bytes are in two places:

- `https://<vm>.exe.xyz/status.json` — the VM's own page, port 8000 behind
  exe.dev's proxy; a browser logged in to exe.dev reads it, and so does a
  script with the VM token.
- `fleet-runs/runs/<N>/status.json` — committed at every transition, next to
  `receipt.json`, `gate-receipt.json`, `report.json`, `events.jsonl` and
  `engine.log`. `git pull` and read.

**Grant.** When the state is `awaiting-grant`:

```bash
node fleet/grant.mjs <N>
```

It pulls `fleet-runs`, requires `awaiting-grant`, finds the VM by
`ls 'fleet-r<N>-*' --json`, detaches `-ro` and attaches `-rw --for 15m`. The
sandbox then pushes `ultra/integration-run-<N>` and opens the PR: ready on
PASS, a draft carrying the gate receipt otherwise. `--live` reads the VM's own
page instead of the committed one; it needs the VM token. A grant that lapses
before the push is re-issued with the same command.

**Reap.**

```bash
node fleet/janitor.mjs
```

It pulls `fleet-runs`; for each run in `done`, `parked` or `failed` for over an
hour it `rm`s every `fleet-r<N>-*` VM; for any fleet VM whose run has had no
status update in six hours it prints a line, once. It never sshes into a VM.
Run it from cron every five minutes, or by hand. A VM that has to go now:
`ssh exe.dev "rm <vm> --json"` — `rm` takes several names.

## States

`state` in `status.json`, in order:

| state | meaning |
|---|---|
| `booting` | the bootstrap cloned the engine; the boot script is cloning the target |
| `running` | `fleet-engine-<N>.service` is active; `phase` says which wave |
| `awaiting-grant` | the engine service is inactive and the branch is ahead of base; waiting for `-rw` |
| `publishing` | `-rw` seen; pushing and opening the PR |
| `done` | PASS; `pr` is the ready PR |
| `parked` | a gate verdict other than PASS; `pr` is a draft PR, or `null` when the branch had nothing to publish |
| `failed` | a step other than the engine's verdict broke; `error` says which |

An engine exit of 1 with a gate receipt is a verdict, not a failure. A branch
zero commits ahead of base is `parked` with its evidence committed and no
grant wait, no push and no PR. A page already `done`, `parked` or `failed` is
final: restarting the unit exits 0 and opens nothing twice.

## Reading a failure

Three logs, in the order a run writes them:

1. `/home/exedev/fleet-boot.log` — the bootstrap: the comment read, the
   `engine=` parse, the clone into `/home/exedev/engines/<sha>`. A run that
   never reached `booting` is here.
2. `/home/exedev/www/engine.log` — the engine's stdout and stderr, also served
   at `https://<vm>.exe.xyz/engine.log` and committed to
   `fleet-runs/runs/<N>/engine.log`. The `claude auth status` line before the
   engine starts has to show `oauth_token`.
3. `journalctl --user -u fleet-engine-<N>` — the service's own view: OOM kills
   (`MemoryMax=40G`), the exit code, the timing.

Over ssh, the user bus needs its runtime directory named:

```bash
ssh <ssh_dest> 'XDG_RUNTIME_DIR=/run/user/$(id -u) journalctl --user -u fleet-engine-<N> --no-pager'
ssh <ssh_dest> 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user status fleet-run.service fleet-status'
```

`<ssh_dest>` is the row's `ssh_dest` from `ssh exe.dev "ls '<vm>' --json"`,
never `<vm>.exe.xyz`. The `failed` page's `error` names the step; a failure at
any step, the clone included, commits and pushes that page before exiting.

## Facts measured 2026-09-03

- exe.dev reserves a deleted VM's name for good. Never reuse one; the run
  number is the identity, the VM name is one incarnation.
- `systemd-run --wait` is refused with `--scope`. The engine is a transient
  service, and `--wait` is what makes its exit code the service's.
- An `http-proxy` integration whose `--target` is an exe.dev host is refused
  by the gateway. Peer traffic is its own integration kind.
- `gh auth status` on a VM shows no token, by design: the credential is at the
  edge. The health check is
  `GH_HOST=github.int.exe.xyz gh repo view <owner>/<repo> --json nameWithOwner`.
- `ls --json` is `{"shared_vms": [...], "vms": [...]}`. Read `.vms[]` only;
  `shared_vms` are other people's. `vm_name`, `ssh_dest`, `ssh_host` and
  `status` are documented; `comment`, `tags` and `created_at` are not, so a
  tool reads them as optional and decides nothing from `created_at`.
- `systemctl --user` and `journalctl --user` over plain ssh fail to find the
  bus until `XDG_RUNTIME_DIR=/run/user/$(id -u)` is set. The launcher sets it;
  so must you.
- The VM comment holds 200 bytes. The assignment is one line of `key=value`
  pairs and nothing else lives there.
- A tag-scoped key cannot attach or detach integrations.

## Capacity

Read the meter, never sum the allocation: `billing usage --json --range=24h`
against `billing plan --json`. The plan meters `avg_cpu_cores` and
`disk_used_bytes`, and on 2026-08-28 both read under a tenth of their limits
while the summed allocations looked oversubscribed. RAM is the binding shared
pool — about 3 GB per busy implementer — and `MemoryMax=40G` on the engine
service turns an overrun into a killed run rather than a frozen VM.

## Trust

The `awaiting-grant` state is the sandbox asserting about itself: the engine
service is inactive. That guards against an accident, not a hostile model.
What bounds a hostile model is mechanical: fifteen minutes, one repository, a
pull request rather than a merge, and a human at the merge button. Grants
lapse on wall clock with nothing to revoke. The Claude token is on no VM.

## Rollback

The lift is one release. If it does not hold:

```
/plugin marketplace update ultrapowers      # then pin 0.3.4
```

The old fleet — its orchestrator VM, its golden, its VMs — is untouched until
0.3.5 has driven several runs. Nothing in the new path writes to anything the
old path reads, so rolling the plugin back is the whole of the rollback. Reap
the old fleet by hand once the new shape has been green for a week.
