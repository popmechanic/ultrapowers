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
export const makeJudge = ({ ask, emit, now = Date.now, questionsPath, policyPath, log = () => {} } = {}) => {
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
   *  is a `null` and one log line, like a call that never answered. Every
   *  invocation writes exactly one Jev row through `emit` (M1): `kind: 'jev'`,
   *  `site: what`, the `task`/`label` off `who` (or `null`), the questions'
   *  own keys in order, the raw `values` Jev sent back (`null` when it never
   *  answered), `state_bytes` over the state sent, `ms` from `now()` before
   *  to `now()` after, and `answered`. An `emit` that throws, or none at all,
   *  never reaches the reader — evidence, not control flow. */
  const askOnce = async (what, state, questions, read, who) => {
    const t0 = now()
    const writeRow = (answered, values) => {
      const row = {
        kind: 'jev',
        site: what,
        task: (who && who.task != null) ? who.task : null,
        label: (who && who.label != null) ? who.label : null,
        keys: Object.keys(questions),
        values,
        state_bytes: Buffer.byteLength(JSON.stringify(state)),
        ms: now() - t0,
        answered,
      }
      if (typeof emit === 'function') {
        try { emit(row) } catch { /* evidence, not control flow */ }
      }
    }
    if (typeof ask !== 'function') {
      writeRow(false, null)
      return refuse(what + ': no ask()')
    }
    let answers
    try {
      answers = await ask({ state, questions })
    } catch (e) {
      writeRow(false, null)
      return refuse(what + ': ask threw: ' + String((e && e.message) || e).slice(0, 200))
    }
    if (answers == null || typeof answers !== 'object') {
      writeRow(false, null)
      return refuse(what + ': no answers')
    }
    writeRow(true, answers)
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
  const readTask = async ({ title, body, who } = {}) =>
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
    }, who)

  /** The adoption reading over one candidate's patch: is the claim
   *  established, and which clause is carried by which file. One pairwise
   *  question per (clause, file) pair beside `claim_established`, filed under
   *  `M<i>__f<j>` clause-major, clauses counted from M1 and files from f0;
   *  `coverage[i]` is the best any one file does for clause `i`. A clause
   *  whose `settled` entry is not `null` was already proved by a command, so
   *  its pairwise questions are never sent and its `coverage` entry is that
   *  entry verbatim. When `facts` is given, the whole-claim reading is also
   *  taken with those measured facts in front of it, at the record-only
   *  `claim_established_given_facts` question — a missing answer to it never
   *  fails the reading. When `clauseFacts` is given, that same record-only
   *  question is asked alongside one `M<i>__facts` question per clause, each
   *  asked over that clause's own `clause_facts[i-1]` entry — still never
   *  gating the reading. */
  const readLanding = async ({ clauses = [], patch, files = {}, facts, settled, clauseFacts, who } = {}) => {
    const template = (sets.landing || {}).pairwise || {}
    const perClauseTemplate = (sets.landing || {}).per_clause_facts || {}
    const names = Object.keys(files)
    const keyOf = (i, j) => 'M' + (i + 1) + '__f' + j
    const factsKeyOf = (i) => 'M' + (i + 1) + '__facts'
    const isSettled = (i) => Array.isArray(settled) && settled[i] !== null && settled[i] !== undefined
    const hasCF = Array.isArray(clauseFacts) && clauseFacts.length > 0
    const hasFacts = Array.isArray(facts) && facts.length > 0
    const questions = { claim_established: landingQuestions.claim_established }
    if (hasCF || hasFacts) {
      questions.claim_established_given_facts = landingQuestions.claim_established_given_facts
    }
    if (hasCF) {
      for (let i = 0; i < clauses.length; i += 1) {
        questions[factsKeyOf(i)] = {
          type: perClauseTemplate.type,
          instructions: fill(perClauseTemplate.instructions, i),
          criteria: fill(perClauseTemplate.criteria, i),
        }
      }
    }
    for (let i = 0; i < clauses.length; i += 1) {
      if (isSettled(i)) continue
      for (let j = 0; j < names.length; j += 1) {
        questions[keyOf(i, j)] = {
          type: template.type,
          instructions: fill(template.instructions, i, j),
          criteria: fill(template.criteria, i, j),
        }
      }
    }
    const state = { clauses, patch, files }
    if (Array.isArray(facts) && facts.length > 0) state.facts = facts
    if (hasCF) state.clause_facts = clauseFacts
    return askOnce('landing', state, questions, (answers) => {
      const claim = noulOf(answers.claim_established)
      if (claim === undefined) return undefined
      const givenFactsKey = 'claim_established_given_facts'
      const claimGivenFacts = questions[givenFactsKey]
        ? (noulOf(answers[givenFactsKey]) ?? null)
        : undefined
      const coverage = []
      for (let i = 0; i < clauses.length; i += 1) {
        if (isSettled(i)) {
          coverage.push(settled[i])
          continue
        }
        let best
        for (let j = 0; j < names.length; j += 1) {
          const pair = noulOf(answers[keyOf(i, j)])
          if (pair === undefined) return undefined
          if (best === undefined || pair > best) best = pair
        }
        coverage.push(best === undefined ? 0 : best)
      }
      const row = { claim, coverage }
      if (claimGivenFacts !== undefined) row.claimGivenFacts = claimGivenFacts
      if (hasCF) {
        row.claimGivenFactsPerClause = []
        for (let i = 0; i < clauses.length; i += 1) {
          row.claimGivenFactsPerClause.push(noulOf(answers[factsKeyOf(i)]) ?? null)
        }
      }
      return row
    }, who)
  }

  /** One reviewer finding, graded by `policy.landing.severity`'s own rule,
   *  every term of it a number read from that cell: it blocks only when Jev
   *  says it is borne out by the hunks, falsifies the claim, has the
   *  implementer as its actor, is fixable inside the task's files, is not
   *  merely about how the work was produced, and is not unverified at
   *  confidence. A plan route needs the actor answered `plan` at confidence
   *  AND a fixable answer low enough not to contradict it; else minor. */
  const gradeFinding = async ({ task, finding, hunks, siblingFacts, who } = {}) => {
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
    }, who)
  }

  /** The three readings whose row is the answers themselves: the set's
   *  questions out, the flat answers object back. `who` never reaches Jev —
   *  the state sent to `ask` is the argument minus `who`, every other key
   *  unchanged. */
  const flatReader = (name) => async (arg = {}) => {
    const { who, ...state } = arg
    const questions = setQuestions(name)
    const keys = Object.keys(questions)
    return askOnce(name, state, questions,
      (answers) => (keys.some((key) => answers[key] !== undefined) ? answers : undefined), who)
  }

  /** The seventh reader: does a task's newest `[note]` fact settle one of its
   *  own candidate exports for a sibling to build against. `which`'s options
   *  are the candidates plus `none`, put both in the state (so Jev can see
   *  them) and on the question itself (`factory/policy.json`'s
   *  `settled.t_settles` is the one threshold, never a literal here). */
  const settledQuestions = setQuestions('settled')
  const tSettles = num(((policy.settled || {}).t_settles || {}).value)
  const readSettled = async ({ note, candidates = [], who } = {}) => {
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
    }, who)
  }

  /** The two selection readers: which existing test already covers a clause,
   *  and which tests would catch a regression in a patch. Both key `tests`
   *  into the state as `t0`, `t1`, … by text, so Jev sees the source and
   *  never a path; both answer nothing over an empty `tests` without asking. */
  const selectQuestions = setQuestions('select')
  const selectPolicy = policy.select || {}
  const tCovers = num((selectPolicy.t_covers || {}).value)
  const tGuards = num((selectPolicy.t_guards || {}).value)
  const maxRun = selectPolicy.max_run

  const testsState = (tests) => {
    const state = {}
    tests.forEach((t, j) => { state['t' + j] = t.text })
    return state
  }

  /** The covering reading: one pairwise question per (clause, test), filed
   *  `M<i+1>__t<j>` clause-major, clauses counted from M1 as `readLanding`'s
   *  pairwise does. `covered[i]` is the path of clause `i`'s best-scoring
   *  test when that score clears `policy.select.t_covers`, else `null`. */
  const readCovering = async ({ clauses = [], tests = [], who } = {}) => {
    if (tests.length === 0) return null
    const template = selectQuestions.covers || {}
    const keyOf = (i, j) => 'M' + (i + 1) + '__t' + j
    const questions = {}
    for (let i = 0; i < clauses.length; i += 1) {
      for (let j = 0; j < tests.length; j += 1) {
        questions[keyOf(i, j)] = {
          type: template.type,
          instructions: fill(template.instructions, i, j),
          criteria: fill(template.criteria, i, j),
        }
      }
    }
    return askOnce('select.covers', { clauses, tests: testsState(tests) }, questions, (answers) => {
      const scores = []
      const covered = []
      for (let i = 0; i < clauses.length; i += 1) {
        const row = []
        let best
        let bestPath = null
        for (let j = 0; j < tests.length; j += 1) {
          const score = noulOf(answers[keyOf(i, j)])
          if (score === undefined) return undefined
          row.push(score)
          if (best === undefined || score > best) {
            best = score
            bestPath = tests[j].path
          }
        }
        scores.push(row)
        covered.push(best !== undefined && best >= tCovers ? bestPath : null)
      }
      return { covered, scores }
    }, who)
  }

  /** The guarding reading: one question per test, filed `g<j>`. `selected` is
   *  the paths at or above `policy.select.t_guards`, highest score first,
   *  ties in the order given, capped at `policy.select.max_run`. */
  const readGuards = async ({ patch, tests = [], who } = {}) => {
    if (tests.length === 0) return null
    const template = selectQuestions.guards || {}
    const keyOf = (j) => 'g' + j
    const questions = {}
    for (let j = 0; j < tests.length; j += 1) {
      questions[keyOf(j)] = {
        type: template.type,
        instructions: fill(template.instructions, null, j),
        criteria: fill(template.criteria, null, j),
      }
    }
    return askOnce('select.guards', { patch, tests: testsState(tests) }, questions, (answers) => {
      const scores = []
      for (let j = 0; j < tests.length; j += 1) {
        const score = noulOf(answers[keyOf(j)])
        if (score === undefined) return undefined
        scores.push(score)
      }
      const indices = tests.map((_, j) => j).filter((j) => scores[j] >= tGuards)
      indices.sort((a, b) => scores[b] - scores[a])
      const selected = indices.slice(0, maxRun).map((j) => tests[j].path)
      return { selected, scores }
    }, who)
  }

  /** The pair readings: `readPair` over the two tasks before either lands,
   *  `readPairCandidate` over one real patch once it exists. Both live in the
   *  `pair` set; `readPair` puts five of its six questions in one `ask`,
   *  `readPairCandidate` the sixth (`changes_consumer`) alone. */
  const pairQuestions = setQuestions('pair')
  const pairsPolicy = policy.pairs || {}
  const tChangesConsumer = num((pairsPolicy.t_changes_consumer || {}).value)

  /** The two cut points a `score` verdict is graded against: the midpoints
   *  between the question's own level keys, read off `criteria` itself — the
   *  three levels are `0`, `1`, `2`, so this is `0.5` and `1.5`, but neither
   *  number is a literal here. */
  const verdictLevels = Object.keys((pairQuestions.verdict || {}).criteria || {})
    .map(Number).sort((a, b) => a - b)
  const midFoldLook = (verdictLevels[0] + verdictLevels[1]) / 2
  const midLookChain = (verdictLevels[1] + verdictLevels[2]) / 2

  /** The names a `where_` question may answer: every name in `shared`'s own
   *  outlines, in order, followed by the three fixed options. */
  const whereOptions = (shared = []) => [
    ...shared.flatMap((s) => (s.outline || []).map((entry) => entry.name)),
    'imports', 'new top-level code', 'cannot tell',
  ]

  const readPair = async (arg = {}) => {
    const { who, ...state } = arg
    const options = whereOptions(state.shared)
    const questions = {
      verdict: pairQuestions.verdict,
      where_producer: { ...(pairQuestions.where_producer || {}), options },
      where_consumer: { ...(pairQuestions.where_consumer || {}), options },
      ordering_matters: pairQuestions.ordering_matters,
      needs_behaviour: pairQuestions.needs_behaviour,
    }
    const row = await askOnce('pair', state, questions, (answers) => {
      const score = scoreOf(answers.verdict)
      const producer = choiceOf(answers.where_producer)
      const consumer = choiceOf(answers.where_consumer)
      if ([score, producer, consumer].includes(undefined)) return undefined
      return { score, where: { producer, consumer }, answers }
    }, who)
    if (row === null) return { verdict: 'look', score: null, where: null, answers: null }
    const verdict = row.score < midFoldLook ? 'fold' : row.score >= midLookChain ? 'chain' : 'look'
    return { verdict, score: row.score, where: row.where, answers: row.answers }
  }

  /** Whether a producer's real patch changes a name, a signature or a format
   *  the consumer's task text relied on. */
  const readPairCandidate = async ({ hunks, consumer, who } = {}) => {
    const questions = { changes_consumer: pairQuestions.changes_consumer }
    return askOnce('pair.candidate', { hunks, consumer }, questions, (answers) => {
      const score = noulOf(answers.changes_consumer)
      if (score === undefined) return undefined
      return { changes: score >= tChangesConsumer, score }
    }, who)
  }

  /** The supervisor's second reader: the same four questions, over the
   *  driver's own `observed` state rather than the worker's `inferred` one,
   *  filed at its own site so the census can tell the two readings apart.
   *  `who` never reaches Jev, exactly as `readSupervisor`'s does not. */
  const readSupervisorObserved = async (arg = {}) => {
    const { who, ...state } = arg
    const questions = setQuestions('supervisor')
    const keys = Object.keys(questions)
    return askOnce('supervisor.observed', state, questions,
      (answers) => (keys.some((key) => answers[key] !== undefined) ? answers : undefined), who)
  }

  /** The union reading: whether two sides that collided can simply both be
   *  kept, in order — the second door engine.mjs used to open on `ask`
   *  directly, now behind this one. `union: true` only when
   *  `independent_additions` clears `policy.resolve.union.independent_additions`
   *  AND the other two stay at or under their own `_max` ceilings; a missing
   *  answer is `null`, never a guess. */
  const resolveQuestions = setQuestions('resolve')
  const unionPolicy = (policy.resolve || {}).union || {}
  const readUnion = async ({ hunks, who } = {}) => {
    const questions = {
      independent_additions: resolveQuestions.independent_additions,
      shared_anchor: resolveQuestions.shared_anchor,
      ordering_matters: resolveQuestions.ordering_matters,
    }
    return askOnce('resolve.union', { hunks }, questions, (answers) => {
      const independent = noulOf(answers.independent_additions)
      const sharedAnchor = noulOf(answers.shared_anchor)
      const orderingMatters = noulOf(answers.ordering_matters)
      if ([independent, sharedAnchor, orderingMatters].includes(undefined)) return null
      const union = independent >= num(unionPolicy.independent_additions) &&
        sharedAnchor <= num(unionPolicy.shared_anchor_max) &&
        orderingMatters <= num(unionPolicy.ordering_matters_max)
      return { union }
    }, who)
  }

  return {
    readTask,
    readLanding,
    gradeFinding,
    readNote: flatReader('note'),
    readAmendment: flatReader('amendment'),
    readSupervisor: flatReader('supervisor'),
    readSupervisorObserved,
    readSettled,
    readCovering,
    readGuards,
    readPair,
    readPairCandidate,
    readUnion,
  }
}
