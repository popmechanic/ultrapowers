# First run — one section per doctor row

`node <plugin-root>/fleet/doctor.mjs --json` answers with five rows in a fixed
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
  the one to put behind the janitor's cron, never the one that launches.

Until this row is `ok`, expect every row below it to read `missing` too: they
are all `ssh` commands, and without a working account none of them can land.
Fix this row first and run the doctor again before touching the others.

## capacity

Not a health check — arithmetic. `ssh exe.dev "billing plan --json"` reports
the account's pool (`max_cpus`, `max_memory_gb`), and `~/.ultrapowers/fleet.json`
says how large one run asks to be. The row is `ok` when the pool holds a run of
that size, and its detail says how many such runs fit at once. The file has
exactly two keys, both optional, and these are also the defaults:

```json
{
  "cpu": "8",
  "memory": "16GB"
}
```

**In a browser:** nothing, unless the answer is a bigger plan.

**The agent runs** the doctor and, if the row is red, edits that file.

Three things a newcomer would not know:

- **A pool a run cannot fit in is a run asked too large, not a broken
  account.** That is why the red detail names `~/.ultrapowers/fleet.json`: the
  cheap fix is lowering `cpu`/`memory`, and the expensive one is a bigger plan.
- **`memory` is `<int>GB` or `<int>G`.** A bare number, or a fractional
  `1.5GB`, is unreadable and turns the row red before the pool is even
  consulted. An unknown key in the file is ignored, and a missing file means
  the defaults.
- **The number in the green detail is the width of a wave of runs.** It is the
  pool's vCPUs divided by one run's, so a plan whose pool fits three runs
  cannot carry seven at once; the fourth `new` is refused when the pool is
  already spent, and the pool is shared with anything else you have running.

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
