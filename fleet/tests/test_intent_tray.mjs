/**
 * fleet/tests/test_intent_tray.mjs — the exam for `hooks/register.js`, the
 * intent tray mod (#1495, #1526).
 *
 * The module runs inside Claude Code, which this sim does not have. It is
 * imported under Node and driven through a stand-in `$` that offers only the
 * calls the tray may make, each refusing a shape the hooks API types refuse
 * (the plugin-authoring skill's `types/claude-code.d.ts`, Claude Code 2.1.286):
 * an unknown `$` noun throws, a Button hotkey other than one digit or one
 * lowercase letter throws, a value `$.store` cannot keep as JSON throws.
 * Each `load()` imports a fresh copy of the module (a query string on the
 * URL), so one copy is one session; copies sharing a `store` Map are sessions
 * sharing the plugin's one store file.
 *
 * Legs:
 *   (z) the stand-in refuses wrong shapes
 *   (a) Send clears the screen; the band is hidden after it
 *   (b) Clear clears the screen; the band is hidden after it
 *   (c) the tray is kept per working directory; the old global `tray` key is ignored
 *   (d) band buttons carry no bare-digit hotkey: n, s, c
 *   (e) feedback is read by byte offset, only up to the last newline
 *   (f) a repo's feedback history from before the first session is not taken
 *   (g) a second repo's feedback is read from its own offset
 *   (h) two sessions in one repo take a feedback line once
 *   (i) a dropped or failed submit keeps the tray
 *   (j) the README's tray section names no digit hotkey for the band
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const MODULE = new URL('../../hooks/register.js', import.meta.url).href
const FEED = '.ultrapowers/feedback.jsonl'
const PASSED = Symbol('next')

let copies = 0
async function load() {
  copies += 1
  return import(`${MODULE}?session=${copies}`)
}

// ── the stand-in $ ───────────────────────────────────────────────────────

function strict(obj, where) {
  return new Proxy(obj, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return target[prop]
      if (!(prop in target)) throw new Error(`stand-in: $${where}.${prop} is not offered`)
      return target[prop]
    },
  })
}

function onlyKeys(o, allowed, what) {
  assert.ok(o && typeof o === 'object' && !Array.isArray(o), `${what}: takes one object`)
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw new Error(`${what}: unknown field ${k}`)
  }
}

function jsonValue(v, what) {
  const text = JSON.stringify(v)
  if (text === undefined) throw new Error(`${what}: not JSON data`)
  const walk = (x) => {
    if (typeof x === 'function' || typeof x === 'symbol' || typeof x === 'bigint') throw new Error(`${what}: not JSON data`)
    if (x && typeof x === 'object') for (const y of Object.values(x)) walk(y)
  }
  walk(v)
  return text
}

const isHotkey = (h) => h === undefined || /^[0-9a-z]$/.test(h)

function elements() {
  const children = (p, what) => {
    if (p.children === undefined) return
    assert.ok(Array.isArray(p.children), `${what}: children is an array`)
  }
  return {
    Box: (p) => {
      onlyKeys(p, ['key', 'flexDirection', 'children'], 'Box')
      assert.equal(typeof p.key, 'string', 'Box: key')
      assert.ok(p.flexDirection === undefined || ['row', 'column'].includes(p.flexDirection), 'Box: flexDirection')
      children(p, 'Box')
      return { type: 'Box', props: p }
    },
    Text: (p) => {
      onlyKeys(p, ['key', 'children', 'dimColor', 'bold'], 'Text')
      children(p, 'Text')
      return { type: 'Text', props: p }
    },
    Button: (p) => {
      onlyKeys(p, ['key', 'label', 'hotkey', 'onPress', 'children', 'plain', 'action'], 'Button')
      assert.equal(typeof p.key, 'string', 'Button: key')
      if (!isHotkey(p.hotkey)) throw new Error(`Button: hotkey ${JSON.stringify(p.hotkey)} is refused`)
      assert.equal(typeof p.onPress, 'function', 'Button: onPress')
      children(p, 'Button')
      return { type: 'Button', props: p }
    },
    Input: (p) => {
      onlyKeys(p, ['key', 'label', 'placeholder', 'value', 'submitLabel', 'autoFocus', 'onInput', 'onSubmit'], 'Input')
      assert.equal(typeof p.key, 'string', 'Input: key')
      assert.equal(typeof p.onSubmit, 'function', 'Input: onSubmit')
      assert.ok(p.autoFocus === undefined || p.autoFocus === true, 'Input: autoFocus is true or absent')
      return { type: 'Input', props: p }
    },
  }
}

/** One host: a store (shared between sessions when passed in), a file system
 *  of absolute path → text, and how `prompt.submit` answers. */
function host({ store = new Map(), files = new Map(), submit = 'ok' } = {}) {
  const h = { store, files, submits: [], opens: [], ticks: [], submit }
  const missing = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
  h.$ = strict({
    store: strict({
      get: async (k) => {
        assert.equal(typeof k, 'string', 'store.get: key')
        return store.has(k) ? JSON.parse(store.get(k)) : undefined
      },
      set: async (k, v) => {
        assert.equal(typeof k, 'string', 'store.set: key')
        store.set(k, jsonValue(v, 'store.set'))
      },
      delete: async (k) => { store.delete(k) },
      keys: async () => [...store.keys()],
    }, '.store'),
    fs: strict({
      read: async (p, opts) => {
        assert.equal(typeof p, 'string', 'fs.read: path')
        assert.ok(opts === undefined || (opts && (opts.as === 'text' || opts.as === 'bytes')), 'fs.read: options')
        if (!files.has(p)) throw missing(p)
        const text = files.get(p)
        if (opts && opts.as === 'bytes') return { base64: Buffer.from(text, 'utf8').toString('base64') }
        return text
      },
      stat: async (p) => {
        assert.equal(typeof p, 'string', 'fs.stat: path')
        if (!files.has(p)) throw missing(p)
        return { kind: 'file', size: Buffer.byteLength(files.get(p), 'utf8'), mtimeMs: 1, isLink: false }
      },
      exists: async (p) => files.has(p),
    }, '.fs'),
    ui: strict({
      invalidate: (...a) => { assert.equal(a.length, 0, 'ui.invalidate takes nothing') },
      open: async (o) => {
        onlyKeys(o, ['id', 'title', 'focus', 'closeOnEscape', 'holdToasts', 'rows'], 'ui.open')
        assert.equal(typeof o.id, 'string', 'ui.open: id')
        assert.ok(o.focus === undefined || o.focus === true, 'ui.open: focus is true or absent')
        h.opens.push(o)
        return { isPlaced: true }
      },
      resolve: () => elements(),
      toast: (t) => { assert.equal(typeof t, 'string', 'ui.toast: text') },
    }, '.ui'),
    prompt: strict({
      submit: async (o) => {
        onlyKeys(o, ['text', 'context'], 'prompt.submit')
        assert.equal(typeof o.text, 'string', 'prompt.submit: text')
        h.submits.push(o.text)
        if (h.submit === 'throw') throw new Error('submit refused')
        if (h.submit === 'drop') return { drop: 'a hook refused it' }
        return { text: o.text }
      },
    }, '.prompt'),
    command: strict({
      register: async (o) => {
        onlyKeys(o, ['name', 'description', 'argumentHint', 'immediate'], 'command.register')
        assert.match(o.name, /^[a-z][a-z0-9-]*$/, 'command.register: name')
        assert.equal(typeof o.description, 'string', 'command.register: description')
        assert.ok(o.immediate === undefined || o.immediate === true, 'command.register: immediate')
      },
    }, '.command'),
    tool: strict({
      register: async (o) => {
        onlyKeys(o, ['name', 'description', 'inputSchema'], 'tool.register')
        assert.equal(typeof o.name, 'string', 'tool.register: name')
        assert.equal(typeof o.description, 'string', 'tool.register: description')
      },
    }, '.tool'),
    clock: strict({
      every: (ms, fn) => {
        assert.ok(typeof ms === 'number' && ms >= 1, 'clock.every: ms')
        assert.equal(typeof fn, 'function', 'clock.every: fn')
        h.ticks.push(fn)
        return { cancel() {} }
      },
    }, '.clock'),
  }, '')
  return h
}

/** One session: a fresh copy of the module on a host, started in `cwd`. */
async function session(h, cwd) {
  const { register } = await load()
  const hooks = []
  register((ev, a, b) => {
    assert.equal(typeof ev, 'string', 'on: event name')
    hooks.push(b ? { ev, match: a, fn: b } : { ev, match: {}, fn: a })
  })
  const fire = async (ev, e) => {
    const mine = hooks.filter((x) => x.ev === ev && Object.entries(x.match).every(([k, v]) => e[k] === v))
    let i = 0
    const next = async (x) => (i < mine.length ? mine[i++].fn(h.$, x, next) : PASSED)
    return next(e)
  }
  const ticksBefore = h.ticks.length
  await fire('session.start', { cwd })
  const tick = h.ticks[ticksBefore]
  assert.equal(typeof tick, 'function', 'session.start starts one clock.every')
  const s = {
    fire,
    tick: () => tick(),
    pane: () => fire('ui.render', { component: 'Pane', requestId: 'intent-tray' }),
    band: () => fire('ui.render', { component: 'AbovePrompt' }),
    show: (input) => fire('tool.call', { tool: 'mcp__ultrapowers__show_screen', input }),
  }
  return s
}

function find(n, key) {
  if (!n || typeof n !== 'object') return undefined
  if (n.props && n.props.key === key) return n
  for (const c of [].concat((n.props && n.props.children) || [])) {
    const x = find(c, key)
    if (x) return x
  }
  return undefined
}

function buttons(n, out = []) {
  if (!n || typeof n !== 'object') return out
  if (n.type === 'Button') out.push(n.props)
  for (const c of [].concat((n.props && n.props.children) || [])) buttons(c, out)
  return out
}

const label = (band) => (band === PASSED ? 'hidden' : String(find(band, 'band-label').props.children[0]))
const feed = (cwd) => `${cwd}/${FEED}`
const line = (o) => JSON.stringify(o) + '\n'
const press = async (s, where, key) => {
  const tree = where === 'band' ? await s.band() : await s.pane()
  const node = find(tree, key)
  assert.ok(node, `${where} has ${key}`)
  return node.props.onPress ? node.props.onPress() : undefined
}

// (z) the stand-in refuses wrong shapes
{
  const h = host()
  assert.throws(() => h.$.session, /not offered/, '(z) an unknown $ noun throws')
  assert.throws(() => elements().Button({ key: 'k', hotkey: '12', onPress() {} }), /refused/, '(z) a two-character hotkey is refused')
  assert.throws(() => elements().Button({ key: 'k', hotkey: 'S', onPress() {} }), /refused/, '(z) an uppercase hotkey is refused')
  await assert.rejects(h.$.store.set('k', { f() {} }), /not JSON/, '(z) a function is not JSON data')
  await assert.rejects(h.$.ui.open({ id: 'x', focus: false }), /focus/, '(z) focus is true or absent')
  await assert.rejects(h.$.fs.read('/nowhere/x'), /ENOENT/, '(z) a missing file rejects')
}

// (a) Send clears the screen; the band is hidden after it
{
  const h = host()
  const s = await session(h, '/work/a')
  await s.show({ name: 'Todo list', stage: 'how it looks', versions: ['A', 'B'] })
  assert.equal(label(await s.band()), 'Intent tray: Todo list, 0 items', '(a) the band shows once a screen is shown')
  await press(s, 'pane', 'pick-B')
  await press(s, 'band', 'band-send')
  assert.equal(h.submits.length, 1, '(a) Send submits one prompt')
  assert.equal(label(await s.band()), 'hidden', '(a) after Send the band is hidden')
  assert.equal(String(find(await s.pane(), 'screen').props.children[0]), 'No screen shown', '(a) after Send the pane shows no screen')
}

// (b) Clear clears the screen; the band is hidden after it
{
  const h = host()
  const s = await session(h, '/work/a')
  await s.show({ name: 'Todo list', versions: ['A', 'B'] })
  await find(await s.pane(), 'view-note').props.onSubmit('feels cramped')
  await press(s, 'band', 'band-clear')
  assert.equal(h.submits.length, 0, '(b) Clear submits nothing')
  assert.equal(label(await s.band()), 'hidden', '(b) after Clear the band is hidden')
}

// (c) the tray is kept per working directory; the old global `tray` key is ignored
{
  const store = new Map([['tray', JSON.stringify({ screen: { name: 'Old', stage: '', versions: [], url: '' }, pick: null, notes: [], taken: 0 })]])
  const a = await session(host({ store }), '/work/a')
  await a.show({ name: 'Todo list', versions: ['A'] })
  await find(await a.pane(), 'view-note').props.onSubmit('feels cramped')
  const b = await session(host({ store }), '/work/b')
  assert.equal(label(await b.band()), 'hidden', '(c) a session in another repo shows no band')
  const a2 = await session(host({ store }), '/work/a')
  assert.equal(label(await a2.band()), 'Intent tray: Todo list, 1 item', '(c) a later session in the same repo gets its tray back')
}

// (d) band buttons carry no bare-digit hotkey
{
  const s = await session(host(), '/work/a')
  await s.show({ name: 'Todo list', versions: ['A', 'B'] })
  const keys = buttons(await s.band()).map((b) => `${b.key}=${b.hotkey}`)
  assert.deepEqual(keys, ['band-note=n', 'band-send=s', 'band-clear=c'], '(d) band hotkeys are n, s, c')
}

// (e) feedback is read by byte offset, only up to the last newline
{
  const h = host()
  const s = await session(h, '/work/a')
  await s.show({ name: 'Todo list', versions: ['A'] })
  h.files.set(feed('/work/a'), line({ note: 'café ☕ first' }) + '{"note":"sec')
  await s.tick()
  assert.equal(label(await s.band()), 'Intent tray: Todo list, 1 item', '(e) a half-written line is not taken yet')
  h.files.set(feed('/work/a'), h.files.get(feed('/work/a')) + 'ond"}\n')
  await s.tick()
  assert.equal(label(await s.band()), 'Intent tray: Todo list, 2 items', '(e) the line is taken once it ends')
  await press(s, 'band', 'band-send')
  assert.match(h.submits[0], /"note":"second"/, '(e) the completed line reads whole')
  assert.match(h.submits[0], /"note":"café ☕ first"/, '(e) a multibyte line reads whole')
  await s.tick()
  assert.equal(label(await s.band()), 'hidden', '(e) nothing is taken twice')
}

// (f) a repo's feedback history from before the first session is not taken
{
  const h = host()
  h.files.set(feed('/work/a'), line({ note: 'old one' }) + line({ note: 'old two' }))
  const s = await session(h, '/work/a')
  await s.tick()
  assert.equal(label(await s.band()), 'hidden', '(f) old lines are history, not feedback')
  h.files.set(feed('/work/a'), h.files.get(feed('/work/a')) + line({ note: 'new' }))
  await s.tick()
  assert.equal(label(await s.band()), 'Intent tray: feedback, 1 item', '(f) a line written after the start is taken')
}

// (g) a second repo's feedback is read from its own offset
{
  const store = new Map()
  const ha = host({ store })
  const a = await session(ha, '/work/a')
  ha.files.set(feed('/work/a'), line({ note: 'one' }) + line({ note: 'two' }))
  await a.tick()
  assert.equal(label(await a.band()), 'Intent tray: feedback, 2 items', '(g) repo a takes its two lines')
  const hb = host({ store })
  const b = await session(hb, '/work/b')
  hb.files.set(feed('/work/b'), line({ note: 'only' }))
  await b.tick()
  assert.equal(label(await b.band()), 'Intent tray: feedback, 1 item', '(g) repo b takes its own line')
}

// (h) two sessions in one repo take a feedback line once
{
  const store = new Map()
  const files = new Map()
  const a = await session(host({ store, files }), '/work/a')
  const b = await session(host({ store, files }), '/work/a')
  files.set(feed('/work/a'), line({ note: 'once' }))
  await a.tick()
  await b.tick()
  const held = [label(await a.band()), label(await b.band())]
  assert.deepEqual(held, ['Intent tray: feedback, 1 item', 'hidden'], '(h) the line is taken by one session only')
}

// (i) a dropped or failed submit keeps the tray
for (const mode of ['drop', 'throw']) {
  const h = host({ submit: mode })
  const s = await session(h, '/work/a')
  await s.show({ name: 'Todo list', versions: ['A', 'B'] })
  await press(s, 'pane', 'pick-A')
  await find(await s.pane(), 'view-note').props.onSubmit('feels cramped')
  await press(s, 'band', 'band-send')
  assert.equal(h.submits.length, 1, `(i ${mode}) Send tried once`)
  assert.equal(label(await s.band()), 'Intent tray: Todo list, 2 items', `(i ${mode}) the pick and the note are kept`)
  h.submit = 'ok'
  await press(s, 'band', 'band-send')
  assert.equal(label(await s.band()), 'hidden', `(i ${mode}) a later Send that enters clears the tray`)
}

// (j) the README's tray section names no digit hotkey for the band
{
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  const section = readme.split('## The intent tray')[1].split('\n## ')[0]
  assert.ok(!/\(`[0-9]`\)/.test(section), '(j) the README pins no digit hotkey on a band button')
  assert.ok(/\*\*Add note\*\* \(`n`\)/.test(section) && /\*\*Send\*\* \(`s`\)/.test(section) && /\*\*Clear\*\*\s+\(`c`\)/.test(section),
    '(j) the README names the band hotkeys n, s and c')
}

console.log('ALL TESTS PASSED')
