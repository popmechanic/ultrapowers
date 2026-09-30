// The lines of a text that can run (#1407): what the 'not run by any probe' count may count.
//
// executableLines(path, text) answers, for a `.py` path, the sorted line numbers at which any code
// object of compile(text) starts a line (dis.findlinestarts over the module and every code object
// nested in co_consts), so blank lines, comments, docstrings and a statement's continuation lines are
// absent. One python3 run reads the text on stdin. Other paths, or any failure, answer null.
import { spawnSync } from 'node:child_process'

const PY = `
import dis, json, sys
src = sys.stdin.read()
seen, stack = set(), [compile(src, 'p.py', 'exec')]
while stack:
    co = stack.pop()
    for _, n in dis.findlinestarts(co):
        if n is not None and n > 0:
            seen.add(n)
    stack.extend(c for c in co.co_consts if hasattr(c, 'co_code'))
print(json.dumps(sorted(seen)))
`

export function executableLines (path, text) {
  if (!/\.py$/.test(String(path))) return null
  try {
    const r = spawnSync('python3', ['-c', PY], { input: String(text ?? ''), encoding: 'utf8', timeout: 30000 })
    if (r.status !== 0) return null
    const lines = JSON.parse(r.stdout)
    return Array.isArray(lines) && lines.every(Number.isInteger) ? lines : null
  } catch {
    return null
  }
}
