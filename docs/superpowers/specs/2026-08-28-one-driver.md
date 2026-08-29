# The One Driver — spec (#389, map #366)

**Status:** plan-ready. **Map:** #366. **Client half:** #390.

**This file states the design. It is not the work order** — that is **#400 → #401 → #402 →
#403**, and those issues are self-contained. Read this to find out *what the thing is*; read
the issues to find out *what to do next*.

**Companion:** `2026-08-28-one-driver-answers.md` — the adopt-or-answer table satisfying the
design-inputs consumption contract, the trim review, and the seven operator decisions.
**Frozen inputs:** `2026-08-28-one-driver-design-inputs.md` (Amendments 1–8).
**Measurements this rests on:** `2026-08-28-claude-p-worker-parity.md` (#365),
`2026-08-28-prompt-cache-across-workers.md` (#382),
`evals/frontier/results/2026-08-28-wave-width.md` (#398).

*Written in the present tense, current design only. Where a decision reversed an earlier one,
the reasoning is in `git log -p` on this file and in the companion — never inline, because a
reader who lands mid-document must not meet a superseded claim stated as fact.*

---

## 1. The change

Today an LLM reads a skill, sequences deterministic scripts, and hands a plan to Claude
Code's Workflow tool, which reaches workers through `agent()`. Two non-determinisms sit above
the work: an LLM operator, and a runtime that cuts worktrees from the session checkout rather
than from BASE.

After this change there is one program. `fleet/`'s driver owns the wave loop, provisions each
worker's clone at BASE, dispatches one `claude -p` process per worker, reads the result
envelope, merges, folds, gates, and hands the run to the orchestrator to publish. **No LLM
orchestrates.** An LLM appears only as a worker.

**What does not change:** the trust core. Receipts at shas, exit codes as authority, the
standing grant, park-by-default, one human gate on the PR. This moves *who sequences*, never
*what is proven*.

## 2. The seam — why this is a substitution, not a rebuild

`harnesses/waves.js` is **already parameterised over its worker dispatcher**. It is a function
of six injected globals, and the Workflow tool is one thing that supplies them.
`tests/sim_workflow.mjs` supplies a second set with a stubbed `agent`:

```js
const factory = new Function(
  'agent', 'parallel', 'phase', 'log', 'args', 'budget',
  '"use strict"; return (async () => {\n' + SRC + '\n})();'
)
```

**The driver is the third implementation of a seam that already exists and is already under
test.**

The whole interface is `agent(prompt, opts)`, ten call sites, four option keys:

| key | sites | becomes |
|---|---|---|
| `label` | all | worker identity, receipt and store rows |
| `model` | all | `--model` |
| `schema` | all | `--json-schema` |
| `isolation: 'worktree'` | **two** (`:1107` implementer, `:1265` fix) | the driver cuts a clone at BASE |

Plus one return convention the driver honours exactly: **`agent()` returns `null` — never
throws — on abort or unrecoverable API error**, which `runTaskInner` converts to `AGENT_NULL`
for the barrier-retry path. The Workflows docs state both conditions: *"An `agent()` call
resolves to `null` if you stop it mid-run or it hits an unrecoverable API error."*

Of the other five globals: `parallel` is `Promise.all(thunks.map(t => t()))` (the sim's own
default), `phase` and `log` are store writes or no-ops, `args` is what `drive-one` already
assembles, and `budget` is `undefined` — the Workflow runtime's object, deleted with the cap.

So the work is:

1. **`runWorker(prompt, opts)`** — that contract, backed by `claude -p`.
2. **Worker trees cut at BASE**, replacing `isolation: 'worktree'`. `waves.js:1116` names
   #314's cause in its own words — *"engine worktrees are cut by the runtime … not by this
   script"* — so this makes the defect **inexpressible**, and #354 closes as moot.
   **Amendment 9:** whether those trees are worktrees or clones is deliberately *not* a
   design commitment. Stage 1 chose independent clones and thereby broke the fold path,
   which reads task refs from the integration tree. Once the kernel takes patches (§11),
   isolation's only job is a stable read-view during a task, and the choice stops mattering.
   **Isolation and CRDT merging are substitutes:** every unit of isolation bought is a unit
   of concurrency given up.
3. Mechanical: the file moves into `fleet/`, baked prompt strings become `roles/*.md`.

The wave scheduler, the bounded fix loop, fold adoption, reconciliation and the completeness
critic **do not change**. `waves.js` is 2,354 lines, of which ~1,115 are logic (778 comments,
385 prompt strings).

**The acceptance test already exists.** The three sims run the real `waves.js` against an
injected dispatcher, so passing them *is* the specification — locally, in seconds, no LLM,
which Amendment 1 permits explicitly.

## 3. The run, end to end

The laptop is a thin client. Every step except 1 and 9 runs on exe.dev.

1. **Author + sign (laptop, HITL).** The operator and the owned authoring skill (#390) produce
   `intent.md` (§7). The deterministic intent checker refuses an empty or `unknown` slot, a
   glob in a `Files:` block, and any human-eyes acceptance statement with no matching
   pre-authorization. Commit, push.
2. **Launch.** `node fleet/drive-one.mjs <intent-path> run-<N>` on the orchestrator.
3. **Provision.** Copy `fleet-golden` to a run sandbox; inside it cut `clones/integration` and
   one `clones/task-<id>` per task, **at BASE**.
4. **Derive wave *n*, for *n* ≥ 2.** The wave author reads the merged tree and emits
   `plans/wave-<n>.json`. Wave 1 skips it — `clones/integration` *is* BASE there, so there is
   nothing to derive against and the implementer gets the signed task directly.
5. **Dispatch.** One `claude -p` per task, concurrently, on this sandbox — one wave per
   sandbox, **width ≤ 8** (measured). Implement → review → fix, where a fix round is
   `--resume <implementer session-id>` (3.1× cheaper than a fresh dispatch).
6. **Merge + fold.** Unchanged: the fold kernel, `fold_wave.py`, reconciliation, the
   completeness critic. Map #360 owns their future.
7. **Record admission** at the wave boundary and mid-wave (§6).
8. **Gate once.** `gate_check.py` / `ultra_gate.py` as library functions; the exit code is the
   authority. Two-move rule on the verdict, with manual acks discharged by named
   pre-authorizations from `## Standing decisions`.
9. **The orchestrator opens the PR** with the receipt. Green → ready PR; parked → draft PR.
   The operator adjudicates recorded judgment calls there. The laptop never fetches a run
   branch.

## 4. Roles

Roles are **data** — one JSON object per role, not prose. `waves.js` dispatches seven roles;
three of them write to the integration worktree (`:232–235`). The table is five rows grouped
by **writable root**, the only axis that matters for isolation:

| role | model / effort | permission | tools | writable root |
|---|---|---|---|---|
| **wave author** | `opus`, `--effort high` | `dontAsk` | `Read,Grep,Glob,Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git status *),Write` | `<run>/plans/` only |
| implementer | per-task tier (§7) | `acceptEdits` | default minus `Bash(git stash *)`, `Bash(git push *)` | its own clone |
| setup / merge / reconcile / resolver | `most-capable` | `acceptEdits` | as implementer, plus `Bash(git merge *)`, `Bash(git checkout *)` | `clones/integration` |
| reviewer | `most-capable` | `dontAsk` | `Read,Grep,Glob,Bash(git diff *),Bash(git log *),Bash(git status *)` | nothing |
| critic | `most-capable` | `dontAsk` | reviewer's set **plus** `Bash(git checkout --detach *)`, `Bash(git rev-parse *)`, `Bash(git merge-base *)` | nothing (detaches HEAD only) |

**The critic's extra three are load-bearing.** `waves.js:373–376`: the sha-verified
`git checkout --detach` *"doubles as the branch release the frozen `ultra_gate.py --approve`
checkout needs (a critic that never detached reports BLOCKED, and a BLOCKED gate is never
Approved)"*; `:619–630` needs `rev-parse` + `merge-base --is-ancestor` for the #70/#259
ancestry assertion. Without them the gate cannot approve and silent merge drops become
undetectable — a weakened receipt, which §1 forbids.

**Which mechanism is the boundary** (measured, parity R-w1/w2/w3):

- **For allowlist roles** (wave author, reviewer, critic) the **allowlist is the boundary**.
  Arbitrary `Bash` is unreachable, so the unspecifiable "does this shell command write"
  predicate does not arise. A hostile worker's `python3 <<'EOF' … open(path,'a')` heredoc —
  matching no denylist a hook can enumerate — was denied by the allowlist.
- **For the implementer**, which runs `acceptEdits` with a broad tool set, the **`PreToolUse`
  hook is the boundary**: it denies any `Edit`/`Write` resolving outside the writable root,
  plus a closed denylist of write-capable `Bash` forms (`>`, `>>`, `tee`, `--output`, `-o`).
  That denylist is incomplete by nature, which is why the role is backed by a disposable VM
  rather than trusted alone.
- `git diff --output=<path>` writes a file, so `Bash(git diff *)` is a write primitive even on
  a read-only role. Target confinement is the hook's job; blast radius is the sandbox's.

**The wave author's shape** is the delicate one: `cwd = clones/integration` so it reads the
merged tree, `Write` permitted only under `<run>/plans/` via `--add-dir`. Verified under a
hostile prompt (R-w3): `--add-dir` permits the outside-cwd write, and Write / `echo >>` /
`sed -i` / a python heredoc into the clone are all denied.

**Confinement is only ever verified against a neutral role prompt and a hostile task.** A
*cooperative* role prompt ("you never edit the code you are planning against") produced a
clean-looking pass with zero denials and one hook call — the model simply declined. That is
prompt-level compliance masquerading as enforcement.

Per-role prompt files cost nothing (the shared cache block precedes the appended prompt), and
every worker carries `--exclude-dynamic-system-prompt-sections` — measured to raise
cross-clone prefix sharing from 72.6% to 88.4%.

## 5. The run directory and the receipt

One tree per run, inside the sandbox, disposable. `CLAUDE_CONFIG_DIR` points into it, so the
run directory is the evidence bundle.

```
<run-root>/
  intent.md                     the signed artifact, at the sha it was read at
  intent.sha
  claude/                       CLAUDE_CONFIG_DIR — every worker transcript
  clones/
    integration/                the merged tree; the wave author's cwd
    task-<id>/                  one clone per task, cut at BASE
  plans/
    wave-<n>.json               the derived plan (schema-validated)
    wave-<n>.md                 its rendered form, for the receipt and the PR body
  workers/
    <task-id>/{cmd,envelope.json,stream.jsonl}
  roles/
    {wave-author,implementer,write-side,reviewer,critic}.md
  receipts/
    receipt.json  gate-receipt.json  approve-receipt.json
```

**The receipt carries the derivation** — six changes to today's schema, four additions and two
re-types:

| field | carries |
|---|---|
| `intent.sha`, `intent.path` | what was signed |
| `waves[].planSha`, `waves[].plan` | the derived plan for that wave, inline — the receipt is self-contained, the run dir is not kept |
| `judgmentCalls[]` *(re-type)* | exists at `report-format.md:51` as a string array with a four-kind taxonomy (`:86`). Becomes `{taskId, kind, question, readings: [a,b], taken, rationale, standingDecision?}`, the four kinds surviving as `kind` |
| `acceptance[]` *(re-type)* | exists at `:24`/`:77` as one object with `mode`/`passed`. Becomes an array of `{taskId, statement, evidence}` with the run-level `mode`/`passed` retained |
| `admission[]` | `{waveIndex, decision, signal, counts}` — why a wave started or did not |
| `standingDecisions[]` | which pre-authorizations were consumed, and by which ack |

The two re-types are a breaking change to `report-format.md`; the schema and
`finalize_report.py`'s consumers move in the same PR.

**Store rows follow the row/cell axis rule** (`fleet/store.mjs`): `admission` and
`judgmentCalls` are fed by N concurrent workers, so they are **rows** — `<writerId>:<seq>`,
append-only, enforced in `guardViolation` — never cells. The receipt folds them at read time.
Status is a register; evidence is a set; totals are folds.

## 6. The process supervisor, and admission

**Supervisor.** Take the **last** `result` line (a background subagent may emit two). Exit
classes are **0 / 1 / 143** only; classify from the envelope, never the exit code alone:

| observed | meaning | action |
|---|---|---|
| 0, `subtype: success`, `is_error: false` | done | take `structured_output` |
| 0, `is_error: true`, `terminal_reason: aborted_streaming` | SIGINT abort | **`null`** (a documented `agent()` condition) |
| 1, `api_error_status ∈ {429, 503, 529}` | infrastructure | **`null`** — barrier retry, no fix round |
| 1, `api_error_status ∈ {401, 403, 404}` | credential / config | **fail the run** |
| 1, `terminal_reason: api_error`, `api_error_status: null` | the client refused **before reaching the API** | **fail the run** |
| 1, `api_error_status: null`, `error_max_turns` | no conforming reply in the cap | retry with tier escalation |
| 1, `api_error_status: null`, `error_max_budget_usd` | per-worker backstop | fail the task, record |
| **143** | SIGTERM, **no envelope at all** | retryable once, then fail the task |

**The discriminator is two-dimensional:** `terminal_reason` names the *layer* that failed,
`api_error_status` names whether the request *ever reached the API*. A populated status is an
API-layer failure; a null status under `terminal_reason: api_error` means the client refused
before sending anything — a dead credential returns exactly that, with `duration_api_ms: 0`
and an empty `modelUsage` (**R-p1**, found by building `runWorker`, not by specifying it).
A null status under any other `terminal_reason` is a limit we set ourselves, and therefore a
*task* outcome.

The earlier one-dimensional reading — populated = infrastructure, null = client-side limit —
sent a dead credential down the task-failure path, which would have left **every worker in the
wave burning a process to discover the same dead credential**. That is the failure the
credential row exists to prevent, so the row now keys on both fields.

**Never key on `subtype`** (three independent sightings now of `subtype: "success"` with
`is_error: true`: the in-loop nudge, an invalid model, and a dead credential) and **never on
`result === null` alone** (true of `max_turns`, `budget_exhausted` *and* aborts).

**One flag-parsing trap, because it is silent:** `--allowedTools`, `--disallowedTools` and
`--add-dir` are declared variadic, so a prompt passed as a trailing positional is swallowed as
one more value of whichever came last — exit 1, *no envelope at all*, and this table reads it
as the unclassifiable no-envelope row while the real cause never surfaces. The prompt is the
value of `-p`.

Two things remain assumptions and are marked as such in the code: a real 529 has never been
triggered, and whether `claude -p` inherits the SDK's 2× retry policy is undocumented — the
envelope carries no retry count, so a first-attempt and a retries-exhausted 529 are
indistinguishable from it.

One precondition, now stated rather than assumed (**R-p2**): the per-run `CLAUDE_CONFIG_DIR`
of §5 **loses the credential unless the credential is in the environment**. On the
orchestrator that is free — auth there is `CLAUDE_CODE_OAUTH_TOKEN`, which no config dir owns
— so the design is unaffected; but a driver that provisioned a run directory without the token
in the worker env would fail every worker, and now fails the run on the first one.

Each worker carries a wall-clock deadline per role, set from the first three runs'
distributions. A failed task never fails the wave silently: it lands in the receipt with its
class, the wave's merge proceeds on what completed, and the gate reads the shortfall.

**Admission is observation only in 0.3.0.** The driver records, at the wave boundary **and** at
mid-wave checkpoints (`waves.js` checks at eight points inside a wave, including per 16-task
chunk), from two meters that fail differently:

| meter | source | status |
|---|---|---|
| model — the account rate window | `api_retry` events in `stream-json` | reactive proxy; `/api/oauth/usage` is blocked on the orchestrator's token scope |
| substrate — exe.dev capacity | `billing usage --json` + per-run `stat <vm> --range=24h` | readable today, no credential problem |

**Read the meter, never sum the allocation:** summing `allocated_cpus` reports 31 against a
cap of 16, an oversubscription that does not exist; the metered `avg_cpu_cores` is 0.245.

Nothing is gated. The gate is built in 0.3.1 from what 0.3.0 records — because the cap it
replaces never fired in twelve runs, a threshold fitted to n=3 repeats that cap's own
"calibrated from size means" mistake, and the failure mode without gating is a slow run, not a
corrupt one: under starvation the engine already records `AGENT_NULL`, skips waves and BLOCKs
the gate without fabricating anything.

**What survives of the deleted cap:** the `spend` table, `total_cost_usd` recorded and never
enforced against, and the #181 spend page as observation only. **The claim-lease reaper
replaces the one thing the supervisor did that nothing else does** — out-of-band VM
reclamation. `destroySandbox` reaches the orchestrator's action surface at exactly one site
(`orchestrator.mjs:281`, inside the deleted spend pass); every other path runs inside the
drive process, so a killed drive would leak a billed VM forever. The sweep destroys a sandbox
whose claim lease expired with no drive heartbeat — a **liveness** trigger, over rows that
already exist. The right reason to destroy a VM is "nothing is using it", never "it spent too
much."

## 7. The intent document

**Seven slots, fixed:** `## Scope` · `## Tasks` · `## Global Constraints` ·
`## Standing decisions` · `## Cadence` · `## Acceptance` · `## Out of scope`.

**A `## Tasks` entry carries** id, `Depends-on`, `Interfaces`, `Produces:`, `**Files:**`,
`tier`, and one acceptance statement — a `do:`/`see:` example where behaviour is observable, a
number or bar where it is not. No verbatim implementation code; verbatim *contract* survives.

`Files:` and `tier` are **signed**, for two reasons. Wave shape is compiled before derivation
exists — §3 step 3 cuts clones before any wave is derived, and `compile_plan.py` derives
write-after-write overlap edges from `Files:` (`:744`, `:61`, `:81`, `:435`), which
`--overlap serialize` turns into wave-splitting edges (`:909`). And `tier` is a spend
authority: leaving it unsigned would hand per-task model choice to the wave author by
omission.

**The wave author may only** narrow `Files:` inside a signed task (never widen, never move
between tasks), declare `Commutes:` against that task's own `Files:`, and write bodies. The
driver rejects a derived plan that widens `Files:` or changes any signed field.

**Enforcement is by identity, not shape.** `--json-schema` validates shape; a derived plan
with an invented task id or a reworded acceptance statement is well-formed. So the driver
diffs the derived plan against the signed set keyed on `intent.sha` — equal id sets,
byte-identical edges / `Interfaces` / `tier` / acceptance, `Files:` a subset. A mismatch is a
failed derivation, retried once with the diff quoted back, then parked.

The `## Standing decisions` question bank is drawn from the ultralearn ledger and the redirect
corpus, **never invented**.

**Ceilings** (rule 7), each pinned by a test:

| ceiling | number |
|---|---|
| `## Standing decisions` entries | ≤ 8 |
| slot count | exactly 7 |
| engine prose (`SKILL.md`) | ≤ 400 words |
| owned authoring skill (#390) | ≤ 1,500 words, release-refusing |

**A ceiling is raised only by writing the new number and its reason into the release commit
body.** That escape hatch is what lets a ceiling be a hard bar without stalling a release.

**There is no line ceiling on code.** Rule 5's evidence is a *prose* pin (SKILL.md 3,129 →
864), where length is the harm; comments are 33–50% of the files a line ceiling would govern
and they are the design record; and a line ceiling is a guard on ourselves with no measured
case. Rule 5's intent is carried by the prose ceilings, scripts ≤ 10, guards ≥ 6, and §8's
guard-deletion rule.

## 8. What the driver may become

- **Every guard added after go-live owes a deletion in the same PR, and a measured number**,
  both named in the commit body. An incident narrative is not a number.
- **Port, don't rewrite.** The three sims must pass with their sentinel. This is weakest where
  it matters most: `ultra_run.py`, `finalize_report.py`, `warm_cache.sh` and `audit_run.py`
  become JS driver functions, which is a rewrite however it is phrased — their pytest cases
  port as driver tests **before** the old scripts are deleted, not after.
- **The worker CLI version is pinned per run, and the cache env is hygienic.** The 72.6%
  shared prefix block is keyed on model and CLI version alone, so rolling the CLI or switching
  models mid-wave costs every later worker ~18 k tokens. The driver records the version in the
  receipt and refuses a wave whose workers would not all run the same one. The worker env
  never carries `FORCE_PROMPT_CACHING_5M` or `DISABLE_PROMPT_CACHING*`, and always carries
  `--exclude-dynamic-system-prompt-sections`.

## 9. The bar, and the canaries

Every number goes into the cutover release commit; the release is refused without them.

| measure | today | bar |
|---|---|---|
| engine prose | 864 words | **≤ 400** |
| owned authoring skill | 3,038 + 1,059 | **≤ 1,500**, release-refusing |
| intent-doc schema | — | **7 slots, ≤ 8 standing decisions** |
| scripts under `skills/ultrapowers/scripts/` | 13 | **≤ 10** |
| guards deleted, each with a licensing number | — | **≥ 6 in this release** (Phase 0's 11 do not count) |
| gate parity | — | on the **10 fixtures carrying a `plan.md`**, the derived plan's wave shape and gate verdict equal the old engine's authored plan for the same intent |
| live parity | — | **≥ 3 fleet runs green**, one at width ≥ 2, `reported == ledger`, all five §W1d legs |
| cost | runs 13–23 ledger | **tokens per merged task ≤ 1.15×** |
| parks per run | 3 across runs 18–23, all `deferred:manual` | **0** |

**Three caveats on gate parity.** The intent docs are back-formed from authored plans, so
parity is a necessary and not sufficient condition — they are written before the wave author
exists, recording which fields were taken and which invented. It runs **on the fleet**, which
means **re-arming `ab_runner` on the driver is in-scope 0.3.0 work** (it drives `/ultrapowers`
locally by design, which Amendment 1 forbids; Phase 0 deferred it here). And wave 1 has no
derived plan, so single-wave fixtures test the compiler, not the design.

**On cost, plainly: this design does not pay for itself in tokens.** It saves ≈ 38–100 k/run in
prevented do-overs and spends ≈ 40–150 k/run authoring waves. The 1.15× is a pre-registered
admission. What it buys is the deletion of a defect class — all six defects in runs 18–23 were
in verbatim plan bodies — spend moved off the operator's shared window, and attention moved to
statements the operator can adjudicate. **Never sell this on tokens.**

The comparison arm is weak, and three conditions make it honest: **n is stated before the runs
are driven**; the baseline is **stated net of orchestrator spend** (the old ledger includes an
orchestrator LLM the new engine does not pay for) or reported both ways; and *merged task* is
fixed in advance as a task whose diff is in the integration branch at the gate, counted from
the receipt.

**`reported == ledger` degenerates under this design** — both sides come from the driver
reading the same envelope. Verify at cutover, then delete the row.

**One measurement this release owes, beyond the bar (Amendment 9):** re-run the
**fold-vs-serialize A/B on the driver**. The standing number — `0.640×` wall, `1.111×` tokens,
all hard gates green — is from 2026-08-14, on the old engine, at the widths then reachable.
Width is now measured **flat to 12 concurrent workers with zero failures** (#398), so
fold-versus-serialize is a different question than it was. Allowing same-file overlap is the
efficiency thesis of the whole redesign; this is the evidence for it.

**Canaries:**

| # | canary | baseline | bar |
|---|---|---|---|
| 1 | redirect rounds per task, all causes | 0.57 | ≤ 0.57 |
| 2 | derivation-caused rounds per task | 0.33 equivalent | **≤ 0.15** |
| 3 | judgment calls overturned by the operator at the PR | new | **≤ 1 in 5** |

**The reviewer who raises a round classifies its cause** — *contract* (the signed artifact was
wrong) or *derivation* (the artifact was right, the body wrong against real code). Ties go to
**contract**, so canary 2 cannot flatter itself. The classification is a receipt field.

## 10. Cutover — five stages

**The ordering principle:** *nothing is deleted until the thing replacing it has been redundant
for three green runs, and no stage tests more than one new idea at a time.*

**Amendment 9 knowingly bends the second half**, on the operator's call: stage 2 carries both
the patch-input kernel and the first self-hosted run, because otherwise stage 2 ships a
substrate decision it immediately throws away and the program pays for two cutovers. The
mitigation is **ordering, not hope** — the kernel change lands and greens against the existing
sims *before* any sandbox is provisioned, so the run itself still tests one new thing. If that
sequencing is not held, a failed run cannot say which novelty failed.

| stage | | issue |
|---|---|---|
| **0** | the claim-lease reaper + cap deletion, shipped alone — an unrelated billed-VM leak | **#400** |
| **1** | **the substitution** (§2), local, gated by the three sims. Not parallelised — a mechanical substitution is a task of sequential understanding. Not on the fleet — this stage builds the thing that runs fleet builds | **#401** |
| **2** | **the fold-native substrate (Amendment 9)** — the kernel takes patches against BASE, so no shared refs are needed and fold becomes the only merge path — **landed and green against the existing sims first**; then the first self-hosted run, proof and work at once, first entry against §9's live-parity bar. **Until it passes, the old path is untouched and remains the fallback** | **#402** |
| **3** | consequences, each driven by the new driver: derivation, admission observation, `ab_runner`, the receipt fields, the client half (#390) | **#403** |
| **4** | delete the old path, release **0.3.0**, after ≥ 3 green runs | **#403** |

**Standing items:** #386 closes at 0.3.0, each residual deleted or explicitly kept; #354 closes
as moot when stage 1 lands; #384 stays open as a watch; ship the MIT copyright and permission
notice with any prose derived from superpowers.

**Named risk:** 0.3.0 carries the port, the cutover, `ab_runner`, 10 intent docs, ≥ 3
validating runs, the authoring-skill fork, seven dropped skills and the ultradocket rework. The
mitigation is not to trim scope — the operator chose it — but to land it in reviewable pieces on
one branch, engine and client independently green, with the release commit as the only
integration point.

## 11. Out of scope

- **The merge kernel's SEMANTICS.** Map #360 owns them. `kernel/vendor/manyana.py` is not
  touched, and the layering rule holds — Manyana merges values, TinyBase coordinates the
  index. **Its INPUT SHAPE is in scope (Amendment 9):** the kernel takes patches against BASE
  rather than `--branch <task>=<branch>:<sha>`, so nothing downstream needs a shared object
  store or shared refs. Reconciliation semantics are unchanged; only what the adapter reads
  changes.
- **The verification periphery.** `gate_check.py`, `ultra_gate.py`, `run_acceptance.sh` and the
  compiler's diagnostic vocabulary move house, not behaviour. The one change — manual acks
  discharged by pre-authorization — happens at the *authoring* layer, leaving the gate's logic
  untouched.
- **The admission gate itself** — 0.3.1, fitted to what stage 3 records.
- **`claude plugin eval`** — gates the client surface, built with the authoring skill.
- **Re-drive reuse** (#383), and **#360 Tier 1**.
