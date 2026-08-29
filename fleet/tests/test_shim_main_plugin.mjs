// fleet/tests/test_shim_main_plugin.mjs — #373: the engine under test is the
// pushed base. After `invokeEngineRun` checks out `fleet-base` and before it
// spawns the engine, it installs the ultrapowers plugin FROM that checkout
// through the injected `exec` seam (`pluginInstallCommands`, the sequence
// proven live on a `cp fleet-golden` probe). A failed install refuses the
// launch with a named error and spawns nothing — never the image's stale
// plugin — and `installedPluginVersion` is stamped from the POST-install
// `claude plugin list`, read after the run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startOrchestrator, FLEET_PATH } from '../orchestrator.mjs'
import { mintToken } from '../tokens.mjs'
import {
  main as shimMain,
  invokeEngineRun,
  installPluginFromCheckout,
  pluginInstallCommands,
  readInstalledPluginSha,
  INSTALLED_PLUGINS_COMMAND,
  PLUGIN_ID,
  BASE_REF,
  sandboxIdFor,
} from '../shim-main.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const REPO = '/home/exedev/repo'
const INSTALL = pluginInstallCommands({ repoDir: REPO })
const CHECKOUT = `git -C ${REPO} checkout -q ${BASE_REF}`
const SHA = '42734e8d70abc3abcc664969ac70d62ef2a09f42'
const installedJson = (sha) => JSON.stringify({ version: 2, plugins: { [PLUGIN_ID]: [{ version: '0.2.25', gitCommitSha: sha }] } })

/**
 * An exec stub that records every command in order and answers from a small
 * table: `fail` names commands that exit 1, `throwOn` a command that rejects,
 * `sha` the gitCommitSha the installed_plugins.json read reports (null → the
 * read exits 1, i.e. unreadable). Everything else exits 0 with empty stdout,
 * except `rev-parse fleet-base`, which reports `SHA`.
 */
const mkExec = ({ fail = [], throwOn = null, sha = SHA } = {}) => {
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    if (cmd === throwOn) throw new Error('exec seam rejected')
    if (fail.includes(cmd)) return { code: 1, stdout: '', stderr: `✘ ${cmd} failed` }
    if (cmd === INSTALLED_PLUGINS_COMMAND) return sha === null ? { code: 1, stdout: '' } : { code: 0, stdout: installedJson(sha) }
    if (cmd === `git -C ${REPO} rev-parse ${BASE_REF}`) return { code: 0, stdout: `${SHA}\n` }
    return { code: 0, stdout: '' }
  }
  return { cmds, exec }
}

const mkSpawn = (cmds, code = 1) => {
  const spawns = []
  const spawnEngine = async (call) => {
    spawns.push({ ...call, afterCommands: cmds.length })
    return code
  }
  return { spawns, spawnEngine }
}

const quiet = () => {}

// --- 1. the command sequence is pinned exactly --------------------------------
assert.deepEqual(INSTALL, [
  `claude plugin marketplace add ${REPO}`,
  `claude plugin uninstall ${PLUGIN_ID}`,
  `claude plugin install ${PLUGIN_ID}`,
])
assert.equal(PLUGIN_ID, 'ultrapowers@ultrapowers')
ok('pluginInstallCommands: marketplace add <repo> → uninstall → install, in that order')

// --- 2. issued in order, after the checkout, before the spawn -----------------
{
  const { cmds, exec } = mkExec()
  const { spawns, spawnEngine } = mkSpawn(cmds)
  const logs = []
  const outcome = await invokeEngineRun({ repoDir: REPO, planPath: 'docs/p.md', runId: 'run-plugin', exec, spawnEngine, log: (l) => logs.push(l) })
  assert.deepEqual(outcome, { gateGreen: false })
  const at = (cmd) => cmds.indexOf(cmd)
  assert.ok(at(CHECKOUT) >= 0, `checkout must be issued, got ${JSON.stringify(cmds)}`)
  assert.deepEqual(cmds.slice(at(CHECKOUT) + 1, at(CHECKOUT) + 1 + INSTALL.length), INSTALL, 'install follows the checkout, in order')
  assert.ok(at(INSTALLED_PLUGINS_COMMAND) > at(INSTALL[2]), 'the sha cross-check reads after the install')
  assert.equal(spawns.length, 1, 'the engine spawns exactly once')
  assert.ok(spawns[0].afterCommands > at(INSTALL[2]), 'the spawn happens after the install')
  assert.equal(spawns[0].command, 'claude')
  assert.equal(spawns[0].cwd, REPO)
  for (const cmd of INSTALL) assert.ok(logs.some((l) => l.includes(`\`${cmd}\``)), `each install command is logged: ${cmd}`)
  assert.ok(logs.some((l) => l.includes(`installed from the ${BASE_REF} checkout (gitCommitSha ${SHA})`)), 'the post-install sha is logged')
  ok('install commands issued in order after the checkout and before the spawn, each logged')
}

// --- 3. a failing command refuses the launch, names itself, spawns nothing ----
for (const [i, failing] of INSTALL.entries()) {
  const { cmds, exec } = mkExec({ fail: [failing] })
  const { spawns, spawnEngine } = mkSpawn(cmds)
  const logs = []
  const outcome = await invokeEngineRun({ repoDir: REPO, planPath: 'docs/p.md', runId: 'run-plugin', exec, spawnEngine, log: (l) => logs.push(l) })
  assert.deepEqual(outcome, { gateGreen: false, error: `plugin install from checkout failed: \`${failing}\` exited 1` })
  assert.equal(spawns.length, 0, 'nothing spawns on a failed install')
  assert.deepEqual(cmds.filter((c) => INSTALL.includes(c)), INSTALL.slice(0, i + 1), 'the sequence stops at the first failure')
  assert.ok(!cmds.includes(INSTALLED_PLUGINS_COMMAND), 'no sha read after a failed install')
  assert.ok(logs.some((l) => l.includes(`\`${failing}\` exited 1: ✘ ${failing} failed`)), 'the failure is logged with its stderr')
  ok(`install step ${i + 1} failing (\`${failing}\`) refuses the launch with the named error`)
}

// --- 4. a REJECTING exec on an install command is the same refusal ------------
{
  const { cmds, exec } = mkExec({ throwOn: INSTALL[0] })
  const { spawns, spawnEngine } = mkSpawn(cmds)
  const outcome = await invokeEngineRun({ repoDir: REPO, planPath: 'docs/p.md', runId: 'run-plugin', exec, spawnEngine, log: quiet })
  assert.deepEqual(outcome, { gateGreen: false, error: `plugin install from checkout failed: \`${INSTALL[0]}\` exited 1` })
  assert.equal(spawns.length, 0)
  ok('a rejecting exec seam on an install command refuses the launch, never crashes')
}

// --- 5. a failed checkout never reaches the install ---------------------------
{
  const { cmds, exec } = mkExec({ fail: [CHECKOUT] })
  const { spawns, spawnEngine } = mkSpawn(cmds)
  const outcome = await invokeEngineRun({ repoDir: REPO, planPath: 'docs/p.md', runId: 'run-plugin', exec, spawnEngine, log: quiet })
  assert.deepEqual(outcome, { gateGreen: false, error: `checkout ${BASE_REF} failed` })
  assert.equal(cmds.filter((c) => INSTALL.includes(c)).length, 0, 'no install command before a successful checkout')
  assert.equal(spawns.length, 0)
  ok('install is issued only after the fleet-base checkout succeeds')
}

// --- 6. installed sha ≠ fleet-base sha refuses; unreadable sha continues ------
{
  const { cmds, exec } = mkExec({ sha: '5d8960b3780a41d1898b4de1735fc6e9a3adff6c' })
  const { spawns, spawnEngine } = mkSpawn(cmds)
  const outcome = await invokeEngineRun({ repoDir: REPO, planPath: 'docs/p.md', runId: 'run-plugin', exec, spawnEngine, log: quiet })
  assert.equal(outcome.gateGreen, false)
  assert.match(outcome.error, /^plugin install from checkout failed: installed gitCommitSha 5d8960b\S+ is not fleet-base 42734e8/)
  assert.equal(spawns.length, 0)
  ok('an installed gitCommitSha naming another commit refuses the launch')
}
{
  const { cmds, exec } = mkExec({ sha: SHA.slice(0, 12) })
  const { spawns, spawnEngine } = mkSpawn(cmds)
  await invokeEngineRun({ repoDir: REPO, planPath: 'docs/p.md', runId: 'run-plugin', exec, spawnEngine, log: quiet })
  assert.equal(spawns.length, 1, 'an abbreviated sha that prefixes fleet-base is a match')
  ok('an abbreviated installed sha matching fleet-base still launches')
}
{
  const { cmds, exec } = mkExec({ sha: null })
  const { spawns, spawnEngine } = mkSpawn(cmds)
  const logs = []
  const outcome = await invokeEngineRun({ repoDir: REPO, planPath: 'docs/p.md', runId: 'run-plugin', exec, spawnEngine, log: (l) => logs.push(l) })
  assert.deepEqual(outcome, { gateGreen: false })
  assert.equal(spawns.length, 1, 'an unreadable installed_plugins.json does not block the launch')
  assert.ok(logs.some((l) => l.includes('gitCommitSha unreadable')))
  ok('an unreadable installed_plugins.json is logged and the launch proceeds on the exit codes')
}

// --- 7. the pure helpers --------------------------------------------------------
{
  assert.equal(await readInstalledPluginSha({ exec: async () => ({ code: 0, stdout: installedJson(SHA) }) }), SHA)
  assert.equal(await readInstalledPluginSha({ exec: async () => ({ code: 0, stdout: '{"plugins":{}}' }) }), '')
  assert.equal(await readInstalledPluginSha({ exec: async () => ({ code: 1, stdout: '' }) }), '')
  assert.equal(await readInstalledPluginSha({ exec: async () => ({ code: 0, stdout: 'not json' }) }), '')
  assert.equal(await readInstalledPluginSha({ exec: async () => { throw new Error('no') } }), '')
  const seen = []
  await readInstalledPluginSha({ exec: async (cmd) => { seen.push(cmd); return { code: 0, stdout: '{}' } } })
  assert.deepEqual(seen, [INSTALLED_PLUGINS_COMMAND])
  assert.deepEqual(await installPluginFromCheckout({ repoDir: REPO, exec: async () => ({ code: 0, stdout: 'ok' }), log: quiet }), { ok: true })
  ok('readInstalledPluginSha / installPluginFromCheckout: shapes pinned, never throw')
}

// --- 8. main(): installedPluginVersion is the POST-install plugin list --------
// A real orchestrator, the real `main()`, the real `invokeEngineRun` — only
// `exec` and `spawnEngine` are stubbed. `claude plugin list --json` answers
// with the image's version UNTIL the install command has been issued, then
// with the checkout's; the cell the driver reads must carry the latter.
{
  const runId = 'run-plugin-1'
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plugin-'))
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plugin-repo-'))
  const now = Date.now()
  const { token, record } = mintToken({ sandboxId: sandboxIdFor(runId), ttlMs: 60_000, now })
  const orch = await startOrchestrator({
    port: 0,
    dbDir: path.join(tmp, 'db'),
    tokenRecords: [record],
    actions: { page: () => {}, revokeAndPark: () => {}, destroySandbox: () => {} },
  })
  orch.store.setRow('runs', runId, { planPath: 'p.md', sandboxId: '', status: 'pending', branch: 'fleet-run' })
  const assignmentPath = path.join(tmp, 'fleet-run.json')
  fs.writeFileSync(
    assignmentPath,
    JSON.stringify({ runId, token, wsUrl: `ws://127.0.0.1:${orch.port}/${FLEET_PATH}`, ttlMs: 60_000, planPath: 'docs/p.md' }),
  )
  const installCmds = pluginInstallCommands({ repoDir })
  const cmds = []
  let installedFromCheckout = false
  let listReadsAfterInstall = 0
  const exec = async (cmd) => {
    cmds.push(cmd)
    if (cmd === installCmds[2]) installedFromCheckout = true
    if (cmd === 'claude plugin list --json') {
      if (installedFromCheckout) listReadsAfterInstall += 1
      const version = installedFromCheckout ? '0.2.25-checkout' : '0.2.25-image'
      return { code: 0, stdout: JSON.stringify([{ id: PLUGIN_ID, version }]) }
    }
    if (cmd === `git -C ${repoDir} rev-parse ${BASE_REF}`) return { code: 0, stdout: `${SHA}\n` }
    if (cmd === INSTALLED_PLUGINS_COMMAND) return { code: 0, stdout: installedJson(SHA) }
    return { code: 0, stdout: '' }
  }
  let spawned = 0
  let cell
  try {
    const outcome = await shimMain({
      assignmentPath,
      repoDir,
      exec,
      spawnEngine: async () => {
        spawned += 1
        return 1
      },
      readTokens: () => 0,
    })
    assert.equal(outcome.status, 'failed', 'engine exit 1 with no receipt parks (the stub never gates)')
    cell = orch.store.getCell('runs', runId, 'installedPluginVersion')
  } finally {
    await orch.stop()
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(repoDir, { recursive: true, force: true })
  }
  assert.equal(spawned, 1, 'the real invokeEngineRun ran through main() and reached the spawn')
  assert.equal(listReadsAfterInstall, 1, 'the plugin list is read exactly once, after the install')
  assert.equal(cell, '0.2.25-checkout', `installedPluginVersion must be the post-install plugin list, got ${JSON.stringify(cell)}`)
  const at = (cmd) => cmds.indexOf(cmd)
  assert.ok(at(installCmds[0]) > at(`git -C ${repoDir} checkout -q ${BASE_REF}`), 'main() threads repoDir into the install after the checkout')
  ok('main(): installedPluginVersion is stamped from the post-install plugin list (#373)')
}

console.log(`\nALL TESTS PASSED (${passed})`)
