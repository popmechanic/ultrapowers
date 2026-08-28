# Fleet RUNBOOK — golden VM build and the live W1 procedure

This is the operator procedure for the §W1 "one remote run, end to end" slice
(spec: `docs/superpowers/specs/2026-08-21-width-program.md` §Phase W1). It is a
document, not code — every command below names a real file and a real exported
signature from the tasks that built it (`fleet/preflight.mjs`,
`fleet/provision.mjs`, `fleet/orchestrator.mjs`, `fleet/drive.mjs`,
`fleet/shim-main.mjs`), so it can be followed by an operator with an `exe.dev`
account and nothing else.

No step here touches `skills/ultrapowers/scripts/`, `skills/ultrapowers/kernel/`,
or `harnesses/waves.js` — the run engine is unchanged in W1 (spec line 120-122).

## Golden VM build

One hand-maintained golden VM: exeuntu + node + the ultrapowers plugin + a
warmed repo clone. **No superpowers, no credentials of any kind** — the golden
image holds nothing that could leak if a clone were ever compromised (spec
§W1a).

```bash
# 1. Create the VM. node is NOT preinstalled on exeuntu (#179 fact sheet §3),
#    so install it with a first-boot setup script rather than by hand after —
#    that keeps the golden image reproducible from one command.
cat > /tmp/fleet-golden-setup.sh <<'EOF'
#!/bin/sh
set -e
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs
EOF
ssh exe.dev "new --name=fleet-golden --cpu=8 --memory=16GB --setup-script=/tmp/fleet-golden-setup.sh --json"

# 2. Clone the repo into the exact path provision.mjs and shim-main.mjs expect
#    (fleet/shim-main.mjs: REPO_DIR = '/home/exedev/repo').
ssh fleet-golden.exe.xyz 'git clone https://github.com/popmechanic/ultrapowers.git /home/exedev/repo'
#    The engine commits inside the sandbox and the suite is pytest, so the
#    image needs a git identity and pytest (python3 ships with exeuntu):
ssh fleet-golden.exe.xyz 'git config --global user.name fleet && git config --global user.email fleet@localhost'
ssh fleet-golden.exe.xyz 'python3 -m pip install --user pytest && python3 -m pytest --version'

# 3. Install the ultrapowers plugin inside the clone (fleet/node_modules stays
#    gitignored — install fleet's own deps too, since the shim imports tinybase + ws).
ssh fleet-golden.exe.xyz 'cd /home/exedev/repo/fleet && npm install --no-audit --no-fund'
#    The plugin is addressed as <plugin>@<marketplace>; the bare name fails with
#    "Plugin not found". Register the marketplace first (it is this repo).
ssh fleet-golden.exe.xyz 'claude plugin marketplace add popmechanic/ultrapowers'
ssh fleet-golden.exe.xyz 'claude plugin install ultrapowers@ultrapowers'   # no superpowers install — deliberately absent

# 4. Warm the clone once so the first real run pays no cold cost (pyc caches,
#    plugin registry) and prove the suite actually runs in the image:
ssh fleet-golden.exe.xyz 'cd /home/exedev/repo && python3 -m pytest -q tests/test_version_sync.py'

# 5. Prune the golden's Claude transcripts before trusting the image. Every
#    `claude` invocation above (plugin install, warm-up) leaves a session
#    transcript under ~/.claude/projects; those ride into every sandbox clone
#    and land in the evidence bundle `driveOne` pulls (#197), polluting the
#    ultralearn sense corpus — six-day-old golden transcripts have been found
#    in run bundles. Repeat this after EVERY `claude plugin update` on the
#    golden (see step 6): the update session writes a transcript too.
ssh fleet-golden.exe.xyz 'rm -rf ~/.claude/projects/*'

# 6. Verify the posture before trusting the image for real runs.
ssh fleet-golden.exe.xyz 'claude --version'   # non-empty
ssh fleet-golden.exe.xyz 'nproc'              # must print 8 (the --cpu=8 above; #179 fact sheet §1)
ssh fleet-golden.exe.xyz 'test -d /home/exedev/repo/.git && echo clone-ok'
ssh fleet-golden.exe.xyz 'git -C /home/exedev/repo remote get-url origin && test -z "$(git -C /home/exedev/repo status --porcelain)" && echo clone-clean'
ssh fleet-golden.exe.xyz 'which claude-code-superpowers || echo no-superpowers-ok'
ssh fleet-golden.exe.xyz 'claude plugin list'
#    Compare the printed ultrapowers version against `.claude-plugin/plugin.json`
#    on the base ref you are about to drive, BEFORE any drive — a stale golden
#    runs an old engine; the drive's `versionStamp` leg now catches it (the shim
#    stamps the installed version, #282) but only after a whole run is spent.
#    Update with: claude plugin update ultrapowers@ultrapowers
#    (the bare name `ultrapowers` fails with "Plugin not found"), THEN prune
#    the transcripts the update session left behind — step 5 again:
ssh fleet-golden.exe.xyz 'claude plugin update ultrapowers@ultrapowers && rm -rf ~/.claude/projects/*'
```

Every real run clones this VM with `provisionRun` (`fleet/provision.mjs`), which
issues `ssh exe.dev "cp fleet-golden fleet-<runId> --json"` as its first command
— never `fleet-golden` itself, which stays untouched between runs.

## Orchestrator VM

One long-lived VM (`fleet-orchestrator`) runs the TinyBase ws-server, the
driver, and holds the only credentials in the fleet (§W1a). It is the machine
you run every drive FROM; sandboxes push their run branches back to its
checkout.

```bash
# 1. Create it (small — it never runs an engine; the sandboxes do).
ssh exe.dev "new --name=fleet-orchestrator --cpu=2 --memory=4GB --setup-script=/tmp/fleet-golden-setup.sh --json"

# 2. Its own SSH key, registered on the account SCOPED BY TAG so the key can
#    reach fleet VMs (cp/rm/stat for provisioning + teardown) but nothing else
#    on the account (#213).
ssh fleet-orchestrator.exe.xyz 'ssh-keygen -t ed25519 -N "" -C fleet-orchestrator -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub'
ssh exe.dev "ssh-key add --tag=fleet '<the printed public key>'"
ssh exe.dev "tag fleet-golden fleet"        # every fleet VM carries the tag; provisionRun copies fleet-golden, so clones inherit it
ssh fleet-orchestrator.exe.xyz 'printf "Host *.exe.xyz exe.dev\n  StrictHostKeyChecking accept-new\n  IdentitiesOnly yes\n  IdentityFile ~/.ssh/id_ed25519\n" > ~/.ssh/config && chmod 600 ~/.ssh/config'

# 3. A clone of this repo at the same path the shim expects, with fleet's deps.
ssh fleet-orchestrator.exe.xyz 'git clone https://github.com/popmechanic/ultrapowers.git /home/exedev/repo && cd /home/exedev/repo/fleet && npm install --no-audit --no-fund'
#    Before EVERY drive, bring it to the base ref you mean to drive — the driver
#    pushes the base from this checkout (drive-one.mjs --repo-dir defaults to it)
#    and the #282 versionStamp cross-check reads plugin.json from it:
ssh fleet-orchestrator.exe.xyz 'git -C /home/exedev/repo fetch -q origin && git -C /home/exedev/repo checkout -q main && git -C /home/exedev/repo pull -q --ff-only && git -C /home/exedev/repo log --oneline -1'
```

The OAuth token lands here in the next section and the GitHub token in the one
after (#368); nothing else secret lives on it.

## Engine auth — the Max subscription, delivered per run (#213)

The engine (`claude -p` inside each sandbox) bills the operator's Claude
**Max subscription**, not the hosting provider's LLM gateway. Two facts from
the Claude Code auth docs drive the setup: `claude setup-token` issues a
one-year subscription OAuth token for headless use via
`CLAUDE_CODE_OAUTH_TOKEN`, and auth precedence is
`ANTHROPIC_API_KEY` > `apiKeyHelper` > `CLAUDE_CODE_OAUTH_TOKEN` — so the
golden must carry **no** `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`
(with them present every run silently bills the provider's gateway instead;
that is how runs 1–8 burned ~$5 each of exe.dev Shelley credits).

```bash
# 1. On the operator laptop, once a year (browser flow; prints the token):
claude setup-token
#    Save the printed token to a 0600 file, e.g. ~/.secrets/fleet-claude-oauth-token.

# 2. Put it on the ORCHESTRATOR only — it holds the credentials (§W1a); the
#    golden image holds none. Never echo it into a shell history or a transcript.
scp ~/.secrets/fleet-claude-oauth-token fleet-orchestrator.exe.xyz:/home/exedev/.fleet/claude-oauth-token
ssh -n fleet-orchestrator.exe.xyz 'chmod 700 /home/exedev/.fleet && chmod 600 /home/exedev/.fleet/claude-oauth-token'

# 3. Golden settings.json: NO ANTHROPIC_* keys. Edit with jq, never a heredoc
#    overwrite (that dropped enabledPlugins once and cost a run — see #193):
ssh -n fleet-golden.exe.xyz 'f=~/.claude/settings.json; jq "del(.env.ANTHROPIC_BASE_URL, .env.ANTHROPIC_API_KEY)" $f > $f.new && mv $f.new $f && cat $f && claude plugin list | grep -c enabled'
#    expected: env keeps CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS; permissions + enabledPlugins intact; "1".
```

The driver passes the token as `engineEnv` (below). `provisionRun` delivers it
to the sandbox as `/home/exedev/fleet-env` (umask 077, same heredoc pattern as
`fleet-run.json`) and starts the shim with `set -a && . /home/exedev/fleet-env
&& set +a && nohup node …` — sourced, never on an argv, never in the image. The
shim logs `claude auth status` (`authMethod`, `subscriptionType`) to `shim.log`
right before the engine launch, so every run's pulled evidence (#197) names the
credential it rode; expect `"authMethod":"oauth"`/subscription, **not**
`"api_key"`. A sandbox only holds the token for the run's lifetime; rotate with
a fresh `setup-token` if one is ever suspected compromised.

Max usage is one 5-hour + weekly window **per user across all machines**, so
the fleet shares the operator's own window; that — not vCPU — bounds width.
There is no per-invocation spend flag; the shim's `readSessionTokens` and the
orchestrator's cap are the spend control.

## GitHub auth (#368) — the orchestrator opens the PR

The second (and last) secret in the fleet. After a run resolves, `driveOne`
pushes the fetched run branch to `origin` (GitHub) and opens the PR itself —
see §Live W1 run "The orchestrator opens the PR". That needs a **fine-grained
personal access token scoped to this one repository** with exactly
`Contents: Read and write` + `Pull requests: Read and write` (nothing else —
no `Workflows`, no org scope). It lives beside the OAuth token, on the
orchestrator only: never on the golden, never in a sandbox (the sandbox still
pushes to the orchestrator's checkout over the tunnel exactly as today and
never sees GitHub).

```bash
# 1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate:
#    Repository access: only popmechanic/ultrapowers.
#    Permissions: Contents (Read and write), Pull requests (Read and write).
#    Save the printed token to a 0600 file, e.g. ~/.secrets/fleet-github-token.

# 2. Put it on the ORCHESTRATOR only — same pattern as the OAuth token.
scp ~/.secrets/fleet-github-token fleet-orchestrator.exe.xyz:/home/exedev/.fleet/github-token
ssh -n fleet-orchestrator.exe.xyz 'chmod 700 /home/exedev/.fleet && chmod 600 /home/exedev/.fleet/github-token'

# 3. Prove it, without printing it: gh reads GH_TOKEN from the env.
ssh -n fleet-orchestrator.exe.xyz 'cd /home/exedev/repo && GH_TOKEN=$(cat /home/exedev/.fleet/github-token) gh auth status 2>&1 | grep -v token'
```

`driveOne` reads the file (`--github-token-path` overrides the path) and hands
it to `git push` and `gh pr create` **only** as the `GH_TOKEN` environment
variable of those two commands (`exec(cmd, {env})`, layered per command — never
on an argv, never exported into the driver process, never in `detail`, and
scrubbed from any command output that is recorded). The push authenticates
through `-c credential.helper='!gh auth git-credential'`, so nothing is written
to the orchestrator's git config; the clone's `origin` must stay the **https**
URL from §Orchestrator VM. A missing token file is not a failure of the run:
`detail.errors` gets `github-token missing at … — PR not opened`, the branch is
still fetched into the orchestrator checkout, and the gate read is exactly what
it would have been. Rotate by generating a new token and repeating step 2.

## Preflight

`fleet/preflight.mjs` exports `preflight({orchVm, probeVm, exec})` — the one
transport link no #179 fact demonstrated directly: VM→VM `git fetch` over SSH,
with a symmetric HTTPS `git ls-remote` fallback. Run it against the
orchestrator VM and a throwaway clone of `fleet-golden` before the first real
run:

Run from the repo root — the inline `-e` script below imports `./fleet/preflight.mjs`
by relative path, resolved against the working directory:

```bash
ssh exe.dev "cp fleet-golden fleet-preflight-probe --json"

node --input-type=module -e '
  import { preflight } from "./fleet/preflight.mjs"
  import { execFile } from "node:child_process"

  const exec = (cmd) =>
    new Promise((resolve) => {
      execFile("/bin/sh", ["-c", cmd], { maxBuffer: 10*1024*1024 }, (error, stdout, stderr) =>
        resolve({ code: error?.code ?? 0, stdout: `${stdout}${stderr}` })
      )
    })

  const result = await preflight({ orchVm: "fleet-orchestrator", probeVm: "fleet-preflight-probe", exec })
  console.log(JSON.stringify(result))
'

ssh exe.dev "rm fleet-preflight-probe --json"
```

- `verdict: 'ssh'` — proceed to the live run as designed.
- `verdict: 'https-fallback'` — the symmetric HTTPS remotes work but direct
  SSH does not; proceed, but **record `https-fallback` in the run's gate-read
  detail** (`fleet/drive.mjs`'s `detail.errors`, or a note alongside
  `reportPath`) so §W1d's read is honest about which transport carried the run.
- `verdict: 'BLOCKED'` — **stop.** Neither leg works; provisioning cannot
  deliver the base ref or pull the run branch back. Fix connectivity (exe.dev
  account/firewall/SSH key) before attempting a live run.

## Live W1 run

`fleet/drive.mjs` exports `driveOne(...)` — a library function that starts the
orchestrator, provisions a sandbox via `provisionRun`/`destroySandbox`
(`fleet/provision.mjs`), watches the run to `gate-green` or `parked`, and
writes the §W1d gate read to disk. The committed CLI `fleet/drive-one.mjs`
wraps it (#193): no throwaway script to retype, nothing left untracked in the
checkout, and it works from any cwd (the base is pushed from the checkout the
CLI lives in — `--repo-dir` overrides).

```bash
# On the orchestrator, after the "bring the clone to the base ref" step above.
# runId is unique per account lifetime — NEVER reuse one (#211); the token is
# read from /home/exedev/.fleet/claude-oauth-token (--token-path overrides) and
# travels only as engineEnv — see "Engine auth" above.
#
# Detach it from your ssh session: the remote job inherits the channel's stdin,
# so `ssh -n` alone is not enough — redirect stdin from /dev/null too, or a
# human terminal sits blocked for the whole run.
ssh -n fleet-orchestrator.exe.xyz 'cd /home/exedev/repo && nohup node fleet/drive-one.mjs docs/superpowers/plans/<the-approved-plan>.md run-<fresh> </dev/null >/tmp/drive-run-<fresh>.out 2>&1 &'

# Watch it (the shim/driver progress log rides stderr into the same file):
ssh fleet-orchestrator.exe.xyz 'tail -f /tmp/drive-run-<fresh>.out'
```

Knobs, all optional (defaults = the W2 charter constants):
`--port 8180` (any explicit port; concurrent drains take distinct ports),
`--db-dir /tmp/fleet-orch-live` (the orchestrator's per-path SQLite persister
dir; concurrent drains take distinct dirs — that separation is the W2a isolation),
`--golden fleet-golden`, `--cap-tokens 500000` (raise only on an explicit
operator call), `--ttl-hours 4` (store-token lease TTL — size to the plan's
expected wall clock with margin; a short lease expires mid-run and reads as a
heartbeat timeout, #279), `--evidence-dir DIR`, `--sandbox-cpu N` (widest wave
width + 2, clamped to the plan's max) / `--sandbox-memory 16GB` (calibrate from
`stat-<runId>.json`; golden 8/16 default), `--allow-unfit-plan` (only with a
specific operator pre-authorization for the manual-judgment task named by the
#322 refusal — never a standing default). `node fleet/drive-one.mjs` with no
arguments prints the usage line.

Two things a live run needs now live in `fleet/` proper, so the script above
needs no exec wrapper of its own:

- **Transport (#196).** exe.dev VMs share no private network and raw VM→VM TCP
  is blocked, so `provisionRun` opens an SSH reverse tunnel
  (`ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -fN -R <port>:127.0.0.1:<port> fleet-<runId>.exe.xyz`)
  after the sandbox is reachable and before the shim starts — which is what
  keeps `driveOne`'s default `wsUrl` `ws://127.0.0.1:<port>/fleet` true on both
  ends. A tunnel that fails to open throws out of `provisionRun` (the run is
  recorded red in `detail.errors`, the sandbox still torn down). `destroySandbox`
  kills the detached tunnel process after the `rm`. Every sandbox-bound ssh (and
  git-over-ssh) command carries
  `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` because sandboxes
  are ephemeral — a fresh `fleet-<runId>.exe.xyz` per run, never reused, so there
  is no host key worth pinning and a reused/recycled hostname would otherwise
  trip a stale `known_hosts` entry (#211); lobby (`exe.dev`) and golden
  (`fleet-golden.exe.xyz`) connections keep the normal host-key config. A socket
  that dies mid-engine-phase is logged once in shim.log and rescued only at the
  terminal publish — if the engine phase outlives heartbeatTimeoutMs from the
  drop, the driver times out and destroys the sandbox before the rescue can run.
  Mid-run reconnect is a W2 item.
- **Evidence before teardown (#197).** `driveOne` pulls the small sandbox
  artifacts — `shim.log`, `fleet-run.json`, `~/.claude/projects` (engine
  transcripts), and the gitignored `repo/.claude/ultrapowers/run-*/` dirs — to
  `<evidenceDir>/sandbox-logs/fleet-<runId>-<stamp>/sandbox-logs.tgz` before
  every `destroySandbox` (normal end of run and the cap-overshoot action alike),
  where `evidenceDir` defaults to `<dbDir>-evidence`. The pull is best-effort and
  bounded (`logPullTimeoutMs`, default 120 s): a failed pull lands in
  `detail.errors` and teardown proceeds. `detail.sandboxLogs` names the archive,
  or is `null`.

  On the same leg, one control-plane capture that only exists while the VM does:
  `stat <vm> --json --range=24h` → `<evidenceDir>/stat-<runId>.json`, bounded by
  its own `logPullTimeoutMs`. The raw payload is kept whether or not it parses;
  the derived read is `detail.sandboxStat` (`{peakCores, meanCores,
  peakMemBytes}`, or `null`). Every failure here — refused command, non-zero
  exit, timeout, bad JSON — lands in `detail.errors` and leaves the field
  `null`; `destroySandbox` still runs. (There is no credit-spend capture: the
  engine rides the Max subscription, and `shim.log`'s `engine auth` line is the
  per-run receipt of that route.)

  Keep `dbDir` across runs — never `rm` it; a persisted store is test-pinned safe
  (prior-run rows do not perturb a new run's gate read). Evidence lives outside it
  in `evidenceDir` (default `<dbDir>-evidence`), so a fresh-store experiment never
  deletes evidence. `detail.sandboxStat` is a floor estimate — `stat` samples every
  10 minutes.

`driveOne` requires an explicit `runId` (it refuses to run without one —
runIds are unique per account lifetime, #211) and defaults `capTokens` to
`500_000` (W2 charter constant) and `ttlMs` to 4h — pass `capTokens`/`ttlMs`
explicitly for anything unusual.
`destroySandbox` (`fleet/provision.mjs`) is
called by `driveOne` itself before it returns, so the sandbox is already torn
down by the time this script prints its output — see **Teardown guarantee**
below for the one case that still needs an operator's hand.

**Headless fitness (#322, #337).** `driveOne` refuses a plan carrying any task
whose verification can only be evidenced by human judgment — the known class
is the instruction-only doc task (`implementation` type, every Files entry a
`.md`, no `Test:` entry). run-14 proved such a task makes a `deferred:manual`
park a certainty, discovered only after ~47 min and 203k tokens. Before
dispatching: rewrite the verification into runtime/external form (add a
pinning test), or route that task to a local drain. `allowUnfitPlan: true`
(`--allow-unfit-plan`) overrides — pass it only with a specific operator
pre-authorization for that manual ack, and the override is recorded in
`detail.errors`. The plan assessed is the one **committed at `baseRef`**
(`git show <baseRef>:<planPath>`, default `HEAD`) — the same text the sandbox
executes — never the working tree. Two operator errors are refused before any
provisioning and are not covered by the override: the plan is in the working
tree but not committed at `baseRef` (`not committed at …` — commit it), or the
working-tree copy differs from the committed one (`differs between …` — commit
or discard the edit). Merge the plan and drive from a clean checkout.

**The orchestrator opens the PR (#368).** Once the run resolves and its
branch is fetched into the orchestrator checkout, `driveOne` — after teardown,
so the billing clock never waits on GitHub — pushes the fetched tip to
`origin` **as-is** (`git push origin <tip-sha>:refs/heads/<runBranch>`; merge
commits included, never rebased — a linear replay re-creates the overlap the
fold unioned, #363) and opens the PR with `gh pr create --base main --head
<runBranch> --body-file <evidenceDir>/pr-body-<runId>.md`. The body is the
gate receipt (`fleet-receipts/<runId>/gate-receipt.json`, read off the branch
at its receipt pointer) rendered: verdict, checks, acks, the five §W1d legs,
spend, `autoResolved` and the completeness-critic findings when the receipt
carries them (they live in the engine's gitignored `report.json`, which is in
the evidence bundle and not on the branch), the receipt pointers, the driver's
notes, then `Closes #N` lines from the plan header and the standard trailer.
Green → a normal PR; parked with `parkedPublish` → a **draft** PR titled
`[parked] …` with the ack list first (§Park triage). A gate-green run whose
receipts do not resolve gets NO PR (`PR not opened: gate-green but receipts
unresolvable …` in `detail.errors`) — diagnose first, per §Gate read.

The plan's **`Closes` convention** (new with #368 — no plan carried one
before): in the plan header, above the first `## ` section, a
`**Closes:** #N, #M` line (or a bare `Closes #N` line). The title's
`(#318 #319)` parenthetical and `**Spec:**` prose are references, not closes,
and are never harvested; neither is anything below the first section heading.

The result is `detail.pullRequest` — `{number, url, draft, branch}` — and the
url is stamped on the runs row (`pullRequestUrl`). Any failure (token missing,
push refused, `gh` error) lands in `detail.errors`, leaves `pullRequest`
`null`, and never touches the gate read: green stays green, parked stays
parked. The branch is still fetched locally in that case, so nothing is lost —
push and open the PR by hand from the orchestrator checkout, never from the
laptop.

**Merge is still the human's.** The orchestrator never enables auto-merge; the
operator reviews and merges on GitHub (and deletes the branch there).

This **deletes** the laptop-side integration procedure used through run-20
(2026-08-28, three times in one sitting), every step of it: `git fetch
<orchestrator> <runBranch>` onto the laptop → pin the tip as `keep/run-N` →
rebase-or-merge onto main → local test run → `gh pr create` from the laptop →
`gh pr merge --auto` → hand-delete the surviving branch — and with it the
`keep/run-N` pinning habit and the `FETCH_HEAD`-only near-loss class (#333
item 1): the branch lives on GitHub the moment the run ends. The laptop never
fetches a run branch again.

## Gate read

`driveOne` writes its return value's `read` object verbatim to `reportPath`
(default `<evidenceDir>/gate-read-<runId>.json`) — the file **is** the §W1d read,
byte for byte. Check it against the five pre-registered questions:

| Field | §W1d question |
|---|---|
| `o1` | Did provision → claim → run → gate-green → receipts complete with zero store-caused failures (nothing the guard had to converge away)? |
| `receiptsResolvable` | Does every receipt the run produced resolve at its `sha` on the fetched sandbox integration branch (the real `ultra/integration-*` branch from the sandbox, stored in `runs.<runId>.branch`, fetched for real — not simulated)? Three verification legs: (1) object existence (`git cat-file -e <sha>`), (2) reachability from the run branch (`git merge-base --is-ancestor <sha> FETCH_HEAD`), (3) path dereference in the tree (`git cat-file -e <sha>:<path>` — receipts are committed under `fleet-receipts/<runId>/` on the run branch). |
| `leaseContinuity` | Did the lease renew across the whole run with no false expiry? |
| `versionStamp` | Is the run row stamped with `pluginVersion` + `engineSha` read from the pushed base ref inside the sandbox, do they match what the driver pushed (#282), and does the plugin the sandbox reports as INSTALLED (`claude plugin list --json`, stamped as `installedPluginVersion`) match the pushed manifest? A stale golden image reds this leg with the update command in `detail.errors`. |
| `spendObservational` | `{reported, ledger}` — the run report's own token total vs. the shim's spend-row sum. **Observational at n=1 by construction** (spec §W1d, finding F6): this first run's own numbers are the input, not a pass/fail check yet. |

`o1` through `versionStamp` must all be `true`. A `false` `o1` (or a non-empty
`detail.errors` in the sibling `<reportPath minus .json>.detail.json`) means
stop and diagnose before touching the constants below — per spec, W1 failure
modes are provisioning/auth/store bugs and cost nothing to fix or abandon; the
run engine was never touched.

The sibling detail also carries `pullRequest` (#368): `{number, url, draft,
branch}` for the PR the orchestrator opened on the run branch, or `null` with
the reason in `errors`. Post the gate read on #189 **with the PR number**; the
review and the merge happen on GitHub — the run branch is never fetched to the
laptop (§Live W1 run, "The orchestrator opens the PR").

**Constants this first run sets** (spec §W1c/§W1d — "set at the W1 gate from
the first run's measured burn"), to be filled in once a `spendObservational`
reading exists and recorded here or in the docket cap config, not invented in
advance:

- **Cap defaults** — the per-run `capTokens` and the docket-wide budget cap
  (both live in the orchestrator's `budgets` table, `fleet/orchestrator.mjs`)
  should be set from `spendObservational.reported`/`.ledger` with headroom, not
  left at `driveOne`'s `2_000_000` placeholder default.
- **Anomaly multiple** — the burn-rate page (spec §W1c enforcement layer 1)
  stays inert until a trailing window of ≥5 runs exists (W2 at the earliest);
  this run only seeds the baseline it will eventually page against.
- **§W1d spend-vs-report tolerance** — the acceptable drift between
  `spendObservational.reported` and `.ledger` becomes a pass/fail bound from W2
  on; W1 only observes and records it.

## Park triage (#318)

A parked run that published receipts is not lost work. `driveOne` fetches the
parked run's integration branch exactly as it does a gate-green run's, and
reports it as `detail.parkedPublish` — `{branch, fetched: true,
receiptsResolvable, unapproved: true}`, or `null` when nothing was fetched —
in the gate-read detail. **`unapproved` means exactly that:** no standing
grant covers the branch, so merging it requires an explicit operator ack of
the parked gate receipt's `acks`. **The park card is the draft PR** (#368):
when `parkedPublish` is non-null the orchestrator has already pushed the
branch and opened a draft PR titled `[parked] …` whose body leads with the
ack list (`detail.pullRequest`, `draft: true`). Acking is marking the PR
ready for review; rejecting is closing it. Merge stays the human's, on
GitHub — no re-drive, and no laptop-side fetch/rebase/PR.

On every park, triage in this order:

1. Read `detail.parkedPublish` and `detail.pullRequest`. Non-null
   `parkedPublish` means exactly one thing (#336): the parked run's branch IS
   fetched into the orchestrator checkout (`fetched` is always `true` when
   the object exists), and `pullRequest` names the draft PR that wraps it
   (or is `null` with the push/`gh`/token reason in `errors` — then push and
   open the draft by hand from the orchestrator checkout). Review the acks
   at the top of the PR body; `receiptsResolvable` says whether every receipt
   pointer resolved on the branch. Mark ready to ack, close to reject.
2. `parkedPublish: null` → nothing survived on this side, for one of two
   reasons — the park published nothing, or the branch could not be fetched
   before teardown (`detail.errors` carries `fetch <branch> failed (code N)`
   or `unsafe branch name …`). Either way, recover via the run-14
   evidence-diff pattern: the per-task review diffs in the pulled evidence
   (`sandbox-logs.tgz`: `repo/.claude/ultrapowers/run-*/review/*.diff`)
   apply cleanly to base (PR #317 precedent); reconstruct any
   integration-only fixes from `report.json`.
3. **Harvest `report.json`'s `completenessFindings` into issues explicitly**
   — run-14's carried a real socket-leak defect that existed nowhere else.

## Teardown guarantee

`driveOne` already calls `destroySandbox({vmName, exec})` (`fleet/provision.mjs`)
before returning, which issues:

```bash
ssh exe.dev "rm fleet-<runId> --json"
```

If a run's process is killed mid-flight (operator Ctrl-C, host crash) before
that teardown leg runs, the sandbox is orphaned and still billing. Recover
manually with the same command `destroySandbox` would have issued:

```bash
ssh exe.dev "rm fleet-<runId> --json"
```

`rm` accepts multiple VM names in one call (#179 fact sheet §6) — sweep every
orphan in one shot: `ssh exe.dev "rm fleet-run-1 fleet-run-2 --json"`.

**`skills/ultrapowers/scripts/sweep_worktrees.sh` is unrelated and untouched by
any of this.** It reclaims local git worktrees on the operator's own machine
(`CLAUDE.md`: "Self-hosting a `/ultrapowers` run? Serialize them"). Fleet
sandboxes are disposable `exe.dev` VMs, not worktrees — cleaning up a stuck
sandbox is always the `ssh exe.dev "rm <vmName> --json"` command above, never
`sweep_worktrees.sh`.
