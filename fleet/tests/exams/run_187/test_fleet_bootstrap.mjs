/**
 * fleet/tests/exams/run_187/test_fleet_bootstrap.mjs — the exam for "The
 * bootstrap's one new line — an engine sha that carries a factory boot is run
 * by it" (run-187 task 2).
 *
 * This file is the Proof's `Test: fleet/tests/test_fleet_bootstrap.mjs`, landed
 * where the run's exam handoff stages it. Every relative path here is written
 * for THIS directory: `../../_helpers.mjs` is the rig at the top of
 * `fleet/tests/`, and `../../../` is the repository's `fleet/`, so the script
 * under test and `setup-script.mjs` are read from there and never from the cwd.
 * The exam prints `ALL TESTS PASSED` on its last line, which is what
 * `tests/test_fleet_suite.py` reads.
 *
 * The Machine clauses, restated:
 *
 *   M1 — after the engine clone at `<sha>` is in place, when
 *        `$FLEET_HOME/engines/<sha>/factory/boot.sh` is a regular file the
 *        bootstrap logs `exec <that path> boot` and execs it with
 *        `FLEET_ASSIGNMENT=<comment>`; when it is absent the bootstrap logs
 *        `exec $FLEET_HOME/engines/<sha>/fleet/sandbox-boot.sh boot` and execs
 *        that with `FLEET_ASSIGNMENT=<comment>`, as at BASE.
 *   M2 — everything before that choice is unchanged: the comment is read once
 *        from `https://reflection.int.exe.xyz/comment`, a unit argument that
 *        disagrees with `run=` exits 1, a comment without `engine=<40 hex>`
 *        exits 1, and an engine already present at `$FLEET_HOME/engines/<sha>`
 *        is not cloned again.
 *   M3 — the rendered setup script that carries this bootstrap stays within the
 *        fleet's budget: `renderSetupScript({ run, bootstrap, unit })` from
 *        `fleet/setup-script.mjs`, given the file's bytes, renders at most
 *        `SETUP_SCRIPT_BUDGET_BYTES` (9216) bytes.
 *
 * The Proof legs, in the Proof's own order, and where each is answered:
 *
 *   (a) [M1] with the stub `git clone` creating `<dst>/factory/boot.sh`
 *            (executable, printing `factory` and `$FLEET_ASSIGNMENT`), the
 *            bootstrap's stdout carries `factory` followed by the comment
 *            string, `<FLEET_HOME>/fleet-boot.log` carries
 *            `exec <FLEET_HOME>/engines/<sha>/factory/boot.sh boot`, and
 *            `sandbox-boot.sh`'s stub was never run — case 1 below; with the
 *            stub creating no `factory/boot.sh` and a
 *            `<dst>/fleet/sandbox-boot.sh` stub printing `legacy`, stdout
 *            carries `legacy` followed by the comment and the log carries
 *            `exec <FLEET_HOME>/engines/<sha>/fleet/sandbox-boot.sh boot` —
 *            case 2 below.
 *   (b) [M2] the stub `curl` saw exactly one request, to
 *            `https://reflection.int.exe.xyz/comment` — asserted for every boot
 *            this exam runs, since "read once" is a property of each of them;
 *            invoked as `bash fleet/fleet-bootstrap.sh 9` against a comment
 *            saying `run=7` it exits 1 with `refusing` in the log — case 3; a
 *            comment with no `engine=` exits 1 with `no engine=` in the log —
 *            case 4; with `<FLEET_HOME>/engines/<sha>` already a directory
 *            holding `fleet/sandbox-boot.sh`, the stub `git` is never called and
 *            the log carries `already present` — case 5.
 *   (c) [M3] `renderSetupScript({ run: '7', bootstrap: <the file's bytes>,
 *            unit: <fleet/fleet-run@.service's bytes> })` has a UTF-8 byte
 *            length at most `SETUP_SCRIPT_BUDGET_BYTES`.
 *
 * Two readings worth writing down, because a later session would otherwise have
 * to reconstruct them:
 *
 *   — leg (a) asks that in the factory case `sandbox-boot.sh`'s stub was never
 *     run. For that to discriminate at all the legacy stub has to EXIST and be
 *     runnable in that case; otherwise its silence only says the file was
 *     missing. So case 1's clone writes BOTH stubs, the legacy one appends to a
 *     witness file as its first act, and the assertion is that the witness does
 *     not exist and no `legacy` line reached stdout. Case 2 runs the same stub
 *     body and asserts the witness DOES exist, which is the positive control
 *     for the mechanism: the file case 1 looks for is one case 2 proves gets
 *     written.
 *   — leg (c) is green at BASE by construction: the render is well inside the
 *     budget today, and the leg is the guard on the edit's growth rather than
 *     the red leg. The red leg at BASE is (a)'s factory half — BASE's last two
 *     lines name `fleet/sandbox-boot.sh` unconditionally.
 *
 * No network and no real clone: `curl`, `git` and the two boot scripts are
 * stubs, the case's stub directory goes first on `PATH`, and `FLEET_HOME` is a
 * directory the case owns. Every spawn's environment comes from `simEnv`, which
 * the hermetic sweep requires.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simEnv } from '../../_helpers.mjs'
import { SETUP_SCRIPT_BUDGET_BYTES, renderSetupScript } from '../../../setup-script.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** The repository's `fleet/`, three directories up from `exams/<slug>/`. */
const FLEET_DIR = path.resolve(HERE, '..', '..', '..')
const BOOTSTRAP = path.join(FLEET_DIR, 'fleet-bootstrap.sh')

// ── the run's literals ───────────────────────────────────────────────────────

/** The engine the assignment names — forty hex, which is what M2's guard wants. */
const SHA = 'ab'.repeat(20)
const RUN = '7'
/** The assignment, in the shape `buildComment` writes: one line, `key=value`,
 *  keys in contract order. `engine=` is not first and not last, so a bootstrap
 *  that read it positionally instead of by token would be red here. */
const COMMENT =
  `run=${RUN} plan=${'c1'.repeat(20)} target=popmechanic/smoke base=main engine=${SHA} tier=2`
/** The same comment with `engine=` dropped — case 4's. */
const COMMENT_NO_ENGINE = `run=${RUN} plan=${'c1'.repeat(20)} target=popmechanic/smoke base=main`
/** The one address the bootstrap reads the assignment from. */
const REFLECTION_URL = 'https://reflection.int.exe.xyz/comment'
/** M3's own number, spelled in the clause. */
const BUDGET = 9216

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-fleet-bootstrap-'))
process.on('exit', () => {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true })
  } catch {
    // Left for the box's own tmp reaper; never a failed exam.
  }
})

// ── the case rig ─────────────────────────────────────────────────────────────

const write = (file, body, mode = 0o644) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
  fs.chmodSync(file, mode)
}

let caseNo = 0

/**
 * One case: a home, a stub directory first on `PATH`, and the two boot stubs
 * staged where the `git` stub copies them from.
 *
 *   `comment`  what the `curl` stub answers `/comment` with
 *   `factory`  whether the stub `clone` also writes `<dst>/factory/boot.sh`
 *   `present`  whether `<FLEET_HOME>/engines/<sha>` is already a directory
 *              holding `fleet/sandbox-boot.sh`
 */
const makeCase = ({ comment = COMMENT, factory = false, present = false } = {}) => {
  caseNo += 1
  const home = path.join(TMP_ROOT, `case-${caseNo}`)
  const bin = path.join(home, 'bin')
  const stage = path.join(home, 'stage')
  const curlLog = path.join(home, 'curl-argv.log')
  const gitLog = path.join(home, 'git-argv.log')
  /** The file the legacy stub touches before it prints anything. */
  const witness = path.join(home, 'legacy-ran')
  fs.mkdirSync(bin, { recursive: true })

  // The two boot scripts, staged. Each prints its own name and the assignment
  // it was handed, and exits 0 — `${FLEET_ASSIGNMENT:-<unset>}` so an unset or
  // empty assignment reads as a token rather than as a blank line.
  write(path.join(stage, 'sandbox-boot.sh'), [
    '#!/usr/bin/env bash',
    'set -eu',
    `printf 'ran\\n' >> ${JSON.stringify(witness)}`,
    "printf 'legacy\\n'",
    'printf \'%s\\n\' "${FLEET_ASSIGNMENT:-<unset>}"',
    'exit 0',
    '',
  ].join('\n'), 0o755)
  write(path.join(stage, 'factory-boot.sh'), [
    '#!/usr/bin/env bash',
    'set -eu',
    "printf 'factory\\n'",
    'printf \'%s\\n\' "${FLEET_ASSIGNMENT:-<unset>}"',
    'exit 0',
    '',
  ].join('\n'), 0o755)

  // `curl`: one arm, the assignment. Every invocation is logged, so "read once"
  // is read off the log rather than assumed.
  write(path.join(bin, 'curl'), [
    '#!/usr/bin/env bash',
    'set -eu',
    `printf '%s\\n' "$*" >> ${JSON.stringify(curlLog)}`,
    `printf '{"comment":"%s"}\\n' ${JSON.stringify(comment)}`,
    '',
  ].join('\n'), 0o755)

  // `git`: `clone` creates the destination directory and puts the boot scripts
  // this case wants inside it; `checkout` exits 0. Every invocation is logged,
  // which is how case 5 reads that the clone never happened.
  write(path.join(bin, 'git'), [
    '#!/usr/bin/env bash',
    'set -eu',
    `printf '%s\\n' "$*" >> ${JSON.stringify(gitLog)}`,
    'if [ "${1:-}" = clone ]; then',
    '  dst=',
    '  for arg in "$@"; do dst="$arg"; done',
    '  mkdir -p "$dst/fleet"',
    `  cp ${JSON.stringify(path.join(stage, 'sandbox-boot.sh'))} "$dst/fleet/sandbox-boot.sh"`,
    '  chmod 0755 "$dst/fleet/sandbox-boot.sh"',
    ...(factory
      ? [
          '  mkdir -p "$dst/factory"',
          `  cp ${JSON.stringify(path.join(stage, 'factory-boot.sh'))} "$dst/factory/boot.sh"`,
          '  chmod 0755 "$dst/factory/boot.sh"',
        ]
      : []),
    'fi',
    'exit 0',
    '',
  ].join('\n'), 0o755)

  const engine = path.join(home, 'engines', SHA)
  if (present) {
    fs.mkdirSync(path.join(engine, 'fleet'), { recursive: true })
    fs.copyFileSync(path.join(stage, 'sandbox-boot.sh'), path.join(engine, 'fleet', 'sandbox-boot.sh'))
    fs.chmodSync(path.join(engine, 'fleet', 'sandbox-boot.sh'), 0o755)
  }

  return { home, bin, stage, curlLog, gitLog, witness, engine }
}

/** Run the bootstrap for a case, with the unit's run argument when given. */
const boot = (ctx, args = []) => spawnSync('bash', [BOOTSTRAP, ...args], {
  encoding: 'utf8',
  env: simEnv({ bin: ctx.bin, home: ctx.home }),
})

/** The `say` lines of `<FLEET_HOME>/fleet-boot.log`, timestamp stripped. */
const messages = (ctx) => {
  const file = path.join(ctx.home, 'fleet-boot.log')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line !== '').map((line) => {
    const m = /^\S+ bootstrap: (.*)$/.exec(line)
    return m === null ? line : m[1]
  })
}

/** The lines a boot's stdout carries, without its trailing newline. */
const stdoutLines = (r) => r.stdout.replace(/\n+$/, '').split('\n').filter((l) => l !== '')

/** Every URL the `curl` stub was handed, one entry per request. */
const curlUrls = (ctx) => {
  if (!fs.existsSync(ctx.curlLog)) return []
  return fs.readFileSync(ctx.curlLog, 'utf8').split('\n').filter((l) => l !== '')
    .flatMap((line) => line.split(/\s+/).filter((tok) => tok.startsWith('http')))
}

/** The number of requests the `curl` stub answered. */
const curlCount = (ctx) => (!fs.existsSync(ctx.curlLog)
  ? 0
  : fs.readFileSync(ctx.curlLog, 'utf8').split('\n').filter((l) => l !== '').length)

/**
 * Leg (b)'s first sentence, over one boot: the comment was read once, from the
 * one address. Every case runs a boot, and every boot reads the assignment
 * exactly once, so this is asserted for each of them.
 */
const assertReadOnce = (ctx, where) => {
  assert.equal(
    curlCount(ctx), 1,
    `(b) [M2] ${where}: the stub curl saw exactly one request`
  )
  assert.deepEqual(
    curlUrls(ctx), [REFLECTION_URL],
    `(b) [M2] ${where}: that one request is to ${REFLECTION_URL}`
  )
}

/** The two exec lines M1 chooses between, for a case's home. */
const factoryExec = (ctx) => `exec ${path.join(ctx.home, 'engines', SHA, 'factory', 'boot.sh')} boot`
const legacyExec = (ctx) =>
  `exec ${path.join(ctx.home, 'engines', SHA, 'fleet', 'sandbox-boot.sh')} boot`

// ── a. [M1] case 1: the clone carries factory/boot.sh ────────────────────────
{
  const ctx = makeCase({ factory: true })
  const r = boot(ctx, [RUN])

  assert.equal(
    r.status, 0,
    `(a) [M1] the factory boot exits 0; stderr was:\n${r.stderr}`
  )
  assert.deepEqual(
    stdoutLines(r), ['factory', COMMENT],
    '(a) [M1] stdout carries `factory` followed by the comment string, which is the factory ' +
    `boot.sh stub run with FLEET_ASSIGNMENT=<comment>; stderr was:\n${r.stderr}`
  )
  assert.ok(
    messages(ctx).includes(factoryExec(ctx)),
    `(a) [M1] fleet-boot.log carries \`${factoryExec(ctx)}\`; it carried:\n` +
    messages(ctx).join('\n')
  )
  assert.equal(
    messages(ctx).includes(legacyExec(ctx)), false,
    `(a) [M1] and never \`${legacyExec(ctx)}\` — the factory file is present, so the choice is made`
  )
  // The witness, and not merely the absence of the word: case 2 runs this same
  // stub body and proves the file gets written when it does run.
  assert.equal(
    fs.existsSync(ctx.witness), false,
    '(a) [M1] `sandbox-boot.sh`\'s stub was never run — it writes the witness file as its first act'
  )
  assert.equal(
    stdoutLines(r).includes('legacy'), false,
    '(a) [M1] and nothing of it reached stdout'
  )
  assertReadOnce(ctx, 'the factory boot')
}

// ── a. [M1] case 2: the clone carries no factory/boot.sh ─────────────────────
{
  const ctx = makeCase({ factory: false })
  const r = boot(ctx, [RUN])

  assert.equal(
    r.status, 0,
    `(a) [M1] the legacy boot exits 0; stderr was:\n${r.stderr}`
  )
  assert.equal(
    fs.existsSync(path.join(ctx.engine, 'factory', 'boot.sh')), false,
    '(a) [M1] this clone created no `factory/boot.sh`'
  )
  assert.deepEqual(
    stdoutLines(r), ['legacy', COMMENT],
    '(a) [M1] stdout carries `legacy` followed by the comment string, which is the ' +
    `sandbox-boot.sh stub run with FLEET_ASSIGNMENT=<comment>; stderr was:\n${r.stderr}`
  )
  assert.ok(
    messages(ctx).includes(legacyExec(ctx)),
    `(a) [M1] fleet-boot.log carries \`${legacyExec(ctx)}\`; it carried:\n` +
    messages(ctx).join('\n')
  )
  // The positive control for case 1's witness: the same stub body, run, writes it.
  assert.ok(
    fs.existsSync(ctx.witness),
    '(a) [M1] `sandbox-boot.sh`\'s stub writes its witness file when it runs, which is what ' +
    'case 1 reads the absence of'
  )
  assertReadOnce(ctx, 'the legacy boot')
}

// ── b. [M2] case 3: the unit's run argument disagrees with the comment ───────
{
  const ctx = makeCase()
  const r = boot(ctx, ['9'])

  assert.equal(
    r.status, 1,
    `(b) [M2] \`bash fleet-bootstrap.sh 9\` against a comment saying run=${RUN} exits 1; ` +
    `stderr was:\n${r.stderr}`
  )
  assert.ok(
    messages(ctx).some((m) => m.includes('refusing')),
    `(b) [M2] and says \`refusing\` in the log; it carried:\n${messages(ctx).join('\n')}`
  )
  assert.deepEqual(
    stdoutLines(r), [],
    '(b) [M2] and execs no boot script at all'
  )
  assertReadOnce(ctx, 'the refused boot')
}

// ── b. [M2] case 4: the comment names no engine ──────────────────────────────
{
  const ctx = makeCase({ comment: COMMENT_NO_ENGINE })
  const r = boot(ctx, [RUN])

  assert.equal(
    r.status, 1,
    `(b) [M2] a comment with no \`engine=\` exits 1; stderr was:\n${r.stderr}`
  )
  assert.ok(
    messages(ctx).some((m) => m.includes('no engine=')),
    `(b) [M2] and says \`no engine=\` in the log; it carried:\n${messages(ctx).join('\n')}`
  )
  assert.deepEqual(
    stdoutLines(r), [],
    '(b) [M2] and execs no boot script at all'
  )
  assertReadOnce(ctx, 'the engine-less boot')
}

// ── b. [M2] case 5: the engine is already present ────────────────────────────
{
  const ctx = makeCase({ present: true })
  const r = boot(ctx, [RUN])

  assert.equal(
    r.status, 0,
    `(b) [M2] a boot whose engine is already present exits 0; stderr was:\n${r.stderr}`
  )
  assert.equal(
    fs.existsSync(ctx.gitLog), false,
    '(b) [M2] the stub git is never called — an engine already at ' +
    '`$FLEET_HOME/engines/<sha>` is not cloned again'
  )
  assert.ok(
    messages(ctx).some((m) => m.includes('already present')),
    `(b) [M2] and the log carries \`already present\`; it carried:\n${messages(ctx).join('\n')}`
  )
  assert.deepEqual(
    stdoutLines(r), ['legacy', COMMENT],
    '(b) [M2] and it goes on to exec the checkout that is there, with the comment'
  )
  assertReadOnce(ctx, 'the already-present boot')
}

// ── c. [M3] the rendered setup script still fits the fleet's budget ──────────
{
  assert.equal(
    SETUP_SCRIPT_BUDGET_BYTES, BUDGET,
    '(c) [M3] the fleet\'s budget for the setup script is 9216 bytes'
  )

  const bootstrap = fs.readFileSync(BOOTSTRAP, 'utf8')
  const unit = fs.readFileSync(path.join(FLEET_DIR, 'fleet-run@.service'), 'utf8')

  let script = null
  let thrown = null
  try {
    script = renderSetupScript({ run: RUN, bootstrap, unit })
  } catch (err) {
    thrown = err
  }
  assert.ok(
    thrown === null,
    '(c) [M3] renderSetupScript({ run, bootstrap, unit }) renders this bootstrap rather than ' +
    `refusing it: ${thrown === null ? '' : thrown.message}`
  )

  const bytes = Buffer.byteLength(script, 'utf8')
  assert.ok(
    bytes <= SETUP_SCRIPT_BUDGET_BYTES,
    `(c) [M3] the render is ${bytes} UTF-8 bytes, at most the budget's ${BUDGET}`
  )
}

console.log('ALL TESTS PASSED')
