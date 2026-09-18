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
import { pathToFileURL } from 'node:url'

const reason = (err) => (err && err.message) || String(err)

/**
 * The SDK and its zod both live in `fleet/node_modules` — the install
 * `fleet/sandbox-boot.sh` performs against `fleet/package.json`. A bare
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
    'fleet/node_modules by fleet/sandbox-boot.sh against fleet/package.json. Tried: ' +
    failures.join(' ‖ '))
}

// Top-level await, so `factoryTools` below stays an ordinary synchronous call:
// an importer of this module awaits its evaluation for free, and the exam's
// `factoryTools({…}).name` is a property and not a promise.
const sdk = await load('@anthropic-ai/claude-agent-sdk',
  '../fleet/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs')
const zodModule = await load('zod', '../fleet/node_modules/zod/index.cjs')

const { createSdkMcpServer, tool } = sdk
/** zod ships CJS and ESM; a resolved-by-path CJS build arrives under `default`. */
const z = zodModule.z || (zodModule.default && zodModule.default.z) || zodModule.default

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
 * The factory's MCP server, one per task.
 *
 * `kata` is the engine's client (`fleet/kata-client.mjs`), `projectId` the run's
 * project, `task` the `{ id, uid, files }` fact sheet, and `candidates` the
 * symbol names the engine computed for this task. Nothing here derives a
 * candidate and nothing here holds a credential: the client was built before
 * the worker existed.
 *
 * Returns `createSdkMcpServer`'s own value — `{ type: 'sdk', name: 'factory',
 * instance }` — with the tool definitions and their handlers hung off it
 * non-enumerably, so a caller (the exam, or an engine that wants to drive a
 * tool without a model) can invoke one directly without reaching into the MCP
 * server's private registry.
 */
export const factoryTools = ({ kata, projectId, task, candidates, board, runExam } = {}) => {
  const uid = task && task.uid
  const taskId = task && task.id
  const names = (Array.isArray(candidates) ? candidates : []).map((c) => String(c))

  const note = tool(
    'note',
    'Post a note on this task\'s issue: the approach you are taking, a decision a ' +
    'later session would otherwise have to rediscover, or what you got done before ' +
    'stopping. The issue is the run\'s memory — write to it rather than to a file.',
    { body: z.string().describe('the note, in your own words') },
    answering(async ({ body }) =>
      say('noted: ' + commentUid(await kata.comment(projectId, uid, '[note]\n' + body)))),
  )

  const hand = tool(
    'hand',
    'Raise your hand for a human. Use it when you are blocked on something no ' +
    'further work of yours can clear — a missing dependency, a contradiction in ' +
    'the task, a credential that is not there.',
    { reason: z.string().describe('one line saying what you are blocked on') },
    answering(async ({ reason: why }) => {
      await kata.patchMetadata(projectId, uid, {
        'work.attention': 'needs-human',
        'work.attention_msg': why,
      })
      return say('hand raised for a human: ' + why)
    }),
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
    answering(async ({ symbol, file }) => {
      if (!names.includes(symbol)) {
        return say('"' + symbol + '" is not among the candidates this task can declare: ' +
          (names.length ? names.join(', ') : '(none — the patch added no export)'))
      }
      // Flat and dotted, and the value a JSON STRING: kata stores metadata keys
      // that way (CONTRACT.md's `metadata-dotted-flat`), so a nested object here
      // would land as keys no reader of the record knows to look for.
      await kata.patchMetadata(projectId, uid, {
        'interface.settled': JSON.stringify({ symbol, file, task: taskId }),
      })
      return say('settled: ' + symbol + ' in ' + file)
    }),
  )

  const siblingFact = tool(
    'sibling_fact',
    'Read a sibling task\'s facts — its issue metadata, which carries what that ' +
    'task settled and where it got to. Use it when your work has to meet a ' +
    'neighbour\'s contract; you will never see their code.',
    { task_uid: z.string().describe('the sibling task\'s issue uid') },
    async ({ task_uid: siblingUid }) => {
      try {
        const issue = await kata.getIssue(siblingUid)
        return say(JSON.stringify((issue && issue.metadata) || {}, null, 2))
      } catch (err) {
        // Not an error a worker should stop on: a sibling that has not started
        // has no facts yet, and that is an answer.
        return say('no fact: ' + reason(err))
      }
    },
  )

  const taskFacts = tool(
    'task_facts',
    'Re-read everything already known about this task — the same facts the next ' +
    'worker would be handed. Use it when you are stuck and need what earlier ' +
    'sessions on this task already worked out.',
    {},
    answering(async () => {
      if (!board) return say('no facts yet')
      const facts = await board.factsFor(taskId)
      return say(facts ? facts : 'no facts yet')
    }),
  )

  const runExamTool = tool(
    'run_exam',
    'Run this task\'s exam and get back its real exit code and output — the way ' +
    'to know whether the task is green or red. Prefer this over shelling the test ' +
    'command out yourself: a command piped through `tail` or followed by `echo ' +
    'EXIT:$?` can look clean in your own shell while the record behind it stays ' +
    'unable to say what actually happened.',
    {},
    async () => {
      if (typeof runExam !== 'function') return say('run_exam unavailable')
      try {
        const { exit, tail } = await runExam()
        return say('exit ' + exit + '\n' + tail)
      } catch (err) {
        return say('run_exam failed: ' + reason(err))
      }
    },
  )

  const tools = [note, hand, settled, siblingFact, taskFacts, runExamTool]
  const server = createSdkMcpServer({ name: 'factory', tools })
  return Object.defineProperties(server, {
    tools: { value: tools },
    handlers: {
      value: Object.fromEntries(tools.map((t) => [t.name, t.handler])),
    },
  })
}

export default factoryTools
