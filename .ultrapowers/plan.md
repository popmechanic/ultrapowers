# Authoring cost and the pick rate are on the record — every plan's gate record carries its minutes, probes, tally, routing branch and every question with its pick, one script reads a release's runs, and the Claim touch is redefined as drafted-then-confirmed

**Grammar:** claims-v1

**Claim:** After a sitting, every plan's record says what authoring it cost and which option I picked on every question I was asked, and a release reads those beside its runs' clocks — so the risk override's share and the Recommended-pick rate are numbers I can see, not impressions. (elicited)
**Summary:** This is the authoring side of the factory's cost, put on the same record as the run's. It exists because the three plans of 2026-09-14 ran in 16, 30 and 108 sandbox minutes but each took about two hours of session to author, every one was sent to the fleet by the risk override, and the recommended option was picked nine times of nine — none of which the record could show. After this run each plan's gate record carries its authoring minutes, hub probes, gate tally, routing branch and every question with its pick, one script reads a release's runs into one table, and ultrawrite says honestly that a Claim is drafted by the author and confirmed by you.

**Goal:** #988 and #991: the `<stem>.gate-verdicts.json` record gains one top-level `authoring` object — `minutes`, `probes`, `routing` (`branch`, `lane`), `questions` (each with `question`, `options`, `recommended`, `picked`) — written by the author at the execution handoff; `compile_plan.py` validates it when present and prints one `AUTHORING fact:` line under `--check --base`, which the launcher carries onto the launch line beside the BASE and STALE facts; `skills/ultrawrite/scripts/authoring_census.py` reads a run range off the target's tags into one table with the totals a release needs (risk-override share, Recommended-pick rate, authoring minutes beside run minutes) and prints #735's register one line per option; and ultrawrite's SKILL.md plus CLAUDE.md redefine the Claim touch as drafted by the author and confirmed by the operator, permit a Claim question with no recommended option, and say a recommendation taken on every plan of a release is retired as a rule (#727).
**Closes:** #988 #991

**Tech Stack:** Python 3 stdlib scripts under `skills/` (pytest is the suite, `python3 -m pytest`); Node 22 ESM under `fleet/` (sims `fleet/tests/test_*.mjs`, each printing `ALL TESTS PASSED`, bridged by `tests/test_fleet_suite.py`); Markdown.

**Spec:** #988 (the observation and the two desired states), #991 (the register per sitting and the two honest shapes of the Claim touch), #735 (the register's fixed one-line-per-option shape); every fact a worker needs is in its task's Context.

**Parallelization rationale:** one wave, width 4: four surfaces — the compiler's read of the record, the census script, the two documents, the launcher's passthrough — share one literal (the record shape and the fact line, in every Context) and no runtime behaviour, so no chain. The census script reads files, never the compiler; the launcher sim fakes the compiler's stdout; the documents describe the shape the other three implement.

## Global Constraints

- No engine, boot, worker, role, kernel or publish changes; the edits are confined to the compiler, the new census script, the launcher's compile passthrough, the two documents and the runbook.
- Check: git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/run-waves.mjs fleet/run-worker.mjs fleet/run-main.mjs fleet/sandbox-boot.sh fleet/publish-fold-block.mjs fleet/roles skills/ultrapowers/kernel
- A gate record without an `authoring` key is read exactly as at BASE: no new refusal, no changed hash, no changed verdict reading — every existing `*.gate-verdicts.json` fixture still compiles, and a bare `--check` prints nothing it did not print at BASE.
- The record shape is one literal in every task's Context, and every implementation agrees with it byte for byte: field names, the four routing branches, the three lanes, the fact line.
- Every sim keeps printing `ALL TESTS PASSED` on its last line and names no sibling sim.

### Task 1: The compiler validates the authoring record and prints one AUTHORING fact line

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_authoring_record.py`

**Claim:** When I compile a plan whose record carries its authoring cost, the compile tells me that cost in one line; a malformed record is refused, and a plan with no such record compiles exactly as before. (derived)
Machine: M1. Under `--check --base <sha>`, a claims-v1 plan whose `<stem>.gate-verdicts.json` carries a well-formed top-level `authoring` object prints, after the verdict line, exactly one line of the form `AUTHORING fact: <minutes> min to PLAN OK, <probes> hub probes, <dispatched> gate dispatches, <rejected> rejected, routing <branch>-><lane>, <n> questions, <p>/<q> recommended picked` — `<dispatched>` and `<rejected>` read from the record's `tally` (`-` when the key is absent), `<n>` the length of `questions`, `<q>` the count of questions whose `recommended` is not null and `<p>` the count of those whose `picked` equals `recommended` — and the compile still exits 0 with `PLAN OK`.
M2. The same `--check --base <sha>` compile of a record with no `authoring` key exits 0 with `PLAN OK` and prints exactly one line `AUTHORING fact: none recorded` after the verdict; and a bare `--check` of either record prints no line beginning `AUTHORING fact:` at all.
M3. A record whose `authoring` object is malformed is refused at `--check` — exit 2, no `PLAN OK` — with one violation line beginning `grammar: authoring record unreadable —` that names the offending field, for each of: `minutes` not a non-negative integer; `probes` not a non-negative integer; `routing.branch` outside `risk`, `width`, `inline`, `subagent`; `routing.lane` outside `ultrapowers`, `subagent`, `inline`; a question whose `options` has fewer than 2 entries; a question whose `picked` is not one of its `options`; a question whose `recommended` is neither null nor one of its `options`.

**Authorized-by:** #988 desired state 1 (the record beside the run's cost); `skills/ultrawrite/SKILL.md` §The proof gate (the record's shape, "any extra key … is tolerated").

**Interfaces:**
- Consumes: `gate_verdict_violations(plan_path, tasks)`
- Consumes: `verdicts_path(plan_path)`
- Produces: `authoring_record_violations(plan_path) -> list[str]`
- Produces: `authoring_fact_line(plan_path) -> str`

**Context:** The record shape, the one literal every task in this plan shares, sits at the top level of `<stem>.gate-verdicts.json` beside `tasks` and `tally`: `{"authoring": {"minutes": 118, "probes": 12, "routing": {"branch": "risk", "lane": "ultrapowers"}, "questions": [{"question": "Claim and summary", "options": ["A", "B"], "recommended": "A", "picked": "A"}]}}` — `minutes` is the sitting's wall-clock minutes to `PLAN OK`, `probes` the hub probes made, `routing.branch` the branch of the handoff rule that fired (`risk`, `width`, `inline`, `subagent`) and `routing.lane` what the operator picked (`ultrapowers`, `subagent`, `inline`), `questions` one row per AskUserQuestion of the sitting with `recommended` null when the question carried no recommended option. The fact line for that example, with a `tally` of `{"dispatched": 4, "rejected": 1}`, is exactly `AUTHORING fact: 118 min to PLAN OK, 12 hub probes, 4 gate dispatches, 1 rejected, routing risk->ultrapowers, 1 questions, 1/1 recommended picked`. The compiler at BASE reads the record only in `gate_verdict_violations` (line 1027; it returns early when the file is missing, with the `gate verdicts missing` refusal), and `collect_violations` (line 1641) gathers every `grammar:` string; the new validation is a separate function called from there, so a missing file stays the one refusal it already is and a record with no `authoring` key adds nothing. The fact line prints only with a base tree, in `main` under `if base_tree is not None:` (lines 2775–2789) after the `base_fact_lines` and the `evaluate_stale_if` advisories — never on a bare `--check`, because `tests/test_compile_plan_edges.py` lines 311 and 319 pin `p.stdout.strip() == "PLAN OK"` on a bare `--check` and stay green. `AUTHORING` occurs nowhere in the repository at BASE (`git grep -c AUTHORING` is empty), and `evals/fixtures/claims/plan.md` prints `PLAN OK` on a bare `--check` at BASE and refuses under `--check --base` on its own `issue-closed: #489` Stale-if, which is why the `Run:` below checks it bare. The exam builds its plans the way `tests/test_compile_plan_edges.py` does — a claims-v1 plan written to `tmp_path`, its verdicts hashed with `extract_gate_input.gate_input`, the compiler driven as a subprocess — and for the `--base` legs a one-commit temp git repository as that file's `base_repo` builds, since a `--base` sha must be a commit of the plan's own repository.

**Proof:**
- Test: `tests/test_authoring_record.py`
- Guard: `tests/test_authoring_record.py`
- Legs: (a) [M1] a claims-v1 plan in a one-commit temp repository, its record carrying the Context's example `authoring` object and a `tally` of dispatched 4 / rejected 1, compiled `--check --base <head>`, exits 0, has `PLAN OK` as its first stdout line and exactly one `AUTHORING fact:` line, equal to the Context's example line verbatim; (b) [M1] the same record with `tally` lacking `rejected` prints `- rejected`, and with two questions — one `recommended` null, one picked equal to recommended — prints `2 questions, 1/1 recommended picked`; (c) [M2] the same plan with no `authoring` key exits 0 with `PLAN OK` and exactly one `AUTHORING fact: none recorded` line; (d) [M2] a bare `--check` of the record with the key and of the record without it each print zero lines containing `AUTHORING fact:`; (e) [M3] for each of the seven malformed rows — `minutes` `-1` and `"12"`, `probes` `-1`, `branch` `"speed"`, `lane` `"fleet"`, `options` `["only"]`, `picked` `"C"` outside `["A","B"]`, `recommended` `"C"` outside `["A","B"]` — a bare `--check` exits 2, prints no `PLAN OK`, and prints one line beginning `grammar: authoring record unreadable —` that contains the field's name; the leg is parametrized over the rows and names the row that fails.
- Run: python3 -m pytest -q tests/test_authoring_record.py
- Run: python3 skills/ultrapowers/scripts/compile_plan.py --check evals/fixtures/claims/plan.md | grep -q '^PLAN OK$'
- Run: test "$(python3 skills/ultrapowers/scripts/compile_plan.py --check evals/fixtures/claims/plan.md | grep -c 'AUTHORING fact:')" = 0
- Run: python3 -m pytest -q tests/test_compile_plan_edges.py

**Stale-if:**
- issue-closed: #988
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`

### Task 2: The authoring census reads a release's runs into one table and prints the register

**Type:** implementation
**Review:** peer

**Files:**
- Create: `skills/ultrawrite/scripts/authoring_census.py`
- Test: `tests/test_authoring_census.py`

**Claim:** At a release I run one command over the runs it bundles and see, per plan, what authoring cost beside what the run cost, and at the bottom how many plans the risk override sent to the fleet and how often the recommended option was picked. (derived)
Machine: M1. `python3 skills/ultrawrite/scripts/authoring_census.py --from <dir>`, over a directory holding `run-<N>/gate-verdicts.json` files and optionally `run-<N>/status.json` beside each, prints a first line exactly `run	authoring_min	probes	dispatched	rejected	routing	lane	questions	recommended_picked	run_min` (tab-separated), then one tab-separated row per `run-<N>` directory that holds a `gate-verdicts.json`, in ascending numeric N, with `authoring_min`, `probes`, `routing` (the branch), `lane` and `questions` read from the record's `authoring` object, `dispatched` and `rejected` from its `tally`, `recommended_picked` as `<p>/<q>` (q the questions whose `recommended` is not null, p those whose `picked` equals it), `run_min` as the whole minutes, rounded down, from `status.json`'s `startedAt` to its `updatedAt`, and `-` in every column the run's files do not carry; then a last line `totals: plans=<rows> risk_override=<k>/<m> recommended_picked=<p>/<q> authoring_min=<sum> run_min=<sum>` where m is the rows with a routing record and k those whose branch is `risk`, the two p/q sums are over every row, and each sum is over the rows carrying that value.
M2. With `--register` beside `--from <dir>`, it prints instead one tab-separated line per option of every question of every row, in row order then question order then option order: `run-<N>	q<i>	<question text>	<option text>	<rec|->	<picked|->` — `rec` on the option equal to the question's `recommended` and `-` on the others, `picked` on the option equal to `picked` and `-` on the others, `<i>` counting from 1.
M3. `--fetch <owner>/<repo> --runs <A>..<B> --into <dir>` writes, for each N from A to B inclusive, `<dir>/run-<N>/gate-verdicts.json` from the answer of `gh api repos/<owner>/<repo>/contents/.ultrapowers/gate-verdicts.json?ref=ultra/plan/run-<N>` (its `content` base64-decoded) and `<dir>/run-<N>/status.json` from `gh api repos/<owner>/<repo>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>` the same way, skips a run whose plan tag has no record with one line on stderr naming N and writes nothing for it, invokes the binary `--gh <cmd>` names (default `gh`) and no other, and then prints the M1 table over `<dir>`.

**Authorized-by:** #988 desired state 1 ("read per release beside launch→approved") and desired state 2 (the risk override's share per release); #991 desired state 1 (the Recommended-pick rate as a number per release); #735 (the fixed one-line-per-option register).

**Interfaces:**
- Consumes: nothing
- Produces: `census_rows(root: Path) -> list[dict]`
- Produces: `render_table(rows: list[dict]) -> str`
- Produces: `render_register(rows: list[dict]) -> str`
- Produces: `fetch_runs(target: str, first: int, last: int, into: Path, gh: str) -> list[int]`

**Context:** The record shape, the one literal every task in this plan shares, sits at the top level of `<stem>.gate-verdicts.json` beside `tasks` and `tally`: `{"authoring": {"minutes": 118, "probes": 12, "routing": {"branch": "risk", "lane": "ultrapowers"}, "questions": [{"question": "Claim and summary", "options": ["A", "B"], "recommended": "A", "picked": "A"}]}}` — `routing.branch` is one of `risk`, `width`, `inline`, `subagent`; `routing.lane` one of `ultrapowers`, `subagent`, `inline`; `recommended` is null when the question carried no recommended option. A record older than this plan has no `authoring` key and its row is all `-` except `dispatched`/`rejected`; a record's `tally` may lack either key. `status.json` is the contract's shape (`fleet/CONTRACT.md` line 604): `startedAt` and `updatedAt` are ISO-8601 with a `Z` suffix, as in `tests/fixtures/ultralearn/census/run-101/status.json` (`2026-08-30T22:40:00Z` to `2026-08-30T23:00:00Z`, which is 20 minutes); parse them with `datetime.fromisoformat` after replacing the `Z` with `+00:00`. The plan tag `ultra/plan/run-<N>` carries the record as `.ultrapowers/gate-verdicts.json` (the launcher's `VERDICTS_PATH`, `fleet/launch.mjs` line 163) and the evidence tag `ultra/evidence/run-<N>` carries `.ultrapowers/runs/<N>/status.json` (`skills/ultrapowers/SKILL.md` §Client step 3); `gh api …/contents/…` answers JSON whose `content` is base64 with embedded newlines, so decode with `base64.b64decode` over the whole string. A `gh api` that exits non-zero for the plan record is the skip; a non-zero exit for `status.json` alone leaves that file unwritten and the row's `run_min` as `-`. The `--gh` seam is the same shape `skills/ultrawrite/scripts/check_provenance.py` gives its `--gh`: the exam passes a fake executable and the real binary is never resolved by bare name when `--gh` names one. The script imports nothing from the compiler and reaches the network only through that binary, only under `--fetch`. It is stdlib-only, like its siblings in `skills/ultrawrite/scripts/`, and its module docstring carries the three invocations. The exam drives it as a subprocess over directories it builds under `tmp_path`, with a fake `gh` script it writes there that answers from a table keyed on the `ref=` and path of its argv.

**Proof:**
- Test: `tests/test_authoring_census.py`
- Guard: `tests/test_authoring_census.py`
- Legs: (a) [M1] three run directories — `run-131` with the Context's example record, a `tally` of dispatched 4 / rejected 1 and a `status.json` spanning 16 minutes; `run-133` with a record whose `tally` lacks `rejected`, whose routing is `width`/`ultrapowers`, whose two questions are one `recommended` null and one picked equal to recommended, and no `status.json`; `run-9` with a record carrying no `authoring` key — print the exact header line, then rows for 9, 131, 133 in that order with `run-9`'s row `-` in every authoring column, `run-131`'s row `131	118	12	4	1	risk	ultrapowers	1	1/1	16` and `run-133`'s `rejected` and `run_min` both `-` and `recommended_picked` `1/1`, and the last line exactly `totals: plans=3 risk_override=1/2 recommended_picked=2/2 authoring_min=<118 plus run-133's minutes> run_min=16`; (b) [M1] a `run-<N>` directory with no `gate-verdicts.json` yields no row and is not counted in `plans`; (c) [M2] `--register` over the same directory prints one line per option — for `run-131` two lines `run-131	q1	Claim and summary	A	rec	picked` and `run-131	q1	Claim and summary	B	-	-`, for the null-recommended question of `run-133` lines with `-` in the `rec` column on every option and `picked` on exactly one — and no table header; (d) [M3] with a fake `gh` that answers the plan record for runs 131 and 133, a `status.json` for 131 only, and exit 1 for run 132's plan tag, `--fetch o/r --runs 131..133 --into <dir> --gh <fake>` leaves `<dir>/run-131/gate-verdicts.json`, `<dir>/run-131/status.json` and `<dir>/run-133/gate-verdicts.json` with the decoded bytes, no `run-132` directory and no `run-133/status.json`, prints one stderr line containing `132`, and prints the M1 table with rows for 131 and 133 only; the fake records every argv and the leg asserts each call's first two arguments are `api` and a `repos/o/r/contents/` path carrying the expected `ref=` tag, and that no argv names any other repository.
- Run: python3 -m pytest -q tests/test_authoring_census.py
- Run: python3 skills/ultrawrite/scripts/authoring_census.py --help | grep -q -- '--register'

**Stale-if:**
- issue-closed: #988
- path-absent: `skills/ultrawrite/scripts/check_provenance.py`

### Task 3: ultrawrite and CLAUDE.md say the Claim is drafted then confirmed, and the record carries every question with its pick

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `CLAUDE.md`

**Claim:** When I read how a plan's Claim comes to be, the skill and the project's own instructions say what actually happens — the author drafts it and I confirm it in one touch — and they tell the author to write down every question I was asked and what I picked, so a recommendation I take every time is retired as a rule. (derived)
Machine: M1. The section of `skills/ultrawrite/SKILL.md` from the heading beginning `## Elicit the claim` to the heading `## Authoring a queue` is headed `## Elicit the claim — drafted, then confirmed` and says, in this order, that the Claim is `drafted by the author` and `confirmed by the operator` in `one touch`, that the `(elicited)` tag records exactly that, and that a Claim question may be put `without a (Recommended)` option, in which case the register records its `recommended` as `null` and the pick carries information; and the word `countersigning` appears nowhere in `skills/ultrawrite/SKILL.md` and nowhere in `CLAUDE.md`.
M2. That same section says a question whose recommended option was `picked on every plan` of a release is `retired` and its default written down, citing `#727`.
M3. The section from `## The proof gate` to `## The worktree-pure contract` names the record's top-level `authoring` object with its fields `minutes`, `probes`, `routing`, `questions` in that order, says the author writes it at the execution `handoff`, before the launch, and names `authoring_census.py` with `--fetch` as how a release reads it, its `totals:` line going into the release notes.
M4. The section from `## Execution handoff` to `## Self-review` says the branch that fired and the lane picked are recorded as `routing` with `branch` and `lane`.
M5. `CLAUDE.md`'s `## Working with the operator` section says a signed Claim is `drafted by the author` and `confirmed by the operator` in one touch, and its `Every choice is an AskUserQuestion` bullet under `## Doctrine` says every sitting-level question is recorded with its pick in the plan's `authoring` record so the Recommended-`pick rate` is read `per release`.

**Authorized-by:** #991 desired states 1–3 (the register per sitting, the honest Claim touch, the retired question); #988 desired state 1 (the routing branch on the record); #735 (the register); `CLAUDE.md` §Working with the operator.

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The record shape, the one literal every task in this plan shares, sits at the top level of `<stem>.gate-verdicts.json` beside `tasks` and `tally`: `{"authoring": {"minutes": 118, "probes": 12, "routing": {"branch": "risk", "lane": "ultrapowers"}, "questions": [{"question": "Claim and summary", "options": ["A", "B"], "recommended": "A", "picked": "A"}]}}` — `minutes` the sitting's wall-clock minutes to `PLAN OK`, `probes` the hub probes made, `routing.branch` one of `risk`, `width`, `inline`, `subagent` (the four branches of the handoff rule, first match wins), `routing.lane` one of `ultrapowers`, `subagent`, `inline`, `questions` one row per AskUserQuestion of the sitting, the execute question included, `recommended` null when no option carried the tag. The author writes the whole object once, at the execution handoff after `PLAN OK` and before the launch; the compiler prints it as one `AUTHORING fact:` line under `--check --base` and the launcher carries that line onto the launch line, and a release reads a run range with `python3 skills/ultrawrite/scripts/authoring_census.py --fetch <owner>/<repo> --runs <A>..<B> --into <dir>`, whose last `totals:` line is what the release notes carry. The chosen shape of the Claim touch is #991's first honest shape — the Claim is drafted by the author and confirmed by the operator, and the skill says so — with the second shape permitted as an option: a Claim question may be asked with no `(Recommended)` tag, and then `recommended` is null in its register row. The `(elicited)` tag itself is kept — `compile_plan.py`'s `PLAN_CLAIM_PROVENANCE_RE` and `check_provenance.py` read it and neither changes — so the redefinition is of what the tag means, in prose. At BASE the section's heading is `## Elicit the claim — never draft it for countersigning` (`skills/ultrawrite/SKILL.md` line 187, the one carrier of `countersign` in that file) and its first paragraph says "confirmation, not authorship"; its `## Authoring a queue` paragraph's "Hold the operator to one Claim confirmation and one execute choice per plan" stays true and stays. The proof-gate section (lines 228–322) describes the record's shape at lines 249–255 and already says an extra key is tolerated — the `authoring` description goes beside that sentence. The handoff section (lines 417–441) carries the rule's four branches at lines 428–430; the `routing` sentence goes after the three options. In `CLAUDE.md` the Working-with-the-operator bullet is line 174–177 (`A signed Claim is their own sentence, elicited, never drafted for countersigning.` is the sentence to replace; it is the file's one carrier of `countersigning`) and the Doctrine bullet is lines 162–164 (`**Every choice is an AskUserQuestion**`); the Layout bullet for `skills/ultrawrite/` (line 50) may name the census script beside "the provenance/base-fact scripts", and nothing else in `CLAUDE.md` changes. No sim or test pins any of these sentences at BASE: `git grep -c countersign` at BASE hits only these two files, once each. Two pins do live in the sections this task adds to, and both stay: `tests/test_compile_plan_edges.py` (lines 786–791) reads the proof-gate section for its sentence that a Stale-if predicate holding at the base is a `STALE fact:` refusal and an unreadable issue predicate an advisory line, and `fleet/tests/test_launch_compile_facts.mjs` reads `CLAUDE.md`'s `## Layout` section for `compile_plan.py --check --base` followed by `STALE fact:` — add beside them, delete nothing there. This is prose; the `Run:` lines are its proof, and each sed range below is scoped by the two headings the clause names, joined with spaces.

**Proof:**
- Legs: (a) [M1] the `Run:` over the elicit section's sed range matches `drafted by the author`, `confirmed by the operator`, `one touch`, `(elicited)`, `without a (Recommended)` and `recommended.*null` in that order, and the `Run:` that greps the whole file for the heading matches the whole line `## Elicit the claim — drafted, then confirmed`, anchored at both ends; (b) [M1] the two `Run:` lines that count `countersigning` find zero in each of the two files; (c) [M2] the `Run:` matching `picked on every plan.*retired.*#727` reads the elicit section; (d) [M3] the `Run:` matching `authoring.*minutes.*probes.*routing.*questions.*handoff.*authoring_census.py.*--fetch.*totals:` reads the proof-gate section; (e) [M4] the `Run:` matching `routing.*branch.*lane` reads the handoff section; (f) [M5] the `Run:` over `CLAUDE.md`'s Working-with-the-operator section matches `drafted by the author.*confirmed by the operator.*one touch`, and the `Run:` over its Every-choice bullet matches `every.*question.*recorded.*pick.*authoring.*record.*pick rate.*per release` — the question-and-pick half before the rate half, in that order.
- Run: sed -n '/^## Elicit the claim/,/^## Authoring a queue/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'drafted, then confirmed.*drafted by the author.*confirmed by the operator.*one touch.*(elicited).*without a (Recommended).*recommended.*null'
- Run: grep -q '^## Elicit the claim — drafted, then confirmed$' skills/ultrawrite/SKILL.md
- Run: test "$(grep -c countersigning skills/ultrawrite/SKILL.md)" = 0
- Run: test "$(grep -c countersigning CLAUDE.md)" = 0
- Run: sed -n '/^## Elicit the claim/,/^## Authoring a queue/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'picked on every plan.*retired.*#727'
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'authoring.*minutes.*probes.*routing.*questions.*handoff.*authoring_census.py.*--fetch.*totals:'
- Run: sed -n '/^## Execution handoff/,/^## Self-review/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'routing.*branch.*lane'
- Run: sed -n '/^## Working with the operator/,/^## Conventions/p' CLAUDE.md | tr '\n' ' ' | grep -q 'drafted by the author.*confirmed by the operator.*one touch'
- Run: sed -n '/^- \*\*Every choice is an AskUserQuestion\*\*/,/^- \*\*Test doctrine/p' CLAUDE.md | tr '\n' ' ' | grep -q 'every.*question.*recorded.*pick.*authoring.*record.*pick rate.*per release'
- Run: wc -w skills/ultrawrite/SKILL.md

**Stale-if:**
- issue-closed: #991
- path-absent: `skills/ultrawrite/SKILL.md`

### Task 4: The launcher carries the AUTHORING fact line onto the launch line

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_launch_compile_facts.mjs`

**Claim:** When I launch a plan, the launch line tells me what authoring it cost, among the fact lines that end it, without my opening the record. (derived)
Machine: M1. `verifyPlanCompiles` resolves, on a clean compile, to every stdout line beginning `BASE fact:`, `STALE fact:` or `AUTHORING fact:`, in stdout order and with no other line, so `renderLaunch` prints an `AUTHORING fact:` line among the fact lines that end the launch text.
M2. `fleet/RUNBOOK.md`'s `## Per run` section names `BASE fact:`, then `STALE fact:`, then `AUTHORING fact:`, then the launch line, in that order.

**Authorized-by:** #988 desired state 1 (the cost read beside the run's); `fleet/RUNBOOK.md` §Per run; `fleet/tests/test_launch_compile_facts.mjs` (the surface's exam).

**Interfaces:**
- Consumes: nothing
- Produces: `verifyPlanCompiles({ exec, repoDir, base, planPath, planText }) -> string[]`

**Context:** The compiler's line, the one literal every task in this plan shares, is `AUTHORING fact: <minutes> min to PLAN OK, <probes> hub probes, <dispatched> gate dispatches, <rejected> rejected, routing <branch>-><lane>, <n> questions, <p>/<q> recommended picked` — for a record of 118 minutes, 12 probes, dispatched 4, rejected 1, routing `risk`/`ultrapowers` and one question picked as recommended it is exactly `AUTHORING fact: 118 min to PLAN OK, 12 hub probes, 4 gate dispatches, 1 rejected, routing risk->ultrapowers, 1 questions, 1/1 recommended picked`, and `AUTHORING fact: none recorded` when the record carries no `authoring` key; the compiler prints it after its BASE and STALE facts under `--check --base`. At BASE `verifyPlanCompiles` (`fleet/launch.mjs` lines 614–634) filters stdout with `line.startsWith('BASE fact:') || line.startsWith('STALE fact:')` — the one edit is a third prefix in that filter — and `renderLaunch` (line 1639) already spreads `result.baseFacts` last, so nothing there changes. `fleet/RUNBOOK.md` line 219 is the sentence: "the `BASE fact:` lines and the `STALE fact:` lines of a clean compile are printed on the launch line after the engine line, in the order the compiler printed them" — add the `AUTHORING fact:` line to it between `STALE fact:` and "of a clean compile"; the sim's leg (d) regex `BASE fact:.*STALE fact:.*launch line` stays true. `fleet/tests/test_launch_compile_facts.mjs` is the surface's exam: its legs (a) fake `exec` and read `verifyPlanCompiles`, and a stdout carrying no `AUTHORING fact:` line still resolves to exactly the BASE and STALE lines, so every existing leg stays green; the new legs are appended under a comment naming this task, using the file's own `fakeExec` and `compile` helpers. `AUTHORING` occurs nowhere in `fleet/` at BASE. Hermetic: no process spawned, no socket.

**Proof:**
- Test: `fleet/tests/test_launch_compile_facts.mjs`
- Guard: `fleet/tests/test_launch_compile_facts.mjs`
- Legs, appended to the sim under a comment naming this task: (a) [M1] a fake `exec` answering exit 0 with `PLAN OK`, one `BASE fact:` line, one `STALE fact: … unreadable at BASE — …` line, the Context's example `AUTHORING fact:` line and one `note:` line makes `verifyPlanCompiles` resolve to exactly the three fact lines in that order; (b) [M1] the same lines answered `AUTHORING fact:` first resolve with it first, and `AUTHORING fact: none recorded` is carried like any other; (c) [M1] `renderLaunch` of a result whose `baseFacts` is `['BASE fact: x', 'AUTHORING fact: none recorded']` yields text whose last line is the `AUTHORING fact:` entry; (d) [M2] the `## Per run` section of `fleet/RUNBOOK.md`, read as the text between that heading and the next `## `, matches `BASE fact:.*STALE fact:.*AUTHORING fact:.*launch line`.
- Run: node fleet/tests/test_launch_compile_facts.mjs | grep -q 'ALL TESTS PASSED'
- Run: sed -n '/^## Per run/,/^## States/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q 'BASE fact:.*STALE fact:.*AUTHORING fact:.*launch line'

**Stale-if:**
- issue-closed: #988
- path-absent: `fleet/tests/test_launch_compile_facts.mjs`
