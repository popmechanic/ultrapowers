# The publish merge folds again until its PUT is accepted

**Grammar:** claims-v1

**Claim:** A merge refused with the base-moved 405 folds again for as long as each fold is clean and the suite is green, bounded by wall clock rather than by a count of two: the run keeps re-folding onto the moving main until its PUT is accepted or a fold is not clean, and the receipt records every attempt (`driver:publish-fold` rows already carry `attempt`). A fold that is not clean, or a suite that goes red on the joined tree, is the hold it is today. (quoted from #798)

**Goal:** #798 — the 0.3.22 confidence run. At BASE `74fa24b88a9a44b2a12f775c7b75608e043408ff`
the sandbox's merge is retried exactly once: `fleet/sandbox-boot.sh` carries the retry in
`MERGE_RETRY`, tests it once in `do_boot` between two `merge_pr` calls, and a second base-moved
405 leaves the PR open with `left open: merge PUT answered 405 twice`. Under an N-wide drain
whose runs converge on `main` inside one CI window (runs 61, 64, 67 on 2026-09-08), the second
run to land behind a moving main is guaranteed that second 405 with both of its folds clean, and
the operator re-drives it by hand. This plan replaces the count of two with a wall clock: a new
knob `FOLD_AGAIN_WAIT` (`FLEET_FOLD_AGAIN_WAIT`, default 3600 s, measured from the first
base-moved 405) bounds how long the run keeps folding again, every attempt keeps its row in the
receipt and its line on the PR card, and an unclean fold (`suite red`, `conflict parked`,
`cannot fold`) or a tip that did not move is the hold it is today. One implementation task,
`Review: peer`, its exam extending `fleet/tests/test_sandbox_boot_merge.mjs` — the file that
already holds the #715 and #784 merge-retry legs for this surface.
**Closes:** #798

**Tech Stack:** bash (`fleet/sandbox-boot.sh`), node ≥ 20 sims under `fleet/tests/` on the
shared rig `fleet/tests/_sandbox_boot_helpers.mjs` (a stub `curl`/`git`/`systemd-run` PATH, no
network), Markdown (`fleet/CONTRACT.md`). The suite is `python3 -m pytest`, which bridges every
`fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`,
300 s per file).

**Parallelization rationale:** one wave, width 1. The change is one seam — the merge loop of
`fleet/sandbox-boot.sh`, the rig knobs its exam needs, and the contract sentences that pin the
old count — and every one of those edits carries the same literals (the two new hold notes, the
knob's name and default), so a second task would share every literal and own nothing of its own;
a split would buy no width and would put both halves of a pin (the boot's note, the contract's
sentence) in different tasks. Genuinely linear, and one task long.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- fleet/publish-fold.mjs fleet/run-engine.mjs fleet/run-waves.mjs fleet/roles`
- The Check above is the scope pin: the fold itself is untouched. `fleet/publish-fold.mjs` already
  floors attempt N on the highest prior attempt's `candidate` and records `tip unmoved` against
  the prior attempt's `tip`, so a third and a fourth attempt need nothing from it; Amendment 10
  holds — every git command, ref move, push and REST call in this change is the boot script's,
  and no model is dispatched by anything this plan adds.
- No token in any argv and no direct Anthropic API call: the fold unit's envelope
  (`env -u CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL=… CLAUDE_CODE_OAUTH_TOKEN=placeholder`) is
  the same for every attempt, whatever its number.
- The vocabulary of `publish:hold` and `publish:merge` is unchanged: a hold's `why` is the
  phase's text after `left open: `, a refused merge's `left` is `refused` and its `detail` the
  account, and the LAST `publish:merge` line is what became of the PR.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: A base-moved 405 folds again until the PUT is accepted, bounded by FOLD_AGAIN_WAIT

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`

**Claim:** A merge refused with the base-moved 405 folds again for as long as each fold is clean and the suite is green, bounded by wall clock rather than by a count of two: the run keeps re-folding onto the moving main until its PUT is accepted or a fold is not clean, and the receipt records every attempt (`driver:publish-fold` rows already carry `attempt`). A fold that is not clean, or a suite that goes red on the joined tree, is the hold it is today. (quoted from #798)
Machine: M1. A base-moved 405 is a merge PUT answered 405 whose body, lowercased, contains `not mergeable`, `base branch was modified` or `required status check` — the three bodies the script already treats as one class. On the boot sim's rig, a gate-green boot whose merge PUT stub answers the base-moved 405 (`STUB_MERGE_MESSAGE` `Base branch was modified`) three times and then 200 — `STUB_MERGE_CODE` `405 405 405 200` — under the default `FLEET_FOLD_AGAIN_WAIT` runs exactly four fold units, `fleet-fold-7-1`, `fleet-fold-7-2`, `fleet-fold-7-3`, `fleet-fold-7-4`, in that order; issues exactly four merge PUTs, each PUT after the first preceded by at least one `check-runs` read and at least one `GET /pulls/1` mergeability read made after the previous PUT; writes evidence commits whose states are, in order, `running, publishing, running, publishing, running, publishing, running, publishing, done`; appends no `publish:hold` line; and ends `done` with a phase that says `merged`.
M2. On that same boot the receipt `publish-fold/receipt.json` carries `attempts` rows `1`, `2`, `3` and `4`, each with `disposition` `folded`; exactly one PR-body PATCH is sent, after the fourth PUT, and its body lists `- attempt 1:`, `- attempt 2:`, `- attempt 3:` and `- attempt 4:`; and the run's `publish:merge` lines are, in order, three with `sha` null, `left` `refused` and `detail` `merge PUT answered 405`, then one whose `sha` is the merge sha and which carries neither `left` nor `detail`.
M3. For each of the three unclean dispositions as attempt 2's disposition under the `405 405 405 200` stub — `suite red` with hold text `publish fold — suite red`; `conflict parked` on path `a.txt` with hold text `publish fold — conflict parked on a.txt`; `cannot fold` with reason `base not an ancestor` and hold text `publish fold — cannot fold: base not an ancestor` — the boot runs exactly two fold units, issues exactly one merge PUT, writes evidence commits `running, publishing, running, publishing, done`, appends exactly one `publish:hold` line whose `why` is exactly that row's hold text, and ends `done` with a phase carrying `left open: ` followed by that same hold text.
M4. `fleet/sandbox-boot.sh` defines the knob as the line `FOLD_AGAIN_WAIT="${FLEET_FOLD_AGAIN_WAIT:-3600}"`; the first base-moved 405 always earns a second fold, and each later base-moved 405 earns another fold only while fewer than `FOLD_AGAIN_WAIT` seconds have passed since the first one — so with `FLEET_FOLD_AGAIN_WAIT` `0` and a merge stub answering the base-moved 405 to every PUT, the boot runs exactly two fold units, issues exactly two PUTs, and ends `done` with a phase carrying `left open: merge PUT answered 405 after 0s of folding again`, its last `publish:merge` line having `sha` null, `left` `refused` and `detail` `merge PUT answered 405 after 0s of folding again`; and a base-moved 405 whose next fold records `tip unmoved` ends `done` after exactly one integration push and exactly one PUT, with a phase carrying `left open: merge PUT answered 405 and the fold moved nothing` and a last `publish:merge` line whose `detail` is `merge PUT answered 405 and the fold moved nothing`.
M5. The text `405 twice` appears in neither `fleet/sandbox-boot.sh` nor `fleet/CONTRACT.md`; `fleet/CONTRACT.md`'s merge bullet — the lines from `  - merge:` to `  - record:` — names `FOLD_AGAIN_WAIT`, its default `3600`, and both new notes (`after` … `of folding again`, `the fold moved nothing`); its `status.json` bullet — the lines from `- **status.json:**` to `- **Publish:**` — describes the state sequence as one `running → publishing` pair per fold and names `FOLD_AGAIN_WAIT`; and the phrase `retried exactly once` appears nowhere in `fleet/CONTRACT.md`.
M6. For each of `fleet/tests/test_sandbox_boot_exams.mjs` and `fleet/tests/test_sandbox_boot_selfmerge.mjs` — the two other boot sims that drive the merge retry — running it with `node` on the changed rig prints the line `ALL TESTS PASSED`, exactly so; an output without that sentinel line is the leg failing.

**Authorized-by:** #798; #715 (decision 11 — the fold window), #784 (the strict-mode 405 bodies), #790

**Interfaces:**
- Consumes: none
- Produces: `FOLD_AGAIN_WAIT="${FLEET_FOLD_AGAIN_WAIT:-3600}"`

**Context:** Every literal below was read at BASE `74fa24b88a9a44b2a12f775c7b75608e043408ff`
(`git fetch origin main && git rev-parse origin/main`, 2026-09-08).

*What exists.* `fleet/sandbox-boot.sh` line 197 `MERGE_RETRY=""` and line 201 `FOLD_ATTEMPTS=0`;
the merge loop is `merge_pr` (line 1794 on), whose non-2xx arm reads
`if [ "$code" = 405 ] && [ "$MERGE_RETRY" = "1" ]; then` → `MERGE_NOTE="left open: merge PUT
answered 405 twice"` and `append_event publish:merge sha=n: "left=s:refused" "detail=s:merge PUT
answered 405 twice"`, else on a 405 whose lowercased body contains `not mergeable`, `base branch
was modified` or `required status check` sets `MERGE_RETRY=1`, `MERGE_NOTE="left open: merge PUT
answered 405"` and appends `publish:merge … detail=s:merge PUT answered 405`. `do_boot` (line 2186
on) tests `MERGE_RETRY` exactly once: `write_status running "publish fold (attempt 2)"`, an
evidence commit, `publish_fold 2`, then either the `tip unmoved` arm (which itself writes the
`405 twice` note and event and a `publishing` page `$PR_URL — the fold moved nothing`) or
`push_head` → `write_status publishing` → evidence commit → `merge_pr`; then `patch_pr_body`
once. `merge_pr` calls `await_mergeable "$number"` only when `MERGE_RETRY = 1` (line 1885);
`fold_restore` (line 970) hard-codes `if [ "$1" = "2" ]` → attempt 1's `candidate` — a fold-again
of attempt N restores attempt N−1's candidate, which is what `fleet/publish-fold.mjs` already does
on its side (`priorKeys … n < attemptNum`, `floor = prior.candidate || engineHead`, and
`tip unmoved` when `prior.tip === tip`), so the folder needs no change and is outside this task's
Files; its header comment `attempt 1 or 2` is only a comment. `render_card` already loops
`n=1..highest` and prints `- attempt <n>: <phrase>` per row; `patch_pr_body` is one PATCH.
`git grep -c "405 twice"` at BASE: `fleet/sandbox-boot.sh` 5 lines (a comment at 1690, 1919,
1921, 2198, 2203), `fleet/CONTRACT.md` 1 (line 243), `fleet/tests/test_sandbox_boot_merge.mjs`
3 (lines 1350, 1363, 1430), and 3 in
`tests/fixtures/plans/2026-09-07/2026-09-07-publish-decisions-as-events.md`, a frozen compiler
fixture plan that pins nothing about the boot and is left alone. `FOLD_AGAIN` appears nowhere at
BASE. The knob pattern to copy is line 141, `MERGE_CHECK_WAIT="${FLEET_MERGE_CHECK_WAIT:-1800}"`;
`poll_attempts` (line 340) is bounded by attempts because the sims run with
`FLEET_POLL_SECONDS=0`, but the fold-again bound is a real wall clock (`date +%s` since the first
base-moved 405), which is why M4's exam uses `0`: with the first 405 always earning its fold and
the second checked against `fewer than 0 seconds`, the shape is deterministic whatever the sim's
speed. Under the default 3600 a sim that answers 405 to every PUT would fold again for an hour —
every exam case that keeps refusing (`STUB_MERGE_CODE_2: '405'`) therefore carries
`FLEET_FOLD_AGAIN_WAIT: '0'`.

*The contract sentences that pin the count.* `fleet/CONTRACT.md` line 235 `The merge is retried
exactly once, and only for a moved tip:` … line 243 `a second 405 leaves the PR open with \`left
open: merge PUT answered 405 twice\`, and`; line 195 `--attempt 1|2` and `--force-with-lease=…
on attempt 2` in the publish-fold bullet; line 209 `except attempt 2's push`; and the status.json
bullet (lines 256–260): "a run whose merge PUT answered 405 and was folded and PUT again reads
`running → publishing → running → publishing → done` — the second `running` is the fold's
attempt 2 (phase `publish fold (attempt 2)`), the merge is retried exactly once, and there is no
third `publishing`." Rewrite these to the new shape: every fold-again is one more
`running` (phase `publish fold (attempt <n>)`, an evidence commit) → leased push → `publishing`
(an evidence commit) → check-runs loop on the new head → mergeability poll → one more PUT, for as
long as each PUT answers a base-moved 405 and fewer than `FOLD_AGAIN_WAIT` (`FLEET_FOLD_AGAIN_WAIT`,
default 3600 s) seconds have passed since the first one; the clock's end leaves the PR open with
`left open: merge PUT answered 405 after <N>s of folding again`, a fold that moved nothing with
`left open: merge PUT answered 405 and the fold moved nothing`, and an unclean fold with the
`publish fold — <disposition text>` hold it has today. `tests/test_docs_agree_with_code.py` reads
the `- **Publish:**` bullet's literals (`publish:pr`, `publish:hold`, `publish:merge`, `url`,
`number`, `draft`, `why`, `left`, `detail`, `checks red`, `checks pending`, `refused`,
`publish:followup`, `four event kinds`) — none of those is touched by this rewrite, and no test
pins `retried exactly once` or `attempt 2` in the contract.

*The two new notes, verbatim, shared by the boot, the contract and the exam:*
`left open: merge PUT answered 405 after ${FOLD_AGAIN_WAIT}s of folding again` (event
`detail` `merge PUT answered 405 after <N>s of folding again`) and
`left open: merge PUT answered 405 and the fold moved nothing` (event `detail`
`merge PUT answered 405 and the fold moved nothing`). The intermediate refusals keep today's
`detail` `merge PUT answered 405`, one `publish:merge` line per PUT, the last line being what
became of the PR. A hold's `why` stays the phase text after `left open: `.

*The rig.* `fleet/tests/_sandbox_boot_helpers.mjs` lines 224–240 are the merge PUT stub:
`STUB_MERGE_CODE` is read as a space-separated list answering PUT n with its n-th entry, but the
next lines `if [ "$n" -ge 2 ]; then code="${STUB_MERGE_CODE_2:-200}"; msg="${STUB_MERGE_MESSAGE_2:-$msg}"; fi`
override every PUT from the second with `STUB_MERGE_CODE_2` (default 200), so a list of four codes
cannot reach PUT 3 today. The shared knob shape this task implements in the rig, which the exam
relies on: `STUB_MERGE_CODE` as a list answers PUT n with its n-th entry whenever the list has at
least n entries; `STUB_MERGE_CODE_2` / `STUB_MERGE_MESSAGE_2` apply to PUT n ≥ 2 only when the
list has fewer than n entries, defaulting to 200 as today — so every existing case (a one-entry
list plus `STUB_MERGE_CODE_2`) answers exactly what it answers at BASE. The fold stub (lines
430–460) reads `STUB_FOLD_DISPOSITION_2` for attempt 2 only and `STUB_FOLD_DISPOSITION` (default
`folded`) for every other attempt, writes the `fold-2` marker on attempt 2 (which makes `git
rev-parse` and the branches endpoint answer `STUB_HEAD_SHA_2` from then on), and `STUB_FOLD_PATH`
/ `STUB_FOLD_REASON` apply to whichever attempt's row is written — M3's three rows need no new
knob, and attempts 3 and 4 of M1 dispose `folded` by default. The unit name is
`fleet-fold-7-<attempt>`, read by the sim as `foldUnits(ctx)`; the evidence commit states are
`commitStates(ctx)`; `mergePuts(ctx)` and `indicesOf(ctx, isMergePut)` count PUTs;
`isPullGet` / `isCheckRead` / `isPullPatch` classify curl calls; `patches(ctx)` returns the PATCH
bodies; `receiptOf` / `attemptOf` read the receipt; `phaseOf(ctx)` is the done page's phase;
`integrationPushes(ctx)` counts pushes; events are `events.jsonl` under the evidence run dir
(`fleet/tests/test_sandbox_boot_selfmerge.mjs` shows the reader). The merge sim runs 76 `test(`
cases at BASE in ~49 s wall on the laptop with its own `WIDTH = 3` gate; the pytest bridge allows
300 s per file.

*The exam file's own stale pins.* `fleet/tests/test_sandbox_boot_merge.mjs` at BASE pins the old
count in three tests: `a second 405 is the end of it` (line 1346, `retry405Twice` =
`NOT_MERGEABLE` + `STUB_MERGE_CODE_2: '405'` + `STUB_FOLD_RESOLVERS: '1'`, asserts two PUTs and
`405 twice`), `a tip unmoved on attempt 2 skips the push and the merge` (line 1354, asserts
`405 twice`), and `a run refused twice PATCHes its body after the second PUT` (line 1409, asserts
the body names `merge PUT answered 405 twice`). The exam extends this file and rewrites those
three to the new notes: `retry405Twice` gains `FLEET_FOLD_AGAIN_WAIT: '0'` and asserts `after 0s
of folding again` (M4), the tip-unmoved case asserts `the fold moved nothing` (M4), and the PATCH
case asserts the body names whichever note its boot earns. Every other #715/#784 leg in the file
(`retryMerged`, `retrySuiteRed`, `mergeableLate`, `merge405Other`, `merge409`/`422`/`500`, the
strict-405 banner) keeps its assertions: a one-entry `STUB_MERGE_CODE` with the default
`STUB_MERGE_CODE_2` still merges on PUT 2. New legs sit under a comment naming this task.
`fleet/tests/test_sandbox_boot_exams.mjs` (`retryPromise`: `STUB_MERGE_CODE: '405'`, body
`not mergeable`, PUT 2 defaults 200) and `fleet/tests/test_sandbox_boot_selfmerge.mjs` (`retry`
and `refused` cases) drive the retry too and are M6's two `Run:` lines.

*Reading of the ticket's sim sentence.* #798 says "a PUT stub answering the base-moved 405 three
times then 200 → three fold attempts, a merge, no hold". Each PUT follows a fold, so three 405s
then a 200 is four PUTs behind four folds: attempt 1 and three folds-again. M1 pins the computed
count (four) and reads the ticket's "three" as the three folds-again.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`
- Guard: `fleet/tests/test_sandbox_boot_merge.mjs`
- Legs: (a) a boot with `STUB_MERGE_CODE: '405 405 405 200'` and `STUB_MERGE_MESSAGE: 'Base branch was modified'` runs fold units exactly `[fleet-fold-7-1, fleet-fold-7-2, fleet-fold-7-3, fleet-fold-7-4]`, records exactly four merge PUTs in curl's argv log, has at least one `check-runs` read and at least one `GET /pulls/1` read between each consecutive pair of PUTs, has `commitStates` exactly `['running','publishing','running','publishing','running','publishing','running','publishing','done']`, has zero `publish:hold` lines, and its `done` phase includes `merged` [M1]; (b) on the boot of the previous leg the receipt's `attempts` keys are exactly `['1','2','3','4']` each with `disposition` `folded`, `patches(ctx)` has length 1 with a body containing `- attempt 1:`, `- attempt 2:`, `- attempt 3:` and `- attempt 4:`, the PATCH's curl index is greater than the fourth PUT's, and the `publish:merge` lines are exactly four — the first three `{sha: null, left: 'refused', detail: 'merge PUT answered 405'}` and the last `{sha: <MERGE_SHA>}` with no `left` and no `detail` key [M2]; (c) the `405 405 405 200` stub with `STUB_FOLD_DISPOSITION_2: 'suite red'`: fold units exactly `[fleet-fold-7-1, fleet-fold-7-2]`, exactly one merge PUT, `commitStates` exactly `['running','publishing','running','publishing','done']`, exactly one `publish:hold` line with `why` exactly `publish fold — suite red`, and a `done` phase including `left open: publish fold — suite red` [M3]; (d) the same stub with `STUB_FOLD_DISPOSITION_2: 'conflict parked'` and `STUB_FOLD_PATH: 'a.txt'`: the same two fold units, one PUT and five commit states, exactly one `publish:hold` line with `why` exactly `publish fold — conflict parked on a.txt`, and a `done` phase including `left open: publish fold — conflict parked on a.txt` [M3]; (e) the same stub with `STUB_FOLD_DISPOSITION_2: 'cannot fold'` and `STUB_FOLD_REASON: 'base not an ancestor'`: the same two fold units, one PUT and five commit states, exactly one `publish:hold` line with `why` exactly `publish fold — cannot fold: base not an ancestor`, and a `done` phase including `left open: publish fold — cannot fold: base not an ancestor` [M3]; (f) a boot with `STUB_MERGE_CODE: '405'`, `STUB_MERGE_CODE_2: '405'`, `STUB_MERGE_MESSAGE: 'Base branch was modified'` and `FLEET_FOLD_AGAIN_WAIT: '0'` runs fold units exactly `[fleet-fold-7-1, fleet-fold-7-2]`, records exactly two PUTs, its `done` phase includes `left open: merge PUT answered 405 after 0s of folding again`, and its last `publish:merge` line is `{sha: null, left: 'refused', detail: 'merge PUT answered 405 after 0s of folding again'}`; and the second `Run:` below, a `grep -F` of the exact line `FOLD_AGAIN_WAIT="${FLEET_FOLD_AGAIN_WAIT:-3600}"` in `fleet/sandbox-boot.sh`, exits 0 [M4]; (g) a boot with `STUB_MERGE_CODE: '405'`, `STUB_MERGE_MESSAGE: 'Base branch was modified'` and `STUB_FOLD_DISPOSITION_2: 'tip unmoved'` records attempt 2's disposition `tip unmoved`, exactly one integration push, exactly one PUT, a `done` phase including `left open: merge PUT answered 405 and the fold moved nothing`, and a last `publish:merge` line whose `detail` is `merge PUT answered 405 and the fold moved nothing` — and the text `405 twice` appears in no `done` phase of any boot in this file [M4]; (h) the first and third-through-eighth `Run:` lines below: `405 twice` matches in neither `fleet/sandbox-boot.sh` nor `fleet/CONTRACT.md` (both files are listed by `grep -L`), the merge bullet's range names `FOLD_AGAIN_WAIT` followed by `3600`, `of folding again` and `the fold moved nothing`, the status.json bullet's range names `FOLD_AGAIN_WAIT` and has zero matches of `no third`, and `retried exactly once` has zero matches in the contract [M5]; (i) the ninth `Run:` below, `node fleet/tests/test_sandbox_boot_exams.mjs` piped into `grep -q`, exits 0 exactly when the sim's output carries the line `ALL TESTS PASSED` and non-zero when that line is absent [M6]; (j) the tenth `Run:` below, `node fleet/tests/test_sandbox_boot_selfmerge.mjs` piped the same way, exits 0 exactly when its output carries the line `ALL TESTS PASSED` and non-zero when that line is absent [M6].
- Run: `grep -L '405 twice' fleet/sandbox-boot.sh fleet/CONTRACT.md | grep -c . | grep -qx 2`
- Run: `grep -qF 'FOLD_AGAIN_WAIT="${FLEET_FOLD_AGAIN_WAIT:-3600}"' fleet/sandbox-boot.sh`
- Run: `sed -n '/^  - merge:/,/^  - record:/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'FOLD_AGAIN_WAIT.*3600'`
- Run: `sed -n '/^  - merge:/,/^  - record:/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'of folding again'`
- Run: `sed -n '/^  - merge:/,/^  - record:/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'the fold moved nothing'`
- Run: `sed -n '/^- \*\*status.json:\*\*/,/^- \*\*Publish:\*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'FOLD_AGAIN_WAIT'`
- Run: `sed -n '/^- \*\*status.json:\*\*/,/^- \*\*Publish:\*\*/p' fleet/CONTRACT.md | grep -c 'no third' | grep -qx 0`
- Run: `grep -c 'retried exactly once' fleet/CONTRACT.md | grep -qx 0`
- Run: `node fleet/tests/test_sandbox_boot_exams.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_sandbox_boot_selfmerge.mjs | grep -q 'ALL TESTS PASSED'`

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- issue-closed: #798
