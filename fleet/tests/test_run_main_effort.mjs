/**
 * fleet/tests/test_run_main_effort.mjs — the engine half of "a launch flag
 * turns implementer effort down": `--implementer-effort <v>` reaches
 * `run-main`, and its worker spends it on the implementer role and on nothing
 * else.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Each
 * assertion names its leg and the clause it comes from:
 *
 *   (c) [M3] `fleet/run-main.mjs` accepts `--implementer-effort <v>` for each of
 *       `low`, `medium` and `high` — its flag-to-arg map turns the flag into
 *       `implementerEffort` — and its worker passes `--effort <v>` on every
 *       `impl:<id>` and `fix:<id>:<n>` dispatch and on no `exam:<id>`,
 *       `review:<id>:<n>`, `integration`, `resolve:<…>`, `merge:<…>` or
 *       `reconcile:<…>` dispatch; with no flag no dispatch carries `--effort`.
 *
 * The proof is the REAL argv the CLI would receive — a fake `claude` records
 * `(cli, argv)` for every dispatch — not the wiring that is supposed to produce
 * it. `effortFor` and `buildArgs`'s `--effort` push already exist end to end at
 * BASE with nothing passing them, which is exactly the shape a wiring
 * assertion would have called green.
 *
 * Nothing here spawns a process: `spawnFn` is injected. `git` runs for real
 * against a throwaway repository, because the patch capture around an isolated
 * dispatch takes a real diff.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'

import { parseArgs, provisionRunTree, composeAgent } from '../run-main.mjs'
import { makeEventLog } from '../run-waves.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runmain-effort-'))
const git = (argv, cwd) =>
  execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** The three values the knob offers. */
const EFFORTS = ['low', 'medium', 'high']

/**
 * The eight dispatches M3 enumerates: the two the knob is FOR, and the six it
 * must leave alone. `isolation` is spelled the way the engine's own dispatch
 * sites spell it, so each label runs in the clone it really runs in.
 */
const DISPATCHES = [
  { label: 'impl:T1', isolation: 'worktree', role: 'implementer', turned: true },
  { label: 'fix:T1:0', isolation: 'worktree', role: 'implementer', turned: true },
  { label: 'exam:T1', isolation: 'worktree', role: 'examiner', turned: false },
  { label: 'review:T1:1', role: 'reviewer', turned: false },
  { label: 'integration', role: 'critic', turned: false },
  { label: 'resolve:x', role: 'resolver', turned: false },
  { label: 'merge:1', role: 'writeSide', turned: false },
  { label: 'reconcile:1', role: 'writeSide', turned: false },
]

// ── c. [M3] the flag-to-arg map ─────────────────────────────────────────────
{
  for (const v of EFFORTS) {
    const p = parseArgs(['plan.md', 'run-24', '--repo', '/t', '--implementer-effort', v])
    assert.equal(
      p.implementerEffort, v,
      `(c) [M3] run-main's flag-to-arg map turns --implementer-effort ${v} into implementerEffort`
    )
  }
  const none = parseArgs(['plan.md', 'run-24', '--repo', '/t'])
  assert.ok(
    !none.implementerEffort,
    `(c) [M3] with no flag there is no implementerEffort to spend; got ${JSON.stringify(none.implementerEffort)}`
  )
  // The knob is additive: the flags BASE already parses still parse.
  const both = parseArgs([
    'plan.md', 'run-24', '--repo', '/t', '--tier', 'standard', '--overlap', 'serialize',
    '--implementer-effort', 'low'
  ])
  assert.equal(both.tier, 'standard', '(c) [M3] --tier still parses alongside the new flag')
  assert.equal(both.overlap, 'serialize', '(c) [M3] and --overlap')
  assert.equal(both.implementerEffort, 'low', '(c) [M3] and implementerEffort')
}

// ── a repo at BASE, for the clones the dispatches run in ────────────────────
const repo = path.join(tmp, 'repo')
fs.mkdirSync(repo, { recursive: true })
git(['init', '-q', '-b', 'fleet-base'], repo)
git(['config', 'user.email', 't@example.com'], repo)
git(['config', 'user.name', 't'], repo)
fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n')
git(['add', '-A'], repo)
git(['commit', '-q', '-m', 'base'], repo)
const BASE = git(['rev-parse', 'HEAD'], repo).trim()

const ENVELOPE = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, session_id: 's',
  structured_output: { ok: true }, usage: {}, total_cost_usd: 0,
}) + '\n'

/**
 * Compose an agent over a fresh run tree with `extra` folded into
 * `composeAgent`'s arguments, run all eight dispatches through it, and answer
 * the argv the fake `claude` saw for each label.
 */
async function argvByLabel (name, extra) {
  const runDir = path.join(tmp, name)
  const tree = provisionRunTree({ repoDir: repo, runDir, base: BASE, taskIds: ['T1'] })
  const eventLog = makeEventLog({
    file: path.join(runDir, 'events.jsonl'), runId: name, base: BASE
  })
  const seen = []
  const spawnFn = (cli, argv) => {
    seen.push({ cli, argv })
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}
    child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {}
    child.kill = () => {}
    setImmediate(() => { child.stdout.emit('data', ENVELOPE); child.emit('close', 0, null) })
    return child
  }
  const { agent } = composeAgent({
    runId: name, base: BASE, runDir,
    clonesDir: tree.clonesDir, patchesDir: tree.patchesDir, workersDir: tree.workersDir,
    promptFileFor: () => undefined, settingsFor: () => undefined,
    env: process.env, cli: 'claude', eventLog, spawnFn,
    ...extra,
  })

  const out = new Map()
  for (const d of DISPATCHES) {
    const before = seen.length
    await agent('do the thing', {
      label: d.label, model: 'opus', ...(d.isolation ? { isolation: d.isolation } : {}),
    })
    assert.equal(seen.length, before + 1, `${d.label} dispatched exactly one \`claude\``)
    out.set(d.label, seen[seen.length - 1].argv)
  }
  return out
}

/** The value of `--effort` on one argv, or null when it carries none. */
function effortOf (argv, label) {
  const at = argv.indexOf('--effort')
  if (at === -1) return null
  assert.equal(
    argv.indexOf('--effort', at + 1), -1,
    `${label} carries --effort more than once: ${argv.join(' ')}`
  )
  return argv[at + 1]
}

// ── c. [M3] the implementer's two dispatches, and only those ───────────────
for (const v of EFFORTS) {
  const argvs = await argvByLabel(`effort-${v}`, { implementerEffort: v })
  for (const d of DISPATCHES) {
    const argv = argvs.get(d.label)
    const effort = effortOf(argv, d.label)
    if (d.turned) {
      assert.equal(
        effort, v,
        `(c) [M3] with implementerEffort ${v}, the ${d.role} dispatch ${d.label} carries --effort ${v}; ` +
        `got ${JSON.stringify(effort)} in: ${argv.join(' ')}`
      )
    } else {
      assert.equal(
        effort, null,
        `(c) [M3] with implementerEffort ${v}, the ${d.role} dispatch ${d.label} carries no --effort — ` +
        `every judge keeps its own; got ${JSON.stringify(effort)} in: ${argv.join(' ')}`
      )
    }
  }
}

// ── c. [M3] no flag, no --effort anywhere ──────────────────────────────────
{
  const argvs = await argvByLabel('effort-none', {})
  for (const d of DISPATCHES) {
    const argv = argvs.get(d.label)
    assert.equal(
      effortOf(argv, d.label), null,
      `(c) [M3] with no implementerEffort the ${d.role} dispatch ${d.label} carries no --effort — ` +
      `the default is unchanged; got: ${argv.join(' ')}`
    )
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
