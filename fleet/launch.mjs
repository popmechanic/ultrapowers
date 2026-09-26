#!/usr/bin/env node
/**
 * fleet/launch.mjs — start one run. The whole client, on the laptop.
 *
 * A run is a number N. There is no image to keep warm and no side repository to
 * keep in sync: the run is created with one plain `new` on exe.dev's default
 * image, and our delta is installed on that box by a first-boot setup script
 * handed to `new` on stdin. The launcher, in this order:
 *
 *   1. validates its own arguments — nothing has been executed yet;
 *   2. reads: that the `--repo` checkout is not shallow, its `origin` (it must
 *      name `--target`), that `--base` is a commit the checkout has and that it
 *      is on the target's default branch, `integrations list --json` (the
 *      target's one GitHub object must exist), `billing plan --json` (one run
 *      must fit the plan's pool), the target's `ultra/*` refs (the run number
 *      is one past the highest N they carry) and the engine tip, and asks
 *      `help <verb>` for every verb of `fleet/exe-verbs.json` — a drift there
 *      is a line on the launch, never a refusal. Its check and its parse run
 *      `plan_check.py` and `plan_parse.py` FETCHED AT `engine=` (`git show`
 *      from this checkout, else `gh api`, into a temp directory), so the
 *      laptop reads the plan with the sandbox's own parser; files it cannot
 *      fetch are a refusal before any push;
 *   3. refreshes the Claude credential the run signs in with, the entry
 *      `--account` names — a refresh failure is a failure before any VM
 *      exists;
 *   4. commits the plan against a temporary index and pushes it to the target
 *      as `ultra/plan-run-N` — a refused push re-reads the highest run and, if
 *      one appeared, takes N+1 and pushes again, three pushes in all, so the
 *      push and not the read is what reserves N; that commit's sha is `plan=`
 *      in the assignment;
 *   5. issues exactly one mutating lobby verb:
 *
 *        new --name <vm> --tag fleet --comment '<assignment>'
 *            --cpu <cpu> --memory <memory> --setup-script /dev/stdin --json
 *
 *      with the rendered setup script on that call's stdin, carrying a
 *      `# fleet: width=<W>` header the launcher stamps on it. `--tag fleet` is
 *      what grants the run's integrations (each carries the policy
 *      `tag:fleet`); the verb carries no `--integration`.
 *
 * `<cpu>` and `<memory>` are the PLAN's, sized by `vmSizeFor` from W, the task
 * count of the parse's widest wave, under the ceiling `~/.ultrapowers/fleet.json`
 * names. A refusal (exit 2) happens before anything is created; a failure after
 * that (exit 1) prints the lobby's own words. Each phase's section comment
 * below says the rest.
 */

import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  COMMENT_MAX_BYTES,
  ENGINE_REPO,
  ENGINE_URL,
  EXE_HOST,
  FLEET_DEFAULTS,
  FLEET_TAG,
  LobbyError,
  Refusal,
  buildComment,
  defaultExec,
  evidenceBranchFor,
  git,
  githubIntegrationFor,
  highestRunOnTarget,
  integrationBranchFor,
  isFullSha,
  isRunNumber,
  isSafeSha,
  isSafeTarget,
  isVmName,
  KATA_HUB_FIX,
  defaultKataEnvPath,
  kataHostOf,
  kataProjectFor,
  listIntegrations,
  loadFleetConfig,
  lobby,
  output,
  parseArgs,
  parseKataEnv,
  parseMemoryGb,
  planBranchFor,
  readPlanCapacity,
  runCli,
  vmNameFor
} from './lobby.mjs'
import { fleetConfigAccount, verbDrift } from './doctor.mjs'
import { makeKataClient, sshTransport } from './kata-client.mjs'
import { janitor } from './janitor.mjs'
import { readFleetFiles, renderSetupScript } from './setup-script.mjs'
import { verifyPlanPins } from './plan-pins.mjs'

/** One string, so a docs check that reads the first `usage` literal sees every
 *  flag the launch line may carry. */
export const USAGE = `usage: node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <40-hex>
                             [--repo <dir>] [--engine <40-hex>] [--hold] [--again]
                             [--cpu <n>] [--memory <n>GB]
                             [--run <N>] [--config <path>] [--account <name>] [--json]`

export const usage = () => USAGE

/**
 * The keychain entry a run signs in with when neither `--account` nor the
 * config names one — the entry every laptop that walked the first run has.
 * `ACCOUNT_NAME` is `fleet/claude-token.mjs`'s own rule, copied rather than
 * imported: the launcher refuses a name the credential tool would refuse, and
 * it refuses it before anything is executed.
 */
const DEFAULT_ACCOUNT = 'ultrapowers'
const ACCOUNT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** The flag `new` may never carry: exe.dev refuses it, and the policy
 *  `tag:fleet` on each integration is what grants a fleet VM its credentials. */
const NEW_INTEGRATION_FLAG = /(^|\s)--integration(=|\s|$)/

/** The lobby-verb record the preflight compares the live lobby against. */
const VERBS_PATH = new URL('./exe-verbs.json', import.meta.url).pathname

/** Where the plan lands in the commit the launcher pushes. */
const PLAN_PATH = '.ultrapowers/plan.md'
const VERDICTS_PATH = '.ultrapowers/gate-verdicts.json'
/** The third path of the plan commit: the run's kata record — the project, the
 *  run issue and one issue per task on the hub, each with the revision it had
 *  when the launcher last read it (#913). Written only when a hub is reached. */
const KATA_PATH = '.ultrapowers/kata.json'
/** The url the SANDBOX reaches the hub at — the `kata` http-proxy attached by
 *  `tag:fleet` — written into the record regardless of the laptop's own route,
 *  because the record's reader is the engine on the sandbox and never the
 *  laptop. */
export const KATA_SANDBOX_URL = 'https://kata.int.exe.xyz'
/** The one command that builds the hub, and where `fleet/kata-hub.mjs` leaves
 *  the hub's address and bearer — both `fleet/lobby.mjs`'s, since the janitor
 *  reads the same file. */

/**
 * `~/.ultrapowers/kata-hub.env`, read: `{ url, token }` from its `KATA_URL=`
 * and `KATA_TOKEN=` lines. An absent file, or one missing either line, is a
 * refusal naming the path and the command that writes it — before any command
 * has run, so a laptop with no hub has touched neither exe.dev nor the target.
 *
 * The token is the laptop's RECORD of the bearer the hub was given; the
 * launcher never sends it. Every laptop request rides `ssh <hub> curl …` and
 * sources the bearer from the hub's own `/etc/kata/kata.env` there.
 */
async function readKataEnv (envPath) {
  let text
  try {
    text = await fsp.readFile(envPath, 'utf8')
  } catch (error) {
    throw new Refusal(`launch: no kata hub env at ${envPath} (${error?.code ?? error?.message ?? error}) — build the hub once: ${KATA_HUB_FIX}`)
  }
  const env = parseKataEnv(text)
  for (const [key, value] of [['KATA_URL', env.url], ['KATA_TOKEN', env.token]]) {
    if (!value) {
      throw new Refusal(`launch: ${envPath} has no ${key}= line — build the hub once: ${KATA_HUB_FIX}`)
    }
  }
  return env
}

/** The plan's H1: the text after `# ` on the first such line, `''` when none. */
export const planTitleOf = (planText) => /^# (.*)$/m.exec(planText)?.[1]?.trim() ?? ''
/** The plan's `**Claim:**` line, whole — the run issue's body. `''` when none. */
export const planClaimOf = (planText) =>
  planText.split('\n').find((line) => line.startsWith('**Claim:**'))?.trim() ?? ''
/**
 * The numbers of the plan's one `**Closes:**` line — the first such line
 * before the first `### ` heading, which is the line the sandbox's
 * `plan_closes` reads — as integers, `[]` when the plan has none.
 */
export const planClosesOf = (planText) => {
  for (const line of planText.split('\n')) {
    if (line.startsWith('### ')) break
    if (!line.startsWith('**Closes:**')) continue
    return [...line.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
  }
  return []
}

/**
 * What a base off the default branch is told to do. The parked branch is not
 * lost and nothing here takes a patch: decision 5 of #715 asks the operator to
 * re-drive that work as a plan on `main`, which is procedure and not a flag.
 */
const BASE_OFF_MAIN_FIX =
  'relaunch from main; a parked branch is re-driven as a plan on main, not as a base'

/** What a shallow launch checkout is told to do — by hand, never by the
 *  launcher: unshallowing an operator's clone is not a launch's business. */
const SHALLOW_FIX = 'is a shallow clone — unshallow it by hand and relaunch'

/**
 * How many `new` lines a launch may issue, and the window it sleeps in between
 * them. A name exe.dev refused stays reserved, so each attempt mints its own.
 */
const NEW_ATTEMPTS = 3
const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 3_000

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A positive decimal integer — what `--cpu` and the config's `cpu` must be. */
const isPositiveInt = (value) => isRunNumber(value)

/**
 * What `--memory` and the config's `memory` must be: `<int>GB`, the spelling
 * the lobby's `--memory` takes verbatim. `parseMemoryGb` also reads `16 G`,
 * which would put a space inside the `new` line, so the shape is pinned here
 * before the number is taken off it.
 */
const isMemorySize = (value) => /^[1-9][0-9]*GB$/.test(String(value))

/**
 * The box one plan needs, clamped by the fleet's ceiling. Pure: `widestWave` is
 * W, the task count of the compiled plan's widest wave, `cap` is the
 * `cpu`/`memory` pair the laptop's `fleet.json` names (or `FLEET_DEFAULTS`).
 *
 *   cpu    = min(cap.cpu,    2 + ceil(W / 3))
 *   memory = min(cap.memory, 2 + W) GB
 *
 * The two constants of the width formula are the run's own floor: an engine, a
 * fold and a publish live on the box whatever the plan is, and every
 * implementer beyond the first costs about a gigabyte and a third of a core
 * (RUNBOOK §Capacity). So a one-task plan gets `--cpu 3 --memory 3GB` and a
 * ten-task plan `--cpu 6 --memory 8GB` under the caps 6 and 8GB — the ceiling
 * is what a run may ask for, never the size every run gets.
 *
 * `memory` comes back spelled `<int>GB`, the spelling the lobby's `--memory`
 * takes verbatim; `cpu` is a decimal string for the same reason.
 */
function vmSizeFor (widestWave, cap = FLEET_DEFAULTS) {
  const w = Math.max(0, Math.floor(Number(widestWave) || 0))
  const capCpu = Number(cap?.cpu ?? FLEET_DEFAULTS.cpu)
  const capGb = cap?.memoryGb ?? parseMemoryGb(cap?.memory ?? FLEET_DEFAULTS.memory)
  const wantGb = 2 + w
  return {
    cpu: String(Math.min(capCpu, 2 + Math.ceil(w / 3))),
    memory: `${Math.min(Number(capGb), wantGb)}GB`
  }
}

/**
 * The box one compiled payload asks for, and the two numbers it was read from.
 * Pure: `compiled` is what `compilePlanForRun` returns, `cpuCap`/`memoryCap`
 * are the fleet's ceiling, and `cpu`/`memory` are the launch line's overrides —
 * a named number wins outright whatever the plan is, and what it wins is the
 * cap value, which is where the launch line's own number already sits.
 *
 * W is floored at one: a payload with no waves launches nothing, and a box
 * below the one-task size would be a smaller answer than the smallest real
 * plan's.
 */
function sizeFromCompile (compiled, { cpuCap, memoryCap, cpu, memory } = {}) {
  const waves = Array.isArray(compiled?.waves) ? compiled.waves : []
  const w = Math.max(1, waves.reduce(
    (widest, wave) => Math.max(widest, Array.isArray(wave) ? wave.length : 0), 0
  ))
  const sized = vmSizeFor(w, { cpu: cpuCap, memory: memoryCap })
  return {
    width: w,
    cpu: cpu === undefined ? sized.cpu : cpuCap,
    memory: memory === undefined ? sized.memory : memoryCap
  }
}

/**
 * The launcher's own header on the setup script the `new` verb carries on
 * stdin: W, the widest wave of the plan this box was cut for, and the size it
 * was cut to. Pure — the script comes back with one comment line inserted
 * under its shebang, nothing else moved.
 *
 * Why the script and not the assignment: the comment's keys are enumerated
 * twice, by `COMMENT_KEYS` in `fleet/lobby.mjs` and by `parse_assignment` in
 * `factory/boot.sh`, which fails the boot outright on a key it does not
 * know — so a seventh key has to land in both files in the same change or every
 * launch after it refuses to boot. Until one does, `width=` rides the other
 * half of the same verb, where it costs nothing: a comment in a first-boot
 * script, on the box, for whoever asks why this VM has these cores. The engine
 * does not read it.
 */
function stampWidth (script, { width, cpu, memory }) {
  const note = `# fleet: width=${width} — the parsed plan's widest wave, which this box was cut to: --cpu ${cpu} --memory ${memory}.`
  const text = String(script ?? '')
  const firstLine = text.indexOf('\n')
  return firstLine < 0
    ? `${text}\n${note}\n`
    : `${text.slice(0, firstLine + 1)}${note}\n${text.slice(firstLine + 1)}`
}

/**
 * The shell's own words — keywords and builtins — that stand at command
 * position without naming a program the sandbox must have. `probeWordsOf`
 * skips them; a `Run:` line's `test`, `echo` and `for` are bash's, not the
 * box's.
 */
export const SHELL_WORDS = Object.freeze([
  'for', 'in', 'do', 'done', 'if', 'then', 'else', 'elif', 'fi', 'while', 'until',
  'case', 'esac', 'test', '[', '[[', 'export', 'set', 'cd', 'exit', 'return', 'read',
  'shift', 'local', 'eval', 'exec', 'source', '.', ':', 'command', 'type', 'wait',
  'trap', 'unset', 'let', 'declare', 'true', 'false', 'echo', 'printf'
])

/**
 * What a fresh sandbox can run, by name (#645). Two groups: what the exeuntu
 * image ships — `claude`, `gh`, `git`, `jq`, `python3`, `curl`, bash and the
 * coreutils — and the delta `fleet/setup-script.mjs` installs, exactly node
 * (with npm and npx), bun (with bunx), celld and pytest. A `Run:` probe or a
 * `Check:` line runs on that box under `timeout <s> bash -lc <line>`, so a
 * command word missing here exits 127 in its first second, after the plan was
 * pushed and a VM created; `toolchainViolations` refuses it on the laptop
 * instead, by name — never by language (the operator's shape, 2026-09-05).
 * A word this list lacks is a refusal until someone adds it here beside the
 * setup-script rung that installs it.
 */
export const SANDBOX_TOOLCHAIN = Object.freeze([
  // the setup script's delta
  'node', 'npm', 'npx', 'bun', 'bunx', 'celld', 'python3', 'pytest',
  // the image
  'claude', 'gh', 'git', 'jq', 'curl', 'bash', 'sh', 'env', 'sudo', 'install',
  'apt-get', 'timeout', 'xargs', 'find', 'grep', 'egrep', 'fgrep', 'sed', 'awk', 'tr',
  'cut', 'sort', 'uniq', 'head', 'tail', 'wc', 'cat', 'tee', 'diff', 'cmp', 'comm',
  'paste', 'seq', 'expr', 'date', 'sleep', 'basename', 'dirname', 'readlink',
  'realpath', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'ln', 'ls', 'touch', 'chmod',
  'chown', 'stat', 'tar', 'gzip', 'gunzip', 'unzip', 'zip', 'md5sum', 'sha256sum',
  'base64', 'od', 'xxd', 'hexdump', 'tac', 'rev', 'nl', 'fold', 'column', 'yes',
  'which', 'pwd', 'whoami', 'id', 'hostname', 'uname', 'ps', 'kill', 'pkill',
  'nohup', 'mktemp', 'truncate', 'split', 'join', 'shuf', 'tsort', 'du', 'df',
  'nproc', 'free', 'ss', 'nc', 'ssh'
])

/**
 * The command words of one shell line: the first word of the line and of
 * every segment after `|`, `||`, `&&`, `;`, `$(` or `(`, and the word after
 * each of `do`, `then`, `else`, `elif` — skipping `!`, a `NAME=value`
 * assignment and every `SHELL_WORDS` entry, and dropping a word that carries
 * a `/` (a path in the target, not a program by name) or opens with `$`, a
 * quote, `-` or a digit (an expansion, a string, a flag, a redirection).
 * Quote-aware: an operator inside a single- or double-quoted span splits
 * nothing (`grep -E "a|b"` names one program), and a `$(` inside double
 * quotes still opens a segment, because bash runs what is inside it.
 * Duplicates are kept; the caller deduplicates per task.
 */
export function probeWordsOf (line) {
  const text = String(line ?? '')
  // Segments: split on the operators outside quotes, and on `$(` outside
  // single quotes; each segment is a list of whitespace-split tokens with
  // quoted spans kept whole.
  const segments = [[]]
  let token = ''
  let quote = null
  // The quote state to restore when a `$(` … `)` substitution closes.
  const substitutions = []
  const endToken = () => { if (token !== '') { segments[segments.length - 1].push(token); token = '' } }
  const newSegment = () => { endToken(); segments.push([]) }
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (quote === "'") {
      token += ch
      if (ch === "'") quote = null
      continue
    }
    if (quote === '"') {
      if (ch === '\\' && next !== undefined) { token += ch + next; i += 1; continue }
      if (ch === '$' && next === '(') { substitutions.push('"'); quote = null; newSegment(); i += 1; continue }
      token += ch
      if (ch === '"') quote = null
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; token += ch; continue }
    if (ch === '\\' && next !== undefined) { token += ch + next; i += 1; continue }
    if ((ch === '|' && next === '|') || (ch === '&' && next === '&')) { newSegment(); i += 1; continue }
    if (ch === '|' || ch === ';' || ch === '(') { newSegment(); continue }
    if (ch === '$' && next === '(') { substitutions.push(null); newSegment(); i += 1; continue }
    if (ch === ')') { endToken(); quote = substitutions.length ? substitutions.pop() : null; segments.push([]); continue }
    if (/\s/.test(ch)) { endToken(); continue }
    token += ch
  }
  endToken()
  const words = []
  for (const tokens of segments) {
    let atCommand = true
    for (const raw of tokens) {
      const t = raw.replace(/[}\]]+$/, '')
      if (!atCommand) {
        if (['do', 'then', 'else', 'elif'].includes(t)) atCommand = true
        continue
      }
      if (t === '' || t === '!' || t === '{' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue
      if (SHELL_WORDS.includes(t)) {
        atCommand = ['do', 'then', 'else', 'elif', 'command', 'exec', 'eval'].includes(t)
        continue
      }
      atCommand = false
      if (t.includes('/') || /^[$"'\-0-9<>]/.test(t)) continue
      words.push(t)
    }
  }
  return words
}

/**
 * Every command word of every task's `proofRuns` across `compiled.waves`, and
 * of every `compiled.payload.checks[].cmd` (task `check`), that
 * `SANDBOX_TOOLCHAIN` lacks — one `{ task, word, cmd }` per (task, word), in
 * document order. Pure; empty means every probe and check can run on the box.
 */
export function toolchainViolations (compiled) {
  const out = []
  const seen = new Set()
  const note = (task, cmd) => {
    for (const word of probeWordsOf(cmd)) {
      if (SANDBOX_TOOLCHAIN.includes(word)) continue
      const key = `${task}\u0000${word}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ task: String(task), word, cmd: String(cmd) })
    }
  }
  const waves = Array.isArray(compiled?.waves) ? compiled.waves : []
  for (const wave of waves) {
    if (!Array.isArray(wave)) continue
    for (const task of wave) {
      const runs = Array.isArray(task?.proofRuns) ? task.proofRuns : []
      for (const cmd of runs) note(task?.id ?? '?', cmd)
    }
  }
  const checks = Array.isArray(compiled?.payload?.checks) ? compiled.payload.checks : []
  for (const check of checks) if (check && typeof check.cmd === 'string') note('check', check.cmd)
  return out
}

/**
 * The four spellings a checkout's `origin` may carry for one GitHub target.
 * Anything else answers null, and the refusal names what it saw rather than
 * guessing a repository out of it.
 */
const ORIGIN_SPELLINGS = Object.freeze([
  /^https:\/\/github\.com\/(.+?)(?:\.git)?\/?$/,
  /^git@github\.com:(.+?)(?:\.git)?\/?$/,
  /^ssh:\/\/git@github\.com\/(.+?)(?:\.git)?\/?$/
])

function targetOfOriginUrl (url) {
  const text = String(url ?? '').trim()
  for (const pattern of ORIGIN_SPELLINGS) {
    const match = pattern.exec(text)
    if (match && isSafeTarget(match[1])) return match[1]
  }
  return null
}

/**
 * The check's and the parser's paths inside the engine tree, at every sha —
 * never resolved against this checkout. The copies a launch runs are the ones
 * it fetches at `engine=`; see `fetchCompilerAt`. `plan_parse.py` is the file
 * the sandbox runs, and `plan_check.py` imports it from its own directory, so
 * the two are fetched together and land side by side.
 */
const CHECKER_REL = 'skills/ultrapowers/scripts/plan_check.py'
const PARSER_REL = 'skills/ultrapowers/scripts/plan_parse.py'
/**
 * The checkout this file sits in. On the laptop that is the plugin cache
 * (`~/.claude/plugins/cache/ultrapowers/ultrapowers/<version>/`), whose `.git`
 * may or may not hold the engine sha — a cache without it is exactly the
 * `gh api` case below.
 */
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * What the launch's check and parse run: `plan_check.py` and `plan_parse.py`
 * AT THE ENGINE SHA, in a directory of their own.
 *
 * The trap this closes (run-26, 2026-09-17): the launcher used to run the
 * compiler of the plugin build it was invoked from, while the sandbox's
 * preflight runs the engine checkout cloned at `engine=`. A plan that compiled
 * `PLAN OK` on the laptop was refused an hour later by a compile rule that had
 * landed on main after the installed build — the two compilers were different
 * files. Fetching the engine's own copy makes the laptop's verdict the
 * sandbox's verdict by construction.
 *
 * Two reads, in order, both through the exec seam:
 *
 *   1. `git -C <pluginRoot> show <engine>:<path>` — free, offline, and right
 *      whenever the checkout has the sha;
 *   2. `gh api -H 'Accept: application/vnd.github.raw' repos/<ENGINE_REPO>/
 *      contents/<path>?ref=<engine>` — the raw media type makes stdout the
 *      file body.
 *
 * A read that exits non-zero OR prints an empty stdout has not answered a
 * file, so the second is tried; when neither answers, this is a `Refusal`
 * naming the sha — never a fall back to the copy beside this file, because
 * that copy is the bug.
 *
 * Two files are enough: both import only the standard library and each other.
 * Copies under `os.tmpdir()`, at their real depth, read the plan, its gate
 * record and the `--base` tree exactly as the cache copies do.
 *
 * Answers `{ dir, scriptPath, parserPath, source }`: `dir` is what the caller
 * removes, `scriptPath` is `plan_check.py`, `parserPath` is `plan_parse.py`,
 * `source` is `git-show` or `gh-api` (the check's).
 */
export async function fetchCompilerAt ({ exec, engine, pluginRoot }) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fleet-compiler-'))
  const fetchOne = async (rel) => {
    const tried = []
    for (const attempt of [
      { source: 'git-show', read: () => git(exec, pluginRoot, ['show', `${engine}:${rel}`]) },
      {
        source: 'gh-api',
        read: () => exec('gh', [
          'api', '-H', 'Accept: application/vnd.github.raw',
          `repos/${ENGINE_REPO}/contents/${rel}?ref=${engine}`
        ])
      }
    ]) {
      const res = await attempt.read()
      const body = String(res.stdout ?? '')
      if (res.code === 0 && body !== '') {
        const filePath = path.join(dir, rel)
        await fsp.mkdir(path.dirname(filePath), { recursive: true })
        await fsp.writeFile(filePath, body)
        return { filePath, source: attempt.source }
      }
      tried.push(`  ${attempt.source}: exit ${res.code}${output(res) === '' ? ' (no output)' : `\n${output(res)}`}`)
    }
    throw new Refusal(
      `launch: could not fetch ${rel} at engine ${engine} — the launch reads the plan with the ` +
      'parser the sandbox will use or it does not launch:\n' + tried.join('\n')
    )
  }
  try {
    const parser = await fetchOne(PARSER_REL)
    const checker = await fetchOne(CHECKER_REL)
    return { dir, scriptPath: checker.filePath, parserPath: parser.filePath, source: checker.source }
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true })
    throw error
  }
}

/**
 * Neither compile has a compiler of its own to fall back on: a caller that
 * names none is refused before any subprocess, rather than quietly compiling
 * with whatever copy happens to sit beside this file.
 */
const requireCompilerPath = (compilerPath, which) => {
  if (typeof compilerPath === 'string' && compilerPath !== '') return
  throw new Refusal(
    `launch: ${which} was asked for without a compilerPath — the copy fetched at ` +
    'engine= is the only one a launch runs (fetchCompilerAt)'
  )
}

/** The pinning script, as the re-pin command names it. */
const PIN_SCRIPT_REL = 'skills/ultrawrite/scripts/pin_base_facts.py'
/** The stamp a generated `**BASE facts:**` block carries: the sha it was read at. */
const BASE_FACTS_STAMP = /\*\*BASE facts:\*\*\s*\(generated at ([0-9a-f]{7,40})\)/g

/**
 * The plan compiles against the tree at `--base`, or it is a refusal — before
 * any lobby verb, any push, any `ls-remote`. Two reads, in order:
 *
 *  1. A `**BASE facts:**` block stamped `(generated at <sha>)` was generated
 *     from some tree; when that sha is not a prefix of `--base`, the block is a
 *     fact about another commit and every worker would read stale Context
 *     (#865). The refusal carries the exact re-pin command.
 *  2. `plan_check.py --base <base> <plan>` — the gate record, the authoring
 *     record and, since #896, the tree's own facts about the plan (what a
 *     deleted file holds; which files outside a task's Files carry a literal
 *     its clauses pin). A non-zero exit is a refusal carrying the compiler's
 *     text verbatim — including a `STALE fact:` line for a Stale-if predicate
 *     that holds at BASE, which is what the operator reads on the laptop; the
 *     `BASE fact:`, `STALE fact:`, `GREEN-AT-BASE fact:`, `RED-AT-BASE fact:`
 *     and `AUTHORING fact:` lines of a clean check ride the result so the launch line prints them,
 *     in the order the compiler printed them (a `STALE fact:` there is the
 *     advisory kind: a predicate the compiler could not read at BASE, never a
 *     refusal; a `GREEN-AT-BASE fact:` line is a Proof `Run:` line the compiler
 *     found already green at BASE, plus the one line totalling what those runs
 *     cost — this release every one of them is a fact and the compile still
 *     exits 0, so dropping them on the laptop is the only way the operator
 *     could fail to read them; the `AUTHORING fact:` line is what the plan's
 *     authoring cost, or `AUTHORING fact: none recorded` when the gate record
 *     carries none).
 *
 * The compiler runs through the exec seam like every other subprocess, so a sim
 * that answers `python3` decides what the compiler said. `compilerPath` is the
 * file `fetchCompilerAt` wrote and is required: there is no default, because a
 * default is how a launch ends up compiling with a compiler the sandbox does
 * not have.
 */
export async function verifyPlanCompiles ({ exec, repoDir, base, planPath, planText, compilerPath }) {
  requireCompilerPath(compilerPath, 'plan_check.py')
  const stamps = [...String(planText).matchAll(BASE_FACTS_STAMP)].map((m) => m[1])
  const stale = [...new Set(stamps.filter((sha) => !base.startsWith(sha)))]
  if (stale.length > 0) {
    throw new Refusal(
      `launch: the plan's **BASE facts:** blocks were generated at ${stale.join(', ')}, not at --base ${base} — ` +
      `re-pin them first: python3 ${PIN_SCRIPT_REL} --write --base ${base} ${planPath}`
    )
  }
  const res = await exec('python3', [compilerPath, '--base', base, '--repo', repoDir, planPath], { cwd: repoDir })
  if (res.code !== 0) {
    throw new Refusal(
      `launch: plan_check.py --base ${base} refused ${planPath} (exit ${res.code}):\n${output(res)}`
    )
  }
  return String(res.stdout ?? '').split('\n').filter(
    (line) =>
      line.startsWith('BASE fact:') ||
      line.startsWith('STALE fact:') ||
      line.startsWith('GREEN-AT-BASE fact:') ||
      line.startsWith('RED-AT-BASE fact:') ||
      line.startsWith('AUTHORING fact:')
  )
}

/**
 * The launch's parse: `plan_parse.py <plan>` — the sandbox's own parser, so
 * what the laptop sizes the box from is what the engine will read. Run once
 * per run number the launch attempts and read by everything that needs to know
 * what the plan IS: how wide its widest wave is (which is what the VM is sized
 * to and what the engine's dispatch bound becomes), and the tasks and edges the
 * hub is filed with. `stamp` names the run the parse was made for and nothing
 * in the parse itself: the output is the same under every number.
 *
 * Answers `{ stamp, payload, waves, edges }`. `compilerPath` is
 * `fetchCompilerAt`'s `parserPath` and is required, for the reason
 * `verifyPlanCompiles` gives.
 */
export async function compilePlanForRun ({ exec, repoDir, planPath, stamp, compilerPath }) {
  requireCompilerPath(compilerPath, `plan_parse.py for ${stamp}`)
  const res = await exec('python3', [compilerPath, planPath], { cwd: repoDir })
  if (res.code !== 0) {
    throw new Refusal(`launch: plan_parse.py for ${stamp} failed (exit ${res.code}):\n${output(res)}`)
  }
  let payload
  try {
    payload = JSON.parse(String(res.stdout ?? ''))
  } catch (error) {
    throw new Refusal(`launch: plan_parse.py for ${stamp} printed no JSON: ${error?.message ?? error}`)
  }
  return {
    stamp,
    payload,
    waves: Array.isArray(payload?.launch_waves) ? payload.launch_waves : [],
    edges: Array.isArray(payload?.dag_edges) ? payload.dag_edges : []
  }
}

/**
 * The engine sha, when `--engine` was not given: the tip of the PUBLIC
 * ultrapowers repository, read with `git ls-remote`. The sandbox clones from
 * GitHub at `engine=`, so the only shas that can work are the ones GitHub
 * already has; a local `HEAD` is a sha the sandbox cannot fetch.
 */
async function defaultEngineSha (exec) {
  const res = await exec('git', ['ls-remote', ENGINE_URL, 'HEAD'])
  if (res.code !== 0) {
    throw new Refusal(`engine: git ls-remote ${ENGINE_URL} HEAD failed:\n${output(res)}`)
  }
  const sha = String(res.stdout).trim().split(/\s+/)[0] ?? ''
  if (!isFullSha(sha)) {
    throw new Refusal(
      `engine: git ls-remote ${ENGINE_URL} HEAD answered no 40-hex sha (got ${JSON.stringify(sha.slice(0, 64))}); pass --engine <40-hex>`
    )
  }
  return sha
}

// The Claude Max access token lives at the edge and expires in hours; the
// laptop holds the refresh token. Before a VM exists, rotate it if it is within
// four hours of expiry — a run that outlives its bearer dies in the gate. The
// tool holds instead of rotating when a listed fleet VM is still live, since a
// refresh grant would revoke the access token every live run is using.
// A laptop set up with `claude setup-token` (no keychain record) skips this.
//
// The account is the launch's, so the entry this rotates and installs is the
// one the run signs in with — one entry, chosen per run and never mid-run.
// `spawn` is the second argument for the exam's sake: a spy records the argv
// and the real credential tool, and the keychain behind it, stay untouched.
export function defaultRefreshCredential (account = DEFAULT_ACCOUNT, spawn = spawnSync) {
  const tool = new URL('./claude-token.mjs', import.meta.url).pathname
  const r = spawn(process.execPath, [tool, 'refresh', '--account', account], { encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status === 0) {
    const held = out.split('\n').find((line) => line.startsWith('token: fresh until ') && line.endsWith('not rotated'))
    if (held !== undefined) return { ok: true, held, out }
    return { ok: true, out }
  }
  if (/no refresh token in the keychain/.test(out)) return { ok: true, skipped: true, out }
  const refused = out.split('\n').find((line) => line.startsWith('token: expires '))
  if (refused !== undefined) return { ok: false, refused, out }
  return { ok: false, out }
}

// A launch on an account at or past this share of either its five-hour or its
// seven-day window is refused before anything is pushed (#1114) — the
// reading the release owes is how often a refused launch would have merged.
export const USAGE_REFUSE_PCT = 95

// The usage read that follows a held-or-fresh credential, before the plan
// commit is pushed. `--no-rotate` (the same tool's `usage` verb) never mints
// anything, so the read is safe immediately after `defaultRefreshCredential`
// has just run or held. The sandbox itself cannot make this call — the proxy
// answers `GET /api/oauth/usage` with 403 (CONTRACT §probe 3) — so a laptop
// offline, or a keychain with no `accessToken`, answers `unread` here rather
// than a refusal, and the launch proceeds.
export function defaultReadUsage (account = DEFAULT_ACCOUNT, spawn = spawnSync) {
  const tool = new URL('./claude-token.mjs', import.meta.url).pathname
  const r = spawn(process.execPath, [tool, 'usage', '--json', '--account', account, '--no-rotate'], { encoding: 'utf8' })
  if (r.status !== 0) {
    return { unread: true, reason: `claude-token usage --json exited ${r.status}: ${String(r.stderr ?? r.stdout ?? '').trim()}` }
  }
  let parsed
  try {
    parsed = JSON.parse(String(r.stdout ?? ''))
  } catch (error) {
    return { unread: true, reason: `claude-token usage --json answered unparseable stdout: ${error.message}` }
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    return { unread: true, reason: `claude-token usage --json answered no single-row array (got ${JSON.stringify(parsed)})` }
  }
  return parsed[0]
}

/**
 * The refusal for a publishing plan with no credential at the edge, or `null`
 * when nothing is wrong: a `compiled.publish` object (the plan carries a
 * `**Publish:**` line) with no `cloudflare` row in `integrations`
 * (`listIntegrations`'s own rows, each carrying a `name`) is the one case
 * refused; a `compiled` with no `publish` at all — `null`, or absent because
 * it was parsed by a `plan_parse.py` from before that key existed — is not a
 * publishing plan and is never refused here, whatever `integrations` carries.
 */
function publishRefusal ({ compiled, integrations }) {
  const publish = compiled?.publish
  if (publish === null || publish === undefined || typeof publish !== 'object') return null
  const rows = Array.isArray(integrations) ? integrations : []
  if (rows.some((row) => row?.name === 'cloudflare')) return null
  return 'launch: the plan carries a **Publish:** line but the fleet has no cloudflare integration — ' +
    'the deploy would have no credential at the edge; first-run.md §cloudflare walks the token, then launch again'
}

// The refusal message for a usage window at or past `USAGE_REFUSE_PCT`, named
// as the Machine spells it: the account, the window's label, its utilization
// and its reset time, ending the same way every other pre-push refusal ends.
function usageRefusal (account, label, window) {
  return `launch: ${account} is at ${window.utilization}% of its ${label} window (resets ${window.resetsAt}) — ` +
    'a run on it can only die; pick another with --account — no VM was created and nothing was pushed'
}

/**
 * The rows of the janitor's `runs` list that carry this launch's plan on this
 * launch's target and whose record does not say the run ended (#1036). The
 * plan's identity is its text's blob sha: the launcher hashes `planText` with
 * `git hash-object --stdin` (no `-w` — nothing is written before the refusal
 * is decided), and reads each candidate row's `.ultrapowers/plan.md` blob off
 * the run's own plan branch, `ultra/plan-run-<N>`, fetched from the target
 * through the clone's `origin`. A fetch or a `rev-parse` that fails means the
 * branch is gone — the run is publishing or has published, and no engine reads
 * its task issues any more — so that row is not a duplicate.
 */
async function liveDuplicatesOf ({ exec, repoDir, target, planText, runs }) {
  const candidates = runs.filter((r) => r.target === target && r.live !== false && isRunNumber(r.run))
  if (candidates.length === 0) return []
  const hashed = await exec('git', ['-C', repoDir, 'hash-object', '--stdin'], { input: planText })
  if (hashed.code !== 0) return []
  const wanted = String(hashed.stdout ?? '').trim()
  const found = []
  for (const row of candidates) {
    const branch = planBranchFor(row.run)
    const fetched = await git(exec, repoDir, ['fetch', 'origin', branch])
    if (fetched.code !== 0) continue
    const commit = isSafeSha(row.plan) ? row.plan : `refs/remotes/origin/${branch}`
    const blob = await git(exec, repoDir, ['rev-parse', '--verify', '--quiet', `${commit}:.ultrapowers/plan.md`])
    if (blob.code !== 0) continue
    if (String(blob.stdout ?? '').trim() === wanted) found.push({ run: row.run, vm: row.vm })
  }
  return found
}

/**
 * Everything the launcher does, with the exec seam, the clock, the sleep and
 * the name's random half injected. Answers the launched run's record.
 *
 * The body parks the directory it fetched the compiler into on `held`, so the
 * temp tree is removed however the launch ends — the resolved run, a refusal
 * halfway down, or a throw from the lobby.
 */
export async function launch (params) {
  const held = { compilerDir: null }
  try {
    return await launchBody({ ...params, held })
  } finally {
    if (held.compilerDir !== null) {
      await fsp.rm(held.compilerDir, { recursive: true, force: true })
    }
  }
}

async function launchBody ({
  argv, exec = defaultExec, config, now = () => new Date(), sleep = defaultSleep, rand,
  refreshCredential = defaultRefreshCredential, readUsage = defaultReadUsage, verbsPath = VERBS_PATH,
  kata, kataEnvPath = defaultKataEnvPath(), held
}) {
  const { opts, positional } = parseArgs(argv, { flags: ['json', 'hold', 'again'] })

  // ── Local validation. Nothing has been executed at this point, and nothing
  //    will be until every one of these passes. ──────────────────────────────
  let planPath = positional[0]
  if (!planPath) throw new Refusal(`launch: a plan path is required\n${usage()}`)
  const target = opts.target
  if (!isSafeTarget(target)) {
    throw new Refusal(`launch: --target must be <owner>/<repo>, got ${JSON.stringify(target ?? null)}`)
  }
  if (!isFullSha(opts.base)) {
    throw new Refusal(`launch: --base must be a 40-hex commit sha, got ${JSON.stringify(opts.base ?? null)}`)
  }
  if (opts.engine !== undefined && !isFullSha(opts.engine)) {
    throw new Refusal(`launch: --engine must be a 40-hex commit sha, got ${JSON.stringify(opts.engine)}`)
  }
  // Neither flag is read by anything any more (the engine they configured is
  // gone); `parseArgs` keeps unknown keys for each CLI to refuse for itself,
  // so both are refused here by name, the same way any other flag this
  // launcher does not know would be — nothing executes past this point.
  if (opts.tier !== undefined) {
    throw new Refusal(`launch: unknown flag --tier`)
  }
  if (opts['implementer-effort'] !== undefined) {
    throw new Refusal(`launch: unknown flag --implementer-effort`)
  }
  // `--hold` is a bare flag, so `parseArgs` answers `true` for it and a string
  // for any `--hold=<value>` spelling. A string is a refusal here, before the
  // plan is read and before anything is executed: `hold=1` is the only value
  // the sandbox accepts, and a launch that meant to hold must not silently
  // become one that merges.
  if (opts.hold !== undefined && opts.hold !== true) {
    throw new Refusal(`launch: --hold takes no value, got ${JSON.stringify(opts.hold)}`)
  }
  // `--again` is the same shape: the one flag that launches a plan already
  // live on the target (#1036), and a value on it is a refusal before anything
  // is read.
  if (opts.again !== undefined && opts.again !== true) {
    throw new Refusal(`launch: --again takes no value, got ${JSON.stringify(opts.again)}`)
  }
  if (opts.run !== undefined && !isRunNumber(opts.run)) {
    throw new Refusal(`launch: --run must be a positive integer, got ${JSON.stringify(opts.run)}`)
  }
  // `--account` reaches `claude-token.mjs refresh` as an argument and the
  // keychain as an item's account, so a name it would refuse is refused here,
  // before the first read — a launch that cannot name its entry has not yet
  // touched exe.dev or the target.
  if (opts.account !== undefined && (opts.account === true || !ACCOUNT_NAME.test(opts.account))) {
    throw new Refusal(
      `launch: --account must be a name matching ${ACCOUNT_NAME.source}, got ${JSON.stringify(opts.account === true ? null : opts.account)}`
    )
  }

  const settings = config ?? await loadFleetConfig({ path: opts.config })
  // Which keychain entry this run signs in with: the flag, else the config's
  // `account`, else the entry the first-run walk builds. `loadFleetConfig`
  // answers only the two keys the pool is sized from, so the file's account is
  // read by `fleetConfigAccount` — and only when no config was injected, so an
  // exam that hands `launch` a config never reads the laptop's own.
  let account = opts.account === undefined ? null : String(opts.account)
  if (account === null) {
    const named = config === undefined || config === null
      ? await fleetConfigAccount({ path: opts.config })
      : config.account
    account = typeof named === 'string' && named !== '' ? named : DEFAULT_ACCOUNT
  }
  // The hub, on the same branch the account takes: an injected
  // `kata` is the client (a fake in a sim; `null` means "no hub" outright); with
  // none injected and no injected config, the laptop's own `kata-hub.env` is
  // read and the client is built on it — one `ssh <hub> curl …` per request
  // through this launch's own `exec` seam, the bearer sourced ON the hub. A
  // config injected with no `kata` is a launch with no hub at all: no request
  // is made and the result's `kata` is null, which is what keeps every sim that
  // hands `launch` a config at its BASE behaviour. The env read is a refusal
  // that precedes every command.
  let kataEnv = null
  let hub = kata === undefined ? null : kata
  if (kata === undefined && (config === undefined || config === null)) {
    kataEnv = await readKataEnv(kataEnvPath)
    const sshHost = kataHostOf(kataEnv.url)
    if (sshHost === null) {
      throw new Refusal(`launch: ${kataEnvPath} names KATA_URL ${JSON.stringify(kataEnv.url)}, not a url with a host — rebuild the hub: ${KATA_HUB_FIX}`)
    }
    hub = makeKataClient({ transport: sshTransport({ sshHost, exec }), actor: 'launch' })
  }
  const kataUrl = hub === null ? null : (hub.url ?? kataEnv?.url ?? null)

  // The ceiling this run is sized under: `--cpu`/`--memory` when the launch
  // line carries them — an explicit value wins outright, and is then its own
  // ceiling — and otherwise the `fleet.json` pair, or `FLEET_DEFAULTS`. The
  // shape is refused here, before anything is executed, exactly as it always
  // was; the number the `new` verb ends up carrying is decided below, once the
  // compiled plan has said how wide it is.
  const cpuCap = String(opts.cpu ?? settings.cpu ?? FLEET_DEFAULTS.cpu)
  const memoryCap = String(opts.memory ?? settings.memory ?? FLEET_DEFAULTS.memory)
  if (!isPositiveInt(cpuCap)) {
    throw new Refusal(`launch: cpu must be a positive integer, got ${JSON.stringify(cpuCap)}`)
  }
  if (!isMemorySize(memoryCap)) {
    throw new Refusal(`launch: memory must be a whole number of gigabytes spelled <int>GB, got ${JSON.stringify(memoryCap)}`)
  }

  const repoDir = path.resolve(String(opts.repo ?? process.cwd()))
  // A relative plan path is read against `repoDir` — the target clone when
  // `--repo` is given, the working directory otherwise, which is what
  // `repoDir` already resolves to in that case — and an absolute path is left
  // as it is. Resolved once here, this same absolute path is what every
  // downstream read, refusal message, re-pin command and `python3` argv
  // carries, so the launcher and the children it spawns with `cwd: repoDir`
  // agree on which file `planPath` names.
  planPath = path.resolve(repoDir, planPath)

  let planText
  try {
    planText = await fsp.readFile(planPath, 'utf8')
  } catch (error) {
    throw new Refusal(`launch: cannot read plan ${planPath}: ${error?.message ?? error}`)
  }
  if (planText.trim() === '') throw new Refusal(`launch: plan ${planPath} is empty`)
  let verdictsText = null
  try {
    verdictsText = await fsp.readFile(`${planPath.replace(/\.md$/, '')}.gate-verdicts.json`, 'utf8')
  } catch {
    verdictsText = null
  }

  // The comment's length does not depend on which sha the plan commit gets —
  // every sha is 40 hex — so the ceiling is checked here, before the world is
  // touched, with a placeholder standing in for `plan=`.
  const fields = {
    run: opts.run ?? '0',
    plan: '0'.repeat(40),
    target,
    base: opts.base,
    engine: opts.engine ?? '0'.repeat(40),
    hold: opts.hold === true ? '1' : undefined
  }
  const probeComment = buildComment(fields)
  if (Buffer.byteLength(probeComment, 'utf8') > COMMENT_MAX_BYTES) {
    throw new Refusal(
      `launch: assignment comment would be ${Buffer.byteLength(probeComment, 'utf8')} bytes, over the ${COMMENT_MAX_BYTES}-byte ceiling`
    )
  }

  // ── Reads. Still nothing mutated, on exe.dev or on the target. ────────────

  // A shallow checkout is refused first, before anything is read off the
  // origin: its history is truncated, so no `merge-base` it could answer says
  // anything about where `--base` sits. The launcher does not deepen it — an
  // operator's clone is theirs, and a launch is not the place to rewrite it.
  const shallow = await git(exec, repoDir, ['rev-parse', '--is-shallow-repository'])
  if (shallow.code === 0 && String(shallow.stdout ?? '').trim() === 'true') {
    throw new Refusal(
      `launch: --repo ${repoDir} ${SHALLOW_FIX}: a truncated history cannot answer whether --base ${opts.base} is on ${target}'s default branch`
    )
  }

  const originUrl = await readOriginUrl({ exec, repoDir })
  const originTarget = targetOfOriginUrl(originUrl)
  if (originTarget !== target) {
    throw new Refusal(
      `launch: ${repoDir} has origin ${JSON.stringify(originUrl)}, which does not name ${target}`
    )
  }

  const baseCheck = await git(exec, repoDir, ['rev-parse', '--verify', `${opts.base}^{commit}`])
  if (baseCheck.code !== 0) {
    throw new Refusal(
      `launch: ${repoDir} has no commit ${opts.base}:\n${output(baseCheck)}`
    )
  }

  // The plan's hash pins are facts about `--base`, and the checkout has it now:
  // a stale one is found here, with local git reads only, before the first
  // `ls-remote` and long before anything is pushed or any lobby verb issued.
  await verifyPlanPins({ exec, repoDir, base: opts.base, planText })

  // ── The compiler this launch compiles with. The engine sha is settled first
  //    — `--engine` when the line pinned one, else whatever `main` is at — and
  //    the compiler is fetched AT IT, because that is the copy the sandbox's
  //    preflight will run. Both happen here, before the first compile and
  //    before anything is pushed: a sha that cannot answer a compiler is a
  //    refusal on the laptop, not an hour of VM time spent reaching one.
  //    `engineSource` rides along so the launch line can say whether the
  //    operator chose this engine or the launcher caught it.
  const engineSource = opts.engine === undefined ? 'main-tip' : 'pinned'
  const engine = opts.engine ?? await defaultEngineSha(exec)
  const compiler = await fetchCompilerAt({ exec, engine, pluginRoot: PLUGIN_ROOT })
  if (held !== undefined) held.compilerDir = compiler.dir

  // ... and the plan compiles against that same tree, or nothing is launched.
  const baseFacts = await verifyPlanCompiles({
    exec, repoDir, base: opts.base, planPath, planText, compilerPath: compiler.scriptPath
  })

  // ── The base is on the target's default branch, or it is a refusal. The
  //    origin names its own default branch and that branch's tip in one
  //    `ls-remote --symref`; the fetch brings the tip's history into this
  //    checkout, and `merge-base --is-ancestor` answers the question. Every one
  //    of the three is a read of the target, and the only ref any of them
  //    writes is this checkout's `refs/remotes/origin/<default>`: `HEAD`, the
  //    local branches and the working tree are the operator's and stay as they
  //    were.
  const origin = await readDefaultBranch({ exec, repoDir })
  const fetched = await git(exec, repoDir, ['fetch', 'origin', origin.branch])
  // A fetch that answered non-zero is not itself the refusal — a checkout that
  // already has the tip needs nothing from it. What is fatal is not having the
  // tip afterward, because then no ancestry answer means anything.
  const hasTip = await git(exec, repoDir, ['cat-file', '-e', `${origin.tip}^{commit}`])
  if (hasTip.code !== 0) {
    throw new Refusal(
      `launch: ${repoDir} does not have ${target}'s ${origin.branch} tip ${origin.tip} — git fetch origin ${origin.branch} answered exit ${fetched.code}:\n${output(fetched)}`
    )
  }
  // git refreshes `refs/remotes/origin/<default>` on a fetch only when the line
  // named a configured remote and its refspec covers the branch; the launch's
  // one effect on the checkout should not depend on either, so the ref is
  // pointed at the tip the fetch just brought.
  if (fetched.code === 0) {
    await git(exec, repoDir, ['update-ref', `refs/remotes/origin/${origin.branch}`, origin.tip])
  }
  const ancestry = await git(exec, repoDir, ['merge-base', '--is-ancestor', opts.base, origin.tip])
  if (ancestry.code !== 0) {
    throw new Refusal(
      `launch: --base ${opts.base} is not on ${target}'s ${origin.branch} (tip ${origin.tip}) — ${BASE_OFF_MAIN_FIX}`
    )
  }


  // One `integrations list --json`, asked for the target's GitHub object.
  const integrations = await listIntegrations(exec)
  const githubName = githubIntegrationFor(target)
  if (!integrations.some((row) => row.name === githubName)) {
    throw new Refusal(
      `launch: no ${githubName} integration — the sandbox could still clone a public ${target} from github.com, but could not push its branch or open its PR. Build it once: node fleet/target.mjs ${target}`
    )
  }

  // ── The hub answers, or nothing is launched. One `ping` right after the
  //    integrations read and before the reap: a hub that is dark is a run
  //    that would park at boot on `kata unreachable`, so the laptop refuses it
  //    here, before a plan branch or a VM exists.
  if (hub !== null) {
    try {
      await hub.ping()
    } catch (error) {
      throw new Refusal(`launch: the kata hub at ${kataUrl} did not answer its ping — ${error?.message ?? error}; nothing was pushed and no VM was created (${KATA_HUB_FIX} rebuilds it)`)
    }
  }

  // ── The verb-drift preflight. `help <verb>` for every verb of the record,
  //    diffed against the flags recorded there. Every read, and every one of
  //    them a `help` line: `exec.mutating()` is untouched by it. A drift, a
  //    `help` that answers non-zero and a record that cannot be read at all
  //    are findings on the launch line and nothing more — the lobby's flags
  //    are exe.dev's to change, and a launch that still works is not a launch
  //    to refuse. So even a `help` seam that throws leaves the outcome alone.
  let drift
  try {
    drift = await verbDrift({
      help: (verb) => exec('ssh', [EXE_HOST, `help ${verb}`]),
      recordPath: verbsPath
    })
  } catch (error) {
    drift = {
      readable: false,
      capturedAt: null,
      findings: [],
      detail: `fleet/exe-verbs.json could not be compared against the lobby: ${error?.message ?? error}`
    }
  }

  // ── The reap. Nothing schedules the janitor, so every launch is where it
  //    runs — before the run number is read, so the fleet a launch joins is
  //    already clear of the VMs of runs that finished over an hour ago.
  //    `hub` is the client built above, so the janitor asks the hub this
  //    launch already reached — or, with no hub, reads the target. A reap
  //    that fails is reported and not fatal: the run being launched is worth
  //    more than the ballast the janitor came for.
  const reaped = []
  let reapError = null
  let fleetRuns = null
  try {
    const reap = await janitor({ argv: [], exec, now, kata: hub })
    fleetRuns = Array.isArray(reap.runs) ? reap.runs : []
    for (const action of reap.actions) {
      if (action.kind === 'rm' && action.applied === true) reaped.push(action.vm)
    }
  } catch (error) {
    reapError = String(error?.message ?? error) || 'launch: the reap failed'
  }

  // A reap that failed leaves no fleet list for the duplicate guard (#1036) to
  // read — refuse rather than launch with the guard silently skipped, unless
  // the operator passed `--again` to launch without it.
  if (fleetRuns === null && opts.again !== true) {
    throw new Refusal(
      `launch: the reap did not answer, so the duplicate guard (#1036) cannot run — ${reapError}; ` +
      'pass --again to launch without it'
    )
  }

  // ── The duplicate check (#1036). A plan that is already live on this target
  //    is refused here, before the run number is read and before anything is
  //    pushed: a second launch of the same plan re-answers the live run's task
  //    issues on the hub and bumps their revision, and the first run dies at
  //    Setup on `kata-revision-mismatch`. "The same plan" is the plan text's
  //    git blob sha — the identity the hub's `Idempotency-Key` is built from —
  //    never the comment's `plan=` commit, which carries the run number in its
  //    subject and so differs on every launch. A row whose record says the run
  //    ended never refuses, however recently; a row with no record yet counts
  //    as live. When the reap itself failed there is no list and no refusal.
  const again = fleetRuns === null
    ? []
    : await liveDuplicatesOf({ exec, repoDir, target, planText, runs: fleetRuns })
  if (again.length > 0 && opts.again !== true) {
    throw new Refusal(again.map((d) =>
      `launch: run-${d.run} is live on ${target} with this plan (VM ${d.vm}) — nothing was pushed; ` +
      'pass --again to launch it again on purpose (a byte-identical replay re-answers the live ' +
      "run's task issues on the hub and bumps their revision)"
    ).join('\n'))
  }

  // The N this launch asks for. Without `--run` it is one past the highest the
  // target carries *now*, which another launch can take between this read and
  // the push; the push is where it is settled.
  const firstRun = opts.run ? Number(opts.run) : await highestRunOnTarget(exec, repoDir) + 1

  // ── The parse. Exactly one, here, before the `new` verb — everything
  //    downstream reads it: the VM's size, and the tasks and edges
  //    `fileRunOnHub` files on the hub. `plan_parse.py`'s output does not move
  //    with the run number, so a bumped push files the same parse under N+1;
  //    the stamp is only a label.
  const firstCompiled = await compilePlanForRun({
    exec, repoDir, planPath, stamp: `run-${firstRun}`, compilerPath: compiler.parserPath
  })
  // The credential a publishing plan needs at the edge — checked as soon as a
  // real `compiled` object exists (a plan with no `**Publish:**` line, the
  // common case, carries no `publish` key and is never refused here), against
  // the `integrations` this launch already read for the GitHub check above.
  const publishRefused = publishRefusal({ compiled: firstCompiled, integrations })
  if (publishRefused !== null) {
    throw new Refusal(publishRefused)
  }
  // #645: a probe or check whose command word the sandbox lacks would exit 127
  // in its first second on the box, after the push and the `new`; read every
  // word against `SANDBOX_TOOLCHAIN` here, before the pool, the janitor, the
  // credential and the push, and refuse by name.
  const missingRunners = toolchainViolations(firstCompiled)
  if (missingRunners.length) {
    throw new Refusal(missingRunners.map(({ task, word, cmd }) =>
      `launch: task ${task}: probe runner '${word}' is not in the sandbox toolchain — ${cmd}`
    ).join('\n'))
  }
  const firstSize = sizeFromCompile(firstCompiled, { cpuCap, memoryCap, cpu: opts.cpu, memory: opts.memory })
  const memoryGb = parseMemoryGb(firstSize.memory)

  // One run must fit the plan's pool. Allocation is over-committable and
  // exe.dev refuses nothing by sum, so this is never a sum over live VMs:
  // contention bounds concurrency, and two plans at once is by design. Still
  // before the credential, the push and the verb, so a refusal here has
  // mutated nothing — and the parse does not move with N, so the widest wave,
  // and the box it asks for, are the same under every N.
  const capacity = await readPlanCapacity(exec)
  if (capacity.maxCpus < Number(firstSize.cpu)) {
    throw new Refusal(
      `launch: --cpu ${firstSize.cpu} does not fit the plan — billing plan --json says max_cpus ${capacity.maxCpus}`
    )
  }
  if (capacity.maxMemoryGb < memoryGb) {
    throw new Refusal(
      `launch: --memory ${firstSize.memory} does not fit the plan — billing plan --json says max_memory_gb ${capacity.maxMemoryGb}`
    )
  }

  const cred = refreshCredential(account)
  if (cred.refused) {
    throw new Refusal(`launch: ${cred.refused} — no VM was created and nothing was pushed`)
  }
  if (!cred.ok) {
    throw new LobbyError(`launch: the Claude credential could not be refreshed — no VM was created\n${cred.out}`)
  }

  // The usage read, right after the refresh has just run or held — the record
  // is unexpired and `--no-rotate` cannot mint anything. A row at or past the
  // wall on either window is a refusal before any push; an unread row is
  // never a refusal (#1114).
  const usageRow = readUsage(account)
  let usageLine
  if (usageRow.unread) {
    usageLine = `usage: ${account} unread — ${usageRow.reason}`
  } else {
    const { sevenDay, fiveHour } = usageRow
    if (sevenDay.utilization >= USAGE_REFUSE_PCT) {
      throw new Refusal(usageRefusal(account, 'seven-day', sevenDay))
    }
    if (fiveHour.utilization >= USAGE_REFUSE_PCT) {
      throw new Refusal(usageRefusal(account, 'five-hour', fiveHour))
    }
    usageLine = `usage: ${account} 7d ${sevenDay.utilization}% resets ${sevenDay.resetsAt}; ` +
      `5h ${fiveHour.utilization}% resets ${fiveHour.resetsAt}`
  }

  // ── The plan commit, pushed to the target before the VM exists. Plumbing
  //    against a temporary index, so the operator's index and working tree are
  //    never touched. The push is also what reserves the run number, so the N
  //    the launch ends up with is the one that got through — see `pushPlan`.
  const commands = []
  // The hub's half of each push attempt: the target's project, the issues
  // filed under THIS N, the record read back — and, on a bump, the run-N issue
  // CLOSED before N+1 is filed. Nothing is destroyed: the task issues are the
  // repository's and the same idempotency keys answer them again, so a bump
  // refiles them under the new run issue rather than purging a project that
  // holds the target's whole history.
  const kataCall = async (method, fn) => {
    try {
      return await fn()
    } catch (error) {
      throw new LobbyError(`launch: kata ${method} failed — ${error?.message ?? error}; no plan branch was pushed and no VM was created`)
    }
  }
  const kataStep = hub === null
    ? null
    : async (n, compiled) => {
        const record = await fileRunOnHub({
          hub, call: kataCall, planText, target, base: opts.base, n, compiled
        })
        return { text: `${JSON.stringify(record, null, 2)}\n`, record }
      }
  // A number that was taken, said on the run issue it was filed under. `wontfix`
  // is the reason a run that never existed deserves, and the message names the
  // number so a reader of the target's one project can tell an abandoned
  // attempt from a run that failed.
  const kataBump = hub === null
    ? null
    : (record, taken, next) => kataCall('close', () => hub.close(record.project.id, record.run.uid, {
        reason: 'wontfix',
        message: `run-${taken} was taken on the target before this plan commit could be pushed; ` +
          `this launch refiles the same tasks under run-${next}.`
      }))
  const plan = await pushPlan({
    exec,
    repoDir,
    base: opts.base,
    run: firstRun,
    planText,
    verdictsText,
    commands,
    // `--run N` is the operator's number, not one the launcher is free to
    // move: a refused push under it is refused, never retried elsewhere.
    reread: opts.run ? null : () => highestRunOnTarget(exec, repoDir),
    kataStep,
    kataBump,
    compiled: firstCompiled
  })
  const run = plan.run
  const planBranch = plan.branch
  const planSha = plan.sha
  // The size and the width the verb carries, read off the parse the push
  // filed — the same parse under every N.
  const { width, cpu, memory } = sizeFromCompile(plan.compiled, { cpuCap, memoryCap, cpu: opts.cpu, memory: opts.memory })

  // ── The one mutating lobby verb. ──────────────────────────────────────────
  const comment = buildComment({ ...fields, run: String(run), plan: planSha, engine })
  const script = stampWidth(
    renderSetupScript({ run: String(run), ...readFleetFiles() }),
    { width, cpu, memory }
  )
  // No `--integration` on the verb: the run's credentials — `claude-max` and the
  // target's object — reach the box by the
  // attachment policy `tag:fleet` each of them carries, so `--tag fleet` is the
  // grant. exe.dev refuses the flag outright since 2026-09-11, and a line that
  // carried it would fail every launch at `new`; hence the guard, which
  // refuses before the verb is issued rather than after the lobby does.
  const remoteFor = (vm) => {
    const remote = `new --name ${vm} --tag ${FLEET_TAG} --comment '${comment}'` +
      ` --cpu ${cpu} --memory ${memory} --setup-script /dev/stdin --json`
    if (NEW_INTEGRATION_FLAG.test(remote)) {
      throw new Refusal(`launch: the \`new\` verb must not carry --integration — exe.dev refuses it since 2026-09-11; integrations reach a fleet VM by the policy tag:${FLEET_TAG}`)
    }
    return remote
  }

  const minted = new Set()
  const failures = []
  let vm = null
  for (let attempt = 1; attempt <= NEW_ATTEMPTS; attempt += 1) {
    let name = vmNameFor(run, now(), rand)
    while (minted.has(name)) name = vmNameFor(run, now())
    if (!isVmName(name)) {
      throw new Refusal(`launch: minted VM name ${JSON.stringify(name)} is not fleet-r<N>-<yymmddHHMM>-<4 hex>`)
    }
    minted.add(name)
    const remote = remoteFor(name)
    commands.push(remote)
    try {
      await lobby(exec, remote, { input: script })
      vm = name
      break
    } catch (error) {
      failures.push(`attempt ${attempt} of ${NEW_ATTEMPTS} (${name}):\n${error?.message ?? error}`)
      if (attempt === NEW_ATTEMPTS) {
        throw new LobbyError(
          `launch: exe.dev refused \`new\` on all ${NEW_ATTEMPTS} attempts; run ${run}'s plan is on ${planBranch}\n${failures.join('\n')}`
        )
      }
      await sleep(retryDelay())
    }
  }

  return {
    run,
    runId: `run-${run}`,
    vm,
    comment,
    plan: planSha,
    planBranch,
    evidenceBranch: evidenceBranchFor(run),
    integrationBranch: integrationBranchFor(run),
    target,
    base: opts.base,
    engine,
    engineSource,
    // The sha the compiler was fetched at — the same one `engine=` carries, so
    // the launch line says outright which `plan_check.py` decided this plan
    // was launchable.
    compiler: engine,
    // The account is the run's, but never the assignment's: `parse_assignment`
    // on the VM refuses a comment key it does not know, and neither
    // `COMMENT_KEYS` nor `buildComment` spells `account`. It lives here and on
    // the launch line instead.
    account,
    // The usage line, read after the refresh and before any push (#1114) —
    // carried on `renderLaunch` directly after `account=`.
    usage: usageLine,
    // The hold line from `defaultRefreshCredential`, when the credential tool
    // held rather than rotated because a listed fleet VM is still live — carried
    // onto the launch line so a launch beside live runs says so.
    ...(cred.held === undefined ? {} : { token: cred.held }),
    // The hub's record of this run — `{url, project, run, tasks}`, the same
    // object the plan commit carries as `.ultrapowers/kata.json` — or null for
    // a launch that reached no hub.
    kata: plan.kata,
    verbDrift: drift,
    github: githubName,
    cpu,
    memory,
    // W, the widest wave of the parsed plan: what `cpu` and `memory` were
    // sized to. It is not an assignment key — `COMMENT_KEYS` in
    // `fleet/lobby.mjs` spells six and `parse_assignment` on the VM fails on a
    // seventh — so it rides the setup script's header instead (`stampWidth`),
    // where it is a record and not a switch.
    width,
    launchedAt: now().toISOString(),
    commands,
    reaped,
    reapError,
    again,
    // What the compiler read off the tree at `--base` about this plan (#896):
    // printed by the launch line, never a refusal.
    baseFacts
  }
}

/** A whole number of milliseconds in [RETRY_MIN_MS, RETRY_MAX_MS]. */
const retryDelay = () =>
  RETRY_MIN_MS + Math.floor(Math.random() * (RETRY_MAX_MS - RETRY_MIN_MS + 1))

/** The `origin` URL of the checkout a launch runs against, or a refusal. */
async function readOriginUrl ({ exec, repoDir }) {
  const res = await git(exec, repoDir, ['remote', 'get-url', 'origin'])
  if (res.code !== 0) {
    throw new Refusal(
      `launch: --repo ${repoDir} is not a git checkout with an origin remote:\n${output(res)}`
    )
  }
  return String(res.stdout ?? '').trim()
}

/**
 * The origin's default branch and the sha it points at, off one `ls-remote
 * --symref origin HEAD`. That prints two lines — `ref: refs/heads/<name>\tHEAD`
 * and `<sha>\tHEAD` — and the name comes off the first, the tip off the second.
 * A branch name is used in later git lines, so it is pinned to the shape a
 * branch has; anything the launcher cannot read is a refusal, because guessing
 * `main` here is exactly the guess this check exists to stop making.
 */
async function readDefaultBranch ({ exec, repoDir }) {
  const res = await git(exec, repoDir, ['ls-remote', '--symref', 'origin', 'HEAD'])
  if (res.code !== 0) {
    throw new Refusal(
      `launch: git ls-remote --symref origin HEAD in ${repoDir} failed (exit ${res.code}):\n${output(res)}`
    )
  }
  let branch = null
  let tip = null
  for (const line of String(res.stdout ?? '').split('\n')) {
    const symref = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/.exec(line.trim())
    if (symref) branch ??= symref[1]
    const head = /^([0-9a-f]{40})\s+HEAD$/.exec(line.trim())
    if (head) tip ??= head[1]
  }
  if (branch === null || tip === null || !/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(branch)) {
    throw new Refusal(
      `launch: git ls-remote --symref origin HEAD named no default branch and tip:\n${output(res)}`
    )
  }
  return { branch, tip }
}

/**
 * The plan commit: `<base>`'s tree plus `.ultrapowers/plan.md` (and the gate
 * verdicts when the plan has a sibling verdicts file), one commit on `<base>`,
 * built entirely with plumbing against a temporary index file. The operator's
 * own index and working tree are never read and never written, so a launch
 * from a dirty checkout is as safe as one from a clean one.
 *
 * A local git failure here is still a refusal: exe.dev has seen nothing but
 * reads, and the target has nothing new on it.
 */
async function commitPlan ({ exec, repoDir, base, run, planText, verdictsText, kataText = null }) {
  const indexDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fleet-plan-'))
  const env = { ...process.env, GIT_INDEX_FILE: path.join(indexDir, 'index') }
  const plumb = async (argv, options = {}) => {
    const res = await exec('git', ['-C', repoDir, ...argv], { env, ...options })
    if (res.code !== 0) {
      throw new Refusal(`launch: git ${argv.join(' ')} failed (exit ${res.code}):\n${output(res)}`)
    }
    return String(res.stdout ?? '').trim()
  }
  try {
    await plumb(['read-tree', base])
    const entries = [[PLAN_PATH, planText]]
    if (verdictsText !== null) entries.push([VERDICTS_PATH, verdictsText])
    if (kataText !== null) entries.push([KATA_PATH, kataText])
    for (const [rel, text] of entries) {
      const blob = await plumb(['hash-object', '-w', '--stdin'], { input: text })
      if (!isSafeSha(blob)) {
        throw new Refusal(`launch: git hash-object answered ${JSON.stringify(blob)}, not an object name`)
      }
      await plumb(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`])
    }
    const tree = await plumb(['write-tree'])
    if (!isSafeSha(tree)) {
      throw new Refusal(`launch: git write-tree answered ${JSON.stringify(tree)}, not an object name`)
    }
    const sha = await plumb(['commit-tree', tree, '-p', base, '-m', `ultrapowers plan run-${run}`])
    if (!isFullSha(sha)) {
      throw new Refusal(`launch: git commit-tree answered ${JSON.stringify(sha)}, not a 40-hex sha`)
    }
    return sha
  } finally {
    await fsp.rm(indexDir, { recursive: true, force: true })
  }
}

/** How many plan pushes one launch makes before it refuses. */
const PUSH_ATTEMPTS = 3

/**
 * The plan commit, pushed — and the run number, reserved by that push rather
 * than by the read that proposed it. Two launches started in the same second
 * on one target read the same highest N and pick the same N+1; the ref is the
 * only thing that can tell them apart, so the loser of the push is the one
 * that takes the next number.
 *
 * So a refused push is re-read before it is believed: `highestRunOnTarget` —
 * the same read the number came from, branches *and* tags in one `ls-remote` —
 * says whether a ref for the N just tried appeared. If it did, the refusal was
 * a race: the launch takes reading + 1, builds a *fresh* plan commit for that
 * N (the subject carries the number, so the old sha cannot be re-pushed under
 * a new name) and pushes again. If it did not, nothing raced us — the target
 * refused this push on its own terms, a pre-receive hook or a lost credential,
 * and a second push would be refused the same way — so it is refused at once,
 * with the push's own output. Git's words are never parsed: the target's refs
 * decide, not the wording of a rejection line.
 *
 * `--run N` names an N the operator chose, so it is pushed once and refused if
 * that is refused: `reread` is null and no re-read is made at all.
 *
 * The parse does not move with the number: `compiled` is the launch's one
 * parse, filed on the hub under whichever N the push wins, and it rides back
 * out on `compiled` for the verb to size the box from.
 *
 * At most `PUSH_ATTEMPTS` pushes in all. The refusal is the push's own — the
 * text a single refused push has always carried — with ` after <n> tries` when
 * more than one was made.
 */
async function pushPlan ({
  exec, repoDir, base, run, planText, verdictsText, commands, reread,
  kataStep = null, kataBump = null, compiled = null
}) {
  let n = run
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt += 1) {
    const branch = planBranchFor(n)
    // The hub is filed for THIS N before the commit is built: a bump closes
    // the run issue it filed and files N+1's instead. The project is the
    // target's and outlives every number, so a bump destroys nothing.
    const filed = kataStep === null ? null : await kataStep(n, compiled)
    const sha = await commitPlan({
      exec, repoDir, base, run: n, planText, verdictsText, kataText: filed === null ? null : filed.text
    })
    const pushArgv = ['-C', repoDir, 'push', 'origin', `${sha}:refs/heads/${branch}`]
    commands.push(`git ${pushArgv.join(' ')}`)
    const push = await exec('git', pushArgv)
    if (push.code === 0) {
      return { run: n, sha, branch, compiled, kata: filed === null ? null : filed.record }
    }

    const refusal = () =>
      new Refusal(
        `launch: git push origin ${sha}:refs/heads/${branch} failed` +
        `${attempt > 1 ? ` after ${attempt} tries` : ''} (exit ${push.code}):\n${output(push)}`
      )
    if (attempt === PUSH_ATTEMPTS || reread === null) throw refusal()
    const highest = await reread()
    if (highest < n) throw refusal()
    const taken = n
    n = highest + 1
    if (filed !== null) await kataBump(filed.record, taken, n)
  }
}

/**
 * The 40 hex `git hash-object` prints for a text — computed in-process, so
 * nothing here has to exec git to learn the identity of a plan. A blob's sha1
 * is taken over the header `blob <byte length>\0` and then the bytes; the
 * length is the BYTE length, which is why `Buffer.byteLength` and not `.length`.
 *
 * It is the plan's identity in an `Idempotency-Key`: the same plan text is the
 * same sha is the same key is the same issue, and a plan whose text changed is
 * a new sha and a new set of issues.
 */
const planBlobSha = (text) => {
  const s = String(text ?? '')
  return crypto.createHash('sha1')
    .update('blob ' + Buffer.byteLength(s) + '\0')
    .update(s)
    .digest('hex')
}

/**
 * The run, filed on the hub for one run number: the tasks of the parse made
 * for `run-<n>` (`compilePlanForRun`), one project `<owner>-<repo>` —
 * the TARGET's, not this number's, so every run against one repository files
 * into one project and a name the hub already holds answers the project that is
 * there — one run issue carrying the plan's title, Claim line and Closes
 * numbers, one issue per task in wave order whose run and wave are PATCHED on
 * after the create and whose `parent` is the run issue, one `blocks` link per
 * dependency edge created ON the task that blocks, and then one `getIssue` per
 * task and one for the run — the revisions THOSE answer are the record's,
 * because nothing here assumes which side of a link kata re-revisions. The
 * answer is the `.ultrapowers/kata.json` object, keys in the order the contract
 * spells: `url`, `project`, `run`, `tasks`.
 *
 * FILING THE SAME PLAN TWICE FILES IT ONCE. Every create carries an
 * `Idempotency-Key` — `<target>:<plan sha>:task-<id>` for a task, `…:run-<n>`
 * for the run — and kata fingerprints that key together with the create's
 * fields, so the create body must be the same on every launch of one plan
 * text or the replay is a 409 `idempotency_mismatch`. That is why a task's
 * create carries only `{task, plan}` and no links: `run` and `wave`
 * move with the run number, and initial links are in the
 * fingerprint too. They arrive instead as the metadata patch and the `parent`
 * link that follow, which a second launch simply re-applies to the issue the
 * key answered. The patch reads the issue first because an idempotent replay
 * answers the ORIGINAL revision (the issue is already past it, linked), and a
 * stale `If-Match` is a 412; the metadata endpoint merges per key, so a patch
 * of `{run, wave}` leaves `{task, plan}` where they are. The
 * `parent` link carries `replace: true` because a second parent is otherwise a
 * 409 `parent_already_set` — a refiled task moves under the new run issue
 * rather than refusing. Hub behaviour measured against kata v0.17.2 on
 * 2026-09-14.
 *
 * A task row is `{uid, short_id, revision}`, in that order (#963). The
 * `short_id` is the create answer's — `MUTATION_KEYS` in `fleet/kata-client.mjs`
 * projects it, so the launcher already holds it here — and it is the ONLY place
 * it can come from: the dispatch `getIssue` the engine makes projects
 * `ISSUE_KEYS`, which has no `short_id`, so a row that does not carry one leaves
 * every worker of that task with no `KATA_REF` and no issue to write to. Hence
 * the refusal below rather than a row without it: a run whose workers cannot
 * name their issue is not a run this launcher files. The run's own row stays
 * `{uid, revision}` — no label resolves to it, so nothing reads a short id
 * there.
 *
 * Every hub call goes through `call`, which turns a throw into the launch's
 * LobbyError naming the method; the missing `short_id` is the launch's own
 * refusal. The sheets are `compiled` — the launch's one parse, handed in
 * rather than run again here; a bumped push files the same parse under the
 * number it got.
 */
async function fileRunOnHub ({ hub, call, planText, target, base, n, compiled }) {
  const stamp = `run-${n}`
  const waves = compiled?.waves ?? []
  const edges = compiled?.edges ?? []

  const planSha = planBlobSha(planText)
  const keyFor = (suffix) => `${target}:${planSha}:${suffix}`

  const name = kataProjectFor(target)
  const project = await call('createProject', () => hub.createProject(name))
  const runIssue = await call('createIssue', () => hub.createIssue(project.id, {
    title: `${stamp}: ${planTitleOf(planText)}`,
    body: planClaimOf(planText),
    metadata: { run: n, target, base, closes: planClosesOf(planText), plan: planSha },
    idempotencyKey: keyFor(`run-${n}`),
    // A relaunch of a plan the fleet already drove differs from that run's
    // open issue only by N in the title, and the hub's duplicate scorer refuses
    // it (#1008). Run numbers make the title distinct by construction, so the
    // create says so; the task creates below stay byte-identical, since theirs
    // is the body the idempotency key is fingerprinted with.
    forceNew: true
  }))
  const tasks = []
  for (const [index, wave] of waves.entries()) {
    for (const entry of wave) {
      const id = String(entry.id)
      const issue = await call('createIssue', () => hub.createIssue(project.id, {
        title: `task ${id}: ${entry.title ?? ''}`,
        body: '',
        metadata: { task: id, plan: planSha },
        idempotencyKey: keyFor(`task-${id}`)
      }))
      const shortId = issue?.short_id
      if (typeof shortId !== 'string' || shortId === '') {
        throw new Refusal(
          `launch: kata createIssue for task ${id} answered no short_id — ` +
          'the worker reference `<project>#<short id>` cannot be written and no ' +
          'record was filed'
        )
      }
      // This number's half of the issue, applied rather than created: read for
      // the revision the patch needs (a replay answers the create's, not the
      // issue's), merge the run's own metadata on, and move the parent.
      const read = await call('getIssue', () => hub.getIssue(issue.uid))
      await call('patchMetadata', () => hub.patchMetadata(project.id, issue.uid, {
        run: n, wave: index + 1
      }, read.revision))
      await call('link', () => hub.link(project.id, issue.uid, {
        type: 'parent', to_ref: runIssue.uid, replace: true
      }))
      tasks.push({ id, uid: issue.uid, shortId })
    }
  }
  const uidOf = new Map(tasks.map((t) => [t.id, t.uid]))
  for (const edge of edges) {
    const from = uidOf.get(String(edge.from))
    const to = uidOf.get(String(edge.to))
    if (!from || !to) {
      throw new Refusal(`launch: plan_parse.py for ${stamp} names an edge ${edge.from} -> ${edge.to} between tasks it did not list`)
    }
    await call('link', () => hub.link(project.id, from, { type: 'blocks', to_ref: to }))
  }
  const record = {
    url: KATA_SANDBOX_URL,
    project: { id: project.id, uid: project.uid, name: project.name },
    run: null,
    tasks: {}
  }
  for (const t of tasks) {
    const read = await call('getIssue', () => hub.getIssue(t.uid))
    record.tasks[t.id] = { uid: t.uid, short_id: t.shortId, revision: read.revision }
  }
  const readRun = await call('getIssue', () => hub.getIssue(runIssue.uid))
  record.run = { uid: runIssue.uid, revision: readRun.revision }
  return record
}

export { fileRunOnHub }

/**
 * An unpinned engine, named as the tip it is. Only the unpinned case is
 * annotated: a pinned sha is one the operator typed, and the assignment comment
 * already prints `engine=<sha>` either way, so there is nothing a `(pinned)`
 * line would tell them. #636 asks for exactly this — that the tip stop passing
 * for a choice.
 *
 * The annotation is a rendered line, never part of the comment: the comment's
 * text is pinned byte-for-byte, and a run reading it must not have to strip
 * prose off the sha.
 */
const engineLine = (result) =>
  result.engineSource === 'main-tip'
    ? `engine=${result.engine} (main tip; pass --engine <40-hex> to pin)`
    : null

/**
 * The lines a launched run prints: its id, its VM, where to watch, what it was
 * told, one line per VM this launch's reap removed, which keychain entry it
 * signed in with, what the verb-drift preflight found — and, when nobody
 * pinned one, which engine it happens to have caught, then the `compiler=<sha>`
 * the two compiles were run from. A launch that reaped nothing prints no reap
 * line at all.
 *
 * `compiler=` sits between the engine line and the fact lines, never among
 * them: the `BASE fact:`, `STALE fact:`, `GREEN-AT-BASE fact:` and
 * `AUTHORING fact:` entries are the LAST lines of the launch text, which is
 * what an operator reads down to.
 *
 * `account=` is a rendered line and never part of the comment: the comment is
 * the assignment the VM parses, and a key it does not know kills the run at
 * boot. The two launches that differ only in `--account` build the same
 * comment byte for byte and differ on this line.
 */
export const renderLaunch = (result) => [
  result.runId,
  result.vm,
  result.comment,
  ...(result.reaped ?? []).map((vm) => `reaped ${vm}`),
  ...(result.again ?? []).map((d) => `again run-${d.run} ${d.vm}`),
  result.account === undefined ? null : `account=${result.account}`,
  result.usage === undefined ? null : result.usage,
  result.token === undefined ? null : result.token,
  result.kata ? `kata=${result.kata.project.name} ${Object.keys(result.kata.tasks).length} tasks` : null,
  result.verbDrift === undefined ? null : `verb-drift: ${result.verbDrift.detail}`,
  engineLine(result),
  result.compiler === undefined || result.compiler === null ? null : `compiler=${result.compiler}`,
  ...(result.baseFacts ?? [])
].filter((line) => line !== null).join('\n')

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['json', 'hold', 'again'] })
  const result = await launch({ argv })
  process.stdout.write(opts.json ? `${JSON.stringify(result)}\n` : `${renderLaunch(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
