/**
 * fleet/tests/test_strip_exams.mjs — publish strips the reserved exam
 * directories off the run's branch and onto the record.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Each
 * assertion names the leg it belongs to and the clause it comes from, so a
 * reader can map this file back to the contract:
 *
 *   M1  `bash fleet/strip-exams.sh <target-clone> <branch> <run-id>
 *       <evidence-dest>`, when `<branch>`'s tree holds `tests/exams/<slug>/`
 *       or `fleet/tests/exams/<slug>/` (`<slug>` = `<run-id>` with every
 *       character outside `[A-Za-z0-9_]` replaced by `_`), copies every file
 *       of each present directory to `<evidence-dest>/exams/<that
 *       directory>/…` byte for byte and moves `<branch>` to exactly one new
 *       commit whose sole parent is the previous tip, whose subject is
 *       `<run-id>: exams to the record`, and whose tree is the previous tree
 *       with those directories removed and every other path byte-identical;
 *       the clone's `HEAD`, index and working tree are unchanged.
 *   M2  when neither directory is in `<branch>`'s tree the script exits 0,
 *       prints one line containing `nothing to strip`, and the branch and
 *       `<evidence-dest>` are unchanged.
 *
 * M3 (the boot script's two calls) and M4 (the contract sentence) are proven
 * elsewhere — `fleet/tests/test_sandbox_boot_exams.mjs` and the task's scoped
 * `Run:` lines respectively.
 *
 * The rig is this file's own, and it is REAL GIT: the script is plumbing
 * against a ref, so a stub would prove nothing about the one thing M1 is
 * about — that the ref moved to a commit with the right parent, the right
 * subject and the right tree while the checkout beside it did not move at
 * all. Every scenario builds a repository under one temp root, records the
 * branch tip, the whole `ls-tree -r` listing, the blobs, `HEAD`, `git status
 * --porcelain` and the index BEFORE the script runs, and compares after.
 *
 * The working tree of each scenario is deliberately dirty — one staged
 * modification and one untracked file — because "the index and working tree
 * are unchanged" is only an assertion about something a careless
 * implementation would disturb.
 *
 * The script is run with a `cwd` of the temp root and never of the clone, so
 * an implementation that reached for the current directory instead of its
 * first argument fails here.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** The deliverable, at the path the Proof's Produces line names. */
export const SCRIPT = path.join(HERE, '..', 'strip-exams.sh')

// ── the run's literals ───────────────────────────────────────────────────────

const RUN_ID = 'run-7'
/** `<run-id>` with every character outside `[A-Za-z0-9_]` replaced by `_` (M1). */
const SLUG = 'run_7'
const BRANCH = `ultra/integration-${RUN_ID}`
/** The subject M1 pins, verbatim. */
const SUBJECT = `${RUN_ID}: exams to the record`
/** The two reserved directories, as the branch spells them. */
const RESERVED = [`tests/exams/${SLUG}`, `fleet/tests/exams/${SLUG}`]

/**
 * The files the run's examiners wrote, with bytes chosen so "byte for byte"
 * is an assertion and not a coincidence: one empty file, one multi-byte UTF-8
 * body, one body with no trailing newline at all.
 */
const EXAM_FILES = {
  [`tests/exams/${SLUG}/__init__.py`]: '',
  [`tests/exams/${SLUG}/test_a.py`]:
    '# exam a — é✓\r\ndef test_a():\n    assert True\n',
  [`fleet/tests/exams/${SLUG}/test_b.mjs`]:
    "// exam b — é✓ and no trailing newline\nexport const b = 'b'",
}

/** The run's own work, committed on the branch beside whatever exams it wrote. */
const WORK_FILE = 'fleet/notes.md'

/** What the branch carries besides the exams: a Guard exam and a curated test. */
const KEPT_FILES = {
  'README.md': '# smoke\n',
  'tests/test_guard.py': 'def test_guard():\n    assert True\n',
  'tests/test_c.py': 'def test_c():\n    assert True\n',
  'fleet/tests/test_other.mjs': "console.log('other')\n",
}

// ── the rig ──────────────────────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-exams-'))
let caseNo = 0

// One environment for every child below: git and the script see a HOME of this
// exam's own, so no ~/.gitconfig of the box reaches a repository it builds —
// each one sets its identity itself.
const ENV = simEnv()

const git = (cwd, args, opts = {}) =>
  spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV, ...opts })

const gitOk = (cwd, args) => {
  const r = git(cwd, args)
  assert.equal(r.status, 0, `git ${args.join(' ')} in ${cwd}: ${r.stdout}${r.stderr}`)
  return r.stdout
}

const write = (root, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), body)
}

/** `git ls-tree -r <ref>` as `{ path: '<mode> blob <sha>' }` — mode and blob
 *  sha together, which is what "byte-identical" means for a tree entry. */
const treeOf = (dir, ref) => {
  const out = {}
  for (const line of gitOk(dir, ['ls-tree', '-r', ref]).split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    out[line.slice(tab + 1)] = line.slice(0, tab)
  }
  return out
}

/** The raw bytes of one path at one ref. */
const blobAt = (dir, ref, rel) => {
  const r = git(dir, ['show', `${ref}:${rel}`], { encoding: 'buffer' })
  assert.equal(r.status, 0, `git show ${ref}:${rel}: ${r.stderr}`)
  return r.stdout
}

/** Every file under `root`, as `{ relative path: Buffer }` — '' when absent. */
const treeOnDisk = (root) => {
  const out = {}
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
      else out[rel] = fs.readFileSync(path.join(dir, entry.name))
    }
  }
  if (fs.existsSync(root)) walk(root, '')
  return out
}

/**
 * A repository whose `<BRANCH>` carries `KEPT_FILES` plus `exams` (a subset of
 * `EXAM_FILES`'s keys), with `HEAD` on `main`, one staged modification and one
 * untracked file in the working tree.
 */
function makeRepo(exams) {
  caseNo += 1
  const dir = path.join(tmpRoot, `clone-${caseNo}`)
  fs.mkdirSync(dir, { recursive: true })
  gitOk(dir, ['init', '-q'])
  gitOk(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  gitOk(dir, ['config', 'user.email', 'fleet@example.com'])
  gitOk(dir, ['config', 'user.name', 'fleet'])
  gitOk(dir, ['config', 'commit.gpgsign', 'false'])
  for (const [rel, body] of Object.entries(KEPT_FILES)) write(dir, rel, body)
  gitOk(dir, ['add', '-A'])
  gitOk(dir, ['commit', '-q', '-m', 'base'])

  gitOk(dir, ['checkout', '-q', '-b', BRANCH])
  // The run's own work, so the branch is ahead of `main` even in the scenario
  // that carries no exam directory at all.
  write(dir, WORK_FILE, 'the run did something\n')
  for (const rel of exams) write(dir, rel, EXAM_FILES[rel])
  gitOk(dir, ['add', '-A'])
  gitOk(dir, ['commit', '-q', '-m', `${RUN_ID}: the run's work`])
  gitOk(dir, ['checkout', '-q', 'main'])

  // The dirt: a staged modification and an untracked file, so "the index and
  // working tree are unchanged" has something to be unchanged about.
  write(dir, 'README.md', '# smoke, edited\n')
  gitOk(dir, ['add', '--', 'README.md'])
  write(dir, 'scratch.txt', 'not committed\n')
  return dir
}

/** The evidence destination — `$EVIDENCE_DIR/$EVIDENCE_PATH`, which the boot
 *  script has already created by the time it calls this script. */
function makeDest(seed = null) {
  const dest = path.join(tmpRoot, `dest-${caseNo}`)
  fs.mkdirSync(dest, { recursive: true })
  if (seed) for (const [rel, body] of Object.entries(seed)) write(dest, rel, body)
  return dest
}

const runStrip = (clone, branch, runId, dest) =>
  spawnSync('bash', [SCRIPT, clone, branch, runId, dest], {
    cwd: tmpRoot,
    encoding: 'utf8',
    timeout: 60000,
    env: ENV,
  })

/** Everything a leg compares across the run. */
const snapshot = (dir, dest) => ({
  tip: gitOk(dir, ['rev-parse', BRANCH]).trim(),
  tree: treeOf(dir, BRANCH),
  head: gitOk(dir, ['rev-parse', 'HEAD']).trim(),
  headRef: gitOk(dir, ['symbolic-ref', '-q', 'HEAD']).trim(),
  status: gitOk(dir, ['status', '--porcelain']),
  index: gitOk(dir, ['ls-files', '-s']),
  dest: treeOnDisk(dest),
})

/**
 * One scenario: a repository, a destination, the snapshot before, the script's
 * result, the snapshot after. Built once at module scope and read by the legs.
 */
function scenario(exams, { seedDest = null } = {}) {
  const dir = makeRepo(exams)
  const dest = makeDest(seedDest)
  const before = snapshot(dir, dest)
  const result = runStrip(dir, BRANCH, RUN_ID, dest)
  const after = snapshot(dir, dest)
  return { dir, dest, before, after, result }
}

/** The failure sentence every leg hangs off: what the script said. */
const said = (s) =>
  `\n--- exit ${s.result.status}${s.result.signal ? ` (${s.result.signal})` : ''}` +
  `\n--- stdout:\n${s.result.stdout}--- stderr:\n${s.result.stderr}`

// ── the scenarios ────────────────────────────────────────────────────────────

const BOTH = scenario(Object.keys(EXAM_FILES))
const FLEET_ONLY = scenario([`fleet/tests/exams/${SLUG}/test_b.mjs`])
const NEITHER = scenario([], { seedDest: { 'receipt.json': '{"run":"7"}\n' } })

// ── the runner ───────────────────────────────────────────────────────────────

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── (a) both directories, on a dirty clone whose HEAD is on main  [M1] ───────

test('the strip moves both reserved directories onto the record  [M1 / leg (a)]', () => {
  const s = BOTH
  const leg = '(a) [M1]'
  assert.ok(fs.existsSync(SCRIPT), `${leg} ${SCRIPT} is the deliverable and does not exist`)
  assert.equal(s.result.status, 0, `${leg} the strip exits 0${said(s)}`)

  assert.equal(s.after.tip !== s.before.tip, true,
    `${leg} the branch moved off ${s.before.tip}${said(s)}`)
  assert.equal(gitOk(s.dir, ['rev-parse', `${BRANCH}^`]).trim(), s.before.tip,
    `${leg} the new commit's parent is the previous tip${said(s)}`)
  const parents = gitOk(s.dir, ['rev-list', '--parents', '-n', '1', BRANCH]).trim().split(' ')
  assert.deepEqual(parents.slice(1), [s.before.tip],
    `${leg} and it is the SOLE parent — exactly one new commit${said(s)}`)
  assert.equal(gitOk(s.dir, ['log', '-1', '--format=%s', BRANCH]).trim(), SUBJECT,
    `${leg} the subject is '${SUBJECT}', verbatim${said(s)}`)
})

test("the stripped tree is the previous tree minus the reserved directories  [M1 / leg (a)]", () => {
  const s = BOTH
  const leg = '(a) [M1]'
  const listing = gitOk(s.dir, ['ls-tree', '-r', '--name-only', BRANCH]).split('\n').filter(Boolean)
  assert.deepEqual(listing.filter((p) => p.startsWith('tests/exams/')), [],
    `${leg} no path under tests/exams/ survives: ${JSON.stringify(listing)}${said(s)}`)
  assert.deepEqual(listing.filter((p) => p.startsWith('fleet/tests/exams/')), [],
    `${leg} nor under fleet/tests/exams/: ${JSON.stringify(listing)}${said(s)}`)

  // "every other path byte-identical": the whole listing, modes and blob shas
  // included, is the old one with exactly the stripped entries dropped.
  const expected = Object.fromEntries(
    Object.entries(s.before.tree).filter(([p]) => !RESERVED.some((d) => p.startsWith(`${d}/`))))
  assert.deepEqual(s.after.tree, expected,
    `${leg} the new tree is the old tree with those directories removed and nothing else${said(s)}`)
  for (const kept of ['tests/test_guard.py', 'tests/test_c.py']) {
    assert.equal(s.after.tree[kept], s.before.tree[kept],
      `${leg} ${kept} is still there at its old blob sha${said(s)}`)
  }
})

test('every file of both directories is on the record, byte for byte  [M1 / leg (a)]', () => {
  const s = BOTH
  const leg = '(a) [M1]'
  for (const rel of Object.keys(EXAM_FILES)) {
    const landed = path.join(s.dest, 'exams', rel)
    assert.ok(fs.existsSync(landed),
      `${leg} ${path.join('<dest>', 'exams', rel)} is on the record; the record holds ` +
        `${JSON.stringify(Object.keys(s.after.dest))}${said(s)}`)
    assert.deepEqual(fs.readFileSync(landed), blobAt(s.dir, s.before.tip, rel),
      `${leg} ${rel} is byte-equal to the branch's previous blob${said(s)}`)
  }
})

test("the clone's HEAD, index and working tree are unchanged  [M1 / leg (a)]", () => {
  const s = BOTH
  const leg = '(a) [M1]'
  assert.equal(s.after.headRef, 'refs/heads/main',
    `${leg} HEAD is still on main${said(s)}`)
  assert.equal(s.after.head, s.before.head, `${leg} at the same commit${said(s)}`)
  assert.equal(s.after.status, s.before.status,
    `${leg} git status --porcelain is what it was:\n${s.before.status}--- became:\n${s.after.status}${said(s)}`)
  assert.equal(s.after.index, s.before.index, `${leg} and so is the index${said(s)}`)
})

// ── (b) one directory only  [M1] ─────────────────────────────────────────────

test('a branch carrying only fleet/tests/exams is stripped there and nowhere else  [M1 / leg (b)]', () => {
  const s = FLEET_ONLY
  const leg = '(b) [M1]'
  const only = `fleet/tests/exams/${SLUG}/test_b.mjs`
  assert.equal(s.result.status, 0, `${leg} the strip exits 0${said(s)}`)
  assert.equal(gitOk(s.dir, ['rev-parse', `${BRANCH}^`]).trim(), s.before.tip,
    `${leg} one new commit on the previous tip${said(s)}`)
  assert.equal(gitOk(s.dir, ['log', '-1', '--format=%s', BRANCH]).trim(), SUBJECT,
    `${leg} with the pinned subject${said(s)}`)

  const expected = Object.fromEntries(
    Object.entries(s.before.tree).filter(([p]) => !p.startsWith(`fleet/tests/exams/${SLUG}/`)))
  assert.deepEqual(s.after.tree, expected,
    `${leg} exactly that directory left the tree — tests/ is untouched${said(s)}`)

  assert.deepEqual(fs.readFileSync(path.join(s.dest, 'exams', only)), blobAt(s.dir, s.before.tip, only),
    `${leg} and its one file is on the record byte for byte${said(s)}`)
  assert.deepEqual(Object.keys(s.after.dest), [`exams/${only}`],
    `${leg} and nothing else is: ${JSON.stringify(Object.keys(s.after.dest))}${said(s)}`)
  assert.equal(s.after.status, s.before.status, `${leg} the working tree is unchanged${said(s)}`)
  assert.equal(s.after.index, s.before.index, `${leg} and so is the index${said(s)}`)
})

// ── (c) neither directory  [M2] ──────────────────────────────────────────────

test('a branch with neither directory is left alone, and says so  [M2 / leg (c)]', () => {
  const s = NEITHER
  const leg = '(c) [M2]'
  assert.equal(s.result.status, 0, `${leg} the script exits 0${said(s)}`)
  const spoken = s.result.stdout.split('\n').filter(Boolean)
  assert.equal(spoken.filter((l) => l.includes('nothing to strip')).length, 1,
    `${leg} exactly one line of stdout contains 'nothing to strip': ${JSON.stringify(spoken)}${said(s)}`)
  assert.equal(s.after.tip, s.before.tip, `${leg} the tip sha is unchanged${said(s)}`)
  assert.deepEqual(s.after.tree, s.before.tree, `${leg} and so is its tree${said(s)}`)
  assert.deepEqual(Object.keys(s.after.dest), Object.keys(s.before.dest),
    `${leg} <evidence-dest> is unchanged: ${JSON.stringify(Object.keys(s.after.dest))}${said(s)}`)
  assert.deepEqual(s.after.dest, s.before.dest, `${leg} down to its bytes${said(s)}`)
  assert.equal(s.after.head, s.before.head, `${leg} and the clone's HEAD did not move${said(s)}`)
  assert.equal(s.after.status, s.before.status, `${leg} nor its working tree${said(s)}`)
})

// ── (f) the sentinel  [M1] ───────────────────────────────────────────────────

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
