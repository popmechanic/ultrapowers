# Ledger: a statement with a one-line summary

**Grammar:** claims-v1
**Claim:** I open the pull request on flock-baseline and the ledger prints a statement: its report, then one line saying how many entries it holds and what they sum to. (elicited)
**Summary:** Two small additions to the ledger: a one-line summary, and a statement that puts that line under the existing report.

**Goal:** Add a one-line summary and a statement to the ledger.
**Tech Stack:** Python 3 + pytest. Run the suite with `python3 -m pytest -q -p no:cacheprovider` from the repository root.

**Base:** `ledger/__init__.py`, `ledger/core.py`, `ledger/rates.py` and `tests/test_ledger.py` exist at BASE, `d668b2e720fc3bac33a919b364ec48d89d906e52` on flock-baseline's main.

Spec: none.

## Global Constraints

- Check: python3 -m pytest -q -p no:cacheprovider

---

### Task 1: Summarize a ledger in one line

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** An operator reads how many entries a ledger holds and what they sum to, in one line. (derived)
Machine: M1. `summary("2026-09-01,cash,-12.50,coffee\n2026-09-02,card,900,rent, deposit\n")` is exactly `"2 entries, total 887.50"`.

**Authorized-by:** operator's pick, 2026-11-13

**Interfaces:**
- Consumes: nothing
- Produces: `summary(text: str) -> str`

**Context:** `summary(text)` loads the text with the module's `load(text)` and answers the number of entries, the word `entries`, a comma, the word `total` and `dollars` of the module's `total(entries)`.

**Proof:**
- Run: python3 -c "from ledger.core import summary; assert summary('2026-09-01,cash,-12.50,coffee\n2026-09-02,card,900,rent, deposit\n') == '2 entries, total 887.50'" [M1]
- Legs: (a) the one-line summary of a two-entry ledger, byte for byte [M1].

**Stale-if:**
- path-absent: `ledger/core.py`

### Task 2: Print a statement

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** An operator prints a statement: the report, then the summary line. (derived)
Machine: M1. The last line of `statement(text)` is exactly `summary(text)`. M2. `statement(text)` begins with `report(text)`.

**Authorized-by:** operator's pick, 2026-11-13

**Interfaces:**
- Consumes: `summary(text: str) -> str`
- Produces: `statement(text: str) -> str`

**Context:** `statement(text)` is the module's `report(text)`, a newline, and `summary(text)` from task 1.

**Proof:**
- Run: python3 -c "from ledger.core import statement, summary; t = '2026-09-01,cash,-12.50,coffee\n2026-09-02,card,900,rent, deposit\n'; assert statement(t).splitlines()[-1] == summary(t)" [M1]
- Run: python3 -c "from ledger.core import statement, report; t = '2026-09-01,cash,-12.50,coffee\n2026-09-02,card,900,rent, deposit\n'; assert statement(t).startswith(report(t))" [M2]
- Legs: (a) the last line equals the summary [M1]; (b) the statement begins with the report [M2].

**Stale-if:**
- path-absent: `ledger/core.py`
