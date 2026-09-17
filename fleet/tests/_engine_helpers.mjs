// fleet/tests/_engine_helpers.mjs — shared rig for the run-engine sims.
// Underscore-prefixed so test_fleet_suite.py's test_*.mjs glob does not run it
// as a test of its own.
//
// The rig is deliberately REAL below the agent seam: real git repos, real
// cloneAtBase clones, real withPatchCapture diffs, the real fold kernel via
// the real execSeam. Only `agent` is stubbed — which is exactly the seam the
// driver owns (the sims prove the choreography; the judgments are canned).
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { execSeam } from '../run-main.mjs'
import { cloneAtBase, makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine } from '../run-engine.mjs'
import { simEnv } from './_helpers.mjs'

// The rig's own environment, one for the module: git sees a HOME of its own, so
// no ~/.gitconfig of the box reaches a repository a sim builds. Every repo made
// here sets user.name/user.email itself.
export const ENV = simEnv()

export const gitSync = (argv, cwd) =>
  execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// A target repo whose suite is `bash check.sh`: green unless a BROKEN marker
// file exists — the smallest controllable suite for reconcile scenarios.
export function makeRepo(dir, files = {}) {
  fs.mkdirSync(dir, { recursive: true })
  gitSync(['init', '-q', '-b', 'main'], dir)
  gitSync(['config', 'user.email', 'sim@test'], dir)
  gitSync(['config', 'user.name', 'sim'], dir)
  fs.writeFileSync(path.join(dir, 'check.sh'), '#!/bin/bash\n[ ! -f BROKEN ]\n')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line1\nline2\nline3\n')
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  gitSync(['add', '-A'], dir)
  gitSync(['commit', '-q', '-m', 'base'], dir)
  return dir
}

// Provision the run tree the way run-main does: integration + task clones at
// BASE, a patches dir, all under runDir.
export function provision({ repo, runDir, taskIds }) {
  const clonesDir = path.join(runDir, 'clones')
  const patchesDir = path.join(runDir, 'patches')
  fs.mkdirSync(patchesDir, { recursive: true })
  const base = gitSync(['rev-parse', 'HEAD'], repo)
  cloneAtBase({ repo, dest: path.join(clonesDir, 'integration'), base })
  for (const id of taskIds) cloneAtBase({ repo, dest: path.join(clonesDir, 'task-' + id), base })
  return { base, clonesDir, patchesDir, integ: path.join(clonesDir, 'integration') }
}

// Build a runEngine invocation around a stub inner agent. The stub receives
// (prompt, opts, cwd) — cwd already resolved the way the real worker would —
// and returns the canned judgment reply; withPatchCapture then captures the
// real diff, exactly as in production.
export function rig({ repo, runDir, waves, edges = [], stub, testCmd = 'bash check.sh',
                      acceptance = { mode: 'suite', reason: 'sim' }, stamp = 'sim',
                      // The hub's client, for a sim that drives one: an
                      // injected object, never a network. Left out entirely
                      // when undefined, so a sim that passes none reaches an
                      // engine with no hub at all — `kataRecord` travels
                      // separately, through `extraArgs`.
                      kata = undefined,
                      // The Jev client, for a sim that drives one: an injected
                      // `{ ask }`, never a network — `fleet/jev-client.mjs`'s
                      // own `fetchImpl` seam is the other half, and between
                      // them no sim opens a socket. Left out entirely when
                      // undefined, exactly as `kata` is, so a sim that passes
                      // none reaches an engine with no Jev at all and makes no
                      // call.
                      jev = undefined,
                      // The run's event log, for a sim that drives the
                      // engine's subscription: in production this is run-main's
                      // `makeEventLog`; here it is whatever the sim hands in,
                      // typically a `{ subscribe }` that captures the engine's
                      // callback so the sim can push lines through it.
                      eventLog = undefined,
                      // The exec seam. `execSeam` by default — the sims are
                      // real below it — and overridable so a sim can RECORD
                      // what the driver ran (which git verbs, which suites, in
                      // which clone) by wrapping it.
                      exec = execSeam,
                      // Extra runEngine args merged last (constraintChecks,
                      // patchInput, and whatever the next knob is).
                      extraArgs = {},
                      // Extra `withPatchCapture` options, spread into the call
                      // below. In production the driver decides these from the
                      // args file (`dropLockfilesFor`, run-main); a sim has no
                      // args file, so this is how it arms the same knob.
                      captureOptions = {} }) {
  const taskIds = waves.flat().map((t) => t.id)
  const { base, clonesDir, patchesDir, integ } = provision({ repo, runDir, taskIds })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const inner = async (prompt, opts) => stub(prompt, opts, cwdFor(opts))
  // The wrapper's own events go where production's go: run-main hands it
  // `eventLog.onEvent`, which writes the same `events.jsonl` the engine writes,
  // so a sim reading the run's record sees a `capture:dropped` exactly where a
  // real run leaves one. The rig passed none until #1050 and the wrapper's
  // events fell on the floor. `captureOptions` is spread last and can replace
  // it with a collector of the sim's own.
  const captureEvent = (e) => {
    try {
      fs.mkdirSync(runDir, { recursive: true })
      fs.appendFileSync(path.join(runDir, 'events.jsonl'),
        JSON.stringify({ ...e, ts: Date.now() }) + '\n')
    } catch { /* evidence, not control flow */ }
  }
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir,
    taskIdOf: defaultTaskIdOf, onEvent: captureEvent,
    ...captureOptions,
  })
  const logs = []
  // The phases the engine announced, in order. The rig left `phase` a no-op
  // until #712: a sim that wants the phase sequence should read it here rather
  // than infer it from the suite command's side effects.
  const phases = []
  const run = () => runEngine({
    args: {
      waves, edges, testCmd, acceptance, stamp,
      integrationBranch: 'ultra/integration-' + stamp,
      dependencyEdges: edges.map(([a, b]) => a + ' -> ' + b),
      patchInput: patchesDir,
      ...extraArgs,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec,
    paths: { repoDir: repo, runDir, clonesDir },
    log: (l) => logs.push(String(l)),
    phase: (p) => phases.push(String(p)),
    patchBase,
    ...(kata === undefined ? {} : { kata }),
    ...(jev === undefined ? {} : { jev }),
    ...(eventLog === undefined ? {} : { eventLog }),
  })
  return { run, base, clonesDir, patchesDir, integ, logs, phases, patchBase }
}

// The hub, in memory: the client's method names over a `Map` of issues, every
// call recorded in order. Lifted out of `test_run_engine_state_handshake.mjs`
// (which keeps its own copy) so any sim that needs a hub on can have one
// without a network — `kata: fakeHub(...).kata` into the rig and the matching
// `{ kataRecord }` through `extraArgs`. The fake's issue revisions must equal
// the record's: a sheet read whose revision disagrees is fatal to the engine.
//
// `issues` is `{ [uid]: { revision, short_id, metadata } }`. `commentsOn(uid)`
// is the comment bodies posted on one issue, in order — read it only after
// `run()` resolves, since the engine drains its hub chain at the run's end.
// `post` is a producing implementer's own `kata meta set … --json-value`: from
// OUTSIDE the engine, so it is not in the call log and does not move the
// revision the fake answers.
export function fakeHub ({ projectId, issues }) {
  const calls = []
  const store = new Map()
  for (const [uid, iss] of Object.entries(issues)) {
    store.set(uid, { uid, revision: iss.revision, short_id: iss.short_id,
                     metadata: { ...(iss.metadata || {}) }, owner: null,
                     status: 'open', labels: [] })
  }
  const need = (uid) => {
    const iss = store.get(uid)
    if (!iss) throw new Error('fake hub: no issue ' + JSON.stringify(uid))
    return iss
  }
  const record = (method, uid, fields, answer) => {
    calls.push({ method, uid, ...fields, answer })
    return answer
  }
  const kata = {
    async getIssue (uid) {
      const iss = need(uid)
      return record('getIssue', uid, {}, {
        uid, revision: iss.revision, short_id: iss.short_id, metadata: iss.metadata,
        status: iss.status, owner: iss.owner, project_id: projectId,
      })
    },
    async claim (project, uid) {
      const iss = need(uid)
      iss.owner = 'engine'; iss.revision += 1
      return record('claim', uid, { projectId: project },
        { uid, revision: iss.revision, short_id: iss.short_id })
    },
    async patchMetadata (project, uid, patch, revision) {
      const iss = need(uid)
      iss.metadata = { ...iss.metadata, ...patch }; iss.revision += 1
      return record('patchMetadata', uid, { projectId: project, patch, revision },
        { uid, revision: iss.revision, short_id: iss.short_id })
    },
    async comment (project, uid, body) {
      const iss = need(uid)
      iss.revision += 1
      return record('comment', uid, { projectId: project, body }, { uid, revision: iss.revision })
    },
    async addLabel (project, uid, label) {
      const iss = need(uid)
      iss.labels.push(label); iss.revision += 1
      return record('addLabel', uid, { projectId: project, label }, { uid, revision: iss.revision })
    },
    async close (project, uid, opts) {
      const iss = need(uid)
      iss.status = 'closed'; iss.revision += 1
      return record('close', uid, { projectId: project, opts }, { uid, revision: iss.revision })
    },
  }
  return {
    kata,
    calls,
    of: (m) => calls.filter((c) => c.method === m),
    commentsOn: (uid) => calls.filter((c) => c.method === 'comment' && c.uid === uid)
      .map((c) => String(c.body || '')),
    post: (uid, value) => { need(uid).metadata = { ...need(uid).metadata, 'state.reached': value } },
  }
}

// Common canned judgments.
export const passReview = () => ({ verdict: 'PASS', issues: [] })
export const cleanCritic = () => ({ findings: [], deferredVerification: [] })
// #474 — a critic that found something. `findings` are {severity, detail}
// objects; the shape lives here once so consumers cannot drift apart.
export const criticWithFindings = (findings) => ({ findings, deferredVerification: [] })
export const doneImpl = (cwd) => ({
  status: 'DONE', summary: 'sim work done', startHead: gitSync(['rev-parse', 'HEAD'], cwd),
})
