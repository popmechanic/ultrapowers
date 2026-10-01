/**
 * fleet/tests/test_factory_boot.mjs — the exam for "The boot's exam drives the
 * probe to `alive`, and the boot hands its dead and misplaced pieces to their
 * modules" (the boot half).
 *
 * At BASE this file drove three `bash factory/boot.sh boot` runs with
 * `spawnSync` while its proxy stub was an in-process `http.createServer`; a
 * synchronous child blocks the event loop the stub server runs on, so every
 * boot's `preflight.mjs` fetch of `/api/oauth/usage` hung to the probe's
 * abort and classified `inconclusive` — `alive` was never exercised. This
 * file is rewritten whole on the asynchronous rig `test_factory_preflight.mjs`
 * uses: every boot is `spawn`ed and awaited (`runBootAsync`), never
 * `spawnSync`'d; the rig's own fixture `git` calls stay `spawnSync`, since
 * nothing they do waits on the stub server.
 *
 * Legs, each naming the Machine clause(s) it measures:
 *
 *   (a) `claude auth status` answers `api_key` — the boot fails before the
 *       engine ever runs, and `status.json` at the run's tag records
 *       `state: "failed"` with an `error` naming `api_key`.
 *
 *   (b) [M1, M3, M4] the clean run: the engine stub lands one task, the PR is
 *       opened and merged, the run closes — plus the one line ending
 *       ` preflight: alive` in `<home>/fleet-boot.log`; the evidence
 *       repository holding the tag `o-r/run-<N>` whose `runs/o-r/<N>/` is
 *       exactly `engine.log`, `events.jsonl`, `plan.json`, `plan.md` and `status.json`
 *       (`state` `done`), `live/o-r/run-<N>` gone and the target holding
 *       exactly `main` and the integration branch (M1); the PR body's
 *       evidence line byte-exact (M3); no `--past-dir` in the engine's argv,
 *       there being no earlier tag (M4); and `<home>/merge-put.json`
 *       byte-equal to the exam's own rendering of the merge payload; and
 *       `<home>/reap-post.json` parsing to `{ run: 502, target: 'o/r' }`
 *       with exactly one `reap: asked the hub` line in the boot log (#1470).
 *
 *   (c) [M2] the engine stub exits 3 — the boot fails with exactly `"engine
 *       exit 3"`, and the run is tagged all the same: `status.json` at
 *       `o-r/run-<N>` says `failed` and the live branch is gone; no
 *       `<home>/reap-post.json` is written (#1470).
 *
 *   (d) `node <engineDir>/factory/flock/engine.mjs` with no arguments,
 *       through the rig's own `buildEngineDir` symlink, exits 2
 *       (`engine: --plan is required`).
 *
 *   (e) the stale head: the merge PUT waits for the pushed head.
 *
 *   (f) [M4] with tags `o-r/run-9`, `-77` and `-900` in the evidence
 *       repository, run 506's engine gets `--past-dir` whose basename is `77`
 *       and whose `status.json` is byte-equal to the tag's.
 *
 *   (g) [M5] with no `<home>/fleet-evidence-repo` the boot exits non-zero,
 *       a `fleet-boot.log` line names `fleet-evidence-repo`, and neither
 *       repository's refs move.
 *
 *   (h) nothing ahead of base: parked, the hub's mark in the tagged record.
 *
 *   (i) [#1445 M1, M2] run 509's boot is SIGKILLed (its whole process group)
 *       once the live branch says `running` and the engine stub hangs;
 *       `boot.sh died` with `SERVICE_RESULT=signal EXIT_CODE=killed
 *       EXIT_STATUS=KILL` then leaves the tag `o-r/run-509` whose
 *       `status.json` says `failed` with an `error` naming `unit signal`, and
 *       whose `journal.txt` carries the `journalctl` stub's line. Leg (b) ends
 *       by running `died` on its finished run and finding its tag where it
 *       was (#1445 M3).
 *
 * The rig, once per case: a bare `origin.git` (the target) holding only a
 * `README` commit (`base`) on `main`, and a bare `evidence.git` (the
 * operator's `ops/evidence`, `main` seeded with a hand archive) taking the
 * launcher's parentless plan commit (`plan`, `runs/o-r/<N>/plan.md`) on
 * `refs/heads/live/o-r/run-<N>`. `wireEvidence` writes
 * `<home>/fleet-evidence-repo` as the first-boot setup script would and maps
 * `https://stub.invalid/ops/evidence.git` to that bare in the case HOME's
 * `.gitconfig`; the `systemd-run` stub records the engine's argv to
 * `<home>/engine-argv`. `<FLEET_HOME>/target` is a plain clone of the origin. `<FLEET_HOME>/engines/<sha>/
 * factory` and `.../skills` are symlinks to this checkout's own `factory/`
 * and `skills/`, so the boot's real `factory/audit.mjs` (and, in leg (d),
 * `factory/flock/engine.mjs`) genuinely runs through a symlinked directory. A `bin`
 * directory stubs `claude` (one `authMethod:` line), `curl` (a small
 * argument-sniffing router answering the GitHub-shaped endpoints `boot.sh`
 * hits, and — new in this task — saving a `PUT …/pulls/7/merge` body to
 * `$FLEET_HOME/merge-put.json` the way it already saves the `POST …/pulls`
 * body to `pr-post.json`), `systemd-run` (stands in for the whole systemd
 * invocation: for the engine unit, either lands one task — writing
 * `widget.mjs` and `tests/test_widget.mjs`, committing them into `$target`
 * and appending one `landing` row — or exits the code recorded in
 * `$FLEET_HOME/engine-exit`) and `systemctl` (a no-op). `node`, `python3`,
 * `git` and `bash` are real. Every spawned process — the fixture's own git
 * calls and the boot itself — gets `env: simEnv({ bin, home, env })` from
 * `./_helpers.mjs`; nothing is ever passed `process.env` directly.
 *
 * What this exam assumes about `factory/boot.sh`, since it is the one piece
 * of context a later reader lacks: that credential-probe failure and engine
 * failure both still route through `fail()` writing `status.json` onto the
 * live branch and cutting the run's tag before exiting non-zero (so (a) and
 * (c) can read it back at the tag); that a plan commit with no `kata.json`
 * blob leaves the board unbound, so `close_run()` takes its early-return
 * path and appends exactly one `board:close` row; that `factory/policy.json`'s
 * `publish.self_merge.enabled: true` (already in this repo) is what makes
 * (b)'s merge actually happen; and that the `publish:pr` event row's own
 * `ts` field is out of this task's own diff — this exam still asserts M1's
 * "every row carries a non-empty string `ts`" exactly as written, since a
 * clause is asserted as it reads, not as it is comfortable to satisfy today.
 * It also assumes that `factory/flock/engine.mjs` reads `process.argv`
 * itself (so leg (d)'s bare module path is the same call `boot.sh` makes)
 * and, with no `--plan` given, exits 2 before
 * touching anything that would need a fuller rig — the same shape the
 * sibling exam `test_factory_preflight.mjs` already assumes of
 * `audit.mjs`/`preflight.mjs`.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { bootRig } from './_boot_helpers.mjs'

const {
  ENGINE_SHA, MERGE_SHA, EXPECTED_STATUS_KEYS, SLUG,
  git, writeGitConfig, buildOrigin, seedPastRun, wireEvidence, refsOf, buildEngineDir, assignment,
  writeStubs, baseEnv, makeProxyServer, runBootAsync, runAsync
} = bootRig()

/** A file of run `runN`'s folder at its tag `o-r/run-<runN>` in the evidence bare. */
const atTag = (evidenceDir, runN, p) => git(evidenceDir, ['show', `${SLUG}/run-${runN}:runs/${SLUG}/${runN}/${p}`])
const engineArgv = (home) => fs.readFileSync(path.join(home, 'engine-argv'), 'utf8').split('\n').filter((l) => l !== '')

const proxyServer = await makeProxyServer()
const PROXY_URL = `http://127.0.0.1:${proxyServer.address().port}`

// ── (a) `claude auth status` answers api_key -> the boot fails before the
//    engine ever runs ───────────────────────────────────────────────────

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

// ── (a2) a Claude Code release below the floor refuses the run ───────────

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

// ── (b) [M1, M5] a clean run: land, open, merge, close, probe alive ──────

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

  // [M1] the boot log carries exactly one line ending ' preflight: alive'
  // (at BASE, a synchronous boot blocks the in-process proxy stub and every
  // run classifies 'inconclusive' instead).
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
    ['publish:pr', 'merge', 'board:close', 'run:audit'],
    `(b) [M1] events.jsonl's non-landing kinds are exactly publish:pr, merge, board:close, run:audit in order — got ${JSON.stringify(nonLanding.map((r) => r.kind))}`
  )
  const [pubRow, mergeRow, closeRow] = nonLanding
  assert.equal(pubRow.url, 'https://github.com/o/r/pull/7', '(b) [M1] the publish:pr row names the PR url')
  assert.equal(pubRow.number, 7, '(b) [M1] the publish:pr row names the PR number')
  assert.equal(mergeRow.code, 200, '(b) [M1] the merge row records code 200')
  assert.equal(closeRow.what, 'run', '(b) [M1] the sole board:close row is "what":"run" (close_run\'s no-kata early return)')
  assert.equal(closeRow.code, null, '(b) [M1] the sole board:close row carries code null')

  const prPost = fs.readFileSync(path.join(home, 'pr-post.json'), 'utf8')
  // `factory/record.mjs` renders the receipt from `edge` rows (this stub engine writes none, so the
  // body carries only the evidence line) and the run folder at its tag in the evidence repository.
  const evidenceLine = `**Evidence:** https://github.com/ops/evidence/tree/o-r/run-${runN}/runs/o-r/${runN}`
  const expectedBody = 'One widget, one size. It exists so the boot has a plan to carry. It benefits the record.\n\n' +
    `${evidenceLine}\n\n` +
    'Closes #1222'
  // [M3] the body carries exactly that line.
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

  // [M1] the evidence repository holds the run's one tag and no live branch; the
  // target holds exactly `main` and the integration branch.
  const evidenceRefs = refsOf(evidenceDir)
  assert.ok(`refs/tags/o-r/run-${runN}` in evidenceRefs, '(b) [M1] the evidence repository holds the o-r/run-<N> tag')
  assert.ok(!(`refs/heads/live/o-r/run-${runN}` in evidenceRefs), '(b) [M1] refs/heads/live/o-r/run-<N> is gone')
  const heads = refsOf(originDir)
  assert.deepEqual(
    Object.keys(heads).sort(),
    ['refs/heads/main', `refs/heads/ultra/integration-run-${runN}`],
    `(b) [M1] the target's refs are exactly main and the integration branch — got ${JSON.stringify(Object.keys(heads))}`
  )

  // [M4] no earlier o-r/run-<M> tag, so the engine is started with no --past-dir.
  const argv = engineArgv(home)
  assert.ok(argv.includes('--plan'), `(b) [M4] the systemd-run stub recorded the engine's argv — got ${JSON.stringify(argv)}`)
  assert.ok(!argv.includes('--past-dir'), `(b) [M4] with no earlier tag the engine gets no --past-dir — got ${JSON.stringify(argv)}`)

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

  // [M1] the tag's tree under `runs/o-r/<N>/` is exactly the plan and the
  // three record files, and no committed path contains exams/.
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
      `runs/o-r/${runN}/status.json`
    ],
    `(b) [M1] runs/o-r/${runN}/ carries exactly engine.log, events.jsonl, fleet-boot.log, fleet-setup.log, plan.json, plan.md and status.json — got ${JSON.stringify(runDirEntries)}`
  )

  // [M5] the merge PUT body the boot sent is byte-equal to the exam's own
  // rendering of the merge payload's fields — title off the plan's first
  // heading and the number the stub PR answered, sha the integration
  // branch's HEAD (the tip git ls-remote --heads lists for it above, which
  // with no strip step anymore is exactly the engine's own landing commit,
  // the same sha as `landedSha`).
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

  // #1470: the merged run whose tag verified asks the hub, once, to remove its VM.
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(home, 'reap-post.json'), 'utf8')), { run: 502, target: 'o/r' },
    '(b) the reap request carries the run and its target'
  )
  const reapLines = bootLog.split('\n').filter((l) => l.includes('reap: asked the hub'))
  assert.equal(reapLines.length, 1, `(b) the boot log has exactly one reap line — got ${JSON.stringify(reapLines)}`)

  // [M3 of #1445] `boot.sh died` after a run that already ended leaves its tag where it was.
  const tagBefore = refsOf(evidenceDir)[`refs/tags/o-r/run-${runN}`]
  const died = await runBootAsync({ bin, home, env }, 'died', { SERVICE_RESULT: 'signal', EXIT_CODE: 'killed', EXIT_STATUS: 'KILL' })
  assert.equal(died.code, 0, `(b) boot.sh died exits 0 — got ${died.code}, stderr tail: ${(died.stderr || '').slice(-4000)}`)
  assert.equal(
    refsOf(evidenceDir)[`refs/tags/o-r/run-${runN}`], tagBefore,
    '(b) [M3] boot.sh died leaves the ended run\'s tag at the commit it named before'
  )
}

// ── (c) engine exit 3 -> the boot fails, no tag is ever cut ──────────────

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

  // [M2] a failed run is tagged too: its status at the tag says failed, and its live branch is gone.
  const evidenceRefs = refsOf(evidenceDir)
  assert.ok(`refs/tags/o-r/run-${runN}` in evidenceRefs, '(c) [M2] the failed run leaves the o-r/run-<N> tag')
  assert.ok(!(`refs/heads/live/o-r/run-${runN}` in evidenceRefs), '(c) [M2] refs/heads/live/o-r/run-<N> is gone')
  const status = JSON.parse(atTag(evidenceDir, runN, 'status.json'))
  assert.equal(status.state, 'failed', '(c) [M2] status.json at the tag records state "failed"')
  assert.equal(status.error, 'engine exit 3', '(c) status.json error is exactly "engine exit 3"')
  // #1392: the hub's mark is in the committed record, not appended after the last commit
  const marks = atTag(evidenceDir, runN, 'events.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === 'board:mark')
  assert.deepEqual(marks.map((r) => r.state), ['failed'], `(c) events.jsonl at the tag holds one board:mark row, state failed — got ${JSON.stringify(marks)}`)
  assert.deepEqual(Object.keys(refsOf(originDir)), ['refs/heads/main'], '(c) nothing is written to the target')
  // #1470: a failed run never asks the hub to remove its VM.
  assert.ok(!fs.existsSync(path.join(home, 'reap-post.json')), '(c) the failed run sends the reaper nothing')
}

// ── (d) [M2] flock/engine.mjs through a symlinked factory/ ───────────────

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

// ── (e) [M1, M2] the stale head: the first GET names an old head, the PUT
//    waits for the pushed one and is sent once ─────────────────────────────

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
  // One GET answers `{"mergeable":true,"head":{"sha":"<40 zeros>"}}`; the PUT
  // answers 405 `Pull Request is not mergeable` until a GET names the pushed tip.
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

// ── (f) [M4] the previous run: --past-dir at the highest earlier tag ────────

{
  const runN = '506'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-boot-f-'))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  writeGitConfig(home)

  const { originDir, evidenceDir, evidenceScratch, base, plan } = buildOrigin(root, runN)
  // Two earlier runs and one later: the engine gets the highest below N, 77.
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

// ── (g) [M5] no fleet-evidence-repo: the boot fails naming it, the target untouched ──

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

// ── (h) #1392 nothing ahead of base: parked, and the hub's mark is in the tagged record ──

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
  assert.equal(JSON.parse(atTag(evidenceDir, runN, 'status.json')).state, 'parked', '(h) status.json at the tag records state "parked"')
  const marks = atTag(evidenceDir, runN, 'events.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === 'board:mark')
  assert.deepEqual(marks.map((r) => r.state), ['parked'], `(h) events.jsonl at the tag holds one board:mark row, state parked — got ${JSON.stringify(marks)}`)
}

// ── (i) #1445 a boot killed while its engine runs: `boot.sh died` writes the failed record ──

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

  // Killed once the live branch's record says `running` and the engine stub has started.
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

  // [M1] the tag's status says failed and names how the unit ended.
  assert.ok(`refs/tags/o-r/run-${runN}` in refsOf(evidenceDir), '(i) [M1] the killed run leaves the o-r/run-<N> tag')
  const status = JSON.parse(atTag(evidenceDir, runN, 'status.json'))
  assert.equal(status.state, 'failed', '(i) [M1] status.json at the tag records state "failed"')
  assert.ok(
    typeof status.error === 'string' && status.error.includes('unit signal'),
    `(i) [M1] status.json's error names how the unit ended — got ${JSON.stringify(status.error)}`
  )
  // [M2] the tag carries the unit's journal.
  assert.ok(
    atTag(evidenceDir, runN, 'journal.txt').includes('stub journal line'),
    '(i) [M2] journal.txt at the tag carries the journal stub\'s line'
  )
}

// ── (j) #1441 main moved after the target clone: the self-merge catches up before its merge ──

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

  // Move the origin's main by one commit touching a file the plan never names.
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
  const refoldAt = rows.findIndex((r) => r.kind === 'refold' && r.ok === true)
  const mergeAt = rows.findIndex((r) => r.kind === 'merge' && r.code === 200)
  assert.ok(refoldAt >= 0, `(j) events.jsonl carries a refold row with ok true — got kinds ${JSON.stringify(rows.map((r) => r.kind))}`)
  assert.ok(mergeAt >= 0, `(j) events.jsonl carries a merge row with code 200 — got ${JSON.stringify(rows.filter((r) => r.kind === 'merge'))}`)
  assert.ok(refoldAt < mergeAt, `(j) the refold row comes before the merge row — got kinds ${JSON.stringify(rows.map((r) => r.kind))}`)

  assert.equal(JSON.parse(atTag(evidenceDir, runN, 'status.json')).state, 'done', '(j) status.json at the tag records state "done"')
  console.log('ok (j) the self-merge catches up to a moved main')
}

proxyServer.close()

console.log('ALL TESTS PASSED')
