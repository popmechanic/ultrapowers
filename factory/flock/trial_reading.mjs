// Jev reads a merge conflict an agent resolves and a task an agent gives back,
// record only: what it would have said there, next to what the agent did.
// It never blocks a task or a resolve; a missing answer is recorded as null.
import { answerOf } from '../jev-client.mjs'

const CONFLICT_MAX = 4000
const CONTEXT_LINES = 10

// Each `<<<<<<< begin` … `>>>>>>> end` section with up to CONTEXT_LINES unmarked lines on
// either side, each at most CONFLICT_MAX characters. Context goes first when a section is long.
export function conflictSections (annotated) {
  const lines = String(annotated ?? '').split('\n')
  const spans = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('<<<<<<< begin')) continue
    let j = i
    while (j < lines.length && !lines[j].startsWith('>>>>>>> end')) j++
    spans.push([i, Math.min(j, lines.length - 1)])
    i = j
  }
  return spans.map(([s, e], k) => {
    const lo = Math.max(s - CONTEXT_LINES, k ? spans[k - 1][1] + 1 : 0)
    const hi = Math.min(e + CONTEXT_LINES, k + 1 < spans.length ? spans[k + 1][0] - 1 : lines.length - 1)
    const core = lines.slice(s, e + 1).join('\n')
    if (core.length >= CONFLICT_MAX) return core.slice(0, CONFLICT_MAX)
    let before = lines.slice(lo, s)
    let after = lines.slice(e + 1, hi + 1)
    const text = () => [...before, core, ...after].join('\n')
    while (text().length > CONFLICT_MAX && (before.length || after.length)) {
      if (before.length >= after.length) before = before.slice(1); else after = after.slice(0, -1)
    }
    return text()
  })
}

// The task body's text from its `**Claim:**` line up to, not including, its `**Authorized-by:**` line.
export function claimOf (body) {
  const b = String(body ?? '')
  const s = b.search(/^\*\*Claim:\*\*/m)
  if (s < 0) return ''
  const rest = b.slice(s)
  const e = rest.search(/^\*\*Authorized-by:\*\*/m)
  return (e < 0 ? rest : rest.slice(0, e)).trim().slice(0, 2000)
}

// `sides`: one `{ title, claim }` per plan task whose files include `path`.
export function resolveState ({ path, annotated, sides }) {
  return {
    path,
    conflicts: conflictSections(annotated),
    tasks: sides,
  }
}

const factText = (f) => Array.isArray(f)
  ? (f.length === 3 && f[0] === 'bash' && f[1] === '-lc' ? String(f[2]) : f.join(' '))
  : String(f)

export function releaseState ({ task, why, depends }) {
  return {
    task: task.id,
    title: task.title,
    files: task.files ?? [],
    claim: claimOf(task.body),
    facts: (task.facts ?? []).map(factText),
    reason: String(why ?? '').slice(0, 1500),
    earlier_reasons: (task.notes ?? []).filter((n) => String(n).includes(' released: ')).slice(-3),
    depends_on: depends,
  }
}

export async function readTrial ({ ask, key, question, state, row, emit }) {
  let answers = null
  try { answers = await ask({ state, questions: { [key]: question } }) } catch { answers = null }
  emit({ ...row, ...answerOf(answers, key) })
}
