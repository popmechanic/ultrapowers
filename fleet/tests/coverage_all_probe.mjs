// Probe for linesRunAll in factory/flock/coverage.mjs: jobs run side by side, a timed-out job's
// whole process group is killed, a job past the budget is skipped, and lines are still recorded.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { linesRunAll } from '../../factory/flock/coverage.mjs'

const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-all-probe-'))
try {
  fs.writeFileSync(path.join(cwd, 'c.py'), 'def f(x):\n    if x: return 1\n    return 2\nf(1)\n')
  const two = { argv: ['bash', '-lc', 'sleep 2'], cwd }

  // M1: three two-second jobs, three at once
  const t0 = Date.now()
  await linesRunAll([two, two, two], { parallel: 3 })
  const elapsed = Date.now() - t0

  // M2: a job whose grandchild would outlive it
  const [timed] = await linesRunAll([{ argv: ['bash', '-lc', 'sleep 300 & echo $! > pid; wait'], cwd }], { timeoutMs: 1000 })
  const pid = Number(fs.readFileSync(path.join(cwd, 'pid'), 'utf8').trim())
  let orphan = alive(pid)
  for (let waited = 0; orphan && waited < 2000; waited += 100) { await sleep(100); orphan = alive(pid) }
  if (orphan) { try { process.kill(pid, 'SIGKILL') } catch {} }

  // M3: one at a time, the second starts past the budget
  const budget = await linesRunAll([two, two], { parallel: 1, budgetMs: 1000 })

  // M4: lines recorded
  const [py] = await linesRunAll([{ argv: ['python3', 'c.py'], cwd }])
  const lines = py.lines['c.py'] || []

  console.log(JSON.stringify({
    elapsed_ms: elapsed,
    timeout_exit: timed.exit,
    orphan_alive: orphan,
    skipped: budget[1].skipped === true,
    py2: lines.includes(2),
    py3: lines.includes(3)
  }))
} finally {
  fs.rmSync(cwd, { recursive: true, force: true })
}
