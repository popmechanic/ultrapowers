# Flock baseline: inventory through today's factory

**Grammar:** claims-v1

**Claim:** I open the merged pull request on flock-baseline and a stock line parses into an item, a stock list values itself and loads from text, and restocking works on a field now called quantity, with every check green. (elicited)
**Summary:** This runs the three inventory tasks through today's factory on the fleet: three changes to one small module at once, including a rename that cuts across the other two. It is the same collision-heavy work the laptop Flock prototype already did, so the two systems can be compared on the case where agents step on each other. You get a measured answer to how the factory handles same-file collisions next to how the swarm handled them.

**Goal:** A like-for-like baseline for map popmechanic/ultrapowers#1292 ticket 4: the inventory workload's three tasks, all in `inventory/core.py`, with the prototype's own fact commands as each task's probes.

**Tech Stack:** Python 3 + pytest. Run the suite with `python3 -m pytest -q -p no:cacheprovider` from the repository root.

Spec: popmechanic/ultrapowers#1292 (the Flock map) and its ticket 4 scope comment.

## Global Constraints

- Check: python3 -m pytest -q -p no:cacheprovider
- The `Item` field is named `quantity` in the result; no code in `inventory/` reads or writes a field called `qty`.

---

### Task 1: Parse a stock line

**Type:** implementation

**Files:**
- Modify: `inventory/core.py`

**Claim:** An operator hands over a stock line and gets an item back, with its optional sku, or a clear error when the line is malformed. (derived)
Machine: M1. `parse_line("widget,3,2.50")` returns an `Item` whose `name`, `quantity`, `price` and `sku` are `"widget"`, `3`, `2.5` and `None`. M2. `parse_line("bolt,1,0.10,B-7").sku` is `"B-7"`. M3. `parse_line("nope")` and `parse_line("a,x,1")` each raise `ValueError` whose message is exactly `bad line`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4 (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `parse_line(line: str) -> Item`

**Context:** All three tasks of this plan edit `inventory/core.py` at the same time. Task 3 renames the `Item` field `qty` to `quantity` everywhere; the final name is `quantity`, so write new code against `quantity`, and if the field in your copy is still `qty`, rename it in the class as well (task 3 makes the identical change, and identical text merges). Add the field `sku` to `Item` after `price`: an optional string, default `None`, annotated `Optional[str]` (from `typing`). Lines have the form `name,quantity,price` with an optional fourth column `sku`; a line with fewer than three columns, or whose quantity is not an integer, is malformed.

**Proof:**
- Run: python3 -c "from inventory.core import parse_line; i = parse_line('widget,3,2.50'); assert (i.name, i.quantity, i.price, i.sku) == ('widget', 3, 2.5, None)" [M1]
- Run: python3 -c "from inventory.core import parse_line; assert parse_line('bolt,1,0.10,B-7').sku == 'B-7'" [M2]
- Run: python3 -c "import pytest; from inventory.core import parse_line; [pytest.raises(ValueError, parse_line, s).match('^bad line$') for s in ('nope', 'a,x,1')]" [M3]
- Legs: (a) the four fields of the parsed item are exactly as named [M1]; (b) the fourth column lands in `sku` [M2]; (c) both malformed lines raise with the exact message, and a line that raised nothing would fail the probe [M3].

**Stale-if:**
- path-absent: `inventory/core.py`

### Task 2: Value a stock list

**Type:** implementation

**Files:**
- Modify: `inventory/core.py`

**Claim:** An operator totals the value of a stock list, and loads a stock list from text, skipping blank lines. (derived)
Machine: M1. `total_value([Item("a", 2, 1.5), Item("b", 1, 3.0)])` is `6.0` and `total_value([])` is `0`. M2. `load("a,2,1.5\n\nb,1,3\n")` returns items whose quantities are `[2, 1]`, in that order.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4 (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `parse_line(line: str) -> Item`
- Produces: `total_value(items) -> float`
- Produces: `load(text: str) -> list[Item]`

**Context:** All three tasks of this plan edit `inventory/core.py` at the same time. Task 3 renames the `Item` field `qty` to `quantity` everywhere; the final name is `quantity`, so write new code against `quantity`. `total_value` is the sum of quantity times price. `load` parses every non-blank line with `parse_line(line: str) -> Item` from task 1.

**Proof:**
- Run: python3 -c "from inventory.core import Item, total_value; assert total_value([Item('a', 2, 1.5), Item('b', 1, 3.0)]) == 6.0 and total_value([]) == 0" [M1]
- Run: python3 -c "from inventory.core import load; assert [i.quantity for i in load('a,2,1.5\n\nb,1,3\n')] == [2, 1]" [M2]
- Legs: (a) both totals are exact [M1]; (b) the blank line is skipped and the quantities come back in order [M2].

**Stale-if:**
- path-absent: `inventory/core.py`

### Task 3: Restock, and rename qty to quantity

**Type:** implementation

**Files:**
- Modify: `inventory/core.py`

**Claim:** An operator restocks an item by name and gets an updated list without the original changing, and every item's count is called quantity. (derived)
Machine: M1. Restocking `"a"` by `3` in `[Item("a", 1, 1.0)]` returns a list whose item has quantity `4`, while the input item still has quantity `1`. M2. An unknown name raises `KeyError`, and an amount of `0` raises `ValueError` whose message is exactly `amount must be positive`. M3. No whole word `qty` remains in `inventory/core.py`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4 (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `restock(items, name, amount) -> list[Item]`

**Context:** All three tasks of this plan edit `inventory/core.py` at the same time. This task renames the `Item` field `qty` to `quantity` everywhere it appears in `inventory/` (the base tests in `tests/test_core.py` construct `Item` positionally and name no `qty`). `restock` returns a new list in which the item called `name` has its quantity increased by `amount`, leaving the input list and its items untouched; `amount <= 0` raises `ValueError("amount must be positive")` and an unknown name raises `KeyError(name)`.

**Proof:**
- Run: python3 -c "from inventory.core import Item, restock; src = [Item('a', 1, 1.0)]; out = restock(src, 'a', 3); assert out[0].quantity == 4 and src[0].quantity == 1" [M1]
- Run: python3 -c "import pytest; from inventory.core import Item, restock; pytest.raises(KeyError, restock, [Item('a', 1, 1.0)], 'zz', 1); pytest.raises(ValueError, restock, [Item('a', 1, 1.0)], 'a', 0).match('^amount must be positive$')" [M2]
- Run: python3 -c "import re, sys; sys.exit(1 if re.search(r'\bqty\b', open('inventory/core.py').read()) else 0)" [M3]
- Legs: (a) the new list carries quantity `4` and the input keeps `1`, so an in-place update fails [M1]; (b) the unknown name and the zero amount each raise, the latter with the exact message [M2]; (c) any remaining whole word `qty` in the module fails the probe [M3].

**Stale-if:**
- path-absent: `inventory/core.py`
