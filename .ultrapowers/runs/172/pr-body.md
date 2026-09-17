This plan makes the launch check a plan with the same compiler the sandbox will use, and adds one authoring rule about proof lines. It exists because two fixture runs were lost at preflight on 2026-09-17: run-26 compiled `PLAN OK` on the laptop with the installed plugin's compiler and was refused on the sandbox by a rule that had landed on main after that version, and run-25 died on a proof line that piped its output to `/dev/stderr`, which the sandbox's service shell refuses. After it, a launch either compiles with the sandbox's compiler or refuses to launch and says why, and the gotchas file warns the next author off the stderr trap before a reader is dispatched.

**Parked:** parked: gate verdict NEEDS_ACK

> do: launch a plan that compiled clean on my laptop; see: it compiles clean on the sandbox too, because the launch fetched the sandbox's own compiler at the engine sha and said so on the launch line as `compiler=<sha>`, and a launch that could not get that compiler was refused on the laptop before anything was pushed; and when I open the authoring gotchas I find the row that says a proof line writes only to stdout, with no tee to /dev/stderr.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | do: launch a plan, with or without `--engine <sha>`; see: the compile that guards the push is the sandbox's own — the launch line carries one `compiler=<sha>` line naming the same engine sha the VM comment carries — and when that compiler cannot be fetched the launch is refused on the laptop, naming the sha, with nothing compiled, nothing pushed and no VM created. | red at BASE → green | — | — | — |
| 2 | do: open the authoring gotchas before dispatching a gate reader, and open the runbook's Traps after a run dies at preflight; see: the gotchas' rows now number fifteen and the last one says a `Run:`/`Check:` line writes only to stdout — `tee /dev/stderr` is refused on the sandbox, the driver already keeps the output, and the exit must be the proving command's — and the Traps' laptop rows say the plugin cache's compiler is not the sandbox's, which is why the launch now fetches it and prints `compiler=<sha>`. | none | — | — | — |

Residuals: 3 from review

Amendments: 1 from workers

- task 1 — clause: Context: "The temp directory is made with `fsp.mkdtemp(...)`; remove it on refusal, and after the stamped compile on success." The refusal half is as written (`fetchCompilerAt` rm's its own dir before rethrowing). The success half is done at the end of the launch instead of immediately after the stamped compile: `launch()` is now a thin exported wrapper around a `launchBody()` that parks `compiler.dir` on a `held` object, and the wrapper removes it in a `finally`. — A bumped push calls `compileFor(n)` again for N+1, so removing the directory after the first stamped compile would delete the compiler out from under the second one. The wrapper also covers every refusal and lobby throw between the fetch and the return, which a single removal point after the stamped compile does not, and it avoided reindenting ~400 lines of `launch()` inside a try/finally.

<details><summary>Record</summary>

## fleet run-172 — parked

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `573495ac0c1cc98f2ccda336b2b8cae520d9de15` |
| engine | `573495ac0c1cc98f2ccda336b2b8cae520d9de15` |
| plan | `.ultrapowers/plan.md` at `e357d781a1739929648d8d50ac8927dd74388bb5` |
| branch | `ultra/integration-run-172` |
| vm | `fleet-r172-2609170431-c623` |

### Checks

```json
{"mode": "gate", "stamp": "run-172", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-172/report.json", "branch": "ultra/integration-run-172", "gateCheck": {"verdict": "NEEDS_ACK", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 2, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-172/clones/integration\nconfigfile: pytest.ini\nplugins: xdist-3.4.0\ncollected 17 items\n\ntests/test_compile_plan_exam_sweep.py .................                  [100%]\n\n============================== 17 passed in 0.28s ==============================\n"}, "verdict": "NEEDS_ACK"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-172/.ultrapowers/runs/172/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-172/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — unverified: the new `fleet/RUNBOOK.md` trap row (RUNBOOK.md:616-622) asserts runtime behavior this patch does not touch — that the launcher "fetches that copy for its compile, prints `compiler=<sha>` beside the engine line, and refuses when it cannot fetch it rather than falling back to the cache". That behavior lives in `fleet/launch.mjs`, a SIBLING FILES path owned by task 1 (popmechanic-ultrapowers#63m7). M3 is a prose pin and the diff settles it in full — the phrases appear in the required order and the row counts are 2 and 37 per the driver's own runs — so nothing here blocks. What would settle the documentation's accuracy is task 1's merged `fleet/launch.mjs`: a launch that prints `compiler=<sha>` on success and emits a `Refusal` (no cache fallback) on fetch failure. If task 1 lands with different behavior, this row becomes a stale trap and must be re-worded. No action is available inside this task's FILES.
- [ ] task 1 reviewer — Stale comment left by the declared amendment: `fleet/tests/test_launch_compile_facts.mjs`'s `compilerRule` docstring says "the launch removes the fetched directory after the stamped compile, so the only moment the bytes the `python3` argv names can be read is while the call is being answered." The amendment moved that removal to a `finally` in the `launch()` wrapper, so the directory now survives until the launch returns and the stated reason no longer holds (reading argv[0] at call time is still the right, stricter thing to do — only the justification is wrong). Reword it to say the fetched tree is removed when the launch ends, and that reading argv[0] as the call is answered pins the bytes the compile actually ran.
- [ ] task 1 reviewer — plan-defect: plan-defect: the fetched compiler is written two levels under `os.tmpdir()` (`<tmp>/fleet-compiler-XXXX/compile_plan.py`), and at that depth `compile_plan.py` cannot even be imported. `skills/ultrapowers/scripts/compile_plan.py:42` runs `PLUGIN_ROOT = Path(__file__).resolve().parents[3]` at MODULE level, not under `--run-dir` — only its single *use* (line 3444) is guarded by `--run-dir`. For `/tmp/fleet-compiler-abc/compile_plan.py` the resolved path has exactly three parents (`/tmp/fleet-compiler-abc`, `/tmp`, `/`), so `parents[3]` raises `IndexError: tuple index out of range` before `main()` ever runs. The task Context asserted the opposite ("its `PLUGIN_ROOT` … is read only under `--run-dir` … so a copy in a temp directory reads its plan … exactly as the cache copy does") and `fleet/launch.mjs`'s new `fetchCompilerAt` docstring transcribes that reasoning faithfully — hence `plan-defect:`, but the fix lies inside this task's own FILES (`fleet/launch.mjs`), so it is blocking and the implementer can carry it. The exam cannot catch this because every `python3` is answered by a stub (`compilerRule`), and EXAM/RUN evidence being green says nothing about it.

</details>

