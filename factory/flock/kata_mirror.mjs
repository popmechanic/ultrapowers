// Mirror a Flock board's task moves onto Kata as comments, so `fleet/board-read.mjs` shows each
// claim, release, reopen and close while the run is in flight, not only the closes at the end.
//
// mirrorBoard wraps claim, release, reopen and done on the board object in place and returns it.
// Each comment starts after the board operation it mirrors has completed and is never awaited:
// a slow or failing Kata never holds up or breaks the board. One task's comments go out one after
// another, so Kata records them in board order. `onPost` hears every attempted post; `track`, when
// given, receives each post's promise (settled or not, it never rejects) so a caller can let the
// queue drain before it exits.
//
// It wraps post as well: a belief `about` the engine held at `surfaceAt` or more (default 0.8) is
// commented on its task's issue, or on the run issue `runUid` when it names no task with one, so a
// builder sure the engine itself is wrong is seen on the board mid-run. Other beliefs post nothing.

export function mirrorBoard (board, { kata, projectId, tasks = {}, onPost, track, runUid, surfaceAt = 0.8 } = {}) {
  const orig = { claim: board.claim, release: board.release, reopen: board.reopen, done: board.done, post: board.post }
  const reopening = new Set()
  const tails = new Map()   // uid -> the last queued post for that issue
  const report = (rec) => { if (onPost) try { onPost(rec) } catch {} }
  const uidOf = (task) => task != null && Object.hasOwn(tasks, task) ? tasks[task] && tasks[task].uid : null
  const post = (t, what, fallback) => {
    const task = t && t.id
    const uid = uidOf(task) || fallback
    if (!uid) { report({ task, what, ok: false, skipped: true }); return }
    const send = () => {
      let p
      try { p = Promise.resolve(kata.comment(projectId, uid, what)) } catch (e) { p = Promise.reject(e) }
      return p.then(() => report({ task, uid, what, ok: true }), (e) => report({ task, uid, what, ok: false, error: String(e && e.message || e) }))
    }
    const q = (tails.get(uid) || Promise.resolve()).then(send)
    tails.set(uid, q)
    q.then(() => { if (tails.get(uid) === q) tails.delete(uid) })
    if (track) try { track(q) } catch {}
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
  board.post = async function (b, ...rest) {
    const r = await orig.post.call(this, b, ...rest)
    if (b && b.about === 'engine' && typeof b.confidence === 'number' && b.confidence >= surfaceAt) {
      post({ id: b.task }, `engine belief (${b.confidence}) from ${b.by}: ${String(b.claim ?? '').slice(0, 300)}`, runUid)
    }
    return r
  }
  return board
}
