# Objectives — ultrapowers

_What ultrapowers is optimizing for this quarter, in plain English. Triage scores
alignment against this file. It is versioned; edit it freely._

_Last set: 2026-06-30 (operator interview)._

## North star

**Greater agent autonomy**, in service of our three value props — **token
efficiency, code quality, and execution speed** — on top of the **simplest,
most maintainable codebase that costs us none of those three.**

The thesis underneath the autonomy: ultrapowers earns the right to do more on its
own by being *checkable*. Every claim the system makes about itself is gated by
something it cannot touch — sealed exams, integration-ancestry proofs, held-out
verification. Autonomy expands only as fast as that verification boundary can
gate it.

## What we optimize for, in priority order

1. **Agent autonomy.** The operator's attention belongs in planning, not
   implementation. Move work off the operator's plate and trend the drain toward
   more hands-off (auto-merging green portfolios, lighter end-gate review) — as
   the verification boundary proves out, not before it.
2. **Token efficiency.** Fewer wasted tokens per landed task: no redundant
   bootstrapping, right-sized model tiers, no re-derivation of known facts.
3. **Code quality.** Independently verified correctness. Nothing reaches the
   integration line, or `main`, without clearing a check it cannot game.
4. **Execution speed.** Wall-clock to landed work: parallel waves, isolated
   worktrees, no needless serialization.
5. **Simplicity & maintainability.** The simplest design that costs none of the
   four above. Bias to the simpler option. The one hard exception to
   "simpler wins" is **per-task model-tier correctness** — never run Opus-grade
   work on a cheaper tier to save lines of code.

## This quarter's priorities

- **Integration correctness ranks highest** — it is the merge boundary the entire
  drain rests on. Silent done-task drops, cross-phase integration review before
  the final PR, and branch-restore guards all defend it.
- Then **authoring robustness** — plans must compile to waves deterministically
  (parser hardening, load-bearing marker guidance).
- Then **path hygiene** — get ultrapowers scratch out of `.git/` protected paths.

## Risk posture

Conservative-by-default, loosening with proof. The build drain is **v1** today:
red exam → park (no autonomous salvage), one pre-merge end gate, `main` never
touched unattended. The *direction* is more hands-off, but each loosening is
earned by first hardening the exam and integration boundary that makes the
autonomy safe.
