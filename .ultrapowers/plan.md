# Transcript slice on the record

**Grammar:** claims-v1

**Claim:** the sandbox commits a per-worker transcript slice (tool calls, the final message, no
file contents) beside the receipts — sized, say, under 200 KB per run (elicited)

**Goal:** #702, branch (a), chosen 2026-09-06 (decision E of the analysis session); the Claim
above is that issue's desired-state (a) sentence verbatim, confirmed by the operator. The record
keeps a slice of each worker's Claude session. Today the workers' transcripts live under the
run's `CLAUDE_CONFIG_DIR` on the sandbox and die with the VM, so four of ten 0.3.17 readers read
`_no transcript found_`. After this run the engine writes `<run dir>/transcripts/<sessionId>.jsonl`
at every worker's end — the transcript's own jsonl record shape, reduced to tool calls with their
path-shaped inputs, result sizes, and bounded text — the boot script commits that directory
beside the receipts, the contract names it, and the ultralearn harvester lands it and reads it
first, so the `_no transcript found_` branch stops being the common case.
**Closes:** #702

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`) + bash (`fleet/sandbox-boot.sh`) + Python 3
(`skills/ultralearn/scripts/*.py`); the suite is `python3 -m pytest` from the repo root, which
bridges every `fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` and runs
`tests/test_*.py`.

**Parallelization rationale:** wave 1 width 2 — the two tasks share no `Produces:`/`Consumes:`
and no file. Task 1 is the engine side (the slice is written into the run dir); Task 2 is the
record side (the boot script copies it, the contract names it, the harvester lands and reads it).
The only thing they share is the literal in both Contexts — the path
`<run dir>/transcripts/<sessionId>.jsonl` and the record shape — which orders nothing: Task 2
consumes the shape, not Task 1's runtime behaviour. No chain.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/kernel/ skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- Check: `bash -c 'for f in publish merge_pr do_boot render_card do_deadman; do diff <(git show $ULTRA_BASE:fleet/sandbox-boot.sh | sed -n "/^$f() *{/,/^}/p") <(sed -n "/^$f() *{/,/^}/p" fleet/sandbox-boot.sh) || exit 1; done'`
- No slice carries file contents: a `tool_use` input other than the six path-shaped scalar keys
  (`file_path`, `path`, `command`, `pattern`, `glob`, `description`) never rides, a
  `tool_result` body is replaced by its size, a `thinking` block and a record's `toolUseResult`
  key are dropped, and a rendered slice shows only those same six input keys.
- The boot script's `publish`, `merge_pr`, `do_boot`, `render_card` and `do_deadman` functions
  are the base's bytes — a concurrent run edits them, and this plan touches only
  `collect_evidence`.
- `fleet/CONTRACT.md` changes only inside the `ultra/evidence-run-<N>` bullet; the
  `**The two tags` bullet and the state list are the base's bytes.

**Acceptance:** suite — the committed suite is the verification.


### Task 1: The engine writes each worker's transcript slice

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-worker.mjs`
- Test: `fleet/tests/test_run_worker.mjs`

**Claim:** After a run I find, beside the receipts, one small file per worker session that shows
which tools the worker called and on what paths, how big each result was, and what it said last —
and never the contents of any file it read or wrote. (derived)
Machine: M1. When `agent()` returns for a worker whose session transcript exists at
`<env.CLAUDE_CONFIG_DIR>/projects/<any directory>/<sessionId>.jsonl`, the file
`<dirname(workersDir)>/transcripts/<sessionId>.jsonl` exists, and the sink has received, after
that worker's `worker:end`, one event `{kind:'transcript:slice', label, sessionId, bytes}` whose
`bytes` equals the written file's byte length; a label dispatched twice writes a second file named
by `sessionIdFor(runId, label + '#2')`. M2. `sliceTranscript(jsonl)` returns jsonl whose every
line is a JSON object; the objects are the source's `user` and `assistant` records in source
order (plus at most one elision record), each reduced to the top-level keys `type`, `uuid`,
`parentUuid`, `timestamp`, `sessionId`, `message`, with `message` reduced to `role`, `model`,
`content`; a string `content` stays a string; a list `content` keeps its `text`, `tool_use` and
`tool_result` blocks in order and drops every other block type; a record of any other `type`
and the `toolUseResult` key are absent from the output. M3. Every `tool_use` block in the output
has exactly the keys `type`, `id`, `name`, `input`, and its `input` holds only those of
`file_path`, `path`, `command`, `pattern`, `glob`, `description` whose source value is a string,
number or boolean, each string cut to its first 500 characters — every other input key is
absent. M4. Every `tool_result` block in the output has exactly the keys `type`, `tool_use_id`,
`is_error` (when the source had it) and `content`, where `content` is the string
`[tool_result: <n> chars]` with `<n>` the length of the source content flattened as
`_readers.block_text` flattens it (a string as-is; a list as its blocks' `text` joined by `\n`),
except that a block with `is_error === true` gets `[tool_result: <n> chars, is_error] ` followed
by the first 200 characters of that flattened content. M5. The last `text` block of the last
`assistant` record is kept up to its first 3,000 characters; every other `text` block, and every
string `message.content`, is kept up to its first 2,000 characters; a text that was cut ends
with `…[truncated <k> chars]` where `<k>` is the number of characters removed. M6. The output is
at most 12,000 bytes: when the reduced records total more, whole records are dropped from the
middle — the head keeps records from the start while their cumulative bytes, including the one
elision line, stay at or under 8,000, the tail keeps records from the end while their cumulative
bytes stay at or under 4,000 — and exactly one line `{"type":"system","subtype":"elided","records":<n>}`
sits between them with `<n>` the count dropped; a run of 14 workers whose transcripts are each
100 KB leaves a `transcripts/` directory totalling under 200,000 bytes. M7. When no
`<sessionId>.jsonl` exists under `<env.CLAUDE_CONFIG_DIR>/projects/`, or `CLAUDE_CONFIG_DIR` is
unset, no file is written under `transcripts/`, the sink receives one
`{kind:'transcript:missing', label, sessionId}` event, and `agent()`'s return value and its
`worker:end` event are what they were at BASE; a transcript that cannot be read is
`transcript:missing` with a `detail` string, never a rejection of `agent()`. M8. A `Write`
tool_use whose input carries a `content` string and a `tool_result` whose content carries a
file body leave neither string anywhere in the output.

**Authorized-by:** #702, branch (a), chosen 2026-09-06 (decision E of the analysis session)

**Interfaces:**
- Consumes: `none`
- Produces: `sliceTranscript(jsonl: string) -> string`
- Produces: `writeTranscriptSlice({ configDir, runDir, sessionId }) -> { bytes: number } | null`

**Context:** The site is `createRunWorker`'s `agent()` in `fleet/run-worker.mjs`, at the block
that writes `stdout`, `stderr` and `envelope.json` into the worker's dir (the `dir` from
`nextWorkerDir`) and then emits `worker:end` — the slice is written after that block and its
event emitted after `worker:end`, before the `switch (verdict.outcome)`. The run directory is
`path.dirname(workersDir)`, the same derivation `recordEnvelopeDenials` uses for
`confine-denials.jsonl`; `workersDir` may be null (a caller without evidence), in which case
nothing is written and nothing is emitted. The worker's `CLAUDE_CONFIG_DIR` is `cfg.env.CLAUDE_CONFIG_DIR`
(`run-main.mjs` sets it to `<run dir>/claude`, and the CLI writes each session to
`<CLAUDE_CONFIG_DIR>/projects/<cwd-slug>/<sessionId>.jsonl` — the slug is the worker's cwd with
`/` turned into `-`, which is why the search is over every subdirectory of `projects/`, never a
computed slug). The session id is the one already in hand at that site: `sessionIdFor(runId,
label)` for the first dispatch and `sessionIdFor(runId, label + '#' + attempt)` for a retry.
Like `recordEnvelopeDenials`, the slice is best-effort: a throw anywhere in finding, reading,
reducing or writing is caught, reported as `transcript:missing` with `detail`, and never
changes what `agent()` returns. Export two pure pieces so the exam can drive them without a
process: `sliceTranscript(jsonl)` (string in, string out — the whole reduction, M2–M6) and
`writeTranscriptSlice({ configDir, runDir, sessionId })` (finds the transcript, writes
`<runDir>/transcripts/<sessionId>.jsonl`, returns `{ bytes }`, or `null` when there is no
transcript; `mkdirSync` the directory recursively). The exam's rig is the fake `claude` executable
already in `fleet/tests/test_run_worker.mjs` (`mkAgent`, `workersDir = <tmp>/workers`, so the run
dir is `<tmp>`), extended by planting a transcript under a fresh `CLAUDE_CONFIG_DIR` in the
`env` override; the retry naming is the `impl:T9` shape already tested there. The shared literal —
Task 2 reads this layout and shape from the evidence branch, so both must agree: the file is
`<run dir>/transcripts/<sessionId>.jsonl`; a slice reads, line by line,

    {"type":"assistant","uuid":"…","parentUuid":"…","timestamp":"…","sessionId":"…","message":{"role":"assistant","model":"…","content":[{"type":"text","text":"…"},{"type":"tool_use","id":"toolu_…","name":"Read","input":{"file_path":"/…"}}]}}
    {"type":"user","uuid":"…","parentUuid":"…","timestamp":"…","sessionId":"…","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_…","content":"[tool_result: 4821 chars]"}]}}
    {"type":"system","subtype":"elided","records":37}

— every line an object; `message.content` either a string or a list of `text` / `tool_use` /
`tool_result` blocks, so `_readers.records()` and `_readers.iter_blocks_indexed()` in
`skills/ultralearn/scripts/_readers.py` read it exactly as they read a live transcript. What a
live transcript carries and the slice must not: a `thinking` block (its `thinking` text and
`signature`), the user record's top-level `toolUseResult` (the full tool output — a `Read`'s
file body rides there as well as in the `tool_result` block), `Write`/`Edit`/`MultiEdit` inputs
(`content`, `new_string`, `old_string`, `edits`), `Agent`'s `prompt`, and every record type
other than `user`/`assistant` (`attachment`, `queue-operation`, `last-prompt`, `custom-title`,
`bridge-session`, `pr-link`, `system` and whatever else the CLI adds later — drop by allowlist,
not by denylist). The six kept input keys are the path-shaped ones a lens needs to see what a
worker touched; a `Bash` `command` can carry a heredoc with a file body, which is why each kept
string is cut to 500 characters. The 12,000-byte cap is `fleet_slice.WORKER_BUDGET`'s number
applied at the writer instead of the reader: head 8,000 + tail 4,000 elides the middle, where
the brief is at the top and the conclusion at the bottom — the ultralearn slicer's own rule.
Text bounds resolve the brief's "final message kept whole" against that cap: a final assistant
text longer than the tail budget would be the record dropped, so it is bounded at 3,000
characters (every other text at 2,000, the prompt is already in the worker dir's `cmd`), and the
envelope's `result` still carries the worker's whole final message on the sandbox. The event
kinds `transcript:slice` and `transcript:missing` are new; `fleet_events.summarize_events`
counts unknown kinds and ignores them, and the engine's event log accepts any `kind`.

**Proof:**
- Test: `fleet/tests/test_run_worker.mjs`
- Legs, under a comment naming this task (`#702 Task 1`), in the same file: (a) with
  `CLAUDE_CONFIG_DIR` set to a fresh directory holding
  `projects/-some-slug/<sessionIdFor('run-24','impl:T7')>.jsonl` (a transcript of a `user` text
  record, an `assistant` record with a `text` block and a `Read` `tool_use`, and a `user` record
  with its `tool_result`), `mkAgent('success')('x', { label: 'impl:T7', … })` returns
  `structured_output` as before, `<tmp>/transcripts/<that sessionId>.jsonl` exists, and the
  events after that label's `worker:end` include exactly one `transcript:slice` whose `label`,
  `sessionId` match and whose `bytes` equals `fs.statSync(file).size`; dispatching `impl:T7` a
  second time with a transcript planted under `sessionIdFor('run-24','impl:T7#2')` writes that
  second file [M1]; (b) `sliceTranscript` over a source of one `attachment` record, one `system`
  record, a `user` record carrying `toolUseResult`, `cwd`, `gitBranch` and an `assistant` record
  whose content holds a `thinking`, a `text` and a `tool_use` block yields exactly two lines, in
  order `user` then `assistant`, each parsing to an object whose key set is a subset of
  `{type, uuid, parentUuid, timestamp, sessionId, message}`, whose `message` keys are a subset
  of `{role, model, content}`, and whose serialized text contains neither `toolUseResult`,
  `gitBranch`, `thinking` nor the attachment record's bytes; a source whose `message.content`
  is the string `"yes"` keeps it as the string `"yes"` [M2]; (c) a `tool_use` of
  `Edit` with input `{file_path, old_string, new_string}` comes out with `input` exactly
  `{file_path}`; a `Bash` with `{command: "x".repeat(900), description: "d", timeout: 5}` comes
  out with `command` of length 500, `description: "d"`, and `timeout` — a non-allowlisted key —
  absent; an `Agent` with `{prompt, description}` comes out with `description` only; the block's
  keys are exactly `type, id, name, input` [M3]; (d) a `tool_result` whose content is a
  1,234-character string becomes `content: "[tool_result: 1234 chars]"`; one whose content is a
  list of two text blocks of 10 and 20 characters becomes `[tool_result: 31 chars]`; one with
  `is_error: true` and a 700-character content becomes `[tool_result: 700 chars, is_error] ` +
  its first 200 characters, and keeps `is_error: true`; none of the three retains the source
  content [M4]; (e) an `assistant` text of 5,000 characters that is NOT the last assistant text
  becomes its first 2,000 characters + `…[truncated 3000 chars]`; the last `assistant` record's
  last text of 3,500 characters becomes its first 3,000 + `…[truncated 500 chars]`; a `user`
  string content of 2,500 characters becomes 2,000 + `…[truncated 500 chars]`; a 1,999-character
  text is unchanged [M5]; (f) a source of 400 alternating `user`/`assistant` records whose
  reduced form totals over 40,000 bytes yields output of at most 12,000 bytes, containing exactly
  one line parsing to `{"type":"system","subtype":"elided","records":n}` with `n` equal to the
  source record count minus the other output lines, the first output line being the source's
  first record and the last output line the source's last record, the bytes before the elision
  line at most 8,000 including that line and the bytes after it at most 4,000; a source whose
  reduced form is under 12,000 bytes has no `elided` line; and `writeTranscriptSlice` over 14
  sessions each planted with a 100 KB transcript leaves `transcripts/` with 14 files whose sizes
  sum to under 200,000 bytes [M6]; (g) `mkAgent('success')` with `CLAUDE_CONFIG_DIR` pointing at
  a directory whose `<env.CLAUDE_CONFIG_DIR>/projects/` holds no `<sessionId>.jsonl` (and once
  where `projects/` itself is absent) returns `structured_output`, leaves no
  `transcripts/<sessionId>.jsonl`, and
  the events carry exactly one `transcript:missing` with that `label` and `sessionId` and no
  `transcript:slice`; with `CLAUDE_CONFIG_DIR` deleted from the env the same holds; with a
  transcript planted as a directory instead of a file, the event is `transcript:missing` with a
  string `detail` and `agent()` still returns `structured_output` [M7]; (h) a source carrying a
  `Write` tool_use with `input.content` equal to the sentinel `FILE-BODY-SENTINEL-…` (a 3,000-char
  string) and a `tool_result` whose content is a second sentinel of 5,000 characters yields
  output from which both sentinels are absent — `output.includes(sentinel)` is false for each,
  and the first 40 characters of each sentinel are absent from the output too [M8].

**Stale-if:**
- path-absent: `fleet/run-worker.mjs`
- path-absent: `fleet/tests/test_run_worker.mjs`
- issue-closed: #702


### Task 2: The record carries the slices and the harvester reads them

**Type:** implementation

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Modify: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- Modify: `skills/ultralearn/scripts/fleet_slice.py`
- Test: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`
- Test: `tests/test_harvest_fleet_runs.py`
- Test: `tests/test_harvest_evidence.py`
- Test: `tests/test_fleet_slice.py`

**Claim:** After a run, the slices are on the evidence branch beside the receipts, the contract
says so, and when I harvest that run ultralearn's readers see each worker's slice instead of
`_no transcript found_`. (derived)
Machine: M1. `collect_evidence` in `fleet/sandbox-boot.sh` copies every
`<run dir>/transcripts/*.jsonl` to `<evidence worktree>/.ultrapowers/runs/<N>/transcripts/<same name>`
byte for byte when `<run dir>/transcripts/` exists; a run whose engine wrote no `transcripts/`
directory commits none; and because the function runs at every transition, a completed boot
leaves exactly one `transcripts/` directory with no second transcripts directory nested inside it. M2.
`fleet/CONTRACT.md`'s `ultra/evidence-run-<N>` bullet names `transcripts/<sessionId>.jsonl`
(one per worker session, present when the engine wrote them), still opens with the line the
approval-evidence sim locates, and every byte of `fleet/CONTRACT.md` outside the
`- **The three branches` bullet — the state list (`- **status.json:**`), the `- merge:`
sub-bullet and the `**The two tags` bullet among them — is BASE's, with the diff inside that
bullet removing at most two lines and adding at most three. M3. In
`fetch_evidence`, after the six `EVIDENCE_FILES` reads have resolved a ref and `events.jsonl`
has landed, one more `gh api` read is issued —
`repos/<target>/contents/.ultrapowers/runs/<N>/transcripts?ref=<that ref>` — and for every
entry of its answer (a JSON array of `{name, path, type, …}`) with `type == "file"` — and for
no entry of any other `type` — one read
`repos/<target>/contents/.ultrapowers/runs/<N>/transcripts/<name>?ref=<that ref>` whose decoded
bytes are written to `<dest>/transcripts/<name>`; a listing that answers non-zero (a 404) is one
`harvest_fleet_runs:` line on stderr, no `transcripts/` directory, no `FAILED-LOOKUP:`, and
exit 0; a run that lands nothing, or lands no `events.jsonl`, issues no listing read. M4.
`fleet_slice.find_transcript(projects_root, session_id, run_dir=None)` returns
`<run_dir>/transcripts/<session_id>.jsonl` when `run_dir` is given and that file exists,
otherwise the first `<projects_root>/*/<session_id>.jsonl`, otherwise `None`;
`build_slice(…, run_dir=None)` hands it through, `build_fleet_bundle` passes the run dir, and a
harvested run directory holding `transcripts/<sessionId>.jsonl` for a worker renders that
worker's section from it, with `_no transcript found_` absent from `slice.md`. M5.
`_worker_lines` renders a `tool_use` block as `**tool_use:** <name> <json.dumps(kept, sort_keys=True)>`
where `kept` holds only the six keys `file_path`, `path`, `command`, `pattern`, `glob`,
`description` of the block's `input`, so a `content`, `new_string` or `prompt` input never
appears in a rendered slice.

**Authorized-by:** #702, branch (a), chosen 2026-09-06 (decision E of the analysis session)

**Interfaces:**
- Consumes: `none`
- Produces: `find_transcript(projects_root, session_id, run_dir=None) -> Path | None`
- Produces: `build_slice(timeline_md, workers, projects_root, budget=WORKER_BUDGET, workers_root=None, envelope_budget=ENVELOPE_BUDGET, run_dir=None) -> str`

**Context:** HARD CONSTRAINT on `fleet/sandbox-boot.sh`: a concurrent run is editing `publish`,
`merge_pr`, `do_boot`, `render_card` and `do_deadman` in the same file; this task edits the body
of `collect_evidence` (lines `collect_evidence() {` … `}`) and nothing else in the file — a
Global Constraint diffs those five functions against BASE on every pass. `collect_evidence`
today copies the receipts by name from `run_dir="$(run_dir_path)"` into
`dest="$EVIDENCE_DIR/$EVIDENCE_PATH"`; add, after its `for f in …` loop, a copy of the
directory's files — `mkdir -p "$dest/transcripts"` then `cp "$run_dir/transcripts/"*.jsonl
"$dest/transcripts/"` under `[ -d "$run_dir/transcripts" ]` — never `cp -R` of the directory
itself, which on the second transition nests a second transcripts directory inside the first copy
(the function runs at every `write_status` transition and once more at `fail`). The
`ls "$dest"` log line then shows `transcripts` among the names. The same HARD CONSTRAINT on
`fleet/CONTRACT.md`: the concurrent run edits the state list and the merge bullet, so this task
adds `transcripts/<sessionId>.jsonl` to the `ultra/evidence-run-<N>` bullet only (the bullet
that begins `` - `ultra/evidence-run-<N>` — the run's record under `.ultrapowers/runs/<N>/`: ``
and lists `status.json`, `receipt.json`, … `claude-version.txt`, `approve-receipt.json`,
`standing-approval.json`); `fleet/tests/test_sandbox_boot_approval_evidence.mjs`'s M3 test
locates that bullet by the regex `/ultra\/evidence-run-<N>. — the run/` on its opening line and
`tests/test_docs_agree_with_code.py` pins the `**The two tags` bullet — keep the opening line
and leave the two-tags bullet alone. The shared literal — Task 1 writes this layout and shape
on the sandbox, so both must agree: the engine writes `<run dir>/transcripts/<sessionId>.jsonl`
(`<run dir>` is the engine's run directory, `$(run_dir_path)` in the boot script and the
`run_dir` the harvester's `discover_run_dirs` returns; `<sessionId>` is the `sessionId` of the
worker's `worker:start`/`worker:end` events) and a slice reads, line by line,

    {"type":"assistant","uuid":"…","parentUuid":"…","timestamp":"…","sessionId":"…","message":{"role":"assistant","model":"…","content":[{"type":"text","text":"…"},{"type":"tool_use","id":"toolu_…","name":"Read","input":{"file_path":"/…"}}]}}
    {"type":"user","uuid":"…","parentUuid":"…","timestamp":"…","sessionId":"…","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_…","content":"[tool_result: 4821 chars]"}]}}
    {"type":"system","subtype":"elided","records":37}

— every line an object; `message.content` a string or a list of `text` / `tool_use` /
`tool_result` blocks; a `tool_use` `input` holding only path-shaped scalars under the six keys
`file_path`, `path`, `command`, `pattern`, `glob`, `description`; a `tool_result` `content`
already the size string; at most 12,000 bytes per file, so 14 workers are under 200 KB. Because
the shape is the transcript's own, `_readers.records()` and `iter_blocks_indexed()` read a
slice unchanged and `worker_slice` renders its text blocks as today; what today's
`_worker_lines` cannot show is a `tool_use` block (`block_text` returns `""` for it, so it is
skipped), which is why M5 adds a rendering — restricted to the six keys so a live, unreduced
transcript under `projects/` renders no `Write` `content` either. The harvester at BASE:
`EVIDENCE_FILES` is the six-tuple the contract lists, `fetch_evidence` reads each with
`_gh_api(_evidence_api_path(target, run, name, ref))`, probing the branch first and the tag once
(the branch/tag resolution is pinned by the `test_t6_*` tests to exact call sequences — seven
calls for a swept run, six for a run on the branch, seven for a run on neither ref, six for
leg (e)); `_gh_api` decodes a file envelope's `content` and returns `None` on non-zero. The
GitHub contents API answers a directory path with a JSON array of entries (`name`, `path`,
`sha`, `size`, `type: "file"`, `download_url`, no `content`) and honours the same `?ref=`, so
the listing needs its own decoder — `_gh_api` calls `.get("content")` on the parsed body and
would raise on a list. The listing read is one call, issued after the six-file loop and after
the `events.jsonl` check, at the ref the loop resolved; each listed file is then one contents
read at the same ref. The exact-count pins move accordingly and this task owns them: the swept
run becomes eight calls (the listing at the tag ref, answering 404 in that fixture) plus one
per listed file, the branch run seven, leg (e) seven, and the neither-ref run stays at seven
with no listing read because `FailedLookup` is raised before it. The stub `gh` in
`tests/test_harvest_fleet_runs.py` (`_T6_GH_STUB`, installed by `_t6_install_gh` on a `PATH`
of its directory alone) answers from a JSON map keyed by the `repos/…?ref=…` argument and
wraps every string answer as a file envelope; a listing answer is a JSON array, so the stub
gains one branch — an answer that is a list is printed as that list, unwrapped — and the
existing file answers are untouched. `build_fleet_bundle` computes `projects_root = run_dir /
"claude" / "projects"` and calls `build_slice(…, workers_root=run_dir / "workers")`; it now also
passes `run_dir=run_dir`, and `find_transcript` prefers `<run_dir>/transcripts/<sid>.jsonl`
because a harvested run directory has no `claude/projects/` at all (the branch never carried
it) while a local sandbox-logs tarball has both. `tests/test_fleet_slice.py`'s
`_write_transcript(projects_root, slug, session_id, turns)` helper writes the `projects/`
layout; a `transcripts/` fixture is `run_dir / "transcripts" / f"{sid}.jsonl"`. Every new leg
extends the three existing exam files under a comment naming this task (`#702 Task 2`); no
sibling test file is created.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`
- Test: `tests/test_harvest_fleet_runs.py`
- Test: `tests/test_fleet_slice.py`
- Run: `test "$(grep -c 'transcripts/<sessionId>.jsonl' fleet/CONTRACT.md)" -ge 1 && test "$(git diff $ULTRA_BASE -- fleet/CONTRACT.md | grep -c '^-[^-]')" -le 2 && test "$(git diff $ULTRA_BASE -- fleet/CONTRACT.md | grep -c '^+[^+]')" -le 3`
- Run: `python3 -m pytest -q tests/test_docs_agree_with_code.py`
- Run: `bash -c 'diff <(git show $ULTRA_BASE:fleet/CONTRACT.md | sed "/^- \*\*The three branches/,/^- \*\*The two tags/{/^- \*\*The two tags/!d;}") <(sed "/^- \*\*The three branches/,/^- \*\*The two tags/{/^- \*\*The two tags/!d;}" fleet/CONTRACT.md)'`
- Legs, under a comment naming this task (`#702 Task 2`) in each file: (a) in
  `test_sandbox_boot_approval_evidence.mjs`, an engine stub spliced (the `APPROVAL_SNIPPET`
  shape, spliced before `ENGINE_EXIT`) to write two files under `$run_dir/transcripts/`, named
  for the session ids `aaaa-1` and `bbbb-2` with the `.jsonl` suffix, holding two distinct
  non-trivial byte strings, boots to completion, and the same two names exist under
  `<evidence run dir>/transcripts/` and are `deepEqual` as buffers to the run dir's; the bare
  run (`STUB_VERDICT: 'PASS'`, no transcripts written) has no `transcripts` entry in
  `readdirSync(evidenceRunDir)`; and in the transcripts run `readdirSync(<evidence run
  dir>/transcripts)` is exactly the two names — no `transcripts` directory nested inside the
  copied one [M1]; (b) the first `Run:` exits 0 and fails when the bullet does not name
  `transcripts/<sessionId>.jsonl`, or when more than two base lines are removed or more than
  three added [M2]; (c) the third `Run:` exits 0: it excises the `- **The three
  branches` bullet (from its own line up to, not including, the `- **The two tags` line) from
  both BASE's and the tree's `fleet/CONTRACT.md` and `diff`s the remainders, so any changed byte
  outside that bullet — a one-line replacement in the `- **status.json:**` state list, a word in
  the `- merge:` sub-bullet, anything in the `**The two tags` bullet — is a non-empty diff and
  exit 1 [M2]; (d) the second
  `Run:` (`tests/test_docs_agree_with_code.py`) exits 0 and the sim's existing test that
  `CONTRACT.md`'s evidence-branch bullet names both approvals still passes, both locating the
  bullet by its unchanged opening line [M2]; (e) in `test_harvest_fleet_runs.py`, with the
  stub `gh` answering the six files at the branch ref, the listing
  `…/transcripts?ref=ultra/evidence-run-7` as a three-entry array (names `aaaa-1` and `bbbb-2`
  with the `.jsonl` suffix, `type: "file"`, and a third entry named `nested` with `type: "dir"`)
  and each `…/transcripts/<name>?ref=ultra/evidence-run-7`
  as a slice body whose `sessionId` is `sess-1` for the `aaaa-1` file — which is the
  `sessionId` of the fixture's `worker:start`/`worker:end` — the harvest exits 0 and
  `_t6_refs(log)` is exactly the six file paths, then the listing path, then the two `.jsonl`
  file paths, in that order — nine calls, no path naming `nested`; the fetched `<tmp>/evidence/7/transcripts/` holds both files byte-equal
  to the stub's bodies; and the bundle's `slice.md` carries a string from `sess-1`'s slice text
  and does not contain `_no transcript found_` [M3, M4]; (f) with the same six files and the
  listing key absent from the stub map (a 404), the harvest exits 0, `_t6_refs(log)` is exactly
  the six file paths then the listing path — seven calls — no `transcripts/` directory exists
  under the fetch destination, stderr carries one `harvest_fleet_runs:` line naming
  `transcripts` and no `FAILED-LOOKUP:` line, and the bundle lands; the `test_t6_*` pins are
  re-stated to the moved counts: the swept run is eight calls with the listing at the tag ref
  eighth, the `test_t6_an_absence_after_a_file_has_landed_never_falls_back_to_the_tag` run is
  seven with the listing at the branch ref seventh, and the neither-ref run is still exactly
  seven calls with no path containing `transcripts`; and in `tests/test_harvest_evidence.py`
  the pins `len(calls) == 6` in `test_evidence_run_fetches_exactly_the_six_contents_paths_and_bundles`
  and `test_absent_engine_log_and_receipt_are_skips_and_the_run_still_bundles` become seven
  with the listing path appended to `_expected_paths()`, while
  `test_absent_events_jsonl_is_a_failed_lookup_naming_the_run_and_branch` keeps its count and
  its argv log has no path containing `transcripts`, because a run whose `events.jsonl` did not
  land raises `FailedLookup` before any listing is read [M3]; (g) in `test_fleet_slice.py`, with
  `<run_dir>/transcripts/<sid>.jsonl` and `<projects_root>/<slug>/<sid>.jsonl` both present,
  `find_transcript(projects_root, sid, run_dir=run_dir)` is the `transcripts/` path; with only
  the `projects/` file it is that file; with `run_dir=None` it is the `projects/` file; with
  neither it is `None`; and `build_slice("tl", [{"label": "impl:1", "role": "implementer",
  "sessionId": sid}], <a projects_root with no file for sid>, run_dir=run_dir)` renders the
  `transcripts/` file's user text and not `_no transcript found_` [M4]; (h) `worker_slice` over
  a slice-shaped record whose `assistant` content holds a `Write` `tool_use` with `input:
  {"file_path": "/a/b.py", "content": "SECRET-BODY"}` and a `Read` `tool_use` with
  `{"file_path": "/c.py"}` yields text containing `**tool_use:** Write {"file_path": "/a/b.py"}`
  and `**tool_use:** Read {"file_path": "/c.py"}`, with `SECRET-BODY` absent; a `tool_use` whose
  input has none of the six keys renders as `**tool_use:** <name> {}` [M5].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- path-absent: `skills/ultralearn/scripts/fleet_slice.py`
- issue-closed: #702
