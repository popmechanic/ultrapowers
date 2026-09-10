// fleet/tests/test_publish_fold_block.mjs — the exam for task 2, "The
// contending block for a cross-run conflict": `contendingBlock({ repo, base,
// tip, run, path, tasks })` from `fleet/publish-fold-block.mjs`.
//
// The fixtures are REAL: a bare origin (`git init --bare
// --initial-branch=main`), a clone that seeds and pushes `main` (that clone is
// the `repo` the export is called against), and a second clone that makes the
// frontier commits on `main` and pushes run 3's plan tag to the origin only
// after the first clone existed. Nothing below the export is stubbed — the
// tag fetch, the plan read off the tag and `compile_plan.py` are the real
// ones, because the contract is about what the block says, not about how a
// particular implementation spells it.
//
// Reading of the grammar this exam pins (M1's template, read the way the
// in-wave block in run-engine.mjs is built): the string opens with the
// heading and the sentence and every entry that follows is prefixed by one
// newline — a frontier entry with no plan is one `- main …` line, a task
// entry is one `- run …` line, a newline, and the task's body verbatim. There
// is no trailing newline. `<run>` in the sentence is substituted, exactly as
// `<run>` is in the `- run <run> task …` template of the same clause.
//
// Legs: (a) the whole string, byte for byte, over a four-commit frontier;
// (b) the tag fetch is real, and a missing tag degrades to the no-plan line;
// (c) an untouched path, and a `tasks` naming nothing for the path.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { simEnv } from './_helpers.mjs'

import { contendingBlock } from '../publish-fold-block.mjs'
// #754 Task 2 — exams first: the ordered task list the block renders from, and
// the list the fold's exam check reads its `- Test:` bullets out of.
import { contendingTasks } from '../publish-fold-block.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const COMPILER = path.resolve(HERE, '../../skills/ultrapowers/scripts/compile_plan.py')

// Deterministic commit metadata: identical dates keep the first-parent order
// the only thing that orders the frontier.
const ENV = {
  ...simEnv(),
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1',
}
const git = (argv, cwd) => {
  try {
    return execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    throw new Error('git ' + argv.join(' ') + ' in ' + cwd + ' failed: ' + String(e.stderr || e.message))
  }
}
const hasRef = (repo, ref) => {
  try { git(['rev-parse', '--verify', '--quiet', ref], repo); return true } catch { return false }
}

// ── the fixture ───────────────────────────────────────────────────────────
// Run 3's plan, as it lives on `ultra/plan/run-3`: T1's Files name `a.txt`,
// T2's name only `z.txt` — so only T1 may ever reach a block for `a.txt`.
const PLAN_RUN3 = [
  '# Plan: run three',
  '',
  '**Acceptance:** suite — the committed suite is the verification.',
  '',
  '### Task T1: The first task of run three',
  '',
  '**Type:** implementation',
  '**Review:** lean',
  '',
  '**Files:**',
  '- Modify: `a.txt`',
  '',
  '**Claim:** the first task of run three rewrites the second line of a.txt.',
  '',
  '- [ ] rewrite the second line',
  '',
  '### Task T2: The second task of run three',
  '',
  '**Type:** implementation',
  '**Review:** lean',
  '',
  '**Files:**',
  '- Modify: `z.txt`',
  '',
  '**Claim:** the second task of run three rewrites z.txt and nothing else.',
  '',
  '- [ ] rewrite z',
  '',
].join('\n')

// The oracle for run 3's compiled task record: the same compiler M2 names,
// run by the exam on the same plan text, so the expected title/body/files are
// the plan's own and not this exam's paraphrase of them.
function compiledTask(planText, id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-plan-'))
  const planFile = path.join(dir, 'plan.md')
  const out = path.join(dir, 'launch.json')
  fs.writeFileSync(planFile, planText)
  execFileSync('python3', [COMPILER, planFile, '--emit-launch', out],
    { cwd: dir, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })
  const payload = JSON.parse(fs.readFileSync(out, 'utf8'))
  fs.rmSync(dir, { recursive: true, force: true })
  const t = (payload.tasks || []).find((x) => x.id === id)
  assert.ok(t, 'fixture sanity: the compiler found task ' + id + ' in run 3\'s plan')
  assert.ok(t.body.startsWith('### Task ' + id + ':'), 'fixture sanity: ' + id + '\'s body is its verbatim section')
  return t
}

// A whole fixture in its own temp directory (same-wave sims share one machine).
// Frontier on `main` since BASE, oldest to newest:
//   1. a `Fleet-Run: 3` commit editing a.txt   (its tag is pushed after the clone)
//   2. a human commit editing a.txt, no trailer
//   3. a merge whose second parent edited a.txt (first-parent diff touches a.txt)
//   4. a `Fleet-Run: 4` commit editing a.txt   (its tag is never pushed)
function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-block-'))
  const origin = path.join(root, 'origin.git')
  git(['init', '--bare', '--initial-branch=main', origin], root)

  // The first clone: it seeds and pushes main, and it is the `repo` under test.
  const repo = path.join(root, 'clone-under-test')
  git(['clone', '--quiet', origin, repo], root)
  git(['config', 'user.email', 'seed@fleet.test'], repo)
  git(['config', 'user.name', 'Seed'], repo)
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n')
  fs.writeFileSync(path.join(repo, 'b.txt'), 'bee\n')
  fs.writeFileSync(path.join(repo, 'c.txt'), 'see\n')
  git(['add', '-A'], repo)
  git(['commit', '--quiet', '-m', 'seed the fixture'], repo)
  git(['push', '--quiet', 'origin', 'main'], repo)
  const base = git(['rev-parse', 'HEAD'], repo)

  // The second clone makes the frontier.
  const maker = path.join(root, 'frontier-maker')
  git(['clone', '--quiet', origin, maker], root)
  git(['config', 'user.email', 'bot@fleet.test'], maker)
  git(['config', 'user.name', 'Fleet Bot'], maker)
  const write = (name, text) => fs.writeFileSync(path.join(maker, name), text)

  write('a.txt', 'one\nfrom run three\n')
  git(['add', '-A'], maker)
  git(['commit', '--quiet', '-m', 'run three rewrites the second line', '-m', 'Fleet-Run: 3'], maker)
  const run3 = git(['rev-parse', 'HEAD'], maker)

  write('a.txt', 'one\nfrom a person\n')
  git(['add', '-A'], maker)
  git(['-c', 'user.name=Ada Human', 'commit', '--quiet', '-m', 'a person edits the second line'], maker)
  const human = git(['rev-parse', 'HEAD'], maker)

  git(['checkout', '--quiet', '-b', 'side'], maker)
  write('a.txt', 'one\nfrom the side branch\n')
  git(['add', '-A'], maker)
  git(['commit', '--quiet', '-m', 'the side branch edits the second line'], maker)
  const sideCommit = git(['rev-parse', 'HEAD'], maker)
  git(['checkout', '--quiet', 'main'], maker)
  git(['merge', '--quiet', '--no-ff', '-m', 'Merge the side branch', 'side'], maker)
  const merge = git(['rev-parse', 'HEAD'], maker)
  assert.equal(git(['rev-parse', 'HEAD^2'], maker), sideCommit, 'fixture sanity: the merge\'s second parent is the side commit')
  assert.notEqual(git(['diff', '--name-only', merge + '^1', merge], maker), '',
    'fixture sanity: the merge\'s own first-parent diff touches a.txt')

  write('a.txt', 'one\nfrom run four\n')
  git(['add', '-A'], maker)
  git(['commit', '--quiet', '-m', 'run four rewrites the second line', '-m', 'Fleet-Run: 4'], maker)
  const run4 = git(['rev-parse', 'HEAD'], maker)
  git(['push', '--quiet', 'origin', 'main'], maker)
  const tip = run4

  // The plan tags. Each sits on its own commit off the first-parent line, the
  // way `record_tags` pushes one after the merge — so it can postdate a clone.
  const makeTag = (tag, planText) => {
    git(['checkout', '--quiet', '--orphan', 'plan-' + tag.replace(/\W/g, '-')], maker)
    git(['rm', '-r', '--quiet', '--cached', '.'], maker)
    for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.rmSync(path.join(maker, f), { force: true })
    fs.mkdirSync(path.join(maker, '.ultrapowers'), { recursive: true })
    fs.writeFileSync(path.join(maker, '.ultrapowers', 'plan.md'), planText)
    git(['add', '-A'], maker)
    git(['commit', '--quiet', '-m', 'the plan of ' + tag], maker)
    git(['tag', tag], maker)
    git(['checkout', '--quiet', '--force', 'main'], maker)
  }
  makeTag('ultra/plan/run-3', PLAN_RUN3)
  makeTag('ultra/plan/run-4', PLAN_RUN3)
  // Only run 3's tag reaches the origin; run 4's never does.
  git(['push', '--quiet', 'origin', 'refs/tags/ultra/plan/run-3'], maker)

  // The clone under test learns main's new tip and NO tags: the plan tag is
  // the export's to fetch.
  git(['fetch', '--quiet', '--no-tags', 'origin', 'main'], repo)
  git(['merge', '--quiet', '--ff-only', 'FETCH_HEAD'], repo)
  assert.equal(git(['rev-parse', 'HEAD'], repo), tip, 'fixture sanity: the clone under test is at the tip')

  const meta = (sha) => ({
    sha,
    sha7: sha.slice(0, 7),
    subject: git(['log', '-1', '--format=%s', sha], repo),
    author: git(['log', '-1', '--format=%an', sha], repo),
  })
  return {
    root, origin, repo, maker, base, tip, sideCommit,
    run3: meta(run3), human: meta(human), merge: meta(merge), run4: meta(run4),
  }
}

// ── this run's tasks (run 7), the shape `launch.json` holds ───────────────
const RUN = 7
const TASK_A = { id: 'A', title: 'The A task', files: ['a.txt'], body: 'A body, first line.\nA body, second line.' }
const TASK_B = { id: 'B', title: 'The B task', files: ['b.txt'], body: 'B body, and only b is named.' }
const TASK_C = { id: 'C', title: 'The C task', files: ['a.txt', 'b.txt'], body: 'C body, naming two files.' }
const TASK_D = { id: 'D', title: 'The D task', files: ['c.txt'], body: 'D body, naming the untouched path.' }

// ── the grammar the exam expects, built here and nowhere else ─────────────
const heading = (run) =>
  '\nCONTENDING TASKS:\n' +
  'The frontier side of each hunk is main since this run\'s base; the incoming side is labeled run-' +
  run + ' in the hunks.'
const noPlanLine = (c) => '\n- main ' + c.sha7 + ' "' + c.subject + '" (' + c.author + ', no plan)'
const taskEntry = (run, t) =>
  '\n- run ' + run + ' task ' + t.id + ': ' + t.title + ' [files: ' + t.files.join(', ') + ']' + '\n' + t.body

// ═════ leg (a) — the whole block over the four-commit frontier [M1][M2] ═══
{
  const fx = buildFixture()
  const t1 = compiledTask(PLAN_RUN3, 'T1')

  const pending = contendingBlock({
    repo: fx.repo, base: fx.base, tip: fx.tip, run: RUN, path: 'a.txt',
    tasks: [TASK_A, TASK_B, TASK_C],
  })
  // Produces: `contendingBlock(...) -> Promise<string>`.
  assert.ok(pending && typeof pending.then === 'function', 'leg (a) [M1]: contendingBlock returns a promise')
  const block = await pending
  assert.equal(typeof block, 'string', 'leg (a) [M1]: it resolves a string')

  // The expected string, assembled from the fixture's own sha7s, subjects,
  // authors and bodies: heading, sentence, then the frontier oldest to newest
  // (run 3's plan task, the human commit, the merge, the untagged run 4),
  // then this run's entries in the order of `tasks`.
  const expected =
    heading(RUN) +
    taskEntry(3, t1) +
    noPlanLine(fx.human) +
    noPlanLine(fx.merge) +
    noPlanLine(fx.run4) +
    taskEntry(RUN, TASK_A) +
    taskEntry(RUN, TASK_C)
  assert.strictEqual(block, expected,
    'leg (a) [M1][M2]: the block is the heading, the sentence, the frontier entries oldest to newest ' +
    'and this run\'s entries — byte for byte, nothing else')

  // The same claim read the other way round, so a failure names what leaked.
  assert.ok(block.startsWith('\nCONTENDING TASKS:\n'), 'leg (a) [M1]: the string begins with the heading')
  assert.ok(!block.includes('task T2:'), 'leg (a) [M2]: T2 names only z.txt, so it contributes nothing')
  assert.ok(!block.includes('task B:'), 'leg (a) [M1]: B names only b.txt, so it contributes nothing')
  assert.ok(!block.includes(fx.sideCommit.slice(0, 7)), 'leg (a) [M1]: the side commit is not on the first-parent line')
  assert.ok(!block.includes('- main ' + fx.run3.sha7), 'leg (a) [M2]: run 3\'s commit is attributed, not a no-plan line')

  // The block carries no branch name, no plan path and no repository path.
  for (const forbidden of ['refs/', 'ultra/', '.ultrapowers/', 'launch.json', fx.root]) {
    assert.ok(!block.includes(forbidden),
      'leg (a) [M2]: the block carries no ' + JSON.stringify(forbidden) + ': ' + JSON.stringify(block))
  }

  fs.rmSync(fx.root, { recursive: true, force: true })
}

// ═════ leg (b) — the tag fetch is real, a missing tag degrades [M2] ═══════
{
  // (b.1) the ref is absent before the call and present after it.
  const fx = buildFixture()
  const t1 = compiledTask(PLAN_RUN3, 'T1')
  assert.equal(hasRef(fx.repo, 'refs/tags/ultra/plan/run-3'), false,
    'leg (b) [M2]: before the call the clone has no refs/tags/ultra/plan/run-3')

  const block = await contendingBlock({
    repo: fx.repo, base: fx.base, tip: fx.tip, run: RUN, path: 'a.txt',
    tasks: [TASK_A, TASK_B, TASK_C],
  })
  assert.equal(hasRef(fx.repo, 'refs/tags/ultra/plan/run-3'), true,
    'leg (b) [M2]: after the call the fetched tag ref exists in the clone')
  assert.ok(block.includes(taskEntry(3, t1)),
    'leg (b) [M2]: run 3\'s plan was read off the tag it fetched')
  fs.rmSync(fx.root, { recursive: true, force: true })
}
{
  // (b.2) the same fixture with the tag deleted from the origin: run 3's
  // entry becomes the no-plan line, and nothing throws.
  const fx = buildFixture()
  git(['push', '--quiet', 'origin', '--delete', 'refs/tags/ultra/plan/run-3'], fx.maker)
  assert.equal(hasRef(fx.origin, 'refs/tags/ultra/plan/run-3'), false,
    'leg (b) [M2]: fixture sanity — the origin no longer has the tag')

  const block = await contendingBlock({
    repo: fx.repo, base: fx.base, tip: fx.tip, run: RUN, path: 'a.txt',
    tasks: [TASK_A, TASK_B, TASK_C],
  })
  const expected =
    heading(RUN) +
    noPlanLine(fx.run3) +
    noPlanLine(fx.human) +
    noPlanLine(fx.merge) +
    noPlanLine(fx.run4) +
    taskEntry(RUN, TASK_A) +
    taskEntry(RUN, TASK_C)
  assert.strictEqual(block, expected,
    'leg (b) [M2]: a trailered commit whose tag the origin does not have contributes exactly ' +
    'one `- main <sha7> "<subject>" (<author>, no plan)` line, and the call does not throw')
  fs.rmSync(fx.root, { recursive: true, force: true })
}

// ═════ leg (c) — an untouched path, and a tasks list naming none [M3] ═════
{
  const fx = buildFixture()

  // (c.1) c.txt: no frontier commit touched it, so the block is the heading,
  // the sentence and this run's c.txt entries only.
  const untouched = await contendingBlock({
    repo: fx.repo, base: fx.base, tip: fx.tip, run: RUN, path: 'c.txt',
    tasks: [TASK_A, TASK_B, TASK_C, TASK_D],
  })
  assert.strictEqual(untouched, heading(RUN) + taskEntry(RUN, TASK_D),
    'leg (c) [M3]: a path no frontier commit touched yields the heading, the sentence and this run\'s entries only')
  assert.ok(!untouched.includes('- main '), 'leg (c) [M3]: no `- main` line for an untouched path')
  assert.ok(!untouched.includes('- run 3 '), 'leg (c) [M3]: no `- run 3` entry for an untouched path')

  // (c.2) a tasks list naming no task whose files contain the path.
  const empty = await contendingBlock({
    repo: fx.repo, base: fx.base, tip: fx.tip, run: RUN, path: 'c.txt',
    tasks: [TASK_A, TASK_B],
  })
  assert.strictEqual(empty, heading(RUN),
    'leg (c) [M3]: `tasks` naming no task whose files contain the path yields the heading and the sentence, nothing more')

  fs.rmSync(fx.root, { recursive: true, force: true })
}

// #757 Task 3 — the tag's record beside its plan
//
// M1. A frontier `Fleet-Run: <M>` commit whose tag `ultra/plan/run-<M>` carries
//     a claims-v1 `.ultrapowers/plan.md` AND, beside it, the
//     `.ultrapowers/gate-verdicts.json` signed for it, is attributed: every task
//     of that plan whose `files` name the path renders through the same entry
//     template this run's own `tasks` use — title line, newline, verbatim body
//     with its `**Proof:**` slot.
// M2. The same tag WITHOUT the record renders one `- main <sha7> "<subject>"
//     (<author>, no plan)` line, no `- run <M> ` entry, and throws nothing.
// M3. A legacy-grammar tag with no record renders what it rendered at BASE, and
//     the BASE fixture's block is the string it was.
// M4. `fleet/CONTRACT.md`'s `The two tags` bullet says the attribution needs the
//     record, and that a claims-v1 tag without it is a `no plan` line.
//
// The oracles are not this exam's paraphrase of the plans. Run 11's entry is the
// COMPILER's own output over the pinned claims-v1 corpus sample — the plan and
// the record it is signed for, `evals/fixtures/claims/plan.md` beside
// `evals/fixtures/claims/plan.gate-verdicts.json`, reached the way this file
// reaches the compiler. Run 13's is BASE's `compiledTask`. Nothing below the
// export is stubbed here either: three real tags on a real origin, and the clone
// under test is fetched `--no-tags`, so every tag the block reads it fetched.

// The claims-v1 corpus sample, from disk. `pytest.ini` keeps pytest out of
// `evals/` and nothing there is executed — these are two text files.
const CLAIMS_DIR = path.resolve(HERE, '../../evals/fixtures/claims')
const CLAIMS_PLAN = fs.readFileSync(path.join(CLAIMS_DIR, 'plan.md'), 'utf8')
const CLAIMS_RECORD = fs.readFileSync(path.join(CLAIMS_DIR, 'plan.gate-verdicts.json'), 'utf8')

// Run 13's plan, `PLAN_RUN3`'s legacy shape with T1 naming the widget module:
// it compiles with no record beside it, the way run 3's does at BASE.
const PLAN_RUN13 = [
  '# Plan: run thirteen',
  '',
  '**Acceptance:** suite — the committed suite is the verification.',
  '',
  '### Task T1: The first task of run thirteen',
  '',
  '**Type:** implementation',
  '**Review:** lean',
  '',
  '**Files:**',
  '- Modify: `widgetkit/widget.py`',
  '',
  '**Claim:** the first task of run thirteen rewrites the widget module.',
  '',
  '- [ ] rewrite the widget module',
  '',
  '### Task T2: The second task of run thirteen',
  '',
  '**Type:** implementation',
  '**Review:** lean',
  '',
  '**Files:**',
  '- Modify: `z.txt`',
  '',
  '**Claim:** the second task of run thirteen rewrites z.txt and nothing else.',
  '',
  '- [ ] rewrite z',
  '',
].join('\n')

// The oracle for an attributed claims-v1 entry: the compiler, on the plan text
// with its record laid beside it under the name the compiler looks for
// (`<stem>.gate-verdicts.json`). This is the only difference from BASE's
// `compiledTask`, and it is the whole of what M1 asks the block to do.
function compiledTaskWithRecord (planText, recordText, id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-plan-record-'))
  const planFile = path.join(dir, 'plan.md')
  const out = path.join(dir, 'launch.json')
  fs.writeFileSync(planFile, planText)
  fs.writeFileSync(path.join(dir, 'plan.gate-verdicts.json'), recordText)
  execFileSync('python3', [COMPILER, planFile, '--emit-launch', out],
    { cwd: dir, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })
  const payload = JSON.parse(fs.readFileSync(out, 'utf8'))
  fs.rmSync(dir, { recursive: true, force: true })
  const t = (payload.tasks || []).find((x) => x.id === id)
  assert.ok(t, 'fixture sanity: the compiler found task ' + id + ' in the claims-v1 plan')
  assert.ok(t.body.startsWith('### Task ' + id + ':'),
    'fixture sanity: ' + id + '\'s body is its verbatim section')
  return t
}

// A second origin, all of its own. Frontier on `main` since its base, oldest to
// newest, three commits each rewriting `widgetkit/widget.py`:
//   1. `Fleet-Run: 11` — its tag carries the claims plan AND the record
//   2. `Fleet-Run: 12` — its tag carries that same plan ALONE
//   3. `Fleet-Run: 13` — its tag carries a legacy plan, no record
// All three tags reach the origin; the clone under test fetches `--no-tags`.
function buildRecordFixture () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-block-record-'))
  const origin = path.join(root, 'origin.git')
  git(['init', '--bare', '--initial-branch=main', origin], root)

  const repo = path.join(root, 'clone-under-test')
  git(['clone', '--quiet', origin, repo], root)
  git(['config', 'user.email', 'seed@fleet.test'], repo)
  git(['config', 'user.name', 'Seed'], repo)
  fs.mkdirSync(path.join(repo, 'widgetkit'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'widgetkit', 'widget.py'), 'size = 1\n')
  fs.writeFileSync(path.join(repo, 'b.txt'), 'bee\n')
  git(['add', '-A'], repo)
  git(['commit', '--quiet', '-m', 'seed the record fixture'], repo)
  git(['push', '--quiet', 'origin', 'main'], repo)
  const base = git(['rev-parse', 'HEAD'], repo)

  const maker = path.join(root, 'frontier-maker')
  git(['clone', '--quiet', origin, maker], root)
  git(['config', 'user.email', 'bot@fleet.test'], maker)
  git(['config', 'user.name', 'Fleet Bot'], maker)

  const widgetCommit = (text, runLabel, subject) => {
    fs.writeFileSync(path.join(maker, 'widgetkit', 'widget.py'), text)
    git(['add', '-A'], maker)
    git(['commit', '--quiet', '-m', subject, '-m', 'Fleet-Run: ' + runLabel], maker)
    return git(['rev-parse', 'HEAD'], maker)
  }
  const run11 = widgetCommit('size = 11\n', '11', 'run eleven rewrites the widget module')
  const run12 = widgetCommit('size = 12\n', '12', 'run twelve rewrites the widget module')
  const run13 = widgetCommit('size = 13\n', '13', 'run thirteen rewrites the widget module')
  git(['push', '--quiet', 'origin', 'main'], maker)
  const tip = run13

  // Each tag on its own orphan commit, the way `record_tags` pushes one after
  // the merge — the same shape BASE's `makeTag` uses, with one more blob.
  const makeTag = (tag, blobs) => {
    git(['checkout', '--quiet', '--orphan', 'plan-' + tag.replace(/\W/g, '-')], maker)
    git(['rm', '-r', '--quiet', '--cached', '.'], maker)
    fs.rmSync(path.join(maker, 'widgetkit'), { recursive: true, force: true })
    fs.rmSync(path.join(maker, 'b.txt'), { force: true })
    fs.mkdirSync(path.join(maker, '.ultrapowers'), { recursive: true })
    for (const [name, text] of Object.entries(blobs)) {
      fs.writeFileSync(path.join(maker, '.ultrapowers', name), text)
    }
    git(['add', '-A'], maker)
    git(['commit', '--quiet', '-m', 'the plan of ' + tag], maker)
    git(['tag', tag], maker)
    git(['checkout', '--quiet', '--force', 'main'], maker)
  }
  makeTag('ultra/plan/run-11', { 'plan.md': CLAIMS_PLAN, 'gate-verdicts.json': CLAIMS_RECORD })
  makeTag('ultra/plan/run-12', { 'plan.md': CLAIMS_PLAN })
  makeTag('ultra/plan/run-13', { 'plan.md': PLAN_RUN13 })
  for (const n of [11, 12, 13]) {
    git(['push', '--quiet', 'origin', 'refs/tags/ultra/plan/run-' + n], maker)
  }

  // Fixture sanity: the tags carry exactly the blobs the three cases need.
  assert.equal(git(['show', 'ultra/plan/run-11:.ultrapowers/gate-verdicts.json'], maker).trim(),
    CLAIMS_RECORD.trim(), 'fixture sanity: run 11\'s tag carries the record signed for its plan')
  assert.equal(hasRef(maker, 'ultra/plan/run-12:.ultrapowers/gate-verdicts.json'), false,
    'fixture sanity: run 12\'s tag carries the plan alone')
  assert.equal(hasRef(maker, 'ultra/plan/run-13:.ultrapowers/gate-verdicts.json'), false,
    'fixture sanity: run 13\'s legacy tag carries no record')

  git(['fetch', '--quiet', '--no-tags', 'origin', 'main'], repo)
  git(['merge', '--quiet', '--ff-only', 'FETCH_HEAD'], repo)
  assert.equal(git(['rev-parse', 'HEAD'], repo), tip, 'fixture sanity: the clone under test is at the tip')
  for (const n of [11, 12, 13]) {
    assert.equal(hasRef(repo, 'refs/tags/ultra/plan/run-' + n), false,
      'fixture sanity: the clone has no plan tag before the call — every tag the block reads it fetched')
  }

  const meta = (sha) => ({
    sha,
    sha7: sha.slice(0, 7),
    subject: git(['log', '-1', '--format=%s', sha], repo),
    author: git(['log', '-1', '--format=%an', sha], repo),
  })
  return { root, origin, repo, maker, base, tip, run11: meta(run11), run12: meta(run12), run13: meta(run13) }
}

// This run's tasks for the record fixture: a `TASK_A`-shaped task naming the
// widget module, and `TASK_B`, which names only `b.txt` and so contributes
// nothing to a `widgetkit/widget.py` block.
const TASK_W = {
  id: 'W',
  title: 'The widget task',
  files: ['widgetkit/widget.py'],
  body: 'W body, first line.\nW body, second line.',
}

// ═════ legs (a)–(d) — the block over the three-tag frontier ═══════════════
{
  const fx = buildRecordFixture()

  // The oracle's premise, and the reason the fixture is the real claims-v1
  // sample: this plan does NOT compile without its record beside it. BASE's
  // `compiledTask` is exactly "compile the plan alone", so if it succeeded the
  // record would be proving nothing.
  assert.throws(() => compiledTask(CLAIMS_PLAN, '1'),
    'fixture sanity [M1]: the claims-v1 plan alone does not compile — the record is what unlocks it')
  const t1 = compiledTaskWithRecord(CLAIMS_PLAN, CLAIMS_RECORD, '1')
  assert.deepStrictEqual(t1.files, ['tests/test_widget.py', 'widgetkit/widget.py'],
    'fixture sanity [M1]: the claims fixture\'s task 1 names the path under test')
  const legacyT1 = compiledTask(PLAN_RUN13, 'T1')
  assert.deepStrictEqual(legacyT1.files, ['widgetkit/widget.py'],
    'fixture sanity [M3]: run 13\'s legacy T1 names the path under test')

  const pending = contendingBlock({
    repo: fx.repo, base: fx.base, tip: fx.tip, run: RUN, path: 'widgetkit/widget.py',
    tasks: [TASK_W, TASK_B],
  })
  // M2's "throws nothing" is this: run 12's tag has a plan that will not
  // compile, and the call still resolves.
  assert.ok(pending && typeof pending.then === 'function', 'leg (a) [M1]: contendingBlock returns a promise')
  const block = await pending
  assert.equal(typeof block, 'string', 'leg (a) [M1][M2]: it resolves a string — the uncompilable tag is not a throw')

  // ── leg (a): the whole string, byte for byte [M1][M2][M3] ──────────────
  // heading, side sentence, then the frontier oldest to newest — run 11
  // attributed through its record, run 12 a no-plan line, run 13 the legacy
  // entry — then this run's entries.
  const expected =
    heading(RUN) +
    taskEntry(11, t1) +
    noPlanLine(fx.run12) +
    taskEntry(13, legacyT1) +
    taskEntry(RUN, TASK_W)
  assert.strictEqual(block, expected,
    'leg (a) [M1][M2][M3]: the block is the heading, the side sentence, `taskEntry(11, t1)` with t1 the ' +
    'claims fixture\'s task 1 as the compiler emits it WITH the record beside the plan, then run 12\'s ' +
    'no-plan line, then the legacy run 13 entry, then this run\'s entry — byte for byte. A `planTasksFor` ' +
    'that compiles run 11\'s plan alone renders run 11 as a no-plan line, and fails here')

  // ── leg (b): the body the entry carries is the plan's own [M1] ─────────
  const entry11 = taskEntry(11, t1)
  assert.ok(block.includes(entry11),
    'leg (b) [M1]: run 11\'s entry is present, through the same template this run\'s tasks use')
  assert.ok(entry11.includes('**Proof:**'),
    'leg (b) [M1]: the run 11 entry carries the task\'s `**Proof:**` slot')
  assert.ok(entry11.includes('- Test: `tests/test_widget.py`'),
    'leg (b) [M1]: the run 11 entry carries the Proof\'s `- Test: ` line with the test path in backticks')
  assert.ok(block.includes('**Proof:**') && block.includes('- Test: `tests/test_widget.py`'),
    'leg (b) [M1]: and so does the block the brief is built from')
  // The claims plan's tasks 2 and 3 name `widgetkit/catalog.py` and
  // `widgetkit/format.py`, never the path under test: a run whose plan compiles
  // contributes the tasks that name the path and no others.
  assert.ok(!block.includes('- run 11 task 2:'),
    'leg (b) [M1]: task 2 names widgetkit/catalog.py, so it contributes nothing')
  assert.ok(!block.includes('- run 11 task 3:'),
    'leg (b) [M1]: task 3 names widgetkit/format.py, so it contributes nothing')
  assert.ok(!block.includes('widgetkit/catalog.py') && !block.includes('widgetkit/format.py'),
    'leg (b) [M1]: neither of the other two tasks\' bodies leaked into the block')

  // ── leg (c): the recordless claims-v1 tag is one `- main` line [M2] ────
  const mainLines = block.split('\n').filter((l) => l.startsWith('- main '))
  assert.deepStrictEqual(mainLines, [noPlanLine(fx.run12).slice(1)],
    'leg (c) [M2]: exactly one `- main ` line, and it is run 12\'s ' +
    '`- main <sha7> "<subject>" (<author>, no plan)` — the tag carries the plan but not its record')
  assert.ok(block.includes(noPlanLine(fx.run12)),
    'leg (c) [M2]: run 12 contributes that line and the call resolved rather than threw')
  assert.ok(!block.includes('- run 12 '),
    'leg (c) [M2]: a claims-v1 tag with no record yields no `- run 12 ` entry')
  assert.ok(!block.includes('- main ' + fx.run11.sha7),
    'leg (c) [M1]: run 11 is attributed, not a no-plan line')
  assert.ok(!block.includes('- main ' + fx.run13.sha7),
    'leg (c) [M3]: run 13 is attributed, not a no-plan line')

  // ── leg (d), first half: run 13 renders what it rendered at BASE [M3] ──
  assert.ok(block.includes(taskEntry(13, legacyT1)),
    'leg (d) [M3]: the run 13 entry\'s bytes are `taskEntry(13, compiledTask(PLAN_RUN13, \'T1\'))` — a ' +
    'legacy tag with no record still compiles, exactly as it did at BASE')
  assert.ok(!block.includes('task T2:'),
    'leg (d) [M3]: run 13\'s T2 names only z.txt, so it contributes nothing')
  assert.ok(!block.includes('task B:'),
    'leg (d) [M3]: TASK_B names only b.txt, so it contributes nothing')
  // The block still carries no branch name, no plan path and no repository path.
  for (const forbidden of ['refs/', 'ultra/', '.ultrapowers/', 'launch.json', 'gate-verdicts', fx.root]) {
    assert.ok(!block.includes(forbidden),
      'leg (d) [M1]: the block carries no ' + JSON.stringify(forbidden))
  }

  fs.rmSync(fx.root, { recursive: true, force: true })
}

// ═════ leg (d), second half — the BASE fixture's block is unchanged [M3] ══
{
  const fx = buildFixture()
  const t1 = compiledTask(PLAN_RUN3, 'T1')
  const block = await contendingBlock({
    repo: fx.repo, base: fx.base, tip: fx.tip, run: RUN, path: 'a.txt',
    tasks: [TASK_A, TASK_B, TASK_C],
  })
  assert.strictEqual(block,
    heading(RUN) +
    taskEntry(3, t1) +
    noPlanLine(fx.human) +
    noPlanLine(fx.merge) +
    noPlanLine(fx.run4) +
    taskEntry(RUN, TASK_A) +
    taskEntry(RUN, TASK_C),
    'leg (d) [M3]: the block over the BASE fixture — a run-3 legacy tag, a human commit, a merge, an ' +
    'untagged run 4 — is the string it was: the heading, `taskEntry(3, t1)`, the three no-plan lines ' +
    'and this run\'s two entries')
  fs.rmSync(fx.root, { recursive: true, force: true })
}

// ═════ leg (e) — the CONTRACT bullet [M4] ════════════════════════════════
{
  // The same reading as the Proof's `Run:`: the `The two tags` bullet, from its
  // own line up to the next `- **` bullet, flattened to one line.
  const contractPath = path.resolve(HERE, '..', 'CONTRACT.md')
  const lines = fs.readFileSync(contractPath, 'utf8').split('\n')
  const start = lines.findIndex((l) => l.startsWith('- **The two tags**'))
  assert.ok(start >= 0, 'leg (e) [M4]: fleet/CONTRACT.md has a `- **The two tags**` bullet')
  let end = start + 1
  while (end < lines.length && !lines[end].startsWith('- **')) end += 1
  const bullet = lines.slice(start, end).join(' ')

  assert.ok(bullet.includes('gate-verdicts.json'),
    'leg (e) [M4]: the `The two tags` bullet names `gate-verdicts.json` — the record a claims-v1 plan ' +
    'needs on its tag before a `Fleet-Run: <N>` frontier commit is attributed to that run\'s tasks')
  assert.match(bullet, /gate-verdicts\.json[\s\S]*no plan/,
    'leg (e) [M4]: and, after it, says a claims-v1 tag without that record is a `no plan` line — the ' +
    'Proof\'s `Run:` greps this bullet for `gate-verdicts.json.*no plan` and exits 0 only then')
}

// #754 Task 2 — exams first
//
// M1. `contendingTasks({ repo, base, tip, run, path, tasks })` resolves the
//     ordered array of `{ run, task }` entries whose bodies `contendingBlock`
//     renders for that path — the frontier plans' tasks read off their tags,
//     oldest commit first, then this run's `tasks` in their order, each
//     included exactly when its `files` name the path — and `contendingBlock`'s
//     string for the same arguments is what it was.
//
// The exam check of `fleet/publish-fold.mjs` reads the contending tasks rather
// than the rendered string, so the ordered list is a named export of this
// module; every leg below calls it over the fixtures this file already builds,
// and pins the block over the same arguments byte for byte beside it. The
// unattributable frontier commits (a human commit, a merge, an untagged run, a
// claims-v1 tag with no record) contribute `- main …` lines to the block and NO
// entry to this list — the list is tasks, and a no-plan line has none.
{
  const fx = buildFixture()
  const t1 = compiledTask(PLAN_RUN3, 'T1')
  const args = {
    repo: fx.repo, base: fx.base, tip: fx.tip, run: RUN, path: 'a.txt',
    tasks: [TASK_A, TASK_B, TASK_C],
  }

  const pending = contendingTasks({ ...args })
  assert.ok(pending && typeof pending.then === 'function',
    'leg (b) [M1]: contendingTasks returns a promise')
  const entries = await pending
  assert.ok(Array.isArray(entries),
    'leg (b) [M1]: it resolves an array — got ' + JSON.stringify(entries))
  assert.deepStrictEqual(entries.map((e) => [String(e.run), e.task && e.task.id]),
    [['3', 'T1'], ['7', 'A'], ['7', 'C']],
    'leg (b) [M1]: the frontier plan\'s task first — oldest commit first — then this run\'s ' +
    'tasks in the order `tasks` gives them, each included exactly when its `files` name a.txt: ' +
    'a list that drops the frontier entry, or orders this run\'s first, fails here — got ' +
    JSON.stringify(entries.map((e) => [e.run, e.task && e.task.id])))
  for (const k of ['id', 'title', 'files', 'body']) {
    assert.deepStrictEqual(entries[0].task[k], t1[k],
      'leg (b) [M1]: the frontier entry\'s task carries the compiler\'s own `' + k + '`')
  }
  assert.deepStrictEqual(entries[1].task, TASK_A,
    'leg (b) [M1]: and this run\'s entries carry `launch.json`\'s own task objects')
  assert.deepStrictEqual(entries[2].task, TASK_C,
    'leg (b) [M1]: … both of them, in order')

  // The block over the same arguments: what it was, byte for byte, and its
  // task entries are exactly these, in this order.
  const block = await contendingBlock({ ...args })
  assert.strictEqual(block,
    heading(RUN) +
    taskEntry(3, t1) +
    noPlanLine(fx.human) +
    noPlanLine(fx.merge) +
    noPlanLine(fx.run4) +
    taskEntry(RUN, TASK_A) +
    taskEntry(RUN, TASK_C),
    'leg (b) [M1]: `contendingBlock`\'s string for the same arguments is what it was — the same ' +
    'four-commit frontier, byte for byte, now rendered from the list')
  let at = -1
  for (const e of entries) {
    const rendered = taskEntry(e.run, e.task)
    const found = block.indexOf(rendered)
    assert.ok(found > at,
      'leg (b) [M1]: `taskEntry(' + e.run + ', ' + JSON.stringify(e.task.id) + ')` is in the ' +
      'block, after the entry before it — the block renders these bodies and in this order')
    at = found
  }

  // A path no frontier commit touched: this run's entries alone, and none at
  // all when no task names the path.
  const untouched = await contendingTasks({
    repo: fx.repo, base: fx.base, tip: fx.tip, run: RUN, path: 'c.txt',
    tasks: [TASK_A, TASK_B, TASK_C, TASK_D],
  })
  assert.deepStrictEqual(untouched.map((e) => [String(e.run), e.task.id]), [['7', 'D']],
    'leg (b) [M1]: an untouched path yields this run\'s naming tasks only — got ' +
    JSON.stringify(untouched))
  assert.deepStrictEqual(await contendingTasks({
    repo: fx.repo, base: fx.base, tip: fx.tip, run: RUN, path: 'c.txt', tasks: [TASK_A, TASK_B],
  }), [], 'leg (b) [M1]: and `tasks` naming no task whose files contain the path yields []')

  fs.rmSync(fx.root, { recursive: true, force: true })
}

{
  // The three-tag frontier: run 11 is attributed through its record, run 12's
  // recordless claims-v1 tag contributes no task, run 13's legacy tag does.
  const fx = buildRecordFixture()
  const t1 = compiledTaskWithRecord(CLAIMS_PLAN, CLAIMS_RECORD, '1')
  const legacyT1 = compiledTask(PLAN_RUN13, 'T1')
  const args = {
    repo: fx.repo, base: fx.base, tip: fx.tip, run: RUN, path: 'widgetkit/widget.py',
    tasks: [TASK_W, TASK_B],
  }

  const entries = await contendingTasks({ ...args })
  assert.deepStrictEqual(entries.map((e) => [String(e.run), e.task && e.task.id]),
    [['11', '1'], ['13', 'T1'], ['7', 'W']],
    'leg (b) [M1]: the tags are read oldest commit first, an uncompilable one contributes no ' +
    'entry rather than throwing, and this run\'s task comes last — got ' +
    JSON.stringify(entries.map((e) => [e.run, e.task && e.task.id])))
  assert.deepStrictEqual(entries[0].task.body, t1.body,
    'leg (b) [M1]: the attributed entry carries the plan\'s verbatim body, `**Proof:**` slot and ' +
    'all — which is where the exam check reads its `- Test:` bullets')
  assert.ok(entries[0].task.body.includes('- Test: `tests/test_widget.py`'),
    'leg (b) [M1]: … including that `- Test:` line')

  const block = await contendingBlock({ ...args })
  assert.strictEqual(block,
    heading(RUN) +
    taskEntry(11, t1) +
    noPlanLine(fx.run12) +
    taskEntry(13, legacyT1) +
    taskEntry(RUN, TASK_W),
    'leg (b) [M1]: and the block over the same arguments is the string it was')

  fs.rmSync(fx.root, { recursive: true, force: true })
}

console.log('ALL TESTS PASSED')
