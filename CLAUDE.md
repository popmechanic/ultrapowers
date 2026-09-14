# CLAUDE.md

## Purpose & vision

ultrapowers authors a plan and then executes it in parallel. Where a sequential executor
works a plan one task at a time, ultrapowers compiles it into dependency-ordered waves and
executes them as a fleet of `claude -p` workers on a disposable exe.dev sandbox, driven by
the deterministic engine in `fleet/run-engine.mjs`: each worker gets a clone at BASE, its
patch is captured, and the kernel folds each wave — no LLM orchestrator, no Workflow tool,
and no orchestrator VM: the sandbox owns its run and opens its own PR.

The aim is to move where humans spend their attention. ultrapowers keeps users
closely involved in **planning** — deciding what to build and how it will be
verified — and much less involved in **implementation**, which the engine fans out,
reviews, and integrates autonomously up to a single pre-merge gate. That makes
ambitious work approachable for less-technical operators: ultrapowers is built for
large, complex tasks that reward parallelism and independent verification.

This file is for agents **developing the plugin**; end-user docs are in `README.md`.

## Commands

```bash
python3 -m pytest        # the test gate (pytest.ini scopes it to tests/)
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers   # validate a skill dir
python3 skills/ultrapowers/scripts/compile_plan.py <plan.md> --check      # compile a plan to its waves
node fleet/doctor.mjs --json                                              # which fleet prerequisite is missing
node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <sha>      # one run on the fleet
python3 skills/ultrapowers/scripts/catch_counter.py --ledger <ledger.jsonl> <test path>...
python3 skills/ultrapowers/scripts/catch_report.py --ledger <ledger.jsonl> --tree .
```

The last pair is the catch counter: what each test file has ever caught over a window of
runs, and the per-file reading that licenses deleting one.

## Layout

- `skills/ultrapowers/` — the operator skill: `SKILL.md` (the thin client — commit the plan,
  launch the fleet), `scripts/`, `references/` (`first-run.md` walks each doctor row for a
  first-timer). **The engine lives in `fleet/run-engine.mjs`** — models never run git; its
  judgment prompts are plain files in `fleet/roles/*.md`, one copy, no bake step.
- `skills/ultrawrite/` — the owned plan-authoring skill: the claims-v1 grammar (six body
  slots, contracts signed and edges derived, `- Run:` proofs). claims-v1 is the only grammar
  the compiler speaks; a plan without the `**Grammar:** claims-v1` header is refused before
  any VM exists.
- `hooks/session_start.sh` — injects the plan-routing rule into every session. That rule
  lives there, not here.
- `.claude-plugin/{plugin.json,marketplace.json}` — manifest + marketplace entry (the version
  lives here).
- `docs/superpowers/{specs,plans}/` — design docs, named `YYYY-MM-DD-<topic>.md`. Specs are
  the signed input; `plans/` holds the claims-v1 plans ultrawrite emits (plus each plan's
  `.gate-verdicts.json`). **Untracked:** the whole of `docs/superpowers/` is in
  `.git/info/exclude` and `docs/README.md` is the tracked stub. A plan reaches the fleet only
  as `.ultrapowers/plan.md`, and a plan may not ask a worker to read a spec path — the
  sandbox has none.
- `evals/` — the A/B harness (`ab_runner.py`, `ab_lib.py`, `compile_census.py`, `judge.py`)
  and `evals/fixtures/claims/`, the one sample plan repo left, used as test data by the
  compiler tests. `pytest.ini` keeps pytest from collecting anything under `evals/`.
  **Untracked:** `evals/frontier/corpus/` and `evals/frontier/results/` are ignored by
  `.gitignore`, `evals/frontier/README.md` is the tracked stub, and the durable copy is the
  laptop.
- `fleet/` — the fleet in its **target-owns-the-record** shape. `fleet/CONTRACT.md` is the
  authority for every literal and `fleet/RUNBOOK.md` the operator procedure — the contract
  wins. `launch.mjs` validates (hash pins, then `compile_plan.py --check --base` through the
  exec seam — its `BASE fact:` lines print on the launch line), reads the pool from
  `billing plan --json`, computes N from the target's own `ultra/*-run-*` branches and
  `ultra/{plan,evidence}/run-<N>` tags, refreshes the Claude bearer, pushes the plan as one
  commit on base to `ultra/plan-run-<N>`, then issues ONE lobby verb: a per-run `new` carrying
  the VM name `fleet-r<N>-<stamp>-<rand>`, `--tag fleet`, the assignment as `--comment`, both
  integrations, `--cpu`/`--memory` from `~/.ultrapowers/fleet.json`, and the generated setup
  script on stdin — no image to copy, no attach, no ssh wait, no explicit start. The setup
  script installs the toolchain and the immutable bootstrap at
  `/usr/local/lib/fleet/bootstrap.sh`, then starts `fleet-run@<N>.service`. The bootstrap
  (`fleet-bootstrap.sh`) reads the comment once, clones the engine at `engine=` into
  `/home/exedev/engines/<sha>`, and execs that checkout's `sandbox-boot.sh`, which runs the
  engine as a transient user service under the edge-injected Claude OAuth token, serves status
  on port 8000 (what the live fleet page of #876 *Viz* reads — its own repo, not plugin
  machinery), commits evidence to the target's `ultra/evidence-run-<N>` under
  `.ultrapowers/runs/<N>/` at every transition, and pushes `ultra/integration-run-<N>` and
  opens its own PR over REST with `prAuthor` recorded. The PR is the gate. **A finished run is
  two tags on the target — `ultra/plan/run-<N>` and `ultra/evidence/run-<N>`** — written at publish,
  after which both branches are deleted; read a finished run by tag, never by branch.
  `claude-token.mjs` owns the credential (loom-style OAuth on the laptop, refresh token in the
  keychain, single-flight); `janitor.mjs` reads each fleet VM's comment and asks the hub for the
  run issue's state, falling back to the target's evidence through `gh api` only when the hub is
  dark, never a VM's disk; `target.mjs` creates the per-target integration; `doctor.mjs` says
  which of its nine rows is missing. The engine is `run-main.mjs` (entry) → `run-engine.mjs`
  (deterministic waves), `run-worker.mjs` (`agent()` backed by one `claude -p`), `run-waves.mjs`
  (clones-at-BASE + `withPatchCapture`), `confine-hook.mjs` (the implementer's `PreToolUse`
  boundary), `fitness.mjs`, `roles/`. No token on any VM and none in any argv. Own npm deps in
  `fleet/package.json`; the nine surviving sims under `fleet/tests/test_*.mjs` join the pytest
  suite through the bridge `tests/test_fleet_suite.py`. Not plugin machinery — the sandbox clones
  the engine at the sha the assignment names, so changes here never require a plugin release.

## Doctrine

- **No small measures while broken** — when the product is broken, replace the shape confidently
  and keep the old one as the rollback; do not hedge with partial fixes. Reason, in the operator's
  words: "if it doesn't work, we can always roll back" — the 0.3.5 fleet lift shipped in a day
  where four gated slices had been planned, and the old fleet stayed up as the rollback until the
  new one had driven runs.
- **Don't vendor the vendor** — before building a mechanism, ask whether exe.dev already provides
  it (identity, credentials at the edge, the VM comment, tags, the first-boot setup script, cold
  start). Reason: a custom OCI base image was rejected on exactly this ground ("vendoring exe.dev's
  staged-image cold start"), so provisioning is plain `new` + a setup script.
- **Ask Shelley before any VM-side hack** — on any papercut on a VM or in a lobby verb, put the
  symptom, what was tried and the constraint to Shelley (exe.dev's assistant, on `fleet-counsel`;
  `--model=claude-opus-5` reads files, Sol stalls on them; the lobby link drops on long answers —
  read back with `shelley client read`) before editing a script; a hack is only a bridge she has
  blessed. Reason: runs 65–69 each died on one VM-side papercut and each got a same-hour hack, and
  every one of them had an exe-native shape she named on first ask.
- **Run in parallel; same-file overlap folds at publish** — plans are launched concurrently whatever
  files they share: with `strict=true` + `enforce_admins` on main, a PR whose base moved is refused
  with a 405 and the sandbox folds its branch onto the new main again, so a second run's edits to the
  same file meet the first's in the kernel, not in a GitHub squash. Caveat on the record: nearly every
  kernel-seen join so far was line-disjoint, so the next drain that produces a conflict is the
  resolver's measurement, not a reason to serialize. Allocated vCPU stays over-committable, so
  contention, not allocation, bounds concurrent runs.
- **Handoffs are opt-in** — a session starts from the operator's intention, never from the last
  session's agenda; read `.claude/ultrapowers/handoffs/` only when asked to resume. They are named
  for the session they are FOR, so sort by mtime, never by filename, and treat any handoff as what
  was true when it was written.
- **Author plans concurrently from the issues** — the procedure is `skills/ultrawrite/SKILL.md`
  §Authoring a queue: partition by files, one author per bundle, the issue's sentence as the Claim,
  two operator touches per plan, launches serial.
- **No local scheduled process, ever** — the rule is `skills/ultrapowers/SKILL.md` §Client step 5:
  the launcher reaps, by hand after a sleep, no scheduled job on this machine.
- **Every choice is an AskUserQuestion** — 2–3 concrete options with their consequences and a
  `(Recommended)` tag, never a bare open question; the operator adjudicates, they do not author.
- **One merge, one writer.** Manyana merges file *content* at the fold, and that is the only merge
  in the system. Run STATE has exactly one writer per run — the sandbox — and its record is git:
  `.ultrapowers/runs/<N>/status.json` plus the receipts, committed at every transition and tagged
  at publish, `pull --rebase` on a non-fast-forward. Before any kernel work, read the fold's ground
  truth and rules in `fleet/CONTRACT.md`; never patch
  `skills/ultrapowers/kernel/vendor/manyana.py`, it is sha-pinned on purpose. The kernel takes
  patches against BASE, so no worker needs shared refs.
- **Test doctrine.** The implementer never does TDD — it iterates against the suite and writes no
  test of its own; the peer exam plus driver-run probes are the proof. The target's suite is a
  *reported* sensor with attribution, not the acceptance criterion. Deletion is owed per file on
  the catch counter's reading — a test that never caught anything goes, measured, never on a
  narrative. **Cap what an agent is MADE to read, never what a file stores:** prose sizes are
  reported (`wc -w`, a release plan's `- Run:`) and gate nothing. A budget a task cannot meet is a
  demolition order.

## Conventions & gotchas

- **Versioning:** 0.x.y — minor bumps for architectural releases, patch bumps otherwise. A release
  bumps **both** `plugin.json` **and** `marketplace.json` to the same value — 0.3.27 today —
  `plugin.json` wins silently if they drift, and they have. Shipping one is itself fleet work: a
  release is a fleet plan, whose H1 is the `chore(release): 0.x.y — …` line and whose one task bumps
  both manifests and edits this bullet's version. The PR is opened and merged by the sandbox (the
  squash commit's title is that H1), and the operator then runs `gh release create v0.x.y` with the
  notes.
- **Judgment prompts are data files.** `fleet/roles/*.md` (sizes reported, not gated) are read at
  dispatch by `fleet/run-engine.mjs` — the single copy, no bake step and no drift pin.
  `skills/ultrapowers/references/plan-markers.md` is the runtime half only; the execution-handoff
  rubric is shared between `hooks/session_start.sh` and `skills/ultrawrite/SKILL.md`.
- **Fleet engine sims ride the pytest suite.** `fleet/tests/test_*.mjs` are run by
  `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, 300 s per file, no network — `curl`,
  `git`, `gh`, `ssh`, `systemd-run` and `systemctl` are stubbed through a PATH shim). The bridge
  globs the directory, so a deleted sim needs no edit here.
- **Never force-rotate the Claude token while a run is live.** A refresh grant revokes the old
  access token at once, and every in-flight run dies on its next API call with
  `401 OAuth access token has been revoked` before the edge carries the new one. The launcher's own
  refresh rotates only inside the four-hour window and is safe; run `refresh --force` only when
  `ssh exe.dev ls` shows no `fleet-r*` VM running. The sibling trap: a `usage` read rotates an
  expired account with `install: false` and leaves the edge holding a revoked bearer.
- **Kata seams.** Every `*.int.exe.xyz` hostname is `https://` (http 301s, and a followed 301 turns
  a POST into a GET). A `done` close needs a ≥40-character message. Hub writes are never the run's
  failure; the boot's ping is the one gate. The laptop reads the daemon with
  `ssh kata-hub.exe.xyz curl localhost:8000/api/v1/…`, the bearer from
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
- **TinyApp is the name.** A greenfield target on the committed stack — Bun + TypeScript + TinyBase —
  in its synced shape (a TinyBase MergeableStore in the client, a WsSynchronizer to a Durable Object
  with a SQLite persister) is a *TinyApp*; an app whose store is not synced to a Durable Object is not
  one. The borrowed term "vibes app" is banned in specs, docs, issues and skills. The authoring rule is
  `skills/ultrawrite/references/greenfield-stack.md`.
- **`superpowers` is an optional companion, not a dependency.** Plan authoring is ultrawrite's;
  brainstorming and the practice skills are still worth reaching for when the operator has them
  installed. There is no local checkout and nothing is vendored — read those skills from the plugin
  cache (`~/.claude/plugins/cache/.../superpowers/<ver>/`).
