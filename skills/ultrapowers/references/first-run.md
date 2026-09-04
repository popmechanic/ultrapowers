# First run — one section per doctor row

`node <plugin-root>/fleet/doctor.mjs --json` answers with three rows in a fixed
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

Until this row is `ok`, expect the two rows below it to read `missing` too:
both are `ssh` commands, and without a working account neither can land. Fix
this row first and run the doctor again before touching the others.

## integrations

An exe.dev integration is a credential injected at the network edge: the VM
sends an ordinary request to a `*.int.exe.xyz` host and the platform attaches
the secret on the way out. The VM never holds it, never sees it, and cannot
read it back. Attachments are per VM or per tag, and time-boxed.

Three objects, and the doctor names whichever one is wrong first:

| object | what it is | attached to |
|---|---|---|
| `claude-max` | the Claude subscription, as an http-proxy | per run, per VM, `--for 6h` |
| `fleet-runs` | the private repo holding plans, receipts and status | `tag:fleet` |
| `gh-<owner>-<repo>` | one target repository, read and write | per run, per VM, `--for 6h`, at launch |

`claude-max` is built by hand, because its bearer is a token from a browser
flow:

```bash
node fleet/claude-token.mjs login
```

Browser consent on claude.ai, copy the code it shows, press Enter: the tool
exchanges it, keeps the refresh token in your keychain, and sets the bearer on
`claude-max` on stdin. Nothing is printed. The launcher refreshes it before
every run.

The GitHub objects are one command per account and one per repository you
will drive, and ultrapowers itself is one of them.
`node <plugin-root>/fleet/target.mjs <owner>/<repo>` runs the last line for
you and skips an object that exists:

```bash
ssh exe.dev "integrations add github --name fleet-runs \
  --repository popmechanic/fleet-runs --act-as-user"
ssh exe.dev "integrations attach fleet-runs tag:fleet"
ssh exe.dev "integrations add github --name gh-<owner>-<repo> \
  --repository <owner>/<repo> --act-as-user"
```

The doctor only asks about a target's object when you pass
`--target <owner>/<repo>`, so a fleet with no targets yet is still `ready`.

Three things these commands hide:

- **`--bearer=-` reads the token from stdin.** That is why the value is piped
  from the file rather than typed: it never appears in a shell history, in an
  `--env`, in the golden image, or in this conversation. After the integration
  exists the local file has no further use — delete it. Rotation is one
  `integrations edit claude-max --bearer=-` with a fresh token on stdin.
- **Inject the bearer and nothing else.** The proxy forwards Claude Code's own
  headers, and an injected header of the same name replaces the client's
  (measured 2026-09-03), so an injected `anthropic-beta` list would destroy the
  flags the CLI sends. Two edit traps: `--clear-header` removes the bearer too,
  and any `integrations edit claude-max` should pass `--bearer=-` again in the
  same command; read the result from `integrations list --json`, never from a
  request made seconds after the edit.
- **Only `fleet-runs` rides the tag.** `claude-max` and `gh-<owner>-<repo>`
  are attached to one VM for the run's six hours, at launch. On the shared tag
  either would be a standing credential on every VM on the account. And never
  two GitHub integrations naming one repository on one VM: exe.dev's GitHub
  edge routes by repo path and documents no tie-break between them, so the
  sandbox refuses to boot into that, and the doctor turns the row red for any
  GitHub object but `fleet-runs` on the tag. `gh auth status` on a VM is
  meaningless — the credential is at the edge, and the edge proxies only the
  repository's own paths.

## golden

The image every run VM is copied from: node, bun, npm, pytest with xdist,
`busybox`, `gh`, the immutable bootstrap at `/home/exedev/fleet-bootstrap.sh`,
and the user unit template `fleet-run@.service`, installed but never enabled.
A `cp` of it takes seconds and inherits the `fleet` tag. The engine is not in
the image: each run's bootstrap clones it at the sha the assignment names, into
`/home/exedev/engines/<sha>`.

The launcher starts a run as `systemctl --user start fleet-run@<N>.service`
over ssh, with no `--no-block`: the unit is `Type=exec`, so the command
returns once the bootstrap is running and fails when it could not start, and
the launcher prints that failure verbatim. When a run has left no status page,
its unit's own log needs no environment variable:

```bash
ssh <ssh_dest> 'journalctl _SYSTEMD_USER_UNIT=fleet-run@<N>.service --no-pager -n 200'
```

It is built by `fleet/golden-setup.sh`, and the build stamps that script's
sha256 into `/home/exedev/.fleet-golden`, last. The doctor's row is that
comparison and nothing else: an image whose stamp does not equal the script's
hash is not broken, it is **old** — the plugin moved on and the golden did not.

Three commands, in this order:

```bash
sh <plugin-root>/fleet/golden.sh build <fresh-name>
sh <plugin-root>/fleet/golden.sh verify <fresh-name>
sh <plugin-root>/fleet/golden.sh swap --from <fresh-name> --to fleet-golden
```

Three things a newcomer would not know:

- **Pick a name you have never used.** exe.dev keeps a deleted VM's name
  reserved, so a rebuild under an old name is refused. `verify` is not optional
  and `swap` is separate for a reason: the golden in use keeps serving runs
  while the new one is built and checked, and the swap is the only step that
  changes what a launch copies. Never delete the golden to make room for a
  rebuild — a build that then fails leaves no image at all.
- **Never `defaults write dev.exe new.setup-script`.** That setting is
  account-wide: it would apply the fleet's first-boot script to every VM you
  ever create. The script is passed to the one `new` that builds the golden
  and nowhere else.
- **The golden carries no `ANTHROPIC_*` anywhere.** Auth precedence puts an API
  key ahead of the subscription, so a stray variable in the image bills a
  gateway instead of the Max plan, silently, for every run. The base URL is
  set on the engine service's environment only, per run.

Take the three commands in order and stop at the first one whose output
surprises you.
