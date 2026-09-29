/**
 * fleet/tests/test_factory_worker_gitblock.mjs — the exam for "The agent's
 * boundary reads the whole Bash line for a git command word" (derived;
 * Authorized-by #1156, map #1131; the rule `MODELS NEVER RUN GIT`).
 *
 * `DISALLOWED_TOOLS`'s `Bash(git *)` only catches a Bash command that BEGINS
 * with `git` — `cp … && git diff … && python3 …` runs the git anyway (run-193,
 * 2026-09-18). `factory/gitblock.mjs`'s `findGit` reads the whole line for a
 * git command word behind `&&`, `;`, `|`, a wrapper or `sh -c`, and the
 * Flock's `PreToolUse` hook (`factory/flock/engine.mjs`) denies what it finds.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] `findGit` of the three-command `&&` line, and of a bare `git
 *       status`, each answer a string;
 *   (b) [M2] `findGit` of a `sh -c 'git reset --hard'` wrapper answers a
 *       string — the wrapper does not hide the git word;
 *   (c) [M3] `findGit` of a line naming git only as a `grep` argument, and of
 *       a line naming it only inside `.gitignore`, each answer exactly `null`.
 *
 * This exam stays hermetic: no child process, no disk, no network.
 */

import assert from 'node:assert/strict'

import { findGit } from '../../factory/gitblock.mjs'

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
