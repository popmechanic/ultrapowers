/**
 * fleet/tests/test_launch_run_number.mjs — the push is what reserves N.
 *
 * The exam for "A refused plan push re-reads the highest run and takes N+1",
 * written against that task's Machine clauses, leg by leg. Each assertion names
 * its leg and the clause it comes from:
 *
 *   (a) [M1] [M4] a competitor that takes `ultra/plan-run-1` between the
 *       launcher's commit and its push: the refused push is re-read, N+1 is
 *       taken, a fresh plan commit for that N is pushed, and every number the
 *       launch carries afterwards — `run`, the comment's `run=`/`plan=`, the VM
 *       name, `planBranch`, `runId` and the setup script on `new`'s stdin — is
 *       the N that was pushed;
 *   (b) [M2] a competitor that takes every ref the launcher tries: three plan
 *       pushes in all — `PUSH_ATTEMPTS` — then a `Refusal` (exit 2) carrying the
 *       last push's own output and the number 3, with no `new` issued;
 *   (c) [M3] a push refused by something that is not a race — a pre-receive hook
 *       that touches the origin nothing, whose re-read is still below the N
 *       tried — is the BASE refusal after exactly one push and one re-read; and
 *       a refused push under `--run <N>` is the BASE refusal after exactly one
 *       push and no re-read at all;
 *   (d) [M5] `fleet/CONTRACT.md`'s `**Run id:**` bullet says that a refused plan
 *       push re-reads the highest run and retries, up to three pushes.
 *
 * Nothing here opens a network socket. The target is a real repository —
 * `makeTargetRepo`'s bare origin and its clone — and the seam rewrites the
 * remote of the launcher's own `ls-remote`, `fetch` and `push` to that bare path
 * and runs them for real: the rejections are git's own words, `plan=` is a sha
 * git made, and the refs the launcher re-reads are the origin's own. The
 * competitor is a SIBLING of `<base>` (a second `commit-tree` of base's tree
 * with `-p <base>`), never `<base>` itself: a descendant of base pushed onto a
 * ref that holds base is a fast-forward and would be accepted.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import * as launcher from '../launch.mjs'
import {
  FLEET_DEFAULTS,
  Refusal,
  defaultExec
} from '../lobby.mjs'
import { readFleetFiles, renderSetupScript } from '../setup-script.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const { launch } = launcher

const TARGET = 'popmechanic/smoke'
/** The target's one GitHub integration. */
const GH = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-03T22:15:00.000Z')
const PLAN_TEXT = '# a plan\n\nOne task, and a trailing newline.\n'
const VERDICTS_TEXT = '{"verdict":"green","gates":[]}\n'
/**
 * The seed the base commit carries. `pytest.ini` is beside the README because a
 * sibling task of this wave refuses a launch whose tree at `--base` has no
 * detectable test command; the number this exam is about is read the same way
 * either side of that.
 */
const SEED = { 'README.md': '# target\n', 'pytest.ini': '[pytest]\n' }
const CONFIG = { ...FLEET_DEFAULTS }
/** `billing plan --json`, as measured 2026-09-04. */
const BILLING_OK = {
  max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual'
}

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(FLEET_DIR, '..')

const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))

// ── The seam's rules (the scaffolding of fleet/tests/test_launch.mjs) ────────

/** `new … --json` answers the row for whatever name the line asked for. */
const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

/** The engine tip, when a launch reads it rather than taking `--engine`. */
const ENGINE_RULE = {
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${ENGINE}\tHEAD\n`)
}

/** `origin` pointed at the bare repository the exam really made. */
const pointAtOrigin = (repo, argv) => {
  const pointed = argv.map((a) => (a === 'origin' || /github\.com/.test(String(a)) ? repo.origin : a))
  const fetchAt = argv.indexOf('fetch')
  if (fetchAt < 0) return pointed
  const remoteAt = argv.indexOf('origin', fetchAt)
  const branch = String(argv[remoteAt + 1] ?? '')
  if (remoteAt < 0 || branch === '' || branch.startsWith('-') || branch.includes(':')) return pointed
  pointed[remoteAt + 1] = `+refs/heads/${branch}:refs/remotes/origin/${branch}`
  return pointed
}

/** The launcher's remote reads and writes, run for real against the bare path. */
const localRemote = (repo) => ({
  when: (cmd, argv) => cmd === 'git' &&
    (argv.includes('push') || argv.includes('ls-remote') || argv.includes('fetch')) &&
    !argv.includes('--get-url') &&
    !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => defaultExec('git', pointAtOrigin(repo, argv), options ?? {})
})

/** No socket, whatever else the launcher tries. */
const OFFLINE = answer('', { code: 128, stderr: 'exam: this exam opens no network socket\n' })
const NO_REMOTE_OPS = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => a === 'clone' || a === 'pull' || a === 'fetch'),
  answer: OFFLINE
}
const NO_NETWORK_GIT = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))),
  answer: OFFLINE
}

/** `help <verb>` as the lobby prints it, answering the shipped record's flags. */
const HELP_OK = (cmd, argv) => {
  const verb = String(argv[1] ?? '').slice('help '.length)
  const flags = VERBS.verbs[verb]
  if (!flags) return answer(`No help available for unrecognized command: ${verb}\n`)
  return answer([
    `Command: ${verb}`, '', 'Options:', ...flags.map((f) => `  ${f}  what ${f} does`), ''
  ].join('\n'))
}

/**
 * The rules a launch runs over. `competitor`, when given, sits ahead of
 * `localRemote` so it sees the launcher's plan push first.
 */
const readRules = ({
  repo,
  competitor = null,
  integrations = [{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }],
  billing = BILLING_OK,
  newVerb = NEW_OK
} = {}) => [
  ENGINE_RULE,
  ...(competitor ? [competitor] : []),
  ...(repo ? [localRemote(repo)] : []),
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json', answer(integrations)),
  sshRule('billing plan --json', answer(billing)),
  sshRule('new ', newVerb),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The workspace: a real target repository and a plan beside it ─────────────

function workspace ({ origin = ORIGIN_URL } = {}) {
  const root = tempDir('fleet-launch-run-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', origin])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
  fs.writeFileSync(path.join(planDir, 'a-plan.gate-verdicts.json'), VERDICTS_TEXT)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

/** The origin's own `refs/heads/*`, read off the bare path the exam made. */
const branchesOf = (ws) => {
  const out = {}
  for (const line of ws.repo.git(['ls-remote', '--heads', ws.repo.origin]).split('\n')) {
    const [sha, ref] = line.split('\t')
    if (!ref) continue
    out[ref.trim().replace(/^refs\/heads\//, '')] = sha.trim()
  }
  return out
}

/**
 * The competitor: a SIBLING of `<base>` — base's own tree, `-p <base>`, another
 * message. It is not an ancestor and not a descendant of the plan commit, so a
 * ref holding it refuses the launcher's push as a non-fast-forward.
 */
const siblingOf = (ws, message = 'another launch got there first') =>
  ws.repo.git(['commit-tree', `${ws.repo.base}^{tree}`, '-p', ws.repo.base, '-m', message])

const argvFor = (ws, extra = []) => [
  ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
  '--engine', ENGINE, ...extra
]

const launchIn = (ws, { argv, exec, sleep = async () => {} } = {}) => launch({
  argv: argv ?? argvFor(ws),
  exec,
  config: CONFIG,
  now: () => NOW,
  sleep,
  refreshCredential: () => ({ ok: true })
})

/** Run `body`, answering `{ value, error }` — the exam reads both. */
async function attempt (body) {
  try {
    return { value: await body(), error: null }
  } catch (error) {
    return { value: null, error }
  }
}

// ── Reading the seam's log ──────────────────────────────────────────────────

/** The ref spec of a plan push: `<sha>:refs/heads/ultra/plan-run-<N>`. */
const PLAN_SPEC = /^([0-9a-f]{40}):refs\/heads\/ultra\/plan-run-(\d+)$/

const specOf = (argv) => argv.map(String).find((a) => PLAN_SPEC.test(a)) ?? null

/** Every plan push the launcher issued through the seam, in order. */
const pushCalls = (exec) => exec.calls
  .map((c, i) => ({ ...c, i }))
  .filter((c) => c.cmd === 'git' && c.argv.includes('push') && specOf(c.argv) !== null)

/** Every `ls-remote … refs/heads/ultra/*` read, in order. */
const ultraReads = (exec) => exec.calls
  .map((c, i) => ({ ...c, i }))
  .filter((c) => c.cmd === 'git' && c.argv.includes('ls-remote') &&
    c.argv.some((a) => String(a) === 'refs/heads/ultra/*'))

const newLines = (exec) => exec.lobby().filter((line) => line.startsWith('new '))

const newCallOf = (exec) =>
  exec.calls.find((c) => c.cmd === 'ssh' && String(c.argv[1] ?? '').startsWith('new '))

/** The paths of a commit's tree, off the clone that can read the origin. */
const treeOf = (ws, sha) => {
  ws.repo.git(['fetch', ws.repo.origin, sha])
  return ws.repo.git(['ls-tree', '-r', '--name-only', sha]).split('\n').filter((l) => l !== '')
}

// ── a. [M1] [M4] a refused first push takes N+1 and lands there ─────────────
{
  const ws = workspace()
  const sibling = siblingOf(ws)
  const tried = []

  // The competitor rule, ahead of `localRemote`: it takes the ref the launcher
  // is about to push to — on the first push only — and then runs the launcher's
  // own push for real, which git then refuses as a non-fast-forward.
  const competitor = {
    when: (cmd, argv) => cmd === 'git' && argv.includes('push') && specOf(argv) !== null,
    answer: (cmd, argv, options) => {
      const n = Number(PLAN_SPEC.exec(specOf(argv))[2])
      tried.push(n)
      if (tried.length === 1) {
        ws.repo.git(['push', ws.repo.origin, `${sibling}:refs/heads/ultra/plan-run-${n}`])
      }
      return defaultExec('git', pointAtOrigin(ws.repo, argv), options ?? {})
    }
  }

  const exec = makeExec({ rules: readRules({ repo: ws.repo, competitor }) })
  const { value: result, error } = await attempt(() => launchIn(ws, { argv: argvFor(ws), exec }))

  assert.equal(
    error, null,
    `(a) [M1] a plan push refused because the ref already exists is re-read and retried, not refused; got ${error?.name}: ${error?.message}`
  )
  assert.deepEqual(tried, [1, 2], '(a) [M1] the launcher tried run 1, then run 2: the re-read saw the competitor and took reading+1')

  assert.equal(result.run, 2, '(a) [M4] result.run is 2 — the N the push that took reserved')
  assert.equal(result.runId, 'run-2', '(a) [M4] and runId is run-2')
  assert.equal(result.planBranch, 'ultra/plan-run-2', '(a) [M4] planBranch is ultra/plan-run-2')
  assert.ok(
    result.comment.startsWith(`run=2 plan=${result.plan}`),
    `(a) [M4] the comment starts run=2 plan=<result.plan>, got ${JSON.stringify(result.comment)}`
  )
  assert.equal(
    result.comment,
    `run=2 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${ENGINE}`,
    '(a) [M4] and is the assignment for that N, key for key'
  )
  assert.ok(
    result.vm.startsWith('fleet-r2-'),
    `(a) [M4] the VM is named for run 2, got ${JSON.stringify(result.vm)}`
  )

  const branches = branchesOf(ws)
  assert.equal(
    branches['ultra/plan-run-2'], result.plan,
    "(a) [M4] the origin's ultra/plan-run-2 is result.plan"
  )
  assert.equal(
    ws.repo.git(['log', '-1', '--format=%s', result.plan]), 'ultrapowers plan run-2',
    '(a) [M1] a fresh plan commit was built for the retried N: its subject is `ultrapowers plan run-2`'
  )
  assert.equal(
    ws.repo.git(['rev-parse', `${result.plan}^`]), ws.repo.base,
    "(a) [M1] whose parent is --base's commit"
  )
  assert.equal(
    branches['ultra/plan-run-1'], sibling,
    "(a) [M1] and the origin's ultra/plan-run-1 is still the competitor's commit — the launcher took a number, it did not take a ref"
  )

  assert.equal(
    newCallOf(exec)?.options?.input,
    renderSetupScript({ run: '2', ...readFleetFiles() }),
    "(a) [M4] the rendered setup script for run 2 is on the `new` call's stdin"
  )

  const pushes = pushCalls(exec)
  const reads = ultraReads(exec)
  assert.equal(pushes.length, 2, `(a) [M1] exactly two plan pushes were made, got ${pushes.length}`)
  assert.equal(
    reads.length, 2,
    `(a) [M1] and exactly two \`ls-remote … refs/heads/ultra/*\` reads, got ${reads.length}`
  )
  assert.deepEqual(
    reads[1].argv, reads[0].argv,
    "(a) [M1] the re-read is the same read `highestRunOnTarget` makes: git ls-remote origin refs/heads/ultra/* refs/tags/ultra/*"
  )
  assert.ok(
    reads[1].argv.some((a) => String(a) === 'refs/tags/ultra/*'),
    '(a) [M1] carrying the tag pattern as well as the branch one, so a competitor that has already published is seen'
  )
  assert.ok(
    reads[0].i < pushes[0].i,
    `(a) [M1] the first read is the run number's own, before the first push: read ${reads[0].i}, push ${pushes[0].i}`
  )
  assert.ok(
    reads[1].i > pushes[0].i,
    `(a) [M1] and the second read sits after the first push: push ${pushes[0].i}, read ${reads[1].i}`
  )
  assert.ok(
    pushes[1].i > reads[1].i,
    `(a) [M1] with the second push after it: read ${reads[1].i}, push ${pushes[1].i}`
  )
  assert.match(
    specOf(pushes[1].argv), /:refs\/heads\/ultra\/plan-run-2$/,
    '(a) [M1] the second push is to ultra/plan-run-2'
  )
  assert.equal(
    PLAN_SPEC.exec(specOf(pushes[1].argv))[1], result.plan,
    '(a) [M4] pushing the fresh commit for that N'
  )
  assert.notEqual(
    PLAN_SPEC.exec(specOf(pushes[0].argv))[1], result.plan,
    '(a) [M1] which is not the commit the first push offered: a retried N gets its own commit, not the old sha under a new name'
  )
  ws.cleanup()
}

// ── b. [M2] three pushes in all, then the refusal ──────────────────────────
{
  assert.equal(
    launcher.PUSH_ATTEMPTS, 3,
    '(b) [M2] PUSH_ATTEMPTS is exported by fleet/launch.mjs and is 3'
  )

  const ws = workspace()
  const sibling = siblingOf(ws)
  const tried = []
  const competitor = {
    when: (cmd, argv) => cmd === 'git' && argv.includes('push') && specOf(argv) !== null,
    answer: (cmd, argv, options) => {
      const n = Number(PLAN_SPEC.exec(specOf(argv))[2])
      tried.push(n)
      ws.repo.git(['push', ws.repo.origin, `${sibling}:refs/heads/ultra/plan-run-${n}`])
      return defaultExec('git', pointAtOrigin(ws.repo, argv), options ?? {})
    }
  }

  const exec = makeExec({ rules: readRules({ repo: ws.repo, competitor }) })
  const error = await thrown(() => launchIn(ws, { argv: argvFor(ws), exec }))

  assert.ok(error, '(b) [M2] a competitor that takes every ref the launcher tries ends in a refusal')
  assert.ok(
    error instanceof Refusal,
    `(b) [M2] which is a Refusal, got ${error?.name}: ${error?.message}`
  )
  assert.equal(error.exitCode, 2, '(b) [M2] with exit 2')
  assert.ok(
    error.message.startsWith('launch: '),
    `(b) [M2] whose message begins \`launch: \`, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes('3'),
    `(b) [M2] and carries the number 3 — the pushes it made, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes('rejected'),
    `(b) [M2] and the last push's own output, git's \`rejected\` and all, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes('ultra/plan-run-3'),
    `(b) [M2] naming the ref that last push was refused, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    /failed after 3 tries \(exit \d+\):/.test(error.message),
    `(b) [M2] the BASE refusal text with \` after 3 tries\` after \`failed\`, got ${JSON.stringify(error.message)}`
  )

  const pushes = pushCalls(exec)
  assert.equal(pushes.length, 3, `(b) [M2] exactly three plan pushes were made, got ${pushes.length}`)
  assert.deepEqual(tried, [1, 2, 3], '(b) [M2] for runs 1, 2 and 3 — each N one past the reading the last refusal produced')
  assert.deepEqual(newLines(exec), [], '(b) [M2] no `new` line was issued')
  assert.deepEqual(exec.mutating(), [], '(b) [M2] and `exec.mutating()` is empty: nothing on exe.dev was touched')

  const branches = branchesOf(ws)
  for (const n of [1, 2, 3]) {
    assert.equal(
      branches[`ultra/plan-run-${n}`], sibling,
      `(b) [M2] the origin's ultra/plan-run-${n} is the competitor's commit, not the launcher's`
    )
    assert.ok(
      !treeOf(ws, branches[`ultra/plan-run-${n}`]).includes('.ultrapowers/plan.md'),
      `(b) [M2] a tree with no .ultrapowers/plan.md: no plan of this launch is on ultra/plan-run-${n}`
    )
  }
  ws.cleanup()
}

// ── c. [M3] a refusal that is not a race, and a refusal under --run ────────
{
  // A pre-receive hook: the push is refused, the origin is not touched, and the
  // re-read is therefore still below the N tried.
  const ws = workspace()
  const HOOK_OUT = [
    `To ${ORIGIN_URL}`,
    ' ! [remote rejected] plan -> ultra/plan-run-1 (pre-receive hook declined)',
    `error: failed to push some refs to '${ORIGIN_URL}'`,
    ''
  ].join('\n')
  const declined = {
    when: (cmd, argv) => cmd === 'git' && argv.includes('push') && specOf(argv) !== null,
    answer: () => answer('', { code: 1, stderr: HOOK_OUT })
  }

  const exec = makeExec({ rules: readRules({ repo: ws.repo, competitor: declined }) })
  const error = await thrown(() => launchIn(ws, { argv: argvFor(ws), exec }))

  assert.ok(error, '(c) [M3] a push refused by a pre-receive hook is a refusal')
  assert.ok(
    error instanceof Refusal,
    `(c) [M3] a Refusal, got ${error?.name}: ${error?.message}`
  )
  assert.equal(error.exitCode, 2, '(c) [M3] with exit 2')

  const pushes = pushCalls(exec)
  const reads = ultraReads(exec)
  assert.equal(
    pushes.length, 1,
    `(c) [M3] exactly one plan push was made — a refusal whose re-read is below the N tried is not another launch's, got ${pushes.length}`
  )
  assert.equal(
    reads.filter((r) => r.i > pushes[0].i).length, 1,
    '(c) [M3] with exactly one `ls-remote … refs/heads/ultra/*` read after the push: the race is decided by the re-read, not by parsing git\'s words'
  )
  assert.equal(
    reads.length, 2,
    "(c) [M3] and two such reads in all — the run number's own, and that one"
  )
  assert.ok(
    error.message.includes(HOOK_OUT.trim()),
    `(c) [M3] the message carries the push's own stderr, verbatim, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    error.message.includes('failed (exit'),
    `(c) [M3] and is the BASE refusal text — \`failed (exit\`, got ${JSON.stringify(error.message)}`
  )
  assert.ok(
    !error.message.includes('after'),
    `(c) [M3] with no \`after\`: there was one push, so the BASE text is unchanged, got ${JSON.stringify(error.message)}`
  )
  assert.equal(
    error.message,
    `launch: git push origin ${specOf(pushes[0].argv)} failed (exit 1):\n${HOOK_OUT.trim()}`,
    '(c) [M3] the BASE refusal, byte for byte'
  )
  assert.deepEqual(newLines(exec), [], '(c) [M3] and no `new` was issued')
  assert.deepEqual(exec.mutating(), [], '(c) [M3] nothing on exe.dev was mutated')
  ws.cleanup()

  // `--run <N>`: the operator chose the number, so a refused push is refused —
  // no re-read at all, and no second push.
  const forced = workspace()
  const sibling = siblingOf(forced)
  const tried = []
  const competitor = {
    when: (cmd, argv) => cmd === 'git' && argv.includes('push') && specOf(argv) !== null,
    answer: (cmd, argv, options) => {
      const n = Number(PLAN_SPEC.exec(specOf(argv))[2])
      tried.push(n)
      forced.repo.git(['push', forced.repo.origin, `${sibling}:refs/heads/ultra/plan-run-${n}`])
      return defaultExec('git', pointAtOrigin(forced.repo, argv), options ?? {})
    }
  }
  const execForced = makeExec({ rules: readRules({ repo: forced.repo, competitor }) })
  const forcedError = await thrown(() => launchIn(forced, {
    argv: argvFor(forced, ['--run', '5']), exec: execForced
  }))

  assert.ok(forcedError, '(c) [M3] a refused push under --run 5 is a refusal')
  assert.ok(
    forcedError instanceof Refusal,
    `(c) [M3] a Refusal, got ${forcedError?.name}: ${forcedError?.message}`
  )
  assert.equal(forcedError.exitCode, 2, '(c) [M3] with exit 2')
  assert.deepEqual(tried, [5], '(c) [M3] and the one push it made was for the N the operator chose')
  assert.equal(
    pushCalls(execForced).length, 1,
    `(c) [M3] exactly one plan push, got ${pushCalls(execForced).length}`
  )
  assert.deepEqual(
    ultraReads(execForced), [],
    '(c) [M3] with no `ls-remote … refs/heads/ultra/*` read at all: --run overrides the reading, so there is nothing to re-read'
  )
  assert.ok(
    forcedError.message.includes('failed (exit'),
    `(c) [M3] the BASE refusal text, got ${JSON.stringify(forcedError.message)}`
  )
  assert.ok(
    !forcedError.message.includes('after'),
    `(c) [M3] with no \`after\`, got ${JSON.stringify(forcedError.message)}`
  )
  assert.ok(
    forcedError.message.startsWith(`launch: git push origin ${specOf(pushCalls(execForced)[0].argv)} failed (exit `),
    `(c) [M3] naming the push it made, got ${JSON.stringify(forcedError.message)}`
  )
  assert.equal(
    branchesOf(forced)['ultra/plan-run-5'], sibling,
    "(c) [M3] and the origin's ultra/plan-run-5 is the competitor's commit"
  )
  assert.deepEqual(newLines(execForced), [], '(c) [M3] no `new` was issued')
  forced.cleanup()
}

// ── d. [M5] the contract's **Run id:** bullet ──────────────────────────────
{
  const RUN_CHECK =
    "sed -n '/^- \\*\\*Run id:\\*\\*/,/^- \\*\\*VM name:\\*\\*/p' fleet/CONTRACT.md" +
    " | tr '\\n' ' ' | grep -q 'refused.*re-reads.*three pushes'"
  const res = spawnSync('bash', ['-c', RUN_CHECK], { cwd: REPO_ROOT, encoding: 'utf8' })
  assert.equal(
    res.status, 0,
    "(d) [M5] the **Run id:** bullet of fleet/CONTRACT.md says that a refused plan push re-reads the highest run and retries, up to three pushes — so the push is what reserves N"
  )

  const contract = fs.readFileSync(path.join(FLEET_DIR, 'CONTRACT.md'), 'utf8')
  assert.ok(
    contract.includes('- **Run id:**'),
    '(d) [M5] the bullet keeps its opening `- **Run id:**`'
  )
  assert.ok(
    contract.includes('- **VM name:**'),
    '(d) [M5] and the next bullet keeps its `- **VM name:**`, which tests/test_docs_agree_with_code.py reads'
  )
}

console.log('ALL TESTS PASSED')
