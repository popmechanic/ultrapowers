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
 * The launch line also names the keychain entry the run signs in with, and
 * prints the verb-drift preflight. Those legs are lettered as their own task
 * spells them — (a) [M1 account], (b) [M2 credential], (c) [M3 lines],
 * (d) [M4 drift] — and the mnemonic in the bracket tells them apart from the
 * clause numbers the groups above carry:
 *
 *   (a) [M1 account] `USAGE` names `--account`; the account is the flag, else
 *       the config's, else `ultrapowers`; a missing or ill-formed value is a
 *       `Refusal` before any command runs — groups 0, b and f;
 *   (b) [M2 credential] the seam is called once, with that name, after the
 *       integrations read and before the push; `{ ok: false }` is a
 *       `LobbyError` before any push and any `new`; and
 *       `defaultRefreshCredential(account, spawn)`'s argv and its three
 *       answers — group g;
 *   (c) [M3 lines] the result's `account` and `verbDrift`, the two rendered
 *       lines, and the assignment comment that carries neither — groups e, h;
 *   (d) [M4 drift] the `help <verb>` reads, where they sit, and that no drift
 *       and no unreadable record changes the launch's outcome or its mutating
 *       verbs — group i.
 *
 * The launcher also refuses a `--base` that is not on the target's default
 * branch, and a launch clone that is shallow. Those legs are lettered as their
 * own task spells them — group j:
 *
 *   (a) [M1] a side-branch `--base`: `ls-remote --symref origin HEAD`,
 *       `fetch origin main` and `merge-base --is-ancestor <base> <tip>`, in
 *       that order and all after the `rev-parse --verify` read, and a `Refusal`
 *       naming the base, the tip and the fix text;
 *   (b) [M2] a `--depth 1` launch clone: refused before the `ls-remote`, with
 *       no `--unshallow` and no `--depth` of the launcher's own;
 *   (c) [M3] a green launch still mutates one verb, and the fetch moves
 *       `refs/remotes/origin/<default>` and nothing else in the clone.
 *
 * Nothing here opens a network socket. Every `ssh` goes through the injected
 * exec seam. The target is a real repository — `makeTargetRepo`'s bare origin
 * and its clone — whose `origin` is spelled the way a real target's is, and the
 * seam rewrites the remote of the launcher's own `ls-remote` and `push` to that
 * bare path and runs them for real: the push is a real push, `plan=` is a sha
 * git made, and the refs the launcher reads are the origin's own. The keychain
 * is never touched either: every launch is handed a `refreshCredential` spy,
 * and `defaultRefreshCredential` is exercised with a spawner of the exam's own.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { USAGE, defaultRefreshCredential, launch, renderLaunch } from '../launch.mjs'
import { fleetConfigAccount } from '../doctor.mjs'
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

/** The verb record the preflight compares the lobby against, read once. */
const VERBS_PATH = path.join(FLEET_DIR, 'exe-verbs.json')
const VERBS = JSON.parse(fs.readFileSync(VERBS_PATH, 'utf8'))
const VERB_NAMES = Object.keys(VERBS.verbs)
/** The two lines a launch with no `--account` adds, verbatim. */
const ACCOUNT_LINE = 'account=ultrapowers'
const DRIFT_LINE = 'verb-drift: 12 verbs match fleet/exe-verbs.json (captured 2026-09-05)'

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
 * `origin` pointed at the bare repository the exam really made. A bare
 * `fetch origin <branch>` is additionally spelled out with the refspec a
 * *configured* remote supplies for it, because git only updates
 * `refs/remotes/origin/<branch>` when the remote is named rather than given as
 * a URL — and that one ref moving, and nothing else moving, is what leg (j.c)
 * [M3] measures. The exec log still records the argv the launcher issued.
 */
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

/**
 * The launcher names the target's remote the way an operator's checkout spells
 * it; the seam points that name at the bare repository the exam really made and
 * runs the command for real. The command the launcher issued is what the exec
 * log records, so the refspec and the ordering are still its own. `fetch` is on
 * this rule as well as `push` and `ls-remote`, so the launcher's default-branch
 * fetch reaches the bare origin instead of the offline rule below.
 */
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

/**
 * `help <verb>` as the lobby prints it: a `Command:` line, an `Options:` block
 * and one indented `--flag` line per flag. The flags are the record's own, so a
 * launch over this rule finds no drift; a leg that wants one overrides the rule
 * for the one verb it is about.
 */
const helpText = (verb, flags) => [
  `Command: ${verb}`,
  '',
  'Options:',
  ...flags.map((flag) => `  ${flag}  what ${flag} does`),
  ''
].join('\n')

/** The verb a `help <verb>` remote command asked about. */
const verbOf = (argv) => String(argv[1] ?? '').slice('help '.length)

/** Every verb of `record` answered with the flags `record` has for it. */
const helpFrom = (record) => (cmd, argv) => {
  const verb = verbOf(argv)
  const flags = record.verbs[verb]
  return flags
    ? answer(helpText(verb, flags))
    : answer(`No help available for unrecognized command: ${verb}\n`)
}

/** The shipped record, answered back: the lobby the record was captured from. */
const HELP_OK = helpFrom(VERBS)

const readRules = ({
  repo,
  integrations = [{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }],
  billing = BILLING_OK,
  newVerb = NEW_OK,
  help = HELP_OK
} = {}) => [
  ENGINE_RULE,
  ...(repo ? [localRemote(repo)] : []),
  ...(help === null ? [] : [sshRule('help ', help)]),
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

/**
 * The credential seam, recording the account it was handed and how many
 * commands the launch had issued when it was called — so a leg can say where
 * the refresh sits among `exec.calls` without the seam knowing about them.
 * Nothing here spawns the credential tool, so no keychain is read.
 */
const refreshSpy = (exec, reply = { ok: true }) => {
  const spy = (account) => {
    spy.calls.push({ account, at: exec ? exec.calls.length : -1 })
    return typeof reply === 'function' ? reply(account) : reply
  }
  spy.calls = []
  return spy
}

const launchIn = (ws, {
  argv, exec, sleep = async () => {}, config = CONFIG,
  refreshCredential = refreshSpy(exec), verbsPath
} = {}) => launch({
  argv: argv ?? argvFor(ws), exec, config, now: () => NOW, sleep, refreshCredential, verbsPath
})

/** A green launch with the default rules; answers the result and its seams. */
async function greenLaunch (ws, { extra = [], rules = {}, config, refresh, verbsPath } = {}) {
  const exec = makeExec({ rules: readRules({ repo: ws.repo, ...rules }) })
  const refreshCredential = refresh ?? refreshSpy(exec)
  const result = await launchIn(ws, {
    argv: argvFor(ws, extra),
    exec,
    refreshCredential,
    verbsPath,
    ...(config === undefined ? {} : { config })
  })
  return { result, exec, refresh: refreshCredential }
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

  assert.ok(
    USAGE.includes('--account'),
    '(a) [M1 account] the usage string names --account: the launch line is where the per-run keychain entry is chosen'
  )
  assert.ok(
    USAGE.includes('--account <name>'),
    '(a) [M1 account] and spells its value <name>, the way the credential tool takes it'
  )

  // The fixture the two rendered lines are pinned against: the shipped record's
  // twelve verbs, captured the day the account landed.
  assert.equal(VERB_NAMES.length, 12, '(d) [M4 drift] fleet/exe-verbs.json records twelve verbs')
  assert.equal(VERBS.capturedAt, '2026-09-05', '(d) [M4 drift] captured 2026-09-05')
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
    },
    // The account rides `--comment account=` on the edge and is the keychain
    // item's own `acct`, so a name that is not `^[A-Za-z0-9][A-Za-z0-9._-]*$`
    // is refused before anything is executed rather than interpolated into a
    // remote command string. `--account` last on the line takes no value at
    // all, which is the same refusal.
    { name: '--account with no value', argv: (ws) => argvFor(ws, ['--account']), account: true },
    { name: "--account 'bad name'", argv: (ws) => argvFor(ws, ['--account', 'bad name']), account: true },
    { name: '--account -x', argv: (ws) => argvFor(ws, ['--account', '-x']), account: true },
    { name: '--account .x', argv: (ws) => argvFor(ws, ['--account', '.x']), account: true },
    { name: "--account 'a;b'", argv: (ws) => argvFor(ws, ['--account', 'a;b']), account: true }
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
    if (kase.account) {
      assert.ok(
        error.message.includes('--account'),
        `(a) [M1 account] ${kase.name} names --account in the refusal, got ${JSON.stringify(error.message)}`
      )
      assert.deepEqual(
        exec.calls.map((c) => c.line), [],
        `(a) [M1 account] ${kase.name} refuses before any command is executed`
      )
    }
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
  assert.ok('account' in result, '(c) [M3 lines] the result carries account')
  assert.equal(result.account, 'ultrapowers', '(c) [M3 lines] `ultrapowers` when nothing named another')
  assert.ok('verbDrift' in result, '(c) [M3 lines] and verbDrift, the object verbDrift answered')
  assert.equal(
    result.verbDrift.readable, true,
    '(c) [M3 lines] whose readable is true: the shipped record was read'
  )
  assert.deepEqual(
    renderLaunch(result).split('\n'),
    [result.runId, result.vm, result.statusUrl, result.comment, ACCOUNT_LINE, DRIFT_LINE],
    '(c) [M3 lines] renderLaunch prints the run id, the VM, the status URL and the comment, then account= and the verb-drift preflight'
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

// ── f. (a) [M1 account] which entry the launch names ───────────────────────
{
  const ws = workspace()
  const { result: flagged } = await greenLaunch(ws, { extra: ['--account', 'b'] })
  assert.equal(flagged.account, 'b', '(a) [M1 account] --account b names b')
  ws.cleanup()

  const over = workspace()
  const { result: overridden } = await greenLaunch(over, {
    extra: ['--account', 'b'], config: { ...CONFIG, account: 'c' }
  })
  assert.equal(
    overridden.account, 'b',
    "(a) [M1 account] --account b over a config carrying account 'c' is b, not c: the flag is the per-run choice"
  )
  over.cleanup()

  const configured = workspace()
  const { result: fromConfig } = await greenLaunch(configured, {
    config: { ...CONFIG, account: 'c' }
  })
  assert.equal(
    fromConfig.account, 'c',
    "(a) [M1 account] no flag and an injected config carrying account 'c' is c"
  )
  configured.cleanup()

  const bare = workspace()
  const { result: defaulted } = await greenLaunch(bare)
  assert.equal(
    defaulted.account, 'ultrapowers',
    '(a) [M1 account] neither flag nor config account is `ultrapowers`, the entry BASE reads and writes'
  )
  bare.cleanup()

  // No injected config: the file `--config` names is read, and its `account` is
  // the one `fleetConfigAccount` answers over that same path.
  const filed = workspace()
  const configPath = path.join(filed.root, 'fleet.json')
  fs.writeFileSync(configPath, '{"cpu":"8","memory":"16GB","account":"d"}')
  const execFiled = makeExec({ rules: readRules({ repo: filed.repo }) })
  const fromFile = await launchIn(filed, {
    argv: argvFor(filed, ['--config', configPath]), exec: execFiled, config: null
  })
  assert.equal(
    await fleetConfigAccount({ path: configPath }), 'd',
    "(a) [M1 account] fleetConfigAccount reads the file's account"
  )
  assert.equal(
    fromFile.account, 'd',
    '(a) [M1 account] and a launch with no injected config takes the account off the file --config names'
  )
  filed.cleanup()

  const dotted = workspace()
  const { result: punctuated } = await greenLaunch(dotted, { extra: ['--account', 'a.b-c_d'] })
  assert.equal(
    punctuated.account, 'a.b-c_d',
    '(a) [M1 account] a name of letters, digits, dot, dash and underscore goes through'
  )
  dotted.cleanup()
}

// ── g. (b) [M2 credential] the seam: its name, its place, its answers ───────
{
  const ws = workspace()
  const { result, exec, refresh } = await greenLaunch(ws, { extra: ['--account', 'b'] })
  assert.equal(refresh.calls.length, 1, '(b) [M2 credential] the seam is called exactly once')
  assert.equal(
    refresh.calls[0].account, 'b',
    '(b) [M2 credential] with the account the launch chose'
  )

  const listAt = indexOf(exec, (c) => c.argv[1] === 'integrations list --json')
  const pushAt = indexOf(exec, (c) => c.cmd === 'git' && c.argv.includes('push'))
  const at = refresh.calls[0].at
  assert.ok(listAt >= 0, '(b) [M2 credential] the integrations read happened')
  assert.ok(pushAt >= 0, '(b) [M2 credential] and the plan push')
  assert.ok(
    at > listAt,
    `(b) [M2 credential] the refresh is after the integrations list --json read: that read is call ${listAt}, the refresh came after call ${at}`
  )
  assert.ok(
    at <= pushAt,
    `(b) [M2 credential] and before the plan is pushed: the push is call ${pushAt}, the refresh came after call ${at}`
  )
  assert.ok(isVmName(result.vm), '(b) [M2 credential] and the launch went through')
  ws.cleanup()

  const plain = workspace()
  const { refresh: bareSeam } = await greenLaunch(plain)
  assert.equal(bareSeam.calls.length, 1, '(b) [M2 credential] a bare launch calls the seam once too')
  assert.equal(
    bareSeam.calls[0].account, 'ultrapowers',
    '(b) [M2 credential] with `ultrapowers`: the BASE item is read and written as at BASE when no --account is given'
  )
  plain.cleanup()

  // A refusal from the seam is a failure before any VM and before any push.
  const doomed = workspace()
  const execDoomed = makeExec({ rules: readRules({ repo: doomed.repo }) })
  const seam = refreshSpy(execDoomed, { ok: false, out: 'x' })
  const error = await thrown(() => launchIn(doomed, { exec: execDoomed, refreshCredential: seam }))
  assert.ok(
    error instanceof LobbyError,
    `(b) [M2 credential] a { ok: false } answer is a LobbyError, got ${error?.name}: ${error?.message}`
  )
  assert.deepEqual(newLines(execDoomed), [], '(b) [M2 credential] with no `new` issued')
  assert.deepEqual(execDoomed.mutating(), [], '(b) [M2 credential] and nothing else mutated')
  assert.ok(
    !execDoomed.calls.some((c) => c.cmd === 'git' && c.argv.includes('push')),
    '(b) [M2 credential] and no plan pushed'
  )
  assert.ok(
    Object.keys(branchesOf(doomed)).every((ref) => !ref.startsWith('ultra/')),
    '(b) [M2 credential] so the target carries no ultra/ ref'
  )
  doomed.cleanup()
}

// ── g2. (b) [M2 credential] defaultRefreshCredential's argv and its answers ─
{
  /** A spawner of the exam's own: the credential tool never runs, so the
   *  keychain is never read and no token is ever printed. */
  const spawnSpy = (res) => {
    const spy = (file, argv, options) => {
      spy.calls.push({ file, argv, options })
      return res
    }
    spy.calls = []
    return spy
  }

  const green = spawnSpy({ status: 0, stdout: 'claude-max: refreshed b\n', stderr: '' })
  const ok = defaultRefreshCredential('b', green)
  assert.equal(green.calls.length, 1, '(b) [M2 credential] defaultRefreshCredential spawns exactly once')
  assert.equal(
    green.calls[0].file, process.execPath,
    '(b) [M2 credential] the node that is running this exam'
  )
  assert.deepEqual(
    green.calls[0].argv.slice(-3), ['refresh', '--account', 'b'],
    '(b) [M2 credential] and asks it to refresh --account b'
  )
  assert.ok(
    String(green.calls[0].argv[0]).endsWith('claude-token.mjs'),
    `(b) [M2 credential] the script is claude-token.mjs, got ${JSON.stringify(green.calls[0].argv[0])}`
  )
  assert.ok(
    fs.existsSync(green.calls[0].argv[0]),
    "(b) [M2 credential] the fleet dir's own copy of it, a file that exists"
  )
  assert.equal(
    green.calls[0].argv.length, 4,
    '(b) [M2 credential] and nothing else on the line'
  )
  assert.equal(ok.ok, true, '(b) [M2 credential] status 0 answers { ok: true }')
  assert.notEqual(ok.skipped, true, '(b) [M2 credential] and is not a skip')

  const none = spawnSpy({
    status: 1, stdout: '', stderr: 'claude-max: no refresh token in the keychain\n'
  })
  const skipped = defaultRefreshCredential('b', none)
  assert.equal(skipped.ok, true, '(b) [M2 credential] `no refresh token in the keychain` is not fatal')
  assert.equal(
    skipped.skipped, true,
    '(b) [M2 credential] it answers { ok: true, skipped: true }: a laptop set up with `claude setup-token` has no record to rotate'
  )

  const failed = spawnSpy({
    status: 1, stdout: '', stderr: 'claude-max: the refresh endpoint answered 400\n'
  })
  const bad = defaultRefreshCredential('b', failed)
  assert.equal(
    bad.ok, false,
    '(b) [M2 credential] any other non-zero answer is { ok: false }'
  )
  assert.ok(
    String(bad.out ?? '').includes('the refresh endpoint answered 400'),
    "(b) [M2 credential] carrying the tool's own words, so the operator can read what failed"
  )
}

// ── h. (c) [M3 lines] the comment is BASE's, account= or no ────────────────
{
  const plain = workspace()
  const { result: bare } = await greenLaunch(plain)
  const named = workspace()
  const { result: withAccount, exec } = await greenLaunch(named, { extra: ['--account', 'b'] })

  assert.equal(
    bare.comment,
    `run=1 plan=${bare.plan} target=${TARGET} base=${plain.repo.base} engine=${ENGINE}`,
    "(c) [M3 lines] a bare launch's comment is BASE's five keys"
  )
  assert.equal(
    withAccount.comment,
    `run=1 plan=${withAccount.plan} target=${TARGET} base=${named.repo.base} engine=${ENGINE}`,
    '(c) [M3 lines] and --account b changes not one byte of it'
  )
  // The two launches necessarily commit different plan shas onto different
  // bases, so the comparison is over the same plan sha and the same base:
  // everything else in the two comments is compared verbatim.
  const shapeOf = (result, ws) =>
    result.comment.replaceAll(result.plan, '<plan>').replaceAll(ws.repo.base, '<base>')
  assert.equal(
    shapeOf(withAccount, named), shapeOf(bare, plain),
    "(c) [M3 lines] the --account b comment is byte-identical to the comment the same launch built without the flag"
  )
  assert.ok(
    !withAccount.comment.includes('account='),
    '(c) [M3 lines] it carries no account=: sandbox-boot.sh fails an assignment with an unknown key'
  )
  assert.ok(
    !newLines(exec)[0].includes('account='),
    '(c) [M3 lines] and neither does the `new` line that carries it'
  )
  assert.equal(withAccount.account, 'b', '(c) [M3 lines] the account is on the result instead')
  assert.deepEqual(
    renderLaunch(withAccount).split('\n'),
    [
      withAccount.runId, withAccount.vm, withAccount.statusUrl, withAccount.comment,
      'account=b', DRIFT_LINE
    ],
    '(c) [M3 lines] and on the launch line, after the comment: account=b, then the verb-drift preflight'
  )
  plain.cleanup()
  named.cleanup()
}

// ── i. (d) [M4 drift] the preflight reads, and what a drift does not do ────
{
  // The reads, where they sit, and the lobby a green launch issues.
  const ws = workspace()
  const { result, exec } = await greenLaunch(ws)

  assert.deepEqual(
    exec.lobby().filter((line) => line.startsWith('help ')),
    VERB_NAMES.map((verb) => `help ${verb}`),
    '(d) [M4 drift] one `help <verb>` read per verb of the record, through the lobby seam'
  )
  const listAt = indexOf(exec, (c) => c.argv[1] === 'integrations list --json')
  const lsAt = indexOf(exec, (c) => String(c.argv[1] ?? '').startsWith("ls '"))
  const helpAt = exec.calls
    .map((c, i) => (String(c.argv[1] ?? '').startsWith('help ') ? i : -1))
    .filter((i) => i >= 0)
  assert.ok(lsAt >= 0, "(d) [M4 drift] the reap's `ls` read happened")
  assert.ok(
    listAt >= 0 && listAt < helpAt[0],
    `(d) [M4 drift] the reads come after the integrations list --json read: that read is call ${listAt}, the first help is call ${helpAt[0]}`
  )
  assert.ok(
    helpAt[helpAt.length - 1] < lsAt,
    `(d) [M4 drift] and before the reap's ls: the last help is call ${helpAt[helpAt.length - 1]}, the ls is call ${lsAt}`
  )

  const nonHelp = exec.lobby().filter((line) => !line.startsWith('help '))
  assert.deepEqual(
    nonHelp.slice(0, 3),
    ['integrations list --json', 'billing plan --json', "ls 'fleet-r*' --json"],
    "(d) [M4 drift] the lobby a green launch issues is BASE's, plus the help reads"
  )
  assert.equal(nonHelp.length, 4, '(d) [M4 drift] four lobby commands besides them')
  assert.ok(nonHelp[3].startsWith('new '), '(d) [M4 drift] the last of them the `new`')
  assert.equal(exec.mutating().length, 1, '(d) [M4 drift] and `exec.mutating()` is exactly one line')
  assert.ok(
    exec.mutating()[0].startsWith('new '),
    '(d) [M4 drift] the `new …` line: a `help <verb>` read mutates nothing'
  )
  assert.equal(
    result.verbDrift.detail, DRIFT_LINE.slice('verb-drift: '.length),
    '(d) [M4 drift] a lobby answering the record has no finding'
  )
  ws.cleanup()

  // A drift: `rm` no longer answers a flag the record has for it. The record
  // this leg hands the launcher is the shipped one with a second `rm` flag,
  // because `rm` ships with `--json` alone: a help answer with no flag at all
  // is `unreadable`, not `vanished`, so a vanished-flag line needs a record
  // whose verb has another flag left to answer with.
  const drifted = workspace()
  const record = JSON.parse(JSON.stringify(VERBS))
  record.verbs.rm = ['--json', '--force']
  const driftPath = path.join(drifted.root, 'exe-verbs.json')
  fs.writeFileSync(driftPath, JSON.stringify(record))
  const withoutJson = { ...record, verbs: { ...record.verbs, rm: ['--force'] } }
  const { result: driftResult, exec: driftExec } = await greenLaunch(drifted, {
    rules: { help: helpFrom(withoutJson) }, verbsPath: driftPath
  })
  assert.ok(isVmName(driftResult.vm), '(d) [M4 drift] a drift still answers a VM')
  assert.equal(
    driftExec.mutating().length, 1,
    '(d) [M4 drift] and `exec.mutating()` is still the one `new …` line'
  )
  assert.ok(driftExec.mutating()[0].startsWith('new '), '(d) [M4 drift] that one line being the `new`')
  assert.equal(
    renderLaunch(driftResult).split('\n').find((line) => line.startsWith('verb-drift: ')),
    'verb-drift: drift since 2026-09-05: rm: --json vanished',
    '(d) [M4 drift] the rendered line names the verb and the flag that went'
  )
  drifted.cleanup()

  // A `help` that answers non-zero is a finding, not a failure.
  const unread = workspace()
  const { result: unreadResult, exec: unreadExec } = await greenLaunch(unread, {
    rules: {
      help: (cmd, argv) => (verbOf(argv) === 'new'
        ? answer('', { code: 255, stderr: 'exe: help failed\n' })
        : HELP_OK(cmd, argv))
    }
  })
  assert.ok(isVmName(unreadResult.vm), '(d) [M4 drift] a help that answers 255 still answers a VM')
  const unreadLine = renderLaunch(unreadResult).split('\n').find((line) => line.startsWith('verb-drift: '))
  assert.ok(
    unreadLine.includes('new: help unreadable (code 255)'),
    `(d) [M4 drift] and the line carries \`new: help unreadable (code 255)\`, got ${JSON.stringify(unreadLine)}`
  )
  assert.equal(unreadExec.mutating().length, 1, '(d) [M4 drift] one mutating verb still')
  unread.cleanup()

  // No `help` rule at all: every read answers empty, every verb is a finding.
  const silent = workspace()
  const { result: silentResult, exec: silentExec } = await greenLaunch(silent, { rules: { help: null } })
  assert.ok(isVmName(silentResult.vm), '(d) [M4 drift] a lobby that answers nothing still answers a VM')
  assert.equal(silentExec.mutating().length, 1, '(d) [M4 drift] with one mutating verb')
  assert.ok(
    renderLaunch(silentResult).split('\n').some((line) => line.startsWith('verb-drift: ')),
    '(d) [M4 drift] and a verb-drift line all the same'
  )
  silent.cleanup()

  // An unreadable record: nothing to compare the lobby against, and still a run.
  const absent = workspace()
  const missing = path.join(absent.root, 'no-such-record.json')
  const { result: absentResult, exec: absentExec } = await greenLaunch(absent, { verbsPath: missing })
  assert.ok(isVmName(absentResult.vm), '(d) [M4 drift] an absent record still answers a VM')
  assert.equal(absentExec.mutating().length, 1, '(d) [M4 drift] with `exec.mutating()` the one line')
  assert.ok(absentExec.mutating()[0].startsWith('new '), '(d) [M4 drift] the `new …` line')
  assert.equal(
    absentResult.verbDrift.readable, false,
    '(d) [M4 drift] and result.verbDrift.readable false'
  )
  const absentLine = renderLaunch(absentResult).split('\n').find((line) => line.startsWith('verb-drift: '))
  assert.ok(absentLine, '(d) [M4 drift] the launch line still carries a verb-drift line')
  assert.ok(
    absentLine.includes('fleet/exe-verbs.json'),
    `(d) [M4 drift] naming the record it could not read, got ${JSON.stringify(absentLine)}`
  )
  absent.cleanup()
}

// ── j. Task 5: the launcher refuses a base that is not on main ─────────────
//
// The three legs of "The launcher refuses a base that is not on main": a
// `--base` off the default branch (M1), a shallow launch clone (M2), and the
// green launch whose fetch moves one remote-tracking ref and nothing else (M3).
// Every command still goes through the injected seam, and the origin every read
// reaches is the bare repository `makeTargetRepo` built — no socket is opened.
{
  /** The fix text M1 pins, and the shallow refusal's text M2 pins, verbatim. */
  const FIX_TEXT = 'relaunch from main; a parked branch is re-driven as a plan on main, not as a base'
  const SHALLOW_TEXT = 'is a shallow clone — unshallow it by hand and relaunch'

  /**
   * Move the origin's `main` one commit on without touching the launch clone:
   * the commit is built with plumbing and pushed by path, so the clone's HEAD,
   * its `refs/heads/main` and its `refs/remotes/origin/main` all stay where
   * they were. A stale tracking ref is what leg (c) [M3] measures the fetch by,
   * and a tip that is not `<base>` is what leg (a) [M1] names in the refusal.
   */
  const advanceOrigin = (ws) => {
    const tip = ws.repo.git([
      'commit-tree', `${ws.repo.base}^{tree}`, '-p', ws.repo.base, '-m', 'origin moves on'
    ])
    ws.repo.git(['push', ws.repo.origin, `${tip}:refs/heads/main`])
    return tip
  }

  /** A commit on a side branch of the clone: `rev-parse --verify` finds it, and
   *  the origin's `main` does not have it. HEAD is left back on `main`. */
  const parkedCommit = (ws) => {
    ws.repo.git(['checkout', '-q', '-b', 'parked'])
    fs.writeFileSync(path.join(ws.repo.dir, 'parked.txt'), 'work done on a parked branch\n')
    ws.repo.git(['add', '-A'])
    ws.repo.git(['commit', '-m', 'parked work'])
    const sha = ws.repo.git(['rev-parse', 'HEAD'])
    ws.repo.git(['checkout', '-q', 'main'])
    return sha
  }

  /** `git for-each-ref`'s lines as `{ '<refname>': '<sha>' }`. */
  const refMap = (text) => Object.fromEntries(
    text.split('\n').filter((line) => line !== '').map((line) => {
      const [left, name] = line.split('\t')
      return [name, left.split(' ')[0]]
    })
  )

  /** The launch clone as M3 measures it: its refs, its HEAD, its porcelain. */
  const snapshot = (repo) => ({
    refs: refMap(repo.git(['for-each-ref'])),
    head: repo.git(['rev-parse', 'HEAD']),
    porcelain: repo.git(['status', '--porcelain'])
  })

  /** The refs whose sha differs between two snapshots, added and removed ones
   *  included. */
  const changedRefs = (before, after) =>
    [...new Set([...Object.keys(before.refs), ...Object.keys(after.refs)])]
      .filter((name) => before.refs[name] !== after.refs[name])
      .sort()

  /** The index of the first `git` call whose argv, joined, contains `text`. */
  const gitCallAt = (exec, text) =>
    exec.calls.findIndex((c) => c.cmd === 'git' && c.argv.map(String).join(' ').includes(text))

  // ── (a) [M1] a --base on a side branch ──────────────────────────────────
  {
    const ws = workspace()
    const tip = advanceOrigin(ws)
    const parked = parkedCommit(ws)
    assert.notEqual(parked, tip, '(j.a) [M1] the fixture: the parked commit is not the origin\'s tip')
    assert.equal(branchesOf(ws).main, tip, "(j.a) [M1] the fixture: the origin's main is that tip")

    const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
    const error = await thrown(() => launchIn(ws, {
      argv: [ws.planPath, '--target', TARGET, '--base', parked, '--repo', ws.repo.dir,
        '--engine', ENGINE],
      exec
    }))

    assert.ok(
      error,
      '(j.a) [M1] a --base that is a side-branch commit, not an ancestor of the default branch, must be refused'
    )
    assert.ok(
      error instanceof Refusal,
      `(j.a) [M1] and the refusal is a Refusal, got ${error?.name}: ${error?.message}`
    )
    assert.ok(
      error.message.includes(parked),
      `(j.a) [M1] whose message names <base>, the sha it was given, got ${JSON.stringify(error.message)}`
    )
    assert.ok(
      error.message.includes(tip),
      `(j.a) [M1] and <tip>, the default branch's tip it is not on, got ${JSON.stringify(error.message)}`
    )
    assert.ok(
      error.message.includes(FIX_TEXT),
      `(j.a) [M1] and the fix text \`${FIX_TEXT}\` in full, got ${JSON.stringify(error.message)}`
    )

    assert.deepEqual(exec.mutating(), [], '(j.a) [M1] with zero mutating lobby verbs issued')
    assert.deepEqual(newLines(exec), [], '(j.a) [M1] and no `new`')
    assert.ok(
      !exec.calls.some((c) => c.cmd === 'git' && c.argv.includes('push')),
      '(j.a) [M1] and no push: the refusal comes before the plan commit is pushed'
    )
    assert.deepEqual(
      Object.keys(branchesOf(ws)).filter((ref) => ref.startsWith('ultra/plan-run-')), [],
      '(j.a) [M1] so the origin carries no ultra/plan-run-* ref'
    )

    const verifyAt = exec.calls.findIndex((c) =>
      c.cmd === 'git' && c.argv.includes('rev-parse') && c.argv.includes('--verify'))
    const symrefAt = gitCallAt(exec, 'ls-remote --symref origin HEAD')
    const fetchAt = gitCallAt(exec, 'fetch origin main')
    const mergeAt = gitCallAt(exec, `merge-base --is-ancestor ${parked} ${tip}`)

    assert.ok(verifyAt >= 0, '(j.a) [M1] the `rev-parse --verify <base>^{commit}` read still happens')
    assert.ok(symrefAt >= 0, '(j.a) [M1] `git ls-remote --symref origin HEAD` reads the default branch name and tip')
    assert.ok(fetchAt >= 0, '(j.a) [M1] `git fetch origin main` fetches the default branch')
    assert.ok(
      mergeAt >= 0,
      `(j.a) [M1] and \`git merge-base --is-ancestor ${parked} ${tip}\` asks whether the base is on it`
    )
    assert.ok(
      verifyAt < symrefAt,
      `(j.a) [M1] the ls-remote is after the rev-parse --verify read: verify is call ${verifyAt}, ls-remote is call ${symrefAt}`
    )
    assert.ok(
      symrefAt < fetchAt,
      `(j.a) [M1] the fetch is after the ls-remote: ls-remote is call ${symrefAt}, fetch is call ${fetchAt}`
    )
    assert.ok(
      fetchAt < mergeAt,
      `(j.a) [M1] and the merge-base after the fetch: fetch is call ${fetchAt}, merge-base is call ${mergeAt}`
    )
    ws.cleanup()
  }

  // ── (b) [M2] a shallow launch clone ─────────────────────────────────────
  {
    const ws = workspace()
    advanceOrigin(ws)
    // `--depth` needs the `file://` transport; the clone's `origin` is then
    // spelled the way a real target's is, so the launch gets past the origin
    // check and the shallow refusal is the one under test.
    const shallowDir = path.join(ws.root, 'shallow-clone')
    ws.repo.git(['clone', '--quiet', '--depth', '1', `file://${ws.repo.origin}`, shallowDir])
    const gitIn = (argv) => ws.repo.git(['-C', shallowDir, ...argv])
    gitIn(['remote', 'set-url', 'origin', ORIGIN_URL])
    assert.equal(
      gitIn(['rev-parse', '--is-shallow-repository']), 'true',
      '(j.b) [M2] the fixture: the --depth 1 clone is a shallow repository'
    )
    const shallowBase = gitIn(['rev-parse', 'HEAD'])

    const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
    const error = await thrown(() => launchIn(ws, {
      argv: [ws.planPath, '--target', TARGET, '--base', shallowBase, '--repo', shallowDir,
        '--engine', ENGINE],
      exec
    }))

    assert.ok(error, '(j.b) [M2] a launch clone that is shallow must be refused')
    assert.ok(
      error instanceof Refusal,
      `(j.b) [M2] and the refusal is a Refusal, got ${error?.name}: ${error?.message}`
    )
    assert.ok(
      error.message.includes(shallowDir),
      `(j.b) [M2] whose message names the clone's path, got ${JSON.stringify(error.message)}`
    )
    assert.ok(
      error.message.includes(SHALLOW_TEXT),
      `(j.b) [M2] and carries \`${SHALLOW_TEXT}\` in full, got ${JSON.stringify(error.message)}`
    )

    assert.deepEqual(exec.mutating(), [], '(j.b) [M2] with zero mutating lobby verbs issued')
    assert.deepEqual(
      exec.calls.filter((c) => c.argv.some((a) => String(a) === '--unshallow')).map((c) => c.line), [],
      '(j.b) [M2] and no `--unshallow`: unshallowing is the operator\'s to do by hand'
    )
    assert.deepEqual(
      exec.calls.filter((c) => c.argv.some((a) => String(a) === '--depth')).map((c) => c.line), [],
      '(j.b) [M2] and no `--depth` fetch either'
    )
    assert.deepEqual(
      exec.calls
        .filter((c) => c.cmd === 'git' && c.argv.includes('ls-remote') && c.argv.includes('--symref'))
        .map((c) => c.line), [],
      '(j.b) [M2] and no `ls-remote --symref` call: the shallow check comes before it'
    )
    assert.deepEqual(
      Object.keys(branchesOf(ws)).filter((ref) => ref.startsWith('ultra/plan-run-')), [],
      '(j.b) [M2] and the origin carries no ultra/plan-run-* ref'
    )
    ws.cleanup()
  }

  // ── (c) [M3] a green launch: one `new`, and one ref moved ───────────────
  {
    const ws = workspace()
    const tip = advanceOrigin(ws)
    const before = snapshot(ws.repo)
    assert.equal(
      before.refs['refs/remotes/origin/main'], ws.repo.base,
      "(j.c) [M3] the fixture: the clone's tracking ref is behind the origin before the launch"
    )

    const { result, exec } = await greenLaunch(ws)
    const after = snapshot(ws.repo)

    assert.ok(isVmName(result.vm), '(j.c) [M3] a base that is on the default branch launches')
    assert.equal(exec.mutating().length, 1, '(j.c) [M3] recording exactly one mutating verb')
    assert.ok(
      exec.mutating()[0].startsWith('new '),
      `(j.c) [M3] and that one verb is the \`new …\` line, got ${JSON.stringify(exec.mutating()[0])}`
    )

    assert.deepEqual(
      changedRefs(before, after), ['refs/remotes/origin/main'],
      '(j.c) [M3] the fetch moves refs/remotes/origin/main and no other ref of the launch clone'
    )
    assert.equal(
      after.refs['refs/remotes/origin/main'], tip,
      "(j.c) [M3] which afterward equals the origin's main"
    )
    assert.equal(
      after.refs['refs/remotes/origin/main'], branchesOf(ws).main,
      "(j.c) [M3] read off the origin's own refs"
    )
    assert.equal(
      after.refs['refs/heads/main'], before.refs['refs/heads/main'],
      '(j.c) [M3] the clone\'s local main is where it was'
    )
    assert.equal(after.head, before.head, '(j.c) [M3] its HEAD is where it was')
    assert.equal(before.porcelain, '', '(j.c) [M3] its working tree was clean before the launch')
    assert.equal(after.porcelain, '', '(j.c) [M3] and is clean and identical after it')
    ws.cleanup()
  }
}

console.log('ALL TESTS PASSED')
