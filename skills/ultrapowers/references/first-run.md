# First run — one section per doctor row

`node <plugin-root>/fleet/doctor.mjs --json` answers with five rows in a fixed
order. Each row that is not `ok` has a section here, named for the row's `id`.
A section says what the piece is, gives the commands that build it, and names
the two or three things a newcomer would not know. The commands are the ones
in `fleet/RUNBOOK.md`; `fleet/CONTRACT.md` is the authority for every literal.

Commands a human runs interactively are offered as `! <command>`, so the human
runs them and sees the output. After each one, re-run
`! node <plugin-root>/fleet/doctor.mjs --json` and read the row back.

## exe-dev

Every VM in the fleet lives on exe.dev, and the `exe.dev` SSH alias is how you
create, copy and delete them. This row is `missing` when the alias does not
resolve or the account rejects the key — nothing below it can be checked until
it answers.

Build it by signing up at exe.dev, registering a public key on the account
through the web UI, and pointing `~/.ssh/config` at that key:

```
Host *.exe.xyz exe.dev
  StrictHostKeyChecking accept-new
  IdentitiesOnly yes
  IdentityFile ~/.ssh/id_ed25519
```

Then `! ssh exe.dev whoami` — the command the doctor runs — should print your
username.

Three things a stranger will not know:

- `exe.dev` is an SSH host entry, not a URL. Nothing here talks to a web API,
  and `IdentitiesOnly yes` is the line that keeps a laptop with many loaded
  keys from offering the wrong one first and being refused before it reaches
  this one.
- The `*.exe.xyz` pattern matters as much as `exe.dev` itself: a run VM is
  reached over ssh at the `ssh_dest` that `ls --json` reports, and its status
  page is `https://<vm>.exe.xyz/status.json`.
- **This key launches.** `integrations attach` is refused to a tag-scoped key,
  so the laptop keeps the account key. A second
  key registered with `ssh-key add --tag=fleet` sees and reaps only
  fleet-tagged VMs; that is the one to put behind the janitor's cron.

Until this row is `ok`, expect every row below it to read `missing` too: they
are all `ssh` commands, and without a working account none of them can land.
Fix this row first and run the doctor again before touching the others.

## capacity

Not a health check — arithmetic. `ssh exe.dev "billing plan --json"` reports
the account's pool (`max_cpus`, `max_memory_gb`), and `~/.ultrapowers/fleet.json`
says how large one run asks to be. The row is `ok` when the pool holds a run of
that size, and its detail says how many such runs fit at once. The two keys and
their defaults:

```json
{
  "cpu": "8",
  "memory": "16GB"
}
```

`memory` is `<int>GB` or `<int>G`; a bare number, or a fractional `1.5GB`, is
unreadable and turns the row red before the pool is even consulted.

Three things a newcomer would not know:

- **A pool a run cannot fit in is a run asked too large, not a broken
  account.** That is why the red detail names `~/.ultrapowers/fleet.json`: the
  cheap fix is lowering `cpu`/`memory`, and the expensive one is a bigger plan.
- **The number in the green detail is the width of a wave.** It is the pool's
  vCPUs divided by one run's, so a plan whose pool fits three runs cannot carry
  a wave of seven — the eighth `cp` is refused when the pool is already spent.
- **The golden's own size is not this number.** Every run VM is a copy, and the
  copy asks for `cpu`/`memory`; the pool is account-wide and shared with
  anything else you have running on it, the golden included.

## claude

The Claude subscription reaches a sandbox as an exe.dev integration named
`claude-max`: an http-proxy whose bearer is injected at the network edge. The
VM never holds the token, never sees it, and cannot read it back. This row is
`ok` when the object carries the bearer header **and** rides no tag.

It is built by hand, because its bearer comes from a browser flow:

```bash
node fleet/claude-token.mjs login
```

Browser consent on claude.ai, copy the code it shows, press Enter: the tool
exchanges it, keeps the refresh token in your keychain, and sets the bearer on
`claude-max` on stdin. Nothing is printed. The launcher refreshes it before
every run.

Three things this command hides:

- **`--bearer=-` reads the token from stdin.** That is why the value is piped
  rather than typed: it never appears in a shell history, in an `--env`, in the
  golden image, or in this conversation. Rotation is one
  `integrations edit claude-max --bearer=-` with a fresh token on stdin.
- **Inject the bearer and nothing else.** The proxy forwards Claude Code's own
  headers, and an injected header of the same name replaces the client's
  (measured 2026-09-03), so an injected `anthropic-beta` list would destroy the
  flags the CLI sends. Two edit traps: `--clear-header` removes the bearer too,
  and any `integrations edit claude-max` should pass `--bearer=-` again in the
  same command; read the result from `integrations list --json`, never from a
  request made seconds after the edit.
- **`claude-max` on `tag:fleet` is red.** A tag attachment is a standing
  credential on every fleet VM for as long as the object lives; the launcher
  attaches it to one VM `--for 6h`, at launch. The doctor's detail carries
  `claude-token`'s own status line too — a laptop with no refresh token in its
  keychain is a warning inside a green row, because the bearer already lives at
  the edge and only the next refresh needs the keychain.

## github

`ssh exe.dev "integrations setup github --list"` prints the GitHub accounts
this exe.dev account has linked. No account means the browser step has never
been walked, and every GitHub object below it would be created against nothing:

```bash
ssh exe.dev "integrations setup github"
```

Three things a newcomer would not know:

- **`--list` has no `--json`.** Passing it is a flag-parsing error, so the
  doctor reads the two-line text form the command does print.
- **This is the account link `--act-as-user` needs.** Until it exists, a run's
  pushes and its PR are authored by the installation bot rather than by you;
  the status page's `prAuthor` says which one you got.
- **It is walked once per exe.dev account, not once per repository.** The
  per-repository objects are the next row.

## integrations

An exe.dev integration is a credential injected at the network edge: the VM
sends an ordinary request to a `*.int.exe.xyz` host and the platform attaches
the secret on the way out. Attachments are per VM or per tag, and time-boxed.
This row is the GitHub half of that: one object per repository you drive,
`gh-<owner>-<repo>`, created attached to nothing, and no GitHub integration
riding the shared tag.

`node <plugin-root>/fleet/target.mjs <owner>/<repo>` runs this for you and
skips an object that already exists:

```bash
ssh exe.dev "integrations add github --name gh-<owner>-<repo> \
  --repository <owner>/<repo> --act-as-user"
```

The doctor only asks about a target's object when you pass
`--target <owner>/<repo>`, so a fleet with no targets yet is still `ready`.

Three things this command hides:

- **Nothing rides the tag.** A GitHub object on `tag:fleet` is granted to every
  fleet VM, standing, for as long as the object lives — including the
  account-wide runs object a pre-lift fleet was built with. The doctor turns
  this row red for any of them and names the
  `ssh exe.dev "integrations detach <name> tag:fleet"` that repairs it. The
  launcher attaches `gh-<owner>-<repo>` to one VM `--for 6h`, at launch.
- **Never two GitHub integrations naming one repository on one VM.** exe.dev's
  GitHub edge routes by repo path and documents no tie-break between them
  (measured 2026-09-03), so the sandbox refuses to boot into that.
- **`gh auth status` on a VM is meaningless.** The credential is at the edge,
  not on the box, and the edge proxies only that repository's own paths. A
  target with no object is a launch refusal, public repo or not: the clone
  would work and the push would not.

---

### Not a doctor row: the golden

The doctor never touches the image runs are copied from, because a stale golden
is not a broken fleet. `fleet/RUNBOOK.md` §The golden has the build:
`sh <plugin-root>/fleet/golden.sh build|verify|swap`, under a fresh name every
time — exe.dev keeps a deleted VM's name reserved, and the golden in service
keeps serving runs until `swap`.

Two of its properties belong to reading a run, so they are worth knowing here.
The engine is not in the image: each run's bootstrap clones it at the sha the
assignment names, into `/home/exedev/engines/<sha>`. And the launcher starts a
run as `systemctl --user start fleet-run@<N>.service` over ssh, with no
`--no-block`: the unit is `Type=exec`, so the command returns once the
bootstrap is running and fails when it could not start, and the launcher prints
that failure verbatim. When a run has left no status page, its unit's own log
needs no environment variable:

```bash
ssh <ssh_dest> 'journalctl _SYSTEMD_USER_UNIT=fleet-run@<N>.service --no-pager -n 200'
```
