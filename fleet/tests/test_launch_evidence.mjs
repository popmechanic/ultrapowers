/**
 * fleet/tests/test_launch_evidence.mjs — the exam for "The launcher pushes the
 * plan to the operator's evidence repository" (#1395).
 *
 * The run's record lives in the operator's evidence repository — the setting
 * `evidence` in `~/.ultrapowers/fleet.json`, or `--evidence-repo` for one
 * launch — and the launch writes nothing to the product repository. Legs:
 *
 *   (a) [M1] a launch on `o/r` with the setting `ops/evidence`, whose plan has
 *       a sibling gate record, pushes exactly one commit, to
 *       `refs/heads/live/o-r/run-1` of `ops/evidence`: parentless, its tree
 *       exactly `runs/o-r/1/plan.md` and `runs/o-r/1/gate-verdicts.json`, its
 *       message naming `o/r` and the base sha; the target's refs are the same
 *       after the launch as before it;
 *   (b) [M2] with the evidence repository holding `refs/tags/o-r/run-4` and
 *       `refs/heads/live/o-r/run-6`, a launch without `--run` takes run 7;
 *   (c) [M3] neither the setting nor `--evidence-repo`: refused naming
 *       `evidence`, `~/.ultrapowers/fleet.json` and `node fleet/doctor.mjs`,
 *       nothing pushed and no `new`;
 *   (d) [M4] no `o-r` ref in the evidence repository while the target holds
 *       `refs/tags/ultra/evidence/run-2`: refused naming
 *       `migrate-evidence.mjs`, nothing pushed and no `new`;
 *   (e) [M5] `integrations list` naming `gh-o-r` and not `gh-ops-evidence`:
 *       refused naming `gh-ops-evidence`, nothing pushed and no `new`;
 *   (f) [M6] `--evidence-repo ops/other` over the setting `ops/evidence`: the
 *       plan commit goes to `ops/other`, the setup script the `new` verb
 *       carries names `ops/other`, and the `new` verb's comment carries no
 *       `evidence=` token either way.
 *
 * The rig: two local bares stand in for GitHub — the target's origin and the
 * evidence repository (`makeEvidenceRepo`, `main` seeded) — every lobby verb
 * and `gh api` is answered by the seam, and the compiler is stubbed. No socket
 * is opened.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { launch } from '../launch.mjs'
import { EXE_HOST, Refusal } from '../lobby.mjs'
import {
  PLAN, commentOf, gitEnv, launchRules, launchWorkspace, makeEvidenceRepo, makeExec, pushCalls
} from './_lobby_helpers.mjs'

const TARGET = 'o/r'
const SLUG = 'o-r'
const GH = 'gh-o-r'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const EVIDENCE = 'ops/evidence'
const OTHER = 'ops/other'
const ENGINE = 'c'.repeat(40)
const NOW = new Date('2026-09-30T12:00:00.000Z')
const CAPPED = { cpu: '6', memory: '8GB', evidence: EVIDENCE }
const RECORD = '{"tasks": {}, "tally": {"dispatched": 0}}\n'

// ── The seam's rules ────────────────────────────────────────────────────────

const ALL_INTEGRATIONS = [
  { name: GH, attachments: [] }, { name: 'gh-ops-evidence', attachments: [] },
  { name: 'gh-ops-other', attachments: [] }, { name: 'claude-max', attachments: [] }
]

const readRules = ({ ws, integrations = ALL_INTEGRATIONS }) =>
  launchRules({ engine: ENGINE, repo: ws.repo, evidence: [ws.evidence, ws.other], integrations })

// ── The workspace: a target, two evidence repositories, a plan and its record ─

function workspace ({ targetTag = null } = {}) {
  const ws = launchWorkspace({ prefix: 'fleet-launch-evidence-', originUrl: ORIGIN_URL, evidence: EVIDENCE })
  const { root, repo } = ws
  if (targetTag !== null) {
    repo.git(['tag', targetTag])
    repo.git(['push', '-q', repo.origin, `refs/tags/${targetTag}`])
  }
  const other = makeEvidenceRepo({ root, name: OTHER })
  fs.writeFileSync(path.join(path.dirname(ws.planPath), 'a-plan.gate-verdicts.json'), RECORD)
  const targetRefs = () => {
    const res = spawnSync('git', ['--git-dir', repo.origin, 'for-each-ref', '--format=%(refname) %(objectname)'],
      { encoding: 'utf8', env: gitEnv() })
    return res.stdout
  }
  return { ...ws, other, targetRefs }
}

const drive = async (ws, { extra = [], config = CAPPED, integrations } = {}) => {
  const exec = makeExec({ rules: readRules({ ws, integrations }) })
  let result = null
  let error = null
  try {
    result = await launch({
      argv: [ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir, '--engine', ENGINE, ...extra],
      exec,
      config,
      now: () => NOW,
      sleep: async () => {},
      refreshCredential: () => ({ ok: true }),
      readUsage: () => ({ unread: true, reason: 'sim' }),
      kata: null
    })
  } catch (e) {
    error = e
  }
  return { exec, result, error }
}

const newCalls = (exec) => exec.calls.filter((c) =>
  c.cmd === 'ssh' && c.argv[0] === EXE_HOST && String(c.argv[1] ?? '').startsWith('new '))
const added = (before, after) => Object.fromEntries(Object.entries(after).filter(([ref, sha]) => before[ref] !== sha))

const assertRefusedClean = (d, leg, needles) => {
  assert.ok(d.error instanceof Refusal, `${leg} a Refusal, got ${d.error?.name}: ${d.error?.message}`)
  assert.equal(d.error.exitCode, 2, `${leg} exit 2`)
  for (const needle of needles) {
    assert.ok(d.error.message.includes(needle), `${leg} the message names ${needle}: ${d.error.message}`)
  }
  assert.deepEqual(pushCalls(d.exec).map((c) => c.line), [], `${leg} nothing was pushed`)
  assert.deepEqual(newCalls(d.exec).map((c) => c.line), [], `${leg} no \`new\` was issued`)
  assert.deepEqual(d.exec.mutating(), [], `${leg} no mutating lobby verb at all`)
}

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] one parentless commit on the evidence live branch, nothing on the target
// ══════════════════════════════════════════════════════════════════════════
{
  const ws = workspace()
  const targetBefore = ws.targetRefs()
  const evidenceBefore = ws.evidence.refs()
  const d = await drive(ws)
  assert.equal(d.error, null, `(a) [M1] the launch resolves: ${d.error?.message ?? ''}`)
  assert.equal(d.result.run, 1, '(a) [M1] an empty evidence repository and target: run 1')

  const pushes = pushCalls(d.exec)
  assert.equal(pushes.length, 1, `(a) [M1] exactly one push: ${JSON.stringify(pushes.map((c) => c.line))}`)
  assert.ok(pushes[0].argv.includes(`https://github.com/${EVIDENCE}.git`),
    `(a) [M1] the push goes to ${EVIDENCE}: ${pushes[0].line}`)

  const newRefs = added(evidenceBefore, ws.evidence.refs())
  assert.deepEqual(Object.keys(newRefs), [`refs/heads/live/${SLUG}/run-1`],
    '(a) [M1] the evidence repository gained exactly the live branch, and main is untouched')
  const sha = newRefs[`refs/heads/live/${SLUG}/run-1`]
  assert.equal(sha, d.result.plan, '(a) [M1] the live branch holds the plan commit the comment names')

  const parents = ws.evidence.git(['rev-list', '--parents', '-n', '1', sha]).split(' ')
  assert.deepEqual(parents, [sha], `(a) [M1] the commit has no parent: ${parents.join(' ')}`)
  const tree = ws.evidence.git(['ls-tree', '-r', '--name-only', sha]).split('\n').sort()
  assert.deepEqual(tree, [`runs/${SLUG}/1/gate-verdicts.json`, `runs/${SLUG}/1/plan.md`],
    '(a) [M1] its tree is exactly the run folder\'s two files')
  assert.equal(ws.evidence.git(['show', `${sha}:runs/${SLUG}/1/plan.md`]), PLAN.trim(), '(a) [M1] the plan, as written')
  assert.equal(ws.evidence.git(['show', `${sha}:runs/${SLUG}/1/gate-verdicts.json`]), RECORD.trim(),
    '(a) [M1] the gate record, as written')
  const message = ws.evidence.git(['log', '-1', '--format=%B', sha])
  assert.ok(message.includes(TARGET), `(a) [M1] the message names ${TARGET}: ${message}`)
  assert.ok(message.includes(ws.repo.base), `(a) [M1] the message names the base sha: ${message}`)

  assert.equal(ws.targetRefs(), targetBefore, '(a) [M1] the target\'s refs are the same after the launch as before it')
  assert.equal(d.result.evidence, EVIDENCE, '(a) [M1] the record names the evidence repository')
  assert.equal(d.result.liveBranch, `live/${SLUG}/run-1`, '(a) [M1] and the live branch')
  assert.equal(d.result.planBranch, undefined, '(a) [M1] the record carries no planBranch')
  assert.equal(d.result.evidenceBranch, undefined, '(a) [M1] nor an evidenceBranch')
  ws.cleanup()
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] run 7 over an evidence tag at 4 and a live branch at 6
// ══════════════════════════════════════════════════════════════════════════
{
  const ws = workspace()
  ws.evidence.seed(`refs/tags/${SLUG}/run-4`, { [`runs/${SLUG}/4/plan.md`]: 'four\n' })
  ws.evidence.seed(`refs/heads/live/${SLUG}/run-6`, { [`runs/${SLUG}/6/plan.md`]: 'six\n' })
  // Another target's higher run is not this target's.
  ws.evidence.seed('refs/heads/live/o-other/run-40', { 'runs/o-other/40/plan.md': 'other\n' })
  const d = await drive(ws)
  assert.equal(d.error, null, `(b) [M2] the launch resolves: ${d.error?.message ?? ''}`)
  assert.equal(d.result.run, 7, `(b) [M2] run 7, got ${d.result.run}`)
  assert.ok(ws.evidence.refs()[`refs/heads/live/${SLUG}/run-7`], '(b) [M2] live/o-r/run-7 was pushed')
  ws.cleanup()
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] neither the setting nor the flag: refused, nothing pushed, no `new`
// ══════════════════════════════════════════════════════════════════════════
{
  const ws = workspace()
  const d = await drive(ws, { config: { cpu: '6', memory: '8GB' } })
  assertRefusedClean(d, '(c) [M3]', ['evidence', '~/.ultrapowers/fleet.json', 'node fleet/doctor.mjs'])
  ws.cleanup()
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] an unmigrated target: refused naming the migration
// ══════════════════════════════════════════════════════════════════════════
{
  const ws = workspace({ targetTag: 'ultra/evidence/run-2' })
  const d = await drive(ws)
  assertRefusedClean(d, '(d) [M4]', ['migrate-evidence.mjs'])
  ws.cleanup()
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M5] no integration for the evidence repository
// ══════════════════════════════════════════════════════════════════════════
{
  const ws = workspace()
  const d = await drive(ws, {
    integrations: [{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }]
  })
  assertRefusedClean(d, '(e) [M5]', ['gh-ops-evidence'])
  ws.cleanup()
}

// ══════════════════════════════════════════════════════════════════════════
// (f) [M6] --evidence-repo takes the push and the setup script; no evidence= anywhere
// ══════════════════════════════════════════════════════════════════════════
{
  const ws = workspace()
  const evidenceBefore = ws.evidence.refs()
  const otherBefore = ws.other.refs()
  const d = await drive(ws, { extra: ['--evidence-repo', OTHER] })
  assert.equal(d.error, null, `(f) [M6] the launch resolves: ${d.error?.message ?? ''}`)
  const pushes = pushCalls(d.exec)
  assert.equal(pushes.length, 1, '(f) [M6] one push')
  assert.ok(pushes[0].argv.includes(`https://github.com/${OTHER}.git`), `(f) [M6] to ${OTHER}: ${pushes[0].line}`)
  assert.deepEqual(Object.keys(added(otherBefore, ws.other.refs())), [`refs/heads/live/${SLUG}/run-1`],
    `(f) [M6] ${OTHER} gained the live branch`)
  assert.deepEqual(ws.evidence.refs(), evidenceBefore, `(f) [M6] ${EVIDENCE} is untouched`)
  assert.equal(d.result.evidence, OTHER, '(f) [M6] the record names the override')

  const news = newCalls(d.exec)
  assert.equal(news.length, 1, '(f) [M6] one `new`')
  const script = String(news[0].options?.input ?? '')
  assert.ok(script.split('\n').includes(`printf '%s\\n' '${OTHER}' >"$HOME/fleet-evidence-repo"`),
    `(f) [M6] the setup script on the \`new\` verb's stdin names ${OTHER}`)
  assert.ok(!script.includes(`'${EVIDENCE}'`), `(f) [M6] and not the setting ${EVIDENCE}`)
  const comment = commentOf(news[0])
  assert.ok(comment, '(f) [M6] the `new` verb carries a comment')
  assert.ok(!/(^|\s)evidence=/.test(comment), `(f) [M6] the comment carries no evidence= token: ${comment}`)
  ws.cleanup()

  const plain = workspace()
  const p = await drive(plain)
  assert.equal(p.error, null, `(f) [M6] the plain launch resolves: ${p.error?.message ?? ''}`)
  const plainNew = newCalls(p.exec)[0]
  assert.ok(!/(^|\s)evidence=/.test(commentOf(plainNew) ?? ''),
    `(f) [M6] nor does the plain launch's comment: ${commentOf(plainNew)}`)
  assert.ok(String(plainNew.options?.input ?? '').includes(`'${EVIDENCE}' >"$HOME/fleet-evidence-repo"`),
    `(f) [M6] the plain launch's setup script names the setting ${EVIDENCE}`)
  plain.cleanup()

  // A malformed override is refused before anything is executed.
  const bad = workspace()
  const b = await drive(bad, { extra: ['--evidence-repo', 'not a repo'] })
  assert.ok(b.error instanceof Refusal, `(f) [M6] a malformed --evidence-repo is a Refusal: ${b.error?.message}`)
  assert.ok(b.error.message.includes('--evidence-repo'), '(f) [M6] naming the flag')
  assert.equal(b.exec.calls.length, 0, '(f) [M6] and nothing was executed')
  bad.cleanup()
}

console.log('ALL TESTS PASSED')
