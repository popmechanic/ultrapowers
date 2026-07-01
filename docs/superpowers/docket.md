# Docket

### #70: engine: assert every mergeable task landed in the integration ancestry (close silent done-task drop)
**State:** queued
**Score:** 9 — integration-correctness (top theme); cryptographic post-merge ancestry assertion; low-risk; suite-disposition
**Est-files:** skills/ultrapowers/harnesses/waves.js, skills/ultrapowers/references/wave-merge.md, tests/test_no_prompt_drift.py
**Plan:** docs/superpowers/plans/2026-07-01-integration-ancestry-assertion.md
**Engine:** ultrapowers

### #69: engine: cross-phase integration review before the final PR
**State:** queued
**Score:** 8 — integration-correctness; finishing-handoff review for multi-phase seams; med-risk (dense finishing path); suite-disposition
**Est-files:** skills/ultrapowers/SKILL.md, skills/ultrapowers/references/finishing-notes.md, skills/ultrapowers/references/report-format.md
**Plan:** docs/superpowers/plans/2026-07-01-cross-phase-integration-review.md
**Engine:** inline

### #64: Harvester extractors mis-parse doc-dense / self-referential sessions
**State:** triaged
**Score:** 8 — integration-correctness; BUT core fix appears already landed in main (4b9ef85+3736ea8) — verify and close, do not plan; suite-disposition
**Est-files:** skills/ultralearn/scripts/harvest_runs.py, tests/test_harvest_runs.py

### #68: run_lock.sh restore landed on the wrong branch in a multi-run session — add a post-restore guard
**State:** queued
**Score:** 7 — integration-correctness; deterministic post-restore HEAD guard; non-reproducible so hard to validate; suite-disposition
**Est-files:** skills/ultrapowers/scripts/run_lock.sh, tests/test_run_lock.py
**Plan:** docs/superpowers/plans/2026-07-01-run-lock-restore-guard.md
**Engine:** inline

### #71: ultraplan: declare test-only dependencies as explicit Depends-on
**State:** queued
**Score:** 7 — authoring-robustness; doc-only guidance across two mirrors plus drift pins; low-risk; suite-disposition
**Est-files:** skills/ultrapowers/references/plan-markers.md, skills/ultraplan/SKILL.md, tests/test_recommendation_rubric.py
**Plan:** docs/superpowers/plans/2026-07-01-test-import-depends-on.md
**Engine:** inline

### #65: ultraplan: harden compile_plan.py Files-parser + make description-edge guidance load-bearing
**State:** queued
**Score:** 7 — authoring-robustness; partly landed already (9b9f191+8f5b5ad) so re-scope to the remainder; needs compiler-internals expertise; suite-disposition
**Est-files:** skills/ultraplan/SKILL.md, skills/ultrapowers/references/plan-markers.md, skills/ultrapowers/scripts/compile_plan.py
**Plan:** docs/superpowers/plans/2026-07-01-ultraplan-compile-plan-hardening.md
**Engine:** subagent-driven

### #67: Relocate ultrapowers scratch out of .git/ (protected-path root)
**State:** queued
**Score:** 7 — path-hygiene (Q-priority 3); move review packets off .git/ultra; low-risk; self-contained; suite-disposition
**Est-files:** skills/ultrapowers/scripts/review-package.sh, skills/ultrapowers/harnesses/waves.js, tests/test_review_package.py
**Plan:** docs/superpowers/plans/2026-07-01-relocate-scratch-out-of-git.md
**Engine:** inline
