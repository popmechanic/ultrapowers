import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { doctor } from '../doctor.mjs'

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(FLEET_DIR, '..')

const LIST_STDOUT = JSON.stringify([
  { name: 'claude-max', config_summary: 'Authorization:Bearer xyz' }
])

const keyOf = (cmd, argv = []) => [cmd, ...argv].join(' ')
const lobbyKey = (remote) => keyOf('ssh', ['exe.dev', remote])

const KNOWN = new Map([
  [lobbyKey('whoami'), { code: 1, stdout: '' }],
  [lobbyKey('billing plan --json'), { code: 1, stdout: '' }],
  [lobbyKey('integrations list --json'), { code: 0, stdout: LIST_STDOUT }],
  [lobbyKey('integrations setup github --list'), { code: 1, stdout: '' }]
])

function makeExec (usageAnswer) {
  const calls = []
  const exec = async (command, argv) => {
    const cmd = keyOf(command, argv)
    calls.push(cmd)
    if (KNOWN.has(cmd)) return KNOWN.get(cmd)
    if (cmd.includes('usage --json')) return usageAnswer
    return { code: 1, stdout: '' }
  }
  exec.calls = calls
  return exec
}

const claudeRowOf = (result) => result.rows.find((r) => r.id === 'claude')

{
  const row = {
    unread: false,
    sevenDay: { utilization: 42, resetsAt: '2026-09-30T00:00:00.000Z' },
    fiveHour: { utilization: 7, resetsAt: '2026-09-23T18:00:00.000Z' }
  }
  const exec = makeExec({ code: 0, stdout: JSON.stringify([row]) })
  const result = await doctor({ config: {}, exec, configKeys: null, account: 'acct' })

  const usageCalls = exec.calls.filter((c) => c.endsWith('usage --json --account acct --no-rotate'))
  assert.equal(
    usageCalls.length, 1,
    `(a) [M1] exactly one recorded command ends "usage --json --account acct --no-rotate" — got:\n${exec.calls.join('\n')}`
  )

  const claude = claudeRowOf(result)
  assert.ok(claude, '(a) [M1] the result carries a claude row')
  const suffix = `; 7d ${row.sevenDay.utilization}% resets ${row.sevenDay.resetsAt}` +
    `; 5h ${row.fiveHour.utilization}% resets ${row.fiveHour.resetsAt}`
  assert.ok(
    claude.detail.endsWith(suffix),
    `(a) [M1] detail ends with the window suffix — got: ${JSON.stringify(claude.detail)}, want suffix ${JSON.stringify(suffix)}`
  )
  assert.equal(claude.status, 'ok', '(a) [M1] status is ok under a bearer-carrying claude-max')
}

{
  const exec = makeExec({ code: 1, stdout: 'usage: not authorized\n' })
  const result = await doctor({ config: {}, exec, configKeys: null, account: 'acct' })
  const claude = claudeRowOf(result)
  assert.ok(
    claude.detail.endsWith('; usage unread — usage answered code 1'),
    `(b) [M2] a non-zero exit reads as "usage answered code <code>" — got: ${JSON.stringify(claude.detail)}`
  )
  assert.equal(claude.status, 'ok', '(b) [M2] status is unchanged (still ok) on a bad exit')
}
{
  const exec = makeExec({ code: 0, stdout: JSON.stringify([{ unread: true, reason: 'x' }]) })
  const result = await doctor({ config: {}, exec, configKeys: null, account: 'acct' })
  const claude = claudeRowOf(result)
  assert.ok(
    claude.detail.endsWith('; usage unread — x'),
    `(b) [M2] an unread:true row reads as its own reason — got: ${JSON.stringify(claude.detail)}`
  )
  assert.equal(claude.status, 'ok', '(b) [M2] status is unchanged (still ok) on an unread row')
}

{
  const exec = makeExec({ code: 1, stdout: '' })
  await doctor({ config: {}, exec, configKeys: null, account: null })
  const usageCalls = exec.calls.filter((c) => c.endsWith('usage --json --no-rotate'))
  assert.equal(
    usageCalls.length, 1,
    `(c) [M3] exactly one recorded command ends "usage --json --no-rotate" — got:\n${exec.calls.join('\n')}`
  )
  assert.ok(
    !usageCalls[0].includes('--account'),
    `(c) [M3] that command carries no --account — got: ${JSON.stringify(usageCalls[0])}`
  )
}

{
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'skills/ultrapowers/references/first-run.md'), 'utf8')
  const start = doc.indexOf('\n## claude\n')
  assert.ok(start !== -1, '(d) [M4] first-run.md carries a `## claude` section')
  const rest = doc.slice(start + 1)
  const next = rest.indexOf('\n## ', 1)
  const section = next === -1 ? rest : rest.slice(0, next)
  assert.ok(section.includes('seven-day'), '(d) [M4] first-run.md §claude names the seven-day reading')
}

console.log('ALL TESTS PASSED')
