# A 405 that says the base moved folds again

**Grammar:** claims-v1

**Claim:** `fleet/sandbox-boot.sh`'s merge treats a 405 whose body says the base branch was modified, or that a required status check is expected, exactly as it treats `not mergeable`: it raises the one second fold, and the second attempt's merge waits for the checks of the head that fold pushed. (quoted from #784)

**Goal:** #784 — decision 11's second pair (map #360, after #715). Runs 53 and 55 both published
while main was still at base, so each publish fold read `tip == base` and GitHub's squash of the
second PR did the `fleet/run-engine.mjs` join — no kernel, no exams, no suite before CI. The
chosen shape is GitHub's own rule: branch protection on main with *require branches to be up to
date before merging* (`required_status_checks.strict = true`). Under it a PR whose base moved
gets a 405 on the merge PUT, and the sandbox already turns a 405 into its one second fold — but
only when the body says `not mergeable`. Strict mode's bodies say the base branch was modified,
or that a required status check is expected, so today that run ends
`left open: merge PUT answered 405`. After this run those two bodies buy the same second fold,
the second merge asks about the checks of the head that fold pushed, and a 405 for any other
reason is still one PUT and done. The operator then flips `strict` on main (a setting, no code),
and the next concurrent pair is decision 11's measurement.
**Closes:** #784

**Tech Stack:** POSIX shell (`fleet/sandbox-boot.sh`, run under `set -e`; every branch of
`merge_pr` returns 0 and the retry rides the `MERGE_RETRY` variable); the sim
`fleet/tests/test_sandbox_boot_merge.mjs` over `fleet/tests/_sandbox_boot_helpers.mjs` (a PATH
shim answers every `curl`, `git`, `gh`, `systemd-run` and `systemctl` from environment knobs —
`STUB_MERGE_CODE` / `STUB_MERGE_MESSAGE` answer the first merge PUT, `STUB_MERGE_CODE_2` /
`STUB_MERGE_MESSAGE_2` the second — and each scenario is one memoized boot started at module
load, `bootWith(env)`). The suite is `python3 -m pytest` from the repo root, which bridges every
`fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`).

**Exam command:** node {paths}

**Parallelization rationale:** wave 1 is one task, width 1. The change is one `case` arm in one
function, the sim legs that pin it, and the contract sentence that states it; the sentence and
the arm name the same three phrases, so a tree where they disagree is not a legal intermediate
state and both land in one patch. There is no second contract to run beside it.

## Authoring notes

Choices taken in the operator's stead (each the `(Recommended)` option ultrawrite would have
offered): one task, `**Review:** peer` (the merge gate is the one seam where a wrong match
merges unchecked, so a second independent read is worth its cost); the exam extends the
behaviour-surface file `fleet/tests/test_sandbox_boot_merge.mjs` rather than opening a new sim;
the existing "any other reason" scenario keeps its assertions and changes only its body, since
the body it used (`Base branch was modified`) is one the Claim promotes; `fleet/RUNBOOK.md` is
untouched because it does not state the rule; the `git grep` census of `not mergeable` is
recorded in Context; execution recommendation: Ultrapowers (risk override — the merge gate is a
data-integrity surface), T=1, width 1.

## Global Constraints

- `fleet/run-engine.mjs`, `fleet/tests/_sandbox_boot_helpers.mjs` and
  `fleet/tests/test_sandbox_boot_selfmerge.mjs` are byte-identical to BASE — the rig's knobs
  already express every scenario, and the self-merge sim's `retry` case keeps its body (the
  `Check:` beside this compares them against `$ULTRA_BASE`).
- Check: `git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/tests/_sandbox_boot_helpers.mjs fleet/tests/test_sandbox_boot_selfmerge.mjs`
- ONE PUT PER FOLD stands: the retry is bought once, by the first PUT's body, and nothing in
  `fleet/sandbox-boot.sh` loops on a merge refusal; a second 405 is still
  `left open: merge PUT answered 405 twice`, and every non-405 refusal keeps the one PUT it made.
- The sim stays one process over the shared rig: every new scenario is one `bootWith(env)` boot
  memoized at module load, read by its legs, and no leg spawns another sim or re-runs a sibling
  file (#768's shape).
- Every assertion that stands at BASE in `fleet/tests/test_sandbox_boot_merge.mjs` still holds as
  written, except the one scenario whose body this task promotes from "any other reason" to a
  retry — that scenario keeps its assertions and changes only its body.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The strict-mode 405 bodies buy the second fold

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`

**Claim:** `fleet/sandbox-boot.sh`'s merge treats a 405 whose body says the base branch was modified, or that a required status check is expected, exactly as it treats `not mergeable`: it raises the one second fold, and the second attempt's merge waits for the checks of the head that fold pushed. (quoted from #784)
Machine: M1. For each of the two strict-mode bodies — `Base branch was modified` and
`Required status check "test" is expected.` — a first merge PUT answered 405 with that body
in its `message` buys the one retry, exactly as `Pull Request is not mergeable` does at BASE:
the run's evidence commits are `running, publishing, running, publishing, done`; the fold
units run are exactly `fleet-fold-7-1` then `fleet-fold-7-2`; the branch is pushed once more
under `--force-with-lease`; exactly two merge PUTs are made; and the run's `done` phase says
`merged`.
M2. For each of those two bodies, the check-runs GET re-entered after the first PUT is on
attempt 2's `pushedHead` — the sha `push_head` recorded for the second fold, not the head the
first PUT named — and it is followed by at least one `GET /pulls/<n>` mergeability read and
then by the second PUT, in that order.
M3. The match ignores letter case: a first PUT answered 405 with the body
`base branch was modified` buys the retry and merges on the second PUT, and so does one with
the body `2 of 2 REQUIRED STATUS CHECKS are expected.` — each with exactly two PUTs, two fold
units and a `done` phase saying `merged`.
M4. A first PUT answered 405 with a body that names none of the three phrases —
`At least 1 approving review is required by reviewers with write access.` — is left where BASE
leaves it: exactly one PUT, exactly one fold unit (`fleet-fold-7-1`), and a `done` phase saying
`left open: merge PUT answered 405` and not `twice`.
M5. The `Pull Request is not mergeable` body still buys the retry exactly as at BASE: the
file's existing scenario for it — one more fold, one leased push, one more PUT after the checks
of attempt 2's `pushedHead` and the mergeability poll — passes as written.
M6. `fleet/CONTRACT.md`'s merge bullet — the text from `- merge:` to `- record:` — names all
three bodies as the refusal that earns the second fold: the pull request not being mergeable,
the base branch having been modified, and a required status check being expected; and the
two documents `tests/test_docs_agree_with_code.py` pins beside it still agree with the code.

**Authorized-by:** #784 (desired state, 2026-09-08 afternoon sitting — decision 11's second
pair under #715); map #360 §Rules (the kernel is the only merge in the system);
`fleet/CONTRACT.md` §Literals (the merge bullet: "retried exactly once, and only for a moved
tip").

**Interfaces:**
- Consumes: none
- Produces: `merge_pr()` (the 405 arm that sets `MERGE_RETRY=1` now matches three bodies)

**Context:** The facts below were read off `origin/main` at `4396591` (0.3.20), the tree this
plan was authored against; line numbers are that tree's and the names are exact.

*The arm at BASE.* `merge_pr` (`fleet/sandbox-boot.sh` 1540–1691) makes one PUT
(1643–1644) and reads the answer's body off `$answer` (1646). On a non-2xx it tests
`MERGE_RETRY` first (1658: a second 405 is `left open: merge PUT answered 405 twice`), then
(1665–1678) `case "$body" in *"not mergeable"*)` logs, sets `MERGE_RETRY=1`, sets
`MERGE_NOTE="left open: merge PUT answered 405"`, appends
`publish:merge sha=n: left=s:refused detail=s:merge PUT answered 405`, and returns 0; every
other body falls through to 1680, the same note and event with the code, and no retry. The body
is the raw JSON text of GitHub's answer, so the phrase is matched inside
`{"message":"…"}` — the stub prints exactly `{"sha":"…","merged":true,"message":"<msg>"}`
(`_sandbox_boot_helpers.mjs` 238). `case` patterns in POSIX sh are case-sensitive; the
lowercase-once shape (`printf '%s' "$body" | tr '[:upper:]' '[:lower:]'` into a local, then
`case` on that with lowercase patterns) keeps the three arms one `case`. The two strict-mode
phrases to match, as substrings, are `base branch was modified` and `required status check`
— GitHub's strict-mode bodies read `Base branch was modified. Review and try the merge again.`,
`Required status check "test" is expected.` and `2 of 2 required status checks are expected.`
The log line, the note and the event for the new bodies are the ones the `not mergeable` arm
writes: the second `publish:merge` line is what became of the PR, and `left=s:refused` /
`detail=s:merge PUT answered 405` are what the existing legs and `test_sandbox_boot_selfmerge.mjs`
(`retry` case, 469) read.

*The second clause is already true of the script; the exam pins it.* `do_boot` (1928–1950)
tests `MERGE_RETRY` once, runs `publish_fold 2`, and on a moved tip calls `push_head` (1087)
which pushes under the lease and then `await_branch_visible` (1286–1287), which re-reads
`BRANCH_HEAD="$(git rev-parse "$BRANCH")"`; `push_head` records that sha as attempt 2's
`pushedHead` (1103). The re-entered `merge_pr` takes `head="$BRANCH_HEAD"` (1572) — so its
check-runs GET (1585) and its PUT's `sha` both name the head the second fold pushed, and
`await_mergeable` (1506, called at 1629 because `MERGE_RETRY=1`) polls `GET /pulls/<n>` until
`mergeable` is non-null. The existing leg (g) asserts exactly this for the `not mergeable`
body (`checkUrlFor(second.pushedHead)`, then `isPullGet`, then the second PUT); the new legs
assert it for the two strict bodies. Nothing in this task changes `do_boot`, `push_head` or
`await_branch_visible`.

*The sim's pins that this task owns.* `fleet/tests/test_sandbox_boot_merge.mjs` declares
`NOT_MERGEABLE` (828) and the retry boots `retryMerged`, `retry405Twice`, `retryTipUnmoved`
(846–848) and `crashOnTwo` (836) on it, and the M7 legs (1300–1390). **Line 851 is the pin the
Claim replaces:** `const merge405Other = bootWith({ STUB_MERGE_CODE: '405', STUB_MERGE_MESSAGE:
'Base branch was modified' })` is the "any other reason" scenario, and its body is one of the
two this task promotes — that boot's body moves to a phrase none of the three arms matches
(the approving-review body M4 names) and its three assertions (one PUT, `[FOLD_UNIT_1]`, the
note without `twice`) stay as written. The file's header comment (686–688, `M7`) says which
405 buys the retry; it reads the three bodies after this task. The new legs sit in a fresh
region under a comment naming this task and its issue. Each new scenario is one `bootWith`
boot: the retry shape needs only `STUB_MERGE_CODE: '405'` and the body in `STUB_MERGE_MESSAGE`
(the second PUT defaults to 200, `_sandbox_boot_helpers.mjs` 235), and the readers the legs
need already exist — `commitStates`, `foldUnits`, `mergePuts`, `indicesOf(ctx, isMergePut)`,
`indicesOf(ctx, isCheckRead)`, `indicesOf(ctx, isPullGet)`, `curlCalls`, `checkUrlFor`,
`attemptOf(ctx, 2, leg)` (its `pushedHead`), `phaseOf`, `whyFold`. The rig's second fold pushes a
head distinct from the first (`attemptOf(ctx, 2).pushedHead` is what leg (g) already reads),
so M2's "not the head the first PUT named" is an inequality the leg can assert against
`mergePuts(ctx)[0].sha`. Five boots are added (two strict bodies, two case variants, and the
reworded other-reason boot is not new); each is a memoized boot of the same rig and the file
stays one process — #768 made this sim run in under a minute by deleting nested sims, and
this task adds none.

*The other file that names the rule.* `fleet/CONTRACT.md` 223–239 (the `- merge:` bullet)
says "The merge is retried exactly once, and only for a moved tip: a 405 whose `message` says
the pull request is not mergeable means the target moved between the fold and the PUT"; it is
reworded to name the three bodies (M6). `git grep -i 'not mergeable'` at BASE hits, in full:
`fleet/CONTRACT.md:231`, `fleet/sandbox-boot.sh:187, 1625, 1654, 1667` (three comments and
the arm), `fleet/tests/test_sandbox_boot_merge.mjs:686, 828, 1300` (the M7 comment, the
`NOT_MERGEABLE` knob, leg (g)'s title), `fleet/tests/test_sandbox_boot_selfmerge.mjs:469` (its
`retry` case — a body this task keeps matching, so that file is unchanged), and three prose
mentions in `tests/fixtures/plans/2026-09-07/2026-09-07-publish-decisions-as-events.md` (a
compiler fixture describing a past plan; not a pin of this behaviour, untouched).
`fleet/RUNBOOK.md` does not state the rule (no `405`, `mergeable` or `second fold` in it) and is
untouched. `tests/test_docs_agree_with_code.py` reads `fleet/CONTRACT.md` for its literals (the
unit, the tags, the engine directory, the VM name) and checks the four operator documents
structurally; the merge bullet's wording is free, so the rewording keeps that test green, and
the task's own `Run:` runs it.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`
- Legs: (a) a boot whose first PUT answers 405 with `Base branch was modified`: the evidence
  commits deep-equal `['running', 'publishing', 'running', 'publishing', 'done']`, the fold
  units deep-equal `[FOLD_UNIT_1, FOLD_UNIT_2]`, a `--force-with-lease` push is in the stream,
  exactly two PUTs were recorded, and the phase includes `merged` [M1]; and in the same boot the
  first check-runs GET after the first PUT names `checkUrlFor(attemptOf(ctx, 2).pushedHead)`,
  that `pushedHead` differs from the first PUT's `sha`, and a `GET /pulls` read sits between
  that GET and the second PUT [M2]. (b) the same assertions, for a boot whose first PUT answers
  405 with `Required status check "test" is expected.` [M1] [M2]. (c) a boot whose first PUT
  answers 405 with `base branch was modified` (all lowercase): two PUTs, two fold units, phase
  includes `merged` [M3]. (d) a boot whose first PUT answers 405 with
  `2 of 2 REQUIRED STATUS CHECKS are expected.`: two PUTs, two fold units, phase includes
  `merged` [M3]. (e) a boot whose first PUT answers 405 with
  `At least 1 approving review is required by reviewers with write access.`: exactly one PUT,
  fold units deep-equal `[FOLD_UNIT_1]`, the phase includes `left open: merge PUT answered 405`
  and does not include `twice` [M4]. (f) the file's existing scenario titled
  `a 405 saying "not mergeable" buys one more fold, one leased push and one more PUT` passes
  with its assertions as they stand at BASE, including its `checkUrlFor(second.pushedHead)`
  read [M5].
- Run: `node fleet/tests/test_sandbox_boot_merge.mjs 2>&1 | grep -q 'ALL TESTS PASSED'`
- Run: `sed -n '/^  - merge:/,/^  - record:/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -qi 'not mergeable'`
- Run: `sed -n '/^  - merge:/,/^  - record:/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -qi 'base branch was modified'`
- Run: `sed -n '/^  - merge:/,/^  - record:/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -qi 'required status check'`
- Run: `python3 -m pytest -q tests/test_docs_agree_with_code.py`
- Legs (continued): the sim's sentinel line is (a)–(f) executed [M1] [M2] [M3] [M4] [M5]; the
  three scoped greps over the merge bullet, one per body, and the docs test are [M6].

**Stale-if:**
- issue-closed: #784
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/test_sandbox_boot_merge.mjs`
