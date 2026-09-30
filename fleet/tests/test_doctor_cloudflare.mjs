/**
 * fleet/tests/test_doctor_cloudflare.mjs — the exam for "The doctor names the
 * cloudflare integration, the docs walk it, and the launcher refuses a
 * publishing plan without it" (#835).
 *
 * `doctor.mjs` gains a ninth row, `cloudflare`: the deploy's credential, an
 * http-proxy integration needed only by a plan with a `**Publish:**` line.
 * Unlike every other row, absent is green — most plans never publish. Present
 * is judged the way every integration is (#1434): its attachment `tag:fleet`
 * in `integrations list --json`.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] `ROW_IDS` is exactly the ten pinned ids, the tenth `cloudflare`,
 *       and `doctor()` answers ten rows in that same order.
 *   (b) [M2] with no `cloudflare` object in `integrations list --json`: the
 *       row is `ok`, and its detail contains `absent` and `Publish:`.
 *   (c) [M2] with the object present and attached to `tag:fleet`: `ok`.
 *   (d) [M2] with the object present and not attached to `tag:fleet`: the
 *       row is `missing`, and its detail names
 *       `integrations attach cloudflare tag:fleet`.
 *
 * (b)-(d) drive `doctor({ config, exec, configKeys, account })` in-process,
 * over a stub `exec(cmd, argv)` keyed on the call's command and argv (joined
 * by spaces) — the doctor's own `ssh exe.dev <remote>` reads (`READS` in
 * `fleet/doctor.mjs`) — answering
 * `integrations list --json` with the listing each leg needs and everything
 * unmatched — including every `help <verb>` read `verb-drift` issues — with
 * `{ code: 1, stdout: '' }`. Only the `cloudflare` row's outcome is asserted;
 * the other eight rows are left unasserted, per the task's own instruction.
 */

import assert from 'node:assert/strict'

import { doctor, ROW_IDS } from '../doctor.mjs'

// ── the exec stub every leg shares ──────────────────────────────────────────

/** One call on the seam `exec(cmd, argv)`, as the stub keys and records it:
 *  the command and its argv joined by spaces. */
const keyOf = (cmd, argv = []) => [cmd, ...argv].join(' ')
/** A lobby read, `exec('ssh', ['exe.dev', remote])`, as the stub keys it. */
const lobbyKey = (remote) => keyOf('ssh', ['exe.dev', remote])

const BASE_KNOWN = new Map([
  [lobbyKey('whoami'), { code: 1, stdout: '' }],
  [lobbyKey('billing plan --json'), { code: 1, stdout: '' }],
  [lobbyKey('integrations setup github --list'), { code: 1, stdout: '' }],
  [lobbyKey('ls kata-hub --json'), { code: 1, stdout: '' }]
])

/**
 * Builds an `exec(cmd, argv)` stub recording every call it is asked (as
 * `keyOf`), answering `integrations list --json` with `listStdout`, the shared base
 * table, and everything else — the token/accounts/usage reads and every
 * `verb-drift` `help <verb>` read included — with `{ code: 1, stdout: '' }`.
 */
function makeExec (listStdout) {
  const known = new Map([
    ...BASE_KNOWN,
    [lobbyKey('integrations list --json'), { code: 0, stdout: listStdout }]
  ])
  const calls = []
  const exec = async (command, argv) => {
    const cmd = keyOf(command, argv)
    calls.push(cmd)
    if (known.has(cmd)) return known.get(cmd)
    return { code: 1, stdout: '' }
  }
  exec.calls = calls
  return exec
}

const cloudflareRowOf = (result) => result.rows.find((r) => r.id === 'cloudflare')

// ── (a) [M1] ROW_IDS and row order ───────────────────────────────────────
{
  const want = ['exe-dev', 'capacity', 'claude', 'accounts', 'github', 'integrations', 'evidence', 'verb-drift', 'kata', 'cloudflare']
  assert.deepEqual(
    [...ROW_IDS], want,
    `(a) [M1] ROW_IDS is exactly the ten pinned ids in order — got: ${JSON.stringify([...ROW_IDS])}`
  )

  const exec = makeExec(JSON.stringify([]))
  const result = await doctor({ config: {}, exec, configKeys: null, account: null })
  assert.equal(result.rows.length, 10, `(a) [M1] doctor() answers ten rows — got ${result.rows.length}`)
  assert.deepEqual(
    result.rows.map((r) => r.id), want,
    `(a) [M1] doctor()'s rows are in ROW_IDS order — got: ${JSON.stringify(result.rows.map((r) => r.id))}`
  )
}

// ── (b) [M2] absent — ok, "absent" and "Publish:" in the detail ────────────
{
  const exec = makeExec(JSON.stringify([{ name: 'claude-max', config_summary: 'Authorization:Bearer xyz' }]))
  const result = await doctor({ config: {}, exec, configKeys: null, account: null })
  const cloudflare = cloudflareRowOf(result)
  assert.ok(cloudflare, '(b) [M2] the result carries a cloudflare row')
  assert.equal(cloudflare.status, 'ok', `(b) [M2] absent is ok — got: ${JSON.stringify(cloudflare)}`)
  assert.ok(
    cloudflare.detail.includes('absent'),
    `(b) [M2] detail names "absent" — got: ${JSON.stringify(cloudflare.detail)}`
  )
  assert.ok(
    cloudflare.detail.includes('Publish:'),
    `(b) [M2] detail names "Publish:" — got: ${JSON.stringify(cloudflare.detail)}`
  )
}

// ── (c) [M2] present, attached to tag:fleet — ok ───────────────────────────
{
  const listStdout = JSON.stringify([
    { name: 'claude-max', config_summary: 'Authorization:Bearer xyz' },
    { name: 'cloudflare', config_summary: 'Authorization:Bearer cf', attachments: ['tag:fleet'] }
  ])
  const result = await doctor({ config: {}, exec: makeExec(listStdout), configKeys: null, account: null })
  const cloudflare = cloudflareRowOf(result)
  assert.equal(cloudflare.status, 'ok', `(c) [M2] present on tag:fleet is ok — got: ${JSON.stringify(cloudflare)}`)
}

// ── (d) [M2] present, not attached — missing, names the attach ──────────────
{
  const listStdout = JSON.stringify([
    { name: 'claude-max', config_summary: 'Authorization:Bearer xyz' },
    { name: 'cloudflare', config_summary: 'Authorization:Bearer cf', attachments: ['vm:one'] }
  ])
  const result = await doctor({ config: {}, exec: makeExec(listStdout), configKeys: null, account: null })
  const cloudflare = cloudflareRowOf(result)
  assert.equal(cloudflare.status, 'missing', `(d) [M2] present off tag:fleet is missing — got: ${JSON.stringify(cloudflare)}`)
  assert.ok(
    cloudflare.detail.includes('integrations attach cloudflare tag:fleet'),
    `(d) [M2] detail names the attach — got: ${JSON.stringify(cloudflare.detail)}`
  )
}

console.log('ALL TESTS PASSED')
