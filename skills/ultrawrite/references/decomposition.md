<!-- Moved out of ultrawrite's SKILL.md to keep it under 500 lines. Commands here name the
     plugin directory as `<plugin-root>`; SKILL.md shows its real path. -->

## The worktree-pure contract

Every `implementation` task is a pure diff against the integration branch:

1. **Self-contained bodies.** A task agent sees only its own body — every coordination
   note (port assignments, shared literals) lives in the body of each task it affects,
   never only in a preamble.
2. **No branch instructions.** The executor owns branching.
3. **Concurrency-safe proofs.** Builders run their probes at once on one machine: unique port
   and temp path per test, no shared on-disk fixtures.
4. **Name only what exists.** Every path a slot cites must exist at BASE or be created by
   a task this one derivably follows. `docs/superpowers/` is untracked (#544) and absent
   from every sandbox, so a spec path is a reference for the reader, never something a
   worker is asked to open — put what the worker needs from a spec into Context.
5. **Claims about the live world carry their evidence.** A task asserting what a live
   system does is unverifiable from a sandbox — paste the commands and their output into
   Context so the builder and Jev check correspondence to a record, not truth they cannot
   reach.
6. **Isolate `CLAUDE_CONFIG_DIR`** in any task that spawns the agent CLI, or it writes
   false memories into the host project.
7. **Greenfield targets take the Bun + TypeScript + TinyBase defaults** — `bun install` to
   bootstrap, `bunx tsc --noEmit && bun test` as the suite, one TinyBase store as the
   app's state; the synced shape (store → WsSynchronizer → Durable Object) is a *TinyApp*.
   Both knobs verbatim, the `@types/bun` tsconfig gotcha, the TinyApp shape, and where the
   restriction stops: `references/greenfield-stack.md`. A TinyApp task is proven like any
   other, by `Run:` probes and the stack's `Check:` line.
   the stack's `Check:` line, until state exams return as probes (owed on map #1248).

## Decomposition judgment

Independence is a property of contracts, not of files.

1. **Split by default.** Every piece of work that can carry its own contract — a module
   with its own exports and its own tests — is its own task. Where a consumer would wait
   on a producer, put the shared shape (a schema, a signature, a file format) as one
   literal in the Context of every task that touches it, and give each side a probe that
   pins the literal, so an implementation that drifts from it goes red. A `Consumes:` of a sibling's `Produces:` orders the two,
   and a `Create:` a sibling task later `Modify:`s is the same kind of fact; a shared
   literal orders neither, so prefer the literal wherever the consumer only needs the
   shape. Workers have no shared memory — a chain of two tasks is two strangers in
   sequence, not one mind holding a design — so a chain buys no coherence, only the wait.
   One thing a literal cannot stand in for is the file itself: a probe that imports a sibling's created module
   (`from tests.trends_fixtures import …`, `import('./lib/a.mjs')`) is a `proof-run` edge
   the parser derives and the engine keeps hard under live pairs (#1265), so write the
   probe as it is and list nothing under `Modify:` to force the wait — the wait is derived.
2. **Write no ordering.** An author writes no ordering: the parser derives the edges, the
   Flock seeds its board with them, and a task becomes claimable once every task it depends
   on is done; every other task is claimable at once, and builders merge each other's
   published work continuously, so a same-file pair meets in the weave, not in a queue.
   `Consumes:`/`Produces:` bullets are still written exactly, one symbol per bullet,
   because they are how a pair is found — but the chain they imply is derived, never
   authored, and there is no width to state and no rationale line to write. An edge an
   author takes only to keep two same-file edits apart — not because a sibling needs the
   other's runtime behaviour — is a defect: on run-193 the author chained the engine task
   behind the hunk-picker task to keep two import inserts from meeting at merge, and the
   consumer waited on a producer it needed nothing from — about nine minutes of clock lost
   (n=1 run, 2026-09-18).
3. **Let same-file edits stand.** Builders merge each other's published work continuously
   through the weave, so concurrent same-file *text* writes meet there, and a shared hot
   file is never a reason to reshape a plan — let colliding `Modify` lines collide.
   Non-text (binary, symlink) same-file pairs are ordered automatically. Blast radius
   follows the contract, not the file: a task that changes a `Produces:` shape owns every
   strict-equality pin of it, in any sibling's file — list that file in its own Files
   block. One shape does not merge cleanly, though: N tasks that each add one line to one
   list are N **adjacent inserts at one location**, which merge as a conflict a builder
   must stop and resolve — run-12 (2026-09-05, PR #662) had five tasks each append one
   registration line to one registry file and spent 3.4 worker-minutes ordering five lines
   any order would have satisfied. Give each such task its **own region or file**: a
   registration is a new file discovered by glob, never an appended line.
   And when two tasks list one file, each of them carries a
   Run: probe of what that file must keep beyond its own change: run-277's two tasks each removed one name from one
   line and each probe checked only its own removal, so a line that fused two kept names
   went green (n=1 run, 2026-09-29). `plan_check.py` prints a `SHARED fact:` line for each
   such file.
4. **Prefer several small concurrent plans** landing on one main over one
   large plan (0.26× batch wall, n=1 drain of 3 runs, #454, 2026-09-01). An effort split
   across plans gives the **final** plan an integration-spanning acceptance — per-phase
   green never establishes integrated green — or declares the gap explicitly in the final
   plan. Never silently.

## Global Constraints discipline

`## Global Constraints` holds the spec's binding, cross-cutting requirements: version
floors, naming and copy rules, platform requirements. State what must be true **of the
result**. Process rules — TDD ordering, commit cadence, "write the failing test first" —
are never Global Constraints: no diff evidences the order work was done in, so nothing
could ever check them.

The section holds two kinds of bullet, and only one of them reaches the run. A `- Check:`
bullet is a command that runs across the whole run: the Flock reads the plan's `checks`
and the run settles green only when every one exits 0 — unless it ends `(minor)`, which is
never run. A prose bullet is read by people only: nothing runs it and nothing forwards it,
and no builder sees it, because a builder's task body is its own `### Task` section and
nothing else. So a constraint a command can decide is written as a Check:, never as
prose — prose is where the undecidable half goes, and a constraint a builder must honour is
repeated in the Context of every task it touches. A prose
bullet naming a byte-identical file or a script's output is one the driver could have run,
so write it as a `Check:` beside the prose. Such a comparison has a base to compare
against: a `Check:` or `Run:` that compares the tree against BASE writes `$ULTRA_BASE`,
which the driver sets, in the environment of every `Check:` and `Run:` it executes, to the
run's base sha — so `- Check: git diff --quiet $ULTRA_BASE -- fleet/` is writable without
knowing the sha, where a frozen `git hash-object` literal is the shape for a single file.
And a `Check:` that runs a sim is paid by every task on every pass, where the same command
in the owning task's `Run:` is paid once: put it there, and keep this section for what no
single task owns. That is not only advice: a `Check:` whose command names a file one task's
Files own is refused by `plan_check.py`, naming the task and the path, because a check a single
task would turn green was never run-wide. A `Check:` that freezes a pathspec covering any
task's `Create:`, `Modify:` or `Delete:` path is refused by `plan_check.py` the
same way, because it goes red the moment that task's own patch lands (run-199, n=1 run,
2026-09-21) — freeze files, not the directory they sit in.

The Flock, the one engine (the default since 0.3.39, the only one since map #1292 rule 8), selects no existing tests: a Flock run's proof is the
plan's probes and `Check:` lines and nothing else (operator, 2026-09-27). So a plan whose change
can break behaviour the repository already tests names those tests itself, as one `Check:` that
runs them (`- Check: python3 -m pytest -q tests/test_fleet_suite.py -k launch` for a launcher
change) — no single task owns them, so the check is run-wide, and a run that breaks them does not
settle green.
