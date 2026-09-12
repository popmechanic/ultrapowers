/**
 * fleet/tests/test_sandbox_boot_kata.mjs — the boot carries the hub's record in
 * and out: `kata.json` off the plan commit and onto the engine's argv,
 * `kata.jsonl` onto the evidence branch, and a park when the hub is dark.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Every
 * assertion names the leg it belongs to and the clause it comes from, so a
 * reader can map this file back to the contract:
 *
 *   M1  `prepare_plan` reads `.ultrapowers/kata.json` out of the plan commit
 *       into `${PLAN_FILE%.md}.kata.json` (`<home>/plans/run-7.kata.json`) when
 *       `git cat-file -e <plan sha>:.ultrapowers/kata.json` answers 0, logging
 *       `plan: kata -> <that path>`; otherwise it logs
 *       `plan: <plan sha> carries no .ultrapowers/kata.json — the run proceeds
 *       without kata`, makes no kata request and passes no `--kata`.
 *   M2  with the file, directly after `prepare_evidence` and before
 *       `check_engine`, the boot pings
 *       `https://kata.int.exe.xyz/api/v1/ping` with `--max-time 10 --retry 3
 *       --retry-delay 2 --retry-connrefused`; a non-zero exit sets `ERROR` to
 *       exactly `parked: kata unreachable at https://kata.int.exe.xyz (curl exit
 *       <n>)`, writes the page `parked` with phase `kata unreachable`, commits
 *       and pushes the evidence with subject `run-7: parked — kata unreachable`,
 *       records the tags, notifies `run-7 parked`, and exits 0 with no engine
 *       unit started and no PR opened.
 *   M3  with the file, the engine's argv carries
 *       `--kata <home>/plans/run-7.kata.json` directly after
 *       `--repo <target dir>`; without it, no `--kata`.
 *   M4  with the file, `collect_evidence` writes `kata.jsonl` beside
 *       `events.jsonl`: one `{"kind":"issue", …}` line per object of
 *       `GET …/projects/<project id>/issues?limit=1000`, then one
 *       `{"kind":"event", …}` line per envelope of
 *       `GET …/projects/<project id>/events?after_id=<c>&limit=1000` paged from
 *       `after_id=0` by each answer's `next_after_id` until an answer's `events`
 *       is empty; the file is moved into place, and a fetch that fails leaves
 *       the previous `kata.jsonl` as it was and logs
 *       `kata: export failed (curl exit <n>) — previous kata.jsonl kept`. The
 *       project id is the file's `project.id` — read with `python3`, never with
 *       `json_field`, which answers the FIRST `"name": "value"` in a document.
 *   M5  `fleet/CONTRACT.md`'s `ultra/evidence-run-<N>` bullet names
 *       `kata.jsonl`, and the boot-script bullet carries
 *       `--kata /home/exedev/plans/run-N.kata.json` on its engine line, the
 *       `parked: kata unreachable` park, the ping's `--retry-connrefused` and
 *       the `peer key` sentence.
 *   M6  (#937) with the file, the boot closes the RUN issue — the file's
 *       `run.uid` — exactly once, at the terminal transition and before that
 *       transition's export: `POST …/projects/<project id>/issues/<run
 *       uid>/actions/close` with `Idempotency-Key: run-7:run:close`, body
 *       `{actor: "sandbox:run-7", reason, message, evidence, retry_protocol:
 *       "close-v1"}`. A run that ended `done` closes `done` with
 *       `{type: "pr", url}` and `{type: "commit", sha: <merge sha>}` evidence
 *       and a message of 40+ characters carrying the plan's H1 and the merge
 *       sha; a run that parked (or failed) closes `wontfix` with no evidence
 *       and the page's `error`. A close the hub refuses is one
 *       `kata:write-failed` event (`what` `close`, `uid`, `detail` naming the
 *       curl exit) on the record, and the run still publishes and merges.
 *       The contract's boot-script bullet says so (`run-<N>:run:close`).
 *
 * The rig is `_sandbox_boot_helpers.mjs` — the stub bin dir, `makeHome`,
 * `boot`/`bootAsync`, the memoized `green` run and the log readers — shared
 * with the other halves of the boot exam. This file drives its kata knobs:
 * `STUB_KATA_JSON` (the blob the `git` stub hands back, and the switch its
 * `cat-file -e` answers on), `STUB_KATA_PING_EXIT`, `STUB_KATA_ISSUES` and
 * `STUB_KATA_EVENTS`. Ground truth for "which call went out, with which words"
 * is `curl.log` / `git.log` / `systemd-run.log` — the tab-separated argv the
 * stubs write through the shared `argv()` prelude — and ORDER is read as index
 * comparisons inside the one stream every stub and every `log` line lands in.
 *
 * Two mechanics are worth naming, because a reader will otherwise wonder:
 *
 *   - THE BYTE TRUTH OF THE LANDED KATA FILE. Leg (a) asks for byte-equality
 *     with what the plan commit carries, and what it carries is whatever the
 *     rig's `git show <sha>:.ultrapowers/kata.json` prints. So the expected
 *     bytes are taken by running that stub directly (`stubEnv`) in a home of
 *     its own — never by this file guessing whether the stub adds a newline.
 *   - THE EXPORT THAT FAILS FROM THE SECOND TRANSITION ON. `STUB_KATA_ISSUES_EXIT`
 *     is read from the environment, which is fixed for the life of a boot, so no
 *     env knob can be off for the `running` export and on for the ones after it.
 *     The exam therefore holds the engine (`STUB_ENGINE_HOLD`), reads the file
 *     the `running` export wrote, REPLACES the `curl` stub with one that answers
 *     the issues URL with exit 22 and delegates everything else to the rig's own
 *     stub, and only then releases the engine — so every export from the second
 *     on meets exactly the fault the knob names.
 *
 * No network, no systemd, no real `claude`: every call is a stub in
 * `FLEET_BIN_DIR` and every path is under `FLEET_HOME`.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PLAN_SHA, RUN_PATH, PLAN_H1, PR_URL, MERGE_SHA,
  PRELUDE, STUBS,
  makeHome, boot, bootAsync, green, stubEnv,
  argvLines, gitLog, verbOf, stream, statusOf, commitStates, trees, notifies,
  prArgv, mergePuts, targetDir, kataCloses, evidenceEvents, runTests,
} from './_sandbox_boot_helpers.mjs'

// ── the literals of the hub ──────────────────────────────────────────────────

/** The script constant the task pins, spelled once here and nowhere else. */
const KATA_URL = 'https://kata.int.exe.xyz'
const PING_URL = `${KATA_URL}/api/v1/ping`
/** The project the fixture's `project.id` names. */
const PROJECT_ID = 42
/** The run issue the fixture's `run.uid` names — the one the boot closes (M6). */
const RUN_UID = 'R7'
const CLOSE_URL = `${KATA_URL}/api/v1/projects/${PROJECT_ID}/issues/${RUN_UID}/actions/close`
/** M6's idempotency key and actor, word for word. */
const CLOSE_KEY = 'run-7:run:close'
const CLOSE_ACTOR = 'sandbox:run-7'
const ISSUES_URL = `${KATA_URL}/api/v1/projects/${PROJECT_ID}/issues?limit=1000`
const eventsUrl = (after) => `${KATA_URL}/api/v1/projects/${PROJECT_ID}/events?after_id=${after}&limit=1000`

/**
 * The `.ultrapowers/kata.json` the plan commit carries. `project.id` is 42 and
 * nested, and a DECOY `"id"` sits above it: `json_field` answers the first
 * `"name": "value"` match in a document, so a reader that took the project id
 * that way would ask the hub about `not-the-project` and every URL below would
 * say so. M4 names `project.id`, read with `python3`.
 */
const KATA_JSON = `{"run":{"uid":"${RUN_UID}","revision":1},"id":"not-the-project"`
  + `,"project":{"id":${PROJECT_ID},"key":"run-7"},"origin":"${KATA_URL}"}`

/** The two issues the hub lists, and the two events it has. */
const KATA_ISSUES = '{"issues":[{"uid":"A","title":"t"},{"uid":"B","title":"u"}]}'
const KATA_EVENTS = '{"events":[{"event_id":1,"type":"issue.created"}'
  + ',{"event_id":2,"type":"issue.commented"}],"next_after_id":2,"reset_required":false}'

/** M4's four lines, in M4's order: the issues first, then the events. */
const KATA_LINES = [
  '{"kind":"issue","uid":"A","title":"t"}',
  '{"kind":"issue","uid":"B","title":"u"}',
  '{"kind":"event","event_id":1,"type":"issue.created"}',
  '{"kind":"event","event_id":2,"type":"issue.commented"}',
]

/** The one export's two event pages: `after_id=0`, then the `next_after_id`. */
const EVENT_PAGES = [eventsUrl(0), eventsUrl(2)]

/** M1's two log lines, as they stand in the boot log. */
const KATA_PLAN_LINE = (home) => `plan: kata -> ${path.join(home, 'plans', 'run-7.kata.json')}`
const NO_KATA_PLAN_LINE =
  `plan: ${PLAN_SHA} carries no .ultrapowers/kata.json — the run proceeds without kata`

/** M2's park, word for word. */
const PARK_ERROR = (exit) => `parked: kata unreachable at ${KATA_URL} (curl exit ${exit})`
const PARK_PHASE = 'kata unreachable'
const PARK_SUBJECT = 'run-7: parked — kata unreachable'
const PARK_NOTIFY = 'run-7 parked'

/** M4's line for a fetch that failed. */
const EXPORT_FAILED = (exit) => `kata: export failed (curl exit ${exit}) — previous kata.jsonl kept`

/** M2's record: the two tags the park still pushes. */
const PLAN_TAG_PUSH = `${PLAN_SHA}:refs/tags/ultra/plan/run-7`
const EVIDENCE_TAG_PUSH = 'HEAD:refs/tags/ultra/evidence/run-7'

/** The env every kata boot rides: the blob, the hub's two listings. */
const KATA_ENV = {
  STUB_KATA_JSON: KATA_JSON,
  STUB_KATA_ISSUES: KATA_ISSUES,
  STUB_KATA_EVENTS: KATA_EVENTS,
}

// ── readers ──────────────────────────────────────────────────────────────────

const kataFilePath = (ctx) => path.join(ctx.home, 'plans', 'run-7.kata.json')
/** The evidence branch's copy of the hub's record. */
const kataExportPath = (ctx) => path.join(ctx.home, 'evidence', RUN_PATH, 'kata.jsonl')
const kataExportLines = (ctx) => {
  const f = kataExportPath(ctx)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : null
}

const curlArgv = (ctx) => argvLines(ctx, 'curl')
/** Every URL a curl call carried that names the hub, in call order. */
const kataUrls = (ctx) =>
  curlArgv(ctx).flatMap((a) => a.filter((s) => s.includes('kata.int.exe.xyz')))
const pingArgv = (ctx) => curlArgv(ctx).find((a) => a.some((s) => s.includes('/api/v1/ping')))
/** The export's issues READ — never the run issue's close, which shares the prefix (M6). */
const issuesUrls = (ctx) => kataUrls(ctx).filter((u) => u.includes('/issues?'))
const eventsUrls = (ctx) => kataUrls(ctx).filter((u) => u.includes('/events'))

const engineArgv = (ctx) =>
  argvLines(ctx, 'systemd-run').find((a) => a.includes('--unit=fleet-engine-7'))
/** Every subject a `git commit -m …` carried, in order. */
const commitSubjects = (ctx) =>
  gitLog(ctx)
    .filter((a) => verbOf(a) === 'commit' && a.includes('-m'))
    .map((a) => a[a.indexOf('-m') + 1])

const why = (ctx) => `\n--- fleet-boot.log ---\n${stream(ctx).join('\n')}`
const whyCurl = (ctx) => `\n--- curl.log ---\n${curlArgv(ctx).map((a) => a.join(' ')).join('\n')}`
const whyGit = (ctx) => `\n--- git.log ---\n${gitLog(ctx).map((a) => a.join(' ')).join('\n')}`

/**
 * M4's paging, as one predicate over the URLs a whole run asked for: every
 * export is two calls, `after_id=0` then `after_id=2`, and nothing more. An
 * export that ignores `next_after_id` or re-asks `after_id=0` makes a different
 * pair; one that never stops makes more of them.
 */
function assertEventPaging(ctx, label) {
  const urls = eventsUrls(ctx)
  assert.ok(urls.length > 0, `${label} [M4]: the run asked the hub for events at all${whyCurl(ctx)}`)
  assert.equal(urls.length % 2, 0,
    `${label} [M4]: each export pages exactly twice — ${urls.length} calls is not a whole number ` +
    `of exports${whyCurl(ctx)}`)
  for (let i = 0; i < urls.length; i += 2) {
    assert.deepEqual(urls.slice(i, i + 2), EVENT_PAGES,
      `${label} [M4]: export ${i / 2 + 1} pages 'after_id=0' then 'after_id=2' and stops on the ` +
      `empty page${whyCurl(ctx)}`)
  }
  const issues = issuesUrls(ctx)
  assert.deepEqual(issues, Array.from({ length: urls.length / 2 }, () => ISSUES_URL),
    `${label} [M4]: one issues call per export, each exactly '${ISSUES_URL}'${whyCurl(ctx)}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(what, ok, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (ok()) return
    await sleep(50)
  }
  assert.fail(`timed out after ${timeoutMs} ms waiting for ${what}`)
}

// One kata-carrying green run per process, read by every leg that only reads —
// the same economy `green()` makes for the runs that carry none.
let KATA_GREEN = null
const kataGreen = () => {
  if (!KATA_GREEN) {
    const ctx = makeHome()
    KATA_GREEN = bootAsync(ctx, ['boot'], KATA_ENV).then((r) => {
      assert.equal(r.status, 0, `a green boot carrying kata.json still exits 0:\n${r.stdout}${r.stderr}`)
      return ctx
    })
  }
  return KATA_GREEN
}

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── (a) the plan commit's kata.json, landed or absent  [M1] ──────────────────

test('the blob lands beside the plan, byte for byte, and the log names its path  [M1 / leg (a)]', async () => {
  const ctx = await kataGreen()
  const landed = kataFilePath(ctx)
  assert.ok(fs.existsSync(landed),
    `(a) [M1] the plan commit carries .ultrapowers/kata.json, so the boot writes ${landed}${why(ctx)}`)

  // The bytes the plan commit carries are whatever `git show <sha>:<path>`
  // prints — taken from the stub itself, in a home of its own so this reading
  // leaves no line in the run's logs.
  const scratch = makeHome()
  const shown = spawnSync(path.join(scratch.bin, 'git'),
    ['-C', targetDir(scratch), 'show', `${PLAN_SHA}:.ultrapowers/kata.json`],
    { encoding: 'utf8', env: stubEnv(scratch, KATA_ENV) })
  assert.equal(shown.status, 0, `(a) [M1] the rig's git stub shows the kata blob:\n${shown.stderr}`)
  assert.equal(fs.readFileSync(landed, 'utf8'), shown.stdout,
    '(a) [M1] the landed file is byte-equal to the blob the plan commit carries')

  const doc = JSON.parse(fs.readFileSync(landed, 'utf8'))
  assert.equal(doc.project.id, PROJECT_ID,
    `(a) [M1] and it is the record whose project.id is ${PROJECT_ID}`)

  assert.ok(stream(ctx).includes(KATA_PLAN_LINE(ctx.home)),
    `(a) [M1] the boot log carries exactly '${KATA_PLAN_LINE(ctx.home)}'${why(ctx)}`)
})

test('without the blob the boot says so, asks the hub nothing, and still ends done  [M1 / leg (a)]', () => {
  // The rig's `cat-file -e <plan>:.ultrapowers/kata.json` answers non-zero when
  // no case set STUB_KATA_JSON, which is every boot sim at BASE and this one.
  const ctx = green()

  assert.ok(stream(ctx).includes(NO_KATA_PLAN_LINE),
    `(a) [M1] the boot log carries exactly '${NO_KATA_PLAN_LINE}'${why(ctx)}`)
  assert.deepEqual(stream(ctx).filter((l) => l.includes('CALL curl kata')), [],
    `(a) [M1] no 'CALL curl kata' line at all — no ping, no issues, no events${why(ctx)}`)
  assert.deepEqual(kataUrls(ctx), [],
    `(a) [M1] and no curl argv names the hub${whyCurl(ctx)}`)
  assert.ok(!fs.existsSync(kataFilePath(ctx)),
    '(a) [M1] nothing is written to <home>/plans/run-7.kata.json')
  assert.equal(statusOf(ctx).state, 'done', '(a) [M1] the run proceeds without kata and ends done')
  assert.deepEqual(trees(ctx).filter((l) => l.includes('kata.jsonl')), [],
    '(a) [M1] and no commit of that run carries a kata.jsonl')
})

// ── (b) an unreachable hub parks the run, before the engine exists  [M2] ─────

test('a ping that exits 7 parks the run with the words M2 pins  [M2 / leg (b)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { ...KATA_ENV, STUB_KATA_PING_EXIT: '7' })

  // M2's last words first: the park is an exit of 0, not a failure.
  assert.equal(r.status, 0,
    `(b) [M2] an unreachable hub parks and exits 0:\n${r.stdout}${r.stderr}`)

  // The ping's own argv: the retry flags Shelley's review asked for, and the URL.
  const ping = pingArgv(ctx)
  assert.ok(ping, `(b) [M2] the boot pinged the hub${whyCurl(ctx)}`)
  for (const flag of ['--max-time', '10', '--retry', '3', '--retry-delay', '2', '--retry-connrefused']) {
    assert.ok(ping.includes(flag),
      `(b) [M2] the ping's argv carries '${flag}': ${ping.join(' ')}`)
  }
  assert.equal(ping[ping.length - 1], PING_URL,
    `(b) [M2] the ping's argv ends with '${PING_URL}': ${ping.join(' ')}`)

  // The page, word for word.
  const page = statusOf(ctx)
  assert.equal(page.state, 'parked', `(b) [M2] the page's state is parked${why(ctx)}`)
  assert.equal(page.error, PARK_ERROR(7),
    `(b) [M2] the page's error is exactly '${PARK_ERROR(7)}'`)
  assert.equal(page.phase, PARK_PHASE, `(b) [M2] the page's phase is exactly '${PARK_PHASE}'`)
  assert.equal(commitStates(ctx)[commitStates(ctx).length - 1], 'parked',
    `(b) [M2] the last page committed to the evidence branch is the parked one: ` +
    `${JSON.stringify(commitStates(ctx))}`)

  // Where the ping sits: after the evidence worktree, before `check_engine`.
  const s = stream(ctx)
  const pingAt = s.findIndex((l) => l.includes('curl kata ping'))
  const worktreeAt = s.findIndex((l) => l.includes('worktree add'))
  assert.ok(worktreeAt >= 0, `(b) [M2] the evidence worktree was added${why(ctx)}`)
  assert.ok(pingAt > worktreeAt,
    `(b) [M2] the ping (${pingAt}) follows the evidence worktree's 'worktree add' (${worktreeAt})` +
    `${why(ctx)}`)
  const engineAt = s.findIndex((l) => /^engine:/.test(l))
  assert.ok(engineAt < 0 || engineAt > pingAt,
    `(b) [M2] the ping (${pingAt}) comes before any 'engine:' line (${engineAt}) — it is between ` +
    `prepare_evidence and check_engine${why(ctx)}`)

  // Nothing was started and nothing was published.
  assert.deepEqual(
    argvLines(ctx, 'systemd-run').filter((a) => a.some((w) => w.includes('fleet-engine-'))), [],
    '(b) [M2] no systemd-run argv names a fleet-engine- unit')
  assert.equal(prArgv(ctx), undefined, '(b) [M2] no PR was opened')

  // The evidence commit's subject, and the two tags of the record.
  const subjects = commitSubjects(ctx)
  assert.ok(subjects.includes(PARK_SUBJECT),
    `(b) [M2] a commit carries '-m ${PARK_SUBJECT}' exactly: ${JSON.stringify(subjects)}${whyGit(ctx)}`)
  assert.equal(subjects[subjects.length - 1], PARK_SUBJECT,
    '(b) [M2] and it is the run\'s last commit')
  for (const refspec of [PLAN_TAG_PUSH, EVIDENCE_TAG_PUSH]) {
    assert.ok(gitLog(ctx).some((a) => verbOf(a) === 'push' && a.includes(refspec)),
      `(b) [M2] the record is still made: a push carries '${refspec}'${whyGit(ctx)}`)
  }

  assert.ok(notifies(ctx).some((n) => n.title === PARK_NOTIFY),
    `(b) [M2] one notification titled '${PARK_NOTIFY}': ${JSON.stringify(notifies(ctx))}`)
})

// ── (c) the engine's argv  [M3] ──────────────────────────────────────────────

test('with the blob, --kata rides directly after --repo  [M3 / leg (c)]', async () => {
  const ctx = await kataGreen()
  const argv = engineArgv(ctx)
  assert.ok(argv, '(c) [M3] the engine unit ran')
  const repoAt = argv.indexOf('--repo')
  assert.ok(repoAt >= 0, `(c) [M3] the engine argv carries --repo: ${argv.join(' ')}`)
  assert.deepEqual(argv.slice(repoAt, repoAt + 4),
    ['--repo', targetDir(ctx), '--kata', kataFilePath(ctx)],
    `(c) [M3] '--repo <target> --kata <home>/plans/run-7.kata.json' are four consecutive ` +
    `elements: ${argv.join(' ')}`)
})

test('without the blob, no element of the engine argv is --kata  [M3 / leg (c)]', () => {
  const argv = engineArgv(green())
  assert.ok(argv, '(c) [M3] the engine unit ran')
  assert.ok(!argv.includes('--kata'),
    `(c) [M3] a run whose plan commit carries no kata.json passes no --kata: ${argv.join(' ')}`)
})

// ── (d) kata.jsonl on the evidence branch, and what a failed fetch does  [M4] ─

test('the export writes the hub\'s record as four lines beside events.jsonl  [M4 / leg (d)]', async () => {
  const ctx = await kataGreen()

  const lines = kataExportLines(ctx)
  assert.ok(lines, `(d) [M4] the evidence directory carries kata.jsonl${why(ctx)}`)
  assert.deepEqual(lines, KATA_LINES,
    '(d) [M4] exactly the two issue lines and then the two event lines, `kind` first')

  assert.deepEqual(issuesUrls(ctx).slice(0, 1), [ISSUES_URL],
    `(d) [M4] the issues URL is '${ISSUES_URL}' — the project id is the file's project.id, read ` +
    `with python3 and not the first "id" in the document${whyCurl(ctx)}`)
  assertEventPaging(ctx, '(d)')

  // Every commit of the run carries the file, `running` first. `events.jsonl`
  // is the engine's, and the `running` commit is made before the engine unit
  // exists (the boot's own order, unchanged here), so it is beside kata.jsonl
  // on every commit AFTER the first and is not asked of the first.
  const treeLines = trees(ctx)
  assert.ok(treeLines.length > 0, '(d) [M4] the run made evidence commits')
  for (const [i, t] of treeLines.entries()) {
    assert.ok(t.includes('kata.jsonl'),
      `(d) [M4] commit ${i + 1} of the run carries kata.jsonl: '${t}'`)
    if (i > 0) {
      assert.ok(t.includes('events.jsonl'),
        `(d) [M4] and, once the engine has run, it still carries events.jsonl beside it: '${t}'`)
    }
  }

  // M4's move into place: no temporary left beside the file it became.
  const dest = path.join(ctx.home, 'evidence', RUN_PATH)
  const strays = fs.readdirSync(dest).filter((n) => n !== 'kata.jsonl' && n.startsWith('kata'))
  assert.deepEqual(strays, [],
    '(d) [M4] the export is written to a temporary name and MOVED into place — nothing else ' +
    'named kata* is left behind')
})

test('a fetch that fails from the second transition on keeps the file and says so  [M4 / leg (d)]', async () => {
  // `STUB_KATA_ISSUES_EXIT` is an environment knob and an environment is fixed
  // for the life of a boot, so the fault is introduced the only way it can
  // arrive mid-run: the `curl` stub is replaced, after the `running` export has
  // written the file, by one that answers the issues URL with exit 22 and hands
  // every other URL to the rig's own stub unchanged.
  const ctx = makeHome()
  const run = bootAsync(ctx, ['boot'], { ...KATA_ENV, STUB_ENGINE_HOLD: '1' })
  const release = path.join(ctx.home, 'stub', 'engine-release')

  try {
    await waitFor('the engine unit to start (the `running` export is behind it)',
      () => fs.existsSync(path.join(ctx.home, 'stub', 'engine-alive')))

    assert.deepEqual(kataExportLines(ctx), KATA_LINES,
      `(d) [M4] the export at the 'running' commit is the hub's four lines${why(ctx)}`)
    assert.deepEqual(eventsUrls(ctx), EVENT_PAGES,
      `(d) [M4] and that one export paged 'after_id=0' then 'after_id=2' and stopped` +
      `${whyCurl(ctx)}`)

    const failing = PRELUDE
      + 'case "$*" in\n'
      + '  *kata.int.exe.xyz*/issues*) argv "curl" "$@"; say "curl kata issues"; exit 22 ;;\n'
      + 'esac\n'
      + STUBS.curl
    const tmp = path.join(ctx.bin, 'curl.next')
    fs.writeFileSync(tmp, failing)
    fs.chmodSync(tmp, 0o755)
    fs.renameSync(tmp, path.join(ctx.bin, 'curl'))
  } finally {
    fs.writeFileSync(release, '')
  }

  const r = await run
  assert.equal(r.status, 0,
    `(d) [M4] a failed export is not a failed run:\n${r.stdout}${r.stderr}`)
  assert.equal(statusOf(ctx).state, 'done', '(d) [M4] the run still ends done')

  assert.deepEqual(kataExportLines(ctx), KATA_LINES,
    `(d) [M4] the previous kata.jsonl is left exactly as it was${why(ctx)}`)
  assert.ok(stream(ctx).includes(EXPORT_FAILED(22)),
    `(d) [M4] the boot log carries exactly '${EXPORT_FAILED(22)}'${why(ctx)}`)
  for (const t of trees(ctx)) {
    assert.ok(t.includes('kata.jsonl'),
      `(d) [M4] and every commit still carries the kept file: '${t}'`)
  }
})

// ── (f) the run issue closes with the run  [M6 / #937] ───────────────────────

/** The curl argv of every close POST, in order. */
const closeArgv = (ctx) => curlArgv(ctx).filter((a) => a.includes(CLOSE_URL))
const writeFailed = (ctx) => evidenceEvents(ctx).filter((e) => e.kind === 'kata:write-failed')

/**
 * M6's shape, common to every disposition: exactly one POST, to the run
 * issue's own close action, keyed and attributed as the clause says. Returns
 * the one body for the caller to read the disposition off.
 */
function assertOneClose(ctx, label) {
  const argv = closeArgv(ctx)
  assert.equal(argv.length, 1,
    `${label} [M6] exactly one close is POSTed to '${CLOSE_URL}' — ${argv.length} were${whyCurl(ctx)}`)
  const a = argv[0]
  assert.ok(a.includes('-X') && a[a.indexOf('-X') + 1] === 'POST',
    `${label} [M6] and it is a POST: ${a.join(' ')}`)
  assert.ok(a.includes(`Idempotency-Key: ${CLOSE_KEY}`),
    `${label} [M6] carrying 'Idempotency-Key: ${CLOSE_KEY}': ${a.join(' ')}`)
  const bodies = kataCloses(ctx)
  assert.equal(bodies.length, 1, `${label} [M6] the rig logged exactly one close body`)
  const body = bodies[0]
  assert.equal(body.actor, CLOSE_ACTOR, `${label} [M6] the actor is '${CLOSE_ACTOR}'`)
  assert.equal(body.retry_protocol, 'close-v1', `${label} [M6] the body carries retry_protocol close-v1`)
  assert.equal(typeof body.message, 'string', `${label} [M6] the body carries a message`)
  return body
}

/** The close sits after the page's terminal write and before the export that
 *  carries it out — so `kata.jsonl` on the tag holds the `issue.closed`. */
function assertCloseBeforeLastExport(ctx, label, state) {
  const s = stream(ctx)
  const closeAt = s.findIndex((l) => l.includes('curl kata close'))
  const terminalAt = s.findIndex((l) => l.includes(`status: state=${state}`))
  const lastIssuesAt = s.reduce((at, l, i) => (l.includes('curl kata issues') ? i : at), -1)
  assert.ok(closeAt >= 0, `${label} [M6] the stream carries the close${why(ctx)}`)
  assert.ok(terminalAt >= 0 && closeAt > terminalAt,
    `${label} [M6] the close (${closeAt}) follows the terminal 'status: state=${state}' write ` +
    `(${terminalAt})${why(ctx)}`)
  assert.ok(lastIssuesAt > closeAt,
    `${label} [M6] and precedes the last export's issues read (${lastIssuesAt}) — the close rides ` +
    `kata.jsonl on the tag${why(ctx)}`)
}

test('a merged run closes its issue done, with the PR and the merge sha as evidence  [M6 / leg (f)]', async () => {
  const ctx = await kataGreen()
  assert.equal(statusOf(ctx).state, 'done', '(f) [M6] the run ended done')
  assert.equal(mergePuts(ctx).length, 1, '(f) [M6] and the sandbox merged its PR')

  const body = assertOneClose(ctx, '(f)')
  assert.equal(body.reason, 'done', '(f) [M6] a merged run closes `done`')
  assert.deepEqual(body.evidence,
    [{ type: 'pr', url: PR_URL }, { type: 'commit', sha: MERGE_SHA }],
    '(f) [M6] the evidence is the PR and then the squash commit the merge answered')
  assert.ok(body.message.length >= 40,
    `(f) [M6] the message is 40+ characters (kata refuses a shorter done): '${body.message}'`)
  assert.ok(body.message.includes(PLAN_H1),
    `(f) [M6] the message carries the plan's H1 '${PLAN_H1}': '${body.message}'`)
  assert.ok(body.message.includes(MERGE_SHA),
    `(f) [M6] and the merge sha: '${body.message}'`)
  assertCloseBeforeLastExport(ctx, '(f)', 'done')
  assert.deepEqual(writeFailed(ctx), [], '(f) [M6] a close the hub took records no kata:write-failed')
})

for (const [what, env, error] of [
  ['a parked run with a PR', { STUB_VERDICT: 'NEEDS_ACK' },
    'parked: gate verdict NEEDS_ACK'],
  ['a run with nothing ahead of base', { STUB_VERDICT: 'NEEDS_ACK', STUB_NO_COMMITS: '1' },
    'parked: ultra/integration-run-7 has no commits ahead of base (verdict NEEDS_ACK)'],
]) {
  test(`${what} closes its issue wontfix with the park reason and no evidence  [M6 / leg (f)]`, () => {
    const ctx = makeHome()
    const r = boot(ctx, ['boot'], { ...KATA_ENV, ...env })
    assert.equal(r.status, 0, `(f) [M6] the park exits 0:\n${r.stdout}${r.stderr}`)
    const page = statusOf(ctx)
    assert.equal(page.state, 'parked', `(f) [M6] the run parked${why(ctx)}`)
    assert.equal(page.error, error, `(f) [M6] with the error '${error}'`)

    const body = assertOneClose(ctx, '(f)')
    assert.equal(body.reason, 'wontfix', '(f) [M6] a parked run closes `wontfix`')
    assert.deepEqual(body.evidence, [], '(f) [M6] carrying no evidence — kata refuses any on a wontfix')
    assert.ok(body.message.includes(error),
      `(f) [M6] the message carries the page's error '${error}': '${body.message}'`)
    assert.ok(body.message.includes(PLAN_H1),
      `(f) [M6] and the plan's H1: '${body.message}'`)
    assertCloseBeforeLastExport(ctx, '(f)', 'parked')
    assert.deepEqual(writeFailed(ctx), [], '(f) [M6] and records no kata:write-failed')
  })
}

test('a hub that is dark at the close records one kata:write-failed, and the run still publishes and merges  [M6 / leg (f)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { ...KATA_ENV, STUB_KATA_CLOSE_EXIT: '7' })
  assert.equal(r.status, 0, `(f) [M6] a refused close is not a failed run:\n${r.stdout}${r.stderr}`)
  const page = statusOf(ctx)
  assert.equal(page.state, 'done', `(f) [M6] the run still ends done${why(ctx)}`)
  assert.equal(page.pr, PR_URL, '(f) [M6] its PR was opened')
  assert.equal(page.merged, MERGE_SHA, '(f) [M6] and merged')
  assert.equal(closeArgv(ctx).length, 1,
    `(f) [M6] the close was attempted exactly once${whyCurl(ctx)}`)

  const failed = writeFailed(ctx)
  assert.equal(failed.length, 1,
    `(f) [M6] exactly one kata:write-failed rides the evidence branch's events.jsonl: ` +
    `${JSON.stringify(failed)}${why(ctx)}`)
  assert.equal(failed[0].what, 'close', '(f) [M6] its `what` is close')
  assert.equal(failed[0].uid, RUN_UID, `(f) [M6] its \`uid\` is the run issue's, '${RUN_UID}'`)
  assert.ok(String(failed[0].detail).includes('curl exit 7'),
    `(f) [M6] and its \`detail\` names the curl exit: '${failed[0].detail}'`)
  assert.ok(typeof failed[0].id === 'string' && typeof failed[0].ts === 'number',
    '(f) [M6] the event carries the log\'s own `id` and `ts`')
  const last = commitStates(ctx)[commitStates(ctx).length - 1]
  assert.equal(last, 'done', `(f) [M6] the last evidence commit is the done page: ${JSON.stringify(commitStates(ctx))}`)
  assert.ok(trees(ctx)[trees(ctx).length - 1].includes('events.jsonl'),
    '(f) [M6] and it carries events.jsonl, so the refused write is on the tag')
})

test('without the blob no close is made  [M6 / leg (f)]', () => {
  const ctx = green()
  assert.deepEqual(closeArgv(ctx), [], `(f) [M6] a run without kata closes nothing${whyCurl(ctx)}`)
  assert.deepEqual(kataCloses(ctx), [], '(f) [M6] and the rig logged no close body')
})

// ── (e) the contract says all five things  [M5] ──────────────────────────────
//
// The same five readings the task's `Run:` lines take, taken here too so the
// exam itself fails a contract that is missing any one of the literals.

const HERE = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = () => {
  let dir = HERE
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'fleet', 'CONTRACT.md'))) return dir
    dir = path.dirname(dir)
  }
  assert.fail(`no fleet/CONTRACT.md above ${HERE}`)
}
const contractLines = () =>
  fs.readFileSync(path.join(repoRoot(), 'fleet', 'CONTRACT.md'), 'utf8').split('\n')
/** `sed -n '/from/,/to/p' … | tr '\n' ' '`, as one string. */
const section = (from, to) => {
  const all = contractLines()
  const start = all.findIndex((l) => from.test(l))
  assert.ok(start >= 0, `(e) [M5] fleet/CONTRACT.md has a line matching ${from}`)
  const rest = all.slice(start + 1)
  const end = rest.findIndex((l) => to.test(l))
  assert.ok(end >= 0, `(e) [M5] and a line matching ${to} below it`)
  return all.slice(start, start + 1 + end + 1).join(' ')
}
const evidenceBullet = () =>
  section(/^  - .ultra\/evidence-run-<N>/, /^  - .ultra\/integration-run-<N>/)
const bootBullet = () => section(/^- \*\*Boot script/, /^  - publish fold/)

test('the evidence bullet names kata.jsonl  [M5 / leg (e)]', () => {
  assert.ok(evidenceBullet().includes('kata.jsonl'),
    "(e) [M5] the `ultra/evidence-run-<N>` bullet lists `kata.jsonl` among the record's files")
})

for (const [what, literal] of [
  ['the engine line carries the knob', '--kata /home/exedev/plans/run-N.kata.json'],
  ['the park is named', 'parked: kata unreachable'],
  ['the ping keeps its retries', '--retry-connrefused'],
  ['the edge injects the peer key', 'peer key'],
  ['the run issue closes with the run (#937)', 'run-<N>:run:close'],
  ['and its actor is the sandbox', 'sandbox:run-<N>'],
]) {
  test(`the boot-script bullet: ${what}  [M5 / leg (e)]`, () => {
    assert.ok(bootBullet().includes(literal),
      `(e) [M5] the boot-script bullet carries '${literal}'`)
  })
}

runTests(tests)
