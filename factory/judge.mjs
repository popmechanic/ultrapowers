// factory/judge.mjs — the factory's one judge.
//
// Every judgment the factory makes is a question in `factory/questions.json`,
// put to Jev verbatim, and graded by a number in `factory/policy.json`: no
// regular expression over model prose, and no threshold literal — the source
// of this file carries no decimal at all, which is the Proof's own grep.
//
// `ask` is `fleet/jev-client.mjs`'s `makeJevClient({ ... }).ask`
// (`{ state, questions } -> answers | null`), which sends no authorization
// header of its own: the edge injects the bearer and the engine hands in the
// `fetchImpl` that carries it. Nothing here sees a credential, opens a socket
// or reads an environment.
//
// Jev answers no fact. A call that does not answer — a `null`, a rejection, a
// reply missing an answer the reader needs — is one `jev:` log line and a
// `null` return, on every one of the six readers, none of which ever throws.

import { readFileSync } from 'node:fs'

/** A number that is actually a number; `undefined` otherwise, so a comparison
 *  against a missing answer is false rather than a `NaN` surprise. */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** The three answer shapes the replay recorded; a bare number reads as itself. */
const noulOf = (a) => num(typeof a === 'number' ? a : a && a.noul)
const scoreOf = (a) => num(typeof a === 'number' ? a : a && a.score)
const choiceOf = (a) => (a && typeof a.choice === 'string' ? a.choice : undefined)
const confOf = (a) => num(a && a.confidence)

/** One document, from the caller's path or from this file's own directory. */
const load = (given, fallback) =>
  JSON.parse(readFileSync(given == null ? new URL(fallback, import.meta.url) : given, 'utf8'))

/** `<i>` and `<j>` substituted through every string of a template. `<i>` is the
 *  clause's index INTO `clauses` — the question's text reads `clauses[<i>]`, a
 *  zero-based access into the array the state carries, while the answer key it
 *  is filed under counts clauses from M1. */
const fill = (value, i, j) => {
  if (typeof value === 'string') return value.split('<i>').join(i).split('<j>').join(j)
  if (Array.isArray(value)) return value.map((v) => fill(v, i, j))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, i, j)]))
  }
  return value
}

/** The judge: six readers over one `ask`. `makeJudge` reads both JSON files
 *  once, at construction, and closes over them; every reader puts its set's
 *  questions to `ask` exactly once and resolves its row or `null`. */
export const makeJudge = ({ ask, questionsPath, policyPath, log = () => {} } = {}) => {
  const doc = load(questionsPath, './questions.json')
  const policy = load(policyPath, './policy.json')
  const sets = doc.sets || {}
  const setQuestions = (name) => (sets[name] || {}).questions || {}
  const landingQuestions = setQuestions('landing')

  /** A severity threshold, by its policy key. Never a literal here. */
  const severity = (key) => num((((policy.landing || {}).severity || {})[key] || {}).value)
  const taskK = (policy.task || {}).k || {}
  const taskReferee = (policy.task || {}).referee || {}

  /** One line, one `null`: the single exit every lane that did not answer
   *  takes, so no lane logs twice and none logs nothing. */
  const refuse = (detail) => {
    try { log('jev: ' + detail) } catch { /* evidence, not control flow */ }
    return null
  }

  /** One call, or `null`. `read` maps the answers to the reader's row, and
   *  `undefined` when an answer it needs is absent or the wrong shape — which
   *  is a `null` and one log line, like a call that never answered. */
  const askOnce = async (what, state, questions, read) => {
    if (typeof ask !== 'function') return refuse(what + ': no ask()')
    let answers
    try {
      answers = await ask({ state, questions })
    } catch (e) {
      return refuse(what + ': ask threw: ' + String((e && e.message) || e).slice(0, 200))
    }
    if (answers == null || typeof answers !== 'object') return refuse(what + ': no answers')
    let row
    try {
      row = read(answers)
    } catch (e) {
      return refuse(what + ': answers unreadable: ' + String((e && e.message) || e).slice(0, 200))
    }
    if (row === undefined) return refuse(what + ': answers incomplete')
    return row
  }

  /** The task reading: how many candidates, and whether a referee is
   *  dispatched. `k` is 2 when the difficulty score reaches the policy's rung
   *  OR `design_open` reaches its value; the referee rides on
   *  `review_difficulty` alone — `doc_or_prose_only` is recorded and gates
   *  nothing, the rule `factory/policy.json` states. */
  const readTask = async ({ title, body } = {}) =>
    askOnce('task', { task: { title, body } }, setQuestions('task'), (answers) => {
      const difficulty = scoreOf(answers.difficulty)
      const designOpen = noulOf(answers.design_open)
      const reviewDifficulty = scoreOf(answers.review_difficulty)
      if ([difficulty, designOpen, reviewDifficulty].includes(undefined)) return undefined
      const hard = difficulty >= num(taskK.difficulty_rung) || designOpen >= num(taskK.design_open)
      return {
        k: hard ? 2 : 1,
        referee: reviewDifficulty >= num(taskReferee.review_difficulty_rung),
        answers,
      }
    })

  /** The adoption reading over one candidate's patch: is the claim
   *  established, and which clause is carried by which file. One pairwise
   *  question per (clause, file) pair beside `claim_established`, filed under
   *  `M<i>__f<j>` clause-major, clauses counted from M1 and files from f0;
   *  `coverage[i]` is the best any one file does for clause `i`. */
  const readLanding = async ({ clauses = [], patch, files = {} } = {}) => {
    const template = (sets.landing || {}).pairwise || {}
    const names = Object.keys(files)
    const keyOf = (i, j) => 'M' + (i + 1) + '__f' + j
    const questions = { claim_established: landingQuestions.claim_established }
    for (let i = 0; i < clauses.length; i += 1) {
      for (let j = 0; j < names.length; j += 1) {
        questions[keyOf(i, j)] = {
          type: template.type,
          instructions: fill(template.instructions, i, j),
          criteria: fill(template.criteria, i, j),
        }
      }
    }
    return askOnce('landing', { clauses, patch, files }, questions, (answers) => {
      const claim = noulOf(answers.claim_established)
      if (claim === undefined) return undefined
      const coverage = []
      for (let i = 0; i < clauses.length; i += 1) {
        let best
        for (let j = 0; j < names.length; j += 1) {
          const pair = noulOf(answers[keyOf(i, j)])
          if (pair === undefined) return undefined
          if (best === undefined || pair > best) best = pair
        }
        coverage.push(best === undefined ? 0 : best)
      }
      return { claim, coverage }
    })
  }

  /** One reviewer finding, graded by `policy.landing.severity`'s own rule,
   *  every term of it a number read from that cell: it blocks only when Jev
   *  says it is borne out by the hunks, falsifies the claim, has the
   *  implementer as its actor, is fixable inside the task's files, is not
   *  merely about how the work was produced, and is not unverified at
   *  confidence. A plan route needs the actor answered `plan` at confidence
   *  AND a fixable answer low enough not to contradict it; else minor. */
  const gradeFinding = async ({ task, finding, hunks, siblingFacts } = {}) => {
    const questions = { ...landingQuestions }
    delete questions.claim_established
    const state = { task, finding, hunks, sibling_facts: siblingFacts }
    return askOnce('landing.finding', state, questions, (answers) => {
      const borneOut = noulOf(answers.borne_out)
      const claimFalse = noulOf(answers.claim_false)
      const fixable = noulOf(answers.fixable_in_files)
      const processOnly = noulOf(answers.process_only)
      const actor = choiceOf(answers.actor)
      const status = choiceOf(answers.status)
      const need = [borneOut, claimFalse, fixable, processOnly, actor, status]
      if (need.includes(undefined)) return undefined
      const unverified = status === 'unverified' &&
        confOf(answers.status) >= severity('t_status_unverified')
      const blocking = borneOut >= severity('t1_borne_out') &&
        claimFalse >= severity('t2_claim_false') &&
        actor === 'implementer' &&
        fixable >= severity('t3_fixable_in_files') &&
        processOnly < severity('t4_process_only') &&
        !unverified
      if (blocking) return 'blocking'
      const routed = actor === 'plan' &&
        confOf(answers.actor) >= severity('t5_actor_plan') &&
        fixable < severity('t5_fixable_guard')
      return routed ? 'plan' : 'minor'
    })
  }

  /** The three readings whose row is the answers themselves: the set's
   *  questions out, the flat answers object back. */
  const flatReader = (name) => async (state = {}) => {
    const questions = setQuestions(name)
    const keys = Object.keys(questions)
    return askOnce(name, state, questions,
      (answers) => (keys.some((key) => answers[key] !== undefined) ? answers : undefined))
  }

  /** The seventh reader: does a task's newest `[note]` fact settle one of its
   *  own candidate exports for a sibling to build against. `which`'s options
   *  are the candidates plus `none`, put both in the state (so Jev can see
   *  them) and on the question itself (`factory/policy.json`'s
   *  `settled.t_settles` is the one threshold, never a literal here). */
  const settledQuestions = setQuestions('settled')
  const tSettles = num(((policy.settled || {}).t_settles || {}).value)
  const readSettled = async ({ note, candidates = [] } = {}) => {
    const options = [...candidates, 'none']
    const questions = {
      settles_interface: settledQuestions.settles_interface,
      which: { ...(settledQuestions.which || {}), options },
    }
    return askOnce('settled', { note, candidates }, questions, (answers) => {
      const settlesInterface = noulOf(answers.settles_interface)
      const which = choiceOf(answers.which)
      if (settlesInterface === undefined || which === undefined) return undefined
      if (settlesInterface < tSettles || which === 'none' || !candidates.includes(which)) return null
      return { symbol: which }
    })
  }

  return {
    readTask,
    readLanding,
    gradeFinding,
    readNote: flatReader('note'),
    readAmendment: flatReader('amendment'),
    readSupervisor: flatReader('supervisor'),
    readSettled,
  }
}
