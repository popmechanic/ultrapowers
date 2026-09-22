// fleet/tests/test_factory_tools.mjs — exam for: `settled` reads its
// candidates off the worker's own patch at each call, and a refusal names
// what it found.
//
// Legs (a)/(b)/(c) below exercise `makeHandlers` directly — no SDK, no zod,
// no network — against a fake kata client and a literal `git diff --cached`
// patch for one added file. M4 (the engine's wiring) and M5 (the README
// line) are proof legs outside this file, per the task's Proof block.

import assert from 'node:assert/strict'
import { makeHandlers } from '../../factory/tools.mjs'
import { candidatesOf } from '../../factory/engine.mjs'

const PATCH = 'diff --git a/factory/preflight.mjs b/factory/preflight.mjs\n' +
  'new file mode 100644\n' +
  'index 0000000000000000000000000000000000000000..1111111111111111111111111111111111111111\n' +
  '--- /dev/null\n' +
  '+++ b/factory/preflight.mjs\n' +
  '@@ -0,0 +1,3 @@\n' +
  '+export function classify (x) {\n' +
  '+  return x\n' +
  '+}\n'

const TASK = { id: 1, uid: 'u1', interfaces: {} }

// Sanity check on the fixture itself, ahead of the legs that lean on it:
// the task's Context asserts `candidatesOf` reads `['classify']` off this
// exact patch at BASE.
const sanity = candidatesOf(TASK, PATCH)
assert.deepEqual(sanity.names, ['classify'])

const makeKata = () => {
  const calls = []
  const kata = {
    getIssue: async () => ({ revision: 1 }),
    patchMetadata: async (projectId, uid, patch, revision) => {
      calls.push({ projectId, uid, patch, revision })
      return { uid }
    },
  }
  return { kata, calls }
}

// ── leg (a) [M1, M4]: an offered symbol drawn from the fresh-read candidates
// answers acceptance, and the metadata patch carries symbol/file/task. ─────

{
  const { kata, calls } = makeKata()
  const handlers = makeHandlers({
    kata,
    projectId: 'p',
    task: TASK,
    candidates: () => candidatesOf(TASK, PATCH).names,
  })
  const answer = await handlers.settled({ symbol: 'classify', file: 'factory/preflight.mjs' })
  assert.equal(answer.content[0].text, 'settled: classify in factory/preflight.mjs')
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(calls[0].patch['interface.settled']), {
    symbol: 'classify',
    file: 'factory/preflight.mjs',
    task: 1,
  })
}

// ── leg (b) [M2]: an offered symbol not among the candidates is refused with
// the pinned sentence, and no `patchMetadata` call is made for it. ─────────

{
  const { kata, calls } = makeKata()
  const handlers = makeHandlers({
    kata,
    projectId: 'p',
    task: TASK,
    candidates: () => candidatesOf(TASK, PATCH).names,
  })
  const answer = await handlers.settled({ symbol: 'preflight', file: 'factory/boot.sh' })
  assert.equal(
    answer.content[0].text,
    '"preflight" is not among the candidates this task can declare. Candidates found in ' +
    'your patch: classify. A candidate is a top-level export your patch adds — export ' +
    'function, export const, export class, def or class — and factory/boot.sh is a shell ' +
    'file, whose functions are never candidates.',
  )
  assert.equal(calls.length, 0)
}

// ── leg (c) [M3]: `candidates` is read fresh on every `settled` call, never
// once at build — a function returning `[]` then `['classify']` refuses the
// first offer and accepts the second, and is called exactly twice. ────────

{
  const { kata } = makeKata()
  let n = 0
  const handlers = makeHandlers({
    kata,
    projectId: 'p',
    task: TASK,
    candidates: () => {
      n += 1
      return n === 1 ? [] : ['classify']
    },
  })
  const first = await handlers.settled({ symbol: 'classify', file: 'factory/preflight.mjs' })
  assert.equal(
    first.content[0].text.startsWith(
      '"classify" is not among the candidates this task can declare. Candidates found in ' +
      'your patch: (none).',
    ),
    true,
  )
  const second = await handlers.settled({ symbol: 'classify', file: 'factory/preflight.mjs' })
  assert.equal(second.content[0].text, 'settled: classify in factory/preflight.mjs')
  assert.equal(n, 2)
}

console.log('ALL TESTS PASSED')
