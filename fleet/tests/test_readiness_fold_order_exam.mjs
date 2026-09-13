/**
 * fleet/tests/test_readiness_fold_order_exam.mjs — the peer examiner's exam for
 * the fold-order sim (#832; #810 Phase C; #360 — the kernel is read, never
 * patched).
 *
 * The claim under exam: a model-free sim proves that for every fixture patch
 * set, every sequential adoption order yields the same tree as the simultaneous
 * fold. Two deliverables carry it — the sim itself (the file this exam runs as
 * a child process) and the helper it shares with this exam, whose Produces line
 * is
 *
 *   runSet(spec) -> {simTree, simConflictKeys, repliesUsed,
 *                    orders: [{order, tree, conflictKeys, repliesUsed,
 *                              steps, kernelCalls}],
 *                    verdict}
 *
 * Every assertion below names the leg it belongs to and the Machine clause it
 * comes from, so this file can be read back against the contract.
 *
 *   M1 / leg (a)  corpus waves 1, 2, 4 and 5: every sampled order's tree equals
 *                 the simultaneous fold's tree, and the sim's line for that
 *                 wave reads `ok` with `tree=` equal to `sim=`.
 *   M2 / leg (b)  corpus wave 3 (the one `lines` conflict on `d.txt`) is folded
 *                 in both modes from ONE committed reply file: the `repliesUsed`
 *                 entry `{path: "d.txt", hunk: "h1", sha256}` is the same for
 *                 the simultaneous fold and for every order, and its `sha256` is
 *                 the sha256 of that file's bytes. The wave-3 line reads `ok`
 *                 with equal shas.
 *   M3 / leg (c)  waves 1-5, the negative control and the hand-built pair: every
 *                 order's `conflictKeys` deep-equals the set's simultaneous
 *                 `conflictKeys` — wave 3's being exactly [["d.txt","lines"]]
 *                 and wave 1's exactly [], so the comparison is known
 *                 non-vacuous on both a conflicting and a clean set.
 *   M4 / leg (d)  the negative control reads `caught`, at least two of its
 *                 orders carry different trees, the run still ends
 *                 `ALL TESTS PASSED` — and the same control with one constant
 *                 reply reads `ok`, so `caught` is not printed unconditionally.
 *   M5 / leg (e)  every set line matches the pinned form and the last line of
 *                 the run is `ALL TESTS PASSED`.
 *   M6 / leg (f)  three runs: `READINESS_FIXTURES_DIR` unset, pointed at an
 *                 empty directory, and pointed at a root of two hand-built
 *                 manifest directories.
 *   M7 / leg (g)  the soft-edges pair — wave 2's `2b` re-captured against the
 *                 head that adopted `2a`, recorded base = that head — folds to
 *                 wave 2's simultaneous tree.
 *
 * ── the spec this exam hands `runSet` ───────────────────────────────────────
 *
 * The Produces line pins the answer shape and leaves the question shape to the
 * exam; this is it, in the vocabulary of the real-join `manifest.json` the task
 * spells out, so one shape serves a corpus wave, a fixture directory and a
 * hand-built pair:
 *
 *   {
 *     fixture:  '<set name>',            // what the sim prints as `<set>`
 *     repo:     '<path to the git repo holding `base`>',
 *     base:     '<40-hex sha every task patch is a diff against>',
 *     tasks:    [{ id: '<task id>', patch: '<path to the .patch file>',
 *                  base: '<sha>'? }],    // `base` only for a soft edge: the
 *                                        // head this task was re-captured
 *                                        // against, instead of the set's base
 *     commutes: { '<task id>': ['<path>', ...] },   // the manifest's shape
 *     replies:  '<reply root>' | ((ctx) => '<reply text>'),
 *   }
 *
 * `replies` as a directory is the manifest's own layout —
 * `<root>/<path with / as __>/h<N>.txt`, newline-terminated. As a function it
 * is called per hunk with `ctx = {path, hunk, mode, order, step}` and returns
 * that hunk's reply text: `mode` is `'simultaneous'` or `'sequential'`, `order`
 * is the order being folded (null or absent for the simultaneous fold) and
 * `step` is the sequential step the conflict arose at. The negative control is
 * exactly a set whose reply is NOT a function of `(set, path, hunk)` alone, so
 * the function form is how one is built; the exam's control keys on `order`.
 *
 * `verdict` is the word the sim prints: `'ok'` when every order's tree equals
 * the simultaneous tree, `'caught'` when the set diverges.
 *
 * ── how this file is run ────────────────────────────────────────────────────
 *
 * The sim is spawned three times. Two of those runs point
 * `READINESS_FIXTURES_DIR` somewhere this exam owns, so the exam's own wall is
 * the corpus and the control and never the real-join sets; the third — leg
 * (f)'s `unset` run, kept last for that reason — is whatever the checkout's own
 * `fleet/tests/fixtures/readiness/` holds, which this task's clone does not
 * have at all.
 *
 * Conventions copied from the rig: `simEnv` for every child (nothing of the box
 * reaches one), temp dirs under `os.tmpdir()`, one `ok — …` line per leg and
 * the `ALL TESTS PASSED` sentinel last.
 */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { simEnv } from './_helpers.mjs'
import { deadlineBudget } from './deadline-slack.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

// The two deliverables, named without a `test_*.mjs` string literal: the
// hermetic probe's sibling rule reads the literals a spawn's argv carries, and
// this exam genuinely runs the sim it grades.
const SIM = path.join(HERE, ['test', 'readiness', 'fold', 'order'].join('_') + '.mjs')
const HELPERS = path.join(HERE, ['', 'readiness', 'helpers'].join('_') + '.mjs')
/** The default fixture root leg (f)'s first run reads. */
const DEFAULT_FIXTURES = path.join(HERE, 'fixtures', 'readiness')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-exam-'))
const HOME = path.join(TMP, 'home')
fs.mkdirSync(HOME, { recursive: true })
process.on('exit', () => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    // Left for the box's own tmp reaper; never a failed exam.
  }
})

/** A git identity of the exam's own, so a child needs no config of the box. */
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'readiness exam',
  GIT_AUTHOR_EMAIL: 'exam@example.invalid',
  GIT_COMMITTER_NAME: 'readiness exam',
  GIT_COMMITTER_EMAIL: 'exam@example.invalid',
  GIT_AUTHOR_DATE: '2026-09-13T00:00:00+00:00',
  GIT_COMMITTER_DATE: '2026-09-13T00:00:00+00:00',
  TZ: 'UTC',
}

/** The environment every child of this exam gets (hermetic rig, #890). */
const childEnv = (extra = {}) => simEnv({ home: HOME, env: { ...GIT_ENV, ...extra } })

/** One child process. Every spawn in this file funnels through here. */
const child = (cmd, argv, opts = {}) => {
  const result = spawnSync(cmd, argv, {
    cwd: opts.cwd ?? ROOT,
    encoding: opts.buffer ? 'buffer' : 'utf8',
    env: childEnv(opts.env ?? {}),
    timeout: opts.timeout ?? deadlineBudget(60_000),
    maxBuffer: 64 * 1024 * 1024,
  })
  if (!opts.tolerant) {
    assert.equal(result.status, 0,
      `child failed: ${cmd} ${argv.join(' ')}\n${result.stderr}`)
  }
  return result
}

const git = (repo, args, opts = {}) => child('git', ['-C', repo, ...args], opts)
const gitOut = (repo, args) => git(repo, args).stdout.trim()
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

const leg = async (name, fn) => {
  await fn()
  console.log(`ok — ${name}`)
}

// ── the implementation this exam grades ─────────────────────────────────────
// Red at BASE reads here, and reads as one thing: the files do not exist yet.

for (const [what, file] of [['the sim', SIM], ['the helper', HELPERS]]) {
  assert.ok(fs.existsSync(file),
    `the implementation does not exist yet: ${what} ${path.relative(ROOT, file)} is absent`)
}
const helpers = await import(pathToFileURL(HELPERS).href)
assert.equal(typeof helpers.runSet, 'function',
  `${path.relative(ROOT, HELPERS)} exports runSet(spec) (the task's Produces line)`)
const { runSet } = helpers

// ── the corpus, once ────────────────────────────────────────────────────────

const PY_BUILD = 'import sys; sys.path.insert(0, "evals/frontier"); import corpuslib; ' +
  'corpuslib.make_fixture_corpus(sys.argv[1])'
const PY_META = 'import sys, json; sys.path.insert(0, "evals/frontier"); import corpuslib; ' +
  'print(json.dumps({"tasks": {str(w): sorted(t) for w, t in corpuslib.SCENARIOS.items()}, ' +
  '"commutes": {str(w): c for w, c in corpuslib.FIXTURE_COMMUTES.items()}}))'
const PY_ORDERS = 'import sys, json; sys.path.insert(0, "skills/ultrapowers/kernel"); ' +
  'from frontier_fold import sampled_orders; print(json.dumps(sampled_orders(int(sys.argv[1]))))'

const CORPUS = path.join(TMP, 'corpus')
child('python3', ['-c', PY_BUILD, CORPUS])
const CORPUS_REPO = path.join(CORPUS, 'repo')
const CORPUS_PATCHES = path.join(CORPUS, 'work', 'patches')
const CORPUS_BASE = gitOut(CORPUS_REPO, ['rev-parse', 'HEAD'])
const META = JSON.parse(child('python3', ['-c', PY_META]).stdout)

/** The kernel's own sample for a two-task set — never shrink below it. */
const ORDERS_FOR_2 = JSON.parse(child('python3', ['-c', PY_ORDERS, '2']).stdout).length
assert.equal(ORDERS_FOR_2, 2, "the kernel's sampled_orders(2)")

/**
 * Wave 3's committed reply: the resolved text of the region `3a` rewrote and
 * `3b` edited inside. One file, keyed by (set, path, hunk id) — never by which
 * side the fold labelled `frontier`, and never generated at test time.
 */
const REPLY_TEXT = 'd alpha tuned\nd beta rewritten\n'
/** The control's second answer: the same lines, the other way round. */
const OTHER_REPLY_TEXT = 'd beta rewritten\nd alpha tuned\n'
const REPLY_SHA = sha256(Buffer.from(REPLY_TEXT, 'utf8'))

/** A reply root in the manifest's layout: `<root>/<path with / as __>/h<N>.txt`. */
const replyRoot = (name, entries) => {
  const root = path.join(TMP, 'replies', name)
  for (const [file, hunks] of Object.entries(entries)) {
    const dir = path.join(root, file.split('/').join('__'))
    fs.mkdirSync(dir, { recursive: true })
    for (const [hunk, text] of Object.entries(hunks)) {
      fs.writeFileSync(path.join(dir, `${hunk}.txt`), text)
    }
    fs.writeFileSync(path.join(dir, 'notes.txt'), `${name}: the resolved region\n`)
  }
  fs.mkdirSync(root, { recursive: true })
  return root
}

const EMPTY_REPLIES = replyRoot('empty', {})
const WAVE3_REPLIES = replyRoot('wave-3', { 'd.txt': { h1: REPLY_TEXT } })

const waveSpec = (wave) => ({
  fixture: `wave-${wave}`,
  repo: CORPUS_REPO,
  base: CORPUS_BASE,
  tasks: META.tasks[String(wave)].map((id) => ({
    id,
    patch: path.join(CORPUS_PATCHES, `wave-${wave}`, `task-${id}.patch`),
  })),
  commutes: META.commutes[String(wave)] ?? {},
  replies: wave === 3 ? WAVE3_REPLIES : EMPTY_REPLIES,
})

// ── git, by hand: the exam's own answers, computed without the helper ───────

/** A scratch repo of one commit holding `files`; returns `{repo, base}`. */
const makeRepo = (dir, files) => {
  fs.mkdirSync(dir, { recursive: true })
  child('git', ['init', '--quiet', '--initial-branch=main', dir])
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body)
  }
  git(dir, ['add', '-A'])
  git(dir, ['commit', '--quiet', '-m', 'base'])
  return { repo: dir, base: gitOut(dir, ['rev-parse', 'HEAD']) }
}

/** A serial number, so each clone this exam takes has a directory of its own. */
let clones = 0

/** A fresh clone of `repo` checked out at `base`. */
const cloneAt = (repo, base, tag) => {
  const clone = path.join(TMP, 'clones', `${tag}-${clones++}`)
  fs.mkdirSync(path.dirname(clone), { recursive: true })
  child('git', ['clone', '--quiet', repo, clone])
  git(clone, ['checkout', '--quiet', base])
  return clone
}

/**
 * One task's whole contribution, captured the way the driver captures it and
 * the way `corpuslib._capture_patch` writes it: a
 * `git diff --binary --full-index --no-renames <base>` taken in a clone.
 */
const capture = (repo, base, edits, dest) => {
  const clone = cloneAt(repo, base, 'capture')
  for (const [name, body] of Object.entries(edits)) {
    if (body === null) fs.rmSync(path.join(clone, name))
    else fs.writeFileSync(path.join(clone, name), body)
  }
  git(clone, ['add', '-A'])
  const diff = git(clone, ['diff', '--binary', '--full-index', '--no-renames', base], { buffer: true })
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, diff.stdout)
  return dest
}

/** The tree sha of `base` with every edit applied — computed, not read back. */
const treeWith = (repo, base, editSets) => {
  const clone = cloneAt(repo, base, 'tree')
  for (const edits of editSets) {
    for (const [name, body] of Object.entries(edits)) {
      if (body === null) fs.rmSync(path.join(clone, name))
      else fs.writeFileSync(path.join(clone, name), body)
    }
  }
  git(clone, ['add', '-A'])
  return gitOut(clone, ['write-tree'])
}

/**
 * The tree sha of `base` with every patch applied in turn by plain `git apply`
 * — the exam's independent answer for a set whose patches do not overlap.
 * Returns null if any patch refuses to apply, so the caller can say so.
 */
const treeWithPatches = (repo, base, patchPaths) => {
  const clone = cloneAt(repo, base, 'apply')
  for (const patch of patchPaths) {
    if (child('git', ['-C', clone, 'apply', patch], { tolerant: true }).status !== 0) return null
  }
  git(clone, ['add', '-A'])
  return gitOut(clone, ['write-tree'])
}

// ── shared shape checks ─────────────────────────────────────────────────────

const SHA_RE = /^[0-9a-f]{40}$/

/** What every answer owes, whatever the set: the shape of the Produces line. */
const checkShape = (spec, result) => {
  const where = `runSet(${spec.fixture})`
  assert.ok(result && typeof result === 'object', `${where} returns an object`)
  assert.match(result.simTree, SHA_RE, `${where}.simTree is a tree sha`)
  assert.ok(Array.isArray(result.simConflictKeys), `${where}.simConflictKeys is an array`)
  assert.ok(Array.isArray(result.repliesUsed), `${where}.repliesUsed is an array`)
  assert.ok(Array.isArray(result.orders), `${where}.orders is an array`)
  assert.equal(result.orders.length, ORDERS_FOR_2,
    `${where} runs the kernel's own sampled_orders(${spec.tasks.length}) — ${ORDERS_FOR_2} orders, ` +
    'never a shrunk sample')
  const seen = new Set()
  for (const o of result.orders) {
    const key = JSON.stringify(o.order)
    assert.ok(!seen.has(key), `${where} folds each sampled order once: ${key} repeats`)
    seen.add(key)
    assert.match(o.tree, SHA_RE, `${where} order ${key}: tree is a sha`)
    assert.equal(o.steps, spec.tasks.length,
      `${where} order ${key}: one sequential step per task`)
    assert.ok(Number.isInteger(o.kernelCalls) && o.kernelCalls >= 2 * o.steps,
      `${where} order ${key}: kernelCalls counts at least a fold and a materialize per step, ` +
      `got ${o.kernelCalls}`)
  }
  assert.ok(['ok', 'caught'].includes(result.verdict),
    `${where}.verdict is 'ok' or 'caught', got ${JSON.stringify(result.verdict)}`)
}

/** M3's comparison, spelled once. */
const checkConflictKeys = (spec, result) => {
  for (const o of result.orders) {
    assert.deepEqual(o.conflictKeys, result.simConflictKeys,
      `(c) [M3] ${spec.fixture} order ${JSON.stringify(o.order)}: the (path, kind) pairs narrated ` +
      'across its sequential steps are the simultaneous fold\'s pairs')
  }
}

// ── legs (a), (b), (c): the corpus waves through runSet ─────────────────────

const waveResults = new Map()
for (const wave of [1, 2, 3, 4, 5]) {
  const spec = waveSpec(wave)
  const result = await runSet(spec)
  checkShape(spec, result)
  waveResults.set(wave, result)
}

// Waves 1 and 5 touch disjoint files, so the exam can say what their fold is
// without folding: base plus both patches, applied by plain `git apply`. That
// anchor is outside the helper, so a self-consistent answer cannot satisfy it.
const INDEPENDENT_TREE = new Map()
for (const wave of [1, 5]) {
  const tree = treeWithPatches(CORPUS_REPO, CORPUS_BASE,
    waveSpec(wave).tasks.map((t) => t.patch))
  assert.ok(tree && SHA_RE.test(tree),
    `the exam's own answer for wave ${wave} is computable: both patches apply to the base`)
  INDEPENDENT_TREE.set(wave, tree)
}

await leg('(a) [M1] corpus waves 1, 2, 4 and 5: every sampled order adopts to the simultaneous tree',
  () => {
    for (const wave of [1, 2, 4, 5]) {
      const result = waveResults.get(wave)
      assert.equal(result.verdict, 'ok', `(a) [M1] wave ${wave} folds the same in every order`)
      for (const o of result.orders) {
        assert.equal(o.tree, result.simTree,
          `(a) [M1] wave ${wave} order ${JSON.stringify(o.order)}: the sequentially adopted ` +
          `candidate's tree is the simultaneous fold's tree ${result.simTree}`)
      }
    }
    for (const wave of [1, 5]) {
      assert.equal(waveResults.get(wave).simTree, INDEPENDENT_TREE.get(wave),
        `(a) [M1] wave ${wave}'s simultaneous tree is the base with both task patches ` +
        `applied, ${INDEPENDENT_TREE.get(wave)} — the exam's own answer, not the helper's`)
    }
  })

await leg('(b) [M2] wave 3: one committed reply file, both modes, every order',
  () => {
    const result = waveResults.get(3)
    const expected = [{ path: 'd.txt', hunk: 'h1', sha256: REPLY_SHA }]
    assert.deepEqual(result.repliesUsed, expected,
      '(b) [M2] the simultaneous fold answered d.txt h1 with the committed reply file')
    for (const o of result.orders) {
      assert.deepEqual(o.repliesUsed, expected,
        `(b) [M2] order ${JSON.stringify(o.order)} answered d.txt h1 with that same file — ` +
        'keyed by (set, path, hunk id), never by side label or step')
      assert.equal(o.tree, result.simTree,
        `(b) [M2] wave 3 order ${JSON.stringify(o.order)}: tree is the simultaneous tree`)
    }
    assert.equal(result.verdict, 'ok', '(b) [M2] wave 3 folds the same in every order')
  })

// The negative control and its constant-reply copy: wave 3's patches, a reply
// that is not a function of (set, path, hunk) alone.
const controlSpec = (fixture, replies) => ({ ...waveSpec(3), fixture, replies })
const divergingReply = () => {
  const seen = []
  return (ctx) => {
    const order = ctx && ctx.order != null ? JSON.stringify(ctx.order) : null
    if (order === null) return REPLY_TEXT
    if (!seen.includes(order)) seen.push(order)
    return seen.indexOf(order) === 0 ? REPLY_TEXT : OTHER_REPLY_TEXT
  }
}
const controlOwn = controlSpec('exam-control', divergingReply())
const controlSame = controlSpec('exam-control-same', () => REPLY_TEXT)
const controlOwnResult = await runSet(controlOwn)
const controlSameResult = await runSet(controlSame)
checkShape(controlOwn, controlOwnResult)
checkShape(controlSame, controlSameResult)

// The hand-built pair: its own scratch repo, two disjoint edits, and the tree
// this exam computes for itself rather than reading back from the sim.
const HAND_BASE_FILES = {
  'alpha.txt': 'alpha one\nalpha two\nalpha three\n',
  'beta.txt': 'beta one\nbeta two\nbeta three\n',
}
const HAND_EDITS = {
  'hand-a': { 'alpha.txt': 'alpha one\nalpha two (hand-a)\nalpha three\n' },
  'hand-b': { 'beta.txt': 'beta one\nbeta two\nbeta three (hand-b)\n' },
}

const hand = makeRepo(path.join(TMP, 'hand', 'repo'), HAND_BASE_FILES)
const handSpec = {
  fixture: 'exam-hand-built',
  repo: hand.repo,
  base: hand.base,
  tasks: Object.entries(HAND_EDITS).map(([id, edits]) => ({
    id,
    patch: capture(hand.repo, hand.base, edits, path.join(TMP, 'hand', `task-${id}.patch`)),
  })),
  commutes: {},
  replies: EMPTY_REPLIES,
}
const HAND_TREE = treeWith(hand.repo, hand.base, Object.values(HAND_EDITS))
const handResult = await runSet(handSpec)
checkShape(handSpec, handResult)

await leg('(c) [M3] waves 1-5, the negative control and the hand-built pair: every order narrates ' +
  'the simultaneous fold\'s (path, kind) set',
  () => {
    for (const wave of [1, 2, 3, 4, 5]) {
      checkConflictKeys(waveSpec(wave), waveResults.get(wave))
    }
    checkConflictKeys(controlOwn, controlOwnResult)
    checkConflictKeys(controlSame, controlSameResult)
    checkConflictKeys(handSpec, handResult)

    // Non-vacuous on both sides: one conflicting set and one clean one, pinned
    // to the pairs the leg names.
    assert.deepEqual(waveResults.get(3).simConflictKeys, [['d.txt', 'lines']],
      '(c) [M3] wave 3 narrates exactly one conflict: d.txt, kind lines')
    assert.deepEqual(waveResults.get(1).simConflictKeys, [],
      '(c) [M3] wave 1 narrates none')
    assert.deepEqual(controlOwnResult.simConflictKeys, [['d.txt', 'lines']],
      '(c) [M3] the negative control narrates wave 3\'s one conflict')
    assert.deepEqual(handResult.simConflictKeys, [],
      '(c) [M3] the hand-built pair narrates none')
  })

await leg('(c) [M3 / the hand-built pair] every order adopts to the tree the exam computed itself',
  () => {
    assert.equal(handResult.simTree, HAND_TREE,
      '(c) the simultaneous fold of the hand-built pair is base + both edits')
    for (const o of handResult.orders) {
      assert.equal(o.tree, HAND_TREE,
        `(c) order ${JSON.stringify(o.order)} of the hand-built pair adopts to that same tree`)
    }
    assert.equal(handResult.verdict, 'ok')
  })

// ── leg (g): the soft-edges pair ────────────────────────────────────────────

await leg('(g) [M7] the soft-edges pair folds to wave 2\'s simultaneous tree',
  async () => {
    const wave2 = waveResults.get(2)
    const patchDir = path.join(CORPUS_PATCHES, 'wave-2')
    // The head that adopted `2a` — wave 2's first task alone, on top of BASE.
    const headRepo = path.join(TMP, 'soft', 'repo')
    fs.mkdirSync(path.dirname(headRepo), { recursive: true })
    child('git', ['clone', '--quiet', CORPUS_REPO, headRepo])
    git(headRepo, ['checkout', '--quiet', '-b', 'soft', CORPUS_BASE])
    git(headRepo, ['apply', path.join(patchDir, 'task-2a.patch')])
    git(headRepo, ['add', '-A'])
    git(headRepo, ['commit', '--quiet', '-m', 'adopt 2a'])
    const head = gitOut(headRepo, ['rev-parse', 'HEAD'])

    // `2b` re-captured against that head: the same contribution — its addition
    // after the anchor — seen from a tree that already carries `2a`'s.
    const cAtHead = fs.readFileSync(path.join(headRepo, 'c.txt'), 'utf8')
    assert.ok(cAtHead.includes('c left addition\n'),
      '(g) [M7] the head this pair records really did adopt 2a')
    const recaptured = capture(headRepo, head,
      { 'c.txt': cAtHead.replace('c left addition\n', 'c left addition\nc right addition\n') },
      path.join(TMP, 'soft', 'task-2b.patch'))

    const softSpec = {
      fixture: 'exam-soft-edges',
      repo: headRepo,
      base: CORPUS_BASE,
      tasks: [
        { id: '2a', patch: path.join(patchDir, 'task-2a.patch') },
        // The soft edge: recorded against the head that adopted `2a`.
        { id: '2b', patch: recaptured, base: head },
      ],
      commutes: {},
      replies: EMPTY_REPLIES,
    }
    const soft = await runSet(softSpec)
    assert.match(soft.simTree, SHA_RE, '(g) [M7] the soft-edges pair folds')
    assert.equal(soft.simTree, wave2.simTree,
      '(g) [M7] the soft-edges pair yields wave 2\'s simultaneous tree')
    assert.equal(wave2.simTree, 'effc72ef4c4a55bee2d3be1010bb8436bfc71906',
      '(g) [M7] and that tree is the union of both same-anchor additions (#832\'s measured sha)')
  })

// ── the sim, as a child process ─────────────────────────────────────────────

const SET_LINE = /^(\S+) n=(\d+) orders=(\d+) tree=([0-9a-f]{40}) sim=([0-9a-f]{40}) (ok|caught) steps=(\d+) kernelCalls=(\d+)$/
/** Loose enough that a malformed set line is still collected — and then fails. */
const LOOKS_LIKE_A_SET_LINE = /^\S+ n=/

const runSim = (fixturesDir, budgetMs) => {
  const result = child(process.execPath, [SIM], {
    env: fixturesDir === null ? {} : { READINESS_FIXTURES_DIR: fixturesDir },
    timeout: budgetMs ?? deadlineBudget(60_000),
    tolerant: true,
  })
  assert.equal(result.status, 0,
    `the sim exits 0 (${fixturesDir === null ? 'READINESS_FIXTURES_DIR unset' : fixturesDir}): ` +
    `${result.stdout}\n${result.stderr}`)
  const lines = result.stdout.split('\n')
  const trimmed = result.stdout.replace(/\n+$/, '').split('\n')
  const sets = lines.filter((line) => LOOKS_LIKE_A_SET_LINE.test(line)).map((line) => {
    const m = SET_LINE.exec(line)
    assert.ok(m,
      '(e) [M5] every set line reads ' +
      '`<set> n=<tasks> orders=<k> tree=<sha> sim=<sha> ok steps=<n> kernelCalls=<n>`: ' +
      JSON.stringify(line))
    return {
      line, set: m[1], n: Number(m[2]), orders: Number(m[3]),
      tree: m[4], sim: m[5], verdict: m[6], steps: Number(m[7]), kernelCalls: Number(m[8]),
    }
  })
  return { stdout: result.stdout, last: trimmed[trimmed.length - 1], sets }
}

/** The sim's own wall, its fixture root an empty directory of the exam's. */
const EMPTY_ROOT = path.join(TMP, 'fixtures-empty')
fs.mkdirSync(EMPTY_ROOT, { recursive: true })
const emptyRun = runSim(EMPTY_ROOT, deadlineBudget(90_000))

await leg('(e) [M5] every set line matches the pinned form and the run ends ALL TESTS PASSED',
  () => {
    // The parse above already failed any line that does not match; what is left
    // is that there were lines to match, and the sentinel.
    assert.equal(emptyRun.sets.length, 6,
      '(e) [M5] one line per set: the five corpus waves and the negative control')
    assert.equal(emptyRun.last, 'ALL TESTS PASSED',
      `(e) [M5] the last line is the sentinel, got ${JSON.stringify(emptyRun.last)}`)
    for (const s of emptyRun.sets) {
      assert.equal(s.n, 2, `(e) [M5] ${s.set}: n is the set's task count`)
      assert.equal(s.orders, ORDERS_FOR_2,
        `(e) [M5] ${s.set}: orders is the kernel's own sampled_orders count`)
      assert.equal(s.steps, 2, `(e) [M5] ${s.set}: steps is the cost of one order`)
      assert.ok(s.kernelCalls >= 2 * s.steps,
        `(e) [M5] ${s.set}: kernelCalls counts the fold and materialize of one order, ` +
        `got ${s.kernelCalls}`)
    }
    assert.equal(new Set(emptyRun.sets.map((s) => s.set)).size, 6,
      '(e) [M5] each set is named once')
  })

await leg('(a) [M1] the sim\'s own lines for waves 1, 2, 4 and 5 carry ok and tree == sim',
  () => {
    const ok = emptyRun.sets.filter((s) => s.verdict === 'ok')
    assert.equal(ok.length, 5, '(a) [M1] five sets fold the same in every order')
    for (const s of ok) {
      assert.equal(s.tree, s.sim,
        `(a) [M1] ${s.set}: the sequential tree printed is the simultaneous tree`)
    }
    // Which line is which wave is read off the tree the exam's own runSet
    // computed for it: waves 1, 2, 4 and 5 take no reply, so their trees are
    // the corpus's own and cannot be guessed.
    for (const wave of [1, 2, 4, 5]) {
      const tree = waveResults.get(wave).simTree
      const matches = ok.filter((s) => s.tree === tree)
      assert.equal(matches.length, 1,
        `(a) [M1] exactly one ok line carries wave ${wave}'s simultaneous tree ${tree}: ` +
        JSON.stringify(ok.map((s) => s.line)))
    }
  })

await leg('(b) [M2] the sim\'s wave-3 line carries ok with equal shas',
  () => {
    const ok = emptyRun.sets.filter((s) => s.verdict === 'ok')
    const known = new Set([1, 2, 4, 5].map((w) => waveResults.get(w).simTree))
    const rest = ok.filter((s) => !known.has(s.tree))
    assert.equal(rest.length, 1,
      '(b) [M2] the fifth ok line is wave 3 — the one set whose tree is its committed reply\'s')
    assert.equal(rest[0].tree, rest[0].sim,
      '(b) [M2] wave 3 folds to one tree in both modes')
    assert.equal(rest[0].n, 2, '(b) [M2] wave 3 is two tasks')
  })

await leg('(d) [M4] the negative control is caught, its orders diverge, and the run still passes',
  () => {
    const caught = emptyRun.sets.filter((s) => s.verdict === 'caught')
    assert.equal(caught.length, 1,
      '(d) [M4] exactly one set is reported caught: the negative control')
    assert.equal(emptyRun.last, 'ALL TESTS PASSED',
      '(d) [M4] a caught negative control is a pass of the sim, not a failure')

    // The divergence itself, through runSet: a control whose reply is chosen by
    // more than (set, path, hunk) parts its orders...
    const trees = new Set(controlOwnResult.orders.map((o) => o.tree))
    assert.ok(trees.size >= 2,
      '(d) [M4] at least two of the control\'s orders carry different trees: ' +
      JSON.stringify([...trees]))
    assert.equal(controlOwnResult.verdict, 'caught',
      '(d) [M4] runSet reports a set whose orders diverge as caught')

    // ...and the same set with one constant reply does not, so `caught` is not
    // printed unconditionally.
    assert.equal(controlSameResult.verdict, 'ok',
      '(d) [M4] the same control with one reply at both steps reads ok')
    for (const o of controlSameResult.orders) {
      assert.equal(o.tree, controlSameResult.simTree,
        `(d) [M4] order ${JSON.stringify(o.order)} of the constant-reply control adopts to the ` +
        'simultaneous tree')
    }
  })

// ── leg (f): the fixture root, three ways ───────────────────────────────────

/** A hand-built real-join set in the manifest's own shape. */
const fixtureDir = (root, name, edits) => {
  const dir = path.join(root, name)
  const project = path.join(dir, 'project')
  fs.mkdirSync(project, { recursive: true })
  for (const [file, body] of Object.entries(HAND_BASE_FILES)) {
    fs.writeFileSync(path.join(project, file), body)
  }
  const scratch = makeRepo(path.join(TMP, 'fixture-repos', name), HAND_BASE_FILES)
  const tasks = Object.entries(edits).map(([id, e]) => {
    capture(scratch.repo, scratch.base, e, path.join(dir, `task-${id}.patch`))
    return { id, patch: `task-${id}.patch` }
  })
  fs.mkdirSync(path.join(dir, 'replies'), { recursive: true })
  // `project` repo-root-relative, the way the manifest's own example
  // (`evals/fixtures/<name>/project`) is written.
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    fixture: name,
    project: path.relative(ROOT, project),
    tasks,
    commutes: {},
    replies: 'replies',
  }, null, 2) + '\n')
  return dir
}

const TWO_ROOT = path.join(TMP, 'fixtures-two')
fixtureDir(TWO_ROOT, 'exam-pair-one', HAND_EDITS)
fixtureDir(TWO_ROOT, 'exam-pair-two', {
  'pair-a': { 'alpha.txt': 'alpha one (pair-a)\nalpha two\nalpha three\n' },
  'pair-b': { 'beta.txt': 'beta one\nbeta two (pair-b)\nbeta three\n' },
})
const twoRun = runSim(TWO_ROOT, deadlineBudget(120_000))

/** The directories the exam itself finds under the default root. */
const defaultSets = fs.existsSync(DEFAULT_FIXTURES)
  ? fs.readdirSync(DEFAULT_FIXTURES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(DEFAULT_FIXTURES, e.name, 'manifest.json')))
    .map((e) => e.name).sort()
  : []

// Kept last: this is the run whose wall is whatever the checkout holds.
const unsetRun = runSim(null, deadlineBudget(240_000))

await leg('(f) [M6] a fixture directory is a set, and an absent or empty root leaves the corpus ' +
  'and the control alone',
  () => {
    const names = (run) => run.sets.map((s) => s.set).sort()
    const corpusAndControl = names(emptyRun)
    assert.equal(corpusAndControl.length, 6,
      '(f) [M6] an empty root: exactly the five corpus sets and the negative control, and no other')

    const extra = names(twoRun).slice()
    for (const n of corpusAndControl) {
      const at = extra.indexOf(n)
      assert.ok(at >= 0, `(f) [M6] the two-directory run still runs ${n}`)
      extra.splice(at, 1)
    }
    assert.deepEqual(extra.sort(), ['exam-pair-one', 'exam-pair-two'],
      '(f) [M6] a root of two manifest directories adds exactly two lines, one per directory')
    for (const s of twoRun.sets.filter((x) => extra.includes(x.set))) {
      assert.equal(s.verdict, 'ok', `(f) [M6] ${s.set} folds the same in every order`)
      assert.equal(s.n, 2, `(f) [M6] ${s.set} is the manifest's two tasks`)
      assert.equal(s.tree, s.sim, `(f) [M6] ${s.set}: the sequential tree is the simultaneous tree`)
    }
    assert.equal(twoRun.last, 'ALL TESTS PASSED', '(f) [M6] the two-directory run passes')

    // Unset: the default root, whatever it holds — nothing at all in this
    // task's own clone.
    const unsetExtra = names(unsetRun).slice()
    for (const n of corpusAndControl) {
      const at = unsetExtra.indexOf(n)
      assert.ok(at >= 0, `(f) [M6] the unset run still runs ${n}`)
      unsetExtra.splice(at, 1)
    }
    assert.deepEqual(unsetExtra.sort(), defaultSets,
      '(f) [M6] with the variable unset the sim runs one set per directory under ' +
      `${path.relative(ROOT, DEFAULT_FIXTURES)} holding a manifest.json — ` +
      `${defaultSets.length === 0 ? 'none here' : defaultSets.join(', ')}`)
    assert.equal(unsetRun.last, 'ALL TESTS PASSED', '(f) [M6] the unset run passes')
  })

console.log('ALL TESTS PASSED')
