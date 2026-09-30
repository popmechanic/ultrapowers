/**
 * fleet/tests/test_migrate_evidence.mjs — the exam for "The one-time migration
 * copies old runs into the evidence repository" (#1395).
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] over a target `o/r` holding run 3 as tags only and run 4 as
 *       branches only, the tool pushes `o-r/run-3` and `o-r/run-4` to
 *       `ops/evidence`, each a parentless commit whose tree is exactly
 *       `runs/o-r/<N>/` with `plan.md`, `status.json` and `events.jsonl`
 *       byte-equal to the target's, and prints the two copied lines and the
 *       total last.
 *   (b) [M2] the target's `ls-remote` and the evidence `main` are unchanged.
 *   (c) [M3] a target with no `ultra/` ref prints the zero total.
 *   (d) [M4] `--dry-run` pushes nothing and says `would copy`.
 *   (f) [M6] the CLI with no `--evidence-repo` and a config lacking
 *       `evidence` exits 2 naming the key, having run no `git`.
 *
 * Both repositories are local bare repositories in a temp dir, reached through
 * the `urlFor` seam; nothing opens a socket or reads the box's own config.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { migrateEvidence } from '../migrate-evidence.mjs'
import { simEnv } from './_helpers.mjs'
import { gitEnv } from './_lobby_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOL = path.join(HERE, '..', 'migrate-evidence.mjs')
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fleet-migrate-evidence-test-'))

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
  return gitIn(work, ['rev-parse', 'HEAD']).trim()
}

/** A bare target: run 3 as tags only, run 4 as branches only (or nothing). */
function targetRepo (name, { runs = true } = {}) {
  const bare = path.join(root, `${name}.git`)
  gitIn(root, ['init', '-q', '--bare', '--initial-branch=main', bare])
  const work = path.join(root, name)
  gitIn(root, ['init', '-q', '--initial-branch=main', work])
  write(work, 'README.md', '# target\n')
  commitAll(work, 'seed')
  gitIn(work, ['push', '-q', bare, 'HEAD:refs/heads/main'])
  if (!runs) return bare

  write(work, '.ultrapowers/plan.md', '# plan of run 3\n')
  write(work, 'src/app.js', 'export const app = 3\n')
  commitAll(work, 'plan 3')
  gitIn(work, ['tag', 'ultra/plan/run-3'])
  write(work, '.ultrapowers/runs/3/status.json', '{"state":"merged","run":3}\n')
  write(work, '.ultrapowers/runs/3/events.jsonl', '{"e":1}\n{"e":2}\n')
  write(work, '.ultrapowers/runs/2/status.json', '{"state":"old"}\n')
  commitAll(work, 'evidence 3')
  gitIn(work, ['tag', '-a', '-m', 'evidence 3', 'ultra/evidence/run-3'])
  gitIn(work, ['push', '-q', bare, 'refs/tags/ultra/plan/run-3', 'refs/tags/ultra/evidence/run-3'])

  gitIn(work, ['checkout', '-q', 'main'])
  write(work, '.ultrapowers/plan.md', '# plan of run 4\n\nwith more\n')
  commitAll(work, 'plan 4')
  gitIn(work, ['push', '-q', bare, 'HEAD:refs/heads/ultra/plan-run-4'])
  write(work, '.ultrapowers/runs/4/status.json', '{"state":"failed","run":4}\n')
  write(work, '.ultrapowers/runs/4/events.jsonl', '{"e":"four"}\n')
  commitAll(work, 'evidence 4')
  gitIn(work, ['push', '-q', bare, 'HEAD:refs/heads/ultra/evidence-run-4'])
  return bare
}

/** A bare evidence repository whose `main` holds a hand archive. */
function evidenceRepo (name) {
  const bare = path.join(root, `${name}.git`)
  gitIn(root, ['init', '-q', '--bare', '--initial-branch=main', bare])
  const work = path.join(root, name)
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
  exec.pushes = () => calls.filter((c) => c.argv.includes('push'))
  return exec
}

const urlsFor = (map) => (repo) => {
  assert.ok(repo in map, `urlFor asked for an unknown repository ${repo}`)
  return map[repo]
}

const quiet = () => {}

try {
  // (a) [M1] and (b) [M2]
  const target = targetRepo('target')
  const evidence = evidenceRepo('evidence')
  const urlFor = urlsFor({ 'o/r': target, 'ops/evidence': evidence })
  const listingBefore = gitIn(root, ['ls-remote', target])
  const mainBefore = gitIn(evidence, ['rev-parse', 'refs/heads/main']).trim()

  // (d) [M4] first, so the real pass below starts from an untouched evidence repository
  const dryExec = makeGitExec()
  const dry = await migrateEvidence({ exec: dryExec, target: 'o/r', evidence: 'ops/evidence', dryRun: true, urlFor, print: quiet })
  assert.deepEqual(dryExec.pushes(), [], '(d) [M4] a dry run pushes nothing')
  assert.ok(dry.lines.includes('run-3: would copy'), '(d) [M4] the dry run says run-3: would copy')
  assert.equal(gitIn(evidence, ['tag', '-l']).trim(), '', '(d) [M4] no tag in the evidence repository after a dry run')

  const exec = makeGitExec()
  const result = await migrateEvidence({ exec, target: 'o/r', evidence: 'ops/evidence', urlFor, print: quiet })
  assert.deepEqual(result.lines, ['run-3: copied', 'run-4: copied', 'total: 2 copied, 0 skipped'], '(a) [M1] the lines')
  assert.equal(result.copied, 2, '(a) [M1] copied is 2')
  assert.equal(result.skipped, 0, '(a) [M1] skipped is 0')
  assert.equal(result.lines.at(-1), 'total: 2 copied, 0 skipped', '(a) [M1] the total is last')

  assert.deepEqual(gitIn(evidence, ['tag', '-l']).trim().split('\n'), ['o-r/run-3', 'o-r/run-4'], '(a) [M1] exactly the two tags')
  const sources = {
    3: { plan: 'refs/tags/ultra/plan/run-3', evidence: 'refs/tags/ultra/evidence/run-3' },
    4: { plan: 'refs/heads/ultra/plan-run-4', evidence: 'refs/heads/ultra/evidence-run-4' }
  }
  for (const run of [3, 4]) {
    const tag = `refs/tags/o-r/run-${run}`
    assert.equal(gitIn(evidence, ['cat-file', '-t', tag]).trim(), 'commit', `(a) [M1] ${tag} is a commit`)
    const parents = gitIn(evidence, ['rev-list', '--parents', '-n', '1', tag]).trim().split(' ')
    assert.equal(parents.length, 1, `(a) [M1] ${tag} has no parent`)
    const tree = gitIn(evidence, ['ls-tree', '-r', '--name-only', tag]).trim().split('\n').sort()
    assert.deepEqual(tree, [`runs/o-r/${run}/events.jsonl`, `runs/o-r/${run}/plan.md`, `runs/o-r/${run}/status.json`],
      `(a) [M1] ${tag}'s tree is exactly runs/o-r/${run}/`)
    const pairs = [
      ['plan.md', `${sources[run].plan}^{commit}:.ultrapowers/plan.md`],
      ['status.json', `${sources[run].evidence}^{commit}:.ultrapowers/runs/${run}/status.json`],
      ['events.jsonl', `${sources[run].evidence}^{commit}:.ultrapowers/runs/${run}/events.jsonl`]
    ]
    for (const [file, source] of pairs) {
      const copied = gitIn(evidence, ['cat-file', 'blob', `${tag}:runs/o-r/${run}/${file}`])
      const original = gitIn(target, ['cat-file', 'blob', source])
      assert.equal(copied, original, `(a) [M1] run ${run}'s ${file} is byte-equal to the target's`)
    }
    const message = gitIn(evidence, ['log', '-1', '--format=%s', tag]).trim()
    assert.match(message, new RegExp(`^ultrapowers evidence o/r run-${run} \\(migrated from ultra/evidence[/-]run-${run}\\)$`),
      `(a) [M1] ${tag}'s message`)
  }

  // (b) [M2]
  assert.equal(gitIn(root, ['ls-remote', target]), listingBefore, '(b) [M2] the target listing is unchanged')
  assert.equal(gitIn(evidence, ['rev-parse', 'refs/heads/main']).trim(), mainBefore, '(b) [M2] the evidence main has not moved')
  assert.deepEqual(gitIn(evidence, ['for-each-ref', '--format=%(refname)', 'refs/heads']).trim().split('\n'), ['refs/heads/main'],
    '(b) [M2] no branch written in the evidence repository')

  // (c) [M3]
  const bareTarget = targetRepo('plain', { runs: false })
  const emptyExec = makeGitExec()
  const zero = await migrateEvidence({
    exec: emptyExec,
    target: 'o/r',
    evidence: 'ops/evidence',
    urlFor: urlsFor({ 'o/r': bareTarget, 'ops/evidence': evidenceRepo('evidence-empty') }),
    print: quiet
  })
  assert.deepEqual(zero.lines, ['total: 0 copied, 0 skipped'], '(c) [M3] the zero total')
  assert.deepEqual(emptyExec.pushes(), [], '(c) [M3] nothing pushed')
  const cliHome = fs.mkdtempSync(path.join(root, 'home-'))
  const cliConfig = path.join(cliHome, 'fleet.json')
  fs.writeFileSync(cliConfig, JSON.stringify({ evidence: 'ops/evidence' }))
  const bareUrl = `file://${bareTarget}`
  // The CLI reaches github.com URLs; a url rewrite in its own HOME points both at the bare repos.
  fs.writeFileSync(path.join(cliHome, '.gitconfig'),
    `[url "${bareUrl}"]\n\tinsteadOf = https://github.com/o/r.git\n` +
    `[url "file://${evidenceRepo('evidence-cli')}"]\n\tinsteadOf = https://github.com/ops/evidence.git\n`)
  const zeroCli = spawnSync(process.execPath, [TOOL, '--target', 'o/r', '--config', cliConfig], {
    encoding: 'utf8', env: simEnv({ home: cliHome })
  })
  assert.equal(zeroCli.status, 0, `(c) [M3] the CLI exits 0 on an empty target: ${zeroCli.stderr}`)
  assert.equal(zeroCli.stdout.trim().split('\n').at(-1), 'total: 0 copied, 0 skipped', '(c) [M3] the CLI prints the zero total')

  // (f) [M6]
  const bin = fs.mkdtempSync(path.join(root, 'bin-'))
  const marker = path.join(root, 'git-ran')
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$@" >> '${marker}'\nexit 0\n`, { mode: 0o755 })
  const bareHome = fs.mkdtempSync(path.join(root, 'home-'))
  const noKey = path.join(bareHome, 'fleet.json')
  fs.writeFileSync(noKey, JSON.stringify({ pool: 'somewhere' }))
  const refused = spawnSync(process.execPath, [TOOL, '--target', 'o/r', '--config', noKey], {
    encoding: 'utf8', env: simEnv({ bin, home: bareHome })
  })
  assert.equal(refused.status, 2, `(f) [M6] exit 2 with no evidence repository: ${refused.stdout}${refused.stderr}`)
  assert.match(refused.stderr, /evidence/, '(f) [M6] the refusal names `evidence`')
  assert.equal(fs.existsSync(marker), false, '(f) [M6] no git ran')

  console.log('ALL TESTS PASSED')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
