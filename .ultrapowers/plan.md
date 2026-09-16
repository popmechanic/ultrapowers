# The state handshake — a producer posts the state it reached, its sibling's exam seeds from it, the driver refuses a post that disagrees with the expected file

**Grammar:** claims-v1

**Claim:** A producer task posts the state it reached, its sibling's exam starts from that posted state, and the linker refuses the pair when the posted state and the producer's expected file disagree. (elicited)
**Summary:** This lets one task hand the next task the exact app state it ended in, through the run's own issue tracker, instead of the next task's author guessing that state from memory. It exists because the two plans that parked on 2026-09-14 parked on a state literal an author wrote by hand, and because the interface handshake (#812) was re-homed on kata on 2026-09-12 with nobody yet reading what a producer posts. After this run a consumer's exam is seeded from what the producer actually reached, and a producer whose post disagrees with its own expected file is stopped at review with the differing cell named, so a wrong state costs one fix round instead of a parked run.

**Goal:** the fifth first-wave ticket of map #998 ("Prototype — the state handshake (#812 in the store's vocabulary)"), on the plugin repository popmechanic/ultrapowers; approved by the operator 2026-09-16 as drafted (a plugin plan, the `state.reached` metadata key with `--json-value`, the check done by the driver at the pre-review pass). Read at `901fc874923210207e041f947407b8ea519c1ab2`: #729's linker was deleted with the referee at #921, the reviewer role runs `dontAsk` over `Read/Grep/Glob/git diff|log|status` and cannot reach kata, a Proof's exam command runs with the engine's own environment plus `ULTRA_*` and no `KATA_REF`, clones are cut at `base=` so `.ultrapowers/kata.json` is not in any worker's tree, and kata v0.17.2 has no fact kinds (`/api/v1/facts`, `/api/v1/kinds` and `openapi.json` all answer 404) — a state rides an issue's metadata as raw JSON (`kata meta set <ref> <key> <value> --json-value`), which the driver already reads through `getIssue`. So the only reader that can exist today is the driver, and that is Task 2.
**Closes:** #812

**Tech Stack:** Node ≥ 20 (`fleet/`), the engine sims under `fleet/tests/test_*.mjs` (sentinel `ALL TESTS PASSED`, bridged by `tests/test_fleet_suite.py`), the kata CLI 0.17.2 on the sandbox, the hub's REST API through `fleet/kata-client.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-09-interface-handshake.md` (its 2026-09-12 amendment re-homes the handshake on kata; §3.5's post shape is kept as the grammar); map #998 rules 1, 3 and 4; #811 decisions 2, 4 and 7 transposed from a signature to a state.

**Parallelization rationale:** one wave of width 2 — Task 1 (the role file and the contract's fact bullet) and Task 2 (the driver's two reads and the sim) share `fleet/CONTRACT.md`, a text overlap that folds. No chain: Task 2's sim stubs the hub with the fake client `test_worker_kata_env.mjs` already uses and reads no role file, so nothing it needs is Task 1's runtime behaviour.

## Global Constraints

- The fact is `state.reached`, one metadata key on the producing task's own kata issue, set by that task's implementer with `--json-value`, whose value is exactly `{"expected": "<path under state-exams/expected/>", "content": [tables, values]}` — the `getContent()` pair of the file `expected` names. No other role posts it and no other key carries it.
- The durable record is git: every post the driver reads is also one `fact:state.reached` event on `events.jsonl`, and a run with no posts appends none.
- A run with no kata record (`run-main.mjs` without `--kata`) behaves exactly as at BASE: no hub request, no file written under `state-exams/posted/`, no handshake event.
- Every role file keeps its register: no shouted imperatives (`fleet/roles/README.md`).
- Check: node fleet/tests/test_sims_are_hermetic.mjs | grep -q 'ALL TESTS PASSED'

### Task 1: The producer's one command, and the contract's name for the fact

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `fleet/roles/implementer.md`
- Modify: `fleet/CONTRACT.md`

**Claim:** After a producer's exam is green, its implementer posts the state it reached on its own kata issue with one command the role file gives it, and the contract names that fact. (derived)
Machine: M1. `fleet/roles/implementer.md` carries a section headed `## The state you reached` that names the key `state.reached`, the command `kata meta set $KATA_REF state.reached … --json-value`, the two fields `expected` and `content`, and the rule that the post is made once (`post it once`), after the task's own exam is green, and only by a task whose Proof names a state exam (`only a task whose Proof names a state exam`). M2. `fleet/CONTRACT.md`'s kata record (engine) bullet — the one opening `Kata record (engine)` — names `state.reached`, its two fields `expected` and `content`, its one poster (the producing task's implementer) and its one reader (the driver, Task 2's two reads), in that order.

**Authorized-by:** #998 first-wave ticket 5; #811 decisions 2 and 4 (one poster, one key, latest post wins); spec amendment 2026-09-12 (kata is the substrate)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The role file already licenses `kata comment $KATA_REF --body …` and `kata meta set $KATA_REF work.attention …` under `## The issue`; the new section sits directly after it and adds one key, never a second verb. `kata meta set` stores a string unless `--json-value` is passed (kata docs `reference/metadata.md`, read at v0.17.2), so the flag is load-bearing. The value the implementer posts is the parsed content of the expected file its exam names — the one command is `kata meta set $KATA_REF state.reached "{\"expected\":\"<path>\",\"content\":$(cat <path>)}" --json-value`, spelled in the role file with the path as a placeholder. A task whose Proof names no state exam (a plugin task, a prose task) posts nothing, and the section says so in one sentence. `KATA_REF` unset means no kata at all, as the existing section already says; the new section adds no second rule for that case.

**Proof:**
- Run: sed -n '/^## The state you reached/,/^## /p' fleet/roles/implementer.md | tr '\n' ' ' | grep -q 'state\.reached.*kata meta set \$KATA_REF state\.reached.*--json-value.*expected.*content'
- Run: sed -n '/^## The state you reached/,/^## /p' fleet/roles/implementer.md | tr '\n' ' ' | grep -q 'after.*exam.*green'
- Run: sed -n '/^## The state you reached/,/^## /p' fleet/roles/implementer.md | tr '\n' ' ' | grep -q 'post it once'
- Run: sed -n '/^## The state you reached/,/^## /p' fleet/roles/implementer.md | tr '\n' ' ' | grep -q 'only a task whose Proof names a state exam'
- Run: sed -n '/Kata record (engine)/,/^- \*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'state\.reached.*expected.*content.*implementer.*driver'
- Legs: (a) the section exists under that heading and, read as one line, names the key, the command with `--json-value`, and both fields in order [M1]; (b) the same section names the timing — after the exam is green [M1]; (c) the same section carries the words `post it once` [M1]; (d) and the words `only a task whose Proof names a state exam` [M1]; (e) the kata record (engine) bullet of the contract — the lines from its `Kata record (engine)` opener to the next bullet, read as one line — names `state.reached`, then `expected`, then `content`, then the implementer, then the driver, in that order, and a bullet lacking any of the five fails the leg [M2].

**Stale-if:**
- path-absent: `fleet/roles/implementer.md`

### Task 2: The driver's two reads — seed the consumer from the post, refuse a post the expected file contradicts

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_run_engine_state_handshake.mjs`

**Claim:** When a producer has posted the state it reached, its consumer's exam runs seeded from that state, and a producer whose post disagrees with its own expected file is stopped at review with the differing cell named. (derived)
Machine: M1. Before a consumer task's exam command first runs, for each task the consumer consumes from (the run's dependency edges), the driver's `getIssue` of that producer's recorded uid yields `metadata['state.reached']`, and when that value is well-formed (M5) the driver writes its `content`, as JSON, to `state-exams/posted/<producer task id>.json` in the consumer's task clone and in its examiner's clone; a producer whose issue carries no `state.reached` writes no file and appends one `handshake:absent {task, producer}` event. M2. At a producer's pre-review pass, when its issue carries `state.reached`, the driver reads the file `expected` names from the tree the captured patch describes and compares its parsed JSON with `content`; equal appends one `handshake:settled {task, expected}` event and adds no finding; unequal raises one `blocking` finding on the producer with `actor` `implementer`, prefixed `handshake:`, whose detail carries the first differing cell as `<table>/<row>/<cell> got <posted> wanted <file>`, and that finding routes to the task's `fix:<id>:0` round exactly as any blocking finding does; an `expected` path absent from the captured tree raises the same finding naming the path. M3. Every post the driver reads under M1 or M2 is appended once to `events.jsonl` as `fact:state.reached {task, expected, sha256}` where `sha256` is over the canonical JSON of `content`; a run with no `state.reached` on any issue appends no `fact:state.reached` and no `handshake:settled` event (its `handshake:absent` events are M1's), writes nothing under `state-exams/posted/`, and every worker prompt is byte-identical to the prompt the same run produces at BASE. M4. A run started without `--kata` makes no `getIssue` for the handshake, appends no `handshake:*` event of any kind, and satisfies M3's no-post half. M5. A `state.reached` value is well-formed exactly when it is an object whose `expected` is a string beginning `state-exams/expected/` and whose `content` is an array of exactly two elements; a malformed value writes no seed file under M1 and, at the producer's pre-review pass, raises the same `blocking` `handshake:` finding with `actor` `implementer` whose detail names the malformed field (`content` or `expected`) — never M2's cell comparison, and never a `fact:state.reached` event.

**Authorized-by:** #998 first-wave ticket 5 and rules 3–4; #811 decision 2 (a mismatch is a blocking finding on the producer) and 7 (deletion owed behind #812's metric); spec §3.5 (every fact is an event)

**Interfaces:**
- Consumes: none
- Produces: `handshakeOf(issue: {metadata?: object}) -> {expected: string, content: [object, object]} | null`

**Context:** The seams, read at `901fc874`: the driver's per-task issue read is `kata.getIssue(row.uid)` (~line 1342, and again at ~3727), the exam runs through `runExam` (~line 2707) with `examEnv` (~line 783: the engine's own environment plus `ULTRA_BASE`, `ULTRA_TASK`, `ULTRA_RUN_DIR`, `ULTRA_EXAM_PASS`), the pre-review pass and its `fix:<id>:0` repair round sit around line 2836, the driver's metadata writes are `kataTouched`/`kataAdopted`/`kataLanded` (~lines 1203–1280) and every hub call goes through `kataCall` (~line 1125) so a refused read is a `kata:write-failed`-class event and never the run's failure. The fake hub the sim needs is the shape `fleet/tests/test_worker_kata_env.mjs` builds (`makeFakeKata`, ~line 520: `getIssue`, `claim`, `patchMetadata`, `comment`, `close`, with `metadata` on each issue) — copy it, since that file is not in this task's Files, and give the producer's issue a `metadata['state.reached']`. The consumer's edges are the run's `dependencyEdges`/`edges` the compiler emits from `Consumes:`/`Produces:`; the producer id in `state-exams/posted/<id>.json` is the task id as the plan numbers it. Canonical JSON for the sha256 is `JSON.stringify` with keys sorted at every level. The `handshake:` finding is a driver-raised entry in the same findings list the reviewer's block reads, so it needs no role-file edit and the reviewer never reaches kata. What the hub lacks and this task supplies by hand: kata has no fact kinds, so a malformed post (`content` not a two-element array, `expected` not under `state-exams/expected/`) is refused here, by the driver, as the same `handshake:` finding naming what is malformed — never silently written as a seed.

**Proof:**
- Test: `fleet/tests/test_run_engine_state_handshake.mjs`
- Run: node fleet/tests/test_run_engine_state_handshake.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) with a two-task plan whose consumer consumes the producer's symbol and a fake hub whose producer issue carries `state.reached` `{expected, content}`, the consumer's task clone and examiner clone both hold `state-exams/posted/<producer id>.json` parsing to exactly `content` before the consumer's exam command runs, measured by an exam command that reads the file [M1]; (b) with the producer's issue carrying no such key, no file exists under `state-exams/posted/` in either clone and exactly one `handshake:absent` event names the pair [M1]; (c) with the producer's captured tree holding an expected file equal to `content`, the producer's findings carry no `handshake:` entry and `events.jsonl` holds exactly one `handshake:settled` [M2]; (d) with one cell of the file differing, the producer's findings carry exactly one `blocking` `handshake:` finding with `actor` `implementer` whose detail is `<table>/<row>/<cell> got <posted> wanted <file>` for that cell, and the task is dispatched a `fix:<id>:0` round [M2]; (e) with `expected` naming a path absent from the captured tree, the same finding names that path [M2]; (f) with a `content` that is a three-element array, the producer's findings carry exactly one `blocking` `handshake:` finding with `actor` `implementer` whose detail names `content`, no file exists under `state-exams/posted/` in the consumer's clones, and `events.jsonl` holds no `fact:state.reached` [M5]; (f2) with `expected` a string not beginning `state-exams/expected/`, the same finding names `expected` and the same two absences hold [M5]; (g) every read post yields exactly one `fact:state.reached` event whose `sha256` equals the sha256 of the sorted-key JSON of `content`, computed independently in the sim [M3]; (h) a run whose issues carry no `state.reached` — the two-task plan of leg (b) — appends no `fact:state.reached` and no `handshake:settled` event, writes nothing under `state-exams/posted/`, and its recorded worker prompts are byte-identical to those of the same run under the BASE engine's prompt builder — the prompt files diffed byte for byte [M3]; (i) the same two-task plan run without `--kata` makes zero `getIssue` calls for the handshake, appends no event whose kind begins `handshake:`, and satisfies leg (h)'s three absences [M4].

**Stale-if:**
- path-exists: `fleet/tests/test_run_engine_state_handshake.mjs`
