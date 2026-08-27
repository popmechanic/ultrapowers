// fleet/tests/test_fitness.mjs — #322: a plan task whose only evidence would
// be human judgment (the instruction-only doc class: implementation type,
// every Files entry a .md, no Test: entry) is guaranteed to park an
// unattended drive. assessHeadlessFitness names those tasks BEFORE a sandbox
// exists.
import assert from 'node:assert/strict'
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

console.log(`\nALL TESTS PASSED (${passed})`)
