// fleet/tests/test_publish_fold.mjs — the exam for task 1, "The folder":
// `publishFold({ repo, base, branch, run, runDir, evidenceDir, attempt }, deps)`
// and the CLI `node fleet/publish-fold.mjs …` of `fleet/publish-fold.mjs`.
//
// The fixtures are REAL, all the way down. A bare `origin` (`git init --bare
// --initial-branch=main`); a first clone that seeds and pushes `main` and
// holds `refs/remotes/origin/HEAD` — that clone is the `--repo` target; a
// second clone made AFTER it, which moves `main` on the origin and pushes run
// 3's plan tag `ultra/plan/run-3`. The kernel
// (`skills/ultrapowers/kernel/fold_wave.py`) is driven for real, `python3` and
// all; `contendingBlock` reads run 3's plan off the tag through the real
// `compile_plan.py`; the suite is a `check.sh` the fixture commits at BASE, so
// green and red are a fixture choice and not a stub.
//
// TIP IS NEVER READ FROM THE TARGET CLONE BEFORE THE FOLDER RUNS. That clone
// was cut before `main` moved and nothing fetches into it until the folder
// does, so every fixture-sanity read of TIP comes from the bare origin
// (`git -C <origin> rev-parse refs/heads/main`); the target clone's
// `refs/remotes/origin/main` is read only AFTER the call, as the evidence that
// the folder fetched.
//
// TWO DISPATCH SURFACES, for the reason run-32's examiner found: the CLI has
// no injection seam for a stub resolver (it composes the real `claude` agent).
// So the three resolver-driven shapes (RESOLVED; BLOCKED; RESOLVED with an
// empty `hunks` list rejected twice) and the two-path shape are asserted
// IN-PROCESS, by calling `publishFold(opts, deps)` with a stub `makeAgent`
// exactly as `runMain`'s `makeAgent` seam is used, a recording `deps.exec`
// wrapped around `execSeam`, and a `deps.rename` spy; every model-free shape
// is swept through the real CLI with `execFileSync`, asserting exit 0 and the
// receipt's disposition.
//
// Reply-directory and brief names are keyed on the `i` the exam READS from the
// wave's `conflicts.json` — never on a literal. (The kernel's `_narrate`
// assigns `max(i, default 0) + 1`, so the first conflict is 1; run-32's exam
// asserted `reply-0-1` and could never have passed. The `i` is read here so
// the leg tests the folder, not the kernel's counter.)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { provisionRunTree, execSeam } from '../run-main.mjs'
import { publishFold } from '../publish-fold.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FOLDER_CLI = path.resolve(HERE, '../publish-fold.mjs')
const COMPILER = path.resolve(HERE, '../../skills/ultrapowers/scripts/compile_plan.py')

// ── the run under test ───────────────────────────────────────────────────────
const RUN = '7'
const BRANCH = 'ultra/integration-run-' + RUN
const H1 = 'The sandbox folds its branch onto main'
const PLAN_TEXT = [
  '# ' + H1,
  '',
  '**Acceptance:** suite — the committed suite is the verification.',
  '',
].join('\n')

// This run's `launch.json` tasks — the shape `ultra_run.py --emit-launch`
// writes and the shape `contendingBlock` reads.
const TASK_BODY = [
  '### Task F1: The folding task',
  '',
  '**Claim:** the run rewrites the second line of a.txt.',
  '',
  '- [ ] rewrite the second line',
].join('\n')
const TASK_A = { id: 'F1', title: 'The folding task', files: ['a.txt'], body: TASK_BODY }
const TASK_AC = { id: 'F1', title: 'The folding task', files: ['a.txt', 'c.txt'], body: TASK_BODY }

// Run 3's plan, as it lives on the tag: T1's Files name `a.txt` and nothing
// else, so `c.txt`'s block can carry no `- run 3` entry.
const PLAN_RUN3 = [
  '# Plan: run three',
  '',
  '**Acceptance:** suite — the committed suite is the verification.',
  '',
  '### Task T1: The first task of run three',
  '',
  '**Type:** implementation',
  '**Review:** lean',
  '',
  '**Files:**',
  '- Modify: `a.txt`',
  '',
  '**Claim:** the first task of run three rewrites the second line of a.txt.',
  '',
  '- [ ] rewrite the second line',
  '',
].join('\n')

// The one sentence M4/§3.3 pins, spelled here and nowhere else.
const SIDE_SENTENCE =
  'The frontier side of each hunk is main since this run\'s base; ' +
  'the incoming side is labeled run-' + RUN + ' in the hunks.'
const HEADING = '\nCONTENDING TASKS:'

// ── git, deterministic ───────────────────────────────────────────────────────
const ENV = {
  ...process.env,
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1',
}
const git = (argv, cwd) => {
  try {
    return execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    throw new Error('git ' + argv.join(' ') + ' in ' + cwd + ' failed: ' + String(e.stderr || e.message))
  }
}
const gitOk = (argv, cwd) => { try { git(argv, cwd); return true } catch { return false } }
const gitBytes = (argv, cwd) =>
  execFileSync('git', argv, { cwd, env: ENV, maxBuffer: 1 << 26 })

const TEN = Array.from({ length: 10 }, (_, i) => 'line' + (i + 1)).join('\n') + '\n'
/** The ten-line file with the named 1-based lines replaced. */
const lines = (over = {}, extra = []) => {
  const l = TEN.split('\n').slice(0, 10)
  for (const [n, v] of Object.entries(over)) l[Number(n) - 1] = v
  return l.concat(extra).join('\n') + '\n'
}
const write = (dir, name, text) => fs.writeFileSync(path.join(dir, name), text)
const PNG = (tail) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, ...tail])

// ── the template, built once and copied per case ─────────────────────────────
// `tests/test_fleet_suite.py` gives this file 120 s and same-wave sims share
// one machine, so the seeded origin and both clones are built once here and
// copied per case (each case still gets its own temp directory and its own
// origin — the copy's remotes are re-pointed at it).
function buildTemplate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-template-'))
  const origin = path.join(root, 'origin.git')
  git(['init', '--bare', '--initial-branch=main', origin], root)

  const target = path.join(root, 'target')
  git(['clone', '--quiet', origin, target], root)
  git(['config', 'user.email', 'seed@fleet.test'], target)
  git(['config', 'user.name', 'Seed'], target)
  write(target, 'a.txt', TEN)
  write(target, 'b.txt', 'bee\n')
  write(target, 'c.txt', TEN)
  write(target, 'd.txt', 'dee\n')
  write(target, 'tool.sh', '#!/bin/sh\necho tool\n')
  fs.writeFileSync(path.join(target, 'logo.png'), PNG([1, 2, 3]))
  write(target, 'check.sh', 'echo the suite is green\nexit 0\n')
  git(['add', '-A'], target)
  git(['commit', '--quiet', '-m', 'seed the fixture'], target)
  git(['push', '--quiet', 'origin', 'main'], target)
  // The default branch's name is read from `refs/remotes/origin/HEAD`; a clone
  // of an EMPTY repository never gets one, so the fixture sets it — the target
  // clone "holds refs/remotes/origin/HEAD" by construction.
  git(['remote', 'set-head', 'origin', 'main'], target)
  const base = git(['rev-parse', 'HEAD'], target)

  // The second clone, made after the target: it moves main and it pushes the
  // plan tag, so the tag postdates the target clone exactly as `record_tags`
  // pushes one after a merge.
  const maker = path.join(root, 'maker')
  git(['clone', '--quiet', origin, maker], root)
  git(['config', 'user.email', 'bot@fleet.test'], maker)
  git(['config', 'user.name', 'Fleet Bot'], maker)
  git(['checkout', '--quiet', '--orphan', 'plan-run-3'], maker)
  git(['rm', '-r', '--quiet', '--cached', '.'], maker)
  for (const f of ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'tool.sh', 'logo.png', 'check.sh']) {
    fs.rmSync(path.join(maker, f), { force: true })
  }
  fs.mkdirSync(path.join(maker, '.ultrapowers'), { recursive: true })
  write(path.join(maker, '.ultrapowers'), 'plan.md', PLAN_RUN3)
  git(['add', '-A'], maker)
  git(['commit', '--quiet', '-m', 'the plan of run 3'], maker)
  git(['tag', 'ultra/plan/run-3'], maker)
  git(['push', '--quiet', 'origin', 'refs/tags/ultra/plan/run-3'], maker)
  git(['checkout', '--quiet', '--force', 'main'], maker)

  assert.equal(git(['symbolic-ref', 'refs/remotes/origin/HEAD'], target), 'refs/remotes/origin/main',
    'fixture sanity: the target clone holds refs/remotes/origin/HEAD')
  return { root, origin, target, maker, base }
}
const TEMPLATE = buildTemplate()
const CASES = []
process.on('exit', () => {
  for (const dir of CASES) fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(TEMPLATE.root, { recursive: true, force: true })
})

// The oracle for run 3's compiled task record: the same compiler the block
// builder uses, run here on the same plan text, so the expected title/body/
// files are the plan's own and not this exam's paraphrase.
function compiledTask(planText, id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-plan-'))
  const planFile = path.join(dir, 'plan.md')
  const out = path.join(dir, 'launch.json')
  fs.writeFileSync(planFile, planText)
  execFileSync('python3', [COMPILER, planFile, '--emit-launch', out],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const payload = JSON.parse(fs.readFileSync(out, 'utf8'))
  fs.rmSync(dir, { recursive: true, force: true })
  const t = (payload.tasks || []).find((x) => x.id === id)
  assert.ok(t, 'fixture sanity: the compiler found task ' + id + ' in run 3\'s plan')
  return t
}
const T1 = compiledTask(PLAN_RUN3, 'T1')
const taskEntry = (run, t) =>
  '- run ' + run + ' task ' + t.id + ': ' + t.title +
  ' [files: ' + (t.files || []).join(', ') + ']\n' + t.body

// ── a case ───────────────────────────────────────────────────────────────────
/**
 * A whole fixture in its own temp directory:
 *   <root>/origin.git   the bare origin
 *   <root>/target       the target clone — `--repo`
 *   <root>/maker        the second clone, which moves main
 *   <root>/run          `--run-dir`      } distinct directories, always
 *   <root>/evidence/.ultrapowers/runs/7  `--evidence-dir`
 *   <root>/plan.md      the plan whose H1 titles the fold commit
 */
function newCase(tag, { mainMoves = () => {}, runEdits = null, testCmd = 'bash check.sh',
                        tasks = [TASK_A], branch = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-' + tag + '-'))
  CASES.push(root)
  fs.cpSync(TEMPLATE.root, root, { recursive: true })
  const origin = path.join(root, 'origin.git')
  const target = path.join(root, 'target')
  const maker = path.join(root, 'maker')
  const base = TEMPLATE.base
  git(['remote', 'set-url', 'origin', origin], target)
  git(['remote', 'set-url', 'origin', origin], maker)

  mainMoves({ root, origin, target, maker, base })

  let engineHead = base
  if (branch) {
    git(['checkout', '--quiet', '-b', BRANCH, base], target)
    if (runEdits) runEdits(target)
    git(['add', '-A'], target)
    git(['commit', '--quiet', '-m', 'the run builds its integration branch'], target)
    engineHead = git(['rev-parse', 'HEAD'], target)
    // Detached at BASE afterwards: nothing has the branch checked out, so the
    // folder's `update-ref` is the only thing that moves it.
    git(['checkout', '--quiet', '--detach', base], target)
  }

  const runDir = path.join(root, 'run')
  const evidenceDir = path.join(root, 'evidence', '.ultrapowers', 'runs', RUN)
  const planPath = path.join(root, 'plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
  fs.mkdirSync(runDir, { recursive: true })
  provisionRunTree({ repoDir: target, runDir, base, taskIds: [] })
  fs.writeFileSync(path.join(runDir, 'args.json'), JSON.stringify({
    ...(testCmd === null ? {} : { testCmd }), bootstrapCmd: '', planPath,
  }, null, 2))
  fs.writeFileSync(path.join(runDir, 'launch.json'), JSON.stringify({ tasks }, null, 2))

  const tip = git(['rev-parse', 'refs/heads/main'], origin)   // from the BARE ORIGIN
  return {
    root, origin, target, maker, base, engineHead, runDir, evidenceDir, planPath, tip,
    integ: path.join(runDir, 'clones', 'integration'),
    pf: path.join(evidenceDir, 'publish-fold'),
    kernelWaves: path.join(runDir, 'publish-fold', 'frontier'),
  }
}

const opts = (fx, attempt) => ({
  repo: fx.target, base: fx.base, branch: BRANCH, run: RUN,
  runDir: fx.runDir, evidenceDir: fx.evidenceDir, attempt,
})

// ── reading the receipts ─────────────────────────────────────────────────────
const receiptPath = (fx) => path.join(fx.pf, 'receipt.json')
const readReceipt = (fx) => JSON.parse(fs.readFileSync(receiptPath(fx), 'utf8'))
const att = (fx, n) => {
  const r = readReceipt(fx)
  assert.ok(r.attempts && r.attempts[String(n)],
    'the receipt records attempt ' + n + ': ' + JSON.stringify(r))
  return r.attempts[String(n)]
}
const branchSha = (fx) => git(['rev-parse', 'refs/heads/' + BRANCH], fx.target)
const events = (fx) => fs.readFileSync(path.join(fx.runDir, 'events.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))
const lastFoldEvent = (fx) => {
  const es = events(fx).filter((e) => e.kind === 'driver:publish-fold')
  assert.ok(es.length, 'a driver:publish-fold event was appended to events.jsonl')
  return es[es.length - 1]
}

// ── the seams the exam injects ───────────────────────────────────────────────
/**
 * `deps.exec`: `execSeam` with every call recorded. `onCall` fires BEFORE the
 * call runs, which is how the engine-head-before-the-fetch leg observes the
 * filesystem at the moment of the first fetch.
 */
function recorder({ inner = execSeam, onCall = null } = {}) {
  const calls = []
  const fn = async (cmd, argv, options = {}) => {
    const rec = { cmd, argv: (argv || []).map(String), cwd: options && options.cwd }
    calls.push(rec)
    if (onCall) onCall(rec)
    const r = await inner(cmd, argv, options)
    rec.code = r && r.code
    return r
  }
  fn.calls = calls
  return fn
}
// `git -C <dir> <verb> …` and `<verb> …` with cwd `<dir>` are the same call
// against the same repository; normalizing lets the argv assertions be about
// the verb, its flags and their order, which is what the clauses pin.
const norm = (c) => (c.cmd === 'git' && c.argv[0] === '-C')
  ? { cmd: c.cmd, argv: c.argv.slice(2), cwd: c.argv[1] }
  : { cmd: c.cmd, argv: c.argv, cwd: c.cwd }
const gitCalls = (rec) => rec.calls.filter((c) => c.cmd === 'git').map(norm)
const kernelCalls = (rec) => rec.calls
  .filter((c) => c.argv.some((a) => a.endsWith('fold_wave.py')))
  .map((c) => c.argv.slice(c.argv.findIndex((a) => a.endsWith('fold_wave.py')) + 1))
const kernelVerbs = (rec) => kernelCalls(rec).map((a) => a[0])

/** `deps.rename`: `fs.renameSync`, with the bytes it moved recorded. */
function renameSpy() {
  const calls = []
  const fn = (from, to) => {
    calls.push({ from: String(from), to: String(to), bytes: fs.readFileSync(from) })
    return fs.renameSync(from, to)
  }
  fn.calls = calls
  return fn
}

/**
 * `deps.makeAgent`: the stub the CLI has no seam for, injected exactly as
 * `runMain` injects `composeAgent`. `reply(nth, prompt)` is the resolver's
 * schema-shaped answer.
 */
function stubAgent(reply, { integ = null } = {}) {
  const sink = { composedWith: null, dispatches: [] }
  sink.makeAgent = (composeOpts) => {
    sink.composedWith = composeOpts
    return {
      agent: async (prompt, o = {}) => {
        const d = { prompt: String(prompt), label: o.label, schema: o.schema }
        if (integ) {
          // What the resolver's own cwd holds AT THE MOMENT OF DISPATCH.
          d.headTree = git(['rev-parse', 'HEAD^{tree}'], integ)
          d.aTxt = fs.readFileSync(path.join(integ, 'a.txt'), 'utf8')
        }
        sink.dispatches.push(d)
        return reply(sink.dispatches.length, d.prompt)
      },
      patchInput: composeOpts.patchesDir,
    }
  }
  return sink
}
const noAgent = () => ({
  makeAgent: () => ({
    agent: async () => { throw new Error('exam: no resolver may be dispatched on this shape') },
    patchInput: '',
  }),
}).makeAgent

/** The CLI of M1. Every named disposition exits 0. */
function cliRun(fx, attempt, leg) {
  const argv = [FOLDER_CLI, '--repo', fx.target, '--base', fx.base, '--branch', BRANCH,
    '--run', RUN, '--run-dir', fx.runDir, '--evidence-dir', fx.evidenceDir,
    '--attempt', String(attempt)]
  let code = 0, stdout = '', stderr = ''
  try {
    stdout = execFileSync('node', argv, { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : 1
    stdout = String(e.stdout || '')
    stderr = String(e.stderr || '')
  }
  assert.equal(code, 0, leg + ' [M1]: `node fleet/publish-fold.mjs … --attempt ' + attempt +
    '` exits 0 for every disposition it names — got ' + code + '\n' + stdout + stderr)
  return { code, stdout, stderr }
}

// ── the main-side moves the fixtures use ─────────────────────────────────────
const pushMain = (fx) => git(['push', '--quiet', 'origin', 'main'], fx.maker)
const MOVES = {
  // Disjoint: main edits b.txt, the run edits a.txt.
  editB: (fx) => {
    write(fx.maker, 'b.txt', 'bee from main\n')
    git(['add', '-A'], fx.maker)
    git(['commit', '--quiet', '-m', 'main edits b'], fx.maker)
    pushMain(fx)
  },
  // The same file, different lines.
  editALine1: (fx) => {
    write(fx.maker, 'a.txt', lines({ 1: 'line1 from main' }))
    git(['add', '-A'], fx.maker)
    git(['commit', '--quiet', '-m', 'main edits a\'s first line'], fx.maker)
    pushMain(fx)
  },
  // The conflicted fixture of Context: a trailered `Fleet-Run: 3` rewrite of
  // a.txt's line 2, then a HUMAN commit appending an eleventh line — a region
  // neither side fights over, so it folds and the commit still appears in
  // a.txt's own first-parent log.
  conflictA: (fx) => {
    write(fx.maker, 'a.txt', lines({ 2: 'line2 from main' }))
    git(['add', '-A'], fx.maker)
    git(['commit', '--quiet', '-m', 'run three rewrites the second line', '-m', 'Fleet-Run: 3'], fx.maker)
    write(fx.maker, 'a.txt', lines({ 2: 'line2 from main' }, ['line11 human']))
    git(['add', '-A'], fx.maker)
    git(['-c', 'user.name=A Human', 'commit', '--quiet', '-m', 'tidy the tail'], fx.maker)
    pushMain(fx)
  },
  // The same shape repeated on c.txt in the same commits.
  conflictAC: (fx) => {
    write(fx.maker, 'a.txt', lines({ 2: 'line2 from main' }))
    write(fx.maker, 'c.txt', lines({ 2: 'line2 from main' }))
    git(['add', '-A'], fx.maker)
    git(['commit', '--quiet', '-m', 'run three rewrites the second line', '-m', 'Fleet-Run: 3'], fx.maker)
    write(fx.maker, 'a.txt', lines({ 2: 'line2 from main' }, ['line11 human']))
    git(['add', '-A'], fx.maker)
    git(['-c', 'user.name=A Human', 'commit', '--quiet', '-m', 'tidy the tail'], fx.maker)
    pushMain(fx)
  },
  binary: (fx) => {
    fs.writeFileSync(path.join(fx.maker, 'logo.png'), PNG([9, 9, 9]))
    git(['add', '-A'], fx.maker)
    git(['commit', '--quiet', '-m', 'main replaces the logo'], fx.maker)
    pushMain(fx)
  },
  deleteD: (fx) => {
    fs.rmSync(path.join(fx.maker, 'd.txt'))
    git(['add', '-A'], fx.maker)
    git(['commit', '--quiet', '-m', 'main deletes d'], fx.maker)
    pushMain(fx)
  },
  chmodTool: (fx) => {
    git(['update-index', '--chmod=+x', 'tool.sh'], fx.maker)
    fs.chmodSync(path.join(fx.maker, 'tool.sh'), 0o755)
    git(['add', '-A'], fx.maker)
    git(['commit', '--quiet', '-m', 'main marks the tool executable'], fx.maker)
    pushMain(fx)
  },
}
const RUN_EDITS = {
  a2: (d) => write(d, 'a.txt', lines({ 2: 'line2 from run' })),
  a10: (d) => write(d, 'a.txt', lines({ 10: 'line10 from run' })),
  ac2: (d) => {
    write(d, 'a.txt', lines({ 2: 'line2 from run' }))
    write(d, 'c.txt', lines({ 2: 'line2 from run' }))
  },
  redSuite: (d) => {
    write(d, 'a.txt', lines({ 2: 'line2 from run' }))
    write(d, 'check.sh', 'echo the suite is red\nexit 1\n')
  },
  binary: (d) => fs.writeFileSync(path.join(d, 'logo.png'), PNG([3, 3, 3])),
  d: (d) => write(d, 'd.txt', 'dee from run\n'),
  tool: (d) => write(d, 'tool.sh', '#!/bin/sh\necho tool from run\n'),
}

const RESOLVED_H1 = () => ({
  status: 'RESOLVED',
  hunks: [{ id: 'h1', content: 'line2 from main\nline2 from run' }],
  notes: 'both second lines, main\'s first',
})
// The candidate's a.txt after that resolution — the byte string M4's fixture
// pins: the run's line and main's line in the conflicted region, and main's
// eleventh line, which no side fought over.
const RESOLVED_A =
  'line1\nline2 from main\nline2 from run\nline3\nline4\nline5\nline6\nline7\n' +
  'line8\nline9\nline10\nline11 human\n'
const RESOLVED_C =
  'line1\nline2 from main\nline2 from run\nline3\nline4\nline5\nline6\nline7\n' +
  'line8\nline9\nline10\n'

// ═════════════════════════════════════════════════════════════════════════════
// leg (a) — the clean folds, the receipt's seams, and where `tip` is written
// ═════════════════════════════════════════════════════════════════════════════
{
  // ── (a.1) disjoint sides: main moved b.txt, the run moved a.txt ───────────
  const fx = newCase('a-disjoint', { mainMoves: MOVES.editB, runEdits: RUN_EDITS.a2 })
  assert.notEqual(fx.runDir, fx.evidenceDir,
    'leg (a) [M1]: --run-dir and --evidence-dir are distinct directories')
  assert.notEqual(fx.tip, fx.base, 'fixture sanity: the bare origin\'s main moved off BASE')

  const engineHeadFile = path.join(fx.pf, 'engine-head')
  let atFirstFetch = null
  const rec = recorder({
    onCall: (c) => {
      const n = norm(c)
      if (atFirstFetch === null && c.cmd === 'git' && n.argv[0] === 'fetch') {
        atFirstFetch = {
          exists: fs.existsSync(engineHeadFile),
          content: fs.existsSync(engineHeadFile) ? fs.readFileSync(engineHeadFile, 'utf8') : null,
        }
      }
    },
  })
  const spy = renameSpy()
  const receipt = await publishFold(opts(fx, 1), { exec: rec, rename: spy, makeAgent: noAgent() })
  assert.equal(typeof receipt, 'object', 'leg (a) [M1]: publishFold resolves the receipt object')

  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'folded', 'leg (a) [M2]: disjoint sides fold')
  assert.equal(a1.pathsJoined, 0,
    'leg (a) [M2]: `pathsJoined` is the size of the two patches\' path intersection — {b.txt} ∩ {a.txt} is empty')
  const candidate = a1.candidate

  // The candidate's only parent is TIP, read from the BARE ORIGIN before the call.
  const parents = git(['rev-list', '--parents', '-n', '1', candidate], fx.target).split(/\s+/).slice(1)
  assert.deepEqual(parents, [fx.tip],
    'leg (a) [M2]: the candidate\'s parent list is exactly [TIP]')
  assert.equal(git(['show', candidate + ':a.txt'], fx.target), lines({ 2: 'line2 from run' }).trimEnd(),
    'leg (a) [M2]: the candidate\'s tree carries every path the run changed')
  assert.equal(git(['show', candidate + ':b.txt'], fx.target), 'bee from main',
    'leg (a) [M2]: the candidate\'s tree carries every path main changed since BASE')
  assert.equal(branchSha(fx), candidate,
    'leg (a) [M2]: refs/heads/' + BRANCH + ' was moved to the candidate with git update-ref')
  assert.equal(git(['rev-parse', 'refs/remotes/origin/main'], fx.target), fx.tip,
    'leg (a) [M1]: the target clone\'s refs/remotes/origin/main equals TIP after the call — the folder fetched it')
  for (const f of ['main.patch', 'run.patch']) {
    assert.ok(fs.existsSync(path.join(fx.pf, f)),
      'leg (a) [M7]: ' + f + ' is written directly under <evidence-dir>/publish-fold/')
  }

  // The kernel's materialize argv, and the plan H1 that titles the commit.
  const mat = kernelCalls(rec).find((a) => a[0] === 'materialize')
  assert.ok(mat, 'leg (a) [M2]: the kernel was asked to materialize')
  assert.equal(mat[mat.indexOf('--prev-head') + 1], fx.tip,
    'leg (a) [M2]: materialize carries --prev-head <TIP>')
  assert.equal(mat[mat.indexOf('--subject') + 1], H1,
    'leg (a) [M2]: materialize carries --subject <the plan file\'s first "# " line>')
  assert.equal(git(['log', '-1', '--format=%s', candidate], fx.target), H1,
    'leg (a) [M2]: the candidate commit\'s subject line is that H1')

  // The two patch cuts: that argv, the range as ONE two-dot word, main first.
  const diffs = gitCalls(rec).filter((c) => c.argv[0] === 'diff').map((c) => c.argv)
  assert.deepEqual(diffs.slice(0, 2), [
    ['diff', '--binary', '--full-index', '--no-renames', fx.base + '..' + fx.tip],
    ['diff', '--binary', '--full-index', '--no-renames', fx.base + '..' + fx.engineHead],
  ], 'leg (a) [M1][M2]: main.patch is cut BASE..TIP and run.patch BASE..engineHead, that argv, main\'s first')

  // engine-head: written before ANY fetch, and mirrored into the receipt.
  assert.ok(atFirstFetch, 'leg (a) [M1]: the folder fetched at least once')
  assert.equal(atFirstFetch.exists, true,
    'leg (a) [M1]: <evidence-dir>/publish-fold/engine-head already exists at the moment of the first git fetch')
  assert.equal(atFirstFetch.content.trim(), fx.engineHead,
    'leg (a) [M1]: and it already holds the branch sha the fixture built')
  assert.equal(fs.readFileSync(engineHeadFile, 'utf8').trim(), fx.engineHead,
    'leg (a) [M1]: engine-head holds the branch sha as the engine left it')
  assert.equal(readReceipt(fx).engineHead, fx.engineHead,
    'leg (a) [M1]: receipt.json mirrors it as `engineHead`')

  // The rename seam is the ONLY way the receipt's path is written.
  assert.ok(spy.calls.length >= 1, 'leg (a) [M1]: every write of the receipt goes through deps.rename')
  for (const c of spy.calls) {
    assert.equal(c.from, receiptPath(fx) + '.tmp',
      'leg (a) [M1]: every deps.rename call moves receipt.json.tmp …')
    assert.equal(c.to, receiptPath(fx),
      'leg (a) [M1]: … to receipt.json, and nothing else')
  }
  assert.deepEqual(fs.readFileSync(receiptPath(fx)), spy.calls[spy.calls.length - 1].bytes,
    'leg (a) [M1]: the receipt\'s final bytes are the last tmp bytes the spy saw — a write that ' +
    'bypasses the seam leaves the two different')
  assert.equal(fs.existsSync(receiptPath(fx) + '.tmp'), false,
    'leg (a) [M1]: no receipt.json.tmp is left behind')

  // ── leg (g) [M7] — the event and the receipts directory, on this clean fold
  const ev = lastFoldEvent(fx)
  const KEYS = ['kind', 'run', 'attempt', 'base', 'tip', 'candidate', 'pathsJoined',
    'pathsConflicted', 'resolversDispatched', 'resolverRetries', 'suite', 'disposition']
  const picked = Object.fromEntries(KEYS.map((k) => [k, ev[k]]))
  assert.deepEqual({ ...picked, run: String(picked.run), attempt: String(picked.attempt) }, {
    kind: 'driver:publish-fold', run: RUN, attempt: '1', base: fx.base, tip: fx.tip,
    candidate, pathsJoined: 0, pathsConflicted: 0, resolversDispatched: 0,
    resolverRetries: 0, suite: 'pass', disposition: 'folded',
  }, 'leg (g) [M7]: one driver:publish-fold event per completed attempt, on all twelve named keys')

  const listing = fs.readdirSync(fx.pf)
  for (const name of ['main.patch', 'run.patch', 'frontier', 'suite-1.txt']) {
    assert.ok(listing.includes(name),
      'leg (g) [M7]: ls <evidence-dir>/publish-fold/ names ' + name + ' — got ' + listing.join(', '))
  }
  assert.deepEqual(
    fs.readFileSync(path.join(fx.pf, 'frontier', 'wave-1', 'fold_log.jsonl')),
    fs.readFileSync(path.join(fx.kernelWaves, 'wave-1', 'fold_log.jsonl')),
    'leg (g) [M7]: the kernel\'s wave directory is copied to <evidence-dir>/publish-fold/frontier/wave-1/')

  // ── engine-head is written once and never rewritten ───────────────────────
  const before = fs.statSync(engineHeadFile)
  const beforeBytes = fs.readFileSync(engineHeadFile)
  cliRun(fx, 1, 'leg (a)')
  const after = fs.statSync(engineHeadFile)
  assert.equal(after.mtimeMs, before.mtimeMs,
    'leg (a) [M1]: a second run of attempt 1 leaves engine-head\'s mtime unchanged')
  assert.deepEqual(fs.readFileSync(engineHeadFile), beforeBytes,
    'leg (a) [M1]: … and its content unchanged')
}

{
  // ── (a.2) the same file, different lines: one joined path, no resolver ────
  const fx = newCase('a-samefile', { mainMoves: MOVES.editALine1, runEdits: RUN_EDITS.a10 })
  const rec = recorder()
  await publishFold(opts(fx, 1), { exec: rec, rename: renameSpy(), makeAgent: noAgent() })
  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'folded', 'leg (a) [M2]: two edits to different lines of one file fold')
  assert.equal(a1.pathsJoined, 1,
    'leg (a) [M2]: `pathsJoined` is 1 — both patches touch a.txt')
  assert.equal(a1.resolversDispatched, 0, 'leg (a) [M2]: and no resolver was dispatched')
  assert.equal(git(['show', a1.candidate + ':a.txt'], fx.target),
    lines({ 1: 'line1 from main', 10: 'line10 from run' }).trimEnd(),
    'leg (a) [M2]: the candidate\'s tree carries both edits')
  assert.deepEqual(git(['rev-list', '--parents', '-n', '1', a1.candidate], fx.target).split(/\s+/).slice(1),
    [fx.tip], 'leg (a) [M2]: and lands on TIP')
}

{
  // ── (a.3) `tip` is written right after the fetch and TIP read, and before
  // anything else — a folder that writes it later fails on the first receipt.
  const fx = newCase('a-tiporder', { mainMoves: MOVES.editB, runEdits: RUN_EDITS.a2 })
  let sawFetch = false, sawTipRead = false, armed = false
  const throwing = recorder({
    inner: async (cmd, argv, options) => {
      const n = norm({ cmd, argv: (argv || []).map(String), cwd: options && options.cwd })
      if (armed && cmd === 'git') {
        throw new Error('exam: deps.exec refuses every git call after the TIP read')
      }
      const r = await execSeam(cmd, argv, options)
      const joined = n.argv.join(' ')
      if (cmd === 'git' && n.argv[0] === 'fetch' && joined.includes('main')) sawFetch = true
      else if (sawFetch && cmd === 'git' && n.argv[0] === 'rev-parse' &&
               joined.includes('refs/remotes/origin/main')) { sawTipRead = true; armed = true }
      return r
    },
  })
  await assert.rejects(
    publishFold(opts(fx, 1), { exec: throwing, rename: renameSpy(), makeAgent: noAgent() }),
    'leg (a) [M1]: a throwing deps.exec makes publishFold reject')
  assert.equal(sawTipRead, true,
    'leg (a) [M1]: the folder fetched the default branch and read TIP with rev-parse refs/remotes/origin/main')
  const r = readReceipt(fx)
  assert.equal(r.engineHead, fx.engineHead, 'leg (a) [M1]: the receipt afterward holds engineHead')
  const a1 = r.attempts && r.attempts['1']
  assert.ok(a1, 'leg (a) [M1]: … and an attempt-1 entry')
  assert.equal(a1.tip, fx.tip,
    'leg (a) [M1]: `tip` is the moved TIP, as the bare origin reports it — written right after the TIP read')
  assert.equal(a1.disposition, undefined,
    'leg (a) [M6]: and the attempt carries no `disposition`, so it is a dangling attempt')
  assert.deepEqual(kernelVerbs(throwing), [],
    'leg (a) [M1]: no kernel call was made before the refusal')

  // Re-entry discards the dangling attempt and the fold completes.
  const rec = recorder()
  await publishFold(opts(fx, 1), { exec: rec, rename: renameSpy(), makeAgent: noAgent() })
  assert.equal(att(fx, 1).disposition, 'folded',
    'leg (a) [M6]: a further --attempt 1 with a plain deps.exec completes `folded`')
}

// ═════════════════════════════════════════════════════════════════════════════
// leg (b) — TIP == BASE: nothing to join, and the kernel is never invoked
// ═════════════════════════════════════════════════════════════════════════════
{
  const fx = newCase('b-nothing', { runEdits: RUN_EDITS.a2 })
  assert.equal(fx.tip, fx.base, 'fixture sanity: the origin\'s main is still at BASE')
  cliRun(fx, 1, 'leg (b)')

  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'nothing to join', 'leg (b) [M2]: TIP == BASE records `nothing to join`')
  assert.equal(a1.pathsJoined, 0, 'leg (b) [M2]: with pathsJoined 0')
  assert.equal(a1.candidate, fx.engineHead, 'leg (b) [M2]: and candidate = engineHead')
  assert.equal(a1.tip, fx.base, 'leg (b) [M1]: `tip` is written before the TIP == BASE comparison')
  assert.equal(branchSha(fx), fx.engineHead, 'leg (b) [M2]: the branch is left untouched')
  assert.equal(fs.existsSync(path.join(fx.pf, 'frontier')), false,
    'leg (b) [M2]: no <evidence-dir>/publish-fold/frontier/ — the kernel was invoked zero times')
  assert.equal(fs.existsSync(fx.kernelWaves), false,
    'leg (b) [M2]: and no <run dir>/publish-fold/frontier/ either')
}

// ═════════════════════════════════════════════════════════════════════════════
// leg (c) — the suite: red, green and absent
// ═════════════════════════════════════════════════════════════════════════════
{
  // ── (c.1) a red suite: `suite red`, the branch still at the candidate ─────
  const fx = newCase('c-red', { mainMoves: MOVES.editB, runEdits: RUN_EDITS.redSuite })
  const beforeHead = git(['rev-parse', 'HEAD'], fx.integ)
  const beforeStatus = git(['status', '--porcelain'], fx.integ)
  const beforeA = fs.readFileSync(path.join(fx.integ, 'a.txt'), 'utf8')
  cliRun(fx, 1, 'leg (c)')

  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'suite red', 'leg (c) [M3]: a non-zero suite records `suite red`')
  assert.equal(a1.suite, 'fail', 'leg (c) [M3]: with suite: \'fail\'')
  assert.equal(branchSha(fx), a1.candidate, 'leg (c) [M3]: and the branch still at the candidate')
  const out = fs.readFileSync(path.join(fx.pf, 'suite-1.txt'), 'utf8')
  assert.ok(out.includes('the suite is red'),
    'leg (c) [M3]: suite-1.txt carries the script\'s output — got ' + JSON.stringify(out))
  assert.equal(git(['rev-parse', 'HEAD'], fx.integ), beforeHead,
    'leg (c) [M3]: clones/integration\'s HEAD is what it was before the fold')
  assert.equal(git(['status', '--porcelain'], fx.integ), beforeStatus,
    'leg (c) [M3]: … and its working tree is clean again')
  assert.equal(fs.readFileSync(path.join(fx.integ, 'a.txt'), 'utf8'), beforeA,
    'leg (c) [M3]: … byte for byte')
}

{
  // ── (c.2) a green suite, in-process: the four calls, in order ─────────────
  const fx = newCase('c-green', { mainMoves: MOVES.editB, runEdits: RUN_EDITS.a2 })
  const beforeHead = git(['rev-parse', 'HEAD'], fx.integ)
  const rec = recorder()
  await publishFold(opts(fx, 1), { exec: rec, rename: renameSpy(), makeAgent: noAgent() })

  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'folded', 'leg (c) [M3]: exit 0 keeps `folded`')
  assert.equal(a1.suite, 'pass', 'leg (c) [M3]: with suite: \'pass\'')
  assert.equal(git(['rev-parse', 'HEAD'], fx.integ), beforeHead,
    'leg (c) [M3]: clones/integration is reset --hard back to its own HEAD')
  assert.equal(git(['status', '--porcelain'], fx.integ), '',
    'leg (c) [M3]: … with a clean tree')

  const inInteg = rec.calls.map(norm).map((c, i) => ({ ...c, i })).filter((c) => c.cwd === fx.integ)
  const at = (pred, what) => {
    const hit = inInteg.find(pred)
    assert.ok(hit, 'leg (c) [M3]: ' + what + ' ran in clones/integration — saw ' +
      JSON.stringify(inInteg.map((c) => [c.cmd, ...c.argv].slice(0, 4))))
    return hit
  }
  const fetch = at((c) => c.cmd === 'git' && c.argv[0] === 'fetch', 'the branch fetch')
  assert.deepEqual(fetch.argv,
    ['fetch', '--no-tags', fx.target, 'refs/heads/' + BRANCH],
    'leg (c) [M3]: the integration clone fetches the branch BY NAME from the target clone')
  const readTree = at((c) => c.cmd === 'git' && c.argv[0] === 'read-tree', 'the read-tree')
  assert.deepEqual(readTree.argv, ['read-tree', '-u', '--reset', a1.candidate + '^{tree}'],
    'leg (c) [M3]: the candidate\'s tree is read into it with read-tree -u --reset')
  const bashes = inInteg.filter((c) => c.cmd === 'bash')
  assert.equal(bashes.length, 1, 'leg (c) [M3]: the suite runs exactly once')
  assert.deepEqual([bashes[0].cmd, ...bashes[0].argv], ['bash', '-lc', 'bash check.sh'],
    'leg (c) [M3]: through bash -lc, with args.json\'s testCmd verbatim')
  const reset = inInteg.filter((c) => c.cmd === 'git' && c.argv[0] === 'reset' && c.argv[1] === '--hard').pop()
  assert.ok(reset, 'leg (c) [M3]: and a git reset --hard there')
  assert.ok(fetch.i < readTree.i && readTree.i < bashes[0].i && bashes[0].i < reset.i,
    'leg (c) [M3]: in that order — fetch, read-tree, the suite, reset --hard')
}

{
  // ── (c.3) an args.json with no testCmd: `suite: 'none'`, nothing run ──────
  const fx = newCase('c-none', { mainMoves: MOVES.editB, runEdits: RUN_EDITS.a2, testCmd: null })
  const rec = recorder()
  await publishFold(opts(fx, 1), { exec: rec, rename: renameSpy(), makeAgent: noAgent() })
  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'folded', 'leg (c) [M3]: an args.json with no testCmd still folds')
  assert.equal(a1.suite, 'none', 'leg (c) [M3]: with suite: \'none\'')
  assert.equal(fs.existsSync(path.join(fx.pf, 'suite-1.txt')), false,
    'leg (c) [M3]: and no suite-1.txt')
  assert.deepEqual(rec.calls.filter((c) => c.cmd === 'bash').map((c) => c.argv), [],
    'leg (c) [M3]: no bash call at all — it runs nothing')
  assert.equal(lastFoldEvent(fx).suite, 'none', 'leg (c) [M7]: the event carries suite: \'none\'')
}

// ═════════════════════════════════════════════════════════════════════════════
// leg (d) — one textual conflict, resolved: the brief, the reply, the tree
// ═════════════════════════════════════════════════════════════════════════════
{
  const fx = newCase('d-conflict', { mainMoves: MOVES.conflictA, runEdits: RUN_EDITS.a2 })
  const human = {
    sha7: git(['log', '-1', '--format=%h', '--abbrev=7', 'refs/heads/main'], fx.maker),
    subject: git(['log', '-1', '--format=%s', 'refs/heads/main'], fx.maker),
    author: git(['log', '-1', '--format=%an', 'refs/heads/main'], fx.maker),
  }
  assert.equal(human.subject, 'tidy the tail', 'fixture sanity: main\'s tip is the human commit')
  assert.equal(human.author, 'A Human', 'fixture sanity: authored by A Human')
  const tipTree = git(['rev-parse', 'refs/heads/main^{tree}'], fx.origin)

  const stub = stubAgent(() => RESOLVED_H1(), { integ: fx.integ })
  const rec = recorder()
  await publishFold(opts(fx, 1), { exec: rec, rename: renameSpy(), makeAgent: stub.makeAgent })

  // The wave the kernel wrote, and the `i` it chose. Never a literal.
  const waveDir = path.join(fx.kernelWaves, 'wave-1')
  const index = JSON.parse(fs.readFileSync(path.join(waveDir, 'conflicts.json'), 'utf8'))
  assert.equal(index.length, 1, 'leg (d) [M4]: the kernel narrated exactly one conflict')
  const i = index[0].i
  assert.equal(index[0].path, 'a.txt', 'leg (d) [M4]: on a.txt')

  assert.equal(stub.dispatches.length, 1, 'leg (d) [M4]: the resolver is dispatched once')
  const d0 = stub.dispatches[0]
  assert.ok(d0.label.startsWith('resolve:publish-fold:1:'),
    'leg (d) [M4]: with a label starting `resolve:publish-fold:1:` — got ' + d0.label)

  // The brief, in the order M4's concatenation puts it.
  const iSentence = d0.prompt.indexOf(SIDE_SENTENCE)
  const run3Entry = taskEntry(3, T1)
  const iRun3 = d0.prompt.indexOf(run3Entry)
  const mainLine = '- main ' + human.sha7 + ' "' + human.subject + '" (' + human.author + ', no plan)'
  const iMain = d0.prompt.indexOf(mainLine)
  const iOurs = d0.prompt.indexOf(taskEntry(RUN, TASK_A))
  assert.ok(iSentence >= 0, 'leg (d) [M4]: the prompt carries the side sentence verbatim: ' +
    JSON.stringify(SIDE_SENTENCE))
  assert.ok(iRun3 > iSentence,
    'leg (d) [M4]: then `- run 3 task T1: ` with run 3\'s T1 body verbatim from the tag\'s plan on the next line')
  assert.ok(iMain > iRun3,
    'leg (d) [M4]: then ' + JSON.stringify(mainLine) + ' for the human commit that touched a.txt')
  assert.ok(iOurs > iMain,
    'leg (d) [M4]: then `- run ' + RUN + ' task ` with this run\'s task body verbatim from launch.json')
  for (const forbidden of ['ultra/integration-run-', 'launch.json']) {
    assert.equal(d0.prompt.includes(forbidden), false,
      'leg (d) [M4]: the prompt carries no ' + JSON.stringify(forbidden))
  }

  // What the resolver's own cwd held at the moment of dispatch.
  assert.equal(d0.headTree, tipTree,
    'leg (d) [M4]: before the first dispatch clones/integration holds TIP\'s tree (git rev-parse HEAD^{tree})')
  assert.ok(d0.aTxt.includes('line2 from main') && d0.aTxt.includes('line11 human'),
    'leg (d) [M4]: and a.txt there is main\'s — got ' + JSON.stringify(d0.aTxt))

  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'folded', 'leg (d) [M4]: a resolved conflict continues to materialize and folds')
  assert.equal(a1.resolversDispatched, 1, 'leg (d) [M4]: resolversDispatched is the number of resolver replies')
  assert.equal(lastFoldEvent(fx).resolverRetries, 0, 'leg (d) [M7]: and resolverRetries is 0')

  // The reply directory the kernel's own --run-dir tree holds, keyed on `i`.
  const replyDir = path.join(waveDir, 'reply-' + i + '-1')
  const replyFile = path.join(replyDir, 'h1.txt')
  assert.ok(fs.existsSync(replyFile),
    'leg (d) [M4]: the reply lands in <run dir>/publish-fold/frontier/wave-1/reply-' + i + '-1/')
  assert.deepEqual(fs.readFileSync(path.join(fx.pf, 'frontier', 'wave-1', 'reply-' + i + '-1', 'h1.txt')),
    fs.readFileSync(replyFile),
    'leg (d) [M7]: and is copied under <evidence-dir>/publish-fold/frontier/wave-1/ with the same bytes')
  const brief = path.join(fx.pf, 'resolver-brief-' + i + '-1.txt')
  assert.ok(fs.existsSync(brief),
    'leg (d) [M4]: the brief is saved as resolver-brief-' + i + '-1.txt, the same <i> as its reply directory')
  assert.equal(fs.readFileSync(brief, 'utf8'), d0.prompt,
    'leg (d) [M4]: and its bytes are the prompt the resolver received')

  assert.equal(git(['show', a1.candidate + ':a.txt'], fx.target) + '\n', RESOLVED_A,
    'leg (d) [M4]: the candidate\'s a.txt is the resolution, byte for byte')

  // The kernel's fold argv.
  const fold = kernelCalls(rec).find((a) => a[0] === 'fold')
  assert.ok(fold, 'leg (d) [M4]: the kernel was asked to fold')
  assert.equal(fold[fold.indexOf('--wave') + 1], '1', 'leg (d) [M4]: --wave 1')
  assert.equal(fold[fold.indexOf('--run-dir') + 1], path.join(fx.runDir, 'publish-fold'),
    'leg (d) [M4]: --run-dir <run dir>/publish-fold')
  const patches = fold.map((a, n) => (a === '--patch' ? fold[n + 1] : null)).filter(Boolean)
  assert.equal(patches.length, 2, 'leg (d) [M2]: two --patch arguments')
  assert.ok(patches[0].startsWith('main='), 'leg (d) [M2]: --patch main=… comes first')
  assert.ok(patches[1].startsWith('run-' + RUN + '='), 'leg (d) [M2]: then --patch run-' + RUN + '=…')
  for (const argv of kernelCalls(rec)) {
    assert.equal(argv.includes('--commutes'), false,
      'leg (d) [M4]: `commutesArgs` is [] — no --commutes word in any kernel argv')
  }

  assert.equal(git(['status', '--porcelain'], fx.integ), '',
    'leg (d) [M4]: clones/integration is restored on exit')
  assert.equal(lastFoldEvent(fx).pathsConflicted, 1,
    'leg (g) [M7]: the conflicted fold\'s event carries pathsConflicted 1')
  const briefs = fs.readdirSync(fx.pf).filter((n) => /^resolver-brief-\d+-1\.txt$/.test(n))
  assert.deepEqual(briefs, ['resolver-brief-' + i + '-1.txt'],
    'leg (g) [M7]: exactly one name matching /^resolver-brief-\\d+-1\\.txt$/, whose <i> is conflicts.json\'s')
}

// ═════════════════════════════════════════════════════════════════════════════
// leg (e) — every park, and `cannot fold`
// ═════════════════════════════════════════════════════════════════════════════
{
  // ── (e.1) a resolver reporting BLOCKED ────────────────────────────────────
  const fx = newCase('e-blocked', { mainMoves: MOVES.conflictA, runEdits: RUN_EDITS.a2 })
  const stub = stubAgent(() => ({ status: 'BLOCKED', notes: 'I cannot read this' }))
  const rec = recorder()
  await publishFold(opts(fx, 1), { exec: rec, rename: renameSpy(), makeAgent: stub.makeAgent })

  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'conflict parked', 'leg (e) [M5]: a BLOCKED resolver parks')
  assert.equal(a1.path, 'a.txt', 'leg (e) [M5]: with `path` = the conflicted path')
  assert.equal(a1.candidate, fx.engineHead, 'leg (e) [M5]: and candidate = engineHead on attempt 1')
  assert.equal(branchSha(fx), fx.engineHead, 'leg (e) [M5]: the branch is untouched')
  assert.equal(kernelVerbs(rec).includes('materialize'), false,
    'leg (e) [M5]: and no materialize — got ' + kernelVerbs(rec).join(', '))
  assert.equal(fs.readFileSync(receiptPath(fx), 'utf8').includes('candidateSha'), false,
    'leg (e) [M5]: no candidateSha anywhere in the receipt')
  assert.equal(git(['status', '--porcelain'], fx.integ), '',
    'leg (e) [M4]: clones/integration is restored on a parked exit too')
  assert.ok(fs.existsSync(path.join(fx.pf, 'frontier', 'wave-1')),
    'leg (g) [M7]: the parked shape still leaves <evidence-dir>/publish-fold/frontier/wave-1/ in place')
}

{
  // ── (e.2) a RESOLVED reply the kernel rejects twice (empty hunks) ─────────
  const fx = newCase('e-rejected', { mainMoves: MOVES.conflictA, runEdits: RUN_EDITS.a2 })
  const stub = stubAgent(() => ({ status: 'RESOLVED', hunks: [], notes: 'nothing' }))
  await publishFold(opts(fx, 1), { exec: recorder(), rename: renameSpy(), makeAgent: stub.makeAgent })

  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'conflict parked',
    'leg (e) [M5]: a reply rejected twice (the kernel exits 4 on an empty hunks list) parks')
  assert.equal(a1.resolversDispatched, 2, 'leg (e) [M5]: with resolversDispatched 2')
  assert.equal(stub.dispatches.length, 2, 'leg (e) [M5]: the resolver was dispatched twice')
  assert.equal(lastFoldEvent(fx).resolverRetries, 1,
    'leg (e) [M7]: `resolverRetries` is the number of transcripts with attempt 2')
  assert.equal(branchSha(fx), fx.engineHead, 'leg (e) [M5]: and the branch is unchanged')
}

{
  // ── (e.3) two sides on one binary path ────────────────────────────────────
  const fx = newCase('e-binary', { mainMoves: MOVES.binary, runEdits: RUN_EDITS.binary })
  cliRun(fx, 1, 'leg (e)')
  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'conflict parked',
    'leg (e) [M5]: a conflict the kernel narrates as undispatchable parks')
  assert.equal(a1.path, 'logo.png', 'leg (e) [M5]: with `path` = logo.png')
  assert.equal(a1.resolversDispatched, 0, 'leg (e) [M5]: and no resolver dispatched')
  assert.equal(branchSha(fx), fx.engineHead, 'leg (e) [M5]: the branch untouched')
}

{
  // ── (e.4) a delete/modify pairing ─────────────────────────────────────────
  const fx = newCase('e-delmod', { mainMoves: MOVES.deleteD, runEdits: RUN_EDITS.d })
  cliRun(fx, 1, 'leg (e)')
  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'conflict parked', 'leg (e) [M5]: a delete/modify pairing parks')
  assert.equal(a1.path, 'd.txt', 'leg (e) [M5]: with `path` = d.txt')
  assert.equal(branchSha(fx), fx.engineHead, 'leg (e) [M5]: the branch unchanged')
}

{
  // ── (e.5) a chmod on main since BASE, the run never touching the file ─────
  const fx = newCase('e-chmod', { mainMoves: MOVES.chmodTool, runEdits: RUN_EDITS.a2 })
  cliRun(fx, 1, 'leg (e)')
  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'cannot fold',
    'leg (e) [M5]: a materialize answering `park` records `cannot fold`')
  assert.ok(String(a1.reason).includes('changes mode'),
    'leg (e) [M5]: with `reason` = the kernel\'s reason — got ' + JSON.stringify(a1.reason))
  assert.equal(branchSha(fx), fx.engineHead, 'leg (e) [M5]: and the branch untouched')
}

{
  // ── (e.6) the same chmod with the run editing that file's content ─────────
  const fx = newCase('e-chmod2', { mainMoves: MOVES.chmodTool, runEdits: RUN_EDITS.tool })
  cliRun(fx, 1, 'leg (e)')
  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'cannot fold',
    'leg (e) [M5]: a mode change on a path this run edited is `cannot fold` too')
  assert.ok(String(a1.reason).includes('changes mode'),
    'leg (e) [M5]: with the kernel\'s reason — got ' + JSON.stringify(a1.reason))
  assert.equal(branchSha(fx), fx.engineHead, 'leg (e) [M5]: and the branch untouched')
}

{
  // ── (e.7) a BASE that is not an ancestor of TIP ───────────────────────────
  const fx = newCase('e-ancestry', { mainMoves: MOVES.editB, runEdits: RUN_EDITS.a2 })
  const side = git(['commit-tree', fx.base + '^{tree}', '-p', fx.base, '-m', 'a side commit'], fx.target)
  assert.equal(gitOk(['merge-base', '--is-ancestor', side, fx.tip], fx.target), false,
    'fixture sanity: the side commit is not an ancestor of TIP')
  const argv = [FOLDER_CLI, '--repo', fx.target, '--base', side, '--branch', BRANCH,
    '--run', RUN, '--run-dir', fx.runDir, '--evidence-dir', fx.evidenceDir, '--attempt', '1']
  let code = 0, out = ''
  try {
    out = execFileSync('node', argv, { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) { code = typeof e.status === 'number' ? e.status : 1; out = String(e.stdout || '') + String(e.stderr || '') }
  assert.equal(code, 0, 'leg (e) [M1]: the CLI exits 0 on `cannot fold` too — got ' + code + '\n' + out)
  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'cannot fold',
    'leg (e) [M5]: a BASE that is not an ancestor of TIP records `cannot fold`')
  assert.ok(/ancest/i.test(String(a1.reason)),
    'leg (e) [M5]: with `reason` naming ancestry — got ' + JSON.stringify(a1.reason))
  assert.equal(fs.existsSync(fx.kernelWaves), false,
    'leg (e) [M5]: and no frontier/ directory — the kernel was never called')
  assert.equal(branchSha(fx), fx.engineHead, 'leg (e) [M5]: the branch untouched')
}

// ═════════════════════════════════════════════════════════════════════════════
// leg (f) — re-entry, before any fetch of the default branch
// ═════════════════════════════════════════════════════════════════════════════
/** A real commit off BASE with a distinct message, so its sha is distinct. */
const spare = (fx, message) =>
  git(['commit-tree', fx.base + '^{tree}', '-p', fx.base, '-m', message], fx.target)
const plantReceipt = (fx, payload) => {
  fs.mkdirSync(fx.pf, { recursive: true })
  fs.writeFileSync(path.join(fx.pf, 'receipt.json'),
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2))
}

{
  // ── (f.1) a completed attempt 1 restores and exits, and drops the tmp ─────
  const fx = newCase('f-restore', { runEdits: RUN_EDITS.a2 })
  const X = spare(fx, 'candidate X')
  fs.mkdirSync(fx.pf, { recursive: true })
  fs.writeFileSync(path.join(fx.pf, 'engine-head'), fx.engineHead + '\n')
  plantReceipt(fx, { engineHead: fx.engineHead,
    attempts: { 1: { tip: fx.base, candidate: X, disposition: 'folded' } } })
  fs.writeFileSync(receiptPath(fx) + '.tmp', 'stray')
  const bytes = fs.readFileSync(receiptPath(fx))

  cliRun(fx, 1, 'leg (f)')
  assert.equal(branchSha(fx), X, 'leg (f) [M6]: the branch is restored to the recorded candidate')
  assert.equal(att(fx, 1).disposition, 'folded', 'leg (f) [M6]: and the attempt\'s disposition stands')
  assert.deepEqual(fs.readFileSync(receiptPath(fx)), bytes,
    'leg (f) [M6]: the receipt\'s bytes are unchanged — nothing was re-folded')
  assert.equal(fs.existsSync(receiptPath(fx) + '.tmp'), false,
    'leg (f) [M6]: receipt.json.tmp is deleted at re-entry')
  assert.equal(fs.existsSync(path.join(fx.kernelWaves, 'wave-1')), false,
    'leg (f) [M6]: nothing was dispatched and no frontier/wave-1/ entries were made')
}

{
  // ── (f.2) a parked attempt wins too ───────────────────────────────────────
  const fx = newCase('f-parked', { runEdits: RUN_EDITS.a2 })
  const E = spare(fx, 'the engine head')
  git(['update-ref', 'refs/heads/' + BRANCH, spare(fx, 'a stale branch tip')], fx.target)
  fs.mkdirSync(fx.pf, { recursive: true })
  fs.writeFileSync(path.join(fx.pf, 'engine-head'), E + '\n')
  plantReceipt(fx, { engineHead: E,
    attempts: { 1: { tip: fx.base, candidate: E, disposition: 'conflict parked', path: 'a.txt' } } })

  cliRun(fx, 1, 'leg (f)')
  assert.equal(branchSha(fx), E, 'leg (f) [M6]: a parked attempt restores the branch to engineHead')
  assert.equal(att(fx, 1).disposition, 'conflict parked', 'leg (f) [M6]: and the parked disposition wins')
}

{
  // ── (f.3) the HIGHEST attempt with a disposition wins ─────────────────────
  const fx = newCase('f-highest', { runEdits: RUN_EDITS.a2 })
  const X = spare(fx, 'candidate X')
  const Y = spare(fx, 'candidate Y')
  assert.notEqual(X, Y, 'fixture sanity: two distinct candidate shas')
  fs.mkdirSync(fx.pf, { recursive: true })
  fs.writeFileSync(path.join(fx.pf, 'engine-head'), fx.engineHead + '\n')
  plantReceipt(fx, { engineHead: fx.engineHead, attempts: {
    1: { tip: fx.base, candidate: X, disposition: 'folded' },
    2: { tip: fx.base, candidate: Y, disposition: 'folded' },
  } })

  cliRun(fx, 1, 'leg (f)')
  assert.equal(branchSha(fx), Y,
    'leg (f) [M6]: --attempt 1 restores to attempt 2\'s candidate, not attempt 1\'s')
  assert.equal(att(fx, 2).disposition, 'folded', 'leg (f) [M6]: and exits with attempt 2\'s disposition')
}

{
  // ── (f.4) a dangling attempt is discarded, both copies of its wave ────────
  const fx = newCase('f-dangling', { runEdits: RUN_EDITS.a2 })
  const X = spare(fx, 'candidate X')
  fs.mkdirSync(fx.pf, { recursive: true })
  fs.writeFileSync(path.join(fx.pf, 'engine-head'), fx.engineHead + '\n')
  plantReceipt(fx, { engineHead: fx.engineHead, attempts: {
    1: { tip: fx.base, candidate: X, disposition: 'folded' },
    2: { tip: fx.base },
  } })
  const kernelWave2 = path.join(fx.kernelWaves, 'wave-2')
  const evidenceWave2 = path.join(fx.pf, 'frontier', 'wave-2')
  for (const d of [kernelWave2, evidenceWave2]) {
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'fold_log.jsonl'), '{"type":"base","sha":"' + fx.base + '"}\n')
  }

  cliRun(fx, 1, 'leg (f)')
  assert.equal(fs.existsSync(kernelWave2), false,
    'leg (f) [M6][M7]: the dangling attempt\'s <run dir> wave directory is deleted')
  assert.equal(fs.existsSync(evidenceWave2), false,
    'leg (f) [M6][M7]: … and its <evidence-dir> copy with it')
  const r = readReceipt(fx)
  assert.equal(r.attempts['2'], undefined, 'leg (f) [M6]: the dangling entry is removed from the receipt')
  assert.equal(r.attempts['1'].disposition, 'folded', 'leg (f) [M6]: and attempt 1\'s disposition is the exit')
  assert.equal(branchSha(fx), X, 'leg (f) [M6]: with the branch restored to attempt 1\'s candidate')
  assert.equal(fs.existsSync(receiptPath(fx) + '.tmp'), false, 'leg (f) [M6]: no stray receipt.json.tmp')
}

{
  // ── (f.5) an unparsable receipt, with the branch on the origin ────────────
  const fx = newCase('f-unparsable', { runEdits: RUN_EDITS.a2 })
  git(['push', '--quiet', 'origin', 'refs/heads/' + BRANCH], fx.target)
  const pushed = git(['rev-parse', 'refs/heads/' + BRANCH], fx.origin)
  assert.equal(pushed, fx.engineHead, 'fixture sanity: the origin holds the branch')
  git(['update-ref', '-d', 'refs/remotes/origin/' + BRANCH], fx.target)
  const Z = spare(fx, 'a stale branch tip')
  git(['update-ref', 'refs/heads/' + BRANCH, Z], fx.target)
  fs.mkdirSync(fx.pf, { recursive: true })
  fs.writeFileSync(path.join(fx.pf, 'engine-head'), spare(fx, 'the engine head') + '\n')
  plantReceipt(fx, '{not json')

  cliRun(fx, 1, 'leg (f)')
  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'cannot fold', 'leg (f) [M6]: an unparsable receipt is replaced')
  assert.equal(a1.reason, 'receipt unparsable', 'leg (f) [M6]: with reason `receipt unparsable`')
  assert.equal(a1.candidate, pushed, 'leg (f) [M6]: candidate = the remote\'s branch sha')
  assert.equal(a1.pushedHead, pushed, 'leg (f) [M6]: and pushedHead the same')
  assert.equal(branchSha(fx), pushed, 'leg (f) [M6]: the branch is restored to it before exit')
  assert.equal(gitOk(['rev-parse', '--verify', 'refs/remotes/origin/' + BRANCH], fx.target), true,
    'leg (f) [M6]: git fetch origin <branch> happened — the remote-tracking ref is back')
  assert.equal(fs.existsSync(fx.kernelWaves), false, 'leg (f) [M6]: and nothing was dispatched')
  assert.equal(fs.existsSync(receiptPath(fx) + '.tmp'), false, 'leg (f) [M6]: no stray receipt.json.tmp')
}

{
  // ── (f.6) the same, with the origin holding no such branch ────────────────
  const fx = newCase('f-unpushed', { runEdits: RUN_EDITS.a2 })
  const E = spare(fx, 'the engine head')
  git(['update-ref', 'refs/heads/' + BRANCH, spare(fx, 'a stale branch tip')], fx.target)
  fs.mkdirSync(fx.pf, { recursive: true })
  fs.writeFileSync(path.join(fx.pf, 'engine-head'), E + '\n')
  plantReceipt(fx, '{not json')
  assert.equal(gitOk(['rev-parse', '--verify', 'refs/heads/' + BRANCH], fx.origin), false,
    'fixture sanity: the origin has no such branch')

  cliRun(fx, 1, 'leg (f)')
  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'cannot fold', 'leg (f) [M6]: still `cannot fold`')
  assert.equal(a1.reason, 'receipt unparsable', 'leg (f) [M6]: still `receipt unparsable`')
  assert.equal(a1.candidate, E, 'leg (f) [M6]: candidate = the engine-head file\'s content')
  assert.equal('pushedHead' in a1, false, 'leg (f) [M6]: and no pushedHead key')
  assert.equal(branchSha(fx), E, 'leg (f) [M6]: the branch is restored to that candidate')
  assert.equal(fs.existsSync(receiptPath(fx) + '.tmp'), false, 'leg (f) [M6]: no stray receipt.json.tmp')
}

// ═════════════════════════════════════════════════════════════════════════════
// leg (h) — attempt 2
// ═════════════════════════════════════════════════════════════════════════════
{
  // ── (h.1) a fresh TIP equal to attempt 1's recorded tip ───────────────────
  const fx = newCase('h-unmoved', { mainMoves: MOVES.editB, runEdits: RUN_EDITS.a2 })
  cliRun(fx, 1, 'leg (h)')
  const first = att(fx, 1)
  assert.equal(first.disposition, 'folded', 'leg (h): attempt 1 folded through the CLI')
  // The boot script's `push_head` writes `pushedHead` after attempt 1; the sim
  // does it here, since the folder pushes nothing.
  const r = readReceipt(fx)
  r.attempts['1'].pushedHead = first.candidate
  fs.writeFileSync(receiptPath(fx), JSON.stringify(r, null, 2))

  cliRun(fx, 2, 'leg (h)')
  const second = att(fx, 2)
  assert.equal(second.disposition, 'tip unmoved',
    'leg (h) [M8]: attempt 2 whose fresh TIP equals attempt 1\'s recorded tip records `tip unmoved`')
  assert.equal(second.candidate, first.candidate,
    'leg (h) [M8]: with candidate = attempt 1\'s candidate')
  assert.equal(fs.existsSync(path.join(fx.kernelWaves, 'wave-2')), false,
    'leg (h) [M8]: and the kernel invoked zero times — no frontier/wave-2/')
}

{
  // ── (h.2) attempt 2 on a moved TIP ────────────────────────────────────────
  const fx = newCase('h-moved', { mainMoves: MOVES.editB, runEdits: RUN_EDITS.a2 })
  cliRun(fx, 1, 'leg (h)')
  const first = att(fx, 1)
  const r = readReceipt(fx)
  r.attempts['1'].pushedHead = first.candidate
  fs.writeFileSync(receiptPath(fx), JSON.stringify(r, null, 2))

  // main moves again, from the second clone.
  write(fx.maker, 'c.txt', lines({ 1: 'line1 from main again' }))
  git(['add', '-A'], fx.maker)
  git(['commit', '--quiet', '-m', 'main moves a second time'], fx.maker)
  git(['push', '--quiet', 'origin', 'main'], fx.maker)
  const tip2 = git(['rev-parse', 'refs/heads/main'], fx.origin)
  assert.notEqual(tip2, fx.tip, 'fixture sanity: the bare origin\'s main moved again')

  cliRun(fx, 2, 'leg (h)')
  const second = att(fx, 2)
  assert.equal(second.disposition, 'folded', 'leg (h) [M8]: attempt 2 on a moved TIP folds')
  assert.deepEqual(git(['rev-list', '--parents', '-n', '1', second.candidate], fx.target).split(/\s+/).slice(1),
    [tip2], 'leg (h) [M8]: its candidate\'s only parent is the NEW TIP')
  assert.deepEqual(fs.readFileSync(path.join(fx.pf, 'run.patch')),
    gitBytes(['-C', fx.target, 'diff', '--binary', '--full-index', '--no-renames',
      fx.base + '..' + fx.engineHead], fx.target),
    'leg (h) [M8]: run.patch is cut from engineHead, not from the attempt-1 candidate')
  assert.equal(git(['show', second.candidate + ':a.txt'], fx.target),
    lines({ 2: 'line2 from run' }).trimEnd(), 'leg (h) [M8]: the tree carries the run\'s edit')
  assert.equal(git(['show', second.candidate + ':b.txt'], fx.target), 'bee from main',
    'leg (h) [M8]: … main\'s first move')
  assert.equal(git(['show', second.candidate + ':c.txt'], fx.target),
    lines({ 1: 'line1 from main again' }).trimEnd(), 'leg (h) [M8]: … and main\'s second move')
}

// ═════════════════════════════════════════════════════════════════════════════
// leg (i) — two conflicted paths, one block per path, concatenated in order
// ═════════════════════════════════════════════════════════════════════════════
{
  const fx = newCase('i-twopath', {
    mainMoves: MOVES.conflictAC, runEdits: RUN_EDITS.ac2, tasks: [TASK_AC],
  })
  const stub = stubAgent(() => RESOLVED_H1())
  await publishFold(opts(fx, 1), { exec: recorder(), rename: renameSpy(), makeAgent: stub.makeAgent })

  const index = JSON.parse(
    fs.readFileSync(path.join(fx.kernelWaves, 'wave-1', 'conflicts.json'), 'utf8'))
  assert.deepEqual(index.map((e) => e.path), ['a.txt', 'c.txt'],
    'leg (i) [M4]: the kernel narrated a.txt and c.txt, in that order')
  assert.equal(stub.dispatches.length, 2,
    'leg (i) [M4]: the resolver is dispatched exactly twice, once per `i` in conflicts.json')
  assert.deepEqual(stub.dispatches.map((d) => String(d.label).split(':')[3]),
    index.map((e) => String(e.i)),
    'leg (i) [M4]: once per `i`, the kernel\'s own indices — got ' +
    stub.dispatches.map((d) => d.label).join(', '))

  for (const [n, d] of stub.dispatches.entries()) {
    const heads = [...d.prompt.matchAll(new RegExp(HEADING.slice(1), 'g'))].map((m) => m.index)
    assert.equal(heads.length, 2,
      'leg (i) [M4]: dispatch ' + (n + 1) + '\'s prompt carries one CONTENDING TASKS: heading per conflicted path')
    const ours = d.prompt.indexOf(taskEntry(RUN, TASK_AC))
    assert.ok(ours > 0 && ours < heads[1],
      'leg (i) [M4]: a.txt\'s block comes first — its `- run ' + RUN + ' task ` entry precedes the second heading')
    assert.equal(d.prompt.slice(heads[1]).includes('- run 3'), false,
      'leg (i) [M4]: and no `- run 3` line follows that second heading — run 3\'s T1 names only a.txt')
  }

  const a1 = att(fx, 1)
  assert.equal(a1.disposition, 'folded', 'leg (i) [M4]: both conflicts resolved, the fold continues')
  assert.equal(a1.resolversDispatched, 2, 'leg (i) [M4]: resolversDispatched 2')
  assert.equal(lastFoldEvent(fx).pathsConflicted, 2, 'leg (i) [M7]: the event carries pathsConflicted 2')
  assert.equal(git(['show', a1.candidate + ':c.txt'], fx.target) + '\n', RESOLVED_C,
    'leg (i) [M4]: the candidate\'s c.txt carries the stub\'s h1 content at line 2')
  assert.equal(git(['show', a1.candidate + ':a.txt'], fx.target) + '\n', RESOLVED_A,
    'leg (i) [M4]: and a.txt the same, with main\'s eleventh line')
}

console.log('ALL TESTS PASSED')
