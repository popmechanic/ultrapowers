# The factory's feedback system: a federated Kata board on every sandbox that every sensor writes to and every worker reads from

**Grammar:** claims-v1

**Claim:** do: run a plan on the factory and watch its board; see: every worker starts with everything already known about its task, every defect the run finds is on that task's issue the moment it is found, a landing the judge reads as short gets one more attempt with the judge's own words in hand, and a hub outage costs the run nothing. (elicited)
**Summary:** This is the factory's feedback system: a Kata board on every sandbox, federated to the hub, that every sensor writes to and every worker reads from. It exists because the factory finds defects six ways and tells a worker about two of them, and a run's forty minutes of work leave three rows behind. You get workers that start informed and get a second attempt with the reason in hand, a record of what each one actually did, and a live board you can watch.

**Goal:** Map #810's blackboard, built whole on the factory (map #1131): #983's spoke per sandbox, enrolled through Kata 0.18's credential-provider helper instead of a hand-built endpoint; one board module that is the only code that talks to Kata; every sensor posting to the task's issue; the hand-off as the one delivery channel; the spec's missing re-dispatch; readiness re-read on every adoption, which ends the batch loop; worker telemetry as rows (#1092, reshaped); Jev as the settled-interface matcher (#1130) and the files-amendment re-edge (#1129's arithmetic half). The operator's call, 2026-09-18: one full build-out, no probe, rollback by commit — so every reading this plan introduces is an `experiment` under the n = 5 floor with its rollback named: the re-dispatch floor's rollback is `policy.landing.redispatch.enabled = false`; the board's rollback is a boot that finds no spoke and hands the engine no `--kata-url`, which is the engine exactly as run-191 drove it. Readings cited: run-189 (n=1 run, 2 tasks, 3 min 19 s), run-191 (n=1 run, 2 tasks, one referee hire with 8 minor findings that reached no one), runs 188 and 190 (two defects caught by the record and fixed by hand). Nothing under the old engine moves: `fleet/run-*.mjs`, `fleet/sandbox-boot.sh` and `fleet/roles/` are frozen.
**Closes:** #983 #1130

**Tech Stack:** Kata 0.18.0 (`kata_0.18.0_linux_amd64.tar.gz`, sha-checked against the release's `SHA256SUMS`, as `fleet/kata-hub-setup.sh` already does for 0.17.2); bash for the boot; Node 24 ESM for the helper, the board, the tools and the engine, with no new npm dependency; `fleet/kata-client.mjs` consumed as-is (the HTTP client the hub facts were measured against), pointed at the spoke on `http://127.0.0.1:7777`.
Spec: `docs/superpowers/specs/2026-09-17-jev-factory.md` §The loop and #810, #983, #1128–#1130 on the target — laptop only; what a worker needs is in its Context.

**Parallelization rationale:** wave 1 is six wide — the hub, the helper, the boot, the board, the tools and the briefs share no file, and the three shapes they share (the helper's argv, the engine's new arguments, the fact kinds) are one literal block in every Context that needs it. Wave 2 is the engine alone: it needs the board's runtime behaviour (what `factsFor` renders, that a failed post resolves null), which its exam drives through the real module. Wave 3 is the cross-task pair, which edits the engine the second wave leaves and reads the rows it writes; that chain is a same-file sequence of behaviour, not of shape.

## Global Constraints

- A board write is never the run's failure: every call the engine or a tool makes to Kata resolves, a failure is one `board:` log line, and a run with no spoke at all is the engine as run-191 drove it.
- No credential on any VM, in any argv, or in any file this plan writes: the hub's admin bearer is injected at the edge on `kata.int.exe.xyz`, and the spoke's own enrollment token is minted by the spoke's Kata daemon and stored only in Kata's own credential file under `KATA_HOME`.
- Models never run git and never call Kata directly: a worker reaches the board only through the in-process tools; the engine and the boot are the only other writers.
- A judgment is a question in `factory/questions.json` read through `factory/judge.mjs` with its threshold in `factory/policy.json`, carrying `n`, `window`, `experiment` and `rollback`; no threshold is a literal in code.
- Check: git diff --quiet $ULTRA_BASE -- ':(glob)fleet/run-*.mjs' fleet/sandbox-boot.sh fleet/fleet-bootstrap.sh fleet/roles fleet/kata-client.mjs fleet/launch.mjs skills/ultrapowers/kernel skills/ultrapowers/scripts/compile_plan.py
- The shared literals. Fact kinds, each the first line of an issue comment in square brackets: `[exam-note]`, `[note]`, `[landing]`, `[finding:<grade>]`, `[conflict]`, `[worker-error]`, `[park]`, `[redispatch]`. Task state is the issue metadata key `factory.state`, one of `queued`, `dispatched`, `adopted`, `parked`. The engine's new arguments: `--kata-url <http://127.0.0.1:7777> --kata-project <project id> --kata-json <path to the run's kata.json>`. The helper's argv in the spoke's config: `["node", "<engine>/factory/kata-credential.mjs", "--kata-json", "<path>", "--admin-url", "https://kata.int.exe.xyz", "--state-dir", "<dir>"]`.

### Task 1: The hub runs Kata 0.18 and has a pass-through path for a spoke's own token

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/kata-hub-setup.sh`
- Modify: `fleet/kata-hub.mjs`
- Test: `fleet/tests/test_kata_hub_fed.mjs`

**Claim:** The hub is built on Kata 0.18 and a sandbox has two ways to reach it: the one that carries the hub's own bearer for administration, and one that passes a spoke's token through untouched for federation. (derived)
Machine: M1. `fleet/kata-hub-setup.sh` installs `kata_0.18.0_linux_amd64.tar.gz` from `https://github.com/kenn-io/kata/releases/download/v0.18.0/`, verified against that release's `SHA256SUMS`, and names no `0.17`. M2. `fleet/kata-hub.mjs` exports `FED_INTEGRATION` equal to `kata-sync` and `fedAddVerb(httpsUrl)` answering exactly `integrations add http-proxy --name kata-sync --target <httpsUrl> --peer --comment 'kata hub federation transport — passes Authorization through' --policy 'tag:fleet'` and `fedAddVerbAttach(httpsUrl)` answering the same string with `--attach tag:fleet` in place of `--policy 'tag:fleet'`, neither carrying `--bearer`, `--header` or `--no-auth`. M3. The hub build, run with a fake `exec`, issues `fedAddVerb` once when the lobby's integrations listing has no `kata-sync` and not at all when it has one, and the rendered hub setup script stays within `HUB_SETUP_BUDGET_BYTES`.

**Authorized-by:** #983 (the spoke; Shelley's counsel of 2026-09-13 on direction and transport); Kata v0.18.0 release notes (credential helper, 2026-09-17)

**Interfaces:**
- Consumes: none
- Produces: `fedAddVerb(httpsUrl) -> string`

**Context:** `fleet/kata-hub.mjs` builds the hub VM once from the laptop (`node fleet/kata-hub.mjs`): it creates the VM with the setup script, shares port 8000, and adds the `kata` http-proxy integration with `addVerb(httpsUrl)`, which carries `--bearer -` so the edge injects the hub's admin bearer on every request. That injection REPLACES a client's own `Authorization` header (measured 2026-09-03), which is right for administration and wrong for a spoke's sync, whose requests must carry the spoke's own enrollment token. So the hub gains a second integration to the same target with no bearer: `kata-sync`, reachable from a sandbox as `https://kata-sync.int.exe.xyz`. Shelley's counsel (2026-09-18, conversation `kata-federation-proxy-configuration` on fleet-counsel): the verb is `integrations add http-proxy --name kata-sync --target <hub https url> --peer` with the fleet grant and NO `--bearer`, `--header` or `--no-auth` — peer auth rides a reserved internal header the target never sees, so the spoke's own `Authorization: Bearer <enrollment token>` is the only one in flight; two integrations on one VM port are normal; never time-box the grant. Unmeasured, and measured by the first bound run rather than a probe: whether the edge passes a non-exe bearer in `Authorization` through untouched — if it does not, the spoke never binds, the boot logs `board:` and the run proceeds without a board. Follow `addVerb`'s shape and its attach-model twin (`addVerbAttach`: `--attach tag:fleet` where `--policy` is an unknown flag). The build's idempotence reads the lobby's integrations listing the way it already does for `kata`. The setup script's version is three literals at the top of `fleet/kata-hub-setup.sh` (`KATA_VERSION`, `ASSET`, `BASE`). The exam imports the module and drives the build with a fake `exec` that records each lobby verb; it spawns nothing, and if it does, its env is `simEnv(...)` from `fleet/tests/_helpers.mjs`.

**Proof:**
- Test: `fleet/tests/test_kata_hub_fed.mjs`
- Legs: (a) the setup script text contains `KATA_VERSION=0.18.0`, `kata_0.18.0_linux_amd64.tar.gz` and `releases/download/v0.18.0/`, a `sha256sum -c` line, and no occurrence of `0.17` [M1]; (b) `FED_INTEGRATION` is `kata-sync`, `fedAddVerb('https://h.example')` equals the clause's string exactly, `fedAddVerbAttach('https://h.example')` equals it with `--attach tag:fleet` in place of `--policy 'tag:fleet'`, and neither string contains `--bearer`, `--header` or `--no-auth` [M2]; (c) with a fake `exec` whose integrations listing names only `kata`, the recorded verbs contain `fedAddVerb`'s string exactly once; with a listing naming `kata` and `kata-sync`, zero times; and `renderHubSetupScript` over the repository's template and unit has a UTF-8 byte length at most `HUB_SETUP_BUDGET_BYTES` [M3].

**Stale-if:**
- path-absent: `fleet/kata-hub.mjs`

### Task 2: The credential helper — a spoke is approved through the edge, and no token is ever copied

**Type:** implementation
**Review:** peer

**Files:**
- Create: `factory/kata-credential.mjs`
- Test: `fleet/tests/test_factory_kata_credential.mjs`

**Claim:** A sandbox's Kata asks a helper for access to the hub and gets it, because the helper registers the token Kata itself minted through the edge that already vouches for the sandbox; when the run leaves, the helper takes that access away. (derived)
Machine: M1. `node factory/kata-credential.mjs --kata-json <file> --admin-url <url> --state-dir <dir>` reads one JSON object on stdin; for `{"version":1,"operation":"authorize",...}` it POSTs `<admin-url>/api/v1/projects/<project.id>/federation/enable`, then POSTs `<admin-url>/api/v1/federation/enrollments` with a JSON body carrying `project_id` (the `project.id` of the kata.json file), `spoke_instance_uid` (the request's), `capabilities` `claim,pull,push`, `actor` `factory`, and `token` (the request's `candidate_token`), and sends no `authorization` header on either. M2. On a 2xx enrollment answer it writes `<state-dir>/<request_id>.json` holding the enrollment id and prints exactly one JSON object on stdout with keys exactly `version`, `operation`, `request_id`, `status`, `hub_url`, `project_id`, `enrollment_id`, `project_uid`, `actor`, `capabilities`, where `status` is `ready`, `hub_url` echoes the request's, `project_uid` is the kata.json's `project.uid`, `capabilities` is `claim,pull,push`, and exits 0; the candidate token appears nowhere on stdout, on stderr or in the state file. M3. On a non-2xx answer or a connection failure it prints `{version, operation, request_id, status: "unavailable"}` and exits 0; on a `409` it prints `status` `conflict`; when the request's `intent` is not `collaborate` it prints `status` `denied`; on stdin that is not one JSON object with `version` 1 and a known `operation` it prints nothing and exits 2. M4. For `{"operation":"release"}` it reads `<state-dir>/<request_id>.json`, POSTs `<admin-url>/api/v1/federation/enrollments/<enrollment_id>/revoke`, prints `status` `released` on a 2xx or when the state file is absent, `unavailable` otherwise, and exits 0.

**Authorized-by:** Kata v0.18.0 `docs/development/embedding.md` §Federation credential providers (the helper protocol) and `docs/reference/http-api.md` (`POST /api/v1/federation/enrollments` accepts a caller-supplied `token`); #983

**Interfaces:**
- Consumes: none
- Produces: `factory/kata-credential.mjs`

**Context:** Kata 0.18 lets a spoke's `config.toml` name a `credential_provider`: a program Kata runs directly, without a shell, handing it one UTF-8 JSON object on stdin (at most 16 KiB) and reading one from stdout, within 60 seconds. Kata mints a random 32-byte candidate token, SAVES it, and asks the helper to get that exact token approved; the helper never returns a token. An `authorize` request carries `version` (1), `operation`, `request_id` (lowercase hyphenated UUID), `hub_url` (the HTTPS base the spoke will sync with), `project` (the hub project key), `spoke_instance_uid`, `local_project_uid`, `intent` (`read_only` | `collaborate` | `migrate`) and `candidate_token` (unpadded base64url). A `ready` response must echo `version`, `operation`, `request_id` and carry `hub_url` (matching the request's), positive integers `project_id` and `enrollment_id`, `project_uid` (uppercase ULID), `actor` (not `bootstrap`), and `capabilities` — exactly `claim,pull,push` or `pull,push` for `collaborate`; unknown, duplicate or null fields are invalid, and any non-zero exit discards stdout. Exit 0 is a valid response including denial, 2 is invalid input, 1 is a failed exchange. On the sandbox the hub's administration API is `https://kata.int.exe.xyz`, where the exe.dev edge injects the hub's admin bearer for VMs tagged `fleet` — that edge is the authority, so the helper holds and sends no credential; the spoke's later sync goes to a different host (`https://kata-sync.int.exe.xyz`, the request's `hub_url`) carrying its own token. The run's `kata.json` (written by the launcher onto the plan commit) is `{"url":…,"project":{"id":…,"uid":…,"name":…},"run":{…},"tasks":{"<id>":{"uid":…,"short_id":…,"revision":…}}}`. The enrollment answer is a JSON document whose enrollment id is at `enrollment.id` or top-level `id` — read either. Use `globalThis.fetch`; the exam starts a `node:http` server on `127.0.0.1` port 0 inside its own process as the fake hub and spawns the helper with `env: simEnv(...)` from `fleet/tests/_helpers.mjs`.

**Proof:**
- Test: `fleet/tests/test_factory_kata_credential.mjs`
- Legs: (a) against a fake hub answering 200 to both routes, the fake saw, in order, `POST /api/v1/projects/12/federation/enable` and `POST /api/v1/federation/enrollments` whose parsed body has `project_id` 12, the request's `spoke_instance_uid`, `capabilities` `claim,pull,push`, `actor` `factory` and `token` equal to the request's `candidate_token`, and neither request carried an `authorization` header [M1]; (b) with the fake answering the enrollment `{"enrollment":{"id":77}}`, stdout parses to an object with keys exactly the ten named, `status` `ready`, `hub_url` equal to the request's, `project_id` 12, `enrollment_id` 77, `project_uid` equal to the kata.json's, `capabilities` `claim,pull,push`, exit 0, `<state-dir>/<request_id>.json` parses with the enrollment id 77, and the candidate token string occurs in none of stdout, stderr and that file; with the fake answering `{"id":78}` the `enrollment_id` is 78 [M2]; (c) the fake answering 500 → `status` `unavailable`, exit 0; the fake closed → `unavailable`, exit 0; answering 409 → `conflict`; a request with `intent` `read_only` → `denied` and the fake saw no request; stdin `not json` → empty stdout, exit 2; stdin `{"version":2,"operation":"authorize"}` → exit 2; stdin `{"version":1,"operation":"frobnicate","request_id":"…"}` → exit 2 [M3]; (d) after a `ready` exchange, a `release` for the same `request_id` makes the fake see `POST /api/v1/federation/enrollments/77/revoke` and prints `status` `released`; a `release` for an unknown `request_id` prints `released` with no request seen; with the fake answering 500 to the revoke it prints `unavailable`; all exit 0 [M4].

**Stale-if:**
- path-exists: `factory/kata-credential.mjs`

### Task 3: The boot stands up the spoke, waits for its approval, and tells the engine where the board is

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/boot.sh`
- Test: `fleet/tests/test_factory_boot.mjs`

**Claim:** A sandbox brings up its own board before the engine starts and joins it to the hub without anyone copying a token; if the board does not come up the run goes ahead without it, and when the run ends the sandbox leaves. (derived)
Machine: M1. Before the engine unit starts, and only when the plan commit carries `.ultrapowers/kata.json`, the boot writes that blob to `$FLEET_HOME/plans/run-<N>.kata.json`, installs `kata` 0.18.0 into `$FLEET_HOME/.local/bin` from `https://github.com/kenn-io/kata/releases/download/v0.18.0/kata_0.18.0_linux_amd64.tar.gz` after `sha256sum -c` against that release's `SHA256SUMS`, and writes `$FLEET_HOME/kata/config.toml` containing `listen = "127.0.0.1:7777"`, a `[[daemon]]` named `hub` with `url = "https://kata-sync.int.exe.xyz"`, and one `[[federation.project]]` with `hub = "hub"`, `spoke_project` and `hub_project` both the kata.json's `project.name`, `intent = "collaborate"`, and `credential_provider` equal to the Global Constraints' helper argv with `<engine>` the engine checkout, `<path>` that kata.json file and `<dir>` `$FLEET_HOME/kata/helper`; the file names no `token`, `token_env` or `actor`. M2. It starts `kata daemon start --foreground` as `systemd-run --user --unit=fleet-kata-<N>` with `KATA_HOME=$FLEET_HOME/kata`, then polls `kata federation status --json` (with `KATA_SERVER=http://127.0.0.1:7777`) until the project's binding reports an approved, bound state or `$FLEET_KATA_WAIT_SECONDS` have passed. M3. When the spoke is bound the engine's command line gains, after `--run-dir <dir>`, exactly `--kata-url http://127.0.0.1:7777 --kata-project <project.id> --kata-json <that file>`; when the plan commit has no kata.json, the install fails, or the wait expires, the boot logs one line beginning `board:` and the engine's command line is exactly what it was at BASE. M4. A bound spoke is left with `kata federation leave <project.name>` and its unit stopped, after the pull request is opened on the publish path and also when the engine exits non-zero with nothing ahead of base; a failing `leave` is one `board:` log line and changes neither the run's state nor the boot's exit code.

**Authorized-by:** #983 (a spoke per sandbox; teardown by leave); Kata v0.18.0 `docs/operations/federation.md` §External credential providers and `docs/reference/configuration.md` §Credential provider; CLAUDE.md "Hub writes are never the run's failure"

**Interfaces:**
- Consumes: none
- Produces: `factory/boot.sh boot`

**Context:** `factory/boot.sh` today: `boot()` runs `prepare` (clone, plan, verdicts, evidence worktree), `engine_deps`, `auth_status`, `bearer_probe`, `run_engine`, then decides the outcome by what landed and calls `publish`. Add one function between `bearer_probe` and `run_engine` that brings the board up, and one after the outcome that takes it down; `run_engine`'s argv gains the three arguments only when the first succeeded. Kata 0.18's config-driven federation: a `[[federation.project]]` block with a `credential_provider` array makes the daemon, at start, mint and save a candidate token, run the helper (the sibling task's `factory/kata-credential.mjs`, under `node`), and on `ready` bind an EMPTY local project to the hub project and start pull (every 30 s) and push; provider mappings require HTTPS, and must not set `actor`, `token` or `token_env`. The spoke syncs with `https://kata-sync.int.exe.xyz` (the pass-through integration the hub task adds) and the helper administers through `https://kata.int.exe.xyz` (bearer injected at the edge). `kata federation status --json` lists bindings with their approval state; treat any binding for the project whose JSON carries an approved or bound status as ready, and log the raw JSON once on timeout so the record shows what it said. The release tarball holds a `kata` binary at its root or one directory down (`tar -tzf … | grep -E '(^|/)kata$'`), as `fleet/kata-hub-setup.sh` handles it. The size of this file is a number the pull request reports, not a clause. The exam is the existing stub-on-`PATH` shape (run-187's): stub `curl`, `git`, `npm`, `claude`, `systemd-run`, `node`, `tar`, `sha256sum` and `kata` first on `PATH`, a temporary `FLEET_HOME`, `FLEET_KATA_WAIT_SECONDS=2`, `env: simEnv(...)` from `fleet/tests/_helpers.mjs`; the stub `git show <plan>:.ultrapowers/kata.json` answers a small kata.json or fails, and the stub `kata federation status --json` answers a configured document.

**Proof:**
- Test: `fleet/tests/test_factory_boot.mjs`
- Legs: (a) with the stub `git` answering the kata.json blob, `<FLEET_HOME>/plans/run-7.kata.json` holds its bytes, the stub `curl` saw the tarball URL and the `SHA256SUMS` URL of `v0.18.0`, the stub `sha256sum` was called with `-c` before the stub `tar` extracted, and `<FLEET_HOME>/kata/config.toml` contains each literal the clause names with the project name from the blob and the helper argv in order, and none of `token =`, `token_env`, `actor =` [M1]; (b) the stub `systemd-run` saw a `--user --unit=fleet-kata-7` invocation whose command is `kata daemon start --foreground` with `KATA_HOME=<FLEET_HOME>/kata` in its environment, before the engine's unit; with the stub `kata` answering unbound twice and then bound, the stub saw three `federation status --json` calls, each with `KATA_SERVER=http://127.0.0.1:7777`, and no fourth [M2]; (c) bound → the engine unit's argv ends `--run-dir <FLEET_HOME>/run --kata-url http://127.0.0.1:7777 --kata-project 12 --kata-json <FLEET_HOME>/plans/run-7.kata.json`; for each of: the stub `git` failing the kata.json blob, the stub `sha256sum` exiting 1, and the stub `kata` never answering bound — the engine unit's argv ends `--run-dir <FLEET_HOME>/run`, the log carries a line beginning `board:`, and the run still reaches its publish path [M3]; (d) on the bound drive the stub `kata` saw `federation leave <project.name>` after the pull request POST and the stub `systemd-run`/`systemctl` saw the unit stopped; with the stub `kata` exiting 1 on `leave`, the final `status.json` state and the boot's exit code equal the bound drive's and the log carries `board:`; on a bound drive whose stub engine exits 2 with the target's head equal to base, the stub `kata` still saw `federation leave <project.name>`, the final state is `failed` and the boot exits 2; on the unbound drives no `leave` is issued [M4].

**Stale-if:**
- path-absent: `factory/boot.sh`

### Task 4: The board — the one module that talks to Kata, and it never fails a run

**Type:** implementation
**Review:** peer

**Files:**
- Create: `factory/board.mjs`
- Test: `fleet/tests/test_factory_board.mjs`

**Claim:** Everything the run learns about a task goes onto that task's issue through one module, and anyone about to work on the task can be handed all of it as plain text; when the board cannot be reached the module says so in the log and the run carries on. (derived)
Machine: M1. `makeBoard({ kata, projectId, tasks, log })`, with `tasks` the kata.json's `tasks` object, answers `{ post, factsFor, setState, states, settled }`; `post(taskId, kind, text)` calls `kata.comment(projectId, tasks[taskId].uid, '[' + kind + ']\n' + text)` once and resolves the client's answer. M2. `factsFor(taskId)` reads the task's issue with `kata.getIssue(uid)` and resolves one string: the issue's comments whose first line is a bracketed kind, oldest first, each rendered as its kind line then its text, separated by blank lines, keeping the NEWEST whole facts that fit in 12,000 characters and prefixing `(earlier facts omitted)` when any was dropped; an issue with no such comment resolves the empty string. M3. `setState(taskId, state)` calls `kata.patchMetadata(projectId, uid, { 'factory.state': state })`; `states()` resolves `{ <taskId>: <factory.state or null> }` for every task from `kata.listIssues(projectId)`; `settled(taskId)` resolves the parsed `interface.settled` metadata of that task's issue or `null`. M4. Every one of the five methods resolves and never rejects: when the client fails or `tasks[taskId]` is absent, the method calls `log` once with a string beginning `board:` and resolves `null` (`factsFor` resolves the empty string, `states` resolves `{}`); `makeBoard` with no `kata` answers the same five methods, each resolving that empty value without calling `log`.

**Authorized-by:** #810 (map: the blackboard); CLAUDE.md "Hub writes are never the run's failure"; Kata `docs/workflows/agents.md` (comments for decisions, metadata for state)

**Interfaces:**
- Consumes: none
- Produces: `makeBoard({ kata, projectId, tasks, log }) -> { post, factsFor, setState, states, settled }`

**Context:** `kata` is `fleet/kata-client.mjs`'s `makeKataClient({ transport, actor })`, already measured against the hub: `comment(projectId, uid, body)`, `getIssue(uid)` (answers the issue with its `comments` array, each `{ body, author, created_at }`, and its `metadata` object), `patchMetadata(projectId, uid, patch, revision)` (merges per key; omit `revision`), `listIssues(projectId)` (answers `[{ uid, metadata, … }]`). On a sandbox it points at the spoke on `http://127.0.0.1:7777`, so a call is a local write that Kata replicates in the background. The fact kinds the engine and tools use are the Global Constraints' list; this module does not validate a kind, it brackets whatever it is given. `factsFor`'s cap keeps whole facts: drop from the oldest end until the rendering fits. The exam drives a plain-object fake client that records calls and answers configured issues; it spawns nothing and touches no network.

**Proof:**
- Test: `fleet/tests/test_factory_board.mjs`
- Legs: (a) `post('2', 'landing', 'x')` with `tasks['2'].uid` `U2` calls the fake's `comment` once with `(projectId, 'U2', '[landing]\nx')` and resolves its answer; the answered object has keys exactly `post`, `factsFor`, `setState`, `states`, `settled` [M1]; (b) with the fake's issue carrying comments `[exam-note]\na`, `plain talk`, `[landing]\nb` in that order, `factsFor('2')` is exactly `[exam-note]\na\n\n[landing]\nb`; with no bracketed comment it is `''`; with forty facts of 1,000 characters each it is at most 12,000 characters long, begins `(earlier facts omitted)`, ends with the newest fact whole and contains no partial fact [M2]; (c) `setState('2', 'adopted')` calls `patchMetadata(projectId, 'U2', { 'factory.state': 'adopted' })`; with the fake listing issues `U1` (`factory.state` `adopted`) and `U2` (none), `states()` is `{ '1': 'adopted', '2': null }`; with `U1`'s metadata `interface.settled` the string `{"symbol":"f","file":"a.py","task":"1"}`, `settled('1')` deep-equals that object and `settled('2')` is `null` [M3]; (d) for each of `post`, `factsFor`, `setState`, `states`, `settled`: with a fake whose method rejects, the call resolves its empty value (`null`, `''`, `null`, `{}`, `null`) and `log` was called once with a string beginning `board:`; `post('9', …)` with no task `9` does the same without calling the fake; `makeBoard({})` answers the five methods, each resolving its empty value with `log` never called [M4].

**Stale-if:**
- path-exists: `factory/board.mjs`

### Task 5: A worker can re-read everything known about its own task, mid-task

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/tools.mjs`
- Test: `fleet/tests/test_factory_tools.mjs`

**Claim:** A worker that is stuck can ask what is already known about its task and get the same facts the next worker would be handed, and the four tools it already had still do what they did. (derived)
Machine: M1. `factoryTools({ kata, projectId, task, candidates, board })` registers a fifth tool named `task_facts`, taking no arguments, whose handler resolves one text content block carrying `board.factsFor(task.id)`, or the text `no facts yet` when that is the empty string or `board` is absent. M2. The `note` tool's comment body begins with the line `[note]`, so a worker's note is a fact `factsFor` renders. M3. The returned value is still `createSdkMcpServer`'s config named `factory` whose enumerable keys are exactly `type`, `name`, `instance`.

**Authorized-by:** #810 (map: mid-task posting and reading); Kata `docs/workflows/agents.md`

**Interfaces:**
- Consumes: none
- Produces: `factoryTools({ kata, projectId, task, candidates, board }) -> the SDK MCP server config named 'factory'`

**Context:** `factory/tools.mjs` builds the in-process MCP server a worker holds: `note` (a comment on the task's issue), `hand` (sets `work.attention` `needs-human` with a message), `settled` (writes `interface.settled` when the symbol is one of `candidates`), `sibling_fact` (reads a sibling's issue metadata). Every handler already answers a text block and catches a rejecting Kata call as `kata refused: <message>`; keep that. `board` is the sibling board module's `makeBoard(...)` answer, of which this file uses only `factsFor(taskId) -> Promise<string>`; the exam passes a plain fake with that one method. The tool definitions hang off the returned config non-enumerably as `tools` and `handlers` (run-185's amendment), which is how the exam invokes a handler directly; the SDK import is resolved by the file's existing `load(...)` fallback, so the exam needs `fleet/node_modules` and nothing else.

**Proof:**
- Test: `fleet/tests/test_factory_tools.mjs`
- Legs: (a) the registered tool names are exactly `note`, `hand`, `settled`, `sibling_fact`, `task_facts`; invoking `task_facts` with a fake `board.factsFor` resolving `[landing]\nb` answers a text block equal to that string and called `factsFor` with the task's id; resolving `''` answers `no facts yet`; with no `board` it answers `no facts yet` [M1]; (b) invoking `note` with body `hello` calls the fake `kata.comment` once with a body exactly `[note]\nhello` [M2]; (c) `Object.keys` of the returned config is exactly `['type', 'name', 'instance']` and `name` is `factory` [M3].

**Stale-if:**
- path-absent: `factory/tools.mjs`

### Task 6: The briefs — the examiner explains its exam, and the implementer reads what is known first

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `factory/roles/exam.md`
- Modify: `factory/roles/implement.md`

**Claim:** The examiner leaves the implementer a note saying what each part of the exam measures and what was awkward to encode, and the implementer is told to read what is already known about its task before it starts and again when it is stuck. (derived)
Machine: M1. `factory/roles/exam.md` tells the examiner to hand in through the `note` tool one note that says, for each leg of the exam, which clause it measures and how, and says in that same note what the exam had to assume about the code under test. M2. `factory/roles/implement.md` names the `HAND-OFF:` block as the first thing to read, names the `task_facts` tool as what to call when the same assertion has been red twice, and names the `hand` tool, in one sentence with the word `person` or `human`, as what to call for a decision only a person can make. M3. Neither file contains any of the words `blocking`, `minor`, `severity`, `verdict`.

**Authorized-by:** #810 (map); the operator's principle of 2026-09-18: as much context about a discovered defect as the system holds goes back to the factory floor

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The two briefs are short prose read by a worker at the top of its session (`exam.md` 26 lines, `implement.md` 35 lines at BASE). Keep their register: what to make and what to look for, never how it is graded. The examiner's note is the one piece of context the implementer lacks today: a peer has just decided what each assertion means, and the implementer reverse-engineers it from red output. The engine (a sibling task) posts the examiner's note to the task's issue as an `[exam-note]` fact and hands every later worker the task's facts in a `HAND-OFF:` block; `task_facts` is the worker's own tool for re-reading them mid-task. On the factory these two files are judged by Jev over their clauses; the `Run:` lines below are the reviewer's reading.

**Proof:**
- Run: tr '\n' ' ' < factory/roles/exam.md | grep -qE 'note[^.]*(each|every) leg[^.]*clause'
- Run: tr '\n' ' ' < factory/roles/exam.md | grep -qiE 'note[^.]*assum|assum[^.]*note'
- Run: tr '\n' ' ' < factory/roles/implement.md | grep -qE 'HAND-OFF:[^.]*first'
- Run: tr '\n' ' ' < factory/roles/implement.md | grep -qE 'task_facts[^.]*red twice|red twice[^.]*task_facts'
- Run: tr '\n' ' ' < factory/roles/implement.md | grep -qE '.hand. tool[^.]*(person|human)|(person|human)[^.]*.hand. tool'
- Run: ! grep -qwiE 'blocking|minor|severity|verdict' factory/roles/exam.md factory/roles/implement.md
- Legs: (a) the first two `Run:` lines establish the examiner's note sentence names each leg with its clause and says what was assumed [M1]; (b) the third, fourth and fifth establish the implementer's three instructions [M2]; (c) the sixth establishes the four grading words are absent from both files [M3].

**Stale-if:**
- path-absent: `factory/roles/implement.md`

### Task 7: The engine closes the loop — every sensor posts, every worker is handed what is known, a short landing gets one more attempt, and readiness is re-read on every adoption

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/engine.mjs`
- Modify: `factory/policy.json`
- Test: `fleet/tests/test_factory_engine.mjs`

**Claim:** Whatever the run finds out about a task — from its examiner, its exam, the judge, a referee, a conflict, a worker that died — is on the task's issue at once and in the hands of whoever works on the task next; a landing the judge reads as short gets exactly one more attempt with those words; a task starts the moment what it waits on is adopted; and the record says what each worker actually did. (derived)
Machine: M1. With `--kata-url`, `--kata-project` and `--kata-json` the engine builds one board with `makeBoard` over a Kata client on that URL and the file's `tasks`, passes it to `factoryTools` with `task.uid` read from that file, and sets `factory.state` to `dispatched` when a task's first worker starts, `adopted` when it folds and `parked` when it parks; without those arguments it builds `makeBoard({})` and behaves as at BASE. M2. It posts to the task, through `board.post`: `exam-note` with the exam worker's final text after the exam worker returns; `landing` after every measurement, carrying the exam's exit code, the last 1,500 characters of its output, the judge's claim reading and, for the lowest-covered clause, its text and score; `finding:<grade>` once per referee finding with the finding's text; `conflict` when a fold does not complete; `worker-error` with the message when a worker ends in error; `park` with the reason when a task parks; `redispatch` when a second attempt starts. M3. Every worker prompt the engine assembles for a task — exam, implement, referee, fix, resolve — ends with `\n\nHAND-OFF:\n` followed by `board.factsFor(task.id)` when that string is non-empty, and carries no `HAND-OFF:` block when it is empty. M4. When the best candidate's exam exit is not 0, or its lowest clause coverage is below `policy.landing.redispatch.coverage_floor`, and `policy.landing.redispatch.enabled` is true, the engine dispatches one more implementer in that candidate's clone with the hand-off, measures again and keeps the second measurement; it never dispatches a third; `factory/policy.json` gains `landing.redispatch` `{ "enabled": true, "coverage_floor": 0.5, "n": 0, "window": "none", "basis": "judgment", "experiment": true, "rollback": "enabled = false" }`. M5. Readiness is re-read after every adoption and every park: a task whose `depends_on` and `dag_edges` predecessors are all adopted is dispatched then, while siblings from an earlier ready set are still in flight; a task whose predecessor parked is parked with a reason naming it. M6. For every `tool_use` block a worker emits the engine appends `{ kind: 'worker:tool', task, label, tool, target }` to `events.jsonl`, `target` being the input's `file_path`, `path`, `pattern` or the first 200 characters of `command`; for every `tool_result` of a `Bash` call whose command contains the task's test command or one of its `proofTests` paths it appends `{ kind: 'worker:test-run', task, label, cmd, red }` with `red` the result's `is_error`.

**Authorized-by:** spec `docs/superpowers/specs/2026-09-17-jev-factory.md` §The loop ("adopt the best candidate; re-dispatch the rest once, the judge's row as the hand-off"; "fold on every adoption; no epoch, no barrier"); #810; #1092 as revised 2026-09-18 (the worker-side row)

**Interfaces:**
- Consumes: `makeBoard({ kata, projectId, tasks, log }) -> { post, factsFor, setState, states, settled }`
- Produces: `runEngine(args, deps) -> Promise<{ done, adopted, head, wall_ms, cost_usd }>`

**Context:** `factory/engine.mjs` at BASE: `runEngine` parses the plan with `plan_parse.py`, builds `waitsOn` from `depends_on` and `dag_edges`, and loops `while (done.size < tasks.length)`: it takes the ready set, runs `Promise.all(ready.map(land))`, then folds each landing in turn — a batch that folds after the batch, which is the epoch the spec forbids. `land(task, anchor)` reads the task, dispatches the exam worker, `k` implementers, measures each (`measure`: the exam command, the patch, `readLanding`), selects, optionally hires the referee and one fix, and returns `{ task, k, anchor, best, dead? }`; `foldIn` folds through the kernel and may call `resolve`. `dispatch` is the one door every worker goes through and already catches a worker's error into `answer.error`; `onMessageFor(label, taskId)` is the one place the worker's message stream is seen (today: the text of assistant turns, for one supervisor reading at turn ten) — the telemetry rows of M6 go there, reading every message's `content` blocks and pairing a `tool_result` to its `tool_use` by `tool_use_id`. The pool: keep a map of in-flight landings; whenever one settles, fold it (folds stay one at a time, in settle order), re-read readiness, dispatch what became ready, and finish when nothing is in flight and nothing is ready. The `tools` dep at BASE is built only when `--kata-url` is given and passes `candidates: []` and an undefined `task.uid`; build it with the board and the real uid. `makeBoard({})` is the no-board board: every method resolves its empty value, so no call site needs a guard. The engine's exports and its resolved answer's five keys stand. `deps` gains `board` for the exam to inject; the exam is the fake-driven rig run-185's engine exam used (`fleet/tests/_engine_helpers.mjs`'s `makeRepo`, fake `worker`, `judge`, `sh`), with a fake board that records `post`/`setState` and answers a configured `factsFor`; a fake worker can call `opts.onMessage` with scripted messages and can stay pending on a promise the exam resolves, which is how the pool's ordering is observed.

**Proof:**
- Test: `fleet/tests/test_factory_engine.mjs`
- Legs: (a) with `--kata-url http://127.0.0.1:1 --kata-project 12 --kata-json <file>` whose file maps task `1` to uid `U1`, and a fake Kata client injected as `deps.kata`, the fake `tools` dep was called with `task.uid` equal to `U1` and a `board` whose `post` reaches the fake client's `comment` with `(12, 'U1', …)`; with a fake board injected, the recorded `setState` calls for a task that lands are `dispatched` then `adopted`, and for a task the fake judge parks, `dispatched` then `parked`; with no `--kata-url` and no injected board the fixture drive adopts every task and resolves exactly the five keys [M1]; (b) on a drive with one referee finding graded `minor`, one fold the fake kernel leaves incomplete and one worker the fake rejects, the recorded `post` kinds include, for the right tasks, `exam-note` (text equal to the fake exam worker's final text), `landing` (text containing `exit 0`, the claim reading, and the lowest-covered clause's text with its score), `finding:minor`, `conflict`, `worker-error` (text containing the rejection's message) and `park` [M2]; (c) with the fake `factsFor` answering `[exam-note]\nleg (a) measures M1` for task 1 and `''` for task 3, every prompt dispatched for task 1 ends with `\n\nHAND-OFF:\n[exam-note]\nleg (a) measures M1` and no prompt for task 3 contains `HAND-OFF:` [M3]; (d) with the fake exam command exiting 1 on the first measurement and 0 on the second, the dispatch labels for the task contain exactly two implementer dispatches, the second prompt carrying the hand-off, a `redispatch` post, and the `landing` row carries exam exit 0; with it exiting 1 both times there are still exactly two; with coverage `[0.9, 0.3]` and exit 0 there are two; with coverage `[0.9, 0.6]` and exit 0 there is one; with `policy.landing.redispatch.enabled` false in a copied policy file there is one; and `factory/policy.json` parses with `landing.redispatch` deep-equal to the clause's object [M4]; (e) on the fixture plan, whose task 2 waits on task 1 and whose task 3 waits on nothing, with the fake worker for task 3 held pending: task 2's implementer is dispatched after task 1's `landing` row and BEFORE task 3's worker is released; with the fake judge parking task 1, task 2 is never dispatched and a `parked` row for task 2 names task 1 [M5]; (f) with a fake worker that emits, through `onMessage`, an assistant message carrying a `tool_use` `Edit` with `file_path` `a.py`, a `tool_use` `Bash` with `command` equal to the task's test command, and a user message carrying that Bash call's `tool_result` with `is_error` true, `events.jsonl` carries `{kind:'worker:tool', tool:'Edit', target:'a.py'}`, `{kind:'worker:tool', tool:'Bash'}` and `{kind:'worker:test-run', red:true}` for that task and label; a `Bash` result for a command naming neither the test command nor a proof test path adds no `worker:test-run` row [M6].

**Stale-if:**
- path-absent: `factory/engine.mjs`

### Task 8: Across tasks — a worker's note settles an interface for its siblings, and a patch that grew into a sibling's files makes that sibling wait

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/engine.mjs`
- Modify: `factory/judge.mjs`
- Modify: `factory/questions.json`
- Modify: `factory/policy.json`
- Test: `fleet/tests/test_factory_crosstask.mjs`

**Claim:** When a worker says an export is finished, the sibling that builds against it is handed that fact in its own brief; and when a landing's patch reaches into files a sibling not yet started also owns, that sibling waits for it instead of meeting it in a conflict. (derived)
Machine: M1. `factory/questions.json` gains a set `settled` with two questions — `settles_interface` (noul: does the note say an export of this task is finished and safe for a sibling to build against) and `which` (choice over the supplied candidates plus `none`) — and `factory/policy.json` gains `settled.t_settles` `{ "value": 0.8, "n": 0, "window": "none", "basis": "judgment", "experiment": true, "rollback": 1.01 }`; `makeJudge(...)` answers a seventh reader `readSettled({ note, candidates })` that puts that set once and resolves `{ symbol }` when `settles_interface` is at or above the threshold and `which` is a candidate, else `null`. M2. After a task is adopted, the engine takes the task's newest `[note]` fact and the candidates — the names its patch adds as top-level exports (`export function|const|class <name>`, `def <name>`, `class <name>` on added lines) together with its Interfaces `produces` tokens — and, when `readSettled` answers a symbol, writes the task's `interface.settled` metadata `{ symbol, file, task, sha }` through the Kata client and appends `{ kind: 'settled', task, symbol, file }` to `events.jsonl`; with no note or no candidates it asks nothing. M3. Every prompt dispatched for a task carries, directly after its `INTERFACES:` block, one line `SETTLED: <symbol> in <file> (task <id>, <sha>)` for each predecessor in `dag_edges` whose `board.settled` answers one, and no `SETTLED:` line otherwise. M4. When an adopted landing's patch touches a path outside its own task's `files` that is in the `files` of a task neither dispatched nor adopted, that task gains a `files-amendment` edge from the adopted task before readiness is next read, a `{ kind: 'edge', from, to, why: 'files-amendment', path }` row is appended, and `board.post(<waiting task>, 'edge', …)` is called with text naming the adopted task and the path; a task already dispatched gains no edge.

**Authorized-by:** #1130 (Jev as the matcher; its questions and its 0.8 gate); #1129 (the files half: "Files amendments are arithmetic"); #810

**Interfaces:**
- Consumes: `makeBoard({ kata, projectId, tasks, log }) -> { post, factsFor, setState, states, settled }`
- Consumes: `runEngine(args, deps) -> Promise<{ done, adopted, head, wall_ms, cost_usd }>`
- Produces: `readSettled({ note, candidates }) -> Promise<{ symbol } | null>`

**Context:** This task edits the engine the closing-the-loop task leaves: the per-adoption pool, the board, `factsFor`, and the `[note]` facts a worker's `note` tool posts. `factory/judge.mjs` builds every reader the same way: read the set from `factory/questions.json`, put it once through `ask` with a `state`, grade against `factory/policy.json`, and resolve `null` with one `jev:` log line when Jev does not answer or a needed key is missing — `readSettled` follows that shape; a `choice` answer is `{ type: 'choice', choice, confidence, probabilities }` and a `noul` is `{ type: 'noul', noul }`. The `which` question's options are the candidates plus `none`, supplied in the state as `candidates` and in the question's `options`. Questions already in `factory/questions.json` are not reworded; this adds a set. The readiness map (`edgePreds`) is what gains an edge in M4: add the predecessor, and the pool's next readiness read does the rest. `splitDiff(text)` already answers the patch per file; added lines begin `+` and not `+++`. The exam is the same fake-driven rig, with a fake `ask` for the judge leg and a fake board whose `settled` and `factsFor` are configured per task.

**Proof:**
- Test: `fleet/tests/test_factory_crosstask.mjs`
- Legs: (a) `factory/questions.json` parses with `sets.settled.questions` holding keys exactly `settles_interface` and `which`, and `factory/policy.json` with `settled.t_settles` deep-equal to the clause's object; with a fake `ask` answering `settles_interface` 0.9 and `which` choice `catalog`, `readSettled({ note, candidates: ['catalog', 'x'] })` resolves `{ symbol: 'catalog' }`; at 0.7 it resolves `null`; with `which` choice `none` it resolves `null`; with `which` choice `zzz` (not a candidate) `null`; with `ask` resolving `null` it resolves `null` and `log` saw one line beginning `jev:` [M1]; (b) on a drive where task 1's patch adds `export function catalog` to `a.mjs` and its facts carry `[note]\nI exported catalog and it is settled`, with the fake judge answering `{ symbol: 'catalog' }`, the fake judge's `readSettled` was called with `candidates` containing `catalog`, and the fake Kata client saw `patchMetadata` on task 1's uid with `interface.settled` parsing to `symbol` `catalog`, `file` `a.mjs`, `task` `1` and a 40-hex `sha`, and `events.jsonl` carries the `settled` row; with no `[note]` fact the fake judge's `readSettled` was never called [M2]; (c) with `board.settled('1')` answering that object and task 2 waiting on task 1 in `dag_edges`, every prompt for task 2 contains, after its `INTERFACES:` block, the line `SETTLED: catalog in a.mjs (task 1, <sha>)`; prompts for task 3, which waits on nothing, contain no `SETTLED:` [M3]; (d) with task 1's adopted patch touching `shared.md`, which is in task 3's `files` and not task 1's, and task 3 not yet dispatched (held back by the exam's fake readiness), `events.jsonl` carries `{kind:'edge', from:'1', to:'3', why:'files-amendment', path:'shared.md'}` the fake board recorded `post('3', 'edge', <text containing `1` and `shared.md`>)`, and task 3 is dispatched only after task 1's adoption; with task 3 already dispatched when task 1 lands, no `edge` row is appended [M4].

**Stale-if:**
- path-absent: `factory/judge.mjs`

### Task 9: The hub is rebuilt on 0.18 with its federation path

**Type:** manual

**Files:**
- Verify: `(none)`

**Claim:** The operator's laptop runs the hub build once after this plan merges, so the hub runs Kata 0.18 and the `kata-sync` path exists before the first run that carries a spoke. (derived)
Machine: M1. After `node fleet/kata-hub.mjs` is run from the merged checkout, the lobby's integrations listing names `kata-sync` and the hub answers `kata version` with `0.18.0`.

**Authorized-by:** #983; `fleet/RUNBOOK.md` §The hub

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** A run cannot rebuild the hub: it is a persistent VM the laptop owns. Until this step is done a factory run's spoke finds no `kata-sync` host, its wait expires, the boot logs `board:` and the run proceeds without a board — the rollback path, by design.

**Proof:**
- Run: ssh exe.dev integrations list | grep -q kata-sync
- Run: ssh kata-hub.exe.xyz kata version | grep -q 0.18.0
- Legs: (a) the first `Run:` establishes the `kata-sync` integration exists and the second that the hub's binary is 0.18.0, neither of which is true before the build [M1].

**Stale-if:**
- path-absent: `fleet/kata-hub.mjs`
