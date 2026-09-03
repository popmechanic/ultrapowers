/**
 * fleet/tests/test_target.mjs — the per-target integration pair.
 *
 * What is pinned:
 *
 *   1. the two `integrations add` lines, verbatim — `-ro` is `--readonly` and
 *      rides `tag:fleet`; `-rw` is `--act-as-user` and is attached to NOTHING.
 *      A `-rw` object born on a tag is a write credential every sandbox holds;
 *   2. `add` is idempotent: an object that exists is skipped, not edited, not
 *      recreated;
 *   3. `gc` reports and never deletes.
 */

import assert from 'node:assert/strict'

import { target, addCommands, renderTarget, usage } from '../target.mjs'
import { answer, makeExec, sshRule, thrown } from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
const RO = 't-popmechanic-smoke-ro'
const RW = 't-popmechanic-smoke-rw'

const rules = (integrations = [], { gh = answer('{"name":"smoke"}') } = {}) => [
  sshRule('integrations list --json', answer(integrations)),
  sshRule('integrations add', answer('')),
  { when: (cmd) => cmd === 'gh', answer: gh }
]

// ── 1. The two lines, verbatim ──────────────────────────────────────────────
{
  assert.deepEqual(addCommands(TARGET), [
    `integrations add github --name ${RO} --repository ${TARGET} --readonly --attach tag:fleet`,
    `integrations add github --name ${RW} --repository ${TARGET} --act-as-user`
  ], '(1) the read-only object rides the tag; the writable one is attached to nothing')

  const exec = makeExec({ rules: rules() })
  const result = await target({ argv: ['add', TARGET], exec })
  assert.deepEqual(exec.lobby(), [
    'integrations list --json',
    ...addCommands(TARGET)
  ], '(1) list, then the two adds, in that order')
  assert.deepEqual(result.results.map((r) => r.action), ['created', 'created'], '(1) both created')
  assert.equal(renderTarget(result), `created ${RO}\ncreated ${RW}`, '(1) and both reported')
}

// ── 2. Idempotence ──────────────────────────────────────────────────────────
{
  const exec = makeExec({ rules: rules([{ name: RO, attachments: ['tag:fleet'] }]) })
  const result = await target({ argv: ['add', TARGET], exec })
  assert.deepEqual(exec.lobby(), [
    'integrations list --json',
    addCommands(TARGET)[1]
  ], '(2) an existing -ro is left alone; only the -rw is created')
  assert.deepEqual(result.results.map((r) => r.action), ['skipped', 'created'], '(2) skipped, created')

  const both = makeExec({
    rules: rules([{ name: RO, attachments: ['tag:fleet'] }, { name: RW, attachments: [] }])
  })
  const again = await target({ argv: ['add', TARGET], exec: both })
  assert.deepEqual(both.lobby(), ['integrations list --json'], '(2) a second add issues no verb at all')
  assert.deepEqual(again.results.map((r) => r.action), ['skipped', 'skipped'], '(2) both skipped')
}

// ── 3. Refusals ─────────────────────────────────────────────────────────────
{
  for (const argv of [['add'], ['add', 'not-a-repo'], ['add', 'a/b/c'], ['nonsense'], []]) {
    const exec = makeExec({ rules: rules() })
    const error = await thrown(() => target({ argv, exec }))
    assert.equal(error?.exitCode, 2, `(3) ${JSON.stringify(argv)} refuses`)
    assert.deepEqual(exec.mutating(), [], `(3) ${JSON.stringify(argv)} creates nothing`)
  }
  assert.ok(usage().includes('add <owner>/<repo>'), '(3) usage names the add form')
  assert.ok(usage().includes('gc'), '(3) usage names gc')
}

// ── 4. list shows only the per-target pair ──────────────────────────────────
{
  const exec = makeExec({
    rules: rules([
      { name: RO, repository: TARGET, attachments: ['tag:fleet'] },
      { name: RW, repository: TARGET, attachments: [] },
      { name: 'claude-max', attachments: [] },
      { name: 'fleet-runs', attachments: ['tag:fleet'] },
      { name: 'notify', attachments: [] }
    ])
  })
  const result = await target({ argv: ['list'], exec })
  assert.deepEqual(result.results.map((r) => r.name), [RO, RW], '(4) claude-max, fleet-runs and notify are not target objects')
  assert.deepEqual(result.results.map((r) => r.tagged), [true, false], '(4) -ro is tagged, -rw is not')
  assert.match(renderTarget(result), /t-popmechanic-smoke-rw {2}popmechanic\/smoke {2}per-vm/, '(4) the printed row')
}

// ── 5. gc reports, never deletes ────────────────────────────────────────────
{
  const exec = makeExec({
    rules: rules(
      [
        { name: RO, repository: TARGET, attachments: ['tag:fleet'] },
        { name: RW, repository: TARGET, attachments: [] },
        { name: 't-gone-repo-ro', repository: 'gone/repo', attachments: [] },
        { name: 't-mystery-ro', attachments: [] }
      ],
      { gh: (cmd, argv) => (argv[2] === 'gone/repo' ? answer('', { code: 1, stderr: 'not found' }) : answer('{}')) }
    )
  })
  const result = await target({ argv: ['gc'], exec })
  assert.deepEqual(result.results, [
    { name: RO, repository: TARGET, verdict: 'present' },
    { name: RW, repository: TARGET, verdict: 'present' },
    { name: 't-gone-repo-ro', repository: 'gone/repo', verdict: 'missing' },
    { name: 't-mystery-ro', repository: null, verdict: 'unknown' }
  ], '(5) present, missing, and unknown when the listing carries no repository')
  assert.deepEqual(exec.mutating(), [], '(5) gc issues no mutating verb — the operator deletes, not the tool')
  assert.equal(
    exec.calls.filter((c) => c.cmd === 'gh').length, 2,
    '(5) one gh probe per distinct repository, not one per object'
  )
  assert.match(renderTarget(result), /missing t-gone-repo-ro/, '(5) and only the misses are printed')
}

console.log('ALL TESTS PASSED')
