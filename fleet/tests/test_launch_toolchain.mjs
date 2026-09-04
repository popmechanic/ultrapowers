/**
 * fleet/tests/test_launch_toolchain.mjs — the launcher refuses a target whose
 * toolchain the sandbox lacks.
 *
 * The sandbox's setup script installs node, bun and pytest only. The
 * preflight's `detect_test_cmd` ladder is wider: `pytest.ini` →
 * `pyproject.toml` containing `[tool.pytest` → `package.json` → a `Makefile`
 * with a line matching `^test\s*:` → `go.mod` → `Cargo.toml`. The last three
 * rungs name toolchains no fleet VM has, so a Go or Rust target is refused by
 * name on the laptop instead of dying on the box.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Each
 * assertion names its leg and the clause it comes from:
 *
 *   (a) [M1] a clone with `go.mod` alone: a `Refusal` whose message contains
 *       `toolchain go` and `go.mod`;
 *   (b) [M2] a clone with `Cargo.toml` alone: `toolchain cargo`, `Cargo.toml`;
 *   (c) [M3] a clone whose `Makefile` is one `test:` rule: `toolchain make`,
 *       `Makefile`;
 *   (d) [M4] in each of those three the recorded argv holds no `push` verb and
 *       no `new` verb, and the credential refresh was not invoked;
 *   (e) [M5] `package.json` beside `go.mod` reaches the plan push — the
 *       ladder's earlier rung wins — and so does a clone with no manifest;
 *   (f) [M6] the usage string names the same flags it named at BASE.
 *
 * The fixture is `test_launch.mjs`'s: a real bare origin and a clone whose
 * `origin` is spelled the way a real target's is, driven through the recording
 * exec seam. Nothing here opens a network socket, and the manifests are plain
 * files written into the clone's working tree before `launch()` is called.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { USAGE, launch } from '../launch.mjs'
import { FLEET_DEFAULTS, Refusal, defaultExec } from '../lobby.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
/** The target's one GitHub integration object. */
const GH = 'gh-popmechanic-smoke'
/** How a real target's `origin` is spelled. */
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-03T22:15:00.000Z')
const PLAN_TEXT = '# a plan\n\nOne task, and a trailing newline.\n'
/** The seed commit: no manifest of any kind, so each leg writes its own. */
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n' }
const CONFIG = { ...FLEET_DEFAULTS }
/** `billing plan --json`, wide enough that no leg is refused on capacity. */
const BILLING_OK = {
  max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual'
}

// ── The seam's rules — test_launch.mjs's, so a green leg is green there too ──

const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

const ENGINE_RULE = {
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${ENGINE}\tHEAD\n`)
}

/** `origin` on the launcher's own `push`/`ls-remote` points at the bare path. */
const localRemote = (repo) => ({
  when: (cmd, argv) => cmd === 'git' &&
    (argv.includes('push') || argv.includes('ls-remote')) &&
    !argv.includes('--get-url') &&
    !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => defaultExec(
    'git',
    argv.map((a) => (a === 'origin' || /github\.com/.test(String(a)) ? repo.origin : a)),
    options ?? {}
  )
})

/** No socket, whatever else the launcher tries. */
const OFFLINE = answer('', { code: 128, stderr: 'exam: this exam opens no network socket\n' })
const NO_REMOTE_OPS = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => a === 'clone' || a === 'pull' || a === 'fetch'),
  answer: OFFLINE
}
const NO_NETWORK_GIT = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))),
  answer: OFFLINE
}

const readRules = (repo) => [
  ENGINE_RULE,
  localRemote(repo),
  sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule('new ', NEW_OK),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The workspace: a real target repository, a plan beside it, and manifests ─

/** `manifests` are written into the clone's working tree, at its root. */
function workspace ({ manifests = {} } = {}) {
  const root = tempDir('fleet-launch-toolchain-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  for (const [rel, body] of Object.entries(manifests)) {
    fs.writeFileSync(path.join(repo.dir, rel), body)
  }
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

/** The origin's own `refs/heads/*`, read off the bare path the exam made. */
const branchesOf = (ws) => {
  const out = {}
  for (const line of ws.repo.git(['ls-remote', '--heads', ws.repo.origin]).split('\n')) {
    const [sha, ref] = line.split('\t')
    if (!ref) continue
    out[ref.trim().replace(/^refs\/heads\//, '')] = sha.trim()
  }
  return out
}

/** Every `git … push …` the seam recorded, and every `new` lobby verb. */
const pushCalls = (exec) => exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('push'))
const newLines = (exec) => exec.lobby().filter((line) => line.startsWith('new '))

/**
 * One launch against `manifests`, with the credential refresh counted: M4 asks
 * whether it ran at all, so it is a seam of its own here.
 */
async function launchAgainst (manifests) {
  const ws = workspace({ manifests })
  const exec = makeExec({ rules: readRules(ws.repo) })
  let refreshes = 0
  const argv = [
    ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
    '--engine', ENGINE
  ]
  let result = null
  const error = await thrown(async () => {
    result = await launch({
      argv,
      exec,
      config: CONFIG,
      now: () => NOW,
      sleep: async () => {},
      refreshCredential: () => {
        refreshes += 1
        return { ok: true }
      }
    })
  })
  return { ws, exec, error, result, refreshes }
}

// ── a, b, c. [M1] [M2] [M3] the three toolchains the sandbox lacks ──────────
// ── d. [M4] and each refusal before the refresh, the push and any `new` ─────
{
  const cases = [
    {
      leg: 'a',
      clause: 'M1',
      name: 'a clone with go.mod alone',
      manifests: { 'go.mod': 'module example.com/smoke\n\ngo 1.23\n' },
      toolchain: 'toolchain go',
      manifest: 'go.mod'
    },
    {
      leg: 'b',
      clause: 'M2',
      name: 'a clone with Cargo.toml alone',
      manifests: { 'Cargo.toml': '[package]\nname = "smoke"\nversion = "0.1.0"\nedition = "2021"\n' },
      toolchain: 'toolchain cargo',
      manifest: 'Cargo.toml'
    },
    {
      leg: 'c',
      clause: 'M3',
      name: 'a clone whose Makefile is one `test:` rule',
      manifests: { Makefile: 'test:\n' },
      toolchain: 'toolchain make',
      manifest: 'Makefile'
    }
  ]

  for (const kase of cases) {
    const { ws, exec, error, refreshes } = await launchAgainst(kase.manifests)
    const where = `(${kase.leg}) [${kase.clause}] ${kase.name}`

    assert.ok(error, `${where} must refuse`)
    assert.ok(
      error instanceof Refusal,
      `${where} refuses with a Refusal, got ${error?.name}: ${error?.message}`
    )
    assert.ok(
      error.message.includes(kase.toolchain),
      `${where}: the message names \`${kase.toolchain}\`, got ${JSON.stringify(error.message)}`
    )
    assert.ok(
      error.message.includes(kase.manifest),
      `${where}: the message names the manifest \`${kase.manifest}\` that detected it, got ${JSON.stringify(error.message)}`
    )

    // (d) [M4] before the credential refresh, before the plan push, before any
    //     lobby verb that creates something.
    assert.equal(refreshes, 0, `(d) [M4] ${kase.name}: the credential refresh was not invoked`)
    assert.deepEqual(
      pushCalls(exec).map((c) => c.line), [],
      `(d) [M4] ${kase.name}: the recorded argv holds no entry whose verb is \`push\``
    )
    assert.deepEqual(
      newLines(exec), [],
      `(d) [M4] ${kase.name}: and none whose verb is \`new\``
    )
    assert.deepEqual(
      exec.mutating(), [],
      `(d) [M4] ${kase.name}: nothing on exe.dev was mutated`
    )
    assert.ok(
      Object.keys(branchesOf(ws)).every((ref) => !ref.startsWith('ultra/')),
      `(d) [M4] ${kase.name}: and the origin carries no ultra/ ref`
    )
    ws.cleanup()
  }
}

// ── e. [M5] the rungs the ladder reaches first, and no manifest at all ──────
{
  const cases = [
    {
      name: 'package.json (an empty object) beside go.mod',
      why: "the ladder's earlier rung wins, so this is a Node target",
      manifests: { 'package.json': '{}\n', 'go.mod': 'module example.com/smoke\n\ngo 1.23\n' }
    },
    {
      name: 'a clone holding none of the six manifests',
      why: 'nothing detected a toolchain, so nothing is refused on one',
      manifests: {}
    }
  ]

  for (const kase of cases) {
    const { ws, exec, error, result } = await launchAgainst(kase.manifests)
    const where = `(e) [M5] ${kase.name}`

    assert.equal(
      error, null,
      `${where} is not refused on the toolchain — ${kase.why}; got ${error?.name}: ${error?.message}`
    )
    assert.equal(
      pushCalls(exec).length, 1,
      `${where} reaches the plan push: the recorded argv holds a \`push\``
    )
    assert.match(
      result.plan, /^[0-9a-f]{40}$/,
      `${where} pushed a plan commit git made`
    )
    assert.equal(
      branchesOf(ws)[result.planBranch], result.plan,
      `${where}: the origin's ${result.planBranch} is that commit`
    )
    ws.cleanup()
  }
}

// ── f. [M6] the usage string names no new flag ──────────────────────────────
{
  // The flags `fleet/launch.mjs` spelled at BASE (13c0e15), sorted. A launcher
  // that grew a flag for this refusal would break the docs pin in
  // tests/test_docs_agree_with_code.py; it is named here too, so the sim says
  // which flag appeared.
  const BASE_FLAGS = [
    '--base', '--config', '--cpu', '--engine', '--json', '--memory',
    '--overlap', '--repo', '--run', '--target', '--tier'
  ]
  assert.deepEqual(
    [...new Set(USAGE.match(/--[a-z][a-z-]*/g) ?? [])].sort(), BASE_FLAGS,
    '(f) [M6] the usage string names the same flags it named at BASE — the refusal is unconditional, not a flag'
  )
}

console.log('ALL TESTS PASSED')
