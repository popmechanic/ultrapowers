This plan puts a self-hosted Workers runtime, celld, on every fleet sandbox so a TinyApp's exams can run against a real Durable Object with no network and no credential. It exists because the convergence exam and the forked-state probes need that runtime in the sandbox before any fixture plan can use them, and because a two-task TinyApp run today gets a box too small for two browsers. After it, a TinyApp run has its runtime and its memory, and the next plan's author starts from the module-object shape that proved green on the laptop.

**Merge-ready**

> do: launch a TinyApp plan on the fleet; see: the sandbox already carries celld at the pinned release, the box is sized for the browsers the run will hold open at once, and the plan's author was told the app shape, one root and one module object per store, and what an exam must do to start and stop the runtime cleanly.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | do: launch a run; see: its sandbox's first-boot setup installs celld 0.5.0 at `/usr/local/bin/celld`, but only after the downloaded release's digest matches the one recorded in the plugin beside bun's version, the run's unit and the engine's service both raise the open-file limit, the setup script is still under its byte budget, and the contract and the runbook say so. | red at BASE → green | 4/4 | — | — |
| 2 | Memory is sized by browser concurrency, not task count: floor 6 GB, `2 GB + 1.25 GB × C` where C is the number of browsers a run may hold open at once (the plan's width for a TinyApp target, 0 otherwise), capped at 12 GB; CPU keeps the width formula. | red at BASE → green | 5/5 | — | — |
| 3 | do: open the greenfield rule as the author of a TinyApp plan; see: the app's server shape is one root object per app instance and one module object per store, addressed by instance and module name, with the exam surface the root serves named verb by verb, and a section on the runtime host that says how an exam starts celld, budgets it, stops it, and what it must never do. | none | — | — | — |

Residuals: 6 from review

Amendments: 3 from workers

- task 1 — clause: `fleet/setup-script.mjs`: the render's size refusal now tests `SETUP_SCRIPT_BUDGET_BYTES` (9216) before `SETUP_SCRIPT_MAX_BYTES` (10240) and always names the budget, appending "(and past the platform's ceiling of 10240)" when the render is past that too. — Proof leg (b) asks a render whose `unit` is padded by 9216 bytes to throw "with a message naming the budget". At BASE such a pad clears 10240 first, so the message named only the ceiling and the leg as written could not pass. The budget is the tighter bound and the one a human acts on, so it fails first; no sim or caller pinned either message text.
- task 1 — clause: `fleet/sandbox-boot.sh` and `fleet/CONTRACT.md`: the publish fold's `systemd-run` gained `-p LimitNOFILE=524288` beside the engine's, which M3 names alone. — The contract states the fold runs "through the same `systemd-run` prefix as the engine's line above, entry for entry" (the task's Context says that line "gains the same property"), so leaving the fold out would have made that sentence false — and the fold is what runs the suite, which is what exhausts a soft 1024.
- task 1 — clause: `fleet/CONTRACT.md` duty 4: the unit-template directive list now names `LimitNOFILE=524288` with its one-line why. — M4 names only the setup-script bullet and the engine line, but duty 4 enumerates the template's directives exhaustively; adding the line to `fleet-run@.service` without it would leave the contract's enumeration wrong, against the Claim's "the contract and the runbook say so".

<details><summary>Record</summary>

## fleet run-173 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `3c61d8d795fddd14a3b60cc140bacf0e09fc23d2` |
| engine | `3c61d8d795fddd14a3b60cc140bacf0e09fc23d2` |
| plan | `.ultrapowers/plan.md` at `eb792b5414b7038ee9e53068277331866f11bb92` |
| branch | `ultra/integration-run-173` |
| vm | `fleet-r173-2609170628-af8c` |

### Checks

```json
{"mode": "gate", "stamp": "run-173", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-173/report.json", "branch": "ultra/integration-run-173", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-173/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [417 items]\n\n........................................................................ [ 17%]\n........................................................................ [ 34%]\n........................................................................ [ 51%]\n........................................................................ [ 69%]\n........................................................................ [ 86%]\n.........................................................                [100%]\n======================= 417 passed in 161.92s (0:02:41) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-173/.ultrapowers/runs/173/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- frontier
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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-173/.ultrapowers/plan.md

### Residuals

- [ ] task 3 reviewer — unverified: the new `## The runtime host` section asserts that on a fleet sandbox "celld is already at `/usr/local/bin/celld`, put there by the fleet's own setup script and verified by digest" (skills/ultrawrite/references/greenfield-stack.md:277-279). That is a cross-task claim about sibling task 1's `fleet/setup-script.mjs`, which this patch does not touch and cannot settle. The plan text for task 1 does specify the same path and a `sha256sum -c` digest check before `sudo -n install -m 0755 celld /usr/local/bin/celld`, so the sentence is consistent with the plan as written
- [ ] task 3 reviewer — what would settle it is the integrated tree — task 1's rendered setup script actually installing celld 0.5.0 at that exact path. No change is needed in this diff unless task 1 lands a different path.
- [ ] task 2 reviewer — Stale header description left behind by this change. `stampWidth` now writes `# fleet: width=<W> browsers=<C> — …` (M4), and the module doc-comment paragraph at lines 43–50 was updated to match (`vmSizeFor(W, cap, C)`, `browsersFor`), but the earlier paragraph of the same comment — step 5 of the launch order, line 36 — still says the setup script carries a `# fleet: width=<W>` header. `fleet/CONTRACT.md`'s launch-order bullet was corrected to `# fleet: width=<W> browsers=<C>` (Proof Run 3, exit 0), so the launcher's own file is now the only place in the tree that describes the old header. Nothing executes this line, so it blocks nothing
- [ ] task 2 reviewer — it is a one-line reflow.
- [ ] task 2 reviewer — unverified: the two existing launcher sims — `fleet/tests/test_launch_compile_facts.mjs` and `fleet/tests/test_launch_duplicate.mjs` — drive `launch()` end to end over the surface this diff changes (the lifted `sizeFromCompile`, the new `browsers` field on the resolved result, the new `stampWidth` note text), and neither appears in RUN, EXAM or CHECK EVIDENCE
- [ ] task 2 reviewer — the Proof's Test path and the two Check commands do not cover them. The task's Context says not to edit them, and the diff does not. Reading them settles most of the risk: both pin only `CAPPED = { cpu: '6', memory: '8GB' }` and assert `deepEqual` on sub-fields rather than on the whole result's key set, no test file in the tree matches `stampWidth` or `# fleet: width=`, and their fixture plans name no state exam so `browsersFor` returns 0 and `min(cap, 2 + W)` is unchanged. What would settle it outright: `node fleet/tests/test_launch_compile_facts.mjs` and `node fleet/tests/test_launch_duplicate.mjs`, each expected to print `ALL TESTS PASSED`.

</details>

Closes #1087
