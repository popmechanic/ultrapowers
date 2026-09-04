/**
 * fleet/tests/_fleet_runs_helpers.mjs — the `fleet-runs` fixture.
 *
 * `makeFleetRuns` — a temporary `fleet-runs` checkout with a real bare origin
 * behind it, so `git pull --rebase`, `git commit` and `git push` are the real
 * commands and `plan=` is a sha git actually made.
 *
 * It sits beside `_lobby_helpers.mjs` rather than in it, for the reason
 * `fleet/fleet-runs.mjs` sits beside `lobby.mjs`: the shared lobby knows
 * nothing about a side repository, and the two exams that still read one
 * (`test_launch.mjs`, `test_janitor.mjs`) bring their own fixture.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { tempDir } from './_lobby_helpers.mjs'

const run = (cwd, argv, env) => {
  const res = spawnSync('git', argv, { cwd, encoding: 'utf8', env })
  if (res.status !== 0) {
    throw new Error(`git ${argv.join(' ')} in ${cwd}: ${res.stdout}${res.stderr}`)
  }
  return res.stdout
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
  return {
    base,
    origin,
    dir,
    git: (argv) => run(dir, argv).trim(),
    /** Commit `plans/run-<N>.md` dated `at` — the launch's own timestamp. */
    commitPlan: (run_, at) => {
      fs.writeFileSync(path.join(dir, 'plans', `run-${run_}.md`), `# run ${run_}\n`)
      run(dir, ['add', `plans/run-${run_}.md`])
      run(dir, ['commit', '-m', `plan run-${run_}`], {
        ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at
      })
    }
  }
}
