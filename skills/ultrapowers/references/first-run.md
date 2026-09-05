# First run — one section per doctor row

`node <plugin-root>/fleet/doctor.mjs --json` answers with seven rows in a fixed
order. Each row that is not `ok` has a section here, named for the row's `id`.
A section says what the piece is, what the agent runs for you, what you do in a
browser, and the two or three things a newcomer would not know. The commands are
the ones in `fleet/RUNBOOK.md`; `fleet/CONTRACT.md` is the authority for every
literal. Nothing here is a command a human has to type: the agent runs the
commands and reads the answers back, and after each one it re-runs the doctor.

## exe-dev

Every VM in the fleet lives on exe.dev, and the `exe.dev` SSH alias is how you
create, list and delete them. This row is `missing` when the alias does not
resolve or the account rejects the key — nothing below it can be checked until
it answers.

**In a browser:** sign up at exe.dev and register a public key on the account.

**The agent runs** `ssh exe.dev whoami` — the command the doctor runs — and, if
the alias is not in `~/.ssh/config` yet, adds it:

```
Host *.exe.xyz exe.dev
  StrictHostKeyChecking accept-new
  IdentitiesOnly yes
  IdentityFile ~/.ssh/id_ed25519
```

Three things a stranger will not know:

- `exe.dev` is an SSH host entry, not a URL. Nothing here talks to a web API,
  and `IdentitiesOnly yes` is the line that keeps a laptop with many loaded
  keys from offering the wrong one first and being refused before it reaches
  this one.
- The `*.exe.xyz` pattern matters as much as `exe.dev` itself: a run VM is
  reached over ssh at the `ssh_dest` that `ls --json` reports, and its status
  page is `https://<vm>.exe.xyz/status.json`.
- **This key launches.** A second key registered with `ssh-key add --tag=fleet`
  sees and reaps only fleet-tagged VMs, and cannot bind a credential; that is
  the one for a machine that only reaps by hand, never the one that launches.

Until this row is `ok`, expect every row below it to read `missing` too: they
are all `ssh` commands, and without a working account none of them can land.
Fix this row first and run the doctor again before touching the others.

## capacity

Not a health check — arithmetic. `ssh exe.dev "billing plan --json"` reports
the account's pool (`max_cpus`, `max_memory_gb`), and `~/.ultrapowers/fleet.json`
says how large one run asks to be. The row reports both and limits neither: its
green detail is the pool and the size one run asks for, in the shape
`XLarge pool 16 vCPU / 64GB; a run asks 4 vCPU / 8GB`. It is `missing` only for
an unreadable pool (`billing plan --json` failing or answering no numbers) or an
unparseable config (`cpu` not an integer, `memory` not `<int>GB`). The agent
writes the file with both keys explicitly — these are also the defaults, and a
key nothing reads (one left by a fleet from before the lift) turns the row red
until it is removed:

```json
{
  "cpu": "8",
  "memory": "16GB"
}
```

The one other name the file may carry is the account key of the `accounts` row
below; anything else is stale.

**In a browser:** nothing, unless the answer is a bigger plan.

**The agent runs** the doctor and, if the row is red, edits that file.

Two things a newcomer would not know:

- **Allocation on exe.dev is over-committable, and contention is the bound.**
  56 vCPU were allocated on the 16-vCPU plan and no `new` was refused, and on
  2026-09-05 six runs asking 24 vCPU ran concurrently — the pool is not a
  ceiling on how many runs are live at once. What bites is contention on the
  shared machine, and #667 is measuring where.
- **`memory` is `<int>GB` or `<int>G`.** A bare number, or a fractional
  `1.5GB`, is unreadable and turns the row red before the pool is even
  consulted. A missing file means the defaults;
  a key nothing reads is named in the red detail, and the agent rewrites the
  file with the keys that are read.

## claude

The Claude subscription reaches a sandbox as an exe.dev integration named
`claude-max`: an http-proxy whose bearer is injected at the network edge. The
VM never holds the token, never sees it, and cannot read it back. This row is
`ok` when the object carries the bearer header **and** rides no tag.

**In a browser:** claude.ai shows a consent page and then a code. Approve, and
copy the code.

**The agent runs:**

```bash
node <plugin-root>/fleet/claude-token.mjs login --code-from-clipboard
```

`--code-from-clipboard` is why you only copy: the tool reads the code off the
clipboard rather than asking you to paste it into a terminal. It exchanges the
code, keeps the refresh token in your login keychain, and sets the bearer on
`claude-max` on stdin. Nothing is printed. The launcher refreshes it before
every run.

Three things this command hides:

- **`--bearer=-` reads the token from stdin.** That is why the value is piped
  rather than typed: it never appears in a shell history, in an `--env`, in any
  argv, or in this conversation. Rotation is one
  `integrations edit claude-max --bearer=-` with a fresh token on stdin.
- **Inject the bearer and nothing else.** The proxy forwards Claude Code's own
  headers, and an injected header of the same name replaces the client's
  (measured 2026-09-03), so an injected `anthropic-beta` list would destroy the
  flags the CLI sends. Two edit traps: `--clear-header` removes the bearer too,
  and any `integrations edit claude-max` should pass `--bearer=-` again in the
  same command; read the result from `integrations list --json`, never from a
  request made seconds after the edit.
- **`claude-max` on `tag:fleet` is red.** A tag binding is a standing
  credential on every fleet VM for as long as the object lives; the launcher
  binds it to one VM, at creation, for the run's window. The doctor's detail
  carries `claude-token`'s own status line too — a laptop with no refresh token
  in its keychain is a warning inside a green row, because the bearer already
  lives at the edge and only the next refresh needs the keychain.

## accounts

One Claude account is one item in your login keychain, and every one of them
lives under the same keychain service — the account name is what tells them
apart. This row lists each item with its expiry, says which account the edge is
carrying, and is `missing` when the keychain holds nothing at all, or when
`~/.ultrapowers/fleet.json` names an account no keychain item carries. An
expired item is not red: the launcher refreshes it before the run that uses it.

**In a browser:** claude.ai's consent page again — once for each account you
add, signed in as that account.

**The agent runs** this to add a second account without moving the edge off the
first:

```bash
node <plugin-root>/fleet/claude-token.mjs login --code-from-clipboard \
  --account <name> --no-install
```

then `node <plugin-root>/fleet/claude-token.mjs accounts` to list what the
keychain holds, and `node <plugin-root>/fleet/claude-token.mjs usage` for the
table of what each one has spent against its limits.

To make an account the default for every run, the agent adds the `"account"`
key to `~/.ultrapowers/fleet.json`:

```json
{
  "cpu": "8",
  "memory": "16GB",
  "account": "<name>"
}
```

and the launcher's `--account <name>` overrides it for one run. Whichever wins,
the install writes `account=<name>` into the `claude-max` integration's comment,
which is where this row reads the edge's account from; an integration whose
comment predates that says `edge account unrecorded`, and the next refresh
records it.

Three things a newcomer would not know:

- **`--no-install` is the half that matters.** Without it, a login also sets
  the bearer on `claude-max`, which moves the edge onto the account you just
  added. With it, the exchange stops at the keychain: the new account is
  available to pick, and every run still goes out on the account the edge
  already carries.
- **The refresh token rotates on every use.** A record copied to another laptop
  is dead the first time either machine refreshes, so there is no such thing as
  sharing one keychain item across two machines. Each machine logs in for
  itself; the accounts are the same, the items are not.
- **Metering refreshes an item without touching the edge.** Reading `usage`
  spends a refresh and rewrites the keychain item, and it changes nothing about
  which account the edge carries. Switching accounts is per run and never
  mid-run: a sandbox is launched on one account and stays on it until it dies.

## github

`ssh exe.dev "integrations setup github --list"` prints the GitHub accounts
this exe.dev account has linked. No account means the browser step has never
been walked, and every GitHub object below it would be created against nothing.

**In a browser:** approve the GitHub app install for your account, and pick the
repositories it may see.

**The agent runs:**

```bash
ssh exe.dev "integrations setup github"
```

which opens the install — follow what it prints.

Three things a newcomer would not know:

- **`--list` has no `--json`.** Passing it is a flag-parsing error, so the
  doctor reads the two-line text form the command does print.
- **This is the account link `--act-as-user` needs.** Until it exists, a run's
  pushes and its PR are authored by the installation bot rather than by you;
  the status page's `prAuthor` says which one you got.
- **Keep it personal, not a team.** `--act-as-user` is unavailable on team
  integrations, so on an exe.dev team account every PR is authored by
  `exe-dev-github-integration[bot]` and nothing you do to the integration
  changes that. It is walked once per exe.dev account, not once per
  repository — the per-repository objects are the next row.

## integrations

An exe.dev integration is a credential injected at the network edge: the VM
sends an ordinary request to a `*.int.exe.xyz` host and the platform attaches
the secret on the way out. Bindings are per VM or per tag, and time-boxed.
This row is the GitHub half of that: one object per repository you drive,
`gh-<owner>-<repo>`, created attached to nothing, and no GitHub integration
riding the shared tag.

**In a browser:** nothing.

**The agent runs** this for each repository you drive, which skips an object
that already exists:

```bash
node <plugin-root>/fleet/target.mjs <owner>/<repo>
```

and, when something is riding the shared tag, the detach the doctor names:

```bash
ssh exe.dev "integrations detach <name> tag:fleet"
```

`target.mjs` is one call underneath:

```bash
ssh exe.dev "integrations add github --name gh-<owner>-<repo> \
  --repository <owner>/<repo> --act-as-user"
```

The doctor only asks about a target's object when you pass
`--target <owner>/<repo>`, so a fleet with no targets yet is still `ready`.

Three things this command hides:

- **Nothing rides the tag.** A GitHub object on `tag:fleet` is granted to every
  fleet VM, standing, for as long as the object lives — including the
  account-wide object a pre-lift fleet was built with. The doctor turns this
  row red for any of them. The launcher binds `gh-<owner>-<repo>` to one VM, at
  creation, for the run's window.
- **Never two GitHub integrations naming one repository on one VM.** exe.dev's
  GitHub edge routes by repo path and documents no tie-break between them
  (measured 2026-09-03), so the sandbox refuses to boot into that.
- **`gh auth status` on a VM is meaningless.** The credential is at the edge,
  not on the box, and the edge proxies only that repository's own paths. A
  target with no object is a launch refusal, public repo or not: the clone
  would work and the push would not.

## verb-drift

`fleet/exe-verbs.json` is the flag set of every lobby verb the fleet drives,
recorded verb by verb with the date it was captured. The doctor and the
launcher re-fetch `help <verb>` for each of them and diff what the lobby prints
today against what is recorded. A flag that appeared or vanished is a
**finding** printed inside a green row — the lobby moving is news, not a
failure, and nothing is refused over it. The row is `missing` only when the
record itself cannot be read: absent, not JSON, or carrying no `verbs` object.

**In a browser:** nothing. This row is about the lobby's own help text.

**The agent runs** the doctor, and when the row reports a drift, re-captures the
verbs it named:

```bash
ssh exe.dev "help <verb>"
```

and edits `fleet/exe-verbs.json` — the flag names out of that `Options:` block,
in the verb's array — then bumps the file's `capturedAt` to today's date.

Three things a newcomer would not know:

- **The record stores flag names, not help text.** `help <verb>` prints prose —
  a `Command:` line, a description, an optional `Usage:` line, an `Options:`
  block, sometimes `Examples:` — and prose churns for reasons nobody needs to
  hear about. The diff unit is the set of `--flags` in the `Options:` block, so
  a reworded description is silent and a removed flag is not.
- **`help <verb>` and `<verb> --help` print the same block.** The doctor asks
  the first form on purpose: `help …` runs nothing, while `new --help` starts
  with the `new` verb, and the fleet's own exams treat any line starting with a
  mutating verb as a launch.
- **An unreadable answer is a finding too, not a red row.** A verb the lobby no
  longer recognises answers `No help available for unrecognized command:` at
  exit 0, and a verb whose name is not plain lower-case words is never sent to
  the lobby at all; both are reported as `help unreadable` inside the same green
  row, with the exit code that came back.
