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
ssh fleet-golden.exe.xyz 'git clone https://git.example/ultrapowers /home/exedev/repo'

# 3. Install the ultrapowers plugin inside the clone (fleet/node_modules stays
#    gitignored — install fleet's own deps too, since the shim imports tinybase + ws).
ssh fleet-golden.exe.xyz 'cd /home/exedev/repo/fleet && npm install --no-audit --no-fund'
ssh fleet-golden.exe.xyz 'claude plugin install ultrapowers'   # no superpowers install — deliberately absent

# 4. Verify the posture before trusting the image for real runs.
ssh fleet-golden.exe.xyz 'claude --version'   # non-empty
ssh fleet-golden.exe.xyz 'nproc'              # must print 8 (the --cpu=8 above; #179 fact sheet §1)
ssh fleet-golden.exe.xyz 'test -d /home/exedev/repo/.git && echo clone-ok'
ssh fleet-golden.exe.xyz 'which claude-code-superpowers || echo no-superpowers-ok'
ssh fleet-golden.exe.xyz 'claude plugin list'
#    Compare the printed ultrapowers version against `.claude-plugin/plugin.json`
#    on the base ref you are about to drive, BEFORE any drive — a stale golden
#    silently runs an old engine and nothing else here will catch it (#282).
#    Update with: claude plugin update ultrapowers@ultrapowers
#    (the bare name `ultrapowers` fails with "Plugin not found").
```

Every real run clones this VM with `provisionRun` (`fleet/provision.mjs`), which
issues `ssh exe.dev "cp fleet-golden fleet-<runId> --json"` as its first command
— never `fleet-golden` itself, which stays untouched between runs.

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

`fleet/drive.mjs` exports `driveOne({planPath, golden, port, dbDir, repoDir, exec, ...})`
(`fleet/drive.mjs`) — it is a library function, not a CLI; it starts the
orchestrator, provisions a sandbox via `provisionRun`/`destroySandbox`
(`fleet/provision.mjs`), watches the run to `gate-green` or `parked`, and
writes the §W1d gate read to disk. Drive it with a short script:

Run from the repo root — the throwaway script below imports `./fleet/drive.mjs`
by relative path, so it must sit next to `fleet/`:

```bash
cat > fleet-drive-one.tmp.mjs <<'EOF'
import { execFile } from 'node:child_process'
import { driveOne } from './fleet/drive.mjs'

const exec = (cmd) =>
  new Promise((resolve) => {
    execFile('/bin/sh', ['-c', cmd], { maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) =>
      resolve({ code: error?.code ?? 0, stdout: `${stdout}${stderr}` })
    )
  })

import fs from 'node:fs'
// The subscription OAuth token lives ONLY on the orchestrator (0600); it is
// read here and delivered per run by provisionRun — see "Engine auth" above.
const CLAUDE_CODE_OAUTH_TOKEN = fs.readFileSync('/home/exedev/.fleet/claude-oauth-token', 'utf8').trim()

const { read, reportPath, detailPath } = await driveOne({
  planPath: process.argv[2],          // e.g. docs/superpowers/plans/some-approved-plan.md
  golden: 'fleet-golden',
  port: 8180,                          // any explicit port works; the fleet tests bind ephemeral ports (port 0)
  dbDir: '/tmp/fleet-orch-live',       // orchestrator's per-path SQLite persister dir
  repoDir: process.cwd(),              // local checkout the base is pushed from
  exec,
  engineEnv: { CLAUDE_CODE_OAUTH_TOKEN },
  runId: 'run-<fresh>',                // unique per account lifetime — NEVER reuse a runId (#211)
  capTokens: 500_000,           // W2 charter constant (from measured burn); raise only on an explicit operator call
  ttlMs: 4 * 60 * 60 * 1000,
  // ttlMs = store-token lease TTL. Size to the plan's expected wall clock with
  // margin: 4h covers any single-plan drain (#279 — a 15-min lease on a real
  // plan expires mid-run and reads as a heartbeat timeout).
  heartbeatTimeoutMs: 30 * 60_000,
  claimTimeoutMs: 10 * 60_000,
  // sandboxCpu: <widest wave width> + 2, clamped to the plan's max_cpus — calibrate
  // memory from <evidenceDir>/stat-<runId>.json once runs carry it (W2); golden 8/16 default.
  // sandboxCpu: 8, sandboxMemory: '16GB',
})

console.log(JSON.stringify(read, null, 2))
console.log(`report: ${reportPath}`)
console.log(`detail: ${detailPath}`)
EOF

node fleet-drive-one.tmp.mjs docs/superpowers/plans/<the-approved-plan>.md
rm fleet-drive-one.tmp.mjs
```

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

  On the same leg, two control-plane captures that only exist while the VM does:
  `stat <vm> --json --range=24h` → `<evidenceDir>/stat-<runId>.json` and
  `billing credits usage --group=box --detail --json` →
  `<evidenceDir>/credits-<runId>.json`, each bounded by its own `logPullTimeoutMs`. The
  raw payloads are kept whether or not they parse; the derived reads are
  `detail.sandboxStat` (`{peakCores, meanCores, peakMemBytes}`, or `null`) and
  `detail.creditSpendUsd` (USD, `0` when the ledger carried no row for this box,
  `null` when unknown). Every failure here — refused command, non-zero exit,
  timeout, bad JSON — lands in `detail.errors` and leaves the field `null`;
  `destroySandbox` still runs.

  Keep `dbDir` across runs — never `rm` it; a persisted store is test-pinned safe
  (prior-run rows do not perturb a new run's gate read). Evidence lives outside it
  in `evidenceDir` (default `<dbDir>-evidence`), so a fresh-store experiment never
  deletes evidence. `detail.sandboxStat` is a floor estimate — `stat` samples every
  10 minutes.

`driveOne` defaults `runId` to `run-1`, `capTokens` to `500_000` (W2 charter
constant), and `ttlMs` to 4h — still pass explicit `runId` (never reuse one,
#211) and pass `capTokens`/`ttlMs` explicitly for anything unusual.
`destroySandbox` (`fleet/provision.mjs`) is
called by `driveOne` itself before it returns, so the sandbox is already torn
down by the time this script prints its output — see **Teardown guarantee**
below for the one case that still needs an operator's hand.

**Headless fitness (#322).** `driveOne` refuses a plan carrying any task whose
verification can only be evidenced by human judgment — the known class is the
instruction-only doc task (`implementation` type, every Files entry a `.md`,
no `Test:` entry). run-14 proved such a task makes a `deferred:manual` park a
certainty, discovered only after ~47 min and 203k tokens. Before dispatching:
rewrite the verification into runtime/external form (add a pinning test), or
route that task to a local drain. `allowUnfitPlan: true` overrides — pass it
only with a specific operator pre-authorization for that manual ack, and the
override is recorded in `detail.errors`.

## Gate read

`driveOne` writes its return value's `read` object verbatim to `reportPath`
(default `<evidenceDir>/gate-read-<runId>.json`) — the file **is** the §W1d read,
byte for byte. Check it against the five pre-registered questions:

| Field | §W1d question |
|---|---|
| `o1` | Did provision → claim → run → gate-green → receipts complete with zero store-caused failures (nothing the guard had to converge away)? |
| `receiptsResolvable` | Does every receipt the run produced resolve at its `sha` on the fetched sandbox integration branch (the real `ultra/integration-*` branch from the sandbox, stored in `runs.<runId>.branch`, fetched for real — not simulated)? Three verification legs: (1) object existence (`git cat-file -e <sha>`), (2) reachability from the run branch (`git merge-base --is-ancestor <sha> FETCH_HEAD`), (3) path dereference in the tree (`git cat-file -e <sha>:<path>` — receipts are committed under `fleet-receipts/<runId>/` on the run branch). |
| `leaseContinuity` | Did the lease renew across the whole run with no false expiry? |
| `versionStamp` | Is the run row stamped with `pluginVersion` + `engineSha` (from `.claude-plugin/plugin.json` and `git rev-parse HEAD` inside the sandbox)? |
| `spendObservational` | `{reported, ledger}` — the run report's own token total vs. the shim's spend-row sum. **Observational at n=1 by construction** (spec §W1d, finding F6): this first run's own numbers are the input, not a pass/fail check yet. |

`o1` through `versionStamp` must all be `true`. A `false` `o1` (or a non-empty
`detail.errors` in the sibling `<reportPath minus .json>.detail.json`) means
stop and diagnose before touching the constants below — per spec, W1 failure
modes are provisioning/auth/store bugs and cost nothing to fix or abandon; the
run engine was never touched.

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
reports it as `detail.parkedPublish` — `{branch, fetched, receiptsResolvable,
unapproved: true}` — in the gate-read detail. **`unapproved` means exactly
that:** no standing grant covers the branch, so merging it requires an
explicit operator ack of the parked gate receipt's `acks` (read them in
`fleet-receipts/<runId>/` on the fetched branch). With the ack given, land
the branch by normal PR — no re-drive needed.

On every park, triage in this order:

1. Read `detail.parkedPublish`. Non-null → the work survived; review the
   fetched branch and ack-or-reject.
2. `parkedPublish: null` → recover via the run-14 evidence-diff pattern:
   the per-task review diffs in the pulled evidence
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
