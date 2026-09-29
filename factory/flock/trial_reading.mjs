// Jev reads a merge conflict an agent resolves and a task an agent gives back,
// record only: what it would have said there, next to what the agent did.
// It never blocks a task or a resolve; a missing answer is recorded as null.

export function resolveState ({ path, annotated, titles }) {
  return {
    path,
    annotated: String(annotated ?? '').slice(0, 8000),
    tasks: titles,
  }
}

export function releaseState ({ task, why, depends }) {
  return {
    task: task.id,
    title: task.title,
    files: task.files ?? [],
    reason: String(why ?? '').slice(0, 1500),
    depends_on: depends,
  }
}

export async function readTrial ({ ask, key, question, state, row, emit }) {
  let answers = null
  try { answers = await ask({ state, questions: { [key]: question } }) } catch { answers = null }
  const a = answers && answers[key]
  emit({
    ...row,
    answer: a && typeof a.choice === 'string' ? a.choice : null,
    confidence: a && typeof a.confidence === 'number' ? a.confidence : null,
  })
}
