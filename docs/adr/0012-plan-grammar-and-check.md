# 0012. The plan grammar, parser and laptop check

Status: accepted (2026-11-21)  
Governs: `evals/readings/wrong_plans.py`, `skills/ultrapowers/scripts/plan_check.py`, `skills/ultrapowers/scripts/plan_parse.py`, `skills/ultrapowers/scripts/probe_block.py`, `skills/ultrapowers/scripts/run_probes.py`, `skills/ultrapowers/scripts/stories_check.py`, `skills/ultrapowers/scripts/stories_parse.py`, `skills/ultrapowers/scripts/validate_skill.py`, `tests/test_plan_check.py`, `tests/test_plan_parse.py`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Green at base rehearsal

- **plan_check.py _timeout_shim_env** — Plan Run: lines are written in the engine's argv shape `timeout SECONDS CMD...`, but macOS ships no timeout. plan_check.py _timeout_shim_env prepends a PATH shim that drops the duration and runs the rest (not exec'd, so builtins work); the rehearsal's own clock still bounds the command. With a real timeout on PATH the environment is unchanged.
- **plan_check.py _timeout_shim_env (shim script)** — The timeout shim written by plan_check.py _timeout_shim_env runs "$@" without exec, because a shell builtin such as `true` is not a file exec can find on a bare PATH, and sh returns the command's exit code either way.
- **plan_check.py _run_at_base** — plan_check.py _run_at_base runs each command with bash -lc, ULTRA_BASE added, output discarded (the exit code is the reading), and start_new_session so a timeout kills the whole process group; a pytest or node grandchild would outlive a signal sent to the shell alone.
- **plan_check.py _rehearse** — plan_check.py _rehearse runs every Run: line in order in one detached git worktree cut at BASE's commit under a fresh temp directory, force-removed afterwards whatever the commands wrote; the repository's own working tree is never used.
- **plan_check.py green_at_base_lines** — plan_check.py green_at_base_lines reports any Run: line that exits 0 at BASE: a prover (carries a clause tag) that is already green cannot falsify the clause it cites, and an uncited one is labelled a guard. Red at BASE is the expected case and stays silent; a closing line always gives seconds, lines run and lines killed.
- **plan_check.py main (green-at-base gating)** — plan_check.py runs the GREEN-AT-BASE rehearsal only behind PLAN OK: a refused plan will not be dispatched, so the seconds spent running its commands would buy a reading nobody uses.

## Plan check base tree

- **plan_check.py WORKTREE_REV** — In plan_check.py, BaseTree uses WORKTREE_REV = "HEAD" as a sentinel for the directory reader: reads open files in the working tree directly, while any other rev is a 40-hex commit read through git show/ls-tree.
- **plan_check.py base_flag_refusal** — plan_check.py base_flag_refusal refuses a --base that is neither an existing checkout directory nor a full 40-hex sha. BaseTree.from_flag treats any non-sha as a directory on purpose, so without this an abbreviated sha became `git -C <abbrev>` and every file read as absent (#1025).
- **plan_check.py BaseTree** — plan_check.py BaseTree is the one reader for BASE-tree questions. --base names either a checkout directory (reads the working tree) or a 40-hex sha of the plan's repository (every read is git -C <repo> ... <sha>; nothing is checked out). Both answer the same questions so no caller branches on which it was given (#725).

## Plan check command rules

- **plan_check.py command_violations** — The engine runs Check:, Proof Run:, Publish:, Verify: and Rollback: commands through a shell that reads a backtick as command substitution, so plan_check.py command_violations refuses any backtick in them (run-74). It also refuses a run-wide Check: naming a path one task's Files own: that is a task probe in disguise and stays red for every other task until that task lands (#978).
- **plan_check.py publish_violations** — plan_check.py publish_violations requires a **Publish:** line and a **Verify:** line together: a deploy nobody checks live is not a publish, and a Verify has nothing to probe without a deploy. A Verify command must read $ULTRA_PUBLISH_URL, the URL the deploy actually printed, or it cannot be a live probe.
- **plan_check.py freeze_violations** — A run-wide Check: that freezes `git diff ... $ULTRA_BASE -- <pathspecs>` is green at BASE by construction and goes red as soon as a task's patch lands under the frozen path (run-199). plan_check.py freeze_violations refuses one whose pathspec covers any task's Files, and one with no pathspec or a whole-tree pathspec (`.`, empty, `*`); it reads only parser strings, with no git or subprocess.

## Plan check scope

- **skills/ultrapowers/scripts/plan_check.py** — skills/ultrapowers/scripts/plan_check.py is the laptop's check of a claims-v1 plan. It parses with plan_parse.py, the same file the sandbox runs, so there is no second grammar reader to drift. It only adds what a parser cannot: the gate-verdict record beside the plan, command and shape rules, and with --base what the launch tree says (Stale-if predicates, Run: lines rehearsed at BASE). It prints PLAN OK and exits 0, or every violation and a count and exits 2; SHARED, STALE-unreadable, GREEN-AT-BASE and AUTHORING facts follow the verdict and never refuse.
- **plan_check.py shared_fact_lines** — plan_check.py prints a SHARED fact for every path two or more tasks list in their Files, asking each task's probes to pin what the file must keep beyond its own change. It is a fact, never a refusal; it exists because in run-277 two probes each checked only their own removal.
- **plan_check.py promised_violations** — plan_parse.py ignores, rather than refuses, a Proof Run: tag citing a clause the Machine line does not number and a Stale-if entry that is no predicate; the ultrawrite skill tells authors both are refused. plan_check.py promised_violations closes that gap on the laptop so the parser the sandbox runs stays lenient.

## Plan parser grammar

- **plan_parse.py main / parse_plan_text** — skills/ultrapowers/scripts/plan_parse.py is the one plan parser the sandbox runs: it prints exactly one JSON object (tasks, dag_edges, width, checks, bootstrapCmd, publish), reads no file but the plan, and ignores any gate-verdicts file beside it. It refuses (exit 2, one stderr line) only what it cannot parse or must not run: no task heading, a duplicate task id, a dependency cycle, or a `(minor)` Check. Gate verdicts, slot shapes and clause citations belong to plan_check.py, so the sandbox never re-judges authoring. `width` (the widest dependency layer) is what the launcher sizes the VM from.
- **plan_parse.py RUN_CITE_RE** — In a claims-v1 plan, a Proof `Run:` bullet cites its clauses with a bracket tag like `[M2]` or `[M1, M3]`, and plan_parse.py RUN_CITE_RE recognises the tag only when it ends the value after whitespace. A bracket mid-command is treated as part of the shell command, so commands containing brackets are never mangled.
- **skills/ultrapowers/scripts/plan_parse.py MINOR_SUFFIX_RE** — A `(minor)` Check was once parsed and never run. Every `- Check:` line now runs, so skills/ultrapowers/scripts/plan_parse.py refuses a Check ending `(minor)` as a grammar error instead of treating the suffix as part of the command.

## Gate verdict record

- **plan_check.py gate_input_hash** — The gate verdict signs a task's (Claim, Proof) pair as sha256(claim + NUL + proof), computed by plan_check.py gate_input_hash and extract_gate_input.py alike. NUL separates because no slot can carry it, so moving text across the claim/proof boundary cannot produce the same hash.
- **plan_check.py gate_verdict_violations** — plan_check.py gate_verdict_violations compares each task's recorded hash to the live sha256 of its Claim and Proof, so any edit to a claim or proof makes the verdict stale and forces a re-dispatch to the gate rather than riding an old verdict.

## Plan dag edges

- **plan_parse.py _build_edges** — plan_parse.py _build_edges derives task dependencies in three tiers applied in order: write-after-create (a task modifying a file another creates) is always added with no cycle guard; interface edges (Consumes/Produces tokens) and then proof-run edges (a Run: command naming another task's files) are added only when they would not close a cycle. A genuine create/modify cycle is therefore refused as a plan error, while softer inferred edges silently yield.
- **plan_parse.py _build_edges** — In plan_parse.py _build_edges, proof-run edges are computed only after every interface edge is in place, so when the two kinds would form a cycle the interface edge survives and the proof-run edge is dropped. The tier order is part of the edge contract and changing it changes waves and width.

## Test suite parallelism

- **tests/test_plan_check.py test_c (machine temp root check)** — The test suite runs under pytest-xdist with -n auto (pytest.ini), so the machine's temp root is shared by sibling workers whose live ultra-green- worktrees can appear mid-test. The worktree-leak check in tests/test_plan_check.py therefore asserts on the temp root handed to plan_check.py always, and on the machine-wide temp root only when PYTEST_XDIST_WORKER is unset; the handed root is the one that catches a leak plan_check.py causes (#1120).
- **tests/test_plan_check.py SLEEPER** — Under pytest-xdist, sibling workers may run the same timeout test at once, and a bare `sleep 30` is indistinguishable across them in ps, so a before/after process diff would count a sibling's sleeper as leaked. tests/test_plan_check.py gives its sleeper a per-process fractional duration (sleep 30.<pid mod 1000>), which macOS and GNU sleep both accept and which still exceeds the 1-second limit (#1120).

## Authoring record

- **plan_check.py authoring_fact_line (AUTHORING_KEY)** — The verdict record's top-level `authoring` object is written by the authoring skill and only read by plan_check.py: it is printed as an AUTHORING fact and never refuses a plan. A field missing or malformed reads as `-`.

## Evidence repository

- **show (evals/readings/wrong_plans.py)** — A run's record in the evidence repository is read at its tag `<slug>/run-<N>`, but a run whose tag did not verify keeps only its live branch `live/<slug>/run-<N>`, so show in evals/readings/wrong_plans.py falls back to the branch.

## Flock scope rule

- **plan_parse.py parse_plan_full tasks_out.files** — plan_parse.py publishes each task's `files` as its Create, Modify and Delete paths together. The Flock's scope rule (factory/flock/scope.mjs) treats a write outside a task's files as an amendment, so without Delete paths a planned deletion was recorded as an amendment; run-263 produced 44 such false amendment rows.

## Plan parser exam

- **tests/test_plan_parse.py assert_is_the_scripts_own_refusal** — Python exits 2 with one stderr line when the script it is asked to run does not exist, which looks like a plan_parse.py refusal (also exit 2, one line). tests/test_plan_parse.py assert_is_the_scripts_own_refusal rejects stderr containing 'No such file or directory', so an absent parser reads as absent rather than as a passing refusal test.

## Probe runner

- **skills/ultrapowers/scripts/run_probes.py** — skills/ultrapowers/scripts/run_probes.py runs a plan's Run: probes against the working tree through plan_parse (the sandbox's parser), one `bash -c` per line with stdin closed, printing one line per probe and exiting 0/1/2. It exists because a hand loop misreports: on 2026-09-28 a loop read `$?` after a command substitution had reset it and printed exit 0 for a failed probe. Probes are run with this tool, never a hand loop.

## Proof gate hash

- **plan_parse.py _span_text** — plan_check.py keys every recorded gate verdict on sha256(claim + NUL + proof), where claim and proof are the slot texts produced by plan_parse.py _span_text. The recipe (label-line remainder plus following lines, stripped once as a whole) must stay byte-for-byte stable, because any change silently invalidates every verdict already signed.

## Skill validation

- **skills/ultrapowers/scripts/validate_skill.py validate** — skills/ultrapowers/scripts/validate_skill.py resolves a SKILL.md reference prefixed `skills/<name>/` against that sibling skill's directory (so ultrapowers can cite ultrawrite's scripts), and a bare `scripts/`, `references/` or `kernel/` path against the skill itself; either way the file must exist or validation fails.

## Stale if predicates

- **plan_check.py evaluate_stale_if** — plan_check.py answers each Stale-if predicate at BASE: one that holds is a refusal because the plan is stale before dispatch; one the machine cannot decide (for example gh unreachable) is printed as an advisory after the verdict, because an unreachable network is evidence about the laptop, not the plan.

## Stories plan checks

- **stories_check.py** — skills/ultrapowers/scripts/stories_check.py, the laptop's check of a stories-v1 plan, verifies only that the signed store module is the one the plan names (by sha256) and that every probe calls only tools its tasks list. Hollow probes are refused by compile.ts when it derives probes from the store and caught again by the checker (factory/stack/tinyapp/check.ts) at run time.

## Stories plan grammar

- **skills/ultrapowers/scripts/stories_parse.py** — skills/ultrapowers/scripts/stories_parse.py emits the same top-level fields as the claims-v1 parser (tasks, dag_edges, width, checks, bootstrapCmd, publish, per-task wave) so the Flock engine reads either grammar unchanged. A stories-v1 task's proofRuns stay empty: its facts are its probe blocks, which factory/flock/plan.mjs turns into check.ts calls itself.

## Stories probe grammar

- **skills/ultrapowers/scripts/probe_block.py** — A stories-v1 plan carries each state probe as one fenced ```probe block holding one JSON object with keys clause, layer (store|ui|saved), as, given, do, expect, see, judge and holds_before; checks are a closed set (cell eq/absent, row absent, value eq/absent, unchanged). `as` sets the signed-in user before a call and persists until the next `as`. skills/ultrapowers/scripts/probe_block.py validates the shape only; deciding a check is factory/stack/tinyapp/probe.ts's alone. Note: the ui do-forms now include select.
