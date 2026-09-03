// fleet/tests/test_drive_engine_untracked.mjs — task 2 / #579 item 2: a stray
// untracked file no longer refuses the drive.
//
// The #575 M3 refusal reads the engine checkout's cleanliness before any
// exe.dev command. It asked git about EVERY file, so a leftover
// `drive-run-*.out`, an editor swap file or a plan scp'd into
// `/home/exedev/repo` refused the drive — even though the engine push ships
// `engineSha` only, so an untracked file can never reach a sandbox.
// `--untracked-files=no` is the whole change: the throw, its message and its
// position in the sequence are unchanged.
//
// Legs (a)-(d) drive `driveOne` with a recording `exec` stub — no network, no
// exe.dev, no orchestrator; `provision` stops the drive where the preflight
// ends. Leg (e) reads the committed `fleet/RUNBOOK.md`. Every byte of state
// lives under one `fs.mkdtempSync`, removed on the way out.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { driveOne } from '../drive.mjs'

const ok = (line) => console.log(`ok - ${line}`)

// A plan the headless-fitness preflight passes (the shape the sibling drive
// tests use) — this exam is about the cleanliness command, not fitness.
const FIT_PLAN =
  '# P\n\n### Task 1: Code\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `fleet/x.mjs`\n- Test: `fleet/tests/test_x.mjs`\n\n- [ ] **Step 1: edit**\n'

const ENGINE_SHA = 'a'.repeat(40)
const BASE_SHA = 'b'.repeat(40)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-engine-untracked-'))

try {
  // A drive whose only interesting variable is what the cleanliness command
  // answers. `provision` records and stops; `destroy` is a no-op.
  const stubDrive = ({ label, cleanliness = { code: 0, stdout: '' } }) => {
    const root = path.join(tmp, label)
    const repoDir = path.join(root, 'repo')
    const targetsDir = path.join(root, 'targets')
    const planFile = path.join(root, 'plans', 'p.md')
    fs.mkdirSync(repoDir, { recursive: true })
    fs.mkdirSync(path.dirname(planFile), { recursive: true })
    fs.writeFileSync(planFile, FIT_PLAN)
    const cmds = []
    const provisionCalls = []
    const exec = async (cmd) => {
      cmds.push(cmd)
      // Whatever shape the cleanliness read takes, this stub answers it.
      if (/ status --porcelain/.test(cmd)) return { stderr: '', ...cleanliness }
      if (/ rev-parse HEAD$/.test(cmd)) return { code: 0, stdout: `${ENGINE_SHA}\n`, stderr: '' }
      if (/ show HEAD:\.claude-plugin\/plugin\.json$/.test(cmd)) return { code: 0, stdout: '{"version":"9.9.9"}', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
    const drive = () =>
      driveOne({
        planPath: planFile,
        golden: 'fleet-golden',
        port: 0,
        dbDir: path.join(root, 'db'),
        evidenceDir: path.join(root, 'ev'),
        target: 'o/r',
        baseSha: BASE_SHA,
        repoDir,
        targetsDir,
        exec,
        clock: () => 2_000_000,
        runId: `run-untracked-${label}`,
        ttlMs: 60_000,
        tickMs: 25,
        settleMs: 20,
        publishPollMs: 25,
        publishTimeoutMs: 500,
        parkedPublishWaitMs: 100,
        heartbeatTimeoutMs: 1_000,
        progressLog: () => {},
        githubTokenPath: path.join(root, 'no-such-token'),
        provision: async (options) => {
          provisionCalls.push(options)
          throw new Error('provision-stop')
        },
        destroy: async () => {},
      })
    return { drive, cmds, provisionCalls, repoDir }
  }

  // (a) [M1] the engine-cleanliness command `driveOne` issues is exactly
  //     `git -C <repoDir> status --porcelain --untracked-files=no` — the full
  //     command, `-C` and its directory included — and the bare
  //     `git -C <repoDir> status --porcelain` is issued nowhere.
  {
    const h = stubDrive({ label: 'a' })
    await h.drive()
    const EXPECTED = `git -C ${h.repoDir} status --porcelain --untracked-files=no`
    const BARE = `git -C ${h.repoDir} status --porcelain`
    assert.equal(
      h.cmds.filter((cmd) => cmd === EXPECTED).length,
      1,
      `expected exactly one \`${EXPECTED}\`, got: ${JSON.stringify(h.cmds)}`,
    )
    assert.equal(
      h.cmds.some((cmd) => cmd === BARE),
      false,
      `no command may be the bare \`${BARE}\`, got: ${JSON.stringify(h.cmds)}`,
    )
    ok('(a) [M1] the cleanliness command is `git -C <repoDir> status --porcelain --untracked-files=no`')
  }

  // (b) [M2] answered `{ code: 0, stdout: '' }`, the drive gets PAST the
  //     refusal: `git -C <repoDir> rev-parse HEAD` is recorded at a strictly
  //     greater index than the cleanliness command, so a rev-parse issued
  //     earlier cannot satisfy this leg.
  {
    const h = stubDrive({ label: 'b', cleanliness: { code: 0, stdout: '' } })
    await h.drive()
    const cleanIdx = h.cmds.indexOf(`git -C ${h.repoDir} status --porcelain --untracked-files=no`)
    const headIdx = h.cmds.indexOf(`git -C ${h.repoDir} rev-parse HEAD`)
    assert.ok(cleanIdx >= 0, `the cleanliness command must be recorded, got: ${JSON.stringify(h.cmds)}`)
    assert.ok(headIdx >= 0, `\`git -C ${h.repoDir} rev-parse HEAD\` must be recorded, got: ${JSON.stringify(h.cmds)}`)
    assert.ok(
      headIdx > cleanIdx,
      `rev-parse HEAD (index ${headIdx}) must come after the cleanliness command (index ${cleanIdx}): ${JSON.stringify(h.cmds)}`,
    )
    ok('(b) [M2] empty stdout proceeds past the refusal to the HEAD read')
  }

  // (c) [M3] answered ` M fleet/drive.mjs\n` — a tracked, modified file, which
  //     `--untracked-files=no` still reports — the drive rejects, and the
  //     message contains `is not clean`.
  {
    const h = stubDrive({ label: 'c', cleanliness: { code: 0, stdout: ' M fleet/drive.mjs\n' } })
    await assert.rejects(h.drive(), (error) => {
      assert.ok(error.message.includes('is not clean'), `the refusal must say \`is not clean\`, got: ${error.message}`)
      return true
    })
    assert.deepEqual(h.provisionCalls, [], 'a dirty tracked file must not provision')
    ok('(c) [M3] non-empty stdout still refuses, saying `is not clean`')
  }

  // (d) [M4] answered `{ code: 128, stdout: '' }`, the drive rejects, and the
  //     message contains `is not clean`.
  {
    const h = stubDrive({ label: 'd', cleanliness: { code: 128, stdout: '' } })
    await assert.rejects(h.drive(), (error) => {
      assert.ok(error.message.includes('is not clean'), `the refusal must say \`is not clean\`, got: ${error.message}`)
      return true
    })
    assert.deepEqual(h.provisionCalls, [], 'a failed cleanliness command must not provision')
    ok('(d) [M4] a non-zero exit still refuses, saying `is not clean`')
  }

  // (e) [M5] the operator-facing sentence in `fleet/RUNBOOK.md` describes the
  //     refusal as covering TRACKED, uncommitted changes. The sentence is
  //     line-wrapped in the file, so the read collapses every run of
  //     whitespace to one space before matching.
  {
    const runbook = fs.readFileSync(new URL('../RUNBOOK.md', import.meta.url), 'utf8').replace(/\s+/g, ' ')
    const WANTED = 'an uncommitted change to a tracked file there is refused before any provisioning'
    const OLD = 'an uncommitted change there is refused before any provisioning'
    assert.ok(runbook.includes(WANTED), `fleet/RUNBOOK.md must carry \`${WANTED}\` (whitespace-collapsed)`)
    assert.equal(runbook.includes(OLD), false, `fleet/RUNBOOK.md must no longer carry \`${OLD}\` (whitespace-collapsed)`)
    ok('(e) [M5] the RUNBOOK describes the refusal as covering tracked, uncommitted changes')
  }

  console.log('ALL TESTS PASSED')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
