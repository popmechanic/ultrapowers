# The harvester carries the fold, reads the envelopes, and keys by opening

**Grammar:** claims-v1

**Claim:** The harvested bundle carries every driver:publish-fold field whole; confineDenials reads the worker envelopes and is null when unknown; and the ultralearn cache is keyed by run id and the run's opening timestamp. (elicited)

**Goal:** three defects the 2026-09-08 sense pass over runs 33–45 found in one script,
`skills/ultralearn/scripts/harvest_fleet_runs.py`, each of which made a reader of the harvest
believe something false about a run. (#759) `bundle.json`'s `events` block is a summary and
`slice.md`'s timeline caps every summary at 200 characters, so the one event decisions 9–11 turn
on — `driver:publish-fold`, with `pathsJoined`, `pathsConflicted`, `resolversDispatched`,
`suite` and `disposition` — reached no reader whole; runs 36 and 43 were read by hand off the
tag. (#760) `confineDenials` is read from `confine-denials.jsonl`, a file the evidence tag never
carries (`workers/` is not on the record — `fleet/CONTRACT.md` lists the six files, the
`publish-fold/` receipts and `transcripts/`), so a harvested run's denial count was `[]` while
the transcript slices on the same tag showed every reviewer denied Bash on its first call
(run-42: four of four). (#761, and #698 which it duplicates) the cache is keyed by the bare
`runId`, and run numbers restarted at 1 on 2026-09-04, so `run-45` of 2026-09-07 was reported
"already cached" against the bundle of the 2026-09-01 run-45 and never harvested until `--force`.
The three fixes are one plan because they share one file; the plan takes #761's shape for the key
(`run-<N>-<opening date>`, the record's sha as the skip test) rather than #698's target-keyed
layout, and records the target in the bundle instead.
**Closes:** #759 #760 #761 #698

**Tech Stack:** Python 3 stdlib only (`skills/ultralearn/scripts/*.py`: `harvest_fleet_runs.py`,
`fleet_events.py`, `fleet_slice.py`, `merge_ledger.py`, `_readers.py`); pytest exams under
`tests/`. The committed suite is `python3 -m pytest` from the repo root (`pytest.ini` scopes it to
`tests/`). Every exam here is hermetic: `gh` reaches the harvester only as a stub executable on a
`PATH` set to its own directory (the shape `tests/test_harvest_fleet_runs.py` and
`tests/test_harvest_evidence.py` already use), and `--engine-version` is passed so nothing shells
out to `git` for a release timeline.

**Exam command:** python3 -m pytest -q {paths}

**Parallelization rationale:** one wave, width 3. The three tasks share
`skills/ultralearn/scripts/harvest_fleet_runs.py` — Task 1 edits `build_fleet_bundle`'s bundle
dict and adds a `publishFold` field, Task 2 replaces the `confineDenials` read with a derivation,
Task 3 changes the output directory and `main`'s skip — and same-file text folds. Tasks 1 and 3
both add one key to the `BASE_BUNDLE_KEYS` literal in `tests/test_harvest_evidence.py` (the one
adjacent-insert site in the plan, named in both Contexts; any order satisfies both). Task 1 and
Task 2 each edit one paragraph of `skills/ultralearn/references/reading-lenses.md` §friction —
different paragraphs. No task consumes a sibling's runtime behaviour: the shapes they share (the
bundle's key set, the run-dir files, the `gh` stub) are literals in each Context, so no chain is
owed. Each task's exam is its own new file, named for its surface, so three same-wave appends to
one test file never happen; the folded tree is green because every task owns every existing pin
its change moves (listed by line in its Context) and the sibling suites it does not touch are
unchanged in behaviour.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- fleet/`
- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- Check: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn`
- This plan is ultralearn's alone: `fleet/` is untouched (three sibling plans launched the same
  day edit `fleet/run-engine.mjs`, `fleet/run-main.mjs` and `fleet/confine-hook.mjs`), and the
  verification periphery is frozen (0.1.0) — the first two Checks pin both.
- The bundle is the interface: every key `bundle.json` carries at BASE keeps its name and type
  (`runId`, `sessionId`, `projectSlug`, `origin`, `sessionKind`, `engineVersion`, `planPath`,
  `transcriptDir`, `gateReport`, `terminus`, `truncated`, `audit`, `report`, `events`,
  `planningFound`, `confineDenials`), `merge_ledger.bundle_lookups` still answers `origin` and
  `engineVersion.epoch` for a ledger `runId` such as `run-30`, and the five lenses read the same
  `bundle.json` + `slice.md` pair.
- The harvester stays advisory and loud: a source that is absent or unreadable is one line on
  stderr and never a traceback, `FAILED-LOOKUP:` is still reserved for a run that cannot bundle
  at all, and exit 2 still means every input failed.
- No exam reaches the network: `gh` is a stub on `PATH`, and no test opens a socket or reads a
  real evidence branch.
- No kept row is cut to a length: an event row in the allowlist and a denial line derived from
  an envelope or a transcript are carried as their source has them; the only truncation left in
  the harvester is the ones BASE already has (`SUITE_OUTPUT_TAIL`, the slicer's budgets, and the
  200-character cap on rows outside the allowlist).

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The bundle and the slice carry the publish fold whole

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- Modify: `skills/ultralearn/scripts/fleet_events.py`
- Modify: `skills/ultralearn/references/reading-lenses.md`
- Modify: `tests/test_harvest_evidence.py`
- Test: `tests/test_harvest_fleet_runs_publish_fold.py`
- Test: `tests/test_fleet_events.py`

**Claim:** `harvest_fleet_runs.py` keeps every `driver:publish-fold` event whole in `bundle.json` (a `publishFold` list of the raw rows) and the slice writer never truncates an event line whose type is in a small allowlist (`driver:publish-fold`, `publish:pr`, `publish:hold`, `publish:merge`, `driver:ack-decision`). (quoted from #759)
Machine: M1. For a run directory whose `events.jsonl` carries one `driver:publish-fold` row
whose JSON line is at least 600 characters, `bundle.json`'s top-level `publishFold` is a list
whose single element equals that row as parsed — every key the line carries, `id` and `ts`
included, with every value equal, so a row missing any key or cut at any length is not equal —
and for a log carrying two such rows the list holds both, in `id` order.
M2. For a run directory whose `events.jsonl` carries no `driver:publish-fold` row, `publishFold`
is `[]` and the bundle still writes.
M3. In `slice.md`'s `## Event timeline` block, for each of the five kinds `driver:publish-fold`,
`publish:pr`, `publish:hold`, `publish:merge` and `driver:ack-decision`, a row whose rendered
summary exceeds 200 characters is one line that contains every string value the row carries and
does not end in `…`; and an `engine:log` row whose `line` is 500 characters still renders as a
line shorter than 260 characters ending in `…`.
M4. `skills/ultralearn/references/reading-lenses.md`, in its `1. **friction**` item, names
`bundle.publishFold` and, after it, `pathsJoined`, `pathsConflicted`, `resolversDispatched`,
`suite` and `disposition` as the fields a fold decision is read from.

**Authorized-by:** #759 (bug, experience-compiler); #715 (the cross-run fold whose decisions 9–11
read these fields); #414 (run = event log).

**Interfaces:**
- Consumes: none
- Produces: `publishFold` — the `bundle.json` key holding the list of raw `driver:publish-fold` rows

**Context:** Two writers, one reader contract. In `harvest_fleet_runs.py`, `build_fleet_bundle`
already has the parsed, id-sorted `events` list from `fleet_events.read_events(run_dir)`; the
new field is `"publishFold": [e for e in events if e.get("kind") == "driver:publish-fold"]`, the
rows as parsed and never re-shaped — a real row at BASE (run-42, off its evidence tag) is
`{"kind":"driver:publish-fold","run":"42","attempt":"1","base":"9cd8190…","tip":"9cd8190…","candidate":"09577d3…","pathsJoined":0,"pathsConflicted":0,"resolversDispatched":0,"resolverRetries":0,"suite":"none","disposition":"nothing to join","id":"01M1YX2D5J0000QBQ17BZV04NN","ts":1788817257650}`,
and a folding run's row (run-43) is longer than the timeline's 200-character cap, which is the
whole defect. The bundle key set is pinned exactly by `BASE_BUNDLE_KEYS` in
`tests/test_harvest_evidence.py` (`assert set(b) == set(BASE_BUNDLE_KEYS)` in
`test_a_local_run_dir_bundles_exactly_as_the_base_harvester_did`): this task adds `"publishFold"`
to that frozenset literal, and a sibling task in the same wave adds `"evidenceSha"`,
`"evidenceRef"` and `"target"` to the same literal — the fold resolves the adjacent edit, and the
two additions are order-free. In `fleet_events.py`, `render_timeline` caps every summary at
`SUMMARY_MAX` (200): the change is a module-level allowlist
`SUMMARY_WHOLE_KINDS = frozenset({"driver:publish-fold", "publish:pr", "publish:hold", "publish:merge", "driver:ack-decision"})`
that `render_timeline` exempts from the cap — a row of any other kind is capped exactly as at
BASE, which `test_render_timeline_caps_a_long_summary` in `tests/test_fleet_events.py` pins on an
`engine:log` row and keeps pinning. `_summarize_one` renders an unlisted kind as
`json.dumps` of the row minus `kind`/`id`/`ts`, so a `driver:publish-fold` row's summary already
carries every field once the cap no longer cuts it; `driver:ack-decision` renders as
`approve=… <reason>`, and the three `publish:*` kinds fall to the JSON rendering — all five are
whole under the exemption, and no per-kind renderer is owed. `EVENT_KINDS` names what is known and
filters nothing; adding the four new kinds there is welcome but changes no behaviour. The slice
file's timeline is what `fleet_slice.build_slice` is handed as `timeline_md`, so the exemption in
`render_timeline` is the slice fix. The doc edit is one sentence in
`skills/ultralearn/references/reading-lenses.md`'s `1. **friction**` item, replacing the stale
"read the drive's structured artifact first: `detail.errors` … in `gate-read-<runId>.detail.json`"
sentence (a pre-0.3.0 artifact no fleet run writes) with: for a fleet bundle, read the publish
fold first — `bundle.publishFold` holds every `driver:publish-fold` row whole, and a fold decision
is read from its `pathsJoined`, `pathsConflicted`, `resolversDispatched`, `suite` and
`disposition`. The `For **permission denials**` paragraph of the same item belongs to a sibling
task and is not touched here. The exam file `tests/test_harvest_fleet_runs_publish_fold.py` is
new and self-contained (its own `_ev`/`_make_run_dir` fixture helpers, restated rather than
imported, so it does not depend on the other exam's fixtures); it needs no `gh` and runs local
run directories through `hfr.build_fleet_bundle`. Its long row is built to a measured length —
pad `disposition` or a `reason` field until `len(json.dumps(row)) >= 600` and assert that length
in the test — so the exam cannot pass on a row the cap would never have touched.
**BASE facts:** (generated at d26bbdc)
- `publishFold` at `fleet/publish-fold.mjs:267` blob 6797792
- `id` at `fleet/run-waves.mjs:106` blob 27f25b5
- `ts` at `fleet/run-engine.mjs:707` blob 3148252
- `line` at `fleet/run-worker.mjs:521` blob da08fc7
- `skills/ultralearn/references/reading-lenses.md` blob 0a67c62
- `pathsJoined` at `fleet/publish-fold.mjs:623` blob 6797792
- `pathsConflicted` at `fleet/publish-fold.mjs:844` blob 6797792
- `resolversDispatched` at `fleet/publish-fold.mjs:651` blob 6797792
- `suite` at `fleet/publish-fold.mjs:911` blob 6797792
- `build_fleet_bundle` at `skills/ultralearn/scripts/harvest_fleet_runs.py:374` blob 9552df9
- `events` at `fleet/tests/_sandbox_boot_helpers.mjs:819` blob bcf3734
- `tests/test_harvest_evidence.py` blob 280b368
- `test_a_local_run_dir_bundles_exactly_as_the_base_harvester_did` at `tests/test_harvest_evidence.py:527` blob 280b368
- `render_timeline` at `skills/ultralearn/scripts/fleet_events.py:237` blob 47ad4d9
- `test_render_timeline_caps_a_long_summary` at `tests/test_fleet_events.py:162` blob 39be477
- `tests/test_fleet_events.py` blob 39be477
- `_summarize_one` at `skills/ultralearn/scripts/fleet_events.py:196` blob 47ad4d9
- `kind` at `fleet/lobby.mjs:418` blob 62d348b
- `_ev` at `tests/test_fleet_events.py:11` blob 39be477
- `_make_run_dir` at `tests/test_harvest_evidence.py:115` blob 280b368
- `reason` at `fleet/run-engine.mjs:634` blob 3148252
- `skills/ultralearn/scripts/fleet_events.py` blob 47ad4d9

**Proof:**
- Test: `tests/test_harvest_fleet_runs_publish_fold.py`
- Test: `tests/test_fleet_events.py`
- Legs: (a) a run directory whose log carries one `driver:publish-fold` row of at least 600
  characters (asserted on `len(json.dumps(row))`) yields `bundle["publishFold"] == [row]` by
  dict equality, `id` and `ts` included — a list whose element lacks any of the row's keys, or
  whose `disposition` is shorter than the fixture's, fails the equality; and a log carrying two
  such rows yields both, ordered by `id` [M1]; (b) a run directory whose log carries no `driver:publish-fold` row yields
  `bundle["publishFold"] == []` and `bundle.json` exists [M2]; (c) for each of
  `driver:publish-fold`, `publish:pr`, `publish:hold`, `publish:merge` and `driver:ack-decision`
  — five rows, one per kind, each with a string field longer than 200 characters — the
  `slice.md` timeline contains, for that kind, exactly one line that includes the row's long
  string value whole and does not end in `…` [M3]; (d) `test_render_timeline_caps_a_long_summary`
  in `tests/test_fleet_events.py` still passes as written (an `engine:log` row of 500
  characters renders shorter than 260 characters and ends in `…`) — the negative row of M3 [M3];
  (e) `BASE_BUNDLE_KEYS` in `tests/test_harvest_evidence.py` contains `publishFold` and
  `test_a_local_run_dir_bundles_exactly_as_the_base_harvester_did` passes [M1]; (f) the second
  `Run:` below — the friction item's text, joined, matches `bundle.publishFold` followed in
  order by the five field names — exits 0, and the third exits 0 only when
  `gate-read-<runId>.detail.json` no longer appears in that item [M4].
- Run: python3 -m pytest -q tests/test_harvest_fleet_runs_publish_fold.py tests/test_fleet_events.py tests/test_harvest_evidence.py tests/test_harvest_fleet_runs.py
- Run: sed -n '/^1\. \*\*friction\*\*/,/^2\. \*\*routing\*\*/p' skills/ultralearn/references/reading-lenses.md | tr '\n' ' ' | grep -q 'bundle.publishFold.*pathsJoined.*pathsConflicted.*resolversDispatched.*suite.*disposition'
- Run: sed -n '/^1\. \*\*friction\*\*/,/^2\. \*\*routing\*\*/p' skills/ultralearn/references/reading-lenses.md | grep -c 'gate-read-<runId>.detail.json' | grep -qx 0

**Stale-if:**
- issue-closed: #759
- path-absent: `skills/ultralearn/scripts/fleet_events.py`

### Task 2: confineDenials is derived from the envelopes and the slices, and null when unknown

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- Modify: `skills/ultralearn/references/reading-lenses.md`
- Modify: `tests/test_harvest_fleet_runs.py`
- Modify: `tests/test_harvest_evidence.py`
- Test: `tests/test_harvest_fleet_runs_confine_denials.py`

**Claim:** The harvester derives `confineDenials` from the sources the record does carry — each worker's `permission_denials` in its envelope/receipt and the #702 transcript slices — with `source: 'envelope'` per line, and emits `confineDenials: null` (unknown), never `[]`, when neither source is present. (quoted from #760)
Machine: M1. For a run directory holding `workers/<dir>/envelope.json` whose `session_id` is
the `sessionId` of a `worker:start` event with role `reviewer` and whose `permission_denials`
lists two entries, `bundle.confineDenials` is a list of exactly two objects, each with
`source == "envelope"`, `label` and `role` equal to that worker's, and `tool` equal to the
entry's `tool_name`.
M2. For a run directory holding `transcripts/<sessionId>.jsonl` (the #702 slice shape) in which
one `tool_result` block has `is_error: true` and content containing `Permission to use`, and no
`workers/` directory and no `confine-denials.jsonl`, `bundle.confineDenials` is a list of exactly
one object with `source == "transcript"`, `label` and `role` of the worker whose `sessionId` names
that file, `tool` equal to the `name` of the `tool_use` block whose `id` the result's
`tool_use_id` matches, and `reason` containing `Permission to use`.
M3. For a run directory holding `confine-denials.jsonl` and no `workers/` directory and no
`transcripts/` directory, `bundle.confineDenials` equals the file's object lines, in file order,
each as parsed — the BASE shape.
M4. For a run directory holding none of `workers/*/envelope.json`, `transcripts/*.jsonl` and
`confine-denials.jsonl`, `bundle.confineDenials` is JSON `null` and `bundle.json` still writes;
and for a run directory holding one envelope whose `permission_denials` is `[]`, a transcript
slice with no error result, and no file, it is `[]`.
M5. `skills/ultralearn/references/reading-lenses.md`, in its `1. **friction**` item, names
`bundle.confineDenials` as the place to read denials, the three `source` values `envelope`,
`transcript` and `hook`, and `null` as unknown; and no longer names `confine-denials.jsonl` as
the one place to look.

**Authorized-by:** #760 (bug, experience-compiler); #476 (the `source` discriminator); #702 (the
transcript slice on the evidence tag); #414.

**Interfaces:**
- Consumes: none
- Produces: `confineDenials` — the `bundle.json` key, a list of denial lines each carrying `source`, or `null`

**Context:** What the record carries, measured 2026-09-08 on run-42's evidence tag
(`ultra/evidence/run-42`, `.ultrapowers/runs/42/`): `approve-receipt.json`, `claude-version.txt`,
`engine.log`, `events.jsonl`, `gate-receipt.json`, `pr-body.md`, `publish-fold/`, `receipt.json`,
`report.json`, `standing-approval.json`, `status.json`, `transcripts/` — no `workers/`, no
`confine-denials.jsonl`; `receipt.json`'s keys are `ok, stamp, stages, compile, baseBranch,
launchFile, argsFile, workflowName, llmDerives, testCmd, testCmdSource` and `status.json`'s are
`run, state, phase, pr, prAuthor, merged, branch, vm, startedAt, updatedAt, error` — neither
carries a worker's envelope, and a `worker:end` event carries `exitCode, timedOut, outcome, class,
status, meter` and no `permission_denials`. So on a harvested run the only denial source is the
transcript slice, where a denial is a `tool_result` block the #702 reducer wrote as
`{"type":"tool_result","tool_use_id":"toolu_…","is_error":true,"content":"[tool_result: 727 chars, is_error] Permission to use Bash has been denied because Claude Code is running in don't ask mode. IMPORTANT: …"}`
(the error's first 200 characters after the size prefix), inside a `user` record's
`message.content` list, and the tool's name is on the `assistant` record's `tool_use` block with
the same `id`. On a local sandbox-logs tarball the run directory has `workers/<label with ':'
-> '_'>/envelope.json` — the `claude -p` result envelope, with `session_id` and
`permission_denials: [{"tool_name": "Bash", "tool_use_id": "…", "tool_input": {"command": "…"}}]`
— and may have `confine-denials.jsonl` (the hook's own lines, each already carrying
`source: "hook"` or, since #476, `source: "envelope"`). The derivation, in `build_fleet_bundle`:
(1) envelope lines — for every `workers/*/envelope.json` that parses to an object, one line per
`permission_denials` entry, shaped exactly as `fleet/run-worker.mjs`'s `recordEnvelopeDenials`
shapes its lines: `{"source": "envelope", "label", "role", "tool", "reason", "toolInput"}` with
`label`/`role` from the `summary["workers"]` entry whose `sessionId` equals the envelope's
`session_id` (fall back to the directory name with `_` -> `:` and role `null`), `tool` from
`tool_name` or `tool`, `reason` from `reason` or `message` (else `null`), `toolInput` the
`tool_input` as a JSON string; (2) transcript lines — for every `transcripts/*.jsonl`, read with
`_readers.records` and walked with `_readers.iter_blocks_indexed`, one line per `tool_result`
block with `is_error` true whose flattened text contains `Permission to use`:
`{"source": "transcript", "label", "role", "sessionId", "tool", "reason"}` with `sessionId` the
file's (the record's `sessionId`, else the file stem), `label`/`role` from the matching
`summary["workers"]` entry (else `null`), `tool` from the `tool_use` block seen earlier in the same
file with `id == tool_use_id` (else `null`), `reason` the content with its
`[tool_result: N chars, is_error] ` prefix stripped; (3) file lines — `_read_jsonl(run_dir /
"confine-denials.jsonl")` as at BASE, verbatim. `confineDenials` is the concatenation
envelope + transcript + file when at least one of the three sources EXISTS (a `workers/`
directory with at least one `envelope.json`, a `transcripts/` directory with at least one
`.jsonl`, or the file), and `None` when none exists — so `null` means "the record carries
nothing to count" and `[]` means "counted, and zero". `_carries_a_finding` reads
`bool(bundle["confineDenials"])`, which is already false for `None`. `fleet_slice.find_envelope`
is the existing envelope reader (it joins on `session_id`, falls back to the label directory) and
may be reused; `fleet_slice.envelope_section` already renders `permission_denials` into the slice
and is untouched. Existing pins that stay green without edits, and why:
`test_bundle_carries_the_event_summary_and_confine_denials` and
`test_a_non_object_jsonl_record_is_skipped_with_a_diagnostic` in
`tests/test_harvest_fleet_runs.py` and
`test_a_local_run_dir_bundles_exactly_as_the_base_harvester_did` in
`tests/test_harvest_evidence.py` (`assert b["confineDenials"] == [{"tool": "Bash", "reason":
"outside clone"}]`) all use `_make_run_dir`, whose directory has `confine-denials.jsonl`, a
transcript under `claude/projects/` (not `transcripts/`) and no `workers/` — file lines only,
verbatim, so equality holds — the two files are in this task's Files because they pin
`confineDenials`, and are expected to need no edit; `claude/projects/` is not a denial source (a local tarball's complete
source is its envelopes). The doc edit is the `For **permission denials**` paragraph of
`skills/ultralearn/references/reading-lenses.md`'s `1. **friction**` item, rewritten to say:
read `bundle.confineDenials`; a line's `source` is `envelope` (the worker's own
`permission_denials`, complete), `transcript` (a denied tool call seen in the #702 slice — the
only source a harvested run carries, and a slice's head/tail cut can drop a denial, so it is a
floor), or `hook` (the confine hook's own ledger, a subset of `envelope`); count `envelope` lines
when they are present, never the total; and `null` means the record carried no source at all —
not zero. The first paragraph of the same item, on `bundle.publishFold`, belongs to a sibling
task and is not touched here. The exam file `tests/test_harvest_fleet_runs_confine_denials.py` is
new and self-contained, with its own fixture helpers; every run directory it builds is local and
goes through `hfr.build_fleet_bundle` with `engine_version="0.3.0"`, so no `gh` and no `git`.
**BASE facts:** (generated at d26bbdc)
- `sessionId` at `fleet/run-worker.mjs:797` blob da08fc7
- `reviewer` at `fleet/tests/test_roles_peer.mjs:42` blob 4847687
- `label` at `fleet/run-engine.mjs:582` blob 3148252
- `role` at `fleet/run-worker.mjs:794` blob da08fc7
- `tool` at `fleet/confine-hook.mjs:218` blob e0cd408
- `name` at `fleet/doctor.mjs:363` blob f9a1174
- `id` at `fleet/run-waves.mjs:106` blob 27f25b5
- `reason` at `fleet/run-engine.mjs:634` blob 3148252
- `skills/ultralearn/references/reading-lenses.md` blob 0a67c62
- `source` at `fleet/tests/test_doctor.mjs:329` blob 0f9de8d
- `envelope` at `fleet/run-worker.mjs:833` blob da08fc7
- `build_fleet_bundle` at `skills/ultralearn/scripts/harvest_fleet_runs.py:374` blob 9552df9
- `fleet/run-worker.mjs` blob da08fc7
- `recordEnvelopeDenials` at `fleet/run-worker.mjs:511` blob da08fc7
- `_carries_a_finding` at `skills/ultralearn/scripts/harvest_fleet_runs.py:363` blob 9552df9
- `test_bundle_carries_the_event_summary_and_confine_denials` at `tests/test_harvest_fleet_runs.py:236` blob 2599318
- `test_a_non_object_jsonl_record_is_skipped_with_a_diagnostic` at `tests/test_harvest_fleet_runs.py:321` blob 2599318
- `tests/test_harvest_fleet_runs.py` blob 2599318
- `test_a_local_run_dir_bundles_exactly_as_the_base_harvester_did` at `tests/test_harvest_evidence.py:527` blob 280b368
- `tests/test_harvest_evidence.py` blob 280b368
- `git` at `fleet/lobby.mjs:271` blob 62d348b
- `critic` at `fleet/run-main.mjs:761` blob 60f6e30
- `block` at `fleet/publish-fold.mjs:787` blob 6797792
- `skills/ultralearn/scripts/fleet_slice.py` blob 9129a4f

**Proof:**
- Test: `tests/test_harvest_fleet_runs_confine_denials.py`
- Legs: (a) a run directory with a `worker:start`/`worker:end` pair for label `review:1:1`,
  role `reviewer`, session `sess-r1`, and `workers/review_1_1/envelope.json` carrying
  `session_id: "sess-r1"` and two `permission_denials` entries with `tool_name: "Bash"` yields
  `len(bundle["confineDenials"]) == 2`, every line `source == "envelope"`, `label ==
  "review:1:1"`, `role == "reviewer"` and `tool == "Bash"` — a harvester that still reads only
  `confine-denials.jsonl` yields `[]` there and fails the length [M1]; (b) a run directory with a
  `worker:start` for session `sess-c1` (label `critic:1`, role `critic`) and
  `transcripts/sess-c1.jsonl` holding an assistant `tool_use` block `{"id": "toolu_9", "name":
  "Bash", …}` and a user `tool_result` block `{"tool_use_id": "toolu_9", "is_error": true,
  "content": "[tool_result: 727 chars, is_error] Permission to use Bash has been denied …"}`, no
  `workers/` and no file, yields exactly one line with `source == "transcript"`, `label ==
  "critic:1"`, `role == "critic"`, `tool == "Bash"` and `"Permission to use" in reason` [M2];
  (c) a run directory with `confine-denials.jsonl` of two object lines and no `workers/` and no
  `transcripts/` yields a list equal to those two objects in file order [M3]; (d) a run directory
  with no `workers/`, no `transcripts/` and no file yields `bundle["confineDenials"] is None`
  after a JSON round-trip of `bundle.json`, and `bundle.json` exists [M4]; (e) a run directory
  with one envelope whose `permission_denials` is `[]`, one transcript slice whose only
  `tool_result` is not an error, and no file yields `bundle["confineDenials"] == []` [M4]; (f) the second `Run:` below — the
  friction item's text, joined, matches `bundle.confineDenials` followed in order by `envelope`,
  `transcript`, `hook` and `null` — exits 0, and the third exits 0 only when the BASE sentence
  `is now the one place to` is absent from that item [M5].
- Run: python3 -m pytest -q tests/test_harvest_fleet_runs_confine_denials.py tests/test_harvest_fleet_runs.py tests/test_harvest_evidence.py tests/test_fleet_slice.py
- Run: sed -n '/^1\. \*\*friction\*\*/,/^2\. \*\*routing\*\*/p' skills/ultralearn/references/reading-lenses.md | tr '\n' ' ' | grep -q 'bundle.confineDenials.*envelope.*transcript.*hook.*null'
- Run: sed -n '/^1\. \*\*friction\*\*/,/^2\. \*\*routing\*\*/p' skills/ultralearn/references/reading-lenses.md | grep -c 'is now the one place to' | grep -qx 0

**Stale-if:**
- issue-closed: #760
- path-absent: `skills/ultralearn/scripts/fleet_slice.py`

### Task 3: The cache is keyed by run and opening date, and the skip compares the record's sha

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- Modify: `skills/ultralearn/scripts/merge_ledger.py`
- Modify: `skills/ultralearn/SKILL.md`
- Modify: `tests/test_harvest_fleet_runs.py`
- Modify: `tests/test_harvest_evidence.py`
- Test: `tests/test_harvest_fleet_runs_cache_key.py`
- Test: `tests/test_merge_ledger.py`

**Claim:** The cache key is `run-<N>-<openedAt date>` (or the evidence tag's commit sha), the incremental skip compares the tag's sha to the cached bundle's `evidenceSha`, and a mismatch rebuilds rather than skips. (quoted from #761)
Machine: M1. `build_fleet_bundle` writes a run whose `runId` is `run-30` and whose `openedAt`
is a millisecond timestamp to `<cache>/runs/run-30-<YYYY-MM-DD>/` where the date is that
timestamp in UTC; two run directories with `runId` `run-30` and `openedAt` on different UTC days
harvested into one cache leave two directories, each with its own `bundle.json`; and a run whose
log carries no timestamp at all writes to `<cache>/runs/run-30/`.
M2. `bundle.json` carries `evidenceSha`, `evidenceRef` and `target`: read from
`<run dir>/evidence-ref.json` when that file is present, and `null` for each when it is absent
(a local run directory).
M3. `fetch_evidence` makes one `gh api repos/<target>/commits/<ref>` read at the ref the six
files resolved to, after the six file reads and before the `transcripts` listing, and writes
`<dest>/evidence-ref.json` as `{"target": …, "ref": …, "sha": …}` with `sha` the answer's
40-hex `sha`; when that read answers non-zero, `sha` is `null`, one `harvest_fleet_runs:` line
names the run and the ref, and the run still bundles.
M4. `main` skips a run only when a `bundle.json` exists at its key and that bundle's
`evidenceSha` equals the fetched sha (`null` equal to `null`); a cached bundle at the same key
whose `evidenceSha` differs from the fetched sha is rebuilt, counted in `N bundle(s) written`
and not in `already cached`; and `--force` rebuilds regardless.
M5. `merge_ledger.bundle_lookups(cache)` answers `origin_lookup("run-30")` and
`engine_lookup("run-30")` from the bundle under `<cache>/runs/*/bundle.json` whose `runId` is
`run-30` and whose `events.openedAt` is greatest when more than one carries that `runId`; a
directory named exactly `run-30` is a candidate too; and an id no bundle carries still answers
`foreign` and `None`.
M6. `skills/ultralearn/SKILL.md`'s step 1 names the cache directory as
`~/.claude/ultralearn/runs/run-<N>-<date>/` and says the "already cached" test compares the
record's sha with the bundle's `evidenceSha`; it no longer says the key is the bare `runId`.

**Authorized-by:** #761 (bug, experience-compiler; closed 2026-09-08 as a duplicate of #698,
whose desired-state wording it records); #698 (bug, experience-compiler); #414.

**Interfaces:**
- Consumes: none
- Produces: `evidenceSha` — the `bundle.json` key holding the 40-hex commit sha the record was read at, or `null`

**Context:** The key. `fleet_events.summarize_events` returns `openedAt` — the `run:open`
event's `ts`, else the first event's — in milliseconds; the date is
`datetime.fromtimestamp(opened / 1000, timezone.utc).strftime("%Y-%m-%d")`, and the directory is
`f"{run_id}-{date}"`; with no timestamp the directory is the bare `run_id`. The fixtures' `T0 =
1788130000000` is `2026-08-30T22:46:40Z` (the `asOf` the BASE exam already pins), so every
existing cache-path pin on the fixture becomes `run-30-2026-08-30` or `run-7-2026-08-30`. Those
pins, all owned here, at BASE `d26bbdc1`: `tests/test_harvest_fleet_runs.py` lines 164
(`out == tmp_path / "cache" / "runs" / "run-30"`), 268, 349–350 (`run-31` absent stays absent
under any key — assert on `(cache / "runs").iterdir()` names instead), 368, 451–452
(`sorted(p.name …) == ["run-30"]`), 465 (`run-40`), 711, 741, 809, 933, 979; and
`tests/test_harvest_evidence.py` lines 270, 278, 295, 312–313 (`run-7` and `run-8`), 379, 465–466,
543. `test_main_is_incremental_and_force_overrides` (`tests/test_harvest_fleet_runs.py:271`) and
`test_a_failure_beside_an_already_cached_run_is_not_a_total_failure` (`:395`) stay green as
written — a local directory has no `evidence-ref.json`, so both shas are `null` and the second
harvest skips. The sha. `fetch_evidence` resolves `ref` to the branch or the tag while reading
the six files; after the loop (and after the two `FailedLookup` raises, so a run with nothing
readable or no timeline never spends the call) it reads
`repos/{target}/commits/{ref}` — the commits endpoint answers a commit object `{"sha": "<40
hex>", …}` for a branch name, a tag name or a sha alike, one path for both refs — with a new
helper beside `_gh_api` and `_gh_api_listing` that returns the parsed JSON object (the existing
`_gh_api` looks for `content` and answers `None` for a body without it; `_gh_api_listing`
refuses a body that is not a list), raising `FailedLookup` on `OSError`/`SubprocessError`
exactly as the file reads do; then the `transcripts` listing, as at BASE. It writes
`dest / "evidence-ref.json"` = `{"target": target, "ref": ref, "sha": sha_or_None}` before
returning; `discover_run_dirs` still keys on `events.jsonl`, and `build_fleet_bundle` reads the
file the way it reads `fleet-run.json` (`_read_json` when present) into three new bundle keys
`evidenceSha`, `evidenceRef`, `target`, each `None` when the file is absent. The bundle key set
is pinned exactly by `BASE_BUNDLE_KEYS` in `tests/test_harvest_evidence.py`: this task adds the
three keys to that frozenset literal, and a sibling task in the same wave adds `"publishFold"`
to the same literal — the fold resolves the adjacent edit, and the two additions are
order-free. The `gh` stubs. Both exam files' stub `gh` answers from a JSON map keyed by the
`repos/…` argument and wraps a string body in the contents API's base64 file envelope
(`sha: "0" * 40`, which is a BLOB sha and not the commit sha this task wants); a key absent from
the map is `gh: HTTP 404` and exit 1. In `tests/test_harvest_fleet_runs.py` the stub prints a
list body unwrapped (#702's directory listing); extend it so a dict body is printed unwrapped
too, and answer `repos/popmechanic/smoke/commits/ultra/evidence/run-7` with `{"sha":
"a" * 40}` where the leg wants a sha. Call-count and call-order pins owned here:
`test_t6_a_swept_run_lands_from_the_tag_in_exactly_eight_calls` (`tests/test_harvest_fleet_runs.py:687`)
becomes nine calls with the commits path eighth and the listing ninth, and its docstring says so;
`test_t6_a_run_on_the_branch_is_read_exactly_as_at_base` (`:723`) and
`test_t2_the_listing_and_every_listed_file_are_read_at_the_resolved_ref` (`:902`) gain the
commits path at the branch ref in the same position; `tests/test_harvest_evidence.py` pins
`len(calls) == 7` at lines 265 and 378 — both become 8, with `_expected_paths()` gaining the
commits path — while line 399's `len(_calls(log)) == 6` (no `events.jsonl` on the branch, the
harvest raises before the listing) stays 6 because the sha read sits after the raises; that
stub answers the commits path 404, so those bundles carry `evidenceSha: null` and one advisory
line, which is M3's second half and needs no fixture change. The lookup. `merge_ledger.py`'s
`bundle_lookups` reads `<cache>/runs/<key>/bundle.json` by the ledger's `runId`, which is
`run-30` — under the new key that read would fail closed to `foreign` for every fleet run, so
`_bundle(run_id)` becomes: the candidates are the directory named exactly `run_id` (if it holds
a `bundle.json`) plus every `runs/*/bundle.json` whose `runId` field equals `run_id`; the chosen
one has the greatest `events.openedAt` (a bundle without one sorts lowest; the exact-name
directory alone wins when it is the only candidate); each `bundle.json` is still read at most
once per lookup pair (scan the directory once, lazily, on the first miss). The existing
`test_bundle_lookups_reads_cache_and_fails_closed` and `test_bundle_lookups_expands_tilde` in
`tests/test_merge_ledger.py` write bundles with no `runId` under directories `r1` and `r9` and
look them up by directory name — the exact-name candidate keeps them green; the new legs are
appended to that file under a comment naming this task. The ledger's `runId` values and
`merge_findings` are untouched (#698's `<owner>/<repo>#run-N` rename is not taken; `target` is
recorded in the bundle instead, and no migration of August's bare `run-N` directories is made —
the lookup's greatest-`openedAt` rule reads past them). The doc edit is `skills/ultralearn/SKILL.md`
step 1's cache sentence — at BASE "`~/.claude/ultralearn/runs/<runId>/`, keyed by the fleet
`runId` (`run-30`)" and "Incremental: a cached bundle is left alone, so a re-run only builds new
runs." — rewritten to name `~/.claude/ultralearn/runs/run-<N>-<date>/` (the run id and its
opening day in UTC, so a restarted numbering never lands on an older run's bundle) and to say a
cached bundle is skipped only when the record's sha matches its `evidenceSha`, else rebuilt.
`tests/test_ultralearn_docs.py` checks the skill still names `harvest_fleet_runs.py` and
`events.jsonl` and that every `--flag` it advertises exists — no new flag is added. The new exam
file `tests/test_harvest_fleet_runs_cache_key.py` is self-contained (its own fixture helpers and
its own `gh` stub, restated), and every harvest in it passes `--engine-version 0.3.0`.
**BASE facts:** (generated at d26bbdc)
- `build_fleet_bundle` at `skills/ultralearn/scripts/harvest_fleet_runs.py:374` blob 9552df9
- `runId` at `fleet/tests/test_run_main.mjs:372` blob ef647cb
- `target` at `fleet/doctor.mjs:137` blob f9a1174
- `fetch_evidence` at `skills/ultralearn/scripts/harvest_fleet_runs.py:169` blob 9552df9
- `transcripts` at `fleet/run-engine.mjs:572` blob 3148252
- `sha` at `fleet/janitor.mjs:210` blob c8d8258
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `skills/ultralearn/SKILL.md` blob a86faa2
- `ts` at `fleet/run-engine.mjs:707` blob 3148252
- `tests/test_harvest_fleet_runs.py` blob 2599318
- `tests/test_harvest_evidence.py` blob 280b368
- `test_main_is_incremental_and_force_overrides` at `tests/test_harvest_fleet_runs.py:271` blob 2599318
- `tests/test_harvest_fleet_runs.py:271` blob 2599318 line 271 `def test_main_is_incremental_and_force_overrides(tmp_path, c`
- `test_a_failure_beside_an_already_cached_run_is_not_a_total_failure` at `tests/test_harvest_fleet_runs.py:395` blob 2599318
- `ref` at `fleet/janitor.mjs:209` blob c8d8258
- `FailedLookup` at `skills/ultralearn/scripts/_outcome.py:25` blob b3c8566
- `_gh_api` at `skills/ultralearn/scripts/harvest_fleet_runs.py:114` blob 9552df9
- `_gh_api_listing` at `skills/ultralearn/scripts/harvest_fleet_runs.py:143` blob 9552df9
- `content` at `fleet/publish-fold.mjs:706` blob 6797792
- `discover_run_dirs` at `skills/ultralearn/scripts/harvest_fleet_runs.py:273` blob 9552df9
- `_read_json` at `skills/ultralearn/scripts/harvest_fleet_runs.py:55` blob 9552df9
- `test_t6_a_swept_run_lands_from_the_tag_in_exactly_eight_calls` at `tests/test_harvest_fleet_runs.py:687` blob 2599318
- `tests/test_harvest_fleet_runs.py:687` blob 2599318 line 687 `def test_t6_a_swept_run_lands_from_the_tag_in_exactly_eight_`
- `test_t6_a_run_on_the_branch_is_read_exactly_as_at_base` at `tests/test_harvest_fleet_runs.py:723` blob 2599318
- `test_t2_the_listing_and_every_listed_file_are_read_at_the_resolved_ref` at `tests/test_harvest_fleet_runs.py:902` blob 2599318
- `bundle_lookups` at `skills/ultralearn/scripts/merge_ledger.py:150` blob cfd487c
- `test_bundle_lookups_reads_cache_and_fails_closed` at `tests/test_merge_ledger.py:104` blob 91555f3
- `test_bundle_lookups_expands_tilde` at `tests/test_merge_ledger.py:271` blob 91555f3
- `tests/test_merge_ledger.py` blob 91555f3
- `r1` at `fleet/tests/test_janitor.mjs:403` blob 6703100
- `merge_findings` at `skills/ultralearn/scripts/merge_ledger.py:58` blob cfd487c
- `tests/test_ultralearn_docs.py` blob 204c1db
- `origin` at `fleet/launch.mjs:381` blob 6150d59
- `home` at `fleet/tests/_sandbox_boot_helpers.mjs:605` blob bcf3734
- `skills/ultralearn/scripts/merge_ledger.py` blob cfd487c

**Proof:**
- Test: `tests/test_harvest_fleet_runs_cache_key.py`
- Test: `tests/test_merge_ledger.py`
- Legs: (a) two local run directories, both `runId` `run-30`, with `run:open` timestamps
  `1788130000000` and `1788735000000` (UTC days `2026-08-30` and `2026-09-06`), harvested into
  one cache leave exactly `run-30-2026-08-30` and `run-30-2026-09-06` under `runs/`, each with a
  `bundle.json` whose `runId` is `run-30`; and a directory whose events carry no `ts` at all
  writes to `runs/run-30/` [M1]; (b) a run directory with `evidence-ref.json` = `{"target":
  "popmechanic/smoke", "ref": "ultra/evidence/run-7", "sha": "a" * 40}` bundles with
  `evidenceSha == "a" * 40`, and a local directory without the file bundles with `evidenceSha`
  `None` after a JSON round-trip [M2]; (c) with a stub `gh` answering the six files at the tag, the commits
  path `repos/popmechanic/smoke/commits/ultra/evidence/run-7` with `{"sha": "a" * 40}` and the
  listing 404, the stub's argv log shows the commits path immediately after the sixth file read
  and immediately before the listing, `<dest>/evidence-ref.json` carries that sha and that ref,
  and the bundle's `evidenceSha` is `"a" * 40`; and with the commits path absent from the stub's
  map the harvest exits 0, the bundle's `evidenceSha` is `None`, and stderr has one
  `harvest_fleet_runs:` line naming run `7` and the ref [M3]; (d) a first harvest with the
  commits path answering `"a" * 40`, then a second with the same map, prints `0 bundle(s)` and
  `1 already cached` on the second; then a third harvest with the commits path answering
  `"b" * 40` prints `1 bundle(s)` and `0 already cached` and the cached `bundle.json`'s
  `evidenceSha` is now `"b" * 40` — a harvester that skips on the key alone prints `0 bundle(s)`
  on the third and fails; a fourth with the same `"b"` map and `--force` prints
  `1 bundle(s)`; and a LOCAL run directory (no `evidence-ref.json`, so both shas are `None`)
  harvested twice into one cache prints `1 already cached` and `0 bundle(s)` on the second
  harvest — an implementation that rebuilds every sha-less run fails it [M4]; (e) in `tests/test_merge_ledger.py`, under a comment naming this task: a
  cache holding `runs/run-24/bundle.json` (`runId` `run-24`, `origin` `home`, `events.openedAt`
  `1756500000000`, epoch `0.2.25`) and `runs/run-24-2026-09-05/bundle.json` (`runId` `run-24`,
  `origin` `foreign`, `events.openedAt` `1788600000000`, epoch `0.3.17`) answers
  `origin_lookup("run-24") == "foreign"` and `engine_lookup("run-24") == "0.3.17"`; a cache
  holding only `runs/run-30-2026-08-30/bundle.json` with `runId` `run-30` answers
  `origin_lookup("run-30") == "home"`; a cache holding only the BARE directory
  `runs/run-30/bundle.json` with `runId` `run-30`, `origin` `home` and `events.openedAt`
  `1788130000000` answers `origin_lookup("run-30") == "home"` — an implementation that globs
  only dated directories fails it; and `origin_lookup("run-99")` on that cache is `"foreign"`
  with `engine_lookup("run-99") is None` [M5]; (f) the rewritten BASE pins in
  `tests/test_harvest_fleet_runs.py` and `tests/test_harvest_evidence.py` pass, including the
  nine-call and eight-call counts and the unchanged six-call count [M1] [M3]; (g) the second
  `Run:` below — the Verb 1 section's text, joined, matches `runs/run-<N>-<date>/` followed by
  `evidenceSha` — exits 0, and the third exits 0 only when `keyed by the fleet` is absent from
  that section [M6]; (h) the same two directories bundle with `evidenceRef ==
  "ultra/evidence/run-7"` and `evidenceRef` `None` respectively [M2]; (i) the same two
  directories bundle with `target == "popmechanic/smoke"` and `target` `None` respectively [M2].
- Run: python3 -m pytest -q tests/test_harvest_fleet_runs_cache_key.py tests/test_merge_ledger.py tests/test_harvest_fleet_runs.py tests/test_harvest_evidence.py tests/test_ultralearn_docs.py
- Run: sed -n '/^## Verb 1/,/^## Verb 2/p' skills/ultralearn/SKILL.md | tr '\n' ' ' | grep -q 'runs/run-<N>-<date>/.*evidenceSha'
- Run: sed -n '/^## Verb 1/,/^## Verb 2/p' skills/ultralearn/SKILL.md | grep -c 'keyed by the fleet' | grep -qx 0

**Stale-if:**
- issue-closed: #698
- path-absent: `skills/ultralearn/scripts/merge_ledger.py`
