// tests/sim_base_ancestry.mjs
//
// Behavioral sim for the #314 base-ancestry provisioning guard, on REAL git.
// Like sim_workflow.mjs this runs the real orchestrator body from
// skills/ultrapowers/harnesses/waves.js with stubbed engine globals — but its
// implementer stub provisions a real worktree in a temp repository (as the
// runtime's isolation: 'worktree' does), runs the anchor recipe the prompt
// prescribes, commits, and reports the pre-reset sha as startHead.
//
// The fixture is the #314 condition: origin holds commits newer than BASE, the
// target checkout has fetched them, and provisioning cuts from that stale ref.
// A second shape (integration branch advanced past main) covers the other
// drift direction. Both must trip; a correct base must never trip.
//
// NOT run by the suite-gate unless harness JS changed; tests/test_js_specs.py
// runs it under pytest. Run manually:  node tests/sim_base_ancestry.mjs
// Self-asserting: throws (exit 1) on any failed expectation.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const WF_URL = new URL('../skills/ultrapowers/harnesses/waves.js', import.meta.url)
const SRC = fs.readFileSync(WF_URL, 'utf8').replace('export const meta', 'const meta')

export function runWorkflow({ agent, args }) {
  const parallel = (thunks) => Promise.all(thunks.map((t) => t()))
  const phase = () => {}
  const log = () => {}
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const factory = new Function(
    'agent', 'parallel', 'phase', 'log', 'args', 'budget',
    '"use strict"; return (async () => {\n' + SRC + '\n})();'
  )
  return factory(agent, parallel, phase, log, args, budget)
}

function assert(cond, msg) {
  if (!cond) throw new Error('SIM ASSERT FAILED: ' + msg)
}
function eq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ')')
}

// Identity/hook flags on every call so the sim never reads the host's git
// config; no shell — execFile only.
const GIT_ID = ['-c', 'user.email=sim@example.com', '-c', 'user.name=sim',
  '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null']
export const git = (cwd, ...args) =>
  execFileSync('git', [...GIT_ID, ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// One temp root per process (concurrency-safe alongside same-wave suites);
// every repo, worktree and run dir lives under it and cleanup() removes it.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-base-ancestry-'))
export const cleanup = () => fs.rmSync(TMP, { recursive: true, force: true })

const commitFile = (repo, name, content, msg) => {
  fs.writeFileSync(path.join(repo, name), content)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', msg)
  return git(repo, 'rev-parse', 'HEAD')
}

// The #314 fixture.
//   base1  — c0 on main; the integration branch (wave-1 BASE) is cut here.
//   newer  — origin/main after two "nightly" commits pushed from elsewhere and
//            FETCHED into the target (the stale ref #314 provisioned from).
//            base1 IS an ancestor of newer: an is-ancestor predicate passes.
//   base2  — the integration branch one commit ahead of main (the wave-2
//            shape: a merge landed); `older` = main (c0), behind base2.
export function makeRepo() {
  const origin = path.join(TMP, 'origin.git')
  const target = path.join(TMP, 'target')
  const upstream = path.join(TMP, 'upstream')
  git(TMP, 'init', '-q', '--bare', '-b', 'main', origin)
  git(TMP, 'clone', '-q', origin, target)
  git(target, 'checkout', '-q', '-b', 'main')
  const base1 = commitFile(target, 'README.md', 'c0\n', 'c0')
  git(target, 'push', '-q', '-u', 'origin', 'main')
  git(target, 'branch', 'ultra/integration-sim', base1)
  // wave-2 shape: the integration branch advances (a merged wave), main does not
  git(target, 'checkout', '-q', 'ultra/integration-sim')
  const base2 = commitFile(target, 'integration-1.txt', 'merged wave 1\n', 'integration 1')
  git(target, 'checkout', '-q', 'main')
  // #314 shape: origin advances past base1; the target FETCHES it
  git(TMP, 'clone', '-q', origin, upstream)
  commitFile(upstream, 'nightly-1.txt', 'n1\n', 'nightly 1')
  commitFile(upstream, 'nightly-2.txt', 'n2\n', 'nightly 2')
  git(upstream, 'push', '-q', 'origin', 'main')
  git(target, 'fetch', '-q', 'origin')
  const newer = git(target, 'rev-parse', 'origin/main')
  return { tmp: TMP, target, base1, base2, newer, older: base1 }
}

export const isAncestor = (repo, a, b) => {
  try { git(repo, 'merge-base', '--is-ancestor', a, b); return true } catch (e) { return false }
}

// What the runtime's isolation: 'worktree' does — a fresh worktree on its own
// engine-named branch, cut from whatever ref the runtime happens to hold.
let provisioned = 0
export function provision(repo, cutRef) {
  provisioned += 1
  const branch = 'worktree-wf_sim-' + provisioned
  const dir = path.join(TMP, 'wt-' + provisioned)
  git(repo, 'worktree', 'add', '-q', '-b', branch, dir, cutRef)
  return { dir, branch }
}

// The recipe the implementer prompt prescribes as its FIRST command sequence:
// rev-parse HEAD (that sha is startHead), reset --hard BASE on mismatch,
// re-confirm. Asserts the post-condition every time.
export let resets = 0
export function anchorToBase(dir, base) {
  const startHead = git(dir, 'rev-parse', 'HEAD')
  let reset = false
  if (startHead !== base) {
    git(dir, 'reset', '-q', '--hard', base)
    reset = true
    resets += 1
  }
  eq(git(dir, 'rev-parse', 'HEAD'), base, 'anchorToBase: HEAD equals BASE after the recipe')
  return { startHead, reset }
}

const REPO = makeRepo()

// ── Scenario 1: #314 literal — cut from the NEWER fetched ref ──────────────
async function scenarioRecipeNewer() {
  const { target, base1, newer } = REPO
  assert(newer !== base1, 'fixture: origin/main advanced past BASE')
  // The predicate finding: BASE is an ancestor of the stale ref, so
  // `merge-base --is-ancestor BASE HEAD` would PASS on the #314 shape.
  eq(isAncestor(target, base1, newer), true, 'fixture: BASE is an ancestor of the newer ref (ancestor test is blind here)')
  const { dir } = provision(target, newer)
  eq(git(dir, 'rev-parse', 'HEAD'), newer, 'provisioned worktree sits at the stale ref')
  const r = anchorToBase(dir, base1)
  eq(r, { startHead: newer, reset: true }, 'recipe: reported the stale sha and reset')
  eq(git(dir, 'rev-parse', 'HEAD'), base1, 'recipe: worktree now at BASE')
  assert(!fs.existsSync(path.join(dir, 'nightly-1.txt')), 'recipe: stale commits gone from the tree')
  console.log('scenario recipe-newer: OK')
}

// ── Scenario 2: the other direction — cut from a ref BEHIND BASE ───────────
async function scenarioRecipeOlder() {
  const { target, base2, older } = REPO
  eq(isAncestor(target, base2, older), false, 'fixture: BASE is not an ancestor of the older ref')
  const { dir } = provision(target, older)
  const r = anchorToBase(dir, base2)
  eq(r, { startHead: older, reset: true }, 'recipe: reported the older sha and reset forward')
  eq(git(dir, 'rev-parse', 'HEAD'), base2, 'recipe: worktree now at BASE')
  assert(fs.existsSync(path.join(dir, 'integration-1.txt')), 'recipe: the merged wave is present')
  console.log('scenario recipe-older: OK')
}

// ── Scenario 3: correct base — the recipe is a no-op ────────────────────────
async function scenarioRecipeClean() {
  const { target, base1 } = REPO
  const before = resets
  const { dir } = provision(target, base1)
  const r = anchorToBase(dir, base1)
  eq(r, { startHead: base1, reset: false }, 'recipe: no reset on a correct base')
  eq(resets - before, 0, 'recipe: zero resets on a correct base')
  console.log('scenario recipe-clean: OK')
}

// ── Scenario 4: cost of the assert per worktree ─────────────────────────────
const N = 20
function timeAnchor(cutRef, base) {
  const { target } = REPO
  let total = 0n
  for (let i = 0; i < N; i++) {
    const { dir } = provision(target, cutRef)
    const t0 = process.hrtime.bigint()
    anchorToBase(dir, base)
    total += process.hrtime.bigint() - t0
  }
  return Number(total) / 1e6 / N
}
async function scenarioTiming() {
  const { base1, newer } = REPO
  const stale = timeAnchor(newer, base1)
  const clean = timeAnchor(base1, base1)
  assert(Number.isFinite(stale) && stale > 0, 'timing: stale-path mean is a positive number')
  assert(Number.isFinite(clean) && clean > 0, 'timing: clean-path mean is a positive number')
  console.log('TIMING anchor-to-base stale (rev-parse + reset --hard + confirm): mean ' + stale.toFixed(1) + ' ms over n=' + N)
  console.log('TIMING anchor-to-base clean (rev-parse + confirm): mean ' + clean.toFixed(1) + ' ms over n=' + N)
  console.log('scenario timing: OK')
}

// ── ENGINE SCENARIOS (append zone) ──────────────────────────────────────────
// Scenarios that drive the real harness body through runWorkflow() with a
// git-backed implementer stub are added here.

const RUN = [
  scenarioRecipeNewer,
  scenarioRecipeOlder,
  scenarioRecipeClean,
  scenarioTiming,
  // engine scenarios append here
]
try {
  for (const s of RUN) await s()
} finally {
  cleanup()
}
console.log('ALL SCENARIOS PASSED')
