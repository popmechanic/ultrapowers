# Fleet RUNBOOK

The operator procedure for the fleet: what to build once, what happens per
run, what each state means, how to read a failure, and how to roll back.
`fleet/CONTRACT.md` is the authority for every literal here; where the two
disagree, the contract wins. Every command below names a real file in `fleet/`.

## The shape

A run is a number N per target. The launcher validates its arguments, reads the
account pool, computes N from the target's own `ultra/*-run-*` branches,
refreshes the Claude bearer, and pushes the plan as one commit on `base` to
`ultra/plan-run-<N>` — that commit's tree is base plus `.ultrapowers/plan.md`.
Then it issues one lobby verb, `new`, which creates a fresh VM named
`fleet-r<N>-<yymmddHHMM>-<4 hex>` carrying the run's two integrations, the
assignment as its comment, and the generated setup script on stdin.

The setup script installs the toolchain, the immutable bootstrap at
`/usr/local/lib/fleet/bootstrap.sh` and the unit template, then starts
`fleet-run@<N>.service` itself — there is no ssh wait and no separate start.
That unit runs the bootstrap, which reads the comment once, clones the engine at
`engine=<sha>` into `/home/exedev/engines/<sha>`, and execs that checkout's
`fleet/sandbox-boot.sh`. The boot script clones the target at `base=`, checks
the plan branch's tip against the assignment, runs the engine as a transient
user service with a memory cap, serves a status page, commits its evidence to
the target on `ultra/evidence-run-<N>` at every transition, and — only when
there is something to publish — pushes `ultra/integration-run-<N>` and opens the
PR over GitHub's REST API through the edge. The PR is the human gate; there is
no approval step before it.

Everything a run produced is three branches on the repository the run was
about. There is no image to keep fresh, no state repository, no orchestrator, no
control VM, and no token on any VM. The Claude subscription and the GitHub
credential are injected at exe.dev's edge, per VM, for the run's window.

## One-time setup

`node fleet/doctor.mjs --json` says which of these you are missing, one row per
step below; `skills/ultrapowers/references/first-run.md` walks each row for a
first-timer.

**1. `exe-dev` — the account.** Register a key and point `~/.ssh/config` at it:

```
Host *.exe.xyz exe.dev
  StrictHostKeyChecking accept-new
  IdentitiesOnly yes
  IdentityFile ~/.ssh/id_ed25519
```

`ssh exe.dev whoami` printing your username is the whole of this step. This
account key is what `launch.mjs` uses.

A second key, tag-scoped, is the right one for anything that only reaps.
Register it with `ssh-key add --tag=fleet`. Measured 2026-09-03: such a key
sees only fleet-tagged VMs in `ls --json`, can `comment` and `rm` them, and gets
"not found" for anything else. Put the janitor's cron behind it.

**2. `capacity` — the size of a run.** `ssh exe.dev "billing plan --json"` is
the account's pool; `~/.ultrapowers/fleet.json` is how large one run asks to be.
The file is optional, has exactly two keys, and an unknown key is ignored:

```json
{
  "cpu": "8",
  "memory": "16GB"
}
```

Those are also the defaults. `memory` is `<int>GB` or `<int>G`; a bare number or
a fractional `1.5GB` is unreadable. A pool that cannot hold a run of this size
is a run asked too large, and the launcher refuses before it touches anything.

**3. `claude` — the subscription, as an `http-proxy` integration.** The token
goes in on stdin and never touches a VM or an argv. Inject the bearer and
nothing else: the proxy forwards Claude Code's own headers, and an injected
header of the same name replaces the client's (measured 2026-09-03), so an
injected `anthropic-beta` list would destroy the flags the CLI sends.

```bash
node fleet/claude-token.mjs login --code-from-clipboard
```

That opens claude.ai for consent (the same OAuth flow Claude Code uses, with
PKCE), reads the code you copy from the callback page off the clipboard,
exchanges it, keeps the refresh token in your login keychain, and puts the
access token on `claude-max` on stdin. Nothing is printed. The launcher runs
`node fleet/claude-token.mjs refresh` before every launch, so the bearer at the
edge is never within 30 minutes of expiry when a run starts; `status` shows the
expiry.

Rotate the token with `integrations edit claude-max --bearer=-` and a fresh
token on stdin. `claude-max` rides the run's VM from creation, `--for` the run's
window, never a tag.

**4. `github` — the account link.** `ssh exe.dev "integrations setup github
--list"` prints the GitHub accounts this exe.dev account has linked. No account
means the browser step has never been walked, and every GitHub object below it
would be created against nothing:

```bash
ssh exe.dev "integrations setup github"
```

Follow what it prints. This is the link `--act-as-user` needs: until it exists,
a run's pushes and its PR are authored by the installation bot rather than by
you, and `prAuthor` on the status page says which one you got. On an exe.dev
TEAM account `--act-as-user` is unavailable, so the GitHub integration must stay
personal.

**5. `integrations` — one object per target.** Attached to nothing; the launcher
binds it to the run's VM at creation:

```bash
node fleet/target.mjs <owner>/<repo>
```

which runs, once, skipping an object that exists:

```bash
ssh exe.dev "integrations add github --name gh-<owner>-<repo> --repository <owner>/<repo> --act-as-user"
```

That is the whole of the target's credential: the sandbox clones, pushes and
opens the PR through it, and the PR is the gate. No GitHub integration ever
rides the shared tag — a tagged object is a standing grant on every fleet VM for
as long as it lives, and the doctor turns the row red for any of them. Never two
GitHub integrations naming one repository on a VM: the edge routes by repo path
and documents no tie-break between them, so the sandbox refuses to boot into
that (see §Traps). A target with no `gh-<owner>-<repo>` object is a launch
refusal, public or not — a public repo would clone from github.com but could not
publish.

## Per run

```bash
node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <sha>
```

The launcher, in this order: validates the plan, the target and the base;
reads the pool; computes N from the target's `ultra/*-run-*` branches; refuses
when `gh-<owner>-<repo>` does not exist; refreshes the Claude bearer; pushes the
plan as one commit on `<sha>` to `ultra/plan-run-<N>`; then issues one `new`
with the run's name, `--tag fleet`, the assignment as `--comment`, both
integrations, `--cpu`/`--memory` from the config, and the generated setup script
on stdin. It prints the run number, the VM name and the status URL. A refusal
exits before the plan branch is pushed and before any lobby verb runs.

`--engine <sha>` pins the engine; the default is the public tip of this
repository, because the sandbox clones from GitHub. `--run N` overrides the
run number; `--overlap` and `--tier` ride the comment to the engine.

**Watch.** The same bytes are in two places:

- `https://<vm>.exe.xyz/status.json` — the VM's own page, port 8000 behind
  exe.dev's proxy; a browser logged in to exe.dev reads it.
- `.ultrapowers/runs/<N>/status.json` on the target's `ultra/evidence-run-<N>`
  branch — committed at every transition, next to `receipt.json`,
  `gate-receipt.json`, `report.json`, `events.jsonl` and `engine.log`. Fetch the
  branch and read, or read it on GitHub.

**The PR.** There is no approval step between the gate and the PR. Once the
engine service is inactive and the branch is ahead of base, the sandbox pushes
`ultra/integration-run-<N>` and opens the PR itself, over one REST call
through the edge (`POST /api/v3/repos/<owner>/<repo>/pulls`, never `gh`):
ready on PASS or on the two-move rule's approval, a draft carrying the gate
receipt otherwise, against the target's default branch. Its body links the plan blob and the evidence tree, so
the PR is the whole index of the run. `pr` and `prAuthor` on the status page are
the answer's `html_url` and `user.login`. The PR is the gate: merge it, or close
it. A squash-merge takes the plan's title as its subject, because the fold
commit is titled from the plan's H1 and `frontier fold wave <n>` rides its body.
A `prAuthor` that is the installation bot rather than you means
`--act-as-user` did not take — link your GitHub account on exe.dev's
Integrations page, and check the account is not a team.

**Reap.**

```bash
node fleet/janitor.mjs
```

It lists the fleet, reads each VM's comment for its run and its target, reads
that run's status page off the target's evidence branch with `gh api`, and `rm`s
every VM whose run has been `done`, `parked` or `failed` for over an hour. For
any fleet VM whose run has had no status update in six hours it prints a line,
once. It never sshes into a VM. Run it from cron every five minutes, or by hand.
A VM that has to go now: `ssh exe.dev "rm <vm> --json"` — `rm` takes several
names.

## States

`state` in `status.json`, in order:

| state | meaning |
|---|---|
| `booting` | the setup script is provisioning, or the bootstrap is cloning the engine and the boot script the target |
| `running` | `fleet-engine-<N>.service` is active; `phase` says which wave |
| `publishing` | the engine service is inactive and the branch is ahead of base; evidence committed, pushing and opening the PR |
| `done` | PASS, or a verdict the two-move rule approved; `pr` is the ready PR, `prAuthor` who GitHub says opened it |
| `parked` | a gate verdict other than PASS that no `approve-receipt.json` approved; `pr` is a draft PR, or `null` when the branch had nothing to publish |
| `failed` | a step other than the engine's verdict broke; `error` says which |

An engine exit of 1 with a gate receipt is a verdict, not a failure. A branch
zero commits ahead of base is `parked` with its evidence committed and no
push and no PR. A page already `done`, `parked` or `failed` is final:
restarting the unit exits 0 and opens nothing twice.

The run unit has a state of its own, readable when the page is not:

```bash
ssh <ssh_dest> 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show fleet-run@<N>.service -p ActiveState -p SubState -p Result -p ExecMainStatus'
```

| it reads | meaning |
|---|---|
| `ActiveState=active`, `SubState=exited`, `Result=success` | done — the boot script returned 0 (`RemainAfterExit` keeps it visible) |
| `ActiveState=failed`, `ExecMainStatus=N` | crashed — the boot script exited N; the page's `error` and the journal say where |
| `ActiveState=failed`, `Result=timeout` | over budget — `RuntimeMaxSec=6h` stopped it |
| `ActiveState=inactive`, `SubState=dead` | never launched — the setup script did not reach its last step |

That reading is why the unit is a `Type=exec` template and not a oneshot
(Counsel 3, measured on exeuntu, systemd 255): a oneshot has
`TimeoutStartUSec=infinity`, ignores `RuntimeMaxSec=`, and finished reads
`inactive/dead` — the same as never started.

## Reading a failure

Four logs, in the order a run writes them:

1. `~/fleet-setup.log` — the setup script's own output, the first thing to read
   when a VM exists and nothing else does. A run that never started its unit
   died here: a package install, the user bus, or the `daemon-reload`.
2. `/home/exedev/fleet-boot.log` — the bootstrap: the comment read, the
   `engine=` parse, the clone into `/home/exedev/engines/<sha>`. A run that
   never reached `booting` on the target is here.
3. `/home/exedev/www/engine.log` — the engine's stdout and stderr, also served
   at `https://<vm>.exe.xyz/engine.log` and committed to the evidence branch.
   The `claude auth status` line before the engine starts has to show
   `oauth_token`.
4. `journalctl --user -u fleet-engine-<N>` — the service's own view: OOM kills
   (`MemoryMax=40G`), the exit code, the timing.

The run unit's own journal — the bootstrap's and the boot script's stderr,
which is where a run that died before it wrote a page left its last words —
needs no environment variable at all, because a field match asks the journal
directly instead of the user bus:

```bash
ssh <ssh_dest> 'journalctl _SYSTEMD_USER_UNIT=fleet-run@<N>.service --no-pager -n 200'
```

Over ssh, the user bus needs its runtime directory named:

```bash
ssh <ssh_dest> 'XDG_RUNTIME_DIR=/run/user/$(id -u) journalctl --user -u fleet-engine-<N> --no-pager'
ssh <ssh_dest> 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user status fleet-run@<N>.service fleet-status'
```

`<ssh_dest>` is the row's `ssh_dest` from `ssh exe.dev "ls '<vm>' --json"`,
never `<vm>.exe.xyz`. The `failed` page's `error` names the step; a failure at
any step, the clone included, commits and pushes that page before exiting.

## Traps (measured 2026-09-03/04)

Each of these cost a run, an image, or a credential. Shelley's shape for each
is in `docs/superpowers/specs/2026-09-03-fleet-on-the-grain.md` §Counsel 2–5;
on the next one, ask her before editing a script.

**The Claude proxy.**

- Editing `claude-max` is destructive by default. `integrations edit
  --clear-header` removed the bearer on the live proxy (`config_summary` read
  `(no-auth)`), and a bearer is shown as `***` and cannot be read back — it is
  unrecoverable. Every edit of `claude-max` passes `--bearer=-` again in the
  same command, with the token on stdin.
- An edit's effect is read from `integrations list --json` (`config_summary`),
  never from a request made seconds later: a throwaway proxy echoed its old
  bearer as still injected after the same `--clear-header`, and that reading
  was stale gateway cache.
- The proxy forwards Claude Code's own headers, and an injected header of the
  same name replaces the client's. Inject the bearer and nothing else; an
  injected `anthropic-beta` list destroys the flags the CLI sends and rots on
  Anthropic's schedule.
- API-key-mode Claude Code sends `x-api-key` and a `context-1m` beta flag and
  no oauth flag. A run whose requests look like that is billing somewhere
  else; `claude auth status` before the engine has to say `oauth_token`.
- An `http-proxy` integration whose `--target` is exe.dev itself is refused
  by the gateway (403 "integration not found or not attached"). Peer traffic
  is its own integration kind.

**The GitHub edge.**

- `integrations edit` on a GitHub integration serves the cached installation
  token for 30–60 s afterwards: a `gh pr create` twenty seconds after a binding
  produced a bot-authored PR. Bind the integration when the VM is created, never
  just-in-time, and wait a minute after any edit before a write.
- `--act-as-user` is unavailable on TEAM integrations. On an exe.dev team
  account every PR is authored by `exe-dev-github-integration[bot]`, so the
  GitHub integration has to stay personal.
- The aggregate host proxies only `/repos/OWNER/REPO/...`; `/user` answers
  403 from the edge itself, so `gh auth status`, `gh api user` and `gh repo
  create` cannot work through it and are not health checks. The health check
  is `GH_HOST=github.int.exe.xyz gh repo view <owner>/<repo> --json
  nameWithOwner`, or a plain read of
  `https://github.int.exe.xyz/api/v3/repos/<owner>/<repo>`.
- Two GitHub integrations naming one repo attached to one VM have no
  documented tie-break. The sandbox refuses to boot into that; never build a
  read-only/writable pair for a repo.
- `integrations setup github --verify` is account-level, not per
  integration. Ladder it: `--list`, then the one integration, then
  `--verify` — and never with a run in flight.

**Tags, keys and names.**

- `tag -d <vm> fleet` detaches every tag-scoped integration on the VM at
  once, your own tag-scoped ssh key included. Never mid-run.
- A tag-scoped key cannot bind or unbind integrations; `launch.mjs` needs
  the account key.
- exe.dev reserves a deleted VM's name for good. Never reuse one; the run
  number is the identity and the VM name is one incarnation.
- The VM comment holds 200 bytes. The assignment is one line of `key=value`
  pairs and nothing else lives there.

**Reading the lobby.**

- `ls --json` is `{"shared_vms": [...], "vms": [...]}`. Read `.vms[]` only;
  `shared_vms` are other people's, and a first-array parse hid every fleet VM
  once. `vm_name`, `ssh_dest`, `ssh_host` and `status` are documented;
  `comment`, `tags` and `created_at` are not, so a tool reads them as optional
  and decides nothing from `created_at`. Use `ssh_dest` for ssh and scp.
- Allocated vCPU is over-committable: `billing plan --json` said 16 vCPU
  while `ls --json` summed 56 allocated across 16 running VMs, and nothing
  was refused. Contention, not allocation, bounds concurrent runs — read the
  load, never the sum (§Capacity).
- A lobby verb's error comes back on stdout with exit 1 and no documented
  envelope. Print all of it.
- `defaults write dev.exe new.setup-script` is account-wide. Never set it; the
  launcher passes the script per run on stdin.

**systemd on the VM.**

- `systemctl --user` and `journalctl --user` over plain ssh fail to find the
  bus until `XDG_RUNTIME_DIR=/run/user/$(id -u)` is set (exe.dev's sshd has no
  PAM session, so nothing sets it for you). `journalctl _SYSTEMD_USER_UNIT=<unit>`
  needs neither.
- The setup script runs before the user bus is guaranteed to exist: it waits up
  to 60 s for `/run/user/$(id -u)/bus` before `daemon-reload`, or the start
  finds no bus and the VM sits idle with a `booting` page forever. The image
  lingers `exedev` itself, so the script never calls `loginctl`.
- A oneshot's `start` blocks for the unit's whole life, has
  `TimeoutStartUSec=infinity`, ignores `RuntimeMaxSec=`, and finished reads
  `inactive/dead` — the same as never started. The run unit is `Type=exec`
  for those reasons.
- `systemd-run --wait` is refused with `--scope`. The engine is a transient
  service, and `--wait` is what makes its exit code the service's.
- A boot script that re-execs over its own path is a latent corruption bug:
  bash reads by byte offset and kept the old inode. The bootstrap is immutable
  at a root-owned path and the engine directory is content-addressed.

**Asking Shelley.**

- Sol stalls on a turn that reads a file; use `--model=claude-opus-5
  --reasoning=high` for anything with a file attached. The lobby link drops on
  a long answer — read it back with `shelley client read -wait <id>` on the
  VM. On a fresh VM `shelley.service` is inactive until a lobby `shelley
  prompt` starts it; an on-VM `shelley client chat` against an inactive
  service prints a conversation id and creates nothing.

**The laptop.**

- macOS has no `timeout`. A wait loop in a shell script gets its deadline
  from a counter, or the script is a `.mjs`.

## Capacity

Read the meter, never sum the allocation: `billing usage --json --range=24h`
against `billing plan --json`. The plan meters `avg_cpu_cores` and
`disk_used_bytes`, and on 2026-08-28 both read under a tenth of their limits
while the summed allocations looked oversubscribed. RAM is the binding shared
pool — about 3 GB per busy implementer — and `MemoryMax=40G` on the engine
service turns an overrun into a killed run rather than a frozen VM. The
`capacity` doctor row divides the pool by one run's `cpu` and says how many runs
fit at once; that number is the width of a wave of runs.

## Trust

The `publishing` state is the sandbox asserting about itself: the engine
service is inactive before anything is pushed. That guards against an
accident, not a hostile model. What bounds a hostile model is mechanical: one
repository, six hours, a pull request rather than a merge, and a human at the
merge button. Credentials lapse on wall clock with nothing to revoke. The
Claude token is on no VM and in no argv.

## Rollback

The move onto the target is one release. If it does not hold:

```
/plugin marketplace update ultrapowers      # then pin 0.3.7
```

0.3.7 is the last release of the previous shape, and rolling the plugin back is
the whole of the rollback: nothing in the new path writes anywhere the old path
read. Branches a new-path run left on a target are `ultra/*-run-<N>` and are
deleted by hand, `git push origin --delete`, once you are done reading them.
