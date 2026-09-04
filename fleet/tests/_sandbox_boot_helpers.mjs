// fleet/tests/_sandbox_boot_helpers.mjs — the shared rig for the
// `fleet/sandbox-boot.sh` exam, which runs as two processes:
// `test_sandbox_boot.mjs` (the green path and the evidence branch) and
// `test_sandbox_boot_edges.mjs` (everything else). Underscore-prefixed so the
// bridge's `test_*.mjs` glob does not collect it as an exam of its own.
//
// The script's whole job is ORDER: which external call happens before which
// state is claimed. So every stub appends one line to the SAME log the script
// writes its own state lines to (`$FLEET_HOME/fleet-boot.log`), and the
// ordering assertions read index comparisons in that one stream. Each stub
// additionally writes a tab-separated argv line to its own log, which is where
// the literal-argv assertions read.
//
// No network, no systemd, no real `claude`: `FLEET_BIN_DIR` is prepended to
// PATH and `FLEET_HOME` relocates every path the script touches. The engine is
// where the bootstrap would have put it — `$FLEET_HOME/engines/<sha>` — and
// the assignment arrives the way the bootstrap hands it over, in
// `FLEET_ASSIGNMENT`.
//
// `tmpRoot` and `caseNo` are this module's own state: `makeHome` numbers its
// homes under one temp root and `runTests` removes it when the process is done.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const SCRIPT = path.join(HERE, '..', 'sandbox-boot.sh')

// ── the run's literals ───────────────────────────────────────────────────────

export const PLAN_SHA = 'a1'.repeat(20)
export const BASE_SHA = 'b2'.repeat(20)
export const ENGINE_SHA = 'c3'.repeat(20)
/** The pushed head of the integration branch — what `git rev-parse <branch>`
 *  answers and what the edge's branches endpoint has to report before the PR
 *  POST. */
export const HEAD_SHA = 'd4'.repeat(20)
/** Some other commit, for the run where the plan branch does not carry `plan=`. */
export const OTHER_SHA = 'e5'.repeat(20)
export const TARGET = 'popmechanic/smoke'
export const VM_NAME = 'fleet-r7-2609032215-a1b2'
export const PR_URL = 'https://github.com/popmechanic/smoke/pull/1'
export const PR_AUTHOR = 'popmechanic'

// The three branches of #598, all on the target.
export const PLAN_BRANCH = 'ultra/plan-run-7'
export const EVIDENCE_BRANCH = 'ultra/evidence-run-7'
export const INTEGRATION_BRANCH = 'ultra/integration-run-7'
/** Where the evidence lives inside the evidence worktree. */
export const RUN_PATH = '.ultrapowers/runs/7'
/** The plan's path inside the plan commit's tree. */
export const PLAN_PATH = '.ultrapowers/plan.md'

// M3's two links, spelled the way the PR body has to spell them.
export const EVIDENCE_LINK = `https://github.com/${TARGET}/tree/${EVIDENCE_BRANCH}/${RUN_PATH}/`
export const PLAN_LINK = `https://github.com/${TARGET}/blob/${PLAN_BRANCH}/${PLAN_PATH}`
export const PLAN_ROW = `| plan | \`${PLAN_PATH}\` at \`${PLAN_SHA}\` |`

/**
 * M4's forbidden names, assembled rather than written, because the same
 * prohibition covers this exam's own files: no source under `fleet/` may
 * carry them.
 */
export const RETIRED_NAMES = ['fleet' + '-runs', 'FLEET' + '_RUNS', 'fleet' + 'Runs']

/** What GitHub answers a POST /pulls with, in its own field order: the PR's
 *  `html_url` and its `user` (the author) come before the head/base
 *  repositories, which carry the same field names for other things. */
export const PR_JSON = JSON.stringify({
  url: 'https://api.github.com/repos/popmechanic/smoke/pulls/1',
  id: 1,
  node_id: 'PR_x',
  html_url: PR_URL,
  diff_url: `${PR_URL}.diff`,
  number: 1,
  state: 'open',
  user: { login: PR_AUTHOR, id: 2, html_url: 'https://github.com/popmechanic' },
  head: { ref: INTEGRATION_BRANCH, user: { login: 'not-the-author' }, repo: { html_url: 'https://github.com/popmechanic/smoke' } },
  base: { ref: 'main', user: { login: 'not-the-author-either' } }
})
export const PLAN_H1 = 'Smoke: the fleet proves itself'
/** Exactly what `git show <plan>:.ultrapowers/plan.md` hands back. */
export const PLAN_BYTES = `# ${PLAN_H1}\n\nbody\n`
export const ASSIGNMENT =
  `run=7 plan=${PLAN_SHA} target=${TARGET} base=${BASE_SHA} engine=${ENGINE_SHA} ` +
  'overlap=fold tier=mostCapable'

// ── stub bin dir ─────────────────────────────────────────────────────────────

export const STUBS = {
  // Reflection, notify, and the GitHub edge's PR endpoint. `$1..` carries the
  // URL as the only https:// word; a POST carries its payload after `-d`. The
  // PR answer is the body, then the status code on its own line — the shape
  // `-w '\\n%{http_code}'` makes real curl print.
  curl: `
argv "curl" "$@"
url=""; payload=""; prev=""
for a in "$@"; do
  case "$a" in https://*) url="$a" ;; esac
  [ "$prev" = "-d" ] && payload="$a"
  prev="$a"
done
bump() {
  f="$FLEET_HOME/stub/$1"; n=0
  [ -f "$f" ] && n=$(cat "$f")
  n=$((n + 1)); echo "$n" >"$f"; echo "$n"
}
case "$url" in
  *reflection.int.exe.xyz/)
    say "curl name"; printf '{"name":"%s"}\\n' "$STUB_VM_NAME" ;;
  */email)
    say "curl email"; printf '{"email":"op@example.com"}\\n' ;;
  */comment)
    n=$(bump comment); say "curl comment $n"
    printf '{"comment":"%s"}\\n' "$STUB_COMMENT" ;;
  */integrations)
    n=$(bump integrations); say "curl integrations $n"
    # Reflection's shape: each github integration names its repository inside
    # its help string. The notes integration names its own TWICE in one string,
    # which is one integration, not a duplicate. STUB_DUPE adds a second
    # integration naming the TARGET — the fault the preflight exists to refuse.
    dupe=""
    [ -n "\${STUB_DUPE:-}" ] && dupe=',{"type":"github","name":"t-popmechanic-smoke-rw","help":"git clone https://github.int.exe.xyz/popmechanic/smoke.git"}'
    printf '{"integrations":[{"type":"http-proxy","name":"claude-max","help":"ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz"},{"type":"github","name":"notes","help":"git clone https://github.int.exe.xyz/popmechanic/notes.git or push to https://github.int.exe.xyz/popmechanic/notes.git"},{"type":"github","name":"gh-popmechanic-smoke","help":"git clone https://github.int.exe.xyz/popmechanic/smoke.git"}%s]}\\n' "$dupe" ;;
  *github.int.exe.xyz/api/v3/repos/*/branches/*)
    # GitHub's index catching up with the push: 404 for the first
    # STUB_BRANCH_404 reads (forever under STUB_BRANCH_NEVER), then the branch
    # document — its own \`commit.sha\` first, the nested tree sha after it.
    n=$(bump branches); say "curl branches $n"
    if [ -n "\${STUB_BRANCH_NEVER:-}" ] || [ "$n" -le "\${STUB_BRANCH_404:-0}" ]; then
      printf '{"message":"Branch not found"}\\n404\\n'
    else
      printf '{"name":"ultra/integration-run-7","commit":{"sha":"%s","commit":{"tree":{"sha":"%s"}}}}\\n200\\n' "$STUB_HEAD_SHA" "\${STUB_TREE_SHA:-tree}"
    fi ;;
  *github.int.exe.xyz/api/v3/repos/*/pulls)
    say "curl pr create"; printf '%s\\n' "$payload" >>"$FLEET_HOME/pr.log"
    printf '%s\\n%s\\n' "$STUB_PR_BODY" "\${STUB_PR_CODE:-201}" ;;
  *notify.int.exe.xyz*)
    say "curl notify"; printf '%s\\n' "$payload" >>"$FLEET_HOME/notify.log"; printf 'ok\\n' ;;
  *) say "curl UNKNOWN $url"; exit 22 ;;
esac
`,
  // Records argv; makes the directories a real clone (and a real worktree)
  // would, and answers the four reads the boot script makes of the target:
  // FETCH_HEAD after the plan fetch, the plan blob, the branch head, and the
  // count of commits ahead of base.
  git: `
argv "git" "$@"
say "git $*"
dir=""; verb=""; a1=""; a2=""
if [ "$1" = "-C" ]; then dir="$2"; verb="$3"; a1="$4"; a2="$5"
else verb="$1"; a1="$2"; a2="$3"; fi
case "$verb" in
  clone)
    mkdir -p "$a2/.git"
    case "\${STUB_CLONE_404:-}" in
      "$a1") printf 'remote: Repository not found.\\nfatal: 404\\n' >&2; rm -rf "$a2"; exit 128 ;;
    esac
    case "\${STUB_CLONE_FAIL:-}" in
      "$a1") printf 'fatal: boom\\n' >&2; rm -rf "$a2"; exit 128 ;;
    esac ;;
  config)
    # No baked identity, so the script sets one. Both the read and the write
    # answer the same way; the script tolerates a failed write.
    [ "$a1" = "user.email" ] && exit 1 ;;
  fetch)
    # The plan branch is always there. The evidence branch is there only on a
    # RE-ENTRY, which is what STUB_EVIDENCE_FETCH_OK stands for.
    case "$a2" in
      *evidence-run-7) [ -n "\${STUB_EVIDENCE_FETCH_OK:-}" ] || exit 1 ;;
    esac ;;
  rev-parse)
    # What the plan fetch actually landed. The default is the assignment's
    # plan sha — i.e. the launcher and the VM agree.
    case "$a1" in
      FETCH_HEAD) printf '%s\\n' "\${STUB_FETCH_HEAD:-$STUB_PLAN_SHA}" ;;
      *) printf '%s\\n' "$STUB_HEAD_SHA" ;;
    esac
    exit 0 ;;
  rev-list) if [ -n "\${STUB_NO_COMMITS:-}" ]; then echo 0; else echo 3; fi; exit 0 ;;
  symbolic-ref)
    # What the remote advertised as HEAD at clone time; \`none\` is a remote
    # that advertised nothing.
    [ "\${STUB_HEAD_REF:-}" = none ] && exit 1
    printf '%s\\n' "\${STUB_HEAD_REF:-refs/remotes/origin/main}"; exit 0 ;;
  show)
    case "$a1" in
      *:.ultrapowers/plan.md) printf '# %s\\n\\nbody\\n' "$STUB_PLAN_H1"; exit 0 ;;
      *:.ultrapowers/gate-verdicts.json) printf '{"tasks":{"1":{"verdict":"pass"}},"tally":{"tasks":1}}\\n'; exit 0 ;;
    esac
    exit 0 ;;
  cat-file)
    # \`cat-file -e <plan>:.ultrapowers/gate-verdicts.json\`: the record is on the
    # branch unless the case says otherwise.
    [ -n "\${STUB_NO_VERDICTS:-}" ] && exit 1
    exit 0 ;;
  worktree)
    # \`worktree add\` is answered by creating the directory. The first
    # non-flag word after \`add\` is the path.
    wt=""; seen=""
    for a in "$@"; do
      if [ -n "$seen" ]; then
        case "$a" in -*) ;; *) wt="$a"; break ;; esac
      fi
      [ "$a" = "add" ] && seen=1
    done
    if [ -n "$wt" ]; then
      mkdir -p "$wt"
      [ -e "$wt/.git" ] || printf 'gitdir: %s\\n' "$wt" >"$wt/.git"
    fi ;;
  commit)
    # A commit is the moment the evidence becomes readable off the box, so
    # snapshot the status page exactly as it is committed.
    snap="$dir/.ultrapowers/runs/7/status.json"
    [ -f "$snap" ] && cat "$snap" >>"$FLEET_HOME/commits.log" ;;
  push)
    case "$*" in
      *evidence-run-7*) [ -n "\${STUB_EVIDENCE_PUSH_FAIL:-}" ] && exit 1 ;;
    esac ;;
esac
exit 0
`,
  // Never called: the PR is one REST POST through curl. A CALL line from gh
  // is a finding.
  gh: `say "gh DIRECT $*"; exit 0`,
  // Two transient services. The status server is started and forgotten; the
  // engine is run to completion. The engine stub records its own environment —
  // which is the BOOT SCRIPT'S, because the child's two Anthropic variables
  // ride in this stub's argv (an \`env\` prefix), not in its environment.
  'systemd-run': `
argv "systemd-run" "$@"
unit=""
for a in "$@"; do case "$a" in --unit=*) unit="\${a#--unit=}" ;; esac; done
case "$unit" in
  fleet-status) say "systemd-run status"; exit 0 ;;
esac
env >"$FLEET_HOME/systemd-run.env"
say "systemd-run engine"
run_dir="$FLEET_HOME/target/.claude/ultrapowers/run-run-7"
mkdir -p "$run_dir" "$FLEET_HOME/target/fleet-receipts/run-7"
printf '{"kind":"engine:phase","phase":"gate","id":"x","ts":1}\\n' >"$run_dir/events.jsonl"
# The engine talks on stdout and stderr, and a run that dies before its gate
# leaves nothing else behind.
printf 'run-main: preflight\\n'
printf 'run-main: knob-validate-failed\\n' >&2
if [ -z "\${STUB_NO_RECEIPT:-}" ]; then
  printf '{"verdict":"%s"}\\n' "$STUB_VERDICT" >"$FLEET_HOME/target/fleet-receipts/run-7/gate-receipt.json"
  printf '{"stamp":"run-7"}\\n' >"$run_dir/report.json"
  printf '{"argsFile":"x"}\\n' >"$run_dir/receipt.json"
fi
[ -n "\${STUB_ENGINE_SLEEP:-}" ] && sleep "$STUB_ENGINE_SLEEP"
exit \${STUB_ENGINE_CODE:-0}
`,
  systemctl: `
argv "systemctl" "$@"
say "systemctl $2 $3"
if [ "$2" = "is-active" ]; then
  case "$3" in
    fleet-status.service) printf '%s\\n' "\${STUB_STATUS_ACTIVE:-inactive}" ;;
    fleet-engine-*) printf '%s\\n' "\${STUB_ENGINE_ACTIVE:-inactive}" ;;
    *) printf 'inactive\\n' ;;
  esac
fi
exit 0
`,
  npm: `
argv "npm" "$@"
say "npm $1 in $PWD"
exit 0
`,
  claude: `
say "claude $1 $2"
printf 'authMethod: %s\\napiProvider: firstParty\\n' "\${STUB_AUTH:-oauth_token}"
exit 0
`,
  // Never called directly by the boot script: busybox and node are argv to
  // systemd-run, loginctl is the image's, and nothing on this box reaches
  // another one. A CALL line from any of them is a finding.
  busybox: `say "busybox DIRECT $*"; exit 0`,
  node: `say "node DIRECT $*"; exit 0`,
  loginctl: `say "loginctl DIRECT $*"; exit 0`,
  ssh: `say "ssh DIRECT $*"; exit 0`,
}

export const PRELUDE = `#!/bin/sh
say() { printf '%s CALL %s\\n' "$(date -u +%H:%M:%SZ)" "$1" >>"$FLEET_HOME/fleet-boot.log"; }
argv() { name="$1"; shift; { for a in "$name" "$@"; do printf '%s\\t' "$a"; done; printf '\\n'; } >>"$FLEET_HOME/$name.log"; }
`

// ── harness ──────────────────────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-boot-'))
let caseNo = 0

export function makeHome({ packageJson = '{"name":"fleet"}', nodeModules = true } = {}) {
  caseNo += 1
  const home = path.join(tmpRoot, `home-${caseNo}`)
  const bin = path.join(home, 'bin')
  fs.mkdirSync(path.join(home, 'stub'), { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  for (const [name, body] of Object.entries(STUBS)) {
    const file = path.join(bin, name)
    fs.writeFileSync(file, PRELUDE + body)
    fs.chmodSync(file, 0o755)
  }
  // The bootstrap's clone, at the sha the assignment names.
  const engine = path.join(home, 'engines', ENGINE_SHA, 'fleet')
  fs.mkdirSync(engine, { recursive: true })
  fs.writeFileSync(path.join(engine, 'run-main.mjs'), '')
  fs.writeFileSync(path.join(engine, 'package.json'), packageJson)
  if (nodeModules) fs.mkdirSync(path.join(engine, 'node_modules'))
  return { home, bin }
}

export function boot(ctx, args = ['boot'], env = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: ctx.home,
      FLEET_HOME: ctx.home,
      FLEET_BIN_DIR: ctx.bin,
      FLEET_POLL_SECONDS: '0',
      FLEET_STATUS_INTERVAL: '30',
      FLEET_ASSIGNMENT: ASSIGNMENT,
      // In the boot script's OWN environment, to prove the child's `env -u`
      // removes it and that the two Anthropic variables are never here.
      CLAUDE_CONFIG_DIR: '/should/be/unset/in/the/child',
      STUB_VM_NAME: VM_NAME,
      STUB_COMMENT: ASSIGNMENT,
      STUB_VERDICT: 'PASS',
      STUB_PR_BODY: PR_JSON,
      STUB_PLAN_H1: PLAN_H1,
      STUB_PLAN_SHA: PLAN_SHA,
      STUB_HEAD_SHA: HEAD_SHA,
      ...env,
    },
    timeout: 60000,
  })
}

export const readLog = (ctx, name) => {
  const f = path.join(ctx.home, name)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
export const lines = (text) => text.split('\n').filter(Boolean)
export const argvLines = (ctx, tool) =>
  lines(readLog(ctx, `${tool}.log`)).map((l) => l.split('\t').filter((s) => s !== ''))
export const stream = (ctx) => lines(readLog(ctx, 'fleet-boot.log')).map((l) => l.replace(/^\S+ /, ''))
export const statusOf = (ctx) => JSON.parse(fs.readFileSync(path.join(ctx.home, 'www', 'status.json'), 'utf8'))
export const states = (ctx) => {
  const out = []
  for (const l of stream(ctx)) {
    const m = /^status: state=(\S+)/.exec(l)
    if (m && out[out.length - 1] !== m[1]) out.push(m[1])
  }
  return out
}
export const indexOf = (ctx, needle) => stream(ctx).findIndex((l) => l.includes(needle))
export const lastIndexOf = (ctx, needle) => {
  const s = stream(ctx)
  for (let i = s.length - 1; i >= 0; i -= 1) if (s[i].includes(needle)) return i
  return -1
}
export const notifies = (ctx) => lines(readLog(ctx, 'notify.log')).map((l) => JSON.parse(l))
/** The status page as it stood at each evidence commit, oldest first. */
export const committed = (ctx) => lines(readLog(ctx, 'commits.log')).map((l) => JSON.parse(l))
export const commitStates = (ctx) => committed(ctx).map((c) => c.state)
export const unitsRun = (ctx) => argvLines(ctx, 'systemd-run').map((a) => a.find((s) => s.startsWith('--unit='))?.slice(7))
export const engineRuns = (ctx) => unitsRun(ctx).filter((u) => u === 'fleet-engine-7').length
export const directCalls = (ctx) => stream(ctx).filter((l) => l.includes(' DIRECT '))
/** Every POST /pulls the script made, as its parsed JSON payload. */
export const prPosts = (ctx) => lines(readLog(ctx, 'pr.log')).map((l) => JSON.parse(l))
/** The curl argv of the PR POST, or undefined. */
export const prArgv = (ctx) => argvLines(ctx, 'curl').find((a) => a.some((s) => s.endsWith('/pulls')))
/** How many times Reflection's /integrations was read. */
export const integrationsReads = (ctx) => stream(ctx).filter((l) => l.startsWith('CALL curl integrations')).length

// ── reading the git log ──────────────────────────────────────────────────────

/** The subcommand, whether or not the call carried `-C <dir>`. */
export const verbOf = (a) => (a[1] === '-C' ? a[3] : a[1])
/** The `-C` directory, or '' when the call carried none. */
export const dirOf = (a) => (a[1] === '-C' ? a[2] : '')
export const gitLog = (ctx) => argvLines(ctx, 'git')
export const evidenceDir = (ctx) => `${ctx.home}/evidence`
export const targetDir = (ctx) => `${ctx.home}/target`

export const isEvidencePush = (a) =>
  verbOf(a) === 'push' && a.some((s) => s === `HEAD:refs/heads/${EVIDENCE_BRANCH}`)
export const isIntegrationPush = (a) =>
  verbOf(a) === 'push' && a.some((s) => s === INTEGRATION_BRANCH) && !isEvidencePush(a)
/** Every path word a `git add` carried, `--` aside. */
export const addArguments = (git) =>
  git
    .filter((a) => verbOf(a) === 'add')
    .flatMap((a) => a.slice(a.indexOf('add') + 1))
    .filter((s) => s !== '--')

/**
 * M2's discipline, as one predicate over the git log, so that leg (d) can show
 * it rejecting a log it must reject. Returns the first problem, or null.
 *
 *  - every push of the evidence branch is made with `-C <home>/evidence`,
 *  - and is preceded by an `add` and a `commit` in that same worktree since
 *    the previous evidence push (one commit per transition),
 *  - and the FIRST evidence push comes before the integration branch's push.
 */
export function evidenceDisciplineProblem(git, evidence) {
  let addSincePush = false
  let commitSincePush = false
  let firstEvidencePush = -1
  let firstIntegrationPush = -1
  for (let i = 0; i < git.length; i += 1) {
    const a = git[i]
    const here = dirOf(a) === evidence
    const verb = verbOf(a)
    if (here && verb === 'add') addSincePush = true
    if (here && verb === 'commit') commitSincePush = true
    if (isEvidencePush(a)) {
      if (!here) return `evidence push ${i} runs in '${dirOf(a)}', not the evidence worktree`
      if (!addSincePush) return `evidence push ${i} has no '-C ${evidence} add' since the previous push`
      if (!commitSincePush) return `evidence push ${i} has no '-C ${evidence} commit' since the previous push`
      if (firstEvidencePush < 0) firstEvidencePush = i
      addSincePush = false
      commitSincePush = false
    }
    if (isIntegrationPush(a) && firstIntegrationPush < 0) firstIntegrationPush = i
  }
  if (firstEvidencePush < 0) return 'no evidence push at all'
  if (firstIntegrationPush >= 0 && firstIntegrationPush < firstEvidencePush) {
    return `the integration push (${firstIntegrationPush}) precedes the first evidence push (${firstEvidencePush})`
  }
  return null
}

// One green run per process, read by every assertion that only reads. A boot
// is ~40 forks of stub shell; running it eight times to ask eight questions of
// the same run is the difference between an exam that fits its budget and one
// that does not.
let GREEN = null
export const green = () => {
  if (!GREEN) {
    GREEN = makeHome()
    const r = boot(GREEN)
    assert.equal(r.status, 0, r.stdout + r.stderr)
  }
  return GREEN
}

// ── the runner ───────────────────────────────────────────────────────────────

/**
 * Run `tests` — `[name, fn]` pairs — in order, printing one `ok (<ms> ms) —
 * <name>` line per passing case. Removes the temp root, then prints
 * `ALL TESTS PASSED`, or the failure count and `FAILED` with exit 1.
 */
export function runTests(tests) {
  let failures = 0
  for (const [name, fn] of tests) {
    const started = Date.now()
    try {
      fn()
      console.log(`ok (${Date.now() - started} ms) — ${name}`)
    } catch (error) {
      failures += 1
      console.log(`FAIL — ${name}`)
      console.log(String(error && error.stack ? error.stack : error))
    }
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  if (failures) {
    console.log(`${failures} FAILED`)
    process.exit(1)
  }
  console.log('ALL TESTS PASSED')
}
