# A plan anywhere on disk checks against its target, and the janitor says when a run is reapable

**Grammar:** claims-v1
**Claim:** do: launch this plan; see: a plan for another repository launches from wherever it sits on disk, with the laptop's check reading the target's tree and never the plan's own folder's; and a janitor pass names, for every finished run it is still holding, the time it will reap it, so nobody has to know the rule. (elicited)
**Summary:** Today a plan written here for the fixture repository would not check against the fixture until it was copied into the fixture's own checkout, because the laptop's check looked for the base commit in whichever repository the plan file happened to sit in. And the janitor kept three finished machines up for an hour without saying so, because its hour runs from when a run closed its issue, a rule nobody remembers. This gives the check a switch that names the repository to read, which the launcher sets from the target checkout it already knows, and gives the janitor a line per held run saying the exact time it becomes reapable.
**Goal:** `skills/ultrapowers/scripts/plan_check.py` takes `--repo <dir>`, the repository a 40-hex `--base` is resolved in (default unchanged: the plan's own git toplevel), and `fleet/launch.mjs` passes the target checkout there; `fleet/janitor.mjs` gains a pure `reapPlan` that turns a finished run's age into `rm`, `pending` (with its `reapableAt`) or `none`, a `pending` list on the result, and one `pending … reapable at <time>` line per held run in the report.
**Tech Stack:** Python 3.9 (`plan_check.py`), Node 22 ESM (`launch.mjs`, `janitor.mjs`), the launcher sims under `fleet/tests/`.
**Bootstrap:** true
**Spec:** the traps paid on 2026-09-24 — `launch.mjs` refused `plan_check.py --base <fixture sha>` on a plan under this repository (`error: --base … names no commit of /Users/…/ultrapowers`), fixed by hand by copying the plan into the fixture checkout for runs 44 and 45; and the janitor held `fleet-r44`, `-r45`, `-r232` past their runs with no line saying until when.
**Target:** popmechanic/ultrapowers at `a0cfa6d7049859db0cb99feebb48f6d09acbfc79` (main, 2026-09-24).

## Global Constraints

- Check: python3 -m pytest -q tests/test_plan_check_freeze.py tests/test_plan_check_rehearsal.py
- Check: git diff --quiet $ULTRA_BASE -- factory skills/ultrawrite skills/ultrapowers/kernel skills/ultrapowers/SKILL.md hooks fleet/tests fleet/CONTRACT.md fleet/RUNBOOK.md fleet/fleet-bootstrap.sh fleet/doctor.mjs fleet/target.mjs fleet/claude-token.mjs tests
- Defaults are unchanged: `plan_check.py` without `--repo` resolves a sha in the plan's own repository exactly as before, and the janitor's `--age`, its `rm` decision and its `stale` rule keep their values and order.
- A judgment is a question, never a sentence or a regex; nothing here asks one.

### Task 1: The check reads the repository it is told, and the launcher tells it

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_check.py`
- Modify: `fleet/launch.mjs`

**Claim:** do: point the check at a plan sitting outside any checkout and name the target repository with `--repo`; see: it resolves the base commit there and reaches its verdict, where without the switch it stops on "no git checkout found"; a sha the named repository does not have is refused naming that repository; and the launcher always names the target checkout. (derived)
Machine: M1. With a copy of `evals/fixtures/claims/plan.md` placed in a fresh directory under `/tmp` (no git checkout), `python3 skills/ultrapowers/scripts/plan_check.py --base "$ULTRA_BASE" --repo . <that plan>` exits 2, its combined output contains `violation(s)` and does not contain `no git checkout found`.
M2. `python3 skills/ultrapowers/scripts/plan_check.py --base 0000000000000000000000000000000000000000 --repo . <that plan>` exits 1 and its combined output contains `names no commit of`.
M3. `fleet/launch.mjs` passes `'--repo', repoDir` on the `plan_check.py` argv in `verifyPlanCompiles`, and `fleet/tests/test_launch_plan_path.mjs` still prints `ALL TESTS PASSED`.
M4. `python3 skills/ultrapowers/scripts/plan_check.py --help` exits 0 and mentions `--repo`.

**Authorized-by:** the plan-level Claim above; `fleet/tests/test_launch_plan_path.mjs` leg (c) at BASE (a plan outside the target checkout launches with `--repo`), which this task extends to the check.

**Interfaces:**
- Consumes: nothing
- Produces: `plan_check.py --repo <dir>`

**Context:** `skills/ultrapowers/scripts/plan_check.py` at BASE is 982 lines. `default_base(plan_path)` (line ~500) answers the git toplevel of the plan's directory; `BaseTree.from_flag(cls, value, plan_path)` (line ~533) reads a directory value as a worktree and a 40-hex value as a sha of `default_base(plan_path)`, exiting with `error: --base <sha>: no git checkout found for <dir> to resolve the sha in` when the plan sits outside a checkout, and `error: --base <sha> names no commit of <repo>` when the sha is not there; `main` (line ~922) declares `plan` and `--base` with argparse and calls `BaseTree.from_flag(args.base, args.plan)`. This task adds `ap.add_argument("--repo", default=None, metavar="DIR", help=…)`, gives `from_flag` a keyword `repo=None`, and when `repo` is given resolves a 40-hex `--base` in `Path(repo)` instead of `default_base(plan_path)` — the `names no commit of <repo>` refusal then names that directory; a directory `--base` is unaffected by `--repo`. Nothing else in the file changes, and every read of the tree still goes through `BaseTree`. Measured at BASE, 2026-09-24: with the fixture plan copied to `/tmp/pc-probe/plan.md`, `--base a0cfa6d7…` exits 1 with the `no git checkout found` line; the same plan copied inside this repository reaches the verdict and exits 2 with `grammar: gate verdicts missing …` and `2 violation(s)` (the fixture carries no gate record and a retired `Test:` bullet — that verdict is the probe's expected text, not something to fix). `fleet/launch.mjs` at BASE is 2,100 lines; `verifyPlanCompiles({exec, repoDir, base, planPath, planText, compilerPath})` (line ~932) runs `exec('python3', [compilerPath, '--base', base, planPath], { cwd: repoDir })` — this task makes the argv `[compilerPath, '--base', base, '--repo', repoDir, planPath]`, nothing else; `repoDir` is the target checkout the launcher already resolved (`--repo` on its own line, or the cwd). The launcher sims answer `python3` through the exec seam by `argv.some((a) => String(a).endsWith('plan_check.py'))` and never pin the argv's shape, so `test_launch_plan_path.mjs` (which at BASE already launches a plan outside the checkout, leg (c)) stays green. `$ULTRA_BASE` is set by the driver on every `Run:` to the run's base sha, a commit of this repository, which is why M1's probe reads it rather than freezing a sha.

**Proof:**
- Run: bash -c 'd=$(mktemp -d /tmp/pc-probe.XXXXXX) && cp evals/fixtures/claims/plan.md "$d/plan.md" && out=$(python3 skills/ultrapowers/scripts/plan_check.py --base "$ULTRA_BASE" --repo . "$d/plan.md" 2>&1); rc=$?; rm -rf "$d"; [ "$rc" = 2 ] || { echo "rc=$rc"; echo "$out" | tail -3; exit 1; }; echo "$out" | grep -q "violation(s)" || { echo "$out" | tail -3; exit 1; }; echo "$out" | grep -q "no git checkout found" && { echo "$out" | tail -3; exit 1; }; exit 0' [M1]
- Run: bash -c 'd=$(mktemp -d /tmp/pc-probe.XXXXXX) && cp evals/fixtures/claims/plan.md "$d/plan.md" && out=$(python3 skills/ultrapowers/scripts/plan_check.py --base 0000000000000000000000000000000000000000 --repo . "$d/plan.md" 2>&1); rc=$?; rm -rf "$d"; [ "$rc" = 1 ] && echo "$out" | grep -q "names no commit of" || { echo "rc=$rc"; echo "$out" | tail -3; exit 1; }' [M2]
- Run: grep -q "'--repo', repoDir" fleet/launch.mjs && node fleet/tests/test_launch_plan_path.mjs | grep -q 'ALL TESTS PASSED' [M3]
- Run: python3 skills/ultrapowers/scripts/plan_check.py --help | grep -q -- '--repo' [M4]
- Legs: (a) an out-of-checkout plan checked with `--repo .` and the run's base reaches a verdict, exit 2 with `violation(s)`, and never the no-checkout line [M1]; (b) a sha the named repository lacks is refused, exit 1, naming `names no commit of` [M2]; (c) the launcher's argv carries `--repo` with the target checkout and the plan-path sim stays green [M3]; (d) the help text names the switch [M4].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/plan_check.py`

### Task 2: The janitor names the time it will reap each run it is holding

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `fleet/janitor.mjs`

**Claim:** do: run the janitor while a finished run is still inside its hour; see: the report carries one line for that run saying it is pending and the exact time it becomes reapable, the JSON result carries the same under `pending`, and a run past its hour is reaped exactly as before. (derived)
Machine: M1. `reapPlan({finished: true, updatedAt: '2026-09-24T18:53:00.000Z', nowMs: Date.parse('2026-09-24T19:00:00.000Z'), ageMs: 3600000})` answers `{action: 'pending', reapableAt: '2026-09-24T19:53:00.000Z'}`; the same with `nowMs` at `2026-09-24T20:00:00.000Z` answers `action` `rm`; `finished: false` answers `action` `none`; `updatedAt: 'never'` answers `action` `none`; every answer has exactly the keys `action` and `reapableAt`, and `reapableAt` is `null` when `action` is `none`.
M2. `renderJanitor({dryRun: true, actions: [], stale: [], unknown: [], deaths: [], branches: [], kept: [], pending: [{vm: 'fleet-r44-x', run: 44, state: 'done', reapableAt: '2026-09-24T19:53:00.000Z'}]})` is one line that starts with `pending fleet-r44-x` and contains `run=44`, `state=done` and `reapable at 2026-09-24T19:53:00.000Z`; the same call with `pending: []` renders `nothing to do`.
M3. `fleet/janitor.mjs` exports `reapPlan`, calls it inside `janitor()`'s row loop, and `janitor()`'s returned object carries `pending`.
M4. `node --check fleet/janitor.mjs` exits 0 and `node fleet/janitor.mjs --help` prints a line containing `--age`.

**Authorized-by:** the plan-level Claim above; `fleet/janitor.mjs`'s own header ("The hour is for the operator to read a status page before … the run is reaped").

**Interfaces:**
- Consumes: nothing
- Produces: `reapPlan({finished, updatedAt, nowMs, ageMs}) -> {action, reapableAt}`

**Context:** `fleet/janitor.mjs` at BASE is 863 lines and has no sim of its own. Its row loop inside `export async function janitor({…})` (line ~677) ends, per row, with `const updated = Date.parse(String(reading.updatedAt)); if (!Number.isFinite(updated)) continue; if (reading.finished && nowMs - updated >= ageMs) { actions.push({kind: 'rm', …}); continue }; if (nowMs - updated >= STALE_MS) { stale.push({…}) }` and the function returns `{ dryRun, age, actions, stale, unknown, deaths, branches, kept, hub: hubReport, runs }`. `renderJanitor(result)` (line ~831) builds `lines` from `hub`, `deaths`, `actions`, `kept`, `stale`, `unknown`, `branches` in that order and answers `'nothing to do'` when there are none. This task adds one pure export beside `STALE_MS`: `reapPlan({finished, updatedAt, nowMs, ageMs})` — `const updated = Date.parse(String(updatedAt)); if (!Number.isFinite(updated) || finished !== true) return {action: 'none', reapableAt: null}; const at = updated + ageMs; return nowMs >= at ? {action: 'rm', reapableAt: new Date(at).toISOString()} : {action: 'pending', reapableAt: new Date(at).toISOString()}` — and rewrites the loop's tail to `const plan = reapPlan({finished: reading.finished, updatedAt: reading.updatedAt, nowMs, ageMs})`, keeping the existing `if (!Number.isFinite(updated)) continue` and the existing `actions.push({kind: 'rm', …})` block under `plan.action === 'rm'`, adding `pending.push({vm: row.name, run, state: reading.state, reapableAt: plan.reapableAt})` under `plan.action === 'pending'` before the unchanged `stale` check (a pending run is by construction younger than an hour, so it never also reads stale), declaring `const pending = []` beside `const stale = []` and returning `pending` in the result object after `kept`. `renderJanitor` gains, between the `stale` lines and the `unknown` lines, `...(result.pending ?? []).map((p) => \`pending ${p.vm}  run=${p.run} state=${p.state ?? 'none'} reapable at ${p.reapableAt}\`)` — two spaces after the vm, the shape the `stale` line uses. The `rm` decision is unchanged in value (`nowMs - updated >= ageMs` is `nowMs >= updated + ageMs`), and `--dry-run`, `--json` and `--help` keep their meaning. Measured at BASE, 2026-09-24 19:48Z: three `done` runs (44 closed 18:53Z, 45 at 19:26Z, 232 at 19:41Z) produced no line at all under the hour; with this task the same pass prints three `pending` lines ending `reapable at 2026-09-24T19:53:…Z`, `…20:26:…Z`, `…20:41:…Z`.

**Proof:**
- Run: node -e "import('./fleet/janitor.mjs').then((m) => { const ok = (c, l) => { if (!c) { console.log('red', l); process.exit(1); } }; const t = (s) => Date.parse(s); const a = m.reapPlan({finished: true, updatedAt: '2026-09-24T18:53:00.000Z', nowMs: t('2026-09-24T19:00:00.000Z'), ageMs: 3600000}); ok(a.action === 'pending' && a.reapableAt === '2026-09-24T19:53:00.000Z', 'a'); const b = m.reapPlan({finished: true, updatedAt: '2026-09-24T18:53:00.000Z', nowMs: t('2026-09-24T20:00:00.000Z'), ageMs: 3600000}); ok(b.action === 'rm', 'b'); const c = m.reapPlan({finished: false, updatedAt: '2026-09-24T18:53:00.000Z', nowMs: t('2026-09-24T20:00:00.000Z'), ageMs: 3600000}); ok(c.action === 'none' && c.reapableAt === null, 'c'); const d = m.reapPlan({finished: true, updatedAt: 'never', nowMs: t('2026-09-24T20:00:00.000Z'), ageMs: 3600000}); ok(d.action === 'none' && d.reapableAt === null, 'd'); for (const r of [a, b, c, d]) ok(JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['action', 'reapableAt']), 'e'); })" [M1]
- Run: node -e "import('./fleet/janitor.mjs').then((m) => { const ok = (c, l) => { if (!c) { console.log('red', l); process.exit(1); } }; const base = {dryRun: true, actions: [], stale: [], unknown: [], deaths: [], branches: [], kept: []}; const one = m.renderJanitor({...base, pending: [{vm: 'fleet-r44-x', run: 44, state: 'done', reapableAt: '2026-09-24T19:53:00.000Z'}]}); ok(one.split('\n').length === 1 && one.startsWith('pending fleet-r44-x') && one.includes('run=44') && one.includes('state=done') && one.includes('reapable at 2026-09-24T19:53:00.000Z'), 'a ' + one); ok(m.renderJanitor({...base, pending: []}) === 'nothing to do', 'b'); })" [M2]
- Run: grep -q "^export const reapPlan\|^export function reapPlan" fleet/janitor.mjs && test "$(grep -c 'reapPlan(' fleet/janitor.mjs)" -ge 2 && grep -q "pending" fleet/janitor.mjs [M3]
- Run: node --check fleet/janitor.mjs && node fleet/janitor.mjs --help | grep -q -- '--age' [M4]
- Legs: (a) the rule answers pending with the exact reap time inside the hour, rm past it, none for an unfinished run and none for an unparseable time, always as `{action, reapableAt}` [M1]; (b) the report renders one pending line with vm, run, state and the time, and an empty pending list renders nothing [M2]; (c) the rule is exported, called in the loop, and the result carries pending [M3]; (d) the file parses and `--help` still answers [M4].

**Stale-if:**
- path-absent: `fleet/janitor.mjs`
