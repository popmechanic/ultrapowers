// fleet/exam-paths.mjs — where a run's peer-written exams actually land (#777).
//
// A task's Proof names the path its exam is written FOR. This module answers
// the different question of where that exam is written TO. The two are allowed
// to differ so that an operator opening a run's integration branch can tell the
// peers' measurements apart from the project's own curated tests at a glance:
// every exam a run writes sits under one reserved directory per test root,
// named for the run.
//
//   tests/<rest>        ->  tests/exams/<slug>/<rest>
//   fleet/tests/<rest>  ->  fleet/tests/exams/<slug>/<rest>
//   anything else       ->  itself
//
// `<slug>` is the run id with every character outside `[A-Za-z0-9_]` replaced
// by `_` — `run-7` is `run_7`. The underscore is not tidiness. Under
// `pytest.ini`'s `testpaths = tests`, a curated `tests/test_a.py` beside an
// exam's `tests/exams/<run>/test_a.py` aborts collection with `import file
// mismatch` in every shape tried, and collects both only when the exam's
// directories are a real package — which needs a directory name that is a
// Python identifier, so `run-53` cannot be one and `run_53` is.
//
// The rule lives here because three readers share it: `fleet/run-engine.mjs`
// (which remaps the examiner's command, hands the bytes over at the landing
// path and folds them), the `EXAM PATHS:` lines the examiner's prompt carries,
// and `fleet/strip-exams.sh`, which spells the same slug in bash.

// Every character outside `[A-Za-z0-9_]` becomes `_`; the bash spelling in
// strip-exams.sh is the same substitution over the same class.
export const examSlug = (runId) =>
  String(runId == null ? '' : runId).replace(/[^A-Za-z0-9_]/g, '_')

// The two test roots, longest first so `fleet/tests/` is matched as itself
// rather than as some path that merely contains `tests/`.
const ROOTS = ['fleet/tests/', 'tests/']

// The reserved directory under each root, in root order — what a sweep that
// wants to delete or ignore a run's exams enumerates.
export const reservedExamDirs = (runId) => {
  const slug = examSlug(runId)
  return ['tests/exams/' + slug, 'fleet/tests/exams/' + slug]
}

// The landing path for one Proof path. A path under neither root is returned
// unchanged — the sims' `t1_test.sh` and every plan that puts its tests
// somewhere else keep the paths they had. Remapping is idempotent: a path
// already under its own reserved directory is already where it lands.
export const reservedExamPath = (p, runId) => {
  const s = String(p == null ? '' : p)
  for (const root of ROOTS) {
    if (!s.startsWith(root)) continue
    const dir = root + 'exams/' + examSlug(runId) + '/'
    return s.startsWith(dir) ? s : dir + s.slice(root.length)
  }
  return s
}
