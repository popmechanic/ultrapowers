// fleet/tests/test_fitness.mjs — #322: a plan task whose only evidence would
// be human judgment (the instruction-only doc class: implementation type,
// every Files entry a .md, no Test: entry) is guaranteed to park an
// unattended drive. assessHeadlessFitness names those tasks BEFORE a sandbox
// exists.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { assessHeadlessFitness } from '../fitness.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const plan = (tasks) => `# A Plan\n\n**Acceptance:** suite — x\n\n---\n\n${tasks.join('\n\n')}`

const docOnlyTask = `### Task 1: Extend the skill text
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`skills/ultralearn/SKILL.md\`
- Modify: \`skills/ultralearn/references/reading-lenses.md\`

- [ ] **Step 1: append the paragraph**`

const codeTask = `### Task 2: Fix the thing
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`fleet/drive.mjs\`
- Test: \`fleet/tests/test_drive.mjs\`

- [ ] **Step 1: write the failing test**`

const docWithTestTask = `### Task 3: Document + pin
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`fleet/RUNBOOK.md\`
- Test: \`fleet/tests/test_drive.mjs\`

- [ ] **Step 1: write the failing test**`

const manualDocTask = `### Task 4: Owner updates the wiki
**Type:** manual
**Depends-on:** none

**Files:**
- Modify: \`docs/wiki.md\`

- [ ] **Step 1: the owner edits the page**`

// 1. run-14's shape is flagged, by task heading
{
  const res = assessHeadlessFitness(plan([docOnlyTask, codeTask]))
  assert.equal(res.fit, false)
  assert.equal(res.findings.length, 1)
  assert.equal(res.findings[0].task, 'Task 1: Extend the skill text')
  assert.match(res.findings[0].reason, /instruction-only/)
  ok('instruction-only doc task flagged (run-14 class)')
}

// 2. code tasks and doc tasks WITH a Test: entry pass
{
  const res = assessHeadlessFitness(plan([codeTask, docWithTestTask]))
  assert.deepEqual(res, { fit: true, findings: [] })
  ok('code task and doc-with-test task are fit')
}

// 3. Type: manual is post-merge runbook material, never waved — not flagged
{
  const res = assessHeadlessFitness(plan([codeTask, manualDocTask]))
  assert.deepEqual(res, { fit: true, findings: [] })
  ok('manual-typed tasks are excluded (they never reach the sandbox waves)')
}

// 4. fenced content never drives classification — a code task EMBEDDING a
//    doc-only Files block inside a fence stays fit
{
  const fenced = `### Task 5: Ship a checker
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`fleet/fitness.mjs\`
- Test: \`fleet/tests/test_fitness.mjs\`

- [ ] **Step 1: embed an example**

\`\`\`markdown
**Files:**
- Modify: \`docs/only.md\`
\`\`\`
`
  const res = assessHeadlessFitness(plan([fenced]))
  assert.deepEqual(res, { fit: true, findings: [] })
  ok('fenced example Files blocks are ignored')
}

// 5. a plan with no tasks at all is fit (nothing to flag)
assert.deepEqual(assessHeadlessFitness('# empty\n'), { fit: true, findings: [] })
ok('an empty plan is fit')

// 6. a fence BODY that quotes a fence marker (the corpus shape: a python block
//    holding the string literal "```bash…```") must not desynchronize the
//    pairing and swallow the real prose that follows. The old any-```-to-the-
//    next-``` strip deleted whole `### Task` headings here, so the doc-only
//    task went unassessed and the guard failed open on its own class.
{
  const bt = '`'.repeat(3)
  // An ODD count of quoted markers inside the block is what desynchronizes an
  // unanchored pairing: the block's real closer then pairs with the quoted one,
  // and everything up to the NEXT fence — the whole doc-only task — is deleted.
  const quoting = `### Task 6: Emit the push hint
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`fleet/drive.mjs\`
- Test: \`fleet/tests/test_drive.mjs\`

- [ ] **Step 1: emit it**

${bt}python
HINT = "${bt}bash\\ngit push origin main\\n"
${bt}`

  const trailing = `### Task 9: Emit the other hint
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`fleet/drive.mjs\`
- Test: \`fleet/tests/test_drive.mjs\`

- [ ] **Step 1: emit it**

${bt}python
TAIL = "done"
${bt}`

  const text = plan([quoting, docOnlyTask, trailing])
  assert.equal((text.match(/^### Task /gm) ?? []).length, 3)
  const res = assessHeadlessFitness(text)
  assert.equal(res.fit, false)
  assert.equal(res.findings.length, 1)
  assert.equal(res.findings[0].task, 'Task 1: Extend the skill text')
  ok('a fence body quoting fence markers does not swallow later tasks')
}

// 7. a longer outer fence nests a shorter one: only the OUTER pair delimits, so
//    the inner example's Files block still cannot leak into classification.
{
  const nesting = `### Task 7: Show a plan excerpt
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`fleet/fitness.mjs\`
- Test: \`fleet/tests/test_fitness.mjs\`

- [ ] **Step 1: quote a plan**

\`\`\`\`markdown
### Task 99: Docs only
**Type:** implementation

**Files:**
- Modify: \`docs/leaked.md\`

\`\`\`sh
echo nested
\`\`\`
\`\`\`\`
`
  assert.deepEqual(assessHeadlessFitness(plan([nesting])), { fit: true, findings: [] })
  ok('a 4-backtick fence nesting a 3-backtick fence leaks nothing')
}

// 8. a fence closes only on its OWN character: a tilde block quoting a backtick
//    block stays fenced through it.
{
  const tilde = `### Task 8: Quote a shell block
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`fleet/fitness.mjs\`
- Test: \`fleet/tests/test_fitness.mjs\`

- [ ] **Step 1: quote it**

~~~markdown
**Files:**
- Modify: \`docs/leaked.md\`
\`\`\`
still inside the tilde fence
\`\`\`
~~~
`
  assert.deepEqual(assessHeadlessFitness(plan([tilde])), { fit: true, findings: [] })
  ok('a tilde fence is not closed by a backtick fence')
}

// 9. the real corpus plan the desync was found on: both instruction-only doc
//    tasks are named. Skipped (not failed) if the file is absent, so the fleet
//    suite still passes from a sandbox checkout that lacks docs/.
{
  const corpus = new URL(
    '../../docs/superpowers/plans/2026-06-11-review-cycle-2-fixes.md',
    import.meta.url,
  )
  if (fs.existsSync(corpus)) {
    const res = assessHeadlessFitness(fs.readFileSync(corpus, 'utf8'))
    assert.equal(res.fit, false)
    assert.deepEqual(
      res.findings.map((f) => f.task.split(':')[0]),
      ['Task 6', 'Task 7'],
    )
    ok('the corpus repro plan flags both of its instruction-only doc tasks')
  } else {
    ok('the corpus repro plan is absent from this checkout — skipped')
  }
}

console.log(`\nALL TESTS PASSED (${passed})`)
