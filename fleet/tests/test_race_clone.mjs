// fleet/tests/test_race_clone.mjs — #511 task 3: the clone seam.
//
// The defect this suite makes inexpressible, found twice on 2026-09-01 (the
// run-47 review and the race-48-c critic): `git clone` of a LOCAL path sets the
// clone's `remote.origin.url` to that path, so a drive's publish leg (`git push
// origin …` from repoDir, then `gh pr create` with cwd repoDir) pushes nowhere
// real. Every attempt must build from the exact raced commit AND be able to
// publish like a normal run — so the launch checkout's origin is read first, a
// filesystem one is refused BEFORE any clone, and every clone is re-pointed at
// it.
//
// All git goes through one injected runner, so these legs need no repository:
// they assert the recorded argv sequence. The single live call is
// `gitRunner(['--version'])`, on the git the suite already needs.
import assert from 'node:assert/strict'
import {
  gitRunner,
  baseCommitOf,
  originUrlOf,
  cloneAtCommit,
  resolvePlan,
} from '../race-clone.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

// A recording git stub: every call is appended verbatim, and `reply` decides
// what that call resolves (or rejects) with.
const recordingGit = (reply = () => '') => {
  const calls = []
  const git = async (args, opts = {}) => {
    calls.push({ args: [...args], cwd: opts.cwd ?? null })
    return reply(args, calls.length)
  }
  git.calls = calls
  return git
}

const SHA = 'a'.repeat(40)
const ORIGIN = 'https://github.com/x/y.git'

// (a) cloneAtCommit records exactly three calls, in order.
{
  const git = recordingGit()
  await cloneAtCommit({
    git,
    sourceRepo: '/home/exedev/repo',
    repoDir: '/tmp/race-1/repo',
    baseCommit: SHA,
    originUrl: ORIGIN,
  })
  assert.deepEqual(git.calls, [
    { args: ['clone', '/home/exedev/repo', '/tmp/race-1/repo'], cwd: null },
    { args: ['checkout', '--detach', SHA], cwd: '/tmp/race-1/repo' },
    { args: ['remote', 'set-url', 'origin', ORIGIN], cwd: '/tmp/race-1/repo' },
  ])
  ok('cloneAtCommit: clone, detached checkout, remote set-url origin — in that order')
}

// (a, cont.) no call after a failing clone.
{
  const git = recordingGit((args) => {
    if (args[0] === 'clone') throw new Error('fatal: destination path exists')
    return ''
  })
  await assert.rejects(
    cloneAtCommit({
      git,
      sourceRepo: '/home/exedev/repo',
      repoDir: '/tmp/race-1/repo',
      baseCommit: SHA,
      originUrl: ORIGIN,
    }),
    /destination path exists/,
  )
  assert.equal(git.calls.length, 1)
  assert.deepEqual(git.calls[0].args, ['clone', '/home/exedev/repo', '/tmp/race-1/repo'])
  ok('cloneAtCommit: a failing clone stops the sequence — no checkout, no set-url')
}

// (b) originUrlOf returns the trimmed https remote.
{
  const git = recordingGit(() => `${ORIGIN}\n`)
  assert.equal(await originUrlOf(git, '/home/exedev/repo'), ORIGIN)
  assert.deepEqual(git.calls, [
    { args: ['config', '--get', 'remote.origin.url'], cwd: '/home/exedev/repo' },
  ])
  ok('originUrlOf: returns the trimmed origin URL')
}

// (c) originUrlOf throws — naming `origin` — for an empty remote and for the
// two filesystem shapes, and nothing clones.
{
  for (const stdout of ['', '   \n', '/home/exedev/repo\n', 'file:///home/exedev/repo\n']) {
    const git = recordingGit(() => stdout)
    await assert.rejects(originUrlOf(git, '/home/exedev/repo'), (error) => {
      assert.match(error.message, /origin/)
      return true
    }, `expected a refusal for ${JSON.stringify(stdout)}`)
    assert.equal(git.calls.filter((c) => c.args[0] === 'clone').length, 0)
  }
  ok('originUrlOf: refuses an empty, /-rooted, or file:// origin — before any clone')
}

// (c, cont.) a git that fails outright is the same refusal, not a crash.
{
  const git = recordingGit(() => {
    throw new Error('fatal: not a git repository')
  })
  await assert.rejects(originUrlOf(git, '/nope'), /origin/)
  ok('originUrlOf: a git that cannot answer is refused as a missing origin')
}

// (d) baseCommitOf returns the 40-hex HEAD, and refuses anything else.
{
  const git = recordingGit(() => `${SHA}\n`)
  assert.equal(await baseCommitOf(git, '/home/exedev/repo'), SHA)
  assert.deepEqual(git.calls, [
    { args: ['rev-parse', 'HEAD'], cwd: '/home/exedev/repo' },
  ])
  ok('baseCommitOf: returns the trimmed 40-hex HEAD')
}
{
  for (const stdout of ['HEAD\n', 'a'.repeat(39), 'a'.repeat(41), 'z'.repeat(40), '']) {
    const git = recordingGit(() => stdout)
    await assert.rejects(baseCommitOf(git, '/home/exedev/repo'), /40-hex/, `expected a refusal for ${JSON.stringify(stdout)}`)
  }
  ok('baseCommitOf: a non-40-hex reply is refused')
}

// (e) resolvePlan mirrors driveOne's repo-path rule, before any raceId burns.
{
  assert.equal(resolvePlan('/r', 'docs/plan.md'), 'docs/plan.md')
  assert.equal(resolvePlan('/r', '/r/docs/plan.md'), 'docs/plan.md')
  ok('resolvePlan: relative and in-repo absolute both resolve repo-relative')
}
{
  for (const planPath of ['../x.md', '/elsewhere/x.md']) {
    assert.throws(() => resolvePlan('/r', planPath), /repo-path guard/, `expected a refusal for ${planPath}`)
  }
  ok('resolvePlan: a path outside the repo fails the repo-path guard')
}

// (f) the default runner is the real git — the one live call.
{
  const out = await gitRunner(['--version'])
  assert.equal(typeof out, 'string')
  assert.ok(out.startsWith('git version'), `expected a git version banner, got ${JSON.stringify(out)}`)
  ok('gitRunner: the default runner shells out to the real git')
}

console.log(`\nALL TESTS PASSED (${passed})`)
