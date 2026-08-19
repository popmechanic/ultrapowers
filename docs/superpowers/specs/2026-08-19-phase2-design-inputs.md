# Phase-2 design inputs — 2026-08-19 operator conversation

Inputs for Phase-2 planning of the fold-native program
(`2026-08-18-fold-native-authoring-program.md`, rev 6 — this note ADDS to the
approved spec, it does not restate or amend it; per house doctrine, never
build from this note alone). Recorded mid-Task-10, while the T15-rig cells ran.

## The maturity ladder (framing)

Phase 1 bought **reach**: merge cost became edit-sized (hunk briefs), so
commutativity is worth harvesting wherever it occurs. The remaining ladder:

1. **Harvest** (Phase 1, shipped): fold resolves whatever separability the
   code happens to have.
2. **Declare** (Phase 2, spec'd): Commutes contracts make commutativity
   explicit; the hunk grammar already reserves the delivery channel — a HUNK
   header contract line the baked resolver prompt obeys — currently generated
   by nothing.
3. **Assume** (new input): a declared-commutative surface should eventually
   not *count* as contention at compile time — fold without expecting
   conflict, rather than resolving one. Compile-time exploitation of
   declarations is not in the spec's Phase-2 scope; weigh it there.

## New inputs (not in the spec)

- **Resolver-friendly layout as authoring guidance.** The contend fixtures
  embody it (designated growth zones, append-only registration, one edit
  site per concern) but nothing teaches it: ultraplan markers declare
  task-level structure only. A paragraph of authoring guidance ("author for
  the resolver": stable anchors, designated append zones, registration
  patterns) is skill text, not machinery — cheap, and it manufactures the
  commutativity fold harvests. Guard: guidance, not a compiler input, until
  Commutes contracts exist to carry it honestly.
- **Cross-file semantic contention is uncovered by design — name the
  posture.** The compiler is file-granular; semantic collisions across files
  (shared counters, ordering assumptions, suite-global state) are caught
  only by the integration suite + sealed exam post-merge. Round-2 cell
  20260819175934 produced a live specimen (rate-limit hook's process-global
  counter making the whole suite share one budget — flagged by review, not
  by any merge machinery). Accepted posture: defended-by-verification, not
  modeled; Phase 2 should say so explicitly rather than imply coverage.
- **Operator verification practice** (memory
  `operator-verification-practice`): no human code/test review, ever — plan +
  receipts + UI smoke are the whole human surface. Already yielded #169
  (smoke manifest), #170 (test-strength reviewer dimension), #171
  (receipt-verbatim summaries); the sealed-by-default revisit stays parked
  until the operator reopens it, and then only behind an A/B.

## Fresh evidence from Task 10 (relevant to Phase-2 sizing)

- Implementer floors drifted ~25–35% fast in 5 days on identical task text —
  calibrated fixtures decay; floors are a counted condition, never assumed
  (revalidated 2026-08-19, two rounds).
- Registry inflation 147→6,000 lines cost implementers nothing measurable —
  read cost is ~free; prescribed modules + exact-literal contracts are the
  sizing lever (T14 model re-confirmed).
- Nondeterministic merge-agent cwd fumble wrote a baseline sha into a heads
  slot (1 of 3 Phase-1-engine runs); guards caught it honestly. Hardening
  candidate (engine verifies recorded heads against git before accepting) —
  post-release, earn-by-recurrence.
