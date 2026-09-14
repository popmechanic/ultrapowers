/**
 * fleet/tests/test_sandbox_boot_park_state.mjs — the peer exam of #964: a run
 * that parks or fails does NOT close its run issue. It leaves the issue open
 * and writes what happened onto it as flat metadata — `work.state`,
 * `work.attention`, `work.attention_msg` — so the operator resolves and closes
 * it by hand. Only a gate-green run still closes, `done`, as it always did.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Every
 * assertion names the leg it belongs to and the clause it comes from, so a
 * reader can map this file back to the contract:
 *
 *   M1  For each of the three non-green exits of the boot — a parked run with a
 *       PR (gate verdict NEEDS_ACK), a run with nothing ahead of base, and an
 *       engine that exited non-zero — the boot makes NO request to the run
 *       issue's `actions/close` path and exactly one `POST` to
 *       `/api/v1/projects/<project>/issues/<run uid>/metadata` whose JSON body
 *       is `{"actor": "sandbox:run-<N>", "patch": {"work.state": <"parked" or
 *       "failed">, "work.attention": "needs-human", "work.attention_msg": <the
 *       page's error head>}}` — `work.state` `parked` for the two parks and
 *       `failed` for the engine exit, and `work.attention_msg` equal to the
 *       page's `error` cell's FIRST LINE.
 *   M2  A gate-green run makes exactly one metadata `POST` whose body is
 *       `{"actor": "sandbox:run-<N>", "patch": {"work.state": "done"}}` and then
 *       its one `actions/close` with reason `done`, IN THAT ORDER; and on the
 *       NEEDS_ACK park exit a metadata `POST` the hub refuses (curl non-zero)
 *       records one `kata:write-failed` event with `what` = `metadata`, makes no
 *       close, and the page still ends `parked`.
 *   M3  `fleet/CONTRACT.md`'s sentence that today says a parked or failed run
 *       closes its run issue `wontfix` says instead that such a run leaves its
 *       run issue OPEN and writes the three keys, naming all three; and the
 *       sentence that says `wontfix` is "the run issue's own park" no longer
 *       says so.
 *
 * The rig is `_sandbox_boot_helpers.mjs` — the stub bin dir, `makeHome`,
 * `bootAsync`, `statusOf` and the log readers — the same one
 * `test_sandbox_boot_kata.mjs` drives, with the same `KATA_ENV` (the blob whose
 * `project.id` is 42 and whose `run.uid` is `R7`). Ground truth for "which
 * request went out, with which words" is the tab-separated `curl.log` argv the
 * `curl` stub writes for every call it is handed — so a body is read back off
 * the `-d` word of the request that carried it, never off a stub arm that was
 * written to expect it.
 *
 * Three mechanics are worth naming, because a reader will otherwise wonder:
 *
 *   - THE FIVE BOOTS RUN SIDE BY SIDE. Each scenario is an independent run with
 *     its own home, its own stub counters and its own logs, so they are all
 *     started at module load and each leg awaits the one it reads. The promises
 *     never reject: a child that could not be started resolves as a result with
 *     a null status, which the leg that awaited it reports.
 *   - THE ENGINE THAT CRASHED, AND THE ONE THAT MERELY RULED. `STUB_ENGINE_CODE:
 *     '1'` alone is NOT the failed exit: `run-main` exits 1 on `gate-blocked`
 *     too, and the boot reads an exit of 1 WITH a gate receipt beside it as a
 *     verdict rather than a crash (`engine: exited 1 with a gate receipt — a
 *     verdict, not a crash`). The third exit of M1 is the `write_status failed
 *     "engine exit $code"` site, so this exam drives it the way
 *     `test_sandbox_boot_edges.mjs` does: `STUB_ENGINE_CODE: '1'` with
 *     `STUB_NO_RECEIPT: '1'`, an engine that died before its receipt. Its page
 *     `error` is two lines — `engine exited 1` and the engine's own tail — which
 *     is what makes M1's "the page's error cell's FIRST LINE" a live reading
 *     rather than a spelling of the whole cell.
 *   - THE REFUSED METADATA WRITE. M2's second half needs a hub that takes the
 *     ping and then refuses the metadata POST, which is the `STUB_KATA_META_EXIT`
 *     knob the task names. The knob lives in the shared rig, which is not this
 *     task's to edit, so the one case that needs it plants the arm in ITS OWN
 *     stub dir before booting — a `curl` that answers the metadata URL with the
 *     knob's exit when the knob is set and hands every other request (and every
 *     metadata request made without the knob) to the rig's own stub unchanged.
 *     The boot still runs under `STUB_KATA_META_EXIT: '7'`, so a rig that grows
 *     the knob answers exactly as this arm does and nothing here changes.
 *
 * No network, no systemd, no real `claude`: every call is a stub in
 * `FLEET_BIN_DIR` and every path is under `FLEET_HOME`.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PRELUDE, STUBS,
  makeHome, bootAsync,
  argvLines, stream, statusOf, kataCloses, evidenceEvents, runTests,
} from './_sandbox_boot_helpers.mjs'

// ── the literals of the hub ──────────────────────────────────────────────────

/** The hub the boot script defaults to. */
const KATA_URL = 'https://kata.int.exe.xyz'
/** The project the fixture's `project.id` names. */
const PROJECT_ID = 42
/** The run issue the fixture's `run.uid` names — the one this task leaves open. */
const RUN_UID = 'R7'
/** M1's endpoint, word for word. */
const META_URL = `${KATA_URL}/api/v1/projects/${PROJECT_ID}/issues/${RUN_UID}/metadata`
/** The close M1 forbids on a park and M2 still requires on a green run. */
const CLOSE_URL = `${KATA_URL}/api/v1/projects/${PROJECT_ID}/issues/${RUN_UID}/actions/close`
/** M1's actor: the sandbox, not the launcher and not the engine. */
const ACTOR = 'sandbox:run-7'

/** The three keys, spelled FLAT — the spelling kata stores (#960). */
const K_STATE = 'work.state'
const K_ATTENTION = 'work.attention'
const K_MSG = 'work.attention_msg'

/**
 * The `.ultrapowers/kata.json` the plan commit carries — the fixture
 * `test_sandbox_boot_kata.mjs` uses, with its DECOY `"id"` above the nested
 * `project.id`, so a boot that read the project id with a first-match reader
 * would ask the hub about `not-the-project` and every URL below would say so.
 */
const KATA_JSON = `{"run":{"uid":"${RUN_UID}","revision":1},"id":"not-the-project"`
  + `,"project":{"id":${PROJECT_ID},"key":"run-7"},"origin":"${KATA_URL}"}`

/** The env every kata boot rides: the blob, and the hub's two listings. */
const KATA_ENV = {
  STUB_KATA_JSON: KATA_JSON,
  STUB_KATA_ISSUES: '{"issues":[{"uid":"A","title":"t"},{"uid":"B","title":"u"}]}',
  STUB_KATA_EVENTS: '{"events":[{"event_id":1,"type":"issue.created"}]'
    + ',"next_after_id":1,"reset_required":false}',
}

// ── readers ──────────────────────────────────────────────────────────────────

const curlArgv = (ctx) => argvLines(ctx, 'curl')
/** Every request whose argv carries M1's metadata URL, in call order. */
const metaArgv = (ctx) => curlArgv(ctx).filter((a) => a.includes(META_URL))
/** Every request whose argv carries the run issue's close URL, in call order. */
const closeArgv = (ctx) => curlArgv(ctx).filter((a) => a.includes(CLOSE_URL))
/** Every URL this run asked for that ENDS `/actions/close` on the hub — the
 *  path M1 says a park makes no request to at all. */
const closeUrls = (ctx) =>
  curlArgv(ctx).flatMap((a) =>
    a.filter((s) => s.startsWith(KATA_URL) && s.endsWith('/actions/close')))
const writeFailed = (ctx) => evidenceEvents(ctx).filter((e) => e.kind === 'kata:write-failed')
/** The page's `error` cell's first line — M1's `work.attention_msg`. */
const errorHead = (ctx) => String(statusOf(ctx).error ?? '').split('\n')[0]

const why = (ctx) => `\n--- fleet-boot.log ---\n${stream(ctx).join('\n')}`
const whyCurl = (ctx) => `\n--- curl.log ---\n${curlArgv(ctx).map((a) => a.join(' ')).join('\n')}`

/** The JSON a request carried after `-d`, parsed. */
function bodyOf(argv, label) {
  const at = argv.indexOf('-d')
  assert.ok(at >= 0 && argv[at + 1] !== undefined,
    `${label} the request carries its JSON body after '-d': ${argv.join(' ')}`)
  try {
    return JSON.parse(argv[at + 1])
  } catch (error) {
    return assert.fail(`${label} and that body is JSON: '${argv[at + 1]}' — ${error.message}`)
  }
}

/**
 * M1's shape, common to every exit: exactly one POST to the run issue's own
 * metadata path. Returns the one body for the caller to read the patch off.
 */
function oneMetaPost(ctx, label) {
  const argv = metaArgv(ctx)
  assert.equal(argv.length, 1,
    `${label} exactly one POST goes to '${META_URL}' — ${argv.length} did${whyCurl(ctx)}`)
  const a = argv[0]
  assert.ok(a.includes('-X') && a[a.indexOf('-X') + 1] === 'POST',
    `${label} and it is a POST: ${a.join(' ')}`)
  return bodyOf(a, label)
}

// ── the runs ─────────────────────────────────────────────────────────────────

/**
 * One boot, started now and awaited by the leg that reads it. `prepare` runs
 * against the case's own home BEFORE the script does, for the one case that
 * plants a stub arm of its own.
 */
function launch(env, prepare) {
  const ctx = makeHome()
  if (prepare) prepare(ctx)
  return bootAsync(ctx, ['boot'], { ...KATA_ENV, ...env }).then(
    (r) => ({ ctx, r }),
    (error) => ({ ctx, r: { status: null, stdout: '', stderr: String(error) } }),
  )
}

/** The `curl` of the one case that needs the metadata write refused. */
function plantMetaKnob(ctx) {
  const arm = PRELUDE
    + 'case "$*" in\n'
    + '  *kata.int.exe.xyz/api/v1/projects/*/metadata*)\n'
    + '    if [ -n "${STUB_KATA_META_EXIT:-}" ]; then\n'
    + '      argv "curl" "$@"; say "curl kata metadata"; exit "$STUB_KATA_META_EXIT"\n'
    + '    fi ;;\n'
    + 'esac\n'
    + STUBS.curl
  const tmp = path.join(ctx.bin, 'curl.next')
  fs.writeFileSync(tmp, arm)
  fs.chmodSync(tmp, 0o755)
  fs.renameSync(tmp, path.join(ctx.bin, 'curl'))
}

/** M1's three non-green exits, M2's green one, and M2's refused write. */
const RUNS = {
  parkedWithPr: launch({ STUB_VERDICT: 'NEEDS_ACK' }),
  nothingAhead: launch({ STUB_VERDICT: 'NEEDS_ACK', STUB_NO_COMMITS: '1' }),
  // An engine that died BEFORE its receipt — see the header: an exit of 1 with a
  // receipt beside it is a verdict, not the crash M1's third exit names.
  engineExit: launch({ STUB_ENGINE_CODE: '1', STUB_NO_RECEIPT: '1' }),
  green: launch({}),
  metaRefused: launch({ STUB_VERDICT: 'NEEDS_ACK', STUB_KATA_META_EXIT: '7' }, plantMetaKnob),
}

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── (a) the three non-green exits leave the issue open  [M1] ─────────────────

for (const [what, key, state, exits0] of [
  ['a parked run with a PR (verdict NEEDS_ACK)', 'parkedWithPr', 'parked', true],
  ['a run with nothing ahead of base', 'nothingAhead', 'parked', true],
  ['an engine that exited non-zero', 'engineExit', 'failed', false],
]) {
  test(`${what} closes nothing and writes the three keys  [M1 / leg (a)]`, async () => {
    const { ctx, r } = await RUNS[key]
    if (exits0) {
      assert.equal(r.status, 0, `(a) [M1] the park exits 0:\n${r.stdout}${r.stderr}`)
    } else {
      assert.notEqual(r.status, 0, `(a) [M1] a failed engine is a failed boot:\n${r.stdout}${r.stderr}`)
    }
    // The exit this leg is about, named on the page before anything is read off
    // the wire: a run that took some other branch would answer every question
    // below about the wrong transition.
    assert.equal(statusOf(ctx).state, state,
      `(a) [M1] the page ends '${state}'${why(ctx)}`)

    // NO CLOSE. Not one request to the run issue's close action, and not one to
    // any close action on the hub.
    assert.deepEqual(closeUrls(ctx), [],
      `(a) [M1] a ${state} run makes NO request to a '/actions/close' path — the operator ` +
      `closes the run issue by hand${whyCurl(ctx)}`)
    assert.deepEqual(kataCloses(ctx), [],
      '(a) [M1] and the rig logged no close body at all')

    // ONE METADATA POST, and its body entire.
    const body = oneMetaPost(ctx, '(a) [M1]')
    assert.deepEqual(body, {
      actor: ACTOR,
      patch: {
        [K_STATE]: state,
        [K_ATTENTION]: 'needs-human',
        [K_MSG]: errorHead(ctx),
      },
    },
    `(a) [M1] the body is exactly {actor: '${ACTOR}', patch: {'${K_STATE}': '${state}', ` +
    `'${K_ATTENTION}': 'needs-human', '${K_MSG}': <the page's error head>}} — the three keys ` +
    `spelled flat, and the message the FIRST LINE of the page's error ` +
    `('${errorHead(ctx)}')${whyCurl(ctx)}`)

    // The page's error is the source of that message, and it is not empty: a
    // patch carrying an empty message would deep-equal an empty error cell.
    assert.ok(errorHead(ctx).length > 0,
      `(a) [M1] the page's error cell says why: '${JSON.stringify(statusOf(ctx).error)}'`)
  })
}

test('the failed run\'s message is the first line of a multi-line error  [M1 / leg (a)]', async () => {
  // M1 says `work.attention_msg` is the error cell's FIRST LINE, and the engine
  // exit is the exit whose cell has more than one: `engine exited 1` and the
  // engine's own last words under it. A patch carrying the whole cell fails
  // here; one carrying the first line passes.
  const { ctx } = await RUNS.engineExit
  const error = String(statusOf(ctx).error ?? '')
  assert.ok(error.includes('\n'),
    `(a) [M1] the failed page's error carries the engine's tail under its head: ` +
    `${JSON.stringify(error)}`)
  const body = oneMetaPost(ctx, '(a) [M1]')
  assert.equal(body.patch[K_MSG], error.split('\n')[0],
    `(a) [M1] and '${K_MSG}' is that first line alone`)
  assert.equal(body.patch[K_MSG], 'engine exited 1',
    `(a) [M1] which is 'engine exited 1'`)
})

// ── (b) the green run still closes, and a refused write is recorded  [M2] ────

test('a gate-green run writes work.state=done and then closes done  [M2 / leg (b)]', async () => {
  const { ctx, r } = await RUNS.green
  assert.equal(r.status, 0, `(b) [M2] the green boot exits 0:\n${r.stdout}${r.stderr}`)
  assert.equal(statusOf(ctx).state, 'done', `(b) [M2] the page ends 'done'${why(ctx)}`)

  const body = oneMetaPost(ctx, '(b) [M2]')
  assert.deepEqual(body, { actor: ACTOR, patch: { [K_STATE]: 'done' } },
    `(b) [M2] the body is exactly {actor: '${ACTOR}', patch: {'${K_STATE}': 'done'}} — the one ` +
    `key, and neither attention key on a run that needs no attention${whyCurl(ctx)}`)

  const closes = closeArgv(ctx)
  assert.equal(closes.length, 1,
    `(b) [M2] and the run issue is still closed, exactly once${whyCurl(ctx)}`)
  const bodies = kataCloses(ctx)
  assert.equal(bodies.length, 1, '(b) [M2] the rig logged exactly one close body')
  assert.equal(bodies[0].reason, 'done', "(b) [M2] whose reason is 'done'")

  // IN THAT ORDER: the metadata POST first, the close after it.
  const calls = curlArgv(ctx)
  const metaAt = calls.findIndex((a) => a.includes(META_URL))
  const closeAt = calls.findIndex((a) => a.includes(CLOSE_URL))
  assert.ok(metaAt >= 0 && closeAt >= 0 && metaAt < closeAt,
    `(b) [M2] the metadata POST (call ${metaAt}) is recorded BEFORE the close (call ${closeAt})` +
    `${whyCurl(ctx)}`)
})

test('a metadata write the hub refuses is one kata:write-failed, and still no close  [M2 / leg (b)]', async () => {
  const { ctx, r } = await RUNS.metaRefused
  assert.equal(r.status, 0,
    `(b) [M2] a refused metadata write is not a failed run:\n${r.stdout}${r.stderr}`)
  assert.equal(statusOf(ctx).state, 'parked',
    `(b) [M2] the page still ends 'parked'${why(ctx)}`)

  assert.equal(metaArgv(ctx).length, 1,
    `(b) [M2] the write was attempted exactly once${whyCurl(ctx)}`)
  assert.deepEqual(closeUrls(ctx), [],
    `(b) [M2] a write the hub refused is still not a close${whyCurl(ctx)}`)
  assert.deepEqual(kataCloses(ctx), [], '(b) [M2] and the rig logged no close body')

  const failed = writeFailed(ctx)
  assert.equal(failed.length, 1,
    `(b) [M2] exactly one kata:write-failed rides the evidence branch's events.jsonl: ` +
    `${JSON.stringify(failed)}${why(ctx)}`)
  assert.equal(failed[0].what, 'metadata',
    `(b) [M2] and its \`what\` is 'metadata': ${JSON.stringify(failed[0])}`)
})

// ── (c) the contract says the run issue is left open  [M3] ───────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = () => {
  let dir = HERE
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'fleet', 'CONTRACT.md'))) return dir
    dir = path.dirname(dir)
  }
  return assert.fail(`no fleet/CONTRACT.md above ${HERE}`)
}
const contractLines = () =>
  fs.readFileSync(path.join(repoRoot(), 'fleet', 'CONTRACT.md'), 'utf8').split('\n')

/**
 * The kata record bullet M3 names: the boot script's `- kata:` bullet, which is
 * where today's `a run whose page ends parked or failed closes that run issue
 * wontfix` sentence stands (~line 289). Read as ONE LINE — the sentence is
 * wrapped across several — from the bullet's own line down to the line before
 * the next bullet at its level.
 */
const kataRecordBullet = () => {
  const all = contractLines()
  const start = all.findIndex((l) => /^ {2}- kata: /.test(l))
  assert.ok(start >= 0, '(c) [M3] fleet/CONTRACT.md carries the boot script\'s `- kata:` bullet')
  const rest = all.slice(start + 1)
  const end = rest.findIndex((l) => /^ {2}- \S/.test(l))
  assert.ok(end >= 0, '(c) [M3] and a bullet at its own level below it')
  return all.slice(start, start + 1 + end).join(' ')
}

test('the kata record bullet says a parked or failed run is left open, with the three keys  [M3 / leg (c)]', () => {
  const bullet = kataRecordBullet()
  assert.match(bullet, /parked.*failed.*open.*work\.state.*work\.attention.*work\.attention_msg/,
    '(c) [M3] the bullet says a parked or failed run leaves its run issue OPEN and names all ' +
    `three keys — \`${K_STATE}\`, \`${K_ATTENTION}\`, \`${K_MSG}\`:\n${bullet}`)
})

test('and no longer says such a run closes it wontfix  [M3 / leg (c)]', () => {
  const bullet = kataRecordBullet()
  assert.doesNotMatch(bullet, /parked.*or.*failed.*closes that run issue .wontfix/,
    '(c) [M3] the old sentence — a run whose page ends `parked` or `failed` closes that run ' +
    `issue \`wontfix\` — is gone from the bullet:\n${bullet}`)
})

test("the `wontfix` sentence no longer calls it the run issue's own park  [M3 / leg (c)]", () => {
  const hits = contractLines().filter((l) => l.includes("never the engine's word about a task"))
  assert.equal(hits.length, 1,
    `(c) [M3] fleet/CONTRACT.md carries exactly one line saying \`wontfix\` is "never the ` +
    `engine's word about a task": ${JSON.stringify(hits)}`)
  assert.ok(!hits[0].includes("the run issue's own park"),
    `(c) [M3] and that line no longer says \`wontfix\` is "the run issue's own park" — the boot ` +
    `no longer closes a park: '${hits[0]}'`)
})

runTests(tests)
