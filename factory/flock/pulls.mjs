// What a builder takes in when it pulls its peers' published changes (#1292).
// mode `all` (the rollback, today's behaviour): null, meaning every published change.
// mode `narrow`: the task's own files, the files of every task it depends on, and the paths this
// builder has touched (read or edited) in its copy. Unpulled changes stay published; the edge
// still merges and tests everything.
export function pullScope ({ task, tasks, touched, mode }) {
  if (mode !== 'narrow') return null
  const scope = new Set(task.files || [])
  const deps = new Set((task.depends_on || []).map(String))
  for (const t of tasks || []) if (deps.has(String(t.id))) for (const f of t.files || []) scope.add(f)
  for (const p of touched || []) scope.add(p)
  return scope
}
