# First run — one section per doctor row

`node <plugin-root>/fleet/doctor.mjs --json` answers with three rows in a fixed
order. Each row that is not `ok` has a section here, named for the row's `id`.
A section says what the piece is, gives the one command that builds it, and
names the two or three things a newcomer would not know.

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
- The `*.exe.xyz` pattern matters as much as `exe.dev` itself: the golden and
  every run VM are reached by name under that domain, so a config stanza that
  covers only the lobby leaves both rows below unreadable.
- **Rate limits are per key.** The key that runs the janitor should be
  registered separately, with `ssh-key add --tag=fleet`, so it can act only on
  fleet-tagged VMs. That is the narrowest credential exe.dev offers and the
  only long-lived secret the fleet keeps on any disk.

Until this row is `ok`, expect the two rows below it to read `missing` too:
both are `ssh` commands, and without a working account neither can land. Fix
this row first and run the doctor again before touching the others.

## integrations

An exe.dev integration is a credential injected at the network edge: the VM
sends an ordinary request to a `*.int.exe.xyz` host and the platform attaches
the secret on the way out. The VM never holds it, never sees it, and cannot
read it back. Attachments are per VM or per tag, and time-boxed.

Five objects, and the doctor names whichever one is wrong first:

| object | what it is | attached to |
|---|---|---|
| `fleet-runs` | the private repo holding plans, receipts and evidence | `tag:fleet` |
| `claude-max` | the Claude subscription, as an http-proxy | per run, never a tag |
| `notify` | the push channel a run reports on | `tag:fleet` |
| `t-<owner>-<repo>-ro` | read access to one target repository | `tag:fleet` |
| `t-<owner>-<repo>-rw` | write access to that target | per run, never a tag |

The per-target pair is one command:

```bash
node <plugin-root>/fleet/target.mjs add <owner>/<repo>
```

Run it once per repository you will drive; ultrapowers itself is one of them.
The doctor only asks about a target's pair when you pass
`--target <owner>/<repo>`, so a fleet with no targets yet is still `ready`.

`claude-max` is the one you build by hand, because its bearer is a token from
a browser flow:

```bash
claude setup-token > ~/.fleet-oauth-token
chmod 600 ~/.fleet-oauth-token
ssh exe.dev "integrations add http-proxy --name claude-max \
  --target https://api.anthropic.com --bearer=- \
  --header 'anthropic-beta: <the beta list>'" < ~/.fleet-oauth-token
rm ~/.fleet-oauth-token
```

Three things that command hides:

- **`--bearer=-` reads the token from stdin.** That is why the value is piped
  from the file rather than typed: it never appears in a shell history, in an
  `--env`, in the golden image, or in this conversation. After the integration
  exists the local file has no further use — delete it. Rotation is one
  `integrations edit claude-max --bearer=-` with a fresh token on stdin.
- **The `anthropic-beta` header is a build input, not decoration.** The proxy
  does not forward the client's own beta header, so the nine flags Claude Code
  sends have to be injected here or `claude -p` answers 400 on a beta it was
  counting on. Re-capture the list when the CLI version changes, and rebuild
  the golden — the two travel together.
- **A writable integration is never attached to a tag.** `claude-max` and the
  `-rw` half of a target pair are granted per VM, for a bounded window, at
  launch and at approval. On the shared tag they would be a standing grant to
  every VM on the account for as long as the object lives — which is the
  posture this whole arrangement exists to remove. The doctor turns the row red
  for a tag attachment on either of them.

`notify` is enabled once from exe.dev's Integrations page and attached to
`tag:fleet`; nothing else has to be done to it.

## golden

The image every sandbox is copied from: node, the engine clone with its
dependencies installed, pytest and Bun, warm. A `cp` of it takes seconds and
inherits the `fleet` tag, so a run's cost and its failure modes are mostly
decided here.

It is built by a script that is checked into this repo, and the build stamps
that script's sha256 into `/home/exedev/.fleet-golden`. The doctor's row is
that comparison and nothing else: an image whose stamp does not equal
`fleet/golden-setup.sh`'s hash is not broken, it is **old** — the plugin moved
on and the golden did not.

Three commands, in this order:

```bash
sh <plugin-root>/fleet/golden.sh build fleet-golden-next
sh <plugin-root>/fleet/golden.sh verify fleet-golden-next
sh <plugin-root>/fleet/golden.sh swap
```

Three things a newcomer would not know:

- **`verify` is not optional and `swap` is separate for a reason.** The golden
  in use keeps serving runs while the new one is built and checked; the swap is
  the only step that changes what a launch copies, and it is one rename. Never
  delete the golden to make room for a rebuild — a build that then fails leaves
  no image at all. A build that fails verify costs a VM, not a run.
- **Never `defaults write dev.exe new.setup-script`.** That setting is
  account-wide: it would apply the fleet's first-boot script to every VM you
  ever create, including ones that have nothing to do with a run. The script is
  passed to the one `new` that builds the golden and nowhere else.
- **The golden carries no `ANTHROPIC_*` anywhere.** Auth precedence puts an API
  key ahead of the subscription, so a stray variable in the image bills a
  gateway instead of the Max plan, silently, for every run. The base URL is set
  by the boot unit on the engine's child process only.

The build quiesces the image before the first copy, because `cp` is not
promised to be application-consistent. Take the three commands in order and
stop at the first one whose output surprises you.
