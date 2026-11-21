# 0010. The janitor

Status: accepted (2026-11-21)  
Governs: `fleet/janitor.mjs`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Fleet janitor

- **fleet/janitor.mjs** — fleet/janitor.mjs is never scheduled: fleet/launch.mjs runs it before every launch and the operator runs it by hand after the laptop sleeps, so no local process writes run state on a timer. Its full behaviour is specified in fleet/CONTRACT.md §Janitor, and --dry-run issues every read and no write.
- **reapPlan / DEFAULT_AGE** — fleet/janitor.mjs keeps a finished run's VM for DEFAULT_AGE (1h) after its status page's updatedAt so the operator can read the page and ssh in before the reap. reapPlan is pure: an unparseable updatedAt or an unfinished run yields no reap time at all.
- **NEVER_REAP** — In fleet/janitor.mjs a fleet VM whose exe.dev comment contains the case-sensitive substring 'do not reap' is never removed and is reported as kept. This is the operator's hand-placed guard for a VM they want to inspect.
- **ghApi** — fleet/janitor.mjs treats a gh api 404 as an answer, returning null, rather than an error; every reader decides what absence means, and none treats it as permission to reap.
- **readContentsAt** — fleet/janitor.mjs readContentsAt accepts only the GitHub contents-API envelope (base64 under content); any other payload counts as no page, so the janitor never acts on a document it did not actually read. An envelope whose content is not a JSON object still counts as the ref having answered, so the reader does not fall through to the next ref.
- **evidenceReading** — fleet/janitor.mjs reads a run's status.json from the evidence repository at the run tag <slug>/run-<N> first and at the live branch live/<slug>/run-<N> only when the tag answered no envelope, because the tag is the sealed final record. With no evidence repository configured nothing is read.
- **assignmentOf** — fleet/janitor.mjs takes a VM's run number from its exe.dev comment's run= field and falls back to the VM name only when the comment has none, because the VM name says where a run is placed this time, not which run it is.
- **saysNeverReap** — fleet/janitor.mjs checks the raw VM comment string for 'do not reap' rather than parsed key=value fields, since the sentence is prose a person typed; a row that also carries run= and target= is kept all the same.
- **showUnitCommand** — fleet/janitor.mjs sends the systemctl command to a fleet VM as one ssh argv string containing $(id -u), which the VM's shell expands; the janitor never spawns a local shell, so no laptop-side expansion happens.
- **onVm** — fleet/janitor.mjs runs VM commands with ssh -o BatchMode=yes -o ConnectTimeout=15 because the janitor runs before every launch and a powered-off VM must cost a launch at most fifteen seconds, never hang it. The destination is the row's ssh_dest passed as its own argv element.
- **readUnit** — In fleet/janitor.mjs a unit that cannot be read (ssh failure, timeout, empty answer, no ActiveState) is treated as unknown, not dead, and the row proceeds exactly as if the probe had not been made.
- **unitIsDead** — fleet/janitor.mjs counts a fleet-run unit as dead when ActiveState=failed or Result=timeout, because a unit killed by its own runtime budget leaves Result=timeout behind whatever ActiveState it settles into.
- **failRun** — fleet/janitor.mjs failRun rewrites status.json as failed keeping every other cell, writing janitor-journal.txt first so the page transition is the live branch's last commit like the sandbox's own transitions. A refused PUT (409/422) is not retried, because it means the sandbox pushed in between and the next pass reads the fresh record; a successful write is followed by sealRun.
- **janitor** — fleet/janitor.mjs takes the evidence repository from its argument or else the evidence key of ~/.ultrapowers/fleet.json; with neither, every row is reported unread and no VM is reaped, since run state lives only in the evidence repository.
- **janitor never-reap** — fleet/janitor.mjs checks a VM's 'do not reap' comment before parsing it or issuing any read, so such a VM is never aged, never probed over ssh and never removed.
- **janitor unread** — fleet/janitor.mjs never removes a VM whose status page cannot be read (absent at both refs or a failed read); it is reported unread, since there is nothing to decide on or age it by.
- **janitor unit probe** — fleet/janitor.mjs cross-checks a page that claims the run is in flight against its systemd unit only after the run number has passed isRunNumber or isVmName, so nothing unvalidated is spliced into the remote ssh command; the destination is the row's own ssh_dest.
- **janitor deaths** — When fleet/janitor.mjs writes a run's death it does not reap the VM in the same pass; the page now says failed as of now, so the ordinary one-hour rule reaps it later, leaving the operator time to ssh in.
- **janitor** — fleet/janitor.mjs leaves a run alone when its page has no parseable updatedAt: an unrecorded age is unknown, not stale and not reapable.

## Launch duplicate guard

- **janitor runs** — fleet/janitor.mjs returns a runs list of every assigned row, including rows whose record answered nothing, so the launcher's duplicate check reuses it instead of listing the fleet again; unrecorded rows matter because a double launch happens in the seconds before a record exists.
- **liveDuplicatesOf** — fleet/janitor.mjs liveDuplicatesOf identifies a plan by its text's git blob sha (git hash-object --stdin, no -w) and compares it with runs/<slug>/<N>/plan.md fetched from each candidate's live branch into FETCH_HEAD, writing no ref. A failed fetch or rev-parse means the live branch is gone (the run is publishing or published), so that row is not a duplicate.
- **preflight** — fleet/janitor.mjs preflight refuses a launch when the janitor pass failed, because the duplicate guard then has no fleet list to read; the operator can pass --again to launch without the guard.
- **preflight** — fleet/janitor.mjs preflight refuses a launch whose plan is already live on the same target before the run number is read or anything is pushed, since two sandboxes would build one change and open two pull requests. Plan identity is the plan text's git blob sha, never the comment's plan= commit, whose subject carries the run number; a row whose page says the run ended never refuses, and a row with no record yet counts as live.

## Fleet janitor close out

- **closeOutOrphans** — fleet/janitor.mjs closeOutOrphans handles runs no VM carries whose live branch remains and whose page is older than --age: a page still in flight is written failed and sealed, while a page already done, parked or failed is left as the sandbox's last word and only sealed (seen on flock-baseline run 31, 2026-11-13, n=1). Without an evidence repository it reads and writes nothing.
- **closeOutOrphans / carriedNow** — Before closing out an orphaned run, fleet/janitor.mjs lists the fleet again; a run a VM picked up after the pass's first listing is not an orphan and is skipped silently.
- **janitor carried** — fleet/janitor.mjs counts every target#run a VM carries, including never-reap rows, as carried; the orphan close-out only applies to runs no VM carries, so a run on a live or held VM is never sealed by the janitor.

## Integration branch sweep

- **decidingPull** — GitHub's pulls?head= filter matches on head ref name, which survives branch deletion, and fleet run numbers restarted at 1 on 2026-09-04, so one integration branch name can carry several runs' pull requests. fleet/janitor.mjs decidingPull therefore picks the highest-numbered pull request, not list order (read 2026-09-07: ultra/integration-run-32 answered #720 and #463).
- **isClosedUnmerged** — fleet/janitor.mjs deletes an ultra/integration-run-<N> branch only when its highest-numbered pull request is closed with merged_at null; open, merged or absent pull requests keep it. GitHub's pull list rows carry merged_at but no merged boolean, so merged_at is the field read.

## Github contents api

- **ghPut** — The GitHub contents API PUT returns 422 if a sha is sent for a file that does not exist and 422 if it is omitted for one that does; fleet/janitor.mjs ghPut therefore sends sha only when updating an existing file, using the sha read alongside the page.

## Run seal

- **sealRun** — fleet/janitor.mjs sealRun cuts the tag <slug>/run-<N> at the live branch head through GitHub's refs API, reads the tag back to verify it names that sha, and only then deletes the live branch. An 'already exists' answer is accepted and the read-back decides; any refusal keeps the branch and reports the reason.
