# The laptop's plan check says which checks are already red at BASE, and the sandbox runs a proof command exactly as the laptop read it

**Grammar:** claims-v1

**Claim:** Before a plan launches, the laptop check tells me which of the plan's run-wide checks are already failing before any work is done, so a plan cannot send a run chasing a failure no task can fix; and the sandbox runs a proof command exactly as the laptop check read it. (elicited)
**Summary:** This closes two gaps between the laptop's plan check and the sandbox that both surfaced today. It exists because run-36 spent two repair attempts on a check that was already red before the run began (n=1 run), and because a tagged proof command would have reached the sandbox with its tag still on it and failed a correct patch. After this, a plan's dead-on-arrival checks show on the launch line, and the two parsers agree on what a proof command is.

**Goal:** Two independent contracts in two scripts. `compile_plan.py --check --base` rehearses the plan's `Check:` lines at BASE beside its `Run:` lines and prints a `RED-AT-BASE fact:` for each that exits non-zero (#1173). `plan_parse.py`, the factory's parser, strips a `Run:` line's trailing clause tag as the compiler already does, and prints the tagged clauses beside the command (#1177).
**Closes:** #1173 #1177

**Tech Stack:** Python 3 standard library; pytest for both exams, each extending a test file already on the tree.
Spec: none on disk — the two issues are the brief, and everything a worker needs is in its Context. The sandbox holds no spec.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- factory fleet skills/ultrapowers/kernel
- A fact line is never a refusal: nothing this plan adds changes `PLAN OK`, an exit code, or what a bare `--check` prints.
- The two parsers agree: what `plan_parse.py` prints as a task's `proofRuns` is what `compile_plan.py` records as that task's commands, for every plan both accept.
- No pin this plan loosens is re-pinned to a new exact literal.

### Task 1: The laptop check rehearses the plan's Check lines at BASE and names the ones already red

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrawrite/references/authoring-gotchas.md`
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `tests/test_compile_plan_exam_sweep.py`
- Test: `tests/test_compile_plan_green_at_base.py`

**Claim:** Before a plan launches, the laptop check tells me which of the plan's run-wide checks are already failing before any work is done. (derived)
Machine: M1. Under `--check --base <sha>`, for a plan that prints `PLAN OK` and whose `## Global Constraints` holds `- Check: false` and `- Check: true`, stdout carries exactly one line beginning `RED-AT-BASE fact:`, it names the command `false` and the exit code `1`, and no such line names `true`; the exit code of the compile is still 0 and `PLAN OK` still prints.
M2. Each check runs in the same detached worktree at BASE the `Run:` lines run in, with `ULTRA_BASE` in its environment set to the base commit's sha: a plan whose check is `test "$ULTRA_BASE" = <the base sha>` draws no `RED-AT-BASE fact:` line, and after the compile `git worktree list` in the plan's repository shows one worktree.
M3. A bare `--check`, a plain compile with `--base`, and a refused plan under `--check --base` run no check and print no `RED-AT-BASE fact:` line.
M4. `skills/ultrawrite/references/authoring-gotchas.md` carries one new row saying a `Check:` red at BASE is a red no task owns unless one task's Files hold the offender, and naming the `RED-AT-BASE fact:` line as where to read it; its rows heading no longer states a count; and `tests/test_compile_plan_exam_sweep.py` no longer pins that heading or an exact row count.

**Authorized-by:** #1173; the operator's signed Claim of 2026-09-21.

**Interfaces:**
- Consumes: none
- Produces: `red_at_base_lines(checks, base_tree, timeout_s)`

**Context:** You see this task body and nothing else. **The sibling task** edits `skills/ultrapowers/scripts/plan_parse.py` and `tests/test_plan_parse.py` only; you share no file. **Why:** fixture run-36 (2026-09-21) carried a blocking `Check:` copied verbatim from `greenfield-stack.md` that exits 1 at BASE on a file no task of the plan owned; on the sandbox it turned both fold checks red and bought two repair attempts that could change nothing (8.4 worker-minutes, n=1 run). The compiler already rehearses Proof `Run:` lines at BASE — `green_at_base_lines(tasks, base_tree, timeout_s=GREEN_AT_BASE_TIMEOUT_S)` (about line 3079 of `compile_plan.py`) cuts one detached worktree at BASE under a temporary directory, runs each command through `_run_at_base(command, worktree, sha, timeout_s)` (`bash -lc`, its own process group, killed at the limit, `ULTRA_BASE` set to the sha), prints a `GREEN-AT-BASE fact:` line for each exit 0, removes the worktree with `--force`, and always ends with one reading line. It is called from `main` only behind a `PLAN OK` under `--check --base` (about line 3311), between the `STALE fact:` advisories and the `AUTHORING fact:` line. `parse_constraint_checks(text)` (about line 1788) already returns the section's `- Check:` commands in order, each with whether it ends `(minor)`. Add the mirror image for checks: the plan's `Check:` commands run in a worktree at BASE the same way — reuse the `Run:` lines' worktree when you can, or cut one the same way; either is fine as long as it is gone afterwards — and each command that exits NON-zero draws one line `RED-AT-BASE fact: check: <command> — exits <n> at BASE in a bare worktree; no task can turn it green unless its Files hold the offender`, with ` (minor)` after the command when the check is minor; a command killed at the limit draws `RED-AT-BASE fact: check: <command> — not run (timeout after <s> s)`; a check that exits 0 draws nothing. Print those lines directly after the `GREEN-AT-BASE` lines and before the `AUTHORING fact:` line, under exactly the conditions the green lines print under. A worktree at BASE has no installed dependencies, so a check such as `bun run typecheck` will exit non-zero there for that reason alone — which is why the line says `in a bare worktree` and why it is a fact an author reads, never a refusal. `fleet/launch.mjs` relays the compiler's fact lines by prefix; do not edit it — a run-wide check holds `fleet/` byte-identical — and say in your hand-in note whether its relay picks the new prefix up (read how it selects lines; if it matches `fact:` generally it does, if it lists prefixes it does not, and that is a follow-up for a person). **The documents:** `skills/ultrawrite/references/authoring-gotchas.md` has a heading `## The sixteen rows` followed by sixteen bullets that each begin `- **`; add one bullet at the end of that list, before `## Three older lessons of the same kind`, in the file's own style — the rule in bold, then the reason and the run: a `Check:` red at BASE is a red no task of the plan owns unless one task's Files hold the offender, the compiler now prints it as a `RED-AT-BASE fact:` line under `--check --base`, and run-36 (popmechanic/tinyapp-fixture, 2026-09-21) is what it cost. Rename the heading to `## The rows` so it never states a count again, and update the file's own sentence that says the compiler refuses only some rules if it names the heading. In `skills/ultrawrite/SKILL.md`, the paragraph of the Proof slot that describes `GREEN-AT-BASE fact:` lines gains one sentence saying the same rehearsal runs the plan's `Check:` lines and prints a `RED-AT-BASE fact:` for each that exits non-zero. `tests/test_compile_plan_exam_sweep.py` pins the old heading and the count: its leg (j) greps `## The sixteen rows` (about lines 396 to 402 and 520 to 535) and asserts the rows number exactly 16. Those pins are yours: loosen them to what they meant — the `one Run, one exam` row is present between the rows heading and `## Three older lessons` — matching the heading as `## The` … `rows`, and drop the exact count rather than re-pinning it to seventeen. **For the examiner:** extend `tests/test_compile_plan_green_at_base.py`, which is on the tree and guarded, under one comment naming this task; do not open a second file. It already has what you need: `base_repo(tmp_path)` answers `(repo, head sha)`, `make_plan(...)` builds a one-task plan that compiles to `PLAN OK`, `run_bullets(*commands)`, `check_at(repo, name, text, *flags)` runs the compiler as a child and answers the completed process, and `fact_lines(stdout)`. `make_plan` has no parameter for Global Constraints: the plan text it returns contains a `## Global Constraints` section — insert your `- Check:` bullets into that text (read `HEAD` in the file for the section's exact shape) rather than changing `make_plan`'s signature for the legs already there. Assert on stdout lines and exit codes only. M4 is proven by the `Run:` lines and needs no pytest leg.

**Proof:**
- Test: `tests/test_compile_plan_green_at_base.py`
- Guard: `tests/test_compile_plan_green_at_base.py`
- Run: python3 -m pytest -q tests/test_compile_plan_exam_sweep.py
- Run: grep -q 'RED-AT-BASE fact:' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'RED-AT-BASE fact:' skills/ultrawrite/SKILL.md && ! grep -q 'sixteen' skills/ultrawrite/references/authoring-gotchas.md tests/test_compile_plan_exam_sweep.py
- Legs: (a) [M1] a plan with `- Check: false` and `- Check: true` under `--check --base <head>`: the process exits 0, stdout has a line `PLAN OK`, the stdout lines beginning `RED-AT-BASE fact:` are exactly one, that line contains `check: false` and `exits 1`, and no line beginning `RED-AT-BASE fact:` contains `check: true`; (b) [M2] a plan whose one check is `test "$ULTRA_BASE" = <head>` with the real head sha written in: no stdout line begins `RED-AT-BASE fact:`; and afterwards `git -C <repo> worktree list` prints exactly one line; (c) [M3] the `- Check: false` plan under a bare `--check`, under a plain compile with `--base <head>`, and — made refusable by deleting its gate-verdict record — under `--check --base <head>`: in each, no stdout line begins `RED-AT-BASE fact:`; (d) [M4] the two `Run:` lines — the loosened sweep exam exits 0 over this tree, both documents name the fact line, and the word `sixteen` is in neither the gotchas file nor that exam.

**Stale-if:**
- issue-closed: #1173

### Task 2: The sandbox's parser strips a Run line's clause tag and prints the clauses beside the command

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_parse.py`
- Test: `tests/test_plan_parse.py`

**Claim:** The sandbox runs a proof command exactly as the laptop check read it. (derived)
Machine: M1. For a task whose Proof carries `- Run: grep -q 'kata 0.17.2' fleet/CONTRACT.md [M2]`, `- Run: bash -n x.sh` and `- Run: true [M1, M3]`, `plan_parse.py` prints `proofRuns` exactly `["grep -q 'kata 0.17.2' fleet/CONTRACT.md", "bash -n x.sh", "true"]` and a new task key `proofRunClauses` exactly `[["M2"], [], ["M1", "M3"]]` — parallel to `proofRuns`, `[]` for an untagged command.
M2. A bracket that is not at the end of the command is part of the command: `- Run: test "$(echo [M1])" = x` prints unchanged, with `proofRunClauses` `[[]]`.
M3. On that same plan, the commands `compile_plan.py` records for the task — its parsed `proof_runs` — equal `plan_parse.py`'s `proofRuns`, element for element.
M4. Every task object gains exactly the one key `proofRunClauses` and no other; a task with no `Run:` line has `proofRunClauses` `[]`.

**Authorized-by:** #1177; the operator's signed Claim of 2026-09-21.

**Interfaces:**
- Consumes: none
- Produces: `plan_parse.py <plan.md>`

**Context:** You see this task body and nothing else. **The sibling task** edits `skills/ultrapowers/scripts/compile_plan.py`, two documents and two other test files; you share no file, and you must not edit `compile_plan.py`. **Why:** `skills/ultrawrite/SKILL.md` lets a Proof `Run:` end in a citation tag and promises the tag is stripped before the command runs. `compile_plan.py` does it — `RUN_CITE_RE = re.compile(r"\s*\[\s*(M\d+(?:\s*,\s*M\d+)*)\s*\]\s*$")`, anchored at the END of the value after whitespace, applied by `_claims_run_cites(value)`, which answers the command text and the sorted clause ids. `plan_parse.py` is the FACTORY's parser and does not: on the plan for run-197 (2026-09-21) it printed `proofRuns: ['grep -q "foldOrder" factory/engine.mjs [M3]', …]`, and the factory's engine runs `proofRuns` verbatim under `bash -lc`, where `grep` reads `[M3]` as a second file and exits 2 — a red landing on a correct patch. It was caught on the laptop before launch and no run has paid for it (a fact with its date). In `plan_parse.py`, `_parse_task_body` (about line 188) collects `proof_runs` at about line 283: it matches `PROOF_RUN_BULLET`, strips a whole-value backtick wrapper, and appends the value. Strip the tag there with the same regex and the same order of operations as the compiler — the backtick wrapper first, then the tag — collect the clause ids as a parallel list, sorted the way the compiler sorts them (`M1` before `M3`; numeric order), and print it as `proofRunClauses` wherever `proofRuns` is printed (`public_view`, about lines 667 to 673, is the one place a task's printed fields are chosen). Edge derivation reads `proof_runs` too (about line 493): it must now read the stripped command. **For the examiner:** extend `tests/test_plan_parse.py`, which is on the tree and guarded, under one comment naming this task; do not open a second file. It pins the task-object key set as `TASK_FIELDS = ORACLE_FIELDS | {"runOnlyClauses", "proofRuns", "testCmds"}` (line 52), used by several older tests, and a second constant `TASK_FIELDS_WITH_RUN_ONLY` derived from it (line 921): add `"proofRunClauses"` to `TASK_FIELDS` IN PLACE — do not add a new constant beside it (run-195's examiner appended a second constant, left the first stale, and five older tests went red). `ORACLE_FIELDS` does not change: the oracle comparison against the compiler is over those fields only. For M3, import the compiler the way the file's existing oracle test does (about lines 500 to 520 build `compiler_fields` from `compile_plan`'s own parse) and compare the task's parsed `proof_runs` with the parser's `proofRuns`; if the compiler's parse needs a gate-verdict record to get that far, read only its task parse, as the existing oracle test does. Build the plan text inside the test, as the file's other tests do.

**Proof:**
- Test: `tests/test_plan_parse.py`
- Guard: `tests/test_plan_parse.py`
- Legs: (a) [M1] for the three-`Run:` task, the printed `proofRuns` is `toEqual` the three-command list of M1 and `proofRunClauses` is exactly `[["M2"], [], ["M1", "M3"]]`; (b) [M2] for a task whose one `Run:` is `test "$(echo [M1])" = x`, `proofRuns` is exactly that one command unchanged and `proofRunClauses` is exactly `[[]]`; (c) [M3] on the three-`Run:` plan the compiler's parsed `proof_runs` for the task equals the parser's `proofRuns`; (d) [M4] every task object's key set is exactly `TASK_FIELDS` with `proofRunClauses` in it, and a task with no `Run:` bullet prints `proofRunClauses` exactly `[]`.

**Stale-if:**
- issue-closed: #1177
