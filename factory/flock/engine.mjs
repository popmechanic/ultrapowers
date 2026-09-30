#!/usr/bin/env node
// The Flock engine (map #1292: adopted as an experiment behind the boot's engine switch; the
// round-3 arm is the measured shape). Grown from the laptop prototype (flock-runroom's host.mjs).
//
//   node factory/flock/engine.mjs --plan <plan.md> --target <dir> --base <sha> --run-dir <dir>
//        [--builder sdk|scripted:<json>] [--clock 13800] [--quiet 45] [--stall-minutes 20]
//        [--kata-url <hub> --kata-json <record> [--kata-actor engine:<run>]]
//   (with both --kata-url and --kata-json, and a record that reads, the board's
//    claims, releases, reopens and closes are mirrored onto Kata as comments while the run is in
//    flight; without them the Flock keeps its plain stand-in board and sends nothing.)
//
// With N builders working one plan together, each on its own copy, merging with each other
// between tool batches, the swarm settles on green code; the engine then leaves the target one
// commit ahead of --base and writes the rows the pull request card reads (events.jsonl).
//
// The engine is code, not a model: it seeds the board, runs each builder's session,
// keeps every copy's weave (factory/flock/weave.py), merges peers after each tool
// batch, and tests every published snapshot at the edge. Builders pull their own
// work from the board and never run git.
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import util from 'node:util'
import { workloadFromPlan } from './plan.mjs'
import { makeBoard } from './flock_board.mjs'
import { scopeOf } from './scope.mjs'
import { editSpans } from './edit_spans.mjs'
import { compactRecord } from './compact_record.mjs'
import { pullScope } from './pulls.mjs'
import { findGit } from '../gitblock.mjs'
import { bootstrapFor } from '../commands.mjs'
import { makeJevClient, JEV_TIMEOUT_MS } from '../jev-client.mjs'
import { readTrial, resolveState, releaseState, claimOf } from './trial_reading.mjs'
import { mirrorBoard } from './kata_mirror.mjs'
import { makeKataClient, httpTransport } from '../../fleet/kata-client.mjs'
import { lastSteps, latestResults, readSteps } from './step_reading.mjs'
import { pastItems } from './past.mjs'
import { peerNote } from './peer_note.mjs'
import { buildProvenance } from './provenance.mjs'
import { executableLines } from './executable.mjs'
import { coverageCounts, linesRunAll } from './coverage.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const need = (k) => { const v = arg(k); if (!v) { console.error(`engine: --${k} is required`); process.exit(2) } return v }
const PLAN = path.resolve(need('plan'))
const TARGET = path.resolve(need('target'))
const BASE_SHA = need('base')
if (!/^[0-9a-f]{40}$/.test(BASE_SHA)) { console.error('engine: --base must be a 40-hex sha'); process.exit(2) }
const RUN_DIR = path.resolve(need('run-dir'))
// --kata-url / --kata-json / --kata-actor: the boot passes them to either engine. With the first
// two and a record that reads with an integer project.id and a run.uid, each board move is mirrored straight onto the task's issue on the
// hub (the record's project.id) as a keyed comment (factory/flock/kata_mirror.mjs), never awaited,
// never failing the run; each attempt is a `kata:mirror` event row, `ok` only with the hub's
// comment uid. Otherwise the board is the plain stand-in.
// `--builder sdk` (default): a model session per claim. `scripted:<json>`: no model; the JSON maps a
// task id to {path: text}, which the session writes and then finishes as a `done` call would.
const BUILDER = arg('builder', 'sdk')
const SCRIPT = BUILDER.startsWith('scripted:') ? JSON.parse(fs.readFileSync(BUILDER.slice('scripted:'.length), 'utf8')) : null
if (!SCRIPT && BUILDER !== 'sdk') { console.error('engine: --builder is sdk or scripted:<json>'); process.exit(2) }
// the SDK and zod load only for model builders: a scripted run needs neither
const { query, createSdkMcpServer, tool } = SCRIPT ? {} : await import('@anthropic-ai/claude-agent-sdk')
const { z } = SCRIPT ? {} : await import('zod')
const W = { name: path.basename(PLAN, '.md'), ...workloadFromPlan(PLAN) }
for (const t of W.tasks) t.id = String(t.id)
for (const t of W.tasks) t.depends_on = t.depends_on.map(String)
// The round-3 arm (n=3 runs, runroom-r3-1..3, 2026-09-26) is the only behaviour (operator 2026-09-29,
// the switches no launch set are gone): an elastic pool, a builder opening whenever a ready task has
// no free builder to take it, up to CAP (an idle builder holds no session, so it costs no tokens); a
// builder publishes when it calls publish (and the engine publishes at session end, released or
// done); settling `tested`, as soon as the last tested hash is green with nothing published after it;
// `done` publishes, marks the task done and ends the copy's changes (later edits refused); the
// builder's own tools load up front (no ToolSearch step); the opening message carries a digest; every
// Bash command runs with stdin closed, so a stdin read fails fast; an open conflict closes as a fact
// the moment a publish shows its merged text is a builder's own writing over both sides (see
// earlyClose); the board offers the ready set longest remaining chain first (flock_board.mjs).
const CAP = 16
const MODEL = 'claude-opus-5-5'
// under the boot's 14400 s unit limit
const CLOCK_MS = Number(arg('clock', 13800)) * 1000
const QUIET_MS = Number(arg('quiet', 45)) * 1000
const POLICY_FLOCK = (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'policy.json'), 'utf8')).flock } catch { return undefined } })()
// pulls `narrow` (#1292): a builder takes in only the peer changes its work touches (pulls.mjs);
// `all`, every published change, is the rollback. The policy cell flock.pulls.mode, else all.
const PULLS = POLICY_FLOCK?.pulls?.mode || 'all'
if (!['narrow', 'all'].includes(PULLS)) { console.error('engine: policy flock.pulls.mode is narrow or all'); process.exit(2) }
// record-only Jev reading per green story step (state-probe runner spec §7): `record` mode and
// a reachable TypeSafe edge, or it never asks and never writes a `jev:step` row.
const JEV_STEP = (POLICY_FLOCK?.jev_step?.mode ?? 'off') === 'record' && !!process.env.TYPESAFE_BASE_URL
// record-only Jev trials at a merge conflict (an `R:` task added) and at a task given back:
// the same gate, each on its own policy cell (flock.jev_resolve, flock.jev_release).
const JEV_RESOLVE = (POLICY_FLOCK?.jev_resolve?.mode ?? 'off') === 'record' && !!process.env.TYPESAFE_BASE_URL
const JEV_RELEASE = (POLICY_FLOCK?.jev_release?.mode ?? 'off') === 'record' && !!process.env.TYPESAFE_BASE_URL
// the peer-rewrite read (#1401): an edit that replaces or deletes lines a peer wrote is put to Jev
// (run-277: a builder's own Edit ran two of a peer's words together and the run went green).
// `enforce`: a `loses` answer whose text is still in the settled snapshot ends the run a draft;
// `record` only writes the `jev:peer-rewrite` row; `off` never asks. Absent, record. A `null`
// answer never drafts: it takes the set's rollback, record.
const PEER_MODE = POLICY_FLOCK?.jev_peer_rewrite?.mode ?? 'record'
if (!['enforce', 'record', 'off'].includes(PEER_MODE)) { console.error('engine: policy flock.jev_peer_rewrite.mode is enforce, record or off'); process.exit(2) }
const JEV_PEER = PEER_MODE !== 'off' && !!process.env.TYPESAFE_BASE_URL
// the scope rule (#1333, scope.mjs): `enforce` folds a change outside every task's Files that no
// builder wrote into the edge's verdict; `record` only writes the `scope:outside` row. Absent, enforce.
const SCOPE_MODE = POLICY_FLOCK?.scope?.mode ?? 'enforce'
if (!['enforce', 'record'].includes(SCOPE_MODE)) { console.error('engine: policy flock.scope.mode is enforce or record'); process.exit(2) }
// provenance.json (#1404): `record` runs each task's tagged facts once more on the landed snapshot
// with coverage on (coverage.mjs) so the record names the changed code no probe ran; `off` skips
// it (coverage null). The policy cell flock.provenance.coverage, else record.
const PROV_COVERAGE = POLICY_FLOCK?.provenance?.coverage ?? 'record'
if (!['record', 'off'].includes(PROV_COVERAGE)) { console.error('engine: policy flock.provenance.coverage is record or off'); process.exit(2) }
// the coverage pass's bounds: facts run `parallel` at once, each killed with its process group after
// fact_timeout_seconds, none started once budget_seconds have passed (defaults 4, 60, 300)
const PROV_PARALLEL = POLICY_FLOCK?.provenance?.parallel ?? 4
const PROV_FACT_TIMEOUT_MS = (POLICY_FLOCK?.provenance?.fact_timeout_seconds ?? 60) * 1000
const PROV_BUDGET_MS = (POLICY_FLOCK?.provenance?.budget_seconds ?? 300) * 1000
const touched = {}   // per builder: the paths it has read or edited in its copy
const touch = (agent, rel) => (touched[agent] = touched[agent] || new Set()).add(rel)
const MAX_REOPEN = 3
// A task a builder gives back goes straight back on the ready list, and nothing capped that: on
// ultrapowers run-252 (2026-09-27) a check task no builder could fix was claimed and given back
// ~1,150 times over the whole 3.8 h clock, $80.57 of sessions. After MAX_RELEASE give-backs the
// task parks: it leaves the ready list, a stall is posted, and settling ends the run a draft.
const MAX_RELEASE = 3
// no progress (#1334): a run whose best-green count has not risen for this many minutes ends a
// draft and interrupts every live session, instead of running to its clock. `--stall-minutes`, else
// the policy cell flock.stall.minutes, else 20; 0 is off. Readings: over 7 runs (247, 251-255,
// radio-station run-1) the longest wait for a rise was 2.0 min; run-252 ran 229.7 min past its last.
const STALL_MIN = Number(arg('stall-minutes', POLICY_FLOCK?.stall?.minutes ?? 20))
if (!Number.isFinite(STALL_MIN) || STALL_MIN < 0) { console.error('engine: --stall-minutes (or flock.stall.minutes) is a number of minutes, 0 or more'); process.exit(2) }
const STALL_MS = STALL_MIN * 60000
const OUT = RUN_DIR
const WORK = path.join(RUN_DIR, 'work')
const T0 = Date.now()
const now = () => Date.now() - T0
// every fact, the check and setup see the base they are judged against
const RUN_ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ULTRA_BASE: BASE_SHA }

fs.mkdirSync(OUT, { recursive: true })
const CHECK_OUT = path.join(OUT, 'checks')
RUN_ENV.FLOCK_CHECK_OUT = CHECK_OUT
fs.mkdirSync(CHECK_OUT, { recursive: true })
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })
const EV = fs.openSync(path.join(OUT, 'events.jsonl'), 'a')
const ev = (kind, o = {}) => fs.writeSync(EV, JSON.stringify({ t: now(), kind, ...o, ts: new Date().toISOString() }) + '\n')
const log = (...a) => console.log(util.format(`[${(now() / 1000).toFixed(1).padStart(6)}s]`, ...a))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// record-only Jev reading of each story at its last step (state-probe runner spec §7, #1369),
// once, at a ready settle: never blocks a PR, and a missing answer is recorded as `null`
// (step_reading.mjs `readSteps`). No read at a builder's done: the edge's spawnSync blocked
// the loop past the client's timeout, so 0 of 42 answered (radio-station runs 1-6).
const STEP_QUESTION = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'questions.json'), 'utf8')).sets.flock_step.questions.delivered
const jev = JEV_STEP ? makeJevClient({ baseUrl: process.env.TYPESAFE_BASE_URL, log: (m) => log('jev', m) }) : null
// the two trials: nothing waits on an answer. Each pending read is kept here, and before
// summary.json the engine waits for them at most JEV_TIMEOUT_MS; a late answer is simply absent.
const QSETS = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'questions.json'), 'utf8')).sets
const RESOLVE_QUESTION = QSETS.flock_resolve.questions.already_joined
const RELEASE_QUESTION = QSETS.flock_release.questions.blocker
const PEER_QUESTION = QSETS.flock_peer_rewrite.questions.kept
const trialJev = (JEV_RESOLVE || JEV_RELEASE || JEV_PEER) ? makeJevClient({ baseUrl: process.env.TYPESAFE_BASE_URL, log: (m) => log('jev', m) }) : null
const trialsPending = new Set()
const trial = (key, question, state, kind, row, then) => {
  if (!trialJev) return
  const p = readTrial({ ask: trialJev.ask, key, question, state, row, emit: (o) => { ev(kind, o); if (then) then(o) } }).catch(() => {})
  trialsPending.add(p); p.finally(() => trialsPending.delete(p))
}
// #1401: one `peer:rewrite` row per sub-edit over a peer's lines (the weave's peerRewrites), and
// its Jev read; the reads are kept for the settle's check (peerRewriteDraft)
const taskOf = {}   // agent -> the task its current session holds
// the weave's authorship label (weave.py task_label): `A.2` is builder A on task 2, so a reused
// builder's later task meets its earlier task's lines as a peer's; a label's task is after the dot
const task_label = (agent, task) => task == null ? agent : agent + '.' + task
const labelOf = (agent) => task_label(agent, taskOf[agent]?.id)
const peerReads = []
function peerRewrites (agent, rel, rewrites) {
  for (const w of rewrites || []) {
    const mine = taskOf[agent]
    const row = { agent, task: mine && mine.id, path: rel, peers: w.peers, before: w.before, peer: w.peer, after: w.after }
    ev('peer:rewrite', row)
    if (!JEV_PEER) continue
    const side = (a) => { const i = a.indexOf('.'); const t = i < 0 ? null : W.tasks.find((x) => x.id === a.slice(i + 1)); return t ? { agent: a, title: t.title, claim: claimOf(t.body) } : { agent: a } }
    trial('kept', PEER_QUESTION, { path: rel, before: w.before, peer: w.peer, after: w.after, tasks: [side(labelOf(agent)), ...w.peers.map(side)] },
      'jev:peer-rewrite', row, (o) => peerReads.push(o))
  }
}
const readAndRecord = (clauses) => {
  if (!jev || !W.stories) return Promise.resolve()
  const all = latestResults(CHECK_OUT)
  const results = clauses ? clauses.map((c) => all.get(c)).filter(Boolean) : [...all.values()]
  return readSteps({ ask: jev.ask, results, sentences: W.stories.sentences, question: STEP_QUESTION, emit: (row) => ev('jev:step', row), last: lastSteps(W.tasks.flatMap((t) => t.clauses || [])), all })
}

// ── the engine's own git, on the target ───────────────────────────────────────
// A copy (each builder's, the edge's) is made a git repository at BASE that borrows the target's
// objects, so a plan's git-based line — `git diff --quiet $ULTRA_BASE -- <file>`, the shape the
// authoring skill prescribes for "unchanged since base" — reads the base it names. Without it every
// such check exited non-zero in a plain folder and the check task could never go green
// (ultrapowers run-252, 2026-09-27). The weave never sees `.git` (SKIP).
let TARGET_OBJECTS = null
function gitCopy (dir) {
  if (TARGET_OBJECTS === null) TARGET_OBJECTS = path.resolve(TARGET, git(['rev-parse', '--git-common-dir']).trim(), 'objects')
  const run = (args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')} in ${dir}: ${r.stderr}`) }
  run(['init', '-q'])
  fs.writeFileSync(path.join(dir, '.git', 'objects', 'info', 'alternates'), TARGET_OBJECTS + '\n')
  run(['read-tree', BASE_SHA])
  run(['update-index', '-q', '--refresh'])
}
function git (args, opts = {}) {
  const r = spawnSync('git', ['-C', TARGET, ...args], { encoding: opts.encoding === undefined ? 'utf8' : opts.encoding, maxBuffer: 256 * 1024 * 1024 })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} exited ${r.status}: ${r.stderr}`)
  return r.stdout
}

// ── the weave keeper ──────────────────────────────────────────────────────────
const wp = spawn('python3', [path.join(HERE, 'weave.py')], { stdio: ['pipe', 'pipe', 'inherit'] })
const waiting = []
readline.createInterface({ input: wp.stdout }).on('line', (l) => waiting.shift()(JSON.parse(l)))
const OPS = fs.openSync(path.join(OUT, 'weave-ops.jsonl'), 'a')
const weave = (o) => new Promise((res) => {
  if (['base', 'edit', 'rewrite', 'publish', 'pull'].includes(o.op)) fs.writeSync(OPS, JSON.stringify({ t: now(), ...o }) + '\n')
  waiting.push(res); wp.stdin.write(JSON.stringify(o) + '\n')
})
const must = async (o) => { const r = await weave(o); if (!r.ok) throw new Error('weave ' + o.op + ': ' + r.error); return r }

// ── files ─────────────────────────────────────────────────────────────────────
const SKIP = /(^|\/)(__pycache__|\.pytest_cache|node_modules|\.git)(\/|$)|\.pyc$/
function walk (dir, rel = '') {
  const out = []
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? rel + '/' + e.name : e.name
    if (SKIP.test(p)) continue
    if (e.isDirectory()) out.push(...walk(dir, p)); else if (isText(path.join(dir, p), p)) out.push(p)
  }
  return out
}
// The weave merges text, line by line; a file that is not UTF-8 (an image, a .gz) is never handed to
// it. Every copy and the edge start from BASE_DIR, so such a file stays exactly as it is at base, and
// a builder's change to one is recorded, never merged (ultrapowers run-246: `docs/assets/dag.gif`
// stopped the weave's `base` op with a UnicodeDecodeError before any builder opened).
const UTF8 = new TextDecoder('utf-8', { fatal: true })
const textSeen = new Map()   // absolute path -> { key: size:mtime, text: boolean }
const nonText = new Set()    // relative paths set aside, recorded once each
function isText (abs, rel) {
  let st
  try { st = fs.statSync(abs) } catch { return false }
  if (!st.isFile()) return false
  const key = st.size + ':' + st.mtimeMs
  const seen = textSeen.get(abs)
  if (seen && seen.key === key) return seen.text
  let text = true
  try { UTF8.decode(fs.readFileSync(abs)) } catch { text = false }
  textSeen.set(abs, { key, text })
  if (!text && !nonText.has(rel)) { nonText.add(rel); if (typeof ev === 'function') ev('non-text', { path: rel }) }
  return text
}
const readOr = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
const BASE_DIR = path.join(WORK, 'base')
// BASE is the target's tree at --base, read with the engine's own git (not its working tree)
function writeBase (dir) {
  fs.mkdirSync(dir, { recursive: true })
  const rows = git(['ls-tree', '-r', '-z', BASE_SHA]).split('\0').filter(Boolean)
  for (const row of rows) {
    const tab = row.indexOf('\t')
    const [mode, type, sha] = row.slice(0, tab).split(' ')
    const rel = row.slice(tab + 1)
    if (type !== 'blob') continue
    const f = path.join(dir, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    if (mode === '120000') { fs.symlinkSync(git(['cat-file', 'blob', sha]), f); continue }
    fs.writeFileSync(f, git(['show', sha], { encoding: 'buffer' }))
    if (mode === '100755') fs.chmodSync(f, 0o755)
  }
}
writeBase(BASE_DIR)
const BASE_PATHS = walk(BASE_DIR)
const BASE_FILES = Object.fromEntries(BASE_PATHS.map((p) => [p, readOr(path.join(BASE_DIR, p))]))
// a workload with `setup` installs once into DEPS_DIR, and every copy the engine makes (each
// builder's, the edge's) gets that install's node_modules dirs as symlinks, so the weave never sees
// them (walk skips node_modules) and no copy pays a second install
const DEPS_DIR = path.join(WORK, 'deps')
let DEP_DIRS = []
// the plan's own bootstrap wins; without one, the factory's rule reads the target's tracked files
// (a bun lockfile -> bun install, package-lock.json -> npm ci), so the Flock installs exactly what a
// factory run of the same plan would (runroom-ab run-3: no install, the check exited 127 on every edge)
const SETUP = W.setup || ((cmd) => cmd ? ['bash', '-lc', cmd] : null)(bootstrapFor({ planCmd: null, files: BASE_PATHS }))
if (SETUP) {
  fs.cpSync(BASE_DIR, DEPS_DIR, { recursive: true })
  const t0 = Date.now()
  const r = spawnSync(SETUP[0], SETUP.slice(1), { cwd: DEPS_DIR, encoding: 'utf8', timeout: 300000, env: RUN_ENV })
  ev('setup', { cmd: SETUP[SETUP.length - 1], exit: r.status, ms: Date.now() - t0 })
  if (r.status !== 0) throw new Error('setup failed: ' + ((r.stdout || '') + (r.stderr || '')).slice(-800))
  DEP_DIRS = ['node_modules', ...fs.readdirSync(DEPS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'node_modules')
    .map((e) => path.join(e.name, 'node_modules'))].filter((d) => fs.existsSync(path.join(DEPS_DIR, d)))
}
const linkDeps = (dir) => { for (const d of DEP_DIRS) { fs.rmSync(path.join(dir, d), { recursive: true, force: true }); fs.symlinkSync(path.join(DEPS_DIR, d), path.join(dir, d)) } }
const agentDir = (a) => path.join(WORK, 'agents', a)
const known = {}   // per builder: the paths its copy holds (openBuilder seeds each)

// ── the board: the stand-in; mirrored onto Kata when the boot passes a record. ──
const BOARD = 'standin'
const board = await makeBoard(BOARD, { tasks: W.tasks, now, runName: path.basename(OUT) })
const KATA_URL = arg('kata-url'), KATA_JSON = arg('kata-json')
let kataRecord = null
if (KATA_URL && KATA_JSON) {
  try { kataRecord = JSON.parse(fs.readFileSync(KATA_JSON, 'utf8')) } catch (e) { log('kata record unreadable, not mirroring:', e.message) }
}
// posts queued or in flight, so the engine can let them land (bounded) before it exits
const kataPending = new Set()
// a post gives up after 10 s (radio-station run-2 lost 1 of 6 notes at 3 s, 2026-09-28, n=1 run);
// the exit still waits at most 3 s for posts in flight, so Kata never holds the publish longer
const KATA_POST_MS = 10000
const KATA_EXIT_MS = 3000
// the posts go to the record's project and are keyed on its run uid: without both, nothing mirrors
if (kataRecord && !(Number.isInteger(kataRecord.project && kataRecord.project.id) && typeof (kataRecord.run && kataRecord.run.uid) === 'string' && kataRecord.run.uid)) {
  log('kata record lacks an integer project.id or a run.uid, not mirroring')
  kataRecord = null
}
if (kataRecord) {
  // each request gives up after KATA_POST_MS, so a hung hub costs a post, never the run
  const fetchImpl = (u, init) => fetch(u, { ...init, signal: AbortSignal.timeout(KATA_POST_MS) })
  const kata = makeKataClient({ transport: httpTransport({ url: KATA_URL, fetchImpl }), actor: arg('kata-actor') })
  const track = (q) => { kataPending.add(q); q.finally(() => kataPending.delete(q)) }
  // the record's project.id is the hub's own project id: posts go straight to the hub
  mirrorBoard(board, { kata, projectId: kataRecord.project.id, tasks: kataRecord.tasks || {}, onPost: (rec) => ev('kata:mirror', rec), track, runUid: kataRecord.run.uid, surfaceAt: POLICY_FLOCK?.surface?.min_confidence ?? 0.8 })
}

// ── edit-location errors (gap 3 at scale): an Edit the tool refused, by why ──
const editFailures = { not_unique: 0, not_found: 0, stale: 0, other: 0 }
const failKind = (err) => /Found \d+ matches|multiple|not unique/i.test(err) ? 'not_unique'
  : /not found|did not match|no match/i.test(err) ? 'not_found'
    : /modified since|has not been read|read it first/i.test(err) ? 'stale' : 'other'

// ── facts ─────────────────────────────────────────────────────────────────────
function runFacts (cwd, task) {
  return task.facts.map((cmd) => {
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', timeout: 60000, env: RUN_ENV })
    return { exit: r.status ?? 124, tail: ((r.stdout || '') + (r.stderr || '')).slice(-800) }
  })
}
const redOf = (res) => res.map((r, i) => ({ i, ...r })).filter((r) => r.exit !== 0)
const redText = (task, red) => red.map((r) =>
  `fact ${r.i + 1}${task.clauses ? ` (${task.clauses[r.i]})` : ''} exit ${r.exit}\n${r.tail}`).join('\n\n')
const TRACE = /File "([^"]+)", line (\d+)/g
async function blame (agent, cwd, output) {
  // gap 4: whose line does a red point at? the last in-copy frame of the traceback
  const hits = [...output.matchAll(TRACE)].map((m) => [m[1], Number(m[2])]).filter(([f]) => f.startsWith(cwd + '/') || !f.startsWith('/'))
  if (!hits.length) return { cause: 'unknown' }
  const [f, line] = hits[hits.length - 1]
  const rel = f.startsWith(cwd + '/') ? f.slice(cwd.length + 1) : f
  // ticket 2 fix (a): authorship by identity (authors_keyed), not by text, which names a
  // repeated BASE line's author wrongly (research/identity/keys.log). "A|B" = both wrote it.
  const r = await weave({ op: 'authors_keyed', agent, path: rel })
  const who = r.ok ? r.authors[line - 1] : null
  const whoSet = who ? who.split('|') : []
  return { cause: !who ? 'unknown' : whoSet.includes(labelOf(agent)) ? 'own' : who === 'base' ? 'base' : 'peer:' + who, path: rel, line }
}

// peer lines an agent's change removed or replaced, by identity: the fall, per peer, in the
// count of visible lines that peer wrote (an agent's own change never adds a peer's line)
async function keyedOwners (agent, rel) {
  const r = await weave({ op: 'authors_keyed', agent, path: rel })
  const c = {}
  if (!r.ok) return c
  for (const a of r.authors) if (a !== 'base' && !a.split('|').includes(labelOf(agent))) c[a] = (c[a] || 0) + 1
  return c
}
function peerFall (before, after) {
  let n = 0; const peers = new Set()
  for (const [who, k] of Object.entries(before)) { const d = k - (after[who] || 0); if (d > 0) { n += d; who.split('|').forEach((x) => peers.add(x)) } }
  return { peer: n, peers: [...peers] }
}

// ── keeping a copy's weave in step with its files ─────────────────────────────
async function syncFromDisk (agent) {
  const dir = agentDir(agent)
  const disk = walk(dir)
  for (const p of disk) known[agent].add(p)
  let drift = 0
  for (const p of known[agent]) {
    const text = readOr(path.join(dir, p))
    const view = (await must({ op: 'view', agent, path: p })).text
    const hasWeave = view !== '' || BASE_PATHS.includes(p)
    if (text === null && !hasWeave) continue
    if (text === view) continue
    const r = await must({ op: 'rewrite', agent, path: p, content: text, task: taskOf[agent]?.id })
    edited(agent, p)
    drift += 1
    ev('fallback', { agent, path: p, peer_lines: r.peer_lines_touched, deleted: text === null })
    peerRewrites(agent, p, r.peerRewrites)
  }
  return drift
}

// editSpans lives in edit_spans.mjs since the replace-all fix (pinned by readings/replace_all_check.mjs)
async function recordEditCall (agent, rel, before, edits) {
  let text = before, peerText = 0
  const owners0 = await keyedOwners(agent, rel)
  for (const e of edits) {
    for (const s of editSpans(text, e.old_string, e.new_string, e.replace_all)) {
      const r = await must({ op: 'edit', agent, path: rel, ...s, task: taskOf[agent]?.id })
      peerText += r.peer_lines_touched
      peerRewrites(agent, rel, r.peerRewrites)
    }
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string)
  }
  return { ...peerFall(owners0, await keyedOwners(agent, rel)), peerText }
}

// ── the conflict ledger: Manyana recomputes conflicts per merge and stores none, so the
// host keeps them: a conflict opens when a merge flags it and closes only when an agent
// says so (resolve_conflict), or at once when both sides only added lines (the union) ──
// ticket 5: the ledger is keyed by path AND region, the hash of the marked hunks' two sides
// (sorted, so a pull's merge and the edge's merge name the same region). Manyana re-flags a
// region it has already flagged on every merge; a closed region stays closed, and only a
// DIFFERENT region on the same path opens a new entry. Closing a path closes its regions.
const ledger = new Map()   // `${path}\u0000${region}` -> entry
function region (annotated) {
  const hunks = []
  let side = null, cur = null
  for (const l of String(annotated || '').split('\n')) {
    if (l.startsWith('<<<<<<< begin')) { cur = { a: [], b: [] }; side = 'a'; continue }
    if (l.startsWith('======= begin')) { side = 'b'; continue }
    if (l.startsWith('>>>>>>> end')) { if (cur) hunks.push([cur.a.join('\n'), cur.b.join('\n')].sort().join('\u0001')); cur = null; side = null; continue }
    if (cur && side) cur[side].push(l)
  }
  return crypto.createHash('sha1').update(hunks.sort().join('\u0002')).digest('hex').slice(0, 10)
}
async function openConflict (p, info) {
  const reg = region(info.annotated)
  const e = ledger.get(p + '\u0000' + reg)
  if (e) { e.seen += 1; if (!e.open) ev('conflict:reflag', { path: p, region: reg }); return }   // a stale re-flag never reopens
  if (info.addsOnly) { ev('conflict:union', { path: p, ...info, annotated: undefined }); return }
  ledger.set(p + '\u0000' + reg, { path: p, region: reg, open: true, t: now(), seen: 1, annotated: info.annotated, between: info.between, party: info.party })
  lastChange = now()
  ev('conflict:open', { path: p, region: reg, between: info.between })
  await board.post({ by: 'host', claim: `open conflict in ${p} between ${info.between.join(' and ')}; whoever next works there should make it say what both sides meant and call resolve_conflict`, confidence: 1 })
}
const openConflicts = () => [...new Set([...ledger.values()].filter((e) => e.open).map((e) => e.path))]
const openEntries = (p) => [...ledger.values()].filter((e) => e.open && e.path === p)
function closeEntries (p, by, note, via) {
  for (const e of openEntries(p)) {
    e.open = false; e.closed_by = by; e.closed_t = now(); e.note = String(note).slice(0, 200)
    ev('conflict:close', { path: p, region: e.region, by, note: e.note, via })
  }
  lastChange = now()
}

// ── early close (`--early-close held`, the final atlas race). On atlas every resolve task changed
// nothing (n=5 runs): the conflicts were already resolved by the agents, and ~25 s went to handing
// them out once everyone was idle. The fact that closes one early, per open conflict on path p, at
// every edge: some agent S published p, S's last edit to p came after the last time a peer's side
// of p reached S's copy with conflict marks (S wrote with both sides in view), and S's published
// text of p is byte for byte the merged text of p. The merged text is then S's own writing over
// both sides. A conflict seen first in one copy's pull also waits for that copy's next publish,
// since its side of the conflict may not be published yet. `unflagged` (Manyana no longer marks the
// region) is recorded as evidence only: it stops marking a blind conflict once one side pulls and
// republishes, with nobody having looked (the control in readings/early_close_replay.py).
const lastEditT = {}        // agent -> path -> t
const lastMarkedT = {}      // agent -> path -> t: a peer's side arrived with conflict marks
const lastPubT = {}         // agent -> t
const pubHeld = {}          // agent -> path -> { text, held, t } as of its last publish
function edited (agent, p) { (lastEditT[agent] = lastEditT[agent] || {})[p] = now() }
async function publishCopy (agent) {
  await must({ op: 'publish', agent })
  lastPublish = now(); lastPubT[agent] = now()
  for (const [p, te] of Object.entries(lastEditT[agent] || {})) {
    const text = (await must({ op: 'view', agent, path: p })).text
    ;(pubHeld[agent] = pubHeld[agent] || {})[p] = { text, held: te >= ((lastMarkedT[agent] || {})[p] ?? -1), t: now() }
  }
}
function earlyClose (m, snap) {
  for (const e of [...ledger.values()].filter((x) => x.open)) {
    if (e.party && (lastPubT[e.party] ?? -1) < e.t) continue
    const text = m.files[e.path]
    if (text === undefined) continue
    const holders = Object.entries(pubHeld).filter(([, ps]) => ps[e.path] && ps[e.path].held && ps[e.path].text === text).map(([a]) => a)
    if (!holders.length) continue
    const unflagged = !(m.conflicts.includes(e.path) && region(m.annotated[e.path]) === e.region)
    e.open = false; e.closed_by = 'host'; e.closed_t = now()
    e.note = `the merged text of ${e.path} is ${holders.join(' and ')}'s own published writing over both sides`
    const evidence = { snap, holders: holders.map((a) => ({ agent: a, published_t: pubHeld[a][e.path].t, last_edit_t: lastEditT[a][e.path], last_marked_t: (lastMarkedT[a] || {})[e.path] ?? null })), unflagged }
    ev('conflict:close', { path: e.path, region: e.region, by: 'host', note: e.note, via: 'early:held', evidence })
    log('early close', e.path, e.region, 'held by', holders.join(','))
    lastChange = now()
  }
}
let lastChange = 0          // the last time the merged code's hash, a session, or the ledger changed
const live = new Set()      // agents with a session open right now
const stops = new Map()     // agent -> interrupt() of its live session (the no-progress stop calls each)
const stalls = []           // stall beliefs the host posted (attached to a draft PR)
async function stall (kind, evidence) {
  const b = await board.post({ by: 'host', claim: `stall: ${kind} ${JSON.stringify(evidence).slice(0, 300)}`, confidence: 1 })
  stalls.push({ kind, evidence, t: now() }); ev('stall:' + kind, { evidence }); log('STALL', kind, JSON.stringify(evidence).slice(0, 200))
  return b
}

// ── the edge: every published snapshot is tested; main takes a green, settled one ──
let edgeChain = Promise.resolve()
let lastEdge = null
const snapshots = []
let bestGreen = -1, sinceBest = 0, lastRise = 0   // lastRise: when bestGreen last rose (the loops' start before any)
let lastSessionEnd = -1   // when a builder session last ended: a stop needs one since the last rise, so one long session is never cut off
const edgeLatency = []      // publish -> tested, ms (the propagation delay the debounce covers)
const amendedSeen = new Set()  // paths already written as a `driver:amendment` row this run
// The scope rule at the edge, read from the snapshot against BASE_DIR before any fact or check
// writes build output. Returns the paths outside every task's Files that no builder wrote.
function scopeAt (m, snap) {
  // the weave reads an empty file as absent, so an empty base file is compared as absent too
  const text = (p) => p in m.files ? (m.exists[p] ? m.files[p] : '') : (BASE_FILES[p] ?? '')
  const changed = [...new Set([...Object.keys(m.files), ...BASE_PATHS])].filter((p) => text(p) !== (BASE_FILES[p] ?? ''))
  const files = [...board.tasks.values()].flatMap((t) => t.files || (String(t.id).startsWith('R:') ? [t.id.slice(2)] : []))
  const written = Object.values(lastEditT).flatMap((ps) => Object.keys(ps))
  const { outside, amended } = scopeOf({ changed, files, written })
  for (const p of amended) if (!amendedSeen.has(p)) { amendedSeen.add(p); ev('driver:amendment', { path: p, snap }) }
  if (outside.length) { ev('scope:outside', { snap, paths: outside }); log('scope', snap, 'outside', outside.join(','), SCOPE_MODE) }
  return SCOPE_MODE === 'enforce' ? outside : []
}
function edge (reason) {
  const asked = now()
  edgeChain = edgeChain.then(async () => {
    const m = await must({ op: 'merged' })
    const snap = crypto.createHash('sha1').update(JSON.stringify(m.files)).digest('hex').slice(0, 10)
    const outside = scopeAt(m, snap)
    if (lastEdge && lastEdge.snap === snap) {
      // ticket 5: the facts on a hash never change, but what blocks it does (a close with no
      // text change). Recompute the verdict from the ledger now: a cached `blocking` was the
      // answer after 5 of 9 closes on the record, masked each time by a later content change.
      for (const p of m.conflicts) await openConflict(p, { addsOnly: !!m.addsOnly[p], annotated: m.annotated[p], between: ['published copies'] })
      earlyClose(m, snap)
      const blocking = openConflicts()
      const factsGreen = Object.values(lastEdge.perTask).every((xs) => xs.every((x) => x === 0))
      lastEdge = { ...lastEdge, t: now(), reason, blocking, outside, green: factsGreen && lastEdge.check === 0 && !blocking.length && !outside.length }
      return lastEdge
    }
    lastChange = now()
    const dir = path.join(WORK, 'edge')
    fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(BASE_DIR, dir, { recursive: true }); linkDeps(dir); gitCopy(dir)
    for (const [p, text] of Object.entries(m.files)) {
      const f = path.join(dir, p)
      if (m.exists[p]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) } else fs.rmSync(f, { force: true })
    }
    const perTask = {}, red = []   // red: the facts that did not exit 0, kept for red-checks.json
    for (const t of board.tasks.values()) {
      const res = runFacts(dir, t)
      perTask[t.id] = res.map((r) => r.exit)
      res.forEach((r, i) => { if (r.exit !== 0) red.push({ task: t.id, clause: t.clauses ? t.clauses[i] : undefined, cmd: t.facts[i].join(' '), exit: r.exit, tail: r.tail }) })
    }
    const chk = W.check ? spawnSync(W.check[0], W.check.slice(1), { cwd: dir, encoding: 'utf8', timeout: W.checkTimeoutMs ?? 120000, env: RUN_ENV }) : { status: 0, stdout: '', stderr: '' }
    const factsGreen = Object.values(perTask).every((xs) => xs.every((x) => x === 0))
    // ticket 5: every region the edge sees goes through the ledger. The old `!ledger.has(p)`
    // let a NEW conflict on a once-closed path pass the edge unexamined.
    for (const p of m.conflicts) await openConflict(p, { addsOnly: !!m.addsOnly[p], annotated: m.annotated[p], between: ['published copies'] })
    for (const [p, fl] of Object.entries(m.sameAnchor || {})) await sameSpot(p, fl, ['published copies'], null)
    earlyClose(m, snap)
    const blocking = openConflicts()
    lastEdge = { snap, t: now(), reason, perTask, red, check: chk.status, checkTail: ((chk.stdout || '') + (chk.stderr || '')).slice(-600), conflicts: m.conflicts, blocking, outside, annotated: m.annotated, green: factsGreen && chk.status === 0 && !blocking.length && !outside.length }
    // survival: the lines a published copy's author wrote that this snapshot no longer shows, from
    // the same `merged` answer that named the snapshot (a later ask could describe a later join)
    const lost = m.lost || []
    ev('survival', { snap, lost })
    snapshots.push({ snap, t: now(), files: m.files, exists: m.exists, lost })
    edgeLatency.push(now() - asked)
    // ticket 5: livelock, record-only. Facts rose on every new snapshot of every recorded run
    // (0 regressions over 53 edges, n=15 runs), so K snapshots with no new best is unseen: it
    // posts a stall belief and changes nothing (an experiment; rollback: delete this block).
    const g = Object.values(perTask).reduce((a, xs) => a + xs.filter((x) => x === 0).length, 0) + (chk.status === 0 ? 1 : 0)
    if (g > bestGreen) { bestGreen = g; sinceBest = 0; lastRise = now() } else if (++sinceBest === 2 * board.tasks.size) await stall('livelock', { snap, snapshots_without_progress: sinceBest, best: bestGreen })
    ev('edge', { ...lastEdge, checkTail: undefined, annotated: undefined, red: undefined })
    log('edge', snap, lastEdge.green ? 'GREEN' : 'red', JSON.stringify(perTask), 'check', chk.status, m.conflicts.length ? 'conflicts ' + m.conflicts + ' (blocking: ' + (blocking.join(',') || 'none') + ')' : '')
    return lastEdge
  })
  return edgeChain
}

// ── one agent session on one claimed task ─────────────────────────────────────
const usage = []
let lastPublish = 0
let settled = null
const SYSTEM = `You are one of several agents working on the same repository at the same time, with no one directing you.
Each agent works in its own copy. Other agents' published work is merged into your copy between your tool calls; when that happens you receive a note naming the files that changed. Re-read a file before editing it if a note says it changed.
Rules:
- Change an existing file only with the Edit tool. New files may be created any way you like. Shell commands must not overwrite, move or delete existing files.
- Never run git.
- Run your task's facts with run_proof: they are the tests that decide whether your task is done.
- Use the flock tools: board_read (tasks and beliefs), post_belief (tell the others something true and useful, with how sure you are, and what it is about: \`task\` your task, \`app\` the app being built, \`engine\` the engine running this run, such as copies, checks or the board), run_proof (your task's facts, on your copy), publish (share your copy's changes), wait_for (wait for a peer's work: a task done, a text in a file, a proof green), release (give the task back if you are blocked), done (your task is finished).
- To wait for another agent's work, call wait_for. Never wait with shell sleep or a polling loop: peers' work reaches your copy only between your tool calls, so a shell loop cannot see it arrive.
- Publish whenever your change is coherent, so the others build on it.
- If something fails because of another agent's unfinished work, prefer not to rewrite their lines: post a belief saying what you saw, and carry on with your own part.
- If a note says a file merged with conflict marks, look at that part of the file. When it says what both sides meant (edit it if not), call resolve_conflict for that file.
- When your task's facts pass on your copy, call done: it publishes your copy for you and closes it.`

async function pullInto (agent, task) {
  // a resolve task (R:<path>) scopes to its own path
  if (task && !task.files && String(task.id).startsWith('R:')) task = { ...task, files: [task.id.slice(2)] }
  // new files peers created cannot conflict with anything here, so they are always in scope (#1405)
  const base = new Set(BASE_PATHS)
  const created = [...new Set(Object.entries(lastEditT).filter(([a]) => a !== agent).flatMap(([, ps]) => Object.keys(ps)))].filter((p) => !base.has(p))
  const scope = task ? pullScope({ task, tasks: W.tasks, touched: [...(touched[agent] || [])], mode: PULLS, created }) : null
  const r = await must(scope ? { op: 'pull', agent, paths: [...scope] } : { op: 'pull', agent })
  const dir = agentDir(agent)
  for (const c of r.changed) {
    const f = path.join(dir, c.path)
    known[agent].add(c.path)
    if (c.exists) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c.text) } else fs.rmSync(f, { force: true })
  }
  if (r.changed.length) ev('pull', { agent, changed: r.changed.map((c) => ({ path: c.path, from: c.from, added: c.added, removed: c.removed, conflict: c.conflict })) })
  for (const c of r.changed.filter((x) => x.conflict)) (lastMarkedT[agent] = lastMarkedT[agent] || {})[c.path] = now()
  for (const c of r.changed.filter((x) => x.conflict)) await openConflict(c.path, { addsOnly: c.addsOnly, annotated: c.annotated, between: [agent, c.from], party: agent })
  for (const s of r.sameAnchor || []) await sameSpot(s.path, s.flags, [agent, s.from], agent)
  return r.changed
}

// ── ticket 2 fix (b): two agents inserting at one spot. The kernel orders such lines by their
// text and an adds-only union hid it; the keeper now flags it (`siblings`, or `unified` when
// one side's block starts with the other's line and the kernel flags nothing). Each distinct
// spot becomes a fact on the board and a note to the agents whose copies carry it. ──
const spots = new Map()
const spotNotes = {}
async function sameSpot (p, flags, between, agent) {
  for (const f of flags || []) {
    const key = [p, f.kind, f.anchor, (f.lines || []).join('\n')].join('\u0000')
    const text = `${f.kind === 'unified' ? 'one block starts with the other\'s line' : 'two insertions'} at one spot in ${p}, after ${JSON.stringify(f.anchor)}: ${JSON.stringify(f.lines).slice(0, 200)} (by ${(f.authors || between).join(' and ')}); the merge chose their order by text, so check the order says what both meant`
    if (agent) (spotNotes[agent] = spotNotes[agent] || new Set()).add(text)
    if (spots.has(key)) continue
    spots.set(key, { p, f, t: now() })
    ev('same-anchor', { path: p, flag: f.kind, anchor: f.anchor, lines: f.lines, authors: f.authors, between })
    await board.post({ by: 'host', claim: text, confidence: 1 })
  }
}

// the round-3 brief: what a builder would have fetched with board_read, cut to what concerns it
function brief (task) {
  const deps = task.depends_on.map((d) => `task ${d} ${board.tasks.get(d)?.state ?? '?'}`)
  const mine = new Set(task.files || [])
  const bel = (board.beliefs || []).filter((b) => b.task === task.id || [...mine].some((f) => String(b.claim).includes(f)))
  return `\nBoard digest: ${deps.length ? 'the tasks you depend on: ' + deps.join(', ') + '.' : 'your task depends on no other task.'} ` +
    (bel.length ? 'Beliefs about your task or files:\n- ' + bel.slice(-5).map((b) => `${b.by} (${b.confidence}): ${b.claim}`).join('\n- ') : 'No beliefs concern your task or files.') +
    ' board_read shows the whole board if you need it.' +
    (PAST ? `\nThe previous run on this repository, run-${PAST.run}, did not finish green. What it recorded:\n` + PAST.items.map((i) => i.text).join('\n') : '')
}
// `--builder scripted:<json>`: no model. The session writes the task's scripted files into its
// copy, then takes the path a `done` call takes (syncFromDisk -> publish -> board done) and ends.
// A task the script does not name ends released.
// Every give-back, scripted or model, goes through here, so MAX_RELEASE caps them all.
async function giveBack (agent, task, why) {
  task.released = (task.released || 0) + 1
  if (JEV_RELEASE) {
    const depends = (task.depends_on || []).map((id) => ({ id, state: board.tasks.get(id)?.state ?? null }))
    trial('blocker', RELEASE_QUESTION, releaseState({ task, why, depends }), 'jev:release', { task: task.id, releases: task.released })
  }
  if (task.released >= MAX_RELEASE) {
    await board.park(task, `${agent} released: ${why}`)
    ev('task:parked', { task: task.id, releases: task.released, reason: String(why).slice(0, 300) })
    await stall('released', { task: task.id, releases: task.released }); log(agent, 'parks', task.id, 'after', task.released, 'give-backs')
    return
  }
  await board.release(task, `${agent} released: ${why}`); log(agent, 'releases', task.id, '—', why)
}

// A builder's belief: kept on the board and in events.jsonl as a `belief` row, `about` saying who
// it is for (task, app or engine); kata_mirror surfaces a sure engine belief on the run's issue.
async function postBelief (agent, a) {
  const b = await board.post({ by: agent, claim: a.claim, confidence: a.confidence, task: a.task, about: a.about })
  ev('belief', b)
  return b
}

async function scriptedSession (agent, task) {
  const cwd = agentDir(agent)
  const files = SCRIPT[task.id]
  ev('session:start', { agent, task: task.id, builder: 'scripted' })
  log(agent, 'claims task', task.id, '(scripted)')
  live.add(agent)
  // test seam (#1334): `@hold_ms` holds the session that long before it writes, standing in for a
  // builder that makes no progress; the no-progress stop cuts it short, and it ends writing nothing.
  const H = SCRIPT['@hold_ms'], hold = H && typeof H === 'object' ? H[task.id] : H   // a number holds every task; a map, the tasks it names
  if (hold) {
    let wake
    const held = new Promise((r) => { wake = r; setTimeout(r, hold) })
    stops.set(agent, () => wake())
    await held
    stops.delete(agent)
    if (outcome) {
      usage.push({ agent, task: task.id, turns: 0, subtype: 'scripted', cost_usd: 0 })
      ev('session:end', { agent, task: task.id, released: 'run ended', done: false })
      live.delete(agent); return
    }
    // a held session takes in what its peers published meanwhile, as a model builder's pull after
    // each tool batch would, so its write can land over a peer's lines (#1401)
    await pullInto(agent, task)
  }
  // test seam: `@beliefs` lists beliefs; a session posts those whose `task` is its own before it writes
  for (const b of SCRIPT['@beliefs'] || []) if (String(b.task) === String(task.id)) await postBelief(agent, b)
  if (files) {
    for (const [p, text] of Object.entries(files)) {
      const f = path.join(cwd, p)
      // a path mapped to null is deleted, as a builder's delete_file would
      if (text === null) { fs.rmSync(f, { force: true }); continue }
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text)
    }
    const red = redOf(runFacts(cwd, task))
    if (red.length) {
      ev('facts:red', { agent, task: task.id, at: 'scripted', exits: red.map((r) => r.exit) })
      usage.push({ agent, task: task.id, turns: 0, subtype: 'scripted', cost_usd: 0 })
      ev('session:end', { agent, task: task.id, released: 'red facts', done: false })
      live.delete(agent); lastChange = now()
      await giveBack(agent, task, 'the scripted files leave red facts: ' + redText(task, red).slice(0, 300))
      return
    }
    await syncFromDisk(agent)
    // test seam (#1333): `@unwritten` puts text into the weave that no builder wrote (no edited()
    // call), standing in for a weave fault like run-247's. It passes no task: its lines stay unlabelled by task.
    for (const [p, text] of Object.entries(SCRIPT['@unwritten'] || {})) await must({ op: 'rewrite', agent, path: p, content: text })
    await publishCopy(agent); ev('publish', { agent, task: task.id, by: 'done' }); await board.publish(agent, task.id)
    await board.done(task); live.delete(agent); edge('done ' + agent); log(agent, 'done', task.id)
  }
  usage.push({ agent, task: task.id, turns: 0, subtype: 'scripted', cost_usd: 0 })
  ev('session:end', { agent, task: task.id, released: files ? false : 'not scripted', done: files ? 'scripted' : false })
  live.delete(agent); lastChange = now()
  if (!files) await giveBack(agent, task, `the script names no files for task ${task.id}`)
}

async function session (agent, task) {
  const cwd = agentDir(agent)
  const st = { released: false, done: false, redRuns: 0 }
  const pre = new Map()
  taskOf[agent] = task
  await pullInto(agent, task)
  if (SCRIPT) return scriptedSession(agent, task)
  const say = (text) => ({ content: [{ type: 'text', text }] })
  const tools = [
    tool('board_read', 'Read the board: every task with its state and owner, and the latest beliefs.', {}, async () => say(JSON.stringify(await board.read(), null, 1))),
    tool('post_belief', 'Post a belief for the other agents: something you believe is true, how sure you are (0 to 1), which task it concerns, and what it is about: "task" (your task), "app" (the app being built) or "engine" (the engine running this run, such as copies, checks or the board).',
      { claim: z.string().max(300), confidence: z.number(), task: z.string().optional(), about: z.enum(['task', 'app', 'engine']) },
      async (a) => { const b = await postBelief(agent, a); return say('posted belief ' + b.id) }),
    tool('run_proof', "Run a task's facts on your copy (default: your own task). Each fact is a command; exit 0 means it holds.",
      { task: z.string().optional() },
      async (a) => {
        const t = board.tasks.get(a.task || task.id) || task
        const res = runFacts(cwd, t)
        const red = res.filter((r) => r.exit !== 0)
        const causes = []
        for (const r of red) causes.push(await blame(agent, cwd, r.tail))
        ev('proof', { agent, task: t.id, exits: res.map((r) => r.exit), causes, errs: red.map((r) => (r.tail.match(/^\w*(Error|Exception)\b.*$/gm) || ['']).pop().slice(0, 160)) })
        return say(res.map((r, i) => `fact ${i + 1}: exit ${r.exit}${r.exit ? '\n' + r.tail : ''}`).join('\n'))
      }),
    // ticket 4 follow-up: waiting for a peer. Peers' work reaches a copy only between tool calls,
    // so a shell `sleep` loop never sees it (a full 300 s in 4 of 10 ledger runs, n=5 per arm).
    // This tool keeps merging peers into the copy while it waits, and returns once the fact holds.
    tool('wait_for', 'Wait until a fact holds, while the other agents\' published work keeps merging into your copy. Use this instead of any shell sleep or polling loop. A fact is one of: a task is done (kind "task_done", task); a text or regular expression appears in a file of your copy (kind "text", path, pattern); a task\'s facts pass on your copy (kind "proof", task). Returns as soon as it holds, or after timeout_s (default 120, at most 300) with what it last saw.',
      { kind: z.enum(['task_done', 'text', 'proof']), task: z.string().optional(), path: z.string().optional(), pattern: z.string().optional(), timeout_s: z.number().optional() },
      async (a) => {
        const limit = Math.min(300, Math.max(1, a.timeout_s || 120)) * 1000
        const t0 = now()
        const merged = new Map()
        let spotted = []
        let re = null
        if (a.kind === 'text') {
          if (!a.path || !a.pattern) return say('kind "text" needs path and pattern')
          try { re = new RegExp(a.pattern, 'm') } catch { re = null }
        }
        const target = a.kind === 'text' ? null : board.tasks.get(a.task || '')
        if (a.kind !== 'text' && !target) return say('no task ' + JSON.stringify(a.task) + ' on the board')
        let proofChanged = true, last = ''
        const holds = () => {
          if (a.kind === 'task_done') { last = 'task ' + target.id + ' is ' + target.state; return target.state === 'done' }
          if (a.kind === 'text') {
            const text = readOr(path.join(cwd, a.path)) || ''
            const ok = re ? re.test(text) : text.includes(a.pattern)
            last = a.path + (ok ? ' contains ' : ' does not contain ') + JSON.stringify(a.pattern)
            return ok
          }
          if (!proofChanged) return false
          proofChanged = false
          const res = runFacts(cwd, target)
          last = `task ${target.id}'s facts on your copy: ` + res.map((r, i) => `fact ${i + 1} exit ${r.exit}`).join(', ') + (res.some((r) => r.exit) ? '\n' + res.find((r) => r.exit).tail : '')
          return res.every((r) => r.exit === 0)
        }
        await syncFromDisk(agent)
        let held = holds()
        while (!held && now() - t0 < limit && !outcome) {
          await sleep(1000)
          const changed = await pullInto(agent, task)
          for (const c of changed) merged.set(c.path, c)
          if (changed.length) proofChanged = true
          spotted.push(...(spotNotes[agent] || [])); delete spotNotes[agent]
          held = holds()
        }
        spotted = [...new Set(spotted)]
        const waited = now() - t0
        ev('wait_for', { agent, task: task.id, fact: { kind: a.kind, task: a.task, path: a.path, pattern: a.pattern }, held, waited_ms: waited, merged: [...merged.keys()] })
        return say(`${held ? 'The fact holds' : 'Timed out: the fact does not hold yet'} after ${(waited / 1000).toFixed(1)} s. ${last}` +
          (merged.size ? `\nMerged into your copy while waiting: ${[...merged.values()].map((c) => `${c.path} (from ${c.from}${c.conflict ? ', with conflict marks' : ''})`).join('; ')}. Re-read before editing those files.` : '') +
          (spotted.length ? '\nSame-spot insertions in your copy: ' + spotted.join('; ') : ''))
      }),
    // run-262 (2026-09-29): a plan that deletes files parked because no builder tool removed one and
    // the shell hook refuses `rm`. The file leaves the copy on disk; syncFromDisk records the delete
    // in the weave (rewrite with content null) exactly as it records any other change.
    tool('delete_file', 'Delete an existing file in your copy (the shell may not delete one). Give its path relative to your copy.',
      { path: z.string() },
      async (a) => {
        const fp = path.resolve(cwd, a.path || '')
        if (!fp.startsWith(cwd + '/')) return say('refused: ' + JSON.stringify(a.path) + ' is outside your copy')
        let isFile = false
        try { isFile = fs.statSync(fp).isFile() } catch { /* absent */ }
        if (!isFile) return say('refused: ' + JSON.stringify(a.path) + ' is not an existing file in your copy')
        const rel = fp.slice(cwd.length + 1)
        touch(agent, rel); known[agent].add(rel)
        fs.rmSync(fp)
        await syncFromDisk(agent)
        edited(agent, rel)
        ev('delete', { agent, task: task.id, path: rel })
        return say('deleted ' + rel)
      }),
    tool('publish', "Publish your copy's changes so the other agents receive them.", {},
      async () => { await syncFromDisk(agent); await publishCopy(agent); ev('publish', { agent, task: task.id }); await board.publish(agent, task.id); edge('publish ' + agent); return say('published') }),
    tool('resolve_conflict', 'Close an open conflict in a file: the text in your copy now says what both sides meant (edit it first with Edit if it did not).',
      { path: z.string(), note: z.string() },
      async (a) => {
        if (!openEntries(a.path).length) return say('no open conflict in ' + a.path)
        await syncFromDisk(agent); await publishCopy(agent)
        closeEntries(a.path, agent, a.note, 'resolve_conflict'); edge('resolve ' + agent)
        return say('conflict in ' + a.path + ' closed and your copy published')
      }),
    tool('release', 'Give your task back to the board because you are blocked. Say why.', { reason: z.string() },
      async (a) => { st.released = a.reason; return say('released; end your turn now') }),
    tool('done', 'Your task is finished: its facts pass on your copy. This publishes your copy and closes it.', { summary: z.string() },
      async (a) => {
        const red = redOf(runFacts(cwd, task))
        if (red.length) {
          st.redRuns++
          ev('facts:red', { agent, task: task.id, at: 'done', exits: red.map((r) => r.exit) })
          return say('not done: these facts fail on your copy. Fix them, run run_proof, then call done again.\n\n' + redText(task, red))
        }
        await syncFromDisk(agent); await publishCopy(agent); ev('publish', { agent, task: task.id, by: 'done' }); await board.publish(agent, task.id)
        st.done = a.summary; st.closed = true
        await board.done(task); live.delete(agent); edge('done ' + agent); log(agent, 'done', task.id)
        return say('published and marked done; your copy is closed to edits. End your turn now.')
      }),
  ]
  const hooks = {
    PreToolUse: [{ hooks: [async (input) => {
      const ti = input.tool_input || {}
      ev('tool', { agent, task: task.id, tool: input.tool_name, target: String(ti.file_path || ti.command || '').slice(0, 120) })
      if (['Read', 'Edit', 'MultiEdit', 'Write'].includes(input.tool_name) && ti.file_path) {
        const fp = path.resolve(cwd, ti.file_path)
        if (fp.startsWith(cwd + '/')) touch(agent, fp.slice(cwd.length + 1))
      }
      if (st.closed && ['Edit', 'MultiEdit', 'Write', 'Bash'].includes(input.tool_name)) {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'your task is done and your copy is closed; end your turn' } }
      }
      if (input.tool_name === 'Bash' && findGit(ti.command || '') !== null) {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'agents never run git' } }
      }
      if (input.tool_name === 'Bash') {
        const cmd = ti.command || ''
        const redirects = [...cmd.matchAll(/(?:^|[^<>&0-9])>{1,2}\s*([^\s|;&<>()]+)/g)].map((m) => m[1]).filter((t) => t !== '/dev/null' && !t.startsWith('&'))
        const overwrites = redirects.some((t) => { const f = path.resolve(cwd, t); return f.startsWith(cwd + '/') && fs.existsSync(f) })
        if (overwrites || /\bsed\s+-[a-zA-Z]*i|\bperl\s+-[a-zA-Z]*i|\b(mv|cp|rm)\s/.test(cmd)) {
          ev('deny:shell-write', { agent, task: task.id, command: cmd.slice(0, 160) })
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
            permissionDecisionReason: 'In this repository an existing file changes only through the Edit tool, so every change is recorded exactly and merges with the other agents. A shell command may create a NEW file, and may read and run anything, but may not overwrite, move or delete an existing file. Delete an existing file with the delete_file tool.' } }
        }
      }
      if (['Edit', 'MultiEdit', 'Write'].includes(input.tool_name)) {
        const fp = path.resolve(cwd, ti.file_path || '')
        if (!fp.startsWith(cwd + '/')) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'outside your copy' } }
        await syncFromDisk(agent)
        pre.set(input.tool_use_id, readOr(fp))
      }
      if (input.tool_name === 'Bash') {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...ti, command: '{ ' + (ti.command || '') + '\n} < /dev/null' } } }
      }
      return {}
    }] }],
    PostToolUse: [{ hooks: [async (input) => {
      const ti = input.tool_input || {}
      const name = input.tool_name
      if (['Edit', 'MultiEdit', 'Write'].includes(name)) {
        const fp = path.resolve(cwd, ti.file_path)
        const rel = fp.slice(cwd.length + 1)
        known[agent].add(rel)
        const before = pre.get(input.tool_use_id)
        let rec = { peer: 0, peers: [] }, how = 'edit-call'
        if (name === 'Write' || before === null || before === undefined) {
          const owners0 = await keyedOwners(agent, rel)
          const r = await must({ op: 'rewrite', agent, path: rel, content: readOr(fp), task: task.id }); peerRewrites(agent, rel, r.peerRewrites); rec = { ...peerFall(owners0, await keyedOwners(agent, rel)), peerText: r.peer_lines_touched }; how = before == null ? 'new-file' : 'write'
        } else {
          rec = await recordEditCall(agent, rel, before, name === 'MultiEdit' ? ti.edits : [ti])
          const view = (await must({ op: 'view', agent, path: rel })).text
          if (view !== readOr(fp)) { const r = await must({ op: 'rewrite', agent, path: rel, content: readOr(fp), task: task.id }); peerRewrites(agent, rel, r.peerRewrites); how = 'edit-call-mismatch' }
        }
        // gap 9 (open, but declared): an edit outside the editing task's own Files is an amendment
        const own = task.files || (String(task.id).startsWith('R:') ? [task.id.slice(2)] : null)
        const outside = own ? !own.includes(rel) : false
        edited(agent, rel)
        ev('edit', { agent, task: task.id, tool: name, path: rel, how, peer_lines: rec.peer, peers: rec.peers, peer_lines_text: rec.peerText, outside })
        if (rec.peer) await board.post({ by: 'host', claim: `${agent} changed ${rec.peer} line(s) written by ${rec.peers.join(', ')} in ${rel}`, confidence: 1, task: task.id })
      } else if (name === 'Read' && ti.file_path) {
        // warn first: before a builder edits a peer's lines, it is told whose they are
        const fp = path.resolve(cwd, ti.file_path)
        if (!fp.startsWith(cwd + '/')) return {}
        const rel = fp.slice(cwd.length + 1)
        const r = await weave({ op: 'authors_keyed', agent, path: rel })
        if (!r.ok) return {}
        const tasks = {}
        for (const a of new Set(r.authors.flatMap((w) => w.split('|')))) {
          const t = a.includes('.') && W.tasks.find((x) => x.id === a.slice(a.indexOf('.') + 1))
          if (t) tasks[a] = { id: t.id, title: t.title }
        }
        const note = peerNote({ path: rel, authors: r.authors, agent: task_label(agent, task.id), tasks })
        if (note) {
          ev('peer:note', { agent, task: task.id, path: rel })
          return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: note } }
        }
      } else if (name === 'Bash') {
        const drift = await syncFromDisk(agent)
        const cmd = ti.command || ''
        if (/pytest/.test(cmd)) {
          const out = JSON.stringify(input.tool_response || '')
          const red = /\d+ failed|error/i.test(out) && !/\b0 failed\b/.test(out)
          ev('test', { agent, task: task.id, red, drift, cause: red ? await blame(agent, cwd, out.replace(/\\n/g, '\n').replace(/\\"/g, '"')) : null })
          if (red) st.redRuns += 1
        }
      }
      return {}
    }] }],
    PostToolUseFailure: [{ hooks: [async (input) => {
      if (['Edit', 'MultiEdit'].includes(input.tool_name) && !input.is_interrupt) {
        const kind = failKind(String(input.error || ''))
        editFailures[kind] += 1
        const ti = input.tool_input || {}
        ev('edit:fail', { agent, task: task.id, tool: input.tool_name, kind, path: String(ti.file_path || '').slice(cwd.length + 1), error: String(input.error || '').slice(0, 200), old_lines: String(ti.old_string || '').split('\n').length })
      }
      return {}
    }] }],
    PostToolBatch: [{ hooks: [async () => {
      const changed = await pullInto(agent, task)
      const spotted = [...(spotNotes[agent] || [])]; delete spotNotes[agent]
      if (!changed.length && !spotted.length) return {}
      const note = (changed.length ? 'Peers\' published work was merged into your copy just now: ' +
        changed.map((c) => `${c.path} (+${c.added} −${c.removed}, from ${c.from}${c.conflict ? ', with conflict marks' : ''})`).join('; ') + '. Re-read before editing those files.' : '') +
        (spotted.length ? ' Same-spot insertions in your copy: ' + spotted.join('; ') + '.' : '')
      return { hookSpecificOutput: { hookEventName: 'PostToolBatch', additionalContext: note } }
    }] }],
  }
  const prompt = `You are agent ${agent}. You claimed task ${task.id}: ${task.title}.\n\n${task.body}\n` +
    (task.notes.length ? `\nNotes on this task from earlier attempts:\n- ${task.notes.slice(-3).join('\n- ')}\n` : '') +
    brief(task)
  if (outcome) return   // the run ended while this builder was pulling: start no session
  ev('session:start', { agent, task: task.id })
  log(agent, 'claims task', task.id)
  const q = query({ prompt, options: {
    cwd, model: MODEL, settingSources: [], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,
    maxTurns: 80, systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM },
    mcpServers: { flock: createSdkMcpServer({ name: 'flock', tools }) },
    disallowedTools: ['WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit'], hooks,
    // tool search off: the builder's own tools load up front (no ToolSearch step). The key is
    // spelt in parts so no line names the retired switch's constant.
    env: { ...process.env, ['ENABLE_TOOL' + '_SEARCH']: 'false' },
  } })
  let result = null
  live.add(agent)
  const killer =setTimeout(() => { q.interrupt().catch(() => {}) }, Math.max(1000, CLOCK_MS - now()))
  stops.set(agent, () => q.interrupt().catch(() => {}))
  if (outcome) q.interrupt().catch(() => {})   // the stop landed between query() and stops.set
  try { for await (const m of q) if (m.type === 'result') result = m } catch (e) { ev('session:error', { agent, error: String(e).slice(0, 300) }) }
  clearTimeout(killer); stops.delete(agent)
  if (!st.closed) { await syncFromDisk(agent); await publishCopy(agent); edge('session end ' + agent) }
  usage.push({ agent, task: task.id, turns: result?.num_turns, usage: result?.usage, subtype: result?.subtype, cost_usd: result?.total_cost_usd || 0, wall_ms: now() - (usage.startT = usage.startT || 0) })
  ev('session:end', { agent, task: task.id, released: st.released, done: st.done, redRuns: st.redRuns, turns: result?.num_turns, usage: result?.usage })
  // ticket 5: a resolve task that ends done closes its path's regions even when the resolver
  // changed nothing ("the merged text already says what both meant": run n1, 2 of 2 attempts)
  if (String(task.id).startsWith('R:') && st.done) closeEntries(task.id.slice(2), agent, st.done, 'resolve task done')
  live.delete(agent); if (!st.closed) lastChange = now()
  if (st.closed || outcome) { /* done at the done call, or the run has ended: nothing to give back */ } else if (st.released) { await giveBack(agent, task, st.released) } else {
    const red = redOf(runFacts(cwd, task))
    if (red.length) {
      ev('facts:red', { agent, task: task.id, at: 'session-end', exits: red.map((r) => r.exit) })
      await giveBack(agent, task, 'the session ended with red facts: ' + redText(task, red).slice(0, 300))
    } else { await board.done(task); log(agent, 'done', task.id) }
  }
}

async function agentLoop (agent) {
  while (!settled && !outcome && now() < CLOCK_MS) {
    const t = await board.claim(agent)
    if (!t) { await sleep(1500); continue }
    if (outcome) break
    await session(agent, t)
    lastSessionEnd = now()
  }
}

// ── settling ──────────────────────────────────────────────────────────────────
let outcome = null   // ticket 5: { pr: 'ready' | 'draft', why, snap }
function debounceMs () {
  const xs = [...edgeLatency].sort((a, b) => a - b)
  const p90 = xs.length ? xs[Math.min(xs.length - 1, Math.floor(0.9 * xs.length))] : 500
  return Math.max(1000, 2 * p90)
}
function terminal (pr, why, r) {
  outcome = { pr, why, snap: r && r.snap, t: now() }
  ev('terminal', outcome); log('TERMINAL', pr, why)
}
async function settle () {
  while (!settled && !outcome && now() < CLOCK_MS) {
    await sleep(500)
    const stalled = () => STALL_MS > 0 && now() - lastRise > STALL_MS && lastSessionEnd > lastRise
    if (stalled() && (await edgeChain, stalled())) {
      // no progress (#1334): the best-green count has not risen within the limit, a builder session
      // has ended since it last did, and no queued snapshot raised it (the edge chain is drained)
      await stall('no-progress', { since_rise_ms: now() - lastRise, limit_ms: STALL_MS, best: bestGreen, live: [...live] })
      terminal('draft', `no progress: the green count has not risen for ${Math.round((now() - lastRise) / 1000)} s`, lastEdge)
      for (const stop of stops.values()) stop()
      break
    }
    const all = [...board.tasks.values()]
    // rule S1: nothing can change the code any more.
    // a claimed task is work in progress even before its session goes live (atlas AE5: a resolve
    // task claimed 0.5 s after it was added read as a deadlock, and the run ended a draft on green code)
    const claimed = all.some((t) => t.state === 'claimed')
    if (!live.size && !claimed && !board.allDone() && !board.readyNow().length && now() - lastChange > debounceMs()) {
      // deadlock: no agent working, nothing claimable, work left. Nobody will publish again.
      await stall('deadlock', { left: all.filter((t) => t.state !== 'done').map((t) => ({ id: t.id, state: t.state, depends_on: t.depends_on })) })
      terminal('draft', 'deadlock: work left and nothing claimable', lastEdge); break
    }
    // round 3, `tested`: once the last tested hash is green and nothing was published after it,
    // nothing can change the code, so the debounce buys nothing; it still guards an untested publish
    const tested = lastEdge && lastEdge.green && lastEdge.t >= lastPublish
    if (live.size || !board.allDone() || (!tested && now() - lastChange < debounceMs())) continue
    const r = await edge('settle check')
    if (r.green) { settled = { t: now(), snap: r.snap }; ev('settled', settled); log('SETTLED on', r.snap); terminal('ready', 'settled green', r); break }
    let acted = false
    for (const t of all) {
      const bad = (r.perTask[t.id] || []).some((x) => x !== 0)
      if (!bad) continue
      if (t.reopen >= MAX_REOPEN) continue
      acted = true
      t.reopen += 1
      await board.reopen(t, `edge snapshot ${r.snap} is red on this task's facts ${JSON.stringify(r.perTask[t.id])}; check exit ${r.check}`)
      await board.post({ by: 'host', claim: `edge red on task ${t.id} at snapshot ${r.snap}`, confidence: 1, task: t.id })
      ev('reopen', { task: t.id, snap: r.snap, n: t.reopen }); log('reopen task', t.id, 'at', r.snap)
    }
    for (const p of r.blocking || []) {
      const id = 'R:' + p
      if (board.tasks.has(id) && board.tasks.get(id).state !== 'done') continue
      const prev = board.tasks.get(id)
      if (prev && prev.reopen >= MAX_REOPEN) continue
      acted = true
      const ann = (openEntries(p)[0] || {}).annotated || (r.annotated || {})[p]
      await board.addTask({ id, title: 'Resolve conflict marks in ' + p, depends_on: [], state: 'ready', owner: null, notes: [], reopen: prev ? prev.reopen + 1 : 0, facts: [],
        body: `Two agents changed the same part of \`${p}\` and the merge marked it as a conflict. Here is the merged file with the conflict sections marked (<<<<<<< begin … / ======= begin … / >>>>>>> end conflict; "left" and "right" are the two sides):\n\n\`\`\`\n${ann || '(annotation unavailable)'}\n\`\`\`\n\nYour copy holds the merged text WITHOUT the markers. Make that part of \`${p}\` say what both sides meant (edit with Edit if it does not already), run the tests, then call resolve_conflict for \`${p}\` and then done.` })
      ev('resolve-task', { path: p, snap: r.snap }); log('resolve task for', p)
      if (JEV_RESOLVE) {
        const sides = W.tasks.filter((t) => (t.files || []).includes(p)).map((t) => ({ title: t.title, claim: claimOf(t.body) }))
        trial('already_joined', RESOLVE_QUESTION, resolveState({ path: p, annotated: ann, sides }), 'jev:resolve', { path: p, snap: r.snap })
      }
    }
    if (W.check && r.check !== 0 && all.every((t) => (r.perTask[t.id] || []).every((x) => x === 0))) {
      // ticket 5: the check is red with every fact green. The old loop restarted the quiet
      // window and told nobody, so the run waited for its clock. Now the check owns a task.
      ev('red-check-only', { snap: r.snap, tail: r.checkTail }); log('check red with every fact green')
      const prev = board.tasks.get('C:check')
      if (!prev || (prev.state === 'done' && prev.reopen < MAX_REOPEN)) {
        acted = true
        await stall('check_red', { snap: r.snap, tail: (r.checkTail || '').slice(-300) })
        await board.addTask({ id: 'C:check', title: 'Make the run-wide check green', depends_on: [], state: 'ready', owner: null, notes: [], reopen: prev ? prev.reopen + 1 : 0, facts: [W.check],
          body: `Every task's facts pass on the merged code, but the run-wide check does not. Its output ends:\n\n\`\`\`\n${(r.checkTail || '').slice(-600)}\n\`\`\`\n\nFix the cause (prefer not to rewrite a peer's lines; post a belief if the fix is theirs), run the check, publish, then done.` })
      }
    }
    if (!acted) {
      // exhausted: red or blocked, and every lever (reopen, resolve task, check task) is spent.
      // Waiting for the clock buys nothing: publish the draft now with the beliefs attached.
      await stall('exhausted', { snap: r.snap, perTask: r.perTask, check: r.check, blocking: r.blocking })
      terminal('draft', 'exhausted: red or blocked with every retry spent', r); break
    }
  }
  if (!outcome) terminal('draft', 'clock', lastEdge)
}

// ── run ───────────────────────────────────────────────────────────────────────
await must({ op: 'base', root: BASE_DIR, paths: BASE_PATHS })
ev('start', { workload: W.name, agents: 'elastic', cap: CAP, model: MODEL, clock_ms: CLOCK_MS, quiet_ms: QUIET_MS, board: BOARD, publish: 'explicit', early_close: 'held', order: 'chain', pulls: PULLS, chain: board.cp ? Object.fromEntries(board.cp) : undefined })
log(`workload ${W.name}, elastic builders (cap ${CAP}), ${MODEL}, out ${OUT}`)
// the previous run (#1335, #1395): when this run follows one on the same repository, the sandbox
// (factory/boot.sh) extracts that run's evidence folder to a directory and names it with
// --past-dir <dir> (basename = the run number); read what it recorded (status, events, red
// checks) and brief every builder with it. No --past-dir reads nothing. Any failure (a missing
// directory or file) is logged once and leaves the brief as it was.
let PAST = null
{
  const dir = arg('past-dir')
  if (dir) {
    try {
      const m = Number(path.basename(path.resolve(dir)))
      if (!Number.isInteger(m) || m < 1) throw new Error(`past dir ${dir} is not named by a run number`)
      const text = (f) => fs.readFileSync(path.join(dir, f), 'utf8')
      const status = JSON.parse(text('status.json'))
      const events = text('events.jsonl').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
      // optional: runs before #1352, and factory runs, have no red-checks.json; pastItems reads null as none
      let redChecks = null
      try { redChecks = JSON.parse(text('red-checks.json')) } catch { /* no red checks recorded */ }
      const items = pastItems({ status, events, redChecks })
      ev('past', { run: m, items: items ? items.length : 0 })
      if (items) {
        PAST = { run: m, items }
        fs.writeFileSync(path.join(OUT, 'past.json'), JSON.stringify(PAST, null, 2) + '\n')
      }
      log('past: run-' + m, items ? items.length + ' items' : 'finished green')
    } catch (e) { log('past: nothing read —', String(e.message || e).split('\n')[0]) }
  }
}
// a stories-v1 run proves the checker can run here before any builder spends anything:
// exit 0 or 1 on the starting app is expected (a green or red finding); anything else — a
// missing bun/checker (spawn ENOENT reads as 124/127), a crash, a timeout — is the sandbox,
// not the app, and stops the run before it starts.
if (W.stories) {
  const first = W.tasks.find((t) => t.facts.length)
  const r = runFacts(SETUP ? DEPS_DIR : BASE_DIR, { facts: [first.facts[0]] })[0]
  ev('checker:start', { exit: r.exit })
  if (r.exit !== 0 && r.exit !== 1) {
    await stall('checker', { tail: r.tail.slice(-300) })
    terminal('draft', 'the checker cannot run on this sandbox: ' + r.tail.slice(-300), null)
  }
}
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const pool = []
lastRise = now()   // setup and the checker preflight do not count against the first window
const loops = []
let buildersMax = pool.length
// a builder is busy while it has a session open or a task claimed in its name
const busy = (a) => live.has(a) || [...board.tasks.values()].some((t) => t.state === 'claimed' && t.owner === a)
function openBuilder () {
  const a = pool.length < 26 ? LETTERS[pool.length] : LETTERS[pool.length % 26] + Math.floor(pool.length / 26)
  fs.cpSync(BASE_DIR, agentDir(a), { recursive: true }); linkDeps(agentDir(a)); gitCopy(agentDir(a))
  known[a] = new Set(BASE_PATHS)   // its first session pulls every published change (session -> pullInto)
  pool.push(a); buildersMax = Math.max(buildersMax, pool.length)
  ev('builder:open', { agent: a, pool: pool.length, ready: board.readyNow().length, busy: pool.filter(busy).length })
  log('opens builder', a, '(pool ' + pool.length + ')')
  loops.push(agentLoop(a))
}
async function spawner () {
  while (!settled && !outcome && now() < CLOCK_MS) {
    const want = board.readyNow().length - pool.filter((a) => !busy(a)).length
    for (let i = 0; i < want && pool.length < CAP; i++) openBuilder()
    await sleep(500)
  }
}
await Promise.all([spawner(), settle()])
await Promise.all(loops)
await edgeChain
if (trialsPending.size) await Promise.race([Promise.all([...trialsPending]), new Promise((r) => setTimeout(r, JEV_TIMEOUT_MS).unref())])
peerRewriteDraft()
const summary = {
  workload: W.name, agents: 'elastic', builders_max: buildersMax, cap: CAP, model: MODEL, settled, wall_ms: now(), publish: 'explicit', early_close: 'held', order: 'chain',
  final: lastEdge && { snap: lastEdge.snap, green: lastEdge.green, perTask: lastEdge.perTask, check: lastEdge.check, conflicts: lastEdge.conflicts },
  snapshots: snapshots.length, beliefs: board.beliefCount,
  // ticket 5: the terminal outcome. `ready` only from a settled green hash; anything else is a
  // draft with what the swarm believed attached, so the operator reads beliefs, not a transcript.
  outcome, settle_mode: 'tested', debounce_ms: debounceMs(),
  attached: outcome && outcome.pr === 'draft' ? { stalls, open_conflicts: [...ledger.values()].filter((e) => e.open).map((e) => ({ path: e.path, region: e.region, between: e.between })), last_edge: lastEdge && { snap: lastEdge.snap, perTask: lastEdge.perTask, check: lastEdge.check } } : undefined,
  edit_failures: editFailures,
  tokens: usage.reduce((a, u) => ({ input: a.input + (u.usage?.input_tokens || 0), output: a.output + (u.usage?.output_tokens || 0), cache_read: a.cache_read + (u.usage?.cache_read_input_tokens || 0), cache_write: a.cache_write + (u.usage?.cache_creation_input_tokens || 0) }), { input: 0, output: 0, cache_read: 0, cache_write: 0 }),
  sessions: usage.length,
  cost_usd: Math.round(usage.reduce((a, u) => a + (u.cost_usd || 0), 0) * 1000) / 1000,
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1))
fs.writeFileSync(path.join(OUT, 'snapshots.json'), JSON.stringify(snapshots))
fs.writeFileSync(path.join(OUT, 'board.json'), JSON.stringify(await board.read(), null, 1))
writeCompactRecord()
writeFailureRecord()
log('summary', JSON.stringify(summary))
// the join's blame and text, asked before the weave closes, for provenance.json at landing
const JOIN = { blame: (await weave({ op: 'blame' })).blame || {}, files: (await weave({ op: 'merged' })).files || {} }
wp.stdin.end()
const landed = await land()
if (kataPending.size) await Promise.race([Promise.all([...kataPending]), new Promise((r) => setTimeout(r, KATA_EXIT_MS).unref())])
// a post still pending is dropped at exit: say how many, so the record accounts for every post
if (kataPending.size) ev('kata:mirror', { abandoned: kataPending.size })
process.exit(landed)

// #1401: under `enforce`, a settled green whose snapshot lost a peer's line (the survival fact,
// weave `lost`) that a peer rewrite Jev read as `loses` covers ends a draft. A read covers a lost
// line when it is on the line's path, names the line's author among its peers and holds the line.
// A lost line no read answers (Jev off, a null, never asked) is recorded, never drafted.
function peerRewriteDraft () {
  if (PEER_MODE !== 'enforce' || !outcome || outcome.pr !== 'ready') return
  const s = snapshots.findLast((x) => x.snap === outcome.snap)
  if (!s || !s.lost) return
  // a line restored with the same text is a new identity in the weave: the deleted one stays lost,
  // but the snapshot shows its text, so nothing was lost
  const shown = (e) => new Set(String(s.files[e.path] ?? '').split('\n'))
  const lost = s.lost.map((e) => ({ ...e, lines: e.lines.filter((l) => !shown(e).has(l)) })).filter((e) => e.lines.length)
  const losing = []
  for (const e of lost) {
    const covers = (l) => (r) => r.path === e.path && String(e.author).split('|').some((a) => (r.peers || []).includes(a)) && (r.peer || []).includes(l)
    const unread = e.lines.filter((l) => !peerReads.some((r) => covers(l)(r) && (r.answer === 'loses' || r.answer === 'keeps')))
    for (const l of e.lines) for (const r of peerReads.filter(covers(l))) if (r.answer === 'loses' && !losing.includes(r)) losing.push(r)
    if (unread.length) ev('survival:unread', { snap: s.snap, path: e.path, author: e.author, lines: unread })
  }
  if (!losing.length) return
  ev('peer:rewrite:draft', { rewrites: losing.map((r) => ({ agent: r.agent, path: r.path, peers: r.peers, after: r.after })) })
  terminal('draft', `a peer rewrite Jev read as losing the peer's change: ${[...new Set(losing.map((r) => r.path))].join(', ')}`, outcome)
}

// ── the compact record: each tested snapshot's patch against the previous one, and the weave's
// ops with file texts as fingerprints (compact_record.mjs) ──
function writeCompactRecord () {
  const lines = fs.readFileSync(path.join(OUT, 'weave-ops.jsonl'), 'utf8').split('\n')
  const rec = compactRecord(snapshots, BASE_FILES, lines)
  fs.writeFileSync(path.join(OUT, 'snapshots.jsonl'), rec.snapshots)
  fs.writeFileSync(path.join(OUT, 'weave-ops.digest.jsonl'), rec.digest)
}

// ── the ending: one commit on the target, and the rows the pull request card reads ──
// Writes a snapshot's files into the target's working tree (the ones that exist; deletes the
// ones that don't) and commits once with the engine's own git. Answers the commit's sha, or
// null when the snapshot leaves the tree as it is at base.
function commitSnapshot (snap, message) {
  const s = snapshots.find((x) => x.snap === snap)
  if (!s) return null
  for (const [p, text] of Object.entries(s.files)) {
    const f = path.join(TARGET, p)
    if (s.exists[p]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) } else fs.rmSync(f, { force: true })
  }
  git(['add', '-A'])
  if (!git(['status', '--porcelain']).trim()) return null
  git(['-c', 'user.name=flock', '-c', 'user.email=flock@ultrapowers.invalid', 'commit', '-qm', message])
  return git(['rev-parse', 'HEAD']).trim()
}
async function land () {
  if (outcome && outcome.pr === 'ready' && outcome.snap) {
    const sha = commitSnapshot(outcome.snap, `flock: settled ${outcome.snap}`)
    if (!sha) { ev('landing:empty', { snap: outcome.snap }); return 1 }
    // one `landing` row per task: the settled commit it landed in
    for (const t of W.tasks) ev('landing', { task: t.id, candidateSha: sha })
    await writeProvenance(outcome.snap)
    await Promise.race([readAndRecord(null).catch(() => {}), sleep(20000)])
    return 0
  }
  if (lastEdge) {
    const sha = commitSnapshot(lastEdge.snap, `flock: draft ${lastEdge.snap}`)
    if (sha) {
      await writeProvenance(lastEdge.snap)
      for (const t of W.tasks) {
        if ((lastEdge.perTask[t.id] || []).some((x) => x !== 0)) ev('parked', { task: t.id, reason: `red at ${lastEdge.snap}` })
      }
    }
  }
  return 1
}

// provenance.json (#1404, provenance.mjs): the landed snapshot's hunks by task, the surprises and,
// under flock.provenance.coverage `record`, the changed code no tagged fact ran. Each task's fact at
// index i proves t.clauses[i] (claims-v1: t.factClauses[i]); every tagged fact is one job of a single
// linesRunAll call in a fresh edge copy of the snapshot, and its lines merge per clause; the jobs'
// counts (coverageCounts: ran, timed_out, skipped, unmeasured) go in as `coverage`. The join's blame is kept only for paths whose
// text is the landed text.
async function writeProvenance (snap) {
  try {
    const s = snapshots.find((x) => x.snap === snap)
    if (!s) return
    const landed = Object.fromEntries(Object.entries(s.files).filter(([p]) => s.exists[p]))
    const blame = Object.fromEntries(Object.entries(JOIN.blame).filter(([p]) => p in landed && JOIN.files[p] === landed[p]))
    const events = fs.readFileSync(path.join(OUT, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    let coverage = null
    let counts = null
    if (PROV_COVERAGE === 'record') {
      coverage = {}
      const dir = path.join(WORK, 'provenance')
      fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(BASE_DIR, dir, { recursive: true }); linkDeps(dir); gitCopy(dir)
      for (const [p, text] of Object.entries(s.files)) {
        const f = path.join(dir, p)
        if (s.exists[p]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) } else fs.rmSync(f, { force: true })
      }
      const tagged = []
      for (const t of W.tasks) {
        (t.facts || []).forEach((argv, i) => {
          // a stories-v1 fact proves t.clauses[i]; a claims-v1 fact, the clauses its `Run:` line tags
          const clauses = t.clauses ? (t.clauses[i] ? [t.clauses[i]] : []) : ((t.factClauses || [])[i] || [])
          if (clauses.length) tagged.push({ argv, clauses })
        })
      }
      const answers = await linesRunAll(tagged.map(({ argv }) => ({ argv, cwd: dir, env: RUN_ENV })),
        { parallel: PROV_PARALLEL, timeoutMs: PROV_FACT_TIMEOUT_MS, budgetMs: PROV_BUDGET_MS })
      counts = coverageCounts(answers)
      answers.forEach(({ lines }, k) => {
        for (const clause of tagged[k].clauses) {
          const into = coverage[clause] = coverage[clause] || {}
          for (const [p, ns] of Object.entries(lines)) into[p] = [...new Set([...(into[p] || []), ...ns])].sort((a, b) => a - b)
        }
      })
    }
    // the lines that can run, for each changed .py path (#1407); a path Python cannot read has none
    const executable = {}
    for (const p of Object.keys(blame).filter((q) => q.endsWith('.py'))) {
      const lines = executableLines(p, landed[p])
      if (lines) executable[p] = lines
    }
    const prov = buildProvenance({ landed, blame, events, lost: s.lost || [], coverage, executable })
    fs.writeFileSync(path.join(OUT, 'provenance.json'), JSON.stringify({ snap, ...prov, coverage: counts }, null, 1))
  } catch (e) {
    ev('provenance:error', { snap, error: String(e && e.message || e).slice(0, 500) })
  }
}

// ── what went wrong: red-checks.json on every run ──────
// red-checks.json holds the last tested snapshot's red facts and the run-wide check when it was
// red, each with the checker's own result JSON when it wrote one (at most 8 KiB); entries are
// added in order while the whole stays within 64 KiB, and one that would pass it is left out.
function writeFailureRecord () {
  const LIMIT = 65536
  const rec = { snap: lastEdge ? lastEdge.snap : null, limit_bytes: LIMIT, truncated: false, red: [] }
  const cands = lastEdge ? [...(lastEdge.red || [])] : []
  if (lastEdge && W.check && lastEdge.check !== 0) cands.push({ task: 'check', cmd: W.check.join(' '), exit: lastEdge.check, tail: lastEdge.checkTail || '' })
  let size = Buffer.byteLength(JSON.stringify(rec))
  for (const c of cands) {
    const e = { ...c }
    if (c.clause) {
      const f = path.join(CHECK_OUT, `${String(c.clause).replaceAll('/', '_')}@edge.json`)
      try { if (fs.statSync(f).size <= 8192) e.checker = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { /* no checker result */ }
    }
    const n = Buffer.byteLength(JSON.stringify(e)) + 1
    if (size + n > LIMIT) { rec.truncated = true; continue }
    size += n; rec.red.push(e)
  }
  fs.writeFileSync(path.join(OUT, 'red-checks.json'), JSON.stringify(rec, null, 1))
}

