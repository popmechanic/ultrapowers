# Fleet RUNBOOK — golden VM build and the live W1 procedure

This is the operator procedure for the §W1 "one remote run, end to end" slice
(spec: `docs/superpowers/specs/2026-08-21-width-program.md` §Phase W1). It is a
document, not code — every command below names a real file and a real exported
signature from the tasks that built it (`fleet/preflight.mjs`,
`fleet/provision.mjs`, `fleet/orchestrator.mjs`, `fleet/drive.mjs`,
`fleet/shim-main.mjs`), so it can be followed by an operator with an `exe.dev`
account and nothing else.

No step here touches `skills/ultrapowers/scripts/`, `skills/ultrapowers/kernel/`,
— the run engine is `fleet/run-engine.mjs` (0.3.0, Amendment 10).

## exe.dev account

Everything below assumes an exe.dev account whose SSH key is registered, so
that `ssh exe.dev whoami` prints your username. Nothing else in this file
works without it: every VM is created, cloned and removed by an
`ssh exe.dev ...` command, so the account is the first thing to build and the
first row the doctor checks.

1. Sign up at exe.dev and note the username it gives you.
2. Register the public half of a local key on the account, through the web UI.
   A key generated for this is fine:
   `ssh-keygen -t ed25519 -N "" -C exe-dev -f ~/.ssh/id_ed25519`.
3. Point the laptop's `~/.ssh/config` at that key for the two host patterns the
   fleet uses — `exe.dev` itself, and the `*.exe.xyz` VMs it creates. This is
   the same stanza §Orchestrator VM writes on the orchestrator for the
   orchestrator's own key:

```
Host *.exe.xyz exe.dev
  StrictHostKeyChecking accept-new
  IdentitiesOnly yes
  IdentityFile ~/.ssh/id_ed25519
```

`IdentitiesOnly yes` is the line that keeps a laptop with many loaded keys from
offering the wrong one first and being refused before it reaches this one.

Then check it:

```bash
ssh exe.dev whoami
```

That printing your username is the whole of this step. A `Permission denied`
means the key is not registered on the account, or `IdentitiesOnly` is unset
and the agent offered a different key first. `node fleet/doctor.mjs` reports
this same check as its first row (§Doctor).

## Golden VM build

**Rebuilding an existing golden: build the replacement, then swap.** Step 1
below creates `fleet-golden` by name, but that VM already exists and every run
clones it (`fleet/drive-one.mjs` `DEFAULTS.golden`). Do NOT `rm` it to make
room — a rebuild that fails partway then leaves no golden and no run can be
provisioned until it is repaired. Instead:

1. `ssh exe.dev "cp fleet-golden fleet-golden-next --json"` and apply the
   deltas to the clone. Prefer this to a from-scratch build: the steps below
   never recreate `~/.claude/settings.json` (`permissions.defaultMode`,
   `enabledPlugins`, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`), so a from-scratch
   golden silently comes up without them. The clone inherits the `fleet` tag,
   which the orchestrator's tag-scoped key needs in order to `cp` it.
2. Verify: every check in this section, run against `fleet-golden-next`.
3. Prove it with a real run: `node fleet/drive-one.mjs … --golden fleet-golden-next`.
4. Only then `ssh exe.dev "rm fleet-golden"` and
   `ssh exe.dev "rename fleet-golden-next fleet-golden"`. Renaming keeps the
   `drive-one` default correct with no code change.

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
#    `--break-system-packages` is REQUIRED, not optional: exeuntu's python3.12
#    is PEP 668 externally-managed, so a plain `pip install --user` refuses
#    outright ("This environment is externally managed") and the golden comes
#    up without xdist while pytest itself still answers `--version` from
#    /usr/local/lib/python3.12/dist-packages. Verified 2026-08-30.
ssh fleet-golden.exe.xyz 'python3 -m pip install --user --break-system-packages pytest pytest-xdist && python3 -m pytest --version'
ssh fleet-golden.exe.xyz 'python3 -c "import xdist; print(xdist.__version__)"'   # the import is the check, not the install's exit code
#    pytest-xdist halves suite wall inside runs (#426): test-command detection
#    emits `-n auto` when xdist is importable, serial pytest otherwise — so an
#    older golden without it degrades gracefully instead of failing. Opt out
#    per run with ULTRAPOWERS_XDIST=0 in the driver env, or pass an explicit
#    --test-cmd (e.g. for a target repo whose suite is not parallel-safe).

# Bun for greenfield TypeScript targets (#425). One static binary; the target's
# own `bun install` then needs no network beyond the registry. The fleet DRIVER
# stays on node — its spawn/SIGTERM semantics are the measured ones.
ssh fleet-golden.exe.xyz 'curl -fsSL https://bun.sh/install | bash'
ssh fleet-golden.exe.xyz 'export PATH="$HOME/.bun/bin:$PATH" && bun --version'
#    `~/.bun/bin` must be on the PATH the WORKERS inherit, not just this ssh:
#    a target's `testCmd` (`bunx tsc --noEmit && bun test`) and its
#    `bootstrapCmd` (`bun install`) run through `bash -lc`, so the entry has to
#    come from a login-shell file. The installer appends it to `~/.bashrc`,
#    which exeuntu's stock `~/.profile` sources — make that explicit rather
#    than assumed, then prove it the way a worker will see it:
ssh fleet-golden.exe.xyz 'grep -q .bun/bin ~/.profile || echo export PATH=\"\$HOME/.bun/bin:\$PATH\" >> ~/.profile'
ssh fleet-golden.exe.xyz 'bash -lc "bun --version"'   # non-empty, no PATH edit
#    Warm Bun's global package cache IN THE IMAGE so it clones with every
#    sandbox instead of being refetched per run (#425 item 3). With the cache
#    warm, a target's `bun install` is a hardlink operation: measured 574 ms
#    laptop-side and 17 ms on the golden with `--offline` (2026-08-30), against
#    a cold-cache fetch of the npm registry on every cell. `bun install --offline`
#    succeeding IS the proof the cache is real — it cannot pass by silently
#    reaching the registry.
ssh fleet-golden.exe.xyz 'bash -lc "cd /home/exedev/repo/evals/fixtures/bun-greenfield/project && bun install && rm -rf node_modules bun.lock"'
#    Measure the cache by PATH — never with a `du -sh` of `$(bun pm cache)`:
#    outside a project dir `bun pm cache` exits non-zero with "No package.json
#    was found", the substitution collapses to empty, and `du -sh` silently
#    measures `.` instead — printing a healthy-looking 535M for $HOME on a
#    golden whose cache is cold. A check that cannot fail is not a check
#    (2026-08-30).
ssh fleet-golden.exe.xyz 'bash -lc "du -sh ~/.bun/install/cache"'   # tens of MB: the cache survives
ssh fleet-golden.exe.xyz 'bash -lc "cd /home/exedev/repo/evals/fixtures/bun-greenfield/project && bun install --offline && rm -rf node_modules bun.lock"'

# 3. Install the ultrapowers plugin inside the clone (fleet/node_modules stays
#    gitignored — install fleet's own deps too, since the shim imports tinybase + ws).
ssh fleet-golden.exe.xyz 'cd /home/exedev/repo/fleet && npm install --no-audit --no-fund'
#    The plugin is addressed as <plugin>@<marketplace>; the bare name fails with
#    "Plugin not found". Register the marketplace first (it is this repo).
#    THIS IS THE BOOTSTRAP ONLY (#373): it puts *a* plugin in the image so the
#    per-run re-install below has something to uninstall. It does NOT choose
#    the engine under test — see the note after step 6.
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
#    The version printed here is NOT the engine a run will execute (#373, below).
#    Keep the golden's `claude` CLI and its deps fresh as ordinary hygiene —
#    `claude plugin update` refreshes nothing at the same version anyway — and
#    prune the transcripts the update session leaves behind (step 5 again):
ssh fleet-golden.exe.xyz 'claude plugin update ultrapowers@ultrapowers && rm -rf ~/.claude/projects/*'
```

**The engine under test is the pushed base, not the golden's plugin (#373).**
The marketplace install in step 3 is the bootstrap only. Every run re-installs
the plugin inside its own sandbox from the sandbox's `fleet-base` checkout —
`fleet/shim-main.mjs` `invokeEngineRun` runs `pluginInstallCommands`
(`claude plugin marketplace add /home/exedev/repo` → `claude plugin uninstall
ultrapowers@ultrapowers` → `claude plugin install ultrapowers@ultrapowers`,
~2 s) after the `fleet-base` checkout and before the engine launches, and
REFUSES TO LAUNCH if any of the three fails (the run parks with
to the image's plugin). The per-run re-install means the engine under test is the pushed base by
construction; the drive's `versionStamp` leg attests the checkout stamp
(`pluginVersion` + `engineSha`), not the installed plugin — that half died at
0.3.0 (`drive.mjs:1123-1127`). Consequences:

- `claude plugin update` on the golden is no longer how the engine under test is
  chosen — the base ref you push IS the engine. A branch, or main between
  releases, runs its own engine. Rebuilding the golden after a release is
  hygiene, not a prerequisite for driving that release.
- The bootstrap install must exist: `claude plugin uninstall` exits 1 when
  nothing is installed, and the run refuses at that step. A golden built
  without step 3 drives nothing.
- The local-path `marketplace add` REPLACES the golden's GitHub marketplace
  entry of the same name (`ultrapowers`) inside the sandbox clone only; the
  golden itself is never touched.
- The per-run `claude plugin …` commands write no session transcript
  (`~/.claude/projects` stays clean), so the evidence bundle (#197) is not
  polluted by them.

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

**Hand work on the orchestrator.**
The orchestrator carries no `pytest-xdist`, so a suite run there is serial: `python3 -m pytest` without `-n auto` (141 s for the fleet files, measured 2026-09-01).

The OAuth token lands here in the next section and the GitHub token in the one
after (#368); nothing else secret lives on it.

The orchestrator shell has no GitHub push credential (the drive pushes with its own token inside `drive.mjs`), so adoption or rescue work done by hand there is fetched to the laptop over ssh and pushed from the laptop:

```bash
# The orchestrator's own `main` after a hand adoption or a rescue commit
# (#533) — name `refs/fleet/run-<N>` instead when it is a run tip you are
# rescuing (§Park triage). A `git push` typed on the orchestrator itself dies
# with `could not read Username` (#537); only the laptop has the credential.
git fetch ssh://exedev@fleet-orchestrator.exe.xyz/home/exedev/repo main:orchestrator-main
git log --oneline main..orchestrator-main   # read what you are about to push
git push origin orchestrator-main:main
```

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

Max usage is one 5-hour + weekly window **per account across all machines**, so
the fleet shares the window of whichever account's token it rides. That line
used to end "that — not vCPU — bounds width", and was cited for years-in-agent-
time as the reason runs must be serial. **Measured 2026-09-01 (#454,
`evals/frontier/results/2026-08-31-concurrent-drains.md`): it does not bind
through N=3 concurrent drains** — six gate-green runs in one window, batch wall
0.26× of serial-equivalent at N=3, zero 429s, no per-drain degradation. Serial-
by-default is retired for independent plans; the ceiling is somewhere above
N=3 and still unmeasured. Concurrent-launch shape (each drive needs its own
`--port` and `--db-dir`, and each launch its own subshell with the cwd set — a
chain of them after the first loses the `cd`; `setsid -f` rather than
`nohup ... &` for the same reason as the single run below):

```bash
ssh -n fleet-orchestrator.exe.xyz 'for r in 41 42 43; do (cd /home/exedev/repo && setsid -f node fleet/drive-one.mjs <plan.md> run-$r --port $((8146+r)) --db-dir /tmp/fleet-orch-run$r </dev/null >/home/exedev/fleet-evidence/drive-run-$r.out 2>&1); done; exit'
```

Note the operator runs multiple subscriber accounts in rotation (#513): a
`/usage` read is **per account**, so meter the token the fleet is actually
riding, not whichever token the laptop Keychain holds.
There is no per-invocation spend flag, and **there is no longer a per-run token
cap** — it was deleted in #400 (one-driver Amendment 4): it never fired in
twelve runs (peak run-18, 63%), metered dollars when the scarce resource is the
rate window, and was calibrated from size means. The shim's `readSessionTokens`
still writes the `spend` ledger; nothing enforces against it. **The rate window
is the spend control, and reading it is the operator's job.**

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

## Doctor

`node fleet/doctor.mjs` is the read-only check of everything above: one row per
section — exe.dev account, orchestrator, golden, token — and a fifth,
preflight, that runs only with `--probe` because it clones the golden into a
throwaway `fleet-doctor-probe` VM and removes it.

```bash
node fleet/doctor.mjs           # the four read-only rows
node fleet/doctor.mjs --probe   # plus preflight, which clones a VM and removes it
node fleet/doctor.mjs --json    # the same verdicts as one JSON object
```

A missing row names the section of this file that builds it; `--json` is what
`/ultrapowers setup` reads. Re-run it after every step of a build and after
every `claude plugin update` on the golden; a green doctor is the posture
check, not the build's exit code.

The `--probe` row is the §Preflight procedure below, run for you; the section
that follows is where its verdicts are explained and where to go when the
VM→VM fetch is the leg that failed.

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
# human terminal sits blocked for the whole run. And the redirects alone are not
# enough either: measured 2026-09-01 with a 45 s child, `nohup … </dev/null >f
# 2>&1 &` held the client for the child's whole 47 s (so did `& disown` and
# `& exit 0`), while a NEW SESSION released it in 2 s. `setsid -f` is that new
# session in one greppable token (`/bin/setsid` is on the golden), and it
# backgrounds by itself — no trailing `&` (#524).
# tests/test_launch_snippet_detaches.py pins this shape on every launch line here.
# `mkdir -p` first: the redirect below is the SHELL's, evaluated before the driver
# runs, so it does not benefit from drive.mjs's own mkdir of evidenceDir (#466).
# docs/superpowers/ is untracked (#544): put the plan on the orchestrator first, then ship it in the assignment.
rsync -a docs/superpowers/plans/<the-approved-plan>.md docs/superpowers/plans/<the-approved-plan>.gate-verdicts.json fleet-orchestrator.exe.xyz:/home/exedev/repo/docs/superpowers/plans/
ssh -n fleet-orchestrator.exe.xyz 'mkdir -p /home/exedev/fleet-evidence && cd /home/exedev/repo && setsid -f node fleet/drive-one.mjs docs/superpowers/plans/<the-approved-plan>.md run-<fresh> --plan-from-assignment </dev/null >/home/exedev/fleet-evidence/drive-run-<fresh>.out 2>&1'

# Race the plan instead (#511, operator asks for it by name): K whole runs of
# one plan, driven concurrently from this single process — so it detaches the
# same way, and the raceId is a fresh `run-N` whose attempts become run-<N>-a/b/c.
ssh -n fleet-orchestrator.exe.xyz 'mkdir -p /home/exedev/fleet-evidence && cd /home/exedev/repo && setsid -f node fleet/race.mjs launch docs/superpowers/plans/<the-approved-plan>.md run-<fresh> --k 3 </dev/null >/home/exedev/fleet-evidence/race-run-<fresh>.out 2>&1'
# Then read it: `node fleet/race.mjs judge run-<fresh>` (RUNBOOK evidence dir).

# Updating Claude Code on the fleet: NEVER by hand and never on a schedule —
# version drift is event-driven (sandboxes inherit the golden's binary; the
# auto-updater is frozen via DISABLE_AUTOUPDATER in the worker env), so the
# one entry point is the workflow, which updates golden + orchestrator
# together and runs ONLY the four live parity probes at the moment of change
# (tests/test_update_cli.py pins the probe list and sentinels):
#   bash fleet/update-cli.sh [<version>]
# A red probe prints the rollback for both hosts and refuses the version.

# Watch it (the shim/driver progress log rides stderr into the same file):
ssh fleet-orchestrator.exe.xyz 'tail -f /tmp/drive-run-<fresh>.out'

# Better (#421): subscribe as a LIVE SYNC PEER instead of tailing a log. The
# drive mints a read-side observer token into <dbDir>/observer.json; tunnel
# the ws port, fetch the token, and every worker event / phase / stage pushes
# to the laptop as it happens (fleet/watch.mjs, read-only by construction):
ssh -N -L 8180:127.0.0.1:8180 fleet-orchestrator.exe.xyz &
ssh fleet-orchestrator.exe.xyz 'cat /tmp/fleet-orch-live/observer.json' > /tmp/observer.json
node fleet/watch.mjs --observer /tmp/observer.json --run run-<fresh>
```

Knobs, all optional (defaults = the W2 charter constants):
`--port 8180` (any explicit port; concurrent drains take distinct ports),
`--db-dir /tmp/fleet-orch-live` (the orchestrator's per-path SQLite persister
dir; concurrent drains take distinct dirs — that separation is the W2a isolation),
`--golden fleet-golden`, `--ttl-hours 4` (store-token lease TTL — size to the plan's
expected wall clock with margin; a short lease expires mid-run and reads as a
heartbeat timeout, #279), `--evidence-dir DIR` (default `/home/exedev/fleet-evidence` — durable, NOT under `/tmp`, #466), `--sandbox-cpu N` /
`--sandbox-memory SIZE` (the run sandbox's size — §Sandbox sizing, just below; width
itself is bounded by the
subscription streams, `WIDTH` in `run-main.mjs`), `--allow-unfit-plan` (only with a
specific operator pre-authorization for the manual-judgment task named by the
#322 refusal — never a standing default). `node fleet/drive-one.mjs` with no
arguments prints the usage line.

**Sandbox sizing (#546).**
A run sandbox defaults to 16 vCPU and 48 GB; --sandbox-cpu and --sandbox-memory override it.
The account pool is one shared 16 vCPU / 64 GB allocation across every VM, so an allocation
is a cap and not a reservation — §Billing below, "the plan meters CONSUMPTION, not
allocation".
Raising the default therefore costs nothing while the sandbox is idle, and idle is most of a
run: workers wait on model round-trips, and suite runs are bursts between turns.
The old "widest wave width + 2" rule sized against a number that constrains nothing; run-49
drew 1.5 of 8 cores at width 8.
What a wide run actually spends is sandbox MEMORY, ~3 GB per busy implementer: run-51 sat an
eleven-wide wave at load 2.89 on the golden's 8 vCPU with 3 GB used of 15, and run-52 — the
flags typed by hand — peaked at load 4.28 on 16 vCPU with 3.6 GB used of 48.
This is a default rather than a clamp: the flags keep overriding it in both directions.

**`--engine one-driver`** (#402): run the engine on the sandbox as the
deterministic driver (`node fleet/run-main.mjs`) instead of the `claude` skill
session. It provisions clones at BASE, captures each task's patch itself, folds
every wave, confines the implementer with a `PreToolUse` hook, and gates —
writing the same receipts to the same run directory, so the drive, the gate
read and the PR are unchanged. Omit the flag for the old `claude` path, which
stays the fallback until the first self-hosted run passes (spec §10 stage 2).
The laptop refuses any `--engine` value but `one-driver`; the sandbox treats a
missing key as the `claude` launch, so old assignments stay valid.

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
  where `evidenceDir` is `/home/exedev/fleet-evidence` (#466). The pull is best-effort and
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
  in `evidenceDir` (`/home/exedev/fleet-evidence`, #466 — a durable path, not a
  derivative of `dbDir`), so a fresh-store experiment never deletes evidence. `detail.sandboxStat` is a floor estimate — `stat` samples every
  10 minutes.

`driveOne` requires an explicit `runId` (it refuses to run without one —
runIds are unique per account lifetime, #211) and defaults `ttlMs` to 4h — pass
`--ttl-hours` explicitly for anything unusual. There is no `--cap-tokens`: it is
**refused as an unknown flag**, not silently ignored (#400).
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
| `versionStamp` | Is the run row stamped with `pluginVersion` + `engineSha` read from the pushed base ref inside the sandbox, and do they match what the driver pushed (#282)? The installed-plugin half died at 0.3.0 with the install it checked (`drive.mjs:1123-1127`): no plugin participates in the run, and comparing the golden's bootstrap plugin to the pushed manifest would go permanently red at the first release bump. versionStamp attests the checkout stamp alone. |
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

- ~~**Cap defaults**~~ — **deleted (#400).** There is no `capTokens`, no
  docket-wide budget cap and no `budgets` table. The `spend` ledger is kept as
  observation; nothing acts on it. Do not reintroduce a threshold fitted to a
  handful of runs — that is the mistake this deletion is undoing.
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
3. **The run's tip is already pinned — do not hand-rescue it.** Every fetched
   run tip lands on `refs/fleet/<runId>` in the orchestrator's clone the moment
   the fetch succeeds, before the publish leg can fail (#497). It survives
   `git reset --hard` (the first step of launching the next run) and `gc`. The
   drive logs `pinned run tip: refs/fleet/<runId> -> <sha>` when it happens. So
   a failed publish is recoverable, not fatal:

   ```bash
   # 1. the run tip is already pinned on the orchestrator (#497) — confirm it
   ssh fleet-orchestrator.exe.xyz 'cd /home/exedev/repo && git rev-parse refs/fleet/run-<N>'
   #    expect the sha the drive logged as `pinned run tip: … -> <sha>`
   # 2. fetch that pinned ref to your laptop over ssh
   git fetch ssh://exedev@fleet-orchestrator.exe.xyz/home/exedev/repo refs/fleet/run-<N>:refs/heads/ultra/integration-run-<N>
   # 3. push it with an operator credential — the drive's token could not
   git push origin ultra/integration-run-<N>
   # 4. open the PR by hand, carrying this gate receipt as the body
   gh pr create --draft --head ultra/integration-run-<N> --title '[parked] fleet run-<N>' --body-file pr-body-run-<N>.md
   ```

   Since #524 you do not have to fill those in by hand. When the publish leg
   itself fails, the drive re-renders the card it already wrote and leaves
   these same four commands in it, under a `## Rescue` heading, with this run's
   real ref, sha, branch and host substituted — read it at
   `<evidenceDir>/pr-body-run-<N>.md` (`/home/exedev/fleet-evidence/` unless
   `--evidence-dir` moved it) and paste from there. Note where it is NOT: a
   failed publish means no PR was opened, so no card on GitHub carries the
   block — step 4 above is what puts that body on GitHub, and the PR it opens
   is the one that carries it. When the drive never got as far as writing a
   card at all (no fetched tip, no token), this block is the rescue.

   **Two cases the pin does NOT cover**, so check before assuming: a run that
   was never fetched (gate-green but zero receipt rows — the fetch is
   receipt-gated), and a `runId` git refuses as a ref name (`detail.errors`
   says so explicitly).

4. **Harvest the `minor` group of `report.json`'s `completenessFindings` into
   issues explicitly** — run-14's carried a real socket-leak defect that
   existed nowhere else. Only the `minor` group needs this hand step: since
   #474 a `blocking` finding stops the run at the driver (`criticDecision`
   refuses before `--approve`, leaving a `critic-block.json` beside the gate
   receipt), so it is already on the record and needs no manual harvest.

## Teardown guarantee

`driveOne` already calls `destroySandbox({vmName, exec})` (`fleet/provision.mjs`)
before returning, which issues:

```bash
ssh exe.dev "rm fleet-<runId> --json"
```

If a run's process is killed mid-flight (operator Ctrl-C, host crash) before
that teardown leg runs, the sandbox is orphaned and still billing. **There is
no provider-side TTL** — `provisionRun` issues a bare `cp`, and the `ttlMs`
nearby is the store-token lease, not a VM lifetime — so "orphaned" means
orphaned until someone runs `rm`.

**The claim-lease reaper (#400) reclaims it, and here is exactly what it can
promise.** The orchestrator's sweep destroys a sandbox whose claim lease expired
with no drive heartbeat (a live drive renews the lease, so an expired lease
*is* the absence of a heartbeat), after a further `REAP_GRACE_MS` margin,
recording the reason as liveness — never spend.

But **there is no long-lived orchestrator process**: `drive.mjs` starts one per
drive, in-process, so the sweep that would reap a leak dies with the drive that
caused it. What makes reclamation work anyway is that `--db-dir` is shared
across runs *by default*, and persisted, so the dead run's claim row is still
there when the **next** drive's orchestrator loads the store — and its first
sweep reaps the orphan.

**Reclamation is therefore scoped to one `--db-dir`, and that matters**, because
the knobs above tell you to give concurrent drains **distinct** db-dirs (the W2a
isolation). A run driven under its own db-dir is invisible to every other run's
reaper: if it dies, **nothing will ever reclaim its sandbox** except the manual
`rm` below. That is the price of the isolation, and it is the right trade for a
concurrent drain you are watching — but **check for orphans by hand after a
concurrent drain**, because the reaper will not.

So, within one db-dir:

- a **concurrent** drive sharing it reaps within a sweep;
- otherwise the orphan is reclaimed at **the next drive start** using that
  db-dir, not within one lease period;
- if no further run uses that db-dir, **nothing reaps**.

**A finished run is never reaped.** Nothing clears a claim on completion, so
every successful run leaves one that ages out; the reaper keys on the *run's
status* as well as the lease, and only a run still `pending`/`claimed`/`running`
is treated as an orphan. Without that, the first sweep of every new drive would
try to `rm` every run in the db-dir's history.

So the manual recovery below is still the operator's tool, and the one to reach
for if a VM must go now:

```bash
ssh exe.dev "ls --json"              # fleet-<runId> VMs with no live drive
ssh exe.dev "rm fleet-<runId> --json"
```

`rm` accepts multiple VM names in one call (#179 fact sheet §6) — sweep every
orphan in one shot: `ssh exe.dev "rm fleet-run-1 fleet-run-2 --json"`.

**Cleaning up a stuck sandbox is always `ssh exe.dev "rm <vmName> --json"`.**
(This paragraph used to contrast that with `sweep_worktrees.sh`, a local
worktree reclaimer deleted in Phase 0 / 0.2.26. Fleet sandboxes are disposable
`exe.dev` VMs, never worktrees — #386 residual, cleared.)


## Capacity — read the meter, never sum the allocation

**One command answers "do we have room":**

```bash
ssh exe.dev "billing usage --json"   # what the plan actually meters
ssh exe.dev "billing plan  --json"   # the limits it meters against
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
```

which `drive.mjs:212` already captures per run into the evidence bundle. Peak
vs mean for a wave is read from there, not from `billing usage`.
