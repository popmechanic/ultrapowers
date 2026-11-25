import assert from 'node:assert/strict'

const MODULE = new URL('../../hooks/register.js', import.meta.url).href
const FEED = '.ultrapowers/feedback.jsonl'
const PASSED = Symbol('next')

let copies = 0
async function load() {
  copies += 1
  return import(`${MODULE}?session=${copies}`)
}

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

function host({ store = new Map(), files = new Map(), submit = 'ok' } = {}) {
  const h = { store, files, submits: [], opens: [], ticks: [], tools: [], submit }
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
        if (typeof h.submit === 'function') return h.submit(o)
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
        h.tools.push(o.name)
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
  assert.equal(h.ticks.length, ticksBefore, 'session.start starts no clock')
  const s = {
    fire,
    pane: () => fire('ui.render', { component: 'Pane', requestId: 'intent-tray' }),
    band: () => fire('ui.render', { component: 'AbovePrompt' }),
    hooks,
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
const note = (s, text) => find(s, 'view-note').props.onSubmit(text)
const press = async (s, where, key) => {
  const tree = where === 'band' ? await s.band() : await s.pane()
  const node = find(tree, key)
  assert.ok(node, `${where} has ${key}`)
  return node.props.onPress ? node.props.onPress() : undefined
}

{
  const h = host()
  assert.throws(() => h.$.session, /not offered/, '(z) an unknown $ noun throws')
  assert.throws(() => elements().Button({ key: 'k', hotkey: '12', onPress() {} }), /refused/, '(z) a two-character hotkey is refused')
  assert.throws(() => elements().Button({ key: 'k', hotkey: 'S', onPress() {} }), /refused/, '(z) an uppercase hotkey is refused')
  await assert.rejects(h.$.store.set('k', { f() {} }), /not JSON/, '(z) a function is not JSON data')
  await assert.rejects(h.$.ui.open({ id: 'x', focus: false }), /focus/, '(z) focus is true or absent')
  await assert.rejects(h.$.fs.read('/nowhere/x'), /ENOENT/, '(z) a missing file rejects')
}

{
  const h = host()
  const s = await session(h, '/work/a')
  await find(await s.pane(), 'view-note').props.onSubmit('feels cramped')
  assert.equal(label(await s.band()), 'Intent tray: feedback, 1 item', '(a) the band shows once a note is added')
  await press(s, 'band', 'band-send')
  assert.equal(h.submits.length, 1, '(a) Send submits one prompt')
  assert.match(h.submits[0], /^Feedback from the intent tray:\n\n/, '(a) the prompt opens with the tray heading')
  assert.match(h.submits[0], /"note":"feels cramped"/, '(a) the note is sent')
  assert.equal(label(await s.band()), 'hidden', '(a) after Send the band is hidden')
  assert.equal(find(await s.pane(), 'screen'), undefined, '(a) the pane has no screen line')
}

{
  const h = host()
  const s = await session(h, '/work/a')
  assert.deepEqual(h.tools, [], '(a2) the tray registers no tool')
  assert.ok(!s.hooks.some((x) => x.ev === 'tool.call'), '(a2) the tray hooks no tool call')
  assert.equal(label(await s.band()), 'hidden', '(a2) with nothing in it the band is hidden')
}

{
  const h = host()
  const s = await session(h, '/work/a')
  await find(await s.pane(), 'view-note').props.onSubmit('feels cramped')
  await press(s, 'band', 'band-clear')
  assert.equal(h.submits.length, 0, '(b) Clear submits nothing')
  assert.equal(label(await s.band()), 'hidden', '(b) after Clear the band is hidden')
}

{
  const store = new Map([['tray', JSON.stringify({ screen: { name: 'Old', stage: '', versions: [], url: '' }, pick: null, notes: [], taken: 0 })]])
  const a = await session(host({ store }), '/work/a')
  await find(await a.pane(), 'view-note').props.onSubmit('feels cramped')
  const b = await session(host({ store }), '/work/b')
  assert.equal(label(await b.band()), 'hidden', '(c) a session in another repo shows no band')
  const a2 = await session(host({ store }), '/work/a')
  assert.equal(label(await a2.band()), 'Intent tray: feedback, 1 item', '(c) a later session in the same repo gets its tray back')
}

{
  const s = await session(host(), '/work/a')
  await find(await s.pane(), 'view-note').props.onSubmit('feels cramped')
  const keys = buttons(await s.band()).map((b) => `${b.key}=${b.hotkey}`)
  assert.deepEqual(keys, ['band-note=n', 'band-send=s', 'band-clear=c'], '(d) band hotkeys are n, s, c')
}

for (const mode of ['drop', 'throw']) {
  const h = host({ submit: mode })
  const s = await session(h, '/work/a')
  await find(await s.pane(), 'view-note').props.onSubmit('feels cramped')
  await press(s, 'band', 'band-send')
  assert.equal(h.submits.length, 1, `(i ${mode}) Send tried once`)
  assert.equal(label(await s.band()), 'Intent tray: feedback, 1 item', `(i ${mode}) the note is kept`)
  h.submit = 'ok'
  await press(s, 'band', 'band-send')
  assert.equal(label(await s.band()), 'hidden', `(i ${mode}) a later Send that enters clears the tray`)
}

{
  let enter
  const h = host({ submit: (o) => new Promise((done) => { enter = () => done({ text: o.text }) }) })
  const s = await session(h, '/work/a')
  await find(await s.pane(), 'view-note').props.onSubmit('feels cramped')
  const out = press(s, 'band', 'band-send')
  await new Promise((r) => setImmediate(r))
  assert.equal(h.submits.length, 1, '(k) the first Send is out')
  await press(s, 'band', 'band-send')
  assert.equal(h.submits.length, 1, '(k) a second Send while the first is out submits nothing')
  await find(await s.pane(), 'view-note').props.onSubmit('button "Add": too small')
  enter()
  await out
  assert.equal(label(await s.band()), 'Intent tray: feedback, 1 item', '(k) the sent note is cleared, the late note stays')
  const left = await s.pane()
  assert.equal(String(find(left, 'text-0').props.children[0]), '[element] button "Add": too small', '(k) the note that came in meanwhile stays')
  assert.doesNotMatch(h.submits[0], /too small/, '(k) the late note was not in the first Send')
  h.submit = 'ok'
  await press(s, 'pane', 'send')
  assert.equal(h.submits.length, 2, '(k) the next Send goes')
  assert.match(h.submits[1], /too small/, '(k) and carries the late note')
}

{
  const store = new Map()
  const files = new Map()
  const ha = host({ store, files })
  const a = await session(ha, '/work/a')
  const b = await session(host({ store, files }), '/work/a')
  await find(await a.pane(), 'view-note').props.onSubmit('from a')
  await find(await b.pane(), 'view-note').props.onSubmit('from b')
  const held = JSON.parse(store.get('tray:/work/a'))
  assert.deepEqual(held.notes.map((n) => n.note), ['from a', 'from b'], '(l) the second session kept the first one\'s note')
  await press(a, 'band', 'band-send')
  assert.match(ha.submits[0], /from a/, '(l) Send carries the first note')
  assert.match(ha.submits[0], /from b/, '(l) and the other session\'s note')
  await find(await b.pane(), 'view-note').props.onSubmit('later')
  const after = JSON.parse(store.get('tray:/work/a'))
  assert.deepEqual(after.notes.map((n) => n.note), ['later'], '(l) a sent note does not come back from a session that held it')
  assert.equal(label(await b.band()), 'Intent tray: feedback, 1 item', '(l) the other session drops the sent notes too')
}

{
  const store = new Map([['tray:/work/a', JSON.stringify({ pick: 'B', piece: 'todo', notes: [{ id: 'n1', kind: 'view', note: 'kept' }], gone: [], offset: 40, mark: 'x' })]])
  const h = host({ store })
  const s = await session(h, '/work/a')
  assert.equal(label(await s.band()), 'Intent tray: feedback, 1 item', '(p) a tray stored with a pick and a mark loads its notes only')
  await press(s, 'band', 'band-send')
  assert.doesNotMatch(h.submits[0], /pick/, '(p) the stored pick is not sent')
  const held = JSON.parse(store.get('tray:/work/a'))
  assert.deepEqual(Object.keys(held).sort(), ['gone', 'notes'], '(p) the next save drops the old keys')
}

{
  const h = host()
  const s = await session(h, '/work/a')
  h.files.set(feed('/work/a'), line({ kind: 'pick', chose: 'B' }) + line({ note: 'written by a page' }))
  for (const tick of h.ticks) await tick()
  assert.equal(label(await s.band()), 'hidden', '(o) a feedback file in the working directory is not read')
  assert.equal(find(await s.pane(), 'none').props.children[0], 'No notes yet', '(o) the tray stays empty')
}

console.log('ALL TESTS PASSED')
