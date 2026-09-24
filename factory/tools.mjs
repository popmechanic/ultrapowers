// factory/tools.mjs — the four tools a factory worker holds IN PROCESS (#1131).
//
// A worker in the Jev factory never shells out to reach the record: it posts a
// note, raises its hand, declares the one symbol it settled and reads a
// sibling's facts through MCP tools that live in the engine's own process and
// close over the engine's own kata client. That is what `createSdkMcpServer`
// buys — no stdio child, no second credential path, and a `kata` object the
// model cannot see, only call.
//
// Two rules the shapes here encode:
//
//   SELECTING, NEVER GENERATING (#1130). `settled` takes a symbol the ENGINE
//   computed — the patch's own added exports plus the task's `Produces:` names —
//   and refuses anything else. A worker cannot invent an interface by naming
//   it; it can only point at one it actually added. The refusal answers with
//   the candidate list, so the model's next turn has the correction in hand.
//
//   A TOOL NEVER COSTS A WORKER ITS TURN. Every handler answers a text block,
//   including the failures: `sibling_fact` against an issue that is not there
//   answers `no fact: …` rather than rejecting, and a kata call that fell over
//   answers what fell over. A rejected tool call would end the worker's run on
//   a transient 5xx, which is the one thing the record cannot afford.

import { createRequire } from 'node:module'
import { patchWithRevision } from './board.mjs'
import { pathToFileURL } from 'node:url'

const reason = (err) => (err && err.message) || String(err)

/**
 * The SDK and its zod both live in `fleet/node_modules` — the install
 * `factory/boot.sh` performs (`npm ci` in `fleet/`) against `fleet/package.json`. A bare
 * specifier from THIS file does not find them: node walks `factory/` upward to
 * the repository root and stops, and the root has no `node_modules`. So each
 * import is tried three ways — the bare specifier (a hoisted or root install),
 * then node's own algorithm rooted at `fleet/package.json`, and last the path
 * the task's Context names.
 *
 * The middle attempt is the one that answers in practice, and it is deliberately
 * ahead of the spelled path because it reads the dependency's own `exports`/
 * `main`: zod 4 has no `index.js` at all (its `main` is `index.cjs`), so a path
 * pinned to a particular entry file is a guess that a major bump invalidates.
 *
 * When all three fail, the throw names all three. The first version reported
 * only the bare specifier's `ERR_MODULE_NOT_FOUND`, which reads as "the code
 * imports it wrong" when the truth is "nothing is installed" — the two failures
 * that would have distinguished them were swallowed.
 */
const fleetRequire = createRequire(new URL('../fleet/package.json', import.meta.url))

const load = async (spec, relative) => {
  const attempts = [
    () => spec,
    () => pathToFileURL(fleetRequire.resolve(spec)).href,
    () => new URL(relative, import.meta.url).href,
  ]
  const failures = []
  for (const attempt of attempts) {
    try { return await import(attempt()) } catch (err) { failures.push(reason(err)) }
  }
  throw new Error('factory/tools.mjs cannot resolve "' + spec + '" — it is installed into ' +
    'fleet/node_modules by factory/boot.sh (npm ci) against fleet/package.json. Tried: ' +
    failures.join(' ‖ '))
}

// Top-level await, so `factoryTools` below stays an ordinary synchronous call:
// an importer of this module awaits its evaluation for free, and a caller's
// `factoryTools({…}).name` is a property and not a promise. Loaded forgivingly,
// the way `factory/worker.mjs` loads the SDK: a clone with no `fleet/node_modules`
// must still be able to import this module and call `makeHandlers`, which
// needs neither dependency.
// A real dispatch with no SDK is loud about it — `factoryTools` throws below,
// naming the same three failures `load` collected.
let sdk = null
let sdkLoadError = null
try {
  sdk = await load('@anthropic-ai/claude-agent-sdk',
    '../fleet/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs')
} catch (err) { sdkLoadError = err; sdk = null }

let zodModule = null
let zodLoadError = null
try {
  zodModule = await load('zod', '../fleet/node_modules/zod/index.cjs')
} catch (err) { zodLoadError = err; zodModule = null }

/** The message a call with no SDK/zod gets — `sdkLoadError`'s or `zodLoadError`'s
 *  own text, whichever tripped first, unchanged from what `load` threw. */
const noSdkMessage = () => (sdkLoadError || zodLoadError).message

const { createSdkMcpServer, tool } = sdk || {}
/** zod ships CJS and ESM; a resolved-by-path CJS build arrives under `default`. */
const z = zodModule && (zodModule.z || (zodModule.default && zodModule.default.z) || zodModule.default)

/** The shape every handler answers. */
const say = (text) => ({ content: [{ type: 'text', text }] })

/** A tool that answers its own failure instead of ending the worker's turn. */
const answering = (handler) => async (args) => {
  try { return await handler(args) } catch (err) { return say('kata refused: ' + reason(err)) }
}

/**
 * What kata called the comment it just wrote. The client answers the ISSUE a
 * mutation left behind, so the uid on it is the issue's; a hub that grows a
 * `comment` envelope answers that instead. Either is the identifier the worker
 * would quote to a human, and an answer carrying neither is quoted whole rather
 * than silently reported as an empty string.
 */
const commentUid = (answer) => {
  if (typeof answer === 'string') return answer
  const a = answer || {}
  const uid = a.uid || (a.comment && a.comment.uid) || a.id
  return uid ? String(uid) : JSON.stringify(answer == null ? null : answer)
}

/**
 * The six handlers themselves — `note`, `hand`, `settled`, `sibling_fact`,
 * `task_facts`, `run_proof` — built and returned as plain async functions,
 * needing neither the SDK nor zod: `factoryTools` below wraps each in a
 * `tool(…)` definition (its zod input schema, description), but the handler
 * a call actually runs is exactly the function this makes.
 *
 * `kata` is the engine's client (`fleet/kata-client.mjs`), `projectId` the
 * run's project, `task` the `{ id, uid, files }` fact sheet. `candidates`
 * is the symbol names the ENGINE computed for this task — an array, or a
 * function (sync or async) answering one — read fresh on every `settled`
 * call, never captured once at build: a worker that writes a new export
 * between two calls sees it offered on the second. Nothing here derives a
 * candidate and nothing here holds a credential: the client was built
 * before the worker existed.
 */
export const makeHandlers = ({ kata, projectId, task, candidates, board, runProof } = {}) => {
  const uid = task && task.uid
  const taskId = task && task.id

  const readCandidates = async () => {
    const got = typeof candidates === 'function' ? await candidates() : candidates
    return Array.isArray(got) ? got : []
  }

  const note = answering(async ({ body }) =>
    say('noted: ' + commentUid(await kata.comment(projectId, uid, '[note]\n' + body))))

  const hand = answering(async ({ reason: why }) => {
    await patchWithRevision(kata, projectId, uid, {
      'work.attention': 'needs-human',
      'work.attention_msg': why,
    })
    return say('hand raised for a human: ' + why)
  })

  const settled = async ({ symbol, file }) => {
    let names
    try {
      names = (await readCandidates()).map(String)
    } catch (err) {
      // Not `answering`'s `kata refused:` — nothing here called kata, so
      // that prefix would misname what actually failed.
      return say('candidates unreadable: ' + reason(err))
    }
    if (!names.includes(symbol)) {
      const shell = typeof file === 'string' && file.endsWith('.sh')
      const found = names.length ? names.join(', ') : '(none)'
      return say(
        '"' + symbol + '" is not among the candidates this task can declare. ' +
        'Candidates found in your patch: ' + found + '. A candidate is a top-level export ' +
        'your patch adds — export function, export const, export class, def or class — ' +
        (shell ? 'and ' + file + ' is a shell file, whose functions are never candidates.'
          : 'add it first, then declare it.'),
      )
    }
    // Flat and dotted, and the value a JSON STRING: kata stores metadata keys
    // that way (CONTRACT.md's `metadata-dotted-flat`), so a nested object here
    // would land as keys no reader of the record knows to look for.
    await patchWithRevision(kata, projectId, uid, {
      'interface.settled': JSON.stringify({ symbol, file, task: taskId }),
    })
    return say('settled: ' + symbol + ' in ' + file)
  }

  const siblingFact = async ({ task_uid: siblingUid }) => {
    try {
      const issue = await kata.getIssue(siblingUid)
      return say(JSON.stringify((issue && issue.metadata) || {}, null, 2))
    } catch (err) {
      // Not an error a worker should stop on: a sibling that has not started
      // has no facts yet, and that is an answer.
      return say('no fact: ' + reason(err))
    }
  }

  const taskFacts = answering(async () => {
    if (!board) return say('no facts yet')
    const facts = await board.factsFor(taskId)
    return say(facts ? facts : 'no facts yet')
  })

  const runProofTool = async () => {
    const lines = (task && task.proofRuns) || []
    if (!lines.length || typeof runProof !== 'function') return say('run_proof unavailable')
    try {
      const results = await runProof()
      return say(results.map((r) => 'exit ' + r.exit + '\n' + r.tail).join('\n\n'))
    } catch (err) {
      return say('run_proof failed: ' + reason(err))
    }
  }

  return {
    note, hand, settled, sibling_fact: siblingFact, task_facts: taskFacts, run_proof: runProofTool,
  }
}

/**
 * The factory's MCP server, one per task. Builds `makeHandlers`' six
 * functions, then wraps each in a `tool(…)` definition — its zod input
 * schema and description unchanged from before this task — so
 * `server.handlers` and `makeHandlers`' own return answer the same
 * functions.
 *
 * Returns `createSdkMcpServer`'s own value — `{ type: 'sdk', name: 'factory',
 * instance }` — with the tool definitions and their handlers hung off it
 * non-enumerably, so a caller (a test, or an engine that wants to drive a
 * tool without a model) can invoke one directly without reaching into the MCP
 * server's private registry.
 */
export const factoryTools = (opts = {}) => {
  if (!sdk || !zodModule) throw new Error(noSdkMessage())
  const handlers = makeHandlers(opts)

  const note = tool(
    'note',
    'Post a note on this task\'s issue: the approach you are taking, a decision a ' +
    'later session would otherwise have to rediscover, or what you got done before ' +
    'stopping. The issue is the run\'s memory — write to it rather than to a file.',
    { body: z.string().describe('the note, in your own words') },
    handlers.note,
  )

  const hand = tool(
    'hand',
    'Raise your hand for a human. Use it when you are blocked on something no ' +
    'further work of yours can clear — a missing dependency, a contradiction in ' +
    'the task, a credential that is not there.',
    { reason: z.string().describe('one line saying what you are blocked on') },
    handlers.hand,
  )

  const settled = tool(
    'settled',
    'Declare the ONE symbol this task settled as its interface, chosen from the ' +
    'candidates the engine read out of your own patch. You cannot name a symbol ' +
    'you did not add — if the one you want is not offered, add it first.',
    {
      symbol: z.string().describe('the exported name, exactly as it appears in the code'),
      file: z.string().describe('the file that exports it, repository-relative'),
    },
    handlers.settled,
  )

  const siblingFact = tool(
    'sibling_fact',
    'Read a sibling task\'s facts — its issue metadata, which carries what that ' +
    'task settled and where it got to. Use it when your work has to meet a ' +
    'neighbour\'s contract; you will never see their code.',
    { task_uid: z.string().describe('the sibling task\'s issue uid') },
    handlers.sibling_fact,
  )

  const taskFacts = tool(
    'task_facts',
    'Re-read everything already known about this task — the same facts the next ' +
    'worker would be handed. Use it when you are stuck and need what earlier ' +
    'sessions on this task already worked out.',
    {},
    handlers.task_facts,
  )

  const runProofTool = tool(
    'run_proof',
    'Run this task\'s own Proof `Run:` lines and get back their real exit codes ' +
    'and output — the way to know whether the task is green or red. Prefer this ' +
    'over shelling the commands out yourself: a command piped through `tail` or ' +
    'followed by `echo EXIT:$?` can look clean in your own shell while the record ' +
    'behind it stays unable to say what actually happened.',
    {},
    handlers.run_proof,
  )

  const tools = [note, hand, settled, siblingFact, taskFacts, runProofTool]
  const server = createSdkMcpServer({ name: 'factory', tools })
  return Object.defineProperties(server, {
    tools: { value: tools },
    handlers: {
      value: Object.fromEntries(tools.map((t) => [t.name, t.handler])),
    },
  })
}

export default factoryTools
