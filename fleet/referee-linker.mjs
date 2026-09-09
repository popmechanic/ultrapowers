// fleet/referee-linker.mjs — the one piece of the mechanical referee that has
// to read a language (#729, spec §3.3).
//
// A task's `Produces:` bullet names a symbol the task promised to leave behind.
// This module answers, mechanically, whether that symbol is actually there in
// the task's own files at HEAD:
//
//   resolved  — the file exports (or, for Python, defines at top level) it
//   declared  — the name is in the file, but not exported / not at top level,
//               or the bullet's arity is below the declaration's
//   missing   — every candidate file was read and none held the name
//   unlinked  — the linker could not answer: the symbol is not an identifier,
//               there is no linker for the file's language, or the subprocess
//               threw, printed nothing or hit the timeout
//
// `unlinked` is not a finding. Across the ninety `2026-09-0*` plans, 41 of 334
// `Produces:` symbols were report fields, event kinds, paths, shell functions
// or constant assignments — 12% — and a reviewer never had that evidence
// either (operator decision 7). So the grading order across candidates is
// resolved > declared > unlinked > missing: a file whose import throws sitting
// beside a clean miss answers `unlinked`, because the throwing file may well
// hold the name.
//
// The module lives apart from `fleet/referee.mjs` — the referee never imports
// it; the engine injects it — and it is driver code: no model call, no
// network, no git. The only subprocess it ever spawns is `node` or `python3`,
// on one file of the task's own clone, with a timeout.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// The engine's `SHELL_TIMEOUT_MS`. A fixture never needs it to fire.
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

// The compiler's own `_INTERFACE_LEAD_RE` (skills/ultrapowers/scripts/
// compile_plan.py), spelled in JavaScript: the bullet marker and one opening
// backtick are consumed, and the lead token may carry dots and dashes so that
// `report.reviewEconomy` is recognized — and then rejected as a symbol.
const LEAD_RE = /^\s*(?:[-*+]\s*)?`?([A-Za-z][\w.-]*)/
// A symbol a linker can look up. `report.reviewEconomy`, `snake-case` and
// friends never match.
const IDENT_RE = /^[A-Za-z_]\w*$/
// What follows the lead token when the bullet names a field, a path, an
// assignment or a dotted member rather than an exported symbol.
const NOT_A_SYMBOL_RE = /^\s*([:/=.])/

// The compiler's placeholder vocabulary (`PLACEHOLDER_TOKENS`,
// skills/ultrapowers/scripts/compile_plan.py), spelled once here and once
// there. A `Produces:` bullet whose lead word is one of these promises no
// symbol at all — it is authoring prose for "no contract" — so the linker
// answers `unlinked` on the raw bullet text, before any candidate file is
// read (#842).
export const PLACEHOLDER_TOKENS = new Set(['nothing', 'none', 'n/a', 'na'])

// The placeholder boundary, built from the vocabulary above so the two never
// drift: the bullet marker and one wrapping backtick are skipped, the whole
// lead word is compared case-insensitively, and it must end there — at
// end-of-text, whitespace, the closing backtick or any character outside
// `[A-Za-z0-9_]` (`—`, `:`, `(`). Longest alternative first, so `nothing`
// is never read as `n/a`'s neighbour; `nonesuch`, `None_`, `nothingness` and
// `name` merely start with a token and fall through to the real linkers.
const PLACEHOLDER_RE = new RegExp(
  '^\\s*(?:[-*+]\\s*)?`?(' +
  [...PLACEHOLDER_TOKENS].sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|') +
  ')(?![A-Za-z0-9_])', 'i')

// The placeholder word as written, or `''` when the bullet promises a symbol.
export const placeholderLead = (bullet) => {
  const m = PLACEHOLDER_RE.exec(String(bullet == null ? '' : bullet))
  return m ? m[1] : ''
}

const LINKABLE = new Set(['.mjs', '.js', '.py', '.ts', '.tsx'])

// resolved > declared > unlinked > missing.
const RANK = { resolved: 3, declared: 2, unlinked: 1, missing: 0 }

const answer = (status, symbol, detail) => ({ status, symbol, detail })

// ── the exec seam ─────────────────────────────────────────────────────────
// The engine's shape: `exec(cmd, argv, {cwd, timeoutMs}) -> Promise<{code,
// stdout, stderr}>`. The default runs `execFile` with the same result shape,
// so the sims run the real thing and the engine can pass its own seam.
export const defaultExec = (cmd, argv, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      argv,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        const out = String(stdout || '')
        let errOut = String(stderr || '')
        if (err && !errOut && err.message) errOut = String(err.message)
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          stdout: out,
          stderr: errOut,
          killed: !!(err && (err.killed || err.signal)),
          signal: (err && err.signal) || null,
        })
      },
    )
  })

const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || ''

// Why a spawning linker could not answer, when the kill tests have already
// passed. The first line of stderr is the reason whenever there is one. When
// there is none — a seam-shaped exec that reports a kill as nothing at all, the
// way a stubbed or minimal `exec` can — a run that printed no JSON line is
// named for what it looks like from here: the bound it did not print within.
// `res.code` is not the story then; a quiet non-zero exit and a quiet `null`
// are the same silence. Only a run that *did* print its JSON and still exited
// non-zero keeps the exit-code wording.
const whyQuiet = (res, out, prog, timeoutMs) =>
  firstLine(res && res.stderr) ||
  (out
    ? prog + ' exited ' + (res ? res.code : 'nothing')
    : prog + ' produced no JSON within ' + timeoutMs + 'ms')

// The last line of stdout that parses as a JSON object carrying `key`. The
// scripts print exactly one such line; anything the imported module logged
// first is ignored.
const jsonLine = (stdout, key) => {
  const lines = String(stdout || '').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue
    try {
      const v = JSON.parse(line)
      if (v && typeof v === 'object' && key in v) return v
    } catch { /* not our line */ }
  }
  return null
}

// ── the bullet ────────────────────────────────────────────────────────────
// The lead token and, when a parenthesised list follows it directly, the count
// of non-empty top-level comma-separated entries in that list — the bullet's
// arity. `linkProduces({a, b})` is one entry, not two: nesting is tracked so
// that a destructured object argument counts once, the way `Function.length`
// counts it.
export const parseBullet = (bullet) => {
  const text = String(bullet == null ? '' : bullet)
  const m = LEAD_RE.exec(text)
  if (!m) return { symbol: '', arity: null, rest: text }
  const rest = text.slice(m.index + m[0].length)
  return { symbol: m[1], arity: parenArity(rest), rest }
}

// The top-level entries of the parenthesised list at the head of `rest`, or
// null when no balanced list is there. Nesting is tracked so that a
// destructured object argument, a generic and an arrow type each stay one
// entry; `=>` is not a bracket.
const splitArgs = (rest) => {
  if (rest[0] !== '(') return null
  const open = { '(': ')', '[': ']', '{': '}', '<': '>' }
  const stack = []
  const entries = []
  let current = ''
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]
    if (c === '=' && rest[i + 1] === '>') { current += '=>'; i++; continue }
    if (c === ')' && stack.length === 1) { entries.push(current); return entries }
    if (open[c]) { stack.push(open[c]); if (stack.length > 1) current += c; continue }
    if (c === stack[stack.length - 1]) { stack.pop(); current += c; continue }
    if (c === ',' && stack.length === 1) { entries.push(current); current = ''; continue }
    current += c
  }
  return null // unbalanced — no arity claim
}

// The bullet's arity: the count of non-empty entries in that list.
const parenArity = (rest) => {
  const entries = splitArgs(rest)
  return entries ? entries.filter((e) => e.trim()).length : null
}

const wordRe = (symbol) => new RegExp('\\b' + symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')

// The `(found: …)` clause of a miss. Omitted when the file exports nothing.
const missDetail = (symbol, rel, names) => {
  const found = (names || []).filter(Boolean)
  return 'no export named ' + symbol + ' in ' + rel +
    (found.length ? ' (found: ' + found.join(', ') + ')' : '')
}

// The arity floor rule, shared by all three linkers: a bullet arity BELOW the
// declaration's required-parameter count is `declared` — the promise and the
// code disagree about the call. A bullet arity above it is still `resolved`,
// because rest and default parameters make the count a floor, not an equality.
const withArity = (symbol, rel, arity, required, verb) => {
  const shown = symbol + '/' + required
  if (arity != null && required != null && arity < required) {
    return answer('declared', symbol,
      rel + ' ' + verb + ' ' + shown + ' but the bullet names arity ' + arity)
  }
  return answer('resolved', symbol,
    rel + ' ' + verb + ' ' + (required == null ? symbol : shown))
}

// ── .mjs / .js ────────────────────────────────────────────────────────────
// `import()` is the only honest answer for an ES module: re-exports, barrel
// files and computed exports are all invisible to a text scan. It also runs
// the module, which is why a throw, a hang or a `main()` at module scope is
// `unlinked` with the reason rather than a finding.
const mjsScript = (fileUrl, symbol) => `
const url = ${JSON.stringify(fileUrl)}
const name = ${JSON.stringify(symbol)}
try {
  const m = await import(url)
  const v = m[name]
  process.stdout.write(JSON.stringify({
    has: name in m,
    length: typeof v === 'function' ? v.length : null,
    names: Object.keys(m),
  }) + '\\n')
} catch (e) {
  process.stderr.write(String((e && e.message) || e).split('\\n')[0] + '\\n')
  process.exit(1)
}
`

const linkMjs = async ({ symbol, arity, rel, abs, cloneDir, exec, timeoutMs }) => {
  const argv = ['--input-type=module', '-e', mjsScript(pathToFileURL(abs).href, symbol)]
  const res = await exec('node', argv, { cwd: cloneDir, timeoutMs })
  if (res && (res.killed || res.signal)) {
    return answer('unlinked', symbol, rel + ': timeout after ' + timeoutMs + 'ms')
  }
  const out = jsonLine(res && res.stdout, 'has')
  if (!out || (res && res.code !== 0)) {
    return answer('unlinked', symbol, rel + ': ' + whyQuiet(res, out, 'node', timeoutMs))
  }
  if (out.has) return withArity(symbol, rel, arity, out.length, 'exports')
  if (wordRe(symbol).test(readText(abs))) {
    return answer('declared', symbol, rel + ': declared, not exported')
  }
  return answer('missing', symbol, missDetail(symbol, rel, out.names))
}

// ── .py ───────────────────────────────────────────────────────────────────
// `ast.parse` only: the module is never imported, so a Python file with side
// effects at import is read without running it.
const pyScript = (file) => `
import ast, json
src = open(${JSON.stringify(file)}, encoding="utf-8").read()
tree = ast.parse(src)
names = []
arity = {}
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        names.append(node.name)
        a = node.args
        positional = list(getattr(a, "posonlyargs", [])) + list(a.args)
        arity[node.name] = max(0, len(positional) - len(a.defaults))
    elif isinstance(node, ast.ClassDef):
        names.append(node.name)
    elif isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name):
                names.append(target.id)
    elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        names.append(node.target.id)
print(json.dumps({"names": names, "arity": arity}))
`

const linkPy = async ({ symbol, arity, rel, abs, cloneDir, exec, timeoutMs }) => {
  const res = await exec('python3', ['-c', pyScript(abs)], { cwd: cloneDir, timeoutMs })
  if (res && (res.killed || res.signal)) {
    return answer('unlinked', symbol, rel + ': timeout after ' + timeoutMs + 'ms')
  }
  const out = jsonLine(res && res.stdout, 'names')
  if (!out || (res && res.code !== 0)) {
    return answer('unlinked', symbol, rel + ': ' + whyQuiet(res, out, 'python3', timeoutMs))
  }
  if (out.names.includes(symbol)) {
    const required = out.arity && Object.prototype.hasOwnProperty.call(out.arity, symbol)
      ? out.arity[symbol]
      : null
    return withArity(symbol, rel, arity, required, 'defines')
  }
  if (wordRe(symbol).test(readText(abs))) {
    return answer('declared', symbol, rel + ': declared, not at top level')
  }
  return answer('missing', symbol, missDetail(symbol, rel, out.names))
}

// ── .ts / .tsx ────────────────────────────────────────────────────────────
// A text scan, not a compile: the sandbox installs node, bun and pytest only
// and the fleet sims have no network, so `bunx tsc` would fetch. A `tsc
// --declaration` pass may run only where `<cloneDir>/node_modules/typescript`
// already exists — no clone the referee grades has one, so this path spawns no
// subprocess at all, and the `.ts` answer stands without `exec`.
const tsDeclaration = (text, symbol) => {
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fn = new RegExp('export\\s+(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*' + s + '\\s*\\(')
  const m = fn.exec(text)
  if (m) return { found: true, arity: tsArity(text.slice(m.index + m[0].length - 1)) }
  for (const kw of ['const', 'class', 'interface', 'type']) {
    if (new RegExp('export\\s+(?:declare\\s+)?' + kw + '\\s+' + s + '\\b').test(text)) {
      return { found: true, arity: null }
    }
  }
  // `export { foo }`, `export { bar as foo }`, `export { foo as bar }`.
  for (const list of text.match(/export\s*\{[^}]*\}/g) || []) {
    if (new RegExp('\\b' + s + '\\b').test(list)) return { found: true, arity: null }
  }
  return { found: false, arity: null }
}

// The declared parameter count of the list `rest` opens with: entries that
// carry neither `?` nor `=` — optional and defaulted parameters are not
// required, so the count stays a floor.
const tsArity = (rest) => {
  const entries = splitArgs(rest)
  return entries ? entries.filter((e) => e.trim() && !/[?=]/.test(e)).length : null
}

const linkTs = async ({ symbol, arity, rel, abs }) => {
  const text = readText(abs)
  const decl = tsDeclaration(text, symbol)
  if (decl.found) return withArity(symbol, rel, arity, decl.arity, 'exports')
  if (wordRe(symbol).test(text)) {
    return answer('declared', symbol, rel + ': declared, not exported')
  }
  return answer('missing', symbol, missDetail(symbol, rel, tsExportedNames(text)))
}

// The names the `(found: …)` clause of a `.ts` miss lists.
const tsExportedNames = (text) => {
  const names = []
  const decl = /export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
  let m
  while ((m = decl.exec(text))) names.push(m[1])
  for (const list of text.match(/export\s*\{([^}]*)\}/g) || []) {
    for (const entry of list.replace(/^export\s*\{/, '').replace(/\}$/, '').split(',')) {
      const parts = entry.trim().split(/\s+as\s+/)
      const name = (parts[parts.length - 1] || '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name)
    }
  }
  return [...new Set(names)]
}

const LINKERS = {
  '.mjs': linkMjs,
  '.js': linkMjs,
  '.py': linkPy,
  '.ts': linkTs,
  '.tsx': linkTs,
}

const readText = (abs) => {
  try { return fs.readFileSync(abs, 'utf8') } catch { return '' }
}

const isFile = (abs) => {
  try { return fs.statSync(abs).isFile() } catch { return false }
}

// ── the export ────────────────────────────────────────────────────────────
/**
 * Look one `Produces:` bullet up in the task's own files.
 *
 * @param {object}   o
 * @param {string}   o.bullet     one entry of the compiled task's
 *                                `interfaces.produces`, backticks and all
 * @param {string[]} o.files      the task's declared files, clone-relative
 * @param {string}   o.cloneDir   the checkout the files are read from
 * @param {function} [o.exec]     `exec(cmd, argv, {cwd, timeoutMs}) ->
 *                                Promise<{code, stdout, stderr}>`
 * @param {number}   [o.timeoutMs]
 * @returns {Promise<{status: string, symbol: string, detail: string}>}
 */
export const linkProduces = async ({ bullet, files, cloneDir, exec, timeoutMs } = {}) => {
  const { symbol, arity, rest } = parseBullet(bullet)
  const ex = typeof exec === 'function' ? exec : defaultExec
  const ms = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS

  // A placeholder promises nothing, so there is nothing to look up. This test
  // runs on the raw bullet text and before the three below, because `n/a` has
  // lead token `n` and rest `/a`: reached later it would answer "followed by
  // `/`" — the right status under the wrong sentence (#842).
  const placeholder = placeholderLead(bullet)
  if (placeholder) {
    return answer('unlinked', placeholder,
      '`' + placeholder + '` is a placeholder — no symbol promised; no file was read')
  }

  // Not a symbol at all — no file is read, no subprocess runs.
  if (!symbol) {
    return answer('unlinked', '', 'no lead symbol in the bullet — no file was read')
  }
  if (!IDENT_RE.test(symbol)) {
    return answer('unlinked', symbol,
      '`' + symbol + '` is not an identifier — no file was read')
  }
  const punct = NOT_A_SYMBOL_RE.exec(rest)
  if (punct) {
    return answer('unlinked', symbol,
      '`' + symbol + '` is followed by `' + punct[1] + '` in the bullet — ' +
      'a field, path or assignment, not an exported symbol; no file was read')
  }

  // The candidates: a language this module links, present in the clone.
  //
  // The clone boundary is checked before the filesystem is: an entry that
  // resolves outside `cloneDir` is not a file of the task's own clone, so it is
  // never a candidate and no subprocess is ever spawned on it — whether or not
  // something exists at that path. A relative entry that climbs out
  // (`../escape.mjs`) and an absolute entry pointing elsewhere are the same
  // case; an absolute entry inside the clone passes.
  const root = path.resolve(cloneDir || '.')
  const list = Array.isArray(files) ? files : []
  const candidates = []
  const skipped = []
  for (const entry of list) {
    const rel = String(entry || '').replace(/\\/g, '/')
    if (!rel) continue
    const ext = path.extname(rel).toLowerCase()
    if (!LINKABLE.has(ext)) { skipped.push(rel + ': no linker for ' + (ext || 'that file')); continue }
    const abs = path.resolve(root, rel)
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      skipped.push(rel + ': outside the clone')
      continue
    }
    if (!isFile(abs)) { skipped.push(rel + ': not in the clone'); continue }
    candidates.push({ rel, abs, ext })
  }
  if (!candidates.length) {
    return answer('unlinked', symbol,
      'no linkable file among the task\'s files: ' + (skipped.join('; ') || '(none listed)'))
  }

  // Each candidate answers on its own; the bullet takes the best grade any of
  // them earned. `resolved` is the ceiling, so the walk stops there.
  const results = []
  for (const c of candidates) {
    const r = await LINKERS[c.ext]({
      symbol, arity, rel: c.rel, abs: c.abs, cloneDir, exec: ex, timeoutMs: ms,
    })
    results.push(r)
    if (r.status === 'resolved') break
  }
  let best = results[0]
  for (const r of results) if (RANK[r.status] > RANK[best.status]) best = r
  const detail = results.filter((r) => r.status === best.status)
    .map((r) => r.detail).join('; ')
  return answer(best.status, symbol, detail)
}

export default linkProduces
