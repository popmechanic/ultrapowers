/**
 * A stories-v1 plan with a `## Numbers` section is refused at launch, before
 * the compiler runs: the fleet has no Numbers checker yet (story-planning,
 * after sub-project 2). A stories-v1 plan without one is not refused by this
 * gate — its probes are read by factory/stack/tinyapp/check.ts, the
 * state-probe runner that landed 2026-09-27.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { launch } from '../launch.mjs'
import { defaultExec } from '../lobby.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown, vmsPayload
} from './_lobby_helpers.mjs'

const root = tempDir('stories-')
const repo = makeTargetRepo({ root, files: { 'README.md': 'x\n' } })
repo.git(['remote', 'set-url', 'origin', 'https://github.com/o/r.git'])
fs.writeFileSync(path.join(repo.dir, 'p.md'),
  '# todos\n\n**Grammar:** stories-v1\n**Stack:** tinyapp\n**Plan-id:** p1\n\n## Numbers\n\nsome numbers section\n')
const exec = makeExec({
  rules: [
    { when: (c, a) => c === 'git' && (a.includes('push') || a.includes('ls-remote') || a.includes('fetch')),
      answer: (c, a, o) => defaultExec('git', a.map((x) => x === 'origin' ? repo.origin : x), o || {}) },
    sshRule('help ', () => answer('Command: x\n\nOptions:\n')),
    sshRule('integrations list --json', answer([{ name: 'gh-o-r', attachments: [] }, { name: 'cloudflare', attachments: [] }])),
    sshRule('billing plan --json', answer({ max_cpus: 16, max_memory_gb: 64 })),
    sshRule('ls ', vmsPayload([]))
  ]
})
const err = await thrown(() => launch({
  argv: ['p.md', '--target', 'o/r', '--base', repo.base, '--repo', repo.dir, '--engine', 'd'.repeat(40)],
  exec,
  config: { cpu: '2', memory: '4GB' },
  now: () => new Date('2026-09-27T12:00:00Z'),
  sleep: async () => {},
  refreshCredential: () => ({ ok: true }),
  readUsage: () => ({ unread: true, reason: 'sim' }),
  kata: null
}))
cleanup(root)
assert.ok(err !== null, 'launch must refuse a stories-v1 plan with a Numbers section')
assert.equal(err.exitCode, 2)
assert.match(String(err.message), /has a Numbers section; the fleet has no Numbers checker yet/)
assert.ok(!exec.calls.some((c) => /python3/.test(c.line)), 'the plan is never compiled')

// A claims-v1 plan that merely quotes `**Grammar:** stories-v1` inside a
// fenced example is not refused with the stories message — the launcher
// reads the plan header's own Grammar line, not any occurrence in the body.
const root2 = tempDir('stories-fenced-')
const repo2 = makeTargetRepo({ root: root2, files: { 'README.md': 'x\n' } })
repo2.git(['remote', 'set-url', 'origin', 'https://github.com/o/r.git'])
fs.writeFileSync(path.join(repo2.dir, 'p2.md'),
  [
    '# todos',
    '',
    '**Grammar:** claims-v1',
    '**Plan-id:** p1',
    '',
    'Example of a stories-v1 header, quoted for illustration:',
    '',
    '```',
    '**Grammar:** stories-v1',
    '```',
    '',
    '### Task 1: nothing',
    ''
  ].join('\n'))
const exec2 = makeExec({
  rules: [
    { when: (c, a) => c === 'git' && (a.includes('push') || a.includes('ls-remote') || a.includes('fetch')),
      answer: (c, a, o) => defaultExec('git', a.map((x) => x === 'origin' ? repo2.origin : x), o || {}) },
    sshRule('help ', () => answer('Command: x\n\nOptions:\n')),
    sshRule('integrations list --json', answer([{ name: 'gh-o-r', attachments: [] }, { name: 'cloudflare', attachments: [] }])),
    sshRule('billing plan --json', answer({ max_cpus: 16, max_memory_gb: 64 })),
    sshRule('ls ', vmsPayload([]))
  ]
})
const err2 = await thrown(() => launch({
  argv: ['p2.md', '--target', 'o/r', '--base', repo2.base, '--repo', repo2.dir, '--engine', 'd'.repeat(40)],
  exec: exec2,
  config: { cpu: '2', memory: '4GB' },
  now: () => new Date('2026-09-27T12:00:00Z'),
  sleep: async () => {},
  refreshCredential: () => ({ ok: true }),
  readUsage: () => ({ unread: true, reason: 'sim' }),
  kata: null
}))
cleanup(root2)
if (err2 !== null) {
  assert.doesNotMatch(String(err2.message), /is a stories-v1 plan/,
    'a fenced Grammar: stories-v1 example must not trip the stories refusal')
}

// A stories-v1 plan WITHOUT a Numbers section is not refused by this gate —
// any error it hits further downstream must not mention stories-v1 or Numbers.
const root3 = tempDir('stories-no-numbers-')
const repo3 = makeTargetRepo({ root: root3, files: { 'README.md': 'x\n' } })
repo3.git(['remote', 'set-url', 'origin', 'https://github.com/o/r.git'])
fs.writeFileSync(path.join(repo3.dir, 'p3.md'),
  '# todos\n\n**Grammar:** stories-v1\n**Stack:** tinyapp\n**Plan-id:** p1\n')
const exec3 = makeExec({
  rules: [
    { when: (c, a) => c === 'git' && (a.includes('push') || a.includes('ls-remote') || a.includes('fetch')),
      answer: (c, a, o) => defaultExec('git', a.map((x) => x === 'origin' ? repo3.origin : x), o || {}) },
    sshRule('help ', () => answer('Command: x\n\nOptions:\n')),
    sshRule('integrations list --json', answer([{ name: 'gh-o-r', attachments: [] }, { name: 'cloudflare', attachments: [] }])),
    sshRule('billing plan --json', answer({ max_cpus: 16, max_memory_gb: 64 })),
    sshRule('ls ', vmsPayload([]))
  ]
})
const err3 = await thrown(() => launch({
  argv: ['p3.md', '--target', 'o/r', '--base', repo3.base, '--repo', repo3.dir, '--engine', 'd'.repeat(40)],
  exec: exec3,
  config: { cpu: '2', memory: '4GB' },
  now: () => new Date('2026-09-27T12:00:00Z'),
  sleep: async () => {},
  refreshCredential: () => ({ ok: true }),
  readUsage: () => ({ unread: true, reason: 'sim' }),
  kata: null
}))
cleanup(root3)
if (err3 !== null) {
  assert.doesNotMatch(String(err3.message), /stories-v1|Numbers/,
    'a stories-v1 plan without a Numbers section must not be refused by the stories/Numbers gate')
}

console.log('ALL TESTS PASSED')
