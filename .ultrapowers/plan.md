# A subscriber's window is read before a launch, refused at the wall, and named by the engine when a worker hits it

**Grammar:** claims-v1

**Claim:** When I launch on an account that has used up its weekly or five-hour window, the launch is refused on my laptop before anything is pushed, naming the account and when the window resets; on every other launch I see the account's two window readings on the launch line and in the doctor; and a run whose workers hit the limit anyway parks at once saying 'rate-limited', not 'returned null'. (elicited)
**Summary:** Today an exhausted subscriber window kills every worker fifty seconds in, the engine calls it 'agent returned null', and the doctor says ok, so a whole run is lost before anyone knows why. This plan reads the window before a launch and refuses one that can only die, prints the reading wherever you already look, and makes the engine name a rate limit as what it is and stop instead of retrying into the wall. You lose no more runs to a limit, and when one is near you see it coming.

**Goal:** Close #1114's three desired states — the launcher refuses at the wall and prints the windows, the engine parks `rate-limited`, the doctor's `claude` row carries the reading — with a non-rotating window read the token tool exposes for both laptop callers.
**Closes:** #1114

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`, `factory/*.mjs`), sims under `fleet/tests/test_*.mjs` printing `ALL TESTS PASSED`, bridged by `python3 -m pytest`.

**Spec:** #1114 (the reading of 2026-09-17: runs 177, 179, 180 and three tinyapp runs died on `agent returned null` while the doctor's `claude` row said `ok`).

## Global Constraints

- No task mints, rotates or installs a Claude credential: a window read from the launcher or the doctor never calls the refresh grant, because a refresh revokes the access token every live run is using (runs 92, 100, 103, 178).
- Every reset time printed is the ISO string the usage API answers (`resets_at`), never reformatted; every utilization is the number the API answers, as a percentage.
- A window that cannot be read is never a refusal: the launch and the doctor say `unread` with the reason and go on.
- Check: git diff --quiet $ULTRA_BASE -- factory/roles factory/union.mjs factory/worker.mjs factory/reverify.mjs factory/judge.mjs factory/questions.json factory/boot.sh fleet/fleet-bootstrap.sh skills/ultrapowers/kernel

### Task 1: The token tool reads one account's window without rotating

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/claude-token.mjs`
- Test: `fleet/tests/test_claude_token_usage.mjs`

**Claim:** A laptop tool can ask the window of one named account and get an answer that never mints a token: an account whose access token has expired answers unread instead of rotating. (derived)
Machine: M1. `usage(deps, { account: 'acct', rotate: false })` over a keychain whose record for `acct` holds an unexpired `accessToken` resolves exactly one row `{ name: 'acct', fiveHour: { utilization, resetsAt }, sevenDay: { utilization, resetsAt }, unread: false, reason: null }`, after exactly one `deps.fetch` of `USAGE_URL` whose `Authorization` header is `Bearer <that accessToken>`, zero `deps.keychainWrite` calls and zero `integrations edit`/`integrations add` lobby verbs. M2. The same call over a record whose `expiresAt` is before `deps.now()` resolves exactly one row with `unread: true` and a `reason` beginning `access token expired`, after zero `deps.fetch` calls and zero `deps.keychainWrite` calls. M3. `main(['usage', '--json', '--account', 'acct', '--no-rotate'], deps)` writes exactly one line to `deps.stdout` that parses as a JSON array of length 1 whose `[0].name` is `acct`; `main(['usage', '--json'], deps)` over two listed accounts writes an array of length 2. M4. `USAGE_LINE` spells the verb as `usage [--json] [--account <name>] [--no-rotate]`.

**Authorized-by:** #1114 desired state 1 and 3 (both laptop callers need a read that cannot rotate); CLAUDE.md §Conventions, the token-rotation bullet (run-100: a `usage` read rotated an expired account and left the edge holding a revoked bearer).

**Interfaces:**
- Consumes: none
- Produces: `usage(deps, { account, rotate }) -> Promise<Array<{ name, fiveHour, sevenDay, unread, reason }>>`

**Context:** `usage(deps)` today (line ~481) walks `deps.keychainList()` and calls `usageRow`, which rotates an expired record with `refresh(deps, { force: true, account: name, install: false })` before fetching. The change is two options with defaults that keep today's behaviour: `account` (null → every listed name; a string → only that name, whether or not `keychainList()` lists it) and `rotate` (true → today's path; false → an expired record, or one with no `accessToken`, answers `unread` with reason `access token expired <iso>; not rotated (--no-rotate)` and no refresh is attempted). `parseArgs` gains `--no-rotate` → `opts.rotate = false`; `--account` already parses and lands in `opts.account`, but its default is `DEFAULT_ACCOUNT`, so the `usage` verb must pass `account` only when the flag was given (track `opts.accountGiven`). The row shape is unchanged. The deps rig in `fleet/tests/test_claude_token_refresh.mjs` (`makeDeps`: `now`, `keychainRead`, `keychainWrite`, `keychainList`, `lobby`, `fetch`, `log`) is the shape to copy, not import — a sim may not name a sibling sim. A `deps.stdout` seam already exists in `main` (`write`). The fleet listing (`ls 'fleet-r*' --json`) is a lobby verb the rotate path issues; with `rotate: false` no lobby verb is issued at all.

**Proof:**
- Test: `fleet/tests/test_claude_token_usage.mjs`
- Guard: `fleet/tests/test_claude_token_usage.mjs`
- Legs: (a) an unexpired record: one row, `unread` false, one fetch with the record's bearer, zero keychain writes, zero edit/add verbs [M1]; (b) an expired record with `rotate: false`: one row, `unread` true, `reason` starts `access token expired`, zero fetches, zero keychain writes [M2]; (c) `main` with `--account acct --no-rotate` writes one JSON line of length 1 named `acct`; `main` with `--json` alone over two listed accounts writes length 2 [M3]; (d) the `Run:` grep below [M4].
- Run: grep -qF 'usage [--json] [--account <name>] [--no-rotate]' fleet/claude-token.mjs [M4]

**Stale-if:**
- issue-closed: #1114

### Task 2: The launcher reads the windows after the refresh, prints them, and refuses at the wall

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_launch_credential.mjs`

**Claim:** A launch on an account at or past 95 % of its seven-day or five-hour window is refused on the laptop before anything is pushed, naming the account and the reset time; every other launch prints both readings on its launch line. (derived)
Machine: M1. `defaultReadUsage(account, spawn)` calls `spawn` once with `process.execPath` and an argv whose last five entries are `usage`, `--json`, `--account`, `<account>`, `--no-rotate`, and answers the first element of the JSON array on stdout; a non-zero status, or stdout that is not a JSON array with one element, answers `{ unread: true, reason: <string> }`. M2. `launch({ …, readUsage })` whose `readUsage` answers a row with `sevenDay.utilization` ≥ `USAGE_REFUSE_PCT` (exactly 95) rejects with a `Refusal` whose message carries the account name, the word `seven-day`, the utilization and `sevenDay.resetsAt`, and ends `— no VM was created and nothing was pushed`, with no `git push` run and no `new` verb issued; a row with `fiveHour.utilization` ≥ 95 is refused the same way with `five-hour`. M3. A row under both thresholds resolves with `result.usage` exactly `usage: <account> 7d <sevenDay.utilization>% resets <sevenDay.resetsAt>; 5h <fiveHour.utilization>% resets <fiveHour.resetsAt>`, and `renderLaunch` carries it as its own line directly after the `account=` line; a row `{ unread: true, reason }` resolves with `result.usage` exactly `usage: <account> unread — <reason>`, carried the same way. M4. With a `refreshCredential` that answers `refused`, `readUsage` is called zero times; with one that answers `{ ok: true }`, it is called exactly once, before any `git push`. M5. `fleet/CONTRACT.md`'s launch-order bullet names the usage read (`--no-rotate`) and the `95` threshold, and the launch-line list names the `usage:` line.

**Authorized-by:** #1114 desired state 1; `fleet/CONTRACT.md` §Launch order (the contract wins on every literal, so the new step and line are written there).

**Interfaces:**
- Consumes: none
- Produces: `defaultReadUsage(account, spawn) -> { name, fiveHour, sevenDay, unread, reason }`
- Produces: `USAGE_REFUSE_PCT`

**Context:** The read goes directly after `const cred = refreshCredential(account)` and its two refusals (line ~1307) and before the plan commit is pushed: the refresh has just run or held, so the record is unexpired and a `--no-rotate` read cannot mint anything. `readUsage` is a `launch(params)` dependency beside `refreshCredential` with default `defaultReadUsage`, exactly the shape `defaultRefreshCredential(account, spawn)` has (line ~879): `spawn(process.execPath, [tool, 'usage', '--json', '--account', account, '--no-rotate'], { encoding: 'utf8' })`, `tool` the sibling `claude-token.mjs`. `utilization` is a percentage number as the API answers it — 100 at the wall on 2026-09-17 (#1114). `USAGE_REFUSE_PCT` is an exported constant, 95, on the sentence in #1114 ("say 95 % seven-day"); the reading owed at the release is how often a refused launch would have merged. `result.usage` rides `launch`'s result object beside `account` and `token`, and `renderLaunch` (line ~1835) places it after `account=` and before `result.token`. An unread window is never a refusal (the sandbox itself cannot read usage — `GET /api/oauth/usage` through the proxy is 403, CONTRACT §probe 3 — so a laptop offline or a keychain with no `accessToken` prints `unread` and launches). The sim `fleet/tests/test_launch_credential.mjs` already drives `launch({ argv, exec, config, now, sleep, refreshCredential, kata: null })` over a local bare origin with every verb answered by a rule; the new legs sit under a comment naming this task and pass `readUsage` beside `refreshCredential`. The refusal message shape: `launch: <account> is at <n>% of its seven-day window (resets <iso>) — a run on it can only die; pick another with --account — no VM was created and nothing was pushed`. `fleet/CONTRACT.md` line ~146, the **Launch order (launcher)** bullet, gains one arrow step after the credential refresh; the launch-line list gains the line spelled `usage: <account> 7d <n>% resets <iso>; 5h <n>% resets <iso>`.

**Proof:**
- Test: `fleet/tests/test_launch_credential.mjs`
- Guard: `fleet/tests/test_launch_credential.mjs`
- Legs: (e) a spy `spawn` answering status 0 with a one-row JSON array: one call, argv's last five entries as named, the row returned; a spy answering status 1: `unread` true with a string reason [M1]; (f) `launch` with `readUsage` answering `sevenDay.utilization: 96` rejects with a `Refusal` carrying the account, `seven-day`, `96`, the reset string and the ending sentence, and the rig recorded no `git push` and no `new` verb; the same with `fiveHour.utilization: 95` carries `five-hour` [M2]; (g) `readUsage` answering `7d 58 / 5h 0` resolves with `result.usage` byte-exact as M3 spells it, and `renderLaunch(result)` has that line immediately after the `account=` line; `{ unread: true, reason: 'x' }` gives `usage: <account> unread — x` in the same place [M3]; (h) a `refreshCredential` answering `refused` leaves a spy `readUsage` at zero calls; one answering `{ ok: true }` leaves it at one call whose recorded time precedes the rig's first `git push` [M4]; (i) the two `Run:` greps below [M5].
- Run: grep -q 'no-rotate' fleet/CONTRACT.md [M5]
- Run: grep -qF 'usage: <account> 7d' fleet/CONTRACT.md [M5]

**Stale-if:**
- issue-closed: #1114

### Task 3: A rate-limited worker is named, never retried, and halts every later dispatch

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/retry.mjs`
- Modify: `factory/engine.mjs`
- Test: `fleet/tests/test_factory_retry.mjs`

**Claim:** A worker that died on the account's rate limit is recorded as rate-limited and never sent again, and every later dispatch of that run answers rate-limited without starting a worker, so the run parks at once instead of retrying into the wall. (derived)
Machine: M1. `isRateLimited(error)` is exactly `true` for the edge's answer `API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account's rate limit"}}` and for the CLI's line `You've hit your weekly limit · resets Sep 20, 11pm (UTC)`, and exactly `false` for `API Error: 529 Overloaded`, `boom` and `null`. M2. `shouldRetry({ error: <the 429 string>, turns: 0, policy })` with a backoff cell of `60000` is exactly `false`. M3. The function `retrying(once, …)` returns: after one answer from `once` whose `error` is rate-limited, every later call resolves `{ result: null, denials: [], turns: 0, error: 'rate-limited: <that first error>', halted: true }` without calling `once` — over three calls, `once` is called exactly once and `sleep` zero times; a run of three calls whose answers are never rate-limited calls `once` three times. M4. `factory/engine.mjs` parks a best candidate whose `error` is rate-limited and whose patch is empty with a `dead` reason beginning `rate-limited: `, and no longer `worker ended without a patch: `.

**Authorized-by:** #1114 desired state 2; #1219 (the one re-dispatch a gateway death is owed — a rate limit is not that shape); map #1131.

**Interfaces:**
- Consumes: none
- Produces: `isRateLimited(error) -> boolean`

**Context:** `factory/retry.mjs` is pure and imports nothing; `isGatewayError` matches `API Error: 5\d\d`, `529`, `Overloaded`. `isRateLimited` matches `\b429\b`, `rate_limit_error`, `rate limit` (case-insensitive) and `weekly limit`. `shouldRetry` stays `isGatewayError && turns === 0 && backoff > 0`, so a 429 — not a 5xx — is already not retried; M2 pins that fact so a later widening of `isGatewayError` cannot swallow it. The halt lives in the closure `retrying` returns: a `let halted = null` set to the first rate-limited `error`; while set, the returned function resolves the M3 object without calling `once`. Both of the engine's dispatchers wrap through `retrying` (`const dispatch = retrying(dispatchOnce, { policy: policyDoc })` at line ~1036 and `makeRefoldDispatch` at line ~2307), so one halt covers examiners, implementers, referees and resolvers alike; a halted call appends no `dispatch:start`/`dispatch:end` rows — the `parked` row is the record. In `engine.mjs` the implementer dead path (line ~1538, `if (best.error && bytes === 0)`) reads `dead: (isRateLimited(best.error) ? 'rate-limited: ' : 'worker ended without a patch: ') + best.error`, with `isRateLimited` imported beside `retrying` (line 64). Everything downstream is unchanged: `landing.dead` becomes a `parked` row with that reason (line ~2168), the board post and state, and the run ends parked with the PR a draft. What the SDK actually surfaces for a 429 through the edge is a fact read once — 2026-09-17, the CLI's one written line was the weekly-limit sentence and the edge's answer was the 429 body — so both literals are matched; a death whose string carries neither still parks as `worker ended without a patch` and is the next incident's reading. The sim `fleet/tests/test_factory_retry.mjs` already imports `isGatewayError`, `infraBackoffMs`, `shouldRetry`, `retrying` and `makeRefoldDispatch`; the new legs sit under a comment naming this task.

**Proof:**
- Test: `fleet/tests/test_factory_retry.mjs`
- Guard: `fleet/tests/test_factory_retry.mjs`
- Legs: (e) `isRateLimited` over the two positive strings and the three negatives, each answer by strict equality [M1]; (f) `shouldRetry` with the 429 string, turns 0 and the 60000 cell is `false` [M2]; (g) `retrying` over a `once` that answers the 429 error on its first call: three calls, `once` called once, `sleep` called zero times, calls two and three resolving the M3 object by deep equality with `error` `rate-limited: <the 429 string>`; a `once` that never answers rate-limited is called three times over three calls [M3]; (h) the two `Run:` greps below [M4].
- Run: grep -q "'rate-limited: '" factory/engine.mjs [M4]
- Run: grep -q 'isRateLimited' factory/engine.mjs [M4]

**Stale-if:**
- issue-closed: #1114

### Task 4: The doctor's claude row carries the window reading

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/doctor.mjs`
- Modify: `skills/ultrapowers/references/first-run.md`
- Test: `fleet/tests/test_doctor_claude.mjs`

**Claim:** The doctor's `claude` row shows the configured account's seven-day and five-hour readings beside its freshness line, and says `unread` with the reason when it cannot read them. (derived)
Machine: M1. `doctor({ config, exec, configKeys, account: 'acct' })` issues, among its reads, exactly one command that ends `usage --json --account acct --no-rotate`; when `exec` answers it with code 0 and a JSON array whose first row has `unread: false`, the `claude` row's `detail` ends `; 7d <sevenDay.utilization>% resets <sevenDay.resetsAt>; 5h <fiveHour.utilization>% resets <fiveHour.resetsAt>` with that row's values, and the row's `status` is what it was without the read (`ok` when `integrations list --json` carries `claude-max` with a bearer). M2. When `exec` answers that command with a non-zero code, or with a first row whose `unread` is `true`, `detail` ends `; usage unread — <reason>` (the row's `reason`, or `usage answered code <code>` for a non-zero exit) and `status` is unchanged. M3. With `account` null the command ends `usage --json --no-rotate` and the first row is read. M4. `skills/ultrapowers/references/first-run.md` §claude says the row carries the two window readings and that a read never rotates the token.

**Authorized-by:** #1114 desired state 3; `skills/ultrapowers/references/first-run.md` walks each doctor row.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `doctor()` (line ~850) runs every read through `run(cmd)` over the `exec` seam, which resolves `{ code, stdout }` and never rejects; `READS.token` is the `claude-token.mjs status` command and `wantAccount` is the configured account (`fleet.json` `account`, null when unset). Add one read beside the token read: `READS.usage` = the same tool with `usage --json --no-rotate`, plus ` --account <wantAccount>` when set, and pass its result to `claudeRow(found, tokenRes, usageRes)`. `claudeRow` (line ~478) builds `detail` as `${OAUTH_INTEGRATION} carries the bearer at the edge; ${status}`; the window suffix is appended to that string in both the `ok` and the `missing` outcomes, so the reading is visible either way, and `status` is decided exactly as today. The `--no-rotate` flag is Task 1's; until it lands, the tool answers its usage line on stderr and exit 1, which this row reports as `usage unread — usage answered code 1` — the M2 path, never a red row. The sim drives `doctor({ config, exec, configKeys, account })` in-process with an `exec` stub keyed on the command string, answering the whoami, billing, `integrations list --json`, github, token, accounts, kata and policy reads with the smallest outputs that make every other row resolve (read `fleet/doctor.mjs` for the exact `READS` strings; the stub answers `{ code: 1, stdout: '' }` to anything else and the other rows' statuses are not asserted). `first-run.md` §claude (line ~99) gains one sentence on the reading, using the words `seven-day` and `five-hour` and saying the read never rotates the token; no other doc changes.

**Proof:**
- Test: `fleet/tests/test_doctor_claude.mjs`
- Guard: `fleet/tests/test_doctor_claude.mjs`
- Legs: (a) with account `acct` and an `exec` that answers the usage command with one `unread: false` row: exactly one recorded command ends `usage --json --account acct --no-rotate`, and the `claude` row's `detail` ends with the M1 suffix built from that row's four values, its `status` `ok` under a bearer-carrying `claude-max` [M1]; (b) an `exec` answering that command with code 1: `detail` ends `; usage unread — usage answered code 1`; answering a row `{ unread: true, reason: 'x' }`: `detail` ends `; usage unread — x`; both with `status` `ok` [M2]; (c) with account null, the recorded command ends `usage --json --no-rotate` and carries no `--account` [M3]; (d) the `Run:` below [M4].
- Run: sed -n '/^## claude/,/^## /p' skills/ultrapowers/references/first-run.md | grep -q 'seven-day' [M4]

**Stale-if:**
- issue-closed: #1114
