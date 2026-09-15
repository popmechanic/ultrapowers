# The report reference describes the ready-set engine — run-138's task 1 re-driven with its reviewer's one finding folded in

**Grammar:** claims-v1

**Claim:** `report-format.md` describes the report the engine writes on `597c6db1`: `waveMerges` one row per epoch (`wave` = the epoch), `unfinished` for every task that never became ready with its reason, no `SKIPPED` cascade rows, no wave-position judgment call. (quoted from #986)
**Summary:** This brings the report reference up to date with the engine that has driven runs since run-133, so a reader of a finished run's report finds the words that match the file in their hand. It exists because run-138 parked on this one task: its reviewer found one sentence in the rewrite that told a reader a red-baseline run carries no fold rows at all, when the engine writes exactly one, and the fix round did not repair it. After this run the reference says what each field is, including that one row, and nothing in it describes the wave loop any more.

**Goal:** #986 re-driven as one task on the current main after run-138 (2026-09-15) folded its sibling task 2 and parked this one `fix-loop-exhausted` on a single blocking finding, quoted in Context and pinned by M6. Run-138's draft PR #1002 carries task 2 alone and is merged by hand with `Closes #986` removed from its body, so this run's merge is what closes #986.
**Closes:** #986

**Tech Stack:** Markdown reference (`skills/ultrapowers/references/report-format.md`). Test command: `python3 -m pytest -n auto` from the repo root.

**Spec:** #986's body (desired state and proof shape); run-138's tag (`ultra/evidence/run-138`, `report.json` task 1 `notes` — the reviewer's finding); the engine at BASE, read at the lines named in Context.

**Parallelization rationale:** one wave, width 1: one file, one task.

## Global Constraints

- The engine, the kernel and the role files are untouched: `fleet/run-engine.mjs`, `skills/ultrapowers/kernel/` and `fleet/roles/` are byte-identical to BASE.
- Check: git diff --quiet $ULTRA_BASE -- fleet/roles skills/ultrapowers/kernel fleet/run-engine.mjs
- No document sentence is cited as evidence of code behaviour: what the document says is pinned by scoped greps.

### Task 1: The report reference describes the report the ready-set engine writes

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/references/report-format.md`

**Claim:** `report-format.md` describes the report the engine writes on `597c6db1`: `waveMerges` one row per epoch (`wave` = the epoch), `unfinished` for every task that never became ready with its reason, no `SKIPPED` cascade rows, no wave-position judgment call. (quoted from #986)
Machine: M1. In `skills/ultrapowers/references/report-format.md` the field-reference table row for `waveMerges` (the line beginning `| \`waveMerges\` |`) carries the words `one row per epoch` and, later on the same line, `the epoch`; and the row for `waves` carries the word `epoch`. M2. The row for `unfinished` carries the words `never became ready` and `reason`, and names each of the three strings the engine writes: one containing `never dispatched`, one containing `depends on a failed task`, one containing `predecessor never landed`. M3. No line of the file contains any of `SKIPPED`, `cascade-blocked`, `DEFERRED` or `args.edges`. M4. No line of the file contains `share a wave` or `dependent before prerequisite`, and the row for `judgmentCalls` names the two binding calls the engine writes, with the words `endpoint not in` and `cycle`. M5. The section from the heading `### \`waveMerges[].status\` values` to `## Presentation` has exactly three `- ` bullets, one each naming `MERGED`, `CONFLICT` and `TEST_FAILED`. M6. The `waveMerges` row says, in this order on its one line, that a red baseline on BASE is itself one `TEST_FAILED` row carrying `wave`, `status`, `detail` and `branches` and no `headSha`, and that the array is empty only for a run interrupted before any fold — it does not say the array may be absent, and it does not say a red baseline leaves it empty.

**Authorized-by:** #986 (desired state and proof shape); run-138's reviewer finding on task 1 (`ultra/evidence/run-138`, `report.json`), quoted in Context; the engine at BASE, `fleet/run-engine.mjs`, read at the lines named in Context.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The reference is 154 lines at BASE; blob `9a113ed45f70b56a580b6ba638bf034c06af1afa` — run-135 edited its `stateExams` rows, and this task leaves those byte-for-byte. What is stale, by line at BASE: the `waveMerges` row (105: "One entry per wave's integration merge", "when all waves were SKIPPED"), the `blockedWaves` row (107: "later waves were cascade-blocked"), the `missingDeliverables` row (109: "(or cascade-blocked)"), the `judgmentCalls` row (112: the binding kind lists "dependent before prerequisite, endpoints share a wave"), the `unfinished` row (113: budget-deferred and "cascade-blocked by wave N" strings), the whole `waveMerges[].status` section (116–125: `CONFLICT` and `TEST_FAILED` "cascade-blocked", the `SKIPPED` and `DEFERRED` bullets), and Presentation items 2, 5, 6 and 9 (132, 135, 136, 139: "cascaded conservatively", "args.edges omitted", "anything deferred"). Counts at BASE: `SKIPPED` 4 lines, `cascade-blocked` 7, `DEFERRED` 2, `share a wave` 1, `dependent before prerequisite` 1, `args.edges` 2. The lowercase `skipped` enum of `stateExams[].render`/`browser` (lines 28, 30) is a different thing and stays. What the engine writes, `fleet/run-engine.mjs` at BASE: `waveMerges` rows are pushed at two sites — the fold push (~3731, `{wave: epoch, status, headSha, detail, branches, joined, suite?}`) and the red-baseline park (~3513, `waveMerges.push({ wave: epoch, status: 'TEST_FAILED', detail, branches })` — `wave`, `status`, `detail`, `branches` and nothing else; no `headSha`, no `joined`); an epoch is a fold ordinal numbered 1, 2, … in fold order (~3377), everything captured since the last fold, so a row's `wave` is not an index into `waves`; `waves` stays the plan's compiled layering (~4227); the only `status` values written are `MERGED`, `CONFLICT` and `TEST_FAILED` — no `SKIPPED`, no `DEFERRED`, no budget string; `blockedWaves` is one `{wave, detail}` per red epoch and a red epoch marks exactly its own tasks blocked and makes their consumers unready — nothing cascades to "later waves"; `unfinished` carries exactly three string shapes: `<id>: never dispatched — the suite was already RED on BASE` (~3520), `<id>: blocked — depends on a failed task` (~4044) and `<id>: never became ready — a task an edge names as its predecessor never landed` (~4047); the binding judgment calls are `edge a -> b: endpoint not in this run — unbound for dependency blocking (check for a typo)` (~1687) and `edges …: a dependency cycle — no task in it can ever become ready … so none is dispatched` (~1704); a re-edge writes `task <id>: its proof needs <siblings>, still in flight — recorded as a dependency and re-dispatched once adopted` (~3660), which belongs under **autonomy**. **Run-138's reviewer finding, the one thing its implementer wrote wrong and the fix round did not repair — the sentence M6 pins:** the rewritten `waveMerges` row said the array "may be empty or absent when no epoch ever folded — the run was interrupted before the first fold, or a red baseline parked it before any task was dispatched", and "Each row carries `wave`, `status`, `headSha`, `detail`, `branches` … and `joined`". Both halves are false of the engine: the red-baseline park pushes a row (the `TEST_FAILED` row the `baseline` field describes, ~3513), so a red-baseline run never has an empty `waveMerges`; and that row carries only `wave`, `status`, `detail` and `branches` — `headSha`, `joined` and `suite` come from the fold push alone. Write the row so it says: one row per epoch, `wave` the epoch; a fold row carries `wave`, `status`, `headSha`, `detail`, `branches`, `joined` and, when the suite reported unattributed reds, `suite`; a red baseline on BASE is itself one `TEST_FAILED` row carrying `wave`, `status`, `detail` and `branches` and no `headSha`; the array is empty only for a run interrupted before any fold. Rewrite only the sentences the wave loop left; the `tasks[].review` row (line 89) is pinned by `tests/test_review_peer.py` — leave it byte-for-byte; the `stateExams` schema and prose (run-135's) stay as they are. Nothing else in the repository pins this file's sentences.

**Proof:**
- Run: grep '^| .waveMerges. |' skills/ultrapowers/references/report-format.md | grep 'one row per epoch.*the epoch' | grep -q .
- Run: grep '^| .waves. |' skills/ultrapowers/references/report-format.md | grep -q 'epoch'
- Run: grep '^| .unfinished. |' skills/ultrapowers/references/report-format.md | grep 'never became ready' | grep -q 'reason'
- Run: grep '^| .unfinished. |' skills/ultrapowers/references/report-format.md | grep -q 'never dispatched'
- Run: grep '^| .unfinished. |' skills/ultrapowers/references/report-format.md | grep -q 'depends on a failed task'
- Run: grep '^| .unfinished. |' skills/ultrapowers/references/report-format.md | grep -q 'predecessor never landed'
- Run: test "$(grep -c SKIPPED skills/ultrapowers/references/report-format.md)" = 0
- Run: test "$(grep -c cascade-blocked skills/ultrapowers/references/report-format.md)" = 0
- Run: test "$(grep -c DEFERRED skills/ultrapowers/references/report-format.md)" = 0
- Run: test "$(grep -c 'args\.edges' skills/ultrapowers/references/report-format.md)" = 0
- Run: test "$(grep -c 'share a wave' skills/ultrapowers/references/report-format.md)" = 0
- Run: test "$(grep -c 'dependent before prerequisite' skills/ultrapowers/references/report-format.md)" = 0
- Run: grep '^| .judgmentCalls. |' skills/ultrapowers/references/report-format.md | grep 'endpoint not in' | grep -q 'cycle'
- Run: test "$(sed -n '/^### .waveMerges\[\].status. values/,/^## Presentation/p' skills/ultrapowers/references/report-format.md | grep -c '^- ')" = 3
- Run: sed -n '/^### .waveMerges\[\].status. values/,/^## Presentation/p' skills/ultrapowers/references/report-format.md | grep -q '^- .MERGED'
- Run: sed -n '/^### .waveMerges\[\].status. values/,/^## Presentation/p' skills/ultrapowers/references/report-format.md | grep -q '^- .CONFLICT'
- Run: sed -n '/^### .waveMerges\[\].status. values/,/^## Presentation/p' skills/ultrapowers/references/report-format.md | grep -q '^- .TEST_FAILED'
- Run: grep '^| .waveMerges. |' skills/ultrapowers/references/report-format.md | grep -q 'red baseline.*TEST_FAILED.*wave.*status.*detail.*branches.*no .headSha.*empty only.*interrupted before any fold'
- Run: test "$(grep '^| .waveMerges. |' skills/ultrapowers/references/report-format.md | grep -c -e 'or absent' -e 'red baseline parked it')" = 0
- Legs: (a) the `waveMerges` table row carries `one row per epoch` and then `the epoch` on the same line — the first `Run:` [M1]; (b) the `waves` table row carries `epoch` — the second `Run:` [M1]; (c) the `unfinished` row carries `never became ready` and `reason` — the third `Run:` [M2]; (d) for each of the three engine strings, the `unfinished` row carries its distinguishing words: `never dispatched`, `depends on a failed task`, `predecessor never landed` — the fourth, fifth and sixth `Run:`, one per string, so a row that names two of the three fails its own line [M2]; (e) for each of `SKIPPED`, `cascade-blocked`, `DEFERRED` and `args.edges`, the file's line count containing it is 0 — the seventh to tenth `Run:`, one per word; at BASE those counts are 4, 7, 2 and 2, so any surviving mention fails its line [M3]; (f) the line counts for `share a wave` and `dependent before prerequisite` are 0 (1 and 1 at BASE) — the eleventh and twelfth `Run:` — and the `judgmentCalls` row carries `endpoint not in` and `cycle` — the thirteenth [M4]; (g) the status-values section has exactly three `- ` bullets (5 at BASE) — the fourteenth `Run:` — and for each of `MERGED`, `CONFLICT` and `TEST_FAILED` a bullet in that section begins with it — the fifteenth to seventeenth, one per value, so a section that dropped `CONFLICT` for a fourth value fails both the count and the missing value's line [M5]; (h) the eighteenth `Run:`: the `waveMerges` row carries, in order, `red baseline`, `TEST_FAILED`, `wave`, `status`, `detail`, `branches`, `no \`headSha\``, `empty only`, `interrupted before any fold`; and the nineteenth: that row contains neither `or absent` nor `red baseline parked it` — the two phrases run-138's reviewer blocked — so the sentence run-138 wrote fails both lines and the corrected one passes both [M6].

**Stale-if:**
- path-absent: `skills/ultrapowers/references/report-format.md`
- issue-closed: #986
