import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

import { simEnv } from '../../_helpers.mjs'

export const inherits = () => spawnSync('bash', ['-c', 'true'], { env: { ...process.env } })

export const reads = () => {
  try {
    return fs.readFileSync('/etc/fleet/planted.env', 'utf8')
  } catch {
    return ''
  }
}

export const runsSibling = () =>
  spawnSync(process.execPath, ['fleet/tests/test_fitness.mjs'], { env: simEnv() })
