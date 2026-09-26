# Flock baseline: ledger through today's factory

**Grammar:** claims-v1

**Claim:** I open the merged pull request on flock-baseline and a ledger line parses into an entry, a ledger loads, balances, totals by month and prints a report, and every entry is checked for its account and its amount against the account's limit, on a field now called amount, with every check green. (elicited)
**Summary:** This runs the seven ledger tasks through today's factory on the fleet, all in one 359-line module full of look-alike lines, with two producer/consumer chains, a rename that cuts across four of the other tasks, and two tasks that add a line at the same spot. It is the same bigger collision workload the laptop Flock just ran at n=5 per arm, so the two systems can be compared where they should separate. You get the factory's numbers on that workload, from three runs, beside the swarm's.

**Goal:** A like-for-like baseline for map popmechanic/ultrapowers#1292 ticket 4, second pass: the ledger workload's seven tasks, all in `ledger/core.py`, with the prototype's own fact commands as each task's probes.

**Tech Stack:** Python 3 + pytest. Run the suite with `python3 -m pytest -q -p no:cacheprovider` from the repository root.

**Base:** `ledger/__init__.py`, `ledger/core.py` and `tests/test_ledger.py` exist at BASE, seeded by one commit on flock-baseline, `520dd9d39c4f01700d0afa1ca770af0718b202f7` on flock-baseline's main (the seed `ccdf5b58`, first cut on `24397a5a`, placed onto main `c5c83c62`; `ledger/` is byte-identical), from the prototype's `LEDGER_CORE` and `LEDGER_TESTS`.

Spec: popmechanic/ultrapowers#1292 (the Flock map) and its ticket 4 scope comment.

## Global Constraints

- Check: python3 -m pytest -q -p no:cacheprovider
- The `Entry` field is named `amount` in the result; no code in `ledger/` reads or writes a field called `amt`.

---

### Task 1: Parse a ledger line

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** An operator hands over a ledger line and gets an entry back, with a memo that may contain commas, or a clear error when the line is malformed. (derived)
Machine: M1. `parse_entry("2026-09-01,cash,-12.50,coffee")` equals `Entry("2026-09-01", "cash", -1250, "coffee")`. M2. `parse_entry("2026-09-02,card,3,rent, deposit").memo` is `"rent, deposit"`. M3. `parse_entry("nope")`, `parse_entry("2026-09-01,cash,x,m")` and `parse_entry("2026-13-01,cash,1,m")` each raise `ValueError` whose message is exactly `bad entry`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, second pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `parse_entry(line: str) -> Entry`

**Context:** Seven tasks of this plan edit `ledger/core.py` at the same time. Task 3 renames the `Entry` field `amt` to `amount` everywhere; the final name is `amount`, so write new code against `amount`, and leave the rename itself to task 3. A line has four comma-separated columns, `date,account,amount,memo`; the memo is everything after the third comma. The amount column is dollars as text and becomes whole cents through the module's own `cents(text)` (which answers `None` for text that is not an amount); the date must pass the module's own `is_date(text)`. A line with fewer than four columns, a bad date or a bad amount is malformed. `parse_entry` builds the `Entry` positionally.

**Proof:**
- Run: python3 -c "from ledger.core import Entry, parse_entry; assert parse_entry('2026-09-01,cash,-12.50,coffee') == Entry('2026-09-01', 'cash', -1250, 'coffee')" [M1]
- Run: python3 -c "from ledger.core import parse_entry; assert parse_entry('2026-09-02,card,3,rent, deposit').memo == 'rent, deposit'" [M2]
- Run: python3 -c "import pytest; from ledger.core import parse_entry; [pytest.raises(ValueError, parse_entry, s).match('^bad entry$') for s in ('nope', '2026-09-01,cash,x,m', '2026-13-01,cash,1,m')]" [M3]
- Legs: (a) the parsed entry equals exactly `Entry("2026-09-01", "cash", -1250, "coffee")` [M1]; (b) the memo keeps its comma [M2]; (c) each of the three malformed lines raises with the exact message, and a line that raised nothing fails the probe [M3].

**Stale-if:**
- path-absent: `ledger/core.py`

### Task 2: Load a ledger and balance an account

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** An operator loads a ledger from text, skipping blank lines and comment lines, and reads one account's balance. (derived)
Machine: M1. `load("2026-09-01,cash,-1,a\n\n# note\n2026-09-02,card,2.50,b\n")` returns two entries whose `(account, memo)` pairs are `("cash", "a")` and `("card", "b")`, in that order. M2. For the entries cash −150, card 900, cash 1000, `balance(entries, "cash")` is `850` and `balance(entries, "food")` is `0`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, second pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `parse_entry(line: str) -> Entry`
- Produces: `load(text: str) -> list[Entry]`
- Produces: `balance(entries, account) -> int`

**Context:** Seven tasks of this plan edit `ledger/core.py` at the same time. Task 3 renames the `Entry` field `amt` to `amount` everywhere; the final name is `amount`, so write new code against `amount`, and leave the rename itself to task 3. `load` parses, with `parse_entry(line: str) -> Entry` from task 1, every line that is not blank and does not start with `#`. `balance` is the sum of the amounts of the entries on that account, in cents.

**Proof:**
- Run: python3 -c "from ledger.core import load; es = load('2026-09-01,cash,-1,a\n\n# note\n2026-09-02,card,2.50,b\n'); assert [(e.account, e.memo) for e in es] == [('cash', 'a'), ('card', 'b')]" [M1]
- Run: python3 -c "from ledger.core import Entry, balance; es = [Entry('2026-09-01', 'cash', -150, 'a'), Entry('2026-09-02', 'card', 900, 'b'), Entry('2026-09-03', 'cash', 1000, 'c')]; assert balance(es, 'cash') == 850 and balance(es, 'food') == 0" [M2]
- Legs: (a) the blank and comment lines are skipped and the two entries come back in order [M1]; (b) the cash balance is 850 and an account with no entries is 0 [M2].

**Stale-if:**
- path-absent: `ledger/core.py`

### Task 3: Rename amt to amount

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** Every entry's money is called its amount, everywhere in the ledger, and everything that read it still works. (derived)
Machine: M1. No whole word `amt` remains in `ledger/core.py`. M2. `Entry("2026-09-01", "cash", -150, "a").amount` is `-150`, and over the entries cash −150 "a" and card 900 "b", `total` is `750`, `largest` is the one with memo `"b"` and `debits` keeps only memo `"a"`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, second pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `Entry.amount: int`

**Context:** Seven tasks of this plan edit `ledger/core.py` at the same time, and four of them write new code against `amount` while this task lands. Rename the `Entry` field `amt` to `amount` and every use of it in `ledger/core.py` (the selecting, summing and picking helpers all read it). The base tests in `tests/test_ledger.py` construct `Entry` positionally and name no `amt`.

**Proof:**
- Run: python3 -c "import re, sys; sys.exit(1 if re.search(r'\bamt\b', open('ledger/core.py').read()) else 0)" [M1]
- Run: python3 -c "from ledger.core import Entry, total, largest, debits; es = [Entry('2026-09-01', 'cash', -150, 'a'), Entry('2026-09-02', 'card', 900, 'b')]; assert es[0].amount == -150 and total(es) == 750 and largest(es).memo == 'b' and [e.memo for e in debits(es)] == ['a']" [M2]
- Legs: (a) the whole-word count of `amt` in `ledger/core.py` is zero [M1]; (b) the field reads as `amount`, and `total`, `largest` and `debits` agree on it [M2].

**Stale-if:**
- path-absent: `ledger/core.py`

### Task 4: Account rules, and a savings account

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** An entry on an account the ledger does not know is flagged, and savings is a known account. (derived)
Machine: M1. `check_account` answers `"unknown account"` for an entry on account `"nope"` and `None` for one on `"savings"`. M2. `account_kind("savings")` is `"asset"`, `account_limit("savings")` is `None`, and `"savings"` comes right after `"checking"` in `ACCOUNTS`. M3. The first two names in `VALIDATORS` are `check_date`, `check_account`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, second pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `check_account(entry) -> str | None`

**Context:** Seven tasks of this plan edit `ledger/core.py` at the same time; task 5 edits the lines next to yours (the `ACCOUNTS` table, the validator stubs and the `VALIDATORS` list). Task 3 renames the `Entry` field `amt` to `amount`; leave the rename to it. Implement `check_account`: `"unknown account"` when the entry's account is not a key of `ACCOUNTS`, else `None`. Add a `"savings"` account to `ACCOUNTS`, directly after `"checking"`, with the same three keys as the others: kind `"asset"`, currency `"USD"`, limit `None`. Register `check_account` in `VALIDATORS` directly after `check_date`, so the order is `check_date`, `check_account`, then whatever task 5 adds, then `check_memo`.

**Proof:**
- Run: python3 -c "from ledger.core import Entry, check_account; assert check_account(Entry('2026-09-01', 'nope', 1, 'm')) == 'unknown account' and check_account(Entry('2026-09-01', 'savings', 1, 'm')) is None" [M1]
- Run: python3 -c "from ledger.core import ACCOUNTS, account_kind, account_limit; ks = list(ACCOUNTS); assert account_kind('savings') == 'asset' and account_limit('savings') is None and ks.index('savings') == ks.index('checking') + 1" [M2]
- Run: python3 -c "from ledger.core import VALIDATORS; assert [f.__name__ for f in VALIDATORS][:2] == ['check_date', 'check_account']" [M3]
- Legs: (a) an unknown account is flagged and savings is not [M1]; (b) savings' kind, limit and position right after checking [M2]; (c) the first two validators, in order [M3].

**Stale-if:**
- path-absent: `ledger/core.py`

### Task 5: Amount rules, and limits on cash and card

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** An entry bigger than its account's limit is flagged, and cash and card now have limits. (derived)
Machine: M1. `account_limit` is `50000` for `"cash"`, `200000` for `"card"` and `None` for `"checking"`. M2. `check_amount` answers `"over limit"` for a cash entry of −50001, and `None` for a cash entry of −50000, a checking entry of 10**9 and an entry of 10**9 on the unknown account `"nope"`. M3. The last two names in `VALIDATORS` are `check_amount`, `check_memo`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, second pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `Entry.amount: int`
- Produces: `check_amount(entry) -> str | None`

**Context:** Seven tasks of this plan edit `ledger/core.py` at the same time; task 4 edits the lines next to yours (the `ACCOUNTS` table, the validator stubs and the `VALIDATORS` list). Task 3 renames the `Entry` field `amt` to `amount` everywhere; the final name is `amount`, so write `check_amount` against `entry.amount`, and leave the rename itself to task 3. Every account in `ACCOUNTS` has a `"limit": None,` line, so say which account you are changing. Set the limit of `"cash"` to `50000` and of `"card"` to `200000` (cents). `check_amount` answers `"over limit"` when the entry's account has a limit and the entry's size (the absolute amount) is more than it, and `None` otherwise, including for an account `ACCOUNTS` does not know. Register `check_amount` in `VALIDATORS` directly before `check_memo`, so the order is `check_date`, whatever task 4 adds, `check_amount`, `check_memo`.

**Proof:**
- Run: python3 -c "from ledger.core import account_limit; assert (account_limit('cash'), account_limit('card'), account_limit('checking')) == (50000, 200000, None)" [M1]
- Run: python3 -c "from ledger.core import Entry, check_amount; E = lambda a, n: Entry('2026-09-01', a, n, 'm'); assert check_amount(E('cash', -50001)) == 'over limit' and check_amount(E('cash', -50000)) is None and check_amount(E('checking', 10**9)) is None and check_amount(E('nope', 10**9)) is None" [M2]
- Run: python3 -c "from ledger.core import VALIDATORS; assert [f.__name__ for f in VALIDATORS][-2:] == ['check_amount', 'check_memo']" [M3]
- Legs: (a) the three limits, exactly [M1]; (b) one over-limit entry is flagged and the three in-limit or limitless ones are not [M2]; (c) the last two validators, in order [M3].

**Stale-if:**
- path-absent: `ledger/core.py`

### Task 6: Monthly totals

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** An operator sees what each month came to, months in the order they first appear. (derived)
Machine: M1. For the entries 2026-08-31 cash −100, 2026-09-01 card 250 and 2026-09-15 cash −50, `monthly_totals` is `{"2026-08": -100, "2026-09": 200}` with its keys in that order, and `monthly_totals([])` is `{}`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, second pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `Entry.amount: int`
- Produces: `monthly_totals(entries) -> dict[str, int]`

**Context:** Seven tasks of this plan edit `ledger/core.py` at the same time. Task 3 renames the `Entry` field `amt` to `amount` everywhere; the final name is `amount`, so write new code against `amount`, and leave the rename itself to task 3. A month's key is the first seven characters of the entry's date (`YYYY-MM`).

**Proof:**
- Run: python3 -c "from ledger.core import Entry, monthly_totals; es = [Entry('2026-08-31', 'cash', -100, 'a'), Entry('2026-09-01', 'card', 250, 'b'), Entry('2026-09-15', 'cash', -50, 'c')]; m = monthly_totals(es); assert m == {'2026-08': -100, '2026-09': 200} and list(m) == ['2026-08', '2026-09'] and monthly_totals([]) == {}" [M1]
- Legs: (a) the two month totals, their key order, and the empty case [M1].

**Stale-if:**
- path-absent: `ledger/core.py`

### Task 7: Format an entry and print a report

**Type:** implementation

**Files:**
- Modify: `ledger/core.py`

**Claim:** An operator prints a ledger as aligned lines with a total at the bottom. (derived)
Machine: M1. `format_entry(Entry("2026-09-01", "cash", -1250, "coffee"))` is exactly `"2026-09-01  cash          -12.50  coffee"`. M2. `report("2026-09-01,cash,-12.50,coffee\n2026-09-02,card,900,rent, deposit\n")` is exactly the three lines `"2026-09-01  cash          -12.50  coffee"`, `"2026-09-02  card          900.00  rent, deposit"` and `"total                     887.50"`, joined by newlines, with no trailing newline.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, second pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `load(text: str) -> list[Entry]`
- Consumes: `Entry.amount: int`
- Produces: `format_entry(entry) -> str`
- Produces: `report(text: str) -> str`

**Context:** Seven tasks of this plan edit `ledger/core.py` at the same time. Task 3 renames the `Entry` field `amt` to `amount` everywhere; the final name is `amount`, so write new code against `amount`, and leave the rename itself to task 3. `format_entry` is the date, two spaces, the account left-aligned in 10 columns, the amount through the module's `dollars(n)` right-aligned in 10 columns, two spaces, and the memo. `report` loads the text with `load(text: str) -> list[Entry]` from task 2, formats every entry, and ends with a line that is `total` left-aligned in 22 columns followed by `dollars` of the module's `total(entries)` right-aligned in 10 columns.

**Proof:**
- Run: python3 -c "from ledger.core import Entry, format_entry; assert format_entry(Entry('2026-09-01', 'cash', -1250, 'coffee')) == '2026-09-01  cash          -12.50  coffee'" [M1]
- Run: python3 -c "from ledger.core import report; assert report('2026-09-01,cash,-12.50,coffee\n2026-09-02,card,900,rent, deposit\n') == '2026-09-01  cash          -12.50  coffee\n2026-09-02  card          900.00  rent, deposit\ntotal                     887.50'" [M2]
- Legs: (a) the formatted line, byte for byte [M1]; (b) the three-line report, byte for byte, with no trailing newline [M2].

**Stale-if:**
- path-absent: `ledger/core.py`
