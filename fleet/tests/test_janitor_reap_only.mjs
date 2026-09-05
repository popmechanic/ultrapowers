/**
 * fleet/tests/test_janitor_reap_only.mjs — the janitor keeps only the reap.
 *
 * #660 item (3): the janitor removes the VMs of runs an hour past done and
 * nothing else. The laptop-side arming of #655 is gone — a `done` run's pull
 * request is the sandbox's to merge, not the janitor's — so the janitor's whole
 * `gh` surface is `gh api` reads, and every action it records is an `rm`.
 *
 * Every external call goes through the same `exec(cmd, argv)` seam the rest of
 * the fleet uses; this exam cans `ssh` and `gh` and reads `exec.calls` for what
 * was issued, so no network is touched. The rig is `test_janitor.mjs`'s:
 * `makeExec` with `sshRule('ls ', …)` answering `vmsPayload(rows)`,
 * `sshRule('rm ', answer(''))`, and `cmdRule('gh', 'api', …)` answering the
 * contents envelope for each run's status page.
 *
 * What is pinned, clause by clause:
 *
 *   (a) [M1] over a fleet of two `done` runs that each carry a `pr` URL, one
 *       updated two hours ago and one ten minutes ago: no `gh pr` command of any
 *       kind is issued, every `gh` call is two argv words — `api` and a path
 *       beginning `repos/` — so none carries `-X`, `--method`, `-f`, `-F`,
 *       `--input` or any other flag, every recorded action has `kind` `rm`, the
 *       mutating lobby verbs are exactly one `rm <old vm> --json`, the young
 *       run's VM is in no action, `--dry-run` over the same fleet issues no
 *       `rm`, and the module exports no `PR_VIEW_JSON`;
 *   (b) [M2] `fleet/tests/test_janitor_automerge.mjs` — the sim of the deleted
 *       arming — is absent;
 *   (m4) [M4] the RUNBOOK no longer says `arms auto-merge`, the RUNBOOK and
 *       SKILL.md both say the launcher runs the janitor before every launch and
 *       that nothing schedules it, and the word `cron` is in none of the three
 *       operator documents;
 *   (d) the sentinel [M1].
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { evidenceTagFor } from '../lobby.mjs'
import * as janitorModule from '../janitor.mjs'
import { janitor, renderJanitor } from '../janitor.mjs'
import {
  answer, cmdRule, makeExec, sshRule, vmRow, vmsPayload
} from './_lobby_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')

const NOW = new Date('2026-09-03T12:00:00.000Z')
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString()
const hoursAgo = (h) => minutesAgo(h * 60)

const TARGET = 'acme/widgets'
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
/** The config file's whole surface: two keys, `cpu` and `memory`. */
const CONFIG = { cpu: '8', memory: '16GB' }

const vm = (n) => `fleet-r${n}-2609030900-a1b2`
const comment = (run) =>
  `run=${run} plan=${SHA} target=${TARGET} base=${SHA} engine=${SHA}`
/** One `ls` row for run N, carrying the assignment comment the launcher set. */
const row = (n) => vmRow(vm(n), { comment: comment(n) })

/** The PR URL the contract's `status.json` carries under `"pr"`. */
const prUrl = (n) => `https://github.com/${TARGET}/pull/${n}`

/** A status page, as the contract shapes it — `done`, with its pull request. */
const donePage = (run, updatedAt) => ({
  run,
  state: 'done',
  phase: 'x',
  pr: prUrl(run),
  branch: `ultra/integration-run-${run}`,
  vm: vm(run),
  updatedAt
})

// ── The seam ────────────────────────────────────────────────────────────────

const evidencePath = (run) =>
  `repos/${TARGET}/contents/.ultrapowers/runs/${run}/status.json?ref=${evidenceTagFor(run)}`

/** What `gh api` prints for an absent file: exit 1, `HTTP 404` on stderr. */
const NOT_FOUND = answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })

/** The contents envelope: the status page, base64, under `content`. */
const envelope = (page) => answer({
  content: Buffer.from(JSON.stringify(page), 'utf8').toString('base64'),
  encoding: 'base64'
})

/** `gh api <path>` answers the pages a leg canned; every other path is a 404. */
const ghApiRule = (pages) => cmdRule('gh', 'api', (cmd, argv) => {
  const p = argv.find((a) => typeof a === 'string' && a.startsWith('repos/'))
  return p !== undefined && Object.hasOwn(pages, p) ? envelope(pages[p]) : NOT_FOUND
})

/** `ls '<pattern>'` answers the rows whose names match — what the server does. */
const lsRules = (fleet) => [
  sshRule('ls ', (cmd, argv) => {
    const pattern = /^ls '([^']+)'/.exec(argv[1])[1]
    const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
    return vmsPayload(fleet.filter((r) => re.test(r.vm_name)))
  }),
  sshRule('rm ', answer(''))
]

// ── Readers over the recording seam ─────────────────────────────────────────

/** The argv of every `gh` call, in order. */
const ghArgvs = (exec) => exec.calls.filter((c) => c.cmd === 'gh').map((c) => c.argv)
/** Every `gh` call whose first argv word is `pr`, as its whole command line. */
const ghPrLines = (exec) => exec.calls
  .filter((c) => c.cmd === 'gh' && c.argv[0] === 'pr')
  .map((c) => c.line)
const sortedJson = (xs) => [...xs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

// ── The fleet of leg (a): two done runs, each with a pull request ───────────

const OLD = 71 // done two hours ago: an hour past done, so its VM is ballast
const YOUNG = 72 // done ten minutes ago: still inside the hour
const OLD_UPDATED = hoursAgo(2)
const YOUNG_UPDATED = minutesAgo(10)

const PAGES = {
  [evidencePath(OLD)]: donePage(OLD, OLD_UPDATED),
  [evidencePath(YOUNG)]: donePage(YOUNG, YOUNG_UPDATED)
}

const legAExec = () => makeExec({
  // passthrough: [] — no command in this exam ever really runs.
  rules: [...lsRules([row(OLD), row(YOUNG)]), ghApiRule(PAGES)],
  passthrough: []
})

// ── (a) the reap, and only the reap [M1] ────────────────────────────────────
{
  const exec = legAExec()
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(ghPrLines(exec), [],
    '(a)/M1 a done run whose status page carries a pr URL gets no `gh pr` command of any kind — no view, no merge: the pull request is the sandbox\'s to merge')

  assert.deepEqual(
    sortedJson(ghArgvs(exec)),
    sortedJson([['api', evidencePath(OLD)], ['api', evidencePath(YOUNG)]]),
    '(a)/M1 the janitor\'s only gh commands are gh api reads — one per row, at repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>: a page found on the tag issues no branch read'
  )
  for (const argv of ghArgvs(exec)) {
    assert.equal(argv.length, 2,
      `(a)/M1 every gh call is exactly two argv words, got ${JSON.stringify(argv)}`)
    assert.equal(argv[0], 'api', '(a)/M1 the first word is `api`')
    assert.equal(argv[1].startsWith('repos/'), true,
      `(a)/M1 the second is a path beginning repos/, got ${JSON.stringify(argv[1])}`)
    for (const flag of ['-X', '--method', '-f', '-F', '--input']) {
      assert.equal(argv.includes(flag), false,
        `(a)/M1 and so no gh call carries ${flag}`)
    }
    assert.deepEqual(argv.filter((a) => String(a).startsWith('-')), [],
      '(a)/M1 nor any other flag: a read takes none')
  }

  assert.deepEqual(result.actions.map((a) => a.kind), ['rm'],
    '(a)/M1 every action the janitor records has kind `rm`')
  assert.deepEqual(result.actions, [{
    kind: 'rm',
    vm: vm(OLD),
    run: OLD,
    state: 'done',
    updatedAt: OLD_UPDATED,
    command: `rm ${vm(OLD)} --json`,
    applied: true
  }], '(a)/M1 the one action is the rm the contract shapes: { kind, vm, run, state, updatedAt, command, applied }')

  assert.deepEqual(exec.mutating(), [`rm ${vm(OLD)} --json`],
    '(a)/M1 the mutating lobby verbs are exactly one `rm <old vm> --json`: the run updated two hours ago is removed')
  assert.equal(result.actions.some((a) => a.vm === vm(YOUNG)), false,
    '(a)/M1 and the run updated ten minutes ago is in no action — it is not an hour past done')

  const lines = renderJanitor(result).split('\n')
  assert.equal(lines.every((line) => line.startsWith('rm ')), true,
    `(a)/M1 what is printed is the reap and nothing else, got ${JSON.stringify(lines)}`)

  // --dry-run reads the same fleet and mutates nothing.
  const dry = legAExec()
  const dryResult = await janitor({ argv: ['--dry-run'], exec: dry, config: CONFIG, now: () => NOW })

  assert.deepEqual(dry.mutating(), [],
    '(a)/M1 --dry-run over the same fleet issues no rm')
  assert.deepEqual(ghPrLines(dry), [],
    '(a)/M1 and no `gh pr` command either')
  assert.deepEqual(dryResult.actions.map((a) => a.vm), [vm(OLD)],
    '(a)/M1 while still reporting the row it would have removed')
  assert.equal(dryResult.actions.every((a) => a.applied === false), true,
    '(a)/M1 unapplied')
  assert.equal(dryResult.dryRun, true, '(a)/M1 and saying so')

  assert.equal(Object.keys(janitorModule).includes('PR_VIEW_JSON'), false,
    '(a)/M1 the module exports no PR_VIEW_JSON — the three fields the arming asked for are gone with it')
}

// ── (b) the sim of the arming is deleted outright [M2] ──────────────────────
assert.equal(fs.existsSync(path.join(HERE, 'test_janitor_automerge.mjs')), false,
  '(b)/M2 fleet/tests/test_janitor_automerge.mjs is absent: the sim of the deleted arming goes with it, and the fleet bridge globs the directory, so the name drops out of the list')

// ── (m4) what the operator documents say about who runs the janitor [M4] ────
{
  const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
  const RUNBOOK = 'fleet/RUNBOOK.md'
  const SKILL = 'skills/ultrapowers/SKILL.md'
  const FIRST_RUN = 'skills/ultrapowers/references/first-run.md'
  /** Wraps joined, so a sentence broken over two lines still reads as one. */
  const joined = (rel) => read(rel).replace(/\s+/g, ' ')

  const SENTENCE = 'The launcher runs it before every launch; nothing schedules it'
  assert.equal(joined(SKILL).includes(SENTENCE), true,
    `(m4)/M4 ${SKILL} says "${SENTENCE}"`)
  assert.equal(joined(RUNBOOK).includes(SENTENCE), true,
    `(m4)/M4 and so does ${RUNBOOK}`)
  assert.equal(joined(RUNBOOK).includes('arms auto-merge'), false,
    `(m4)/M4 ${RUNBOOK} no longer says \`arms auto-merge\`: the janitor merges nothing`)

  for (const rel of [RUNBOOK, SKILL, FIRST_RUN]) {
    assert.equal(/cron/i.test(read(rel)), false,
      `(m4)/M4 the word cron appears nowhere in ${rel} — nothing schedules the janitor`)
  }
}

// ── (d) the sentinel [M1] ───────────────────────────────────────────────────
console.log('ALL TESTS PASSED')
