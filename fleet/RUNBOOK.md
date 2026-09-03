# Fleet RUNBOOK

The operator procedure for the fleet: what to build once, what happens per run,
how the golden is made, how to read capacity, what the trust boundary actually
promises, and how to roll back. It is a document, not code — every command
below names a real file in `fleet/`.

## The shape

A run's identity is its VM name. `fleet-run-<N>` is also its DNS name, its
status URL, its `comment` key, its row in `ls` and its argument to `rm`. There
is no orchestrator and no control VM. The laptop issues three lobby verbs per
run — copy the golden, attach the Claude subscription to that copy for the
run's window, write the assignment comment — and the comment is the start
signal. The target's read grant needs no verb of its own: it rides the `fleet`
tag, and the copy inherits it. The sandbox boots inert, reads its own name and
comment from Reflection, clones what it needs from GitHub through exe.dev's
GitHub integration, runs the engine under a systemd scope with the Claude token
injected at exe.dev's edge, serves its own status page, commits receipts and
evidence to the `fleet-runs` repository, posts to `notify`, waits for the write
grant, then pushes its branch and opens its own pull request. A janitor reaps
the VMs of runs that are done.

Nothing on any VM holds a secret. The two long-lived credentials are a
tag-scoped ssh key on whichever machine runs the janitor, and a VM HTTPS token
on the laptop for reading a status page.

## One-time setup

Four things, and `fleet/doctor.mjs` tells you which of them you are missing.
`skills/ultrapowers/references/first-run.md` walks each of its rows for someone
meeting the fleet for the first time; this is the short form.

**1. The exe.dev account.** Register a key, and point `~/.ssh/config` at it for
both host patterns:

```
Host *.exe.xyz exe.dev
  StrictHostKeyChecking accept-new
  IdentitiesOnly yes
  IdentityFile ~/.ssh/id_ed25519
```

`ssh exe.dev whoami` printing your username is the whole of this step.

**2. A tag-scoped key on whichever VM runs the janitor.** Register it with
`ssh-key add --tag=fleet`. Measured 2026-09-03: such a key sees only
fleet-tagged VMs in `ls --json`, can `comment` a fleet VM, gets "not found" for
anything else — and is refused `integrations attach` and `detach` outright. So
the janitor's key reaps and writes comments; the write grant stays the
laptop's act, which is where the pre-merge gate already lives. A run that
finishes while the laptop sleeps simply waits for its PR.

The janitor's cron line, every five minutes:

```
*/5 * * * * node /home/exedev/repo/fleet/janitor.mjs
```

**3. The integration objects.** Three, plus a pair per target repository:

```bash
ssh exe.dev "integrations add github --name fleet-runs \
  --repository <owner>/fleet-runs --act-as-user --attach tag:fleet"
node fleet/target.mjs add <owner>/<repo>     # creates the -ro / -rw pair
```

`notify` is enabled once from exe.dev's Integrations page and attached to
`tag:fleet`. `claude-max` is the Claude subscription as an `http-proxy`
integration, its bearer piped in on stdin and its `anthropic-beta` header
injected because the proxy does not forward the client's own; first-run.md
§integrations carries that command and the reasons behind each of its flags.

Two rules the doctor enforces, because both were paid for: a **writable**
integration is never attached to a tag, and a target's read-only and writable
grants never overlap on one VM. `fleet/target.mjs list` shows the pairs and
`fleet/target.mjs gc` reconciles `integrations list --json` against them,
because `rm` on a VM leaves integration objects behind.

**4. The golden.** `fleet/golden.sh build`, then `verify`, then `swap` — see
§The golden below.

Laptop configuration lives in `~/.ultrapowers/fleet.json`; every key is
optional:

```json
{
  "golden": "fleet-golden",
  "fleetRuns": "~/.ultrapowers/fleet-runs",
  "vmTokenPath": "~/.ultrapowers/vm-token"
}
```

Those are the defaults; the values shown are what you get with no file at all.
`fleetRuns` is a local clone of the `fleet-runs` repository, made for you on
first use. `vmTokenPath` holds a token minted with
`ssh exe.dev "ssh-key generate-api-key --vm=<vm> --exp=…"`, which is how a
laptop script reads a run's status page through the proxy without a browser.
Always pass `--exp`.

## Per run

Three commands, and none of them is an ssh into a VM.

```bash
node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <sha>
```

The launcher commits the plan and its `.gate-verdicts.json` to `fleet-runs`,
copies the golden to `fleet-run-<N>` (which inherits the `fleet` tag and with
it the read grants), attaches `claude-max` to that VM for the run's window, and
writes the assignment comment that starts it. It prints the run number and
`https://fleet-run-<N>.exe.xyz/`. A refusal — an unpushed base, a malformed
target, a missing integration — exits 2 before any lobby verb runs, so a
refused launch has changed nothing on the account.

The engine the run drives with defaults to the public tip of this repository on
GitHub, because the sandbox clones from GitHub and a commit that exists only on
your laptop is unfetchable. `--engine <sha>` pins anything else — a release
commit, or an older engine when the run is about an engine change.

Then walk away. `notify` reports gate-green, parked, failed, and the deadman.
The status page is JSON: `state` moves `booting` → `running` →
`awaiting-grant` → `publishing` → `done`, or stops at `parked` or `failed`.

```bash
node fleet/grant.mjs <N>
```

The approval act, once the phone says `awaiting-grant`. It reads the run's
state, detaches the target's read-only grant from that VM, attaches the
writable one for fifteen minutes (`--for` changes the window), and the sandbox
pushes and opens its PR. Never both grants at once.

By default it reads the `status.json` the sandbox **committed** to
`fleet-runs/runs/<N>/`, after a pull — plain git, no exe.dev token. `--live`
reads the VM's own status page over HTTPS instead, which needs a token minted
for that one VM:

```bash
ssh exe.dev "ssh-key generate-api-key --vm=fleet-run-<N> --exp=1h"
```

That per-VM minting is why the live read is not the default. Either way the run
has to be in `awaiting-grant`, which the sandbox sets only after its engine
scope is empty.

```bash
node fleet/janitor.mjs [--dry-run] [--sweep-grants]
```

Reaps. It lists fleet VMs, reads each status, `rm`s the ones that are `done` or
long-failed, and marks a run `expired` after six hours without finishing.
`--dry-run` prints what it would do; `--sweep-grants` also detaches grants left
behind. It is a cron job; run it by hand when its machine has been asleep.

If a VM must go right now:

```bash
ssh exe.dev "rm fleet-run-7 fleet-run-9 --json"
```

`rm` accepts several names at once. An orphan on exe.dev costs width and
average disk, not hourly money — the billing pool is fixed — so a janitor every
five minutes is plenty and there is nothing to page about.

## The golden

The image every sandbox is copied from. `cp` takes seconds and warm caches
multiply by concurrency, which is why the fleet copies an image rather than
building each sandbox.

`fleet/golden-setup.sh` is the whole build as one first-boot script: node,
git identity from Reflection, pytest with xdist, Bun with its symlinks and a
warmed cache, the engine clone with `npm ci` already run in `fleet/`, the
settings file, the boot unit, a transcript prune, and a stamp at
`/home/exedev/.fleet-golden` holding the script's own sha256. Over the size
limit for a setup script, `fleet/golden-bootstrap.sh` is what is actually
passed to `new` — 308 bytes that `curl` the versioned script from GitHub at a
sha. Measured 2026-09-03: thirty seconds to a built VM.

```bash
sh fleet/golden.sh build fleet-golden-next     # a fresh VM from golden-setup.sh
sh fleet/golden.sh verify fleet-golden-next    # prove it is the image the script builds
sh fleet/golden.sh swap                        # make it the image runs are copied from
```

`verify` is not optional and `swap` is separate on purpose: the golden in
service keeps serving runs while the new one is built and checked, and only the
swap changes what a launch copies. **Never `rm fleet-golden` to make room for a
rebuild** — a build that fails then leaves no image at all, and the fleet is
down until someone repairs it by hand. Build under the second name, verify it,
drive one real run on it, and only then swap. A build that fails costs a VM,
not a run.

**Never `defaults write dev.exe new.setup-script`.** That setting is
account-wide — it would apply the fleet's first-boot script to every VM you
ever create. The script is passed to the one `new` that builds the golden and
nowhere else.

Two build inputs travel with the image and have to be re-captured together when
the Claude CLI version changes: the CLI itself, and the `anthropic-beta` header
list injected by the `claude-max` integration. The golden carries no
`ANTHROPIC_*` variable anywhere; the base URL is set by the boot unit on the
engine's child process only, and the run's log line recording
`claude auth status` stays, so a run that ever reads `api_key` is caught.

The build quiesces the image before the first `cp`, because `cp` is not
promised to be application-consistent.

## Capacity — read the meter, never sum the allocation

**One command answers "do we have room":**

```bash
ssh exe.dev "billing usage --json --range=24h"   # what the plan actually meters
ssh exe.dev "billing plan  --json"               # the limits it meters against
```

**The plan meters CONSUMPTION, not allocation, and the difference is large
enough to invert a decision.** Summing `allocated_cpus` across `ls --json`
gave 31 vCPU against a `max_cpus` of 16 — an apparent 2× oversubscription that
does not exist. The meter is `avg_cpu_cores`, and it read **0.245**. Same trap
on disk: `disk_capacity_bytes` summed to 288 GB provisioned while the metered
`disk_used_bytes` was **68.9 GB** of 800 — the plan's own footnote says
*"measured as filesystem usage"*.

Reading, 2026-08-28, for scale:

| resource | metered | limit | |
|---|---|---|---|
| CPU | `avg_cpu_cores` 0.245 | `max_cpus` 16 | 1.5% |
| disk | `disk_used_bytes` 68.9 GB | `pooled_disk_gb` 800 | 8.6% |
| VMs | `vm_count` 13 | `max_vms` 50 | 26% |
| bandwidth | rx 1.1 + tx 2.3 GB | 200 GB | 1.7% |

**So exe.dev capacity has not been, and is not close to, the binding constraint
on wave width or on concurrent runs.** Do not reason about width from VM sizing
without reading this first.

**Caveat that matters for width specifically:** `avg_cpu_cores` is an average
over the billing cycle, so it proves the *account* is far from its meter and
says nothing about whether one wave saturates one sandbox. That question is
per-VM, and the instrument is:

```bash
ssh exe.dev "stat <vmName> --json --range=24h"
ssh exe.dev "billing credits usage --group=box"
```

`--range=24h` is what makes `billing usage` answer about today rather than
about the cycle average; without it the reading is smoothed past the thing you
are asking about.

**RAM is the binding shared pool, and `stat` is too coarse to govern it.**
Roughly 3 GB per busy implementer against 64 GB account-wide is about eighteen
busy implementers summed over every sandbox, and exceeding it is an OOM rather
than a slowdown. `stat` samples about every ten minutes and `billing usage` is
cycle-averaged, so neither answers the per-wave question. The instrument that
does is **PSI, read inside the sandbox**: `/proc/pressure/{cpu,memory,io}`,
sampled every ten seconds into the run's event log, with `MemoryMax` on the
engine's scope bounding the failure when the governor is too late.

## Trust

What the fleet promises, stated so it cannot be over-read.

**The empty-scope check is the sandbox asserting about itself.** Before a run
reaches `awaiting-grant` it checks that its engine's systemd scope is inactive,
and `grant.mjs` reads that state off the status page. That is protection
against an accident — a grant issued while a model is still running — and not
protection against a hostile model, which could report anything it liked.

What actually bounds a hostile model is the arrangement around it: **fifteen
minutes**, **one repository**, **a pull request rather than a merge**, and **a
human at the merge button**. Every one of those is mechanical; the scope check
is the only one that is not, and it is the one to distrust.

Two consequences worth keeping in view. Grants lapse on wall-clock and there is
nothing to revoke afterwards, so a run that stalls between gate-green and
approval simply loses its window and needs a fresh `grant.mjs`. And delivery
TTL narrows exposure, not blast radius: the Claude token is good for its year
if it is ever stolen — which is why it is on no VM, only at the edge.

## Rollback

The lift is one release. If it does not hold:

```
/plugin marketplace update ultrapowers      # then pin 0.3.4
```

The old orchestrator VM and the old golden are **untouched** until 0.3.5 has
driven several runs — the previous fleet stays running, with its own key, its
own image and its own store, so rolling the plugin back is the whole of the
rollback. Nothing in the new path writes to anything the old path reads.

Remove the old orchestrator and its golden only after the new shape has been
green across a week of runs, and reap the old fleet's VMs by hand at that
point — its reaper dies with it.
