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
 * Hermetic by construction: `exec` is a local async function that returns
 * `{ code, stdout, stderr }` and records its calls, no process is spawned by
 * these legs, no socket is opened, and the only files read are the two
 * documents of M4, resolved from this file's own location inside the checkout.
 *
 * The task-1 section at the bottom of this file adds legs that DO drive
 * `launch()`, over the local fixture repository `./_lobby_helpers.mjs` builds —
 * a helper, never a sibling sim. Its own header says what it pins.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as launchModule from '../launch.mjs'
import { compilePlanForRun, launch, renderLaunch, verifyPlanCompiles } from '../launch.mjs'
import { ENGINE_REPO, Refusal, defaultExec } from '../lobby.mjs'
import {
  answer, cleanup, cmdRule, makeExec, makeTargetRepo, sshRule, tempDir, vmsPayload
} from './_lobby_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(FLEET_DIR, '..')
const RUNBOOK = path.join(FLEET_DIR, 'RUNBOOK.md')
const CLAUDE_MD = path.join(REPO_ROOT, 'CLAUDE.md')
const CONTRACT = path.join(FLEET_DIR, 'CONTRACT.md')
const DUPLICATE_SIM = path.join(HERE, 'test_launch_duplicate.mjs')

/**
 * The compiler the two compile helpers are handed: a path the fetch of M1 would
 * have written, never a path under the plugin's own scripts directory. Every
 * call below passes one, because M2 makes it required.
 */
const FETCHED_COMPILER = '/tmp/x/compile_plan.py'
/** The directory no `python3` argv a launch issues may name (M2). */
const PLUGIN_SCRIPTS = path.join(REPO_ROOT, 'skills', 'ultrapowers', 'scripts') + path.sep

const BASE = 'a'.repeat(40)
const PLAN_PATH = '/plans/a-plan.md'
/** A plan with no generated stamp block, so the hash-pin read passes through. */
const PLAN_TEXT = '# a plan\n\nOne plan, and a trailing newline.\n'

/** The compiler's two line shapes, as literals shared with the compiler task. */
const BASE_FACT = 'BASE fact: task 1: `present.py` is carried at BASE by tests/test_present.py — not in its Files'
const STALE_ADVISORY = 'STALE fact: task 1: issue-open: #538 unreadable at BASE — gh not on PATH'
const STALE_REFUSAL = 'STALE fact: task 1: path-exists: `present.py` holds at BASE'

/**
 * A recording `exec` seam: every call is appended. `res` is one canned answer
 * for every call, or a function of `(cmd, argv, options)` answering each.
 */
const fakeExec = (res) => {
  const calls = []
  const exec = async (cmd, argv, options) => {
    calls.push({ cmd, argv: [...argv], options })
    const one = typeof res === 'function' ? res(cmd, argv, options) : res
    return { code: 0, stdout: '', stderr: '', ...one }
  }
  exec.calls = calls
  return exec
}

/**
 * The `--check` compile, with the compiler M2 makes a required argument: the
 * launcher's compiles run the copy the fetch wrote, so every call here names
 * one. The fact lines these legs read are the ones `verifyPlanCompiles`
 * resolves to, whatever path it was pointed at.
 */
const compile = (exec, compilerPath = FETCHED_COMPILER) => verifyPlanCompiles({
  exec, repoDir: FLEET_DIR, base: BASE, planPath: PLAN_PATH, planText: PLAN_TEXT, compilerPath
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

/**
 * ── "The launcher fetches the compiler at the engine sha, runs that copy,
 * prints `compiler=<sha>`, and refuses when it cannot fetch it" (task 1) ─────
 *
 * The surface is which `compile_plan.py` the launch's two compiles ran. At BASE
 * they ran the plugin cache's copy while the sandbox's preflight ran the engine
 * checkout at `engine=`, which is how run-26 compiled `PLAN OK` on the laptop
 * and was refused at preflight by a rule the cache did not carry. So: the
 * launcher fetches the compiler at the engine sha it is about to hand the VM,
 * runs THAT file, says which sha it ran (`compiler=<sha>`), and refuses on the
 * laptop — before any compile, any push and any lobby verb — when it cannot
 * fetch it.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] a fake `exec` answering `git show` with a body makes
 *       `fetchCompilerAt({ exec, engine, pluginRoot })` resolve to a
 *       `scriptPath` under `os.tmpdir()` and not under
 *       `<pluginRoot>/skills/ultrapowers/scripts/`, whose content equals that
 *       body, with `source` `git-show`, no `gh` call recorded, and the one `git`
 *       call's argv deep-equal to
 *       `['-C', pluginRoot, 'show', engine + ':skills/ultrapowers/scripts/compile_plan.py']`;
 *       a fake answering `git show` exit 128 and then `gh api` with a body
 *       resolves the same way with `source` `gh-api` and the four `gh` argv
 *       elements M1 spells; and a `git show` that exits 0 with an EMPTY stdout
 *       still goes on to `gh api`.
 *   (b) [M2] `verifyPlanCompiles` and `compilePlanForRun` place the
 *       `compilerPath` they are given first in their `python3` argv, name no
 *       path under `<pluginRoot>/skills/ultrapowers/scripts/`, and reject when
 *       called without one; and in a resolved `launch()` drive both `python3`
 *       calls — the `--check` compile and the `--stamp` compile — carry the same
 *       first argument, under `os.tmpdir()`, whose bytes on disk at call time
 *       are the body the seam answered the fetch with.
 *   (c) [M3] two failed fetches make `fetchCompilerAt` reject with a `Refusal`
 *       naming the engine sha and `compile_plan.py`; and a `launch()` drive
 *       whose seam fails both fetches rejects with a `Refusal` having issued no
 *       `python3`, no `git push` and no mutating lobby verb.
 *   (d) [M4] with `--engine <sha>` a refused drive's `git show` argv carries
 *       `<sha>:skills/ultrapowers/scripts/compile_plan.py` and its `Refusal`
 *       names that sha; a resolved drive with no `--engine` resolves to
 *       `compiler` equal to the sha `ls-remote` answered, fetches at that same
 *       sha, and issues both the `ls-remote` and that `git show` BEFORE its
 *       first `python3`; and `renderLaunch` prints exactly one `compiler=<sha>`
 *       line for a result carrying `compiler` and none for a result without it.
 *   (e) [M5] the CONTRACT `Run:` line of the Proof, read in process: the
 *       `**Launch order (launcher):**` bullet says the compiles run the compiler
 *       fetched at `engine=`, that a launch whose compiler cannot be fetched is
 *       refused before any push, and that the launch line carries
 *       `compiler=<sha>`.
 *   (f) [M6] the duplicate sim's seam answers the fetch of M1. The half of this
 *       leg that RUNS `fleet/tests/test_launch_duplicate.mjs` is the Proof's own
 *       `Run:` line, not this exam's: an exam proves its own claim and never
 *       spawns another exam. What is checked here inspects that file and runs
 *       nothing — it names `compile_plan.py` or `show`, what a rule answering
 *       the fetch of M1 keys on, so its seam has something to match it with.
 *
 * Still hermetic: the launch drives use `./_lobby_helpers.mjs` (a helper, not a
 * sibling sim), whose target repository is a real local bare origin, every
 * lobby verb and every `gh` call is answered by the seam, and no socket is
 * opened.
 */

// ── The rig ─────────────────────────────────────────────────────────────────

/** A launch.mjs export this task adds, or a failure that says it is missing. */
const exported = (name) => {
  const value = launchModule[name]
  if (typeof value !== 'function') {
    throw new Error(
      `fleet/launch.mjs exports no ${name}() — the launcher does not fetch its compiler at the engine sha yet`
    )
  }
  return value
}

/** The checkout `launch.mjs` sits in: on the laptop, the plugin cache. */
const PLUGIN_ROOT = REPO_ROOT
/** The object name both fetches of M1 ask for. */
const COMPILER_OBJECT = 'skills/ultrapowers/scripts/compile_plan.py'
/** The raw media type that makes `gh api` print the file body on stdout. */
const RAW_ACCEPT = 'Accept: application/vnd.github.raw'
const contentsPath = (sha) => `repos/${ENGINE_REPO}/contents/${COMPILER_OBJECT}?ref=${sha}`

const PINNED_ENGINE = 'b'.repeat(40)
const TIP_ENGINE = 'c'.repeat(40)
const SHOW_BODY = '#!/usr/bin/env python3\n# fetched with git show\n'
const API_BODY = '#!/usr/bin/env python3\n# fetched with gh api\n'

const TMP = os.tmpdir()
const TMP_REAL = fs.realpathSync(TMP)
/** A path inside the machine's temp directory, symlinked `/tmp` included. */
const underTmp = (p) => {
  const s = String(p ?? '')
  if (s.startsWith(`${TMP}${path.sep}`) || s.startsWith(`${TMP_REAL}${path.sep}`)) return true
  try {
    return fs.realpathSync(path.dirname(s)).startsWith(TMP_REAL)
  } catch {
    return false
  }
}
const rmDir = (dir) => {
  if (typeof dir === 'string' && dir !== '') fs.rmSync(dir, { recursive: true, force: true })
}
const namesCompiler = (argv) => argv.some((a) => String(a).includes('compile_plan.py'))
const callLine = (call) => `${call.cmd} ${call.argv.join(' ')}`

// ── a. [M1] the fetch: `git show` from the plugin checkout, else `gh api` ────

await test('(a) [M1] a `git show` that answers a body is written under os.tmpdir() and is the compiler', async () => {
  const fetchCompilerAt = exported('fetchCompilerAt')
  const exec = fakeExec((cmd) => (cmd === 'git' ? { code: 0, stdout: SHOW_BODY } : { code: 0, stdout: API_BODY }))
  const got = await fetchCompilerAt({ exec, engine: PINNED_ENGINE, pluginRoot: PLUGIN_ROOT })
  try {
    assert.equal(got.source, 'git-show', `(a) [M1] source is git-show, got ${JSON.stringify(got.source)}`)
    assert.ok(
      underTmp(got.scriptPath),
      `(a) [M1] the compiler is written under ${TMP}, not read out of the plugin cache, got ${got.scriptPath}`
    )
    assert.ok(
      !String(got.scriptPath).startsWith(PLUGIN_SCRIPTS),
      `(a) [M1] and not under ${PLUGIN_SCRIPTS} — that copy is the trap this closes, got ${got.scriptPath}`
    )
    assert.equal(
      got.scriptPath, path.join(got.dir, 'compile_plan.py'),
      '(a) [M1] the first non-empty stdout is written as <dir>/compile_plan.py'
    )
    assert.equal(
      fs.readFileSync(got.scriptPath, 'utf8'), SHOW_BODY,
      '(a) [M1] and what it holds is the bytes `git show` printed'
    )
    const gitCalls = exec.calls.filter((c) => c.cmd === 'git')
    assert.equal(
      gitCalls.length, 1,
      `(a) [M1] exactly one git call, got: ${exec.calls.map(callLine).join(' | ')}`
    )
    assert.deepEqual(
      gitCalls[0].argv,
      ['-C', PLUGIN_ROOT, 'show', `${PINNED_ENGINE}:${COMPILER_OBJECT}`],
      '(a) [M1] the git argv is the plugin checkout and that object name exactly — a show in another ' +
      `directory or of another object is a different file, got: ${gitCalls[0].argv.join(' ')}`
    )
    assert.equal(
      exec.calls.filter((c) => c.cmd === 'gh').length, 0,
      '(a) [M1] a `git show` that answered a body is the whole fetch: no `gh` call is made'
    )
  } finally {
    rmDir(got?.dir)
  }
})

await test('(a) [M1] a `git show` that exits 128 falls through to `gh api`, raw media type and all', async () => {
  const fetchCompilerAt = exported('fetchCompilerAt')
  const exec = fakeExec((cmd) =>
    (cmd === 'git' ? { code: 128, stdout: '', stderr: 'fatal: not in the cache\n' } : { code: 0, stdout: API_BODY }))
  const got = await fetchCompilerAt({ exec, engine: PINNED_ENGINE, pluginRoot: PLUGIN_ROOT })
  try {
    assert.equal(got.source, 'gh-api', `(a) [M1] source is gh-api, got ${JSON.stringify(got.source)}`)
    assert.ok(underTmp(got.scriptPath), `(a) [M1] written under ${TMP}, got ${got.scriptPath}`)
    assert.ok(
      !String(got.scriptPath).startsWith(PLUGIN_SCRIPTS),
      `(a) [M1] and not under ${PLUGIN_SCRIPTS}, got ${got.scriptPath}`
    )
    assert.equal(
      fs.readFileSync(got.scriptPath, 'utf8'), API_BODY,
      '(a) [M1] and holds what `gh api` printed — the raw media type makes stdout the file body'
    )
    const ghCalls = exec.calls.filter((c) => c.cmd === 'gh')
    assert.equal(ghCalls.length, 1, `(a) [M1] exactly one gh call, got: ${exec.calls.map(callLine).join(' | ')}`)
    for (const element of ['api', '-H', RAW_ACCEPT, contentsPath(PINNED_ENGINE)]) {
      assert.ok(
        ghCalls[0].argv.includes(element),
        `(a) [M1] the gh argv carries ${JSON.stringify(element)}, got: ${ghCalls[0].argv.join(' ')}`
      )
    }
  } finally {
    rmDir(got?.dir)
  }
})

await test('(a) [M1] a `git show` that exits 0 with an empty stdout is not a compiler either', async () => {
  const fetchCompilerAt = exported('fetchCompilerAt')
  const exec = fakeExec((cmd) => (cmd === 'git' ? { code: 0, stdout: '' } : { code: 0, stdout: API_BODY }))
  const got = await fetchCompilerAt({ exec, engine: PINNED_ENGINE, pluginRoot: PLUGIN_ROOT })
  try {
    assert.equal(
      got.source, 'gh-api',
      '(a) [M1] an empty stdout is an empty file: the fetch goes on to `gh api` rather than writing nothing'
    )
    assert.equal(
      exec.calls.filter((c) => c.cmd === 'gh').length, 1,
      `(a) [M1] and the gh call was made, got: ${exec.calls.map(callLine).join(' | ')}`
    )
    assert.equal(
      fs.readFileSync(got.scriptPath, 'utf8'), API_BODY,
      '(a) [M1] with the gh body as the compiler'
    )
  } finally {
    rmDir(got?.dir)
  }
})

// ── b. [M2] both compiles run the file they are handed, and only that one ────

await test('(b) [M2] verifyPlanCompiles puts its compilerPath first, before --check --base', async () => {
  const exec = fakeExec({ code: 0, stdout: 'PLAN OK\n' })
  await compile(exec)
  assert.equal(
    exec.calls.length, 1,
    `(b) [M2] one subprocess — the fetch lives in fetchCompilerAt, not inside the compile — got: ` +
    `${exec.calls.map(callLine).join(' | ')}`
  )
  assert.equal(exec.calls[0].cmd, 'python3', '(b) [M2] run as python3')
  assert.deepEqual(
    exec.calls[0].argv.slice(0, 3), [FETCHED_COMPILER, '--check', '--base'],
    `(b) [M2] the argv begins with the compilerPath, --check, --base, got: ${exec.calls[0].argv.join(' ')}`
  )
  assert.ok(
    !exec.calls[0].argv.some((a) => String(a).startsWith(PLUGIN_SCRIPTS)),
    `(b) [M2] and names no path under ${PLUGIN_SCRIPTS}, got: ${exec.calls[0].argv.join(' ')}`
  )
})

await test('(b) [M2] verifyPlanCompiles without a compilerPath rejects', async () => {
  const exec = fakeExec({ code: 0, stdout: 'PLAN OK\n' })
  const err = await thrown(() => verifyPlanCompiles({
    exec, repoDir: FLEET_DIR, base: BASE, planPath: PLAN_PATH, planText: PLAN_TEXT
  }))
  assert.ok(
    err instanceof Error,
    '(b) [M2] a compile with no compiler to run is a rejection, not a fall back to the plugin cache\'s copy — ' +
    `it resolved to ${JSON.stringify(err === undefined ? 'nothing thrown' : String(err))}`
  )
})

await test('(b) [M2] compilePlanForRun puts its compilerPath first', async () => {
  const exec = fakeExec({ code: 0, stdout: JSON.stringify({ launch_waves: [], dag_edges: [] }) })
  await compilePlanForRun({
    exec, repoDir: FLEET_DIR, planPath: PLAN_PATH, base: BASE, stamp: 'run-7', compilerPath: FETCHED_COMPILER
  })
  assert.equal(
    exec.calls.length, 1,
    `(b) [M2] one subprocess, got: ${exec.calls.map(callLine).join(' | ')}`
  )
  assert.equal(exec.calls[0].cmd, 'python3', '(b) [M2] run as python3')
  assert.equal(
    exec.calls[0].argv[0], FETCHED_COMPILER,
    `(b) [M2] the stamped compile runs the fetched compiler, got: ${exec.calls[0].argv.join(' ')}`
  )
  assert.ok(
    !exec.calls[0].argv.some((a) => String(a).startsWith(PLUGIN_SCRIPTS)),
    `(b) [M2] and names no path under ${PLUGIN_SCRIPTS}, got: ${exec.calls[0].argv.join(' ')}`
  )
})

await test('(b) [M2] compilePlanForRun without a compilerPath rejects', async () => {
  const exec = fakeExec({ code: 0, stdout: JSON.stringify({ launch_waves: [], dag_edges: [] }) })
  const err = await thrown(() => compilePlanForRun({
    exec, repoDir: FLEET_DIR, planPath: PLAN_PATH, base: BASE, stamp: 'run-7'
  }))
  assert.ok(
    err instanceof Error,
    '(b) [M2] the stamped compile with no compiler to run is a rejection — ' +
    `it resolved to ${JSON.stringify(err === undefined ? 'nothing thrown' : String(err))}`
  )
})

// ── The launch drives: a real local target, every subprocess through the seam ─

const TARGET = 'popmechanic/smoke'
const GH_INTEGRATION = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const NOW = new Date('2026-09-16T03:20:00.000Z')
const CAPPED = { cpu: '6', memory: '8GB' }
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n', 'pytest.ini': '[pytest]\n' }
const DRIVE_PLAN = '# a plan\n\nOne plan, and a trailing newline.\n'
const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))

const task = (id) => ({
  id: String(id),
  title: `task ${id}`,
  factsheet: {
    files: [`f${id}.txt`], deletes: [], guards: [], proofTests: [], landing: {},
    driverOwned: [], siblingOwned: [], produces: [], consumes: []
  }
})
const ONE_TASK = { launch_waves: [[task(1)]], dag_edges: [] }

const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })
const ENGINE_RULE = {
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${TIP_ENGINE}\tHEAD\n`)
}
const pointAtOrigin = (repo, argv) => {
  const pointed = argv.map((a) => (a === 'origin' || /github\.com/.test(String(a)) ? repo.origin : a))
  const fetchAt = argv.indexOf('fetch')
  if (fetchAt < 0) return pointed
  const remoteAt = argv.indexOf('origin', fetchAt)
  const branch = String(argv[remoteAt + 1] ?? '')
  if (remoteAt < 0 || branch === '' || branch.startsWith('-') || branch.includes(':')) return pointed
  pointed[remoteAt + 1] = `+refs/heads/${branch}:refs/remotes/origin/${branch}`
  return pointed
}
const localRemote = (repo) => ({
  when: (cmd, argv) => cmd === 'git' &&
    (argv.includes('push') || argv.includes('ls-remote') || argv.includes('fetch')) &&
    !argv.includes('--get-url') &&
    !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => defaultExec('git', pointAtOrigin(repo, argv), options ?? {})
})
const OFFLINE = answer('', { code: 128, stderr: 'exam: this exam opens no network socket\n' })
const NO_REMOTE_OPS = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => a === 'clone' || a === 'pull' || a === 'fetch'),
  answer: OFFLINE
}
const NO_NETWORK_GIT = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))),
  answer: OFFLINE
}
const helpText = (verb, flags) => [
  `Command: ${verb}`, '', 'Options:', ...flags.map((flag) => `  ${flag}  what ${flag} does`), ''
].join('\n')
const HELP_OK = (cmd, argv) => {
  const verb = String(argv[1] ?? '').slice('help '.length)
  const flags = VERBS.verbs[verb]
  return flags
    ? answer(helpText(verb, flags))
    : answer(`No help available for unrecognized command: ${verb}\n`)
}

/** The fetch of M1, under either of its two commands. */
const isFetch = (cmd, argv) =>
  (cmd === 'git' && argv.includes('show') && namesCompiler(argv)) || (cmd === 'gh' && namesCompiler(argv))
/** The seam answers the fetch with a compiler body … */
const FETCH_BODY = { when: isFetch, answer: answer(SHOW_BODY) }
/** … or fails both of them, which is M3's case. */
const FETCH_FAILS = {
  when: isFetch,
  answer: answer('', { code: 128, stderr: 'exam: no compiler at that sha\n' })
}

/**
 * The compiler stub, reading argv[0] OFF DISK as it answers: the launch removes
 * the fetched directory after the stamped compile, so the only moment the bytes
 * the `python3` argv names can be read is while the call is being answered.
 */
const compilerRule = (seen) => ({
  when: (cmd) => cmd === 'python3',
  answer: (cmd, argv) => {
    let body = null
    try {
      body = fs.readFileSync(String(argv[0]), 'utf8')
    } catch (error) {
      body = `<unreadable: ${error?.code ?? error}>`
    }
    seen.push({ argv: [...argv], body })
    return argv.includes('--check') ? answer('PLAN OK\n') : answer(JSON.stringify(ONE_TASK))
  }
})

const driveRules = ({ repo, fetch, seen }) => [
  fetch,
  ENGINE_RULE,
  localRemote(repo),
  compilerRule(seen),
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json', answer([{ name: GH_INTEGRATION, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule("ls '", vmsPayload([])),
  sshRule('new ', NEW_OK),
  cmdRule('gh', 'api', answer('')),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

function workspace () {
  const root = tempDir('fleet-launch-compiler-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, DRIVE_PLAN)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

const drive = async ({ fetch, extra = [] }) => {
  const ws = workspace()
  const seen = []
  const exec = makeExec({ rules: driveRules({ repo: ws.repo, fetch, seen }) })
  let result = null
  let error = null
  try {
    result = await launch({
      argv: [
        ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir, ...extra
      ],
      exec,
      config: CAPPED,
      now: () => NOW,
      sleep: async () => {},
      refreshCredential: () => ({ ok: true }),
      kata: null
    })
  } catch (e) {
    error = e
  }
  return { ws, exec, seen, result, error }
}

const pythonCalls = (exec) => exec.calls.filter((c) => c.cmd === 'python3')
const pushCalls = (exec) => exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('push'))

// One resolved drive, read by (b) and by (d): no `--engine`, so the sha is the
// one `ls-remote` answers, and the seam answers the fetch with a body.
const resolved = await drive({ fetch: FETCH_BODY })

await test('(b) [M2] both of a launch\'s compiles run the file the fetch wrote, and nothing from the cache', () => {
  assert.equal(
    resolved.error, null,
    `(b) [M2] the drive resolved: ${resolved.error?.message ?? ''}`
  )
  const calls = pythonCalls(resolved.exec)
  assert.equal(
    calls.length, 2,
    `(b) [M2] two python3 calls — the --check compile and the --stamp compile — got ${calls.length}: ` +
    `${calls.map(callLine).join(' | ')}`
  )
  const first = String(calls[0]?.argv?.[0] ?? '')
  for (const call of calls) {
    assert.equal(
      String(call.argv[0]), first,
      `(b) [M2] both compiles run the same fetched compiler, got: ${calls.map((c) => c.argv[0]).join(' | ')}`
    )
    assert.ok(
      underTmp(call.argv[0]),
      `(b) [M2] which is the file the fetch wrote, under ${TMP}, got ${call.argv[0]}`
    )
    assert.ok(
      !call.argv.some((a) => String(a).startsWith(PLUGIN_SCRIPTS)),
      `(b) [M2] and no argv element is under ${PLUGIN_SCRIPTS} — the cache's copy is what run-26 lost to — ` +
      `got: ${call.argv.join(' ')}`
    )
  }
  for (const run of resolved.seen) {
    assert.equal(
      run.body, SHOW_BODY,
      '(b) [M2] and the bytes at that path, read while the compile was being answered, are the body the ' +
      `seam answered the fetch with, got: ${JSON.stringify(run.body)}`
    )
  }
})

// ── c. [M3] a compiler that cannot be fetched is a refusal on the laptop ────

await test('(c) [M3] two failed fetches are a Refusal naming the sha and compile_plan.py', async () => {
  const fetchCompilerAt = exported('fetchCompilerAt')
  const exec = fakeExec({ code: 128, stdout: '', stderr: 'exam: no compiler at that sha\n' })
  const err = await thrown(() => fetchCompilerAt({ exec, engine: PINNED_ENGINE, pluginRoot: PLUGIN_ROOT }))
  assert.ok(
    err instanceof Refusal,
    `(c) [M3] a failed fetch is a Refusal, never a fall back to the plugin's own copy, got ${err?.name}: ${err?.message}`
  )
  assert.ok(
    err.message.includes(PINNED_ENGINE),
    `(c) [M3] the message names the engine sha, got: ${err.message}`
  )
  assert.ok(
    err.message.includes('compile_plan.py'),
    `(c) [M3] and names compile_plan.py, got: ${err.message}`
  )
})

{
  const refused = await drive({ fetch: FETCH_FAILS })
  await test('(c) [M3] a launch whose compiler cannot be fetched compiles nothing, pushes nothing, mutates nothing', () => {
    assert.ok(refused.error, '(c) [M3] the launch rejected')
    assert.ok(
      refused.error instanceof Refusal,
      `(c) [M3] with a Refusal, got ${refused.error?.name}: ${refused.error?.message}`
    )
    assert.deepEqual(
      pythonCalls(refused.exec).map(callLine), [],
      '(c) [M3] and no python3 call was issued: the refusal is before any compile'
    )
    assert.deepEqual(
      pushCalls(refused.exec).map(callLine), [],
      '(c) [M3] no git argv carrying push'
    )
    assert.deepEqual(
      refused.exec.mutating(), [],
      '(c) [M3] and no mutating lobby verb — nothing compiled, nothing pushed, no VM created'
    )
  })
  refused.ws.cleanup()
}

// ── d. [M4] the sha it fetches at is the sha the VM is told, and it says so ──

{
  const pinned = await drive({ fetch: FETCH_FAILS, extra: ['--engine', PINNED_ENGINE] })
  await test('(d) [M4] --engine <sha> is the sha the fetch asks for, and the sha the refusal names', () => {
    const shows = pinned.exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('show') && namesCompiler(c.argv))
    assert.equal(
      shows.length, 1,
      '(d) [M4] the launch issued one git show for the compiler, got ' +
      `${shows.length} of them among its ${pinned.exec.calls.length} calls: ` +
      `${pinned.exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('show')).map(callLine).join(' | ')}`
    )
    assert.ok(
      shows[0].argv.includes(`${PINNED_ENGINE}:${COMPILER_OBJECT}`),
      `(d) [M4] at the pinned sha, got: ${shows[0].argv.join(' ')}`
    )
    assert.ok(
      pinned.error instanceof Refusal,
      `(d) [M4] and the failed fetch is a Refusal, got ${pinned.error?.name}: ${pinned.error?.message}`
    )
    assert.ok(
      pinned.error.message.includes(PINNED_ENGINE),
      `(d) [M4] naming that sha, got: ${pinned.error.message}`
    )
  })
  pinned.ws.cleanup()
}

await test('(d) [M4] with no --engine the launch fetches at the tip it read, and says so as `compiler`', () => {
  assert.equal(resolved.error, null, `(d) [M4] the drive resolved: ${resolved.error?.message ?? ''}`)
  assert.equal(
    resolved.result.compiler, TIP_ENGINE,
    `(d) [M4] the result's compiler is the engine sha it fetched, got ${JSON.stringify(resolved.result.compiler)}`
  )
  assert.equal(
    resolved.result.engine, TIP_ENGINE,
    '(d) [M4] which is the sha the assignment comment carries as engine='
  )
  const calls = resolved.exec.calls
  const lsAt = calls.findIndex((c) =>
    c.cmd === 'git' && c.argv.includes('ls-remote') && c.argv.some((a) => /ultrapowers/.test(String(a))))
  const showAt = calls.findIndex((c) => c.cmd === 'git' && c.argv.includes('show') && namesCompiler(c.argv))
  const pythonAt = calls.findIndex((c) => c.cmd === 'python3')
  assert.ok(lsAt >= 0, `(d) [M4] the engine ls-remote was issued, got: ${calls.map(callLine).join(' | ')}`)
  assert.ok(showAt >= 0, `(d) [M4] and the compiler git show, got: ${calls.map(callLine).join(' | ')}`)
  assert.ok(
    calls[showAt].argv.includes(`${TIP_ENGINE}:${COMPILER_OBJECT}`),
    `(d) [M4] at the sha ls-remote answered, got: ${calls[showAt].argv.join(' ')}`
  )
  assert.ok(pythonAt >= 0, '(d) [M4] and a compile was run')
  assert.ok(
    lsAt < pythonAt,
    `(d) [M4] the engine sha is resolved BEFORE the first compile (ls-remote at ${lsAt}, python3 at ${pythonAt})`
  )
  assert.ok(
    showAt < pythonAt,
    `(d) [M4] and the compiler is fetched before it (git show at ${showAt}, python3 at ${pythonAt})`
  )
})

await test('(d) [M4] renderLaunch prints one compiler= line for a result that carries one, and none otherwise', () => {
  const sha = 'd'.repeat(40)
  const lines = renderLaunch({ ...RESULT, compiler: sha }).split('\n')
  assert.deepEqual(
    lines.filter((l) => l.startsWith('compiler=')), [`compiler=${sha}`],
    `(d) [M4] exactly one line, equal to compiler=<sha>, got: ${JSON.stringify(lines)}`
  )
  const without = renderLaunch({ ...RESULT }).split('\n')
  assert.deepEqual(
    without.filter((l) => l.startsWith('compiler=')), [],
    `(d) [M4] a result without compiler prints no compiler= line, got: ${JSON.stringify(without)}`
  )
})

await test('(d) [M4] the compiler= line is its own entry, and the baseFacts still end the launch line', () => {
  const sha = 'd'.repeat(40)
  const facts = ['BASE fact: x', 'STALE fact: y']
  const lines = renderLaunch({ ...RESULT, compiler: sha, baseFacts: facts }).split('\n')
  assert.deepEqual(
    lines.slice(-2), facts,
    `(d) [M4] the baseFacts are still the LAST lines, so compiler= is a line of its own and not one of ` +
    `them, got: ${JSON.stringify(lines)}`
  )
  assert.equal(
    lines.indexOf(`compiler=${sha}`), lines.length - 3,
    `(d) [M4] and it sits directly above them, got: ${JSON.stringify(lines)}`
  )
})

resolved.ws.cleanup()

// ── e. [M5] the CONTRACT says which compiler a launch runs ──────────────────

await test('(e) [M5] fleet/CONTRACT.md\'s Launch order bullet names the fetched compiler, the refusal and the line', () => {
  const section = sectionOf(fs.readFileSync(CONTRACT, 'utf8'), '- **Launch order (launcher):**', '- **')
  assert.ok(section !== null, '(e) [M5] fleet/CONTRACT.md has a `**Launch order (launcher):**` bullet')
  assert.match(
    section, /compiler fetched at .engine=.*cannot be fetched is refused before any push.*compiler=<sha>/,
    '(e) [M5] the bullet says the launch\'s compiles run the compiler fetched at `engine=`, that a launch ' +
    'whose compiler cannot be fetched is refused before any push, and that the launch line carries ' +
    `compiler=<sha>, got: ${near(section, 'compiler')}`
  )
})

// ── f. [M6] the duplicate sim answers the fetch ─────────────────────────────

await test('(f) [M6] fleet/tests/test_launch_duplicate.mjs\'s seam has a rule for the compiler fetch', () => {
  // Read, never run: the Proof's own `Run:` line is what proves that sim green,
  // and an exam proves its own claim rather than spawning another exam.
  const sim = fs.readFileSync(DUPLICATE_SIM, 'utf8')
  assert.ok(
    sim.includes('compile_plan.py') || /\bshow\b/.test(sim),
    '(f) [M6] the sim names `compile_plan.py` or `show` — the two things a rule answering the fetch of M1 ' +
    'keys on. At its fake engine sha the real `git show` fails and the helper\'s fallthrough answers ' +
    '`gh api` exit 0 with an empty stdout, which is a failed fetch under M3, so without such a rule every ' +
    'drive in that sim is a Refusal. Whether it then prints ALL TESTS PASSED is the Proof\'s own `Run:` ' +
    'line, which the driver runs: this exam proves its own claim and spawns no other exam.'
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
