// fleet/tests/exams/run_187/test_factory_boot.mjs — the exam for run-187 task 1,
// `factory/boot.sh boot`: the three hundred lines that read the assignment,
// prove the credential, start the factory engine and publish what it left.
//
// Written against the task's Machine clauses, leg by leg. Every assertion names
// the leg it belongs to and the clause it comes from, so a reader can map this
// file back to the contract:
//
//   M1  `factory/boot.sh boot` reads the assignment from `$FLEET_ASSIGNMENT`
//       when set, else from the `comment` field of `GET $REFLECTION_URL/comment`,
//       and accepts exactly `run`, `plan`, `target`, `base`, `engine`, `tier`,
//       `effort`, `hold`: any other key exits 1 with a line naming it, and a
//       `plan`, `base` or `engine` that is not 40 lowercase hex, or a `target`
//       that is not `owner/repo`, exits 1.
//   M2  it clones `https://github.int.exe.xyz/<target>.git` into
//       `$FLEET_HOME/target` and checks out `base`; fetches
//       `refs/heads/ultra/plan-run-<N>` and exits 1 when `FETCH_HEAD` is not
//       `plan`; writes the blob `<plan>:.ultrapowers/plan.md` to
//       `$FLEET_HOME/plans/run-<N>.md`; fetches the evidence branch and adds a
//       detached worktree at `$FLEET_HOME/evidence` at `FETCH_HEAD` when that
//       fetch succeeded, else at `plan`; writes `status.json` with `state`
//       `running`, commits it `run-<N>: running` and pushes the evidence branch.
//   M3  `npm ci --no-audit --no-fund` in `$FLEET_HOME/engines/<engine>/fleet`
//       when `node_modules` is absent and `package-lock.json` is present there,
//       `npm install --no-audit --no-fund` when it is not, and neither when
//       `node_modules` is present.
//   M4  `claude auth status` must print `oauth_token` and must not print
//       `api_key`, else exit 1; then exactly one `GET
//       $ANTHROPIC_PROXY_URL/api/oauth/usage` with `authorization: Bearer
//       placeholder`, classified by status and body.
//   M5  the engine is one `systemd-run --user --unit=fleet-engine-<N> …` whose
//       argv this exam pins whole; its combined output is appended to
//       `engine.log` and its exit code written to `.fleet-engine-done`; while it
//       runs, every `$FLEET_COMMIT_SECONDS` seconds a changed `events.jsonl` is
//       copied into the evidence tree, committed `run-<N>: events` and pushed,
//       and a tick with no new bytes makes no commit.
//   M6  after the engine exits: the three paths staged, then `failed` /
//       `parked` / the publish path — the integration push, the `publishing`
//       commit, the POST to `/pulls`, the `publish:pr` event, `done` or
//       `parked`, or `failed` with the reply's first 2000 characters.
//   M7  `status.json`'s thirteen top-level keys, their values, and `tasks`.
//   M8  the two tags, the listing that has to show both at those two shas, and
//       the one branch delete it gates — a `failed` run pushes no tag.
//   M9  `factory/boot.sh` is 300 lines or fewer and names no `/usr/bin/` or
//       `/usr/local/bin/` path.
//
// Legs: (a) M1, (b) M2, (c) M3, (d) M4, (e) M5, (f) M6, (g) M7, (h) M8, (i) M9.
//
// HOW IT READS THE BOOT. Nothing here is real: `git`, `curl`, `npm`, `claude`,
// `systemd-run` and `node` are bash stubs written into a temp directory that
// goes FIRST on the `PATH` this exam hands the boot, so the boot's own
// one-line wrappers resolve to them. Every stub appends one directory to
// `<home>/calls/`, named by a microsecond stamp so the whole set sorts into the
// order the boot made the calls, holding: `name`, `cwd`, the resolved `-C`
// repository, the NUL-separated `argv`, the sub-command and its positional
// arguments, and — for every `git commit` — a `snap/` copy of
// `.ultrapowers/runs/7/` exactly as it stood when the commit was made. That
// snapshot is how "the staged bytes" is read: the boot stages named paths and
// commits, so what is on disk at the commit is what the commit carries.
//
// The stubs answer from `<home>/ctl/`, one file per answer, written fresh for
// each drive — which sha `rev-parse` gives back, what the plan blob says, what
// `/api/oauth/usage` replies, what the engine stub writes and exits with. A
// drive is one `bash factory/boot.sh boot` under a temp `FLEET_HOME`,
// `FLEET_COMMIT_SECONDS=1` and an environment derived from `simEnv` (the
// hermetic sweep, `fleet/tests/test_sims_are_hermetic.mjs`, refuses any other).

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simEnv } from '../../_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..', '..')
/** The deliverable. */
const SCRIPT = path.join(ROOT, 'factory', 'boot.sh')

// ── the run's literals ───────────────────────────────────────────────────────

const RUN_N = '7'
const RUN_ID = `run-${RUN_N}`
const TARGET = 'popmechanic/smoke'
const CLONE_URL = `https://github.int.exe.xyz/${TARGET}.git`
const PULLS_URL = `https://github.int.exe.xyz/api/v3/repos/${TARGET}/pulls`
const USAGE_URL = 'https://claude-max.int.exe.xyz/api/oauth/usage'
const COMMENT_URL = 'https://reflection.int.exe.xyz/comment'

const PLAN_SHA = 'a1'.repeat(20)
const BASE_SHA = 'b2'.repeat(20)
const ENGINE_SHA = 'c3'.repeat(20)
/** What `rev-parse HEAD` answers in the target on a run that is ahead of base. */
const HEAD_SHA = 'd4'.repeat(20)
/** What `rev-parse HEAD` answers in the evidence worktree — the sha the
 *  evidence tag has to be listed at. */
const EVIDENCE_HEAD = 'e5'.repeat(20)
/** Some other commit: the plan branch that moved, and the tag at the wrong sha. */
const OTHER_SHA = 'f6'.repeat(20)

const PLAN_REF = `refs/heads/ultra/plan-run-${RUN_N}`
const EVIDENCE_REF = `refs/heads/ultra/evidence-run-${RUN_N}`
const INTEGRATION_BRANCH = `ultra/integration-run-${RUN_N}`
const INTEGRATION_REF = `refs/heads/${INTEGRATION_BRANCH}`
const PLAN_TAG = `refs/tags/ultra/plan/run-${RUN_N}`
const EVIDENCE_TAG = `refs/tags/ultra/evidence/run-${RUN_N}`
/** Where the evidence lives inside the evidence worktree. */
const RUN_PATH = `.ultrapowers/runs/${RUN_N}`

const VM_NAME = 'fleet-r7-x'
const PR_URL = 'https://github.com/o/r/pull/9'
const PR_AUTHOR = 'popmechanic'

/** The assignment the bootstrap hands over: the eight accepted keys. */
const ASSIGNMENT = `run=${RUN_N} plan=${PLAN_SHA} target=${TARGET} base=${BASE_SHA}`
  + ` engine=${ENGINE_SHA} tier=max effort=high hold=0`

/** The thirteen top-level keys of `status.json` [M7]. */
const STATUS_KEYS = [
  'run', 'state', 'phase', 'pr', 'prAuthor', 'merged', 'disclosures', 'branch',
  'vm', 'startedAt', 'updatedAt', 'error', 'tasks',
]

/** A task cell for a landing row [M7]. */
const FOLDED = {
  wave: null, state: 'folded', role: null, lastProof: null, park: null,
  attention: null, blockedBy: null,
}

// The plan blob the stub `git show` answers with. Its H1 is the PR title's
// tail, its `**Summary:**` paragraph — two lines, to the blank line — is the
// head of the PR body, and its `**Closes:**` line is the body's tail.
const PLAN_H1 = 'Smoke: the fleet proves itself'
const PLAN_SUMMARY = 'The run opened one pull request from the sandbox and left its\n'
  + 'record on the two tags the operator reads.'
const PLAN_TEXT = [
  `# ${PLAN_H1}`,
  '',
  '**Goal:** prove the boot reads the plan it was handed.',
  '**Closes:** #4 #5',
  '',
  `**Summary:** ${PLAN_SUMMARY}`,
  '',
  '### Task 1: the first task',
  '',
  'Body of the first task, which names #999 and closes nothing.',
  '',
].join('\n')

// The engine stub's `events.jsonl` rows. `landing` rows carry the six keys the
// PR body's table reads; the `engine:phase` row is the noise a reader has to
// skip; the `parked` row is leg (g)'s failed task.
const NOISE_ROW = { kind: 'engine:phase', phase: 'gate' }
const landing = (task, k, examExit, sha) => ({
  kind: 'landing', task, k, examExit, claim: `claim ${task}`, coverage: 'full',
  candidateSha: sha, wall_ms: 1000 + k,
})
const L1 = landing('1', 1, 0, 'aa'.repeat(20))
const L2 = landing('2', 2, 0, 'bb'.repeat(20))
const L3 = landing('3', 3, 0, 'cc'.repeat(20))
const PARK_ROW = { kind: 'parked', task: '2', reason: 'no ready set' }
const row = (l) => `| ${l.task} | ${l.k} | ${l.examExit} | ${l.candidateSha} |`
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

/** The engine stub's last stdout line — the JSON answer the real engine prints. */
const ANSWER_LINE = JSON.stringify({
  done: true, adopted: 3, head: HEAD_SHA, wall_ms: 1234, cost_usd: 0.5,
})
/** Its first line, so `engine.log` has something that is not the answer. */
const ENGINE_MARK = 'engine stub speaking'

/** What the edge answers the PR POST with, in GitHub's own field order. */
const PR_JSON = JSON.stringify({
  html_url: PR_URL,
  number: 9,
  user: { login: PR_AUTHOR },
  head: { repo: { html_url: 'x' } },
})

/** The listing `ls-remote --tags` gives back when both tags landed [M8]. */
const BOTH_TAGS = `${PLAN_SHA}\t${PLAN_TAG}\n${EVIDENCE_HEAD}\t${EVIDENCE_TAG}\n`

// ── the stubs ────────────────────────────────────────────────────────────────
//
// One bash file per external command. `$FLEET_STUB_CTL` and `$FLEET_STUB_CALLS`
// reach them through the boot's own environment, which `env -u CLAUDE_CONFIG_DIR
// …` on the systemd-run line passes through — so the engine stub sees them too.

const PRELUDE = `#!/usr/bin/env bash
set -u
CTL="\$FLEET_STUB_CTL"
CALLS="\$FLEET_STUB_CALLS"
ctl() { cat "\$CTL/\$1" 2>/dev/null || true; }
REC=""
record() {
  local nm="\$1"; shift
  REC="\$CALLS/\${EPOCHREALTIME//[.,]/}-\$\$-\$RANDOM-\$nm"
  mkdir -p "\$REC"
  printf '%s' "\$nm" >"\$REC/name"
  printf '%s' "\$PWD" >"\$REC/cwd"
  if [ "\$#" -gt 0 ]; then printf '%s\\0' "\$@" >"\$REC/argv"; else : >"\$REC/argv"; fi
  printf 'ANTHROPIC_BASE_URL=%s\\nTYPESAFE_BASE_URL=%s\\nCLAUDE_CODE_OAUTH_TOKEN=%s\\nULTRAPOWERS_FLEET_RUN=%s\\n' \\
    "\${ANTHROPIC_BASE_URL:-}" "\${TYPESAFE_BASE_URL:-}" "\${CLAUDE_CODE_OAUTH_TOKEN:-}" \\
    "\${ULTRAPOWERS_FLEET_RUN:-}" >"\$REC/env"
}
`

/** `git`: records the call, answers by sub-command, and snapshots the run
 *  directory at every commit. */
const GIT_STUB = PRELUDE + `
record git "\$@"
repo="\$PWD"
declare -a A=()
seen=0
while [ "\$#" -gt 0 ]; do
  if [ "\$seen" -eq 0 ]; then
    case "\$1" in
      -C) repo="\$2"; shift 2; continue ;;
      -c) shift 2; continue ;;
      -*) shift; continue ;;
      *) seen=1 ;;
    esac
  fi
  A+=("\$1"); shift
done
printf '%s' "\$repo" >"\$REC/repo"
sub="\${A[0]:-}"
printf '%s' "\$sub" >"\$REC/sub"
declare -a P=()
prev=""
for a in "\${A[@]:1}"; do
  case "\$a" in -*) prev="\$a"; continue ;; esac
  case "\$prev" in -m|--message|-F|-c|-C) prev="\$a"; continue ;; esac
  P+=("\$a"); prev="\$a"
done
if [ "\${#P[@]}" -gt 0 ]; then printf '%s\\0' "\${P[@]}" >"\$REC/pos"; else : >"\$REC/pos"; fi

case "\$sub" in
  clone)
    dest=""
    for a in "\${A[@]:1}"; do case "\$a" in -*) ;; *) dest="\$a" ;; esac; done
    [ -n "\$dest" ] && mkdir -p "\$dest"
    exit "\$(ctl git.clone.exit)"
    ;;
  worktree)
    if [ "\${A[1]:-}" = add ]; then
      dest=""
      for a in "\${A[@]:2}"; do
        case "\$a" in -*) ;; *) if [ -z "\$dest" ]; then dest="\$a"; fi ;; esac
      done
      [ -n "\$dest" ] && mkdir -p "\$dest"
    fi
    exit 0
    ;;
  fetch)
    case " \${A[*]} " in
      *evidence-run-*) exit "\$(ctl git.fetch.evidence.exit)" ;;
      *plan-run-*) exit "\$(ctl git.fetch.plan.exit)" ;;
    esac
    exit 0
    ;;
  rev-parse)
    case "\${P[0]:-}" in
      FETCH_HEAD) ctl git.fetch_head; echo ;;
      HEAD)
        case "\$repo" in
          *evidence*) ctl git.head.evidence; echo ;;
          *) ctl git.head.target; echo ;;
        esac
        ;;
      *) : ;;
    esac
    exit 0
    ;;
  show)
    case "\${P[0]:-}" in
      *.ultrapowers/plan.md) ctl git.show ;;
      *) exit 1 ;;
    esac
    exit 0
    ;;
  cat-file) exit 1 ;;
  symbolic-ref) ctl git.symbolic_ref; echo; exit 0 ;;
  ls-remote) ctl git.ls_remote; exit 0 ;;
  config)
    if [ "\${#A[@]}" -le 2 ]; then exit 1; fi
    exit 0
    ;;
  commit)
    prev=""
    for a in "\${A[@]:1}"; do
      case "\$prev" in -m|--message) printf '%s' "\$a" >"\$REC/subject"; break ;; esac
      case "\$a" in --message=*) printf '%s' "\${a#--message=}" >"\$REC/subject"; break ;; esac
      prev="\$a"
    done
    src="\$repo/.ultrapowers/runs/\$(ctl run.n)"
    if [ -d "\$src" ]; then mkdir -p "\$REC/snap"; cp -a "\$src/." "\$REC/snap/"; fi
    exit 0
    ;;
  push) exit "\$(ctl git.push.exit)" ;;
  *) exit 0 ;;
esac
`

/** `curl`: records the call and answers by the URL's tail. */
const CURL_STUB = PRELUDE + `
record curl "\$@"
url=""; wfmt=""; out=""; dump=""; failflag=0; include=0
for a in "\$@"; do
  case "\$a" in
    http://*|https://*) url="\$a" ;;
  esac
done
i=1
while [ "\$i" -le "\$#" ]; do
  a="\${!i}"
  j=\$(( i + 1 ))
  case "\$a" in
    -w|--write-out) wfmt="\${!j:-}"; i=\$j ;;
    -o|--output) out="\${!j:-}"; i=\$j ;;
    -D|--dump-header) dump="\${!j:-}"; i=\$j ;;
    -i|--include) include=1 ;;
    --fail) failflag=1 ;;
    -[a-zA-Z]*) case "\$a" in *f*) failflag=1 ;; esac ;;
  esac
  i=\$(( i + 1 ))
done

status=404
bodyfile="\$REC/unknown"
printf 'stub curl: no answer for %s' "\$url" >"\$bodyfile"
case "\$url" in
  */api/oauth/usage)
    e="\$(ctl curl.usage.exit)"
    if [ "\${e:-0}" != 0 ]; then exit "\$e"; fi
    status="\$(ctl curl.usage.status)"
    bodyfile="\$CTL/curl.usage.body"
    ;;
  */pulls)
    status="\$(ctl curl.pulls.status)"
    bodyfile="\$CTL/curl.pulls.body"
    ;;
  */comment)
    if [ ! -s "\$CTL/curl.comment" ]; then exit 7; fi
    status=200
    bodyfile="\$CTL/curl.comment"
    ;;
  *reflection*)
    if [ ! -s "\$CTL/curl.name" ]; then exit 7; fi
    status=200
    bodyfile="\$CTL/curl.name"
    ;;
esac

if [ "\$failflag" = 1 ] && [ "\$status" -ge 400 ]; then exit 22; fi
header="HTTP/1.1 \$status stub"
[ -n "\$dump" ] && printf '%s\\r\\n\\r\\n' "\$header" >"\$dump"
emit() {
  if [ "\$include" = 1 ]; then printf '%s\\r\\n\\r\\n' "\$header"; fi
  cat "\$bodyfile"
}
if [ -n "\$out" ]; then emit >"\$out"; else emit; fi
if [ -n "\$wfmt" ]; then printf '%b' "\${wfmt//'%{http_code}'/\$status}"; fi
exit 0
`

/** `npm`: records the call and its cwd, and does nothing. */
const NPM_STUB = PRELUDE + `
record npm "\$@"
exit 0
`

/** `claude`: records the call and prints what the drive configured. */
const CLAUDE_STUB = PRELUDE + `
record claude "\$@"
for a in "\$@"; do
  case "\$a" in --version) printf '1.0.0 (Claude Code)\\n'; exit 0 ;; esac
done
ctl claude.out
printf '\\n'
exit 0
`

/** `systemd-run`: records the call, then runs the command after `--` itself in
 *  the `WorkingDirectory=` it was given. */
const SYSTEMD_STUB = PRELUDE + `
record systemd-run "\$@"
wd=""
declare -a CMD=()
seen=0
for a in "\$@"; do
  if [ "\$seen" = 1 ]; then CMD+=("\$a"); continue; fi
  case "\$a" in
    --) seen=1 ;;
    WorkingDirectory=*) wd="\${a#WorkingDirectory=}" ;;
  esac
done
if [ -n "\$wd" ]; then cd "\$wd" || exit 1; fi
if [ "\${#CMD[@]}" -eq 0 ]; then exit 0; fi
exec "\${CMD[@]}"
`

/** `node`: the engine stub. Writes its first rows, sleeps, writes the rest,
 *  prints its answer line and exits with the code the drive configured. */
const NODE_STUB = PRELUDE + `
record node "\$@"
rundir=""
prev=""
for a in "\$@"; do
  if [ "\$prev" = --run-dir ]; then rundir="\$a"; fi
  prev="\$a"
done
[ -n "\$rundir" ] || rundir="\$FLEET_HOME/run"
mkdir -p "\$rundir"
ctl node.stdout
printf '\\n'
cat "\$CTL/node.rows1" >>"\$rundir/events.jsonl"
s="\$(ctl node.sleep)"
if [ "\${s:-0}" != 0 ]; then sleep "\$s"; fi
if [ -s "\$CTL/node.rows2" ]; then cat "\$CTL/node.rows2" >>"\$rundir/events.jsonl"; fi
if [ -s "\$CTL/node.answer" ]; then ctl node.answer; printf '\\n'; fi
exit "\$(ctl node.exit)"
`

const STUBS = {
  git: GIT_STUB,
  curl: CURL_STUB,
  npm: NPM_STUB,
  claude: CLAUDE_STUB,
  'systemd-run': SYSTEMD_STUB,
  node: NODE_STUB,
}

// ── the rig ──────────────────────────────────────────────────────────────────

const TMP_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'factory-boot-exam-')))
const BIN_DIR = path.join(TMP_ROOT, 'bin')
fs.mkdirSync(BIN_DIR)
for (const [name, text] of Object.entries(STUBS)) {
  const file = path.join(BIN_DIR, name)
  fs.writeFileSync(file, text)
  fs.chmodSync(file, 0o755)
}

/** The directories of the parent's `PATH` that hold the ordinary utilities a
 *  shell script uses. `simEnv` puts `node`, `python3`, `git`, `bash` and `sh`
 *  on the PATH it builds and nothing else; a boot script also runs `mkdir`,
 *  `cp`, `mv`, `sed`, `awk`, `date` and friends, and the stub directory goes
 *  ahead of all of it, so a stubbed name is never resolved here. */
const utilityDirs = () => {
  const names = ['mkdir', 'cp', 'mv', 'rm', 'cat', 'sed', 'awk', 'date', 'sleep',
    'tr', 'wc', 'head', 'tail', 'env', 'touch', 'id', 'grep', 'find', 'sort', 'cut']
  const dirs = []
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir || dirs.includes(dir)) continue
    for (const name of names) {
      try {
        fs.accessSync(path.join(dir, name), fs.constants.X_OK)
        dirs.push(dir)
        break
      } catch {
        // not here; keep walking
      }
    }
  }
  return dirs
}
const UTILITY_DIRS = utilityDirs()

/** The answers every stub gives unless a drive says otherwise. */
const defaultCtl = () => ({
  'run.n': RUN_N,
  'git.clone.exit': '0',
  'git.fetch.plan.exit': '0',
  'git.fetch.evidence.exit': '0',
  'git.push.exit': '0',
  'git.fetch_head': PLAN_SHA,
  'git.head.target': HEAD_SHA,
  'git.head.evidence': EVIDENCE_HEAD,
  'git.symbolic_ref': 'refs/remotes/origin/main',
  'git.ls_remote': BOTH_TAGS,
  'git.show': PLAN_TEXT,
  'curl.comment': '',
  'curl.name': `{"name":"${VM_NAME}"}`,
  'curl.usage.status': '200',
  'curl.usage.body': '{}',
  'curl.usage.exit': '0',
  'curl.pulls.status': '201',
  'curl.pulls.body': PR_JSON,
  'claude.out': 'authMethod: oauth_token',
  'node.stdout': ENGINE_MARK,
  'node.rows1': jsonl([NOISE_ROW, L1, L2, L3]),
  'node.rows2': '',
  'node.sleep': '0',
  'node.answer': ANSWER_LINE,
  'node.exit': '0',
})

/**
 * One boot. `cfg` may carry `assignment` (or `null`, to leave
 * `FLEET_ASSIGNMENT` unset), `ctl` overrides, `lockfile` and `nodeModules`
 * (the engine checkout's shape) and `env` additions.
 */
const runBoot = (label, cfg = {}) => {
  if (!fs.existsSync(SCRIPT)) {
    throw new Error(`factory/boot.sh does not exist at ${SCRIPT} — the boot has not been written yet`)
  }
  const home = fs.realpathSync(fs.mkdtempSync(path.join(TMP_ROOT, `${label}-`)))
  const ctlDir = path.join(home, 'ctl')
  const callsDir = path.join(home, 'calls')
  fs.mkdirSync(ctlDir)
  fs.mkdirSync(callsDir)
  const ctl = { ...defaultCtl(), ...(cfg.ctl ?? {}) }
  for (const [name, value] of Object.entries(ctl)) {
    fs.writeFileSync(path.join(ctlDir, name), value)
  }

  // The engine checkout the immutable bootstrap left behind.
  const engineFleet = path.join(home, 'engines', ENGINE_SHA, 'fleet')
  fs.mkdirSync(path.join(home, 'engines', ENGINE_SHA, 'factory'), { recursive: true })
  fs.mkdirSync(engineFleet, { recursive: true })
  fs.writeFileSync(path.join(home, 'engines', ENGINE_SHA, 'factory', 'engine.mjs'), '// the engine\n')
  fs.writeFileSync(path.join(engineFleet, 'package.json'),
    '{"name":"fleet","dependencies":{"ulid":"2.3.0"}}\n')
  if (cfg.lockfile !== false) fs.writeFileSync(path.join(engineFleet, 'package-lock.json'), '{}\n')
  if (cfg.nodeModules !== false) fs.mkdirSync(path.join(engineFleet, 'node_modules'))

  const assignment = cfg.assignment === undefined ? ASSIGNMENT : cfg.assignment
  const outFile = path.join(home, 'boot.out')
  const fd = fs.openSync(outFile, 'a')
  const result = spawnSync('bash', [SCRIPT, 'boot'], {
    cwd: home,
    stdio: ['ignore', fd, fd],
    timeout: 120000,
    env: simEnv({
      bin: [BIN_DIR, ...UTILITY_DIRS],
      home,
      env: {
        FLEET_HOME: home,
        FLEET_COMMIT_SECONDS: '1',
        FLEET_STUB_CTL: ctlDir,
        FLEET_STUB_CALLS: callsDir,
        ...(assignment === null ? {} : { FLEET_ASSIGNMENT: assignment }),
        ...(cfg.env ?? {}),
      },
    }),
  })
  fs.closeSync(fd)

  const read = (file) => {
    try {
      return fs.readFileSync(path.join(home, file), 'utf8')
    } catch {
      return null
    }
  }
  const out = (read('boot.out') ?? '') + (read('fleet-boot.log') ?? '')
  return {
    label, home, exit: result.status, signal: result.signal, error: result.error,
    out, calls: readCalls(callsDir),
    evidenceRun: path.join(home, 'evidence', RUN_PATH),
  }
}

/** Every recorded call, in the order the stubs made them. */
const readCalls = (dir) => fs.readdirSync(dir).sort().map((name) => {
  const at = path.join(dir, name)
  const file = (f) => {
    try {
      return fs.readFileSync(path.join(at, f), 'utf8')
    } catch {
      return null
    }
  }
  const nul = (f) => {
    const text = file(f)
    if (text == null) return []
    const parts = text.split('\0')
    if (parts.length && parts[parts.length - 1] === '') parts.pop()
    return parts
  }
  const snap = path.join(at, 'snap')
  return {
    name: file('name'), cwd: file('cwd'), repo: file('repo'), sub: file('sub'),
    argv: nul('argv'), pos: nul('pos'), subject: file('subject'), env: file('env'),
    snap: fs.existsSync(snap) ? snap : null,
  }
})

// ── reading a drive ──────────────────────────────────────────────────────────

const of = (d, name) => d.calls.filter((c) => c.name === name)
const gits = (d, sub) => of(d, 'git').filter((c) => c.sub === sub)
const commits = (d, repo) => gits(d, 'commit').filter((c) => repo == null || c.repo === repo)
const urlOf = (c) => c.argv.find((a) => a.startsWith('http://') || a.startsWith('https://')) ?? ''
const curlsTo = (d, url) => of(d, 'curl').filter((c) => urlOf(c) === url)
/** The `-d` payload of a curl call. */
const dataOf = (c) => {
  for (let i = 0; i < c.argv.length - 1; i += 1) {
    if (['-d', '--data', '--data-raw', '--data-binary'].includes(c.argv[i])) return c.argv[i + 1]
  }
  return null
}
const snapFile = (c, name) => {
  if (!c.snap) return null
  try {
    return fs.readFileSync(path.join(c.snap, name), 'utf8')
  } catch {
    return null
  }
}
const statusAt = (c) => {
  const text = snapFile(c, 'status.json')
  assert.ok(text != null, `the commit "${c.subject}" carries a status.json in ${RUN_PATH}/`)
  return JSON.parse(text)
}
const finalStatus = (d) => {
  const file = path.join(d.evidenceRun, 'status.json')
  assert.ok(fs.existsSync(file), `${d.label}: ${RUN_PATH}/status.json exists when the boot is done`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
const evidenceDir = (d) => path.join(d.home, 'evidence')
const targetDir = (d) => path.join(d.home, 'target')
const say = (d) => `\n--- ${d.label}: exit ${d.exit} ---\n${d.out.slice(-4000)}`

// ── the drives ───────────────────────────────────────────────────────────────
//
// Each is built once, on the first leg that reads it.

const CONFIGS = {
  // The green publish drive: the assignment in the environment, the evidence
  // branch already on the remote, an engine that adopts everything, a 201 from
  // the edge. Legs (b), (e)'s argv, (f), (g) and (h) all read it.
  MAIN: { nodeModules: true },
  // The same, with no Reflection at all: the assignment still arrives, and the
  // page's `vm` is null.
  NO_REFLECTION: { ctl: { 'curl.name': '' } },
  // The assignment off `GET /comment`.
  VIA_COMMENT: { assignment: null, ctl: { 'curl.comment': `{"comment":"${ASSIGNMENT}"}` } },
  UNKNOWN_KEY: { assignment: `${ASSIGNMENT} foo=1` },
  BAD_PLAN: { assignment: ASSIGNMENT.replace(`plan=${PLAN_SHA}`, 'plan=abc') },
  BAD_BASE: { assignment: ASSIGNMENT.replace(`base=${BASE_SHA}`, 'base=abc') },
  BAD_ENGINE: { assignment: ASSIGNMENT.replace(`engine=${ENGINE_SHA}`, 'engine=abc') },
  UPPER_ENGINE: {
    assignment: ASSIGNMENT.replace(`engine=${ENGINE_SHA}`, `engine=${ENGINE_SHA.toUpperCase()}`),
  },
  BAD_TARGET: { assignment: ASSIGNMENT.replace(`target=${TARGET}`, 'target=nope') },
  // The plan branch someone else moved.
  PLAN_MOVED: { ctl: { 'git.fetch_head': OTHER_SHA } },
  // No evidence branch on the remote yet: the worktree is parented on the plan.
  NO_EVIDENCE_BRANCH: { ctl: { 'git.fetch.evidence.exit': '1' } },
  // The three shapes of the install [M3].
  NPM_CI: { lockfile: true, nodeModules: false },
  NPM_INSTALL: { lockfile: false, nodeModules: false },
  NPM_NEITHER: { lockfile: true, nodeModules: true },
  // The credential [M4].
  AUTH_API_KEY: { ctl: { 'claude.out': 'authMethod: api_key' } },
  AUTH_NEITHER: { ctl: { 'claude.out': 'Not logged in' } },
  PROBE_SCOPE_403: {
    ctl: {
      'curl.usage.status': '403',
      'curl.usage.body': '{"type":"error","error":{"type":"oauth_scope_insufficient","message":"x"}}',
    },
  },
  PROBE_SCOPE_401: {
    ctl: {
      'curl.usage.status': '401',
      'curl.usage.body': '{"type":"error","error":{"type":"oauth_scope_insufficient","message":"x"}}',
    },
  },
  PROBE_REVOKED_403: {
    ctl: {
      'curl.usage.status': '403',
      'curl.usage.body': '{"type":"error","error":{"message":"revoked"}}',
    },
  },
  PROBE_REVOKED_401: {
    ctl: {
      'curl.usage.status': '401',
      'curl.usage.body': '{"type":"error","error":{"message":"OAuth access token has been revoked"}}',
    },
  },
  PROBE_EDGE: {
    ctl: {
      'curl.usage.status': '403',
      'curl.usage.body':
        'integration not found or not attached to this VM (trace: 0123456789abcdef0123456789abcdef)',
    },
  },
  PROBE_500: { ctl: { 'curl.usage.status': '500', 'curl.usage.body': 'oops' } },
  PROBE_NO_ANSWER: { ctl: { 'curl.usage.exit': '7' } },
  // The engine that takes three seconds to write its third row [M5].
  TICKING: {
    ctl: {
      'node.rows1': jsonl([NOISE_ROW, L1, L2]),
      'node.sleep': '3',
      'node.rows2': jsonl([L3]),
      'node.exit': '3',
    },
  },
  // The four ends of a run [M6].
  ENGINE_FAILED: { ctl: { 'node.exit': '2', 'node.answer': '' } },
  NOTHING_AHEAD: { ctl: { 'git.head.target': BASE_SHA } },
  ADOPTED_PARKED: { ctl: { 'node.exit': '1' } },
  PR_REFUSED: { ctl: { 'curl.pulls.status': '422', 'curl.pulls.body': 'x'.repeat(3000) } },
  // A run whose second task parked [M7].
  PARKED_TASK: { ctl: { 'node.rows1': jsonl([NOISE_ROW, L1, PARK_ROW, L3]) } },
  // The three listings that are not the record [M8].
  TAG_PLAN_WRONG: {
    ctl: { 'git.ls_remote': `${OTHER_SHA}\t${PLAN_TAG}\n${EVIDENCE_HEAD}\t${EVIDENCE_TAG}\n` },
  },
  TAG_EVIDENCE_WRONG: {
    ctl: { 'git.ls_remote': `${PLAN_SHA}\t${PLAN_TAG}\n${OTHER_SHA}\t${EVIDENCE_TAG}\n` },
  },
  TAG_ONE_ONLY: { ctl: { 'git.ls_remote': `${PLAN_SHA}\t${PLAN_TAG}\n` } },
}

const DRIVEN = new Map()
const drive = (label) => {
  if (!DRIVEN.has(label)) {
    assert.ok(CONFIGS[label], `the rig knows the drive ${label}`)
    DRIVEN.set(label, runBoot(label, CONFIGS[label]))
  }
  return DRIVEN.get(label)
}

// ── the exam ─────────────────────────────────────────────────────────────────

const tests = []
const test = (name, fn) => tests.push([name, fn])

// (a) [M1] the assignment: where it comes from and what it may say.

test('(a) [M1] the assignment in $FLEET_ASSIGNMENT is read, and the clone is of the target', () => {
  const d = drive('NO_REFLECTION')
  const clone = gits(d, 'clone')
  assert.equal(clone.length, 1, `(a) [M1] exactly one clone${say(d)}`)
  assert.deepEqual(clone[0].pos, [CLONE_URL, targetDir(d)],
    `(a) [M1] the clone is of ${CLONE_URL} into <FLEET_HOME>/target${say(d)}`)
})

test('(a) [M1] with $FLEET_ASSIGNMENT unset the comment comes off GET $REFLECTION_URL/comment', () => {
  const d = drive('VIA_COMMENT')
  assert.equal(curlsTo(d, COMMENT_URL).length, 1,
    `(a) [M1] exactly one GET ${COMMENT_URL}${say(d)}`)
  const clone = gits(d, 'clone')
  assert.equal(clone.length, 1, `(a) [M1] the same clone happens${say(d)}`)
  assert.deepEqual(clone[0].pos, [CLONE_URL, targetDir(d)],
    `(a) [M1] the clone read out of the comment is of ${CLONE_URL}${say(d)}`)
})

test('(a) [M1] a ninth key exits 1 and the log names it', () => {
  const d = drive('UNKNOWN_KEY')
  assert.equal(d.exit, 1, `(a) [M1] a comment carrying foo=1 exits 1${say(d)}`)
  assert.ok(d.out.includes('foo'), `(a) [M1] the log names foo${say(d)}`)
})

for (const [label, why] of [
  ['BAD_PLAN', 'plan=abc'],
  ['BAD_BASE', 'base=abc'],
  ['BAD_ENGINE', 'engine=abc'],
  ['UPPER_ENGINE', 'engine= 40 uppercase hex'],
  ['BAD_TARGET', 'target=nope'],
]) {
  test(`(a) [M1] ${why} exits 1 before the stub git is called`, () => {
    const d = drive(label)
    assert.equal(d.exit, 1, `(a) [M1] ${why} exits 1${say(d)}`)
    assert.deepEqual(of(d, 'git').map((c) => c.argv.join(' ')), [],
      `(a) [M1] ${why} runs no git at all${say(d)}`)
  })
}

// (b) [M2] the clone, the plan, the evidence worktree and the first commit.

test('(b) [M2] clone, then checkout base, then fetch the plan branch, in that order', () => {
  const d = drive('MAIN')
  const calls = of(d, 'git')
  const cloneAt = calls.findIndex((c) => c.sub === 'clone')
  const checkoutAt = calls.findIndex((c) => c.sub === 'checkout' && c.pos.includes(BASE_SHA))
  const fetchAt = calls.findIndex((c) => c.sub === 'fetch'
    && c.pos.length === 2 && c.pos[0] === 'origin' && c.pos[1] === PLAN_REF)
  assert.ok(cloneAt >= 0, `(b) [M2] a clone${say(d)}`)
  assert.ok(checkoutAt > cloneAt, `(b) [M2] checkout ${BASE_SHA} after the clone${say(d)}`)
  assert.ok(fetchAt > checkoutAt, `(b) [M2] fetch origin ${PLAN_REF} after the checkout${say(d)}`)
  assert.equal(calls[checkoutAt].repo, targetDir(d), '(b) [M2] the checkout is in the target clone')
  assert.equal(calls[fetchAt].repo, targetDir(d), '(b) [M2] the fetch is in the target clone')
})

test('(b) [M2] a plan branch at another sha exits 1 and the log names the mismatch', () => {
  const d = drive('PLAN_MOVED')
  assert.equal(d.exit, 1, `(b) [M2] FETCH_HEAD is not plan= — exit 1${say(d)}`)
  assert.ok(d.out.includes(OTHER_SHA) && d.out.includes(PLAN_SHA),
    `(b) [M2] the log names what landed and what was assigned${say(d)}`)
  assert.deepEqual(gits(d, 'worktree'), [], `(b) [M2] no evidence worktree is added${say(d)}`)
})

test('(b) [M2] the plan blob is written to <FLEET_HOME>/plans/run-7.md byte for byte', () => {
  const d = drive('MAIN')
  const show = gits(d, 'show')
  assert.ok(show.some((c) => c.pos[0] === `${PLAN_SHA}:.ultrapowers/plan.md`),
    `(b) [M2] git show ${PLAN_SHA}:.ultrapowers/plan.md${say(d)}`)
  const file = path.join(d.home, 'plans', `run-${RUN_N}.md`)
  assert.ok(fs.existsSync(file), `(b) [M2] ${file} exists${say(d)}`)
  assert.equal(fs.readFileSync(file, 'utf8'), PLAN_TEXT,
    '(b) [M2] it holds exactly the bytes the stub answered `show` with')
})

test('(b) [M2] the evidence worktree is detached at FETCH_HEAD when the branch is on the remote', () => {
  const d = drive('MAIN')
  const add = gits(d, 'worktree')
  assert.equal(add.length, 1, `(b) [M2] exactly one worktree add${say(d)}`)
  assert.ok(add[0].argv.includes('--detach'), `(b) [M2] it is --detach${say(d)}`)
  assert.deepEqual(add[0].pos, ['add', evidenceDir(d), 'FETCH_HEAD'],
    `(b) [M2] worktree add --detach <FLEET_HOME>/evidence FETCH_HEAD${say(d)}`)
  const fetchAt = d.calls.findIndex((c) => c.sub === 'fetch' && c.pos.includes(EVIDENCE_REF))
  assert.ok(fetchAt >= 0, `(b) [M2] the evidence branch was fetched first${say(d)}`)
})

test('(b) [M2] with no evidence branch the worktree is detached at the plan commit', () => {
  const d = drive('NO_EVIDENCE_BRANCH')
  const add = gits(d, 'worktree')
  assert.equal(add.length, 1, `(b) [M2] exactly one worktree add${say(d)}`)
  assert.ok(add[0].argv.includes('--detach'), `(b) [M2] it is --detach${say(d)}`)
  assert.deepEqual(add[0].pos, ['add', evidenceDir(d), PLAN_SHA],
    `(b) [M2] worktree add --detach <FLEET_HOME>/evidence ${PLAN_SHA}${say(d)}`)
})

test('(b) [M2] the first evidence commit is `run-7: running`, pushed, with state running', () => {
  const d = drive('MAIN')
  const evidence = evidenceDir(d)
  const first = commits(d, evidence)[0]
  assert.ok(first, `(b) [M2] the boot commits in the evidence worktree${say(d)}`)
  assert.equal(first.subject, `${RUN_ID}: running`,
    `(b) [M2] the first evidence commit's subject${say(d)}`)
  assert.equal(statusAt(first).state, 'running',
    '(b) [M2] the status.json that commit carries is in state running')
  const at = d.calls.indexOf(first)
  const pushed = d.calls.slice(at + 1).find((c) => c.name === 'git' && c.sub === 'push'
    && c.repo === evidence && c.pos[1] === `HEAD:${EVIDENCE_REF}`)
  assert.ok(pushed, `(b) [M2] push origin HEAD:${EVIDENCE_REF} after that commit${say(d)}`)
  assert.deepEqual(pushed.pos, ['origin', `HEAD:${EVIDENCE_REF}`],
    `(b) [M2] the push names origin and HEAD:${EVIDENCE_REF}${say(d)}`)
})

// (c) [M3] the install.

test('(c) [M3] a lockfile and no node_modules is `npm ci --no-audit --no-fund` in the engine', () => {
  const d = drive('NPM_CI')
  const npm = of(d, 'npm')
  assert.equal(npm.length, 1, `(c) [M3] exactly one npm call${say(d)}`)
  assert.deepEqual(npm[0].argv, ['ci', '--no-audit', '--no-fund'],
    `(c) [M3] the argv is ci --no-audit --no-fund${say(d)}`)
  assert.equal(npm[0].cwd, path.join(d.home, 'engines', ENGINE_SHA, 'fleet'),
    `(c) [M3] run in <FLEET_HOME>/engines/<engine>/fleet${say(d)}`)
})

test('(c) [M3] no lockfile and no node_modules is `npm install --no-audit --no-fund`', () => {
  const d = drive('NPM_INSTALL')
  const npm = of(d, 'npm')
  assert.equal(npm.length, 1, `(c) [M3] exactly one npm call${say(d)}`)
  assert.deepEqual(npm[0].argv, ['install', '--no-audit', '--no-fund'],
    `(c) [M3] the argv is install --no-audit --no-fund${say(d)}`)
  assert.equal(npm[0].cwd, path.join(d.home, 'engines', ENGINE_SHA, 'fleet'),
    `(c) [M3] run in <FLEET_HOME>/engines/<engine>/fleet${say(d)}`)
})

test('(c) [M3] node_modules present runs neither', () => {
  const d = drive('NPM_NEITHER')
  assert.deepEqual(of(d, 'npm').map((c) => c.argv.join(' ')), [],
    `(c) [M3] the stub npm is never called${say(d)}`)
})

// (d) [M4] the credential: the auth status and the one probe.

test('(d) [M4] `claude auth status` reporting api_key exits 1 before the engine starts', () => {
  const d = drive('AUTH_API_KEY')
  assert.equal(d.exit, 1, `(d) [M4] api_key refuses the run${say(d)}`)
  assert.deepEqual(of(d, 'systemd-run').map((c) => c.argv.join(' ')), [],
    `(d) [M4] the stub systemd-run is never called${say(d)}`)
})

test('(d) [M4] `claude auth status` printing neither word exits 1 before the engine starts', () => {
  const d = drive('AUTH_NEITHER')
  assert.equal(d.exit, 1, `(d) [M4] no oauth_token refuses the run${say(d)}`)
  assert.deepEqual(of(d, 'systemd-run').map((c) => c.argv.join(' ')), [],
    `(d) [M4] the stub systemd-run is never called${say(d)}`)
})

test('(d) [M4] the auth status is asked with the proxy and the placeholder', () => {
  const d = drive('MAIN')
  const claude = of(d, 'claude').filter((c) => c.argv.includes('auth'))
  assert.ok(claude.length >= 1, `(d) [M4] claude auth status is run${say(d)}`)
  assert.deepEqual(claude[0].argv, ['auth', 'status'], `(d) [M4] its argv is auth status${say(d)}`)
  assert.ok(claude[0].env.includes('ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz'),
    `(d) [M4] ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL${say(d)}`)
  assert.ok(claude[0].env.includes('CLAUDE_CODE_OAUTH_TOKEN=placeholder'),
    `(d) [M4] CLAUDE_CODE_OAUTH_TOKEN=placeholder${say(d)}`)
})

for (const [label, what, line] of [
  ['MAIN', '200', 'bearer probe: alive'],
  ['PROBE_SCOPE_403', '403 carrying oauth_scope_insufficient', 'bearer probe: inconclusive (scope)'],
  ['PROBE_SCOPE_401', '401 carrying oauth_scope_insufficient', 'bearer probe: inconclusive (scope)'],
  ['PROBE_500', '500', 'bearer probe: inconclusive'],
  ['PROBE_NO_ANSWER', 'no answer at all', 'bearer probe: inconclusive'],
]) {
  test(`(d) [M4] a ${what} proceeds, logging \`${line}\``, () => {
    const d = drive(label)
    assert.ok(d.out.includes(line), `(d) [M4] the log carries \`${line}\`${say(d)}`)
    assert.equal(of(d, 'systemd-run').length, 1,
      `(d) [M4] the engine is started anyway${say(d)}`)
  })
}

for (const [label, what, carried] of [
  ['PROBE_REVOKED_403', 'a 403 "type":"error" body', 'revoked'],
  ['PROBE_REVOKED_401', 'a 401 "type":"error" body', 'has been revoked'],
  ['PROBE_EDGE', 'a 403 `integration not found` body',
    '0123456789abcdef0123456789abcdef'],
]) {
  test(`(d) [M4] ${what} exits 1 with \`${carried}\` in the log`, () => {
    const d = drive(label)
    assert.equal(d.exit, 1, `(d) [M4] ${what} refuses the run${say(d)}`)
    assert.ok(d.out.includes(carried), `(d) [M4] the log carries \`${carried}\`${say(d)}`)
    assert.deepEqual(of(d, 'systemd-run').map((c) => c.argv.join(' ')), [],
      `(d) [M4] no engine is started${say(d)}`)
  })
}

test('(d) [M4] exactly one GET /api/oauth/usage, carrying the placeholder bearer', () => {
  const d = drive('MAIN')
  const probes = curlsTo(d, USAGE_URL)
  assert.equal(probes.length, 1, `(d) [M4] exactly one request to ${USAGE_URL}${say(d)}`)
  assert.ok(probes[0].argv.includes('authorization: Bearer placeholder'),
    `(d) [M4] it carries the header authorization: Bearer placeholder — read: `
    + `${JSON.stringify(probes[0].argv)}${say(d)}`)
})

// (e) [M5] the engine unit, its record, and the commit tick.

test('(e) [M5] the systemd-run argv is the unit the clause spells, in order', () => {
  const d = drive('MAIN')
  const units = of(d, 'systemd-run')
  assert.equal(units.length, 1, `(e) [M5] exactly one systemd-run${say(d)}`)
  assert.deepEqual(units[0].argv, [
    '--user', `--unit=fleet-engine-${RUN_N}`, '--pipe', '--wait', '--collect',
    '-p', 'MemoryMax=40G',
    '-p', 'MemorySwapMax=0',
    '-p', 'LimitNOFILE=524288',
    '-p', `WorkingDirectory=${targetDir(d)}`,
    '--',
    'env', '-u', 'CLAUDE_CONFIG_DIR',
    'ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz',
    'TYPESAFE_BASE_URL=https://typesafe.int.exe.xyz',
    'CLAUDE_CODE_OAUTH_TOKEN=placeholder',
    `ULTRAPOWERS_FLEET_RUN=${RUN_ID}`,
    'node', path.join(d.home, 'engines', ENGINE_SHA, 'factory', 'engine.mjs'),
    '--plan', path.join(d.home, 'plans', `run-${RUN_N}.md`),
    '--target', targetDir(d),
    '--base', BASE_SHA,
    '--run-dir', path.join(d.home, 'run'),
  ], `(e) [M5] the recorded argv${say(d)}`)
})

test('(e) [M5] the engine`s exit code lands in .fleet-engine-done and its output in engine.log', () => {
  const d = drive('TICKING')
  const done = path.join(d.home, '.fleet-engine-done')
  assert.ok(fs.existsSync(done), `(e) [M5] <FLEET_HOME>/.fleet-engine-done exists${say(d)}`)
  assert.equal(fs.readFileSync(done, 'utf8').trim(), '3',
    `(e) [M5] it holds the engine's exit code${say(d)}`)
  const log = path.join(d.home, 'engine.log')
  assert.ok(fs.existsSync(log), `(e) [M5] <FLEET_HOME>/engine.log exists${say(d)}`)
  const text = fs.readFileSync(log, 'utf8')
  assert.ok(text.includes(ENGINE_MARK), `(e) [M5] it holds the engine's stdout${say(d)}`)
  assert.ok(text.includes(ANSWER_LINE), `(e) [M5] including its answer line${say(d)}`)
})

test('(e) [M5] a tick commits the events the engine had written by then, and nothing else', () => {
  const d = drive('TICKING')
  const ticks = commits(d, evidenceDir(d)).filter((c) => c.subject === `${RUN_ID}: events`)
  assert.ok(ticks.length >= 1, `(e) [M5] at least one \`${RUN_ID}: events\` commit${say(d)}`)
  const early = ticks.find((c) => snapFile(c, 'events.jsonl') === jsonl([NOISE_ROW, L1, L2]))
  assert.ok(early,
    `(e) [M5] one of them carries exactly the rows the engine had written before it slept — read: `
    + `${JSON.stringify(ticks.map((c) => snapFile(c, 'events.jsonl')))}${say(d)}`)
  assert.deepEqual(fs.readdirSync(early.snap).sort(), ['events.jsonl', 'status.json'],
    `(e) [M5] and ${RUN_PATH}/ holds no other file at that point${say(d)}`)
  const pushed = d.calls.slice(d.calls.indexOf(early) + 1).find((c) => c.name === 'git'
    && c.sub === 'push' && c.repo === evidenceDir(d) && c.pos[1] === `HEAD:${EVIDENCE_REF}`)
  assert.ok(pushed, `(e) [M5] the tick pushes HEAD:${EVIDENCE_REF}${say(d)}`)
})

test('(e) [M5] a tick with no new bytes makes no commit', () => {
  const d = drive('TICKING')
  const ticks = commits(d, evidenceDir(d)).filter((c) => c.subject === `${RUN_ID}: events`)
  const bytes = ticks.map((c) => snapFile(c, 'events.jsonl'))
  for (let i = 1; i < bytes.length; i += 1) {
    assert.notEqual(bytes[i], bytes[i - 1],
      `(e) [M5] two consecutive \`${RUN_ID}: events\` commits carry identical bytes${say(d)}`)
  }
})

// (f) [M6] the four ends of a run.

test('(f) [M6] after the engine exits the three paths are copied beside status.json and staged', () => {
  const d = drive('MAIN')
  assert.deepEqual(fs.readdirSync(d.evidenceRun).sort(),
    ['engine.log', 'events.jsonl', 'status.json'],
    `(f) [M6] ${RUN_PATH}/ holds exactly the three paths${say(d)}`)
  assert.equal(fs.readFileSync(path.join(d.evidenceRun, 'engine.log'), 'utf8'),
    fs.readFileSync(path.join(d.home, 'engine.log'), 'utf8'),
    `(f) [M6] the engine.log beside them is a copy of the run's${say(d)}`)
  const engineAt = d.calls.findIndex((c) => c.name === 'systemd-run')
  const staged = d.calls.slice(engineAt + 1)
    .filter((c) => c.name === 'git' && c.sub === 'add' && c.repo === evidenceDir(d))
  assert.ok(staged.length >= 1, `(f) [M6] the boot stages after the engine exits${say(d)}`)
  const names = new Set()
  for (const call of staged) {
    assert.ok(!call.argv.some((a) => a === '-A' || a === '--all'),
      `(f) [M6] nothing is staged wholesale — read: ${JSON.stringify(call.argv)}${say(d)}`)
    for (const arg of call.pos) names.add(path.basename(arg))
  }
  assert.deepEqual([...names].sort(), ['engine.log', 'events.jsonl', 'status.json'],
    `(f) [M6] exactly those three paths are staged${say(d)}`)
})

test('(f) [M6] an engine that failed writes state failed, commits it, and the boot exits its code', () => {
  const d = drive('ENGINE_FAILED')
  const status = finalStatus(d)
  assert.equal(status.state, 'failed', `(f) [M6] state failed${say(d)}`)
  assert.equal(status.error, 'engine exit 2', `(f) [M6] error \`engine exit 2\`${say(d)}`)
  const last = commits(d, evidenceDir(d)).pop()
  assert.equal(last.subject, `${RUN_ID}: failed`, `(f) [M6] the last commit's subject${say(d)}`)
  const argvs = d.calls.map((c) => c.argv.join(' '))
  assert.ok(!argvs.some((a) => a.includes(INTEGRATION_REF)),
    `(f) [M6] nothing pushes ${INTEGRATION_REF}${say(d)}`)
  assert.ok(!argvs.some((a) => a.includes('pulls')), `(f) [M6] no PR is opened${say(d)}`)
  assert.equal(d.exit, 2, `(f) [M6] the boot exits the engine's code${say(d)}`)
})

test('(f) [M6] a target still at base parks with `nothing ahead of base` and opens no PR', () => {
  const d = drive('NOTHING_AHEAD')
  const status = finalStatus(d)
  assert.equal(status.state, 'parked', `(f) [M6] state parked${say(d)}`)
  assert.equal(status.phase, 'nothing ahead of base', `(f) [M6] phase${say(d)}`)
  assert.equal(commits(d, evidenceDir(d)).pop().subject, `${RUN_ID}: parked`,
    `(f) [M6] the last commit's subject${say(d)}`)
  assert.ok(!d.calls.some((c) => c.argv.join(' ').includes('pulls')),
    `(f) [M6] no PR is opened${say(d)}`)
  assert.equal(d.exit, 0, `(f) [M6] the boot exits 0${say(d)}`)
})

test('(f) [M6] the publish path pushes the integration branch and commits `publishing` first', () => {
  const d = drive('MAIN')
  const push = gits(d, 'push').find((c) => c.repo === targetDir(d)
    && c.pos.includes(`HEAD:${INTEGRATION_REF}`))
  assert.ok(push, `(f) [M6] push origin HEAD:${INTEGRATION_REF} from the target${say(d)}`)
  assert.deepEqual(push.pos, ['origin', `HEAD:${INTEGRATION_REF}`],
    `(f) [M6] the push names origin and the integration ref${say(d)}`)
  const publishing = commits(d, evidenceDir(d)).find((c) => c.subject === `${RUN_ID}: publishing`)
  assert.ok(publishing, `(f) [M6] a \`${RUN_ID}: publishing\` commit${say(d)}`)
  assert.equal(statusAt(publishing).state, 'publishing',
    `(f) [M6] whose status.json had state publishing${say(d)}`)
  const post = curlsTo(d, PULLS_URL)[0]
  assert.ok(post, `(f) [M6] a POST to ${PULLS_URL}${say(d)}`)
  assert.ok(d.calls.indexOf(publishing) < d.calls.indexOf(post),
    `(f) [M6] the publishing commit comes before the POST${say(d)}`)
})

test('(f) [M6] one POST to /pulls, JSON, unauthenticated, with the body the clause spells', () => {
  const d = drive('MAIN')
  const posts = curlsTo(d, PULLS_URL)
  assert.equal(posts.length, 1, `(f) [M6] exactly one request to ${PULLS_URL}${say(d)}`)
  const post = posts[0]
  assert.ok(post.argv.includes('content-type: application/json'),
    `(f) [M6] content-type: application/json — read: ${JSON.stringify(post.argv)}${say(d)}`)
  assert.ok(!post.argv.some((a) => /^authorization:/i.test(a)),
    `(f) [M6] no authorization header rides it${say(d)}`)
  const payload = dataOf(post)
  assert.ok(payload, `(f) [M6] the POST carries a body${say(d)}`)
  const body = JSON.parse(payload)
  assert.deepEqual(Object.keys(body).sort(), ['base', 'body', 'draft', 'head', 'title'],
    `(f) [M6] the body's keys${say(d)}`)
  assert.equal(body.title, `fleet ${RUN_ID}: ${PLAN_H1}`, `(f) [M6] the title${say(d)}`)
  assert.equal(body.head, INTEGRATION_BRANCH, `(f) [M6] head${say(d)}`)
  assert.equal(body.base, 'main', `(f) [M6] base, off refs/remotes/origin/HEAD${say(d)}`)
  assert.equal(body.draft, false, `(f) [M6] draft is false for an engine that exited 0${say(d)}`)
  assert.ok(body.body.startsWith(PLAN_SUMMARY),
    `(f) [M6] the body opens with the plan's Summary paragraph verbatim — read: `
    + `${JSON.stringify(body.body.slice(0, 400))}${say(d)}`)
  const lines0 = body.body.split('\n')
  const at = []
  for (const landed of [L1, L2, L3]) {
    const found = lines0.filter((l) => l.trim() === row(landed))
    assert.equal(found.length, 1,
      `(f) [M6] exactly one \`${row(landed)}\` row in the body — read: `
      + `${JSON.stringify(lines0.filter((l) => l.startsWith('| ')))}${say(d)}`)
    at.push(lines0.findIndex((l) => l.trim() === row(landed)))
  }
  assert.ok(at[0] < at[1] && at[1] < at[2],
    `(f) [M6] the rows are in the order events.jsonl has them${say(d)}`)
  const lines = body.body.split('\n').filter((l) => l.trim() !== '')
  assert.deepEqual(lines.slice(-2), ['Closes #4', 'Closes #5'],
    `(f) [M6] one Closes line per number on the plan's Closes line, in order${say(d)}`)
})

test('(f) [M6] a 2xx reply is recorded as a publish:pr event and a done page, and the boot exits 0', () => {
  const d = drive('MAIN')
  const events = fs.readFileSync(path.join(d.evidenceRun, 'events.jsonl'), 'utf8')
    .split('\n').filter((l) => l.trim() !== '')
  assert.equal(events[events.length - 1],
    `{"kind":"publish:pr","url":"${PR_URL}","number":9,"draft":false}`,
    `(f) [M6] the evidence events.jsonl ends with the publish:pr row${say(d)}`)
  const status = finalStatus(d)
  assert.equal(status.state, 'done', `(f) [M6] state done${say(d)}`)
  assert.equal(status.pr, PR_URL, `(f) [M6] pr is the reply's top-level html_url${say(d)}`)
  assert.equal(status.prAuthor, PR_AUTHOR, `(f) [M6] prAuthor is its top-level user.login${say(d)}`)
  assert.equal(commits(d, evidenceDir(d)).pop().subject, `${RUN_ID}: done`,
    `(f) [M6] the last commit's subject${say(d)}`)
  assert.equal(d.exit, 0, `(f) [M6] the boot exits 0${say(d)}`)
})

test('(f) [M6] an engine that adopted but exited 1 opens a draft PR and parks', () => {
  const d = drive('ADOPTED_PARKED')
  const post = curlsTo(d, PULLS_URL)[0]
  assert.ok(post, `(f) [M6] the PR is still opened${say(d)}`)
  assert.equal(JSON.parse(dataOf(post)).draft, true,
    `(f) [M6] draft is true for an engine that did not exit 0${say(d)}`)
  assert.equal(finalStatus(d).state, 'parked', `(f) [M6] the final state is parked${say(d)}`)
})

test('(f) [M6] a non-2xx reply fails the run with the reply`s first 2000 characters', () => {
  const d = drive('PR_REFUSED')
  const status = finalStatus(d)
  assert.equal(status.state, 'failed', `(f) [M6] state failed${say(d)}`)
  assert.equal(status.error, 'x'.repeat(2000),
    `(f) [M6] error is exactly the first 2000 characters of the body — read ${
      typeof status.error === 'string' ? `${status.error.length} characters` : status.error}${say(d)}`)
  assert.equal(d.exit, 1, `(f) [M6] the boot exits 1${say(d)}`)
})

// (g) [M7] the page.

test('(g) [M7] every status.json the boot writes carries exactly the thirteen keys', () => {
  for (const label of ['MAIN', 'PARKED_TASK', 'ENGINE_FAILED']) {
    const d = drive(label)
    const written = commits(d, evidenceDir(d)).map(statusAt).concat([finalStatus(d)])
    assert.ok(written.length >= 2, `(g) [M7] ${label} writes the page more than once${say(d)}`)
    for (const status of written) {
      assert.deepEqual(Object.keys(status).sort(), [...STATUS_KEYS].sort(),
        `(g) [M7] the top-level keys of ${label}'s page${say(d)}`)
      assert.equal(status.run, RUN_N, `(g) [M7] run is the string "${RUN_N}"${say(d)}`)
      assert.equal(status.branch, INTEGRATION_BRANCH, `(g) [M7] branch${say(d)}`)
      assert.equal(status.merged, null, `(g) [M7] merged is null${say(d)}`)
      assert.equal(status.disclosures, null, `(g) [M7] disclosures is null${say(d)}`)
    }
  }
})

test('(g) [M7] vm is the name Reflection gave, and null when it gave nothing', () => {
  const named = drive('MAIN')
  assert.equal(finalStatus(named).vm, VM_NAME,
    `(g) [M7] vm is the name field of GET $REFLECTION_URL/${say(named)}`)
  const silent = drive('NO_REFLECTION')
  assert.equal(finalStatus(silent).vm, null,
    `(g) [M7] vm is null when Reflection answers nothing${say(silent)}`)
})

test('(g) [M7] startedAt is the first write`s, in ISO 8601 UTC, and updatedAt never goes back', () => {
  const d = drive('MAIN')
  const written = commits(d, evidenceDir(d)).map(statusAt).concat([finalStatus(d)])
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
  assert.match(written[0].startedAt, ISO, `(g) [M7] startedAt is ISO 8601 UTC${say(d)}`)
  for (const status of written) {
    assert.equal(status.startedAt, written[0].startedAt,
      `(g) [M7] startedAt is identical across every write${say(d)}`)
    assert.match(status.updatedAt, ISO, `(g) [M7] updatedAt is ISO 8601 UTC${say(d)}`)
  }
  for (let i = 1; i < written.length; i += 1) {
    assert.ok(written[i].updatedAt >= written[i - 1].updatedAt,
      `(g) [M7] updatedAt is non-decreasing${say(d)}`)
  }
})

test('(g) [M7] tasks has one key per landing and parked row, with the cell each earns', () => {
  const d = drive('PARKED_TASK')
  const status = finalStatus(d)
  assert.deepEqual(Object.keys(status.tasks).sort(), ['1', '2', '3'],
    `(g) [M7] one key per distinct task of the landing and parked rows${say(d)}`)
  assert.deepEqual(status.tasks['1'], FOLDED, `(g) [M7] a landing's cell${say(d)}`)
  assert.deepEqual(status.tasks['3'], FOLDED, `(g) [M7] the other landing's cell${say(d)}`)
  assert.deepEqual(status.tasks['2'], { ...FOLDED, state: 'failed', park: 'no ready set' },
    `(g) [M7] a park's cell carries state failed and the row's reason${say(d)}`)
})

// (h) [M8] the two tags and the one delete they gate.

test('(h) [M8] a done run pushes both tags, lists them, and deletes the two branches', () => {
  const d = drive('MAIN')
  const calls = d.calls
  const doneAt = calls.indexOf(commits(d, evidenceDir(d)).pop())
  const after = calls.slice(doneAt)
  const planTag = after.find((c) => c.name === 'git' && c.sub === 'push'
    && c.repo === targetDir(d) && c.pos.includes(`${PLAN_SHA}:${PLAN_TAG}`))
  assert.ok(planTag, `(h) [M8] push origin ${PLAN_SHA}:${PLAN_TAG} from the target${say(d)}`)
  const evidenceTag = after.find((c) => c.name === 'git' && c.sub === 'push'
    && c.repo === evidenceDir(d) && c.pos.includes(`HEAD:${EVIDENCE_TAG}`))
  assert.ok(evidenceTag, `(h) [M8] push origin HEAD:${EVIDENCE_TAG} from the evidence worktree${say(d)}`)
  const listing = after.find((c) => c.name === 'git' && c.sub === 'ls-remote')
  assert.ok(listing, `(h) [M8] one ls-remote of the two tags${say(d)}`)
  assert.ok(listing.argv.includes('--tags'), `(h) [M8] it is --tags${say(d)}`)
  assert.deepEqual(listing.pos, ['origin', PLAN_TAG, EVIDENCE_TAG],
    `(h) [M8] it names origin and both tag refs${say(d)}`)
  assert.equal(listing.repo, targetDir(d), `(h) [M8] read from the target clone${say(d)}`)
  assert.ok(after.indexOf(listing) > after.indexOf(evidenceTag),
    `(h) [M8] the listing comes after both tag pushes${say(d)}`)
  const del = after.find((c) => c.name === 'git' && c.sub === 'push' && c.argv.includes('--delete'))
  assert.ok(del, `(h) [M8] one branch delete${say(d)}`)
  assert.deepEqual(del.pos, ['origin', `refs/heads/ultra/plan-run-${RUN_N}`, EVIDENCE_REF],
    `(h) [M8] it deletes exactly the plan and evidence branches${say(d)}`)
  assert.ok(after.indexOf(del) > after.indexOf(listing),
    `(h) [M8] and only after the listing${say(d)}`)
})

for (const [label, what] of [
  ['TAG_PLAN_WRONG', 'the plan tag at another sha'],
  ['TAG_EVIDENCE_WRONG', 'the evidence tag at another sha'],
  ['TAG_ONE_ONLY', 'only the plan tag listed'],
]) {
  test(`(h) [M8] ${what} issues no delete and logs a \`record:\` line`, () => {
    const d = drive(label)
    assert.ok(!d.calls.some((c) => c.argv.includes('--delete')),
      `(h) [M8] no argv carries --delete${say(d)}`)
    assert.ok(d.out.split('\n').some((l) => l.includes('record:')),
      `(h) [M8] the log carries a line beginning \`record:\`${say(d)}`)
  })
}

test('(h) [M8] a parked run pushes both tags too', () => {
  const d = drive('NOTHING_AHEAD')
  const planTag = gits(d, 'push').find((c) => c.pos.includes(`${PLAN_SHA}:${PLAN_TAG}`))
  assert.ok(planTag, `(h) [M8] the plan tag is pushed on a parked run${say(d)}`)
  const evidenceTag = gits(d, 'push').find((c) => c.pos.includes(`HEAD:${EVIDENCE_TAG}`))
  assert.ok(evidenceTag, `(h) [M8] the evidence tag is pushed on a parked run${say(d)}`)
})

test('(h) [M8] a failed run pushes no tag', () => {
  const d = drive('ENGINE_FAILED')
  const tagged = d.calls.filter((c) => c.argv.some((a) => a.includes('refs/tags/')))
  assert.deepEqual(tagged.map((c) => c.argv.join(' ')), [],
    `(h) [M8] no argv names refs/tags/ on a failed run${say(d)}`)
})

// (i) [M9] the file itself.

test('(i) [M9] factory/boot.sh is 300 lines or fewer', () => {
  assert.ok(fs.existsSync(SCRIPT), `(i) [M9] ${SCRIPT} exists`)
  const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  assert.ok(lines.length <= 300, `(i) [M9] it has ${lines.length} lines, not 300 or fewer`)
})

test('(i) [M9] no line of factory/boot.sh names /usr/bin/ or /usr/local/bin/', () => {
  assert.ok(fs.existsSync(SCRIPT), `(i) [M9] ${SCRIPT} exists`)
  const named = fs.readFileSync(SCRIPT, 'utf8').split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => line.includes('/usr/bin/') || line.includes('/usr/local/bin/'))
  assert.deepEqual(named, [],
    '(i) [M9] every curl, git, npm, claude and systemd-run is resolved through PATH')
})

// ── the runner ───────────────────────────────────────────────────────────────

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
fs.rmSync(TMP_ROOT, { recursive: true, force: true })
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
console.log('ALL TESTS PASSED')
