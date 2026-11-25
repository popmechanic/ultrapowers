import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { ENGINE_REPO, Refusal, git, output } from './lobby.mjs'

const CHECKER_REL = 'skills/ultrapowers/scripts/plan_check.py'
const PARSER_REL = 'skills/ultrapowers/scripts/plan_parse.py'

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
    return { dir, scriptPath: checker.filePath, parserPath: parser.filePath }
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true })
    throw error
  }
}

const requireCompilerPath = (compilerPath, which) => {
  if (typeof compilerPath === 'string' && compilerPath !== '') return
  throw new Refusal(
    `launch: ${which} was asked for without a compilerPath — the copy fetched at ` +
    'engine= is the only one a launch runs (fetchCompilerAt)'
  )
}

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
  return { stamp, payload }
}
