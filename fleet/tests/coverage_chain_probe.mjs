// Probe for factory/flock/coverage.mjs: a target's own sitecustomize still runs under coverage, and
// a probe running Python with -I or -S (direct or under bash) is unmeasured while a plain one is not.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { linesRun, linesRunAll } from '../../factory/flock/coverage.mjs'

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-chain-probe-'))
try {
  const site = path.join(cwd, 'site')
  fs.mkdirSync(site)
  fs.writeFileSync(path.join(site, 'sitecustomize.py'), 'import builtins\nbuiltins.FLAG = 7\n')
  fs.writeFileSync(path.join(cwd, 'c2.py'), 'import builtins, sys\nsys.exit(0 if getattr(builtins, "FLAG", None) == 7 else 1)\n')
  fs.writeFileSync(path.join(cwd, 'c.py'), 'def f(x):\n    if x: return 1\n    return 2\nf(1)\n')
  const { exit } = linesRun({ argv: ['python3', 'c2.py'], cwd, env: { ...process.env, PYTHONPATH: site } })
  const answers = await linesRunAll([
    { argv: ['python3', '-I', 'c.py'], cwd, env: process.env },
    { argv: ['bash', '-lc', 'python3 -S c.py'], cwd, env: process.env },
    { argv: ['python3', 'c.py'], cwd, env: process.env }
  ])
  console.log(JSON.stringify({ chained_exit: exit, unmeasured: answers.map((a) => a.unmeasured) }))
} finally {
  fs.rmSync(cwd, { recursive: true, force: true })
}
