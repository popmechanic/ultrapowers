/**
 * fleet/tests/test_launch.mjs — the launcher: one `new` per run.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Each
 * assertion names its leg and the clause it comes from:
 *
 *   (0) [M6] the two shim files are gone, nothing under `fleet/` names them, the
 *       banned-string grep matches nothing, and `target.mjs` says that no GitHub
 *       integration rides the tag; [M5] the usage string's flags;
 *   (a) [M1] a green launch's mutating lobby verbs are exactly one `new …` line,
 *       with the rendered setup script on that call's stdin, and no `cp`, no
 *       `integrations attach`, no `comment` and no ssh into a VM;
 *   (b) [M2] the refusals, each with nothing mutated;
 *   (c) [M3] the run number off the target's own `ultra/*` refs, and the plan
 *       commit pushed before `new`, against a temporary index;
 *   (d) [M4] three attempts in all, a fresh name each, 1–3 s between, every
 *       attempt's output in the failure;
 *   (e) [M5] the result's keys and the comment.
 *
 * Nothing here opens a network socket. Every `ssh` goes through the injected
 * exec seam. The target is a real repository — `makeTargetRepo`'s bare origin
 * and its clone — whose `origin` is spelled the way a real target's is, and the
 * seam rewrites the remote of the launcher's own `ls-remote` and `push` to that
 * bare path and runs them for real: the push is a real push, `plan=` is a sha
 * git made, and the refs the launcher reads are the origin's own.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { USAGE, launch, renderLaunch } from '../launch.mjs'
import {
  FLEET_DEFAULTS,
  LobbyError,
  Refusal,
  defaultExec,
  evidenceBranchFor,
  integrationBranchFor,
  isVmName,
  planBranchFor,
  runOfVmName,
  statusUrlFor
} from '../lobby.mjs'
import { readFleetFiles, renderSetupScript } from '../setup-script.mjs'
import {
  answer, cleanup, makeExec, makeTargetRepo, sshRule, tempDir, thrown
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
/** The target's one GitHub integration — the `--integration` half M1 spells. */
const GH = 'gh-popmechanic-smoke'
/** How a real target's `origin` is spelled; three other spellings are checked below. */
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-03T22:15:00.000Z')
const PLAN_TEXT = '# a plan\n\nOne task, and a trailing newline.\n'
const VERDICTS_TEXT = '{"verdict":"green","gates":[]}\n'
/** The seed the base commit carries, so "the base's tree, otherwise" has shape. */
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n' }
/** The plan's own pool, sized by the config when no flag says otherwise. */
const CONFIG = { ...FLEET_DEFAULTS }
/** `billing plan --json`, as measured 2026-09-04. */
const BILLING_OK = {
  max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual'
}

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── The seam's rules ────────────────────────────────────────────────────────

/** `new … --json` answers the row for whatever name the line asked for. */
const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

/** The engine tip, when a launch reads it rather than taking `--engine`. */
const ENGINE_RULE = {
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${ENGINE}\tHEAD\n`)
}

/**
 * The launcher names the target's remote the way an operator's checkout spells
 * it; the seam points that name at the bare repository the exam really made and
 * runs the command for real. The command the launcher issued is what the exec
 * log records, so the refspec and the ordering are still its own.
 */
const localRemote = (repo) => ({
  when: (cmd, argv) => cmd === 'git' &&
    (argv.includes('push') || argv.includes('ls-remote')) &&
    !argv.includes('--get-url') &&
    !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => defaultExec(
    'git',
    argv.map((a) => (a === 'origin' || /github\.com/.test(String(a)) ? repo.origin : a)),
    options ?? {}
  )
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

const readRules = ({
  repo,
  integrations = [{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }],
  billing = BILLING_OK,
  newVerb = NEW_OK
} = {}) => [
  ENGINE_RULE,
  ...(repo ? [localRemote(repo)] : []),
  sshRule('integrations list --json', answer(integrations)),
  sshRule('billing plan --json', answer(billing)),
  sshRule('new ', newVerb),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The workspace: a real target repository and a plan beside it ────────────

function workspace ({ verdicts = true, refs = [], origin = ORIGIN_URL } = {}) {
  const root = tempDir('fleet-launch-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  for (const ref of refs) repo.git(['push', repo.origin, `${repo.base}:refs/heads/${ref}`])
  repo.git(['remote', 'set-url', 'origin', origin])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
  if (verdicts) fs.writeFileSync(path.join(planDir, 'a-plan.gate-verdicts.json'), VERDICTS_TEXT)
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

const argvFor = (ws, extra = []) => [
  ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
  '--engine', ENGINE, ...extra
]

const launchIn = (ws, {
  argv, exec, sleep = async () => {}, config = CONFIG,
  refreshCredential = () => ({ ok: true })
} = {}) => launch({
  argv: argv ?? argvFor(ws), exec, config, now: () => NOW, sleep, refreshCredential
})

/** A green launch with the default rules; answers the result and its seam. */
async function greenLaunch (ws, { extra = [], rules = {} } = {}) {
  const exec = makeExec({ rules: readRules({ repo: ws.repo, ...rules }) })
  const result = await launchIn(ws, { argv: argvFor(ws, extra), exec })
  return { result, exec }
}

const newLines = (exec) => exec.lobby().filter((line) => line.startsWith('new '))
const nameOf = (line) => /--name (\S+)/.exec(line)?.[1] ?? null
const indexOf = (exec, pred) => exec.calls.findIndex(pred)

// ── 0. [M6] the bridge is gone; [M5] the usage string ───────────────────────
{
  // The two shim paths, and the two spellings that name them, are assembled
  // from fragments: this file lives under `fleet/`, and the same scan that
  // sweeps the tree sweeps it.
  const HY = '-'
  const shimModule = path.join(FLEET_DIR, `${'fleet'}${HY}${'runs'}.mjs`)
  const shimHelpers = path.join(FLEET_DIR, 'tests', `_${'fleet'}_${'runs'}_helpers.mjs`)
  assert.ok(!fs.existsSync(shimModule), '(0) [M6] the split-out clone module does not exist')
  assert.ok(!fs.existsSync(shimHelpers), '(0) [M6] nor does its test helper')

  const references = new RegExp([
    `${'fleet'}${HY}${'runs'}\\.mjs`,
    `_${'fleet'}_${'runs'}_helpers`
  ].join('|'))
  const bannedSpellings = [
    `${'fleet'}${HY}${'runs'}`,
    `${'fleet'}${'Runs'}`,
    `${'fleet'}${HY}${'golden'}`,
    `${'golden'}${HY}${'setup'}`,
    `${'golden'}\\.${'sh'}`,
    `${HY}${HY}${'copy'}${HY}${'tags'}`,
    `${'vm'}${'TokenPath'}`
  ]
  const banned = new RegExp(bannedSpellings.join('|'))

  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
  const swept = walk(FLEET_DIR)
  assert.ok(swept.length > 0, '(0) [M6] the sweep found files under fleet/')
  for (const file of swept) {
    const rel = path.relative(FLEET_DIR, file)
    const text = fs.readFileSync(file, 'utf8')
    assert.ok(!references.test(text), `(0) [M6] fleet/${rel} still names a deleted shim`)
    assert.ok(!banned.test(text), `(0) [M6] fleet/${rel} still carries a banned string`)
  }

  const targetSource = fs.readFileSync(path.join(FLEET_DIR, 'target.mjs'), 'utf8')
  assert.ok(
    targetSource.includes('No GitHub integration rides `tag:fleet`'),
    '(0) [M6] target.mjs says that no GitHub integration rides `tag:fleet` — deleting the old sentence is not enough'
  )

  for (const flag of ['--repo', '--cpu', '--memory']) {
    assert.ok(USAGE.includes(flag), `(0) [M5] the usage string names ${flag}`)
  }
  assert.ok(!USAGE.includes('--golden'), '(0) [M5] and no longer names --golden')
}

// ── a. [M1] one mutating verb: the `new` line, with the script on its stdin ──
{
  const ws = workspace()
  const { result, exec } = await greenLaunch(ws)

  assert.equal(result.run, 1, '(a) [M3] an origin with no ultra/ ref is run 1')
  assert.ok(isVmName(result.vm), '(a) [M1] the VM is one incarnation, fleet-r<N>-<yymmddHHMM>-<4 hex>')
  assert.equal(runOfVmName(result.vm), 1, '(a) [M1] named for the run')

  const expectedComment =
    `run=1 plan=${result.plan} target=${TARGET} base=${ws.repo.base} engine=${ENGINE}`
  const expectedNew = `new --name ${result.vm} --tag fleet --comment '${expectedComment}'` +
    ` --integration claude-max,${GH} --cpu 8 --memory 16GB --setup-script /dev/stdin --json`

  assert.deepEqual(
    exec.mutating(), [expectedNew],
    '(a) [M1] exactly one mutating lobby verb, and it is the `new` line M1 spells'
  )
  assert.equal(result.comment, expectedComment, '(a) [M1] the assignment the `new` line carries')
  assert.equal(
    (newLines(exec)[0].match(/'/g) ?? []).length, 2,
    '(a) [M1] the comment is quoted once — one pair of quotes on the whole line'
  )

  const newCall = exec.calls.find((c) => c.cmd === 'ssh' && String(c.argv[1] ?? '').startsWith('new '))
  assert.equal(
    newCall.options?.input,
    renderSetupScript({ run: '1', ...readFleetFiles() }),
    "(a) [M1] the rendered setup script for run 1 is on that call's stdin"
  )

  assert.deepEqual(
    exec.lobby().filter((l) => l.startsWith('cp ')), [],
    '(a) [M1] no `cp` — the run is a plain `new` on the default image'
  )
  assert.deepEqual(
    exec.lobby().filter((l) => l.startsWith('integrations attach')), [],
    '(a) [M1] no `integrations attach` — the integrations ride the `new` line'
  )
  assert.deepEqual(
    exec.lobby().filter((l) => l.startsWith('comment ')), [],
    '(a) [M1] no `comment` verb — the comment rides the `new` line'
  )
  assert.deepEqual(
    exec.vm(), [],
    '(a) [M1] and nothing is ssh-ed into the VM: the setup script starts the run'
  )

  // "after its reads": the two lobby reads M2 names both precede the mutation.
  const newAt = indexOf(exec, (c) => String(c.argv[1] ?? '').startsWith('new '))
  const listAt = indexOf(exec, (c) => c.argv[1] === 'integrations list --json')
  const billingAt = indexOf(exec, (c) => c.argv[1] === 'billing plan --json')
  assert.ok(listAt >= 0 && listAt < newAt, '(a) [M1] `integrations list --json` is read before the `new`')
  assert.ok(billingAt >= 0 && billingAt < newAt, '(a) [M1] and so is `billing plan --json`')
  for (const call of exec.calls) {
    assert.notEqual(call.cmd, 'sh', '(a) [M1] nothing goes through a local shell')
    assert.notEqual(call.cmd, 'bash', '(a) [M1] nothing goes through a local shell')
  }
  ws.cleanup()
}

// ── b. [M2] the refusals: exit 2, nothing mutated, no push and no `new` ─────
{
  const cases = [
    {
      name: 'a --repo whose origin is another repository',
      origin: 'https://github.com/someone/else.git',
      argv: (ws) => argvFor(ws)
    },
    {
      name: 'a --base the clone does not have',
      argv: (ws) => [ws.planPath, '--target', TARGET, '--base', 'f'.repeat(40),
        '--repo', ws.repo.dir, '--engine', ENGINE]
    },
    {
      name: `an integrations list without ${GH}`,
      argv: (ws) => argvFor(ws),
      rules: { integrations: [{ name: 'claude-max', attachments: [] }] }
    },
    {
      name: 'a billing answer with max_cpus 4 against --cpu 8',
      argv: (ws) => argvFor(ws, ['--cpu', '8']),
      rules: { billing: { ...BILLING_OK, max_cpus: 4 } }
    },
    {
      name: 'a billing answer with max_memory_gb 8 against 16GB',
      argv: (ws) => argvFor(ws, ['--memory', '16GB']),
      rules: { billing: { ...BILLING_OK, max_memory_gb: 8 } }
    },
    { name: '--memory 16, with no unit', argv: (ws) => argvFor(ws, ['--memory', '16']) },
    { name: '--cpu 0', argv: (ws) => argvFor(ws, ['--cpu', '0']) },
    { name: '--cpu abc', argv: (ws) => argvFor(ws, ['--cpu', 'abc']) },
    { name: '--memory 0GB', argv: (ws) => argvFor(ws, ['--memory', '0GB']) },
    {
      name: 'a config memory that is not <int>GB',
      argv: (ws) => argvFor(ws),
      config: { cpu: '8', memory: 'lots' }
    },
    {
      name: 'a config cpu that is not a positive integer',
      argv: (ws) => argvFor(ws),
      config: { cpu: 'many', memory: '16GB' }
    }
  ]

  for (const kase of cases) {
    const ws = workspace(kase.origin ? { origin: kase.origin } : {})
    const exec = makeExec({ rules: readRules({ repo: ws.repo, ...(kase.rules ?? {}) }) })
    const error = await thrown(() => launchIn(ws, {
      argv: kase.argv(ws), exec, config: kase.config ?? CONFIG
    }))
    assert.ok(error, `(b) [M2] ${kase.name} must refuse`)
    assert.ok(
      error instanceof Refusal,
      `(b) [M2] ${kase.name} is a Refusal, got ${error?.name}: ${error?.message}`
    )
    assert.equal(error.exitCode, 2, `(b) [M2] ${kase.name} refuses with exit 2`)
    assert.deepEqual(exec.mutating(), [], `(b) [M2] ${kase.name} mutates nothing on exe.dev`)
    assert.deepEqual(newLines(exec), [], `(b) [M2] ${kase.name} issues no \`new\``)
    assert.ok(
      !exec.calls.some((c) => c.cmd === 'git' && c.argv.includes('push')),
      `(b) [M2] ${kase.name} pushes no plan`
    )
    assert.ok(
      Object.keys(branchesOf(ws)).every((ref) => !ref.startsWith('ultra/')),
      `(b) [M2] ${kase.name} leaves no ultra/ ref on the origin`
    )
    ws.cleanup()
  }

  // The four spellings `origin` may carry all name the same target, so a launch
  // from a checkout carrying any of them goes through.
  for (const url of [
    `https://github.com/${TARGET}.git`,
    `https://github.com/${TARGET}`,
    `git@github.com:${TARGET}.git`,
    `ssh://git@github.com/${TARGET}`
  ]) {
    const ws = workspace({ origin: url })
    const { result } = await greenLaunch(ws)
    assert.equal(result.run, 1, `(b) [M2] origin spelled ${url} names ${TARGET}, so the launch goes through`)
    ws.cleanup()
  }
}

// ── c. [M3] the run number, and the plan commit pushed before `new` ─────────
{
  const numbering = [
    { refs: ['ultra/integration-run-3', 'ultra/evidence-run-71'], run: 72,
      why: 'one past the highest N over all three branch shapes' },
    { refs: ['ultra/plan-run-5'], run: 6, why: 'a lone plan ref' },
    { refs: ['ultra/integration-run-8'], run: 9,
      why: 'a lone integration ref — plan and evidence are not the only shapes read' },
    { refs: ['ultra/plan-run-9', 'ultra/plan-run-10'], run: 11,
      why: '10 is higher than 9 as a number, not as a string' },
    { refs: [], run: 1, why: 'no ultra/ ref at all' }
  ]
  for (const kase of numbering) {
    const ws = workspace({ refs: kase.refs })
    const { result } = await greenLaunch(ws)
    assert.equal(result.run, kase.run, `(c) [M3] ${kase.why}: the run is ${kase.run}`)
    ws.cleanup()
  }

  const forced = workspace({ refs: ['ultra/plan-run-5'] })
  const { result: forcedResult, exec: forcedExec } = await greenLaunch(forced, { extra: ['--run', '9'] })
  assert.equal(forcedResult.run, 9, '(c) [M3] --run overrides the reading')
  assert.equal(
    forcedResult.plan, branchesOf(forced)['ultra/plan-run-9'],
    '(c) [M3] and the plan lands on the branch that number names'
  )
  assert.ok(
    nameOf(newLines(forcedExec)[0]).startsWith('fleet-r9-'),
    '(c) [M3] the VM is named for the forced run'
  )
  forced.cleanup()

  // The 72 case, in full: what was pushed, in what order, and what the
  // operator's checkout looks like afterwards.
  const ws = workspace({ refs: ['ultra/integration-run-3', 'ultra/evidence-run-71'] })
  const headBefore = ws.repo.git(['rev-parse', 'HEAD'])
  const { result, exec } = await greenLaunch(ws)

  assert.equal(result.run, 72, '(c) [M3] the run is 72')
  assert.equal(
    ws.repo.git(['status', '--porcelain']), '',
    "(c) [M3] the checkout's working tree and index are untouched"
  )
  assert.equal(ws.repo.git(['rev-parse', 'HEAD']), headBefore, '(c) [M3] and its HEAD is where it was')

  const pushAt = indexOf(exec, (c) => c.cmd === 'git' &&
    c.argv.join(' ').includes(`push origin ${result.plan}:refs/heads/ultra/plan-run-72`))
  const newAt = indexOf(exec, (c) => String(c.argv[1] ?? '').startsWith('new '))
  assert.ok(pushAt >= 0, '(c) [M3] the plan is pushed as `git push origin <sha>:refs/heads/ultra/plan-run-72`')
  assert.ok(newAt >= 0 && pushAt < newAt, '(c) [M3] and the push precedes the `new`')

  assert.match(result.plan, /^[0-9a-f]{40}$/, '(c) [M3] plan= is a sha git made')
  assert.equal(
    branchesOf(ws)['ultra/plan-run-72'], result.plan,
    "(c) [M3] the origin's refs/heads/ultra/plan-run-72 is that commit"
  )
  assert.ok(
    newLines(exec)[0].includes(`plan=${result.plan}`),
    '(c) [M3] the comment on the `new` line carries that sha as plan='
  )
  assert.ok(newLines(exec)[0].includes('run=72'), '(c) [M3] and run=72')

  ws.repo.git(['fetch', ws.repo.origin, 'ultra/plan-run-72'])
  assert.equal(
    ws.repo.git(['rev-parse', `${result.plan}^`]), ws.repo.base,
    "(c) [M3] the commit's parent is <base>"
  )

  const verdictsPath = path.join(path.dirname(ws.planPath), 'a-plan.gate-verdicts.json')
  const planBlob = ws.repo.git(['hash-object', ws.planPath])
  const verdictsBlob = ws.repo.git(['hash-object', verdictsPath])
  const tree = ws.repo.git(['ls-tree', '-r', result.plan]).split('\n')
  assert.ok(
    tree.includes(`100644 blob ${planBlob}\t.ultrapowers/plan.md`),
    '(c) [M3] .ultrapowers/plan.md in the commit is the plan file, byte for byte'
  )
  assert.ok(
    tree.includes(`100644 blob ${verdictsBlob}\t.ultrapowers/gate-verdicts.json`),
    '(c) [M3] and .ultrapowers/gate-verdicts.json is the sibling verdicts file'
  )
  assert.equal(
    ws.repo.git(['show', `${result.plan}:.ultrapowers/plan.md`]), PLAN_TEXT.trim(),
    '(c) [M3] git show reads the plan back'
  )
  assert.equal(
    ws.repo.git(['show', `${result.plan}:.ultrapowers/gate-verdicts.json`]), VERDICTS_TEXT.trim(),
    '(c) [M3] and the verdicts'
  )
  assert.deepEqual(
    tree.filter((line) =>
      !line.endsWith('\t.ultrapowers/plan.md') && !line.endsWith('\t.ultrapowers/gate-verdicts.json')),
    ws.repo.git(['ls-tree', '-r', ws.repo.base]).split('\n'),
    "(c) [M3] the tree is otherwise <base>'s, entry for entry"
  )
  ws.cleanup()

  // No sibling verdicts: the tree is the base's plus exactly one path.
  const bare = workspace({ verdicts: false })
  const { result: bareResult } = await greenLaunch(bare)
  bare.repo.git(['fetch', bare.repo.origin, planBranchFor(bareResult.run)])
  assert.deepEqual(
    bare.repo.git(['ls-tree', '-r', '--name-only', bareResult.plan]).split('\n').sort(),
    [
      ...bare.repo.git(['ls-tree', '-r', '--name-only', bare.repo.base]).split('\n'),
      '.ultrapowers/plan.md'
    ].sort(),
    "(c) [M3] a plan with no sibling verdicts commits the base's tree plus .ultrapowers/plan.md and no other path"
  )
  bare.cleanup()

  // `--repo` defaults to the working directory.
  const here = workspace({ refs: ['ultra/evidence-run-6'] })
  const cwd = process.cwd()
  let defaulted
  try {
    process.chdir(here.repo.dir)
    const exec2 = makeExec({ rules: readRules({ repo: here.repo }) })
    defaulted = await launchIn(here, {
      argv: [here.planPath, '--target', TARGET, '--base', here.repo.base, '--engine', ENGINE],
      exec: exec2
    })
  } finally {
    process.chdir(cwd)
  }
  assert.equal(
    defaulted.run, 7,
    '(c) [M2] --repo defaults to the working directory, whose origin is read the same way'
  )
  here.cleanup()
}

// ── d. [M4] three attempts in all, a fresh name each, 1–3 s between ─────────
{
  const ws = workspace()
  let attempt = 0
  const exec = makeExec({
    rules: readRules({
      repo: ws.repo,
      newVerb: (cmd, argv) => {
        attempt += 1
        return attempt <= 2
          ? answer(`refusal ${attempt}: that name is reserved\n`, { code: 1, stderr: `stderr ${attempt}\n` })
          : NEW_OK(cmd, argv)
      }
    })
  })
  const slept = []
  const result = await launchIn(ws, {
    argv: argvFor(ws), exec, sleep: async (ms) => { slept.push(ms) }
  })

  const names = newLines(exec).map(nameOf)
  assert.equal(names.length, 3, '(d) [M4] a `new` that answers non-zero is retried: three attempts in all')
  assert.equal(new Set(names).size, 3, '(d) [M4] each attempt mints a fresh VM name')
  for (const name of names) {
    assert.ok(isVmName(name), `(d) [M4] ${name} is a well-formed incarnation name`)
    assert.equal(runOfVmName(name), 1, '(d) [M4] all three name run 1')
  }
  assert.equal(result.vm, names[2], '(d) [M4] the result carries the attempt that took')
  assert.equal(slept.length, 2, '(d) [M4] one sleep between attempts')
  for (const ms of slept) {
    assert.ok(ms >= 1000 && ms <= 3000, `(d) [M4] each sleep is 1–3 s, got ${ms} ms`)
  }
  ws.cleanup()

  const doomed = workspace()
  let n = 0
  const exec2 = makeExec({
    rules: readRules({
      repo: doomed.repo,
      newVerb: () => {
        n += 1
        return answer(`refusal number ${n} on stdout\n`, { code: 1, stderr: `refusal number ${n} on stderr\n` })
      }
    })
  })
  const error = await thrown(() => launchIn(doomed, { argv: argvFor(doomed), exec: exec2 }))
  assert.ok(error instanceof LobbyError, `(d) [M4] a third failure is a LobbyError, got ${error?.name}`)
  for (const i of [1, 2, 3]) {
    assert.ok(
      error.message.includes(`refusal number ${i} on stdout`),
      `(d) [M4] the failure carries attempt ${i}'s stdout verbatim`
    )
    assert.ok(
      error.message.includes(`refusal number ${i} on stderr`),
      `(d) [M4] and attempt ${i}'s stderr`
    )
  }
  assert.equal(newLines(exec2).length, 3, '(d) [M4] and no fourth `new` is issued')
  doomed.cleanup()
}

// ── e. [M5] the result the launcher answers ────────────────────────────────
{
  const ws = workspace({ refs: ['ultra/plan-run-41'] })
  const { result, exec } = await greenLaunch(ws, { extra: ['--cpu', '4', '--memory', '8GB'] })

  for (const key of [
    'run', 'runId', 'vm', 'statusUrl', 'comment', 'plan', 'planBranch', 'evidenceBranch',
    'integrationBranch', 'target', 'base', 'engine', 'github', 'cpu', 'memory',
    'launchedAt', 'commands'
  ]) {
    assert.ok(key in result, `(e) [M5] the result carries ${key}`)
  }
  assert.equal(result.run, 42, '(e) [M5] run')
  assert.equal(result.runId, 'run-42', '(e) [M5] runId')
  assert.equal(result.planBranch, planBranchFor(42), '(e) [M5] planBranch is ultra/plan-run-42')
  assert.equal(result.evidenceBranch, evidenceBranchFor(42), '(e) [M5] evidenceBranch is ultra/evidence-run-42')
  assert.equal(result.integrationBranch, integrationBranchFor(42), '(e) [M5] integrationBranch is ultra/integration-run-42')
  assert.equal(result.statusUrl, statusUrlFor(result.vm), '(e) [M5] statusUrl is the VM name')
  assert.equal(result.target, TARGET, '(e) [M5] target')
  assert.equal(result.base, ws.repo.base, '(e) [M5] base')
  assert.equal(result.engine, ENGINE, '(e) [M5] engine')
  assert.equal(result.github, GH, '(e) [M5] github names the object the run rides')
  assert.equal(String(result.cpu), '4', '(e) [M5] cpu comes from --cpu')
  assert.equal(String(result.memory), '8GB', '(e) [M5] memory comes from --memory, unit and all')
  assert.equal(result.launchedAt, NOW.toISOString(), '(e) [M5] launchedAt')
  assert.ok(Array.isArray(result.commands) && result.commands.length > 0, '(e) [M5] commands')
  assert.equal(result.plan, branchesOf(ws)['ultra/plan-run-42'], '(e) [M5] plan is the pushed commit')
  assert.ok(
    newLines(exec)[0].includes('--cpu 4 --memory 8GB'),
    '(e) [M1] and the `new` line asks for that size'
  )
  assert.deepEqual(
    renderLaunch(result).split('\n'),
    [result.runId, result.vm, result.statusUrl, result.comment],
    '(e) [M5] renderLaunch prints the run id, the VM, the status URL and the comment'
  )
  ws.cleanup()

  // `overlap=` and `tier=` are last, and the whole line stays inside 200 bytes.
  const tagged = workspace()
  const { result: taggedResult } = await greenLaunch(tagged, {
    extra: ['--overlap', 'fold', '--tier', 'mostCapable']
  })
  assert.equal(
    taggedResult.comment,
    `run=1 plan=${taggedResult.plan} target=${TARGET} base=${tagged.repo.base} engine=${ENGINE} overlap=fold tier=mostCapable`,
    '(e) [M5] the comment keys, in contract order, with the optional two last'
  )
  assert.ok(
    Buffer.byteLength(taggedResult.comment, 'utf8') <= 200,
    '(e) [M5] inside the 200-byte ceiling'
  )
  tagged.cleanup()
}

console.log('ALL TESTS PASSED')
