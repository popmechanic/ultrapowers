# Ledger: the memo of the biggest entry

**Grammar:** claims-v1
**Claim:** I open the pull request on flock-baseline and the ledger names the memo of the entry that moved the most money, in either direction. (elicited)
**Summary:** One addition: a function that answers the memo of the biggest entry by size, whether money came in or went out.

**Goal:** Add a function that names the biggest entry.
**Tech Stack:** Python 3 + pytest. Run the suite with `python3 -m pytest -q -p no:cacheprovider` from the repository root.

**Base:** `ledger/__init__.py`, `ledger/core.py`, `ledger/rates.py` and `tests/test_ledger.py` exist at BASE, `d668b2e720fc3bac33a919b364ec48d89d906e52` on flock-baseline's main.

Spec: none.

## Global Constraints

- Check: python3 -m pytest -q -p no:cacheprovider

---

### Task 1: Name the biggest entry

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** An operator asks which entry moved the most money, in either direction, and reads its memo. (derived)
Machine: M1. `biggest_memo("2026-09-01,rent,-5000,landlord\n2026-09-02,card,900,pay\n")` is exactly `"landlord"`.

**Authorized-by:** operator's pick, 2026-11-13

**Interfaces:**
- Consumes: nothing
- Produces: `biggest_memo(text: str) -> str`

**Context:** `load(text)` answers a list of dicts with the keys `date`, `account`, `amt` and `memo`, and the module's `largest(entries)` already answers the dict whose `amt` is furthest from zero, so `biggest_memo` is `largest(load(text))["memo"]`.

**Proof:**
- Run: python3 -c "from ledger.core import biggest_memo; assert biggest_memo('2026-09-01,rent,-5000,landlord\n2026-09-02,card,900,pay\n') == 'landlord'" [M1]
- Legs: (a) the memo of the entry furthest from zero, where that entry is money going out [M1].

**Stale-if:**
- path-absent: `ledger/core.py`
