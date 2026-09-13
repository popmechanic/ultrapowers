/**
 * fleet/tests/test_readiness_fixtures.mjs — the peer examiner's exam for the
 * real-join fixture patches (#832; #810 Phase C; #360 — the kernel is read and
 * driven, never patched).
 *
 * The claim under exam: the three real-join fixtures that carry a reference
 * tree — `contend`, `contend-wide` and `degrade` — each get their per-task
 * patches, produced once by a scripted split of the reference against the
 * project by each task's declared symbol, committed under
 * `fleet/tests/fixtures/readiness/<fixture>/`, the one root the fold-order sim
 * reads, and graded by the kernel's own fold.
 *
 * Every assertion below names the Proof leg it belongs to and the Machine
 * clause that leg comes from, so this file can be read back against the
 * contract:
 *
 *   (a) / M1  the census: the exam parses `evals/fixtures/<fixture>/plan.md`
 *             itself, counts the `### Task` headings whose Files block carries
 *             a `Modify:` or `Create:` bullet, asserts those counts are 4, 8
 *             and 2, asserts the manifest's task ids are exactly that computed
 *             list, asserts the files beside the manifest are exactly
 *             `task-<id>.patch` for those ids, and `git apply --check` of each
 *             patch ALONE against a fresh scratch commit of `project/` exits 0.
 *   (b) / M2  the kernel's simultaneous fold of all a fixture's patches with
 *             the manifest's `commutes`, then `materialize --prev-head <BASE>`:
 *             every kernel call exits 0, materialize prints a `candidateSha`
 *             (a `{"fallback": …}` is a failed leg, never a retry), and for
 *             every path under `reference/` the candidate's blob bytes equal
 *             the reference file's bytes. Plus the negative row: the same fold
 *             with one patch left out does NOT reproduce `reference/`, so the
 *             comparison is known non-vacuous.
 *   (c) / M3  `python3 evals/frontier/split_fixture.py <fixture> <out-dir>`
 *             exits 0 and writes a `manifest.json` and a `task-<id>.patch` set
 *             whose sha256 equal the committed ones, file for file; and the
 *             module's Produces line — `split_fixture(fixture, out_dir)` — is
 *             importable under that signature.
 *   (d) / M4  each `manifest.json` parses, has exactly the five keys
 *             `fixture`, `project`, `tasks`, `commutes`, `replies`, `fixture`
 *             is the directory's own name, `tasks[i].id` ascend in task order,
 *             every `tasks[i].patch` is `task-<id>.patch` and exists beside
 *             the manifest, `replies` is the literal `replies`, and `project`
 *             is `evals/fixtures/<fixture>/project`.
 *   (e) / M5  `fleet/tests/fixtures/readiness/` holds exactly `contend`,
 *             `contend-wide` and `degrade` and nothing else, and every
 *             `manifest.json` under that root sits at depth one.
 *   (f) / M6  neither `contend-big` nor `bun-greenfield` has a directory under
 *             that root, and the split script exits non-zero on a fixture with
 *             no `reference/` tree, names it on stderr, and writes nothing
 *             into the out-dir it was handed.
 *   (g) / M7  the fold-order sim's reading of the three sets: the sim's own
 *             `discoverFixtureSets` finds exactly these three directories, the
 *             kernel's own `sampled_orders(n)` gives each set the order count
 *             its line will print, and each set, folded by the sim's own
 *             `runSet`, reads `ok` — every order's tree equal to the
 *             simultaneous fold's, every order's narrated `(path, kind)` pairs
 *             equal to the simultaneous fold's — with `setLine` producing the
 *             pinned `<set> n=<tasks> orders=<k> tree=<sha> sim=<sha> ok
 *             steps=<n> kernelCalls=<n>` form for that set.
 *
 * Leg (g) as the Proof spells it is the sim's OWN stdout over its full order
 * sample, and that run is the Proof's second `Run:` line rather than a child of
 * this file: the suite bridge caps one `test_*.mjs` at 300 s
 * (`tests/test_fleet_suite.py`), the full sample is 24 orders of 4 steps, 20 of
 * 8 and 2 of 2 on top of the sim's corpus, and an exam that spawned it would
 * spend the whole cap twice over. What this file measures instead is the same
 * quantity on a SUBSET of the very orders the sim will run — the first two
 * `sampled_orders(n)` returns, never an order of the exam's own invention — so
 * a set this exam calls `ok` cannot be a set whose orders the sim never tried,
 * and a divergence this exam catches is a divergence the sim catches too.
 *
 * Conventions copied from the rig: no process is spawned from this file at all
 * — every child goes through `_readiness_helpers.mjs`, whose `sh` binds a
 * `simEnv`-derived environment and a fixed git identity and clock — temp dirs
 * under `os.tmpdir()`, one `ok — …` line per leg and the `ALL TESTS PASSED`
 * sentinel last.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  FIXTURES_ROOT,
  FOLD_WAVE,
  FRONTIER_DIR,
  REPO_ROOT,
  discoverFixtureSets,
  fixtureSetSpec,
  git,
  hunkIdsOf,
  mkTemp,
  replyFileFor,
  runSet,
  sampledOrders,
  setLine,
  sh,
  sha256OfFile,
} from './_readiness_helpers.mjs'

const note = (message) => process.stderr.write(message + '\n')
const ok = (message) => process.stdout.write('ok — ' + message + '\n')

/**
 * The three real-join sets, with the task count M1 pins for each. The counts
 * are asserted against the plan the exam parses, never read from it: 4, 8 and 2
 * are the Machine clause's own numbers.
 */
const SETS = [
  { fixture: 'contend', tasks: 4 },
  { fixture: 'contend-wide', tasks: 8 },
  { fixture: 'degrade', tasks: 2 },
]

/** M6's two: a reference-less fixture and one whose set is not committed. */
const ABSENT = ['contend-big', 'bun-greenfield']
/** The fixture leg (f) hands the script: the one with no `reference/` tree. */
const NO_REFERENCE = 'bun-greenfield'

const EVALS_FIXTURES = path.join(REPO_ROOT, 'evals', 'fixtures')
const SPLIT_SCRIPT = path.join(FRONTIER_DIR, 'split_fixture.py')

/** The set-line form M7 pins, read back off `setLine`. */
const SET_LINE = /^(\S+) n=(\d+) orders=(\d+) tree=([0-9a-f]{40}) sim=([0-9a-f]{40}) (ok|caught) steps=(\d+) kernelCalls=(\d+)$/

const TMP = mkTemp('readiness-fixtures-exam-')
process.on('exit', () => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    // Left for the box's own tmp reaper; never a failed exam.
  }
})

const workDir = (...parts) => {
  const dir = path.join(TMP, ...parts)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const fixtureDir = (fixture) => path.join(FIXTURES_ROOT, fixture)
const sourceDir = (fixture) => path.join(EVALS_FIXTURES, fixture)

// ── the plan the census is taken from (leg a) ────────────────────────────────

/**
 * The task ids of `evals/fixtures/<fixture>/plan.md` whose Files block carries
 * a `Modify:` or `Create:` bullet — the tasks that own a patch. A
 * `**Files:** none` task (the gate at the end of every one of these plans)
 * carries no bullet and is not one of them.
 *
 * The block is the run of bullets directly under the `**Files:**` line and
 * ends at the first blank line, so the `- [ ] **Step …**` bullets further down
 * a task cannot be read as file bullets.
 */
function planTaskIds (fixture) {
  const plan = path.join(sourceDir(fixture), 'plan.md')
  assert.ok(fs.existsSync(plan), 'no plan at ' + plan)
  const ids = []
  let id = null
  let inFiles = false
  let owns = false
  const close = () => {
    if (id !== null && owns) ids.push(id)
  }
  for (const line of fs.readFileSync(plan, 'utf8').split('\n')) {
    const heading = /^###\s+Task\s+(\d+)\b/.exec(line)
    if (heading) {
      close()
      id = heading[1]
      inFiles = false
      owns = false
      continue
    }
    if (id === null) continue
    if (/^\*\*Files:\*\*/.test(line)) {
      // `**Files:** none` opens no block at all.
      inFiles = !/^\*\*Files:\*\*\s*none\s*$/.test(line.trim())
      continue
    }
    if (!inFiles) continue
    const bullet = /^-\s+([A-Za-z]+):/.exec(line)
    if (bullet) {
      if (bullet[1] === 'Modify' || bullet[1] === 'Create') owns = true
      continue
    }
    inFiles = false
  }
  close()
  return ids
}

// ── the scratch repo every fold and every `git apply --check` runs against ───

/**
 * `evals/fixtures/<fixture>/project` copied into a fresh repo and committed:
 * the BASE every `task-<id>.patch` is a diff against. Built exactly the way
 * the sim's `fixtureSetSpec` builds it, through the helpers' fixed identity and
 * clock, so the sha is the same on every box.
 */
function scratchProject (fixture, where) {
  const project = path.join(sourceDir(fixture), 'project')
  assert.ok(fs.existsSync(project), 'no project tree at ' + project)
  const repo = workDir(where, 'repo')
  fs.cpSync(project, repo, { recursive: true })
  fs.rmSync(path.join(repo, '.git'), { recursive: true, force: true })
  git(['init', '--quiet', '--initial-branch=main'], repo)
  git(['add', '-A'], repo)
  git(['commit', '--quiet', '-m', 'base'], repo)
  return { repo, base: git(['rev-parse', 'HEAD'], repo) }
}

/** Every path under `evals/fixtures/<fixture>/reference`, relative and sorted. */
function referencePaths (fixture) {
  const root = path.join(sourceDir(fixture), 'reference')
  assert.ok(fs.existsSync(root), 'no reference tree at ' + root)
  const out = []
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix ? prefix + '/' + entry.name : entry.name
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
      else out.push(rel)
    }
  }
  walk(root, '')
  assert.ok(out.length > 0, fixture + ': its reference tree is empty')
  return out.sort()
}

// ── the kernel, driven over its CLI (leg b) ──────────────────────────────────

/**
 * One simultaneous fold of `tasks` against `base`, answering every conflict the
 * kernel opens from the fixture's committed `replies/` root, then
 * `materialize --prev-head <base>`.
 *
 * Returns `{ candidate }` on the clean path. On any refusal — a non-zero
 * kernel exit, a fold that leaves nothing dispatchable, a hunk with no
 * committed reply, a `{"fallback": …}` from materialize — it returns
 * `{ candidate: null, why }` rather than throwing, because the negative row of
 * leg (b) folds a deliberately incomplete set and a refusal there is one more
 * way of not reproducing `reference/`. The positive row asserts `candidate`.
 */
function foldSimultaneously ({ repo, base, tasks, commutes, replies, where }) {
  const runDir = workDir(where, 'run')
  const scratch = workDir(where, 'scratch')
  const patchArgs = tasks.flatMap((t) => ['--patch', t.id + '=' + t.patch])
  const commuteArgs = Object.keys(commutes ?? {}).sort()
    .flatMap((id) => ['--commutes', id + '=' + commutes[id].join(',')])
  const common = ['--repo', repo, '--run-dir', runDir, '--wave', '1']

  const kernel = (argv) => {
    const r = sh('python3', [FOLD_WAVE, ...argv])
    const out = String(r.stdout || '').trim()
    let json = null
    try {
      json = out.startsWith('{') ? JSON.parse(out) : null
    } catch {
      json = null
    }
    return { status: r.status, json, text: out + String(r.stderr || '') }
  }

  let reply = kernel(['fold', ...common, '--base', base, ...patchArgs, ...commuteArgs])
  if (reply.status !== 0 || !reply.json) {
    return { candidate: null, why: 'fold exited ' + reply.status + ': ' + reply.text }
  }

  let pending = reply.json.open ?? []
  let guard = 0
  while (!reply.json.complete) {
    if (!pending.length) {
      return { candidate: null, why: 'the fold left nothing dispatchable: ' + JSON.stringify(reply.json) }
    }
    if (++guard > 64) return { candidate: null, why: 'the resolve loop did not converge' }
    const entry = pending.shift()
    const dir = fs.mkdtempSync(path.join(scratch, 'reply-'))
    for (const hunk of hunkIdsOf(entry.hunksFile)) {
      const file = replyFileFor(replies, entry.path, hunk)
      if (!fs.existsSync(file)) {
        return {
          candidate: null,
          why: 'no committed reply for (' + entry.path + ', ' + hunk + ') at ' + file,
        }
      }
      fs.writeFileSync(path.join(dir, hunk + '.txt'), fs.readFileSync(file))
    }
    reply = kernel(['resolve', ...common, '--conflict', String(entry.i), '--reply-dir', dir,
      ...patchArgs, ...commuteArgs])
    if (reply.status !== 0 || !reply.json) {
      return { candidate: null, why: 'resolve exited ' + reply.status + ': ' + reply.text }
    }
    if (reply.json.applied !== true) {
      return { candidate: null, why: 'resolve refused: ' + JSON.stringify(reply.json) }
    }
    if (Array.isArray(reply.json.waiting)) continue   // same stop, more hunks to answer
    pending = reply.json.open ?? []
  }

  // No `--commutes` on materialize: it reads the wave the fold recorded.
  const out = kernel(['materialize', ...common, '--prev-head', base, ...patchArgs])
  if (out.status !== 0 || !out.json || !out.json.candidateSha) {
    return { candidate: null, why: 'materialize exited ' + out.status + ': ' + out.text }
  }
  return { candidate: String(out.json.candidateSha), why: null }
}

/**
 * The paths under `reference/` whose bytes the candidate does NOT carry — the
 * empty list is M2's claim, and the negative row's is not empty.
 */
function referenceMismatches (fixture, repo, candidate) {
  const root = path.join(sourceDir(fixture), 'reference')
  const bad = []
  for (const rel of referencePaths(fixture)) {
    const shown = sh('git', ['-C', repo, 'show', candidate + ':' + rel], { buffer: true })
    if (shown.status !== 0) {
      bad.push(rel + ' (absent from the candidate)')
      continue
    }
    const want = fs.readFileSync(path.join(root, rel))
    if (!Buffer.from(shown.stdout).equals(want)) bad.push(rel)
  }
  return bad
}

// ── the legs ─────────────────────────────────────────────────────────────────

/** The manifest of one fixture, parsed once and shared by several legs. */
function manifestOf (fixture) {
  const file = path.join(fixtureDir(fixture), 'manifest.json')
  assert.ok(fs.existsSync(file),
    '[leg a / M1] ' + fixture + ': no manifest at ' + file
    + ' — the fixture set is not committed under ' + FIXTURES_ROOT)
  const text = fs.readFileSync(file, 'utf8')
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    assert.fail('[leg d / M4] ' + fixture + ': its manifest.json does not parse: ' + String(error))
  }
  return parsed
}

/** Leg (a) / M1 — the census, and each patch applied alone. */
function legCensus () {
  for (const { fixture, tasks } of SETS) {
    const ids = planTaskIds(fixture)

    assert.equal(ids.length, tasks,
      '[leg a / M1] ' + fixture + ': its plan has ' + ids.length
      + ' task(s) with a Modify:/Create: bullet, M1 pins ' + tasks + ' (' + ids.join(',') + ')')

    const manifest = manifestOf(fixture)
    assert.deepEqual((manifest.tasks || []).map((t) => String(t.id)), ids,
      '[leg a / M1] ' + fixture + ': the manifest lists tasks '
      + JSON.stringify((manifest.tasks || []).map((t) => String(t.id)))
      + ', the plan ' + JSON.stringify(ids))

    // Exactly the manifest and one patch per owning task beside it. `replies/`
    // is the one directory M4 names; nothing else of either kind belongs here.
    const dir = fixtureDir(fixture)
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files = entries.filter((e) => e.isFile()).map((e) => e.name).sort()
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
    assert.deepEqual(files, ['manifest.json', ...ids.map((id) => 'task-' + id + '.patch')].sort(),
      '[leg a / M1] ' + fixture + ': the files beside the manifest are ' + JSON.stringify(files))
    for (const name of dirs) {
      assert.equal(name, 'replies',
        '[leg a / M1] ' + fixture + ': ' + name + '/ is not a directory this fixture holds')
    }

    // Each patch ALONE against a fresh scratch commit of `project/`: the leg
    // run-117 lost the task on, and the one the kernel is not asked to do.
    const { repo } = scratchProject(fixture, path.join('apply', fixture))
    for (const id of ids) {
      const patch = path.join(dir, 'task-' + id + '.patch')
      const r = sh('git', ['-C', repo, 'apply', '--check', patch])
      assert.equal(r.status, 0,
        '[leg a / M1] ' + fixture + ' task ' + id + ': git apply --check exited '
        + r.status + ': ' + String(r.stderr || ''))
    }
    ok('(a) M1 ' + fixture + ': ' + ids.length + ' task(s) ' + ids.join(',')
      + ', each patch applies alone to a scratch commit of project/')
  }
}

/** Leg (b) / M2 — the kernel's fold reproduces `reference/`, and the negative row. */
function legFold () {
  for (const { fixture } of SETS) {
    const dir = fixtureDir(fixture)
    const manifest = manifestOf(fixture)
    const replies = path.resolve(dir, String(manifest.replies || 'replies'))
    const tasks = (manifest.tasks || []).map((t) => ({
      id: String(t.id),
      patch: path.resolve(dir, String(t.patch)),
    }))
    const commutes = manifest.commutes || {}
    assert.ok(tasks.length >= 2, '[leg b / M2] ' + fixture + ': fewer than two patches to fold')

    const whole = scratchProject(fixture, path.join('fold', fixture))
    const folded = foldSimultaneously({
      repo: whole.repo, base: whole.base, tasks, commutes, replies,
      where: path.join('fold', fixture),
    })
    assert.ok(folded.candidate,
      '[leg b / M2] ' + fixture + ': the simultaneous fold of all ' + tasks.length
      + ' patches did not materialize a candidate — ' + folded.why)

    const bad = referenceMismatches(fixture, whole.repo, folded.candidate)
    assert.deepEqual(bad, [],
      '[leg b / M2] ' + fixture + ': the candidate ' + folded.candidate
      + ' differs from reference/ at ' + JSON.stringify(bad))

    // The negative row: one patch left out must NOT reproduce `reference/`, so
    // the comparison above is known to be reading something.
    const dropped = tasks[tasks.length - 1]
    const short = scratchProject(fixture, path.join('fold-short', fixture))
    const partial = foldSimultaneously({
      repo: short.repo,
      base: short.base,
      tasks: tasks.slice(0, -1),
      commutes: Object.fromEntries(Object.entries(commutes).filter(([id]) => id !== dropped.id)),
      replies,
      where: path.join('fold-short', fixture),
    })
    const shortBad = partial.candidate
      ? referenceMismatches(fixture, short.repo, partial.candidate)
      : ['(no candidate: ' + partial.why + ')']
    assert.ok(shortBad.length > 0,
      '[leg b / M2] ' + fixture + ': the fold WITHOUT task ' + dropped.id
      + ' still reproduced reference/ byte for byte — the comparison is vacuous')

    ok('(b) M2 ' + fixture + ': candidate ' + folded.candidate.slice(0, 12) + ' equals reference/ at '
      + referencePaths(fixture).length + ' path(s); without task ' + dropped.id
      + ' it differs at ' + shortBad.length)
  }
}

/** Leg (c) / M3 — the script regenerates what is committed, byte for byte. */
function legRegenerate () {
  assert.ok(fs.existsSync(SPLIT_SCRIPT), '[leg c / M3] no split script at ' + SPLIT_SCRIPT)

  // The Produces line: `split_fixture(fixture: str, out_dir: Path) -> list[Path]`.
  const signature = sh('python3', ['-c', [
    'import inspect, json, sys',
    'sys.path.insert(0, sys.argv[1])',
    'import split_fixture as m',
    'print(json.dumps([p for p in inspect.signature(m.split_fixture).parameters]))',
  ].join('\n'), FRONTIER_DIR])
  assert.equal(signature.status, 0,
    '[leg c / M3] split_fixture.split_fixture is not importable: ' + String(signature.stderr || ''))
  assert.deepEqual(JSON.parse(String(signature.stdout)), ['fixture', 'out_dir'],
    '[leg c / M3] the Produces line is split_fixture(fixture, out_dir); the module has '
    + String(signature.stdout).trim())

  for (const { fixture } of SETS) {
    const out = workDir('regenerate', fixture)
    const r = sh('python3', [SPLIT_SCRIPT, fixture, out])
    assert.equal(r.status, 0,
      '[leg c / M3] ' + fixture + ': the split script exited ' + r.status + ': '
      + String(r.stderr || ''))

    const dir = fixtureDir(fixture)
    const committed = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && (e.name === 'manifest.json' || /^task-\d+\.patch$/.test(e.name)))
      .map((e) => e.name).sort()
    const made = fs.readdirSync(out, { withFileTypes: true })
      .filter((e) => e.isFile() && (e.name === 'manifest.json' || /^task-\d+\.patch$/.test(e.name)))
      .map((e) => e.name).sort()
    assert.deepEqual(made, committed,
      '[leg c / M3] ' + fixture + ': the script wrote ' + JSON.stringify(made)
      + ', the committed set is ' + JSON.stringify(committed))
    for (const name of committed) {
      assert.equal(sha256OfFile(path.join(out, name)), sha256OfFile(path.join(dir, name)),
        '[leg c / M3] ' + fixture + '/' + name + ': the regenerated file differs from the committed one')
    }
    ok('(c) M3 ' + fixture + ': ' + committed.length + ' file(s) regenerated byte-identical')
  }
}

/** Leg (d) / M4 — the manifest's exact shape. */
function legManifest () {
  const KEYS = ['commutes', 'fixture', 'project', 'replies', 'tasks']
  for (const { fixture } of SETS) {
    const dir = fixtureDir(fixture)
    const manifest = manifestOf(fixture)

    assert.deepEqual(Object.keys(manifest).sort(), KEYS,
      '[leg d / M4] ' + fixture + ': its manifest keys are '
      + JSON.stringify(Object.keys(manifest).sort()) + ', M4 pins ' + JSON.stringify(KEYS))
    assert.equal(manifest.fixture, path.basename(dir),
      '[leg d / M4] ' + fixture + ': `fixture` is ' + JSON.stringify(manifest.fixture)
      + ', its directory is ' + path.basename(dir))
    assert.equal(manifest.project, ['evals', 'fixtures', fixture, 'project'].join('/'),
      '[leg d / M4] ' + fixture + ': `project` is ' + JSON.stringify(manifest.project))
    assert.equal(manifest.replies, 'replies',
      '[leg d / M4] ' + fixture + ': `replies` is ' + JSON.stringify(manifest.replies))

    assert.ok(Array.isArray(manifest.tasks), '[leg d / M4] ' + fixture + ': `tasks` is not a list')
    const ids = manifest.tasks.map((t) => String(t.id))
    assert.deepEqual(ids, [...ids].sort((a, b) => Number(a) - Number(b)),
      '[leg d / M4] ' + fixture + ': its task ids are not in ascending task order: ' + JSON.stringify(ids))
    for (const task of manifest.tasks) {
      assert.deepEqual(Object.keys(task).sort(), ['id', 'patch'],
        '[leg d / M4] ' + fixture + ': a task entry carries ' + JSON.stringify(Object.keys(task).sort()))
      assert.equal(task.patch, 'task-' + String(task.id) + '.patch',
        '[leg d / M4] ' + fixture + ' task ' + task.id + ': `patch` is ' + JSON.stringify(task.patch))
      assert.ok(fs.existsSync(path.join(dir, String(task.patch))),
        '[leg d / M4] ' + fixture + ': ' + task.patch + ' is not beside the manifest')
    }

    assert.ok(manifest.commutes && typeof manifest.commutes === 'object' && !Array.isArray(manifest.commutes),
      '[leg d / M4] ' + fixture + ': `commutes` is not a map')
    for (const [id, paths] of Object.entries(manifest.commutes)) {
      assert.ok(ids.includes(String(id)),
        '[leg d / M4] ' + fixture + ': `commutes` names task ' + id + ', which is not in `tasks`')
      assert.ok(Array.isArray(paths) && paths.every((p) => typeof p === 'string' && p.length > 0),
        '[leg d / M4] ' + fixture + ': commutes[' + id + '] is not a list of paths')
    }
    ok('(d) M4 ' + fixture + ': the manifest carries exactly ' + KEYS.join(', ')
      + ' over tasks ' + ids.join(','))
  }
}

/** Leg (e) / M5 — the one root, and nothing else under it. */
function legRoot () {
  assert.ok(fs.existsSync(FIXTURES_ROOT), '[leg e / M5] no fixture root at ' + FIXTURES_ROOT)
  const entries = fs.readdirSync(FIXTURES_ROOT, { withFileTypes: true })
  assert.deepEqual(entries.map((e) => e.name).sort(), SETS.map((s) => s.fixture).slice().sort(),
    '[leg e / M5] ' + FIXTURES_ROOT + ' holds ' + JSON.stringify(entries.map((e) => e.name).sort()))
  for (const entry of entries) {
    assert.ok(entry.isDirectory(), '[leg e / M5] ' + entry.name + ' is not a directory')
  }

  // Every manifest under the root sits at depth one: `<root>/<set>/manifest.json`.
  const found = []
  const walk = (dir, depth) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(at, depth + 1)
      else if (entry.name === 'manifest.json') found.push({ at, depth })
    }
  }
  walk(FIXTURES_ROOT, 0)
  assert.deepEqual(found.map((f) => path.relative(FIXTURES_ROOT, f.at)).sort(),
    SETS.map((s) => path.join(s.fixture, 'manifest.json')).sort(),
    '[leg e / M5] the manifests under the root are '
    + JSON.stringify(found.map((f) => path.relative(FIXTURES_ROOT, f.at)).sort()))
  for (const f of found) {
    assert.equal(f.depth, 1,
      '[leg e / M5] ' + f.at + ' sits ' + f.depth
      + ' director(y|ies) under the root, not the one M5 pins')
  }

  // The sim's own discovery is the census it prints, so it is asserted here too.
  assert.deepEqual(discoverFixtureSets(FIXTURES_ROOT).map((d) => path.basename(d)),
    SETS.map((s) => s.fixture).slice().sort(),
    '[leg e / M5] the sim discovers '
    + JSON.stringify(discoverFixtureSets(FIXTURES_ROOT).map((d) => path.basename(d))))
  ok('(e) M5 ' + FIXTURES_ROOT + ' holds exactly ' + SETS.map((s) => s.fixture).join(', '))
}

/** Leg (f) / M6 — the two that are not here, and the script's refusal. */
function legAbsent () {
  for (const name of ABSENT) {
    assert.ok(!fs.existsSync(path.join(FIXTURES_ROOT, name)),
      '[leg f / M6] ' + name + ' has a directory under ' + FIXTURES_ROOT)
  }

  // The fixture the refusal is about really is one with no reference tree, so
  // the leg is about the script's answer and not about a missing directory.
  assert.ok(fs.existsSync(sourceDir(NO_REFERENCE)),
    '[leg f / M6] no fixture at ' + sourceDir(NO_REFERENCE))
  assert.ok(!fs.existsSync(path.join(sourceDir(NO_REFERENCE), 'reference')),
    '[leg f / M6] ' + NO_REFERENCE + ' now has a reference/ tree; M6 is about a fixture without one')

  const out = workDir('refusal')
  const r = sh('python3', [SPLIT_SCRIPT, NO_REFERENCE, out])
  assert.notEqual(r.status, 0,
    '[leg f / M6] the split script exited 0 on ' + NO_REFERENCE + ', which has no reference/ tree')
  assert.ok(String(r.stderr || '').includes(NO_REFERENCE),
    '[leg f / M6] the refusal does not name ' + NO_REFERENCE + ' on stderr: '
    + JSON.stringify(String(r.stderr || '')))
  assert.deepEqual(fs.readdirSync(out), [],
    '[leg f / M6] the refused run wrote ' + JSON.stringify(fs.readdirSync(out)) + ' into its out-dir')
  ok('(f) M6 no ' + ABSENT.join('/') + ' directory; the script refuses ' + NO_REFERENCE
    + ' (exit ' + r.status + ') and writes nothing')
}

/**
 * Leg (g) / M7 — the sim's reading of the three sets.
 *
 * The full-sample run is the Proof's second `Run:` line (see the header). Here
 * each set is folded over the FIRST TWO orders `sampled_orders(n)` returns —
 * orders the sim itself will run — and the set's line is built with the sim's
 * own `setLine`, so both the verdict and the printed form are read off the same
 * machinery the sim prints from.
 */
function legSim () {
  for (const { fixture, tasks } of SETS) {
    const dir = fixtureDir(fixture)
    const spec = fixtureSetSpec(dir, workDir('sim', fixture))
    assert.equal(spec.name, fixture,
      '[leg g / M7] the set built from ' + dir + ' is named ' + spec.name
      + ', so the sim would print a line starting ' + spec.name)
    assert.equal(spec.tasks.length, tasks,
      '[leg g / M7] ' + fixture + ': the sim would fold ' + spec.tasks.length + ' task(s), M1 pins ' + tasks)

    const full = sampledOrders(tasks)
    const result = runSet({ ...spec, orders: full.slice(0, 2) })

    assert.equal(result.verdict, 'ok',
      '[leg g / M7] ' + fixture + ': the fold reads ' + result.verdict + ' (sim ' + result.simTree
      + ', orders ' + result.orders.map((o) => o.ids.join('>') + '=' + o.tree).join(' ') + ')')
    for (const order of result.orders) {
      assert.equal(order.tree, result.simTree,
        '[leg g / M7] ' + fixture + ': order ' + order.ids.join('>') + ' folded to ' + order.tree
        + ', the simultaneous fold to ' + result.simTree)
      assert.deepEqual(order.conflictKeys, result.simConflictKeys,
        '[leg g / M7] ' + fixture + ': order ' + order.ids.join('>') + ' narrated '
        + JSON.stringify(order.conflictKeys) + ', the simultaneous fold '
        + JSON.stringify(result.simConflictKeys))
    }

    const line = setLine(result)
    const parsed = SET_LINE.exec(line)
    assert.ok(parsed, '[leg g / M7] ' + fixture + ': its set line does not match the pinned form: ' + line)
    assert.equal(parsed[1], fixture, '[leg g / M7] the line names ' + parsed[1] + ', not ' + fixture)
    assert.equal(parsed[2], String(tasks), '[leg g / M7] ' + fixture + ': the line reads n=' + parsed[2])
    assert.equal(parsed[4], parsed[5],
      '[leg g / M7] ' + fixture + ': the line reads tree=' + parsed[4] + ' sim=' + parsed[5])
    assert.equal(parsed[6], 'ok', '[leg g / M7] ' + fixture + ': the line reads ' + parsed[6])
    assert.equal(parsed[7], String(tasks),
      '[leg g / M7] ' + fixture + ': the line reads steps=' + parsed[7] + ' for ' + tasks + ' task(s)')
    ok('(g) M7 ' + fixture + ': ' + line + ' (over ' + result.orders.length + ' of the '
      + full.length + ' orders the sim samples; the full sample is the second Run line)')
  }
}

function main () {
  note('workspace ' + TMP)
  legCensus()
  legFold()
  legRegenerate()
  legManifest()
  legRoot()
  legAbsent()
  legSim()
  process.stdout.write('ALL TESTS PASSED\n')
}

try {
  main()
} catch (error) {
  note(String((error && error.stack) || error))
  process.exitCode = 1
}
