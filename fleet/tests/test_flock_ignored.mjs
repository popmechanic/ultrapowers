#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { flockTarget, flockRun, task, writePlan } from './_flock_helpers.mjs'

const fails = []
const one = (id, file, run) => task({ id, title: `Write ${file}`, files: [`Modify: \`${file}\``], claim: `${file} is rewritten.`, run, stale: `path-absent: \`${file}\`` })
const landed = (t, r) => {
  const sha = (r.of('landing').at(-1) || {}).candidateSha
  const tree = sha ? t.git('ls-tree', '-r', '--name-only', sha).split('\n') : []
  const show = (p) => { try { return sha ? t.git('show', sha + ':' + p) : null } catch { return null } }
  return { tree, show }
}
const kinds = (r, p) => (r.rows || []).filter((x) => x.path === p).map((x) => x.kind)

{
  const t0 = flockTarget({ 'a.txt': 'a\n', '.gitignore': 'kept.txt\n' })
  fs.writeFileSync(path.join(t0.T, 'kept.txt'), 'k\n'); t0.git('add', '-f', 'kept.txt'); t0.git('commit', '-qm', 'kept')
  const t = { ...t0, base: t0.git('rev-parse', 'HEAD') }
  const plan = writePlan(t, { claim: 'a.txt says A.', check: 'test -f a.txt', tasks: [one(1, 'a.txt', 'grep -q A a.txt')] })
  const r = await flockRun(t, { plan, script: { 1: { '.gitignore': 'kept.txt\nstate.db\n', 'state.db': 'local\n', 'kept.txt': 'K\n', 'a.txt': 'A\n' } } })
  const { tree, show } = landed(t, r)
  if (show('a.txt') !== 'A') fails.push('(a) a.txt did not land')
  if (tree.includes('state.db')) fails.push('(a) the ignored state.db landed')
  if ((r.rows || []).some((x) => JSON.stringify(x).includes('state.db'))) fails.push('(a) a row names the ignored state.db')
  if (show('kept.txt') !== 'K') fails.push('(a) kept.txt, tracked and ignored, did not land')
  t.done()
}

{
  const t = flockTarget({ 'a.txt': 'a\n', 'data.txt': 'x\n' })
  const plan = writePlan(t, { claim: 'a.txt says A.', check: 'test -f a.txt', tasks: [one(1, 'a.txt', "printf '\\377\\376\\001' > data.txt && grep -q A a.txt")] })
  const r = await flockRun(t, { plan, script: { 1: { 'a.txt': 'A\n' } } })
  const { show } = landed(t, r)
  if (show('a.txt') !== 'A') fails.push('(b) a.txt did not land')
  if (show('data.txt') !== 'x') fails.push(`(b) data.txt landed as ${JSON.stringify(show('data.txt'))}, expected its base text`)
  if (kinds(r, 'data.txt').includes('fallback')) fails.push('(b) data.txt was rewritten as text')
  if (!kinds(r, 'data.txt').includes('non-text')) fails.push('(b) no non-text row for data.txt')
  t.done()
}

{
  const t = flockTarget({ 'a.txt': 'a\n', 'd.txt': 'd\n' })
  const plan = writePlan(t, { claim: 'a.txt says A.', check: 'test -f a.txt', tasks: [one(1, 'a.txt', 'if test -f d.txt; then rm d.txt && mkdir d.txt && echo i > d.txt/i.txt; fi; grep -q A a.txt')] })
  const r = await flockRun(t, { plan, script: { 1: { 'a.txt': 'A\n' } } })
  const { tree } = landed(t, r)
  if (tree.includes('d.txt')) fails.push('(c) d.txt, replaced by a directory, still landed as a file')
  if (!tree.includes('d.txt/i.txt')) fails.push('(c) d.txt/i.txt did not land')
  t.done()
}

{
  const t = flockTarget({ 'a.txt': 'a\n', 'b.txt': 'b\n' })
  const plan = writePlan(t, { claim: 'a.txt says A and b.txt says B.', check: 'test -f a.txt', tasks: [one(1, 'a.txt', 'grep -q A a.txt'), one(2, 'b.txt', 'grep -q B b.txt')] })
  const r = await flockRun(t, { plan, script: { 1: { 'a.txt': 'A\n', 'state.db': 'local\n' }, 2: { 'b.txt': 'B\n', '.gitignore': 'state.db\n' }, '@hold_ms': { 2: 6000 } } })
  const { tree, show } = landed(t, r)
  if (show('a.txt') !== 'A' || show('b.txt') !== 'B') fails.push('(d) a.txt or b.txt did not land')
  if (!tree.includes('.gitignore')) fails.push('(d) .gitignore did not land')
  if (tree.includes('state.db')) fails.push('(d) state.db landed although a later rule ignores it')
  if (!(r.rows || []).some((x) => x.kind === 'fallback' && x.path === 'state.db' && x.ignored && x.deleted)) fails.push('(d) no row records state.db leaving the weave')
  t.done()
}

if (fails.length) {
  console.log(`IGNORED FAILED: ${fails.join('; ')}`)
  process.exit(1)
}
console.log('ALL TESTS PASSED')
