import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { EXE_HOST, defaultExec } from '../lobby.mjs'
import { simEnv } from './_helpers.mjs'

export const answer = (stdout = '', { code = 0, stderr = '' } = {}) => ({
  code,
  stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
  stderr
})

const isLobby = (cmd, argv) => cmd === 'ssh' && argv[0] === EXE_HOST

export const sshRule = (prefix, res) => ({
  when: (cmd, argv) => isLobby(cmd, argv) && String(argv[1] ?? '').startsWith(prefix),
  answer: res
})

export const cmdRule = (cmd, first, res) => ({
  when: (c, argv) => c === cmd && argv[0] === first,
  answer: res
})

export const vmRow = (name, extra = {}) => ({
  vm_name: name,
  ssh_dest: `exedev@${name}.ssh.exe.xyz`,
  ssh_host: `${name}.ssh.exe.xyz`,
  status: 'running',
  ...extra
})

export const vmsPayload = (vms = [], shared = []) => answer({ shared_vms: shared, vms })

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
  exec.lobby = () => calls.filter((c) => isLobby(c.cmd, c.argv)).map((c) => c.argv[1])
  exec.mutating = () => exec.lobby().filter((line) =>
    /^(cp|rm|comment|rename|new|tag) /.test(line) || /^integrations (add|attach|detach|edit) /.test(line)
  )
  return exec
}

const GIT_HOME = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fleet-lobby-home-'))
export const gitEnv = (env) => ({ ...simEnv({ home: GIT_HOME }), ...env })

const run = (cwd, argv, env) => {
  const res = spawnSync('git', argv, { cwd, encoding: 'utf8', env: gitEnv(env) })
  if (res.status !== 0) {
    throw new Error(`git ${argv.join(' ')} in ${cwd}: ${res.stdout}${res.stderr}`)
  }
  return res.stdout
}

export function tempDir (prefix = 'fleet-lobby-') {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix))
}

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

export const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true })

export async function thrown (body) {
  try {
    await body()
  } catch (error) {
    return error
  }
  return null
}

export const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }

export const ONE_TASK = {
  tasks: [{ id: '1', title: 'task 1', files: ['f1.txt'], wave: 1, proofRuns: [], proofRunClauses: [] }],
  dag_edges: [],
  width: 1
}

export const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

export const engineRule = (engine) => ({
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${engine}\tHEAD\n`)
})

export const COMPILER_FETCH = {
  when: (cmd, argv) => cmd === 'gh' && argv[0] === 'api' &&
    argv.some((a) => /contents\/skills\/ultrapowers\/scripts\/plan_(check|parse)\.py/.test(String(a))),
  answer: answer('# plan_check.py or plan_parse.py, as the seam hands it back\n')
}

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

export const localRemote = (repo, evidence = []) => ({
  when: (cmd, argv) => cmd === 'git' &&
    (argv.includes('push') || argv.includes('ls-remote') || argv.includes('fetch')) &&
    !argv.includes('--get-url') &&
    !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => defaultExec('git', pointAtOrigin(repo, argv, evidence), options ?? {})
})

export const OFFLINE = answer('', { code: 128, stderr: 'exam: this exam opens no network socket\n' })
export const NO_REMOTE_OPS = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => a === 'clone' || a === 'pull' || a === 'fetch'),
  answer: OFFLINE
}
export const NO_NETWORK_GIT = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))),
  answer: OFFLINE
}

export const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n' }
export const PLAN = '# a plan\n\nOne plan, and a trailing newline.\n'

export const compilerRule = (compiled) => ({
  when: (cmd) => cmd === 'python3',
  answer: (cmd, argv) =>
    argv.some((a) => String(a).endsWith('plan_check.py')) ? answer('PLAN OK\n') : answer(JSON.stringify(compiled))
})

export const recordRule = (res) => cmdRule('gh', 'api', res)
export const NO_RECORD = answer('')

export const launchRules = ({
  engine, repo, evidence = [], gh, integrations, rows = [], record = NO_RECORD, compiled = ONE_TASK
}) => [
  ...(engine ? [engineRule(engine)] : []),
  COMPILER_FETCH,
  localRemote(repo, evidence),
  compilerRule(compiled),
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

export const pushCalls = (exec) => exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('push'))

export const commentOf = (call) => /--comment '([^']*)'/.exec(String(call?.argv[1] ?? ''))?.[1]
