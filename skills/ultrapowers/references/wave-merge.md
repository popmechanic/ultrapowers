# Wave Merge Reference

How a wave's worktree branches get merged into one integration branch, reconciled on failure, and finally reviewed.

**Source-of-truth note:** the setup, merge, contended-merge, resolver, reconciliation, and
completeness-critic prompts described here are **baked into
`skills/ultrapowers/harnesses/waves.js`** as the `SETUP_PROMPT`, `MERGE_PROMPT`,
`contendedMergePrompt()`, `RESOLVER_PROMPT`, `RECONCILE_PROMPT`, and `COMPLETENESS_PROMPT`
constants. When you change the procedure here, re-bake
those constants (see the re-bake procedure in `workflow-template.md`). The committed workflow runs
this machinery; the main agent does not author it.

---

## Integration Branch

The workflow script cannot run git (no shell or filesystem access), so all git operations are delegated to agents. Before Wave 1 begins, the controller dispatches a **setup agent** whose sole job is to create the integration branch — **in its own dedicated worktree, never in the session checkout**:

```
git worktree add .claude/worktrees/wf_<timestamp>-integration -b ultra/integration-<timestamp> [<baseBranch>]
```

The timestamp is passed in via `args` at workflow startup — workflows cannot call `Date.now()`. The setup agent confirms the branch name and HEAD sha back to the controller, which stores both for use in subsequent merge steps.

`args.baseBranch`, when supplied (the orchestrator derives the repo's default branch in SKILL.md Step 2 — protects against a stale checkout left by a previous run), becomes the worktree's start-point rather than a checkout of the session tree. When `args.bootstrapCmd` is supplied, setup runs it once inside the integration worktree it just created — the fresh tree has no installed dependencies, and the merge/reconcile/completeness agents run the test suite there. The resume path carries the same sentence: it bootstraps the worktree when it had to create one, and skips the install when it is reusing a worktree that already exists (and therefore already has its dependencies). Setup then runs the project test command once to establish the **baseline**, inside that worktree, and reports `baselinePassed` / `baselineOutput`. The workflow validates the setup report and **throws** if the integration branch was not created — no task runs against a missing branch. A red baseline does not abort the run; it is logged, recorded in the report's `baseline` field, and surfaced as a judgment call so the pre-merge gate can weigh every later test result against it.

The canonical prompt wording (`{{...}}` tokens mark values `waves.js` interpolates at run time; `{{INTEGRATION_WT}}` is the dedicated integration worktree path, `{{STAMP}}` is the run stamp, `{{BASE_BRANCH_ARG}}` the optional base-branch start-point argument, and `{{BOOTSTRAP_LINE}}` the optional worktree-setup sentence — both empty when the corresponding arg is absent):

<!-- BAKE:SETUP_PROMPT_CREATE -->
You are the setup agent. The engine never mutates the session checkout: create the dedicated integration worktree instead. First check the target path: if {{INTEGRATION_WT}} already exists — a directory of any kind, even empty — refuse: create nothing, never adopt, clear, or reuse an existing directory, and never work around a git worktree add refusal. To refuse, report headSha as the empty string and put BLOCKED: {{INTEGRATION_WT}} exists — remove it with sweep_worktrees.sh --run wf_{{STAMP}} in branch; never report a real branch name or sha for a worktree you did not create. Otherwise, from the working directory you started in — never any other checkout of this repository, even if one is reachable — run: git worktree add {{INTEGRATION_WT}} -b {{INTEGRATION_BRANCH}}{{BASE_BRANCH_ARG}}. {{BOOTSTRAP_LINE}}Then establish the test baseline inside {{INTEGRATION_WT}}: {{TEST_INSTRUCTION}} and record whether it passes. Report the branch name, its HEAD sha, and the baseline result in your JSON result.
<!-- /BAKE -->

Under `args.resume` (the deterministic redirect path), setup reuses the existing branch instead, materializing (or reusing) its worktree:

<!-- BAKE:SETUP_PROMPT_RESUME -->
You are the setup agent. The EXISTING integration branch {{INTEGRATION_BRANCH}} must already exist; report BLOCKED if it does not, and do not create a new branch. Materialize its dedicated worktree: if {{INTEGRATION_WT}} already exists, check out {{INTEGRATION_BRANCH}} inside it. Before that checkout, verify the reused worktree is clean (git status --porcelain); if it is dirty, report BLOCKED with the porcelain output — never absorb pre-existing dirt into the run's diff. If {{INTEGRATION_WT}} does not exist, run git worktree add {{INTEGRATION_WT}} {{INTEGRATION_BRANCH}} from the working directory you started in — never any other checkout of this repository, even if one is reachable. {{BOOTSTRAP_LINE}}Then establish the test baseline inside {{INTEGRATION_WT}}: {{TEST_INSTRUCTION}} and record whether it passes. Report the branch name, its HEAD sha, and the baseline result in your JSON result.
<!-- /BAKE -->

---

## Worktree and Branch Facts

Task agents run in isolated worktrees provisioned by `isolation: 'worktree'`. `<repo>` is the
**session repository** (the repo `/ultrapowers` was invoked from) — the runtime binds worktrees there
natively, so no external target path is passed to the workflow:

```
<repo>/.claude/worktrees/wf_<runId>-<n>
```

Each worktree is checked out on a runtime-assigned branch named:

```
worktree-wf_<runId>-<n>
```

Branches are locked while their worktree exists, and no engine role ever deletes a branch — branches carry the commits until the deterministic Step-5 sweep removes them. When a task agent finishes with no file changes, its worktree is auto-removed and no branch is reported. When changes exist, the worktree persists through review and merge; at the wave barrier the merge agent (or, when the wave's final MERGED came from reconciliation, the reconciliation agent) removes the just-merged worktrees named on its dispatch's SWEEP PATHS line — after confirming each path via `git worktree list --porcelain` — so a wide plan no longer accumulates every merged checkout to end-of-run (#151, reversing bea1875's prompt subtraction; disk exhaustion mid-merge misreports as CONFLICT). The SWEEP PATHS line is engine-derived from the self-reported branch names by shape (`worktree-wf_<x>-<n>` → `.claude/worktrees/wf_<x>-<n>`, the same mapping `sweep_worktrees.sh` owns); a malformed name contributes nothing, silently. Contended-wave adoptions are best-effort-excluded: they report MERGED through the contended STEP prompt, which carries no sweep step, so their consumed worktrees wait for the Step-5 sweep. Failed/blocked/parked branches and their worktrees are never swept mid-run — they are left for inspection until the orchestrating agent sweeps them after the pre-merge gate — and the Step-5 `sweep_worktrees.sh` remains idempotent over worktrees already removed at a wave barrier (`[ -e "$wt" ] || continue`).

Each implementer agent is responsible for self-reporting its branch name and HEAD sha at the end of its run. This self-report is the only mechanism by which the merge step learns the task-to-branch mapping — the script cannot inspect the filesystem to discover branches.

The **dedicated integration worktree** is the one worktree the engine cuts for itself rather than for a task:

```
<repo>/.claude/worktrees/wf_<stamp>-integration
```

It is stamp-named, not `wf_<runId>`-named, because the script knows `args.stamp` (the same value that names the run dir) and never sees the runtime `wf_<runId>`. That puts it outside the run-scoped sweep the operator already runs: `sweep_worktrees.sh --run <wf_runId>` globs `.claude/worktrees/wf_<runId>-*`, which can never match `wf_<stamp>-integration`. So `ultra_gate.py --approve` itself sweeps every recorded wf run ID (`run-<stamp>/wf-runs.json`, unioned across every gate call this stamp ever made) plus `wf_<stamp>` — no additional manual `sweep_worktrees.sh` call is needed; that stem glob (`wf_<stamp>-*`, the script strips the leading `wf_` before globbing) does match the integration worktree, and it removes no other run's state. Without that recorded ID the integration worktree leaks every run. (`sweep_worktrees.sh` invoked with no `--run` is not a repo-wide fallback either: it consults `RUNID`, then the `RUN_LOCK` file, and only sweeps repo-wide when neither is set — pass `--all` for an explicit repo-wide sweep.) Setup creates it, the merge, reconciliation, and completeness-critic agents work inside it, and the completeness critic's sha-verified `git checkout --detach` there releases the integration branch so the frozen `ultra_gate.py --approve` checkout can take it. The session checkout is never branched, written to, or detached by any engine agent.

---

## Per-Wave Merge

After all task agents in a wave complete, the controller dispatches a single **merge agent** (non-isolated, running in the dedicated integration worktree). The merge agent receives the list of `{ task, branch, sha }` entries reported by the wave's implementers.

The merge agent:

1. `cd`s into the integration worktree, already on the integration branch (`ultra/integration-<timestamp>`).
2. Merges each reported branch in deterministic task-index order (task 0 first, then 1, 2, …). Fixed order makes conflicts reproducible.
3. After all merges succeed the merge agent runs the project test command —
   `args.testCmd`, which the pre-launch driver always supplies (operator
   `--test-cmd` or its deterministic detection ladder; interpolated into
   `MERGE_PROMPT` / `COMPLETENESS_PROMPT` via `testInstruction`).
4. Reports back: success with final integration HEAD sha, or failure with the conflict diff or failing test output. It records no sha anywhere else — the reported head is context, and every consumer that needs authority derives it from git (see **Derived Task Heads** below).

The canonical prompt wording:

<!-- BAKE:MERGE_PROMPT -->
You are the wave merge agent, operating ONLY inside the dedicated integration worktree at {{INTEGRATION_WT}} — never the session main checkout. cd into it; echo git rev-parse HEAD and git branch --show-current; if the branch is not the integration branch you were asked to operate on, report BLOCKED and merge nothing — do not detach or move any other checkout. Merge each reported branch in the given task-index order (deterministic, so conflicts are reproducible). After all merges succeed, {{TEST_INSTRUCTION}}. Report MERGED with the final HEAD sha, or CONFLICT / TEST_FAILED with the conflict diff or failing output. If and only if you are reporting MERGED, sweep this wave's consumed worktrees: a SWEEP PATHS line appended to this dispatch names the just-merged worktree paths, derived by the engine from the merged branch names; if no SWEEP PATHS line is appended, sweep nothing. For each listed path, run git worktree list --porcelain and confirm the path appears there with its checked-out branch being one you merged in this wave; only after that per-path check passes, remove it with git worktree remove --force <path>, using the absolute worktree path the porcelain output printed. A listed path absent from the porcelain output was already swept — skip it silently. A path that is present but fails the branch check must not be removed: skip it and name it in your reply detail. Never delete any branch — branches carry the merged commits, and the deterministic Step-5 sweep owns branch cleanup.
<!-- /BAKE -->

A wave that produces **no mergeable branches** (every task failed, dep-blocked, or deferred, or reported done without mergeable coordinates) skips its merge entirely: `waveMerges` records `status: 'SKIPPED'`, the integration branch and review base are untouched, and later waves still run when dependency edges were supplied (they decide what downstream work is blocked) or when nothing in the wave actually ran. When `args.edges` was NOT supplied and tasks did run, the workflow cannot know what depends on the lost work — it records the `SKIPPED` merge plus a `blockedWaves` entry ('no mergeable branches and no dependency edges supplied — cascading conservatively') and cascade-blocks later waves.

---

## Contended Waves — the frontier merge path

A **contended** wave is one whose tasks were deliberately scheduled onto the same
files: fold-mode compilation drops the `write-after-write` edge between an eligible
pair, so both run in parallel and both edit the same paths. Contention is **derived,
not declared** — the compiler emits no new field. `mergeWave` takes the contended
path for a wave iff all three conjuncts hold:

1. `!resume` — redirect, salvage, and every future resume lane take the git-merge path.
2. The wave base is **live**: no prior wave reported `MERGED` without a `headSha`.
   That soft failure freezes `waveBaseSha` while the integration branch genuinely
   advances — tolerable on the git-merge path (the next merge reconciles by content),
   fatal here, because the contended path builds its candidate *from* `waveBaseSha`
   and a frozen base would rewind the integration branch over the prior wave's merge.
   The engine tracks it in a module-scope `waveBaseLive` boolean, set `false` in the
   existing `MERGED`-without-`headSha` branch; it is sticky across waves, so it also
   covers a contended wave that itself adopts and reports without a `headSha`.
3. **≥2 mergeable results** whose `WAVES[waveIdx]` task entries — joined by
   `r.task === t.id`, because a task result carries no `files` field of its own —
   have pairwise-intersecting `files`. Mergeable *results*, not declared tasks: a
   contended pair that loses one task to failure or a blocking review leaves a lone
   survivor with nothing to contend against.

The contended path routes the **same merge-agent role** through a second contract, at
`TIER.mostCapable` (its duties most resemble reconcile's; a cheap model improvising
these git invocations would convert a priced fallback into a blocked wave). It drives
the deterministic fold CLI at `<pluginRoot>/skills/ultrapowers/kernel/fold_wave.py`
across three dispatch kinds — `fold`, then one `resolve` per applied resolution, then
`materialize` and adoption — replying under `FOLD_SCHEMA` for the first two and under
`MERGE_SCHEMA`'s ordinary `MERGED` + `headSha` shape for adoption, so the call site's
`waveBaseSha` and review-base handling is unchanged. The **number** of `resolve`
dispatches is not bounded by the fold's conflict count: the incremental protocol
stops the fold at its first conflicted task and folds on inside a later `resolve`
call, so new conflicts arrive as `resolve` replies. `frontierEntry.foldCliCalls`
records how many invocations the wave actually drove.

The wave base is **engine-authored into every dispatch** by interpolating the
module-scope `waveBaseSha` (which advances only *after* a merge, so at dispatch time
it is exactly the previous integration head). It is the `fold` base argument and
`<prevHead>` in the adoption and restore sequences; the agent derives nothing. Like the
merge dispatch, the contended dispatch records no shas of its own: the adopted candidate
reaches the report as context, and the critic derives the integration tip from git.

The `fold` CLI prints scalars and the conflicts-index coordinates of its stop, but no
report **paths**, so those are engine-authored, not guessed: `{{WAVE_DIR}}` is
`frontierDir(waveNumber)` (`<runDir>/frontier/wave-<n>`, 1-based), interpolated into
the prompt so the agent reads the fold log and the
conflicts index from a directory it was **told**. Each open conflict is keyed by its
conflicts-index `i` — not by `(path, epoch)`, which is not unique once a presence park
shares the pair with a kernel conflict — and carries the `hunksFile` the index entry
records (`conflict-<i>.hunks.txt`). The resolver is briefed off that hunks file; no
narration path reaches the engine at all.

Those scalars are **authority over the status enum** the agent types beside them. A
non-zero `parked` falls the wave back whatever verdict accompanies it, and — the
load-bearing half — the engine requires the `open` list to account for every
dispatchable conflict, because the resolver loop runs over `open` alone: a `FOLDED`
typed over a non-zero conflict count, or a short `open` list, would skip resolution
and adopt a candidate that drops a contending task's edit on a **green** run. A reply
that omits the `conflicts` scalar entirely is checked the same way, unconditionally on
the status enum: the CLI always emits `conflicts` for both fold verdicts, so a missing
count is a contract violation rather than a legal FOLDED or CONFLICTS shape, and it
falls the wave back before either count-vs-count guard — which go silent when the
field is simply absent — ever runs. The `selfChecks` attestation is held to the same
standard, **scoped to the completing reply**: the CLI runs its two live self-checks
inside whichever call completes the wave, so a stop reply carries none and requiring
one there would fall every conflicted wave back before a resolver was dispatched. On
a reply that says `complete` (or types `FOLDED`), anything but `ok` — a named failure
or an omitted field alike — falls the wave back (`FOLD_SCHEMA` requires only `status`,
so the schema cannot catch the absence). Nothing downstream catches any of this
(materialize builds from the kernel's own manifest, and the fold advances the frontier
either way), and it lands past the adoption boundary where fallback is no longer live
— so it is checked before the work list, not after.

The same standards ride the `resolve` replies, because the work list is re-seeded from
them: a continued fold that names an `open` list with no `conflicts` count, or whose
`dispatchable` disagrees with the list's length, falls the wave back exactly as the
fold reply would. An `applied` reply that instead names a `waiting` set — the entries
of the current stop this resolution did not drain — is checked against the engine's own
outstanding list minus the entry just applied; the CLI never prints an empty `waiting`,
so an empty or disagreeing one is a contract violation, not a legal continuation.

The canonical prompt wording (`{{INTEGRATION_WT}}` is the dedicated integration
worktree path, `{{PREV_HEAD}}` the engine-authored wave base, `{{WAVE_DIR}}` the
wave's frontier directory, `{{TEST_INSTRUCTION}}` the project test command sentence;
`<pluginRoot>` and `<runDir>` are literal tokens `fillPaths()` fills, as in every
other baked prompt):

<!-- BAKE:CONTENDED_MERGE_PROMPT -->
You are the wave merge agent running the contended contract, operating ONLY inside the dedicated integration worktree at {{INTEGRATION_WT}} — never the session main checkout. cd into it; echo git rev-parse HEAD and git branch --show-current; if the branch is not the integration branch you were asked to operate on, report BLOCKED and merge nothing — do not detach or move any other checkout. This wave's tasks edit the same files on purpose, so you do not merge their branches: you drive the deterministic fold CLI at <pluginRoot>/skills/ultrapowers/kernel/fold_wave.py, which moves no ref and writes nothing into the worktree. Run every invocation from inside {{INTEGRATION_WT}} with --repo . so the CLI reads this worktree's repository. The wave base — the fold base, and <prevHead> in the sequences below — is {{PREV_HEAD}}; never derive it yourself. This wave's fold directory — the one the CLI writes its fold log, its conflicts index and its narrations into — is {{WAVE_DIR}}; never derive that either. Exactly one STEP applies to this dispatch: the STEP line appended below names it and gives the exact command to run. Run that command and no other, then report its stdout JSON as your own fields. Reading is otherwise limited to that fold directory: a STEP may send you to its conflicts index conflicts.json, its fold log fold_log.jsonl, or a narration file, and those reads are in contract. Report nothing you did not either read there or read from stdout — never a count, a sha or a path you invented. A non-zero exit is never something to work around — report the failure verbatim and stop.
STEP fold: report FOLDED when the CLI prints conflicts 0, CONFLICTS when it prints conflicts and every indexed conflict is dispatchable, PARKED when any conflict is not dispatchable, and ERROR on a non-zero exit or a selfChecks value other than ok. Copy conflicts, dispatchable, parked and selfChecks from the JSON. The CLI prints no paths, so take them from the fold directory it just wrote: report foldLogPath as {{WAVE_DIR}}/fold_log.jsonl and conflictsIndex as {{WAVE_DIR}}/conflicts.json. Time the invocation and report its wall clock in foldCliWallTimeSec. Then read {{WAVE_DIR}}/conflicts.json — an array whose entries carry i, path, kind, dispatchable, reason and epoch — and for each entry whose dispatchable is true and whose autoResolved is not true add an open entry carrying that entry's i, path, epoch, its hunksFile (the conflict-<i>.hunks.txt path from the entry) and hunkCount. Copy remaining and complete from the JSON; copy selfChecks only when the JSON carries it (a stop reply does not). Copy the reply's autoResolved count into your reply (0 when absent).
STEP resolve: Run the resolve invocation. Report FOLDED when it prints complete true — copy selfChecks. Report CONFLICTS when it prints applied true with an open list — copy conflicts, dispatchable, remaining and complete and add one open entry per listed entry exactly as in STEP fold — or with a waiting list — report open as empty and copy waiting. Report REJECTED when the exit code is 4 — copy reason into detail. Report ERROR on any other non-zero exit, including stale true. Time the invocation and report its wall clock in foldCliWallTimeSec. Copy the reply's autoResolved count into your reply (0 when absent), on every verdict.
STEP adopt: run the materialize invocation. If it prints a park or a fallback verdict, report CONFLICT with that reason and change nothing. Otherwise take the candidateSha it printed and test that candidate with the branch unmoved: git read-tree -u --reset <candidate>^{tree} puts the candidate's tree in the worktree while HEAD and the branch ref stay at <prevHead> (a bare read-tree -u is a fatal git error, and merge --ff-only would refuse over the read-tree index). Then {{TEST_INSTRUCTION}}. If it passes, adopt the candidate with git reset --hard <candidate> and report MERGED with that sha as headSha. If instead the suite fails, adopt nothing and restore the worktree — git reset --hard <prevHead>, then git clean -fd — then report TEST_FAILED with the failing output. Do not try to fix a failing candidate: the engine falls the wave back to an ordinary git merge, and that path refuses to operate on a dirty or detached worktree. Time the invocation and report its wall clock in foldCliWallTimeSec.
<!-- /BAKE -->

### The resolver

The engine holds a **work list** of open conflicts and dispatches **one resolver agent
at a time**, awaiting each resolution — serialization is by construction. The list is
seeded from the fold's stop and **replaced** by each continued fold's stop, because the
CLI folds on past a drained stop inside the same `resolve` call: a later stop's
conflicts arrive as an apply reply, never as a second fold dispatch. Every conflict is
preceded by a `budgetExhausted()` checkpoint, like every other dispatch site in the
engine; exhaustion routes the wave to fallback, which is still live at that point.

Resolver dispatches carry `{ label, schema }` with the `model` key **omitted**, so they
run at the session-ambient model. That is like-for-like with the graded production cell,
whose resolver ran on its CLI default; tier escalation is a post-A/B knob, not a
launch-time confound.

The resolver **reads its own hunks file** — the hunk-scoped brief the `fold` subcommand
writes beside each narration — and writes one reply file per hunk into a reply
**directory** the engine names. It never sees the whole file, so it can never silently
rewrite the parts nobody asked about, and the reply-directory grammar is checkable:
a missing, unknown, marker-bearing or unterminated hunk reply is **rejected** by the
CLI (exit 4) before any kernel work runs.

Rejection is the one retryable apply status: the frontier is untouched, so the engine
re-briefs the **same** conflict once, carrying the kernel's reason on a
`PREVIOUS REPLY REJECTED` line, and a second rejection falls the wave back. A **stale**
resolution is not retried at all — the epoch check is the idempotency guard against a
re-issued command, so it arrives as `ERROR` and falls the wave back.

<!-- BAKE:RESOLVER_PROMPT -->
You are a merge-conflict resolver for one file in one wave. You have no repo to explore: read exactly the hunks file named below and write exactly the reply directory named below — one file per HUNK (h1.txt, h2.txt, …) plus notes.txt — and touch nothing else. Never run git, never edit the file under conflict, never create a commit; the hunks file and the reply directory are your only sanctioned locations.
Each HUNK shows a conflict block with read-only context above and below it: frontier is the work already folded in, a task id is the incoming change, both is content shared by both sides — carry every both line. For each HUNK write the lines that should replace the whole conflict block, top to bottom, with no conflict markers: a file of newline-terminated lines, an empty file meaning the block resolves to nothing. Never write context lines.
Honor both sides' intent where they are compatible; where they are not, prefer the semantics the contending task bodies describe over surface text; never drop a side silently — if the two sides are irreconcilable, still write your best merge for that hunk and say so in notes.txt; nothing invented that appears in neither side nor the narration. When a HUNK header carries a contract line, obey it. Report RESOLVED once every hunk file is written, or BLOCKED with the reason if you could not read the hunks file or could not write the reply directory. A BLOCKED resolver falls the whole wave back to an ordinary git merge, which is a real cost — report it only when you genuinely cannot produce a reply.
<!-- /BAKE -->

### Fallback — live strictly before adoption

The fold consumes task branches but never destroys them. Kernel error, an ineligible
conflict, a resolver reply rejected twice, a stale resolution, budget exhaustion
mid-work-list, a completing reply whose self-checks are anything but `ok` (a named
failure or an absent attestation), a materialization park, a thrown contended
dispatch, a fold or continued-fold reply whose counts and named conflicts disagree,
a `waiting` set that disagrees with the engine's outstanding list, and
**candidate suite failure** all route the wave to the existing git-merge + reconcile
path with the integration branch and worktree exactly where that path expects them.
After adoption, task heads are ancestors of the integration branch and the reconcile
path can no longer bind — from there the only route is redirect, as with any adopted
merge today.

The fallback is **not** "today's behavior arrived at late": under `--overlap serialize`
these tasks never ran concurrently, so the reconcile agent (two attempts, then
`blockedWaves`) is handed a multi-task same-file collision it was never built for, with
the parallel work already spent. Its real cost is a wave that can end blocked. Every
fallback is recorded where the engine already records failure routing — a
`judgmentCalls` entry naming the reason, plus the wave-merge result. There is no
separate fallback event type in the fold log.

---

## Reconciliation

On a merge conflict or a failed post-merge test, the controller dispatches a single **reconciliation agent**. It receives the conflict diff or failing test output alongside the full task context and is expected to resolve the issue on the integration branch and re-run the test command.

The canonical prompt wording:

<!-- BAKE:RECONCILE_PROMPT -->
You are the reconciliation agent for {{INTEGRATION_BRANCH}}, operating ONLY inside the dedicated integration worktree at {{INTEGRATION_WT}} — never the session main checkout. cd into it; echo git rev-parse HEAD and git branch --show-current; if the branch is not the integration branch you were asked to operate on, report BLOCKED and merge nothing — do not detach or move any other checkout. You are given a merge conflict diff or failing test output. Resolve it on the integration branch, then {{TEST_INSTRUCTION}}. Report MERGED on success, or CONFLICT / TEST_FAILED with detail if you cannot resolve it. If and only if you are reporting MERGED, sweep this wave's consumed worktrees: a SWEEP PATHS line appended to this dispatch names the just-merged worktree paths, derived by the engine from the merged branch names; if no SWEEP PATHS line is appended, sweep nothing. For each listed path, run git worktree list --porcelain and confirm the path appears there with its checked-out branch being one you merged in this wave; only after that per-path check passes, remove it with git worktree remove --force <path>, using the absolute worktree path the porcelain output printed. A listed path absent from the porcelain output was already swept — skip it silently. A path that is present but fails the branch check must not be removed: skip it and name it in your reply detail. Never delete any branch — branches carry the merged commits, and the deterministic Step-5 sweep owns branch cleanup.
<!-- /BAKE -->

Caps and failure handling:

- The fix loop is capped at **2 attempts**. Each attempt and its outcome are logged via `log()`.
- If the reconciliation agent fails both attempts, the wave is marked **`blocked`**.
- Its branches are left intact — do not delete worktrees for a blocked wave.
- The blocked wave, its conflict/diff, and the failing output are recorded in the final report.
- When a wave's merge cannot be reconciled, the wave is marked **`blocked`** and **all later waves are cascade-blocked** (recorded in `unfinished` and `blockedWaves`). Every later wave merges onto the same integration branch the failed wave left in an unknown state, and in parallel mode each wave-N+1 task depends on some wave-N task by construction; degraded sequential runs cascade conservatively too — after a failed MERGE the integration branch is in an unknown state either way. (A SKIPPED merge does not cascade when edges were supplied; without edges it cascades conservatively.) The committed workflow therefore stops dispatching after an unrecoverable merge; nothing after the blocked wave runs. The integration/completeness review still runs and reports.

---

## Integration and Completeness Review

After the final wave's merge agent completes successfully (or is blocked), the controller dispatches a single **completeness-critic agent** whose prompt is adapted from `superpowers:verification-before-completion`'s evidence-before-claims discipline — baked into `waves.js` at build time, not loaded from Superpowers at runtime. The agent both runs the full test suite on the integration branch inside the integration worktree, whose verified detach also frees the integration branch for the frozen Approve checkout (its result populates the report's `tests` field), and reviews the integrated result for gaps. It receives `args.planPath` and reads the plan from disk (agents have fs access; the script does not), plus the full list of tasks and the blocked-wave log (if any); the baseline-failure note is included only when the baseline was red. All findings — gaps, unverified claims, untested paths — are appended to the run report verbatim.

The canonical prompt wording (`{{PLAN_STEP}}` is the optional "Read the original plan document at `args.planPath` first." sentence; `{{MERGE_HEAD_SHA}}` is `waveBaseSha` — the last wave's `merge.headSha` — interpolated at dispatch, empty if the run recorded no merge HEAD, and carried as the **recorded** cross-check value only (the detach target is derived from git, never from this token — see **Derived Task Heads**); `{{CANNOT_VERIFY}}` is the CANNOT-VERIFY checklist the per-task reviewers escalated, empty when none were raised; `{{ANCESTRY_BLOCK}}` is the ancestry instruction from **Integration Ancestry Assertion** below, empty when nothing merged):

**Substitution order matters here.** The engine text runs through `fillPaths()` at dispatch, like every other baked prompt. (`<derived>` and `<recorded>` are *not* path tokens: they are placeholders the critic itself fills with the two shas it read, so `fillPaths()` must leave them alone.) `{{CANNOT_VERIFY}}` is **not** engine text: the checklist is *reviewer*-authored prose, and a reviewer escalating a requirement about run-directory paths quotes the literal `<runDir>` token. So `waves.js` keeps `{{CANNOT_VERIFY}}` as a seam in the baked constant, runs `fillPaths()` over the engine text, and only then splices the checklist in — verbatim, the same exemption that keeps the plan-authored GLOBAL CONSTRAINTS block outside the call. Path substitution applies to engine-authored text only; rewriting a reviewer's or a plan's quotation would hand the critic prose nobody wrote.

<!-- BAKE:COMPLETENESS_PROMPT -->
You are a REVIEW role. Do not write files, create commits, stage changes, or modify the tree in any way. Your only output is your findings/verdict. If the work is wrong, report it — never fix it.
Operate ONLY inside the dedicated integration worktree at {{INTEGRATION_WT}} — cd into it before any git command; never the session main checkout; your verified detach there also frees the integration branch for the gate.
{{PLAN_STEP}}First, put yourself on the exact tree the run produced, and derive that tree from git itself — never detach at a sha typed into this prompt. Confirm git branch --show-current prints {{INTEGRATION_BRANCH}}; if it prints nothing (a detached HEAD) but git rev-parse HEAD equals git rev-parse {{INTEGRATION_BRANCH}}, you are already detached on the integration tip — proceed; in any other case where it does not print {{INTEGRATION_BRANCH}}, report BLOCKED and produce no findings — do not guess a tree. Run git rev-parse HEAD: that sha is <derived>, your detach target. Then run git checkout --detach <derived> and confirm git rev-parse HEAD still equals <derived>; if the detach fails (a dirty or conflicted worktree) or the confirmation differs, report BLOCKED and produce no findings. Only then cross-check the value the run recorded, which is context and not authority: the recorded merge sha is {{MERGE_HEAD_SHA}}. If that recorded value is non-empty and differs from <derived>, report BLOCKED with a finding that names both, written exactly as: recorded merge sha <recorded> != derived integration tip <derived>. Only once you are verified on that tree: what plan requirement is unmet? What claim is unverified? What code path is untested? {{TEST_INSTRUCTION}}, then review the integrated result against the original plan. {{CANNOT_VERIFY}}When GLOBAL CONSTRAINTS are provided, verify each one holds across the whole integrated tree, not task by task — a worktree-isolated per-task reviewer could only confirm its own slice; list any constraint the integrated result violates as a blocking gap. List every gap, unverified claim, and untested path. A claim about the order in which work was performed — that tests were written before code, that a red run preceded green, that commits came in a given sequence — is not a finding when the integrated diff cannot evidence it: omit it entirely, never as a gap, an unverified claim, or a deferredVerification item; constraints about test presence and coverage still verify. After confirming HEAD equals <derived> (the git-derived detach target), set onIntegrationHead true in your result (false if you could not confirm it). Read the plan at the provided planPath; for every task reported failed or blocked, check whether its declared Create: paths exist in the tree — list any that are genuinely absent as missing deliverables. For any deliverable that is present and structurally complete but whose behavior the sandbox could not execute, list it under deferredVerification as an object { deliverable, reason, why }, where reason is one of 'browser' (a live UI), 'runtime' (a target runtime the sandbox cannot run — process boot, device, deploy target), 'external' (an unreachable service/credential/network), or 'manual' (requires human judgment), so the gate can route runtime/external items to an explicit acknowledgement.{{ANCESTRY_BLOCK}} Authoritative shas live in git: the branch tips you resolve yourself and the integration HEAD you derived. Treat a branch you cannot resolve exactly as an ancestry miss. Sha values quoted elsewhere in this prompt are context, not authority.
<!-- /BAKE -->

In the structured report this lands in `tests` and `completenessFindings`; blocked waves land in `blockedWaves` (presentation item 6), cascaded work in `unfinished`.

---

## Integration Ancestry Assertion

A wave can report a task as merged (a `done` result with a `branch` and `headSha`)
and yet have that commit never reach the integration HEAD — a reconciliation that
dropped it, a merge that silently lost it. The engine used to surface such a loss
only indirectly, when a downstream dependency edge failed against the missing base.
`#70` closes that gap with a cryptographic assertion administered by the completeness
critic, which is the one role already sitting detached on the integration HEAD.

The controller accumulates, across every successfully-merged wave, the `task` id and
`branch` name of each mergeable `done` task into a `mergedShas` set and passes it into
the completeness prompt. The critic, already on the integration HEAD, **resolves each
branch tip itself** with `git rev-parse <branch>` and asserts that
`git merge-base --is-ancestor <tip> HEAD` succeeds; any task whose branch does not
resolve, or whose tip is **not** an ancestor of HEAD, was silently dropped from the
integration and is returned under `ancestryMisses` carrying the tip the critic
resolved. The controller treats a non-empty
`ancestryMisses` as **BLOCKED**: it pushes a judgment call naming each dropped task
and withholds `gitVerified`/green, so the pre-merge gate cannot mistake a run that
lost work for a clean one. When `mergedShas` is empty (no wave merged), the ancestry
instruction is omitted — there is nothing to assert.

The canonical prompt wording appended to the completeness prompt (`{{MERGED_SHAS}}`
is the JSON list of `{task, branch}` entries interpolated at dispatch; omitted when
empty):

<!-- BAKE:COMPLETENESS_ANCESTRY -->
You are also given mergedShas, the task id and branch name of every mergeable done task. For each entry, resolve the branch tip yourself with git rev-parse <branch> and assert that its commit landed in this integration tree by running git merge-base --is-ancestor <tip> HEAD; return under ancestryMisses every task whose branch does not resolve or whose tip is not an ancestor of the current HEAD (an empty ancestryMisses when they all are), carrying the resolved tip (or the resolution failure) as that entry's headSha. A branch tip that is not an ancestor is a silently dropped task, and the controller treats a non-empty ancestryMisses as BLOCKED. mergedShas: {{MERGED_SHAS}}
<!-- /BAKE -->

---

## Derived Task Heads

The ancestry assertion above is only as good as the shas it compares, and every sha in a
run report reaches the controller the same way: a model typed it into its JSON result. A
fabricated or truncated tail defeats the check silently — the assertion still runs, against
a sha that never existed. `#114` named that gap; `#259` closes it by **subtraction**, because
git already holds every value the gate needs.

**Git is the ledger.** No engine role deletes a task branch — branches carry their commits
through the merge and past it, until the deterministic Step-5 sweep — and the integration
branch tip *is* the tree the run produced. So a sidecar recording those same shas is a second
copy of a ledger that was already authoritative, kept in sync by agent compliance. There is
no sidecar: **no agent writes shas anywhere.** The merge, reconcile, and contended-adopt
prompts carry no heads-recording step, and no dispatch appends a slot line.

Each consumer derives instead:

- The **completeness critic** derives its detach target from the branch it was sent to verify:
  it confirms `git branch --show-current` is the integration branch (or that it is already
  detached exactly on that branch's tip — the idempotent re-entry after its own detach, #275),
  takes `git rev-parse HEAD` as `<derived>`, and detaches there. The recorded merge sha stays
  in the prompt as a cross-check only — a mismatch reports `recorded merge sha <recorded> !=
  derived integration tip <derived>` — and a wrong branch reports BLOCKED rather than a
  guessed tree.
- The **ancestry assertion** hands the critic `{task, branch}` pairs, not shas. The critic
  resolves each tip itself with `git rev-parse <branch>`, and a branch that does not resolve
  is an ancestry miss exactly like a tip that is not an ancestor.
- `finalize_report.py` folds the same two facts — each task branch's tip and the integration
  tip — into the run report at gate time, from git, after every agent has finished.

`#114`'s invariant (nothing the gate trusts rides model tokens) therefore holds with **zero
agent compliance**: a merge agent cannot skip a write that no longer exists, and cannot type a
sha nobody reads. Task **ids** and **branch names** still come from `waves.js` control flow and
the implementers' self-reports, and a branch name that resolves wrong fails closed through the
ancestry assertions rather than silently.

---

## No Silent Caps

Every truncation is surfaced explicitly:

| Event | Logged via | Appears in report |
|---|---|---|
| Reconciliation attempt fails, later attempt recovers | `log()` | log only — the wave records plain `MERGED` |
| Reconciliation fails terminally (both attempts) | `log()` | `blockedWaves` |
| Wave marked `blocked` | `log()` | `blockedWaves` |
| Downstream wave cascade-blocked | `log()` (one line per blocked wave) | `unfinished` (`cascade-blocked by wave N` entries) |
| Fix-loop cap reached | `log()` | failed task in `tasks[]` (`reviewVerdict: 'fix-loop-exhausted'`) |
| Budget exhausted (launch or mid-run) | `log()` | `unfinished` (`deferred (budget exhausted…)`) + one `judgmentCalls` entry |
| Completeness-critic findings | — | `completenessFindings` |

Nothing is swallowed. If a cap fires and nothing is logged, that is a bug in the workflow.
