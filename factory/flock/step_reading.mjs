// Jev reads each green story step, record only: the story sentence the operator
// signed against the store before and after the step and the text on screen.
// It never blocks a task or a PR; a missing answer is recorded as null.
import fs from 'node:fs'
import path from 'node:path'

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

export function stepState (result, sentences) {
  // A guard clause (e.g. `G:p0/S2.3`) proves an earlier plan's setup still
  // holds; its sentence belongs to that earlier plan, not this one, so it
  // gets no story sentence at all rather than a wrong or coincidental one.
  const clause = String(result.clause)
  const isGuard = /^G:/.test(clause)
  const story = isGuard ? '' : (sentences[clause.split('/').pop().split('.')[0]] ?? '')
  return {
    story,
    step: result.clause,
    did: result.did ?? [],
    before: result.before ?? null,
    after: result.after ?? null,
    screen_text: String(result.screen_text ?? '').slice(0, 4000),
  }
}

export async function readSteps ({ ask, results, sentences, question, emit }) {
  await Promise.all(results.filter((r) => r && r.exit === 0).map(async (r) => {
    const answers = await ask({ state: stepState(r, sentences), questions: { delivered: question } })
    const a = answers && answers.delivered
    emit({
      clause: r.clause,
      answer: a && typeof a.choice === 'string' ? a.choice : null,
      confidence: a && typeof a.confidence === 'number' ? a.confidence : null,
    })
  }))
}
