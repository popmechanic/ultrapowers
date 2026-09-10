// fleet/referee.mjs — the mechanical half of a task's review (#729).
//
// A reviewer model reads a patch and says what it thinks. Some of what it says
// is not an opinion at all: whether the patch touched a path the task was never
// given, whether the Proof's `Test:` file is actually on the tree, whether the
// count of top-level tests went down, whether a dependency manifest moved,
// whether a token-shaped literal was added. Every one of those answers is a
// function of artifacts the driver already holds — the captured patch, the task
// object, the clone at HEAD — so map #727 rule 1 says the driver answers them
// and the model is never asked.
//
// This module is that arithmetic. It dispatches no model, opens no socket,
// writes no git state and runs no subprocess; it imports `node:fs` and
// `node:path` and nothing else. The one linker that does look inside the clone's
// source is INJECTED through `opts.linker`, so this file never imports it and
// the replay stubs it.
//
// Its answer is one object per task per fix round:
//
//   {task, n, findings, settled, linker, ms}
//
// `findings` carry the same `{severity, detail, actor}` triple `REVIEWER_SCHEMA`
// in `fleet/run-engine.mjs` requires of a reviewer's issue, so the engine's
// de-dup, actor routing, fix round and report machinery consume them unchanged.
// `settled` is the other half of the record — the checks that ran and found
// nothing — because a review that only prints defects cannot be told apart from
// a review that did not run.

import fs from 'node:fs'
import path from 'node:path'

// The six checks, in the order their findings and settled lines are emitted.
export const CHECKS = Object.freeze([
  'footprint', 'interface', 'exam-files', 'test-count', 'dependencies', 'secrets',
])

// U+2212 MINUS SIGN. The test-count lines spell `+2 / −0` with this byte
// sequence in the module and in the sim; an ASCII hyphen here would read the
// same and compare different.
const MINUS = '−'

// Always emitted. Eight recorded reviewer findings were the reviewer asking for
// the integrated run that the driver already performs on the adopted tree.
const INTEGRATED_SUITE =
  'the driver runs the integrated suite on the adopted tree, not this review'

// --------------------------------------------------------------------------- //
// small helpers                                                                //
// --------------------------------------------------------------------------- //
const arr = (v) => (Array.isArray(v) ? v : [])
const str = (v) => (v == null ? '' : String(v))
const finding = (check, severity, actor, detail) => ({ check, severity, actor, detail })
const settle = (check, detail) => ({ check, detail })
const tick = (p) => '`' + p + '`'

// --------------------------------------------------------------------------- //
// the patch                                                                    //
// --------------------------------------------------------------------------- //
// The path of a `diff --git a/<p> b/<p>` header. `withPatchCapture` captures
// with `--no-renames`, so both sides are always the same path and the
// backreference resolves a path that itself contains ` b/`; the loose form is
// the fallback for a hand-written fixture.
const diffPath = (line) => {
  const rest = line.slice('diff --git '.length).trim()
  const same = rest.match(/^a\/(.+) b\/\1$/)
  if (same) return same[1]
  const loose = rest.match(/^a\/(.*) b\/(.*)$/)
  return loose ? loose[2] : rest
}

// One entry per `diff --git` header, in the patch's own order — which is the
// order every check's findings come out in. `added` and `removed` hold the
// hunk lines with their leading sign stripped; `+++`/`---` are file headers and
// are not content. A binary hunk's payload is skipped rather than read as text.
const parsePatch = (text) => {
  const files = []
  let cur = null
  let binary = false
  for (const raw of str(text).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('diff --git ')) {
      cur = { path: diffPath(line), deleted: false, added: [], removed: [] }
      binary = false
      files.push(cur)
      continue
    }
    if (!cur) continue
    if (line.startsWith('GIT binary patch')) { binary = true; continue }
    if (binary) continue
    if (line.startsWith('deleted file mode')) { cur.deleted = true; continue }
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) cur.added.push(line.slice(1))
    else if (line.startsWith('-')) cur.removed.push(line.slice(1))
  }
  return files
}

// The patch is the referee's sole input for the footprint and count checks
// (#729 §3.1), so a patch it cannot read is a loud failure and never a clean
// record: an empty `findings` here would be the referee lying by omission about
// checks it never ran. A missing `patchPath` names the task, because the
// engine's judgment call for the error has to say which task lost its capture;
// a read that throws rethrows with the path and the underlying reason. Both
// land before any check runs and before the `runDir` write, so a throw leaves
// nothing on disk.
const readPatch = (patchPath, taskId) => {
  if (!patchPath) {
    throw new Error('referee: no captured patch for task ' + str(taskId))
  }
  const p = String(patchPath)
  try {
    return parsePatch(fs.readFileSync(p, 'utf8'))
  } catch (error) {
    throw new Error(
      'referee: cannot read the captured patch ' + p + ': ' + (error?.message ?? error))
  }
}

// --------------------------------------------------------------------------- //
// footprint [M2]                                                               //
// --------------------------------------------------------------------------- //
// own = the task's FILES together with its Proof `Test:` paths. The exam paths
// belong inside the footprint because the driver itself hands the peer's exam
// into the graded clone after the implementer returns, so the recaptured patch
// carries them on every examined task.
const footprintCheck = (files, own, sibling) => {
  const findings = []
  const settled = []
  for (const f of files) {
    const p = f.path
    const inOwn = own.has(p)
    const inSibling = sibling.has(p)
    // The deletion rule wins outright: a BASE file deleted from outside FILES
    // is one blocking finding, and the outside-FILES minor is not also raised.
    if (f.deleted && !inOwn) {
      findings.push(finding('footprint', 'blocking', 'implementer',
        'deleted BASE file ' + tick(p) + ' absent from FILES'))
      continue
    }
    if (inOwn && inSibling) {
      // The shipped `overlap=fold` case: both tasks were given the path on
      // purpose, so it is settled and named, not a finding.
      settled.push(settle('footprint',
        'path in FILES and in a wave sibling\'s FILES (overlap=fold): ' + tick(p)))
      continue
    }
    if (inOwn) continue
    if (inSibling) {
      findings.push(finding('footprint', 'blocking', 'implementer',
        'path owned by a wave sibling and absent from FILES: ' + tick(p)))
      continue
    }
    findings.push(finding('footprint', 'minor', 'implementer',
      'path outside FILES: ' + tick(p)))
  }
  if (!settled.length && !findings.length) {
    settled.push(settle('footprint', 'every touched path is in FILES'))
  }
  return { findings, settled }
}

// --------------------------------------------------------------------------- //
// interface [M4]                                                               //
// --------------------------------------------------------------------------- //
const interfaceCheck = async (task, opts) => {
  const produces = arr(task.interfaces && task.interfaces.produces)
  if (!produces.length) {
    return { findings: [], settled: [settle('interface', 'no Produces: to link')] }
  }
  const findings = []
  const details = []
  for (const bullet of produces) {
    let answer = null
    if (typeof opts.linker === 'function') {
      // The bullet goes over verbatim, backticks and all: the linker owns the
      // parse, this module owns the routing.
      answer = await opts.linker({
        bullet, files: arr(task.files), cloneDir: opts.cloneDir,
      })
    }
    const status = answer && answer.status ? String(answer.status) : 'unlinked'
    const symbol = str(answer && answer.symbol)
    const detail = (answer && answer.detail != null)
      ? String(answer.detail)
      : 'no linker was supplied; unlinked'
    if (status === 'missing' || status === 'declared') {
      let line = 'Produces: ' + str(bullet) + ' — ' + detail
      if (symbol && !line.includes(symbol)) line += ' (symbol: ' + symbol + ')'
      findings.push(finding('interface', status === 'missing' ? 'blocking' : 'minor',
        'implementer', line))
      continue
    }
    // `resolved` and `unlinked` are both no-finding: a non-identifier symbol is
    // a shape this module refuses to guess at, not a defect in the patch.
    details.push('Produces: ' + str(bullet) + (detail ? ' ' + detail : ''))
  }
  return {
    findings,
    settled: findings.length ? [] : [settle('interface', details.join('; '))],
  }
}

// --------------------------------------------------------------------------- //
// exam files [M3]                                                              //
// --------------------------------------------------------------------------- //
const examCheck = (task, opts) => {
  const proofTests = []
  for (const p of arr(task.proofTests)) {
    const s = str(p)
    if (s && !proofTests.includes(s)) proofTests.push(s)
  }
  const exam = opts.exam == null ? null : String(opts.exam)
  const evidence = opts.examEvidence
  const ran = (exam === 'red' || exam === 'green-at-base') &&
    evidence && typeof evidence === 'object'
  // `blocked` or `null`: the task proceeds unexamined by driver decision. That
  // is a settled line and never a finding — the implementer did not choose it.
  if (!ran) {
    return {
      findings: [],
      settled: [settle('exam-files',
        'no exam ran (exam: ' + (exam === null ? 'null' : exam) +
        '); the task proceeds unexamined by driver decision')],
    }
  }
  // The exam is already red. An absent `Test:` path is the same fact told
  // twice, and the red exam is the one the fix round already answers.
  if (Number(evidence.exit) !== 0) {
    return {
      findings: [],
      settled: [settle('exam-files',
        'the exam exited ' + str(evidence.exit) +
        ' — already red as the exam, so an absent Test: path is not a second finding')],
    }
  }
  const cloneDir = str(opts.cloneDir)
  const own = new Set(arr(task.files).map(str))
  const missing = proofTests.filter((p) => {
    try {
      return !fs.existsSync(path.join(cloneDir, p))
    } catch {
      return true
    }
  })
  if (missing.length) {
    return {
      // A `Test:` path outside the task's own FILES is a plan defect — nobody
      // the fix round can reach was ever asked to create it.
      findings: missing.map((p) => finding('exam-files', 'blocking',
        own.has(p) ? 'implementer' : 'plan',
        'Proof `Test:` path absent at HEAD: ' + tick(p))),
      settled: [],
    }
  }
  return {
    findings: [],
    settled: [settle('exam-files', (proofTests.length
      ? proofTests.join(', ') + ' exists'
      : 'the Proof names no Test: path') + '; exam ran, exit 0')],
  }
}

// --------------------------------------------------------------------------- //
// test count [M5]                                                              //
// --------------------------------------------------------------------------- //
const PY_TEST = /^def (test_[A-Za-z0-9_]*)/
const JS_TEST = /^\s*(?:test|it)\(\s*(?:(['"`])([^'"`]*)\1)?/
const JS_EXTS = new Set(['.js', '.mjs', '.ts', '.tsx'])

// The name a counted line declares, or `null` when the line is not one. A fleet
// sim (top-level asserts, no `test(`) matches nothing and contributes 0.
const testName = (filePath, line) => {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.py') {
    const m = line.match(PY_TEST)
    return m ? m[1] : null
  }
  if (!JS_EXTS.has(ext)) return null
  const m = line.match(JS_TEST)
  return m ? (m[2] || '') : null
}

const countCheck = (files, task) => {
  let added = 0
  let removed = 0
  const removedNames = []
  for (const f of files) {
    for (const line of f.added) if (testName(f.path, line) !== null) added += 1
    for (const line of f.removed) {
      const name = testName(f.path, line)
      if (name === null) continue
      removed += 1
      removedNames.push(name || f.path)
    }
  }
  const counts = 'top-level tests +' + added + ' / ' + MINUS + removed + ' across the patch'
  if (added - removed >= 0) return { findings: [], settled: [settle('test-count', counts)] }
  // The declaration: some line of the task's body carries a deletion word AND
  // names either a removed test or one of the Proof's `Test:` paths. A drop the
  // task asked for is not a defect.
  const declared = declaresRemoval(str(task.body), removedNames, arr(task.proofTests).map(str))
  if (declared) {
    return {
      findings: [],
      settled: [settle('test-count', counts + '; the task declares the removal')],
    }
  }
  const named = removedNames.map(tick).join(', ')
  return {
    findings: [finding('test-count', 'minor', 'implementer',
      counts + ': net drop of ' + (removed - added) +
      ', removing ' + named + ' with no removal declared in the task')],
    settled: [],
  }
}

const DELETION_WORD = /\b(delete|deleted|remove|removed)\b/i

const declaresRemoval = (body, removedNames, proofTests) => {
  for (const line of body.split('\n')) {
    if (!DELETION_WORD.test(line)) continue
    for (const name of removedNames) if (name && line.includes(name)) return true
    for (const p of proofTests) if (p && line.includes(p)) return true
  }
  return false
}

// --------------------------------------------------------------------------- //
// dependencies [M6]                                                            //
// --------------------------------------------------------------------------- //
const MANIFEST_NAMES = new Set([
  'package.json', 'package-lock.json', 'bun.lock', 'pyproject.toml',
])
const REQUIREMENTS = /^requirements.*\.txt$/

// At any directory depth: `fleet/package.json` is a manifest for the same
// reason the root one is.
const isManifest = (p) => {
  const base = path.basename(p)
  return MANIFEST_NAMES.has(base) || REQUIREMENTS.test(base)
}

// Every quoted key or bare package token on the hunk's added and removed lines:
// `"left-pad": "1.3.0"` is `left-pad`, a requirements line is the token before
// `==`, `>=` or the end of the line.
const manifestNames = (filePath, lines) => {
  const base = path.basename(filePath)
  const commented = REQUIREMENTS.test(base) || base === 'pyproject.toml'
  const names = []
  const push = (name) => { if (name && !names.includes(name)) names.push(name) }
  for (const raw of lines) {
    const line = (commented ? raw.replace(/#.*$/, '') : raw).trim()
    if (!line) continue
    if (REQUIREMENTS.test(base)) {
      const m = line.match(/^([A-Za-z0-9._-]+)/)
      push(m ? m[1] : null)
      continue
    }
    const quoted = line.match(/"([^"]+)"\s*:/g)
    if (quoted) {
      for (const q of quoted) push(q.replace(/"\s*:$/, '').replace(/^"/, ''))
      continue
    }
    const bare = line.match(/^["']?([A-Za-z0-9._@/-]+)["']?\s*=/)
    push(bare ? bare[1] : null)
  }
  return names
}

const dependencyCheck = (files) => {
  const findings = []
  for (const f of files) {
    if (!isManifest(f.path)) continue
    if (!f.added.length && !f.removed.length) continue
    const names = manifestNames(f.path, f.added.concat(f.removed))
    findings.push(finding('dependencies', 'minor', 'implementer',
      'dependency manifest changed: ' + tick(f.path) +
      (names.length ? ' (' + names.join(', ') + ')' : '')))
  }
  return {
    findings,
    settled: findings.length ? [] : [settle('dependencies', 'no manifest changed')],
  }
}

// --------------------------------------------------------------------------- //
// secrets [M7]                                                                 //
// --------------------------------------------------------------------------- //
// Reported BY PATTERN NAME. A finding that echoed the matched literal would
// copy the secret into the review prompt, the referee record and the report.
const SECRET_PATTERNS = Object.freeze([
  { name: 'AKIA[0-9A-Z]{16}', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'sk-[A-Za-z0-9]{20,}', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'ghp_[A-Za-z0-9]{36}', re: /ghp_[A-Za-z0-9]{36}/ },
  { name: '-----BEGIN [A-Z ]*PRIVATE KEY-----', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
])

// Where a token-shaped literal is test data rather than a leak.
const SECRET_EXCLUDED = Object.freeze(['fleet/tests/', 'tests/', 'evals/'])

const secretCheck = (files) => {
  const findings = []
  for (const f of files) {
    if (SECRET_EXCLUDED.some((prefix) => f.path.startsWith(prefix))) continue
    for (const line of f.added) {
      for (const pattern of SECRET_PATTERNS) {
        if (!pattern.re.test(line)) continue
        findings.push(finding('secrets', 'blocking', 'implementer',
          'secret-shaped literal added in ' + tick(f.path) + ': the added line matches ' +
          tick(pattern.name) + ' (the literal itself is not echoed)'))
      }
    }
  }
  return {
    findings,
    settled: findings.length
      ? []
      : [settle('secrets', 'no secret-shaped literal added')],
  }
}

// --------------------------------------------------------------------------- //
// the linker map                                                               //
// --------------------------------------------------------------------------- //
// Which language's linker each of the task's FILES would be read by. The map is
// part of the record so a reader can tell a file the linker never looked at
// from one it looked at and said nothing about.
const LINKER_KIND = Object.freeze({
  '.mjs': 'mjs', '.js': 'mjs', '.py': 'py', '.ts': 'ts', '.tsx': 'ts',
})

const linkerMap = (files) => {
  const map = {}
  for (const p of files) {
    const kind = LINKER_KIND[path.extname(p).toLowerCase()]
    if (kind) map[p] = kind
  }
  return map
}

// `task.files` as the compiler emits it: `creates` ∪ `modifies` ∪ `reads`, in
// order, deduplicated so the linker map cannot carry one path twice.
const taskFiles = (task) => {
  const out = []
  for (const p of arr(task.files)) {
    const s = str(p)
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

// --------------------------------------------------------------------------- //
// the referee                                                                  //
// --------------------------------------------------------------------------- //
/**
 * Grade one captured patch mechanically.
 *
 * @param {object} opts
 *   `task` the compiled task (`id`, `files`, `proofTests`, `interfaces`,
 *   `body`), `patchPath` the driver-captured patch file, `baseSha`/`headSha`
 *   recorded for the reader, `cloneDir` the clone at HEAD, `siblingFiles` the
 *   wave's other tasks' `files` (an array of arrays), `exam` one of `red`,
 *   `green-at-base`, `blocked`, `null`, `examEvidence` `{cmd, exit, stdout}` or
 *   `null`, `n` the number of fix rounds preceding this patch, `linker` the
 *   injected `linkProduces`, `runDir` where the record is written (absent:
 *   nothing is written).
 * @returns {Promise<{task: string, n: number, findings: object[],
 *   settled: object[], linker: object, ms: number}>}
 * @throws rejects, writing nothing, when `patchPath` is absent or unreadable —
 *   the driver-error record the engine already keeps for a thrown referee.
 */
export const referee = async (opts = {}) => {
  const started = Date.now()
  const options = opts || {}
  const task = (options.task && typeof options.task === 'object') ? options.task : {}
  const files = taskFiles(task)

  const patch = readPatch(options.patchPath, task.id)
  const own = new Set(files.concat(arr(task.proofTests).map(str)))
  const sibling = new Set()
  for (const group of arr(options.siblingFiles)) {
    for (const p of (Array.isArray(group) ? group : [group])) sibling.add(str(p))
  }

  const parts = [
    footprintCheck(patch, own, sibling),
    await interfaceCheck(task, options),
    examCheck(task, options),
    countCheck(patch, task),
    dependencyCheck(patch),
    secretCheck(patch),
  ]

  const result = {
    task: str(task.id),
    n: Number.isInteger(options.n) ? options.n : 0,
    findings: parts.flatMap((p) => p.findings),
    settled: parts.flatMap((p) => p.settled).concat([
      settle('integrated-suite', INTEGRATED_SUITE),
    ]),
    linker: linkerMap(files),
    ms: 0,
  }
  result.ms = Math.max(0, Math.round(Date.now() - started))

  if (options.runDir) {
    const dir = path.join(String(options.runDir), 'referee')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'task-' + result.task + '-' + result.n + '.json'),
      JSON.stringify(result, null, 2) + '\n')
  }
  return result
}

export default referee
