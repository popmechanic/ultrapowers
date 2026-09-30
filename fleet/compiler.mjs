/**
 * fleet/compiler.mjs — fetching and running the plan checker and parser at the
 * engine sha, for the launch. Moved out of `launch.mjs` (#1277).
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { ENGINE_REPO, Refusal, git, output } from './lobby.mjs'

/**
 * The check's and the parser's paths inside the engine tree, at every sha —
 * never resolved against this checkout. The copies a launch runs are the ones
 * it fetches at `engine=`; see `fetchCompilerAt`. `plan_parse.py` is the file
 * the sandbox runs, and `plan_check.py` imports it from its own directory, so
 * the two are fetched together and land side by side. For a stories-v1 plan
 * both of them import `stories_parse.py`, `stories_check.py` and
 * `probe_block.py` (`STORIES_RELS`, below) from that same directory, so those
 * three are fetched beside the first two only when the caller says `stories:
 * true` — a claims-v1 launch never asks for them.
 */
const CHECKER_REL = 'skills/ultrapowers/scripts/plan_check.py'
const PARSER_REL = 'skills/ultrapowers/scripts/plan_parse.py'

/**
 * `plan_check.py` and `plan_parse.py` import these three for a stories-v1
 * plan (the stories grammar's own parse and check, and the `Run:` probe
 * reader), so all five are fetched beside each other or a stories-v1 launch
 * would compile against a directory missing an import.
 */
const STORIES_RELS = ['stories_parse.py', 'stories_check.py', 'probe_block.py']
  .map((f) => `skills/ultrapowers/scripts/${f}`)

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
 * Two files are fetched for every plan, and three more (`STORIES_RELS`) when
 * the caller passes `stories: true` — the plan's own grammar line, read by
 * the caller before this is called — since `plan_check.py`/`plan_parse.py`
 * import them only for that grammar; all five import only the standard
 * library and each other. Copies under `os.tmpdir()`, at their real depth,
 * read the plan, its gate record and the `--base` tree exactly as the cache
 * copies do.
 *
 * Answers `{ dir, scriptPath, parserPath, source }`: `dir` is what the caller
 * removes, `scriptPath` is `plan_check.py`, `parserPath` is `plan_parse.py`,
 * `source` is `git-show` or `gh-api` (the check's).
 */
export async function fetchCompilerAt ({ exec, engine, pluginRoot, stories = false }) {
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
    if (stories) for (const rel of STORIES_RELS) await fetchOne(rel)
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

/**
 * The plan compiles against the tree at `--base`, or it is a refusal — before
 * any lobby verb, any push, any `ls-remote`. The read is
 * `plan_check.py --base <base> <plan>` — the gate record and what the tree
 * at BASE says about the plan. A non-zero exit is a refusal carrying the compiler's
 * text verbatim — including a `STALE fact:` line for a Stale-if predicate
 * that holds at BASE, which is what the operator reads on the laptop; the
 * `STALE fact:`, `GREEN-AT-BASE fact:`
 * and `AUTHORING fact:` lines of a clean check ride the result so the launch line prints them,
 * in the order the compiler printed them (a `STALE fact:` there is the
 * advisory kind: a predicate the compiler could not read at BASE, never a
 * refusal; a `GREEN-AT-BASE fact:` line is a Proof `Run:` line the compiler
 * found already green at BASE, plus the one line totalling what those runs
 * cost — this release every one of them is a fact and the compile still
 * exits 0, so dropping them on the laptop is the only way the operator
 * could fail to read them; the `AUTHORING fact:` line is what the plan's
 * authoring cost, or `AUTHORING fact: none recorded` when the gate record
 * carries none).
 *
 * The compiler runs through the exec seam like every other subprocess, so a sim
 * that answers `python3` decides what the compiler said. `compilerPath` is the
 * file `fetchCompilerAt` wrote and is required: there is no default, because a
 * default is how a launch ends up compiling with a compiler the sandbox does
 * not have.
 */
export async function verifyPlanCompiles ({ exec, repoDir, base, planPath, planText, compilerPath }) {
  requireCompilerPath(compilerPath, 'plan_check.py')
  const res = await exec('python3', [compilerPath, '--base', base, '--repo', repoDir, planPath], { cwd: repoDir })
  if (res.code !== 0) {
    throw new Refusal(
      `launch: plan_check.py --base ${base} refused ${planPath} (exit ${res.code}):\n${output(res)}`
    )
  }
  return String(res.stdout ?? '').split('\n').filter(
    (line) =>
      line.startsWith('STALE fact:') ||
      line.startsWith('GREEN-AT-BASE fact:') ||
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
