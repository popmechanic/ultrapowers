/**
 * factory/pairs.mjs — the pair builder.
 *
 * For each pair of tasks that could meet, this module assembles the small
 * picture a judge needs (the two tasks, the outline of each file they
 * share, and which parts of it each task names), decides by itself when the
 * two plainly edit different parts of a shared file, and afterwards labels
 * the pair with what actually happened.
 *
 * Pure: touches neither disk nor git nor network. All file text comes in
 * through the caller-supplied `read(path)`, which may be async and answers
 * `''` for a file that does not exist.
 */

const MAX_OUTLINE_ENTRIES = 200
const MAX_STATE_BYTES = 60000

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── M1: outlineOf ────────────────────────────────────────────────────────

const extensionOf = (path) => {
  const m = String(path).match(/\.([^./\\]+)$/)
  return m ? m[1].toLowerCase() : ''
}

const codeOutline = (text) => {
  const reExport = /^export\s+(?:function|const|class)\s+([A-Za-z_$][\w$]*)/
  const reFunction = /^function\s+([A-Za-z_$][\w$]*)/
  const reConst = /^const\s+([A-Za-z_$][\w$]*)\s*=/
  const out = []
  for (const line of text.split('\n')) {
    const indentMatch = line.match(/^( *)/)
    const indent = indentMatch ? indentMatch[1].length : 0
    if (indent !== 0 && indent !== 2) continue
    const content = line.slice(indent)
    const m = content.match(reExport) || content.match(reFunction) || content.match(reConst)
    if (m) out.push({ name: m[1], kind: 'code' })
  }
  return out
}

const pyOutline = (text) => {
  const re = /^(?:def|class)\s+([A-Za-z_]\w*)/
  const out = []
  for (const line of text.split('\n')) {
    const m = line.match(re)
    if (m) out.push({ name: m[1], kind: 'code' })
  }
  return out
}

const mdOutline = (text) => {
  const re = /^(#{1,6})\s+(.*)$/
  const out = []
  for (const line of text.split('\n')) {
    const m = line.match(re)
    if (m) {
      const name = m[2].replace(/\s*#+\s*$/, '').trim()
      out.push({ name, kind: 'heading' })
    }
  }
  return out
}

const jsonOutline = (text) => {
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.keys(obj).map((name) => ({ name, kind: 'key' }))
    }
  } catch {
    // fall through to []
  }
  return []
}

export function outlineOf(text, path) {
  const ext = extensionOf(path)
  let entries
  if (ext === 'mjs' || ext === 'js' || ext === 'ts') entries = codeOutline(text)
  else if (ext === 'py') entries = pyOutline(text)
  else if (ext === 'md') entries = mdOutline(text)
  else if (ext === 'json') entries = jsonOutline(text)
  else entries = []
  return entries.slice(0, MAX_OUTLINE_ENTRIES)
}

// ── M2: pairState ────────────────────────────────────────────────────────

const afterMarker = (body, marker) => {
  const idx = String(body).indexOf(marker)
  if (idx === -1) return ''
  const rest = body.slice(idx + marker.length)
  const lineEnd = rest.indexOf('\n')
  const line = lineEnd === -1 ? rest : rest.slice(0, lineEnd)
  return line.trim()
}

const taskInfo = (task, withLegs) => {
  const info = {
    id: task.id,
    title: task.title,
    claim: afterMarker(task.body, '**Claim:**'),
    machine: task.clauses,
    interfaces: task.interfaces,
    files: task.files,
    context: afterMarker(task.body, '**Context:**'),
  }
  if (withLegs) info.legs = afterMarker(task.body, '- Legs:')
  return info
}

const backtickSpans = (body) => {
  const spans = []
  const re = /`([^`]*)`/g
  let m
  while ((m = re.exec(String(body)))) spans.push(m[1])
  return spans
}

const hitsIn = (outline, body) => {
  const spans = backtickSpans(body)
  const found = []
  for (const entry of outline) {
    const name = entry.name
    const wordRe = new RegExp('\\b' + escapeRegExp(name) + '\\b')
    if (spans.some((s) => wordRe.test(s)) && !found.includes(name)) found.push(name)
  }
  return found
}

const producesBulletText = (producerBody, symbol) => {
  if (!symbol) return null
  const wordRe = new RegExp('\\b' + escapeRegExp(symbol) + '\\b')
  for (const line of String(producerBody).split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- Produces:') && wordRe.test(trimmed)) return trimmed
  }
  return null
}

const stateByteSize = (state) => Buffer.byteLength(JSON.stringify(state), 'utf8')

const capToByteBudget = (state) => {
  while (stateByteSize(state) > MAX_STATE_BYTES) {
    let trimmed = false
    for (let i = state.shared.length - 1; i >= 0; i--) {
      if (state.shared[i].outline.length > 0) {
        state.shared[i].outline.pop()
        trimmed = true
        break
      }
    }
    if (!trimmed) break
  }
  return state
}

export async function pairState({ pair, tasks, read }) {
  const byId = new Map(tasks.map((t) => [String(t.id), t]))
  const isFilesOnly = pair.symbol == null
  const producerId = isFilesOnly ? pair.a : pair.producer
  const consumerId = isFilesOnly ? pair.b : pair.consumer
  const producerTask = byId.get(String(producerId))
  const consumerTask = byId.get(String(consumerId))

  const producer = taskInfo(producerTask, false)
  const consumer = taskInfo(consumerTask, true)

  const shared = []
  for (const path of pair.paths || []) {
    const baseText = (await read(path)) || ''
    const outline = outlineOf(baseText, path)
    shared.push({
      path,
      exists_at_base: baseText !== '',
      outline,
      producer_hits: hitsIn(outline, producerTask.body),
      consumer_hits: hitsIn(outline, consumerTask.body),
    })
  }

  const symbol = pair.symbol ?? null
  let statedInConsumer = false
  if (symbol) {
    const bulletText = producesBulletText(producerTask.body, symbol)
    statedInConsumer = bulletText ? consumerTask.body.includes(bulletText) : false
  }

  // Whether the consumed symbol already exists at BASE: a whole-word hit in
  // any of the producer's Files as read at BASE (an absent file reads `''`).
  let symbolAtBase = false
  if (symbol) {
    const wordRe = new RegExp('\\b' + escapeRegExp(symbol) + '\\b')
    for (const path of producerTask.files || []) {
      if (wordRe.test((await read(path)) || '')) {
        symbolAtBase = true
        break
      }
    }
  }

  const state = {
    producer,
    consumer,
    shared,
    shape: { symbol, stated_in_consumer: statedInConsumer, symbol_at_base: symbolAtBase },
  }
  return capToByteBudget(state)
}

// ── M3: decideByCode ─────────────────────────────────────────────────────

// A consumed symbol absent at BASE is a chain by code: the consumer cannot
// meet a name nobody has written yet. `opts.interfaceHard === false` (the
// `pairs.interface_hard` switch off) leaves that pair to the reader.
export function decideByCode(state, opts = {}) {
  const interfaceHard = !opts || opts.interfaceHard !== false
  if (state.shape && state.shape.symbol) {
    if (interfaceHard && state.shape.symbol_at_base === false) return 'chain'
    return null
  }
  if (!state.shared || state.shared.length === 0) return null
  for (const s of state.shared) {
    if (s.producer_hits.length === 0 || s.consumer_hits.length === 0) return null
    if (s.producer_hits.some((h) => s.consumer_hits.includes(h))) return null
  }
  return 'fold'
}

// ── M4: labelPair ────────────────────────────────────────────────────────

export async function labelPair({ pair, tasks, read, folds, foldOrder }) {
  const byId = new Map(tasks.map((t) => [String(t.id), t]))

  // With the exam gone (#the examiner leaves the engine and the facts
  // stay), there is no fixed list of a consumer's own test files left to
  // grep for a call — the engine's own selection round
  // (`factory/select.mjs`) is what finds those now, per candidate patch,
  // not per pair. `calls` answers `null` always here.
  const calls = null

  let fold
  if (foldOrder !== undefined) {
    const aId = String(pair.a)
    const bId = String(pair.b)
    const aIdx = foldOrder.findIndex((id) => String(id) === aId)
    const bIdx = foldOrder.findIndex((id) => String(id) === bId)
    let laterId = null
    if (aIdx === -1 && bIdx === -1) laterId = null
    else if (aIdx === -1) laterId = pair.b
    else if (bIdx === -1) laterId = pair.a
    else laterId = bIdx > aIdx ? pair.b : pair.a
    fold =
      laterId != null && folds && Object.prototype.hasOwnProperty.call(folds, laterId)
        ? folds[laterId]
        : null
  } else {
    fold = folds && Object.prototype.hasOwnProperty.call(folds, pair.b) ? folds[pair.b] : null
  }

  return { a: pair.a, b: pair.b, calls, fold }
}
