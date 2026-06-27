# Handoff: resume the ultralearn-distilled backlog (P4–P6 + two nits)

**Date:** 2026-06-27 · **Purpose:** seed a fresh session to finish the remaining
ultralearn-distilled engine work. Self-contained — a session with no prior context
can act on this. The grounding for each item is included so you **do not re-derive**
(and so you apply the ground-before-speccing discipline below).

---

## 0. Where things are

- **`main` @ `4c1c00c`, pushed to `origin/main`, version `0.0.24` (NOT released).** The
  installed plugin lags until `/plugin` re-resolves a new version in a fresh session.
- **Shipped this session (all on `main`):** P1 (the `deferredVerification` reason-tagged
  gate channel), `judgmentCalls` four-kind taxonomy, the complexity governors
  (G1 distill consolidation rubric + G2 complexity metric & advisory ratchet), P3
  (global constraints reach the completeness critic), P2 (ultraplan guidance for
  integration-spanning acceptance on multi-plan efforts).
- **Specs + plans for the shipped work:** committed under
  `docs/superpowers/{specs,plans}/2026-06-27-*` (foreign-run references abstracted).
- **The observation ledger** (`docs/superpowers/observations/ledger.{jsonl,md}`, ~337
  rows) is intentionally **uncommitted** in the working tree — local/privacy tier. A
  sense pass this session added 118 rows across 11 runs; `distill` produced P1–P6.

## 1. The backlog

### P4 — glob / non-path Files entries silently collapse parallel width *(cleanest next)*
- **Surface:** `skills/ultrapowers/scripts/compile_plan.py` (+ `references/dependency-analysis.md`).
- **Status:** LIVE @ 0.0.24. Cheap, contained.
- **Grounding:** `compile_plan.py` already has a "non-path token(s) ignored" Files
  diagnostic (~line 83) and Files near-miss handling. The gap: a glob-like Files entry
  (e.g. `src/*.py`) is treated as a real path-touch and over-couples every task that
  "matches" it, **silently serializing** the plan.
- **Approach:** detect glob-like Files entries (`*`, `?`, `[...]`), warn they over-couple
  and collapse width, suggest explicit paths; fold into the existing near-miss diagnostic.
  TDD via `tests/test_compile_plan.py`.
- **Verify first:** read the Files parsing + near-miss diagnostic; confirm globs aren't
  already handled.

### P5 — sweep runs only on the Approve path; abort/redirect/fail leaves debris
- **Surface:** `skills/ultrapowers/SKILL.md` (Step 5/6) + `scripts/sweep_worktrees.sh`.
- **Status:** CONFIRM FIRST (partially mitigated). The `--run` glob bug was fixed in
  0.0.22 and sweep IS enforced at the Step-5 Approve path — but only there.
- **Grounding:** the debris findings ("13+ embedded repos", "31 worktrees left behind")
  are the non-Approve terminal states (abort / Redirect / Salvage / failure) that never
  reach the sweep.
- **Verify first:** trace every Step-5/6 terminal exit; confirm the non-Approve paths
  don't sweep. If confirmed, propose sweeping on all terminal paths (or a session-end
  safety net). May be partly stale — confirm before building.

### P6 — ultralearn harvester false-positives
- **Surface:** `skills/ultralearn/scripts/harvest_runs.py` (+ `tests/test_harvest_runs.py`).
- **Status:** CONFIRM STALENESS. Some extractor fixes shipped earlier (PR #66).
- **Grounding:** run-detection keys on *any* `Workflow` tool_result, so non-ultrapowers
  workflows (research fan-outs, `/verify` dev sessions) get misclassified as engine runs;
  duplicate runIds for one transcriptDir have also appeared.
- **Verify first:** read the current run-detection + what `test_harvest_runs.py` already
  covers. If still false-positiving, require waves-contract evidence (`args.waves` /
  wave-role agents) for detection and dedup by `transcriptDir`.

### Nit A — correct the deferred-verification spec's bake premise
- **File:** `docs/superpowers/specs/2026-06-27-deferred-verification-channel-design.md` §2.3.
- It claims the completeness prompt is "not baked." **Wrong** — it's baked from
  `references/wave-merge.md` (`BAKE:COMPLETENESS_PROMPT`), pinned by `test_no_prompt_drift`.
  The implementation handled it correctly; only the spec text is stale. One-line doc fix.

### Nit B — `deferredVerification` schema asymmetry
- The completeness critic's **return** schema for `deferredVerification` in
  `skills/ultrapowers/harnesses/waves.js` omits the `required: [deliverable, reason]`
  that the doc-side report schema (`references/report-format.md`) declares. Add `required`
  for consistency. Verify the exact schema location in `waves.js` first.

## 2. Disciplines to carry (learned this session — read before starting)

1. **Ground before speccing.** Verify every claim against the actual engine *before*
   writing a spec. A spec this session asserted "the completeness prompt is not baked" —
   false; only the engine's drift pin caught it mid-run. Grep the real code first.
2. **Baked prompts have TWO sources.** `references/reviewer-prompts.md`
   (GUARD / IMPLEMENTER / REVIEWER + schemas) **and** `references/wave-merge.md`
   (SETUP / MERGE / RECONCILE / COMPLETENESS). Both are pinned by
   `tests/test_no_prompt_drift.py`. Edit the source **and** re-bake `waves.js` together;
   never only one. (Use the failing drift pin as your TDD red.)
3. **Marked-plan interface trap.** `compile_plan.py`'s interface matcher does exact
   leading-token equality with **no sentinel for `none`**. Writing `- Consumes: none …`
   (or any generic leading word like `none`/`the`) creates phantom dependency edges
   between tasks. For tasks with no interface relationship, **omit** the
   `Consumes:`/`Produces:` labels and use a plain descriptive bullet. **Always
   `compile_plan.py`-verify the plan** before any launch and read `marker_conflicts`.
4. **G1 consolidation discipline** (now a shipped governor —
   `skills/ultralearn/references/distilling-proposals.md`). For each proposal classify
   `complexityEffect` (additive-guard / structural / simplification); for a recurring
   cluster, ask "can a representation change delete the whole cluster?" *before* adding a
   guard. Prefer guidance/structural over mechanism (P2 became guidance this way).
5. **Privacy before any commit/push — the repo is PUBLIC.** Scrub foreign project names
   from anything committed; abstract foreign evidence. The ledger stays local/uncommitted.
6. **Self-host gotchas.** `/ultrapowers` in this repo runs the installed *cache* engine —
   check skew (`scripts/check_engine_skew.sh`) and copy the repo `waves.js` into
   `.claude/workflows/` on SKEW. Pre-existing uncommitted files dirty the Step-5 clean-tree
   gate — account for them explicitly. Serialize concurrent `/ultrapowers` runs.

## 3. Recommended path

For each item: **ground** (verify against current code) → **spec** under
`docs/superpowers/specs/` → `superpowers:writing-plans` + `ultrapowers:ultraplan` (marked
plan) → **compile-verify** → **execute** (honor the fit analysis — small items will likely
route Inline or Subagent-Driven, not Ultrapowers). Order: **P4 first** (cleanest, live),
then P5 and P6 after confirming their staleness. Nits A/B are near-free — fold into the
first plan or do inline.

## 4. Paste-ready resume prompt

> Resume the ultralearn backlog per `docs/superpowers/specs/2026-06-27-backlog-handoff.md`.
> Start with **P4** (glob/non-path Files entries collapsing parallel width in
> `compile_plan.py`): ground it against the current code, write a spec + marked plan, and
> propose execution. Carry the §2 disciplines — ground-before-speccing, the baked-prompt
> two-source rule (`reviewer-prompts.md` + `wave-merge.md`, both drift-pinned), the
> marked-plan `none`-token interface trap (always `compile_plan.py`-verify), G1
> consolidation, and privacy-before-push (public repo; ledger stays local). Then handle
> P5 and P6 (confirm staleness first) and the two nits.
