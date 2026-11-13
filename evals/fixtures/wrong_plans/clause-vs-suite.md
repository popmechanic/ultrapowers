# Ledger: money going out prints in brackets

**Grammar:** claims-v1
**Claim:** I open the pull request on flock-baseline and the ledger prints money going out in brackets, the way an accountant writes it. (elicited)
**Summary:** One change: an amount below zero prints as `(3.00)` where it printed `-3.00`.

**Goal:** Change how money going out is printed.
**Tech Stack:** Python 3 + pytest. Run the suite with `python3 -m pytest -q -p no:cacheprovider` from the repository root.

**Base:** `ledger/__init__.py`, `ledger/core.py`, `ledger/rates.py` and `tests/test_ledger.py` exist at BASE, `d668b2e720fc3bac33a919b364ec48d89d906e52` on flock-baseline's main.

Spec: none.

## Global Constraints

- Check: python3 -m pytest -q -p no:cacheprovider

---

### Task 1: Print money going out in brackets

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** An operator reads money going out in brackets. (derived)
Machine: M1. `dollars(-300)` is exactly `"(3.00)"`. M2. `dollars(1250)` is exactly `"12.50"`.

**Authorized-by:** operator's pick, 2026-11-13

**Interfaces:**
- Consumes: nothing
- Produces: none

**Context:** `dollars(n)` in `ledger/core.py` writes whole cents as text; an amount below zero is wrapped in brackets and carries no minus sign.

**Proof:**
- Run: python3 -c "from ledger.core import dollars; assert dollars(-300) == '(3.00)'" [M1]
- Run: python3 -c "from ledger.core import dollars; assert dollars(1250) == '12.50'" [M2]
- Legs: (a) an amount below zero, byte for byte [M1]; (b) an amount above zero, unchanged [M2].

**Stale-if:**
- path-absent: `ledger/core.py`
