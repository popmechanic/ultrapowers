This plan gives a plan one place to say what packages it needs and makes the run install them once, at setup, as a commit every worker starts from. It exists because a task that installs a package mid-run changes the ground under its siblings, the fold's lockfile rebuild resolves versions the worker never saw, and every re-anchor pays the install again. After it the environment is declared rather than discovered: the operator reads the packages off one header line, a worker that edits a manifest it does not own is told so before any reviewer reads its patch, and the fold's lockfile rebuild stays as the fallback for a manifest a task legitimately owns.

**Merge-ready**

> do: write the packages a plan needs on one `**Dependencies:**` line and launch it; see: the run installs them once, before any worker starts, as one commit every task is built on and every diff is read against — a task that tries to add a package by editing the manifest itself is stopped on the driver's own pass with a line that says where the package belongs, and a plan with no such line runs exactly as it does today.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | do: write `**Dependencies:** tailwindcss@^4 @tailwindcss/vite dev: eslint @shadcn/lint` under the plan's Tech Stack line and compile it; see: the compiled plan carries those four packages, two of them marked as development-only, a misspelled line is refused at `--check` with a sentence naming the offending word, and a plan without the line compiles with no such key at all. | red at BASE → green | — | — | — |
| 2 | do: launch a plan that declares packages against a target whose tree says which package manager it uses; see: the run's arguments name that manager's add command, for runtime and for development packages, read off the same lockfile-or-manifest ladder that already picks the install command — and a plan that declares none leaves the arguments exactly as they are today. | red at BASE → green | — | — | — |
| 3 | do: run a plan whose arguments carry declared packages and an add command; see: before any worker starts, the run adds the packages in its integration clone and commits the manifest and lockfile as one commit under the plan's title, every task is built on that commit and its diff is read against it, a failed install parks the run with the installer's own words and no worker is ever dispatched — and, on every run, a task whose patch edits a manifest its Files do not list is told on the driver's pass that packages belong on the plan's Dependencies line. | red at BASE → green | — | — | — |

Residuals: 7 from review

Amendments: 1 from workers

- task 2 — files: tests/test_ultra_run.py — `test_happy_path_receipt` gains `add-command` between `bootstrap-command` and `dirty-baseline` in its pinned stage list (4 lines changed, one row inserted) — That leg asserts the receipt's stage list by exact equality, and M3 requires the `add-command` row on every run, declared line or not — so the task cannot be green without it. It is the only consumer of the stage list in the repo (grep over tests/, skills/, fleet/); no fleet file reads it.

<details><summary>Record</summary>

## fleet run-170 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `631af3765dd353f1879dd1a8887b130b395467c3` |
| engine | `631af3765dd353f1879dd1a8887b130b395467c3` |
| plan | `.ultrapowers/plan.md` at `8611f5cb8bd33124b941c93d1859e9a1f52adffb` |
| branch | `ultra/integration-run-170` |
| vm | `fleet-r170-2609170048-73bb` |

### Checks

```json
{"mode": "gate", "stamp": "run-170", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-170/report.json", "branch": "ultra/integration-run-170", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-170/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [392 items]\n\n........................................................................ [ 18%]\n........................................................................ [ 36%]\n........................................................................ [ 55%]\n........................................................................ [ 73%]\n........................................................................ [ 91%]\n................................                                         [100%]\n======================= 392 passed in 131.40s (0:02:11) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-170/.ultrapowers/runs/170/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-170/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — Code-quality (rule 5), `skills/ultrapowers/scripts/compile_plan.py`: `parse_dependencies`'s docstring contradicts its own body on the second-`dev:` case. The docstring says of a second `dev:` word "it stays a word of the development group here so the violation names it rather than silently re-partitioning the line", but the return statement filters it out (`"dev": [w for w in words[cut + 1:] if w != DEPENDENCIES_DEV_MARKER]`), so `**Dependencies:** a dev: b dev: c` parses to `{"runtime": ["a"], "dev": ["b", "c"]}` with the marker dropped. Nothing observable breaks — such a line is refused by `dependencies_violations` (which reads the raw words, not the parse result) on both the `--check` path and the compile path, so the object never reaches a payload — and M1's wording ("the words after it in order as `dev`") only bites on a line that is already refused, which is why this is minor rather than blocking. The comment is the thing to correct: it tells the next reader the opposite of what the code does. Proposed patch fixes the docstring
- [ ] task 1 reviewer — the alternative fix (dropping the filter so the marker survives, matching M1 literally) would also change `**Dependencies:** dev: dev:` from two violations to one, so the docstring fix is the safer of the two.
- [ ] task 3 reviewer — `parkAtSetup` names EVERY plan task in `unfinished` (`const held = PLAN.map((t) => t.id)`), unlike its own precedent `parkOnRedBaseline` (fleet/run-engine.mjs:5039,5046) which filters `!adoptedIds.has(t.id)` and skips any id with a `resultFor(id)`. On a re-drive that reused tasks (#383) and whose dependency install then exits non-zero, each reused task already has a `taskResults` row pushed at Setup (`status: 'done'`, `reviewVerdict: 'reused'`, fleet/run-engine.mjs:2582), so it would appear BOTH as a `report.tasks[]` entry and as a `'<id>: never dispatched — the dependency install failed at setup'` string in `report.unfinished` — which skills/ultrapowers/references/report-format.md's own `tasks` row forbids ("a task that never became ready is reported as a string in `unfinished`, not as a `tasks[]` entry"), and which also contradicts M5's `report.tasks` is `[]`. M5's wording ("every task id in plan order") does not contemplate reuse, so the literal transcription is defensible and the exam (leg g, no reuse) cannot see it
- [ ] task 3 reviewer — graded minor. The one-line filter below keeps leg (g) green — with no reuse, `reusedIds` is empty and `resultFor` is undefined for both tasks, so `['A','B']` is unchanged.
- [ ] task 3 reviewer — The setup commit's staging read uses `git status --porcelain` at its default `--untracked-files=normal` (fleet/run-engine.mjs:~2664), which COLLAPSES a newly-created untracked directory to a single `?? dir/` entry instead of listing the files inside it. A manifest the add command creates in a directory that did not exist at BASE — `?? client/` rather than `?? client/package.json` — therefore fails the `bootstrapManifestChanged([p])` filter (the basename read is `client/`), is never staged, and is lost when the run continues: the packages are in no commit and every clone anchored at the setup head is missing them. The sim never sees this because `add.sh` only modifies the tracked root `package.json` and writes `bun.lock` at the root. `-uall` fixes it and changes nothing leg (c2) asserts: `node_modules/marker` would then be listed as a file but is still filtered out by basename, and `bun.lock`/`package.json` are unaffected.
- [ ] task 3 reviewer — undeclared amendment: the Context specifies leg (e)'s fixture as "a proof `Run:` of `echo $ULTRA_BASE > ultra-base.txt` on one task"
- [ ] task 3 reviewer — the sim gives task A a SECOND proof `Run:` (`test -f fix-ran.txt`, fleet/tests/test_run_engine_declared_dependencies.mjs:~349 and again in the (f.1) fixture) that is red on the first pass purely to force a `fix:A:0` re-capture so the file rides into the folded tree. The sim discloses this in its header ("reading 1") but no AMENDMENTS entry declares it. Nothing to revert: leg (e)'s claim is unchanged — the same `Run:`, the same variable, the same file, read off the folded tree — and the assertions it carries are strictly stronger. Recorded so the next reader does not have to re-derive why the second `Run:` is there.

</details>

