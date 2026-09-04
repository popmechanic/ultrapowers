# The proof gate re-dispatches per task, the recurring rejection species print as advisories, and `- Check:` is a command

**Grammar:** claims-v1

**Claim:** After this run, `compile_plan.py --check` names a `;`-chained Run:, a `leg (e)` written
in prose, an unpinned default and an `every` checked as a count floor before any reader is
dispatched; a `- Check:` line under Global Constraints is a command the driver runs, not a
sentence a referee argues about; and a task gets its next reader the moment its own proof is
edited. (elicited)

**Goal:** #616. On the 2026-09-04 plans the proof gate spent 42 reader dispatches over 9 rounds
and 22 minutes; every rejection was correct, and ten recurring species of them are text
properties of the Claim/Proof pair a regex can see (the ticket's list). Two changes, neither
weakening the gate: the mechanical species become `--check` advisories so readers spend
judgment on the one thing only they can see, and the skill re-dispatches per task instead of
per round. Plus the constraint kind the same-day grilling decided (decision 1): `- Check:
<cmd>` under `## Global Constraints` is parsed into `constraintChecks` for the driver to
execute (the engine half is the concurrent plan `2026-09-04-judging-waste.md`); a prose bullet
stays the referee's attention lens. Run-74's death on a backticked `Run:` (exit 127, a correct
patch lost) becomes a refusal.

**Tech Stack:** Python 3.11 (`skills/ultrapowers/scripts/compile_plan.py`, pytest under
`tests/`), Markdown skill text (`skills/ultrawrite/SKILL.md`).

**Spec:** #616 (the ticket is the design record); the 2026-09-04 grilling, decision 1 (handoff
`2026-09-04-five-wide-then-the-walk.md`, untracked — everything a worker needs is in Context).

**Parallelization rationale:** One wave, width 3. Task 1 (the `Check:` kind and the backtick
refusal) and Task 2 (the species render) both edit `compile_plan.py` in different regions —
the Global Constraints parser and the emit payloads versus a new render appended to
`ADVISORY_RENDERS` — and their text folds at merge. Task 3 is skill prose proved by `Run:`
lines; it consumes nothing at runtime. No chain: no task needs another's behaviour, only the
shared literals in Context.

## Global Constraints

- `compile_plan.py --check` on a plan carrying no `- Check:` bullet and no `Run:` bullet prints
  output byte-identical to BASE's compiler (`tests/test_compile_plan_proof_runs.py`'s leg (e)
  against its frozen sha) — the new render rides behind `--renders`, and the `constraintChecks`
  key rides in the compile result, not in the `--check` channel.
- Every advisory line begins `ADVISORY ` and changes no exit code; every refusal is a `grammar:`
  line refused by both channels (`--check` exits 2, the full compile exits 1).
- The frozen periphery is untouched: `gate_check.py`, `ultra_gate.py`, `run_acceptance.sh` are
  byte-identical to BASE.
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite` prints `skill ok`;
  `skills/ultrawrite/SKILL.md` carries no `NEVER`/`ALWAYS`/`MUST`.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: `- Check:` compiles to `constraintChecks`; a backticked command is refused

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_check_constraints.py`

**Claim:** A `- Check:` line under Global Constraints is a command the driver runs, not a sentence
a referee argues about. (derived)
Machine: M1. A bullet matching `^-\s*Check:\s*(.+)$` (fence-aware, inside the `## Global
Constraints` section as `parse_global_constraints` bounds it) yields one entry `{ "cmd":
<command>, "minor": <bool> }` in a top-level `constraintChecks` list — present in the compile
result, the `--emit-launch` payload and the `--emit-args` payload — in section order; `cmd` is
the value with leading and trailing whitespace stripped and a whole-value backtick wrapper
removed, exactly `_claims_run_command`'s rule; a trailing `(minor)` (case-insensitive,
optional whitespace around it) sets `minor` to `true` and is stripped from `cmd`, otherwise
`minor` is `false`; a plan with no section or no Check: bullet yields `[]` in all three. M2.
The `globalConstraints` string excludes every `- Check:` line and is otherwise the section
body verbatim, so a plan carrying no Check: bullet compiles a `globalConstraints` value
byte-identical to BASE's compiler's. M3. A `Run:` or `Check:` whose stripped value still
contains a backtick is refused in both channels with the `grammar:` line `grammar: Run:
command carries a backtick — task <id>: <first 80 chars>; the driver's shell reads it as a
command substitution (run-74)` or `grammar: Check: command carries a backtick — <first 80
chars>; the driver's shell reads it as a command substitution (run-74)`. M4. Every fixture plan
under `evals/fixtures/*/plan.md` and `tests/fixtures/plans/*.md` still compiles, and each one
carrying no `Run:` bullet prints `--check` output byte-identical to BASE's compiler.

**Authorized-by:** the 2026-09-04 grilling, decision 1 (constraints are two kinds); #616's
comment of 2026-09-04 (refuse, not advise, a backticked `Run:`); #589 (`Run:` is a command).

**Interfaces:**
- Consumes: none
- Produces: `parse_constraint_checks(text: str) -> list[dict]`
- Produces: `constraintChecks`

**Context:** THE SHARED LITERAL with the concurrent engine plan: the `--emit-args` file gains the
top-level key `constraintChecks`, a JSON array in section order of `{ "cmd": "<the command,
verbatim, whole-value backticks stripped>", "minor": <bool> }`, `[]` when the section has no
`- Check:` bullet; `fleet/run-main.mjs` spreads the whole args file into the engine's `args`,
so nothing else upstream changes. In `compile_plan.py`: `GLOBAL_CONSTRAINTS_HEAD` /
`SECTION_BREAK` and `parse_global_constraints(text)` (a fence-aware whole-document scan
returning the verbatim body between the heading and the next `#`/`##` heading or task heading,
leading blanks and a trailing rule trimmed, `""` when absent) are the seam — add
`parse_constraint_checks(text)` beside it walking the same lines, and make
`parse_global_constraints` drop the lines the new parser claims. `RUN_LINE = re.compile(r"^-\s*Run:\s*(.+)$")`
and `_claims_run_command(value)` (strip, then `WHOLLY_BACKTICKED = re.compile(r"^`([^`]+)`$")`
unwrap) are the Run: rules; the backtick refusal belongs in `parse_claims_body` beside the
other `grammar:` violations for Run: (the `violations` list it returns; `collect_violations`
accumulates them for `--check` and the full compile refuses on them with exit 1 — the
`_refuses(tmp_path, plan_text, prefix)` helper in `tests/test_compile_plan_claims.py` asserts
both channels), and in the constraint parser's caller for Check: (append to the same
violation channel with no task id). `main()` computes `global_constraints =
parse_global_constraints(plan_text)` once and writes `"globalConstraints"` into the `result`
dict, `launch_payload` and `args_payload` — write `"constraintChecks"` beside it in all three.
The `--emit-args` top-level keys today are exactly `waves, wavesPath, edges, dependencyEdges,
acceptance, waveLabels, globalConstraints, planPath, planClaim` (+ `pluginRoot`, `runDir` under
`--run-dir`). The test helpers: `tests/test_compile_plan_claims.py` exports `_write`, `_sign`
(stamps an all-pass gate-verdicts file keyed on the live hashes — required, the compiler
refuses an unsigned claims-v1 plan), `_compile`, `_check_lines`, `_refuses`, `_body`, `_plan()`;
`tests/test_compile_plan_proof_runs.py` holds the BASE-compiler idiom (`BASE_SHA`, the
`base_compiler` fixture that `git show`s the blob at that sha, `_check_bytes`, `CORPUS`) — reuse
it by import for M4 rather than a second copy of the sha. Emit the compile result with
`--emit-args <file>` and read the JSON back, or read `result` from stdout, to assert the key.

**Proof:**
- Test: `tests/test_compile_plan_check_constraints.py`
- Legs: (a) a signed claims-v1 plan whose Global Constraints section reads `- The suite is
  green.\n- Check: python3 -m pytest -q tests/test_x.py\n- Check: \`! grep -rn golden
  fleet/\` (minor)\n- Check:   test -e a.txt  (MINOR)\n- Naming: no shouting.` compiles, and
  the compile result, the `--emit-launch` file and the `--emit-args` file each carry
  `constraintChecks` deep-equal to `[{"cmd": "python3 -m pytest -q tests/test_x.py",
  "minor": false}, {"cmd": "! grep -rn golden fleet/", "minor": true}, {"cmd": "test -e
  a.txt", "minor": true}]`; a plan with no Global Constraints section, and one whose section
  has only prose bullets, each carry `[]` in all three; a `- Check:` line inside a fenced
  block in the section is not an entry [M1]; (b) the same plan's `globalConstraints` in the
  `--emit-args` file equals `- The suite is green.\n- Naming: no shouting.`, and for every
  plan under `tests/fixtures/plans/*.md` the `globalConstraints` value the current compiler
  writes equals the value the BASE compiler (the `base_compiler` fixture) writes [M2]; (c) a
  task whose Proof carries `- Run: grep -q '\`x\`' file` is refused by both channels with a
  `grammar: Run: command carries a backtick — task 1:` line, a section carrying `- Check:
  echo \`date\`` is refused with a `grammar: Check: command carries a backtick —` line, and a
  wholly backticked `- Run: \`node check.mjs\`` and `- Check: \`test -e a\`` are not refused
  and yield `node check.mjs` / `test -e a` [M3]; (d) every plan in `CORPUS` compiles with
  exit 0 under the current compiler, and each Run-less one's `--check` bytes equal the BASE
  compiler's (the imported byte-identity assertion re-run here, so a Check:-less fixture that
  now differs names itself and fails it) [M4].

**Stale-if:**
- path-absent: `tests/test_compile_plan_claims.py`
- path-absent: `tests/test_compile_plan_proof_runs.py`
- issue-closed: #616

### Task 2: The recurring rejection species print as `ADVISORY proof-species:` lines

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_proof_species.py`

**Claim:** `compile_plan.py --check` names a `;`-chained Run:, a `leg (e)` written in prose, an
unpinned default and an `every` checked as a count floor before any reader is dispatched.
(derived)
Machine: M1. A render named `proof-species`, registered in `ADVISORY_RENDERS`, prints under
`--check --renders` one line per hit of the form `ADVISORY proof-species: <species> — task
<id>[, leg <label>]: <detail>`, for claims-v1 tasks only, and nothing for a legacy-grammar
plan. M2. Five species, each a text property: `run-chained-semicolon` — a `Run:` command
containing `;` outside single or double quotes (detail: the command's first 80 characters and
`the exit status is the last command's — join with && or || exit 1`); `leg-named-in-prose` —
a Proof leg whose text matches `\blegs?\s*\(([a-z])\)` (detail: the label and `the parser
splits at the next expected label — write "the previous leg"`); `default-unpinned` — a
Machine clause matching `\bdefaults?\s+to\s+`?([^\s,;.`]+)`?` whose citing legs' text nowhere
contains that literal (detail: the literal and `no citing leg pins it`); `universal-as-count-floor`
— a Machine clause containing `\b(every|each|all)\b` all of whose citing legs contain `at
least` and none of which contains `exactly`, `every`, `each`, `all`, `no other` or `none`
(detail: `a universal cited only by a count floor`); `duration-without-clock` — a Machine
clause matching `(≤|<=|within|under|at most|no more than)\s*\d+\s*(ms|s|sec|seconds?|min|minutes?)\b`
none of whose citing legs contains `elapsed`, `wall`, `Date.now`, `time.`, `perf_counter`,
`monotonic` or `clock` (detail: `a duration bound with no wall-clock leg`). M3. Each species
is silent on its repaired twin — `&&`-joined, `the previous leg`, the default literal in a
leg, an `exactly`/`every` leg, an `elapsed` leg — and the render changes no exit code: a plan
with every species present still prints `PLAN OK` and exits 0. M4. Without `--renders` the
render prints nothing, so every Run-less fixture plan's `--check` output stays byte-identical
to BASE's compiler.

**Authorized-by:** #616 (the species list, measured on the 2026-09-04 plans); #554 (the precedent
for mechanising a rejection species); #492/#496 (advisories report, never refuse).

**Interfaces:**
- Consumes: none
- Produces: `_render_proof_species(tasks, ctx) -> list[str]`

**Context:** The render contract, from `compile_plan.py`'s comment block above `ADVISORY_RENDERS
= []`: a render is `fn(tasks, ctx) -> list[str]`, `ctx` is `{"base", "plan_path", "tracked",
"task_ids", "exclude"}`, every returned line starts with `ADVISORY `, registration is
`ADVISORY_RENDERS.append(("proof-species", _render_proof_species))` and print order is
registration order; `render_advisories(plan_path, base, exclude=())` drives them under
`--renders` and degrades a raising render to one `ADVISORY <name>: render failed (<type>)`
line. The four existing renders (`blast-radius`, `referent`, `unverifiable-from-sandbox`,
`process-rule`) are the models; `_render_process_rules` reads the plan text through
`parse_global_constraints` and clips with `_clip(s, 90)`. What a task carries after
`parse_claims_body`: `t["claims"]["proof_runs"]` (the Run: commands in order),
`t["claims"]["machine_clauses"]` (`[{"id": "M1", "text": …}]`), `t["claims"]["proof_legs"]`
(`[{"label": "a", "text": …, "cites": ["M1", …]}]`) — a legacy task has no `claims` key or an
empty `machine_clauses`, which is the M1 guard. The existing species classifiers
(`UNIVERSAL_RE`, `NEGATION_RE`, `FALSIFIER_RE`, `ENUMERATED_RE` near `parse_machine_clauses`)
show the register. Quote-aware `;` detection: walk the command, toggling on unescaped `'` and
`"`, and flag a `;` seen outside both. Tests follow `tests/test_check_renders.py`'s idiom —
`_sign(_write(tmp_path, plan))`, `_compile`, then `subprocess` `--check --renders --base
<repo>` and filter stdout lines by the `ADVISORY proof-species:` prefix; the render family
needs a git checkout at `--base` (the plan's own repo under `tmp_path` initialised with `git
init` and one commit, as that file's fixtures do). The ticket's measurement — how many of the
2026-09-04 rejections each species would have pre-empted — is recorded on #616 by the operator
from the untracked plans; it is not this task's exam.

**Proof:**
- Test: `tests/test_compile_plan_proof_species.py`
- Legs: (a) a signed two-task claims-v1 plan carrying one hit of each species prints, under
  `--check --renders`, exactly five `ADVISORY proof-species:` lines, each naming its species,
  its task id and (for the leg species) its leg label, in the order `run-chained-semicolon`,
  `leg-named-in-prose`, `default-unpinned`, `universal-as-count-floor`,
  `duration-without-clock` for task 1 before any for task 2; a legacy-grammar plan (no
  `**Grammar:**` line) prints none [M1]; (b) one plan per species, each with the species in
  task 1 and its repaired twin in task 2 — `- Run: a; b` versus `- Run: a && b` and `- Run:
  echo 'a; b'` (the quoted `;` silent); a leg saying `as in leg (b)` versus `as in the
  previous leg`; `M1. X defaults to \`4\`.` cited by a leg with no `4` versus one asserting
  `\`4\``; `M1. every row is counted.` cited only by `at least 3 rows` versus `exactly 3
  rows`; `M1. waits ≤ 90 s.` cited by `iterates 3 times` versus `elapsed under 90 s` — yields
  exactly one `proof-species:` line naming task 1 and none naming task 2 [M2]; (c) the
  five-species plan exits 0 and its first line is `PLAN OK`; the same plan with `--check`
  alone prints no `proof-species:` line [M3, M4]; (d) `tests/test_compile_plan_proof_runs.py`'s
  byte-identity assertion (every Run-less fixture plan's `--check` bytes equal the BASE
  compiler's) is re-run from this file by importing and calling it, and fails on any plan
  whose bytes now differ [M4].

**Stale-if:**
- path-absent: `tests/test_check_renders.py`
- path-absent: `tests/test_compile_plan_proof_runs.py`
- issue-closed: #616

### Task 3: The skill re-dispatches per task and teaches the two constraint kinds

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`

**Claim:** A task gets its next reader the moment its own proof is edited. (derived)
Machine: M1. The section `## The proof gate — before any compile` carries one paragraph
stating that dispatch is `per task`, `not per round`: a task whose verdict lands first gets its
next reader `the moment` its `Claim or Proof` is edited — `re-extract` that task alone with
`extract_gate_input.py`, dispatch `one reader`, `do not wait` for the round's other verdicts —
with the verdict still `keyed on the hash`. M2. The same section carries one paragraph stating
that the `ADVISORY proof-species:` lines of `compile_plan.py --check --renders` name rejection
species found by hand, and are read and repaired (`repair`) `before` a `reader` is dispatched.
M3. The section `## Global Constraints discipline` carries one paragraph stating the two kinds:
a `- Check:` bullet is a command the `driver` executes in `every task's clone` and on the
`adopted tree` — `blocking` unless it ends `(minor)` — while a `prose` bullet is the referee's
attention `lens` on which a finding is `minor`; and that a constraint a command can decide is
written as a Check:, `never as prose`. M4. The file carries no `NEVER`/`ALWAYS`/`MUST`,
`validate_skill.py` accepts it, and the three pytest files that pin its other sections pass.

**Authorized-by:** #616 (the one-paragraph scheduling change); the 2026-09-04 grilling,
decision 1.

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The section today opens `One fresh-context subagent per task, asked one question: …`
and ends `A plan is not done until all three pass.`; the next heading is `## The
worktree-pure contract`, and `## Global Constraints discipline` is followed by `## Execution
handoff — analyze, then recommend`; its compile line is `python3
${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/compile_plan.py --check --renders <plan.md>`.
`## Global Constraints discipline` today is one paragraph: the section is forwarded to every
reviewer as its attention lens; state what must be true of the result; process rules are never
Global Constraints. The species names, for the prose: `run-chained-semicolon`,
`leg-named-in-prose`, `default-unpinned`, `universal-as-count-floor`, `duration-without-clock`.
The engine literal: a `Check:` runs in the task's clone before review and once on the adopted
tree; `(minor)` is recorded, never dispatched. Measured on 2026-09-04: rounds 1–4 (the wide
ones) took 13 of the 22 minutes; rounds 5–9 were one or two tasks at a time. The sentence
pins other tests hold on this file are on other sections (`Audience: the authoring agent`,
the header-marker sentence, the six slot names, the decision-tree clauses, the three tool
names) — leave those sections' wording alone.

**Proof:**
- Run: `awk '/^## The proof gate/,/^## The worktree-pure/' skills/ultrawrite/SKILL.md | awk 'BEGIN{RS=""} /per task/ && /not per round/ && /the moment/ && /Claim or Proof/ && /re-extract/ && /extract_gate_input.py/ && /one reader/ && /do not wait/ && /keyed on the hash/ {f=1} END{exit !f}'`
- Run: `awk '/^## The proof gate/,/^## The worktree-pure/' skills/ultrawrite/SKILL.md | awk 'BEGIN{RS=""} /ADVISORY proof-species:/ && /--check --renders/ && /repair/ && /before/ && /reader/ {f=1} END{exit !f}'`
- Run: `awk '/^## Global Constraints discipline/,/^## Execution handoff/' skills/ultrawrite/SKILL.md | awk 'BEGIN{RS=""} /- Check:/ && /driver/ && /every task.s clone/ && /adopted tree/ && /blocking/ && /\(minor\)/ && /prose/ && /lens/ && /minor/ && /never as prose/ {f=1} END{exit !f}'`
- Run: `! grep -nE '\b(NEVER|ALWAYS|MUST)\b' skills/ultrawrite/SKILL.md && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite && python3 -m pytest -q tests/test_ultrawrite_skill.py tests/test_recommendation_rubric.py tests/test_proof_modes_documented.py`
- Legs: (a) the first Run: exits non-zero unless one paragraph inside the proof-gate section
  (the awk range from its heading to the next `## ` heading) carries all nine: `per task`,
  `not per round`, `the moment`, `Claim or Proof`, `re-extract`, `extract_gate_input.py`,
  `one reader`, `do not wait` and `keyed on the hash` — a paragraph that keeps the round
  barrier lacks `not per round` and `do not wait` and fails it, and a paragraph elsewhere in
  the file is outside the range [M1]; (b) the second exits non-zero unless one paragraph in
  the same section carries `ADVISORY proof-species:`, `--check --renders`, `repair`,
  `before` and `reader` together [M2]; (c) the third exits non-zero unless one paragraph in
  the Global Constraints section (its heading to `## Execution handoff`) carries `- Check:`,
  `driver`, `every task's clone`, `adopted tree`, `blocking`, `(minor)`, `prose`, `lens`,
  `minor` and `never as prose` together — a paragraph that states only the Check: kind and
  not the rule that decidable constraints are never prose fails it [M3]; (d) the fourth
  exits non-zero on a shouted word, a validator refusal, or a failure of the three pytest
  files that pin this skill's other sections [M4].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
- issue-closed: #616
