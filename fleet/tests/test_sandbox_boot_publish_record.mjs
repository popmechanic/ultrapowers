// fleet/tests/test_sandbox_boot_publish_record.mjs — task 4 of #1097, "a
// re-entered boot files no second disclosures ticket".
//
// The PR is idempotent by its own record: GUARD 2 reads `pr` off the status
// page and refuses to open a second one. The disclosures ticket had no such
// record — `file_disclosures`'s only precondition was `[ -n "$PR_URL" ]`, and
// on a re-entry `PR_URL` comes off the page, so the exact case GUARD 2 exists
// for filed a SECOND issue with the same title and the same boxes. This sim
// reads the record the ticket now keeps: a `disclosures` cell on the page,
// written after `merged` by every `write_status`, and a guard that reads it.
//
// Four boots, each started once and shared by every leg that reads it — a boot
// is about forty forks of stub shell, so this is the `once(label, start)` shape
// `test_sandbox_boot_close_evidence.mjs` uses:
//
//   DISCLOSING   a fresh green boot whose report carries one not-taken
//                judgment call: one POST, one event, the cell         [M4] [M1]
//   QUIET        a fresh green boot under the rig's default report: no POST at
//                all, and the cell present and `null`                 [M4] [M1]
//   RECORDED     a boot whose page was planted with `pr` AND `disclosures`
//                before it started: no second PR, no second ticket    [M2]
//   PR_ONLY      the same plant with `disclosures` null: no second PR, and
//                exactly one ticket                                   [M3]
//
// and one leg over the two documents the contract change lands in       [M5].
//
// The pages are planted by writing `<home>/www/status.json` before the boot,
// which the boot reads because `do_boot` reads the page before its first write.
// Only `./_sandbox_boot_helpers.mjs` is imported — never a sibling sim.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_REPORT, FOLLOWUP_URL, INTEGRATION_BRANCH, PR_AUTHOR, PR_URL, VM_NAME,
  bootAsync, eventsOfKind, lines, makeHome, readLog, statusOf, stream,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONTRACT = path.join(HERE, '..', 'CONTRACT.md')
const README = path.join(HERE, 'README.md')
const SIM = 'test_sandbox_boot_publish_record.mjs'

// ── the report that owes a disclosure ────────────────────────────────────────

/** The one edit the run was owed and did not take — `disclosure_items` matches
 *  `task <id>: out-of-FILES (not taken): <text>` and nothing else. */
const NOT_TAKEN = 'task 1: out-of-FILES (not taken): fleet/tests/README.md: the index line this task did not take'
/** The rig's default report with that call spliced in after `"stamp":"run-7"`. */
const STAMP = '{"stamp":"run-7"'
assert.ok(DEFAULT_REPORT.startsWith(STAMP), `the rig's default report still opens with ${STAMP}`)
const DISCLOSING_REPORT =
  STAMP + `,"judgmentCalls":[${JSON.stringify(NOT_TAKEN)}]` + DEFAULT_REPORT.slice(STAMP.length)
assert.deepEqual(
  JSON.parse(DISCLOSING_REPORT).judgmentCalls, [NOT_TAKEN],
  'the spliced report parses and carries exactly the one not-taken call',
)

// ── the planted page ─────────────────────────────────────────────────────────

/**
 * The page a previous attempt of this run left behind: state `publishing` (not
 * terminal, so GUARD 1 lets the boot through), the PR recorded, and the
 * `disclosures` cell where the contract puts it — directly after `merged`,
 * because `json_field` answers the FIRST match in the file.
 */
const plant = (ctx, disclosuresCell) => {
  const page = '{"run":"7","state":"publishing","phase":"gate-green — pushing ' + INTEGRATION_BRANCH + '"'
    + `,"pr":${JSON.stringify(PR_URL)},"prAuthor":${JSON.stringify(PR_AUTHOR)},"merged":null`
    + `,"disclosures":${disclosuresCell}`
    + `,"branch":${JSON.stringify(INTEGRATION_BRANCH)},"vm":${JSON.stringify(VM_NAME)}`
    + ',"startedAt":"2026-09-06T00:00:00Z","updatedAt":"2026-09-06T00:10:00Z","error":null,"tasks":{}}'
  JSON.parse(page)
  fs.mkdirSync(path.join(ctx.home, 'www'), { recursive: true })
  fs.writeFileSync(path.join(ctx.home, 'www', 'status.json'), page + '\n')
  return ctx
}

// ── the four boots, each started once ────────────────────────────────────────

const started = new Map()
const once = (label, start) => {
  if (!started.has(label)) started.set(label, start())
  return started.get(label)
}

const bootOnce = (label, env, prepare = (ctx) => ctx) => once(label, async () => {
  const ctx = prepare(makeHome())
  const r = await bootAsync(ctx, ['boot'], env)
  assert.equal(r.status, 0, `${label}: the boot did not finish 0\n${r.stdout}${r.stderr}`)
  return ctx
})

/** A fresh green boot whose report owes one disclosure. */
const disclosing = () => bootOnce('disclosing', { STUB_REPORT: DISCLOSING_REPORT })
/** A fresh green boot under the rig's default report, which owes none. */
const quiet = () => bootOnce('quiet', {})
/** A re-entry whose page already records the PR and the ticket. */
const recorded = () => bootOnce('recorded', { STUB_REPORT: DISCLOSING_REPORT },
  (ctx) => plant(ctx, JSON.stringify(FOLLOWUP_URL)))
/** A re-entry whose page records the PR and no ticket. */
const prOnly = () => bootOnce('pr-only', { STUB_REPORT: DISCLOSING_REPORT },
  (ctx) => plant(ctx, 'null'))

// ── readers ──────────────────────────────────────────────────────────────────

const issuePosts = (ctx) => lines(readLog(ctx, 'issues.log'))
const prPostLines = (ctx) => lines(readLog(ctx, 'pr.log'))
/** The stub's own line for one `POST …/issues`, counted off the boot log. */
const issueCalls = (ctx) => stream(ctx).filter((l) => l.includes('curl issue create')).length
const pageBytes = (ctx) => fs.readFileSync(path.join(ctx.home, 'www', 'status.json'), 'utf8')
/** Every page the run COMMITTED, one snapshot per commit, in commit order. */
const committedPages = (ctx) => lines(readLog(ctx, 'commits.log'))
/** `"merged":<cell>,"disclosures":<cell>,"branch":` — the cell in the one
 *  position M1 and the contract's literal give it. */
const CELL = '(?:null|"(?:[^"\\\\]|\\\\.)*")'
const AFTER_MERGED = new RegExp(`"merged":${CELL},"disclosures":${CELL},"branch":`)

// ── (a) a fresh boot files one ticket and records it, or files none [M4] [M1] ─

test('(a) [M4] a fresh green boot with one not-taken call files exactly one ticket', async () => {
  const ctx = await disclosing()
  assert.equal(issuePosts(ctx).length, 1,
    `(a) [M4] exactly one line in issues.log — got ${JSON.stringify(issuePosts(ctx))}`)
  assert.equal(issueCalls(ctx), 1,
    `(a) [M4] exactly one POST …/issues on the boot log — got ${issueCalls(ctx)}`)
})

test('(a) [M4] that boot appends exactly one publish:disclosures event', async () => {
  const ctx = await disclosing()
  const evs = eventsOfKind(ctx, 'publish:disclosures')
  assert.equal(evs.length, 1,
    `(a) [M4] one publish:disclosures event in the run's events.jsonl — got ${evs.length}`)
  assert.equal(evs[0].url, FOLLOWUP_URL,
    `(a) [M4] the event's url is what GitHub answered — got ${JSON.stringify(evs[0].url)}`)
})

test('(a) [M4] [M1] its page ends with disclosures equal to the URL GitHub answered', async () => {
  const s = statusOf(await disclosing())
  assert.equal(s.disclosures, FOLLOWUP_URL,
    `(a) [M4] the disclosures cell is the answered URL — got ${JSON.stringify(s.disclosures)}`)
})

test('(a) [M4] [M1] a fresh green boot under the default report files nothing and carries disclosures null', async () => {
  const ctx = await quiet()
  assert.equal(readLog(ctx, 'issues.log'), '',
    `(a) [M4] no issues.log at all — got ${JSON.stringify(readLog(ctx, 'issues.log'))}`)
  assert.equal(issueCalls(ctx), 0, `(a) [M4] no POST …/issues — got ${issueCalls(ctx)}`)
  const s = statusOf(ctx)
  assert.ok('disclosures' in s,
    `(a) [M1] the page has the key disclosures — got keys ${JSON.stringify(Object.keys(s))}`)
  assert.equal(s.disclosures, null,
    `(a) [M1] a run that files none carries disclosures null — got ${JSON.stringify(s.disclosures)}`)
})

test('(a) [M1] the cell sits directly after merged on every page every write_status wrote', async () => {
  for (const [label, get] of [['disclosing', disclosing], ['quiet', quiet]]) {
    const ctx = await get()
    assert.match(pageBytes(ctx), AFTER_MERGED,
      `(a) [M1] ${label}: the final page renders "merged":…,"disclosures":…,"branch": — read ${pageBytes(ctx).trim()}`)
    const pages = committedPages(ctx)
    assert.ok(pages.length >= 1, `(a) [M1] ${label}: the run committed at least one page`)
    pages.forEach((page, i) => {
      assert.match(page, AFTER_MERGED,
        `(a) [M1] ${label}: committed page ${i + 1} carries the disclosures cell after merged — read ${page}`)
    })
  }
})

// ── (b) a page that records both opens nothing and files nothing [M2] ────────

test('(b) [M2] a boot whose page records the ticket makes no POST …/issues', async () => {
  const ctx = await recorded()
  assert.equal(readLog(ctx, 'issues.log').trim(), '',
    `(b) [M2] no issues.log line — got ${JSON.stringify(readLog(ctx, 'issues.log'))}`)
  assert.equal(issueCalls(ctx), 0,
    `(b) [M2] no POST …/issues on the boot log — got ${issueCalls(ctx)}`)
  assert.equal(readLog(ctx, 'pr.log').trim(), '',
    `(b) [M2] no pr.log line either — got ${JSON.stringify(readLog(ctx, 'pr.log'))}`)
})

test('(b) [M2] it logs both already-recorded lines, verbatim', async () => {
  const log = stream(await recorded())
  const pr = `publish: ${PR_URL} already recorded — not opening a second PR`
  const ticket = `disclosures: ${FOLLOWUP_URL} already recorded — not filing a second ticket`
  assert.ok(log.includes(pr),
    `(b) [M2] the boot log carries \`${pr}\`\n${log.join('\n')}`)
  assert.ok(log.includes(ticket),
    `(b) [M2] the boot log carries \`${ticket}\`\n${log.join('\n')}`)
})

test('(b) [M2] its final page still carries the PR and that ticket URL', async () => {
  const ctx = await recorded()
  const s = statusOf(ctx)
  assert.equal(s.pr, PR_URL, `(b) [M2] pr is the recorded PR — got ${JSON.stringify(s.pr)}`)
  assert.equal(s.disclosures, FOLLOWUP_URL,
    `(b) [M2] the cell is left carrying that URL — got ${JSON.stringify(s.disclosures)}`)
  assert.match(pageBytes(ctx), AFTER_MERGED,
    `(b) [M1] the re-entry's page renders the cell after merged — read ${pageBytes(ctx).trim()}`)
})

// ── (c) a page with a PR and no ticket files exactly one [M3] ────────────────

test('(c) [M3] a boot whose page records the PR and no ticket opens no second PR', async () => {
  const ctx = await prOnly()
  assert.equal(readLog(ctx, 'pr.log').trim(), '',
    `(c) [M3] no pr.log line — got ${JSON.stringify(readLog(ctx, 'pr.log'))}`)
  assert.equal(prPostLines(ctx).length, 0, '(c) [M3] no POST …/pulls at all')
})

test('(c) [M3] it files exactly one ticket and records it on the page', async () => {
  const ctx = await prOnly()
  assert.equal(issuePosts(ctx).length, 1,
    `(c) [M3] exactly one line in issues.log — got ${JSON.stringify(issuePosts(ctx))}`)
  assert.equal(issueCalls(ctx), 1,
    `(c) [M3] exactly one POST …/issues on the boot log — got ${issueCalls(ctx)}`)
  const s = statusOf(ctx)
  assert.equal(s.pr, PR_URL, `(c) [M3] pr is the recorded PR — got ${JSON.stringify(s.pr)}`)
  assert.equal(s.disclosures, FOLLOWUP_URL,
    `(c) [M3] the final page carries the answered URL — got ${JSON.stringify(s.disclosures)}`)
})

// ── (d) the two documents [M5] ──────────────────────────────────────────────

test("(d) [M5] the contract's status.json literal carries disclosures directly after merged", () => {
  const text = fs.readFileSync(CONTRACT, 'utf8')
  const all = text.split('\n')
  const from = all.findIndex((l) => l.startsWith('- **status.json:**'))
  const to = all.findIndex((l) => l.startsWith('- **Publish:**'))
  assert.ok(from >= 0 && to > from, `(d) [M5] the contract still has a **status.json:** bullet above **Publish:**`)
  const bullet = all.slice(from, to + 1).join(' ')
  assert.ok(bullet.includes('"merged":"<40-hex or null>","disclosures":"<url or null>","branch"'),
    '(d) [M5] the literal reads …"merged":"<40-hex or null>","disclosures":"<url or null>","branch"…\n'
    + `read: ${bullet.slice(0, 1200)}`)
})

test("(d) [M5] the contract's re-entry bullet says a recorded ticket is never filed twice", () => {
  const text = fs.readFileSync(CONTRACT, 'utf8')
  const SENTENCE = 'disclosures ticket is never filed twice'
  assert.ok(text.includes(SENTENCE), `(d) [M5] the contract carries \`${SENTENCE}\``)
  const all = text.split('\n')
  const at = all.findIndex((l) => l.includes('a recorded `pr` is never opened twice'))
  assert.ok(at >= 0, '(d) [M5] the re-entry bullet still says a recorded `pr` is never opened twice')
  const indent = all[at].slice(0, all[at].length - all[at].trimStart().length)
  let head = at
  while (head > 0 && !all[head].startsWith(`${indent}- `)) head -= 1
  let tail = at + 1
  while (tail < all.length && !all[tail].startsWith(`${indent}- `) && all[tail].trim() !== '') tail += 1
  const bullet = all.slice(head, tail).join('\n')
  assert.ok(bullet.includes(SENTENCE),
    `(d) [M5] the re-entry bullet itself says it — read:\n${bullet}`)
})

test('(d) [M5] fleet/tests/README.md indexes the new sim', () => {
  const text = fs.readFileSync(README, 'utf8')
  assert.ok(text.includes(SIM), `(d) [M5] the README names ${SIM}`)
  const all = text.split('\n')
  const from = all.findIndex((l) => l.startsWith('## The sandbox boot'))
  assert.ok(from >= 0, '(d) [M5] the README still has a sandbox boot section')
  let to = from + 1
  while (to < all.length && !all[to].startsWith('## ')) to += 1
  assert.ok(all.slice(from, to).some((l) => l.includes(SIM)),
    `(d) [M5] the sim is indexed in the sandbox boot section — read:\n${all.slice(from, to).join('\n')}`)
})

runTests(tests)
