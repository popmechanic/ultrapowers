# Slips probe

**Grammar:** claims-v1

**Claim:** A plan free of the five slips checks out. (elicited)
**Summary:** The checker refuses five slips the author used to catch by eye. This plan carries none of them (n=2 runs, 2026-09-22). So it prints PLAN OK.

**Goal:** Show a plan the slip checks pass.
**Closes:** #1
**Tech Stack:** Python 3.

---

### Task 1: A clean task

**Type:** implementation

**Files:**
- Modify: `tests/fixtures/plan_check_slips/target.txt`

**Claim:** The clean task carries every slot. (derived)
Machine: M1. `true` exits 0.

**Authorized-by:** operator decisions 2026-09-29 (fixture)

**Interfaces:** Consumes: none; Produces: none

**Context:** Nothing to build; the slots are the point (n=1 run, 2026-09-22).

**Proof:**
- Run: true [M1]

~~~
true
~~~

- Legs: (a) true exits 0 [M1].

**Stale-if:** path-exists: `tests/fixtures/plan_check_slips/never-there.md`
