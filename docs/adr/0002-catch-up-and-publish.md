# 0002. Catching up and publishing a run

Status: accepted (2026-11-21)  
Governs: `factory/flock/catchup.mjs`, `factory/publish.mjs`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Publish sequence

- **factory/publish.mjs** — factory/publish.mjs opens the run's pull request, self-merges it (catching up to a moved main) and runs any earned deploy. The boot calls it once, after the engine unit exits and never inside the engine, because a scripted publish stage inside the engine killed run-186. It reaches GitHub through `curl` and the target through `git` off PATH so the boot sims' stubs answer it, prints five lines (state, phase, PR url, PR author, merge sha) for the boot, and exits 1 on a refused PR POST so the boot fails the run.
- **factory/publish.mjs publish (base)** — factory/publish.mjs reads the target's default branch from refs/remotes/origin/HEAD and refuses to publish if it is missing, because opening a pull request against a guessed `main` on a repository whose default is `master` is refused by GitHub or, worse, accepted against the wrong branch.
- **factory/publish.mjs publish (draft)** — factory/publish.mjs opens a pull request for every run; when the engine exit is non-zero the PR is opened as a draft, since only a green run self-merges and the merge of anything else is the operator's decision. The engine's exit code is thus the merge decision.
- **factory/publish.mjs publish (found)** — Each run's integration branch (ultra/integration-run-N) belongs to that run alone, so factory/publish.mjs takes the first open pull request whose head is that branch as the run's own when recovering from an unanswered PR request.
- **factory/publish.mjs publish (open/found)** — GitHub can create a pull request while the POST that requested it gets no answer (flock-baseline run-22, 2026-11-13: no answer after 17 s, PR created 8 s in, leaving a ready PR nobody merged). factory/publish.mjs therefore, on any non-2xx reply, looks up the open PR for the run's branch and adopts it; only when there was no answer at all and none is open does it POST once more.

## Flock catchup

- **factory/flock/catchup.mjs** — factory/flock/catchup.mjs catches a finished run up onto a moved main. It expects the target on the run's branch with the run's commit at HEAD and a clean tree. Paths changed on both sides are joined first on main's stored weave (weave_store.py join), else by a weave keeper rebuilt from base/run/main texts; a clean join becomes one commit on --onto that must pass the plan's setup, every task's facts and the run-wide check. The last stdout line is {caughtUp:true,head,onto} with exit 0, or {caughtUp:false,reason:conflict|red,onto} with exit 1, and a conflict or red leaves the run's commit at HEAD.
- **factory/flock/catchup.mjs (store join fallback)** — factory/flock/catchup.mjs joins both-sides paths on main's stored weave first, because it holds the weaves the run and main really wrote and keeps line identity. Any path the store does not decide (never text, or a run whose store could not be read) falls through to a three-text join rebuilt from base, run and main.
- **factory/flock/catchup.mjs exam timeouts (EXAM_MS)** — factory/flock/catchup.mjs runs the plan's setup and facts under the run's own EXAM_MS limits, so a fact that went red on time during the run is red on the caught-up commit too and catch-up cannot turn a timeout green.
- **factory/flock/catchup.mjs (HEAD check after exams)** — After the exams, factory/flock/catchup.mjs checks only that HEAD did not move, not that the tree is clean: exams may leave artifacts in the worktree, and the commit is what the boot pushes.

## Publish self merge

- **factory/publish.mjs publishPolicy** — factory/publish.mjs publishPolicy reads publish.self_merge bounds and publish.probe from factory/policy.json. The self-merge always runs; holding a run is the only way to keep its PR open (settled 2026-11-14 over 62 self-merges in 110 runs). The deploy probe remains an experiment, so a missing or malformed policy cell reads as disabled, and the bounds' defaults (3 catch-ups, 120 s mergeable wait) live only in publishPolicy.
- **factory/publish.mjs selfMerge** — factory/publish.mjs selfMerge, before each merge request and after each 405/409 refusal, refetches the default branch and catches up onto it if it moved; waits out a null `mergeable`, which GitHub returns for a few seconds after a push; then PUTs a squash merge titled from the plan's first heading with the exact SHA this clone pushed. 405/409 repeats up to max_catchups merge requests; any other answer parks the merge.
- **factory/publish.mjs selfMerge (headSha wait)** — GitHub reports `mergeable` for whichever head it last processed, which right after a catch-up force-push is the old head (runs 264/265: 405, then 200). factory/publish.mjs selfMerge therefore accepts a pull request reply only when its head.sha equals the head this clone pushed, waiting out any other head like a null mergeable.

## Fleet edge credentials

- **factory/publish.mjs api** — On the fleet VM, exe.dev's edge injects the GitHub authorization header, so factory/publish.mjs api sends no credential of its own. Each call is one curl with the HTTP status appended as the last output line (-w), and a curl that cannot connect yields no status code at all, which callers treat as 'no answer'.
- **factory/publish.mjs publishProbe run** — Publish deploy/verify/rollback commands run in the target under a timeout (exit 124 like coreutils timeout), with CLOUDFLARE_API_BASE_URL pointing at exe.dev's Cloudflare edge and CLOUDFLARE_API_TOKEN set to a placeholder, because the edge injects the real credential; only the last 4000 bytes of output are kept in publish-<verb>.log.

## Weave protocol

- **weave_store.py join output (files map)** — In the output of weave_store.py join, a decided path missing from the files map means the joined text equals the moved main's own, so factory/flock/catchup.mjs writes nothing over it; a null value means the path is deleted.
- **factory/flock/catchup.mjs settle (weave_store.py settle)** — factory/flock/catchup.mjs stores the caught-up commit's entry in main's weave memory so the publish can push it before the merge request. When some path was decided by the three-text join, that path is not in the joined Memory, so its stored weave would not match the commit; weave_store.py settle refuses the entry as drift and the next reader replays the commit instead.

## Publish probe

- **factory/publish.mjs publishProbe** — factory/publish.mjs publishProbe runs the deploy a self-merge earned (#835), taking the Publish/Verify/Rollback commands from the run's one plan parse (plan.json `publish`), never from the plan text, and rolls back once on a red verify. With no Publish line or with publish.probe.enabled off, the phase stays 'the pull request was merged'; the probe's outcome is never a failure of the run.

## Run record

- **factory/publish.mjs catchup** — After a catch-up, factory/publish.mjs copies only the remapped provenance.json from the run directory into the evidence folder, never events.jsonl, because the evidence copy of events.jsonl carries publish's own rows (publish:pr, merge) that the engine's copy lacks.

## Weave store

- **factory/publish.mjs pushWeave** — factory/publish.mjs pushWeave pushes the stored weave entry (factory/flock/weave_store.py) for the run's commit, and for any catch-up commit, to the target's weave ref before every merge request and never after, so main never shows a tree whose stored weave could arrive late. A failed push only loses this landing's memory; the next reader replays it through the weave.
