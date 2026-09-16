/**
 * fleet/tests/test_run_engine_state_handshake.mjs — the Proof path of task 2
 * (*the driver's two reads — seed the consumer from the post, refuse a post the
 * expected file contradicts*), pointing at where the measurement actually
 * lives.
 *
 * The exam for this task is not here. A run writes its exams into the reserved
 * directory `fleet/tests/exams/<slug>/` (#890) — this run's `EXAM PATHS:` line
 * sent it to `exams/run_155/` — and the driver's handoff then puts the Proof
 * path back to BASE (`run-engine.mjs`, `for (const [p] of examMoves) await
 * restoreToBase(cloneDir, p)`), so the branch holds the measurement once, where
 * the reserved directory says.
 *
 * The Proof's own `Run:` line still names THIS path, though, and the driver
 * runs it verbatim (`examRunCmd` is rewritten through `examMoves`; `proofRuns`
 * is not). So this file is what stands at the named path: a single static
 * import of the landed exam, which executes it in this process and prints its
 * own `ALL TESTS PASSED`. It is a pointer, not a second copy — there is exactly
 * one set of assertions in the tree, and it is the examiner's.
 *
 * An import rather than a child process on purpose: a spawn carrying a
 * `test_*.mjs` literal is a sibling-sim run, which
 * `fleet/tests/test_sims_are_hermetic.mjs` names as an offender.
 */
import './exams/run_155/test_run_engine_state_handshake.mjs'
