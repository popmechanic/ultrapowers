# The Flock: the board and its belief schema (map #1292, ticket 3)

Decided by the operator on 2026-09-25 in a grilling sitting (Pacific evening; the record is UTC 2026-09-26). The questions and picks are listed in *Authoring record* below. This spec is the input for the engine plan through ultrawrite, and nothing in it is built yet. Where a prototype reading grounds a decision it is cited with its `n`; all of them are an `experiment` under the floor.

## Why the schema changed from the prototype

The laptop prototype let an agent post any sentence as a "belief", with its own confidence. It recorded 27 such rows over 17 runs (n=27; 16 runs from 2026-09-25 plus the first ledger run). Read one by one:

| what the agent was saying | n | could code say it? |
|---|---|---|
| my code is shared; here is its shape and behaviour | 15 | the shape yes, the behaviour no |
| I am about to change X; write against the new form | 10 | no: it is intent, not belief |
| merging your change damaged my file; I fixed it | 2 | yes, from line identity |
| my red is caused by your unfinished work | 1 | yes, from line identity on the red output |
| a request to a named peer, inside a belief | 3 | no, and it is chat (#810 rule 1) |

Self-reported confidence ran 0.90–0.97 (median 0.95), and no belief was ever revised. It carried no signal. Half the rows restated facts the host already held.

## 1. Three row types

| row | written by | about | lifetime |
|---|---|---|---|
| **fact** | the host only | a content hash: shared, a proof's exit, a conflict opened or closed, a claim or release, a peer's line edited, blame on a red | permanent |
| **intent** | an agent, about itself | a change it is making ("`Entry.amt` → `Entry.amount`") | expires when the agent shares or releases |
| **belief** | an agent or the host | a claim pinned to lines (§2) | revised, never deleted (rule 3) |

- An author never gives its own confidence.
- There is no request row. An agent that needs something from a peer posts a `more-work` belief ("`monthly_totals` still reads `Entry.amt`"). If admitted, it becomes an unowned task that any agent may claim, including the one that posted it. The chat ban of #810 rule 1 stands.

## 2. The anchor

A belief names:
- `path`;
- the **line keys** of the lines it describes;
- `at`, the snapshot hash it was read at.

The agent gives a line range in its own copy, and the tools layer turns it into keys. No model sees keys or weave state (rule 5).

Line keys are the keeper's identity from ticket 2: a line's parent, side and text, plus its rank among identical siblings. Over 300 trials that key was lost 0 of 17,120 times, and the rank was needed 0 times in 559,220 lines.

A belief is **stale** as soon as any of its keyed lines changes after `at`. Edits elsewhere in the file leave it alone.

## 3. Confidence

- **Code first.** If code can decide the claim, code decides it, and the row is a fact.
- **Otherwise Jev.** Jev reads the claim beside the anchored lines' text and returns a score. The confidence therefore means "the code, as it stands, supports this claim", and it is recorded as `{value, by: code|jev, at}`.

## 4. Staleness and rounds

- **Rounds are driven by snapshots, not a timer.** On every new merged snapshot, the host computes the stale set and re-scores all of it at once, in parallel (about 300 ms a round). It writes a `round` fact `{at, rescored, ms}`. The board is never more than one snapshot behind the code.
- **A stale belief is re-read** by the same question against its lines' new text and re-anchored at the new snapshot. The old score stays in its history.
- **Anchored lines deleted outright** set confidence to 0 by code, with no call.

## 5. What an agent sees

A `board_read` returns a **relevant slice**:
- every task's title, state and owner;
- every live intent;
- the swarm-level beliefs (`more-work`, `stuck`, `converging`);
- the beliefs anchored in files the agent's copy touches or imports, each with its current confidence.

Below the `belief.doubted` cell (starting value 0.5) a belief is listed as **doubted**, not hidden, so a consumer learns that a contract it relied on no longer holds.

Beyond the slice, every agent also gets:
- **The plan's shared context, read-only:** the plan header, `## Global Constraints`, and every sibling task's Claim and `Run:` probes. This retires the CLAUDE.md rule that "a worker sees its own task body and nothing else" for the Flock. The failure it answers is run-192's invented literals (#1149, #1155), which cost runs 193 and 194.
- **Line provenance, by code:**
  - At edit time: "this line was written by B 12 s ago; B intends …".
  - On a red proof: "failing line 41 was written by B".

  It is read from the keyed authorship note, never the text-keyed one, which misattributes 12.3% of BASE lines (ticket 2).
- **A since-BASE outline** of each file the agent touches: the symbols added or changed since BASE and by whom, refreshed on each merge. It replaces the "my interface is published" posts (15 of 27).

## 6. Kinds, readers and consequences

Every kind that needs a judgment is a question in `factory/questions.json` with its reader and rollback. A kind nobody reads in five runs is deleted (rule 3).

| kind | posted by | scored by | reader → consequence | policy cell | rollback |
|---|---|---|---|---|---|
| fact (all of §1) | host | code | settling; agents' context | — | — |
| intent | agent | — | agents' context; the provenance notice at edit time | — | agents post none |
| `contract` | agent | Jev: `contract_holds` | agents' context; below `belief.doubted` it shows as doubted to every importer | `belief.doubted` = 0.5 | shown unscored |
| `more-work` | agent | Jev: `more_work_admit` ("does any task cover this?") | task admission: at or above the cell, a new ready, unowned task | `belief.admit` = 0.8, live | record-only |
| `stuck` (one agent) | host | Jev (#1128's question; 0.8; two readings) | release: the session stops and the task returns to the board, with the belief as its note | `stall.stuck`, record-only | record-only |
| `converging` (swarm) | host | code (no new best fact count), then Jev | a draft PR on an oscillation that comes back after being closed | `stall.converging`, record-only | record-only |

Agents may post only `intent`, `contract` and `more-work`.

The draft questions for `contract_holds` and `more_work_admit` follow `questions.json`'s shape:
- `when`: on post, and on every round that finds the belief stale.
- `state`: `belief.claim` and `belief.lines` (the anchored text), plus, for `more_work_admit`, `tasks[].title` and `tasks[].claim`.
- `calibrated`: false.

`stuck` and `converging` are ticket 5's drafts (`flock/proto/research/settling/questions-stall.json`).

## 7. Map-level decisions

1. **#1292 stays its own map.** #1131 remains the factory's map, and the factory is the Flock's rollback until rule 8. #1131 gets a pointer comment.
2. **Name and label:** the Flock, with the label `flock` ("Map #1292 — the Flock: a leaderless swarm on a persistent weave"). #1292 and its tickets (#359, #1128, #1294) carry it, and #1292 drops the retired `merge-frontier`.
3. **Main as a weave: design now, build second.**
   - Identity, anchors and weave storage are designed to outlive a run, so that main's weave is the next run's BASE and contracts carry across runs.
   - The engine plan's first build is in-run only. Cross-run merging is the map's next committed ticket, not "later".
   - Ticket 2 answered the gating fact. Growth is linear, about 200 bytes per edit. Compaction is a settle-time rebuild that renames every line, so the cross-run design owes a **key remap at compaction**: live lines keep their order and text, so old key → new key is exact for them, and beliefs on dead lines are already at 0.
4. **Publishing: when coherent, and the other shape measured.**
   - An agent calls `publish` when it believes its change hangs together. The host also publishes on session end and on release, so nothing is stranded.
   - Ticket 4's second pass runs a `--publish batch` arm (publish after every tool batch) on the ledger workload, n=3 beside the explicit arm. It reads peer-caused reds, wall and conflicts, and the default follows the reading.

## Owed before the engine plan
- Ticket 4's ledger readings: both publish arms, and the real board.
- The host changes ticket 2 named:
  - read the keyed authorship note;
  - stop the silent union when the same-spot flag is present (13 of 13 unions in the record).
- Ticket 5's stability condition, which is adopted or not by the operator.
- Token counts on the factory's `dispatch:end` rows, before any cost comparison (proposed, not filed).

## Authoring record

| # | question | options | picked | explain rounds |
|---|---|---|---|---|
| 1 | what can an agent post | typed kinds / free text + Jev / free text | Other: present the findings first, then decide. This led to 1-rev | 0 |
| 1-rev | three row types | three layers / two layers / one kind | three layers (Recommended) | 0 |
| 2 | peer requests | recast as more-work / allow addressed / ban | recast as more-work (Recommended) | 0 |
| 3 | anchor | line keys + snapshot / symbol / file | line keys + snapshot (Recommended) | 0 |
| 4 | confidence source | code first, else Jev / Jev always / readers weigh | code first, else Jev (Recommended) | 0 |
| 5 | staleness | Jev re-scores / mark stale / decay by count | Jev re-scores (Recommended) | 0 |
| 6 | rounds | every snapshot / lazily / timer | every snapshot (Recommended) | 0 |
| 7 | visibility | relevant slice / everything / last N | Other: relevant slice, and asked what more context would help. This led to 7b | 0 |
| 7b | extra context (multi) | plan-wide / provenance / since-BASE outline | all three (each Recommended) | 0 |
| 8 | consequence map | adopt table / all record-only | adopt table (Recommended) | 0 |
| M1 | new map or amendment | own map / amend #1131 | own map (Recommended) | 0 |
| M2 | name and label | the Flock `flock` / Murmuration | the Flock `flock` (Recommended) | 0 |
| M3 | main as a weave | later / in scope now | Other: worried "later" drifts into papercut errands; asked agree or disagree. This led to M3-rev | 0 |
| M3-rev | main as a weave | design now, build second / fully now / later | design now, build second (Recommended) | 0 |
| M4 | publish cadence | coherent + measure / every edit / coherent only | coherent + measure (Recommended) | 0 |

Recommended pick rate: 12 of 12 decided questions (the three `Other` answers redirected the question and were not decisions); explain rounds 0.
