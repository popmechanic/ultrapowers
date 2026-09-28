// Mirror a Flock board's task moves onto Kata as comments, so `fleet/board-read.mjs` shows each
// claim, release, reopen and close while the run is in flight, not only the closes at the end.
//
// mirrorBoard wraps claim, release, reopen and done on the board object in place and returns it.
// Each comment starts after the board operation it mirrors has completed and is never awaited:
// a slow or failing Kata never holds up or breaks the board. `onPost` hears every attempted post.

export function mirrorBoard (board, { kata, projectId, tasks = {}, onPost } = {}) {
  const orig = { claim: board.claim, release: board.release, reopen: board.reopen, done: board.done }
  const reopening = new Set()
  const report = (rec) => { if (onPost) try { onPost(rec) } catch {} }
  const post = (t, what) => {
    const task = t && t.id
    const uid = task != null && Object.hasOwn(tasks, task) ? tasks[task] && tasks[task].uid : null
    if (!uid) { report({ task, what, ok: false, skipped: true }); return }
    let p
    try { p = Promise.resolve(kata.comment(projectId, uid, what)) } catch (e) { p = Promise.reject(e) }
    p.then(() => report({ task, uid, what, ok: true }), (e) => report({ task, uid, what, ok: false, error: String(e && e.message || e) }))
  }

  board.claim = async function (agent, ...rest) {
    const t = await orig.claim.call(this, agent, ...rest)
    if (t) post(t, 'claimed by ' + agent)
    return t
  }
  board.release = async function (t, why, ...rest) {
    const r = await orig.release.call(this, t, why, ...rest)
    if (!reopening.has(t)) post(t, 'released: ' + why)
    return r
  }
  board.reopen = async function (t, why, ...rest) {
    reopening.add(t)
    let r
    try { r = await orig.reopen.call(this, t, why, ...rest) } finally { reopening.delete(t) }
    post(t, 'reopened: ' + why)
    return r
  }
  board.done = async function (t, ...rest) {
    const owner = t && t.owner
    const r = await orig.done.call(this, t, ...rest)
    post(t, 'done by ' + owner)
    return r
  }
  return board
}
