/**
 * fleet/tests/test_janitor_reap_only.mjs — the janitor keeps only the reap.
 *
 * #660 item (3): the janitor removes the VMs of runs an hour past done and
 * nothing else. The laptop-side arming of #655 is gone — a `done` run's pull
 * request is the sandbox's to merge, not the janitor's — so the janitor's whole
 * `gh` surface is `gh api` reads, and every action it records is an `rm`.
 *
 * Every external call goes through the same `exec` seam the rest of the fleet
 * uses — `cmd`, then `argv`; this exam cans `ssh` and `gh` and reads
 * `exec.calls` for what was issued, so no network is touched. The rig is `test_janitor.mjs`'s:
 * `makeExec` with `sshRule('ls ', …)` answering `vmsPayload(rows)`,
 * `sshRule('rm ', answer(''))`, and `cmdRule('gh', 'api', …)` answering the
 * contents envelope for each run's status page. The pages are canned at the
 * evidence *tag* — a finished run's durable record — so the janitor's one read
 * per row is the tag read and the branch fallback never fires.
 *
 * What is pinned, clause by clause:
 *
 *   (a) [M1] over a fleet of two `done` runs that each carry a `pr` URL, one
 *       updated two hours ago and one ten minutes ago: no `gh pr` command of any
 *       kind is issued, every `gh` call is two argv words — `api` and a path
 *       beginning `repos/` — so none carries `-X`, `--method`, `-f`, `-F`,
 *       `--input` or any other flag — #724 Task 2's one
 *       `git/matching-refs/heads/ultra/integration-run-` read per target rides
 *       that same two-word shape — every recorded action has `kind` `rm`, the
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
 *
 * #913 Task 1 — "the janitor keeps a VM whose comment says do not reap" — adds
 * its own three legs below, named (1a), (1b) and (1c) so they do not collide
 * with the four above, which stay exactly as they were:
 *
 *   (1a) [M1] over a fleet of three `ls` rows in the shape exe.dev answers
 *        them, one of which carries the comment `kata hub — persistent
 *        service, do not reap`: that row draws no action, no `rm` lobby verb,
 *        and no `gh api` read naming its run, and comes back in a new `kept`
 *        array as `{vm, comment}`; the other two rows are judged as they are at
 *        BASE — the one done two hours ago is reaped, the one done ten minutes
 *        ago is not — and `--dry-run` keeps the row the same way;
 *   (1b) [M2] `renderJanitor` prints `kept <vm>  comment says do not reap —
 *        never removed` once per kept row, after every `rm` line and before
 *        every `stale` line, and prints `nothing to do` only when every array
 *        — `kept` included — is empty;
 *   (1c) [M3] `fleet/CONTRACT.md`'s `- **Janitor (` bullet, up to the
 *        `- **Laptop config` bullet, says `do not reap`.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { evidenceTagFor } from '../lobby.mjs'
import * as janitorModule from '../janitor.mjs'
import { janitor, renderJanitor } from '../janitor.mjs'
import {
  answer, cmdRule, makeExec, sshRule, vmRow, vmRule, vmsPayload
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
    sortedJson([['api', evidencePath(OLD)], ['api', evidencePath(YOUNG)]].concat([[
      // #724 Task 2: the branch report's own read — one per distinct target
      // among the rows, whatever the reap did. Both rows here carry the same
      // `target=`, so it is issued once; nothing was canned for it, so the
      // seam's 404 is "no branches" and it draws no `pulls?` read behind it.
      'api', `repos/${TARGET}/git/matching-refs/heads/ultra/integration-run-`
    ]])),
    '(a)/M1 the janitor\'s only gh commands are gh api reads — one per row, at repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>, plus #724\'s one matching-refs read per target'
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

// ════════════════════════════════════════════════════════════════════════════
// #913 Task 1: the janitor keeps a VM whose comment says do not reap
// ════════════════════════════════════════════════════════════════════════════

/**
 * The contract literal, as Shelley gave it and as `fleet/kata-hub.mjs` writes
 * it. The guard is the substring `do not reap`, case-sensitive; this whole
 * string is what a real hub row carries, so it is what the fleet below says.
 */
const DO_NOT_REAP_COMMENT = 'kata hub — persistent service, do not reap'

/**
 * One `ls --json` row in the shape exe.dev really answers (measured
 * 2026-09-11): `{vm_name, status, https_url, comment, tags, proxy_port,
 * allocated_cpus, memory_capacity_bytes, ssh_dest, ssh_host}` inside
 * `{"vms":[…]}` — `comment` a string on the row itself and `tags` an array, so
 * no `-l` is needed to see either.
 */
const exeRow = (name, extra = {}) => vmRow(name, {
  https_url: `https://${name}.exe.xyz`,
  comment: '',
  tags: ['fleet'],
  proxy_port: 8080,
  allocated_cpus: 8,
  memory_capacity_bytes: 17179869184,
  ...extra
})

/** A row the launcher assigned: the measured shape, carrying `run=`/`target=`. */
const assignedRow = (n, extra = {}) => exeRow(vm(n), { comment: comment(n), ...extra })

const R7 = 7 // done two hours ago: an hour past done, so its VM is reaped
const R8 = 8 // the row whose comment says do not reap
const R9 = 9 // done ten minutes ago: still inside the hour
const R7_UPDATED = hoursAgo(2)
const R9_UPDATED = minutesAgo(10)

/** The kept row: the hub's comment, and `tags` empty — it is untagged. */
const KEPT_ROW = exeRow(vm(R8), { comment: DO_NOT_REAP_COMMENT, tags: [] })
/** What `kept` answers for it, per M1: `{vm, comment}` and nothing else. */
const KEPT_ENTRY = { vm: vm(R8), comment: DO_NOT_REAP_COMMENT }
/** M2's line, verbatim — two spaces after the VM name, an em dash before `never`. */
const KEPT_LINE = `kept ${vm(R8)}  comment says do not reap — never removed`

const FLEET_1A = [assignedRow(R7), KEPT_ROW, assignedRow(R9)]
const PAGES_1A = {
  [evidencePath(R7)]: donePage(R7, R7_UPDATED),
  [evidencePath(R9)]: donePage(R9, R9_UPDATED)
}

/** The same canned seam every leg here uses: `ls`, `rm`, `gh api`, nothing real. */
const execFor = (fleet, pages, extra = []) => makeExec({
  rules: [...lsRules(fleet), ghApiRule(pages), ...extra],
  passthrough: []
})

/** Every `gh` call as one string, so a leg can ask what a path names. */
const ghLines = (exec) => ghArgvs(exec).map((argv) => argv.join(' '))

// ── (1a) the row with the comment is kept, and the fleet around it is not ───
{
  const exec = execFor(FLEET_1A, PAGES_1A)
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(result.kept, [KEPT_ENTRY],
    `(1a)/M1 the row whose comment contains \`do not reap\` is answered in a new \`kept\` array as { vm, comment }: ${JSON.stringify([KEPT_ENTRY])}`)

  assert.deepEqual(result.actions.map((a) => [a.kind, a.vm]), [['rm', vm(R7)]],
    '(1a)/M1 the result\'s actions are exactly one rm, for the run done two hours ago — the kept row draws none, and the run done ten minutes ago is still inside the hour')
  assert.equal(result.actions.some((a) => a.vm === vm(R8)), false,
    '(1a)/M1 no action names the kept VM')

  assert.deepEqual(exec.mutating(), [`rm ${vm(R7)} --json`],
    `(1a)/M1 the mutating lobby verbs are exactly \`rm ${vm(R7)} --json\`: no rm names the kept VM`)

  assert.deepEqual(
    ghLines(exec).filter((line) => line.includes(`/runs/${R8}/`)),
    [],
    `(1a)/M1 no gh api read's path contains /runs/${R8}/ — the kept row is skipped before its page is ever read`
  )

  assert.equal(result.unknown.some((u) => u.vm === vm(R8)), false,
    '(1a)/M1 and it is answered in `kept`, not in `unknown`: the guard is decided on the raw comment before `assignmentOf` ever runs')

  // Every other row judged exactly as at BASE: one evidence read each, and
  // #724's one matching-refs read for the one target those two rows name.
  assert.deepEqual(
    sortedJson(ghArgvs(exec)),
    sortedJson([
      ['api', evidencePath(R7)],
      ['api', evidencePath(R9)],
      ['api', `repos/${TARGET}/git/matching-refs/heads/ultra/integration-run-`]
    ]),
    '(1a)/M1 every other row is judged exactly as at BASE — one evidence read apiece, plus #724\'s one matching-refs read per target — and the kept row adds no read of its own'
  )

  // --dry-run keeps the row the same way, and still removes nothing.
  const dry = execFor(FLEET_1A, PAGES_1A)
  const dryResult = await janitor({ argv: ['--dry-run'], exec: dry, config: CONFIG, now: () => NOW })

  assert.deepEqual(dryResult.kept, [KEPT_ENTRY],
    '(1a)/M1 --dry-run over the same fleet answers the same `kept`')
  assert.deepEqual(dry.mutating(), [],
    '(1a)/M1 and issues no rm at all')
  assert.deepEqual(
    ghLines(dry).filter((line) => line.includes(`/runs/${R8}/`)),
    [],
    `(1a)/M1 nor any gh api read whose path contains /runs/${R8}/`
  )
  assert.deepEqual(dryResult.actions.map((a) => a.vm), [vm(R7)],
    '(1a)/M1 while still reporting the one row it would have removed')
}

// ── (1b) what `renderJanitor` prints for a kept row [M2] ────────────────────
{
  const exec = execFor(FLEET_1A, PAGES_1A)
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  const lines = renderJanitor(result).split('\n')
  assert.equal(lines.length, 2,
    `(1b)/M2 that result renders two lines — the reap and the kept row, got ${JSON.stringify(lines)}`)
  assert.equal(lines[0].startsWith(`rm ${vm(R7)}`), true,
    `(1b)/M2 the rm line for ${vm(R7)} comes first, got ${JSON.stringify(lines[0])}`)
  assert.equal(lines[1], KEPT_LINE,
    `(1b)/M2 then, verbatim, ${JSON.stringify(KEPT_LINE)}`)

  // A stale row added to the fleet: the kept line still sits after every rm
  // line and before every stale line. Run 5's page says `running` seven hours
  // on, and its VM answers nothing — an unreadable unit is left alone, so the
  // row is reported stale rather than touched.
  const R5 = 5
  const R5_UPDATED = hoursAgo(7)
  const stalePage = {
    run: R5,
    state: 'running',
    phase: 'x',
    branch: `ultra/integration-run-${R5}`,
    vm: vm(R5),
    updatedAt: R5_UPDATED
  }
  const staleExec = execFor(
    [assignedRow(R7), KEPT_ROW, assignedRow(R9), assignedRow(R5)],
    { ...PAGES_1A, [evidencePath(R5)]: stalePage },
    [vmRule(answer('', { code: 255, stderr: 'ssh: connect to host: Connection timed out' }))]
  )
  const staleResult = await janitor({ argv: [], exec: staleExec, config: CONFIG, now: () => NOW })

  assert.deepEqual(staleResult.kept, [KEPT_ENTRY],
    '(1b)/M2 the kept row is kept in this fleet too')
  assert.deepEqual(staleResult.stale.map((s) => s.vm), [vm(R5)],
    '(1b)/M2 and the row silent for seven hours is the one stale row')

  const staleLines = renderJanitor(staleResult).split('\n')
  const keptAt = staleLines.indexOf(KEPT_LINE)
  assert.notEqual(keptAt, -1,
    `(1b)/M2 ${JSON.stringify(KEPT_LINE)} is among the lines, got ${JSON.stringify(staleLines)}`)
  assert.equal(staleLines.filter((line) => line === KEPT_LINE).length, 1,
    '(1b)/M2 one such line per kept row, and there is one kept row')

  const rmAt = staleLines.map((line, i) => [line, i]).filter(([line]) => line.startsWith('rm ')).map(([, i]) => i)
  const staleAt = staleLines.map((line, i) => [line, i]).filter(([line]) => line.startsWith('stale ')).map(([, i]) => i)
  assert.deepEqual(rmAt.length > 0 && staleAt.length > 0, true,
    `(1b)/M2 this fleet renders an rm line and a stale line, got ${JSON.stringify(staleLines)}`)
  assert.equal(rmAt.every((i) => i < keptAt), true,
    `(1b)/M2 the kept line is placed after every rm line, got ${JSON.stringify(staleLines)}`)
  assert.equal(staleAt.every((i) => i > keptAt), true,
    `(1b)/M2 and before every stale line, got ${JSON.stringify(staleLines)}`)

  // `nothing to do` is for a pass that found nothing — `kept` counts.
  const EMPTY = {
    dryRun: false, age: '1h', actions: [], stale: [], unknown: [], deaths: [], branches: [], kept: []
  }
  assert.equal(renderJanitor(EMPTY), 'nothing to do',
    '(1b)/M2 a result whose deaths, actions, stale, unknown, branches and kept are all empty renders `nothing to do`')
  assert.equal(renderJanitor({ ...EMPTY, kept: [KEPT_ENTRY] }), KEPT_LINE,
    '(1b)/M2 and one whose only non-empty array is `kept` does not — it renders that row\'s kept line')
}

// ── (1c) what the contract's janitor bullet says [M3] ───────────────────────
{
  const contract = fs.readFileSync(path.join(REPO_ROOT, 'fleet/CONTRACT.md'), 'utf8').split('\n')
  const from = contract.findIndex((line) => line.startsWith('- **Janitor ('))
  assert.notEqual(from, -1, '(1c)/M3 fleet/CONTRACT.md has a line beginning `- **Janitor (`')
  const to = contract.findIndex((line, i) => i > from && line.startsWith('- **Laptop config'))
  assert.notEqual(to, -1, '(1c)/M3 and, below it, one beginning `- **Laptop config`')

  // The Proof's own `sed -n '/^- \*\*Janitor (/,/^- \*\*Laptop config/p' … |
  // tr '\n' ' '`: the bullet, its continuation lines, and the bullet that ends
  // it, joined into one string — so a sentence broken over two lines reads as one.
  const bullet = contract.slice(from, to + 1).join(' ')
  assert.equal(bullet.includes('do not reap'), true,
    `(1c)/M3 fleet/CONTRACT.md's janitor bullet says a VM whose comment carries \`do not reap\` is never removed, got ${JSON.stringify(bullet)}`)
}

// ── (d) the sentinel [M1] ───────────────────────────────────────────────────
console.log('ALL TESTS PASSED')
