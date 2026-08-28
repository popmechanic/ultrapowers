# Prompt-cache sharing across `claude -p` workers — measured (#382)

**Status:** research result, decision doc. Parent map #366 (*The One Driver*). Consumed by the
one-driver spec (#389) as its **cost row** and its **packing rule**.
**Method:** `mattpocock-skills:research` + one live measurement. Every number below is an
observed envelope field, not a docs claim; docs claims are labelled as such.
**Machine:** `fleet-orchestrator.exe.xyz` — `claude 2.1.238`, 1 vCPU / 1961 MB, subscription OAuth
(`CLAUDE_CODE_OAUTH_TOKEN`), no `ANTHROPIC_API_KEY`, **no settings file of any kind** on the host
(`~/.claude/settings.json`, `settings.local.json`, `/etc/claude-code/managed-settings.json` all
absent; no `CLAUDE_*`/`ANTHROPIC_*` in the login env) — so every default reported here is Claude
Code's own, not ours.
**Raw:** `/tmp/p382/log/<id>.{json,err,rc}` on the orchestrator; probe script
`/tmp/p382-probe.sh`.

## The question

Phase 0 left the Workflow tool. The one feature the docs attribute to `agent()` fan-out that a
driver spawning independent `claude -p` processes does not get *by construction* is **intra-run
prompt-cache sharing** — agents in one run with matching config read each other's cached prefix,
TTL 5 min by default, settable to 1 h via `subagentPromptCacheTtl`
([workflows#prompt-caching-in-a-fan-out](https://code.claude.com/docs/en/workflows#prompt-caching-in-a-fan-out)).
Amendment 4 added a second question: a serial **wave-boundary authoring pass** is dead time in
which prefix caches decay — what does that gap cost?

## Answer

**Option (a) of #382, and by a wider margin than the ticket anticipated.** Separate `claude -p`
processes share a prompt prefix, the sharing is complete where the prefix is byte-identical, and
**Claude Code writes its prefix with the 1-hour ephemeral breakpoint by default in `-p`** — 12× the
fan-out TTL the Workflows docs advertise. The driver needs no TTL setting, no launch-window
choreography, and pays no cache penalty for a wave-boundary authoring pass of any plausible length.

Two results the ticket did not ask for and the spec should take anyway: **~73% of every worker's
prefix is a cache read by construction**, because the big breakpoint is keyed on the model and CLI
version alone — not on the role prompt or the clone (§C) — and **`--resume` is 3.1× cheaper than a
fresh dispatch** for a fix round, reversing the parity doc's n=1 reading and disproving its
explanation (§F).

## Probe design

One role prompt file, identical for every worker (`--append-system-prompt-file`), the driver's
shape per Amendment 3 (prompts as files). Four clone directories with byte-identical contents at
different paths — the real wave shape, one clone per task. Every worker:

```
cd <clone> && claude -p "<task text>" --output-format json --model <m> \
  --permission-mode dontAsk --append-system-prompt-file <role.md> --max-turns 2 </dev/null
```

Read `usage.cache_creation_input_tokens` / `usage.cache_read_input_tokens` /
`usage.cache_creation.{ephemeral_1h,ephemeral_5m}_input_tokens` and `total_cost_usd` from each
envelope. `share` = `cr / (cc + cr)` — the fraction of the prefix that was read rather than
re-written.

## Results

### A. Cross-process sharing (haiku, 20:02:26–20:02:42 UTC, ~2 s per run)

| arm | dir | task text | cc | cr | total | share | $ |
|---|---|---|---|---|---|---|---|
| a0 cold baseline | d0 | P | 6,845 | 18,139 | 24,984 | 72.6% | 0.01697 |
| a1 same dir, same text | d0 | P | **0** | **24,984** | 24,984 | **100%** | 0.00385 |
| a2 same dir, different text | d0 | Q | 2,776 | 22,208 | 24,984 | 88.9% | 0.00938 |
| a3 different dir, same text | d1 | P | 6,845 | 18,139 | 24,984 | 72.6% | 0.01704 |
| a4x concurrent sibling | d1 | P | **0** | **24,984** | 24,984 | **100%** | 0.00377 |
| a4y concurrent sibling | d2 | Q | 6,845 | 18,139 | 24,984 | 72.6% | 0.01705 |
| a4z concurrent sibling | d3 | R | 6,845 | 18,139 | 24,984 | 72.6% | 0.01671 |

a1 is the finding: a **separate process**, launched after a0 exited, read **100%** of a0's prefix
and wrote nothing. a4x read the prefix a3 wrote. Sharing is not session-scoped.

### B. The same, at the models the driver actually dispatches

| arm | model | cc | cr | total | share | $ |
|---|---|---|---|---|---|---|
| cold | opus | 5,948 | 16,020 | 21,968 | 72.9% | 0.0686 |
| immediate re-run, separate process, same dir | opus | **0** | **21,968** | 21,968 | **100%** | **0.0120** |
| different dir | opus | 5,950 | 16,020 | 21,970 | 72.9% | 0.0686 |
| same dir, different task text | opus | 3,186 | 18,797 | 21,983 | 85.5% | 0.0209 |
| cold | fable | 6,294 | 16,024 | 22,318 | 71.8% | 0.1431 |

A full prefix hit is **5.7× cheaper** than a cold worker at opus ($0.0120 vs $0.0686 on an
otherwise-empty task). The shared fraction is stable across haiku / opus / fable at **~73%**.

### C. The prefix has three breakpoints, and the big one is model-scoped

The arms decompose it exactly (haiku; opus is the same shape at 16,020 / 2,777 / 3,186):

| block | size | keyed on | shared across a wave's siblings? |
|---|---|---|---|
| **B1** — Claude Code's own system prompt + tool definitions | **18,139 (72.6%)** | **model + CLI version only** | **yes** — across processes, clones, role prompts, sessions and runs |
| B2 — appended role prompt ⊕ working-directory context | 4,069 (16.3%) | `--append-system-prompt-file` **and** `cwd` (its `CLAUDE.md`, git state, listing) | only between workers sharing **both** |
| B3 — task text tail | 2,776 (11.1%) | the user prompt | only on an identical re-dispatch |

A fourth arm isolates B1 from the role prompt. Three siblings launched **simultaneously**, in three
fresh clones, with a **brand-new role prompt file** (guaranteed-cold B2):

| arm | cc | cr | share |
|---|---|---|---|
| cold1 / cold2 / cold3, concurrent, new role file, new clones | 6,830 each | **18,139 each** | **72.6% each** |

So the appended system prompt sits *after* the big breakpoint, not before it: **B1 is not ours to
invalidate.** Any worker of a given model on the box reads it, whatever its role or clone. A wave of
N siblings in N distinct clones therefore shares **~73% of every prefix by construction**, with no
packing effort, and varying role prompts per worker costs nothing beyond the B2 they were already
missing.

The one case where B1 is genuinely cold is the **first worker of the first wave on a fresh sandbox**
for a given model — a one-time ~18 k write per sandbox per model. Whether concurrent cold siblings
race to write it or one writes and the rest read was not isolated (B1 was warm on this box in every
arm); at ~18 k tokens once per sandbox it does not reach the cost row.

### D. TTL — the one that changes the design

**Every cache write in every arm, on every model, was `ephemeral_1h`:**

```
"cache_creation": { "ephemeral_1h_input_tokens": 6845, "ephemeral_5m_input_tokens": 0 }
```

With no settings file on the host, this is Claude Code's built-in `-p` default. The Workflows
5-minute fan-out default and its `subagentPromptCacheTtl` escape hatch are answering a problem the
driver does not have.

### E. Wave-boundary gap (Amendment 4's second measurement)

The ticket's premise was that a serial authoring pass between waves is dead time in which prefix
caches decay. It does not happen. Same three sibling processes, same clones, same task text, after
an idle gap:

| arm | idle gap | cc | cr | share |
|---|---|---|---|---|
| a5x / a5y / a5z (3 concurrent siblings) | **6 min** | **0 / 0 / 0** | 24,984 each | **100% each** |
| a6 (one worker) | **11 min** | **0** | 24,984 | **100%** |

a4y and a4z were *cold* when they wrote those prefixes (cc = 6,845 each); six minutes later they
read them back whole. **A wave-boundary authoring pass costs nothing in cache reads** at 6 or 11
minutes — consistent with §D's 1-hour breakpoint, and flatly inconsistent with the 5-minute TTL the
ticket assumed. The decay boundary was not bracketed: finding it needs a >60-minute arm, which no
decision depends on (a wave-boundary authoring pass is minutes).

### F. Fix rounds — `--resume` vs a fresh dispatch (corrects #365 R-o10)

The parity doc left this open: *"fix round: `--resume <sid>` or fresh dispatch — pick per the
pre-registered measurement"*, on an n=1 reading that **resume cost 1.7× fresh** and attributed it to
*"the prior turn's cache had partly expired"* after ~10 minutes (R-o10a/b). §E falsifies the
attribution — nothing expires at 11 minutes. Measured directly, one session, same clone:

| arm | gap after the session's first turn | cc | cr | share | $ |
|---|---|---|---|---|---|
| s1 — the session's first turn | — | 0 | 24,984 | 100% | 0.00375 |
| s2 — `--resume` | **2 s** | **109** | 24,984 | 99.6% | **0.00293** |
| s3 — fresh dispatch, same clone, new task text | 2 s | 2,776 | 22,208 | 88.9% | 0.00899 |
| s4 — `--resume` | **11 min** | **92** | 25,093 | 99.6% | **0.00290** |

**Resume is ~3.1× cheaper than a fresh dispatch, and the gap does not matter.** The direction in
R-o10 is reversed, and its explanation was wrong: resume appends ~100 tokens to a fully-cached
prefix, while a fresh dispatch changes the task-text block (§C block 3) and re-writes it. R-o10's
1.7× was n=1 against a differently-warmed fresh arm, not a timing effect.

### G. What the sharing is worth at wave scale

A cold wave of three siblings in three clones writes `3 × 6,845 = 20,535` prefix tokens instead of
`3 × 24,984 = 74,952` — **72.6% of the wave's prefix write cost is not paid**. At opus rates the
per-worker delta between a cold prefix and a full hit is $0.0686 → $0.0120 (**5.7×**) on an
otherwise-empty task.

## What the Workflow arm would have been

**Not reconstructable, and that is itself a finding.** #382's method assumed the run-18/20 bundles
carry per-agent usage; they do not — `fleet-receipts/run-*/` holds the gate receipt only, and
Workflows report tokens **in the UI only** (parity doc §9, *Cost*). There is no envelope, no
`modelUsage`, no per-agent cache field to read. The comparison is therefore docs-claim against
measurement:

| | Workflows `agent()` fan-out | measured `claude -p` |
|---|---|---|
| sharing scope | agents **within one run**, matching config (docs) | any process, any run, any session (measured, §A) |
| default TTL | **5 min**, raise to 1 h via `subagentPromptCacheTtl` (docs) | **1 h**, no setting (measured, §D) |
| per-agent cache accounting | none — UI only (parity §9) | `usage.cache_*` + `modelUsage` per worker (measured) |

The driver does not lose in-run cache sharing. It gains a longer default TTL, sharing that outlives
the run, and — for the first time — the numbers as data.

### H. `--exclude-dynamic-system-prompt-sections` buys most of B2 back — free

Added 2026-08-28 after the docs pass (below) named a flag §C's arms did not use. It is
documented as moving *"per-machine sections (cwd, env info, memory paths, git status) from
the system prompt into the first user message"*
([cli-reference#cli-flags](https://code.claude.com/docs/en/cli-reference#cli-flags)) and is
present on the orchestrator's 2.1.238. It applies with `--append-system-prompt-file` (it is
ignored only with `--system-prompt`). Same probe shape, three fresh clones, a brand-new role
file:

| arm | clone | task text | cc | cr | share |
|---|---|---|---|---|---|
| xds1 (cold) | x1 | one | 3,703 | 21,071 | 85.1% |
| xds2 | **x2** | one | **2,870** | **21,904** | **88.4%** |
| xds3 | **x3** | two | **2,870** | **21,904** | **88.4%** |

**A different clone now shares 88.4% instead of 72.6%** — +15.8 points, and per-worker
prefix creation falls from 6,845 to 2,870 tokens (**−58%**). The working-directory block
(§C's B2) is no longer in the cached prefix at all; the worker still receives that context,
relocated to its first user message.

**This overturns decision 3 below as it was first written.** There is no need to *contort*
anything: the shared-`cwd` trade that would have cost per-clone write confinement is not the
only way to buy B2 — a documented flag buys most of it while every worker keeps its own
clone. The flag is adopted; the contortion stays rejected.

### I. What the docs say (primary sources, read 2026-08-28)

| claim | source |
|---|---|
| The cache is scoped **per organization** (and per workspace on the API/Bedrock/Foundry); within that boundary *"any two requests with the same model and prefix read the same cache"* | [prompt-caching#cache-scope](https://code.claude.com/docs/en/prompt-caching#cache-scope) |
| Cache hits require **100% identical prefix bytes** to the breakpoint; the key is a cumulative hash of that prefix | [build-with-claude/prompt-caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| Pricing: 5-min write **1.25×**, 1-hour write **2.0×**, read **0.1×** base input. A read refreshes the TTL at no cost | same |
| *"The system prompt embeds the working directory, platform, shell, OS version, and auto memory paths, so two sessions in different directories build different prefixes and miss each other's cache … including worktrees of the same repository"* | [prompt-caching#cache-scope](https://code.claude.com/docs/en/prompt-caching#cache-scope) |
| TTL controls: `promptCacheTtl` / `CLAUDE_CODE_PROMPT_CACHE_TTL` (main conversation) and `subagentPromptCacheTtl` / `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` (everything else) — **v2.1.242+**. Priority: `FORCE_PROMPT_CACHING_5M=1` > bucket env var > bucket setting > `ENABLE_PROMPT_CACHING_1H=1` > default | [prompt-caching#choose-the-ttl-yourself](https://code.claude.com/docs/en/prompt-caching#choose-the-ttl-yourself) |
| A workflow agent's requests fall **outside** the main conversation's TTL bucket, so **5 minutes by default, including on a subscription**; `subagentPromptCacheTtl: 1h` raises it | [workflows#prompt-caching-in-a-fan-out](https://code.claude.com/docs/en/workflows#prompt-caching-in-a-fan-out) |
| Workflows hold matching siblings until the first response begins, capped at `CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS` (**5000** default) | same |
| `rate_limit_event` is **not a documented event type.** What exists is `system`/`api_retry`, carrying `attempt`, `max_retries`, `retry_delay_ms`, `error_status`, and `error` — where `rate_limit` is one **value of the `error` field** | [headless#handle-api-retries](https://code.claude.com/docs/en/headless#handle-api-retries) |
| **Undocumented:** any HTTP endpoint for `/usage`; rate-limit response headers under subscription OAuth; cache sharing across workflow runs or sessions | — |

**Three consequences the docs add to the measurement.**

1. **The docs' "different directories miss each other's cache" is true of the *whole* prefix
   and misleading about the *fraction*.** §A measured 72.6% still shared across directories,
   and §H raises it to 88.4% with the documented flag. The design question was never
   all-or-nothing.
2. **The 1-hour default we measured is the *main-conversation* bucket.** Workflow agents get
   5 minutes by the docs' own statement — so the port does not merely avoid a TTL setting,
   it **moves every worker from the 5-minute bucket into the 1-hour one** by making each
   worker a main conversation. That is a second, independent reason the driver's cache
   position is better than the engine it replaces.
3. **The TTL settings are below the golden's floor and not needed.** `promptCacheTtl` needs
   **2.1.242+**; the orchestrator runs **2.1.238**. Immaterial — the default is already the
   one we want. What matters is the negative: **never set `FORCE_PROMPT_CACHING_5M=1`**, and
   never let `DISABLE_PROMPT_CACHING*` reach a worker's environment. Worth a line in the
   driver's env hygiene rather than a discovery later.

## Decisions returned to the one-driver spec (#389)

1. **Packing rule stands as #365 decided it** — one wave per sandbox, width ≤ ~4, siblings launched
   together. No TTL flag, no `subagentPromptCacheTtl` analogue, no launch-window choreography.
   Launching siblings *together* is a wall-clock choice, not a cache choice: the cache is there an
   hour later either way.
2. **Cost row is not endangered by cache loss.** The pre-registered bar is tokens per merged task
   ≤ 1.15×; the cache term moves it toward the driver, not away. Expect ~73% prefix cache-read
   share on a cold wave and ~100% for a re-dispatched worker in the same clone within the hour —
   which is exactly the fix-round case, the most frequent re-dispatch we have.
3. **Adopt `--exclude-dynamic-system-prompt-sections`; keep rejecting the contortion.** §H:
   the flag raises cross-clone sharing from 72.6% to **88.4%** and cuts per-worker prefix
   creation 58%, while every worker keeps its own clone. The shared-`cwd` trade — which
   would have cost the per-clone write confinement that makes role isolation enforceable —
   stays rejected, because it is no longer the only way to buy B2.
4. **Role prompts are free to vary; the CLI version is not.** B1 is keyed on model and CLI version
   alone (§C) — per-role, or even per-task, system prompt files cost nothing extra. What *does*
   cost is rolling the CLI or switching models mid-wave: either invalidates B1 for every worker
   after it, at ~18 k tokens each. The spec should pin the worker CLI version per run, which the
   sandbox image already does.
5. **Fix rounds `--resume`, they do not re-dispatch** (§F). This closes the parity doc's open
   pick — resume is 3.1× cheaper and the run-dir session id is already per-worker. The #365 row
   recording the opposite is corrected in place with a pointer here.
6. **The wave-boundary authoring pass is not a cache cost** (§E). Amendment 4's serial in-loop
   authoring step can be priced on its own tokens alone; there is no decay surcharge to add to it,
   and no reason to overlap authoring with execution to protect a cache.

## Appendix — is `/usage` programmatically readable from the orchestrator? (#389 open question)

Amendment 4 deleted the 500k per-run token cap in favour of **wave-boundary admission control off
the real meter**, and #389 lists this as verify-before-adopt. Measured this sitting:

**The endpoint is real and scriptable.** `GET https://api.anthropic.com/api/oauth/usage` with
`Authorization: Bearer <oauth access token>` returns, from the laptop, HTTP 200 and:

```json
{"five_hour":{"utilization":3.0,"resets_at":"2026-08-29T00:00:00Z","locked_reason":null},
 "seven_day":{"utilization":77.0,"resets_at":"2026-08-31T23:00:00Z","locked_reason":null},
 "extra_usage":{"is_enabled":true,"used_credits":114357.0,"currency":"USD",…}, …}
```

`five_hour.utilization` / `seven_day.utilization` / `resets_at` / `locked_reason` are exactly the
admission signal the deleted cap was groping for — a **rate-window** reading, not a dollar guess.

**But the orchestrator's token cannot read it.** From `fleet-orchestrator`, the same request with
`/home/exedev/.fleet/claude-oauth-token` returns **HTTP 429** `rate_limit_error` on every header
variant tried (plain, `anthropic-beta: oauth-2025-04-20`, plus `anthropic-version` +
`claude-cli` UA). Three controls place the blame:

| control | result | reading |
|---|---|---|
| bogus token, from the orchestrator | **401** `authentication_error` | auth is evaluated; 429 is not "bad token" |
| **no** `Authorization` header, from the orchestrator | **429** `rate_limit_error` | 429 **is** the unauthenticated shape |
| **no** `Authorization` header, from the laptop | **429** `rate_limit_error` | not IP-specific |
| laptop keychain token ×3 in a row | **200, 200, 200** | not a per-IP or per-account throttle |

So the orchestrator's token authenticates for **inference** (every `claude -p` in this document ran
on it) but is not accepted for the usage endpoint — it falls through to the unauthenticated path.
The laptop's keychain credential carries
`scopes: [user:file_upload, user:inference, user:mcp_servers, user:profile, user:sessions:claude_code]`;
a `claude setup-token` long-lived token evidently carries a narrower set. Both are `sk-ant-oat01`,
both 108 chars — the shape does not distinguish them.

**Returned to #389:** the admission signal exists and is cheap to read, but adopting it requires the
orchestrator to hold a credential with the profile scope. Two dispositions, and the spec must pick
one rather than assume:

- **(i)** provision the orchestrator with a broader-scoped OAuth credential and poll
  `/api/oauth/usage` at each wave boundary — a live rate-window reading, the strongest form of the
  admission control Amendment 4 asked for; the cost is a second credential class on the box.
- **(ii)** fall back to `rate_limit_event` observation in `--output-format stream-json` (confirmed
  observable, parity doc R-o8) — no new credential, but the signal is reactive: it tells the driver
  it *has* been limited, not how much room is left before the next wave.

**Recommendation: (ii) for the cutover, (i) as a follow-up ticket.** The cap being replaced never
fired (peak run-18 63%); a reactive signal is already strictly better than a post-hoc dollar cap
that destroyed the sandbox, and it adds no credential surface in the release that is supposed to be
a subtraction.

## Count

**26 measured `claude -p` runs** — 7 haiku wave arms (a0–a4z), 3 six-minute-gap arms (a5*), 1
eleven-minute-gap arm (a6), 5 model arms (opus ×4, fable ×1), 4 session arms (s1–s4), 3 cold-B1
arms (cold1–3), 3 dynamic-sections arms (xds1–3) — plus **10 HTTP controls** against `/api/oauth/usage` (orchestrator: 3 header variants, bogus token, no auth;
laptop: valid token ×4, no auth). Every envelope is on the orchestrator at
`/tmp/p382/log/<id>.json`; none was discarded.
