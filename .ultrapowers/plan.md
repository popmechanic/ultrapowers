# Capacity row reports, never limits

**Grammar:** claims-v1

**Claim:** The `capacity` row reports and never limits: it prints the pool and the size one run asks for (`XLarge pool 16 vCPU / 64GB; a run asks 4 vCPU / 8GB`), stays `ok` whenever `billing plan --json` is readable and `fleet.json` parses, and goes `missing` only for an unreadable pool or an unparseable config (both already there). (elicited)

**Goal:** The doctor's `capacity` row stops computing a ceiling exe.dev does not enforce.
Today `poolRow` in `fleet/doctor.mjs` divides `billing plan --json`'s `max_cpus` by
`~/.ultrapowers/fleet.json`'s `cpu`, prints `<tier> pool 16 vCPU / 64GB fits 2 runs of
8 vCPU / 16GB`, and turns the row `missing` — "cannot hold a run of …" — when one run asks
for more than the pool. Measured on the live account, allocation is over-committable (56 vCPU
allocated on a 16-vCPU plan, never refused; on 2026-09-05 four engine runs and two walk runs
ran concurrently, 24 vCPU asked, all clean), so the count was a fiction and the refusal a
ceiling nobody has approached. After this run the green detail is `<tier> pool <cpu> vCPU /
<mem>GB; a run asks <cpu> vCPU / <mem>GB`, a pool smaller than the run is still `ok`, and the
row is `missing` only when the pool cannot be read or the config cannot be parsed — both
branches already in the file. `first-run.md` §capacity says the same in prose: allocation is
over-committable, contention is the bound, and #667 is measuring it. The stale-key check
(#668, `capacityRow` wrapping `poolRow`) is untouched; its two exams are re-pinned to the new
green sentence and nothing else in them moves. `launch.mjs` has no pool refusal, so the row
was the only place the ceiling existed. The RUNBOOK, the CONTRACT and the operator SKILL.md
still describe the count in one sentence each; they belong to other bundles in this wave and
are byte-identical here.
**Closes:** #681

**Tech Stack:** Node 24 ESM (`fleet/doctor.mjs`, built-ins only; its two sims
`fleet/tests/test_doctor.mjs` and `fleet/tests/test_doctor_config_keys.mjs`, each run as
`node fleet/tests/<file>` with the sentinel `ALL TESTS PASSED`, no network — `ssh`, `gh`,
`curl`, `git`, `systemd-run` and `systemctl` are PATH-shimmed inside the sims), Markdown
(`skills/ultrapowers/references/first-run.md`, whose `## ` headings
`tests/test_docs_agree_with_code.py` pins to the doctor's `ROW_IDS`). Nothing is added to any
dependency file.

**Spec:** #681 (the desired-state paragraph is the design; there is no separate spec
document). Measured facts the issue cites: 56 vCPU allocated on the 16-vCPU plan without a
refusal; six concurrent runs asking 24 vCPU on 2026-09-05.

**Parallelization rationale:** One wave, width 2. Task 1 modifies only `fleet/doctor.mjs`
and its exams are the two doctor sims; Task 2 modifies only `first-run.md` and proves itself
with `Run:` commands. No Files overlap, no task consumes a sibling's symbol, so no edge is
derived and neither task waits. Both halves of the doc↔code pin (`ROW_IDS` ↔ the `## `
headings) are untouched by both tasks, so the folded tree stays green with either task
alone.

## Global Constraints

- The stale-key check of #668 is untouched: a key in `~/.ultrapowers/fleet.json` that is
  neither `cpu` nor `memory` still turns the row `missing`, the detail still names it and
  still says `keys nothing reads`, and a lacking read key is still named as taking its
  default.
- The `## capacity` heading of `first-run.md` and the five headings around it are
  byte-identical to BASE — `tests/test_docs_agree_with_code.py` reads them against
  `ROW_IDS` and is another bundle's file.
- The fleet outside the doctor, the docs test, the operator skill and the two fleet
  documents are byte-identical to BASE — they are other bundles' files in this wave.
- Check: test "$(git hash-object fleet/launch.mjs)" = a2bcd0491f5af05f77606c747c8f4f6bc3659138
- Check: test "$(git hash-object fleet/lobby.mjs)" = 2f6289f1de89b48f5090b6a40d11a3d10c34b8b4
- Check: test "$(git hash-object tests/test_docs_agree_with_code.py)" = c9687c77eca8374f6caf78b5deb587f24244fe9a
- Check: test "$(git hash-object skills/ultrapowers/SKILL.md)" = f286d45f24924654c4f71795903d8277ba9e9035
- Check: test "$(git hash-object fleet/RUNBOOK.md)" = 7a45c72253c10632d1c914230df166b7d0934d70
- Check: test "$(git hash-object fleet/CONTRACT.md)" = a91fa2bb3bde04fa34396f6580a11f56e6e4bd8d
- No file outside a task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The capacity row prints the pool and the ask, and never a count

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/doctor.mjs`
- Test: `fleet/tests/test_doctor.mjs`
- Test: `fleet/tests/test_doctor_config_keys.mjs`

**Claim:** After this run the doctor's capacity row tells me the pool and what one run asks
for, is green whenever it could read both, and never says how many runs fit or that the pool
cannot hold one. (derived)
Machine: M1. `doctor({ exec, config: { cpu: '8', memory: '16GB' } })` over an `exec` whose
`ssh exe.dev "billing plan --json"` answers code 0 with
`{"max_cpus":16,"max_memory_gb":64,"tier":"XLarge","plan":"team"}` gives a `capacity` row
whose `status` is `ok` and whose `detail` is exactly
`XLarge pool 16 vCPU / 64GB; a run asks 8 vCPU / 16GB`. M2. A readable pool smaller than
the run leaves the row `ok`: with `max_cpus` 7 the detail is exactly
`XLarge pool 7 vCPU / 64GB; a run asks 8 vCPU / 16GB`; with `max_memory_gb` 15 it is exactly
`XLarge pool 16 vCPU / 15GB; a run asks 8 vCPU / 16GB`; with `max_cpus` 4 the row is `ok`,
every other row is `ok`, and the result's `verdict` is `ready`. M3. No capacity detail
carries a count or a refusal: for each of the four rows of M1 and M2 the detail contains
neither the substring `fits` nor the substring `cannot hold`, and `fleet/doctor.mjs` contains
neither the substring `fits` nor the substring `cannot hold`. M4. The row is `missing` for
an unreadable pool and for an unparseable config, and each such detail names
`fleet.json`: for each of `billing plan --json` exiting 1, `billing plan --json` answering
code 0 with text that is not JSON, a config whose `cpu` is `x`, and a config whose `memory`
is `1.5GB`, the row's `status` is `missing` and its `detail` contains `fleet.json`. M5. The
stale-key check is untouched: `doctor({ …, configKeys: ['golden', 'stateRepo'] })` over the
M1 pool and config gives a `capacity` row that is `missing`, whose detail contains `golden`,
contains `stateRepo`, contains `keys nothing reads` and contains
`XLarge pool 16 vCPU / 64GB; a run asks 8 vCPU / 16GB`; `configKeys: ['memory']` gives a row
that is `ok` whose detail contains `cpu not in`, contains `the default 8` and contains
`XLarge pool 16 vCPU / 64GB; a run asks 8 vCPU / 16GB`; and the CLI run with `--json
--config <a file holding {"golden":"x","stateRepo":"y"}>` under the green PATH shim exits 1
with a `capacity` row that is `missing`. M6. `node fleet/tests/test_doctor.mjs` and
`node fleet/tests/test_doctor_config_keys.mjs` each exit 0 and print `ALL TESTS PASSED`.

**Authorized-by:** #681 ("The `capacity` row reports and never limits … No `fits N`, no
"cannot hold" … The stale-key check (#668) is untouched."); the operator's sentence in its
first line ("The doctor shouldn't try to limit to 'fits 4'. We've never gotten even close to
hitting a resource ceiling on EXE.").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `poolRow(res, config)` (line ~202 of `fleet/doctor.mjs`) is the whole change.
Its two `missing` branches stay as they are — an unparseable `cpu`/`memory` (the
`parseCpus`/`parseMemoryGb` null) and a `billing plan --json` that exits non-zero or carries
no numeric `max_cpus`/`max_memory_gb` — and both already name `~/.ultrapowers/fleet.json` in
their detail. What goes is everything after `asked` is built: the `poolCpu < askedCpu ||
poolGb < askedGb` refusal and the `Math.floor(poolCpu / askedCpu)` count. The green detail
becomes the template `${pool}; a run asks ${asked}` where `pool` is the existing
`${tier} pool ${poolCpu} vCPU / ${poolGb}GB` and `asked` the existing
`${askedCpu} vCPU / ${askedGb}GB` — so the M1 string is
`XLarge pool 16 vCPU / 64GB; a run asks 8 vCPU / 16GB` with the doctor's defaults (`cpu`
`8`, `memory` `16GB`, `DOCTOR_DEFAULTS`), while the operator's live file asks 4 / 8GB and
the issue's example reads `a run asks 4 vCPU / 8GB` for that reason. The tier fallback
(`tier`, else `plan`, else `untiered`) is unchanged. `capacityRow(res, config, configKeys)`
(line ~250) wraps `poolRow` and is the #668 stale-key check: it is not edited, and it keeps
working because it only reads `base.status` and `base.detail`. The file's header comment
(line ~13, `capacity … says how many such runs fit`) and the `poolRow` doc comment (line
~195, `how many such runs fit at once … the red detail names fleet.json, the place that
lowers it`) describe the count and are rewritten to describe the report — the pool, the
ask, and that the row limits nothing because allocation on exe.dev is over-committable
(measured: 56 vCPU allocated on a 16-vCPU plan, never refused) — using neither the word
`fits` nor the phrase `cannot hold` anywhere in the file, since M3's source grep is a
substring test over the whole file. The doctor imports nothing but `node:` modules
(`test_doctor.mjs` group 1 pins it) and its five reads and their order are pinned too; this
change adds no read. The exams: `fleet/tests/test_doctor.mjs` group 2 (`M2 — capacity`,
lines ~233–285) holds the four legs this task replaces — the `fits 2` / `1 run fits` green
legs and the two `cannot hold` red legs — and its group 5 verdict scenario reddens
`capacity` with `billing({ max_cpus: 4 })`, which under M2 is now green: that scenario row
becomes an unreadable billing (`{ code: 1, stdout: '' }`) so one red row is still one red
row. Its `billing(over)` helper, `run(overrides, opts)` (which takes `opts.config`),
`rowById`, `statusOf` and the `CMD.billing` key are the rig to reuse, and the file's own
comment header maps each group to a leg — group 2's comment is updated to this task's legs.
`fleet/tests/test_doctor_config_keys.mjs` pins the green sentence once as `BASE_DETAIL`
(line ~126, `'XLarge pool 16 vCPU / 64GB fits 2 runs of 8 vCPU / 16GB'`); that literal
becomes `'XLarge pool 16 vCPU / 64GB; a run asks 8 vCPU / 16GB'` and every leg that reads
it is M5's, unchanged in shape — its CLI group already drives the stale file under the green
shim. Both sims are flat files of top-level `assert` calls that print `ALL TESTS PASSED`
last; the pytest bridge (`tests/test_fleet_suite.py`) runs every `fleet/tests/test_*.mjs`
looking for that sentinel with a 120 s budget, so no new file is needed and none is made.
`git grep` at BASE finds the old wording in exactly the four places named here (`doctor.mjs`
:231 and :235, `test_doctor.mjs` :257 and :269, `test_doctor_config_keys.mjs` :126); the
RUNBOOK, CONTRACT and SKILL.md sentences that mention the count are other bundles' files and
are hash-pinned in the Global Constraints.
**BASE facts:** (generated at e04154b)
- `exec` at `fleet/tests/_lobby_helpers.mjs:85` blob 86c4674
- `capacity` at `fleet/launch.mjs:355` blob a2bcd04
- `status` at `fleet/claude-token.mjs:292` blob 356883f
- `ok` at `fleet/tests/test_claude_token.mjs:48` blob d2e9a9b
- `detail` at `fleet/run-engine.mjs:1329` blob ab943ea
- `verdict` at `evals/frontier/replay_corpus.py:51` blob 7d40d74
- `fleet/doctor.mjs` blob 5e0d5c9
- `missing` at `fleet/target.mjs:128` blob c189a05
- `cpu` at `fleet/launch.mjs:275` blob a2bcd04
- `x` at `fleet/tests/test_sandbox_boot_merge.mjs:220` blob bed2fad
- `memory` at `fleet/launch.mjs:276` blob a2bcd04
- `parseCpus` at `fleet/doctor.mjs:111` blob 5e0d5c9
- `parseMemoryGb` at `fleet/doctor.mjs:106` blob 5e0d5c9
- `asked` at `fleet/doctor.mjs:226` blob 5e0d5c9
- `pool` at `fleet/doctor.mjs:225` blob 5e0d5c9
- `DOCTOR_DEFAULTS` at `fleet/doctor.mjs:53` blob 5e0d5c9
- `tier` at `fleet/doctor.mjs:224` blob 5e0d5c9
- `plan` at `fleet/doctor.mjs:213` blob 5e0d5c9
- `poolRow` at `fleet/doctor.mjs:202` blob 5e0d5c9
- `fleet/tests/test_doctor.mjs` blob 130b27c
- `rowById` at `fleet/tests/test_doctor.mjs:117` blob 130b27c
- `statusOf` at `fleet/tests/_sandbox_boot_helpers.mjs:374` blob 8b5b99d
- `fleet/tests/test_doctor_config_keys.mjs` blob 7c4ebef
- `BASE_DETAIL` at `fleet/tests/test_doctor_config_keys.mjs:126` blob 7c4ebef
- `assert` at `evals/fixtures/jsdeps/project/test/dep.test.js:2` blob 90d2afe
- `tests/test_fleet_suite.py` blob d2ac604
- `ROW_IDS` at `fleet/doctor.mjs:57` blob 5e0d5c9

**Proof:**
- Test: `fleet/tests/test_doctor.mjs`
- Test: `fleet/tests/test_doctor_config_keys.mjs`
- Legs: (a) in `test_doctor.mjs`, the green run's `capacity` row has `status` `ok` and
  `detail` asserted equal — not merely including — to
  `XLarge pool 16 vCPU / 64GB; a run asks 8 vCPU / 16GB` [M1]; (b) in `test_doctor.mjs`, a
  billing answer with `max_cpus` 7 gives `status` `ok` and `detail` exactly equal to
  `XLarge pool 7 vCPU / 64GB; a run asks 8 vCPU / 16GB`; one with `max_memory_gb` 15 gives
  `status` `ok` and `detail` exactly equal to
  `XLarge pool 16 vCPU / 15GB; a run asks 8 vCPU / 16GB`; and one with `max_cpus` 4 gives
  `status` `ok`, `statusOf(result)` deep-equal to all five rows `ok`, and `verdict` exactly
  `ready` — no row of the three is `missing` [M2]; (c) in `test_doctor.mjs`, for each of the
  four rows of the two previous legs, `detail.includes('fits')` and
  `detail.includes('cannot hold')` are both asserted false [M3]; (d) in `test_doctor.mjs`,
  `billing plan --json` answering `{ code: 1, stdout: 'billing: not entitled\n' }` gives a
  `capacity` row whose `status` is asserted equal to `missing` and whose `detail` is asserted
  to include `fleet.json` [M4]; (e) in `test_doctor.mjs`, `billing plan --json` answering
  `{ code: 0, stdout: 'no plan for you\n' }` gives a `capacity` row whose `status` is
  asserted equal to `missing` and whose `detail` is asserted to include `fleet.json` [M4];
  (f) in `test_doctor.mjs`, a config of `{ cpu: 'x', memory: '16GB' }` over the green billing
  gives a `capacity` row whose `status` is asserted equal to `missing` and whose `detail` is
  asserted to include `fleet.json` [M4]; (g) in `test_doctor.mjs`, a config of
  `{ cpu: '8', memory: '1.5GB' }` over the green billing gives a `capacity` row whose
  `status` is asserted equal to `missing` and whose `detail` is asserted to include
  `fleet.json` [M4]; (h) in `test_doctor_config_keys.mjs`, with `BASE_DETAIL` set
  to `XLarge pool 16 vCPU / 64GB; a run asks 8 vCPU / 16GB`, the `['golden', 'stateRepo']`
  run is asserted `missing` with a detail including `golden`, `stateRepo`,
  `keys nothing reads` and `BASE_DETAIL`; the `['memory']` run is asserted `ok` with a detail
  including `cpu not in`, `the default 8` and `BASE_DETAIL`; and the CLI over the stale
  fixture file under the green shim is asserted to exit 1 with a printed `capacity` row
  whose `status` is `missing` [M5].
- Run: ! grep -E 'fits|cannot hold' fleet/doctor.mjs
- The previous bullet is the source half of the count-and-refusal absence — neither
  substring anywhere in the doctor [M3].
- Run: out=$(node fleet/tests/test_doctor.mjs) && printf '%s\n' "$out" | grep -q 'ALL TESTS PASSED'
- The previous bullet is the first sim, which carries every leg but the last: the exit code is
  read first (a non-zero exit short-circuits the and-chain), then the sentinel off the
  captured output [M6].
- Run: out=$(node fleet/tests/test_doctor_config_keys.mjs) && printf '%s\n' "$out" | grep -q 'ALL TESTS PASSED'
- The previous bullet is the second sim, which carries the stale-key leg, read the same way
  [M6].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the doc↔code pin over the doctor's `ROW_IDS` and the documents that
  name `fleet/doctor.mjs`, unchanged by this task [M6].

**Stale-if:**
- path-absent: `fleet/tests/test_doctor_config_keys.mjs`
- issue-closed: #681

### Task 2: first-run.md §capacity says allocation is over-committable

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/references/first-run.md`

**Claim:** `first-run.md` §capacity says allocation is over-committable and contention is the bound (#667 is measuring it). (quoted from #681)
Machine: M1. The `## capacity` section of `skills/ultrapowers/references/first-run.md` — the
lines from the heading `## capacity` to the heading `## claude` — with whitespace runs
squeezed to one space, contains, in this order, the words `over-commit` and `contention`,
and contains `#667`. M2. The same section quotes the new green wording and names the two
red shapes after the word missing: squeezed, it contains `a run asks`, and contains, in
this order, `missing`, `unreadable` and `unparseable`. M3. The retired sentences are gone from the
section, one row each: it contains none of `fits three runs`, `cannot carry seven`,
`is refused when the pool`, `how many such runs fit`, `cannot fit in` and
`width of a wave of runs`. M4. The two-key JSON example and the stale-key sentence stay:
the section contains `"cpu": "8"`, contains `"memory": "16GB"`, and squeezed contains, in
this order, `does not read` and `red`. M5. The document's `## ` headings are exactly
`## exe-dev`, `## capacity`, `## claude`, `## github` and `## integrations`, in that order
and none besides, and `python3 -m pytest -q -p no:cacheprovider
tests/test_docs_agree_with_code.py` exits 0.

**Authorized-by:** #681 ("`first-run.md` §capacity says allocation is over-committable and
contention is the bound (#667 is measuring it)"; "its heading is pinned by
`tests/test_docs_agree_with_code.py` and stays").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The section is lines 47–81 of the file at BASE, from `## capacity` to the
line before `## claude`; both headings stay byte-identical, as do the other three (`exe-dev`,
`claude`, `github`, `integrations`), because `tests/test_docs_agree_with_code.py` reads every
`## ` heading of this file in order against the doctor's `ROW_IDS`. What changes is the
prose. The opening paragraph today says the row is `ok` when the pool holds a run of that
size and its detail says how many such runs fit; it becomes: the row reports and never
limits — its green detail is the pool and the size one run asks for, in the shape
`XLarge pool 16 vCPU / 64GB; a run asks 4 vCPU / 8GB`, and it is `missing` only for an
unreadable pool (`billing plan --json` failing or answering no numbers) or an unparseable
config (`cpu` not an integer, `memory` not `<int>GB`) — write that last sentence with the
words `missing`, `unreadable` and `unparseable` in that order, since M2 pins them. The
JSON fence with `"cpu": "8"` and `"memory": "16GB"`, the sentence that a key the doctor does
not read turns the row red until it is removed, the browser line and the agent line all
stay. Of the three newcomer bullets, the first (`A pool a run cannot fit in is a run asked
too large` — the red detail naming `fleet.json` as the cheap fix) and the third (`The number
in the green detail is the width of a wave of runs` — `fits three runs cannot carry seven`,
`the fourth new is refused when the pool is already spent`) are replaced; the second
(`memory` is `<int>GB` or `<int>G`, a missing file means the defaults, a stale key is named)
stays. The replacement bullet says what was measured: allocation on exe.dev is
over-committable — 56 vCPU were allocated on the 16-vCPU plan and no `new` was refused, and
on 2026-09-05 six runs asking 24 vCPU ran concurrently — so the pool is not a ceiling on how
many runs are live at once; contention on the shared machine is the bound, and #667 is
measuring where it bites. Use the spelling `over-committable` (M1's pin is the substring
`over-commit`) and cite `#667` as those four characters. Nothing else in the file moves,
and no other document is edited: the RUNBOOK, CONTRACT and SKILL.md sentences that mention
the count are other bundles' files, hash-pinned in the Global Constraints.
**BASE facts:** (generated at e04154b)
- `skills/ultrapowers/references/first-run.md` blob 61ea591
- `missing` at `fleet/target.mjs:128` blob c189a05
- `red` at `fleet/tests/test_sandbox_boot_selfmerge.mjs:192` blob f06979f
- `tests/test_docs_agree_with_code.py` blob c9687c7
- `claude` at `fleet/tests/test_doctor.mjs:292` blob 130b27c
- `github` at `fleet/doctor.mjs:492` blob 5e0d5c9
- `ROW_IDS` at `fleet/doctor.mjs:57` blob 5e0d5c9
- `ok` at `fleet/tests/test_claude_token.mjs:48` blob d2e9a9b
- `cpu` at `fleet/launch.mjs:275` blob a2bcd04
- `memory` at `fleet/launch.mjs:276` blob a2bcd04

**Proof:**
- Run: sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | tr -s '[:space:]' ' ' | grep -q 'over-commit.*contention'
- The previous bullet reads only the section (from its heading to the next section's),
  whitespace runs squeezed to one space, and pins over-committable before contention [M1].
- Run: sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | grep -q '#667'
- The previous bullet is the measurement ticket, named in the section [M1].
- Run: sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | tr -s '[:space:]' ' ' | grep -q 'a run asks'
- The previous bullet is the new green detail's wording, in the section [M2].
- Run: sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | tr -s '[:space:]' ' ' | grep -q 'missing.*unreadable.*unparseable'
- The previous bullet is the two red shapes, in order, after the word missing [M2].
- Run: ! sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | tr -s '[:space:]' ' ' | grep -q 'fits three runs'
- The previous bullet is the first retired sentence, absent from the section [M3].
- Run: ! sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | tr -s '[:space:]' ' ' | grep -q 'cannot carry seven'
- The previous bullet is the second retired sentence, absent from the section [M3].
- Run: ! sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | tr -s '[:space:]' ' ' | grep -q 'is refused when the pool'
- The previous bullet is the third retired sentence, absent from the section [M3].
- Run: ! sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | tr -s '[:space:]' ' ' | grep -q 'how many such runs fit'
- The previous bullet is the fourth retired sentence, absent from the section [M3].
- Run: ! sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | tr -s '[:space:]' ' ' | grep -q 'cannot fit in'
- The previous bullet is the fifth retired sentence, absent from the section [M3].
- Run: ! sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | tr -s '[:space:]' ' ' | grep -q 'width of a wave of runs'
- The previous bullet is the sixth retired sentence, absent from the section [M3].
- Run: sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | grep -q '"cpu": "8"'
- The previous bullet is the cpu key of the JSON example, still in the section [M4].
- Run: sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | grep -q '"memory": "16GB"'
- The previous bullet is the memory key of the JSON example, still in the section [M4].
- Run: sed -n '/^## capacity$/,/^## claude$/p' skills/ultrapowers/references/first-run.md | tr -s '[:space:]' ' ' | grep -q 'does not read.*red'
- The previous bullet is the stale-key sentence — a key the doctor does not read turns the row red — still in the section [M4].
- Run: test "$(grep '^## ' skills/ultrapowers/references/first-run.md | tr '\n' ' ')" = "## exe-dev ## capacity ## claude ## github ## integrations "
- The previous bullet is the five headings, exactly and in order, with no sixth — a renamed or added heading fails the string equality [M5].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the heading pin against the doctor's `ROW_IDS`, and the rest of that file's document-to-code structure [M5].

**Stale-if:**
- path-absent: `skills/ultrapowers/references/first-run.md`
- issue-closed: #681
