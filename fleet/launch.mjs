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
 *      is a line on the launch, never a refusal;
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
 *      with the rendered setup script on that call's stdin. The verb carries
 *      no `--integration`: exe.dev refuses that flag since 2026-09-11 ("new
 *      --integration cannot safely rewrite a singular attachment policy"), and
 *      the run's credentials reach the VM by policy instead — each integration
 *      (`claude-max`, `gh-<owner>-<repo>`, the renderer's) carries the
 *      attachment policy `tag:fleet`, so `--tag fleet` is what grants them.
 *
 * Nothing schedules the janitor, so the launcher runs it: one `janitor()` pass
 * between the pool read and the run number, whose reaped VMs the result carries
 * as `reaped`. A reap that fails says so in `reapError` and stops nothing — the
 * run being launched is worth more than the ballast the janitor came for.
 *
 * Nothing waits for ssh and nothing starts the unit: the setup script does
 * both, on the VM. A `new` that answers non-zero is retried — three attempts in
 * all, a freshly minted name each time, because exe.dev reserves a refused name
 * forever — and the failure after the third carries every attempt's output.
 *
 * A `--base` the target's default branch has never seen is a refusal, before
 * the plan is pushed: run-27 was launched off a parked branch and every merge
 * after it was a hand rebase. The read is the origin's own — one `ls-remote
 * --symref origin HEAD` for the branch's name and tip, one `fetch` of that
 * branch, one `merge-base --is-ancestor` — and a shallow checkout, which cannot
 * answer the question at all, is refused before even that.
 *
 * A target with no `gh-<owner>-<repo>` object is a refusal, before the plan is
 * pushed: a public repo would still clone from github.com, but nothing could
 * push its branch or open its PR, and a run that cannot publish is a run nobody
 * asked for. `node fleet/target.mjs <owner>/<repo>` builds the object once.
 *
 * The renderer, when the config file names one, reaches the box the same way:
 * its integration rides the `tag:fleet` policy, and the setup script drops the
 * proxy address under /etc/fleet. It is read from `~/.ultrapowers/fleet.json`
 * and never from a flag — an address the whole fleet shares is not a per-launch
 * choice. A `render` the laptop can see is malformed is refused before anything
 * is executed, and a `render.integration` the account has no object for is
 * refused off the same `integrations list --json` the GitHub check reads: the
 * laptop refuses what the sandbox would have refused an hour later.
 *
 * A refusal (exit 2) happens before anything is created, so the account and the
 * target are exactly as they were. A failure after that (exit 1) prints the
 * lobby's own words: exe.dev documents no error envelope, so a refused name or
 * a full account is shown verbatim rather than paraphrased.
 */

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  COMMENT_MAX_BYTES,
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
  listIntegrations,
  loadFleetConfig,
  lobby,
  output,
  parseArgs,
  parseMemoryGb,
  planBranchFor,
  readPlanCapacity,
  runCli,
  statusUrlFor,
  vmNameFor
} from './lobby.mjs'
import { fleetConfigAccount, fleetConfigRender, verbDrift } from './doctor.mjs'
import { makeKataClient, sshTransport } from './kata-client.mjs'
import { janitor } from './janitor.mjs'
import { readFleetFiles, renderSetupScript } from './setup-script.mjs'

/** One string, so a docs check that reads the first `usage` literal sees every
 *  flag the launch line may carry. */
export const USAGE = `usage: node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <40-hex>
                             [--repo <dir>] [--engine <40-hex>]
                             [--overlap fold|serialize] [--tier standard|mostCapable]
                             [--implementer-effort low|medium|high] [--hold]
                             [--cpu <n>] [--memory <n>GB]
                             [--run <N>] [--config <path>] [--account <name>] [--json]`

export const usage = () => USAGE

/** The three enumerated flags, with the exact spellings the comment carries. */
export const OVERLAP_VALUES = Object.freeze(['fold', 'serialize'])
export const TIER_VALUES = Object.freeze(['standard', 'mostCapable'])
/** The effort the implementers (and their fix rounds) work at; every judge
 *  keeps its own. The CLI also takes `xhigh` and `max`; the knob turns effort
 *  DOWN, so it offers the lower three and refuses the rest. */
export const EFFORT_VALUES = Object.freeze(['low', 'medium', 'high'])

/**
 * The keychain entry a run signs in with when neither `--account` nor the
 * config names one — the entry every laptop that walked the first run has.
 * `ACCOUNT_NAME` is `fleet/claude-token.mjs`'s own rule, copied rather than
 * imported: the launcher refuses a name the credential tool would refuse, and
 * it refuses it before anything is executed.
 */
export const DEFAULT_ACCOUNT = 'ultrapowers'
const ACCOUNT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * What the config file's `render` may be spelled with. These are
 * `fleet/setup-script.mjs`'s own two rules, copied rather than imported for the
 * reason `ACCOUNT_NAME` is: the laptop refuses on the laptop what the renderer
 * would have thrown on, before a VM exists to throw it. The integration is an
 * exe.dev object name and reaches a proxy hostname; the account is a
 * Cloudflare account id and reaches a URL path segment.
 */
const RENDER_INTEGRATION_NAME = /^[a-z][a-z0-9-]*$/
const RENDER_ACCOUNT_ID = /^[A-Za-z0-9_-]+$/

/** The flag `new` may never carry: exe.dev refuses it, and the policy
 *  `tag:fleet` on each integration is what grants a fleet VM its credentials. */
const NEW_INTEGRATION_FLAG = /(^|\s)--integration(=|\s|$)/

/** The lobby-verb record the preflight compares the live lobby against. */
const VERBS_PATH = new URL('./exe-verbs.json', import.meta.url).pathname

/** Where the plan lands in the commit the launcher pushes. */
export const PLAN_PATH = '.ultrapowers/plan.md'
export const VERDICTS_PATH = '.ultrapowers/gate-verdicts.json'
/** The third path of the plan commit: the run's kata record — the project, the
 *  run issue and one issue per task on the hub, each with the revision it had
 *  when the launcher last read it (#913). Written only when a hub is reached. */
export const KATA_PATH = '.ultrapowers/kata.json'
/** The url the SANDBOX reaches the hub at — the `kata` http-proxy attached by
 *  `tag:fleet` — written into the record regardless of the laptop's own route,
 *  because the record's reader is the engine on the sandbox and never the
 *  laptop. */
export const KATA_SANDBOX_URL = 'https://kata.int.exe.xyz'
/** The one command that builds the hub, named by every refusal about it. */
export const KATA_HUB_FIX = 'node fleet/kata-hub.mjs'
/** Where `fleet/kata-hub.mjs` leaves the hub's address and bearer. */
export const defaultKataEnvPath = () => path.join(os.homedir(), '.ultrapowers', 'kata-hub.env')

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
export async function readKataEnv (envPath) {
  let text
  try {
    text = await fsp.readFile(envPath, 'utf8')
  } catch (error) {
    throw new Refusal(`launch: no kata hub env at ${envPath} (${error?.code ?? error?.message ?? error}) — build the hub once: ${KATA_HUB_FIX}`)
  }
  const fields = {}
  for (const line of text.split('\n')) {
    const m = /^(KATA_URL|KATA_TOKEN)=(.*)$/.exec(line.trim())
    if (m && !(m[1] in fields)) fields[m[1]] = m[2].trim()
  }
  for (const key of ['KATA_URL', 'KATA_TOKEN']) {
    if (!fields[key]) {
      throw new Refusal(`launch: ${envPath} has no ${key}= line — build the hub once: ${KATA_HUB_FIX}`)
    }
  }
  return { url: fields.KATA_URL, token: fields.KATA_TOKEN }
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
export const BASE_OFF_MAIN_FIX =
  'relaunch from main; a parked branch is re-driven as a plan on main, not as a base'

/** What a shallow launch checkout is told to do — by hand, never by the
 *  launcher: unshallowing an operator's clone is not a launch's business. */
export const SHALLOW_FIX = 'is a shallow clone — unshallow it by hand and relaunch'

/**
 * What a word of a plan's `**Exam command:**` template may be spelled with
 * (#716). The sandbox reads that template as ONE RUNNER AND ITS ARGUMENTS —
 * `ultra_run.py`'s `runner_for` takes `cmd.split()[0]` for a command its table
 * does not know and probes it with `command -v` — so the class admits what a
 * runner and its flags are spelled with (`-q`, `--tb=short`, `./...`,
 * `pkg:test`, `a,b`) and excludes every shell operator, quote and expansion
 * character. This is the same literal `compile_plan.py` writes as
 * `EXAM_RUNNER_WORD`; the launcher copies the rule rather than importing it,
 * so a plan the compiler refuses never reaches a VM.
 */
export const EXAM_RUNNER_WORD = /^[A-Za-z0-9_.+/=:@,-]+$/

const EXAM_PATHS_TOKEN = '{paths}'
const EXAM_COMMAND_LABEL = /^\*\*\s*exam[-\s]?command\s*(?::\s*\*\*|\*\*\s*:)\s*(.*)$/i
const FENCE_LINE = /^(`{3,}|~{3,})/
const TASK_HEAD_LINE = /^ {0,3}### Task [A-Za-z0-9]+:/

/**
 * The plan header's `**Exam command:**` value, read the way `compile_plan.py`
 * reads it: the first matching line before the first task heading and outside
 * any fence, wrapped lines joined on a space, whitespace collapsed.
 */
function examCommandValue (planText) {
  const stack = []
  let value = null
  for (const line of String(planText ?? '').split('\n')) {
    const stripped = line.trim()
    const fence = FENCE_LINE.exec(stripped)
    if (fence) {
      if (value !== null) break
      const run = fence[1]
      const inner = stack[stack.length - 1]
      if (inner && run[0] === inner[0] && run.length >= inner.length && stripped === run) stack.pop()
      else stack.push(run)
      continue
    }
    if (stack.length > 0) {
      if (value !== null) break
      continue
    }
    if (TASK_HEAD_LINE.test(line)) break // the header ends at the first task heading
    if (value === null) {
      const match = EXAM_COMMAND_LABEL.exec(stripped)
      if (match) value = [match[1].trim()]
      continue
    }
    if (stripped === '' || stripped.startsWith('**')) break
    value.push(stripped)
  }
  if (value === null) return null
  return value.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * The plan header's exam-command template, refused when the sandbox would not
 * read it as a runner and its arguments (#716). A backtick surviving to the
 * driver's shell is a command substitution, and a word carrying a shell
 * operator, a quote or an expansion means the first word is not necessarily
 * what runs the suite — both were `PLAN OK` before, and a launch is the last
 * place either can still be caught for free. Answers the value (or null when
 * the header declares none) when the template is well shaped.
 */
export function examCommandShapeOf (planText) {
  const value = examCommandValue(planText)
  if (value === null) return null
  if (value.includes('`')) {
    throw new Refusal(
      `launch: **Exam command:** carries a backtick — ${value}; the driver's shell reads it as a command substitution (run-74)`
    )
  }
  const words = value.split(/\s+/).filter((word) => word !== '')
  for (const [index, word] of words.entries()) {
    if (word === EXAM_PATHS_TOKEN && index > 0) continue
    if (word === EXAM_PATHS_TOKEN || !EXAM_RUNNER_WORD.test(word)) {
      throw new Refusal(`launch: **Exam command:** ${word} is not a command word — ${value}`)
    }
  }
  return value
}

/**
 * How many `new` lines a launch may issue, and the window it sleeps in between
 * them. A name exe.dev refused stays reserved, so each attempt mints its own.
 */
export const NEW_ATTEMPTS = 3
export const RETRY_MIN_MS = 1_000
export const RETRY_MAX_MS = 3_000

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
 * The four spellings a checkout's `origin` may carry for one GitHub target.
 * Anything else answers null, and the refusal names what it saw rather than
 * guessing a repository out of it.
 */
const ORIGIN_SPELLINGS = Object.freeze([
  /^https:\/\/github\.com\/(.+?)(?:\.git)?\/?$/,
  /^git@github\.com:(.+?)(?:\.git)?\/?$/,
  /^ssh:\/\/git@github\.com\/(.+?)(?:\.git)?\/?$/
])

export function targetOfOriginUrl (url) {
  const text = String(url ?? '').trim()
  for (const pattern of ORIGIN_SPELLINGS) {
    const match = pattern.exec(text)
    if (match && isSafeTarget(match[1])) return match[1]
  }
  return null
}

/**
 * A hash pin is a fact about BASE, and BASE is chosen at launch and not at
 * authoring — so every `git hash-object` literal a plan carries is checked
 * against the tree at `--base` before the plan is pushed, with nothing but
 * local git reads made. A stale pin found here costs seconds on the laptop; the
 * same pin found on the sandbox costs a run.
 *
 * A pin lives on a `- Check:` bullet of `## Global Constraints` or a `- Run:`
 * bullet of a task's Proof — the launcher reads a line by its stripped form and
 * not by where in the plan it sits, so a pin on any other kind of line (a
 * `**Context:**` sentence quoting one, say) is prose and is not read. Two
 * shapes are pins:
 *
 *   test "$(git hash-object <path>)" = <40-hex>
 *   test "$(<command> | git hash-object --stdin)" = <40-hex>
 *
 * A `Run:` may chain several with `&&`, so one line can carry several.
 */

/** A pin-bearing bullet, by its stripped form. */
const PIN_LINE = /^-\s*(?:Check|Run):\s*(.*)$/

/**
 * `compile_plan.py`'s `_claims_run_command` wrapper rule, copied rather than
 * imported: a whole-value backtick wrapper is decoration and comes off before
 * the value is matched. A value with backticks INSIDE it does not match and
 * rides untouched, exactly as it does there.
 */
const WHOLLY_BACKTICKED = /^`([^`]+)`$/

/**
 * The two shapes, each ending in a sha that is 40 hex characters and no more:
 * the lookahead is why a 41-hex literal is not a pin, and the exact `{40}` is
 * why a 39-hex one is not either. A pin the launcher cannot read is not a pin
 * it guesses at.
 */
const PATH_PIN = /test\s+"\$\(\s*git\s+hash-object\s+([^\s)"|]+)\s*\)"\s*=\s*([0-9a-f]{40})(?![0-9a-fA-F])/g
/**
 * The slice command may not span a `)"`: that boundary closes the substitution
 * of an earlier pin on the same `&&`-chained line, and a capture crossing it
 * would swallow that pin whole — a path pin chained before a slice pin would be
 * read as one slice pin whose command is the two halves joined, handed to
 * `/bin/sh` as one command, hashed as the empty blob, and a plan whose pins all
 * match would be refused. Only that two-character boundary is forbidden, so a
 * command that quotes (`grep "^set -e" f`) or pipes several times still matches.
 */
const SLICE_PIN = /test\s+"\$\(\s*((?:(?!\)")[^\n])+?)\s*\|\s*git\s+hash-object\s+--stdin\s*\)"\s*=\s*([0-9a-f]{40})(?![0-9a-fA-F])/g

/** How a slice pin names itself in a refusal: one line, at most 80 characters. */
const clipCommand = (command) => String(command).replace(/\s+/g, ' ').trim().slice(0, 80)

/** One stale pin, one line — the path (or clipped command), the pinned sha and
 *  what the base really carries, so the operator can see the fix without
 *  running anything. */
const pinRefusalLine = (subject, pinned, base, real) =>
  `launch: plan pin ${subject}: pinned ${pinned} but --base ${base} has ${real ?? 'no such path'}`

/** Every pin the plan text carries, in the order the plan writes them. */
export function planPins (planText) {
  const pins = []
  for (const rawLine of String(planText ?? '').split('\n')) {
    const bullet = PIN_LINE.exec(rawLine.trim())
    if (!bullet) continue
    const value = bullet[1].trim()
    const unwrapped = WHOLLY_BACKTICKED.exec(value)
    const text = unwrapped ? unwrapped[1].trim() : value
    const found = []
    for (const m of text.matchAll(PATH_PIN)) {
      found.push({ at: m.index, kind: 'path', path: m[1], pinned: m[2] })
    }
    for (const m of text.matchAll(SLICE_PIN)) {
      found.push({ at: m.index, kind: 'slice', command: m[1], pinned: m[2] })
    }
    found.sort((a, b) => a.at - b.at)
    pins.push(...found)
  }
  return pins
}

/**
 * The tree at `<base>`, in a throwaway directory, built with git plumbing
 * against a temporary index: `read-tree` fills that index and `checkout-index
 * --prefix` writes the files out. The operator's own index, `HEAD` and working
 * tree are never read and never written — a launch that verifies a slice pin
 * leaves the checkout exactly as a launch that verifies none.
 *
 * Answers `{ dir, tree }`: `dir` is what the caller removes, `tree` is the
 * working directory a slice command runs in.
 */
async function basePinCheckout ({ exec, repoDir, base }) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fleet-pin-'))
  const tree = path.join(dir, 'tree')
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') }
  try {
    await fsp.mkdir(tree, { recursive: true })
    for (const argv of [['read-tree', base], ['checkout-index', '-a', '-f', `--prefix=${tree}${path.sep}`]]) {
      const res = await exec('git', ['-C', repoDir, ...argv], { env })
      if (res.code !== 0) {
        throw new Refusal(`launch: git ${argv.join(' ')} failed (exit ${res.code}):\n${output(res)}`)
      }
    }
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true })
    throw error
  }
  return { dir, tree }
}

/**
 * What a slice pin's command really hashes to at `--base`: the command under
 * `/bin/sh -c` with the extracted tree as its working directory, its stdout
 * hashed with `git hash-object --stdin`. The shell runs outside the exec seam
 * because it is not a lobby verb and not a git read — it is the plan's own
 * command, and it must really run for its sha to mean anything.
 */
async function slicePinSha ({ exec, repoDir, tree, command }) {
  const ran = spawnSync('/bin/sh', ['-c', command], { cwd: tree, maxBuffer: 32 * 1024 * 1024 })
  const res = await exec('git', ['-C', repoDir, 'hash-object', '--stdin'], {
    input: ran.stdout ?? Buffer.alloc(0)
  })
  if (res.code !== 0) {
    throw new Refusal(
      `launch: git hash-object --stdin failed (exit ${res.code}) for plan pin ${clipCommand(command)}:\n${output(res)}`
    )
  }
  return String(res.stdout ?? '').trim()
}

/**
 * Every pin the plan carries, verified against `<base>`, or a `Refusal` (exit
 * 2) carrying one line per stale pin — so two stale pins are two lines and an
 * operator fixes both in one pass. A path absent at `--base` is stale, not
 * skipped: a pin naming a file the base does not have is a pin about some other
 * tree.
 *
 * The base's blob for a path is `git rev-parse <base>:<path>`, which is what
 * `git hash-object <path>` answers in a checkout of `<base>` — no clean filter
 * is configured in this repository. A slice pin needs the files themselves, so
 * it gets a throwaway checkout that is removed in a `finally`, whether this
 * answers or throws.
 */
export async function verifyPlanPins ({ exec, repoDir, base, planText }) {
  const pins = planPins(planText)
  if (pins.length === 0) return
  const checkout = pins.some((pin) => pin.kind === 'slice')
    ? await basePinCheckout({ exec, repoDir, base })
    : null
  const stale = []
  try {
    for (const pin of pins) {
      if (pin.kind === 'path') {
        const res = await git(exec, repoDir, ['rev-parse', `${base}:${pin.path}`])
        const real = res.code === 0 ? String(res.stdout ?? '').trim() : null
        if (real !== pin.pinned) stale.push(pinRefusalLine(pin.path, pin.pinned, base, real))
        continue
      }
      const real = await slicePinSha({ exec, repoDir, tree: checkout.tree, command: pin.command })
      if (real !== pin.pinned) {
        stale.push(pinRefusalLine(clipCommand(pin.command), pin.pinned, base, real))
      }
    }
  } finally {
    if (checkout !== null) await fsp.rm(checkout.dir, { recursive: true, force: true })
  }
  if (stale.length > 0) throw new Refusal(stale.join('\n'))
}

/**
 * The compiler, relative to this file — the plugin's own copy, the one
 * `skills/ultrapowers/SKILL.md` tells the operator to run by hand before a
 * launch. Running it here is what makes "compile with --check --base first"
 * a fact about every launch rather than a step someone remembers (#865).
 */
const COMPILER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ultrapowers', 'scripts', 'compile_plan.py'
)
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
 *  2. `compile_plan.py --check --base <base> <plan>` — the grammar, the gate
 *     record and, since #896, the tree's own facts about the plan (what a
 *     deleted file holds; which files outside a task's Files carry a literal
 *     its clauses pin). A non-zero exit is a refusal carrying the compiler's
 *     text verbatim; the `BASE fact:` lines of a clean compile ride the result
 *     so the launch line prints them.
 *
 * The compiler runs through the exec seam like every other subprocess, so a sim
 * that answers `python3` decides what the compiler said.
 */
export async function verifyPlanCompiles ({ exec, repoDir, base, planPath, planText }) {
  const stamps = [...String(planText).matchAll(BASE_FACTS_STAMP)].map((m) => m[1])
  const stale = [...new Set(stamps.filter((sha) => !base.startsWith(sha)))]
  if (stale.length > 0) {
    throw new Refusal(
      `launch: the plan's **BASE facts:** blocks were generated at ${stale.join(', ')}, not at --base ${base} — ` +
      `re-pin them first: python3 ${PIN_SCRIPT_REL} --write --base ${base} ${planPath}`
    )
  }
  const res = await exec('python3', [COMPILER_PATH, '--check', '--base', base, planPath], { cwd: repoDir })
  if (res.code !== 0) {
    throw new Refusal(
      `launch: compile_plan.py --check --base ${base} refused ${planPath} (exit ${res.code}):\n${output(res)}`
    )
  }
  return String(res.stdout ?? '').split('\n').filter((line) => line.startsWith('BASE fact:'))
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
// 30 minutes of expiry — a run that outlives its bearer dies in the gate.
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
  if (r.status === 0) return { ok: true, out }
  if (/no refresh token in the keychain/.test(out)) return { ok: true, skipped: true, out }
  return { ok: false, out }
}

/**
 * Everything the launcher does, with the exec seam, the clock, the sleep and
 * the name's random half injected. Answers the launched run's record.
 */
export async function launch ({
  argv, exec = defaultExec, config, now = () => new Date(), sleep = defaultSleep, rand,
  refreshCredential = defaultRefreshCredential, verbsPath = VERBS_PATH,
  kata, kataEnvPath = defaultKataEnvPath()
}) {
  const { opts, positional } = parseArgs(argv, { flags: ['json', 'hold'] })

  // ── Local validation. Nothing has been executed at this point, and nothing
  //    will be until every one of these passes. ──────────────────────────────
  const planPath = positional[0]
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
  if (opts.overlap !== undefined && !OVERLAP_VALUES.includes(opts.overlap)) {
    throw new Refusal(`launch: --overlap must be one of ${OVERLAP_VALUES.join('|')}, got ${JSON.stringify(opts.overlap)}`)
  }
  if (opts.tier !== undefined && !TIER_VALUES.includes(opts.tier)) {
    throw new Refusal(`launch: --tier must be one of ${TIER_VALUES.join('|')}, got ${JSON.stringify(opts.tier)}`)
  }
  const implementerEffort = opts['implementer-effort']
  if (implementerEffort !== undefined && !EFFORT_VALUES.includes(implementerEffort)) {
    throw new Refusal(`launch: --implementer-effort must be one of ${EFFORT_VALUES.join('|')}, got ${JSON.stringify(implementerEffort)}`)
  }
  // `--hold` is a bare flag, so `parseArgs` answers `true` for it and a string
  // for any `--hold=<value>` spelling. A string is a refusal here, before the
  // plan is read and before anything is executed: `hold=1` is the only value
  // the sandbox accepts, and a launch that meant to hold must not silently
  // become one that merges.
  if (opts.hold !== undefined && opts.hold !== true) {
    throw new Refusal(`launch: --hold takes no value, got ${JSON.stringify(opts.hold)}`)
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
  // The renderer this fleet reaches, on the same branch the account takes: the
  // injected config's own `render`, else the file's — so an exam that hands
  // `launch` a config never reads the laptop's own. There is no `--render`; an
  // address the whole fleet shares is not a per-launch choice.
  const render = config === undefined || config === null
    ? await fleetConfigRender({ path: opts.config })
    : (config.render ?? null)
  // A malformed `render` is refused here, beside `--account`'s own shape check
  // and before the checkout is read: nothing has been executed yet, so a laptop
  // that cannot spell its renderer has touched neither exe.dev nor the target.
  if (render !== null) {
    if (!RENDER_INTEGRATION_NAME.test(String(render.integration))) {
      throw new Refusal(
        `launch: render.integration must match ${RENDER_INTEGRATION_NAME.source}, got ${JSON.stringify(render.integration ?? null)}`
      )
    }
    if (!RENDER_ACCOUNT_ID.test(String(render.account))) {
      throw new Refusal(
        `launch: render.account must match ${RENDER_ACCOUNT_ID.source}, got ${JSON.stringify(render.account ?? null)}`
      )
    }
  }
  // The hub, on the same branch the account and the renderer take: an injected
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
    let sshHost
    try {
      sshHost = new URL(kataEnv.url).hostname
    } catch {
      sshHost = ''
    }
    if (!sshHost) {
      throw new Refusal(`launch: ${kataEnvPath} names KATA_URL ${JSON.stringify(kataEnv.url)}, not a url with a host — rebuild the hub: ${KATA_HUB_FIX}`)
    }
    hub = makeKataClient({ transport: sshTransport({ sshHost, exec }), actor: 'launch' })
  }
  const kataUrl = hub === null ? null : (hub.url ?? kataEnv?.url ?? null)

  const cpu = String(opts.cpu ?? settings.cpu ?? FLEET_DEFAULTS.cpu)
  const memory = String(opts.memory ?? settings.memory ?? FLEET_DEFAULTS.memory)
  if (!isPositiveInt(cpu)) {
    throw new Refusal(`launch: cpu must be a positive integer, got ${JSON.stringify(cpu)}`)
  }
  const memoryGb = isMemorySize(memory) ? parseMemoryGb(memory) : null
  if (memoryGb === null) {
    throw new Refusal(`launch: memory must be a whole number of gigabytes spelled <int>GB, got ${JSON.stringify(memory)}`)
  }

  const repoDir = path.resolve(String(opts.repo ?? process.cwd()))

  let planText
  try {
    planText = await fsp.readFile(planPath, 'utf8')
  } catch (error) {
    throw new Refusal(`launch: cannot read plan ${planPath}: ${error?.message ?? error}`)
  }
  if (planText.trim() === '') throw new Refusal(`launch: plan ${planPath} is empty`)
  // Before the comment-length probe and before anything is executed: a plan
  // whose declared exam command the sandbox would not read as a runner and its
  // arguments is refused here, not discovered on the VM.
  examCommandShapeOf(planText)
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
    overlap: opts.overlap,
    tier: opts.tier,
    effort: implementerEffort,
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
  // ... and the plan compiles against that same tree, or nothing is launched.
  const baseFacts = await verifyPlanCompiles({ exec, repoDir, base: opts.base, planPath, planText })

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

  // ── The target's test command is, like a hash pin, a fact about BASE the
  //    laptop can read. A tree that matches no rung of the sandbox's ladder is
  //    a run the gate would refuse an hour from now, after a VM, a clone and a
  //    setup script; the ladder is file presence only, so the laptop reads the
  //    same answer off `--base`'s tree before any of that exists.
  if (await detectTestCommand({ exec, repoDir, base: opts.base }) === null) {
    throw new Refusal(
      `launch: ${target} at --base ${opts.base}: ${NO_TEST_CMD_LINE} — ${NO_TEST_CMD_FIX}`
    )
  }

  // One `integrations list --json`, two questions asked of it: the target's
  // GitHub object, and the renderer's — a second read would be a second line on
  // a launch that already refuses on the first answer.
  const integrations = await listIntegrations(exec)
  const githubName = githubIntegrationFor(target)
  if (!integrations.some((row) => row.name === githubName)) {
    throw new Refusal(
      `launch: no ${githubName} integration — the sandbox could still clone a public ${target} from github.com, but could not push its branch or open its PR. Build it once: node fleet/target.mjs ${target}`
    )
  }
  // A renderer the account has no object for is refused here, before the plan
  // is pushed and before any VM exists: the run would come up with an address
  // pointing at a proxy the edge does not have. The fix is the first-run walk,
  // which is where the proxy object is built once per account.
  if (render !== null && !integrations.some((row) => row.name === render.integration)) {
    throw new Refusal(
      `launch: ~/.ultrapowers/fleet.json names render.integration ${render.integration} but integrations list --json has no ${render.integration} — build it once per account: references/first-run.md §render`
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

  // One run must fit the plan's pool. Allocation is over-committable and
  // exe.dev refuses nothing by sum, so this is never a sum over live VMs:
  // contention bounds concurrency, and two plans at once is by design.
  const capacity = await readPlanCapacity(exec)
  if (capacity.maxCpus < Number(cpu)) {
    throw new Refusal(
      `launch: --cpu ${cpu} does not fit the plan — billing plan --json says max_cpus ${capacity.maxCpus}`
    )
  }
  if (capacity.maxMemoryGb < memoryGb) {
    throw new Refusal(
      `launch: --memory ${memory} does not fit the plan — billing plan --json says max_memory_gb ${capacity.maxMemoryGb}`
    )
  }

  // ── The reap. Nothing schedules the janitor, so every launch is where it
  //    runs — before the run number is read, so the fleet a launch joins is
  //    already clear of the VMs of runs that finished over an hour ago.
  //    `settings` is the config loaded above, so the file is read once. A reap
  //    that fails is reported and not fatal: the run being launched is worth
  //    more than the ballast the janitor came for.
  const reaped = []
  let reapError = null
  try {
    const reap = await janitor({ argv: [], exec, config: settings, now })
    for (const action of reap.actions) {
      if (action.kind === 'rm' && action.applied === true) reaped.push(action.vm)
    }
  } catch (error) {
    reapError = String(error?.message ?? error) || 'launch: the reap failed'
  }

  // The N this launch asks for. Without `--run` it is one past the highest the
  // target carries *now*, which another launch can take between this read and
  // the push; the push is where it is settled.
  const firstRun = opts.run ? Number(opts.run) : await highestRunOnTarget(exec, repoDir) + 1
  // Where the sha came from, so the launch line can say whether the operator
  // chose this engine or the launcher read whatever `main` happened to be at.
  const engineSource = opts.engine === undefined ? 'main-tip' : 'pinned'
  const engine = opts.engine ?? await defaultEngineSha(exec)

  const cred = refreshCredential(account)
  if (!cred.ok) {
    throw new LobbyError(`launch: the Claude credential could not be refreshed — no VM was created\n${cred.out}`)
  }

  // ── The plan commit, pushed to the target before the VM exists. Plumbing
  //    against a temporary index, so the operator's index and working tree are
  //    never touched. The push is also what reserves the run number, so the N
  //    the launch ends up with is the one that got through — see `pushPlan`.
  const commands = []
  // The hub's half of each push attempt: the sheets compiled for THIS N, the
  // project and issues filed under it, the record read back — and, on a bump,
  // the project purged before the next N is filed.
  const kataCall = async (method, fn) => {
    try {
      return await fn()
    } catch (error) {
      throw new LobbyError(`launch: kata ${method} failed — ${error?.message ?? error}; no plan branch was pushed and no VM was created`)
    }
  }
  const kataStep = hub === null
    ? null
    : async (n) => {
        const record = await fileRunOnHub({
          hub, call: kataCall, exec, repoDir, planPath, planText, target, base: opts.base, n
        })
        return { text: `${JSON.stringify(record, null, 2)}\n`, record }
      }
  const kataPurge = hub === null
    ? null
    : (record) => kataCall('purgeProject', () => hub.purgeProject(record.project.id, 'run number taken'))
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
    kataPurge
  })
  const run = plan.run
  const planBranch = plan.branch
  const planSha = plan.sha

  // ── The one mutating lobby verb. ──────────────────────────────────────────
  const comment = buildComment({ ...fields, run: String(run), plan: planSha, engine })
  const script = renderSetupScript({ run: String(run), ...readFleetFiles(), render })
  // No `--integration` on the verb: the run's credentials — `claude-max`, the
  // target's object and, when named, the renderer's — reach the box by the
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
    statusUrl: statusUrlFor(vm),
    comment,
    plan: planSha,
    planBranch,
    evidenceBranch: evidenceBranchFor(run),
    integrationBranch: integrationBranchFor(run),
    target,
    base: opts.base,
    engine,
    engineSource,
    // The account is the run's, but never the assignment's: `parse_assignment`
    // on the VM refuses a comment key it does not know, and neither
    // `COMMENT_KEYS` nor `buildComment` spells `account`. It lives here and on
    // the launch line instead.
    account,
    // The hub's record of this run — `{url, project, run, tasks}`, the same
    // object the plan commit carries as `.ultrapowers/kata.json` — or null for
    // a launch that reached no hub.
    kata: plan.kata,
    verbDrift: drift,
    github: githubName,
    // The renderer this run was given, or null for a fleet that names none.
    // Like `account`, it is a fact about the launch and never a comment key:
    // `parse_assignment` on the VM refuses one it does not know, and the box
    // reads its address off /etc/fleet, not off the assignment.
    render,
    cpu,
    memory,
    launchedAt: now().toISOString(),
    commands,
    reaped,
    reapError,
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
 * The sandbox's own words for a target it cannot test, copied verbatim from the
 * `test-command` stage's failure line in `skills/ultrapowers/scripts/ultra_run.py`
 * rather than paraphrased: the operator who reads this on the laptop and the
 * operator who would have read it off a preflight receipt read the same sentence.
 */
export const NO_TEST_CMD_LINE =
  'no test command detected — pass --test-cmd <run-wide suite command>; ' +
  'the gate refuses to run without one'

/**
 * What the laptop can add to that line. The launch line has no `--test-cmd` —
 * `COMMENT_KEYS` in `fleet/lobby.mjs` refuses an assignment key for one — so the
 * fix is not a flag but a commit on the target's default branch, and the rungs
 * are named in the ladder's own order.
 */
export const NO_TEST_CMD_FIX =
  'the launch line carries no --test-cmd; commit one of pytest.ini, ' +
  'pyproject.toml [tool.pytest], package.json scripts.test (or a bun lockfile ' +
  'beside it), Makefile test:, go.mod or Cargo.toml on the target\'s default branch'

/**
 * The sandbox's test-command ladder, run against the tree at `--base` on the
 * laptop. This mirrors `detect_test_cmd` in `skills/ultrapowers/scripts/ultra_run.py`
 * — the launcher spawns no python, so the ladder is mirrored here and
 * `detect_test_cmd` in `ultra_run.py` stays the one the sandbox runs.
 *
 * Only whether a rung matches is decided here: the launcher never runs pytest,
 * never asks about xdist and never spawns python. The rule name is for the
 * refusal's sake, and the command the sandbox derives is the sandbox's own.
 *
 * Every read is of the commit `--base` names and never of the working tree: an
 * untracked `pytest.ini` beside the operator's editor is not a fact about the
 * base, and a base whose `pytest.ini` the operator has deleted locally is still
 * a base the sandbox can test.
 */
export async function detectTestCommand ({ exec, repoDir, base }) {
  const present = async (rel) =>
    (await git(exec, repoDir, ['cat-file', '-e', `${base}:${rel}`])).code === 0
  const read = async (rel) => {
    const res = await git(exec, repoDir, ['show', `${base}:${rel}`])
    return res.code === 0 ? String(res.stdout ?? '') : ''
  }

  if (await present('pytest.ini')) return { rule: 'pytest-ini' }
  if (await present('pyproject.toml') && (await read('pyproject.toml')).includes('[tool.pytest')) {
    return { rule: 'pyproject-pytest' }
  }
  if (await present('package.json')) {
    // A `package.json` that does not parse counts as having no scripts, exactly
    // as the Python rung's `except (JSONDecodeError, AttributeError)` does.
    let scripts = null
    try {
      scripts = JSON.parse(await read('package.json'))?.scripts ?? null
    } catch {
      scripts = null
    }
    const hasTest = Array.isArray(scripts)
      ? scripts.includes('test')
      : (scripts !== null && typeof scripts === 'object' && 'test' in scripts)
    const bunLock = (await present('bun.lock')) || (await present('bun.lockb'))
    if (hasTest) {
      if (await present('pnpm-lock.yaml')) return { rule: 'package-json-pnpm' }
      return { rule: bunLock ? 'package-json-bun' : 'package-json-npm' }
    }
    // A bun lockfile is a rung only beside a `package.json`, never alone.
    if (bunLock) return { rule: 'bun-lockfile' }
  }
  if (await present('Makefile') && /^test\s*:/m.test(await read('Makefile'))) {
    return { rule: 'makefile-test' }
  }
  if (await present('go.mod')) return { rule: 'go-mod' }
  if (await present('Cargo.toml')) return { rule: 'cargo-toml' }
  return null
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
export const PUSH_ATTEMPTS = 3

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
 * At most `PUSH_ATTEMPTS` pushes in all. The refusal is the push's own — the
 * text a single refused push has always carried — with ` after <n> tries` when
 * more than one was made.
 */
async function pushPlan ({
  exec, repoDir, base, run, planText, verdictsText, commands, reread, kataStep = null, kataPurge = null
}) {
  let n = run
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt += 1) {
    const branch = planBranchFor(n)
    // The hub is filed for THIS N before the commit is built, because the
    // project's name and every sheet's landing slug carry the number: a bump
    // purges what was filed and files again for N+1.
    const filed = kataStep === null ? null : await kataStep(n)
    const sha = await commitPlan({
      exec, repoDir, base, run: n, planText, verdictsText, kataText: filed === null ? null : filed.text
    })
    const pushArgv = ['-C', repoDir, 'push', 'origin', `${sha}:refs/heads/${branch}`]
    commands.push(`git ${pushArgv.join(' ')}`)
    const push = await exec('git', pushArgv)
    if (push.code === 0) return { run: n, sha, branch, kata: filed === null ? null : filed.record }

    const refusal = () =>
      new Refusal(
        `launch: git push origin ${sha}:refs/heads/${branch} failed` +
        `${attempt > 1 ? ` after ${attempt} tries` : ''} (exit ${push.code}):\n${output(push)}`
      )
    if (attempt === PUSH_ATTEMPTS || reread === null) throw refusal()
    const highest = await reread()
    if (highest < n) throw refusal()
    n = highest + 1
    if (filed !== null) await kataPurge(filed.record)
  }
}

/**
 * The run, filed on the hub for one run number: the sheets compiled under
 * `--stamp run-<n>` (the compiler's second call of the launch — the first was
 * `--check`), one project `<owner>-<repo>-run-<n>`, one run issue carrying the
 * plan's title, Claim line and Closes numbers, one issue per task in wave
 * order carrying its fact sheet and a `parent` link to the run, one `blocks`
 * link per dependency edge created ON the task that blocks, and then one
 * `getIssue` per task and one for the run — the revisions THOSE answer are the
 * record's, because nothing here assumes which side of a link kata
 * re-revisions. The answer is the `.ultrapowers/kata.json` object, keys in
 * the order the contract spells: `url`, `project`, `run`, `tasks`.
 *
 * Every hub call goes through `call`, which turns a throw into the launch's
 * LobbyError naming the method; the compile is the launch's own refusal.
 */
async function fileRunOnHub ({ hub, call, exec, repoDir, planPath, planText, target, base, n }) {
  const stamp = `run-${n}`
  const compiled = await exec('python3', [COMPILER_PATH, planPath, '--stamp', stamp, '--base', base], { cwd: repoDir })
  if (compiled.code !== 0) {
    throw new Refusal(`launch: compile_plan.py --stamp ${stamp} failed (exit ${compiled.code}):\n${output(compiled)}`)
  }
  let payload
  try {
    payload = JSON.parse(String(compiled.stdout ?? ''))
  } catch (error) {
    throw new Refusal(`launch: compile_plan.py --stamp ${stamp} printed no JSON: ${error?.message ?? error}`)
  }
  const waves = Array.isArray(payload?.launch_waves) ? payload.launch_waves : []
  const edges = Array.isArray(payload?.dag_edges) ? payload.dag_edges : []

  const name = `${target.replace(/\//g, '-')}-run-${n}`
  const project = await call('createProject', () => hub.createProject(name))
  const runIssue = await call('createIssue', () => hub.createIssue(project.id, {
    title: `${stamp}: ${planTitleOf(planText)}`,
    body: planClaimOf(planText),
    metadata: { run: n, target, base, closes: planClosesOf(planText) }
  }))
  const tasks = []
  for (const [index, wave] of waves.entries()) {
    for (const entry of wave) {
      const id = String(entry.id)
      const issue = await call('createIssue', () => hub.createIssue(project.id, {
        title: `task ${id}: ${entry.title ?? ''}`,
        body: '',
        metadata: { task: id, wave: index + 1, factsheet: entry.factsheet },
        links: [{ type: 'parent', to_ref: runIssue.uid }]
      }))
      tasks.push({ id, uid: issue.uid })
    }
  }
  const uidOf = new Map(tasks.map((t) => [t.id, t.uid]))
  for (const edge of edges) {
    const from = uidOf.get(String(edge.from))
    const to = uidOf.get(String(edge.to))
    if (!from || !to) {
      throw new Refusal(`launch: compile_plan.py --stamp ${stamp} names an edge ${edge.from} -> ${edge.to} between tasks it did not list`)
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
    record.tasks[t.id] = { uid: t.uid, revision: read.revision }
  }
  const readRun = await call('getIssue', () => hub.getIssue(runIssue.uid))
  record.run = { uid: runIssue.uid, revision: readRun.revision }
  return record
}

/**
 * An unpinned engine, named as the tip it is. Only the unpinned case is
 * annotated: a pinned sha is one the operator typed, and the assignment comment
 * already prints `engine=<sha>` either way, so there is nothing a `(pinned)`
 * line would tell them. #636 asks for exactly this — that the tip stop passing
 * for a choice — and `fleet/tests/test_launch.mjs` pins a pinned launch's
 * rendering at its four lines, so an annotation there would break it.
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
 * pinned one, which engine it happens to have caught. A launch that reaped
 * nothing prints no reap line at all.
 *
 * `account=` is a rendered line and never part of the comment: the comment is
 * the assignment the VM parses, and a key it does not know kills the run at
 * boot. The two launches that differ only in `--account` build the same
 * comment byte for byte and differ on this line.
 */
export const renderLaunch = (result) => [
  result.runId,
  result.vm,
  result.statusUrl,
  result.comment,
  ...(result.reaped ?? []).map((vm) => `reaped ${vm}`),
  result.account === undefined ? null : `account=${result.account}`,
  result.kata ? `kata=${result.kata.project.name} ${Object.keys(result.kata.tasks).length} tasks` : null,
  result.verbDrift === undefined ? null : `verb-drift: ${result.verbDrift.detail}`,
  engineLine(result),
  ...(result.baseFacts ?? [])
].filter((line) => line !== null).join('\n')

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['json', 'hold'] })
  const result = await launch({ argv })
  process.stdout.write(opts.json ? `${JSON.stringify(result)}\n` : `${renderLaunch(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
