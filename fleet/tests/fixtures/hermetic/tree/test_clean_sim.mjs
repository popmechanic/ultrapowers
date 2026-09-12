/**
 * fleet/tests/fixtures/hermetic/tree/test_clean_sim.mjs — the flat sim of the
 * probe's fixture tree, hermetic on every rule. Never executed and never
 * collected: it is here so `sweptNames` is shown to list a flat sim AND the
 * exam under `exams/<slug>/` beside it from one root (#890).
 */

import { spawnSync } from 'node:child_process'

import { simEnv } from './_helpers.mjs'

export const clean = () => spawnSync('bash', ['-c', 'true'], { env: simEnv() })
