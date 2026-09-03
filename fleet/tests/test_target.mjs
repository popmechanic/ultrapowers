/**
 * fleet/tests/test_target.mjs — the one per-target integration.
 *
 * What is pinned:
 *
 *   1. the one `integrations add` line, verbatim — `gh-<owner>-<repo>`,
 *      `--act-as-user`, no `--readonly`, no `--attach`: it is attached per VM
 *      and per window by the launcher, and there is no read-only twin (two
 *      integrations naming one repo on a VM have no documented tie-break);
 *   2. creating is idempotent: an object that exists is skipped, not edited,
 *      not recreated; a refused add prints the lobby's own words;
 *   3. `gc` reports and never deletes.
 */

import assert from 'node:assert/strict'

import { target, addCommand, renderTarget, usage } from '../target.mjs'
import { LobbyError, githubIntegrationFor } from '../lobby.mjs'
import { answer, makeExec, sshRule, thrown } from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
const GH = 'gh-popmechanic-smoke'

const rules = (integrations = [], { gh = answer('{"name":"smoke"}'), add = answer('') } = {}) => [
  sshRule('integrations list --json', answer(integrations)),
  sshRule('integrations add', add),
  { when: (cmd) => cmd === 'gh', answer: gh }
]

// ── 1. The one line, verbatim, attached to nothing ──────────────────────────
{
  assert.equal(githubIntegrationFor(TARGET), GH, '(1) gh-<owner>-<repo>, the slash a hyphen')
  assert.equal(
    addCommand(TARGET),
    `integrations add github --name ${GH} --repository ${TARGET} --act-as-user`,
    '(1) act-as-user, no --attach'
  )
  assert.ok(!/--attach|tag:|--readonly/.test(addCommand(TARGET)), '(1) nothing GitHub rides the tag, and nothing is read-only')

  const exec = makeExec({ rules: rules() })
  const result = await target({ argv: [TARGET], exec })
  assert.deepEqual(exec.lobby(), ['integrations list --json', addCommand(TARGET)], '(1) list, then the one add')
  assert.deepEqual(result.results.map((r) => r.action), ['created'], '(1) created')
  assert.equal(renderTarget(result), `created ${GH}`, '(1) and reported')
}

// ── 2. Idempotence, and a refused add ───────────────────────────────────────
{
  const exec = makeExec({ rules: rules([{ name: GH, attachments: [] }]) })
  const result = await target({ argv: [TARGET], exec })
  assert.deepEqual(exec.lobby(), ['integrations list --json'], '(2) an existing object issues no verb at all')
  assert.deepEqual(result.results.map((r) => r.action), ['skipped'], '(2) skipped')

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
      { name: 'fleet-runs', attachments: ['tag:fleet'] },
      { name: 'notify', attachments: [] }
    ])
  })
  const result = await target({ argv: ['list'], exec })
  assert.deepEqual(result.results.map((r) => r.name), [GH, 'gh-popmechanic-other'], '(4) claude-max, fleet-runs and notify are not target objects')
  const printed = renderTarget(result)
  assert.match(printed, new RegExp(`${GH} {2}popmechanic/smoke {2}vm:fleet-r7-2609032215-a1b2`), '(4) a per-VM attachment is shown')
  assert.match(printed, /gh-popmechanic-other {2}popmechanic\/other {2}unattached/, '(4) and an idle object says so')
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
