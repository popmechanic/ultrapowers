# Fleet RUNBOOK

The operator procedure for the fleet: what to build once, what happens per
run, what each state means, how to read a failure, and how to roll back.
`fleet/CONTRACT.md` is the authority for every literal here; where the two
disagree, the contract wins. Every command below names a real file in `fleet/`.

## The shape

A run is a number N per target. The launcher validates its arguments, reads the
account pool, computes N from the target's own `ultra/*-run-*` branches and its
`ultra/{plan,evidence}/run-<N>` tags,
refreshes the Claude bearer, and pushes the plan as one commit on `base` to
`ultra/plan-run-<N>` — that commit's tree is base plus `.ultrapowers/plan.md`.
Then it issues one lobby verb, `new`, which creates a fresh VM named
`fleet-r<N>-<yymmddHHMM>-<4 hex>` with `--tag fleet`, the assignment as its
comment, and the generated setup script on stdin. The tag is what grants the
run its credentials: every fleet integration carries the attachment policy
`tag:fleet`, and `new` names no integration — exe.dev refuses `--integration`
since 2026-09-11.

The setup script installs the toolchain, the immutable bootstrap at
`/usr/local/lib/fleet/bootstrap.sh` and the unit template, then starts
`fleet-run@<N>.service` itself — there is no ssh wait and no separate start.
That unit runs the bootstrap, which reads the comment once, clones the engine at
`engine=<sha>` into `/home/exedev/engines/<sha>`, and execs that checkout's
`factory/boot.sh` or refuses — no other engine is launchable since cut two
(2026-09-21). The boot script clones the target at `base=`, checks the plan
branch's tip against the assignment, runs the engine as a transient user unit
with a memory cap — no status page, git is the record — commits its evidence
to the target on `ultra/evidence-run-<N>` at every transition, and — only when
there is something to publish — pushes `ultra/integration-run-<N>` and opens the
PR over GitHub's REST API through the edge. The PR is the human gate; there is
no approval step before it.

The three branches are where a run works, not what it leaves. At publish the
sandbox tags the plan commit `ultra/plan/run-<N>` and the final evidence commit
`ultra/evidence/run-<N>`, verifies both against the remote, and deletes
`ultra/plan-run-<N>` and `ultra/evidence-run-<N>` in the same step.
`ultra/integration-run-<N>` has three fates: a merged PR's branch goes with the
merge (delete-on-merge), a `--hold` run's stays while its PR is open, and
the retire sweep deletes one whose pull request is closed and not merged.
What a run leaves on the repository it was about is those two tags.

There is no image to keep fresh, no state repository, no orchestrator, no
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
"not found" for anything else. That is the key for a machine that only reaps by
hand.

**2. `capacity` — the ceiling a run may ask for.** `ssh exe.dev "billing plan
--json"` is the account's pool; `~/.ultrapowers/fleet.json` is the **ceiling**
one run may ask for — not the size every run gets. The file is optional, has
exactly two keys, and an unknown key is ignored:

```json
{
  "cpu": "8",
  "memory": "16GB"
}
```

Those are also the defaults. `memory` is `<int>GB` or `<int>G`; a bare number or
a fractional `1.5GB` is unreadable.

The size a run actually asks for is its PLAN's. The launcher compiles the plan
before it creates anything, takes W — the task count of the widest wave — and
asks for `min(cpu, 2 + ceil(W / 3))` vCPU and `min(memory, 2 + W)` GB, so a
one-task plan gets `--cpu 3 --memory 3GB` and a ten-task plan `--cpu 6 --memory
8GB` under a ceiling of `6`/`8GB`. `--cpu <n>` or `--memory <n>GB` on the launch
line overrides the formula outright, and either way the number is still checked
against `billing plan --json` before a VM exists.

Memory leaves that formula when the plan has state exams. Then the run is sized
by the **browsers** its widest wave may hold open at once — C, the number of
tasks in one wave whose Proof names a `tests/state-exams/` path, since each
state exam's render move opens one Chromium — and it asks for `max(6, 2 + 1.25 ×
C)` GB, still clamped by the ceiling. A Chromium with a real page on it is
0.7–1 GB, so a two-task TinyApp run wants 6 GB where `2 + W` would have bought
it 4, and an eight-task one wants 12. CPU is unchanged by C: the fixture box
that prompted this read about 1 % steal and 50 % idle, so cores were never what
ran out. A plan with **no** state exam keeps `2 + W` — pool RAM is the shared
constraint (§Capacity: read the meter, never sum the allocation), and a floor
charged to runs that open no browser would spend it on nothing. For a fleet that
runs TinyApp plans the recommended `memory` ceiling in `fleet.json` is `12GB`,
which is what an eight-browser wave asks for and the most this formula ever
wants.

The `capacity` doctor row is a report of those two facts and of nothing else:
the pool the account has, beside the `cpu` and `memory` ceiling a run is bounded
by. It divides one by the other nowhere, because allocated vCPU is
over-committable (§Capacity) and a quotient there would be a number nothing
stands behind.

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
`node fleet/claude-token.mjs refresh` before every launch, which installs the
keychain's access token on `claude-max` at every launch and rotates it first when
fewer than four hours remain and no `fleet-r*` VM is listed — so a token something
else rotated (a `usage` read meters an account by rotating it, and never installs)
is on the edge before the VM exists, and the bearer a run starts on always has the
whole run ahead of it. When a `fleet-r*` VM is listed, it never rotates, and instead
installs the current token if ninety minutes or more remain or exits without
launching if less; `status` shows the expiry.

Rotate the token with `integrations edit claude-max --bearer=-` and a fresh
token on stdin. `claude-max` reaches a run's VM by its attachment policy,
`tag:fleet`, which the `integrations` row below checks.

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

**5. `integrations` — one object per target, every object on the policy.** A
credential reaches a fleet VM by the attachment policy on its integration and by
nothing else: since 2026-09-11 exe.dev refuses `new --integration` and
`integrations attach`/`detach` ("cannot safely rewrite a singular attachment
policy"), so `claude-max` and the target's object each carry the
complete policy `tag:fleet`, and `new --tag fleet` is the grant. The row reads
each one's policy and is red for the first whose selector is anything else.

```bash
node fleet/target.mjs <owner>/<repo>
```

which runs, once, creating the object on the policy:

```bash
ssh exe.dev "integrations add github --name gh-<owner>-<repo> --repository <owner>/<repo> --act-as-user --policy 'tag:fleet'"
```

and, for an object that already exists, reads its policy and replaces it only
when the selector is not `tag:fleet` — the same two-step the doctor names for
any of the three:

```bash
ssh exe.dev "integrations policy get <name> --json"
ssh exe.dev "integrations policy set <name> 'tag:fleet' --permanent --if-revision=<revision>"
```

`--if-revision` is required and is the `revision` the get just answered, so a
policy something else changed in between is refused rather than overwritten;
`--permanent` because a legacy object's grants may carry mixed expiries, which
the set otherwise refuses to inherit.

That is the whole of the target's credential: the sandbox clones, pushes and
opens the PR through it, and the PR is the gate. Never two GitHub integrations
naming one repository on a VM: the edge routes by repo path and documents no
tie-break between them, so the sandbox refuses to boot into that (see §Traps);
two targets' objects on one VM name two repositories, which the edge routes
apart. A target with no `gh-<owner>-<repo>` object is a launch refusal, public
or not — a public repo would clone from github.com but could not publish.

**6. `kata` — the hub.** One persistent VM, `kata-hub`, running the kata issue
daemon, plus the one `http-proxy --peer` integration every sandbox reaches it
through. Built by one command, which is idempotent — on a built hub it prints
`kata-hub already built` and issues no verb, and on a half-built one it resumes:

```bash
node fleet/kata-hub.mjs
```

It issues three mutating verbs and nothing else: `new --name kata-hub --cpu 1
--memory 2GB --disk 20GB` with the rendered setup script on stdin and no tag at
all, `share port kata-hub 8000`, and

```bash
ssh exe.dev "integrations add http-proxy --name kata --target <https_url> --peer --bearer - --comment 'kata issue daemon on kata-hub' --policy 'tag:fleet'"
```

with a freshly minted 32-byte bearer on stdin. `<https_url>` is read off the
`kata-hub` row of `ls kata-hub --json`, never guessed from the VM name. It then
waits for first boot, delivers `/var/lib/kata/config.toml` and
`/etc/kata/kata.env` (`root:exedev`, 0640) over ssh, restarts the unit, waits
for `systemctl is-active kata.service` to answer `active`, and only then writes
`~/.ultrapowers/kata-hub.env` at mode 0600 with `KATA_URL` and `KATA_TOKEN`.
The hub carries no tag, so the janitor's `fleet-r*` never lists it; its comment
says so a second time. Its 1 vCPU and 2 GB come out of the same pool step 2
measures. Never `cp` the hub, or any fleet VM, without `--copy-tags=false`:
`cp --copy-tags` is on by default, so the copy inherits `tag:fleet` and with it
every credential the policy grants. Never prune the `peer-kata` ssh key
`--peer` generates: it is how a sandbox reaches the hub, and it goes when the
integration goes. A wrong policy is repaired by the same two-step as step 5,
never by `integrations attach`.

## Per run

```bash
node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <sha>
```

The launcher checks the plan against `--base` itself (`plan_check.py --base`, on `plan_parse.py` — the sandbox's own parser — after the hash pins and before any lobby verb) and refuses on anything but `PLAN OK`; the `BASE fact:` lines, the `STALE fact:` lines, the `GREEN-AT-BASE fact:` lines and the `AUTHORING fact:` line of a clean check are printed on the launch line after the engine line, in the order the compiler printed them. A `STALE fact:` line on a clean compile is an advisory — a Stale-if predicate the compiler could not read at `--base` (`STALE fact: task <id>: <entry> unreadable at BASE — <reason>`); a predicate that holds is a refusal instead, and the compiler's own `STALE fact: task <id>: <entry> holds at BASE` line comes back verbatim in it. A `GREEN-AT-BASE fact:` line is a fact this release and not a refusal — the compile still prints `PLAN OK` and exits 0 however many of them there are — and it says a Proof `Run:` line was already green on the tree at `--base`, before any worker touched it: `GREEN-AT-BASE fact: task <id>: Run: <command> — exits 0 at BASE; this line cannot falsify its clause` for a prover, `… — exits 0 at BASE; a guard, no leg cites it` for a guard, `… — not run (timeout after 30 s)` for a line the compiler gave up on, and last one `GREEN-AT-BASE fact: <S> s over <R> lines run, <T> not run (timeout)` totalling what the reads cost. Only Proof `Run:` lines are run at `--base`, never a `Check:` line, and only under `--base`: a bare `--check` prints none of this. The `AUTHORING fact:` line is what the plan cost to author — `AUTHORING fact: <minutes> min to PLAN OK, <probes> hub probes, <dispatched> gate dispatches, <rejected> rejected, routing <branch>-><lane>, <n> questions, <p>/<q> recommended picked`, `AUTHORING fact: none recorded` when the gate record carries no `authoring` key, and, for a record the compiler refused, one `AUTHORING fact: refused — <key>: <rule>` line per violation (the compile is then a refusal and those lines come back verbatim inside it) — so the cost of the plan is read beside the run it launched, without opening the record.

The launcher, in this order: validates the plan, the target and the base;
reads the pool; computes N from the target's `ultra/*-run-*` branches and its
`ultra/{plan,evidence}/run-<N>` tags; refuses when `gh-<owner>-<repo>` does not
exist; refreshes the Claude bearer; pushes the
plan as one commit on `<sha>` to `ultra/plan-run-<N>`; then issues one `new`
with the run's name, `--tag fleet` (which grants every integration on the
policy `tag:fleet` — the line names none), the assignment as `--comment`,
`--cpu`/`--memory` from the config, and the generated setup script
on stdin. It prints the run number, the VM name and the status URL. A refusal
exits before the plan branch is pushed and before any lobby verb runs.

`--engine <sha>` pins the engine; the default is the public tip of this
repository, because the sandbox clones from GitHub. `--run N` overrides the
run number.
`--hold` keeps the pull request open for a person: the sandbox publishes it
and does not merge it (a measurement run). `--again` is the one way to launch
a plan that is already live on the target: without it the launcher refuses
before anything is pushed, naming the live run and its VM (a duplicate launch
re-answers the live run's task issues on the hub and kills it, #1036).

**Watch.** There is no live page; git is the record, in one place:

- the hub, when the plan commit carried `.ultrapowers/kata.json` — the run's
  kata project holds a mirror of the run's progress, posted as comments as it
  happens. `fleet/CONTRACT.md` is the authority for what the current engine
  mirrors there. A run in flight is read off the board:

  ```bash
  node fleet/board-read.mjs --run <N> --target <owner>/<repo>
  ```

  It prints per-task state — `== now`, one line per issue of the run — then
  the event rows under `== events`, read through the same `ssh <hub> curl`
  door the janitor uses: the bearer is sourced on the hub, and the laptop's
  command line carries no token.
- `.ultrapowers/runs/<N>/status.json` on the target — committed at every
  transition and, while the engine runs, every `FLEET_COMMIT_SECONDS` (default
  60) that `events.jsonl` has changed, so the branch is at most one tick
  behind. Next to `events.jsonl`, `engine.log` and, when the plan carried
  unguarded exam files, `exams/`. Read it by tag, which
  is the one spelling that keeps working after the run's branches are gone:

  ```bash
  gh api 'repos/<owner>/<repo>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>' --jq .content | base64 -d
  ```

  While the run is still in flight the tag is not written yet, and the same
  bytes are on its evidence branch instead, so a live run is read by branch
  and, after publish, by tag — the two spellings of one read:

  ```bash
  gh api 'repos/<owner>/<repo>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>' --jq .content | base64 -d   # in flight
  gh api 'repos/<owner>/<repo>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>' --jq .content | base64 -d    # after publish
  ```

  The branch is deleted when the tag verifies (the contract's two-tags rule),
  so a watcher polling the branch sees one unreadable read at the moment the run
  finishes and reads the tag from then on.

**The PR.** There is no approval step between the gate and the PR. Once the
engine service is inactive and the branch is ahead of base, the sandbox pushes
`ultra/integration-run-<N>` and opens the PR itself, over one REST call
through the edge (`POST /api/v3/repos/<owner>/<repo>/pulls`, never `gh`):
ready on PASS or on the two-move rule's approval, a draft carrying the gate
receipt otherwise, against the target's default branch. Its body links the plan blob and the evidence tree, so
the PR is the whole index of the run. It opens with the summary the operator
signed, the answer line, the plan's Claim and one table row per task saying what
was promised and how it was proved, with the record — receipt, shas, evidence
listing and residuals checklist — folded away below. `pr` and `prAuthor` in `status.json` are
the answer's `html_url` and `user.login`.
A ready PR merges itself, on the run's own evidence and nobody else's: the
publish fold rebased the branch onto the default branch's tip and the gate then
greened the target's suite on that tree, so the sandbox squash-merges once its
gate is green and that tip is still the base's — it asks the target for no
second opinion. A base that moved buys another fold rather than another ask; a
refused merge, `--hold` on the launch line, or a gate whose suite went red on a
path no task owns leaves the PR open for you, and `status.json`'s `merged` cell
says which. A held PR's card carries a `## Held` section: what went red, the
`gh pr merge` line that finishes it, and the path to fix. A draft is yours to
merge or close. A squash-merge takes the plan's title as its subject, because the fold
commit is titled from the plan's H1 and `frontier fold wave <n>` rides its body.
A `prAuthor` that is the installation bot rather than you means
`--act-as-user` did not take — link your GitHub account on exe.dev's
Integrations page, and check the account is not a team.

**Reap.**

```bash
node fleet/janitor.mjs
```

It lists the fleet, reads each VM's comment for its run and its target, asks
the hub for that run's issue (`ssh <KATA_URL host> curl localhost:8000/api/v1/…`,
the bearer sourced on the hub — the road the launcher takes), and `rm`s every
VM whose run issue has been closed for over an hour — the `--age 1h` default:
a finished run's VM is kept for one hour so the operator has a window to look
at it before it goes, so a janitor that answers `nothing to do` beside `done`
VMs inside that hour is the hold and not a fault (six such VMs on 2026-09-15);
`--age 30m`, or `ssh exe.dev "rm <vm> --json"`, takes one sooner. When the hub
cannot be asked — no `~/.ultrapowers/kata-hub.env`, an ssh that fails — it says so on its
first line and reads each run's status page off the target with `gh api`
instead, at the evidence tag `ultra/evidence/run-<N>` first and at the branch
`ultra/evidence-run-<N>` only while the run is in flight or its sweep is
pending; a run the hub has never heard of is read that way too, and a run with
no record anywhere is left alone. Last in its report it also names, for each
target its rows carry, every `ultra/integration-run-<N>` whose highest-numbered
pull request is closed and not merged. The janitor deletes no branch — the
sweep (`node fleet/retire.mjs --target <t>`) does. It merges nothing: an
approved run merges its own pull request from the sandbox.
For any fleet VM whose run has had no update in six hours it prints a line,
once, naming where it read the age. The only ssh into a fleet VM is the unit
read of a run the record says is in flight; a unit that has died is written as
the death — the journal and the page on the evidence branch, the run issue
closed `wontfix` on the hub — and reaped an hour later. A VM that has to go now:
`ssh exe.dev "rm <vm> --json"` — `rm` takes several names.

The launcher runs it before every launch; nothing schedules it. Run it by hand
after a sleep.

## States

`state` in `status.json`, in order:

| state | meaning |
|---|---|
| `booting` | the setup script is provisioning, or the bootstrap is cloning the engine and the boot script the target |
| `running` | `fleet-engine-<N>.service` is active; `phase` says which wave |
| `publishing` | the engine service is inactive and the branch is ahead of base; evidence committed, pushing and opening the PR |
| `done` | PASS, or a verdict the two-move rule approved; `pr` is the ready PR, `prAuthor` who GitHub says opened it; merged is the squash commit's sha, or null when the PR was left open |
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

### Re-driving a parked run

A park is a verdict, not a dead end. Which of the two shapes below applies is
read off the finding, and both leave the parked branch where it is.

**The finding is fixable.** Ack it and merge the run by hand — the sandbox has
exited, and nothing merges a parked run's PR but the operator: `gh pr ready <n>`,
then `gh pr update-branch <n>` when the branch is behind main (GitHub's strict
rule refuses a behind merge; this is a GitHub merge, not the kernel's fold),
then `gh pr merge <n> --squash`. The finding is then fixed by its own run on
main, a one-task plan whose Claim is the finding. That is the shape run-54 was
re-driven by on 2026-09-08, as run-57: ready, squash-merge, then a plan for the
finding.

**The finding is not fixable.** The run is closed — its pull request closed, its
integration branch left to the retire sweep (`node fleet/retire.mjs --target
<t>`), which deletes the branch of a pull request that is closed and not merged
— and its plan re-authored, with the finding folded into the new plan's tasks. A
park with nothing mergeable, the branch zero commits ahead of base and `pr`
null, is always this case.

Either way the parked branch is a record, never a starting point:
`fleet/launch.mjs` never takes a run branch as `--base`, and refuses one with
`relaunch from main; a parked branch is re-driven as a plan on main, not as a
base`.

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
   `oauth_token`, and the line after it is the bearer probe: `bearer probe:
   alive` is the credential answering and the engine unit starting, `bearer
   probe: inconclusive (…)` is an answer the probe could not classify (curl
   failed, or a status that is neither 200 nor 401/403) and the run went ahead
   anyway. A page whose `error` begins `parked: credential` is a run that never
   started its engine at all: the class word says which side refused.
   `bearer` is the token itself — relaunch after
   `node fleet/claude-token.mjs refresh --force --account <acct>` on the box
   that holds it. `edge` is exe.dev's proxy refusing this VM, and the cell
   carries the 32-hex trace id that goes to support@exe.dev with the VM name.
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

- `claude-token.mjs usage` rotates an EXPIRED account's access token with `install: false`,
  and Anthropic's refresh grant revokes the previous token — the one the edge holds — so a
  live run dies at its next call with `401 OAuth access token has been revoked` (run-100,
  2026-09-11; run-178, 2026-09-17). While `ssh exe.dev ls` shows a `fleet-r*` VM running, the
  token is `not rotated` — by a launch, a hand `refresh --force`, or a `usage` read — and a
  launch starts on the current sign-in if `ninety minutes` or more remain, or refuses.
- `claude-token.mjs login --account <x>` rewrites `claude-max`'s bearer at once: every
  in-flight run switches to that account mid-run (run-96, 2026-09-11). Enrol a new account
  before a drain, not during one.
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

**TypeSafe.**

- The classifier is an exe.dev `http-proxy` integration named `typesafe` attached to the fleet
  policy `tag:fleet`, the same shape as `claude-max` and `kata`, and a VM reaches it at
  `https://typesafe.int.exe.xyz/v1/systemone` — `https` only, because the http form answers `301`
  and a followed 301 turns the POST into a GET and the body is lost (run-110's seam). The client
  sends no `Authorization` header: the edge injects the bearer, so no `TYPESAFE_API_KEY` is on any
  VM's disk or in any argv (measured 2026-09-16, probe `http=200 time=0.299s`).
- Jev never gates. A failed request is one `jev:` log line and nothing else — the row keeps the
  rule's `kind`, the card is written as before, and the run makes one request per residual per run
  whether it succeeded or failed (2026-09-16).

**The GitHub edge.**

- Branch protection `strict=true` enforces nothing without at least one required status
  context: with `contexts=[]` a behind PR's merge PUT is accepted (probe on a scratch repo,
  2026-09-10). Since CI was removed the sandbox checks main's tip itself before its PUT and
  folds again if it moved (decision 15); never cite `strict` as the guard.
- `integrations edit` on a GitHub integration serves the cached installation
  token for 30–60 s afterwards: a `gh pr create` twenty seconds after a binding
  produced a bot-authored PR. The grant is a standing policy the VM matches from
  creation, never something bound just-in-time; wait a minute after any edit
  before a write.
- `new --integration`, `integrations attach` and `integrations detach` are
  refused by exe.dev since 2026-09-11: one complete attachment policy per
  integration, replaced whole with `integrations policy set … --if-revision`.
  A fleet VM is granted an integration by matching that policy (`tag:fleet`),
  and by nothing the launcher does per VM. The setup script waits, bounded,
  for Reflection to list `claude-max` before starting the run, since no order
  between the policy and first boot is documented.
- `cp` of a fleet VM copies its tags by default, so the copy inherits every
  credential on the policy and the janitor's reap; take a forensic copy with
  tag copying off and re-tag deliberately.
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

- One HTTPS service per VM: `share port` sets the VM's single `proxy_port`, so a second
  service is a second VM reached through a peer integration by tag (measured 2026-09-12).
- `new` takes no positional arguments — `new --name <vm> … --setup-script /dev/stdin` — and
  a `--comment` with spaces must travel inside one ssh argument with its quotes intact, or
  the lobby reads the tail as positionals. `exe-setup.service` runs the setup script as
  `exedev`, not root: plain user commands with `sudo -n` for root steps (three papercuts of
  the ultraviz deploy, 2026-09-12; copy the launcher's verbs, never re-derive them).
- `tag -d <vm> fleet` detaches every tag-scoped integration on the VM at
  once, your own tag-scoped ssh key included. Never mid-run.
- A tag-scoped key cannot bind or unbind integrations; `launch.mjs` needs
  the account key.
- exe.dev reserves a deleted VM's name for good. Never reuse one; the run
  number is the identity and the VM name is one incarnation.
- The VM comment holds 200 bytes. The assignment is one line of `key=value`
  pairs and nothing else lives there.

**Reading the lobby.**

- exe.dev exposes nothing finer than 24 h (`stat --range=24h`, `billing usage`,
  `pool list --usage` for host-computed starvation, gated). There is no per-VM steal or
  pressure metric and no consumption refusal — over-commit degrades, never errors. The
  instrument is in-guest: `/proc/stat` steal and `/proc/pressure/{cpu,memory}` sampled
  every 5 s (Shelley, 2026-09-05).
- The evidence branch lags by a whole wave: `commit_phase_evidence` fires when the phase
  STRING changes and a wave is one string, so mid-wave the branch is frozen at
  `worker:start`. Silence is not a hang; the status page and the hub's events feed are
  live (#877).
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

**The hub.**

- Never restate a kata behaviour from memory. The `Kata facts (measured)` list
  of `fleet/CONTRACT.md` is the one record, each row carrying the version and
  the date it was read on; re-read it with
  `node fleet/tests/probe_kata_facts.mjs` after every kata upgrade and before
  any plan touching `fleet/kata-client.mjs`, and edit the rows that moved. An
  issue comment cites the list rather than restating a fact — a fact copied
  into a thread goes stale where nobody is looking.

**The laptop.**

- macOS has no `timeout`. A wait loop in a shell script gets its deadline
  from a counter, or the script is a `.mjs`.
- **A sim that names a file differing only in case from a fixture's own is a
  Mac-only red.** `makeRepo` in `fleet/tests/_engine_helpers.mjs` seeds
  `a.txt`; three sims wrote and asserted on `A.txt`, which on macOS's
  case-insensitive filesystem IS that file — git reports `a/a.txt b/a.txt`
  with `core.ignorecase=true`, so a hunk lookup for `A.txt` finds nothing, and
  a suite script reading `[ ! -f A.txt ]` is RED at BASE, which parks the run
  before a single worker is dispatched (measured 2026-09-17; the three were
  `test_run_engine_jev_finding`, `_jev_suite_red` and `_reconcile_retry`, and
  the fix renamed their paths). Name a fixture path so it differs from every
  other by more than case.
- **The laptop's python3 is older than the sandbox's, and `fromisoformat` is
  where that shows.** macOS 27 ships Python 3.9.6; the sandbox runs 3.12.3, and
  a trailing `Z` is only parsed from 3.11. `catch_report._when` handles it and
  `tests/test_catch_report.py` did not, so two legs were red on one machine and
  green on the other (2026-09-17). A test parses an instant the way the tool it
  tests does, never with a bare `datetime.fromisoformat`.
- The plugin cache's `plan_check.py` and `plan_parse.py` are not the sandbox's. The installed
  plugin on the laptop is whatever the last `plugin install` left behind, while
  the sandbox's preflight runs the engine checkout at `engine=` — main's tip
  unless `--engine` pins it — so the launcher fetches those two files at that sha for its
  check and its parse, prints `compiler=<sha>` beside the engine line, and
  refuses when it cannot fetch it rather than falling back to the cache
  (run-26, 2026-09-17).
- **The launcher renders its own setup script, and nothing fetches that one.**
  `fleet/launch.mjs` reads `fleet/setup-script.mjs` from the checkout it was
  invoked out of, so a toolchain change reaches a VM only when the launcher is
  run from a checkout at main — `node <checkout>/fleet/launch.mjs …` — or after
  the laptop's plugin is re-resolved and a new session starts. The engine is
  fetched at `engine=` and the compiler at that same sha, which makes the
  mismatch quiet: the box runs a post-change engine on a pre-change toolchain.
  Fixture run-31 lost a wave to it — celld had merged, the cache had not, and
  `/usr/local/bin/celld` was absent on a box whose engine sha was newer than
  the merge (2026-09-17). Read the rendered script before a launch that depends
  on a new tool: `node -e "import('./fleet/setup-script.mjs')…"`, or grep the
  VM's `~/fleet-setup.log` for the tool's `status booting` line.

**The sandbox's runtime.** (celld 0.5.0, measured on fleet-counsel, 2026-09-17,
an exe VM with 2 vCPU / 4 GB)

- celld's memory thresholds read root cgroup paths an exe VM does not have:
  `/sys/fs/cgroup/memory.max`, `/sys/fs/cgroup/memory.current` and the v1 path,
  none of which exist in the initial cgroup namespace, so it falls back to
  `/proc/meminfo` and its own RSS and its 80 % shed and 95 % cap never fire
  against a sibling process. A `systemd-run` scope does not change what it
  reads. Set `CELLD_MAX_RSS_MB` per instance instead — the only knob that binds
  one worker's runtime rather than the whole box.
- `celld dev` is two processes (a supervisor about 22 MB, node 41 MB idle to
  82 MB under probe load) and binds a second, INTERNAL listener on
  `127.0.0.1:0` beside the worker port, so an instance holds two loopback
  ports and a task budgets for both. Only the worker's is named, by `--port`:
  `celld dev` takes no `--internal-listen` and answers `unknown argument` to
  it (0.5.0, read 2026-09-17) — that flag belongs to a `celld` node, which
  `celld dev` spawns for itself at `127.0.0.1:0`. The internal port is
  whatever the kernel handed out; never publish or tunnel it.
- Teardown is `SIGTERM` and then a wait for the port, never a hard kill:
  SIGTERM drains in about 1.0 s, while a `SIGKILL` leaves the node child
  draining with the port still held, so the next `--port` dies on
  `Address already in use`.

**The fold kernel.**

- A NUL byte in a source file makes git diff it as binary, `is_binary` in
  `skills/ultrapowers/kernel/repo_weave.py` agrees, and every fold that touches the file parks
  with `no annotated narration for <path> (binary)` and zero resolvers — run-163's publish fold,
  2026-09-16, after run-162's implementer wrote a `'\0'` key separator into the wave engine's own
  entry source (since gone with it at cut two) as the raw byte. GitHub still merges such a PR by
  hand. Find one with `grep -Plc '\x00' fleet/*.mjs factory/*.mjs`; the fix is the escape, one byte.

**The factory's board.**

- The spoke's `credential_provider` argv is flags, not positions: `node <engine>/factory/kata-credential.mjs
  --kata-json <file> --admin-url https://kata.int.exe.xyz --state-dir <dir>`. Passed positionally the helper
  throws on an undefined path and exits 1, the daemon logs `federation config reconciliation … state=pending
  category=hub_unavailable status=0`, the helper's state directory stays empty, and the boot logs `board: … did
  not bind within 120s` — with the network and both integrations fine (run-193, 2026-09-18; #1149). Tell a dark
  hub from a dead helper from the VM: `~/.local/bin/fleet-kata --daemon hub federation identity --json` answering
  `web_session_required` means the hub was reached.
- A bound spoke is `"role":"spoke"` with `"provider_status":"ready"` in `kata federation status --json` (by hand on the VM:
  `~/.local/bin/fleet-kata federation status --json` — the boot writes that wrapper with the spoke's
  `KATA_HOME` and `KATA_SERVER` set, and it is the sandbox's only kata since #1190); there
  is no `"status"` cell to wait for. run-194's spoke reconciled one second after its daemon started and the
  boot still waited its whole 120 s on a string Kata never prints, then ran the engine without its board
  (2026-09-18; #1155). The same document answered the open measurement: `pull_cursor_event_id` moved and
  `last_successful_sync_at` was set, so the edge passes the spoke's own bearer through `kata-sync`.
- A finished factory run's VM is reported `stale … state=open — look before you rm` by the janitor, because
  the factory boot does not close the hub's run issue yet (#1150). Verify `ultra/evidence/run-<N>` with
  `git ls-remote --tags origin`, then `ssh exe.dev rm <vm>` by hand.

## Capacity

Read the meter, never sum the allocation: `billing usage --json --range=24h`
against `billing plan --json`. The plan meters `avg_cpu_cores` and
`disk_used_bytes`, and on 2026-08-28 both read under a tenth of their limits
while the summed allocations looked oversubscribed. RAM is the binding shared
pool — about 3 GB per busy implementer — and `MemoryMax=40G` on the engine
service turns an overrun into a killed run rather than a frozen VM. The
`capacity` doctor row reports rather than divides: the pool `billing plan
--json` answered, beside the `cpu` one run asks for in
`~/.ultrapowers/fleet.json`. Neither number is a width, and the row derives no
third one from them — contention bounds a wave of runs, and the doctor stands
behind only what it read.

## Trust

The `publishing` state is the sandbox asserting about itself: the engine
service is inactive before anything is pushed. That guards against an
accident, not a hostile model. What bounds a hostile model is mechanical: one
repository, six hours, a pull request the sandbox merges only when its own gate
is green and main has not moved, and `--hold` to keep a human at the merge
button. Credentials lapse on wall clock with nothing to revoke. The Claude
token is on no VM and in no argv.

## Release

Two commands before the release commit, both on the laptop. First pull the
runs since the last release off their evidence tags and count them:
`python3 skills/ultrapowers/scripts/catch_counter.py --fetch <owner>/<repo>
--runs <last tag's run + 1>..<latest> --into <dir> --ledger
docs/superpowers/observations/ledger.jsonl` — the run numbers are off
`git ls-remote --tags origin 'ultra/evidence/run-*'`, and the ledger is the
untracked laptop one, never a sandbox path. Then read it over the window:
`python3 skills/ultrapowers/scripts/catch_report.py --ledger
docs/superpowers/observations/ledger.jsonl --tree . --zero-over 1` prints a
`## Zero catches over the last 1 release(s)` section — its window line naming
the `v*` tag it opened at and how many runs fell inside it, then one
`- <path> — exercised by <k> run(s)` line per test of the tree that caught
nothing since that tag — and that section is pasted into the release commit
body as it is, beside the prose sizes. It is report-only: nothing in it deletes
anything, and deletion of a listed file follows on the reading, one file at a
time in its own pull request, as `CLAUDE.md`'s Test doctrine has it.

## Rollback

**The wave engine's removal (cut two, 2026-09-21).** The wave engine this contract and this
runbook described in detail until that date is gone — its own boot script, its per-task role
prompts, its worker and its deterministic-wave dispatch all went with it. An engine sha from
before that date is no longer launchable: the bootstrap execs the current engine's own boot
script or refuses, with nothing to fall back to. If this does not hold, the way back is to
revert that merge — the pull request that retired the wave engine for the factory, opened and
merged 2026-09-21 — which restores both the previous engine tree and this file's own text as
it read before it.

The move onto the target is one release. If it does not hold:

```
/plugin marketplace update ultrapowers      # then pin 0.3.7
```

0.3.7 is the last release of the previous shape, and rolling the plugin back is
the whole of the rollback: nothing in the new path writes anywhere the old path
read. A new-path run leaves no branch behind to clean up: its record is the two
tags, `ultra/plan/run-<N>` and `ultra/evidence/run-<N>`, and those are kept —
deleting them is deleting the run. Runs from before the tags, and runs that
ended `failed`, still have `ultra/*-run-<N>` branches on their target; the
one-time retire sweep is what clears those, never a `git push origin --delete`
by hand. It clears an integration branch too:
the retire sweep deletes one whose pull request is closed and not merged,
so that branch is no more a hand deletion than the pair is. The `--hold` run's
open PR keeps its branch, and a merged one is delete-on-merge's.
The sweep reads a pair's `status.json` on the run's evidence branch
first and touches nothing until it has: a run whose state is not terminal, or
whose integration branch still has an open pull request, prints
`run <N>: live (<why>) — skipped` and keeps its branches, so a run still in
flight is never swept out from under itself. `fleet/CONTRACT.md` names the
script it runs from.
