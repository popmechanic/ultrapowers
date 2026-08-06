# Derived task heads — recorded SHAs come from git output, never model tokens

_Design for issue #114 (distill 2026-08-06). Approach A approved by the operator:
sidecar derivation + mechanical report finalization, covering **all** recorded
SHAs (task heads, wave-merge heads, the completeness critic's detach target)._

## Problem

Every SHA the run records is transcribed by a model: implementers and the merge
agent run `git rev-parse HEAD`, then *retype* the value into their structured
output. waves.js assembles those token values into the report; the session saves
it; `gate_check.py` trusts it — head-match reads `waveMerges[-1].headSha`,
ancestry reads the critic's verdict, and the critic itself receives its detach
target and mergedShas list *baked into its prompt* from the same token values.

The ledger shows the failure twice in one sense pass (0.1.13 and 0.1.14): a
recorded 40-char head with a **valid 7-character prefix and a fabricated tail**.
A corrupted recorded SHA silently defeats the ancestry safety net — the check
can no longer falsify a dropped task for that entry — and in one case
`gitVerified` came back false against work that was present all along.

Constraint that shapes the design: waves.js is a Workflow script with **no
filesystem or git access**. Only agents touch git; only committed scripts and
the operator's session touch files deterministically.

## Design

### 1. The sidecar convention: `<runDir>/heads/`

Roles that produce a SHA **write it mechanically** instead of reporting it:

- Implementers, after their final commit:
  `git rev-parse HEAD > "<runDir>/heads/task-<taskId>"`
- The merge agent, after each wave merge lands:
  `git rev-parse HEAD > "<runDir>/heads/wave-<n>"`

`<runDir>` reaches each agent through its prompt packet — the same channel that
already carries the review-packet path — and implementers already write under
`<runDir>/review/`, so the sidecar write follows an established pattern rather
than introducing a new privilege.

The value travels git → shell redirection → file. It never passes through model
tokens on the authoritative path. Last write wins (matching current semantics,
where a fix iteration's or retry's final report already supersedes earlier
ones). Structured-output `headSha` fields are **kept** — waves.js still uses
them internally (prompt baking, logging, merge-target flow between waves) — but
nothing the gate trusts comes from them after finalization.

### 2. `finalize_report.py` — mechanical report finalization (new, committed)

A small deterministic helper, run by the session at Step 5 **immediately before
`gate_check.py`**:

- Overwrites `tasks[].headSha` and `waveMerges[].headSha` in report.json from
  the sidecar files.
- Validates each sidecar value is 40-hex **and resolves**
  (`git rev-parse --verify --quiet <sha>^{commit}`) in the repo.
- Fails loudly (exit ≠ 0, naming the slot) when a sidecar for a merged wave or
  a done-and-merged task is missing, malformed, or non-resolving. Tasks that
  ended failed/blocked/deferred are tolerated absent.
- Stamps provenance: `report.headsDerived: true`.
- **No silent fallback to token values** — a fallback would resurrect the seam.
  A finalize failure is a pre-gate failure: the session surfaces it and does not
  run the gate on an unfinalized report.

`gate_check.py` is untouched: it keeps reading report.json exactly as today.
The frozen periphery is not entered; the values it trusts simply become correct
by construction.

### 3. The completeness critic reads files, not its prompt

The critic's brief changes (source: `references/wave-merge.md`, re-baked into
waves.js): its detach target and the mergedShas list for the ancestry assertion
are read from `<runDir>/heads/` directly (`cat` the slots). The prompt-injected
values remain as advisory cross-checks; a file↔prompt mismatch is reported, and
a missing/malformed sidecar for a merged task is treated exactly like an
ancestry miss today — the run goes BLOCKED rather than vouched-for.

### 4. Prompt and doc surfaces

- `references/wave-merge.md` — merge-agent sidecar write; critic file-read
  brief. Re-bake into waves.js per `references/workflow-template.md`;
  `tests/test_no_prompt_drift.py` stays green.
- Implementer prompt (waves.js task preamble; its source reference likewise):
  the "report your worktree coordinates" step gains the mechanical write.
- `SKILL.md` Step 5: finalize runs before gate_check; a finalize failure is
  handled like a gate failure.
- `references/report-format.md`: document `headsDerived` and the derived
  provenance of headSha fields.

## Error handling

| Failure | Behavior |
|---|---|
| Sidecar missing for a merged task/wave | finalize exits non-zero naming the slot; no gate run |
| Sidecar malformed / non-resolving | same — loud, named |
| Critic finds file↔prompt mismatch | reported; ancestry treatment (BLOCKED, not vouched) |
| heads/ absent entirely (stale engine mid-transition) | finalize fails loudly; no token fallback |

## Testing

- **pytest** (`tests/test_finalize_report.py`): overwrite happy path; missing
  sidecar for a merged wave → exit 1 naming the slot; malformed and
  non-resolving SHA cases; failed/blocked tasks tolerated absent; provenance
  stamp asserted.
- **Harness sim (.mjs)**: waves.js prompt changes require a sim referencing
  `harnesses/` that asserts the dispatched prompts carry the sidecar-write and
  file-read instructions, printing the `ALL SCENARIOS PASSED` sentinel (the
  suite-gate runs it whenever harness JS changes).
- Prompt-drift pins: edit sources, re-bake, pins stay green.

## Out of scope

- Any `gate_check.py` / `run_acceptance.sh` change (frozen periphery; the
  optional verify-on-read guard was explicitly deferred in the issue).
- Deleting `headSha` from structured-output schemas (still used for internal
  flow; removal is a later simplification candidate once derived values have
  field history).
- Branch-name derivation at verification time (rejected as approach B: imports
  the #110 shape-assumption class and doesn't cover head-match anyway).

## Complexity accounting (distill fields)

- complexityEffect: **structural** — the trust-me seam is removed at every
  consumer; the whole fabricated-SHA class becomes inexpressible on the
  authoritative path.
- netConceptDelta: **flat** — one helper + one sidecar convention in, one
  standing trust-me seam out.
- canaryMetric: none (no rigor-for-efficiency trade).
