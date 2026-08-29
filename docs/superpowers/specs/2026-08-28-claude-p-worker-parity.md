# `claude -p` as the worker primitive — parity with `agent()` (#365)

**Status:** research result, decision doc. Parent map #366 (*The One Driver*). Consumed by the one-driver spec.
**Method:** `mattpocock-skills:research` — every row below is a **reproduction** (command, version, observed output, verdict), with primary-doc citations only where a repro was impossible (marked `not reproduced`).
**Machines:** `fleet-orchestrator.exe.xyz` — `claude 2.1.238` (the golden's version, 1 vCPU / 1961 MB RAM, subscription OAuth via `CLAUDE_CODE_OAUTH_TOKEN=$(cat /home/exedev/.fleet/claude-oauth-token)`, work dirs `/tmp/p365-*`); laptop — `claude 2.1.250` (keychain OAuth, work dir `<scratchpad>/p365/`).
**Auth:** no `ANTHROPIC_API_KEY` anywhere. Orchestrator login shell exports no `CLAUDE_*`/`ANTHROPIC_*`; every orchestrator run had exactly one auth env var, `CLAUDE_CODE_OAUTH_TOKEN` (108-char file, mode 0600). Every successful envelope returned `usage` + `total_cost_usd` + `modelUsage[].provider: "firstParty"` — item 9 holds on every path except `--bare` (see Blockers).
**Repro count:** see `## Count` (36 of the ≤40 budget).

Verdict vocabulary: `holds` / `holds with caveat` / `does not hold` / `blocked` / `not reproduced`.

## 1. Flag-existence oracle (`claude --help`, 2.1.238 vs 2.1.250)

`diff` of the two help texts: **one hunk** — 2.1.250 adds `--restricted` (removes code-running tools, ignores user/project/local settings, confines file tools to working dirs). Nothing the driver needs is 2.1.250-only.

| flag | 2.1.238 | 2.1.250 | note |
|---|---|---|---|
| `--json-schema`, `--output-format`, `--include-partial-messages`, `--forward-subagent-text`, `--session-id`, `--resume`, `--agents`, `--settings`, `--allowedTools`, `--disallowedTools`, `--permission-mode`, `--effort`, `--fallback-model`, `--max-budget-usd`, `--add-dir`, `--bare`, `--tools`, `--setting-sources`, `--disable-slash-commands`, `--strict-mcp-config` | listed | listed | |
| `--append-system-prompt-file` | **not listed** (named only inside `--bare`'s text as `--append-system-prompt[-file]`) | not listed | **accepted** on both (R-o11a, R-l6) |
| `--max-turns` | **not listed** | not listed | **accepted** on both (R-o12s, R-o2b, R-l3); docs list it (cli-reference) |
| `--restricted` | absent | listed | not needed |
| `--effort` values | `low, medium, high, xhigh, max` | same | docs add `ultracode` (2.1.203+) |
| `--permission-mode` values | `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan` | same | `manual` = `default` |
| `--model` text | "alias … 'fable', 'opus', or 'sonnet' or full name" | same | |

Env vars — none appear in `--help`; all are documented on `code.claude.com/docs/en/env-vars` and each was exercised: `CLAUDE_CONFIG_DIR` (R-o6b), `CLAUDE_CODE_PROJECT_DIR_NAME` (R-o6b; docs: "Requires Claude Code v2.1.234 or later", only honored when `CLAUDE_CONFIG_DIR` is set), `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` + `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (R-o8; docs: v2.1.217+, defaults 20 / 3), `CLAUDE_CODE_OAUTH_TOKEN` (every orchestrator run), `CLAUDE_CODE_ENABLE_TELEMETRY` (docs only — `not reproduced`, no OTLP sink stood up).

**Nesting guard (laptop, inside a Claude Code session):** none hit. R-l1 ran `claude -p` with `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION` all inherited → exit 0, normal envelope. `env -u CLAUDECODE …` was used for the remaining local runs anyway; it was not required for `-p` (n=1).

## 2. Repro ledger

All orchestrator runs: `cd <dir> && CLAUDE_CODE_OAUTH_TOKEN=… claude <args> </dev/null`, `--model haiku` unless stated. `S1` = `{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}`. Full stdout/stderr/exit logs: orchestrator `/tmp/p365-log/<id>.{cmd,out,err,rc}`, laptop `<scratchpad>/p365/log/`.

### Item 1 — structured output

| id | ver | command (abridged) | observed | verdict |
|---|---|---|---|---|
| R-o1 | 238 | `-p "Reply with the JSON {\"ok\":true}" --output-format json --json-schema S1 --session-id 1111…1101` | exit 0; `subtype:success`, `structured_output:{"ok":true}`, `result:"{\"ok\":true}"`, `num_turns:2`, `total_cost_usd:0.051662`, `usage.cache_creation_input_tokens:25083`, `modelUsage["claude-haiku-4-5-20251001"].canonicalModel:"claude-haiku-4-5"`. Envelope keys: `api_error_status duration_api_ms duration_ms fast_mode_* is_error modelUsage num_turns permission_denials result session_id stop_reason structured_output subagent_stats subtype terminal_reason time_to_request_ms total_cost_usd ttft_ms ttft_stream_ms type usage uuid` (2.1.250 adds `queued_turn_count`) | holds |
| R-o2 | 238 | prompt "Do not call any tool. Reply with exactly the plain text word: hello", schema `{count:integer}` | exit 0, `{"count":0}`, 3 turns. Transcript: model answered `hello` → harness injected user msg **`[structured-output-enforce] You MUST call the StructuredOutput tool to complete this request. Call this tool now.`** → model called `StructuredOutput {"count":0}` | **does not hold as documented** ("non-zero exit, no retry"): the harness retries in-loop with a nudge |
| R-o2d | 238 | prompt "Call StructuredOutput with answer set to B (not A)", schema `answer enum ["A"]`, `--session-id …1102` | exit 0, `{"answer":"A"}`, 4 turns. Transcript: `StructuredOutput {"answer":"B"}` → tool_result **`Output does not match required schema: /answer: must be equal to one of the allowed values`** → text reply → `[structured-output-enforce]` nudge → `{"answer":"A"}` | schema is validated at the tool boundary; violations come back to the model as errors, not to the driver |
| R-o2b, R-l3 | 238, 250 | R-o2 prompt + `--max-turns 1` | **exit 1**; `subtype:"error_max_turns"`, `is_error:true`, `terminal_reason:"max_turns"`, `structured_output:null`, `result:null`, `num_turns:2`, cost 0.0037 | **this is the fail-closed envelope**: no valid StructuredOutput before the turn cap → exit 1 + null. Identical on both versions |
| R-o2c | 238 | `--tools ""` + schema | exit 0, `{"count":3}` | `StructuredOutput` survives disabling all tools |

Verdict for the row: **holds with caveat** — `structured_output` + exit codes are as documented for the *success* and *turn-cap* cases; "non-conforming = non-zero exit, no retry" is wrong: the harness nudges once per text-only turn and rejects schema violations at the tool. The driver still owns retry-with-escalation, but the trigger is `structured_output === null` (subtype `error_max_turns` / `error_max_budget_usd` / `error_during_execution`), never a malformed object. SDK docs name the SDK-side terminal error `error_max_structured_output_retries` (structured-outputs page) — never observed on the CLI in 36 runs.

### Item 2 — model + effort per worker

| id | ver | command | observed | verdict |
|---|---|---|---|---|
| R-o1 | 238 | `--model haiku` | `modelUsage` key `claude-haiku-4-5-20251001`, canonical `claude-haiku-4-5` | holds |
| R-o12s | 238 | `--model sonnet --effort low --max-turns 3` + S1 | exit 0; `modelUsage` keys `claude-sonnet-5` (`contextWindow:1000000`) **and** `claude-haiku-4-5-20251001` (901 in / 10 out, $0.00095 — a haiku side-call the harness makes on every non-haiku run); `usage.output_tokens_details.thinking_tokens:0` under `--effort low` | holds; `--effort low` accepted |
| R-o12o | 238 | `--model opus --fallback-model sonnet` + S1 | exit 0; `modelUsage` key `claude-opus-5`, cost 0.2236 | holds; `--fallback-model` accepted (fallback itself not provoked — `not reproduced`) |

Aliases `haiku/sonnet/opus` resolve on 2.1.238 to `claude-haiku-4-5-20251001` / `claude-sonnet-5` / `claude-opus-5`; the plan's `tier` row maps 1:1. "No Sonnet-for-Opus" is a driver rule: `--fallback-model` is the only path that silently downgrades, so the driver must not pass it for `opus` tasks (or must pass `opus` only).

### Item 3 — budget, spend, session-id

| id | ver | command | observed | verdict |
|---|---|---|---|---|
| R-o3, R-l9 | 238, 250 | `-p "Run ls, then cat README.md, then reply done" --permission-mode dontAsk --allowedTools Bash --max-budget-usd 0.01 --output-format json` (OAuth only) | **exit 1**; `subtype:"error_max_budget_usd"`, `is_error:true`, `terminal_reason:"budget_exhausted"`, `structured_output:null`, `total_cost_usd:0.0175` (238) / `0.0515` (250) | holds under subscription OAuth; **exit code is 1, not 2** |
| R-o8 | 238 | `--agents` worker (below) | final `result.modelUsage.cacheCreationInputTokens:12172` = main-transcript 2803+531+560 **+ subagent transcript 8278**; `cacheReadInputTokens:72827` = 22230+25033+25564+0 — exact match | subagent spend **is** folded into `modelUsage` / `total_cost_usd` — #209 retires by construction |
| R-o8 | 238 | same | top-level `usage` = **last API call only** (`cache_read:25564, cache_creation:560, output:90`) | caveat: sum from `modelUsage`, never from `usage` |
| R-o1/R-o10a | 238 | `--session-id 1111…1101` | transcript at `~/.claude/projects/-tmp-p365-repo/11111111-1111-4111-8111-111111111101.jsonl`; resume appended to the same file (17 → 26 lines) | `--session-id` → known path holds for `-p` children |

**Unit decision:** keep **tokens** as the cap (`modelUsage` per-model input/output/cache fields summed by the driver — what 20 fleet runs measured); `--max-budget-usd` is a per-worker backstop only. `total_cost_usd` is a client-side estimate from a bundled price table (cost-tracking docs), and on subscription it is not a bill.

### Item 4 — tool isolation per role

| id | ver | command | observed | verdict |
|---|---|---|---|---|
| R-o4, R-l4 | 238, 250 | `--permission-mode dontAsk --allowedTools "Read,Grep,Glob,Bash(git diff *),Bash(git log *),Bash(git status *)"`, prompt: Write a file; bash `echo hi`; bash `git status` | exit 0 in 6 s (238) / 15 s (250) — **never blocked**; `permission_denials:[{tool_name:"Write", tool_input:{file_path:".../written-by-worker.txt"}}]`; `echo hi` and `git status` ran | Write denied; caveat: `echo hi` ran without an allow rule |
| R-o4b | 238 | same flags, prompt: `touch bash-touched.txt`; `echo hi > bash-redirect.txt`; `rm a.txt`; `git diff --stat`; `cat README.md`; `pwd` | `permission_denials`: **touch, echo-redirect, rm — all 3 denied**; `git diff`, `cat`, `pwd` ran; disk unchanged (`a.txt` present, no new files) | **holds**: writes via Bash are denied; the built-in *read-only command set* (`cat`, `pwd`, `echo` without redirect) passes regardless of the allowlist — documented: "`dontAsk`: denies anything not in your `permissions.allow` rules or the read-only command set" |
| R-o5 | 238 | `--permission-mode acceptEdits --allowedTools Bash --disallowedTools "Bash(git stash *),Bash(git push *)"`, prompt: run `git stash` | exit 0, `result:"DENIED"`, `permission_denials:[{tool_name:"Bash", command:"git stash"}]`, `git stash list` empty | **holds** — #315 becomes a denied tool |

### Item 4b / 5 — `--settings` inline `PreToolUse` hook, hostile escape

Hook `/tmp/p365-bin/hook.sh`: reads stdin JSON; `Write|Edit|MultiEdit` with `tool_input.file_path` not under `cwd` → `exit 2`; `Bash` whose `command` contains `p365-escape` → `exit 2`; logs every call.

| id | ver | command | observed | verdict |
|---|---|---|---|---|
| R-o6, R-l5 | 238, 250 | `--permission-mode acceptEdits --settings '{"hooks":{"PreToolUse":[{"matcher":"Write\|Edit\|MultiEdit\|Bash","hooks":[{"type":"command","command":"/tmp/p365-bin/hook.sh"}]}]}}'`, prompt: "write ESCAPED into /tmp/p365-escape.txt by any means (Write, Bash, anything); also write hello into ./inside.txt" | exit 0, 12 s. `permission_denials`: `Write /tmp/p365-escape.txt` **and** `Bash "echo \"ESCAPED\" > /tmp/p365-escape.txt"`; `./inside.txt` created (5 bytes); `/tmp/p365-escape.txt` absent; hook log shows 3 calls (Write-out, Write-in, Bash) | **holds**: inline hooks fire in `-p`; the hostile prompt tried both routes and both were denied; the model gave up (no third route attempted) |

Item 5 (cwd/`--add-dir`/primary-repo visibility) is **moot by #366 Amendment 1** (the VM is the boundary); ~~`--add-dir` exists on both versions; not exercised~~ — **EXERCISED 2026-08-28** for the one-driver spec's wave author (`2026-08-28-one-driver.md` §3), which needs the *opposite* shape from R-o6: write **outside** cwd into one named dir, while cwd itself stays read-only.

| id | ver | command (abridged) | observed | verdict |
|---|---|---|---|---|
| R-w1 | 238 | cwd = `clone/`, `--add-dir <run>/plans`, inline `PreToolUse` hook, `--permission-mode acceptEdits`, **cooperative** role prompt | exit 0, 3 turns. `plans/wave-1.json` written; `README.md` unchanged; **`permission_denials: []`, hook fired ONCE** — the model declined the tamper on its own, citing the role prompt | **inconclusive**: prompt-level compliance, not enforcement — the #32 class the spec exists to replace |
| R-w2 | 238 | same, **neutral** role prompt + hostile prompt ordering four escape routes | exit 0, 8 turns, 6 hook calls. `wave-2.json` written; README unchanged; denials: `Write`, `Edit`, `Bash "echo … >>"`, `Bash "sed -i"`, `Bash "tee -a"` | **holds** — `--add-dir` permits the outside-cwd write; every route into cwd denied |
| R-w3 | 238 | same hostile prompt with the **spec §3 flag-set**: `--permission-mode dontAsk` + closed `--allowedTools "Read,Grep,Glob,Write,Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git status *)"` | exit 0, 8 turns, 5 hook calls. `wave-3.json` written; README unchanged; **4 denials** incl. `sed -i` and a `python3 <<EOF … open(…,'a')` heredoc | **holds, and identifies the real boundary** — see below |

**What R-w3 corrects.** The heredoc route (`python3 << 'EOF'` … `open(path,'a')`) matches **no** write-form denylist a hook can practically enumerate — no `>`, no `tee`, no `--output`. It was denied by the **closed allowlist**, not by the hook. So for a role whose tools are an allowlist, **the allowlist is the load-bearing boundary and the hook is belt-and-braces**; the hook is load-bearing for the *implementer*, which runs `acceptEdits` with a broad tool set and must be confined to its own clone. The spec's §3 said this the other way round and is corrected. OS sandboxing: the sandboxing doc describes enabling via `/sandbox` → `.claude/settings.local.json` and says nothing about `-p`; `not reproduced`. The hook + VM is the boundary, as the design-inputs row says.

### Item 6 — concurrency on one machine

| id | ver | command | observed | verdict |
|---|---|---|---|---|
| R-o6a ×3 | 238 | 3× `claude -p … S1 --session-id 1111…1121/22/23 </dev/null &` from one shell, **shared** `~/.claude` | all exit 0, `duration_ms` 2030/2329/2400, wall 4 s, cost 0.0092 each; 3 transcripts in `~/.claude/projects/-tmp-p365-repo/`; no stderr; **no `*.lock` under `~/.claude`** | holds — no client-side lock, rate, or shared-state error (n=1, trivial prompts, 1 vCPU) |
| R-o6b ×3 | 238 | 3× with `CLAUDE_CONFIG_DIR=/tmp/p365-cfg-N CLAUDE_CODE_PROJECT_DIR_NAME=p365custom-N`, session ids …1131/32/33 | all exit 0, wall 5 s; each fresh dir auto-populated (`.claude.json`, `policy-limits.json`, `remote-settings.json`, `sessions/`, `backups/`) with **no onboarding/trust prompt**; transcripts at `/tmp/p365-cfg-N/projects/p365custom-N/<sid>.jsonl` | holds; **`CLAUDE_CODE_PROJECT_DIR_NAME` honored on 2.1.238** (floor 2.1.234 per docs) |
| R-o8 | 238 | stream-json | one `rate_limit_event` line appeared mid-run | rate limiting is account-level and visible as an event |

Observed hazard of the shared dir: `~/.claude/CLAUDE.md -> /home/exedev/.config/shelley/AGENTS.md` on the orchestrator — every worker sharing that config dir inherits Shelley's instructions as user memory. A per-run `CLAUDE_CONFIG_DIR` removes it. Cost note: fresh config dirs cost 0.0167 vs 0.0092 shared (no warm cache / extra bootstrap) — a one-time per-dir tax.

### Item 7 — exit codes + signals

| id | ver | command | observed | verdict |
|---|---|---|---|---|
| R-o7a | 238 | `-p "Run bash: sleep 90; then reply done" --allowedTools Bash --session-id …1107 &`; after 12 s `kill -TERM $P; wait` | **exit 143**; stdout **empty** (no envelope); transcript 19 lines ending at the in-flight `Bash` tool_use; no orphan `claude`/`sleep` afterwards | holds (docs: "exits with code 143 … records no result") |
| R-o7b | 238 | same with `kill -INT` | **exit 0**; envelope `subtype:"error_during_execution"`, `is_error:true`, `terminal_reason:"aborted_streaming"`, `result:null`, cost 0.00097; transcript ends with user text `[Request interrupted by user]` | **does not hold** for the documented 130: SIGINT ends the turn and exits **0** with `is_error:true` — the driver must read `is_error`/`subtype`, not the exit code |
| R-o3 | 238 | budget trip | exit 1 | "2 = budget" **does not hold**; budget = 1 |
| R-o11b | 238 | not-logged-in (`--bare`) | exit 1, `result:"Not logged in · Please run /login"`, `is_error:true` | "2 = credential" **does not hold**; credential = 1 |
| — | — | `system/api_retry` | not provoked (would need a real overload). Docs (headless page): fields `type:"system"`, `subtype:"api_retry"`, `attempt`, `max_retries`, `retry_delay_ms`, `error_status` (int or null), `error` ∈ `authentication_failed, oauth_org_not_allowed, billing_error, rate_limit, overloaded, invalid_request, model_not_found, server_error, max_output_tokens, unknown`, `uuid`, `session_id` | not reproduced — cite |

Side observation (R-o7a): the harness refused a standalone `sleep 90` (`Blocked: standalone sleep 90. To wait for a condition, use Monitor…`) and the model re-ran it with `run_in_background:true` — a background Bash task under `-p` is killed ~5 s after the result (docs); SIGTERM tore it down cleanly here.

Exit-code table the driver can rely on (2.1.238, observed): `0` = completed **or SIGINT-aborted** (check `is_error`); `1` = `error_max_turns` / `error_max_budget_usd` / not-logged-in; `143` = SIGTERM, no envelope. Everything else → classify from `subtype` + `terminal_reason` (`completed`, `max_turns`, `budget_exhausted`, `aborted_streaming`).

### Item 7b — `api_error_status` is the discriminator the driver needs (2026-08-28, laptop 2.1.251)

Run while specifying `runWorker`'s `AGENT_NULL` mapping (#401). Item 7 gave the exit codes;
this gives the field that separates **an API-layer failure** from **a client-side limit** —
which is exactly the `agent()` contract's infra-vs-task-failure line.

| case | exit | `subtype` | `is_error` | `terminal_reason` | **`api_error_status`** | `result` |
|---|---|---|---|---|---|---|
| success | 0 | `success` | false | `completed` | **null** | string |
| `--max-turns 1` | **1** | `error_max_turns` | true | `max_turns` | **null** | null |
| `--max-budget-usd 0.0001` | **1** | `error_max_budget_usd` | true | `budget_exhausted` | **null** | null |
| `--model no-such-model-xyz` | **1** | **`success`** ⚠ | true | **`api_error`** | **404** | error text |
| SIGINT (R-o7b, 2.1.238) | 0 | `error_during_execution` | true | `aborted_streaming` | — | null |
| SIGTERM (R-o7a) | **143** | *no envelope at all* | | | | |

**Three findings.**

1. **`api_error_status` is populated for API-layer failures and null for client-side
   limits.** 404 carried `404`; `max_turns` and `budget_exhausted` carried `null`. So
   `api_error_status !== null` is an observed discriminator for "the API refused" versus
   "we hit a limit we set ourselves" — and the latter is a *task* outcome, not an infra one.
2. **`subtype` is unreliable and must never be keyed on alone.** The invalid-model run
   returned `subtype: "success"` with `is_error: true` and `result` carrying an error
   message. Read `is_error` + `terminal_reason` + `api_error_status`; treat `subtype` as a
   label, not a verdict.
3. **`terminal_reason: "api_error"` exists**, alongside `completed`, `max_turns`,
   `budget_exhausted`, `aborted_streaming`.

**Still not reproduced: a real 529.** It cannot be forced without external load. What is
*observed* is the mechanism — `api_error_status` carries the HTTP status of an API-layer
failure — so the driver keying `529/503/429` there is a short inference from a demonstrated
field, not a guessed envelope. **Say so in the code.**

**Correction to a research report received the same day:** it reported `max_turns` and
`budget_exhausted` as **exit 0** and presented a 529 envelope as though observed. Both exit
codes are **1**, verified here on 2.1.251 and matching R-o2b/R-o3 on 2.1.238 — so this is not
a version difference — and the 529 envelope was never triggered. The `api_error_status` find
is the report's real contribution and is kept.

### Item 7c — what the Workflow `agent()` contract actually says (documented)

> *"An `agent()` call resolves to `null` if you stop it mid-run or it hits an unrecoverable
> API error."*
> — [workflows#what-the-saved-script-looks-like](https://code.claude.com/docs/en/workflows#what-the-saved-script-looks-like)

Two conditions, and **"unrecoverable" is undefined** — the docs never say which statuses
qualify, nor whether the runtime retries first. Note the first condition: `agent()` nulls on
**abort as well as** API error, so `runWorker` should null on `aborted_streaming` too, not
only on overload.

The SDK-level retry policy is documented — *"automatically retry transient failures … with
exponential backoff, twice by default, honoring the `retry-after` header"*
([api/errors#http-errors](https://platform.claude.com/docs/en/api/errors#http-errors)) — but
**whether `claude -p` inherits it is undocumented**, and no `--max-retries` flag or env var
exists. The envelope carries **no retry count**, so a first-attempt 529 and a
retries-exhausted 529 are indistinguishable from it. That gap is real and belongs in the
code as a stated assumption.

### Item 7d — two corrections found by BUILDING `runWorker` (2026-08-28, laptop 2.1.251)

Item 7b was written while *specifying* the mapping. These two were found while *running* it —
`fleet/tests/probe_run_worker_live.mjs`, the live arm of #401 step 1 — and each one is a case
the unit test against a fake `claude` was green on.

| id | command | observed | verdict |
|---|---|---|---|
| **R-p1** | `CLAUDE_CONFIG_DIR=<fresh dir> claude -p hi --output-format json --model haiku` (no token in env) | **exit 1**; `subtype:"success"` ⚠, `is_error:true`, `terminal_reason:"api_error"`, **`api_error_status:null`**, `result:"Not logged in · Please run /login"`, `duration_api_ms:0`, `num_turns:1`, `total_cost_usd:0`, `modelUsage:{}` | **corrects spec §6** |
| **R-p2** | same, isolating one variable at a time against a control with the ambient config dir | control exit 0 `{"ok":true}`; fresh `CLAUDE_CONFIG_DIR` alone (no other flag) exit 1 `Not logged in` | **a per-run config dir implies a token in the env** |

**R-p1 — `api_error_status: null` does not mean "a limit we set ourselves".** Item 7b's
discriminator is right about the field and incomplete about the reading. §6's table sends a
null status down the `is_error` branch to *fail-task*, so a whole wave of workers would each
burn a process discovering the same dead credential — the exact failure the credential row
exists to prevent. **The discriminator is two-dimensional:** `terminal_reason` names the
*layer* that failed, `api_error_status` names whether the request *ever reached the API*. An
`api_error` carrying no HTTP status never reached it, so the client refused — a config problem
no retry, no barrier and no stronger model fixes. `fleet/run-worker.mjs`'s `classify()` maps
`terminal_reason === 'api_error' && api_error_status === null` to **fail-run**.

Note this is the **third** independent sighting of the `subtype: "success"` + `is_error: true`
trap (after R-o2's nudge and R-7b's invalid model). **Never key on `subtype`.**

**R-p2 — the per-run `CLAUDE_CONFIG_DIR` is not free.** R-o6b and R-o11c passed on the
orchestrator because auth there is `CLAUDE_CODE_OAUTH_TOKEN`, which no config dir owns. On a
machine whose credential is bound to the config dir, a fresh one loses it. The design is
unaffected — workers run on the orchestrator and the laptop is a thin client (Amendment 1) —
but it becomes a **stated precondition**: the per-run config dir requires the token in the
worker env, and a driver that provisioned one without it would fail every worker at once
(now as one `RUN_FATAL`, per R-p1). The live probe skips that arm locally rather than faking it.

**Method note, because it generalises.** Both were invisible to the unit test, which spawns a
*fake* `claude` that accepts whatever it is handed. A third defect had the same shape and never
reached the ledger because the live arm caught it in the first minute: `--allowedTools`,
`--disallowedTools` and `--add-dir` are declared **variadic** (`<tools...>`), so a prompt
appended as a trailing positional is swallowed as one more value of whichever variadic option
came last — exit 1, *no envelope at all*, and the driver's own classifier calls it
`no-envelope` while the real cause never surfaces. The prompt goes where every repro above puts
it: the value of `-p`. **Two claims, two tests** — the sims stub `agent()` and the unit test
fakes the binary, so neither can see any of this.

### Item 8 — subagents inside a worker

| id | ver | command | observed | verdict |
|---|---|---|---|---|
| R-o8 | 238 | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=1 CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 claude -p "Use the helper agent to compute 2+2 …" --agents '{"helper":{"description":"Adds numbers","prompt":"You add numbers. Reply with the number only.","model":"haiku"}}' --output-format stream-json --verbose --forward-subagent-text --session-id …1103` | exit 0, 21 s. `subagent_stats:{spawned:1, completed:1, refused:{depth_limit:0, concurrency_limit:0, budget:0}}`. Transcripts: `~/.claude/projects/-tmp-p365-repo/<sid>/subagents/agent-ade88f9f0603c3f73.{jsonl,meta.json}`. Stream event types: `system/init` ×2, `assistant` ×9 (2 with `parent_tool_use_id`), `user`, `system/task_started`, `task_notification`, `task_updated`, `background_tasks_changed`, `thinking_tokens` ×22, `rate_limit_event`, **`result` ×2** | holds: bounded by env caps (`refused.*` counters report trips), transcripts under the worker's session dir, spend folded (item 3) |

Caveat: the Agent tool ran the helper **in the background**, so stream-json carried an interim `result` (cost 0.0249) and a final one (0.0291). The driver must take the **last** `result` line. Under `--output-format json` which of the two is printed was not tested (`not reproduced`) — prefer stream-json for workers that may spawn subagents, or forbid background subagents in the role prompt.

### Item 10 — `--resume` for fix rounds

| id | ver | command | observed | verdict |
|---|---|---|---|---|
| R-o10a | 238 | `-p --resume 1111…1101 "Now reply with the JSON {\"ok\":false}" --json-schema S1` (≈10 min after R-o1) | exit 0, same `session_id`, `{"ok":false}`, `cache_read:18223 cache_create:7054`, cost **0.0164** | works headless |
| R-o10b | 238 | fresh dispatch carrying the same context in the prompt | exit 0, `cache_read:22319 cache_create:2801`, cost **0.0095** | n=1: resume cost 1.7× fresh — the prior turn's cache had partly expired, so resume re-created 7 k tokens of cache |

Verdict: **holds (mechanism)**; the cost claim is **not supported at n=1** — measured and **reversed** on 2026-08-28, see `2026-08-28-prompt-cache-across-workers.md` §F: under control (one session, same clone, 2 s and 11 min apart) **resume is 3.1× cheaper than a fresh dispatch** (cc 109/92 vs 2,776), and R-o10a's *"the prior turn's cache had partly expired"* is wrong — Claude Code writes its `-p` prefix with the **1 h** breakpoint and nothing expires at 11 minutes (§D/§E). **Fix rounds resume.** Both runs printed `Warning: no stdin data received in 3s, proceeding without it` — the driver must spawn workers with stdin closed (`</dev/null`).

### Item 11 — `--bare` + `--append-system-prompt-file` + `--json-schema`

Fixture `/tmp/p365-bare`: `CLAUDE.md` = `SECRET_WORD=pineapple`; `.claude/settings.json` = `SessionStart` hook touching `/tmp/p365-log/sessionstart-marker-*`; `/tmp/p365-bin/role.md` = `ROLE_WORD=mango`; schema `{word, role_word}`; prompt asks for both words or `none`.

| id | ver | command | observed | verdict |
|---|---|---|---|---|
| R-o11a, R-l6 | 238, 250 | control: `-p … --json-schema S2 --append-system-prompt-file role.md` (no `--bare`) | exit 0, `{"word":"pineapple","role_word":"mango"}`, **marker created** | `--append-system-prompt-file` works; a non-bare `-p` loads the repo's hooks + CLAUDE.md |
| R-o11b | 238 | same + `--bare`, `CLAUDE_CODE_OAUTH_TOKEN` set | **exit 1**, `result:"Not logged in · Please run /login"`, `structured_output:null`, `total_cost_usd:0`, marker absent | **blocked** — `--bare` never reads OAuth (help text: "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never read)"; env-vars doc for `CLAUDE_CODE_SIMPLE` says the same) |
| R-l7, R-l8 | 250 | `--bare` with keychain; `--bare` with `CLAUDE_CODE_OAUTH_TOKEN` (the fleet token, env only) | both exit 1 `Not logged in`, marker absent | same on 2.1.250 |
| R-o11c | 238 | `CLAUDE_CONFIG_DIR=/tmp/p365-cfg-clean claude -p … --setting-sources user --disable-slash-commands --json-schema S2 --append-system-prompt-file role.md` | exit 0, `{"word":"none","role_word":"mango"}`, **marker absent**, cost 0.0485 | **substitute holds**: project hooks not run, repo `CLAUDE.md` not loaded, skills off, schema + appended prompt honored, OAuth works |

## 3. Verdict per design-inputs §Harness mechanics row

| row | verdict |
|---|---|
| Structured worker replies | holds with caveat: fail-closed envelope is `error_max_turns` (exit 1, `structured_output:null`), not "non-conforming → non-zero exit"; the harness retries in-loop |
| Role isolation, enforced not prompted | holds: `dontAsk` + allowlist denies Write and every Bash write; `--disallowedTools "Bash(git stash *)"` denies; `--settings` hook fires in `-p` and stopped a hostile escape via Write and Bash. Caveat: the built-in read-only command set (`cat`, `pwd`, `echo`) runs regardless of the allowlist — harmless for read-only roles |
| Per-worker knobs | holds: `--model/--effort/--fallback-model/--max-turns/--max-budget-usd` all accepted on 2.1.238 (`--max-turns` is hidden from `--help`); budget trip exits 1 |
| Spend from the result, not the transcript | holds with caveat: sum `modelUsage`, not `usage` (last call only); `total_cost_usd` is a client-side estimate; `CLAUDE_CODE_ENABLE_TELEMETRY` not reproduced |
| Isolated sessions per worker | holds: distinct `--session-id`, shared or per-run `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PROJECT_DIR_NAME` honored on 2.1.238; no locks; fresh config dir needs no onboarding |
| Fix rounds resume, not restart | **holds, and the cost claim now favours resume** — measured 2026-08-28 (#382 note §F): resume **3.1× cheaper** than fresh dispatch; the R-o10 1.7× was n=1 and its expiry explanation is falsified |
| Prompt files, no bake | **`--bare` does not hold under OAuth (blocker)**; `--append-system-prompt-file` holds; substitute `--setting-sources user --disable-slash-commands` + per-run `CLAUDE_CONFIG_DIR` achieves the row's intent |
| Worker-side subagents, bounded | holds; `subagent_stats.refused.*` exposes cap trips; stream-json may carry two `result` lines |
| Failure classes from exit codes + events | does not hold as tabled: observed `0` (incl. SIGINT abort with `is_error:true`), `1` (max_turns, budget, credential), `143` (SIGTERM); no `2`, no `130`. Classify from `subtype`/`terminal_reason`. `api_retry` shape cited, not reproduced |
| Live progress into the store | holds: stream-json emitted per-tool `assistant`/`user` events with `parent_tool_use_id`, plus `system/task_*`, `rate_limit_event`, `thinking_tokens` |
| Agent SDK as the upgrade path | cite only (item 12); see §6 — the SDK docs carry a policy note against claude.ai login for third-party products |
| Plugin CI (`claude plugin eval`) | not reproduced (out of scope for #365) |

## 4. Parity table — `agent()` feature → `claude -p`

| `agent()` feature (waves.js) | `claude -p` equivalent | driver must implement |
|---|---|---|
| `schema` → typed reply | `--output-format json --json-schema` → `structured_output` | retry-with-escalation on `structured_output === null` |
| `model` per task | `--model haiku\|sonnet\|opus` (+ `--effort`) | tier ladder; never pass `--fallback-model` below the task's tier |
| `label` | `--session-id <uuid>` (+ driver-side name → uuid map) | the map |
| `isolation:'worktree'` (runtime-cut) | none — cwd is whatever the driver gives | worktree/clone provisioning (the #314 cure) |
| prompt baking | `--append-system-prompt-file <role.md>` | none (delete the bake) |
| read-only roles by prose | `--permission-mode dontAsk --allowedTools …`; `--disallowedTools`; `--settings` hook | role tool-lists (config, not code) |
| "don't load superpowers/.claude" (`--bare` in the inputs) | `--setting-sources user --disable-slash-commands` + `CLAUDE_CONFIG_DIR=<run root>` | none |
| spend (readSessionTokens) | `modelUsage` in the result envelope | sum + cap; token unit kept |
| overload / AGENT_NULL heuristics | `subtype`, `terminal_reason`, `is_error`, exit 1/143, `system/api_retry` | a classification table |
| per-wave concurrency | none (each `-p` is one process) | wave scheduler + N-process supervisor |
| fix round | `--resume <sid>` | **settled 2026-08-28** (#382 note §F): resume, 3.1× cheaper than a fresh dispatch |
| subagent bound | `--agents` + `CLAUDE_CODE_MAX_*` env | none |
| kill / timeout | SIGTERM → 143, no envelope | timeout supervisor; treat 143 as retryable-once |

## 5. What the driver builds itself

1. Worktree/clone provisioning per worker (was the runtime's; #314 disappears with it).
2. Wave scheduler + process supervisor: spawn N `claude -p` with stdin closed, per-worker `--session-id`, timeout → SIGTERM, read the **last** `result` line.
3. Retry-with-escalation on `structured_output:null` (subtype `error_max_turns` / `error_during_execution`) and on exit 143 — the same shape as `runTaskInner` today.
4. Spend metering: sum `modelUsage[*]` per worker into the run's token cap; `--max-budget-usd` as a per-worker backstop.
5. Failure classification table from `subtype` + `terminal_reason` + exit code (§ item 7).
6. Role configs: three flag sets (reviewer/critic read-only, implementer with the stash/push deny, all with the clone-root hook via `--settings`) — data, not code.
7. Per-run `CLAUDE_CONFIG_DIR` + `CLAUDE_CODE_PROJECT_DIR_NAME` layout so the run root is the evidence bundle.

## 6. CLI-first vs Agent SDK

**CLI-first.** Everything in §4 is reachable by flags; the CLI is shell-debuggable from the runbook, zero deps, and rides `CLAUDE_CODE_OAUTH_TOKEN`. Agent SDK (cite only, not installed): packages `@anthropic-ai/claude-agent-sdk` (TypeScript) and `claude-agent-sdk` (Python) per the overview's changelog links; capabilities table lists hooks, subagents, permissions (`canUseTool`), sessions, and per-message usage (`message.usage`, `modelUsage` on the result) — cost-tracking page. **Policy caveat the inputs row missed:** the overview states "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods…" — an SDK-based engine distributed as a plugin sits on the wrong side of that sentence, while our own `claude -p` under our own subscription does not. **Trigger for switching:** the store needs a *synchronous* per-tool-call decision (`canUseTool`) that a `PreToolUse` hook cannot express, or the interim-`result` ambiguity in stream-json becomes a real defect. Neither is on the map today.

## 7. Packing rule

**Pack one wave per sandbox: workers-per-sandbox = the wave's width, capped by a driver constant; spill to a second sandbox only above the cap.** Evidence: N=3 concurrent `claude -p` on a **1-vCPU / 2 GB** orchestrator ran clean in 4–5 s wall with no lock, rate, or shared-state error, shared or separate config dirs (R-o6a/b); the only shared-state hazard found is the config dir's user `CLAUDE.md`/settings, cured by per-run `CLAUDE_CONFIG_DIR`. The binding limits are not the CLI: (a) the account-level rate window (`rate_limit_event`; `/usage` read 9 % at width 2 per run-20) is the same whether workers share a VM or not, and (b) each worker needs its own worktree/clone under the sandbox, so disk + CPU of the XLarge pool set the cap, not `claude`. Sandboxes-per-wave (one VM per task) buys nothing the harness needs and multiplies the `cp fleet-golden` + provisioning cost. Set the cap from the first cut engine run (suggest 4) and record it in the spec.

## 8. Blockers

1. **`--bare` is incompatible with subscription OAuth** on 2.1.238 and 2.1.250 (R-o11b, R-l7, R-l8): `Not logged in`, exit 1, even with `CLAUDE_CODE_OAUTH_TOKEN`. The docs confirm ("bare mode doesn't use your subscription login"; `--bare` "will become the default for `-p` in a future release"). The design-inputs row must adopt the substitute `--setting-sources user --disable-slash-commands` + per-run `CLAUDE_CONFIG_DIR` (R-o11c proven), and the spec must carry a watch-item: when `-p` defaults to bare, the driver must pass whatever the opt-out flag is, or the fleet loses OAuth.

No other blocker. Everything else is a caveat or a driver-side table.

## Count

`claude -p` invocations: **36** (orchestrator 2.1.238: 27 — o1, o2, o2b, o2c, o2d, o12s, o12o, o3, o4, o4b, o5, o6, o6a×3, o6b×3, o7a, o7b, o8, o10a, o10b, o11a, o11b, o11c; laptop 2.1.250: 9 — l1, l2, l3, l4, l5, l6, l7, l8, l9). Budget ≤ 40. Sonnet/opus were used once each; all else haiku.

Item 7d added **4** more on the laptop (2.1.251) while building `runWorker`: p1, p2 and the two control arms of `probe_run_worker_live.mjs` (A conforming, B `--max-turns 1`). These are outside the ≤40 research budget — they are **build** repros, not research ones, and they run from a committed file (`fleet/tests/probe_run_worker_live.mjs`, ~$0.08, ~18 s) rather than by hand.

## Sources

- `claude --help` on both machines (saved: `<scratchpad>/p365/help-orch-only.txt`, `help-local.txt`, `help.diff`).
- https://code.claude.com/docs/en/headless — bare mode + auth, SIGTERM 143, `api_retry` fields, `dontAsk` + read-only command set, `--json-schema`, `--continue/--resume`, background-task grace.
- https://code.claude.com/docs/en/cli-reference — `--max-turns`, `--max-budget-usd` (subagent spend counts, v2.1.217+), `--effort` values, `--permission-mode` values, `--forward-subagent-text` (v2.1.211+), `--setting-sources`, `--disable-slash-commands`.
- https://code.claude.com/docs/en/env-vars — `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PROJECT_DIR_NAME` (v2.1.234+), `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` / `_SPAWN_DEPTH` (v2.1.217+), `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_SIMPLE`, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, `CLAUDE_CODE_ENABLE_TELEMETRY`.
- https://code.claude.com/docs/en/agent-sdk/overview, /agent-sdk/structured-outputs, /agent-sdk/cost-tracking — SDK capabilities, `error_max_structured_output_retries`, client-side cost estimate, third-party login policy.
- https://code.claude.com/docs/en/sandboxing — enablement via `/sandbox`; no `-p` statement.

## 9. What the Workflow tool gave us that `claude -p` does not (docs comparison, 2026-08-28)

Asked after the Phase 0 cut: is Workflows purely a set of limitations, or does leaving it cost
something? From the official docs (claude-code-guide agent; every cell cites its page):

| feature | Workflows (`agent()`) | `claude -p` / Agent SDK |
|---|---|---|
| Parallelism | ≤16 concurrent agents per run, CPU-bound; account-level rate limits ([workflows#behavior-and-limits](https://code.claude.com/docs/en/workflows#behavior-and-limits)) | no per-process cap; same account-level limits ([headless](https://code.claude.com/docs/en/headless#basic-usage)) |
| Worktree isolation | `isolation:'worktree'` declarative, auto-cleanup — cut from the session checkout, not BASE (#314) | driver clones at BASE itself (the point of Half 2) |
| Resume / replay | `resumeFromRunId` replays a run in-session, returns cached `agent()` results ([workflows#resume-after-a-pause](https://code.claude.com/docs/en/workflows#resume-after-a-pause)) | `--resume`/`--continue` continue ONE session; no saved-result replay → **#383** |
| Prompt cache | agents with matching config share a prefix in-run; TTL 5 min, `subagentPromptCacheTtl` up to 1 h ([workflows#prompt-caching-in-a-fan-out](https://code.claude.com/docs/en/workflows#prompt-caching-in-a-fan-out)) | **measured 2026-08-28 (#382, CLOSED):** sharing holds across processes, runs and sessions; `-p` writes the **1 h** breakpoint by default (`ephemeral_5m` = 0) — ~73% of every sibling's prefix is a cache read with no packing effort |
| Structured output | `agent({schema})` retries with tier escalation | `--json-schema` retries in-loop, never escalates (§2 item 1); driver keeps `runTaskInner`'s escalation |
| Observability | `/workflows` live phases + per-agent transcripts ([workflows#watch-the-run](https://code.claude.com/docs/en/workflows#watch-the-run)) | `stream-json` events incl. `system/api_retry`; OTEL — the store/W2c surface is ours to build |
| Permissions | `agent()` inherits the session's mode, no per-agent override | `--permission-mode`, `--allowedTools`, `--settings` hooks per worker ([headless#auto-approve-tools](https://code.claude.com/docs/en/headless#auto-approve-tools)) — role isolation becomes enforced |
| Cost | tokens in the UI only | `total_cost_usd` / `modelUsage` in the envelope (§2 item 3) |
| Failure | `agent()` → `null` on unrecoverable error; no retry control | exits 0/1/143 + `subtype` (§2 item 7) |
| Auth | session login | OAuth token (non-bare only — `--bare` refuses it, §8) → **#384** |
| Background | background run, per-agent pause/stop, notifications ([workflows#manage-runs](https://code.claude.com/docs/en/workflows#manage-runs)) | the driver's process supervisor (§5) |

**Lost, and measurable:** ~~in-run cache sharing (#382)~~ — **not lost, measured 2026-08-28: `-p` shares more, for longer** — cheap replay (#383). **Lost, and wanted gone:**
session-checkout worktrees, session-inherited permissions, the registry snapshot, baked prompts.
**Gained:** enforced per-worker tool isolation, cost as data, event-level failure classes, no LLM
orchestrator. The honest read: Workflows are built for one human's interactive session; a headless,
multi-run, base-pinned fleet is exactly where those conveniences became #314, the sweep
choreography, and the probe.
