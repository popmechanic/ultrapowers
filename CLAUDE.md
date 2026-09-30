# CLAUDE.md

For agents **developing the plugin**; end-user docs are in `README.md`. Path-scoped detail
loads from `.claude/rules/factory.md` (engine) and `.claude/rules/fleet.md` (launcher, VM,
record) when a session reads those trees.

## Purpose

ultrapowers authors a plan and then executes it in parallel. The operator stays closely
involved in **planning** (what to build, how it is verified) and barely in
**implementation**: a disposable exe.dev sandbox runs the plan as a board of tasks claimed by
a pool of builder agents, each task proved by the plan's own `Run:` probes and `Check:`
lines, merges their work continuously through the weave, and opens its own PR. No LLM
orchestrator, no orchestrator VM; the PR is the one gate.

**One engine: the Flock (map #1292 rule 8).** Every launch boots `factory/flock/engine.mjs`:
a leaderless swarm, an elastic builder pool, one weave replica per builder merged
continuously. The factory it replaced is retired; its rollback is a launch from a checkout
made before the retirement.

## Commands

```bash
python3 -m pytest                                                            # the test gate (pytest.ini scopes it to tests/; bridges fleet/tests/test_*.mjs)
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers      # validate a skill dir
python3 skills/ultrapowers/scripts/plan_parse.py <plan.md>                   # what the sandbox reads: tasks, edges, waves, checks
python3 skills/ultrapowers/scripts/plan_check.py --base <sha> <plan.md>      # the laptop's check: records, and the plan against its base
python3 skills/ultrapowers/scripts/run_probes.py <plan.md> [<task id>...]    # a plan's Run: probes on the working tree, one line each (never a hand loop)
bun skills/ultrawrite/stories/compile.ts <bundle> --app <dir> --plan-id <id> --date <YYYY-MM-DD> --out <plan.md>   # a bundle → a stories-v1 plan (the app needs bun install first)
bun skills/ultrawrite/stories/jev_checks.ts <bundle> [--ask-file <ask.txt>]    # code checks, then Jev's; --stage understanding|map|decompose reads product.json
bun skills/ultrawrite/stories/product.ts check|render|record <product.json> …   # the product record: its shape, its page in the operator's words, the operator's picks
bun factory/stack/tinyapp/check.ts --plan <plan.md> --clause S1.1 --copy <app>   # one story step against one copy (exit 0 pass, 1 finding, 2 could not run)
python3 evals/readings/checker_kit.py                                        # score the checker against a good todo app and broken copies (run when factory/stack/tinyapp/ changes)
node fleet/doctor.mjs --json                                                 # which fleet prerequisite is missing
node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <sha> --engine <sha>   # one run (the Flock); from this checkout, never the plugin cache
```

The plan and census scripts take positional arguments only (no `--help`); the story-planning
tools under `skills/ultrawrite/stories/` (Bun) take flags and print their usage.
Nothing runs on push or on a PR: the sandbox opens a ready PR when the engine's run ended green and a draft otherwise, so
the engine's exit code is the merge decision.

## Layout

- `skills/ultrapowers/` — the operator skill: `SKILL.md` (thin client: commit the plan, launch
  the fleet); `scripts/` — `plan_parse.py` (the one plan parser; the sandbox runs it),
  `plan_check.py` (the laptop's check on it), `validate_skill.py`; `references/`
  (`first-run.md` walks each doctor row); `kernel/` — sha-pinned `vendor/manyana.py`, the
  merge the Flock's weave (`factory/flock/weave.py`) runs.
- `skills/ultrawrite/` — plan authoring: the claims-v1 grammar (six body slots, contracts
  signed, edges derived, `- Run:` proofs), `references/` (`greenfield-stack.md`,
  `authoring-gotchas.md`), `scripts/` (provenance and base-fact pins, `authoring_census.py`),
  `stories/` (story planning for TinyApps in TypeScript: bundle loader, code and Jev
  checks, the compiler to `stories-v1`, the scaffold, the operator notebook), `catalog/`
  (ready pieces; `todo` first). The sandbox-facing half is
  `skills/ultrapowers/scripts/{probe_block,stories_parse,stories_check}.py`.
- `factory/` — the engine the sandbox runs (see `.claude/rules/factory.md`). Its npm deps are
  `factory/package.json`'s.
- `fleet/` — laptop tools (launcher, doctor, token, janitor, board reader) and the VM
  bootstrap (see `.claude/rules/fleet.md`). `fleet/CONTRACT.md` is the authority for every
  literal, `fleet/RUNBOOK.md` the operator procedure; the contract wins.
- `hooks/` — wired by `hooks/hooks.json`. `session_start.sh` injects the plan-routing rule
  (the rule lives there, not here). `keep_working.sh` is the Stop hook ultrawrite and
  ultrapowers declare in frontmatter: once either skill is invoked it blocks a turn's first
  stop while background work is running, and allows the second.
- `.claude-plugin/{plugin.json,marketplace.json}` — manifest and marketplace entry; the
  version lives in both.
- `docs/superpowers/{specs,plans}/` — design docs, `YYYY-MM-DD-<topic>.md`. **Untracked**
  (`.git/info/exclude`; `docs/README.md` is the tracked stub). A plan reaches the fleet only
  as `.ultrapowers/plan.md`, one commit on the run's base, so a plan may never ask a worker to
  read a spec path — the sandbox has none.
- `evals/` — recorded readings and results only. `evals/readings/` holds readings tools no
  skill invokes; `evals/fixtures/claims/` is the parser's probe fixture;
  `evals/frontier/{corpus,results}/` are gitignored and live on the laptop.
- `tests/` — pytest; `tests/test_fleet_suite.py` bridges every `fleet/tests/test_*.mjs`.

## Doctrine

- **No small measures while broken.** When the product is broken, replace the shape
  confidently and keep the old one as the rollback; don't hedge with partial fixes ("if it
  doesn't work, we can always roll back" — #589).
- **The engine's values, in tie-break order (map #1131):** the mechanical facts (never
  traded), then clock speed, then simplicity in lines and roles, then tokens. **A judgment is
  a question, never a sentence or a regex** (each lives in `factory/questions.json`; every
  threshold is a `factory/policy.json` cell with its rollback). Hand work has its own
  tie-break (§Working with the operator).
- **Don't vendor the vendor.** Before building a mechanism, ask whether exe.dev already
  provides it (identity, edge credentials, the VM comment, tags, first-boot setup script,
  cold start). #597 is plain `new` + a setup script for this reason.
- **Ask Shelley before any VM-side hack.** On a papercut on a VM or in a lobby verb, put the
  symptom, what was tried and the constraint to Shelley (exe.dev's assistant, on
  `fleet-counsel`; `--model=claude-opus-5` reads files; read long answers back with
  `shelley client read`) before editing a script. A hack is only a bridge she has blessed.
- **Run in parallel; same-file overlap folds at publish.** Launch plans concurrently whatever
  files they share: a PR whose base moved is refused (405, `strict=true` + `enforce_admins`)
  and the sandbox catches the run up to the new main (`factory/flock/catchup.mjs`, through the
  weave), so overlaps meet in Manyana (decision 11, #715;
  every join on record was line-disjoint). A conflict is the resolver's measurement, not a
  reason to serialize. Contention, not allocated vCPU, bounds concurrent runs.
- **One merge, many writers (#1292).** Every builder writes its own weave replica and merges its
  peers' in any order; no engine step is the sole merger. Manyana is the only merge in the system,
  so never patch `skills/ultrapowers/kernel/vendor/manyana.py` (sha-pinned). Same-file concurrent
  writes are the shipped default. Run state still has one writer, the sandbox, and its record is
  git; the laptop only reads it.
- **Handoffs are opt-in.** A session starts from the operator's intention; read
  `.claude/ultrapowers/handoffs/` only when asked to resume. Sort by mtime, never filename, and
  treat each as what was true when written.
- **Author plans concurrently from the issues:** `skills/ultrawrite/SKILL.md` §Authoring a
  queue — partition by files, one author per bundle, the issue's sentence as the Claim, two
  operator touches per plan, launches serial.
- **Enrich before drafting (2026-09-28).** Every TinyApp plan runs ultrawrite's own
  enrichment (`skills/ultrawrite/references/enrich.md`): intent, understanding, the
  whole product's map and the build order, into `product.json`, before any story.
  superpowers is never called for it. The operator is asked only what the app does,
  who uses it and how it looks.
- **No local process writes run state** (`skills/ultrapowers/SKILL.md` §Client step 5, #660):
  the sandbox is the one writer of a run and the launcher reaps by hand after a sleep, so
  nothing on a timer here merges, reaps or edits. Reading is telemetry and is wanted: watch a
  run with `fleet/board-read.mjs --follow`, in the background or on any cadence (operator,
  2026-09-29, narrowing the 2026-09-05 no-timer rule to writers).
- **Every choice is an AskUserQuestion:** 2–3 concrete options with consequences and a
  `(Recommended)` tag, always plus `Please explain` — which re-asks in place with the
  explanation written in, escalating from plain words to a before-and-after to a rewrite.
  Record every sitting-level question and pick in the plan's `authoring` record; a
  recommendation taken every time is retired into a written default.
- **The proof is probes-only.** The implementer never does TDD and writes no test of its
  own; a run's proof is the plan's `Run:` probes and `Check:` lines alone (the Flock selects
  no existing tests), and the target's suite is a reported sensor. A plan that must keep
  existing behaviour names the guarding tests in a `Check:` (e.g.
  `python3 -m pytest -q tests/test_fleet_suite.py -k launch`). A test file is pruned by hand,
  one per pull request that names what else guards its behaviour.
- **Readings carry their size (#994).** Every reading states its `n=…` and `window`; no
  default flips under `n = 5 runs` (`20 tasks` per-task). A flip under the floor is an
  `experiment` carrying its `rollback`; a fact read once carries its `date`.
- **Verification is mechanical and fast.** A probe computes facts (exit code, argv,
  byte-exact string, count, ordering, oracle agreement); "the code says X" is Jev's, read
  against the hunk at landing. A probe is one `Run:` line, one command, ending in the tag of
  the clause it proves — an untagged prover settles nothing. One case per behaviour. A run
  caught up to a moved main re-runs the plan's setup, probes and check on it. Answer a
  gate rejection by narrowing the clause, never by adding legs. A size budget is a note the PR
  reports, never a clause. Publish is shell, not a seam.
- **The plan is a submission, not a contract (#990).** A worker that outgrows a clause or its
  Files set declares an amendment in the open (`driver:amendment` row, the reviewer's lens,
  the PR card, the release census); a reviewer judges it on merits and never reverts it for
  being outside the plan. The plan-defect park is only for a leg no implementation can pass.

## Working with the operator

- **They adjudicate, they do not author.** A signed Claim is drafted by the author and confirmed in one touch (draft, machine
  restatement and summary in one question); their edit is the Claim. Explain ideas plainly,
  not in the technical register.
- **They never read code or tests.** The trust chain is plan → probes → gate receipt → smoke.
  Quote receipts; never narrate a green.
- **Hand-work priorities: quality, then tokens, then clock.** The simpler design wins when it
  costs none of the three.
- **Times in Pacific, 12-hour clock.** The record stays UTC; chat converts.
- **Propose, then wait for "file it."** Tickets and issue comments follow an explicit ask.
- **Releases are 0.3.x patches** bundling several merges behind a confidence run; a minor bump
  only on their call.
- **Three subscriber accounts.** Keychain names are the emails with `@` → `-`; a usage reading
  names its account; the rate window is measured, never cited as a bound.
- **Never run `caffeinate`** or touch power settings; fleet runs survive laptop sleep.
- **Pull requests.** The sandbox merges its own. A hand PR uses `gh pr merge --auto --squash`;
  never delete a branch while auto-merge is pending (GitHub closes the PR).
- **When an engine gate is broken, route around the fleet:** offer to implement the signed
  plan inline first, not a relaunch.
- **The durable record is GitHub issues and PRs, the evidence tags and kata** — Claude's memory
  is off. A fact worth keeping goes in an issue comment, the RUNBOOK's Traps, or here.

## Conventions & gotchas

- **Releasing.** Both `plugin.json` and `marketplace.json` carry the version;
  `plugin.json` wins silently if they drift. A release is one hand PR titled
  `chore: version 0.x.y — …` bumping both manifests, squash-merged, then a bare
  tag on that commit: `git tag v0.x.y <sha> && git push origin v0.x.y`. **No GitHub release**
  until the operator calls it production-ready. Notes go to
  `docs/superpowers/plans/<date>-release-0-x-y.notes.md` (untracked) with the census line.
- **The installed plugin lags the repo.** Edits here reach the running plugin only after
  `/plugin` re-resolves the new version (interactive terminal) **and** a new session starts.
  Skill text reloads in-session; hooks and manifest need a new session. The fleet is
  different: the sandbox clones the engine at the launch's `--engine` sha, so `factory/` and
  `fleet/` changes never need a plugin release.
- **No direct Anthropic API calls in repo code.** No `anthropic` SDK, no `ANTHROPIC_API_KEY`;
  LLM work runs inside Claude Code on the user's subscription. On the fleet it arrives as an
  edge-injected bearer (`ANTHROPIC_BASE_URL` → `claude-max.int.exe.xyz`,
  `CLAUDE_CODE_OAUTH_TOKEN` a placeholder); `claude auth status` must show `oauth_token` — a
  run showing `x-api-key` is billing elsewhere. TypeSafe (`api.typesafe.ai`) is reached the
  same way by the boot and engine, and from the laptop by ultrawrite's authoring checks
  (`skills/ultrawrite/stories/jev_checks.ts`, key in `~/.ultrapowers/typesafe.env`) — for
  judgments over prose, never generation or facts.
- **Never force-rotate the Claude token while a run is live.** A refresh revokes the old
  access token at once and every in-flight run dies with `401 OAuth access token has been
  revoked`. While `ssh exe.dev ls` lists a `fleet-r*` VM the token is `not rotated` — by a
  launch, a hand `refresh --force`, or a `usage` read — and a launch beside live runs needs
  `ninety minutes` or more left on the current sign-in, or refuses. A `usage` read on an
  expired account rotates with `install: false` and leaves the edge on a revoked bearer.
- **Fleet sims ride pytest.** `tests/test_fleet_suite.py` runs each `fleet/tests/test_*.mjs`
  (sentinel `ALL TESTS PASSED`, 300 s per file, no network — `curl`, `git`, `gh`, `ssh`,
  `systemd-run`, `systemctl` are PATH-shim stubs, which keep the network out);
  `test_sims_are_hermetic.mjs` catches a sim that inherits the parent's environment, reads an
  absolute path on the box, or runs a sibling sim.
- **Superpowers is an optional companion (#390).** Plan authoring is ultrawrite's; superpowers
  never enters a sandbox and nothing is vendored. Read its skills from the plugin cache.
- **TinyApp is the name** for a greenfield target on Bun + TypeScript + TinyBase whose
  MergeableStore syncs over WsSynchronizer to a Durable Object with a SQLite persister. The
  term "vibes app" is banned. Rule: `skills/ultrawrite/references/greenfield-stack.md`.
- **No shouted imperatives** in engine prompts.
- **macOS has no `timeout`**; fleet-counsel's system node is v18 (use `npx -y node@22`).
