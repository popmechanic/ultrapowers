/**
 * fleet/tests/test_factory_redkind.mjs — the exam for "One rule says
 * whether a red was a leg's or the rig's" (Authorized-by #1245 desired
 * states 1-3; CLAUDE.md §Doctrine, "Verification is mechanical and fast").
 *
 * `factory/redkind.mjs` is a new, pure, import-nothing module exporting
 * `redKind({ exit, out })` and `rigRound({ attempt, red, enabled })`. The
 * engine's exam self-check and the fold round (`factory/reverify.mjs`) both
 * read these two facts from what the engine already captured off an exam
 * run: whether a non-zero exit carries a clause citation in its output (a
 * "leg" red) or not (a "rig" red, including every timeout-124 death and
 * every exit-0 non-red), and whether a rig red at this attempt still buys
 * the examiner one more round.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] `redKind` over the four base shapes: a non-zero, non-124 exit
 *       whose output carries an `[M<n>]`-bearing bracketed span is exactly
 *       `'leg'`; a non-zero, non-124 exit whose output carries no such span
 *       is exactly `'rig'`; exit `124` is exactly `'rig'` even when the
 *       output does carry an `[M<n>]` span; exit `0` is exactly `null`;
 *   (b) [M2] a non-string `out` — `undefined` and `null` — is read as the
 *       empty string: `redKind({ exit: 1, out: undefined })` and
 *       `redKind({ exit: 1, out: null })` are each exactly `'rig'`, and
 *       neither call throws;
 *   (c) [M3] `rigRound({ attempt: 1, red: 'rig', enabled: true })` is
 *       exactly `true`, and each of the four one-at-a-time variations off
 *       that same base call — `attempt: 2`, `red: 'leg'`, `red: null`,
 *       `enabled: false` — is exactly `false`.
 *
 * M4 ("imports nothing") is proven by the plan's own `Run:` grep against
 * `factory/redkind.mjs`, not by this file — this exam only imports the
 * module and computes over literal strings, so it never runs the rig it is
 * measuring, and it stays pure: no child process, no disk, no network.
 */

import assert from 'node:assert/strict'

import { redKind, rigRound } from '../../factory/redkind.mjs'

// ── a. [M1] redKind over the four base shapes ──────────────────────────────
{
  assert.equal(
    redKind({ exit: 1, out: 'AssertionError [ERR_ASSERTION]: (a) [M1] the row is missing' }),
    'leg',
    '(a) [M1] a non-zero, non-124 exit whose output carries an [M1]-bearing bracketed span is exactly leg',
  )

  assert.equal(
    redKind({ exit: 1, out: 'TypeError: Cannot read properties of undefined' }),
    'rig',
    '(a) [M1] a non-zero, non-124 exit whose output carries no bracketed M<n> span is exactly rig',
  )

  assert.equal(
    redKind({ exit: 124, out: '(a) [M1] started' }),
    'rig',
    '(a) [M1] exit 124 is exactly rig even though the output carries an [M1] span',
  )

  assert.equal(
    redKind({ exit: 0, out: '(a) [M1] ok' }),
    null,
    '(a) [M1] exit 0 is exactly null',
  )
}

// ── b. [M2] a non-string out is read as the empty string, never throws ─────
{
  assert.doesNotThrow(
    () => redKind({ exit: 1, out: undefined }),
    '(b) [M2] redKind({ exit: 1, out: undefined }) does not throw',
  )
  assert.equal(
    redKind({ exit: 1, out: undefined }),
    'rig',
    '(b) [M2] redKind({ exit: 1, out: undefined }) is exactly rig',
  )

  assert.doesNotThrow(
    () => redKind({ exit: 1, out: null }),
    '(b) [M2] redKind({ exit: 1, out: null }) does not throw',
  )
  assert.equal(
    redKind({ exit: 1, out: null }),
    'rig',
    '(b) [M2] redKind({ exit: 1, out: null }) is exactly rig',
  )
}

// ── c. [M3] rigRound: true only at the exact base call, false off each variation ──
{
  assert.equal(
    rigRound({ attempt: 1, red: 'rig', enabled: true }),
    true,
    '(c) [M3] rigRound({ attempt: 1, red: "rig", enabled: true }) is exactly true',
  )

  assert.equal(
    rigRound({ attempt: 2, red: 'rig', enabled: true }),
    false,
    '(c) [M3] varying attempt to 2 off the base call is exactly false',
  )

  assert.equal(
    rigRound({ attempt: 1, red: 'leg', enabled: true }),
    false,
    '(c) [M3] varying red to "leg" off the base call is exactly false',
  )

  assert.equal(
    rigRound({ attempt: 1, red: null, enabled: true }),
    false,
    '(c) [M3] varying red to null off the base call is exactly false',
  )

  assert.equal(
    rigRound({ attempt: 1, red: 'rig', enabled: false }),
    false,
    '(c) [M3] varying enabled to false off the base call is exactly false',
  )
}

console.log('ALL TESTS PASSED')
