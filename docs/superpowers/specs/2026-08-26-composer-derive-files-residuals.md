# Composer hardening: derive_files path validation + #244 residuals (#261 + #244)

**Date:** 2026-08-26
**Issues:** #261 (derive_files unions instruction-text fragments as fake paths —
2 foreign runs, this cycle's one budgeted additive guard), #244 (advisory
residuals from the #222 waves run, batched here per the post-PASS policy; #241,
the originally-named host, was adjudicated NO-GO so this slate hosts them).
**Surfaces:** `skills/ultrapowers/scripts/redirect_args.py`,
`skills/ultrapowers/scripts/salvage_args.py`,
`skills/ultrapowers/scripts/residual_manifest.py`,
`tests/test_redirect_args.py`, `tests/test_salvage_args.py`,
`tests/test_residual_manifest.py`, `skills/ultrapowers/SKILL.md` (one word),
`skills/ultradocket/SKILL.md` (one sentence).
**Frozen periphery:** untouched.

## Design

### 1. derive_files validation (#261 — the additive guard)

`instruction_paths()`-derived candidates (free-prose extraction) get one more
gate before unioning into a task's file scope: the token must **exist on the
tree** (`os.path.exists`, relative to the invoking cwd — the session repo
root, where the SKILL runs the composer) **OR appear in the launch's declared
FILES** (the union of every task's `files` in the loaded launch). Tokens
failing both are dropped and reported once on stderr
(`redirect_args: dropped N instruction token(s) not on tree or in declared
FILES: …`) so a legitimate new-file instruction is visible, not silent. The
two trusted legs are untouched: the task's own FILES and the finding's
explicit `files` list (orchestrator-authored) union as before. Union still
only grows; ordering/dedup unchanged.

Note: the "path-shaped" half of the #261 proposal (no mid-token spaces, no
unbalanced quotes/brackets) is already enforced by `instruction_paths`'s
tokenization + `_is_pathlike` narrowing (#223); this spec adds only the
existence/declared-FILES leg.

New tests use tokens that actually leak TODAY (trim-review verified by
execution — snake_case bare names like `mask_v2` are already dropped by the
#223 rule and pin nothing): a quoted extension list (`".py, .js"` — leaks via
the dotfile rule), a glob mask (`src/**/*.py` — leaks via the `/` rule), and
an extension-bearing code fragment (`foo(bar).py`) are NOT unioned; a real
tree path and a declared-FILES path ARE; the stderr drop report appears;
the finding-`files` leg bypasses the guard.

Trust nuance (recorded): the declared-FILES leg reads the CHAINED launch, so
in a pre-guard run whose earlier rounds already leaked fake tokens into task
files, those tokens would re-legitimize themselves — harmless going forward
(new runs never accumulate them), accepted.

### 2. #244 residuals (numbered as in the issue)

1. **Chain-file fallback:** `load_context` falls back, in order:
   `relaunch-launch.json` (current) → `redirect-launch.json` (pre-#222 rounds)
   → the pristine `args.wavesPath`, and prints a stderr warning when the
   legacy name is used. Combined with residual 7: each chain-file name is
   probed in `run_dir` first, then `receipt_dir` (rounds mixed across
   `--out-dir` no longer silently re-derive pristine bodies). Tests: (a) a
   run dir holding only `redirect-launch.json` chains bodies from it and
   warns; (b) a chain file written beside the receipt while `--out-dir`
   points elsewhere is still found (the receipt_dir probe — the actual
   --out-dir-mixing fix).
2. **PROG import invariant:** pin only — `import salvage_args` must leave
   `redirect_args.PROG == "redirect_args"` (the `main()`-scoped rebind is CLI
   behavior). Test asserts the invariant after import.
3. **findings_naming tightening:** the id must follow `task(s)` with only
   ids, commas, whitespace, `#`, `and`/`or`/`&` between —
   `\btasks?\b[\s,&#]*(?:(?:and|or|\d+)[\s,&#]*)*?\b<id>\b` (word-boundary on
   the id kept; `#` admitted deliberately so "tasks #2 and #3" still names
   both). Negative pin: "Task 1 deleted 3 tests" does NOT name task 3;
   positive pins: "tasks 2 and 3 left the guard untested" names both,
   "task 22" never names "2".
4. **Duplicate snapshot skip:** `rotate_round_artifacts` skips the
   `report.json` copy when the live report is byte-identical to the highest
   existing `report-<n>.json` (manifest already dedupes by content id — this
   removes the cosmetic twin). Round numbering is unaffected. Test: two
   rotations with an unchanged report yield one snapshot.
5. **Numbering-hole pin:** test only — `--run-dir` with `report-1.json`
   absent and `report-3.json` present derives correctly (and
   `next_round` returns 4). Verified working empirically; the pin prevents
   regression.
6. **Dead guard:** in `residual_manifest.py` `main()`, the `--run-dir`
   exclusivity guard's `a.check` half is unreachable (the `if a.check:` block
   returns/dies first); drop the dead condition (`if a.reports:`) and trim the
   message to match ("--run-dir takes no positional reports"). The die-string
   reflow noted in the issue is cosmetic prose with no behavior — not touched.
7. Folded into residual 1 (chain-file probing order across
   `run_dir`/`receipt_dir`).
8. **Drain integration branch:** one sentence appended to
   `skills/ultradocket/SKILL.md` ("Parked branches are presented …"): a drain
   run's args carry no `integrationBranch` and the drain writes no
   `gate-receipt.json`, so pass `--integration-branch
   <docket-integration-branch>` when composing a Salvage/Redirect for a drain
   entry. (Prose, not machinery: `ultra_run.py` stamping was the alternative;
   the drain already knows its integration branch at composition time and the
   composers already accept the flag — no code path earns its keep.)
9. **SKILL.md Salvage bullet AND salvage_args.py docstring:**
   "budget-deferred entries are listed on stderr, not salvaged" → "other
   unfinished entries are listed on stderr, not salvaged" in
   `skills/ultrapowers/SKILL.md`, and the identical wrong wording in
   `salvage_args.py`'s module docstring (line 13) — the composer skips every
   non-failed/non-blocked unfinished entry, not only budget-deferred ones.

## Out of scope

`ultra_run.py` args stamping (residual 8's machinery alternative), any
`derive_files` restructuring (#241 NO-GO), PROG per-module rebind beyond the
pin (residual 2 names only the missing pin as the defect's test seam).

## Trim review

**Author disclosure — Adds:** the derive_files existence/declared-FILES guard
+ stderr drop report (#261's budgeted guard), a chain-file
dual-name/dual-dir fallback rule, a snapshot-skip rule, three test pins.
**Removes:** a dead guard half, cosmetic twin snapshots, findings_naming
false positives, two wrong prose claims.

**Reviewer (fresh-context, 2026-08-26; verified claims by executing the
code): 5 trims, all factual claims checked, grade FLAT.** Adopt-or-answer:

- **T1 (mask_v2 example vacuous — snake_case already dropped by #223) —
  ADOPTED.** Test tokens replaced with the three shapes that leak today:
  quoted extension list, glob mask, extension-bearing code fragment.
- **T2 (chained-launch trust nuance) — ADOPTED.** Recorded in Design §1.
- **T3 (salvage_args docstring carries the same wrong wording) — ADOPTED.**
  Residual 9 now fixes both.
- **T4 (receipt_dir-probe half untested) — ADOPTED.** Test (b) added.
- **T5 (`#` connector) — ADOPTED** as a conscious inclusion ("tasks #2 and
  #3" still names both).
- **Scope (named per reviewer):** E1 stderr drop report (anti-silent-drop,
  kept); E2 residual 7 built as the dual-dir probe rather than warn-only
  (kept — it is the fix, not a floor); E3 `or`/`&`/`#` connectors beyond the
  issue's list (kept, deliberate).
- **Factual verifications (all TRUE per reviewer):** path-shaped half
  already enforced (with the `foo(bar).py` nuance the new leg subsumes);
  dead `a.check` guard; residual-3 regex behavior on all six cases; PROG
  rebind main()-scoped; residuals 4/5 current behavior.
- **netConceptDelta: flat** (reviewer-graded; matches #261's claim).
