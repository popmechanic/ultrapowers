# 0013. Authoring records, provenance and the census

Status: accepted (2026-11-21)  
Governs: `skills/ultrawrite/scripts/authoring_census.py`, `skills/ultrawrite/scripts/check_provenance.py`, `skills/ultrawrite/scripts/extract_gate_input.py`, `skills/ultrawrite/scripts/routing.py`, `tests/test_authoring_census.py`, `tests/test_extract_gate_input.py`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Authoring census

- **skills/ultrawrite/scripts/authoring_census.py** — skills/ultrawrite/scripts/authoring_census.py imports explain_rounds, picks and recommended_picked from skills/ultrapowers/scripts/plan_check.py rather than recounting, so a run's census row and its `AUTHORING fact:` line cannot disagree.
- **_load_json (skills/ultrawrite/scripts/authoring_census.py)** — authoring_census.py reads a malformed or unreadable run record as absent rather than raising: it is a reading tool over a release's leftovers, and one run's bad file should not stop the census.
- **_totals_line (skills/ultrawrite/scripts/authoring_census.py)** — In authoring_census.py's totals line, risk_override counts only rows that carry a routing record, so records older than the authoring object are not part of its denominator; recommended_picked sums over every row.
- **render_register (skills/ultrawrite/scripts/authoring_census.py)** — authoring_census.py --register is the fixed record of what was offered: every option of every question gets a line whether or not it was picked, and a question with no recommendation prints '-' in that column on all its lines.
- **_fetch_file (skills/ultrawrite/scripts/authoring_census.py)** — `gh api .../contents/...` returns base64 content with embedded newlines, so _fetch_file in authoring_census.py decodes the whole string. Each call passes exactly two arguments (`api` and the contents path) so a caller's --gh wrapper sees the same shape as the real binary.
- **fetch_runs (skills/ultrawrite/scripts/authoring_census.py)** — fetch_runs in authoring_census.py reads each run's gate-verdicts.json and status.json from runs/<owner>-<repo>/<N>/ in the evidence repository at tag <owner>-<repo>/run-<N>. A run with no record is skipped whole (one stderr line, no directory), because no record means no row; a missing status leaves run_min '-' since the authoring numbers are still worth reading.
- **fetch_runs (skills/ultrawrite/scripts/authoring_census.py)** — fetch_runs in authoring_census.py always creates the destination directory, so a release where every run tag is missing prints an empty census instead of failing as a usage error.
- **skills/ultrawrite/scripts/authoring_census.py** — In the authoring census (skills/ultrawrite/scripts/authoring_census.py), `-` means the run's files do not carry a value, so a carried zero prints `0`, never `-`. `run_min` is whole minutes rounded down, so a 16m30s run reads 16. tests/test_authoring_census.py pins both readings with run-9 (rejected 0) and run-131 (16.5 minutes).

## Claim provenance

- **skills/ultrawrite/scripts/check_provenance.py** — plan_parse.py stays a pure function that reads only the provenance tag's form; resolving whether #NNN exists and still contains the operator's sentence verbatim needs the network, so it lives in skills/ultrawrite/scripts/check_provenance.py, run in ultrawrite's validation step. Derived claims are counted, never resolved, because their signature is the plan-level Claim. A signature covers the quote at signing time: a later issue edit does not invalidate a signed claim.
- **ANCHOR_RE (skills/ultrawrite/scripts/check_provenance.py)** — An Authorized-by slot may cite several anchors; check_provenance.py resolves every #NNN issue among them and leaves non-issue anchors (spec sections, decision records) unchecked, since no mechanism can check them.
- **fold (skills/ultrawrite/scripts/check_provenance.py)** — Claim quotes must match the issue body word for word, but the plan and GitHub wrap lines differently, so fold in check_provenance.py normalizes CRLF and collapses every whitespace run to one space on both sides before the substring test.
- **check_plan (skills/ultrawrite/scripts/check_provenance.py)** — check_plan in check_provenance.py skips elicited and derived claims (no issue stands behind them, so no gh call) but counts them, so they show in the success line rather than vanishing.
- **check_plan (skills/ultrawrite/scripts/check_provenance.py)** — The plan header's Claim signs like a task Claim: (elicited) costs no gh call and (quoted from #NNN) is string-matched against the issue body. check_provenance.py resolves it before the task loop through the same per-issue cache, so a header and a task quoting one issue cost one fetch, and failures name it 'plan-level claim'.
- **check_plan (skills/ultrawrite/scripts/check_provenance.py)** — A Claim that is only its provenance tag strips to an empty sentence, and the empty string is a substring of every issue body, so check_provenance.py fails such a quote explicitly instead of signing off on a quote of nothing.
- **check_plan (skills/ultrawrite/scripts/check_provenance.py)** — A task Claim whose provenance tag is mangled past recognition once became invisible to check_provenance.py (it counted N-1 quotes and exited 0, 2026-09-01). check_plan now fails any Claim carrying no recognizable (elicited), (derived) or (quoted from #NNN) tag; this is the only check that catches it.
- **check_plan (skills/ultrawrite/scripts/check_provenance.py)** — A Claim that is only its provenance tag strips to an empty sentence, and the empty string is a substring of every issue body, so check_provenance.py fails such a quote explicitly instead of signing off on a quote of nothing.

## Proof gate input

- **extract_gate_input.py** — skills/ultrawrite/scripts/extract_gate_input.py mechanically caps what the proof gate reader sees: only a task's Claim and Proof, parsed by plan_parse.py, plus hash sha256(claim + NUL + proof) which plan_check.py recomputes for gate-verdicts files. With --base it adds a capped excerpt of the task's files and Proof paths at that base, but the hash never covers it, so a moved base never stales a verdict. Paths the task itself modifies or deletes are marked `own` (never dropped) and spend the excerpt budget last, so files being rewritten are not read as rival pins and do not starve sibling files.
- **extract_gate_input.py _LITERAL_MIN** — extract_gate_input.py treats a backticked Claim/Proof token as a carrier literal only when it is at least 8 characters (_LITERAL_MIN), the length at which a quoted string starts to name one specific thing; shorter tokens would match too many unrelated lines.
- **extract_gate_input.py EXCERPT_FILE_CAP / EXCERPT_TOTAL_CAP** — extract_gate_input.py caps a base excerpt at 8000 bytes per file and 24000 per task: three times the largest excerpt measured on the four tasks of the 2026-09-15 authoring-cost plan (6,216 bytes for one file, 9,542 for one task), so a normal task's files reach the gate reader whole.
- **extract_gate_input.py main / plan_check.base_flag_refusal** — BaseTree in plan_check.py deliberately treats any non-40-hex base value as a checkout directory, so an abbreviated sha became `git -C <abbrev>` and every file read `absent`, handing six gate readers an empty diet on 2026-09-15 (#1025). extract_gate_input.py main therefore refuses any --base that is neither a directory nor a full 40-hex sha before the tree reader sees it.

## Jev readings advisory

- **jev_desired_state (skills/ultrawrite/scripts/check_provenance.py)** — jev_desired_state in check_provenance.py asks Jev whether a quoted sentence states what should be true after the change. Any failure to reach Jev yields no reading, and the author's own read decides.
- **main (skills/ultrawrite/scripts/check_provenance.py)** — check_provenance.py prints Jev's desired_state reading and records it in the plan's gate-verdicts.json beside the author's own read, but the reading never changes the exit code or the failure lines (operator decision 2026-09-29).

## Evidence repository

- **_configured_evidence (skills/ultrawrite/scripts/authoring_census.py)** — authoring_census.py --fetch reads the evidence repository from --evidence-repo or the `evidence` key of ~/.ultrapowers/fleet.json and never guesses one; with neither it exits 2 before any read.

## Gate input extractor

- **skills/ultrawrite/scripts/extract_gate_input.py excerpt budget** — skills/ultrawrite/scripts/extract_gate_input.py spends the 24,000-byte excerpt budget on unmarked entries first and on the task's own Modify:/Delete: files last (stable sort), so a sibling file the task's Proof names is never starved by the files the task rewrites (#1528).

## Plan routing handoff

- **skills/ultrawrite/scripts/routing.py** — skills/ultrawrite/scripts/routing.py computes the execution handoff line `ROUTING fact: T=<n>, width <w>, risk <r>, branch <b>`, risk being one Jev reading via skills/ultrawrite/stories/ask.ts; any failure reads `risk unread` and the line says `(computed without risk)`. A recorded branch that differs from the computed one prints a second line, a pointer and never a refusal. It lives outside the launch-time plan_check.py because its only reader is the author at handoff, and the copy the launcher fetches has no ask.ts beside it.
