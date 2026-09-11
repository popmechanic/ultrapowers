/**
 * fleet/tests/test_target.mjs — the one per-target integration.
 *
 * What is pinned:
 *
 *   1. the one `integrations add` line, verbatim — `gh-<owner>-<repo>`,
 *      `--act-as-user`, no `--readonly`, no `--attach`, and the complete
 *      policy `--policy 'tag:fleet'` at creation: that policy is the one way
 *      a credential reaches a fleet VM (exe.dev refuses `new --integration`
 *      and `integrations attach` since 2026-09-11), and there is no read-only
 *      twin (two integrations naming one repo on a VM have no documented
 *      tie-break);
 *   2. creating is idempotent: an object that exists is skipped, not edited,
 *      not recreated — its policy is read, kept when it is already `tag:fleet`
 *      and replaced under the read's revision when it is not; a refused add
 *      prints the lobby's own words;
 *   3. `gc` reports and never deletes.
 */

import assert from 'node:assert/strict'

import {
  FLEET_POLICY, addCommand, parsePolicy, policyGetCommand, policySetCommand, renderTarget, target, usage
} from '../target.mjs'
import { LobbyError, githubIntegrationFor } from '../lobby.mjs'
import { answer, makeExec, sshRule, thrown } from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
const GH = 'gh-popmechanic-smoke'

const REVISION = 'ar1_0123456789abcdef'

/** What `integrations policy get <name> --json` answers, measured 2026-09-11. */
const policyAnswer = (selector, revision = REVISION) => answer({
  integration: { name: GH, team: false },
  scope: 'personal',
  revision,
  valid: true,
  policy: { selector, wire: selector, expiresAt: null, simpleSelectors: [selector] }
})

const rules = (integrations = [], {
  gh = answer('{"name":"smoke"}'), add = answer(''), policy = policyAnswer(FLEET_POLICY), set = answer('')
} = {}) => [
  sshRule('integrations list --json', answer(integrations)),
  sshRule('integrations add', add),
  sshRule('integrations policy get', policy),
  sshRule('integrations policy set', set),
  { when: (cmd) => cmd === 'gh', answer: gh }
]

// ── 1. The one line, verbatim, on the policy tag:fleet ──────────────────────
{
  assert.equal(githubIntegrationFor(TARGET), GH, '(1) gh-<owner>-<repo>, the slash a hyphen')
  assert.equal(FLEET_POLICY, 'tag:fleet', '(1) the policy is the tag a fleet VM is created with')
  assert.equal(
    addCommand(TARGET),
    `integrations add github --name ${GH} --repository ${TARGET} --act-as-user --policy 'tag:fleet'`,
    '(1) act-as-user, the complete policy at creation, no --attach'
  )
  assert.ok(!/--attach|--readonly/.test(addCommand(TARGET)), '(1) nothing is attached incrementally and nothing is read-only')

  const exec = makeExec({ rules: rules() })
  const result = await target({ argv: [TARGET], exec })
  assert.deepEqual(exec.lobby(), ['integrations list --json', addCommand(TARGET)], '(1) list, then the one add — a fresh object needs no policy read')
  assert.deepEqual(result.results.map((r) => [r.action, r.policy]), [['created', 'set']], '(1) created, on the policy')
  assert.equal(renderTarget(result), `created ${GH} (policy tag:fleet set)`, '(1) and reported')
}

// ── 2. Idempotence: the policy read, kept or set; and a refused add ─────────
{
  const exec = makeExec({ rules: rules([{ name: GH, attachments: ['tag:fleet'] }]) })
  const result = await target({ argv: [TARGET], exec })
  assert.deepEqual(
    exec.lobby(), ['integrations list --json', policyGetCommand(GH)],
    '(2) an existing object on the policy issues the one policy read and no write'
  )
  assert.deepEqual(exec.mutating(), [], '(2) nothing mutates when the policy is already tag:fleet')
  assert.deepEqual(result.results.map((r) => [r.action, r.policy]), [['skipped', 'kept']], '(2) skipped, policy kept')
  assert.equal(renderTarget(result), `skipped ${GH} (policy tag:fleet kept)`, '(2) and reported')

  // An object the operator built before the policy change: its selector is
  // something else, so it is replaced — whole, under the revision just read.
  const stale = makeExec({ rules: rules([{ name: GH, attachments: [] }], { policy: policyAnswer('vm:fleet-r7-2609032215-a1b2') }) })
  const replaced = await target({ argv: [TARGET], exec: stale })
  assert.deepEqual(
    stale.lobby(), ['integrations list --json', policyGetCommand(GH), policySetCommand(GH, REVISION)],
    '(2) an off-policy object is read, then set under the revision the read answered'
  )
  assert.equal(
    policySetCommand(GH, REVISION),
    `integrations policy set ${GH} 'tag:fleet' --permanent --if-revision=${REVISION}`,
    '(2) the set is the complete expression, permanent, revision-checked'
  )
  assert.deepEqual(replaced.results.map((r) => [r.action, r.policy]), [['skipped', 'set']], '(2) skipped, policy set')

  // A policy read the tool cannot read is a failure carrying the lobby's words,
  // never a blind set.
  const unreadable = makeExec({ rules: rules([{ name: GH, attachments: [] }], { policy: answer('not json\n') }) })
  const unreadError = await thrown(() => target({ argv: [TARGET], exec: unreadable }))
  assert.ok(unreadError instanceof LobbyError, '(2) an unreadable policy is a failure')
  assert.deepEqual(unreadable.mutating(), [], '(2) and nothing is set on top of it')
  assert.equal(parsePolicy('{}'), null, '(2) no revision is no policy')
  assert.deepEqual(parsePolicy(policyAnswer('tag:fleet').stdout), { selector: 'tag:fleet', revision: REVISION }, '(2) selector and revision are read')

  const refused = makeExec({ rules: rules([], { add: answer('repository popmechanic/smoke: app not installed\n', { code: 1 }) }) })
  const error = await thrown(() => target({ argv: [TARGET], exec: refused }))
  assert.ok(error instanceof LobbyError, '(2) a refused add is a failure')
  assert.match(error.message, /app not installed/, '(2) carrying the lobby\'s own words')
}

// ── 3. Refusals ─────────────────────────────────────────────────────────────
{
  for (const argv of [['add', TARGET], ['not-a-repo'], ['a/b/c'], ['nonsense'], []]) {
    const exec = makeExec({ rules: rules() })
    const error = await thrown(() => target({ argv, exec }))
    assert.equal(error?.exitCode, 2, `(3) ${JSON.stringify(argv)} refuses`)
    assert.deepEqual(exec.mutating(), [], `(3) ${JSON.stringify(argv)} creates nothing`)
  }
  assert.ok(usage().includes('<owner>/<repo>'), '(3) usage names the bare form')
  assert.ok(!usage().includes(' add '), '(3) there is no add verb')
  assert.ok(usage().includes('gc'), '(3) usage names gc')
}

// ── 4. list shows only the per-target objects, with what each is attached to ─
{
  const exec = makeExec({
    rules: rules([
      { name: GH, repository: TARGET, attachments: ['vm:fleet-r7-2609032215-a1b2'] },
      { name: 'gh-popmechanic-other', repository: 'popmechanic/other', attachments: [] },
      { name: 'claude-max', attachments: [] },
      { name: 'ops-alerts', attachments: ['tag:fleet'] },
      { name: 'notify', attachments: [] }
    ])
  })
  const result = await target({ argv: ['list'], exec })
  assert.deepEqual(result.results.map((r) => r.name), [GH, 'gh-popmechanic-other'], '(4) claude-max, notify and the non-GitHub ops-alerts on `tag:fleet` are not target objects')
  const printed = renderTarget(result)
  assert.match(printed, new RegExp(`${GH} {2}popmechanic/smoke {2}vm:fleet-r7-2609032215-a1b2`), '(4) a per-VM attachment is shown')
  assert.match(printed, /gh-popmechanic-other {2}popmechanic\/other {2}unattached/, '(4) and an object on no policy says so')
}

// ── 5. gc reports, never deletes ────────────────────────────────────────────
{
  const exec = makeExec({
    rules: rules(
      [
        { name: GH, repository: TARGET, attachments: [] },
        { name: 'gh-gone-repo', repository: 'gone/repo', attachments: [] },
        { name: 'gh-mystery', attachments: [] }
      ],
      { gh: (cmd, argv) => (argv[2] === 'gone/repo' ? answer('', { code: 1, stderr: 'not found' }) : answer('{}')) }
    )
  })
  const result = await target({ argv: ['gc'], exec })
  assert.deepEqual(result.results, [
    { name: GH, repository: TARGET, verdict: 'present' },
    { name: 'gh-gone-repo', repository: 'gone/repo', verdict: 'missing' },
    { name: 'gh-mystery', repository: null, verdict: 'unknown' }
  ], '(5) present, missing, and unknown when the listing carries no repository')
  assert.deepEqual(exec.mutating(), [], '(5) gc issues no mutating verb — the operator deletes, not the tool')
  assert.equal(exec.calls.filter((c) => c.cmd === 'gh').length, 2, '(5) one gh probe per distinct repository')
  assert.match(renderTarget(result), /missing gh-gone-repo/, '(5) and only the misses are printed')
}

console.log('ALL TESTS PASSED')
