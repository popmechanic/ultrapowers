# 0003. The Flock engine

Status: accepted (2026-11-21)  
Governs: `factory/flock/compact_record.mjs`, `factory/flock/engine.mjs`, `factory/flock/flock_board.mjs`, `factory/flock/io.mjs`, `factory/flock/loose_ends.mjs`, `factory/flock/nogit/git`, `factory/flock/plan.mjs`, `factory/flock/provenance.mjs`, `factory/flock/pulls.mjs`, `factory/flock/scope.mjs`, `factory/flock/step_receipts.mjs`, `factory/jev-client.mjs`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Flock follow main

- **openConflict** — When main and a builder each create the same path apart, the kernel marks the merge adds-only and the union is two whole files one after the other; no probe of the run speaks for main's version. openConflict in factory/flock/engine.mjs therefore opens a conflict (created: both) instead of accepting the union, and a builder makes one file (flock-baseline run-24, 2026-11-13: closed in 20 s, ready).
- **absorbMain** — A run follows the target's default branch: a look before its first builder opens, one every MAIN_POLL_MS and one before a green settle. A move publishes main's stored weaves into the run as the peer main (keeper op main), so every copy takes the text in through its normal pulls, a clash is an ordinary conflict with builders alive to resolve it, and the run's base moves to the tip (scope rule, ULTRA_BASE, each copy's git index and the landing commit). Non-text files are copied as on main. Nothing here fails a run: a move that cannot be taken in ends the following with a main:off row, and the publish's catch-up still meets the moved main.
- **absorbMain** — absorbMain in factory/flock/engine.mjs chains each look at main onto the edge chain, so no edge is copying the base while it is replaced; it answers true when the base moved and the caller then asks for an edge.
- **absorb** — absorb in factory/flock/engine.mjs writes the moved base beside the old one (BASE_DIR.next) and asks the keeper to take main in before replacing anything, so a refused move leaves the run on its old base intact.
- **absorb** — When main moves mid-run, factory/flock/engine.mjs writes the new tip to $RUN_DIR/base; factory/boot.sh reads that file to publish against the moved base.
- **mainWatcher** — mainWatcher in factory/flock/engine.mjs schedules the next look at main by the clock and waits in 500 ms sleeps so an ended run is not kept waiting. Counting sleeps ran late because each one stretches while an edge's tests hold the event loop (flock-baseline run-12, 2026-11-13: the 60 s look had not come by 72.6 s).
- **absorbMain** — factory/flock/engine.mjs looks at main once before the first builder opens, so a run launched behind main starts every copy from the current main (run-12 started one commit behind and met it only at the end).

## Flock settle rules

- **settle** — Settle rule S1 in factory/flock/engine.mjs (nothing can change the code any more) treats a claimed task as work in progress even before its session goes live: on atlas AE5 a resolve task claimed 0.5 s after it was added read as a deadlock and the run ended a draft on green code.
- **settle** — settle in factory/flock/engine.mjs settles as soon as the last tested hash is green and nothing was published after it, since nothing can change the code and the debounce buys nothing; the debounce (2x p90 edge latency, at least 1 s) still guards an untested publish.
- **settle** — When the run-wide check is red with every task's facts green, settle in factory/flock/engine.mjs posts a stall and opens a C:check task for it; otherwise nobody is told and the run waits for its clock.
- **settle** — When the edge is red or blocked and every lever (reopen, resolve task, check task) is spent, settle in factory/flock/engine.mjs ends the run a draft at once with the beliefs attached, since waiting for the clock buys nothing.
- **summary.outcome** — The terminal outcome in factory/flock/engine.mjs is ready only from a settled green hash; anything else is a draft with stalls, open conflicts and the last edge attached, so the operator reads what the swarm believed rather than a transcript.

## Flock stall limits

- **MAX_RELEASE** — A task a builder gives back returns to the ready list; uncapped, ultrapowers run-252 (2026-09-27) saw one unfixable check task claimed and released about 1,150 times over a 3.8 h clock, costing $80.57. factory/flock/engine.mjs therefore parks a task after MAX_RELEASE=3 give-backs: it leaves the ready list, a stall is posted, and settling ends the run as a draft.
- **STALL_MIN** — A run whose best-green count has not risen for STALL_MIN minutes (policy cell flock.stall.minutes, default 20) ends a draft and interrupts every live session instead of running to its clock. Over 7 runs the longest wait for a rise was 2.0 min, while run-252 ran 229.7 min past its last rise; over 110 runs the stop never fired. Lives in factory/flock/engine.mjs settle().
- **lastSessionEnd** — The no-progress stop in factory/flock/engine.mjs settle() fires only when a builder session has ended since the best-green count last rose (lastSessionEnd > lastRise), so one long-running session that is still working is never cut off by the stall limit.
- **giveBack** — In factory/flock/engine.mjs every give-back, from a scripted or a model session, goes through giveBack, so the MAX_RELEASE cap applies to all of them. A scripted session writes its task's scripted files, then takes the done path (syncFromDisk, publish, board done); a task the script does not name ends released.
- **settle** — The L:loose cleanup task adds no facts, so the green count cannot rise during it; settle in factory/flock/engine.mjs restarts the no-progress window when it opens the task (#1531) rather than leaving it the rest of the window begun at the first green.

## Flock scripted builder

- **BUILDER / SCRIPT** — factory/flock/engine.mjs takes --builder sdk (a Claude Agent SDK session per claim, the default) or --builder scripted:<json>, which runs no model. The scripted JSON maps a task id to {path: text}; the session writes those files and finishes as a done call would, so the fleet sims exercise the whole engine without tokens.
- **scriptedSession** — The scripted builder in factory/flock/engine.mjs accepts @hold_ms (a number for every task, or a map by task) that holds the session before it writes, standing in for a model builder that makes no progress (#1334); the no-progress stop cuts it short and it ends writing nothing.
- **scriptedSession** — After a hold, a scripted session in factory/flock/engine.mjs pulls what its peers published meanwhile, as a model builder's pull after each tool batch would, so its write can land over a peer's lines and exercise peer:rewrite recording (#1401).
- **scriptedSession** — The scripted builder's @unwritten seam in factory/flock/engine.mjs puts text into the weave that no builder wrote (no edited() call and no task), standing in for a weave fault like run-247's, so the sims can prove the scope rule fails the edge on lines no task wrote (#1333).

## Pull scope

- **pullInto** — Every published change reaches every copy, whatever the builder's task, because a task's facts run on the whole copy. On flock-baseline run-10 (2026-11-13) a narrow pull starved task 7's builder of atlas/geo.py, written by an indirect dependency: the task was given back three times over 22 minutes and the run drafted. pullInto in factory/flock/engine.mjs lets the scope (pulls.mjs) narrow only what a builder is told; a change outside it lands silently and is told, with its conflict mark, once the path comes into scope.
- **pullInto** — pullInto in factory/flock/engine.mjs always tells a builder about files its peers created that are not at base (#1405): a new file carries no lines of the builder's to conflict with, so telling it costs nothing and lets the builder use the new file.
- **pullInto** — When changes to a path accumulate untold in pullInto (factory/flock/engine.mjs), a conflict mark is kept until the builder is told of the path, whatever later change arrives without one, so a builder never misses that a quiet path merged with conflict marks.
- **wait_for** — wait_for in factory/flock/engine.mjs marks a proof wait for re-running whenever any change reached the copy, including quiet ones the builder was not told of, because a quiet change still changes what its facts read.

## Run provenance

- **buildProvenance** — A run's provenance (#1404, factory/flock/provenance.mjs) records only what no other source holds: git has the text and the plan has each task's Files and Claim, so neither is copied. buildProvenance({landed, blame, events, lost}) is pure and names which task wrote every changed line of the landed snapshot (from the weave's blame labels: base, A.2, labels joined | for identical text, or a no-dot label for no task) plus the exceptions: contested, lost, ordered and foreign lines. The final empty line of a newline-terminated text is not a hunk line.
- **buildProvenance** — buildProvenance in factory/flock/provenance.mjs reports a peer:rewrite row as contested only when every after line is among lines the weave blames on the writer's own label (agent.task), so a rewrite that did not land is not reported.
- **remapProvenance** — When factory/flock/catchup.mjs catches a run up to a moved main, remapProvenance in factory/flock/provenance.mjs carries every line span of a changed path line by line through the longest common subsequence of the run's and the caught-up texts. Unmatched lines drop, the survivors are cut back into runs, an entry with no surviving lines disappears, and a path absent in the caught-up commit loses all its entries; other paths are kept.
- **lineMap** — lineMap in factory/flock/provenance.mjs computes the longest-common-subsequence line map with Myers' diff and its middle snake, so memory stays linear in the two lengths and time is O((n+m)·D), safe on large files.

## Conflict ledger

- **ledger / region** — Manyana recomputes conflicts on every merge and stores none, so factory/flock/engine.mjs keeps a conflict ledger: a conflict opens when a merge flags it and closes only when an agent says so (resolve_conflict), or at once when both sides only added lines (the union). Entries are keyed by path and region, a hash of the marked hunks' two sides sorted so a pull's merge and the edge's name the same region; Manyana re-flags a region on every merge, but a closed region stays closed and only a different region on the same path opens a new entry.
- **edge** — Facts on a snapshot hash never change, but what blocks it does (a conflict can close with no text change). edge() in factory/flock/engine.mjs therefore recomputes the verdict from the ledger for a repeated hash; a cached blocking answer was wrong after 5 of 9 closes on the record, masked each time by a later content change.
- **session** — When a resolve task (R:<path>) ends done, session() in factory/flock/engine.mjs closes the path's open regions even if the resolver changed nothing, because the merged text often already says what both meant (run n1: 2 of 2 attempts).

## Flock board

- **Board** — factory/flock/flock_board.mjs is the Flock's board: in memory, with the verbs of an issue board (ready, claim, release, park, done, reopen, beliefs, read, add task) and no service behind it. Its moves are recorded as rows in events.jsonl by the engine; the kata hub was removed on 2026-11-13.
- **rotate** — rotate in factory/flock/flock_board.mjs starts each claimer's walk of the ready list at an offset hashed from its name, so N claimers do not all race for the first row.
- **chainLengths** — To shorten the final race (on atlas, tasks 1, 4 and 10 head chains of 3), the Board in factory/flock/flock_board.mjs offers ready tasks by their remaining chain, the longest run of dependent tasks from the task to the end, longest first, keeping each claimer's rotation only among equals. A task added later (a resolve or check task) has no consumers and counts 1.

## Weave protocol

- **scopeAt** — The weave reads an empty file as absent, so scopeAt in factory/flock/engine.mjs compares an empty base file as absent too; otherwise an empty file at base would read as changed on every snapshot.
- **edge** — edge() in factory/flock/engine.mjs takes the survival list (lines a published copy's author wrote that the snapshot no longer shows) from the same keeper merged answer that named the snapshot, because a later ask could describe a later join.
- **factory/flock/io.mjs startWeave** — factory/flock/io.mjs startWeave talks to the weave keeper (factory/flock/weave.py) as one JSON request and one JSON answer per line, strictly in order, so answers are matched to requests by position. Once the keeper exits, every pending and later send rejects instead of hanging.

## Weave store

- **RUN_NO** — factory/flock/engine.mjs derives RUN_NO from ULTRAPOWERS_FLEET_RUN (run-312 gives 312) because lines the run stores in main's weave memory (weave_store.py, keeper op store) are authored @r<N>:<task>. That author string is how later runs and the catch-up attribute stored lines to the run and task that wrote them.
- **MEMORY** — The run's weaves begin from main's stored weave memory (keeper op memory). If the store cannot be read, factory/flock/engine.mjs begins them from the base's text, records the reason on the weave:memory row, and the run does not follow main (followMain returns without MEMORY); it never fails the run.
- **storeEntry** — storeEntry in factory/flock/engine.mjs stores the landed commit's entry in main's weave memory (keeper op store), authored by this run's tasks; factory/publish.mjs pushes it before the merge request. A join that is not the landed text (a draft that fell back to an earlier snapshot) stores nothing, and the next reader replays that commit instead.

## Builder tools

- **wait_for** — Peers' work reaches a builder's copy only between tool calls, so a shell sleep loop never sees it arrive (a full 300 s in 4 of 10 ledger runs). The wait_for tool in factory/flock/engine.mjs keeps merging peers into the copy while it waits and returns as soon as the fact holds, and the system prompt forbids shell polling.
- **delete_file** — Builders may not delete an existing file from the shell (the PreToolUse hook refuses rm, mv and overwrites), so on run-262 (2026-09-29) a plan that deletes files parked. The delete_file tool in factory/flock/engine.mjs removes the file from the copy and syncFromDisk records the delete in the weave as a rewrite with null content, like any other change.

## Builders never run git

- **NOGIT** — Agents never run git (#1443). factory/flock/engine.mjs puts factory/flock/nogit (a git that refuses) first on every builder session's PATH, so git is refused however it is reached: a script, a test or a Makefile. The engine's own facts, check and setup keep the real git via RUN_ENV.
- **PreToolUse hook** — The nogit PATH shim cannot catch a git named by absolute path (/usr/bin/git), so the PreToolUse hook in factory/flock/engine.mjs also denies any Bash command naming an absolute .../git binary. fleet/tests/test_factory_nogit.mjs extracts and exercises that regex.

## Engine git on target

- **gitCopy** — gitCopy in factory/flock/engine.mjs makes each copy (each builder's and the edge's) a git repository at the current base whose objects are borrowed from the target via alternates. Plans prescribe probes like `git diff --quiet $ULTRA_BASE -- <file>`; in a plain folder those exited non-zero and the check task could never go green (run-252, 2026-09-27). The weave never sees .git (SKIP).
- **writeBase** — writeBase in factory/flock/engine.mjs checks the target's tree at the base out into BASE_DIR with read-tree through a scratch GIT_INDEX_FILE, so the target's own index and working tree are untouched, it costs one process, and file modes and symlinks come out as the tree has them.

## Flock step receipts

- **stepReceipts (factory/flock/step_receipts.mjs)** — factory/flock/step_receipts.mjs keeps one receipt per story-step checker result, green or red, in clause order with the store diff cut to 50 entries. A result with no diff (the step stopped before the checker read the store) keeps its row with diff:null, so a checked step never goes missing from the PR.
- **latestResults (factory/flock/step_receipts.mjs)** — latestResults in factory/flock/step_receipts.mjs picks one checker result per clause from a checks/ folder: the edge's own `<clause>@edge.json` when present, otherwise the newest by mtime across all copies.

## Jev client

- **makeJevClient** — factory/jev-client.mjs is the one Jev (TypeSafe System One) client: one POST to /v1/systemone that never throws and never retries. A 401, 422, 429, 529, timeout, dead socket or non-JSON body each costs one log line and resolves null, so the caller's row is simply absent; Jev answers no fact, so nothing downstream is entitled to an answer. It sends no key of its own: callers off the fleet (the laptop's authoring checks against api.typesafe.ai) pass headers, and fetchImpl is injected so sims never open a socket.
- **JEV_STATE_MAX_BYTES** — factory/jev-client.mjs caps a call's state at JEV_STATE_MAX_BYTES (120,000 bytes of its JSON, about the 32k-token budget #1096 names) and checks it before any request: an over-budget state is a caller's bug, costs one log line and makes no call.

## Landing empty

- **land** — A run whose settled green snapshot equals the base exits 1 from land in factory/flock/engine.mjs and commits nothing, because a claims-v1 probe already green at the base proves nothing (#1522).

## Loose ends

- **postBelief** — postBelief in factory/flock/engine.mjs keeps a builder's belief on the board and as a belief row, with about naming task, app or engine. A loose end also names a path and, when known, its stale text, held to its first 300 characters so the PR body can carry it (#1529); a prefix still answers the loose-end reading's "does the file still contain it".
- **terminal** — terminal in factory/flock/engine.mjs turns any draft that happens after the L:loose task was added into a ready landing of the green snapshot from before it (#1521), once: the cleanup is dropped rather than letting optional loose-end work cost a green run.

## Same anchor insertions

- **sameSpot** — When two agents insert at one spot, the kernel orders the lines by their text and an adds-only union hid it. The keeper flags such spots (siblings, or unified when one side's block starts with the other's line and the kernel flags nothing), and sameSpot in factory/flock/engine.mjs turns each distinct spot into a board fact and a note to the agents whose copies carry it.
- **settle** — The merge orders two insertions at one spot by their text, which no builder chose, so settle in factory/flock/engine.mjs tells a task reopened red of each such spot in its files (flock-baseline run-10: tasks 12 and 13 each added one rule to a list, the merge put them in alphabetical order and both went red).

## Scope rule

- **scopeAt** — scopeAt in factory/flock/engine.mjs applies the scope rule (scope.mjs) to the snapshot against BASE_DIR before any fact or check runs and writes build output, so generated files never count as changes. It answers the changed paths outside every task's Files that no builder wrote, which fail the edge; paths a builder wrote outside its Files are recorded once as amendment rows.
- **PostToolUse hook** — The PostToolUse hook in factory/flock/engine.mjs marks an edit outside the editing task's own Files (a resolve task R:<path> owns its path) as outside on the edit row. Such a change is an amendment the scope rule records; nothing reverts it for being outside the plan (#990).

## Shared deps install

- **DEPS_DIR / linkDeps** — A workload with setup installs once into DEPS_DIR, and every copy factory/flock/engine.mjs makes (each builder's, the edge's) gets that install's node_modules directories as symlinks. The weave never sees them (walk skips node_modules) and no copy pays a second install.
- **LOCK_CMD** — The plan's own setup wins; without one, factory/flock/engine.mjs picks the install from the target's tracked lockfile: bun.lock or bun.lockb gives `bun install --frozen-lockfile`, package-lock.json gives `npm ci`. On runroom-ab run-3 nothing was installed and the check exited 127 on every edge.

## Builder objection

- **objectTo** — A builder whose task cannot be satisfied as written by any code (two clauses that cannot both hold, or a proof nothing can pass) calls object. objectTo in factory/flock/engine.mjs parks the task at once and, when nothing else is left, the run ends a draft naming the objection. A give-back would hand the task to the next builder who meets the same wall: on flock-baseline run-32 (2026-11-13) the task was given back three times in 24 s and the run ended deadlock without the reason.

## Compact record

- **BASE_FILES_0** — In factory/flock/engine.mjs BASE_PATHS and BASE_FILES move with the base when main moves mid-run, but BASE_FILES_0 stays the text at --base because it is the start of the compact record's patch chain (snapshots.jsonl written by compactRecord).

## Conflict early close

- **earlyClose** — On atlas every resolve task changed nothing (n=5 runs) and about 25 s went to handing them out once everyone was idle. earlyClose in factory/flock/engine.mjs closes an open conflict on path p at an edge when some agent S published p, S's last edit to p came after a peer's side last reached S with conflict marks, and S's published p is byte for byte the merged text, i.e. S wrote over both sides with both in view. A conflict seen first in one copy's pull also waits for that copy's next publish. Manyana no longer marking the region (unflagged) is evidence only, since it stops marking a blind conflict once one side pulls and republishes.

## Evidence record format

- **factory/flock/compact_record.mjs compactRecord PATCH_LIMIT** — The Flock's run record (factory/flock/compact_record.mjs, compactRecord) stores each tested snapshot as a unified diff against the previous tested snapshot (base for the first) that git apply accepts, plus the weave ops with file texts reduced to fingerprints; no file text is copied whole, and a snapshot is replayed by applying patches in order onto base. PATCH_LIMIT caps all patches at 512 KB, about ten times the largest changed text measured (54,027 bytes, n=2 runs, 2026-09-28); rows past the cap carry patch null and truncated true.

## Flock builder pool

- **CAP** — After the round-3 arm (n=3 runs, 2026-09-26) the engine in factory/flock/engine.mjs has one behaviour: an elastic builder pool that opens a builder whenever a ready task has no free builder, up to CAP=16, where an idle builder holds no session and costs no tokens. Builders publish when they call publish, at done and at session end; the run settles as soon as the last tested hash is green with nothing published after it; done closes the copy to edits; builder tools load up front; every Bash command runs with stdin closed. Switches no launch set were removed; the way back is a checkout before the cut.

## Flock builder sandbox

- **factory/flock/nogit/git** — Flock builder agents never run git: factory/flock/engine.mjs puts factory/flock/nogit first on every builder's PATH, whose git script prints 'git: agents never run git' and exits 1. The engine and weave own all version control.

## Flock engine shape

- **factory/flock/engine.mjs** — The Flock engine in factory/flock/engine.mjs is plain code, not a model: it seeds the board from the plan, runs one builder session per claim on its own copy, keeps every copy's weave, merges peers after each tool batch and tests every published snapshot at the edge. Builders pull their own work from the board and never run git. A run leaves the target exactly one commit ahead of --base and writes events.jsonl, which the pull request card reads.

## Flock exam timeouts

- **factory/flock/io.mjs EXAM_MS** — factory/flock/io.mjs EXAM_MS holds one time limit per fact and one for the plan's setup, read by both the engine run and its catch-up (#1448), so a fact that timed out red during the run cannot pass at catch-up under a looser limit.

## Flock loose ends

- **looseEnds (factory/flock/loose_ends.mjs)** — looseEnds in factory/flock/loose_ends.mjs classifies each builder-reported loose end (a belief naming a path, optionally with stale text) as open, resolved or unchecked. It is pure: the caller's text(path) returns file content, null when the file does not exist in that snapshot, or undefined when the path exists neither at the run's base nor in the snapshot; undefined makes the loose end unchecked.

## Flock pull scope

- **factory/flock/pulls.mjs pullScope** — Every peer change a builder pulls lands in its copy whatever the scope, because a copy is a whole tree and its facts run on all of it (holding changes back left a builder without a needed file on flock-baseline run-10, 2026-11-13). pullScope in factory/flock/pulls.mjs only decides what the builder is told of: the task's own files, its dependencies' files, the paths it has touched, and files peers created that were absent at base, which can never conflict. The scope was settled 2026-11-14 over 72 narrow runs; telling of every change (`all`) was cut, and an out-of-scope change is told once its path comes into scope.

## Flock settled experiments

- **MAIN_POLL_MS** — On 2026-11-14 the operator settled the Flock's experiments over n=110 runs (2026-09-26..11-15), keeping one behaviour each and cutting unused modes (rollback: a checkout before the cut): a builder is told only of peer changes its work touches (pulls.mjs, 72 runs, 146 changes held quiet); a change outside every task's Files that no builder wrote fails the edge (scope.mjs, 0 refusals); loose ends become the task L:loose at the first green (7 runs); a builder may object to an unsatisfiable plan (2 objections); and the run follows main as a peer from main's stored weave (13 moves, no clash drafted). The main poll interval is --main-poll, else policy cell flock.main.poll_seconds, else 60 s.

## Past run brief

- **PAST** — When a run follows a run on the same repository that did not finish green, factory/boot.sh extracts that run's evidence folder and passes --past-dir <dir> (basename is the run number). factory/flock/engine.mjs reads its status, events and red checks (pastItems) and briefs every builder with them; any read failure is logged once and leaves the brief unchanged.

## Peer note

- **PostToolUse hook** — On every Read, the PostToolUse hook in factory/flock/engine.mjs asks the weave for the file's authors and returns a peer note (peer_note.mjs), so a builder learns whose lines a file holds before it edits a peer's lines.

## Peer rewrite record

- **peerRewrites** — factory/flock/engine.mjs writes one peer:rewrite row per sub-edit that changes a peer's lines (the weave's peerRewrites answer); it is a record-only fact. The Jev read of each rewrite, and drafting on a loses answer, were cut on 2026-11-14: over 110 runs it drafted 4 green runs, two merged by hand, and caught no lost line.

## Plan parser grammar

- **factory/flock/plan.mjs parsedPlan** — The sandbox boot parses the plan once and writes the parser's JSON (planJson, #1449); parsedPlan in factory/flock/plan.mjs reads that file when given so the whole run works from one parse. Only a hand run or a sim, with no planJson, runs skills/ultrapowers/scripts/plan_parse.py over the plan path itself.

## Plan scope rule

- **factory/flock/scope.mjs scopeOf** — factory/flock/scope.mjs `scopeOf` classifies a snapshot's changed paths: a path named in some task's Files is in scope; one a builder wrote in its copy is an amendment (allowed in the open, per the plan-is-a-submission doctrine); any other is `outside`, and a Flock run refuses to settle while `outside` is non-empty.

## Run clock

- **CLOCK_MS** — The engine's default clock (CLOCK_MS, --clock 13800 seconds) in factory/flock/engine.mjs sits under the 14400 s RuntimeMaxSec of the transient unit factory/boot.sh runs it in, so the engine ends and lands its commit before systemd kills it.

## Session lifecycle

- **session** — A run can end (outcome set) after query() starts a builder session but before its interrupt is registered in stops, so session() in factory/flock/engine.mjs checks outcome again right after registering and interrupts at once; otherwise that session would outlive the stop.

## Ultra base env

- **RUN_ENV.ULTRA_BASE** — Every fact, the run-wide check and the setup in factory/flock/engine.mjs run with ULTRA_BASE set to the commit the run is judged against, so plan probes like `git diff --quiet $ULTRA_BASE -- <file>` read the right base. When main moves mid-run, ULTRA_BASE moves with it.

## Weave authorship label

- **task_label** — The weave's authorship label (task_label in factory/flock/engine.mjs, mirroring weave.py) is agent.task, e.g. A.2 for builder A on task 2. Because the task is part of the label, a reused builder's later task meets its earlier task's lines as a peer's; consumers take a label's task as the text after the dot.

## Weave non text files

- **isText** — The weave merges text line by line, so factory/flock/engine.mjs never hands it a file that is not UTF-8 (an image, a .gz): such a file stays exactly as it is at base in every copy and the edge, and a builder's change to one is recorded (non-text row), never merged. On run-246 a GIF in the target stopped the weave's base op with a UnicodeDecodeError before any builder opened.
- **syncFromDisk non-text** — factory/flock/engine.mjs `syncFromDisk` checks every known path with `isText` before reading it, not only the paths `walk` lists: a path tracked at base whose bytes stop being UTF-8 during a run is skipped and recorded (non-text row), so the weave keeps its last text version and the run's commit holds it unchanged; a path missing from disk, or replaced by a directory, is still a deletion (only a regular file that is not UTF-8 is skipped). Before, such a path was read lossily and rewritten (fallback row), landing U+FFFD bytes (#1610).

## Ignored files stay in their copy

- **ignoredIn** — factory/flock/engine.mjs `syncFromDisk` and the Write/Edit hook ask `git check-ignore` in the builder's own copy, at the moment of the sync, which paths its ignore rules cover (#1608); such a path that is not already in the weave is never taken into it, so it reaches no peer's copy, no events row and not the landed commit, even when the rule is written in the same batch. The copy's index is the run's base, so a file tracked at base still travels when a rule covers it. On popmechanic-potluck-3 run-2 builder B's ignored `server/.celld/dev/objects.sqlite3` was merged line by line with C's and the app failed with `database disk image is malformed`. A path that is in the weave but not at base when a rule comes to cover it, because a peer published it before the rule reached that peer's copy, is dropped from the weave by the first copy whose rules cover it (a fallback row with `ignored` and `deleted`), and `pullInto` writes a pulled `.gitignore` first and then leaves alone any other pulled path those rules cover, so a peer's version never overwrites a copy's own ignored file. `git check-ignore` fails the whole batch (exit 128) when one path lies beyond a symbolic link, such as a file under the linked node_modules; `ignoredIn` never asks about SKIP paths, and on such a failure halves the batch until the failing paths stand alone (one git process per path would block every session on a large tree), remembers them per copy (`unaskable`, an ignore:unread row) and still answers for the rest, because a failed batch read as "nothing is ignored" would switch the rule off for that builder. The check runs with `core.excludesFile=/dev/null`, so only the repository's own `.gitignore` files decide and the machine's global ignore list never drops a file from a run. A pulled path the copy's rules hold back is left out of the note to the builder too. The builder prompt says ignored files reach neither peers nor the copy the facts and the check run on.

## Reads that may fail

- **session** — When a builder session ends in factory/flock/engine.mjs `session`, a session already closed by its `done` call, or one ended because the run itself ended (`outcome` set), gives nothing back: only an objected, released or unfinished task is handed on.
- **readEventRows** — factory/flock/io.mjs `readEventRows` skips a line of `events.jsonl` that does not parse: the file is appended while it is read, so its last line can be torn, and one torn row must not hide every row before it.
- **makeJevClient refuse** — factory/jev-client.mjs logs each refusal as evidence only: a log callback that throws is ignored, so logging never changes the client's answer, which is `null` on anything unexpected.
