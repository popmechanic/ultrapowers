// fleet/tests/test_run_engine_declared_dependencies.mjs — the declared packages
// are installed ONCE, at Setup, as the commit every clone is cut at, and a task
// that edits a manifest its own `Files` do not list is told so on the driver's
// pre-review pass.
//
// This file is the Proof's `Test:`, written whole at the path it names. Every
// relative import is written for THIS directory: `../` is the repository's
// `fleet/`, `./` is `fleet/tests/`. Nothing under `fleet/tests/exams/` is
// imported (#1053), and no sibling `test_*.mjs` is spawned from here — the
// hermetic sims' rule — so what stands for the Proof's seventh `Run:` is stated
// below in leg (l).
//
// Everything below the agent seam is the real thing: real git repos, real
// clones at BASE, the real `withPatchCapture` capture, the real fold kernel and
// the real `bash -lc` for the add command, the bootstrap and the suite. Only
// the judgments are canned, so every sha, every event and every ordering these
// assertions read is the driver's own.
//
// The Machine clauses under test, restated so a reader can map each assertion
// back to the contract:
//
//   M1 — the driver reads `args.dependencies`, `args.addCmd` and
//        `args.addDevCmd` beside `bootstrapCmd`. At Setup, after the re-drive
//        reuse block and before the baseline clone is cut, when
//        `args.dependencies` is an object with at least one spec in `runtime`
//        or `dev` and both add commands are non-empty strings, the driver runs
//        ONE shell line in the integration clone: `<addCmd> '<spec>' …` over
//        the runtime specs, joined by ` && ` to `<addDevCmd> '<spec>' …` over
//        the dev specs when both groups are non-empty, the runtime half alone
//        when `dev` is empty and the dev half alone when `runtime` is empty;
//        each spec is one single-quoted shell word.
//   M2 — on exit 0 the driver stages every path `git status --porcelain`
//        reports whose basename `bootstrapManifestChanged([path])` accepts —
//        and no other path — and, when at least one such path was staged,
//        commits them with subject the plan's H1 (`setup: dependencies` when
//        the plan has none) and body `setup: dependencies <runtime specs>`
//        followed by ` dev: <dev specs>` when the dev group is non-empty; that
//        commit's sha is the setup head. A line that exits 0 and changed no
//        such path makes no commit and no setup head, and the run continues
//        from `reuseHead || baseSha`.
//   M3 — the setup head is the head every dispatch anchors at and every fold
//        builds on: `adoptedHead`, `patchBase.current`, every task clone before
//        its first dispatch, the baseline clone, and the run's `$ULTRA_BASE` —
//        the per-task pass's because the dispatch head is, and the integrated
//        pass's because the driver hands `baseEnv(setupHead)` there. The
//        report's `baseSha` stays the launch BASE and the report carries one
//        new key `setupSha`: the setup head, or `null` on a run that made no
//        setup commit.
//   M4 — one `driver:dependencies` event `{ specs, dev, cmd, exit, headSha }`
//        per run that ran the line: the runtime list, the dev list, the M1 line
//        verbatim, its exit code, and the head the run continues from — the
//        setup head when a commit was made, `reuseHead || baseSha` when the
//        line changed no manifest path, `null` on a non-zero exit. A run whose
//        args carry no `dependencies` appends none and runs byte-for-byte as at
//        BASE; a run that names a spec but not BOTH add commands runs no line,
//        commits nothing, appends no event, and pushes one judgment call
//        beginning `setup: dependencies declared but no add command`.
//   M5 — on a non-zero exit the run parks before any worker: the integration
//        clone is restored (`git checkout -- .`, `git clean -fd`, porcelain
//        empty), one `waveMerges` row `{ wave: 1, status: 'TEST_FAILED',
//        detail }` and one `driver:wave-blocked { wave: 1, tasks, detail, why:
//        'setup' }` carry a `detail` beginning `setup: the dependency install
//        failed (exit <code>)` and quoting the tail of the installer's output,
//        `blockedWaves` carries that one row, every task is named in
//        `unfinished` as `<id>: never dispatched — the dependency install
//        failed at setup`, `report.tasks` is `[]`, and no agent of any label is
//        dispatched.
//   M6 — on the pre-review pass, after the NUL scan and before the pass
//        returns, for every path of `patchPaths(impl.patch)` whose basename
//        `bootstrapManifestChanged([path])` accepts and that is NOT in the
//        task's `files`, the driver pushes one red whose line is exactly the
//        sentence `MANIFEST_RED` spells below and appends one `driver:finding`
//        `{task, round: 0, severity: 'blocking', actor: 'implementer', detail,
//        paths: [<path>], evidence: { read: <that line>, against: 'the captured
//        patch at <impl.headSha>' }}`; the red buys the `fix:<id>:0` round, a
//        fix that leaves the edit ends the task `failed` with `reviewVerdict`
//        `proof-red`, and a fix that drops it leaves the pass green.
//   M7 — a patch that edits a manifest the task's `files` DO list, and a patch
//        that edits no manifest, each add no red and no `driver:finding` at
//        `round` `0` whose `detail` begins `the patch edits`, on a run with and
//        without `dependencies`.
//   M8 — `fleet/CONTRACT.md` names `driver:dependencies` with its five keys and
//        the setup commit beside the re-drive reuse paragraph, and names the
//        manifest red beside the export-collision and NUL reds;
//        `skills/ultrapowers/references/report-format.md` names the fourth
//        `unfinished` shape, carries a `setupSha` row in its field table, and
//        its `baseSha` row says the field is the launch BASE the run was cut
//        at.
//
// Legs: (a) M1+M4, (b) M1, (c) M2+M4, (c2) M2, (d) M3, (e) M3, (f) M4,
//       (g) M5, (h) M6, (i) M6, (j) M7, (k) M6+M7, (l) M8.
//
// ── three readings this file settles, because the Proof and the Context can be
//    read two ways and a later session would otherwise have to reconstruct them
//
// 1. LEG (e)'s `ultra-base.txt` NEEDS A SECOND CAPTURE. The leg's instrument is
//    a proof `Run:` of `echo $ULTRA_BASE > ultra-base.txt` whose output reaches
//    the FOLDED TREE — but at BASE the capture of an `impl:` reply is taken
//    before the pre-review pass runs that command, so a task that goes green on
//    its first pass folds without the file (verified against this tree at BASE).
//    The action the leg names is kept exactly — the same `Run:`, the same
//    variable, the same file, read off the folded tree — and the fixture around
//    it is what makes the file reach the fold: task A carries a SECOND `Run:`,
//    `test -f fix-ran.txt`, red on the first pass, so the `fix:A:0` round the
//    red buys re-captures the clone and the first pass's `ultra-base.txt` rides
//    into the patch with it. Nothing about the leg's claim moves: the bytes
//    compared are still what the driver's own `$ULTRA_BASE` put in that file on
//    the per-task pass.
//
// 2. `bun.lock` IS UNTRACKED AT BASE. The canned `add.sh` WRITES it (the
//    Context's own word), so at the setup commit it is a path `git status
//    --porcelain` reports as `?? bun.lock` while `package.json` is ` M`. Leg
//    (c2) asks for both in the commit, so M2's "every path `git status
//    --porcelain` reports" is read here as including the untracked ones — which
//    is the only reading under which a freshly-written lockfile is ever
//    committed at all.
//
// 3. THE SEVENTH `Run:` IS NOT SPAWNED HERE. `node fleet/tests/
//    test_run_engine_lockfile_regen.mjs` is the driver's to run; a sim may not
//    spawn a sibling sim. What stands for it in this file is leg (j) — a task
//    whose `files` LIST `package.json` and that edits it draws no red — which
//    is the exemption that sim's tasks rely on, stated directly, plus the
//    direct read of `bootstrapManifestChanged` below.
//
// WHY THIS IS RED AT BASE. `args.dependencies` is read by nothing, no add line
// is ever run, no setup commit exists, `driver:dependencies` is appended by no
// run, `report.setupSha` is not a key of any report, no install failure can
// park a run, and the pre-review pass has no manifest scan. The first
// assertion below says so by name.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as engine from '../run-engine.mjs'
import { rig, makeRepo, gitSync, passReview, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-declared-deps-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the one basename rule, by namespace ─────────────────────────────────────
// `bootstrapManifestChanged` exists at BASE (#825) and this task REUSES it
// rather than writing a second set of names. Read by namespace so a rename
// reports as this assertion rather than as a link-time error that takes every
// other leg down with it.
const bootstrapManifestChanged = engine.bootstrapManifestChanged
assert.equal(typeof bootstrapManifestChanged, 'function',
  '[M6] `fleet/run-engine.mjs` exports `bootstrapManifestChanged(paths)` — the one basename rule ' +
  'the manifest red reads. Got: ' + typeof bootstrapManifestChanged)

// The sentence M6 spells, exactly — the sixth red line shape of the pre-review
// pass, beside `RUN_FAIL`, `EXAM_FAIL`, `CHECK_FAIL`, the export collision and
// the NUL byte, and the one that begins `the patch edits` so a reader can grep
// it apart from the others.
const MANIFEST_RED = (p) => 'the patch edits ' + p +
  ' — dependencies are declared on the plan\'s Dependencies: line and installed at setup, ' +
  'never by a task'

// The declared packages of every scenario that carries a line, and the three
// shell lines M1 spells over them.
const RUNTIME = ['left-pad@^1', 'right-pad']
const DEV = ['eslint']
const ADD_CMD = 'bash add.sh'
const ADD_DEV_CMD = 'bash add.sh -d'
const CMD_BOTH = "bash add.sh 'left-pad@^1' 'right-pad' && bash add.sh -d 'eslint'"
const CMD_RUNTIME_ONLY = "bash add.sh 'left-pad@^1' 'right-pad'"
const CMD_DEV_ONLY = "bash add.sh -d 'eslint'"
const COMMIT_BODY = 'setup: dependencies left-pad@^1 right-pad dev: eslint'
const PLAN_H1 = 'The sim plan'

// ══════════════════════════════════════════════════════════════════════════
// fixtures — the canned add commands, the bootstrap, the manifests
// ══════════════════════════════════════════════════════════════════════════
//
// `add.sh` is a TRACKED file of the sim's repository, so the integration clone
// carries it and `bash add.sh …` is runnable there. It appends each spec it was
// handed to `package.json`, rewrites `bun.lock` as the sha256 prefix of that
// manifest, and drops a marker under `node_modules/` — the untracked path the
// setup commit must NOT carry, ignored or not.
const ADD_SH = [
  '#!/bin/bash',
  'for a in "$@"; do printf "spec %s\\n" "$a" >> package.json; done',
  'h=$(sha256sum package.json | cut -c1-16)',
  'printf "%s\\n" "$h" > bun.lock',
  'mkdir -p node_modules',
  'printf "marker\\n" > node_modules/marker',
  '',
].join('\n')
// The add command that exits 0 and writes nothing at all — M2's "the packages
// were already in the manifest" arm.
const ADD_NOOP_SH = '#!/bin/bash\nexit 0\n'
// The failing variant: it dirties the tree FIRST (so M5's restoration has
// something to undo and the porcelain read is not vacuous), prints the
// installer's own words on BOTH streams — which stream the driver quotes is
// not a Machine clause, and this exam does not grade it — and exits 7.
const ADD_FAIL_SH = [
  '#!/bin/bash',
  'for a in "$@"; do printf "spec %s\\n" "$a" >> package.json; done',
  'mkdir -p node_modules',
  'printf "marker\\n" > node_modules/marker',
  'echo "no such package left-pad"',
  'echo "no such package left-pad" >&2',
  'exit 7',
  '',
].join('\n')
const BOOT_SH = '#!/bin/bash\nexit 0\n'
const PKG_BASE = '{\n  "name": "sim-target",\n  "private": true\n}\n'
const SRC_BASE = 'export const a = 1\n'

const SIM_FILES = {
  'add.sh': ADD_SH,
  'add-noop.sh': ADD_NOOP_SH,
  'add-fail.sh': ADD_FAIL_SH,
  'boot.sh': BOOT_SH,
  'package.json': PKG_BASE,
  'package.json.bak': PKG_BASE,
  'src.mjs': SRC_BASE,
  'src-b.mjs': SRC_BASE,
}

/**
 * The sim's target repository: `makeRepo`'s own tree plus the fixtures above,
 * and any NESTED path a scenario asks for (`makeRepo` writes flat names only,
 * so `client/package.json` is written and committed here).
 */
const makeSimRepo = (dir, nested = {}) => {
  const repo = makeRepo(dir, SIM_FILES)
  const names = Object.keys(nested)
  if (names.length) {
    for (const name of names) {
      const dest = path.join(repo, name)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, nested[name])
    }
    gitSync(['add', '-A'], repo)
    gitSync(['commit', '-q', '-m', 'sim fixtures'], repo)
  }
  return repo
}

// ══════════════════════════════════════════════════════════════════════════
// the rig every engine leg shares
// ══════════════════════════════════════════════════════════════════════════
const BODY = '**Claim:** the task writes its own file\n' +
  'Machine: M1. The tree holds the task\'s file.\n\n' +
  '**Proof:**\n- Legs: (a) the file is there [M1]'
const taskOf = (id, over = {}) => ({
  id,
  title: 'task ' + id,
  files: ['src.mjs'],
  tier: 'standard',
  review: 'lean',
  writes: ['src.mjs'],
  commutes: [],
  interfaces: { consumes: ['none'], produces: ['none'] },
  testCmd: 'bash check.sh',
  proofTests: [],
  proofRuns: [],
  body: BODY,
  ...over,
})

/**
 * Stand one run up. `write(cwd, id, kind)` is what the implementer (and the fix
 * round) leaves in the task's own clone; every judgment is canned, and any
 * dispatch this sim did not expect throws rather than being quietly answered.
 *
 * The stub records, at the instant of each `impl:` dispatch, the HEAD of that
 * task's own clone and how many commits the integration branch carries above
 * BASE — the two readings legs (c), (d) and (f) take BEFORE the first fold.
 */
const drive = async ({ tag, waves, nested = {}, write = () => {}, extra = {},
                       plan = '# ' + PLAN_H1 + '\n\nthe sim\'s plan file\n' }) => {
  const repo = makeSimRepo(path.join(tmp, 'repo-' + tag), nested)
  const runDir = path.join(tmp, 'run-' + tag)
  const planPath = path.join(tmp, 'plan-' + tag + '.md')
  fs.writeFileSync(planPath, plan)
  const calls = []
  const prompts = {}
  const heads = {}
  const aboveBase = {}
  const box = {}
  const stub = (prompt, opts, cwd) => {
    const label = String(opts.label)
    calls.push(label)
    prompts[label] = prompt
    const kind = label.split(':')[0]
    const id = label.split(':')[1]
    if (kind === 'impl' || kind === 'fix') {
      if (kind === 'impl') {
        heads[id] = gitSync(['rev-parse', 'HEAD'], cwd)
        aboveBase[id] = Number(gitSync(['rev-list', '--count', box.base + '..HEAD'], box.integ))
      }
      write(cwd, id, kind)
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + label)
  }
  const r = rig({
    repo, runDir, waves, stub, stamp: 'deps-' + tag,
    extraArgs: { width: 2, foldAgeMs: 0, planPath, bootstrapCmd: 'bash boot.sh', ...extra },
  })
  Object.assign(box, { base: r.base, integ: r.integ })
  const report = await r.run()
  const file = path.join(runDir, 'events.jsonl')
  const evs = (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
    .split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
  return { report, calls, prompts, heads, aboveBase, evs, runDir,
           base: r.base, integ: r.integ, clonesDir: r.clonesDir, logs: r.logs }
}

const ofKind = (evs, kind) => evs.filter((e) => e.kind === kind)
const depEvents = (evs) => ofKind(evs, 'driver:dependencies')
/** The report row of one task — the rows come back in completion order. */
const rowOf = (report, id) => report.tasks.find((t) => t.task === id)
/** Every finding the driver raised on a pre-review pass. */
const findingsAtRoundZero = (evs) =>
  evs.filter((e) => e.kind === 'driver:finding' && e.round === 0)
/** Those of them that are this scan's — the line M6 spells begins that way. */
const manifestFindings = (evs) => findingsAtRoundZero(evs)
  .filter((e) => String(e.detail || '').startsWith('the patch edits'))
/** `git merge-base --is-ancestor`, as a boolean. */
const isAncestor = (cwd, a, b) => {
  try { gitSync(['merge-base', '--is-ancestor', a, b], cwd); return true } catch { return false }
}
/** The extra keys an event carries beside the record's own three. */
const payloadKeys = (e) => Object.keys(e).filter((k) => !['kind', 'id', 'ts'].includes(k)).sort()

// The dependency arguments a scenario passes, in one place: the launcher writes
// the three together, and the runs that leave one out say so at their call.
const DECLARED = { dependencies: { runtime: RUNTIME, dev: DEV },
                   addCmd: ADD_CMD, addDevCmd: ADD_DEV_CMD }

// ══════════════════════════════════════════════════════════════════════════
// S1 — the green two-task run that carries the line: legs (a), (c2), (d), (e)
// ══════════════════════════════════════════════════════════════════════════
//
// A, whose `Run:` writes `$ULTRA_BASE` into the folded tree (reading 1 in the
// header explains the second, once-red `Run:` beside it), and B, which writes
// its own file and nothing else. `constraintChecks` carries the integrated
// `echo $ULTRA_BASE`, so the integrated base is in `report.integratedChecks[0]`.
const S1 = await drive({
  tag: 's1',
  waves: [[
    taskOf('A', { files: ['src.mjs', 'ultra-base.txt', 'fix-ran.txt'],
                  proofRuns: ['echo $ULTRA_BASE > ultra-base.txt', 'test -f fix-ran.txt'] }),
    taskOf('B', { files: ['src-b.mjs'], writes: ['src-b.mjs'] }),
  ]],
  write: (cwd, id, kind) => {
    if (kind === 'fix') { fs.writeFileSync(path.join(cwd, 'fix-ran.txt'), 'the fix round ran\n'); return }
    fs.writeFileSync(path.join(cwd, id === 'A' ? 'src.mjs' : 'src-b.mjs'), 'export const a = 2\n')
  },
  extra: { ...DECLARED, constraintChecks: [{ cmd: 'echo $ULTRA_BASE', minor: false }] },
})

// ── (a) [M1] [M4] the line, the event, and one of each ──────────────────────
{
  const evs = depEvents(S1.evs)
  assert.equal(evs.length, 1,
    '(a) [M4] a run whose args carry `dependencies` and both add commands appends exactly ONE ' +
    '`driver:dependencies` event — the add line is run once per run, at Setup, and the record ' +
    'carries it once. Got: ' + JSON.stringify(evs))
  const e = evs[0]
  assert.equal(e.cmd, CMD_BOTH,
    '(a) [M1] the event\'s `cmd` is the ONE shell line M1 spells, verbatim: `<addCmd>` over the ' +
    'runtime specs, each spec one single-quoted shell word, joined by ` && ` to `<addDevCmd>` ' +
    'over the dev specs. Got: ' + JSON.stringify(e.cmd))
  assert.deepEqual(e.specs, RUNTIME,
    '(a) [M4] `specs` is the runtime list, in the order the args carry it. Got: ' +
    JSON.stringify(e.specs))
  assert.deepEqual(e.dev, DEV,
    '(a) [M4] `dev` is the dev list. Got: ' + JSON.stringify(e.dev))
  assert.equal(e.exit, 0,
    '(a) [M4] `exit` is the line\'s own code — 0 here, the canned `add.sh` succeeding. Got: ' +
    JSON.stringify(e.exit))
  assert.deepEqual(payloadKeys(e), ['cmd', 'dev', 'exit', 'headSha', 'specs'],
    '(a) [M4] the event carries exactly the five keys the interface names — `specs`, `dev`, ' +
    '`cmd`, `exit`, `headSha` — beside the record\'s own `kind`/`id`/`ts`. Got: ' +
    JSON.stringify(payloadKeys(e)))
}

// ── (c2) [M2] the setup commit itself ───────────────────────────────────────
//
// The Proof's own command, run in the integration clone and read whole: the
// subject, the body, the paths, and the parent.
{
  const head = depEvents(S1.evs)[0].headSha
  assert.ok(head && head !== S1.base,
    '(c2) [M2] a line that changed `package.json` and wrote `bun.lock` makes a setup commit, and ' +
    'the event\'s `headSha` is that commit — not BASE (' + S1.base + '). Got: ' +
    JSON.stringify(head))
  const shown = gitSync(['show', '--name-only', '--format=%s%n%b', head], S1.integ)
  const lines = shown.split('\n')
  assert.equal(lines[0], PLAN_H1,
    '(c2) [M2] the commit\'s subject is the plan\'s H1 — the first `# ` line of the file ' +
    '`args.planPath` names. `git show --name-only --format=%s%n%b <headSha>` printed: ' +
    JSON.stringify(shown))
  const rest = lines.slice(1)
  const firstBlank = rest.findIndex((l) => l.trim() === '')
  const body = rest.slice(0, firstBlank === -1 ? rest.length : firstBlank).join('\n')
  assert.equal(body, COMMIT_BODY,
    '(c2) [M2] the commit\'s body is `setup: dependencies <runtime specs>` followed by ' +
    '` dev: <dev specs>`, the dev group being non-empty. Got: ' + JSON.stringify(body) +
    ' from: ' + JSON.stringify(shown))
  const names = rest.slice(firstBlank === -1 ? rest.length : firstBlank)
    .map((l) => l.trim()).filter(Boolean).sort()
  assert.deepEqual(names, ['bun.lock', 'package.json'],
    '(c2) [M2] the commit carries exactly the two manifest paths the add line changed — the ' +
    'modified `package.json` and the written `bun.lock` — staged by BASENAME and never by ' +
    '`git add -A`: `node_modules/marker` is not a manifest and is absent. Got: ' +
    JSON.stringify(names) + ' from: ' + JSON.stringify(shown))
  assert.equal(gitSync(['rev-parse', head + '^'], S1.integ), S1.base,
    '(c2) [M2] the setup commit\'s parent is BASE — one commit, cut at the head the run opened ' +
    'on. Got: ' + JSON.stringify(gitSync(['rev-parse', head + '^'], S1.integ)))
}

// ── (d) [M3] the head every dispatch anchors at ─────────────────────────────
{
  const head = depEvents(S1.evs)[0].headSha
  assert.equal(S1.heads.A, head,
    '(d) [M3] task A\'s clone was AT the setup head when its `impl:` dispatch went out — ' +
    '`anchorClone` moves every task clone to it before its first dispatch. Got: ' +
    JSON.stringify(S1.heads.A) + ', setup head ' + head)
  assert.equal(S1.heads.B, head,
    '(d) [M3] task B\'s clone likewise. Got: ' + JSON.stringify(S1.heads.B) +
    ', setup head ' + head)
  const baselineHead = gitSync(['rev-parse', 'HEAD'], path.join(S1.clonesDir, 'baseline'))
  assert.equal(baselineHead, head,
    '(d) [M3] the baseline clone is checked out at the setup head before the setup bootstrap ' +
    'loop runs — the one pass on "BASE" measures the tree every wave builds on. Got: ' +
    JSON.stringify(baselineHead) + ', setup head ' + head)
  const adopted = ofKind(S1.evs, 'driver:wave-adopted')
  assert.ok(adopted.length > 0,
    '(d) [M3] sim precondition: the run adopted at least one epoch, so there is a first ' +
    '`driver:wave-adopted` to read. Got: ' + JSON.stringify(adopted))
  assert.ok(isAncestor(S1.integ, head, adopted[0].headSha),
    '(d) [M3] the setup head is an ancestor of the first epoch\'s adopted head — every fold ' +
    'builds ON it (`adoptedHead` starts there and `patchBase.current` is set to it). Setup head ' +
    head + ', first adopted head ' + JSON.stringify(adopted[0].headSha))
}

// ── (e) [M3] `$ULTRA_BASE`, both passes, and the report's two shas ──────────
{
  const head = depEvents(S1.evs)[0].headSha
  const folded = gitSync(['show', 'HEAD:ultra-base.txt'], S1.integ)
  assert.equal(folded, head,
    '(e) [M3] the folded tree\'s `ultra-base.txt` — what the per-task pass\'s own `Run:` of ' +
    '`echo $ULTRA_BASE` wrote in task A\'s clone — is the setup head: the per-task ' +
    '`$ULTRA_BASE` is the dispatch head, and the dispatch head is the setup head. Got: ' +
    JSON.stringify(folded) + ', setup head ' + head)
  assert.ok(S1.report.integratedChecks.length > 0,
    '(e) [M3] sim precondition: the run\'s Global Constraint `Check:` ran on the adopted tree, so ' +
    '`report.integratedChecks[0]` exists. Got: ' + JSON.stringify(S1.report.integratedChecks))
  assert.equal(String(S1.report.integratedChecks[0].stdout).trim(), head,
    '(e) [M3] the INTEGRATED pass\'s `$ULTRA_BASE` is the setup head too — the driver hands ' +
    '`baseEnv(setupHead)` in place of `baseEnv(baseSha)` there. Got: ' +
    JSON.stringify(S1.report.integratedChecks[0]))
  assert.equal(S1.report.baseSha, S1.base,
    '(e) [M3] `report.baseSha` stays the launch BASE the run was cut at — the setup commit sits ' +
    'ABOVE it, and the publish fold reads the run as BASE..head so the PR carries the manifest ' +
    'and the lockfile. Got: ' + JSON.stringify(S1.report.baseSha) + ', BASE ' + S1.base)
  assert.equal(S1.report.setupSha, head,
    '(e) [M3] the report carries one new key `setupSha` — the setup head, where that commit is ' +
    'read. Got: ' + JSON.stringify(S1.report.setupSha) + ', setup head ' + head)
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M1] the two one-sided lines
// ══════════════════════════════════════════════════════════════════════════
//
// The same add commands with one group emptied: the join is there only when
// both groups are, and each half stands alone otherwise.
{
  const one = await drive({
    tag: 'b-runtime', waves: [[taskOf('A')]],
    write: (cwd) => fs.writeFileSync(path.join(cwd, 'src.mjs'), 'export const a = 2\n'),
    extra: { dependencies: { runtime: RUNTIME, dev: [] },
             addCmd: ADD_CMD, addDevCmd: ADD_DEV_CMD },
  })
  const e1 = depEvents(one.evs)
  assert.equal(e1.length, 1,
    '(b) [M1] a run whose `dev` group is empty still runs the line and appends one event. Got: ' +
    JSON.stringify(e1))
  assert.equal(e1[0].cmd, CMD_RUNTIME_ONLY,
    '(b) [M1] with `dev: []` the line is the runtime half ALONE — no ` && ` and no `<addDevCmd>` ' +
    'at all. Got: ' + JSON.stringify(e1[0].cmd))
  assert.ok(!e1[0].cmd.includes(' && '),
    '(b) [M1] and it carries no ` && ` join. Got: ' + JSON.stringify(e1[0].cmd))

  const two = await drive({
    tag: 'b-dev', waves: [[taskOf('A')]],
    write: (cwd) => fs.writeFileSync(path.join(cwd, 'src.mjs'), 'export const a = 2\n'),
    extra: { dependencies: { runtime: [], dev: DEV },
             addCmd: ADD_CMD, addDevCmd: ADD_DEV_CMD },
  })
  const e2 = depEvents(two.evs)
  assert.equal(e2.length, 1,
    '(b) [M1] a run whose `runtime` group is empty still runs the line and appends one event. ' +
    'Got: ' + JSON.stringify(e2))
  assert.equal(e2[0].cmd, CMD_DEV_ONLY,
    '(b) [M1] with `runtime: []` the line is the dev half ALONE. Got: ' + JSON.stringify(e2[0].cmd))
  assert.deepEqual([e2[0].specs, e2[0].dev], [[], DEV],
    '(b) [M1] and the event\'s two lists are the args\' own, empty group and all. Got: ' +
    JSON.stringify([e2[0].specs, e2[0].dev]))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M2] [M4] the line that exits 0 and changes nothing
// ══════════════════════════════════════════════════════════════════════════
//
// `add-noop.sh` exits 0 and writes nothing: the packages were already in the
// manifest, as on a re-drive whose reuse head carries them. No commit, no setup
// head, and the run continues from BASE exactly as a run with no `dependencies`
// does — apart from the one event, which is still appended.
{
  const NOOP = "bash add-noop.sh 'left-pad@^1' 'right-pad' && bash add-noop.sh -d 'eslint'"
  const s = await drive({
    tag: 'noop',
    waves: [[taskOf('A'), taskOf('B', { files: ['src-b.mjs'], writes: ['src-b.mjs'] })]],
    write: (cwd, id) => fs.writeFileSync(path.join(cwd, id === 'A' ? 'src.mjs' : 'src-b.mjs'),
      'export const a = 2\n'),
    extra: { dependencies: { runtime: RUNTIME, dev: DEV },
             addCmd: 'bash add-noop.sh', addDevCmd: 'bash add-noop.sh -d' },
  })
  const evs = depEvents(s.evs)
  assert.equal(evs.length, 1,
    '(c) [M4] the line ran, so the event is appended even though it changed nothing. Got: ' +
    JSON.stringify(evs))
  assert.equal(evs[0].cmd, NOOP,
    '(c) [M1] the line is built from THIS run\'s add commands. Got: ' + JSON.stringify(evs[0].cmd))
  assert.equal(evs[0].exit, 0,
    '(c) [M4] `exit` is 0. Got: ' + JSON.stringify(evs[0].exit))
  assert.equal(evs[0].headSha, s.base,
    '(c) [M4] `headSha` is the head the run continues from — `reuseHead || baseSha`, which is ' +
    'BASE here, because no manifest path changed and so no commit was made. Got: ' +
    JSON.stringify(evs[0].headSha) + ', BASE ' + s.base)
  assert.equal(s.report.setupSha, null,
    '(c) [M3] `report.setupSha` is `null` on a run that made no setup commit. Got: ' +
    JSON.stringify(s.report.setupSha))
  assert.deepEqual([s.aboveBase.A, s.aboveBase.B], [0, 0],
    '(c) [M2] the integration branch carries NO commit above BASE at either `impl:` dispatch — ' +
    'before the first fold, nothing was committed. Got: ' +
    JSON.stringify([s.aboveBase.A, s.aboveBase.B]))
  assert.deepEqual([s.heads.A, s.heads.B], [s.base, s.base],
    '(c) [M3] every task clone\'s dispatch `HEAD` is BASE — with no setup head there is nothing ' +
    'to re-anchor to. Got: ' + JSON.stringify([s.heads.A, s.heads.B]) + ', BASE ' + s.base)
}

// ══════════════════════════════════════════════════════════════════════════
// (f) [M4] the two runs that run no line at all
// ══════════════════════════════════════════════════════════════════════════

// (f.1) no `dependencies` key and no `addCmd`: byte-for-byte the run BASE makes.
{
  const s = await drive({
    tag: 'bare',
    waves: [[
      taskOf('A', { files: ['src.mjs', 'ultra-base.txt', 'fix-ran.txt'],
                    proofRuns: ['echo $ULTRA_BASE > ultra-base.txt', 'test -f fix-ran.txt'] }),
      taskOf('B', { files: ['src-b.mjs'], writes: ['src-b.mjs'] }),
    ]],
    write: (cwd, id, kind) => {
      if (kind === 'fix') { fs.writeFileSync(path.join(cwd, 'fix-ran.txt'), 'the fix round ran\n'); return }
      fs.writeFileSync(path.join(cwd, id === 'A' ? 'src.mjs' : 'src-b.mjs'), 'export const a = 2\n')
    },
  })
  assert.deepEqual(depEvents(s.evs), [],
    '(f) [M4] a run whose args carry no `dependencies` appends NO `driver:dependencies`. Got: ' +
    JSON.stringify(depEvents(s.evs)))
  assert.deepEqual([s.aboveBase.A, s.aboveBase.B], [0, 0],
    '(f) [M4] and makes no commit above BASE on the integration branch before the first fold. ' +
    'Got: ' + JSON.stringify([s.aboveBase.A, s.aboveBase.B]))
  assert.deepEqual([s.heads.A, s.heads.B], [s.base, s.base],
    '(f) [M4] every task clone\'s dispatch `HEAD` is BASE. Got: ' +
    JSON.stringify([s.heads.A, s.heads.B]) + ', BASE ' + s.base)
  assert.equal(gitSync(['show', 'HEAD:ultra-base.txt'], s.integ), s.base,
    '(f) [M4] the per-task `$ULTRA_BASE` is BASE — `adoptedHead` starts at `reuseHead || ' +
    'baseSha`. Got: ' + JSON.stringify(gitSync(['show', 'HEAD:ultra-base.txt'], s.integ)))
  assert.equal(s.report.setupSha, null,
    '(f) [M3] `report.setupSha` is `null`. Got: ' + JSON.stringify(s.report.setupSha))
}

// (f.2) `dependencies` naming a spec, `addCmd` present, `addDevCmd` absent: the
// launcher writes the two together, so one without the other is a plan the
// driver refuses to guess at — no line, no commit, no event, one judgment call.
{
  const s = await drive({
    tag: 'half',
    waves: [[taskOf('A')]],
    write: (cwd) => fs.writeFileSync(path.join(cwd, 'src.mjs'), 'export const a = 2\n'),
    extra: { dependencies: { runtime: ['left-pad'], dev: [] }, addCmd: ADD_CMD },
  })
  assert.deepEqual(depEvents(s.evs), [],
    '(f) [M4] a run that names a spec but not BOTH add commands appends no ' +
    '`driver:dependencies`. Got: ' + JSON.stringify(depEvents(s.evs)))
  assert.equal(s.aboveBase.A, 0,
    '(f) [M4] and makes no commit above BASE. Got: ' + JSON.stringify(s.aboveBase.A))
  assert.equal(s.report.setupSha, null,
    '(f) [M4] `report.setupSha` is `null`. Got: ' + JSON.stringify(s.report.setupSha))
  const calls = s.report.judgmentCalls.filter(
    (c) => String(c).startsWith('setup: dependencies declared but no add command'))
  assert.equal(calls.length, 1,
    '(f) [M4] exactly one `judgmentCalls` entry begins `setup: dependencies declared but no add ' +
    'command` — the run otherwise runs as at BASE. The calls were: ' +
    JSON.stringify(s.report.judgmentCalls))
}

// ══════════════════════════════════════════════════════════════════════════
// (g) [M5] the failed install parks the run before any worker
// ══════════════════════════════════════════════════════════════════════════
{
  const s = await drive({
    tag: 'fail',
    waves: [[taskOf('A'), taskOf('B', { files: ['src-b.mjs'], writes: ['src-b.mjs'] })]],
    write: () => { throw new Error('(g) no implementer may run on a parked run') },
    extra: { dependencies: { runtime: RUNTIME, dev: DEV },
             addCmd: 'bash add-fail.sh', addDevCmd: 'bash add-fail.sh -d' },
  })
  const evs = depEvents(s.evs)
  assert.equal(evs.length, 1,
    '(g) [M4] the line ran and its event is appended. Got: ' + JSON.stringify(evs))
  assert.equal(evs[0].exit, 7,
    '(g) [M4] `exit` is the installer\'s own code, 7. Got: ' + JSON.stringify(evs[0].exit))
  assert.equal(evs[0].headSha, null,
    '(g) [M4] `headSha` is `null` on a non-zero exit — the run continues from nothing, it parks. ' +
    'Got: ' + JSON.stringify(evs[0].headSha))
  assert.deepEqual(s.calls, [],
    '(g) [M5] NO agent of any label is dispatched by a parked run — no `exam:`, no `impl:`, no ' +
    '`review:`, no `reconcile:`. The dispatches were: ' + JSON.stringify(s.calls))
  assert.deepEqual(s.report.tasks, [],
    '(g) [M5] `report.tasks` is `[]` — nothing was worked. Got: ' +
    JSON.stringify(s.report.tasks))
  assert.deepEqual(s.report.unfinished, [
    'A: never dispatched — the dependency install failed at setup',
    'B: never dispatched — the dependency install failed at setup',
  ], '(g) [M5] every task is named in `unfinished`, in plan order, with the fourth shape the ' +
     'report format names. Got: ' + JSON.stringify(s.report.unfinished))
  const row = s.report.waveMerges[0]
  assert.ok(row, '(g) [M5] sim precondition: the park pushed a `waveMerges` row. Got: ' +
    JSON.stringify(s.report.waveMerges))
  assert.deepEqual([row.wave, row.status], [1, 'TEST_FAILED'],
    '(g) [M5] the one `waveMerges` row is `{ wave: 1, status: \'TEST_FAILED\' }` on those two ' +
    'keys. Got: ' + JSON.stringify(row))
  assert.ok(String(row.detail || '').startsWith('setup: the dependency install failed (exit 7)'),
    '(g) [M5] its `detail` begins `setup: the dependency install failed (exit 7)`. Got: ' +
    JSON.stringify(row.detail))
  assert.ok(String(row.detail || '').includes('no such package left-pad'),
    '(g) [M5] and quotes the tail of the installer\'s own output. Got: ' +
    JSON.stringify(row.detail))
  const blocked = ofKind(s.evs, 'driver:wave-blocked')
  assert.equal(blocked.length, 1,
    '(g) [M5] one `driver:wave-blocked` is appended. Got: ' + JSON.stringify(blocked))
  assert.equal(blocked[0].wave, 1,
    '(g) [M5] at `wave` 1. Got: ' + JSON.stringify(blocked[0].wave))
  assert.deepEqual(blocked[0].tasks, ['A', 'B'],
    '(g) [M5] naming every task of the plan, in plan order. Got: ' +
    JSON.stringify(blocked[0].tasks))
  assert.equal(blocked[0].why, 'setup',
    '(g) [M5] with `why: \'setup\'` — the new `why` value beside the red baseline\'s. Got: ' +
    JSON.stringify(blocked[0].why))
  assert.equal(blocked[0].detail, row.detail,
    '(g) [M5] and the row\'s own `detail`, verbatim. Got: ' + JSON.stringify(blocked[0].detail))
  assert.equal(s.report.blockedWaves.length, 1,
    '(g) [M5] `blockedWaves` carries that one row and no other. Got: ' +
    JSON.stringify(s.report.blockedWaves))
  assert.equal(gitSync(['status', '--porcelain'], s.integ), '',
    '(g) [M5] the integration clone is restored — `git checkout -- .` and `git clean -fd` leave ' +
    'it clean, the half-written manifest and the `node_modules/` marker both gone. Got: ' +
    JSON.stringify(gitSync(['status', '--porcelain'], s.integ)))
  assert.equal(gitSync(['rev-parse', 'HEAD'], s.integ), s.base,
    '(g) [M5] at the head it was on, BASE. Got: ' +
    JSON.stringify(gitSync(['rev-parse', 'HEAD'], s.integ)))
}

// ══════════════════════════════════════════════════════════════════════════
// (h) [M6] the manifest edit nobody declared — on a run with NO `dependencies`
// ══════════════════════════════════════════════════════════════════════════
//
// The red is a plan-level rule and fires on every run, declared line or not.
// A's `files` are `['src.mjs']` and its implementer edits `package.json` too.
const editsManifest = (cwd, file = 'package.json') =>
  fs.appendFileSync(path.join(cwd, file), 'the task edited this manifest\n')

// (h.1) the fix that drops the edit: one red, one finding, then green.
{
  const s = await drive({
    tag: 'h-drop',
    waves: [[taskOf('A')]],
    write: (cwd, id, kind) => {
      fs.writeFileSync(path.join(cwd, 'src.mjs'), 'export const a = 2\n')
      if (kind === 'fix') { gitSync(['checkout', 'HEAD', '--', 'package.json'], cwd); return }
      editsManifest(cwd)
    },
  })
  const found = manifestFindings(s.evs)
  assert.equal(found.length, 1,
    '(h) [M6] the pass carries exactly ONE red for the one manifest path the patch edits and ' +
    'the task\'s `files` do not list — and the green pass after the fix adds no second. Got: ' +
    JSON.stringify(found))
  const f = found[0]
  const LINE = MANIFEST_RED('package.json')
  assert.equal(f.detail, LINE,
    '(h) [M6] the line is exactly the sentence M6 spells, naming the path. Got: ' +
    JSON.stringify(f.detail))
  assert.equal(f.task, 'A',
    '(h) [M6] the finding is held against A. Got: ' + JSON.stringify(f.task))
  assert.equal(f.round, 0,
    '(h) [M6] at `round` 0 — the driver\'s own pre-review pass, before any reviewer. Got: ' +
    JSON.stringify(f.round))
  assert.equal(f.severity, 'blocking',
    '(h) [M6] `severity` is `blocking`. Got: ' + JSON.stringify(f.severity))
  assert.equal(f.actor, 'implementer',
    '(h) [M6] `actor` is `implementer`. Got: ' + JSON.stringify(f.actor))
  assert.deepEqual(f.paths, ['package.json'],
    '(h) [M6] `paths` is the one manifest path. Got: ' + JSON.stringify(f.paths))
  assert.equal(f.evidence && f.evidence.read, LINE,
    '(h) [M6] `evidence.read` is the finding\'s own line. Got: ' + JSON.stringify(f.evidence))
  assert.ok(String((f.evidence || {}).against || '').startsWith('the captured patch at ') &&
            String((f.evidence || {}).against || '').length > 'the captured patch at '.length,
    '(h) [M6] `evidence.against` names the captured patch at the implementer\'s own `headSha`. ' +
    'Got: ' + JSON.stringify(f.evidence))
  assert.ok(s.calls.includes('fix:A:0'),
    '(h) [M6] the red buys the `fix:A:0` round, exactly as the export-collision and NUL reds do. ' +
    'The dispatches were: ' + JSON.stringify(s.calls))
  assert.ok(String(s.prompts['fix:A:0'] || '').includes(LINE),
    '(h) [M6] the `fix:A:0` prompt carries the line in its blocking-issues block. Got: ' +
    JSON.stringify(String(s.prompts['fix:A:0'] || '').slice(-600)))
  assert.equal(rowOf(s.report, 'A').status, 'done',
    '(h) [M6] a fix that drops the manifest edit leaves the pass green and the task ends `done`. ' +
    'Got: ' + JSON.stringify(rowOf(s.report, 'A')))
}

// (h.2) the fix that keeps it: the task is over, proof-red, and never reviewed.
{
  const s = await drive({
    tag: 'h-keep',
    waves: [[taskOf('A')]],
    write: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'src.mjs'), 'export const a = 2\n')
      editsManifest(cwd)
    },
  })
  const LINE = MANIFEST_RED('package.json')
  const found = manifestFindings(s.evs)
  assert.ok(found.length >= 1 && found.every((e) => e.detail === LINE),
    '(h) [M6] a fix round that leaves the manifest edit finds the same line again, and every row ' +
    'the record carries is that line. Got: ' + JSON.stringify(found.map((e) => e.detail)))
  assert.ok(!s.calls.some((l) => l.startsWith('review:')),
    '(h) [M6] a task still red after its one repair round reaches NO reviewer. The dispatches ' +
    'were: ' + JSON.stringify(s.calls))
  const row = rowOf(s.report, 'A')
  assert.equal(row.status, 'failed',
    '(h) [M6] the task ends `failed`. Got: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'proof-red',
    '(h) [M6] with `reviewVerdict` `proof-red` — the manifest red is a red of the pass like any ' +
    'other. Got: ' + JSON.stringify(row.reviewVerdict))
  assert.ok(String(row.notes || '').includes(LINE),
    '(h) [M6] and `notes` carrying the line. Got: ' + JSON.stringify(row.notes))
}

// ══════════════════════════════════════════════════════════════════════════
// (i) [M6] the same on a run WITH `dependencies`
// ══════════════════════════════════════════════════════════════════════════
//
// The manifest edit lands on top of the setup commit — the task is editing the
// very file the driver installed into — and it is the same one red and one
// finding, against the path, not against the content.
{
  const s = await drive({
    tag: 'i-declared',
    waves: [[taskOf('A')]],
    write: (cwd, id, kind) => {
      fs.writeFileSync(path.join(cwd, 'src.mjs'), 'export const a = 2\n')
      if (kind === 'fix') { gitSync(['checkout', 'HEAD', '--', 'package.json'], cwd); return }
      editsManifest(cwd)
    },
    extra: { ...DECLARED },
  })
  const head = (depEvents(s.evs)[0] || {}).headSha
  assert.ok(head && head !== s.base,
    '(i) sim precondition: this run made a setup commit, so the task\'s edit really does land on ' +
    'top of it. Got: ' + JSON.stringify(head))
  const found = manifestFindings(s.evs)
  assert.equal(found.length, 1,
    '(i) [M6] the same ONE red on a run that declared its dependencies. Got: ' +
    JSON.stringify(found))
  assert.equal(found[0].detail, MANIFEST_RED('package.json'),
    '(i) [M6] the same line. Got: ' + JSON.stringify(found[0].detail))
  assert.deepEqual(found[0].paths, ['package.json'],
    '(i) [M6] the same one path. Got: ' + JSON.stringify(found[0].paths))
  assert.equal(rowOf(s.report, 'A').status, 'done',
    '(i) [M6] and the fix that drops it leaves the task `done`. Got: ' +
    JSON.stringify(rowOf(s.report, 'A')))
}

// ══════════════════════════════════════════════════════════════════════════
// (j) [M7] the declared manifest, and no manifest at all — both runs
// ══════════════════════════════════════════════════════════════════════════
//
// A's `files` LIST `package.json`, so its edit is a signed, non-dependency one
// (a `scripts` entry, a config field) and draws nothing; B touches no manifest
// at all. This is the exemption `fleet/tests/test_run_engine_lockfile_regen.mjs`
// rests on, stated directly — reading 3 in the header.
for (const [tag, extra, what] of [['j-bare', {}, 'without `dependencies`'],
                                  ['j-declared', { ...DECLARED }, 'with `dependencies`']]) {
  const s = await drive({
    tag,
    waves: [[
      taskOf('A', { files: ['package.json', 'src.mjs'], writes: ['package.json', 'src.mjs'] }),
      taskOf('B', { files: ['src-b.mjs'], writes: ['src-b.mjs'] }),
    ]],
    write: (cwd, id) => {
      if (id === 'A') {
        fs.writeFileSync(path.join(cwd, 'src.mjs'), 'export const a = 2\n')
        editsManifest(cwd)
        return
      }
      fs.writeFileSync(path.join(cwd, 'src-b.mjs'), 'export const b = 2\n')
    },
    extra,
  })
  assert.deepEqual(manifestFindings(s.evs), [],
    '(j) [M7] on a run ' + what + ', a task whose `files` list `package.json` and that edits it ' +
    'draws NO `driver:finding` at `round` 0 whose `detail` begins `the patch edits`, and neither ' +
    'does a task that edits no manifest at all. Got: ' + JSON.stringify(manifestFindings(s.evs)))
  assert.ok(!s.calls.some((l) => l.startsWith('fix:')),
    '(j) [M7] on a run ' + what + ', neither task buys a repair round. The dispatches were: ' +
    JSON.stringify(s.calls))
  assert.deepEqual(s.report.tasks.map((t) => t.status).sort(), ['done', 'done'],
    '(j) [M7] on a run ' + what + ', both tasks end `done`. Got: ' +
    JSON.stringify(s.report.tasks.map((t) => [t.task, t.status])))
}

// ══════════════════════════════════════════════════════════════════════════
// (k) [M6] [M7] the nested manifest, and the name that only looks like one
// ══════════════════════════════════════════════════════════════════════════
//
// The rule is the BASENAME at any depth — the TinyApp case was
// `client/package.json`, not a root manifest — and the WHOLE basename, so
// `package.json.bak` is not a manifest. One task edits both; exactly one red.
{
  // The basename rule itself, driven directly: the red reuses `#825`'s one set
  // of names rather than writing a second.
  assert.equal(bootstrapManifestChanged(['client/package.json']), true,
    '(k) [M6] `bootstrapManifestChanged` accepts a nested `client/package.json` — the rule is ' +
    'the basename at any depth. Got: ' + JSON.stringify(bootstrapManifestChanged(['client/package.json'])))
  assert.equal(bootstrapManifestChanged(['package.json.bak']), false,
    '(k) [M7] and refuses `package.json.bak` — the WHOLE basename. Got: ' +
    JSON.stringify(bootstrapManifestChanged(['package.json.bak'])))

  const s = await drive({
    tag: 'k-nested',
    nested: { 'client/package.json': PKG_BASE },
    waves: [[taskOf('A')]],
    write: (cwd, id, kind) => {
      fs.writeFileSync(path.join(cwd, 'src.mjs'), 'export const a = 2\n')
      editsManifest(cwd, 'package.json.bak')
      if (kind === 'fix') { gitSync(['checkout', 'HEAD', '--', 'client/package.json'], cwd); return }
      editsManifest(cwd, 'client/package.json')
    },
  })
  const found = manifestFindings(s.evs)
  assert.equal(found.length, 1,
    '(k) [M6] [M7] exactly ONE red: the nested `client/package.json` the task\'s `files` do not ' +
    'list is a manifest, and `package.json.bak` — edited by the same patch, on every pass — is ' +
    'not. Got: ' + JSON.stringify(found.map((e) => [e.detail, e.paths])))
  assert.equal(found[0].detail, MANIFEST_RED('client/package.json'),
    '(k) [M6] the line names the nested path as the patch carries it. Got: ' +
    JSON.stringify(found[0].detail))
  assert.deepEqual(found[0].paths, ['client/package.json'],
    '(k) [M6] `paths` is that one path. Got: ' + JSON.stringify(found[0].paths))
  assert.equal(rowOf(s.report, 'A').status, 'done',
    '(k) [M6] the fix that drops the nested edit — and keeps the `.bak` one — leaves the pass ' +
    'green. Got: ' + JSON.stringify(rowOf(s.report, 'A')))
}

// ══════════════════════════════════════════════════════════════════════════
// (l) [M8] the two documents — six of the Proof's seven `Run:` lines, read here
// ══════════════════════════════════════════════════════════════════════════
//
// The seventh is `node fleet/tests/test_run_engine_lockfile_regen.mjs`, which
// the DRIVER runs and this file may not spawn; leg (j) above is what stands for
// it here (reading 3 in the header).
{
  const contract = fs.readFileSync(new URL('../CONTRACT.md', import.meta.url), 'utf8')
  const cLines = contract.split('\n')
  const reportFormat = fs.readFileSync(
    new URL('../../skills/ultrapowers/references/report-format.md', import.meta.url), 'utf8')
  const rLines = reportFormat.split('\n')

  // Run 1 — `grep -q 'driver:dependencies' fleet/CONTRACT.md`
  assert.ok(contract.includes('driver:dependencies'),
    '(l) [M8] `fleet/CONTRACT.md` names `driver:dependencies` — the Proof\'s first `Run:`')

  // Run 2 — the five keys within the event's own paragraph (`grep -A6`).
  const windows = cLines
    .map((l, i) => (l.includes('driver:dependencies') ? cLines.slice(i, i + 7).join(' ') : null))
    .filter(Boolean)
  assert.ok(windows.some((w) =>
    /driver:dependencies[\s\S]*specs[\s\S]*dev[\s\S]*cmd[\s\S]*exit[\s\S]*headSha/.test(w)),
    '(l) [M8] the paragraph that names `driver:dependencies` names its five keys — `specs`, ' +
    '`dev`, `cmd`, `exit`, `headSha` — in that order, within six lines of it (the Proof\'s ' +
    'second `Run:`). The windows read: ' + JSON.stringify(windows))

  // Run 3 — `grep -q 'never by a task' fleet/CONTRACT.md`, and M8's placement:
  // beside the export-collision and NUL reds, which is the pre-review paragraph
  // the NUL sentence closes.
  assert.ok(contract.includes('never by a task'),
    '(l) [M8] `fleet/CONTRACT.md` carries the manifest red\'s own words `never by a task` — the ' +
    'Proof\'s third `Run:`')
  const from = cLines.findIndex((l) => l.includes('The pass reads the captured patch'))
  const to = cLines.findIndex((l, i) => i >= from && l.includes('One more kind records'))
  assert.ok(from !== -1 && to !== -1,
    '(l) [M8] sim precondition: the pre-review paragraph runs from the line `The pass reads the ' +
    'captured patch` to the line `One more kind records` — the range the export-collision and ' +
    'NUL reds are described in. Got: ' + JSON.stringify([from, to]))
  assert.ok(cLines.slice(from, to + 1).join(' ').includes('never by a task'),
    '(l) [M8] and the manifest red is described THERE, beside the export-collision and NUL reds, ' +
    'not in some other part of the file. The range reads: ' +
    JSON.stringify(cLines.slice(from, to + 1).join(' ')))

  // M8's other placement: the setup commit beside the re-drive reuse paragraph.
  const reuse = cLines.findIndex((l) => l.includes('Re-drive reuse (#383)'))
  assert.ok(reuse !== -1,
    '(l) [M8] sim precondition: `fleet/CONTRACT.md` carries the `Re-drive reuse (#383)` ' +
    'paragraph — the Setup narrative the setup install stands beside')
  const around = cLines.slice(Math.max(0, reuse - 40), reuse + 60).join(' ')
  assert.ok(around.includes('dependencies') && around.includes('commit'),
    '(l) [M8] the setup commit is described beside that paragraph — the region around it names ' +
    'the declared `dependencies` and the commit the install is made as. The region reads: ' +
    JSON.stringify(around))

  // Run 4 — the fourth `unfinished` shape.
  assert.ok(reportFormat.includes('the dependency install failed at setup'),
    '(l) [M8] `skills/ultrapowers/references/report-format.md` names the fourth `unfinished` ' +
    'shape, `<id>: never dispatched — the dependency install failed at setup` — the Proof\'s ' +
    'fourth `Run:`')
  const unfinishedRow = rLines.find((l) => l.startsWith('| `unfinished` |'))
  assert.ok(unfinishedRow,
    '(l) [M8] sim precondition: the field table carries an `unfinished` row. Got: ' +
    JSON.stringify(unfinishedRow))
  assert.ok(unfinishedRow.includes('the dependency install failed at setup'),
    '(l) [M8] the new shape is named in the `unfinished` row itself, where the other three are. ' +
    'Got: ' + JSON.stringify(unfinishedRow))
  assert.ok(!/Three shapes and no others/.test(unfinishedRow),
    '(l) [M8] and that row no longer says `Three shapes and no others` — it lists four. Got: ' +
    JSON.stringify(unfinishedRow))

  // Run 5 — `setupSha`, and M8's "a `setupSha` row in its field table".
  assert.ok(reportFormat.includes('setupSha'),
    '(l) [M8] the report format names `setupSha` — the Proof\'s fifth `Run:`')
  assert.ok(rLines.some((l) => /^\| `setupSha` \|/.test(l)),
    '(l) [M8] as a row of its own in the field table. The table\'s rows are: ' +
    JSON.stringify(rLines.filter((l) => /^\| `/.test(l)).slice(0, 12)))

  // Run 6 — the `baseSha` row says the field is the launch BASE.
  assert.ok(rLines.some((l) => /^\| .baseSha. \|.*launch BASE/.test(l)),
    '(l) [M8] the `baseSha` row says the field is the launch BASE the run was cut at — a run ' +
    'with a setup commit sits above it, and `setupSha` is where that commit is read (the ' +
    'Proof\'s sixth `Run:`). The row reads: ' +
    JSON.stringify(rLines.find((l) => /^\| .baseSha. \|/.test(l))))
}

// ══════════════════════════════════════════════════════════════════════════
// the guard (#1053): this sim stands whole at the path the Proof names
// ══════════════════════════════════════════════════════════════════════════
{
  const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
  const pointers = self.filter((l) => /^import .*exams\//.test(l))
  assert.deepEqual(pointers, [],
    'the guarded sim carries no `import` line naming a path under `exams/` — it imports the ' +
    'engine and the sim helpers by their `fleet/tests/`-relative paths and nothing else. Found: ' +
    JSON.stringify(pointers))
  const spawns = self.filter((l) => /test_[a-z_]*\.mjs/.test(l) && /exec|spawn|fork/.test(l))
  assert.deepEqual(spawns, [],
    'and spawns no sibling sim — the seventh `Run:` is the driver\'s to run. Found: ' +
    JSON.stringify(spawns))
}

// The sentinel a reader greps for: printed only if every assertion above held.
console.log('ALL TESTS PASSED')
