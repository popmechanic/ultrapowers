/**
 * fleet/tests/test_compiler_stories_fetch.mjs — `fetchCompilerAt` fetches the
 * three stories-only scripts (`stories_parse.py`, `stories_check.py`,
 * `probe_block.py`) only when the caller passes `stories: true`; a claims-v1
 * launch (`launch.mjs` calling it with the plan's own `planGrammar(planText)`
 * read) must not fetch them at all.
 *
 * This is a direct, hermetic exercise of `fetchCompilerAt` against a fake
 * `exec` — no real process is spawned (the fake `exec` is a plain async
 * function, not a `spawn`/`execFile` call), so the sim needs no `simEnv`.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'

import { fetchCompilerAt } from '../compiler.mjs'

const STORIES_RELS = ['stories_parse.py', 'stories_check.py', 'probe_block.py']
  .map((f) => `skills/ultrapowers/scripts/${f}`)
const ALWAYS_RELS = ['plan_check.py', 'plan_parse.py']
  .map((f) => `skills/ultrapowers/scripts/${f}`)

const makeFakeExec = () => {
  const calls = []
  const exec = async (cmd, argv = []) => {
    calls.push({ cmd, argv: [...argv] })
    if (cmd === 'git' && argv.includes('show')) {
      const spec = String(argv[argv.length - 1])
      const rel = spec.slice(spec.indexOf(':') + 1)
      return { code: 0, stdout: `# ${rel}\n`, stderr: '' }
    }
    return { code: 1, stdout: '', stderr: 'unexpected call in sim\n' }
  }
  exec.calls = calls
  return exec
}

const relsFetched = (calls) =>
  calls.filter((c) => c.cmd === 'git' && c.argv.includes('show'))
    .map((c) => String(c.argv[c.argv.length - 1]).split(':').pop())

// ── claims-v1 (stories: false, the default) — no stories rel is fetched ─────
{
  const exec = makeFakeExec()
  const result = await fetchCompilerAt({ exec, engine: 'e'.repeat(40), pluginRoot: '/plugin' })
  try {
    const fetched = relsFetched(exec.calls)
    for (const rel of ALWAYS_RELS) assert.ok(fetched.includes(rel), `expected ${rel} to be fetched`)
    for (const rel of STORIES_RELS) assert.ok(!fetched.includes(rel), `claims-v1 must not fetch ${rel}`)
  } finally {
    await fsp.rm(result.dir, { recursive: true, force: true })
  }
}

// ── stories-v1 (stories: true) — all five are fetched ───────────────────────
{
  const exec = makeFakeExec()
  const result = await fetchCompilerAt({ exec, engine: 'e'.repeat(40), pluginRoot: '/plugin', stories: true })
  try {
    const fetched = relsFetched(exec.calls)
    for (const rel of [...ALWAYS_RELS, ...STORIES_RELS]) {
      assert.ok(fetched.includes(rel), `stories-v1 must fetch ${rel}`)
    }
  } finally {
    await fsp.rm(result.dir, { recursive: true, force: true })
  }
}

console.log('ALL TESTS PASSED')
