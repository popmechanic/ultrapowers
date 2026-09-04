---
name: ultrapowers
description: Use when the user runs "/ultrapowers <plan-path>", asks to "execute this plan", "go ultra", or wants an approved plan built autonomously in parallel waves — on the exe.dev fleet, never on this machine. Also use when the user runs "/ultrapowers setup", asks whether they have a fleet yet, or asks to build one.
argument-hint: <plan-path> | setup
allowed-tools: Skill Read Grep Glob Bash AskUserQuestion
---

# Ultrapowers

This skill is the CLIENT only. Since 0.3.0 there is no LLM engine session:
on the sandbox, a boot unit spawns the deterministic driver
(`node fleet/run-main.mjs` → `fleet/run-engine.mjs`), which compiles the plan,
dispatches judgment agents, folds each wave with the kernel, gates, and
approves — code, not prose. Nothing in this skill runs a plan locally, and
`ultra_run.py` refuses to (its `fleet-run` stage).

The argument decides the mode. A plan path is the client below; the bare word
`setup` is the guided first run. The client falls into setup by itself when the
doctor is not `ready`, so setup is a path through this file and not a separate
errand.

## Setup

The doctor is the only thing that knows which pieces of the fleet are already
there. Every row it returns is a read: running it twice is the same as running
it once, and nothing in setup creates a VM.

The setup agent uses AskUserQuestion wherever a question can be posed as choices.
The agent runs every command in this section itself. Only three things need a
human — a browser signup, a browser approval, and one copied code — and each of
those is followed by an AskUserQuestion whose recommended option is the next
step, so the agent waits on an answer instead of on a guess. If a command fails
in the agent's own shell, the agent reports the failure and the exact command
and offers, with AskUserQuestion, to hand that one command over; that fallback
exists only after the agent-run form has already failed.

The first command, run from the plugin cache:

```bash
node <plugin-root>/fleet/doctor.mjs --json
```

`<plugin-root>` is two directories above this skill's base directory. The
harness prints `Base directory for this skill:` when it loads this file; the
cache path itself differs by version and by host, so derive it rather than
naming it.

The doctor answers with one row per piece, and its row ids are `exe-dev`,
`capacity`, `claude`, `github`, `integrations`, in that order. Each row carries
a `status` of `ok` or `missing`, a human `detail`, and a `fix` naming the `## `
section of `references/first-run.md` that repairs it. Read the rows back to the
user as a short list before touching anything. Configuration lives in
`~/.ultrapowers/fleet.json`; the doctor takes `--config <path>` to read it from
somewhere else, and `--target <owner>/<repo>` to include that repository's own
integration object in the answer.

Then take the red rows in the doctor's order. Open the row's `fix` section in
`references/first-run.md` for the detail — the walk is not restated here — and
say one line about what is happening before each repair.

`exe-dev` — the account. The human signs up at exe.dev and adds an ssh key in
the browser; that is the first consent and the agent cannot do it for them.
AskUserQuestion: **Done in the browser?** — `Yes, the account and key are in place (Recommended)` / `Not yet, wait for me`.
Then the agent asks, again with AskUserQuestion, which key file `~/.ssh/config`
should point at — `~/.ssh/id_ed25519` (Recommended) or another path the user
names — and writes the `Host *.exe.xyz exe.dev` stanza itself.

`capacity` — the pool the account's plan allows. The agent reads the doctor's
`detail` for the pool it found and asks with
AskUserQuestion: **Lower the run size, or upgrade the plan?** — `Lower it to {"cpu":"4","memory":"8GB"} (Recommended)` / `Upgrade the plan instead`.
On the first the agent writes the smaller size into `~/.ultrapowers/fleet.json`
itself; on the second the human upgrades the plan in the browser and the agent
re-runs the doctor after them.

`claude` — the token. The agent runs
`node <plugin-root>/fleet/claude-token.mjs login --code-from-clipboard` in the
background; it opens claude.ai and waits for the code to land on the clipboard.
The human approves there and copies the code — the third consent, and the only
secret that ever moves by hand.
AskUserQuestion: **Done in the browser?** — `Yes, the code is copied (Recommended)` / `Not yet, still approving`.
On the answer the agent reads the command's result and says in one line whether
the token landed.

`github` — the GitHub integration. The agent runs
`ssh exe.dev integrations setup github` and shows the user what it prints; the
human approves the GitHub app install in the browser, which is the second
consent.
AskUserQuestion: **Done in the browser?** — `Yes, the install is approved (Recommended)` / `Not yet, wait for me`.
Keep that integration personal: `--act-as-user` is unavailable on team
integrations, so a team account's PRs are authored by the installation bot
rather than by the user.

`integrations` — the target's own object. The agent runs
`node <plugin-root>/fleet/target.mjs <owner>/<repo>` for the repository being
built, which creates the one object that repository needs, attached to nothing;
the command is idempotent, so an object already there is left alone. When the
doctor also reports a GitHub object carrying the fleet tag, the agent asks with
AskUserQuestion: **Detach the stray GitHub object?** — `Yes, detach it (Recommended)` / `No, leave it and I will look`,
and on yes it runs `ssh exe.dev "integrations detach <name> tag:fleet"`.

The agent re-runs the doctor after each fix, and the row that turned `ok` is
read back to the user in one line before the next red row is touched. A row
that comes back `missing` twice is reported with the doctor's `detail` and its
walk section, and the agent keeps going down the list rather than starting over.

When the doctor's verdict is `ready` the fleet is complete, and the launch in
`## Client` below runs in the same turn — setup is a repair, not a destination.

## Client

Selecting ultrapowers at the planning handoff, or invoking `/ultrapowers` on an
approved plan, **is** the authorization to execute — no further approval pause.

1. **Derive the target from this checkout.** The target is the repository this
   skill is run in: `repo` is
   `gh repo view --json nameWithOwner -q .nameWithOwner`, and `baseSha` is the
   checkout's current commit. There is nothing per-project to configure — the
   pair travels in the launch, and each sandbox clones `repo` and branches from
   `baseSha`. That sha has to be one GitHub already has, so compare it against
   the upstream tip: when they differ, say the base is not on GitHub yet and ask
   the operator to push it before the launch.

   Then run `node <plugin-root>/fleet/doctor.mjs --target <repo>` once. A
   verdict of `ready` goes straight to step 2. Any other verdict is repaired
   here: run the `## Setup` path inline, in this same turn, and launch when the
   doctor comes back `ready`.

2. **Launch.** One line:

   ```bash
   node <plugin-root>/fleet/launch.mjs <plan-path> --target <repo> --base <baseSha>
   ```

   It prints the run id, the VM name, the status URL and the assignment
   comment. Read all four back to the user: the run is `run-<N>`, the VM is
   `fleet-r<N>-…`, and `https://<vm>.exe.xyz/status.json` is its status page.
   Nothing else needs staging — the launcher commits the plan to the target's
   `ultra/plan-run-<N>` branch, attaches the run's integration to that VM,
   writes the assignment comment, and starts the run over ssh.

3. **Walk away.** The run outlives this session; there is nothing to tail. Its
   state is `status.json`, the same bytes on the VM's status page and on the
   run's evidence branch at every transition: `booting` → `running` →
   `publishing` → `done`, or `parked` or `failed`. When the user asks how the
   run is doing, read `https://<vm>.exe.xyz/status.json`, or the evidence
   branch once the VM has been reaped.

4. **The PR is the gate.** There is no approval command. When the engine is
   done and the branch is ahead of base, the sandbox pushes it and opens the
   PR itself, through the target's integration attached at launch. The run's
   code is the `ultra/integration-run-<N>` branch, which is the PR head; its
   evidence is `ultra/evidence-run-<N>`, under `.ultrapowers/runs/<N>/`, never
   merged and linked from the PR body. Gate-green → a ready PR and `done`.
   Parked → a draft PR carrying the gate receipt and `parked`. `pr` and
   `prAuthor` in `status.json` are the PR's URL and who GitHub says opened it —
   read both back to the user, and say so when the author is the installation
   bot rather than them (their GitHub account is not yet linked on exe.dev's
   Integrations page). The operator merges or closes the PR; a parked run is
   acknowledged by marking it ready, or re-driven as a narrower plan. A parked
   run with nothing to publish opens no PR; its evidence branch is still
   pushed. The laptop never fetches a run branch.

5. **Reap.** `node <plugin-root>/fleet/janitor.mjs` removes the VMs of runs
   that finished over an hour ago, and reports the stale ones rather than
   removing them. It is a cron job; the agent runs it by hand when that
   machine has been asleep.

## Resources

- `fleet/run-engine.mjs` — the engine (waves, judgments, fold, gate) as code;
  `fleet/roles/*.md` — the judgment prompts, one file per role.
- `references/first-run.md` — one section per doctor row: what it means and the
  command that builds it.
- `references/design-rationale.md` — why each surviving guard exists.
- `references/dependency-analysis.md`, `references/plan-markers.md` — plan → waves.
- `references/report-format.md`, `references/finishing-notes.md` — report schema; finishing checks.
- `kernel/FOLD_LOG.md` — the fold-log schema (contended-wave state a parked run's evidence carries).
- `scripts/ultra_run.py`, `scripts/ultra_gate.py`, `scripts/finalize_report.py`,
  `scripts/gate_check.py`, `scripts/run_acceptance.sh`, `scripts/compile_plan.py`.
