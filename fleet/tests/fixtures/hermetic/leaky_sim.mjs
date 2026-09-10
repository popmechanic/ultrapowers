/**
 * fleet/tests/fixtures/hermetic/leaky_sim.mjs — the probe's own red.
 *
 * A sim-shaped file that breaks all three of the hermetic rules at once, one
 * offence per rule: a spawn that inherits the parent's environment, a read of
 * an absolute path on the box, and a spawn of another `test_*.mjs`. It is never
 * collected (its name does not match `test_*.mjs`) and never executed — the
 * probe's sweep is a static read of this text, and it exists so the sweep is
 * shown to name what it claims to name.
 */

import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

import { simEnv } from '../../_helpers.mjs'

// (1) An inheriting spawn: the environment is the parent's, so every fact of
// the box reaches the child.
export const inherits = () => spawnSync('bash', ['-c', 'true'], { env: { ...process.env } })

// (2) An absolute read: the renderer address the box's own setup installed,
// swallowed so the leak is silent.
export const reads = () => {
  try {
    return fs.readFileSync('/etc/fleet/render.env', 'utf8')
  } catch {
    return ''
  }
}

// (3) A sibling-sim spawn: hermetic on the first rule and still a sim running
// another sim, which is the bridge's job and not a sim's.
export const runsSibling = () =>
  spawnSync(process.execPath, ['fleet/tests/test_fitness.mjs'], { env: simEnv() })
