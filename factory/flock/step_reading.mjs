// Jev reads each green story step, record only: the story sentence the operator
// signed against the store before and after the step and the text on screen.
// It never blocks a task or a PR; a missing answer is recorded as null.
import fs from 'node:fs'
import path from 'node:path'
import { answerOf } from '../jev-client.mjs'

export function latestResults (dir) {
  const by = new Map()
  if (!fs.existsSync(dir)) return by
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const p = path.join(dir, f)
    let r
    try { r = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { continue }
    if (!r || typeof r.clause !== 'string') continue
    const m = fs.statSync(p).mtimeMs
    const prev = by.get(r.clause)
    if (!prev || prev.m < m) by.set(r.clause, { m, r })
  }
  return new Map([...by].map(([k, v]) => [k, v.r]))
}

// The story's steps up to and including `result`'s own, in step order: the
// clauses of `all` sharing its prefix (`p0/S1.`) with a step number at most its own.
function storySteps (result, all) {
  const clause = String(result.clause)
  const dot = clause.lastIndexOf('.')
  if (!all || dot < 0) return [result]
  const prefix = clause.slice(0, dot + 1)
  const num = (c) => Number(c.slice(prefix.length))
  const own = num(clause)
  const steps = [...all.values()]
    .filter((r) => r && typeof r.clause === 'string' && r.clause !== clause && r.clause.startsWith(prefix) &&
      /^\d+$/.test(r.clause.slice(prefix.length)) && num(r.clause) < own)
    .sort((a, b) => num(a.clause) - num(b.clause))
  return [...steps, result]
}

// A store is [tables, values], tables `{table: {row: {cell: value}}}`: one
// `{table, row, before, after}` per row that differs, a missing row `null`.
export function storeChanges (before, after) {
  const tb = (Array.isArray(before) && before[0]) || {}
  const ta = (Array.isArray(after) && after[0]) || {}
  const changes = []
  for (const table of new Set([...Object.keys(tb), ...Object.keys(ta)])) {
    const rb = tb[table] || {}
    const ra = ta[table] || {}
    for (const row of new Set([...Object.keys(rb), ...Object.keys(ra)])) {
      const b = rb[row] ?? null
      const a = ra[row] ?? null
      if (JSON.stringify(b) !== JSON.stringify(a)) changes.push({ table, row, before: b, after: a })
    }
  }
  return changes
}

// The client drops a state over JEV_STATE_MAX_BYTES (120000) without a call, so
// past STORE_MAX the whole stores give way to the rows that changed.
const STATE_MAX = 120000
const STORE_MAX = 100000

export function stepState (result, sentences, all) {
  // A guard clause (e.g. `G:p0/S2.3`) proves an earlier plan's setup still
  // holds; its sentence belongs to that earlier plan, not this one, so it
  // gets no story sentence at all rather than a wrong or coincidental one.
  const clause = String(result.clause)
  const isGuard = /^G:/.test(clause)
  const story = isGuard ? '' : (sentences[clause.split('/').pop().split('.')[0]] ?? '')
  // The question is whether the whole story came true: every step's actions,
  // the store before its first step and after its last.
  const steps = isGuard ? [result] : storySteps(result, all)
  const state = {
    story,
    step: result.clause,
    did: steps.flatMap((r) => r.did ?? []),
    before: steps[0].before ?? null,
    after: steps[steps.length - 1].after ?? null,
    screen_text: String(result.screen_text ?? '').slice(0, 4000),
  }
  if (JSON.stringify(state).length <= STORE_MAX) return state
  const { before, after, ...rest } = state
  const out = { ...rest, changes: storeChanges(before, after) }
  // Even the changed rows may not fit: keep the first ones and say how many were cut.
  while (out.changes.length && JSON.stringify(out).length > STATE_MAX) {
    out.changes.pop()
    out.changes_cut = (out.changes_cut ?? 0) + 1
  }
  return out
}

// The clause Jev reads for each story: its highest-numbered step, the one after
// which the story's sentence should be true (#1369: a middle step was asked about
// an outcome that had not happened yet). Guard clauses (`G:`) belong to an
// earlier plan and are never read.
export function lastSteps (clauses) {
  const best = new Map()
  for (const c of clauses) {
    if (/^G:/.test(c)) continue
    const [story, step] = String(c).split('.')
    const prev = best.get(story)
    if (!prev || Number(step) > Number(prev.split('.')[1])) best.set(story, c)
  }
  return new Set(best.values())
}

export async function readSteps ({ ask, results, sentences, question, emit, last, all }) {
  await Promise.all(results.filter((r) => r && r.exit === 0 && last.has(r.clause)).map(async (r) => {
    const answers = await ask({ state: stepState(r, sentences, all), questions: { delivered: question } })
    emit({ clause: r.clause, ...answerOf(answers, 'delivered') })
  }))
}
