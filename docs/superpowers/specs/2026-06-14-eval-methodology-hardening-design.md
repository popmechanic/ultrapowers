# Eval-methodology hardening: plan coverage, flawed fixture, engine versioning

**Date:** 2026-06-14
**Issues:** #26 (plan-coverage column), #27 (flawed fixture promotion), #28 (engine versioning + non-pooling)
**Scope:** Eval methodology only — `evals/scripts/*`, `evals/fixtures/*`, `evals/results/runs.jsonl`, `evals/README.md`. **No engine change.**

## Problem

The eval matrix can report a half-merged plan as a clean pass, conflates two distinct stressors in one fixture, and pools runs from different engine versions into the same medians. Three coupled defects:

1. **#26 — green-but-incomplete is invisible.** `report.py` derives `suite green` from the integration branch's own test run. Only tests that *exist* can fail, so a plan where later tasks never merged (their tests absent) reads as green. `mixed-B-2` failed 4/7 held-out acceptance tests (tasks 4–6 never merged) yet showed a 28/28 green suite. The report's `suite green 3/3` misleads exactly the way that run's own completeness critic warned.

2. **#27 — `mixed` silently measures two things.** `evals/fixtures/mixed/plan.md` Task 4 declares `Depends-on: none` but its spec requires `add()` to return a `schema.User` — a real dependency on Task 1 (which creates `apistub/schema.py`). The compiler waves 1 and 4 in parallel, so Task 4's worktree has no schema module at BASE. The cell therefore partly measures plan-bug robustness, not engine quality — and unevenly across conditions (serial condition A never hits it because Task 1 always runs first).

3. **#28 — engine versions are pooled silently.** Rows in `runs.jsonl` are keyed only by fixture/condition/rep. The eval-driven hardening plan (`docs/superpowers/plans/2026-06-12-eval-driven-hardening.md`) changes condition B's contestant (dependency lint, FILES scope guard, sibling wave context, exact-assertion prompts, Salvage gate). Mixing pre- and post-hardening runs into the same medians quietly invalidates them.

These are coupled: #27's resolution and #28's matrix policy both change which rows exist, and #26/#28 both touch `report.py` and the scorers and both backfill the same 14 existing rows.

## Decisions (made during brainstorming, 2026-06-14)

- **#27 → Promote.** Keep the buggy plan as a deliberate fifth `flawed` fixture; fix `mixed` properly; restart `mixed`'s cells. The matrix then measures engine-on-correct-plans *and* engine-on-realistic-plans explicitly.
- **#28 → Freeze, then complete.** Finish the remaining matrix cells on the current frozen engine before merging the hardening plan. The hardened engine becomes a separate, later population. `report.py` enforces non-pooling.
- **#26 → Flag, don't just show.** Add the coverage column *and* visibly flag cells that are suite-green but coverage < 100%.
- **Sub-decision A — relabel, don't discard.** Every existing `mixed` row executed the buggy plan (frozen before run 1, never edited), so those rows are genuine `flawed`-fixture data. Relabel them (`mixed-*` → `flawed-*`, `fixture: flawed`) rather than discarding. `mixed` then starts empty.
- **Sub-decision B — one combined migration.** A single script owns `runs.jsonl`: relabel mixed→flawed first, then backfill engine + task fields. Avoids two steps racing on the same data file.

## Design

### Row schema additions (`runs.jsonl`)

Two new groups of fields on every row:

```jsonc
{
  // ... existing fields (run_id, fixture, condition, rep, head, cost_usd,
  //     weekly_pct, wall_clock_s, suite{}, acceptance{}, fix_rounds,
  //     blocked_tasks, redirects, notes, scored_epoch) ...

  "tasks_planned": 6,          // # implementation tasks the engine planned
  "tasks_merged": 3,           // # tasks that reached done/MERGED
  "engine": {
    "plugin_version": "0.0.10",                 // from .claude-plugin/plugin.json
    "sha": "eefcbab32a44a712f322f7a5bd3c4fe0d0a60db1"  // ultrapowers repo HEAD at run time
  }
}
```

`coverage` is derived (`tasks_merged / tasks_planned`), not stored. `engine.sha` is the **ultrapowers engine** repo HEAD — distinct from the existing `head`, which is the *fixture* repo HEAD (eval-baseline + task commits).

### #26 — coverage capture, backfill, report

- **Capture.** `autoscore.py` already parses the workflow-result `tasks[]` to derive `blocked_tasks`; extend it to also emit `tasks_planned` (total) and `tasks_merged` (status ∈ {done, MERGED}). `score_run.py` (human-gated) gains `--tasks-planned` / `--tasks-merged` args sourced from the end-of-run report, parallel to the existing `--fix-rounds` / `--blocked-tasks`.
- **Backfill (14 rows) — lossless arithmetic.** `tasks_planned` is a per-fixture constant (wide 6, chained 5, mixed 6, degrade 2); `tasks_merged = tasks_planned − blocked_tasks`. Both inputs already exist. No re-scoring or transcript reads.
- **Report.** Add a `coverage (med)` column beside `suite green` in the per-fixture table. Mark a cell with `⚠` when **any** rep in it is suite-green *and* coverage < 100% — the green-but-incomplete signal.

### #28 — engine versioning, backfill, non-pooling

- **Capture.** Scorers stamp `engine.plugin_version` (read from `.claude-plugin/plugin.json`) and `engine.sha` (`git -C <engine-repo-root> rev-parse HEAD`, where the root is derived from the script's own location so it is the engine repo, never the fixture run dir).
- **Backfill (14 rows) — deterministic.** For each row, map `scored_epoch` → the engine commit that was HEAD then (`git rev-list -1 --before=<epoch> main`), and read that commit's version (`git show <sha>:.claude-plugin/plugin.json`).
- **Non-pooling in `report.py`.** Partition rows by engine version. A (fixture, condition) cell spanning multiple engine versions renders as **separate lines**, each tagged `plugin_version+short-sha`; medians are never computed across engine versions. This makes the frozen baseline and the future hardened engine appear as two distinct populations.
- **Policy (README).** Document the freeze-then-complete rule: complete remaining cells on the current frozen engine before merging the hardening plan; report the hardened engine as a separate population.

### #27 — promote the flawed plan

- **Create `evals/fixtures/flawed/`** as a copy of today's `mixed/` with the **buggy `plan.md` kept verbatim**. It reuses mixed's `project/`, `reference/`, and `acceptance/` unchanged — `flawed` *is* "mixed with the latent-dependency plan," so the same held-out acceptance suite measures whether the engine survives the bad plan.
- **Fix `evals/fixtures/mixed/plan.md`** Task 4: `Depends-on: none` → `Depends-on: 1`. Bump the fixture with a lightweight version/changelog marker (no fixture-versioning convention exists today; this plan establishes one).
- **`mixed` restarts fresh** — its cells are empty after the migration relabels the old rows to `flawed`.
- **README.** Document the fifth `flawed` regime; the matrix becomes 5 × 3 × 3 = 45.
- **Hardening interaction (documented).** Once the prose-reference dependency lint lands, condition B on `flawed` will catch the latent dependency at compile time. That pre/post contrast is the fixture's purpose, and #28's non-pooling reports it cleanly as two engine populations.

### Combined `runs.jsonl` migration (one script)

Ordered, single-owner of the data file:

1. **Relabel** every existing `mixed-*` row → `flawed-*` (`run_id` prefix and `fixture` field).
2. **Backfill** `engine` (via `scored_epoch` → commit) and `tasks_planned`/`tasks_merged` (per-fixture constant minus `blocked_tasks`) on all rows.

Idempotent where practical (re-running detects already-migrated rows). The script is committed so the migration is auditable, not a one-off REPL action.

## Components and boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `score_run.py` / `autoscore.py` | Stamp `tasks_planned`, `tasks_merged`, `engine{}` on new rows | `.claude-plugin/plugin.json`, engine repo git |
| `migrate_runs.py` (new) | Relabel mixed→flawed; backfill engine + task fields on the 14 rows | git history, fixture constants |
| `report.py` | Coverage column + green-but-incomplete flag; partition by engine version (non-pooling) | row schema above |
| `evals/fixtures/flawed/` | Buggy-plan regime (copy of old mixed) | — |
| `evals/fixtures/mixed/` | Corrected plan (Task 4 → Depends-on 1) + version marker | — |
| `evals/README.md` | Document flawed regime, 45-cell matrix, freeze-then-complete + non-pooling policy | — |

## Testing

- **Scorers:** unit-style check that a synthetic workflow result yields the expected `tasks_planned`/`tasks_merged`, and that `engine.sha` resolves to the engine repo HEAD (not the fixture dir).
- **Migration:** run against a copy of `runs.jsonl`; assert 14 rows out, mixed rows relabeled, every row carries `engine` + task fields, and re-running is a no-op (idempotent).
- **Report:** golden-output check on a small fixture dataset — coverage column present, `⚠` appears for a seeded green-but-incomplete row, and a two-engine cell renders as two tagged lines rather than one pooled median.

## Out of scope

- No engine/runtime change (`/ultrapowers`, compiler, executors untouched).
- Not running the remaining matrix cells — this plan delivers the methodology; running the outstanding cells of the 45-cell matrix is operational follow-up under the freeze policy.
- The prose-reference dependency lint itself is owned by the separate eval-driven hardening plan; here it is only referenced.
