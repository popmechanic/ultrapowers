/**
 * fleet/tests/test_lobby_evidence_refs.mjs — the exam for "The evidence setting
 * and ref names, in one place" (#1395).
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (d) [M4] `highestRunInEvidence` over a real local bare evidence repository
 *       holding `refs/tags/o-r/run-4`, `refs/heads/live/o-r/run-6` and
 *       `refs/tags/o-x/run-9` answers 6 for `o/r`; over one holding no `o-r`
 *       ref it answers 0; a non-zero `ls-remote` throws a `Refusal` naming
 *       the command.
 *   (e) [M5] `readEvidenceSetting({ path })` answers `ops/evidence` for a file
 *       carrying the key, and null for an absent file and a file without it.
 *
 * The seam rewrites the `https://github.com/…` URL to the local bare path, so
 * the listing is real git and no socket is opened.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { Refusal, highestRunInEvidence, readEvidenceSetting } from '../lobby.mjs'
import { cleanup, gitEnv, makeExec, tempDir } from './_lobby_helpers.mjs'

const root = tempDir('fleet-evidence-refs-')

const gitIn = (cwd, argv) => {
  const res = spawnSync('git', argv, { cwd, encoding: 'utf8', env: gitEnv() })
  if (res.status !== 0) throw new Error(`git ${argv.join(' ')}: ${res.stdout}${res.stderr}`)
  return res.stdout.trim()
}

/** A bare evidence repository holding one commit under each of `refs`. */
function evidenceRepo (name, refs) {
  const bare = path.join(root, `${name}.git`)
  gitIn(root, ['init', '--bare', '--initial-branch=main', bare])
  const work = path.join(root, name)
  gitIn(root, ['init', '--initial-branch=main', work])
  gitIn(work, ['config', 'user.email', 'fleet@example.invalid'])
  gitIn(work, ['config', 'user.name', 'fleet tests'])
  fs.writeFileSync(path.join(work, 'README.md'), '# evidence\n')
  gitIn(work, ['add', '-A'])
  gitIn(work, ['commit', '-m', 'seed'])
  gitIn(work, ['push', bare, 'HEAD:refs/heads/main', ...refs.map((ref) => `HEAD:${ref}`)])
  return bare
}

/** The seam: every `https://github.com/ops/evidence.git` becomes `bare`. */
const localExec = (bare) => makeExec({
  rules: [{
    when: (cmd) => cmd === 'git',
    answer: (cmd, argv) => {
      const res = spawnSync('git', argv.map((a) => (a === 'https://github.com/ops/evidence.git' ? bare : a)), {
        encoding: 'utf8', env: gitEnv()
      })
      return { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
    }
  }],
  passthrough: []
})

try {
  // (d) [M4]
  const full = evidenceRepo('full', ['refs/tags/o-r/run-4', 'refs/heads/live/o-r/run-6', 'refs/tags/o-x/run-9'])
  const fullExec = localExec(full)
  assert.equal(await highestRunInEvidence(fullExec, root, 'ops/evidence', 'o/r'), 6, '(d) [M4] highest o/r run is 6')
  assert.ok(fullExec.calls.some((c) => c.argv.includes('ls-remote') && c.argv.includes('https://github.com/ops/evidence.git')),
    '(d) [M4] one ls-remote against the evidence URL')

  const empty = evidenceRepo('empty', ['refs/tags/o-x/run-9'])
  assert.equal(await highestRunInEvidence(localExec(empty), root, 'ops/evidence', 'o/r'), 0, '(d) [M4] no o-r ref answers 0')

  const failing = makeExec({ rules: [{ when: () => true, answer: { code: 128, stdout: '', stderr: 'fatal: no\n' } }], passthrough: [] })
  let error = null
  try {
    await highestRunInEvidence(failing, root, 'ops/evidence', 'o/r')
  } catch (e) {
    error = e
  }
  assert.ok(error instanceof Refusal, '(d) [M4] a failed listing is a Refusal')
  assert.match(error.message, /git ls-remote https:\/\/github\.com\/ops\/evidence\.git/, '(d) [M4] the refusal names the command')

  // (e) [M5]
  const withKey = path.join(root, 'with.json')
  fs.writeFileSync(withKey, JSON.stringify({ evidence: 'ops/evidence' }))
  const withoutKey = path.join(root, 'without.json')
  fs.writeFileSync(withoutKey, JSON.stringify({ cpu: '8' }))
  assert.equal(await readEvidenceSetting({ path: withKey }), 'ops/evidence', '(e) [M5] the key is read')
  assert.equal(await readEvidenceSetting({ path: path.join(root, 'absent.json') }), null, '(e) [M5] no file is null')
  assert.equal(await readEvidenceSetting({ path: withoutKey }), null, '(e) [M5] no key is null')
} finally {
  cleanup(root)
}

console.log('ALL TESTS PASSED')
