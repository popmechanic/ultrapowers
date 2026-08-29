// fleet/tests/test_no_binary_sources.mjs
//
// A single raw NUL byte in a .mjs source makes git treat the whole file as
// BINARY. It happened: `fleet/run-worker.mjs` shipped with a literal 0x00 at
// byte 7345 (a session-id separator that should have been the escape '\x00'),
// and that file's own pull request showed `Bin 0 -> 29203 bytes` — not one
// reviewable line of the driver's core module, in the PR that introduced it.
//
// The cost is not cosmetic. It is that the code most needing review becomes
// the code no reviewer can see, silently, with a green diff.
//
// This makes it inexpressible rather than remembered.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Source trees whose text-ness git (and reviewers) depend on. Deliberately not
// the whole repo: fixtures and evidence bundles may legitimately be binary.
const DIRS = ['fleet', 'skills', 'tests', 'kernel']
const EXTS = new Set(['.mjs', '.js', '.py', '.md', '.json', '.sh', '.yml', '.yaml'])

const walk = (dir, out = []) => {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (EXTS.has(path.extname(e.name))) out.push(full)
  }
  return out
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)))
assert.ok(files.length > 100, `expected to scan a real tree, found ${files.length} files`)

const offenders = []
for (const f of files) {
  const buf = fs.readFileSync(f)
  const at = buf.indexOf(0)
  if (at !== -1) offenders.push(`${path.relative(ROOT, f)} (byte ${at})`)
}

assert.deepEqual(
  offenders,
  [],
  'source files must contain no raw NUL byte — git treats such a file as binary and its diff ' +
    'becomes unreviewable. Use the escape \\x00 in a string literal instead:\n  ' +
    offenders.join('\n  '),
)

console.log(`ALL TESTS PASSED (${files.length} source files, no NUL bytes)`)
