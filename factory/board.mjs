// factory/board.mjs — the board: the one module that talks to Kata, and it
// never fails a run (#810 "map: the blackboard"; CLAUDE.md "Hub writes are
// never the run's failure"; Kata docs/workflows/agents.md: comments for
// decisions, metadata for state).
//
// Everything the run learns about a task goes onto that task's issue through
// this module, and anyone about to work on the task can be handed all of it
// as plain text via `factsFor`. Every method here resolves and never
// rejects: a Kata outage is logged, not thrown, and the run carries on with
// the empty value the caller would have gotten from an issue with nothing on
// it yet.

/** The character budget `factsFor` renders into — a whole number of whole
 *  facts, newest kept first, oldest dropped until the rendering fits. */
const FACTS_LIMIT = 12000

/** Prefixed onto `factsFor`'s rendering whenever at least one fact was
 *  dropped to fit the budget. */
const OMITTED_PREFIX = '(earlier facts omitted)'

/** True when a comment's first line is a bracketed kind, e.g. `[landing]` —
 *  the shape `post` writes and `factsFor` reads back. This module does not
 *  validate which kind: it brackets whatever `post` was given and reads back
 *  whatever is bracketed. */
const isFact = (body) => {
  if (typeof body !== 'string') return false
  const firstLine = body.split('\n', 1)[0]
  return /^\[[^\]]*\]$/.test(firstLine)
}

/** The empty value M4 names for each of the five methods. */
const EMPTY = { post: null, factsFor: '', setState: null, states: {}, settled: null }

/**
 * The five methods a driver or a worker needs to reach Kata. `kata` is
 * `fleet/kata-client.mjs`'s client (or any object shaped like it); `tasks` is
 * the kata.json's `tasks` object, `{ <taskId>: { uid, ... } }`. `log` is
 * called at most once per failing call, with a string beginning `board:`.
 *
 * With no `kata` at all (the run has nothing to talk to — a dry run, or a
 * config still being built) every method resolves its empty value without
 * ever calling `log`: there is nothing to have failed.
 */
export const makeBoard = ({ kata, projectId, tasks, log } = {}) => {
  const noise = (label, taskId, error) => {
    if (typeof log !== 'function') return
    const detail = error && error.message ? error.message : String(error)
    log('board: ' + label + (taskId === undefined ? '' : ' (task ' + taskId + ')') + ' failed: ' + detail)
  }

  const uidFor = (taskId) => {
    const task = tasks && tasks[taskId]
    return task ? task.uid : undefined
  }

  const post = async (taskId, kind, text) => {
    if (!kata) return EMPTY.post
    try {
      const uid = uidFor(taskId)
      if (uid === undefined) throw new Error('no such task ' + taskId)
      return await kata.comment(projectId, uid, '[' + kind + ']\n' + text)
    } catch (error) {
      noise('post', taskId, error)
      return EMPTY.post
    }
  }

  const factsFor = async (taskId) => {
    if (!kata) return EMPTY.factsFor
    try {
      const uid = uidFor(taskId)
      if (uid === undefined) throw new Error('no such task ' + taskId)
      const issue = await kata.getIssue(uid)
      const comments = (issue && issue.comments) || []
      const facts = comments.map((c) => c && c.body).filter(isFact)
      if (facts.length === 0) return ''

      // Keep the newest whole facts that fit, dropping from the oldest end.
      // `start === facts.length` is the degenerate case where even the
      // single newest fact does not fit: zero facts are kept, and the
      // rendering is the omission prefix alone (well under the budget),
      // rather than a fact rendered partial or a rendering left over budget.
      for (let start = 0; start <= facts.length; start++) {
        const kept = facts.slice(start)
        const body = kept.join('\n\n')
        const rendered = start > 0 ? (body ? OMITTED_PREFIX + '\n\n' + body : OMITTED_PREFIX) : body
        if (rendered.length <= FACTS_LIMIT) return rendered
      }
      // Unreachable: the degenerate case above always fits.
      return OMITTED_PREFIX
    } catch (error) {
      noise('factsFor', taskId, error)
      return EMPTY.factsFor
    }
  }

  const setState = async (taskId, state) => {
    if (!kata) return EMPTY.setState
    try {
      const uid = uidFor(taskId)
      if (uid === undefined) throw new Error('no such task ' + taskId)
      return await kata.patchMetadata(projectId, uid, { 'factory.state': state })
    } catch (error) {
      noise('setState', taskId, error)
      return EMPTY.setState
    }
  }

  const states = async () => {
    if (!kata) return { ...EMPTY.states }
    try {
      const issues = (await kata.listIssues(projectId)) || []
      const byUid = new Map()
      for (const issue of issues) {
        if (issue && issue.uid !== undefined) byUid.set(issue.uid, issue)
      }
      const out = {}
      for (const taskId of Object.keys(tasks || {})) {
        const uid = uidFor(taskId)
        const issue = uid === undefined ? undefined : byUid.get(uid)
        const metadata = (issue && issue.metadata) || {}
        const state = Object.prototype.hasOwnProperty.call(metadata, 'factory.state')
          ? metadata['factory.state']
          : null
        out[taskId] = state === undefined ? null : state
      }
      return out
    } catch (error) {
      noise('states', undefined, error)
      return { ...EMPTY.states }
    }
  }

  const settled = async (taskId) => {
    if (!kata) return EMPTY.settled
    try {
      const uid = uidFor(taskId)
      if (uid === undefined) throw new Error('no such task ' + taskId)
      const issue = await kata.getIssue(uid)
      const metadata = (issue && issue.metadata) || {}
      const raw = metadata['interface.settled']
      if (raw === undefined || raw === null) return null
      if (typeof raw === 'object') return raw
      return JSON.parse(raw)
    } catch (error) {
      noise('settled', taskId, error)
      return EMPTY.settled
    }
  }

  return { post, factsFor, setState, states, settled }
}
