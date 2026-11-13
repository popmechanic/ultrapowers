/**
 * fleet/tests/test_run_read.mjs — `fleet/run-read.mjs`: a run read from the evidence record.
 *
 *   (a) projectRun: a log with two plan tasks, a give-back, an objection, a moved main, a conflict,
 *       an engine-made task and the publish gives each task its state and one timeline line per
 *       row worth one, in log order, with the row's place as `n` and the row count as `cursor`.
 *   (b) renderRun: the header names the state, phase and pull request; `since` drops lines at or
 *       before that row; the last line is `cursor <rows>`.
 *   (c) readRunRecord: the tag is read first; when it holds neither file the live branch is read
 *       and the record says `live`; when neither ref holds the run the answer is null. Every read
 *       is `gh api` with the raw media type, and names the evidence repository, the run's folder
 *       and the ref.
 *   (d) listLive: the live branches of one target, as `{ target, run, branch }`, in run order.
 *   (e) main: `--run … --target …` prints the rendering; `--json` prints the projection with its
 *       `ref`; a run with no record is a refusal beginning `run-read:`; so is a missing `--run`.
 *   (f) follow: each timeline line prints once, in order, across looks; a claim older than the
 *       quiet window prints one `!` line; a run with no new line for the window prints one; the
 *       follow ends 0 with one `== run-<N> <state>` line when every run's status says it ended,
 *       and 3 with `== gave up` at the limit. A run with no record yet is waited for.
 *   (g) followReader: a run is asked on its live branch first, its tag only once that is gone,
 *       and its plan once; `--follow` through `main` prints the header and the lines.
 */
import assert from 'node:assert/strict'

import { projectRun, renderRun, readRunRecord, listLive, main, follow, followReader, parseArgs } from '../run-read.mjs'

const T = (s) => `2026-11-13T18:${s}Z`
const ROWS = [
  { kind: 'start', ts: T('54:47') },
  { kind: 'session:start', agent: 'A', task: '1', ts: T('54:48') },
  { kind: 'session:start', agent: 'B', task: '2', ts: T('54:48') },
  { kind: 'tool', agent: 'A', task: '1', tool: 'Edit', ts: T('54:50') },
  { kind: 'session:end', agent: 'B', task: '2', released: 'blocked on task 1', ts: T('55:00') },
  { kind: 'session:start', agent: 'B', task: '2', ts: T('55:02') },
  { kind: 'main:moved', to: '2fb0b3310ba4', why: 'poll', changed: 3, ts: T('56:50') },
  { kind: 'conflict:open', path: 'a.txt', ts: T('56:51') },
  { kind: 'resolve-task', path: 'a.txt', ts: T('56:52') },
  { kind: 'session:end', agent: 'A', task: '1', done: 'wrote it', ts: T('57:00') },
  { kind: 'session:end', agent: 'B', task: '2', objected: 'M1 and M2 cannot both hold', released: false, ts: T('57:05') },
  { kind: 'objection', agent: 'B', task: '2', reason: 'M1 and M2 cannot both hold', ts: T('57:05') },
  { kind: 'task:parked', task: '2', releases: 1, objected: true, ts: T('57:05') },
  { kind: 'terminal', pr: 'draft', why: 'objection on task 2: M1 and M2 cannot both hold', ts: T('57:10') },
  { kind: 'publish:pr', url: 'https://github.com/o/r/pull/7', draft: true, ts: T('57:20') }
]
const STATUS = { run: '300', state: 'parked', phase: 'the pull request is open', pr: 'https://github.com/o/r/pull/7', merged: null, tasks: { 1: { state: 'folded' }, 2: { state: 'parked' } } }
const PLAN = { tasks: [{ id: '1', title: 'Write A' }, { id: '2', title: 'Write B' }] }

// ── (a) projectRun ──
const p = projectRun({ run: 300, target: 'o/r', rows: ROWS, status: STATUS, plan: PLAN })
{
  assert.equal(p.cursor, ROWS.length, '(a) cursor is the row count')
  assert.deepEqual(p.tasks.map((t) => [t.id, t.title, t.state]), [['1', 'Write A', 'done'], ['2', 'Write B', 'parked'], ['R:a.txt', '', 'ready']],
    `(a) each task's state — got ${JSON.stringify(p.tasks)}`)
  assert.deepEqual(p.timeline.map((r) => [r.n, r.task, r.what]), [
    [2, '1', 'claimed by A'], [3, '2', 'claimed by B'], [5, '2', 'B gave it back: blocked on task 1'], [6, '2', 'claimed by B'],
    [7, null, 'main moved to 2fb0b33 (poll), 3 files taken in'], [8, null, 'conflict opened in a.txt'],
    [9, 'R:a.txt', 'added by the engine: resolve the conflict'], [10, '1', 'done by A'],
    [12, '2', 'B objected: M1 and M2 cannot both hold'], [13, '2', 'parked for the operator'],
    [14, null, 'ended draft: objection on task 2: M1 and M2 cannot both hold'], [15, null, 'pull request opened as a draft: https://github.com/o/r/pull/7']
  ], `(a) the timeline — got ${JSON.stringify(p.timeline.map((r) => [r.n, r.task, r.what]))}`)
  assert.equal(p.state, 'parked'); assert.equal(p.pr, 'https://github.com/o/r/pull/7')
  const bare = projectRun({ run: 1, target: 'o/r', rows: [], status: null })
  assert.ok(bare.cursor === 0 && bare.tasks.length === 0 && bare.state === null, '(a) an empty record projects to nothing')
}

// ── (b) renderRun ──
{
  const text = renderRun(p).split('\n')
  assert.equal(text[0], '== run-300 parked: the pull request is open  https://github.com/o/r/pull/7', `(b) the header — got ${text[0]}`)
  assert.equal(text.at(-1), 'cursor 15', '(b) the last line is the cursor')
  assert.ok(text.some((l) => l.endsWith('main moved to 2fb0b33 (poll), 3 files taken in')), '(b) a run-level line is printed')
  const later = renderRun(p, { since: 12 }).split('\n')
  assert.deepEqual(later.slice(later.indexOf('== events') + 1, -1).map((l) => l.trim().split(/\s+/).slice(1).join(' ')),
    ['task 2 parked for the operator', 'run ended draft: objection on task 2: M1 and M2 cannot both hold', 'run pull request opened as a draft: https://github.com/o/r/pull/7'],
    `(b) --since drops earlier lines — got ${JSON.stringify(later)}`)
}

// ── the gh stub: a table of `<path>?ref=<ref>` -> text ──
const stub = (files, refs = []) => {
  const calls = []
  const exec = async (cmd, argv) => {
    calls.push([cmd, ...argv])
    const url = argv[argv.length - 1]
    if (url.includes('/git/matching-refs/')) return { code: 0, stdout: JSON.stringify([refs.map((ref) => ({ ref }))]) }
    return Object.hasOwn(files, url) ? { code: 0, stdout: files[url] } : { code: 1, stdout: '', stderr: 'HTTP 404' }
  }
  return { exec, calls }
}
const at = (file, ref) => `repos/e/v/contents/runs/o-r/300/${file}?ref=${encodeURIComponent(ref)}`
const LOG = ROWS.map((r) => JSON.stringify(r)).join('\n') + '\n'

// ── (c) readRunRecord ──
{
  const tagged = stub({ [at('events.jsonl', 'o-r/run-300')]: LOG, [at('status.json', 'o-r/run-300')]: JSON.stringify(STATUS), [at('plan.json', 'o-r/run-300')]: JSON.stringify(PLAN) })
  const rec = await readRunRecord({ exec: tagged.exec, evidence: 'e/v', target: 'o/r', run: 300 })
  assert.ok(rec && rec.ref === 'o-r/run-300' && rec.live === false && rec.rows.length === ROWS.length && rec.status.state === 'parked' && rec.plan.tasks.length === 2, `(c) the tag's record — got ${JSON.stringify(rec && { ref: rec.ref, live: rec.live, rows: rec.rows.length })}`)
  assert.ok(tagged.calls.every((c) => c[0] === 'gh' && c[1] === 'api' && c.includes('Accept: application/vnd.github.raw')), '(c) every read is gh api with the raw media type')
  const flying = stub({ [at('events.jsonl', 'live/o-r/run-300')]: LOG })
  const live = await readRunRecord({ exec: flying.exec, evidence: 'e/v', target: 'o/r', run: 300 })
  assert.ok(live && live.ref === 'live/o-r/run-300' && live.live === true && live.status === null, `(c) a run with no tag is read from its live branch — got ${JSON.stringify(live && { ref: live.ref, live: live.live })}`)
  assert.ok(flying.calls[0].at(-1) === at('events.jsonl', 'o-r/run-300'), '(c) the tag is asked first')
  assert.equal(await readRunRecord({ exec: stub({}).exec, evidence: 'e/v', target: 'o/r', run: 300 }), null, '(c) no ref holds the run: null')
}

// ── (d) listLive ──
{
  const s = stub({}, ['refs/heads/live/o-r/run-31', 'refs/heads/live/o-r/run-4', 'refs/heads/live/o-r/notes'])
  const live = await listLive({ exec: s.exec, evidence: 'e/v', target: 'o/r' })
  assert.deepEqual(live, [{ target: 'o-r', run: 4, branch: 'live/o-r/run-4' }, { target: 'o-r', run: 31, branch: 'live/o-r/run-31' }], `(d) the live runs in order — got ${JSON.stringify(live)}`)
  assert.ok(s.calls[0].at(-1) === 'repos/e/v/git/matching-refs/heads/live/o-r/', '(d) one listing, of that target\'s live branches')
}

// ── (e) main ──
{
  const s = stub({ [at('events.jsonl', 'o-r/run-300')]: LOG, [at('status.json', 'o-r/run-300')]: JSON.stringify(STATUS) })
  let out = ''
  await main(['--run', '300', '--target', 'o/r', '--evidence-repo', 'e/v'], { exec: s.exec, write: (x) => { out += x } })
  assert.ok(out.startsWith('== run-300 parked') && out.trimEnd().endsWith('cursor 15'), `(e) the rendering — got ${out.slice(0, 80)}`)
  let js = ''
  await main(['--run', '300', '--target', 'o/r', '--evidence-repo', 'e/v', '--json'], { exec: s.exec, write: (x) => { js += x } })
  const parsed = JSON.parse(js)
  assert.ok(parsed.length === 1 && parsed[0].ref === 'o-r/run-300' && parsed[0].timeline.length === 12, '(e) --json prints the projection with its ref')
  await assert.rejects(() => main(['--run', '9', '--target', 'o/r', '--evidence-repo', 'e/v'], { exec: stub({}).exec, write: () => {} }), (e) => /^run-read: no record for run 9/.test(e.message), '(e) a run with no record is refused')
  await assert.rejects(() => main(['--target', 'o/r', '--evidence-repo', 'e/v'], { exec: stub({}).exec, write: () => {} }), (e) => /^run-read: --run and --target are required/.test(e.message), '(e) a missing --run is refused')
}

// ── (f) follow ──
{
  const looksOf = (n, status) => [{ ...projectRun({ run: 300, target: 'o/r', rows: ROWS.slice(0, n), status, plan: PLAN }) }]
  const running = { state: 'running', phase: 'the engine is running' }
  // three looks: nothing yet, six rows at work, the whole log ended
  const seq = [[null], looksOf(6, running), looksOf(6, running), looksOf(ROWS.length, STATUS)]
  let i = 0, clock = Date.parse(T('58:00')); const lines = []
  const rc = await follow({
    read: async () => seq[Math.min(i++, seq.length - 1)], write: (s) => lines.push(s.trimEnd()), runs: [300],
    now: () => clock, sleep: async (ms) => { clock += ms }
  })
  assert.equal(rc, 0, '(f) ends 0 when the status says the run ended')
  assert.equal(i, 4, '(f) it looks until the run has ended and no further')
  const body = lines.filter((l) => !l.startsWith('=='))
  assert.equal(body.length, 12, `(f) each timeline line once — got ${JSON.stringify(body)}`)
  assert.equal(body[0], '  18:54:48Z run-300 task 1     claimed by A', `(f) a line's shape — got ${body[0]}`)
  assert.ok(body[3].endsWith('task 2     claimed by B') && body[4].includes('main moved to 2fb0b33'), '(f) the second look prints only what the first did not')
  assert.equal(lines.at(-1), '== run-300 parked: the pull request is open  https://github.com/o/r/pull/7', `(f) the last line names the end — got ${lines.at(-1)}`)

  // a claim that sits: one `!` for the claim, one for the quiet run, each once, then the limit
  let c2 = Date.parse(T('55:10')); const out2 = []
  const rc2 = await follow({
    read: async () => looksOf(6, running), write: (s) => out2.push(s.trimEnd()), runs: [300],
    quietMs: 5 * 60000, maxMs: 20 * 60000, everyMs: 60000, now: () => c2, sleep: async (ms) => { c2 += ms }
  })
  assert.equal(rc2, 3, '(f) the limit ends 3')
  assert.equal(out2.at(-1), '== gave up')
  const bangs = out2.filter((l) => l.startsWith('!'))
  assert.deepEqual(bangs, ['! run-300 task 1 claimed by A 5 min ago, and nothing since', '! run-300 task 2 claimed by B 5 min ago, and nothing since', '! no new line for 5 min'],
    `(f) each warning once — got ${JSON.stringify(bangs)}`)
}

// ── (g) followReader, and --follow through main ──
{
  const live = (file) => at(file, 'live/o-r/run-300')
  const files = { [live('events.jsonl')]: ROWS.slice(0, 6).map((r) => JSON.stringify(r)).join('\n') + '\n', [live('status.json')]: JSON.stringify({ state: 'running' }), [live('plan.json')]: JSON.stringify(PLAN) }
  const s = stub(files)
  const read = followReader({ exec: s.exec, evidence: 'e/v', target: 'o/r', runs: [300] })
  const first = await read()
  assert.ok(first[0].live === true && first[0].tasks[0].title === 'Write A' && first[0].cursor === 6, '(g) the live branch is read, with the plan\'s titles')
  assert.deepEqual(s.calls.map((c) => c.at(-1)), [live('events.jsonl'), live('status.json'), live('plan.json')], `(g) live first, three reads — got ${JSON.stringify(s.calls.map((c) => c.at(-1)))}`)
  s.calls.length = 0
  const second = await read()
  assert.deepEqual(s.calls.map((c) => c.at(-1)), [live('events.jsonl'), live('status.json')], '(g) the plan is read once')
  assert.equal(second[0].tasks[0].title, 'Write A', '(g) and its titles are kept')
  // the run ends: the live branch is gone and the tag holds the record
  for (const k of Object.keys(files)) delete files[k]
  files[at('events.jsonl', 'o-r/run-300')] = LOG; files[at('status.json', 'o-r/run-300')] = JSON.stringify(STATUS)
  const third = await read()
  assert.ok(third[0].live === false && third[0].state === 'parked' && third[0].ref === 'o-r/run-300', '(g) once the live branch is gone the tag is read')
  assert.deepEqual(await followReader({ exec: stub({}).exec, evidence: 'e/v', target: 'o/r', runs: [9] })(), [null], '(g) a run with no record yet is null')

  let out = ''
  const rc = await main(['--run', '300', '--target', 'o/r', '--evidence-repo', 'e/v', '--follow'], { exec: s.exec, write: (x) => { out += x }, sleep: async () => {} })
  assert.equal(rc, 0)
  const printed = out.trimEnd().split('\n')
  assert.ok(printed[0].startsWith('== following') && printed.length === 14 && printed.at(-1).startsWith('== run-300 parked'), `(g) --follow prints the header, the lines and the end — got ${JSON.stringify(printed)}`)
  assert.throws(() => parseArgs(['--run', '1', '--target', 'o/r', '--follow', '--json']), /^Refusal: run-read: --follow prints lines|run-read: --follow prints lines/, '(g) --follow refuses --json')
  assert.equal(parseArgs(['--run', '1', '--target', 'o/r', '--follow', '--quiet', '3']).quietMinutes, 3)
}

console.log('ALL TESTS PASSED')
