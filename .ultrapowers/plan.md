# One kata project per target — the launcher seeds it idempotently, and a proof that runs a sibling's file is an edge

**Grammar:** claims-v1

**Claim:** One kata project per target repository, not per run: the launcher files a run's tasks as issues into the target's project, each carrying its `Consumes:`/`Produces:` edges as `--blocked-by`, plus the edge the compiler derives from a `Run:` or `Check:` that names a path in a sibling task's Files (the seam run-127's task 1 failed on — see the 2026-09-14 comment on #810). The plan stays an idempotent seed: re-filing the same plan creates nothing twice. (quoted from #978)
**Summary:** This makes the kata hub hold one project per repository, so every run's tasks land in the same place and a plan can be filed twice without doubling up. It exists because the run-127 park showed a task can depend on a sibling through its proof alone, an edge nothing filed, and because per-run projects orphan their record. After this run you can relaunch a parked plan and see its open tasks resume rather than reappear, and a task whose proof runs a sibling's file waits on that sibling instead of failing red.

**Goal:** Blackboard Phase B (map #810, re-chartered 2026-09-13; filed as #978 on 2026-09-14). Four seams, one wave: the compiler derives the `proof-run` edge (the 2026-09-14 comment on #810) and refuses a run-wide `Check:` that one task's file would green (operator, 2026-09-14: refuse, never a run-wide edge); the launcher names the project for the target, seeds each task with an `Idempotency-Key` and no purge on a bump; the janitor finds a run inside the target's project; the boot's `kata.jsonl` export is the run's slice of a shared project. The spoke daemon of the re-charter is not this plan (operator, 2026-09-14), and the hub's existing per-run projects stay as the record they are.
**Closes:** #978

**Tech Stack:** Node 20+ (`fleet/*.mjs`, sims under `fleet/tests/`), Python 3 (`skills/ultrapowers/scripts/compile_plan.py`, exams under `tests/`), bash (`fleet/sandbox-boot.sh`). Test command: `python3 -m pytest -n auto` from the repo root (the bridge runs the sims).

**Spec:** #978's body and the 2026-09-13 re-charter comment on #810 (moves 1, 2 and 6); the hub facts measured on 2026-09-14 are in each task's Context, since the sandbox has no hub and no spec.

**Parallelization rationale:** one wave, width 4. No task consumes another's runtime behaviour: the launcher files whatever `dag_edges` the compiler prints and its sim hands it a prepared payload, so Task 2 does not wait on Task 1; Task 3 and Task 2 make the same one-line change to `kataProjectFor` in `fleet/lobby.mjs` (a shared literal, stated in both Contexts, which folds as one edit); Tasks 2, 3 and 4 each edit a different paragraph of `fleet/CONTRACT.md`, which folds as text.

## Global Constraints

- The engine, the roles, the kernel and the fleet's other scripts are untouched: `fleet/run-engine.mjs`, `fleet/run-main.mjs`, `fleet/run-waves.mjs`, `fleet/run-worker.mjs`, `fleet/confine-hook.mjs`, `fleet/publish-fold.mjs`, `fleet/fleet-bootstrap.sh`, `fleet/doctor.mjs`, `fleet/target.mjs`, `fleet/claude-token.mjs`, everything under `fleet/roles/` and everything under `skills/ultrapowers/kernel/` are byte-identical to BASE.
- Check: git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/run-main.mjs fleet/run-waves.mjs fleet/run-worker.mjs fleet/confine-hook.mjs fleet/publish-fold.mjs fleet/fleet-bootstrap.sh fleet/doctor.mjs fleet/target.mjs fleet/claude-token.mjs fleet/roles skills/ultrapowers/kernel
- The hub is reached only through `fleet/kata-client.mjs` from the laptop and the engine, and only through `fleet_curl` from the boot: no task adds a `kata` CLI invocation to the launcher, the janitor or the boot, and every mutation the client sends still carries `actor` in its body.
- No sim reaches a network or the real hub: every hub a sim drives is an injected object or the boot rig's stub `curl`.
- The `.ultrapowers/kata.json` record keeps its shape and key order: `{"url", "project": {id, uid, name}, "run": {uid, revision}, "tasks": {"<id>": {uid, short_id, revision}}}`, `JSON.stringify(…, null, 2)` plus a trailing newline.

### Task 1: A proof that runs a sibling's file orders the two, and a run-wide Check that one task's file would green is refused

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Test: `tests/test_compile_plan_edges.py`

**Claim:** After this run, a task whose proof runs a file another task owns is placed after that task, and a plan whose run-wide check runs a file one task owns is refused before anything is filed. (derived)
Machine: M1. For implementation tasks A and B, when a Proof `Run:` command of B names a path that is in A's Files (any of its `Create:`, `Modify:`, `Delete:` or `Test:` bullets) and not in B's own Files, `compile_plan.py` emits `{"from": "<A>", "to": "<B>", "why": "proof-run"}` in `dag_edges` and B's wave is later than A's; a path is "named" when it occurs in the command as a whole token, not as a substring of a longer path. M2. When the named path is also in B's own Files, no `proof-run` edge is emitted and the two tasks keep the wave the other tiers give them. M3. A `proof-run` edge yields to an opposing interface path: when A's `Run:` names B's file and A `Consumes:` a symbol B `Produces:`, the interface edge B → A stands, no `proof-run` edge is emitted, and the compile exits 0. M4. Under `--check`, a Global Constraints `Check:` command that names a path in any implementation task's Files is a refusal: the exit is non-zero, the output names that task's id and the path, and `PLAN OK` is not printed; the same plan with that `Check:` removed prints `PLAN OK`. M5. `skills/ultrawrite/SKILL.md` says, in its Task shape section, that ordering is also derived from a Proof `Run:` that names a sibling's file, and in its Global Constraints discipline section that a `Check:` naming a file one task owns is refused at `--check`.

**Authorized-by:** #978; the 2026-09-14 comment on #810 ("The rule: a `Run:` (or `Check:`) whose command names a path in a sibling task's Files is a `blocked-by` edge on that sibling, derived mechanically"); operator decision 2026-09-14 (a `Check:` is refused, not made a run-wide edge); run-127 task 1 `proof-red`.

**Interfaces:**
- Consumes: none
- Produces: `dag_edges` entries with `why: "proof-run"` — `{"from": "<blocker id>", "to": "<blocked id>", "why": "proof-run"}`, in the compiler's stdout JSON beside the `interface`, `write-after-create` and `non-text-overlap` tiers

**Context:** At BASE (`c3c8fa9b`) every derived tier lives in `build_edges(impl, tree_root)` (`compile_plan.py` ~2028–2140): `write-after-create`, then `interface` (which promotes an existing pair's `why`), then `non-text-overlap`, each through `add(a, b, why)` and the `would_cycle` guard that yields to any opposing path already recorded. Add the `proof-run` tier after the interface tier and before `non-text-overlap`, so an interface edge already recorded wins the cycle guard (M3). Each task dict carries `creates`, `modifies`, `deletes`, `reads` (its `Test:` paths, ~1263–1279) and `proof_runs` (the `Run:` commands verbatim, ~872). A path is named by a command when `re.search(r'(?<![\w./-])' + re.escape(path) + r'(?![\w./-])', command)` matches — a whole token, so `fleet/tests/a.mjs` does not match a command naming `fleet/tests/a.mjs.bak`; do not shell-split, because `test "$(grep -c x path)"` glues `)"` to the path. Run-wide `Check:` commands are `parse_constraint_checks(plan_text)` (~1385–1400), a list of `{"cmd", "minor"}` computed at ~2658 in `main` right before `impl` and `build_edges`; M4 applies to every entry, `minor` or not, matched by the same regex against every implementation task's four Files sets, and is a refusal in the shape the `--check` path already prints for a task violation — one line naming the task id and the path, non-zero exit, no `PLAN OK`. `dag_edges` is the key `launch.mjs` reads (`dag_edges: edges` at ~2765); the `--emit-launch`/`--emit-args` files carry the same list as `edges` pairs and `dependencyEdges` prose (~2800, ~2815) and need no change beyond what the new entries give them. `layer(impl, edges)` (~2160) already places a blocked task in a later wave. The compiler's probe fixture `evals/fixtures/claims/plan.md` is not a plan this rule fires on: check with `python3 skills/ultrapowers/scripts/compile_plan.py --check evals/fixtures/claims/plan.md` before and after, both `PLAN OK`. The exam is a pytest file in the shape of `tests/test_review_peer.py` — it writes small claims-v1 plans to a temp directory and runs the compiler as a subprocess (`COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"`), so its plans need the full header the compiler requires (`**Grammar:** claims-v1`, a plan-level `**Claim:**` with a provenance tag, six body slots per task, numbered Machine clauses each cited by a leg) — copy the shape from `evals/fixtures/claims/plan.md`. No `--base` is needed for these legs; `dag_edges` is on stdout without one. In `skills/ultrawrite/SKILL.md`, the sentence to extend is under Task shape: "Ordering is derived from Interfaces token-matching and Files overlap; same-path overlap is derived from Files." — add that a Proof `Run:` naming a path in a sibling's Files orders the sibling first (the run-127 seam); under Global Constraints discipline, beside "put it there, and keep this section for what no single task owns", add that a `Check:` naming a file a task's Files own is refused at `--check`. Word the two sentences plainly; no all-caps.

**Proof:**
- Test: `tests/test_compile_plan_edges.py`
- Guard: `tests/test_compile_plan_edges.py`
- Run: python3 skills/ultrapowers/scripts/compile_plan.py --check evals/fixtures/claims/plan.md | grep -q 'PLAN OK'
- Run: sed -n '/^## Task shape/,/^## Elicit the claim/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'Run:.*sibling'
- Run: sed -n '/^## Global Constraints discipline/,/^## Execution handoff/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'Check:.*refused'
- Legs: (a) a two-task plan where task 2's `Run:` is `node fleet/tests/sim_a.mjs | grep -q PASSED` and task 1's Files carry `Modify: fleet/tests/sim_a.mjs`, no Interfaces edge: `dag_edges` is exactly one entry `{from: "1", to: "2", why: "proof-run"}` and `waves` is `[["1"], ["2"]]`; the same with the path under task 1's `Test:` bullet instead of `Modify:` gives the same edge; and a plan where the command names `fleet/tests/sim_a.mjs.bak` while task 1 owns `fleet/tests/sim_a.mjs` gives no edge and one wave of two [M1]; (b) the same plan with `fleet/tests/sim_a.mjs` also under task 2's `Modify:`: `dag_edges` is `[]` and both tasks share wave 1 [M2]; (c) task 1's `Run:` names task 2's file and task 1 `Consumes:` a symbol task 2 `Produces:`: `dag_edges` is exactly the one `interface` edge from 2 to 1, no entry has `why: "proof-run"`, exit 0, waves `[["2"], ["1"]]` [M3]; (d) a plan whose Global Constraints carry `- Check: node fleet/tests/sim_a.mjs` while task 1 owns that path: `--check` exits non-zero, stdout+stderr contain `1` as the task id and `fleet/tests/sim_a.mjs`, and not `PLAN OK`; the same `Check:` marked `(minor)` is refused the same way; the plan with the `Check:` line removed prints `PLAN OK`; and the probe fixture prints `PLAN OK` by the first `Run:` [M4]; (e) the two scoped greps over `skills/ultrawrite/SKILL.md` by the second and third `Run:` lines [M5].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- path-absent: `evals/fixtures/claims/plan.md`

### Task 2: The launcher files a run into the target's one project, as an idempotent seed with its edges, and a bump refiles instead of purging

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/lobby.mjs`
- Modify: `fleet/kata-client.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/tests/test_launch_bump.mjs`
- Modify: `fleet/tests/test_launch_size.mjs`
- Test: `fleet/tests/test_launch_kata_seed.mjs`

**Claim:** After this run, every launch against one repository files into that repository's one kata project, filing the same plan twice creates no second issue for any task, each task's edges are on the hub as blocks links, and a launch whose run number bumps refiles under the new number without purging anything. (derived)
Machine: M1. `kataProjectFor(target)` takes one argument and answers `<owner>-<repo>` (every `/` of the target spelled `-`), and the launcher's `createProject` is called with exactly that name; a hub that already holds the name answers the existing project and the launcher files into it. M2. Each task issue is created with an `Idempotency-Key` header equal to `<target>:<plan sha>:task-<id>`, where `<plan sha>` is the 40-hex git blob sha of the plan text, and a create body that is the same on every launch of the same plan text — `title` `task <id>: <title>`, empty `body`, `metadata` `{task, plan}` and no `links` — so two launches of one plan against one hub create each task issue once and both records name the same task uids. M3. After each task's create the launcher reads the issue, patches its metadata with `{run, wave, factsheet}` under that read's revision, and sets the run issue as its parent with `replace: true`; and for every `dag_edges` entry one `blocks` link is created on the blocker naming the blocked task's uid, whatever the entry's `why`. M4. A task no `dag_edges` entry names as `to` has no `blocks` link pointing at it when filing ends. M5. When the first push is refused and the number bumps, no `purgeProject` call is made and `purgeProject` is not defined in `fleet/kata-client.mjs` or `fleet/launch.mjs`; the launcher creates the run issue for N+1, refiles every task (the same keys, the same bodies), patches each task's metadata to the N+1 compile's `{run, wave, factsheet}`, sets each parent to the N+1 run issue, and closes the run-N issue with reason `wontfix` and a message of at least 40 characters naming the number that was taken; the record written is N+1's. M6. `fleet/CONTRACT.md`'s launch paragraph carries, in this order, the words `one project per target`, `Idempotency-Key`, `parent`, `replace` and `wontfix`, and no longer carries the word `purges`. M7. `fleet/tests/test_launch_bump.mjs` and `fleet/tests/test_launch_size.mjs` print `ALL TESTS PASSED` on the patched tree.

**Authorized-by:** #978 (Desired state, Proof shape); #810 re-charter moves 1 and 2 (bind, seed); kata's own model: `kata init` binds a workspace to one project derived from the git remote, and a launcher "use[s] an idempotency key so a retried launch does not create a duplicate issue" (kata `docs/operations/agent-orchestration.md`).

**Interfaces:**
- Consumes: none
- Produces: `kataProjectFor(target: string) -> string` — `<owner>-<repo>`, one argument, in `fleet/lobby.mjs`
- Produces: `createIssue(projectId, { title, body, metadata, links, idempotencyKey })` — the client sends `Idempotency-Key: <idempotencyKey>` when given
- Produces: `link(projectId, fromUid, { type, to_ref, replace })` — the client sends `replace: true` in the body when given

**Context:** At BASE (`c3c8fa9b`) the filing is `fileRunOnHub` in `fleet/launch.mjs` (~1536–1595, exported also as `buildKataRecord`): `createProject(kataProjectFor(target, n))`, one run issue (`run-N: <H1>`, body the Claim line, metadata `{run, target, base, closes}`), one issue per task in wave order with `metadata: {task, wave, factsheet}` and `links: [{type: 'parent', to_ref: runIssue.uid}]`, one `link(project.id, from, {type: 'blocks', to_ref: to})` per `compiled.edges` entry created on the blocker, then `getIssue` per task and for the run to record revisions. `kataStep`/`kataPurge` (~1121–1138) wrap it, and `pushPlan` (~1470–1500) calls `kataPurge(filed.record)` on a refused push before refiling under N+1. `kataProjectFor` is `fleet/lobby.mjs:212`, `(target, run) => …-run-${run}`, with a doc comment above it that says "one run"; Task 3 makes the identical one-line change to it for the janitor, so make exactly this edit: `export const kataProjectFor = (target) => String(target).replace(/\//g, '-')` and rewrite the comment to say the project is the target's. The client is `fleet/kata-client.mjs` (~170–266): `createIssue` (~208) sends `{title, body, actor, metadata, links}`; `link` (~212) sends `{type, to_ref, actor}`; `close` (~247) already sends an `Idempotency-Key` header when given, which is the header shape to copy; `patchMetadata(projectId, uid, patch, revision)` sends `If-Match: "rev-<revision>"`; `getIssue` projects the answer onto `ISSUE_KEYS` (`uid, revision, metadata, status, owner, project_id`) — links are dropped, which is fine here. Delete `purgeProject` from the client (~204) and every carrier of it: `kataPurge` and its `kataStep` comment paragraph in `launch.mjs` (~1116–1138, ~1151), the `pushPlan` comment (~1476–1480) and call (~1500); `grep -n purge fleet/launch.mjs fleet/kata-client.mjs` before editing, since M5's zero count counts comments. The plan blob sha: `crypto.createHash('sha1').update('blob ' + Buffer.byteLength(planText) + '\0').update(planText).digest('hex')` — the same 40 hex `git hash-object` prints, computed in-process so no sim needs a new exec rule. **Hub facts measured on 2026-09-14 against kata v0.17.2 (`kata-hub.exe.xyz`, `localhost:8000/api/v1`), the sandbox cannot repeat them:** `POST /projects` with an existing name answered 200 with the existing project and `"created":false`; `POST /projects/<id>/issues` with `Idempotency-Key` twice and byte-identical fields answered the same issue (same `uid`, no new event), and with the same key but different `metadata` answered 409 `{"error":{"code":"idempotency_mismatch", "data":{"uid":…,"short_id":…}}}` — metadata and initial links are in the fingerprint, which is why the create body carries only `{task, plan}` and no links; the identical replay answered the issue's ORIGINAL revision (1) while the issue was at 2 after a link, so the metadata patch reads the issue first (`getIssue`) and uses that revision, and a stale `If-Match` is 412 `revision_conflict`; the metadata endpoint is a per-key merge (a patch of `{extra}` kept `task`); `POST …/links` with `type: "blocks"` twice answered the same `link.id` (idempotent); a second `type: "parent"` link answered 409 `parent_already_set` with the hint `pass replace=true to swap`, and `{"type":"parent","to_ref":…,"replace":true}` answered 200 with the new parent; `POST …/actions/close` with `reason: "wontfix"`, a ≥40-character `message` and `retry_protocol: "close-v1"` answered 200; the purge the launcher sends today answered 412 `confirm_required` (and needs closed issues and an archive first) — the hub's purge log had no prior entry, so the bump purge has never succeeded live. Kata's look-alike soft-block on repeated titles is bypassed by a matching key, which is why every task create carries one; the run issue is created with key `<target>:<plan sha>:run-<N>` and the body it has today. Sequence per task: `createIssue` (key) → `getIssue` → `patchMetadata({run, wave, factsheet}, revision)` → `link` parent with `replace: true` → later the `blocks` links → the record's `getIssue`. `run-engine.mjs` reads `metadata.factsheet` off the hub at each task's start (~1745), so the patch is what a relaunch's engine sees; a relaunch of a plan whose text changed is a new plan sha and new issues, and closed tasks of a prior run are #383's, not this task's. The sims to keep green: `fleet/tests/test_launch_bump.mjs` pins the per-N project names (`projectName(n)` at ~103, the `createProject` and `purgeProject` legs at ~405–416) and its fake hub (~251–287) — re-aim those legs at M1 and M5 under a comment naming this task, and give both fakes (`test_launch_bump.mjs` ~251, `test_launch_size.mjs` ~188–205) `patchMetadata`, an idempotency-aware `createIssue` and a `close`, and drop their `purgeProject`. `_lobby_helpers.mjs`'s `makeExec` and `makeTargetRepo` are the rig; the hub is always an injected object (`launch({…, kata})`), never a shim. The exam's fake hub must model: a project store keyed by name (`createProject` twice → the same id), an issue store keyed by `Idempotency-Key` (same key + same body → the same issue; same key + different body → throw), links recorded with their `replace` flag, `patchMetadata` merging, `close` recording reason and message, and a `ready(projectId)` computed as open issues with no open `blocks` predecessor — that is how leg (d) reads readiness with no hub.

**Proof:**
- Test: `fleet/tests/test_launch_kata_seed.mjs`
- Guard: `fleet/tests/test_launch_kata_seed.mjs`
- Run: node fleet/tests/test_launch_bump.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_size.mjs | grep -q 'ALL TESTS PASSED'
- Run: test "$(grep -c 'purgeProject' fleet/launch.mjs fleet/kata-client.mjs | awk -F: '{s+=$2} END {print s}')" = 0
- Run: sed -n '/kata: the run filed on the hub/,/ONE verb/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'one project per target.*Idempotency-Key.*parent.*replace.*wontfix'
- Run: test "$(sed -n '/kata: the run filed on the hub/,/ONE verb/p' fleet/CONTRACT.md | grep -c 'purges')" = 0
- Legs: (a) `kataProjectFor('popmechanic/smoke')` is `popmechanic-smoke` and `kataProjectFor.length` is 1; two launches of one plan text against one fake hub call `createProject` with `popmechanic-smoke` both times, the second answers the first's id, and every issue is filed under that id [M1]; (b) across the two launches every task's `createIssue` carries the same `Idempotency-Key` `popmechanic/smoke:<sha>:task-<id>` where `<sha>` equals `git hash-object` of the plan file, the same body — `title` exactly `task <id>: <title>`, `body` `''`, `metadata` exactly `{task, plan}` with `plan` the same sha — and no `links` key, the fake's issue store holds one issue per task after both, and the two `.ultrapowers/kata.json` records name identical task uids [M2]; (c) for a prepared payload with `dag_edges` `[{from: "1", to: "2", why: "proof-run"}, {from: "1", to: "3", why: "interface"}]`, each task's calls after its create are `getIssue`, then `patchMetadata` with `{run, wave, factsheet}` under that read's revision, then a `parent` link with `replace: true` to the run issue; and exactly two `blocks` links are created, both on task 1's uid, naming task 2's and task 3's uids [M3]; (d) in the same launch task 1 has no `blocks` link pointing at it and the fake's ready set for the project contains task 1 and neither of 2 nor 3 [M4]; (e) with the first push refused (the rig's race: the ref appears on the origin) and the bump to N+1: no `purgeProject` call; the run-N issue is closed with reason `wontfix` and a message of ≥40 characters containing `run-N`; a run-(N+1) issue is created; each task's `createIssue` was called twice with the same key and body and the store holds one issue per task; each task's last `patchMetadata` carries the N+1 payload's factsheet and `run: N+1`, and its last parent link names the run-(N+1) issue; the record on the pushed plan commit names the N+1 run issue; and the two greps for `purgeProject` sum to zero by the third `Run:` [M5]; (f) the contract paragraph by the fourth and fifth `Run:` lines [M6]; (g) both survivor sims print their sentinel, by the first two `Run:` lines [M7].

**Stale-if:**
- path-absent: `fleet/tests/_lobby_helpers.mjs`
- path-absent: `fleet/kata-client.mjs`

### Task 3: The janitor finds a run inside the target's one project

**Type:** implementation

**Files:**
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/lobby.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_janitor.mjs`

**Claim:** After this run, the janitor still reads a run's state off the hub when every run of a target shares one project. (derived)
Machine: M1. The janitor's hub reader looks the project up by `kataProjectFor(target)` — the name `<owner>-<repo>` — and, among that project's issues, takes the one whose `metadata.run` is the run number; with issues for runs 3 and 4 in one project, the reading for run 4 is run 4's issue and the reading for run 3 is run 3's. M2. When no project of that name is listed, the reading is `null` and the reader does not ask for any project's issues. M3. `fleet/CONTRACT.md`'s janitor row carries, in this order, the words `matched on`, `name`, `against the target's one project` and `<owner>-<repo>`, and no longer carries `<owner>-<repo>-run-<N>`.

**Authorized-by:** #978; #938 (the janitor asks the hub for the run's state); #810 re-charter move 1.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE (`c3c8fa9b`) the hub reader in `fleet/janitor.mjs` (~318–345) lists projects once, matches `byName.get(kataProjectFor(target, run))`, lists that project's issues and already picks `issues.find((i) => Number(i.metadata?.run) === run)` — so the change is the lookup name and the doc comment at ~20 that says `<owner>-<repo>-run-<N>`. `kataProjectFor` is `fleet/lobby.mjs:212`; Task 2 makes the identical one-line change for the launcher, so make exactly this edit and no other in that file: `export const kataProjectFor = (target) => String(target).replace(/\//g, '-')`, and rewrite the comment above it to say the project is the target's, spelled `<owner>-<repo>`. The contract's janitor row is `fleet/CONTRACT.md` ~642–648 ("matched on `name` against the run's project `<owner>-<repo>-run-<N>`"). The sim `fleet/tests/test_janitor.mjs` drives `janitor({kata, argv, exec, now})` with `kata: null` everywhere at BASE and pins that no ssh reaches the hub host under `kata: null` (~655–692); the exam adds legs with an injected `kata` object shaped like `fleet/kata-client.mjs` (`listProjects()` → `{projects: [{id, uid, name}]}`, `listIssues(id)` → `{issues: [{uid, status, metadata: {run}, closed_reason, closed_at}]}`), recording its calls, under a comment naming this task. `listIssues` is `?limit=1000`, so a project holding many runs is read in one page; that ceiling is the record's, not this task's.

**Proof:**
- Test: `fleet/tests/test_janitor.mjs`
- Guard: `fleet/tests/test_janitor.mjs`
- Run: sed -n '/ask the hub for the run.s state/,/is a finished run/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'matched on .name. against the target.s one project.*<owner>-<repo>'
- Run: test "$(sed -n '/ask the hub for the run.s state/,/is a finished run/p' fleet/CONTRACT.md | grep -c '<owner>-<repo>-run-<N>')" = 0
- Legs: (a) with a fake hub listing one project `acme-widgets` whose issues carry `metadata.run` 3 (closed `done`) and 4 (open), the reader called for `acme/widgets` run 4 answers run 4's issue and for run 3 answers run 3's, and every `listIssues` call names that project's id [M1]; (b) with the fake listing only `acme-widgets-run-4` and no `acme-widgets`, the reading is `null` and `listIssues` is never called [M2]; (c) the contract row by the two `Run:` lines [M3].

**Stale-if:**
- path-absent: `fleet/janitor.mjs`
- path-absent: `fleet/tests/_lobby_helpers.mjs`

### Task 4: The boot exports the run's own slice of a shared project

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_sandbox_boot_kata_export.mjs`

**Claim:** After this run, the `kata.jsonl` a run leaves on its evidence tag holds only that run's issues and events, even though the project on the hub holds every run of the repository. (derived)
Machine: M1. `kata_export` writes one `{"kind":"issue", …}` line per issue whose `uid` is the run issue's uid or one of the task uids named by the plan commit's `.ultrapowers/kata.json`, and no line for any other issue the project answers. M2. It writes one `{"kind":"event", …}` line per event whose `issue_uid` is one of those uids, in the log's order, and no line for an event on another issue or for an event that names no issue. M3. The export still pages the events endpoint from `after_id=0` following `next_after_id` until an empty page, and an export whose issues fetch fails keeps the previously written `kata.jsonl` byte-identical. M4. `fleet/CONTRACT.md`'s `kata.jsonl` bullet carries, in this order, the words `the run's issues`, `named by` and `events on them`.

**Authorized-by:** #978; #810 rule 9 ("Own — the tag's `kata.jsonl` stays the export") and move 1.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE (`c3c8fa9b`) `kata_export` (`fleet/sandbox-boot.sh` ~1276–1330) reads `project.id` out of `$KATA_FILE` with an inline `python3`, fetches `projects/<id>/issues?limit=1000` into `<tmp>/issues.json`, pages `projects/<id>/events?after_id=<n>&limit=1000` through `kata_page_head` until an empty page, and `kata_assemble` (~1355) writes every issue then every event as compact JSON lines, `kind` first. Extend `kata_assemble` to take the run's uid set — read from the same `$KATA_FILE`: `run.uid` plus every `tasks.<id>.uid` — and keep an issue only when its `uid` is in the set, an event only when its `issue_uid` is in the set (the hub's event envelope carries `issue_uid` beside `issue_id` and `project_id`, measured 2026-09-14 on kata v0.17.2: `{"event_id", "event_uid", "type": "issue.created", "project_id", "issue_id", "issue_uid", "issue_short_id", "actor", "payload", …}`; a `project.created` event carries no `issue_uid`). The paging loop, the `mv` on one filesystem and the "previous kept" failure branches stay as they are. The boot rig is `fleet/tests/_sandbox_boot_helpers.mjs`: its stub `curl` answers `…/projects/*/issues*` with `$STUB_KATA_ISSUES` and `…/projects/*/events*` at `after_id=0` with `$STUB_KATA_EVENTS` and every other cursor with an empty page (~372–400), the plan commit's record is `$STUB_KATA_JSON` (~511–523), and `kataJsonl(ctx)` reads the export's lines off the evidence tree (~1178–1200); `fleet/tests/test_sandbox_boot_viz.mjs` is the sim to copy for how a boot is driven to one export. The record's shape is the Global Constraints' `.ultrapowers/kata.json` literal. A boot sim costs minutes: one exam, one boot per case at most, three cases.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_kata_export.mjs`
- Guard: `fleet/tests/test_sandbox_boot_kata_export.mjs`
- Run: sed -n '/THE HUB.S OWN RECORD/,/Exported at every/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'the run.s issues.*named by.*events on them'
- Legs: (a) with `STUB_KATA_JSON` naming run uid `R7` and task uids `T1`, `T2`, and `STUB_KATA_ISSUES` answering issues `R7`, `T1`, `T2`, `X9` (a sibling run's task) — the export's `kind: issue` lines are exactly `R7`, `T1`, `T2` in the hub's order and no line has uid `X9` [M1]; (b) with `STUB_KATA_EVENTS` answering, in order, a `project.created` event with no `issue_uid`, events on `T1`, `X9`, `R7`, `T2` — the `kind: event` lines are exactly the `T1`, `R7`, `T2` events in that order, none names `X9`, and none is the project event [M2]; (c) the stub's recorded curl argv shows the events endpoint asked at `after_id=0` and then at the stub's `next_after_id` and no further, and with `STUB_KATA_ISSUES_EXIT_FROM=2` (the issues fetch fails from the second export on) the second export leaves the first export's `kata.jsonl` byte-identical [M3]; (d) the contract bullet by the `Run:` line [M4].

**Stale-if:**
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- path-absent: `fleet/sandbox-boot.sh`
