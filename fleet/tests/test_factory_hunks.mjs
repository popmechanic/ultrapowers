// fleet/tests/test_factory_hunks.mjs — exam for "Jev is shown the hunks that
// carry a clause's own words, not the head of the patch".
//
// M1: literalsOf(clauses) -> string[]
// M2: hunksCarrying(diffText, literals, cap) -> string
// M3: factory/engine.mjs's `measure` hands readLanding a `patch` and each
//     `files.f<j>` built through hunksCarrying rather than a naive slice.
//
// Legs (a) and (b) drive the two pure exports directly. Leg (c) drives the
// real `runEngine` from factory/engine.mjs, end to end, over a real git repo
// (`makeRepo` from ./_engine_helpers.mjs) and a real `python3` plan parse —
// the compiler runs for real, exactly as factory/engine.mjs's own comments
// say it must — with three fakes standing in for the model-facing seams:
// `worker` (writes the oversized patch), `judge` (records what `readLanding`
// was handed), and `sh` (answers the task's own test command and the fold
// kernel's two calls, so no python fold_wave.py has to run for real).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { literalsOf, hunksCarrying } from '../../factory/hunks.mjs'
import { runEngine } from '../../factory/engine.mjs'
import { makeRepo, ENV, gitSync } from './_engine_helpers.mjs'

// ── M1: literalsOf ───────────────────────────────────────────────────────────

{
  // M1: "answers, in order and deduplicated, every backticked span of the
  // clause texts that is at least 3 characters long, verbatim."
  const clauses = [
    '`runEngine(args)` answers `ok` and `x`',
    'again `ok ` and `runEngine(args)`',
  ]
  const got = literalsOf(clauses)
  assert.deepStrictEqual(
    got, ['runEngine(args)', 'ok '],
    'M1: literalsOf keeps only >=3-char backticked spans, in first-seen order, deduplicated ' +
    '(drops the 2-char `ok` and 1-char `x` from clause 1, keeps the 3-char `ok ` from clause 2, ' +
    'and does not repeat `runEngine(args)` the second time it is quoted)')
}

console.log('M1 literalsOf: PASSED')

// ── M2: hunksCarrying ────────────────────────────────────────────────────────

// Two hunks in one file (no literal), and one hunk in a second file (the
// only one containing `needle_fn`) — each roughly the size the Machine
// clause describes, built here so the exact byte counts drive the cap math
// below rather than a hand-picked magic number.
const padLines = (tag, n) =>
  Array.from({ length: n }, (_, i) => `+${tag}_line_${i}_${'x'.repeat(20)}`).join('\n') + '\n'

const H1 = '@@ -1,0 +1,9 @@\n' + padLines('h1', 9)
const H2 = '@@ -50,0 +51,9 @@\n' + padLines('h2', 9)
const H3 = '@@ -1,0 +1,3 @@\n' + '+needle_fn marker line\n+second line\n+third line\n'

const HEADER1 = 'diff --git a/file1.txt b/file1.txt\n' +
  'index aaa111..bbb222 100644\n--- a/file1.txt\n+++ b/file1.txt\n'
const HEADER2 = 'diff --git a/file2.txt b/file2.txt\n' +
  'index ccc333..ddd444 100644\n--- a/file2.txt\n+++ b/file2.txt\n'

const TWO_FILE_DIFF = HEADER1 + H1 + H2 + HEADER2 + H3
const LITERALS = ['needle_fn']

{
  // M2 fallback: "a text that already fits in cap is answered unchanged."
  const got = hunksCarrying(TWO_FILE_DIFF, LITERALS, 100000)
  assert.strictEqual(got, TWO_FILE_DIFF,
    'M2: a cap the whole diff already fits inside answers the text unchanged, verbatim')
}

{
  // A cap that fits exactly the literal-carrying hunk (H3, with its header)
  // plus the first non-literal hunk (H1, with its header) — but not H2 too.
  const capThatKeepsH3AndH1 = (HEADER2 + H3 + HEADER1 + H1).length + 1
  const got = hunksCarrying(TWO_FILE_DIFF, LITERALS, capThatKeepsH3AndH1)

  // M2: "first every hunk containing at least one literal, in original
  // order, then the rest in original order" — H3 (the only literal hunk)
  // ahead of H1 (a non-literal hunk that precedes it in the source text).
  assert.ok(got.includes(H3), 'M2: the kept output contains H3, the literal-carrying hunk, whole')
  assert.ok(got.includes(H1), 'M2: the kept output contains H1, the first surviving non-literal hunk, whole')
  assert.ok(got.indexOf(H3) < got.indexOf(H1),
    'M2: H3 (carries the literal) is placed ahead of H1 even though H1 came first in the source')

  // "each kept hunk preceded by its section's header exactly once"
  const file2HeaderLine = 'diff --git a/file2.txt b/file2.txt'
  const occurrences = got.split(file2HeaderLine).length - 1
  assert.strictEqual(occurrences, 1,
    'M2: file2\'s `diff --git ` line appears exactly once in the kept output')
  assert.ok(got.indexOf(file2HeaderLine) < got.indexOf(H3),
    'M2: file2\'s header precedes H3, the hunk it introduces')

  // "stopping before the first hunk that would take the string past `cap`"
  assert.ok(!got.includes(H2), 'M2: H2 — the hunk that would have pushed past cap — is left out entirely')

  // "the string ends with a final line `(<n> hunks omitted)`"
  const outLines = got.split('\n')
  assert.strictEqual(outLines[outLines.length - 1], '(1 hunks omitted)',
    'M2: exactly one hunk (H2) was left out, so the final line reads `(1 hunks omitted)`')

  // "every `@@ ` line of the answer is followed by that hunk's complete
  // original text" — already implied by the whole-string `.includes(H1)` /
  // `.includes(H3)` checks above (each of those literal strings begins with
  // its own `@@ ` line and is asserted present in full), stated here as its
  // own check against every `@@ ` line in the output.
  for (const line of outLines) {
    if (!line.startsWith('@@ ')) continue
    assert.ok(got.includes(line + '\n'), 'M2: every `@@ ` line in the answer opens a hunk that is present')
  }
}

{
  // "each section... at the start of the text when it begins with none" —
  // exercised with a per-file text exactly as `factory/engine.mjs`'s own
  // `splitDiff` hands one to `measure`: no leading `diff --git ` line, just
  // the `index`/`---`/`+++` header straight into its hunk.
  const HEADERLESS = 'index eee555..fff666 100644\n--- a/only.txt\n+++ b/only.txt\n'
  const perFileText = HEADERLESS + H1
  const got = hunksCarrying(perFileText, [], perFileText.length)
  assert.ok(got.includes('--- a/only.txt') && got.includes('+++ b/only.txt'),
    'M2: a `diff --git `-less per-file text keeps its ---/+++ header')
  assert.ok(got.indexOf('+++ b/only.txt') < got.indexOf('@@ '),
    'M2: the header stays ahead of the first kept hunk even with no `diff --git ` line to anchor the section')
}

console.log('M2 hunksCarrying: PASSED')

// ── M3: factory/engine.mjs wires measure() through hunksCarrying ────────────

const NEEDLE = 'needle_marker_xyz'

// A plan with exactly one implementation task, whose sole Machine clause
// backtick-quotes the literal above — the minimum claims-v1 shape
// `skills/ultrapowers/scripts/plan_parse.py` (run for real, as
// factory/engine.mjs's own docstring insists it must be) will parse into one
// task, one wave.
const PLAN_TEXT = `### Task 1: dummy hunk-carrying fixture

**Type:** implementation

**Files:**
- Create: \`factory/dummy_impl.mjs\`
- Test: \`fleet/tests/test_dummy_hunkcheck.mjs\`

**Claim:** a dummy claim, carrying one literal, for this exam only. (derived)
Machine: M1. the patch's added file names the literal \`${NEEDLE}\` somewhere in its text.

**Authorized-by:** exam fixture, no real record.

**Interfaces:**
- Consumes: none
- Produces: nothing

**Proof:**
- Test: \`fleet/tests/test_dummy_hunkcheck.mjs\`
`

async function runM3 () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunks-exam-'))
  const repoDir = path.join(tmp, 'repo')
  const runDir = path.join(tmp, 'run')
  const planPath = path.join(tmp, 'plan.md')

  makeRepo(repoDir)
  fs.writeFileSync(planPath, PLAN_TEXT)
  const baseSha = gitSync(['rev-parse', 'HEAD'], repoDir)

  // Real git, through the sim's own hermetic environment — never
  // `process.env` — exactly like `_engine_helpers.mjs`'s own `gitSync`.
  const git = (argv, cwd) =>
    execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

  // The fake worker: only the implementer dispatch writes anything. It lays
  // down two files in its clone — an oversized, literal-free filler (so the
  // whole patch clears 20,000 characters) sorted alphabetically ahead of a
  // small file carrying the task's own literal, so that file's one hunk
  // lands past character 20,000 of the raw, unsliced patch.
  const worker = async (opts) => {
    if (opts.role === 'implement') {
      const fillerLines = Array.from({ length: 900 }, (_, i) =>
        `filler line ${i} ${'x'.repeat(24)}`).join('\n') + '\n'
      fs.writeFileSync(path.join(opts.cwd, 'aaa_filler.txt'), fillerLines)
      fs.writeFileSync(path.join(opts.cwd, 'zzz_needle.txt'), `const marker = "${NEEDLE}"\n`)
    }
    return { result: { total_cost_usd: 0, result: 'stub' }, denials: [] }
  }

  // The fake judge: only `readLanding` exists, and it just records its
  // argument — every other reader (`readTask`, `readSettled`, ...) is
  // absent, so `runEngine`'s own `read()` treats each as answering nothing
  // (k=1, no referee, no redispatch-worthy low coverage).
  let reading = null
  const judge = {
    readLanding: async (arg) => { reading = arg; return { claim: 1, coverage: [1] } },
  }

  // The fake `sh`: answers the task's own test command (exit 0, so the exam
  // reads green and no redispatch fires) and the fold kernel's two calls
  // (`fold` -> complete; `materialize` -> the base sha itself, a commit the
  // real target repo already has, so the engine's own `git reset --hard`
  // succeeds for real).
  const sh = (cmd, argv = []) => {
    if (cmd === 'python3' && argv[1] === 'fold') {
      return { status: 0, stdout: JSON.stringify({ complete: true }) }
    }
    if (cmd === 'python3' && argv[1] === 'materialize') {
      return { status: 0, stdout: JSON.stringify({ candidateSha: baseSha }) }
    }
    return { status: 0, stdout: 'ALL TESTS PASSED\n' }
  }

  const result = await runEngine(
    { plan: planPath, target: repoDir, base: baseSha, runDir },
    { worker, judge, sh, git },
  )

  assert.ok(result.done, 'M3 precondition: the rig drive itself must complete (adopted its one task)')
  assert.ok(reading, 'M3 precondition: the fake judge\'s readLanding must have been called')

  // M3: "measure hands readLanding patch as hunksCarrying(<the patch text>,
  // literalsOf(task.clauses), 20000)... where BASE handed it the first
  // 20,000 ... characters." Under the 20,000-character slice this literal —
  // whose only hunk lies past character 20,000 — would have been cut away;
  // hunksCarrying instead promotes that hunk ahead of the padding.
  assert.ok(reading.patch.includes(NEEDLE),
    'M3: the `patch` handed to readLanding contains the clause\'s own literal, ' +
    'even though its only hunk starts past character 20,000 of the raw patch')
  assert.match(reading.patch.trim().split('\n').pop(), /^\(\d+ hunks omitted\)$/,
    'M3: the `patch` handed to readLanding ends with a `(<n> hunks omitted)` line — ' +
    'proof the patch was long enough that something had to be left out')

  // M3: "each files.f<j> as hunksCarrying(<that file's diff>, ..., 6000) ...
  // where BASE handed it the first 6,000 characters."
  const files = Object.values(reading.files || {})
  assert.ok(files.length >= 2, 'M3 precondition: readLanding was handed more than one per-file entry')
  for (const f of files) {
    assert.ok(f.length <= 6000 + 64,
      'M3: no `files` value handed to readLanding exceeds 6,000 characters plus one omitted-count line')
  }
}

await runM3()
console.log('M3 runEngine wiring: PASSED')

console.log('ALL TESTS PASSED')
