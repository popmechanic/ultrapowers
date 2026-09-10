/**
 * fleet/tests/test_sims_are_hermetic.mjs — the probe.
 *
 * The engine's pre-flight is this directory: the sims the bridge runs before
 * any run flies. What a sim sees is what it was handed; nothing of the box it
 * happens to be running on reaches it. This file is the one place that fails
 * the moment any of that stops being true.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Every
 * assertion names the leg it belongs to and the clause it comes from, so a
 * reader can map this file back to the contract:
 *
 *   M1  `fleet/tests/_helpers.mjs` exports `simEnv({ bin, home, env } = {})`.
 *       The object it returns carries no key of the parent's environment whose
 *       name begins `ULTRA_`, `TINYAPP_`, `FLEET_`, `ANTHROPIC_`, `CLAUDE_` or
 *       `GH_` except `FLEET_TEST_SLACK`, copied when the parent has it; the
 *       keys it sets itself are `PATH`, `HOME`, `TMPDIR` and `FLEET_HOME`, the
 *       last three under `home`, which defaults to a fresh `mkdtemp` under
 *       `os.tmpdir()`; the caller's `env` entries are laid over all of that
 *       last, so a caller-supplied key of any name wins; and its `PATH` is
 *       `bin` (when given) followed by the directories that hold `node`,
 *       `python3`, `git`, `bash` and `sh` for the parent, and nothing else of
 *       the parent's `PATH`.
 *   M2  every process spawn in `fleet/tests/test_*.mjs` and
 *       `fleet/tests/_*.mjs` passes an `env` derived from `simEnv`, and the
 *       probe names every spawn that does not.
 *   M3  no such file reads, stats or sources a string-literal absolute path
 *       outside the checkout and `os.tmpdir()`, and the probe names every one.
 *   M4  no `test_*.mjs` spawns another `test_*.mjs` or `pytest`; each of the
 *       nine sites at BASE survives only as names a sim checks exist under
 *       `fleet/tests/` without running them. A mutated copy of a sim's own
 *       text under the temp root is not a sibling run.
 *   M5  `fleet/sandbox-boot.sh` names `/etc/fleet/render.env` exactly once, as
 *       the default in `FLEET_RENDER_ENV="${FLEET_RENDER_ENV:-...}"`, and the
 *       rig pins `FLEET_RENDER_ENV` under every case's own home.
 *   M6  `tests/test_fleet_suite.py` exports `sim_env()` and hands each bridged
 *       `node` the environment it returns.
 *   M7  the probe, pointed at `fleet/tests/fixtures/hermetic/leaky_sim.mjs`,
 *       names its inheriting spawn, its `/etc/fleet/render.env` read and its
 *       sibling-sim spawn — and the probe itself spawns nothing.
 *
 * Legs: (a) M1, (b) M2, (c) M3, (d) M4, (e) M4 at the nine sites, (f) M7,
 * (g) M7, (h) M6, (i) M5.
 *
 * The sweep (legs b, c, d) is a static read of source, never an execution: it
 * reads every `fleet/tests/test_*.mjs` and `fleet/tests/_*.mjs` except this
 * file, and never `probe_*.mjs` (those are live probes, `fleet/tests/PROBES.md`,
 * outside every sweep here) and never `fixtures/`. Reading source is also why
 * this file needs no child process of its own — leg (f) holds it to that.
 *
 * The three rules, spelled once so an implementation can be read against them:
 *
 *   inherit  a call to one of `spawn`, `spawnSync`, `exec`, `execSync`,
 *            `execFile`, `execFileSync`. Its options object is the argument
 *            carrying `env:`; the accepted values are a literal `simEnv(`
 *            call, a spread `{ ...simEnv(`, or an identifier bound — in the
 *            same file, or in the sibling `_*.mjs` the file imports it from —
 *            by `const X =`/`let X =`/a function whose body returns one of
 *            those. A value mentioning `process.env` is refused outright.
 *            Anything else, including no `env:` at all, is an offender named
 *            by file and line. A helper is accepted by its body and not by its
 *            name: `bootEnv` passes because its body in
 *            `_sandbox_boot_helpers.mjs` spreads `simEnv(`.
 *   absolute a call to an fs read/stat/open name whose first argument is a
 *            string literal starting `/` and not under `os.tmpdir()`. Only
 *            reads: the absolute strings a sim asserts a script *emits* or a
 *            hook *denies* are fixtures, not paths it opens.
 *   sibling  a spawn whose call text, or the initializer of any identifier
 *            that call names (`const X =`, `for (const X of …)`, resolved one
 *            level in the same file), carries a string literal matching
 *            `test_[a-z0-9_]+\.mjs` or the word `pytest`. One level and no
 *            further is what keeps `test_run_engine_proof_runs.mjs`'s
 *            `spawnSync(process.execPath, [copy])` — where
 *            `const copy = copyWithProbe(simName, probe)` resolves to no
 *            literal — out of it: a mutated copy of a sim's own text under the
 *            temp root is a pin proven to be a pin, not a sibling run.
 *
 * Comments are blanked before any rule reads a file, so a spawn quoted in
 * prose is prose. String contents are blanked for the structural pass and kept
 * for the literal pass, so both questions are asked of the same offsets.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const TESTS_DIR = HERE
/** This file, the one sim the sweep leaves out — it quotes offenders on purpose. */
const SELF = 'test_sims_are_hermetic.mjs'
/** The deliverable leg (a) exercises, at the path the Produces line names. */
const HELPERS = path.join(TESTS_DIR, '_helpers.mjs')
/** The fixture leg (g) sweeps, at the path the Files list names. */
const FIXTURE = path.join(TESTS_DIR, 'fixtures', 'hermetic', 'leaky_sim.mjs')
/** The bridge leg (h) reads. */
const BRIDGE = path.join(ROOT, 'tests', 'test_fleet_suite.py')
/** The boot script leg (i) reads. */
const BOOT_SCRIPT = path.join(ROOT, 'fleet', 'sandbox-boot.sh')
/** The rig whose `bootEnv` leg (i) reads. */
const BOOT_HELPERS = path.join(TESTS_DIR, '_sandbox_boot_helpers.mjs')

/** The deliverable, imported dynamically so a tree without it still reports
 *  every other leg rather than dying at load. */
let helpers = null
let helpersError = null
try {
  helpers = await import('./_helpers.mjs')
} catch (error) {
  helpersError = error
}

// ── the source scanner ───────────────────────────────────────────────────────

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof',
  'do', 'else', 'yield', 'await',
])

/**
 * One pass over a source text. Returns three views at identical offsets:
 *   code      the text with comments blanked (string literals intact)
 *   skeleton  the same, with string and template contents blanked too, so
 *             brackets, commas and identifiers can be counted without a
 *             quoted one being mistaken for structure
 *   strings   the span of every string and template literal
 * Blanking preserves length and newlines, so a line number taken from any
 * view is a line number in the file.
 */
const scan = (text) => {
  const code = Array.from(text)
  const skel = Array.from(text)
  const strings = []
  const n = text.length
  const blank = (from, to, alsoCode) => {
    for (let k = Math.max(0, from); k < Math.min(to, n); k++) {
      if (text[k] === '\n') continue
      skel[k] = ' '
      if (alsoCode) code[k] = ' '
    }
  }
  const prevSig = (at) => {
    let j = at - 1
    while (j >= 0 && /\s/.test(text[j])) j--
    return j >= 0 ? text[j] : ''
  }
  const wordBefore = (at) => {
    let j = at - 1
    while (j >= 0 && /\s/.test(text[j])) j--
    const end = j + 1
    while (j >= 0 && /[\w$]/.test(text[j])) j--
    return text.slice(j + 1, end)
  }

  let i = 0
  while (i < n) {
    const c = text[i]
    const d = i + 1 < n ? text[i + 1] : ''
    if (c === '/' && d === '/') {
      let j = i
      while (j < n && text[j] !== '\n') j++
      blank(i, j, true)
      i = j
      continue
    }
    if (c === '/' && d === '*') {
      const close = text.indexOf('*/', i + 2)
      const j = close === -1 ? n : close + 2
      blank(i, j, true)
      i = j
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n) {
        if (text[j] === '\\') { j += 2; continue }
        if (text[j] === c) { j++; break }
        if (text[j] === '\n') break
        j++
      }
      const closed = j - 1 > i && text[j - 1] === c
      strings.push({ start: i, end: j })
      blank(i + 1, closed ? j - 1 : j, false)
      i = j
      continue
    }
    if (c === '`') {
      let j = i + 1
      let depth = 0
      while (j < n) {
        if (text[j] === '\\') { j += 2; continue }
        if (depth === 0 && text[j] === '`') { j++; break }
        if (depth === 0 && text[j] === '$' && text[j + 1] === '{') { depth = 1; j += 2; continue }
        if (depth > 0) {
          if (text[j] === '{') depth++
          else if (text[j] === '}') depth--
        }
        j++
      }
      strings.push({ start: i, end: j })
      blank(i + 1, Math.max(i + 1, j - 1), false)
      i = j
      continue
    }
    if (c === '/') {
      const p = prevSig(i)
      const startsValue = p === '' || '(,=:[!&|?{};+-*%^~<>'.includes(p) ||
        REGEX_KEYWORDS.has(wordBefore(i))
      if (startsValue) {
        let j = i + 1
        let klass = false
        while (j < n) {
          const e = text[j]
          if (e === '\\') { j += 2; continue }
          if (e === '\n') break
          if (klass) { if (e === ']') klass = false; j++; continue }
          if (e === '[') { klass = true; j++; continue }
          if (e === '/') { j++; break }
          j++
        }
        // The body is blanked in the skeleton only: a `//` inside a character
        // class is not a comment, and a quote inside one opens no string.
        blank(i + 1, Math.max(i + 1, j - 1), false)
        i = j
        continue
      }
    }
    i++
  }
  return { code: code.join(''), skeleton: skel.join(''), strings }
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length

const matchParen = (skeleton, open) => {
  let depth = 0
  for (let i = open; i < skeleton.length; i++) {
    const c = skeleton[i]
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}

/** The top-level argument ranges between `open` and `close`. */
const splitArgs = (skeleton, open, close) => {
  const args = []
  let depth = 0
  let start = open + 1
  for (let i = open + 1; i < close; i++) {
    const c = skeleton[i]
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (c === ',' && depth === 0) { args.push({ start, end: i }); start = i + 1 }
  }
  if (close > start) args.push({ start, end: close })
  return args.filter((a) => skeleton.slice(a.start, a.end).trim() !== '')
}

const RESERVED = new Set([
  'const', 'let', 'var', 'function', 'return', 'of', 'in', 'new', 'await', 'async',
  'typeof', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'try', 'catch', 'finally', 'throw', 'class', 'yield', 'delete', 'void', 'instanceof',
  'import', 'export', 'default', 'from', 'this', 'true', 'false', 'null', 'undefined',
  'process', 'path', 'fs', 'os', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number',
  'Boolean', 'Date', 'Buffer', 'URL', 'Promise', 'console', 'assert', 'require', 'Set',
  'Map', 'RegExp', 'Error', 'globalThis',
])

/** Every identifier a skeleton slice names, skipping property names and the
 *  keys of an object literal. */
const identsIn = (skeletonSlice) => {
  const out = []
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g
  let m
  while ((m = re.exec(skeletonSlice)) !== null) {
    const before = m.index > 0 ? skeletonSlice[m.index - 1] : ''
    if (before === '.') continue
    const rest = skeletonSlice.slice(m.index + m[0].length)
    const nextChar = (rest.match(/^\s*(\S?)/) || ['', ''])[1]
    if (nextChar === ':') continue
    if (RESERVED.has(m[0])) continue
    if (!out.includes(m[0])) out.push(m[0])
  }
  return out
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where an expression that starts at `from` ends: back at depth zero, at a
 *  `;` or the end of the line. */
const endOfExpression = (skeleton, from) => {
  let i = from
  while (i < skeleton.length && /\s/.test(skeleton[i])) i++
  let depth = 0
  for (; i < skeleton.length; i++) {
    const c = skeleton[i]
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) { if (depth === 0) return i; depth-- }
    else if (depth === 0 && (c === ';' || c === '\n')) return i
  }
  return skeleton.length
}

/**
 * The initializer bound to `ident` in `src`, as a span — `const X =`,
 * `let X =`, `var X =`, `for (const … X … of EXPR)`, or a function
 * declaration's body. The first binding found; no recursion of its own.
 */
const bindingOf = (src, ident) => {
  const id = escapeRe(ident)
  const decl = new RegExp(`(^|[\\s;{(\\[,])(?:export\\s+)?(?:const|let|var)\\s+${id}\\s*=`)
  const m = decl.exec(src.skeleton)
  if (m) {
    const from = m.index + m[0].length
    return { start: from, end: endOfExpression(src.skeleton, from) }
  }
  const forRe = /for\s*\(\s*(?:const|let|var)\s+([^;()]*?)\s+of\s+/g
  let f
  while ((f = forRe.exec(src.skeleton)) !== null) {
    const bound = new RegExp(`(^|[^\\w$])${id}([^\\w$]|$)`)
    if (!bound.test(f[1])) continue
    const open = src.skeleton.indexOf('(', f.index)
    const close = matchParen(src.skeleton, open)
    if (close === -1) continue
    return { start: f.index + f[0].length, end: close }
  }
  const fn = new RegExp(`(^|[\\s;}])(?:export\\s+)?(?:async\\s+)?function\\s+${id}\\s*\\(`)
  const g = fn.exec(src.skeleton)
  if (g) {
    const open = src.skeleton.indexOf('(', g.index)
    const close = matchParen(src.skeleton, open)
    const brace = src.skeleton.indexOf('{', close)
    if (brace !== -1) {
      let depth = 0
      for (let i = brace; i < src.skeleton.length; i++) {
        if (src.skeleton[i] === '{') depth++
        else if (src.skeleton[i] === '}') { depth--; if (depth === 0) return { start: brace, end: i + 1 } }
      }
    }
  }
  return null
}

const sliceOf = (src, span) => ({
  code: src.code.slice(span.start, span.end),
  skeleton: src.skeleton.slice(span.start, span.end),
})

// ── the three rules ──────────────────────────────────────────────────────────

const SPAWN_NAMES = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']

/** The fs names that read, stat, open or source a path. */
const READ_NAMES = ['readFileSync', 'readFile', 'existsSync', 'statSync', 'lstatSync',
  'realpathSync', 'readdirSync', 'readdir', 'accessSync', 'access', 'openSync', 'open',
  'createReadStream', 'copyFileSync', 'stat']

/**
 * Every call of one of `names` in a source. `dotted` says whether a name
 * reached through a member expression counts: an fs read is written
 * `fs.readFileSync(`, while a spawn is imported by name and a `.exec(` on some
 * other object is not a process.
 */
const callSitesOf = (src, names, { dotted = false } = {}) => {
  const out = []
  const before = dotted ? '[^\\w$]' : '[^\\w$.]'
  const re = new RegExp(`(^|${before})(${names.map(escapeRe).join('|')})\\s*\\(`, 'g')
  let m
  while ((m = re.exec(src.skeleton)) !== null) {
    const nameAt = m.index + m[1].length
    const openParen = src.skeleton.indexOf('(', nameAt + m[2].length)
    const close = openParen === -1 ? -1 : matchParen(src.skeleton, openParen)
    re.lastIndex = nameAt + m[2].length
    if (close === -1) continue
    out.push({
      name: m[2],
      start: nameAt,
      open: openParen,
      end: close + 1,
      args: splitArgs(src.skeleton, openParen, close),
    })
  }
  return out
}

/** The `env:` value of a call's options object, as a span — or null when no
 *  argument carries one. A bare identifier argument is resolved one level so
 *  `spawnSync(cmd, argv, opts)` is read through `opts`. */
const envValueOf = (src, call) => {
  const findIn = (span) => {
    const skel = src.skeleton.slice(span.start, span.end)
    const m = /(^|[{,]\s*)env\s*:/.exec(skel)
    if (m) {
      const from = span.start + m.index + m[0].length
      let depth = 0
      let i = from
      for (; i < span.end; i++) {
        const c = src.skeleton[i]
        if ('([{'.includes(c)) depth++
        else if (')]}'.includes(c)) { if (depth === 0) break; depth-- }
        else if (c === ',' && depth === 0) break
      }
      return { start: from, end: i }
    }
    const short = /(^|[{,]\s*)env\s*([,}]|$)/.exec(skel)
    if (short) {
      const b = bindingOf(src, 'env')
      return b || { start: span.start, end: span.end, unresolvedShorthand: true }
    }
    return null
  }
  for (const arg of call.args) {
    const direct = findIn(arg)
    if (direct) return direct
    const skel = src.skeleton.slice(arg.start, arg.end).trim()
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(skel) && !RESERVED.has(skel)) {
      const b = bindingOf(src, skel)
      if (b) {
        const through = findIn(b)
        if (through) return through
      }
    }
  }
  return null
}

// The `\.\.\.` alternative is the spread: `{ ...simEnv() }` and
// `{ ...process.env }` both put a dot in front of the name that matters.
const PROCESS_ENV_RE = /(?:^|\.\.\.|[^\w$.])process\s*\.\s*env\b/
const SIM_ENV_RE = /(?:^|\.\.\.|[^\w$.])simEnv\s*\(/

/** Is this `env:` value derived from `simEnv`? A value naming `process.env` is
 *  refused outright; otherwise a literal `simEnv(` call or a spread of one is
 *  accepted, and any other identifier is resolved by its body. */
const envIsSimEnv = (view, src, resolveImport, depth = 0, seen = new Set()) => {
  if (PROCESS_ENV_RE.test(view.code)) return false
  if (SIM_ENV_RE.test(view.code)) return true
  if (depth >= 4) return false
  for (const id of identsIn(view.skeleton)) {
    if (seen.has(id)) continue
    seen.add(id)
    const local = bindingOf(src, id)
    if (local && envIsSimEnv(sliceOf(src, local), src, resolveImport, depth + 1, seen)) return true
    const imported = resolveImport ? resolveImport(id) : null
    if (imported) {
      const there = bindingOf(imported, id)
      if (there && envIsSimEnv(sliceOf(imported, there), imported, null, depth + 1, new Set())) return true
    }
  }
  return false
}

const literalsIn = (src, span) => src.strings
  .filter((s) => s.start >= span.start && s.end <= span.end)
  .map((s) => src.code.slice(s.start, s.end))

const SIBLING_LITERAL_RE = /test_[a-z0-9_]+\.mjs|(^|[^\w])pytest([^\w]|$)/

const TMP = os.tmpdir()

/**
 * The three rules over one source text. `resolveImport(ident)` hands back the
 * scanned source of the sibling `_*.mjs` a name is imported from, or null.
 */
const sweep = (text, { file = '<source>', resolveImport = null } = {}) => {
  const src = scan(text)
  const inherit = []
  const absolute = []
  const siblings = []
  const at = (index) => `${file}:${lineOf(src.code, index)}`
  const snippet = (span) => src.code.slice(span.start, span.end).replace(/\s+/g, ' ').slice(0, 140)

  for (const call of callSitesOf(src, SPAWN_NAMES)) {
    const span = { start: call.start, end: call.end }
    const env = envValueOf(src, call)
    if (!env) {
      inherit.push({ file, line: lineOf(src.code, call.start), where: at(call.start), why: 'no env:', text: snippet(span) })
    } else if (!envIsSimEnv(sliceOf(src, env), src, resolveImport)) {
      inherit.push({ file, line: lineOf(src.code, call.start), where: at(call.start), why: 'env not derived from simEnv', text: snippet(span) })
    }

    const quoted = literalsIn(src, span)
    for (const id of identsIn(src.skeleton.slice(call.open, call.end))) {
      const b = bindingOf(src, id)
      if (b) quoted.push(...literalsIn(src, b))
    }
    if (quoted.some((q) => SIBLING_LITERAL_RE.test(q))) {
      siblings.push({ file, line: lineOf(src.code, call.start), where: at(call.start), why: 'runs another sim', text: snippet(span) })
    }
  }

  for (const call of callSitesOf(src, READ_NAMES, { dotted: true })) {
    const first = call.args[0]
    if (!first) continue
    const quoted = literalsIn(src, first)
    if (!quoted.length) continue
    const value = quoted[0].slice(1, -1)
    if (!value.startsWith('/')) continue
    if (value === TMP || value.startsWith(`${TMP}/`)) continue
    absolute.push({ file, line: lineOf(src.code, call.start), where: at(call.start), why: `absolute path ${value}`, text: snippet({ start: call.start, end: call.end }) })
  }

  return { inherit, absolute, siblings, src }
}

const named = (offenders) => offenders.map((o) => `${o.where} (${o.why}) ${o.text}`)

// ── the tree ─────────────────────────────────────────────────────────────────

const SWEPT = fs.readdirSync(TESTS_DIR)
  .filter((n) => n.endsWith('.mjs') && (n.startsWith('test_') || n.startsWith('_')) && n !== SELF)
  .sort()

const cache = new Map()
const sourceOf = (name) => {
  if (!cache.has(name)) {
    const full = path.join(TESTS_DIR, name)
    cache.set(name, fs.existsSync(full) ? scan(fs.readFileSync(full, 'utf8')) : null)
  }
  return cache.get(name)
}

/** ident -> the sibling `_*.mjs` source it is imported from. */
const importerFor = (src) => {
  const map = new Map()
  const re = /import\s*\{([^}]*)\}\s*from\s*(['"])(\.\/(_[A-Za-z0-9_]+\.mjs))\2/g
  let m
  while ((m = re.exec(src.code)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (name) map.set(name, m[4])
    }
  }
  return (ident) => (map.has(ident) ? sourceOf(map.get(ident)) : null)
}

const TREE = SWEPT.map((name) => {
  const text = fs.readFileSync(path.join(TESTS_DIR, name), 'utf8')
  const src = scan(text)
  return sweep(text, { file: name, resolveImport: importerFor(src) })
})
const treeOffenders = (kind) => TREE.flatMap((r) => r[kind])

/** Every `test_*.mjs` name a file hands to an `existsSync` — the sibling list
 *  read rather than run. Resolved transitively, since a list reaches the check
 *  through a loop variable and sometimes through an entry of a record. */
const namesCheckedForExistence = (src) => {
  const found = new Set()
  const collect = (span, depth, seen) => {
    for (const q of literalsIn(src, span)) found.add(q.slice(1, -1))
    if (depth <= 0) return
    for (const id of identsIn(src.skeleton.slice(span.start, span.end))) {
      if (seen.has(id)) continue
      seen.add(id)
      const b = bindingOf(src, id)
      if (b) collect(b, depth - 1, seen)
    }
  }
  for (const call of callSitesOf(src, ['existsSync', 'statSync', 'accessSync'], { dotted: true })) {
    collect({ start: call.open, end: call.end }, 3, new Set())
  }
  return found
}

// ── the harness ──────────────────────────────────────────────────────────────

const tests = []
const test = (name, fn) => { tests.push([name, fn]) }

// ── (a) the rig itself  [M1] ─────────────────────────────────────────────────

const PLANT = {
  ULTRA_PLANTED: '1',
  TINYAPP_RENDER_URL: 'http://planted.invalid',
  FLEET_RENDER_ENV: '/planted/render.env',
  CLAUDE_CONFIG_DIR: 'planted-config',
  GH_TOKEN: 'planted',
  ANTHROPIC_API_KEY: 'planted',
}
const DROPPED = ['ULTRA_', 'TINYAPP_', 'FLEET_', 'ANTHROPIC_', 'CLAUDE_', 'GH_']
const TOOLS = ['node', 'python3', 'git', 'bash', 'sh']

/** Runs `fn` with the six planted keys (one per dropped prefix) on this
 *  process, and restores the parent's own values after. */
const withPlant = (extra, fn) => {
  const before = new Map()
  const keys = { ...PLANT, ...extra }
  for (const [k, v] of Object.entries(keys)) {
    before.set(k, process.env[k])
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return fn()
  } finally {
    for (const [k, v] of before) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

const simEnvOrThrow = () => {
  assert.ok(helpers, `(a) [M1] fleet/tests/_helpers.mjs is the rig this exam grades, and it does not load: ${helpersError && helpersError.message}`)
  assert.equal(typeof helpers.simEnv, 'function',
    '(a) [M1] fleet/tests/_helpers.mjs exports simEnv({ bin, home, env } = {})')
  return helpers.simEnv
}

test('simEnv() hands on no key of a planted parent  [M1 / leg (a)]', () => {
  const simEnv = simEnvOrThrow()
  withPlant({ FLEET_TEST_SLACK: '7' }, () => {
    const e = simEnv()
    for (const key of Object.keys(PLANT)) {
      assert.equal(key in e, false,
        `(a) [M1] ${key} is planted on the parent and must not be in what simEnv() hands a child — ` +
        `got ${JSON.stringify(e[key])}`)
    }
    // The clause is about keys OF THE PARENT: `FLEET_HOME` begins with a swept
    // prefix and is still the rig's own, minted under the case's own home.
    const own = new Set(['PATH', 'HOME', 'TMPDIR', 'FLEET_HOME', 'FLEET_TEST_SLACK'])
    const leaked = Object.keys(e).filter((k) => DROPPED.some((p) => k.startsWith(p)) && !own.has(k))
    assert.deepEqual(leaked, [],
      `(a) [M1] no key of the parent beginning ${DROPPED.join(', ')} survives except ` +
      `FLEET_TEST_SLACK: ${JSON.stringify(leaked)}`)
    assert.equal(e.FLEET_TEST_SLACK, '7',
      '(a) [M1] FLEET_TEST_SLACK is the one swept name kept from the parent, copied when the parent has it')
    assert.deepEqual(Object.keys(e).sort(), ['FLEET_HOME', 'FLEET_TEST_SLACK', 'HOME', 'PATH', 'TMPDIR'],
      `(a) [M1] the keys simEnv() sets itself are PATH, HOME, TMPDIR and FLEET_HOME, plus the kept ` +
      `FLEET_TEST_SLACK — no other key of the parent reaches a child: ${JSON.stringify(Object.keys(e).sort())}`)
  })
})

test('a planted FLEET_HOME is the parent\'s, and never the child\'s  [M1 / leg (a)]', () => {
  const simEnv = simEnvOrThrow()
  // TMPDIR is left alone on purpose: `os.tmpdir()` reads it, and M1 sends the
  // default home there. The planted key here is the FLEET_ one that names a
  // home — the fact of the box #833 was about.
  withPlant({ FLEET_HOME: '/planted/home', HOME: '/planted/home' }, () => {
    const e = simEnv()
    assert.notEqual(e.FLEET_HOME, '/planted/home',
      "(a) [M1] FLEET_HOME is minted under the rig's own home, not read off the parent")
    assert.notEqual(e.HOME, '/planted/home', '(a) [M1] and so is HOME')
    assert.ok(e.HOME.startsWith(fs.realpathSync(TMP)) || e.HOME.startsWith(TMP),
      `(a) [M1] under os.tmpdir(): ${e.HOME}`)
  })
})

test('a parent without FLEET_TEST_SLACK gives a child without it  [M1 / leg (a)]', () => {
  const simEnv = simEnvOrThrow()
  withPlant({ FLEET_TEST_SLACK: undefined }, () => {
    const e = simEnv()
    assert.equal('FLEET_TEST_SLACK' in e, false,
      '(a) [M1] FLEET_TEST_SLACK is copied when the parent has it, and only then')
    assert.deepEqual(Object.keys(e).sort(), ['FLEET_HOME', 'HOME', 'PATH', 'TMPDIR'],
      `(a) [M1] and the four keys it sets itself are all that is left: ${JSON.stringify(Object.keys(e).sort())}`)
  })
})

test('HOME, TMPDIR and FLEET_HOME sit under one fresh directory in os.tmpdir()  [M1 / leg (a)]', () => {
  const simEnv = simEnvOrThrow()
  withPlant({}, () => {
    const e = simEnv()
    const home = e.HOME
    assert.ok(home, '(a) [M1] simEnv() sets HOME')
    for (const key of ['TMPDIR', 'FLEET_HOME']) {
      assert.ok(e[key] === home || e[key].startsWith(home + path.sep),
        `(a) [M1] ${key} (${e[key]}) is under the same home (${home})`)
    }
    assert.ok(fs.existsSync(home) && fs.statSync(home).isDirectory(),
      `(a) [M1] home defaults to a fresh mkdtemp that exists: ${home}`)
    const under = fs.realpathSync(TMP)
    assert.ok(fs.realpathSync(home).startsWith(under + path.sep),
      `(a) [M1] and it is under os.tmpdir() (${under}): ${fs.realpathSync(home)}`)
    const second = simEnv()
    assert.notEqual(second.HOME, home,
      '(a) [M1] each call mints a fresh home — a shared one is a fact of the box by another name')
  })
})

test('PATH is bin, then only the directories holding the five interpreters  [M1 / leg (a)]', () => {
  const simEnv = simEnvOrThrow()
  withPlant({}, () => {
    const e = simEnv({ bin: '/x/bin', env: { FLEET_HOME: '/y' } })
    const parts = e.PATH.split(path.delimiter)
    assert.equal(parts[0], '/x/bin',
      `(a) [M1] bin comes first when given: ${e.PATH}`)
    assert.equal(parts[1], path.dirname(process.execPath),
      `(a) [M1] and the directory of process.execPath follows it: ${e.PATH}`)
    const holdsATool = (dir) => TOOLS.some((t) => fs.existsSync(path.join(dir, t)))
    const loose = parts.slice(1).filter((d) => !holdsATool(d))
    assert.deepEqual(loose, [],
      `(a) [M1] every other entry holds one of ${TOOLS.join(', ')}, and nothing else of the parent's ` +
      `PATH is kept: ${JSON.stringify(loose)}`)
    const parent = new Set((process.env.PATH || '').split(path.delimiter))
    const inherited = parts.filter((d) => d !== '/x/bin' && parent.has(d) && !holdsATool(d))
    assert.deepEqual(inherited, [],
      `(a) [M1] no entry of the parent's PATH that holds none of the five: ${JSON.stringify(inherited)}`)
    assert.deepEqual(parts, [...new Set(parts)],
      `(a) [M1] deduplicated in order: ${e.PATH}`)
    assert.equal(e.FLEET_HOME, '/y',
      "(a) [M1] the caller's env is laid over everything else last")
  })
})

test("a caller's env wins for a key of any name  [M1 / leg (a)]", () => {
  const simEnv = simEnvOrThrow()
  withPlant({}, () => {
    const e = simEnv({ env: { PATH: '/only/this', HOME: '/h', TMPDIR: '/t', ULTRA_KEEP: 'mine', PLAIN: 'x' } })
    assert.equal(e.PATH, '/only/this', '(a) [M1] a caller-supplied PATH wins')
    assert.equal(e.HOME, '/h', '(a) [M1] a caller-supplied HOME wins')
    assert.equal(e.TMPDIR, '/t', '(a) [M1] a caller-supplied TMPDIR wins')
    assert.equal(e.ULTRA_KEEP, 'mine',
      '(a) [M1] a caller-supplied key of a swept name wins — the sweep is about the parent, not the caller')
    assert.equal(e.PLAIN, 'x', '(a) [M1] and so does one of no swept name')
  })
})

test('home, when given, is where the three keys point  [M1 / leg (a)]', () => {
  const simEnv = simEnvOrThrow()
  withPlant({}, () => {
    const home = fs.mkdtempSync(path.join(TMP, 'hermetic-leg-a-'))
    try {
      const e = simEnv({ home })
      assert.equal(e.HOME, home, '(a) [M1] HOME is the home it was handed')
      assert.ok(e.TMPDIR === home || e.TMPDIR.startsWith(home + path.sep),
        `(a) [M1] TMPDIR is under it: ${e.TMPDIR}`)
      assert.ok(e.FLEET_HOME === home || e.FLEET_HOME.startsWith(home + path.sep),
        `(a) [M1] FLEET_HOME is under it: ${e.FLEET_HOME}`)
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})

// ── (b) every spawn is handed its environment  [M2] ──────────────────────────

test('the sweep names zero inheriting spawns in fleet/tests/  [M2 / leg (b)]', () => {
  assert.ok(SWEPT.length >= 50,
    `(b) [M2] the sweep covers the pre-flight — ${SWEPT.length} files is not it`)
  const offenders = treeOffenders('inherit')
  assert.deepEqual(named(offenders), [],
    `(b) [M2] every spawn in fleet/tests/test_*.mjs and fleet/tests/_*.mjs takes an env derived ` +
    `from simEnv — ${offenders.length} do not:\n  ${named(offenders).slice(0, 40).join('\n  ')}`)
})

test('the same sweep names one offender for each inheriting shape  [M2 / leg (b)]', () => {
  const cases = [
    ["spawnSync('git', ['status'], { cwd })", 'no env: at all'],
    ["spawnSync('git', ['status'], { env: process.env })", 'the parent handed over whole'],
    ["execFileSync('git', ['status'], { env: { ...process.env, X: '1' } })", 'the parent spread'],
    ["const ENV = { ...process.env }\nspawnSync('git', ['status'], { env: ENV })", 'the parent behind a name'],
    ["const bootEnv = (ctx, env) => ({ ...process.env, ...env })\nspawn('bash', [script], { env: bootEnv(ctx, env) })",
      'a helper whose body spreads the parent — a name is not what makes it hermetic'],
  ]
  for (const [source, why] of cases) {
    const r = sweep(source, { file: '<case>' })
    assert.equal(r.inherit.length, 1,
      `(b) [M2] one offender for ${why}: ${JSON.stringify(source)} gave ${JSON.stringify(named(r.inherit))}`)
  }
})

test('the same sweep names none for each simEnv-derived shape  [M2 / leg (b)]', () => {
  const cases = [
    ["spawnSync('git', ['status'], { env: simEnv() })", 'a literal simEnv() call'],
    ["spawnSync('git', ['status'], { env: { ...simEnv(), X: '1' } })", 'a spread of one'],
    ["const ENV = simEnv({ bin })\nspawnSync('git', ['status'], { env: ENV })", 'an identifier bound to one'],
    ["const bootEnv = (ctx, env) => ({ ...simEnv({ bin: ctx.bin, home: ctx.home }), ...env })\nspawn('bash', [script], { env: bootEnv(ctx, env) })",
      'a helper whose body spreads one'],
  ]
  for (const [source, why] of cases) {
    const r = sweep(source, { file: '<case>' })
    assert.deepEqual(named(r.inherit), [],
      `(b) [M2] no offender for ${why}: ${JSON.stringify(source)} gave ${JSON.stringify(named(r.inherit))}`)
  }
})

test("a sibling helper's bootEnv is accepted by its body, across the import  [M2 / leg (b)]", () => {
  const helperSrc = scan("export const bootEnv = (ctx, env) => ({ ...simEnv({ bin: ctx.bin }), ...env })\n")
  const leakySrc = scan("export const bootEnv = (ctx, env) => ({ ...process.env, ...env })\n")
  const caller = "import { bootEnv } from './_sandbox_boot_helpers.mjs'\nspawn('bash', [script], { env: bootEnv(ctx, env) })"
  const green = sweep(caller, { file: '<case>', resolveImport: (id) => (id === 'bootEnv' ? helperSrc : null) })
  assert.deepEqual(named(green.inherit), [],
    '(b) [M2] a name a file imports from a sibling _*.mjs is resolved in that sibling\'s source, and ' +
    'a body that spreads simEnv( is accepted there')
  const red = sweep(caller, { file: '<case>', resolveImport: (id) => (id === 'bootEnv' ? leakySrc : null) })
  assert.equal(red.inherit.length, 1,
    '(b) [M2] and the same name is named when that body spreads the parent instead')
})

// ── (c) no sim opens a path on the box  [M3] ─────────────────────────────────

test('the sweep names zero literal absolute reads in fleet/tests/  [M3 / leg (c)]', () => {
  const offenders = treeOffenders('absolute')
  assert.deepEqual(named(offenders), [],
    `(c) [M3] no sim reads, stats or sources a string-literal absolute path outside the checkout ` +
    `and os.tmpdir():\n  ${named(offenders).slice(0, 40).join('\n  ')}`)
})

test('the same sweep names the box\'s render.env and leaves a temp path alone  [M3 / leg (c)]', () => {
  const red = sweep("fs.readFileSync('/etc/fleet/render.env', 'utf8')", { file: '<case>' })
  assert.equal(red.absolute.length, 1,
    `(c) [M3] one offender for a read of /etc/fleet/render.env: ${JSON.stringify(named(red.absolute))}`)
  const green = sweep("fs.readFileSync(path.join(os.tmpdir(), 'x'))", { file: '<case>' })
  assert.deepEqual(named(green.absolute), [],
    '(c) [M3] and none for a read under os.tmpdir()')
})

// ── (d) no sim runs another  [M4] ────────────────────────────────────────────

test('the sweep names zero sibling-sim spawns in fleet/tests/  [M4 / leg (d)]', () => {
  const offenders = treeOffenders('siblings')
  assert.deepEqual(named(offenders), [],
    `(d) [M4] no fleet/tests/test_*.mjs spawns another test_*.mjs or pytest — the bridge is what ` +
    `runs them:\n  ${named(offenders).slice(0, 40).join('\n  ')}`)
})

test('the same sweep names each shape of a sim running another  [M4 / leg (d)]', () => {
  const one = [
    ["execFileSync(process.execPath, ['fleet/tests/test_fitness.mjs'])", 'a sim named in the call'],
    ["execFileSync('python3', ['-m', 'pytest'])", 'a shell-out to pytest'],
    ["for (const name of ['test_fitness.mjs']) {\n  execFileSync(process.execPath, [path.join(TESTS_DIR, name)]) }",
      'a sim named by the list the argv walks'],
  ]
  for (const [source, why] of one) {
    const r = sweep(source, { file: '<case>' })
    assert.equal(r.siblings.length, 1,
      `(d) [M4] one offender for ${why}: ${JSON.stringify(source)} gave ${JSON.stringify(named(r.siblings))}`)
  }
  const copy = "const copy = copyWithProbe(simName, probe)\nspawnSync(process.execPath, [copy])"
  const r = sweep(copy, { file: '<case>' })
  assert.deepEqual(named(r.siblings), [],
    '(d) [M4] and none for a mutated copy of a sim\'s own text under the temp root — resolved one ' +
    'level, copyWithProbe(simName, probe) carries no literal, and that pin is not a sibling run')
})

// ── (e) the nine sites, each replaced by a name read and not run  [M4] ───────

/** The nine nested sites at BASE and the siblings each one ran. */
const NESTED_AT_BASE = [
  ['test_run_engine_candidate_bootstrap.mjs', ['test_run_engine_reconcile.mjs', 'test_run_engine_exam_together.mjs']],
  ['test_sandbox_boot_render_env.mjs', ['test_sandbox_boot.mjs', 'test_sandbox_boot_effort.mjs', 'test_sandbox_boot_state_exams.mjs']],
  ['test_sandbox_boot_state_exams.mjs', ['test_sandbox_boot.mjs', 'test_sandbox_boot_approval_evidence.mjs']],
  ['test_launch_render.mjs', ['test_launch.mjs', 'test_launch_pins.mjs']],
  ['test_launch_test_command.mjs', ['test_launch.mjs', 'test_launch_hold.mjs', 'test_launch_effort.mjs', 'test_launch_engine_source.mjs', 'test_launch_reaps.mjs']],
  ['test_setup_script_render_env.mjs', ['test_setup_script.mjs']],
  ['test_run_engine_exam_evidence.mjs', ['test_run_engine_examiner.mjs', 'test_run_engine_exam_edits.mjs']],
  ['test_run_engine_state_exams.mjs', ['test_run_engine_exam_evidence.mjs', 'test_run_engine_pre_review.mjs', 'test_run_engine_proof_runs.mjs', 'test_run_engine_integrated_runs.mjs']],
]

for (const [file, siblings] of NESTED_AT_BASE) {
  test(`${file} reads its sibling list and runs none of it  [M4 / leg (e)]`, () => {
    const full = path.join(TESTS_DIR, file)
    assert.ok(fs.existsSync(full), `(e) [M4] ${file} is a sim of this pre-flight`)
    const result = TREE[SWEPT.indexOf(file)]
    assert.deepEqual(named(result.siblings), [],
      `(e) [M4] ${file} carries no spawn whose argv names a test_*.mjs: ${JSON.stringify(named(result.siblings))}`)
    const checked = namesCheckedForExistence(result.src)
    const missing = siblings.filter((name) => ![...checked].some((q) => q.endsWith(name)))
    assert.deepEqual(missing, [],
      `(e) [M4] and every sibling it used to run survives as a name it checks exists under ` +
      `fleet/tests/ — an fs.existsSync on the repo path, so the list is read and never run. ` +
      `Unnamed: ${JSON.stringify(missing)}; named: ${JSON.stringify([...checked].filter((q) => q.includes('test_')))}`)
    for (const name of siblings) {
      assert.ok(fs.existsSync(path.join(TESTS_DIR, name)),
        `(e) [M4] ${name} is a file under fleet/tests/ for the bridge to dispatch`)
    }
  })
}

test('test_referee_linker.mjs drops the pytest shell-out and keeps its source pins  [M4 / leg (e)]', () => {
  const file = 'test_referee_linker.mjs'
  const full = path.join(TESTS_DIR, file)
  assert.ok(fs.existsSync(full), `(e) [M4] ${file} is a sim of this pre-flight`)
  const result = TREE[SWEPT.indexOf(file)]
  assert.deepEqual(named(result.siblings), [],
    `(e) [M4] ${file} carries no spawn whose argv names pytest: ${JSON.stringify(named(result.siblings))}`)
  const text = fs.readFileSync(full, 'utf8')
  assert.ok(text.includes('tests/test_compile_plan.py') || text.includes("'test_compile_plan.py'"),
    '(e) [M4] and it still reads tests/test_compile_plan.py as text')
  assert.ok(text.includes('test_placeholder_token_set'),
    '(e) [M4] for its test_placeholder_token_set pins')
  assert.ok(fs.existsSync(path.join(ROOT, 'tests', 'test_compile_plan.py')),
    '(e) [M4] and that file is where the pins read it')
})

// ── (f) the probe spawns nothing  [M7] ───────────────────────────────────────

test('the probe imports nothing from child_process  [M7 / leg (f)]', () => {
  const own = fs.readFileSync(path.join(TESTS_DIR, SELF), 'utf8')
  const CP = ['child', 'process'].join('_')
  const forms = [
    ['an import', new RegExp(`(^|[\\n;])\\s*import\\b[^\\n]*from\\s*['"](?:node:)?${CP}['"]`)],
    ['a bare import', new RegExp(`(^|[\\n;])\\s*import\\s*['"](?:node:)?${CP}['"]`)],
    ['a dynamic import', new RegExp(`import\\s*\\(\\s*['"](?:node:)?${CP}['"]`)],
    ['a require', new RegExp(`require\\s*\\(\\s*['"](?:node:)?${CP}['"]`)],
  ]
  for (const [what, re] of forms) {
    assert.equal(re.test(own), false,
      `(f) [M7] the probe reads source and runs nothing — it carries ${what} of ${CP}`)
  }
})

// ── (g) the fixture, one offender per rule  [M7] ─────────────────────────────

test('the fixture is swept to exactly three offenders, one per rule  [M7 / leg (g)]', () => {
  assert.ok(fs.existsSync(FIXTURE),
    '(g) [M7] fleet/tests/fixtures/hermetic/leaky_sim.mjs is the fixture that proves the sweep can ' +
    'still fail — a probe that names nothing anywhere proves nothing')
  const text = fs.readFileSync(FIXTURE, 'utf8')
  const r = sweep(text, { file: 'fixtures/hermetic/leaky_sim.mjs' })
  assert.equal(r.inherit.length, 1,
    `(g) [M7] one inheriting spawn: ${JSON.stringify(named(r.inherit))}`)
  assert.equal(r.absolute.length, 1,
    `(g) [M7] one absolute read: ${JSON.stringify(named(r.absolute))}`)
  assert.equal(r.siblings.length, 1,
    `(g) [M7] one sibling-sim spawn: ${JSON.stringify(named(r.siblings))}`)
  assert.equal(r.inherit.length + r.absolute.length + r.siblings.length, 3,
    '(g) [M7] and three namings in all, one per rule')
  assert.match(r.absolute[0].why, /\/etc\/fleet\/render\.env/,
    `(g) [M7] the absolute read is of /etc/fleet/render.env: ${r.absolute[0].why}`)

  const flat = text.replace(/\s+/g, ' ')
  const PINS = [
    "spawnSync('bash', ['-c', 'true'], { env: { ...process.env } })",
    "fs.readFileSync('/etc/fleet/render.env', 'utf8')",
    "spawnSync(process.execPath, ['fleet/tests/test_fitness.mjs'], { env: simEnv() })",
  ]
  for (const pin of PINS) {
    assert.ok(flat.includes(pin),
      `(g) [M7] the fixture carries this text verbatim, so the sweep is read against a known ` +
      `source: ${pin}`)
  }
  assert.equal(path.basename(FIXTURE).startsWith('test_'), false,
    '(g) [M7] and the fixture is never collected by the bridge — its name does not match test_*.mjs')
  assert.equal(SWEPT.includes(path.basename(FIXTURE)), false,
    '(g) [M7] nor swept as a sim of the tree')
})

// ── (h) the bridge hands each sim its environment  [M6] ──────────────────────

test('tests/test_fleet_suite.py binds env=sim_env() on the node it runs  [M6 / leg (h)]', () => {
  assert.ok(fs.existsSync(BRIDGE), '(h) [M6] tests/test_fleet_suite.py is the bridge')
  const text = fs.readFileSync(BRIDGE, 'utf8')
  assert.match(text, /^def sim_env\(/m,
    '(h) [M6] the bridge exports sim_env() as a module-level function beside collect_sims')
  const calls = []
  const re = /subprocess\.run\(\s*\[\s*["']node["']/g
  let m
  while ((m = re.exec(text)) !== null) {
    const open = text.indexOf('(', m.index)
    let depth = 0
    let end = open
    for (let i = open; i < text.length; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') { depth--; if (depth === 0) { end = i; break } }
    }
    calls.push(text.slice(m.index, end + 1))
  }
  assert.ok(calls.length >= 1,
    '(h) [M6] the bridge dispatches each sim with subprocess.run(["node", path], …)')
  for (const call of calls) {
    assert.match(call, /env=sim_env\(\)/,
      `(h) [M6] and hands that sim the environment sim_env() returns: ${call.replace(/\s+/g, ' ')}`)
  }

  const body = text.slice(text.search(/^def sim_env\(/m))
  const end = body.slice(1).search(/^(def |@|class )/m)
  const fn = end === -1 ? body : body.slice(0, end + 1)
  for (const prefix of DROPPED) {
    assert.ok(fn.includes(prefix),
      `(h) [M6] sim_env() drops the same six prefixes as the rig, ${prefix} among them`)
  }
  assert.ok(fn.includes('FLEET_TEST_SLACK'),
    '(h) [M6] and keeps FLEET_TEST_SLACK by name — the one FLEET_ name that is a rig knob and not a fleet fact')
  for (const tool of TOOLS) {
    assert.ok(fn.includes(tool),
      `(h) [M6] and builds PATH from the same interpreters, ${tool} among them`)
  }
})

// ── (i) the boot script names the box's file once, as a default  [M5] ────────

test('fleet/sandbox-boot.sh names /etc/fleet/render.env once, as its default  [M5 / leg (i)]', () => {
  assert.ok(fs.existsSync(BOOT_SCRIPT), '(i) [M5] fleet/sandbox-boot.sh is the boot the rig drives')
  const lines = fs.readFileSync(BOOT_SCRIPT, 'utf8').split('\n')
  const hits = lines.filter((l) => l.includes('/etc/fleet/render.env'))
  assert.equal(hits.length, 1,
    `(i) [M5] exactly one line names /etc/fleet/render.env — a boot that opened the box's file by ` +
    `its own path would put a second there: ${JSON.stringify(hits)}`)
  assert.equal(hits[0].trim(), 'FLEET_RENDER_ENV="${FLEET_RENDER_ENV:-/etc/fleet/render.env}"',
    `(i) [M5] and that line is the default the rig overrides: ${JSON.stringify(hits[0].trim())}`)
})

test('the boot rig pins FLEET_RENDER_ENV under every case\'s own home  [M5 / leg (i)]', () => {
  assert.ok(fs.existsSync(BOOT_HELPERS), '(i) [M5] fleet/tests/_sandbox_boot_helpers.mjs is the boot rig')
  const src = scan(fs.readFileSync(BOOT_HELPERS, 'utf8'))
  const bootEnv = bindingOf(src, 'bootEnv')
  assert.ok(bootEnv, '(i) [M5] the rig hands every boot one bootEnv')
  const body = src.code.slice(bootEnv.start, bootEnv.end)
  assert.match(body, /FLEET_RENDER_ENV\s*:\s*renderEnvPath\(ctx\)/,
    `(i) [M5] which pins FLEET_RENDER_ENV to the case's own render.env, so no boot falls to the ` +
    `box's default path: ${body.replace(/\s+/g, ' ').slice(0, 200)}`)
  const renderEnvPath = bindingOf(src, 'renderEnvPath')
  assert.ok(renderEnvPath, '(i) [M5] and renderEnvPath is the rig\'s own')
  assert.match(src.code.slice(renderEnvPath.start, renderEnvPath.end), /ctx\.home/,
    "(i) [M5] under the case's own home")
})

// ── the sentinel ─────────────────────────────────────────────────────────────

let failures = 0
for (const [name, fn] of tests) {
  const started = Date.now()
  try {
    fn()
    console.log(`ok (${Date.now() - started} ms) — ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL — ${name}`)
    console.log(String(error && error.stack ? error.stack : error))
  }
}
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
console.log(`ALL TESTS PASSED (${SWEPT.length} sims swept, 0 offenders)`)
