# One resume path: run-as-task-queue, findings-as-amendments (#241)

**Status:** research note (wayfinder:research). Verdict: **NO-GO** on the persistent-queue
runtime model; the queue already exists as disk state, and the residual economics have a
cheaper, measurable target. Depends-on #222 — landed (issue CLOSED, code cited below).

## Question

Three relaunch lanes (Redirect, Salvage, Polish) each relaunch a fresh Workflow run.
Would modeling a run as a persistent task queue — a gate/critic finding is an amendment
enqueued against a task; nothing untouched re-runs; "round" stops being a concept —
collapse the lanes and lower the tail's price (58% tokens / 69% wall in one run's
five-round tail; 7 launches × 25–30 min ≈ 3 of 5.5 h in another)?

## Thread 1 — Workflow runtime resume semantics

Primary sources: the Workflow tool contract (Claude Code runtime) and
https://code.claude.com/docs/en/workflows (fetched 2026-08-25).

- **Resume is same-session pause-recovery, not re-entry.** "Resume works within the same
  Claude Code session. If you exit Claude Code while a workflow is running, the next
  session starts the workflow fresh" (docs, *Resume after a pause*). The tool contract:
  `resumeFromRunId` replays "the longest unchanged prefix of agent() calls" from cache;
  "the first edited/new call and everything after it runs live"; "Same-session only."
- **Cache is start-order prefix, not per-task.** "Replay follows the order agents
  started. Cached results stop at the first agent that didn't finish, and every agent
  that started after that one runs again, even if it completed" (docs). An amendment to
  one mid-run task invalidates every later agent — the opposite of "nothing untouched
  re-runs."
- **A waiting queue is not expressible.** "No mid-run user input — only agent permission
  prompts can pause a run. **For sign-off between stages, run each stage as its own
  workflow**" (docs, *Behavior and limits*). The gate is exactly such a sign-off. A
  workflow script has "no direct filesystem or shell access" and no clock:
  `Date.now()`/`Math.random()`/argless `new Date()` throw *because they would break
  resume* (tool contract). A script therefore cannot poll a queue file or wait on time;
  an agent could poll, but that burns an agent slot per poll and still dies with the
  session. 1,000-agent lifetime cap per run bounds any long-lived loop.
- **Consequence:** the only re-entry the runtime offers **is** the round: a fresh
  `Workflow` invocation with new args. `resumeFromRunId` cannot capture cross-round
  savings either — each relaunch passes a different args file (narrowed waves, amended
  bodies), so the first agent prompt differs and the cached prefix is empty; and gate
  deliberation routinely crosses session boundaries, where resume is void.

## Thread 2 — waves.js lane code paths

- **The engine has ONE resume flag, not three lanes.** `waves.js:200-203` — `resume:
  true` requires an explicit `integrationBranch`; `waves.js:390-402` is the single
  resume `SETUP_PROMPT` (check out the existing branch, BLOCKED if absent);
  `waves.js:1359` — `if (resume) return false // redirect, salvage, any future resume
  lane`. The lanes differ only in **who composes the args**.
- **One composer core already landed (#222).** `redirect_args.py` (232 lines) owns
  `load_context`/`emit_relaunch`/rotation; `salvage_args.py` (124 lines) imports it
  (`salvage_args.py:19 import redirect_args as ra`) and adds only the salvage-set
  derivation + PRIOR ATTEMPT text. Polish is not a third code path: it is an elective
  use of the Redirect lane, priced before asking (SKILL.md:319-324).
- **Amendments already exist.** A redirect finding *is* an amendment enqueued against a
  task: `redirect_args.py:219` appends `REDIRECT: <instruction>` to the task body;
  files-footprint unions (`derive_files`, :186-193); tier right-size (:226-227). Salvage
  appends `PRIOR ATTEMPT` (kept branch + sha + verdict + findings,
  `salvage_args.py:58-79`). Launch bodies **chain** through `relaunch-launch.json`
  (`redirect_args.py:89-91`) so a later round never discards an earlier amendment.
- **"Nothing untouched re-runs" is already true at the task level.**
  `redirect_args.py:133-139`: "The honest cost contract: only the selected tasks
  relaunch (the engine resumes on the same integration branch; merged prior work is
  already there)." Waves narrow to the selected set; edges narrow; clean tasks are never
  re-implemented or re-reviewed.
- **What a queue would delete vs. need.** Delete: ~350 lines of composer scripts plus
  SKILL.md Step 5 lane prose. Need: an amendment schema and store, an engine loop that
  awaits amendments (inexpressible — Thread 1), per-amendment fresh-context dispatch (=
  reinventing the round), a new terminal-result story for the gate (Thread 3), and new
  receipts. Net: negative.

## Thread 3 — receipts and the frozen gate

- **The gate consumes one terminal envelope per round.** `ultra_gate.py` gate mode
  requires `--result <workflow result JSON>` (:172-182), unwraps the `result.*` envelope
  (:75-83), writes the live `run_dir/report.json` (:183-185), runs frozen
  `gate_check.py`, then acceptance per the receipt's disposition (:204-236). A
  never-terminating queue run produces no terminal envelope — the frozen gate would have
  nothing to consume without modification, and the periphery (gate_check.py,
  ultra_gate.py, run_lock.sh, sealing) changes only on an eval-measured regression
  (CLAUDE.md).
- **Cross-round ancestry is already mechanical, two ways.**
  1. *wf run ids:* `record_wf_runs` (`ultra_gate.py:58-68`) derives every run id
     structurally from task branch names (`WF_RUN_RE`, :41) into `wf-runs.json`;
     approve sweeps the whole set plus `wf_<stamp>` (:137-156). Fresh id per round is a
     *feature*: sweep coverage is total without orchestrator memory.
  2. *Round artifacts:* the landed #222 fix rotates, never deletes —
     `rotate_round_artifacts` (`redirect_args.py:54-73`) copies `report.json` →
     `report-<n>.json` and renames `heads/` → `heads-<n>/`, rotation running last after
     a successful emit (:127, :145). `residual_manifest.py` derives the union across
     every round's report (`--run-dir` mode; `ROUND_REPORT` glob,
     `residual_manifest.py:57`), and is explicitly "NON-FROZEN and advisory-by-
     construction … it extends no frozen gate script" (module docstring).
  *Note:* #241's text says "keyed by wfRunId"; the landed keying is by **round number
  `n`** (`_ROUND_RE`, `redirect_args.py:26`), with wf-run ids tracked separately in
  `wf-runs.json`. The guarantee the issue wanted (every round's artifacts survive,
  gate/manifest union across rounds) holds.
- So: per-round keying from #222 already gives correct ancestry, and the frozen scripts
  consume it **unchanged**. A single-queue model is the only variant that would force a
  frozen-periphery change.

## Thread 4 — fleet one-run-per-sandbox (#176)

- #176 ("Docket-level integration", Width Program #174) settled docket integration as
  **incremental arrival-order fold, park-on-contention** — the unit that arrives and
  folds is a completed run's branch.
- `fleet/RUNBOOK.md` + `fleet/drive.mjs`: `driveOne` provisions one sandbox for one
  plan, drives it to the gate, pulls evidence (`sandbox-logs.tgz` — shim.log,
  fleet-run.json, engine transcripts, `run-*/` dirs) **before every `destroySandbox`**
  (#197), then tears the sandbox down. The sandbox is mortal by design; evidence-pull
  and teardown assume a run that *ends*.
- A persistent queue would require sandboxes held open awaiting amendments — inverting
  the fold/park economics (idle XLarge VMs, spend clock running) and breaking the
  arrival-order fold unit. Rounds compose with the fleet as-is: a relaunch is just
  another discrete drive against the kept branch.

## What a queue forecloses that rounds allow

1. **Fresh-context review and fix.** Each round dispatches implementers/reviewers with
   clean context (`waves.js:168` "which is equally fresh"); the fix round re-anchors in
   a fresh worktree on the prior commit (`waves.js:1254-1273`). A persistent per-task
   agent accumulates context — or re-spawns per amendment, which is a round by another
   name.
2. **Salvage's kept-branch-as-raw-material.** PRIOR ATTEMPT depends on a *discrete
   failed run* leaving a kept branch + HEAD sha in its report; the amendment says
   `git checkout <sha> -- <path>` rather than reimplement (`salvage_args.py:61-66`).
   In-place queue mutation has no prior-attempt artifact to mine.
3. **A bounded artifact set for the frozen gate.** One envelope per round; a finite
   `wf-runs.json` sweep set; `report-<n>.json` rotation. A queue's artifact set is
   unbounded and terminal-less.
4. **The operator's decision point.** Approve/Salvage/Redirect is a human gate between
   stages — precisely the case the runtime docs route to "run each stage as its own
   workflow."
5. **Session mortality tolerance.** Round state lives on disk (receipt, argsFile,
   chained launch, rotated artifacts); a queue's live state dies with the session
   (same-session resume, Thread 1).
6. **Fleet fold/park economics** (Thread 4).

## Does resumeFromRunId already capture the tail savings?

No — and neither would a queue. Across rounds the cache prefix is empty (changed args →
changed first prompt; often a new session). But decompose the tail's price: the
per-amendment work (fix agents, suite acceptance at the gate) is irreducible in *any*
model — the gate is the gate. What a queue could shave is only the per-round fixed
overhead: one setup agent (small — a checkout), the wave-merge agent for the narrowed
wave, and the **full completeness critic** re-run over the integrated tree
(`waves.js:2188-2238`). The critic is the only large discretionary re-run — and
re-verifying the whole tree per delta is a quality mechanism (it caught the #173 fix's
own defect), not waste to be assumed.

## Go/no-go

**NO-GO** on the persistent-queue runtime model. The runtime cannot express it (Thread
1); the frozen gate cannot consume it unchanged (Thread 3); the fleet unit contradicts
it (Thread 4); and its claimed savings — no re-setup, no re-review of clean tasks — are
already delivered by the round model post-#222 (Thread 2). The conceptual reframe the
issue asks for is, in fact, the current design read correctly: **the run dir is the
queue** (argsFile + chained launch = task list; `findings.json` / PRIOR ATTEMPT =
amendments enqueued against tasks; rotation = the drain log), and "round" survives only
as the rotation index `n`, not as an engine concept (`waves.js` knows one `resume`
flag).

## Minimal shape (the cheaper move that targets the economics)

The tail's *price* levers, in order, none touching the frozen periphery:

1. **Batch amendments — enforce the existing doctrine.** SKILL.md already commands "ALL
   findings the operator wants to fix go into ONE redirect round — never a round per
   finding" (SKILL.md:318-319). The 7-launch tail is a doctrine violation, not a
   machinery gap. If ultralearn shows recurrence, the guard is a composer-side nudge
   (e.g. `redirect_args.py` warns when invoked while an un-drained `findings.json`
   round is < N minutes old), not a new lane.
2. **Measure the tail composition before building anything.** `audit_run.py` already
   reports per-round turns/tokens (SKILL.md:321-322 prices polish with it). Split one
   real five-round tail into setup / implement+review / merge / critic / suite shares.
   Only if the critic dominates:
3. **Eval-gated scoped-critic experiment** (the one go-shaped remnant). On resume
   rounds, scope the completeness critic to the relaunched tasks' criteria plus the
   prior round's findings, keeping the full-tree ancestry assertion. Critic prompts are
   baked from `references/wave-merge.md` (not in the frozen list), but this trades
   verification breadth for tokens — it is exactly the class of change CLAUDE.md
   requires an `evals/ab_runner.py` measurement for. Pre-register: redirect-round
   token/wall delta vs. missed-finding rate.

Filed as the answer to #241; no code changed.
