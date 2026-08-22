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
```

Every real run clones this VM with `provisionRun` (`fleet/provision.mjs`), which
issues `ssh exe.dev "cp fleet-golden fleet-<runId> --json"` as its first command
— never `fleet-golden` itself, which stays untouched between runs.

## LLM integration check

The §W1a zero-secrets probe: a dummy-key `claude -p` call through the exe.dev
LLM integration returns a real completion with **no key ever present on the
VM** (#179 fact sheet §4, proven on a live probe). Run this once against
`fleet-golden` before the first real run, and again any time the golden image
is rebuilt:

```bash
ssh fleet-golden.exe.xyz '
  ANTHROPIC_BASE_URL=https://llm.int.exe.xyz \
  ANTHROPIC_API_KEY=exe-gateway \
  claude -p "reply with exactly: OK" --model claude-haiku-4-5-20251001
'
# expected stdout: OK
```

If this fails, stop — no real run can succeed without model access, and no
`fleet/` code path holds an `anthropic` SDK or key to fall back on by design
(spec §Where it lives; repo-wide no-API-key rule, `CLAUDE.md`). Fix the
account's `llm` integration (`ssh exe.dev integrations edit llm --anthropic=byok
--anthropic-key=-`) before proceeding, not by adding a key anywhere in `fleet/`.

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

const { read, reportPath, detailPath } = await driveOne({
  planPath: process.argv[2],          // e.g. docs/superpowers/plans/some-approved-plan.md
  golden: 'fleet-golden',
  port: 8180,                          // pick a port outside the 8151-8159 test range
  dbDir: '/tmp/fleet-orch-live',       // orchestrator's per-path SQLite persister dir
  repoDir: process.cwd(),              // local checkout the base is pushed from
  exec,
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
  kills the detached tunnel process after the `rm`.
- **Evidence before teardown (#197).** `driveOne` pulls the small sandbox
  artifacts — `shim.log`, `fleet-run.json`, `~/.claude/projects` (engine
  transcripts), and the gitignored `repo/.claude/ultrapowers/run-*/` dirs — to
  `<dbDir>/sandbox-logs/fleet-<runId>-<stamp>/sandbox-logs.tgz` before every
  `destroySandbox` (normal end of run and the cap-overshoot action alike). The
  pull is best-effort and bounded (`logPullTimeoutMs`, default 120 s): a failed
  pull lands in `detail.errors` and teardown proceeds. `detail.sandboxLogs`
  names the archive, or is `null`.

`driveOne` defaults `runId` to `run-1` and `capTokens` to `2_000_000` — pass
explicit `runId`/`capTokens` in the options object above for anything other
than a first calibration run. `destroySandbox` (`fleet/provision.mjs`) is
called by `driveOne` itself before it returns, so the sandbox is already torn
down by the time this script prints its output — see **Teardown guarantee**
below for the one case that still needs an operator's hand.

## Gate read

`driveOne` writes its return value's `read` object verbatim to `reportPath`
(default `<dbDir>/gate-read-<runId>.json`) — the file **is** the §W1d read,
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
