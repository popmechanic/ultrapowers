# ultralearn plumbing pair — issue-backed watch-items (#219) + computable redirect canary (#220)

**Status:** approved (operator pre-authorized the pair as one small slate; issue
bodies are authoritative)
**Issues:** #219, #220 (both `wayfinder:task`, Authoring Frontier program #238 —
normal superpowers flow per CLAUDE.md wayfinding rules)
**Acceptance:** suite (default — no seal)

## Problem

Two gaps in the ultralearn loop's state:

1. **The parked-first-occurrence list has no authoritative home** (#219).
   Distill doctrine: first occurrence → prose or watch-item; second → build. The
   list of open first occurrences awaiting a second is the loop's most
   decision-relevant state, and today it lives in operator memory files. The
   operator decision (distill 2026-08-24) is already executed on the data side:
   watch-items exist as open `watch-item`-labeled GitHub issues (#227–#237 et
   al.). The distill brief just doesn't read them from there.

2. **The redirect-round canary is uncomputable** (#220). The redirect-round
   rate is the metric every rigor-for-efficiency trade is judged by
   (`canaryMetric` default), yet it exists only as free-text finding titles —
   93/165 runs carry a count finding, only 14 machine-parseable. No script can
   aggregate count/tasks/causes by `engineVersion`.

## Change 1 — distill reads open `watch-item` issues (#219)

Prose-only; no code, no new file, **no jsonl** (the issue title supersedes the
body's jsonl sketch — the operator decided watch-items live as GitHub issues).

- `skills/ultralearn/references/distilling-proposals.md`, the
  "machinery is earned by recurrence" budget rule: name the authoritative
  store — the open `watch-item`-labeled issues, read at distill start via
  `gh issue list --label watch-item --state open` — and state exactly what a
  distill does with them:
  - **Read first.** Before clustering, list the open watch-items; they ARE the
    parked-first-occurrence list.
  - **Recurrence check.** A new finding matching an open watch-item's named
    recurrence is a **second occurrence** — the build is licensed; the proposal
    cites the watch-item issue number.
  - **Lifecycle.** On adoption of a proposal that a watch-item bought, the
    watch-item issue is closed citing the evidence; a newly parked item is
    filed as a new open `watch-item` issue. Both remain operator-gated like all
    distill filing.
- `skills/ultralearn/SKILL.md` Verb 2: one-line pointer to the same rule (the
  brief already says "first occurrence → prose or a watch-item; second →
  build"; append where the list lives and that distill reads it first).

`netConceptDelta` flat — "watch-item" already exists as a concept; this gives
it its home. No local file means nothing to gitignore and nothing to migrate.

## Change 2 — structured redirect-round fields (#220)

### Reader schema (`skills/ultralearn/references/reading-lenses.md`)

The required per-bundle redirect-round count finding **additionally** carries
two structured fields (title prose unchanged — human headline stays):

- `redirectRounds` (object of non-negative integers):
  `{"total": N, "infra": a, "finding": b, "plan": c, "elective": d}` — the
  existing cause vocabulary, verbatim. (Guidance to the reader agent: the
  cause counts should sum to `total`. Not a schema invariant — nothing
  consumes or enforces the sum today; trim review F5.)
- `implementationTasks` (integer) — the run's implementation-task count, so
  rates compare like with like across run scales.

Added to the section prose and the output-schema field list (marked as required
on the count finding only).

### Merge (`skills/ultralearn/scripts/merge_ledger.py`)

`redact_finding` already copies the whole dict, so unknown fields pass through.
**No merge-path code change; pin it with a test** (a finding carrying
`redirectRounds`/`implementationTasks` lands in the ledger row intact).

### Digest table (`regenerate_digest`)

One new section in `ledger.md`: **redirect-round rate by engineVersion**. For
every finding carrying a well-formed `redirectRounds` (dict with integer
`total`) — group by the row's `engineVersion` (missing → "unknown"); columns:
version, n runs (distinct runIds), Σ rounds, Σ implementation tasks, rate
(Σrounds/Σtasks). Precision rules (trim review F7):

- **One row per runId** — a runId with multiple qualifying findings (a
  re-sensed run whose retitled count finding dodged the id-dedupe) counts
  once: the LAST qualifying ledger row wins (append-only → most recent).
- **Missing/malformed `implementationTasks`** — the row still counts toward
  n runs and Σ rounds, but the version's rate renders "—" unless every
  counted row carries an integer task count (a partial denominator would
  silently inflate the rate). Zero Σ tasks also renders "—".

Old-shape (prose-only) rows simply don't enter the table — the canary
compares from adoption forward; back-fill not required; the per-lens listing
is unchanged, so the append-only gitignored ledger needs no rewrite and both
row shapes coexist. Malformed values (non-dict, non-int total) are skipped,
never raised.

### Tests (`tests/test_merge_ledger.py`)

1. Pass-through pin: structured fields survive `merge_findings` into the
   ledger row.
2. Digest renders the rate table from structured rows (version, rate visible).
3. Mixed old/new ledger: old prose-only rows don't crash or enter the table.
4. Malformed `redirectRounds` (string, or non-int total) is skipped.
5. Rate renders "—" when a counted row lacks `implementationTasks`.
6. Duplicate runId (two qualifying findings) counts once — last row wins.

## Out of scope / constraints

- The verification periphery (gate_check.py, ultra_gate.py, run_lock.sh,
  sealing) — zero diff. ultralearn is not frozen.
- `fleet/**` untouched (run-9c live).
- No Anthropic API/SDK in repo code.
- No back-fill of the 14 parseable historical titles (optional one-off, not
  built here).
- `harvest_runs.py` unchanged — the count is a lens-reader observation, not a
  deterministic harvest field (the issue body is authoritative over the
  work-order summary's "harvester" shorthand).

## Trim review

Author's Adds/Removes disclosure:

- **Adds:** two structured fields on one existing required finding; one digest
  table; one `gh issue list` read in the distill brief; 4 tests.
- **Removes:** the memory-file/jsonl watch-item store idea (never built);
  nothing else — no new subsystem, no new script.

Reviewer (fresh-context subagent, 2026-08-26) — 10 findings; grade below.
Adopt-or-answer:

| # | Element | Verdict | Disposition |
|---|---------|---------|-------------|
| F1 | Read-first + recurrence-check bullets | KEEP | — |
| F2 | Lifecycle bullet (close on adoption, file new parks) | KEEP (scope-noted) | Kept — it is the GitHub-native replacement for the issue body's `status`/`firedBy` fields; without it the issue-as-store rots. |
| F3 | SKILL.md Verb 2 pointer | MERGE (clause, not new line) | **Adopted** — the pointer is a clause extending the existing "first occurrence → …; second → build" parenthetical. |
| F4 | `redirectRounds`/`implementationTasks` fields | KEEP | — |
| F5 | "causes sum to total" invariant | NARROW | **Adopted** — demoted to guidance to the reader agent; removed from the schema-invariant wording (unenforced, unconsumed). |
| F6 | Merge-path pin test, no code change | KEEP | — |
| F7 | Digest table under-specified (missing-tasks rate; duplicate runId) | UNDER-SPECIFIED | **Adopted** — precision rules added: one row per runId (last wins); rate "—" unless every counted row carries a task count. Tests 5–6 added. |
| F8 | Append-only section | MERGE | **Adopted** — folded into the digest section; heading deleted. |
| F9 | 4 tests | KEEP | Now 6 (F7). |
| F10 | Out-of-scope block | KEEP | — |

Scope reconciliation (reviewer): #219 grew by the Lifecycle bullet + the
SKILL.md second surface (both prose, no machinery — accepted as the cost of a
store that doesn't rot); #220's sum invariant was the one unearned add —
removed per F5. jsonl→issues divergence pre-authorized.

**netConceptDelta (reviewer grade): flat** — the field names structure
obligations the lens brief already states in prose; watch-item gains a home,
not a definition. (Conditional on F5's demotion, which is adopted.)
