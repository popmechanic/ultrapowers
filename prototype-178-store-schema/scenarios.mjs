// PROTOTYPE (#178) — scripted hard cases S1–S5 over real MergeableStore CRDTs.
// Run: npm run proto
import { createMergeableStore } from 'tinybase'
import {
  claimState, tryClaim, tryRenew, revoke, spendRowId, totalSpent, remaining,
  mayEnqueueSpend, guardViolation,
} from './schema.mjs'

const B = (s) => `\x1b[1m${s}\x1b[0m`
const D = (s) => `\x1b[2m${s}\x1b[0m`
let observations = []
const observe = (label, ok) => {
  observations.push([label, ok])
  console.log(`  ${ok ? '\x1b[32mOBSERVE\x1b[0m' : '\x1b[31mSURPRISE\x1b[0m'} ${label}`)
}

// Replicas: 'orch' is the orchestrator/server-side participant; sandboxes sync
// only when "connected". Sync = full CRDT content exchange (idempotent).
const mkReplica = (id) => createMergeableStore(id)
const sync = (a, b) => { a.applyMergeableChanges(b.getMergeableContent()); b.applyMergeableChanges(a.getMergeableContent()) }

const dump = (store, now, title) => {
  console.log(B(`  -- ${title} (t=${now})`))
  for (const table of ['runs', 'claims', 'budgets', 'spend', 'receipts']) {
    const rows = store.getTable(table)
    for (const [id, row] of Object.entries(rows)) {
      const extra = table === 'claims' ? D(` -> ${claimState(row, now)}`) : ''
      console.log(`    ${table}/${id} ${JSON.stringify(row)}${extra}`)
    }
  }
}

// The server-side guard: the orchestrator replica keeps a last-known-good
// snapshot; after each inbound sync it sweeps for violations and CONVERGES
// AWAY (delRow first — an equal re-write produces no new HLC stamp), then the
// corrected state syncs back out. This is post-hoc by construction: a plain
// ws-server has no willApplyChanges. Writer attribution is NOT available
// post-merge — the guard checks content invariants + namespace conventions.
const mkGuard = (orch) => {
  let good = JSON.parse(JSON.stringify(orch.getTables()))
  return {
    snapshot: () => { good = JSON.parse(JSON.stringify(orch.getTables())) },
    sweep: (now) => {
      const fixes = []
      for (const table of ['claims', 'runs', 'spend', 'receipts']) {
        const cur = orch.getTable(table)
        for (const [rowId, newRow] of Object.entries(cur)) {
          const oldRow = good[table]?.[rowId]
          // attribution: for spend rows the namespace IS the claimed writer;
          // for claims the incoming holder claims authorship.
          const writer = table === 'spend' ? rowId.split(':')[0] : newRow.holder
          const v = guardViolation(table, rowId, newRow, oldRow, writer, now)
          const changed = JSON.stringify(newRow) !== JSON.stringify(oldRow)
          if (v && changed) {
            fixes.push(`${table}/${rowId}: ${v}`)
            orch.delRow(table, rowId)
            if (oldRow) orch.setRow(table, rowId, oldRow)
          }
        }
      }
      good = JSON.parse(JSON.stringify(orch.getTables()))
      return fixes
    },
  }
}

const S1 = () => {
  console.log(B('\nS1 — disconnect vs expiry: liveness is NOT an input'))
  const orch = mkReplica('orch'), sbA = mkReplica('sbA'), sbB = mkReplica('sbB')
  let now = 1000
  orch.setRow('runs', 'run-1', { planPath: 'plans/p1.md', status: 'pending' })
  sync(orch, sbA); sync(orch, sbB)

  const c1 = tryClaim(undefined, { runId: 'run-1', claimant: 'sbA', ttlMs: 5000, now })
  sbA.setRow('claims', 'claim:run-1', c1.row)
  sbA.setRow('runs', 'run-1', { ...sbA.getRow('runs', 'run-1'), status: 'claimed', sandboxId: 'sbA' })
  sync(orch, sbA)
  dump(orch, now, 'sbA claimed, lease to t=6000; sbA now DISCONNECTS')

  now = 4000 // sbA is gone from the socket, lease not expired
  const attempt = tryClaim(orch.getRow('claims', 'claim:run-1'), { runId: 'run-1', claimant: 'sbB', ttlMs: 5000, now })
  observe(`t=4000 disconnected-but-unexpired: sbB claim refused (${attempt.error})`, !!attempt.error)

  now = 6001 // lease expired, still no revocation write anywhere
  const st = claimState(orch.getRow('claims', 'claim:run-1'), now)
  observe(`t=6001 no write happened, state derived as '${st}'`, st === 'expired')
  const c2 = tryClaim(orch.getRow('claims', 'claim:run-1'), { runId: 'run-1', claimant: 'sbB', ttlMs: 5000, now })
  observe(`sbB claims expired lease, epoch bumps ${orch.getRow('claims', 'claim:run-1').epoch} -> ${c2.row.epoch}`, c2.row.epoch === 2)
  sbB.applyMergeableChanges(orch.getMergeableContent())
  sbB.setRow('claims', 'claim:run-1', c2.row)
  sync(orch, sbB)

  // zombie: sbA reconnects and renews with its stale epoch
  sync(orch, sbA)
  const zr = tryRenew(sbA.getRow('claims', 'claim:run-1'), { claimant: 'sbA', epoch: 1, ttlMs: 5000, now: now + 10 })
  observe(`zombie sbA renew rejected: ${zr.error}`, !!zr.error)
  dump(orch, now, 'final')
}

const S2 = () => {
  console.log(B('\nS2 — revoked is explicit and distinct from expired'))
  const orch = mkReplica('orch2'), sbA = mkReplica('sbA2')
  let now = 1000
  const c = tryClaim(undefined, { runId: 'run-2', claimant: 'sbA', ttlMs: 5000, now })
  orch.setRow('claims', 'claim:run-2', c.row); sync(orch, sbA)
  // sbA unavailable; operator revokes while lease is STILL VALID
  now = 2000
  orch.setRow('claims', 'claim:run-2', revoke(orch.getRow('claims', 'claim:run-2')))
  const st = claimState(orch.getRow('claims', 'claim:run-2'), now)
  observe(`revoke mid-lease: state '${st}' (not 'held', not 'expired')`, st === 'revoked')
  const re = tryClaim(orch.getRow('claims', 'claim:run-2'), { runId: 'run-2', claimant: 'sbB', ttlMs: 5000, now: 99999 })
  observe(`even after expiry time, revoked is not claimable (${re.error})`, !!re.error)
  const renew = tryRenew(orch.getRow('claims', 'claim:run-2'), { claimant: 'sbA', epoch: 1, ttlMs: 5000, now })
  observe(`holder's renew after revoke rejected (${renew.error})`, !!renew.error)
  dump(orch, now, 'final')
}

const S3 = () => {
  console.log(B('\nS3 — spend ledger: counter cell loses under LWW, append rows do not'))
  // (a) the broken shape: one mutable counter cell
  const oA = mkReplica('cA'), oB = mkReplica('cB')
  oA.setCell('budgets', 'run-3', 'totalSpent', 100); sync(oA, oB)
  oA.setCell('budgets', 'run-3', 'totalSpent', 150) // A adds 50 offline
  oB.setCell('budgets', 'run-3', 'totalSpent', 130) // B adds 30 offline
  sync(oA, oB)
  const counter = oA.getCell('budgets', 'run-3', 'totalSpent')
  observe(`counter cell after concurrent +50/+30 on 100: ${counter} (should be 180 — LWW dropped an increment)`, counter !== 180)

  // (b) the correct shape: append-only writer-namespaced rows
  const orch = mkReplica('orch3'), sbA = mkReplica('sbA3'), sbB = mkReplica('sbB3')
  orch.setRow('budgets', 'run-3', { capTokens: 200 })
  orch.setRow('spend', spendRowId('orch', 1), { runId: 'run-3', tokens: 100, at: 1000 })
  sync(orch, sbA); sync(orch, sbB)
  sbA.setRow('spend', spendRowId('sbA', 1), { runId: 'run-3', tokens: 50, at: 2000 })
  sbB.setRow('spend', spendRowId('sbB', 1), { runId: 'run-3', tokens: 30, at: 2001 })
  sync(orch, sbA); sync(orch, sbB); sync(orch, sbA)
  const total = totalSpent(orch.getTable('spend'), 'run-3')
  observe(`append rows after same concurrent spends: total ${total}`, total === 180)
  observe(`remaining vs 200 cap: ${remaining(200, orch.getTable('spend'), 'run-3')}`, remaining(200, orch.getTable('spend'), 'run-3') === 20)
  // advisory pre-check vs post-hoc authority
  const may = mayEnqueueSpend(200, sbA.getTable('spend'), 'run-3', 50)
  observe(`advisory pre-check on sbA's replica says ${may} for a 50-token spend (remaining 20) — overshoot is detected post-sync, not prevented pre-spend`, may === false)
  dump(orch, 2002, 'final (append-row shape)')
}

const S4 = () => {
  console.log(B('\nS4 — merge-guard-then-CONVERGE-AWAY on a guard-less relay'))
  const orch = mkReplica('orch4'), sbA = mkReplica('sbA4'), sbB = mkReplica('sbB4')
  let now = 1000
  const c = tryClaim(undefined, { runId: 'run-4', claimant: 'sbA', ttlMs: 60000, now })
  orch.setRow('claims', 'claim:run-4', c.row)
  orch.setRow('runs', 'run-4', { status: 'claimed', sandboxId: 'sbA' })
  sync(orch, sbA); sync(orch, sbB)
  const guard = mkGuard(orch); guard.snapshot()

  // buggy sbB steals the unexpired claim and jumps a run status illegally
  now = 2000
  sbB.setRow('claims', 'claim:run-4', { runId: 'run-4', holder: 'sbB', leaseExpiresAt: now + 60000, epoch: 2, revoked: false })
  sbB.setRow('runs', 'run-4', { status: 'folded', sandboxId: 'sbB' }) // claimed -> folded is illegal
  sync(orch, sbB) // relay accepts everything — no pre-strip exists
  dump(orch, now, 'post-relay: the bad writes ARE in the server store')
  const fixes = guard.sweep(now)
  for (const f of fixes) console.log(`    ${D('converge-away:')} ${f}`)
  observe(`guard swept ${fixes.length} violations`, fixes.length === 2)
  sync(orch, sbB); sync(orch, sbA)
  observe(`all replicas converged back to holder=sbA`, sbB.getRow('claims', 'claim:run-4').holder === 'sbA' && sbA.getRow('claims', 'claim:run-4').holder === 'sbA')
  observe(`run status restored to 'claimed'`, sbB.getRow('runs', 'run-4').status === 'claimed')
  dump(orch, now, 'final')

  console.log(D('  NOTE: a forged spend row inside ANOTHER writer\'s namespace is'))
  console.log(D('  content-indistinguishable post-merge — plain ws-server has no per-'))
  console.log(D('  connection attribution. Trusted-fleet posture: convention + invariants'))
  console.log(D('  defend against BUGS; adversarial guarding needs the DO/celld substrate.'))
}

const S5 = () => {
  console.log(B('\nS5 — writer-namespaced ids: concurrent creation never collides'))
  const orch = mkReplica('orch5'), sbA = mkReplica('sbA5'), sbB = mkReplica('sbB5')
  sync(orch, sbA); sync(orch, sbB)
  sbA.setRow('spend', spendRowId('sbA', 1), { runId: 'run-5', tokens: 10, at: 1 })
  sbB.setRow('spend', spendRowId('sbB', 1), { runId: 'run-5', tokens: 20, at: 1 })
  sync(orch, sbA); sync(orch, sbB)
  const n = Object.keys(orch.getTable('spend')).length
  observe(`two concurrent first-writes -> ${n} rows, zero collisions`, n === 2)
  // receipts are pointers: reject content-shaped receipts at the guard
  const v = guardViolation('receipts', 'run-5:gate', { verdict: 'PASS' }, undefined, 'sbA', 1)
  observe(`receipt without sha+path rejected by guard: "${v}"`, !!v)
  const ok = guardViolation('receipts', 'run-5:gate', { sha: 'abc123', path: 'gate-receipt.json', verdict: 'PASS' }, undefined, 'sbA', 1)
  observe(`pointer-shaped receipt accepted`, ok === null)
}

export const runAll = () => { observations = []; S1(); S2(); S3(); S4(); S5(); return observations }

if (import.meta.url === `file://${process.argv[1]}`) {
  const obs = runAll()
  const surprises = obs.filter(([, ok]) => !ok)
  console.log(B(`\n${obs.length} observations, ${surprises.length} surprises`))
  process.exit(surprises.length ? 1 : 0)
}
