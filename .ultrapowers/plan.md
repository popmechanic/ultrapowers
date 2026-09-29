# One source per fact: the parser gives task bodies, and shared literals live once

**Grammar:** claims-v1
**Claim:** Each fact the review found written in two or more places is written once and read from there, and a task body can no longer be cut short by a fenced heading inside it. (elicited)
**Summary:** The review found the same thing written in several places: the engine re-reads a plan on its own beside the one parser, four launch sims carry the same fixtures, the record reads its event log several times, and a few fleet and parser rules exist in two copies that have already drifted apart. This makes each of them live in one place and be read from there, and it fixes the one copy that was already wrong — the engine's own plan reader cuts a task's text short at any fenced `### Task` line inside it. You get fewer places for a rule to drift, and a builder that always sees its whole task.

**Goal:** The parser emits each task's `body`; `factory/flock/plan.mjs` stops re-reading the plan. One launch-sim rig. One events read and one policy-cell read in the record; one evidence list in the boot. One home for the fleet's target, verb-record and account rules. `plan_check.py` and `extract_gate_input.py` take the parser's regexes.
**Tech Stack:** Python 3, Node (fleet, engine), bash
**Spec:** none — the whole-codebase review of 2026-09-29 (DRY findings across the four readings); operator pick 2026-09-29 ("One source per fact")

## Global Constraints

- What a launch, a run, a PR body and a plan compile print is unchanged, except where a task below says otherwise.
- Check: python3 -m pytest -q

### Task 1: The parser gives each task its body, and the engine stops re-reading the plan

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_parse.py`
- Modify: `skills/ultrapowers/scripts/stories_parse.py`
- Modify: `factory/flock/plan.mjs`

**Claim:** A task body can no longer be cut short by a fenced heading inside it, and the engine reads a task's text from the one parser. (derived)
Machine: M1. For a copy of `evals/fixtures/claims/plan.md` with a fenced block holding the line `### Task 9: fenced heading` inserted just before `### Task 2`, `workloadFromPlan` from `factory/flock/plan.mjs` returns exactly 3 tasks, and task 1's `body` starts with `Task 1: ` and contains `### Task 9: fenced heading`. M2. `plan_parse.py`'s JSON for `evals/fixtures/claims/plan.md` and for `evals/fixtures/stories/todo/.ultrapowers/plan.md` gives every task a `body` string that starts with `Task <its id>: `. M3. `factory/flock/plan.mjs` contains neither `sectionsById` nor `readFileSync`.

**Authorized-by:** the factory and ultrapowers review readings of 2026-09-29 (DRY: the plan parsed outside `plan_parse.py`); operator pick 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE, `factory/flock/plan.mjs`'s `sectionsById` splits the raw plan text on `^### Task ` with no fence awareness, so task 1's body stops at any fenced `### Task …` line. On the M1 fixture it ends before the fenced block, and the rest of task 1 goes missing. `plan_parse.py` already skips fenced lines and already computes a task's body in `all_tasks` (`"body": …`). It does not put `body` in its public view. `stories_parse.py`'s tasks carry no `body` either.

What each builder is shown must not change for a plan without fenced headings. Keep `sectionsById`'s format: the task's heading line without the leading `### ` (so `Task <id>: <title>`), then everything up to the next unfenced task heading, trimmed. For the stories fixture at BASE, task 1's body begins `"Task 1: The todo piece\n\n**Piece:** todo\n**Depends-"`.

Both parsers emit that `body` on every task. `plan.mjs` reads it from the parsed JSON for both grammars (`storiesWorkload` and the claims path) and drops `sectionsById` and its `readFileSync`.

**Proof:**
- Run: bash -c 'd=$(mktemp -d); python3 -c "import sys; t=open(\"evals/fixtures/claims/plan.md\").read(); i=t.index(\"### Task 2\"); open(sys.argv[1],\"w\").write(t[:i]+\"~~~text\n### Task 9: fenced heading\n~~~\n\n\"+t[i:])" "$d/p.md" && node --input-type=module -e "import {workloadFromPlan} from \"./factory/flock/plan.mjs\"; const w = workloadFromPlan(process.argv[1]); process.exit(w.tasks.length === 3 && w.tasks[0].body.startsWith(\"Task 1: \") && w.tasks[0].body.includes(\"### Task 9: fenced heading\") ? 0 : 1)" "$d/p.md"' [M1]
- Run: bash -c 'for p in evals/fixtures/claims/plan.md evals/fixtures/stories/todo/.ultrapowers/plan.md; do python3 skills/ultrapowers/scripts/plan_parse.py "$p" | python3 -c "import json,sys; ts=json.load(sys.stdin)[\"tasks\"]; assert ts and all(isinstance(t.get(\"body\"), str) and t[\"body\"].startswith(\"Task %s: \" % t[\"id\"]) for t in ts)" || exit 1; done' [M2]
- Run: bash -c '! grep -nE "sectionsById|readFileSync" factory/flock/plan.mjs' [M3]
- Legs: (a) the fenced heading stays inside task 1's body and draws no fourth task [M1]; (b) every task of both fixtures carries a body starting with its heading [M2]; (c) the engine's plan reader has no plan re-read left [M3].

**Stale-if:**
- path-absent: `factory/flock/plan.mjs`

### Task 2: The launch sims share one rig

**Type:** implementation

**Files:**
- Modify: `fleet/tests/_lobby_helpers.mjs`
- Modify: `fleet/tests/test_launch_credential.mjs`
- Modify: `fleet/tests/test_launch_duplicate.mjs`
- Modify: `fleet/tests/test_launch_one_engine.mjs`
- Modify: `fleet/tests/test_launch_plan_path.mjs`

**Claim:** Each fact the review found written in two or more places is written once and read from there. (derived)
Machine: M1. None of the four files `fleet/tests/test_launch_credential.mjs`, `test_launch_duplicate.mjs`, `test_launch_one_engine.mjs` and `test_launch_plan_path.mjs` declares a top-level `BILLING_OK`, `ONE_TASK`, `NEW_OK`, `ENGINE_RULE`, `COMPILER_FETCH`, `pointAtOrigin`, `localRemote` or `OFFLINE`. M2. Those four files together are at most 1330 lines (1423 at BASE).

**Authorized-by:** the fleet review reading of 2026-09-29 (DRY 1); operator pick 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE the four launch sims each declare the same fixtures, word for word apart from constants. Each one has, at top level:
- `BILLING_OK`, `ONE_TASK` (built with a local `task()`) and `NEW_OK`;
- `ENGINE_RULE`, which reads the file's own `ENGINE` sha;
- `COMPILER_FETCH`, `pointAtOrigin`, `localRemote` and `OFFLINE`.

Line counts at BASE: `test_launch_credential.mjs` 488, `test_launch_duplicate.mjs` 332, `test_launch_one_engine.mjs` 315, `test_launch_plan_path.mjs` 288 (1423 in all).

Move them into `fleet/tests/_lobby_helpers.mjs`, the four sims' shared helper, exported. A fixture that reads a per-file constant, such as `ENGINE_RULE` with `ENGINE`, becomes a function of it. Each sim imports what it uses. Keep each sim's own cases and assertions as they are.

`fleet/tests/test_sims_are_hermetic.mjs` requires a sim to import only helpers (`_*.mjs`), never another `test_*.mjs`. `_lobby_helpers.mjs` is such a helper.

**Proof:**
- Run: bash -c '! grep -nE "^(const|let|function|async function) (BILLING_OK|ONE_TASK|NEW_OK|ENGINE_RULE|COMPILER_FETCH|pointAtOrigin|localRemote|OFFLINE)\b" fleet/tests/test_launch_credential.mjs fleet/tests/test_launch_duplicate.mjs fleet/tests/test_launch_one_engine.mjs fleet/tests/test_launch_plan_path.mjs' [M1]
- Run: bash -c 'n=$(cat fleet/tests/test_launch_credential.mjs fleet/tests/test_launch_duplicate.mjs fleet/tests/test_launch_one_engine.mjs fleet/tests/test_launch_plan_path.mjs | wc -l); test "$n" -le 1330' [M2]
- Run: node fleet/tests/test_launch_credential.mjs
- Run: node fleet/tests/test_launch_duplicate.mjs
- Run: node fleet/tests/test_launch_one_engine.mjs
- Run: node fleet/tests/test_launch_plan_path.mjs
- Legs: (a) no launch sim declares any of the eight shared fixtures itself [M1]; (b) the four files shrink to at most 1330 lines [M2].

**Stale-if:**
- path-absent: `fleet/tests/_lobby_helpers.mjs`

### Task 3: The record reads its event log once and its policy cells one way, and the boot names its evidence once

**Type:** implementation

**Files:**
- Modify: `factory/record.mjs`
- Modify: `factory/audit.mjs`
- Modify: `factory/boot.sh`

**Claim:** Each fact the review found written in two or more places is written once and read from there. (derived)
Machine: M1. `factory/record.mjs` contains exactly one `readFileSync(eventsPath`, and `factory/audit.mjs` contains none. M2. `factory/record.mjs` contains exactly one `JSON.parse(readFileSync(policyPath`. M3. `factory/boot.sh` contains the string `board-ops.json board.json weave-ops.digest.jsonl snapshots.jsonl snapshot-texts.json red-checks.json past.json` at most once.

**Authorized-by:** the factory review reading of 2026-09-29 (DRY 1, 3, 6); operator pick 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE:
- **`events.jsonl` is read four times:** `record.mjs`'s `readEventRows` (~line 63), `jevStepLines` (~222) and `draftReasonLines` (~243) each read the file, and so does `audit.mjs` (~101). Keep one reader, `readEventRows`: export it, have `jevStepLines` and `draftReasonLines` take the rows, and have `audit.mjs` import it. `record.mjs` does not import `audit.mjs` at BASE, so there is no import cycle to make.
- **Two policy readers:** `renderPolicy` (~289) and `renderPublishPolicy` (~311) each do the same fail-closed read of a policy cell. Give them one shared reader. Their printed output does not change.
- **The evidence list, twice:** `boot.sh`'s `collect_evidence` (~164) and `evidence_commit` (~171) each spell out `board-ops.json board.json weave-ops.digest.jsonl snapshots.jsonl snapshot-texts.json red-checks.json past.json`. Name that list once, as a bash array, and use it in both. `evidence_commit`'s other names (`status.json`, `events.jsonl`, `engine.log`, `summary.json`, the `publish*` files) stay as they are.

`fleet/tests/test_factory_record.mjs` and `fleet/tests/test_factory_boot.mjs` cover these paths.

**Proof:**
- Run: bash -c 'test "$(grep -c "readFileSync(eventsPath" factory/record.mjs)" -eq 1 && ! grep -q "readFileSync(eventsPath" factory/audit.mjs' [M1]
- Run: bash -c 'test "$(grep -c "JSON.parse(readFileSync(policyPath" factory/record.mjs)" -eq 1' [M2]
- Run: bash -c 'test "$(grep -c "board-ops.json board.json weave-ops.digest.jsonl snapshots.jsonl snapshot-texts.json red-checks.json past.json" factory/boot.sh)" -le 1' [M3]
- Run: bash -n factory/boot.sh
- Run: node fleet/tests/test_factory_record.mjs
- Run: node fleet/tests/test_factory_boot.mjs
- Legs: (a) the event log is read in one place, and the audit reads none itself [M1]; (b) one policy-cell read [M2]; (c) the evidence list is spelled once [M3].

**Stale-if:**
- path-absent: `factory/record.mjs`

### Task 4: The fleet's target, verb-record and account rules live once

**Type:** implementation

**Files:**
- Modify: `fleet/lobby.mjs`
- Modify: `fleet/doctor.mjs`
- Modify: `fleet/launch.mjs`
- Modify: `fleet/claude-token.mjs`

**Claim:** Each fact the review found written in two or more places is written once and read from there. (derived)
Machine: M1. `isSafeTarget` from `fleet/lobby.mjs` returns `false` for `../..` and for `.a/b`, and `true` for `popmechanic/ultrapowers` and for `a.b/c-d_e`. M2. `fleet/doctor.mjs` declares no top-level `TARGET` regex and no `DEFAULT_VERBS_PATH`; neither `fleet/doctor.mjs` nor `fleet/launch.mjs` contains `exe-verbs.json`; `fleet/launch.mjs` declares no `ACCOUNT_NAME`; and `fleet/claude-token.mjs` contains neither `'exe.dev',` nor `fleet-r*`.

**Authorized-by:** the fleet review reading of 2026-09-29 (DRY 4, 6, 8); operator pick 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE:
- **The target rule** is written twice, and the two copies drifted.
  - `lobby.mjs:44`: `isSafeTarget` is `/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/`, which accepts `../..`.
  - `doctor.mjs:135`: `TARGET` is `/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/`.

  `isSafeTarget` takes the doctor's stricter pattern, and the doctor calls `isSafeTarget`.
- **The verb record's path** is written twice: `launch.mjs:120` `VERBS_PATH` and `doctor.mjs:96` `DEFAULT_VERBS_PATH`. Export one from `lobby.mjs`, and both import it.
- **The account rule** is `claude-token.mjs:101` `ACCOUNT_RE`, copied as `launch.mjs:113` `ACCOUNT_NAME`. Its comment there says it was "copied rather than imported". Export it from `claude-token.mjs`, and the launcher imports it.
- **`claude-token.mjs`** spawns `ssh` with `'exe.dev'` (~line 203) and lists `'fleet-r*'` (~308–311) itself. Use `EXE_HOST` and `FLEET_PATTERN` from `lobby.mjs`. Its synchronous shape stays.

The doctor, launcher and token sims (`fleet/tests/test_doctor*.mjs`, `test_launch_*.mjs`, `test_claude_token*.mjs`) must stay green under the global check.

**Proof:**
- Run: node --input-type=module -e "import { isSafeTarget } from './fleet/lobby.mjs'; process.exit(!isSafeTarget('../..') && !isSafeTarget('.a/b') && isSafeTarget('popmechanic/ultrapowers') && isSafeTarget('a.b/c-d_e') ? 0 : 1)" [M1]
- Run: bash -c '! grep -nE "^const TARGET = /|DEFAULT_VERBS_PATH" fleet/doctor.mjs && ! grep -n "exe-verbs.json" fleet/doctor.mjs fleet/launch.mjs && ! grep -nE "^const ACCOUNT_NAME" fleet/launch.mjs && ! grep -nE "\[.exe\.dev.,|fleet-r\*" fleet/claude-token.mjs' [M2]
- Legs: (a) the one target rule refuses a dot-led or `..` target and accepts two real shapes [M1]; (b) none of the second copies is left [M2].

**Stale-if:**
- path-absent: `fleet/lobby.mjs`

### Task 5: The laptop's plan tools take the parser's rules

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_check.py`
- Modify: `skills/ultrawrite/scripts/extract_gate_input.py`

**Claim:** Each fact the review found written in two or more places is written once and read from there. (derived)
Machine: M1. `skills/ultrapowers/scripts/plan_check.py` defines no `PATH_RE`, no `_FENCE_MARK_RE` and no `_is_implementation` of its own. M2. `skills/ultrawrite/scripts/extract_gate_input.py` defines no `_FILES_BULLET`.

**Authorized-by:** the ultrapowers and ultrawrite review readings of 2026-09-29 (DRY 3 and 7); operator pick 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `plan_parse.py` is the one plan parser, and both scripts already import it. At BASE they carry their own copies of these patterns:
- `plan_check.py:58` `PATH_RE` (a backticked-span pattern) duplicates `plan_parse.BACKTICK_PATH_RE`.
- `plan_check.py:816` `_FENCE_MARK_RE` (three or more backticks or tildes) duplicates `plan_parse._FENCE_RE`. The parser's pattern also allows a trailing info string, which is a superset for `.match`.
- `plan_check.py:289` `_is_implementation(t)` duplicates `plan_parse._is_implementation(t["type"])`.
- `extract_gate_input.py:81` `_FILES_BULLET` (a `Create`/`Modify`/`Delete` bullet) duplicates `plan_parse.FILE_BULLET`. The parser's copy is case-insensitive, and the extractor's matches are over lines it has already stripped.

Use the parser's copies. `plan_check.py:817` `_FILES_BULLET_RE` also matches retired `Test`/`Fixture(s)` bullets on purpose, for the base-fact reading; leave it.

**Proof:**
- Run: bash -c '! grep -nE "^(PATH_RE|_FENCE_MARK_RE) = re.compile|^def _is_implementation" skills/ultrapowers/scripts/plan_check.py' [M1]
- Run: bash -c '! grep -nE "^_FILES_BULLET = re.compile" skills/ultrawrite/scripts/extract_gate_input.py' [M2]
- Run: python3 -m pytest -q tests/test_plan_check.py tests/test_extract_gate_input.py
- Legs: (a) `plan_check.py` keeps none of its three copies [M1]; (b) the extractor keeps no Files-bullet copy [M2].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/plan_check.py`
