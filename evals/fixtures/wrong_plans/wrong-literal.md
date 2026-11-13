# Ledger: convert several amounts at once

**Grammar:** claims-v1
**Claim:** I open the pull request on flock-baseline and the ledger converts a list of amounts from one currency to another in one call. (elicited)
**Summary:** One addition to the currency module: converting a list of amounts at once.

**Goal:** Add list conversion to the currency module.
**Tech Stack:** Python 3 + pytest. Run the suite with `python3 -m pytest -q -p no:cacheprovider` from the repository root.

**Base:** `ledger/__init__.py`, `ledger/core.py`, `ledger/rates.py` and `tests/test_ledger.py` exist at BASE, `d668b2e720fc3bac33a919b364ec48d89d906e52` on flock-baseline's main.

Spec: none.

## Global Constraints

- Check: python3 -m pytest -q -p no:cacheprovider

---

### Task 1: Convert several amounts

**Type:** implementation

**Files:**
- Modify: `ledger/rates.py`

**Claim:** An operator converts a list of amounts in whole cents from one currency to another. (derived)
Machine: M1. `convert_many([1000, 250], "USD", "EUR")` is exactly `[900, 225]`. M2. `sum(convert_many([1000, 250], "USD", "EUR"))` is exactly `1135`.

**Authorized-by:** operator's pick, 2026-11-13

**Interfaces:**
- Consumes: nothing
- Produces: `convert_many(amounts: list[int], source: str, target: str) -> list[int]`

**Context:** `convert_many` applies the module's `convert(cents, source, target)` to each amount, in order.

**Proof:**
- Run: python3 -c "from ledger.rates import convert_many; assert convert_many([1000, 250], 'USD', 'EUR') == [900, 225]" [M1]
- Run: python3 -c "from ledger.rates import convert_many; assert sum(convert_many([1000, 250], 'USD', 'EUR')) == 1135" [M2]
- Legs: (a) the converted list [M1]; (b) its sum [M2].

**Stale-if:**
- path-absent: `ledger/rates.py`
