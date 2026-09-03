/**
 * fleet/tests/_lobby_helpers.mjs — the fixture the four laptop CLIs' exams share.
 *
 * Two pieces:
 *
 *   `makeExec` — a recording `exec(cmd, argv)` seam. Every call is appended to
 *   `exec.calls`; a matching rule answers it; anything unmatched runs for real
 *   when its command is in `passthrough` (`git`, so a plan commit in a test is
 *   a real commit in a real repository) and otherwise answers empty and green.
 *   No rule ever runs `ssh`, `gh` or `curl`: the exams touch no network.
 *
 *   `makeFleetRuns` — a temporary `fleet-runs` checkout with a real bare origin
 *   behind it, so `git pull --rebase`, `git commit` and `git push` are the real
 *   commands and `plan=` is a sha git actually made.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { defaultExec } from '../lobby.mjs'

/** A canned answer. `stdout` may be a string or a value to JSON.stringify. */
export const answer = (stdout = '', { code = 0, stderr = '' } = {}) => ({
  code,
  stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
  stderr
})

/** A rule matching one lobby verb by the prefix of its remote command string. */
export const sshRule = (prefix, res) => ({
  when: (cmd, argv) => cmd === 'ssh' && String(argv[1] ?? '').startsWith(prefix),
  answer: res
})

/** A rule matching a local command by its first argument. */
export const cmdRule = (cmd, first, res) => ({
  when: (c, argv) => c === cmd && argv[0] === first,
  answer: res
})

/**
 * The recording seam. `rules` are tried in order; the first match answers.
 * `passthrough` names commands that really run when nothing matched.
 */
export function makeExec ({ rules = [], passthrough = ['git'] } = {}) {
  const calls = []
  const exec = async (cmd, argv = []) => {
    calls.push({ cmd, argv: [...argv], line: `${cmd} ${argv.join(' ')}` })
    for (const rule of rules) {
      if (rule.when(cmd, argv)) {
        return typeof rule.answer === 'function' ? rule.answer(cmd, argv) : rule.answer
      }
    }
    if (passthrough.includes(cmd)) return defaultExec(cmd, argv)
    return { code: 0, stdout: '', stderr: '' }
  }
  exec.calls = calls
  /** Every remote command string issued as a lobby verb, in order. */
  exec.lobby = () => calls.filter((c) => c.cmd === 'ssh').map((c) => c.argv[1])
  /** The mutating lobby verbs only — what a refusal must never have issued. */
  exec.mutating = () => exec.lobby().filter((line) =>
    /^(cp|rm|comment|rename|new|tag) /.test(line) || /^integrations (add|attach|detach|edit) /.test(line)
  )
  return exec
}

const run = (cwd, argv) => {
  const res = spawnSync('git', argv, { cwd, encoding: 'utf8' })
  if (res.status !== 0) {
    throw new Error(`git ${argv.join(' ')} in ${cwd}: ${res.stdout}${res.stderr}`)
  }
  return res.stdout
}

/** A throwaway directory, removed by `cleanup()`. */
export function tempDir (prefix = 'fleet-lobby-') {
  // realpath: on macOS /tmp is a symlink, and git resolves it — a path git
  // reports would otherwise not compare equal to the one the test built.
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix))
}

/**
 * A real `fleet-runs` checkout: a bare origin, one seed commit, and a clone
 * with `plans/` already present. `seed` may add files before the seed commit
 * (`{ 'plans/run-9.md': '…' }`).
 */
export function makeFleetRuns ({ root, seed = {} } = {}) {
  const base = root ?? tempDir()
  const origin = path.join(base, 'origin.git')
  run(base, ['init', '--bare', '--initial-branch=main', origin])
  const seedDir = path.join(base, 'seed')
  run(base, ['clone', origin, seedDir])
  fs.mkdirSync(path.join(seedDir, 'plans'), { recursive: true })
  fs.writeFileSync(path.join(seedDir, 'plans', '.gitkeep'), '')
  for (const [rel, body] of Object.entries(seed)) {
    fs.mkdirSync(path.dirname(path.join(seedDir, rel)), { recursive: true })
    fs.writeFileSync(path.join(seedDir, rel), body)
  }
  run(seedDir, ['config', 'user.email', 'fleet@example.invalid'])
  run(seedDir, ['config', 'user.name', 'fleet tests'])
  run(seedDir, ['add', '-A'])
  run(seedDir, ['commit', '-m', 'seed'])
  run(seedDir, ['push', 'origin', 'main'])

  const dir = path.join(base, 'fleet-runs')
  run(base, ['clone', origin, dir])
  run(dir, ['config', 'user.email', 'fleet@example.invalid'])
  run(dir, ['config', 'user.name', 'fleet tests'])
  return { base, origin, dir, git: (argv) => run(dir, argv).trim() }
}

/** Write `runs/<N>/status.json` into a fleet-runs checkout (no commit needed). */
export function writeStatus (dir, run_, status) {
  const target = path.join(dir, 'runs', String(run_))
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, 'status.json'), JSON.stringify(status))
}

/** Remove a temp tree. */
export const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true })

/** Run `body`, answering the error it threw (or null when it did not throw). */
export async function thrown (body) {
  try {
    await body()
  } catch (error) {
    return error
  }
  return null
}
