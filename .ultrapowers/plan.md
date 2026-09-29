# The self-merge waits for GitHub to see the head it pushed

**Grammar:** claims-v1
**Claim:** After a run catches up to a newer main, its first merge request goes through, and every merge attempt's record says what GitHub answered. (elicited)
**Summary:** When a run has to catch up to a newer main, it pushes a new commit and immediately asks GitHub to merge, before GitHub has caught up to that push, so the first request is refused and a retry is spent (both live catch-ups did this, runs 264 and 265, n=2). This makes the run wait until GitHub shows the commit it just pushed before asking, and records GitHub's own reply on every merge attempt, so the next oddity arrives with its reason attached. You get catch-ups that merge on the first request and keep their full retry budget for a main that really moved again, plus a record that explains itself.

**Goal:** In `factory/boot.sh`'s self-merge, trust `mergeable` only once the PR's `head.sha` is the commit the boot pushed, and write GitHub's reply `message` on every `merge` row.
**Tech Stack:** Bash (the boot), Node (the boot sim)
**Spec:** none — runs 264 and 265 (`refold ok=true`, `merge code=405`, `merge code=200`); operator, 2026-09-29

## Global Constraints

- The merge budget (`max_refolds`), the mergeable wait window (`SELF_MERGE_WAIT_SECONDS`) and the refold path keep their meaning; a head that never shows within the window ends the wait as it does today.
- Check: python3 -m pytest -q tests/test_fleet_suite.py -k "test_factory_publish or test_factory_record or test_flock_scope"

### Task 1: Wait for the pushed head, and record GitHub's reply

**Type:** implementation

**Files:**
- Modify: `factory/boot.sh`
- Modify: `fleet/tests/_boot_helpers.mjs`
- Modify: `fleet/tests/test_factory_boot.mjs`

**Claim:** After a run catches up to a newer main, its first merge request goes through, and every merge attempt's record says what GitHub answered. (derived)
Machine: M1. `maybe_self_merge` reads `mergeable` from the PR reply only when that reply's `head.sha` equals `git rev-parse HEAD` of the target, the commit the boot pushed; a reply naming any other head is waited out like a `null` mergeable, within the same window. In the boot sim's new stale-head case, where the stubbed `GET …/pulls/7` answers a stale `head.sha` first and the pushed head after, and the stubbed `PUT …/pulls/7/merge` answers 405 until a GET has reported the pushed head, the run's `events.jsonl` holds exactly one `merge` row, with `code` 200. M2. Every `merge` row carries `message`, the `message` field of GitHub's reply to that PUT: in that case, the stub's 200 reply message `Pull Request successfully merged`.

**Authorized-by:** runs 264 and 265 (`ultra/evidence/run-264`, `run-265` `events.jsonl`); operator, 2026-09-29 (right signal + record the reply)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** On both live catch-ups (runs 264 and 265, 2026-09-29, n=2) the events read `refold ok=true`, then `merge code=405` about 2 s later, then `merge code=200` about 4 s after that. Only the code is recorded, not GitHub's reply, so the cause is inferred. `refold_onto` force-pushes the caught-up head, and the loop's very next `GET …/pulls/<n>` reads a non-null `mergeable` that GitHub computed for the old head, so the PUT goes out before GitHub has processed the push.

In `maybe_self_merge`, compute `head_sha` (today set after the poll) before the poll and compare it with the reply's `head.sha`. `head.sha` is nested, and the reply also carries `base.sha` and `merge_commit_sha`, so read it with a real JSON parse (the boot already runs `fleet_node`), not the first-match `json_field`. Add `message=<GitHub's reply message>` to the existing `event_row … merge code=…` line; an empty or unparsable reply writes an empty message.

The rig's `curl` stub (`_boot_helpers.mjs`, `/pulls/7` GET) today answers `{"mergeable":true}` with no head. The default must now answer `head.sha` equal to the sim origin's current tip of the run's integration branch, so the existing cases keep passing. The `PUT` reply gains `"message":"Pull Request successfully merged"`.

Add one case to `test_factory_boot.mjs`: the stale-head case. The GET answers `{"mergeable":true,"head":{"sha":"<40 zeros>"}}` on its first call and the pushed tip after that. The PUT answers 405 with `{"message":"Pull Request is not mergeable"}` until a GET has reported the pushed tip, then 200. Assert exactly one `merge` row, `code` 200, `message` `Pull Request successfully merged`. At base this case yields two merge rows (405, then 200).

**Proof:**
- Run: python3 -m pytest -q tests/test_fleet_suite.py -k test_factory_boot [M1, M2]
- Run: bash -n factory/boot.sh
- Legs: (a) the stale-head case records exactly one `merge` row with code 200: the PUT waited for the pushed head [M1]; (b) that row's `message` is the stub's `Pull Request successfully merged` [M2].

**Stale-if:**
- path-absent: `fleet/tests/test_factory_boot.mjs`
