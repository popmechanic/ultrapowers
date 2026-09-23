/**
 * fleet/tests/test_factory_publish.mjs — the exam for "the boot deploys after
 * its merge, checks the live URL, rolls back on red, and records it" (#835).
 *
 * The rig is `bootRig({ plan, stubs })` from `./_boot_helpers.mjs` (moved
 * there this task, since `test_sims_are_hermetic.mjs` forbids one sim naming
 * another and this file needs the same boot rig `test_factory_boot.mjs`
 * uses). The fixture plan is `FIXTURE_PLAN` plus three header lines right
 * after `**Closes:** #1222`:
 *
 *   **Publish:** bun run --cwd server deploy
 *   **Verify:** bun server/probe/converge-live.ts $ULTRA_PUBLISH_URL
 *   **Rollback:** bunx --cwd server wrangler rollback --yes
 *
 * Two new stubs, `bun` and `bunx`, ride alongside the base stub set: they
 * read a `$HOME/publish-case` marker (`green`/`red`/`deploy-failed`, written
 * by this exam before the boot ever starts) to decide what the deploy and
 * verify commands answer, dump their own environment to
 * `$HOME/publish-env-<verb>.txt` (deploy/verify/rollback), and append one
 * line to `$HOME/rollback-calls` each time `wrangler rollback` runs.
 *
 * Legs, each naming the Machine clause it measures:
 *
 *   (a) [M2, M6] the green case: deploy prints a workers.dev url and exits 0,
 *       verify exits 0 — events.jsonl carries publish:deploy then
 *       publish:verify (both exit 0) and no rollback row; publish.json is
 *       exactly the green shape; no row's own JSON ever carries the stubs'
 *       stdout text; the deploy and verify commands both saw the Cloudflare
 *       env vars, and only the verify probe saw `ULTRA_PUBLISH_URL`;
 *       status.json's phase is the exact "...and the app is published" text.
 *
 *   (b) [M3] the red case: deploy is green, verify exits 1 — events.jsonl
 *       carries deploy, verify{exit:1}, exactly one rollback{exit:0} row;
 *       publish.json published is false with verify.exit 1 and
 *       rollback.exit 0; the rollback call log carries exactly one line;
 *       status.json state is "done" and phase names the rollback.
 *
 *   (c) [M4] the deploy-failed case: deploy exits 1 and prints no url — only
 *       one publish:deploy{exit:1,url:null} row, no verify/rollback rows;
 *       publish.json is url null, verify null, rollback null; phase names
 *       the deploy failure; no rollback call log and no verify env dump ever
 *       appear (the verify probe never ran).
 *
 *   (d) [M5] a plan with no `**Publish:**` line at all (plain `FIXTURE_PLAN`):
 *       no `publish:*` row beyond `publish:pr`; no `publish.json` committed
 *       to the evidence tree.
 *
 * Every boot is `spawn`ed and awaited (`runBootAsync`), the same asynchronous
 * shape `test_factory_boot.mjs` and `test_factory_preflight.mjs` use, so the
 * in-process proxy stub server's own event loop is never blocked by a
 * synchronous child. Every spawned process gets `env: simEnv({ bin, home,
 * env })`; nothing is ever passed `process.env` directly.
 */

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

/** One full `bash factory/boot.sh boot` run of `rig`'s bound fixture plan,
 *  marking `markCase` in `$HOME/publish-case` (when given) before the boot
 *  ever starts. Returns the handles a case's own assertions need. */
async function runCase (rig, runN, markCase) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `fleet-publish-${runN}-`))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  rig.writeGitConfig(home)
  if (markCase) fs.writeFileSync(path.join(home, 'publish-case'), markCase)

  const { originDir, base, plan } = rig.buildOrigin(root, runN)
  rig.git(root, ['clone', originDir, path.join(home, 'target')])
  rig.buildEngineDir(home, ENGINE_SHA)
  rig.writeStubs(bin, { claudeAuth: 'oauth' })

  const env = {
    ...rig.baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: rig.assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA }),
    MERGE_SHA
  }

  const res = await rig.runBootAsync({ bin, home, env })
  return { res, root, home, bin, originDir, base, plan }
}

function readEvidence (originDir, runN, p) {
  return git(originDir, ['show', `ultra/evidence/run-${runN}:.ultrapowers/runs/${runN}/${p}`])
}

function evidenceRunDirEntries (originDir, runN) {
  return git(originDir, ['ls-tree', '-r', '--name-only', `ultra/evidence/run-${runN}`])
    .split('\n').filter((p) => p.startsWith(`.ultrapowers/runs/${runN}/`))
}

// ── (a) [M2, M6] the green case ───────────────────────────────────────────

{
  const runN = '601'
  const { res, home, originDir } = await runCase(PUBLISH_RIG, runN, 'green')
  assert.equal(
    res.code, 0,
    `(a) [M2] the green publish case exits 0 — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const status = JSON.parse(readEvidence(originDir, runN, 'status.json'))
  assert.equal(status.state, 'done', '(a) [M2] status.json state is "done"')
  assert.equal(
    status.phase, 'the pull request was merged and the app is published',
    '(a) [M2] status.json phase is exactly "the pull request was merged and the app is published"'
  )

  const eventsText = readEvidence(originDir, runN, 'events.jsonl')
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  const nonLanding = rows.filter((r) => r.kind !== 'landing')
  assert.deepEqual(
    nonLanding.map((r) => r.kind),
    ['publish:pr', 'merge', 'publish:deploy', 'publish:verify', 'board:close', 'run:audit'],
    `(a) [M2] events.jsonl's non-landing kinds are exactly publish:pr, merge, publish:deploy, publish:verify, board:close, run:audit in order, no rollback row — got ${JSON.stringify(nonLanding.map((r) => r.kind))}`
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

  // [M6] no row's own JSON line ever carries the stubs' stdout text.
  assert.ok(!eventsText.includes('Deployed fixture-worker triggers'), "(a) [M6] events.jsonl never embeds the deploy stub's stdout")
  assert.ok(!eventsText.includes('fixture: verify ok'), "(a) [M6] events.jsonl never embeds the verify stub's stdout")

  const publishJson = JSON.parse(readEvidence(originDir, runN, 'publish.json'))
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

  const runDirEntries = evidenceRunDirEntries(originDir, runN).slice().sort()
  assert.deepEqual(
    runDirEntries,
    [
      `.ultrapowers/runs/${runN}/engine.log`,
      `.ultrapowers/runs/${runN}/events.jsonl`,
      `.ultrapowers/runs/${runN}/publish-deploy.log`,
      `.ultrapowers/runs/${runN}/publish-verify.log`,
      `.ultrapowers/runs/${runN}/publish.json`,
      `.ultrapowers/runs/${runN}/status.json`
    ],
    `(a) [M2] the evidence run directory carries the three publish files alongside the base three — got ${JSON.stringify(runDirEntries)}`
  )

  // [M6] both probe commands ran in the target checkout under the
  // Cloudflare env vars; only the verify probe also carries ULTRA_PUBLISH_URL.
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

// ── (b) [M3] the red case: verify red, one rollback ───────────────────────

{
  const runN = '602'
  const { res, home, originDir } = await runCase(PUBLISH_RIG, runN, 'red')
  assert.equal(
    res.code, 0,
    `(b) [M3] the red publish case still exits 0 (a live check going red never fails the boot) — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const status = JSON.parse(readEvidence(originDir, runN, 'status.json'))
  assert.equal(status.state, 'done', '(b) [M3] status.json state is "done"')
  assert.equal(
    status.phase, 'the pull request was merged; the live check was red and the deploy was rolled back',
    '(b) [M3] status.json phase is exactly the rolled-back text'
  )

  const eventsText = readEvidence(originDir, runN, 'events.jsonl')
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  const nonLanding = rows.filter((r) => r.kind !== 'landing')
  assert.deepEqual(
    nonLanding.map((r) => r.kind),
    ['publish:pr', 'merge', 'publish:deploy', 'publish:verify', 'publish:rollback', 'board:close', 'run:audit'],
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

  const publishJson = JSON.parse(readEvidence(originDir, runN, 'publish.json'))
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

// ── (c) [M4] the deploy-failed case ───────────────────────────────────────

{
  const runN = '603'
  const { res, home, originDir } = await runCase(PUBLISH_RIG, runN, 'deploy-failed')
  assert.equal(
    res.code, 0,
    `(c) [M4] the deploy-failed publish case still exits 0 — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const status = JSON.parse(readEvidence(originDir, runN, 'status.json'))
  assert.equal(
    status.phase, 'the pull request was merged; the deploy failed',
    '(c) [M4] status.json phase is exactly "the pull request was merged; the deploy failed"'
  )

  const eventsText = readEvidence(originDir, runN, 'events.jsonl')
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  const nonLanding = rows.filter((r) => r.kind !== 'landing')
  assert.deepEqual(
    nonLanding.map((r) => r.kind),
    ['publish:pr', 'merge', 'publish:deploy', 'board:close', 'run:audit'],
    `(c) [M4] events.jsonl carries exactly one publish:deploy row and no verify/rollback rows — got ${JSON.stringify(nonLanding.map((r) => r.kind))}`
  )
  const deployRow = rows.find((r) => r.kind === 'publish:deploy')
  assert.equal(deployRow.exit, 1, '(c) [M4] the deploy row carries exit 1')
  assert.equal(deployRow.url, null, '(c) [M4] the deploy row carries url null')

  const publishJson = JSON.parse(readEvidence(originDir, runN, 'publish.json'))
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

// ── (d) [M5] no **Publish:** line at all ──────────────────────────────────

{
  const runN = '604'
  const { res, originDir } = await runCase(PLAIN_RIG, runN)
  assert.equal(
    res.code, 0,
    `(d) [M5] the no-Publish-line case exits 0 — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const eventsText = readEvidence(originDir, runN, 'events.jsonl')
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  const publishRows = rows.filter((r) => r.kind.startsWith('publish:') && r.kind !== 'publish:pr')
  assert.equal(
    publishRows.length, 0,
    `(d) [M5] events.jsonl carries no publish:* row beyond publish:pr — got ${JSON.stringify(publishRows.map((r) => r.kind))}`
  )

  const runDirEntries = evidenceRunDirEntries(originDir, runN)
  assert.ok(
    !runDirEntries.some((p) => p.endsWith('/publish.json')),
    `(d) [M5] no publish.json is committed to the evidence tree — got ${JSON.stringify(runDirEntries)}`
  )
}

proxyServer.close()

console.log('ALL TESTS PASSED')
