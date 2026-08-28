# The One Driver — spec (#389, map #366)

**Status:** **PLAN-READY.** Trim review complete (two reviewers; every finding adopted or
answered; `netConceptDelta` graded **`flat`** by the reviewer, not the author). Operator
review complete — seven decisions taken 2026-08-28, recorded at the end of this file.
Next artifact is the **intent document** for the port itself.
**Map:** #366 *The One Driver*. **Ticket:** #389. **Client half:** #390 (dependency posture).
**Design inputs (frozen, adopt-or-answer row by row):**
`docs/superpowers/specs/2026-08-28-one-driver-design-inputs.md`, **Amendments 1–6**.
**Supporting measurements:** `2026-08-28-claude-p-worker-parity.md` (#365, as corrected),
`2026-08-28-prompt-cache-across-workers.md` (#382), `2026-08-28-one-driver-phase-0.md`
(shipped 0.2.26).

---

## 1. The change, in one page

Today an LLM reads `skills/ultrapowers/SKILL.md` and sequences deterministic scripts, then
hands a plan to Claude Code's Workflow tool, which reaches workers through `agent()`. Two
non-determinisms sit above the work: an LLM operator, and a runtime we do not control that
cuts worktrees from the session checkout rather than from BASE.

**After this spec there is one program.** `fleet/drive-one.mjs` grows the wave loop that
lives in `harnesses/waves.js` today and becomes *the engine*. It provisions each worker's
clone at BASE itself, dispatches one `claude -p` process per worker with a prompt file and
a JSON schema, reads the result envelope, merges, folds, gates, and opens the PR. **No LLM
ever orchestrates.** An LLM appears only as a worker: implementer, reviewer, critic, and —
new under Amendment 4 — **wave author**.

Three consequences fall out rather than being engineered:

- **Wrong-base becomes inexpressible.** The thing that cuts the clone is the thing that
  knows BASE, so #314's `startHead`/`baseCorrected` guard and its watch (#354) have nothing
  left to detect.
- **Prompts stop being baked.** They are files the driver passes with
  `--append-system-prompt-file`, so `workflow-template.md`, `test_no_prompt_drift.py` and
  the re-bake ritual go.
- **Roles stop being requests.** A reviewer that cannot call `Edit` is a flag-set, not a
  sentence in a prompt.

And one thing the operator asked for arrives: **the operator signs an intent document, not
a plan** (Amendment 4). The plan is derived one wave at a time by a worker reading the
merged tree, and is disposable.

**What does not change:** the trust core. Receipts at shas, exit codes as authority, the
standing grant, park-by-default, one human gate on the PR. This spec moves *who sequences*,
never *what is proven* (rule 1).

## 2. The run, end to end

The laptop is a thin client (Amendment 1). Every step below except 1 and 9 runs on exe.dev.

1. **Author + sign (laptop, HITL).** The operator and the owned authoring skill (#390)
   produce `intent.md` — task set, `Depends-on` edges, `Interfaces`, one acceptance
   statement per task, `## Global Constraints`, `## Standing decisions`, cadence. The
   deterministic **intent checker** refuses an empty or `unknown` slot, and refuses any
   human-eyes acceptance statement with no matching pre-authorization (§6). Commit, push.
2. **Launch.** `node fleet/drive-one.mjs <intent-path> run-<N>` on the orchestrator. This
   is the whole client surface.
3. **Provision.** The driver copies `fleet-golden` to a run sandbox and, inside it, cuts
   `clones/integration` and one `clones/task-<id>` per task **at BASE**, by hand.
4. **Derive wave *n* — for *n* ≥ 2 only.** The **wave author** worker runs read-only against
   `clones/integration` (the merged tree) and emits `plans/wave-<n>.json`: bodies, `Files:`
   **narrowing** inside already-signed tasks, `Commutes:`. It may not add or remove tasks,
   edges, `tier`, or acceptance statements — those are signed (§6).

   **How that is enforced, because a schema cannot do it.** `--json-schema` validates
   *shape*, not *identity*: a derived plan with an invented task id, a dropped edge, or a
   reworded acceptance statement is perfectly well-formed. So the driver diffs the derived
   plan against the signed set **by identity, keyed on `intent.sha`** — the task id set must
   be equal, `Depends-on` and `Interfaces` and `tier` and every acceptance statement byte-
   identical, and `Files:` a subset of what was signed. A mismatch is a **failed
   derivation**, retried once with the diff quoted back, then the run parks. This check is
   the reason `intent.sha` is in the receipt (§4).

   **Wave 1 skips the author entirely.** At wave 1, `clones/integration` *is* BASE, so the
   author would read exactly what the implementer reads from its own clone at the same sha,
   and produce a body from it — a pure extra LLM hop. Wave 1 implementers get the signed
   task directly. Derivation exists because *a prior wave changed the tree*; with no prior
   wave there is nothing to derive against. This removes the authoring pass from every
   single-wave run — most of `evals/fixtures/*` — and takes roughly a third to a half off
   the 40–150 k/run authoring cost that §9's cost row admits it cannot pay for.
5. **Dispatch.** One `claude -p` per task in the wave, concurrently, on this sandbox
   (packing rule: one wave per sandbox, width ≤ 4). Implement → review → fix, where a fix
   round is `--resume <implementer session-id>` (§8, Amendment 6).
6. **Merge + fold.** Unchanged in semantics: the fold kernel, `fold_wave.py`,
   `wave-merge.md`'s reconciliation, the completeness critic. Map #360 owns its future.
7. **Admission check at the wave boundary.** If the window is under pressure the next wave
   does not start: the run folds what it has, publishes, and says so in the receipt (§5).
8. **Gate once.** `gate_check.py` / `ultra_gate.py` as library functions. Exit code is the
   authority. Two-move rule on the verdict, with manual acks now discharged by named
   pre-authorizations from `## Standing decisions` (§6).
9. **The orchestrator opens the PR** with the receipt (Amendment 1 decision 5). Green → a
   ready PR. Parked → a draft PR. The operator adjudicates recorded judgment calls there,
   and merges. The laptop never fetches a run branch.

## 3. The four role flag-sets

Roles are **data** — one JSON object per role in the driver, not prose. Amendment 4 makes
it four; the fourth is specified here for the first time.

Roles are **data** — one JSON object per role in the driver, not prose. Amendment 4 said the
*flag-sets* go three → four. It did not say the **role inventory** is four, and `waves.js`
dispatches **seven**: setup (`:1887`), implementer (`:1105`, `:1247`), reviewer (`:1179`),
contended-merge/fold (`:1457`), resolver (`:1582`), merge (`:1759`), reconcile (`:1783`),
critic (`:2199`). Three of those **write to the integration worktree** — `waves.js:232–235`
names them: *"the setup, merge, and reconcile roles … the run's dedicated integration
worktree, which those write-side roles may modify."* A four-row table cannot express them,
so the table below is **five rows covering all seven roles**, grouped by **writable
root** — the only axis that matters for isolation:

| role | model / effort | permission | tools | writable root |
|---|---|---|---|---|
| **wave author** *(new)* | `opus`, `--effort high` | `dontAsk` | `Read,Grep,Glob,Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git status *),Write` | `<run>/plans/` **only** |
| implementer | per-task tier (§6) | `acceptEdits` | default minus `Bash(git stash *)`, `Bash(git push *)` | its own clone |
| **setup / merge / reconcile / resolver** *(the write side)* | `most-capable` | `acceptEdits` | default minus `Bash(git stash *)`, `Bash(git push *)`, plus `Bash(git merge *)`, `Bash(git checkout *)` | `clones/integration` |
| reviewer | `most-capable` | `dontAsk` | `Read,Grep,Glob,Bash(git diff *)`†`,Bash(git log *),Bash(git status *)` | nothing |
| critic | `most-capable` | `dontAsk` | reviewer's set **plus** `Bash(git checkout --detach *)`, `Bash(git rev-parse *)`, `Bash(git merge-base *)` | nothing (detaches HEAD only) |

**The critic's extra three are not a convenience — the gate depends on them.**
`waves.js:373–376` records that the critic's sha-verified `git checkout --detach` *"doubles
as the branch release the frozen `ultra_gate.py --approve` checkout needs (a critic that
never detached reports BLOCKED, and a BLOCKED gate is never Approved)"*, and `:619–630`
needs `rev-parse` + `merge-base --is-ancestor` for the #70/#259 ancestry assertion. A
read-only allowlist without them would leave the gate unable to approve and silent merge
drops undetectable — a weakened receipt, which rule 1 forbids.

**Which mechanism is actually load-bearing — measured, not assumed (parity R-w1/w2/w3).**
A draft of this section said the allowlist is not the boundary and the `PreToolUse` hook is.
**That is backwards for the read-side roles**, and the repro shows why: a hostile worker
reached for `python3 << 'EOF' … open(path,'a')`, which matches **no** write-form denylist a
hook can practically enumerate — no `>`, no `tee`, no `--output`. It was denied by the
**closed allowlist**. So:

- **For a role whose tools are an allowlist** (wave author, reviewer, critic), the
  **allowlist is the boundary** and the hook is belt-and-braces. Arbitrary `Bash` is never
  reachable, so there is no shell-write predicate to specify — the unspecifiable problem
  disappears rather than being solved.
- **For the implementer**, which runs `acceptEdits` with a broad tool set and must still be
  confined to its own clone, the **hook is the boundary**. It denies any `Edit`/`Write`
  whose `file_path` resolves outside the writable root, plus a closed denylist of
  write-capable `Bash` forms (`>`, `>>`, `tee`, `--output`, `-o`). That denylist is
  admittedly incomplete — R-w3 is the proof — which is exactly why the implementer's
  confinement is backed by a disposable VM and not trusted on its own.
- **`git diff --output=<path>` writes a file**, so `Bash(git diff *)` is a write primitive
  even on a read-only role. It stays in the allowlist because the *target* is confined by
  the hook and the blast radius by the sandbox; the parity doc's caveat (`:141`) that the
  built-in read-only command set runs regardless of the allowlist stands.

**Measured, on the golden's 2.1.238, with this exact flag-set** (parity R-w3): under a
hostile prompt ordering four escape routes, `--add-dir` permitted the write to
`<run>/plans/`, and `Write`, `echo >>`, `sed -i` and a Python heredoc into the clone were
all denied. Exit 0, 8 turns, the worker reported honestly which routes it had tried.

**The wave author is the delicate one, and its shape is the point.** It runs with `cwd =
clones/integration` so it reads the *merged* tree, but may `Write` only under
`<run>/plans/` — so it cannot edit the code it is planning against, the separation that
makes "derive the plan" different from "start implementing." Writing **outside cwd**
requires `--add-dir <run>/plans` — which was the spec's one build-blocking unknown and is
now **discharged**: parity R-w1/w2/w3, run 2026-08-28 on the golden's 2.1.238. The shape
holds exactly as specified, so the fallback (inverting cwd to `<run>/` and reading the tree
through `--add-dir`) is **not needed**.

One finding from that repro is worth carrying into every role prompt: in R-w1 a
*cooperative* role prompt ("you never edit the code you are planning against") produced a
clean-looking pass with **zero denials and one hook call** — the model simply declined. That
is prompt-level compliance masquerading as enforcement, the #32 class this spec exists to
delete. **Confinement is only ever verified against a neutral role prompt and a hostile
task.**

Per Amendment 6, giving each role its own system-prompt file costs nothing (the shared cache
block precedes the appended prompt), and **every worker carries
`--exclude-dynamic-system-prompt-sections`** — measured to raise cross-clone prefix sharing
from 72.6% to 88.4% with no loss of per-clone confinement (cache note §H).

## 4. The run directory, and where the derived plan lives

One tree per run, inside the sandbox, disposable. `CLAUDE_CONFIG_DIR` points into it, so
**the run directory is the evidence bundle** — complete, and nothing else's (Amendment 3).

```
<run-root>/
  intent.md                     the signed artifact, copied at the sha it was read at
  intent.sha
  claude/                       CLAUDE_CONFIG_DIR — every worker transcript
  clones/
    integration/                the merged tree; the wave author's cwd
    task-<id>/                  one clone per task, cut at BASE by the driver
  plans/
    wave-<n>.json               the derived plan (schema-validated)
    wave-<n>.md                 its rendered form, for the receipt and the PR body
  workers/
    <task-id>/{cmd,envelope.json,stream.jsonl}
  roles/
    {wave-author,implementer,write-side,reviewer,critic}.md   the prompt files (§3)
  receipts/
    receipt.json  gate-receipt.json  approve-receipt.json
```

**The receipt grows to carry the derivation** (Amendment 4). Six changes to today's schema —
**four additions and two re-types.** A first draft called all six "new fields"; two of them
collide by name and type with documented `report-format.md` fields, which matters because
§8a keeps that contract *verbatim in semantics*:

| field | carries |
|---|---|
| `intent.sha`, `intent.path` | what was signed |
| `waves[].planSha`, `waves[].plan` | the derived plan for that wave, inline — the receipt is self-contained, the run dir is not kept |
| `judgmentCalls[]` **(re-type, not new)** | already exists in `report-format.md:51` as `{"type":"array","items":{"type":"string"}}` with a four-kind taxonomy (`:86`). Becomes `{taskId, kind, question, readings: [a, b], taken, rationale, standingDecision?}` — #204 loudness, adjudicated at the PR. **This is a breaking change to a contract §8a lists as kept verbatim**; §8a is corrected to say so, the taxonomy's four kinds survive as `kind`, and `finalize_report.py`'s consumers move with it |
| `acceptance[]` **(re-type, not new)** | already exists in `report-format.md:24, :77` as a single object with `mode`/`passed`. Becomes an array of `{taskId, statement, evidence}`, one per signed acceptance statement, with the run-level `mode`/`passed` retained alongside |
| `admission[]` | `{waveIndex, decision, signal, counts}` — why a wave started or did not, quoting the `api_retry` counts that decided it (§5) |
| `standingDecisions[]` | which pre-authorizations were consumed, and by which ack |

A judgment call that no `## Standing decisions` entry anticipated is still taken and still
recorded — it is not a park (Amendment 4). Canary 3 measures how often the operator
overrules one.

## 4a. The process supervisor

Amendment 3's *"the driver builds itself"* list names a **process supervisor (last `result`
line, SIGTERM timeout)** and the spec had no section for it. It is small, and every rule in
it comes from a measured parity row:

- **Take the LAST `result` line.** A worker running a background subagent may emit two in
  `stream-json` (Amendment 3). Reading the first silently reports a partial run.
- **Exit classes are 0 / 1 / 143 only** — no 2, no 130 (Amendment 3's correction). Classify
  from `subtype` / `terminal_reason`, never the exit code alone:

  | observed | meaning | driver action |
  |---|---|---|
  | 0, `subtype: success` | done | take `structured_output` |
  | 0, `is_error: true` | SIGINT abort | fail the task, no retry |
  | 1, `error_max_turns` | no conforming reply inside the cap | retry with tier escalation (§8b) |
  | 1, `error_max_budget_usd` | the per-worker backstop tripped | fail the task, record, no retry |
  | 1, not-logged-in | credential | **fail the run** — never retry an auth failure |
  | **143** | SIGTERM, **no envelope at all** | retryable **once**, then fail the task |

- **Timeout.** Each worker carries a wall-clock deadline; on expiry the driver sends SIGTERM
  and gets 143 with no envelope, which is why 143 is a class rather than an error. The
  deadline is a driver constant per role, set from the first three runs' observed
  distributions — not guessed.
- **A failed task never fails the wave silently.** It lands in the receipt with its class,
  and the wave's merge proceeds on what completed; the gate reads the shortfall.

## 5. Admission control — the replacement for the deleted cap

The 500 k per-run cap and `fleet/orchestrator.mjs:214–281` are deleted (Amendment 4). Three
mechanisms replace it, all already owned:

0. **The one thing the deleted supervisor did that nothing else does: out-of-band VM
   reclamation.** `actions.destroySandbox` reaches the orchestrator's action surface at
   **exactly one site** — `orchestrator.mjs:281`, inside the spend pass this spec deletes.
   Every other destroy path is `drive.mjs`'s own teardown, which runs **inside the drive
   process**. So a drive that is killed, crashes, or dies with the orchestrator leaves a
   **billed VM alive forever**, and deleting the supervisor removes the only reaper. A first
   draft of this section said "the sandbox is still destroyed at teardown" — true, and
   incomplete in the expensive direction.

   **Replacement, and it is deliberately a liveness trigger rather than a spend one:** the
   sweep destroys a sandbox whose **claim lease has expired with no drive heartbeat**. The
   orchestrator already has claims with holders and a heartbeat timer (`orchestrator.mjs:301`),
   so this is a predicate over rows that exist, not a new subsystem. It is an addition, and
   under rule 5 it owes a deletion — it is paid for by the row it replaces, which deleted
   four behaviours (park, revoke, destroy, page) and buys back one. **The right trigger for
   destroying a VM is "nothing is using it", never "it spent too much."**

1. **What else survives of the old path, stated so it is not rediscovered:** the store's `spend`
   table stays (`store.mjs:20`) and the **#181 spend page stays observation only, never an
   action** (Amendment 4's own line). `total_cost_usd` is recorded per worker and never
   enforced against — it is a client-side estimate (Amendment 3). Deleting the supervisor
   also orphans `store.mjs:93–111`'s `opts.supervisor` / `supervisorExempt` (its only caller
   is the supervisor's revoke) and `drive.mjs:634` `revokeAndPark` / `:638` `destroySandbox`
   as action handlers; **§8a claims all three as licensed deletions** so they do not become
   the next residuals ticket.
2. **Admission observation, at two granularities — because today's control has two.**
   `waves.js` checks at eight points *inside* a wave (`:1557`, `:1776`, `:1847`, `:1956`,
   `:1971`, `:2021`, `:2105`, `:2180`), including per 16-task chunk, and defers with
   `BUDGET_DEFERRED_NOTE` rather than running to exhaustion. **0.3.0 records at both
   granularities and acts at neither**, so 0.3.1's control can be fitted to whichever
   granularity the data says matters. Recording both is the cheap half; choosing is the half
   that needs numbers.
3. **Per-worker `--max-budget-usd`** as the runaway backstop — exit 1
   `error_max_budget_usd`, clean envelope (parity R-o3/R-l9).
4. **Per-unit convergence caps** as the terminal condition for a *task* — `attempt <= 2` on
   the reconciler (`waves.js:1775`) and the resolver (`:1556`). **Note what does not
   survive:** today's run-level terminator `budgetExhausted()` (`waves.js:1838–1842`) reads
   the **Workflow runtime's `budget` global** (`:14`) at eleven checkpoints. Deleting the
   Workflow tool deletes that global. The driver's run-level terminator is the admission
   check in 1 plus the wave count — there is no third run-level cap, and this spec does not
   pretend one carries over.

**The signal, decided.** #389's verify-before-adopt is discharged by Amendment 6:
`GET /api/oauth/usage` **is** scriptable and returns `five_hour.utilization` /
`seven_day.utilization` / `resets_at` / `locked_reason` — but **the orchestrator's
`setup-token` credential is not accepted for it** (429, the endpoint's unauthenticated
shape; four controls in the note). So:

**A first draft of this section gated waves on a `rate_limit_event`. Two things killed it.**
There is no documented `rate_limit_event` type at all — what `stream-json` carries is
`system`/`api_retry`, whose `error` field takes `rate_limit` as one of its values
([headless#handle-api-retries](https://code.claude.com/docs/en/headless#handle-api-retries)) —
and parity R-o8 saw one in a **21-second, width-1 test on an account at 9% utilization**.
Retries are ordinary. A predicate that halts on the first one halts nearly every multi-wave
run at wave 1.

The second draft replaced it with a threshold calibrated from the first three runs. **The
operator rejected that too, this sitting, and the reasoning is the same one that deleted the
cap:**

> **0.3.0 ships admission control as OBSERVATION ONLY.** The driver records `api_retry`
> counts, `error` values and `retry_delay_ms` per wave into `admission[]`, and **gates
> nothing**. The control itself is built in **0.3.1**, from the data 0.3.0 collects.

Three facts make that the right trade rather than a punt:

1. **The cap it replaces never fired** in twelve runs — peak run-18 at 63%. This gates a
   problem that has not yet occurred on this account.
2. **A threshold from n=3 is the cap's own mistake with a new name.** The 500 k cap was
   licensed for deletion partly because it was *"calibrated from size means"*; shipping a
   guessed number to replace a guessed number learns nothing.
3. **The failure mode without gating is cheap and honest.** Under starvation the engine
   already records `AGENT_NULL`, skips waves and BLOCKs the gate without fabricating
   anything (`eval-cell-ops-lessons`). The cost of not gating is a slow, expensive run —
   **not a corrupt one.** That asymmetry is what makes it safe to wait for real numbers.

**0.3.0 records two meters, not one**, because they fail differently and 0.3.1 must tell
them apart:

| meter | source | status |
|---|---|---|
| **model** — the account rate window | `api_retry` events in `stream-json` | reactive proxy; the direct read (`/api/oauth/usage`) is blocked on the orchestrator's token scope |
| **substrate** — exe.dev capacity | `ssh exe.dev "billing usage --json"` + per-run `stat <vm> --range=24h` | **readable today, no credential problem** |

**Read the meter, never sum the allocation.** Summing `allocated_cpus` across VMs reports
31 against a `max_cpus` of 16 — an apparent 2× oversubscription that does not exist; the
plan meters `avg_cpu_cores`, which read **0.245**. Disk is the same trap (288 GB provisioned
vs 68.9 GB metered, against 800). At those readings exe.dev capacity is not the binding
constraint on width or on concurrent runs, and no width decision should be argued from VM
sizing without this reading first (RUNBOOK §Capacity).

**What 0.3.1 gets that 0.3.0 could not have:** a distribution of both meters' behaviour from
real multi-wave runs, so the predicate — whether that ends up being retry exhaustion, a rate
threshold, a capacity threshold, or the predictive `/api/oauth/usage` poll — is fitted to
observed pressure rather than to an estimate. The deferred credential work (below) can be scheduled against that same
release.

## 6. The intent document, and rule 7's ceiling

**Seven slots, fixed.** `## Scope` · `## Tasks` · `## Global Constraints` ·
`## Standing decisions` · `## Cadence` · `## Acceptance` · `## Out of scope`.

**A `## Tasks` entry carries: id, `Depends-on`, `Interfaces`, `Produces:`, `**Files:**`,
`tier`, and one acceptance statement.** `Files:` and `tier` are in the *signed* tier, and
the trim review is why. Two things forced it:

- **Wave shape is compiled before derivation exists.** §2 step 3 cuts one clone per task
  before any wave is derived, so the decomposition must be signed. `compile_plan.py`
  requires `**Files:**` on every implementation task (`:744`), derives write-after-write
  overlap edges from it (`:61`, `:81`, `:435`), and `--overlap serialize` turns those into
  wave-splitting edges (`:909`). If `Files:` arrived from the wave author, wave assignment
  would no longer be `compile_plan.py`'s — and §8a keeps that compiler *verbatim in
  semantics*. Signing `Files:` is what makes both statements true at once.
- **`tier` is a spend authority.** Tiers reach the loop from the plan's `tier` marker
  (`waves.js:105`, `:1011`; ladder at `:868`). Leaving it out of the signed set would hand
  per-task model choice to the wave author by omission — a new, unnamed authority over
  spend, in the same release that deletes the spend supervisor. It is signed.

**What the wave author may still refine, and only this:** `**Files:**` may be **narrowed**
inside an already-signed task (never widened, never moved between tasks — either would
change the compiled wave shape after the clones are cut), `**Commutes:**` may be declared
against that task's own Files block (`compile_plan.py:461–477`), and bodies are written.
The driver rejects a derived plan that widens `Files:` or changes any signed field.

**Each acceptance statement is operator-verifiable and carries no implementation code:** a
`do:`/`see:` example where behavior is observable, a **number or bar** where it is not.
Phase 0's own bar (864 words / 13 scripts / 11 guards / parity green) is the proof the
number-form verifies non-observable work. A task that can produce neither is the
#322/run-14 shape and the intent checker refuses it at authoring time — free, before any
spend.

**Rule 7's ceiling, proposed for operator adjudication:**

| ceiling | number | why this one |
|---|---|---|
| `## Standing decisions` entries | **≤ 8** | the accretion site rule 7 actually names; a cap is the counter-reflex with a track record |
| slot count | **exactly 7** | a new slot owes a deleted one, in the same PR |
| engine prose (`SKILL.md`) | **≤ 400 words** | pre-registered in #366; from 864 today, 3,129 before Phase 0 |
| **owned authoring skill** | **≤ 1,500 words** | replaces ultraplan 3,038 + writing-plans 1,059 + brainstorming's shape. **A release-refusing bar in 0.3.0** (operator, this sitting) — see the escape hatch below |

Each is pinned by a test, the way `test_skill_budget.py` pins SKILL.md.

**The escape hatch, and it is the reason these can be hard bars:** a ceiling is raised only
by writing the **new number and its reason into the release commit body** — the practice
established at 0.2.23. So a ceiling binds, it is visible the moment it moves, and it can
never stall a release outright. That is what makes it different from a number nobody can
meet.

**No line ceiling on code (operator decision, this sitting — amends #366 rule 5).** A draft
of this spec proposed one twice, at ≤ 6,157 and then ≤ 4,400, and both were wrong in
instructive ways: the first allowed 62% driver growth while claiming to freeze the code, and
the second was **already violated on the day it was written** (`fleet/**` = 4,476). Three
reasons it is dropped rather than fixed a third time:

1. **The evidence behind rule 5 is about prose, not code.** Its one proof is the SKILL.md
   word pin (3,129 → 864), where length *is* the harm — more steps for an LLM to sequence
   means more places to drift. A 2,354-line wave loop is not dangerous because it is 2,354
   lines.
2. **On this codebase the proxy is actively harmful.** Comments run 33–50% of the files a
   ceiling would govern (`shim-main.mjs` 50%, `drive.mjs` 36%, `orchestrator.mjs` 33%,
   `waves.js` 33%) — and here they *are* the design record: why `BASE_REF` is the fixed
   point, why four things must be true before a token is spent. Given the operator does not
   read code, that prose is how the reasoning survives at all. A line ceiling taxes it.
3. **It fails this project's own doctrine.** Incident narratives never justify guards, and a
   line ceiling is a guard on ourselves with no measured case behind it.

**What carries rule 5's intent instead** — three counts that measure things a human or an
LLM must actually hold, plus the rule that names the real enemy:

- **scripts ≤ 10** (§9) · **guards deleted ≥ 6, each with its number** (§8a) · the prose
  ceilings above;
- and §7's rule: *every guard added after go-live owes a deletion in the same PR, and a
  measured number.* The diagnosis that chartered #366 was *"each scar became another step in
  the protocol"* — accreted **guards**, which that rule names precisely and a line count
  cannot distinguish from a well-factored function.

## 7. What the driver may become

Rule 5 is the rule that keeps this from being tower #2, so it gets teeth here:

- **Every guard added after go-live owes a deletion in the same PR, and a measured number.**
  Not "a deletion eventually" — the same PR, with both the deletion and the number that
  licenses the addition named in the commit body. An incident narrative is not a number
  (`subtraction-eval-doctrine`).
- **Port, don't rewrite** (rule 3). `tests/sim_workflow.mjs`, `sim_base_ancestry.mjs`,
  `sim_derived_heads.mjs` become driver sims — same scenarios, same
  `ALL (SCENARIOS|TESTS) PASSED` sentinel. A rewrite that cannot run them is a different
  program and is out of scope. **This rule is weakest where it is most needed:**
  `ultra_run.py`, `finalize_report.py`, `warm_cache.sh` and `audit_run.py` become JS driver
  functions, which is a rewrite however §8a phrases it, and their tests are pytest. They owe
  the same treatment — behaviour-preserving, with the pytest cases ported as driver tests
  before the old scripts are deleted, not after.
- **The worker CLI version is pinned per run, and the cache env is hygienic.** The 72.6%
  shared prefix block is keyed on model and CLI version alone (cache note §C), so rolling
  the CLI or switching models mid-wave costs every later worker ~18 k tokens. The sandbox
  image pins the version; the driver records it in the receipt and refuses a wave whose
  workers would not all run the same one. The driver's worker env never carries
  `FORCE_PROMPT_CACHING_5M` or `DISABLE_PROMPT_CACHING*`, and always carries
  `--exclude-dynamic-system-prompt-sections`.

## 8. Design inputs — adopt or answer

Every row of the frozen design-inputs file. `adopted §x` / `answered: …` / `deferred → #N`.

### 8a. Deletion ledger (10 rows)

| dies | disposition |
|---|---|
| `run_lock.sh`, RUN_LOCK, "serialize runs" (#134) | **adopted** — shipped in Phase 0 (0.2.26) |
| `sweep_worktrees.sh`, wf-runs / `wf_<stamp>` / `--all`, #157's leak class | **adopted** — shipped in Phase 0; the residual prose (`waves.js:409`, `wave-merge.md`, `sim_workflow.mjs:843`) dies with the port, §10 · #386 |
| `hygiene_check.sh`, `residual_manifest.py` | **adopted** — shipped in Phase 0 |
| `salvage_args.py`, `redirect_args.py`, resume-in-place, Salvage/Redirect lanes | **adopted** — shipped in Phase 0. A redirect is a new run with a narrower intent |
| Step 4a½ registry probe, `check_engine_skew.sh`, `harness_manifest.py`, `ultrapowers-probe` | **adopted** — shipped in Phase 0; `waves.harness.json` + `test_harness_registry.py`'s manifest test die with the Workflow tool, §10 |
| baked prompts, `references/workflow-template.md`, `tests/test_no_prompt_drift.py` | **adopted §1, §3** — prompts become `roles/*.md` files the driver passes with `--append-system-prompt-file`. `reviewer-prompts.md` + `wave-merge.md` become those files rather than sources for a bake |
| #314 guard (`startHead`/`baseCorrected`, watch #354), `FOLD_LOG.md`'s ancestry precondition | **adopted §1, §2 step 3** — the driver cuts at BASE, so the guard has nothing to detect. **This closes #354 as moot** rather than by measuring its trip rate |
| NEEDS_ACK prose grammar | **adopted** — shipped in Phase 0; the schema now also expresses pre-authorized manual claims and decision classes (§6, Amendment 4) |
| `check_superpowers_compat.py`, `resolve_superpowers.py`, `superpowers_contract.py` | **adopted §8e** — all three die outright; Amendment 4 voids the *"authoring still does (HITL)"* carve-out and #390 forks the authoring path |
| `ultra_run.py`, `finalize_report.py`, `warm_cache.sh`, `audit_run.py` | **adopted §1** — absorbed into the driver as functions. Their tests move to driver tests, they do not vanish |
| `review-package` *(not in the frozen ledger — added by this spec, with its number)* | **adopted §1** — it exists only to bridge **linked worktrees**: its header says *"implementer and reviewer run in DIFFERENT linked worktrees, so the packet must live somewhere both can see"*, and it derives that shared path from `--git-common-dir`. The driver gives each worker an **independent clone at BASE** and owns the run dir, so the derivation is dead and the remaining work is three git commands the driver runs itself, writing to `<run>/workers/<task-id>/`. `tests/test_review_package.py` follows it |

**Kept, verbatim in semantics:** `compile_plan.py` (+ `--check --renders`), the fold kernel
+ `fold_wave.py`, `gate_check.py`/`ultra_gate.py` as library functions,
`run_acceptance.sh`'s suite-gate half, `validate_skill.py`, the store (#308), `ultralearn`.

**Corrected from "kept verbatim": `report-format.md`.** §4 re-types two of its documented
fields — `judgmentCalls[]` (string array → objects, `:51`) and `acceptance` (object →
array, `:24`/`:77`). That is a contract change, and calling it "six new receipt fields"
concealed it. The four-kind taxonomy (`:86`) survives as the `kind` field; the schema and
`finalize_report.py`'s consumers move together, in the same PR.

**Changed from kept:** `readSessionTokens` + the spend cap (deleted, §8d); the store's
`budgets` table (deleted, §8d).

**`waves.js`'s own budget object — a ledger row this spec adds, with its number.** Not in
the frozen ledger, not in "kept verbatim", and distinct from `orchestrator.mjs`'s spend
supervisor: `budgetExhausted()` (`waves.js:1838–1842`) reads the **Workflow runtime's
`budget` global** (`:14`), and eight checkpoints defer work against it — `:1557` (conflict
resolution), `:1776` (each reconciliation attempt), `:1847` (before setup), `:1956`,
`:1971`, `:2021`, `:2105`, `:2180` — pushing `BUDGET_DEFERRED_NOTE` (`:181`,
*"budget exhausted mid-run — remaining work deferred to unfinished"*) into `judgmentCalls`.

**Licensed by:** the `budget` global is the Workflow runtime's, so it dies with the tool —
there is no choice about the mechanism. **But the behaviour is not free to drop**, and §5
must carry it (see §5): those checkpoints fire **mid-wave**, including per 16-task chunk,
while §5's admission control is specified at wave boundaries only. A wave that runs out of
room at task 9 of 16 defers honestly today and would run to exhaustion under a
boundary-only design. §5 now specifies both.

**Deletions the cap removal cascades — claimed here so they are not rediscovered** (the
#386 pattern): `store.mjs:93–111`'s `opts.supervisor` / `supervisorExempt`, whose only
caller is the supervisor's revoke; `drive.mjs:634` `revokeAndPark` and `:638`
`destroySandbox` as **action handlers** (the sandbox is still destroyed at teardown — what
dies is the spend-triggered path).

**Script count:** 13 today → **6** (`compile_plan.py`, `gate_check.py`, `ultra_gate.py`,
`run_acceptance.sh`, `validate_skill.py`, + the new intent checker). Eight deleted, one
added. Bar is ≤ 10.

**Guards deleted, counted honestly for THIS release.** A first draft wrote *"11 in Phase 0 +
4 here — bar is ≥ 6"*, which double-counts: Phase 0 already cleared the map's ≥ 6 on its own
(11), and 4 < 6, so this release failed its own restated bar on its face. **Phase 0's 11 do
not count toward 0.3.0.** This release deletes **six**, each with its licensing number:

| # | guard | licensed by |
|---|---|---|
| 1 | the #314 base-ancestry guard (`startHead`/`baseCorrected`) + watch #354 | the driver cuts at BASE; the condition is inexpressible |
| 2 | the spend-cap supervisor (`orchestrator.mjs:214–281`) | never fired; peak 63%; post-hoc and destructive |
| 3 | the #322 dispatch-time fitness preflight | the intent checker refuses at authoring, free, before spend |
| 4 | the three superpowers-compat scripts (one guard, three files) | the engine never touches superpowers |
| 5 | `store.mjs:93–111` `supervisor`/`supervisorExempt` | orphaned by 2 — its only caller was the revoke |
| 6 | `drive.mjs:634/:638` `revokeAndPark`/`destroySandbox` **as action handlers** | orphaned by 2; teardown still destroys the sandbox |

Six, with numbers, without borrowing Phase 0's.

### 8b. Harness mechanics (12 rows, as corrected by Amendment 3)

| mechanic | disposition |
|---|---|
| Structured worker replies | **adopted §3, as corrected** — the harness retries in-loop with a `[structured-output-enforce]` nudge and bounces schema violations to the model as tool errors; the fail-closed envelope is `subtype: error_max_turns` / exit 1 / `structured_output: null`. The driver's retry-with-escalation wraps a harness that already retried |
| Role isolation, enforced not prompted | **adopted §3** — four flag-sets, `PreToolUse` hook via `--settings`. #315's stash ban becomes a denied tool |
| Per-worker knobs | **adopted §3** — `--model`, `--effort`, `--fallback-model`, `--max-turns`, `--max-budget-usd` |
| Spend from the result | **adopted, as corrected** — **sum `modelUsage`**, not top-level `usage` (last API call only). `readSessionTokens` and #209's transcript coupling retire. `total_cost_usd` is a client-side estimate and is recorded, never enforced against |
| Isolated sessions per worker | **adopted §4** — distinct `--session-id`, per-run `CLAUDE_CONFIG_DIR` (+ `CLAUDE_CODE_PROJECT_DIR_NAME`, 2.1.234+, on the golden's 2.1.238). The run dir is the evidence bundle; #350's golden-prune chore is moot |
| Fix rounds resume, not restart | **adopted §2 step 5 — and the pre-registered measurement is discharged, not carried.** Amendment 6 measured it: `--resume` is **3.1× cheaper** than a fresh dispatch, at 2 s and at 11 min alike. Amendment 3's n=1 "resume 1.7× fresh, the cache had partly expired" is reversed and its explanation falsified. Driver closes worker stdin (`</dev/null`) |
| Prompt files, no bake | **adopted with the Amendment 3 substitute** — **`--bare` is a blocker**: it refuses subscription OAuth on 2.1.238 and 2.1.250. Ships as `--setting-sources user --disable-slash-commands` + per-run `CLAUDE_CONFIG_DIR`, which achieves the row's intent (no session_start hook, no superpowers, no stray skills, `--json-schema` + `--append-system-prompt-file` honored). **#384 stays open** as the watch: the day `-p` defaults to bare, workers need an explicit non-bare flag or the fleet's auth route breaks |
| Worker-side subagents, bounded | **adopted** — `--agents`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` / `_SPAWN_DEPTH`. `subagent_stats.refused.*` exposes cap trips. In stream-json a background subagent may emit **two** `result` lines — take the last |
| Failure classes | **adopted, as corrected** — observed exits are **0 / 1 / 143** only (no 2, no 130). Classify from `subtype` / `terminal_reason`, never the exit code alone. `api_retry` cited, not reproduced |
| Live progress into the store | **adopted §4** — `stream-json` tool-use events piped into TinyBase rows; this is also where `rate_limit_event` is read for §5. Replaces the shim's 5-minute spend ticks |
| Agent SDK as the upgrade path | **answered: not now.** CLI first — shell-debuggable, zero deps, and the docs' policy note (third parties may not offer claude.ai login for SDK-built products) makes it the policy-safe path. Trigger for revisiting: a synchronous `canUseTool` decision a hook cannot express |
| Plugin CI (`claude plugin eval`) | **deferred → #390** — it regression-tests the thin client's skills, which is the client half's surface, not the engine's |

| *(Amendment 3, "the driver builds itself")* process supervisor — last `result` line, SIGTERM timeout | **adopted §4a** — absent from a first draft entirely; the trim review caught it. §4a carries the exit-class table, the last-`result`-line rule, and the per-role deadline |
| *(Amendment 3, same list)* three role flag-sets as data | **adopted §3, corrected to six rows** — Amendment 4 made the flag-sets four; the *role inventory* is seven in `waves.js`, three of which write to the integration worktree (`:232–235`). A four-row table could not express merge / reconcile / resolver |

**Amendment 3's packing rule:** **adopted §2 step 5** — one wave per sandbox, width ≤ 4,
spilling to a second sandbox only above the cap. Amendment 6 confirms nothing about the
cache argues otherwise (§8f).

### 8c. Amendment 1 — the laptop is a thin client

| row | disposition |
|---|---|
| No local execution substrate at all | **adopted §2** — the laptop authors, launches, observes, approves. Unit tests and sims stay local; the acceptance suite never does |
| Decision 5 — the orchestrator opens the PR | **adopted §2 step 9** — shipped already (#368, 0.2.26). Parks publish as draft PRs |
| Decision 6 — product statement | **deferred → #390** — README + marketplace wording is the client half's |
| Ledger additions (local driver path, #134 hazard, #250, local SKILL Steps 1–6, RUNBOOK laptop steps) | **adopted** — shipped in Phase 0 |
| #364 superseded and closed | **adopted** — no local sandbox to measure |
| Bar addition — laptop resident footprint ≈ 0 during a width-3 drain | **adopted §9** — measured once in the cutover PR (RSS + disk delta) |

### 8d. Amendment 4 — the plan shape

| row | disposition |
|---|---|
| Three tiers: signed / in-loop planning / building | **adopted §2, §3, §6** |
| No verbatim implementation code; one operator-verifiable acceptance statement per task | **adopted §6**; enforced by the intent checker, not by prose |
| No new mid-run human contact; forks are recorded judgment calls | **adopted §4** — `judgment/` + `receipt.judgmentCalls[]`, adjudicated at the PR |
| One gate per run, unchanged | **adopted §2 step 8** |
| NEEDS_ACK schema expands to manual claims + decision classes | **adopted §6** |
| The three superpowers-compat scripts die outright | **adopted §8a** |
| `readSessionTokens` + spend cap deleted | **adopted §5** — with `fleet/orchestrator.mjs:214–281`, the `budgets` table, `remaining`/`mayEnqueueSpend`, and the `capTokens` plumbing through `drive.mjs` / `drive-one.mjs` / `shim.mjs` |
| Store: `budgets` goes; new rows for admission decisions and judgment calls | **adopted §4, §5** |
| `compile_plan.py` gains the intent-checker sibling; `--renders` runs against real code at derivation time | **adopted §6, §2 step 4** |
| Role flag-sets become **four** | **adopted §3** — the wave author is specified there |
| The laptop authors intent; the fleet authors plans | **adopted §2** |
| #382 gains the between-waves cache-decay input | **adopted §8f** — measured: it costs nothing |
| Manual acks pre-authorized; parks → 0 in the observed record | **adopted §6**. The gate is untouched; the class becomes unpopulated at the authoring layer. **The periphery freeze holds** |
| `**Commutes:**` moves to the derivation tier and stays | **adopted §2 step 4, §6** — declared by the wave author against the task's own signed `Files:` block. #242(c)'s retirement trigger has not fired; run-20 produced the first real `autoResolved: 1` |
| *"The #181 spend page stays as observation only, never an action"* | **adopted §5 item 0** — the `spend` table survives, `total_cost_usd` is recorded and never enforced against, and the page never acts. Absent from a first draft of §8; the trim review caught it |
| *"the question bank is drawn from the ultralearn ledger and the redirect corpus, never invented"* | **adopted §6** — the provenance rule is stated with the slot, not left to #390. §6 exists so #389 and #390 cannot drift, and a first draft let exactly that happen |
| Rule 7 — the intent doc's schema is ceilinged | **adopted §6**, with numbers proposed for adjudication |
| Canaries 1–3 | **adopted §9** |
| Bar, restated (6 rows) | **adopted §9** |

### 8e. Amendment 5 — "extends, does not fork" is lifted

**#390 ships INSIDE 0.3.0** (decided this sitting). A draft of this spec deferred it beside
the release; that was wrong, and the reason is a coupling rather than a preference: **the
driver consumes an intent document, and the only thing that produces one is #390.** An
engine released first would have a derived-plan pipeline whose input artifact has no
authoring tool — the front and back halves of one release disagreeing. The counter-argument
that carried the deferral was a license review of unknown length; **superpowers is MIT**
(© 2025 Jesse Vincent), which permits modify/merge/publish/sublicense with an attribution
notice, so that work is minutes and does not gate anything.

| row | disposition |
|---|---|
| One owned authoring skill (brainstorming + writing-plans + ultraplan collapse) | **adopted, in 0.3.0.** Schema in §6 so the two halves cannot drift; ceiling ≤ 1,500 words, release-refusing (§9) |
| Drop the seven practice skills, do not vendor | **adopted, in 0.3.0** — 10,054 words dropped as dependencies, none copied |
| mattpocock skills uncoupled | **adopted** — available to operator sessions, required by nothing in the pipeline |
| One precedence line in `hooks/session_start.sh` | **adopted, in 0.3.0** — see below |
| Word ceiling pinned by a test | **adopted §6, §9** — enforced in this release |
| Retire the three compat scripts | **adopted §8a** |
| Check the license before shipping derived prose | **adopted §10** — MIT; ship the copyright and permission notice with the derived prose. Not a gate |

**Superpowers stays installed on the operator's machine** (decided this sitting). Dropping
the *dependency* does not stop superpowers running: its `SessionStart` hook fires from the
user's own install, wrapped in `<EXTREMELY_IMPORTANT>`, with a routing table that names
`superpowers:brainstorming` by hand. Uninstalling would fix that and cost the operator
10,054 words of practice skills they use **outside** ultrapowers. So the residual is handled
by one precedence line in our existing hook, leaning on superpowers' own documented rule
(*"User instructions … take precedence over skills"*), declaring that the ultrapowers
authoring skill owns the plan-authoring pipeline. **No new mechanism.** If that measurably
fails in practice, *then* there is a case for something heavier — not before.
| CLAUDE.md's own standing rule (*"extends, does not fork"*) | **adopted §10 step 4** — the rule is already marked lifted in CLAUDE.md (PR #391); the **text is deleted** in the 0.3.0 release commit, alongside the engine-path deletions. A first draft assigned it to nobody |

### 8f. Amendment 6 — #382 measured

| row | disposition |
|---|---|
| Cross-process prefix sharing holds completely | **adopted §9** (cost row) |
| `-p` writes the 1 h breakpoint by default | **adopted** — no `subagentPromptCacheTtl` analogue is built |
| The 72.6% block is keyed on model + CLI version alone | **adopted §3 and §7 bullet 5** — per-role prompt files are free. A first draft marked this adopted against a §7 that contained no such pin; §7 now carries it explicitly |
| Wave-boundary gap costs nothing (6 min, 11 min → 100%) | **adopted §2 step 4** — the serial authoring pass is priced on its own tokens; no overlap of authoring with execution to protect a cache |
| Fix rounds `--resume`, 3.1× cheaper | **adopted §2 step 5, §8b** |
| Cost: cold wave of 3 avoids 72.6% of prefix write cost | **adopted §9** |
| The Workflow arm is not reconstructable | **answered:** the gate-parity row (§9) compares wave shape and gate verdict, not tokens, precisely because the old engine cannot report per-agent tokens. The cost row is measured on the **new** engine against the recorded run-13…23 ledger totals |
| Do not contort the design for B2 (shared `cwd`) | **adopted §3, and superseded in the driver's favour** — cache note §H measured `--exclude-dynamic-system-prompt-sections`, which raises cross-clone sharing 72.6% → **88.4%** and cuts per-worker prefix creation 58% while every worker keeps its own clone. Every worker carries the flag; the shared-`cwd` contortion stays rejected because it is no longer the only way to buy B2 |
| *(new, cache note §I)* TTL settings are below the golden's floor and unneeded | **answered:** `promptCacheTtl` / `subagentPromptCacheTtl` need 2.1.242+, the orchestrator runs 2.1.238, and the default is already the 1 h we want. What the driver owes is the **negative**: never set `FORCE_PROMPT_CACHING_5M=1`, never let `DISABLE_PROMPT_CACHING*` reach a worker's env. §7 bullet 5 |
| *(new, cache note §I)* Workers move from the 5-min bucket to the 1-h one | **adopted §9** — a workflow agent's requests fall outside the main-conversation TTL bucket (5 min by the docs, *including on a subscription*); making each worker a main conversation moves it to 1 h. A second, independent reason the driver's cache position beats the engine it replaces |

## 9. The bar, and the canaries

Every number goes into the cutover release commit. **The release is refused without them.**

| measure | today | bar |
|---|---|---|
| engine prose | 864 words (`SKILL.md`) | **≤ 400** |
| owned authoring skill | 3,038 (ultraplan) + 1,059 (writing-plans) | **≤ 1,500 — a release-refusing bar in 0.3.0**, since #390 now ships inside it. Raisable only by stating the new number and its reason in the release commit body (§6) |
| intent-doc schema | — | **exactly 7 slots, ≤ 8 standing decisions** |
| scripts under `skills/ultrapowers/scripts/` | 13 | **≤ 10** (projected 6, §8a) |
| guards deleted, each with a licensing number | 11 shipped in Phase 0, **not counted here** | **≥ 6 in this release** (six named in §8a) |
| gate parity | — | on the **10 fixtures carrying a `plan.md`** (chained, contend, contend-big, contend-prod, degrade, flawed, flawed-routing, mixed, webapp, wide; `jsdeps` has none), the derived plan's **wave shape and gate verdict** equal the old engine's authored plan for the same intent. See the three caveats below — this row is weaker than it looks and the spec says so |
| live parity | — | **≥ 3 fleet runs green**, one at width ≥ 2, with `reported == ledger` and all five §W1d legs |
| cost | runs 13–23 ledger | **tokens per merged task ≤ 1.15×** |
| parks per run | 3 across runs 18–23, all `deferred:manual` | **0** |


**Three caveats on gate parity, none of which a first draft stated.**

1. **The intent docs are back-formed from the answer.** Each fixture already has an authored
   `plan.md`; an intent doc written by reading it, then compared for equal wave shape, tests
   the compiler round-trip and not the design. Mitigation, and it is partial: the intent docs
   are written **before** the wave author exists, by a pass that records which fields it took
   from the plan and which it had to invent. Parity on a back-formed intent is a *necessary*
   condition, never a sufficient one.
2. **Where it runs is not free.** 10 signed intents plus 10 derivations are LLM runs, and
   Amendment 1 forbids local execution — so gate parity runs **on the fleet**, not the
   laptop. `evals/ab_runner.py` drives `/ultrapowers` **locally** by design (its docstring:
   *"concurrent /ultrapowers runs corrupt each other's checkouts"*), which Phase 0 already
   recorded as a local substrate dead under Amendment 1 and **deferred re-arming to this
   port** (Phase 0 spec row 7). **This spec inherits that obligation:** re-arming
   `ab_runner` on the driver is in-scope build work for 0.3.0, not a follow-up, and the
   gate-parity row cannot be reported until it lands.
3. **Wave 1 has no derived plan** (§2 step 4), so on a single-wave fixture the row compares
   the signed task set against the authored plan — a compiler test. The fixtures that carry
   the real signal are the multi-wave ones.

**On the cost row, stated plainly because a bar one expects to fail is not a bar:** this
design **does not pay for itself in tokens.** It saves ≈ 38–100 k/run in prevented do-overs
and spends ≈ 40–150 k/run authoring waves — a wash, plausibly negative. The 1.15× is a
deliberate pre-registered admission. What it buys is the deletion of a defect class (all six
defects in runs 18–23 were in verbatim plan bodies), spend moved off the operator's shared
window, and attention moved to statements the operator can actually adjudicate. Amendment 6
moves this row toward the driver — ~73% of every worker's prefix is a cache read by
construction, 88.4% with the dynamic-sections flag — but not far enough to change the claim.
**Never sell this on tokens.**

**And the comparison arm is weak, which the trim review is right to press on.** §8f concedes
the Workflow arm is not reconstructable, so the baseline is the recorded run-13…23 ledger —
*different work*, on runs whose totals include orchestrator-LLM spend the new engine does
not pay at all (#366: *"an orchestrator LLM no longer spends anything"*). That credits the
driver for a saving unrelated to the design. Three conditions, pre-registered, or the row is
not a measurement:

1. **n is stated before the runs are driven** — the same ≥ 3 runs as the live-parity row, on
   named fixtures, chosen before anyone sees a number.
2. **The baseline is stated net of orchestrator spend**, or the comparison is reported both
   ways and the honest one leads.
3. **The denominator is fixed in advance.** "Per merged task" was chosen because task counts
   move between runs — which also makes it a free parameter. Merged task = a task whose diff
   is in the integration branch at the gate, counted from the receipt, not from the plan.

**Canaries (pre-registered).** Map #238's *"plan-caused redirect rounds → ~0"* is rejected
as unfalsifiable: it goes to zero by construction once plans carry no bodies. The taxonomy
splits into **contract-caused** (the signed artifact was wrong) and **derivation-caused**
(the wave author wrote a bad body against real code).

| # | canary | baseline | bar |
|---|---|---|---|
| 1 | redirect rounds per task, all causes | 0.57 (29/51) | ≤ 0.57, no regression |
| 2 | derivation-caused rounds per task | 0.33 equivalent | **≤ 0.15** |

| 3 | judgment calls overturned by the operator at the PR | new | **≤ 1 in 5**; worse → that fork class reverts to parking |

**Who classifies a round into contract-caused vs derivation-caused, and how** — canary 2 is
measured on this split, and a canary whose measurement procedure is unstated is not
pre-registered. **The reviewer that raised the round writes the cause into its own finding**,
choosing between: *contract* (the signed artifact was wrong — a bad acceptance statement,
a missing edge, wrong `Files:`) and *derivation* (the signed artifact was right and the wave
author's body was wrong against real code). Ties go to **contract**, so the canary the design
is trying to protect never scores itself favourably by ambiguity. The classification is a
receipt field, so #220's by-cause-by-engineVersion rate stays computable.

## 10. Cutover

0.3.0 is one release and it is large by decision, not by drift. What is in it:

| half | contents |
|---|---|
| **engine** | the `waves.js` port into the driver; the deletion ledger (§8a); the process supervisor (§4a); admission **observation** (§5); the claim-lease reaper; `ab_runner` re-armed on the driver |
| **client** | the merged authoring skill ≤ 1,500 words; `ultraplan` deleted; the seven practice skills dropped; the precedence line in `hooks/session_start.sh`; CLAUDE.md's *"extends, does not fork"* text deleted; README + marketplace wording (Amendment 1 decision 6); **`ultradocket`'s sweep reworked to emit intent docs** |

**`ultradocket` is in the release** (operator decision, this sitting, against the
recommendation to defer it). The reasoning is completeness: after the cutover **no tool
anywhere should still emit the old artifact**. Its drain half sweeps issues into plans; the
driver now consumes intent. Leaving it would mean shipping one tool that produces something
nothing can read. Its triage half is unchanged.

Steps:

1. Build on branch `one-driver`. The old path is untouched until the new one clears §9.
2. The existing sims must pass against the driver (rule 3): `sim_workflow.mjs`,
   `sim_base_ancestry.mjs`, `sim_derived_heads.mjs`, same `ALL (SCENARIOS|TESTS) PASSED`
   sentinel. The suite-gate's harness-JS leg follows the code to its new home.
3. Ship the copyright and permission notice with any prose derived from superpowers (MIT).
4. Validate with fleet runs — the fleet is both vehicle and first customer.
5. **One release, 0.3.0**, deleting the old path in the same release, with every §9 number
   in the release commit. The operator's explicit override of "stay on 0.2.x."
6. **#386 closes at this release** — each residual line deleted or explicitly kept,
   including the stale prose naming deleted scripts, `waves.harness.json`, the ultradocket
   `Seal` field, and the execution-handoff rubric's Inline/Subagent-Driven options.
7. **#354 closes as moot** (§8a); **#384 stays open** as a watch (§8b); **#390 closes with
   this release**, not beside it.
8. Then map **#360 Tier 1** lands on the simplified base.

**Named risk, since the release grew by decision:** this now carries the port, the cutover,
`ab_runner` re-arming, 10 intent docs, ≥ 3 validating fleet runs, an authoring-skill fork,
seven dropped skills and an ultradocket rework. The mitigation is not to trim scope — the
operator chose it — but to **land it in reviewable pieces on one branch**, engine and client
independently green, with the release commit as the only integration point.

## 11. Out of scope

- **The merge kernel.** Map #360 owns it. This spec ports `fold_wave.py` and the
  reconciliation semantics unchanged and touches neither `kernel/vendor/manyana.py` nor the
  layering rule (*Manyana merges values, TinyBase coordinates the index*).
- **The verification periphery.** `gate_check.py`, `ultra_gate.py`, `run_acceptance.sh` and
  the compiler's diagnostic vocabulary move house without changing behavior. The one thing
  that changes — manual acks being discharged by pre-authorization — happens at the
  *authoring* layer, leaving the gate's logic untouched (§8d).
- **Re-drive reuse** (#383) — after cutover, on the driver.
- **Admission control itself** (§5) — 0.3.0 observes and records; **0.3.1 builds the gate**
  from that data, and can schedule the profile-scoped credential for the predictive
  `/api/oauth/usage` signal against the same release.
- **`claude plugin eval`** — gates the **client** surface, built with the authoring skill.
  The engine's gate is the three sims, the fixture corpus, the gate itself and ≥ 3 live
  fleet runs; after cutover the engine's skill surface is ~400 words, which leaves plugin
  eval little to test there.

## Trim review

**Author's Adds/Removes disclosure** (input to the reviewer, not a verdict — the author
does not grade their own design):

*Adds:* a fourth worker role (the wave author, §3) · a second signed artifact and the
intent-doc ↔ derived-plan seam (§6) · `plans/` and `judgment/` in the run dir, and six new
receipt fields (§4) · one script, the intent checker (§8a) · six ceiling numbers pinned by
tests (§6) · wave-boundary admission control (§5) · a new failure mode, *a plan can be
derived wrong* (canary 2 exists for it) · maintenance of a forked authoring skill (#390).

*Removes:* the Workflow-tool coupling entirely — `waves.js`, `waves.harness.json`,
`workflow-template.md`, `test_no_prompt_drift.py`, the bake ritual, the registry probe ·
eight scripts deleted against one added (13 → 6) · four more guards with licensing numbers: the #314 base-ancestry
guard (**#354 closes as moot**), the spend-cap supervisor, the #322 fitness preflight, the
three superpowers-compat scripts · the 500 k cap with `orchestrator.mjs:214–281`, the
`budgets` table and the `capTokens` plumbing · `readSessionTokens` and #209's transcript
coupling · verbatim implementation code from plans — the source of 6/6 defects in runs
18–23 · parks (3 → 0 in the observed record) · four prose↔code seams against one added.

**Reviewer's verdicts.** One fresh-context reviewer, dispatched 2026-08-28 per
`skills/ultralearn/references/distilling-proposals.md` §Trim review, grounded in the spec,
#389, #366, the frozen inputs, the supporting measurements, and the code. It found real
defects — including one verifiably false cross-reference and one predicate that would have
halted nearly every run. A **second reviewer was spawned in error** (the first appeared idle
when it was working), stood down, and returned findings anyway; four were new and are
recorded below as **R2**. Both are credited. **Adopt-or-answer for every finding, rejections
visible:**

### Trims

| # | trim | disposition |
|---|---|---|
| 1 | narrow the wave author to waves ≥ 2 — at wave 1 `clones/integration` *is* BASE, so the author is a pure extra LLM hop | **ADOPTED** (§2 step 4). The reviewer is right that §3's own justification was false at wave 1. Takes the authoring pass off every single-wave run |
| 2 | delete the ≤ 900-word intent-doc ceiling; keep the slot count and the ≤ 8 cap | **ADOPTED** (§6). Rule 7's named target is `## Standing decisions`, which the other two close |
| 3 | merge `judgment/*.json` into the receipt; do not create the directory | **ADOPTED** (§4). The same argument that inlines `waves[].plan` applies |
| 4 | delete the "laptop resident footprint ≈ 0" bar row — it cannot come out any other way | **ADOPTED** (§9). Amendment 1 asked for it while a local facsimile substrate was live, then deleted that substrate. It restated the architecture instead of testing it |
| 5 | merge §7 bullets 1 and 2 — one rule stated twice | **ADOPTED** (§7) |
| 6 | §5's mechanism 3 does not survive the port: `budgetExhausted()` reads the Workflow runtime's `budget` global | **ADOPTED** (§5). Verified at `waves.js:14, 1838–1842`. What carries over is `attempt <= 2` per-unit caps, not a run terminator, and §5 now says so |
| 7 | stop counting Phase 0's 11 guards toward this release's bar — and 4 < "≥ 6" fails on its face | **ADOPTED** (§8a, §9). Six named for this release, each with its number, none borrowed |
| 8 | claim the deletions the spend-cap removal cascades (`store.mjs:93–111`, `drive.mjs:634/:638`) | **ADOPTED** (§8a, §5 item 0). Also supplies two of the six in trim 7 |
| 9 | drop the ≤ 1,500-word authoring-skill row from *this* release's refusing bar | **ADOPTED** (§9, §11). A number enforced in #390 must not refuse 0.3.0; it stays stated so the two cannot drift |

### Under-specification

| # | finding | disposition |
|---|---|---|
| 1 | §5's `rate_limit_event` predicate is contradicted by its own citation — R-o8 saw one in a 21 s width-1 test at 9% utilization; as written it halts every run at wave 1 | **ADOPTED, section rewritten** (§5). The reviewer is also right that no such event type is documented: it is `system`/`api_retry` with `error: "rate_limit"`. Now a two-clause predicate (retry *exhaustion*, or a rate-plus-delay threshold set from the first three runs), with an explicit fallback to observation-only if no threshold separates ordinary retries from pressure |
| 2 | §3's four-row table cannot express merge / reconcile / resolver, which write to the integration worktree | **ADOPTED** (§3). Verified at `waves.js:232–235` and the dispatch sites. Table is five rows covering all seven roles, grouped by writable root |
| 3 | the ported critic loses `git checkout --detach`, which releases the branch `ultra_gate.py --approve` needs | **ADOPTED** (§3). Verified at `waves.js:373–376` and `:619–630`. This one weakened a receipt, which rule 1 forbids — the best catch in the review |
| 4 | `--add-dir` is unexercised; the Bash-write predicate is unspecifiable; `git diff --output=` is an open escape | **ADOPTED with a named limit** (§3). `--add-dir` becomes a build-blocking repro. The Bash denial is a closed denylist of write-capable git forms, not a general predicate — stated as a narrowing, with the hook as boundary and the sandbox as backstop |
| 5 | wave shape is compiled from `Files:` the intent doc does not carry | **ADOPTED** (§6). `Files:` is signed; the wave author may only *narrow* it. Resolves the contradiction with keeping `compile_plan.py` verbatim |
| 6 | per-task `tier` has no source — a spend authority granted by omission | **ADOPTED** (§6). `tier` is signed |
| 7 | §5 removes destructive authority without saying what remains | **ADOPTED** (§5 item 0) |
| 8 | the store's new rows are adopted and never specified | **PARTLY ANSWERED.** §4/§5 now name what they hold (`admission[]` with counts; judgment calls). The row *shapes* and their legal transitions against `store.mjs:30–39` are **deferred to the plan** — schema work the spec should not invent ahead of the port |
| 9 | §4's receipt collides with `report-format.md`: two of "six new fields" are re-types | **ADOPTED** (§4, §8a). `report-format.md` moves out of "kept verbatim" and the change is disclosed as four additions plus two re-types |
| 10 | the process supervisor is unspecified | **ADOPTED — new §4a**, carrying the exit-class table, the last-`result`-line rule, and per-role deadlines |
| 11 | surviving park classes are never enumerated | **ANSWERED, deliberately not enumerated here.** Amendment 4 fixes them (irreversible/destructive, credentials/security, admission refusal) and §9 sets the *observed* rate to 0 — a prediction about the corpus, not a claim that parks are impossible. §2 step 9 keeps the draft-PR path because the classes still exist |
| 12 | gate parity's venue is unstated and `ab_runner` is local-by-design, dead under Amendment 1 | **ADOPTED** (§9 caveat 2). Verified against the Phase 0 spec's row 7, which deferred re-arming to this port. Now in-scope build work for 0.3.0 |
| 13 | the parity intent docs are back-formed from the answer | **ADOPTED as a stated limit** (§9 caveat 1). Cannot be fully cured — recorded as a necessary, not sufficient, condition, with the mitigation named |

### Scope expansions

| # | expansion | disposition |
|---|---|---|
| 1 | six ceilings where #389 asked for three | **PARTLY ADOPTED** — now five, and one (the authoring skill) is #390's to enforce. Rule 7 explicitly asks for a slot count *and* a standing-decisions cap, so two of the three are its own text |
| 2 | the combined-line ceiling permits +2,354 lines of driver growth and excludes what the port creates | **ADOPTED, and the ceiling is now DELETED entirely** (§6). Both reviewers were right and a third attempt would have been wrong too: the operator dropped the line ceiling this sitting, amending #366 rule 5. Rule 5's intent carries in the prose ceilings, scripts ≤ 10, guards ≥ 6, and §7's guard-deletion rule — which names accreted guards precisely, where a line count cannot tell a guard from a well-factored function |
| 3 | the wave author gains scheduling and spend authority by omission | **ADOPTED** (§6) — `Files:` and `tier` signed; the author may only narrow |
| 4 | the run-directory layout as a specified artifact | **ANSWERED, kept.** The handoff named "where the derived plan lives and how the receipt carries it" as a question the spec must settle; a layout is the answer. `judgment/` is deleted (trim 3) and `roles/` added, which is the port's own surface |
| 5 | `admission[]` and `standingDecisions[]` beyond Amendment 4's four | **ADOPTED as disclosure** (§4) — six changes, four additions and two re-types, stated as such |
| 6 | deferring `claude plugin eval` to #390 | **ANSWERED** — it tests the client's skills; it is Open question 3 for the operator |
| 7 | canary 2's taxonomy is load-bearing with no stated classifier | **ADOPTED** (§9) — the reviewer that raises the round classifies it, ties go to *contract* so the canary cannot flatter itself |

### R2 — the second reviewer's independent findings

| # | finding | disposition |
|---|---|---|
| R2-1 | **`waves.js`'s own budget object is undispositioned in §8** — `budgetExhausted()` (`:1838`), `BUDGET_DEFERRED_NOTE` (`:181`), and **eight** deferral checkpoints, distinct from `orchestrator.mjs`'s supervisor | **ADOPTED — new ledger row in §8a, and §5 changed.** The sharper half is behavioural: those checkpoints fire **mid-wave**, including per 16-task chunk, while §5 was specified at wave boundaries only. A wave running out of room at task 9 of 16 defers honestly today and would have run to exhaustion under the spec as written. §5 now specifies both granularities |
| R2-2 | **§5 deletes the only out-of-band VM reclamation.** `actions.destroySandbox` reaches the orchestrator's action surface at exactly one site — `orchestrator.mjs:281`, inside the deleted spend pass; every other destroy is `drive.mjs`'s teardown, **inside the drive process** | **ADOPTED — §5 item 0 rewritten.** A killed or crashed drive would have left a billed VM alive forever. Replaced by a **claim-lease reaper** over rows that already exist (claims have holders; `orchestrator.mjs:301` has the heartbeat). Deliberately a *liveness* trigger: the right reason to destroy a VM is "nothing is using it", never "it spent too much" |
| R2-3 | **The line ceiling is already stale and, as written, already violated.** `fleet/*.mjs` is **3,818** on main (PR #393 added 15 this sitting), and `fleet/**` — the glob the spec actually wrote — is **4,476**, above the ≤ 4,400 bar | **ADOPTED, and it ended the ceiling.** The finding that a bar failed on the day it was written is what prompted the operator to drop the line ceiling outright rather than let a third draft try again (§6). The two failed drafts are kept in §6 as the argument |
| R2-4 | **The wave author's "may not add or remove tasks" has no enforcement** — `--json-schema` validates shape, not identity against `intent.sha` | **ADOPTED** (§2 step 4). The driver diffs the derived plan against the signed set by identity: equal id sets, byte-identical edges / `Interfaces` / `tier` / acceptance statements, `Files:` a subset. A mismatch is a failed derivation, retried once with the diff quoted, then parked. This is why `intent.sha` is in the receipt |

**Rejected: none, from either reviewer.** Every finding was adopted, adopted with a named
limit, or answered; two (under-spec 8, 11) are answered rather than implemented, with the
reason given.

### `netConceptDelta`, graded by the reviewer: **`flat`**

The reviewer's justification, which the author accepts: the code removals are real and large,
and removing verbatim implementation bodies deletes a defect class rather than guarding it —
but the *standing-concept* ledger is not the code ledger, and what a reader must newly hold
(intent doc, standing decisions and their consumption protocol, judgment calls as objects,
the derived plan as a second artifact with its own failure mode, the wave author, admission
control, the ceilings, the canaries and the cause taxonomy) offsets it. Two things keep it
from `down`: the largest single concept deletion — collapsing three authoring skills into one
and dropping seven — is **deferred to #390**, so this spec spends the additions now and books
the subtraction elsewhere; and five of the ten deletion-ledger rows already shipped in
Phase 0. **The author's Adds/Removes disclosure above implies `down` and the reviewer is
right that it does not earn it.** The disclosure is left unedited, as the record of what the
author claimed before the grade.

## Decisions taken (operator, 2026-08-28 — this spec is now plan-ready)

Seven, in the order they were put. Each changed the spec; none is left open.

| # | decision | effect |
|---|---|---|
| 1 | **No line ceiling on code.** Rule 5's intent carries in the prose ceilings, scripts ≤ 10, guards ≥ 6, and §7's guard-deletion rule | §6, §7, §9. **Amends #366 rule 5** — mirrored into the design-inputs file the same sitting |
| 2 | **Admission control ships as observation only in 0.3.0**; the gate is built in 0.3.1 from the data 0.3.0 collects | §5, §11. The claim-lease VM reaper ships regardless — that is a leak fix, not a policy choice |
| 3 | **`claude plugin eval` gates the client only** | §11, §8b |
| 4 | **#390 ships inside 0.3.0** *(author's call, delegated)* — the driver consumes an intent doc and only #390 produces one | §8e, §10, §11 |
| 5 | **The authoring skill's ≤ 1,500-word ceiling is a release-refusing bar**, raisable only by stating the new number and its reason in the release commit body | §6, §9 |
| 6 | **Superpowers stays installed**; one precedence line in `hooks/session_start.sh` declares which skill owns the pipeline | §8e |
| 7 | **`ultradocket`'s sweep is reworked inside 0.3.0** — *against the recommendation to defer it*, so no tool anywhere still emits the old artifact | §10 |

Two of these went against the author's recommendation and are recorded as such: **7** (the
release grows to stay coherent) and, in a different direction, **1** (the author proposed a
ceiling twice and both drafts were defective — the operator removed the mechanism rather
than accept a third attempt).

**Still owed before the plan, and named so they are not assumed** (§3, §9, §10):

- ~~`--add-dir` is unexercised~~ — **DISCHARGED 2026-08-28** (parity R-w1/w2/w3): the
  wave-author flag-set holds under a hostile prompt; no cwd inversion needed.
- `ab_runner` must be re-armed on the driver before gate parity can be reported.
- The claim-lease reaper lands in the same PR as the cap deletion, never after.
