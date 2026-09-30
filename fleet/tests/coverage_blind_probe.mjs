// Probe for factory/flock/coverage.mjs: a mixed command coverage is partly blind to still runs and
// keeps its Node lines, flagged unmeasured; Python -E and Bun are blind, a plain Python run is not.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { linesRunAll } from '../../factory/flock/coverage.mjs'

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-blind-probe-'))
try {
  fs.writeFileSync(path.join(cwd, 'c.py'), 'def f(x):\n    if x: return 1\n    return 2\nf(1)\n')
  fs.writeFileSync(path.join(cwd, 'c.mjs'), 'function f (x) {\n  if (x) return 1\n  return 2\n}\nf(1)\n')
  const [mixed, ...rest] = await linesRunAll([
    { argv: ['bash', '-lc', 'node c.mjs && python3 -S c.py'], cwd, env: process.env },
    { argv: ['python3', '-E', 'c.py'], cwd, env: process.env },
    { argv: ['bun', 'c.mjs'], cwd, env: process.env },
    { argv: ['python3', 'c.py'], cwd, env: process.env }
  ])
  console.log(JSON.stringify({
    mixed_unmeasured: mixed.unmeasured,
    mixed_mjs2: (mixed.lines['c.mjs'] || []).includes(2),
    unmeasured: rest.map((a) => a.unmeasured)
  }))
} finally {
  fs.rmSync(cwd, { recursive: true, force: true })
}
