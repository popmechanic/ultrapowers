/**
 * fleet/tests/test_launch_compile_facts.mjs — the exam for "The launcher
 * carries the compiler's STALE fact lines onto the launch line" (task 2).
 *
 * The surface is what the launch line carries from the compile: the compiler
 * now says something about the Stale-if predicates it read at `--base`, and
 * the operator on the laptop must see it — as an advisory beside the base
 * facts when the compile is clean, and as the compiler's own refusal line when
 * a predicate holds. Nothing here drives a launch: the exam reads
 * `verifyPlanCompiles` through a hand-written `exec` seam and `renderLaunch`
 * over a plain result object, so what is pinned is the two functions and the
 * two sentences that document them.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] a fake `exec` answering exit 0 with `PLAN OK`, one `BASE fact:`
 *       line, one `STALE fact: … unreadable at BASE — …` line and one `note:`
 *       line makes `verifyPlanCompiles` resolve to exactly the two fact lines,
 *       in that order and with no other line; the same two lines answered in
 *       the other order resolve in THAT order, because M1 says stdout order
 *       and not a sort; and a stdout of `PLAN OK` alone resolves to `[]`.
 *   (b) [M2] a fake `exec` answering exit 2 with the refusal-shaped
 *       `STALE fact: task 1: path-exists: `present.py` holds at BASE` on
 *       stdout makes it reject with a `Refusal` whose message carries
 *       `compile_plan.py --check --base`, `refused` and that line verbatim —
 *       and the fake was called once, with `python3` and an argv carrying
 *       `--check` and `--base <base>`.
 *   (c) [M3] `renderLaunch` of a result whose `baseFacts` is
 *       `['BASE fact: x', 'STALE fact: y']` yields text whose LAST two lines
 *       are those two in that order; the same result with no `baseFacts`
 *       yields text carrying neither.
 *   (d) [M4] the two `Run:` lines of the Proof, read in process: the
 *       `## Per run` section of `fleet/RUNBOOK.md` names `BASE fact:`, then
 *       `STALE fact:`, then the launch line, in that order; and `CLAUDE.md`
 *       names `STALE fact:` at all, with its Layout section naming it after
 *       the `compile_plan.py --check --base` flag.
 *
 * Hermetic by construction: the only imports are `../launch.mjs` and
 * `../lobby.mjs`, `exec` is a local async function that returns
 * `{ code, stdout, stderr }` and records its calls, no process is spawned, no
 * socket is opened, and the only files read are the two documents of M4,
 * resolved from this file's own location inside the checkout.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderLaunch, verifyPlanCompiles } from '../launch.mjs'
import { Refusal } from '../lobby.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(FLEET_DIR, '..')
const RUNBOOK = path.join(FLEET_DIR, 'RUNBOOK.md')
const CLAUDE_MD = path.join(REPO_ROOT, 'CLAUDE.md')

const BASE = 'a'.repeat(40)
const PLAN_PATH = '/plans/a-plan.md'
/** A plan with no generated stamp block, so the hash-pin read passes through. */
const PLAN_TEXT = '# a plan\n\nOne plan, and a trailing newline.\n'

/** The compiler's two line shapes, as literals shared with the compiler task. */
const BASE_FACT = 'BASE fact: task 1: `present.py` is carried at BASE by tests/test_present.py — not in its Files'
const STALE_ADVISORY = 'STALE fact: task 1: issue-open: #538 unreadable at BASE — gh not on PATH'
const STALE_REFUSAL = 'STALE fact: task 1: path-exists: `present.py` holds at BASE'

/** A recording `exec` seam: every call is appended, one canned answer for all. */
const fakeExec = (res) => {
  const calls = []
  const exec = async (cmd, argv, options) => {
    calls.push({ cmd, argv: [...argv], options })
    return { code: 0, stdout: '', stderr: '', ...res }
  }
  exec.calls = calls
  return exec
}

const compile = (exec) => verifyPlanCompiles({
  exec, repoDir: FLEET_DIR, base: BASE, planPath: PLAN_PATH, planText: PLAN_TEXT
})

/** What `fn` threw, or `undefined` when it did not throw. */
const thrown = async (fn) => {
  try {
    await fn()
    return undefined
  } catch (err) {
    return err
  }
}

/**
 * The `sed -n '/^<from>/,/^<to>/p'` of a `Run:` line, in process: from the
 * first line starting `from` through the next line starting `to`, joined on
 * spaces the way `tr '\n' ' '` joins them.
 */
const sectionOf = (text, from, to) => {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.startsWith(from))
  if (start < 0) return null
  const after = lines.slice(start + 1).findIndex((line) => line.startsWith(to))
  const end = after < 0 ? lines.length : start + after + 2
  return lines.slice(start, end).join(' ')
}

/** A section is a paragraph or six; a failure quotes the part that matters. */
const near = (text, mark, span = 320) => {
  const at = text.indexOf(mark)
  const from = at < 0 ? 0 : at
  return `${from > 0 ? '…' : ''}${text.slice(from, from + span)}${from + span < text.length ? '…' : ''}`
}

// ── The runner: every leg is attempted, and every failure is named ──────────

const failures = []
const test = async (name, fn) => {
  try {
    await fn()
  } catch (err) {
    failures.push({ name, err })
  }
}

// ── a. [M1] a clean compile's fact lines are both kinds, in stdout order ────

await test('(a) [M1] a clean compile resolves to its BASE and STALE fact lines, and nothing else', async () => {
  const exec = fakeExec({
    code: 0,
    stdout: `PLAN OK\n${BASE_FACT}\n${STALE_ADVISORY}\nnote: 3 tasks in 2 waves\n`
  })
  const facts = await compile(exec)
  assert.deepEqual(
    facts, [BASE_FACT, STALE_ADVISORY],
    '(a) [M1] exit 0 with PLAN OK, one BASE fact: line, one STALE fact: advisory and one note: line ' +
    'resolves to exactly those two fact lines, in stdout order and with no other line'
  )
})

await test('(a) [M1] the order is stdout\'s, not a sort by kind', async () => {
  const exec = fakeExec({
    code: 0,
    stdout: `PLAN OK\n${STALE_ADVISORY}\n${BASE_FACT}\n`
  })
  assert.deepEqual(
    await compile(exec), [STALE_ADVISORY, BASE_FACT],
    '(a) [M1] the same two lines answered STALE-first resolve STALE-first: M1 says stdout order'
  )
})

await test('(a) [M1] a compile that states no fact resolves to the empty list', async () => {
  const exec = fakeExec({ code: 0, stdout: 'PLAN OK\n' })
  assert.deepEqual(
    await compile(exec), [],
    '(a) [M1] a stdout of PLAN OK alone resolves to []'
  )
})

// ── b. [M2] a predicate that holds refuses the launch, in the compiler's words ─

await test('(b) [M2] exit 2 carrying a STALE fact: line is a Refusal that quotes it verbatim', async () => {
  const exec = fakeExec({
    code: 2,
    stdout: `a-plan.md: 1 violation\n${STALE_REFUSAL}\n`,
    stderr: ''
  })
  const err = await thrown(() => compile(exec))
  assert.ok(
    err instanceof Refusal,
    `(b) [M2] a compiler answering exit 2 rejects with a Refusal, got ${err?.name}: ${err?.message}`
  )
  assert.ok(
    err.message.includes('compile_plan.py --check --base'),
    `(b) [M2] the refusal names compile_plan.py --check --base, got: ${err.message}`
  )
  assert.ok(
    err.message.includes('refused'),
    `(b) [M2] the refusal says refused, got: ${err.message}`
  )
  assert.ok(
    err.message.includes(STALE_REFUSAL),
    `(b) [M2] the refusal carries ${JSON.stringify(STALE_REFUSAL)} verbatim — that line is what the ` +
    `operator reads on the laptop — got: ${err.message}`
  )
})

await test('(b) [M2] the refused compile was the one subprocess, asked for --check at --base', async () => {
  const exec = fakeExec({ code: 2, stdout: `${STALE_REFUSAL}\n` })
  await thrown(() => compile(exec))
  assert.equal(
    exec.calls.length, 1,
    `(b) [M2] the fake exec was called once, got ${exec.calls.length}: ` +
    `${exec.calls.map((c) => `${c.cmd} ${c.argv.join(' ')}`).join(' | ')}`
  )
  const call = exec.calls[0]
  assert.equal(call.cmd, 'python3', '(b) [M2] the compiler runs through the exec seam as python3')
  assert.ok(call.argv.includes('--check'), `(b) [M2] the argv carries --check, got: ${call.argv.join(' ')}`)
  assert.equal(
    call.argv[call.argv.indexOf('--base') + 1], BASE,
    `(b) [M2] the argv carries --base <base>, got: ${call.argv.join(' ')}`
  )
})

// ── c. [M3] the facts are the last lines of the launch line ─────────────────

const RESULT = {
  runId: 'run-137',
  vm: 'fleet-r137-0915-ab12',
  statusUrl: 'https://exe.dev/vms/fleet-r137-0915-ab12',
  comment: 'ultrapowers run-137',
  engine: 'b'.repeat(40),
  engineSha: 'b'.repeat(40),
  engineSource: 'main-tip'
}

await test('(c) [M3] a result\'s baseFacts entries end the rendered launch line, in order', () => {
  const facts = ['BASE fact: x', 'STALE fact: y']
  const lines = renderLaunch({ ...RESULT, baseFacts: facts }).split('\n')
  assert.deepEqual(
    lines.slice(-2), facts,
    `(c) [M3] the last two lines of the rendered text are the baseFacts entries in order, got: ` +
    `${JSON.stringify(lines)}`
  )
  assert.equal(
    lines.filter((line) => line === 'BASE fact: x').length, 1,
    '(c) [M3] each entry is printed once'
  )
  assert.equal(
    lines.filter((line) => line === 'STALE fact: y').length, 1,
    '(c) [M3] each entry is printed once'
  )
})

await test('(c) [M3] a result with no baseFacts prints no fact line at all', () => {
  const text = renderLaunch({ ...RESULT })
  assert.ok(
    !text.includes('BASE fact:'),
    `(c) [M3] no baseFacts, no BASE fact: line, got: ${JSON.stringify(text)}`
  )
  assert.ok(
    !text.includes('STALE fact:'),
    `(c) [M3] no baseFacts, no STALE fact: line, got: ${JSON.stringify(text)}`
  )
})

// ── d. [M4] the two documents say what the launch line carries ──────────────

await test('(d) [M4] fleet/RUNBOOK.md §Per run names BASE fact:, then STALE fact:, then the launch line', () => {
  const section = sectionOf(fs.readFileSync(RUNBOOK, 'utf8'), '## Per run', '## ')
  assert.ok(section !== null, '(d) [M4] fleet/RUNBOOK.md has a `## Per run` section')
  assert.match(
    section, /BASE fact:.*STALE fact:.*launch line/,
    '(d) [M4] the `## Per run` section says the STALE fact: lines of a clean compile print on the ' +
    `launch line beside the BASE fact: lines, got: ${near(section, 'BASE fact:')}`
  )
})

await test('(d) [M4] CLAUDE.md\'s fleet/ Layout bullet names STALE fact: after the compile flag', () => {
  const claude = fs.readFileSync(CLAUDE_MD, 'utf8')
  assert.ok(
    claude.includes('STALE fact:'),
    '(d) [M4] CLAUDE.md names STALE fact: at all'
  )
  const layout = sectionOf(claude, '## Layout', '## Doctrine')
  assert.ok(layout !== null, '(d) [M4] CLAUDE.md has a `## Layout` section')
  assert.match(
    layout, /compile_plan\.py --check --base.*STALE fact:/,
    '(d) [M4] the Layout section says the launcher\'s compile prints STALE fact: lines as well, ' +
    `after the compile_plan.py --check --base flag, got: ${near(layout, 'compile_plan.py --check --base')}`
  )
})

/**
 * ── "The launcher carries the AUTHORING fact line onto the launch line"
 * (task 4) ──────────────────────────────────────────────────────────────────
 *
 * The same surface, one kind wider: the compiler now prints an `AUTHORING
 * fact:` line after its BASE and STALE facts under `--check --base`, and the
 * operator must read what the authoring cost among the fact lines that end the
 * launch text, without opening the record. Nothing new is imported and nothing
 * new is spawned: these legs use this file's own `fakeExec`, `compile` and
 * `sectionOf` helpers, and the legs above stay green because a stdout carrying
 * no `AUTHORING fact:` line still resolves to exactly its BASE and STALE lines.
 *
 *   (a) [M1] a fake `exec` answering exit 0 with `PLAN OK`, one `BASE fact:`
 *       line, one `STALE fact: … unreadable at BASE — …` line, the Context's
 *       example `AUTHORING fact:` line and one `note:` line makes
 *       `verifyPlanCompiles` resolve to exactly those three fact lines, in that
 *       order and with no other line.
 *   (b) [M1] the same lines answered `AUTHORING fact:` first resolve with it
 *       first — M1 says stdout order, not a sort by kind — and
 *       `AUTHORING fact: none recorded`, the shape the compiler prints for a
 *       record with no `authoring` key, is carried like any other.
 *   (c) [M1] `renderLaunch` of a result whose `baseFacts` is
 *       `['BASE fact: x', 'AUTHORING fact: none recorded']` yields text whose
 *       LAST line is the `AUTHORING fact:` entry.
 *   (d) [M2] the `## Per run` section of `fleet/RUNBOOK.md`, read as the text
 *       between that heading and the next `## `, matches
 *       `BASE fact:.*STALE fact:.*AUTHORING fact:.*launch line`.
 */

/**
 * The compiler's third line shape, as the literal every task in this plan
 * shares: a record of 118 minutes, 12 probes, 4 dispatches, 1 rejected, routing
 * `risk`/`ultrapowers` and one question picked as recommended is exactly this.
 */
const AUTHORING_FACT =
  'AUTHORING fact: 118 min to PLAN OK, 12 hub probes, 4 gate dispatches, 1 rejected, ' +
  'routing risk->ultrapowers, 1 questions, 1/1 recommended picked'

/** What the compiler prints when the gate record carries no `authoring` key. */
const AUTHORING_NONE = 'AUTHORING fact: none recorded'

await test('(a) [M1] task 4: a clean compile resolves to its BASE, STALE and AUTHORING fact lines, and nothing else', async () => {
  const exec = fakeExec({
    code: 0,
    stdout: `PLAN OK\n${BASE_FACT}\n${STALE_ADVISORY}\n${AUTHORING_FACT}\nnote: 3 tasks in 2 waves\n`
  })
  const facts = await compile(exec)
  assert.deepEqual(
    facts, [BASE_FACT, STALE_ADVISORY, AUTHORING_FACT],
    '(a) [M1] exit 0 with PLAN OK, one BASE fact: line, one STALE fact: advisory, the AUTHORING fact: ' +
    'line and one note: line resolves to exactly those three fact lines, in stdout order and with no ' +
    `other line, got: ${JSON.stringify(facts)}`
  )
})

await test('(b) [M1] task 4: the order is stdout\'s, and `none recorded` is carried like any other', async () => {
  const first = fakeExec({
    code: 0,
    stdout: `PLAN OK\n${AUTHORING_FACT}\n${BASE_FACT}\n${STALE_ADVISORY}\nnote: 3 tasks in 2 waves\n`
  })
  assert.deepEqual(
    await compile(first), [AUTHORING_FACT, BASE_FACT, STALE_ADVISORY],
    '(b) [M1] the same three lines answered AUTHORING-first resolve AUTHORING-first: M1 says stdout order'
  )
  const none = fakeExec({
    code: 0,
    stdout: `PLAN OK\n${BASE_FACT}\n${AUTHORING_NONE}\nnote: 3 tasks in 2 waves\n`
  })
  assert.deepEqual(
    await compile(none), [BASE_FACT, AUTHORING_NONE],
    `(b) [M1] ${JSON.stringify(AUTHORING_NONE)} — the line for a record with no authoring key — is ` +
    'carried like any other AUTHORING fact: line'
  )
})

await test('(c) [M1] task 4: a result\'s AUTHORING fact: entry is the last line of the rendered launch line', () => {
  const facts = ['BASE fact: x', AUTHORING_NONE]
  const lines = renderLaunch({ ...RESULT, baseFacts: facts }).split('\n')
  assert.equal(
    lines.at(-1), AUTHORING_NONE,
    `(c) [M1] the last line of the rendered text is the AUTHORING fact: entry, so the launch line ends ` +
    `with what the authoring cost, got: ${JSON.stringify(lines)}`
  )
  assert.deepEqual(
    lines.slice(-2), facts,
    `(c) [M1] both baseFacts entries end the launch text, in order, got: ${JSON.stringify(lines)}`
  )
})

await test('(d) [M2] task 4: fleet/RUNBOOK.md §Per run names BASE fact:, then STALE fact:, then AUTHORING fact:, then the launch line', () => {
  const section = sectionOf(fs.readFileSync(RUNBOOK, 'utf8'), '## Per run', '## ')
  assert.ok(section !== null, '(d) [M2] fleet/RUNBOOK.md has a `## Per run` section')
  assert.match(
    section, /BASE fact:.*STALE fact:.*AUTHORING fact:.*launch line/,
    '(d) [M2] the `## Per run` section says the AUTHORING fact: line of a clean compile prints on the ' +
    'launch line beside the BASE fact: and STALE fact: lines, in that order, got: ' +
    `${near(section, 'BASE fact:')}`
  )
})

// ── The verdict ─────────────────────────────────────────────────────────────

if (failures.length > 0) {
  for (const { name, err } of failures) {
    console.error(`FAILED ${name}\n  ${err?.message ?? err}`)
  }
  console.error(`${failures.length} failing leg${failures.length === 1 ? '' : 's'}`)
  process.exit(1)
}

console.log('ALL TESTS PASSED')
