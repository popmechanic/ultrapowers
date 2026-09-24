/**
 * factory/select.mjs — the candidate finder.
 *
 * Pure: touches neither disk, git nor the network. Given the files of a
 * repository (as repository-relative paths) and a `read(path)` function, it
 * names the few existing test files that mention a set of paths and symbols,
 * most mentions first, and says how each one would be run.
 *
 * One standing candidate (#1242): when a changed path is itself a sim or a
 * sim helper under `fleet/tests`, the hermetic sweep
 * (`fleet/tests/test_sims_are_hermetic.mjs`) is offered last, past the cap,
 * with `why: 'hermetic'` — it reads every sim by glob, so no changed path is
 * ever verbatim in its text and nothing else would ever offer it.
 */

const SWEEP = 'fleet/tests/test_sims_are_hermetic.mjs'
const SIM_PATH_RE = /^fleet\/tests\/(test_|_)[^/]+\.mjs$/

const TEST_FILE_RE = [
  /^test_.*\.py$/,
  /^test_.*\.mjs$/,
  /^test_.*\.js$/,
  /^test_.*\.ts$/,
  /^.*_test\.py$/,
  /^.*\.test\.ts$/,
  /^.*\.test\.js$/,
  /^.*\.test\.mjs$/
]

function basename (path) {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

function stem (base) {
  return base.replace(/\.[^.]+$/, '')
}

function isTestFile (path) {
  const base = basename(path)
  return TEST_FILE_RE.some((re) => re.test(base))
}

function escapeRegExp (s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wholeWordMatch (text, needle) {
  const re = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(needle)}(?![A-Za-z0-9_$])`)
  return re.test(text)
}

function matchesNeedle (text, needle) {
  if (needle.includes('/') || needle.includes('.')) return text.includes(needle)
  return wholeWordMatch(text, needle)
}

const KIND_PRIORITY = ['path', 'import', 'symbol']

/** A line counts as an import line when, after leading whitespace, it begins
 *  `import ` or `from `, or it contains `require(` anywhere. */
function isImportLine (line) {
  const trimmed = line.replace(/^\s+/, '')
  if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) return true
  return line.includes('require(')
}

function dedupNeedles (values) {
  const seen = new Set()
  const out = []
  for (const v of values) {
    if (v.length < 4) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function buildPathNeedles (paths) {
  return dedupNeedles(paths.filter((p) => !isTestFile(p)))
}

function buildStemNeedles (paths) {
  return dedupNeedles(paths.filter((p) => !isTestFile(p)).map((p) => stem(basename(p))))
}

function buildSymbolNeedles (symbols) {
  return dedupNeedles(symbols)
}

export async function candidateTests ({ files, read, paths = [], symbols = [], exclude = [], cap = 8 }) {
  const excludeSet = new Set(exclude)
  const pathNeedles = buildPathNeedles(paths)
  const stemNeedles = buildStemNeedles(paths)
  const symbolNeedles = buildSymbolNeedles(symbols)

  const testFiles = files.filter((f) => isTestFile(f) && !excludeSet.has(f))

  const results = []
  for (const path of testFiles) {
    const text = await read(path)
    const hits = []
    const kinds = new Set()

    for (const needle of pathNeedles) {
      if (text.includes(needle)) {
        hits.push(needle)
        kinds.add('path')
      }
    }

    const importLines = text.split('\n').filter(isImportLine)
    if (importLines.length > 0) {
      for (const needle of stemNeedles) {
        if (importLines.some((line) => wholeWordMatch(line, needle))) {
          hits.push(needle)
          kinds.add('import')
        }
      }
      for (const needle of symbolNeedles) {
        if (importLines.some((line) => wholeWordMatch(line, needle))) {
          hits.push(needle)
          kinds.add('symbol')
        }
      }
    }

    if (hits.length > 0) {
      const why = KIND_PRIORITY.find((k) => kinds.has(k))
      results.push({ path, hits, why, hitCount: hits.length })
    }
  }

  results.sort((a, b) => {
    if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount
    if (a.path < b.path) return -1
    if (a.path > b.path) return 1
    return 0
  })

  const offered = results.slice(0, cap).map(({ path, hits, why }) => ({ path, hits, why }))

  const trigger = []
  for (const p of paths) {
    if (SIM_PATH_RE.test(p) && !trigger.includes(p)) trigger.push(p)
  }
  if (
    trigger.length > 0 &&
    files.includes(SWEEP) &&
    !excludeSet.has(SWEEP) &&
    !offered.some((c) => c.path === SWEEP)
  ) {
    offered.push({ path: SWEEP, hits: trigger, why: 'hermetic' })
  }

  return offered
}

/** The maximal run of `lines`, joined with `\n`, that still fits `cap`
 *  characters — never a mid-line cut. */
function wholeLinePrefix (lines, cap) {
  let out = ''
  for (const line of lines) {
    const next = out.length === 0 ? line : out + '\n' + line
    if (next.length > cap) break
    out = next
  }
  return out
}

/**
 * The lines of `text` that carry a needle from `hits` (same substring/
 * whole-word matching as `candidateTests`), each with the 3 lines before and
 * after it, overlapping/touching windows merged, windows in file order and
 * separated by a line holding only `…` — whole lines only, at most `cap`
 * characters. When no line matches, the first whole lines of `text` up to
 * `cap` characters.
 */
export function excerptFor (text, hits, cap) {
  const lines = text.split('\n')
  const hitIdx = []
  lines.forEach((line, i) => {
    if (hits.some((h) => matchesNeedle(line, h))) hitIdx.push(i)
  })

  if (hitIdx.length === 0) return wholeLinePrefix(lines, cap)

  const merged = []
  for (const i of hitIdx) {
    const start = Math.max(0, i - 3)
    const end = Math.min(lines.length - 1, i + 3)
    const last = merged[merged.length - 1]
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end)
    } else {
      merged.push([start, end])
    }
  }

  const outLines = []
  merged.forEach(([start, end], idx) => {
    if (idx > 0) outLines.push('…')
    for (let j = start; j <= end; j++) outLines.push(lines[j])
  })

  return wholeLinePrefix(outLines, cap)
}


export function commandFor (path, seconds) {
  if (path.endsWith('.test.ts')) return ['timeout', String(seconds), 'bun', 'test', path]
  if (path.endsWith('.py')) return ['timeout', String(seconds), 'python3', '-m', 'pytest', '-q', path]
  if (path.endsWith('.mjs') || path.endsWith('.js')) return ['timeout', String(seconds), 'node', path]
  return null
}
