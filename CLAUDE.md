# CLAUDE.md

## Purpose & vision

ultrapowers authors a plan and then executes it in parallel. It started as an
alternative execution engine for **superpowers**, the popular Claude Code skill for
software-engineering automation, and since #390 it owns the authoring end too
(`ultrawrite`). Where a sequential executor works a plan one task at a time,
ultrapowers compiles it into dependency-ordered waves and executes them as a fleet of
`claude -p` workers on a disposable exe.dev sandbox, driven by the deterministic engine
in `fleet/run-engine.mjs`: each worker gets a clone at BASE, its patch is captured, and
the kernel folds each wave — no LLM orchestrator, no Workflow tool (since 0.3.0), and
since 0.3.5 no orchestrator VM either: the sandbox owns its run and opens its own PR.

The aim is to move where humans spend their attention. ultrapowers keeps users
closely involved in **planning** — deciding what to build and how it will be
verified — and much less involved in **implementation**, which the engine fans out,
reviews, and integrates autonomously up to a single pre-merge gate. That makes
ambitious work approachable for less-technical operators: ultrapowers is built for
large, complex tasks that reward parallelism and independent verification.

This file is for agents **developing the plugin**; end-user docs are in `README.md`.
The plugin owns plan authoring via `ultrawrite` since #390; superpowers is an optional
companion, not a dependency.

## Commands

```bash
python3 -m pytest        # the test gate (pytest.ini scopes it to tests/)
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers   # validate a skill dir
python3 skills/ultrapowers/scripts/compile_plan.py <plan.md>              # compile a marked plan to its waves
node fleet/doctor.mjs --json                                              # which fleet prerequisite is missing
node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <sha>      # one run on the fleet
```

- **There is no CI** (#871 decision 3, 2026-09-10) — nothing runs on push or pull request:
  the fleet run's gate is the check (`ultra_gate.py`, reading the suite result the engine
  recorded), a PR merges from the sandbox once that gate is green, and a release's check is
  the confidence run on the merged engine. The command above is the same suite by hand; it
  bridges every `fleet/tests/test_*.mjs`, the engine sims included.

## Layout

- `skills/ultrapowers/` — the operator skill: `SKILL.md` (the thin client — commit
  the plan, launch the fleet), `scripts/`, `references/` (`first-run.md` walks each doctor
  row for a first-timer). **The engine lives in `fleet/run-engine.mjs` since 0.3.0**
  (Amendment 10: models never run git); its judgment prompts are plain files in
  `fleet/roles/*.md` — one copy, no bake step.
- `skills/ultrawrite/` — the owned plan-authoring skill (the claims-v1 grammar: six body
  slots, contracts signed and edges derived; `- Run:` proofs since #592); it replaced the
  superpowers authoring invocation at #390. (Also `skills/ultradocket/`.)
- `hooks/session_start.sh` — injects the plan-routing rule into every session.
- `.claude-plugin/{plugin.json,marketplace.json}` — manifest + marketplace entry (the version lives here).
- `docs/superpowers/{specs,plans}/` — design docs, named `YYYY-MM-DD-<topic>.md`. Specs are
  the signed input; `plans/` holds the claims-v1 plans ultrawrite emits (plus each plan's
  `.gate-verdicts.json`). **Untracked since #544 (2026-09-02):** the whole of `docs/superpowers/`
  is in `.git/info/exclude` and `docs/README.md` is the tracked stub. A plan reaches the fleet
  only as `.ultrapowers/plan.md`, one commit on the run's base that `fleet/launch.mjs` pushes to
  the TARGET repository as `ultra/plan-run-<N>` before any VM exists (#597/#598); the run answers
  on two more branches of that same repository, `ultra/evidence-run-<N>` (the record, under
  `.ultrapowers/runs/<N>/`) and `ultra/integration-run-<N>` (the work, and the PR's head).
  A plan may not ask a worker to read a spec path — the sandbox has
  none. `docs/superpowers/intents/` is two historical 2026-08-28 docs from the pre-#390
  seven-slot shape — nothing writes there now.
- `evals/fixtures/` — 14 sample plan repos (the legacy-grammar compiler corpus — `wide`,
  `chained`, `mixed`, `flawed`, `degrade`, … — plus `claims`, the claims-v1 one) used as test
  data by the compiler tests; `pytest.ini` keeps pytest from collecting them. **Untracked since #544 step 4 (2026-09-08):** `evals/frontier/corpus/` and
  `evals/frontier/results/` (the frozen fold corpus and its readings, 388 files) are ignored by `.gitignore`, `evals/frontier/README.md` is the tracked stub, the
  durable copy is the laptop, and the corpus tests read `corpuslib.make_fixture_corpus` (built once per session by `tests/conftest.py`), never those directories.
- `fleet/` — the fleet in its **target-owns-the-record** shape (0.3.5 lift, 0.3.6 grant collapse,
  #597/#598 the move onto the target; `fleet/CONTRACT.md` is the authority for every literal,
  `fleet/RUNBOOK.md` the operator procedure — the contract wins). `launch.mjs` validates (hash pins, then `compile_plan.py --check --base` through the exec seam, since #865/#896 — its `BASE fact:` lines are printed on the launch line), reads
  the pool from `billing plan --json`, computes N from the target's own `ultra/*-run-*` branches,
  refreshes the Claude bearer, pushes the plan as one commit on base to `ultra/plan-run-<N>`
  (tree = base + `.ultrapowers/plan.md`), then issues ONE lobby verb: a per-run `new` carrying the
  VM name `fleet-r<N>-<stamp>-<rand>`, `--tag fleet`, the assignment as `--comment`, both
  integrations, `--cpu`/`--memory` from `~/.ultrapowers/fleet.json`, and the generated setup script
  on stdin — no image to copy, no attach, no ssh wait, no explicit start. The setup script installs
  the toolchain, the immutable bootstrap at `/usr/local/lib/fleet/bootstrap.sh` and the unit
  template, then starts `fleet-run@<N>.service`. The bootstrap (`fleet-bootstrap.sh`) reads the
  comment once, clones the engine at `engine=` into `/home/exedev/engines/<sha>`, and execs that
  checkout's `sandbox-boot.sh`, which runs the engine as a transient user service under the
  edge-injected Claude OAuth token (`claude-max` is an `http-proxy` that injects the bearer and
  nothing else — an injected header replaces the client's), serves status on port 8000, commits
  evidence to the target's `ultra/evidence-run-<N>` under `.ultrapowers/runs/<N>/` at every
  transition, and pushes `ultra/integration-run-<N>` and opens its own PR over REST with
  `prAuthor` recorded. The PR is the gate; there is no grant step. `claude-token.mjs` owns the
  credential (loom-style OAuth on the laptop, refresh token in the keychain, refreshed before every
  launch, single-flight — #602); `janitor.mjs` reads each fleet VM's comment and the target's
  evidence branch through `gh api`, never a VM's disk; `target.mjs` creates the per-target
  integration; `doctor.mjs` says which of its five rows is missing. The engine itself is untouched
  by the lift (#402): `run-main.mjs` (entry) →
  `run-engine.mjs` (deterministic waves), `run-worker.mjs` (`agent()` backed by one `claude -p`),
  `run-waves.mjs` (clones-at-BASE + `withPatchCapture`), `confine-hook.mjs` (the implementer's
  `PreToolUse` boundary), `fitness.mjs`, `roles/`. No orchestrator, no control VM, no token on
  any VM and none in any argv — the orchestrator, its TinyBase store, the tunnel, the run shim,
  `drive-one.mjs`, `race.mjs` and `waves.js` went between 0.3.0 and 0.3.5, and the
  `popmechanic/fleet-runs` state repository, the golden image and its build script were deleted at
  #597. Own npm deps in `fleet/package.json`; tests join the suite via `tests/test_fleet_suite.py`.
  Not plugin machinery — the sandbox clones the engine at the sha the assignment names, so changes
  here never require a plugin release.

## Wayfinding (program-scale routing) — decided on #180

- **Brainstorm vs wayfind:** multi-session + foggy + many open decisions → chart a
  wayfinder map (decision tickets labeled `wayfinder:*`); a single effort you can spec
  in one sitting → `superpowers:brainstorming` as usual. Layering: wayfinder charts
  programs; a map's destination is a spec that feeds ultrawrite + /ultrapowers
  unchanged.
- **Ticket ownership = label:** `wayfinder:grilling|research|prototype` tickets run their
  named mattpocock method — no superpowers ceremony fires (they produce decisions, not
  code); `wayfinder:task` and any code-producing work drops into the normal superpowers
  flow. Docket triage skips `wayfinder:*` issues.
- **Label ontology (audit of 2026-09-04, 68 issues):** exactly one KIND
  (`wayfinder:map|grilling|research|prototype|task`, `bug`, `enhancement`, `experiment`,
  `watch-item`) plus at most one PROGRAM (`merge-frontier`, `experience-compiler`,
  `verification-frontier`, `peer-review`, `fleet`, `determinism`, `blackboard`). `one-driver`, `authoring-frontier` and
  `distill` are retired — off every open issue, kept on closed ones for history.
  **Test doctrine (operator, 2026-09-09):** the implementer never does TDD (it iterates against the suite and writes no test of its own); the peer exam plus driver-run probes are the proof, and the whole suite as a gate is the assumption map #870 is retiring — measured, never on a narrative.
- **Superpowers is HITL-only:** fleet sandboxes provision ultrapowers + engine only —
  superpowers never enters a sandbox. Revisit migrating off it only on a third
  version-skew incident, with a measured case.
- **"Frontier" is always qualified:** *merge frontier* (fold kernel) / *map frontier*
  (takeable wayfinder tickets) / *docket frontier* (run-integration tree). Bare
  "frontier" is banned in specs, docs, and issues.
- **Retired map — #366 *The One Driver* (chartered 2026-08-28, destination reached at 0.3.0).**
  The cutover shipped: the engine is `fleet/run-engine.mjs`, there is no LLM orchestrator and
  no Workflow tool, and `waves.js` + 118 tests were deleted (`44e0d15`) only after runs 26/27
  came back green. Read it as history, not as direction. Two of its rules outlive it and are
  enforced elsewhere: **cap what an agent is MADE to read, never what a file stores** — and
  every refusing word ceiling is now gone: the SKILL.md ceilings at #492 (three observed harms,
  zero observed saves) and the last role-file ceiling at #496 (closed 2026-09-01). Prose sizes
  are *reported* (CI's *Report skill prose sizes* step, `wc -w`, release
  commit bodies) and gate nothing; the one surviving role-file pin is stylistic (no shouted
  imperatives). A budget a task cannot meet is a demolition order.
  Also standing: **deletion is owed
  per guard** — ballast goes behind a measurement gate, never on an incident narrative. Its
  design inputs, incl. Amendments 4–6 (sign intent, derive the plan, no verbatim implementation
  code, per-run token cap deleted) and #382's measured cache rows, remain the standing record in
  `docs/superpowers/specs/2026-08-28-one-driver-design-inputs.md`.
- **Retired map — #238 *The Authoring Frontier* (destination reached 2026-09-01):** #239
  answered yes (six-slot claims-v1 grammar), #390 shipped it at 0.3.2 (`ultrawrite`;
  the prior authoring skill + the writing-plans dependency deleted). Read as history.
- **Retired map — #589 *Fleet on the grain* (chartered 2026-09-03, closed as shipped
  2026-09-04):** 60% of `fleet/` was ssh shuttling between a laptop, an orchestrator VM and a
  sandbox; one lift (0.3.5, a single day, spec `docs/superpowers/specs/2026-09-03-fleet-on-the-grain.md`
  with Shelley's Counsel 2/3 as the authority) replaced it with exe.dev primitives — the comment
  as assignment, credentials at the edge, a systemd template unit, git as the record — and 0.3.6
  collapsed the grant into one integration per target attached at launch. The `fleet` program
  continues as tickets #597 #598 #387 #513 #384 #383 #548 #601, with no map.
- **Open maps:** #876 *Viz* (chartered 2026-09-10: a live model of the fleet the operator watches turn — `events.jsonl` rows + the `status.json` register as a projection, never a writer; the tag as replay; a TinyApp on the committed stack, the first reader of whatever #810/#814 pick as the store; tickets #877 serve the log + per-task cells → #878 grilling → #879 read-path research → #880 prototype as one of #867's three TinyApps; retires #866); #870 *The Suite as Sensor* (chartered 2026-09-09 after Böckeler's *TDD in the agent loop*: acceptance is exams + probes + state exams, the target's suite is a reported sensor with attribution, mutation is the meter, zero-catch tests are deleted behind the catch counter; tickets #871 grilling → #872 one-release experiment → #873 ratchet; its first form is #862's early off-path baseline); #810 *The Blackboard* (chartered 2026-09-09: where agents talk — a per-run TinyBase
  tuple space of facts, never commands; row = evidence, cell = status, readiness = a fold at read
  time; the record as the scheduler; tickets #811 grilling first, #812 interface-handshake
  prototype, #813 readiness-fold research gated on an order-shuffled fold sim, #814 = #485's
  live-record question); #551 *Peer Review* (chartered 2026-09-02: the plan is a submission — one
  operator sentence per plan, the exam written by a peer worker in wave 0, the gate as editor;
  #553 examiner / #554 clause-to-leg / #555 BASE-facts Context / #556 collaborative review all
  shipped; live tickets #232 #526 #572 #582; #599 (should exams be sealed again?) closed
  2026-09-04 — exams stay recorded-and-reviewed, sealing returns only on a run that shows a
  gaming shape. Its rules: the exam is written by a peer, never the submitter or the editor;
  the plan names nothing it does not Produce/Consume outside a tool-generated BASE-facts block;
  one signature per plan; review is collaborative and independence is authorship, not secrecy —
  the implementer runs the peer's exam; an edit to it is recorded as `examEdited`, named to the
  referee, and reviewed — never refused by the driver, since 2026-09-02); #525 *The Verification
  Frontier* (review finds truth it cannot enforce — three generations of
  blocking-findings-that-could-not-block; tickets #518/#519/#232, experiment queue
  #511→#522→#462→#516, single novelty per run window; run-57 was the first run that did block,
  on a real defect); #414 *Experience Compiler* (run = event log, ledger = wiki, learning =
  fold); #485 *The Record* (re-chartered 2026-09-04: the TinyBase store's deletion at 0.3.5 was
  approved inside #589 but never argued on its own, so the destination is now *what is the
  live multi-run record — git, a hub (#601 prototype), or a CRDT again — and what does each
  delete?*); #360 *The Merge Frontier* (the Manyana fold kernel — read its §Ground truth and
  §Rules before any kernel work; never patch `skills/ultrapowers/kernel/vendor/manyana.py`, it
  is sha-pinned on purpose). **One piece moved out of #360 by One Driver Amendment 9
  (2026-08-29): the kernel's INPUT SHAPE** — it takes patches against BASE instead of
  `--branch <task>=<branch>:<sha>`, so no worker needs shared refs and the worktree-vs-clone
  question dissolves. Semantics, layering and the sha-pin are untouched and still #360's.
  **Isolation and CRDT merging are substitutes:** `compile_plan.py` has defaulted to
  `overlap=fold` since the 2026-08-14 A/B (0.640× wall), so same-file concurrent writes are the
  shipped default — a substrate that isolates harder than the kernel needs is buying nothing
  and costing width.
- **One merge, one writer.** Manyana merges file *content* at the fold, and that is the only
  merge in the system. Run STATE has exactly one writer per run — the sandbox — and its record
  is git: `.ultrapowers/runs/<N>/status.json` plus the receipts, on the target's
  `ultra/evidence-run-<N>` branch, committed at every transition,
  `pull --rebase` on a non-fast-forward. The pre-0.3.5 "row axis / cell axis" store rule
  (TinyBase MergeableStore, HLC-stamped per slot, *status is a register, evidence is a set,
  totals are folds*) is history with the store; whether the live multi-run record wants a CRDT
  again is #485's question, not a rule here.

## Doctrine (operator, 2026-09-03/04)

- **No small measures while broken** — when the product is broken, replace the shape confidently
  and keep the old one as the rollback; do not hedge with partial fixes. Reason, in the operator's
  words: "if it doesn't work, we can always roll back" — #589 shipped as one lift in a day where
  four gated slices had been planned, and the old fleet stayed up as the rollback until the new
  one had driven runs.
- **Don't vendor the vendor** — before building a mechanism, ask whether exe.dev already provides
  it (identity, credentials at the edge, the VM comment, tags, the first-boot setup script, cold
  start). Reason: a custom OCI base image was rejected on exactly this ground on 2026-09-04
  ("vendoring exe.dev's staged-image cold start"), so #597 is plain `new` + a setup script.
- **Ask Shelley before any VM-side hack** — on any papercut on a VM or in a lobby verb, put the
  symptom, what was tried and the constraint to Shelley (exe.dev's assistant, on `fleet-counsel`;
  `--model=claude-opus-5` reads files, Sol stalls on them; the lobby link drops on long answers —
  read back with `shelley client read`) before editing a script; a hack is only a bridge she has
  blessed. Reason: runs 65–69 each died on one VM-side papercut and each got a same-hour hack, and
  every one of them had an exe-native shape she named on first ask (memory
  `trust-shelley-on-exe-dev`, `papercut-ledger-2026-09-03`).
- **Run in parallel; same-file overlap folds at publish** — plans are launched concurrently whatever
  files they share: with `strict=true` + `enforce_admins` on main (2026-09-08), a PR whose base moved
  is refused with a 405 and the sandbox folds its branch onto the new main again, so a second run's
  edits to the same file meet the first's in the kernel, not in a GitHub squash. Reason: decision 11
  (#715), read on the 8-wide drain of 2026-09-08 — four kernel-seen pairs (`run-engine.mjs`,
  `skills/ultrawrite/SKILL.md`, `test_publish_fold.mjs`, `CONTRACT.md` + `compile_plan.py`) all folded
  green with zero conflicts, which met the pre-registered condition and retired the earlier rule
  ("run in parallel wherever file sets are disjoint"). Caveat on the record: every one of those
  joins was line-disjoint, so the resolver's only real fold is still run-36 (2 misses, 2026-09-07);
  the next drain that produces a conflict is the resolver's measurement, not a reason to serialize.
  Allocated vCPU stays over-committable (48 on a 16-vCPU plan during that drain), so contention, not
  allocation, bounds concurrent runs.
- **Handoffs are opt-in** — a session starts from the operator's intention, never from the last
  session's agenda; read `.claude/ultrapowers/handoffs/` only when asked to resume (operator,
  2026-08-31, reversing #469's auto-discovery).
- **Author plans concurrently from the issues** — the procedure is `skills/ultrawrite/SKILL.md` §Authoring a queue: partition by files, one author per bundle, the issue's sentence as the Claim, two operator touches per plan, launches serial (memory `parallel-authoring-from-issues`).
- **No local scheduled process, ever** — the rule is `skills/ultrapowers/SKILL.md` §Client step 5: the launcher reaps, by hand after a sleep, no scheduled job on this machine.
- **Every choice is an AskUserQuestion** — 2–3 concrete options with their consequences and a
  `(Recommended)` tag, never a bare open question; the operator adjudicates, they do not author
  (memory `operator-elicitation-style`; since 2026-09-04 it binds the #598 setup agent too).

## How features are built here

Brainstorm → spec in `docs/superpowers/specs/` → `ultrapowers:ultrawrite` → plan in
`docs/superpowers/plans/` → execute (subagent-driven, or `/ultrapowers` itself) → PR.
Every spec gets a **neutral fresh-context review** before operator
review (operator decision 2026-09-01, superseding the adversarial trim review — built for
the complexity-creep era; #519 had already demoted trims): the reviewer hunts
under-specification, scope reconciliation, and contradictions, with trim proposals
welcome but not the mandate; the spec carries a `## Spec review` section with
adopt-or-answer for every finding. Historical specs carry `## Trim review` sections
(dispatch brief still in `skills/ultralearn/references/distilling-proposals.md` §The spec review).
A prose or procedure task proves itself with a `- Run:` bullet — a command the driver
executes and an output a person can read —
never a sentence matched against itself (#592; the 224 prose-pin tests in 25 files that did
exactly that were deleted in the lift, and `tests/test_docs_agree_with_code.py` keeps the
structural dozen).

## Conventions & gotchas (non-obvious — read before editing)

- **Versioning:** 0.x.y — minor bumps for architectural releases (0.1.0 = the subtraction
  release), patch bumps otherwise — the 0.3.5 lift stayed a patch on the operator's call ("we're
  still fixing the features that .3 was meant to deliver"). A release bumps **both** `plugin.json`
  **and** `marketplace.json` to the same value — 0.3.25 today — `plugin.json` wins silently if
  they drift, and they have. Shipping one is itself fleet work: a release is a fleet plan, whose
  H1 is the `chore(release): 0.x.y — …` line and whose one task bumps both manifests to the new
  version and edits this bullet's version. The PR is opened and merged by the sandbox (the squash
  commit's title is that H1), and the operator then runs `gh release create v0.x.y` with the
  notes. 0.3.25 (2026-09-10) was the first release shipped this way.
- **The depth-1 guard retired with CI** — #712 deleted the engine's depth-1 rehearsal and left
  the workflow's default-depth checkout standing in for it, the one thing that would fail a
  history-coupled test. That premise died with the workflow (2026-09-10, #871 decision 13):
  since 0.3.5 every fleet clone is the sandbox's own full clone at BASE and no live path runs
  git against a shallow boundary, so there is no depth-1 case left to rehearse.
- **The verification periphery is ordinary code (2026-09-10, #871).** The gate scripts
  (`gate_check.py`, `ultra_gate.py`) and the compiler's diagnostic vocabulary are edited
  like anything else here — no eval-measured regression is owed in front of a change.
  What they are worth is measured instead, on #872's pre-registered readings: critical-path
  minutes, the suite verdict at both sites (the task's own clone and the adopted tree), how
  many PRs were held and what came of them, catches per release, and regressions found
  later. The 0.1.0 freeze ended with the two things it was protecting — the plan-level
  Acceptance line and the advisory tier — both of which are gone.
- **Judgment prompts are data files.** `fleet/roles/*.md` (sizes reported, not gated —
  #496) are read at dispatch by `fleet/run-engine.mjs` — the single copy; the pre-0.3.0 bake/re-bake convention and its drift pin are deleted with
  `waves.js`. `references/plan-markers.md` is the runtime half only (its authoring rules
  were deleted at #390), and the execution-handoff rubric is still shared between
  `hooks/session_start.sh` and `ultrawrite/SKILL.md` (pinned by
  `tests/test_recommendation_rubric.py`).
- **Fleet engine sims ride the pytest suite.** `fleet/tests/test_*.mjs` are run by
  `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, 300 s per file, no network — `curl`,
  `git`, `gh`, `ssh`, `systemd-run` and `systemctl` are stubbed through a PATH shim).
- **The four operator documents are pinned to the code, not to their sentences.**
  `tests/test_docs_agree_with_code.py` reads `SKILL.md`, `first-run.md`, `fleet/RUNBOOK.md` and
  `README.md` and checks structure: every launch-line flag is in `launch.mjs`'s usage, the
  doctor's `ROW_IDS` are `first-run.md`'s headings in order, every `fleet/*.mjs|sh` named exists,
  the contract's literals (the unit, the engine directory, the VM name) are the ones taught, and
  the retired vocabulary of the pre-lift fleet appears nowhere. Reword freely; do not name a
  script that is not there.
- **No direct Anthropic API calls in repo code.** A distributed plugin must need no API key. LLM work
  happens inside Claude Code (the agent loop / `claude -p`), which rides the user's subscription — do
  not add the `anthropic` SDK or `ANTHROPIC_API_KEY` to any shipped or dev script. On the fleet the
  subscription reaches the sandbox as an edge-injected bearer: `ANTHROPIC_BASE_URL` points at
  `claude-max.int.exe.xyz`, `CLAUDE_CODE_OAUTH_TOKEN` is a placeholder, and `claude auth status`
  has to show `oauth_token` — a run showing `x-api-key` is billing somewhere else.
- **The installed plugin lags the repo.** Editing files here does not change the running plugin until
  `/plugin` re-resolves the new version (interactive terminal only) **and** a new session starts. Skill
  text reloads in-session; hook/manifest changes need a new session.
- **Session handoffs, when the operator asks to resume:** the notes are in
  `.claude/ultrapowers/handoffs/` — **sort by mtime, never by filename**, since handoffs are named
  for the session they are FOR (`2026-09-04-*.md` can be older than `2026-08-31-*.md`). Treat any
  handoff as *what was true when it was written*: verify before acting on it, and expect a stale
  one, since nothing prunes them. `.claude/` is in `.git/info/exclude`, so a fresh clone, a fleet
  sandbox and CI all correctly find nothing.
- **TinyApp is the name (operator, 2026-09-08).** A greenfield target on the committed stack —
  Bun + TypeScript + TinyBase — in its synced shape (a TinyBase MergeableStore in the client, a
  WsSynchronizer to a Durable Object with a SQLite persister) is a *TinyApp*; an app whose store
  is not synced to a Durable Object is not one. The borrowed term "vibes app" is banned in specs,
  docs, issues and skills. The authoring rule is `skills/ultrawrite/references/greenfield-stack.md`.
- **`superpowers` is an optional companion, not a dependency (#390).** Plan authoring is
  `ultrawrite`'s; brainstorming and the practice skills are still worth reaching for when the
  operator has them installed. There is no local checkout and nothing is vendored — read those
  skills from the plugin cache (`~/.claude/plugins/cache/.../superpowers/<ver>/`).
