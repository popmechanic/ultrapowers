/**
 * Exam for `fleet/sandbox-boot.sh` — the sandbox side of a run, end to end,
 * against stub binaries. This half is sections 1 and 2 — the whole green path
 * and the evidence branch; `test_sandbox_boot_edges.mjs` is the other half,
 * sections 3 through 10. The rig both halves share — the run's literals, the
 * stub bin dir, `makeHome`, `boot`, the log readers and `runTests` — is
 * `_sandbox_boot_helpers.mjs`.
 *
 * The three branches this exam holds the script to (#598) all live on the
 * TARGET repository: `ultra/plan-run-<N>` carries `.ultrapowers/plan.md` in,
 * the engine's own `ultra/integration-run-<N>` is the PR head, and
 * `ultra/evidence-run-<N>` — this script's, one commit per transition, never
 * merged — carries the receipts out. Nothing under `.claude/` is ever
 * committed, and the side repository the script used to clone is gone.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  SCRIPT,
  PLAN_SHA, BASE_SHA, ENGINE_SHA, HEAD_SHA, OTHER_SHA, TARGET, VM_NAME, PR_URL, PR_AUTHOR,
  PLAN_BRANCH, EVIDENCE_BRANCH, INTEGRATION_BRANCH, RUN_PATH, PLAN_PATH,
  EVIDENCE_LINK, PLAN_LINK, PLAN_ROW, RETIRED_NAMES, PLAN_H1, PLAN_BYTES,
  makeHome, boot, green,
  readLog, argvLines, stream, statusOf, states, indexOf, lastIndexOf, notifies,
  committed, commitStates, unitsRun, engineRuns, directCalls, prPosts, prArgv,
  integrationsReads,
  verbOf, dirOf, gitLog, evidenceDir, isEvidencePush, isIntegrationPush, addArguments,
  evidenceDisciplineProblem,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('the boot script parses', () => {
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0)
})

// ── 1. the whole green path ──────────────────────────────────────────────────

test('a gate-green run walks booting → running → publishing → done', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { FLEET_STATUS_INTERVAL: '1', STUB_ENGINE_SLEEP: '2' })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.deepEqual(states(ctx), ['booting', 'running', 'publishing', 'done'], 'no grant to await')

  const status = statusOf(ctx)
  assert.equal(status.run, '7')
  assert.equal(status.state, 'done')
  assert.equal(status.branch, INTEGRATION_BRANCH)
  assert.equal(status.vm, VM_NAME, 'the page names the VM incarnation, read from Reflection')
  assert.equal(status.pr, PR_URL, 'the PR is .html_url of the REST answer')
  assert.equal(status.prAuthor, PR_AUTHOR, 'and .user.login is recorded — a bot-authored PR is a fact on the page')
  assert.equal(status.error, null)
  assert.match(status.startedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.match(status.updatedAt, /^\d{4}-\d{2}-\d{2}T/)

  // The status page's phase is refreshed from the engine's own event log while
  // the engine runs — the last `engine:phase` line, not a guess.
  assert.ok(stream(ctx).some((l) => l === 'status: state=running phase=gate'),
    'expected a phase refresh from events.jsonl:\n' + stream(ctx).join('\n'))
  assert.deepEqual(directCalls(ctx), [], 'busybox, node, loginctl, ssh and gh are never run by this script')
})

test('two github integrations naming one repository fail the run before any clone', () => {
  // Measured 2026-09-03: the GitHub edge routes by repo path and documents no
  // tie-break between two integrations covering the same repo — a push under
  // the wrong credential is the result. The box refuses at second zero.  [M5/(g)]
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_DUPE: '1' })
  assert.notEqual(r.status, 0, 'a duplicate is fatal')
  const status = statusOf(ctx)
  assert.equal(status.state, 'failed')
  assert.match(status.error, /two github integrations on this VM name one repository/)
  assert.ok(status.error.includes('github.int.exe.xyz/popmechanic/smoke.git'), 'the error names the duplicated repo: ' + status.error)
  assert.ok(!status.error.includes('notes.git'), 'one integration naming its repo twice in its own help string is not a duplicate')
  assert.equal(readLog(ctx, 'git.log'), '', 'nothing is cloned — the preflight is before the clone')
  assert.equal(engineRuns(ctx), 0)
  assert.equal(integrationsReads(ctx), 1, 'one read of /integrations')
  assert.ok(indexOf(ctx, 'assignment: run-7') < indexOf(ctx, 'CALL curl integrations'), 'read after the assignment is parsed')
  assert.deepEqual(notifies(ctx).map((n) => n.title), ['run-7 failed'])
})

test('the status page is its own transient service, started once, before anything else', () => {
  const ctx = green()
  const H = ctx.home
  const status = argvLines(ctx, 'systemd-run').filter((a) => a.includes('--unit=fleet-status'))
  assert.equal(status.length, 1)
  assert.deepEqual(status[0], [
    'systemd-run', '--user', '--unit=fleet-status', '-p', 'Restart=on-failure', '--',
    'busybox', 'httpd', '-f', '-p', '8000', '-h', `${H}/www`,
  ])
  assert.ok(indexOf(ctx, 'CALL systemd-run status') < indexOf(ctx, 'status: state=booting'))
  // Asked first, so a restart never starts a second server on the port.
  assert.ok(argvLines(ctx, 'systemctl').some((a) => a.join(' ') === 'systemctl --user is-active fleet-status.service'))
})

test('a status server that is already active is not started again', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_STATUS_ACTIVE: 'active' }).status, 0)
  // The engine and, since run-32 (#715), the publish fold — never a second
  // `fleet-status`, which is this case's claim.
  assert.deepEqual(unitsRun(ctx), ['fleet-engine-7', 'fleet-fold-7-1'],
    'only the engine and the fold are started')
  // The boot script IS the run unit's process (fleet-run@7.service); it asks
  // systemd only about the engine unit and the page, never about itself.
  assert.ok(!argvLines(ctx, 'systemctl').some((a) => a.some((s) => s.includes('fleet-run'))),
    'no systemctl call names the run unit')
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('fleet-status.service already active'))
})

test('the assignment comes from FLEET_ASSIGNMENT; Reflection is asked only for the name', () => {
  const ctx = green()
  assert.equal(stream(ctx).filter((l) => l.startsWith('CALL curl comment')).length, 0,
    'the bootstrap already read the comment; this script does not read it again')
  assert.ok(indexOf(ctx, 'CALL curl name') >= 0)
})

test('the target is the only clone, and it is left at base — the engine is never cloned  [M4]', () => {
  const ctx = green()
  const git = gitLog(ctx)
  const H = ctx.home

  const clones = git.filter((a) => a[1] === 'clone')
  assert.equal(clones.length, 1, 'one clone: the target. There is no side repository any more.')
  assert.deepEqual(clones[0], ['git', 'clone', `https://github.int.exe.xyz/${TARGET}.git`, `${H}/target`])
  assert.ok(git.some((a) => a.join(' ') === `git -C ${H}/target checkout ${BASE_SHA}`),
    'the clone is put at base')

  // The engine is the bootstrap's: no git command names it.
  assert.deepEqual(git.filter((a) => a.join(' ').includes('/engines/')), [])
  assert.deepEqual(git.filter((a) => a.join(' ').includes('ultrapowers.git')), [])

  // The clone is LEFT at base: the integration branch is the engine's to create.
  assert.equal(git.filter((a) => a.includes('switch')).length, 0)
  assert.deepEqual(
    git.filter((a) => a.some((s) => s === INTEGRATION_BRANCH)).map((a) => verbOf(a)).sort(),
    ['push', 'rev-list', 'rev-parse'],
    'the run branch is only counted against base, pushed, and read back for its head — never created or switched to')
})

test('the plan comes off the target\'s plan branch, before the engine  [M1 / leg (a)]', () => {
  const ctx = green()
  const H = ctx.home
  const git = gitLog(ctx)

  // The fetch, spelled as M1 spells it.
  const fetch = git.filter((a) =>
    verbOf(a) === 'fetch' && a.some((s) => s === `refs/heads/${PLAN_BRANCH}`))
  assert.equal(fetch.length, 1, 'the plan branch is fetched once')
  assert.deepEqual(fetch[0],
    ['git', '-C', `${H}/target`, 'fetch', 'origin', `refs/heads/${PLAN_BRANCH}`])

  // …after the target clone and before the engine's unit.
  const clone = indexOf(ctx, `git clone https://github.int.exe.xyz/${TARGET}.git`)
  const fetchAt = indexOf(ctx, `fetch origin refs/heads/${PLAN_BRANCH}`)
  const engineAt = indexOf(ctx, 'CALL systemd-run engine')
  assert.ok(clone >= 0 && fetchAt >= 0 && engineAt >= 0,
    'clone, fetch and engine must all appear:\n' + stream(ctx).join('\n'))
  assert.ok(clone < fetchAt, 'the plan is fetched into the target clone, so after it')
  assert.ok(fetchAt < engineAt, 'and before the engine is started')

  // What landed is checked against the assignment.
  assert.ok(git.some((a) => verbOf(a) === 'rev-parse' && a.includes('FETCH_HEAD')),
    'FETCH_HEAD is read back')
  assert.ok(indexOf(ctx, 'rev-parse FETCH_HEAD') > fetchAt, 'and read back after the fetch')

  // The plan blob is written to the path the engine's argv carries.
  assert.ok(git.some((a) => verbOf(a) === 'show' && a.includes(`${PLAN_SHA}:${PLAN_PATH}`)),
    `expected 'git show ${PLAN_SHA}:${PLAN_PATH}' in:\n` +
      git.map((a) => a.join(' ')).join('\n'))
  const plan = path.join(H, 'plans', 'run-7.md')
  assert.ok(fs.existsSync(plan), `${plan} must be written from the plan commit`)
  assert.equal(fs.readFileSync(plan, 'utf8'), PLAN_BYTES, 'byte for byte, what git show handed back')

  // …and that file is the one `plan_title` reads, so the PR's title proves the
  // plan travelled the whole way.
  assert.equal(prPosts(ctx)[0].title, `fleet run-7: ${PLAN_H1}`,
    'the PR title reads the H1 of the plan fetched from the plan branch')
})

test('the gate verdict record lands beside the plan under the compiler\'s name  [M1]', () => {
  const ctx = green()
  const H = ctx.home
  const verdicts = path.join(H, 'plans', 'run-7.gate-verdicts.json')
  assert.ok(fs.existsSync(verdicts), 'run-7.gate-verdicts.json is not beside plans/run-7.md')
  assert.deepEqual(JSON.parse(fs.readFileSync(verdicts, 'utf8')),
    { tasks: { 1: { verdict: 'pass' } }, tally: { tasks: 1 } },
    'the record is the branch\'s .ultrapowers/gate-verdicts.json, byte for byte')
  const shows = argvLines(ctx, 'git').filter((a) => a[1] === '-C' && a[3] === 'show')
  assert.ok(shows.some((a) => a[4] === `${PLAN_SHA}:.ultrapowers/gate-verdicts.json`),
    'the record is read out of the plan commit, not from anywhere else')
})

test('a plan branch without a verdict record is a legacy-grammar plan, not a failure  [M1]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_NO_VERDICTS: '1' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const H = ctx.home
  assert.ok(!fs.existsSync(path.join(H, 'plans', 'run-7.gate-verdicts.json')), 'no record is invented')
  assert.ok(fs.existsSync(path.join(H, 'plans', 'run-7.md')), 'the plan itself still lands')
  assert.equal(statusOf(ctx).state, 'done', 'the run proceeds without a record')
})

test('the engine is a transient service with the contract argv; only its child env carries the Anthropic pair  [M1, M5/(g)]', () => {
  const ctx = green()
  const H = ctx.home
  const engine = argvLines(ctx, 'systemd-run').filter((a) => a.includes('--unit=fleet-engine-7'))
  assert.equal(engine.length, 1)
  assert.deepEqual(engine[0], [
    'systemd-run', '--user', '--unit=fleet-engine-7', '--pipe', '--wait', '--collect',
    '-p', 'MemoryMax=40G', '-p', 'MemorySwapMax=0', '-p', `WorkingDirectory=${H}/target`, '--',
    'env', '-u', 'CLAUDE_CONFIG_DIR',
    'ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz',
    'CLAUDE_CODE_OAUTH_TOKEN=placeholder',
    'ULTRAPOWERS_FLEET_RUN=run-7',
    'node', `${H}/engines/${ENGINE_SHA}/fleet/run-main.mjs`,
    // The plan path, and nothing else in this argv, is what M1 moved.
    `${H}/plans/run-7.md`, 'run-7', '--repo', `${H}/target`,
    '--tier', 'mostCapable', '--overlap', 'fold',
  ])
  assert.equal(argvLines(ctx, 'systemd-run').filter((a) => a.includes('--scope')).length, 0, 'never a scope')

  // The environment the engine's launcher inherited — i.e. the boot script's —
  // carries neither variable; the pair exists only as the child's `env` prefix.
  const childless = readLog(ctx, 'systemd-run.env')
  assert.ok(!/^ANTHROPIC_BASE_URL=/m.test(childless), 'boot env must not carry ANTHROPIC_BASE_URL')
  assert.ok(!/^CLAUDE_CODE_OAUTH_TOKEN=/m.test(childless), 'boot env must not carry the OAuth var')
  // …and CLAUDE_CONFIG_DIR is present in the boot env precisely so the child's
  // `env -u` above is doing real work.
  assert.ok(/^CLAUDE_CONFIG_DIR=/m.test(childless))

  // `claude auth status` is logged before the engine starts.
  assert.ok(indexOf(ctx, 'CALL claude auth status') >= 0)
  assert.ok(indexOf(ctx, 'CALL claude auth status') < indexOf(ctx, 'CALL systemd-run engine'))
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('claude auth status: authMethod: oauth_token'))
  assert.equal(readLog(ctx, 'npm.log'), '', 'node_modules present: nothing to install')
})

test('a plan branch whose head is not the assignment\'s plan= fails the run  [M1 / leg (b)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_FETCH_HEAD: OTHER_SHA })
  assert.notEqual(r.status, 0, 'a plan the launcher did not sign is fatal')
  const status = statusOf(ctx)
  assert.equal(status.state, 'failed')
  assert.ok(status.error.includes(PLAN_BRANCH),
    'the error names the plan branch: ' + status.error)
  assert.equal(engineRuns(ctx), 0, 'no systemd-run of the engine is issued')
  assert.equal(indexOf(ctx, 'CALL systemd-run engine'), -1)
  assert.equal(prPosts(ctx).length, 0)
})

test('missing deps are installed in the engine checkout when its package.json declares any', () => {
  const ctx = makeHome({ packageJson: '{"dependencies":{"ws":"8"}}', nodeModules: false })
  assert.equal(boot(ctx).status, 0)
  assert.deepEqual(argvLines(ctx, 'npm'), [['npm', 'install', '--no-audit', '--no-fund']],
    'no lockfile in the tree, so install rather than ci')
  assert.ok(stream(ctx).some((l) => l === `CALL npm install in ${ctx.home}/engines/${ENGINE_SHA}/fleet`))
  assert.ok(indexOf(ctx, 'CALL npm install') < indexOf(ctx, 'CALL systemd-run engine'))
})

test('an engine checkout the bootstrap did not leave fails the run, on the evidence branch  [M2]', () => {
  const ctx = makeHome()
  fs.rmSync(path.join(ctx.home, 'engines'), { recursive: true })
  const r = boot(ctx)
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(ctx).state, 'failed')
  assert.match(statusOf(ctx).error, /no fleet\/run-main\.mjs/)
  assert.equal(engineRuns(ctx), 0)
  // This failure is AFTER the clone, so M2's rule applies: the failed page is
  // committed and pushed on the evidence branch.
  assert.equal(commitStates(ctx)[commitStates(ctx).length - 1], 'failed')
  assert.ok(gitLog(ctx).some(isEvidencePush), 'and pushed to the evidence branch')
})

test('publishing is claimed only after systemd reports the engine service inactive  [M5/(g)]', () => {
  const ctx = green()
  const check = indexOf(ctx, 'CALL systemctl is-active fleet-engine-7.service')
  const claim = indexOf(ctx, 'status: state=publishing')
  assert.ok(check >= 0, 'the service must be checked')
  assert.ok(claim >= 0)
  assert.ok(check < claim, 'the inactive check precedes the publishing claim')
  assert.ok(argvLines(ctx, 'systemctl').some((a) =>
    a.join(' ') === 'systemctl --user is-active fleet-engine-7.service'))
  assert.equal(argvLines(ctx, 'systemctl').filter((a) => a.join(' ').includes('.scope')).length, 0)
})

test('the branch is pushed after the engine is inactive, and the PR is one REST POST through the edge  [M5/(g)]', () => {
  const ctx = green()
  const inactive = indexOf(ctx, 'CALL systemctl is-active fleet-engine-7.service')
  const push = indexOf(ctx, `${ctx.home}/target push origin ${INTEGRATION_BRANCH}`)
  const pr = indexOf(ctx, 'CALL curl pr create')
  assert.ok(push > inactive, 'the branch is pushed only after the engine service is inactive')
  assert.ok(pr > push, 'the PR follows the push')

  // Nothing is polled after the gate: /integrations was read once, in the
  // preflight, before the clone.
  assert.equal(integrationsReads(ctx), 1, 'one read of /integrations, ever')
  assert.ok(indexOf(ctx, 'CALL curl integrations') < indexOf(ctx, 'git clone'), 'and that read is before any clone')

  const H = ctx.home
  const gitPush = gitLog(ctx).find(isIntegrationPush)
  assert.deepEqual(gitPush, ['git', '-C', `${H}/target`, 'push', 'origin', INTEGRATION_BRANCH])

  // The REST call: POST, the edge's /api/v3 path for the target, a JSON
  // content type, and the payload inline after -d. gh is never run.
  const curl = prArgv(ctx)
  assert.ok(curl, 'a curl to /pulls was made')
  assert.ok(curl.includes('-X') && curl[curl.indexOf('-X') + 1] === 'POST', 'it is a POST')
  assert.ok(curl.includes(`https://github.int.exe.xyz/api/v3/repos/${TARGET}/pulls`), 'to the edge, under /api/v3/repos/<owner>/<repo>')
  assert.ok(curl.includes('-H') && curl[curl.indexOf('-H') + 1] === 'content-type: application/json', 'as JSON')
  assert.ok(curl.includes('-d'), 'with a payload')
  assert.equal(argvLines(ctx, 'gh').length, 0, 'gh is not used')
  assert.ok(stream(ctx).some((l) => l.includes('symbolic-ref refs/remotes/origin/HEAD')), 'the base is read from the clone')

  const posts = prPosts(ctx)
  assert.equal(posts.length, 1)
  assert.equal(posts[0].head, INTEGRATION_BRANCH)
  assert.equal(posts[0].base, 'main', 'base is what origin/HEAD pointed at')
  assert.equal(posts[0].draft, false, 'PASS is a ready PR')

  // Both halves of the answer are logged, so a bot-authored PR is readable
  // off the box.
  assert.ok(stream(ctx).some((l) => l === `publish: ${PR_URL} (base main, draft false)`))
  assert.ok(stream(ctx).some((l) => l === `publish: author ${PR_AUTHOR}`))
})

test('the PR body links the evidence branch and the plan branch, and names the plan blob  [M3 / leg (e)]', () => {
  const ctx = green()
  const body = prPosts(ctx)[0].body

  // The rendered card, less the trailing newline a command substitution drops.
  const rendered = path.join(evidenceDir(ctx), RUN_PATH, 'pr-body.md')
  assert.ok(fs.existsSync(rendered), 'the card is rendered into the evidence worktree')
  assert.equal(body, fs.readFileSync(rendered, 'utf8').trimEnd(), 'the body is the rendered card')

  assert.ok(body.includes('### Evidence'), 'the card has an Evidence section')
  assert.ok(body.includes(EVIDENCE_LINK),
    `### Evidence must link ${EVIDENCE_LINK}\n---\n${body}`)
  assert.ok(body.includes('### Plan'), 'the card has a Plan section')
  assert.ok(body.includes(PLAN_LINK),
    `### Plan must link ${PLAN_LINK}\n---\n${body}`)
  assert.ok(body.includes(PLAN_ROW),
    `the plan row must read exactly: ${PLAN_ROW}\n---\n${body}`)

  // The Evidence link belongs to the Evidence section and the Plan link to the
  // Plan section — not both dumped in one place.
  const evidenceSection = body.slice(body.indexOf('### Evidence'))
  assert.ok(evidenceSection.includes(EVIDENCE_LINK), 'the evidence link follows its own heading')
  const planSection = body.slice(body.indexOf('### Plan'))
  assert.ok(planSection.includes(PLAN_LINK), 'the plan link follows its own heading')

  assert.ok(body.includes('PASS'), 'the card carries the verdict')
  assert.ok(body.includes('### Checks'), 'the card carries the checks')
  assert.ok(body.includes(VM_NAME), 'the card names the VM')
  for (const name of RETIRED_NAMES) {
    assert.ok(!body.includes(name), `the card must not name ${name}:\n${body}`)
  }
})

// ── the PR closes what the plan names, and links the tags ────────────────────
// Task 2 of run-25 (#679, #624). `render_card` reads ONE line out of
// `$PLAN_FILE` — the first `**Closes:**` line after `**Goal:**` and before the
// first `### ` heading — and turns its `#<digits>` tokens into the body's last
// lines, so the self-merge closes exactly those issues; and the two card links
// name the two tags rather than the two branches.

/** The body's `Closes` lines, in the order the card wrote them. */
const closesLines = (body) => body.split('\n').filter((l) => /^Closes\b/.test(l))

/**
 * A run whose plan carries `**Goal:** … #653 #655`, a plain prose line naming
 * #888, and `**Closes:** #660 #668`. Memoized: legs (a) and (c) both read it.
 */
let CLOSES_RUN = null
const CLOSES_EXTRA = '**Goal:** ship the two tickets #653 #655\n' +
  'see #888 for the decision\n' +
  '**Closes:** #660 #668'
const closesRun = () => {
  if (!CLOSES_RUN) {
    CLOSES_RUN = makeHome()
    const r = boot(CLOSES_RUN, ['boot'], { STUB_PLAN_EXTRA: CLOSES_EXTRA })
    assert.equal(r.status, 0, r.stdout + r.stderr)
  }
  return CLOSES_RUN
}

test('the plan\'s `**Closes:**` line becomes the body\'s last lines, one per issue  [M1 / leg (a)]', () => {
  const ctx = closesRun()

  // The only carrier: `STUB_PLAN_EXTRA` rides the `git show
  // <plan>:.ultrapowers/plan.md` answer, which `prepare_plan` writes to
  // `$PLAN_FILE` — so a `render_card` reading any other source sees no
  // `**Closes:**` line at all.  [leg (a)]
  const plan = path.join(ctx.home, 'plans', 'run-7.md')
  assert.equal(fs.readFileSync(plan, 'utf8'), `${PLAN_BYTES}${CLOSES_EXTRA}\n`,
    `${plan} must be the git show answer byte for byte, extra and all`)

  const body = prPosts(ctx)[0].body
  const bodyLines = body.split('\n')
  assert.deepEqual(bodyLines.slice(-2), ['Closes #660', 'Closes #668'],
    'the body\'s last two lines are the two Closes lines, in the plan\'s order:\n---\n' + body)
  assert.deepEqual(closesLines(body), ['Closes #660', 'Closes #668'],
    'and they are the ONLY Closes lines anywhere in the body:\n---\n' + body)

  assert.equal(statusOf(ctx).state, 'done', 'the run still ends done')
})

test('a plan with no `**Closes:**` line closes nothing  [M2 / leg (b)]', () => {
  // The memoized green run's plan is `# <H1>`, a blank line and `body`.
  const ctx = green()
  const body = prPosts(ctx)[0].body
  assert.deepEqual(body.split('\n').filter((l) => /^Closes #/.test(l)), [],
    'no line may begin `Closes #` when the plan named no issues:\n---\n' + body)
})

test('a `#<digits>` anywhere but that one line closes nothing  [M1, M3 / leg (c)]', () => {
  // (c.1) The Goal line's own numbers, and a prose line's, are not tickets to
  // close — a reader that scrapes every `#\d+` after `**Goal:**` fails here.
  const body = prPosts(closesRun())[0].body
  for (const n of ['#653', '#655', '#888']) {
    assert.ok(!body.includes(`Closes ${n}`),
      `\`Closes ${n}\` must not appear — ${n} is on the Goal line or in prose:\n---\n${body}`)
  }

  // (c.2) A `**Closes:**` line after the first `### ` heading is out of the
  // header block, so it closes nothing at all.
  const after = makeHome()
  assert.equal(boot(after, ['boot'], {
    STUB_PLAN_EXTRA: '**Goal:** x\n\n### Task 1: x\n\n**Closes:** #999',
  }).status, 0)
  const afterBody = prPosts(after)[0].body
  assert.ok(!afterBody.includes('Closes #999'),
    'a `**Closes:**` line below the first `### ` heading closes nothing:\n---\n' + afterBody)
  assert.deepEqual(afterBody.split('\n').filter((l) => /^Closes #/.test(l)), [],
    'and no `Closes #` line at all is produced:\n---\n' + afterBody)
  assert.equal(statusOf(after).state, 'done')

  // (c.3) The line read is the first one AFTER `**Goal:**`, not the first one
  // in the file — a `**Closes:**` above the Goal line is not it.
  const before = makeHome()
  assert.equal(boot(before, ['boot'], {
    STUB_PLAN_EXTRA: '**Closes:** #777\n**Goal:** x\n**Closes:** #660',
  }).status, 0)
  const beforeBody = prPosts(before)[0].body
  assert.deepEqual(closesLines(beforeBody), ['Closes #660'],
    'exactly one Closes line, the one below `**Goal:**`:\n---\n' + beforeBody)
  assert.ok(!beforeBody.includes('Closes #777'),
    'the `**Closes:**` line above `**Goal:**` is not the line:\n---\n' + beforeBody)
  assert.equal(statusOf(before).state, 'done')

  // (c.4) Exactly the FIRST such line, not every such line.
  const twice = makeHome()
  assert.equal(boot(twice, ['boot'], {
    STUB_PLAN_EXTRA: '**Goal:** x\n**Closes:** #660\n**Closes:** #661',
  }).status, 0)
  const twiceBody = prPosts(twice)[0].body
  assert.deepEqual(twiceBody.split('\n').filter((l) => /^Closes #/.test(l)), ['Closes #660'],
    'the second `**Closes:**` line is not read:\n---\n' + twiceBody)
  assert.ok(!twiceBody.includes('Closes #661'),
    '`Closes #661` must not appear anywhere in the body:\n---\n' + twiceBody)
  assert.equal(statusOf(twice).state, 'done')
})

test('the card links the two tags, each under its own heading  [M4 / leg (d)]', () => {
  // #624 decision c: the plan link is the TAG path, so it keeps resolving after
  // the branches are gone. The tags are `ultra/plan/run-<N>` and
  // `ultra/evidence/run-<N>`; the branches keep their own spellings.
  const PLAN_TAG_LINK = `https://github.com/${TARGET}/blob/ultra/plan/run-7/${PLAN_PATH}`
  const EVIDENCE_TAG_LINK = `https://github.com/${TARGET}/tree/ultra/evidence/run-7/${RUN_PATH}/`
  assert.equal(PLAN_TAG_LINK, 'https://github.com/popmechanic/smoke/blob/ultra/plan/run-7/.ultrapowers/plan.md')
  assert.equal(EVIDENCE_TAG_LINK, 'https://github.com/popmechanic/smoke/tree/ultra/evidence/run-7/.ultrapowers/runs/7/')

  // The shared literals move with the card: the constants the BASE "PR body
  // links" test pins are these two strings.
  assert.equal(PLAN_LINK, PLAN_TAG_LINK, 'PLAN_LINK is the plan tag path')
  assert.equal(EVIDENCE_LINK, EVIDENCE_TAG_LINK, 'EVIDENCE_LINK is the evidence tag path')

  const body = prPosts(green())[0].body

  // Each link under its OWN heading — the section running from its `### `
  // heading to the next one.
  const section = (heading) => {
    const at = body.indexOf(heading)
    assert.ok(at >= 0, `the card must carry a ${heading} heading:\n---\n${body}`)
    const rest = body.slice(at + heading.length)
    const next = rest.indexOf('\n### ')
    return next < 0 ? rest : rest.slice(0, next)
  }
  const evidenceSection = section('### Evidence')
  const planSection = section('### Plan')
  assert.ok(evidenceSection.includes(EVIDENCE_TAG_LINK),
    `### Evidence must link ${EVIDENCE_TAG_LINK}\n---\n${body}`)
  assert.ok(planSection.includes(PLAN_TAG_LINK),
    `### Plan must link ${PLAN_TAG_LINK}\n---\n${body}`)
  assert.ok(!evidenceSection.includes(PLAN_TAG_LINK), 'the plan link is not under ### Evidence')
  assert.ok(!planSection.includes(EVIDENCE_TAG_LINK), 'the evidence link is not under ### Plan')

  // Neither branch path survives anywhere in the card.
  assert.ok(!body.includes('blob/ultra/plan-run-7'),
    'the card must not link the plan BRANCH path:\n---\n' + body)
  assert.ok(!body.includes('tree/ultra/evidence-run-7'),
    'the card must not link the evidence BRANCH path:\n---\n' + body)

  // The table row is untouched: the plan blob at the plan sha.
  assert.ok(body.includes(PLAN_ROW),
    `the plan row must still read exactly: ${PLAN_ROW}\n---\n${body}`)
})

test('the PR is opened only after the edge reports the pushed head on the branch  [M5/(g)]', () => {
  // GitHub's index lags the push, and a PR opened before the branch is indexed
  // gets no `pull_request` CI run (#595). The edge answers 404 twice, then the
  // branch document with the pushed sha — and only then is /pulls asked.
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_BRANCH_404: '2' }).status, 0)
  const s = stream(ctx)
  const push = indexOf(ctx, `${ctx.home}/target push origin ${INTEGRATION_BRANCH}`)
  const reads = s.map((l, i) => (l.startsWith('CALL curl branches') ? i : -1)).filter((i) => i >= 0)
  const pr = indexOf(ctx, 'CALL curl pr create')
  assert.equal(reads.length, 3, 'two 404s and one 200 — polling stops at the first match')
  assert.ok(reads[0] > push, 'the branch is asked for only after it is pushed')
  assert.ok(reads[2] < pr, 'the POST follows the 200')

  // In the curl argv log the three branch reads sit between the push and the
  // POST, and the POST is the very next curl after the last of them.
  const curls = argvLines(ctx, 'curl')
  const branchUrl = `https://github.int.exe.xyz/api/v3/repos/${TARGET}/branches/${INTEGRATION_BRANCH}`
  const branchIdx = curls.map((a, i) => (a.includes(branchUrl) ? i : -1)).filter((i) => i >= 0)
  const prIdx = curls.findIndex((a) => a.some((u) => u.endsWith('/pulls')))
  assert.equal(branchIdx.length, 3)
  assert.equal(prIdx, branchIdx[2] + 1, 'the PR POST is the next curl after the branch became visible')
  assert.ok(!curls[branchIdx[0]].includes('-f'), 'a 404 is an answer, not a curl failure')
  assert.ok(!curls[branchIdx[0]].includes('-X'), 'the branch read is a GET')
  assert.ok(s.some((l) => new RegExp(`^publish: branch ${INTEGRATION_BRANCH} visible at the edge as d4d4.* after \\d+s$`).test(l)),
    'one line says when the branch became visible: ' + s.filter((l) => l.startsWith('publish:')).join(' | '))
  assert.ok(!s.some((l) => l.includes('not yet visible')), 'no timeout was logged')
  assert.equal(prPosts(ctx).length, 1)
  assert.equal(statusOf(ctx).state, 'done')
})

test('a branch the edge never shows within the wait still gets its PR, and the timeout is logged  [M5/(g)]', () => {
  // A PR without a CI run is one the operator can re-trigger by hand; no PR
  // is nothing to re-trigger. Three seconds of wait at a zero poll step is
  // four reads, then the POST anyway.
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_BRANCH_NEVER: '1', PUBLISH_BRANCH_WAIT: '3' }).status, 0)
  const s = stream(ctx)
  const reads = s.filter((l) => l.startsWith('CALL curl branches')).length
  assert.equal(reads, 4, 'polled for the whole wait, then gave up')
  assert.ok(lastIndexOf(ctx, 'CALL curl branches') < indexOf(ctx, 'CALL curl pr create'), 'the POST follows the last read')
  assert.ok(s.some((l) => l === `publish: branch ${INTEGRATION_BRANCH} not yet visible at the edge as ${HEAD_SHA} after 3s — opening the PR anyway; its CI run may need a re-trigger`),
    'the timeout is one log line: ' + s.filter((l) => l.startsWith('publish:')).join(' | '))
  assert.ok(!s.some((l) => l.includes(' visible at the edge as ') && !l.includes('not yet')), 'no "became visible" line')
  assert.equal(prPosts(ctx).length, 1, 'the PR is opened anyway')
  assert.equal(statusOf(ctx).state, 'done')
  assert.equal(statusOf(ctx).pr, PR_URL)
})

test('the base is the default branch the clone advertised, whatever it is called', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_HEAD_REF: 'refs/remotes/origin/master' }).status, 0)
  assert.equal(prPosts(ctx)[0].base, 'master')

  // A remote that advertised no HEAD is a failure, not a guess: a PR against
  // a guessed branch is refused by GitHub or, worse, opened against the wrong
  // one.
  const none = makeHome()
  const r = boot(none, ['boot'], { STUB_HEAD_REF: 'none' })
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(none).state, 'failed')
  assert.match(statusOf(none).error, /default branch/)
  assert.equal(prPosts(none).length, 0, 'no PR is attempted without a base')
})

test('the notification names the run, the outcome, the target and the PR', () => {
  const ctx = green()
  assert.deepEqual(notifies(ctx), [
    { title: 'run-7 done', message: `${TARGET} — ${PR_URL}` },
  ], 'one notification: the PR is the thing to act on, and there is no grant to ask for')
})

// ── 2. the evidence branch ───────────────────────────────────────────────────

test('the evidence worktree is added at the plan commit and carries every artifact  [M2 / leg (c)]', () => {
  const ctx = green()
  const EV = evidenceDir(ctx)
  const git = gitLog(ctx)

  // Built once, on the plan commit — the evidence branch's first commit is
  // parented there.
  const worktrees = git.filter((a) => verbOf(a) === 'worktree')
  assert.equal(worktrees.length, 1, 'the worktree is built once')
  assert.ok(worktrees[0].join(' ').includes(`worktree add --detach ${EV} ${PLAN_SHA}`),
    `expected 'worktree add --detach ${EV} ${PLAN_SHA}', got: ${worktrees[0].join(' ')}`)

  // Everything M2 names, under `.ultrapowers/runs/7/` and nowhere else.
  const dir = path.join(EV, RUN_PATH)
  for (const f of ['status.json', 'gate-receipt.json', 'report.json', 'events.jsonl',
    'engine.log', 'pr-body.md', 'receipt.json']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${RUN_PATH}/${f} must be collected`)
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'gate-receipt.json'), 'utf8')).verdict, 'PASS')
})

test('every evidence push runs in the worktree, after its own add and commit, before the integration push  [M2 / leg (c)]', () => {
  const ctx = green()
  const EV = evidenceDir(ctx)
  const git = gitLog(ctx)

  const pushes = git.filter(isEvidencePush)
  assert.ok(pushes.length >= 3,
    `at least three evidence pushes (running, publishing, done); saw ${pushes.length}`)
  // Spelled as M2 spells it.
  assert.deepEqual(pushes[0],
    ['git', '-C', EV, 'push', 'origin', `HEAD:refs/heads/${EVIDENCE_BRANCH}`])

  // No push of the evidence branch from anywhere but the worktree, an add and
  // a commit before each of them, and the first of them before the PR head is
  // pushed.
  assert.equal(evidenceDisciplineProblem(git, EV), null,
    'M2 discipline:\n' + git.map((a) => a.join(' ')).join('\n'))

  assert.equal(git.filter((a) => isEvidencePush(a) && dirOf(a) !== EV).length, 0,
    'no push to the evidence branch from any other directory')
})

test('one evidence commit per transition: running, publishing, done  [M2 / leg (c)]', () => {
  const ctx = green()
  assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'done'],
    'the status page snapshotted at each evidence commit')

  const c = committed(ctx)
  assert.equal(c[0].vm, VM_NAME)
  assert.equal(c[1].pr, null, 'at publishing there is no PR yet')
  assert.equal(c[1].prAuthor, null)
  assert.equal(c[c.length - 1].pr, PR_URL, 'the done commit carries the PR')
  assert.equal(c[c.length - 1].prAuthor, PR_AUTHOR)

  // The `running` commit is made before the engine unit is started.
  const commitAt = indexOf(ctx, `${evidenceDir(ctx)} commit`)
  const engineAt = indexOf(ctx, 'CALL systemd-run engine')
  assert.ok(commitAt >= 0 && engineAt >= 0)
  assert.ok(commitAt < engineAt, 'the running page is committed before the engine runs')
})

test('nothing outside .ultrapowers/runs/7 is ever staged  [M4 / legs (c),(f)]', () => {
  const ctx = green()
  const args = addArguments(gitLog(ctx))
  assert.ok(args.length > 0, 'something is staged')
  for (const a of args) {
    assert.ok(a === RUN_PATH || a.startsWith(`${RUN_PATH}/`),
      `git add argument '${a}' is neither ${RUN_PATH} nor under it`)
  }
  for (const bad of ['-A', '.', '--all']) {
    assert.ok(!args.includes(bad), `git add must never carry '${bad}'`)
  }
  assert.equal(args.filter((a) => a.startsWith('.claude/')).length, 0,
    'nothing under .claude/ is ever added to a commit')
})

test('an evidence branch that already exists is re-entered at FETCH_HEAD  [M2 / leg (d)]', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_EVIDENCE_FETCH_OK: '1' }).status, 0)
  const EV = evidenceDir(ctx)
  const git = gitLog(ctx)

  assert.ok(git.some((a) =>
    verbOf(a) === 'fetch' && a.some((s) => s === `refs/heads/${EVIDENCE_BRANCH}`)),
    'the evidence branch is looked for first')
  const worktrees = git.filter((a) => verbOf(a) === 'worktree')
  assert.equal(worktrees.length, 1)
  assert.ok(worktrees[0].join(' ').includes(`worktree add --detach ${EV} FETCH_HEAD`),
    `a fetch that answered 0 means the worktree is added at FETCH_HEAD, not at the plan sha: ${worktrees[0].join(' ')}`)
  assert.equal(evidenceDisciplineProblem(git, EV), null)
})

test('a failing engine writes failed into the worktree and pushes it  [M2 / leg (d)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_ENGINE_CODE: '2' })
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(ctx).state, 'failed')
  assert.match(statusOf(ctx).error, /^engine exited 2\n/)

  const EV = evidenceDir(ctx)
  const worktreePage = JSON.parse(
    fs.readFileSync(path.join(EV, RUN_PATH, 'status.json'), 'utf8'))
  assert.equal(worktreePage.state, 'failed', "the worktree's status.json says failed")
  assert.ok(fs.existsSync(path.join(EV, RUN_PATH, 'gate-receipt.json')),
    'the evidence of a failed run is still collected')
  assert.deepEqual(commitStates(ctx), ['running', 'failed'])

  // …and a push in the worktree follows the commit that carried it.
  const git = gitLog(ctx)
  let lastCommit = -1
  let lastPush = -1
  git.forEach((a, i) => {
    if (dirOf(a) === EV && verbOf(a) === 'commit') lastCommit = i
    if (isEvidencePush(a)) lastPush = i
  })
  assert.ok(lastCommit >= 0 && lastPush > lastCommit,
    'a -C <home>/evidence push follows the failed commit')
  assert.equal(evidenceDisciplineProblem(git, EV), null)
  assert.equal(prPosts(ctx).length, 0, 'a failed engine opens no PR')
  assert.deepEqual(notifies(ctx), [
    { title: 'run-7 failed', message: `${TARGET} — engine exited 2` },
  ])
})

test('a run with nothing ahead of base parks on the evidence branch — no push, no PR  [M2/M5, legs (d),(g)]', () => {
  // run-69: every task blocked, branch == BASE, GitHub refuses an empty PR.
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_VERDICT: 'NEEDS_ACK', STUB_NO_COMMITS: '1' })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.deepEqual(states(ctx), ['booting', 'running', 'parked'], 'never publishing')
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked')
  assert.equal(status.pr, null)
  assert.match(status.error, /no commits ahead of base \(verdict NEEDS_ACK\)/)
  assert.equal(integrationsReads(ctx), 1, 'only the preflight read /integrations; nothing is polled after the gate')
  assert.equal(prPosts(ctx).length, 0, 'no PR is attempted')

  const git = gitLog(ctx)
  assert.equal(git.filter(isIntegrationPush).length, 0, 'the empty branch is not pushed')
  // The verdict was still read after the engine was seen to be inactive.
  assert.ok(indexOf(ctx, 'CALL systemctl is-active fleet-engine-7.service') < indexOf(ctx, 'status: state=parked'))

  // The snapshot sequence ends `parked`, and that commit is pushed.
  assert.deepEqual(commitStates(ctx), ['running', 'parked'])
  const EV = evidenceDir(ctx)
  let lastCommit = -1
  let lastPush = -1
  git.forEach((a, i) => {
    if (dirOf(a) === EV && verbOf(a) === 'commit') lastCommit = i
    if (isEvidencePush(a)) lastPush = i
  })
  assert.ok(lastPush > lastCommit, 'the parked commit is pushed to the evidence branch')
  assert.equal(evidenceDisciplineProblem(git, EV), null)
  assert.ok(fs.existsSync(path.join(EV, RUN_PATH, 'gate-receipt.json')),
    'the evidence is committed even with nothing to publish')
  assert.deepEqual(notifies(ctx), [{ title: 'run-7 parked', message: `${TARGET} — nothing ahead of base` }])
})

test('a non-2xx answer from the PR endpoint fails the run on the evidence branch  [M2 / leg (d)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], {
    STUB_PR_CODE: '422',
    STUB_PR_BODY: '{"message":"Validation Failed","errors":[{"message":"A pull request already exists for popmechanic:ultra/integration-run-7."}]}',
  })
  assert.notEqual(r.status, 0)
  const status = statusOf(ctx)
  assert.equal(status.state, 'failed')
  assert.match(status.error, /POST \/repos\/popmechanic\/smoke\/pulls answered 422/)
  assert.ok(status.error.includes('A pull request already exists'), "GitHub's own words: " + status.error)
  assert.equal(status.pr, null, 'no PR is recorded')

  assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'failed'],
    'the snapshot sequence ends failed')
  const EV = evidenceDir(ctx)
  const git = gitLog(ctx)
  let lastCommit = -1
  let lastPush = -1
  git.forEach((a, i) => {
    if (dirOf(a) === EV && verbOf(a) === 'commit') lastCommit = i
    if (isEvidencePush(a)) lastPush = i
  })
  assert.ok(lastPush > lastCommit, 'the failed commit is pushed to the evidence branch')
  assert.equal(evidenceDisciplineProblem(git, EV), null)
})

test('an evidence push the remote keeps rejecting fails the run after exactly five attempts  [M2 / leg (d)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_EVIDENCE_PUSH_FAIL: '1' })
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(ctx).state, 'failed')

  const git = gitLog(ctx)
  assert.equal(git.filter(isEvidencePush).length, 5,
    'exactly five push attempts:\n' + git.map((a) => a.join(' ')).join('\n'))
  // Each rejection is followed by a rebase against the evidence branch.
  const rebases = git.filter((a) =>
    verbOf(a) === 'pull' && a.includes('--rebase') && a.some((s) => s === EVIDENCE_BRANCH))
  assert.ok(rebases.length >= 4, 'a rejection is retried after a pull --rebase')
  assert.ok(rebases.every((a) => dirOf(a) === evidenceDir(ctx)),
    'the rebase runs in the evidence worktree')
  assert.equal(engineRuns(ctx), 0,
    'the first evidence push is the running transition, before the engine')
  assert.equal(notifies(ctx)[notifies(ctx).length - 1].title, 'run-7 failed')
})

test('leg (c) rejects a log whose integration push precedes any evidence push  [leg (d)]', () => {
  // The discipline predicate the green run is graded by, shown refusing the
  // ordering M2 forbids — so a passing leg (c) is a fact about the ordering,
  // not about the predicate being vacuous.
  const EV = '/home/exedev/evidence'
  const T = '/home/exedev/target'
  const g = (dir, ...rest) => ['git', '-C', dir, ...rest]
  const cycle = () => [
    g(EV, 'add', '--', RUN_PATH),
    g(EV, 'commit', '-m', 'x'),
    g(EV, 'push', 'origin', `HEAD:refs/heads/${EVIDENCE_BRANCH}`),
  ]

  const good = [...cycle(), ...cycle(), g(T, 'push', 'origin', INTEGRATION_BRANCH), ...cycle()]
  assert.equal(evidenceDisciplineProblem(good, EV), null, 'the well-ordered log passes')

  const early = [g(T, 'push', 'origin', INTEGRATION_BRANCH), ...cycle(), ...cycle(), ...cycle()]
  const problem = evidenceDisciplineProblem(early, EV)
  assert.ok(problem && problem.includes('precedes'),
    'an integration push before the first evidence push must be a failure, got: ' + problem)

  // …and so are the other two shapes M2 forbids.
  const elsewhere = [...cycle(), ...cycle(),
    g(T, 'push', 'origin', `HEAD:refs/heads/${EVIDENCE_BRANCH}`)]
  assert.ok(evidenceDisciplineProblem(elsewhere, EV),
    'an evidence push from another directory must be a failure')

  const uncommitted = [...cycle(), g(EV, 'push', 'origin', `HEAD:refs/heads/${EVIDENCE_BRANCH}`)]
  assert.ok(evidenceDisciplineProblem(uncommitted, EV),
    'a second push with no add and commit since the first must be a failure')
})

runTests(tests)
