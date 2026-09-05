# Launch preflight and credentials: N keychain accounts, one usage table, a per-run account, and a lobby verb-drift finding

**Grammar:** claims-v1

**Claim:** After this run I can keep more than one Claude account in the fleet's keychain, each
under its own name; `node fleet/claude-token.mjs usage` shows me one table with every account's
five-hour and weekly utilization; a launch says which account it spends on and refreshes exactly
that one before any VM exists; and the doctor tells me which exe.dev flags changed under the
fleet as a finding in a green row, instead of a run dying on the change. (elicited)

**Goal:** Bundle R7 of the 2026-09-05 wave — launch preflight and credentials. Three tasks in two
waves. (1) `fleet/claude-token.mjs` takes `--account <name>` on `login`, `refresh` and `status`,
keeps one keychain item per account under the one service it already uses (the BASE item,
account `ultrapowers`, is the default and keeps working untouched), stamps the edge object with
`account=<name>` in its comment, and grows two read-only verbs: `accounts`, the list of entries
and their expiry, and `usage`, one table of every account's `/api/oauth/usage` read, refreshing a
stale entry on use without touching the edge. (2) `fleet/doctor.mjs` gains two rows —
`accounts`, the entries the keychain holds and which one the edge carries, and `verb-drift`, the
diff of each lobby verb's live `help <verb>` flags against the record `fleet/exe-verbs.json`,
reported as a finding in a green row and never a refusal — accepts `account` in
`~/.ultrapowers/fleet.json`, and `skills/ultrapowers/references/first-run.md` grows the two
matching sections. (3) `fleet/launch.mjs` takes `--account <name>` (else the config's `account`,
else `ultrapowers`), refreshes exactly that entry before the plan is pushed, records it in the
result and the printed lines, and runs the same verb-drift comparison as a preflight line. The
assignment comment does not change: the sandbox's parser refuses any key it does not know, and
the sandbox is another run's to change.
**Closes:** #513 #610

**Tech Stack:** Node 24 ESM (`fleet/claude-token.mjs`, `fleet/doctor.mjs` — built-ins only,
`node:` specifiers and nothing else — `fleet/launch.mjs`, the `fleet/tests/test_*.mjs` sims, each
printing `ALL TESTS PASSED` and opening no socket; the keychain, the clipboard, the token
endpoint and the lobby reach `claude-token.mjs` only through its `deps` seam, the lobby reaches
the doctor only through its `exec` seam and the launcher only through the `exec` seam of
`fleet/tests/_lobby_helpers.mjs`), JSON (`fleet/exe-verbs.json`), Markdown
(`skills/ultrapowers/references/first-run.md`), Python 3 (`python3 -m pytest`). Nothing is added
to any dependency file; no Anthropic SDK and no API key anywhere — the one HTTPS read this plan
adds is a laptop-side `GET` with the account's own OAuth bearer.

**Spec:** none — #513's superseding note of 2026-09-05 and #610's body are the whole charter;
every fact a worker needs from them, and every fact measured on exe.dev and on the usage endpoint
on 2026-09-05, is in its task's Context, because the sandbox has no `docs/superpowers/` and no
lobby.

**Parallelization rationale:** Two waves. Wave 1 is width 2: the credential task
(`fleet/claude-token.mjs` and its exam) and the doctor task (`fleet/doctor.mjs`,
`fleet/exe-verbs.json`, `first-run.md` and the two doctor exams) share no file; the one shape
they both know — the JSON `accounts --json` prints and the doctor parses — is a literal repeated
in both Contexts, never a `Consumes:`. Wave 2 is width 1: the launch task `Consumes:` the
doctor's `verbDrift` and `fleetConfigAccount`, and its exam imports `fleet/launch.mjs`, which
imports them from `fleet/doctor.mjs` — a clone at BASE would fail at import, so the chain is the
one rule 2 allows: the launcher needs the doctor's runtime export, not its shape. The two rows
and their `first-run.md` headings stay in one task because `tests/test_docs_agree_with_code.py`
pins `ROW_IDS` to the headings in order, and two tasks inserting into one array literal in one
wave would fold on one line.

## Global Constraints

- Check: test "$(git hash-object fleet/lobby.mjs)" = 2f6289f1de89b48f5090b6a40d11a3d10c34b8b4
- Check: test "$(git hash-object fleet/sandbox-boot.sh)" = 0cdb604f808000016786b479e3c1a5af81e41131
- Check: test "$(git hash-object fleet/tests/_lobby_helpers.mjs)" = 86c4674085d8fefc940938ef80553e4b945ebb34
- Check: node --check fleet/claude-token.mjs
- Check: node --check fleet/doctor.mjs
- Check: node --check fleet/launch.mjs
- Check: ! grep -q claude-oauth-token skills/ultrapowers/references/first-run.md
- No command this plan adds prints an access token, a refresh token or an authorization code:
  every secret rides a `deps` seam, the keychain, or stdin.
- The assignment comment's shape is BASE's: `run= plan= target= base= engine=` then the
  optional `overlap= tier= effort= hold=`, and no other key.
- `fleet/doctor.mjs` imports only `node:`-prefixed specifiers and no sibling fleet module; its
  source carries neither the word fits nor the phrase cannot hold.
- The keychain service stays `ultrapowers-claude-oauth`; the BASE item (account `ultrapowers`)
  is read and written exactly as at BASE when no `--account` is given.
- Under `fleet/`, no file carries the copy verb's tag-copying flag (banned by the sweep in
  `fleet/tests/test_launch.mjs`), so the verb record does not include `cp`.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: One keychain entry per account, and one usage table

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/claude-token.mjs`
- Test: `fleet/tests/test_claude_token.mjs`

**Claim:** custody = N keychain entries, one per account, named; (2) metering = the same
`/api/oauth/usage` read per entry, one table (quoted from #513)
Machine: M1. `login`, `refresh` and `status` take `--account <name>`, default `ultrapowers`:
the keychain item read and written is service `ultrapowers-claude-oauth`, account `<name>`,
through `deps.keychainRead(name)` and `deps.keychainWrite(name, value)`; the record written is
`{ refreshToken, accessToken, expiresAt }`; and with no `--account`, every BASE behaviour holds
against the item named `ultrapowers` — login exchanges the clipboard code and installs the
bearer, refresh rotates under the lock only inside `REFRESH_AHEAD_MS` unless `--force` and
writes the keychain before the edge, status prints the expiry and no token, an absent record
names the login verb. M2. `installBearer(deps, accessToken, name)` issues
`integrations edit claude-max --bearer - --comment account=<name>` when the object exists and
`integrations add http-proxy --name claude-max --target https://api.anthropic.com --bearer -
--comment account=<name>` when it does not, the token on stdin and in no verb; `login
--no-install` and `refresh --no-install` exchange or rotate, write the keychain, and issue no
`integrations` verb at all. M3. `accounts` answers one entry per keychain item under the
service — `deps.keychainList()` names them, each is read — as `[{ name, expiresAt, fresh }]`
with `expiresAt` an ISO-8601 string and `fresh` true exactly when `expiresAt` is after
`deps.now()`; `--json` prints that array as JSON on stdout, the plain form logs one
`<name> expires <ISO> (<n> min)` line per entry; an empty keychain answers `[]`; no output
carries a token. M4. `usage` answers one row per entry: an entry whose record has an
`accessToken` and a future `expiresAt` is read with it; any other entry is first rotated under
the lock — one refresh grant, the keychain rewritten with the new triple, no `integrations`
verb — then read; the read is `GET https://api.anthropic.com/api/oauth/usage` with header
`Authorization: Bearer <accessToken>`; a `200` row carries `fiveHour` and `sevenDay`, each
`{ utilization, resetsAt }` from `five_hour.utilization`/`five_hour.resets_at` and
`seven_day.utilization`/`seven_day.resets_at`; a refresh grant that fails or a non-`200` answer
leaves that row `unread` with a `reason` naming the status or the error, and every other row is
still answered; `renderUsage(rows)` prints a header line `account | 5h % | 5h resets | 7d % |
7d resets` and one line per row, an unread row printing `unread: <reason>` in the 5h column;
`--json` prints the rows as JSON; no output carries a token. M5. `main` routes
`login [--code-from-clipboard] [--account <name>] [--no-install]`,
`refresh [--force] [--account <name>] [--no-install]`, `status [--account <name>]`,
`accounts [--json]` and `usage [--json]`; an unknown verb rejects with the usage line; an
`--account` whose value is absent or does not match `^[A-Za-z0-9][A-Za-z0-9._-]*$` rejects
before any keychain read, token request or lobby verb.

**Authorized-by:** #513 (superseding note of 2026-09-05, items 1 and 2); #602 (the loom-style
credential this extends)

**Interfaces:**
- Consumes: none
- Produces: `main(argv: string[], deps?) -> Promise<object>`
- Produces: `accounts(deps) -> Array<{ name: string, expiresAt: string, fresh: boolean }>`
- Produces: `usage(deps) -> Promise<Array<{ name, fiveHour, sevenDay, unread, reason }>>`
- Produces: `renderUsage(rows) -> string`
- Produces: `installBearer(deps, accessToken: string, account: string) -> 'added' | 'edited'`
- Produces: `DEFAULT_ACCOUNT`
- Produces: `USAGE_URL`

**Context:** At BASE `fleet/claude-token.mjs` holds one keychain item, `KEYCHAIN = { service:
'ultrapowers-claude-oauth', account: 'ultrapowers' }`, read and written by unary seams
`keychainRead()` / `keychainWrite(value)` with `security find-generic-password -a <account> -s
<service> -w` and `security add-generic-password -U -a <account> -s <service> -w <value>`; the
record is `{ refreshToken, expiresAt }` and the access token is never stored — it goes to the
edge (`installBearer`) and is forgotten. This task keeps the service and makes the account the
name: `DEFAULT_ACCOUNT = 'ultrapowers'`, the seams become `keychainRead(name)` and
`keychainWrite(name, value)` (same two `security` verbs with `-a <name>`), and a third seam
`keychainList()` enumerates the accounts under the service by parsing `security dump-keychain`
(no `-d`, so no secret is dumped): the output is a sequence of items, each starting with a line
`class: "genp"` and carrying attribute lines of the form `    "acct"<blob>="ultrapowers"` and
`    "svce"<blob>="ultrapowers-claude-oauth"` (measured on the operator's laptop 2026-09-05, the
`svce` line may follow the `acct` line); an item whose `svce` equals the service contributes its
`acct`. The record grows `accessToken` so `usage` can read without spending a refresh grant
while the token is fresh; the loom flow stores the same three fields. The usage endpoint was
measured 2026-09-05 with a laptop OAuth access token: `GET
https://api.anthropic.com/api/oauth/usage` with only `Authorization: Bearer <token>` answers
`200` and a body whose `five_hour` and `seven_day` objects each carry `utilization` (a percent
as a number, `76.0`) and `resets_at` (an ISO-8601 instant); other keys exist and are ignored. An
unauthenticated call answers `429` and a bad token `401` (the sitting-2 controls) — both are
`unread: <status>`, never a throw. Refresh-on-use for `usage` must NOT install at the edge:
the edge carries the account a launch chose, and installing a second account's bearer to meter
it would switch every live sandbox to that account mid-run, which #513 forbids (prompt cache is
per account). So separate the rotation from the installation: `refresh(deps, { force,
account, install })` rotates and writes the keychain, then installs only when `install` is true
(the default; `--no-install` turns it off), and `usage` calls the rotation with `install:
false`. `login` gets the same `install` switch so a second account can be added without moving
the edge. The `--comment account=<name>` on the install verb is what lets the doctor say which
account the edge carries: `integrations edit --help` and `integrations add --help` both list
`--comment` (measured 2026-09-05); `integrations list --json` echoes it back as the entry's
`comment` field (the live `claude-max` entry carries a `comment` today), and `edit` replaces the
existing comment. The comment is the one thing that names an account in a lobby verb; the token
still rides stdin. The lock (`deps.lock`) stays a single directory lock for every account: two
accounts refreshing at once would serialize, which is fine, and the BASE single-flight legs stay
true. `accounts` is synchronous over the seams (`keychainList` then one `keychainRead` per name;
a name whose record does not parse is skipped); `usage` is async. `main` parses `--account
<value>` as the token after the flag; `--json` and `--no-install` are bare flags. The exam
`fleet/tests/test_claude_token.mjs` is extended by the examiner in its BASE shape (`harness()`
building `deps` with a stubbed clock, keychain, lobby and fetch, `leg(name, fn)` printing `ok -`
lines, the leg count and `ALL TESTS PASSED` last): its harness's keychain becomes a `Map` of
account → stored string, `keychainRead(name)` / `keychainWrite(name, value)` /
`keychainList()` reading and writing it, and its `record` option seeds the `ultrapowers`
entry; the BASE legs that `deepEqual` the stored record `{ refreshToken: 'refresh-1',
expiresAt: T0 + 3600 * 1000 }` gain `accessToken: 'access-1'`; the BASE legs that pin the edit
verb as `integrations edit ${INTEGRATION} --bearer -` and the add verb as `integrations add
http-proxy --name ${INTEGRATION} --target https://api.anthropic.com --bearer -` gain the trailing
`--comment account=ultrapowers`; the harness's `fetch` stub answers the usage URL with a
`{ five_hour, seven_day }` body and the token URL as at BASE; and the last BASE leg, `[global
constraint] the credential tool's code is unchanged … hashes as it did at BASE`, was #618's
guard on a comment-only change — this task changes code lines, so that leg is deleted, not
re-pinned. The clipboard-rule legs (`codeForState`, `cleanCode`, the comment above
`codeForState`) are untouched and stay green. The doctor (another task, same wave) runs `node
fleet/claude-token.mjs accounts --json` and parses exactly this shape:
`[{"name":"ultrapowers","expiresAt":"2026-09-05T20:00:00.000Z","fresh":true}]`. Keep every
BASE export (`OAUTH`, `INTEGRATION`, `TARGET`, `KEYCHAIN`, `LOCK_PATH`, `LOCK_STALE_MS`,
`REFRESH_AHEAD_MS`, `CLIPBOARD_POLL_MS`, `CLIPBOARD_WAIT_MS`, `pkce`, `authorizeUrlFor`,
`cleanCode`, `codeForState`, `defaultDeps`, `exchange`, `refreshGrant`, `integrationExists`,
`installBearer`, `readRecord`, `writeRecord`, `login`, `refresh`, `status`, `main`); `readRecord`
and `writeRecord` take the account as their second argument. Update the module's header
comment so it lists the five verbs and says the keychain holds one item per account.
**BASE facts:** (generated at af5edf8)
- `login` at `fleet/claude-token.mjs:246` blob 356883f
- `refresh` at `fleet/claude-token.mjs:267` blob 356883f
- `status` at `fleet/claude-token.mjs:292` blob 356883f
- `REFRESH_AHEAD_MS` at `fleet/claude-token.mjs:44` blob 356883f
- `accounts` at `fleet/doctor.mjs:419` blob 2332a5a
- `fresh` at `fleet/run-engine.mjs:969` blob 5523301
- `usage` at `fleet/janitor.mjs:87` blob c189200
- `reason` at `fleet/run-engine.mjs:1613` blob 5523301
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `fleet/claude-token.mjs` blob 356883f
- `installBearer` at `fleet/claude-token.mjs:199` blob 356883f
- `comment` at `fleet/launch.mjs:362` blob def913a
- `edit` at `fleet/tests/test_claude_token.mjs:107` blob d2e9a9b
- `fleet/tests/test_claude_token.mjs` blob d2e9a9b
- `deps` at `fleet/tests/test_claude_token.mjs:19` blob d2e9a9b
- `record` at `fleet/tests/test_fleet_bootstrap.mjs:117` blob c7f9cba
- `fetch` at `fleet/tests/test_sandbox_boot.mjs:150` blob ec8ba1e
- `codeForState` at `fleet/claude-token.mjs:83` blob 356883f
- `cleanCode` at `fleet/claude-token.mjs:72` blob 356883f
- `OAUTH` at `fleet/claude-token.mjs:31` blob 356883f
- `INTEGRATION` at `fleet/claude-token.mjs:39` blob 356883f
- `TARGET` at `fleet/claude-token.mjs:40` blob 356883f
- `KEYCHAIN` at `fleet/claude-token.mjs:41` blob 356883f
- `LOCK_PATH` at `fleet/claude-token.mjs:42` blob 356883f
- `LOCK_STALE_MS` at `fleet/claude-token.mjs:43` blob 356883f
- `CLIPBOARD_POLL_MS` at `fleet/claude-token.mjs:46` blob 356883f
- `CLIPBOARD_WAIT_MS` at `fleet/claude-token.mjs:47` blob 356883f
- `pkce` at `fleet/claude-token.mjs:51` blob 356883f
- `authorizeUrlFor` at `fleet/claude-token.mjs:58` blob 356883f
- `defaultDeps` at `fleet/claude-token.mjs:93` blob 356883f
- `exchange` at `fleet/claude-token.mjs:168` blob 356883f
- `refreshGrant` at `fleet/claude-token.mjs:177` blob 356883f
- `integrationExists` at `fleet/claude-token.mjs:186` blob 356883f
- `readRecord` at `fleet/claude-token.mjs:210` blob 356883f
- `writeRecord` at `fleet/claude-token.mjs:220` blob 356883f
- `b` at `fleet/run-engine.mjs:762` blob 5523301
- `name` at `fleet/doctor.mjs:307` blob 2332a5a
- `stale` at `fleet/doctor.mjs:255` blob 2332a5a
- `broken` at `fleet/tests/probe_addcwd_scope.mjs:80` blob b43a48c

**Proof:**
- Test: `fleet/tests/test_claude_token.mjs`
- Legs: (a) with `--account b` on each of login, refresh and status, every `keychainRead` call
  is with `'b'` and every `keychainWrite` with `('b', value)`, and the stored record parses to
  exactly the three keys `refreshToken`, `accessToken`, `expiresAt`; with no flag the same calls
  name `'ultrapowers'`; and the BASE legs — the interactive login's exchange and edit, the add
  when no object exists, the empty clipboard, the failed exchange, refresh fresh / inside thirty
  minutes / forced / no record, status without a token, the single-flight lock, the lock
  released on a throw, the two-process lock, and the `--code-from-clipboard` group — still pass
  against the default account with the record's third key [M1]; (b) the edit verb with
  `--account b` is exactly `integrations edit claude-max --bearer - --comment account=b` and the
  add verb exactly `integrations add http-proxy --name claude-max --target
  https://api.anthropic.com --bearer - --comment account=b`, each with `access-1` on stdin and
  no verb containing `access-1`; `login --no-install` writes the keychain and issues no lobby
  call, and `refresh --no-install` inside thirty minutes rotates, writes the keychain, and
  issues no lobby call [M2]; (c) with `keychainList()` answering `['ultrapowers', 'b']` and `b`
  expired, `accounts` answers two entries whose `name`s are those, whose `expiresAt` are the
  ISO strings of the stored instants, and whose `fresh` are `true` then `false`; `main(['accounts',
  '--json'])` writes exactly that array as JSON to stdout and the plain form logs two lines each
  carrying its name and `expires`; an empty list answers `[]`; and no stdout or log line
  contains any stored refresh token or access token [M3]; (d) over four entries — `fresh` (a
  stored, unexpired access token), `stale` (expired), `broken` (expired, token endpoint
  answering 500) and `limited` (fresh, usage answering 429) — `usage` issues no token request
  for `fresh`, exactly one `refresh_token` grant for `stale` after which its stored record holds
  the new triple and no `integrations` verb was issued, and answers rows where `fresh` and
  `stale` carry `fiveHour.utilization` / `fiveHour.resetsAt` / `sevenDay.utilization` /
  `sevenDay.resetsAt` from the stub body, `broken` is `unread` with a reason naming `500`, and
  `limited` is `unread` with a reason naming `429`; every usage request is a `GET` of
  `https://api.anthropic.com/api/oauth/usage` whose `Authorization` header is `Bearer
  <that entry's access token>`; `renderUsage` prints the header `account | 5h % | 5h resets |
  7d % | 7d resets` as its first line and then one line per row, the `broken` line carrying
  `unread: `; no printed line contains any access token [M4]; (e) `main` reaches each verb
  with its flags — `['refresh', '--account', 'b', '--no-install']` rotates `b` and issues no
  lobby verb, `['status', '--account', 'b']` logs `b`'s expiry, `['usage', '--json']` writes the
  rows as JSON — `['nonsense']` rejects naming the usage line, and `['refresh', '--account']`
  and `['refresh', '--account', 'bad name']` (a value outside `^[A-Za-z0-9][A-Za-z0-9._-]*$`)
  each reject with zero keychain reads, zero token requests and zero lobby calls [M5].
- Run: node fleet/tests/test_claude_token.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- sha-matches: `fleet/claude-token.mjs@356883fc948490a6cbc48cd883555606941d9838`
- sha-matches: `fleet/tests/test_claude_token.mjs@d2e9a9bf1bfeae0bf87e078c967228c5e776e621`
- issue-closed: #513

### Task 2: The doctor's accounts row and verb-drift row, and the record they read

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/doctor.mjs`
- Create: `fleet/exe-verbs.json`
- Modify: `skills/ultrapowers/references/first-run.md`
- Test: `fleet/tests/test_doctor.mjs`
- Test: `fleet/tests/test_doctor_config_keys.mjs`

**Claim:** The doctor reports two more rows — `accounts`, which lists every keychain entry
with its expiry, says which account the edge carries, and turns red when
`~/.ultrapowers/fleet.json` names an account the keychain does not hold; and `verb-drift`,
which re-fetches `help <verb>` for every verb in `fleet/exe-verbs.json` and reports a flag that
vanished or appeared as a finding in a green row, never a refusal — and `first-run.md` has a
section for each. (derived)
Machine: M1. `ROW_IDS` is exactly `['exe-dev', 'capacity', 'claude', 'accounts', 'github',
'integrations', 'verb-drift']`, `skills/ultrapowers/references/first-run.md`'s `## ` headings
are those seven in that order, and a run of `doctor()` issues, in order, the five BASE reads,
then `node <dir>/claude-token.mjs accounts --json`, then `ssh exe.dev "help <verb>"` once per
verb of the record in the record's key order, and nothing else; the module's import specifiers
are all `node:`-prefixed and it exports `verbDrift` and `fleetConfigAccount` beside the BASE
four. M2. The `accounts` row is `ok` when the accounts read exits 0 and its stdout parses as a
JSON array with at least one entry, with a detail that names every entry as `<name> fresh until
<expiresAt>` or `<name> expired <expiresAt>`, then `; edge carries <name>` from the `account=`
token of the `claude-max` listing entry's `comment` or `; edge account unrecorded` when the
comment has none, then `; fleet.json names <name>` when `account` was given; it is
`missing` when the read exits non-zero or its stdout is not a JSON array, when the array is
empty (the detail names `node fleet/claude-token.mjs login`), or when `account` names a name no
entry carries (the detail names it). M3. `fleetConfigAccount({ path })` answers the file's
top-level `account` when it is a non-empty string and null for an absent file, unparseable JSON,
a non-object, or an `account` that is absent or not a string; the `capacity` row's stale-key
check accepts `account` beside `cpu` and `memory` — a file whose keys are `cpu`, `memory` and
`account` keeps the row `ok` with no `keys nothing reads` in its detail, a file carrying `golden`
still turns it red naming `golden` — `loadFleetConfig` still answers exactly `{ cpu,
memory }`, and the CLI passes `fleetConfigAccount` over the same file `--config` names (or
`~/.ultrapowers/fleet.json`) to `doctor()` as `account`, so a file naming an account the
keychain does not hold exits 1 with `accounts` `missing`. M4. `verbDrift({ help, recordPath })` reads the record `{ capturedAt, verbs: {
"<verb>": ["--flag", …] } }`, calls `help(verb)` once per verb, takes the live flags as every
match of `^\s+(--[A-Za-z0-9-]+)` at the start of a line of the answer's stdout, and answers
`{ readable: true, capturedAt, findings, detail }` where `findings` holds one `{ verb,
appeared, vanished, unreadable }` per verb that has any — `appeared` the live flags not
recorded, `vanished` the recorded flags not live, `unreadable` the exit code when `help`
answered non-zero or its stdout carries no flag at all (the lobby answers an unknown verb with
a line starting `No help available for unrecognized command:` and exit 0) — and `detail` is `<N> verbs
match fleet/exe-verbs.json (captured <capturedAt>)` with no findings, else `drift since
<capturedAt>: ` followed by `; `-joined segments `<verb>: <flags joined by ', '> appeared`,
`<verb>: <flags> vanished` and `<verb>: help unreadable (code <n>)` in record order; an absent
record, unparseable JSON, or a record without a `verbs` object answers `{ readable: false,
detail }` with a detail naming `fleet/exe-verbs.json`. M5. The `verb-drift` row is `ok` with
`verbDrift`'s detail whenever the record is readable — drifted or not, help unreadable or not —
and `missing` with that detail only when the record is not readable; an account whose only
blemish is a drift is `ready`. M6. `fleet/exe-verbs.json` parses to `{ "capturedAt":
"2026-09-05", "verbs": { … } }` whose `verbs` keys are exactly, in order, `new`, `rm`, `ls`,
`comment`, `tag`, `integrations add`, `integrations attach`, `integrations detach`,
`integrations list`, `integrations edit`, `ssh-key generate-api-key`, `billing plan`, with the
flag arrays the Context lists. M7. `first-run.md`'s `## accounts` section names `--account`,
`--no-install`, `accounts`, `usage` and the `account` key of `~/.ultrapowers/fleet.json`, its
`## verb-drift` section names `fleet/exe-verbs.json`, `help` and `finding`, and its opening
paragraph says seven rows.

**Authorized-by:** #610 (Shelley, Counsel 2: the diff is the cheapest detector); #513
(superseding note of 2026-09-05, items 1 and 3: the doctor's `accounts` row and the config's
default account); #598 (first-run.md is the walk a red row sends the operator to)

**Interfaces:**
- Consumes: none
- Produces: `ROW_IDS`
- Produces: `verbDrift({ help, recordPath }) -> Promise<{ readable: boolean, capturedAt: string | null, findings: Array<{ verb, appeared, vanished, unreadable }>, detail: string }>`
- Produces: `fleetConfigAccount({ path }) -> Promise<string | null>`
- Produces: `doctor({ config, exec, target, configKeys, account, verbsPath }) -> Promise<{ config, rows, verdict }>`

**Context:** The doctor is the one fleet file that runs from the installed plugin cache with no
`node_modules` and imports no sibling: the record is read with `node:fs/promises` from
`path.join(HERE, 'exe-verbs.json')` by default (`verbsPath` on `doctor()` and `recordPath` on
`verbDrift` override it, and the exams pass a fixture path — never the real file — for the
unit legs), and the accounts read is a sixth entry in `READS`, `node ${CLAUDE_TOKEN} accounts
--json`, run through the same `exec` seam as the BASE five. The help reads are issued by
`doctor()` through `verbDrift({ help: (verb) => run(`ssh exe.dev "help ${verb}"`), recordPath
})`; the `help` seam answers `{ code, stdout }` like every other read. A verb name reaches an
ssh string only if it matches `^[a-z][a-z0-9 -]*$`; any other key in the record is reported as
`unreadable` with code `-1` and never interpolated. The form is `help <verb>`, not `<verb>
--help`, on purpose: the two print the same `Command:` / `Options:` block (measured 2026-09-05
for `new`, `integrations add`, `billing plan` and `ssh-key generate-api-key`), and `help …` is
not matched by the mutating-verb regex `^(cp|rm|comment|rename|new|tag) ` that
`fleet/tests/_lobby_helpers.mjs`'s `exec.mutating()` applies to every launch exam, whereas `new
--help` would be. Shelley's note in #610 says `--help` answers JSON; measured, it answers text
— a `Command: <name>` line, a description, an optional `Usage:` line, an `Options:` block whose
lines are two spaces, the flag, spaces, its description, and an optional `Examples:` block —
so the diff unit is the flag set, and the record stores flag names, not prose. The verbs
recorded are #610's list minus `cp`: the copy verb left the fleet with the golden image at
#597, and its flag `--copy-tags` is a string banned under `fleet/` by the sweep in
`fleet/tests/test_launch.mjs`, so recording it would turn that exam red. The record's content,
captured from the live lobby on 2026-09-05 with `ssh exe.dev "<verb> --help"` — write it
verbatim, keys in this order, `capturedAt` `"2026-09-05"`: `new` → `--comment --cpu --disk
--env --image --integration --json --memory --name --no-email --pool --prompt --registry-auth
--setup-script --tag`; `rm` → `--json`; `ls` → `--group --json --l`; `comment` → `--json`;
`tag` → `--d --json`; `integrations add` → `--act-as-user --attach --bearer --comment --fields
--for --header --name --no-auth --peer --readonly --repository --strip-prefix --target
--team`; `integrations attach` → `--for --team --until`; `integrations detach` → `--team`;
`integrations list` → `--json --usage`; `integrations edit` → `--act-as-user --bearer
--clear-header --comment --fields --header --no-auth --readonly --repository --strip-prefix
--target --team --webhook-url`; `ssh-key generate-api-key` → `--cmds --exp --json --label
--vm`; `billing plan` → `--json` (each a JSON array of strings, as listed, in that order). The
accounts read parses the shape the credential tool prints (another task, same wave):
`[{"name":"ultrapowers","expiresAt":"2026-09-05T20:00:00.000Z","fresh":true}]` — an entry is
`fresh until` when `fresh` is true and `expired` otherwise, and the detail spells `expiresAt`
as printed. The edge's account is read off the `integrations list --json` entry named
`claude-max`, whose `comment` field the credential tool sets to `account=<name>` on every
install; `parseIntegrations` grows a `comment` field (the string, or null) on each entry and
the row takes the value after `account=` from the first whitespace-separated token that starts
with it. The live `claude-max` entry today carries a prose comment with no `account=` token —
that is the `edge account unrecorded` case, still green: the next launch's refresh records it.
`account` reaches `doctor()` as its own option, read by the CLI with `fleetConfigAccount` from
the same path `--config` names, and is not part of `result.config`, which stays exactly the two
keys `loadFleetConfig` answers; `DOCTOR_DEFAULTS` stays `{ cpu: '8', memory: '16GB' }`, because
`fleet/tests/test_doctor.mjs` and `fleet/tests/test_doctor_config_keys.mjs` pin it, the config
to two keys, and `fleet/lobby.mjs`'s `FLEET_DEFAULTS` (pinned by hash in this plan's Global
Constraints) is byte-identical to it. The stale-key check in `capacityRow` therefore compares
against `READ_KEYS` plus `['account']`, and its red detail keeps the phrase `keys nothing reads`
and its `it reads` sentence, reworded to say the launcher reads `account`. The row's fix is its
own heading, as for every row: `FIXES` is derived from `ROW_IDS`. The doctor's source may not
carry the word fits or the phrase cannot hold anywhere, comments included (`test_doctor.mjs`
group 2 greps the source). Both exams are extended by the examiner in their BASE shapes.
`fleet/tests/test_doctor.mjs`: `EXPECTED_IDS` becomes the seven ids; `CMD` gains `accounts:
node <FLEET_DIR>/claude-token.mjs accounts --json` and one `help` command per fixture verb;
`FIVE_READS` becomes the ordered list of the five, the accounts read, then the help reads for
the fixture record the exam writes to a temp path and passes as `verbsPath` — the fixture holds
two or three verbs, not the twelve, so the stub table stays small; `GREEN()` answers the
accounts read with the one-entry JSON above and each help read with an `Options:` block
rendering the fixture's flags; the `statusOf` deep-equals grow the two rows; the exports leg
adds `verbDrift` and `fleetConfigAccount`; and in group 6b the `node` shim answers `accounts
--json` on stdout with that JSON when `$*` carries `accounts` and the `STATUS_LINE` on stderr
otherwise, the green `ssh` shim answers `*"help "*` with an `Options:` block whose flags are the
real record's for that verb (read `fleet/exe-verbs.json` in the exam to render them, since the
CLI leg runs the real doctor against the real file beside it), and the red shim's human form is
two lines per red row and one line for `verb-drift`, which is `ok` even when every `help` read
fails. `fleet/tests/test_doctor_config_keys.mjs` keeps its `golden`/`stateRepo` stale fixture
red and adds the `account`-accepted case and the `fleetConfigAccount` cases; its
`Object.keys(DOCTOR_DEFAULTS)` two-key pin stands. `first-run.md` grows `## accounts` between
`## claude` and `## github`, and `## verb-drift` after `## integrations`, each in the page's
shape (what the piece is, what the agent runs, what the operator does in a browser — nothing,
for both — and two or three things a newcomer would not know); the page's first sentence says
`seven rows`. `## accounts` teaches: one keychain item per account under one service, `node
<plugin-root>/fleet/claude-token.mjs login --code-from-clipboard --account <name> --no-install`
to add a second account without moving the edge, `accounts` to list them, `usage` for the
table, `"account": "<name>"` in `~/.ultrapowers/fleet.json` as the launch default, the
launcher's `--account <name>` per run and that the edge's `claude-max` comment records
`account=<name>`; the newcomer facts are that the refresh token rotates on every use so a
copied record is dead, that metering refreshes an entry without touching the edge, and that
switching accounts is per run, never mid-run. `## verb-drift` teaches: `fleet/exe-verbs.json`
is the recorded flag set per lobby verb with its capture date, the doctor and the launcher
re-fetch `help <verb>` and print the diff, a drift is a finding in a green row (the row is red
only when the record itself cannot be read), and re-capturing is editing the record from `ssh
exe.dev "help <verb>"` output and bumping `capturedAt`. The four operator documents may not
carry the retired name that joins `claude-oauth` and `token` with a hyphen
(`tests/test_docs_agree_with_code.py`'s `RETIRED` list), nor any `integrations add|attach` line
naming `tag:fleet`. `fleet/RUNBOOK.md` and `fleet/CONTRACT.md` are another run's; they catch up
with the new rows and verbs in a later plan, so this task names neither.
**BASE facts:** (generated at af5edf8)
- `accounts` at `fleet/doctor.mjs:419` blob 2332a5a
- `ROW_IDS` at `fleet/doctor.mjs:57` blob 2332a5a
- `ok` at `fleet/tests/test_claude_token.mjs:48` blob d2e9a9b
- `comment` at `fleet/launch.mjs:362` blob def913a
- `missing` at `fleet/target.mjs:128` blob c189a05
- `capacity` at `fleet/launch.mjs:306` blob def913a
- `cpu` at `fleet/launch.mjs:233` blob def913a
- `memory` at `fleet/launch.mjs:234` blob def913a
- `loadFleetConfig` at `fleet/doctor.mjs:118` blob 2332a5a
- `findings` at `fleet/fitness.mjs:113` blob 1cb6825
- `detail` at `fleet/run-engine.mjs:1345` blob 5523301
- `tag` at `fleet/confine-hook.mjs:133` blob e0cd408
- `usage` at `fleet/janitor.mjs:87` blob c189200
- `finding` at `fleet/tests/test_run_engine.mjs:117` blob 25a93da
- `READS` at `fleet/doctor.mjs:71` blob 2332a5a
- `fleet/tests/_lobby_helpers.mjs` blob 86c4674
- `cp` at `fleet/tests/test_run_engine_pre_review.mjs:668` blob b2dccab
- `fleet/tests/test_launch.mjs` blob 9faf40b
- `fresh` at `fleet/run-engine.mjs:969` blob 5523301
- `parseIntegrations` at `fleet/doctor.mjs:297` blob 2332a5a
- `DOCTOR_DEFAULTS` at `fleet/doctor.mjs:53` blob 2332a5a
- `fleet/tests/test_doctor.mjs` blob 350163f
- `fleet/tests/test_doctor_config_keys.mjs` blob f918b36
- `fleet/lobby.mjs` blob 2f6289f
- `FLEET_DEFAULTS` at `fleet/lobby.mjs:149` blob 2f6289f
- `capacityRow` at `fleet/doctor.mjs:250` blob 2332a5a
- `READ_KEYS` at `fleet/doctor.mjs:236` blob 2332a5a
- `FIXES` at `fleet/doctor.mjs:61` blob 2332a5a
- `EXPECTED_IDS` at `fleet/tests/test_doctor.mjs:46` blob 350163f
- `CMD` at `fleet/tests/test_doctor.mjs:50` blob 350163f
- `FIVE_READS` at `fleet/tests/test_doctor.mjs:57` blob 350163f
- `statusOf` at `fleet/tests/_sandbox_boot_helpers.mjs:374` blob 8b5b99d
- `carries` at `evals/frontier/classify.py:19` blob fe29aaf
- `token` at `fleet/doctor.mjs:490` blob 2332a5a
- `tests/test_docs_agree_with_code.py` blob c9687c7
- `fleet/RUNBOOK.md` blob 7a45c72
- `fleet/CONTRACT.md` blob a91fa2b
- `configKeys` at `fleet/doctor.mjs:537` blob 2332a5a
- `skills/ultrapowers/references/first-run.md` blob 431b552

**Proof:**
- Test: `fleet/tests/test_doctor.mjs`
- Test: `fleet/tests/test_doctor_config_keys.mjs`
- Legs: (a) `ROW_IDS` deep-equals the seven ids in order; a green run over a two-verb fixture
  record issues exactly the five BASE reads, the accounts read, then `ssh exe.dev "help <verb>"`
  for each fixture verb in record order, and nothing else, with `--target` adding no read and a
  second run repeating the same list; every import specifier is `node:`-prefixed and the
  exports include `verbDrift` and `fleetConfigAccount` [M1]; (b) for each of these accounts
  reads the row is as named — two entries with the edge comment `account=ultrapowers` →
  `ok`, detail carrying `ultrapowers fresh until 2026-09-05T20:00:00.000Z`, `b expired
  <its expiresAt>` and `edge carries ultrapowers`; the same with a comment lacking `account=` →
  `ok` carrying `edge account unrecorded`; `account: 'b'` given → `ok` carrying `fleet.json
  names b`; `account: 'c'` given → `missing` naming `c`; an empty array → `missing` naming
  `node fleet/claude-token.mjs login`; exit code 1 → `missing`; stdout `not json` → `missing`;
  stdout `{}` (parseable, not an array) → `missing` [M2]; (c) `fleetConfigAccount` answers `'b'` for `{"cpu":"8","memory":"16GB","account":"b"}`
  and null for an absent path, for `{`, for `[]`, for `{"cpu":"8"}` and for `{"account": 3}`; a
  `configKeys` of `['cpu', 'memory', 'account']` leaves `capacity` `ok` with no `keys nothing
  reads`, `['cpu', 'memory', 'golden']` turns it `missing` naming `golden`, and
  `loadFleetConfig` over the three-key file answers exactly `{ cpu: '8', memory: '16GB' }`
  [M3]; (d) over a fixture record of `new` and `rm`: a `help` stub answering the recorded
  flags → `readable` true, no findings, detail `2 verbs match fleet/exe-verbs.json (captured
  2026-09-05)`; `new` answering one extra `--pool2` → one finding with `appeared` `['--pool2']`
  and detail `drift since 2026-09-05: new: --pool2 appeared`; `rm` answering no `--json` → a
  finding with `vanished` `['--json']` and the detail segment `rm: --json vanished`; `rm`
  answering exit 255 → `unreadable` 255 and the segment `rm: help unreadable (code 255)`; `rm`
  answering a stdout that starts `No help available for unrecognized command:` at exit 0 →
  `unreadable` 0; an
  absent path, a file holding `{`, and a file holding `{"capturedAt":"x"}` each answer
  `readable` false with a detail naming `fleet/exe-verbs.json`; a record whose key is `rm;
  whoami` answers `unreadable` -1 for it and the `help` stub was never called with it [M4];
  (e) a doctor run whose `help` reads drift is `ready` with `verb-drift` `ok` and the detail
  `verbDrift` answers for the same reads; a doctor run whose every `help` read exits 255 is
  `ready` with `verb-drift` `ok` and a detail carrying `help unreadable (code 255)`; a run whose
  `verbsPath` is absent is `not-ready` with `verb-drift` `missing` and every other row unchanged
  [M5]; (f) `fleet/exe-verbs.json`, read
  from disk, deep-equals the twelve-verb literal of the Context, keys in that order, `capturedAt`
  `2026-09-05` [M6]; (g) group 6b's CLI run against the green shim exits 0 with the seven rows in
  order and its verb-drift detail `12 verbs match fleet/exe-verbs.json (captured 2026-09-05)`;
  against the red shim it exits 1 with `verb-drift` `ok` and the human form printing two lines
  for each red row and one for verb-drift [M5]; (h) the three scoped greps below over
  `skills/ultrapowers/references/first-run.md` — the `## accounts` section for `--account`,
  `--no-install`, `accounts`, `usage` and `"account"`, the `## verb-drift` section for
  `fleet/exe-verbs.json`, `help` and `finding`, and the text before `## exe-dev` for `seven
  rows` — each exit 0, and each exits non-zero when its section lacks any one of its words, as
  it does at BASE where neither section exists and the opening says five rows; and the
  `tests/test_docs_agree_with_code.py` run passes, which fails whenever `ROW_IDS` and the `## `
  headings differ in membership or order [M7]; (i) group 6b's CLI run against the green shim
  (whose `accounts --json` answers the one `ultrapowers` entry) with `--config <temp file
  holding {"cpu":"8","memory":"16GB","account":"zzz"}>` exits 1 with `accounts` `missing` and a
  detail naming `zzz`, with the same file naming `ultrapowers` instead exits 0 with `accounts`
  `ok` and a detail carrying `fleet.json names ultrapowers`, and with a `HOME` whose
  `.ultrapowers/fleet.json` names `zzz` and no `--config` exits 1 with `accounts` `missing`
  [M2] [M3].
- Run: node fleet/tests/test_doctor.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_doctor_config_keys.mjs | grep -q 'ALL TESTS PASSED'
- Run: python3 -m pytest tests/test_docs_agree_with_code.py -q -p no:cacheprovider
- Run: sed -n '/^## accounts/,/^## github/p' skills/ultrapowers/references/first-run.md | tr '\n' ' ' | grep -q -- '--account' && sed -n '/^## accounts/,/^## github/p' skills/ultrapowers/references/first-run.md | tr '\n' ' ' | grep -q -- '--no-install' && sed -n '/^## accounts/,/^## github/p' skills/ultrapowers/references/first-run.md | tr '\n' ' ' | grep -q 'accounts' && sed -n '/^## accounts/,/^## github/p' skills/ultrapowers/references/first-run.md | tr '\n' ' ' | grep -q 'usage' && sed -n '/^## accounts/,/^## github/p' skills/ultrapowers/references/first-run.md | tr '\n' ' ' | grep -q '"account"'
- Run: sed -n '/^## verb-drift/,$p' skills/ultrapowers/references/first-run.md | tr '\n' ' ' | grep -q 'fleet/exe-verbs.json' && sed -n '/^## verb-drift/,$p' skills/ultrapowers/references/first-run.md | tr '\n' ' ' | grep -q 'help' && sed -n '/^## verb-drift/,$p' skills/ultrapowers/references/first-run.md | tr '\n' ' ' | grep -q 'finding'
- Run: sed -n '1,/^## exe-dev/p' skills/ultrapowers/references/first-run.md | tr '\n' ' ' | grep -q 'seven rows'

**Stale-if:**
- sha-matches: `fleet/doctor.mjs@2332a5a40d2163b0d7d0376ea6840fe1b66b2185`
- sha-matches: `skills/ultrapowers/references/first-run.md@431b5529919fd78ff8c94066a3ca74d79520d3d8`
- sha-matches: `fleet/tests/test_doctor.mjs@350163fc28942c275305c55bfab66f0011f6aa89`
- sha-matches: `fleet/tests/test_doctor_config_keys.mjs@f918b36f9d7e9f37f58be7dab27576c82206251d`
- path-exists: `fleet/exe-verbs.json`
- issue-closed: #610

### Task 3: A launch names its account and prints the verb-drift preflight

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Test: `fleet/tests/test_launch.mjs`
- Test: `fleet/tests/test_launch_reaps.mjs`
- Test: `fleet/tests/test_launch_engine_source.mjs`

**Claim:** which entry `launch.mjs` refreshes and installs on the proxy before the launch —
still per run, never mid-run (quoted from #513)
Machine: M1. `USAGE` names `--account <name>`; the launch's account is `--account` when given,
else the config's `account` (the injected `config`'s, or `fleetConfigAccount` over the file
`--config` names when no config was injected), else `ultrapowers`; an `--account` whose value is
absent or does not match `^[A-Za-z0-9][A-Za-z0-9._-]*$` is a `Refusal` before any command is
executed. M2. `refreshCredential(account)` is called exactly once, with that name, after the
`integrations list --json` read and before the plan is pushed; `defaultRefreshCredential(account,
spawn)` — `spawn` defaulting to `spawnSync` — calls `spawn(process.execPath, [<fleet
dir>/claude-token.mjs, 'refresh', '--account', <name>], …)` exactly once and answers `{ ok: true
}` on status 0, `{ ok: true, skipped: true }` when the output carries `no refresh token in the
keychain`, and `{ ok: false }` otherwise; a `{ ok: false }` answer from the seam is a
`LobbyError` before any push and before any `new`, as at BASE. M3. The result carries `account`
and `verbDrift` (the object `verbDrift` answered), and `renderLaunch` prints, after the comment
line and any `reaped` lines and before the engine line, `account=<name>` and then `verb-drift:
<detail>`; the assignment comment is BASE's — with `--account b` it carries no `account=` and
is byte-identical to the comment the same launch built without the flag. M4. After the
`gh-<owner>-<repo>` check and before the reap, the launch awaits `verbDrift({ help: (verb) =>
exec('ssh', ['exe.dev', 'help <verb>']), recordPath: verbsPath })`, `verbsPath` being
`launch`'s injectable option defaulting to `<fleet dir>/exe-verbs.json`; a drift, a `help` that
answers non-zero, or an unreadable record (an absent `verbsPath`) changes neither the launch's
outcome nor its mutating verbs — the lobby commands a green launch issues are BASE's plus the
`help <verb>` reads, and `exec.mutating()` is still exactly one `new …` line — and the
unreadable record's rendered line is `verb-drift: ` followed by the detail naming
`fleet/exe-verbs.json`.

**Authorized-by:** #513 (superseding note of 2026-09-05, item 3); #610 (the same comparison at
preflight)

**Interfaces:**
- Consumes: `verbDrift`
- Consumes: `fleetConfigAccount`
- Produces: `launch({ argv, exec, config, now, sleep, rand, refreshCredential, verbsPath }) -> Promise<object>`
- Produces: `USAGE`
- Produces: `renderLaunch(result) -> string`
- Produces: `defaultRefreshCredential(account: string, spawn?) -> { ok, skipped, out }`

**Context:** At BASE the launcher's `refreshCredential` seam is a nullary function spawning
`node fleet/claude-token.mjs refresh`, called after the engine sha is read and before
`commitPlan`; a `no refresh token in the keychain` answer is `skipped` and not fatal. The
credential tool (landed in wave 1) takes `refresh --account <name>` and rotates and installs
exactly that entry, stamping the edge's `claude-max` comment `account=<name>` — so the launch
line is where the per-run choice lives, and the seam gains the name as its one argument. The
account must NOT be written into the assignment comment: `fleet/sandbox-boot.sh`'s
`parse_assignment` (pinned by hash in Global Constraints, another run's file) ends its `case`
with `*) fail "assignment: unknown key '$key' in comment"`, so a comment carrying `account=`
kills the run at boot; `fleet/lobby.mjs`'s `COMMENT_KEYS` and `buildComment` (also pinned) do
not spell it either. The account is therefore recorded in the launch result and the printed
lines; `fleet/CONTRACT.md` and `fleet/RUNBOOK.md` are another run's and catch up in a later
plan. `verbDrift` and `fleetConfigAccount` are imported from `./doctor.mjs` (the doctor imports
nothing from the fleet; the launcher already imports `./lobby.mjs`, `./janitor.mjs` and
`./setup-script.mjs`, and may import the doctor). `verbDrift({ help, recordPath })` answers
`{ readable, capturedAt, findings, detail }` and never throws for a drift; its `help(verb)`
must answer `{ code, stdout }`, which the launcher's `exec('ssh', ['exe.dev', 'help ' + verb])`
does. The reads it issues are `help <verb>` lines through the lobby seam — twelve for the
shipped record — and `fleet/tests/_lobby_helpers.mjs`'s `exec.mutating()` regex
`^(cp|rm|comment|rename|new|tag) ` does not match them, while `sshRule('new ', …)` in
`test_launch.mjs`'s `readRules` would match a `new --help`; that is why the form is `help
<verb>`. The record path defaults to `new URL('./exe-verbs.json', import.meta.url).pathname`;
`launch({ verbsPath })` overrides it (the CLI never passes it), so an exam can hand the launcher
an absent path, and the exams read the real file to render the help answers their stubs give.
`defaultRefreshCredential(account, spawn = spawnSync)` takes the spawner as its second argument
for the same reason: the exam's spy records the argv and answers `{ status: 0, stdout: '',
stderr: '' }`, so the real credential tool and the keychain are never touched by an exam. `fleetConfigAccount({ path })` is read only when no `config` was injected — the
rule `settings` already follows — so an exam that injects `config` never reads the laptop's
`~/.ultrapowers/fleet.json`. `renderLaunch`'s lines are pinned by three exams, all this task's
to extend: `fleet/tests/test_launch.mjs` group (e) deep-equals a pinned-engine, reap-free launch's
lines to `[runId, vm, statusUrl, comment]`, and `fleet/tests/test_launch_reaps.mjs` and
`fleet/tests/test_launch_engine_source.mjs` each build `baseLines(result)` the same way — every
one of them gains the two lines `account=ultrapowers` and `verb-drift: 12 verbs match
fleet/exe-verbs.json (captured 2026-09-05)` after the comment (and after any `reaped` line)
and before the engine line. Every launch exam's `makeExec` answers an unmatched command
`{ code: 0, stdout: '' }`, which `verbDrift` reads as `help unreadable (code 0)` for every
verb — a finding line, not a failure — so a green launch prints a long drift line unless the
exam adds a rule; each of the three exams therefore adds an `sshRule('help ', …)` whose answer
renders `Options:` and one `  --flag  …` line per flag of the real record for the verb asked
(`fleet/exe-verbs.json`, read once at the top of the exam). `test_launch_hold.mjs` and
`test_launch_effort.mjs` pin no rendered line and stay green untouched: a drift refuses
nothing. The exam `fleet/tests/test_launch.mjs` is extended by the examiner in its BASE shape
(`workspace()`, `readRules`, `greenLaunch`, `launchIn` with an injected `refreshCredential`,
`exec.lobby()` / `exec.mutating()` / `newLines`, groups (0)–(e)): `launchIn`'s default seam
becomes a spy recording its argument; the refusal table in group (b) gains the bad-account
rows; group (e)'s rendered lines become the six. The BASE `(0) [M6]` sweep bans a handful of
strings under `fleet/`, among them the copy verb's tag-copying flag; nothing this task writes
carries any of them.
**BASE facts:** (generated at af5edf8)
- `USAGE` at `fleet/janitor.mjs:85` blob c189200
- `config` at `fleet/doctor.mjs:120` blob 2332a5a
- `Refusal` at `fleet/lobby.mjs:261` blob 2f6289f
- `LobbyError` at `fleet/lobby.mjs:274` blob 2f6289f
- `renderLaunch` at `fleet/launch.mjs:503` blob def913a
- `reaped` at `fleet/launch.mjs:324` blob def913a
- `commitPlan` at `fleet/launch.mjs:445` blob def913a
- `fleet/sandbox-boot.sh` blob 0cdb604
- `fleet/lobby.mjs` blob 2f6289f
- `COMMENT_KEYS` at `fleet/lobby.mjs:427` blob 2f6289f
- `buildComment` at `fleet/lobby.mjs:437` blob 2f6289f
- `fleet/CONTRACT.md` blob a91fa2b
- `fleet/RUNBOOK.md` blob 7a45c72
- `fleet/tests/_lobby_helpers.mjs` blob 86c4674
- `readRules` at `fleet/tests/test_launch.mjs:113` blob 9faf40b
- `settings` at `fleet/launch.mjs:232` blob def913a
- `fleet/tests/test_launch.mjs` blob 9faf40b
- `fleet/tests/test_launch_reaps.mjs` blob 1031e90
- `fleet/tests/test_launch_engine_source.mjs` blob 6e7079b
- `makeExec` at `fleet/tests/_lobby_helpers.mjs:83` blob 86c4674
- `greenLaunch` at `fleet/tests/test_launch.mjs:167` blob 9faf40b
- `launchIn` at `fleet/tests/test_launch.mjs:159` blob 9faf40b
- `newLines` at `fleet/tests/test_launch.mjs:173` blob 9faf40b
- `b` at `fleet/run-engine.mjs:762` blob 5523301
- `c` at `fleet/confine-hook.mjs:154` blob e0cd408
- `baseLines` at `fleet/tests/test_launch_engine_source.mjs:199` blob 6e7079b

**Proof:**
- Test: `fleet/tests/test_launch.mjs`
- Test: `fleet/tests/test_launch_reaps.mjs`
- Test: `fleet/tests/test_launch_engine_source.mjs`
- Legs: (a) `USAGE` contains `--account`; a green launch with `--account b` has `result.account`
  `b`; one with `--account b` and an injected `config` carrying `account: 'c'` has `b`, not
  `c`; one with no flag and an injected `config` carrying `account: 'c'` has `c`; one with
  neither has `ultrapowers`; one with no flag, no injected config and `--config <temp file
  holding {"cpu":"8","memory":"16GB","account":"d"}>` has `d`, read through
  `fleetConfigAccount`; a green launch with `--account a.b-c_d` has `a.b-c_d`; and `--account`
  with no value, `--account 'bad name'`, `--account -x`, `--account .x` and `--account 'a;b'`
  each throw a `Refusal` naming `--account` with `exec.calls` empty [M1]; (b) the spy seam is called exactly once with `b` for a `--account b` launch and with
  `ultrapowers` for a bare one, its call index in `exec.calls` is after the `integrations list
  --json` call and before the `git … push` call, and a seam answering `{ ok: false, out: 'x' }`
  throws a `LobbyError` with no push and no `new` issued; `defaultRefreshCredential('b', spy)`
  calls the spy exactly once with `process.execPath` and an argv whose last three entries are
  `['refresh', '--account', 'b']` and whose first ends in `claude-token.mjs`, answering `{ ok:
  true }` for status 0, `{ ok: true, skipped: true }` for status 1 with `no refresh token in the
  keychain` on stderr, and `{ ok: false }` for status 1 with any other output [M2]; (c) the green launch's result
  carries `account` and `verbDrift` with `verbDrift.readable` true; `renderLaunch` of the
  pinned-engine, reap-free launch splits to exactly `[runId, vm, statusUrl, comment,
  'account=ultrapowers', 'verb-drift: 12 verbs match fleet/exe-verbs.json (captured
  2026-09-05)']`; the `--account b` launch's comment equals the bare launch's comment for the
  same plan sha and carries no `account=`; and `test_launch_reaps.mjs`'s and
  `test_launch_engine_source.mjs`'s `baseLines` deep-equals carry the two lines in that position,
  the engine-source exam's main-tip line still last [M3]; (d) in a green launch the
  `help <verb>` reads appear in `exec.lobby()` once per verb of the record, between the `integrations
  list --json` read and the reap's `ls` read, and `exec.mutating()` is exactly the one `new …`
  line; with the `help` rule for `rm` answering `Options:` without `--json` the launch still
  answers a VM, `exec.mutating()` is still the one `new …` line, and its rendered `verb-drift:`
  line is `verb-drift: drift since 2026-09-05: rm: --json vanished`; with the `help` rule for
  `new` answering exit 255 the launch still answers a VM and the line carries `new: help
  unreadable (code 255)`; with the `help` rule removed entirely the launch still answers a VM;
  and a launch given `verbsPath` naming an absent file still answers a VM with `exec.mutating()`
  the one `new …` line, `result.verbDrift.readable` false, and a rendered line starting
  `verb-drift: ` and naming `fleet/exe-verbs.json` [M4].
- Run: node fleet/tests/test_launch.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_reaps.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_engine_source.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_hold.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_effort.mjs | grep -q 'ALL TESTS PASSED'
- Run: python3 -m pytest tests/test_docs_agree_with_code.py -q -p no:cacheprovider

**Stale-if:**
- sha-matches: `fleet/launch.mjs@def913a048a5a4271a14ddd4c75d44e5c6b697dd`
- sha-matches: `fleet/tests/test_launch.mjs@9faf40b1e3ed606b2283c829c0115a74057be9be`
- sha-matches: `fleet/sandbox-boot.sh@0cdb604f808000016786b479e3c1a5af81e41131`
- sha-matches: `fleet/lobby.mjs@2f6289f1de89b48f5090b6a40d11a3d10c34b8b4`
- issue-closed: #513
