# Ledger: convert an amount written as text

**Grammar:** claims-v1
**Claim:** I open the pull request on flock-baseline and the ledger converts an amount written as text from one currency to another, and refuses a currency it does not know by name. (elicited)
**Summary:** Two additions to the currency module: looking up a currency's rate, with a clear refusal for an unknown one, and converting an amount written as text.

**Goal:** Add text conversion and a rate lookup to the currency module.
**Tech Stack:** Python 3 + pytest. Run the suite with `python3 -m pytest -q -p no:cacheprovider` from the repository root.

**Base:** `ledger/__init__.py`, `ledger/core.py`, `ledger/rates.py` and `tests/test_ledger.py` exist at BASE, `d668b2e720fc3bac33a919b364ec48d89d906e52` on flock-baseline's main.

Spec: none.

## Global Constraints

- Check: python3 -m pytest -q -p no:cacheprovider

---

### Task 1: Look up a currency's rate

**Type:** implementation

**Files:**
- Modify: `ledger/rates.py`

**Claim:** An operator looks up a currency's rate and is told by name when the currency is unknown. (derived)
Machine: M1. `rate_of("EUR")` is exactly `90`. M2. `rate_of("XYZ")` raises `ValueError` whose message is exactly `unknown currency: XYZ`.

**Authorized-by:** operator's pick, 2026-11-13

**Interfaces:**
- Consumes: nothing
- Produces: `rate_of(code: str) -> int`

**Context:** `rate_of(code)` answers `RATES[code]`, and raises `ValueError` for a code that is not in `RATES`.

**Proof:**
- Run: python3 -c "from ledger.rates import rate_of; assert rate_of('EUR') == 90" [M1]
- Run: python3 -c "import pytest; from ledger.rates import rate_of; pytest.raises(ValueError, rate_of, 'XYZ').match('^unknown currency: XYZ$')" [M2]
- Legs: (a) a known rate [M1]; (b) the refusal's message, byte for byte [M2].

**Stale-if:**
- path-absent: `ledger/rates.py`

### Task 2: Convert an amount written as text

**Type:** implementation

**Files:**
- Modify: `ledger/rates.py`

**Claim:** An operator converts an amount written as text from one currency to another. (derived)
Machine: M1. `convert_text("10.00", "USD", "EUR")` is exactly `"9.00"`. M2. `convert_text("10.00", "USD", "XYZ")` raises `ValueError` whose message is exactly `unknown currency: XYZ`.

**Authorized-by:** operator's pick, 2026-11-13

**Interfaces:**
- Consumes: nothing
- Produces: `convert_text(amount: str, source: str, target: str) -> str`

**Context:** `convert_text` reads the amount with `cents` from `ledger.core`, looks up both rates with `rate_of`, and answers `dollars` of `cents * rate_of(target) // rate_of(source)`.

**Proof:**
- Run: python3 -c "from ledger.rates import convert_text; assert convert_text('10.00', 'USD', 'EUR') == '9.00'" [M1]
- Run: python3 -c "import pytest; from ledger.rates import convert_text; pytest.raises(ValueError, convert_text, '10.00', 'USD', 'XYZ').match('^unknown currency: XYZ$')" [M2]
- Legs: (a) ten dollars in euros, to the cent [M1]; (b) the refusal's message for an unknown target, byte for byte [M2].

**Stale-if:**
- path-absent: `ledger/rates.py`
