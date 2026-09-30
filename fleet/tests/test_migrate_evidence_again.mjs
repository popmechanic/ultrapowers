/**
 * fleet/tests/test_migrate_evidence_again.mjs — the idempotence exam for "The
 * one-time migration copies old runs into the evidence repository" (#1395).
 *
 *   (e) [M5] a second pass over the same target pushes nothing and prints
 *       `run-3: skipped`, `run-4: skipped` and, last,
 *       `total: 0 copied, 2 skipped`; the evidence repository's refs are
 *       exactly what the first pass left.
 *
 * Both repositories are local bare repositories in a temp dir, reached through
 * the `urlFor` seam; nothing opens a socket or reads the box's own config.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { migrateEvidence } from '../migrate-evidence.mjs'
import { gitEnv } from './_lobby_helpers.mjs'

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fleet-migrate-again-test-'))

const IDENTITY = {
  GIT_AUTHOR_NAME: 'fleet tests',
  GIT_AUTHOR_EMAIL: 'fleet@example.invalid',
  GIT_COMMITTER_NAME: 'fleet tests',
  GIT_COMMITTER_EMAIL: 'fleet@example.invalid'
}

const gitIn = (cwd, argv) => {
  const res = spawnSync('git', argv, { cwd, encoding: 'utf8', env: gitEnv(IDENTITY) })
  if (res.status !== 0) throw new Error(`git ${argv.join(' ')}: ${res.stdout}${res.stderr}`)
  return res.stdout
}

const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), text)
}

const commitAll = (work, message) => {
  gitIn(work, ['add', '-A'])
  gitIn(work, ['commit', '-q', '-m', message])
}

/** A bare target: run 3 as tags only, run 4 as branches only. */
function targetRepo () {
  const bare = path.join(root, 'target.git')
  gitIn(root, ['init', '-q', '--bare', '--initial-branch=main', bare])
  const work = path.join(root, 'target')
  gitIn(root, ['init', '-q', '--initial-branch=main', work])
  write(work, 'README.md', '# target\n')
  commitAll(work, 'seed')
  gitIn(work, ['push', '-q', bare, 'HEAD:refs/heads/main'])

  write(work, '.ultrapowers/plan.md', '# plan of run 3\n')
  commitAll(work, 'plan 3')
  gitIn(work, ['tag', 'ultra/plan/run-3'])
  write(work, '.ultrapowers/runs/3/status.json', '{"state":"merged"}\n')
  write(work, '.ultrapowers/runs/3/events.jsonl', '{"e":3}\n')
  commitAll(work, 'evidence 3')
  gitIn(work, ['tag', 'ultra/evidence/run-3'])
  gitIn(work, ['push', '-q', bare, 'refs/tags/ultra/plan/run-3', 'refs/tags/ultra/evidence/run-3'])

  write(work, '.ultrapowers/plan.md', '# plan of run 4\n')
  commitAll(work, 'plan 4')
  gitIn(work, ['push', '-q', bare, 'HEAD:refs/heads/ultra/plan-run-4'])
  write(work, '.ultrapowers/runs/4/status.json', '{"state":"failed"}\n')
  write(work, '.ultrapowers/runs/4/events.jsonl', '{"e":4}\n')
  commitAll(work, 'evidence 4')
  gitIn(work, ['push', '-q', bare, 'HEAD:refs/heads/ultra/evidence-run-4'])
  return bare
}

function evidenceRepo () {
  const bare = path.join(root, 'evidence.git')
  gitIn(root, ['init', '-q', '--bare', '--initial-branch=main', bare])
  const work = path.join(root, 'evidence')
  gitIn(root, ['init', '-q', '--initial-branch=main', work])
  write(work, 'archive/README.md', '# hand archive\n')
  commitAll(work, 'archive')
  gitIn(work, ['push', '-q', bare, 'HEAD:refs/heads/main'])
  return bare
}

/** The seam: real git under the sim's environment, every call recorded. */
function makeGitExec () {
  const calls = []
  const exec = async (cmd, argv = [], options = undefined) => {
    calls.push({ cmd, argv: [...argv] })
    const extra = options?.env?.GIT_INDEX_FILE ? { GIT_INDEX_FILE: options.env.GIT_INDEX_FILE } : {}
    const res = spawnSync(cmd, argv, { encoding: 'utf8', env: gitEnv({ ...IDENTITY, ...extra }) })
    return { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
  }
  exec.calls = calls
  return exec
}

try {
  const target = targetRepo()
  const evidence = evidenceRepo()
  const urlFor = (repo) => ({ 'o/r': target, 'ops/evidence': evidence })[repo]
  const quiet = () => {}

  const first = await migrateEvidence({ exec: makeGitExec(), target: 'o/r', evidence: 'ops/evidence', urlFor, print: quiet })
  assert.equal(first.lines.at(-1), 'total: 2 copied, 0 skipped', '(e) [M5] the first pass copies both runs')
  const refsAfterFirst = gitIn(root, ['ls-remote', evidence])

  const exec = makeGitExec()
  const second = await migrateEvidence({ exec, target: 'o/r', evidence: 'ops/evidence', urlFor, print: quiet })
  assert.deepEqual(second.lines, ['run-3: skipped', 'run-4: skipped', 'total: 0 copied, 2 skipped'], '(e) [M5] the lines')
  assert.equal(second.copied, 0, '(e) [M5] copied is 0')
  assert.equal(second.skipped, 2, '(e) [M5] skipped is 2')
  assert.deepEqual(exec.calls.filter((c) => c.argv.includes('push')), [], '(e) [M5] the second pass pushes nothing')
  assert.deepEqual(exec.calls.filter((c) => c.argv.includes('fetch')), [], '(e) [M5] the second pass fetches nothing')
  assert.equal(gitIn(root, ['ls-remote', evidence]), refsAfterFirst, '(e) [M5] the evidence refs are as the first pass left them')

  console.log('ALL TESTS PASSED')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
