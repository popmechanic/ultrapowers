/**
 * fleet/tests/test_doctor_evidence.mjs — the exam for "The doctor's evidence
 * row walks the one-time setup" (#1395).
 *
 * The `evidence` row, reported right after `integrations`, walks the three
 * steps that let a run keep its record in the operator's evidence repository,
 * stopping at the first miss and naming its fix.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (b) [M2] `evidence: null` — `missing`, the detail names `"evidence"` and
 *       `~/.ultrapowers/fleet.json`, and no `gh api repos/` call is issued.
 *   (c) [M3] `evidence: 'ops/evidence'`, `gh api repos/ops/evidence` exiting
 *       1 — `missing`, naming `gh repo create ops/evidence --private`.
 *   (d) [M4] that read answering: no `gh-ops-evidence` in the listing is
 *       `missing` naming `node fleet/target.mjs ops/evidence`; listed and
 *       attached to `tag:fleet` is `ok`; attached elsewhere is `missing`
 *       naming `gh-ops-evidence` (#1434).
 *   (e) [M5] the `capacity` row over config keys `cpu`, `memory`, `account`
 *       and `evidence` calls none of them a key nothing reads.
 *
 * Every leg drives `doctor()` in-process over a stub `exec(cmd, argv)` keyed
 * on the command and its argv joined by spaces (`ssh exe.dev <remote>`,
 * `gh api …`), the shape of `test_doctor_claude.mjs`; everything unmatched
 * answers `{ code: 1, stdout: '' }`. No socket is opened.
 */

import assert from 'node:assert/strict'

import { doctor } from '../doctor.mjs'

const keyOf = (cmd, argv = []) => [cmd, ...argv].join(' ')
const lobbyKey = (remote) => keyOf('ssh', ['exe.dev', remote])

const EVIDENCE = 'ops/evidence'
const OBJECT = 'gh-ops-evidence'
const REPO_READ = keyOf('gh', ['api', `repos/${EVIDENCE}`])

const CLAUDE_MAX = { name: 'claude-max', config_summary: 'Authorization:Bearer xyz' }

function makeExec (known = new Map()) {
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

const listing = (entries) => [lobbyKey('integrations list --json'), { code: 0, stdout: JSON.stringify(entries) }]
const evidenceRowOf = (result) => result.rows.find((r) => r.id === 'evidence')

// ── (b) [M2] no setting ────────────────────────────────────────────────────
{
  const exec = makeExec(new Map([listing([CLAUDE_MAX])]))
  const result = await doctor({ config: {}, exec, evidence: null })
  const ev = evidenceRowOf(result)
  assert.ok(ev, '(b) [M2] the result carries an evidence row')
  assert.equal(ev.status, 'missing', `(b) [M2] no setting is missing — got ${JSON.stringify(ev)}`)
  assert.ok(ev.detail.includes('"evidence"'), `(b) [M2] detail names "evidence" — got ${JSON.stringify(ev.detail)}`)
  assert.ok(
    ev.detail.includes('~/.ultrapowers/fleet.json'),
    `(b) [M2] detail names ~/.ultrapowers/fleet.json — got ${JSON.stringify(ev.detail)}`
  )
  assert.ok(
    !exec.calls.some((c) => c.includes('gh api repos/')),
    `(b) [M2] no gh api repos/ call — calls:\n${exec.calls.join('\n')}`
  )
  const ids = result.rows.map((r) => r.id)
  assert.equal(ids.indexOf('evidence'), ids.indexOf('integrations') + 1, '(b) the row follows integrations')
}

// ── (c) [M3] the repository is absent ──────────────────────────────────────
{
  const exec = makeExec(new Map([listing([CLAUDE_MAX]), [REPO_READ, { code: 1, stdout: '' }]]))
  const ev = evidenceRowOf(await doctor({ config: {}, exec, evidence: EVIDENCE }))
  assert.ok(exec.calls.includes(REPO_READ), `(c) [M3] the repository is read — calls:\n${exec.calls.join('\n')}`)
  assert.equal(ev.status, 'missing', `(c) [M3] an absent repository is missing — got ${JSON.stringify(ev)}`)
  assert.ok(
    ev.detail.includes(`gh repo create ${EVIDENCE} --private`),
    `(c) [M3] detail names gh repo create — got ${JSON.stringify(ev.detail)}`
  )
}

// ── (d) [M4] the integration and its attachment ────────────────────────────────
const REPO_OK = [REPO_READ, { code: 0, stdout: JSON.stringify({ full_name: EVIDENCE }) }]
{
  const exec = makeExec(new Map([listing([CLAUDE_MAX]), REPO_OK]))
  const ev = evidenceRowOf(await doctor({ config: {}, exec, evidence: EVIDENCE }))
  assert.equal(ev.status, 'missing', `(d) [M4] no integration is missing — got ${JSON.stringify(ev)}`)
  assert.ok(
    ev.detail.includes(`node fleet/target.mjs ${EVIDENCE}`),
    `(d) [M4] detail names node fleet/target.mjs — got ${JSON.stringify(ev.detail)}`
  )
}
{
  const exec = makeExec(new Map([
    listing([CLAUDE_MAX, { name: OBJECT, repository: EVIDENCE, attachments: ['tag:fleet'] }]), REPO_OK
  ]))
  const ev = evidenceRowOf(await doctor({ config: {}, exec, evidence: EVIDENCE }))
  assert.equal(ev.status, 'ok', `(d) [M4] tag:fleet is ok — got ${JSON.stringify(ev)}`)
}
{
  const exec = makeExec(new Map([
    listing([CLAUDE_MAX, { name: OBJECT, repository: EVIDENCE, attachments: ['vm:one'] }]), REPO_OK
  ]))
  const ev = evidenceRowOf(await doctor({ config: {}, exec, evidence: EVIDENCE }))
  assert.equal(ev.status, 'missing', `(d) [M4] attached elsewhere is missing — got ${JSON.stringify(ev)}`)
  assert.ok(ev.detail.includes(OBJECT), `(d) [M4] detail names ${OBJECT} — got ${JSON.stringify(ev.detail)}`)
}

// ── (e) [M5] evidence is not a stale key ───────────────────────────────────
{
  const exec = makeExec(new Map([
    listing([CLAUDE_MAX]),
    [lobbyKey('billing plan --json'), { code: 0, stdout: JSON.stringify({ max_cpus: 16, max_memory_gb: 64, tier: 'pro' }) }]
  ]))
  const result = await doctor({
    config: { cpu: '2', memory: '8GB' },
    exec,
    configKeys: ['cpu', 'memory', 'account', 'evidence'],
    account: 'acct',
    evidence: EVIDENCE
  })
  const capacity = result.rows.find((r) => r.id === 'capacity')
  assert.ok(
    !capacity.detail.includes('nothing reads'),
    `(e) [M5] no key is called one nothing reads — got ${JSON.stringify(capacity)}`
  )
  assert.equal(capacity.status, 'ok', `(e) [M5] the capacity row is ok — got ${JSON.stringify(capacity)}`)
}

console.log('ALL TESTS PASSED')
