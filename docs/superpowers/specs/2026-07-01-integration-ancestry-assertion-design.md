# Post-integration ancestry assertion (#70) — Design

_Sweep-authored during the 2026-07-01 live docket shakedown. Issue #70 is a
half-spec; this records the settled design._

## Problem

The engine reconciles merge failures at the **wave** level but has no
cryptographic post-integration proof that **every individual `done` task's
commit actually landed in the integration ancestry**. A finished task's branch
can be silently dropped (a transient flake, a lost merge) and the gate still
goes green on a partial feature — the dominant *false-green* theme from the
observation ledger.

The existing guards are prose-based: a wave with no mergeable branches SKIPs and
cascade-blocks; the completeness critic reads declared `Create:` paths of
failed/blocked tasks. None of them is a `git merge-base --is-ancestor` proof over
the **mergeable** tasks.

## Design

After the final wave merge (integration HEAD = `waveBaseSha`, the last wave's
`merge.headSha`), collect the `headSha` of **every mergeable `done` task across
all waves** and assert, for each:

```
git merge-base --is-ancestor <headSha> <waveBaseSha>
```

Any miss → **fail loud (BLOCKED)**: push a `judgmentCall` naming the dropped
task, and the run cannot report `gitVerified`/green. This is belt-and-suspenders
*over* the prose completeness critic — a cryptographic completeness check that
does not depend on the DAG having an edge into the dropped task.

If the run recorded no merge HEAD (`waveBaseSha` empty — every wave SKIPPED),
there is nothing to assert against; the existing "no merge HEAD" degradation path
already handles that and the assertion is skipped.

## Surface

- `skills/ultrapowers/references/wave-merge.md` — source prose (the completeness /
  integration section gains the ancestry-assertion paragraph).
- `skills/ultrapowers/harnesses/waves.js` — baked assertion after the final merge,
  before the report is finalized. Re-bake per `references/workflow-template.md`;
  keep `tests/test_no_prompt_drift.py` green.
- `tests/test_wave_ancestry.py` (new) — a fixture where a `done` task's headSha is
  NOT an ancestor of the integration HEAD → assertion yields BLOCKED / a
  judgmentCall.

## Constraints

- **Minimal assertion, no new structure** (issue ratchet note): keep `engineLoc`
  near baseline. Reuse the existing mergeable-result bookkeeping (`isMergeable`,
  the per-wave results already carry `branch`/`headSha`).
- Disposition **suite** — ultrapowers' own engine change, verified by the
  committed suite; no held-out exam.
