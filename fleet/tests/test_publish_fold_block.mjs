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

import { contendingBlock } from '../publish-fold-block.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const COMPILER = path.resolve(HERE, '../../skills/ultrapowers/scripts/compile_plan.py')

// Deterministic commit metadata: identical dates keep the first-parent order
// the only thing that orders the frontier.
const ENV = {
  ...process.env,
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
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
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

console.log('ALL TESTS PASSED')
