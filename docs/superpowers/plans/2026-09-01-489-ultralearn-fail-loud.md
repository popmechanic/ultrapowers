# ultralearn fail-loud — the #489 plan (the first claims-v1 plan)

**Grammar:** claims-v1

**Goal:** The sensor can tell "I looked and there was nothing" from "I could not
look" — typed outcomes at the input layer, advisory reading untouched, every
deliberate swallow marked.

**Tech Stack:** Python 3 stdlib (no `anthropic` SDK, no API keys), pytest.

**Spec:** issue #489 (the measured record is the spec; direction §"Direction (not a
prescription)")

## Global Constraints

- All scripts stay stdlib-only; no new dependencies and no direct Anthropic API use.
- A harvest over N runs with M unreadable inputs produces N−M bundles and M
  `FAILED-LOOKUP:` lines — partial failure never aborts the healthy remainder.
- No structurally empty bundle is ever written to the cache.
- The reading layer (lenses, subagent dispatch) is untouched — advisory stays advisory.
- The full suite (`python3 -m pytest`) passes.

**Acceptance:** suite — the committed suite is the verification.

---

### Task 1: The outcome vocabulary

**Type:** implementation

**Files:**
- Create: `skills/ultralearn/scripts/_outcome.py`
- Test: `tests/test_ultralearn_outcome.py`

**Claim:** If a harvest of N runs yields 0 findings for a run, that should be a
*typed* outcome, not an empty list that flows onward looking identical to a quiet
run. (quoted from #489)
Machine: this task supplies the types: importable names with one machine-greppable
stderr line each — `FailedLookup` / `FAILED-LOOKUP:` for could-not-look,
`report_looked_empty` / `LOOKED-EMPTY:` for looked-and-found-nothing, and
`swallow` / `SWALLOW:` for a deliberate continue — with clean stdout. (Adoption of
these names across the scripts is the sibling tasks' claims, not this one's.)

**Authorized-by:** #489 §"Distinguish"; operator decision 2026-08-31 (#390 comment,
first target)

**Interfaces:**
- Consumes: nothing
- Produces: `class FailedLookup(RuntimeError)`, `report_failed_lookup(cause: str) -> None`, `report_looked_empty(where: str) -> None`, `swallow(reason: str, exc: BaseException | None = None) -> None`

**Context:** One tiny module, stderr only, no state. `report_failed_lookup` prints
`FAILED-LOOKUP: <cause>`; `report_looked_empty` prints `LOOKED-EMPTY: <where>`;
`swallow` prints `SWALLOW: <reason>` plus the exception's repr when given. Nothing here
exits the process — callers decide their exit codes.

**Parallelization rationale:** three consumer tasks build against this contract
concurrently; a shared failure vocabulary is what a good engineer extracts anyway —
the alternative is three private spellings of the same three words.

**Proof:**
- Test: `tests/test_ultralearn_outcome.py`
Exams: each helper emits exactly its prefix line to stderr and nothing to stdout;
`swallow` with and without an exception; `FailedLookup` is a `RuntimeError` subclass.

**Stale-if:**
- issue-closed: #485

### Task 2: fleet_fetch tells the two apart

**Type:** implementation

**Files:**
- Modify: `skills/ultralearn/scripts/fleet_fetch.py`
- Test: `tests/test_fleet_fetch.py`

**Claim:** Distinguish "asked and got nothing" from "couldn't ask." (quoted from #489)
Machine: fetching from an unreachable remote or a missing remote root exits 2 with a
`FAILED-LOOKUP:` line naming the cause; fetching from a reachable root that contains no
run bundles exits 0 with a `LOOKED-EMPTY:` line naming the root. The two are different
exit codes and different prefixes, not two identical silences.

**Authorized-by:** #489 §"It has already fired three times" (incident 2 — the
DEFAULT_REMOTE_ROOT ghost path read as "no runs")

**Interfaces:**
- Consumes: `class FailedLookup(RuntimeError)`, `report_failed_lookup(cause: str) -> None`, `report_looked_empty(where: str) -> None`
- Produces: nothing new — the CLI contract above is the deliverable

**Context:** The listing helpers here are documented "advisory by design"; that stays
true for per-item errors, but the top-level lookup failing (bad host, absent root)
must stop being advisory. The remote is exercised through the module's existing
command seam the way the current tests fake it — no test may open a real ssh
connection, and every test uses its own tmp_path.

**Proof:**
- Test: `tests/test_fleet_fetch.py`
Exams: unreachable remote → exit 2 + `FAILED-LOOKUP:` naming the host; reachable
host with a missing remote root → exit 2 + `FAILED-LOOKUP:` naming the root (a
separate exam — it is a different code path from the dead host); present-but-empty
root → exit 0 + `LOOKED-EMPTY:` asserted to contain the root path itself; a root
with bundles behaves exactly as today (regression pin on the happy path).

**Stale-if:**
- issue-closed: #485
- path-exists: `skills/ultralearn/scripts/fleet_fetch.py`

### Task 3: harvest refuses the structurally empty bundle

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- Test: `tests/test_harvest_fleet_runs.py`

**Claim:** Fail loud at the input layer, stay advisory at the reading
layer. (quoted from #489)
Machine: a run whose tarball is unreadable is skipped with a `FAILED-LOOKUP:` line
naming the run while the remaining runs still harvest (exit 0 when at least one bundle
lands, exit 2 when every input failed); a bundle that would contain zero events is
never written — refused with `FAILED-LOOKUP:` naming the run; a readable run with real
events but no findings writes its bundle normally and reports `LOOKED-EMPTY:` naming
the run. (The reading layer staying untouched is a Global Constraint the reviewer
gates on the diff footprint, not part of this exam.)

**Authorized-by:** #489 §"Fail loud at the input layer"; #471 (the sensor that dropped
every verdict and passed shape-only smoke)

**Interfaces:**
- Consumes: `class FailedLookup(RuntimeError)`, `report_failed_lookup(cause: str) -> None`, `report_looked_empty(where: str) -> None`
- Produces: nothing new — the harvest CLI contract above is the deliverable

**Context:** "Structurally empty" means an events list of length zero after parse —
the shape #471 shipped for weeks. A run with events whose lenses later find nothing is
the healthy LOOKED-EMPTY case and must keep producing a bundle; the refusal is only
for a bundle that could not have carried a finding in the first place. Tests use their
own tmp_path corpus directories; no network, no orchestrator.

**Proof:**
- Test: `tests/test_harvest_fleet_runs.py`
Exams: corrupt tarball among healthy ones → healthy bundles land, `FAILED-LOOKUP:`
names the corrupt run, exit 0; all inputs corrupt → exit 2; zero-event bundle refused
and absent from the cache with `FAILED-LOOKUP:` naming the run; real-events-no-findings
run still produces its bundle AND the harvest output carries `LOOKED-EMPTY:` naming
that run (both asserted).

**Stale-if:**
- issue-closed: #485
- path-exists: `skills/ultralearn/scripts/harvest_fleet_runs.py`

### Task 4: every swallow is a decision

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Modify: `skills/ultralearn/scripts/fleet_slice.py`
- Modify: `skills/ultralearn/scripts/fleet_events.py`
- Modify: `skills/ultralearn/scripts/merge_ledger.py`
- Test: `tests/test_ultralearn_swallows.py`

**Claim:** Some swallows are correct and should stay (quoted from #489)
Machine: the sweep keeps the legitimate swallows — at least one marked
`swallow(...)` call remains in `skills/ultralearn/scripts/` afterward — while every
`except` handler there either raises (a re-raise or a typed error — both are failing
loud) or routes through `swallow(...)` with a non-empty literal reason string; a new
repo test walks those files' ASTs and fails any handler that silently discards its
exception without such a call, so an unmarked swallow cannot come back.

**Authorized-by:** #489 §"the DEFAULT is swallow, and nothing marks which ones were a
decision"; #476 (the denial ledger that recorded 3 of 20)

**Interfaces:**
- Consumes: `class FailedLookup(RuntimeError)`, `swallow(reason: str, exc: BaseException | None = None) -> None`
- Produces: nothing new — the AST pin in the new test is the deliverable

**Context:** This is a judgment sweep, not a mechanical one: a handler that must not
fail because its log is unwritable keeps its swallow — marked, with a reason; a
handler hiding a lookup failure converts to `FailedLookup`. The measured census is 46
handlers across these files, 29 of them in `harvest_runs.py` (the Workflow-era
detector — most of its swallows are correct per-session skips and will simply gain
marks). Behavior of the healthy paths must not change: this task re-labels silence,
it does not redesign flows. The AST test treats `raise`, `raise X`, and a `swallow(`
call anywhere in the handler as compliant; everything else in an `except` body is a
failure naming file and line.

**Proof:**
- Test: `tests/test_ultralearn_swallows.py`
Exams: the AST walk globs `skills/ultralearn/scripts/*.py` (a sixth script cannot
escape by not being enumerated) and reports zero unmarked handlers, where compliant
means re-raise, raise, or a `swallow(...)` call whose first argument is a non-empty
string literal — a reasonless or non-literal-reason `swallow()` is itself a walk
failure; the walk additionally asserts at least one compliant `swallow(...)` call
remains across the scripts (the existential half: the correct swallows stayed,
marked); a fixture snippet with a bare `except: pass` fails the walk and a fixture
with `swallow()` (no reason) fails it too (the test tests itself);
`python3 -m pytest tests/test_harvest_runs.py tests/test_fleet_slice.py
tests/test_merge_ledger.py` still passes unchanged — the healthy-path regression pin.

**Stale-if:**
- issue-closed: #485
