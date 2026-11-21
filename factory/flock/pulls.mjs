export function pullScope ({ task, tasks, touched, created = [] }) {
  const scope = new Set(task.files || [])
  const deps = new Set((task.depends_on || []).map(String))
  for (const t of tasks || []) if (deps.has(String(t.id))) for (const f of t.files || []) scope.add(f)
  for (const p of touched || []) scope.add(p)
  for (const p of created || []) scope.add(p)
  return scope
}
