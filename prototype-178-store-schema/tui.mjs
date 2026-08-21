// PROTOTYPE (#178) — thin interactive shell over schema.mjs. Drive the claims/
// spend/guard model by hand and watch derived state. Run: npm run proto:tui
import { createMergeableStore } from 'tinybase'
import {
  claimState, tryClaim, tryRenew, revoke, spendRowId, totalSpent, remaining,
  guardViolation, legalTransition,
} from './schema.mjs'

const B = (s) => `\x1b[1m${s}\x1b[0m`, D = (s) => `\x1b[2m${s}\x1b[0m`
const RUN = 'run-1', CLAIM = `claim:${RUN}`, TTL = 5000, CAP = 200

const orch = createMergeableStore('orch')
const sandboxes = { A: createMergeableStore('sbA'), B: createMergeableStore('sbB') }
const connected = { A: true, B: true }
const seqs = { A: 0, B: 0 }
let now = 0
let msg = 'ready'
let lastGood = null

orch.setRow('runs', RUN, { planPath: 'plans/p1.md', status: 'pending' })
orch.setRow('budgets', RUN, { capTokens: CAP })

const syncAll = () => {
  for (const [id, sb] of Object.entries(sandboxes)) {
    if (!connected[id]) continue
    sb.applyMergeableChanges(orch.getMergeableContent())
    orch.applyMergeableChanges(sb.getMergeableContent())
  }
  for (const [id, sb] of Object.entries(sandboxes)) if (connected[id]) sb.applyMergeableChanges(orch.getMergeableContent())
}

const guardSweep = () => {
  if (!lastGood) { lastGood = JSON.parse(JSON.stringify(orch.getTables())); return 'guard snapshot taken' }
  const fixes = []
  for (const table of ['claims', 'runs', 'spend', 'receipts']) {
    for (const [rowId, newRow] of Object.entries(orch.getTable(table))) {
      const oldRow = lastGood[table]?.[rowId]
      const writer = table === 'spend' ? rowId.split(':')[0] : newRow.holder
      const v = guardViolation(table, rowId, newRow, oldRow, writer, now)
      if (v && JSON.stringify(newRow) !== JSON.stringify(oldRow)) {
        fixes.push(v); orch.delRow(table, rowId); if (oldRow) orch.setRow(table, rowId, oldRow)
      }
    }
  }
  lastGood = JSON.parse(JSON.stringify(orch.getTables()))
  return fixes.length ? `converged away: ${fixes.join(' | ')}` : 'sweep clean'
}

const claimAs = (id) => {
  const sb = sandboxes[id]
  const res = tryClaim(sb.getRow('claims', CLAIM), { runId: RUN, claimant: `sb${id}`, ttlMs: TTL, now })
  if (res.error) return `sb${id} claim refused: ${res.error}`
  sb.setRow('claims', CLAIM, res.row)
  return `sb${id} claimed (epoch ${res.row.epoch}, lease to t=${res.row.leaseExpiresAt})`
}

const renewAs = (id) => {
  const sb = sandboxes[id]
  const row = sb.getRow('claims', CLAIM)
  const res = tryRenew(row, { claimant: `sb${id}`, epoch: row?.epoch, ttlMs: TTL, now })
  if (res.error) return `sb${id} renew refused: ${res.error}`
  sb.setRow('claims', CLAIM, res.row)
  return `sb${id} renewed to t=${res.row.leaseExpiresAt}`
}

const spendAs = (id) => {
  const sb = sandboxes[id]
  sb.setRow('spend', spendRowId(`sb${id}`, ++seqs[id]), { runId: RUN, tokens: 10, at: now })
  return `sb${id} appended a 10-token spend row (local view: ${totalSpent(sb.getTable('spend'), RUN)} spent)`
}

const steal = () => { // deliberately buggy write to feed the guard
  sandboxes.B.setRow('claims', CLAIM, { runId: RUN, holder: 'sbB', leaseExpiresAt: now + TTL, epoch: 99, revoked: false })
  return 'sbB wrote a claim-steal row (sync it, then guard-sweep)'
}

const render = () => {
  console.clear()
  console.log(B(`#178 store prototype  t=${now}`) + D(`  (TTL ${TTL}, cap ${CAP})`) + `   ${D(msg)}`)
  const row = orch.getRow('claims', CLAIM)
  console.log(`\n${B('orch')} claim: ${JSON.stringify(row ?? {})} ${B(`-> ${claimState(row, now)}`)}`)
  console.log(`     run: ${JSON.stringify(orch.getRow('runs', RUN))}`)
  console.log(`     spend: ${totalSpent(orch.getTable('spend'), RUN)}  remaining: ${remaining(CAP, orch.getTable('spend'), RUN)}`)
  for (const [id, sb] of Object.entries(sandboxes)) {
    const r = sb.getRow('claims', CLAIM)
    console.log(`${B(`sb${id}`)}${connected[id] ? '' : D(' [disconnected]')} claim: ${JSON.stringify(r ?? {})} ${D(`-> ${claimState(r, now)}`)}  spend seen: ${totalSpent(sb.getTable('spend'), RUN)}`)
  }
  console.log(`\n${B('[1]')}${D('claim A')} ${B('[2]')}${D('claim B')} ${B('[r]')}${D('renew A')} ${B('[R]')}${D('renew B')} ${B('[x]')}${D('revoke')} ${B('[!]')}${D('B steals claim')}`)
  console.log(`${B('[a]')}${D('A spends 10')} ${B('[b]')}${D('B spends 10')} ${B('[t]')}${D('+1s')} ${B('[T]')}${D('+5s')} ${B('[d]')}${D('toggle A conn')} ${B('[D]')}${D('toggle B conn')} ${B('[s]')}${D('sync')} ${B('[g]')}${D('guard sweep')} ${B('[q]')}${D('quit')}`)
}

const handlers = {
  1: () => claimAs('A'), 2: () => claimAs('B'), r: () => renewAs('A'), R: () => renewAs('B'),
  x: () => { orch.setRow('claims', CLAIM, revoke(orch.getRow('claims', CLAIM))); return 'operator revoked (explicit write)' },
  '!': steal,
  a: () => spendAs('A'), b: () => spendAs('B'),
  t: () => { now += 1000; return `t=${now} (no writes happened — watch derived states)` },
  T: () => { now += 5000; return `t=${now}` },
  d: () => { connected.A = !connected.A; return `sbA ${connected.A ? 'reconnected' : 'disconnected'} — note: claim state does NOT change` },
  D: () => { connected.B = !connected.B; return `sbB ${connected.B ? 'reconnected' : 'disconnected'}` },
  s: () => { syncAll(); return 'synced connected replicas' },
  g: guardSweep,
}

process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8')
render()
process.stdin.on('data', (k) => {
  if (k === 'q' || k === '') { process.stdin.setRawMode(false); process.exit(0) }
  if (handlers[k]) msg = handlers[k]()
  render()
})
