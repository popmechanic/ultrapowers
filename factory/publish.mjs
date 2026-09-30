#!/usr/bin/env node
/**
 * factory/publish.mjs — a run's publish, once its engine has exited (#1441): the pull
 * request, the self-merge (catching the run up to a moved main), and the deploy the merge
 * earned. The boot calls it once, in plain sequence after the engine unit and never inside
 * it — publish is shell, not a seam (run-186 died on a scripted publish stage inside the
 * engine). GitHub is reached with `curl` and the target with `git`, both off PATH, so the
 * boot sims' stubs answer it exactly as they answered the shell it replaced.
 *
 *   node factory/publish.mjs --engine-exit <code> --hold 0|1 --run-id <run-N> --target-repo <o/r>
 *     --target-dir <dir> --branch <ultra/integration-run-N> --base-sha <sha> --plan <plan.md>
 *     --plan-json <parse> --run-dir <dir> --evidence-dir <runs/<slug>/<N> in the clone>
 *     --evidence-url <url> --github-host <host> --anthropic-url <url> --typesafe-url <url> --log <boot log>
 *
 * It appends its rows to the evidence folder's `events.jsonl`, writes `publish.json` and the
 * three publish logs beside it, logs to the boot log, and prints five lines for the boot:
 * the run's state, its phase, the PR url, the PR author and the merge sha (either may be
 * empty). A POST the API refused prints the reply's first 2000 characters and exits 1, which
 * the boot fails the run on.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPrBody } from './record.mjs'

const POLICY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'policy.json')
const CATCHUP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'flock', 'catchup.mjs')
const CLOUDFLARE_API_BASE_URL = 'https://cloudflare.int.exe.xyz/client/v4'

/** `publish.self_merge` and `publish.probe` off `policyPath`. A missing file, unparseable
 *  JSON, or a cell that is not an object carrying an `enabled` key reads as disabled, never
 *  a default a broken read falls into; the bounds' defaults live here alone. */
export function publishPolicy (policyPath = POLICY) {
  let doc
  try { doc = JSON.parse(fs.readFileSync(policyPath, 'utf8')) } catch { doc = null }
  const cell = (key) => {
    const c = doc && typeof doc === 'object' && doc.publish && typeof doc.publish === 'object' ? doc.publish[key] : undefined
    return c && typeof c === 'object' && !Array.isArray(c) && Object.hasOwn(c, 'enabled') ? c : null
  }
  const int = (v, d) => (v === undefined ? d : Math.trunc(Number(v)))
  const sm = cell('self_merge')
  const probe = cell('probe')
  return {
    selfMerge: { enabled: Boolean(sm?.enabled), maxRefolds: int(sm?.max_refolds, 3), waitSeconds: int(sm?.mergeable_wait_seconds, 120) },
    probe: { enabled: Boolean(probe?.enabled), timeoutSeconds: int(probe?.timeout_seconds, 600) }
  }
}

const json = (text) => { try { return JSON.parse(text) } catch { return null } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const nowSeconds = () => Math.floor(Date.now() / 1000)

/** The plan's first `# ` heading, or empty. */
const planTitle = (planPath) =>
  (fs.readFileSync(planPath, 'utf8').split('\n').find((l) => l.startsWith('# ')) ?? '').slice(2)

export async function publish (o) {
  const events = path.join(o.evidenceDir, 'events.jsonl')
  const log = (line) => {
    const stamped = `${new Date().toISOString()} ${line}\n`
    fs.appendFileSync(o.log, stamped)
    process.stderr.write(stamped)
  }
  const row = (kind, fields) => {
    fs.mkdirSync(o.evidenceDir, { recursive: true })
    fs.appendFileSync(events, JSON.stringify({ ts: new Date().toISOString(), kind, ...fields }) + '\n')
  }
  const git = (args, { quiet = false } = {}) =>
    spawnSync('git', ['-C', o.targetDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'] })
  // One request, one answer: the status rides as the answer's last line (`-w`), and a curl that
  // could not connect answers no code at all. No `authorization` header — the edge injects it.
  const api = (method, route, payload) => {
    const argv = ['-sS']
    if (method !== 'GET') argv.push('-X', method)
    argv.push(`https://${o.githubHost}/api/v3/repos/${o.targetRepo}${route}`)
    if (payload !== undefined) argv.push('-H', 'content-type: application/json', '-d', JSON.stringify(payload))
    argv.push('-w', '\\n%{http_code}')
    const out = spawnSync('curl', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).stdout ?? ''
    const cut = out.lastIndexOf('\n')
    return { code: out.slice(cut + 1), reply: cut < 0 ? '' : out.slice(0, cut) }
  }
  const title = planTitle(o.plan)
  const policy = publishPolicy()

  // The target's default branch as the remote advertised it: a PR against a guessed `main` on a
  // `master` repo is refused, or worse taken.
  const ref = (git(['symbolic-ref', 'refs/remotes/origin/HEAD'], { quiet: true }).stdout ?? '').trim()
  if (!/^refs\/remotes\/origin\/./.test(ref)) {
    return { refusal: "publish: cannot read the target's default branch from refs/remotes/origin/HEAD" }
  }
  const base = ref.slice('refs/remotes/origin/'.length)

  // A run the engine did not finish green still gets its PR — as a DRAFT, since the merge is the operator's act.
  const draft = o.engineExit !== 0
  const body = renderPrBody(o.plan, path.join(o.runDir, 'events.jsonl'), o.evidenceUrl,
    path.join(o.runDir, 'provenance.json'), o.planJson).replace(/\n+$/, '')
  const opened = api('POST', '/pulls', { title: `fleet ${o.runId}: ${title}`, head: o.branch, base, body, draft })
  if (!/^2\d\d$/.test(opened.code)) {
    log(`publish: POST /repos/${o.targetRepo}/pulls answered ${opened.code || '<nothing>'}`)
    return { refusal: opened.reply.slice(0, 2000) }
  }
  const pr = json(opened.reply) ?? {}
  const prUrl = typeof pr.html_url === 'string' ? pr.html_url : ''
  const prAuthor = typeof pr.user?.login === 'string' ? pr.user.login : ''
  const number = Number.isInteger(pr.number) ? pr.number : null
  log(`publish: ${prUrl} (base ${base}, draft ${draft}, author ${prAuthor || '<unknown>'})`)
  row('publish:pr', { url: prUrl, number, draft })

  let merged = ''
  let mergePhase = ''

  // M2: on a moved default branch, hand the target to the Flock's catch-up and, once it says every
  // exam ran green there, force-push the target's new HEAD over the run's own branch — any other
  // exit leaves the target untouched and sets the merge phase.
  const refold = (runBase, onto) => {
    const env = {
      ...process.env,
      ANTHROPIC_BASE_URL: o.anthropicUrl,
      TYPESAFE_BASE_URL: o.typesafeUrl,
      CLAUDE_CODE_OAUTH_TOKEN: 'placeholder',
      ULTRAPOWERS_FLEET_RUN: o.runId
    }
    delete env.CLAUDE_CONFIG_DIR
    const r = spawnSync('node', [CATCHUP, '--plan', o.plan, '--plan-json', o.planJson, '--target', o.targetDir,
      '--base', runBase, '--onto', onto, '--run-dir', o.runDir], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'inherit'] })
    const rc = r.status ?? 1
    if (rc !== 0) {
      const last = (r.stdout ?? '').trimEnd().split('\n').pop()
      const reason = json(last)?.reason
      mergePhase = `merge: re-fold refused (${typeof reason === 'string' && reason ? reason : `exit ${rc}`})`
      log(`merge: re-fold onto ${onto} exited ${rc} — ${mergePhase}`)
      row('refold', { ok: false, reason: mergePhase })
      return false
    }
    git(['fetch', 'origin', `refs/heads/${o.branch}`], { quiet: true })
    if (git(['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${o.branch}`]).status !== 0) {
      mergePhase = 'merge: force-with-lease push of the re-folded head was refused'
      log(`merge: ${mergePhase}`)
      row('refold', { ok: false, reason: mergePhase })
      return false
    }
    log(`merge: re-folded onto ${onto} and pushed ${o.branch}`)
    // the catch-up remapped provenance.json to the pushed commit's lines: copy that file alone,
    // since the evidence events.jsonl holds this module's rows (publish:pr, merge) the engine's copy lacks
    const prov = path.join(o.runDir, 'provenance.json')
    if (fs.existsSync(prov)) fs.copyFileSync(prov, path.join(o.evidenceDir, 'provenance.json'))
    row('refold', { ok: true })
    return true
  }

  // M1–M4: before every send, and again after every 405/409 refusal, re-fetch the default branch and
  // re-fold onto it if it moved (M2); wait out a `null` mergeable, GitHub's answer for a few seconds
  // after a push while it recomputes (M3); then PUT the squash merge, titled off the plan's own first
  // heading, the SHA this clone actually pushed. A 405/409 repeats, up to `max_refolds` merge requests
  // in all; anything else parks.
  const selfMerge = async () => {
    const { enabled, maxRefolds, waitSeconds } = policy.selfMerge
    if (!enabled) return
    let curBase = o.baseSha
    for (let attempts = 0; attempts < maxRefolds;) {
      const fetched = git(['fetch', 'origin', `refs/heads/${base}`], { quiet: true })
      const tip = fetched.status === 0 ? (git(['rev-parse', 'FETCH_HEAD'], { quiet: true }).stdout ?? '').trim() : ''
      if (tip && tip !== curBase) {
        if (!refold(curBase, tip)) return
        curBase = tip
      }
      // GitHub answers a `mergeable` it computed for whatever head it last processed: right after a
      // refold's force-push that is the old head (runs 264/265: 405, then 200), so only a reply
      // naming the head this clone pushed counts; any other head is waited out like a null.
      const headSha = (git(['rev-parse', 'HEAD']).stdout ?? '').trim()
      const start = nowSeconds()
      for (;;) {
        const got = api('GET', `/pulls/${number}`)
        if (got.code === '200') {
          const doc = json(got.reply)
          if (doc?.mergeable != null && doc?.head?.sha === headSha) break
        }
        if (nowSeconds() - start >= waitSeconds) { mergePhase = 'merge: mergeable wait timed out'; return }
        await sleep(1000)
      }
      attempts += 1
      const put = api('PUT', `/pulls/${number}/merge`,
        { merge_method: 'squash', commit_title: `fleet ${o.runId}: ${title} (#${number})`, sha: headSha })
      const answer = json(put.reply)
      row('merge', { code: /^\d+$/.test(put.code) ? Number(put.code) : null, message: answer?.message == null ? '' : String(answer.message) })
      if (/^2\d\d$/.test(put.code)) {
        merged = typeof answer?.sha === 'string' && answer.sha ? answer.sha : (git(['rev-parse', 'HEAD']).stdout ?? '').trim()
        log(`merge: PUT /pulls/${number}/merge answered ${put.code} — merged as ${merged}`)
        return
      }
      if (put.code === '405' || put.code === '409') {
        log(`merge: PUT /pulls/${number}/merge answered ${put.code} — re-folding and trying again`)
        continue
      }
      mergePhase = `merge: PUT /pulls/${number}/merge answered ${put.code || '<none>'}`
      log(`merge: ${mergePhase}`)
      return
    }
    mergePhase = `merge: refused after ${maxRefolds} refold attempt(s)`
    log(`merge: ${mergePhase}`)
  }

  // #835: the deploy the self-merge earned, read live, rolled back once on red. The plan's
  // `**Publish:**`/`**Verify:**`/`**Rollback:**` commands are the run's one parse's `publish` object,
  // never grepped off the plan text. An empty answer — the plan named no `**Publish:**` line, or
  // `publish.probe.enabled` is off — keeps the plain "the pull request was merged" phase; either way
  // the probe is never a failure of the run.
  const publishProbe = () => {
    const cmds = json(fs.readFileSync(o.planJson, 'utf8'))?.publish
    const cmd = (k) => (cmds && typeof cmds === 'object' && typeof cmds[k] === 'string' ? cmds[k] : '')
    const deployCmd = cmd('deploy')
    if (!deployCmd || !policy.probe.enabled) return ''
    const seconds = policy.probe.timeoutSeconds
    fs.mkdirSync(o.evidenceDir, { recursive: true })
    fs.mkdirSync(o.runDir, { recursive: true })
    // One command in the target under the budget (exit 124 on the budget, as coreutils' `timeout`),
    // its output kept as the last 4000 bytes in `publish-<verb>.log`: the Cloudflare edge's address and
    // a placeholder token in its environment (the edge injects the credential), and ULTRA_PUBLISH_URL
    // when `url` names the deployed app. Answers the exit, the milliseconds and the raw output.
    const run = (verb, command, url) => {
      const raw = path.join(o.runDir, `.publish-${verb}-raw.log`)
      const fd = fs.openSync(raw, 'w')
      const start = Date.now()
      const r = spawnSync('bash', ['-lc', command], {
        cwd: o.targetDir,
        stdio: ['ignore', fd, fd],
        timeout: seconds * 1000,
        env: { ...process.env, CLOUDFLARE_API_BASE_URL, CLOUDFLARE_API_TOKEN: 'placeholder', ...(url ? { ULTRA_PUBLISH_URL: url } : {}) }
      })
      const ms = Date.now() - start
      fs.closeSync(fd)
      const bytes = fs.readFileSync(raw)
      fs.rmSync(raw, { force: true })
      fs.writeFileSync(path.join(o.evidenceDir, `publish-${verb}.log`), bytes.subarray(Math.max(0, bytes.length - 4000)))
      const exit = r.error?.code === 'ETIMEDOUT' ? 124 : r.status ?? 128 + (os.constants.signals[r.signal] ?? 0)
      return { exit, ms, text: bytes.toString('utf8') }
    }
    const record = ({ url, published = false, deploy, verify = null, rollback = null }) => fs.writeFileSync(
      path.join(o.evidenceDir, 'publish.json'), JSON.stringify({ url, published, deploy, verify, rollback }) + '\n')

    const d = run('deploy', deployCmd)
    const url = (d.text.match(/https:\/\/[A-Za-z0-9.-]*\.workers\.dev/) ?? [null])[0]
    row('publish:deploy', { cmd: deployCmd, exit: d.exit, ms: d.ms, url })
    const deploy = { cmd: deployCmd, exit: d.exit, ms: d.ms }
    if (d.exit !== 0 || !url) {
      record({ url, deploy })
      return 'the pull request was merged; the deploy failed'
    }

    const verifyCmd = cmd('verify')
    const v = run('verify', verifyCmd, url)
    row('publish:verify', { cmd: verifyCmd, exit: v.exit, ms: v.ms, url })
    const verify = { cmd: verifyCmd, exit: v.exit, ms: v.ms }
    if (v.exit === 0) {
      record({ url, published: true, deploy, verify })
      return 'the pull request was merged and the app is published'
    }

    const rollbackCmd = cmd('rollback')
    if (!rollbackCmd) {
      record({ url, deploy, verify })
      return 'the pull request was merged; the live check was red and no rollback was named'
    }
    const b = run('rollback', rollbackCmd)
    row('publish:rollback', { cmd: rollbackCmd, exit: b.exit })
    record({ url, deploy, verify, rollback: { cmd: rollbackCmd, exit: b.exit } })
    return 'the pull request was merged; the live check was red and the deploy was rolled back'
  }

  let state = o.engineExit === 0 ? 'done' : 'parked'
  if (o.engineExit === 0 && !o.hold && number !== null) await selfMerge()
  let phase
  if (merged) {
    phase = publishProbe() || 'the pull request was merged'
  } else if (mergePhase) {
    phase = mergePhase
    state = 'parked'
  } else {
    phase = 'the pull request is open'
  }
  return { state, phase, prUrl, prAuthor, merged }
}

const FLAGS = ['engine-exit', 'hold', 'run-id', 'target-repo', 'target-dir', 'branch', 'base-sha', 'plan', 'plan-json',
  'run-dir', 'evidence-dir', 'evidence-url', 'github-host', 'anthropic-url', 'typesafe-url', 'log']

async function main (argv) {
  const o = {}
  for (const flag of FLAGS) {
    const at = argv.indexOf(`--${flag}`)
    if (at < 0 || at + 1 >= argv.length) {
      process.stderr.write(`publish: --${flag} is required\n`)
      return 2
    }
    o[flag.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[at + 1]
  }
  o.engineExit = Number(o.engineExit)
  o.hold = o.hold === '1'
  const out = await publish(o)
  if (out.refusal !== undefined) {
    process.stdout.write(out.refusal + '\n')
    return 1
  }
  process.stdout.write([out.state, out.phase, out.prUrl, out.prAuthor, out.merged].join('\n') + '\n')
  return 0
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
