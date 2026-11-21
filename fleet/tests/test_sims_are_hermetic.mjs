import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TESTS_DIR = HERE
const SELF = 'test_sims_are_hermetic.mjs'
const HELPERS = path.join(TESTS_DIR, '_helpers.mjs')
const FIXTURE = path.join(TESTS_DIR, 'fixtures', 'hermetic', 'leaky_sim.mjs')

let helpers = null
let helpersError = null
try {
  helpers = await import('./_helpers.mjs')
} catch (error) {
  helpersError = error
}

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof',
  'do', 'else', 'yield', 'await',
])

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

const SPAWN_NAMES = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']

const READ_NAMES = ['readFileSync', 'readFile', 'existsSync', 'statSync', 'lstatSync',
  'realpathSync', 'readdirSync', 'readdir', 'accessSync', 'access', 'openSync', 'open',
  'createReadStream', 'copyFileSync', 'stat']

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

const PROCESS_ENV_RE = /(?:^|\.\.\.|[^\w$.])process\s*\.\s*env\b/
const SIM_ENV_RE = /(?:^|\.\.\.|[^\w$.])simEnv\s*\(/

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

const isSwept = (n) => n.endsWith('.mjs') && (n.startsWith('test_') || n.startsWith('_'))

const sweptNames = (dir, self = SELF) =>
  fs.readdirSync(dir).filter((n) => isSwept(n) && n !== self).sort()

const SWEPT = sweptNames(TESTS_DIR)

const cache = new Map()
const sourceOf = (name) => {
  if (!cache.has(name)) {
    const full = path.join(TESTS_DIR, name)
    cache.set(name, fs.existsSync(full) ? scan(fs.readFileSync(full, 'utf8')) : null)
  }
  return cache.get(name)
}

const importerFor = (src, file = '') => {
  const map = new Map()
  const base = path.posix.dirname(file)
  const re = /import\s*\{([^}]*)\}\s*from\s*(['"])((?:\.\/|\.\.\/\.\.\/)_[A-Za-z0-9_]+\.mjs)\2/g
  let m
  while ((m = re.exec(src.code)) !== null) {
    const target = path.posix.normalize(path.posix.join(base, m[3]))
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (name) map.set(name, target)
    }
  }
  return (ident) => (map.has(ident) ? sourceOf(map.get(ident)) : null)
}

const TREE = SWEPT.map((name) => {
  const text = fs.readFileSync(path.join(TESTS_DIR, name), 'utf8')
  const src = scan(text)
  return sweep(text, { file: name, resolveImport: importerFor(src, name) })
})
const treeOffenders = (kind) => TREE.flatMap((r) => r[kind])

const tests = []
const test = (name, fn) => { tests.push([name, fn]) }

const PLANT = {
  ULTRA_PLANTED: '1',
  TINYAPP_BROWSER: '/planted/chrome',
  FLEET_PLANTED: '/planted/file',
  CLAUDE_CONFIG_DIR: 'planted-config',
  GH_TOKEN: 'planted',
  ANTHROPIC_API_KEY: 'planted',
}
const DROPPED = ['ULTRA_', 'TINYAPP_', 'FLEET_', 'ANTHROPIC_', 'CLAUDE_', 'GH_']
const TOOLS = ['node', 'python3', 'git', 'bash', 'sh']

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
  withPlant({}, () => {
    const e = simEnv()
    for (const key of Object.keys(PLANT)) {
      assert.equal(key in e, false,
        `(a) [M1] ${key} is planted on the parent and must not be in what simEnv() hands a child — ` +
        `got ${JSON.stringify(e[key])}`)
    }
    const own = new Set(['PATH', 'HOME', 'TMPDIR', 'FLEET_HOME'])
    const leaked = Object.keys(e).filter((k) => DROPPED.some((p) => k.startsWith(p)) && !own.has(k))
    assert.deepEqual(leaked, [],
      `(a) [M1] no key of the parent beginning ${DROPPED.join(', ')} survives: ${JSON.stringify(leaked)}`)
    assert.deepEqual(Object.keys(e).sort(), ['FLEET_HOME', 'HOME', 'PATH', 'TMPDIR'],
      `(a) [M1] the keys simEnv() sets itself are PATH, HOME, TMPDIR and FLEET_HOME — ` +
      `no key of the parent reaches a child: ${JSON.stringify(Object.keys(e).sort())}`)
  })
})

test('a planted FLEET_HOME is the parent\'s, and never the child\'s  [M1 / leg (a)]', () => {
  const simEnv = simEnvOrThrow()
  withPlant({ FLEET_HOME: '/planted/home', HOME: '/planted/home' }, () => {
    const e = simEnv()
    assert.notEqual(e.FLEET_HOME, '/planted/home',
      "(a) [M1] FLEET_HOME is minted under the rig's own home, not read off the parent")
    assert.notEqual(e.HOME, '/planted/home', '(a) [M1] and so is HOME')
    assert.ok(e.HOME.startsWith(fs.realpathSync(TMP)) || e.HOME.startsWith(TMP),
      `(a) [M1] under os.tmpdir(): ${e.HOME}`)
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

test('the sweep names zero inheriting spawns in fleet/tests/  [M2 / leg (b)]', () => {
  const definedOver = fs.readdirSync(TESTS_DIR).filter((n) => isSwept(n) && n !== SELF)
  assert.deepEqual(SWEPT, [...definedOver].sort(),
    `(b) [M2] the sweep reads every fleet/tests/test_*.mjs and _*.mjs but this file — ` +
    `not a file fewer: ${JSON.stringify(SWEPT)}`)
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
  assert.match(r.absolute[0].why, /\/etc\/fleet\/planted\.env/,
    `(g) [M7] the absolute read is of /etc/fleet/planted.env: ${r.absolute[0].why}`)

  assert.equal(path.basename(FIXTURE).startsWith('test_'), false,
    '(g) [M7] and the fixture is never collected by the bridge — its name does not match test_*.mjs')
  assert.equal(SWEPT.includes(path.basename(FIXTURE)), false,
    '(g) [M7] nor swept as a sim of the tree')
})

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
