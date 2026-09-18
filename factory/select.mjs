/**
 * factory/select.mjs — the candidate finder.
 *
 * Pure: touches neither disk, git nor the network. Given the files of a
 * repository (as repository-relative paths) and a `read(path)` function, it
 * names the few existing test files that mention a set of paths and symbols,
 * most mentions first, and says how each one would be run.
 */

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

function buildNeedles (paths, symbols) {
  const raw = []
  for (const p of paths) {
    if (isTestFile(p)) continue
    raw.push(p)
    raw.push(stem(basename(p)))
  }
  for (const s of symbols) raw.push(s)

  const seen = new Set()
  const needles = []
  for (const n of raw) {
    if (n.length < 4) continue
    if (seen.has(n)) continue
    seen.add(n)
    needles.push(n)
  }
  return needles
}

export async function candidateTests ({ files, read, paths = [], symbols = [], exclude = [], cap = 8 }) {
  const excludeSet = new Set(exclude)
  const needles = buildNeedles(paths, symbols)

  const testFiles = files.filter((f) => isTestFile(f) && !excludeSet.has(f))

  const results = []
  for (const path of testFiles) {
    const text = await read(path)
    const hits = []
    for (const needle of needles) {
      if (matchesNeedle(text, needle)) hits.push(needle)
    }
    if (hits.length > 0) results.push({ path, hits })
  }

  results.sort((a, b) => {
    if (b.hits.length !== a.hits.length) return b.hits.length - a.hits.length
    if (a.path < b.path) return -1
    if (a.path > b.path) return 1
    return 0
  })

  return results.slice(0, cap)
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

export function symbolsOf (clauses) {
  const raw = []
  const spanRe = /`([^`]*)`/g
  for (const clause of clauses) {
    let m
    spanRe.lastIndex = 0
    while ((m = spanRe.exec(clause)) !== null) {
      const span = m[1]
      let value = null
      if (span.includes('/') && /\.[A-Za-z0-9]+$/.test(span)) {
        value = span
      } else {
        const idMatch = span.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)
        value = idMatch ? idMatch[0] : null
      }
      if (value && value.length >= 4) raw.push(value)
    }
  }

  const seen = new Set()
  const result = []
  for (const v of raw) {
    if (seen.has(v)) continue
    seen.add(v)
    result.push(v)
  }
  return result
}

export function commandFor (path, seconds) {
  if (path.endsWith('.test.ts')) return ['timeout', String(seconds), 'bun', 'test', path]
  if (path.endsWith('.py')) return ['timeout', String(seconds), 'python3', '-m', 'pytest', '-q', path]
  if (path.endsWith('.mjs') || path.endsWith('.js')) return ['timeout', String(seconds), 'node', path]
  return null
}
