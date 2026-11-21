import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { bootRig } from './_boot_helpers.mjs'

const {
  ENGINE_SHA, MERGE_SHA, EXPECTED_STATUS_KEYS, SLUG,
  git, writeStub, writeGitConfig, buildOrigin, seedPastRun, wireEvidence, refsOf, buildEngineDir, assignment,
  writeStubs, baseEnv, makeProxyServer, runBootAsync, runAsync
} = bootRig()

const atTag = (evidenceDir, runN, p) => git(evidenceDir, ['show', `${SLUG}/run-${runN}:runs/${SLUG}/${runN}/${p}`])
const engineArgv = (home) => fs.readFileSync(path.join(home, 'engine-argv'), 'utf8').split('\n').filter((l) => l !== '')

const proxyServer = await makeProxyServer()
const PROXY_URL = `http://127.0.0.1:${proxyServer.address().port}`

{
  const runN = '501'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-a-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'api_key' })

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA })
  }

  const res = await runBootAsync({ bin, home, env })

  assert.notEqual(
    res.code, 0,
    `(a) the boot exits non-zero on an api_key answer — got 0, stdout: ${res.stdout}, stderr: ${res.stderr}`
  )

  const status = JSON.parse(atTag(evidenceDir, runN, 'status.json'))
  assert.equal(status.state, 'failed', '(a) status.json records state "failed"')
  assert.ok(
    typeof status.error === 'string' && status.error.includes('api_key'),
    `(a) status.json's error names api_key — got ${JSON.stringify(status.error)}`
  )
}

{
  const runN = '521'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-a2-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth', claudeVersion: '2.1.258' })

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA })
  }

  const res = await runBootAsync({ bin, home, env })

  assert.notEqual(res.code, 0, `(a2) the boot exits non-zero on claude 2.1.258 — got 0, stdout: ${res.stdout}`)
  const status = JSON.parse(atTag(evidenceDir, runN, 'status.json'))
  assert.equal(status.state, 'failed', '(a2) status.json records state "failed"')
  assert.equal(
    status.error, 'claude 2.1.258 is below the floor 2.1.287',
    `(a2) status.json's error names the release and the floor — got ${JSON.stringify(status.error)}`
  )
}

for (const [runN, version, error] of [
  ['522', null, 'claude unknown is below the floor 2.1.287'],
  ['523', 'v2.1.300', 'claude v2.1.300 is below the floor 2.1.287']
]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-a3-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth', claudeVersion: version ?? undefined })
  if (version === null) writeStub(bin, 'claude', '#!/bin/sh\necho "claude: not found" >&2\nexit 127\n')

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA })
  }

  const res = await runBootAsync({ bin, home, env })

  assert.equal(res.code, 1, `(a3) the boot exits 1 on claude ${version} — got ${res.code}, stdout: ${res.stdout}`)
  const status = JSON.parse(atTag(evidenceDir, runN, 'status.json'))
  assert.equal(status.state, 'failed', `(a3) status.json records state "failed" on claude ${version}`)
  assert.equal(status.error, error, `(a3) status.json's error — got ${JSON.stringify(status.error)}`)
}

{
  const runN = '524'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-a4-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth', claudeVersion: '2.1.300' })
  writeStub(bin, 'timeout', '#!/bin/sh\ncase " $* " in *" exeuntu update "*) exit 124 ;; esac\nshift\nexec "$@"\n')

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA }),
    MERGE_SHA
  }

  const res = await runBootAsync({ bin, home, env })

  const bootLog = fs.readFileSync(path.join(home, 'fleet-boot.log'), 'utf8')
  assert.equal(res.code, 0, `(a4) the boot exits 0 after a timed-out update — got ${res.code}, log tail: ${bootLog.slice(-2000)}`)
  assert.ok(bootLog.includes('claude: the update failed; checking the installed release'), `(a4) fleet-boot.log says the update failed — got:\n${bootLog}`)
  assert.ok(bootLog.split('\n').some((l) => l.endsWith(' claude: 2.1.300')), `(a4) fleet-boot.log names the installed release — got:\n${bootLog}`)
  const status = JSON.parse(atTag(evidenceDir, runN, 'status.json'))
  assert.equal(status.state, 'done', `(a4) the run proceeds to done — got ${JSON.stringify(status.state)} (${JSON.stringify(status.error)})`)
}

{
  const runN = '502'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-b-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)
  fs.writeFileSync(path.join(home, 'fleet-setup.log'), 'setup: the sim\'s one setup line\n')

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth' })

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA }),
    MERGE_SHA
  }

  const res = await runBootAsync({ bin, home, env })

  assert.equal(
    res.code, 0,
    `(b) [M1] the clean run exits 0 — got ${res.code}, stdout: ${res.stdout}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const bootLog = fs.readFileSync(path.join(home, 'fleet-boot.log'), 'utf8')
  const aliveLines = bootLog.split('\n').filter((l) => l.endsWith(' preflight: alive'))
  assert.equal(
    aliveLines.length, 1,
    `(b) [M1] fleet-boot.log carries exactly one line ending ' preflight: alive' — got ${aliveLines.length} of them in:\n${bootLog}`
  )

  const landedSha = fs.readFileSync(path.join(home, 'landed-sha'), 'utf8').trim()

  const status = JSON.parse(atTag(evidenceDir, runN, 'status.json'))
  assert.deepEqual(
    Object.keys(status), EXPECTED_STATUS_KEYS,
    `(b) [M1] status.json carries exactly the thirteen named keys, in order — got ${JSON.stringify(Object.keys(status))}`
  )
  assert.equal(status.state, 'done', '(b) [M1] status.json state is "done"')
  assert.equal(status.phase, 'the pull request was merged', '(b) [M1] status.json phase is "the pull request was merged"')
  assert.equal(status.pr, 'https://github.com/o/r/pull/7', '(b) [M1] status.json pr is the opened PR\'s URL')
  assert.equal(status.prAuthor, 'fleet-bot', '(b) [M1] status.json prAuthor is the PR\'s author login')
  assert.equal(status.merged, MERGE_SHA, '(b) [M1] status.json merged is the merge sha the stub reported')
  assert.deepEqual(
    status.tasks,
    { 1: { state: 'folded', park: null } },
    `(b) [M1] status.json tasks is exactly the one folded task — got ${JSON.stringify(status.tasks)}`
  )

  const eventsText = atTag(evidenceDir, runN, 'events.jsonl')
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  for (const [i, row] of rows.entries()) {
    assert.ok(
      typeof row.ts === 'string' && row.ts.length > 0,
      `(b) [M1] events.jsonl row ${i} (kind=${row.kind}) carries a non-empty string ts — got ${JSON.stringify(row.ts)}`
    )
  }

  const nonLanding = rows.filter((r) => r.kind !== 'landing')
  assert.deepEqual(
    nonLanding.map((r) => r.kind),
    ['publish:pr', 'weave:push', 'merge'],
    `(b) [M1] events.jsonl's non-landing kinds are exactly publish:pr, weave:push, merge in order, and no board row — got ${JSON.stringify(nonLanding.map((r) => r.kind))}`
  )
  const [pubRow, weaveRow, mergeRow] = nonLanding
  assert.equal(weaveRow.when, 'pr', '(b) [M1] the weave:push row is the push made once the pull request is open')
  assert.equal(pubRow.url, 'https://github.com/o/r/pull/7', '(b) [M1] the publish:pr row names the PR url')
  assert.equal(pubRow.number, 7, '(b) [M1] the publish:pr row names the PR number')
  assert.equal(mergeRow.code, 200, '(b) [M1] the merge row records code 200')

  const prPost = fs.readFileSync(path.join(home, 'pr-post.json'), 'utf8')
  const evidenceLine = `**Evidence:** https://github.com/ops/evidence/tree/o-r/run-${runN}/runs/o-r/${runN}`
  const expectedBody = 'One widget, one size. It exists so the boot has a plan to carry. It benefits the record.\n\n' +
    `${evidenceLine}\n\n` +
    'Closes #1222'
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(home, 'pr-post.json'), 'utf8')).body.split('\n').filter((l) => l.startsWith('**Evidence:**')),
    [evidenceLine],
    '(b) [M3] the PR body carries exactly the one evidence line, byte-exact'
  )
  const expectedPrPost = JSON.stringify({
    title: `fleet run-${runN}: A widget that answers its size`,
    head: `ultra/integration-run-${runN}`,
    base: 'main',
    body: expectedBody,
    draft: false
  })
  assert.equal(
    prPost, expectedPrPost,
    `(b) [M1] the PR POST payload is byte-equal to the exam's own rendering — got ${prPost}`
  )

  const evidenceRefs = refsOf(evidenceDir)
  assert.ok(`refs/tags/o-r/run-${runN}` in evidenceRefs, '(b) [M1] the evidence repository holds the o-r/run-<N> tag')
  assert.ok(!(`refs/heads/live/o-r/run-${runN}` in evidenceRefs), '(b) [M1] refs/heads/live/o-r/run-<N> is gone')
  const heads = refsOf(originDir)
  assert.deepEqual(
    Object.keys(heads).sort(),
    ['refs/heads/main', `refs/heads/ultra/integration-run-${runN}`],
    `(b) [M1] the target's refs are exactly main and the integration branch — got ${JSON.stringify(Object.keys(heads))}`
  )

  const argv = engineArgv(home)
  assert.ok(argv.includes('--plan'), `(b) [M4] the systemd-run stub recorded the engine's argv — got ${JSON.stringify(argv)}`)
  assert.ok(!argv.includes('--past-dir'), `(b) [M4] with no earlier tag the engine gets no --past-dir — got ${JSON.stringify(argv)}`)
  const unitEnv = fs.readFileSync(path.join(home, 'engine-env'), 'utf8').split('\n').filter((l) => l !== '')
  assert.ok(unitEnv.includes('DISABLE_AUTOUPDATER=1'), `(b) the engine unit's env carries DISABLE_AUTOUPDATER=1 — got ${JSON.stringify(unitEnv)}`)
  assert.equal(fs.readFileSync(path.join(home, 'timeout-argv'), 'utf8'), '120\nsudo\n-n\nexeuntu\nupdate\nclaude\n')

  const integrationTree = git(originDir, ['ls-tree', '-r', '--name-only', `ultra/integration-run-${runN}`])
    .split('\n').filter(Boolean)
  assert.ok(
    integrationTree.includes('widget.mjs'),
    `(b) [M1] the integration tree carries the landed widget.mjs — got ${JSON.stringify(integrationTree)}`
  )
  assert.ok(
    integrationTree.includes('tests/test_widget.mjs'),
    `(b) [M1] the integration tree carries tests/test_widget.mjs — nothing strips it from the pull request anymore — got ${JSON.stringify(integrationTree)}`
  )

  const evidenceTree = git(evidenceDir, ['ls-tree', '-r', '--name-only', `o-r/run-${runN}`])
    .split('\n').filter(Boolean)
  assert.ok(
    !evidenceTree.some((p) => p.includes('exams/')),
    `(b) the evidence tree carries no exams/ path — got ${JSON.stringify(evidenceTree)}`
  )
  const runDirEntries = evidenceTree.filter((p) => p.startsWith(`runs/o-r/${runN}/`))
  assert.deepEqual(
    runDirEntries.slice().sort(),
    [
      `runs/o-r/${runN}/engine.log`,
      `runs/o-r/${runN}/events.jsonl`,
      `runs/o-r/${runN}/fleet-boot.log`,
      `runs/o-r/${runN}/fleet-setup.log`,
      `runs/o-r/${runN}/plan.json`,
      `runs/o-r/${runN}/plan.md`,
      `runs/o-r/${runN}/status.json`,
      `runs/o-r/${runN}/view.json`
    ],
    `(b) [M1] runs/o-r/${runN}/ carries exactly engine.log, events.jsonl, fleet-boot.log, fleet-setup.log, plan.json, plan.md, status.json and view.json — got ${JSON.stringify(runDirEntries)}`
  )
  const view = JSON.parse(atTag(evidenceDir, runN, 'view.json'))
  assert.equal(view.view, 1, '(b) view.json view is 1')
  assert.equal(view.run, Number(runN),'(b) view.json run is the run\'s number')
  assert.equal(view.target, 'o/r', '(b) view.json target is o/r')
  assert.equal(view.state, status.state, '(b) view.json state is status.json\'s state')
  const firstAdd = (p) => git(evidenceDir, ['log', '--diff-filter=A', '--format=%H', `o-r/run-${runN}`, '--', `runs/o-r/${runN}/${p}`])
    .split('\n').filter(Boolean).pop()
  assert.equal(firstAdd('view.json'), firstAdd('status.json'), 'view.json is committed with the first status.json')

  const mergePut = fs.readFileSync(path.join(home, 'merge-put.json'), 'utf8')
  const integrationTip = heads[`refs/heads/ultra/integration-run-${runN}`]
  const expectedMergePut = JSON.stringify({
    merge_method: 'squash',
    commit_title: `fleet run-${runN}: A widget that answers its size (#7)`,
    sha: integrationTip
  })
  assert.equal(
    mergePut, expectedMergePut,
    `(b) [M5] the merge PUT payload is byte-equal to the exam's own rendering — got ${mergePut}`
  )

  const tagBefore = refsOf(evidenceDir)[`refs/tags/o-r/run-${runN}`]
  const died = await runBootAsync({ bin, home, env }, 'died', { SERVICE_RESULT: 'signal', EXIT_CODE: 'killed', EXIT_STATUS: 'KILL' })
  assert.equal(died.code, 0, `(b) boot.sh died exits 0 — got ${died.code}, stderr tail: ${(died.stderr || '').slice(-4000)}`)
  assert.equal(
    refsOf(evidenceDir)[`refs/tags/o-r/run-${runN}`], tagBefore,
    '(b) [M3] boot.sh died leaves the ended run\'s tag at the commit it named before'
  )
}

{
  const runN = '503'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-c-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth' })
  fs.writeFileSync(path.join(home, 'engine-exit'), '3')

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA })
  }

  const res = await runBootAsync({ bin, home, env })

  assert.equal(
    res.code, 3,
    `(c) the boot exits with the engine's own code 3 — got ${res.code}, stdout: ${res.stdout}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const evidenceRefs = refsOf(evidenceDir)
  assert.ok(`refs/tags/o-r/run-${runN}` in evidenceRefs, '(c) [M2] the failed run leaves the o-r/run-<N> tag')
  assert.ok(!(`refs/heads/live/o-r/run-${runN}` in evidenceRefs), '(c) [M2] refs/heads/live/o-r/run-<N> is gone')
  const status = JSON.parse(atTag(evidenceDir, runN, 'status.json'))
  assert.equal(status.state, 'failed', '(c) [M2] status.json at the tag records state "failed"')
  assert.equal(status.error, 'engine exit 3', '(c) status.json error is exactly "engine exit 3"')
  assert.deepEqual(Object.keys(refsOf(originDir)), ['refs/heads/main'], '(c) nothing is written to the target')
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-d-'))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const engineDir = buildEngineDir(home, ENGINE_SHA)

  const res = await runAsync([path.join(engineDir, 'factory', 'flock', 'engine.mjs')], { home })

  assert.equal(
    res.code, 2,
    `(d) [M2] node <engineDir>/factory/flock/engine.mjs with no arguments, through the rig's symlinked factory/, exits 2 — got ${res.code}, stdout: ${res.stdout}, stderr: ${res.stderr}`
  )
}

{
  const runN = '505'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-e-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth' })
  fs.writeFileSync(path.join(home, 'stale-heads'), '1')

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA }),
    MERGE_SHA
  }

  const res = await runBootAsync({ bin, home, env })

  assert.equal(
    res.code, 0,
    `(e) the stale-head run exits 0 — got ${res.code}, stdout: ${res.stdout}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const eventsText = atTag(evidenceDir, runN, 'events.jsonl')
  const rows = eventsText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  const mergeRows = rows.filter((r) => r.kind === 'merge')
  assert.equal(
    mergeRows.length, 1,
    `(e) [M1] events.jsonl holds exactly one merge row — the PUT waited for the pushed head — got ${JSON.stringify(mergeRows)}`
  )
  assert.equal(mergeRows[0].code, 200, '(e) [M1] the one merge row records code 200')
  assert.equal(
    mergeRows[0].message, 'Pull Request successfully merged',
    `(e) [M2] the merge row carries GitHub's reply message — got ${JSON.stringify(mergeRows[0].message)}`
  )
}

{
  const runN = '506'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-f-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, evidenceScratch, base, plan } = buildOrigin(root, runN)
  seedPastRun(evidenceDir, evidenceScratch, 9, { 'status.json': '{"run":"9","state":"done"}\n' })
  seedPastRun(evidenceDir, evidenceScratch, 77, {
    'status.json': '{"run":"77","state":"parked","tasks":{"1":{"state":"parked"}}}\n',
    'events.jsonl': '{"kind":"landing"}\n'
  })
  seedPastRun(evidenceDir, evidenceScratch, 900, { 'status.json': '{"run":"900","state":"done"}\n' })
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth' })

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA }),
    MERGE_SHA
  }
  const res = await runBootAsync({ bin, home, env })
  assert.equal(res.code, 0, `(f) the run with earlier tags exits 0 — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-4000)}`)

  const argv = engineArgv(home)
  const at = argv.indexOf('--past-dir')
  assert.ok(at >= 0 && at + 1 < argv.length, `(f) [M4] the engine is started with --past-dir — got ${JSON.stringify(argv)}`)
  const pastDir = argv[at + 1]
  assert.equal(path.basename(pastDir), '77', `(f) [M4] --past-dir's basename is the highest earlier run, 77 — got ${pastDir}`)
  assert.equal(
    fs.readFileSync(path.join(pastDir, 'status.json'), 'utf8'),
    atTag(evidenceDir, 77, 'status.json'),
    '(f) [M4] the past directory\'s status.json is byte-equal to runs/o-r/77/status.json at o-r/run-77'
  )
}

{
  const runN = '507'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-g-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir, { setting: false })
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth' })
  const targetBefore = refsOf(originDir)
  const evidenceBefore = refsOf(evidenceDir)

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA })
  }
  const res = await runBootAsync({ bin, home, env })
  assert.notEqual(res.code, 0, `(g) [M5] the boot exits non-zero with no fleet-evidence-repo — got 0, stderr: ${res.stderr}`)
  const bootLog = fs.readFileSync(path.join(home, 'fleet-boot.log'), 'utf8')
  assert.ok(
    bootLog.split('\n').some((l) => l.includes('fleet-evidence-repo')),
    `(g) [M5] a fleet-boot.log line names fleet-evidence-repo — got:\n${bootLog}`
  )
  assert.deepEqual(refsOf(originDir), targetBefore, '(g) [M5] the target\'s refs are unchanged')
  assert.deepEqual(refsOf(evidenceDir), evidenceBefore, '(g) the evidence repository\'s refs are unchanged')
}

{
  const runN = '508'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-h-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth' })
  fs.writeFileSync(path.join(home, 'engine-lands-nothing'), '')

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA })
  }
  const res = await runBootAsync({ bin, home, env })
  assert.equal(res.code, 0, `(h) the nothing-ahead run exits 0 — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-4000)}`)
  const status = JSON.parse(atTag(evidenceDir, runN, 'status.json'))
  assert.equal(status.state, 'done', `(h) status.json at the tag records state "done" — got ${JSON.stringify(status)}`)
  assert.equal(status.phase, 'nothing to build: every proof already passes at the base', `(h) the phase says why — got ${JSON.stringify(status.phase)}`)
  assert.equal(status.pr, null, '(h) no pull request is opened')
  assert.equal(status.merged, null, `(h) [#1522] no PR opened, so nothing merged — got ${JSON.stringify(status.merged)}`)
}

{
  const runN = '509'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-i-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth' })
  fs.writeFileSync(path.join(home, 'engine-hangs'), '')

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA })
  }
  const boot = runBootAsync({ bin, home, env })

  const liveStatus = () => {
    try {
      return JSON.parse(git(evidenceDir, ['show', `live/o-r/run-${runN}:runs/o-r/${runN}/status.json`])).state
    } catch { return null }
  }
  const deadline = Date.now() + 60000
  while (!(liveStatus() === 'running' && fs.existsSync(path.join(home, 'engine-argv')))) {
    if (Date.now() > deadline) { boot.kill(); await boot; assert.fail('(i) the boot never reached a running engine') }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  boot.kill()
  const killed = await boot
  assert.equal(killed.signal, 'SIGKILL', `(i) the boot was killed — got code ${killed.code}, signal ${killed.signal}`)

  const died = await runBootAsync({ bin, home, env }, 'died', { SERVICE_RESULT: 'signal', EXIT_CODE: 'killed', EXIT_STATUS: 'KILL' })
  assert.equal(died.code, 0, `(i) boot.sh died exits 0 — got ${died.code}, stderr tail: ${(died.stderr || '').slice(-4000)}`)

  assert.ok(`refs/tags/o-r/run-${runN}` in refsOf(evidenceDir), '(i) [M1] the killed run leaves the o-r/run-<N> tag')
  const status = JSON.parse(atTag(evidenceDir, runN, 'status.json'))
  assert.equal(status.state, 'failed', '(i) [M1] status.json at the tag records state "failed"')
  assert.ok(
    typeof status.error === 'string' && status.error.includes('unit signal'),
    `(i) [M1] status.json's error names how the unit ended — got ${JSON.stringify(status.error)}`
  )
  assert.ok(
    atTag(evidenceDir, runN, 'journal.txt').includes('stub journal line'),
    '(i) [M2] journal.txt at the tag carries the journal stub\'s line'
  )
}

{
  const runN = '510'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-j-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])

  const side = path.join(root, 'side')
  git(root, ['clone', originDir, side])
  git(side, ['checkout', 'main'])
  fs.writeFileSync(path.join(side, 'other.txt'), 'a commit that landed on main after the clone\n')
  git(side, ['add', 'other.txt'])
  git(side, ['-c', 'user.name=Side', '-c', 'user.email=side@example.com', 'commit', '-m', 'move main'])
  git(side, ['push', 'origin', 'main'])

  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth' })

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA }),
    MERGE_SHA
  }

  const res = await runBootAsync({ bin, home, env })

  assert.equal(
    res.code, 0,
    `(j) the moved-main run exits 0 — got ${res.code}, stdout: ${res.stdout}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )

  const rows = atTag(evidenceDir, runN, 'events.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const catchupAt = rows.findIndex((r) => r.kind === 'catchup' && r.ok === true)
  const mergeAt = rows.findIndex((r) => r.kind === 'merge' && r.code === 200)
  assert.ok(catchupAt >= 0, `(j) events.jsonl carries a catchup row with ok true — got kinds ${JSON.stringify(rows.map((r) => r.kind))}`)
  assert.ok(mergeAt >= 0, `(j) events.jsonl carries a merge row with code 200 — got ${JSON.stringify(rows.filter((r) => r.kind === 'merge'))}`)
  assert.ok(catchupAt < mergeAt, `(j) the catchup row comes before the merge row — got kinds ${JSON.stringify(rows.map((r) => r.kind))}`)

  assert.equal(JSON.parse(atTag(evidenceDir, runN, 'status.json')).state, 'done', '(j) status.json at the tag records state "done"')
  console.log('ok (j) the self-merge catches up to a moved main')
}

for (const [n, how] of [['511', 'created'], ['512', 'lost']]) {
  const runN = n
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-k-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  buildEngineDir(home, ENGINE_SHA)
  writeStubs(bin, { claudeAuth: 'oauth' })
  fs.writeFileSync(path.join(home, 'pr-no-answer'), how)

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA }),
    MERGE_SHA
  }
  const res = await runBootAsync({ bin, home, env })
  assert.equal(res.code, 0, `(k ${how}) the run exits 0 — got ${res.code}, stderr tail: ${(res.stderr || '').slice(-3000)}`)

  const bootLog = atTag(evidenceDir, runN, 'fleet-boot.log')
  assert.ok(bootLog.includes('POST /repos/o/r/pulls answered 000'), `(k ${how}) the boot log records the request that got no answer — got ${bootLog.slice(-1500)}`)
  const lookups = fs.readFileSync(path.join(home, 'pr-lookups'), 'utf8').trim().split('\n')
  assert.ok(lookups.every((u) => u.endsWith(`/pulls?head=o:ultra%2Fintegration-run-${runN}&state=open`)), `(k ${how}) the lookup names the run's branch — got ${JSON.stringify(lookups)}`)
  assert.equal(lookups.length, 1, `(k ${how}) one lookup — got ${JSON.stringify(lookups)}`)
  assert.equal(bootLog.includes('the pull request is open all the same: https://github.com/o/r/pull/7'), how === 'created', `(k ${how}) the boot log ${how === 'created' ? 'names' : 'does not name'} a pull request found open`)
  assert.ok(fs.existsSync(path.join(home, 'pr-post.json')), `(k ${how}) a pull request was opened`)

  const rows = atTag(evidenceDir, runN, 'events.jsonl').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  const prRows = rows.filter((r) => r.kind === 'publish:pr')
  assert.ok(prRows.length === 1 && prRows[0].number === 7 && prRows[0].url === 'https://github.com/o/r/pull/7', `(k ${how}) one publish:pr row for pull request 7 — got ${JSON.stringify(prRows)}`)
  assert.ok(rows.some((r) => r.kind === 'merge' && r.code === 200), `(k ${how}) the pull request was merged — got ${JSON.stringify(rows.filter((r) => r.kind === 'merge'))}`)
  assert.equal(JSON.parse(atTag(evidenceDir, runN, 'status.json')).state, 'done', `(k ${how}) status.json at the tag records state "done"`)
  console.log(`ok (k) no answer to the pull request, ${how}`)
}

{
  const runN = '513'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-l-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, base, plan } = buildOrigin(root, runN)
  wireEvidence(home, evidenceDir)
  git(root, ['clone', originDir, path.join(home, 'target')])
  const recordPath = path.join(buildEngineDir(home, ENGINE_SHA), 'factory', 'record.mjs')
  const realRecord = fs.realpathSync(recordPath)
  fs.unlinkSync(recordPath)
  fs.writeFileSync(recordPath, [
    "import { spawnSync } from 'node:child_process'",
    "if (process.argv[2] === 'view') { process.stdout.write('{\"view\":'); process.exit(1) }",
    `const r = spawnSync(process.execPath, [${JSON.stringify(realRecord)}, ...process.argv.slice(2)], { stdio: 'inherit' })`,
    'process.exit(r.status ?? 1)',
    ''
  ].join('\n'))
  writeStubs(bin, { claudeAuth: 'oauth' })

  const env = {
    ...baseEnv(PROXY_URL),
    FLEET_ASSIGNMENT: assignment({ runN, plan, target: 'o/r', base, engine: ENGINE_SHA }),
    MERGE_SHA
  }

  const res = await runBootAsync({ bin, home, env })

  assert.equal(
    res.code, 0,
    `(l) the run exits 0 without its view — got ${res.code}, stdout: ${res.stdout}, stderr tail: ${(res.stderr || '').slice(-4000)}`
  )
  assert.equal(JSON.parse(atTag(evidenceDir, runN, 'status.json')).state, 'done', '(l) status.json at the tag records state "done"')
  const runDirEntries = git(evidenceDir, ['ls-tree', '-r', '--name-only', `o-r/run-${runN}`])
    .split('\n').filter((p) => p.startsWith(`runs/o-r/${runN}/`)).sort()
  assert.deepEqual(
    runDirEntries,
    ['engine.log', 'events.jsonl', 'fleet-boot.log', 'plan.json', 'plan.md', 'status.json'].map((p) => `runs/o-r/${runN}/${p}`),
    `(l) the record carries its other files, no view.json and no half-written one — got ${JSON.stringify(runDirEntries)}`
  )
  const viewLines = atTag(evidenceDir, runN, 'fleet-boot.log').split('\n')
    .filter((l) => l.endsWith(' view: factory/record.mjs view failed — view.json not replaced'))
  assert.ok(viewLines.length >= 1, `(l) fleet-boot.log at the tag says the view was not rendered — got:\n${atTag(evidenceDir, runN, 'fleet-boot.log')}`)
  console.log('ok (l) a view that cannot be rendered')
}

proxyServer.close()

console.log('ALL TESTS PASSED')
