/**
 * fleet/tests/test_factory_boot_exams.mjs — the exam for "the boot takes the
 * run's own exam files out of the pull request and keeps them in the record".
 *
 * This file is self-contained: it imports only `./_helpers.mjs`'s `simEnv`
 * (Node's hermetic-child-environment rule every sim in this tree follows) and
 * spawns `factory/boot.sh boot` under `bash`, with every external program it
 * reaches — `curl`, `git`, `npm`, `claude`, `systemd-run`, `systemctl`,
 * `node`, `python3`, `tar`, `sha256sum`, `kata` — a stub placed first on
 * `PATH`. No other exam, no package suite, no linter: the only thing this
 * file runs is `factory/boot.sh` itself.
 *
 * The legs, and what each asserts — every assertion names the leg and the
 * Machine clause it comes from, so a reader can map this file back to the
 * task:
 *
 *   (a) [M1] One green boot ("drive A") whose stub `plan_parse.py --unguarded`
 *       prints two paths — `fleet/tests/test_x.mjs`, which the exam creates
 *       under the stub target, and `tests/test_gone.py`, which it does not.
 *       Asserts: the stub `python3` saw the exact argv the Machine names; the
 *       existing path's bytes land at
 *       `<evidence>/.ultrapowers/runs/7/exams/fleet/tests/test_x.mjs`; the
 *       target's stub `git` log shows a `rm` naming the existing path, then
 *       exactly one `commit` in the target whose subject is
 *       `run-7: exams to evidence`, then the push of `HEAD` to the
 *       integration branch, in that order; no `rm` anywhere names the absent
 *       path, no copy lands for it, and the target's working copy of the
 *       removed file is gone; and `factory/boot.sh`'s source routes the
 *       listing call through a `fleet_python3` wrapper rather than a bare
 *       `python3` call.
 *   (b) [M2] On drive A, the evidence worktree's stub `git` log shows an
 *       `add` naming `.ultrapowers/runs/7/exams` before the evidence commit
 *       whose message is `run-7: publishing`.
 *   (c) [M3] Three more boots, each covering one way the listing can fail to
 *       name a path to strip — the stub exiting 1, the stub printing nothing,
 *       and the stub naming only a path absent from the target. Each asserts:
 *       the boot log carries exactly one line beginning `exams:`; the
 *       target's stub `git` log shows no `commit` at all; the push of `HEAD`
 *       to the integration branch still happened; and the run's final
 *       `status.json` state and the boot's exit code equal drive A's.
 *
 * What this exam assumes about the code under test: that `factory/boot.sh`
 * still clones nothing when `$TARGET_DIR/.git` already exists (so a plain
 * stub directory stands in for a real clone), that `git`, `curl`, `claude`
 * and `systemd-run` are reached exactly the way `fleet/CONTRACT.md`'s callers
 * already reach them (through the existing `fleet_*` wrappers, argv
 * untouched), and that the new listing call is the only thing under test here
 * — `board_up` is steered onto its "no kata.json, proceeding without a spoke"
 * branch so no code the plan under test does not touch (kata install, the
 * merge, the disclosures ticket) ever runs.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, '..', '..', 'factory', 'boot.sh')

// ── the run's literals ───────────────────────────────────────────────────────

const RUN_N = '7'
const RUN_ID = `run-${RUN_N}`
const PLAN_SHA = 'a1'.repeat(20)
const BASE_SHA = 'b2'.repeat(20)
const ENGINE_SHA = 'c3'.repeat(20)
const HEAD_SHA = 'd4'.repeat(20) // != BASE_SHA, so boot() takes the publish path
const TARGET_REPO = 'acme/t'
const BRANCH = `ultra/integration-${RUN_ID}`
const EVIDENCE_REL = `.ultrapowers/runs/${RUN_N}`
const EXAMS_REL = `${EVIDENCE_REL}/exams`
const ASSIGNMENT = `run=${RUN_N} plan=${PLAN_SHA} target=${TARGET_REPO} base=${BASE_SHA} engine=${ENGINE_SHA}`

const EXAM_REL_PATH = 'fleet/tests/test_x.mjs'
const GONE_REL_PATH = 'tests/test_gone.py'
const EXAM_FILE_BYTES =
  "import assert from 'node:assert/strict'\n// an unguarded exam the plan chose not to keep in the PR\nassert.ok(true)\n"

const PLAN_BYTES = '# Exam plan\n\n**Summary:** exercises the exams-to-evidence step.\n\n'
  + '### Task 1: a task\n\n**Claim:** x (derived)\nMachine: M1. x\n'

// ── stub bin dir ─────────────────────────────────────────────────────────────
//
// Every stub logs its own argv, tab-separated, one call per line, to
// `<name>.log` under `$FLEET_HOME` — the `argv` shell function every stub
// shares. Ordering assertions read the log of the one tool in question
// (`git.log`, `python3.log`); no cross-tool interleaving is needed because
// `factory/boot.sh` never runs two of these concurrently against this rig
// (the engine unit's own git use is stubbed away entirely).

const PRELUDE = `#!/bin/sh
argv() { name="$1"; shift; { for a in "$name" "$@"; do printf '%s\t' "$a"; done; printf '\n'; } >>"$FLEET_HOME/$name.log"; }
`

const STUBS = {
  // Reflection's name lookup, the bearer probe and the PR creation POST — the
  // only three curl calls a run that never binds a kata spoke makes.
  curl: `
argv "curl" "$@"
url=""; payload=""; prev=""
for a in "$@"; do
  case "$a" in https://*|http://*) url="$a" ;; esac
  if [ "$prev" = "-d" ]; then payload="$a"; fi
  prev="$a"
done
case "$url" in
  *reflection.int.exe.xyz/)
    printf '{"name":"fleet-exam-vm"}\n' ;;
  *claude-max.int.exe.xyz/api/oauth/usage)
    printf '{"five_hour":{"utilization":0},"seven_day":{"utilization":0}}\n200\n' ;;
  *github.int.exe.xyz/api/v3/repos/*/pulls)
    printf '%s\n' "$payload" >>"$FLEET_HOME/pr.log"
    printf '{"html_url":"https://github.int.exe.xyz/acme/t/pull/1","number":1,"login":"acme-bot"}\n201\n' ;;
  *)
    printf '\n200\n' ;;
esac
exit 0
`,
  // Records full argv for every call (the exam's ordering assertions read
  // this log) and answers just enough of the target and evidence clones to
  // carry the boot script from `prepare` through `record_tags` without a real
  // repository anywhere: `$TARGET_DIR/.git` is pre-made by the exam so
  // `clone` is never reached, and every verb below is answered the way that
  // one flat directory needs it answered.
  git: `
argv "git" "$@"
dir=""
if [ "$1" = "-C" ]; then dir="$2"; shift 2; fi
verb="$1"; shift
case "$verb" in
  clone)
    mkdir -p "$2/.git" ;;
  checkout) : ;;
  fetch)
    case "$*" in
      *evidence-*) exit 1 ;;
    esac ;;
  rev-parse)
    case "$1" in
      FETCH_HEAD) printf '%s\n' "$STUB_PLAN_SHA" ;;
      HEAD) printf '%s\n' "$STUB_HEAD_SHA" ;;
    esac ;;
  show)
    case "$1" in
      *:.ultrapowers/plan.md) printf '%s' "$STUB_PLAN_BYTES" ;;
      *:.ultrapowers/gate-verdicts.json) exit 1 ;;
      *:.ultrapowers/kata.json) exit 1 ;;
    esac ;;
  worktree)
    wt=""; seen=""
    for a in "$@"; do
      if [ -n "$seen" ]; then
        case "$a" in -*) ;; *) wt="$a"; break ;; esac
      fi
      [ "$a" = "add" ] && seen=1
    done
    if [ -n "$wt" ]; then
      mkdir -p "$wt"
      [ -e "$wt/.git" ] || printf 'gitdir: x\n' >"$wt/.git"
    fi ;;
  config)
    if [ -n "$1" ] && [ -n "$2" ]; then exit 0; else exit 1; fi ;;
  add) : ;;
  rm)
    for a in "$@"; do
      case "$a" in --|-*) ;; *) rm -f "$dir/$a" ;; esac
    done ;;
  commit) : ;;
  push) : ;;
  symbolic-ref) printf 'refs/remotes/origin/main\n' ;;
  ls-remote) : ;;
esac
exit 0
`,
  npm: `
argv "npm" "$@"
exit 0
`,
  // `auth status` answers with an oauth_token line and nothing that reads as
  // api_key, so `auth_status` and `bearer_probe` never fail the run.
  claude: `
argv "claude" "$@"
if [ "$1 $2" = "auth status" ]; then
  printf 'authMethod: oauth_token\napiProvider: firstParty\n'
fi
exit 0
`,
  // The engine unit. Nothing under test here reads what it writes, so it
  // just records its argv and exits 0 — the "engine exit 0" case.
  'systemd-run': `
argv "systemd-run" "$@"
exit 0
`,
  systemctl: `
argv "systemctl" "$@"
exit 0
`,
  // Never actually exec'd: `node` only ever appears as argv INSIDE the
  // stubbed systemd-run call. Present on PATH per the rig's own shape; a call
  // logged here would be a finding this exam does not look for.
  node: `
argv "node" "$@"
exit 0
`,
  // The listing command under test. Three knobs: STUB_EXAM_EXIT (a non-zero
  // exit — M3), STUB_EXAM_LIST unset (the default: no plan_parse call this
  // exam did not ask for prints anything unexpected), and STUB_EXAM_LIST set
  // (even to '') — printed verbatim, which is how a case answers "prints
  // nothing" (set to '') as well as "prints these paths".
  python3: `
argv "python3" "$@"
case "$*" in
  *plan_parse.py*)
    if [ -n "\${STUB_EXAM_EXIT:-}" ] && [ "\${STUB_EXAM_EXIT}" != "0" ]; then
      exit "$STUB_EXAM_EXIT"
    fi
    if [ -n "\${STUB_EXAM_LIST+set}" ]; then
      printf '%s' "$STUB_EXAM_LIST"
    fi
    exit 0 ;;
esac
exit 0
`,
  tar: `
argv "tar" "$@"
exit 0
`,
  sha256sum: `
argv "sha256sum" "$@"
exit 0
`,
  kata: `
argv "kata" "$@"
exit 0
`,
}

// ── harness ──────────────────────────────────────────────────────────────────

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-boot-exam-'))
process.on('exit', () => { try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }) } catch { /* best effort */ } })

let seq = 0
function makeHome () {
  seq += 1
  const home = path.join(TMP_ROOT, `home-${seq}`)
  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  for (const [name, body] of Object.entries(STUBS)) {
    const file = path.join(bin, name)
    fs.writeFileSync(file, PRELUDE + body)
    fs.chmodSync(file, 0o755)
  }
  const targetDir = path.join(home, 'target')
  // A pre-made `.git` so `prepare`'s `[ -e "$TARGET_DIR/.git" ]` short-circuits
  // the clone — a flat stub directory stands in for a real one, per every
  // verb the `git` stub above answers.
  fs.mkdirSync(path.join(targetDir, '.git'), { recursive: true })
  const engineDir = path.join(home, 'engines', ENGINE_SHA)
  // `fleet/node_modules` present so `engine_deps` skips `npm` entirely.
  fs.mkdirSync(path.join(engineDir, 'fleet', 'node_modules'), { recursive: true })
  const planFile = path.join(home, 'plans', `${RUN_ID}.md`)
  const planParsePath = path.join(engineDir, 'skills', 'ultrapowers', 'scripts', 'plan_parse.py')
  const evidenceExamsDir = path.join(home, 'evidence', EXAMS_REL)
  return { home, bin, targetDir, engineDir, planFile, planParsePath, evidenceExamsDir }
}

function bootEnv (ctx, env) {
  return {
    ...simEnv({ bin: ctx.bin, home: ctx.home }),
    FLEET_ASSIGNMENT: ASSIGNMENT,
    FLEET_COMMIT_SECONDS: '1',
    FLEET_KATA_WAIT_SECONDS: '1',
    STUB_PLAN_SHA: PLAN_SHA,
    STUB_HEAD_SHA: HEAD_SHA,
    STUB_PLAN_BYTES: PLAN_BYTES,
    ...env,
  }
}

function bootAsync (ctx, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [SCRIPT, 'boot'], {
      env: bootEnv(ctx, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c) => { stdout += c })
    child.stderr.on('data', (c) => { stderr += c })
    child.on('error', reject)
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }))
  })
}

const readLog = (ctx, name) => {
  const f = path.join(ctx.home, name)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
const lines = (text) => text.split('\n').filter(Boolean)
const argvLines = (ctx, tool) => lines(readLog(ctx, `${tool}.log`)).map((l) => l.split('\t').filter((s) => s !== ''))

/** Every logged `git` call, split into its `-C <dir>` (or none), its verb and
 *  the args after the verb — in the order the boot script issued them. */
function gitCalls (ctx) {
  return argvLines(ctx, 'git').map((tokens) => {
    let i = 1
    let dir = null
    if (tokens[i] === '-C') { dir = tokens[i + 1]; i += 2 }
    const verb = tokens[i]
    const args = tokens.slice(i + 1)
    return { dir, verb, args }
  })
}
const messageOf = (call) => {
  const i = call.args.indexOf('-m')
  return i >= 0 ? call.args[i + 1] : undefined
}
const pathArgsOf = (call) => call.args.filter((a) => a !== '--' && !a.startsWith('-'))

/** The boot script's own log lines (`factory/boot.sh`'s `log()`), timestamp
 *  stripped — never the stub argv logs, which is what `exams:` is asserted
 *  against. */
const bootLogMessages = (ctx) => lines(readLog(ctx, 'fleet-boot.log')).map((l) => l.replace(/^\S+\s/, ''))

const statusOf = (ctx) => JSON.parse(fs.readFileSync(path.join(ctx.home, 'evidence', EVIDENCE_REL, 'status.json'), 'utf8'))

// ── the boots, each started once ────────────────────────────────────────────

const scenarios = new Map()
const scenario = (label, start) => {
  if (!scenarios.has(label)) scenarios.set(label, start())
  return scenarios.get(label)
}

/** Drive A: the listing prints one path the target carries as a file
 *  (`fleet/tests/test_x.mjs`) and one it does not (`tests/test_gone.py`). */
const driveA = () => scenario('a', async () => {
  const ctx = makeHome()
  fs.mkdirSync(path.join(ctx.targetDir, path.dirname(EXAM_REL_PATH)), { recursive: true })
  fs.writeFileSync(path.join(ctx.targetDir, EXAM_REL_PATH), EXAM_FILE_BYTES)
  const result = await bootAsync(ctx, { STUB_EXAM_LIST: `${EXAM_REL_PATH}\n${GONE_REL_PATH}\n` })
  return { ctx, result }
})

/** One M3 drive: `env` is the knob that makes the listing name nothing to
 *  strip. `withFile` mirrors drive A's target contents so a reader can tell
 *  the difference is the listing alone. */
const m3Drive = (label, env, withFile = true) => scenario(label, async () => {
  const ctx = makeHome()
  if (withFile) {
    fs.mkdirSync(path.join(ctx.targetDir, path.dirname(EXAM_REL_PATH)), { recursive: true })
    fs.writeFileSync(path.join(ctx.targetDir, EXAM_REL_PATH), EXAM_FILE_BYTES)
  }
  const result = await bootAsync(ctx, env)
  return { ctx, result }
})

const exitNonzero = () => m3Drive('exit-nonzero', { STUB_EXAM_EXIT: '1' })
const printsNothing = () => m3Drive('prints-nothing', { STUB_EXAM_LIST: '' })
const namesNoFile = () => m3Drive('names-no-file', { STUB_EXAM_LIST: `${GONE_REL_PATH}\n` }, false)

// ── tests ────────────────────────────────────────────────────────────────────

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('(a) [M1] the boot finishes 0 on a listing that names one real path and one absent one', async () => {
  const { result } = await driveA()
  assert.equal(result.status, 0, `(a) [M1] boot exited ${result.status}, not 0\n${result.stdout}${result.stderr}`)
})

test('(a) [M1] the stub python3 saw exactly the plan_parse --unguarded invocation the Machine names', async () => {
  const { ctx } = await driveA()
  const calls = argvLines(ctx, 'python3')
  const call = calls.find((c) => c[1] && c[1].endsWith('plan_parse.py'))
  assert.ok(call, `(a) [M1] no python3 call named plan_parse.py — saw ${JSON.stringify(calls)}`)
  assert.deepEqual(call, ['python3', ctx.planParsePath, '--unguarded', ctx.planFile],
    `(a) [M1] python3's argv was not the Machine's literal invocation — got ${JSON.stringify(call)}`)
})

test("(a) [M1] the existing path's bytes land whole at the evidence exams path", async () => {
  const { ctx } = await driveA()
  const copy = path.join(ctx.evidenceExamsDir, EXAM_REL_PATH)
  assert.ok(fs.existsSync(copy), `(a) [M1] no file at ${copy}`)
  assert.equal(fs.readFileSync(copy, 'utf8'), EXAM_FILE_BYTES,
    '(a) [M1] the copy in evidence is not byte-equal to the file the run wrote under the target')
})

test('(a) [M1] the absent path is neither copied nor removed', async () => {
  const { ctx } = await driveA()
  assert.equal(fs.existsSync(path.join(ctx.evidenceExamsDir, GONE_REL_PATH)), false,
    '(a) [M1] tests/test_gone.py was never a file under the target and should carry no evidence copy')
  const rmPaths = gitCalls(ctx).filter((c) => c.verb === 'rm').flatMap(pathArgsOf)
  assert.ok(!rmPaths.includes(GONE_REL_PATH),
    `(a) [M1] no \`git rm\` may name tests/test_gone.py — rm'd paths were ${JSON.stringify(rmPaths)}`)
})

test('(a) [M1] the target working copy of the removed file is gone', async () => {
  const { ctx } = await driveA()
  assert.equal(fs.existsSync(path.join(ctx.targetDir, EXAM_REL_PATH)), false,
    '(a) [M1] fleet/tests/test_x.mjs should have been removed from the target by `git rm`')
})

test('(a) [M1] exactly one commit in the target, subject "run-7: exams to evidence"', async () => {
  const { ctx } = await driveA()
  const commits = gitCalls(ctx).filter((c) => c.verb === 'commit' && c.dir === ctx.targetDir)
  const examsCommits = commits.filter((c) => messageOf(c) === `${RUN_ID}: exams to evidence`)
  assert.equal(examsCommits.length, 1,
    `(a) [M1] expected exactly one target commit "${RUN_ID}: exams to evidence" — ` +
    `target commits were ${JSON.stringify(commits.map(messageOf))}`)
})

test('(a) [M1] order: rm the kept path, then that commit, then the push of HEAD to the integration branch', async () => {
  const { ctx } = await driveA()
  const calls = gitCalls(ctx)
  const idxRm = calls.findIndex((c) => c.verb === 'rm' && c.dir === ctx.targetDir && pathArgsOf(c).includes(EXAM_REL_PATH))
  const idxCommit = calls.findIndex((c) => c.verb === 'commit' && c.dir === ctx.targetDir && messageOf(c) === `${RUN_ID}: exams to evidence`)
  const idxPush = calls.findIndex((c) => c.verb === 'push' && c.dir === ctx.targetDir && c.args.some((a) => a.startsWith('HEAD:refs/heads/')))
  assert.ok(idxRm >= 0, `(a) [M1] no \`git rm\` in the target named ${EXAM_REL_PATH}`)
  assert.ok(idxCommit >= 0, '(a) [M1] no "exams to evidence" commit in the target')
  assert.ok(idxPush >= 0, `(a) [M1] no push of HEAD to refs/heads/${BRANCH} from the target`)
  assert.ok(idxRm < idxCommit,
    `(a) [M1] the rm (call ${idxRm}) must precede the exams commit (call ${idxCommit})`)
  assert.ok(idxCommit < idxPush,
    `(a) [M1] the exams commit (call ${idxCommit}) must precede the push of HEAD (call ${idxPush})`)
})

test('(a) [M1] the listing runs through a fleet_python3 wrapper, not a bare python3 call', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8')
  assert.match(text, /fleet_python3\s*\(\)\s*\{\s*python3\s+"\$@"\s*;?\s*\}/,
    '(a) [M1] factory/boot.sh should define fleet_python3() beside the other fleet_* wrappers')
  assert.match(text, /fleet_python3[\s\S]{0,240}plan_parse\.py[\s\S]{0,60}--unguarded/,
    '(a) [M1] the plan_parse --unguarded listing call should read fleet_python3 …plan_parse.py --unguarded …, not a bare python3 call')
})

test("(b) [M2] evidence_commit's add of .ultrapowers/runs/7/exams precedes the run-7: publishing commit", async () => {
  const { ctx } = await driveA()
  const calls = gitCalls(ctx)
  const idxAdd = calls.findIndex((c) => c.verb === 'add' && c.dir === path.join(ctx.home, 'evidence')
    && pathArgsOf(c).some((a) => a.replace(/\/$/, '') === EXAMS_REL))
  const idxCommit = calls.findIndex((c) => c.verb === 'commit' && c.dir === path.join(ctx.home, 'evidence')
    && messageOf(c) === `${RUN_ID}: publishing`)
  assert.ok(idxAdd >= 0,
    `(b) [M2] no evidence \`git add\` named ${EXAMS_REL} — evidence adds were ` +
    `${JSON.stringify(calls.filter((c) => c.verb === 'add').map(pathArgsOf))}`)
  assert.ok(idxCommit >= 0, `(b) [M2] no evidence commit "${RUN_ID}: publishing"`)
  assert.ok(idxAdd < idxCommit,
    `(b) [M2] the add of ${EXAMS_REL} (call ${idxAdd}) must precede the publishing commit (call ${idxCommit})`)
})

/** One M3 leg, run against the three ways the listing can name nothing to
 *  strip: a non-zero exit, an empty stdout, and a listing whose only path is
 *  not a file under the target. */
const m3Cases = [
  ['the listing exits non-zero', exitNonzero],
  ['the listing prints nothing', printsNothing],
  ['the listing names only a path absent from the target', namesNoFile],
]

for (const [label, drive] of m3Cases) {
  test(`(c) [M3] ${label}: exactly one "exams:" log line`, async () => {
    const { ctx } = await drive()
    const examsLines = bootLogMessages(ctx).filter((l) => l.startsWith('exams:'))
    assert.equal(examsLines.length, 1,
      `(c) [M3] ${label}: expected exactly one "exams:" line — got ${JSON.stringify(examsLines)}`)
  })

  test(`(c) [M3] ${label}: no commit at all in the target`, async () => {
    const { ctx } = await drive()
    const targetCommits = gitCalls(ctx).filter((c) => c.verb === 'commit' && c.dir === ctx.targetDir)
    assert.equal(targetCommits.length, 0,
      `(c) [M3] ${label}: the target should carry no commit — saw ${JSON.stringify(targetCommits.map(messageOf))}`)
  })

  test(`(c) [M3] ${label}: the push of HEAD to the integration branch still happens`, async () => {
    const { ctx } = await drive()
    const pushes = gitCalls(ctx).filter((c) => c.verb === 'push' && c.dir === ctx.targetDir
      && c.args.some((a) => a.startsWith('HEAD:refs/heads/')))
    assert.equal(pushes.length, 1,
      `(c) [M3] ${label}: expected exactly one push of HEAD to refs/heads/ from the target — got ${pushes.length}`)
  })

  test(`(c) [M3] ${label}: the run's final state and exit code equal drive A's`, async () => {
    const a = await driveA()
    const b = await drive()
    assert.equal(b.result.status, a.result.status,
      `(c) [M3] ${label}: exit code ${b.result.status} != drive A's ${a.result.status}`)
    assert.equal(statusOf(b.ctx).state, statusOf(a.ctx).state,
      `(c) [M3] ${label}: final state ${statusOf(b.ctx).state} != drive A's ${statusOf(a.ctx).state}`)
  })
}

// ── runner ───────────────────────────────────────────────────────────────────

async function main () {
  let failures = 0
  for (const [name, fn] of tests) {
    const started = Date.now()
    try {
      await fn()
      console.log(`ok (${Date.now() - started} ms) — ${name}`)
    } catch (error) {
      failures += 1
      console.log(`FAIL — ${name}`)
      console.log(String(error && error.stack ? error.stack : error))
    }
  }
  if (failures) {
    console.log(`${failures} FAILED`)
    process.exitCode = 1
    return
  }
  console.log('ALL TESTS PASSED')
}

await main()
