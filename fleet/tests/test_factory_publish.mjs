import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { bootRig, FIXTURE_PLAN, ENGINE_SHA, MERGE_SHA } from './_boot_helpers.mjs'

const PUBLISH_FIXTURE_PLAN = FIXTURE_PLAN.replace(
  '**Closes:** #1222\n\n## Global Constraints',
  [
    '**Closes:** #1222',
    '**Publish:** bun run --cwd server deploy',
    '**Verify:** bun server/probe/converge-live.ts $ULTRA_PUBLISH_URL',
    '**Rollback:** bunx --cwd server wrangler rollback --yes',
    '',
    '## Global Constraints'
  ].join('\n')
)
assert.notEqual(
  PUBLISH_FIXTURE_PLAN, FIXTURE_PLAN,
  'the publish fixture plan actually carries the three new Publish/Verify/Rollback header lines'
)

const BUN_STUB = `#!/bin/sh
verb="other"
case "$*" in
  *"run --cwd server deploy"*) verb="deploy" ;;
  *"converge-live.ts"*) verb="verify" ;;
esac
env > "$HOME/publish-env-$verb.txt"
case_val="green"
[ -f "$HOME/publish-case" ] && case_val="$(cat "$HOME/publish-case")"
if [ "$verb" = "deploy" ]; then
  [ "$case_val" = "slow" ] && sleep 10
  if [ "$case_val" = "deploy-failed" ]; then
    echo "fixture: deploy failed" 1>&2
    exit 1
  fi
  echo "Deployed fixture-worker triggers"
  echo "https://fixture.example.workers.dev"
  exit 0
elif [ "$verb" = "verify" ]; then
  if [ "$case_val" = "red" ]; then
    echo "fixture: verify failed" 1>&2
    exit 1
  fi
  echo "fixture: verify ok"
  exit 0
fi
exit 0
`

const BUNX_STUB = `#!/bin/sh
verb="other"
case "$*" in
  *"wrangler rollback"*) verb="rollback" ;;
esac
env > "$HOME/publish-env-$verb.txt"
if [ "$verb" = "rollback" ]; then
  echo "$*" >> "$HOME/rollback-calls"
  echo "fixture: rolled back"
  exit 0
fi
exit 0
`

const PUBLISH_RIG = bootRig({ plan: PUBLISH_FIXTURE_PLAN, stubs: { bun: BUN_STUB, bunx: BUNX_STUB } })
const PLAIN_RIG = bootRig({ plan: FIXTURE_PLAN })
const { git } = PUBLISH_RIG

const proxyServer = await PUBLISH_RIG.makeProxyServer()
const PROXY_URL = `http://127.0.0.1:${proxyServer.address().port}`

async function runCase (rig, runN, markCase, afterEngine) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `fleet-publish-${runN}-`))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  rig.writeGitConfig(home)
  if (markCase) fs.writeFileSync(path.join(home, 'publish-case'), markCase)

  const { originDir, evidenceDir, base, plan } = rig.buildOrigin(root, runN)
  rig.wireEvidence(home, evidenceDir)
  rig.git(root, ['clone', originDir, path.join(home, 'target')])
  const engineDir = rig.buildEngineDir(home, ENGINE_SHA)
  if (afterEngine) afterEngine(engineDir)
  rig.writeStubs(bin, { claudeAuth: 'oauth' })

  const env = {
    ...rig.baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: rig.assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA }),
    MERGE_SHA
  }

  const res = await rig.runBootAsync({ bin, home, env })
  return { res, root, home, bin, originDir, evidenceDir, base, plan }
}

function readEvidence (evidenceDir, runN, p) {
  return git(evidenceDir, ['show', `o-r/run-${runN}:runs/o-r/${runN}/${p}`])
}

function evidenceRunDirEntries (evidenceDir, runN) {
  return git(evidenceDir, ['ls-tree', '-r', '--name-only', `o-r/run-${runN}`])
    .split('\n').filter((p) => p.startsWith(`runs/o-r/${runN}/`))
}

{
  const runN = '601'
  const { res, home, evidenceDir } = await runCase(PUBLISH_RIG, runN, 'green')
  assert.equal(
    res.code, 0,
    `(a) [M2] the green publish case exits 0 — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const status = JSON.parse(readEvidence(evidenceDir, runN, 'status.json'))
  assert.equal(status.state, 'done', '(a) [M2] status.json state is "done"')
  assert.equal(
    status.phase, 'the pull request was merged and the app is published',
    '(a) [M2] status.json phase is exactly "the pull request was merged and the app is published"'
  )

  const eventsText = readEvidence(evidenceDir, runN, 'events.jsonl')
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  const nonLanding = rows.filter((r) => r.kind !== 'landing')
  assert.deepEqual(
    nonLanding.map((r) => r.kind),
    ['publish:pr', 'weave:push', 'merge', 'publish:deploy', 'publish:verify'],
    `(a) [M2] events.jsonl's non-landing kinds are exactly publish:pr, weave:push, merge, publish:deploy, publish:verify in order, no rollback row — got ${JSON.stringify(nonLanding.map((r) => r.kind))}`
  )

  const deployRow = rows.find((r) => r.kind === 'publish:deploy')
  const verifyRow = rows.find((r) => r.kind === 'publish:verify')
  assert.equal(deployRow.exit, 0, '(a) [M2] the publish:deploy row carries exit 0')
  assert.equal(verifyRow.exit, 0, '(a) [M2] the publish:verify row carries exit 0')
  assert.equal(deployRow.url, 'https://fixture.example.workers.dev', '(a) [M2] the publish:deploy row names the deployed url')
  assert.equal(verifyRow.url, deployRow.url, '(a) [M2] the publish:verify row names the same url')
  assert.equal(deployRow.cmd, 'bun run --cwd server deploy', "(a) [M2] the publish:deploy row names the plan's own deploy command")
  assert.equal(
    verifyRow.cmd, 'bun server/probe/converge-live.ts $ULTRA_PUBLISH_URL',
    "(a) [M2] the publish:verify row names the plan's own verify command literally — $ULTRA_PUBLISH_URL unexpanded (the shell that expands it is the probe's own, not the row)"
  )

  assert.ok(!eventsText.includes('Deployed fixture-worker triggers'), "(a) [M6] events.jsonl never embeds the deploy stub's stdout")
  assert.ok(!eventsText.includes('fixture: verify ok'), "(a) [M6] events.jsonl never embeds the verify stub's stdout")

  const publishJson = JSON.parse(readEvidence(evidenceDir, runN, 'publish.json'))
  assert.deepEqual(
    publishJson,
    {
      url: 'https://fixture.example.workers.dev',
      published: true,
      deploy: { cmd: 'bun run --cwd server deploy', exit: 0, ms: deployRow.ms },
      verify: { cmd: 'bun server/probe/converge-live.ts $ULTRA_PUBLISH_URL', exit: 0, ms: verifyRow.ms },
      rollback: null
    },
    `(a) [M2] publish.json is exactly the green shape — got ${JSON.stringify(publishJson)}`
  )

  assert.ok(
    !fs.existsSync(path.join(home, 'rollback-calls')),
    '(a) [M2] no rollback call log exists — bunx wrangler rollback was never invoked'
  )

  const runDirEntries = evidenceRunDirEntries(evidenceDir, runN).slice().sort()
  assert.deepEqual(
    runDirEntries,
    [
      `runs/o-r/${runN}/engine.log`,
      `runs/o-r/${runN}/events.jsonl`,
      `runs/o-r/${runN}/fleet-boot.log`,
      `runs/o-r/${runN}/plan.json`,
      `runs/o-r/${runN}/plan.md`,
      `runs/o-r/${runN}/publish-deploy.log`,
      `runs/o-r/${runN}/publish-verify.log`,
      `runs/o-r/${runN}/publish.json`,
      `runs/o-r/${runN}/status.json`,
      `runs/o-r/${runN}/view.json`
    ],
    `(a) [M2] the run folder at the run's tag carries the three publish files alongside the plan, the base three, the boot log and the run's view (#1562) — got ${JSON.stringify(runDirEntries)}`
  )

  const deployEnv = fs.readFileSync(path.join(home, 'publish-env-deploy.txt'), 'utf8')
  const verifyEnv = fs.readFileSync(path.join(home, 'publish-env-verify.txt'), 'utf8')
  for (const [label, envText] of [['deploy', deployEnv], ['verify', verifyEnv]]) {
    assert.ok(
      envText.includes('CLOUDFLARE_API_BASE_URL=https://cloudflare.int.exe.xyz/client/v4'),
      `(a) [M6] the ${label} probe env carries CLOUDFLARE_API_BASE_URL`
    )
    assert.ok(
      envText.includes('CLOUDFLARE_API_TOKEN=placeholder'),
      `(a) [M6] the ${label} probe env carries CLOUDFLARE_API_TOKEN`
    )
  }
  assert.ok(!deployEnv.includes('ULTRA_PUBLISH_URL='), '(a) [M2] the deploy env carries no ULTRA_PUBLISH_URL — only the verify probe gets it')
  assert.ok(
    verifyEnv.includes(`ULTRA_PUBLISH_URL=${deployRow.url}`),
    '(a) [M2] the verify probe env carries ULTRA_PUBLISH_URL set to the deployed url'
  )
}

{
  const runN = '602'
  const { res, home, evidenceDir } = await runCase(PUBLISH_RIG, runN, 'red')
  assert.equal(
    res.code, 0,
    `(b) [M3] the red publish case still exits 0 (a live check going red never fails the boot) — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const status = JSON.parse(readEvidence(evidenceDir, runN, 'status.json'))
  assert.equal(status.state, 'done', '(b) [M3] status.json state is "done"')
  assert.equal(
    status.phase, 'the pull request was merged; the live check was red and the deploy was rolled back',
    '(b) [M3] status.json phase is exactly the rolled-back text'
  )

  const eventsText = readEvidence(evidenceDir, runN, 'events.jsonl')
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  const nonLanding = rows.filter((r) => r.kind !== 'landing')
  assert.deepEqual(
    nonLanding.map((r) => r.kind),
    ['publish:pr', 'weave:push', 'merge', 'publish:deploy', 'publish:verify', 'publish:rollback'],
    `(b) [M3] events.jsonl carries deploy, verify, exactly one rollback row, in order — got ${JSON.stringify(nonLanding.map((r) => r.kind))}`
  )

  const verifyRow = rows.find((r) => r.kind === 'publish:verify')
  assert.equal(verifyRow.exit, 1, '(b) [M3] the publish:verify row carries exit 1')

  const rollbackRows = rows.filter((r) => r.kind === 'publish:rollback')
  assert.equal(rollbackRows.length, 1, `(b) [M3] exactly one publish:rollback row — got ${rollbackRows.length}`)
  assert.equal(rollbackRows[0].exit, 0, '(b) [M3] the rollback row carries exit 0')
  assert.equal(
    rollbackRows[0].cmd, 'bunx --cwd server wrangler rollback --yes',
    "(b) [M3] the rollback row names the plan's own rollback command"
  )

  const publishJson = JSON.parse(readEvidence(evidenceDir, runN, 'publish.json'))
  assert.equal(publishJson.published, false, '(b) [M3] publish.json published is false')
  assert.equal(publishJson.verify.exit, 1, '(b) [M3] publish.json verify.exit is 1')
  assert.equal(publishJson.rollback.exit, 0, '(b) [M3] publish.json rollback.exit is 0')
  assert.equal(
    publishJson.rollback.cmd, 'bunx --cwd server wrangler rollback --yes',
    "(b) [M3] publish.json rollback.cmd is the plan's own rollback command"
  )

  const rollbackCalls = fs.readFileSync(path.join(home, 'rollback-calls'), 'utf8').split('\n').filter((l) => l !== '')
  assert.equal(
    rollbackCalls.length, 1,
    `(b) [M3] the rollback call log carries exactly one line — got ${JSON.stringify(rollbackCalls)}`
  )
}

{
  const runN = '603'
  const { res, home, evidenceDir } = await runCase(PUBLISH_RIG, runN, 'deploy-failed')
  assert.equal(
    res.code, 0,
    `(c) [M4] the deploy-failed publish case still exits 0 — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const status = JSON.parse(readEvidence(evidenceDir, runN, 'status.json'))
  assert.equal(
    status.phase, 'the pull request was merged; the deploy failed',
    '(c) [M4] status.json phase is exactly "the pull request was merged; the deploy failed"'
  )

  const eventsText = readEvidence(evidenceDir, runN, 'events.jsonl')
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  const nonLanding = rows.filter((r) => r.kind !== 'landing')
  assert.deepEqual(
    nonLanding.map((r) => r.kind),
    ['publish:pr', 'weave:push', 'merge', 'publish:deploy'],
    `(c) [M4] events.jsonl carries exactly one publish:deploy row and no verify/rollback rows — got ${JSON.stringify(nonLanding.map((r) => r.kind))}`
  )
  const deployRow = rows.find((r) => r.kind === 'publish:deploy')
  assert.equal(deployRow.exit, 1, '(c) [M4] the deploy row carries exit 1')
  assert.equal(deployRow.url, null, '(c) [M4] the deploy row carries url null')

  const publishJson = JSON.parse(readEvidence(evidenceDir, runN, 'publish.json'))
  assert.deepEqual(
    publishJson,
    {
      url: null,
      published: false,
      deploy: { cmd: 'bun run --cwd server deploy', exit: 1, ms: publishJson.deploy.ms },
      verify: null,
      rollback: null
    },
    `(c) [M4] publish.json is exactly url null, verify null, rollback null — got ${JSON.stringify(publishJson)}`
  )

  assert.ok(!fs.existsSync(path.join(home, 'rollback-calls')), '(c) [M4] no rollback call log exists')
  assert.ok(!fs.existsSync(path.join(home, 'publish-env-verify.txt')), '(c) [M4] the verify probe never ran')
}

{
  const runN = '604'
  const { res, evidenceDir } = await runCase(PLAIN_RIG, runN)
  assert.equal(
    res.code, 0,
    `(d) [M5] the no-Publish-line case exits 0 — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const eventsText = readEvidence(evidenceDir, runN, 'events.jsonl')
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  const publishRows = rows.filter((r) => r.kind.startsWith('publish:') && r.kind !== 'publish:pr')
  assert.equal(
    publishRows.length, 0,
    `(d) [M5] events.jsonl carries no publish:* row beyond publish:pr — got ${JSON.stringify(publishRows.map((r) => r.kind))}`
  )

  const runDirEntries = evidenceRunDirEntries(evidenceDir, runN)
  assert.ok(
    !runDirEntries.some((p) => p.endsWith('/publish.json')),
    `(d) [M5] no publish.json is committed to the evidence tree — got ${JSON.stringify(runDirEntries)}`
  )
}

{
  const runN = '605'
  const withShortBudget = (engineDir) => {
    const policyPath = path.join(engineDir, 'factory', 'policy.json')
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
    policy.publish.probe.timeout_seconds = 2
    fs.unlinkSync(policyPath)
    fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n')
    const publishPath = path.join(engineDir, 'factory', 'publish.mjs')
    const publishText = fs.readFileSync(publishPath, 'utf8')
    fs.unlinkSync(publishPath)
    fs.writeFileSync(publishPath, publishText)
  }
  const { res, home, evidenceDir } = await runCase(PUBLISH_RIG, runN, 'slow', withShortBudget)
  assert.equal(
    res.code, 0,
    `(e) [M1] the slow-deploy publish case still exits 0 — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const eventsText = readEvidence(evidenceDir, runN, 'events.jsonl')
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  const deployRows = rows.filter((r) => r.kind === 'publish:deploy')
  assert.equal(deployRows.length, 1, `(e) [M1] exactly one publish:deploy row — got ${deployRows.length}`)
  assert.equal(deployRows[0].exit, 124, `(e) [M1] the deploy row carries exit 124 — got ${JSON.stringify(deployRows[0])}`)
  assert.equal(deployRows[0].url, null, '(e) [M1] the deploy row carries url null')

  const status = JSON.parse(readEvidence(evidenceDir, runN, 'status.json'))
  assert.equal(
    status.phase, 'the pull request was merged; the deploy failed',
    '(e) [M1] status.json phase is exactly "the pull request was merged; the deploy failed"'
  )

  assert.ok(!rows.some((r) => r.kind === 'publish:verify'), '(e) [M1] no publish:verify row')
  assert.ok(!fs.existsSync(path.join(home, 'publish-env-verify.txt')), '(e) [M1] the verify probe never ran')
  console.log('ok (e) a deploy past its budget exits 124')
}

proxyServer.close()

console.log('ALL TESTS PASSED')
