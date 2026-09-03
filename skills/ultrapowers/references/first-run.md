# First run — one section per doctor row

`node <plugin-root>/fleet/doctor.mjs --json` answers with six rows in a fixed
order. Each row that is not `ok` has a section here, named for the row's `id`.
A section says what the piece is, which `fleet/RUNBOOK.md` section builds it,
and the two or three things the RUNBOOK — written for the operator who built
the fleet — does not say to someone meeting it for the first time. It does not
restate the RUNBOOK's steps.

Commands a human runs interactively are offered as `! <command>`, so the human
runs them and sees the output. After each one, re-run
`! node <plugin-root>/fleet/doctor.mjs --json` and read the row back.

## exe-dev

Every VM in the fleet lives on exe.dev, and the `exe.dev` SSH alias is how you
create, copy and delete them. This row is `missing` when the alias does not
resolve or the account rejects the key — nothing below it can be checked until
it answers.

Build it from RUNBOOK §exe.dev account. Two things that section assumes and a
stranger will not have: the alias is an SSH host entry, not a URL, so
`! ssh exe.dev whoami` (the command the doctor runs) is the whole test; and the key you register here is
your laptop's, distinct from the orchestrator's own key registered later in
§Orchestrator VM.

Until this row is `ok`, expect the four rows below it to read `missing` too:
each of them is an `ssh` to a `*.exe.xyz` host, and without a working account
none of those commands can land. Fix this row first and run the doctor again
before touching the others — only `preflight` is ever `skipped`.

## orchestrator

One long-lived VM, `fleet-orchestrator` by default, that holds the fleet's only
credentials and is the machine every run is driven from. It is small: it never
runs an engine, it dispatches sandboxes that do.

Build it from RUNBOOK §Orchestrator VM. What that section does not say to a
newcomer: the name is configurable — the doctor and this skill both read
`orchestrator` from `~/.ultrapowers/fleet.json`, so a second fleet is a second
name, not a second procedure — and the VM needs its own SSH key registered on
the account, because the sandboxes push run branches back to its checkout and a
key that only exists on your laptop cannot carry that.

Its checkout at `/home/exedev/repo` is the engine: what is checked out there is
what every run pushes to its sandbox, and the launch step pins it to the newest
release on `main` first.
The GitHub token it holds has to reach every repository you will drive;
ultrapowers itself is one of them.

## golden

The image every sandbox is cloned from: node, the repo checkout, pytest and
Bun, warm. A run's cost and its failure modes are mostly decided here, which is
why it is built by hand. Nothing about the image chooses what a run executes —
the repo clone at `/home/exedev/repo` is the engine every run checks out at the
`fleet-engine` ref the orchestrator pushes.

Build it from RUNBOOK §Golden VM build.
The golden is built by the human, one RUNBOOK step at a time, and re-checked with the doctor after each; this walk verifies, it does not build.
A wrong image built quickly is harder to debug than a right one built slowly:
the gotchas that section records — PEP 668's `--break-system-packages`, Bun on
the workers' login-shell PATH rather than only the interactive one, the Bun
cache measured by path rather than through `bun pm cache` — each cost a run to
find, and each is invisible until a sandbox fails halfway through a wave.

Take the steps in the order the RUNBOOK gives them and stop at the first one
whose output surprises you.

## token

The engine inside each sandbox bills a Claude Max subscription through a
one-year OAuth token. This is the first of two rows that touch a secret;
github-token is the other.

Build it from RUNBOOK §Engine auth — the Max subscription, delivered per run
(#213). The token comes from `! claude setup-token`, a browser flow that prints
the token to the terminal.
The token is written to a 0600 file directly from the command's output, never through the clipboard, and its value is never pasted into this conversation.
The clipboard rule is not caution for its own sake: a copy of the command text
once overwrote a freshly issued token, and the failure surfaces a run later as
an auth error with no trace of where the value went. Redirect the command's
output to the file, then `chmod 600` it.

The doctor checks that the file exists, is mode 0600, and starts with the
expected prefix. It reports that as yes or no; it does not read the value back
to anyone, and neither should this walk.

## github-token

The orchestrator holds one GitHub token, at `/home/exedev/.fleet/github-token`,
and every run spends it: once a run resolves, the orchestrator pushes the run
branch to GitHub and opens the pull request with it. A sandbox never sees
GitHub — it pushes its branch to the orchestrator's checkout over the tunnel —
and the golden carries no copy; the only copy off the orchestrator is the file
you save while building it, which you scp across and can then delete.

Build it from RUNBOOK §GitHub auth (#368) — the orchestrator opens the PR.
Three things that section does not say to a newcomer. It is a fine-grained
personal access token, and the two permissions it needs are exactly
`Contents: Read and write` and `Pull requests: Read and write` — a classic
token or a wider scope is not what this is. Its repository access has to cover
every repository you will drive, ultrapowers itself among them, because a run
against a repository the token cannot reach fails at the push, after the work
is done. And unlike the Claude token, this one comes from a browser page rather
than a command, so there is no output to redirect:
The token is saved to a 0600 file straight from the GitHub page, never through
this conversation: its value is never pasted here.

The doctor checks that the file is mode 0600 and that `gh` accepts it — with
`--target <owner>/<repo>`, that it reaches that repository as well. It reports
the login and a yes or no; it never reads the value back, and neither should
this walk.

A new target means widening this token's repository access before its first
drive; the doctor's `--target <owner>/<repo>` flag is the check, and a red row
here costs a launch, not a run.

## preflight

The one link no fact sheet demonstrated directly: VM→VM `git fetch` over SSH
between the orchestrator and a sandbox, with an HTTPS `git ls-remote` fallback.
Without it, provisioning cannot deliver the base ref or pull a run branch back.

Check it from RUNBOOK §Preflight. This is the row the doctor's `--probe` flag
exists for: `! node <plugin-root>/fleet/doctor.mjs --json --probe` clones the
golden into a throwaway VM named `fleet-doctor-probe`, runs
`fleet/preflight.mjs` against it, and removes it when it is done. Because the
probe costs a VM, the doctor skips it unless asked — so `--probe` is the last
thing setup runs, once the five rows above it are `ok`.

Offer the probe as the doctor's own flag rather than as a hand-typed clone and
delete. The removal step names a VM, and a mistyped VM name in a delete is a
mistake nothing recovers.

A `ready` verdict from the probing run means the fleet is whole. Anything else
names the row that is still red.
