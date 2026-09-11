// fleet/tests/test_run_engine_joined_proofs.mjs — the integrated pass re-runs a
// task's `Run:` lines only when one of that task's Files appears in the fold's
// joined paths (#887; #871 decision 1).
//
// At BASE the integrated pass re-runs EVERY merged task's `Run:` commands on the
// adopted tree and parks the run on any red. That is two separate mistakes: a
// task whose files nobody else in the wave touched is being re-measured against
// a tree that cannot have changed its answer, and a red that the fold — not the
// task — produced is minted as a blocking completeness finding, which is a gate
// the #871 decision says an unattributed red does not get. This sim pins the
// rule that replaces it: compute the wave's JOINED paths, re-run only the tasks
// standing on one, and report a red there with the pair named.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the real `sh`); only the judgments are canned, so every command
// execution the assertions observe is the driver's own — the same rig
// test_run_engine_integrated_runs.mjs uses.
//
// Machine clauses under test (verbatim from the task):
//   M1 — after a wave is adopted, the engine computes `joined` = every path that
//        appears in the touch set of at least two of the wave's merged tasks,
//        where a task's touch set is its declared `files` united with the paths
//        its captured patch changes (the `diff --git a/<p> b/<p>` headers), and
//        records it as `waveMerges[w].joined` (an array, `[]` when none).
//   M2 — a merged task's `proofRuns` are executed on the integrated tree if and
//        only if its touch set intersects `joined`; a single-task wave and a
//        wave whose tasks' touch sets are pairwise disjoint execute none, and
//        `report.integratedRuns` and the `driver:integrated-run` events carry
//        exactly the executed commands.
//   M3 — each `driver:integrated-run` event and each `integratedRuns` item
//        carries `joined` (the paths of the task's touch set that are in
//        `joined`) and `with` (the ids of the other tasks whose touch sets share
//        them, in plan order).
//   M4 — a non-zero integrated `Run:` exit pushes no blocking finding and does
//        not block the run: the run's report has no completeness finding whose
//        detail begins `integrated Run:`, and `judgmentCalls` carries one line
//        `task <id>'s proof <cmd> went red on the fold of <path> with task
//        <other>` (paths and other ids comma-joined when several).
//   M5 — `Check:` commands still run on the integrated tree for every adopted
//        wave with the blocking behaviour they have today, and the per-task
//        pre-review `Run:` pass is unchanged.
//   M6 — `skills/ultrapowers/references/report-format.md`'s `integratedRuns` row
//        and `fleet/roles/critic.md`'s INTEGRATED RUN EVIDENCE paragraph say a
//        red integrated run is reported with the pair named and is not a
//        blocking finding.
//
// Legs: (a) M1, (b) M2, (c) M3, (d) M4, (e) M5, (f) M6.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rig, makeRepo, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-joined-proofs-'))
// Removed on exit, red or green.
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

const REPORT_FORMAT = fileURLToPath(
  new URL('../../skills/ultrapowers/references/report-format.md', import.meta.url))
const CRITIC_ROLE = fileURLToPath(new URL('../roles/critic.md', import.meta.url))

const mkTask = (id, files, over = {}) => ({
  id, title: id.toLowerCase(), files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofTests: [], proofRuns: [],
  body: 'task ' + id + ' body', ...over,
})

// The run's own record. An absent file reads as no records, so an engine that
// writes none fails a count assertion rather than an ENOENT.
const eventsOf = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const integratedEvents = (runDir) =>
  eventsOf(runDir).filter((e) => e.kind === 'driver:integrated-run')
// The four fields the shipped event already carried, so an event that also
// carries M3's two (and appendEvent's id/ts stamp) still compares equal here.
const eventShape = (e) => ({ task: e.task, cmd: e.cmd, exit: e.exit, wave: e.wave })
const runShape = (r) => ({ task: r.task, cmd: r.cmd, exit: r.exit })

// One wave, canned judgments, real everything else. `writes` is
// { <task id>: { <relative path>: <contents> } } — what that task's implementer
// stub leaves in its own clone, which is what `withPatchCapture` then captures
// as the task's patch.
function fixture({ name, tasks, writes, constraintChecks = null }) {
  const repo = makeRepo(path.join(tmp, 'repo-' + name))
  const runDir = path.join(tmp, 'run-' + name)
  const dispatched = []
  const prompts = {}
  const { run: inner, ...rest } = rig({
    repo, runDir, waves: [tasks], stamp: name,
    ...(constraintChecks ? { extraArgs: { constraintChecks } } : {}),
    stub: (prompt, opts, cwd) => {
      dispatched.push(opts.label)
      prompts[opts.label] = prompt
      // The rig stubs the agent, so run-worker's own `worker:start` line never
      // reaches this run's event log. The stub stands in for the worker and
      // writes the line the worker would, which is what lets leg (e) ask its
      // ordering question of `events.jsonl` itself rather than of a side channel.
      fs.appendFileSync(path.join(runDir, 'events.jsonl'),
        JSON.stringify({ kind: 'worker:start', label: opts.label }) + '\n')
      const kind = opts.label.split(':')[0]
      if (kind === 'impl') {
        const id = opts.label.split(':')[1]
        for (const [rel, body] of Object.entries(writes[id] || {})) {
          fs.writeFileSync(path.join(cwd, rel), body)
        }
        return doneImpl(cwd)
      }
      if (kind === 'review') return passReview()
      // Never expected in these fixtures — every proof below is green in its own
      // clone. Answered rather than thrown so the leg's precondition names it.
      if (kind === 'fix') return doneImpl(cwd)
      if (opts.label === 'integration') return cleanCritic()
      throw new Error('unexpected dispatch: ' + opts.label)
    },
  })
  return { run: inner, runDir, dispatched, prompts, ...rest }
}

// Every fixture's precondition: nothing went red in a clone, so whatever the
// integrated pass does below is the integrated pass's own doing.
function assertClean(name, report, dispatched, planned) {
  assert.ok(!dispatched.some((l) => l.startsWith('fix:')),
    name + ': sim precondition — every proof is green in its own clone, so no ' +
    'fix round is dispatched: ' + dispatched.join(','))
  assert.equal(report.coverage.complete, true,
    name + ': sim precondition — all ' + planned + ' tasks merged: ' +
    JSON.stringify(report.tasks.map((t) => ({ task: t.task, status: t.status }))))
  assert.equal(report.waveMerges[0].status, 'MERGED',
    name + ': sim precondition — the wave was adopted: ' +
    JSON.stringify(report.waveMerges[0]))
}

// ── the fixtures ─────────────────────────────────────────────────────────────
// JOINED: A and B both write `shared.txt` (identical bytes, so the fold takes
// both), A also `a.txt`, B also `b.txt`. Neither declares `shared.txt`, so the
// join here can only come from the captured patches. A carries two `Run:`
// proofs, B one — leg (b)'s three.
const joined = fixture({
  name: 'jp-join',
  tasks: [
    mkTask('A', ['a.txt'], { proofRuns: ['test -e a.txt', 'test -e shared.txt'] }),
    mkTask('B', ['b.txt'], { proofRuns: ['test -e b.txt'] }),
  ],
  writes: {
    A: { 'a.txt': 'from-A\n', 'shared.txt': 'shared\n' },
    B: { 'b.txt': 'from-B\n', 'shared.txt': 'shared\n' },
  },
})
// DISJOINT: the same wave without the shared path — pairwise disjoint touch sets.
const disjoint = fixture({
  name: 'jp-disj',
  tasks: [
    mkTask('A', ['a.txt'], { proofRuns: ['test -e a.txt'] }),
    mkTask('B', ['b.txt'], { proofRuns: ['test -e b.txt'] }),
  ],
  writes: { A: { 'a.txt': 'from-A\n' }, B: { 'b.txt': 'from-B\n' } },
})
// DECLARED: A's `files` lists `shared.txt` but A's stub never writes it; B's
// stub does. A `joined` read off the patches alone is `[]` here.
const declared = fixture({
  name: 'jp-decl',
  tasks: [
    mkTask('A', ['a.txt', 'shared.txt'], { proofRuns: ['test -e a.txt'] }),
    mkTask('B', ['b.txt', 'shared.txt'], { proofRuns: ['test -e b.txt'] }),
  ],
  writes: {
    A: { 'a.txt': 'from-A\n' },
    B: { 'b.txt': 'from-B\n', 'shared.txt': 'shared\n' },
  },
})
// SOLO: one task, one `Run:` proof — nothing to join with.
const solo = fixture({
  name: 'jp-solo',
  tasks: [mkTask('A', ['a.txt'], { proofRuns: ['test -e a.txt'] })],
  writes: { A: { 'a.txt': 'from-A\n' } },
})
// TRIO: A and B share `shared.txt`; C stands alone on `c.txt`.
const trio = fixture({
  name: 'jp-trio',
  tasks: [
    mkTask('A', ['a.txt'], { proofRuns: ['test -e a.txt'] }),
    mkTask('B', ['b.txt'], { proofRuns: ['test -e b.txt'] }),
    mkTask('C', ['c.txt'], { proofRuns: ['test -e c.txt'] }),
  ],
  writes: {
    A: { 'a.txt': 'from-A\n', 'shared.txt': 'shared\n' },
    B: { 'b.txt': 'from-B\n', 'shared.txt': 'shared\n' },
    C: { 'c.txt': 'from-C\n' },
  },
})

const joinedReport = await joined.run()
const disjointReport = await disjoint.run()
const declaredReport = await declared.run()
const soloReport = await solo.run()
const trioReport = await trio.run()

assertClean('joined', joinedReport, joined.dispatched, 2)
assertClean('disjoint', disjointReport, disjoint.dispatched, 2)
assertClean('declared', declaredReport, declared.dispatched, 2)
assertClean('solo', soloReport, solo.dispatched, 1)
assertClean('trio', trioReport, trio.dispatched, 3)

// ── leg (a): the wave's joined paths, on the waveMerges row [M1] ─────────────
{
  // [M1] the join computed from what the patches changed.
  assert.deepEqual(joinedReport.waveMerges[0].joined, ['shared.txt'],
    '[M1] a wave whose two implementers both wrote `shared.txt` must record ' +
    '`waveMerges[0].joined` = ["shared.txt"]; got ' +
    JSON.stringify(joinedReport.waveMerges[0].joined) + ' on the row ' +
    JSON.stringify(joinedReport.waveMerges[0]))

  // [M1] no path in two touch sets ⇒ the array is present and empty, never absent.
  assert.deepEqual(disjointReport.waveMerges[0].joined, [],
    '[M1] a wave writing only `a.txt` and `b.txt` must record `joined` = [] — ' +
    'an array, not an absent key: ' + JSON.stringify(disjointReport.waveMerges[0]))

  // [M1] the declared half of the touch set: A never wrote `shared.txt`, it only
  // declared it. A `joined` computed from the patches alone leaves this [].
  assert.deepEqual(declaredReport.waveMerges[0].joined, ['shared.txt'],
    '[M1] a task\'s touch set is its declared `files` UNITED with the paths its ' +
    'patch changed: A declares `shared.txt` and writes only `a.txt`, B writes ' +
    '`shared.txt`, so `joined` = ["shared.txt"]; got ' +
    JSON.stringify(declaredReport.waveMerges[0].joined))

  // [M1] a single-task wave has no second touch set to intersect with.
  assert.deepEqual(soloReport.waveMerges[0].joined, [],
    '[M1] a single-task wave joins nothing: ' + JSON.stringify(soloReport.waveMerges[0]))

  // [M1] three tasks, one shared path — C's `c.txt` is nobody else's.
  assert.deepEqual(trioReport.waveMerges[0].joined, ['shared.txt'],
    '[M1] only the path in at least two touch sets is joined; `c.txt` is in one: ' +
    JSON.stringify(trioReport.waveMerges[0].joined))
}

// ── leg (b): executed if and only if the touch set meets `joined` [M2] ───────
{
  // [M2] the joined wave: A's two commands then B's one, in plan order, and
  // exactly one event per executed command.
  assert.deepEqual(joinedReport.integratedRuns.map(runShape), [
    { task: 'A', cmd: 'test -e a.txt', exit: 0 },
    { task: 'A', cmd: 'test -e shared.txt', exit: 0 },
    { task: 'B', cmd: 'test -e b.txt', exit: 0 },
  ], '[M2] both tasks stand on `shared.txt`, so all three commands run on the ' +
     'integrated tree, in plan order: ' + JSON.stringify(joinedReport.integratedRuns.map(runShape)))
  assert.deepEqual(integratedEvents(joined.runDir).map(eventShape), [
    { task: 'A', cmd: 'test -e a.txt', exit: 0, wave: 1 },
    { task: 'A', cmd: 'test -e shared.txt', exit: 0, wave: 1 },
    { task: 'B', cmd: 'test -e b.txt', exit: 0, wave: 1 },
  ], '[M2] three `driver:integrated-run` events, one per executed command')

  // [M2] pairwise-disjoint touch sets execute none.
  assert.deepEqual(disjointReport.integratedRuns, [],
    '[M2] a wave whose tasks\' touch sets are pairwise disjoint re-runs no ' +
    '`Run:` line on the integrated tree: ' + JSON.stringify(disjointReport.integratedRuns))
  assert.deepEqual(integratedEvents(disjoint.runDir), [],
    '[M2] and writes no `driver:integrated-run` event at all')

  // [M2] a single-task wave executes none.
  assert.deepEqual(soloReport.integratedRuns, [],
    '[M2] a single-task wave re-runs nothing on the integrated tree: ' +
    JSON.stringify(soloReport.integratedRuns))
  assert.deepEqual(integratedEvents(solo.runDir), [],
    '[M2] and writes no `driver:integrated-run` event at all')

  // [M2] the unjoined task of a joined wave: C's proof is not executed, A's and
  // B's are. `exactly the executed commands` is the whole clause, so this is an
  // equality on the list, not a `does not include C`.
  assert.deepEqual(trioReport.integratedRuns.map(runShape), [
    { task: 'A', cmd: 'test -e a.txt', exit: 0 },
    { task: 'B', cmd: 'test -e b.txt', exit: 0 },
  ], '[M2] C touches only `c.txt`, which is in no other touch set, so C\'s proof ' +
     'is not re-run while A\'s and B\'s are: ' +
     JSON.stringify(trioReport.integratedRuns.map(runShape)))
  assert.deepEqual(integratedEvents(trio.runDir).map(eventShape), [
    { task: 'A', cmd: 'test -e a.txt', exit: 0, wave: 1 },
    { task: 'B', cmd: 'test -e b.txt', exit: 0, wave: 1 },
  ], '[M2] and the events carry exactly the executed commands — none of C\'s')
}

// ── leg (c): every item and every event names the join and the partner [M3] ──
{
  const items = joinedReport.integratedRuns
  const evs = integratedEvents(joined.runDir)
  const partner = { A: ['B'], B: ['A'] }
  for (const [what, rows] of [['integratedRuns item', items], ['driver:integrated-run event', evs]]) {
    for (const r of rows) {
      assert.deepEqual(r.joined, ['shared.txt'],
        '[M3] each ' + what + ' carries `joined` — the paths of THIS task\'s touch ' +
        'set that are in the wave\'s joined set: want ["shared.txt"], got ' +
        JSON.stringify(r.joined) + ' on ' + JSON.stringify(runShape(r)))
      assert.deepEqual(r.with, partner[r.task],
        '[M3] each ' + what + ' carries `with` — the ids of the other tasks whose ' +
        'touch sets share those paths, in plan order: want ' +
        JSON.stringify(partner[r.task]) + ', got ' + JSON.stringify(r.with) +
        ' on ' + JSON.stringify(runShape(r)))
    }
  }
}

// ── leg (d): a red on the fold is reported, not a gate [M4] ─────────────────
// A writes `marker` into `shared.txt`; B declares `shared.txt` and carries the
// proof `! grep -q marker shared.txt`. In B's own clone `shared.txt` does not
// exist, so the proof is green there and no fix round is dispatched; on the fold
// A's marker is present and the proof is red. That difference is what the
// integrated pass exists to find — and what #871 decision 1 says is reported
// with the pair named rather than parked.
{
  const CMD = '! grep -q marker shared.txt'
  const SENTENCE = 'task B\'s proof ' + CMD + ' went red on the fold of shared.txt with task A'
  const red = fixture({
    name: 'jp-red',
    tasks: [
      mkTask('A', ['a.txt', 'shared.txt']),
      mkTask('B', ['b.txt', 'shared.txt'], { proofRuns: [CMD] }),
    ],
    writes: {
      A: { 'a.txt': 'from-A\n', 'shared.txt': 'marker\n' },
      B: { 'b.txt': 'from-B\n' },
    },
  })
  const report = await red.run()
  assertClean('red-on-fold', report, red.dispatched, 2)
  assert.deepEqual(report.waveMerges[0].joined, ['shared.txt'],
    '[M1] sim precondition — A and B are joined on `shared.txt`: ' +
    JSON.stringify(report.waveMerges[0]))

  // The red is recorded: reported, not suppressed.
  assert.deepEqual(report.integratedRuns.map(runShape),
    [{ task: 'B', cmd: CMD, exit: 1 }],
    '[M2] B stands on the join, so its proof is re-run and records exit 1 on ' +
    'the fold: ' + JSON.stringify(report.integratedRuns.map(runShape)))

  // [M4] no blocking finding — and no completeness finding of any severity whose
  // detail begins with the old prefix.
  const integratedRunFindings = (report.completenessFindings || [])
    .filter((f) => f && typeof f === 'object' && String(f.detail || '').startsWith('integrated Run:'))
  assert.deepEqual(integratedRunFindings, [],
    '[M4] a non-zero integrated `Run:` exit must push NO completeness finding ' +
    'whose detail begins `integrated Run:`: ' + JSON.stringify(report.completenessFindings))

  // [M4] and it does not block the run: the critic was reached and no wave parked.
  assert.equal(typeof red.prompts['integration'], 'string',
    '[M4] the run must reach the completeness critic — the red integrated run ' +
    'is not a gate: dispatched ' + red.dispatched.join(','))
  assert.deepEqual(report.blockedWaves, [],
    '[M4] the red integrated run parks no wave: ' + JSON.stringify(report.blockedWaves))

  // [M4] the judgment call, verbatim — one line, equal to the ticket's sentence.
  const matching = report.judgmentCalls.filter((j) => String(j) === SENTENCE)
  assert.equal(matching.length, 1,
    '[M4] `judgmentCalls` must carry exactly one line equal to:\n  ' + SENTENCE +
    '\ngot:\n' + JSON.stringify(report.judgmentCalls, null, 2))
}

// ── leg (e): `Check:` still blocks, and the per-task pass is unchanged [M5] ──
// A separate run from leg (d): the constraint is green in each clone taken
// alone (each holds one of the two files) and red on the fold, which is the only
// place it can be caught.
{
  const CHECK = '! ( test -e x.txt && test -e y.txt )'
  const DETAIL_PREFIX = 'integrated Check:'
  const checked = fixture({
    name: 'jp-check',
    tasks: [
      mkTask('A', ['x.txt'], { proofRuns: ['test -e x.txt'] }),
      mkTask('B', ['y.txt'], { proofRuns: ['test -e y.txt'] }),
    ],
    writes: {
      A: { 'x.txt': 'from-A\n', 'shared.txt': 'shared\n' },
      B: { 'y.txt': 'from-B\n', 'shared.txt': 'shared\n' },
    },
    constraintChecks: [{ cmd: CHECK, minor: false }],
  })
  const report = await checked.run()
  assertClean('check', report, checked.dispatched, 2)

  // [M5] the Check: ran on the integrated tree and blocked, exactly as today.
  assert.deepEqual(report.integratedChecks.map((c) => ({ cmd: c.cmd, exit: c.exit })),
    [{ cmd: CHECK, exit: 1 }],
    '[M5] the Global Constraints `Check:` still runs on the adopted tree: ' +
    JSON.stringify(report.integratedChecks))
  const checkFindings = (report.completenessFindings || [])
    .filter((f) => f && typeof f === 'object' && String(f.detail || '').startsWith(DETAIL_PREFIX))
  assert.equal(checkFindings.length, 1,
    '[M5] exactly one blocking finding beginning `' + DETAIL_PREFIX + '`: ' +
    JSON.stringify(report.completenessFindings))
  assert.equal(checkFindings[0].severity, 'blocking',
    '[M5] a red integrated `Check:` keeps the blocking behaviour it has today: ' +
    JSON.stringify(checkFindings[0]))

  // [M5] the per-task pre-review `Run:` pass is unchanged: in leg (b)'s joined
  // wave each task's `driver:proof-run` events are one per `proofRuns` command,
  // and every one of them precedes that task's first `review:` dispatch.
  const evs = eventsOf(joined.runDir)
  for (const [id, cmds] of [['A', ['test -e a.txt', 'test -e shared.txt']], ['B', ['test -e b.txt']]]) {
    const firstReview = evs.findIndex(
      (e) => e.kind === 'worker:start' && String(e.label || '').startsWith('review:' + id + ':'))
    assert.ok(firstReview >= 0,
      '[M5] sim precondition — task ' + id + ' was dispatched to a reviewer: ' +
      joined.dispatched.join(','))
    const mine = evs
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.kind === 'driver:proof-run' && e.task === id)
    assert.deepEqual(mine.map(({ e }) => e.cmd), cmds,
      '[M5] task ' + id + '\'s pre-review `Run:` pass is one execution per ' +
      '`proofRuns` command, in Proof order: ' + JSON.stringify(mine.map(({ e }) => e.cmd)))
    for (const { e, i } of mine) {
      assert.ok(i < firstReview,
        '[M5] the pre-review execution of `' + e.cmd + '` must precede task ' + id +
        '\'s first `review:` worker:start (index ' + i + ' vs ' + firstReview + ')')
    }
  }
}

// ── leg (f): what the two documents say [M6] ────────────────────────────────
{
  // The `integratedRuns` row of the report-format table.
  const rows = fs.readFileSync(REPORT_FORMAT, 'utf8').split('\n')
    .filter((l) => l.startsWith('| `integratedRuns` |'))
  assert.equal(rows.length, 1,
    '[M6] skills/ultrapowers/references/report-format.md must carry exactly one ' +
    'table line beginning "| `integratedRuns` |"; found ' + rows.length)
  const row = rows[0]
  const GONE = 'blocking completeness finding'
  assert.ok(!row.includes(GONE),
    '[M6] the `integratedRuns` row still calls a non-zero exit a "' + GONE + '" — ' +
    'that is the rule #887 replaced:\n' + row)
  for (const lit of ['joined', 'with', 'reported', 'pair', 'not a blocking']) {
    assert.ok(row.includes(lit),
      '[M6] the `integratedRuns` row does not contain "' + lit + '" — the row must ' +
      'describe the `joined`/`with` fields and say a red is reported with the pair ' +
      'named and is not a blocking finding:\n' + row)
  }

  // The INTEGRATED RUN EVIDENCE section of the critic's role: from the paragraph
  // that names it up to the INTEGRATED CHECK EVIDENCE paragraph, which is a
  // different block and answers for the constraints, not the proofs.
  const critic = fs.readFileSync(CRITIC_ROLE, 'utf8')
  const start = critic.indexOf('INTEGRATED RUN EVIDENCE')
  assert.ok(start >= 0,
    '[M6] fleet/roles/critic.md no longer names INTEGRATED RUN EVIDENCE at all')
  const after = critic.indexOf('INTEGRATED CHECK EVIDENCE', start)
  const section = after === -1 ? critic.slice(start) : critic.slice(start, after)
  // The sentence the task says to keep: the block is authoritative for the
  // commands it lists.
  assert.ok(section.includes('authoritative'),
    '[M6] the INTEGRATED RUN EVIDENCE paragraph must still say the block is ' +
    'authoritative for the commands it lists:\n' + section)
  for (const lit of ['reported', 'not a blocking']) {
    assert.ok(section.includes(lit),
      '[M6] the INTEGRATED RUN EVIDENCE paragraph does not contain "' + lit + '" — ' +
      'it must say a red there is reported, with the pair named, and is not a ' +
      'blocking finding:\n' + section)
  }
}

console.log('ALL TESTS PASSED')
