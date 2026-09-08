#!/usr/bin/env node
/**
 * fleet/retire.mjs — the one-time sweep: branches into tags, then gone.
 *
 *   node fleet/retire.mjs --target <owner>/<repo> [--dry-run]
 *
 * A run's durable record is its two tags — `ultra/plan/run-<N>` at the plan
 * commit and `ultra/evidence/run-<N>` at the evidence head. Runs from before
 * the tags, and runs that ended `failed`, still carry the pair of branches
 * `ultra/plan-run-<N>` and `ultra/evidence-run-<N>` on their target. This
 * sweep turns each such pair into the two tags, verifies both against the
 * remote, and only then deletes the branches — one run at a time, ascending N,
 * so the highest N is the last thing it touches and an interrupted sweep is
 * always a prefix of a finished one.
 *
 * It runs on the laptop with no clone:
 *
 *   - `git ls-remote <url> …` needs no checkout, and is the ONLY way this tool
 *     asks the remote what it holds. Never `cat-file -e` and never `fetch
 *     <sha>` — git satisfies a local want without asking the server, so both
 *     would answer for objects the remote may not have.
 *   - a tag is created through GitHub's refs API (`gh api -X POST
 *     repos/<t>/git/refs -f ref=… -f sha=…`), because `git push
 *     <sha>:refs/tags/…` requires the object locally and there is no clone.
 *     A POST answering that the reference already exists is an answer, not a
 *     failure: the tag is what was wanted and the tag is there.
 *   - the verification is a second, narrow `git ls-remote --tags` naming the
 *     two tags. Only a listing that shows BOTH at the branch heads earns the
 *     two DELETEs; anything else keeps the run's branches and moves on.
 *
 * The integration branch has a fate of its own, and one read decides it. For a
 * run whose listing carries `refs/heads/ultra/integration-run-<N>`, the pull
 * request with the highest `number` among the rows of `gh api
 * repos/<t>/pulls?state=all&head=<owner>:ultra/integration-run-<N>` decides:
 * `state` `"open"` keeps the branch; `state` `"closed"` with `merged_at` `null`
 * retires it, and the sweep issues one `gh api -X DELETE
 * repos/<t>/git/refs/heads/ultra/integration-run-<N>`; `merged_at` a string
 * keeps it — a merged PR's branch is delete-on-merge's to take, and one still
 * standing is a repository whose setting is off, which is the operator's to see;
 * no rows keeps it. The rows' ORDER is not the rule: run numbers restarted at 1
 * on 2026-09-04, so one head name carries the pull requests of two runs and only
 * the highest number is this run's. The list endpoint's rows carry `merged_at`
 * and no `merged` boolean — `merged` belongs to the single-PR endpoint, which
 * this tool does not read.
 *
 * A `stays` is not a `kept`: it is the correct state, so it joins no array and
 * sets no exit code. The run's line is the whole record of the branch.
 *
 * The name is read a second time, as the `head=` filter of the closed-PR list:
 * GitHub keeps a pull request's head ref name after the branch is deleted, so
 * `head=<owner>:ultra/integration-run-<N>` still finds the run's PR. Every such
 * body that links `/blob/ultra/plan-run-<N>/` or `/tree/ultra/evidence-run-<N>/`
 * is rewritten to the tag paths, so the links survive the deletion — and
 * nothing else in the body is touched.
 *
 * A pair of branches is not on its own a finished run. Before anything names a
 * run's tags or branches, the sweep reads that run's status page — the contents
 * API at `.ultrapowers/runs/<N>/status.json`, on the run's evidence branch — and
 * only a page whose `state` is one of `REAPABLE_STATES` earns the sweep. A live
 * page, an unreadable one, or an open pull request on the run's integration
 * branch prints `run <N>: live (<why>) — skipped` and the sweep moves to the
 * next N. The open-PR read takes that same allowlist posture: only a JSON array
 * is an answer about pull requests, so a non-2xx exit, an error object and a
 * truncated stream alike print `run <N>: unreadable (pulls) — skipped` — never
 * "no open PR", which would let an unread run through to the tags and the
 * deletes. The states are imported from `./janitor.mjs`, which is the one place
 * they are spelled: the test is membership, never a denylist of the live words,
 * so a `state` the boot never writes is skipped rather than swept.
 *
 * Every run the listing carries prints one line as it is decided, on this
 * process's stdout, in ascending N. Stdout is the record: the resolved value
 * carries the same lines under `lines`, but the printing is what a reader of a
 * long sweep actually sees, and it happens before the next run is started.
 *
 * `--dry-run` says what it would do: the one heads-and-tags listing, the status
 * read per candidate, the open-PR read per terminal candidate, one closed-PR
 * read per candidate that would be swept, the fate read per run carrying an
 * integration branch, and no command that creates or deletes anything. A skipped
 * run prints the same line either way, and so does a `stays`.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REAPABLE_STATES } from './janitor.mjs'
import {
  Refusal,
  defaultExec,
  evidenceBranchFor,
  evidenceTagFor,
  integrationBranchFor,
  isSafeTarget,
  output,
  parseArgs,
  parseJson,
  planBranchFor,
  planTagFor,
  runCli,
  runOfBranch
} from './lobby.mjs'

export const USAGE = 'usage: node fleet/retire.mjs --target <owner>/<repo> [--dry-run]'

export const usage = () => USAGE

/** The clone URL a `ls-remote` is given — the only remote name this tool has. */
export const remoteUrlFor = (target) => `https://github.com/${target}.git`

/** The `<sha>\t<ref>` listing as `{ ref: sha }`, peeled `^{}` lines included. */
export function parseLsRemote (stdout) {
  const refs = new Map()
  for (const line of String(stdout ?? '').split('\n')) {
    const [sha, ref] = line.split('\t')
    if (ref === undefined) continue
    const name = ref.trim()
    if (name === '') continue
    refs.set(name, sha.trim())
  }
  return refs
}

/**
 * Every run the listing carries a BRANCH for, ascending, with the refs of the
 * pair and the integration branch. A run named only by tags has nothing left to
 * sweep — its branches are already gone — so it is not a run this tool has
 * anything to say about.
 *
 * `branches` is the PAIR's halves and nothing else: the `lone` line and the
 * resolved `skipped` are about a pair with a half missing, and an integration
 * branch is neither half. It rides under `integration` instead, beside `plan`
 * and `evidence`, so a run carrying only an integration branch is not a lone
 * half of anything.
 */
export function runsOf (refs) {
  const runs = new Map()
  for (const [ref, sha] of refs) {
    if (!ref.startsWith('refs/heads/')) continue
    const run = runOfBranch(ref)
    if (run === null) continue
    const entry = runs.get(run) ?? { run, plan: null, evidence: null, integration: null, branches: [] }
    const name = ref.slice('refs/heads/'.length)
    if (name === integrationBranchFor(run)) {
      entry.integration = sha
    } else {
      if (name === planBranchFor(run)) entry.plan = sha
      else if (name === evidenceBranchFor(run)) entry.evidence = sha
      entry.branches.push(name)
    }
    runs.set(run, entry)
  }
  return [...runs.values()].sort((a, b) => a.run - b.run)
}

/** A POST that says the reference is already there did what was asked. */
const alreadyExists = (res) => /reference already exists/i.test(output(res))

/** One `gh api` read, parsed; null when `gh` answered non-zero. */
async function ghRead (exec, apiPath) {
  const res = await exec('gh', ['api', apiPath])
  return res.code === 0 ? parseJson(res.stdout) : null
}

/**
 * The run's status page, off its evidence branch. The answer is the contents
 * envelope — base64 under `content` — and nothing else is accepted: a bare
 * status document would mean `gh` answered something other than the contents
 * API, and a pair swept on a payload nobody read is a live run deleted. An
 * absent file is exit 1 with `HTTP 404`, which `ghRead` already turns into
 * `null`; every other unreadable shape lands here as `null` too, and `null` is
 * "no page", which is a skip and never a sweep.
 */
async function readStatusPage (exec, target, run) {
  const payload = await ghRead(
    exec,
    `repos/${target}/contents/.ultrapowers/runs/${run}/status.json?ref=${evidenceBranchFor(run)}`
  )
  if (!payload || typeof payload.content !== 'string') return null
  const decoded = parseJson(Buffer.from(payload.content, 'base64').toString('utf8'))
  return decoded && typeof decoded === 'object' ? decoded : null
}

/**
 * Why this run is not the sweep's to take, or `null` when it is. The test is
 * membership in `REAPABLE_STATES` — the terminal words are spelled once, in
 * `janitor.mjs` — so a `state` nobody writes is live, not sweepable.
 */
function liveReason (page) {
  const state = page === null ? null : page.state
  if (typeof state !== 'string') return 'no status page'
  return REAPABLE_STATES.includes(state) ? null : state
}

/** The word the pulls read's unreadable answer is recorded and printed under. */
const PULLS_UNREADABLE = 'unreadable (pulls)'

/**
 * The run's open pull request, if it has one. `head=<owner>:<ref>` matches on
 * the head ref's NAME; `state=open` is the only difference from the closed read
 * below. A run whose integration PR is still open is a run somebody is still
 * looking at, and its branches are what its links resolve through.
 *
 * The answer is `{ unreadable, pull }`, not a bare row, because "no open PR" and
 * "no answer" are different facts and only the first earns the sweep. The list
 * endpoint answers a JSON ARRAY and nothing else, so an array is the whole
 * allowlist — the same posture the status page is read with: a non-2xx exit and
 * a truncated stream both arrive here as `null`, an error body arrives as an
 * object, and every one of those is unreadable. An empty array is still an
 * answer, and it says the run has no open pull request.
 */
async function openPullOf (exec, target, run) {
  const owner = String(target).split('/')[0]
  const payload = await ghRead(
    exec,
    `repos/${target}/pulls?state=open&head=${owner}:${integrationBranchFor(run)}`
  )
  if (!Array.isArray(payload)) return { unreadable: true, pull: null }
  return { unreadable: false, pull: payload.length > 0 ? payload[0] : null }
}

/** Create one tag at one sha through the refs API. */
async function createTag (exec, target, tag, sha) {
  const res = await exec('gh', [
    'api', '-X', 'POST', `repos/${target}/git/refs`,
    '-f', `ref=refs/tags/${tag}`,
    '-f', `sha=${sha}`
  ])
  return res.code === 0 || alreadyExists(res)
}

/**
 * Ask the remote where the two tags are. The answer is authoritative for the
 * deletion: this is the whole of the safety, so it is a fresh listing and never
 * the heads-and-tags one read at the start.
 */
async function readTags (exec, target, run) {
  const res = await exec('git', [
    'ls-remote', '--tags', remoteUrlFor(target),
    `refs/tags/${planTagFor(run)}`, `refs/tags/${evidenceTagFor(run)}`
  ])
  return parseLsRemote(res.stdout)
}

/** Is `tag` on the remote at `sha`? An annotated tag's peel counts too. */
const tagIsAt = (tags, tag, sha) =>
  tags.get(`refs/tags/${tag}`) === sha || tags.get(`refs/tags/${tag}^{}`) === sha

/** Why a listing did not earn the deletes, in the words the `kept` line uses. */
function tagComplaint (tags, tag, sha) {
  const at = tags.get(`refs/tags/${tag}`) ?? tags.get(`refs/tags/${tag}^{}`)
  if (at === undefined) return `${tag} is not on the remote`
  return `${tag} is at ${short(at)}, not ${short(sha)}`
}

const short = (sha) => String(sha ?? '').slice(0, 7)

/** The branch links a PR body carries, rewritten to the tag links. Nothing else. */
export const rewriteBody = (body, run) =>
  String(body ?? '')
    .split(`/blob/${planBranchFor(run)}/`).join(`/blob/${planTagFor(run)}/`)
    .split(`/tree/${evidenceBranchFor(run)}/`).join(`/tree/${evidenceTagFor(run)}/`)

/**
 * The run's closed pull requests whose body links a branch this sweep is about
 * to delete, each with the body it should carry. `head=<owner>:<ref>` matches
 * on the head ref's NAME, which GitHub keeps after the branch is gone, so a
 * merged run's PR and a held measurement PR are both found this way.
 */
async function pullsToPatch (exec, target, run) {
  const owner = String(target).split('/')[0]
  const payload = await ghRead(
    exec,
    `repos/${target}/pulls?state=closed&head=${owner}:${integrationBranchFor(run)}`
  )
  const rows = Array.isArray(payload) ? payload : []
  const patches = []
  for (const row of rows) {
    const number = row?.number
    if (typeof number !== 'number') continue
    const body = typeof row?.body === 'string' ? row.body : ''
    const rewritten = rewriteBody(body, run)
    if (rewritten !== body) patches.push({ number, body: rewritten })
  }
  return patches
}

/** The one PATCH per PR: `body` and nothing else. */
async function patchPull (exec, target, patch) {
  await exec('gh', [
    'api', '-X', 'PATCH', `repos/${target}/pulls/${patch.number}`,
    '-f', `body=${patch.body}`
  ])
}

/**
 * The fate of a run's integration branch, off the one read that decides it:
 * every pull request GitHub has for that head, open and closed alike.
 *
 * The deciding row is the one with the highest `number`, whatever order the rows
 * arrive in — run numbers restarted at 1 on 2026-09-04, so one head name carries
 * the pull requests of two runs and the older run's PR must not decide this one.
 * `merged_at` is the list endpoint's field for it; the `merged` boolean belongs
 * to the single-PR endpoint and is not read here.
 *
 * Answers `{ number, why }` with `why` one of `open`, `merged` or `no pull
 * request` for a branch that stays, and `{ number, deletable: true }` for the
 * one case that retires it: closed, and not merged.
 */
async function integrationFate (exec, target, run) {
  const owner = String(target).split('/')[0]
  const payload = await ghRead(
    exec,
    `repos/${target}/pulls?state=all&head=${owner}:${integrationBranchFor(run)}`
  )
  const rows = Array.isArray(payload) ? payload : []
  let deciding = null
  for (const row of rows) {
    if (typeof row?.number !== 'number') continue
    if (deciding === null || row.number > deciding.number) deciding = row
  }
  if (deciding === null) return { number: null, why: 'no pull request', deletable: false }
  if (typeof deciding.merged_at === 'string') {
    return { number: deciding.number, why: 'merged', deletable: false }
  }
  if (deciding.state === 'closed') return { number: deciding.number, deletable: true }
  return { number: deciding.number, why: 'open', deletable: false }
}

/**
 * The integration branch's segment of the run's line, and the DELETE that earns
 * the deletable one. A `stays` costs nothing but the read.
 */
async function integrationSegment (exec, target, run, dryRun) {
  const branch = integrationBranchFor(run)
  const fate = await integrationFate(exec, target, run)
  if (!fate.deletable) {
    return fate.number === null
      ? `${branch} stays — no pull request`
      : `${branch} stays — PR #${fate.number} ${fate.why}`
  }
  const because = `PR #${fate.number} closed, not merged`
  if (dryRun) return `would delete ${branch} — ${because}`
  await exec('gh', ['api', '-X', 'DELETE', `repos/${target}/git/refs/heads/${branch}`])
  return `${branch} deleted — ${because}`
}

/**
 * The sweep. `exec` is the seam every `git` and every `gh` goes through; the
 * lines go to stdout as each run is decided, and the resolved value carries
 * them too.
 */
export async function retire ({ argv = [], exec = defaultExec } = {}) {
  const { opts } = parseArgs(argv, { flags: ['dry-run'] })
  const dryRun = opts['dry-run'] === true
  const target = opts.target
  if (!isSafeTarget(target)) {
    throw new Refusal(
      `retire: --target must be <owner>/<repo>, got ${JSON.stringify(target ?? null)}\n${usage()}`
    )
  }

  // ── One listing, for the whole target. Nothing lists the heads again. ─────
  const listing = await exec('git', [
    'ls-remote', remoteUrlFor(target), 'refs/heads/ultra/*', 'refs/tags/ultra/*'
  ])
  const refs = parseLsRemote(listing.stdout)

  const retired = []
  const kept = []
  const skipped = []
  const live = []
  const lines = []
  const say = (line) => {
    lines.push(line)
    process.stdout.write(`${line}\n`)
  }

  /**
   * The pair's segment of a run's line, or `null` when the listing carried no
   * half of a pair for that run — an integration branch on its own is nobody's
   * lone half, and the run's line is then its integration segment alone.
   */
  const sweepPair = async (entry) => {
    const { run, plan, evidence } = entry
    if (entry.branches.length === 0) return null

    // A half pair is not a record: tagging one side would claim the run's
    // other side was recorded somewhere, and it is not.
    if (plan === null || evidence === null) {
      const lone = entry.branches.join(', ')
      skipped.push(...entry.branches)
      return `skip — lone ${lone}`
    }

    // The gate, and the first thing that names this run's tags or branches: a
    // pair whose page is not terminal, or whose integration PR is still open,
    // is a run in flight. Skipping it is the same decision under `--dry-run`
    // and without it — the sweep never asks what it would do to a run it is not
    // going to touch.
    const pageWhy = liveReason(await readStatusPage(exec, target, run))
    if (pageWhy !== null) {
      live.push({ run, why: pageWhy })
      return `live (${pageWhy}) — skipped`
    }
    // The second read of the gate, and the same posture: an answer that is not a
    // list of pull requests is no answer at all. Its line names the read rather
    // than the run's state — the sweep did not learn one — but the run joins
    // `live` all the same, because `live` is what the sweep declined to touch.
    const open = await openPullOf(exec, target, run)
    if (open.unreadable) {
      live.push({ run, why: PULLS_UNREADABLE })
      return `${PULLS_UNREADABLE} — skipped`
    }
    if (open.pull !== null) {
      const why = `PR #${open.pull.number} open`
      live.push({ run, why })
      return `live (${why}) — skipped`
    }

    if (dryRun) {
      const patches = await pullsToPatch(exec, target, run)
      return (
        `would retire ${planTagFor(run)}@${short(plan)} ` +
        `${evidenceTagFor(run)}@${short(evidence)}, delete 2 branches, ` +
        `patch ${patches.length} PR(s)`
      )
    }

    await createTag(exec, target, planTagFor(run), plan)
    await createTag(exec, target, evidenceTagFor(run), evidence)

    const tags = await readTags(exec, target, run)
    const planOk = tagIsAt(tags, planTagFor(run), plan)
    const evidenceOk = tagIsAt(tags, evidenceTagFor(run), evidence)
    if (!planOk || !evidenceOk) {
      // The branches stay, so their links still resolve and nothing is
      // rewritten. The sweep continues: one unverified run is not the target.
      const complaint = !planOk
        ? tagComplaint(tags, planTagFor(run), plan)
        : tagComplaint(tags, evidenceTagFor(run), evidence)
      kept.push(run)
      return `kept — ${complaint}`
    }

    await exec('gh', ['api', '-X', 'DELETE', `repos/${target}/git/refs/heads/${planBranchFor(run)}`])
    await exec('gh', ['api', '-X', 'DELETE', `repos/${target}/git/refs/heads/${evidenceBranchFor(run)}`])

    const patches = await pullsToPatch(exec, target, run)
    for (const patch of patches) await patchPull(exec, target, patch)

    retired.push(run)
    return (
      `retired ${planTagFor(run)}@${short(plan)} ` +
      `${evidenceTagFor(run)}@${short(evidence)}, 2 branches deleted, ` +
      `${patches.length} PR(s) patched`
    )
  }

  for (const entry of runsOf(refs)) {
    // The pair first, whole and in BASE's order, then the integration branch:
    // its fate read is a second, separate read, issued only for a run whose
    // listing carried the integration head, and its DELETE is the last command
    // the run draws.
    const segments = []
    const pair = await sweepPair(entry)
    if (pair !== null) segments.push(pair)
    if (entry.integration !== null) {
      segments.push(await integrationSegment(exec, target, entry.run, dryRun))
    }
    if (segments.length > 0) say(`run ${entry.run}: ${segments.join('; ')}`)
  }

  // A kept run is not a refusal and not a thrown failure — the sweep ran and
  // did what it could — but it is not a clean sweep either, so it is exit 1.
  if (kept.length > 0) process.exitCode = 1

  return { target, dryRun, retired, kept, skipped, live, lines }
}

async function main (argv) {
  await retire({ argv })
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
