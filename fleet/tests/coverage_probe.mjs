// Probe for factory/flock/coverage.mjs: which lines a command ran, for Python and Node, and its exit.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { linesRun } from '../../factory/flock/coverage.mjs'

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-probe-'))
try {
  fs.writeFileSync(path.join(cwd, 'c.py'), 'def f(x):\n    if x: return 1\n    return 2\nf(1)\n')
  fs.writeFileSync(path.join(cwd, 'c.mjs'), 'function f (x) {\n  if (x) return 1\n  return 2\n}\nf(1)\n')
  const py = linesRun({ argv: ['python3', 'c.py'], cwd }).lines['c.py'] || []
  const mjs = linesRun({ argv: ['node', 'c.mjs'], cwd }).lines['c.mjs'] || []
  const { exit } = linesRun({ argv: ['python3', '-c', 'import sys; sys.exit(3)'], cwd })
  console.log(JSON.stringify({ py2: py.includes(2), py3: py.includes(3), mjs2: mjs.includes(2), mjs3: mjs.includes(3), exit }))
} finally {
  fs.rmSync(cwd, { recursive: true, force: true })
}
