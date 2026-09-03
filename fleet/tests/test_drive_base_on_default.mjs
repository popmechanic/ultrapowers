// fleet/tests/test_drive_base_on_default.mjs — #579 items 1 and 3: a base has
// to be a commit on the target's DEFAULT BRANCH, and the launch says so before
// a VM is spent.
//
// The claim under test: if I pass a base GitHub does not actually have, or one
// that is present but sits on no default-branch history (a `pinned run tip:`
// sha off a squash-merged PR, a commit pushed to a side branch), the launch
// refuses right there and tells me which.
//
// Nothing here is simulated that the answer depends on. The fixture's three
// real git repos stand in for the ends of the transport (`_drive_helpers.mjs`):
// the bare `origin.git` IS GitHub, the driver's cache clone is cut from it for
// real, and `merge-base --is-ancestor` is answered by git itself. Only the
// sandbox seams are stubbed — `provision` records its options and stops the
// drive there, `destroy` is a no-op — so every drive below is a real preflight
// and nothing reaches exe.dev or the network.
//
// The whole fixture is built under `init.defaultBranch=master` (M6): a bare
// initialised that way has a HEAD naming a branch that never exists, the cache
// clone then gets no `refs/remotes/origin/HEAD`, and every drive would refuse
// with M3. The fixture must set the bare's HEAD explicitly, and this file is
// where that is proven.
//
// Legs: (a) M1, (b) M2, (c) M3, (d) M4, (e) M5, (f) M6.

// Set BEFORE the fixture is built — every git command in this process, the
// fixture's `git init --bare` included, inherits it (M6, leg f).
process.env.GIT_CONFIG_PARAMETERS = "'init.defaultBranch=master'"

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { driveOne } from '../drive.mjs'
import { setupDriveFixture, sh } from './_drive_helpers.mjs'

const ok = (line) => console.log(`ok - ${line}`)

// The two preflight commands the contract spells out, byte for byte (M1).
const catFileCmd = (cacheDir, sha) => `git -C ${cacheDir} cat-file -e ${sha}^{commit}`
const mergeBaseCmd = (cacheDir, sha) => `git -C ${cacheDir} merge-base --is-ancestor ${sha} refs/remotes/origin/HEAD`

// A refusal is only useful if an operator reading the message alone knows what
// is wrong and what to do; every phrase the machine clauses pin is checked as a
// substring of the message itself.
const namesAll = (message, phrases, leg) => {
  for (const phrase of phrases) {
    assert.ok(
      String(message).includes(phrase),
      `${leg}: the refusal must name ${JSON.stringify(phrase)} — got: ${message}`,
    )
  }
}

const fixture = await setupDriveFixture()
try {
  const { tmp, repoDir, originRepo, cacheDir, headSha, unreachableSha, makeExec, driveDefaults } = fixture

  // A drive that runs the whole preflight for real and stops at `provision`.
  // Every command it issued is on `exec.cmds`, so "exactly one further command,
  // immediately after the cat-file" is asserted BY INDEX (M1) and the three
  // refusal preconditions (M2/M3) are asserted against the recorded list, the
  // recorded provision calls and the store directory on disk.
  const stubDrive = ({ label, baseSha }) => {
    const runId = `run-base-${label}`
    const dbDir = path.join(tmp, `db-${runId}`)
    const provisionCalls = []
    const exec = makeExec(() => {})
    const drive = () =>
      driveOne({
        ...driveDefaults,
        baseSha,
        runId,
        dbDir,
        evidenceDir: path.join(tmp, `ev-${runId}`),
        exec,
        progressLog: () => {},
        settleMs: 20,
        publishTimeoutMs: 500,
        parkedPublishWaitMs: 100,
        heartbeatTimeoutMs: 1_000,
        provision: async (options) => {
          provisionCalls.push(options)
          throw new Error('provision-stop')
        },
        destroy: async () => {},
      })
    return { drive, exec, provisionCalls, dbDir, runId }
  }

  // The three things a refusal must be true of, whichever refusal it is: no
  // command addressed to exe.dev was issued, `provision` was never called, and
  // the orchestrator's store directory does not exist (M2, M3).
  const assertRefusedBeforeAnyVm = (h, leg) => {
    const reached = h.exec.cmds.filter((cmd) => /exe\.dev|\.exe\.xyz/.test(cmd))
    assert.deepEqual(reached, [], `${leg}: no command may be addressed to exe.dev before the base is judged`)
    assert.deepEqual(h.provisionCalls, [], `${leg}: a refused base must not provision`)
    assert.equal(fs.existsSync(h.dbDir), false, `${leg}: the refusal must precede the orchestrator's store dir`)
  }

  // -- (f) M6, first half: the bare origin's HEAD ---------------------------
  // Built above under `init.defaultBranch=master`; the fixture must name `main`
  // anyway, because that is the branch it pushes and the one the cache clone
  // has to resolve `refs/remotes/origin/HEAD` to.
  {
    const head = await sh(`git -C "${originRepo}" symbolic-ref HEAD`, tmp)
    assert.equal(head.code, 0, `(f) the bare origin must have a resolvable HEAD: ${head.stderr}`)
    assert.equal(
      head.stdout.trim(),
      'refs/heads/main',
      '(f) [M6] the fixture bare origin sets HEAD to refs/heads/main whatever init.defaultBranch says',
    )
    ok('(f) [M6] the fixture bare origin HEAD is refs/heads/main under init.defaultBranch=master')
  }

  // -- (a) M1 + (d) M4 + (f) M6, second half --------------------------------
  // A drive from the pushed `main` head: the base IS the default branch tip, so
  // the check passes and the drive proceeds to `provision` exactly as at BASE.
  {
    const h = stubDrive({ label: 'a', baseSha: headSha })
    await h.drive()

    const catFile = catFileCmd(cacheDir, headSha)
    const mergeBase = mergeBaseCmd(cacheDir, headSha)
    const at = h.exec.cmds.indexOf(catFile)
    assert.ok(at >= 0, `(a) [M1] the presence check must still be issued: ${JSON.stringify(h.exec.cmds)}`)
    assert.equal(
      h.exec.cmds[at + 1],
      mergeBase,
      `(a) [M1] the default-branch check is the one command directly after the cat-file, byte for byte — got ${JSON.stringify(h.exec.cmds[at + 1])}`,
    )
    assert.deepEqual(
      h.exec.cmds.filter((cmd) => /merge-base/.test(cmd)),
      [mergeBase],
      '(a) [M1] exactly one merge-base command, anywhere in the drive',
    )
    ok('(a) [M1] the merge-base --is-ancestor check follows the cat-file, once, with cacheDir and base substituted')

    // (d) [M4] a base on the default branch drives on, unchanged.
    assert.equal(h.provisionCalls.length, 1, `(d) [M4] expected one provision call, got ${h.provisionCalls.length}`)
    assert.equal(h.provisionCalls[0].baseSha, headSha, '(d) [M4] provision is called with the same baseSha')
    ok('(d) [M4] a base on the default branch reaches provision exactly once, with that base')

    // (f) [M6] second half: the cache the drive cut from that origin resolves
    // origin/HEAD — which is the ref the new check asks about.
    const symref = await sh(`git -C "${cacheDir}" symbolic-ref refs/remotes/origin/HEAD`, tmp)
    assert.equal(symref.code, 0, `(f) [M6] the cache clone must resolve refs/remotes/origin/HEAD: ${symref.stderr}`)
    assert.equal(symref.stdout.trim(), 'refs/remotes/origin/main', '(f) [M6] and it resolves to refs/remotes/origin/main')
    ok('(f) [M6] after the first drive the cache resolves refs/remotes/origin/HEAD to refs/remotes/origin/main')
  }

  // -- (e) M5: the BASE presence refusal, unchanged --------------------------
  // Runs BEFORE the stranded-tip leg below deliberately: `unreachableSha` is a
  // local `commit-tree` that never reached origin, so until something fetches
  // it into the cache the cache does not hold it at all — which is the older
  // refusal, and it must still land before any merge-base is asked.
  {
    const h = stubDrive({ label: 'e', baseSha: unreachableSha })
    await assert.rejects(h.drive(), (error) => {
      namesAll(error.message, ['push', unreachableSha], '(e) [M5]')
      return true
    })
    assert.ok(
      h.exec.cmds.includes(catFileCmd(cacheDir, unreachableSha)),
      `(e) [M5] the cat-file presence check is still issued: ${JSON.stringify(h.exec.cmds)}`,
    )
    assert.deepEqual(
      h.exec.cmds.filter((cmd) => /merge-base/.test(cmd)),
      [],
      '(e) [M5] no merge-base command follows a base the cache does not hold',
    )
    assertRefusedBeforeAnyVm(h, '(e) [M5]')
    ok('(e) [M5] a base absent from the cache is refused with push + the sha, and no merge-base is asked')
  }

  // -- (b) M2: present, but not on the default branch -------------------------
  // Two shapes of the same operator error, both of which pass `cat-file -e`.
  //
  // b1 — a commit pushed to a SIDE branch on origin: the drive's own
  //      `fetch origin` brings it into the cache, so it is genuinely on GitHub
  //      and genuinely not on the default branch.
  {
    const made = await sh("git commit-tree 'HEAD^{tree}' -p HEAD -m off-default-branch", repoDir)
    const sideSha = made.stdout.trim()
    assert.match(sideSha, /^[0-9a-f]{40}$/, `(b) commit-tree failed: ${made.stderr}`)
    assert.notEqual(sideSha, headSha)
    const pushed = await sh(`git -C "${repoDir}" push -q origin +${sideSha}:refs/heads/side`, tmp)
    assert.equal(pushed.code, 0, `(b) pushing the side branch failed: ${pushed.stderr}`)

    const h = stubDrive({ label: 'b-side', baseSha: sideSha })
    await assert.rejects(h.drive(), (error) => {
      namesAll(error.message, [sideSha, 'default branch', 'pinned run tip', '#579'], '(b-side) [M2]')
      return true
    })
    assert.ok(
      h.exec.cmds.includes(mergeBaseCmd(cacheDir, sideSha)),
      `(b-side) [M2] the refusal comes from the merge-base check: ${JSON.stringify(h.exec.cmds)}`,
    )
    assertRefusedBeforeAnyVm(h, '(b-side) [M2]')
    ok('(b-side) [M2] a base on a side branch is refused naming the sha, the default branch, pinned run tip and #579')
  }

  // b2 — a STRANDED TIP: a sha in the cache only as `refs/fleet/run-old`, the
  //      shape a `pinned run tip:` line copied off a squash-merged run has. It
  //      is on no branch of origin at all, and `cat-file -e` still finds it.
  {
    const fetched = await sh(
      `git -C "${cacheDir}" fetch "${repoDir}" +refs/heads/fleet-unreachable:refs/fleet/run-old`,
      tmp,
    )
    assert.equal(fetched.code, 0, `(b-stranded) seeding refs/fleet/run-old failed: ${fetched.stderr}`)
    const held = await sh(`git -C "${cacheDir}" cat-file -e ${unreachableSha}^{commit}`, tmp)
    assert.equal(held.code, 0, '(b-stranded) the cache must now hold the stranded tip, so cat-file cannot be what refuses')

    const h = stubDrive({ label: 'b-stranded', baseSha: unreachableSha })
    await assert.rejects(h.drive(), (error) => {
      namesAll(error.message, [unreachableSha, 'default branch', 'pinned run tip', '#579'], '(b-stranded) [M2]')
      return true
    })
    assert.ok(
      h.exec.cmds.includes(mergeBaseCmd(cacheDir, unreachableSha)),
      `(b-stranded) [M2] the refusal comes from the merge-base check: ${JSON.stringify(h.exec.cmds)}`,
    )
    assertRefusedBeforeAnyVm(h, '(b-stranded) [M2]')
    ok('(b-stranded) [M2] a tip present only as refs/fleet/run-old is refused on the same four words')
  }

  // -- (c) M3: the ref itself is unresolvable --------------------------------
  // `refs/remotes/origin/HEAD` deleted from the cache — the state a clone from
  // a bare with a dangling HEAD leaves behind. `merge-base --is-ancestor` then
  // exits 128, which is neither yes nor no, and the operator's remedy is a
  // `remote set-head`, not a push. Runs last: it leaves the cache without the
  // ref. (`followRemoteHEAD=never` keeps the deletion durable across the
  // drive's own `fetch origin` on git versions that would recreate it.)
  {
    await sh(`git -C "${cacheDir}" config remote.origin.followRemoteHEAD never`, tmp)
    const deleted = await sh(`git -C "${cacheDir}" symbolic-ref -d refs/remotes/origin/HEAD`, tmp)
    assert.equal(deleted.code, 0, `(c) deleting refs/remotes/origin/HEAD failed: ${deleted.stderr}`)

    const h = stubDrive({ label: 'c', baseSha: headSha })
    await assert.rejects(h.drive(), (error) => {
      namesAll(error.message, ['refs/remotes/origin/HEAD', 'remote set-head origin -a', '128'], '(c) [M3]')
      return true
    })
    assert.ok(
      h.exec.cmds.includes(mergeBaseCmd(cacheDir, headSha)),
      `(c) [M3] the refusal comes from the merge-base check: ${JSON.stringify(h.exec.cmds)}`,
    )
    assertRefusedBeforeAnyVm(h, '(c) [M3]')
    ok('(c) [M3] an unresolvable refs/remotes/origin/HEAD is refused naming the ref, remote set-head origin -a and 128')
  }

  console.log('ALL TESTS PASSED')
} finally {
  fixture.cleanup()
}
