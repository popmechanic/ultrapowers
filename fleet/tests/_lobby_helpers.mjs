/**
 * fleet/tests/_lobby_helpers.mjs — the fixture the four laptop CLIs' exams share.
 *
 * Two pieces, and the launch sims' shared rig (at the bottom):
 *
 *   `makeExec` — a recording seam over `cmd`, `argv`, `options`. Every call is
 *   appended to `exec.calls`, options included, so a leg can read the stdin a
 *   lobby verb was given; a matching rule answers it; anything unmatched runs
 *   for real when its command is in `passthrough` (`git`, so a plan commit in a
 *   test is a real commit in a real repository) and otherwise answers empty and
 *   green. No rule ever runs `ssh`, `gh` or `curl`: the exams touch no network.
 *   Two kinds of ssh are told apart by their first argument: `ssh exe.dev …` is
 *   a lobby verb, `ssh <ssh_dest> …` is a command on a VM.
 *
 *   `makeTargetRepo` — a temporary *target* repository with a real bare origin
 *   behind it, so a launch's plan push is a real push, `base` is a sha git
 *   actually made, and `branches()` reads the origin's own refs.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { EXE_HOST, defaultExec } from '../lobby.mjs'
import { simEnv } from './_helpers.mjs'

/** A canned answer. `stdout` may be a string or a value to JSON.stringify. */
export const answer = (stdout = '', { code = 0, stderr = '' } = {}) => ({
  code,
  stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
  stderr
})

const isLobby = (cmd, argv) => cmd === 'ssh' && argv[0] === EXE_HOST
const isVmSsh = (cmd, argv) => cmd === 'ssh' && argv.length > 0 && argv[0] !== EXE_HOST

/** A rule matching one lobby verb by the prefix of its remote command string. */
export const sshRule = (prefix, res) => ({
  when: (cmd, argv) => isLobby(cmd, argv) && String(argv[1] ?? '').startsWith(prefix),
  answer: res
})

/** A rule matching every `ssh <ssh_dest> …` — a command run on a VM. */
export const vmRule = (res) => ({ when: isVmSsh, answer: res })

/** A rule matching a local command by its first argument. */
export const cmdRule = (cmd, first, res) => ({
  when: (c, argv) => c === cmd && argv[0] === first,
  answer: res
})

/** One `ls --json` row in the shape exe.dev documents. `ssh_dest` is
 *  deliberately not `<name>.exe.xyz`, so a tool that derives the destination
 *  from the name instead of reading the row is caught. */
export const vmRow = (name, extra = {}) => ({
  vm_name: name,
  ssh_dest: `exedev@${name}.ssh.exe.xyz`,
  ssh_host: `${name}.ssh.exe.xyz`,
  status: 'running',
  ...extra
})

/** The `ls --json` envelope: fleet rows under `vms`, other people's under `shared_vms`. */
export const vmsPayload = (vms = [], shared = []) => answer({ shared_vms: shared, vms })

/** The ssh arguments after the `-o` options: `{ dest, command }`. */
const vmCall = (argv) => {
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '-o') {
      i += 1
      continue
    }
    rest.push(argv[i])
  }
  return { dest: rest[0], command: rest.slice(1).join(' ') }
}

/**
 * The recording seam. `rules` are tried in order; the first match answers.
 * `passthrough` names commands that really run when nothing matched.
 */
export function makeExec ({ rules = [], passthrough = ['git'] } = {}) {
  const calls = []
  const exec = async (cmd, argv = [], options = undefined) => {
    calls.push({ cmd, argv: [...argv], options, line: `${cmd} ${argv.join(' ')}` })
    for (const rule of rules) {
      if (rule.when(cmd, argv, options)) {
        return typeof rule.answer === 'function' ? rule.answer(cmd, argv, options) : rule.answer
      }
    }
    if (passthrough.includes(cmd)) return defaultExec(cmd, argv, options ?? {})
    return { code: 0, stdout: '', stderr: '' }
  }
  exec.calls = calls
  /** Every remote command string issued as a lobby verb, in order. */
  exec.lobby = () => calls.filter((c) => isLobby(c.cmd, c.argv)).map((c) => c.argv[1])
  /** Every command run on a VM over ssh, in order, as `{ dest, command }`. */
  exec.vm = () => calls.filter((c) => isVmSsh(c.cmd, c.argv)).map((c) => vmCall(c.argv))
  /** The mutating lobby verbs only — what a refusal must never have issued. */
  exec.mutating = () => exec.lobby().filter((line) =>
    /^(cp|rm|comment|rename|new|tag) /.test(line) || /^integrations (add|attach|detach|edit|policy set) /.test(line)
  )
  return exec
}

// The environment every git below runs under: a HOME of the fixture's own, so
// no ~/.gitconfig of the box reaches a repository an exam builds — each one
// sets its own identity a few lines down. `env` last, so a caller can override.
const GIT_HOME = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fleet-lobby-home-'))
export const gitEnv = (env) => ({ ...simEnv({ home: GIT_HOME }), ...env })

const run = (cwd, argv, env) => {
  const res = spawnSync('git', argv, { cwd, encoding: 'utf8', env: gitEnv(env) })
  if (res.status !== 0) {
    throw new Error(`git ${argv.join(' ')} in ${cwd}: ${res.stdout}${res.stderr}`)
  }
  return res.stdout
}

/** A throwaway directory, removed by `cleanup()`. */
export function tempDir (prefix = 'fleet-lobby-') {
  // realpath: on macOS /tmp is a symlink, and git resolves it — a path git
  // reports would otherwise not compare equal to the one the test built.
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix))
}

/**
 * A real *target* repository: a bare origin with one seed commit on `main`, and
 * a clone of it. `files` is the seed commit's content (default one README);
 * `base` is the sha git made for it, which is what a run's `base=` names.
 *
 *   `origin`     the bare repository's path — the clone's `origin` remote
 *   `dir`        the clone, with `user.name`/`user.email` already set
 *   `git(argv)`  a git command in the clone, answering its trimmed stdout
 *   `branches()` the origin's `refs/heads/*` as `{ '<name>': '<sha>' }`
 *
 * Everything is local git against a path, so a push in an exam is a real push
 * and no socket is opened.
 */
export function makeTargetRepo ({ root, files } = {}) {
  const root_ = root ?? tempDir('fleet-target-')
  const origin = path.join(root_, 'origin.git')
  run(root_, ['init', '--bare', '--initial-branch=main', origin])

  const dir = path.join(root_, 'target')
  run(root_, ['clone', origin, dir])
  run(dir, ['config', 'user.email', 'fleet@example.invalid'])
  run(dir, ['config', 'user.name', 'fleet tests'])
  for (const [rel, body] of Object.entries(files ?? { 'README.md': '# target\n' })) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), body)
  }
  run(dir, ['add', '-A'])
  run(dir, ['commit', '-m', 'seed'])
  run(dir, ['push', 'origin', 'main'])
  const base = run(dir, ['rev-parse', 'HEAD']).trim()

  return {
    base,
    origin,
    dir,
    git: (argv) => run(dir, argv).trim(),
    branches: () => {
      const out = {}
      for (const line of run(dir, ['ls-remote', '--heads', 'origin']).split('\n')) {
        const [sha, ref] = line.split('\t')
        if (!ref) continue
        out[ref.trim().replace(/^refs\/heads\//, '')] = sha.trim()
      }
      return out
    }
  }
}

/**
 * A real *evidence* repository: a bare repository with one seed commit on
 * `main` (the hand archive's branch — no launch may write it), standing in for
 * `https://github.com/<name>.git`. Hand it to `localRemote`/`pointAtOrigin` and
 * that URL is routed here.
 *
 *   `name`            the `<owner>/<repo>` it stands in for
 *   `bare`            the bare repository's path
 *   `git(argv)`       a git command against the bare, answering trimmed stdout
 *   `refs()`          every ref as `{ '<refname>': '<sha>' }`
 *   `seed(ref, files, message)`  a parentless commit of `files` at `ref`; the sha
 */
export function makeEvidenceRepo ({ root, name = 'ops/evidence' } = {}) {
  const root_ = root ?? tempDir('fleet-evidence-')
  const bare = path.join(root_, `evidence-${name.replace('/', '-')}.git`)
  run(root_, ['init', '--bare', '--initial-branch=main', bare])
  const g = (argv, env) => run(bare, argv, env).trim()
  const ident = {
    GIT_AUTHOR_NAME: 'fleet tests', GIT_AUTHOR_EMAIL: 'fleet@example.invalid',
    GIT_COMMITTER_NAME: 'fleet tests', GIT_COMMITTER_EMAIL: 'fleet@example.invalid'
  }
  const seed = (ref, files, message = 'seed') => {
    const index = path.join(tempDir('fleet-evidence-index-'), 'index')
    const env = { ...ident, GIT_INDEX_FILE: index }
    for (const [rel, body] of Object.entries(files)) {
      const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: bare, input: body, encoding: 'utf8', env: gitEnv(env) })
      if (blob.status !== 0) throw new Error(`git hash-object in ${bare}: ${blob.stderr}`)
      g(['update-index', '--add', '--cacheinfo', `100644,${blob.stdout.trim()},${rel}`], env)
    }
    const tree = g(['write-tree'], env)
    const sha = g(['commit-tree', tree, '-m', message], env)
    g(['update-ref', ref, sha])
    fs.rmSync(path.dirname(index), { recursive: true, force: true })
    return sha
  }
  seed('refs/heads/main', { 'archive/README.md': '# the hand archive\n' })
  return {
    name,
    bare,
    git: g,
    seed,
    refs: () => {
      const out = {}
      for (const line of run(bare, ['for-each-ref', '--format=%(refname) %(objectname)']).split('\n')) {
        const [ref, sha] = line.trim().split(' ')
        if (ref) out[ref] = sha
      }
      return out
    }
  }
}

/** Write `runs/<N>/status.json` into a checkout (no commit needed). */
export function writeStatus (dir, run_, status) {
  const target = path.join(dir, 'runs', String(run_))
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, 'status.json'), JSON.stringify(status))
}

/** Remove a temp tree. */
export const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true })

/** Run `body`, answering the error it threw (or null when it did not throw). */
export async function thrown (body) {
  try {
    await body()
  } catch (error) {
    return error
  }
  return null
}

// ── The launch sims' shared rig ─────────────────────────────────────────────
// test_launch_credential/duplicate/evidence/plan_path/probe_runners all drive
// `launch()` over the same seam; what they share lives here, once.

/** An account whose billing caps clear every launch. */
export const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }

const task = (id) => ({
  id: String(id),
  title: `task ${id}`,
  factsheet: {
    files: [`f${id}.txt`], deletes: [], guards: [], proofTests: [], landing: {},
    driverOwned: [], siblingOwned: [], produces: [], consumes: []
  }
})
/** The compiled plan the stubbed compiler answers: one task, one wave. */
export const ONE_TASK = { launch_waves: [[task(1)]], dag_edges: [] }

/** `new` answers the VM it was asked to make, running. */
export const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

/** The engine repository's `ls-remote` answers `engine` as its HEAD. */
export const engineRule = (engine) => ({
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${engine}\tHEAD\n`)
})

/**
 * The compiler the launcher fetches at `engine=`. At a fake engine sha the
 * real `git show` in this checkout fails, so the `gh api` contents call is what
 * answers — and it must answer BEFORE a sim's `recordRule`, whose empty page
 * would otherwise read as a compiler that could not be fetched and refuse the
 * launch. The body is never run: a sim's `compilerRule` answers every `python3`.
 */
export const COMPILER_FETCH = {
  when: (cmd, argv) => cmd === 'gh' && argv[0] === 'api' &&
    argv.some((a) => /contents\/skills\/ultrapowers\/scripts\/plan_(check|parse)\.py/.test(String(a))),
  answer: answer('# plan_check.py or plan_parse.py, as the seam hands it back\n')
}

/**
 * A git argv with its remote pointed at `repo.origin`, and a bare-branch fetch
 * made a full refspec. `evidence` is one `makeEvidenceRepo` or a list of them:
 * the `github.com` URL of each is routed to its own bare instead.
 */
export const pointAtOrigin = (repo, argv, evidence = []) => {
  const evidences = Array.isArray(evidence) ? evidence : [evidence]
  const bareFor = (a) => {
    const hit = evidences.find((e) => String(a) === `https://github.com/${e.name}.git`)
    if (hit) return hit.bare
    return a === 'origin' || /github\.com/.test(String(a)) ? repo.origin : a
  }
  const pointed = argv.map(bareFor)
  const fetchAt = argv.indexOf('fetch')
  if (fetchAt < 0) return pointed
  const remoteAt = argv.indexOf('origin', fetchAt)
  const branch = String(argv[remoteAt + 1] ?? '')
  if (remoteAt < 0 || branch === '' || branch.startsWith('-') || branch.includes(':')) return pointed
  pointed[remoteAt + 1] = `+refs/heads/${branch}:refs/remotes/origin/${branch}`
  return pointed
}

/** The target's push, ls-remote and fetch, really run against its local bare
 *  origin — and the evidence repository's (`evidence`, as `pointAtOrigin`
 *  takes it) against its own bare. */
export const localRemote = (repo, evidence = []) => ({
  when: (cmd, argv) => cmd === 'git' &&
    (argv.includes('push') || argv.includes('ls-remote') || argv.includes('fetch')) &&
    !argv.includes('--get-url') &&
    !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => defaultExec('git', pointAtOrigin(repo, argv, evidence), options ?? {})
})

/** What a git that would open a socket answers instead. */
export const OFFLINE = answer('', { code: 128, stderr: 'exam: this exam opens no network socket\n' })
export const NO_REMOTE_OPS = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => a === 'clone' || a === 'pull' || a === 'fetch'),
  answer: OFFLINE
}
export const NO_NETWORK_GIT = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))),
  answer: OFFLINE
}

/** The seed of a launch sim's target, and the plan it launches. */
export const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n' }
export const PLAN = '# a plan\n\nOne plan, and a trailing newline.\n'

/** Every `python3` run of the compiler: `plan_check.py` passes, `plan_parse.py`
 *  answers `compiled`. */
export const compilerRule = (compiled) => ({
  when: (cmd) => cmd === 'python3',
  answer: (cmd, argv) =>
    argv.some((a) => String(a).endsWith('plan_check.py')) ? answer('PLAN OK\n') : answer(JSON.stringify(compiled))
})

/** `help <verb>` answered with a bare Options block. */
export const HELP_OK = (cmd, argv) => answer(`Command: ${String(argv[1] ?? '').slice('help '.length)}\n\nOptions:\n`)

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const helpText = (verb, flags) => [
  `Command: ${verb}`, '', 'Options:', ...flags.map((flag) => `  ${flag}  what ${flag} does`), ''
].join('\n')
/** `help <verb>` answered with the flags `fleet/exe-verbs.json` pins for it,
 *  and an unrecognized verb answered as exe.dev answers one. Read per call, so
 *  a sim that never asks never opens the file. */
export const HELP_FROM_VERBS = (cmd, argv) => {
  const { verbs } = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))
  const verb = String(argv[1] ?? '').slice('help '.length)
  const flags = verbs[verb]
  return flags
    ? answer(helpText(verb, flags))
    : answer(`No help available for unrecognized command: ${verb}\n`)
}

/** `gh api …` answering `res` for every call; `NO_RECORD` is an empty page. */
export const recordRule = (res) => cmdRule('gh', 'api', res)
export const NO_RECORD = answer('')

/**
 * The seam a good launch reads through, in the order the launch sims need it
 * (`COMPILER_FETCH` before `recordRule`, see above). `gh` is the target's
 * integration name, and `integrations` replaces the default three rows; `rows`
 * is what `ls` answers, `record` what `gh api` answers, `help` what `help`
 * answers. With no `engine` the engine's `ls-remote` rule is left out.
 */
export const launchRules = ({
  engine, repo, evidence = [], gh, integrations, rows = [], record = NO_RECORD, help = HELP_OK, compiled = ONE_TASK
}) => [
  ...(engine ? [engineRule(engine)] : []),
  COMPILER_FETCH,
  localRemote(repo, evidence),
  compilerRule(compiled),
  sshRule('help ', help),
  sshRule('integrations list --json', answer(integrations ?? [
    { name: gh, attachments: [] }, { name: 'gh-ops-evidence', attachments: [] }, { name: 'claude-max', attachments: [] }
  ])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule("ls '", vmsPayload(rows)),
  sshRule('new ', NEW_OK),
  recordRule(record),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

/**
 * A launch sim's workspace under a fresh temp root: a target seeded with
 * `seed` whose origin URL then reads `originUrl`, an evidence repository named
 * `evidence`, and — unless `plan` is null — the plan at `plans-src/a-plan.md`,
 * outside the target. Answers `{ root, repo, evidence, planPath, cleanup }`.
 */
export function launchWorkspace ({ prefix, originUrl, seed = SEED, evidence = 'ops/evidence', plan = PLAN }) {
  const root = tempDir(prefix)
  const repo = makeTargetRepo({ root, files: { ...seed } })
  repo.git(['remote', 'set-url', 'origin', originUrl])
  const evidenceRepo = makeEvidenceRepo({ root, name: evidence })
  let planPath = null
  if (plan !== null) {
    const planDir = path.join(root, 'plans-src')
    fs.mkdirSync(planDir)
    planPath = path.join(planDir, 'a-plan.md')
    fs.writeFileSync(planPath, plan)
  }
  return { root, repo, evidence: evidenceRepo, planPath, cleanup: () => cleanup(root) }
}

/** Every `git push` the seam recorded. */
export const pushCalls = (exec) => exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('push'))

/** The `--comment '<...>'` value off a recorded `new` call. */
export const commentOf = (call) => /--comment '([^']*)'/.exec(String(call?.argv[1] ?? ''))?.[1]
