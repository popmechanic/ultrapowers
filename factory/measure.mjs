/**
 * Measuring a candidate: its own proof lines, the existing tests its patch
 * touches, and the judge's reading — plus the score a candidate is ranked by
 * and the landing post written after each measurement. `makeMeasure(ctx)`
 * takes the run's state as one context object.
 */
import fs from 'node:fs'
import path from 'node:path'

import { literalsOf, hunksCarrying, filesShown } from './hunks.mjs'
import { candidateTests, commandFor, excerptFor } from './select.mjs'
import { runLines } from './proofs.mjs'
import { settledCoverage, observedFacts, clauseFacts } from './facts.mjs'

/** One patch, split into its per-file diffs, keyed by path. */
export function splitDiff (text) {
  const pattern = /^diff --git a\/(\S+) b\/\S+\n([\s\S]*?)(?=^diff --git |(?![\s\S]))/gm
  return Object.fromEntries([...String(text || '').matchAll(pattern)].map((m) => [m[1], m[2]]))
}

// ── the tests argument a Jev reader is asked: excerpted, then budget-trimmed ─

const SELECT_TESTS_BUDGET_BYTES = 60000

/**
 * `found` (a `candidateTests` result, most-matching first) turned into the
 * `tests` argument a reader gets: each candidate's file text excerpted to
 * `cap` characters around its own hits (M2), then candidates dropped from
 * the end of the list — the least-matching first — until the serialized
 * result is at most 60,000 bytes (M3). `kept`/`dropped` describe the trim
 * whether or not one actually happened.
 */
export function excerptTests (found, readFile, cap) {
  const entryFor = (c) => ({ path: c.path, text: excerptFor(readFile(c.path), c.hits, cap) })
  let kept = found
  let tests = kept.map(entryFor)
  while (kept.length > 0 && Buffer.byteLength(JSON.stringify(tests), 'utf8') > SELECT_TESTS_BUDGET_BYTES) {
    kept = kept.slice(0, -1)
    tests = kept.map(entryFor)
  }
  return { tests, kept: kept.length, dropped: found.length - kept.length }
}

// ── M2: the candidates a landing offers a sibling to settle against ─────────

/** One top-level export, added by a patch: `export function|const|class
 *  <name>`, `def <name>` or `class <name>`, on a line the patch adds (`+`,
 *  never `+++`). */
const EXPORT_LINE_RE = /^\+\s*(?:export\s+(?:function|const|class)\s+([A-Za-z_$][\w$]*)|def\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*))/

/** The task's own candidates: every top-level export its patch adds — read
 *  off the added lines of each file's diff — plus its plan `Produces:`
 *  entries, in that order, deduplicated. `fileOf` maps a patch-derived name
 *  back to the file it was found on, for M2's `interface.settled.file`. */
export function candidatesOf (task, patchText) {
  const perFile = splitDiff(patchText)
  const fileOf = new Map()
  const names = []
  for (const file of Object.keys(perFile)) {
    for (const line of String(perFile[file]).split('\n')) {
      if (!line.startsWith('+') || line.startsWith('+++')) continue
      const m = EXPORT_LINE_RE.exec(line)
      const name = m && (m[1] || m[2] || m[3])
      if (!name) continue
      if (!fileOf.has(name)) fileOf.set(name, file)
      if (!names.includes(name)) names.push(name)
    }
  }
  for (const p of ((task.interfaces || {}).produces || [])) {
    const s = String(p)
    if (s && !names.includes(s)) names.push(s)
  }
  return { names, fileOf }
}

export function makeMeasure (ctx) {
  const {
    proofsEnabled, proofTimeoutSeconds, selectPolicy, factsEnabled, factsCapBytes, jevClaimMode,
    judge, read, board, appendEvent, capture, cloneAt, runDir, sh, git, exitOf, outOf,
  } = ctx

  /** M2's landing post: `factsExit`, any failing proof line's own command
   *  and output tail, the judge's claim reading, and the lowest-covered
   *  clause — its own text, off the task, and the score the judge gave it.
   *  Posted after every measurement of the candidate the task is riding: the
   *  initial one, and again after any redispatch (M4) or blocking-finding
   *  fix remeasures it. */
  const postLanding = async (task, best) => {
    const coverage = Array.isArray(best.coverage) ? best.coverage : []
    let low = 0
    for (let i = 1; i < coverage.length; i += 1) {
      if ((Number(coverage[i]) || 0) < (Number(coverage[low]) || 0)) low = i
    }
    const clauseText = (task.clauses && task.clauses[low]) || '(no clause text)'
    const clauseScore = coverage.length ? coverage[low] : null
    // M2: a failing proof Run: line's own command and output tail are in the
    // worker's hands — carried into this same landing fact.
    const failedRuns = Array.isArray(best.runLines) ? best.runLines.filter((r) => r.exit !== 0) : []
    const runsText = failedRuns.length
      ? '\n\nfailing proof line(s):\n' +
        failedRuns.map((r) => r.cmd + '\nexit ' + r.exit + '\n' + r.tail).join('\n\n')
      : ''
    const text = 'exit ' + best.factsExit +
      '\nclaim: ' + (best.claim === null || best.claim === undefined ? 'null' : best.claim) +
      '\nlowest-covered clause (' + clauseScore + '): ' + clauseText + runsText
    await board.post(task.id, 'landing', text)
    // M4: every landing writes Jev's claim reading to the record, whatever
    // `gate.jev_claim.mode` says — the row is unconditional; only whether
    // `short` or adoption ever reads it back is gated.
    appendEvent({
      kind: 'gate:jev_claim', task: task.id,
      claim: best.claim ?? null, claimGivenFacts: best.claimGivenFacts ?? null,
      mode: jevClaimMode,
    })
  }

  /**
   * One candidate, measured: its own Proof `Run:` lines, then — in the SAME
   * clone — the few existing tests the patch touches (M2's selection, moved
   * in here so it runs once per candidate rather than once for whichever
   * candidate a task's `land()` happened to pick), then the judge's reading
   * of the patch against the task's clauses, with both sets of facts in
   * front of it.
   */
  const measure = async ({ task, dir, index, anchor, baseCloneForTask }) => {
    // M2: a task's own Proof `Run:` lines, in this candidate's own clone —
    // never split into argv (a Run: line is often a pipeline), and every
    // line runs even after an earlier one failed.
    let proofRunResults = []
    if (proofsEnabled && Array.isArray(task.proofRuns) && task.proofRuns.length) {
      proofRunResults = await runLines({
        lines: task.proofRuns, cwd: dir, sh, env: undefined, timeoutSeconds: proofTimeoutSeconds,
      })
      for (const r of proofRunResults) {
        appendEvent({ kind: 'run:line', task: task.id, cmd: r.cmd, exit: r.exit })
      }
    }
    const patch = capture(dir, anchor, path.join(runDir, `patch-${task.id}-${index}.diff`))
    const text = fs.existsSync(patch) ? fs.readFileSync(patch, 'utf8') : ''
    const perFile = splitDiff(text)
    const literals = literalsOf(task.clauses)
    const label = 'impl:' + task.id + ':' + index

    // M2: selection, once for this candidate — the few existing tests its
    // patch touches, run in this SAME clone; a red one is re-run at the
    // anchor to tell a genuine catch from a redness the base already had.
    let selectedRan = []
    let covered = {}
    const catches = []
    if (selectPolicy.enabled === true && typeof judge.readGuards === 'function') {
      const { names: candNames } = candidatesOf(task, text)
      const touched = Object.keys(perFile)
      const trackedInCandidate = git(['ls-files'], dir).split('\n').map((s) => s.trim()).filter(Boolean)
      const readCandidateFile = (p) => {
        try { return fs.readFileSync(path.join(dir, p), 'utf8') } catch { return '' }
      }
      const found = await candidateTests({
        files: trackedInCandidate, read: readCandidateFile,
        paths: touched, symbols: candNames,
        exclude: [], cap: selectPolicy.max_candidates,
      })
      if (found.length) {
        const { tests: guardTests, kept, dropped } = excerptTests(found, readCandidateFile, 3000)
        if (dropped > 0) appendEvent({ kind: 'select:trimmed', task: task.id, kept, dropped })
        const guards = await read('readGuards', {
          patch: hunksCarrying(text, candNames, 20000),
          tests: guardTests,
          who: { task: task.id, label },
        })
        if (guards) {
          const runSetCapped = (Array.isArray(guards.selected) ? guards.selected : []).slice(0, selectPolicy.max_run)
          const ran = []
          const reds = []
          for (const p of runSetCapped) {
            const argv = commandFor(p, selectPolicy.timeout_seconds)
            if (!argv) continue
            const r = sh(argv[0], argv.slice(1), dir)
            const exit = exitOf(r)
            ran.push({ path: p, exit })
            if (exit !== 0) reds.push({ path: p, exit, argv, out: outOf(r) })
          }
          selectedRan = ran
          for (const red of reds) {
            const baseDir = baseCloneForTask
              ? baseCloneForTask()
              : cloneAt('base-' + task.id + '-' + index, anchor)
            const r2 = sh(red.argv[0], red.argv.slice(1), baseDir)
            if (exitOf(r2) !== 0) {
              appendEvent({ kind: 'select:red-at-base', task: task.id, path: red.path })
              continue
            }
            appendEvent({ kind: 'catch', task: task.id, path: red.path, exit: red.exit })
            await board.post(task.id, 'catch', red.path + '\nexit ' + red.exit + '\n' + red.out.slice(-1500))
            catches.push(red)
          }

          // M2: `covered` = `readCovering`'s per-clause answer over the
          // selected tests that exited 0, shaped `{ M1: [paths], ... }`.
          const greenPaths = new Set(ran.filter((r) => r.exit === 0).map((r) => r.path))
          const greenTests = guardTests.filter((t) => greenPaths.has(t.path))
          const coveringRead = greenTests.length
            ? await read('readCovering', { clauses: task.clauses, tests: greenTests, who: { task: task.id, label } })
            : null
          task.clauses.forEach((_c, i) => {
            const key = 'M' + (i + 1)
            const p = coveringRead && Array.isArray(coveringRead.covered) ? coveringRead.covered[i] : null
            covered[key] = p ? [p] : []
          })

          appendEvent({
            kind: 'select:landing', task: task.id,
            candidates: found.map((c) => c.path), selected: runSetCapped, ran,
            why: Object.fromEntries(found.map((c) => [c.path, c.why])),
            covered,
          })
        }
      }
    }
    if (!Object.keys(covered).length) {
      task.clauses.forEach((_c, i) => { covered['M' + (i + 1)] = [] })
    }

    // M2: `factsExit` = 0 iff every probe exited 0 AND no selected test was
    // a catch; else the first non-zero exit among probes-then-catches, in
    // that order.
    const orderedExits = [...proofRunResults.map((r) => r.exit), ...catches.map((c) => c.exit)]
    const factsExit = orderedExits.every((e) => e === 0) ? 0 : orderedExits.find((e) => e !== 0)

    // M4: Jev is handed the facts the task's own proof lines and its
    // selected tests already observed, and the per-clause coverage those
    // same facts already settled — so a clause a cited command already
    // proved is no longer a guess from the diff alone.
    let factsArgs = {}
    let settled
    if (factsEnabled) {
      const facts = observedFacts({
        clauses: task.clauses,
        proofRuns: Array.isArray(task.proofRuns) ? task.proofRuns : [],
        proofRunClauses: Array.isArray(task.proofRunClauses) ? task.proofRunClauses : [],
        runLines: proofRunResults,
        tests: selectedRan,
        capBytes: factsCapBytes,
      })
      settled = settledCoverage({
        clauses: task.clauses,
        proofRunClauses: Array.isArray(task.proofRunClauses) ? task.proofRunClauses : [],
        runLines: proofRunResults,
      })
      const clauseFactsArr = clauseFacts({
        clauses: task.clauses,
        proofRuns: Array.isArray(task.proofRuns) ? task.proofRuns : [],
        proofRunClauses: Array.isArray(task.proofRunClauses) ? task.proofRunClauses : [],
        runLines: proofRunResults,
        tests: selectedRan,
        covers: covered,
      })
      factsArgs = { facts, settled, clauseFacts: clauseFactsArr }
    }
    const reading = await read('readLanding', {
      task: task.id,
      cwd: dir,
      clauses: task.clauses,
      patch: hunksCarrying(text, literals, 20000),
      files: filesShown(perFile, literals, 6000),
      ...factsArgs,
      who: { task: task.id, label },
    })
    if (factsEnabled) {
      appendEvent({
        kind: 'landing:facts',
        task: task.id,
        settled,
        claim: reading && typeof reading.claim === 'number' ? reading.claim : null,
        claimGivenFacts: reading && typeof reading.claimGivenFacts === 'number' ? reading.claimGivenFacts : null,
        perClause: reading && Array.isArray(reading.claimGivenFactsPerClause) ? reading.claimGivenFactsPerClause : null,
        facts: factsArgs.facts ? factsArgs.facts.length : 0,
      })
    }
    return {
      dir,
      index,
      patch,
      factsExit,
      claim: reading && typeof reading.claim === 'number' ? reading.claim : null,
      claimGivenFacts: reading && typeof reading.claimGivenFacts === 'number' ? reading.claimGivenFacts : null,
      coverage: (reading && Array.isArray(reading.coverage)) ? reading.coverage : [],
      runLines: proofRunResults,
      selected: selectedRan,
      covered,
      caught: catches.length > 0,
    }
  }

  /** M2's line, and nothing else: `factsExit` 0 first, then the claim
   *  reading, then the mean of the per-clause coverage. Rounded only far
   *  enough to keep binary floating point from turning `10 + 0.2 + 0.5` into
   *  a long tail. */
  const scoreOf = (c) => {
    const mean = c.coverage.length
      ? c.coverage.reduce((s, v) => s + (Number(v) || 0), 0) / c.coverage.length
      : 0
    return Math.round((10 * (c.factsExit === 0 ? 1 : 0) + (c.claim ?? 0) + mean) * 1e10) / 1e10
  }

  return { measure, scoreOf, postLanding }
}
