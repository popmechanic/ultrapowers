Two fixture runs parked because three tasks each installed packages, their patches all touched the lockfile, and the fold handed that file to a resolver that could not finish: a lockfile is machine-written from the manifests, and asking a model to merge one is asking it to reproduce the installer's output under a clock. After this, a lockfile never rides in a task's patch, and at each fold the driver rebuilds it from the merged manifests with the installer's own non-frozen command and commits the result before the frozen install and the suite run. A plan may let every task install what it needs, the one-task-owns-installs workaround retires, and the pull request carries a lockfile in step with its manifests.

**Merge-ready**

> When several tasks in one run add packages, the run's lockfile is rebuilt from the merged manifests at each fold, and no worker is ever asked to merge a lockfile by hand.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| A | When several tasks in one run add packages, the run's lockfile is rebuilt from the merged manifests at each fold, and no worker is ever asked to merge a lockfile by hand. | red at BASE → green | — | — | — |
| B | When several tasks in one run add packages, the run's lockfile is rebuilt from the merged manifests at each fold, and no worker is ever asked to merge a lockfile by hand. | red at BASE → green | — | — | — |

Residuals: 8 from review

Amendments: 3 from workers

- task B — clause: fleet/tests/_engine_helpers.mjs — the Context says the `captureOptions` passthrough is "the only edit that file takes"; I also gave the rig's `withPatchCapture` a default `onEvent` that appends the wrapper's events to `<runDir>/events.jsonl`, the same file run-main's `eventLog.onEvent` writes in production. `captureOptions` is spread last, so a sim passing its own `onEvent` still overrides it. — Leg (a) reads "each task's `capture:dropped` event's `paths` includes `bun.lock`". The rig passed no `onEvent` at all, so every `capture:dropped` and `capture:error` the wrapper raised fell on the floor and no sim could read one off the run's record — the drop was provable only from the patch bytes. Wiring it makes the rig more faithful to production, not less, and all 40 existing sims stay green with it.
- task B — clause: fleet/run-engine.mjs — M2 and the Context describe the regenerated commit as `git add -- <paths>` then `git commit`; I added `git reset --soft <candidate>` immediately before the stage, leaving the index `read-tree` had already filled exactly where it was. — At that point HEAD is still `prevHead` (read-tree moves the index and worktree, not the branch), so a bare commit would have had `prevHead` as its parent and the materialized candidate would not be in the adopted head's history. M2 and M5 both say the lockfile is committed ONTO the candidate, and leg (b) reads the subject `wave 1 regenerated bun.lock` "on top of the materialized candidate" — both are only true with the parent edge. The adopted log now reads `['wave 1 regenerated bun.lock', 'frontier fold wave 1', <base>]`.
- task B — clause: fleet/run-engine.mjs — the engine's exam-handoff re-capture (the second `patchAgainstBase` caller) is passed `dropLockfiles` from the run's own `regenerateCmd`, read beside `bootstrapCmd`, rather than from the wrapper's option. — The Context says "one exclusion covers both" callers, which is true of `patchAgainstBase`'s implementation but not of the opt-in: the re-capture writes over the very file the fold reads, so without its own gate a lockfile would ride back into the patch behind the wrapper that had just dropped it. The engine has no access to run-main's boolean, so it derives the same gate from the same args key.

<details><summary>Record</summary>

## fleet run-164 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `4434e0687178d02cfb658ea62467e937e6eda663` |
| engine | `4434e0687178d02cfb658ea62467e937e6eda663` |
| plan | `.ultrapowers/plan.md` at `569984bf0204247164b4691f362a148533da8234` |
| branch | `ultra/integration-run-164` |
| vm | `fleet-r164-2609161753-0cee` |

### Checks

```json
{"mode": "gate", "stamp": "run-164", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-164/report.json", "branch": "ultra/integration-run-164", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-164/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [298 items]\n\n........................................................................ [ 24%]\n........................................................................ [ 48%]\n........................................................................ [ 72%]\n........................................................................ [ 96%]\n..........                                                               [100%]\n======================== 298 passed in 81.95s (0:01:21) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-164/.ultrapowers/runs/164/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- kata.jsonl
- pr-body.md
- publish-fold
- receipt.json
- report.json
- residuals.jsonl
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-164/.ultrapowers/plan.md

### Residuals

- [ ] task A reviewer — unverified: the task's Claim ("the run's lockfile is rebuilt from the merged manifests at each fold, and no worker is ever asked to merge a lockfile by hand") and GLOBAL CONSTRAINTS 2–4 (no `resolve:` worker on a lockfile basename, no lockfile hunk in the kernel's fold
- [ ] task A reviewer — every new event kind named in `fleet/CONTRACT.md`
- [ ] task A reviewer — the guarded exam self-contained) are settled entirely outside this patch — they live in sibling task B's `fleet/run-waves.mjs`, `fleet/run-main.mjs`, `fleet/run-engine.mjs` and `fleet/CONTRACT.md`. This diff settles only the Machine slots it owns: M1 (`derive_regenerate_cmd` ladder, exam legs a–c at tests/test_ultra_run_bootstrap_cmd.py:143-220) and M2 (the args-file and receipt stamping, legs d–e at tests/test_ultra_run_bootstrap_cmd.py:225-280), and both are green in EXAM EVIDENCE (34 passed, exit 0). GLOBAL CONSTRAINT 1 is likewise only half-settled here: this patch adds `regenerateCmd` to the args file whenever the target carries a lockfile, which is precisely the flag B's capture reads, so whether a lockfile-free, manifest-free run still behaves byte-for-byte as at BASE depends on B's gating, not on these lines. What would settle it: `node fleet/tests/test_run_engine_lockfile_regen.mjs` and `node fleet/tests/test_run_engine_proof_runs.mjs` green on the merged tree, plus `grep -q 'driver:regenerated' fleet/CONTRACT.md`.
- [ ] task B reviewer — unverified: the rig change in `fleet/tests/_engine_helpers.mjs` (amendment 1) gives the SHARED `withPatchCapture` a default `onEvent` that appends `capture:dropped`/`capture:error` rows to `<runDir>/events.jsonl`. That file is the record ~20 rig-based sims read, so the change is not local to this task's exam — which, per its own header (reading 1), never calls `rig()` and so exercises neither the new default nor the `captureOptions` knob. AMENDMENTS asserts "all 40 existing sims stay green with it", but the driver's evidence covers only `test_run_engine_proof_runs.mjs` and `test_sims_are_hermetic.mjs`. My own read of the tree lowers the risk to near zero — `test_run_engine_lockfile_regen.mjs` is the only file under `fleet/tests/` that writes an untracked binary (`out/blob.bin`), no sim asserts on `captureError`, and the remaining sims filter `events.jsonl` by `kind` before asserting — so no other rig sim should produce a `capture:*` row at all. What would settle it: running the rest of `fleet/tests/test_run_engine_*.mjs` (and `test_sandbox_boot_viz.mjs`, which enumerates the `capture:*` kinds the projection skips) on this tree. Recording it rather than blocking on it, since the diff cannot settle behavior in sims it does not touch.
- [ ] task B reviewer — Leg (b) reads "`git log` of the adopted head shows the regenerated commit's subject line `wave 1 regenerated bun.lock` ON TOP OF the materialized candidate", and amendment 2 is precisely the claim that `git reset --soft <candidate>` puts the materialized candidate in the adopted head's history. The exam asserts the subject and `rev-list --count <base>..<head> >= 1`, and its header (reading 3) explicitly declines to pin the parentage — so the one assertion that would have graded amendment 2's own claim is absent: a commit written onto `prevHead` carrying the candidate tree passes every assertion in that block. The implementation IS correct (`fleet/run-engine.mjs:4476-4480` resets soft to `candidate` before staging, leaving the index `read-tree` filled), so this is advisory, not a defect in the tree. The proposed patch only ADDS assertions — every existing one is kept — so it strengthens the exam rather than loosening it.
- [ ] task B reviewer — concern: plan-defect: the Context's exam rig names `extraArgs: { width: 2, foldAgeMs: 0, bootstrapCmd, regenerateCmd }`, but leg (b) asserts exactly one `driver:regenerated` with `wave` 1 and one `driver:wave-adopted` naming BOTH tasks. With `foldAgeMs: 0` the contract's own rule is that a fold happens at every landing, siblings in flight or not, so two independent tasks fold as two epochs and the log carries two correct `driver:regenerated` rows (wave 1 and wave 2). The single-epoch reading needs NO `foldAgeMs` at all — the `end` fold, exactly as `test_run_engine_proof_runs.mjs`'s T5 arranges it and says so in its own comment. This is a disclosure about the rig line, not a claim about the leg: I reproduced both shapes in my scratch sim and the implementation is correct under either, so leg (b) passes as written once the rig omits `foldAgeMs`.
- [ ] task B reviewer — concern: The regenerated commit moves the integration branch before the candidate's suite runs, where at BASE the branch stayed on `prevHead` until the adopt (`read-tree -u --reset` is the comment's "branch unmoved"). Every downstream route still behaves: green adopts with a `reset --hard` that is now a no-op, the reconcile round's `diff --cached --quiet <candidate>` compares against the regenerated commit and its own commits stack on it, and TEST_FAILED restores `prevHead` with the existing `reset --hard` + `git clean -fd`. This only happens in a run that carries a `regenerateCmd` and whose fold actually rewrote a lockfile
- [ ] task B reviewer — a run without one is byte-for-byte BASE.

</details>

Closes #1050
