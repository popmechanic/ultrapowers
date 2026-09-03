/**
 * Exam for `fleet/fleet-bootstrap.sh` — the golden's one immutable moving part.
 *
 * What it proves: one Reflection read; a comment without a well-formed
 * `engine=` fails before anything is cloned; an engine already present is not
 * re-cloned; the clone lands beside its final name and is moved into place
 * only when checked out; the exec target is the checkout's own boot script,
 * run in THIS process (exec, not a child) with the comment in FLEET_ASSIGNMENT;
 * and nothing is written outside `engines/` and the boot log.
 *
 * No network, no git: `curl` and `git` are stubs on a PATH shim, and the git
 * stub plants a recorder where the checkout's `fleet/sandbox-boot.sh` would be.
 * `FLEET_HOME` relocates the two paths the script writes; `HOME` points at the
 * same directory so a stray `~` write would show up in the listing.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, '..', 'fleet-bootstrap.sh')
const ENGINE_REPO = 'https://github.com/popmechanic/ultrapowers.git'

const SHA = 'c3'.repeat(20)
const COMMENT =
  `run=7 plan=${'a1'.repeat(20)} target=popmechanic/smoke base=${'b2'.repeat(20)} engine=${SHA} overlap=fold`

// The recorder the git stub plants as the checkout's boot script. It writes
// what the bootstrap handed it — argv, the one env var, and its own pid — to
// a file OUTSIDE the home, so the home listing stays the bootstrap's alone.
const RECORDER = `#!/bin/sh
{ printf 'argv0=%s\\n' "$0"; printf 'arg1=%s\\n' "\${1:-}"; printf 'assignment=%s\\n' "\${FLEET_ASSIGNMENT:-}"; printf 'pid=%s\\n' "$$"; } >"$STUB_RECORD"
exit 0
`

const STUBS = {
  curl: `
argv "curl" "$@"
[ -n "\${STUB_CURL_FAIL:-}" ] && exit 22
printf '{"comment":"%s"}\\n' "$STUB_COMMENT"
`,
  git: `
argv "git" "$@"
case "$1" in
  clone)
    dir="$4"
    # Real git refuses a destination that already exists and is not empty.
    [ -e "$dir" ] && { echo "fatal: destination path '$dir' already exists" >&2; exit 128; }
    [ -n "\${STUB_CLONE_FAIL:-}" ] && exit 128
    mkdir -p "$dir/.git" "$dir/fleet"
    printf '%s' "$STUB_RECORDER" >"$dir/fleet/sandbox-boot.sh"
    chmod 755 "$dir/fleet/sandbox-boot.sh" ;;
  -C)
    [ "$3" = checkout ] && [ -n "\${STUB_CHECKOUT_FAIL:-}" ] && exit 1 ;;
esac
exit 0
`,
}

const PRELUDE = `#!/bin/sh
argv() { name="$1"; shift; { for a in "$name" "$@"; do printf '%s\\t' "$a"; done; printf '\\n'; } >>"$STUB_LOG_DIR/$name.log"; }
`

// ── harness ──────────────────────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-bootstrap-'))
let caseNo = 0

function makeCase() {
  caseNo += 1
  const root = path.join(tmpRoot, `case-${caseNo}`)
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  const logs = path.join(root, 'logs')
  for (const d of [home, bin, logs]) fs.mkdirSync(d, { recursive: true })
  for (const [name, body] of Object.entries(STUBS)) {
    const file = path.join(bin, name)
    fs.writeFileSync(file, PRELUDE + body)
    fs.chmodSync(file, 0o755)
  }
  return { root, home, bin, logs, record: path.join(root, 'record') }
}

function run(ctx, env = {}, args = []) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${ctx.bin}:${process.env.PATH}`,
      HOME: ctx.home,
      FLEET_HOME: ctx.home,
      STUB_LOG_DIR: ctx.logs,
      STUB_RECORD: ctx.record,
      STUB_RECORDER: RECORDER,
      STUB_COMMENT: COMMENT,
      ...env,
    },
    timeout: 30000,
  })
}

const readLog = (ctx, name) => {
  const f = path.join(ctx.logs, `${name}.log`)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
const lines = (text) => text.split('\n').filter(Boolean)
const argvLines = (ctx, tool) =>
  lines(readLog(ctx, tool)).map((l) => l.split('\t').filter((s) => s !== ''))
const bootLog = (ctx) => {
  const f = path.join(ctx.home, 'fleet-boot.log')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
const homeListing = (ctx) => fs.readdirSync(ctx.home).sort()
const record = (ctx) => {
  if (!fs.existsSync(ctx.record)) return null
  return Object.fromEntries(lines(fs.readFileSync(ctx.record, 'utf8')).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i), l.slice(i + 1)]
  }))
}
const commentReads = (ctx) =>
  argvLines(ctx, 'curl').filter((a) => a.some((s) => s.endsWith('/comment'))).length

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the script itself ────────────────────────────────────────────────────────

test('the bootstrap parses, is executable, and fits its budget', () => {
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0)
  assert.ok(fs.statSync(SCRIPT).mode & 0o111, 'mode must carry an execute bit')
  const n = fs.readFileSync(SCRIPT, 'utf8').split('\n').filter((l, i, a) => i < a.length - 1 || l).length
  assert.ok(n <= 40, `${n} lines; the budget is 40`)
  assert.ok(/^set -euo pipefail$/m.test(fs.readFileSync(SCRIPT, 'utf8')))
})

// ── the green path ───────────────────────────────────────────────────────────

test('one read, one clone at the sha, one exec with the assignment in the env', () => {
  const ctx = makeCase()
  const r = run(ctx)
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(commentReads(ctx), 1, 'the comment is read exactly once')

  const H = ctx.home
  assert.deepEqual(argvLines(ctx, 'git'), [
    ['git', 'clone', '-q', ENGINE_REPO, `${H}/engines/${SHA}.tmp`],
    ['git', '-C', `${H}/engines/${SHA}.tmp`, 'checkout', '-q', SHA],
  ])
  assert.ok(fs.existsSync(path.join(H, 'engines', SHA, '.git')), 'the checkout is moved into place')
  assert.ok(!fs.existsSync(path.join(H, 'engines', `${SHA}.tmp`)), 'the scratch name is gone')

  const rec = record(ctx)
  assert.ok(rec, 'the checkout boot script ran')
  assert.equal(rec.argv0, `${H}/engines/${SHA}/fleet/sandbox-boot.sh`)
  assert.equal(rec.arg1, 'boot')
  assert.equal(rec.assignment, COMMENT)
  assert.equal(Number(rec.pid), r.pid, 'exec: the boot script IS the bootstrap process, not a child')

  // One line per step, and nothing else in the home.
  const log = lines(bootLog(ctx))
  assert.equal(log.length, 3, log.join('\n'))
  assert.match(log[0], / bootstrap: comment: run=7 /)
  assert.match(log[1], / bootstrap: cloning engine at /)
  assert.match(log[2], / bootstrap: exec /)
  assert.deepEqual(homeListing(ctx), ['engines', 'fleet-boot.log'])
})

test('an engine already present is not cloned again', () => {
  const ctx = makeCase()
  const dst = path.join(ctx.home, 'engines', SHA, 'fleet')
  fs.mkdirSync(dst, { recursive: true })
  fs.writeFileSync(path.join(dst, 'sandbox-boot.sh'), RECORDER)
  fs.chmodSync(path.join(dst, 'sandbox-boot.sh'), 0o755)

  const r = run(ctx)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(readLog(ctx, 'git'), '', 'no git at all')
  assert.equal(record(ctx).assignment, COMMENT)
  assert.ok(bootLog(ctx).includes('already present'))
})

test('a scratch directory left by a dead attempt is discarded before the clone', () => {
  const ctx = makeCase()
  const stale = path.join(ctx.home, 'engines', `${SHA}.tmp`)
  fs.mkdirSync(stale, { recursive: true })
  fs.writeFileSync(path.join(stale, 'half-written'), '')

  const r = run(ctx)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(fs.existsSync(path.join(ctx.home, 'engines', SHA, '.git')))
  assert.ok(!fs.existsSync(stale))
})

// ── the unit's %i: the run number, checked against the comment ──────────────

test('the run number the unit passes is accepted when the comment agrees', () => {
  // fleet-run@7.service runs `fleet-bootstrap.sh 7`. The assignment still
  // comes from Reflection; the argument only proves this is run 7's box.
  const ctx = makeCase()
  const r = run(ctx, {}, ['7'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(commentReads(ctx), 1, 'still one read')
  const rec = record(ctx)
  assert.ok(rec, 'the checkout boot script ran')
  assert.equal(rec.arg1, 'boot', 'the boot script gets `boot`, not the run number')
  assert.equal(rec.assignment, COMMENT, 'the assignment is the comment, not something built from $1')
  assert.match(bootLog(ctx), / bootstrap: comment: run=7 .*\(unit run=7\)/, 'the unit\'s number is logged')
})

test('a run number that disagrees with the comment is logged and fatal', () => {
  // fleet-run@8.service on a box whose comment says run=7: the wrong unit on
  // the wrong VM. Refuse before anything is cloned or exec\'d.
  const ctx = makeCase()
  const r = run(ctx, {}, ['8'])
  assert.notEqual(r.status, 0, 'must exit non-zero')
  assert.equal(commentReads(ctx), 1, 'one read')
  assert.equal(readLog(ctx, 'git'), '', 'nothing is cloned')
  assert.equal(record(ctx), null, 'nothing is exec\'d')
  assert.match(bootLog(ctx), /unit run=8 but the comment says run=7/, bootLog(ctx))
  assert.deepEqual(homeListing(ctx), ['fleet-boot.log'], 'only the log is written')
})

test('a run number against a comment with no run= is fatal too', () => {
  const ctx = makeCase()
  const r = run(ctx, { STUB_COMMENT: `plan=${'a1'.repeat(20)} engine=${SHA}` }, ['7'])
  assert.notEqual(r.status, 0)
  assert.equal(record(ctx), null)
  assert.match(bootLog(ctx), /unit run=7 but the comment says run=<none>/, bootLog(ctx))
})

// ── refusals: nothing is cloned ──────────────────────────────────────────────

const refusals = [
  ['no engine= at all', 'run=7 plan=a1 target=popmechanic/smoke'],
  ['an engine= that is not 40 hex', `run=7 engine=${'c3'.repeat(19)}`],
  ['an engine= with upper-case hex', `run=7 engine=${'C3'.repeat(20)}`],
  ['an engine= glued to another token', `run=7 engine=${SHA}x`],
  ['an empty comment', ''],
]
for (const [what, comment] of refusals) {
  test(`${what} fails the run without cloning`, () => {
    const ctx = makeCase()
    const r = run(ctx, { STUB_COMMENT: comment })
    assert.notEqual(r.status, 0, 'must exit non-zero')
    assert.equal(commentReads(ctx), 1, 'still one read — no waiting for a better comment')
    assert.equal(readLog(ctx, 'git'), '', 'nothing is cloned')
    assert.equal(record(ctx), null, 'nothing is exec\'d')
    assert.ok(bootLog(ctx).includes('no engine=<40 hex>'), bootLog(ctx))
    assert.deepEqual(homeListing(ctx), ['fleet-boot.log'], 'only the log is written')
  })
}

test('an unreachable Reflection fails the run without cloning', () => {
  const ctx = makeCase()
  const r = run(ctx, { STUB_CURL_FAIL: '1' })
  assert.notEqual(r.status, 0)
  assert.equal(readLog(ctx, 'git'), '')
  assert.equal(record(ctx), null)
  assert.ok(bootLog(ctx).includes('unreachable'))
  assert.deepEqual(homeListing(ctx), ['fleet-boot.log'])
})

test('a clone that fails leaves no engine and runs nothing', () => {
  const ctx = makeCase()
  const r = run(ctx, { STUB_CLONE_FAIL: '1' })
  assert.notEqual(r.status, 0)
  assert.equal(record(ctx), null, 'nothing is exec\'d')
  assert.ok(!fs.existsSync(path.join(ctx.home, 'engines', SHA)), 'no engine under its final name')
})

test('a sha the clone cannot check out leaves no engine and runs nothing', () => {
  const ctx = makeCase()
  const r = run(ctx, { STUB_CHECKOUT_FAIL: '1' })
  assert.notEqual(r.status, 0)
  assert.equal(record(ctx), null)
  assert.ok(!fs.existsSync(path.join(ctx.home, 'engines', SHA)),
    'a checkout that failed is never moved into place')
})

// ── run ──────────────────────────────────────────────────────────────────────

let failures = 0
for (const [name, fn] of tests) {
  const started = Date.now()
  try {
    fn()
    console.log(`ok (${Date.now() - started} ms) — ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL — ${name}`)
    console.log(String(error && error.stack ? error.stack : error))
  }
}
fs.rmSync(tmpRoot, { recursive: true, force: true })
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
console.log('ALL TESTS PASSED')
