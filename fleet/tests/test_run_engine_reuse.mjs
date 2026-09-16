/**
 * fleet/tests/test_run_engine_reuse.mjs — two exams in one file, because two
 * tasks name this path in their Proof's `Test:` slot.
 *
 *   • #1037 §1, *the reuse refusal names the fold's own reason* — the CURRENT
 *     task. Its legs are `#1037 (a)`…`#1037 (e)` below, and every assertion
 *     belonging to it carries that prefix.
 *   • #383 Task 2, *a run whose issues are already closed `done` folds that
 *     run's work in at setup and works only the rest* — the standing guard this
 *     file was first written as. Its legs are the bare `(a)`…`(f)` below.
 *
 * This file is the Proof's `Test: fleet/tests/test_run_engine_reuse.mjs`,
 * written where the Proof names it. Every relative import is written for THIS
 * directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * #1037 §1 — the reuse refusal names the fold's own reason
 * ─────────────────────────────────────────────────────────────────────────────
 * Claim: when a relaunch cannot fold the earlier run's finished work back in,
 * the run's record and its log say why in the FOLD's own words — how many
 * conflicts, or which kernel step refused — instead of only that no head came
 * out.
 *
 * The clauses this exam encodes:
 *
 *   M1  For each of the Setup reuse fold's three ways of giving up, the ONE
 *       `driver:reuse` refusal event's `reason` is the sentence `foldReuse`
 *       gave up with; the same sentence its `reuse fold of <tag>: …` judgment
 *       call carries after the colon; and the log line `reuse refused:
 *       <reason>` carries that same sentence.
 *   M2  The shape of each of those three sentences: a conflicting fold names
 *       the count as `<N> conflict(s)` and says `no resolver exists at Setup`;
 *       a missing verdict begins `fold printed no verdict`; a materialize
 *       refusal begins `materialize refused:`.
 *   M3  The phrase `did not produce a head` occurs zero times in
 *       `fleet/run-engine.mjs`.
 *   M4  The reuse paragraph of `fleet/CONTRACT.md`'s `Kata record (engine)`
 *       bullet — the lines from `Re-drive reuse (#383)` to `A refusal is never
 *       the run's own failure.` — says the refusal's `reason` is the fold's
 *       own: the conflict count, the materialize refusal, or the missing
 *       verdict.
 *
 * Its legs, and what each asserts:
 *
 *   #1037 (a) [M1] [M2] A FIFTH refusal row in the table leg (d) below already
 *       loops: task 1's issue closed and stamped with run 6, whose evidence tag
 *       on the sim's own origin carries a `run.patch` that adds `third.txt`
 *       with bytes DIFFERENT from the ones main's own move wrote — an add/add
 *       clash the kernel reports as `conflicts > 0`. Exactly one
 *       `driver:reuse`, whose `reason` matches `/[0-9]+ conflict\(s\)/` and
 *       contains `no resolver exists at Setup`; the engine's log holds one line
 *       beginning `reuse refused: ` whose remainder EQUALS that `reason`; the
 *       report's `judgmentCalls` holds one entry beginning `reuse fold of
 *       ultra/evidence/run-6: ` whose remainder EQUALS that `reason`; no
 *       `--wave 0` materialize ran; and both `impl:1` and `impl:2` are
 *       dispatched off BASE.
 *   #1037 (b) [M1] [M2] A sixth row: task 1 stamped run 9 (the origin's clean
 *       tag) and an exec seam that answers the kernel's `fold … --wave 0` call
 *       itself with empty stdout and exit 3. Exactly one `driver:reuse` whose
 *       `reason` begins `fold printed no verdict (exit 3)`; the log's `reuse
 *       refused: ` remainder and the `reuse fold of ultra/evidence/run-9: `
 *       judgment-call remainder each EQUAL to that `reason`; both implementers
 *       dispatched off BASE.
 *   #1037 (c) [M1] [M2] A seventh row: the same stamp, an exec seam that lets
 *       the `--wave 0` fold through and answers the `materialize … --wave 0`
 *       call with stdout `{"park":"simulated"}` and exit 0. Exactly one
 *       `driver:reuse` whose `reason` begins `materialize refused: simulated`;
 *       the log and judgment-call remainders EQUAL to it; no `headSha` on the
 *       event; both implementers dispatched off BASE.
 *   #1037 (d) [M3] The literal phrase `did not produce a head` occurs zero
 *       times in `fleet/run-engine.mjs` — a surviving line, in code or in a
 *       comment, fails the leg. This is the count the Proof's second `Run:`
 *       line takes with `grep -c`, taken here over the same file's bytes.
 *   #1037 (e) [M4] The contract's reuse paragraph, read as one line, names
 *       `reason`, then `fold's own`, then `conflict`, then `materialize`, then
 *       `verdict`, in that order — a paragraph lacking any of the five fails
 *       the leg. This is the Proof's third `Run:` line's `sed` range and its
 *       ordered grep, read the same way.
 *
 * The reading this file encodes for M1, recorded on the kata issue as well: "the
 * same sentence" is asserted as EQUALITY between three strings taken from three
 * places — the event's `reason` field, the log line's remainder after `reuse
 * refused: `, and the judgment call's remainder after `reuse fold of <tag>: ` —
 * and not as three independent prefix checks against a literal this file spells.
 * The per-row shape assertions pin WHICH sentence it has to be; the equalities
 * pin that one sentence reaches all three places. The sim owns the exit code and
 * the `park` payload legs (b) and (c) turn on, so neither reason is a constant
 * an implementation could name without reading the fold's own answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * #383 Task 2 — the standing guard
 * ─────────────────────────────────────────────────────────────────────────────
 * The legs, and what each asserts — every assertion below names its leg and the
 * Machine clause it comes from, so a reader can map this file back to the
 * contract:
 *
 *   (a) [M1] With two OPEN issues carrying no `work.adopted_*`, the fake hub's
 *       `getIssue` is called exactly once per task, every one of those reads
 *       lands before the `Wave 1` phase mark and before the first worker
 *       dispatch, the exec seam records no `git fetch` at all (and nothing
 *       naming `ultra/evidence`), no `driver:reuse` is appended, and both
 *       `impl:1` and `impl:2` run. The same three facts hold with task 1's
 *       issue `closed` carrying NEITHER key (a `needs-review` task a person
 *       closed) and with it `closed` carrying `work.adopted_run` and no
 *       `work.adopted_sha`.
 *   (b) [M2] With task 1's issue closed and stamped run 9, and the tag
 *       `ultra/evidence/run-9` on the sim's own origin: the exec seam records
 *       the tag fetch in the integration clone, `runDir/reuse/` holds
 *       `report.json` and `run.patch` (the tag's bytes), the kernel is invoked
 *       `fold … --wave 0 --base <report.baseSha>` with exactly two `--patch`
 *       values and then `materialize --wave 0`, and the log carries ONE
 *       `driver:reuse` `{run: 9, tasks: ['1'], headSha}` whose `headSha` is the
 *       integration head wave 1 started from and whose tree carries task 1's
 *       file byte for byte as `run.patch` wrote it.
 *   (c) [M3] In that same run: no `exam:1`, `impl:1`, `review:1:` or `fix:1:`
 *       label is dispatched, the fake's call log holds no `claim`, `close`,
 *       `addLabel` or `patchMetadata` for task 1's uid, `impl:2` runs, task 1
 *       is excluded from wave 1's fold, and its report row is
 *       `{status: 'done', reviewVerdict: 'reused', headSha: <the reuse head>}`.
 *       And in a second layout — wave 1 `['1']` alone, wave 2 `['2']` — wave 1
 *       adopts nothing and task 2's clone starts at the reuse head.
 *   (d) [M4] Four runs, one per refusal (two different runs named; a stamp
 *       naming a run with no tag on the origin; a tag whose `report.json` lists
 *       the reused task `failed`; a tag whose `baseSha` is not on main's
 *       history): each appends exactly one `driver:reuse` carrying a non-empty
 *       `reason` and `tasks: []`, records no reuse head (no `--wave 0` kernel
 *       call, no `headSha` on the event), and runs both `impl:1` and `impl:2`
 *       off BASE.
 *   (e) [M5] With the origin's main advanced past the parked base by a commit
 *       touching `third.txt` and BASE at that tip, the reuse head's tree holds
 *       `third.txt` from that commit AND task 1's file from `run.patch`; the
 *       baseline suite and the wave-1 folded suite each ran in a clone whose
 *       HEAD tree carried both files (read off the exec seam's recorded
 *       `check.sh` invocations, snapshotted at the moment of the call); and the
 *       run ends approved.
 *   (f) [M6] The `Kata record (engine)` bullet of `fleet/CONTRACT.md` read the
 *       way the Proof's third `Run:` line reads it. The leg's other half — the
 *       two survivor sims — is carried by the Proof's first two `Run:` lines,
 *       which run those sims; this file does not name them, because
 *       `test_sims_are_hermetic.mjs` forbids a sim naming a sibling sim, run or
 *       merely checked for existence.
 *
 * Nothing here reaches a network. The hub is a fake object with the client's
 * method names; the tag the engine fetches is on the sim's OWN local origin,
 * built here commit by commit; every child process is started through a seam
 * this file owns, with the rig's hermetic environment.
 *
 * Two readings this file encodes, recorded on the kata issue as well:
 *
 *   1. (e)'s "the baseline suite … ran on a tree carrying both" is read
 *      literally: the baseline clone is the one the suite on the run's floor
 *      runs in, and with a reuse the floor IS the reuse head — so that clone
 *      has to be cut there, not at BASE. That is what the snapshot assertion
 *      below measures.
 *   2. "the run ends approved" is read as the engine-visible approval:
 *      `criticDecision` (`fleet/run-main.mjs`) applied to the returned report
 *      answers `{approve: true, blocking: []}`, with the driver's own suite
 *      green on the adopted tree. `ultra_gate.py` is the periphery and runs
 *      outside this engine.
 *
 * The rig below is a COPY of `_engine_helpers.rig`'s body with three additions —
 * `kata` passed through to `runEngine`, a RECORDING `exec` wrapper around the
 * real `execSeam`, and an `answerExec` hook by which a sim may ANSWER one
 * recorded call itself — because legs (b), (d) and (e) are assertions about what
 * the exec seam recorded, legs `#1037 (b)` and `#1037 (c)` are assertions about
 * what the engine does with one kernel answer, and the shared rig exposes
 * neither seam. Everything below the agent seam is otherwise the real thing:
 * real git repositories, real clones, the real capture, the real fold kernel —
 * `answerExec` reaches exactly the one call a leg names and nothing else.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { criticDecision, execSeam } from '../run-main.mjs'
import { cloneAtBase, makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine } from '../run-engine.mjs'
import { ENV, gitSync, makeRepo, provision, passReview, cleanCritic, doneImpl }
  from './_engine_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-reuse-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// `gitSync` trims its answer, which is right for a sha and wrong for a patch or
// a blob: a unified diff's trailing newline is part of the file `git apply`
// reads. This is the same call with the same hermetic environment, untrimmed.
const gitRaw = (argv, cwd) =>
  execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
/** A blob at a commit, or null when the commit has no such path. */
const blobAt = (cwd, sha, file) => {
  try { return gitRaw(['show', sha + ':' + file], cwd) } catch { return null }
}
/** Every path in a commit's tree. */
const treeOf = (cwd, sha) =>
  gitSync(['ls-tree', '-r', '--name-only', sha], cwd).split('\n').filter(Boolean)
const isAncestor = (cwd, a, b) => {
  try { gitRaw(['merge-base', '--is-ancestor', a, b], cwd); return true } catch { return false }
}

const TEST_CMD = 'bash check.sh'
const SHA40 = /^[0-9a-f]{40}$/
// The two files the reuse joins: task 1's work, carried by the parked run's
// `run.patch`, and main's own move after the parked run's base.
const ONE_TXT = 'reused work from run 9\n'
const THIRD_TXT = 'main moved on after the parked run\n'
// `#1037 (a)`'s clash: a parked run that wrote `third.txt` too, with bytes main
// never wrote. Both sides ADD the same path off the same base, which is the
// add/add the kernel has to answer with `conflicts > 0` — and, at Setup, with
// no resolver to dispatch.
const CLASH_TXT = 'the parked run wrote third.txt too, and differently\n'

// ══════════════════════════════════════════════════════════════════════════
// the sim's origin — the repository every clone is cut from
// ══════════════════════════════════════════════════════════════════════════
/**
 * `makeRepo`'s base commit is the PARKED run's base (`report.baseSha`). On top
 * of it, off to the side: task 1's work (kept only as the patch bytes the
 * parked run published), a commit off main's history (the ancestry refusal's
 * `baseSha`), and two evidence commits tagged `ultra/evidence/run-9` and
 * `ultra/evidence/run-7`, each carrying `.ultrapowers/runs/<N>/report.json` and
 * `.ultrapowers/runs/<N>/publish-fold/run.patch` exactly where M2 reads them.
 * Then main advances by one commit touching `third.txt` — and THAT tip is the
 * run's BASE, so every sim below is already in M5's shape: main has moved past
 * the parked base, and the reuse fold's `main=` side is never empty.
 */
function makeParkedOrigin (dir) {
  makeRepo(dir)
  const parkedBase = gitSync(['rev-parse', 'HEAD'], dir)

  // Task 1's work, as the parked run published it: the diff against that base,
  // in the argv `fleet/publish-fold.mjs` uses.
  gitSync(['checkout', '-q', '-b', 'parked-work'], dir)
  fs.writeFileSync(path.join(dir, 'one.txt'), ONE_TXT)
  gitSync(['add', '-A'], dir)
  gitSync(['commit', '-q', '-m', 'task 1 of the parked run'], dir)
  const adoptedSha = gitSync(['rev-parse', 'HEAD'], dir)
  const runPatch = gitRaw(
    ['diff', '--binary', '--full-index', '--no-renames', parkedBase + '..' + adoptedSha], dir)
  gitSync(['checkout', '-q', 'main'], dir)

  // A commit that is NOT on main's history — refusal 4's `report.baseSha`. The
  // branch is kept so the sha resolves in every clone: the refusal under test is
  // ancestry, not a missing object.
  gitSync(['checkout', '-q', '-b', 'side', parkedBase], dir)
  fs.writeFileSync(path.join(dir, 'side.txt'), 'off main\n')
  gitSync(['add', '-A'], dir)
  gitSync(['commit', '-q', '-m', 'off main'], dir)
  const sideSha = gitSync(['rev-parse', 'HEAD'], dir)
  gitSync(['checkout', '-q', 'main'], dir)

  // The same work, written against the same base, but ALSO touching `third.txt`
  // — the path main's own move below adds. `#1037 (a)`'s tag carries this patch.
  gitSync(['checkout', '-q', '-b', 'clashing-work', parkedBase], dir)
  fs.writeFileSync(path.join(dir, 'one.txt'), ONE_TXT)
  fs.writeFileSync(path.join(dir, 'third.txt'), CLASH_TXT)
  gitSync(['add', '-A'], dir)
  gitSync(['commit', '-q', '-m', 'task 1 of a parked run that also wrote third.txt'], dir)
  const clashSha = gitSync(['rev-parse', 'HEAD'], dir)
  const clashPatch = gitRaw(
    ['diff', '--binary', '--full-index', '--no-renames', parkedBase + '..' + clashSha], dir)
  gitSync(['checkout', '-q', 'main'], dir)

  const evidence = (run, report, patch = runPatch) => {
    gitSync(['checkout', '-q', '-b', 'ev-' + run, parkedBase], dir)
    const under = path.join(dir, '.ultrapowers', 'runs', String(run))
    fs.mkdirSync(path.join(under, 'publish-fold'), { recursive: true })
    fs.writeFileSync(path.join(under, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    fs.writeFileSync(path.join(under, 'publish-fold', 'run.patch'), patch)
    gitSync(['add', '-A'], dir)
    gitSync(['commit', '-q', '-m', 'evidence for run ' + run], dir)
    gitSync(['tag', 'ultra/evidence/run-' + run], dir)
    gitSync(['checkout', '-q', 'main'], dir)
    gitSync(['branch', '-q', '-D', 'ev-' + run], dir)
  }
  // Run 9: the parked run this exam reuses. Task 1 finished, task 2 did not.
  const report9 = { run: '9', baseSha: parkedBase,
                    tasks: [{ task: '1', status: 'done' }, { task: '2', status: 'failed' }] }
  evidence(9, report9)
  // Run 7: the same work published against a base that is off main's history.
  evidence(7, { run: '7', baseSha: sideSha, tasks: [{ task: '1', status: 'done' }] })
  // Run 6: `#1037 (a)`'s parked run. Everything ABOUT the tag is in order — it
  // is on this origin, its report lists task 1 `done`, its `baseSha` is the
  // parked base and so an ancestor of BASE — so the run clears every pre-fold
  // refusal and reaches `foldReuse`, where the two sides clash over
  // `third.txt`. That is the only way this sim can reach the fold's own refusal.
  evidence(6, { run: '6', baseSha: parkedBase, tasks: [{ task: '1', status: 'done' }] },
    clashPatch)

  // Main moves on, and this tip is the run's BASE.
  fs.writeFileSync(path.join(dir, 'third.txt'), THIRD_TXT)
  gitSync(['add', '-A'], dir)
  gitSync(['commit', '-q', '-m', 'main moves on'], dir)
  const base = gitSync(['rev-parse', 'HEAD'], dir)

  return { dir, parkedBase, adoptedSha, sideSha, runPatch, clashPatch, report9, base }
}

// One origin, cloned afresh by every sim below (`provision` clones, never
// mutates), so the tags and the parked base are built once.
const ORIGIN = makeParkedOrigin(path.join(tmp, 'origin'))

// ══════════════════════════════════════════════════════════════════════════
// the fake hub — the client's method names over an in-memory store
// ══════════════════════════════════════════════════════════════════════════
/**
 * `test_worker_kata_env.mjs`'s fake, with two additions this exam needs:
 * `status` per issue (M1's reused test is `status === 'closed'` beside the two
 * keys — `closed_reason` is not in `kata-client.mjs`'s frozen projection) and
 * an `addLabel` method, so `needs-review` on a reused task is an observation
 * rather than a method the engine trips over.
 */
function makeFakeKata ({ record, issues, trace }) {
  const calls = []
  const store = new Map()
  for (const [uid, iss] of Object.entries(issues)) {
    store.set(uid, { uid, revision: iss.revision ?? 1, short_id: iss.short_id ?? uid,
                     metadata: iss.metadata || {}, owner: null, status: iss.status || 'open' })
  }
  const need = (uid) => {
    const iss = store.get(uid)
    if (!iss) throw new Error('fake kata: no issue ' + JSON.stringify(uid))
    return iss
  }
  const note = (call) => { calls.push(call); trace.push({ at: 'hub', ...call }); return call }
  const kata = {
    async getIssue (uid) {
      const iss = need(uid)
      const answer = { uid, revision: iss.revision, short_id: iss.short_id,
                       metadata: iss.metadata, status: iss.status, owner: iss.owner,
                       project_id: record.project.id }
      note({ method: 'getIssue', uid, answer })
      return answer
    },
    async claim (projectId, uid) {
      const iss = need(uid)
      iss.owner = 'engine'; iss.revision += 1
      note({ method: 'claim', projectId, uid })
      return { uid, revision: iss.revision, short_id: iss.short_id }
    },
    async patchMetadata (projectId, uid, patch, revision) {
      const iss = need(uid)
      iss.metadata = { ...iss.metadata, ...patch }; iss.revision += 1
      note({ method: 'patchMetadata', projectId, uid, patch, revision })
      return { uid, revision: iss.revision, short_id: iss.short_id }
    },
    async addLabel (projectId, uid, label) {
      const iss = need(uid)
      iss.revision += 1
      note({ method: 'addLabel', projectId, uid, label })
      return { uid, revision: iss.revision }
    },
    async comment (projectId, uid, body) {
      const iss = need(uid)
      iss.revision += 1
      note({ method: 'comment', projectId, uid, body })
      return { uid, revision: iss.revision }
    },
    async close (projectId, uid, opts) {
      const iss = need(uid)
      iss.status = 'closed'; iss.revision += 1
      note({ method: 'close', projectId, uid, opts })
      return { uid, revision: iss.revision }
    },
  }
  return { kata, calls, of: (m) => calls.filter((c) => c.method === m),
           forUid: (uid) => calls.filter((c) => c.uid === uid) }
}

const PROJECT_ID = 7
const RECORD = () => ({
  url: 'https://kata.int.exe.xyz',
  project: { id: PROJECT_ID, uid: 'PROJ0', name: 'p' },
  run: { uid: 'RUN0', revision: 1 },
  tasks: { 1: { uid: 'U-1', short_id: 'aa11', revision: 1 },
           2: { uid: 'U-2', short_id: 'bb22', revision: 1 } },
})
const FILE_OF = { 1: 'one.txt', 2: 'two.txt' }
const FACTSHEET = (id) => ({ files: [FILE_OF[id]], deletes: [], guards: [], proofTests: [],
                             landing: {}, produces: [], consumes: [] })
/** An issue a `done` close stamped: closed, with BOTH flat keys (Task 1's M2). */
const stamped = (id, run) => ({
  status: 'closed',
  metadata: { factsheet: FACTSHEET(id), 'work.adopted_run': run,
              'work.adopted_sha': ORIGIN.adoptedSha },
})
/** An issue nothing has stamped, open or closed as the caller says. */
const plain = (id, over = {}) => ({ status: 'open', metadata: { factsheet: FACTSHEET(id) }, ...over })

// ══════════════════════════════════════════════════════════════════════════
// the rig — `_engine_helpers.rig` plus `kata` and a recording `exec`
// ══════════════════════════════════════════════════════════════════════════
const mkTask = (id, over = {}) => ({
  id, title: 'task ' + id, files: [FILE_OF[id]], tier: 'standard', review: 'lean',
  writes: [FILE_OF[id]], commutes: [], proofTests: [], proofRuns: [],
  body: 'sim task ' + id, ...over,
})

function reuseRig ({ repo, runDir, waves, edges = [], stub, kata, stamp = 'reuse',
                     onExec = () => {}, onPhase = () => {}, answerExec = () => null,
                     extraArgs = {} }) {
  const taskIds = waves.flat().map((t) => t.id)
  const { base, clonesDir, patchesDir, integ } = provision({ repo, runDir, taskIds })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const inner = async (prompt, opts) => stub(prompt, opts, cwdFor(opts))
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir,
    taskIdOf: defaultTaskIdOf,
  })
  const logs = []
  const phases = []
  const execCalls = []
  const exec = (cmd, argv, opts = {}) => {
    const call = { cmd, argv: Array.isArray(argv) ? argv.slice() : [],
                   cwd: (opts && opts.cwd) || null }
    execCalls.push(call)
    onExec(call)
    // The one seam a sim may answer itself: `answerExec` returns a canned
    // `{code, stdout, stderr}` for the call it recognises and `null` for every
    // other, which then runs for real. `#1037 (b)` and `#1037 (c)` use it to
    // put the kernel's `--wave 0` step into one of the two states a real
    // kernel reaches only under conditions a hermetic sim cannot stage; the
    // call is still RECORDED, so what the engine asked for stays assertable.
    const canned = answerExec(call)
    if (canned) return Promise.resolve({ stdout: '', stderr: '', ...canned })
    return execSeam(cmd, argv, opts)
  }
  const run = () => runEngine({
    args: {
      waves, edges, testCmd: TEST_CMD, acceptance: { mode: 'suite', reason: 'sim' }, stamp,
      integrationBranch: 'ultra/integration-' + stamp,
      dependencyEdges: edges.map(([a, b]) => a + ' -> ' + b),
      patchInput: patchesDir,
      // The raised-hand poll is a SECOND `getIssue` on a timer, and leg (a)
      // counts reads. Ten minutes puts it past every sim here, so what the
      // count measures is the setup read and nothing else.
      attentionPollMs: 600000,
      ...extraArgs,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec,
    paths: { repoDir: repo, runDir, clonesDir },
    log: (l) => logs.push(String(l)),
    phase: (p) => { phases.push(String(p)); onPhase(String(p)) },
    patchBase,
    kata,
  })
  return { run, base, clonesDir, patchesDir, integ, logs, phases, execCalls,
           baselineDir: path.join(clonesDir, 'baseline') }
}

/**
 * One sim: a fresh run directory, a fake hub over `issues`, a stub that writes
 * each task's own file, and one ordered `trace` every observer appends to — the
 * hub's calls, the engine's phase marks and the worker dispatches — so "before
 * wave 1" and "before the first worker" are questions this file can ask.
 */
async function sim ({ name, waves, issues, edges = [], answerExec = () => null }) {
  const runDir = path.join(tmp, 'run-' + name)
  const record = RECORD()
  const trace = []
  const labels = []
  const startHeads = new Map()
  const suiteRuns = []
  const fake = makeFakeKata({ record, issues, trace })
  const stub = async (prompt, opts, cwd) => {
    const label = String(opts.label)
    labels.push(label)
    trace.push({ at: 'dispatch', label })
    const kind = label.split(':')[0]
    if (kind === 'impl') {
      const id = label.split(':')[1]
      startHeads.set(id, gitSync(['rev-parse', 'HEAD'], cwd))
      fs.writeFileSync(path.join(cwd, FILE_OF[id]), 'from ' + label + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + label)
  }
  const rigged = reuseRig({
    repo: ORIGIN.dir, runDir, waves, edges, stub, kata: fake.kata, stamp: name,
    extraArgs: { kataRecord: record },
    answerExec,
    // The phase marks land in the same ordered trace as the reads and the
    // dispatches, so "before wave 1" is a question about one list.
    onPhase: (p) => trace.push({ at: 'phase', phase: p }),
    onExec: (call) => {
      // The suite, snapshotted where and when it actually ran: the tree of the
      // clone's HEAD at the moment of the call, which is what leg (e) reads.
      if (call.cmd === 'bash' && call.argv[0] === '-lc' && call.argv[1] === TEST_CMD) {
        suiteRuns.push({ cwd: call.cwd, head: gitSync(['rev-parse', 'HEAD'], call.cwd),
                         tree: treeOf(call.cwd, 'HEAD') })
      }
    },
  })
  const report = await rigged.run()
  return { ...rigged, name, runDir, record, fake, trace, labels, startHeads, suiteRuns, report }
}

// ── reading a sim back ───────────────────────────────────────────────────────
const eventsOf = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}
const reuseEventsOf = (runDir) => eventsOf(runDir).filter((e) => e.kind === 'driver:reuse')
const firstAt = (trace, pred) => trace.findIndex(pred)
const lastAt = (trace, pred) => {
  for (let i = trace.length - 1; i >= 0; i--) if (pred(trace[i])) return i
  return -1
}
const kernelCalls = (execCalls, verb) =>
  execCalls.filter((c) => c.cmd === 'python3' && c.argv[1] === verb)
const flagOf = (argv, flag) => {
  const i = argv.indexOf(flag)
  return i === -1 ? null : argv[i + 1]
}
/** The kernel calls of one verb the Setup fold makes — `--wave 0` and no other. */
const wave0Calls = (execCalls, verb) =>
  kernelCalls(execCalls, verb).filter((c) => flagOf(c.argv, '--wave') === '0')
const allOf = (argv, flag) =>
  argv.map((a, i) => (a === flag ? argv[i + 1] : null)).filter((v) => v !== null)
const fetches = (execCalls) => execCalls.filter((c) => c.cmd === 'git' && c.argv[0] === 'fetch')
const mentioning = (execCalls, needle) =>
  execCalls.filter((c) => c.argv.some((a) => String(a).includes(needle)))
const rowOf = (report, id) => report.tasks.find((r) => r && r.task === id)
const labelled = (labels, prefix) => labels.filter((l) => l.startsWith(prefix))

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] no stamped issue: one read per task at setup, and nothing fetched
// ══════════════════════════════════════════════════════════════════════════
// Three shapes of "not reused", each the whole of M1's negative half: two open
// issues; task 1 closed with NEITHER key (the `needs-review` task a person
// closed); task 1 closed with `work.adopted_run` and no `work.adopted_sha`.
{
  const SHAPES = [
    { name: 'a1-open', one: plain('1') },
    { name: 'a2-closed-bare',
      one: { status: 'closed', metadata: { factsheet: FACTSHEET('1') } } },
    { name: 'a3-half-stamped',
      one: { status: 'closed',
             metadata: { factsheet: FACTSHEET('1'), 'work.adopted_run': 9 } } },
  ]
  for (const shape of SHAPES) {
    const s = await sim({
      name: shape.name,
      waves: [[mkTask('1'), mkTask('2')]],
      issues: { RUN0: { revision: 1, short_id: 'run0', metadata: {} },
                'U-1': shape.one, 'U-2': plain('2') },
    })
    const where = ' [' + shape.name + ']'

    // Exactly one read per task — the read that checks the revision and takes
    // the fact sheet, and no second one.
    const reads = s.fake.of('getIssue')
    assert.equal(reads.length, 2,
      '(a) [M1] the hub is read exactly once per task; got ' + reads.length + ': ' +
      JSON.stringify(reads.map((c) => c.uid)) + where)
    for (const uid of ['U-1', 'U-2']) {
      assert.equal(reads.filter((c) => c.uid === uid).length, 1,
        '(a) [M1] issue ' + uid + ' was read exactly once' + where)
    }

    // At SETUP: every read is behind the `Wave 1` mark and behind the first
    // worker of the run.
    const lastRead = lastAt(s.trace, (e) => e.at === 'hub' && e.method === 'getIssue')
    const firstDispatch = firstAt(s.trace, (e) => e.at === 'dispatch')
    const wave1 = firstAt(s.trace, (e) => e.at === 'phase' && e.phase === 'Wave 1')
    assert.notEqual(firstDispatch, -1, '(a) sim precondition: a worker was dispatched' + where)
    assert.notEqual(wave1, -1,
      '(a) sim precondition: the engine announced the `Wave 1` phase; got ' +
      JSON.stringify(s.phases) + where)
    assert.ok(lastRead < firstDispatch,
      '(a) [M1] every task\'s issue is read before the first worker is dispatched — the ' +
      'read moved ahead of wave 1. Trace: ' + JSON.stringify(s.trace.slice(0, 12)) + where)
    assert.ok(lastRead < wave1,
      '(a) [M1] and before the `Wave 1` phase mark, so BOTH tasks are read at setup and ' +
      'neither read is taken inside the wave. Trace: ' +
      JSON.stringify(s.trace.slice(0, 12)) + where)

    // Nothing is fetched: the reused set is empty, so the run proceeds exactly
    // as it does at BASE.
    assert.deepEqual(fetches(s.execCalls).map((c) => c.argv.join(' ')), [],
      '(a) [M1] with an empty reused set the engine fetches nothing at all' + where)
    assert.deepEqual(mentioning(s.execCalls, 'ultra/evidence').map((c) => c.argv.join(' ')), [],
      '(a) [M1] and no exec call names an evidence tag' + where)

    // No event, and the whole plan runs.
    assert.deepEqual(reuseEventsOf(s.runDir), [],
      '(a) [M1] and no `driver:reuse` event is appended' + where)
    assert.deepEqual(labelled(s.labels, 'impl:').sort(), ['impl:1', 'impl:2'],
      '(a) [M1] both implementers run; got ' + JSON.stringify(s.labels) + where)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] + (c) [M3] + (e) [M5] — one run: task 1 stamped run 9, the tag on
// the origin, main already moved past the parked base
// ══════════════════════════════════════════════════════════════════════════
{
  const s = await sim({
    name: 'b-reuse',
    waves: [[mkTask('1'), mkTask('2')]],
    issues: { RUN0: { revision: 1, short_id: 'run0', metadata: {} },
              'U-1': stamped('1', 9), 'U-2': plain('2') },
  })

  // ── (b) [M2] the tag is fetched from origin, into the integration clone ────
  const tagFetches = fetches(s.execCalls)
    .filter((c) => c.argv.some((a) => String(a).includes('ultra/evidence/run-9')))
  assert.ok(tagFetches.length >= 1,
    '(b) [M2] the exec seam records a `git fetch` of `ultra/evidence/run-9`; the fetches it ' +
    'recorded were ' + JSON.stringify(fetches(s.execCalls).map((c) => c.argv.join(' '))))
  assert.ok(tagFetches.every((c) => c.argv.includes('origin')),
    '(b) [M2] from `origin` — ' + JSON.stringify(tagFetches.map((c) => c.argv.join(' '))))
  assert.equal(tagFetches[0].cwd, s.integ,
    '(b) [M2] and in the integration clone, not in a task clone; got ' + tagFetches[0].cwd)

  // ── (b) [M2] the two files, read off the tag, under runDir/reuse ───────────
  const reuseDir = path.join(s.runDir, 'reuse')
  const reuseReport = path.join(reuseDir, 'report.json')
  const reusePatch = path.join(reuseDir, 'run.patch')
  assert.ok(fs.existsSync(reuseReport),
    '(b) [M2] `runDir/reuse/report.json` holds the tag\'s report; ' + reuseDir + ' holds ' +
    JSON.stringify(fs.existsSync(reuseDir) ? fs.readdirSync(reuseDir) : '<no reuse dir>'))
  assert.ok(fs.existsSync(reusePatch),
    '(b) [M2] and `runDir/reuse/run.patch` the tag\'s patch; ' + reuseDir + ' holds ' +
    JSON.stringify(fs.existsSync(reuseDir) ? fs.readdirSync(reuseDir) : '<no reuse dir>'))
  assert.deepEqual(JSON.parse(fs.readFileSync(reuseReport, 'utf8')), ORIGIN.report9,
    '(b) [M2] the report read off the tag is the tag\'s own `.ultrapowers/runs/9/report.json`')
  assert.equal(fs.readFileSync(reusePatch, 'utf8'), ORIGIN.runPatch,
    '(b) [M2] and the patch is `.ultrapowers/runs/9/publish-fold/run.patch`, byte for byte')

  // ── (b) [M2] the publish fold's shape, through the kernel ──────────────────
  const wave0Folds = kernelCalls(s.execCalls, 'fold').filter((c) => flagOf(c.argv, '--wave') === '0')
  assert.equal(wave0Folds.length, 1,
    '(b) [M2] the kernel is invoked once as `fold … --wave 0`; got ' + wave0Folds.length +
    ' of ' + kernelCalls(s.execCalls, 'fold').length + ' fold call(s): ' +
    JSON.stringify(kernelCalls(s.execCalls, 'fold').map((c) => c.argv.join(' '))))
  assert.equal(flagOf(wave0Folds[0].argv, '--base'), ORIGIN.parkedBase,
    '(b) [M2] with `--base <report.baseSha>` — the parked run\'s own base: ' +
    wave0Folds[0].argv.join(' '))
  assert.equal(allOf(wave0Folds[0].argv, '--patch').length, 2,
    '(b) [M2] and two `--patch` values, main\'s move and the parked run\'s `run.patch`: ' +
    wave0Folds[0].argv.join(' '))
  assert.equal(wave0Folds[0].cwd, s.integ,
    '(b) [M2] in the integration clone; got ' + wave0Folds[0].cwd)
  const wave0Mat = kernelCalls(s.execCalls, 'materialize')
    .filter((c) => flagOf(c.argv, '--wave') === '0')
  assert.equal(wave0Mat.length, 1,
    '(b) [M2] then `materialize --wave 0`, the publish fold\'s second step; got ' +
    JSON.stringify(kernelCalls(s.execCalls, 'materialize').map((c) => c.argv.join(' '))))

  // ── (b) [M2] the event, and the head it names ─────────────────────────────
  const evs = reuseEventsOf(s.runDir)
  assert.equal(evs.length, 1,
    '(b) [M2] exactly one `driver:reuse` event is appended; got ' + JSON.stringify(evs))
  const ev = evs[0]
  assert.equal(ev.run, 9, '(b) [M2] naming the run it reused, 9: ' + JSON.stringify(ev))
  assert.deepEqual(ev.tasks, ['1'],
    '(b) [M2] and the reused ids: ' + JSON.stringify(ev))
  assert.ok(!('reason' in ev),
    '(b) [M2] a reuse that happened carries no `reason` — that is the refusal\'s shape: ' +
    JSON.stringify(ev))
  assert.match(String(ev.headSha), SHA40,
    '(b) [M2] and a `headSha`: ' + JSON.stringify(ev))
  const reuseHead = ev.headSha

  // The head is BASE plus the parked run's adopted work, and nothing else.
  assert.ok(isAncestor(s.integ, s.base, reuseHead),
    '(b) [M2] the reuse head has BASE (' + s.base + ') behind it')
  assert.deepEqual(
    gitSync(['diff', '--name-only', s.base, reuseHead], s.integ).split('\n').filter(Boolean),
    ['one.txt'],
    '(b) [M2] and it is BASE plus the parked run\'s adopted work — the only path it moves ' +
    'is the one `run.patch` wrote')
  assert.equal(blobAt(s.integ, reuseHead, 'one.txt'), ONE_TXT,
    '(b) [M2] whose tree carries task 1\'s file byte for byte as `run.patch` wrote it')

  // It is the head wave 1 started from: the integration head before wave 1, and
  // the base every wave-1 task clone was cut at.
  assert.equal(s.startHeads.get('2'), reuseHead,
    '(b) [M2] the reuse head is the base wave 1\'s task clones start from — task 2\'s ' +
    'implementer began at ' + s.startHeads.get('2') + ', the reuse head is ' + reuseHead)
  assert.ok(isAncestor(s.integ, reuseHead, gitSync(['rev-parse', 'HEAD'], s.integ)),
    '(b) [M2] and it is the integration head wave 1 built on — the branch only moved forward ' +
    'from it')

  // ── (c) [M3] a reused task dispatches nothing and is touched on no hub ─────
  for (const prefix of ['exam:1', 'impl:1', 'review:1:', 'fix:1:']) {
    assert.deepEqual(labelled(s.labels, prefix), [],
      '(c) [M3] a reused task dispatches no worker: no `' + prefix + '` label appears; got ' +
      JSON.stringify(s.labels))
  }
  for (const method of ['claim', 'close', 'addLabel', 'patchMetadata']) {
    assert.deepEqual(s.fake.forUid('U-1').filter((c) => c.method === method), [],
      '(c) [M3] and it is not ' + method + 'ed — a reused task is not claimed, not closed and ' +
      'not marked `needs-review`; the hub calls on U-1 were ' +
      JSON.stringify(s.fake.forUid('U-1').map((c) => c.method)))
  }
  assert.deepEqual(labelled(s.labels, 'impl:').sort(), ['impl:2'],
    '(c) [M3] only the unfinished task is worked; got ' + JSON.stringify(s.labels))

  // Excluded from its wave's fold.
  assert.equal(s.report.waveMerges.length, 1,
    '(c) sim precondition: one wave — ' + JSON.stringify(s.report.waveMerges))
  assert.equal(s.report.waveMerges[0].status, 'MERGED',
    '(c) sim precondition: the wave adopted — ' + JSON.stringify(s.report.waveMerges[0]))
  assert.deepEqual(s.report.waveMerges[0].branches, ['2'],
    '(c) [M3] the reused task is excluded from its wave\'s fold — only task 2 went into it: ' +
    JSON.stringify(s.report.waveMerges[0]))
  const wave1Fold = kernelCalls(s.execCalls, 'fold').filter((c) => flagOf(c.argv, '--wave') === '1')
  assert.equal(wave1Fold.length, 1,
    '(c) sim precondition: one wave-1 fold — ' +
    JSON.stringify(kernelCalls(s.execCalls, 'fold').map((c) => c.argv.join(' '))))
  assert.deepEqual(allOf(wave1Fold[0].argv, '--patch').map((v) => String(v).split('=')[0]), ['2'],
    '(c) [M3] and the wave\'s fold was handed task 2\'s patch and no other: ' +
    wave1Fold[0].argv.join(' '))

  // The report row.
  const row = rowOf(s.report, '1')
  assert.ok(row, '(c) [M3] the reused task has a row in the report\'s `tasks`: ' +
    JSON.stringify(s.report.tasks.map((r) => r && r.task)))
  assert.equal(row.status, 'done', '(c) [M3] with `status: \'done\'`: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'reused',
    '(c) [M3] and `reviewVerdict: \'reused\'`: ' + JSON.stringify(row))
  assert.equal(row.headSha, reuseHead,
    '(c) [M3] and `headSha` the reuse head: ' + JSON.stringify(row))
  assert.deepEqual(s.report.unfinished.filter((u) => String(u).startsWith('1')), [],
    '(c) [M3] a reused task is never `unfinished`: ' + JSON.stringify(s.report.unfinished))

  // Setup still read both issues, exactly once each — the read that FOUND the
  // stamp is the same one M1 counts.
  assert.equal(s.fake.of('getIssue').length, 2,
    '(c) [M1] the reuse is discovered by the setup read itself: exactly one `getIssue` per ' +
    'task; got ' + JSON.stringify(s.fake.of('getIssue').map((c) => c.uid)))

  // ── (e) [M5] the whole tree: main's move and the parked run's work ─────────
  assert.equal(blobAt(s.integ, reuseHead, 'third.txt'), THIRD_TXT,
    '(e) [M5] the reuse head carries the commit main made after the parked base')
  assert.equal(blobAt(s.integ, reuseHead, 'one.txt'), ONE_TXT,
    '(e) [M5] and the parked run\'s work, in one tree')

  const suiteIn = (dir) => s.suiteRuns.filter((r) => r.cwd === dir)
  const carriesBoth = (r) => r.tree.includes('one.txt') && r.tree.includes('third.txt')
  const baselineRuns = suiteIn(s.baselineDir)
  assert.equal(baselineRuns.length, 1,
    '(e) [M5] the baseline suite ran once, in the baseline clone; the recorded `' + TEST_CMD +
    '` invocations were ' + JSON.stringify(s.suiteRuns.map((r) => r.cwd)))
  assert.ok(carriesBoth(baselineRuns[0]),
    '(e) [M5] on a tree carrying BOTH main\'s move and the parked run\'s work — the run\'s ' +
    'floor is the reuse head, so that is the tree the baseline reads. Its clone\'s HEAD (' +
    baselineRuns[0].head + ') holds ' + JSON.stringify(baselineRuns[0].tree))
  const integRuns = suiteIn(s.integ)
  assert.ok(integRuns.length >= 1,
    '(e) [M5] and the wave-1 folded suite ran in the integration clone; got ' +
    JSON.stringify(s.suiteRuns.map((r) => r.cwd)))
  for (const r of integRuns) {
    assert.ok(carriesBoth(r),
      '(e) [M5] each on a tree carrying both: the integration clone\'s HEAD (' + r.head +
      ') holds ' + JSON.stringify(r.tree))
  }

  // …and the run ends approved.
  assert.equal(s.report.tests.passed, true,
    '(e) [M5] the driver\'s own suite is green on the adopted tree: ' +
    JSON.stringify(s.report.tests))
  assert.deepEqual(s.report.completenessFindings, [],
    '(e) [M5] with no completeness finding against the fold: ' +
    JSON.stringify(s.report.completenessFindings))
  const decision = criticDecision(s.report)
  assert.equal(decision.approve, true,
    '(e) [M5] so the run ends approved — `criticDecision` answers ' + JSON.stringify(decision))
  assert.deepEqual(decision.blocking, [],
    '(e) [M5] with nothing blocking: ' + JSON.stringify(decision))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] the second layout: one reused task and one the run must do
// ══════════════════════════════════════════════════════════════════════════
{
  const s = await sim({
    name: 'c-two-waves',
    waves: [[mkTask('1')], [mkTask('2')]],
    issues: { RUN0: { revision: 1, short_id: 'run0', metadata: {} },
              'U-1': stamped('1', 9), 'U-2': plain('2') },
  })
  const evs = reuseEventsOf(s.runDir)
  assert.equal(evs.length, 1,
    '(c) [M2] one `driver:reuse` in the two-wave layout too; got ' + JSON.stringify(evs))
  const reuseHead = evs[0].headSha
  assert.deepEqual(evs[0].tasks, ['1'],
    '(c) [M2] naming the reused task: ' + JSON.stringify(evs[0]))

  // Both issues are read at setup — every task of EVERY wave, not only wave 1's.
  const reads = s.fake.of('getIssue')
  assert.equal(reads.length, 2,
    '(c) [M1] both waves\' issues are read, once each; got ' +
    JSON.stringify(reads.map((c) => c.uid)))
  const lastRead = lastAt(s.trace, (e) => e.at === 'hub' && e.method === 'getIssue')
  const wave1 = firstAt(s.trace, (e) => e.at === 'phase' && e.phase === 'Wave 1')
  assert.ok(wave1 !== -1 && lastRead < wave1,
    '(c) [M1] including wave 2\'s, before the `Wave 1` mark: ' +
    JSON.stringify(s.trace.slice(0, 12)))

  // A reused task is folded at setup, not by the run: under the ready set
  // (#974 Task 1) an epoch is a FOLD, so the only epoch here is task 2's — the
  // reused task never occupies one of its own, and the reuse head is simply the
  // floor the run opens on.
  assert.equal(s.report.waveMerges.length, 1,
    '(c) [M3] one epoch row, task 2\'s — the reused task was folded at setup and buys no ' +
    'epoch of its own: ' + JSON.stringify(s.report.waveMerges))
  const adoptions = eventsOf(s.runDir).filter((e) => e.kind === 'driver:wave-adopted')
  assert.deepEqual(adoptions.map((e) => e.tasks), [['2']],
    '(c) [M3] and the one `driver:wave-adopted` names task 2 alone — never the reused task, ' +
    'which no epoch adopts: ' + JSON.stringify(adoptions))
  assert.deepEqual(labelled(s.labels, 'impl:'), ['impl:2'],
    '(c) [M3] no worker is dispatched for the reused task; got ' + JSON.stringify(s.labels))

  // …and the task the run does still starts from the reuse head: the floor the
  // setup fold left is the head every first dispatch is anchored at.
  assert.equal(s.startHeads.get('2'), reuseHead,
    '(c) [M3] task 2\'s clone was cut at ' + s.startHeads.get('2') +
    ', the reuse head is ' + reuseHead)
  assert.equal(s.report.waveMerges[0].status, 'MERGED',
    '(c) [M3] and it folds on top of it: ' + JSON.stringify(s.report.waveMerges[0]))
  const row = rowOf(s.report, '1')
  assert.equal(row && row.status, 'done',
    '(c) [M3] the reused row is still `done` here: ' + JSON.stringify(row))
  assert.equal(row && row.reviewVerdict, 'reused',
    '(c) [M3] `reviewVerdict: \'reused\'`: ' + JSON.stringify(row))
  assert.equal(row && row.headSha, reuseHead,
    '(c) [M3] and `headSha` the reuse head: ' + JSON.stringify(row))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] + #1037 (a)(b)(c) [M1] [M2] — seven refusals: one event carrying a
// reason, the full plan runs, and for the three the FOLD itself refuses, the
// event, the log and the judgment call carry one and the same sentence
// ══════════════════════════════════════════════════════════════════════════
{
  // The kernel's `--wave 0` steps, as this table's rows recognise them: the
  // same match `kernelCalls`/`flagOf` make when the assertions read them back.
  const isWave0 = (call, verb) =>
    call.cmd === 'python3' && call.argv[1] === verb && flagOf(call.argv, '--wave') === '0'

  // Four rows the reuse refuses BEFORE the fold (#383 leg (d)), then three the
  // FOLD itself refuses (#1037 legs (a), (b), (c)). A row declares how many
  // `--wave 0` kernel calls of each verb it expects — the first four expect
  // none, which is the assertion they carried at BASE, now exact — and a row
  // the fold refuses also declares the `reason` spec its sentence must satisfy.
  const REFUSALS = [
    { name: 'd1-two-runs', why: 'the reused tasks name two different runs',
      issues: { 'U-1': stamped('1', 9), 'U-2': stamped('2', 8) }, folds: 0, materializes: 0 },
    { name: 'd2-no-tag', why: 'the tag cannot be fetched',
      issues: { 'U-1': stamped('1', 77), 'U-2': plain('2') }, folds: 0, materializes: 0 },
    { name: 'd3-not-done', why: 'the tag\'s report.json does not list the reused task `done`',
      issues: { 'U-1': plain('1'), 'U-2': stamped('2', 9) }, folds: 0, materializes: 0 },
    { name: 'd4-not-ancestor', why: 'report.baseSha is not an ancestor of BASE',
      issues: { 'U-1': stamped('1', 7), 'U-2': plain('2') }, folds: 0, materializes: 0 },

    // #1037 (a) — the two sides do not fold cleanly. Nothing is answered by the
    // sim here: run 6's tag really does add `third.txt` with other bytes, and
    // the real kernel really does report the clash.
    { name: 'e1-conflicts', leg: '#1037 (a)',
      why: 'the parked run\'s work and main\'s move do not fold cleanly',
      issues: { 'U-1': stamped('1', 6), 'U-2': plain('2') }, folds: 1, materializes: 0,
      reason: { tag: 'ultra/evidence/run-6',
                match: /[0-9]+ conflict\(s\)/, contains: ['no resolver exists at Setup'] } },

    // #1037 (b) — the kernel printed no verdict. The clean tag, and the fold
    // call answered with empty stdout and exit 3.
    { name: 'e2-no-verdict', leg: '#1037 (b)',
      why: 'the `--wave 0` fold printed no verdict',
      issues: { 'U-1': stamped('1', 9), 'U-2': plain('2') }, folds: 1, materializes: 0,
      answerExec: (call) => (isWave0(call, 'fold') ? { code: 3, stdout: '', stderr: '' } : null),
      reason: { tag: 'ultra/evidence/run-9', startsWith: 'fold printed no verdict (exit 3)' } },

    // #1037 (c) — the fold is let through for real and `materialize` refuses:
    // the kernel's own park answer, which `foldReuse` reads off the parsed
    // stdout as `m.park || m.fallback`.
    { name: 'e3-materialize', leg: '#1037 (c)',
      why: 'the `--wave 0` materialize refused',
      issues: { 'U-1': stamped('1', 9), 'U-2': plain('2') }, folds: 1, materializes: 1,
      answerExec: (call) => (isWave0(call, 'materialize')
        ? { code: 0, stdout: '{"park":"simulated"}', stderr: '' } : null),
      reason: { tag: 'ultra/evidence/run-9', startsWith: 'materialize refused: simulated' } },
  ]
  for (const refusal of REFUSALS) {
    const s = await sim({
      name: refusal.name,
      waves: [[mkTask('1'), mkTask('2')]],
      issues: { RUN0: { revision: 1, short_id: 'run0', metadata: {} }, ...refusal.issues },
      answerExec: refusal.answerExec || (() => null),
    })
    const leg = refusal.leg || '(d) [M4]'
    const where = ' [' + refusal.name + ': ' + refusal.why + ']'

    const evs = reuseEventsOf(s.runDir)
    assert.equal(evs.length, 1,
      leg + ' reuse is refused with exactly one `driver:reuse` event; got ' +
      JSON.stringify(evs) + where)
    const ev = evs[0]
    assert.equal(typeof ev.reason, 'string',
      leg + ' carrying a `reason`: ' + JSON.stringify(ev) + where)
    assert.ok(ev.reason.trim() !== '',
      leg + ' and the reason is not empty: ' + JSON.stringify(ev) + where)
    assert.deepEqual(ev.tasks, [],
      leg + ' and an empty `tasks`: ' + JSON.stringify(ev) + where)
    assert.equal(ev.headSha, undefined,
      leg + ' and no reuse head on the event: ' + JSON.stringify(ev) + where)

    // The `--wave 0` kernel calls this row expects, and no others: the four
    // pre-fold refusals reach the kernel not at all, and a fold refusal reaches
    // exactly the step it refuses at.
    assert.equal(wave0Calls(s.execCalls, 'fold').length, refusal.folds,
      leg + ' exactly ' + refusal.folds + ' `--wave 0` fold call(s) ran; got ' +
      JSON.stringify(wave0Calls(s.execCalls, 'fold').map((c) => c.argv.join(' '))) + where)
    assert.equal(wave0Calls(s.execCalls, 'materialize').length, refusal.materializes,
      leg + ' and exactly ' + refusal.materializes + ' `--wave 0` materialize call(s); got ' +
      JSON.stringify(wave0Calls(s.execCalls, 'materialize').map((c) => c.argv.join(' '))) + where)

    // ── #1037 [M1] [M2] the fold's own sentence, in all three places ─────────
    if (refusal.reason) {
      const spec = refusal.reason
      const reason = ev.reason

      // [M2] which sentence it is — the shape this way of giving up carries.
      if (spec.startsWith) {
        assert.ok(reason.startsWith(spec.startsWith),
          leg + ' [M2] the refusal\'s `reason` begins `' + spec.startsWith + '` — the sentence ' +
          '`foldReuse` gave up with, not the caller\'s line. The event carried: ' +
          JSON.stringify(reason) + where)
      }
      if (spec.match) {
        assert.match(reason, spec.match,
          leg + ' [M2] the refusal\'s `reason` names the count as `<N> conflict(s)` (' +
          String(spec.match) + '). The event carried: ' + JSON.stringify(reason) + where)
      }
      for (const needle of spec.contains || []) {
        assert.ok(reason.includes(needle),
          leg + ' [M2] and it says `' + needle + '`. The event carried: ' +
          JSON.stringify(reason) + where)
      }

      // [M1] the log line — one of them, and its remainder IS the reason.
      const refusedLines = s.logs.filter((l) => l.startsWith('reuse refused: '))
      assert.equal(refusedLines.length, 1,
        leg + ' [M1] the engine\'s log holds exactly one line beginning `reuse refused: `; got ' +
        JSON.stringify(s.logs.filter((l) => l.includes('reuse'))) + where)
      assert.equal(refusedLines[0].slice('reuse refused: '.length), reason,
        leg + ' [M1] and what follows `reuse refused: ` is that same sentence. The log says ' +
        JSON.stringify(refusedLines[0].slice('reuse refused: '.length)) +
        ', the event\'s `reason` is ' + JSON.stringify(reason) + where)

      // [M1] the judgment call — one of them, and its remainder IS the reason.
      const prefix = 'reuse fold of ' + spec.tag + ': '
      const foldCalls = (s.report.judgmentCalls || []).filter((l) => l.startsWith(prefix))
      assert.equal(foldCalls.length, 1,
        leg + ' [M1] the report\'s `judgmentCalls` holds exactly one entry beginning `' +
        prefix + '`; got ' + JSON.stringify(s.report.judgmentCalls) + where)
      assert.equal(foldCalls[0].slice(prefix.length), reason,
        leg + ' [M1] and what follows that colon is that same sentence, so the event, the log ' +
        'and the judgment call all carry the fold\'s own words. The judgment call says ' +
        JSON.stringify(foldCalls[0].slice(prefix.length)) + ', the event\'s `reason` is ' +
        JSON.stringify(reason) + where)
    }

    // …and the full plan then runs as at BASE. A refusal is never the run's own
    // failure, whichever of the seven ways it was refused.
    assert.deepEqual(labelled(s.labels, 'impl:').sort(), ['impl:1', 'impl:2'],
      leg + ' the full plan runs: both implementers are dispatched; got ' +
      JSON.stringify(s.labels) + where)
    for (const id of ['1', '2']) {
      assert.equal(s.startHeads.get(id), s.base,
        leg + ' each off BASE (' + s.base + ') — task ' + id + ' started at ' +
        s.startHeads.get(id) + where)
    }
    // Under the ready set (#974 Task 1) an epoch is one FOLD, not one plan
    // layer: two independent tasks free their slots at two instants, so each is
    // folded in the epoch its own landing opened, and a run that folds them in
    // one epoch is the same run with the two landings closer together. What
    // this leg is about is the REFUSAL — the reuse folded nothing, so the run
    // did both tasks itself and adopted both — so it reads the epochs together
    // rather than expecting the barrier's single one.
    assert.ok(s.report.waveMerges.length >= 1,
      leg + ' and the run folds the work the reuse refused: ' +
      JSON.stringify(s.report.waveMerges) + where)
    for (const m of s.report.waveMerges) {
      assert.equal(m.status, 'MERGED',
        leg + ' every epoch of it adopted: ' + JSON.stringify(m) + where)
    }
    assert.deepEqual(s.report.waveMerges.flatMap((m) => m.branches).slice().sort(), ['1', '2'],
      leg + ' with both branches in the fold, each in exactly one epoch: ' +
      JSON.stringify(s.report.waveMerges) + where)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (f) [M6] the contract bullet, and the two sims the Proof's first two Run:
//     lines execute
// ══════════════════════════════════════════════════════════════════════════
{
  // The Proof's third `Run:` line is
  //   sed -n '/Kata record (engine)/,/status.json:/p' fleet/CONTRACT.md \
  //     | tr '\n' ' ' | grep -q 'once, at setup.*closed.*work.adopted_run.*…'
  // — this is that range, read the same way.
  const lines = fs.readFileSync(path.join(HERE, '..', 'CONTRACT.md'), 'utf8').split('\n')
  const start = lines.findIndex((l) => l.includes('Kata record (engine)'))
  assert.notEqual(start, -1,
    '(f) [M6] fleet/CONTRACT.md carries a `Kata record (engine)` bullet')
  let end = -1
  for (let i = start; i < lines.length; i++) {
    if (lines[i].includes('status.json:')) { end = i; break }
  }
  assert.notEqual(end, -1,
    '(f) [M6] and the `status.json:` bullet the sed range ends at is still below it')
  const bullet = lines.slice(start, end + 1).join(' ')
  const ORDER = new RegExp(['once, at setup', 'closed', 'work\\.adopted_run',
                            'ultra/evidence/run-<M>', 'run\\.patch', 'driver:reuse', 'refus']
    .join('[\\s\\S]*'))
  assert.match(bullet, ORDER,
    '(f) [M6] the Kata record (engine) bullet carries, in this order: `once, at setup`, ' +
    '`closed`, `work.adopted_run`, `ultra/evidence/run-<M>`, `run.patch`, `driver:reuse` and ' +
    '`refus` — the words the Proof\'s third `Run:` line greps for. The bullet reads:\n' + bullet)
}
// ══════════════════════════════════════════════════════════════════════════
// #1037 (d) [M3] the caller's generic line is gone from the engine
// ══════════════════════════════════════════════════════════════════════════
{
  // The Proof's second `Run:` line is
  //   test "$(grep -c 'did not produce a head' fleet/run-engine.mjs)" = 0
  // — this is that count, taken over the same file's bytes. `grep -c` counts
  // LINES carrying the phrase, so this counts lines too, and a surviving one in
  // a comment counts exactly as a surviving one in code does: the phrase leaves
  // the engine, it does not move into prose.
  const engine = fs.readFileSync(path.join(HERE, '..', 'run-engine.mjs'), 'utf8')
  const PHRASE = 'did not produce a head'
  const hits = engine.split('\n')
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter((l) => l.text.includes(PHRASE))
  assert.equal(hits.length, 0,
    '#1037 (d) [M3] the phrase `' + PHRASE + '` occurs zero times in fleet/run-engine.mjs — ' +
    'the reuse refusal carries the fold\'s own sentence, so the caller has no generic line ' +
    'left to write. Surviving line(s): ' +
    JSON.stringify(hits.map((h) => 'run-engine.mjs:' + h.line + ': ' + h.text.trim())))
}

// ══════════════════════════════════════════════════════════════════════════
// #1037 (e) [M4] the contract's reuse paragraph says whose words the reason is
// ══════════════════════════════════════════════════════════════════════════
{
  // The Proof's third `Run:` line is
  //   sed -n '/Re-drive reuse (#383)/,/A refusal is never the run.s own failure/p' \
  //     fleet/CONTRACT.md | tr '\n' ' ' \
  //     | grep -q 'reason.*fold.s own.*conflict.*materialize.*verdict'
  // — this is that range, joined the same way and read against the same order.
  const lines = fs.readFileSync(path.join(HERE, '..', 'CONTRACT.md'), 'utf8').split('\n')
  const start = lines.findIndex((l) => l.includes('Re-drive reuse (#383)'))
  assert.notEqual(start, -1,
    '#1037 (e) [M4] fleet/CONTRACT.md\'s `Kata record (engine)` bullet still opens its reuse ' +
    'paragraph with `Re-drive reuse (#383)` — the line the Proof\'s `sed` range starts at')
  let end = -1
  for (let i = start; i < lines.length; i++) {
    if (/A refusal is never the run.s own failure/.test(lines[i])) { end = i; break }
  }
  assert.notEqual(end, -1,
    '#1037 (e) [M4] and closes it with `A refusal is never the run\'s own failure.` — the line ' +
    'the range ends at')
  const paragraph = lines.slice(start, end + 1).join(' ')
  // The five, in the Proof's order. `grep`'s `.` matches any character, which is
  // how `fold.s own` reads an apostrophe of either spelling; `[\s\S]*` is that
  // same permissiveness across the joined line.
  const ORDER = new RegExp(['reason', 'fold.s own', 'conflict', 'materialize', 'verdict']
    .join('[\\s\\S]*'))
  assert.match(paragraph, ORDER,
    '#1037 (e) [M4] the reuse paragraph, read as one line, names `reason`, then `fold\'s own`, ' +
    'then `conflict`, then `materialize`, then `verdict`, in that order — it has to say that ' +
    'the refusal\'s reason is the FOLD\'s own, and name all three of the fold\'s ways of ' +
    'giving up. The paragraph reads:\n' + paragraph)
}

// Leg (f)'s other half — the two survivor sims — is carried by the Proof's
// first two `Run:` lines, which RUN those sims and grep their sentinel. It is
// deliberately not re-asserted here: `test_sims_are_hermetic.mjs` holds every
// sim to "no surviving sim names a sibling sim, run or merely checked for
// existence", so naming them in this file would break a standing guard to
// restate what the Proof already executes.

console.log('ALL TESTS PASSED')
