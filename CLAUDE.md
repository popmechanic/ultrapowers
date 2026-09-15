# CLAUDE.md

## Purpose & vision

ultrapowers authors a plan and then executes it in parallel. Where a sequential executor
works a plan one task at a time, ultrapowers compiles it into dependency-ordered waves and
executes them as a fleet of `claude -p` workers on a disposable exe.dev sandbox, driven by
the deterministic engine in `fleet/run-engine.mjs`: each worker gets a clone at BASE, its
patch is captured, and the kernel folds each wave — no LLM orchestrator, no Workflow tool
(since 0.3.0), and since 0.3.5 no orchestrator VM either: the sandbox owns its run and
opens its own PR.

The aim is to move where humans spend their attention. ultrapowers keeps users
closely involved in **planning** — deciding what to build and how it will be
verified — and much less involved in **implementation**, which the engine fans out,
reviews, and integrates autonomously up to a single pre-merge gate. That makes
ambitious work approachable for less-technical operators: ultrapowers is built for
large, complex tasks that reward parallelism and independent verification.

This file is for agents **developing the plugin**; end-user docs are in `README.md`.

## Commands

```bash
python3 -m pytest                                                            # the test gate (pytest.ini scopes it to tests/)
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers      # validate a skill dir
python3 skills/ultrapowers/scripts/compile_plan.py <plan.md>                 # compile a plan to its waves
node fleet/doctor.mjs --json                                                 # which fleet prerequisite is missing
node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <sha>         # one run on the fleet
python3 skills/ultrapowers/scripts/catch_counter.py --ledger <f> <path...>   # what a test file has ever caught
python3 skills/ultrapowers/scripts/catch_report.py --ledger <f> --tree .     # the deletion candidates that reading names
```

Nothing runs on push or on a pull request. The check is the fleet run's own gate
(`ultra_gate.py`, reading the suite result the engine recorded): a PR merges from the
sandbox once that gate is green, and a release's check is the confidence run on the merged
engine. `python3 -m pytest` is the same suite by hand; it bridges every
`fleet/tests/test_*.mjs`, the engine sims included.

## Layout

- `skills/ultrapowers/` — the operator skill: `SKILL.md` (the thin client — commit the plan,
  launch the fleet), `scripts/` (`compile_plan.py`, the gate pair `gate_check.py` +
  `ultra_gate.py`, `ultra_run.py`, `finalize_report.py`, `validate_skill.py`, and the catch
  counter pair), `references/` (`first-run.md` walks each doctor row for a first-timer), and
  `kernel/` — the fold: `fold_wave.py`, `frontier_fold.py`, `hunks.py`, `repo_weave.py` over
  the sha-pinned `vendor/manyana.py`. **The engine itself lives in `fleet/run-engine.mjs`
  since 0.3.0** (models never run git); its judgment prompts are plain files in
  `fleet/roles/*.md` — one copy, no bake step.
- `skills/ultrawrite/` — the plan-authoring skill: the claims-v1 grammar (six body slots,
  contracts signed and edges derived; `- Run:` proofs since #592), plus
  `references/greenfield-stack.md`, the provenance/base-fact scripts, and
  `scripts/authoring_census.py` (`--fetch` a run range, `totals:` for the release notes).
- `hooks/session_start.sh` — injects the plan-routing rule into every session. The rule lives
  there, not here.
- `.claude-plugin/{plugin.json,marketplace.json}` — manifest + marketplace entry; the version
  lives here.
- `docs/superpowers/{specs,plans}/` — design docs, named `YYYY-MM-DD-<topic>.md`. Specs are the
  signed input; `plans/` holds the claims-v1 plans ultrawrite emits (plus each plan's
  `.gate-verdicts.json`). **Untracked since #544 (2026-09-02):** the whole of
  `docs/superpowers/` is in `.git/info/exclude` and `docs/README.md` is the tracked stub. A
  plan reaches the fleet only as `.ultrapowers/plan.md`, one commit on the run's base that
  `fleet/launch.mjs` pushes to the TARGET repository before any VM exists. A plan may not ask
  a worker to read a spec path — the sandbox has none.
- `evals/` — the A/B harness (`ab_runner.py`, `judge.py`, `frontier/`) and its recorded
  results. `evals/fixtures/claims/` is the one sample plan left: the compiler's probe fixture.
  **Untracked since #544 step 4 (2026-09-08):** `evals/frontier/corpus/` and
  `evals/frontier/results/` are ignored by `.gitignore`, `evals/frontier/README.md` is the
  tracked stub, and the durable copy is the laptop.
- `fleet/` — the fleet in its **target-owns-the-record** shape (0.3.5 lift, 0.3.6 grant
  collapse, #597/#598 the move onto the target). `fleet/CONTRACT.md` is the authority for
  every literal and `fleet/RUNBOOK.md` the operator procedure — the contract wins.
  `launch.mjs` validates (hash pins, then `compile_plan.py --check --base` through the exec
  seam — its `BASE fact:` lines and its `STALE fact:` lines print on the launch line),
  reads the pool from
  `billing plan --json`, computes N from the target's own `ultra/*-run-*` branches, refreshes
  the Claude bearer, pushes the plan as one commit on base to `ultra/plan-run-<N>`
  (tree = base + `.ultrapowers/plan.md`), then issues ONE lobby verb: a per-run `new` carrying
  the VM name `fleet-r<N>-<stamp>-<rand>`, `--tag fleet`, the assignment as `--comment`, both
  integrations, `--cpu`/`--memory` from `~/.ultrapowers/fleet.json`, and the generated setup
  script on stdin — no image to copy, no attach, no ssh wait, no explicit start. The setup
  script installs the toolchain, the immutable bootstrap at `/usr/local/lib/fleet/bootstrap.sh`
  and the unit template, then starts `fleet-run@<N>.service`. The bootstrap
  (`fleet-bootstrap.sh`) reads the comment once, clones the engine at `engine=` into
  `/home/exedev/engines/<sha>`, and execs that checkout's `sandbox-boot.sh`, which runs the
  engine as a transient user service under the edge-injected Claude OAuth token (`claude-max`
  is an `http-proxy` that injects the bearer and nothing else), serves status on port 8000,
  commits evidence to `ultra/evidence-run-<N>` under `.ultrapowers/runs/<N>/` at every
  transition, and pushes `ultra/integration-run-<N>` and opens its own PR over REST with
  `prAuthor` recorded. The PR is the gate; there is no grant step.
- **The record is two tags**, both on the target: `ultra/plan/run-<N>` on the plan commit and
  `ultra/evidence/run-<N>` on the final evidence commit. Publish tags both, verifies them with
  `git ls-remote --tags`, then deletes the two branches in the same step — so
  `.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>` is how a past run is read, and
  a tag that does not verify keeps its branch. A run that ends `failed` keeps both for the sweep.
- `fleet/`, the rest of it — `claude-token.mjs` owns the credential (loom-style OAuth on the
  laptop, refresh token in the keychain, refreshed before every launch, single-flight);
  `janitor.mjs` reads each fleet VM's comment and asks the kata hub for the run issue's state,
  falling back to the target's evidence through `gh api` only when the hub is dark, never a
  VM's disk; `target.mjs` creates the per-target integration; `doctor.mjs` says which of its
  eight rows is missing. The engine proper is `run-main.mjs` (entry) → `run-engine.mjs`
  (deterministic waves), `run-worker.mjs` (`agent()` backed by one `claude -p`),
  `run-waves.mjs` (clones-at-BASE + `withPatchCapture`), `confine-hook.mjs` (the implementer's
  `PreToolUse` boundary), `fitness.mjs`, `roles/`. No orchestrator, no control VM, no token on
  any VM and none in any argv. Own npm deps in `fleet/package.json`. Not plugin machinery —
  the sandbox clones the engine at the sha the assignment names, so changes here never require
  a plugin release.
- `fleet/tests/` — the surviving sims, every `test_*.mjs` there (16 on 2026-09-14: the engine
  sims `test_run_engine_*.mjs`, the launcher sims `test_launch_*.mjs`, the boot sims
  `test_sandbox_boot_*.mjs`, `test_janitor.mjs`, `test_worker_kata_env.mjs` and
  `test_sims_are_hermetic.mjs`, which forbids a sim naming a sibling sim), plus the live
  `probe_*.mjs` (see `PROBES.md`) which are run by hand, not by the suite. They reach pytest
  through the bridge, `tests/test_fleet_suite.py`; the list is not enumerated here because it
  drifted twice in one week — `ls fleet/tests/test_*.mjs` is the list.

## Doctrine

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
  every one of them had an exe-native shape she named on first ask (the papercut ledger is
  on the fleet issues).
- **Run in parallel; same-file overlap folds at publish** — plans are launched concurrently whatever
  files they share: with `strict=true` + `enforce_admins` on main (2026-09-08), a PR whose base moved
  is refused with a 405 and the sandbox folds its branch onto the new main again, so a second run's
  edits to the same file meet the first's in the kernel, not in a GitHub squash. Reason: decision 11
  (#715), read on the 8-wide drain of 2026-09-08 — four kernel-seen pairs all folded green with zero
  conflicts (n=4 pairs, 8 runs, 2026-09-08), which met the pre-registered condition and retired the
  earlier rule ("run in parallel wherever file sets are disjoint"). Caveat on the record: every one
  of those joins was line-disjoint; the resolver's only real folds are run-36 (2 resolvers, merged)
  and run-44 (4 resolvers, 2 misses, suite red, caught), both 2026-09-07 —
  6 dispatches, 2 misses, both caught (n=6 dispatches, runs 36 and 44); the next drain that produces
  a conflict is the resolver's measurement, not a reason to serialize. Allocated vCPU stays
  over-committable (48 on a 16-vCPU plan during that drain), so contention, not allocation, bounds
  concurrent runs.
- **One merge, one writer.** Manyana merges file *content* at the fold, and that is the only
  merge in the system — never patch `skills/ultrapowers/kernel/vendor/manyana.py`, it is
  sha-pinned on purpose, and the kernel takes patches against BASE (One Driver Amendment 9) so
  no worker needs shared refs. Run STATE has exactly one writer per run — the sandbox — and its
  record is git: `.ultrapowers/runs/<N>/status.json` plus the receipts, committed at every
  transition and tagged at publish. `compile_plan.py` has defaulted to `overlap=fold` since the
  2026-08-14 A/B (0.640× wall, n=1 fixture; re-read 2026-08-30 at 0.594× over n=12 cells, 6
  fixtures, `evals/results/2026-08-30-one-driver-fold-ab.md`), so same-file concurrent writes are
  the shipped default: a substrate that isolates harder than the kernel needs is buying nothing and
  costing width.
- **Handoffs are opt-in** — a session starts from the operator's intention, never from the last
  session's agenda; read `.claude/ultrapowers/handoffs/` only when asked to resume (operator,
  2026-08-31). When you do read them, **sort by mtime, never by filename** — they are named for
  the session they are FOR — and treat one as *what was true when it was written*.
- **Author plans concurrently from the issues** — the procedure is `skills/ultrawrite/SKILL.md`
  §Authoring a queue: partition by files, one author per bundle, the issue's sentence as the
  Claim, two operator touches per plan, launches serial.
- **No local scheduled process, ever** — the rule is `skills/ultrapowers/SKILL.md` §Client step 5:
  the launcher reaps, by hand after a sleep, no scheduled job on this machine.
- **Every choice is an AskUserQuestion** — 2–3 concrete options with their consequences and a
  `(Recommended)` tag, never a bare open question; the operator adjudicates, they do not author
  (see §Working with the operator). And every sitting-level question is recorded with its pick in
  the plan's `authoring` record, so the Recommended `pick rate` is read per release and a
  recommendation taken every time is retired into a written default rather than asked again.
- **Test doctrine (operator, 2026-09-09).** The implementer never does TDD: it iterates against the
  suite and writes no test of its own. The peer exam plus driver-run probes are the proof, and the
  target's suite is a *reported sensor* with attribution, measured and never asserted on a
  narrative. Deletion is owed per file, on the reading: a test file that has never caught anything
  goes, and `skills/ultrapowers/scripts/catch_counter.py` is what turns that reading into the
  deletion. Ballast goes behind a measurement gate, never on an incident narrative. And every
  reading states how much it was read over: a reading row carries its `n=…` with the `window` it was
  read in, and no default flips under `n = 5 runs` — `20 tasks` for a per-task reading. A flip taken
  under the floor is an `experiment` on its map and carries its `rollback`; a fact read once (a kata
  seam, a trap) carries its `date`, not an n (operator, 2026-09-15, #994). The decision applied that
  floor to three readings: `#872`'s escapes reading is over the floor at `n=9` merged runs
  (131–140); the fold rule (`#1006`, one replay) stays an `experiment` until five, its rollback
  `foldAgeMs=0` — a fold at every landing; and one reviewer (`#974`) was flipped on `n=71` runs and
  stands.
- **The plan is a submission, not a contract (operator, 2026-09-15, #990).** A worker that changes a
  clause, a Files set or a sim outside its own Files has not broken the plan — it declares an
  amendment, in the open: a `driver:amendment` row on the evidence branch, an entry in the
  reviewer's lens, a line on the pull request card's list, and a count in the release census. A
  reviewer judges a declared amendment on its merits and never reverts it for being outside the
  plan. The plan-defect park stays exactly where it was — for a leg no implementation can pass, not
  for a Files set a worker outgrew. The reading kept is amendments per run and per task. Reason:
  run-133's task 1 made four such changes and merged clean, while run-2 died on the ambiguity — a
  compelled edit outside Files was ruled lawful in round 1, reverted by the fix round, blocked in
  round 2, and the task lost to `fix-loop-exhausted`.

## Working with the operator

- **They adjudicate, they do not author.** Put every decision as 2–3 concrete options with
  their consequences and a `(Recommended)` tag, through AskUserQuestion; never a bare open
  question. A signed Claim is drafted by the author and confirmed by the operator in one touch —
  the draft, its machine restatement and its summary in a single question; their edit is the Claim.
  Explain an idea; do not state it in the technical register and leave them to decode it.
- **They never read code or tests.** The trust chain is plan → peer exam → gate receipt →
  smoke. Quote receipts; never narrate a green.
- **Priorities, in tie-break order: quality, then tokens, then clock.** The simpler design wins
  whenever it costs none of the three. Per-task model tiering is the one thing never simplified
  away.
- **Times in Pacific, 12-hour clock.** The record stays UTC; chat converts.
- **Propose, then wait for "file it."** Tickets and issue comments follow an explicit ask;
  least machinery first.
- **Releases are 0.3.x patches** that bundle several merges behind a confidence run. A minor
  bump only on their explicit call; 0.3.28 stabilizes the 0.3 feature set and is not 0.4.0.
- **Three subscriber accounts.** Keychain names are the emails with `@` → `-`; a usage reading
  names its account; the rate window is measured, never cited as a bound.
- **Never run `caffeinate`** or touch power settings. Fleet runs survive laptop sleep.
- **Pull requests.** The sandbox merges its own. A hand PR uses `gh pr merge --auto --squash`;
  never delete a branch while auto-merge is pending, GitHub closes the PR.
- **When an engine gate is broken, route around the fleet:** offer to implement the signed
  plan inline first, not a relaunch.
- **The durable record is GitHub issues and PRs, the evidence tags and kata — not Claude's
  memory**, which was turned off on 2026-09-14. A fact worth keeping goes in an issue comment,
  the RUNBOOK's Traps, or here.

## Conventions & gotchas

- **Versioning:** 0.x.y — minor bumps for architectural releases (0.1.0 = the subtraction
  release), patch bumps otherwise — the 0.3.5 lift stayed a patch on the operator's call ("we're
  still fixing the features that .3 was meant to deliver"). A release bumps **both** `plugin.json`
  **and** `marketplace.json` to the same value — `.claude-plugin/plugin.json` carries `0.3.29`
  today — `plugin.json` wins silently if they drift, and they have. Shipping one is itself fleet
  work: a release is a fleet plan, whose H1 is the `chore(release): 0.x.y — …` line and whose one
  task bumps both manifests and edits this bullet's version. The PR is opened and merged by the
  sandbox (the squash commit's title is that H1), and the operator then runs
  `gh release create v0.x.y` with the notes.
- **Judgment prompts are data files.** `fleet/roles/*.md` are read at dispatch by
  `fleet/run-engine.mjs` — the single copy, no bake step. Their sizes are *reported* (`wc -w`,
  a release plan's `- Run:`) and gate nothing; a budget a task cannot meet is a demolition order.
  The one surviving role-file pin is stylistic (no shouted imperatives).
  `skills/ultrapowers/references/plan-markers.md` is the runtime half only — its authoring rules
  moved to ultrawrite at #390.
- **Fleet engine sims ride the pytest suite.** `fleet/tests/test_*.mjs` are run by
  `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, 300 s per file, no network — `curl`,
  `git`, `gh`, `ssh`, `systemd-run` and `systemctl` are stubbed through a PATH shim). A sim that
  touches the real network or the real repo is caught by `test_sims_are_hermetic.mjs`.
- **The boot serves a watcher, not just a status page.** `sandbox-boot.sh` copies
  `events.jsonl` beside the page every tick (temp file + `mv`, never a partial read) and commits
  evidence on `FLEET_COMMIT_EVENTS` lines or `FLEET_COMMIT_SECONDS` seconds, never on a tick with
  no new line — that cadence is the contract the live model of the fleet, map #876 *Viz*, reads.
  The page itself is its own repo on its own VM, not plugin machinery; what binds here is the
  cadence, pinned by `test_sandbox_boot_viz.mjs` against `fleet/CONTRACT.md` and
  `fleet/RUNBOOK.md`'s **Watch.** list.
- **Never force-rotate the Claude token while a run is live.** A refresh grant revokes the old
  access token at once, and every in-flight run dies on its next API call with
  `401 OAuth access token has been revoked` before the edge carries the new one (run-103 was
  killed by a `refresh --force` for run-104's launch, 2026-09-11; run-92 the same way). The
  launcher's own refresh rotates only inside the four-hour window and is safe; run `refresh
  --force` only when `ssh exe.dev ls` shows no `fleet-r*` VM running. The sibling trap: a
  `usage` read rotates an expired account with `install: false` and leaves the edge holding a
  revoked bearer (run-100).
- **Kata seams, measured 2026-09-11.** Every `*.int.exe.xyz` hostname is `https://` (http 301s, and a
  followed 301 turns a POST into a GET — run-110). A `done` close needs a ≥40-character message
  (run-111). Hub writes are never the run's failure; the boot's ping is the one gate. The laptop reads
  the daemon with `ssh kata-hub.exe.xyz curl localhost:8000/api/v1/…`, the bearer from
  `~/.ultrapowers/kata-hub.env` passed on stdin, never on an argv.
- **No direct Anthropic API calls in repo code.** A distributed plugin must need no API key. LLM work
  happens inside Claude Code (the agent loop / `claude -p`), which rides the user's subscription — do
  not add the `anthropic` SDK or `ANTHROPIC_API_KEY` to any shipped or dev script. On the fleet the
  subscription reaches the sandbox as an edge-injected bearer: `ANTHROPIC_BASE_URL` points at
  `claude-max.int.exe.xyz`, `CLAUDE_CODE_OAUTH_TOKEN` is a placeholder, and `claude auth status`
  has to show `oauth_token` — a run showing `x-api-key` is billing somewhere else.
- **The installed plugin lags the repo.** Editing files here does not change the running plugin until
  `/plugin` re-resolves the new version (interactive terminal only) **and** a new session starts. Skill
  text reloads in-session; hook/manifest changes need a new session.
- **TinyApp is the name (operator, 2026-09-08).** A greenfield target on the committed stack —
  Bun + TypeScript + TinyBase — in its synced shape (a TinyBase MergeableStore in the client, a
  WsSynchronizer to a Durable Object with a SQLite persister) is a *TinyApp*; an app whose store
  is not synced to a Durable Object is not one. The borrowed term "vibes app" is banned in specs,
  docs, issues and skills. The authoring rule is `skills/ultrawrite/references/greenfield-stack.md`.
- **`superpowers` is an optional companion, not a dependency (#390).** Plan authoring is
  ultrawrite's. Fleet sandboxes provision ultrapowers + the engine only — superpowers never enters
  a sandbox. There is no local checkout and nothing is vendored; read those skills from the plugin
  cache (`~/.claude/plugins/cache/.../superpowers/<ver>/`) when the operator has them installed.
- **"Frontier" is always qualified:** *merge frontier* (the fold kernel) / *docket frontier* (the
  run-integration tree). Bare "frontier" is banned in specs, docs, and issues.
