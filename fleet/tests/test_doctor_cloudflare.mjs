/**
 * fleet/tests/test_doctor_cloudflare.mjs — the exam for "The doctor names the
 * cloudflare integration, the docs walk it, and the launcher refuses a
 * publishing plan without it" (#835).
 *
 * `doctor.mjs` gains a ninth row, `cloudflare`: the deploy's credential, an
 * http-proxy integration needed only by a plan with a `**Publish:**` line.
 * Unlike every other row, absent is green — most plans never publish. Present
 * is judged the same way `kata`'s policy question is: the listing's own
 * attachment tag first (`tags` carrying `fleet`), then the policy read
 * (`integrations policy get cloudflare --json`, `policy.selector`), asked only
 * when `found` names a `cloudflare` object at all.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] `ROW_IDS` is exactly the nine pinned ids, the ninth `cloudflare`,
 *       and `doctor()` answers nine rows in that same order.
 *   (b) [M2] with no `cloudflare` object in `integrations list --json`: the
 *       row is `ok`, its detail contains `absent` and `Publish:`, and no
 *       `integrations policy get cloudflare --json` read is issued at all.
 *   (c) [M2] with the object present and its policy read answering selector
 *       `tag:fleet`: the row is `ok`.
 *   (d) [M2] with the object present and its policy read answering a selector
 *       that is not `tag:fleet`: the row is `missing`, and its detail names
 *       `integrations policy set cloudflare 'tag:fleet'`.
 *
 * (b)-(d) drive `doctor({ config, exec, configKeys, account })` in-process,
 * over a stub `exec` keyed on the exact command strings of the doctor's own
 * `READS` (`fleet/doctor.mjs`) plus `policyRead(name)`, answering
 * `integrations list --json` with the listing each leg needs and everything
 * unmatched — including every `help <verb>` read `verb-drift` issues — with
 * `{ code: 1, stdout: '' }`. Only the `cloudflare` row's outcome is asserted;
 * the other eight rows are left unasserted, per the task's own instruction.
 */

import assert from 'node:assert/strict'

import { doctor, ROW_IDS, policyRead } from '../doctor.mjs'

// ── the exec stub every leg shares ──────────────────────────────────────────

const BASE_KNOWN = new Map([
  ['ssh exe.dev whoami', { code: 1, stdout: '' }],
  ['ssh exe.dev "billing plan --json"', { code: 1, stdout: '' }],
  ['ssh exe.dev "integrations setup github --list"', { code: 1, stdout: '' }],
  ['ssh exe.dev "integrations policy get claude-max --json"', { code: 1, stdout: '' }],
  ['ssh exe.dev "integrations policy get kata --json"', { code: 1, stdout: '' }],
  ['ssh exe.dev "ls kata-hub --json"', { code: 1, stdout: '' }]
])

/**
 * Builds an `exec` stub recording every command it is asked, answering
 * `integrations list --json` with `listStdout`, the extra entries of
 * `extraKnown` (e.g. the cloudflare policy read), the shared base table, and
 * everything else — the token/accounts/usage reads and every `verb-drift`
 * `help <verb>` read included — with `{ code: 1, stdout: '' }`.
 */
function makeExec (listStdout, extraKnown = new Map()) {
  const known = new Map([
    ...BASE_KNOWN,
    ['ssh exe.dev "integrations list --json"', { code: 0, stdout: listStdout }],
    ...extraKnown
  ])
  const calls = []
  const exec = async (cmd) => {
    calls.push(cmd)
    if (known.has(cmd)) return known.get(cmd)
    return { code: 1, stdout: '' }
  }
  exec.calls = calls
  return exec
}

const cloudflareRowOf = (result) => result.rows.find((r) => r.id === 'cloudflare')
const CLOUDFLARE_POLICY_READ = policyRead('cloudflare')

// ── (a) [M1] ROW_IDS and row order ───────────────────────────────────────
{
  const want = ['exe-dev', 'capacity', 'claude', 'accounts', 'github', 'integrations', 'verb-drift', 'kata', 'cloudflare']
  assert.deepEqual(
    [...ROW_IDS], want,
    `(a) [M1] ROW_IDS is exactly the nine pinned ids in order — got: ${JSON.stringify([...ROW_IDS])}`
  )

  const exec = makeExec(JSON.stringify([]))
  const result = await doctor({ config: {}, exec, configKeys: null, account: null })
  assert.equal(result.rows.length, 9, `(a) [M1] doctor() answers nine rows — got ${result.rows.length}`)
  assert.deepEqual(
    result.rows.map((r) => r.id), want,
    `(a) [M1] doctor()'s rows are in ROW_IDS order — got: ${JSON.stringify(result.rows.map((r) => r.id))}`
  )
}

// ── (b) [M2] absent — ok, "absent" and "Publish:" in the detail, no read ───
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
  assert.ok(
    !exec.calls.includes(CLOUDFLARE_POLICY_READ),
    `(b) [M2] an absent object needs no policy read — calls:\n${exec.calls.join('\n')}`
  )
}

// ── (c) [M2] present, on the policy — ok ────────────────────────────────────
{
  const listStdout = JSON.stringify([
    { name: 'claude-max', config_summary: 'Authorization:Bearer xyz' },
    { name: 'cloudflare', config_summary: 'Authorization:Bearer cf' }
  ])
  const policyStdout = JSON.stringify({ policy: { selector: 'tag:fleet' }, revision: 'rev-1' })
  const exec = makeExec(listStdout, new Map([[CLOUDFLARE_POLICY_READ, { code: 0, stdout: policyStdout }]]))
  const result = await doctor({ config: {}, exec, configKeys: null, account: null })
  const cloudflare = cloudflareRowOf(result)
  assert.equal(
    cloudflare.status, 'ok',
    `(c) [M2] present on tag:fleet is ok — got: ${JSON.stringify(cloudflare)}`
  )
  assert.ok(
    exec.calls.includes(CLOUDFLARE_POLICY_READ),
    `(c) [M2] a present object's policy is read — calls:\n${exec.calls.join('\n')}`
  )
}

// ── (d) [M2] present, off the policy — missing, names the policy-set verb ──
{
  const listStdout = JSON.stringify([
    { name: 'claude-max', config_summary: 'Authorization:Bearer xyz' },
    { name: 'cloudflare', config_summary: 'Authorization:Bearer cf' }
  ])
  const policyStdout = JSON.stringify({ policy: { selector: 'tag:other' }, revision: 'rev-2' })
  const exec = makeExec(listStdout, new Map([[CLOUDFLARE_POLICY_READ, { code: 0, stdout: policyStdout }]]))
  const result = await doctor({ config: {}, exec, configKeys: null, account: null })
  const cloudflare = cloudflareRowOf(result)
  assert.equal(
    cloudflare.status, 'missing',
    `(d) [M2] present off the policy is missing — got: ${JSON.stringify(cloudflare)}`
  )
  assert.ok(
    cloudflare.detail.includes("integrations policy set cloudflare 'tag:fleet'"),
    `(d) [M2] detail names the policy-set verb — got: ${JSON.stringify(cloudflare.detail)}`
  )
}

console.log('ALL TESTS PASSED')
