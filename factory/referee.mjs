/**
 * factory/referee.mjs — the discovery referee's dispatch trigger.
 *
 * Pure and synchronous: no `fs`, no `sh`, no import from the engine. The one
 * export, `refereeTrigger`, decides whether the referee is dispatched, off
 * the review-difficulty rung alone. The lowest-covered-clause scan the
 * referee's own prompt still wants stays in `factory/engine.mjs`'s own
 * `postLanding` — this module no longer runs it.
 */

/**
 * `refereeTrigger({ rung })` answers `{ dispatch, trigger }`: dispatched
 * exactly when `rung === true`, `trigger` then `'rung'`, else `'none'`.
 */
export const refereeTrigger = ({ rung }) => {
  const dispatch = rung === true
  return { dispatch, trigger: dispatch ? 'rung' : 'none' }
}

export default { refereeTrigger }
