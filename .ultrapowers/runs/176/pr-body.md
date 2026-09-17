Nearly a quarter of the proof-gate's rejections are exams that already pass before any work lands, so they prove nothing. This plan has the compiler run every proof command against the base commit and say plainly which ones are already green there. You see the hollow proofs on the launch line before a run pays for them, and after one release's count the line becomes a refusal.

**Merge-ready**

> `compile_plan.py --check --base <sha>` executes each task's `Run:` lines in a clean worktree at BASE (the `BASE fact:` machinery already reads the tree there) and prints one line per line that exits 0

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | do: run `compile_plan.py --check --base <sha>` on a plan whose proof commands already pass at that commit; see: after `PLAN OK` one line per such command saying it exits 0 at BASE — that it cannot falsify its clause when a leg tag pairs it, or that it is a guard when nothing does — one line per command that ran past 30 seconds, and a last line with how many seconds the whole rehearsal took; and a bare `--check` prints none of it. | red at BASE → green | — | — | — |
| 2 | do: open the ultrawrite skill's Proof slot description, or the plan-markers reference's Proof grammar, before writing a `Run:` line; see: both say that a `Run:` ending in a clause tag is a prover and one without is a guard, that `--check --base` now runs every `Run:` at BASE and prints a `GREEN-AT-BASE fact:` line for each that exits 0 — a prover's line saying it cannot falsify its clause — that a line past 30 s is reported not run, and that this release the line is a fact, not a refusal. | none | — | — | — |
| 3 | do: launch a plan whose compile printed `GREEN-AT-BASE fact:` lines; see: those lines on the launch line, in the order the compiler printed them, beside the `BASE fact:`, `STALE fact:` and `AUTHORING fact:` lines — and the runbook's per-run section says so. | red at BASE → green | — | — | — |

Residuals: 6 from review

Amendments: none

<details><summary>Record</summary>

## fleet run-176 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `766b261576990467742807da256f3a13c19d26a0` |
| engine | `766b261576990467742807da256f3a13c19d26a0` |
| plan | `.ultrapowers/plan.md` at `c5327a782ba45b4d0063a4b5321bd308e566a245` |
| branch | `ultra/integration-run-176` |
| vm | `fleet-r176-2609170707-59cd` |

### Checks

```json
{"mode": "gate", "stamp": "run-176", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-176/report.json", "branch": "ultra/integration-run-176", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-176/clones/integration\nconfigfile: pytest.ini\nplugins: xdist-3.4.0\ncollected 19 items\n\ntests/test_compile_plan_green_at_base.py ...................             [100%]\n\n============================== 19 passed in 3.20s ==============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-176/.ultrapowers/runs/176/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-176/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — undeclared amendment: the `Run:` example added to `skills/ultrawrite/SKILL.md` drops the regex escaping the task's Context supplied verbatim. The Context pins the illustration as `- Run: grep -q 'kata 0\.17\.2' fleet/CONTRACT.md [M2]`
- [ ] task 2 reviewer — the diff writes `- Run: grep -q 'kata 0.17.2' fleet/CONTRACT.md [M2]`, whose unescaped dots match any character. No Machine clause pins this literal (M1 orders only the eight phrases, all present, and the first Proof `Run:` exits 0), so it blocks nothing — but this paragraph is what authors copy when writing a prover line, and the escaped form is the one that greps what it says it greps. No AMENDMENTS entry declares the change.
- [ ] task 3 reviewer — unverified: this task's legs prove carriage only against a hand-written fake stdout (`GREEN_PROVER`/`GREEN_GUARD`/`GREEN_NOT_RUN`/`GREEN_SUMMARY` in fleet/tests/test_launch_compile_facts.mjs), so nothing inside fleet/ establishes that the compiler Task 1 ships actually emits lines beginning `GREEN-AT-BASE fact:`. The exposure is narrow — the filter at fleet/launch.mjs:815 keys on the prefix alone, so only a divergence in the prefix itself (not in the wording, the em dash, or the summary shape) would silently drop the lines on the laptop again. What would settle it: task 1's exam (tests/test_compile_plan_green_at_base.py legs (d) and (g)), which pins the emitted literals under `--check --base`
- [ ] task 3 reviewer — no edit inside this task's FILES can answer it.
- [ ] task 1 reviewer — `green_at_base_lines` swallows a failed `git worktree add`: `ok, _ = _git_run(base_tree.repo, "worktree", "add", "--detach", worktree, sha)` is followed by `for task_id, command, cites in (runs if ok else [])`, so when the cut fails the function skips every command and still returns only M6's reading — `GREEN-AT-BASE fact: 0.0 s over 0 lines run, 0 not run (timeout)`. That is byte-identical to the line a plan with no `Run:` bullet at all produces, so an operator cannot tell "nothing to rehearse" from "the rehearsal never happened". M3/M6 do not pin this path, and the whole exam is green, so this is advisory only. The cheapest fix keeps every stdout shape M4–M7 pin untouched and puts the diagnosis on stderr, beside the compiler's other non-verdict warnings.
- [ ] task 1 reviewer — unverified: the diff changes three shared compiler seams beyond the new function — `parse_claims_body`'s returned dict gains `proof_run_cites`, `run_citation_violations` adds a new grammar refusal class that every parse (plain compile as well as `--check`) now draws, and `--check --base` gains new stdout lines between the STALE advisories and the `AUTHORING fact:` line. The Proof names only `tests/test_compile_plan_green_at_base.py`, and RUN/EXAM EVIDENCE cover only that file, so no evidence here shows the compiler's other suites still pass. Two checks I could make from BASE are reassuring — no test pins the key set of the `claims` dict, and a repo-wide search for a `Run:` bullet whose value ends in a `[Mn]` tag finds only a comment in `fleet/tests/test_run_engine_proof_runs.mjs:746`, not a plan bullet, so no existing plan is newly refused — but the ordering change under `--check --base` is the one the task's own Context flags as load-bearing for `tests/test_authoring_record.py` (lines 191–194) and the bare-`--check` `stdout.strip() == "PLAN OK"` pins in `tests/test_compile_plan_edges.py`, `tests/test_authoring_record.py` and `tests/test_compile_plan_exam_sweep.py`. Running `python3 -m pytest -q tests/test_compile_plan_edges.py tests/test_compile_plan_exam_sweep.py tests/test_authoring_record.py` would settle it.

</details>

Closes #1098
