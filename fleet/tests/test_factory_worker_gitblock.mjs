/**
 * fleet/tests/test_factory_worker_gitblock.mjs — the exam for "The worker's
 * boundary reads the whole Bash line for a git command word, denies it, and
 * hands the engine a row" (derived; Authorized-by #1156, map #1131;
 * `factory/engine.mjs`'s header rule `MODELS NEVER RUN GIT`).
 *
 * `DISALLOWED_TOOLS`'s `Bash(git *)` only catches a Bash command that BEGINS
 * with `git` — `cp … && git diff … && python3 …` runs the git anyway (run-193,
 * 2026-09-18). `factory/gitblock.mjs`'s `findGit` reads the whole line for a
 * git command word behind `&&`, `;`, `|`, a wrapper or `sh -c`, and
 * `factory/worker.mjs`'s `makeGitHook` denies it at the `PreToolUse` boundary
 * and hands the engine a `worker:denied` row through `onDenied`.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] `findGit` of the three-command `&&` line, and of a bare `git
 *       status`, each answer a string;
 *   (b) [M2] `findGit` of a `sh -c 'git reset --hard'` wrapper answers a
 *       string — the wrapper does not hide the git word;
 *   (c) [M3] `findGit` of a line naming git only as a `grep` argument, and of
 *       a line naming it only inside `.gitignore`, each answer exactly `null`;
 *   (d) [M4] driven through `runWorker` and a fake `query`, the `PreToolUse`
 *       hook answers for `cd pkg && git commit -m x` hold exactly one deny,
 *       whose reason carries the words "the engine runs git itself", and the
 *       answers for `grep -rn git factory/` hold zero denies;
 *   (e) [M5] on a denied line longer than 200 characters, `onDenied` is
 *       called exactly once with a row carrying `kind`, `task`, `label`,
 *       `tool`, `why` and `command` (the line's first 200 characters); on the
 *       allowed line it is not called; and a throwing `onDenied`, or none at
 *       all, still leaves the hook's answer a deny.
 *
 * M6 — that both of `factory/engine.mjs`'s `dispatch` scopes pass an
 * `onDenied` that appends through that scope's own `appendEvent` — is read
 * against the diff by the plan's own `Run:` grep, not by this file: this exam
 * stays hermetic (no child process, no disk, no network) and never reads
 * `factory/engine.mjs`'s source.
 *
 * The offline seam is `runWorker(opts, { query })`: the fake `query` below is
 * an async generator, called once per drive, that walks
 * `options.hooks.PreToolUse.flatMap((e) => e.hooks)` and calls every hook
 * with a `Bash` input carrying the command under test, exactly as
 * `factory/worker.mjs`'s real `workerOptions` builds them — the confine hook
 * beside the git hook, in one `PreToolUse` entry, no `matcher`. The confine
 * hook answers `{}` for every `Bash` call (it only ever adjudicates
 * `EDIT_TOOLS`), so its answer never counts as a deny in the tallies below.
 */

import assert from 'node:assert/strict'

import { findGit } from '../../factory/gitblock.mjs'
import { runWorker } from '../../factory/worker.mjs'

const TASK = 7
const LABEL = 't7:impl:0'

/**
 * Drive one Bash `command` through every `PreToolUse` hook `workerOptions`
 * assembles, via a fake `query` that never touches the network or a process.
 * Answers a string→answer would lose the connection between call and hook;
 * instead this answers the array of every hook's raw answer, in call order.
 */
async function driveHooks ({ command, task = TASK, label = LABEL, onDenied } = {}) {
  const answers = []
  async function query ({ options }) {
    const hooks = options.hooks.PreToolUse.flatMap((entry) => entry.hooks)
    return (async function * () {
      for (const hook of hooks) {
        const out = await hook(
          { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } },
          'tu_1',
          { signal: new AbortController().signal }
        )
        answers.push(out)
      }
      yield { type: 'result', subtype: 'success' }
    })()
  }
  await runWorker(
    { cwd: process.cwd(), prompt: 'x', systemPrompt: 'x', model: 'x', files: [], task, label, onDenied },
    { query }
  )
  return answers
}

const denies = (answers) => answers.filter((a) => a?.hookSpecificOutput?.permissionDecision === 'deny')

// ── a. [M1] a git word behind && is found, and so is a bare git command ────
{
  const chained = 'cp /tmp/orig.py scripts/p.py && git diff --stat scripts/p.py && python3 -m pytest -q tests/'
  assert.equal(typeof findGit(chained), 'string', '(a) [M1] a git word behind && answers a string')
  assert.equal(typeof findGit('git status'), 'string', '(a) [M1] a bare git command also answers a string')
}

// ── b. [M2] a wrapper does not hide the git word ────────────────────────────
{
  assert.equal(
    typeof findGit("sh -c 'git reset --hard'"),
    'string',
    "(b) [M2] sh -c 'git reset --hard' answers a string — the wrapper form does not hide it"
  )
}

// ── c. [M3] git as an argument, or inside another word, is not a command ────
{
  assert.equal(
    findGit('grep -rn git factory/ | head -5'),
    null,
    '(c) [M3] git named only as a grep argument answers exactly null'
  )
  assert.equal(
    findGit('cat .gitignore'),
    null,
    '(c) [M3] git named only inside another word (.gitignore) answers exactly null'
  )
}

// ── d. [M4] the hook denies the git line and lets the argument-only line through ──
{
  const deniedAnswers = await driveHooks({ command: 'cd pkg && git commit -m x' })
  const deniedHits = denies(deniedAnswers)
  assert.equal(
    deniedHits.length,
    1,
    `(d) [M4] cd pkg && git commit -m x: exactly one hook answer denies, got ${deniedHits.length}`
  )
  assert.ok(
    deniedHits[0].hookSpecificOutput.permissionDecisionReason.includes('the engine runs git itself'),
    `(d) [M4] the deny reason carries "the engine runs git itself": ${deniedHits[0].hookSpecificOutput.permissionDecisionReason}`
  )

  const allowedAnswers = await driveHooks({ command: 'grep -rn git factory/' })
  assert.equal(
    denies(allowedAnswers).length,
    0,
    '(d) [M4] grep -rn git factory/: no hook answer denies'
  )
}

// ── e. [M5] onDenied carries the row, only on the deny, and never turns a deny into an allow ──
{
  const pad = 'x'.repeat(250)
  const longLine = `cd pkg && git commit -m "${pad}"`
  assert.ok(longLine.length > 200, '(e) [M5] setup: the denied line is longer than 200 characters')

  const rows = []
  const answers = await driveHooks({ command: longLine, onDenied: (row) => rows.push(row) })
  assert.equal(denies(answers).length, 1, '(e) [M5] the long denied line still denies exactly once')
  assert.equal(rows.length, 1, '(e) [M5] onDenied was called exactly once on the deny')
  const [row] = rows
  assert.equal(row.kind, 'worker:denied', '(e) [M5] row.kind is exactly worker:denied')
  assert.equal(row.task, TASK, '(e) [M5] row.task equals the dispatch\'s task')
  assert.equal(row.label, LABEL, '(e) [M5] row.label equals the dispatch\'s label')
  assert.equal(row.tool, 'Bash', '(e) [M5] row.tool is exactly Bash')
  assert.equal(row.why, 'git', '(e) [M5] row.why is exactly git')
  assert.equal(row.command, longLine.slice(0, 200), '(e) [M5] row.command is exactly the line\'s first 200 characters')

  const allowedRows = []
  await driveHooks({ command: 'grep -rn git factory/', onDenied: (r) => allowedRows.push(r) })
  assert.equal(allowedRows.length, 0, '(e) [M5] onDenied is not called on the allowed line')

  const throwingAnswers = await driveHooks({
    command: longLine,
    onDenied: () => { throw new Error('exam: onDenied throws on purpose') }
  })
  assert.equal(
    denies(throwingAnswers).length,
    1,
    '(e) [M5] a throwing onDenied still leaves the hook\'s answer a deny'
  )

  const missingAnswers = await driveHooks({ command: longLine })
  assert.equal(
    denies(missingAnswers).length,
    1,
    '(e) [M5] an absent onDenied still leaves the hook\'s answer a deny'
  )
}

// ── #1230: findGit reads heredoc bodies and quoted strings as data ─────────
// (f) [M1] a heredoc body that writes the word git, and calls it, is not a
//     segment or a word — findGit of the run-215 line answers exactly null.
// (g) [M2] the same line with `; git status` appended after the heredoc's
//     closing `echo done` answers a string, because the trailing git command
//     runs after the heredoc has closed; the five #1156 legs above this
//     comment are untouched and still pass.
// (h) [M3] a delimiter and a git word inside one quoted string — double or
//     single — is data, not a segment cut: findGit answers exactly null.
{
  const run215Line =
    "cat > /tmp/test_pattern.txt <<'EOF'\nfunction git (cwd, args) {\n  return 1\n}\ngit(root, ['init'])\nEOF\necho done"

  assert.equal(
    findGit(run215Line),
    null,
    '(f) [M1] findGit of the run-215 heredoc line answers exactly null'
  )

  const run215LineWithTrailingGit = run215Line + '; git status'
  assert.equal(
    typeof findGit(run215LineWithTrailingGit),
    'string',
    '(g) [M2] findGit of the run-215 line with ; git status appended answers a string'
  )

  // the five #1156 legs above this comment, unedited, still pass:
  const chained = 'cp /tmp/orig.py scripts/p.py && git diff --stat scripts/p.py && python3 -m pytest -q tests/'
  assert.equal(typeof findGit(chained), 'string', '(g) [M2] the && chain still answers a string')
  assert.equal(typeof findGit('git status'), 'string', '(g) [M2] a bare git status still answers a string')
  assert.equal(
    typeof findGit("sh -c 'git reset --hard'"),
    'string',
    "(g) [M2] sh -c 'git reset --hard' still answers a string"
  )
  assert.equal(
    findGit('grep -rn git factory/ | head -5'),
    null,
    '(g) [M2] grep -rn git factory/ | head -5 still answers exactly null'
  )
  assert.equal(
    findGit('cat .gitignore'),
    null,
    '(g) [M2] cat .gitignore still answers exactly null'
  )

  assert.equal(
    findGit('echo "note; git status"'),
    null,
    '(h) [M3] a ; and a git word inside one double-quoted string answers exactly null'
  )
  assert.equal(
    findGit("echo 'note; git status'"),
    null,
    '(h) [M3] the same shape in a single-quoted string answers exactly null'
  )
}

console.log('ALL TESTS PASSED')
