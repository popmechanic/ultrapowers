This carries #834's decision into the plugin: the exam clicks in the sandbox's own Chromium, so the Cloudflare renderer's plumbing comes out of the launcher, the setup script, the boot and the doctor, and the authoring rule teaches the interaction forms off the fixture's real exam files. It exists because the rule still tells authors the render move is skipped without a renderer address, and a doctor row still checks a credential no run uses. After this run an author writing a TinyApp plan sees the click, type and key forms with the two rules the fixture's parks paid for, and a run's report shows each exam's action wall and whether the browser ran.

**Merge-ready**

> When I read ultrawrite's TinyApp rule, it shows me the click, type and key exams the fixture actually runs, in the sandbox's own Chromium, and nothing in the plugin still names the Cloudflare renderer — the doctor has eight rows and a run's report shows each exam's action wall and whether the browser ran.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When I read ultrawrite's TinyApp rule, it shows me the click, type and key exams the fixture actually runs, in the sandbox's own Chromium. | none | — | — | — |
| 2 | The doctor has eight rows, and the laptop side — the doctor, the launcher, the setup script and the documents that list them — no longer names the Cloudflare renderer. | red at BASE → green | — | — | — |
| 3 | The boot starts a run's engine with no renderer address and reads no address file, and the boot rig and the hermetic probe stop naming one. | red at BASE → green | — | — | — |
| 4 | A run's report shows each exam's action wall and whether the browser ran. | red at BASE → green | — | — | — |

Residuals: 14 from review

<details><summary>Record</summary>

## fleet run-135 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `597c6db1493bdafaeb7f21972856a7e702847aa6` |
| engine | `597c6db1493bdafaeb7f21972856a7e702847aa6` |
| plan | `.ultrapowers/plan.md` at `92af8df043fa0e274715a5bb9cab9c2b52778440` |
| branch | `ultra/integration-run-135` |
| vm | `fleet-r135-2609150842-4942` |

### Checks

```json
{"mode": "gate", "stamp": "run-135", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-135/report.json", "branch": "ultra/integration-run-135", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-135/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 4/4 workers\n4 workers [154 items]\n\n........................................................................ [ 46%]\n........................................................................ [ 93%]\n..........                                                               [100%]\n============================= 154 passed in 27.91s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-135/.ultrapowers/runs/135/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-135/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — Pre-existing callback-form example now contradicts the prose this task added. The BASE block at skills/ultrawrite/references/greenfield-stack.md:88-95 pins `seed: "state-exams/seeds/empty.json"` → `expected: "one-open-todo.json"` with `mutant: [{table:"todos", row:"1", cell:"done", value:true}]`, while the newly added enter-submits-todo block reaches, in its own words, "the same one-open-todo state the callback exam reaches" and pins `row: '0'` (and cell `text`), justified by the added comment that "`addTodo` assigns row id `0` on a store seeded empty". The page also now teaches, two paragraphs later, that every seed and expected literal is computed at BASE and cites run-7's park for exactly this class of mistake. One of the two row ids is wrong for the same state, and the juxtaposition is what makes it visible. The task's Context froze the callback block as-is and no Machine leg covers it, so this is advisory, not a merge blocker — but the file is this task's FILES, so a follow-up can carry the one-character fix (`row: "1"` → `row: "0"`, and `cell: "done"` → the cell name the generic example means) once the operator confirms which row id the generic example intends.
- [ ] task 1 reviewer — unverified: the two added `ts` blocks are asserted to reproduce popmechanic/tinyapp-fixture's `tests/state-exams/click-completes-todo.test.ts` and `tests/state-exams/enter-submits-todo.test.ts` at `c2a75c6a`, and the surrounding prose asserts fixture-measured facts (Chromium 151 at `/headless-shell/headless-shell`, `launchBrowser`'s `TINYAPP_BROWSER` precedence and its `browser: no such binary <path>` refusal, `walls.json`'s `action_ms`/`browser` keys, `contract.json`'s `pinned_in_page`, the ~1.94 MB unminified / 789 KB minified bundle). The sandbox has no clone of the fixture (the task's own Context says so and reproduces the files inline for that reason), so this diff cannot settle whether the transcription or the measurements still match the fixture. Checked what can be checked: both blocks match the task Context character-for-character in every field, comment and literal, and all six Proof `Run:` greps are green in RUN EVIDENCE. What would settle it: diffing the two blocks against the fixture at `c2a75c6a` from a machine that has the clone.
- [ ] task 1 reviewer — Import-depth inconsistency the added blocks introduce into the page. Line 98 of the page states "The exam lands under `tests/exams/<slug>/`, so every import is written for that depth", and the BASE example imports `"../../../src/store"` accordingly. Both added blocks import `'../../client/src/storeData'` — two levels, correct for the fixture's `tests/state-exams/` location, which the added lead-ins do name ("The fixture's `tests/state-exams/click-completes-todo.test.ts`"). The transcription is what the task's Context demands verbatim, so the implementer had no lawful alternative
- [ ] task 1 reviewer — if the operator wants the page to be unambiguous for an examiner writing against a target rather than the fixture, the fix is a half-sentence in the plan's Context noting that the quoted blocks keep the fixture's own depth.
- [ ] task 4 reviewer — plan-defect: M4 pins the new `action_ms` schema type as `["integer","null"]` (and the Proof's second `Run:` greps that exact string), while M1's carry predicate is `typeof walls.action_ms === 'number'` — so a fractional wall reading (the fixture's own `walls.json` carries fractional millisecond walls, e.g. `mutant_ms: 0.3`) would be reported as a non-integer number against a schema that says integer. The diff is faithful to the task text on both sides (fleet/run-engine.mjs:24 of the patch hunk
- [ ] task 4 reviewer — skills/ultrapowers/references/report-format.md schema line), and it matches BASE's existing treatment of `store_ms`/`render_ms`, which are typed `["integer","null"]` under the same value-carried-verbatim rule. Nothing the implementer can change inside FILES fixes it: loosening the schema string to `["number","null"]` would fail the task's own `Run:` grep. Recorded for the operator
- [ ] task 4 reviewer — if the widening is wanted, it is a plan-text change to the schema line and the matching grep, in skills/ultrapowers/references/report-format.md.
- [ ] task 2 reviewer — fleet/CONTRACT.md laptop-config bullet now states two rules in tension within the same bullet: the BASE opener still says the file's keys are "every one of them optional, an unknown key ignored and a missing file meaning the defaults", while the new closing sentence says "A key outside those three is a key nothing reads: the `capacity` row is red and names it." Both are true of different readers (`loadFleetConfig` ignores it
- [ ] task 2 reviewer — `capacityRow` reds on it), but a contract document should say so rather than leave the adjacent sentences contradicting each other. Suggested: change the opener's clause to "an unknown key ignored by the loader" (or drop it) so the closing sentence is the one rule the bullet states about stale keys. M5 is satisfied either way — the JSON example and the three-key list are correct.
- [ ] task 2 reviewer — Wording/wrapping left ragged by the in-place removals. (1) fleet/CONTRACT.md ~line 671: the sentence is now "`claude-max` carries the same policy. Every one of them reaches a run's VM by that policy and by nothing else" — "Every one of them" lost the plural list it referred to at BASE (`claude-max` and the rendering integration) and now trails a sentence naming a single object
- [ ] task 2 reviewer — the intended antecedent is the target's `gh-<owner>-<repo>` plus `claude-max`, which should be said. (2) Short/ragged lines left mid-paragraph in a hard-wrapped tree where the surrounding prose wraps near column 95: fleet/CONTRACT.md ~212 ("`gh-<owner>-<repo>` — carries the complete"), ~671 ("revision). `claude-max` carries the same policy. Every one of them reaches a run's VM"), fleet/RUNBOOK.md ~145 ("policy\"), so `claude-max` and the target's object each carry the"), fleet/launch.mjs ~1116 ("// The hub, on the same branch the account takes: an injected") and ~1183–1184 ("— `claude-max` and the" / "// target's object — reach the box by the"). Re-flow those paragraphs. No Machine clause is affected.
- [ ] task 2 reviewer — unverified: the new sim `fleet/tests/test_doctor_rows.mjs` lands in `fleet/tests/`, which `fleet/tests/test_sims_are_hermetic.mjs` sweeps (its M2 inherit rule, M3 absolute-path rule and M4 sibling rule apply to every `fleet/tests/test_*.mjs`), and that probe is not among this task's Proof `Run:` commands, so this task's evidence does not cover it. A static read of the new sim says it should pass: it starts no process at all (no `spawn`/`exec` family call, so the inherit and sibling rules have nothing to match), and every `fs` call takes a `path.join(...)`/`os.tmpdir()` argument rather than a string literal starting `/`, so the absolute rule has nothing to match either. Running `node fleet/tests/test_sims_are_hermetic.mjs` on the integration tree after the fold would settle it.
- [ ] task 3 reviewer — Claim-vs-delivered gap: the Claim says "the boot rig and the hermetic probe stop naming one [an address file]", but `fleet/tests/test_sims_are_hermetic.mjs` still names the renderer's address file at its leg (c) sweep example — the test title "the same sweep names the box's render.env …", the sweep input `sweep("fs.readFileSync('/etc/fleet/render.env', 'utf8')", …)` and its assertion message (BASE lines 848–851, ~841–844 in the patched file). This is lawful under the stated exam: M4 enumerates only the header M5 block, the `PLANT` pair, the M7 fixture pin and the two leg-(i) tests, the Context says "Renumber nothing else", and the fourth `Run:` line counts only `TINYAPP_RENDER_URL` and `FLEET_RENDER_ENV` across the three files — so the residual `/etc/fleet/render.env` is outside every machine leg, and the new exam's leg (d) only forbids `render.env` in the fixture, not the probe. The string is a generic absolute-path example for the sweep, so nothing is wrong functionally
- [ ] task 3 reviewer — renaming it to the planted path the task otherwise standardises on would make the probe consistent with the rest of the removal. Not blocking — the submission satisfies M1–M5 and every Proof line as written.

</details>

Closes #997
