# Ledger: print a report from the command line

**Grammar:** claims-v1
**Claim:** I open the pull request on flock-baseline and `python3 -m ledger` prints the report of the ledger text it is given on standard input. (elicited)
**Summary:** One addition: the ledger can be run as a command that reads ledger text and prints its report.

**Goal:** Let the ledger run as a command.
**Tech Stack:** Python 3 + pytest. Run the suite with `python3 -m pytest -q -p no:cacheprovider` from the repository root.

**Base:** `ledger/__init__.py`, `ledger/core.py`, `ledger/rates.py` and `tests/test_ledger.py` exist at BASE, `d668b2e720fc3bac33a919b364ec48d89d906e52` on flock-baseline's main.

Spec: none.

## Global Constraints

- Check: python3 -m pytest -q -p no:cacheprovider

---

### Task 1: Run the ledger as a command

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** An operator pipes ledger text into `python3 -m ledger` and reads its report. (derived)
Machine: M1. `python3 -m ledger`, given `2026-09-01,cash,-12.50,coffee` on standard input, prints a last line that begins with the word `total` and a space, and ends `-12.50`.

**Authorized-by:** operator's pick, 2026-11-13

**Interfaces:**
- Consumes: nothing
- Produces: none

**Context:** The command reads all of standard input and prints the module's `report(text)`.

**Proof:**
- Run: printf '2026-09-01,cash,-12.50,coffee\n' | python3 -m ledger | tail -1 | grep -q '^total .*-12\.50$' [M1]
- Legs: (a) the command's last line for a one-entry ledger [M1].

**Stale-if:**
- path-absent: `ledger/core.py`
