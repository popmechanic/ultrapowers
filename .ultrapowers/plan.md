# The review's cleanup: the factory's leftovers go, and three quiet gaps are refused

**Grammar:** claims-v1
**Claim:** Nothing in the tree still serves or describes the retired factory engine, the catch census is gone, and a plan task the engine would skip, a story with a malformed id, or a mistyped launch flag is refused up front instead of silently ignored. (elicited)
**Summary:** This clears out what the review found left over from the retired factory engine: code nothing calls, docs describing steps that no longer happen, and the test-catch census that can no longer see a catch. It also closes three quiet gaps the review found, where a plan task, a story or a launch flag could be dropped without a word. You get a smaller tree whose docs match what a run really does, and mistakes refused before they cost a run.

**Goal:** Retire the catch census; delete the factory-era code, fields and docs the 2026-09-29 whole-codebase review proved unreached; refuse non-implementation task Types, malformed story ids and unknown launch flags.
**Tech Stack:** Python 3, Node (fleet, engine), Bun + TypeScript (stories), Markdown
**Spec:** none — the whole-codebase review of 2026-09-29 (four readers: factory, fleet, ultrapowers, ultrawrite); operator picks 2026-09-29

## Global Constraints

- Whatever a live Flock run reads keeps its meaning, except where a task below says otherwise: the parser's `tasks`, `dag_edges`, `launch_waves`, `checks`, `bootstrapCmd` and `publish`; the weave's `base`, `edit`, `rewrite`, `view`, `publish`, `pull`, `merged` and `authors_keyed` ops; the boot's `board.mjs` subcommands.
- A deleted file's rollback is git history; nothing deleted here is kept behind a flag.
- Check: python3 -m pytest -q

### Task 1: The catch census is retired

**Type:** implementation

**Files:**
- Delete: `skills/ultrapowers/scripts/catch_counter.py`
- Delete: `skills/ultrapowers/scripts/catch_report.py`
- Delete: `skills/ultrapowers/scripts/fleet_events.py`
- Delete: `skills/ultrapowers/scripts/_outcome.py`
- Delete: `tests/test_catch_counter.py`
- Delete: `tests/test_catch_report.py`
- Modify: `fleet/RUNBOOK.md`
- Modify: `CLAUDE.md`

**Claim:** The catch census is gone. (derived)
Machine: M1. The six paths `skills/ultrapowers/scripts/catch_counter.py`, `skills/ultrapowers/scripts/catch_report.py`, `skills/ultrapowers/scripts/fleet_events.py`, `skills/ultrapowers/scripts/_outcome.py`, `tests/test_catch_counter.py` and `tests/test_catch_report.py` do not exist. M2. No tracked file outside `docs/`, `.ultrapowers/`, `tests/fixtures/` and `evals/results/` names `catch_counter`, `catch_report`, `fleet_events` or `_outcome.py`. M3. `CLAUDE.md` contains the sentence `The catch census was retired on 2026-09-29` and no line matching `never caught` or `catch report` (case-insensitive).

**Authorized-by:** operator pick 2026-09-29 ("Retire it"); the ultrapowers review reading of 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The census credited a catch as a red run, then a fix round (`worker:end`/`dispatch:end` rows labelled `fix:K…` or `impl:K:fold`), then green. The Flock writes none of those rows, so the last reading (`catch_report.py --zero-over 1`, 2026-09-29) listed every test in the tree at zero catches over 0 runs. Following it would delete the whole suite. The operator retired it on 2026-09-29.

`fleet_events.py` and `_outcome.py` have no importer but the two census scripts (`git grep` at BASE finds only those, the two tests, `CLAUDE.md` and `fleet/RUNBOOK.md`). The fixture plans under `tests/fixtures/plans/2026-09-07/` mention the names as plan text; leave them.

What changes in the two docs:
- **`fleet/RUNBOOK.md` §Release:** delete steps 1 and 2 (the `catch_counter.py --fetch` pull and the `catch_report.py` reading) and renumber the rest from 1. The notes step no longer names "that section"; the release PR step no longer pastes it. Also delete the trap bullet that begins "**The laptop's python3 is older than the sandbox's, and `fromisoformat` is where that shows.**" (~line 708); it is about `catch_report._when` only.
- **`CLAUDE.md`:** drop the two census lines from §Commands, and the `catch_counter.py` / `catch_report.py` clause from the `skills/ultrapowers/` Layout bullet. In §Test doctrine, replace "A test file that has never caught anything is deleted, on `catch_counter.py`'s reading." with: "A test file is pruned by hand, one per pull request that names what else guards its behaviour. The catch census was retired on 2026-09-29: the Flock writes none of the rows it counted." Also drop "Flock runs add no catches." at the end of that bullet. In the Releasing bullet, the notes carry "the census line" only, not "and the catch report".

**Proof:**
- Run: bash -c 'for p in skills/ultrapowers/scripts/catch_counter.py skills/ultrapowers/scripts/catch_report.py skills/ultrapowers/scripts/fleet_events.py skills/ultrapowers/scripts/_outcome.py tests/test_catch_counter.py tests/test_catch_report.py; do test ! -e "$p" || exit 1; done' [M1]
- Run: bash -c 'test -z "$(git grep -lE "catch_counter|catch_report|fleet_events|_outcome\.py" -- . ":!docs" ":!.ultrapowers" ":!tests/fixtures" ":!evals/results")"' [M2]
- Run: bash -c 'grep -qF "The catch census was retired on 2026-09-29" CLAUDE.md && ! grep -qiE "never caught|catch report" CLAUDE.md' [M3]
- Legs: (a) all six paths are absent [M1]; (b) no tracked file outside the four excluded trees names any of the four scripts [M2]; (c) `CLAUDE.md` carries the retirement sentence and no line saying a never-caught test is deleted or naming the catch report [M3].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/catch_counter.py`

### Task 2: The parser drops its dead fields and plan_check refuses a task the engine skips

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_parse.py`
- Modify: `skills/ultrapowers/scripts/plan_check.py`
- Modify: `skills/ultrapowers/scripts/stories_parse.py`
- Delete: `skills/ultrapowers/scripts/stacks.py`
- Modify: `tests/test_plan_parse.py`
- Modify: `tests/test_plan_check.py`
- Modify: `tests/test_stories_parse.py`

**Claim:** A plan task the engine would skip is refused up front instead of silently ignored, and the parser prints nothing the retired factory alone read. (derived)
Machine: M1. `plan_parse.py <plan>`'s JSON has exactly the top-level keys `bootstrapCmd`, `checks`, `dag_edges`, `launch_waves`, `publish` and `tasks`. M2. `plan_parse.py` contains none of `legs_has_citation`, `legsHasCitation`, `LEG_MARKER_RE`, `LEG_CITATION_RE` or `_build_pairs`. M3. `plan_check.py` on a plan whose task 1 has `**Type:** gate` prints a line beginning `grammar: task 1: Type` that names `gate`, and exits non-zero; the same holds for `release` and `manual`. M4. `skills/ultrapowers/scripts/stacks.py` does not exist, and `stories_parse.py` no longer emits a `pairs` key.

**Authorized-by:** the ultrapowers and ultrawrite review readings of 2026-09-29; operator pick 2026-09-29 ("Cleanup plan first")

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Three changes.

- **`pairs` and legs.** `pairs` (`_build_pairs`, `_pair_interface_match`, `_consumed_tokens_ordered`, `_produced_tokens_map` if nothing else uses it) was read only by the factory's Jev pair reader; #1365 removed its last reader. `legsHasCitation` (the `LEG_MARKER_RE`/`LEG_CITATION_RE` block in the task parse) has no reader outside `plan_parse.py`. A plan's `- Legs:` line stays legal text in Proof; only its parse goes. Update `tests/test_plan_parse.py`: the key-set asserts (~lines 158, 167, 596) lose `pairs`, and the nine `test_pairs_m1_*` tests (~584–721) go. The module docstring's list of outputs loses `pairs`.
- **Non-implementation Types.** `plan_parse.py:780` keeps only tasks whose Type is `implementation` (or absent), and the engine reads only those, so a `gate`, `release` or `manual` task is dropped without a word. The parser keeps that behaviour. `plan_check.py` gains one refusal per such task, `grammar:`-namespaced like its others, beginning `grammar: task <id>: Type` and naming the Type, saying only `implementation` tasks run and that publishing goes through the `**Publish:**` header. Add one case to `tests/test_plan_check.py`.
- **`stacks.py`.** Only `tests/test_stories_parse.py` imports it (`import stacks`, ~lines 9 and 67–77); `factory/flock/plan.mjs` runs `check.ts` itself. Delete it and that test block. In `stories_parse.py`, drop the `"pairs": []` key, and bring its module docstring (lines 1–5, "proofRuns stays empty… launcher refuses") up to what it does today.

The probe for M3 builds its plan from `evals/fixtures/claims/plan.md`, whose three tasks are `**Type:** implementation`; `plan_check.py` already refuses that fixture for other reasons (a missing gate record, `Test:` bullets), and M3 reads only its own line among them.

**Proof:**
- Run: bash -c 'python3 skills/ultrapowers/scripts/plan_parse.py evals/fixtures/claims/plan.md | python3 -c "import json,sys; k=sorted(json.load(sys.stdin)); assert k==[\"bootstrapCmd\",\"checks\",\"dag_edges\",\"launch_waves\",\"publish\",\"tasks\"], k"' [M1]
- Run: bash -c '! grep -nE "legs_has_citation|legsHasCitation|LEG_MARKER_RE|LEG_CITATION_RE|_build_pairs" skills/ultrapowers/scripts/plan_parse.py' [M2]
- Run: bash -c 'd=$(mktemp -d); for t in gate release manual; do sed "s/^\*\*Type:\*\* implementation/**Type:** $t/" evals/fixtures/claims/plan.md > "$d/p.md"; out=$(python3 skills/ultrapowers/scripts/plan_check.py "$d/p.md"); rc=$?; test $rc -ne 0 || exit 1; printf "%s\n" "$out" | grep -E "^grammar: task 1: Type" | grep -q "$t" || exit 1; done' [M3]
- Run: bash -c 'test ! -e skills/ultrapowers/scripts/stacks.py && ! grep -q "\"pairs\"" skills/ultrapowers/scripts/stories_parse.py' [M4]
- Legs: (a) the parser's top-level keys are exactly the six, with no `pairs` [M1]; (b) none of the five legs/pairs names is left in the parser [M2]; (c) each of `gate`, `release` and `manual` on task 1 draws a `grammar: task 1: Type` line naming it, and a non-zero exit [M3]; (d) `stacks.py` is absent and `stories_parse.py` emits no `pairs` [M4].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/plan_parse.py`

### Task 3: A story, link or number with a malformed id is refused before compile

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/stories/checks.ts`

**Claim:** A story with a malformed id is refused up front instead of silently ignored. (derived)
Machine: M1. `runChecks` on the `todo` catalog bundle with its first story's id set to `add-todo` returns a refusal whose text contains `add-todo`. M2. `runChecks` on the `todo-tags` catalog bundle with its link `L1`'s id, and every step's reference to it, set to `link-1` returns a refusal whose text contains `link-1`. M3. `runChecks` on the unchanged `todo` and `todo-tags` catalog bundles returns no refusal.

**Authorized-by:** the ultrawrite review reading of 2026-09-29 (DRY finding 1)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The sandbox's parser reads a story, link or number only from a bullet matching `^- ([SLN]\d+):` (`skills/ultrapowers/scripts/stories_parse.py:19`, `ID_BULLET_RE`). `compile.ts` prints whatever id the bundle holds, so a story whose id is `add-todo` compiles, the parser drops it without a word, and Jev is later asked about an empty story. `checks.ts` checks no id today.

The rule to add: a story's id is `S` followed by digits, a link's `L` followed by digits, a number's `N` followed by digits, and ids are unique within their kind. The refusal names the offending id. Stories live in `page.stories`, links in `page.links`, numbers in `page.numbers` (see `stories/bundle.ts`). `loadBundle` is synchronous.

**Proof:**
- Run: bun -e "import {loadBundle} from './skills/ultrawrite/stories/bundle'; import {runChecks} from './skills/ultrawrite/stories/checks'; const b = loadBundle('skills/ultrawrite/catalog/todo'); b.page.stories[0].id = 'add-todo'; process.exit(runChecks(b).refusals.some((r) => r.includes('add-todo')) ? 0 : 1)" [M1]
- Run: bun -e "import {loadBundle} from './skills/ultrawrite/stories/bundle'; import {runChecks} from './skills/ultrawrite/stories/checks'; const b = loadBundle('skills/ultrawrite/catalog/todo-tags'); b.page.links[0].id = 'link-1'; for (const s of b.page.stories) for (const st of s.steps) if (st.link === 'L1') st.link = 'link-1'; process.exit(runChecks(b).refusals.some((r) => r.includes('link-1')) ? 0 : 1)" [M2]
- Run: bun -e "import {loadBundle} from './skills/ultrawrite/stories/bundle'; import {runChecks} from './skills/ultrawrite/stories/checks'; const n = ['todo', 'todo-tags'].map((c) => runChecks(loadBundle('skills/ultrawrite/catalog/' + c)).refusals.length); process.exit(n.every((x) => x === 0) ? 0 : 1)" [M3]
- Legs: (a) a story id `add-todo` draws a refusal naming it [M1]; (b) a link id `link-1` draws a refusal naming it [M2]; (c) both unchanged catalogs draw no refusal [M3].

**Stale-if:**
- path-absent: `skills/ultrawrite/stories/checks.ts`

### Task 4: The launcher refuses any unknown flag and ships nothing the engine no longer reads

**Type:** implementation

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/compiler.mjs`
- Delete: `skills/ultrawrite/scripts/pin_base_facts.py`
- Modify: `skills/ultrapowers/scripts/plan_check.py`
- Modify: `fleet/tests/test_launch_one_engine.mjs`

**Claim:** A mistyped launch flag is refused up front instead of silently ignored, and the launcher ships nothing only the retired factory read. (derived)
Machine: M1. `node fleet/launch.mjs x.md --target a/b --base 9399cf151557c923310582d533864182f5ef4ae1 --hodl 1` exits 2 and prints exactly `launch: unknown flag --hodl`, before reading the plan. M2. `fleet/launch.mjs` contains none of `gate-verdicts`, `VERDICTS_PATH` or `verdictsText`. M3. `skills/ultrawrite/scripts/pin_base_facts.py` does not exist, and neither `fleet/compiler.mjs` nor `skills/ultrapowers/scripts/plan_check.py` contains `pin_base_facts`, `BASE_FACTS_STAMP` or `PIN_SCRIPT_REL`.

**Authorized-by:** the fleet and ultrawrite review readings of 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Three changes.

- **Unknown flags.** `lobby.parseArgs` keeps unknown keys, and `launch.mjs` (~lines 527–540) refuses only `--tier`, `--implementer-effort` and `--kind` by name. At BASE, `--hodl 1` gets past them: the launch goes on to read the plan (`launch: cannot read plan …`). Replace the three named refusals with one allow-list refusal over every flag the launcher reads: `account`, `again`, `base`, `config`, `cpu`, `engine`, `hold`, `json`, `memory`, `repo`, `run`, `target`. The message stays `launch: unknown flag --<name>`, exit 2 (a `Refusal`), and it comes before the plan is read. `fleet/claude-token.mjs:535` has the same kind of refusal. `test_launch_one_engine.mjs` still passes: its `--tier` and `--implementer-effort` legs get the same message. Add a leg there for one unknown flag that was never a launcher flag.
- **The gate-verdicts file.** The launcher commits `.ultrapowers/gate-verdicts.json` beside the plan (`VERDICTS_PATH`, and `verdictsText` through `commitPlan` and its retry helper, ~lines 124, 637–642, 978, 1144–1232). `git grep gate-verdicts -- factory` finds nothing: the fold kernel that read it is gone. Stop reading and committing it. The laptop's `plan_check.py` reads the local sibling record, which is unaffected.
- **`pin_base_facts.py`.** No skill step, test or plan in use runs it; the only plans with a `**BASE facts:**` block are 2026-09-07 fixtures. Delete it, and delete `fleet/compiler.mjs`'s stamp check (`PIN_SCRIPT_REL`, `BASE_FACTS_STAMP` and the stale-stamp refusal in `verifyPlanCompiles`, plus its doc comment's item 1). Reword the two `plan_check.py` comments that name it (~lines 568 and 799) to name only `extract_gate_input.py`.

**Proof:**
- Run: bash -c 'out=$(node fleet/launch.mjs x.md --target a/b --base 9399cf151557c923310582d533864182f5ef4ae1 --hodl 1 2>&1); rc=$?; test $rc -eq 2 && test "$out" = "launch: unknown flag --hodl"' [M1]
- Run: bash -c '! grep -nE "gate-verdicts|VERDICTS_PATH|verdictsText" fleet/launch.mjs' [M2]
- Run: bash -c 'test ! -e skills/ultrawrite/scripts/pin_base_facts.py && ! grep -nE "pin_base_facts|BASE_FACTS_STAMP|PIN_SCRIPT_REL" fleet/compiler.mjs skills/ultrapowers/scripts/plan_check.py' [M3]
- Run: node fleet/tests/test_launch_one_engine.mjs
- Legs: (a) `--hodl` is refused with exactly that line and exit 2 [M1]; (b) the launcher names no gate-verdicts path or plumbing [M2]; (c) the pin script is gone and neither file names it or its stamp [M3].

**Stale-if:**
- path-absent: `fleet/launch.mjs`

### Task 5: The engine's factory leftovers are deleted

**Type:** implementation

**Files:**
- Modify: `factory/board.mjs`
- Modify: `fleet/tests/test_factory_board.mjs`
- Modify: `factory/flock/weave.py`
- Modify: `factory/flock/catchup.mjs`
- Modify: `factory/flock/flock_board.mjs`

**Claim:** Nothing in the engine still serves the retired factory. (derived)
Machine: M1. Neither `factory/board.mjs` nor `fleet/tests/test_factory_board.mjs` contains `makeBoard`, `patchWithRevision`, `factsFor` or `FACTS_LIMIT`. M2. `factory/flock/weave.py` contains no `def r_cand_`, `def r_select`, `def r_rehide`, `def r_adopt`, `def r_authors(`, `def bump`, `hidden_only` or `self.cands`. M3. No file under `factory/` contains `hiddenOnly` or `realConflicts`. M4. `factory/flock/flock_board.mjs` contains neither `KataBoard` nor `burst`.

**Authorized-by:** the factory review reading of 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Four leftovers of the factory. Each was proved unreached at BASE.

- **`factory/board.mjs` lines 1–147.** These are the factory's feedback board: `makeBoard`, `factsFor`, `setState`, `settled`, `isFact`, `FACTS_LIMIT`, `OMITTED_PREFIX`, `EMPTY`, `patchWithRevision`. The engine imports its own `makeBoard` from `./flock_board.mjs`. The only other caller is test leg M5 (`test_factory_board.mjs` ~26–28 and 437–440), which asserts the function "is still exported". The CLI half (from the `// The CLI` banner, ~line 150) is live: `factory/boot.sh` calls its `install`, `spoke-config`, `wait`, `close-run` and `mark-run`. Keep that half, keep its header comment true, and drop leg M5 and its header lines.
- **`weave.py` candidates.** These are the factory's "k implementers, then select": `r_cand_open`, `r_cand_edit`, `_cand_mine`, `r_cand_publish`, `r_cand_pull`, `_cand_move`, `r_select`, `r_rehide`, `r_adopt`, `r_authors`, `bump`, `hidden_only` and `self.cands`. The ops the engine and catch-up send are `base`, `edit`, `rewrite`, `view`, `publish`, `pull`, `merged` and `authors_keyed`; keep those. Keep `same_anchor`. With no candidates, `hiddenOnly` is always false, so `merged` answers `conflicts` and drops `hiddenOnly` and `realConflicts`, and `pull` drops its `hiddenOnly` field. Trim the module docstring's "Added for ticket 2" op list to the ops that remain.
- **`catchup.mjs` ~line 77** reads `j.realConflicts`; read `j.conflicts` instead. Keep the refusal the same: `{refolded: false, reason: 'conflict'}`, exit 1.
- **`flock_board.mjs`.** `KataBoard` (~112–227), the `kind === 'kata'` branch of `makeBoard` (line 35) and the `burst` CLI (~229–261) go. The engine hard-codes `BOARD = 'standin'`. `StandInBoard.readyNow` repeats `Timed.readyNow` byte for byte; keep one.

The catch-up probe `fleet/tests/flock_catchup_probe.mjs` exercises `catchup.mjs` through the weave (`clean`, `conflict` and `red` each print `CATCHUP <case> OK` at BASE), and `test_flock_scope.mjs` runs the scripted Flock end to end.

**Proof:**
- Run: bash -c '! grep -nE "makeBoard|patchWithRevision|factsFor|FACTS_LIMIT" factory/board.mjs fleet/tests/test_factory_board.mjs' [M1]
- Run: bash -c '! grep -nE "def r_cand_|def r_select|def r_rehide|def r_adopt|def r_authors\(|def bump|hidden_only|self\.cands" factory/flock/weave.py' [M2]
- Run: bash -c '! grep -rnE "hiddenOnly|realConflicts" factory' [M3]
- Run: bash -c '! grep -nE "KataBoard|burst" factory/flock/flock_board.mjs' [M4]
- Run: node fleet/tests/flock_catchup_probe.mjs clean
- Run: node fleet/tests/flock_catchup_probe.mjs conflict
- Run: node fleet/tests/flock_catchup_probe.mjs red
- Run: node fleet/tests/test_flock_scope.mjs
- Run: node fleet/tests/test_factory_board.mjs
- Legs: (a) the dead board half and its test leg are gone [M1]; (b) no candidate op or helper is left in the weave [M2]; (c) no engine file names the two candidate-only fields [M3]; (d) the Kata board and its burst command are gone [M4].

**Stale-if:**
- path-absent: `factory/flock/weave.py`

### Task 6: The old engine's reference docs are gone and the plugin describes the Flock

**Type:** implementation

**Files:**
- Delete: `skills/ultrapowers/references/design-rationale.md`
- Delete: `skills/ultrapowers/references/finishing-notes.md`
- Delete: `evals/readings/ab_auth.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrawrite/references/greenfield-stack.md`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `hooks/session_start.sh`

**Claim:** Nothing in the tree still describes the retired factory engine. (derived)
Machine: M1. `skills/ultrapowers/references/design-rationale.md`, `skills/ultrapowers/references/finishing-notes.md` and `evals/readings/ab_auth.py` do not exist, and no tracked file outside `docs/`, `.ultrapowers/` and `evals/results/` names `design-rationale`, `finishing-notes` or `ab_auth`. M2. `skills/ultrawrite/references/greenfield-stack.md` has no `## State exams` or `## The runtime host` heading and no line containing `nothing in this section has a reader`. M3. Neither `.claude-plugin/plugin.json` nor `.claude-plugin/marketplace.json` contains `several implementers`, `hooks/session_start.sh` does not contain `fleet driver`, and both manifests still parse as JSON with `version` `0.3.41`.

**Authorized-by:** the ultrapowers and ultrawrite review readings of 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:**
- **The two reference docs** describe `gate_check.py`, `waveMerges`, `gitVerified`, a completeness critic, per-wave merge commits and `factory/roles/*.md`, none of which exists (`git ls-files | grep -c "gate_check\|factory/roles"` is 0). `skills/ultrapowers/SKILL.md` lines 239–240 list them; drop those two lines.
- **`evals/readings/ab_auth.py`** documents the deleted `fleet/run-main.mjs`. Nothing imports it, and its test is already gone.
- **`greenfield-stack.md`:** delete the sections `## State exams` (~159–328) and `## The runtime host` (~329–383). Each carries a banner saying nothing reads it; stories-v1 state probes replaced them. Line ~100 points at `## The runtime host`; end that paragraph at the sentence before the pointer. Leave `## Styling` and every other section.
- **Manifests:** in each description, "several implementers per task" becomes "a pool of builders", with the rest of the sentence unchanged. The version stays `0.3.41` in both.
- **`hooks/session_start.sh` ~line 24:** "which the fleet driver refuses before any VM" becomes "which the launcher refuses before any VM".

**Proof:**
- Run: bash -c 'for p in skills/ultrapowers/references/design-rationale.md skills/ultrapowers/references/finishing-notes.md evals/readings/ab_auth.py; do test ! -e "$p" || exit 1; done; test -z "$(git grep -lE "design-rationale|finishing-notes|ab_auth" -- . ":!docs" ":!.ultrapowers" ":!evals/results")"' [M1]
- Run: bash -c '! grep -nE "^## State exams|^## The runtime host|nothing in this section has a reader" skills/ultrawrite/references/greenfield-stack.md' [M2]
- Run: bash -c '! grep -q "several implementers" .claude-plugin/plugin.json .claude-plugin/marketplace.json && ! grep -q "fleet driver" hooks/session_start.sh && python3 -c "import json; a=json.load(open(\".claude-plugin/plugin.json\")); b=json.load(open(\".claude-plugin/marketplace.json\")); assert a[\"version\"]==\"0.3.41\" and b[\"plugins\"][0][\"version\"]==\"0.3.41\""' [M3]
- Run: bash -n hooks/session_start.sh
- Legs: (a) the three files are gone and nothing outside the three excluded trees names them [M1]; (b) the two deferred sections and their banners are gone [M2]; (c) neither manifest says "several implementers", the hook no longer names the fleet driver, and both manifests parse with version 0.3.41 [M3].

**Stale-if:**
- path-absent: `skills/ultrapowers/references/design-rationale.md`

### Task 7: The contract states only what the Flock does

**Type:** implementation

**Files:**
- Modify: `fleet/CONTRACT.md`

**Claim:** Nothing in the tree still describes the retired factory engine. (derived)
Machine: M1. `fleet/CONTRACT.md` contains none of `gate-verdicts`, `Fleet-Run`, `run_lines`, `jev:finding`, `jev:tier`, `jev:suite-red`, `FOLD_AGAIN_WAIT` or `tests the engine selects`. M2. The contract says the plan branch carries `.ultrapowers/plan.md` and `.ultrapowers/kata.json`, and that a run's proof is the plan's `Run:` probes and `Check:` lines only.

**Authorized-by:** the fleet review reading of 2026-09-29; the probes-only rule (operator, 2026-09-27)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `fleet/CONTRACT.md` is the authority for every literal, and these lines still state factory-era literals as live (BASE line numbers):
- **~16 and ~48:** the plan branch "plus `.ultrapowers/gate-verdicts.json`". The launcher stops committing it in this same run.
- **~103–108:** "The publish fold attributes a `Fleet-Run: <N>` frontier commit…" and the gate-verdicts sibling. `git grep Fleet-Run -- factory` finds nothing.
- **~117–122:** `proofs.run_lines` in `factory/policy.json` (absent there) and "existing tests the engine selects". The Flock selects no tests; the proof is probes-only (operator, 2026-09-27).
- **~377–384:** the `jev:finding`, `jev:tier` and `jev:suite-red` rows. Their writers and readers were removed (#1365, #1372). The one live Jev row is `jev:step`; state it if the section needs a live example.
- **~413–417:** `FOLD_AGAIN_WAIT`. It appears nowhere else; the self-merge's refold bound is `publish.self_merge.max_refolds`.

Rewrite each passage to what the Flock does, or cut it where nothing replaces it. Leave the status.json line and the documented `--engine` rollback as they are.

**Proof:**
- Run: bash -c '! grep -nE "gate-verdicts|Fleet-Run|run_lines|jev:finding|jev:tier|jev:suite-red|FOLD_AGAIN_WAIT|tests the engine selects" fleet/CONTRACT.md' [M1]
- Legs: (a) none of the eight retired literals is left in the contract [M1]; (b) the plan-branch and proof passages say what the Flock does, read against the hunk [M2].

**Stale-if:**
- path-absent: `fleet/CONTRACT.md`

### Task 8: ultrawrite's own text describes the Flock

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `skills/ultrawrite/references/authoring-gotchas.md`
- Modify: `skills/ultrawrite/references/enrich.md`

**Claim:** Nothing in the tree still describes the retired factory engine. (derived)
Machine: M1. `skills/ultrawrite/SKILL.md` names no task Type but `implementation` (no backticked `gate`, `release` or `manual`) and contains no `**Review:**` marker. M2. Neither `skills/ultrawrite/SKILL.md` nor `skills/ultrawrite/references/authoring-gotchas.md` contains (case-insensitive) `several implementers`, `one reviewer and one fix round`, `fold check`, `folded tree`, `the critic`, `forwarded to every reviewer`, `compile_plan.py`, `Tier 2`, `fix loop`, `fix round` or `every wave`. M3. Neither `skills/ultrawrite/SKILL.md` nor `skills/ultrawrite/references/enrich.md` contains `flagged as one need`, `State exams`, `BASE facts` or a parser-output list naming `pairs`. M4. §Global Constraints discipline says a prose bullet is read by people only (nothing runs it or forwards it), and a `Check:` bullet runs across the whole run.

**Authorized-by:** the ultrawrite review reading of 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The skill still describes a run that no longer exists. The Flock has builders that claim tasks from a board, merge each other's published work continuously through the weave, and settle green on the plan's probes and checks. It has no reviewer, no fix round, no waves, no fold check, no critic and no `k` implementers. Rewrite each passage to that, or cut it. The BASE lines:

- **`SKILL.md`:**
  - **~147–161:** the header-marker bullets. Only `**Type:** implementation` runs; `plan_check.py` refuses any other Type in this same run. Publishing goes through the `**Publish:**` header. Drop the `**Review:**` marker and its bullet, the Tier bullet, and `**Review:** peer` in the example (~266).
  - **~217–219:** the reviewer and fix loop.
  - **~241–243:** a base-time `check:line` row carrying `base: true`; the Flock writes none.
  - **~406–410:** "the fold check now re-runs every adopted task's probes".
  - **~513:** the parser-output list names `pairs`; the parser drops it in this same run.
  - **~537:** a `**BASE facts:**` block refused by the launcher; the pin script and that check go in this same run.
  - **~566–570:** §State exams, deleted from `greenfield-stack.md` in this same run.
  - **~579:** the critic.
  - **~601–618:** "fold sends to a resolver", `compile_plan.py`, "Until that fold lands (Tier 2)" and a bare "frontier".
  - **~622–634:** Global Constraints "forwarded to every reviewer", "before review", `(minor)` "never dispatched". A `Check:` runs across the whole run (`factory/flock/plan.mjs` reads `checks`); a prose bullet reaches no builder, since a task's body is its own `### Task` section.
  - **~673:** "several implementers per task".
- **`references/authoring-gotchas.md`:** the rows at ~26–37, 87, 101, 170, 190, 198–199, 212, 226 and 231–234 carry the same drift. Keep each row's lesson where it still holds in the Flock, reworded; cut a row whose lesson only held in the factory.
- **`references/enrich.md` ~62:** "merge any pair flagged as one need". The map stage's pairwise `same_need` question was retired on 2026-09-29 (`skills/ultrawrite/stories/policy.json`), and `jev_checks.ts` no longer asks it. Delete the clause.

Keep "merge frontier" and "docket frontier" wherever a qualified one is meant. A bare "frontier" is banned.

**Proof:**
- Run: python3 -c "t=open('skills/ultrawrite/SKILL.md').read(); b=chr(96); assert not any(b+w+b in t for w in ('gate','release','manual')) and '**Review:**' not in t" [M1]
- Run: bash -c '! grep -niE "several implementers|one reviewer and one fix round|fold check|folded tree|the critic|forwarded to every reviewer|compile_plan\.py|Tier 2|fix loop|fix round|every wave" skills/ultrawrite/SKILL.md skills/ultrawrite/references/authoring-gotchas.md' [M2]
- Run: bash -c '! grep -nE "flagged as one need|State exams|BASE facts|dag_edges.*pairs" skills/ultrawrite/SKILL.md skills/ultrawrite/references/enrich.md' [M3]
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- Legs: (a) no other Type and no Review marker is left in the skill [M1]; (b) none of the eleven factory phrases is left in the skill or the gotchas [M2]; (c) the retired pair question, the deleted section, the pin block and `pairs` are no longer named [M3]; (d) the Global Constraints section says a prose bullet reaches only people and a `Check:` runs across the whole run, read against the hunk [M4].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
