/**
 * fleet/tests/fixtures/hermetic/tree/exams/run_7/test_leaky_exam.mjs — an exam
 * under the reserved `exams/<slug>/` directory that breaks the first hermetic
 * rule once: one spawn that inherits the parent's environment.
 *
 * Never executed and never collected — `fixtures/` is outside every sweep and
 * outside the bridge's globs. It exists so the probe is shown to reach an exam
 * two levels down and hold it to the same rules as a curated sim (#890): a
 * probe that swept only the flat `fleet/tests/` would let this leak stand.
 */

import { spawnSync } from 'node:child_process'

import { simEnv } from '../../_helpers.mjs'

// The leak: the environment is the parent's.
export const inherits = () => spawnSync('bash', ['-c', 'true'], { env: { ...process.env } })

// And one spawn that is hermetic, so the count of offenders is a count and not
// a total: this one is handed the rig's environment through the exam's own
// `../../_helpers.mjs` import.
export const clean = () => spawnSync('bash', ['-c', 'true'], { env: simEnv() })
