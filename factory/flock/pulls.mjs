// What a builder is told of when it pulls its peers' published changes (#1292). Every published
// change reaches its copy whatever the scope (engine.mjs pullInto): a copy is a whole tree, and its facts
// run on all of it (flock-baseline run-10, 2026-11-13: a scope that also held changes back left a
// builder without a file its task needed, and the run ended a draft).
// The scope (settled 2026-11-14 over 72 narrow runs; `all`, told of every change, was cut): the
// task's own files, the files of every task it depends on, and the paths this builder has touched
// (read or edited) in its copy. A change outside the scope lands silently and is told once its path
// comes into scope. `created`: files peers created that were absent at base; they cannot conflict
// with anything in a copy, so the scope always holds them (#1405).
export function pullScope ({ task, tasks, touched, created = [] }) {
  const scope = new Set(task.files || [])
  const deps = new Set((task.depends_on || []).map(String))
  for (const t of tasks || []) if (deps.has(String(t.id))) for (const f of t.files || []) scope.add(f)
  for (const p of touched || []) scope.add(p)
  for (const p of created || []) scope.add(p)
  return scope
}
