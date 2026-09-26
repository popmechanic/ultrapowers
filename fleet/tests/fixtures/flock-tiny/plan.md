# Flock tiny fixture

**Grammar:** claims-v1
**Claim:** A two-task plan the Flock engine's probes run with scripted builders. (elicited)
**Summary:** A fixture, not a plan anyone launches. It gives the Flock engine a target small enough to settle in seconds. Nothing reads it but the engine's own probes.
**Goal:** Give the engine a plan with one derived edge.
**Tech Stack:** Python 3

## Global Constraints

- Check: test -n "$ULTRA_BASE"

### Task 1: The adder

**Type:** implementation

**Files:**
- Modify: `calc.py`

**Claim:** `add` adds. (derived)
Machine: M1. `add(2, 3)` returns `5`.

**Authorized-by:** fixture

**Interfaces:**
- Consumes: none
- Produces: `add(a, b) -> int`

**Context:** `calc.py` returns 0 at BASE.

**Proof:**
- Run: python3 -c "from calc import add; assert add(2, 3) == 5" [M1]
- Legs: (a) `add(2, 3)` is `5` [M1].

**Stale-if:**
- path-absent: `calc.py`

### Task 2: The total

**Type:** implementation

**Files:**
- Create: `report.py`

**Claim:** `total` sums through `add`. (derived)
Machine: M1. `total([1, 2, 3])` returns `6`.

**Authorized-by:** fixture

**Interfaces:**
- Consumes: `add(a, b) -> int`
- Produces: `total(xs) -> int`

**Context:** `total` folds `add` over the list from 0.

**Proof:**
- Run: python3 -c "from report import total; assert total([1, 2, 3]) == 6" [M1]
- Legs: (a) `total([1, 2, 3])` is `6` [M1].

**Stale-if:**
- path-exists: `report.py`
