# The laptop's tools refuse what they promised to refuse and never crash on what they read

**Grammar:** claims-v1
**Claim:** do: launch this plan; see: a launch with no plan path prints its usage instead of crashing, a launch whose reap could not list the fleet refuses instead of skipping the duplicate guard, the parser refuses a task heading it would otherwise silently merge into its neighbour and draws the edge for a probe that names a file a sibling deletes, the checker refuses a whole-tree freeze and a plan it cannot decode with one line each and makes the three refusals the authoring skill already promises, the skill's text no longer promises refusals nobody makes, and the Stop hook still blocks on a status object too large for an argument. (elicited)
**Summary:** The review found the laptop side lying in two directions: the launcher crashed on the simplest mistake and let a failed reap switch off its own duplicate guard, the parser could lose a whole task to a stray space, the checker passed a freeze that goes red on the first landing, and ultrawrite's skill text promised seven refusals the code never made. This plan makes each tool do what its own words say, with a probe for every promise, and strikes the sentences that cannot be kept. After it merges, what an author reads in the skill is what the checker does, and a run number collision or a dark lobby can no longer slip a duplicate launch through.
**Goal:** `fleet/launch.mjs` prints usage on a missing plan path and refuses when the reap answered no fleet list; `fleet/janitor.mjs` records a failed `rm` on its action and keeps reaping; `skills/ultrapowers/scripts/plan_parse.py` refuses a `### Task` line that is not a heading and reads `Delete:` paths for proof-run edges; `skills/ultrapowers/scripts/plan_check.py` refuses a whole-tree freeze, a plan that is not UTF-8, a `Depends-on`/`Commutes` line, a `Run:` tag naming an un-numbered clause and a Stale-if line that is no predicate; `skills/ultrawrite/SKILL.md` says exactly that; `hooks/keep_working.sh` reads its input from stdin and `hooks/hooks.json` quotes the plugin root.
**Tech Stack:** Node 22 ESM for `fleet/`, Python 3 for the scripts, pytest for the checks (`python3 -m pytest -q <file>`), bash for the hook.
**Bootstrap:** true
**Spec:** the review at `docs/superpowers/specs/2026-09-24-whole-codebase-review.md` (laptop only; every fact a task needs is in its Context), findings F1, S1, S2, S3, S5, the launch usage crash, and the Guide's hook notes.
**Target:** popmechanic/ultrapowers at `b891ddd9fa1805262ed23d8b831cc76bbe1e5103` (main, 2026-09-24).

## Global Constraints

- Check: python3 -m pytest -q tests/test_plan_parse.py tests/test_plan_check_freeze.py tests/test_plan_check_rehearsal.py tests/test_authoring_record.py tests/test_keep_working_hook.py tests/test_extract_gate_input.py
- Check: git diff --quiet $ULTRA_BASE -- factory skills/ultrapowers/kernel skills/ultrapowers/SKILL.md tests fleet/tests
- A refusal is one line on stderr or one `grammar:` violation line and exit 2, never a Python traceback or a Node stack.
- No new sim or test is written and no existing one is edited: the plan's probes and the six pytest files in the check are the proof.

### Task 1: A launch with no plan path prints its usage, and a launch whose reap answered no fleet list refuses

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/janitor.mjs`

**Claim:** do: run the launcher with no arguments; see: the usage text and the sentence that a plan path is required, exit 2. do: launch while the lobby cannot list the fleet; see: a refusal naming the reap's error instead of a launch that skipped its duplicate guard, and a janitor pass whose one failed `rm` is recorded on that action while the other actions still run. (derived)
Machine: M1. `node fleet/launch.mjs` with no arguments exits 2 and its output contains `a plan path is required` and `usage:`.
M2. In `fleet/launch.mjs`, when the reap answered no runs list (`fleetRuns === null`) and `--again` was not passed, the launch throws a `Refusal` whose message begins `launch: the reap did not answer` and names the reap's error, before any push.
M3. In `fleet/janitor.mjs`, the reap loop wraps each `lobby(exec, action.command)` so that a `LobbyError` from one action is recorded as that action's `error` string with `applied: false` and the loop continues to the next action; an action that succeeds carries `applied: true`.
M4. `node --check` exits 0 on both files, and `fleet/tests/test_launch_duplicate.mjs`, `fleet/tests/test_launch_one_engine.mjs` and `fleet/tests/test_launch_plan_path.mjs` each print `ALL TESTS PASSED`.

**Authorized-by:** review 2026-09-24 finding F1 (`fleet/janitor.mjs` reap loop, `fleet/launch.mjs` `again = []` on a null list) and the launch crash the deletions PR #1281 reported; #1036 (the duplicate-launch guard).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `fleet/launch.mjs` (1,897 lines, `git hash-object` `759cb448303b738fb54fc891b7412e1c9a92a095`) exports `const usage = () => USAGE` at line 104 and `launchBody` throws `new Refusal('launch: a plan path is required\n' + usage())` at line 984 — but the same function declares `let usage` at line 1357 (the usage-meter line: `usage = 'usage: ' + account + ' unread — ' + …`), so under JavaScript's block scoping the call at 984 reads the local in its temporal dead zone and `node fleet/launch.mjs` dies with `Cannot access 'usage' before initialization`, exit 1. Rename the local (`usageLine`) at its declaration and every use in `launchBody` (it is written in the two branches after line 1357 and read where the launch line is rendered); the exported `usage()` is untouched. `Refusal` (`fleet/lobby.mjs:318`, `exitCode = 2`) is what `runCli` prints and exits on. The reap block (lines 1258-1270): `let reapError = null; let fleetRuns = null; try { const reap = await janitor({ argv: [], exec, now, kata: hub }); fleetRuns = Array.isArray(reap.runs) ? reap.runs : []; … } catch (error) { reapError = String(error?.message ?? error) || 'launch: the reap failed' }` and then (line 1281) `const again = fleetRuns === null ? [] : await liveDuplicatesOf({ … runs: fleetRuns })` — a thrown reap leaves `fleetRuns` null and the guard never runs. Change: after the reap block, `if (fleetRuns === null && opts.again !== true) throw new Refusal('launch: the reap did not answer, so the duplicate guard (#1036) cannot run — ' + reapError + '; pass --again to launch without it')`; keep `reapError` on the result (line 1525) as today. `fleet/janitor.mjs` (881 lines, `5bb8702a…`): the one mutation is `if (!dryRun) { for (const action of actions) await lobby(exec, action.command) }` (lines 806-808); `lobby` (`fleet/lobby.mjs:284-290`) throws `LobbyError` on a non-zero exe.dev exit, so the first failing `rm` abandons the rest and rejects `janitor()`. Change it to `for (const action of actions) { try { await lobby(exec, action.command); action.applied = true } catch (error) { if (!(error instanceof LobbyError)) throw error; action.applied = false; action.error = String(error.message ?? error) } }` — the actions are pushed at line 776 with `kind`, `vm`, `command`; `launch.mjs:1263` already reads `action.applied === true` for its `reaped` list, and `renderAction` (line 852) prints each action, so add the error to its line when present. `LobbyError` is imported from `./lobby.mjs` where the janitor already imports `lobby`. The three launch sims drive `launch()` with fake `exec`/`janitor`/hub and pin refusals by text (`--tier`, plan path, duplicate); none pins the reap-null path, so they stay green; `test_launch_plan_path.mjs` (#1275) is the closest to M1.

**Proof:**
- Run: out=$(node fleet/launch.mjs 2>&1); rc=$?; test "$rc" = 2 && echo "$out" | grep -q "a plan path is required" && echo "$out" | grep -q "usage:" [M1]
- Run: grep -q "launch: the reap did not answer" fleet/launch.mjs && sed -n '/let fleetRuns = null/,/const again = /p' fleet/launch.mjs | grep -q "fleetRuns === null && opts.again !== true" [M2]
- Run: sed -n '/if (!dryRun) {/,/^  }$/p' fleet/janitor.mjs | tr '\n' ' ' | grep -q "try {.*await lobby(exec, action.command).*action.applied = true.*catch.*action.applied = false.*action.error" [M3]
- Run: node --check fleet/launch.mjs && node --check fleet/janitor.mjs && node fleet/tests/test_launch_duplicate.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_launch_one_engine.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_launch_plan_path.mjs | grep -q 'ALL TESTS PASSED' [M4]
- Legs: (a) a bare `node fleet/launch.mjs` exits 2 with the plan-path sentence and the usage text [M1]; (b) the launcher names the reap refusal and guards it on a null list without `--again` [M2]; (c) the janitor's reap loop tries each action, marks it applied or records its error [M3]; (d) both files parse and the three launch sims pass [M4].

**Stale-if:**
- path-absent: `fleet/lobby.mjs`

### Task 2: The parser refuses a Task line that is not a heading and draws the edge for a probe naming a file a sibling deletes

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_parse.py`

**Claim:** do: hand the parser a plan whose second task line reads `### Task 2 : two` (a space before the colon); see: exit 2 and one line naming that line, instead of task 2 silently folded into task 1. do: hand it a plan where task A deletes a file and task B's `Run:` names that file; see: an edge from A to B. (derived)
Machine: M1. `plan_parse.py` refuses, with exit 2 and one stderr line beginning `plan_parse:` that contains `### Task 2 : two`, a plan carrying an unfenced line at three or fewer leading spaces that starts `### Task` but does not match the task-heading rule (`^### Task <id>:`); a plan whose task lines all match is parsed as before.
M2. Tier-3 proof-run edges read a task's `Delete:` paths as well as its `Create:` and `Modify:` paths: for a plan where task A's Files carry `Delete: x.py` only and task B's Proof has `Run: python3 x.py`, `dag_edges` carries `{from: 'A', to: 'B', why: 'proof-run'}`.
M3. `python3 -m pytest -q tests/test_plan_parse.py` passes and `python3 skills/ultrapowers/scripts/plan_parse.py evals/fixtures/claims/plan.md` exits 0.

**Authorized-by:** review 2026-09-24 findings S1 (`plan_parse.py:61`, `_split_plan` at :116) and Minor 8 (`:568,580`).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `skills/ultrapowers/scripts/plan_parse.py` (933 lines, `23dfefb926421cef982618863978dfaf609f60ee`): `TASK_HEAD = re.compile(r'^### Task ([A-Za-z0-9]+):\s*(.*)$')` (line 61), `H2_HEAD = re.compile(r'^##\s')` (line 62), and `_split_plan` (line 116) walks `_fence_aware_lines(text)`, skips fenced lines and lines with more than three leading spaces, and on `TASK_HEAD.match(s)` records a head and a boundary, on `H2_HEAD.match(s)` a boundary — so `### Task 2 : two` matches neither (`H2_HEAD` wants `##` then whitespace; `###` fails it) and the line and everything after it belong to task 1's body. Add, in that loop before the `TASK_HEAD` match: `if s.startswith('### Task') and not TASK_HEAD.match(s): raise Refusal("plan_parse: a '### Task' line is not a task heading — write '### Task <id>: <title>' with the colon right after the id: " + s)`. `Refusal` is the module's own class, caught in `main` (line 924) and printed to stderr with exit 2. Tier 3 (line 568): `files_of = {t["id"]: set(t["files"]) for t in impl}`, where each task's `files` is `sorted(set(parsed["creates"]) | set(parsed["modifies"]))` (line 741) — `deletes` (parsed at line 296) is not in it, so a probe that expects a deletion to have landed draws no edge and can run before the sibling deletes. Build tier 3's map as `files_of = {t["id"]: set(t["files"]) | set(t.get("deletes", [])) for t in impl}` — `deletes` is already on the task dict `parse_plan_full` builds (line 728 onward; add it beside `creates`/`modifies` if the dict does not carry it). Tiers 1 and 2 and the public `files` cell are unchanged, so `launch.mjs`'s sizing and the engine's `task.files` do not move. `tests/test_plan_parse.py` (41 tests) pins the parser on the fixtures under `tests/fixtures/plans/`; none of them carries a malformed heading or a deletion a sibling's probe names, so it stays green. The `_run_tokens` tokenizer (used at line 572) is what reads `x.py` out of the Run: line.

**Proof:**
- Run: d=$(mktemp -d) && python3 -c "import sys; B=chr(96); open(sys.argv[1],'w').write(chr(10).join(['**Grammar:** claims-v1','**Claim:** do: x; see: y. (elicited)','','### Task 1: one','','**Type:** implementation','','**Files:**','- Create: '+B+'a.py'+B,'','**Claim:** do: a; see: b. (derived)','Machine: M1. a.','','**Authorized-by:** none','','**Interfaces:**','- Consumes: none','- Produces: none','','**Context:** c.','','**Proof:**','- Run: true [M1]','- Legs: (a) a [M1].','','**Stale-if:**','- path-absent: '+B+'zz'+B,'','### Task 2 : two','','**Type:** implementation'])+chr(10))" "$d/bad.md" && err=$(python3 skills/ultrapowers/scripts/plan_parse.py "$d/bad.md" 2>&1 >/dev/null); rc=$?; test "$rc" = 2 && echo "$err" | grep -q "^plan_parse:" && echo "$err" | grep -q "### Task 2 : two" [M1]
- Run: d=$(mktemp -d) && python3 -c "import sys; B=chr(96); open(sys.argv[1],'w').write(chr(10).join(['**Grammar:** claims-v1','**Claim:** do: x; see: y. (elicited)','','### Task A: del','','**Type:** implementation','','**Files:**','- Delete: '+B+'x.py'+B,'','**Claim:** do: a; see: b. (derived)','Machine: M1. a.','','**Authorized-by:** none','','**Interfaces:**','- Consumes: none','- Produces: none','','**Context:** c.','','**Proof:**','- Run: true [M1]','- Legs: (a) a [M1].','','**Stale-if:**','- path-absent: '+B+'zz'+B,'','### Task B: probe','','**Type:** implementation','','**Files:**','- Create: '+B+'y.py'+B,'','**Claim:** do: a; see: b. (derived)','Machine: M1. a.','','**Authorized-by:** none','','**Interfaces:**','- Consumes: none','- Produces: none','','**Context:** c.','','**Proof:**','- Run: python3 x.py [M1]','- Legs: (a) a [M1].','','**Stale-if:**','- path-absent: '+B+'zz'+B])+chr(10))" "$d/del.md" && python3 skills/ultrapowers/scripts/plan_parse.py "$d/del.md" | python3 -c "import json,sys; e=json.load(sys.stdin)['dag_edges']; sys.exit(0 if any(x['from']=='A' and x['to']=='B' and x['why']=='proof-run' for x in e) else 1)" [M2]
- Run: python3 -m pytest -q tests/test_plan_parse.py && python3 skills/ultrapowers/scripts/plan_parse.py evals/fixtures/claims/plan.md > /dev/null [M3]
- Legs: (a) the malformed heading is refused on stderr, exit 2, naming the line [M1]; (b) a probe naming a sibling's deleted file draws the proof-run edge [M2]; (c) the parser's own tests and the sample fixture still parse [M3].

**Stale-if:**
- path-absent: `evals/fixtures/claims/plan.md`

### Task 3: The checker refuses a whole-tree freeze, a plan it cannot decode, and the three shapes the authoring skill already says it refuses

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_check.py`

**Claim:** do: check a plan whose Global Constraints freeze the whole tree against BASE; see: a `grammar:` violation saying the freeze covers every task's path, not `PLAN OK`. do: check a plan that is not UTF-8; see: one line on stderr and exit 2, no traceback. do: check a plan with a `- Depends-on:` line, a `Run:` tag citing `[M9]` where the Machine line numbers M1 only, or a Stale-if line that is a sentence; see: one `grammar:` violation naming the task and the line for each. (derived)
Machine: M1. `freeze_violations` reads a `git diff --quiet $ULTRA_BASE` check with no ` -- ` pathspec, or whose first pathspec is `.`, as covering every implementation task's Files: the violation line contains `whole tree` and the check's command, and the plan is refused (exit 2).
M2. A plan file that is not valid UTF-8 makes `plan_check.py` print one line to stderr beginning `error: plan is not UTF-8` and exit 2, with no traceback (`Traceback` absent from stderr).
M3. `plan_check.py` emits one `grammar:` violation, naming the task and quoting the line, for each of: a `- Depends-on:` or `- Commutes:` bullet in a task body (`plan_parse.py` ignores them, so the plan would launch with no such edge); a `Run:` line whose clause tag names a clause the task's Machine line does not number (e.g. `[M9]` with only `M1.` present), in the wording `tests/test_plan_check_rehearsal.py` documents at its line 22: `grammar: Run: cites an unknown clause — task <id>: <command cut to 80 characters> cites <Mn>; the Machine line numbers <span>`; a `**Stale-if:**` entry that matches no predicate head (`path-exists|path-absent|sha-matches|issue-open|issue-closed`).
M4. `python3 -m pytest -q tests/test_plan_check_freeze.py tests/test_plan_check_rehearsal.py tests/test_authoring_record.py` passes.

**Authorized-by:** review 2026-09-24 findings S2 (`plan_check.py:358-396`), S3 (`:953`), S5 (`skills/ultrawrite/SKILL.md:94,155-157,186-187`); run-199 (the whole-tree freeze in its narrower form); CLAUDE.md §Verification ("an untagged prover settles nothing"; a tag naming a clause that does not exist settles nothing either).

**Interfaces:**
- Consumes: `machine_restatement(claim) -> str`
- Produces: none

**Context:** At BASE `skills/ultrapowers/scripts/plan_check.py` (991 lines, `1572f58f5a5beae846a025dc877eeb3a52dd3066`) imports `plan_parse` and `machine_restatement` (lines 56-57). `freeze_violations(checks, tasks)` (line 358) finds `git diff`, then `$ULTRA_BASE`, then ` -- ` and `continue`s when the separator is absent, so `- Check: git diff --quiet $ULTRA_BASE` passes, and a `.` pathspec never equals nor prefixes a task path, so `- Check: git diff --quiet $ULTRA_BASE -- .` passes too; both go red on the first landing. Change: when ` -- ` is absent after `$ULTRA_BASE`, or the first pathspec token normalizes to `.` or `''` or `*`, treat the pathspec as covering every path of every implementation task and append one violation `grammar: run-wide \`- Check: %s\` freezes the whole tree against $ULTRA_BASE, which covers every task's Files — the check goes red the moment any task's patch lands (run-199); freeze files, never the tree.` (one line per such check, not per task). `main` (line 928) does `plan_text = args.plan.read_text()` (line 953) with no handler: a non-UTF-8 file raises `UnicodeDecodeError`, a traceback and exit 1. Wrap it: `except UnicodeDecodeError as exc: print("error: plan is not UTF-8: " + str(exc), file=sys.stderr); return 2` (the same shape `base_flag_refusal` uses at line 948). The three new refusals go in one function, `promised_violations(tasks)`, added to the `violations` sum at line 961, over the task dicts `parse_plan_full` answers (each carries `id`, `body`, `claim`, `proof`, `proofRuns`, `proofRunClauses` and `stale_if_entries`): (1) any unfenced line of `body` matching `^\s*[-*+]\s*(Depends-on|Commutes)\s*:` → `grammar: task <id>: \`<line>\` is not read — ordering is derived from Interfaces and Files, never written`; (2) the numbered clauses are `re.findall(r'\bM(\d+)\.', machine_restatement(claim))`, and every tag in `proofRunClauses` (a list per Run: line, each a list like `['M1', 'M3']`) whose number is not among them → `grammar: Run: cites an unknown clause — task <id>: <command cut to 80 characters> cites M<n>; the Machine line numbers M1` (the span is `M1` for one clause, `M1–M<k>` for several — the shape the old compiler printed and `tests/test_plan_check_rehearsal.py` still documents at lines 22 and 110, though no test asserts it any more and `plan_check.py` at BASE emits nothing of the kind: grep `cites an unknown clause` over the script finds no line); (3) every `stale_if_entries` element that `_STALE_ENTRY_RE` (line 600) does not match → `grammar: task <id>: Stale-if entry \`<entry>\` is not a predicate — path-exists:, path-absent:, sha-matches:, issue-open: or issue-closed:`. `evaluate_stale_if` (line 680) keeps its `continue` — the grammar line is the refusal, the evaluator still skips. Use `plan_parse._fence_aware_lines(body)` for (1) so a fenced example is not read. The two fixture-driven test files and `test_authoring_record.py` build plans in scratch dirs and pin `PLAN OK`/violation text on shapes that carry none of the three new species and no whole-tree freeze (grep them for `Depends-on`, `M9`, `-- .` at BASE: none), so they stay green. (`evals/fixtures/claims/plan.md` is already refused at BASE for its retired `Test:` bullets, so the probes build their own plan; a plan with no verdict record is refused too, which is why the probes read the violation text and exit 2 rather than PLAN OK.)

**Proof:**
- Run: d=$(mktemp -d) && python3 -c "import sys; B=chr(96); open(sys.argv[1],'w').write(chr(10).join(['**Grammar:** claims-v1','**Claim:** do: x; see: y. (elicited)','','## Global Constraints','','- Check: git diff --quiet '+chr(36)+'ULTRA_BASE -- .','- Check: git diff --quiet '+chr(36)+'ULTRA_BASE','','### Task 1: one','','**Type:** implementation','','**Files:**','- Create: '+B+'a.py'+B,'','**Claim:** do: a; see: b. (derived)','Machine: M1. a.','','**Authorized-by:** none','','**Interfaces:**','- Consumes: none','- Produces: none','','**Context:** c.','','**Proof:**','- Run: true [M1]','- Legs: (a) a [M1].','','**Stale-if:**','- path-absent: '+B+'zz'+B])+chr(10))" "$d/p.md" && out=$(python3 skills/ultrapowers/scripts/plan_check.py "$d/p.md"); rc=$?; test "$rc" = 2 && test "$(echo "$out" | grep -c 'whole tree')" = 2 [M1]
- Run: d=$(mktemp -d) && printf '\xff\xfe### Task 1: x\n' > "$d/bad.md" && err=$(python3 skills/ultrapowers/scripts/plan_check.py "$d/bad.md" 2>&1 >/dev/null); rc=$?; test "$rc" = 2 && echo "$err" | grep -q "^error: plan is not UTF-8" && ! echo "$err" | grep -q "Traceback" [M2]
- Run: d=$(mktemp -d) && python3 -c "import sys; B=chr(96); open(sys.argv[1],'w').write(chr(10).join(['**Grammar:** claims-v1','**Claim:** do: x; see: y. (elicited)','','### Task 1: one','','**Type:** implementation','','**Files:**','- Create: '+B+'a.py'+B,'','**Claim:** do: a; see: b. (derived)','Machine: M1. a.','','**Authorized-by:** none','- Depends-on: 9','','**Interfaces:**','- Consumes: none','- Produces: none','','**Context:** c.','','**Proof:**','- Run: true [M1]','- Run: true [M9]','- Legs: (a) a [M1].','','**Stale-if:**','- when the moon is full','- path-absent: '+B+'zz'+B])+chr(10))" "$d/p.md" && out=$(python3 skills/ultrapowers/scripts/plan_check.py "$d/p.md"); rc=$?; test "$rc" = 2 && echo "$out" | grep -q "Depends-on: 9" && echo "$out" | grep -q "cites an unknown clause" && echo "$out" | grep -q "cites M9" && echo "$out" | grep -q "when the moon is full" [M3]
- Run: python3 -m pytest -q tests/test_plan_check_freeze.py tests/test_plan_check_rehearsal.py tests/test_authoring_record.py [M4]
- Legs: (a) the two whole-tree freezes each draw a violation containing `whole tree` and the plan exits 2 [M1]; (b) a non-UTF-8 plan is one stderr line and exit 2 with no traceback [M2]; (c) a Depends-on bullet, an [M9] tag over an M1-only Machine line (the unknown-clause line naming M9) and a prose Stale-if each draw a violation naming the line [M3]; (d) the three checker test files pass [M4].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/plan_parse.py`

### Task 4: The authoring skill promises only the refusals the checker makes

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `skills/ultrawrite/references/authoring-gotchas.md`

**Claim:** do: read ultrawrite's skill as an author; see: every refusal it names is one `plan_check.py` or `plan_parse.py` makes, no `--check` flag that does not exist, no dependency-range refusal nobody implements, no fence rule nothing enforces, and no sentence that contradicts the paragraph three sections later. (derived)
Machine: M1. `skills/ultrawrite/SKILL.md` contains no `--check` (the flag does not exist: `plan_check.py`'s argv is `[--base] [--repo] plan`), and the three `plan_check.py` invocations in the file read `plan_check.py --base <checkout-dir|sha> <plan.md>` or `plan_check.py --base`.
M2. `skills/ultrawrite/SKILL.md` no longer says that `>=1.2` is refused, that fences are illegal outside Proof, that the compiler refuses a clause no leg cites or a leg citing nothing, or that the legacy grammar is parsed when `**Grammar:**` is absent; the `Depends-on`/`Commutes` sentence, the tag sentence and the Stale-if sentence each name `plan_check.py` as what refuses them (Task 3's three `grammar:` refusals), and the Dependencies paragraph says the range alphabet is the author's own to keep.
M3. `skills/ultrawrite/references/authoring-gotchas.md` line 11 no longer names a `Test:` path (a `Test:` bullet is itself refused since cut three), and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite` prints `skill ok`.

**Authorized-by:** review 2026-09-24 finding S5 (`skills/ultrawrite/SKILL.md:26,45-47,94,131-137,155-157,186-187,342-344,387,458-459,570`); CLAUDE.md §Working with the operator (the trust chain is plan → probes → gate receipt → smoke, so the skill's word must be the checker's).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `skills/ultrawrite/SKILL.md` (644 lines, `0ee45d050bc47102d8dadd3f4cbb80d941a4c242`) carries these sentences, each false at BASE and each to be rewritten, not deleted wholesale — the surrounding prose stays: line 24-26 "absent, the compiler parses the legacy grammar — that is the rollback path" (`plan_parse.py` parses one grammar; say: absent, `plan_parse.py` refuses the plan); line 46 "`>=1.2` is refused at `--check` with a sentence naming the offending word, and so is a second `dev:` or a line naming no package" (no `Dependencies` reader exists in either script; say the alphabet is closed by convention and the author keeps it — nothing refuses it today); line 94 "`Depends-on` and `Commutes` lines are refused outright" (say: refused by `plan_check.py` as a `grammar:` violation; `plan_parse.py` reads neither); line 132 "fences are illegal outside Proof" (nothing enforces it; say fences belong in Proof and a fence elsewhere is the author's own to catch); lines 135-137 "the compiler refuses a clause no leg cites, a leg citing nothing, or a citation of a clause that does not exist" (contradicted by lines 342-344 in the same file, which say nothing mechanical closes the citation gaps since cut B; say: the gate reader names an uncited clause, and `plan_check.py` refuses a `Run:` tag naming a clause the Machine line does not number); line 156 "refuses a tag naming a clause the Machine line does not number" (keep, but name `plan_check.py` as the refuser); line 186-187 "A free sentence is a refusal" (say: a free sentence is a `grammar:` refusal from `plan_check.py`); lines 387, 458 (twice) and 570 spell `--check --base` or `--check` — the flag is `--base` alone (`plan_check.py --base <sha> <plan>`); line 426 already says it right. `skills/ultrawrite/references/authoring-gotchas.md` line 11 says a `Check:` "freezes a path covering a task's own Files or `Test:` path" — drop "or `Test:` path". After Task 3 lands the three refusals are real; this task's text names them as `plan_check.py`'s. `validate_skill.py` checks frontmatter and that every `references/`/`scripts/` path the body names exists; it is the smoke that no path reference was broken by the edit.

**Proof:**
- Run: test "$(grep -c -- '--check' skills/ultrawrite/SKILL.md)" = 0 && test "$(grep -c 'plan_check.py --base' skills/ultrawrite/SKILL.md)" -ge 2 [M1]
- Run: ! grep -q '>=1.2. is refused' skills/ultrawrite/SKILL.md && ! grep -q 'fences are illegal outside Proof' skills/ultrawrite/SKILL.md && ! grep -q 'the compiler refuses a clause no leg' skills/ultrawrite/SKILL.md && ! grep -q 'parses the legacy' skills/ultrawrite/SKILL.md && sed -n '/^- .Depends-on. and .Commutes./,/^- /p' skills/ultrawrite/SKILL.md | head -3 | tr '\n' ' ' | grep -q 'plan_check.py' && grep -q 'A free sentence is a .grammar:. refusal' skills/ultrawrite/SKILL.md [M2]
- Run: ! sed -n 11p skills/ultrawrite/references/authoring-gotchas.md | grep -q 'Test:' && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite | grep -q 'skill ok' [M3]
- Legs: (a) no `--check` spelling remains and the check invocations read `--base` [M1]; (b) the five false sentences are gone and the three kept refusals name `plan_check.py` [M2]; (c) the gotchas line drops the retired `Test:` path and the skill still validates [M3].

**Stale-if:**
- path-absent: `skills/ultrawrite/references/authoring-gotchas.md`

### Task 5: The Stop hook reads its input from stdin, and the hooks file quotes the plugin root

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `hooks/keep_working.sh`
- Modify: `hooks/hooks.json`

**Claim:** do: stop a session while background work is running and the status object is larger than one argument may be; see: the hook still blocks the stop with the in-flight list, instead of silently allowing it because Python could not be given the object as an argument. do: install the plugin at a path with a space; see: the session-start hook still runs. (derived)
Machine: M1. `hooks/keep_working.sh` passes nothing on `python3`'s argv: the JSON is read inside Python from `sys.stdin`, and with a `background_tasks` entry whose `description` is 2,000,000 characters the hook exits 0 and prints a line containing `"decision": "block"`.
M2. `hooks/hooks.json` parses as JSON, its SessionStart entry has no `matcher` key, and its command string contains `"${CLAUDE_PLUGIN_ROOT}"` with the quotes.
M3. `python3 -m pytest -q tests/test_keep_working_hook.py` passes.

**Authorized-by:** review 2026-09-24, Claude Code primitives table (Stop hook via argv above ARG_MAX; SessionStart matcher meaningless; unquoted plugin root); hooks/hooks.json:12; both SKILL.md frontmatters already quote the root.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `hooks/keep_working.sh` (70 lines, `0626d7057606444d543cef80cc316fbb900f1c6b`) does `input="$(cat || true)"` then `python3 - "$input" <<'PYEOF' || true` and the Python reads `sys.argv[1]`. Linux caps a single argument at 128 KiB (`MAX_ARG_STRLEN`) and macOS the whole argv at 1 MiB, so a large status object makes `python3` fail with "Argument list too long", `|| true` swallows it, nothing is printed and the stop is allowed. Change: drop the `input=` capture and the argv, run `python3 - <<'PYEOF'` … no — a heredoc on stdin replaces the hook's stdin; instead write the Python to a temp-free form: `python3 -c "$(cat <<'PY' … PY)"` reads the program from `-c` (the program is under 2 KB) and the JSON from `sys.stdin.read()`; keep every other behaviour (non-JSON or non-dict input allows silently, `stop_hook_active` true allows, only `running`/`pending` tasks block, the block line's shape `{"decision": "block", "reason": …, "hookSpecificOutput": {"hookEventName": "Stop", "continueLoop": true, "additionalContext": …}}`, exit 0 always). `hooks/hooks.json` (`0b4b1ae4…`) reads `"matcher": "*"` and `"command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/session_start.sh"`; SessionStart takes no matcher, and the two SKILL.md frontmatters write `bash "${CLAUDE_PLUGIN_ROOT}/hooks/keep_working.sh"` — match that. `tests/test_keep_working_hook.py` (2 tests) pipes JSON on stdin through `subprocess.run(["bash", HOOK], input=…)` and asserts the block line and the four allow shapes; it is the smoke.

**Proof:**
- Run: ! grep -q 'python3 - "\$input"' hooks/keep_working.sh && grep -q 'sys.stdin' hooks/keep_working.sh && python3 -c "import json;print(json.dumps({'stop_hook_active':False,'background_tasks':[{'id':'a','type':'subagent','status':'running','description':'x'*2000000}]}))" | bash hooks/keep_working.sh | grep -q '"decision": "block"' [M1]
- Run: python3 -c "import json,sys; h=json.load(open('hooks/hooks.json')); e=h['hooks']['SessionStart'][0]; sys.exit(0 if 'matcher' not in e and '\"\${CLAUDE_PLUGIN_ROOT}\"' in e['hooks'][0]['command'] else 1)" [M2]
- Run: python3 -m pytest -q tests/test_keep_working_hook.py [M3]
- Legs: (a) the hook no longer hands the input as an argument, names stdin, and blocks on a 2,000,000-character description [M1]; (b) the hooks file has no matcher and quotes the root [M2]; (c) the hook's tests pass [M3].

**Stale-if:**
- path-absent: `hooks/session_start.sh`
