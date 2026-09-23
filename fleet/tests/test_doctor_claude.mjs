/**
 * fleet/tests/test_doctor_claude.mjs — the exam for "The doctor's claude row
 * carries the window reading" (#1114 desired state 3).
 *
 * `doctor()` gains one more read beside the token status read: the same
 * `claude-token.mjs` tool invoked `usage --json --no-rotate` (plus
 * `--account <account>` when one is configured), whose first row answers the
 * account's seven-day and five-hour usage windows. `claudeRow` appends that
 * reading to the `claude` row's `detail` — after the existing
 * "`claude-max` carries the bearer at the edge; <token status>" text — in
 * both the `ok` and `missing` outcomes, and leaves `status` exactly as it was
 * decided before this read existed (a bearer-carrying `claude-max` in
 * `integrations list --json` is `ok`).
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] with `account: 'acct'` and the usage command answered with one
 *       `unread: false` row: exactly one recorded command ends
 *       `usage --json --account acct --no-rotate`, and the `claude` row's
 *       `detail` ends with the four-value window suffix built from that row,
 *       `status` `ok` under a bearer-carrying `claude-max`.
 *   (b) [M2] the usage command answered with a non-zero code: `detail` ends
 *       `; usage unread — usage answered code 1`; answered with a row
 *       `{ unread: true, reason: 'x' }`: `detail` ends
 *       `; usage unread — x`. Both `status` `ok`.
 *   (c) [M3] with `account` null, the recorded command ends
 *       `usage --json --no-rotate` and carries no `--account`.
 *   (d) [M4] `skills/ultrapowers/references/first-run.md` §claude says the
 *       row carries the two window readings and that a read never rotates
 *       the token, checked with the task's own `Run:` guard.
 *
 * (a)-(c) drive `doctor({ config, exec, configKeys, account })` in-process,
 * over a stub `exec` keyed on the exact command string for every other read
 * `doctor()` issues (read straight off `fleet/doctor.mjs`'s own `READS` and
 * `policyRead`/`policyNames`), answering `integrations list --json` with a
 * `claude-max` entry that carries the bearer (so the `claude` row's `status`
 * is `ok` before this read exists) and everything unmatched — including every
 * `help <verb>` read `verb-drift` issues — with `{ code: 1, stdout: '' }`.
 * Only the other rows' statuses are left unasserted, per the task's own
 * instruction; `claudeRow`'s `status` is asserted directly because M1/M2 both
 * turn on it staying unchanged.
 *
 * The exam assumes `doctor.mjs` is changed exactly as the task's Context
 * describes: one more read (`READS.usage`, the same account-suffix rule as
 * the token read) threaded into `claudeRow` as a third argument, and that the
 * account suffix (when present) does not simply get appended after
 * `--no-rotate` — M1's exact wording, `--account acct --no-rotate`, is
 * asserted by string suffix rather than assumed from the Context's looser
 * "plus `--account <wantAccount>`" phrasing.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { doctor } from '../doctor.mjs'

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(FLEET_DIR, '..')

// ── the exec stub every leg shares ──────────────────────────────────────────

/** `integrations list --json`: one entry, `claude-max`, carrying the bearer —
 *  so the `claude` row's `status` is `ok` under every leg, letting M1/M2's
 *  "status is unchanged" claim be checked directly. */
const LIST_STDOUT = JSON.stringify([
  { name: 'claude-max', config_summary: 'Authorization:Bearer xyz' }
])

const KNOWN = new Map([
  ['ssh exe.dev whoami', { code: 1, stdout: '' }],
  ['ssh exe.dev "billing plan --json"', { code: 1, stdout: '' }],
  ['ssh exe.dev "integrations list --json"', { code: 0, stdout: LIST_STDOUT }],
  ['ssh exe.dev "integrations setup github --list"', { code: 1, stdout: '' }],
  ['ssh exe.dev "integrations policy get claude-max --json"', { code: 1, stdout: '' }],
  ['ssh exe.dev "integrations policy get kata --json"', { code: 1, stdout: '' }],
  ['ssh exe.dev "ls kata-hub --json"', { code: 1, stdout: '' }]
])

/**
 * Builds an `exec` stub recording every command it is asked, answering the
 * known reads above, answering any command containing `usage --json` with
 * `usageAnswer`, and answering everything else — the token/accounts reads and
 * every `verb-drift` `help <verb>` read included — with `{ code: 1, stdout: '' }`.
 */
function makeExec (usageAnswer) {
  const calls = []
  const exec = async (cmd) => {
    calls.push(cmd)
    if (KNOWN.has(cmd)) return KNOWN.get(cmd)
    if (cmd.includes('usage --json')) return usageAnswer
    return { code: 1, stdout: '' }
  }
  exec.calls = calls
  return exec
}

const claudeRowOf = (result) => result.rows.find((r) => r.id === 'claude')

// ── (a) [M1] account set, usage answered with an unread:false row ──────────
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

// ── (b) [M2] usage unreadable — a bad exit, then an unread row ─────────────
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

// ── (c) [M3] account null — no --account clause ─────────────────────────────
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

// ── (d) [M4] first-run.md §claude, via the task's own Run: guard ───────────
{
  // Read in-process, never a spawned shell: the hermetic rule
  // (test_sims_are_hermetic.mjs M2) wants every spawn under simEnv.
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'skills/ultrapowers/references/first-run.md'), 'utf8')
  const start = doc.indexOf('\n## claude\n')
  assert.ok(start !== -1, '(d) [M4] first-run.md carries a `## claude` section')
  const rest = doc.slice(start + 1)
  const next = rest.indexOf('\n## ', 1)
  const section = next === -1 ? rest : rest.slice(0, next)
  assert.ok(section.includes('seven-day'), '(d) [M4] first-run.md §claude names the seven-day reading')
}

console.log('ALL TESTS PASSED')
